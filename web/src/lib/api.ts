export async function fetchJSON<T = any>(path: string, opts: RequestInit = {}, timeoutMs = 60000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const parent = opts.signal;
  const onParent = () => ctl.abort();
  if (parent) { if (parent.aborted) ctl.abort(); else parent.addEventListener('abort', onParent, { once: true }); }
  try {
    const r = await fetch(path, { credentials: 'same-origin', ...opts, signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e: any = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; e.data = j; throw e; }
    return j as T;
  } catch (e: any) {
    if (e && e.name === 'AbortError') {
      if (parent && parent.aborted) throw e;
      throw new Error('Request timed out — YouTube is slow, try again');
    }
    throw e;
  } finally { clearTimeout(t); if (parent) parent.removeEventListener('abort', onParent); }
}

export const api = <T = any>(path: string, signal?: AbortSignal) => fetchJSON<T>(path, { signal });

export async function req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const j = await fetchJSON<T>(path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, 30000);
  if (path !== '/api/event' && path !== '/api/presence' && path !== '/api/clientlog') swrClear(true);
  return j;
}
export const post = <T = any>(p: string, b?: unknown) => req<T>('POST', p, b ?? {});

export async function upload<T = any>(path: string, blob: Blob, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': blob.type || 'application/octet-stream', ...headers }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  swrClear(true);
  return j as T;
}

/* Stale-while-revalidate cache, same keys as the legacy client. */
const SWR = 'muse:swr:';
let swrUid: number | null = null;
export const setSwrUser = (id: number | null) => { swrUid = id; };
export function swrGet<T>(path: string): T | null {
  try {
    const s = JSON.parse(localStorage.getItem(SWR + path) || 'null');
    if (!s) return null;
    if (path !== '/api/me' && (!swrUid || s.uid !== swrUid)) return null;
    return s.j;
  } catch { return null; }
}
export function swrPut(path: string, j: any) {
  try {
    const uid = path === '/api/me' ? j?.user?.id ?? null : swrUid;
    localStorage.setItem(SWR + path, JSON.stringify({ uid, j }));
  } catch {}
}
export function swrClear(keepMe = false) {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(SWR) && !(keepMe && k === SWR + '/api/me'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}
export async function swr<T = any>(path: string, paint: (j: T) => void): Promise<T> {
  const cached = swrGet<T>(path);
  if (cached) { try { paint(cached); } catch {} }
  const j: any = await api<T>(path);
  if (!j.building) swrPut(path, j);
  if (!cached || JSON.stringify(cached) !== JSON.stringify(j)) paint(j);
  return j;
}
