import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Heart, ListEnd, ListPlus, MoreHorizontal, Play, Plus, Share2, Trash2, Search, ListMusic, GripVertical, ChevronLeft } from 'lucide-react';
import { Slot } from '@radix-ui/react-slot';
import { Dialog } from './ui/dialog';
import { cn, fmt, prettyTitle, ytThumb } from '@/lib/utils';
import type { Track } from '@/lib/types';
import { usePlayer } from '@/player/store';
import { useSession } from '@/lib/session';
import { useUI } from '@/lib/ui-store';
import { useRouter } from '@/lib/router';
import { addToPlaylist, needAuth, shareTrack, toggleLike } from '@/lib/actions';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function Eq({ paused }: { paused?: boolean }) {
  return <span className={cn('eq inline-flex items-end', paused && 'paused')} aria-hidden><i /><i /><i /></span>;
}

export function Thumb({ t, className, eager }: { t: Track; className?: string; eager?: boolean }) {
  const [src, setSrc] = React.useState(ytThumb(t.id, t.thumbnail || t.thumb));
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => { setSrc(ytThumb(t.id, t.thumbnail || t.thumb)); }, [t.id, t.thumbnail, t.thumb]);
  return <img src={src} alt="" draggable={false} decoding="async" loading={eager ? 'eager' : 'lazy'}
    onLoad={() => setLoaded(true)}
    onError={() => setSrc(`https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`)}
    className={cn('object-cover bg-muted transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0', className)} />;
}

