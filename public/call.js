// October — voice call interface

const avatarRing      = document.getElementById('avatarRing');
const avatarGlow      = document.getElementById('avatarGlow');
const callStatusEl    = document.getElementById('callStatus');
const callTimerEl     = document.getElementById('callTimer');
const visualizerEl    = document.getElementById('visualizer');
const silenceBarEl    = document.getElementById('silenceBar');
const silenceCountEl  = document.getElementById('silenceCountdown');
const silenceFillEl   = document.getElementById('silenceFill');
const listenBtn       = document.getElementById('listenBtn');
const callBtn         = document.getElementById('callBtn');
const callBtnLabel    = document.getElementById('callBtnLabel');

const VOICE_THRESHOLD = 0.015;   // RMS level that counts as speech
const SILENCE_MS      = 5000;    // ms of silence before auto-submit
const VAD_INTERVAL_MS = 80;
const BAR_COUNT       = 28;
const MIN_AUDIO_BYTES = 2048;

// ── State ────────────────────────────────────────────────────────────────────
let phase          = 'idle';   // idle | listening | processing | responding
let micStream      = null;
let audioCtx       = null;
let analyser       = null;
let vadDataArray   = null;
let freqDataArray  = null;
let mediaRecorder  = null;
let chunks         = [];
let hasCapturedVoice = false;
let lastVoiceTime  = 0;
let vadTimer       = null;
let callStartTime  = null;
let timerInterval  = null;
let ws             = null;
let nextPlayTime   = 0;
let activeSources  = [];
let ttsMode        = 'mock';

// ── Visualizer bars ──────────────────────────────────────────────────────────
const bars = Array.from({ length: BAR_COUNT }, () => {
  const el = document.createElement('div');
  el.className = 'bar';
  visualizerEl.appendChild(el);
  return el;
});

// ── Button handlers ──────────────────────────────────────────────────────────
callBtn.addEventListener('click', () => {
  if (phase === 'idle') answerCall(); else hangUp();
});

listenBtn.addEventListener('click', () => {
  stopPlayback();
  if (hasCapturedVoice && mediaRecorder?.state === 'recording') {
    mediaRecorder.requestData();
    mediaRecorder.stop();   // onstop will submit
  } else if (phase !== 'processing') {
    setPhase('listening');
    initRecorder();
  }
});

// ── Answer ───────────────────────────────────────────────────────────────────
async function answerCall() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setStatus(`麦克风错误: ${err.message}`);
    return;
  }

  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  source.connect(analyser);   // not connected to destination — no echo
  vadDataArray  = new Uint8Array(analyser.frequencyBinCount);
  freqDataArray = new Uint8Array(analyser.frequencyBinCount);

  connectWS();
  initRecorder();
  startVAD();

  callStartTime = Date.now();
  timerInterval = setInterval(tickTimer, 1000);

  listenBtn.hidden = false;
  callBtnLabel.textContent = '挂断';
  callBtn.classList.add('hanging');
  setPhase('listening');
}

// ── Hang up ──────────────────────────────────────────────────────────────────
function hangUp() {
  clearInterval(vadTimer);
  clearInterval(timerInterval);
  stopPlayback();
  speechSynthesis?.cancel();

  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  micStream?.getTracks().forEach(t => t.stop());
  ws?.close();
  audioCtx?.close();

  micStream = null; audioCtx = null; analyser = null;
  mediaRecorder = null; ws = null;
  chunks = []; hasCapturedVoice = false;

  listenBtn.hidden = true;
  callBtnLabel.textContent = '接听';
  callBtn.classList.remove('hanging');
  callTimerEl.textContent = '--:--';
  silenceBarEl.hidden = true;
  setPhase('idle');
}

// ── Recorder init ─────────────────────────────────────────────────────────────
function initRecorder() {
  chunks = [];
  hasCapturedVoice = false;
  lastVoiceTime = 0;
  silenceBarEl.hidden = true;

  const mimeType = pickMimeType();
  mediaRecorder = new MediaRecorder(micStream, mimeType ? { mimeType } : {});

  mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  mediaRecorder.onstop = async () => {
    if (!hasCapturedVoice || phase === 'idle') {
      if (phase === 'listening') initRecorder();
      return;
    }
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    if (blob.size < MIN_AUDIO_BYTES) {
      if (phase !== 'idle') initRecorder();
      return;
    }
    await submitAudio(blob);
  };
}

// ── VAD loop ──────────────────────────────────────────────────────────────────
function startVAD() {
  vadTimer = setInterval(() => {
    if (!analyser) return;

    analyser.getByteTimeDomainData(vadDataArray);
    analyser.getByteFrequencyData(freqDataArray);

    const rms = calcRms(vadDataArray);
    updateVisualizer(rms);
    updateGlow(rms);

    if (phase === 'idle' || phase === 'processing' || phase === 'responding') return;

    if (rms > VOICE_THRESHOLD) {
      if (mediaRecorder?.state === 'inactive') mediaRecorder.start(200);
      hasCapturedVoice = true;
      lastVoiceTime = Date.now();
      silenceBarEl.hidden = true;
    } else if (hasCapturedVoice && mediaRecorder?.state === 'recording') {
      const elapsed = Date.now() - lastVoiceTime;
      const remaining = Math.max(0, SILENCE_MS - elapsed);
      const progress  = elapsed / SILENCE_MS;

      silenceBarEl.hidden = false;
      silenceCountEl.textContent = Math.ceil(remaining / 1000);
      silenceFillEl.style.width = `${Math.min(progress * 100, 100)}%`;

      if (elapsed >= SILENCE_MS) {
        silenceBarEl.hidden = true;
        mediaRecorder.requestData();
        mediaRecorder.stop();
      }
    }
  }, VAD_INTERVAL_MS);
}

