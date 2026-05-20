import { useState, useEffect, useMemo } from 'react';

function dateLabel(dateStr) {
  if (!dateStr) return '历史记录';
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const d = new Date(dateStr);
  if (d.toDateString() === today)     return 'Today';
  if (d.toDateString() === yesterday) return 'Yesterday';
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

function groupDates(messages) {
  // returns [{dateStr, count}] newest-first, excluding today
  const counts = new Map();
  const today  = new Date().toDateString();
  messages.forEach(m => {
    if (!m.timestamp) return;
    const d = new Date(m.timestamp).toDateString();
    if (d === today) return;
    counts.set(d, (counts.get(d) || 0) + 1);
  });
  // sort newest first, dedupe pairs → divide by 2
  return [...counts.entries()]
    .sort((a, b) => new Date(b[0]) - new Date(a[0]))
    .map(([dateStr, count]) => ({ dateStr, pairs: Math.max(1, Math.floor(count / 2)) }));
}

export function HistorySidebar({ selectedDate, onSelectDate, collapsed, onToggle, agentName }) {
  const [allMessages, setAllMessages] = useState([]);

  useEffect(() => {
    fetch('/api/history?limit=300')
      .then(r => r.json())
      .then(data => setAllMessages(data.messages || []))
      .catch(() => {});
  }, []);

  const pastDates = useMemo(() => groupDates(allMessages), [allMessages]);
  const todayStr  = new Date().toDateString();
  const isToday   = !selectedDate || selectedDate === todayStr;

  return (
    <aside className={`sidebar-panel${collapsed ? ' sidebar-collapsed' : ''}`}>
      {/* Header */}
      <div className="sidebar-header">
        {!collapsed && (
          <span className="sidebar-brand">{agentName.toUpperCase()}</span>
        )}
        <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? '展开' : '收起'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {collapsed
              ? <path d="M9 18l6-6-6-6" />
              : <path d="M15 18l-6-6 6-6" />}
          </svg>
        </button>
      </div>

      {/* Nav items */}
      <nav className="sidebar-nav">
        {/* Today / live session */}
        <button
          className={`sidebar-day-item${isToday ? ' active' : ''}`}
          onClick={() => onSelectDate(null)}
          title="Today"
        >
          <span className="sidebar-day-dot" />
          {!collapsed && <span className="sidebar-day-label">Today</span>}
        </button>

        {pastDates.length > 0 && !collapsed && (
          <div className="sidebar-section-label">HISTORY</div>
        )}

        {pastDates.map(({ dateStr, pairs }) => (
          <button
            key={dateStr}
            className={`sidebar-day-item${selectedDate === dateStr ? ' active' : ''}`}
            onClick={() => onSelectDate(dateStr)}
            title={dateLabel(dateStr)}
          >
            <span className="sidebar-day-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </span>
            {!collapsed && (
              <>
                <span className="sidebar-day-label">{dateLabel(dateStr)}</span>
                <span className="sidebar-day-count">{pairs}</span>
              </>
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
}

// ── Date list hook ────────────────────────────────────────────────────────────
export function useDateList() {
  const [dates, setDates] = useState([]);
  useEffect(() => {
    fetch('/api/history?limit=300')
      .then(r => r.json())
      .then(data => setDates(groupDates(data.messages || [])))
      .catch(() => {});
  }, []);
  return dates;
}

// ── Horizontal date tab bar ────────────────────────────────────────────────────
export function DateTabBar({ selectedDate, onSelectDate }) {
  const dates  = useDateList();
  const isToday = !selectedDate;

  if (dates.length === 0) return null;

  return (
    <div className="date-tab-bar">
      <button
        className={`date-tab${isToday ? ' active' : ''}`}
        onClick={() => onSelectDate(null)}
      >
        <span className="date-tab-dot" />
        今天
      </button>
      {dates.map(({ dateStr, pairs }) => (
        <button
          key={dateStr}
          className={`date-tab${selectedDate === dateStr ? ' active' : ''}`}
          onClick={() => onSelectDate(dateStr)}
        >
          {dateLabel(dateStr)}
          <span className="date-tab-count">{pairs}</span>
        </button>
      ))}
    </div>
  );
}

// ── Historical messages hook ───────────────────────────────────────────────────
// Fetches and filters messages for a given dateStr
export function useHistoricalMessages(selectedDate) {
  const [msgs, setMsgs] = useState([]);

  useEffect(() => {
    if (!selectedDate) { setMsgs([]); return; }
    fetch('/api/history?limit=300')
      .then(r => r.json())
      .then(data => {
        const filtered = (data.messages || []).filter(m =>
          m.timestamp && new Date(m.timestamp).toDateString() === selectedDate
        );
        setMsgs(filtered);
      })
      .catch(() => {});
  }, [selectedDate]);

  return msgs;
}
