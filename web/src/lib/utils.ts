import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

export const fmt = (s?: number | null) => {
  if (!s || !Number.isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

export function ytThumb(id?: string, url?: string) {
  const u = String(url || '');
  if (/googleusercontent\.com|ggpht\.com/.test(u)) return u.replace(/=w\d+-h\d+/, '=w544-h544');
  const vid = id || (u.match(/\/vi\/([\w-]{11})\//) || [])[1];
  if (vid) return `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
  return u;
}

export function prettyTitle(s?: string) {
  return String(s || '')
    .replace(/\s*\[[^[\]]*\]/g, '').replace(/\s*［[^］]*］/g, '').replace(/\s*【[^】]*】/g, '')
    .replace(/\s{2,}/g, ' ').replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
}

const HIDDEN_IDS = new Set(['4NRXx6U8ABQ']);
export function hiddenTrack(t: { id?: string; title?: string } | string | null | undefined, title?: string) {
  const id = t && typeof t === 'object' ? t.id || '' : String(t || '');
  const name = t && typeof t === 'object' ? t.title || '' : title || '';
  if (HIDDEN_IDS.has(id)) return true;
  const s = String(name).toLowerCase();
  return /blinding\s*lights/.test(s) && /official(?:\s+music)?\s+video/.test(s);
}
export const shownTracks = (l?: any[] | null): import('./types').Track[] => (l || []).filter((t) => t && t.id && !hiddenTrack(t));

export function avatarBG(hue?: number) {
  const h = Number.isFinite(hue as number) ? hue : 145;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${((h as number) + 40) % 360} 70% 40%))`;
}

export function splitArtist(title: string, uploader?: string) {
  const t = prettyTitle(title);
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const up = String(uploader || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  if (m) return { artist: m[1].trim(), song: m[2].replace(/\s*\((official|lyric|audio|video)[^)]*\)/ig, '').trim() };
  return { artist: up, song: t.replace(/\s*\((official|lyric|audio|video)[^)]*\)/ig, '').trim() };
}

export function seenLabel(u: { online?: boolean; seen?: number; listening?: string }) {
  if (u.online) return u.listening ? `слушает ${u.listening}` : 'онлайн';
  if (!u.seen) return '';
  const d = Date.now() / 1000 - u.seen;
  if (d < 3600) return `был(а) ${Math.max(1, Math.round(d / 60))} мин назад`;
  if (d < 86400) return `был(а) ${Math.round(d / 3600)} ч назад`;
  return `был(а) ${Math.round(d / 86400)} д назад`;
}

export function fmtJoined(ts?: number) {
  if (!ts) return '';
  try { return new Date(ts * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); } catch { return ''; }
}

export function vibe(ms = 8) { try { navigator.vibrate?.(ms); } catch {} }

export async function writeClip(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export const plPath = (handle: string, slug: string) => `/p/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
export const publicLink = (h: string) => `${location.origin}/@${h}`;
