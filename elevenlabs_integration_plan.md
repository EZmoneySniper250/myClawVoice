# ElevenLabs TTS Integration Plan

Goal: replace Doubao realtime TTS with ElevenLabs while keeping OpenClaw text streaming and the browser's existing PCM playback path unchanged.

## Recommendation: per-sentence streaming with `pcm_24000`

Keep the current sentence chunker. Synthesize each sentence with ElevenLabs and reuse the existing `tts_ready` / `tts_audio` / `tts_done` event contract. Request `outputFormat: 'pcm_24000'` so the browser's `playPcmBase64` (raw 16-bit PCM @ 24 kHz) works without any frontend change.

Why this over "synthesize full answer after `chat_done`":
- Latency: first audio arrives after the first sentence, not after the full generation.
- Zero frontend change.
- Same event shape, so `server.ts` wiring stays nearly identical.
- ElevenLabs PCM output stays cheaper to ship than MP3 once you account for base64 expansion of larger MP3 frames, and avoids decoding mismatches.

## Changes (minimal)

1. **Install SDK**
   - `npm i @elevenlabs/elevenlabs-js`
   - Note: official package is `@elevenlabs/elevenlabs-js` (not `elevenlabs-node`). Verify exact name via context7 before installing.

2. **`src/config.ts`** — add `tts.elevenlabs` block:
   - `apiKey: process.env.ELEVENLABS_API_KEY`
   - `voiceId: process.env.ELEVENLABS_VOICE_ID`
   - `modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2'`
   - `outputFormat: 'pcm_24000'` (constant, matches frontend)
   - Extend `TTS_MODE` to accept `'elevenlabs'`.

3. **New `src/clients/elevenlabsTts.ts`** — mirror the `DoubaoRealtimeTtsSession` surface so `server.ts` doesn't care which backend runs:
   ```ts
   class ElevenLabsTtsSession {
     constructor(emit: (e: RealtimeTtsEvent) => void)
     async connect(): Promise<void>         // emits tts_ready { sampleRate: 24000, format: 'pcm' }
     async append(text: string): Promise<void>  // calls textToSpeech.convert per sentence, emits tts_audio
     async done(): Promise<void>            // emits tts_done after in-flight requests settle
     close(): void
   }
   ```
   - In `append`: serialize calls with a queue (await previous before next) so audio chunks reach the browser in order. The browser scheduler (`nextPlayTime`) handles smooth concatenation.
   - The SDK's `textToSpeech.convert` returns a `ReadableStream` / async iterable; collect to a `Buffer`, then `buffer.toString('base64')` and emit `tts_audio`.

4. **`src/server.ts` (~line 88)** — pick session by `config.tts.mode`:
   ```ts
   const tts = config.tts.mode === 'elevenlabs'
     ? new ElevenLabsTtsSession(emit)
     : new DoubaoRealtimeTtsSession(emit);
   ```
   No other server changes needed; chunker, `chat_started`/`chat_delta`/`chat_done` flow is preserved.

5. **`.env`** — set `TTS_MODE=elevenlabs`, `ELEVENLABS_API_KEY=...`, `ELEVENLABS_VOICE_ID=...`.

No frontend changes. No browser-decoder changes.

## Gotchas

- **PCM has no WAV header.** ElevenLabs `pcm_24000` returns headerless little-endian 16-bit mono PCM — that's exactly what `playPcmBase64` already assumes. Do **not** prepend a WAV header or the browser will play 44 bytes of garbage at the start of every sentence.
- **Ordering.** ElevenLabs `convert` per sentence is independent — fire-and-forget will reorder. Use an in-class promise chain so the next `append` awaits the previous emit.
- **Quotas / 401s.** ElevenLabs returns 401 on bad key, 429 on quota. Emit `tts_error` and let `server.ts` propagate; don't crash the WS session.
- **Chunk size.** The current `createSpeechChunker` boundary `36 chars` is tuned for Doubao realtime. ElevenLabs per-request latency is higher than a streaming WS, so very short chunks (single short clauses) waste round-trips. Consider raising the soft threshold to ~60–80 chars to reduce calls — but keep sentence boundaries as hard breaks. Leave default for first pass; only tune if you hear stutter.
- **Multilingual model.** `eleven_multilingual_v2` handles Chinese; if the voice is English-only it'll still pronounce but with English phonology. Pick a Chinese-trained voice for `DOUBAO_TTS_VOICE` parity.
- **SDK name.** Anthropic context7 / npm registry — confirm the package name is `@elevenlabs/elevenlabs-js`. Some older snippets use `elevenlabs` (no scope) or `elevenlabs-node`. Wrong package = wrong API surface.
- **`textToSpeech.convert` vs `stream`.** The SDK exposes both. `convert` returns a full buffer; `stream` yields chunks as they synthesize. For per-sentence requests the difference is tiny (<200ms); start with `convert`. Upgrade to `stream` later only if you want to forward sub-sentence audio chunks.
- **Cleanup.** Doubao session has a 2 s `setTimeout(...close)`. ElevenLabs is stateless HTTP — `close()` only needs to mark the session done and reject pending appends.
- **Don't delete `doubaoRealtimeTts.ts` yet.** Keep both behind `TTS_MODE` until ElevenLabs is verified end-to-end with the live voice.

## Out of scope (do later if needed)

- Switching the browser to MP3 playback (`HTMLAudioElement` or `decodeAudioData`) — only needed if you want to use ElevenLabs MP3 output for bandwidth.
- Voice cloning / voice settings (stability, similarity) — pass through `voiceSettings` once basic playback works.
- Caching identical sentence syntheses — premature.
