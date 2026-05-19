# MyVoice — October local voice page

Local browser page for Push-to-Talk voice chat with October/OpenClaw.

## Current architecture

- Browser UI: `public/`
- Local Node server: `src/server.ts`
- OpenClaw client: OpenAI-compatible Gateway endpoint `/v1/chat/completions`
- Text chat path: WebSocket streaming from OpenClaw to the browser
- STT: mock by default; `faster-whisper` bridge prepared in `stt/transcribe.py`
- TTS: mock/browser speech by default; Doubao Realtime bidirectional TTS WebSocket implemented

## Setup

```powershell
cd D:\MyVoice
copy .env.example .env
npm install
npm run dev
```

Open: <http://127.0.0.1:8787>

## OpenClaw requirement

MyVoice uses a dedicated OpenClaw session key:

```txt
myvoice-october
```

The Gateway OpenAI-compatible endpoint must be enabled:

```json5
gateway.http.endpoints.chatCompletions.enabled = true
```

Gateway auth is currently `password`, so put the Gateway password/token in `.env`:

```env
OPENCLAW_API_KEY=...
```

Do not commit `.env`.

## Doubao realtime bidirectional TTS

Official docs used:

- Realtime API TTS: <https://www.volcengine.com/docs/6893/1527770>
- Doubao speech synthesis WebSocket bidirectional streaming V3: <https://www.volcengine.com/docs/6561/1329505?lang=zh>
- Voice list: <https://www.volcengine.com/docs/6561/97465>

Set these in `.env` after creating/binding a Volcengine key that can call `doubao-tts`:

```env
TTS_MODE=doubao
DOUBAO_TTS_API_KEY=...
DOUBAO_TTS_MODEL=doubao-tts
DOUBAO_TTS_REALTIME_URL=wss://ai-gateway.vei.volces.com/v1/realtime
DOUBAO_TTS_VOICE=zh_female_kailangjiejie_moon_bigtts
DOUBAO_TTS_SAMPLE_RATE=24000
DOUBAO_TTS_FORMAT=pcm
```

The browser plays streamed PCM chunks through Web Audio. If `TTS_MODE=mock`, it falls back to browser speech synthesis.

## STT later

Install faster-whisper when ready:

```powershell
python -m pip install faster-whisper
```

Then set:

```env
STT_MODE=faster-whisper
WHISPER_MODEL=small
WHISPER_LANGUAGE=zh
```
