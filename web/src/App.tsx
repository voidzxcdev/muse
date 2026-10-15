import * as React from 'react';
import { Toaster } from 'sonner';
import { useRouter } from '@/lib/router';
import { useSession } from '@/lib/session';
import { usePlayer } from '@/player/store';
import { useUI } from '@/lib/ui-store';
import { useTheme } from '@/hooks/theme';
import { registerSW, startNotifPoll, stopNotifPoll, checkUpdate, ensurePush } from '@/lib/services';
import { LibrarySheet, Sidebar, TabBar, TopBar } from '@/components/layout';
import { NowPlaying, PlayerBar } from '@/components/player';
import { AppPrompt, CookieBar, ModalHost, Onboarding } from '@/components/dialogs';
import { TooltipProvider } from '@/components/ui/misc';
import { HomeView } from '@/views/home';
import { SearchView } from '@/views/search';
import { LikedView, OwnPlaylistView, SharedView } from '@/views/library';
import { MarketView, UserView } from '@/views/social';
import { FriendsView } from '@/views/friends';

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
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className={chat ? 'scroll-pane min-h-0 flex-1' : 'scroll-pane min-h-0 flex-1 pb-[calc(57px+env(safe-area-inset-bottom))] md:pb-0'} style={{ viewTransitionName: 'main' }}>
          <View />
          {!chat && <div className={hasPlayer ? 'h-[68px] md:h-20' : ''} />}
        </main>
      </div>
    </div>
    <PlayerBar />
    <TabBar />
    <NowPlaying />
    <LibrarySheet />
    <ModalHost />
    <Onboarding />
    <CookieBar />
    <AppPrompt />
    <Toaster theme={theme === 'system' ? 'system' : theme} position="top-center" toastOptions={{ className: 'font-sans' }} />
  </TooltipProvider>;
}
