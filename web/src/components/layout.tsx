import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bell, Heart, Home, LayoutGrid, Library, LogIn, LogOut, MoreHorizontal, Plus, Scale, Search, Settings, Shuffle, User, Users, X, Moon, Sun, Monitor, Music2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from '@/lib/router';
import { useSession } from '@/lib/session';
import { useUI } from '@/lib/ui-store';
import { usePlayer } from '@/player/store';
import { mixAll } from '@/lib/actions';
import { Avatar, Kbd, Tip } from './ui/misc';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Dialog } from './ui/dialog';
import { useTheme } from '@/hooks/theme';

export const LEGAL = [
  ['/privacy', 'Privacy', 'What I keep'], ['/gdpr', 'GDPR', 'Controller · France host'], ['/terms', 'Terms', 'Rules and liability'],
  ['/cookies', 'Cookies', 'Reject is a real choice'], ['/dpa', 'Processor', 'Not an Art. 28 contract'],
  ['/subprocessors', 'Who else', 'Cloudflare, Contabo, Groq'], ['/sla', 'Uptime', 'Measured, not a sticker'],
  ['/credits', 'Credits', 'YouTube, authors, art'], ['/dmca', 'Copyright', 'Hosted files only'],
] as const;

function NavItem({ active, icon: Icon, label, onClick, count, id }: { active: boolean; icon: any; label: string; onClick: () => void; count?: React.ReactNode; id?: string }) {
  return (
    <button id={id} type="button" onClick={onClick}
      className={cn('relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 pointer-coarse:py-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50')}>
      {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-md bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
      <Icon className="relative size-4" />
      <span className="relative flex-1 text-left">{label}</span>
      {count ? <span className="relative font-mono text-[11px] text-muted-foreground">{count}</span> : null}
    </button>
  );
}

export function AccountMenu({ children, align = 'start', side = 'top' }: { children: React.ReactNode; align?: 'start' | 'end'; side?: 'top' | 'bottom' }) {
  const me = useSession((s) => s.me);
  const logout = useSession((s) => s.logout);
  const open = useUI((s) => s.open);
  const nav = useRouter((s) => s.navigate);
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-60">
        {me ? <>
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar user={me} size={36} />
            <div className="min-w-0"><div className="truncate text-sm font-semibold">{me.display}</div><div className="truncate text-xs text-muted-foreground">@{me.handle}</div></div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => nav({ view: 'user', handle: me.handle })}><User />Профиль</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open({ kind: 'settings' })}><Settings />Параметры</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => open({ kind: 'notifs' })}><Bell />Уведомления</DropdownMenuItem>
        </> : <DropdownMenuItem onSelect={() => open({ kind: 'auth', tab: 'signin' })}><LogIn />Sign in</DropdownMenuItem>}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{theme === 'light' ? <Sun /> : theme === 'dark' ? <Moon /> : <Monitor />}Тема</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => setTheme('dark')}><Moon />Dark</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme('light')}><Sun />Light</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme('system')}><Monitor />System</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {me && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => { logout(); nav({ view: 'home' }); }}><LogOut />Выйти</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MoreMenu({ children, side = 'right', align = 'start' }: { children: React.ReactNode; side?: 'right' | 'top' | 'bottom'; align?: 'start' | 'end' | 'center' }) {
  const nav = useRouter((s) => s.navigate);
  const unseen = useSession((s) => s.unseen);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-64">
        <DropdownMenuItem onSelect={() => nav({ view: 'market' })}><LayoutGrid /><div><div>Маркетплейс</div><div className="text-xs text-muted-foreground">Плейлистов</div></div></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => nav({ view: 'friends', handle: '' })}><Users /><span className="flex-1">Друзья</span>{unseen > 0 && <span className="rounded-full bg-foreground px-1.5 text-[10px] font-semibold text-background">{unseen}</span>}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Scale /><div><div>Legal</div><div className="text-xs text-muted-foreground">Privacy, GDPR, terms</div></div></DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <DropdownMenuLabel>Legal</DropdownMenuLabel>
            {LEGAL.map(([href, b, i]) => <DropdownMenuItem key={href} onSelect={() => window.open(href, '_blank', 'noopener')}><div><div>{b}</div><div className="text-xs text-muted-foreground">{i}</div></div></DropdownMenuItem>)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlaylistLinks({ onPick }: { onPick?: () => void }) {
  const playlists = useSession((s) => s.playlists);
  const route = useRouter((s) => s.route);
  const nav = useRouter((s) => s.navigate);
  const reduce = useReducedMotion();
  return <div className="flex flex-col gap-0.5">
    <AnimatePresence initial={false}>
      {playlists.map((p) => {
        const active = route.view === 'ownpl' && route.slug === p.slug;
        const cover = p.custom_cover || p.cover;
        return <motion.button layout={!reduce} key={p.id} type="button"
          initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.2 }}
          onClick={() => { nav({ view: 'ownpl', slug: p.slug }); onPick?.(); }}
          className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors', active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
          <span className="size-8 shrink-0 overflow-hidden rounded bg-muted">{cover ? <img src={cover} alt="" className="size-full object-cover" /> : <Music2 className="m-2 size-4" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.count} tracks{p.listed ? ' · Market' : ''}</span></span>
        </motion.button>;
      })}
    </AnimatePresence>
  </div>;
}

