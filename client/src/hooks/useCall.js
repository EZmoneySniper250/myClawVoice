import { useState, useRef, useEffect } from 'react';

const VOICE_THRESHOLD = 0.025;
const SILENCE_MS      = 1600;   // silence before auto-submit
const VAD_INTERVAL_MS = 80;
const MIN_AUDIO_BYTES = 2048;
const MAX_RECORDING_MS = 12000;

// 鈹€鈹€ Auto-disconnect constants 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 min of no user speech after October finishes
const IDLE_WARN_S     = 30;             // show countdown for last 30 s

// Phrases that immediately hang up (checked after STT, before sending to LLM)
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
  // 鈹€鈹€ React state (drives UI re-renders) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const [phase, setPhase]               = useState('idle');
  const [transcript, setTranscript]     = useState([]);
  const [currentResponse, setCurrent]   = useState('');
  const [silenceProgress, setSilence]   = useState(0);
  const [agentName, setAgentName]       = useState('October');
  const [idleCountdown, setIdleCountdown] = useState(0); // >0 = warning active

  // 鈹€鈹€ Single mutable ref bucket (safe in async callbacks via r.current) 鈹€鈹€
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
    voiceStartedAt:   0,
    ws:               null,
    nextPlayTime:     0,
    activeSources:    [],
    vadTimer:         null,
    preRoll:          [],   // circular pre-VAD audio buffer
    ttsMode:          'mock',
    agentName:        'October',
    idleTimer:        null,
    idleWarnTimer:    null,
    idleCountInterval: null,
    returnGen:        0,   // incremented on each new turn; stale timers check this
  });

  // Exposed to OrbScene for animation 鈥?updated in VAD, never triggers re-renders
  const rmsLevelRef = useRef(0);

  // 鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  function syncPhase(p) {
    r.current.phase = p;
    setPhase(p);
  }

  // 鈹€鈹€ Idle-disconnect timer 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
      // Start the 30-second visible countdown
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

  function scheduleReturnToListening() {
    const gen = ++r.current.returnGen; // capture current generation
    const ctx = r.current.audioCtx;
    const remainingMs = ctx ? Math.max(0, r.current.nextPlayTime - ctx.currentTime) * 1000 : 0;
    setTimeout(() => {
      if (r.current.phase !== 'idle' && r.current.returnGen === gen) {
        syncPhase('listening');
        initRecorder();
        armIdleTimer();
      }
    }, remainingMs + 300);
  }

  // 鈹€鈹€ Recorder 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  function initRecorder() {
    r.current.chunks        = [];
    r.current.preRoll       = [];   // circular 3-chunk buffer (~600ms pre-VAD audio)
    r.current.hasCaptured   = false;
    r.current.lastVoiceTime = 0;
    r.current.voiceStartedAt = 0;
    setSilence(0);

    if (!r.current.micStream) return;

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(r.current.micStream, mimeType ? { mimeType } : {});
    r.current.recorder = recorder;

    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      if (r.current.hasCaptured) {
        // Voice detected 鈥?accumulate real speech chunks
        r.current.chunks.push(e.data);
      } else {
        // No voice yet 鈥?maintain rolling pre-roll (keep last 3 chunks 鈮?600ms)
        r.current.preRoll.push(e.data);
        if (r.current.preRoll.length > 3) r.current.preRoll.shift();
      }
    };

    recorder.onstop = async () => {
      const { hasCaptured, preRoll, chunks, phase: p } = r.current;
      if (!hasCaptured || p === 'idle') {
        if (p === 'listening') initRecorder();
        return;
      }
      // Prepend pre-roll so Whisper gets a clean lead-in to the first word
      const blob = new Blob([...preRoll, ...chunks], { type: recorder.mimeType || 'audio/webm' });
      r.current.preRoll = [];
      if (blob.size < MIN_AUDIO_BYTES) {
        if (r.current.phase !== 'idle') {
          syncPhase('listening');
          initRecorder();
        }
        return;
      }
      await submitAudio(blob);
    };

    // Start immediately 鈥?collect pre-roll before the user begins speaking
    recorder.start(200);
  }

  // 鈹€鈹€ VAD 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

      // During responding, wait for playback to finish — manual interrupt only
      if (p === 'responding') return;

      if (rms > VOICE_THRESHOLD) {
        // Recorder already running from initRecorder() 鈥?just mark voice detected
        if (!r.current.hasCaptured) r.current.returnGen++; // cancel stale return-to-listening timer
        r.current.hasCaptured    = true;
        if (!r.current.voiceStartedAt) r.current.voiceStartedAt = Date.now();
        r.current.lastVoiceTime  = Date.now();
        setSilence(0);
        disarmIdleTimer(); // user is speaking - cancel auto-disconnect
        if (Date.now() - r.current.voiceStartedAt >= MAX_RECORDING_MS && recorder?.state === 'recording') {
          submitCurrentRecording();
        }
      } else if (hasCaptured && recorder?.state === 'recording') {
        const elapsed   = Date.now() - lastVoiceTime;
        const recordingElapsed = r.current.voiceStartedAt ? Date.now() - r.current.voiceStartedAt : 0;
        const progress  = elapsed / SILENCE_MS;
        setSilence(Math.min(progress, 1));

        if (elapsed >= SILENCE_MS || recordingElapsed >= MAX_RECORDING_MS) submitCurrentRecording();
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


  // 鈹€鈹€ Audio submit 鈫?STT 鈫?LLM 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
    r.current.returnGen++; // cancel any pending return-to-listening from previous turn
    setCurrent('');
    resetAudioQueue();
    ws.send(JSON.stringify({ type: 'chat_text', text }));
  }

  // 鈹€鈹€ WebSocket (always connected for text chat) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
          setTranscript(prev => [...prev, { role: r.current.agentName.toLowerCase(), text: answer, timestamp: Date.now() }]);
          setCurrent('');

          if (r.current.ttsMode !== 'doubao' && r.current.ttsMode !== 'elevenlabs') {
            speakFallback(answer);
            const roughMs = answer.length * 75;
            const gen = ++r.current.returnGen;
            setTimeout(() => {
              if (r.current.phase !== 'idle' && r.current.returnGen === gen) {
                syncPhase('listening');
                initRecorder();
                armIdleTimer();
              }
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

  // 鈹€鈹€ Public API 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
    disarmIdleTimer();
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

  function sendInterrupt() {
    const ws = r.current.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'interrupt' }));
    }
  }

  function forceListen() {
    r.current.returnGen++; // cancel pending return-to-listening
    sendInterrupt();
    stopPlayback();
    if (r.current.hasCaptured && r.current.recorder?.state === 'recording') {
      submitCurrentRecording();
    } else {
      syncPhase('listening');
      initRecorder();
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





