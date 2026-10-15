import { create } from 'zustand';
type Theme = 'dark' | 'light' | 'system';
const apply = (t: Theme) => {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#fcfcfc');
};
export const useTheme = create<{ theme: Theme; setTheme: (t: Theme) => void }>((set) => ({
  theme: (localStorage.getItem('muse:theme') as Theme) || 'dark',
  setTheme: (t) => { try { localStorage.setItem('muse:theme', t); } catch {} apply(t); set({ theme: t }); },
}));
apply(useTheme.getState().theme);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => apply(useTheme.getState().theme));
