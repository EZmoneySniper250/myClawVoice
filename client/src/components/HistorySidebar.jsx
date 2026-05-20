import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

function dateLabel(dateStr) {
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const d = new Date(dateStr);
  if (d.toDateString() === today)     return 'TODAY';
  if (d.toDateString() === yesterday) return 'YESTERDAY';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

function groupByDate(messages) {
  const groups = new Map();
  messages.forEach(msg => {
    const key = msg.timestamp ? new Date(msg.timestamp).toDateString() : 'HISTORY';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(msg);
  });
  return groups;
}

function toPairs(messages) {
  const pairs = [];
  let i = 0;
  while (i < messages.length) {
    if (messages[i]?.role === 'user') {
      const next = messages[i + 1];
      pairs.push({ user: messages[i], agent: next?.role !== 'user' ? next : null });
      i += next?.role !== 'user' ? 2 : 1;
    } else {
      i++;
    }
  }
  return pairs;
}

function truncate(text, n = 72) {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

export function HistorySidebar({ open, onClose, agentName }) {
  const [messages, setMessages]       = useState([]);
  const [expandedDates, setExpanded]  = useState(new Set());
  const [loading, setLoading]         = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/history?limit=300')
      .then(r => r.json())
      .then(data => {
        const msgs = data.messages || [];
        setMessages(msgs);
        // auto-expand the most recent date
        if (msgs.length) {
          const groups = groupByDate(msgs);
          const keys   = [...groups.keys()];
          setExpanded(new Set([keys[keys.length - 1]]));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  const groups   = useMemo(() => groupByDate(messages), [messages]);
  const dateKeys = useMemo(() => [...groups.keys()].reverse(), [groups]); // newest first

  function toggle(date) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            className="history-sidebar"
            initial={{ x: -272 }}
            animate={{ x: 0 }}
            exit={{ x: -272 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            <div className="sidebar-header">
              <span className="sidebar-title">ARCHIVE</span>
              <button className="sidebar-close" onClick={onClose} title="关闭">✕</button>
            </div>

            <div className="sidebar-body">
              {loading && <div className="sidebar-empty">加载中…</div>}

              {!loading && dateKeys.length === 0 && (
                <div className="sidebar-empty">暂无历史记录</div>
              )}

              {dateKeys.map(date => {
                const msgs    = groups.get(date) || [];
                const pairs   = toPairs(msgs);
                const expanded = expandedDates.has(date);

                return (
                  <div key={date} className="sidebar-date-group">
                    <button
                      className={`sidebar-date-btn ${expanded ? 'expanded' : ''}`}
                      onClick={() => toggle(date)}
                    >
                      <span className="sidebar-date-label">
                        {date === 'HISTORY' ? '历史记录' : dateLabel(date)}
                      </span>
                      <span className="sidebar-date-count">{pairs.length}</span>
                      <svg
                        className="sidebar-chevron"
                        width="10" height="10" viewBox="0 0 10 10"
                        fill="none" stroke="currentColor" strokeWidth="1.5"
                      >
                        <path d={expanded ? 'M1 7 L5 3 L9 7' : 'M1 3 L5 7 L9 3'} />
                      </svg>
                    </button>

                    <AnimatePresence initial={false}>
                      {expanded && (
                        <motion.div
                          key="content"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: 'easeInOut' }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div className="sidebar-pairs">
                            {pairs.map((pair, i) => (
                              <div key={i} className="sidebar-pair">
                                {pair.user && (
                                  <div className="sidebar-msg sidebar-msg-user">
                                    {truncate(pair.user.text)}
                                  </div>
                                )}
                                {pair.agent && (
                                  <div className="sidebar-msg sidebar-msg-agent">
                                    {truncate(pair.agent.text)}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
