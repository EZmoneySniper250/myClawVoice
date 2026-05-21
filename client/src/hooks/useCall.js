import { useState, useRef, useEffect } from 'react';

const VOICE_THRESHOLD = 0.025;
const SILENCE_MS      = 1600;
const VAD_INTERVAL_MS = 80;
const MIN_AUDIO_BYTES = 800;
const MAX_RECORDING_MS = 12000;

const IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const IDLE_WARN_S     = 30;

const HANGUP_PHRASES = [
  '挂断', '挂了', '结束通话', '断开', '再见', '拜拜',
  'goodbye', 'bye bye', 'hang up', 'disconnect',
];

function isHangupPhrase(text) {
  const t = text.toLowerCase();
  return HANGUP_PHRASES.some(p => t.includes(p));
}

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function b64ToU8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function calcRms(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const x = (data[i] - 128) / 128;
    sum += x * x;
  }
  return Math.sqrt(sum / data.length);
}

export function useCall() {
  const [phase, setPhase]               = useState('idle');
  const [transcript, setTranscript]     = useState([]);
  const [currentResponse, setCurrent]   = useState('');
  const [silenceProgress, setSilence]   = useState(0);
  const [agentName, setAgentName]       = useState('October');
  const [idleCountdown, setIdleCountdown] = useState(0);

  const r = useRef({
    phase:            'idle',
    micStream:        null,
    audioCtx:         null,
    analyser:         null,
    vadData:          null,
    recorder:         null,
    chunks:           [],
    hasCaptured:      false,
    lastVoiceTime:    0,
    voiceStartedAt:   0,
    ws:               null,
    nextPlayTime:     0,
    activeSources:    [],
    vadTimer:         null,
    ttsMode:          'mock',
    agentName:        'October',
    idleTimer:        null,
    idleWarnTimer:    null,
    idleCountInterval: null,
    returnTimer:      null,   // single pending return-to-listening timer
  });

  const rmsLevelRef = useRef(0);

  function syncPhase(p) {
    r.current.phase = p;
    setPhase(p);
  }

  function clearReturnTimer() {
    if (r.current.returnTimer) {
      clearTimeout(r.current.returnTimer);
      r.current.returnTimer = null;
    }
  }

  // ── Idle-disconnect timer ──────────────────────────────────────
  function disarmIdleTimer() {
    clearTimeout(r.current.idleTimer);
    clearTimeout(r.current.idleWarnTimer);
    clearInterval(r.current.idleCountInterval);
    r.current.idleTimer        = null;
    r.current.idleWarnTimer    = null;
    r.current.idleCountInterval = null;
    setIdleCountdown(0);
  }

  function armIdleTimer() {
    disarmIdleTimer();
    if (r.current.phase === 'idle') return;

    r.current.idleWarnTimer = setTimeout(() => {
      let remaining = IDLE_WARN_S;
      setIdleCountdown(remaining);
      r.current.idleCountInterval = setInterval(() => {
        remaining -= 1;
        setIdleCountdown(remaining);
        if (remaining <= 0) clearInterval(r.current.idleCountInterval);
      }, 1000);
    }, IDLE_TIMEOUT_MS - IDLE_WARN_S * 1000);

    r.current.idleTimer = setTimeout(() => {
      if (r.current.phase !== 'idle') hangUp();
    }, IDLE_TIMEOUT_MS);
  }

  function stopPlayback() {
    r.current.activeSources.forEach(s => { try { s.stop(); } catch {} });
    r.current.activeSources = [];
    if (r.current.audioCtx) r.current.nextPlayTime = r.current.audioCtx.currentTime;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  async function playPcm(base64, sampleRate = 24000) {
    const ctx = r.current.audioCtx;
    if (!ctx) return;
    const bytes   = b64ToU8(base64);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buf     = ctx.createBuffer(1, samples.length, sampleRate);
    const ch      = buf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) ch[i] = Math.max(-1, Math.min(1, samples[i] / 32768));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, r.current.nextPlayTime);
    src.start(startAt);
    r.current.nextPlayTime = startAt + buf.duration;
    r.current.activeSources.push(src);
    src.onended = () => {
      r.current.activeSources = r.current.activeSources.filter(s => s !== src);
    };
  }

  function resetAudioQueue() {
    if (r.current.audioCtx) r.current.nextPlayTime = r.current.audioCtx.currentTime + 0.06;
  }

  function speakFallback(text) {
    if (typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.04;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  function returnToListeningNow() {
    clearReturnTimer();
    if (r.current.phase === 'idle') return;
    syncPhase('listening');
    initRecorder();
    armIdleTimer();
  }

  function scheduleReturnToListening(extraMs = 0) {
    clearReturnTimer();
    const ctx = r.current.audioCtx;
    const remainingMs = ctx ? Math.max(0, r.current.nextPlayTime - ctx.currentTime) * 1000 : 0;
    r.current.returnTimer = setTimeout(returnToListeningNow, remainingMs + 300 + extraMs);
  }

  // ── Recorder ───────────────────────────────────────────────────
  function initRecorder() {
    // Stop any existing recorder cleanly so its onstop won't interfere
    const old = r.current.recorder;
    if (old && old.state === 'recording') {
      old.onstop = null;
      old.ondataavailable = null;
      try { old.stop(); } catch {}
    }

    r.current.chunks         = [];
    r.current.hasCaptured    = false;
    r.current.lastVoiceTime  = 0;
    r.current.voiceStartedAt = 0;
    setSilence(0);

    if (!r.current.micStream) return;

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(r.current.micStream, mimeType ? { mimeType } : {});
    r.current.recorder = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) r.current.chunks.push(e.data);
    };

    recorder.onstop = async () => {
      if (r.current.phase === 'idle') return;
      if (!r.current.hasCaptured) {
        if (r.current.phase === 'listening') initRecorder();
        return;
      }
      const blob = new Blob(r.current.chunks, { type: recorder.mimeType || 'audio/webm' });
      r.current.chunks = [];
      console.log('[useCall] submit blob:', blob.size, 'bytes,', blob.type);
      if (blob.size === 0) {
        if (r.current.phase !== 'idle') { syncPhase('listening'); initRecorder(); }
        return;
      }
      await submitAudio(blob);
    };

    recorder.start(200);
  }

  // ── VAD ────────────────────────────────────────────────────────
  function startVAD() {
    r.current.vadTimer = setInterval(() => {
      const c = r.current;
      if (!c.analyser || c.phase === 'idle' || c.phase === 'processing') {
        rmsLevelRef.current = 0;
        return;
      }

      c.analyser.getByteTimeDomainData(c.vadData);
      const rms = calcRms(c.vadData);
      rmsLevelRef.current = rms;

      // During responding, just animate orb — don't process voice
      if (c.phase === 'responding') return;

      // listening phase: voice detection
      if (rms > VOICE_THRESHOLD) {
        c.hasCaptured = true;
        if (!c.voiceStartedAt) c.voiceStartedAt = Date.now();
        c.lastVoiceTime = Date.now();
        setSilence(0);
        disarmIdleTimer();
        if (Date.now() - c.voiceStartedAt >= MAX_RECORDING_MS) {
          submitCurrentRecording();
        }
      } else if (c.hasCaptured && c.recorder?.state === 'recording') {
        const elapsed = Date.now() - c.lastVoiceTime;
        setSilence(Math.min(elapsed / SILENCE_MS, 1));
        if (elapsed >= SILENCE_MS) submitCurrentRecording();
      }
    }, VAD_INTERVAL_MS);
  }

  function submitCurrentRecording() {
    const recorder = r.current.recorder;
    if (r.current.phase !== 'listening' || recorder?.state !== 'recording') return;
    setSilence(0);
    syncPhase('processing');
    recorder.requestData();
    recorder.stop();
  }

  // ── Audio submit → STT → LLM ───────────────────────────────────
  async function submitAudio(blob) {
    syncPhase('processing');
    try {
      const form = new FormData();
      form.append('audio', blob, 'voice.webm');
      const res  = await fetch('/api/transcribe/audio', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);

      const text = (json.inputText || '').trim();
      if (!text) {
        if (r.current.phase !== 'idle') { syncPhase('listening'); initRecorder(); }
        return;
      }

      setTranscript(prev => [...prev, { role: 'user', text, timestamp: Date.now() }]);

      if (isHangupPhrase(text)) {
        hangUp();
        return;
      }

      sendViaWS(text);
    } catch (err) {
      console.error('STT error:', err);
      if (r.current.phase !== 'idle') { syncPhase('listening'); initRecorder(); }
    }
  }

  function sendViaWS(text) {
    const ws = r.current.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (r.current.phase !== 'idle') {
        syncPhase('listening');
        initRecorder();
      }
      return;
    }
    clearReturnTimer();        // a new turn starts — kill any pending return-to-listening
    setCurrent('');
    resetAudioQueue();
    ws.send(JSON.stringify({ type: 'chat_text', text }));
  }

  // ── WebSocket ──────────────────────────────────────────────────
  useEffect(() => {
    let dead = false;

    function connect() {
      if (dead) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      r.current.ws = ws;

      ws.onmessage = async (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.type === 'ready') {
          r.current.ttsMode   = msg.ttsMode   || 'mock';
          r.current.agentName = msg.agentName || 'October';
          setAgentName(msg.agentName || 'October');
        }
        else if (msg.type === 'history') {
          if (Array.isArray(msg.messages) && msg.messages.length > 0) {
            setTranscript(msg.messages);
          }
        }
        else if (msg.type === 'chat_delta') {
          setCurrent(prev => prev + msg.delta);
        }
        else if (msg.type === 'tts_audio') {
          if (r.current.phase !== 'idle') syncPhase('responding');
          await playPcm(msg.audioBase64);
        }
        else if (msg.type === 'tts_done') {
          // Server finished sending all audio — schedule return after playback
          scheduleReturnToListening();
        }
        else if (msg.type === 'chat_done') {
          const answer = msg.answer || '';
          setTranscript(prev => [...prev, { role: r.current.agentName.toLowerCase(), text: answer, timestamp: Date.now() }]);
          setCurrent('');

          if (r.current.ttsMode === 'mock') {
            // No real TTS — use browser speech, estimate duration
            speakFallback(answer);
            const roughMs = answer.length * 75;
            scheduleReturnToListening(roughMs);
          }
          // doubao/elevenlabs: tts_done already scheduled the return
        }
        else if (msg.type === 'tts_error') {
          // single-sentence TTS failure — server still sends tts_done/chat_done
        }
        else if (msg.type === 'error') {
          if (r.current.phase !== 'idle') {
            clearReturnTimer();
            syncPhase('listening');
            initRecorder();
          }
        }
      };

      ws.onclose = () => { if (!dead) setTimeout(connect, 1500); };
    }

    connect();
    return () => {
      dead = true;
      r.current.ws?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Public API ────────────────────────────────────────────────
  async function startCall() {
    if (r.current.micStream) return;
    if (r.current.phase !== 'idle') return;
    try {
      r.current.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('Mic error:', err);
      return;
    }

    const ctx = new AudioContext();
    r.current.audioCtx = ctx;

    const source = ctx.createMediaStreamSource(r.current.micStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    r.current.analyser = analyser;
    r.current.vadData  = new Uint8Array(analyser.fftSize);

    syncPhase('listening');
    initRecorder();
    startVAD();
    armIdleTimer();
  }

  function hangUp() {
    clearReturnTimer();
    disarmIdleTimer();
    clearInterval(r.current.vadTimer);
    stopPlayback();

    const rec = r.current.recorder;
    if (rec) {
      rec.onstop = null;
      rec.ondataavailable = null;
      if (rec.state === 'recording') { try { rec.stop(); } catch {} }
    }
    r.current.micStream?.getTracks().forEach(t => t.stop());
    r.current.audioCtx?.close();

    r.current.micStream   = null;
    r.current.audioCtx    = null;
    r.current.analyser    = null;
    r.current.recorder    = null;
    r.current.vadTimer    = null;
    r.current.hasCaptured = false;
    r.current.chunks      = [];
    rmsLevelRef.current   = 0;

    setSilence(0);
    setCurrent('');
    syncPhase('idle');
  }

  function sendInterrupt() {
    const ws = r.current.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'interrupt' }));
    }
  }

  // Manual interrupt only — used by the 打断 button
  function forceListen() {
    clearReturnTimer();
    sendInterrupt();
    stopPlayback();
    if (r.current.hasCaptured && r.current.recorder?.state === 'recording') {
      submitCurrentRecording();
    } else {
      returnToListeningNow();
    }
  }

  function sendText(text) {
    if (!text.trim()) return;
    disarmIdleTimer();
    setTranscript(prev => [...prev, { role: 'user', text, timestamp: Date.now() }]);
    sendViaWS(text);
    if (r.current.phase !== 'idle') syncPhase('processing');
  }

  return {
    phase,
    transcript,
    currentResponse,
    silenceProgress,
    idleCountdown,
    rmsLevelRef,
    agentName,
    startCall,
    hangUp,
    forceListen,
    sendText,
    resetIdle: disarmIdleTimer,
  };
}
