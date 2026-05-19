const statusDotEl  = document.querySelector('#statusDot');
const statusTextEl = document.querySelector('#statusText');
const messagesEl   = document.querySelector('#messages');
const micBtn       = document.querySelector('#micBtn');
const textForm     = document.querySelector('#textForm');
const textInput    = document.querySelector('#textInput');

let mediaRecorder;
let chunks = [];
let ws;
let audioCtx;
let nextPlayTime = 0;
let currentAssistantBubble = null;
let ttsMode = 'mock';
let typingIndicator = null;
let isRecording = false;
let recordingStartedAt = 0;

const MIN_RECORDING_MS = 700;
const MIN_AUDIO_BYTES = 2048;

connectSocket();

// ── Text input ──────────────────────────────────────────────────────────────
textForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = '';
  await sendText(text);
});

// ── Mic: hold-to-talk ───────────────────────────────────────────────────────
micBtn.addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  micBtn.setPointerCapture(e.pointerId);
  if (!isRecording) await startRecording();
});

micBtn.addEventListener('pointerup', () => {
  if (isRecording) stopRecording();
});

micBtn.addEventListener('pointercancel', () => {
  if (isRecording) stopRecording();
});

// ── Recording ───────────────────────────────────────────────────────────────
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: pickMimeType() });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      isRecording = false;
      micBtn.classList.remove('active');
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const durationMs = Date.now() - recordingStartedAt;
      if (durationMs < MIN_RECORDING_MS || blob.size < MIN_AUDIO_BYTES) {
        setStatus('Too short — hold the mic longer', 'error');
        setTimeout(() => setStatus('Ready', 'ready'), 2000);
        return;
      }
      await sendAudio(blob);
    };
    recordingStartedAt = Date.now();
    mediaRecorder.start(250);
    isRecording = true;
    micBtn.classList.add('active');
    setStatus('Listening…', 'working');
  } catch (err) {
    addMessage('error', `Mic error: ${err.message || err}`);
  }
}

function stopRecording() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.requestData();
    mediaRecorder.stop();
  }
}

// ── Send text (WebSocket) ───────────────────────────────────────────────────
async function sendText(text, options = {}) {
  if (options.addUserMessage !== false) addMessage('user', text);
  currentAssistantBubble = null;
  showTyping();
  await ensureAudioContext();
  resetAudioQueue();
  setStatus('Asking October…', 'working');

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    hideTyping();
    addMessage('error', 'WebSocket not connected.');
    setStatus('Error', 'error');
    return;
  }
  ws.send(JSON.stringify({ type: 'chat_text', text }));
}

// ── Send audio (HTTP) ───────────────────────────────────────────────────────
async function sendAudio(blob) {
  const userBubble = addMessage('user', '🎤 …');
  setStatus('Transcribing…', 'working');
  try {
    const form = new FormData();
    form.append('audio', blob, 'voice.webm');
    const res = await fetch('/api/transcribe/audio', { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    const inputText = json.inputText || '🎤 Voice message';
    userBubble.textContent = inputText;
    await sendText(inputText, { addUserMessage: false });
  } catch (err) {
    hideTyping();
    addMessage('error', err.message || String(err));
    setStatus('Error', 'error');
  }
}

// ── WebSocket ───────────────────────────────────────────────────────────────
function connectSocket() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  ws.addEventListener('message', async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'ready') {
      ttsMode = msg.ttsMode || 'mock';
      setStatus('Ready', 'ready');
      return;
    }
    if (msg.type === 'chat_started') {
      showTyping();
      setStatus('Thinking…', 'working');
      return;
    }
    if (msg.type === 'tts_ready') {
      setStatus(msg.format === 'mock' ? 'Streaming…' : `Voice · ${msg.format}`, 'working');
      return;
    }
    if (msg.type === 'chat_delta') {
      appendAssistantText(msg.delta);
      return;
    }
    if (msg.type === 'tts_audio') {
      await playPcmBase64(msg.audioBase64);
      return;
    }
    if (msg.type === 'tts_done') {
      setStatus('Ready', 'ready');
      return;
    }
    if (msg.type === 'chat_done') {
      hideTyping();
      currentAssistantBubble = null;
      if (ttsMode !== 'doubao' && ttsMode !== 'elevenlabs') speakFallback(msg.answer);
      setStatus('Ready', 'ready');
      return;
    }
    if (msg.type === 'error' || msg.type === 'tts_error') {
      hideTyping();
      addMessage('error', msg.error || 'Unknown error');
      setStatus('Error', 'error');
    }
  });

  ws.addEventListener('close', () => {
    setStatus('Reconnecting…', 'error');
    setTimeout(connectSocket, 1500);
  });
  ws.addEventListener('error', () => setStatus('Connection error', 'error'));
}

// ── Audio playback ──────────────────────────────────────────────────────────
async function ensureAudioContext() {
  audioCtx ||= new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
}

function resetAudioQueue() {
  if (!audioCtx) return;
  nextPlayTime = audioCtx.currentTime + 0.06;
}

async function playPcmBase64(base64, sampleRate = 24000) {
  await ensureAudioContext();
  const bytes = base64ToUint8Array(base64);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const audioBuffer = audioCtx.createBuffer(1, samples.length, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) channel[i] = Math.max(-1, Math.min(1, samples[i] / 32768));
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioCtx.destination);
  const startAt = Math.max(audioCtx.currentTime + 0.02, nextPlayTime);
  source.start(startAt);
  nextPlayTime = startAt + audioBuffer.duration;
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function speakFallback(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = 1.04;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

// ── DOM helpers ─────────────────────────────────────────────────────────────
function addMessage(kind, text) {
  const row = document.createElement('div');
  row.className = kind === 'user'
    ? 'msg-row right'
    : kind === 'error'
    ? 'msg-row left error'
    : 'msg-row left';

  if (kind !== 'user') {
    const av = document.createElement('div');
    av.className = kind === 'error' ? 'avatar-sm warn' : 'avatar-sm';
    av.textContent = kind === 'error' ? '!' : 'O';
    row.appendChild(av);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);

  messagesEl.appendChild(row);
  scrollToBottom();
  return bubble;
}

function appendAssistantText(delta) {
  if (!currentAssistantBubble) {
    hideTyping();
    currentAssistantBubble = addMessage('october', '');
  }
  currentAssistantBubble.textContent += delta;
  scrollToBottom();
}

function showTyping() {
  if (typingIndicator) return;
  typingIndicator = document.createElement('div');
  typingIndicator.className = 'msg-row left';
  typingIndicator.innerHTML = `
    <div class="avatar-sm">O</div>
    <div class="bubble thinking">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>`;
  messagesEl.appendChild(typingIndicator);
  scrollToBottom();
}

function hideTyping() {
  typingIndicator?.remove();
  typingIndicator = null;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(text, state = '') {
  statusTextEl.textContent = text;
  statusDotEl.className = `status-dot ${state}`;
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}
