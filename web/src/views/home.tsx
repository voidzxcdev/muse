import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Download, Heart, LayoutGrid, Sparkles, Users, Shuffle } from 'lucide-react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useRouter } from '@/lib/router';
import { usePlayer } from '@/player/store';
import { mixAll } from '@/lib/actions';
import type { Track } from '@/lib/types';
import { hiddenTrack } from '@/lib/utils';
import { GridSkeleton, TrackGrid } from '@/components/tracks';
import { Page, SectionTitle } from './common';
import { isAndroidApp, isDeskApp, isIOS, isAndroidWeb } from '@/lib/env';

async function loadPopular(): Promise<Track[]> {
  let tracks: Track[] = [];
  try { tracks = ((await api('/api/popular?n=18')).tracks || []).filter((t: Track) => !hiddenTrack(t)); } catch {}
  if (tracks.length < 6) {
    try {
      const seen = new Set(tracks.map((t) => t.id));
      for (const t of (await api('/api/search?q=popular%20songs&n=15')).results || []) {
        if (hiddenTrack(t) || seen.has(t.id)) continue; tracks.push(t); seen.add(t.id); if (tracks.length >= 18) break;
      }
    } catch {}
  }
  return tracks;
}
const heardCount = (uid?: number) => { try { return JSON.parse(localStorage.getItem(`muse:heard:${uid}`) || '[]').length; } catch { return 0; } };

export function HomeView() {
  const me = useSession((s) => s.me);
  const nav = useRouter((s) => s.navigate);
  const likeCount = useSession((s) => s.likeCount);
  const reduce = useReducedMotion();
  const day = Math.floor(Date.now() / 86400000);
  const wantFy = !!(me && heardCount(me.id) >= 3);
  const cacheKey = wantFy ? `muse:fy:${me!.id}` : 'muse:popular';
  const cached = React.useMemo(() => { try { const s = JSON.parse(localStorage.getItem(cacheKey) || 'null'); return s && s.day === day ? s.tracks as Track[] : null; } catch { return null; } }, [cacheKey]);
  const [tracks, setTracks] = React.useState<Track[] | null>(cached);
  const [mode, setMode] = React.useState<'fy' | 'popular'>(wantFy ? 'fy' : 'popular');
  React.useEffect(() => {
    let dead = false; let tries = 0; let timer: any;
    const run = async () => {
      let m: 'fy' | 'popular' = 'popular'; let list: Track[] = [];
      if (me) {
        try {
          const j = await api('/api/recommendations?n=18');
          const recos = (j.tracks || []).filter((t: Track) => !hiddenTrack(t));
          const personal = recos.some((t: any) => t.reason && t.reason !== 'Fresh for you');
          if (recos.length >= 4 && (personal || heardCount(me.id) >= 3)) { list = recos; m = 'fy'; }
          else if (j.building && ++tries < 3) timer = setTimeout(run, 7000);
        } catch {}
      }
      if (m === 'popular') list = await loadPopular();
      if (dead) return;
      if (list.length) {
        setTracks(list); setMode(m);
        try { localStorage.setItem(m === 'fy' ? `muse:fy:${me!.id}` : 'muse:popular', JSON.stringify({ day, tracks: list })); } catch {}
        useSession.getState().markLiked(list.map((t) => t.id));
      } else if (!tracks) setTracks([]);
    };
    run();
    return () => { dead = true; clearTimeout(timer); };
  }, [me?.id]);
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const showApps = !isDeskApp() && !isAndroidApp && !isIOS;
  const quick = [
    { icon: Heart, label: 'Liked Songs', sub: likeCount ? `${likeCount} tracks` : 'Your favourites', on: () => nav({ view: 'liked' }) },
    { icon: Shuffle, label: 'Mix everything', sub: 'Likes + playlists', on: () => mixAll(usePlayer.getState().play) },
    { icon: LayoutGrid, label: 'Marketplace', sub: 'Community playlists', on: () => nav({ view: 'market' }) },
    { icon: Users, label: 'Friends', sub: 'Chat & listen', on: () => nav({ view: 'friends', handle: '' }) },
  ];
  return <Page>
    <section className="relative mb-10 overflow-hidden rounded-2xl  bg-card px-6 py-10 md:px-10 md:py-14">
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-foreground/[0.06] blur-3xl" />
      <motion.div initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="relative">
        <span className="inline-flex items-center gap-1.5 rounded-full  bg-surface-high px-2.5 py-1 text-xs text-muted-foreground backdrop-blur"><Sparkles className="size-3" />{mode === 'fy' ? 'Picked for you today' : 'Trending today'}</span>
        <h1 className="mt-4 text-4xl font-bold tracking-tighter md:text-6xl">{me ? `${greet}, ${me.display}.` : 'Type. Stream. Done.'}</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">{me ? 'Pick up where you left off, or search anything — every letter searches.' : 'Search any song and press play. Create an account to save likes and playlists.'}</p>
      </motion.div>
      <div className="relative mt-8 grid grid-cols-2 gap-2 md:grid-cols-4">
        {quick.map((q, i) => <motion.button key={q.label} type="button" onClick={q.on}
          initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: reduce ? 0 : 0.08 + i * 0.04 }}
          className="group flex items-center gap-3 rounded-xl  bg-surface-high p-3 text-left backdrop-blur transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-surface-high">
          <span className="flex size-9 items-center justify-center rounded-lg  bg-card transition-colors group-hover:bg-foreground group-hover:text-background"><q.icon className="size-4" /></span>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{q.label}</span><span className="block truncate text-xs text-muted-foreground">{q.sub}</span></span>
        </motion.button>)}
      </div>
    </section>
    <div id="homeFy">
      <SectionTitle title={mode === 'fy' ? 'For you' : 'Popular right now'} sub={mode === 'fy' ? 'Based on what you play and like' : 'What everyone is playing'} />
      {tracks === null ? <GridSkeleton /> : tracks.length ? <TrackGrid tracks={tracks} source={mode === 'fy' ? 'foryou' : 'home'} reasons={mode === 'fy'} /> : <p className="text-sm text-muted-foreground">Nothing here yet — try searching.</p>}
    </div>
    {showApps && <div className="mt-12 grid gap-3 md:grid-cols-2">
      {!isAndroidWeb && <a href="/desktop/Muse-Setup.exe" className="group flex items-center gap-4 rounded-xl  p-4 transition-colors hover:bg-surface-high">
        <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background"><Download className="size-4" /></span>
        <span><span className="block text-sm font-medium">Muse for Windows</span><span className="block text-xs text-muted-foreground">One window, tray, auto-update.</span></span></a>}
      <a href="/android/Muse.apk" download="Muse.apk" className="group flex items-center gap-4 rounded-xl  p-4 transition-colors hover:bg-surface-high">
        <span className="flex size-10 items-center justify-center rounded-lg bg-foreground text-background"><Download className="size-4" /></span>
        <span><span className="block text-sm font-medium">Muse for Android</span><span className="block text-xs text-muted-foreground">Background play, auto-update.</span></span></a>
    </div>}
  </Page>;
}
