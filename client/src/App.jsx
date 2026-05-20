import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCall } from './hooks/useCall.js';
import { OrbScene } from './components/OrbScene.jsx';
import { Chat } from './components/Chat.jsx';
import { HUD } from './components/HUD.jsx';
import { useHistoricalMessages, DateTabBar } from './components/HistorySidebar.jsx';
import { ThemePicker, applyTheme, getSavedTheme } from './components/ThemePicker.jsx';

export default function App() {
  const {
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
    resetIdle,
  } = useCall();

  const [input, setInput]               = useState('');
  const [orbColor, setOrbColor]         = useState(() => getSavedTheme().primary);
  const [view, setView]                 = useState('orb'); // 'orb' | 'chat'
  const [selectedDate, setSelectedDate] = useState(null);

  const historicalMsgs    = useHistoricalMessages(selectedDate);
  const isViewingHistory  = !!selectedDate;
  const displayTranscript = isViewingHistory ? historicalMsgs : transcript;
  const displayStreaming  = isViewingHistory ? '' : currentResponse;
  const inCall = phase !== 'idle';

  const statusLabel = {
    idle:       '连接中…',
    listening:  '正在聆听…',
    processing: '思考中…',
    responding: `${agentName} 说话中…`,
  }[phase] ?? '';

  useEffect(() => {
    const theme = getSavedTheme();
    applyTheme(theme);
    setOrbColor(theme.primary);
    startCall(); // eslint-disable-line react-hooks/exhaustive-deps
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onOrbClick = () => {
    if (view !== 'orb') return;
    if (phase === 'idle') startCall();
    else forceListen();
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (isViewingHistory) setSelectedDate(null);
    sendText(text);
  };

  const toggleView = () => setView(v => v === 'orb' ? 'chat' : 'orb');

  return (
    <div className="app">
      <HUD phase={phase} agentName={agentName} />

      {/* ── Orb — always rendered, shrinks in chat mode ──────────── */}
      <div
        className={`orb-wrap${view === 'chat' ? ' orb-wrap--compact' : ''}`}
        onClick={onOrbClick}
      >
        <OrbScene phase={phase} rmsLevelRef={rmsLevelRef} orbColor={orbColor} />
        <div className="orb-fade" />

        {/* Full-mode overlay: name + status */}
        <AnimatePresence>
          {view === 'orb' && (
            <motion.div
              className="orb-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="orb-agent-name">{agentName.toUpperCase()}</div>
              <div className="orb-agent-status">{statusLabel}</div>

              <AnimatePresence>
                {phase === 'listening' && silenceProgress > 0 && (
                  <motion.div
                    className="silence-wrap"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="silence-track">
                      <div className="silence-fill" style={{ width: `${silenceProgress * 100}%` }} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Compact-mode: name + status anchored bottom-right */}
        <AnimatePresence>
          {view === 'chat' && (
            <motion.div
              className="orb-compact-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.28, duration: 0.22 }}
            >
              <span className="orb-compact-name">{agentName.toUpperCase()}</span>
              <span className="orb-compact-status">{statusLabel}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Idle-disconnect warning (fixed, overlays everything) ── */}
      <AnimatePresence>
        {idleCountdown > 0 && (
          <motion.div
            className="idle-warning"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
            <span>{idleCountdown}s 后自动断线</span>
            <button className="idle-warning-btn" onClick={resetIdle}>继续通话</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Chat view — appears below compact orb ────────────────── */}
      <AnimatePresence>
        {view === 'chat' && (
          <motion.div
            className="chat-view"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.38, delay: 0.12, ease: [0.4, 0, 0.2, 1] }}
          >
            <DateTabBar selectedDate={selectedDate} onSelectDate={setSelectedDate} />

            <div className="chat-scroll">
              <AnimatePresence>
                {isViewingHistory && (
                  <motion.div
                    className="history-banner"
                    initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <path d="M16 2v4M8 2v4M3 10h18" />
                    </svg>
                    <span>查看历史记录</span>
                    <button className="history-banner-back" onClick={() => setSelectedDate(null)}>返回今天</button>
                  </motion.div>
                )}
              </AnimatePresence>

              <Chat
                transcript={displayTranscript}
                currentResponse={displayStreaming}
                agentName={agentName}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input bar — always pinned at bottom ──────────────────── */}
      <div className="input-bar">
        <form className="text-form" onSubmit={onSubmit}>
          <input
            className="text-input"
            type="text"
            placeholder={isViewingHistory ? '输入将返回今天的对话…' : '输入消息…'}
            value={input}
            onChange={e => setInput(e.target.value)}
            autoComplete="off"
          />
          <button className="btn-send" type="submit">发送</button>
        </form>

        {/* View toggle: chat bubble ↔ globe */}
        <button
          className={`btn-view-toggle${view === 'chat' ? ' btn-view-active' : ''}`}
          onClick={toggleView}
          title={view === 'orb' ? '查看记录' : '返回星球'}
        >
          <AnimatePresence mode="wait" initial={false}>
            {view === 'orb' ? (
              <motion.svg
                key="log"
                width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                initial={{ opacity: 0, rotate: -15 }} animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 15 }} transition={{ duration: 0.15 }}
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </motion.svg>
            ) : (
              <motion.svg
                key="orb"
                width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                initial={{ opacity: 0, rotate: 15 }} animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: -15 }} transition={{ duration: 0.15 }}
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
              </motion.svg>
            )}
          </AnimatePresence>
        </button>

        <AnimatePresence>
          {inCall && (
            <motion.div
              className="call-btns"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.22 }}
            >
              <button className="btn-action btn-listen" onClick={forceListen}>打断</button>
              <button className="btn-action btn-hangup" onClick={hangUp}>挂断</button>
            </motion.div>
          )}
        </AnimatePresence>

        <ThemePicker onThemeChange={setOrbColor} />
      </div>
    </div>
  );
}
