import * as React from 'react';
import { toast } from 'sonner';
import { Heart, ImagePlus, Link2, Lock, MoreHorizontal, Pencil, Plus, Store, Trash2, Upload } from 'lucide-react';
import { api, req, post } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useUI } from '@/lib/ui-store';
import { useRouter } from '@/lib/router';
import { copyPlaylistLink, deletePlaylist, takeShared } from '@/lib/actions';
import type { PlaylistDetail, Track } from '@/lib/types';
import { shownTracks } from '@/lib/utils';
import { Empty, TrackList } from '@/components/tracks';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/misc';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Cover, Page, ViewHeader, useAsync } from './common';

function Locked({ title, sub }: { title: string; sub: string }) {
  const open = useUI((s) => s.open);
  return <Page><Empty icon={Lock} title={title} sub={sub}><Button onClick={() => open({ kind: 'auth', tab: 'signin' })}>Sign in</Button></Empty></Page>;
}

function RowsSkeleton() {
  return <div className="flex flex-col gap-2">{Array.from({ length: 8 }, (_, i) => <div key={i} className="flex items-center gap-3 px-2 py-1.5"><div className="size-10 animate-pulse rounded-md bg-muted" /><div className="flex-1"><div className="h-3.5 w-1/3 animate-pulse rounded bg-muted" /><div className="mt-2 h-3 w-1/5 animate-pulse rounded bg-muted" /></div></div>)}</div>;
}

export function LikedView() {
  const me = useSession((s) => s.me);
  const { data, loading, setData } = useAsync(() => me ? api<{ tracks: Track[] }>('/api/likes') : Promise.resolve({ tracks: [] }), [me?.id]);
  const likedIds = useSession((s) => s.likedIds);
  if (!me) return <Locked title="Liked Songs" sub="Sign in to keep the songs you love in one place." />;
  const tracks = shownTracks(data?.tracks).filter((t) => likedIds.size === 0 || likedIds.has(t.id));
  return <Page>
    <ViewHeader kind="Playlist" title="Liked Songs" sub={`${tracks.length} tracks · @${me.handle}`} tracks={tracks} source="liked"
      coverNode={<div className="flex size-36 items-center justify-center rounded-xl border bg-gradient-to-br from-foreground to-foreground/60 text-background shadow-lg md:size-44"><Heart className="size-14 fill-current" /></div>} />
    {loading && !data ? <RowsSkeleton /> : tracks.length ? <TrackList tracks={tracks} source="liked"
      onReorder={async (next) => { setData({ tracks: next }); try { await req('PATCH', '/api/likes/order', { video_ids: next.map((t) => t.id) }); } catch (e: any) { toast.error(e.message); } }} />
      : <Empty icon={Heart} title="No liked songs yet" sub="Tap the heart on any song to save it here." />}
  </Page>;
}

