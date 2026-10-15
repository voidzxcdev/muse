import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { Bell, Download, Loader2, Minus, Plus, X, ZoomIn, ZoomOut, Camera } from 'lucide-react';
import { api, post, req, swrClear, upload } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useUI } from '@/lib/ui-store';
import { useRouter } from '@/lib/router';
import { createPlaylist, takeShared } from '@/lib/actions';
import { cookiesChoice, isAndroidApp, isAndroidWeb, isDeskApp, isIOS, lane, setCookies } from '@/lib/env';
import { dropPush, goNotif, markSeen, startNotifPoll, askNotifPerm } from '@/lib/services';
import type { Notif, Track } from '@/lib/types';
import { cn, publicLink, ytThumb } from '@/lib/utils';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Input, Label } from './ui/input';
import { Avatar, Switch, TabsList, TabsRoot, TabsTrigger } from './ui/misc';
import { LEGAL } from './layout';

const isPhone = () => matchMedia('(max-width: 760px)').matches;

async function afterLogin(user: any) {
  useSession.getState().setMe(user);
  await useSession.getState().refreshMe();
  try { localStorage.setItem('muse:onboarded', '1'); } catch {}
  toast.success(`Welcome, ${user.display}`);
  startNotifPoll(); askNotifPerm();
  const pt = useUI.getState().pendingTake;
  if (pt) { useUI.getState().setPendingTake(null); await takeShared(pt.handle, pt.slug); }
}

