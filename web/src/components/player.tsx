import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, Heart, ListMusic, ListPlus, Loader2, Moon, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Volume1, Volume2, VolumeX, Mic2 } from 'lucide-react';
import { cn, fmt, prettyTitle, splitArtist, ytThumb } from '@/lib/utils';
import { FX_MODES, getAudio, usePlayer } from '@/player/store';
import { useSession } from '@/lib/session';
import { useUI } from '@/lib/ui-store';
import { needAuth, toggleLike } from '@/lib/actions';
import { api } from '@/lib/api';
import type { LyricLine, Track } from '@/lib/types';
import { Popover, PopoverContent, PopoverTrigger, Tip } from './ui/misc';
import { Thumb, TrackMenu } from './tracks';

function useProgress() {
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  return { time, duration, ratio: duration > 0 ? Math.min(1, time / duration) : 0 };
}

/* Seek line: id="pline" + pointerdown contract kept for the Linux MPRIS bridge. */
function SeekBar({ big }: { big?: boolean }) {
  const { ratio, time, duration } = useProgress();
  const ref = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<number | null>(null);
  const at = (x: number) => { const b = ref.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - b.left) / b.width)); };
  const down = (e: React.PointerEvent) => {
    const r = at(e.clientX); setDrag(r);
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch {}
    const move = (ev: PointerEvent) => setDrag(at(ev.clientX));
    const up = (ev: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); usePlayer.getState().seek(at(ev.clientX)); setDrag(null); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const shown = drag ?? ratio;
  return (
    <div className={cn('flex w-full items-center gap-2', big && 'gap-3')}>
      <span id={big ? undefined : 'pos'} className="w-10 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{fmt(drag != null ? drag * duration : time)}</span>
      <div id={big ? undefined : 'pline'} ref={ref} onPointerDown={down} title="Seek" role="slider" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)}
        tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowRight') usePlayer.getState().seek(ratio + 5 / (duration || 1)); if (e.key === 'ArrowLeft') usePlayer.getState().seek(ratio - 5 / (duration || 1)); }}
        className="group relative flex h-4 flex-1 cursor-pointer touch-none items-center outline-none">
        <div className={cn('relative w-full overflow-hidden rounded-full bg-input', big ? 'h-1.5' : 'h-1')}>
          <div className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-foreground will-change-transform" style={{ transform: `scaleX(${shown})` }} />
        </div>
        <div className={cn('absolute size-3 -translate-x-1/2 rounded-full bg-foreground shadow transition-opacity', drag != null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100')} style={{ left: `${shown * 100}%` }} />
      </div>
      <span id={big ? undefined : 'dur'} className="w-10 font-mono text-[11px] tabular-nums text-muted-foreground">{fmt(duration)}</span>
    </div>
  );
}

function VolumeControl() {
  const v = usePlayer((s) => s.volume);
  const set = usePlayer((s) => s.setVolume);
  const prev = React.useRef(0.85);
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Mute" className="text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => { if (v > 0) { prev.current = v; set(0); } else set(prev.current || 0.85); }}><Icon className="size-4" /></button>
      <input id="vol" type="range" min={0} max={100} value={Math.round(v * 100)} title="Volume" className="range w-24"
        style={{ ['--val' as any]: `${Math.round(v * 100)}%` }}
        onChange={(e) => set(Number(e.target.value) / 100)} onInput={(e) => set(Number((e.target as HTMLInputElement).value) / 100)} />
    </div>
  );
}

