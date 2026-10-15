import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Music2, Play, Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlayer } from '@/player/store';
import type { Track } from '@/lib/types';
import { cn } from '@/lib/utils';

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1400px] px-4 pb-10 pt-6 md:px-8', className)}>{children}</div>;
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return <div className="mb-4 flex items-end justify-between gap-3">
    <div><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{sub && <p className="text-sm text-muted-foreground">{sub}</p>}</div>{right}
  </div>;
}

export function Cover({ src, className, name }: { src?: string; className?: string; name?: string }) {
  return <div className={cn('relative overflow-hidden bg-muted', className)}>
    {src ? <img src={src} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center bg-gradient-to-br from-muted to-accent text-muted-foreground">{name ? <span className="text-4xl font-semibold">{name[0]?.toUpperCase()}</span> : <Music2 className="size-8" />}</div>}
  </div>;
}

/* Header for liked / playlists / shared: cover, title, meta, actions. */
export function ViewHeader({ kind, title, sub, cover, tracks, source, sourceId, actions, coverNode }: {
  kind: string; title: React.ReactNode; sub?: React.ReactNode; cover?: string; tracks: Track[]; source: string; sourceId?: any; actions?: React.ReactNode; coverNode?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const play = usePlayer((s) => s.play);
  return <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    className="relative mb-8 flex flex-col gap-6 overflow-hidden rounded-2xl border bg-card p-5 sm:flex-row sm:items-end md:p-7">
    <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
    <div className="relative">{coverNode || <Cover src={cover} name={typeof title === 'string' ? title : undefined} className="size-36 rounded-xl border shadow-lg md:size-44" />}</div>
    <div className="relative min-w-0 flex-1">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{kind}</p>
      <h1 className="mt-1 break-words text-3xl font-bold tracking-tighter md:text-5xl">{title}</h1>
      {sub && <div className="mt-2 text-sm text-muted-foreground">{sub}</div>}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button disabled={!tracks.length} onClick={() => tracks.length && play(tracks[0], tracks, source, sourceId)}><Play className="fill-current" />Play</Button>
        <Button variant="outline" disabled={!tracks.length} onClick={() => { if (!tracks.length) return; const t = tracks[Math.floor(Math.random() * tracks.length)]; if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle(); play(t, tracks, source, sourceId); }}><Shuffle />Shuffle</Button>
        {actions}
      </div>
    </div>
  </motion.div>;
}

export function useAsync<T>(fn: () => Promise<T>, deps: any[]) {
  const [state, set] = React.useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [n, bump] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    set((s) => ({ ...s, loading: true, error: null }));
    fn().then((d) => !dead && set({ data: d, error: null, loading: false })).catch((e) => !dead && set({ data: null, error: e, loading: false }));
    return () => { dead = true; };
  }, [...deps, n]);
  return { ...state, reload: () => bump((x) => x + 1), setData: (d: T) => set((s) => ({ ...s, data: d })) };
}