export function Sidebar() {
  const route = useRouter((s) => s.route);
  const nav = useRouter((s) => s.navigate);
  const me = useSession((s) => s.me);
  const likeCount = useSession((s) => s.likeCount);
  const unseen = useSession((s) => s.unseen);
  const open = useUI((s) => s.open);
  return (
    <aside id="side" className="hidden h-dvh w-64 shrink-0 flex-col border-r bg-sidebar/40 md:flex">
      <button id="sideBrand" type="button" onClick={() => nav({ view: 'home' })} className="flex items-center gap-2.5 px-5 pb-4 pt-5 outline-none">
        <img src="/muselogo.png?v=172" alt="" className="size-7 rounded-md" />
        <span className="text-[15px] font-semibold tracking-tight">Muse</span>
        <span className="ml-auto rounded-full border px-1.5 py-px font-mono text-[10px] text-muted-foreground">beta</span>
      </button>
      <nav className="flex flex-col gap-0.5 pointer-coarse:gap-2 px-3">
        <NavItem active={route.view === 'home' || route.view === 'search'} icon={Home} label="Home" onClick={() => nav({ view: 'home' })} />
        <NavItem active={route.view === 'liked'} icon={Heart} label="Liked Songs" count={likeCount || undefined} onClick={() => nav({ view: 'liked' })} />
        <NavItem active={route.view === 'market'} icon={LayoutGrid} label="Marketplace" onClick={() => nav({ view: 'market' })} />
        <NavItem active={route.view === 'friends'} icon={Users} label="Friends" count={unseen || undefined} onClick={() => nav({ view: 'friends', handle: '' })} />
        <MoreMenu><button id="sideMore" type="button" className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"><MoreHorizontal className="size-4" />More</button></MoreMenu>
      </nav>
      <div className="mt-6 flex items-center justify-between px-5 pb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Playlists</span>
        <div className="flex gap-0.5 pointer-coarse:gap-3">
          <Tip label="Mix everything"><button type="button" onClick={() => mixAll(usePlayer.getState().play)} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Shuffle className="size-3.5" /></button></Tip>
          <Tip label="New playlist"><button id="newPl" type="button" onClick={() => me ? open({ kind: 'newPlaylist' }) : open({ kind: 'auth', tab: 'signin' })} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="size-3.5" /></button></Tip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-gutter:stable]">
        {me ? <PlaylistLinks /> : <p className="px-2 text-xs leading-relaxed text-muted-foreground">Sign in to save likes and playlists.</p>}
      </div>
      <div className="border-t p-3">
        <AccountMenu>
          <button id="sideUser" type="button" className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-accent/60">
            {me ? <Avatar user={me} size={30} /> : <span className="flex size-[30px] items-center justify-center rounded-full border"><User className="size-4 text-muted-foreground" /></span>}
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{me ? me.display : 'Sign in'}</span><span className="block truncate text-xs text-muted-foreground">{me ? `@${me.handle}` : 'Save your music'}</span></span>
            {unseen > 0 && <span className="size-2 rounded-full bg-foreground" />}
          </button>
        </AccountMenu>
      </div>
    </aside>
  );
}