export function TrackMenu({ t, children, onRemove, align = 'end' }: { t: Track; children: React.ReactNode; onRemove?: () => void; align?: 'start' | 'end' }) {
  const playlists = useSession((s) => s.playlists);
  const liked = useSession((s) => s.likedIds.has(t.id));
  const me = useSession((s) => s.me);
  const open = useUI((s) => s.open);
  const nav = useRouter((s) => s.navigate);
  const coarse = useCoarse();
  if (coarse) return <TrackSheet t={t} onRemove={onRemove}>{children}</TrackSheet>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => usePlayer.getState().play(t, [t], 'single')}><Play />Play</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { usePlayer.getState().playNext(t); toast.success('Plays next'); }}><ListEnd />Play next</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { usePlayer.getState().addToQueue(t); toast.success('Added to queue'); }}><ListMusic />Add to queue</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => toggleLike(t)}><Heart className={cn(liked && 'fill-current !text-foreground')} />{liked ? 'Remove from Liked' : 'Like'}</DropdownMenuItem>
        {me ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><ListPlus />Add to playlist</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuItem onSelect={() => open({ kind: 'newPlaylist', pending: t })}><Plus />New playlist</DropdownMenuItem>
              {playlists.length > 0 && <DropdownMenuSeparator />}
              {playlists.map((p) => <DropdownMenuItem key={p.id} onSelect={() => addToPlaylist(p.id, t)}><span className="truncate">{p.name}</span></DropdownMenuItem>)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : <DropdownMenuItem onSelect={() => needAuth()}><ListPlus />Add to playlist</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => {
          const parts = prettyTitle(t.title).split(/\s[-–—|]\s/);
          const artist = parts.length > 1 ? parts[0] : String(t.uploader || '').replace(/\s*-\s*Topic$/i, '');
          if (artist) nav({ view: 'search', q: artist, mode: 'songs' });
        }}><Search />More from artist</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => shareTrack(t)}><Share2 />Share</DropdownMenuItem>
        {onRemove && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={onRemove}><Trash2 />Remove</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* Touch devices: secondary track actions in a bottom sheet (drag handle to dismiss) instead of a dropdown. */
function useCoarse() {
  const q = '(pointer: coarse)';
  const [c, setC] = React.useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  React.useEffect(() => { const m = matchMedia(q); const f = () => setC(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return c;
}

function TrackSheet({ t, children, onRemove }: { t: Track; children: React.ReactNode; onRemove?: () => void }) {
  const [on, setOn] = React.useState(false);
  const [pl, setPl] = React.useState(false);
  const playlists = useSession((s) => s.playlists);
  const liked = useSession((s) => s.likedIds.has(t.id));
  const me = useSession((s) => s.me);
  const open = useUI((s) => s.open);
  const nav = useRouter((s) => s.navigate);
  const run = (f: () => void) => () => { setOn(false); setPl(false); setTimeout(f, 0); };
  const Item = ({ icon: Icon, label, onClick, danger }: { icon: any; label: React.ReactNode; onClick: () => void; danger?: boolean }) => (
    <button type="button" onClick={onClick} className={cn('flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base transition-[background-color,transform] active:scale-[0.98] active:bg-accent', danger && 'text-destructive')}>
      <Icon className={cn('size-5 shrink-0', danger ? '' : 'text-muted-foreground')} /><span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
  return <>
    <Slot onClick={(e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setOn(true); }}>{children as any}</Slot>
    <Dialog open={on} onOpenChange={(o) => { setOn(o); if (!o) setPl(false); }} side="bottom" hideClose>
      <div className="flex items-center gap-3 border-b pb-3">
        <img src={ytThumb(t.id, t.thumbnail)} alt="" className="size-12 shrink-0 rounded-md object-cover" />
        <div className="min-w-0"><div className="truncate text-base font-medium">{prettyTitle(t.title)}</div>{t.uploader && <div className="truncate text-sm text-muted-foreground">{t.uploader}</div>}</div>
      </div>
      <div className="mt-2 flex flex-col">
        {!pl ? <>
          <Item icon={Play} label="Play" onClick={run(() => usePlayer.getState().play(t, [t], 'single'))} />
          <Item icon={ListEnd} label="Play next" onClick={run(() => { usePlayer.getState().playNext(t); toast.success('Plays next'); })} />
          <Item icon={ListMusic} label="Add to queue" onClick={run(() => { usePlayer.getState().addToQueue(t); toast.success('Added to queue'); })} />
          <Item icon={Heart} label={liked ? 'Remove from Liked' : 'Like'} onClick={run(() => toggleLike(t))} />
          <Item icon={ListPlus} label="Add to playlist" onClick={() => (me ? setPl(true) : run(() => needAuth())())} />
          <Item icon={Search} label="More from artist" onClick={run(() => {
            const parts = prettyTitle(t.title).split(/\s[-–—|]\s/);
            const artist = parts.length > 1 ? parts[0] : String(t.uploader || '').replace(/\s*-\s*Topic$/i, '');
            if (artist) nav({ view: 'search', q: artist, mode: 'songs' });
          })} />
          <Item icon={Share2} label="Share" onClick={run(() => shareTrack(t))} />
          {onRemove && <Item icon={Trash2} label="Remove" danger onClick={run(onRemove)} />}
        </> : <>
          <Item icon={ChevronLeft} label="Back" onClick={() => setPl(false)} />
          <Item icon={Plus} label="New playlist" onClick={run(() => open({ kind: 'newPlaylist', pending: t }))} />
          {playlists.map((p) => <Item key={p.id} icon={ListMusic} label={p.name} onClick={run(() => addToPlaylist(p.id, t))} />)}
        </>}
      </div>
    </Dialog>
  </>;
}

function spot(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

/* Grid card: hover lifts (transform), spotlight glow, play button scales in. */
export function TrackCard({ t, i, list, source, sourceId, reason }: { t: Track; i: number; list: Track[]; source: string; sourceId?: any; reason?: string }) {
  const isCur = usePlayer((s) => s.current?.id === t.id);
  const playing = usePlayer((s) => s.playing);
  const liked = useSession((s) => s.likedIds.has(t.id));
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: reduce ? 0 : Math.min(i * 0.03, 0.3), ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={spot}
      className="spotlight group relative rounded-xl border bg-card p-2.5 transition-[border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-foreground/20"
    >
      <button type="button" className="block w-full text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-lg"
        onClick={() => usePlayer.getState().play(t, list, source, sourceId)} title="Play">
        <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
          <Thumb t={t} eager={i < 4} className="size-full transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
          <span className={cn('absolute bottom-2 right-2 flex size-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition-[opacity,transform] duration-200 ease-out',
            isCur ? 'opacity-100 scale-100' : 'opacity-0 scale-90 translate-y-1 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0')}>
            {isCur && playing ? <Eq /> : <Play className="size-4 fill-current translate-x-[1px]" />}
          </span>
          {!!t.duration && <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white backdrop-blur-sm">{fmt(t.duration)}</span>}
        </div>
        <h3 className={cn('mt-2.5 line-clamp-2 text-sm font-medium leading-snug', isCur && 'text-foreground underline decoration-foreground/30 underline-offset-4')}>{prettyTitle(t.title)}</h3>
        {(reason || t.uploader) && <p className="mt-0.5 truncate text-xs text-muted-foreground">{reason || t.uploader}</p>}
      </button>
      <div className="absolute right-3.5 top-3.5 flex gap-1 pointer-coarse:gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <button type="button" onClick={() => toggleLike(t)} aria-label="Like"
          className={cn('tap flex size-7 pointer-coarse:size-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform active:scale-90', liked && 'opacity-100')}>
          <Heart className={cn('size-3.5', liked && 'fill-current')} />
        </button>
        <TrackMenu t={t}>
          <button type="button" aria-label="More" className="tap flex size-7 pointer-coarse:size-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm active:scale-90"><MoreHorizontal className="size-4" /></button>
        </TrackMenu>
      </div>
      {liked && <Heart className="pointer-events-none absolute right-4 top-4 size-3.5 fill-white text-white drop-shadow group-hover:opacity-0 max-md:hidden" />}
    </motion.div>
  );
}

export function TrackGrid({ tracks, source, sourceId, reasons }: { tracks: Track[]; source: string; sourceId?: any; reasons?: boolean }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
    {tracks.map((t, i) => <TrackCard key={t.id + i} t={t} i={i} list={tracks} source={source} sourceId={sourceId} reason={reasons ? (t as any).reason : undefined} />)}
  </div>;
}

/* List row with optional drag handle (reordering handled by TrackList). */
export function TrackRow({ t, i, list, source, sourceId, onRemove, drag }: {
  t: Track; i: number; list: Track[]; source: string; sourceId?: any; onRemove?: () => void;
  drag?: { onPointerDown: (e: React.PointerEvent) => void; dragging: boolean };
}) {
  const isCur = usePlayer((s) => s.current?.id === t.id);
  const playing = usePlayer((s) => s.playing);
  const liked = useSession((s) => s.likedIds.has(t.id));
  return (
    <div data-row={i} className={cn('group grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60',
      isCur && 'bg-accent/40', drag?.dragging && 'opacity-40')}
      onDoubleClick={() => usePlayer.getState().play(t, list, source, sourceId)}>
      <div className="relative flex h-full items-center justify-center text-xs tabular-nums text-muted-foreground">
        {drag ? <span onPointerDown={drag.onPointerDown} className="absolute inset-0 hidden cursor-grab items-center justify-center touch-none group-hover:flex active:cursor-grabbing"><GripVertical className="size-4" /></span> : null}
        <span className={cn(drag && 'group-hover:invisible')}>{isCur ? <Eq paused={!playing} /> : i + 1}</span>
      </div>
      <button type="button" className="flex min-w-0 items-center gap-3 text-left outline-none" onClick={() => usePlayer.getState().play(t, list, source, sourceId)}>
        <div className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted">
          <Thumb t={t} className="size-full" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100"><Play className="size-4 fill-white text-white" /></span>
        </div>
        <div className="min-w-0">
          <div className={cn('truncate text-sm font-medium', isCur && 'underline decoration-foreground/30 underline-offset-4')}>{prettyTitle(t.title)}</div>
          {t.uploader && <div className="truncate text-xs text-muted-foreground">{t.uploader}</div>}
        </div>
      </button>
      <div className="flex items-center gap-1 pointer-coarse:gap-2">
        <button type="button" aria-label="Like" onClick={() => toggleLike(t)}
          className={cn('tap flex size-8 pointer-coarse:size-11 items-center justify-center rounded-md text-muted-foreground transition-[opacity,color] hover:text-foreground', liked ? 'text-foreground' : 'opacity-0 group-hover:opacity-100 max-md:opacity-100')}>
          <Heart className={cn('size-4', liked && 'fill-current')} />
        </button>
        <span className="hidden w-12 text-right font-mono text-xs text-muted-foreground sm:block">{t.duration ? fmt(t.duration) : ''}</span>
        <TrackMenu t={t} onRemove={onRemove}>
          <button type="button" aria-label="More" className="tap flex size-8 pointer-coarse:size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><MoreHorizontal className="size-4" /></button>
        </TrackMenu>
      </div>
    </div>
  );
}

/* Pointer-based reorder (transform-only ghost), commits order via onReorder. */
export function TrackList({ tracks, source, sourceId, onRemove, onReorder }: {
  tracks: Track[]; source: string; sourceId?: any; onRemove?: (t: Track, i: number) => void; onReorder?: (next: Track[]) => void;
}) {
  const [order, setOrder] = React.useState(tracks);
  const [dragI, setDragI] = React.useState<number | null>(null);
  React.useEffect(() => setOrder(tracks), [tracks]);
  const box = React.useRef<HTMLDivElement>(null);
  const start = (i: number) => (e: React.PointerEvent) => {
    if (!onReorder) return;
    e.preventDefault();
    setDragI(i);
    let cur = i;
    let list = order.slice();
    const move = (ev: PointerEvent) => {
      const rows = [...(box.current?.querySelectorAll<HTMLElement>('[data-row]') || [])];
      const over = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; });
      if (over >= 0 && over !== cur) {
        const [x] = list.splice(cur, 1); list.splice(over, 0, x); cur = over;
        setOrder(list.slice()); setDragI(over);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDragI(null);
      if (cur !== i) onReorder(list);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return <div ref={box} className="flex flex-col">
    {order.map((t, i) => <TrackRow key={(t.item_id || t.id) + ':' + i} t={t} i={i} list={order} source={source} sourceId={sourceId}
      onRemove={onRemove ? () => onRemove(t, i) : undefined}
      drag={onReorder ? { onPointerDown: start(i), dragging: dragI === i } : undefined} />)}
  </div>;
}

export function GridSkeleton({ n = 10 }: { n?: number }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
    {Array.from({ length: n }, (_, i) => <div key={i} className="rounded-xl border p-2.5" style={{ animationDelay: `${i * 50}ms` }}>
      <div className="aspect-video animate-pulse rounded-lg bg-muted" /><div className="mt-3 h-3.5 w-4/5 animate-pulse rounded bg-muted" /><div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
    </div>)}
  </div>;
}

export function Empty({ icon: Icon = ListMusic, title, sub, children }: { icon?: any; title: string; sub?: string; children?: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
    <div className="mb-4 flex size-12 items-center justify-center rounded-full border bg-card"><Icon className="size-5 text-muted-foreground" /></div>
    <h3 className="text-sm font-semibold">{title}</h3>
    {sub && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{sub}</p>}
    {children && <div className="mt-5">{children}</div>}
  </div>;
}
