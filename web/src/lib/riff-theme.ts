/*
 * Material 3 palette generator, cover analysis and button-accent helpers.
 * Ported from Riff's app.js (https://github.com/rootscripts/riff, commit 935ae2d):
 * hexToRgb / rgbToHsl / hslToHex, PALETTE_STYLES, generateM3Palette, analyzeCover,
 * computeButtonColors / applyButtonAccent, updateThemeFromState (auto mode derivation).
 * MIT License — Copyright (c) 2026 rootscripts. See THIRD_PARTY_NOTICES.md.
 * Muse changes: typed, DOM-target agnostic, no Riff state object.
 */

export type PaletteStyleKey = 'classic' | 'tonal-spot' | 'expressive' | 'vibrant' | 'neutral';
export type Mode = 'dark' | 'light';

export function hexToRgb(hex: string) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
export function hslToHex(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export const PALETTE_STYLES: Record<PaletteStyleKey, { label: string; secHueShift: number; tertHueShift: number; priSatScale: number; surfSatScale: number; contSatScale: number }> = {
  classic: { label: 'Classic', secHueShift: 0, tertHueShift: 0, priSatScale: 1.0, surfSatScale: 1.0, contSatScale: 1.0 },
  'tonal-spot': { label: 'Tonal spot', secHueShift: 0, tertHueShift: 60, priSatScale: 1.0, surfSatScale: 0.8, contSatScale: 0.9 },
  expressive: { label: 'Expressive', secHueShift: 60, tertHueShift: 120, priSatScale: 1.25, surfSatScale: 1.5, contSatScale: 1.3 },
  vibrant: { label: 'Vibrant', secHueShift: 0, tertHueShift: 60, priSatScale: 1.4, surfSatScale: 1.2, contSatScale: 1.4 },
  neutral: { label: 'Neutral', secHueShift: 0, tertHueShift: 0, priSatScale: 0.35, surfSatScale: 0.2, contSatScale: 0.25 },
};

/** Riff's accent swatches. */
export const SWATCHES = [
  { color: '#B69DF8', name: 'Purple' }, { color: '#7AA7FF', name: 'Blue' }, { color: '#56C5C5', name: 'Teal' },
  { color: '#6DD58C', name: 'Green' }, { color: '#F5B83D', name: 'Amber' }, { color: '#F28B82', name: 'Red' },
  { color: '#F48FB1', name: 'Pink' },
];

/** Returns the --md-sys-color-* token map (Riff's generateM3Palette, minus the DOM writes). */
export function generateM3Palette(hexColor: string, mode: Mode, intensity: number, brightness: number, styleKey: PaletteStyleKey = 'classic') {
  const out: Record<string, string> = {};
  const set = (k: string, v: string) => { out[`--md-sys-color-${k}`] = v; };
  if (!hexColor) hexColor = '#6750A4';
  const rgb = hexToRgb(hexColor); const h = rgbToHsl(rgb.r, rgb.g, rgb.b).h;
  const intensityFactor = (typeof intensity === 'number' ? intensity : 100) / 100;
  const style = PALETTE_STYLES[styleKey] || PALETTE_STYLES.classic;
  const hSec = (h + style.secHueShift) % 360, hTert = (h + style.tertHueShift) % 360;
  const isMonochrome = intensityFactor < 0.08 || (styleKey === 'neutral' && intensityFactor < 0.05);
  const br = (typeof brightness === 'number' ? brightness : 50) / 100;
  if (mode === 'light') {
    const LB = (v: number) => Math.max(0, Math.min(100, Math.round(v + (br - 0.5) * 24)));
    if (isMonochrome) {
      set('primary', '#111111'); set('on-primary', '#FFFFFF');
      set('primary-container', hslToHex(0, 0, LB(90))); set('on-primary-container', '#111111');
      set('secondary', '#444444'); set('secondary-container', hslToHex(0, 0, LB(90))); set('on-secondary-container', '#111111');
      set('tertiary', '#444444'); set('tertiary-container', hslToHex(0, 0, LB(90)));
      set('background', hslToHex(0, 0, LB(99))); set('surface', hslToHex(0, 0, LB(98)));
      set('surface-dim', hslToHex(0, 0, LB(87))); set('surface-bright', hslToHex(0, 0, LB(98)));
      set('surface-container-lowest', hslToHex(0, 0, LB(100))); set('surface-container-low', hslToHex(0, 0, LB(96)));
      set('surface-container', hslToHex(0, 0, LB(94))); set('surface-container-high', hslToHex(0, 0, LB(92)));
      set('surface-container-highest', hslToHex(0, 0, LB(90)));
      set('on-surface', '#111111'); set('on-surface-variant', '#444444'); set('outline', '#777777'); set('outline-variant', '#CFCFCF');
    } else {
      const sat = Math.min(100, Math.round(48 * intensityFactor * style.priSatScale));
      const satHi = Math.min(100, Math.round(80 * intensityFactor * style.contSatScale));
      const satMed = Math.min(100, Math.round(55 * intensityFactor * style.priSatScale));
      const satLow = Math.min(100, Math.round(30 * intensityFactor * style.contSatScale));
      const satLow2 = Math.min(100, Math.round(20 * intensityFactor * style.contSatScale));
      const sf = intensityFactor * style.surfSatScale;
      set('primary', hslToHex(h, sat, 40)); set('on-primary', '#FEFBFF');
      set('primary-container', hslToHex(h, satHi, LB(90))); set('on-primary-container', hslToHex(h, satMed, 18));
      set('secondary', hslToHex(hSec, satLow, 45)); set('secondary-container', hslToHex(hSec, satLow, LB(90))); set('on-secondary-container', hslToHex(hSec, satLow2, 15));
      set('tertiary', hslToHex(hTert, satLow, 45)); set('tertiary-container', hslToHex(hTert, satLow, LB(90)));
      set('background', hslToHex(h, Math.round(5 * sf), LB(99))); set('surface', hslToHex(h, Math.round(6 * sf), LB(98)));
      set('surface-dim', hslToHex(h, Math.round(5 * sf), LB(87))); set('surface-bright', hslToHex(h, Math.round(6 * sf), LB(98)));
      set('surface-container-lowest', hslToHex(h, Math.round(4 * sf), LB(100))); set('surface-container-low', hslToHex(h, Math.round(5 * sf), LB(96)));
      set('surface-container', hslToHex(h, Math.round(6 * sf), LB(94))); set('surface-container-high', hslToHex(h, Math.round(5 * sf), LB(92)));
      set('surface-container-highest', hslToHex(h, Math.round(5 * sf), LB(90)));
      set('on-surface', '#1C1B1F'); set('on-surface-variant', '#49454F'); set('outline', '#79747E'); set('outline-variant', '#CAC4D0');
    }
  } else {
    const B = (v: number) => Math.max(0, Math.min(100, Math.round(v * (br * 2))));
    if (isMonochrome) {
      set('primary', '#FFFFFF'); set('on-primary', '#121212');
      set('primary-container', hslToHex(0, 0, B(24))); set('on-primary-container', '#FFFFFF');
      set('secondary', '#D0D0D0'); set('secondary-container', hslToHex(0, 0, B(24))); set('on-secondary-container', '#FFFFFF');
      set('tertiary', '#D0D0D0'); set('tertiary-container', hslToHex(0, 0, B(24)));
      set('background', hslToHex(0, 0, B(7))); set('surface', hslToHex(0, 0, B(7)));
      set('surface-dim', hslToHex(0, 0, B(7))); set('surface-bright', hslToHex(0, 0, B(19)));
      set('surface-container-lowest', hslToHex(0, 0, B(5))); set('surface-container-low', hslToHex(0, 0, B(10)));
      set('surface-container', hslToHex(0, 0, B(13))); set('surface-container-high', hslToHex(0, 0, B(16)));
      set('surface-container-highest', hslToHex(0, 0, B(20)));
      set('on-surface', '#FFFFFF'); set('on-surface-variant', '#CFCFCF'); set('outline', '#8A8A8A'); set('outline-variant', '#3A3A3A');
    } else {
      const sat = Math.min(100, Math.round(60 * intensityFactor * style.priSatScale));
      const satMed = Math.min(100, Math.round(50 * intensityFactor * style.priSatScale));
      const satLow = Math.min(100, Math.round(15 * intensityFactor * style.contSatScale));
      const satLow2 = Math.min(100, Math.round(30 * intensityFactor * style.contSatScale));
      const sf = intensityFactor * style.surfSatScale;
      const pri = hslToHex(h, sat, 75); const p = hexToRgb(pri);
      set('primary', pri); set('on-primary', hslToHex(h, satMed, 20));
      set('primary-container', `rgba(${p.r}, ${p.g}, ${p.b}, 0.18)`); set('on-primary-container', pri);
      set('secondary', hslToHex(hSec, satLow2, 75)); set('secondary-container', hslToHex(hSec, satLow, 22)); set('on-secondary-container', hslToHex(hSec, satLow2, 85));
      set('tertiary', hslToHex(hTert, satLow2, 75)); set('tertiary-container', hslToHex(hTert, satLow, 22));
      set('background', hslToHex(h, Math.round(5 * sf), B(7))); set('surface', hslToHex(h, Math.round(6 * sf), B(8)));
      set('surface-dim', hslToHex(h, Math.round(5 * sf), B(7))); set('surface-bright', hslToHex(h, Math.round(4 * sf), B(24)));
      set('surface-container-lowest', hslToHex(h, Math.round(5 * sf), B(5))); set('surface-container-low', hslToHex(h, Math.round(5 * sf), B(10)));
      set('surface-container', hslToHex(h, Math.round(6 * sf), B(13))); set('surface-container-high', hslToHex(h, Math.round(5 * sf), B(16)));
      set('surface-container-highest', hslToHex(h, Math.round(5 * sf), B(20)));
      set('on-surface', '#e2e2e9'); set('on-surface-variant', '#c4c6d0'); set('outline', '#8e9099'); set('outline-variant', '#282a33');
    }
  }
  return out;
}

function relLuminance(hex: string) {
  const c = hexToRgb(hex);
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export function computeButtonColors(accentHex: string, mode: Mode) {
  const rgb = hexToRgb(accentHex); const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b); const s = hsl.s;
  const dark = mode === 'dark';
  let l = dark ? Math.min(74, Math.max(52, hsl.l)) : Math.min(46, Math.max(32, hsl.l));
  const lumAt = (L: number) => relLuminance(hslToHex(hsl.h, s, L));
  while (lumAt(l) > 0.42 && l > 26) l -= 1;
  const mid = lumAt(l);
  if (mid > 0.18 && mid < 0.23) { while (lumAt(l) > 0.18 && l > 22) l -= 1; }
  const bg = hslToHex(hsl.h, s, l); const bgLum = relLuminance(bg);
  const darkText = '#1B1B1F';
  const fg = contrastRatio(bgLum, 1) >= contrastRatio(bgLum, relLuminance(darkText)) ? '#FFFFFF' : darkText;
  const hover = hslToHex(hsl.h, s, Math.max(0, Math.min(100, l + (dark ? 5 : -5))));
  return { bg, fg, hover };
}
export function buttonAccent(primary: string, mode: Mode, mono: boolean) {
  if (mono) return mode === 'light' ? { bg: '#111111', fg: '#FFFFFF', hover: '#333333' } : { bg: '#FFFFFF', fg: '#121212', hover: '#E6E6E6' };
  return computeButtonColors(primary.startsWith('#') ? primary : '#6750A4', mode);
}

export interface CoverAnalysis { accent: string; accent2: string; luminance: number; saturation: number }
const FALLBACK: CoverAnalysis = { accent: '#6750A4', accent2: '#9A82DB', luminance: 0.2, saturation: 0.5 };
const cache = new Map<string, CoverAnalysis>();
const hex3 = (r: number, g: number, b: number) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Riff analyzeCover: 48×48 sample, 24 hue bins weighted by saturation. Needs a same-origin
    (or CORS) image — Muse uses /api/art. */
export function analyzeCover(src: string): Promise<CoverAnalysis> {
  return new Promise((resolve) => {
    if (!src) return resolve(FALLBACK);
    const hit = cache.get(src); if (hit) return resolve(hit);
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 48; c.height = 48;
        const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0, 48, 48);
        const data = ctx.getImageData(0, 0, 48, 48).data;
        let totalLum = 0, satSum = 0, satCount = 0, fr = 0, fg = 0, fb = 0;
        const bins = Array.from({ length: 24 }, (_, i) => ({ idx: i, centerHue: (i + 0.5) * 15, weight: 0, r: 0, g: 0, b: 0, count: 0 }));
        const total = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          fr += r; fg += g; fb += b;
          const rN = r / 255, gN = g / 255, bN = b / 255;
          totalLum += 0.2126 * rN + 0.7152 * gN + 0.0722 * bN;
          const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN), d = max - min, l = (max + min) / 2;
          const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
          if (s >= 0.15) {
            satSum += s; satCount++;
            if (l >= 0.1 && l <= 0.9) {
              let hd = 0;
              if (d > 0) hd = max === rN ? ((gN - bN) / d + (gN < bN ? 6 : 0)) * 60 : max === gN ? ((bN - rN) / d + 2) * 60 : ((rN - gN) / d + 4) * 60;
              const bin = bins[Math.min(23, Math.max(0, Math.floor(hd / 15)))];
              bin.weight += s; bin.r += r; bin.g += g; bin.b += b; bin.count++;
            }
          }
        }
        let best: (typeof bins)[number] | null = null;
        for (const b of bins) if (b.count > 0 && (!best || b.weight > best.weight)) best = b;
        let ar: number, ag: number, ab: number;
        if (best) { ar = Math.round(best.r / best.count); ag = Math.round(best.g / best.count); ab = Math.round(best.b / best.count); }
        else { ar = Math.round(fr / total); ag = Math.round(fg / total); ab = Math.round(fb / total); }
        let best2: (typeof bins)[number] | null = null;
        if (best) for (const b of bins) {
          if (b.count > 0 && b.idx !== best.idx) {
            const diff = Math.abs(b.centerHue - best.centerHue);
            if (Math.min(diff, 360 - diff) >= 60 && (!best2 || b.weight > best2.weight)) best2 = b;
          }
        }
        let accent2: string;
        if (best2) accent2 = hex3(Math.round(best2.r / best2.count), Math.round(best2.g / best2.count), Math.round(best2.b / best2.count));
        else { const hs = rgbToHsl(ar, ag, ab); accent2 = hslToHex((hs.h + 40) % 360, hs.s, hs.l); }
        const res = { accent: hex3(ar, ag, ab), accent2, luminance: totalLum / total, saturation: satCount ? satSum / satCount : 0 };
        if (cache.size >= 50) cache.delete(cache.keys().next().value!);
        cache.set(src, res); resolve(res);
      } catch { resolve(FALLBACK); }
    };
    img.onerror = () => resolve(FALLBACK);
    img.src = src;
  });
}

/** Riff updateThemeFromState() auto-mode derivation. */
export function deriveFromCover(a: CoverAnalysis) {
  const mode: Mode = a.luminance > 0.58 ? 'light' : 'dark';
  const intensity = Math.min(85, Math.max(20, Math.round(a.saturation * 100 * 0.9)));
  const brightness = mode === 'dark'
    ? Math.min(60, Math.max(40, Math.round(40 + (Math.min(0.58, a.luminance) / 0.58) * 20)))
    : Math.min(75, Math.max(55, Math.round(55 + Math.max(0, Math.min(1, (a.luminance - 0.58) / 0.42)) * 20)));
  return { mode, intensity, brightness };
}