export function TopBar() {
  const route = useRouter((s) => s.route);
  const nav = useRouter((s) => s.navigate);
  const me = useSession((s) => s.me);
  const [q, setQ] = React.useState(route.view === 'search' ? route.q : '');
  const [mode, setMode] = React.useState<'songs' | 'people'>(route.view === 'search' ? route.mode : 'songs');
  const inp = React.useRef<HTMLInputElement>(null);
  const timer = React.useRef<any>(0);
  React.useEffect(() => { if (route.view !== 'search') setQ(''); else { setQ(route.q); setMode(route.mode); } }, [route]);
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); inp.current?.focus(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const run = (v: string, m = mode) => {
    clearTimeout(timer.current);
    const s = v.trim();
    if (!s) { nav({ view: 'home' }); return; }
    if (s.length < 2) return;
    timer.current = setTimeout(() => nav({ view: 'search', q: s, mode: m }), 260);
  };
  return (
    <header id="topbar" className="sticky top-0 z-30 shrink-0 border-b pt-[env(safe-area-inset-top)] bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-8">
        <button type="button" onClick={() => nav({ view: 'home' })} aria-label="Home" className="tap shrink-0 md:hidden"><img src="/muselogo.png?v=172" alt="Muse" className="size-7 max-w-none rounded-md" /></button>
        <form id="searchForm" role="search" className="relative flex min-w-0 max-w-xl flex-1 items-center" onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); if (q.trim().length >= 1) nav({ view: 'search', q: q.trim(), mode }); }}>
          <div className="relative flex h-9 pointer-coarse:h-11 w-full items-center rounded-lg border bg-muted/40 transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:ring-[3px] focus-within:ring-ring/20">
            <div id="qSwitch" role="tablist" aria-label="Search type" className="relative ml-1 flex h-7 items-center gap-0.5 rounded-md p-0.5 pointer-coarse:gap-2">
              {(['songs', 'people'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} title={m === 'songs' ? 'Search songs' : 'Search people'}
                  onClick={() => { setMode(m); if (q.trim().length >= 2) nav({ view: 'search', q: q.trim(), mode: m }); inp.current?.focus(); }}
                  className={cn('tap relative flex h-6 w-7 items-center justify-center rounded transition-colors', mode === m ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {mode === m && <motion.span layoutId="qpill" className="absolute inset-0 rounded bg-background shadow-sm dark:bg-accent" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />}
                  {m === 'songs' ? <Search className="relative size-3.5" /> : <Users className="relative size-3.5" />}
                </button>
              ))}
            </div>
            <input ref={inp} id="q" value={q} autoComplete="off" spellCheck={false}
              placeholder={mode === 'people' ? 'Search people…' : 'Search a song…'}
              onChange={(e) => { setQ(e.target.value); run(e.target.value); }}
              className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground" />
            {q ? <button id="qClear" type="button" aria-label="Clear search" onClick={() => { setQ(''); nav({ view: 'home' }); inp.current?.focus(); }} className="tap mr-2 rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
              : <Kbd className="mr-2 hidden sm:inline-flex">/</Kbd>}
          </div>
        </form>
        <div className="ml-auto flex shrink-0 items-center gap-2 md:hidden">
          <AccountMenu side="bottom" align="end">
            <button type="button" aria-label="Account" className="tap">{me ? <Avatar user={me} size={30} /> : <span className="flex size-[30px] items-center justify-center rounded-full border"><User className="size-4" /></span>}</button>
          </AccountMenu>
        </div>
      </div>
    </header>
  );
}

export function TabBar() {
  const route = useRouter((s) => s.route);
  const nav = useRouter((s) => s.navigate);
  const setLib = useUI((s) => s.setLibrarySheet);
  const unseen = useSession((s) => s.unseen);
  const item = (key: string, active: boolean, Icon: any, label: string, onClick: () => void, extra?: React.ReactNode, id?: string) => (
    <button key={key} id={id} type="button" onClick={onClick} className={cn('relative flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-[color,transform] active:scale-95', active ? 'text-foreground' : 'text-muted-foreground')}>
      {active && <motion.span layoutId="tab-ind" className="absolute top-0 h-0.5 w-8 rounded-full bg-foreground" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
      <Icon className="size-5" />{label}{extra}
    </button>
  );
  return (
    <nav id="tabbar" aria-label="Primary" className="kb-hide fixed inset-x-0 bottom-0 z-40 flex h-[calc(56px+env(safe-area-inset-bottom))] border-t bg-background/85 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-xl md:hidden">
      {item('home', route.view === 'home' || route.view === 'search', Home, 'Home', () => nav({ view: 'home' }))}
      {item('liked', route.view === 'liked', Heart, 'Liked', () => nav({ view: 'liked' }))}
      {item('friends', route.view === 'friends', Users, 'Friends', () => nav({ view: 'friends', handle: '' }), unseen ? <span className="absolute right-[30%] top-1.5 size-2 rounded-full bg-foreground" /> : null)}
      <MoreMenu side="top" align="center"><button id="tabMore" type="button" className="flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-transform active:scale-95"><MoreHorizontal className="size-5" />More</button></MoreMenu>
      {item('lib', false, Library, 'Library', () => setLib(true), null, 'tabLib')}
    </nav>
  );
}

export function LibrarySheet() {
  const on = useUI((s) => s.librarySheet);
  const set = useUI((s) => s.setLibrarySheet);
  const me = useSession((s) => s.me);
  const open = useUI((s) => s.open);
  return (
    <Dialog open={on} onOpenChange={set} side="bottom" title="Library">
      <div className="mt-3 flex items-center justify-between">
        {me ? <div className="flex items-center gap-2"><Avatar user={me} size={28} /><span className="text-sm font-medium">{me.display}</span></div>
          : <button type="button" className="text-sm underline" onClick={() => { set(false); open({ kind: 'auth', tab: 'signin' }); }}>Sign in</button>}
        <div className="flex gap-2">
          <button type="button" onClick={() => { set(false); mixAll(usePlayer.getState().play); }} className="min-h-11 rounded-md border px-4 text-sm active:scale-95">Mix all</button>
          <button id="sheetNew" type="button" onClick={() => { set(false); me ? open({ kind: 'newPlaylist' }) : open({ kind: 'auth', tab: 'signin' }); }} className="min-h-11 rounded-md border px-4 text-sm active:scale-95">+ New</button>
        </div>
      </div>
      <div className="mt-4">{me ? <PlaylistLinks onPick={() => set(false)} /> : null}</div>
    </Dialog>
  );
}