// ── Submit audio → STT → LLM ─────────────────────────────────────────────────
async function submitAudio(blob) {
  setPhase('processing');
  setStatus('正在转录…');

  try {
    const form = new FormData();
    form.append('audio', blob, 'voice.webm');
    const res  = await fetch('/api/transcribe/audio', { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);

    const text = (json.inputText || '').trim();
    if (!text) {
      if (phase !== 'idle') { setPhase('listening'); initRecorder(); }
      return;
    }

    sendViaWS(text);
  } catch (err) {
    setStatus(`错误: ${err.message}`);
    if (phase !== 'idle') { setPhase('listening'); initRecorder(); }
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('message', async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'ready') {
      ttsMode = msg.ttsMode || 'mock';
    } else if (msg.type === 'tts_audio') {
      if (phase !== 'idle') setPhase('responding');
      await playPcm(msg.audioBase64);
    } else if (msg.type === 'tts_done') {
      scheduleReturnToListening();
    } else if (msg.type === 'chat_done') {
      if (ttsMode !== 'doubao' && ttsMode !== 'elevenlabs') {
        speakFallback(msg.answer);
        // for mock mode, wait a rough estimate then return
        const roughMs = (msg.answer?.length || 20) * 80;
        setTimeout(() => {
          if (phase !== 'idle') { setPhase('listening'); initRecorder(); }
        }, roughMs + 300);
      } else {
        scheduleReturnToListening();
      }
    } else if (msg.type === 'error' || msg.type === 'tts_error') {
      setStatus(`错误: ${msg.error}`);
      if (phase !== 'idle') { setPhase('listening'); initRecorder(); }
    }
  });

  ws.addEventListener('close', () => {
    if (phase !== 'idle') setTimeout(connectWS, 1500);
  });
}

function sendViaWS(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus('未连接，重试中…');
    if (phase !== 'idle') { setPhase('listening'); initRecorder(); }
    return;
  }
  setStatus('October 思考中…');
  resetAudioQueue();
  ws.send(JSON.stringify({ type: 'chat_text', text }));
}

function scheduleReturnToListening() {
  const remainingMs = audioCtx
    ? Math.max(0, nextPlayTime - audioCtx.currentTime) * 1000
    : 0;
  setTimeout(() => {
    if (phase !== 'idle') { setPhase('listening'); initRecorder(); }
  }, remainingMs + 300);
}

// ── Audio playback ────────────────────────────────────────────────────────────
function resetAudioQueue() {
  if (audioCtx) nextPlayTime = audioCtx.currentTime + 0.06;
}

async function playPcm(base64, sampleRate = 24000) {
  if (!audioCtx) return;
  const bytes   = b64ToU8(base64);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const buf     = audioCtx.createBuffer(1, samples.length, sampleRate);
  const ch      = buf.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = Math.max(-1, Math.min(1, samples[i] / 32768));

  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  const startAt = Math.max(audioCtx.currentTime + 0.02, nextPlayTime);
  src.start(startAt);
  nextPlayTime = startAt + buf.duration;
  activeSources.push(src);
  src.onended = () => { activeSources = activeSources.filter(s => s !== src); };
}

function stopPlayback() {
  activeSources.forEach(s => { try { s.stop(); } catch {} });
  activeSources = [];
  if (audioCtx) nextPlayTime = audioCtx.currentTime;
}

function speakFallback(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 1.04;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ── Visualizer ────────────────────────────────────────────────────────────────
function updateVisualizer(rms) {
  if (!freqDataArray) return;
  const step = Math.floor(freqDataArray.length / BAR_COUNT);
  for (let i = 0; i < BAR_COUNT; i++) {
    const v = freqDataArray[i * step] / 255;
    bars[i].style.height  = `${Math.max(3, v * 56)}px`;
    bars[i].style.opacity = (0.2 + v * 0.8).toFixed(2);
  }
}

function updateGlow(rms) {
  if (phase === 'responding') return;   // CSS animation handles it
  const level = Math.min(rms * 50, 1);
  avatarGlow.style.opacity = level.toFixed(2);
}

// ── Phase & status ────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  idle:       '等待接通…',
  listening:  '听着呢…',
  processing: '思考中…',
  responding: 'October 说话中…',
};

function setPhase(newPhase) {
  phase = newPhase;
  avatarRing.dataset.phase = newPhase;
  if (newPhase !== 'responding') avatarGlow.style.opacity = '0';
  setStatus(STATUS_LABELS[newPhase] || '');
}

function setStatus(text) {
  callStatusEl.textContent = text;
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function tickTimer() {
  if (!callStartTime) return;
  const s   = Math.floor((Date.now() - callStartTime) / 1000);
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  callTimerEl.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function calcRms(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const x = (data[i] - 128) / 128;
    sum += x * x;
  }
  return Math.sqrt(sum / data.length);
}

function b64ToU8(b64) {
  const bin   = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}
