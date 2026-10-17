import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bell, ChevronRight, Heart, Home, LayoutGrid, Library, LogIn, LogOut, MoreHorizontal, Plus, Search, Settings, Shuffle, User, Users, X, Moon, Sun, Monitor, Music2, Palette, ListMusic, Disc3 } from 'lucide-react';
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
import { ThemePicker, useAppearance } from './theme-picker';

export const LEGAL = [
  ['/privacy', 'Privacy', 'What I keep'], ['/gdpr', 'GDPR', 'Controller · France host'], ['/terms', 'Terms', 'Rules and liability'],
  ['/cookies', 'Cookies', 'Reject is a real choice'], ['/dpa', 'Processor', 'Not an Art. 28 contract'],
  ['/subprocessors', 'Who else', 'Cloudflare, Contabo, Groq'], ['/sla', 'Uptime', 'Measured, not a sticker'],
  ['/credits', 'Credits', 'YouTube, authors, art'], ['/dmca', 'Copyright', 'Hosted files only'],
] as const;

/* Riff navigation rail item: 48px circle indicator, M3 active pill, label tooltip, badge. */
function NavItem({ active, icon: Icon, label, onClick, count, id }: { active: boolean; icon: any; label: string; onClick: () => void; count?: React.ReactNode; id?: string }) {
  return (
    <Tip label={label} side="right">
      <button id={id} type="button" onClick={onClick} aria-label={label} aria-current={active ? 'page' : undefined}
        className={cn('group relative flex size-12 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          active ? 'text-on-primary-container' : 'text-muted-foreground hover:text-foreground')}>
        {active ? <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-primary-container" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
          : <span className="absolute inset-0 rounded-full transition-colors group-hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_8%,transparent)]" />}
        <Icon className={cn('relative size-5', active && Icon === Heart && 'fill-current')} />
        {count ? <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-m3-primary px-1 text-center text-[9px] font-bold leading-4 text-on-m3-primary">{count}</span> : null}
      </button>
    </Tip>
  );
}

export function AccountMenu({ children, align = 'start', side = 'top' }: { children: React.ReactNode; align?: 'start' | 'end'; side?: 'top' | 'bottom' | 'right' }) {
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
          <DropdownMenuSubTrigger>{theme === 'light' ? <Sun /> : theme === 'dark' ? <Moon /> : theme === 'auto' ? <Disc3 /> : <Monitor />}Тема</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => setTheme('dark')}><Moon />Тёмная</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme('light')}><Sun />Светлая</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme('system')}><Monitor />Система</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme('auto')}><Disc3 />Из обложки</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => useAppearance.getState().set(true)}><Palette />Оформление…</DropdownMenuItem>
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
          className={cn('flex items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm transition-colors', active ? 'bg-surface-high text-foreground' : 'text-muted-foreground hover:bg-surface-high hover:text-foreground')}>
          <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-surface-highest">{cover ? <img src={cover} alt="" className="size-full object-cover" /> : <Music2 className="m-3 size-4" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.count} tracks{p.listed ? ' · Market' : ''}</span></span>
        </motion.button>;
      })}
    </AnimatePresence>
  </div>;
}