function AuthForm({ mode, onDone, autoFocus = true }: { mode: 'signin' | 'signup'; onDone?: () => void; autoFocus?: boolean }) {
  const [u, setU] = React.useState(''); const [p, setP] = React.useState(''); const [tos, setTos] = React.useState(false);
  const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (busy) return; setErr(''); setBusy(true);
    try {
      const body: any = { username: u.trim(), password: p };
      if (mode === 'signup') { if (!tos) throw new Error('accept the terms to create an account'); body.accepted_tos = true; }
      const j = await post(mode === 'signin' ? '/api/login' : '/api/signup', body);
      onDone?.(); await afterLogin(j.user);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
    <div className="grid gap-1.5"><Label htmlFor="aUser">Username</Label><Input id="aUser" autoFocus={autoFocus} value={u} onChange={(e) => setU(e.target.value)} maxLength={24} autoComplete="username" autoCapitalize="off" spellCheck={false} /></div>
    <div className="grid gap-1.5"><Label htmlFor="aPass">Password</Label><Input id="aPass" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></div>
    {mode === 'signup' && <label className="flex items-start gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={tos} onChange={(e) => setTos(e.target.checked)} className="mt-0.5 size-4 accent-foreground" />
      <span>I agree to the <a href="/terms" target="_blank" rel="noopener" className="text-foreground underline underline-offset-2">Terms</a> and <a href="/privacy" target="_blank" rel="noopener" className="text-foreground underline underline-offset-2">Privacy Policy</a>.</span></label>}
    <AnimatePresence>{err && <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm text-destructive">{err}</motion.p>}</AnimatePresence>
    <Button type="submit" disabled={busy} className="mt-1">{busy && <Loader2 className="animate-spin" />}{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
  </form>;
}

export function AuthDialog({ tab }: { tab: 'signin' | 'signup' }) {
  const close = useUI((s) => s.close);
  const [mode, setMode] = React.useState(tab);
  return <Dialog open onOpenChange={(o) => !o && close()} side={isPhone() ? 'bottom' : 'center'}>
    <TabsRoot value={mode} onValueChange={(v) => setMode(v as any)}><TabsList className="w-full"><TabsTrigger value="signin">Sign in</TabsTrigger><TabsTrigger value="signup">Create account</TabsTrigger></TabsList></TabsRoot>
    <h2 className="mt-5 text-xl font-semibold tracking-tight">{mode === 'signin' ? 'Welcome back' : 'Join Muse'}</h2>
    <p className="text-sm text-muted-foreground">Likes, playlists, and the songs you come back to.</p>
    <AuthForm key={mode} mode={mode} onDone={close} />
  </Dialog>;
}

/* First-run fullscreen onboarding (legacy #onboard): art collage + auth. */
export function Onboarding() {
  const me = useSession((s) => s.me);
  const ready = useSession((s) => s.ready);
  const [mode, setMode] = React.useState<'signup' | 'signin'>('signup');
  const [arts, setArts] = React.useState<Track[]>(() => { try { return (JSON.parse(localStorage.getItem('muse:popular') || 'null')?.tracks || []).slice(0, 5); } catch { return []; } });
  const reduce = useReducedMotion();
  const show = ready && !me && localStorage.getItem('muse:onboarded') !== '1';
  React.useEffect(() => { if (show && arts.length < 3) api('/api/popular?n=12').then((j) => setArts((j.tracks || []).slice(0, 5))).catch(() => {}); }, [show]);
  return <AnimatePresence>{show && <motion.div id="onboard" className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-background p-4"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
    <div className="bg-grid pointer-events-none absolute inset-0" />
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-[18%] h-72 w-[42rem] -translate-x-1/2 rounded-full bg-foreground/[0.07] blur-3xl" />
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[6%] flex justify-center">
      {arts.filter((t) => t.thumbnail || t.id).slice(0, 5).map((t, i) => <motion.img key={t.id} src={ytThumb(t.id, t.thumbnail)} alt=""
        initial={reduce ? false : { opacity: 0, y: 30, rotate: 0 }} animate={{ opacity: 0.55, y: 0, rotate: (i - 2) * 6 }} transition={{ type: 'spring', stiffness: 120, damping: 18, delay: reduce ? 0 : 0.1 + i * 0.06 }}
        className="-mx-6 aspect-video w-40 rounded-xl border object-cover shadow-2xl md:w-56" style={{ zIndex: 5 - Math.abs(i - 2) }} />)}
    </div>
    <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28, delay: reduce ? 0 : 0.15 }}
      className="relative mt-24 w-full max-w-sm rounded-2xl border bg-card/90 p-6 shadow-xl backdrop-blur-xl">
      <div className="flex items-center gap-2"><img src="/muselogo.png?v=172" alt="" className="size-7 rounded-md" /><span className="font-semibold tracking-tight">Muse</span></div>
      <h1 className="mt-5 text-2xl font-bold tracking-tighter">{mode === 'signup' ? 'Your music starts here' : 'Welcome back'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{mode === 'signup' ? 'Create an account to save likes and playlists. Then press play.' : 'Sign in to pick up your likes and playlists.'}</p>
      <AuthForm key={mode} mode={mode} />
      <button type="button" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')} className="mt-3 w-full text-center text-sm text-muted-foreground hover:text-foreground">{mode === 'signup' ? 'I already have one' : 'Create an account'}</button>
    </motion.div>
  </motion.div>}</AnimatePresence>;
}

export function SettingsDialog() {
  const me = useSession((s) => s.me)!;
  const close = useUI((s) => s.close);
  const open = useUI((s) => s.open);
  const logout = useSession((s) => s.logout);
  const nav = useRouter((s) => s.navigate);
  const pv = me.privacy || {};
  const [name, setName] = React.useState(me.display);
  const [handle, setHandle] = React.useState(me.handle);
  const [priv, setPriv] = React.useState({ hidden: !!pv.hidden, anon: !!pv.anon, playlists: !!pv.playlists, likes: !!pv.likes, badges: !!pv.badges, avatar: !!pv.avatar });
  const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(false);
  const [delPass, setDelPass] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  const waitSec = Number(me.handle_in || 0);
  const wait = waitSec > 0 ? `Можно сменить через ${Math.max(1, Math.ceil(waitSec / 86400))} д.` : '';
  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const body: any = { display: name.trim(), privacy: priv };
      const nh = handle.trim().toLowerCase().replace(/^@/, '');
      if (!wait && nh && nh !== me.handle) body.handle = nh;
      const j = await req('PATCH', '/api/me', body);
      useSession.getState().setMe(j.user); await useSession.getState().refreshMe();
      toast.success('Сохранено'); close();
    } catch (e: any) { setErr(e.message || 'Save failed'); } finally { setBusy(false); }
  };
  const exportData = async () => {
    try {
      const r = await fetch('/api/me/export', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'export failed'); }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'muse-data.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast.success('Exported');
    } catch (e: any) { toast.error(e.message || 'Export failed'); }
  };
  const del = () => {
    if (!delPass) { toast.error('Type your password'); return; }
    open({ kind: 'confirm', title: 'Delete this Muse account forever?', body: 'There is no email reset.', danger: true, action: 'Delete account', onConfirm: async () => {
      try { await post('/api/me/delete', { password: delPass }); await dropPush(); swrClear(); useSession.setState({ me: null, playlists: [], likedIds: new Set(), likeCount: 0 }); toast.success('Account deleted'); nav({ view: 'home' }); }
      catch (e: any) { toast.error(e.message || 'Delete failed'); }
    } });
  };
  const PRIV: [keyof typeof priv, string, string][] = [
    ['hidden', 'Скрыть профиль', 'Другие увидят, что профиль закрыт'], ['anon', 'Анонимный профиль', 'Вместо имени будет «Аноним»'],
    ['playlists', 'Скрыть плейлисты', 'Их не будет на странице профиля'], ['likes', 'Скрыть лайки', 'Liked Songs не показываются'],
    ['badges', 'Скрыть значки', 'Значки видны только тебе'], ['avatar', 'Скрыть фото', 'Другие увидят букву вместо фото'],
  ];
  const showApps = !(isDeskApp() || isAndroidApp || isIOS);
  return <Dialog open onOpenChange={(o) => !o && close()} side={isPhone() ? 'bottom' : 'center'} className="max-w-lg p-0" title="">
    <div className="max-h-[75dvh] overflow-y-auto px-6 pb-4 pt-6 scrollbar-thin">
      <h2 className="text-xl font-semibold tracking-tight">Параметры</h2>
      <p className="text-sm text-muted-foreground">Имя, @handle и ссылка на публичный профиль.</p>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) open({ kind: 'cover', target: 'avatar', file: f }); e.target.value = ''; }} />
      <div className="mt-5 flex items-center gap-4">
        <button type="button" onClick={() => fileRef.current?.click()} title="Change photo" className="group relative rounded-full">
          <Avatar user={me} size={72} /><span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"><Camera className="size-5 text-white" /></span>
        </button>
        <div className="grid flex-1 gap-1.5"><Label htmlFor="pfName">Имя</Label><Input id="pfName" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} /></div>
      </div>
      <div className="mt-4 grid gap-1.5"><Label htmlFor="pfHandle">Handle</Label>
        <div className="flex items-center rounded-md border bg-transparent pl-3 dark:bg-input/30"><span className="text-muted-foreground">@</span><input id="pfHandle" value={handle} disabled={!!wait} maxLength={24} onChange={(e) => setHandle(e.target.value)} autoComplete="off" spellCheck={false} className="h-9 flex-1 bg-transparent px-1 text-sm outline-none disabled:opacity-50" /></div>
        <p className="font-mono text-xs text-muted-foreground">{publicLink(handle.trim().toLowerCase().replace(/^@/, '') || me.handle)}</p>
        <p className="text-xs text-muted-foreground">{wait || 'Можно менять раз в 30 дней.'}</p>
      </div>
      <p className="mb-2 mt-6 text-sm font-medium">Приватность</p>
      <div className="divide-y rounded-lg border">{PRIV.map(([k, t, s]) => <label key={k} className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2.5"><span><span className="block text-sm">{t}</span><span className="block text-xs text-muted-foreground">{s}</span></span><Switch checked={priv[k]} onCheckedChange={(v) => setPriv({ ...priv, [k]: v })} /></label>)}</div>
      {lane() === 'pc' && <label className="mt-3 flex cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2.5"><span><span className="block text-sm">YouTube embed cookies</span><span className="block text-xs text-muted-foreground">Optional youtube.com cookies for the desktop iframe. Off uses Muse audio.</span></span>
        <Switch checked={cookiesChoice() === 'all'} onCheckedChange={(v) => { setCookies(v ? 'all' : 'needed'); location.reload(); }} /></label>}
      <label className="mt-3 flex cursor-pointer items-center justify-between gap-4 rounded-lg border px-3 py-2.5"><span><span className="block text-sm">Уведомления</span><span className="block text-xs text-muted-foreground">Сообщения и заявки в друзья</span></span>
        <Button size="sm" variant="outline" onClick={() => askNotifPerm()}><Bell />Enable</Button></label>
      <p className="mb-2 mt-6 text-sm font-medium">Your data</p>
      <p className="text-xs text-muted-foreground">No email. Export a JSON copy, or type your password to delete the account. There is no password reset.</p>
      <div className="mt-3 grid gap-2"><Button variant="outline" onClick={exportData}>Export my data</Button>
        <div className="flex gap-2"><Input type="password" placeholder="Password to delete" value={delPass} onChange={(e) => setDelPass(e.target.value)} autoComplete="current-password" /><Button variant="destructive" onClick={del}>Delete account</Button></div></div>
      <p className="mb-2 mt-6 text-sm font-medium">Legal</p>
      <div className="grid grid-cols-3 gap-1.5">{LEGAL.map(([href, b, i]) => <a key={href} href={href} target="_blank" rel="noopener" className="rounded-md border px-2 py-1.5 transition-colors hover:bg-accent"><span className="block text-xs font-medium">{b}</span><span className="block truncate text-[10px] text-muted-foreground">{i}</span></a>)}</div>
      {showApps && <div className="mt-4 grid gap-2">{!isAndroidWeb && <Button variant="outline" asChild><a href="/desktop/Muse-Setup.exe"><Download />Download for Windows</a></Button>}<Button variant="outline" asChild><a href="/android/Muse.apk" download="Muse.apk"><Download />Download for Android</a></Button></div>}
      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
    </div>
    <div className="flex justify-between gap-2 border-t px-6 py-3">
      <Button variant="ghost" onClick={async () => { await dropPush(); await logout(); close(); nav({ view: 'home' }); }}>Выйти</Button>
      <Button onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Сохранить</Button>
    </div>
  </Dialog>;
}

export function NameDialog({ title, initial, cta, onSubmit }: { title: string; initial?: string; cta: string; onSubmit: (name: string) => Promise<void> }) {
  const close = useUI((s) => s.close);
  const [v, setV] = React.useState(initial || ''); const [busy, setBusy] = React.useState(false);
  return <Dialog open onOpenChange={(o) => !o && close()} title={title}>
    <form className="mt-4 flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onSubmit(v.trim()); close(); } catch (er: any) { toast.error(er.message); } finally { setBusy(false); } }}>
      <Input autoFocus value={v} maxLength={60} onChange={(e) => setV(e.target.value)} placeholder="My playlist" />
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{cta}</Button></div>
    </form>
  </Dialog>;
}

/* Square cropper (drag + zoom) → JPEG upload to /api/me/avatar or /api/playlists/:id/cover */
export function CoverEditor({ target, file }: { target: 'avatar' | number; file: File }) {
  const close = useUI((s) => s.close);
  const url = React.useMemo(() => URL.createObjectURL(file), [file]);
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [z, setZ] = React.useState(1); const [off, setOff] = React.useState({ x: 0, y: 0 }); const [busy, setBusy] = React.useState(false);
  const S = 280;
  React.useEffect(() => { const i = new Image(); i.onload = () => setImg(i); i.src = url; return () => URL.revokeObjectURL(url); }, [url]);
  const base = img ? S / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const drag = (e: React.PointerEvent) => {
    const sx = e.clientX, sy = e.clientY, o = { ...off };
    const mv = (ev: PointerEvent) => setOff({ x: o.x + ev.clientX - sx, y: o.y + ev.clientY - sy });
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const save = async () => {
    if (!img) return; setBusy(true);
    try {
      const OUT = 640, scale = base * z, cv = document.createElement('canvas'); cv.width = cv.height = OUT;
      const cx = cv.getContext('2d')!; const k = OUT / S;
      const w = img.naturalWidth * scale * k, h = img.naturalHeight * scale * k;
      cx.fillStyle = '#000'; cx.fillRect(0, 0, OUT, OUT);
      cx.drawImage(img, (OUT - w) / 2 + off.x * k, (OUT - h) / 2 + off.y * k, w, h);
      const blob: Blob = await new Promise((r, j) => cv.toBlob((b) => b ? r(b) : j(new Error('Could not process image.')), 'image/jpeg', 0.9));
      const j = await upload(target === 'avatar' ? '/api/me/avatar' : `/api/playlists/${target}/cover`, blob, { 'Content-Type': 'image/jpeg' });
      if (target === 'avatar') { const s = useSession.getState(); s.setMe(j.user || { ...s.me!, avatar: j.avatar }); }
      await useSession.getState().refreshMe();
      toast.success(target === 'avatar' ? 'Photo updated' : 'Cover updated'); close();
    } catch (e: any) { toast.error(e.message || 'Upload failed'); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(o) => !o && close()} title={target === 'avatar' ? 'Profile photo' : 'Playlist cover'} description="Drag to position, zoom to crop.">
    <div className="mt-4 flex flex-col items-center gap-4">
      <div onPointerDown={drag} className={cn('relative cursor-grab touch-none overflow-hidden border bg-muted active:cursor-grabbing', target === 'avatar' ? 'rounded-full' : 'rounded-xl')} style={{ width: S, height: S }}>
        {img && <img src={url} alt="" draggable={false} className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
          style={{ width: img.naturalWidth * base, height: img.naturalHeight * base, transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px)) scale(${z})` }} />}
      </div>
      <div className="flex w-full items-center gap-3"><ZoomOut className="size-4 text-muted-foreground" /><input type="range" min={1} max={3} step={0.01} value={z} onChange={(e) => setZ(Number(e.target.value))} className="range flex-1" style={{ ['--val' as any]: `${((z - 1) / 2) * 100}%` }} /><ZoomIn className="size-4 text-muted-foreground" /></div>
      <div className="flex w-full justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={save} disabled={busy || !img}>{busy && <Loader2 className="animate-spin" />}Save</Button></div>
    </div>
  </Dialog>;
}

export function PublishDialog() {
  const close = useUI((s) => s.close);
  const pls = useSession((s) => s.playlists);
  const [err, setErr] = React.useState(''); const [busy, setBusy] = React.useState(0);
  const nav = useRouter((s) => s.navigate);
  return <Dialog open onOpenChange={(o) => !o && close()} title="Опубликовать плейлист" description="Выбери плейлист — он появится в Маркетплейсе.">
    <div className="mt-4 flex max-h-80 flex-col gap-1 overflow-y-auto">
      {pls.length === 0 && <p className="text-sm text-muted-foreground">Сначала собери плейлист.</p>}
      {pls.map((p) => <button key={p.id} type="button" disabled={!p.can_publish || !!busy}
        onClick={async () => { setBusy(p.id); setErr(''); try { await post('/api/market', { playlist_id: p.id }); await useSession.getState().refreshPlaylists(); toast.success('Published'); close(); nav({ view: 'market' }); } catch (e: any) { setErr(e.message || 'Не вышло опубликовать'); } finally { setBusy(0); } }}
        className="flex items-center gap-3 rounded-md p-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50">
        {p.custom_cover || p.cover ? <img src={p.custom_cover || p.cover} alt="" className="size-10 rounded object-cover" /> : <span className="flex size-10 items-center justify-center rounded bg-muted">{p.name[0]}</span>}
        <span className="min-w-0 flex-1"><span className="block truncate text-sm">{p.name}</span><span className="block text-xs text-muted-foreground">{p.count} треков{p.listed ? ' · уже опубликован' : p.need ? ' · нужно больше своих треков' : !p.count ? ' · пустой' : ''}</span></span>
        {busy === p.id && <Loader2 className="size-4 animate-spin" />}
      </button>)}
    </div>
    {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
  </Dialog>;
}

export function NotifsDialog() {
  const close = useUI((s) => s.close);
  const [list, setList] = React.useState<Notif[] | null>(null);
  React.useEffect(() => { api('/api/notifs?inbox=1').then((j) => setList((j.notifs || []).reverse())).catch(() => setList([])); markSeen({ all: true }); }, []);
  return <Dialog open onOpenChange={(o) => !o && close()} title="Уведомления" side={isPhone() ? 'bottom' : 'center'}>
    <div className="mt-4 flex max-h-96 flex-col gap-1 overflow-y-auto">
      {!list ? <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" /> : !list.length ? <p className="py-6 text-center text-sm text-muted-foreground">Пока тихо.</p>
        : list.map((n) => <button key={n.id} type="button" onClick={() => { close(); goNotif(n); }} className={cn('flex items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-accent', !n.seen && 'bg-accent/40')}>
          <Avatar user={n.from || { handle: 'muse' }} size={34} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{n.title}</span><span className="block truncate text-xs text-muted-foreground">{n.body}</span></span>
          <span className="text-[10px] text-muted-foreground">{new Date(n.created * 1000).toLocaleDateString()}</span></button>)}
    </div>
  </Dialog>;
}

export function ConfirmDialog({ title, body, danger, action, onConfirm }: { title: string; body?: string; danger?: boolean; action: string; onConfirm: () => void | Promise<void> }) {
  const close = useUI((s) => s.close); const [busy, setBusy] = React.useState(false);
  return <Dialog open onOpenChange={(o) => !o && close()} title={title} description={body} hideClose>
    <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button>
      <Button variant={danger ? 'destructive' : 'default'} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); close(); } }}>{busy && <Loader2 className="animate-spin" />}{action}</Button></div>
  </Dialog>;
}

/* Fullscreen media viewer (chat images/videos) with wheel/pinch-free zoom buttons. */
export function MediaViewer({ type, src }: { type: 'image' | 'video'; src: string }) {
  const close = useUI((s) => s.close); const [z, setZ] = React.useState(1);
  return <Dialog open onOpenChange={(o) => !o && close()} side="full" className="flex items-center justify-center bg-black/95" hideClose>
    <div id="mediaView" className="relative flex size-full items-center justify-center overflow-hidden" onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      onWheel={(e) => type === 'image' && setZ((v) => Math.min(4, Math.max(1, v - e.deltaY * 0.002)))}>
      {type === 'image' ? <img src={src} alt="" className="max-h-[90dvh] max-w-[92vw] object-contain transition-transform duration-150" style={{ transform: `scale(${z})` }} />
        : <video src={src} controls autoPlay playsInline className="max-h-[90dvh] max-w-[92vw]" />}
      <div className="absolute right-4 top-4 flex gap-2">
        {type === 'image' && <><Button size="icon" variant="secondary" onClick={() => setZ((v) => Math.max(1, v - 0.5))} aria-label="Уменьшить"><Minus /></Button><Button size="icon" variant="secondary" onClick={() => setZ((v) => Math.min(4, v + 0.5))} aria-label="Увеличить"><Plus /></Button></>}
        <Button size="icon" variant="secondary" onClick={close} aria-label="Закрыть"><X /></Button>
      </div>
    </div>
  </Dialog>;
}

export function ModalHost() {
  const m = useUI((s) => s.modal);
  if (!m) return null;
  switch (m.kind) {
    case 'auth': return <AuthDialog tab={m.tab} />;
    case 'settings': return useSession.getState().me ? <SettingsDialog /> : <AuthDialog tab="signin" />;
    case 'newPlaylist': return <NameDialog title="New playlist" cta="Create" onSubmit={async (n) => { const j = await createPlaylist(n, m.pending); if (!m.pending) useRouter.getState().navigate({ view: 'ownpl', slug: j.slug }); }} />;
    case 'rename': return <NameDialog title="Rename playlist" initial={m.name} cta="Save" onSubmit={async (n) => { const j = await req('PATCH', `/api/playlists/${m.id}`, { name: n }); await useSession.getState().refreshPlaylists(); useRouter.getState().navigate({ view: 'ownpl', slug: j.slug }, { replace: true }); }} />;
    case 'cover': return <CoverEditor target={m.target} file={m.file} />;
    case 'publish': return <PublishDialog />;
    case 'notifs': return <NotifsDialog />;
    case 'media': return <MediaViewer type={m.type} src={m.src} />;
    case 'confirm': return <ConfirmDialog {...m} />;
    default: return null;
  }
}

/* Cookie consent bar (legacy #cookieBar). */
export function CookieBar() {
  const [show, setShow] = React.useState(!cookiesChoice());
  const reduce = useReducedMotion();
  return <AnimatePresence>{show && <motion.div id="cookieBar" initial={reduce ? false : { y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    className="kb-hide fixed bottom-[calc(56px+env(safe-area-inset-bottom)+var(--player-h,0px)+12px)] left-1/2 z-[45] w-[calc(100%-1.5rem-env(safe-area-inset-left)-env(safe-area-inset-right))] max-w-xl -translate-x-1/2 rounded-xl border bg-popover p-4 shadow-xl md:bottom-[calc(var(--player-h-md,0px)+16px)]">
    <p className="text-sm text-muted-foreground">Muse uses a session cookie if you sign in. Optional: desktop can load YouTube cookies for the embed player. No ads. <a href="/cookies" target="_blank" rel="noopener" className="text-foreground underline">Cookies</a> · <a href="/gdpr" target="_blank" rel="noopener" className="text-foreground underline">GDPR</a></p>
    <div className="mt-3 flex justify-end gap-2">
      <Button variant="outline" size="sm" id="cbReject" onClick={() => { setCookies('needed'); setShow(false); }}>Reject</Button>
      <Button size="sm" id="cbAccept" onClick={() => { setCookies('all'); setShow(false); if (lane() === 'pc' && typeof window.MusePlayer === 'function') location.reload(); }}>Accept all</Button>
    </div>
  </motion.div>}</AnimatePresence>;
}

/* "Muse for Windows / Android" one-time prompts (legacy #deskPrompt / #apkPrompt). */
export function AppPrompt() {
  const me = useSession((s) => s.me);
  const kind = isAndroidWeb && !isAndroidApp ? 'apk' : (!isDeskApp() && !isIOS && !isAndroidApp && !matchMedia('(max-width: 760px)').matches ? 'desk' : null);
  const key = kind === 'apk' ? 'muse:apkPrompt' : 'muse:deskPrompt';
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { if (!kind || !me) return; if (localStorage.getItem(key)) return; const t = setTimeout(() => setOpen(true), 2500); return () => clearTimeout(t); }, [me?.id]);
  const done = () => { try { localStorage.setItem(key, '1'); } catch {} setOpen(false); };
  if (!kind) return null;
  return <Dialog open={open} onOpenChange={(o) => !o && done()} className="max-w-sm text-center">
    <img src="/muselogo.png?v=172" alt="" className="mx-auto size-14 rounded-xl" />
    <h2 className="mt-4 text-xl font-semibold tracking-tight">{kind === 'apk' ? 'Muse for Android' : 'Muse for Windows'}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{kind === 'apk' ? 'The Android app. Background play, auto-update.' : 'The desktop app. One window, tray, auto-update.'}</p>
    <Button asChild className="mt-5 w-full"><a href={kind === 'apk' ? '/android/Muse.apk?v=1.0.3' : '/desktop/Muse-Setup.exe'} download={kind === 'apk' ? 'Muse.apk' : undefined} onClick={done}><Download />{kind === 'apk' ? 'Download for Android' : 'Download for Windows'}</a></Button>
    <Button variant="ghost" className="mt-2 w-full" onClick={done}>Not now</Button>
  </Dialog>;
}
