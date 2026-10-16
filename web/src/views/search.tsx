import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { SearchX, Users } from 'lucide-react';
import { fetchJSON } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useRouter } from '@/lib/router';
import type { PubUser, Track } from '@/lib/types';
import { hiddenTrack } from '@/lib/utils';
import { prefetchStreams } from '@/player/store';
import { Empty, GridSkeleton, TrackGrid } from '@/components/tracks';
import { Avatar } from '@/components/ui/misc';
import { Page, SectionTitle } from './common';

export function SearchView({ q, mode }: { q: string; mode: 'songs' | 'people' }) {
  const [res, setRes] = React.useState<{ tracks?: Track[]; users?: PubUser[]; error?: string } | null>(null);
  const nav = useRouter((s) => s.navigate);
  const reduce = useReducedMotion();
  React.useEffect(() => {
    const ctl = new AbortController();
    setRes(null);
    (async () => {
      try {
        if (mode === 'people') {
          const j = await fetchJSON(`/api/users?q=${encodeURIComponent(q.replace(/^@/, ''))}&n=12`, { signal: ctl.signal }, 12000);
          setRes({ users: j.users || [] });
        } else {
          const j = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}&n=12`, { signal: ctl.signal }, 12000);
          const tracks = (j.results || []).filter((r: Track) => !hiddenTrack(r));
          setRes({ tracks });
          useSession.getState().markLiked(tracks.map((t: Track) => t.id));
          // Warm the stream URL of the top 2 results once the user stops typing.
          const pf = setTimeout(() => { if (!ctl.signal.aborted) prefetchStreams(tracks.slice(0, 2).map((t: Track) => t.id)); }, 900);
          ctl.signal.addEventListener('abort', () => clearTimeout(pf));
          // Phase 2 (legacy parity): background enrich patches durations/uploader
          if (tracks.length) fetchJSON(`/api/enrich?ids=${tracks.map((t: Track) => t.id).join(',')}`, { signal: ctl.signal }, 20000).then((e) => {
            const map = new Map<string, any>((e.cards || []).map((x: any) => [x.id, x]));
            if (!map.size) return;
            setRes((r) => r && r.tracks ? { tracks: r.tracks.map((t) => map.has(t.id) ? { ...t, ...map.get(t.id) } : t) } : r);
          }).catch(() => {});
        }
      } catch (e: any) { if (e?.name !== 'AbortError') setRes({ error: e.message || 'Search failed' }); }
    })();
    return () => ctl.abort();
  }, [q, mode]);
  return <Page>
    <SectionTitle title={mode === 'people' ? 'People' : 'Songs'} sub={`Results for “${q}”`} />
    {!res ? <GridSkeleton n={12} /> : res.error ? <Empty icon={SearchX} title="Search failed" sub={res.error} /> :
      mode === 'people' ? (res.users!.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {res.users!.map((u, i) => <motion.button key={u.handle} type="button" onClick={() => nav({ view: 'user', handle: u.handle })}
          initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: reduce ? 0 : i * 0.03 }}
          className="flex flex-col items-center gap-3 rounded-xl border bg-card p-5 text-center transition-[border-color,transform] hover:-translate-y-0.5 hover:border-foreground/20">
          <Avatar user={u} size={72} online={u.online} />
          <div className="min-w-0"><div className="truncate text-sm font-medium">{u.display || u.handle}</div><div className="truncate text-xs text-muted-foreground">{u.online ? 'онлайн' : `@${u.handle}`}</div></div>
        </motion.button>)}
      </div> : <Empty icon={Users} title="No people found." />)
      : (res.tracks!.length ? <TrackGrid tracks={res.tracks!} source="search" /> : <Empty icon={SearchX} title="No songs found." sub="Try a different spelling or the artist name." />)}
  </Page>;
}
