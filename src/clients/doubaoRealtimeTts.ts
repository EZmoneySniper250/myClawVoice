import WebSocket from 'ws';
import { config } from '../config.js';

export type RealtimeTtsEvent =
  | { type: 'tts_ready'; sampleRate: number; format: string }
  | { type: 'tts_audio'; audioBase64: string }
  | { type: 'tts_done' }
  | { type: 'tts_error'; error: string };

export class DoubaoRealtimeTtsSession {
  private ws?: WebSocket;
  private readyPromise?: Promise<void>;
  private closed = false;

  constructor(private readonly emit: (event: RealtimeTtsEvent) => void) {}

  async connect() {
    if (config.tts.mode !== 'doubao') {
      this.emit({ type: 'tts_ready', sampleRate: config.tts.doubaoRealtimeSampleRate, format: 'mock' });
      return;
    }
    if (!config.tts.doubaoRealtimeApiKey) {
      throw new Error('TTS_MODE=doubao but DOUBAO_TTS_API_KEY or ARK_API_KEY is missing.');
    }

    const url = new URL(config.tts.doubaoRealtimeUrl);
    url.searchParams.set('model', config.tts.doubaoRealtimeModel);
    const headers: Record<string, string> = {
      authorization: `Bearer ${config.tts.doubaoRealtimeApiKey}`,
    };
    if (config.tts.doubaoRealtimeResourceId) {
      headers['X-Api-Resource-Id'] = config.tts.doubaoRealtimeResourceId;
    }

    this.readyPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      this.ws = ws;
      let ready = false;

      const failTimer = setTimeout(() => {
        if (!ready) reject(new Error('Timed out waiting for Doubao TTS session.'));
      }, 15000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          event_id: eventId(),
          type: 'tts_session.update',
          session: {
            voice: config.tts.doubaoRealtimeVoice,
            output_audio_format: config.tts.doubaoRealtimeFormat,
            output_audio_sample_rate: config.tts.doubaoRealtimeSampleRate,
            text_to_speech: {
              model: config.tts.doubaoRealtimeModel,
            },
          },
        }));
      });

      ws.on('message', (raw) => {
        let event: any;
        try {
          event = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (event.type === 'tts_session.updated') {
          ready = true;
          clearTimeout(failTimer);
          this.emit({
            type: 'tts_ready',
            sampleRate: config.tts.doubaoRealtimeSampleRate,
            format: config.tts.doubaoRealtimeFormat,
          });
          resolve();
          return;
        }
        if (event.type === 'response.audio.delta' && event.delta) {
          this.emit({ type: 'tts_audio', audioBase64: String(event.delta) });
          return;
        }
        if (event.type === 'response.audio.done') {
          this.emit({ type: 'tts_done' });
          return;
        }
        if (event.type === 'error' || event.error) {
          const message = event?.error?.message || event?.message || JSON.stringify(event).slice(0, 500);
          this.emit({ type: 'tts_error', error: String(message) });
        }
      });

      ws.on('error', (err) => {
        clearTimeout(failTimer);
        if (!ready) reject(err);
        this.emit({ type: 'tts_error', error: err.message });
      });

      ws.on('close', () => {
        this.closed = true;
        clearTimeout(failTimer);
      });
    });

    await this.readyPromise;
  }

  async append(text: string) {
    const clean = text.trim();
    if (!clean) return;
    if (config.tts.mode !== 'doubao') return;
    await this.readyPromise;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      event_id: eventId(),
      type: 'input_text.append',
      delta: clean,
    }));
  }

  async done() {
    if (config.tts.mode !== 'doubao') return;
    await this.readyPromise;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ event_id: eventId(), type: 'input_text.done' }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.ws?.close();
  }
}

function eventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
