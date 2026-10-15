import { toast } from 'sonner';
import { api, fetchJSON, post } from './api';
import { useSession } from './session';
import { useRouter } from './router';
import { isDeskApp, isIOS, isStandalone } from './env';
import type { Notif } from './types';

window.__museBuild = __MUSE_BUILD__;
(window as any).__museUi = 'react';

/* ---- service worker (same /sw.js as legacy: shell offline, API live, push) ---- */
let swP: Promise<ServiceWorkerRegistration | null> | null = null;
export function registerSW() {
  if (isDeskApp() || !('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!swP) {
    swP = navigator.serviceWorker.register('/sw.js').then((r) => { tellWatch(); return r; }).catch(() => null);
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = (e && e.data) || {};
      if (d.type === 'muse-notif-click') {
        const h = String(d.handle || '').toLowerCase();
        if (d.url === '/market') useRouter.getState().navigate({ view: 'market' });
        else useRouter.getState().navigate({ view: 'friends', handle: h });
      }
      if (d.type === 'muse-push') pullNotifs(false);
    });
  }
  return swP;
}

/* tell SW which chat is visible so it can suppress duplicate pushes */
export function tellWatch() {
  try {
    const r = useRouter.getState().route;
    const handle = r.view === 'friends' ? r.handle : '';
    navigator.serviceWorker?.controller?.postMessage({ type: 'muse-watch', handle, visible: !document.hidden });
  } catch {}
}
document.addEventListener('visibilitychange', tellWatch);
useRouter.subscribe(tellWatch);

const b64u = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && !(isIOS && !isStandalone());
let pushOk = false;
let pushBusy = false;
export async function ensurePush() {
  if (!useSession.getState().me || !canPush() || typeof Notification === 'undefined' || Notification.permission !== 'granted' || pushBusy) return;
  pushBusy = true;
  try {
    await registerSW();
    const reg: any = await Promise.race([navigator.serviceWorker.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('sw')), 8000))]);
    if (!reg?.pushManager) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const j = await api('/api/push/key'); if (!j?.key) return;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(j.key) });
    }
    const json = sub.toJSON ? sub.toJSON() : {};
    await fetchJSON('/api/push/sub', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint || sub.endpoint, keys: { p256dh: json.keys?.p256dh || '', auth: json.keys?.auth || '' } }) }, 15000);
    pushOk = true; (window as any).__musePushOk = true;
  } catch { pushOk = false; } finally { pushBusy = false; }
}
export async function dropPush() {
  pushOk = false;
  try {
    const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    try { await fetchJSON('/api/push/unsub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }, 8000); } catch {}
    try { await sub.unsubscribe(); } catch {}
  } catch {}
}
export function askNotifPerm() {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { ensurePush(); return; }
    if (Notification.permission !== 'default') return;
    Notification.requestPermission().then((p) => { if (p === 'granted') ensurePush(); }).catch(() => {});
  } catch {}
}

/* ---- notifications polling (4s, like legacy) ---- */
let after = Number(localStorage.getItem('muse:notifAfter') || 0) || 0;
let booted = false;
let timer: any = 0;
export const notifLog: { list: Notif[] } = { list: [] };

export function goNotif(n: Notif) {
  const nav = useRouter.getState().navigate;
  const h = n?.from?.handle;
  if (n.kind === 'chat' && h) nav({ view: 'friends', handle: h });
  else if (n.kind === 'request' || n.kind === 'accept') nav({ view: 'friends', handle: '' });
  else if (n.kind === 'like') nav({ view: 'market' });
}
export async function markSeen(body: any = { all: true }) {
  try { const j = await post('/api/notifs/seen', body); useSession.setState({ unseen: typeof j.unseen === 'number' ? j.unseen : body.all ? 0 : useSession.getState().unseen }); } catch {}
}
function osNotif(n: Notif) {
  try {
    if (pushOk || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return;
    const x = new Notification(n.title || 'Muse', { body: n.body || '', tag: `muse-${n.kind}-${n.id}` });
    x.onclick = () => { try { window.focus(); x.close(); } catch {} goNotif(n); };
  } catch {}
}
export async function pullNotifs(boot: boolean) {
  if (!useSession.getState().me) return;
  try {
    const j = await api<{ notifs: Notif[]; unseen: number; presence: any }>(`/api/notifs?after=${after}`);
    const items = j.notifs || [];
    items.forEach((n) => { if (n.id > after) after = n.id; });
    try { localStorage.setItem('muse:notifAfter', String(after)); } catch {}
    useSession.setState({ unseen: j.unseen || 0 });
    if (boot || !booted) { booted = true; return; }
    const r = useRouter.getState().route;
    let last: Notif | null = null;
    for (const n of items) {
      if (n.kind === 'chat' && r.view === 'friends' && r.handle && n.from?.handle === r.handle) { markSeen({ ids: [n.id] }); continue; }
      osNotif(n); last = n;
    }
    if (last) { const n = last; toast(n.title || 'Muse', { description: n.body, action: { label: 'Open', onClick: () => goNotif(n) } }); }
  } catch {}
}
export function startNotifPoll() {
  clearInterval(timer);
  if (!useSession.getState().me) return;
  booted = false;
  pullNotifs(true);
  timer = setInterval(() => { if (!document.hidden) pullNotifs(false); }, 4000);
}
export function stopNotifPoll() { clearInterval(timer); }

/* ---- update check (server BUILD vs this bundle) ---- */
export async function checkUpdate() {
  if (isDeskApp()) return;
  try {
    const j = await (await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' })).json();
    if (!(j.build > (window.__museBuild || 0))) return;
    const once = `muse:reloaded:${j.build}`;
    if (sessionStorage.getItem(once)) return;
    toast('New version of Muse', { description: `Build ${j.build} is ready.`, duration: 20000, action: { label: 'Reload', onClick: () => { sessionStorage.setItem(once, '1'); location.reload(); } } });
  } catch {}
}

/* ---- client error log (legacy /api/clientlog) ---- */
let logged = 0;
window.addEventListener('error', (e) => {
  if (logged++ > 5) return;
  fetchJSON('/api/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: [`[react ${window.__museBuild}] ${String(e.message || 'error').slice(0, 180)}`] }) }, 5000).catch(() => {});
});
