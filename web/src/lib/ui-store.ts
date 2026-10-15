import { create } from 'zustand';
import type { Track } from './types';

type Modal =
  | { kind: 'auth'; tab: 'signin' | 'signup' }
  | { kind: 'settings' } | { kind: 'newPlaylist'; pending?: Track | null }
  | { kind: 'addTo'; track: Track } | { kind: 'rename'; id: number; name: string }
  | { kind: 'cover'; target: 'avatar' | number; file: File }
  | { kind: 'publish' } | { kind: 'notifs' } | { kind: 'media'; type: 'image' | 'video'; src: string }
  | { kind: 'confirm'; title: string; body?: string; danger?: boolean; action: string; onConfirm: () => void | Promise<void> }
  | null;

interface UIState {
  modal: Modal;
  open: (m: Modal) => void;
  close: () => void;
  librarySheet: boolean;
  setLibrarySheet: (on: boolean) => void;
  pendingTake: { handle: string; slug: string } | null;
  setPendingTake: (p: { handle: string; slug: string } | null) => void;
}
export const useUI = create<UIState>((set) => ({
  modal: null,
  open: (m) => set({ modal: m }),
  close: () => set({ modal: null }),
  librarySheet: false,
  setLibrarySheet: (on) => set({ librarySheet: on }),
  pendingTake: null,
  setPendingTake: (p) => set({ pendingTake: p }),
}));
