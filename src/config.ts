import dotenv from 'dotenv';

dotenv.config({ override: true });

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  openclaw: {
    baseUrl: process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789',
    apiKey: process.env.OPENCLAW_API_KEY || '',
    model: process.env.OPENCLAW_MODEL || 'openclaw/default',
    sessionKey: process.env.OPENCLAW_SESSION_KEY || 'myvoice-october',
    messageChannel: process.env.OPENCLAW_MESSAGE_CHANNEL || 'myvoice',
  },
  stt: {
    mode: process.env.STT_MODE || 'mock',
    pythonBin: process.env.PYTHON_BIN || 'python',
    whisperModel: process.env.WHISPER_MODEL || 'small',
    language: process.env.WHISPER_LANGUAGE || 'zh',
    beamSize: Number(process.env.WHISPER_BEAM_SIZE || 1),
  },
  tts: {
    mode: process.env.TTS_MODE || 'mock',
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || '',
    elevenlabsModelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    doubaoAppId: process.env.DOUBAO_APP_ID || '',
    doubaoAccessToken: process.env.DOUBAO_ACCESS_TOKEN || '',
    doubaoVoiceType: process.env.DOUBAO_VOICE_TYPE || '',
    doubaoRealtimeUrl: process.env.DOUBAO_TTS_REALTIME_URL || 'wss://ai-gateway.vei.volces.com/v1/realtime',
    doubaoRealtimeApiKey: process.env.DOUBAO_TTS_API_KEY || process.env.ARK_API_KEY || '',
    doubaoRealtimeModel: process.env.DOUBAO_TTS_MODEL || 'doubao-tts',
    doubaoRealtimeVoice: process.env.DOUBAO_TTS_VOICE || process.env.DOUBAO_VOICE_TYPE || 'zh_female_kailangjiejie_moon_bigtts',
    doubaoRealtimeResourceId: process.env.DOUBAO_TTS_RESOURCE_ID || '',
    doubaoRealtimeSampleRate: Number(process.env.DOUBAO_TTS_SAMPLE_RATE || 24000),
    doubaoRealtimeFormat: process.env.DOUBAO_TTS_FORMAT || 'pcm',
  },
};
