import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bell, ChevronRight, Heart, Home, LayoutGrid, Library, LogIn, LogOut, MoreHorizontal, Plus, Search, Settings, Shuffle, User, Users, X, Moon, Sun, Monitor, Music2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from '@/lib/router';
import { useSession } from '@/lib/session';
import { useUI } from '@/lib/ui-store';
import { usePlayer } from '@/player/store';
import { mixAll } from '@/lib/actions';
import { Avatar, Kbd, Tip } from './ui/misc';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from './ui/dropdown-menu';
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
      <div className="flex h-16 md:h-14 items-center gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-8">
        <button type="button" onClick={() => nav({ view: 'home' })} aria-label="Home" className="tap shrink-0 md:hidden"><img src="/muselogo.png?v=172" alt="Muse" className="size-7 max-w-none rounded-md" /></button>
        <form id="searchForm" role="search" className="relative flex min-w-0 max-w-xl flex-1 items-center" onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); if (q.trim().length >= 1) nav({ view: 'search', q: q.trim(), mode }); }}>
          <div className="relative flex h-12 md:h-9 w-full items-center rounded-xl md:rounded-lg border bg-muted/40 transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:ring-[3px] focus-within:ring-ring/20">
            <div id="qSwitch" role="tablist" aria-label="Search type" className="relative ml-1 flex h-10 md:h-7 items-center gap-0.5 rounded-lg md:rounded-md p-0.5">
              {(['songs', 'people'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} title={m === 'songs' ? 'Search songs' : 'Search people'} aria-label={m === 'songs' ? 'Search songs' : 'Search people'}
                  onClick={() => { setMode(m); if (q.trim().length >= 2) nav({ view: 'search', q: q.trim(), mode: m }); inp.current?.focus(); }}
                  className={cn('tap relative flex h-9 w-10 md:h-6 md:w-7 items-center justify-center rounded-md md:rounded transition-colors', mode === m ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {mode === m && <motion.span layoutId="qpill" className="absolute inset-0 rounded bg-background shadow-sm dark:bg-accent" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />}
                  {m === 'songs' ? <Search className="relative size-5 md:size-3.5" /> : <Users className="relative size-5 md:size-3.5" />}
                </button>
              ))}
            </div>
            <input ref={inp} id="q" value={q} autoComplete="off" spellCheck={false}
              placeholder={mode === 'people' ? 'Search people…' : 'Search a song…'}
              onChange={(e) => { setQ(e.target.value); run(e.target.value); }}
              enterKeyHint="search" className="h-full min-w-0 flex-1 bg-transparent px-2 text-base md:text-sm outline-none placeholder:text-muted-foreground" />
            {q ? <button id="qClear" type="button" aria-label="Clear search" onClick={() => { setQ(''); nav({ view: 'home' }); inp.current?.focus(); }} className="tap mr-1 flex size-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground md:mr-2 md:size-auto md:p-0.5"><X className="size-5 md:size-3.5" /></button>
              : <Kbd className="mr-2 hidden sm:inline-flex">/</Kbd>}
          </div>
        </form>
      </div>
    </header>
  );
}

