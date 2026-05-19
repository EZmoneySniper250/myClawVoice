import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { config } from '../config.js';
import type { RealtimeTtsEvent } from './doubaoRealtimeTts.js';

export class ElevenLabsTtsSession {
  private readonly client: ElevenLabsClient;
  private queue = Promise.resolve();
  private closed = false;

  constructor(private readonly emit: (event: RealtimeTtsEvent) => void) {
    this.client = new ElevenLabsClient({ apiKey: config.tts.elevenlabsApiKey });
  }

  async connect() {
    if (!config.tts.elevenlabsApiKey) {
      throw new Error('TTS_MODE=elevenlabs but ELEVENLABS_API_KEY is missing.');
    }
    if (!config.tts.elevenlabsVoiceId) {
      throw new Error('TTS_MODE=elevenlabs but ELEVENLABS_VOICE_ID is missing.');
    }

    this.emit({ type: 'tts_ready', sampleRate: 24000, format: 'pcm' });
  }

  async append(text: string) {
    const clean = text.trim();
    if (!clean || this.closed) return;

    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      try {
        const audio = await this.client.textToSpeech.convert(config.tts.elevenlabsVoiceId, {
          text: clean,
          modelId: config.tts.elevenlabsModelId,
          outputFormat: 'pcm_24000',
        });
        const buffer = await readableStreamToBuffer(audio);
        if (!this.closed && buffer.length > 0) {
          this.emit({ type: 'tts_audio', audioBase64: buffer.toString('base64') });
        }
      } catch (err) {
        const message = String((err as Error).message || err);
        this.emit({ type: 'tts_error', error: message });
      }
    });

    await this.queue;
  }

  async done() {
    await this.queue;
    if (!this.closed) this.emit({ type: 'tts_done' });
  }

  close() {
    this.closed = true;
  }
}

async function readableStreamToBuffer(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
