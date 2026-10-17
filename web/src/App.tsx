import * as React from 'react';
import { Toaster } from 'sonner';
import { useRouter } from '@/lib/router';
import { useSession } from '@/lib/session';
import { usePlayer } from '@/player/store';
import { useUI } from '@/lib/ui-store';
import { useTheme } from '@/hooks/theme';
import { registerSW, startNotifPoll, stopNotifPoll, checkUpdate, ensurePush } from '@/lib/services';
import { LibrarySheet, MeSheet, Sidebar, TabBar, TopBar } from '@/components/layout';
import { NowPlaying, PlayerBar, RightPanel } from '@/components/player';
import { SoundPanel } from '@/components/sound-panel';
import { AppearanceDialog } from '@/components/theme-picker';
import { cn } from '@/lib/utils';
import { AppPrompt, CookieBar, ModalHost, Onboarding } from '@/components/dialogs';
import { TooltipProvider } from '@/components/ui/misc';
import { HomeView } from '@/views/home';
import { useKeyboardInset } from '@/hooks/viewport';
// Heavy routes are code-split; Home stays in the main chunk for first paint.
const SearchView = React.lazy(() => import('@/views/search').then((m) => ({ default: m.SearchView })));
const LikedView = React.lazy(() => import('@/views/library').then((m) => ({ default: m.LikedView })));
const OwnPlaylistView = React.lazy(() => import('@/views/library').then((m) => ({ default: m.OwnPlaylistView })));
const SharedView = React.lazy(() => import('@/views/library').then((m) => ({ default: m.SharedView })));
const MarketView = React.lazy(() => import('@/views/social').then((m) => ({ default: m.MarketView })));
const UserView = React.lazy(() => import('@/views/social').then((m) => ({ default: m.UserView })));
const FriendsView = React.lazy(() => import('@/views/friends').then((m) => ({ default: m.FriendsView })));

function View() {
  const r = useRouter((s) => s.route);
  switch (r.view) {
    case 'home': return <HomeView />;
    case 'search': return <SearchView key={r.mode + r.q} q={r.q} mode={r.mode} />;
    case 'liked': return <LikedView />;
    case 'market': return <MarketView />;
    case 'friends': return <FriendsView handle={r.handle} />;
    case 'user': return <UserView key={r.handle} handle={r.handle} />;
    case 'shared': return <SharedView key={r.handle + r.slug} handle={r.handle} slug={r.slug} />;
    case 'ownpl': return <OwnPlaylistView key={r.slug} slug={r.slug} />;
    default: return <HomeView />;
  }
}

export default function App() {
  const me = useSession((s) => s.me);
  const theme = useTheme((s) => s.theme);
  const hasPlayer = usePlayer((s) => !!s.current);
  const route = useRouter((s) => s.route);
  useKeyboardInset();
  React.useEffect(() => { const r = document.documentElement.style; r.setProperty('--player-h', hasPlayer ? '76px' : '0px'); r.setProperty('--shell-pb', hasPlayer ? '120px' : '16px'); }, [hasPlayer]);

  React.useEffect(() => {
    useSession.getState().refreshMe();
    registerSW();
    checkUpdate();
    const t = setInterval(checkUpdate, 10 * 60 * 1000);
    /* Desktop shell (WinForms WebView2) mini-player messages */
    try {
      const w = window.chrome?.webview;
      w?.addEventListener?.('message', (e: any) => {
        let d = e?.data; try { if (typeof d === 'string') d = JSON.parse(d); } catch { return; }
        if (d?.type === 'muse-chrome') document.documentElement.classList.toggle('muse-mini', !!d.mini);
      });
    } catch {}
    return () => clearInterval(t);
  }, []);
  React.useEffect(() => { if (me) { startNotifPoll(); ensurePush(); } else stopNotifPoll(); }, [me?.id]);

  /* Global keyboard: space play/pause, ←/→ seek, shift+←/→ prev/next, L like */
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (useUI.getState().modal) return;
      const p = usePlayer.getState();
      if (e.code === 'Space') { e.preventDefault(); p.toggle(); }
      else if (e.key === 'ArrowRight' && e.shiftKey) p.next();
      else if (e.key === 'ArrowLeft' && e.shiftKey) p.prev();
      else if (e.key === 'ArrowRight' && p.duration) p.seek((p.time + 5) / p.duration);
      else if (e.key === 'ArrowLeft' && p.duration) p.seek((p.time - 5) / p.duration);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const chat = route.view === 'friends';
  return <TooltipProvider>
    <div aria-hidden className="mesh-bg" />
    <div className="relative flex h-[var(--app-h,100dvh)] flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1 md:gap-4 md:px-4 md:pb-[var(--shell-pb,16px)] md:pl-[max(1rem,env(safe-area-inset-left))] md:pr-[max(1rem,env(safe-area-inset-right))]">
        <Sidebar />
        <main id="main" className={cn(chat ? 'nav-pad flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden' : 'scroll-pane nav-pad min-h-0 min-w-0 flex-1', 'md:rounded-[28px] md:bg-surface-c')} style={{ viewTransitionName: 'main' }}>
          <React.Suspense fallback={<div className="flex h-40 items-center justify-center" aria-busy="true"><span className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" /></div>}>
            <View />
          </React.Suspense>
        </main>
        <RightPanel />
      </div>
    </div>
    <PlayerBar />
    <TabBar />
    <NowPlaying />
    <SoundPanel />
    <AppearanceDialog />
    <LibrarySheet />
    <MeSheet />
    <ModalHost />
    <Onboarding />
    <CookieBar />
    <AppPrompt />
    <Toaster theme={theme === 'system' ? 'system' : theme === 'auto' ? 'dark' : theme} position="top-center" toastOptions={{ className: 'font-sans' }} />
  </TooltipProvider>;
}
