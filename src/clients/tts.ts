import { config } from '../config.js';

export type TtsResult = {
  mode: 'mock' | 'doubao' | 'elevenlabs';
  text: string;
  audioBase64?: string;
  mimeType?: string;
  sampleRate?: number;
};

export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  if (config.tts.mode === 'elevenlabs') {
    if (!config.tts.elevenlabsApiKey) {
      throw new Error('TTS_MODE=elevenlabs but ELEVENLABS_API_KEY is missing.');
    }
    if (!config.tts.elevenlabsVoiceId) {
      throw new Error('TTS_MODE=elevenlabs but ELEVENLABS_VOICE_ID is missing.');
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.tts.elevenlabsVoiceId}?output_format=pcm_24000`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'xi-api-key': config.tts.elevenlabsApiKey,
        },
        body: JSON.stringify({
          text,
          model_id: config.tts.elevenlabsModelId,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    return {
      mode: 'elevenlabs',
      text,
      audioBase64: audio.toString('base64'),
      mimeType: 'audio/pcm',
      sampleRate: 24000,
    };
  }

  if (config.tts.mode !== 'doubao') {
    return { mode: 'mock', text };
  }

  // Realtime bidirectional Doubao TTS is handled over /ws by
  // DoubaoRealtimeTtsSession. The legacy HTTP endpoints keep this lightweight
  // result so older callers do not require DOUBAO_APP_ID / ACCESS_TOKEN.
  if (!config.tts.doubaoRealtimeApiKey) {
    throw new Error('Doubao realtime TTS is enabled but DOUBAO_TTS_API_KEY or ARK_API_KEY is missing.');
  }

  return { mode: 'doubao', text };
}
