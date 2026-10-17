import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { Check, Crown, Heart, Lock, MessageCircle, Plus, Store, Upload, UserPlus, Clock, Trash2, Link2 } from 'lucide-react';
import { api, post } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useUI } from '@/lib/ui-store';
import { useRouter } from '@/lib/router';
import { needAuth, copyPlaylistLink } from '@/lib/actions';
import type { Listing } from '@/lib/types';
import { cn, fmtJoined, seenLabel, shownTracks, publicLink, writeClip } from '@/lib/utils';
import { Empty, TrackList } from '@/components/tracks';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Skeleton, Tip } from '@/components/ui/misc';
import { Cover, Page, SectionTitle, useAsync } from './common';

const fmtHours = (h?: number) => { const n = Number(h || 0); return n < 1 ? `${Math.round(n * 60)} мин` : `${n < 10 ? n.toFixed(1) : Math.round(n)} ч`; };

export function UserView({ handle }: { handle: string }) {
  const me = useSession((s) => s.me);
  const nav = useRouter((s) => s.navigate);
  const open = useUI((s) => s.open);
  const reduce = useReducedMotion();
  const { data, loading, error, reload } = useAsync(() => api<any>(`/api/u/${encodeURIComponent(handle)}`), [handle, me?.id]);
  React.useEffect(() => { document.title = `@${handle} · Muse`; return () => { document.title = 'Muse'; }; }, [handle]);
  if (loading && !data) return <Page><div className="flex flex-col items-center gap-4 py-10"><Skeleton className="size-28 rounded-full" /><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-24" /></div></Page>;
  if (error || !data) return <Page><Empty title={`Профиль @${handle} не найден.`} /></Page>;
  const u = data.user || {}; const st = data.stats || {}; const priv = data.privacy || {};
  const omitted = new Set<string>(data.omitted || []);
  const locked = !!data.hidden && !u.mine;
  const likes = shownTracks(data.likes); const pls = data.playlists || [];
  const showLikes = !locked && (u.mine || !omitted.has('likes'));
  const showPl = !locked && (u.mine || !omitted.has('playlists'));
  const badges = (!locked && (u.mine || !omitted.has('badges'))) ? (data.badges || []) : [];
  const friendAct = async () => {
    if (needAuth()) return;
    try {
      if (data.friend === 'incoming') { await post('/api/friends/accept', { handle: u.handle }); toast.success('Теперь вы друзья'); }
      else if (data.friend === 'none') { await post('/api/friends/request', { handle: u.handle }); toast.success('Заявка отправлена'); }
      reload();
    } catch (e: any) { toast.error(e.message || 'Could not send request'); }
  };
  return <Page className="max-w-5xl">
    <motion.section initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl  bg-card px-6 pb-8 pt-10 text-center">
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col items-center">
        {locked ? <span className="flex size-28 items-center justify-center rounded-full bg-muted"><Lock className="size-8 text-muted-foreground" /></span> : <Avatar user={u} size={112} online={!u.mine && u.online} className="ring-4 ring-background" />}
        <h1 className="mt-4 text-3xl font-bold tracking-tighter">{locked ? 'Профиль скрыт' : u.display || u.handle}</h1>
        <p className="text-sm text-muted-foreground">@{u.handle || handle}</p>
        {u.mine && !!(priv.hidden || priv.anon || priv.avatar || priv.badges) && <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {!!priv.hidden && <Badge variant="outline">Профиль скрыт для других</Badge>}{!!priv.anon && <Badge variant="outline">Для других имя — Аноним</Badge>}
          {!!priv.avatar && <Badge variant="outline">Фото скрыто</Badge>}{!!priv.badges && <Badge variant="outline">Значки скрыты</Badge>}</div>}
        {!u.mine && !locked && seenLabel(u) && <p className={cn('mt-1 text-xs', u.online ? 'text-emerald-500' : 'text-muted-foreground')}>{seenLabel(u)}</p>}
        {locked && <p className="mt-2 text-sm text-muted-foreground">Этот профиль закрыт.</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {u.mine ? <><Button variant="outline" onClick={() => open({ kind: 'settings' })}>Edit profile</Button><Button variant="ghost" onClick={async () => { if (await writeClip(publicLink(u.handle))) toast.success('Link copied'); }}><Link2 />Copy link</Button></>
            : data.friend === 'friends' ? <Button onClick={() => nav({ view: 'friends', handle: u.handle })}><MessageCircle />Message</Button>
            : data.friend === 'outgoing' ? <Button variant="outline" disabled><Clock />Request sent</Button>
            : data.friend === 'incoming' ? <Button onClick={friendAct}><Check />Accept</Button>
            : <Button onClick={friendAct}><UserPlus />Add friend</Button>}
        </div>
        {badges.length > 0 && <div className="mt-6 flex flex-wrap justify-center gap-2">
          {badges.map((b: any) => { const id = String(b.id || '').replace(/[^a-z0-9]/g, ''); if (!id) return null; return <Tip key={id} label={<span><b>{b.name || id}</b>{b.desc ? <span className="block opacity-70">{b.desc}</span> : null}{b.tier === 'legendary' ? <span className="block">секретный</span> : null}</span>}>
            <span tabIndex={0} className={cn('flex size-11 items-center justify-center rounded-xl  bg-background transition-transform hover:-translate-y-0.5', b.tier === 'legendary' && 'border-chart-1/60 shadow-[0_0_24px_-6px_var(--chart-1)]')}><img src={`/badges/${id}.png?v=4`} alt={b.name || id} className="size-7" /></span></Tip>; })}
        </div>}
      </div>
      {!locked && <div className="relative mt-8 grid grid-cols-3 divide-x rounded-xl  bg-surface-high backdrop-blur">
        {[[fmtHours(st.hours), 'всего прослушано'], [st.songs || 0, 'треков'], [fmtJoined(u.created), 'регистрация']].map(([b, s]) => <div key={String(s)} className="px-2 py-4"><div className="text-lg font-semibold tracking-tight">{b}</div><div className="text-xs text-muted-foreground">{s}</div></div>)}
      </div>}
    </motion.section>
    {showPl && <section className="mt-10"><SectionTitle title="Плейлисты" sub={u.mine && priv.playlists ? 'скрыто для других' : undefined} />
      {pls.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{pls.map((p: any) => <button key={p.id} type="button" onClick={() => nav({ view: 'shared', handle: (u.handle || handle).toLowerCase(), slug: p.slug || String(p.id) })}
        className="group rounded-xl  bg-card p-2.5 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:bg-surface-high">
        <Cover src={p.custom_cover || p.cover} name={p.name} className="aspect-square rounded-lg" /><div className="mt-2 truncate text-sm font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.count || 0} треков</div></button>)}</div>
        : <p className="text-sm text-muted-foreground">Нет плейлистов.</p>}</section>}
    {showLikes && <section className="mt-10"><SectionTitle title="Liked Songs" sub={u.mine && priv.likes ? 'скрыто для других' : undefined} />
      {likes.length ? <TrackList tracks={likes} source="profile" /> : <p className="text-sm text-muted-foreground">Nothing liked yet.</p>}</section>}
  </Page>;
}

function ListingCard({ c, rank, onLike, onUnpublish, i }: { c: Listing; rank?: number; onLike: () => void; onUnpublish: () => void; i: number }) {
  const nav = useRouter((s) => s.navigate);
  const reduce = useReducedMotion();
  return <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: reduce ? 0 : Math.min(i * 0.03, 0.3) }}
    className={cn('group relative rounded-xl  bg-card p-3 transition-[border-color,transform] hover:-translate-y-0.5 hover:bg-surface-high', rank && 'p-4')}>
    <button type="button" className="block w-full text-left" onClick={() => nav({ view: 'shared', handle: c.owner.handle, slug: c.slug })}>
      <div className="relative">
        <Cover src={c.custom_cover || c.cover} name={c.name} className="aspect-square rounded-lg" />
        {rank && <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-xs font-semibold backdrop-blur">{rank === 1 && <Crown className="size-3" />}#{rank}</span>}
      </div>
      <div className="mt-3 truncate font-medium">{c.name}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Avatar user={c.owner} size={16} /><span className="truncate">@{c.owner.handle} · {c.count} tracks</span></div>
    </button>
    <div className="mt-3 flex items-center justify-between">
      <button type="button" onClick={onLike} className={cn('flex items-center gap-1.5 rounded-md  px-2 py-1 text-xs transition-[color,transform] active:scale-95', c.liked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
        <Heart className={cn('size-3.5', c.liked && 'fill-current')} />{c.likes}</button>
      {c.mine && <Tip label="Remove from Marketplace"><button type="button" onClick={onUnpublish} className="rounded-md p-1 text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></Tip>}
    </div>
  </motion.div>;
}

export function MarketView() {
  const me = useSession((s) => s.me);
  const open = useUI((s) => s.open);
  const { data, loading, reload, setData } = useAsync(() => api<{ top: Listing[]; listings: Listing[]; all: Listing[]; mine: number[] }>('/api/market'), [me?.id]);
  const like = async (c: Listing) => {
    if (needAuth()) return;
    const patch = (l: Listing) => l.id === c.id ? { ...l, liked: !c.liked, likes: c.likes + (c.liked ? -1 : 1) } : l;
    if (data) setData({ ...data, top: data.top.map(patch), listings: data.listings.map(patch) });
    try { const j = await post('/api/market/like', { playlist_id: c.id }); if (j && typeof j.likes === 'number' && data) reload(); } catch (e: any) { toast.error(e.message); reload(); }
  };
  const unpub = async (c: Listing) => { try { await post('/api/market/unpublish', { playlist_id: c.id }); toast.success('Removed'); reload(); useSession.getState().refreshPlaylists(); } catch (e: any) { toast.error(e.message); } };
  return <Page>
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Community</p><h1 className="mt-1 text-4xl font-bold tracking-tighter">Маркетплейс</h1><p className="mt-1 text-muted-foreground">Плейлисты от людей с Muse. Лайкай лучшие — они поднимаются в топ.</p></div>
      <Button onClick={() => me ? open({ kind: 'publish' }) : needAuth()}><Upload />Publish a playlist</Button>
    </div>
    {loading && !data ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-xl" />)}</div>
      : !data || !data.all.length ? <Empty icon={Store} title="Пока пусто" sub="Будь первым — опубликуй свой плейлист."><Button onClick={() => me ? open({ kind: 'publish' }) : needAuth()}><Plus />Publish</Button></Empty>
      : <>
        {data.top.length > 0 && <section className="mb-10"><SectionTitle title="Top" /><div className="grid gap-3 sm:grid-cols-3">{data.top.map((c, i) => <ListingCard key={c.id} c={c} rank={i + 1} i={i} onLike={() => like(c)} onUnpublish={() => unpub(c)} />)}</div></section>}
        {data.listings.length > 0 && <section><SectionTitle title="All playlists" /><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{data.listings.map((c, i) => <ListingCard key={c.id} c={c} i={i} onLike={() => like(c)} onUnpublish={() => unpub(c)} />)}</div></section>}
      </>}
  </Page>;
}
