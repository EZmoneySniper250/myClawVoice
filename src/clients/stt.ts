import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import readline from 'node:readline';
import { config } from '../config.js';

type PendingRequest = {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
};

type WorkerState = {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  pending: Map<string, PendingRequest>;
};

let worker: WorkerState | null = null;
let nextRequestId = 1;

export async function transcribeAudio(filePath: string): Promise<string> {
  if (config.stt.mode !== 'faster-whisper' && config.stt.mode !== 'funasr') {
    return '[mock transcription] 请把 STT_MODE=faster-whisper 或 STT_MODE=funasr 并安装对应库后再语音识别。';
  }

  const { size } = fs.statSync(filePath);
  if (size < 800) {
    throw new Error('Audio recording is too short or contains no audio. Hold the mic a little longer and try again.');
  }

  const sttWorker = getWorker();
  await sttWorker.ready;

  const id = String(nextRequestId++);
  const startedAt = performance.now();
  const payload = JSON.stringify({
    id,
    audioFile: path.resolve(filePath),
    language: config.stt.language,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!sttWorker.pending.has(id)) return;
      sttWorker.pending.delete(id);
      // Kill the frozen worker so the next request spawns a fresh one
      sttWorker.child.kill();
      worker = null;
      reject(new Error('STT timeout — Whisper took too long, please try again'));
    }, 60000);

    sttWorker.pending.set(id, {
      resolve: (text) => {
        clearTimeout(timer);
        console.log(`STT result: ${size} bytes, ${Math.round(performance.now() - startedAt)}ms, text=${JSON.stringify(text)}`);
        resolve(text);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    sttWorker.child.stdin.write(`${payload}\n`, (err) => {
      if (!err) return;
      clearTimeout(timer);
      sttWorker.pending.delete(id);
      reject(err);
    });
  });
}

function getWorker(): WorkerState {
  if (worker && !worker.child.killed) return worker;

  const isFunasr = config.stt.mode === 'funasr';
  const script = path.resolve('stt', isFunasr ? 'worker_funasr.py' : 'worker.py');
  const scriptArgs = isFunasr
    ? ['--model', config.stt.funasrModel]
    : ['--model', config.stt.whisperModel, '--language', config.stt.language, '--beam-size', String(config.stt.beamSize)];
  const child = spawn(
    config.stt.pythonBin,
    [script, ...scriptArgs],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  const pending = new Map<string, PendingRequest>();
  let readyResolve: () => void;
  let readyReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  worker = { child, ready, pending };

  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.type === 'ready') {
      console.log(`STT worker ready: ${message.model}`);
      readyResolve();
      return;
    }

    if (message.type === 'fatal') {
      const error = new Error(String(message.error || 'STT worker failed to start.'));
      readyReject(error);
      rejectAll(pending, error);
      return;
    }

    if (message.type === 'result') {
      const request = pending.get(String(message.id));
      if (!request) return;
      pending.delete(String(message.id));
      request.resolve(String(message.text || '').trim());
      return;
    }

    if (message.type === 'error') {
      const request = pending.get(String(message.id));
      if (!request) return;
      pending.delete(String(message.id));
      request.reject(new Error(String(message.error || 'STT failed.')));
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').trim();
    if (text) console.error(`STT worker: ${text}`);
  });

  child.on('error', (err) => {
    readyReject(err);
    rejectAll(pending, err);
    if (worker?.child === child) worker = null;
  });

  child.on('close', (code) => {
    const error = new Error(`STT worker exited (${code ?? 'unknown'}).`);
    readyReject(error);
    rejectAll(pending, error);
    if (worker?.child === child) worker = null;
  });

  return worker;
}

function rejectAll(pending: Map<string, PendingRequest>, error: Error) {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}
