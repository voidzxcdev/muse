/*
 * "Звук" panel — Riff's audio settings modal (index.html #audio-menu: Enhancer /
 * Speed & Pitch / Audio FX / Equalizer + crossfade), rebuilt in React for Muse.
 * Layout/labels adapted from Riff (https://github.com/rootscripts/riff, MIT © 2026 rootscripts).
 */
import * as React from 'react';
import { create } from 'zustand';
import { AudioLines, Gauge, Moon, RotateCcw, Sparkles, SlidersVertical, Waves, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EQ_BAND_FREQS, type HqEngine } from '@/player/riff-engine';
import { FX_MODES, engineSupported, usePlayer } from '@/player/store';
import { Dialog } from './ui/dialog';
import { Slider } from './riff-ui';

export const useSoundPanel = create<{ open: boolean; set: (o: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));

type Tab = 'presets' | 'enhancer' | 'speed' | 'fx' | 'eq';
const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'presets', label: 'Пресеты', icon: Wand2 },
  { id: 'enhancer', label: 'Улучшение', icon: Sparkles },
  { id: 'speed', label: 'Скорость и тон', icon: Gauge },
  { id: 'fx', label: 'Эффекты', icon: Waves },
  { id: 'eq', label: 'Эквалайзер', icon: SlidersVertical },
];
const HQ_ENGINES: { id: HqEngine; label: string }[] = [
  { id: 'hqmusic-3', label: 'hqmusic-3 · Harmonic Restorer' },
  { id: 'glyphs-7B', label: 'glyphs-7B · High-End Upscaler' },
  { id: 'fyro1.1', label: 'fyro1.1 · Dynamic Depth' },
];

