/*
 * Player UI in Riff's design: floating rounded play bar (grid 280/1fr/280, 88px, radius 28),
 * play/pause pill, squiggly scrubber, pill volume slider, mini visualizer, right lyrics panel.
 * Design ported from Riff's index.html/styles.css (https://github.com/rootscripts/riff,
 * MIT © 2026 rootscripts — see THIRD_PARTY_NOTICES.md). Mobile layout is Muse's own.
 */
import * as React from 'react';
import { create } from 'zustand';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, Heart, ListMusic, ListPlus, Loader2, Moon, Pause, Play, Repeat, Repeat1, Share2, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Volume1, Volume2, VolumeX, Mic2, MoreHorizontal, PanelRight, Disc3 } from 'lucide-react';
import { cn, fmt, prettyTitle, splitArtist, ytThumb } from '@/lib/utils';
import { getAudio, usePlayer } from '@/player/store';
import { useSession } from '@/lib/session';
import { shareTrack, toggleLike } from '@/lib/actions';
import { api } from '@/lib/api';
import type { LyricLine, Track } from '@/lib/types';
import { Tip } from './ui/misc';
import { Thumb, TrackMenu } from './tracks';
import { MiniViz, Slider, SquiggleCanvas } from './riff-ui';
import { useSoundPanel } from './sound-panel';

/** Riff right panel (lyrics) on wide desktops. */
export const usePanels = create<{ right: boolean; toggleRight: () => void }>((set, get) => ({
  right: (() => { try { return localStorage.getItem('muse:rightPanel') !== '0'; } catch { return true; } })(),
  toggleRight: () => { const right = !get().right; try { localStorage.setItem('muse:rightPanel', right ? '1' : '0'); } catch {} set({ right }); },
}));

function useProgress() {
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  return { time, duration, ratio: duration > 0 ? Math.min(1, time / duration) : 0 };
}
const artistOf = (t: Track) => String(t.uploader || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();

/* Seek: Riff squiggly scrubber. id="pline" + pointerdown contract kept for the Linux MPRIS bridge. */
function SeekBar({ bar, touch }: { bar?: boolean; touch?: boolean }) {
  const { ratio, time, duration } = useProgress();
  const ref = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<number | null>(null);
  const at = (x: number) => { const b = ref.current!.getBoundingClientRect(); return Math.min(1, Math.max(0, (x - b.left) / b.width)); };
  const down = (e: React.PointerEvent) => {
    const r = at(e.clientX); setDrag(r);
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch {}
    const move = (ev: PointerEvent) => setDrag(at(ev.clientX));
    const up = (ev: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); usePlayer.getState().seek(at(ev.clientX)); setDrag(null); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  const key = (e: React.KeyboardEvent) => { if (e.key === 'ArrowRight') usePlayer.getState().seek(ratio + 5 / (duration || 1)); if (e.key === 'ArrowLeft') usePlayer.getState().seek(ratio - 5 / (duration || 1)); };
  const shownT = drag != null ? drag * duration : time;
  const track = <div id={bar ? 'pline' : undefined} ref={ref} onPointerDown={down} onKeyDown={key} title="Перемотка" role="slider" aria-label="Перемотка"
    aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} aria-valuetext={`${fmt(time)} из ${fmt(duration)}`} tabIndex={0}
    className={cn('squiggle min-w-0 flex-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring', touch ? 'h-12' : bar ? 'h-10' : 'h-11')}>
    <SquiggleCanvas dragRatio={drag} />
  </div>;
  if (touch) return <div className="w-full">{track}
    <div className="-mt-1 flex justify-between text-xs tabular-nums text-outline"><span>{fmt(shownT)}</span><span>{fmt(duration)}</span></div></div>;
  return <div className="flex w-full items-center gap-3">
    <span id={bar ? 'pos' : undefined} className="w-10 text-right text-[11px] tabular-nums text-outline">{fmt(shownT)}</span>
    {track}
    <span id={bar ? 'dur' : undefined} className="w-10 text-[11px] tabular-nums text-outline">{fmt(duration)}</span>
  </div>;
}

function VolumeControl({ id }: { id?: string }) {
  const v = usePlayer((s) => s.volume);
  const set = usePlayer((s) => s.setVolume);
  const prev = React.useRef(0.85);
  const Icon = v === 0 ? VolumeX : v < 0.5 ? Volume1 : Volume2;
  return <div className="flex items-center gap-1.5">
    <button type="button" aria-label={v ? 'Выключить звук' : 'Включить звук'} className="control-btn"
      onClick={() => { if (v > 0) { prev.current = v; set(0); } else set(prev.current || 0.85); }}><Icon className="size-5" /></button>
    <Slider id={id} label="Громкость" title="Volume" thin className="!w-24 !flex-none" value={Math.round(v * 100)} onChange={(n) => set(n / 100)} />
  </div>;
}

function IconBtn({ id, label, active, onClick, children, className }: { id?: string; label: string; active?: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return <Tip label={label}><button id={id} type="button" aria-label={label} aria-pressed={active} onClick={onClick}
    className={cn('control-btn', active && 'active', className)}>{children}</button></Tip>;
}

function PlayButton({ id, size }: { id?: string; size?: 'mini' | 'hero' }) {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const reduce = useReducedMotion();
  const ic = size === 'hero' ? 'size-8' : size === 'mini' ? 'size-5' : 'size-6';
  return <button id={id} type="button" title="Play / Pause (space)" aria-label={playing ? 'Пауза' : 'Играть'}
    onClick={() => usePlayer.getState().toggle()}
    className={cn('btn-play-pause relative', size, playing && 'playing')}>
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={playing ? 'pa' : 'pl'} initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ duration: 0.15 }}>
        {playing ? <Pause className={cn('fill-current', ic)} /> : <Play className={cn('translate-x-[1px] fill-current', ic)} />}
      </motion.span>
    </AnimatePresence>
    {loading && playing && <Loader2 className="absolute size-[70%] animate-spin opacity-30" strokeWidth={1.5} />}
  </button>;
}

