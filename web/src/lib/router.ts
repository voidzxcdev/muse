import { create } from 'zustand';
import { flushSync } from 'react-dom';

export type Route =
  | { view: 'home' } | { view: 'search'; q: string; mode: 'songs' | 'people' } | { view: 'liked' } | { view: 'market' }
  | { view: 'friends'; handle: string } | { view: 'user'; handle: string }
  | { view: 'shared'; handle: string; slug: string } | { view: 'ownpl'; slug: string } | { view: 'playlist'; id: number };

const LANE = /^\/(pc|web|mobile\/iphone|mobile\/android)(?=\/|$)/;
export function laneBase() { const m = location.pathname.match(LANE); return m ? m[0] : ''; }

export function parse(path = location.pathname): Route {
  let p = path.replace(/\/+$/, '') || '/';
  p = p.replace(LANE, '') || '/';
  if (p === '/' || p === '/home') return { view: 'home' };
  if (p === '/liked') return { view: 'liked' };
  if (p === '/market') return { view: 'market' };
  const fr = p.match(/^\/friends(?:\/([A-Za-z0-9_.-]{2,24}))?$/);
  if (fr) return { view: 'friends', handle: (fr[1] || '').toLowerCase() };
  const u = p.match(/^\/@([A-Za-z0-9_.-]{2,24})$/);
  if (u) return { view: 'user', handle: u[1].toLowerCase() };
  const sh = p.match(/^\/p\/([A-Za-z0-9_.-]{2,24})\/([^/]+)$/);
  if (sh) return { view: 'shared', handle: sh[1].toLowerCase(), slug: decodeURIComponent(sh[2]) };
  const own = p.match(/^\/p\/([^/]+)$/);
  if (own) return { view: 'ownpl', slug: decodeURIComponent(own[1]) };
  return { view: 'home' };
}

export function pathOf(r: Route): string {
  switch (r.view) {
    case 'home': case 'search': return '/home';
    case 'liked': return '/liked';
    case 'market': return '/market';
    case 'friends': return r.handle ? `/friends/${r.handle}` : '/friends';
    case 'user': return `/@${r.handle}`;
    case 'shared': return `/p/${encodeURIComponent(r.handle)}/${encodeURIComponent(r.slug)}`;
    case 'ownpl': return `/p/${encodeURIComponent(r.slug)}`;
    case 'playlist': return location.pathname;
  }
}

interface RouterState { route: Route; navigate: (r: Route, opts?: { replace?: boolean }) => void }

function withTransition(fn: () => void) {
  const d = document as any;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!d.startViewTransition || reduce) { fn(); return; }
  d.startViewTransition(() => flushSync(fn));
}

export const useRouter = create<RouterState>((set, get) => ({
  route: parse(),
  navigate: (r, opts = {}) => {
    const url = pathOf(r);
    if (r.view !== 'search' && r.view !== 'playlist' && location.pathname !== url) {
      try { history[opts.replace ? 'replaceState' : 'pushState']({ muse: 1 }, '', url); } catch {}
    }
    const prev = get().route;
    if (JSON.stringify(prev) === JSON.stringify(r)) return;
    const swap = () => set({ route: r });
    if (r.view === 'search' && prev.view === 'search') swap(); else withTransition(swap);
    if (r.view !== 'search') window.scrollTo({ top: 0 });
  },
}));

window.addEventListener('popstate', () => withTransition(() => useRouter.setState({ route: parse() })));

/* Legacy behaviour: bare "/" is rewritten to the lane path. */
(function bootLanePath() {
  const p = location.pathname.replace(/\/+$/, '') || '/';
  if (p !== '/') return;
  const l = window.__museLane;
  const dest = l === 'pc' ? '/pc' : l === 'android' ? '/mobile/android' : l === 'iphone' ? '/mobile/iphone' : '/web';
  try { history.replaceState({ muse: 1 }, '', dest); } catch {}
})();