function Row({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5 py-2">
    <div className="flex items-center justify-between text-sm"><span className="font-medium">{label}</span>{value != null && <span className="font-mono text-xs tabular-nums text-muted-foreground">{value}</span>}</div>
    {children}
  </div>;
}

export function SoundPanel() {
  const open = useSoundPanel((s) => s.open);
  const setOpen = useSoundPanel((s) => s.set);
  const sound = usePlayer((s) => s.sound);
  const fx = usePlayer((s) => s.fx);
  const sleep = usePlayer((s) => s.sleepMins);
  const routed = usePlayer((s) => s.routed);
  const setSound = usePlayer((s) => s.setSound);
  const [tab, setTab] = React.useState<Tab>('presets');
  const webAudio = engineSupported();
  const a = sound.settings;
  const needs = !webAudio;
  const note = needs ? 'На iPhone звук идёт напрямую через системный плеер (фон и экран блокировки). Здесь работают пресеты скорости и «Скорость и тон»; эквалайзер, улучшение, эффекты и кроссфейд недоступны.' : '';
  return <Dialog open={open} onOpenChange={setOpen} side={matchMedia('(max-width: 767px)').matches ? 'bottom' : 'center'} title="Звук" className="md:w-[min(680px,94vw)] md:max-w-[680px]">
    <div id="soundPanel" className="flex min-h-0 flex-col gap-3 md:h-[min(520px,80dvh)] md:flex-row md:gap-4">
      <div role="tablist" aria-label="Разделы звука" className="no-scrollbar -mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 md:mx-0 md:w-44 md:flex-col md:overflow-visible md:px-0">
        {TABS.map((t) => <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onPointerDown={() => setTab(t.id)} onClick={() => setTab(t.id)}
          className={cn('flex min-h-11 shrink-0 items-center gap-2.5 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-[background-color,color,border-radius] md:rounded-[4px] md:first:rounded-t-xl md:last:rounded-b-xl',
            tab === t.id ? 'bg-primary-container text-on-primary-container md:!rounded-xl' : 'bg-surface-high text-muted-foreground hover:bg-surface-highest')}>
          <t.icon className="size-[18px]" />{t.label}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl bg-surface-c px-4 py-3 md:px-5 [scrollbar-gutter:stable]">
        {note && tab !== 'speed' && tab !== 'presets' && <p className="mb-2 rounded-2xl bg-surface-high px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">{note}</p>}
        {tab === 'presets' && <>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {FX_MODES.map((m) => <button key={m.id} type="button" onClick={() => usePlayer.getState().setFx(m.id)} aria-pressed={fx === m.id}
              className={cn('flex min-h-14 flex-col items-start justify-center rounded-2xl px-4 text-left text-sm font-medium transition-[background-color,border-radius] active:rounded-xl', fx === m.id ? 'bg-primary-container text-on-primary-container' : 'bg-surface-high')}>
              {m.name}<span className="text-xs font-normal text-muted-foreground">{m.rate !== 1 ? `${m.rate}× · тон` : 'исходная скорость'}{m.bass && webAudio ? ` · бас +${m.bass}` : ''}{m.reverb && webAudio ? ' · реверб' : ''}</span>
            </button>)}
          </div>
          <Row label="Кроссфейд" value={sound.crossfade ? `${sound.crossfade} с` : 'выкл'}>
            <Slider label="Кроссфейд" min={0} max={12} value={sound.crossfade} disabled={!webAudio} onChange={(v) => setSound({ crossfade: v })} />
          </Row>
          <div className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2 text-sm font-medium"><Moon className="size-4" />Таймер сна</span>
            <button type="button" onClick={() => usePlayer.getState().cycleSleep()} className={cn('m3-chip min-h-11', sleep && 'on')}><span data-sleep>{sleep ? `через ${sleep} мин` : 'выкл'}</span></button>
          </div>
          <p className="pt-1 text-xs text-muted-foreground">{webAudio ? (routed ? 'Движок Riff активен: Web Audio, плавные старт/пауза.' : 'Движок Riff включится при следующем нажатии Play.') : note}</p>
        </>}
        {tab === 'enhancer' && <>
          <div className="flex items-center justify-between py-2"><span className="text-sm font-medium">Улучшение звука (HQ)</span>
            <button type="button" role="switch" aria-checked={sound.hqEnabled} disabled={!webAudio} onClick={() => setSound({ hqEnabled: !sound.hqEnabled })}
              className={cn('relative h-8 w-[52px] rounded-full border-2 transition-colors disabled:opacity-40', sound.hqEnabled ? 'border-transparent bg-m3-primary' : 'border-outline bg-surface-highest')}>
              <span className={cn('absolute top-1/2 -translate-y-1/2 rounded-full transition-all', sound.hqEnabled ? 'left-[22px] size-6 bg-on-m3-primary' : 'left-1.5 size-4 bg-outline')} /></button></div>
          <div className="flex flex-col gap-1.5 py-1">
            {HQ_ENGINES.map((e) => <button key={e.id} type="button" disabled={!webAudio} onClick={() => setSound({ hq: { engine: e.id } })}
              className={cn('min-h-11 rounded-xl px-3 text-left text-sm disabled:opacity-40', sound.hq.engine === e.id ? 'bg-primary-container text-on-primary-container' : 'bg-surface-high')}>{e.label}</button>)}
          </div>
          {(['vocal', 'air', 'bass'] as const).map((k) => <Row key={k} label={{ vocal: 'Вокал', air: 'Воздух', bass: 'Бас' }[k]} value={String(sound.hq[k])}>
            <Slider label={k} min={-50} max={50} value={sound.hq[k]} disabled={!webAudio || !sound.hqEnabled} onChange={(v) => setSound({ hq: { [k]: v } })} />
          </Row>)}
        </>}
        {tab === 'speed' && <>
          <Row label="Скорость (без смены тона)" value={`${a.speed.toFixed(2)}×`}><Slider label="Скорость" min={0.5} max={2} step={0.05} value={a.speed} onChange={(v) => setSound({ settings: { speed: v, speedPitch: 1, pitch: 0 } })} /></Row>
          <Row label="Скорость с тоном" value={`${a.speedPitch.toFixed(2)}×`}><Slider label="Скорость с тоном" min={0.5} max={2} step={0.05} value={a.speedPitch} onChange={(v) => setSound({ settings: { speedPitch: v } })} /></Row>
          <Row label="Тон" value={`${a.pitch > 0 ? '+' : ''}${a.pitch} пт`}><Slider label="Тон" min={-12} max={12} value={a.pitch} onChange={(v) => setSound({ settings: { pitch: v } })} /></Row>
        </>}
        {tab === 'fx' && <>
          <Row label="Реверберация" value={`${a.reverb}%`}><Slider label="Реверберация" value={a.reverb} disabled={!webAudio} onChange={(v) => setSound({ settings: { reverb: v } })} /></Row>
          <Row label="Искажение" value={`${a.distortion}%`}><Slider label="Искажение" value={a.distortion} disabled={!webAudio} onChange={(v) => setSound({ settings: { distortion: v } })} /></Row>
          <Row label="Эхо" value={`${a.echo}%`}><Slider label="Эхо" value={a.echo} disabled={!webAudio} onChange={(v) => setSound({ settings: { echo: v } })} /></Row>
        </>}
        {tab === 'eq' && <>
          {(['low', 'mid', 'high'] as const).map((k) => <Row key={k} label={{ low: 'Низкие', mid: 'Средние', high: 'Высокие' }[k]} value={`${a.eq[k] > 0 ? '+' : ''}${a.eq[k]} дБ`}>
            <Slider label={k} min={-12} max={12} value={a.eq[k]} disabled={!webAudio} onChange={(v) => setSound({ settings: { eq: { ...a.eq, [k]: v } } })} />
          </Row>)}
          <p className="pb-1 pt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">10 полос</p>
          <div className="grid grid-cols-10 gap-1">
            {EQ_BAND_FREQS.map((f, i) => <div key={f} className="flex flex-col items-center gap-1">
              <div className="relative h-32 w-7"><input type="range" min={-12} max={12} step={1} value={a.eqBands[i]} disabled={!webAudio} aria-label={`${f} Гц`}
                onChange={(e) => { const b = a.eqBands.slice(); b[i] = Number(e.target.value); setSound({ settings: { eqBands: b } }); }}
                className="eq-band absolute left-1/2 top-1/2 h-7 w-32 -translate-x-1/2 -translate-y-1/2 -rotate-90 disabled:opacity-40" style={{ ['--v' as any]: (a.eqBands[i] + 12) / 24 }} /></div>
              <span className="font-mono text-[9px] text-muted-foreground">{f >= 1000 ? `${f / 1000}k` : f}</span>
            </div>)}
          </div>
        </>}
        <div className="mt-3 flex justify-end"><button type="button" onClick={() => usePlayer.getState().resetSound()} className="m3-chip min-h-11"><RotateCcw className="size-4" />Сбросить</button></div>
      </div>
    </div>
    <span className="sr-only"><AudioLines /></span>
  </Dialog>;
}