export function OwnPlaylistView({ slug }: { slug: string }) {
  const me = useSession((s) => s.me);
  const playlists = useSession((s) => s.playlists);
  const open = useUI((s) => s.open);
  const nav = useRouter((s) => s.navigate);
  const meta = playlists.find((p) => p.slug === slug);
  const pid = meta?.id;
  const { data, loading, setData, reload } = useAsync(() => pid ? api<PlaylistDetail>(`/api/playlists/${pid}/tracks`) : Promise.resolve(null), [pid, meta?.count]);
  const fileRef = React.useRef<HTMLInputElement>(null);
  if (!me) return <Locked title="Playlist" sub="Sign in to see your playlists." />;
  if (!meta) return <Page><RowsSkeleton /></Page>;
  const tracks = shownTracks(data?.tracks);
  const cover = data?.custom_cover || meta.custom_cover || meta.cover || tracks[0]?.thumbnail;
  return <Page>
    <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) open({ kind: 'cover', target: meta.id, file: f }); e.target.value = ''; }} />
    <ViewHeader kind={meta.listed ? 'Playlist · on Marketplace' : 'Playlist'} title={meta.name} sub={`${tracks.length} tracks · @${me.handle}`} tracks={tracks} source="playlist" sourceId={meta.id}
      coverNode={<button type="button" onClick={() => fileRef.current?.click()} className="group relative block size-36 overflow-hidden rounded-xl border shadow-lg md:size-44" title="Change cover">
        <Cover src={cover} name={meta.name} className="size-full" />
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"><ImagePlus className="size-5" />Change cover</span>
      </button>}
      actions={<>
        <Button variant="outline" onClick={() => copyPlaylistLink(me.handle, data?.slug || meta.slug)}><Link2 />Share</Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => open({ kind: 'rename', id: meta.id, name: meta.name })}><Pencil />Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}><ImagePlus />Change cover</DropdownMenuItem>
            {meta.listed ? <DropdownMenuItem onSelect={async () => { try { await post('/api/market/unpublish', { playlist_id: meta.id }); toast.success('Removed from Marketplace'); useSession.getState().refreshPlaylists(); } catch (e: any) { toast.error(e.message); } }}><Store />Remove from Marketplace</DropdownMenuItem>
              : <DropdownMenuItem disabled={!meta.can_publish} onSelect={async () => { try { await post('/api/market', { playlist_id: meta.id }); toast.success('Published to Marketplace'); useSession.getState().refreshPlaylists(); } catch (e: any) { toast.error(e.message || 'Не вышло опубликовать'); } }}><Upload />Publish to Marketplace</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => open({ kind: 'confirm', title: `Delete “${meta.name}”?`, body: 'This cannot be undone.', danger: true, action: 'Delete', onConfirm: () => deletePlaylist(meta.id) })}><Trash2 />Delete playlist</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
      </>} />
    {loading && !data ? <RowsSkeleton /> : tracks.length ? <TrackList tracks={tracks} source="playlist" sourceId={meta.id}
      onRemove={async (t) => { try { await req('DELETE', `/api/playlist-items/${t.item_id}`); setData({ ...data!, tracks: tracks.filter((x) => x.item_id !== t.item_id) }); useSession.getState().refreshPlaylists(); toast.success('Removed'); } catch (e: any) { toast.error(e.message); } }}
      onReorder={async (next) => { setData({ ...data!, tracks: next }); try { await req('PATCH', `/api/playlists/${meta.id}/order`, { ids: next.map((t) => t.item_id) }); } catch (e: any) { toast.error(e.message); reload(); } }} />
      : <Empty title="This playlist is empty" sub="Use the + on any song or the track menu to add music." ><Button variant="outline" onClick={() => document.getElementById('q')?.focus()}><Plus />Find songs</Button></Empty>}
  </Page>;
}

export function SharedView({ handle, slug }: { handle: string; slug: string }) {
  const nav = useRouter((s) => s.navigate);
  const { data, loading, error } = useAsync(() => api<any>(`/api/p/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`), [handle, slug]);
  if (loading) return <Page><RowsSkeleton /></Page>;
  if (error || !data) return <Page><Empty title="Playlist not found" sub="It may have been renamed or deleted." /></Page>;
  const pl = data.playlist; const owner = data.owner;
  const tracks = shownTracks(pl.tracks);
  return <Page>
    <ViewHeader kind="Shared playlist" title={pl.name} cover={pl.custom_cover || pl.cover} tracks={tracks} source="shared" sourceId={pl.id}
      sub={<button type="button" onClick={() => nav({ view: 'user', handle: owner.handle })} className="inline-flex items-center gap-2 hover:text-foreground"><Avatar user={owner} size={20} />{owner.display} · @{owner.handle} · {tracks.length} tracks</button>}
      actions={<>
        {!data.mine && <Button variant="outline" onClick={() => takeShared(handle, slug)}><Plus />Add to my library</Button>}
        <Button variant="ghost" onClick={() => copyPlaylistLink(owner.handle, pl.slug)}><Link2 />Copy link</Button>
      </>} />
    {tracks.length ? <TrackList tracks={tracks} source="shared" sourceId={pl.id} /> : <Empty title="Empty playlist" />}
  </Page>;
}