function Transport({ big }: { big?: boolean }) {
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const ic = big ? 'size-6' : 'size-5';
  return <div className={cn('flex items-center justify-center', big ? 'gap-4' : 'gap-2')}>
    <IconBtn id={big ? undefined : 'bShuffle'} label="Перемешать" active={shuffle} onClick={() => usePlayer.getState().toggleShuffle()}><Shuffle className={big ? 'size-5' : 'size-[18px]'} /></IconBtn>
    <IconBtn id={big ? undefined : 'bPrev'} label="Предыдущий" onClick={() => usePlayer.getState().prev()} className="fg"><SkipBack className={cn('fill-current', ic)} /></IconBtn>
    <PlayButton id={big ? undefined : 'bPlay'} />
    <IconBtn id={big ? undefined : 'bNext'} label="Следующий" onClick={() => usePlayer.getState().next()} className="fg"><SkipForward className={cn('fill-current', ic)} /></IconBtn>
    <IconBtn id={big ? undefined : 'bRepeat'} label={`Повтор: ${repeat}`} active={repeat !== 'off'} onClick={() => usePlayer.getState().cycleRepeat()}>
      {repeat === 'one' ? <Repeat1 className={big ? 'size-5' : 'size-[18px]'} /> : <Repeat className={big ? 'size-5' : 'size-[18px]'} />}
    </IconBtn>
  </div>;
}

function AddButton({ t, id }: { t: Track; id?: string }) {
  return <TrackMenu t={t} align="end"><button id={id} type="button" title="Add to playlist" aria-label="Добавить в плейлист" className="control-btn"><ListPlus className="size-5" /></button></TrackMenu>;
}

