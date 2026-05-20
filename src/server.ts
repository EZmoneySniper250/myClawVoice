import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { askOpenClaw, streamOpenClaw, type ChatMessage } from './clients/openclaw.js';
import { transcribeAudio } from './clients/stt.js';
import { synthesizeSpeech } from './clients/tts.js';
import { DoubaoRealtimeTtsSession, type RealtimeTtsEvent } from './clients/doubaoRealtimeTts.js';
import { ElevenLabsTtsSession } from './clients/elevenlabsTts.js';
import { loadRecent, loadAll, appendMessages } from './clients/redis.js';

const app = express();
const uploadDir = path.resolve('uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const minAudioBytes = 2048;
const history: ChatMessage[] = [];

app.use(express.json({ limit: '2mb' }));

// Serve React build if available, else fall back to vanilla public/
const clientDist = path.resolve('client', 'dist');
const publicDir  = path.resolve('public');
app.use(express.static(fs.existsSync(clientDist) ? clientDist : publicDir));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'myvoice',
    agentName:    config.agentName,
    agentAvatar:  config.agentAvatar,
    openclawSession: config.openclaw.sessionKey,
    ttsMode: config.tts.mode,
    ttsStreaming: config.tts.mode === 'doubao' || config.tts.mode === 'elevenlabs',
  });
});

app.get('/api/history', async (_req, res) => {
  try {
    const msgs = await loadAll(300);
    const agentKey = config.agentName.toLowerCase();
    res.json({
      messages: msgs.map(m => ({
        role:      m.role === 'assistant' ? agentKey : m.role,
        text:      m.content,
        timestamp: m.timestamp,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/chat/text', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Missing text' });
    const answer = await askAndRemember(text);
    const tts = await synthesizeSpeech(answer);
    res.json({ inputText: text, answer, tts });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message || err) });
  }
});

app.post('/api/transcribe/audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing audio file' });
    if (req.file.size < minAudioBytes) {
      return res.status(400).json({ error: 'Audio recording is too short or contains no audio. Hold the mic a little longer and try again.' });
    }
    const inputText = await transcribeAudio(req.file.path);
    if (!inputText) return res.status(400).json({ error: 'No speech detected. Please try again.' });
    res.json({ inputText });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message || err) });
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
  }
});

app.post('/api/chat/audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Missing audio file' });
    if (req.file.size < minAudioBytes) {
      return res.status(400).json({ error: 'Audio recording is too short or contains no audio. Hold the mic a little longer and try again.' });
    }
    const inputText = await transcribeAudio(req.file.path);
    if (!inputText) return res.status(400).json({ error: 'No speech detected. Please try again.' });
    const answer = await askAndRemember(inputText);
    const tts = await synthesizeSpeech(answer);
    res.json({ inputText, answer, tts });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message || err) });
  } finally {
    if (req.file) fs.unlink(req.file.path, () => {});
  }
});

// SPA fallback — only when React build exists
if (fs.existsSync(clientDist)) {
  app.use((_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const server = app.listen(config.port, config.host, () => {
  console.log(`MyVoice listening at http://${config.host}:${config.port}`);
  console.log(`OpenClaw session: ${config.openclaw.sessionKey}`);
  console.log(`TTS mode: ${config.tts.mode}`);
});

// Per-connection abort controller — cancelled on interrupt or new request
const controllers = new WeakMap<WebSocket, AbortController>();

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  controllers.set(ws, new AbortController());
  const agentKey = config.agentName.toLowerCase();
  send(ws, {
    type:        'ready',
    sessionKey:  config.openclaw.sessionKey,
    ttsMode:     config.tts.mode,
    agentName:   config.agentName,
    agentAvatar: config.agentAvatar,
  });

  // Load persisted history: populate LLM context (if empty) + send to client for display
  loadRecent(60).then(msgs => {
    if (msgs.length === 0) return;
    if (history.length === 0) {
      history.push(...msgs.slice(-16));
    }
    send(ws, {
      type: 'history',
      messages: msgs.map(m => ({
        role:      m.role === 'assistant' ? agentKey : m.role,
        text:      m.content,
        timestamp: m.timestamp,
      })),
    });
  }).catch(() => {});

  ws.on('message', async (raw) => {
    let message: any;
    try {
      message = JSON.parse(String(raw));
    } catch {
      send(ws, { type: 'error', error: 'Invalid JSON message.' });
      return;
    }

    if (message.type === 'interrupt') {
      controllers.get(ws)?.abort();
      controllers.set(ws, new AbortController());
      return;
    }

    if (message.type === 'chat_text') {
      // Abort any in-flight generation before starting the new one
      controllers.get(ws)?.abort();
      const ctrl = new AbortController();
      controllers.set(ws, ctrl);
      await handleStreamingTextChat(ws, String(message.text || '').trim(), ctrl.signal);
    }
  });

  ws.on('close', () => {
    controllers.get(ws)?.abort();
  });
});

async function handleStreamingTextChat(ws: WebSocket, text: string, signal: AbortSignal) {
  if (!text) {
    send(ws, { type: 'error', error: 'Missing text.' });
    return;
  }

  const tts = createTtsSession((event) => send(ws, event));
  const chunker = createSpeechChunker(async (chunk) => tts.append(chunk));
  let answer = '';

  try {
    send(ws, { type: 'chat_started', inputText: text });
    await tts.connect();

    answer = await streamOpenClaw(text, history, async (delta) => {
      if (signal.aborted) return;
      send(ws, { type: 'chat_delta', delta });
      await chunker.push(delta);
    }, signal);

    if (signal.aborted) return;

    await chunker.flush();
    await tts.done();
    remember(text, answer);
    send(ws, { type: 'chat_done', answer });
  } catch (err) {
    if ((err as any)?.name === 'AbortError') return;
    send(ws, { type: 'error', error: String((err as Error).message || err) });
  } finally {
    setTimeout(() => tts.close(), 500);
  }
}

async function askAndRemember(text: string) {
  const answer = await askOpenClaw(text, history);
  remember(text, answer);
  return answer;
}

function remember(text: string, answer: string) {
  history.push({ role: 'user', content: text }, { role: 'assistant', content: answer });
  while (history.length > 16) history.shift();
  appendMessages(text, answer).catch(() => {});
}

function createSpeechChunker(onChunk: (chunk: string) => Promise<void>) {
  let buffer = '';
  const boundary = /[。！？!?；;\n]/;

  return {
    async push(delta: string) {
      buffer += delta;
      while (true) {
        const index = [...buffer].findIndex((char) => boundary.test(char));
        if (index < 0) {
          if (buffer.length >= (config.tts.mode === 'elevenlabs' ? 30 : 36)) {
            await onChunk(buffer);
            buffer = '';
          }
          return;
        }
        const chunk = buffer.slice(0, index + 1).trim();
        buffer = buffer.slice(index + 1);
        if (chunk) await onChunk(chunk);
      }
    },
    async flush() {
      const chunk = buffer.trim();
      buffer = '';
      if (chunk) await onChunk(chunk);
    },
  };
}

function createTtsSession(emit: (event: RealtimeTtsEvent) => void) {
  if (config.tts.mode === 'elevenlabs') return new ElevenLabsTtsSession(emit);
  return new DoubaoRealtimeTtsSession(emit);
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}
