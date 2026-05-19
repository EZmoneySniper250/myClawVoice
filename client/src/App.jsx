import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCall } from './hooks/useCall.js';
import { OrbScene } from './components/OrbScene.jsx';
import { Chat } from './components/Chat.jsx';
import { HUD } from './components/HUD.jsx';
import { ThemePicker, applyTheme, getSavedTheme } from './components/ThemePicker.jsx';

const STATUS_LABELS = {
  idle:       '连接中…',
  listening:  '正在聆听…',
  processing: '思考中…',
  responding: 'October 说话中…',
};

export default function App() {
  const {
    phase,
    transcript,
    currentResponse,
    silenceProgress,
    rmsLevelRef,
    startCall,
    hangUp,
    forceListen,
    sendText,
  } = useCall();

  const [input, setInput]       = useState('');
  const [orbColor, setOrbColor] = useState(() => getSavedTheme().primary);
  const inCall = phase !== 'idle';

  // Apply saved theme + auto-start call on mount
  useEffect(() => {
    const theme = getSavedTheme();
    applyTheme(theme);
    setOrbColor(theme.primary);
    startCall(); // eslint-disable-line react-hooks/exhaustive-deps
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onOrbClick = () => {
    if (phase === 'idle') startCall();
    else forceListen();
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendText(text);
  };

  return (
    <div className="app">
      <HUD phase={phase} />

      <div className="orb-section">
        <OrbScene
          phase={phase}
          rmsLevelRef={rmsLevelRef}
          onOrbClick={onOrbClick}
          orbColor={orbColor}
        />
      </div>

      <div className="info-section">
        <div className="orb-name">OCTOBER</div>
        <div className="orb-status">{STATUS_LABELS[phase]}</div>

        <AnimatePresence>
          {phase === 'listening' && silenceProgress > 0 && (
            <motion.div
              className="silence-wrap"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="silence-track">
                <div className="silence-fill" style={{ width: `${silenceProgress * 100}%` }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Chat transcript={transcript} currentResponse={currentResponse} />

      <div className="input-bar">
        <form className="text-form" onSubmit={onSubmit}>
          <input
            className="text-input"
            type="text"
            placeholder="输入消息…"
            value={input}
            onChange={e => setInput(e.target.value)}
            autoComplete="off"
          />
          <button className="btn-send" type="submit">发送</button>
        </form>

        <AnimatePresence>
          {inCall && (
            <motion.div
              className="call-btns"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.22 }}
            >
              <button className="btn-action btn-listen" onClick={forceListen}>打断她</button>
              <button className="btn-action btn-hangup" onClick={hangUp}>挂断</button>
            </motion.div>
          )}
        </AnimatePresence>

        <ThemePicker onThemeChange={setOrbColor} />
      </div>
    </div>
  );
}
