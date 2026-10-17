/* Theme state: Riff's theme system (mode dark/light/auto-from-cover, accent swatch,
   intensity, brightness, palette style) on top of Muse's system/dark/light switch.
   Palette math lives in lib/riff-theme.ts (ported from Riff, MIT). */
import { create } from 'zustand';
import { analyzeCover, buttonAccent, deriveFromCover, generateM3Palette, type Mode, type PaletteStyleKey } from '@/lib/riff-theme';

export type Theme = 'dark' | 'light' | 'system' | 'auto';
export interface ThemePrefs { accent: string; intensity: number; brightness: number; style: PaletteStyleKey; mesh: boolean }
const DEF: ThemePrefs = { accent: '#6750A4', intensity: 0, brightness: 50, style: 'classic', mesh: false };
const load = (): ThemePrefs => { try { return { ...DEF, ...JSON.parse(localStorage.getItem('muse:themePrefs') || '{}') }; } catch { return DEF; } };

let coverSrc = '';
let coverToken = 0;
function paint(mode: Mode, accent: string, intensity: number, brightness: number, style: PaletteStyleKey, accent2?: string) {
  const root = document.documentElement;
  const tokens = generateM3Palette(accent, mode, intensity, brightness, style);
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  const mono = intensity < 8;
  const b = buttonAccent(tokens['--md-sys-color-primary'], mode, mono);
  root.style.setProperty('--btn-primary-bg', b.bg);
  root.style.setProperty('--btn-primary-fg', b.fg);
  root.style.setProperty('--btn-primary-hover', b.hover);
  root.style.setProperty('--mesh-a', mono ? '#9E9E9E' : accent);
  root.style.setProperty('--mesh-b', mono ? '#757575' : accent2 || accent);
  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('intensity-zero', mono);
  root.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens['--md-sys-color-background']);
}
const apply = (t: Theme, p: ThemePrefs) => {
  document.documentElement.classList.toggle('mesh-on', p.mesh);
  if (t === 'auto') {
    const tok = ++coverToken;
    if (!coverSrc) { paint('dark', p.accent, Math.max(p.intensity, 30), p.brightness, p.style); return; }
    void analyzeCover(coverSrc).then((a) => {
      if (tok !== coverToken || useTheme.getState().theme !== 'auto') return;
      const d = deriveFromCover(a);
      paint(d.mode, a.accent, d.intensity, d.brightness, p.style, a.accent2);
    });
    return;
  }
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  paint(dark ? 'dark' : 'light', p.accent, p.intensity, p.brightness, p.style);
};

interface ThemeStore { theme: Theme; prefs: ThemePrefs; setTheme: (t: Theme) => void; setPrefs: (p: Partial<ThemePrefs>) => void }
export const useTheme = create<ThemeStore>((set, get) => ({
  theme: (localStorage.getItem('muse:theme') as Theme) || 'dark',
  prefs: load(),
  setTheme: (t) => { try { localStorage.setItem('muse:theme', t); } catch {} set({ theme: t }); apply(t, get().prefs); },
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    try { localStorage.setItem('muse:themePrefs', JSON.stringify(prefs)); } catch {}
    set({ prefs }); apply(get().theme, prefs);
  },
}));
/** Called by the player when the current track changes (auto/cover theme). */
export function setThemeCover(id?: string) {
  const src = id && /^[\w-]{11}$/.test(id) ? `/api/art?v=${id}` : '';
  if (src === coverSrc) return;
  coverSrc = src;
  const { theme, prefs } = useTheme.getState();
  if (theme === 'auto') apply(theme, prefs);
}
apply(useTheme.getState().theme, useTheme.getState().prefs);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => apply(useTheme.getState().theme, useTheme.getState().prefs));
