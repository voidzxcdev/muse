import { create } from 'zustand';
import { api, post, setSwrUser, swr, swrClear, swrGet } from './api';
import type { Playlist, User } from './types';

interface SessionState {
  me: User | null;
  ready: boolean;
  playlists: Playlist[];
  likedIds: Set<string>;
  likeCount: number;
  unseen: number;
  setMe: (u: User | null) => void;
  refreshMe: () => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  markLiked: (ids: string[]) => Promise<void>;
  setLiked: (id: string, on: boolean) => void;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  me: swrGet<{ user: User | null }>('/api/me')?.user ?? null,
  ready: false,
  playlists: [],
  likedIds: new Set(),
  likeCount: 0,
  unseen: 0,
  setMe: (u) => { setSwrUser(u?.id ?? null); set({ me: u }); },
  refreshMe: async () => {
    try {
      await swr<{ user: User | null }>('/api/me', (j) => { setSwrUser(j.user?.id ?? null); set({ me: j.user }); });
    } catch { /* offline: keep cached */ }
    set({ ready: true });
    if (get().me) {
      get().refreshPlaylists();
      api<{ tracks: { id: string }[] }>('/api/likes').then((j) => {
        set({ likedIds: new Set((j.tracks || []).map((t) => t.id)), likeCount: (j.tracks || []).length });
      }).catch(() => {});
    } else set({ playlists: [], likedIds: new Set(), likeCount: 0 });
  },
  refreshPlaylists: async () => {
    if (!get().me) { set({ playlists: [] }); return; }
    try { await swr<{ playlists: Playlist[] }>('/api/playlists', (j) => set({ playlists: j.playlists || [] })); } catch {}
  },
  markLiked: async (ids) => {
    if (!get().me || !ids.length) return;
    try {
      const j = await api<{ liked: string[] }>(`/api/liked_ids?ids=${ids.slice(0, 60).join(',')}`);
      const s = new Set(get().likedIds);
      ids.forEach((id) => s.delete(id));
      (j.liked || []).forEach((id) => s.add(id));
      set({ likedIds: s });
    } catch {}
  },
  setLiked: (id, on) => {
    const s = new Set(get().likedIds);
    if (on) s.add(id); else s.delete(id);
    set({ likedIds: s, likeCount: Math.max(0, get().likeCount + (on ? 1 : -1)) });
  },
  logout: async () => {
    try { await post('/api/logout'); } catch {}
    swrClear();
    setSwrUser(null);
    set({ me: null, playlists: [], likedIds: new Set(), likeCount: 0, unseen: 0 });
  },
}));