function IconBtn({ id, label, active, onClick, children, className }: { id?: string; label: string; active?: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return <Tip label={label}><button id={id} type="button" aria-label={label} aria-pressed={active} onClick={onClick}
    className={cn('relative flex size-8 items-center justify-center rounded-md transition-[color,background-color,transform] duration-150 active:scale-90',
      active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground', className)}>
    {children}{active && <span className="absolute bottom-0.5 size-1 rounded-full bg-foreground" />}
  </button></Tip>;
}

export function FxPopover({ children }: { children: React.ReactNode }) {
  const fx = usePlayer((s) => s.fx);
  const setFx = usePlayer((s) => s.setFx);
  return <Popover><PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent side="top" className="w-56 p-1">
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Эффекты</p>
      {FX_MODES.map((m) => <button key={m.id} type="button" onClick={() => setFx(m.id)}
        className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent', fx === m.id && 'bg-accent')}>
        {m.name}<span className="font-mono text-[10px] text-muted-foreground">{m.rate !== 1 ? `${m.rate}×` : ''}{m.bass ? ` +${m.bass}dB` : ''}</span>
      </button>)}
    </PopoverContent></Popover>;
}

function PlayButton({ big }: { big?: boolean }) {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const reduce = useReducedMotion();
  return <button id={big ? undefined : 'bPlay'} type="button" title="Play / Pause (space)" aria-label={playing ? 'Pause' : 'Play'}
    onClick={() => usePlayer.getState().toggle()}
    className={cn('relative flex items-center justify-center rounded-full bg-foreground text-background shadow-sm transition-transform duration-150 hover:scale-105 active:scale-95', big ? 'size-16' : 'size-9', playing && 'playing')}>
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={playing ? 'pa' : 'pl'} initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.15 }}>
        {playing ? <Pause className={cn('fill-current', big ? 'size-6' : 'size-4')} /> : <Play className={cn('fill-current translate-x-[1px]', big ? 'size-6' : 'size-4')} />}
      </motion.span>
    </AnimatePresence>
    {loading && playing && <Loader2 className={cn('absolute animate-spin text-background/40', big ? 'size-[4.5rem]' : 'size-10')} strokeWidth={1} />}
  </button>;
}

function Transport({ big }: { big?: boolean }) {
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  return <div className={cn('flex items-center justify-center', big ? 'gap-6' : 'gap-1.5')}>
    <IconBtn id={big ? undefined : 'bShuffle'} label="Shuffle" active={shuffle} onClick={() => usePlayer.getState().toggleShuffle()}><Shuffle className={big ? 'size-5' : 'size-4'} /></IconBtn>
    <IconBtn id={big ? undefined : 'bPrev'} label="Previous" onClick={() => usePlayer.getState().prev()} className="text-foreground"><SkipBack className={cn('fill-current', big ? 'size-6' : 'size-4')} /></IconBtn>
    <PlayButton big={big} />
    <IconBtn id={big ? undefined : 'bNext'} label="Next" onClick={() => usePlayer.getState().next()} className="text-foreground"><SkipForward className={cn('fill-current', big ? 'size-6' : 'size-4')} /></IconBtn>
    <IconBtn id={big ? undefined : 'bRepeat'} label={`Repeat: ${repeat}`} active={repeat !== 'off'} onClick={() => usePlayer.getState().cycleRepeat()}>
      {repeat === 'one' ? <Repeat1 className={big ? 'size-5' : 'size-4'} /> : <Repeat className={big ? 'size-5' : 'size-4'} />}
    </IconBtn>
  </div>;
}

function AddButton({ t, id }: { t: Track; id?: string }) {
  return <TrackMenu t={t} align="end"><button id={id} type="button" title="Add to playlist" aria-label="Add to playlist" className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"><ListPlus className="size-4" /></button></TrackMenu>;
}

export function PlayerBar() {
  const cur = usePlayer((s) => s.current);
  const duration = usePlayer((s) => s.duration);
  const liked = useSession((s) => !!cur && s.likedIds.has(cur.id));
  const sleep = usePlayer((s) => s.sleepMins);
  const fx = usePlayer((s) => s.fx);
  const expand = usePlayer((s) => s.setExpanded);
  const reduce = useReducedMotion();
  const artist = cur ? String(cur.uploader || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim() : '';
  return (
    <footer id="player" hidden={!cur} data-id={cur?.id || ''} data-artist={artist} data-duration={duration ? String(duration) : ''}
      className="kb-hide fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-40 border-t pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-background/85 backdrop-blur-xl md:bottom-0">
      {cur && <motion.div initial={reduce ? false : { y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="grid h-[68px] grid-cols-[1fr_auto] items-center gap-3 px-3 md:h-20 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => expand(true)} className="group relative size-11 shrink-0 overflow-hidden rounded-md bg-muted md:size-12" aria-label="Open now playing">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.img id="art" key={cur.id} src={ytThumb(cur.id, cur.thumbnail)} alt="" className="absolute inset-0 size-full object-cover"
                initial={reduce ? false : { opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} />
            </AnimatePresence>
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"><ChevronDown className="size-4 rotate-180 text-white" /></span>
          </button>
          <button type="button" onClick={() => expand(true)} className="min-w-0 text-left">
            <div id="ptitle" className="truncate text-sm font-medium">{prettyTitle(cur.title) || 'Loading…'}</div>
            <div className="truncate text-xs text-muted-foreground">{artist}</div>
          </button>
          <button id="bLike" type="button" aria-label="Like" onClick={() => toggleLike(cur)} className={cn('hidden size-8 shrink-0 items-center justify-center rounded-md transition-transform active:scale-90 md:flex', liked ? 'text-foreground loved' : 'text-muted-foreground hover:text-foreground')}>
            <motion.span key={String(liked)} initial={reduce || !liked ? false : { scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 15 }}><Heart className={cn('size-4', liked && 'fill-current')} /></motion.span>
          </button>
        </div>
        <div className="hidden flex-col items-center gap-1 md:flex"><Transport /><SeekBar /></div>
        <div className="flex items-center justify-end gap-1">
          <div className="flex items-center gap-2 md:hidden">
            <button type="button" aria-label="Like" onClick={() => toggleLike(cur)} className={cn('flex size-11 items-center justify-center transition-transform active:scale-90', liked ? 'text-foreground' : 'text-muted-foreground')}><Heart className={cn('size-5', liked && 'fill-current')} /></button>
            <PlayButton />
          </div>
          <div className="hidden items-center gap-1 md:flex">
            <IconBtn label="Lyrics & queue" onClick={() => expand(true)}><Mic2 className="size-4" /></IconBtn>
            <FxPopover><button id="bFx" type="button" title="Эффекты" className={cn('flex size-8 items-center justify-center rounded-md', fx !== 'normal' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}><SlidersHorizontal className="size-4" /></button></FxPopover>
            <IconBtn label={sleep ? `Sleep in ${sleep}m` : 'Sleep timer'} active={!!sleep} onClick={() => usePlayer.getState().cycleSleep()}><Moon className="size-4" /></IconBtn>
            <AddButton t={cur} id="bAdd" />
            <VolumeControl />
          </div>
        </div>
      </motion.div>}
      {cur && <div className="absolute inset-x-0 top-0 h-px md:hidden"><MiniProgress /></div>}
    </footer>
  );
}
function MiniProgress() { const { ratio } = useProgress(); return <div className="h-full origin-left bg-foreground" style={{ transform: `scaleX(${ratio})` }} />; }

/* ---------- Now Playing (expanded): cover, transport, synced lyrics, queue ---------- */
function useLyrics(cur: Track | null, duration: number) {
  const [state, setState] = React.useState<{ id: string; lines: LyricLine[]; synced: boolean; loading: boolean }>({ id: '', lines: [], synced: false, loading: false });
  React.useEffect(() => {
    if (!cur) return;
    let dead = false;
    const { artist, song } = splitArtist(cur.title, cur.uploader);
    setState({ id: cur.id, lines: [], synced: false, loading: true });
    // Raw title + channel: the server identifies the real artist/title (strips VEVO, - Topic, Official Video…)
    // and only accepts LRCLIB rows matching artist + title + duration.
    const p = new URLSearchParams({ title: cur.title || song, artist: cur.uploader || artist, duration: String(Math.round(cur.duration || duration || 0)) });
    api<{ lines: LyricLine[]; synced: boolean }>(`/api/lyrics?${p}`).then((j) => {
      if (dead) return;
      const lines = (j.lines || []).filter((l) => l && typeof l.text === 'string');
      setState({ id: cur.id, lines, synced: !!j.synced && lines.some((l) => Number(l.t) > 0), loading: false });
    }).catch(() => !dead && setState((s) => ({ ...s, loading: false })));
    return () => { dead = true; };
  }, [cur?.id, cur?.title, cur?.duration ? 0 : Math.round(duration / 5)]);
  return state;
}

function Lyrics({ cur }: { cur: Track }) {
  const duration = usePlayer((s) => s.duration);
  const { lines, synced, loading } = useLyrics(cur, duration);
  const box = React.useRef<HTMLDivElement>(null);
  const [idx, setIdx] = React.useState(-1);
  React.useEffect(() => {
    if (!synced) { setIdx(-1); return; }
    let raf = 0;
    const loop = () => {
      const t = getAudio().currentTime + 0.03;
      let lo = 0, hi = lines.length - 1, ans = -1;
      if (t >= Number(lines[0]?.t ?? 0)) { ans = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; } }
      setIdx((p) => (p === ans ? p : ans));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lines, synced]);
  React.useEffect(() => {
    if (idx < 0 || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    if (el) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight * 0.35, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [idx]);
  if (loading) return <div className="flex h-full flex-col gap-4 p-2">{[80, 60, 70, 50, 65].map((w, i) => <div key={i} className="h-7 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />)}</div>;
  if (!lines.length) return <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground"><Mic2 className="mb-3 size-6" /><p className="text-sm">No lyrics for this one.</p></div>;
  return <div ref={box} className={cn('no-scrollbar relative h-full overflow-y-auto px-1 py-[30%] [mask-image:linear-gradient(transparent,black_15%,black_85%,transparent)]', !synced && 'ly-plain')}>
    {lines.map((l, i) => <button key={i} data-i={i} type="button" disabled={!synced}
      onClick={() => { if (synced) getAudio().currentTime = Number(l.t); }}
      className={cn('ly-line block w-full py-1.5 text-left text-2xl font-semibold tracking-tight md:text-3xl', synced && i === idx && 'on', synced && i < idx && 'past')}>{l.text || '♪'}</button>)}
  </div>;
}

function Queue() {
  const queue = usePlayer((s) => s.queue);
  const qi = usePlayer((s) => s.qi);
  const up = queue.slice(qi + 1, qi + 41);
  return <div className="h-full overflow-y-auto scrollbar-thin">
    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Up next</p>
    {up.length === 0 ? <p className="text-sm text-muted-foreground">Queue ends here — Muse will keep going with similar songs.</p> :
      up.map((t, i) => <button key={t.id + i} type="button" onClick={() => usePlayer.getState().play(t)} className="flex w-full items-center gap-3 rounded-md p-1.5 text-left transition-colors hover:bg-accent/60">
        <Thumb t={t} className="size-10 rounded" /><span className="min-w-0 flex-1"><span className="block truncate text-sm">{prettyTitle(t.title)}</span><span className="block truncate text-xs text-muted-foreground">{t.uploader}</span></span>
        <span className="font-mono text-xs text-muted-foreground">{t.duration ? fmt(t.duration) : ''}</span>
      </button>)}
  </div>;
}

export function NowPlaying() {
  const cur = usePlayer((s) => s.current);
  const open = usePlayer((s) => s.expanded);
  const set = usePlayer((s) => s.setExpanded);
  const liked = useSession((s) => !!cur && s.likedIds.has(cur.id));
  const [tab, setTab] = React.useState<'lyrics' | 'queue'>('lyrics');
  const reduce = useReducedMotion();
  React.useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') set(false); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open]);
  return <AnimatePresence>
    {open && cur && <motion.div id="bigplayer" role="dialog" aria-modal aria-label="Now playing"
      initial={reduce ? { opacity: 0 } : { y: '100%' }} animate={reduce ? { opacity: 1 } : { y: 0 }} exit={reduce ? { opacity: 0 } : { y: '100%' }}
      transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 300, damping: 34 }}
      drag={reduce ? false : 'y'} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, i) => { if (i.offset.y > 140 || i.velocity.y > 600) set(false); }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-30">
        <img src={ytThumb(cur.id, cur.thumbnail)} alt="" className="size-full scale-125 object-cover blur-3xl saturate-150" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />
      </div>
      <div className="relative flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] md:px-8">
        <button id="bpClose" type="button" aria-label="Close" onClick={() => set(false)} className="flex size-9 pointer-coarse:size-11 items-center justify-center rounded-full border bg-background/40 backdrop-blur hover:bg-accent"><ChevronDown className="size-5" /></button>
        <div className="flex rounded-lg border bg-background/40 p-0.5 backdrop-blur md:hidden">
          {(['lyrics', 'queue'] as const).map((k) => <button key={k} type="button" onClick={() => setTab(k)} className={cn('relative rounded-md px-4 py-1 text-xs pointer-coarse:py-2 pointer-coarse:text-sm font-medium capitalize', tab === k ? 'text-foreground' : 'text-muted-foreground')}>
            {tab === k && <motion.span layoutId="np-tab" className="absolute inset-0 rounded-md bg-accent" />}<span className="relative">{k}</span></button>)}
        </div>
        <span className="hidden text-xs font-medium uppercase tracking-wider text-muted-foreground md:block">Now playing</span>
        <span className="size-9 pointer-coarse:size-11" />
      </div>
      <div className="relative mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-5 md:grid md:gap-8 px-5 pb-6 pt-4 md:grid-cols-[minmax(0,420px)_1fr] md:px-10 md:pt-8">
        <div className="flex shrink-0 flex-col justify-center gap-5" id="bpNow">
          <motion.div layoutId={reduce ? undefined : 'np-art'} className="relative mx-auto aspect-square w-full max-w-[min(420px,34dvh)] md:max-w-[min(420px,42dvh)] overflow-hidden rounded-2xl border shadow-2xl">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.img id="bpCover" key={cur.id} src={ytThumb(cur.id, cur.thumbnail).replace('mqdefault', 'hqdefault')} alt="" className="absolute inset-0 size-full object-cover"
                initial={reduce ? false : { opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />
            </AnimatePresence>
          </motion.div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><h2 id="bpNowTitle" className="truncate text-xl font-semibold tracking-tight md:text-2xl">{prettyTitle(cur.title)}</h2>
              <p id="bpNowArtist" className="truncate text-sm text-muted-foreground">{String(cur.uploader || '').replace(/\s*-\s*Topic$/i, '')}</p></div>
            <div className="flex shrink-0 items-center gap-1 pointer-coarse:gap-3">
              <button type="button" aria-label="Like" onClick={() => toggleLike(cur)} className={cn('flex size-9 items-center justify-center rounded-full transition-transform active:scale-90', liked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}><Heart className={cn('size-5', liked && 'fill-current')} /></button>
              <AddButton t={cur} />
            </div>
          </div>
          <SeekBar big />
          <Transport big />
          <div className="flex items-center justify-between text-muted-foreground">
            <FxPopover><button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent hover:text-foreground"><SlidersHorizontal className="size-3.5" />FX</button></FxPopover>
            <SleepChip />
            <div className="hidden md:block"><VolumeLite /></div>
          </div>
        </div>
        <div className={cn('min-h-0 flex-1 md:block', tab === 'lyrics' ? 'block' : 'hidden')} id="bpLyrics"><Lyrics cur={cur} /></div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto md:hidden', tab === 'queue' ? 'block' : 'hidden')}><Queue /></div>
      </div>
      <div className="relative mx-auto hidden w-full max-w-6xl px-10 pb-6 md:block"><details className="group"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"><ListMusic className="size-3.5" />Queue</summary><div className="mt-3 h-48"><Queue /></div></details></div>
    </motion.div>}
  </AnimatePresence>;
}
function SleepChip() { const m = usePlayer((s) => s.sleepMins); return <button type="button" onClick={() => usePlayer.getState().cycleSleep()} className={cn('flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent hover:text-foreground', m && 'text-foreground')}><Moon className="size-3.5" /><span data-sleep>{m ? `${m}m` : 'Off'}</span></button>; }
function VolumeLite() { const v = usePlayer((s) => s.volume); return <input type="range" min={0} max={100} value={Math.round(v * 100)} className="range w-28" style={{ ['--val' as any]: `${Math.round(v * 100)}%` }} onChange={(e) => usePlayer.getState().setVolume(Number(e.target.value) / 100)} aria-label="Volume" />; }