/* Mobile: one-handed bottom bar — 64px + safe area, 24px icons, always-visible labels. */
export function TabBar() {
  const route = useRouter((s) => s.route);
  const nav = useRouter((s) => s.navigate);
  const setLib = useUI((s) => s.setLibrarySheet);
  const lib = useUI((s) => s.librarySheet);
  const meOpen = useUI((s) => s.meSheet);
  const setMe = useUI((s) => s.setMeSheet);
  const me = useSession((s) => s.me);
  const unseen = useSession((s) => s.unseen);
  const sheet = lib || meOpen;
  const item = (key: string, active: boolean, icon: React.ReactNode, label: string, onClick: () => void, extra?: React.ReactNode, id?: string) => (
    <button key={key} id={id} type="button" onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined}
      className={cn('relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs transition-[color,transform] active:scale-95',
        active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
      <span className="relative flex h-8 w-14 items-center justify-center">
        {active && <motion.span layoutId="tab-ind" className="absolute inset-0 rounded-full bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
        <span className="relative">{icon}</span>{extra}
      </span>
      <span className="relative leading-none">{label}</span>
    </button>
  );
  const focusSearch = () => {
    if (route.view !== 'home' && route.view !== 'search') nav({ view: 'home' });
    setTimeout(() => { const q = document.getElementById('q') as HTMLInputElement | null; q?.focus(); q?.select(); }, 60);
  };
  return (
    <nav id="tabbar" aria-label="Primary" className="kb-hide fixed inset-x-0 bottom-0 z-40 flex h-[calc(64px+env(safe-area-inset-bottom))] border-t bg-background/90 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-xl md:hidden">
      {item('home', !sheet && route.view === 'home', <Home className="size-6" />, 'Главная', () => nav({ view: 'home' }), null, 'tabHome')}
      {item('search', !sheet && route.view === 'search', <Search className="size-6" />, 'Поиск', focusSearch, null, 'tabSearch')}
      {item('lib', lib || (!sheet && (route.view === 'liked' || route.view === 'ownpl')), <Library className="size-6" />, 'Медиатека', () => setLib(true), null, 'tabLib')}
      {item('friends', !sheet && route.view === 'friends', <Users className="size-6" />, 'Друзья', () => nav({ view: 'friends', handle: '' }),
        unseen ? <span className="absolute right-2 top-0 min-w-4 rounded-full bg-foreground px-1 text-[10px] font-semibold leading-4 text-background">{unseen > 9 ? '9+' : unseen}</span> : null, 'tabFriends')}
      {item('me', meOpen || (!sheet && route.view === 'user' && !!me && (route as any).handle === me.handle),
        me ? <Avatar user={me} size={26} /> : <User className="size-6" />, me ? 'Я' : 'Войти', () => setMe(true), null, 'tabMe')}
    </nav>
  );
}

function SheetRow({ icon: Icon, label, hint, onClick, badge, danger, id }: { icon: any; label: string; hint?: string; onClick: () => void; badge?: React.ReactNode; danger?: boolean; id?: string }) {
  return <button id={id} type="button" onClick={onClick}
    className={cn('flex min-h-14 w-full items-center gap-4 rounded-xl px-3 text-left transition-colors active:scale-[.99] active:bg-accent', danger ? 'text-destructive' : 'text-foreground')}>
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', danger ? 'bg-destructive/10' : 'bg-muted')}><Icon className="size-5" /></span>
    <span className="min-w-0 flex-1"><span className="block text-base font-medium">{label}</span>{hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}</span>
    {badge}
    {!danger && <ChevronRight className="size-5 text-muted-foreground" />}
  </button>;
}

/* Mobile account + more: big labelled rows in a bottom sheet (replaces the top-right avatar menu and "More"). */
export function MeSheet() {
  const on = useUI((s) => s.meSheet);
  const set = useUI((s) => s.setMeSheet);
  const open = useUI((s) => s.open);
  const me = useSession((s) => s.me);
  const logout = useSession((s) => s.logout);
  const unseen = useSession((s) => s.unseen);
  const likeCount = useSession((s) => s.likeCount);
  const nav = useRouter((s) => s.navigate);
  const { theme, setTheme } = useTheme();
  const go = (f: () => void) => { set(false); f(); };
  return (
    <Dialog open={on} onOpenChange={set} side="bottom" title={me ? me.display : 'Muse'}>
      {me ? <div className="mt-1 flex items-center gap-3 px-1 pb-3 text-sm text-muted-foreground"><Avatar user={me} size={40} /><span>@{me.handle}</span></div>
        : <button type="button" onClick={() => go(() => open({ kind: 'auth', tab: 'signin' }))} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-foreground text-base font-semibold text-background active:scale-[.99]"><LogIn className="size-5" />Войти или создать аккаунт</button>}
      <div className="mt-2 flex flex-col gap-1">
        {me && <SheetRow id="meProfile" icon={User} label="Профиль" hint="Ваша страница и статистика" onClick={() => go(() => nav({ view: 'user', handle: me.handle }))} />}
        <SheetRow icon={Heart} label="Любимые треки" hint={likeCount ? `${likeCount} треков` : 'Лайкните трек, он появится здесь'} onClick={() => go(() => nav({ view: 'liked' }))} />
        <SheetRow icon={LayoutGrid} label="Маркетплейс" hint="Плейлисты сообщества" onClick={() => go(() => nav({ view: 'market' }))} />
        <SheetRow icon={Users} label="Друзья" hint="Чаты и активность" onClick={() => go(() => nav({ view: 'friends', handle: '' }))}
          badge={unseen > 0 ? <span className="rounded-full bg-foreground px-2 text-xs font-semibold leading-5 text-background">{unseen}</span> : null} />
        {me && <SheetRow icon={Bell} label="Уведомления" onClick={() => go(() => open({ kind: 'notifs' }))} />}
        <SheetRow id="meSettings" icon={Settings} label="Параметры" hint="Аккаунт, звук, приватность и правовая информация" onClick={() => go(() => open({ kind: 'settings' }))} />
      </div>
      <p className="mb-2 mt-4 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Тема</p>
      <div role="radiogroup" aria-label="Тема" className="grid grid-cols-3 gap-2">
        {([['dark', Moon, 'Тёмная'], ['light', Sun, 'Светлая'], ['system', Monitor, 'Авто']] as const).map(([k, I, l]) =>
          <button key={k} type="button" role="radio" aria-checked={theme === k} onClick={() => setTheme(k)}
            className={cn('flex min-h-12 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors active:scale-[.98]', theme === k ? 'border-foreground bg-accent text-foreground' : 'text-muted-foreground')}>
            <I className="size-5" />{l}</button>)}
      </div>
      {me && <div className="mt-3 border-t pt-2"><SheetRow icon={LogOut} label="Выйти" danger onClick={() => go(() => { logout(); nav({ view: 'home' }); })} /></div>}
    </Dialog>
  );
}

export function LibrarySheet() {
  const on = useUI((s) => s.librarySheet);
  const set = useUI((s) => s.setLibrarySheet);
  const me = useSession((s) => s.me);
  const open = useUI((s) => s.open);
  const nav = useRouter((s) => s.navigate);
  const likeCount = useSession((s) => s.likeCount);
  return (
    <Dialog open={on} onOpenChange={set} side="bottom" title="Медиатека">
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { set(false); mixAll(usePlayer.getState().play); }} className="flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-[15px] font-medium active:scale-[.98]"><Shuffle className="size-5" />Перемешать</button>
        <button id="sheetNew" type="button" onClick={() => { set(false); me ? open({ kind: 'newPlaylist' }) : open({ kind: 'auth', tab: 'signin' }); }} className="flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-foreground text-[15px] font-semibold text-background active:scale-[.98]"><Plus className="size-5" />Плейлист</button>
      </div>
      <div className="mt-3"><SheetRow icon={Heart} label="Любимые треки" hint={likeCount ? `${likeCount} треков` : undefined} onClick={() => { set(false); nav({ view: 'liked' }); }} /></div>
      {!me && <button type="button" className="mt-3 min-h-12 w-full rounded-xl border text-base font-medium" onClick={() => { set(false); open({ kind: 'auth', tab: 'signin' }); }}>Войти, чтобы сохранять плейлисты</button>}
      <div className="mt-3 [&_button]:min-h-14 [&_button]:text-base">{me ? <PlaylistLinks onPick={() => set(false)} /> : null}</div>
    </Dialog>
  );
}
