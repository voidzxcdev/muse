/*
 * Riff UI primitives: squiggly progress scrubber, M3 expressive slider, mini analyser
 * visualizer. Ported from Riff's app.js (startVisualizers / resizeCanvases / enhanceSliders)
 * and styles.css (https://github.com/rootscripts/riff, commit 935ae2d).
 * MIT License — Copyright (c) 2026 rootscripts. See THIRD_PARTY_NOTICES.md.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { engine, getAudio, usePlayer } from '@/player/store';

const cssVar = (name: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;

/** Riff's wavy scrubber. `dragRatio` (0..1 or null) comes from the host's pointer handling. */
export function SquiggleCanvas({ dragRatio, flat }: { dragRatio: number | null; flat?: boolean }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const drag = React.useRef<number | null>(dragRatio);
  drag.current = dragRatio;
  const playing = usePlayer((s) => s.playing);
  const kick = React.useRef<() => void>(() => {});
  React.useEffect(() => { kick.current(); }, [playing, dragRatio]);
  React.useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d')!;
    let w = 0, h = 0, raf = 0, last = 0, progress = -1, phase = 0, knobAnim = 0, prevX: number | null = null, idleDrawn = false;
    let primary = '', dim = '';
    const colors = () => { primary = cssVar('--md-sys-color-primary', '#fff'); dim = cssVar('--md-sys-color-surface-container-highest', '#333'); };
    const size = () => {
      const r = c.parentElement!.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height; c.width = Math.max(1, w * dpr); c.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); idleDrawn = false; colors();
    };
    const ro = new ResizeObserver(() => { size(); start(); }); ro.observe(c.parentElement!);
    const mo = new MutationObserver(() => { colors(); idleDrawn = false; start(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    function frame(ts: number) {
      const st = usePlayer.getState(); const a = getAudio();
      const dragging = drag.current != null;
      const isPlaying = st.playing && !a.paused;
      if (!isPlaying && !dragging && idleDrawn && Math.abs(knobAnim) < 0.01) { raf = 0; return; }
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = last === 0 ? 0.016 : Math.min((ts - last) / 1000, 0.1); last = ts;
      const dur = a.duration && isFinite(a.duration) ? a.duration : st.duration || 0;
      const cur = dragging ? drag.current! * dur : a.currentTime || 0;
      const target = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
      if (progress < 0 || Math.abs(target - progress) > 0.2) progress = target;
      progress += (target - progress) * Math.min(1, dt * (dragging ? 32 : 45));
      knobAnim += ((dragging ? 1 : 0) - knobAnim) * Math.min(1, dt * 16);
      const small = h < 36;
      const kW = (small ? 5 : 7.5) + 1.5 * knobAnim, kH = (small ? 18 : 24) + 8 * knobAnim, kR = kW / 2;
      const lineA = small ? 7 : 9.5, lineI = small ? 8 : 11, amp = flat || reduce.matches ? 0 : small ? 3.5 : 5;
      const pad = lineA / 2 + 1, tw = w - pad * 2, kx = pad + progress * tw;
      if (prevX === null) prevX = kx;
      const dx = kx - prevX; prevX = kx;
      const k = (2 * Math.PI) / 42;
      if (dragging) phase += dx * k; else if (isPlaying) phase += 3.5 * dt;
      const cy = h / 2, kl = kx - kW / 2, ws = pad, we = kl - 4.5 - lineA / 2, is = kx + kW / 2 + 4, ie = w - pad;
      ctx.clearRect(0, 0, w, h);
      if (ie > is) { ctx.beginPath(); ctx.lineWidth = lineI; ctx.lineCap = 'round'; ctx.strokeStyle = dim; ctx.moveTo(is, cy); ctx.lineTo(ie, cy); ctx.stroke(); }
      if (we > ws) {
        ctx.beginPath(); ctx.lineWidth = lineA; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = primary;
        if (!amp) { ctx.moveTo(ws, cy); ctx.lineTo(we, cy); }
        else { for (let x = ws; x <= we; x += 2) { const y = cy + Math.sin(phase - (we - x) * k) * amp; if (x === ws) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.lineTo(we, cy + Math.sin(phase) * amp); }
        ctx.stroke();
      }
      ctx.beginPath(); (ctx as any).roundRect ? ctx.roundRect(kl, cy - kH / 2, kW, kH, kR) : ctx.rect(kl, cy - kH / 2, kW, kH); ctx.fillStyle = primary; ctx.fill();
      idleDrawn = !isPlaying && !dragging;
    }
    const start = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
    kick.current = () => { idleDrawn = false; start(); };
    const unsub = usePlayer.subscribe((s, p) => { if (s.time !== p.time || s.current !== p.current) { idleDrawn = false; start(); } });
    const vis = () => { if (!document.hidden) start(); };
    document.addEventListener('visibilitychange', vis);
    size(); start();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); unsub(); document.removeEventListener('visibilitychange', vis); };
  }, [flat]);
  return <canvas ref={ref} aria-hidden />;
}

/** Riff .sl slider around a native range input (keeps ids/keyboard/AT semantics). */
export function Slider({ value, min = 0, max = 100, step = 1, onChange, id, label, className, thin, disabled, title }: {
  value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; id?: string; label: string; className?: string; thin?: boolean; disabled?: boolean; title?: string;
}) {
  const v = max > min ? (value - min) / (max - min) : 0;
  return <div className={cn('sl', thin && 'sl-thin', disabled && 'is-disabled', className)} style={{ ['--v' as any]: v }}>
    <div className="sl-active" /><div className="sl-inactive" />
    <input id={id} type="range" min={min} max={max} step={step} value={value} aria-label={label} title={title} disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))} onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))} />
  </div>;
}

/** Riff mini visualizer: 12 bars from the engine analyser (only when Web Audio is routed). */
export function MiniViz({ className }: { className?: string }) {
  const routed = usePlayer((s) => s.routed);
  const playing = usePlayer((s) => s.playing);
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    if (!routed || !playing) return;
    const c = ref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1); c.width = 60 * dpr; c.height = 24 * dpr;
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    engine.setAnalyserEnabled(true);
    const an = engine.getAnalyserNode(); if (!an) return;
    const buf = new Uint8Array(new ArrayBuffer(an.frequencyBinCount));
    const color = cssVar('--md-sys-color-primary', '#fff');
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      engine.getFrequencyData(buf); ctx.clearRect(0, 0, 60, 24); ctx.fillStyle = color;
      for (let i = 0; i < 12; i++) { let bh = ((buf[i * 2] || 0) / 255) * 20; if (bh < 2) bh = 2; ctx.beginPath(); (ctx as any).roundRect ? ctx.roundRect(3 + i * 5, 24 - bh, 3, bh, 2) : ctx.rect(3 + i * 5, 24 - bh, 3, bh); ctx.fill(); }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); engine.setAnalyserEnabled(false); ctx.clearRect(0, 0, 60, 24); };
  }, [routed, playing]);
  if (!routed) return null;
  return <canvas ref={ref} aria-hidden className={cn('h-6 w-[60px] shrink-0', className)} />;
}