/* Desktop: Riff 80px navigation rail (rounded 28, surface-container) + playlists drawer. */
export function Sidebar() {
  const route = useRouter((s) => s.route);
  const nav = useRouter((s) => s.navigate);
  const me = useSession((s) => s.me);
  const likeCount = useSession((s) => s.likeCount);
  const unseen = useSession((s) => s.unseen);
  const playlists = useSession((s) => s.playlists);
  const open = useUI((s) => s.open);
  const [drawer, setDrawer] = React.useState(false);
  const reduce = useReducedMotion();
  const inPl = route.view === 'ownpl';
  return (
    <div className="relative hidden shrink-0 md:flex">
      <aside id="side" className="flex w-20 flex-col items-center gap-1 rounded-[28px] bg-surface-c py-4">
        <NavItem active={route.view === 'home' || route.view === 'search'} icon={Home} label="Главная" onClick={() => nav({ view: 'home' })} />
        <NavItem active={route.view === 'liked'} icon={Heart} label="Любимые треки" count={likeCount ? (likeCount > 99 ? '99+' : likeCount) : undefined} onClick={() => nav({ view: 'liked' })} />
        <NavItem active={inPl || drawer} icon={ListMusic} label="Плейлисты" count={playlists.length || undefined} onClick={() => setDrawer((x) => !x)} id="sidePlaylists" />
        <NavItem active={route.view === 'market'} icon={LayoutGrid} label="Маркетплейс" onClick={() => nav({ view: 'market' })} />
        <NavItem active={route.view === 'friends'} icon={Users} label="Друзья" count={unseen || undefined} onClick={() => nav({ view: 'friends', handle: '' })} />
        <span className="my-2 h-px w-8 bg-outline-variant" />
        <Tip label="Перемешать всё" side="right"><button type="button" aria-label="Перемешать всё" onClick={() => mixAll(usePlayer.getState().play)} className="control-btn size-11 rounded-xl"><Shuffle className="size-5" /></button></Tip>
        <Tip label="Новый плейлист" side="right"><button id="newPl" type="button" aria-label="Новый плейлист" onClick={() => me ? open({ kind: 'newPlaylist' }) : open({ kind: 'auth', tab: 'signin' })} className="control-btn size-11 rounded-xl"><Plus className="size-5" /></button></Tip>
        <MoreMenu><button id="sideMore" type="button" aria-label="Ещё" className="control-btn size-11 rounded-xl"><MoreHorizontal className="size-5" /></button></MoreMenu>
        <div className="flex-1" />
        <AccountMenu side="right" align="end">
          <button id="sideUser" type="button" aria-label={me ? me.display : 'Войти'} className="relative flex size-12 items-center justify-center rounded-full transition-colors hover:bg-surface-high">
            {me ? <Avatar user={me} size={36} /> : <span className="flex size-9 items-center justify-center rounded-full bg-surface-high"><User className="size-5 text-muted-foreground" /></span>}
            {unseen > 0 && <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-m3-primary ring-2 ring-[var(--md-sys-color-surface-container)]" />}
          </button>
        </AccountMenu>
      </aside>
      <AnimatePresence>
        {drawer && <motion.div key="drawer" id="plDrawer" initial={reduce ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
          className="absolute inset-y-0 left-[88px] z-30 flex w-72 flex-col rounded-[28px] bg-surface-high p-3 shadow-[0_8px_28px_rgb(0_0_0/.35)]">
          <div className="flex items-center justify-between px-2 pb-2 pt-1"><span className="text-sm font-semibold">Плейлисты</span>
            <button type="button" aria-label="Закрыть" onClick={() => setDrawer(false)} className="control-btn size-9"><X className="size-4" /></button></div>
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            {me ? (playlists.length ? <PlaylistLinks onPick={() => setDrawer(false)} /> : <p className="px-2 text-xs text-muted-foreground">Пока пусто. Нажмите +, чтобы создать.</p>)
              : <p className="px-2 text-xs leading-relaxed text-muted-foreground">Войдите, чтобы сохранять лайки и плейлисты.</p>}
          </div>
        </motion.div>}
      </AnimatePresence>
    </div>
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
    <header id="topbar" className="z-30 shrink-0 pt-[env(safe-area-inset-top)]">
      <div className="flex h-16 items-center gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-4">
        <button type="button" onClick={() => nav({ view: 'home' })} aria-label="Home" className="flex size-11 shrink-0 items-center justify-center md:hidden"><img src="/muselogo.png?v=172" alt="Muse" className="size-8 max-w-none rounded-[10px]" /></button>
        <button id="sideBrand" type="button" onClick={() => nav({ view: 'home' })} className="hidden w-20 shrink-0 items-center justify-center gap-2 md:flex" aria-label="Muse">
          <img src="/muselogo.png?v=172" alt="" className="size-8 rounded-[10px]" />
        </button>
        <form id="searchForm" role="search" className="relative mx-auto flex min-w-0 max-w-[640px] flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); if (q.trim().length >= 1) nav({ view: 'search', q: q.trim(), mode }); }}>
          <div className="relative flex h-12 w-full min-w-0 items-center rounded-full bg-surface-c transition-[background-color,box-shadow] focus-within:bg-surface-high focus-within:ring-2 focus-within:ring-outline">
            <Search className="ml-4 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <input ref={inp} id="q" value={q} autoComplete="off" spellCheck={false}
              placeholder={mode === 'people' ? 'Найти людей…' : 'Найти трек…'}
              onChange={(e) => { setQ(e.target.value); run(e.target.value); }}
              enterKeyHint="search" className="h-full min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground md:text-[15px]" />
            {q ? <button id="qClear" type="button" aria-label="Clear search" onClick={() => { setQ(''); nav({ view: 'home' }); inp.current?.focus(); }} className="tap mr-1.5 flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-highest hover:text-foreground"><X className="size-5" /></button>
              : <Kbd className="mr-4 hidden sm:inline-flex">/</Kbd>}
          </div>
          <div id="qSwitch" role="tablist" aria-label="Search type" className="flex h-12 shrink-0 items-center gap-0.5 rounded-full bg-surface-c p-0.5 md:p-1">
            {(['songs', 'people'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} title={m === 'songs' ? 'Search songs' : 'Search people'} aria-label={m === 'songs' ? 'Search songs' : 'Search people'}
                onPointerDown={(e) => { if (e.pointerType !== 'mouse') e.preventDefault(); }}
                onClick={() => { setMode(m); if (q.trim().length >= 2) nav({ view: 'search', q: q.trim(), mode: m }); inp.current?.focus(); }}
                className={cn('tap relative flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors md:h-10 md:px-4', mode === m ? 'text-on-primary-container' : 'text-muted-foreground hover:text-foreground')}>
                {mode === m && <motion.span layoutId="qpill" className="absolute inset-0 rounded-full bg-primary-container" transition={{ type: 'spring', stiffness: 520, damping: 36 }} />}
                {m === 'songs' ? <Music2 className="relative size-4" /> : <Users className="relative size-4" />}
                <span className="relative hidden sm:inline">{m === 'songs' ? 'Треки' : 'Люди'}</span>
              </button>
            ))}
          </div>
        </form>
        <span className="hidden w-20 shrink-0 md:block xl:w-[340px]" aria-hidden />
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
    <button key={key} id={id} type="button" onPointerDown={(e) => { if (e.pointerType !== 'mouse') { e.preventDefault(); onClick(); } }} onClick={(e) => { if (e.detail === 0 || (e.nativeEvent as any).pointerType === 'mouse') onClick(); }} aria-label={label} aria-current={active ? 'page' : undefined}
      className={cn('relative flex h-full min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 text-xs leading-none transition-colors duration-75',
        active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}>
      <span className="relative flex h-8 w-16 items-center justify-center">
        <span className="absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_10%,transparent)] opacity-0 transition-opacity duration-75 [button:active_&]:opacity-100" />
        {active && <motion.span layoutId="tab-ind" className="absolute inset-0 rounded-full bg-primary-container" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
        <span className={cn('relative', active && 'text-on-primary-container')}>{icon}</span>{extra}
      </span>
      <span className="relative leading-none">{label}</span>
    </button>
  );
  const focusSearch = () => {
    if (route.view !== 'home' && route.view !== 'search') nav({ view: 'home' });
    setTimeout(() => { const q = document.getElementById('q') as HTMLInputElement | null; q?.focus(); q?.select(); }, 60);
  };
  return (
    <nav id="tabbar" aria-label="Primary" className="kb-hide fixed inset-x-0 bottom-0 z-40 flex h-[calc(var(--tab-h)+var(--sab))] touch-manipulation select-none bg-surface-c pb-[var(--sab)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden">
      {item('home', !sheet && route.view === 'home', <Home className="size-6" />, 'Главная', () => nav({ view: 'home' }), null, 'tabHome')}
      {item('search', !sheet && route.view === 'search', <Search className="size-6" />, 'Поиск', focusSearch, null, 'tabSearch')}
      {item('lib', lib || (!sheet && (route.view === 'liked' || route.view === 'ownpl')), <Library className="size-6" />, 'Медиатека', () => setLib(true), null, 'tabLib')}
      {item('friends', !sheet && route.view === 'friends', <Users className="size-6" />, 'Друзья', () => nav({ view: 'friends', handle: '' }),
        unseen ? <span className="absolute right-2.5 -top-0.5 min-w-4 rounded-full bg-m3-primary px-1 text-[10px] font-bold leading-4 text-on-m3-primary">{unseen > 9 ? '9+' : unseen}</span> : null, 'tabFriends')}
      {item('me', meOpen || (!sheet && route.view === 'user' && !!me && (route as any).handle === me.handle),
        me ? <Avatar user={me} size={26} /> : <User className="size-6" />, me ? 'Я' : 'Войти', () => setMe(true), null, 'tabMe')}
    </nav>
  );
}

function SheetRow({ icon: Icon, label, hint, onClick, badge, danger, id }: { icon: any; label: string; hint?: string; onClick: () => void; badge?: React.ReactNode; danger?: boolean; id?: string }) {
  return <button id={id} type="button" onClick={onClick}
    className={cn('flex min-h-14 w-full items-center gap-4 rounded-2xl px-3 text-left transition-[background-color,transform] active:scale-[.99] active:bg-surface-high', danger ? 'text-destructive' : 'text-foreground')}>
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', danger ? 'bg-destructive/10' : 'bg-surface-high')}><Icon className="size-5" /></span>
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
  const go = (f: () => void) => { set(false); f(); };
  return (
    <Dialog open={on} onOpenChange={set} side="bottom" title={me ? me.display : 'Muse'}>
      {me ? <div className="mt-1 flex items-center gap-3 px-1 pb-3 text-sm text-muted-foreground"><Avatar user={me} size={40} /><span>@{me.handle}</span></div>
        : <button type="button" onClick={() => go(() => open({ kind: 'auth', tab: 'signin' }))} className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-semibold text-primary-foreground active:scale-[.99]"><LogIn className="size-5" />Войти или создать аккаунт</button>}
      <div className="mt-2 flex flex-col gap-1">
        {me && <SheetRow id="meProfile" icon={User} label="Профиль" hint="Ваша страница и статистика" onClick={() => go(() => nav({ view: 'user', handle: me.handle }))} />}
        <SheetRow icon={Heart} label="Любимые треки" hint={likeCount ? `${likeCount} треков` : 'Лайкните трек, он появится здесь'} onClick={() => go(() => nav({ view: 'liked' }))} />
        <SheetRow icon={LayoutGrid} label="Маркетплейс" hint="Плейлисты сообщества" onClick={() => go(() => nav({ view: 'market' }))} />
        <SheetRow icon={Users} label="Друзья" hint="Чаты и активность" onClick={() => go(() => nav({ view: 'friends', handle: '' }))}
          badge={unseen > 0 ? <span className="rounded-full bg-foreground px-2 text-xs font-semibold leading-5 text-background">{unseen}</span> : null} />
        {me && <SheetRow icon={Bell} label="Уведомления" onClick={() => go(() => open({ kind: 'notifs' }))} />}
        <SheetRow id="meSettings" icon={Settings} label="Параметры" hint="Аккаунт, звук, приватность и правовая информация" onClick={() => go(() => open({ kind: 'settings' }))} />
      </div>
      <p className="mb-2 mt-4 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Оформление</p>
      <ThemePicker />
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
        <button type="button" onClick={() => { set(false); mixAll(usePlayer.getState().play); }} className="flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-surface-high text-[15px] font-medium active:scale-[.98]"><Shuffle className="size-5" />Перемешать</button>
        <button id="sheetNew" type="button" onClick={() => { set(false); me ? open({ kind: 'newPlaylist' }) : open({ kind: 'auth', tab: 'signin' }); }} className="flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[.98]"><Plus className="size-5" />Плейлист</button>
      </div>
      <div className="mt-3"><SheetRow icon={Heart} label="Любимые треки" hint={likeCount ? `${likeCount} треков` : undefined} onClick={() => { set(false); nav({ view: 'liked' }); }} /></div>
      {!me && <button type="button" className="mt-3 min-h-12 w-full rounded-full bg-surface-high text-base font-medium" onClick={() => { set(false); open({ kind: 'auth', tab: 'signin' }); }}>Войти, чтобы сохранять плейлисты</button>}
      <div className="mt-3 [&_button]:min-h-14 [&_button]:text-base">{me ? <PlaylistLinks onPick={() => set(false)} /> : null}</div>
    </Dialog>
  );
}
