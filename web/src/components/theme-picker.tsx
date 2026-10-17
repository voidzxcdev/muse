/* Appearance settings — Riff's theme panel (mode, accent swatches, intensity, brightness,
   palette style, mesh gradient). Riff © 2026 rootscripts, MIT — see THIRD_PARTY_NOTICES.md. */
import * as React from 'react';
import { create } from 'zustand';
import { Check, Disc3, Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type Theme } from '@/hooks/theme';
import { PALETTE_STYLES, SWATCHES, type PaletteStyleKey } from '@/lib/riff-theme';
import { Dialog } from './ui/dialog';
import { Slider } from './riff-ui';

export const useAppearance = create<{ open: boolean; set: (o: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

const MODES: [Theme, any, string][] = [['dark', Moon, 'Тёмная'], ['light', Sun, 'Светлая'], ['system', Monitor, 'Система'], ['auto', Disc3, 'Обложка']];

export function ThemePicker() {
  const { theme, setTheme, prefs, setPrefs } = useTheme();
  const auto = theme === 'auto';
  const mono = prefs.intensity < 8;
  return <div id="themePicker" className="flex flex-col gap-3">
    <div role="radiogroup" aria-label="Тема" className="grid grid-cols-4 gap-1.5">
      {MODES.map(([k, I, l]) => <button key={k} type="button" role="radio" aria-checked={theme === k} onClick={() => setTheme(k)}
        className={cn('flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium transition-[background-color,border-radius] active:rounded-xl',
          theme === k ? 'bg-primary-container text-on-primary-container' : 'bg-surface-high text-muted-foreground')}><I className="size-5" />{l}</button>)}
    </div>
    <div className={cn('flex flex-col gap-3', auto && 'pointer-events-none opacity-50')}>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Акцент">
        <button type="button" role="radio" aria-checked={mono} aria-label="Монохром" onClick={() => setPrefs({ intensity: 0 })}
          className="relative flex size-11 items-center justify-center rounded-full bg-[conic-gradient(#fff_0_50%,#121212_0)] ring-1 ring-outline-variant">{mono && <Check className="size-4 text-[#888]" />}</button>
        {SWATCHES.map((s) => { const on = !mono && prefs.accent.toLowerCase() === s.color.toLowerCase();
          return <button key={s.color} type="button" role="radio" aria-checked={on} aria-label={s.name} onClick={() => setPrefs({ accent: s.color, intensity: prefs.intensity < 8 ? 60 : prefs.intensity })}
            className={cn('flex size-11 items-center justify-center rounded-full transition-[border-radius]', on && 'rounded-xl')} style={{ background: s.color }}>{on && <Check className="size-4 text-black/70" />}</button>; })}
        <label className="relative flex size-11 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" aria-label="Свой цвет">
          <input type="color" value={prefs.accent} onChange={(e) => setPrefs({ accent: e.target.value, intensity: prefs.intensity < 8 ? 60 : prefs.intensity })} className="absolute inset-0 cursor-pointer opacity-0" /></label>
      </div>
      <div><div className="mb-1 flex justify-between text-sm"><span>Насыщенность</span><span className="text-xs tabular-nums text-muted-foreground">{prefs.intensity}%</span></div>
        <Slider label="Насыщенность" value={prefs.intensity} onChange={(v) => setPrefs({ intensity: v })} /></div>
      <div><div className="mb-1 flex justify-between text-sm"><span>Яркость</span><span className="text-xs tabular-nums text-muted-foreground">{prefs.brightness}%</span></div>
        <Slider label="Яркость" min={20} max={80} value={prefs.brightness} onChange={(v) => setPrefs({ brightness: v })} /></div>
    </div>
    <div className="flex flex-wrap gap-1.5">{(Object.keys(PALETTE_STYLES) as PaletteStyleKey[]).map((k) =>
      <button key={k} type="button" onClick={() => setPrefs({ style: k })} className={cn('m3-chip min-h-11', prefs.style === k && 'on')}>{PALETTE_STYLES[k].label}</button>)}</div>
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm"><span>Градиент из обложки на фоне</span>
      <input type="checkbox" checked={prefs.mesh} onChange={(e) => setPrefs({ mesh: e.target.checked })} className="size-5 accent-[var(--md-sys-color-primary)]" /></label>
  </div>;
}

export function AppearanceDialog() {
  const open = useAppearance((s) => s.open);
  const set = useAppearance((s) => s.set);
  return <Dialog open={open} onOpenChange={set} side={matchMedia('(max-width: 767px)').matches ? 'bottom' : 'center'} title="Оформление" className="md:w-[min(480px,94vw)] md:max-w-[480px]">
    <div className="pt-2"><ThemePicker /></div>
  </Dialog>;
}
