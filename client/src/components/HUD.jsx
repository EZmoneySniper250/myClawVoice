import { useState, useEffect } from 'react';

function Clock() {
  const [time, setTime] = useState(() => formatTime());
  useEffect(() => {
    const id = setInterval(() => setTime(formatTime()), 10000);
    return () => clearInterval(id);
  }, []);
  return <>{time}</>;
}

function formatTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function HUD({ phase }) {
  return (
    <div className="hud" aria-hidden="true">
      <div className="hud-corner hud-tl" />
      <div className="hud-corner hud-tr" />
      <div className="hud-corner hud-bl" />
      <div className="hud-corner hud-br" />

      <div className="hud-readout hud-tl-text">
        <div>SYS · ONLINE</div>
        <div>CONN · SECURE</div>
      </div>

      <div className="hud-readout hud-tr-text">
        <div>OCT · v2.1</div>
        <div><Clock /></div>
      </div>
    </div>
  );
}
