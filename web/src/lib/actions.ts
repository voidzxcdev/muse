import { toast } from 'sonner';
import { api, post, req } from './api';
import { useSession } from './session';
import { useUI } from './ui-store';
import { useRouter } from './router';
import type { Track } from './types';
import { plPath, writeClip, ytThumb } from './utils';

export function needAuth(): boolean {
  if (useSession.getState().me) return false;
  useUI.getState().open({ kind: 'auth', tab: 'signin' });
  return true;
}

export async function toggleLike(t: Track) {
  if (needAuth()) return;
  const s = useSession.getState();
  const was = s.likedIds.has(t.id);
  s.setLiked(t.id, !was);
  try {
    const j = await post<{ liked: boolean }>('/api/like', { video_id: t.id, title: t.title,
      thumbnail: t.thumbnail || t.thumb || ytThumb(t.id), duration: t.duration ?? null });
    if (j.liked !== !was) useSession.getState().setLiked(t.id, j.liked);
  } catch (e: any) {
    useSession.getState().setLiked(t.id, was);
    toast.error(e.message || 'Like failed');
  }
}

export async function addToPlaylist(pid: number, t: Track) {
  try {
    const j = await post(`/api/playlists/${pid}/tracks`, { video_id: t.id, title: t.title,
      thumbnail: t.thumbnail || t.thumb || ytThumb(t.id), duration: t.duration ?? null });
    const pl = useSession.getState().playlists.find((p) => p.id === pid);
    toast.success(j.duplicate ? `Already in ${pl?.name || 'playlist'}` : `Added to ${pl?.name || 'playlist'}`);
    useSession.getState().refreshPlaylists();
  } catch (e: any) { toast.error(e.message || 'Could not add'); }
}

export async function createPlaylist(name: string, pending?: Track | null) {
  const j = await post<{ id: number; name: string; slug: string }>('/api/playlists', { name });
  await useSession.getState().refreshPlaylists();
  if (pending) await addToPlaylist(j.id, pending);
  return j;
}

export async function deletePlaylist(pid: number) {
  await req('DELETE', `/api/playlists/${pid}`);
  await useSession.getState().refreshPlaylists();
  const r = useRouter.getState().route;
  if (r.view === 'ownpl' || r.view === 'playlist') useRouter.getState().navigate({ view: 'home' });
  toast.success('Playlist deleted');
}

export async function copyPlaylistLink(handle: string, slug: string) {
  const ok = await writeClip(location.origin + plPath(handle, slug));
  if (ok) toast.success('Link copied'); else toast.error('Could not copy');
}

export async function takeShared(handle: string, slug: string) {
  if (!useSession.getState().me) { useUI.getState().setPendingTake({ handle, slug }); needAuth(); return; }
  try {
    const j = await post<{ id?: number; mine?: boolean }>(`/api/p/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/take`, {});
    if (j.mine) toast('This is already yours');
    await useSession.getState().refreshPlaylists();
    const pl = useSession.getState().playlists.find((p) => p.id === j.id);
    if (pl) useRouter.getState().navigate({ view: 'ownpl', slug: pl.slug });
  } catch (e: any) { toast.error(e.message || 'Could not add playlist'); }
}

export async function shareTrack(t: Track) {
  const url = `https://www.youtube.com/watch?v=${t.id}`;
  try { if (navigator.share) { await navigator.share({ title: t.title, url }); return; } } catch { return; }
  if (await writeClip(url)) toast.success('Link copied');
}

export async function mixAll(play: (t: Track, l: Track[], s: string) => void) {
  if (needAuth()) return;
  try {
    const [likes, pls] = await Promise.all([api('/api/likes'), api('/api/playlists')]);
    let pool: Track[] = [...(likes.tracks || [])];
    for (const p of pls.playlists || []) {
      try { pool = pool.concat((await api(`/api/playlists/${p.id}/tracks`)).tracks || []); } catch {}
    }
    const seen = new Set<string>();
    pool = pool.filter((t) => t.id && !seen.has(t.id) && (seen.add(t.id), true));
    if (!pool.length) { toast('Like some songs first'); return; }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    play(pool[0], pool, 'mix');
  } catch {}
}
