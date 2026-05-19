import { useState, useEffect, useRef } from 'react';

// ── Color grid ────────────────────────────────────────────────────────────────
const PALETTE = [
  '#00e5ff','#00b4d8','#0ea5e9','#3b82f6','#6366f1','#818cf8',
  '#a855f7','#c084fc','#d946ef','#ec4899','#f472b6','#fb7185',
  '#f43f5e','#ef4444','#f97316','#fb923c','#fbbf24','#facc15',
  '#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#34d399',
  '#94a3b8','#cbd5e1','#e2e8f0','#f8fafc','#d4a574','#ffb347',
];

// ── HSL helpers ───────────────────────────────────────────────────────────────
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255;
  let g = parseInt(hex.slice(3,5),16)/255;
  let b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g-b)/d + (g<b?6:0)) / 6; break;
      case g: h = ((b-r)/d + 2) / 6; break;
      case b: h = ((r-g)/d + 4) / 6; break;
    }
  }
  return [h*360, s*100, l*100];
}

function hslToHex(h, s, l) {
  h/=360; s/=100; l/=100;
  const hue2rgb = (p,q,t) => {
    if(t<0)t+=1; if(t>1)t-=1;
    if(t<1/6) return p+(q-p)*6*t;
    if(t<1/2) return q;
    if(t<2/3) return p+(q-p)*(2/3-t)*6;
    return p;
  };
  let r,g,b;
  if(s===0){ r=g=b=l; } else {
    const q = l<0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
    r = hue2rgb(p,q,h+1/3);
    g = hue2rgb(p,q,h);
    b = hue2rgb(p,q,h-1/3);
  }
  const x = v => Math.round(v*255).toString(16).padStart(2,'0');
  return `#${x(r)}${x(g)}${x(b)}`;
}

// Derive all CSS vars from a single primary hex color
function deriveTheme(hex) {
  const [h, s, l] = hexToHsl(hex);
  const clamp = (v,lo,hi) => Math.max(lo, Math.min(hi, v));
  return {
    '--cyan':       hex,
    '--cyan-mid':   hslToHex(h, s,                  clamp(l-18, 8, 80)),
    '--cyan-deep':  hslToHex(h, clamp(s-10,20,100), clamp(l-42, 4, 40)),
    '--cyan-dark':  hslToHex(h, clamp(s-30,8,100),  clamp(l-56, 2, 20)),
    '--text':       hslToHex(h, clamp(s-35,12,60),  clamp(l+22, 60, 92)),
    '--text-muted': hslToHex(h, clamp(s-45,10,50),  clamp(l-22, 16, 50)),
  };
}

// ── Public helpers (used by App.jsx) ─────────────────────────────────────────
export function applyTheme(theme) {
  const root = document.documentElement;
  Object.entries(theme.css).forEach(([k,v]) => root.style.setProperty(k,v));
  localStorage.setItem('myvoice-color', theme.primary);
}

export function getSavedTheme() {
  const hex = localStorage.getItem('myvoice-color') ?? '#00e5ff';
  return { primary: hex, css: deriveTheme(hex) };
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ThemePicker({ onThemeChange }) {
  const [open, setOpen]       = useState(false);
  const [active, setActive]   = useState(() => getSavedTheme().primary);
  const panelRef              = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!panelRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function pick(hex) {
    const theme = { primary: hex, css: deriveTheme(hex) };
    applyTheme(theme);
    setActive(hex);
    onThemeChange(hex);
  }

  return (
    <div className="theme-picker" ref={panelRef}>
      <button
        className="theme-trigger"
        onClick={() => setOpen(o => !o)}
        title="颜色"
        style={{ '--active-color': active }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5"  r=".5" fill="currentColor"/>
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
          <circle cx="8.5"  cy="7.5"  r=".5" fill="currentColor"/>
          <circle cx="6.5"  cy="12.5" r=".5" fill="currentColor"/>
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
        </svg>
      </button>

      {open && (
        <div className="theme-panel">
          <div className="theme-panel-label">COLOR</div>
          <div className="theme-grid">
            {PALETTE.map(hex => (
              <button
                key={hex}
                className={`theme-dot ${hex === active ? 'active' : ''}`}
                style={{ '--sw': hex }}
                onClick={() => pick(hex)}
                title={hex}
              />
            ))}
          </div>
          <div className="theme-custom-row">
            <span className="theme-panel-label">CUSTOM</span>
            <input
              type="color"
              className="theme-custom-input"
              value={active.length === 7 ? active : '#00e5ff'}
              onChange={e => pick(e.target.value)}
              title="自定义颜色"
            />
          </div>
        </div>
      )}
    </div>
  );
}
