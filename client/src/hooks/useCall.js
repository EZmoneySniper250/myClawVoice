import { useState, useRef, useEffect } from 'react';

const VOICE_THRESHOLD     = 0.015;
const INTERRUPT_THRESHOLD = 0.05;   // higher bar to interrupt October
const INTERRUPT_TICKS     = 3;      // must sustain for 3 × 80ms = 240ms
const SILENCE_MS      = 3000;   // 3s silence → auto-submit
const VAD_INTERVAL_MS = 80;
const MIN_AUDIO_BYTES = 2048;

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
  // ── React state (drives UI re-renders) ──────────────────────────────────
  const [phase, setPhase]               = useState('idle');
  const [transcript, setTranscript]     = useState([]);
  const [currentResponse, setCurrent]   = useState('');
  const [silenceProgress, setSilence]   = useState(0);

  // ── Single mutable ref bucket (safe in async callbacks via r.current) ──
  const r = useRef({
    phase:            'idle',
    micStream:        null,
    audioCtx:         null,
    analyser:         null,
    vadData:          null,
    freqData:         null,
    recorder:         null,
    chunks:           [],
    hasCaptured:      false,
    lastVoiceTime:    0,
    ws:               null,
    nextPlayTime:     0,
    activeSources:    [],
    vadTimer:         null,
    ttsMode:          'mock',
    interruptCount:   0,
  });

  // Exposed to OrbScene for animation — updated in VAD, never triggers re-renders
  const rmsLevelRef = useRef(0);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function syncPhase(p) {
    r.current.phase = p;
    setPhase(p);
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

  function scheduleReturnToListening() {
    const ctx = r.current.audioCtx;
    const remainingMs = ctx ? Math.max(0, r.current.nextPlayTime - ctx.currentTime) * 1000 : 0;
    setTimeout(() => {
      if (r.current.phase !== 'idle') {
        syncPhase('listening');
        initRecorder();
      }
    }, remainingMs + 300);
  }

  // ── Recorder ─────────────────────────────────────────────────────────────
  function initRecorder() {
    r.current.chunks       = [];
    r.current.hasCaptured  = false;
    r.current.lastVoiceTime = 0;
    setSilence(0);

    if (!r.current.micStream) return;

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(r.current.micStream, mimeType ? { mimeType } : {});
    r.current.recorder = recorder;

    recorder.ondataavailable = (e) => { if (e.data.size) r.current.chunks.push(e.data); };

    recorder.onstop = async () => {
      const { hasCaptured, chunks, phase: p } = r.current;
      if (!hasCaptured || p === 'idle') {
        if (p === 'listening') initRecorder();
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < MIN_AUDIO_BYTES) {
        if (r.current.phase !== 'idle') initRecorder();
        return;
      }
      await submitAudio(blob);
    };
  }

  // ── VAD ───────────────────────────────────────────────────────────────────
  function startVAD() {
    r.current.vadTimer = setInterval(() => {
      const { analyser, vadData, phase: p, recorder, hasCaptured, lastVoiceTime } = r.current;
      if (!analyser || p === 'idle' || p === 'processing') {
        rmsLevelRef.current = 0;
        return;
      }

      analyser.getByteTimeDomainData(vadData);
      const rms = calcRms(vadData);
      rmsLevelRef.current = rms;

      // Interrupt October only after sustained speech (3 ticks × 80ms = 240ms above threshold)
      if (p === 'responding') {
        if (rms > INTERRUPT_THRESHOLD) {
          r.current.interruptCount += 1;
          if (r.current.interruptCount >= INTERRUPT_TICKS) {
            r.current.interruptCount = 0;
            stopPlayback();
            syncPhase('listening');
            initRecorder();
            if (r.current.recorder?.state === 'inactive') {
              r.current.recorder.start(200);
              r.current.hasCaptured   = true;
              r.current.lastVoiceTime = Date.now();
            }
          }
        } else {
          r.current.interruptCount = 0;
        }
        return;
      }

      if (rms > VOICE_THRESHOLD) {
        if (recorder?.state === 'inactive') recorder.start(200);
        r.current.hasCaptured    = true;
        r.current.lastVoiceTime  = Date.now();
        setSilence(0);
      } else if (hasCaptured && recorder?.state === 'recording') {
        const elapsed   = Date.now() - lastVoiceTime;
        const progress  = elapsed / SILENCE_MS;
        setSilence(Math.min(progress, 1));

        if (elapsed >= SILENCE_MS) {
          setSilence(0);
          recorder.requestData();
          recorder.stop();
        }
      }
    }, VAD_INTERVAL_MS);
  }

  // ── Audio submit → STT → LLM ─────────────────────────────────────────────
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

      setTranscript(prev => [...prev, { role: 'user', text }]);
      sendViaWS(text);
    } catch (err) {
      console.error('STT error:', err);
      if (r.current.phase !== 'idle') { syncPhase('listening'); initRecorder(); }
    }
  }

  function sendViaWS(text) {
    const ws = r.current.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    setCurrent('');
    resetAudioQueue();
    ws.send(JSON.stringify({ type: 'chat_text', text }));
  }

  // ── WebSocket (always connected for text chat) ────────────────────────────
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
          r.current.ttsMode = msg.ttsMode || 'mock';
        }
        else if (msg.type === 'history') {
          // Restore persisted chat history on connect
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
          scheduleReturnToListening();
        }
        else if (msg.type === 'chat_done') {
          const answer = msg.answer || '';
          setTranscript(prev => [...prev, { role: 'october', text: answer }]);
          setCurrent('');

          if (r.current.ttsMode !== 'doubao' && r.current.ttsMode !== 'elevenlabs') {
            speakFallback(answer);
            const roughMs = answer.length * 75;
            setTimeout(() => {
              if (r.current.phase !== 'idle') { syncPhase('listening'); initRecorder(); }
            }, roughMs + 400);
          } else {
            scheduleReturnToListening();
          }
        }
        else if (msg.type === 'error' || msg.type === 'tts_error') {
          if (r.current.phase !== 'idle') { syncPhase('listening'); initRecorder(); }
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

  // ── Public API ────────────────────────────────────────────────────────────
  async function startCall() {
    if (r.current.micStream) return;       // already in a call
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
    r.current.vadData  = new Uint8Array(analyser.frequencyBinCount);

    initRecorder();
    startVAD();
    syncPhase('listening');
  }

  function hangUp() {
    clearInterval(r.current.vadTimer);
    stopPlayback();

    if (r.current.recorder?.state === 'recording') r.current.recorder.stop();
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

  function forceListen() {
    stopPlayback();
    if (r.current.hasCaptured && r.current.recorder?.state === 'recording') {
      r.current.recorder.requestData();
      r.current.recorder.stop();
    } else {
      syncPhase('listening');
      initRecorder();
    }
  }

  function sendText(text) {
    if (!text.trim()) return;
    setTranscript(prev => [...prev, { role: 'user', text }]);
    sendViaWS(text);
    if (r.current.phase !== 'idle') syncPhase('processing');
  }

  return {
    phase,
    transcript,
    currentResponse,
    silenceProgress,
    rmsLevelRef,
    startCall,
    hangUp,
    forceListen,
    sendText,
  };
}