export function PlayerBar() {
  const cur = usePlayer((s) => s.current);
  const duration = usePlayer((s) => s.duration);
  const liked = useSession((s) => !!cur && s.likedIds.has(cur.id));
  const sleep = usePlayer((s) => s.sleepMins);
  const fx = usePlayer((s) => s.fx);
  const sound = usePlayer((s) => s.sound);
  const expand = usePlayer((s) => s.setExpanded);
  const right = usePanels((s) => s.right);
  const reduce = useReducedMotion();
  const artist = cur ? artistOf(cur) : '';
  const soundOn = fx !== 'normal' || sound.hqEnabled || sound.crossfade > 0 || sound.settings.reverb > 0 || sound.settings.echo > 0 || sound.settings.distortion > 0 || sound.settings.speed !== 1 || sound.settings.eqBands.some((x) => x) || Object.values(sound.settings.eq).some((x) => x);
  return (
    <footer id="player" hidden={!cur} data-id={cur?.id || ''} data-artist={artist} data-duration={duration ? String(duration) : ''}
      className="kb-hide fixed z-40 left-[max(0.5rem,env(safe-area-inset-left))] right-[max(0.5rem,env(safe-area-inset-right))] bottom-[calc(var(--tab-h)+var(--sab)+6px)] overflow-hidden rounded-[20px] bg-surface-high shadow-[0_6px_24px_rgb(0_0_0/.28)] md:inset-x-4 md:bottom-4 md:rounded-[28px] md:shadow-none">
      {cur && <motion.div initial={reduce ? false : { y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 pl-2 pr-1 md:h-[88px] md:grid-cols-[minmax(180px,260px)_minmax(0,1fr)_auto] md:gap-6 md:px-6 lg:grid-cols-[280px_minmax(0,1fr)_minmax(280px,auto)]">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => expand(true)} className="group relative size-12 shrink-0 overflow-hidden rounded-xl bg-surface-highest md:rounded-lg" aria-label="Open now playing">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.img id="art" key={cur.id} src={ytThumb(cur.id, cur.thumbnail)} alt="" className="absolute inset-0 size-full object-cover"
                initial={reduce ? false : { opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} />
            </AnimatePresence>
            <span className="absolute inset-0 hidden items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 pointer-fine:flex"><ChevronDown className="size-4 rotate-180 text-white" /></span>
          </button>
          <button type="button" onClick={() => expand(true)} aria-label="Открыть плеер" className="flex min-h-12 min-w-0 flex-1 flex-col justify-center text-left">
            <div id="ptitle" className="truncate text-[15px] font-medium md:text-sm">{prettyTitle(cur.title) || 'Loading…'}</div>
            <div className="truncate text-[13px] text-muted-foreground md:text-xs">{artist}</div>
          </button>
          <button id="bLike" type="button" aria-label="Like" onClick={() => toggleLike(cur)} className={cn('control-btn hidden md:inline-flex', liked && 'loved !text-m3-primary')}>
            <motion.span key={String(liked)} initial={reduce || !liked ? false : { scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 15 }}><Heart className={cn('size-5', liked && 'fill-current')} /></motion.span>
          </button>
        </div>
        <div className="hidden min-w-0 flex-col items-center md:flex"><Transport /><div className="-mb-1 w-full max-w-[640px]"><SeekBar bar /></div></div>
        <div className="flex items-center justify-end gap-0.5">
          <div className="flex items-center gap-0.5 md:hidden">
            <button type="button" aria-label={liked ? 'Убрать из любимых' : 'В любимые'} onClick={() => toggleLike(cur)} className={cn('flex size-11 items-center justify-center rounded-full active:scale-90', liked ? 'text-m3-primary' : 'text-muted-foreground')}><Heart className={cn('size-6', liked && 'fill-current')} /></button>
            <PlayButton size="mini" />
            <button type="button" aria-label="Следующий трек" onClick={() => usePlayer.getState().next()} className="flex size-11 items-center justify-center rounded-full text-foreground active:scale-90"><SkipForward className="size-6 fill-current" /></button>
          </div>
          <div className="hidden items-center gap-0.5 md:flex">
            <MiniViz className="mr-1 hidden xl:block" />
            <IconBtn label="Текст" active={right} onClick={() => { if (matchMedia('(min-width: 1280px)').matches) usePanels.getState().toggleRight(); else expand(true); }}><Mic2 className="size-[18px]" /></IconBtn>
            <Tip label="Звук"><button id="bFx" type="button" title="Эффекты" aria-label="Звук" onClick={() => useSoundPanel.getState().set(true)} className={cn('control-btn', soundOn && 'active')}><SlidersHorizontal className="size-[18px]" /></button></Tip>
            <IconBtn label={sleep ? `Сон через ${sleep} мин` : 'Таймер сна'} active={!!sleep} onClick={() => usePlayer.getState().cycleSleep()} className="hidden 2xl:inline-flex"><Moon className="size-[18px]" /></IconBtn>
            <AddButton t={cur} id="bAdd" />
            <VolumeControl id="vol" />
          </div>
        </div>
      </motion.div>}
      {cur && <div className="pointer-events-none absolute inset-x-4 bottom-0 h-[3px] overflow-hidden rounded-full bg-surface-highest md:hidden"><MiniProgress /></div>}
    </footer>
  );
}
function MiniProgress() { const { ratio } = useProgress(); return <div className="h-full origin-left rounded-full bg-m3-primary" style={{ transform: `scaleX(${ratio})` }} />; }

/* Riff right panel: cover, title, actions, lyrics (≥1280 px, toggled from the play bar). */
export function RightPanel() {
  const cur = usePlayer((s) => s.current);
  const right = usePanels((s) => s.right);
  const liked = useSession((s) => !!cur && s.likedIds.has(cur.id));
  if (!cur || !right) return null;
  return <aside id="rightPanel" aria-label="Сейчас играет" className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-[28px] bg-surface-c xl:flex">
    <div className="flex flex-col gap-4 p-5 pb-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-surface-high">
        <img src={ytThumb(cur.id, cur.thumbnail).replace('mqdefault', 'hqdefault')} alt="" className="absolute inset-0 size-full object-cover" />
      </div>
      <div className="min-w-0"><h2 className="truncate text-lg font-semibold">{prettyTitle(cur.title)}</h2><p className="truncate text-sm text-muted-foreground">{artistOf(cur)}</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => toggleLike(cur)} className={cn('m3-chip', liked && 'on')}><Heart className={cn('size-4', liked && 'fill-current')} />{liked ? 'В любимых' : 'Нравится'}</button>
        <button type="button" onClick={() => shareTrack(cur)} className="m3-chip"><Share2 className="size-4" />Отправить</button>
        <button type="button" onClick={() => usePanels.getState().toggleRight()} className="m3-chip" aria-label="Скрыть панель"><PanelRight className="size-4" /></button>
      </div>
    </div>
    <div className="min-h-0 flex-1 px-5 pb-4"><Lyrics cur={cur} big={false} /></div>
  </aside>;
}

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

export function Lyrics({ cur, big = true }: { cur: Track; big?: boolean }) {
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
  if (!lines.length) return <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground"><Mic2 className="mb-3 size-6" /><p className="text-sm">Текста для этого трека нет.</p></div>;
  return <div ref={box} className={cn('no-scrollbar relative h-full overflow-y-auto px-1 py-[30%] [mask-image:linear-gradient(transparent,black_15%,black_85%,transparent)]', !synced && 'ly-plain')}>
    {lines.map((l, i) => <button key={i} data-i={i} type="button" disabled={!synced}
      onClick={() => { if (synced) getAudio().currentTime = Number(l.t); }}
      style={synced ? { ['--d' as any]: idx < 0 ? Math.min(i, 4) : Math.abs(i - idx) } : undefined}
      className={cn('ly-line block w-full py-2 text-left tracking-tight', big ? 'text-[26px] leading-snug md:text-[32px]' : 'text-lg leading-snug', synced && i === idx && 'on')}>{l.text || '♪'}</button>)}
  </div>;
}

function Queue() {
  const queue = usePlayer((s) => s.queue);
  const qi = usePlayer((s) => s.qi);
  const up = queue.slice(qi + 1, qi + 41);
  return <div className="h-full overflow-y-auto">
    <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Далее</p>
    {up.length === 0 ? <p className="px-1 text-sm text-muted-foreground">Очередь закончилась — Muse продолжит похожими треками.</p> :
      up.map((t, i) => <button key={t.id + i} type="button" onClick={() => usePlayer.getState().play(t)} style={{ ['--i' as any]: i }}
        className="track-row flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left">
        <Thumb t={t} className="size-11 rounded-xl" /><span className="min-w-0 flex-1"><span className="tr-title block truncate text-sm font-medium">{prettyTitle(t.title)}</span><span className="block truncate text-xs text-muted-foreground">{t.uploader}</span></span>
        <span className="text-xs tabular-nums text-outline">{t.duration ? fmt(t.duration) : ''}</span>
      </button>)}
  </div>;
}

export function NowPlaying() {
  const cur = usePlayer((s) => s.current);
  const open = usePlayer((s) => s.expanded);
  const set = usePlayer((s) => s.setExpanded);
  const liked = useSession((s) => !!cur && s.likedIds.has(cur.id));
  const reduce = useReducedMotion();
  const mobile = useIsMobile();
  const [qOpen, setQOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    /* capture phase on window runs before Radix's document listener: an open sheet/menu/dialog on top eats Escape first */
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]:not(#bigplayer), [role="menu"]')) set(false); };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [open]);
  return <AnimatePresence>
    {open && cur && <motion.div id="bigplayer" role="dialog" aria-modal aria-label="Now playing"
      initial={reduce ? { opacity: 0 } : { y: '100%' }} animate={reduce ? { opacity: 1 } : { y: 0 }} exit={reduce ? { opacity: 0 } : { y: '100%' }}
      transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 300, damping: 34 }}
      drag={reduce || !mobile ? false : 'y'} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, i) => { if (i.offset.y > 140 || i.velocity.y > 600) set(false); }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50 dark:opacity-35">
        <img src={ytThumb(cur.id, cur.thumbnail)} alt="" className="size-full scale-125 object-cover blur-3xl saturate-150" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/80 to-background" />
      </div>
      {mobile ? <MobileNowPlaying cur={cur} liked={liked} onClose={() => set(false)} /> : <>
      <div className="relative flex items-center justify-between px-8 pt-[max(1rem,env(safe-area-inset-top))]">
        <button id="bpClose" type="button" aria-label="Close" onClick={() => set(false)} className="control-btn bg-surface-high"><ChevronDown className="size-5" /></button>
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Сейчас играет</span>
        <button type="button" onClick={() => setQOpen((x) => !x)} className={cn('m3-chip', qOpen && 'on')}><ListMusic className="size-4" />Очередь</button>
      </div>
      <div className="relative mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-[minmax(0,420px)_1fr] gap-10 px-10 pb-8 pt-6">
        <div className="flex shrink-0 flex-col justify-center gap-5" id="bpNow">
          <motion.div layoutId={reduce ? undefined : 'np-art'} className="relative mx-auto aspect-square w-full max-w-[min(420px,44dvh)] overflow-hidden rounded-[28px] bg-surface-high shadow-2xl">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.img id="bpCover" key={cur.id} src={ytThumb(cur.id, cur.thumbnail).replace('mqdefault', 'hqdefault')} alt="" className="absolute inset-0 size-full object-cover"
                initial={reduce ? false : { opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />
            </AnimatePresence>
          </motion.div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><h2 id="bpNowTitle" className="truncate text-2xl font-semibold tracking-tight">{prettyTitle(cur.title)}</h2>
              <p id="bpNowArtist" className="truncate text-sm text-muted-foreground">{artistOf(cur)}</p></div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" aria-label="Like" onClick={() => toggleLike(cur)} className={cn('control-btn', liked && '!text-m3-primary')}><Heart className={cn('size-5', liked && 'fill-current')} /></button>
              <AddButton t={cur} />
            </div>
          </div>
          <SeekBar />
          <Transport big />
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => useSoundPanel.getState().set(true)} className="m3-chip"><SlidersHorizontal className="size-4" />Звук</button>
            <SleepChip />
            <VolumeControl />
          </div>
        </div>
        <div className="min-h-0" id="bpLyrics">{qOpen ? <Queue /> : <Lyrics cur={cur} />}</div>
      </div>
      </>}
    </motion.div>}
  </AnimatePresence>;
}
function SleepChip() { const m = usePlayer((s) => s.sleepMins); return <button type="button" onClick={() => usePlayer.getState().cycleSleep()} className={cn('m3-chip', m && 'on')}><Moon className="size-4" /><span data-sleep>{m ? `${m} мин` : 'Сон'}</span></button>; }

function useIsMobile() {
  const q = '(max-width: 767px)';
  const [m, setM] = React.useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  React.useEffect(() => { const mq = window.matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  return m;
}

/* Riff tonal button, sized for thumbs: icon + label, 64px tall. */
function ActionBtn({ icon: Icon, label, onClick, active, id, fill }: { icon: any; label: string; onClick?: () => void; active?: boolean; id?: string; fill?: boolean }) {
  return <button id={id} type="button" onClick={onClick} aria-pressed={active}
    className={cn('flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-[20px] text-[11px] font-medium transition-[background-color,border-radius,transform] duration-200 active:scale-95 active:rounded-xl min-[375px]:text-xs',
      active ? 'bg-primary-container text-on-primary-container' : 'bg-surface-c text-muted-foreground')}>
    <Icon className={cn('size-6', active && fill && 'fill-current')} />{label}
  </button>;
}

/* Mobile Now Playing: cover/lyrics/queue on top, every control in the bottom (thumb) half. */
function MobileNowPlaying({ cur, liked, onClose }: { cur: Track; liked: boolean; onClose: () => void }) {
  const [pane, setPane] = React.useState<'art' | 'lyrics' | 'queue'>('art');
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const fx = usePlayer((s) => s.fx);
  const reduce = useReducedMotion();
  const toggle = (p: 'lyrics' | 'queue') => setPane((x) => (x === p ? 'art' : p));
  return <div className="relative flex min-h-0 flex-1 flex-col pb-[max(0.75rem,var(--sab))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
    <div className="flex items-center gap-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <button id="bpClose" type="button" aria-label="Свернуть плеер" onClick={onClose} className="flex size-12 items-center justify-center rounded-full active:bg-surface-high"><ChevronDown className="size-7" /></button>
      <span className="flex-1 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">{pane === 'lyrics' ? 'Текст' : pane === 'queue' ? 'Далее' : 'Сейчас играет'}</span>
      <span className="size-12" />
    </div>
    <div className="relative min-h-0 flex-1 px-5">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={pane} className="absolute inset-0 px-5" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
          {pane === 'art' ? <div className="flex h-full items-center justify-center py-2">
            <motion.div layoutId={reduce ? undefined : 'np-art'} className="relative aspect-square h-full max-h-[380px] max-w-full overflow-hidden rounded-[28px] bg-surface-high shadow-2xl">
              <img id="bpCover" src={ytThumb(cur.id, cur.thumbnail).replace('mqdefault', 'hqdefault')} alt="" className="absolute inset-0 size-full object-cover" />
            </motion.div>
          </div> : pane === 'lyrics' ? <div id="bpLyrics" className="h-full"><Lyrics cur={cur} /></div> : <div className="h-full py-2"><Queue /></div>}
        </motion.div>
      </AnimatePresence>
    </div>
    <div id="bpNow" className="flex shrink-0 flex-col gap-1.5 px-5 pt-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><h2 id="bpNowTitle" className="truncate text-[22px] font-semibold tracking-tight">{prettyTitle(cur.title)}</h2>
          <p id="bpNowArtist" className="truncate text-base text-muted-foreground">{artistOf(cur)}</p></div>
        <button type="button" aria-label={liked ? 'Убрать из любимых' : 'Нравится'} aria-pressed={liked} onClick={() => toggleLike(cur)} className={cn('flex size-12 shrink-0 items-center justify-center rounded-full active:scale-90', liked ? 'bg-primary-container text-on-primary-container' : 'text-muted-foreground')}><Heart className={cn('size-6', liked && 'fill-current')} /></button>
      </div>
      <SeekBar touch />
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Перемешивание" aria-pressed={shuffle} onClick={() => usePlayer.getState().toggleShuffle()} className={cn('flex size-12 items-center justify-center rounded-full transition-[border-radius,background-color] active:scale-90', shuffle ? 'bg-primary-container text-on-primary-container' : 'text-muted-foreground')}><Shuffle className="size-6" /></button>
        <button type="button" aria-label="Предыдущий трек" onClick={() => usePlayer.getState().prev()} className="flex size-14 items-center justify-center rounded-full active:scale-90 active:bg-surface-high"><SkipBack className="size-8 fill-current" /></button>
        <PlayButton size="hero" />
        <button type="button" aria-label="Следующий трек" onClick={() => usePlayer.getState().next()} className="flex size-14 items-center justify-center rounded-full active:scale-90 active:bg-surface-high"><SkipForward className="size-8 fill-current" /></button>
        <button type="button" aria-label={`Повтор: ${repeat}`} aria-pressed={repeat !== 'off'} onClick={() => usePlayer.getState().cycleRepeat()} className={cn('flex size-12 items-center justify-center rounded-full active:scale-90', repeat !== 'off' ? 'bg-primary-container text-on-primary-container' : 'text-muted-foreground')}>{repeat === 'one' ? <Repeat1 className="size-6" /> : <Repeat className="size-6" />}</button>
      </div>
      <div className="mt-2 flex gap-2">
        <ActionBtn icon={pane === 'lyrics' ? Disc3 : Mic2} label="Текст" active={pane === 'lyrics'} onClick={() => toggle('lyrics')} />
        <ActionBtn icon={ListMusic} label="Очередь" active={pane === 'queue'} onClick={() => toggle('queue')} />
        <ActionBtn icon={SlidersHorizontal} label="Звук" active={fx !== 'normal'} onClick={() => useSoundPanel.getState().set(true)} />
        <ActionBtn icon={Share2} label="Отправить" onClick={() => shareTrack(cur)} />
        <TrackMenu t={cur} align="end"><button type="button" aria-label="Ещё" className="flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-[20px] bg-surface-c text-[11px] font-medium text-muted-foreground transition-[border-radius,transform] duration-200 active:scale-95 active:rounded-xl min-[375px]:text-xs"><MoreHorizontal className="size-6" />Ещё</button></TrackMenu>
      </div>
    </div>
  </div>;
}
