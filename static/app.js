/* Muse frontend — vanilla, no deps. Type, stream, done. */
const $ = (id) => document.getElementById(id) || __nullEl;
const __nullEl = new Proxy(function () {}, {
  get: () => __nullEl,
  set: () => true,
  apply: () => undefined,
});
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || navigator.userAgent));
if (isIOS) {
  document.documentElement.classList.add('ios-lock');
  try {
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content');
  } catch {}
  document.addEventListener('gesturestart', (e) => {
    if (!e.target.closest || !e.target.closest('#mediaView')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length > 1 && !(e.target.closest && e.target.closest('#mediaView'))) e.preventDefault();
  }, { passive: false });
}
const isAndroidAppEarly = /MuseAndroid/i.test(navigator.userAgent || '')
  || !!window.__museAndroid
  || document.documentElement.classList.contains('muse-android');
const keepBg = () => isIOS || isAndroidAppEarly
  || window.__museLane === 'iphone' || window.__museLane === 'android';
const mobileOS = isIOS || /Android/i.test(navigator.userAgent);
const audioEl = $('audio');
try {
  audioEl.playsInline = true;
  audioEl.setAttribute('playsinline', '');
  audioEl.setAttribute('webkit-playsinline', '');
} catch {}
try {
  audioEl.setAttribute('x-webkit-airplay', 'allow');
  audioEl.defaultMuted = false;
  audioEl.disableRemotePlayback = false;
} catch {}
try { if (isIOS && navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
let userTouched = false;
let tapPlayedAt = 0;
let tapArmed = null;
const justTapPlayed = () => Date.now() - tapPlayedAt < 500;
document.addEventListener('pointerdown', (e) => {
  userTouched = true;
  if (isIOS) {
    // play-and-record is the voice-processing session: it muffles music.
    // Only a real mic/camera capture may enter it.
    if (!iosCapture) iosLiveSession(false);
    try { audioEl.playsInline = true; audioEl.muted = false; audioEl.defaultMuted = false; } catch {}
  }
  if (!mobileOS) return;
  if (e.target.closest('[data-like], .likedot, #bLike, #bAdd, button')) { tapArmed = null; return; }
  const hit = e.target.closest('[data-play],[data-playrow],[data-playall],[data-fyplay]');
  // Open keyboard swallows pointerup on the first result tap — play on down.
  const qEl = document.getElementById('q');
  if (hit && qEl && document.activeElement === qEl) {
    try { qEl.blur(); } catch {}
    tapArmed = null;
    tapPlayedAt = Date.now();
    beginPlayFromEl(hit);
    return;
  }
  if (hit) {
    const wid = hit.dataset.play || hit.dataset.playrow || '';
    if (wid) warmId(wid);
  }
  if (!isIOS) return;
  tapArmed = hit ? { x: e.clientX, y: e.clientY, t: Date.now(), hit } : null;
}, true);
document.addEventListener('pointerup', (e) => {
  if (!isIOS || !tapArmed) return;
  const a = tapArmed;
  tapArmed = null;
  if (Date.now() - a.t > 450) return;
  if (Math.hypot((e.clientX || 0) - a.x, (e.clientY || 0) - a.y) > 18) return;
  if (lpFired || (typeof drag !== 'undefined' && drag && drag.active)) return;
  tapPlayedAt = Date.now();
  beginPlayFromEl(a.hit);
}, true);
function museLane() {
  try { if (window.__museLane) return window.__museLane; } catch {}
  const p = String(location.pathname || '/');
  if (/^\/pc(\/|$)/.test(p)) return 'pc';
  if (/^\/web(\/|$)/.test(p)) return 'web';
  if (/^\/mobile\/iphone(\/|$)/.test(p)) return 'iphone';
  if (/^\/mobile\/android(\/|$)/.test(p)) return 'android';
  try {
    const s = sessionStorage.getItem('muse:lane');
    if (s === 'pc' || s === 'web' || s === 'iphone' || s === 'android') return s;
  } catch {}
  try {
    if (window.__museDesktop || document.documentElement.classList.contains('muse-app')
        || (window.chrome && window.chrome.webview)) return 'pc';
    if (window.__museAndroid || isAndroidAppEarly
        || document.documentElement.classList.contains('muse-android')) return 'android';
  } catch {}
  if (isIOS) return 'iphone';
  return 'web';
}
window.__museLane = museLane();
try {
  document.documentElement.setAttribute('data-lane', window.__museLane);
  sessionStorage.setItem('muse:lane', window.__museLane);
} catch {}
(function bootLanePath() {
  const p = String(location.pathname || '/').replace(/\/+$/, '') || '/';
  if (/^\/(pc|web|mobile\/iphone|mobile\/android)(\/|$)/.test(p)) return;
  if (p !== '/') return;
  const lane = window.__museLane;
  const dest = lane === 'pc' ? '/pc'
    : lane === 'android' ? '/mobile/android'
    : lane === 'iphone' ? '/mobile/iphone'
    : '/web';
  try { history.replaceState({ muse: 1 }, '', dest); } catch {}
})();
/* pc: YouTube iframe in WebView2 (listener IP — starts instantly).
 * web/iphone/android: native /api/audio so lock-screen & hidden tabs keep playing. */
const useEmbedPlay = window.__museLane === 'pc' && typeof MusePlayer === 'function';
const audio = useEmbedPlay ? MusePlayer(audioEl, { handoff: false }) : audioEl;

function ytThumb(id, url) {
  const u = String(url || '');
  if (/googleusercontent\.com|ggpht\.com/.test(u)) {
    return u.replace(/=w\d+-h\d+/, '=w544-h544');
  }
  const vid = id || (u.match(/\/vi\/([\w-]{11})\//) || [])[1];
  if (vid) return `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`;
  return u;
}

function streamUrl(id, extra) {
  const p = new URLSearchParams({ v: id });
  if (isIOS || window.__museLane === 'iphone') p.set('ios', '1');
  if (extra) Object.entries(extra).forEach(([k, v]) => p.set(k, v));
  return `/api/audio?${p}`;
}

function hideInducedPause() {
  if (!isAndroidAppEarly || !document.hidden || userPaused) return false;
  if (!lastHiddenAt) return true;
  return Date.now() - lastHiddenAt < 1200;
}

function tellAndroidPlay() {
  if (!isAndroidAppEarly) return;
  try {
    if (typeof MuseAndroid === 'undefined' || !MuseAndroid.playback) return;
    const title = (current && current.title) || ($('ptitle') && $('ptitle').textContent) || 'Muse';
    const live = !userPaused && audio && !audio.paused && !audio.ended;
    MuseAndroid.playback(!!live, String(title || 'Muse'));
  } catch {}
}
const SPRING = 'cubic-bezier(0.22,1,0.36,1)';

let queue = [];      // what's playing (prev/next walks this)
let results = [];    // search grid — browsing must never touch the queue
let qi = -1;
let queueSource = 'search'; // search | home | foryou | playlist | liked | radio | mix
let queuePid = null; // playlist id the queue came from (playlist source only)
let current = null;  // {id, ...}
let dragging = false;
let shuffle = false;
let repeat = 'off'; // off | all | one
let userPaused = false; // true only when a human pressed pause
let iosCapture = false; // mic/camera session — must not stay on after a tap
let iosNeedRebind = false; // Control Center pause: play() is a no-op until src is set again
let srcSwapAt = 0; // assigning audio.src fires pause; that is not a stop
let lastHiddenAt = 0; // when the page last went hidden (Android hide ≠ pause)
let lastPlayingAt = 0;
let playerShownAt = 0; // taps right after the bar appears hit songs, not the bar
let lastLoopAt = 0;
let searchTimer = null;
let searchToken = 0;
let searchMode = 'songs'; // songs | people
let errTries = 0; // stream-error recovery stage, reset on every clean play
let hiddenSkips = 0; // unplayable songs skipped in a row while locked
let lockRetryFor = ''; // last id we retried after a lock-screen error 4
let warmedIds = new Set(); // songs already asked the server to cache

function lockLog(msg) {
  if (!mobileOS) return;
  try {
    navigator.sendBeacon('/api/clientlog',
      new Blob([JSON.stringify({ lines: [`v176 app ${msg}`] })], { type: 'application/json' }));
  } catch {}
}

const fmt = (s) => {
  if (s == null || isNaN(s) || !isFinite(s)) return s ? String(s) : '';
  s = Math.floor(s);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastT = null;
let toastGo = null;
function paintToast(cls, html, go = null) {
  const t = $('toast');
  if (!t || t === __nullEl) return;
  toastGo = typeof go === 'function' ? go : null;
  t.className = cls;
  t.innerHTML = html;
  t.hidden = false;
  t.classList.remove('show');
  try { void t.offsetWidth; } catch {}
  t.classList.add('show');
  t.style.cursor = toastGo ? 'pointer' : '';
  clearTimeout(toastT);
  toastT = setTimeout(() => {
    t.hidden = true;
    t.classList.remove('show');
    toastGo = null;
  }, 4600);
}
function toast(msg, ok = false, go = null) {
  paintToast(`toast${ok ? ' ok' : ' err'}`, `<span>${escapeHtml(msg)}</span>`, go);
}
function notifyCard(n, go) {
  const who = n.from || {};
  const title = escapeHtml(n.title || who.display || 'Muse');
  const body = escapeHtml(n.body || '');
  paintNote(`${personAv(who)}<span class="note-txt"><b>${title}</b><i>${body}</i></span>`, go);
}

let noteT = null;
let noteGo = null;
function hideNote() {
  const t = $('note');
  if (t && t !== __nullEl) { t.hidden = true; t.classList.remove('show'); }
  noteGo = null;
  clearTimeout(noteT);
}
function paintNote(html, go = null) {
  const t = $('note');
  if (!t || t === __nullEl) return;
  noteGo = typeof go === 'function' ? go : null;
  t.innerHTML = html;
  t.hidden = false;
  t.classList.remove('show');
  try { void t.offsetWidth; } catch {}
  t.classList.add('show');
  t.style.cursor = noteGo ? 'pointer' : '';
  clearTimeout(noteT);
  let phone = false;
  try { phone = matchMedia('(max-width: 760px)').matches; } catch {}
  noteT = setTimeout(hideNote, phone ? 5600 : 4600);
}

async function fetchJSON(path, opts = {}, timeoutMs = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const parent = opts.signal;
  const onParent = () => ctl.abort();
  if (parent) {
    if (parent.aborted) ctl.abort();
    else parent.addEventListener('abort', onParent, { once: true });
  }
  try {
    const rest = { ...opts };
    delete rest.signal;
    const r = await fetch(path, { ...rest, signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      if (parent && parent.aborted) throw e;
      throw new Error('Request timed out — YouTube is slow, try again');
    }
    throw e;
  } finally {
    clearTimeout(t);
    if (parent) parent.removeEventListener('abort', onParent);
  }
}

async function api(path) {
  return fetchJSON(path);
}

async function req(method, path, body) {
  const j = await fetchJSON(path, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, 30000);
  // Any edit can change what the saved views show; listening telemetry can't.
  if (path !== '/api/event') swrClear(true);
  return j;
}
const post = (p, b) => req('POST', p, b);

/* Stale-while-revalidate for user data: paint the last copy from this device
 * instantly, then repaint only if the server's answer differs. */
const SWR = 'muse:swr:';
function swrGet(path) {
  try {
    const s = JSON.parse(localStorage.getItem(SWR + path) || 'null');
    if (!s) return null;
    if (path !== '/api/me' && (!me || s.uid !== me.id)) return null;
    return s.j;
  } catch { return null; }
}
function swrPut(path, j) {
  try {
    const uid = path === '/api/me' ? j?.user?.id ?? null : me?.id ?? null;
    localStorage.setItem(SWR + path, JSON.stringify({ uid, j }));
  } catch {}
}
function swrClear(keepMe = false) {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(SWR) && !(keepMe && k === SWR + '/api/me'))
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}
async function swr(path, paint) {
  const cached = swrGet(path);
  if (cached) { try { paint(cached); } catch {} }
  const j = await api(path);
  if (!j.building) swrPut(path, j);
  if (!cached || JSON.stringify(cached) !== JSON.stringify(j)) paint(j);
  return j;
}

const setHome = (h) => document.body.classList.toggle('home', h);

/* ---------- live search (every letter, debounced, stale-safe) ---------- */
function skel(n = 8) {
  $('loading').innerHTML = Array.from({ length: n }, (_, i) => `
    <div class="skelcard" style="animation-delay:${Math.min(i * 60, 420)}ms">
      <div class="sk-thumb"></div>
      <div class="sk-line"></div>
      <div class="sk-line short"></div>
    </div>`).join('');
  $('loading').hidden = false;
}

function userCardHTML(u) {
  const h = escapeHtml(u.handle || '');
  const letter = escapeHtml((u.display || u.handle || '?')[0] || '?').toUpperCase();
  const av = u.avatar
    ? `<img src="${escapeHtml(u.avatar)}" alt="" />`
    : `<span class="ph" style="background:${avatarBG(u.hue)}">${letter}</span>`;
  const sub = u.online ? 'онлайн' : `@${h}`;
  return `<button type="button" class="ucard" data-openuser="${h}">
    <span class="av-wrap${u.online ? ' is-on' : ''}" data-onh="${h}">${av}<span class="on-dot" aria-hidden="true"></span></span>
    <h3>${escapeHtml(u.display || h)}</h3>
    <p class="up${u.online ? ' is-on' : ''}" data-onh="${h}">${escapeHtml(sub)}</p>
  </button>`;
}

function cardHTML(r, i) {
  return `
  <div class="card" data-play="${r.id}" title="Play">
    <span class="likedot" data-like="${r.id}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>
    <div class="thumb">
      <img ${i < 4 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" draggable="false" src="${ytThumb(r.id, r.thumbnail)}"
        onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${r.id}/mqdefault.jpg'" alt="" />
      <span class="go"><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg></span></span>
      ${r.duration ? `<span class="dur">${fmt(r.duration)}</span>` : ''}
    </div>
    <h3>${escapeHtml(r.title)}</h3>
    ${r.uploader ? `<p class="up">${escapeHtml(r.uploader)}</p>` : ''}
  </div>`;
}

function prewarm(results) {
  // Thumbnails only. Warming AAC here used to start 4 ffmpeg jobs on every
  // search/home paint and stall like / + / play on the same Python process.
  try {
    results.slice(0, 6).forEach((r) => { const im = new Image(); im.decoding = 'async'; im.src = ytThumb(r.id, r.thumbnail); });
  } catch { /* best-effort */ }
}

function showHome() {
  try { closeMore(); } catch {}
  try { stopChatPoll(); } catch {}
  clearTimeout(searchTimer);
  searchToken++;
  window.scrollTo(0, 0);
  // NOTE: queue/qi intentionally survive — browsing home must never
  // decapitate the transport. An ended song with an empty queue just stops.
  setViewNav('home');
  $('view').hidden = true;
  $('view').innerHTML = '';
  $('grid').hidden = true;
  $('grid').innerHTML = '';
  $('loading').hidden = true;
  $('empty').hidden = true;
  setHome(true);
  setPath('/home');
  try { document.title = 'Muse'; } catch {}
  loadHomeFy();
}

let homeFyKey = '';
function vibe(kind = 'select') {
  let name = 'select';
  let ms = 8;
  if (typeof kind === 'number') {
    ms = kind;
    name = kind >= 14 ? 'long' : 'press';
  } else if (kind) {
    name = String(kind);
    ms = name === 'reject' ? 24 : name === 'confirm' ? 12 : name === 'long' ? 16 : 8;
  }
  try {
    if (typeof MuseAndroid !== 'undefined' && MuseAndroid.haptic) {
      MuseAndroid.haptic(name);
      return;
    }
  } catch {}
  try { navigator.vibrate?.(ms); } catch {}
}
function renderHomeTracks(tracks, mode = 'popular') {
  const box = $('homeFy');
  homeQueue = tracks.map((t) => ({ ...t }));
  const title = mode === 'fy' ? 'For You' : 'Popular';
  const sub = mode === 'fy' ? '' : 'Most played on Muse';
  box.innerHTML = `<div class="fyhead"><div><h2>${title}</h2><p>${sub}</p></div></div>
      <div class="grid">${tracks.map(recoCardHTML).join('')}</div>`;
  box.hidden = false;
  markLiked(tracks.map((t) => t.id));
  prewarm(tracks);
}
function localHeardIds() {
  if (!me) return [];
  try { return JSON.parse(localStorage.getItem(`muse:heard:${me.id}`) || '[]'); } catch { return []; }
}
function rememberHeard(id) {
  if (!me || !id) return 0;
  const ids = new Set(localHeardIds());
  ids.add(id);
  const arr = [...ids].slice(-40);
  try { localStorage.setItem(`muse:heard:${me.id}`, JSON.stringify(arr)); } catch {}
  return arr.length;
}
function recoIsPersonal(tracks) {
  return (tracks || []).some((t) => t.reason && t.reason !== 'Fresh for you');
}
function maybeRefreshHomeMix() {
  if (currentView !== 'home') return;
  if (homeFyKey.startsWith('fy|')) return;
  homeFyKey = '';
  loadHomeFy();
}
async function loadPopularTracks() {
  let tracks = [];
  try {
    const j = await api('/api/popular?n=18');
    tracks = j.tracks || [];
  } catch {}
  if (tracks.length < 6) {
    try {
      const j = await api('/api/search?q=popular%20songs&n=15');
      const seen = new Set(tracks.map((t) => t.id));
      for (const t of (j.results || [])) {
        if (!seen.has(t.id)) { tracks.push(t); seen.add(t.id); }
        if (tracks.length >= 18) break;
      }
    } catch {}
  }
  return tracks;
}
async function loadHomeFy() {
  const box = $('homeFy');
  if (!box) return;
  const day = Math.floor(Date.now() / 86400000);
  const wantFy = !!(me && localHeardIds().length >= 3);
  const key = wantFy ? `fy|${me.id}|${day}` : `popular|${day}`;
  if (homeFyKey === key && box.innerHTML) {
    box.hidden = false;
    return;
  }
  homeFyKey = key;
  try {
    const cacheName = wantFy ? `muse:fy:${me.id}` : 'muse:popular';
    const saved = JSON.parse(localStorage.getItem(cacheName) || 'null');
    if (saved && saved.day === day && saved.tracks?.length) {
      renderHomeTracks(saved.tracks, wantFy ? 'fy' : 'popular');
    }
  } catch {}
  if (!box.innerHTML) {
    box.hidden = true;
    skel(8);
  }
  try {
    let mode = 'popular';
    let tracks = [];
    if (me) {
      try {
        const j = await api('/api/recommendations?n=18');
        const recos = j.tracks || [];
        if (recos.length >= 4 && (recoIsPersonal(recos) || localHeardIds().length >= 3)) {
          tracks = recos;
          mode = 'fy';
          loadHomeFy.fyTries = 0;
        } else if (j.building && (loadHomeFy.fyTries = (loadHomeFy.fyTries || 0) + 1) < 3) {
          setTimeout(() => {
            if (currentView === 'home') { homeFyKey = ''; loadHomeFy(); }
          }, 7000);
        }
      } catch {}
    }
    if (mode === 'popular') tracks = await loadPopularTracks();
    $('loading').hidden = true;
    if (currentView !== 'home') return;
    homeFyKey = mode === 'fy' ? `fy|${me.id}|${day}` : `popular|${day}`;
    if (!tracks.length) {
      if (!box.innerHTML) box.hidden = true;
      return;
    }
    renderHomeTracks(tracks, mode);
    try {
      localStorage.setItem(mode === 'fy' ? `muse:fy:${me.id}` : 'muse:popular',
        JSON.stringify({ day, tracks }));
    } catch {}
    if (mode === 'popular') paintOnboardArts(tracks);
  } catch {
    $('loading').hidden = true;
    if (!box.innerHTML) box.hidden = true;
  }
}

function paintSearchMode() {
  const people = searchMode === 'people';
  const sw = $('qSwitch');
  if (sw) {
    sw.classList.toggle('people', people);
    sw.querySelectorAll('.q-sw').forEach((b) => {
      const on = b.dataset.qmode === searchMode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  const inp = $('q');
  if (inp) inp.placeholder = people ? 'Search people…' : 'Search a song…';
}
function syncQClear() {
  const el = $('qClear');
  if (el) el.hidden = !($('q').value || '').length;
}
function clearSearch() {
  $('q').value = '';
  syncQClear();
  showHome();
}

async function doSearch(q) {
  q = (q ?? $('q').value).trim();
  if (q.length < 2) return;
  const token = ++searchToken;
  clearTimeout(searchTimer);
  if (doSearch._ctl) doSearch._ctl.abort();
  const ctl = new AbortController();
  doSearch._ctl = ctl;
  setHome(false);
  setViewNav('home');
  $('view').hidden = true;
  $('view').innerHTML = '';
  $('homeFy').hidden = true;
  $('empty').hidden = true;
  $('grid').hidden = true;
  skel();
  try {
    if (searchMode === 'people') {
      const j = await fetchJSON(`/api/users?q=${encodeURIComponent(q.replace(/^@/, ''))}&n=12`, { signal: ctl.signal }, 12000);
      if (token !== searchToken) return;
      $('loading').hidden = true;
      const users = j.users || [];
      if (!users.length) {
        $('grid').innerHTML = '<div class="vempty">No people found.</div>';
        $('grid').hidden = false;
        return;
      }
      $('grid').innerHTML = users.map(userCardHTML).join('');
      $('grid').hidden = false;
      return;
    }
    const j = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}&n=12`, { signal: ctl.signal }, 12000);
    if (token !== searchToken) return;
    $('loading').hidden = true;
    results = j.results || [];
    if (!results.length) {
      $('grid').innerHTML = '<div class="vempty">No songs found.</div>';
      $('grid').hidden = false;
      return;
    }
    $('grid').innerHTML = results.map(cardHTML).join('');
    $('grid').hidden = false;
    prewarm(results);
    markLiked(results.map((r) => r.id));
    enrichInBackground(results.map((r) => r.id), token);
  } catch (e) {
    if (token !== searchToken || (e && e.name === 'AbortError')) return;
    $('loading').hidden = true;
    $('grid').innerHTML = `<div class="vempty">Search failed.</div>`;
    $('grid').hidden = false;
    toast('Search failed: ' + e.message);
  }
}

/* Phase 2: server enriches details in the background — patch cards in place,
 * silently drop anything that fails the strict music filter. */
async function enrichInBackground(ids, token) {
  if (!ids.length) return;
  try {
    const j = await api(`/api/enrich?ids=${ids.join(',')}`);
    if (token !== searchToken) return; // user already typed something newer
    for (const c of j.cards || []) {
      const el = document.querySelector(`#grid .card[data-play="${c.id}"]`);
      if (el) {
        const img = el.querySelector('img');
        if (img && c.thumbnail) {
          const next = ytThumb(c.id, c.thumbnail);
          if (img.getAttribute('src') !== next) img.src = next;
        }
        if (c.duration && !el.querySelector('.dur')) {
          const d = document.createElement('span');
          d.className = 'dur';
          d.textContent = fmt(c.duration);
          el.querySelector('.thumb').appendChild(d);
        }
        const h = el.querySelector('h3');
        if (h && c.title) h.textContent = c.title;
      }
      for (const list of [results, queue]) {
        const q = list.find((r) => r.id === c.id);
        if (q) Object.assign(q, c);
      }
    }
    // Keep search cards on screen — yanking "leftovers" after paint looks like a second results pass.
  } catch { /* fast cards stay as-is — still playable */ }
}

/* ---------- playback (proxy first, direct URL as fallback) ---------- */
let userVol = 0.85;
let fadeRAF = 0;
let volumeTarget = 0.85; // the volume EVERYTHING must converge to — asserted on tab return

function primeAudioSession() {
  try { if (isIOS && navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  try {
    audio.muted = false;
    audio.defaultMuted = false;
    audio.playsInline = true;
  } catch {}
  const v = userVol > 0.05 ? userVol : 0.85;
  try {
    if (keepBg() || document.hidden) {
      audio.volume = v;
      volumeTarget = v;
    }
  } catch {}
}

function kickPlayback() {
  primeAudioSession();
  try {
    return audio.play();
  } catch (e) {
    return Promise.reject(e);
  }
}

/* Hold the iOS audio session without becoming Now Playing.
 * An unmuted <audio> keep-alive stole the widget (play/pause mixed,
 * clock stuck at 0:01 on the 1s loop). Muted HTML + a tiny oscillator
 * keep the session; the song element stays the Now Playing source. */
let iosCtx = null;
let iosHoldOsc = null;
function keepEl() {
  return document.getElementById('keep');
}
function prepareIosKeep() {
  if (!isIOS) return;
  const k = keepEl();
  if (!k) return;
  try {
    k.playsInline = true;
    k.muted = true;
    k.defaultMuted = true;
    k.loop = true;
    k.volume = 1;
  } catch {}
  try { k.disableRemotePlayback = true; } catch {}
  if (k.readyState < 2) {
    try { k.load(); } catch {}
  }
}
function holdIosCtx() {
  // Navidrome #2167: Web Audio connected to destination steals Now Playing
  // on Safari. Keep this a no-op so Control Center owns the real <audio>.
  return Promise.resolve();
}
function holdIosAudio() {
  if (!isIOS) return Promise.resolve();
  primeAudioSession();
  // Never play a second <audio> — iOS switches Now Playing to it, then
  // drops the card when that clip is muted or paused.
  return holdIosCtx();
}
function releaseIosAudio() {
  const k = keepEl();
  if (k) {
    try { k.pause(); } catch {}
  }
  if (iosHoldOsc) {
    try { iosHoldOsc.stop(); } catch {}
    iosHoldOsc = null;
  }
}

function rampTo(target, ms = 350) {
  const safe = (isIOS || document.hidden)
    ? (target > 0.05 ? target : (userVol > 0.05 ? userVol : 0.85))
    : target;
  volumeTarget = safe;
  cancelAnimationFrame(fadeRAF);
  // Never mute while the phone is locked — iOS treats volume=0 as "session over".
  if (isIOS || document.hidden) {
    try { audio.muted = false; audio.volume = safe; } catch {}
    return Promise.resolve();
  }
  const from = audio.volume;
  const t0 = performance.now();
  return new Promise((res) => {
    const fr = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      try { audio.volume = from + (target - from) * e; } catch {}
      if (k < 1) fadeRAF = requestAnimationFrame(fr);
      else res();
    };
    fadeRAF = requestAnimationFrame(fr);
  });
}

document.addEventListener('visibilitychange', () => {
  primeAudioSession();
  try { tellWatch(); } catch {}
  try { beatPresence(document.hidden); } catch {}
  if (document.hidden) {
    lastHiddenAt = Date.now();
    cancelAnimationFrame(fadeRAF);
    try { if (!userPaused) audio.volume = userVol > 0.05 ? userVol : 0.85; } catch {}
  }
  if (!document.hidden) {
    cancelAnimationFrame(fadeRAF);
    try {
      if (Math.abs(audio.volume - volumeTarget) > 0.02) audio.volume = volumeTarget;
    } catch {}
    try { mediaActions(); } catch {}
    if (current) pinNowPlaying(userPaused ? 'paused' : 'playing');
    if (!userPaused && audio.src && audio.paused && !audio.ended) {
      kickPlayback().catch(() => {});
    }
  } else if (keepBg() && userPaused && current) {
    pinNowPlaying('paused');
  } else if (!userPaused && audio.src && !audio.ended) {
    kickPlayback().catch(() => {});
    try { tellAndroidPlay(); } catch {}
    if (current) pinNowPlaying('playing');
  }
});

function rebindIosSrc(pos) {
  if (!isIOS || !current?.id) return;
  const t = (Number.isFinite(pos) && pos > 0.4) ? pos : (lastSongPos || 0);
  srcSwapAt = Date.now();
  try { audio.src = streamUrl(current.id); } catch {}
  if (t > 0.4) {
    const seek = () => {
      try { audio.currentTime = t; } catch {}
      audio.removeEventListener('loadedmetadata', seek);
    };
    audio.addEventListener('loadedmetadata', seek);
  }
}

function doPlay() {
  const resumeRemote = isIOS && iosNeedRebind;
  userPaused = false;
  lastPauseAt = 0;
  iosNeedRebind = false;
  primeAudioSession();
  try { audio.playbackRate = fxSpec().rate; } catch {}
  // WebKit ignores play() after a Control Center pause unless src is
  // assigned in this same tap. The buffer is already on disk, so this is
  // a seek, not a cold start.
  if (resumeRemote) {
    const t = (Number.isFinite(audio.currentTime) && audio.currentTime > 0.4)
      ? audio.currentTime : (lastSongPos || 0);
    rebindIosSrc(t);
  }
  const played = kickPlayback();
  const after = (ok) => {
    if (ok === false || audio.paused) {
      setPlaying(false);
      return;
    }
    releaseIosAudio();
    setPlaying(true);
    if (!keepBg() && !document.hidden) rampTo(userVol, 450);
    try { beatPresence(false); } catch {}
  };
  if (played && typeof played.then === 'function') {
    return played.then(() => after(true)).catch(() => after(false));
  }
  after(!audio.paused);
  return played;
}

function doPause() {
  // iOS lock-screen next/prev fires pause ~1s after the new track starts.
  if (document.hidden && Date.now() - lastPlayAt < 3000 && !userPaused) {
    try { navigator.mediaSession.playbackState = 'playing'; } catch {}
    return;
  }
  userPaused = true;
  lastPauseAt = Date.now();
  rememberSongPos();
  if (isIOS) {
    // Background Now Playing pause: iOS already paused the song. Starting
    // another audio (even muted) makes the widget disappear. Only hold the
    // session from an in-app pause, and keep metadata on the song.
    if (!document.hidden) holdIosCtx();
    if (!audio.paused) {
      try { audio.pause(); } catch {}
    }
    lastPosState = 0;
    pinNowPlaying('paused');
    [40, 180, 500, 1200].forEach((ms) => {
      setTimeout(() => { if (userPaused && current) pinNowPlaying('paused'); }, ms);
    });
    return;
  }
  if (document.hidden && !isAndroidAppEarly) {
    if (!audio.paused) {
      try { audio.pause(); } catch {}
    }
    lastPosState = 0;
    pinNowPlaying('paused');
    return;
  }
  if (isAndroidAppEarly && document.hidden) {
    if (!audio.paused) {
      try { audio.pause(); } catch {}
    }
    lastPosState = 0;
    pinNowPlaying('paused');
    try { tellAndroidPlay(); } catch {}
    return;
  }
  return Promise.race([rampTo(0, 300), new Promise((r) => setTimeout(r, 350))]).then(() => {
    try { audio.pause(); } catch {}
    audio.volume = userVol;
    lastPosState = 0;
    pinNowPlaying('paused');
  });
}

function swapArt(url, instant = false) {
  const art = $('art');
  url = ytThumb(current && current.id, url);
  if (!url || art.getAttribute('src') === url) return;
  art.src = url;
}

let lastPlay = null; // telemetry anchor {id,title,uploader,thumbnail,thumb,duration,t0}

async function noteEvent(type, p, pos) {
  if (!me || !p || !p.id) return;
  try {
    await post('/api/event', { type, video_id: p.id, title: p.title || '',
      uploader: p.uploader || '', thumbnail: p.thumbnail || p.thumb || '',
      duration: p.duration ?? null, position: pos ?? 0 });
  } catch { /* telemetry never breaks playback */ }
}

function listenSeconds(p) {
  const wall = Math.max(0, (Date.now() - (p?.t0 || Date.now())) / 1000);
  let t = 0;
  try {
    if (p?.id && current?.id === p.id && Number.isFinite(audio.currentTime) && audio.currentTime > 0) {
      t = audio.currentTime;
    }
  } catch {}
  return Math.max(t, wall);
}

async function muselyHeard(id) {
  if (!me || !id) return;
  const n = rememberHeard(id);
  if (n >= 3) maybeRefreshHomeMix();
  await muselyRefreshGate();
  if (!muselyGate.unlocked) {
    await new Promise((r) => setTimeout(r, 500));
    await muselyRefreshGate();
  }
}

function maybeCreditMusely() {
  if (!me || !lastPlay || lastPlay.credited || muselyGate.unlocked || muselyGate.login) return;
  const el = listenSeconds(lastPlay);
  if (el < 30) return;
  lastPlay.credited = true;
  const p = lastPlay;
  noteEvent('play', p, el).then(() => muselyHeard(p.id));
}

function finalizePrev(completed) {
  if (!lastPlay) return;
  const p = lastPlay;
  lastPlay = null;
  const el = listenSeconds(p);
  const heard = completed || el >= 30 || !!p.credited;
  void (async () => {
    if (completed) await noteEvent('complete', p, el);
    else if (!heard) await noteEvent('skip', p, el);
    else await noteEvent('play', p, el);
    if (me && heard) await muselyHeard(p.id);
  })();
}

let playToken = 0; // superseded plays bail out instead of fighting
let lastPlayAt = 0; // playId timestamp — lock-screen "pause" right after next is ignored
let lastPauseAt = 0;
let lastSongPos = 0;
let posTrusted = true; // false until the new src owns currentTime (not the previous song)
let lastAutoAt = 0; // last natural/auto advance — blocks iOS end-of-track nexttrack echo
let lastUserSkipAt = 0; // in-app / lock-screen next/prev

function rememberSongPos() {
  try {
    const t = audio.currentTime;
    if (Number.isFinite(t) && t > 0.35) lastSongPos = t;
  } catch {}
}
function restoreSongPos() {
  if (!isIOS) return;
  try {
    const t = audio.currentTime;
    const dur = trackDuration() || 1e9;
    if (lastSongPos > 2 && lastSongPos < dur - 0.5 && (!Number.isFinite(t) || t < 1.25)) {
      audio.currentTime = lastSongPos;
    }
  } catch {}
}

/* Card data already carries title/art/duration, so the YouTube engine never
 * needs the server for a play; only bare ids (or the server-stream engine)
 * ask /api/play. */
async function trackMeta(id, item) {
  const thumb = ytThumb(id, item.thumbnail || item.thumb);
  if (item.title) return { ...item, id, thumbnail: thumb };
  if (audio.engine === 'yt') {
    for (let i = 0; i < 20; i++) {
      const d = audio.videoData && audio.videoData();
      if (d && d.video_id === id && d.title) {
        return { ...item, id, title: d.title, uploader: d.author || '', thumbnail: thumb,
          duration: audio.duration > 0 ? audio.duration : item.duration };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return api(`/api/play?v=${id}`);
}

function playId(id, meta = {}, list = null, source = 'search') {
  const myToken = ++playToken;
  finalizePrev(false);
  if (list) {
    queue = list.slice();
    qi = Math.max(0, list.findIndex((r) => r.id === id));
    queueSource = source;
    queuePid = source === 'playlist' ? viewArg
      : (source === 'shared' ? (viewArg && viewArg.id) : null);
  }
  const item = queue.find((r) => r.id === id) || meta;
  if (!list) qi = queue.findIndex((r) => r.id === id);
  current = { id, ...item };
  lastPlay = { ...current, t0: Date.now() };
  lastPlayAt = Date.now();
  lastSongPos = 0;
  posTrusted = false;
  errTries = 0;
  lockRetryFor = '';
  userPaused = false;
  cancelAnimationFrame(fadeRAF);
  // Fire play() in this same turn as the tap. iOS drops user activation if
  // we wait on DOM, metadata, or an async function's later ticks.
  try { audio.loop = (repeat === 'one'); } catch {}
  primeAudioSession();
  try { audio.volume = userVol > 0.05 ? userVol : 0.85; } catch {}
  // Same-gesture unlock: an empty play() then src swap. Never mute first —
  // iOS treats muted play() as autoplay and then stays silent in Now Playing.
  if (isIOS && (!audio.src || String(audio.src).startsWith('data:'))) {
    try { audio.play().catch(() => {}); } catch {}
  }
  srcSwapAt = Date.now();
  try {
    audio.src = streamUrl(id);
  } catch {}
  const after = () => {
    if (myToken !== playToken) return;
    primeAudioSession();
    try { audio.volume = userVol > 0.05 ? userVol : 0.85; } catch {}
    setPlaying(true);
    try { registerSW(); } catch {}
    try { releaseIosAudio(); } catch {}
  };
  const played = kickPlayback();
  if (played && typeof played.then === 'function') {
    played.then(after).catch((err) => {
      if (myToken !== playToken) return;
      const name = err && err.name;
      if (name === 'AbortError' || name === 'NotSupportedError') {
        kickPlayback().then(after).catch(() => { if (!audio.paused) return; setPlaying(false); });
        return;
      }
      if (audio.paused) setPlaying(false);
    });
  } else after();
  const firstShow = $('player').hidden;
  $('player').hidden = false;
  if ($('bigplayer').hidden) ensurePlayerHome();
  document.body.classList.add('has-player');
  playerShownAt = Date.now();
  $('ptitle').textContent = item.title || 'Loading…';
  swapArt(item.thumbnail, firstShow);
  $('bLike').classList.toggle('loved', likedSet.has(id));
  setPlaying(true);
  try { mediaSession(current, 'playing'); } catch {}
  try { warmNext(); } catch {}
  trackMeta(id, item).then((m) => {
    if (myToken !== playToken) return; // a newer tap won — stand down
    current = { ...current, ...m };
    const titleEl = $('ptitle');
    titleEl.textContent = m.title;
    swapArt(m.thumbnail, firstShow);
    if (m.duration) $('dur').textContent = fmt(m.duration);
    if ('liked' in m) {
      if (m.liked) likedSet.add(id);
      else likedSet.delete(id);
      paintLikedSet();
    } else markLiked([id]);
    mediaSession(m);
  }).catch((e) => {
    if (myToken !== playToken) return;
    playFail = { id, at: Date.now() };
    audio.volume = userVol;
    const msg = String((e && e.message) || e);
    if (/private|unavailable|deleted|removed|login|sign in|copyright|blocked|age prestar|age-restrict|confirm your age/i.test(msg))
      toast("This video can't be played (private, deleted, or restricted)");
    else toast('Could not play: ' + msg.slice(0, 90));
  });
}

function beginPlayFromEl(el) {
  if (!el) return false;
  const playall = el.closest('[data-playall]');
  if (playall) {
    if (playall.classList.contains('playing')) { doPause(); return true; }
    if (isOurQueue() && current?.id && viewQueue.some((t) => t.id === current.id)) { doPlay(); return true; }
    if (viewQueue.length) playId(viewQueue[0].id, viewQueue[0], viewQueue, currentView);
    return true;
  }
  const fy = el.closest('[data-fyplay]');
  if (fy) {
    if (fy.classList.contains('playing')) { doPause(); return true; }
    const cards = [...document.querySelectorAll('#fyGrid .card')].map((c) => c.dataset.play);
    const list = cards.map((id) => viewQueue.find((r) => r.id === id)).filter(Boolean);
    if (isOurQueue() && current?.id && list.some((t) => t.id === current.id)) { doPlay(); return true; }
    if (list.length) playId(list[0].id, list[0], list, 'foryou');
    else if (viewQueue.length) playId(viewQueue[0].id, viewQueue[0], viewQueue, currentView);
    return true;
  }
  const row = el.closest('[data-playrow]');
  if (row) {
    const trow = row.closest('.trow');
    playId(row.dataset.playrow, rowTrack(trow, row.dataset.playrow), viewQueue, currentView);
    return true;
  }
  const play = el.closest('[data-play]');
  if (!play) return false;
  const card = play.closest('.card');
  const meta = card ? {
    title: card.querySelector('h3')?.textContent || '',
    thumbnail: card.querySelector('img')?.src || ''
  } : {};
  const scope = play.closest('#view') ? viewQueue : (play.closest('#homeFy') ? homeQueue : null);
  const src = play.closest('#view') ? currentView : (play.closest('#homeFy') ? 'home' : 'search');
  const id = play.dataset.play;
  if (scope && scope.length) playId(id, meta, scope, src);
  else if (src === 'search') {
    const t = { ...(results.find((r) => r.id === id) || {}), id, ...meta };
    playId(id, t, [t], 'search');
  } else playId(id, meta, null, src);
  return true;
}

function nowPlayingArt(id, thumb) {
  if (id) {
    const src = `/api/art?v=${encodeURIComponent(id)}`;
    return [
      { src, sizes: '96x96', type: 'image/jpeg' },
      { src, sizes: '256x256', type: 'image/jpeg' },
      { src, sizes: '512x512', type: 'image/jpeg' },
    ];
  }
  const u = ytThumb(id, thumb);
  return u ? [{ src: u, sizes: '512x512', type: 'image/jpeg' }] : [];
}

let lastMetaKey = '';
function applyNowPlayingMeta(m) {
  if (!m || !('mediaSession' in navigator)) return;
  const key = `${m.id || ''}|${m.title || ''}|${m.uploader || ''}`;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: (m.title || 'Muse').slice(0, 180),
    artist: (m.uploader || 'Muse').slice(0, 180),
    album: 'Muse',
    artwork: nowPlayingArt(m.id, m.thumbnail),
  });
  lastMetaKey = key;
}

function pinNowPlaying(state) {
  try {
    if (!current || !('mediaSession' in navigator)) return;
    const key = `${current.id || ''}|${current.title || ''}|${current.uploader || ''}`;
    if (key !== lastMetaKey) applyNowPlayingMeta(current);
    const live = state === 'playing' || (state !== 'paused' && !userPaused && !audio.paused && !audio.ended);
    navigator.mediaSession.playbackState = live ? 'playing' : 'paused';
    pushPositionState(true);
  } catch {}
}

function mediaSession(m, state) {
  try {
    if (!('mediaSession' in navigator)) return;
    applyNowPlayingMeta(m);
    const live = !userPaused && !audio.paused && !audio.ended;
    try { navigator.mediaSession.playbackState = state || (live ? 'playing' : 'paused'); } catch {}
    mediaActions();
    pushPositionState(true);
  } catch { /* older browsers */ }
}

function remotePlayFromNative() {
  userPaused = false;
  lastPauseAt = 0;
  primeAudioSession();
  restoreSongPos();
  try { audio.playbackRate = fxSpec().rate; } catch {}
  lastPosState = 0;
  const t = (Number.isFinite(audio.currentTime) && audio.currentTime > 0.5)
    ? audio.currentTime
    : (lastSongPos || 0);
  // WebKit: after a Control Center pause, play() is a no-op unless src is
  // assigned inside this same handler — even a one-second pause.
  iosNeedRebind = false;
  if (isIOS && current && current.id) rebindIosSrc(t);
  let p;
  try { p = audio.play(); } catch (err) { p = Promise.reject(err); }
  const after = () => {
    releaseIosAudio();
    try { if (current) pinNowPlaying('playing'); } catch {}
    mediaActions();
    pushPositionState(true);
    setPlaying(!audio.paused);
  };
  if (p && typeof p.then === 'function') return p.then(after, after);
  after();
  return p;
}

function mediaActions() {
  try {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', remotePlayFromNative);
      navigator.mediaSession.setActionHandler('pause', () => {
        if (hideInducedPause()) {
          if (!lastHiddenAt) lastHiddenAt = Date.now();
          try { navigator.mediaSession.playbackState = 'playing'; } catch {}
          kickPlayback().catch(() => {});
          try { tellAndroidPlay(); } catch {}
          return;
        }
        userPaused = true;
        if (isIOS) iosNeedRebind = true;
        lastPauseAt = Date.now();
        return doPause();
      });
      try {
        navigator.mediaSession.setActionHandler('stop', () => {
          if (hideInducedPause()) {
            try { navigator.mediaSession.playbackState = 'playing'; } catch {}
            kickPlayback().catch(() => {});
            return;
          }
          userPaused = true;
          if (isIOS) iosNeedRebind = true;
          lastPauseAt = Date.now();
          doPause();
          pinNowPlaying('paused');
        });
      } catch {}
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if ((audio.currentTime || 0) > 3 && posTrusted) {
          try { audio.currentTime = 0; lastSongPos = 0; } catch {}
          lastPosState = 0;
          pushPositionState(true);
        } else {
          lastUserSkipAt = Date.now();
          step(-1)();
        }
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (Date.now() - lastAutoAt < 6000) {
          try { navigator.mediaSession.playbackState = 'playing'; } catch {}
          if (!userPaused && audio.paused && !audio.ended) kickPlayback().catch(() => {});
          pinNowPlaying('playing');
          return;
        }
        lastUserSkipAt = Date.now();
        try { navigator.mediaSession.playbackState = 'playing'; } catch {}
        step(1)();
      });
      for (const a of ['seekbackward', 'seekforward']) {
        try { navigator.mediaSession.setActionHandler(a, null); } catch {}
      }
      try {
        navigator.mediaSession.setActionHandler('seekto', (d) => {
          const dur = trackDuration();
          if (!d || !isFinite(d.seekTime) || !dur) return;
          const t = Math.max(0, Math.min(d.seekTime, dur - 2));
          const wasPlaying = !audio.paused;
          try { audio.currentTime = t; lastSongPos = t; } catch {}
          if (wasPlaying) audio.play().catch(() => {});
          lastPosState = 0;
          pushPositionState(true);
        });
      } catch {}
    } catch {}
  } catch { /* older browsers */ }
}

function bindIosNativePlayer() {
  if (!isIOS || bindIosNativePlayer.done) return;
  bindIosNativePlayer.done = true;
  try { audio.disableRemotePlayback = false; } catch {}
  const k = keepEl();
  if (k) {
    try { k.disableRemotePlayback = true; } catch {}
    try { k.pause(); } catch {}
  }
  try {
    if (navigator.audioSession) {
      navigator.audioSession.type = 'playback';
      navigator.audioSession.addEventListener('statechange', () => {
        try { navigator.audioSession.type = 'playback'; } catch {}
        const st = String(navigator.audioSession.state || '');
        if (st === 'interrupted') {
          rememberSongPos();
          return;
        }
        if (st === 'active' && current && !userPaused && audio.src) {
          mediaActions();
          if (audio.paused && !audio.ended) kickPlayback().catch(() => {});
          pinNowPlaying('playing');
        }
      });
    }
  } catch {}
  document.addEventListener('resume', () => {
    primeAudioSession();
    mediaActions();
    if (current && !userPaused && audio.src && audio.paused && !audio.ended) {
      kickPlayback().catch(() => {});
    }
  });
}

function ensureAudible() {
  if (!isIOS) return;
  primeAudioSession();
}

/* iOS Safari inflates streamed m4a length, so YouTube's figure wins when
 * the element duration is missing, infinite, or obviously too long. */
function trackDuration() {
  const el = isFinite(audio.duration) && audio.duration > 0 && audio.duration < 86400
    ? audio.duration : 0;
  const yt = current && current.duration > 0 ? current.duration : 0;
  if (!posTrusted) return yt || 0;
  if (el && yt) return el > yt * 1.12 ? yt : Math.min(el, yt);
  return el || yt;
}

/* Keep the lockscreen progress alive — iOS kills sessions with stale position. */
let lastPosState = 0;
function pushPositionState(force) {
  try {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const dur = trackDuration();
    if (!dur || !isFinite(dur) || dur < 0.5) return;
    const now = Date.now();
    const live = !audio.paused && !userPaused && !audio.ended;
    const gap = live ? (isIOS ? 400 : 4000) : 0;
    if (!force && gap && now - lastPosState < gap) return;
    lastPosState = now;
    let pos = audio.currentTime;
    if (!posTrusted) pos = 0;
    if (!Number.isFinite(pos) || pos < 0) pos = lastSongPos || 0;
    if (!live && lastSongPos > pos) pos = lastSongPos;
    pos = Math.min(Math.max(0, pos), Math.max(0, dur - 0.05));
    navigator.mediaSession.setPositionState({
      duration: dur,
      // Never 0: Safari drops Now Playing when playbackRate is zero.
      playbackRate: fxSpec().rate || 1,
      position: pos,
    });
  } catch {}
}

/* Warm the NEXT two streams while this one still plays. A locked phone
 * dies if `ended` lands on a cold / unplayable src (Safari error 4). */
function warmId(id) {
  if (!id || warmedIds.has(id)) return;
  fetch(streamUrl(id, { warm: '1' })).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (j.cached || j.started) warmedIds.add(id);
  }).catch(() => {});
}
function warmNext() {
  try {
    if (!shuffle && qi >= queue.length - 2) {
      const ext = extendQueue();
      if (ext && typeof ext.then === 'function') {
        ext.then((ok) => { if (ok) { try { warmNext(); } catch {} } });
      }
    }
    if (audio.engine === 'yt' && !mobileOS) return;
    const ids = [];
    if (shuffle && queue.length > 1) {
      const n = shuffleNext();
      if (queue[n]) ids.push(queue[n].id);
      const extra = queue.find((t, i) => i !== qi && t && t.id && !ids.includes(t.id));
      if (extra) ids.push(extra.id);
    } else {
      if (queue[qi + 1]) ids.push(queue[qi + 1].id);
      if (queue[qi + 2]) ids.push(queue[qi + 2].id);
    }
    ids.forEach(warmId);
  } catch {}
}

/* Your own library as a last-resort pool: liked first, else any playlist. */
async function libraryPool() {
  try {
    const [likes, pls] = await Promise.all([api('/api/likes'), api('/api/playlists')]);
    let pool = likes.tracks || [];
    if (!pool.length && pls.playlists.length) {
      const p = pls.playlists[Math.floor(Math.random() * pls.playlists.length)];
      pool = (await api(`/api/playlists/${p.id}/tracks`)).tracks || [];
    }
    return pool.map((t) => ({ ...t })).sort(() => Math.random() - 0.5);
  } catch {
    return [];
  }
}

/* Endless play: when the queue runs out, APPEND songs not already in it
 * (recommendations, then the same artist, then your library), so prev/next
 * keep working across the boundary and nothing loops. */
let extending = null;
function extendQueue() {
  if (extending) return extending;
  extending = (async () => {
    const seen = new Set(queue.map((t) => t.id));
    if (current?.id) seen.add(current.id);
    const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // the same song re-uploaded (lyrics / sped up / live) isn't a "next song"
    const songNames = new Set(queue.concat(current || []).map((t) => {
      const p = (t.title || '').split(/\s[-–—|]\s/);
      return norm((p[1] || p[0]).replace(/\(.*?\)|\[.*?\]/g, ''));
    }).filter((n) => n.length > 2));
    const isRepeat = (title) => [...songNames].some((n) => norm(title).includes(n));
    const add = [];
    const take = (list) => {
      for (const t of list || []) {
        if (!t?.id || seen.has(t.id) || isRepeat(t.title)) continue;
        seen.add(t.id);
        add.push({ ...t });
        const p = (t.title || '').split(/\s[-–—|]\s/);
        const n = norm((p[1] || p[0]).replace(/\(.*?\)|\[.*?\]/g, ''));
        if (n.length > 2) songNames.add(n);
      }
    };
    if (me) {
      try { take((await api('/api/recommendations?n=15')).tracks); } catch {}
    }
    // "Artist - Song" titles beat the uploader, which is often a fan channel.
    const parts = (current?.title || '').split(/\s[-–—|]\s/);
    const fromTitle = parts.length > 1 ? parts[0].replace(/\(.*?\)|\[.*?\]/g, '').trim() : '';
    const fromUploader = (current?.uploader || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    const artist = fromTitle || fromUploader;
    const queries = artist.length > 1 ? [artist, `${artist} best songs`, `songs like ${artist}`] : [];
    for (const q of queries) {
      if (add.length >= 4) break;
      try { take((await api(`/api/search?q=${encodeURIComponent(q)}&n=12`)).results); } catch {}
    }
    if (add.length < 4 && me) take(await libraryPool());
    if (!add.length) return false;
    queue.push(...add.slice(0, 15));
    return true;
  })().finally(() => { extending = null; });
  return extending;
}

/* Repeat-one restart with a re-entrant guard + stale-URL re-resolve. */
async function restartLoop() {
  const now = Date.now();
  if (now - lastLoopAt < 2000) return;
  lastLoopAt = now;
  try {
    audio.currentTime = 0;
    await audio.play();
    rampTo(userVol, 400);
    return;
  } catch (e) {
  }
  try {
    if (audio.engine !== 'yt') {
      const m = await api(`/api/play?v=${current.id}`);
      current = { ...current, ...m };
    }
    if (keepBg() || document.hidden) audio.volume = userVol;
    else audio.volume = 0;
    audio.src = streamUrl(current.id);
    await audio.play();
    if (keepBg() || document.hidden) audio.volume = userVol;
    else rampTo(userVol, 400);
  } catch {
    audio.volume = userVol;
    toast('Repeat broke — press play to retry');
  }
}

function step(d) {
  return async () => {
    lastUserSkipAt = Date.now();
    if (d > 0 && !shuffle && qi >= queue.length - 1) {
      if (await extendQueue()) playId(queue[qi + 1].id, queue[qi + 1]);
      return;
    }
    if (!queue.length) return;
    let n;
    if (shuffle && queue.length > 1) {
      n = d > 0 ? shuffleNext() : randomOther();
    } else {
      n = qi < 0 ? (d > 0 ? 0 : queue.length - 1) : (qi + d + queue.length) % queue.length;
    }
    playId(queue[n].id, queue[n]);
  };
}

function randomOther() {
  let n;
  do { n = Math.floor(Math.random() * queue.length); } while (n === qi);
  return n;
}

/* The shuffled "next" is chosen once per track so it can be warmed before
 * the current song ends; a locked phone can't wait for a cold fetch. */
let shufflePick = null; // {qi, n, id}
function shuffleNext() {
  const p = shufflePick;
  if (p && p.qi === qi && queue[p.n] && queue[p.n].id === p.id) return p.n;
  if (queue.length < 2) return 0;
  const n = randomOther();
  shufflePick = { qi, n, id: queue[n].id };
  return n;
}

let playFail = null; // {id, at} — last playId rejection, so auto-advance skips corpses fast
let timeAdvAt = 0; // last auto-advance (legacy alias of lastAutoAt)

function nextQueueIndex() {
  if (!queue.length) return -1;
  if (shuffle && queue.length > 1) return shuffleNext();
  if (qi >= 0 && qi < queue.length - 1) return qi + 1;
  return -1;
}

/* One song ends → exactly one next song. iOS fires ended + nexttrack +
 * leftover timeupdate from the previous clock; those used to stack and
 * jump 2–3 tracks, then die silent on a cold src. */
function requestAutoAdvance(reason) {
  const now = Date.now();
  if (userPaused || !current?.id) return false;
  if (repeat === 'one') {
    try { restartLoop(); } catch {}
    return true;
  }
  if (now - lastUserSkipAt < 2500) {
    try { lockLog(`advance-block ${reason} user-skip`); } catch {}
    return false;
  }
  if (now - lastAutoAt < 7000) {
    try { lockLog(`advance-block ${reason} cooldown`); } catch {}
    return false;
  }
  // After playId the element may still report the previous song's time/ended.
  // Never treat that as "this new track finished".
  if (!posTrusted) {
    try { lockLog(`advance-block ${reason} untrusted`); } catch {}
    return false;
  }
  if (now - lastPlayAt < 5000) {
    try { lockLog(`advance-block ${reason} fresh-src`); } catch {}
    return false;
  }
  lastAutoAt = now;
  timeAdvAt = now;
  try { lockLog(`advance ${reason} qi=${qi} qlen=${queue.length} id=${current.id}`); } catch {}
  try { advanceFromPlayback(reason); } catch {}
  return true;
}

async function advanceFromPlayback(from) {
  try { finalizePrev(true); } catch {}
  if (repeat === 'one') { try { restartLoop(); } catch {} return; }
  let n = nextQueueIndex();
  if (n < 0) {
    try {
      const ext = extendQueue();
      if (ext) {
        const hidden = (() => { try { return document.hidden; } catch { return false; } })();
        await Promise.race([ext, new Promise((r) => setTimeout(r, hidden ? 1800 : 8000))]);
      }
    } catch {}
    n = nextQueueIndex();
  }
  const t = n >= 0 ? queue[n] : null;
  if (!t) return;
  try { ensureAudible(); } catch {}
  playId(t.id, t, queue, queueSource);
}

/* thin-line progress */
function paintProgress(ratio) {
  const d = audio.duration;
  const r = ratio ?? (d ? audio.currentTime / d : 0);
  const pct = (Math.min(1, Math.max(0, r)) * 100).toFixed(2) + '%';
  $('pfill').style.width = pct;
  $('pknob').style.left = pct;
  $('pos').textContent = fmt(ratio == null ? audio.currentTime : r * d);
  $('dur').textContent = fmt(d);
}

function seekRatio(ratio) {
  if (!audio.duration) return;
  audio.currentTime = Math.min(0.999, Math.max(0, ratio)) * audio.duration;
  rememberSongPos();
  paintProgress();
  try { pushPositionState(true); } catch {}
}

function setPlaying(p) {
  $('bPlay').classList.toggle('playing', !!p);
  if (p) errTries = 0; // clean playback resets the recovery ladder
  paintHeaderPlay();
  try { muselyGroove(); } catch {}
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = (p && !userPaused) ? 'playing' : 'paused';
    }
  } catch {}
  try { pushPositionState(true); } catch {}
  try { tellAndroidPlay(); } catch {}
  try {
    $('bPlay').classList.remove('pop');
    void $('bPlay').offsetWidth;
    $('bPlay').classList.add('pop');
  } catch { /* cosmetic */ }
}

/* ---------- events ---------- */
let introDone = false;
const motionQ = matchMedia('(prefers-reduced-motion: reduce)');
let REDUCED = motionQ.matches;
try { motionQ.addEventListener('change', (e) => { REDUCED = !!e.matches; }); } catch {}
const isDeskApp = () => {
  try {
    if (window.__museDesktop) return true;
    if (document.documentElement.classList.contains('muse-app')) return true;
    if (window.chrome && window.chrome.webview) return true;
  } catch {}
  return false;
};
const isAndroidApp = () => {
  try {
    if (window.__museAndroid) return true;
    if (document.documentElement.classList.contains('muse-android')) return true;
    if (typeof MuseAndroid !== 'undefined') return true;
    if (/MuseAndroid/i.test(navigator.userAgent || '')) return true;
  } catch {}
  return false;
};
if (isDeskApp()) {
  try {
    window.__museDesktop = 1;
    document.documentElement.classList.add('muse-app');
    document.getElementById('deskPrompt')?.remove();
    document.getElementById('apkPrompt')?.remove();
  } catch {}
}
if (isAndroidApp()) {
  try {
    window.__museAndroid = 1;
    document.documentElement.classList.add('muse-android');
    document.getElementById('deskPrompt')?.remove();
    document.getElementById('apkPrompt')?.remove();
    let n = 32;
    try { if (typeof MuseAndroid !== 'undefined' && MuseAndroid.navBottom) n = MuseAndroid.navBottom() || n; } catch {}
    document.documentElement.style.setProperty('--android-nav', `${Math.max(24, n)}px`);
  } catch {}
}
const isPhone = () => !isDeskApp() && matchMedia('(max-width: 760px)').matches;
const isAndroidWeb = () => /Android/i.test(navigator.userAgent) && !isAndroidApp();

function hardCutIntro() {
  introDone = true;
  try { window.__museIntro = 'done'; } catch {}
  $('intro')?.remove();
  document.querySelectorAll('.intro-pill').forEach((el) => el.remove());
  document.body.classList.remove('intro');
  maybeOnboard();
  if (document.body.classList.contains('onboarding')) return;
  setTimeout(maybeAppPrompts, 400);
  if (isPhone()) return;
  try { $('q').focus({ preventScroll: true }); } catch { try { $('q').focus(); } catch {} }
}

async function endIntro() {
  if (introDone) return;
  if (REDUCED) { hardCutIntro(); return; }
  introDone = true;
  try { window.__museIntro = 'flying'; } catch {}
  const intro = $('intro');
  if (!intro) { hardCutIntro(); return; }
  intro.classList.add('phonefade');
  setTimeout(() => {
    try { intro.remove(); } catch {}
    document.body.classList.remove('intro');
    try { window.__museIntro = 'done'; } catch {}
    maybeOnboard();
    if (document.body.classList.contains('onboarding')) return;
    setTimeout(maybeAppPrompts, 400);
    if (!isPhone()) {
      try { $('q').focus({ preventScroll: true }); } catch { try { $('q').focus(); } catch {} }
    }
  }, 750);
}

function init() {
  window.__museBooted = true;
  $('toast')?.addEventListener('click', () => {
    const go = toastGo;
    if (!go) return;
    toastGo = null;
    const t = $('toast');
    if (t && t !== __nullEl) { t.hidden = true; t.classList.remove('show'); }
    go();
  });
  {
    const t = $('note');
    let y0 = 0;
    let swiped = false;
    t?.addEventListener('touchstart', (e) => {
      y0 = e.touches[0] ? e.touches[0].clientY : 0;
      swiped = false;
    }, { passive: true });
    t?.addEventListener('touchend', (e) => {
      const y1 = (e.changedTouches[0] && e.changedTouches[0].clientY) || y0;
      if (y0 && (y0 - y1) > 36) {
        swiped = true;
        hideNote();
      }
    }, { passive: true });
    t?.addEventListener('click', () => {
      if (swiped) { swiped = false; return; }
      const go = noteGo;
      hideNote();
      if (go) go();
    });
  }
  bindMediaView();
  try { applyPlugs(); } catch {}
  setHome(true);
  audio.volume = userVol;
  if (window.__museIntro === 'done' || !$('intro')) {
    introDone = true;
    maybeOnboard();
    setTimeout(maybeAppPrompts, 700);
  } else {
    setTimeout(endIntro, 1700);
    $('intro')?.addEventListener('click', () => { try { primeAudioSession(); } catch {} endIntro(); });
  }

  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); doSearch(); });
  paintSearchMode();
  syncQClear();
  $('qSwitch')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-qmode]');
    if (!b) return;
    e.preventDefault();
    const next = b.dataset.qmode;
    if (next === searchMode) return;
    searchMode = next;
    paintSearchMode();
    const v = ($('q').value || '').trim();
    if (v.length >= 2) doSearch(v);
  });
  $('qClear')?.addEventListener('click', (e) => {
    e.preventDefault();
    clearSearch();
    try { $('q').focus({ preventScroll: true }); } catch { try { $('q').focus(); } catch {} }
  });
  $('q').addEventListener('input', () => {
    const v = $('q').value;
    syncQClear();
    if (!v.trim()) { showHome(); return; }
    if (v.trim().length < 2) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(v.trim()), 240);
  });
  document.querySelectorAll('.chips button').forEach((b) => {
    b.addEventListener('click', () => { $('q').value = b.dataset.q; doSearch(b.dataset.q); });
  });

  document.addEventListener('click', (e) => {
    if (justTapPlayed() && !e.target.closest('[data-like], .likedot, #bLike, #bAdd')) return;
    if (lpFired) {
      lpFired = false;
      return;
    } // long-press just opened a menu — swallow the ghost click
    if (justDropped()) return; // reorder drop — don't start playback
    if (e.target.closest('[data-like], .likedot, #bLike, #bAdd, button')) return;
    beginPlayFromEl(e.target.closest('[data-play]'));
  });

  $('bPlay').addEventListener('click', () => {
    vibe(10);
    if (!audio.src) return;
    if (audio.paused) doPlay();
    else doPause();
  });
  $('bNext').addEventListener('click', step(1));
  $('bPrev').addEventListener('click', step(-1));
  let lastShuffleTap = 0;
  let lastRepTap = 0;
  $('bShuffle').addEventListener('click', () => {
    const now = Date.now();
    if (now - lastShuffleTap < 600) return; // swallow accidental double-taps
    lastShuffleTap = now;
    shuffle = !shuffle;
    $('bShuffle').classList.toggle('on', shuffle);
  });
  $('bRepeat').addEventListener('click', () => {
    const now = Date.now();
    if (now - lastRepTap < 600) return; // swallow accidental double-taps
    lastRepTap = now;
    // Two states, nothing else: infinite repeat on / off.
    repeat = repeat === 'off' ? 'one' : 'off';
    const b = $('bRepeat');
    b.classList.toggle('on', repeat === 'one');
    try { audio.loop = repeat === 'one'; } catch {}
    b.title = 'Repeat: ' + (repeat === 'one' ? 'on' : 'off');
  });

  audio.addEventListener('play', () => {
    // Now Playing can resume the element without our Media Session handler.
    // A pause() echo must not clear userPaused or minimize-after-pause autoplays.
    if (!(userPaused && Date.now() - lastPauseAt < 400)) userPaused = false;
    primeAudioSession();
    setPlaying(!userPaused || !audio.paused);
    applyAudioFx();
    try { beatPresence(false); } catch {}
  });
  audio.addEventListener('timeupdate', () => { if (audio.currentTime > 1) hiddenSkips = 0; });
  audio.addEventListener('playing', () => {
    ensureAudible();
    if (Number.isFinite(audio.currentTime) && audio.currentTime < 4) posTrusted = true;
    try { mediaActions(); } catch {}
    pushPositionState(true);
  });
  // Warm the next song early: a lock-screen "next" tap can't wait for a cold fetch.
  audio.addEventListener('playing', () => { ensureAudible(); setTimeout(warmNext, 3000); });
  audio.addEventListener('canplay', () => {
    if (userPaused || playToken === 0) return;
    if (audio.ended && posTrusted) return;
    if (!audio.paused && !audio.ended) {
      if (isIOS && audio.muted) primeAudioSession();
      return;
    }
    kickPlayback().catch(() => {});
  });
  mediaActions();
  bindIosNativePlayer();
  audio.addEventListener('pause', () => {
    rememberSongPos();
    // Setting src fires pause. That is the new song loading, not a stop,
    // and treating it as one is why the first tap looks dead.
    if (!userPaused && Date.now() - srcSwapAt < 1200) return;
    if (document.hidden && !userPaused) {
      // Native pause often fires this before the Media Session handler.
      // A pause right after hide is WebKit dropping the session — resume.
      // A pause after we've been in the background is Control Center.
      setTimeout(() => {
        if (userPaused || !document.hidden || !current) return;
        if (!(audio.paused && audio.src)) return;
        const dur = trackDuration();
        const remain = dur ? dur - (audio.currentTime || 0) : Infinity;
        if (posTrusted && (audio.ended || remain < 1.5)) {
          requestAutoAdvance('pause-tail');
          return;
        }
        const justHid = lastHiddenAt && (Date.now() - lastHiddenAt < 900);
        if (justHid && !audio.ended) {
          kickPlayback().catch(() => {});
          try { navigator.mediaSession.playbackState = 'playing'; } catch {}
          return;
        }
        // iOS / Android app: a pause after we've been hidden is Control Center.
        // Desktop Chrome tab-switch is not a user pause — keep playing.
        if (keepBg() && !audio.ended) {
          userPaused = true;
          iosNeedRebind = true;
          lastPauseAt = Date.now();
          pinNowPlaying('paused');
          setPlaying(false);
          try { beatPresence(false); } catch {}
          return;
        }
        if (!audio.ended) {
          kickPlayback().catch(() => {});
          try { navigator.mediaSession.playbackState = 'playing'; } catch {}
        }
      }, 180);
      return;
    }
    if (userPaused) pinNowPlaying('paused');
    setPlaying(false);
  });
  audio.addEventListener('ended', () => {
    try { ensureAudible(); } catch {}
    requestAutoAdvance('ended');
  });
  audio.addEventListener('error', () => {
    if (!audio.src || !current?.id) return;
    // Mix tape: skip a totally empty src in-app. Locked iOS must retry the
    // same file — cascading skips kill the session and jump the queue.
    if (queueSource === 'mix' && audio.readyState === 0 && qi < queue.length - 1
        && !(isIOS && document.hidden)) {
      step(1)();
      return;
    }
    // Locked: error 4 usually means the next file wasn't cached yet. Retry
    // the same id once (warm may finish). Never skip more than one corpse
    // after a handoff — that was the "jumped 3 songs, nothing playing" bug.
    if (document.hidden && audio.readyState < 2) {
      const id = current.id;
      if (lockRetryFor !== id) {
        lockRetryFor = id;
        const token = playToken;
        lockLog(`error-retry ${id}`);
        setTimeout(() => {
          if (token !== playToken || current?.id !== id) return;
          try {
            audio.volume = userVol;
            audio.src = streamUrl(id, { r: '1' });
            audio.play().catch(() => {
              lockLog(`error-retry-fail ${id}`);
              if (isIOS && Date.now() - lastPlayAt < 12000) return;
              hiddenSkips++;
              if (hiddenSkips < (isIOS ? 2 : 3)) step(1)();
            });
          } catch {
            if (!(isIOS && Date.now() - lastPlayAt < 12000)) {
              hiddenSkips++;
              if (hiddenSkips < (isIOS ? 2 : 3)) step(1)();
            }
          }
        }, isIOS ? 3500 : 900);
        return;
      }
      if (isIOS && (hiddenSkips >= 1 || Date.now() - lastPlayAt < 12000)) {
        lockLog(`error-hold ${id}`);
        try {
          audio.src = streamUrl(id, { r: 'e' });
          kickPlayback().catch(() => {});
          pinNowPlaying('playing');
        } catch {}
        return;
      }
      hiddenSkips++;
      lockLog(`error-skip ${id}`);
      step(1)();
      return;
    }
    errTries++;
    // Stage 1: proxy hiccup → jump to the direct stream URL.
    // iOS must stay on same-origin AAC; googlevideo URLs are CORS-blocked.
    if (errTries === 1 && audio.src.includes('/api/audio') && !keepBg()) {
      api(`/api/play?v=${current.id}`).then((m) => {
        if (m.audio_url) {
          audio.src = m.audio_url;
          audio.play().catch(() => recoverLater());
        } else recoverLater();
      }).catch(() => recoverLater());
      return;
    }
    recoverLater();
    // Stage 2: wait a breath (throttles pass), re-resolve fresh, resume.
    function recoverLater() {
      const recoverId = current?.id;
      const token = playToken;
      setTimeout(async () => {
        if (token !== playToken || current?.id !== recoverId) return;
        if (errTries > (isIOS ? 5 : 2)) {
          return;
        }
        try {
          if (!isIOS) {
            const m = await api(`/api/play?v=${recoverId}`);
            if (token !== playToken || current?.id !== recoverId) return;
            if (!m.audio_url) throw new Error('no url');
            current = { ...current, ...m };
          }
          if (keepBg() || document.hidden) audio.volume = userVol;
          else audio.volume = 0;
          audio.src = streamUrl(recoverId);
          await audio.play();
          if (token !== playToken) return;
          if (keepBg() || document.hidden) audio.volume = userVol;
          else rampTo(userVol, 500);
        } catch {}
      }, isIOS ? 1400 : 2500);
    }
  });
  audio.addEventListener('timeupdate', () => {
    if (!dragging) paintProgress();
    rememberSongPos();
    maybeCreditMusely();
    try { pushPositionState(); } catch {}
    if (isIOS && !audio.paused && (audio.muted || audio.volume < 0.05)) primeAudioSession();
    const raw = audio.currentTime;
    if (!posTrusted && Number.isFinite(raw) && raw >= 0 && raw < 2.5) posTrusted = true;
    const t = Number.isFinite(raw) ? raw : 0;
    // Pre-resolve the next stream while this one still plays (gapless handoff).
    try {
      const dur = trackDuration();
      if (dur && dur - t < 45) warmNext();
    } catch {}
    // Watchdog: if `ended` never fires (weird durations), loop by position.
    if (repeat === 'one' && audio.duration && !audio.paused && !audio.seeking
        && audio.duration - audio.currentTime < 0.4) {
      restartLoop();
      return;
    }
    // Start the next src just before this one ends so iOS never sees a
    // dead session. Bound to this src's own clock (posTrusted).
    try {
      const dur = trackDuration();
      const remain = dur ? dur - t : Infinity;
      const hidden = document.hidden;
      const threshold = isIOS ? (hidden ? 1.15 : 0.45) : (hidden ? 1.4 : 0.35);
      if (posTrusted && !audio.paused && dur && remain < threshold && remain >= 0
          && t > 3 && repeat !== 'one') {
        requestAutoAdvance(hidden ? 'early' : 'timeupdate');
      }
    } catch {}
  });
  // Loop driver: wall-clock based, depends on NO media event.
  // Catches every silent death: missing `ended`, frozen timeupdate, stalled tail.
  setInterval(() => {
    try {
      if (repeat !== 'one' || !audio.src) return;
      const d = audio.duration;
      if (!d || !isFinite(d)) return;
      const remain = d - (audio.currentTime || 0);
      if (!audio.paused) {
        lastPlayingAt = Date.now();
        if (remain < 0.35) restartLoop();
      } else if (!userPaused && Date.now() - lastPlayingAt < 3000 && remain < 1.5) {
        restartLoop(); // stopped itself at the very end — pull it back
      }
    } catch {}
  }, 500);
  // Stall guard: the UI must never claim "playing" while nothing moves.
  // Covers frozen time, NaN time, and no-data-ready states. Recovers by
  // re-resolving; if that fails, force-pauses so every icon tells the truth.
  let stallLastT = -1;
  let stallSince = 0;
  let lastRecoverAt = 0;
  setInterval(async () => {
    try {
      if (!audio.src || audio.paused || audio.seeking || audio.ended) {
        stallSince = 0;
        stallLastT = Number.isFinite(audio.currentTime) ? audio.currentTime : -1;
        return;
      }
      // First buffer after a hard reload / remux can sit at 0:00 for a few
      // seconds. Reloading src here is what made it stutter then "become good".
      if (Date.now() - lastPlayAt < 14000) {
        stallSince = 0;
        stallLastT = Number.isFinite(audio.currentTime) ? audio.currentTime : -1;
        return;
      }
      const t = audio.currentTime;
      const dead = !Number.isFinite(t) || audio.readyState < 2;
      // NOTE: no `t > 1` gate — a stream frozen at 0:00 (headers but zero
      // audio frames) must recover exactly the same. 8s grace covers normal
      // buffering; the 30s cooldown stops any reload loop.
      const frozen = Number.isFinite(t) && Number.isFinite(stallLastT) && Math.abs(t - stallLastT) < 0.05;
      if (dead || frozen) {
        if (!stallSince) stallSince = Date.now();
        if (Date.now() - stallSince > 8000 && Date.now() - lastRecoverAt > 30000 && current?.id) {
          lastRecoverAt = Date.now();
          stallSince = 0;
          const pos = Number.isFinite(t) ? t : 0;
          if (audio.engine === 'yt') {
            audio.src = streamUrl(current.id);
            audio.currentTime = pos;
            audio.play().catch(() => {
              if (!document.hidden) { try { audio.pause(); } catch {} }
            });
            return;
          }
          if (document.hidden) {
            audio.volume = userVol;
            audio.play().catch(() => {});
            return;
          }
          try {
            const m = await api(`/api/play?v=${current.id}`);
            current = { ...current, ...m };
            if (isIOS) audio.volume = userVol;
            else audio.volume = 0;
            audio.src = streamUrl(current.id);
            const resume = () => {
              audio.removeEventListener('loadedmetadata', resume);
              try { if (pos < (audio.duration || Infinity)) audio.currentTime = pos; } catch {}
              audio.play().catch(() => { try { audio.pause(); } catch {} });
              rampTo(userVol, 500);
            };
            audio.addEventListener('loadedmetadata', resume);
            // No metadata within 8s = truly dead → stop claiming playback.
            setTimeout(() => {
              try {
                if (!audio.paused && audio.readyState < 2) audio.pause();
              } catch {}
            }, 8000);
          } catch {
            try { audio.pause(); } catch {}
          }
        }
      } else {
        stallSince = 0;
      }
      stallLastT = Number.isFinite(t) ? t : -1;
    } catch {}
  }, 1000);
  // Lock-screen keep-alive: iOS sometimes pauses us after next/prev, and
  // `ended` is often swallowed. A "playing" stall at 0:00 is a dead session.
  setInterval(() => {
    try {
      if (!document.hidden || userPaused || !current || !audio.src) return;
      if (!posTrusted) {
        if (audio.paused || audio.ended) kickPlayback().catch(() => {});
        return;
      }
      if (audio.ended) {
        requestAutoAdvance('keepalive-ended');
        return;
      }
      const dur = trackDuration();
      const t = audio.currentTime || 0;
      const remain = dur ? dur - t : Infinity;
      if (dur && remain < 1.2 && t > 3) {
        requestAutoAdvance(audio.paused ? 'keepalive-paused-end' : 'keepalive-tail');
        return;
      }
      if (audio.paused) {
        kickPlayback().catch(() => {});
        setPlaying(true);
        return;
      }
      ensureAudible();
      // Still at 0:00 after a long buffer — retry THIS track, never skip ahead.
      if (t < 0.2 && Date.now() - lastPlayAt > (isIOS ? 18000 : 8000) && audio.readyState < 3) {
        lockLog(`keepalive-retry ${current.id} rs=${audio.readyState}`);
        try {
          audio.src = streamUrl(current.id, { r: '2' });
          kickPlayback().catch(() => {});
        } catch {}
      }
    } catch {}
  }, 2000);
  audio.addEventListener('loadedmetadata', () => {
    posTrusted = true;
    paintProgress();
  });
  const pline = $('pline');
  const ratioAt = (e) => {
    const r = pline.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  // Each seek is a fresh ranged request to the backend, so dragging only
  // moves the bar; the one real seek happens on release.
  let scrubRatio = null;
  let scrubFrame = 0;
  const scrubTo = (e) => {
    scrubRatio = ratioAt(e);
    if (!scrubFrame) {
      scrubFrame = requestAnimationFrame(() => {
        scrubFrame = 0;
        if (dragging) paintProgress(scrubRatio);
      });
    }
  };
  pline.addEventListener('pointerdown', (e) => {
    if (!audio.duration) return;
    dragging = true;
    pline.classList.add('drag');
    try { pline.setPointerCapture(e.pointerId); } catch {}
    scrubTo(e);
  });
  pline.addEventListener('pointermove', (e) => { if (dragging) scrubTo(e); });
  const endScrub = (e, commit) => {
    if (!dragging) return;
    dragging = false;
    pline.classList.remove('drag');
    if (commit && e.clientX != null) scrubRatio = ratioAt(e);
    if (commit && scrubRatio != null) {
      seekRatio(scrubRatio);
      if (!userPaused && audio.paused) audio.play().catch(() => {});
    } else paintProgress();
    scrubRatio = null;
  };
  pline.addEventListener('pointerup', (e) => endScrub(e, true));
  pline.addEventListener('pointercancel', (e) => endScrub(e, false));
  const setVolFill = (el) => el.style.setProperty('--v', `${el.value}%`);
  try {
    const sv = parseFloat(localStorage.getItem('muse:vol'));
    if (!isNaN(sv)) {
      userVol = Math.min(1, Math.max(0, sv));
      if (isIOS && userVol < 0.05) userVol = 0.85;
      $('vol').value = Math.round(userVol * 100);
      audio.volume = userVol;
    }
  } catch {}
  setVolFill($('vol'));
  $('vol').addEventListener('input', (e) => {
    userVol = e.target.value / 100;
    cancelAnimationFrame(fadeRAF);
    audio.volume = userVol;
    setVolFill(e.target);
    try { localStorage.setItem('muse:vol', String(userVol)); } catch {}
  });
  audio.volume = userVol;

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (mediaViewOpen()) {
        if (mvState.kind === 'video') mvToggleVideo();
        return;
      }
      if (!audio.src) return;
      if (audio.paused) doPlay();
      else doPause();
    }
    if (mediaViewOpen() && mvState.kind === 'video') {
      if (e.key === 'ArrowRight') { e.preventDefault(); mvSkip(10); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); mvSkip(-10); return; }
    }
    if (e.key === 'ArrowRight' && audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
    if (e.key === 'ArrowLeft' && audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 10);
  });
}

/* ================= accounts · playlists · likes · For You ================= */
let me = null;
let currentView = 'home';
let myPlaylists = [];
let pendingTake = null;
let viewArg = null;
let viewQueue = [];
let homeQueue = [];
let likedSet = new Set();

function avatarBG(hue) {
  hue = +hue || 0;
  return `linear-gradient(135deg, hsl(${hue} 75% 52%), hsl(${(hue + 50) % 360} 72% 32%)`;
}

function avatarHTML(cls = '', id = '') {
  const clsAttr = `avatar${cls ? ` ${cls}` : ''}`;
  const idAttr = id ? ` id="${id}"` : '';
  if (me && me.avatar) {
    return `<span class="${clsAttr}"${idAttr}><img src="${me.avatar}" alt="" /></span>`;
  }
  const letter = escapeHtml(((me && me.display) || '?')[0] || '?').toUpperCase();
  const bg = me ? ` style="background:${avatarBG(me.hue)}"` : '';
  return `<span class="${clsAttr}"${idAttr}${bg}>${letter}</span>`;
}

function paintSideUser() {
  const el = $('sideUser');
  if (!el) return;
  el.innerHTML = avatarHTML();
  el.title = me ? (me.display || 'Account') : 'Sign in';
}

function applyTheme() {
  document.documentElement.style.setProperty('--green', (me && me.accent) || '#1ed760');
  paintSideUser();
  applyPlugs();
}

function meHandle() {
  return ((me && (me.handle || me.username)) || '').toLowerCase();
}

function plugStore() {
  return 'muse:plugins:' + ((me && me.id) || 0);
}
function themeStore() {
  return 'muse:theme:' + ((me && me.id) || 0);
}
function fxStore() {
  return 'muse:fx:' + ((me && me.id) || 0);
}
function loadPlugs() {
  return { theme: false, fx: false };
}
function savePlugs(p) {
  try { localStorage.setItem(plugStore(), JSON.stringify(p)); } catch {}
}
function loadThemeCust() {
  try { return JSON.parse(localStorage.getItem(themeStore()) || 'null'); } catch { return null; }
}
function saveThemeCust(t) {
  try {
    if (!t) localStorage.removeItem(themeStore());
    else localStorage.setItem(themeStore(), JSON.stringify(t));
  } catch {}
}
function loadFxMode() {
  try { return localStorage.getItem(fxStore()) || 'normal'; } catch { return 'normal'; }
}
function saveFxMode(id) {
  try { localStorage.setItem(fxStore(), id); } catch {}
}

const FX_MODES = [
  { id: 'normal', name: 'Normal', rate: 1, bass: 0 },
  { id: 'nightcore', name: 'Nightcore', rate: 1.25, bass: 0 },
  { id: 'daycore', name: 'Daycore', rate: 0.82, bass: 0 },
  { id: 'bass', name: 'Bass Boost', rate: 1, bass: 10 },
  { id: 'nightbass', name: 'Nightcore + Bass', rate: 1.25, bass: 8 },
  { id: 'slowed', name: 'Slowed', rate: 0.85, bass: 4 },
];

function fxSpec() {
  if (!loadPlugs().fx) return FX_MODES[0];
  return FX_MODES.find((m) => m.id === loadFxMode()) || FX_MODES[0];
}

let fxCtx = null;
let fxSrc = null;
let fxBass = null;
let fxOut = null;

function fxCanBass() {
  if (isIOS) return false;
  try { if (audio.engine === 'yt') return false; } catch {}
  return true;
}

function ensureFxGraph() {
  if (fxSrc || isIOS) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    fxCtx = fxCtx || new Ctx();
    const node = (audioEl && audioEl.tagName === 'AUDIO') ? audioEl : null;
    if (!node) return;
    fxSrc = fxCtx.createMediaElementSource(node);
    fxBass = fxCtx.createBiquadFilter();
    fxBass.type = 'lowshelf';
    fxBass.frequency.value = 160;
    fxBass.gain.value = 0;
    fxOut = fxCtx.createGain();
    fxSrc.connect(fxBass);
    fxBass.connect(fxOut);
    fxOut.connect(fxCtx.destination);
  } catch { fxSrc = true; }
}

function applyAudioFx() {
  const spec = fxSpec();
  try { audio.playbackRate = spec.rate; } catch {}
  try { if (audioEl && audioEl !== audio) audioEl.playbackRate = spec.rate; } catch {}
  const bFx = $('bFx');
  if (bFx) {
    const on = loadPlugs().fx;
    bFx.hidden = !on;
    bFx.classList.toggle('on', on && spec.id !== 'normal');
  }
  if (spec.bass && fxCanBass()) {
    ensureFxGraph();
    try { if (fxCtx && fxCtx.state === 'suspended') fxCtx.resume(); } catch {}
    try { if (fxBass && fxBass !== true) fxBass.gain.value = spec.bass; } catch {}
  } else {
    try { if (fxBass && fxBass !== true) fxBass.gain.value = 0; } catch {}
  }
}

function applyPlugs() {
  const p = loadPlugs();
  document.documentElement.classList.toggle('plug-theme', p.theme);
  document.documentElement.classList.toggle('plug-fx', p.fx);
  const t = p.theme ? loadThemeCust() : null;
  const root = document.documentElement.style;
  if (t && t.bg) {
    root.setProperty('--bg', t.bg);
    root.setProperty('--panel', t.panel || t.bg);
    root.setProperty('--ink', t.ink || '#f4f4f5');
    root.setProperty('--green', t.accent || (me && me.accent) || '#1ed760');
    root.setProperty('--radius', `${t.radius || 22}px`);
    const ink = t.ink || '#f4f4f5';
    root.setProperty('--dim', ink.length === 7
      ? `rgba(${parseInt(ink.slice(1,3),16)},${parseInt(ink.slice(3,5),16)},${parseInt(ink.slice(5,7),16)},0.6)`
      : 'rgba(244,244,245,0.6)');
    try { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg); } catch {}
  } else {
    root.setProperty('--bg', '#0a0a0b');
    root.setProperty('--panel', '#131315');
    root.setProperty('--ink', '#f4f4f5');
    root.setProperty('--dim', 'rgba(244, 244, 245, 0.6)');
    root.setProperty('--radius', '22px');
    root.setProperty('--green', (me && me.accent) || '#1ed760');
    try { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0a0a0b'); } catch {}
  }
  applyAudioFx();
}

function pathHandle() {
  const m = String(location.pathname || '').match(/^\/@([A-Za-z0-9_.-]{2,24})\/?$/);
  return m ? m[1].toLowerCase() : '';
}
function pathClean() {
  let p = String(location.pathname || '/').replace(/\/+$/, '') || '/';
  p = p.replace(/^\/(pc|web|mobile\/iphone|mobile\/android)(?=\/|$)/, '') || '/';
  return p;
}
function plPath(handle, slug) {
  return `/p/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
}
function viewArgKey(a) {
  if (a && typeof a === 'object') return `${a.handle || ''}/${a.slug || ''}/${a.id || ''}`;
  return String(a ?? '');
}
function routeFromPath() {
  const p = pathClean();
  if (p === '/' || p === '/home') return { view: 'home' };
  if (p === '/liked') return { view: 'liked' };
  if (p === '/market') return { view: 'market' };
  const fr = p.match(/^\/friends(?:\/([A-Za-z0-9_.-]{2,24}))?$/);
  if (fr) return { view: 'friends', handle: (fr[1] || '').toLowerCase() };
  const u = p.match(/^\/@([A-Za-z0-9_.-]{2,24})$/);
  if (u) return { view: 'user', handle: u[1].toLowerCase() };
  const share = p.match(/^\/p\/([A-Za-z0-9_.-]{2,24})\/([^/]+)$/);
  if (share) return { view: 'shared', handle: share[1].toLowerCase(), slug: decodeURIComponent(share[2]) };
  const own = p.match(/^\/p\/([^/]+)$/);
  if (own) return { view: 'ownpl', slug: decodeURIComponent(own[1]) };
  return { view: 'home' };
}
function setPath(p, replace) {
  const url = p || '/home';
  if (location.pathname === url) return;
  try { history[replace ? 'replaceState' : 'pushState']({ muse: 1 }, '', url); } catch {}
}
function playlistById(pid) {
  return myPlaylists.find((x) => +x.id === +pid);
}
function playlistBySlug(slug) {
  const s = String(slug || '').toLowerCase();
  return myPlaylists.find((x) => String(x.slug || '').toLowerCase() === s);
}
function flashShareOk(btn) {
  if (!btn || !btn.classList.contains('vshare-ic')) return;
  btn.classList.remove('is-ok');
  void btn.offsetWidth;
  btn.classList.add('is-ok');
  clearTimeout(btn._okT);
  btn._okT = setTimeout(() => btn.classList.remove('is-ok'), 1400);
}
async function writeClip(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
async function copyPlLink(handle, slug, btn) {
  const url = `${location.origin}${plPath(handle, slug)}`;
  if (btn && btn.classList.contains('vshare-ic')) flashShareOk(btn);
  const ok = await writeClip(url);
  if (!ok) toast(url, true);
  else if (!(btn && btn.classList.contains('vshare-ic'))) toast('Link copied', true);
}
async function takeSharedPlaylist(handle, slug) {
  if (!me) {
    pendingTake = { handle, slug };
    openAuth('signin');
    return;
  }
  try {
    const j = await post(`/api/p/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/take`, {});
    if (j.mine) toast('This is already yours');
    await refreshCounts();
    if (j.id) showView('playlist', j.id);
  } catch (e) {
    toast(e.message || 'Could not add playlist', false);
  }
}

function closeAcct() {
  const p = $('acctPop');
  if (p) p.hidden = true;
}
function closeFxPop() {
  const p = $('fxPop');
  if (p) p.hidden = true;
}
function closeMore() {
  const p = $('morePop');
  if (p) p.hidden = true;
}
function openMore(fromEl) {
  closeMenu();
  closeAcct();
  closeFxPop();
  const pop = $('morePop');
  if (!pop) return;
  pop.hidden = false;
  pop.style.left = '';
  pop.style.top = '';
  const phone = isPhone() && !isDeskApp();
  if (phone || !fromEl) return;
  const card = pop.querySelector('.acct-card');
  const r = fromEl.getBoundingClientRect();
  const w = card.offsetWidth || 268;
  const h = card.offsetHeight || 160;
  let left = r.left;
  let top = r.bottom + 10;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 12);
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function paintAcctPop() {
  const h = meHandle();
  $('acctName').textContent = (me && me.display) || 'Muse';
  $('acctHandle').textContent = h ? `@${h}` : '';
  $('acctAv').innerHTML = avatarHTML();
}

function openAcct(fromEl) {
  if (!me) { openAuth('signin'); return; }
  closeMenu();
  closeFxPop();
  paintAcctPop();
  const pop = $('acctPop');
  pop.hidden = false;
  pop.style.left = '';
  pop.style.top = '';
  const phone = isPhone() && !isDeskApp();
  if (phone || !fromEl) return;
  const card = pop.querySelector('.acct-card');
  const r = fromEl.getBoundingClientRect();
  const w = card.offsetWidth || 268;
  const h = card.offsetHeight || 280;
  let left = r.left;
  let top = r.top - h - 12;
  if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 10);
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function fmtHours(h) {
  const n = Number(h) || 0;
  if (n < 0.05) return `${Math.round(n * 60)} мин`;
  if (n < 10) return `${n.toFixed(1)} ч`;
  return `${Math.round(n)} ч`;
}
function fmtJoined(ts) {
  const t = Number(ts) || 0;
  if (!t) return '—';
  try {
    return new Date(t * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return '—'; }
}
function waitLabel(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s <= 0) return '';
  const d = Math.ceil(s / 86400);
  return d === 1 ? 'Можно сменить через 1 день' : `Можно сменить через ${d} дн.`;
}

function publicLink(handle) {
  return `https://getmuse.eu/@${handle}`;
}

async function doLogout() {
  try { await dropPush(); } catch {}
  try { await post('/api/logout', {}); } catch {}
  me = null;
  swrClear();
  likedSet = new Set();
  homeFyKey = '';
  $('homeFy').hidden = true;
  closeModal();
  closeAcct();
  await refreshMe();
  await refreshCounts();
  paintLikedSet();
  const afterOut = routeFromPath();
  if (afterOut.view === 'shared' || afterOut.view === 'ownpl' || afterOut.view === 'user' || afterOut.view === 'liked') applyRoute();
  else if (['foryou', 'playlist'].includes(currentView)) showHome();
}

function openPublic(handle) {
  const h = (handle || meHandle() || '').toLowerCase();
  if (!h) return;
  showView('user', h);
}

const BADGE_DESC = {
  owner: 'Сделал Muse.',
  dev: 'Пишет код Muse.',
  founder: 'Запустил Muse с нуля.',
  mythic: 'Знак команды Muse.',
  omega: 'Высший знак Muse.',
  early: 'Зарегистрировался в самом начале.',
  h1: 'Прослушал музыку 1 час.',
  h5: 'Прослушал музыку 5 часов.',
  h10: 'Прослушал музыку 10 часов.',
  h50: 'Прослушал музыку 50 часов.',
  h100: 'Прослушал музыку 100 часов.',
  vinyl: 'Прослушал музыку 25 часов.',
  first: 'Включил первую песню.',
  songs10: 'Послушал 10 разных песен.',
  songs50: 'Послушал 50 разных песен.',
  songs100: 'Послушал 100 разных песен.',
  like: 'Поставил лайк на песню.',
  likes10: 'Поставил 10 лайков.',
  likes50: 'Поставил 50 лайков.',
  plays10: 'Включил музыку 10 раз.',
  plays100: 'Включил музыку 100 раз.',
  plays500: 'Включил музыку 500 раз.',
  fire: 'Включил музыку 20 раз.',
  curator: 'Создал плейлист.',
  collector: 'Создал 5 плейлистов.',
  week: 'В Muse уже неделю.',
  month: 'В Muse уже месяц.',
  pioneer: 'Один из первых пользователей.',
  night: 'Слушает музыку ночью.',
};

async function renderPublic(v, handle) {
  v.innerHTML = `<div class="uprofile"><div class="up-empty">Загрузка профиля…</div></div>`;
  setPath('/@' + handle);
  try { document.title = '@' + handle + ' · Muse'; } catch {}
  let data;
  try {
    data = await api('/api/u/' + encodeURIComponent(handle));
  } catch {
    v.innerHTML = `<div class="uprofile"><div class="up-empty">Профиль @${escapeHtml(handle)} не найден.</div></div>`;
    return;
  }
  const u = data.user || {};
  const st = data.stats || {};
  const letter = escapeHtml((u.display || u.handle || '?')[0] || '?').toUpperCase();
  const av = u.avatar
    ? `<img src="${escapeHtml(u.avatar)}" alt="" />`
    : letter;
  const avStyle = u.avatar ? '' : ` style="background:${avatarBG(u.hue)}"`;
  const likes = data.likes || [];
  const pls = data.playlists || [];
  const priv = data.privacy || {};
  const omitted = new Set(data.omitted || []);
  const locked = !!data.hidden && !u.mine;
  const showLikes = !locked && (u.mine || !omitted.has('likes'));
  const showPl = !locked && (u.mine || !omitted.has('playlists'));
  const showBadges = !locked && (u.mine || !omitted.has('badges')) && (data.badges || []).length;
  const hideNote = (on) => (u.mine && on) ? ' <em>скрыто</em>' : '';
  const hName = escapeHtml(u.handle || handle);
  v.innerHTML = `<div class="uprofile">
    <div class="up-hero">
      <div class="up-av-wrap${(!locked && !u.mine && u.online) ? ' is-on' : ''}" ${u.mine ? '' : `data-onh="${hName}"`}>
        <div class="up-av"${locked ? ' style="background:#2a2a2e"' : avStyle}>${locked ? '' : av}</div>
        ${u.mine || locked ? '' : '<span class="on-dot" aria-hidden="true"></span>'}
      </div>
      <h1>${locked ? 'Профиль скрыт' : escapeHtml(u.display || u.handle || 'Muse')}</h1>
      <p class="up-handle">@${hName}</p>
      ${u.mine && priv.hidden ? '<p class="up-lock">Профиль скрыт для других</p>' : ''}
      ${u.mine && priv.anon ? '<p class="up-lock">Для других имя — Аноним</p>' : ''}
      ${u.mine && priv.avatar ? '<p class="up-lock">Фото скрыто для других</p>' : ''}
      ${locked ? '<p class="up-lock">Этот профиль закрыт.</p>' : (u.mine ? '' : `<p class="up-seen${u.online ? ' is-on' : ''}" data-onh="${hName}">${escapeHtml(seenLabel(u))}</p>`)}
      ${u.mine ? '' : `<div class="up-fr">${
        data.friend === 'friends' ? `<button type="button" class="mbtn primary" id="upMsg">Message</button>`
        : data.friend === 'outgoing' ? `<button type="button" class="mbtn ghost" id="upFriend" data-fr="out">Request sent</button>`
        : data.friend === 'incoming' ? `<button type="button" class="mbtn primary" id="upFriend" data-fr="in">Accept</button>`
        : `<button type="button" class="mbtn primary" id="upFriend" data-fr="none">Add friend</button>`
      }</div>`}
      ${showBadges ? `<div class="up-badges">${(data.badges).map((b) => {
        const id = String(b.id || '').replace(/[^a-z0-9]/g, '');
        if (!id) return '';
        const name = escapeHtml(b.name || id);
        const desc = escapeHtml(b.desc || BADGE_DESC[id] || '');
        const legend = b.tier === 'legendary';
        const src = `/badges/${id}.png?v=4`;
        return `<span class="up-badge${legend ? ' is-legend' : ''}" tabindex="0">
          <span class="up-ic"${legend ? ` style="--badge:url('${src}')"` : ''}><img src="${src}" alt="${name}" /></span>
          <span class="up-tip"><b>${name}</b>${desc ? `<i>${desc}</i>` : ''}${legend ? '<em>секретный</em>' : ''}</span>
        </span>`;
      }).join('')}</div>` : ''}
      ${u.mine && priv.badges ? '<p class="up-lock">Значки скрыты для других</p>' : ''}
    </div>
    ${locked ? '' : `<div class="up-stats">
      <div class="up-stat"><b>${escapeHtml(fmtHours(st.hours))}</b><span>всего прослушано</span></div>
      <div class="up-stat"><b>${st.songs || 0}</b><span>треков</span></div>
      <div class="up-stat"><b>${escapeHtml(fmtJoined(u.created))}</b><span>регистрация</span></div>
    </div>`}
    ${showLikes ? `<div class="up-sec">
      <h3>Liked Songs${hideNote(priv.likes)}</h3>
      ${likes.length ? `<div class="tlist">${likes.map((t, i) => trowHTML(t, i)).join('')}</div>` : '<div class="up-empty">Nothing liked yet.</div>'}
    </div>` : ''}
    ${showPl ? `<div class="up-sec">
      <h3>Плейлисты${hideNote(priv.playlists)}</h3>
      ${pls.length ? `<div class="up-pl">${pls.map((p) => {
        const cover = p.custom_cover || p.cover;
        return `<button type="button" class="up-plc" data-upl="${p.id}">
          ${cover ? `<img src="${escapeHtml(cover)}" alt="" />` : `<span class="ph">${escapeHtml(((p.name || '#')[0] || '#').toUpperCase())}</span>`}
          <b>${escapeHtml(p.name)}</b><i>${p.count || 0} треков</i>
        </button>`;
      }).join('')}</div>` : '<div class="up-empty">Нет плейлистов.</div>'}
    </div>` : ''}
  </div>`;
  viewQueue = likes.map((t) => ({ ...t }));
  v.querySelectorAll('[data-upl]').forEach((b) => {
    b.addEventListener('click', () => {
      const pl = pls.find((x) => String(x.id) === String(b.dataset.upl));
      if (!pl) return;
      showView('shared', { handle: (u.handle || handle || '').toLowerCase(), slug: pl.slug || String(pl.id), id: pl.id });
    });
  });
  $('upFriend')?.addEventListener('click', async () => {
    if (!me) { openAuth('signin'); return; }
    const act = $('upFriend').dataset.fr;
    try {
      if (act === 'in') {
        await post('/api/friends/accept', { handle: u.handle || handle });
        toast('Теперь вы друзья', true);
      } else if (act === 'out') return;
      else {
        await post('/api/friends/request', { handle: u.handle || handle });
        toast('Заявка отправлена', true);
      }
      renderPublic(v, handle);
    } catch (e) { toast(e.message || 'Could not send request'); }
  });
  $('upMsg')?.addEventListener('click', () => {
    if (!me) { openAuth('signin'); return; }
    showView('friends', { handle: (u.handle || handle || '').toLowerCase() });
  });
  v.querySelectorAll('.up-badge').forEach((el) => {
    const on = () => {
      v.querySelectorAll('.up-badge.is-on').forEach((x) => x.classList.remove('is-on'));
      el.classList.add('is-on');
    };
    const off = () => el.classList.remove('is-on');
    el.addEventListener('mouseenter', on);
    el.addEventListener('mouseleave', off);
    el.addEventListener('focus', on);
    el.addEventListener('blur', off);
  });
}

function openSettings() {
  if (!me) { openAuth('signin'); return; }
  closeAcct();
  const h = meHandle();
  const wait = waitLabel(me.handle_in);
  const canHandle = !wait;
  const pv = me.privacy || {};
  openModal(`
    <h2>Параметры</h2>
    <p class="msub">Имя, @handle и ссылка на публичный профиль.</p>
    <div class="profiletop">
      ${avatarHTML('big', 'pfAv')}
      <div style="flex:1;min-width:0">
        <label class="fl" style="margin-top:0">Имя</label>
        <input type="text" id="pfName" maxlength="24" value="${escapeHtml(me.display)}" />
      </div>
    </div>
    <label class="fl">Handle</label>
    <div class="handle-row">
      <span>@</span>
      <input type="text" id="pfHandle" maxlength="24" value="${escapeHtml(h)}" ${canHandle ? '' : 'disabled'} autocomplete="off" spellcheck="false" />
    </div>
    <p class="pf-link" id="pfLink">${escapeHtml(publicLink(h))}</p>
    ${wait ? `<p class="pf-wait">${escapeHtml(wait)}</p>` : '<p class="pf-wait">Можно менять раз в 30 дней.</p>'}
    <label class="fl">Приватность</label>
    <div class="pf-priv">
      ${[
        ['pfHide', pv.hidden, 'Скрыть профиль', 'Другие увидят, что профиль закрыт'],
        ['pfAnon', pv.anon, 'Анонимный профиль', 'Вместо имени будет «Аноним»'],
        ['pfHidePl', pv.playlists, 'Скрыть плейлисты', 'Их не будет на странице профиля'],
        ['pfHideLikes', pv.likes, 'Скрыть лайки', 'Liked Songs не показываются'],
        ['pfHideBadges', pv.badges, 'Скрыть значки', 'Значки видны только тебе'],
        ['pfHideAv', pv.avatar, 'Скрыть фото', 'Другие увидят букву вместо фото'],
      ].map(([id, on, title, sub]) => `<label class="pf-tog"><span><b>${title}</b><i>${sub}</i></span><input type="checkbox" id="${id}"${on ? ' checked' : ''} /></label>`).join('')}
    </div>
    <div class="mrow">
      <button class="mbtn ghost" id="pfLogout">Выйти</button>
      <button class="mbtn primary" id="pfSave">Сохранить</button>
    </div>
    ${isDeskApp() || isAndroidApp() ? '' : `${isAndroidWeb() ? '' : `<button class="mbtn ghost block win" id="pfDesk" type="button">${ICO.windows}Download for Windows</button>`}<button class="mbtn ghost block win" id="pfApk" type="button">${ICO.android}Download for Android</button>`}`);
  $('pfAv').title = 'Change photo';
  $('pfAv').addEventListener('click', () => {
    coverKind = 'avatar';
    coverPid = 'me';
    try { $('coverPick').click(); } catch {}
  });
  const syncLink = () => {
    const v = ($('pfHandle').value || '').trim().toLowerCase().replace(/^@/, '');
    $('pfLink').textContent = publicLink(v || h);
  };
  $('pfHandle').addEventListener('input', syncLink);
  $('pfSave').addEventListener('click', async () => {
    try {
      const body = { display: $('pfName').value.trim() };
      const nh = ($('pfHandle').value || '').trim().toLowerCase().replace(/^@/, '');
      if (canHandle && nh && nh !== h) body.handle = nh;
      body.privacy = {
        hidden: !!$('pfHide').checked,
        anon: !!$('pfAnon').checked,
        playlists: !!$('pfHidePl').checked,
        likes: !!$('pfHideLikes').checked,
        badges: !!$('pfHideBadges').checked,
        avatar: !!$('pfHideAv').checked,
      };
      const j = await req('PATCH', '/api/me', body);
      me = j.user;
      applyTheme();
      closeModal();
      await refreshMe();
    } catch (e) { $('modalBox').querySelector('.merr')?.remove();
      const err = document.createElement('div');
      err.className = 'merr';
      err.textContent = e.message || 'Save failed';
      $('pfSave').parentElement.after(err);
    }
  });
  $('pfLogout').addEventListener('click', () => doLogout());
  $('pfDesk')?.addEventListener('click', downloadWindowsApp);
  $('pfApk')?.addEventListener('click', downloadAndroidApp);
}

function openPlugins() {}

function openFxPop(fromEl) {
  if (!loadPlugs().fx) return;
  closeAcct();
  const cur = fxSpec().id;
  const list = $('fxList');
  list.innerHTML = FX_MODES.map((m) =>
    `<button type="button" data-fx="${m.id}" class="${m.id === cur ? 'on' : ''}">${escapeHtml(m.name)}</button>`
  ).join('');
  const pop = $('fxPop');
  pop.hidden = false;
  pop.style.left = '';
  pop.style.top = '';
  list.querySelectorAll('[data-fx]').forEach((b) => {
    b.addEventListener('click', () => {
      saveFxMode(b.dataset.fx);
      applyAudioFx();
      closeFxPop();
    });
  });
  const phone = isPhone() && !isDeskApp();
  if (phone || !fromEl) return;
  const card = pop.querySelector('.fx-card');
  const r = fromEl.getBoundingClientRect();
  const w = card.offsetWidth || 240;
  const h = card.offsetHeight || 280;
  let left = r.right - w;
  let top = r.top - h - 10;
  if (top < 8) top = r.bottom + 10;
  left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function openProfile() { openAcct($('sideUser')); }


async function refreshMe() {
  try {
    const j = await api('/api/me');
    me = j.user;
    swrPut('/api/me', j);
    if (!me) swrClear();
    muselyApplyGate(j.musely);
  } catch {
    me = null;
  }
  applyTheme();
  if (me) {
    startNotifPoll();
    ensurePush();
  } else {
    stopNotifPoll();
    if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = 0; }
    setNotifBadge(0);
    notifAfter = 0;
    notifBoot = false;
  }
}

let notifTimer = 0;
let notifAfter = 0;
let notifBoot = false;
try { notifAfter = +localStorage.getItem('muse:notifAfter') || 0; } catch {}

function stopNotifPoll() {
  if (notifTimer) { clearInterval(notifTimer); notifTimer = 0; }
}

function startNotifPoll() {
  stopNotifPoll();
  if (!me) return;
  notifBoot = false;
  pullNotifs(true);
  notifTimer = setInterval(() => pullNotifs(false), 4000);
  armPresence();
}

let presenceTimer = 0;
let presenceSeq = 0;
function presenceListening() {
  if (document.hidden || !current || userPaused || !audio || audio.paused || audio.ended) return '';
  return String(current.title || '').slice(0, 80);
}
function beatPresence(away) {
  if (!me) return;
  if (!away && document.hidden) return;
  presenceSeq += 1;
  const seq = presenceSeq;
  const body = away
    ? { away: true, seq }
    : { listening: presenceListening(), seq };
  fetchJSON('/api/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 8000).catch(() => {});
}
function armPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = 0;
  if (!me) return;
  if (!document.hidden) beatPresence(false);
  presenceTimer = setInterval(() => {
    if (!me || document.hidden) return;
    beatPresence(false);
  }, 12000);
}
function tellWatch() {
  try {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw) return;
    sw.postMessage({
      type: 'muse-watch',
      handle: (chatWith || '').toLowerCase(),
      visible: document.visibilityState === 'visible',
    });
  } catch {}
}
function openNotifChat(handle) {
  const h = String(handle || '').toLowerCase();
  if (h && chatWith === h && typeof window.__musePullChat === 'function') {
    window.__musePullChat();
    return;
  }
  if (h) showView('friends', { handle: h }, true);
  else showView('friends', undefined, true);
}

function setNotifBadge(n) {
  const t = n > 0 ? String(n) : '';
  const a = $('moreCount');
  const b = $('tabMoreCount');
  if (a && a !== __nullEl) a.textContent = t;
  if (b && b !== __nullEl) b.textContent = t;
  document.querySelectorAll('.nav-dot').forEach((d) => d.remove());
}

function b64urlToU8(s) {
  const pad = '='.repeat((4 - (String(s || '').length % 4)) % 4);
  const bin = atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/') + pad);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function isStandaloneApp() {
  try {
    if (window.navigator.standalone) return true;
    if (matchMedia('(display-mode: standalone)').matches) return true;
    if (matchMedia('(display-mode: fullscreen)').matches) return true;
  } catch {}
  return !!(window.__museDesktop || window.__museAndroid);
}

function canWebPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (isIOS && !isStandaloneApp()) return false;
    return true;
  } catch { return false; }
}

async function ensurePush() {
  if (!me || !canWebPush()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (ensurePush.busy) return;
  ensurePush.busy = true;
  try {
    await registerSW();
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('sw')), 8000)),
    ]);
    if (!reg || !reg.pushManager) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const j = await api('/api/push/key');
      if (!j || !j.key) return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToU8(j.key),
      });
    }
    const json = sub.toJSON ? sub.toJSON() : {};
    const keys = json.keys || {};
    await fetchJSON('/api/push/sub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint || sub.endpoint,
        keys: { p256dh: keys.p256dh || '', auth: keys.auth || '' },
      }),
    }, 15000);
    window.__musePushOk = true;
  } catch {
    window.__musePushOk = false;
  } finally {
    ensurePush.busy = false;
  }
}

async function dropPush() {
  window.__musePushOk = false;
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    try {
      await fetchJSON('/api/push/unsub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }, 8000);
    } catch {}
    try { await sub.unsubscribe(); } catch {}
  } catch {}
}

function askNotifPerm() {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') { ensurePush(); return; }
    if (Notification.permission !== 'default') return;
    Notification.requestPermission().then((p) => {
      if (p === 'granted') ensurePush();
    }).catch(() => {});
  } catch {}
}

function fireOsNotif(title, body, tag, go) {
  try {
    if (window.__musePushOk) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus && document.hasFocus()) return;
    const n = new Notification(title, { body: body || '', tag: tag || 'muse', silent: false });
    n.onclick = () => {
      try { window.focus(); } catch {}
      try { n.close(); } catch {}
      if (typeof go === 'function') go();
    };
  } catch {}
}

function goNotif(n) {
  const h = n && n.from && n.from.handle;
  if (n && n.kind === 'chat' && h) showView('friends', { handle: h });
  else if (n && (n.kind === 'request' || n.kind === 'accept')) showView('friends');
  else if (n && n.kind === 'like') showView('market');
}

async function markNotifsSeen(body) {
  try {
    const j = await post('/api/notifs/seen', body || { all: true });
    if (typeof j.unseen === 'number') setNotifBadge(j.unseen);
    else if (body && body.all) setNotifBadge(0);
  } catch {}
}

async function pullNotifs(boot) {
  if (!me) return;
  try {
    const j = await api(`/api/notifs?after=${notifAfter}`);
    if (j.presence) applyPresence(j.presence);
    const items = j.notifs || [];
    items.forEach((n) => { if (n.id > notifAfter) notifAfter = n.id; });
    try { localStorage.setItem('muse:notifAfter', String(notifAfter)); } catch {}
    setNotifBadge(j.unseen || 0);
    if (boot || !notifBoot) {
      notifBoot = true;
      return;
    }
    let last = null;
    items.forEach((n) => {
      if (n.kind === 'chat' && currentView === 'friends' && chatWith && n.from && n.from.handle === chatWith) {
        markNotifsSeen({ ids: [n.id] });
        return;
      }
      const title = n.title || 'Muse';
      const body = n.body || '';
      const go = () => goNotif(n);
      if (document.hidden || (document.hasFocus && !document.hasFocus())) {
        fireOsNotif(title, body, `muse-${n.kind}-${n.id}`, go);
      }
      last = n;
    });
    if (last) notifyCard(last, () => goNotif(last));
  } catch {}
}

async function refreshCounts() {
  if (!me) {
    renderPlList([]);
    return;
  }
  try {
    await swr('/api/playlists', (pls) => renderPlList(pls.playlists));
  } catch { /* offline-ish: keep old list */ }
}

function renderPlList(pls) {
  const box = $('plList');
  if (!box) return;
  myPlaylists = pls || [];
  if (!me) {
    box.innerHTML = '<div class="plock">Sign in to build playlists that live here.</div>';
    return;
  }
  box.innerHTML = myPlaylists.map((p) => `
    <button class="pl${currentView === 'playlist' && +viewArg === p.id ? ' on' : ''}" data-pl="${p.id}" title="${escapeHtml(p.name)}">
      ${(p.custom_cover || p.cover) ? `<img src="${p.custom_cover || p.cover}" alt="" />` : `<span class="ph">${escapeHtml(((p.name || '#')[0] || '#').toUpperCase())}</span>`}
      <span class="nm">${escapeHtml(p.name)}</span>
    </button>`).join('');
  box.querySelectorAll('.pl').forEach((b) => b.addEventListener('click', () => showView('playlist', +b.dataset.pl)));
}

const F = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const FP = 'xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" overflow="visible"';
const ic = (inner) => `<svg ${F} width="24" height="24">${inner}</svg>`;
const icPad = (inner) => `<svg ${FP} width="24" height="24">${inner}</svg>`;
const ICO = {
  heart: icPad('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
  play: ic('<polygon points="5 3 19 12 5 21 5 3"/>'),
  pause: ic('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'),
  next: ic('<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>'),
  home: ic('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  spark: ic('<path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"/>'),
  plus: ic('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  download: ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  link: ic('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  up: ic('<polyline points="18 15 12 9 6 15"/>'),
  down: ic('<polyline points="6 9 12 15 18 9"/>'),
  x: icPad('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  check: ic('<polyline points="20 6 9 17 4 12"/>'),
  play: ic('<polygon points="5 3 19 12 5 21 5 3"/>'),
  pencil: ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
  trash: ic('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  refresh: ic('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  music: icPad('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  mic: ic('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
  smile: ic('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>'),
  attach: ic('<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  back: ic('<polyline points="15 18 9 12 15 6"/>'),
  vol: ic('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
  mute: ic('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'),
  cam: ic('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  image: ic('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
  gif: ic('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 15v-4a1 1 0 0 1 1-1h1.5M7 12h2M13 10v5M16.5 10H19v2.5h-2V15"/>'),
  reply: ic('<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
  windows: '<svg class="win-ic" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision" image-rendering="optimizeQuality" fill-rule="evenodd" clip-rule="evenodd" viewBox="0 0 512 512.02" aria-hidden="true"><path fill="#fff" fill-rule="nonzero" d="M0 512.02h242.686V269.335H0V512.02zm0-269.334h242.686V0H0v242.686zm269.314 0H512V0H269.314v242.686zm0 269.334H512V269.335H269.314V512.02z"/></svg>',
  android: '<svg class="win-ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M17.6 11.48L19.44 8.3a.64.64 0 0 0-.25-.83.64.64 0 0 0-.83.25l-1.78 3.08a11.2 11.2 0 0 0-9.16 0L5.64 7.72a.64.64 0 0 0-.83-.25.64.64 0 0 0-.25.83l1.84 3.18A10.94 10.94 0 0 0 1 21h22a10.94 10.94 0 0 0-5.4-9.52zM7 16.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/></svg>',
};

const FA_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>';
const plEmptyHTML = () => `<div class="mempty">${ICO.music}<b>No playlists yet</b><span>Make your first Playlist below</span></div>`;
const vplayIc = (attrs) => `<button class="vplay-ic" ${attrs} title="Play">
  <svg class="ic-play" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>
  <svg class="ic-pause" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512" fill="currentColor"><path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"/></svg>
</button>`;
const vshareIc = (handle, slug) => `<button type="button" class="vshare-ic" title="Share" data-shareh="${escapeHtml(handle)}" data-shares="${escapeHtml(slug)}">
  <span class="ic-link">${ICO.link}</span>
  <span class="ic-ok">${ICO.check}</span>
</button>`;

/* Header discs mirror the transport: pause while their list plays. */
function paintHeaderPlay(view = currentView, arg = viewArg) {
  const playingList = !audio.paused && !!audio.src
    && queueSource === view
    && (view !== 'playlist' || queuePid === arg)
    && (view !== 'shared' || queuePid === (arg && arg.id));
  const active = !!(current?.id && playingList && viewQueue.length);
  document.querySelectorAll('[data-playall],[data-fyplay]').forEach((b) => {
    b.classList.toggle('playing', active);
    b.title = active ? 'Pause' : 'Play';
  });
}

/* Resume only when THIS list is the one loaded (same view, same playlist).
 * Otherwise the disc always (re)starts its own list from the top. */
function isOurQueue() {
  if (queueSource !== currentView) return false;
  if (currentView === 'playlist') return queuePid === viewArg;
  if (currentView === 'shared') return queuePid === (viewArg && viewArg.id);
  return true;
}

function trackMeta(id, card) {
  // View list first: it carries extra keys (item_id) the search queue lacks.
  const fromLists = viewQueue.find((r) => r.id === id)
    || queue.find((r) => r.id === id)
    || results.find((r) => r.id === id);
  if (fromLists) return fromLists;
  if (card) {
    return { id, title: card.querySelector('h3')?.textContent || '',
      thumbnail: card.querySelector('img')?.src || '' };
  }
  return { id };
}

/* ---------- view router ---------- */
function setViewNav(view) {
  currentView = view;
  document.querySelectorAll('.snav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  document.querySelectorAll('#tabbar button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  const moreOn = view === 'market' || view === 'friends';
  $('tabMore')?.classList.toggle('on', moreOn);
  $('sideMore')?.classList.toggle('on', moreOn);
  document.querySelectorAll('#plList .pl').forEach((b) => b.classList.toggle('on',
    view === 'playlist' && +b.dataset.pl === viewArg));
  try {
    localStorage.setItem('muse:place', JSON.stringify({ view, arg: viewArg, q: $('q')?.value || '' }));
  } catch {}
  try { moveTabInd(view); } catch {}
}

/* Sliding pill under the active tab — the bar itself animates, not the page. */
function moveTabInd(view) {
  try {
    if (!isPhone()) return;
    const bar = $('tabbar');
    const ind = $('tabInd');
    if (!bar || !ind) return;
    let btn = bar.querySelector(`button[data-view="${view}"]`);
    // Library has no data-view (it opens a sheet) — highlight it while open.
    if (view === 'library') btn = $('tabLib');
    if (view === 'market' || view === 'friends') btn = $('tabMore');
    if (!btn) return;
    const br = bar.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    ind.style.left = `${r.left - br.left + 6}px`;
    ind.style.width = `${r.width - 12}px`;
  } catch {}
}

async function applyRoute() {
  const r = routeFromPath();
  if (r.view === 'home') {
    if (pathClean() === '/' || pathClean() === '') setPath('/home', true);
    showHome();
    return;
  }
  if (r.view === 'liked') { showView('liked'); return; }
  if (r.view === 'market') { showView('market'); return; }
  if (r.view === 'friends') {
    showView('friends', r.handle ? { handle: r.handle } : undefined);
    return;
  }
  if (r.view === 'user') { showView('user', r.handle); return; }
  if (r.view === 'shared') { showView('shared', r); return; }
  if (r.view === 'ownpl') {
    if (!myPlaylists.length && me) {
      try { await swr('/api/playlists', (pls) => renderPlList(pls.playlists)); } catch {}
    }
    const p = playlistBySlug(r.slug);
    if (p) showView('playlist', p.id);
    else showHome();
  }
}

async function restorePlace() {
  const r = routeFromPath();
  if (r.view !== 'home') { await applyRoute(); return; }
  setPath('/home', true);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('muse:place') || 'null'); } catch {}
  if (saved && saved.view === 'home' && saved.q && saved.q.trim().length >= 2) {
    $('q').value = saved.q;
    doSearch(saved.q);
  }
}

async function showView(name, arg = null, force = false) {
  closeMenu();
  closeAcct();
  closeMore();
  closeFxPop();
  try { stopChatPoll(); } catch {}
  if ($('bigplayer').hidden) ensurePlayerHome();
  window.scrollTo(0, 0);
  if (!force && name === currentView && name !== 'home' && viewArgKey(arg) === viewArgKey(viewArg)) return;
  viewArg = arg;
  setViewNav(name);
  clearTimeout(searchTimer);
  searchToken++;
  if (name !== 'user' && name !== 'shared') {
    try { document.title = 'Muse'; } catch {}
  }
  if (name === 'home') {
    $('view').hidden = true; $('view').innerHTML = '';
    setPath('/home');
    return;
  }
  setHome(false);
  $('grid').hidden = true;
  $('loading').hidden = true;
  $('empty').hidden = true;
  $('homeFy').hidden = true;
  const v = $('view');
  v.hidden = false;
  if (name === 'foryou') return renderForYou(v);
  if (name === 'liked') { setPath('/liked'); return renderLiked(v); }
  if (name === 'playlist') return renderPlaylist(v, arg);
  if (name === 'shared') return renderShared(v, arg);
  if (name === 'user') return renderPublic(v, arg);
  if (name === 'market') { setPath('/market'); return renderMarket(v); }
  if (name === 'friends') {
    setPath('/friends');
    askNotifPerm();
    return renderFriends(v, arg);
  }
}

function seenLabel(u) {
  if (!u) return '';
  if (u.online && u.listening) return `слушает — ${u.listening}`;
  if (u.online) return 'онлайн';
  const s = Number(u.seen) || 0;
  if (!s) return u.handle ? `@${u.handle}` : '';
  const ago = (Date.now() / 1000) - s;
  if (ago < 90) return 'был(а) только что';
  if (ago < 3600) return `был(а) ${Math.max(1, Math.floor(ago / 60))} мин. назад`;
  if (ago < 86400) return `был(а) ${Math.max(1, Math.floor(ago / 3600))} ч. назад`;
  const d = Math.floor(ago / 86400);
  return d === 1 ? 'был(а) вчера' : `был(а) ${d} дн. назад`;
}

function applyPresence(map) {
  if (!map) return;
  Object.keys(map).forEach((h) => {
    const st = map[h] || {};
    const on = !!st.online;
    const label = seenLabel({
      online: on, seen: st.seen, handle: h, listening: on ? (st.listening || '') : '',
    });
    document.querySelectorAll('[data-onh]').forEach((el) => {
      if ((el.getAttribute('data-onh') || '') !== h) return;
      if (el.classList.contains('av-wrap') || el.classList.contains('up-av-wrap')) {
        el.classList.toggle('is-on', on);
      }
      if (el.tagName === 'I' || el.classList.contains('chat-seen') || el.classList.contains('up-seen') || el.classList.contains('up')) {
        if (el.dataset.typing === '1') return;
        el.classList.toggle('is-on', on);
        el.textContent = label;
      }
    });
  });
}

function personAv(u, cls = '') {
  const letter = escapeHtml(((u && u.display) || (u && u.handle) || '?')[0] || '?').toUpperCase();
  const inner = (u && u.avatar)
    ? `<span class="avatar ${cls}"><img src="${escapeHtml(u.avatar)}" alt="" /></span>`
    : `<span class="avatar ${cls}" style="background:${avatarBG(u && u.hue)}">${letter}</span>`;
  const h = (u && u.handle) || '';
  const on = u && u.online ? ' is-on' : '';
  return `<span class="av-wrap${on}" data-onh="${escapeHtml(h)}">${inner}<span class="on-dot" aria-hidden="true"></span></span>`;
}

function mkCover(p) {
  const c = p.custom_cover || p.cover;
  if (c) return `<img src="${escapeHtml(c)}" alt="" />`;
  return `<span class="ph">${escapeHtml(((p.name || '#')[0] || '#').toUpperCase())}</span>`;
}

function mkRankHTML(place) {
  const pal = {
    1: { rim: '#8a5a00', mid: '#efc022', hi: '#fff3a6', ink: '#4a2e00' },
    2: { rim: '#5a5f68', mid: '#c9ced6', hi: '#f6f7fb', ink: '#2a2d33' },
    3: { rim: '#7a3a12', mid: '#d07030', hi: '#ffc090', ink: '#3a1608' },
  }[place] || { rim: '#555', mid: '#aaa', hi: '#ddd', ink: '#222' };
  const glyph = {
    1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
    2: ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
    3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  }[place] || [];
  const nums = glyph.map((row, gy) => [...row].map((ch, gx) => (
    ch === '#' ? `<rect x="${gx}" y="${gy}" width="1" height="1" fill="${pal.ink}"/>` : ''
  )).join('')).join('');
  return `<span class="mk-rank r${place}" aria-label="${place} место">
    <svg viewBox="0 0 32 42" aria-hidden="true">
      <path fill="#7a1414" d="M5 0h9l3 16H12z"/>
      <path fill="#e23d3d" d="M7 0h7l3 16h-6z"/>
      <path fill="#7a1414" d="M18 0h9l-6 16h-6z"/>
      <path fill="#ff5a5a" d="M18 0h7l-5 16h-5z"/>
      <circle cx="16" cy="28" r="13.2" fill="${pal.rim}"/>
      <circle cx="16" cy="28" r="11.2" fill="${pal.mid}"/>
      <ellipse cx="13.2" cy="25.2" rx="6" ry="4.6" fill="${pal.hi}" opacity="0.42"/>
      <g transform="translate(13.5 24.5)" shape-rendering="crispEdges">${nums}</g>
    </svg>
  </span>`;
}

function mkCardHTML(p, featured, rank) {
  const h = escapeHtml((p.owner && p.owner.handle) || '');
  const n = p.count || 0;
  return `<article class="mk-card${featured ? ' is-top' : ''}" data-mk="${p.id}">
    <button type="button" class="mk-cover" data-mkopen="${p.id}">${mkCover(p)}</button>
    <div class="mk-body">
      <button type="button" class="mk-name" data-mkopen="${p.id}">${escapeHtml(p.name)}</button>
      <p>@${h} · ${n} ${n === 1 ? 'трек' : 'треков'}</p>
    </div>
    <button type="button" class="mk-like${p.liked ? ' on' : ''}" data-mklike="${p.id}" title="Нравится">
      ${ICO.heart}<b>${p.likes || 0}</b>
    </button>
    ${rank ? mkRankHTML(rank) : ''}
  </article>`;
}

function mkVoidHTML() {
  const cta = me
    ? `<button type="button" class="mbtn primary" data-mkup="1">Опубликовать</button>`
    : `<button type="button" class="mbtn primary" data-mkup="1">Войти</button>`;
  return `<div class="mk-void">
    <div class="mk-disc" aria-hidden="true"><i></i></div>
    <h3>Пока пусто</h3>
    <p>Опубликуй плейлист. Его увидят все на Muse.</p>
    ${cta}
  </div>`;
}

function bindMarket(v, data) {
  const openPl = (id) => {
    const p = [...(data.top || []), ...(data.listings || [])].find((x) => String(x.id) === String(id));
    if (!p || !p.owner) return;
    showView('shared', { handle: p.owner.handle, slug: p.slug, id: p.id });
  };
  v.querySelectorAll('[data-mkopen]').forEach((b) => {
    b.addEventListener('click', () => openPl(b.dataset.mkopen));
  });
  v.querySelectorAll('[data-mklike]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!me) { openAuth('signin'); return; }
      try {
        const j = await post('/api/market/like', { playlist_id: +b.dataset.mklike });
        b.classList.toggle('on', !!j.liked);
        const n = b.querySelector('b');
        if (n) n.textContent = j.likes || 0;
      } catch (err) { toast(err.message || 'Не вышло'); }
    });
  });
  v.querySelectorAll('[data-mkup]').forEach((b) => {
    b.addEventListener('click', () => openMarketUpload());
  });
}

async function renderMarket(v) {
  v.innerHTML = `<div class="mk"><div class="mk-void"><p>Загрузка</p></div></div>`;
  let data;
  try { data = await api('/api/market'); }
  catch { v.innerHTML = `<div class="mk"><div class="mk-void"><h3>Не загрузилось</h3><p>Попробуй ещё раз через секунду.</p></div></div>`; return; }
  const top = data.top || [];
  const rest = data.listings || [];
  const empty = !top.length && !rest.length;
  v.innerHTML = `<div class="mk">
    <div class="mk-head">
      <h2>Маркетплейс Плейлистов</h2>
      ${empty ? '' : (me
        ? `<button type="button" class="mbtn primary" data-mkup="1">Опубликовать</button>`
        : `<button type="button" class="mbtn primary" data-mkup="1">Войти</button>`)}
    </div>
    ${empty ? mkVoidHTML() : `
      ${top.length ? `<div class="mk-top">${top.map((p, i) => `
        <div class="mk-podium" data-rank="${i + 1}">${mkCardHTML(p, true, i + 1)}</div>`).join('')}</div>` : ''}
      <div class="mk-grid">${rest.map((p) => mkCardHTML(p, false)).join('')}</div>`}
  </div>`;
  bindMarket(v, data);
}

async function publishPicked(btn) {
  if (!btn || btn.dataset.busy === '1') return;
  const pid = +btn.dataset.pub;
  if (!pid) return;
  btn.dataset.busy = '1';
  btn.classList.add('busy');
  const box = document.getElementById('modalBox');
  let err = box && box.querySelector('.merr');
  if (box && !err) {
    err = document.createElement('div');
    err.className = 'merr';
    box.appendChild(err);
  }
  if (err) err.textContent = '';
  try {
    await post('/api/market', { playlist_id: pid });
    closeModal();
    if (currentView === 'market') await renderMarket($('view'));
  } catch (e) {
    btn.dataset.busy = '';
    btn.classList.remove('busy');
    if (err) err.textContent = e.message || 'Не вышло опубликовать';
  }
}

function bindModalMarket() {
  const box = document.getElementById('modalBox');
  if (!box || box.dataset.mkBound === '1') return;
  box.dataset.mkBound = '1';
  box.addEventListener('click', (e) => {
    const pub = e.target.closest('[data-pub]');
    if (!pub || !box.contains(pub)) return;
    e.preventDefault();
    e.stopPropagation();
    publishPicked(pub);
  });
}

async function openMarketUpload() {
  if (!me) { openAuth('signin'); return; }
  bindModalMarket();
  let pls = myPlaylists;
  try {
    const j = await api('/api/playlists');
    pls = j.playlists || pls;
    myPlaylists = pls;
  } catch {}
  const ready = (pls || []).filter((p) => !p.listed && Number(p.count || 0) > 0 && (!p.need || !p.need.length) && p.can_publish !== false);
  const blocked = (pls || []).filter((p) => !p.listed && Number(p.count || 0) > 0 && p.need && p.need.length);
  const listedN = (pls || []).filter((p) => p.listed).length;
  if (!ready.length) {
    let title = 'Нечего публиковать';
    let sub = 'Собери плейлист с треками. Потом он появится здесь.';
    if (blocked.length) {
      title = 'Пока нельзя';
      sub = 'Этот плейлист с маркетплейса. Смени название, обложку и состав: добавь песни и убери часть старых.';
    } else if (listedN && listedN === (pls || []).length) {
      title = 'Уже всё выложено';
      sub = 'Все твои плейлисты уже в маркетплейсе.';
    } else if ((pls || []).some((p) => Number(p.count || 0) === 0)) {
      title = 'Пустой плейлист';
      sub = 'Добавь треки, потом можно публиковать.';
    }
    openModal(`<div class="mk-void mk-modal-void">
      <div class="mk-disc" aria-hidden="true"><i></i></div>
      <h3>${title}</h3>
      <p>${sub}</p>
      <button type="button" class="mbtn primary" id="mkGoLib">К плейлистам</button>
    </div>
    ${blocked.length ? `<div class="mk-pick">${blocked.map((p) => `
      <div class="mk-pick-row lock">
        ${mkCover(p)}<span><b>${escapeHtml(p.name)}</b><i>Смени название, обложку и треки</i></span>
      </div>`).join('')}</div>` : ''}`);
    $('mkGoLib')?.addEventListener('click', () => {
      closeModal();
      openLibrary();
    });
    return;
  }
  openModal(`<h2>Опубликовать</h2>
    <p class="msub">Плейлист увидят все. Его можно лайкнуть и забрать в библиотеку.</p>
    <div class="mk-pick">${ready.map((p) => `
      <button type="button" class="mk-pick-row" data-pub="${p.id}">
        ${mkCover(p)}<span><b>${escapeHtml(p.name)}</b><i>${p.count || 0} ${Number(p.count) === 1 ? 'трек' : 'треков'}</i></span>
      </button>`).join('')}</div>
    <div class="merr"></div>`);
}

let chatPoll = null;
let chatGen = 0;
let chatAfter = 0;
let chatSince = 0;
let chatWith = '';
let chatBusy = false;
let chatAud = null;
let chatHistPushed = false;

function setChatOpen(on) {
  document.body.classList.toggle('chat-open', !!on);
  if (!on) {
    document.body.classList.remove('chat-kb');
    document.documentElement.style.setProperty('--chat-pad', '0px');
    chatHistPushed = false;
  }
  requestAnimationFrame(() => { try { trackChatKb(); } catch {} });
  try { tellWatch(); } catch {}
}

function chatMidSel(id) {
  const s = String(id);
  try { return `[data-mid="${CSS.escape(s)}"]`; } catch { return `[data-mid="${s.replace(/"/g, '')}"]`; }
}

function chatNearEnd(log) {
  if (!log) return true;
  return (log.scrollHeight - log.scrollTop - log.clientHeight) <= 80;
}

function pinChatLog(log) {
  if (!log) return;
  log.scrollTop = log.scrollHeight;
  log._pin = true;
  const jump = log.closest('.fr-chat')?.querySelector('#chatJump');
  if (jump) jump.hidden = true;
  if (log._pinObs || typeof ResizeObserver === 'undefined') return;
  log._pinObs = new ResizeObserver(() => {
    if (log._pin) log.scrollTop = log.scrollHeight;
  });
  log._pinObs.observe(log);
}

function syncChatJump(log) {
  if (!log) return;
  const pin = chatNearEnd(log);
  log._pin = pin;
  const jump = log.closest('.fr-chat')?.querySelector('#chatJump');
  if (jump) jump.hidden = pin;
}

function takeChatRow(log, id) {
  if (!log || id == null) return;
  const sid = String(id);
  log._seen?.delete(sid);
  log._by?.delete(sid);
  try { log.querySelector(chatMidSel(sid))?.remove(); } catch {}
}

function stealPending(log, m) {
  if (!log || !m || !m.mine || m.pending) return;
  const by = log._by;
  if (!by) return;
  for (const [id, p] of by) {
    if (!p.pending || p.kind !== m.kind) continue;
    if ((p.body || '') !== (m.body || '')) continue;
    takeChatRow(log, id);
    return;
  }
}

function snapIosChat() {
  if (!isIOS || !document.body.classList.contains('chat-open')) return;
  if (document.body.classList.contains('chat-kb')) return;
  try {
    const y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const top = window.visualViewport ? window.visualViewport.offsetTop : 0;
    if (y > 0 || top > 1) window.scrollTo(0, 0);
  } catch {}
}

function fitChatKb() {
  if (!document.body.classList.contains('chat-open')) {
    document.documentElement.style.setProperty('--chat-pad', '0px');
    document.body.classList.remove('chat-kb');
    return;
  }
  const vv = window.visualViewport;
  let kb = 0;
  if (vv) kb = Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
  if (kb < 80) kb = 0;
  document.body.classList.toggle('chat-kb', kb > 0);
  const pl = document.querySelector('#player');
  const playerH = (!kb && pl && !pl.hidden) ? Math.round(pl.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty('--chat-pad', `${kb || playerH || 0}px`);
  if (!kb) snapIosChat();
}

let chatKbRaf = 0;
function trackChatKb() {
  if (chatKbRaf) return;
  let last = '';
  let stable = 0;
  const tick = () => {
    chatKbRaf = 0;
    fitChatKb();
    const pad = document.documentElement.style.getPropertyValue('--chat-pad');
    const log = document.getElementById('chatLog');
    if (pad !== last) {
      last = pad;
      stable = 0;
      if (log && log._pin) pinChatLog(log);
    } else stable += 1;
    if (stable < 10 && document.body.classList.contains('chat-open')) {
      chatKbRaf = requestAnimationFrame(tick);
    }
  };
  chatKbRaf = requestAnimationFrame(tick);
}

function chatSheetOn(el) {
  return !!(el && el.classList && el.classList.contains('is-on'));
}

function chatSheetsOpen() {
  return ['chatAttach', 'chatEmo', 'chatAct'].some((id) => chatSheetOn(document.getElementById(id)));
}

function setChatSheet(el, on) {
  if (!el) return;
  el.classList.toggle('is-on', !!on);
  if (el.id === 'chatAttach') document.getElementById('chatPlus')?.classList.toggle('is-on', !!on);
}

function hideChatSheets() {
  ['chatAttach', 'chatEmo', 'chatAct'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) setChatSheet(el, false);
  });
}

function chatDismissOverlays() {
  if (mediaViewOpen()) { closeMediaView(); return true; }
  iosLiveSession(false);
  const round = document.getElementById('chatRound');
  if (round && !round.hidden) {
    try {
      round.querySelectorAll('video').forEach((v) => {
        try { v.srcObject?.getTracks?.().forEach((t) => t.stop()); } catch {}
        v.srcObject = null;
      });
    } catch {}
    round.innerHTML = '';
    round.hidden = true;
    return true;
  }
  const rec = document.getElementById('chatRec');
  if (rec && !rec.hidden) {
    document.getElementById('chatRecX')?.click();
    return true;
  }
  if (chatSheetsOpen()) {
    hideChatSheets();
    return true;
  }
  return false;
}

function closeChatToList() {
  const v = document.getElementById('view');
  const pane = v?.querySelector('.fr-chat');
  const list = v?.querySelector('.fr-list');
  stopChatPoll();
  if (pane) paintFriendsIdle(pane);
  if (list) { list.hidden = false; list.classList.remove('is-away'); }
}

function growChatInp(el) {
  if (!el || el === __nullEl || !el.style) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 24), 120)}px`;
}

function stopChatPoll() {
  chatGen += 1;
  if (chatPoll) { clearInterval(chatPoll); chatPoll = null; }
  chatAfter = 0;
  chatSince = 0;
  chatWith = '';
  chatBusy = false;
  window.__musePullChat = null;
  try { chatAud?.pause(); } catch {}
  setChatOpen(false);
  try { tellWatch(); } catch {}
}

const CHAT_REACTS = ['❤️', '🔥', '👍', '😂', '😮', '😢', '🎉'];
const CHAT_KIND_LABEL = {
  song: 'Трек', playlist: 'Плейлист', profile: 'Профиль', voice: 'Голосовое',
  audio: 'Аудио', video: 'Видео', round: 'Кружок', gif: 'GIF', image: 'Фото', text: '',
};
/* Telegram Desktop round_video_recorder.cpp:
   kMaxDuration=60s, kMinDuration=200ms, kVideoBitRate=2Mbps, kAudioBitRate=64kbps, kUpdateEach=100ms.
   Web: record the camera track (hardware), not a 400px canvas — that was the lag. */
const ROUND_MAX_MS = 60_000;
const ROUND_MIN_MS = 200;
const ROUND_V_BPS = 1_200_000;
const ROUND_A_BPS = 64_000;
const ROUND_RING_R = 16.5;
const ROUND_RING_C = 2 * Math.PI * ROUND_RING_R;

function iosLiveSession(on) {
  iosCapture = !!on;
  try {
    if (!isIOS || !navigator.audioSession) return;
    navigator.audioSession.type = on ? 'play-and-record' : 'playback';
  } catch {}
}

function gumRaw(constraints) {
  const md = navigator.mediaDevices;
  if (md && typeof md.getUserMedia === 'function') return md.getUserMedia(constraints);
  const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  if (!legacy) {
    const e = new Error('nogum');
    e.name = 'NotFoundError';
    return Promise.reject(e);
  }
  return new Promise((res, rej) => legacy.call(navigator, constraints, res, rej));
}

function liveErr(e, what) {
  const n = `${(e && e.name) || ''} ${(e && e.message) || ''}`;
  if (/NotAllowed|Permission|Security/i.test(n)) {
    return isIOS
      ? (what === 'mic'
        ? 'Разреши микрофон: Настройки → Safari'
        : 'Разреши камеру: Настройки → Safari')
      : (what === 'mic' ? 'Нет доступа к микрофону' : 'Нет доступа к камере');
  }
  if (/NotFound|DevicesNotFound|nogum/i.test(n)) {
    return what === 'mic' ? 'Нет микрофона' : 'Нет камеры';
  }
  if (/NotReadable|TrackStart|InUse/i.test(n)) return 'Камера занята';
  return what === 'mic' ? 'Нет доступа к микрофону' : 'Нет доступа к камере';
}

async function askLive(want) {
  iosLiveSession(true);
  const video = !!want.video;
  const audio = !!want.audio;
  if (isIOS && video && audio) {
    let vs = null;
    let as = null;
    try { vs = await gumRaw({ video: { facingMode: 'user' } }); }
    catch {
      vs = await gumRaw({ video: true });
    }
    try { as = await gumRaw({ audio: true }); } catch {}
    const tracks = [];
    vs?.getVideoTracks().forEach((t) => tracks.push(t));
    as?.getAudioTracks().forEach((t) => tracks.push(t));
    vs?.getAudioTracks().forEach((t) => {
      if (!tracks.some((x) => x.id === t.id)) tracks.push(t);
    });
    if (!tracks.some((t) => t.kind === 'video')) {
      try { vs?.getTracks().forEach((t) => t.stop()); } catch {}
      try { as?.getTracks().forEach((t) => t.stop()); } catch {}
      const e = new Error('novideo');
      e.name = 'NotFoundError';
      throw e;
    }
    return new MediaStream(tracks);
  }
  const tries = [];
  if (video && audio) {
    tries.push({ video: { facingMode: 'user' }, audio: true });
    tries.push({ video: true, audio: true });
  } else if (video) {
    tries.push({ video: { facingMode: 'user' } }, { video: true });
  } else {
    tries.push({ audio: true });
  }
  let last = null;
  for (const c of tries) {
    try { return await gumRaw(c); } catch (e) { last = e; }
  }
  throw last || Object.assign(new Error('nogum'), { name: 'NotFoundError' });
}

function chatNameKind(file) {
  const t = (file.type || '').toLowerCase();
  const n = (file.name || '').toLowerCase();
  if (t.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv|avi|3gp)$/i.test(n)) return 'video';
  if (t.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(n)) return 'image';
  if (/\.(mp3|wav|ogg|flac|opus|m4a|aac)$/i.test(n)) return 'audio';
  if (t.startsWith('audio/') && /(mp4|mpeg)/.test(t)) return 'probe';
  if (t.startsWith('audio/')) return 'audio';
  if (!t) return 'probe';
  return 'image';
}

function probeVideoFile(file) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    try { v.playsInline = true; } catch {}
    v.setAttribute('playsinline', '');
    const done = (info) => {
      clearTimeout(to);
      try { URL.revokeObjectURL(url); } catch {}
      res(info);
    };
    const to = setTimeout(() => done({ duration: 0, video: false }), 2800);
    v.onloadedmetadata = () => done({
      duration: (Number.isFinite(v.duration) && v.duration > 0) ? v.duration : 0,
      video: (v.videoWidth || 0) > 4 && (v.videoHeight || 0) > 4,
    });
    v.onerror = () => done({ duration: 0, video: false });
    v.src = url;
  });
}

function roundRingSVG(cls) {
  const c = ROUND_RING_C.toFixed(2);
  return `<svg class="${cls}" viewBox="0 0 36 36" aria-hidden="true">
    <circle class="rd-ring-track" cx="18" cy="18" r="${ROUND_RING_R}" fill="none"/>
    <circle class="rd-ring-fg" cx="18" cy="18" r="${ROUND_RING_R}" fill="none"
      stroke-dasharray="${c}" stroke-dashoffset="${c}"/>
  </svg>`;
}

function setRoundRing(root, p) {
  const fg = root?.querySelector?.('.rd-ring-fg');
  if (!fg) return;
  const t = Math.max(0, Math.min(1, Number(p) || 0));
  fg.style.strokeDashoffset = String(ROUND_RING_C * (1 - t));
}

function emojiOnly(s) {
  const t = String(s || '').trim();
  if (!t || t.length > 24) return false;
  try { return /^[\p{Extended_Pictographic}\s]+$/u.test(t); } catch { return false; }
}

function chatFileSrc(p) {
  let u = '';
  if (p && p.url) u = p.url;
  else if (p && p.file) u = `/api/chat/file/${encodeURIComponent(p.file)}`;
  if (!u) return '';
  return u.includes('?') ? `${u}&m=260` : `${u}?m=260`;
}

const VOICE_N = 28;
const VOICE_ICO = {
  play: '<svg class="ic-play" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" aria-hidden="true"><path d="M187.2 100.9C174.8 94.1 159.8 94.4 147.6 101.6C135.4 108.8 128 121.9 128 136L128 504C128 518.1 135.5 531.2 147.6 538.4C159.7 545.6 174.8 545.9 187.2 539.1L523.2 355.1C536 348.1 544 334.6 544 320C544 305.4 536 291.9 523.2 284.9L187.2 100.9z"/></svg>',
  pause: '<svg class="ic-pause" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512" fill="currentColor" aria-hidden="true"><path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"/></svg>',
};
function voiceWaveHTML(cls = '') {
  let s = '';
  for (let i = 0; i < VOICE_N; i += 1) s += `<i style="--i:${i}"></i>`;
  return `<span class="wave${cls ? ` ${cls}` : ''}" style="--n:${VOICE_N}">${s}</span>`;
}

function startVoiceMeter(stream, root) {
  const bars = root?.querySelectorAll?.('i');
  if (!bars || !bars.length) return () => {};
  let ac;
  let an;
  let raf = 0;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    an = ac.createAnalyser();
    an.fftSize = 128;
    an.smoothingTimeConstant = 0.82;
    src.connect(an);
    try { ac.resume(); } catch {}
  } catch { return () => {}; }
  const data = new Uint8Array(an.frequencyBinCount);
  const tick = () => {
    raf = requestAnimationFrame(tick);
    an.getByteFrequencyData(data);
    const n = bars.length;
    for (let i = 0; i < n; i += 1) {
      const v = (data[Math.min(data.length - 1, Math.floor(i * data.length / n))] || 0) / 255;
      const next = 4 + v * 22;
      const prev = parseFloat(bars[i].style.height) || 8;
      bars[i].style.height = `${prev + (next - prev) * 0.28}px`;
      bars[i].style.opacity = String(0.28 + v * 0.72);
    }
  };
  raf = requestAnimationFrame(tick);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    try { ac.close(); } catch {}
  };
}

function paintVoiceBars(btn, p, live) {
  const wave = btn?.querySelector?.('.wave');
  const bars = wave?.querySelectorAll?.('i');
  if (!bars || !bars.length) return;
  const t = Math.max(0, Math.min(1, Number(p) || 0));
  wave.style.setProperty('--p', t.toFixed(4));
  const n = bars.length;
  const head = t * n;
  bars.forEach((b, i) => {
    const fill = Math.max(0, Math.min(1, head - i + 0.22));
    if (t <= 0) {
      b.style.opacity = '';
      b.classList.remove('now');
      return;
    }
    b.style.opacity = String(0.26 + fill * 0.74);
    b.classList.toggle('now', !!(live && Math.abs(i + 0.5 - head) < 0.72 && t < 0.995));
  });
}

async function fillVoicePeaks(btn, src) {
  if (!btn || !src || btn._peaks) return;
  // Decoding into an AudioContext ducks or muffles the song, and opening a
  // chat full of voice notes used to hitch playback. Bars stay decorative.
  if (isIOS || (audio && audio.src && !audio.paused)) {
    btn._peaks = true;
    return;
  }
  btn._peaks = true;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await fetch(src, { credentials: 'same-origin' }).then((r) => r.arrayBuffer());
    const decoded = await ac.decodeAudioData(buf.slice(0));
    const ch = decoded.getChannelData(0);
    const n = VOICE_N;
    const step = Math.max(1, Math.floor(ch.length / n));
    const bars = btn.querySelectorAll('.wave i');
    for (let i = 0; i < n && i < bars.length; i += 1) {
      let m = 0;
      const s = i * step;
      for (let j = 0; j < step; j += 12) m = Math.max(m, Math.abs(ch[s + j] || 0));
      bars[i].style.height = `${4 + Math.round(Math.min(1, m * 2.4) * 14)}px`;
    }
    try { ac.close(); } catch {}
  } catch { /* keep placeholder bars */ }
}

function chatDur(s) {
  let n = Number(s);
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > 1000) n = n / 1000;
  return fmt(n) || '0:00';
}

function chatTicks(m) {
  if (!m.mine || m.deleted || m.kind === 'deleted') return '';
  if (m.failed) {
    return `<button type="button" class="chat-retry" data-retry="${escapeHtml(String(m.id))}" aria-label="Повторить">!</button>`;
  }
  if (m.pending) {
    return `<span class="chat-ticks pending" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/></svg></span>`;
  }
  return `<span class="chat-ticks${m.read ? ' read' : ''}">${m.read
    ? '<svg viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 7.2l2.6 2.6 6.2-7"/><path d="M7 8.2l2.2 2.2 7-8"/></svg>'
    : '<svg viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 7.2l2.6 2.6 6.2-7"/></svg>'}</span>`;
}

function chatQuoteHTML(r) {
  if (!r) return '';
  if (r.deleted) return `<div class="chat-quote">Сообщение удалено</div>`;
  const t = (r.body || CHAT_KIND_LABEL[r.kind] || '').trim() || 'Сообщение';
  return `<div class="chat-quote" data-jump="${r.id}">${escapeHtml(t)}</div>`;
}

function chatCardHTML(m, side) {
  const p = m.payload || {};
  if (m.kind === 'song') {
    return `<button type="button" class="chat-card song ${side}" data-chsong="${escapeHtml(p.id || '')}"
      data-title="${escapeHtml(p.title || '')}" data-thumb="${escapeHtml(p.thumbnail || '')}">
      <img src="${escapeHtml(ytThumb(p.id, p.thumbnail))}" alt="" />
      <span><b>${escapeHtml(p.title || 'Song')}</b><i>Нажми, чтобы слушать</i></span>
    </button>`;
  }
  if (m.kind === 'playlist') {
    const cover = p.cover || '';
    return `<button type="button" class="chat-card pl ${side}" data-chpl="${escapeHtml(p.handle || '')}" data-slug="${escapeHtml(p.slug || '')}" data-pid="${p.id || 0}">
      ${cover ? `<img src="${escapeHtml(cover)}" alt="" />` : `<span class="ph">${escapeHtml(((p.name || '#')[0] || '#').toUpperCase())}</span>`}
      <span><b>${escapeHtml(p.name || 'Playlist')}</b><i>@${escapeHtml(p.handle || '')} · ${p.count || 0} tracks</i></span>
    </button>`;
  }
  if (m.kind === 'profile') {
    const hidden = !!p.hidden;
    const who = hidden ? { handle: p.handle, hue: p.hue } : p;
    return `<button type="button" class="chat-card prof ${side}" data-chprof="${escapeHtml(p.handle || '')}">
      ${personAv(who)}<span><b>${hidden ? 'Профиль скрыт' : escapeHtml(p.display || p.handle || 'Muse')}</b><i>@${escapeHtml(p.handle || '')}</i></span>
    </button>`;
  }
  const src = chatFileSrc(p);
  if (m.kind === 'image' || m.kind === 'gif') {
    return `<button type="button" class="chat-media" data-mv="image" data-src="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="" /></button>`;
  }
  if (m.kind === 'video') {
    return `<button type="button" class="chat-media vid" data-mv="video" data-src="${escapeHtml(src)}"><video src="${escapeHtml(src)}" playsinline webkit-playsinline preload="metadata" muted disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback"></video><span class="rd-play">${ICO.play}</span></button>`;
  }
  if (m.kind === 'round') {
    const d = chatDur(p.duration || 0);
    return `<div class="chat-round" data-round="${escapeHtml(src)}" data-dur="${p.duration || 0}" role="button" tabindex="0">
      <video src="${escapeHtml(src)}" playsinline webkit-playsinline preload="metadata" muted disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback"></video>
      ${roundRingSVG('rd-ring')}
      <span class="rd-play">${ICO.play}</span>
      <span class="rd-dur">${d}</span>
    </div>`;
  }
  if (m.kind === 'voice' || m.kind === 'audio') {
    const d = chatDur(p.duration || 0);
    return `<button type="button" class="chat-voice" data-voice="${escapeHtml(src)}" data-dur="${p.duration || 0}">
      <span class="vp">${VOICE_ICO.play}</span>
      <span class="voice-body">${voiceWaveHTML()}<span class="vd">${d}</span></span>
    </button>`;
  }
  return `<div class="chat-bubble ${side}">${escapeHtml(m.body || '')}</div>`;
}

function chatRowHTML(m, fresh) {
  const side = m.mine ? 'me' : 'them';
  const mid = m.id != null ? ` data-mid="${escapeHtml(String(m.id))}"` : '';
  const cls = `chat-row ${side}${fresh ? ' fresh' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}`;
  if (m.deleted || m.kind === 'deleted') {
    return `<div class="${cls}"${mid} data-kind="deleted"><div class="chat-bubble ${side} gone">Сообщение удалено</div></div>`;
  }
  const quote = chatQuoteHTML(m.reply);
  const cap = (m.body && m.kind !== 'text') ? `<div class="chat-cap">${escapeHtml(m.body)}</div>` : '';
  const meta = `<div class="chat-meta">${m.edited ? '<span>изм.</span>' : ''}${chatTicks(m)}</div>`;
  let inner = '';
  if (m.kind === 'text') {
    const big = emojiOnly(m.body);
    inner = `<div class="chat-bubble ${side}${big ? ' bigemo' : ''}">${escapeHtml(m.body || '')}</div>`;
  } else {
    inner = chatCardHTML(m, side);
  }
  const rx = chatReactsHTML(m);
  return `<div class="${cls}${rx ? ' has-rx' : ''}"${mid} data-kind="${escapeHtml(m.kind || 'text')}">${quote}${inner}${cap}${rx}${meta}</div>`;
}

function chatReactsHTML(m) {
  const rs = m.reacts || [];
  if (!rs.length) return '';
  return `<div class="chat-rxs">${rs.map((r) => {
    const e = String(r.e || '');
    if (!CHAT_REACTS.includes(e)) return '';
    const n = +r.n || 1;
    return `<button type="button" class="chat-rx${r.mine ? ' on' : ''}" data-rx="${escapeHtml(e)}">${e}${n > 1 ? `<b>${n}</b>` : ''}</button>`;
  }).join('')}</div>`;
}

function patchChatReacts(node, m) {
  if (!node) return;
  const html = chatReactsHTML(m);
  const cur = node.querySelector('.chat-rxs');
  node.classList.toggle('has-rx', !!html);
  if (!html) { cur?.remove(); return; }
  const box = document.createElement('div');
  box.innerHTML = html;
  const next = box.firstElementChild;
  if (!next) return;
  if (cur) cur.replaceWith(next);
  else {
    const meta = node.querySelector('.chat-meta');
    if (meta) meta.insertAdjacentElement('beforebegin', next);
    else node.appendChild(next);
  }
  const log = node.closest('.chat-log');
  next.querySelectorAll('.chat-rx').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      log?._react?.(node.dataset.mid, b.dataset.rx);
    });
  });
}

function applyReactLocal(m, emoji) {
  if (!CHAT_REACTS.includes(emoji)) return m;
  const reacts = (m.reacts || []).map((r) => ({ ...r }));
  const mine = reacts.find((r) => r.mine);
  if (mine && mine.e === emoji) {
    mine.n -= 1;
    mine.mine = false;
  } else {
    if (mine) {
      mine.n -= 1;
      mine.mine = false;
    }
    let hit = reacts.find((r) => r.e === emoji);
    if (!hit) {
      hit = { e: emoji, n: 0, mine: false };
      reacts.push(hit);
    }
    hit.n += 1;
    hit.mine = true;
  }
  return { ...m, reacts: reacts.filter((r) => r.n > 0) };
}

function bindChatMedia(root) {
  const all = (sel) => {
    const hit = [];
    if (root.matches && root.matches(sel)) hit.push(root);
    root.querySelectorAll?.(sel)?.forEach((n) => hit.push(n));
    return hit;
  };
  all('[data-chsong]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.chsong;
      if (!id) return;
      const t = { id, title: b.dataset.title || 'Song', thumbnail: b.dataset.thumb || '' };
      playId(id, t, [t], 'search');
    });
  });
  all('[data-chpl]').forEach((b) => {
    b.addEventListener('click', () => {
      showView('shared', { handle: b.dataset.chpl, slug: b.dataset.slug, id: +b.dataset.pid || undefined });
    });
  });
  all('[data-chprof]').forEach((b) => {
    b.addEventListener('click', () => showView('user', b.dataset.chprof));
  });
  all('[data-voice]').forEach((b) => {
    b.addEventListener('click', (e) => { e.stopPropagation(); playChatVoice(b); });
    fillVoicePeaks(b, b.dataset.voice);
  });
  all('[data-round]').forEach((b) => {
    b.addEventListener('click', (e) => { e.stopPropagation(); playChatRound(b); });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playChatRound(b); }
    });
    const v = b.querySelector('video');
    const d = b.querySelector('.rd-dur');
    if (!v) return;
    const paint = () => {
      const dur = (v.duration && isFinite(v.duration) && v.duration > 0)
        ? v.duration
        : (+b.dataset.dur || 0);
      const t = v.currentTime || 0;
      if (dur > 0) {
        setRoundRing(b, t / dur);
        if (d) d.textContent = chatDur(Math.max(0, dur - t));
      }
    };
    v.addEventListener('loadedmetadata', () => {
      if (v.videoWidth && v.videoHeight && Math.abs(v.videoWidth - v.videoHeight) > 8) {
        b.classList.add('rd-flip');
      }
      paint();
    });
    v.addEventListener('ended', () => {
      b.classList.remove('playing');
      setRoundRing(b, 0);
      if (d) d.textContent = chatDur(v.duration || +b.dataset.dur || 0);
    });
  });
  all('.chat-media').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = el.dataset.src || el.querySelector('img, video')?.currentSrc || el.querySelector('img, video')?.src || '';
      if (!src) return;
      openMediaView(el.dataset.mv === 'video' ? 'video' : 'image', src);
    });
  });
  all('.chat-rx').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = b.closest('.chat-row');
      const log = b.closest('.chat-log');
      log?._react?.(row?.dataset.mid, b.dataset.rx);
    });
  });
  all('[data-jump]').forEach((q) => {
    q.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = q.closest('.fr-chat')?.querySelector(chatMidSel(q.dataset.jump));
      if (!t) return;
      t.scrollIntoView({ behavior: 'smooth', block: 'center' });
      t.classList.add('fresh');
    });
  });
}

const mvState = {
  open: false, kind: '', scale: 1, x: 0, y: 0,
  video: null, hideT: 0, raf: 0, skipT: 0, tapT: 0, scrub: false, bound: false,
  pointers: new Map(), pinch0: 0, scale0: 1, panX: 0, panY: 0,
  lastTap: 0, startX: 0, startY: 0, pinched: false,
};

function mediaViewOpen() {
  const el = $('mediaView');
  return !!(el && el !== __nullEl && !el.hidden);
}

function closeMediaView() {
  const root = $('mediaView');
  if (!root || root === __nullEl) return;
  const v = root.querySelector('#mvVid');
  if (v) {
    try { v.pause(); } catch {}
    try { v.removeAttribute('src'); v.load(); } catch {}
  }
  if (mvState.raf) { cancelAnimationFrame(mvState.raf); mvState.raf = 0; }
  clearTimeout(mvState.hideT);
  clearTimeout(mvState.skipT);
  clearTimeout(mvState.tapT);
  root.hidden = true;
  root.className = 'mv';
  const stage = $('mvStage');
  if (stage && stage !== __nullEl) stage.innerHTML = '';
  const hud = $('mvHud');
  if (hud && hud !== __nullEl) hud.hidden = true;
  const skip = $('mvSkip');
  if (skip && skip !== __nullEl) skip.classList.remove('on');
  document.body.classList.remove('mv-open');
  mvState.open = false;
  mvState.video = null;
  mvState.kind = '';
  mvState.scale = 1;
  mvState.x = 0;
  mvState.y = 0;
  mvState.pointers.clear();
}

function openMediaView(kind, src) {
  const root = $('mediaView');
  const stage = $('mvStage');
  if (!root || root === __nullEl || !stage || stage === __nullEl || !src) return;
  closeMediaView();
  mvState.open = true;
  mvState.kind = kind;
  mvState.scale = 1;
  mvState.x = 0;
  mvState.y = 0;
  root.hidden = false;
  document.body.classList.add('mv-open');
  // A photo is not another player. Pausing here killed the song on iOS.
  if (kind === 'video') {
    try { if (audio && !audio.paused) doPause(); } catch {}
  }
  try { chatAud?.pause(); } catch {}
  document.querySelectorAll('.chat-voice.on').forEach((x) => {
    x.classList.remove('on');
    const vp = x.querySelector('.vp');
    if (vp) vp.innerHTML = VOICE_ICO.play;
  });
  document.querySelectorAll('.chat-round.playing').forEach((x) => {
    x.classList.remove('playing');
    try { x.querySelector('video')?.pause(); } catch {}
  });
  if (kind === 'video') paintMvVideo(src);
  else paintMvImage(src);
}

function mvApply() {
  const img = document.getElementById('mvImg');
  if (!img) return;
  img.style.transform = `translate(${mvState.x}px, ${mvState.y}px) scale(${mvState.scale})`;
}

function mvClamp() {
  if (mvState.scale <= 1.02) {
    mvState.scale = 1;
    mvState.x = 0;
    mvState.y = 0;
    return;
  }
  const max = (mvState.scale - 1) * 340;
  mvState.x = Math.max(-max, Math.min(max, mvState.x));
  mvState.y = Math.max(-max, Math.min(max, mvState.y));
}

function mvZoomAt(cx, cy, next) {
  if (mvState.kind !== 'image') return;
  const stage = $('mvStage');
  if (!stage || stage === __nullEl) return;
  next = Math.min(6, Math.max(1, next));
  const box = stage.getBoundingClientRect();
  const px = cx - box.left - box.width / 2;
  const py = cy - box.top - box.height / 2;
  const s = mvState.scale || 1;
  mvState.x = px - ((px - mvState.x) / s) * next;
  mvState.y = py - ((py - mvState.y) / s) * next;
  mvState.scale = next;
  mvClamp();
  mvApply();
}

function paintMvImage(src) {
  const root = $('mediaView');
  const stage = $('mvStage');
  root.classList.add('is-img');
  root.classList.remove('is-vid', 'is-playing', 'is-hud');
  const hud = $('mvHud');
  if (hud && hud !== __nullEl) hud.hidden = true;
  stage.innerHTML = `<img id="mvImg" src="${escapeHtml(src)}" alt="" draggable="false" />`;
  mvApply();
}

function mvPaintVid() {
  const video = mvState.video;
  if (!video) return;
  const dur = (video.duration && isFinite(video.duration) && video.duration > 0) ? video.duration : 0;
  const t = video.currentTime || 0;
  const p = dur ? t / dur : 0;
  const fill = document.getElementById('mvFill');
  const knob = document.getElementById('mvKnob');
  const time = document.getElementById('mvTime');
  if (fill) fill.style.width = `${p * 100}%`;
  if (knob) knob.style.left = `${p * 100}%`;
  if (time) time.textContent = dur ? `${fmt(t)} / ${fmt(dur)}` : fmt(t);
}

function mvArmHud() {
  const root = $('mediaView');
  if (!root || root === __nullEl) return;
  root.classList.add('is-hud');
  clearTimeout(mvState.hideT);
  const video = mvState.video;
  mvState.hideT = setTimeout(() => {
    if (video && !video.paused && !mvState.scrub) root.classList.remove('is-hud');
  }, 2400);
}

function mvSetPlaying(on) {
  const root = $('mediaView');
  if (!root || root === __nullEl) return;
  root.classList.toggle('is-playing', !!on);
  const ic = on ? VOICE_ICO.pause : VOICE_ICO.play;
  const go = document.getElementById('mvGo');
  const play = document.getElementById('mvPlay');
  if (go) { go.innerHTML = ic; go.setAttribute('aria-label', on ? 'Пауза' : 'Play'); }
  if (play) { play.innerHTML = ic; play.setAttribute('aria-label', on ? 'Пауза' : 'Play'); }
  if (on) mvArmHud();
  else {
    clearTimeout(mvState.hideT);
    root.classList.add('is-hud');
  }
}

function mvToggleVideo() {
  const video = mvState.video;
  if (!video) return;
  if (video.paused) video.play().then(() => mvSetPlaying(true)).catch(() => mvSetPlaying(false));
  else { video.pause(); mvSetPlaying(false); }
}

function mvSkip(sec) {
  const v = mvState.video;
  if (!v) return;
  const dur = (v.duration && isFinite(v.duration)) ? v.duration : 0;
  const next = (v.currentTime || 0) + sec;
  v.currentTime = Math.max(0, dur ? Math.min(dur, next) : Math.max(0, next));
  mvPaintVid();
  const flash = $('mvSkip');
  if (flash && flash !== __nullEl) {
    flash.textContent = sec > 0 ? `+${sec}` : `${sec}`;
    flash.classList.add('on');
    clearTimeout(mvState.skipT);
    mvState.skipT = setTimeout(() => flash.classList.remove('on'), 560);
  }
  if (!v.paused) mvArmHud();
}

function paintMvVideo(src) {
  const root = $('mediaView');
  const stage = $('mvStage');
  const hud = $('mvHud');
  root.classList.add('is-vid', 'is-hud');
  root.classList.remove('is-img');
  try { iosLiveSession(false); } catch {}
  stage.innerHTML = `<video id="mvVid" src="${escapeHtml(src)}" playsinline webkit-playsinline preload="auto" disablepictureinpicture></video>
    <button type="button" class="mv-go" id="mvGo" aria-label="Play">${VOICE_ICO.play}</button>`;
  if (hud && hud !== __nullEl) hud.hidden = false;
  const video = document.getElementById('mvVid');
  mvState.video = video;
  const mute = document.getElementById('mvMute');
  if (mute) { mute.innerHTML = ICO.vol; video.muted = false; }
  const tick = () => {
    mvPaintVid();
    if (video && !video.paused) mvState.raf = requestAnimationFrame(tick);
    else mvState.raf = 0;
  };
  video.addEventListener('loadedmetadata', mvPaintVid);
  video.addEventListener('play', () => {
    mvSetPlaying(true);
    if (mvState.raf) cancelAnimationFrame(mvState.raf);
    mvState.raf = requestAnimationFrame(tick);
  });
  video.addEventListener('pause', () => mvSetPlaying(false));
  video.addEventListener('ended', () => { mvSetPlaying(false); mvPaintVid(); });
  document.getElementById('mvGo')?.addEventListener('click', (e) => { e.stopPropagation(); mvToggleVideo(); });
  mvPaintVid();
  video.play().then(() => mvSetPlaying(true)).catch(() => mvSetPlaying(false));
}

function bindMediaView() {
  if (mvState.bound) return;
  mvState.bound = true;
  const root = $('mediaView');
  const stage = $('mvStage');
  if (!root || root === __nullEl || !stage || stage === __nullEl) return;
  const x = document.getElementById('mvX');
  if (x) x.innerHTML = ICO.x;
  const play = document.getElementById('mvPlay');
  if (play) play.innerHTML = VOICE_ICO.play;
  const mute = document.getElementById('mvMute');
  if (mute) mute.innerHTML = ICO.vol;
  x?.addEventListener('click', (e) => { e.stopPropagation(); closeMediaView(); });
  $('mvZin')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = stage.getBoundingClientRect();
    mvZoomAt(b.left + b.width / 2, b.top + b.height / 2, mvState.scale * 1.5);
  });
  $('mvZout')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = stage.getBoundingClientRect();
    mvZoomAt(b.left + b.width / 2, b.top + b.height / 2, mvState.scale / 1.5);
  });
  play?.addEventListener('click', (e) => { e.stopPropagation(); mvToggleVideo(); });
  mute?.addEventListener('click', (e) => {
    e.stopPropagation();
    const v = mvState.video;
    if (!v) return;
    v.muted = !v.muted;
    mute.innerHTML = v.muted ? ICO.mute : ICO.vol;
  });
  const line = document.getElementById('mvLine');
  const seek = (ev) => {
    const v = mvState.video;
    if (!v || !line) return;
    const r = line.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, r.width ? (ev.clientX - r.left) / r.width : 0));
    if (v.duration && isFinite(v.duration)) v.currentTime = p * v.duration;
    mvPaintVid();
  };
  line?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    mvState.scrub = true;
    clearTimeout(mvState.hideT);
    root.classList.add('is-hud');
    try { line.setPointerCapture(e.pointerId); } catch {}
    seek(e);
  });
  line?.addEventListener('pointermove', (e) => { if (mvState.scrub) seek(e); });
  const endScrub = () => {
    if (!mvState.scrub) return;
    mvState.scrub = false;
    if (mvState.video && !mvState.video.paused) mvArmHud();
  };
  line?.addEventListener('pointerup', endScrub);
  line?.addEventListener('pointercancel', endScrub);

  stage.addEventListener('wheel', (e) => {
    if (!mvState.open || mvState.kind !== 'image') return;
    e.preventDefault();
    mvZoomAt(e.clientX, e.clientY, mvState.scale * (e.deltaY < 0 ? 1.14 : 1 / 1.14));
  }, { passive: false });

  const dist = () => {
    const pts = [...mvState.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  stage.addEventListener('pointerdown', (e) => {
    if (!mvState.open) return;
    if (e.target.closest?.('#mvGo, .mv-hud, .mv-x, .mv-zoom')) return;
    try { stage.setPointerCapture(e.pointerId); } catch {}
    mvState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mvState.pointers.size === 1) {
      mvState.panX = e.clientX - mvState.x;
      mvState.panY = e.clientY - mvState.y;
      mvState.startX = e.clientX;
      mvState.startY = e.clientY;
      mvState.pinched = false;
    } else if (mvState.pointers.size === 2) {
      mvState.pinch0 = dist();
      mvState.scale0 = mvState.scale;
      mvState.pinched = true;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!mvState.pointers.has(e.pointerId)) return;
    mvState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mvState.kind !== 'image') return;
    if (mvState.pointers.size === 2 && mvState.pinch0) {
      const pts = [...mvState.pointers.values()];
      const d = dist();
      mvZoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, mvState.scale0 * (d / mvState.pinch0));
      return;
    }
    if (mvState.pointers.size === 1 && mvState.scale > 1.02) {
      mvState.x = e.clientX - mvState.panX;
      mvState.y = e.clientY - mvState.panY;
      mvClamp();
      mvApply();
    }
  });
  const up = (e) => {
    if (!mvState.pointers.has(e.pointerId)) return;
    mvState.pointers.delete(e.pointerId);
    if (mvState.pointers.size < 2) mvState.pinch0 = 0;
    if (mvState.pointers.size === 1) {
      const p = [...mvState.pointers.values()][0];
      mvState.panX = p.x - mvState.x;
      mvState.panY = p.y - mvState.y;
    }
    if (mvState.pointers.size) return;
    const dx = e.clientX - mvState.startX;
    const dy = e.clientY - mvState.startY;
    const moved = Math.hypot(dx, dy);
    if (mvState.pinched) { mvState.pinched = false; return; }
    const now = Date.now();
    if (mvState.kind === 'image') {
      if (moved < 14 && now - mvState.lastTap < 280) {
        mvState.lastTap = 0;
        if (mvState.scale > 1.2) mvZoomAt(e.clientX, e.clientY, 1);
        else mvZoomAt(e.clientX, e.clientY, 2.6);
        return;
      }
      mvState.lastTap = moved < 14 ? now : 0;
      if (mvState.scale <= 1.02 && dy > 90 && Math.abs(dx) < 80) closeMediaView();
      return;
    }
    if (mvState.kind !== 'video') return;
    if (e.target.closest?.('#mvGo, .mv-hud')) return;
    if (moved < 14 && now - mvState.lastTap < 280) {
      clearTimeout(mvState.tapT);
      mvState.lastTap = 0;
      const box = stage.getBoundingClientRect();
      const third = (e.clientX - box.left) / (box.width || 1);
      if (third < 0.38) mvSkip(-10);
      else if (third > 0.62) mvSkip(10);
      else mvToggleVideo();
      return;
    }
    mvState.lastTap = moved < 14 ? now : 0;
    if (dy > 90 && Math.abs(dx) < 80) { closeMediaView(); return; }
    if (moved >= 14) return;
    clearTimeout(mvState.tapT);
    mvState.tapT = setTimeout(() => {
      if (!root.classList.contains('is-hud') && mvState.video && !mvState.video.paused) {
        mvArmHud();
        return;
      }
      mvToggleVideo();
    }, 240);
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
}

function playChatVoice(btn) {
  const src = btn.dataset.voice;
  if (!src) return;
  if (!chatAud) chatAud = new Audio();
  try { if (audio && !audio.paused) doPause(); } catch {}
  const stop = (el) => {
    if (el && el._vr) { cancelAnimationFrame(el._vr); el._vr = 0; }
  };
  document.querySelectorAll('.chat-voice.on').forEach((x) => {
    if (x !== btn) {
      x.classList.remove('on');
      x._vp = 0;
      stop(x);
      paintVoiceBars(x, 0);
      const vp = x.querySelector('.vp');
      if (vp) vp.innerHTML = VOICE_ICO.play;
      const vd = x.querySelector('.vd');
      if (vd) vd.textContent = chatDur(+x.dataset.dur || 0);
    }
  });
  const tick = () => {
    const dur = (chatAud.duration && isFinite(chatAud.duration) && chatAud.duration > 0)
      ? chatAud.duration
      : (+btn.dataset.dur || 0);
    const t = chatAud.currentTime || 0;
    const target = dur ? t / dur : 0;
    if (btn._vp == null) btn._vp = target;
    btn._vp += (target - btn._vp) * 0.22;
    if (Math.abs(target - btn._vp) < 0.002) btn._vp = target;
    paintVoiceBars(btn, btn._vp, true);
    const vd = btn.querySelector('.vd');
    if (vd && dur) vd.textContent = chatDur(Math.max(0, dur - t));
    if (!chatAud.paused && btn.classList.contains('on')) btn._vr = requestAnimationFrame(tick);
    else btn._vr = 0;
  };
  const same = chatAud.getAttribute('src') === src || (chatAud.src && chatAud.src.endsWith(src.replace(/^\//, '')));
  if (same && !chatAud.paused) {
    chatAud.pause();
    btn.classList.remove('on');
    stop(btn);
    paintVoiceBars(btn, btn._vp || 0);
    const vp = btn.querySelector('.vp');
    if (vp) vp.innerHTML = VOICE_ICO.play;
    return;
  }
  if (same) {
    btn.classList.add('on');
    const vp = btn.querySelector('.vp');
    if (vp) vp.innerHTML = VOICE_ICO.pause;
    chatAud.play().then(() => { stop(btn); btn._vr = requestAnimationFrame(tick); }).catch(() => {
      btn.classList.remove('on');
      if (vp) vp.innerHTML = VOICE_ICO.play;
    });
    return;
  }
  chatAud.pause();
  chatAud.src = src;
  btn._vp = 0;
  btn.classList.add('on');
  btn.querySelector('.vp').innerHTML = VOICE_ICO.pause;
  chatAud.onended = () => {
    btn.classList.remove('on');
    btn._vp = 0;
    stop(btn);
    paintVoiceBars(btn, 0);
    btn.querySelector('.vp').innerHTML = VOICE_ICO.play;
    const vd = btn.querySelector('.vd');
    if (vd) vd.textContent = chatDur(chatAud.duration || +btn.dataset.dur || 0);
  };
  chatAud.play().then(() => {
    vibe('press');
    stop(btn);
    btn._vr = requestAnimationFrame(tick);
  }).catch(() => {
    btn.classList.remove('on');
    btn.querySelector('.vp').innerHTML = VOICE_ICO.play;
  });
}

function playChatRound(btn) {
  const v = btn.querySelector('video');
  if (!v) return;
  try { chatAud?.pause(); } catch {}
  try { if (audio && !audio.paused) doPause(); } catch {}
  const stopTick = (el) => {
    if (el && el._rr) { cancelAnimationFrame(el._rr); el._rr = 0; }
  };
  const tick = () => {
    const dur = (v.duration && isFinite(v.duration) && v.duration > 0)
      ? v.duration
      : (+btn.dataset.dur || 0);
    const t = v.currentTime || 0;
    if (dur > 0) {
      setRoundRing(btn, t / dur);
      const d = btn.querySelector('.rd-dur');
      if (d) d.textContent = chatDur(Math.max(0, dur - t));
    }
    if (!v.paused && !v.ended && btn.classList.contains('playing')) btn._rr = requestAnimationFrame(tick);
    else btn._rr = 0;
  };
  document.querySelectorAll('.chat-round.playing').forEach((x) => {
    if (x !== btn) {
      x.classList.remove('playing');
      const ov = x.querySelector('video');
      try { ov.pause(); ov.currentTime = 0; } catch {}
      stopTick(x);
      setRoundRing(x, 0);
    }
  });
  if (v.paused) {
    btn.classList.add('playing');
    try { v.removeAttribute('muted'); } catch {}
    v.muted = false;
    v.defaultMuted = false;
    try { v.playsInline = true; } catch {}
    const started = () => {
      vibe('press');
      stopTick(btn);
      btn._rr = requestAnimationFrame(tick);
    };
    const failed = () => btn.classList.remove('playing');
    v.play().then(started).catch(() => {
      try { v.load(); } catch {}
      v.play().then(started).catch(failed);
    });
  } else {
    v.pause();
    btn.classList.remove('playing');
    stopTick(btn);
  }
}

function upsertChatRow(log, m, fresh) {
  if (!log || !m || m.id == null) return;
  const id = String(m.id);
  const by = log._by || (log._by = new Map());
  const old = log.querySelector(chatMidSel(id));
  if (old && !fresh && old.querySelector('.chat-voice.on, .chat-round.playing')) {
    by.set(id, m);
    patchChatReacts(old, m);
    const meta = old.querySelector('.chat-meta');
    if (meta) {
      const box = document.createElement('div');
      box.innerHTML = `<div class="chat-meta">${m.edited ? '<span>изм.</span>' : ''}${chatTicks(m)}</div>`;
      if (box.firstElementChild) meta.replaceWith(box.firstElementChild);
    }
    return old;
  }
  by.set(id, m);
  const html = chatRowHTML(m, !!fresh);
  const box = document.createElement('div');
  box.innerHTML = html;
  const node = box.firstElementChild;
  if (!node) return;
  if (old) old.replaceWith(node);
  else if (log._anchor) {
    log.insertBefore(node, log._anchor);
  } else {
    log.querySelector('.chat-void')?.remove();
    const typing = log.querySelector('.chat-typing');
    if (typing) log.insertBefore(node, typing);
    else log.appendChild(node);
  }
  bindChatMedia(node);
  if (log._hold) log._hold(node);
  return node;
}

function takeFreshMsgs(log, msgs) {
  const seen = log._seen || (log._seen = new Set());
  return (msgs || []).filter((m) => {
    if (!m || m.id == null) return false;
    const nid = +m.id;
    if (Number.isNaN(nid) || nid <= 0) return false;
    const sid = String(nid);
    if (seen.has(sid) || seen.has(nid)) return false;
    stealPending(log, m);
    seen.add(sid);
    return true;
  });
}

function appendChatMsgs(log, msgs, replace) {
  if (!log) return;
  const pinned = replace || chatNearEnd(log);
  if (replace) {
    log.innerHTML = '';
    log._seen = new Set();
    log._by = new Map();
    log._anchor = null;
  }
  const fresh = takeFreshMsgs(log, msgs);
  fresh.forEach((m) => upsertChatRow(log, m, !replace));
  if (replace || (fresh.length && pinned)) pinChatLog(log);
  else if (fresh.length) syncChatJump(log);
}

function prependChatMsgs(log, msgs) {
  if (!log) return 0;
  const fresh = takeFreshMsgs(log, msgs);
  if (!fresh.length) return 0;
  const beforeH = log.scrollHeight;
  const beforeTop = log.scrollTop;
  log._anchor = log.querySelector('.chat-row');
  fresh.forEach((m) => upsertChatRow(log, m, false));
  log._anchor = null;
  log.scrollTop = beforeTop + (log.scrollHeight - beforeH);
  return fresh.length;
}

function paintFriendsIdle(pane) {
  if (!pane) return;
  pane.classList.remove('is-open');
  pane.hidden = false;
  pane.innerHTML = `<div class="fr-idle">
    <img class="fr-idle-art" src="/muselogo.png?v=172" alt="" />
    <h3>Напиши другу</h3>
    <p>Выбери человека слева или найди его по имени.</p>
  </div>`;
}

async function openFriendChat(v, handle, meta) {
  stopChatPoll();
  const gen = chatGen;
  chatWith = handle;
  markNotifsSeen({ handle });
  chatAfter = 0;
  chatSince = 0;
  try { tellWatch(); } catch {}
  const pane = v.querySelector('.fr-chat');
  const list = v.querySelector('.fr-list');
  if (!pane) return;
  pane.hidden = false;
  pane.classList.add('is-open');
  if (list && isPhone()) {
    list.hidden = true;
    list.classList.add('is-away');
  }
  v.querySelectorAll('.fr-row').forEach((r) => r.classList.toggle('on', r.dataset.handle === handle));
  const who = meta || { handle, display: handle };
  pane.innerHTML = `<header class="chat-hd">
    ${isPhone() ? `<button type="button" class="chat-back" id="chatBack" aria-label="Назад">${ICO.back}</button>` : ''}
    <button type="button" class="chat-hd-go" id="chatHdGo">
      ${personAv(who)}
      <div><b>${escapeHtml(who.display || who.handle)}</b><i class="chat-seen${who.online ? ' is-on' : ''}" data-onh="${escapeHtml(who.handle || handle)}">${escapeHtml(seenLabel(who) || ('@' + (who.handle || handle)))}</i></div>
    </button>
  </header>
  <div class="chat-log" id="chatLog"></div>
  <div class="chat-dock">
    <button type="button" class="chat-jump" id="chatJump" hidden aria-label="К новым">${ICO.down}</button>
    <div class="chat-ctx" id="chatCtx" hidden></div>
    <div class="chat-attach" id="chatAttach">
      <button type="button" data-att="media"><i class="att-ic">${ICO.image}</i><span>Фото</span></button>
      <button type="button" data-att="audio"><i class="att-ic">${ICO.music}</i><span>Аудио</span></button>
      <button type="button" data-att="round"><i class="att-ic">${ICO.cam}</i><span>Кружок</span></button>
      <button type="button" data-att="song"><i class="att-ic">${ICO.music}</i><span>Трек</span></button>
      <button type="button" data-att="pl"><i class="att-ic">${ICO.link}</i><span>Плейлист</span></button>
      <button type="button" data-att="prof"><i class="att-ic att-av">${personAv(me || {})}</i><span>Профиль</span></button>
    </div>
    <div class="chat-act" id="chatAct"></div>
    <form class="chat-bar" id="chatForm">
      <button type="button" id="chatPlus" title="Ещё">${ICO.attach}</button>
      <div class="chat-field">
        <textarea id="chatQ" rows="1" maxlength="2000" placeholder="Написать" autocomplete="off" enterkeyhint="send" inputmode="text"></textarea>
      </div>
      <button type="submit" class="chat-send is-mic" id="chatGo" aria-label="Отправить">${ICO.mic}</button>
    </form>
    <div class="chat-rec" id="chatRec" hidden>
      <button type="button" id="chatRecX" class="chat-rec-x" aria-label="Отмена">${ICO.x}</button>
      ${voiceWaveHTML('rec-wave')}
      <b id="chatRecT">0:00</b>
      <button type="button" id="chatRecGo" class="chat-rec-send" aria-label="Отправить">${ICO.up}</button>
    </div>
    <input type="file" id="chatPick" accept="image/*,video/*,audio/*,.webm,.mp4,.mov,.m4v,.mp3,.ogg,.wav,.webp" hidden />
    <input type="file" id="chatRoundPick" accept="video/*,.mp4,.mov,.m4v" capture="user" hidden />
  </div>
  <div class="chat-round-rec" id="chatRound" hidden></div>`;
  if (isPhone()) {
    setChatOpen(true);
    try {
      history.pushState({ ...(history.state || {}), museChat: handle }, '');
      chatHistPushed = true;
    } catch { chatHistPushed = false; }
  }
  const leaveChat = () => {
    if (chatDismissOverlays()) return;
    if (chatHistPushed) {
      chatHistPushed = false;
      history.back();
      return;
    }
    closeChatToList();
  };
  $('chatBack')?.addEventListener('click', leaveChat);
  $('chatHdGo')?.addEventListener('click', () => showView('user', handle));
  pane.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  const log = $('chatLog');
  const inp = $('chatQ');
  const goBtn = $('chatGo');
  const pick = $('chatPick');
  let replyTo = 0;
  let editingId = 0;
  let peerRead = 0;
  let rec = null;
  let recChunks = [];
  let recStart = 0;
  let recTimer = 0;
  let recStream = null;
  let recKind = 'voice';
  let recStopMeter = null;

  const hideSheets = () => hideChatSheets();
  const paintGo = () => {
    const has = !!(inp.value || '').trim() || editingId;
    goBtn.classList.toggle('is-mic', !has);
    goBtn.innerHTML = has ? ICO.up : ICO.mic;
    goBtn.setAttribute('aria-label', has ? 'Отправить' : 'Голосовое');
  };
  const setCtx = (kind, text) => {
    const el = $('chatCtx');
    if (!kind) {
      el.hidden = true;
      el.innerHTML = '';
      replyTo = 0;
      editingId = 0;
      paintGo();
      return;
    }
    el.hidden = false;
    el.innerHTML = `<span>${kind === 'edit' ? 'Редактирование' : 'Ответ'}</span><b>${escapeHtml(text || '')}</b><button type="button" id="chatCtxX">${ICO.x}</button>`;
    $('chatCtxX')?.addEventListener('click', () => setCtx(null));
    paintGo();
  };
  const applyPeer = (n) => {
    peerRead = Math.max(peerRead, +n || 0);
    (log._by || new Map()).forEach((m) => {
      if (!m.mine) return;
      const nid = +m.id;
      if (!Number.isFinite(nid) || nid <= 0) return;
      const next = { ...m, read: nid <= peerRead };
      if (next.read === m.read) return;
      log._by.set(String(m.id), next);
      upsertChatRow(log, next, false);
    });
  };
  const toggleReact = async (mid, emoji) => {
    if (!mid || String(mid).startsWith('t') || !CHAT_REACTS.includes(emoji)) return;
    const cur = (log._by || new Map()).get(String(mid));
    if (!cur || cur.deleted || cur.pending || cur.failed) return;
    upsertChatRow(log, applyReactLocal(cur, emoji), false);
    try {
      const j = await post('/api/friends/chat/react', { id: +mid, emoji });
      if (j.message) upsertChatRow(log, j.message, false);
    } catch (err) {
      upsertChatRow(log, cur, false);
      toast(err.message || 'Не вышло');
    }
  };
  log._react = toggleReact;
  log._hold = (node) => {
    if (!node || node.dataset.kind === 'deleted' || !node.dataset.mid) return;
    let t = 0;
    let sx = 0;
    let sy = 0;
    let lastTap = 0;
    const clear = () => { if (t) { clearTimeout(t); t = 0; } node.classList.remove('press'); };
    const down = (e) => {
      if (e.button && e.button !== 0) return;
      if (e.target.closest('button, a, input, textarea')) return;
      node._held = false;
      sx = e.clientX;
      sy = e.clientY;
      t = setTimeout(() => {
        t = 0;
        node._held = true;
        vibe('long');
        node.classList.add('press');
        try { inp.blur(); } catch {}
        openAct(node.dataset.mid);
      }, 420);
    };
    const move = (e) => {
      if (!t) return;
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clear();
    };
    const up = () => clear();
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move, { passive: true });
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('click', (e) => {
      if (node._held) {
        e.preventDefault();
        e.stopPropagation();
        node._held = false;
        return;
      }
      if (e.target.closest('button, a, .chat-media, .chat-voice, .chat-card, .chat-rx')) return;
      const now = Date.now();
      if (now - lastTap < 280) {
        lastTap = 0;
        e.preventDefault();
        vibe('press');
        toggleReact(node.dataset.mid, '❤️');
      } else lastTap = now;
    }, true);
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { closeMenu(); } catch {}
      openAct(node.dataset.mid);
    });
  };
  function openAct(id) {
    hideSheets();
    try { closeMenu(); } catch {}
    const m = (log._by || new Map()).get(String(id));
    if (!m || m.deleted || m.pending || m.failed) return;
    const act = $('chatAct');
    const mine = !!m.mine;
    const canEdit = mine && m.kind === 'text';
    const mineRx = (m.reacts || []).find((r) => r.mine)?.e || '';
    act.innerHTML = `
      <div class="rx-pick">${CHAT_REACTS.map((e) => `<button type="button" data-rx="${e}" class="${mineRx === e ? 'on' : ''}">${e}</button>`).join('')}</div>
      <button type="button" data-a="reply">${ICO.reply} Ответить</button>
      ${canEdit ? `<button type="button" data-a="edit">${ICO.pencil} Изменить</button>` : ''}
      ${mine ? `<button type="button" class="bad" data-a="del">${ICO.trash} Удалить</button>` : ''}`;
    setChatSheet(act, true);
    act.querySelectorAll('[data-rx]').forEach((b) => {
      b.addEventListener('click', () => {
        setChatSheet(act, false);
        toggleReact(m.id, b.dataset.rx);
      });
    });
    act.querySelectorAll('[data-a]').forEach((b) => {
      b.addEventListener('click', async () => {
        setChatSheet(act, false);
        if (b.dataset.a === 'reply') {
          editingId = 0;
          replyTo = m.id;
          setCtx('reply', m.body || CHAT_KIND_LABEL[m.kind] || '');
          inp.focus();
        } else if (b.dataset.a === 'edit') {
          replyTo = 0;
          editingId = m.id;
          inp.value = m.body || '';
          setCtx('edit', (m.body || '').slice(0, 80));
          growChatInp(inp);
          inp.focus();
        } else if (b.dataset.a === 'del') {
          try {
            const j = await post('/api/friends/chat/delete', { id: m.id });
            if (j.message) upsertChatRow(log, j.message, false);
          } catch (err) { toast(err.message || 'Не удалилось'); }
        }
      });
    });
  }

  const sendChat = async (body) => {
    const replyId = body.reply_to || replyTo || 0;
    const tmpId = `t${Date.now().toString(36)}`;
    const preview = {
      id: tmpId,
      mine: true,
      kind: body.kind || 'text',
      body: body.body || '',
      payload: body.payload || {},
      pending: true,
      read: false,
      reacts: [],
      reply: replyId ? (log._by.get(String(replyId)) || { id: replyId, body: '', kind: 'text' }) : null,
    };
    log._seen = log._seen || new Set();
    log._seen.add(tmpId);
    upsertChatRow(log, preview, !REDUCED);
    pinChatLog(log);
    vibe('confirm');
    replyTo = 0;
    setCtx(null);
    try {
      const payload = { handle, ...body };
      if (replyId && !payload.reply_to) payload.reply_to = replyId;
      const j = await post('/api/friends/chat', payload);
      takeChatRow(log, tmpId);
      if (j.message && j.message.id) {
        const id = +j.message.id;
        if (Number.isFinite(id) && id > chatAfter) chatAfter = id;
        const sid = String(id);
        log._seen = log._seen || new Set();
        if (log._seen.has(sid)) upsertChatRow(log, j.message, false);
        else {
          log._seen.add(sid);
          upsertChatRow(log, j.message, false);
        }
        pinChatLog(log);
      }
      return true;
    } catch (err) {
      vibe('reject');
      upsertChatRow(log, { ...preview, pending: false, failed: true }, false);
      return false;
    }
  };

  async function uploadChatFile(blob, kind, duration) {
    const r = await fetch('/api/friends/chat/file', {
      method: 'POST',
      headers: {
        'X-Muse-Kind': kind,
        'X-Muse-Duration': String(duration || 0),
        'Content-Type': blob.type || 'application/octet-stream',
      },
      body: blob,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Не загрузилось');
    return j;
  }

  function askCap(preview, kind, payload) {
    openModal(`<div class="cap-box">
      <div class="cap-prev">${preview}</div>
      <form class="cap-bar" id="capForm">
        <input id="capQ" maxlength="2000" placeholder="Подпись" autocomplete="off" enterkeyhint="send" />
        <button type="submit" class="cap-send" id="capGo" aria-label="Отправить">${ICO.up}</button>
      </form>
    </div>`, isPhone() ? 'sheet' : undefined);
    if (isPhone()) {
      try { $('modalWrap').dataset.stay = '1'; } catch {}
    }
    const run = async (cap) => {
      closeModal();
      await sendChat({ kind, payload, body: cap || '' });
    };
    $('capForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      run(($('capQ').value || '').trim());
    });
    try { $('capQ').focus(); } catch {}
  }

  const pull = async (first) => {
    if (gen !== chatGen || chatWith !== handle) return;
    try { tellWatch(); } catch {}
    try {
      const after = first ? 0 : chatAfter;
      const since = first ? 0 : chatSince;
      const q = `/api/friends/chat?with=${encodeURIComponent(handle)}${after ? `&after=${after}` : ''}${since ? `&since=${since}` : ''}`;
      const j = await api(q);
      if (gen !== chatGen || chatWith !== handle) return;
      if (j.with) {
        Object.assign(who, j.with);
        applyPresence({ [j.with.handle]: j.with });
      }
      const seenEl = pane.querySelector('.chat-seen');
      if (seenEl) {
        if (j.typing) {
          seenEl.dataset.typing = '1';
          seenEl.classList.add('is-on');
          seenEl.textContent = 'печатает…';
        } else {
          seenEl.dataset.typing = '';
          seenEl.classList.toggle('is-on', !!who.online);
          seenEl.textContent = seenLabel(who) || ('@' + (who.handle || handle));
        }
      }
      const msgs = j.messages || [];
      if (first) appendChatMsgs(log, msgs, true);
      else if (msgs.length) appendChatMsgs(log, msgs, false);
      (j.edits || []).forEach((m) => {
        if (!m || m.id == null) return;
        log._seen?.add(String(m.id));
        upsertChatRow(log, m, false);
      });
      msgs.forEach((m) => {
        const nid = +m.id;
        if (Number.isFinite(nid) && nid > chatAfter) chatAfter = nid;
        if (m.updated > chatSince) chatSince = m.updated;
      });
      (j.edits || []).forEach((m) => { if (m.updated > chatSince) chatSince = m.updated; });
      if (first && !(msgs || []).length) log.innerHTML = '<div class="chat-void">Напиши первым</div>';
      if (first) pinChatLog(log);
      applyPeer(j.peer_read || 0);
      const typ = log.querySelector('.chat-typing');
      if (j.typing) {
        if (!typ) {
          const el = document.createElement('div');
          el.className = 'chat-typing';
          el.innerHTML = '<i></i><i></i><i></i>';
          log.appendChild(el);
          if (log._pin !== false) pinChatLog(log);
        }
      } else typ?.remove();
      const lastTheirs = [...(log._by || new Map()).values()]
        .filter((m) => !m.mine && +m.id > 0)
        .reduce((a, m) => (!a || +m.id > +a.id ? m : a), null);
      if (lastTheirs) post('/api/friends/chat/read', { handle, last_id: lastTheirs.id }).catch(() => {});
    } catch (e) {
      if (first && log) log.innerHTML = `<div class="chat-void">${escapeHtml(e.message || 'Чат не загрузился')}</div>`;
    }
  };
  const loadOlder = async () => {
    if (gen !== chatGen || log._older === false || log._olderBusy) return;
    let oldest = 0;
    (log._by || new Map()).forEach((m) => {
      const id = +m.id;
      if (id > 0 && (!oldest || id < oldest)) oldest = id;
    });
    if (!oldest) return;
    log._olderBusy = true;
    try {
      const j = await api(`/api/friends/chat?with=${encodeURIComponent(handle)}&before=${oldest}`);
      if (gen !== chatGen) return;
      const n = prependChatMsgs(log, j.messages || []);
      if (!j.more || !n) log._older = false;
    } catch {}
    finally { log._olderBusy = false; }
  };
  window.__musePullChat = () => {
    if (gen !== chatGen) return;
    log._pin = true;
    return pull(false).then(() => { if (gen === chatGen) pinChatLog(log); });
  };
  await pull(true);
  if (gen !== chatGen) return;
  if (chatPoll) { clearInterval(chatPoll); chatPoll = null; }
  chatWith = handle;
  chatPoll = setInterval(() => pull(false), 1600);

  goBtn.addEventListener('click', (e) => {
    if (!goBtn.classList.contains('is-mic')) return;
    e.preventDefault();
    startRec('voice');
  });
  $('chatForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (goBtn.classList.contains('is-mic')) return;
    const text = (inp.value || '').trim();
    if (!text) return;
    if (editingId) {
      try {
        const j = await post('/api/friends/chat/edit', { id: editingId, body: text });
        if (j.message) upsertChatRow(log, j.message, false);
        inp.value = '';
        growChatInp(inp);
        setCtx(null);
      } catch (err) { toast(err.message || 'Не изменилось'); }
      return;
    }
    inp.value = '';
    growChatInp(inp);
    paintGo();
    await sendChat({ kind: 'text', body: text });
  });

  let typedAt = 0;
  inp?.addEventListener('input', () => {
    growChatInp(inp);
    paintGo();
    const now = Date.now();
    if (now - typedAt < 1200) return;
    typedAt = now;
    post('/api/friends/typing', { handle }).catch(() => {});
  });
  inp?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || isPhone()) return;
    e.preventDefault();
    if (!(inp.value || '').trim() && !editingId) return;
    $('chatForm')?.requestSubmit?.();
  });
  inp?.addEventListener('focus', () => {
    log._pin = true;
    requestAnimationFrame(() => { try { pinChatLog(log); trackChatKb(); } catch {} });
  });
  paintGo();
  growChatInp(inp);
  log.addEventListener('scroll', () => {
    try { syncChatJump(log); } catch {}
    if (log.scrollTop < 80) loadOlder();
  }, { passive: true });
  $('chatJump')?.addEventListener('click', () => { pinChatLog(log); vibe('select'); });
  log.addEventListener('click', (e) => {
    const b = e.target.closest('[data-retry]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const id = b.getAttribute('data-retry');
    const m = log._by.get(String(id));
    if (!m || !m.failed) return;
    takeChatRow(log, id);
    const body = { kind: m.kind, body: m.body || '', payload: m.payload };
    if (m.reply && m.reply.id) body.reply_to = m.reply.id;
    sendChat(body);
  });

  log.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, .chat-round, .chat-media, .chat-voice, .chat-card, .chat-act')) return;
    if (chatSheetsOpen()) hideSheets();
  });

  if (isPhone()) {
    let edgeX = null;
    let edgeY = null;
    pane.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (!t || t.clientX > 28) { edgeX = null; return; }
      if (e.target.closest('textarea, input, button, video')) { edgeX = null; return; }
      edgeX = t.clientX;
      edgeY = t.clientY;
    }, { passive: true });
    pane.addEventListener('touchend', (e) => {
      if (edgeX == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - edgeX;
      const dy = Math.abs(t.clientY - edgeY);
      edgeX = null;
      if (dx > 72 && dy < 80) leaveChat();
    });
  }

  const stopRec = async (send) => {
    clearInterval(recTimer);
    const stream = recStream;
    recStream = null;
    const recorder = rec;
    rec = null;
    $('chatRec').hidden = true;
    $('chatForm').hidden = false;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise((res) => {
        recorder.addEventListener('stop', res, { once: true });
        try { recorder.stop(); } catch { res(); }
      });
    }
    const chunks = recChunks;
    recChunks = [];
    const dur = Math.max(0, (Date.now() - recStart) / 1000);
    try { recStopMeter?.(); } catch {}
    recStopMeter = null;
    try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
    iosLiveSession(false);
    if (!send || dur < 0.5 || !chunks.length) return;
    const blob = new Blob(chunks, { type: chunks[0].type || (isIOS ? 'audio/mp4' : 'audio/webm') });
    try {
      const up = await uploadChatFile(blob, recKind, dur);
      await sendChat({ kind: recKind, payload: { file: up.file, url: up.url, duration: dur, ctype: up.ctype } });
    } catch (err) { toast(err.message || 'Не записалось'); }
  };

  const startRec = async (kind) => {
    if (rec) return;
    recKind = kind;
    recChunks = [];
    try { if (audio && !audio.paused) doPause(); } catch {}
    try {
      recStream = await askLive({ audio: true });
    } catch (e) {
      iosLiveSession(false);
      toast(liveErr(e, 'mic'));
      return;
    }
    const mimeOpts = isIOS
      ? ['audio/mp4', 'audio/aac', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mime = mimeOpts.find((m) => {
      try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
    }) || '';
    try {
      rec = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    } catch {
      iosLiveSession(false);
      toast('Нет записи звука');
      try { recStream.getTracks().forEach((t) => t.stop()); } catch {}
      recStream = null;
      return;
    }
    rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    try { rec.start(); } catch { rec.start(1000); }
    recStart = Date.now();
    try { inp.blur(); } catch {}
    hideSheets();
    $('chatForm').hidden = true;
    $('chatRec').hidden = false;
    recStopMeter = startVoiceMeter(recStream, $('chatRec')?.querySelector('.rec-wave'));
    const clock = $('chatRecT');
    recTimer = setInterval(() => { if (clock) clock.textContent = fmt((Date.now() - recStart) / 1000); }, 200);
  };

  $('chatRecX')?.addEventListener('click', () => stopRec(false));
  $('chatRecGo')?.addEventListener('click', () => stopRec(true));

  const sendProf = () => sendChat({
    kind: 'profile',
    payload: { handle: meHandle(), display: me.display, avatar: me.avatar, hue: me.hue },
  });
  $('chatPlus')?.addEventListener('click', () => {
    const el = $('chatAttach');
    const on = !chatSheetOn(el);
    hideSheets();
    if (isPhone()) { try { inp.blur(); } catch {} }
    if (on) {
      vibe('select');
      setChatSheet(el, true);
      requestAnimationFrame(() => { try { if (log._pin) pinChatLog(log); } catch {} });
    }
  });
  $('chatAttach')?.querySelectorAll('[data-att]').forEach((b) => {
    b.addEventListener('click', async () => {
      hideSheets();
      const att = b.dataset.att;
      if (att === 'media') { pick.accept = 'image/*,video/*,.webm,.mp4,.mov,.m4v,.webp'; pick.dataset.kind = ''; pick.click(); }
      else if (att === 'audio') { pick.accept = 'audio/*,.mp3,.ogg,.wav,.webm'; pick.dataset.kind = 'audio'; pick.click(); }
      else if (att === 'round') startRound();
      else if (att === 'song') openSongPick();
      else if (att === 'pl') openPlPick();
      else if (att === 'prof') sendProf();
    });
  });

  pick.addEventListener('change', async () => {
    const f = pick.files && pick.files[0];
    pick.value = '';
    if (!f) return;
    const forced = pick.dataset.kind;
    let kind = forced || chatNameKind(f) || 'image';
    let dur = 0;
    if (kind === 'probe' || kind === 'video' || kind === 'audio' || kind === 'voice') {
      const meta = await probeVideoFile(f);
      dur = meta.duration;
      if (meta.video) kind = 'video';
      else if (kind === 'probe') {
        kind = /audio|\.m4a|\.mp3|\.aac/i.test(`${f.type} ${f.name}`) ? 'audio' : 'image';
      }
    }
    if (kind === 'gif') kind = 'image';
    try {
      const up = await uploadChatFile(f, kind, dur);
      const src = up.url;
      const prev = kind === 'image'
        ? `<img src="${escapeHtml(src)}" alt="" style="width:100%;border-radius:12px" />`
        : kind === 'video'
          ? `<video src="${escapeHtml(src)}" style="width:100%;border-radius:12px" muted playsinline webkit-playsinline></video>`
          : `<b>${escapeHtml(f.name)}</b>`;
      askCap(prev, kind, { file: up.file, url: up.url, duration: dur, ctype: up.ctype });
    } catch (err) { toast(err.message || 'Не загрузилось'); }
  });

  function openSongPick() {
    openModal(`<h2>Отправить трек</h2>
      <div class="ch-pick"><input id="songQ" placeholder="Поиск песни" autocomplete="off" /></div>
      <div class="mk-pick" id="songHits"></div>`, isPhone() ? 'sheet' : undefined);
    const box = $('songHits');
    let seq = 0;
    const run = async (q) => {
      if (!q) { box.innerHTML = ''; return; }
      const n = ++seq;
      try {
        const j = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}&n=12`, {}, 12000);
        if (n !== seq) return;
        const rows = j.results || [];
        box.innerHTML = rows.map((t) => `
          <button type="button" class="mk-pick-row" data-sid="${escapeHtml(t.id)}" data-st="${escapeHtml(t.title || '')}" data-sth="${escapeHtml(t.thumbnail || '')}" data-sd="${t.duration || 0}">
            <img src="${escapeHtml(ytThumb(t.id, t.thumbnail))}" alt="" />
            <span><b>${escapeHtml(t.title || 'Song')}</b><i>${escapeHtml(t.uploader || '')}</i></span>
          </button>`).join('') || '<p class="fr-hits-empty">Ничего</p>';
        box.querySelectorAll('[data-sid]').forEach((b) => {
          b.addEventListener('click', () => {
            const payload = { id: b.dataset.sid, title: b.dataset.st, thumbnail: b.dataset.sth, duration: +b.dataset.sd || 0 };
            closeModal();
            askCap(`<div class="chat-card"><img src="${escapeHtml(ytThumb(payload.id, payload.thumbnail))}" alt="" /><span><b>${escapeHtml(payload.title)}</b></span></div>`, 'song', payload);
          });
        });
      } catch { box.innerHTML = '<p class="fr-hits-empty">Поиск не вышел</p>'; }
    };
    let t = 0;
    $('songQ')?.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => run(($('songQ').value || '').trim()), 280);
    });
    try { $('songQ').focus(); } catch {}
  }

  async function openPlPick() {
    let pls = myPlaylists;
    try { pls = (await api('/api/playlists')).playlists || pls; } catch {}
    if (!pls.length) { toast('Сначала собери плейлист'); return; }
    openModal(`<h2>Отправить плейлист</h2><div class="mk-pick">${pls.map((p) => `
      <button type="button" class="mk-pick-row" data-sendpl="${p.id}">
        ${mkCover(p)}<span><b>${escapeHtml(p.name)}</b><i>${p.count || 0} ${Number(p.count) === 1 ? 'трек' : 'треков'}</i></span>
      </button>`).join('')}</div>`, isPhone() ? 'sheet' : undefined);
    $('modalBox').querySelectorAll('[data-sendpl]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.busy === '1') return;
        b.dataset.busy = '1';
        const p = pls.find((x) => String(x.id) === b.dataset.sendpl);
        closeModal();
        if (!p) return;
        const payload = {
          id: p.id, name: p.name, handle: meHandle(), slug: p.slug,
          cover: p.custom_cover || p.cover, count: p.count,
        };
        askCap(`${mkCover(p)}<b>${escapeHtml(p.name)}</b>`, 'playlist', payload);
      });
    });
  }

  async function sendRoundFile(f) {
    if (!f) return;
    const meta = await probeVideoFile(f);
    if (!meta.video && !/video|\.mp4|\.mov|\.m4v/i.test(`${f.type} ${f.name}`)) {
      toast('Это не видео');
      return;
    }
    try {
      const up = await uploadChatFile(f, 'round', meta.duration);
      await sendChat({ kind: 'round', payload: { file: up.file, url: up.url, duration: meta.duration, ctype: up.ctype } });
    } catch (err) { toast(err.message || 'Не записалось'); }
  }

  $('chatRoundPick')?.addEventListener('change', async () => {
    const inpR = $('chatRoundPick');
    const f = inpR.files && inpR.files[0];
    inpR.value = '';
    iosLiveSession(false);
    if (f) await sendRoundFile(f);
  });

  async function startRound() {
    hideSheets();
    try { inp.blur(); } catch {}
    try { if (audio && !audio.paused) doPause(); } catch {}
    const box = $('chatRound');
    if (!box || box === __nullEl) return;
    try {
      box.querySelectorAll('video').forEach((v) => {
        try { v.srcObject?.getTracks?.().forEach((t) => t.stop()); } catch {}
        v.srcObject = null;
      });
    } catch {}
    box.innerHTML = '';
    box.hidden = true;
    const nativeRound = () => {
      const inpR = $('chatRoundPick');
      if (!inpR || inpR === __nullEl) return false;
      inpR.value = '';
      inpR.click();
      return true;
    };
    if (isIOS) {
      if (!nativeRound()) toast('Нет камеры');
      return;
    }
    let stream = null;
    try {
      stream = await askLive({ video: true, audio: true });
    } catch (e) {
      iosLiveSession(false);
      if (nativeRound()) return;
      toast(liveErr(e, 'cam'));
      return;
    }
    try {
      stream.getVideoTracks().forEach((t) => {
        try { t.contentHint = 'motion'; } catch {}
      });
    } catch {}
    let local = null;
    let clock = 0;
    let start = 0;
    let finishing = false;
    let stopping = false;
    const closeRound = () => {
      finishing = true;
      clearInterval(clock);
      try { if (local && local.state !== 'inactive') local.stop(); } catch {}
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
      try { const v = $('rrVid'); if (v && v !== __nullEl) v.srcObject = null; } catch {}
      box.innerHTML = '';
      box.hidden = true;
      iosLiveSession(false);
    };
    box.innerHTML = `<div class="rr-preview">
        <video id="rrVid" autoplay muted playsinline webkit-playsinline></video>
        ${roundRingSVG('rd-ring rr-ring')}
      </div>
      <b id="rrT">0:00</b>
      <button type="button" class="rr-go" id="rrGo" aria-label="Запись"></button>
      <button type="button" id="rrX">Отмена</button>`;
    box.hidden = false;
    const vid = $('rrVid');
    vid.srcObject = stream;
    try { vid.playsInline = true; } catch {}
    try { await vid.play(); } catch {}

    const recMime = () => {
      const opts = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp8',
        'video/mp4',
        'video/webm',
        'video/webm;codecs=vp9,opus',
      ];
      return opts.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    };

    const finishRec = async () => {
      if (!local || stopping) return;
      stopping = true;
      const rec = local;
      local = null;
      clearInterval(clock);
      const ms = Date.now() - start;
      await new Promise((res) => {
        rec.addEventListener('stop', res, { once: true });
        try { rec.stop(); } catch { res(); }
      });
      const dur = Math.max(0, ms / 1000);
      const blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || recMime() || 'video/webm' });
      closeRound();
      if (ms < ROUND_MIN_MS || !chunks.length) return;
      if ((blob.type || '').startsWith('audio/')) { toast('Не записалось видео'); return; }
      try {
        const up = await uploadChatFile(blob, 'round', dur);
        await sendChat({ kind: 'round', payload: { file: up.file, url: up.url, duration: dur, ctype: up.ctype } });
      } catch (err) { toast(err.message || 'Не записалось'); }
    };

    let chunks = [];
    $('rrX')?.addEventListener('click', closeRound);
    $('rrGo')?.addEventListener('click', async () => {
      if (finishing) return;
      const btn = $('rrGo');
      if (local) { vibe('confirm'); await finishRec(); return; }
      try {
        if (typeof MediaRecorder === 'undefined') { toast('Нет записи видео'); return; }
        const mime = recMime();
        const opts = {
          videoBitsPerSecond: ROUND_V_BPS,
          audioBitsPerSecond: ROUND_A_BPS,
        };
        if (mime) opts.mimeType = mime;
        try { local = new MediaRecorder(stream, opts); }
        catch { local = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      } catch { toast('Не записалось'); return; }
      chunks = [];
      local.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      try { local.start(); } catch { try { local.start(1000); } catch { toast('Не записалось'); return; } }
      start = Date.now();
      btn.classList.add('on');
      vibe('press');
      const clockEl = $('rrT');
      clock = setInterval(() => {
        const ms = Date.now() - start;
        if (clockEl && clockEl !== __nullEl) clockEl.textContent = fmt(ms / 1000);
        setRoundRing(box, ms / ROUND_MAX_MS);
        if (ms >= ROUND_MAX_MS) finishRec();
      }, 100);
    });
  }

}

function bindFriendSearch(v, friends, incoming, outgoing, arg) {
  const inp = $('frQ');
  const hits = $('frHits');
  if (!inp || !hits) return;
  let timer = 0;
  let seq = 0;
  const known = (h) => {
    if (friends.some((x) => x.handle === h)) return 'friends';
    if (outgoing.some((x) => x.handle === h)) return 'outgoing';
    if (incoming.some((x) => x.handle === h)) return 'incoming';
    return 'none';
  };
  const paint = (users) => {
    const mine = meHandle();
    const list = (users || []).filter((u) => u.handle && u.handle !== mine && u.friend !== 'self');
    if (!list.length) {
      hits.hidden = true;
      hits.innerHTML = '<p class="fr-hits-empty">Никого не нашли</p>';
      hits.hidden = false;
      return;
    }
    hits.innerHTML = list.map((u) => {
      const st = u.friend && u.friend !== 'none' ? u.friend : known(u.handle);
      let act = `<button type="button" class="fr-add" data-addh="${escapeHtml(u.handle)}">Добавить</button>`;
      if (st === 'friends') act = `<button type="button" class="fr-add ghost" data-chath="${escapeHtml(u.handle)}">Чат</button>`;
      else if (st === 'outgoing') act = `<i class="fr-wait">Ждёт</i>`;
      else if (st === 'incoming') act = `<button type="button" class="fr-add" data-acc="${escapeHtml(u.handle)}">Принять</button>`;
      return `<article class="fr-hit">
        <button type="button" class="fr-row" data-openh="${escapeHtml(u.handle)}">
          ${personAv(u)}<span><b>${escapeHtml(u.display || u.handle)}</b><i>@${escapeHtml(u.handle)}</i></span>
        </button>${act}
      </article>`;
    }).join('');
    hits.hidden = false;
    hits.querySelectorAll('[data-openh]').forEach((b) => {
      b.addEventListener('click', () => showView('user', b.dataset.openh));
    });
    hits.querySelectorAll('[data-addh]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        b.disabled = true;
        try {
          await post('/api/friends/request', { handle: b.dataset.addh });
          toast('Заявка отправлена', true);
          b.replaceWith(Object.assign(document.createElement('i'), { className: 'fr-wait', textContent: 'Ждёт' }));
        } catch (err) {
          b.disabled = false;
          const n = v.querySelector('.fr-find-err') || (() => {
            const el = document.createElement('p');
            el.className = 'fr-find-err';
            hits.after(el);
            return el;
          })();
          n.textContent = err.message || 'Не отправилось';
        }
      });
    });
    hits.querySelectorAll('[data-chath]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const u = friends.find((x) => x.handle === b.dataset.chath);
        if (u) openFriendChat(v, u.handle, u);
      });
    });
    hits.querySelectorAll('[data-acc]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await post('/api/friends/accept', { handle: b.dataset.acc });
          toast('Теперь вы друзья', true);
          renderFriends(v, arg);
        } catch (err) { toast(err.message || 'Не принято'); }
      });
    });
  };
  const run = async () => {
    const q = (inp.value || '').trim().replace(/^@/, '');
    if (q.length < 1) {
      hits.hidden = true;
      hits.innerHTML = '';
      return;
    }
    const my = ++seq;
    try {
      const j = await api(`/api/users?q=${encodeURIComponent(q)}&n=8`);
      if (my !== seq) return;
      paint(j.users || []);
    } catch {
      if (my !== seq) return;
      hits.innerHTML = '<p class="fr-hits-empty">Поиск не сработал</p>';
      hits.hidden = false;
    }
  };
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 160);
  });
  $('frFind')?.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    run();
  });
}

async function renderFriends(v, arg) {
  if (!me) {
    v.innerHTML = `<div class="mk-void">
      <img class="fr-idle-art" src="/muselogo.png?v=172" alt="" />
      <h3>Друзья</h3>
      <p>Войди, чтобы добавлять людей и переписываться.</p>
      <button type="button" class="mbtn primary" data-auth="1">Войти</button>
    </div>`;
    v.querySelector('[data-auth]')?.addEventListener('click', () => openAuth('signin'));
    return;
  }
  v.innerHTML = `<div class="fr-wrap"><div class="mk-void"><p>Загрузка</p></div></div>`;
  let data;
  try { data = await api('/api/friends'); }
  catch { v.innerHTML = `<div class="mk-void"><h3>Не загрузилось</h3><p>Попробуй ещё раз через секунду.</p></div>`; return; }
  const friends = data.friends || [];
  const incoming = data.incoming || [];
  const outgoing = data.outgoing || [];
  const row = (u, extra, sub) => `<button type="button" class="fr-row" data-handle="${escapeHtml(u.handle)}">
    ${personAv(u)}<span><b>${escapeHtml(u.display || u.handle)}</b><i class="${u.online ? 'is-on' : ''}" data-onh="${escapeHtml(u.handle || '')}">${escapeHtml(sub || seenLabel(u) || ('@' + (u.handle || '')))}</i></span>${extra || ''}
  </button>`;
  const emptyPeople = !friends.length && !incoming.length && !outgoing.length;
  v.innerHTML = `<div class="fr-wrap">
    <aside class="fr-list">
      <div class="fr-head">
        <h2>Друзья</h2>
        <form id="frFind">
          <input id="frQ" placeholder="Найди человека" maxlength="24" autocomplete="off" />
        </form>
        <div id="frHits" class="fr-hits" hidden></div>
      </div>
      ${incoming.length ? `<p class="fr-lab">Заявки</p>${incoming.map((u) =>
        `<article class="fr-req">
          <button type="button" class="fr-row" data-handle="${escapeHtml(u.handle)}">${personAv(u)}<span><b>${escapeHtml(u.display || u.handle)}</b><i>@${escapeHtml(u.handle)}</i></span></button>
          <div class="fr-req-act">
            <button type="button" class="fr-yes" data-acc="${escapeHtml(u.handle)}">Принять</button>
            <button type="button" class="fr-no" data-dec="${escapeHtml(u.handle)}">Нет</button>
          </div>
        </article>`).join('')}` : ''}
      ${outgoing.length ? `<p class="fr-lab">Отправлено</p>${outgoing.map((u) => row(u, '<i class="fr-wait">Ждёт</i>', '@' + (u.handle || ''))).join('')}` : ''}
      ${emptyPeople
        ? `<div class="fr-void">
            <h3>Пока никого</h3>
            <p>Найди человека по имени и отправь заявку.</p>
          </div>`
        : `${friends.length ? `<p class="fr-lab">Все</p>${friends.map((u) => row(u, '')).join('')}` : ''}`}
    </aside>
    <section class="fr-chat"></section>
  </div>`;
  paintFriendsIdle(v.querySelector('.fr-chat'));
  bindFriendSearch(v, friends, incoming, outgoing, arg);
  v.querySelectorAll('[data-acc]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await post('/api/friends/accept', { handle: b.dataset.acc });
        toast('Теперь вы друзья', true);
        renderFriends(v, arg);
      }
      catch (err) { toast(err.message || 'Не принято'); }
    });
  });
  v.querySelectorAll('[data-dec]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await post('/api/friends/decline', { handle: b.dataset.dec }); renderFriends(v, arg); }
      catch (err) { toast(err.message || 'Не вышло'); }
    });
  });
  v.querySelectorAll('.fr-row').forEach((b) => {
    b.addEventListener('click', () => {
      const h = b.dataset.handle;
      const u = friends.find((x) => x.handle === h) || incoming.find((x) => x.handle === h)
        || outgoing.find((x) => x.handle === h);
      if (!friends.some((x) => x.handle === h)) {
        showView('user', h);
        return;
      }
      openFriendChat(v, h, u);
    });
  });
  const want = (arg && arg.handle) || '';
  if (want && friends.some((x) => x.handle === want)) {
    openFriendChat(v, want, friends.find((x) => x.handle === want));
  }
}

function vheadHTML(kind, title, sub, cover) {
  const tiles = {
    foryou: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15.6l-1.7-4.6L6 9.3l4.3-1.7z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
    liked: ICO.heart, pl: ICO.music, lock: ICO.x,
  };
  return `<div class="vhead">
    <div class="vcover${kind === 'foryou' ? ' fy' : ''}">${cover ? `<img src="${cover}" alt="" />` : tiles[kind] || tiles.pl}</div>
    <div style="min-width:0;flex:1"><h2>${escapeHtml(title)}</h2><p>${sub}</p>
    <div class="vactions" data-vact></div></div></div>`;
}

function lockedHTML(title, sub) {
  return vheadHTML('lock', title, `${sub} <span class="vsub">Sign in to unlock.</span>`, '') +
    `<div class="vactions"><button class="vplay" data-auth="1">Sign in</button></div>`;
}

function trowHTML(t, i, opts = {}) {
  return `<div class="trow" style="animation-delay:${Math.min(i * 40, 320)}ms" data-row="${t.item_id ?? t.id}">
    <img src="${ytThumb(t.id, t.thumbnail)}" data-playrow="${t.id}" alt="" loading="lazy" draggable="false"
      onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${t.id}/mqdefault.jpg'" />
    <span class="tt" data-playrow="${t.id}" title="${escapeHtml(t.title)}"><span class="t">${escapeHtml(t.title)}</span>${t.duration ? `<span class="tdur">${fmt(t.duration)}</span>` : ''}</span>
    <button class="icb${t._liked ? ' loved' : ''}" data-like="${t.id}" title="Like">${ICO.heart}</button>
  </div>`;
}

function recoCardHTML(t, i) {
  return `
  <div class="card" style="animation-delay:${Math.min(i * 55, 440)}ms" data-play="${t.id}" title="Play">
    <span class="likedot" data-like="${t.id}">${ICO.heart}</span>
    <div class="thumb">
      <img loading="lazy" decoding="async" draggable="false" src="${ytThumb(t.id, t.thumbnail)}"
        onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${t.id}/mqdefault.jpg'" alt="" />
      <span class="go"><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg></span></span>
      ${t.duration ? `<span class="dur">${fmt(t.duration)}</span>` : ''}
    </div>
    <h3>${escapeHtml(t.title)}</h3>
  </div>`;
}

/* ---------- For You ---------- */
async function renderForYou(v) {
  if (!me) { v.innerHTML = lockedHTML('For You', 'Muse learns your ears and tunes this page.'); return; }
  v.innerHTML = vheadHTML('foryou', 'For You', 'Tuned by your ears · refreshes as you listen', '') +
    `<div class="vactions" style="margin-bottom:14px">
       <button class="vghost" data-fyrefresh="1">${ICO.refresh} Refresh</button>
     </div><div class="grid" id="fyGrid"></div>`;
  v.querySelector('[data-vact]').innerHTML = vplayIc('data-fyplay="1"');
  paintHeaderPlay('foryou');
  try {
    await swr('/api/recommendations?n=12', (j) => {
      if (currentView !== 'foryou') return;
      if (!j.tracks.length && j.building) {
        $('fyGrid').innerHTML = '<div class="vempty">Building your mix…</div>';
        setTimeout(() => { if (currentView === 'foryou' && v.isConnected) renderForYou(v); }, 6000);
        return;
      }
      if (!j.tracks.length) {
        if (!v.querySelector('.vempty')) v.insertAdjacentHTML('beforeend',
          '<div class="vempty">Like a few songs. This page learns what you play.</div>');
        return;
      }
      v.querySelector('.vempty')?.remove();
      viewQueue = j.tracks.map((t) => ({ ...t }));
      $('fyGrid').innerHTML = j.tracks.map(recoCardHTML).join('');
      markLiked(j.tracks.map((t) => t.id));
      prewarm(j.tracks);
    });
  } catch (e) {
    v.insertAdjacentHTML('beforeend', `<div class="vempty">Couldn't tune in: ${escapeHtml(e.message)}</div>`);
  }
}

/* ---------- Liked ---------- */
async function renderLiked(v) {
  if (!me) { v.innerHTML = lockedHTML('Liked Songs', 'Everything you heart lands here.'); return; }
  try {
    await swr('/api/likes', (j) => paintLiked(v, j));
  } catch (e) {
    if (!v.querySelector('.trow')) v.innerHTML = `<div class="vempty">Couldn't load likes: ${escapeHtml(e.message)}</div>`;
  }
}

function paintLiked(v, j) {
  {
    if (currentView !== 'liked') return;
    viewQueue = j.tracks.map((t) => ({ ...t }));
    // Prime the truth: every row here IS liked — otherwise the next
    // partial repaint elsewhere would strip these hearts.
    j.tracks.forEach((t) => likedSet.add(t.id));
    const total = j.tracks.reduce((a, t) => a + (t.duration || 0), 0);
    v.innerHTML = vheadHTML('liked', 'Liked Songs', '', '') +
      (j.tracks.length
        ? j.tracks.map((t, i) => trowHTML({ ...t, _liked: true }, i, { liked: true })).join('')
        : '<div class="vempty">Nothing hearted yet — right-click any song and hit Like.</div>');
    if (j.tracks.length) v.querySelector('[data-vact]').innerHTML = vplayIc('data-playall="1"');
    paintHeaderPlay('liked');
  }
}

/* ---------- Playlist detail ---------- */
async function renderPlaylist(v, pid) {
  if (!me) { v.innerHTML = lockedHTML('Playlist', 'Your collections live here.'); return; }
  try {
    await swr(`/api/playlists/${pid}/tracks`, (pl) => paintPlaylist(v, pid, pl));
  } catch (e) {
    if (!v.querySelector('.vhead')) v.innerHTML = `<div class="vempty">Couldn't open playlist: ${escapeHtml(e.message)}</div>`;
  }
}

function paintPlaylist(v, pid, pl) {
  {
    if (currentView !== 'playlist' || viewArg !== pid) return;
    viewQueue = pl.tracks.map((t) => ({ ...t }));
    const total = pl.tracks.reduce((a, t) => a + (t.duration || 0), 0);
    const cover = pl.custom_cover || (pl.tracks.length ? ytThumb(pl.tracks[0].id, pl.tracks[0].thumbnail) : '');
    const slug = pl.slug || (playlistById(pid) || {}).slug || String(pid);
    const handle = pl.handle || meHandle();
    if (handle && slug) setPath(plPath(handle, slug));
    try { document.title = `${pl.name} · Muse`; } catch {}
    v.innerHTML = `<div class="vhead">
        <div class="vcover has-edit" data-cover="${pl.id}" title="Change cover">${cover ? `<img src="${cover}" alt="" />` : ICO.music}<button class="editcover" data-cover="${pl.id}" title="Change cover" tabindex="-1">${ICO.pencil}</button></div>
        <div style="min-width:0;flex:1"><div class="vtitle-row"><h2 id="plName">${escapeHtml(pl.name)}</h2>
        <button class="pencil" data-rename="1" title="Rename">${ICO.pencil}</button></div>
        <p>${pl.tracks.length} songs${total ? ' • ' + fmt(total) : ''}</p>
        <div class="vactions">
          ${pl.tracks.length ? vplayIc('data-playall="1"') : ''}
          ${handle && slug ? vshareIc(handle, slug) : ''}
        </div></div></div>` +
      (pl.tracks.length
        ? pl.tracks.map((t, i) => trowHTML(t, i, { playlist: true })).join('')
        : `<div class="vempty pl-empty">
             <h3>Empty Playlist</h3>
             <p>Fill it with songs you love.</p>
             <button class="vplay" data-gohome>Add Songs</button>
           </div>`);
    paintHeaderPlay('playlist', pid);
    markLiked(pl.tracks.map((t) => t.id));
  }
}

function ownerChipHTML(u) {
  const h = escapeHtml(u.handle || '');
  const letter = escapeHtml((u.display || u.handle || '?')[0] || '?').toUpperCase();
  const av = u.avatar
    ? `<img src="${escapeHtml(u.avatar)}" alt="" />`
    : `<span class="ph" style="background:${avatarBG(u.hue)}">${letter}</span>`;
  const label = escapeHtml(u.display || h);
  return `<button type="button" class="pl-owner" data-openuser="${h}" title="${label} @${h}">${av}</button>`;
}

async function renderShared(v, arg) {
  const handle = (arg && arg.handle) || '';
  const slug = (arg && arg.slug) || '';
  if (!handle || !slug) {
    v.innerHTML = `<div class="vempty">Playlist not found.</div>`;
    return;
  }
  setPath(plPath(handle, slug));
  v.innerHTML = `<div class="vempty">Loading playlist…</div>`;
  let data;
  try {
    data = await api(`/api/p/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`);
  } catch {
    v.innerHTML = `<div class="vempty">Playlist not found.</div>`;
    return;
  }
  if (currentView !== 'shared') return;
  if ((viewArg && viewArg.handle) !== handle || (viewArg && viewArg.slug) !== slug) return;
  if (data.mine && data.playlist && data.playlist.id) {
    currentView = 'playlist';
    viewArg = data.playlist.id;
    setViewNav('playlist');
    paintPlaylist(v, data.playlist.id, data.playlist);
    return;
  }
  const pl = data.playlist || {};
  const tracks = pl.tracks || [];
  viewArg = { handle, slug, id: pl.id };
  viewQueue = tracks.map((t) => ({ ...t }));
  const total = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  const cover = pl.custom_cover || (tracks.length ? ytThumb(tracks[0].id, tracks[0].thumbnail) : '');
  try { document.title = `${pl.name || 'Playlist'} · Muse`; } catch {}
  v.innerHTML = `<div class="vhead">
      <div class="vcover">${cover ? `<img src="${cover}" alt="" />` : ICO.music}${ownerChipHTML(data.owner || {})}</div>
      <div style="min-width:0;flex:1">
        <h2>${escapeHtml(pl.name || 'Playlist')}</h2>
        <p>${tracks.length} songs${total ? ' • ' + fmt(total) : ''}</p>
        <div class="vactions">
          ${tracks.length ? vplayIc('data-playall="1"') : ''}
          ${vshareIc(handle, slug)}
          <button type="button" class="vplay" data-takeh="${escapeHtml(handle)}" data-takes="${escapeHtml(slug)}">Add to my library</button>
        </div>
      </div>
    </div>` +
    (tracks.length
      ? tracks.map((t, i) => trowHTML(t, i)).join('')
      : '<div class="vempty">This playlist is empty.</div>');
  paintHeaderPlay('shared', viewArg);
  markLiked(tracks.map((t) => t.id));
}

/* ---------- likes ---------- */
async function markLiked(ids) {
  if (!me || !ids.length) return;
  try {
    const j = await api(`/api/liked_ids?ids=${ids.join(',')}`);
    // UNION, never replace: this is usually a partial id list, and repainting
    // from a partial set would strip hearts that are actually liked.
    j.liked.forEach((id) => likedSet.add(id));
    paintLikedSet();
  } catch { /* hearts stay unmarked */ }
}

function paintLikedSet() {
  document.querySelectorAll('#grid .card, #view .card').forEach((c) => {
    const id = c.dataset.play;
    if (id) c.classList.toggle('liked', likedSet.has(id));
  });
  document.querySelectorAll('[data-like]').forEach((b) => {
    b.classList.toggle('loved', likedSet.has(b.dataset.like));
  });
  if (current?.id) $('bLike').classList.toggle('loved', likedSet.has(current.id));
}

function paintLike(id, liked) {
  if (liked) likedSet.add(id);
  else likedSet.delete(id);
  paintLikedSet();
}

async function toggleLike(id, meta = {}) {
  vibe();
  if (!me) { openAuth('signin'); return null; }
  const next = !likedSet.has(id);
  paintLike(id, next);
  try {
    const r = await post('/api/like', { video_id: id, title: meta.title || '',
      thumbnail: meta.thumbnail || meta.thumb || '', duration: meta.duration ?? null });
    if (r.liked !== next) paintLike(id, r.liked);
    return r.liked;
  } catch (e) {
    paintLike(id, !next);
    toast('Like failed: ' + e.message);
    return null;
  }
}

function playNext(track) {
  if (!track?.id) return;
  queue.splice(qi + 1, 0, { ...track });
  toast(`Up next: ${(track.title || '').slice(0, 42)}`, true);
}

/* ---------- context menu ---------- */
let menuTrack = null;

function closeMenu() {
  const m = $('menu');
  if (m) m.hidden = true;
  menuTrack = null;
}

/* Anchors a popup menu to a button: below-right aligned, flips above
 * near the viewport bottom, clamped horizontally. Measured while live. */
function placeMenu(btn) {
  const m = $('menu');
  const r = btn.getBoundingClientRect();
  m.style.visibility = 'hidden';
  m.hidden = false;
  const mw = m.offsetWidth;
  const mh = m.offsetHeight;
  const x = Math.max(8, Math.min(window.innerWidth - mw - 8, r.right - mw));
  let y = r.bottom + 8;
  if (y + mh > window.innerHeight - 12) y = Math.max(8, r.top - mh - 8);
  m.style.left = `${Math.round(x)}px`;
  m.style.top = `${Math.round(y)}px`;
  m.style.visibility = '';
}

/* ---------- right-click / long-press menus (no dots buttons) ---------- */
let lpFired = false;

async function openTrackMenuAt(x, y, track) {
  closeMenu();
  menuTrack = track;
  const m = $('menu');
  const liked = likedSet.has(track.id);
  m.innerHTML = `
    <button data-m="like" class="${liked ? 'loved' : ''}">${ICO.heart}${liked ? 'Unlike' : 'Like'}</button>
    <button data-m="mp3">${ICO.download}Save MP3</button>
    <div class="sep"></div>
    <div class="mpl"><div class="mhead">…</div></div>
    <button data-m="newpl">${ICO.plus}New playlist…</button>`;
  const inList = (currentView === 'playlist' || currentView === 'liked')
    && document.querySelectorAll('#view .trow').length > 1
    && [...document.querySelectorAll('#view .trow [data-playrow]')].some((b) => b.dataset.playrow === track.id);
  if (inList) {
    m.insertAdjacentHTML('beforeend', `<div class="sep"></div>
      <button data-m="totop">${ICO.up}Move to top</button>
      <button data-m="tobottom">${ICO.down}Move to bottom</button>`);
  }
  if (track.item_id && currentView === 'playlist') {
    m.insertAdjacentHTML('beforeend',
      `<div class="sep"></div><button data-m="unpl">${ICO.x}Remove from playlist</button>`);
  }
  const mw = 228;
  m.style.visibility = 'hidden';
  m.hidden = false;
  const w = m.offsetWidth || mw;
  const h = m.offsetHeight || 300;
  m.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, x - 24)))}px`;
  let top = y + 10;
  if (top + h > window.innerHeight - 12) top = Math.max(8, y - h - 10);
  m.style.top = `${Math.round(top)}px`;
  m.style.visibility = '';
  m.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => menuAction(b.dataset.m)));
  // fill playlists (or sign-in nudge)
  const box = m.querySelector('.mpl');
  if (!me) {
    box.innerHTML = '<button data-m="auth">Sign in for playlists</button>';
    box.querySelector('button').addEventListener('click', () => menuAction('auth'));
    return;
  }
  try {
    const cached = swrGet('/api/playlists');
    if (cached && cached.playlists && cached.playlists.length) {
      box.innerHTML = '';
      cached.playlists.forEach((p) => {
        const b = document.createElement('button');
        b.innerHTML = `${(p.custom_cover || p.cover) ? `<img src="${p.custom_cover || p.cover}" alt="" />` : ICO.music}<span class="nm">${escapeHtml(p.name)}</span>`;
        b.addEventListener('click', async () => {
          closeMenu();
          try {
            await post(`/api/playlists/${p.id}/tracks`, { video_id: track.id, title: track.title || '',
              thumbnail: track.thumbnail || '', duration: track.duration ?? null });
            if (currentView === 'playlist' && String(viewArg) === String(p.id)) renderPlaylist($('view'), viewArg);
          } catch (e) { toast('Add failed: ' + e.message); }
          refreshCounts();
        });
        box.appendChild(b);
      });
    }
    const j = await api(`/api/playlists?has=${encodeURIComponent(track.id)}`);
    if (menuTrack !== track) return; // menu moved on
    box.innerHTML = j.playlists.length ? '' : plEmptyHTML();
    j.playlists.forEach((p) => {
      const b = document.createElement('button');
      b.className = p.has_item ? 'inpl' : '';
      b.title = p.has_item ? 'In this playlist — click to remove' : 'Add to playlist';
      b.innerHTML = `${(p.custom_cover || p.cover) ? `<img src="${p.custom_cover || p.cover}" alt="" />` : ICO.music}<span class="nm">${escapeHtml(p.name)}</span>${p.has_item ? `<span class="ck">${ICO.check}</span>` : ''}`;
      b.addEventListener('click', async () => {
        closeMenu();
        try {
          if (p.has_item) {
            await req('DELETE', `/api/playlist-items/${p.has_item}`);
            toast(`Removed from ${p.name}`);
            if (currentView === 'playlist' && String(viewArg) === String(p.id)) renderPlaylist($('view'), viewArg);
          } else {
            await post(`/api/playlists/${p.id}/tracks`, { video_id: track.id, title: track.title || '',
              thumbnail: track.thumbnail || '', duration: track.duration ?? null });
            if (currentView === 'playlist' && String(viewArg) === String(p.id)) renderPlaylist($('view'), viewArg);
          }
        } catch (e) { toast((p.has_item ? 'Remove' : 'Add') + ' failed: ' + e.message); }
        refreshCounts();
      });
      box.appendChild(b);
    });
  } catch { box.innerHTML = ''; }
}

async function menuAction(kind) {
  const t = menuTrack;
  closeMenu(); // modal sits below the menu layer — never stack them
  if (!t) return;
  if (kind === 'like') {
    const wasLiked = likedSet.has(t.id);
    const liked = await toggleLike(t.id, t);
    if (liked === false && currentView === 'liked') renderLiked($('view'));
    return;
  }
  if (kind === 'mp3') {
    window.open(`/api/mp3?v=${t.id}`, '_blank');
    return;
  }
  else if (kind === 'totop' || kind === 'tobottom') {
    const row = [...document.querySelectorAll('#view .trow')]
      .find((r) => r.querySelector('[data-playrow]')?.dataset.playrow === t.id);
    moveRowTo(row, kind === 'totop' ? 'top' : 'bottom');
  }
  else if (kind === 'next') playNext(t);
  else if (kind === 'copy') {
    try {
      await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${t.id}`);
      toast('Link copied', true);
    } catch { toast('Copy blocked by browser'); }
  } else if (kind === 'auth') openAuth('signin');
  else if (kind === 'newpl') openPlModal(t);
  else if (kind === 'unpl') {
    // Resolve the item id three ways: menu track, current list, fresh fetch.
    let itemId = t.item_id ?? viewQueue.find((r) => r.id === t.id)?.item_id;
    if (!itemId && currentView === 'playlist') {
      try {
        const det = await api(`/api/playlists/${viewArg}/tracks`);
        itemId = det.tracks.find((r) => r.id === t.id)?.item_id;
      } catch {}
    }
    if (!itemId) return;
    // Match rows by VIDEO id (always rendered), never by internal item id.
    const sel = `#view .trow [data-playrow="${t.id}"]`;
    const rows = [...document.querySelectorAll('#view .trow')].filter((r) =>
      r.querySelector('[data-playrow]')?.dataset.playrow === t.id);
    let gone = false;
    const killRows = () => {
      if (gone) return;
      gone = true;
      rows.forEach((r) => { try { r.remove(); } catch {} });
      viewQueue = viewQueue.filter((x) => x.id !== t.id);
      if (!document.querySelector('#view .trow')) renderPlaylist($('view'), viewArg);
    };
    const verifyGone = () => {
      // Anything with this video id still on screen → reconcile with server.
      if (document.querySelector(sel)) renderPlaylist($('view'), viewArg);
    };
    try {
      await req('DELETE', `/api/playlist-items/${itemId}`);
      refreshCounts();
      const row = rows[0];
      if (row) {
        const cs = getComputedStyle(row);
        const h = row.offsetHeight;
        row.style.overflow = 'hidden';
        try {
          const anim = row.animate([
            { opacity: 1, transform: 'translateX(0)', height: `${h}px`,
              paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom,
              marginTop: cs.marginTop, marginBottom: cs.marginBottom },
            { opacity: 0, transform: 'translateX(48px)', height: '0px',
              paddingTop: '0px', paddingBottom: '0px',
              marginTop: '0px', marginBottom: '0px' },
          ], { duration: 450, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'forwards' });
          anim.onfinish = killRows;
          setTimeout(killRows, 800); // animation be damned — the rows go
          setTimeout(verifyGone, 1500);
        } catch {
          killRows();
          setTimeout(verifyGone, 600);
        }
      } else {
        killRows();
      }
    } catch {}
  }
}

/* Custom context menu everywhere: song → track menu, row → track menu,
 * anywhere else → global transport menu. Native menu never appears. */
function openGlobalMenu(x, y) {
  closeMenu();
  const m = $('menu');
  const playing = current && !audio.paused && audio.src;
  m.innerHTML = `
    <button data-g="toggle">${playing ? ICO.pause : ICO.play}${playing ? 'Pause' : 'Play'}</button>
    <button data-g="next">${ICO.next}Next track</button>
    <div class="sep"></div>
    <button data-g="home">${ICO.home}Home</button>`;
  const mw = 228;
  m.style.visibility = 'hidden';
  m.hidden = false;
  const w = m.offsetWidth || mw;
  const h = m.offsetHeight || 200;
  m.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, x - 24)))}px`;
  let top = y + 10;
  if (top + h > window.innerHeight - 12) top = Math.max(8, y - h - 10);
  m.style.top = `${Math.round(top)}px`;
  m.style.visibility = '';
  m.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.g;
    closeMenu();
    if (k === 'toggle') {
      if (!audio.src) return;
      if (audio.paused) doPlay();
      else doPause();
    } else if (k === 'next') step(1)();
    else if (k === 'home') showHome();
    else if (k === 'foryou') {
      if (!me) openAuth('signin');
      else showView('foryou');
    }
  }));
}

/* Playlist menu: open or delete (two taps to confirm). */
function openPlaylistMenu(x, y, pid, name) {
  closeMenu();
  const m = $('menu');
  m.innerHTML = `
    <button data-p="open">${ICO.play}Open</button>
    <button data-p="share">${ICO.link}Share</button>
    <button data-p="del">${ICO.trash}Delete</button>`;
  m.style.visibility = 'hidden';
  m.hidden = false;
  const w = m.offsetWidth || 228;
  const h = m.offsetHeight || 120;
  m.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, x - 24)))}px`;
  let top = y + 10;
  if (top + h > window.innerHeight - 12) top = Math.max(8, y - h - 10);
  m.style.top = `${Math.round(top)}px`;
  m.style.visibility = '';
  m.querySelector('[data-p="open"]').addEventListener('click', () => {
    closeMenu();
    showView('playlist', pid);
  });
  m.querySelector('[data-p="share"]').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const p = playlistById(pid);
    const handle = meHandle();
    const slug = (p && p.slug) || String(pid);
    const btn = m.querySelector('[data-p="share"]');
    if (!handle || !slug || !btn) return;
    const url = `${location.origin}${plPath(handle, slug)}`;
    btn.innerHTML = `${ICO.check}Copied`;
    btn.classList.add('ok');
    await writeClip(url);
  });
  const del = m.querySelector('[data-p="del"]');
  del.addEventListener('click', async () => {
    if (!del.classList.contains('armed')) {
      del.classList.add('armed');
      del.innerHTML = `${ICO.trash}Delete “${escapeHtml((name || '').slice(0, 24))}”?`;
      setTimeout(() => { if (del.isConnected) { del.classList.remove('armed'); del.innerHTML = `${ICO.trash}Delete`; } }, 2600);
      return;
    }
    try {
      await req('DELETE', `/api/playlists/${pid}`);
      closeMenu();
      refreshCounts();
      try {
        await removeSheetPlaylist(pid);
      } catch {}
      if (currentView === 'playlist' && viewArg === pid) showHome();
    } catch {}
  });
}

document.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // native menu never appears
  if (e.target.closest('.fr-chat, .chat-round-rec, #modalWrap')) return;
  const pl = e.target.closest('#plList .pl, #sheetPl .sheet-row');
  if (pl) {
    const pid = +(pl.dataset.pl || pl.dataset.pid);
    const nm = pl.querySelector('.nm')?.textContent || '';
    if (pid) openPlaylistMenu(e.clientX, e.clientY, pid, nm);
    return;
  }
  const card = e.target.closest('[data-play]');
  if (card) {
    openTrackMenuAt(e.clientX, e.clientY, trackMeta(card.dataset.play, card));
    return;
  }
  const row = e.target.closest('.trow');
  if (row) {
    const id = row.querySelector('[data-playrow]')?.dataset.playrow;
    if (id) openTrackMenuAt(e.clientX, e.clientY, rowTrack(row, id));
    return;
  }
  openGlobalMenu(e.clientX, e.clientY);
});

/* Mobile: press-and-hold a song card / row for the same menu. */
let lpTimer = 0;
document.addEventListener('touchstart', (e) => {
  const card = e.target.closest('[data-play]');
  const row = e.target.closest('.trow');
  const plr = e.target.closest('#sheetPl .sheet-row');
  if (!card && !row && !plr) return;
  clearTimeout(lpTimer);
  const t = e.touches[0];
  lpTimer = setTimeout(() => {
    lpFired = true;
    try { navigator.vibrate?.(15); } catch {}
    if (plr && plr.dataset.pid) {
      openPlaylistMenu(t.clientX, t.clientY, +plr.dataset.pid,
        plr.querySelector('.nm')?.textContent || '');
    } else if (card) openTrackMenuAt(t.clientX, t.clientY, trackMeta(card.dataset.play, card));
    else if (row) {
      const id = row.querySelector('[data-playrow]')?.dataset.playrow;
      if (id) openTrackMenuAt(t.clientX, t.clientY, rowTrack(row, id));
    }
  }, 550);
}, { passive: true });
document.addEventListener('touchmove', () => clearTimeout(lpTimer), { passive: true });
// Once a touch reorder is flying, keep the page from stealing the gesture.
document.addEventListener('touchmove', (e) => {
  if (drag && (drag.active || (drag.touch && drag.armed))) e.preventDefault();
}, { passive: false });
document.addEventListener('touchend', () => clearTimeout(lpTimer));

/* Dedicated add-to-playlist picker (the + button in the player bar). */
async function openPlPicker(btn, track) {
  closeMenu();
  menuTrack = track;
  const m = $('menu');
  m.innerHTML = `<div class="mhead">Add to playlist</div><div class="mpl"><div class="mhead">…</div></div>
    <button data-m="newpl">${ICO.plus}New playlist…</button>`;
  placeMenu(btn);
  m.querySelector('[data-m="newpl"]').addEventListener('click', () => menuAction('newpl'));
  const box = m.querySelector('.mpl');
  const paintPls = (j) => {
    if (!j || !j.playlists) return;
    if (!j.playlists.length) {
      box.innerHTML = plEmptyHTML();
      return;
    }
    box.innerHTML = '';
    j.playlists.forEach((p) => {
      const b = document.createElement('button');
      b.innerHTML = `${(p.custom_cover || p.cover) ? `<img src="${p.custom_cover || p.cover}" alt="" />` : ICO.music}<span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</span>`;
      b.addEventListener('click', async () => {
        try {
          await post(`/api/playlists/${p.id}/tracks`, { video_id: track.id,
            title: track.title || '', thumbnail: track.thumbnail || '',
            duration: track.duration ?? null });
          closeMenu();
          refreshCounts();
        } catch (err) {
          toast('Could not add: ' + ((err && err.message) || err));
        }
      });
      box.appendChild(b);
    });
  };
  try {
    paintPls(swrGet('/api/playlists'));
    const j = await api('/api/playlists');
    if (menuTrack !== track) return;
    swrPut('/api/playlists', j);
    paintPls(j);
  } catch {
    if (!box.innerHTML || box.querySelector('.mhead')) box.innerHTML = '';
  }
}

/* ---------- custom playlist covers + mini editor ---------- */
let coverPid = null;
let coverKind = 'playlist';

/* Swap only the playlist artwork — the incoming image pins exactly over the
 * old one, crossfades, then takes its place. The song list underneath never
 * re-renders, so no entrance animations replay. */
function swapDetailCover(url) {
  try {
    const vcover = document.querySelector('#view .vcover');
    if (!vcover || !url) return;
    const old = vcover.querySelector('img');
    const next = document.createElement('img');
    next.alt = '';
    next.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(1.05)';
    next.onload = () => {
      vcover.prepend(next);
      requestAnimationFrame(() => {
        next.style.transition = 'opacity 650ms cubic-bezier(0.22,1,0.36,1), transform 750ms cubic-bezier(0.22,1,0.36,1)';
        next.style.opacity = '1';
        next.style.transform = 'scale(1)';
      });
      setTimeout(() => {
        old?.remove();
        next.style.cssText = '';
      }, 750);
    };
    next.onerror = () => next.remove();
    next.src = url;
  } catch {}
}

function openCoverEditor(file) {
  const url = URL.createObjectURL(file);
  const heading = coverKind === 'avatar' ? 'Profile photo' : 'Playlist cover';
  const isAv = coverKind === 'avatar';
  openModal(`
    <h2>${heading}</h2>
    <p class="msub cov-hint">Drag to move · pinch or slide to zoom</p>
    <div class="cov-stage${isAv ? ' round' : ''}" id="covStage">
      <img id="covImg" alt="" draggable="false" />
    </div>
    <div class="cov-modes" id="covModes">
      <button type="button" class="cov-mode on" data-mode="fill">Fill</button>
      <button type="button" class="cov-mode" data-mode="fit">Fit</button>
    </div>
    <div class="cov-brow" title="Zoom"><svg width="17" height="17" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg><input type="range" class="cov-zoom" id="covZoom" min="1" max="3" step="0.01" value="1" /></div>
    <div class="merr" id="covErr"></div>
    <div class="mrow">
      <button class="mbtn ghost" id="covCancel">Cancel</button>
      <button class="mbtn primary" id="covSave">Save</button>
    </div>`);
  const img = $('covImg');
  const stage = $('covStage');
  const zoomEl = $('covZoom');
  let nw = 0, nh = 0;
  let mode = 'fill';
  let zoom = 1;
  let ox = 0, oy = 0;
  const pointers = new Map();
  let drag = null;

  const layout = () => {
    if (!nw || !nh) return null;
    const W = stage.clientWidth;
    const H = stage.clientHeight || W;
    const base = mode === 'fill'
      ? Math.max(W / nw, H / nh)
      : Math.min(W / nw, H / nh);
    const sc = base * zoom;
    const dw = nw * sc;
    const dh = nh * sc;
    if (mode === 'fill') {
      const maxX = Math.max(0, (dw - W) / 2);
      const maxY = Math.max(0, (dh - H) / 2);
      ox = Math.min(maxX, Math.max(-maxX, ox));
      oy = Math.min(maxY, Math.max(-maxY, oy));
    } else {
      const maxX = Math.max(0, (dw - W) / 2) + 24;
      const maxY = Math.max(0, (dh - H) / 2) + 24;
      ox = Math.min(maxX, Math.max(-maxX, ox));
      oy = Math.min(maxY, Math.max(-maxY, oy));
    }
    return { W, H, dw, dh, sc, left: (W - dw) / 2 + ox, top: (H - dh) / 2 + oy };
  };

  const paint = () => {
    const L = layout();
    if (!L) return;
    img.style.left = `${L.left}px`;
    img.style.top = `${L.top}px`;
    img.style.width = `${L.dw}px`;
    img.style.height = `${L.dh}px`;
  };

  const resetView = () => {
    zoom = 1;
    ox = 0;
    oy = 0;
    if (zoomEl) zoomEl.value = '1';
    paint();
  };

  img.addEventListener('load', () => {
    nw = img.naturalWidth;
    nh = img.naturalHeight;
    if (!nw || !nh) return;
    resetView();
  });
  img.addEventListener('error', () => {
    try {
      const err = $('covErr');
      if (err) err.textContent = 'Could not read that image (HEIC from iPhone camera often fails). Try a JPG/PNG screenshot instead.';
    } catch {}
  });
  img.src = url;

  document.querySelectorAll('#covModes .cov-mode').forEach((b) => {
    b.addEventListener('click', () => {
      mode = b.dataset.mode;
      document.querySelectorAll('#covModes .cov-mode').forEach((x) => x.classList.toggle('on', x === b));
      resetView();
    });
  });
  zoomEl.addEventListener('input', () => {
    zoom = Math.max(1, +zoomEl.value || 1);
    paint();
  });

  stage.addEventListener('pointerdown', (e) => {
    if (!nw) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const p = [...pointers.values()];
      drag = {
        kind: 'pinch',
        d: Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)),
        z: zoom, ox, oy,
      };
    } else {
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, ox, oy };
    }
    try { stage.setPointerCapture(e.pointerId); } catch {}
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !drag) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const p = [...pointers.values()];
      const d = Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y));
      if (drag.kind !== 'pinch') {
        drag = { kind: 'pinch', d, z: zoom, ox, oy };
      }
      zoom = Math.min(3, Math.max(1, drag.z * d / drag.d));
      if (zoomEl) zoomEl.value = String(zoom);
      paint();
      return;
    }
    if (drag.kind === 'pan') {
      ox = drag.ox + (e.clientX - drag.x);
      oy = drag.oy + (e.clientY - drag.y);
      paint();
    }
  });
  const endP = (e) => {
    if (e && e.pointerId != null) pointers.delete(e.pointerId);
    if (pointers.size === 0) drag = null;
    else if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      drag = { kind: 'pan', x: p.x, y: p.y, ox, oy };
    }
  };
  stage.addEventListener('pointerup', endP);
  stage.addEventListener('pointercancel', endP);

  $('covCancel').addEventListener('click', () => { URL.revokeObjectURL(url); closeModal(); });
  $('covSave').addEventListener('click', () => {
    const pid = coverPid;
    const kind = coverKind;
    const errBox = $('covErr');
    try {
      if (kind !== 'avatar' && !pid) { if (errBox) errBox.textContent = 'No playlist selected.'; return; }
      const L = layout();
      if (!L || !nw) { if (errBox) errBox.textContent = 'Image still loading — wait a second and try again.'; return; }
      const S = 512;
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#0a0a0b';
      cx.fillRect(0, 0, S, S);
      const scale = nw / L.dw;
      const sx = -L.left * scale;
      const sy = -L.top * scale;
      const ss = L.W * scale;
      const srcX = Math.max(0, sx);
      const srcY = Math.max(0, sy);
      const srcR = Math.min(nw, sx + ss);
      const srcB = Math.min(nh, sy + ss);
      const srcW = Math.max(1, srcR - srcX);
      const srcH = Math.max(1, srcB - srcY);
      const dstX = ((srcX - sx) / ss) * S;
      const dstY = ((srcY - sy) / ss) * S;
      const dstW = (srcW / ss) * S;
      const dstH = (srcH / ss) * S;
      cx.drawImage(img, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH);
      cv.toBlob(async (blob) => {
        if (!blob) { if (errBox) errBox.textContent = 'Could not process image.'; return; }
        try {
          const endpoint = kind === 'avatar' ? '/api/me/avatar' : `/api/playlists/${pid}/cover`;
          const r = await fetch(endpoint, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'image/jpeg' }, body: blob });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || r.status);
          URL.revokeObjectURL(url);
          if (kind === 'avatar') {
            if (j.user) me = j.user;
            else if (j.avatar) me = { ...me, avatar: j.avatar };
            applyTheme();
            // Crop replaced the settings modal — restore it, then celebrate.
            openSettings();
            const av = $('pfAv');
            if (av && me.avatar) {
              const img = av.querySelector('img');
              if (img) {
                img.style.opacity = '0';
                img.style.transition = 'opacity 380ms ease';
                img.src = me.avatar + (me.avatar.includes('?') ? '&' : '?') + 't=' + Date.now();
                requestAnimationFrame(() => { img.style.opacity = '1'; });
              }
            }
            popAvatarOk();
          } else {
            closeModal();
            if (currentView === 'playlist' && viewArg === pid) {
              swapDetailCover(j.custom_cover);
              refreshCounts();
            } else {
              refreshCounts();
            }
          }
        } catch (e) { if (errBox) errBox.textContent = 'Save failed: ' + (e.message || 'error'); }
      }, 'image/jpeg', 0.9);
    } catch (e) { if (errBox) errBox.textContent = 'Save failed: ' + (e.message || 'error'); }
  });
}
function openModal(html, mode) {
  $('modalBox').classList.remove('wide');
  $('modalWrap').classList.remove('sheet');
  if (mode === 'wide') $('modalBox').classList.add('wide');
  if (mode === 'sheet') $('modalWrap').classList.add('sheet');
  $('modalBox').innerHTML = html;
  $('modalWrap').hidden = false;
}
function closeModal() {
  $('modalWrap').hidden = true;
  $('modalBox').classList.remove('wide');
  $('modalWrap').classList.remove('sheet');
  try { delete $('modalWrap').dataset.stay; } catch {}
}

const DESK_SETUP = '/desktop/Muse-Setup.exe';
const APK_URL = '/android/Muse.apk?v=1.0.3';
const DESK_SEEN = 'muse:deskPrompt';
const APK_SEEN = 'muse:apkPrompt';

function deskPromptSeen() {
  try { return localStorage.getItem(DESK_SEEN) === '1'; } catch { return false; }
}
function markDeskPromptSeen() {
  try { localStorage.setItem(DESK_SEEN, '1'); } catch {}
}
function hideDeskPrompt() {
  const el = $('deskPrompt');
  if (el) el.hidden = true;
  markDeskPromptSeen();
}
function maybeDeskPrompt() {
  if (isDeskApp() || isAndroidApp() || isAndroidWeb() || deskPromptSeen()) return;
  if (document.body.classList.contains('onboarding')) return;
  if (document.getElementById('intro') || window.__museIntro !== 'done') return;
  const el = $('deskPrompt');
  if (!el || el.id !== 'deskPrompt' || !el.hidden) return;
  el.hidden = false;
}
function bindDeskPrompt() {
  const el = $('deskPrompt');
  if (!el || el.id !== 'deskPrompt' || el.dataset.bound === '1') return;
  if (isDeskApp() || isAndroidApp()) { el.remove(); return; }
  el.dataset.bound = '1';
  const close = () => hideDeskPrompt();
  $('deskClose')?.addEventListener('click', close);
  $('deskSkip')?.addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  $('deskDl')?.addEventListener('click', () => markDeskPromptSeen());
}
function apkPromptSeen() {
  try { return localStorage.getItem(APK_SEEN) === '1'; } catch { return false; }
}
function markApkPromptSeen() {
  try { localStorage.setItem(APK_SEEN, '1'); } catch {}
}
function hideApkPrompt() {
  const el = $('apkPrompt');
  if (el) el.hidden = true;
  markApkPromptSeen();
}
function maybeApkPrompt() {
  if (!isAndroidWeb() || isDeskApp() || isAndroidApp() || isIOS || apkPromptSeen()) return;
  if (document.body.classList.contains('onboarding')) return;
  if (document.getElementById('intro') || window.__museIntro !== 'done') return;
  if ($('deskPrompt') && !$('deskPrompt').hidden) return;
  const el = $('apkPrompt');
  if (!el || el.id !== 'apkPrompt' || !el.hidden) return;
  el.hidden = false;
}
function bindApkPrompt() {
  const el = $('apkPrompt');
  if (!el || el.id !== 'apkPrompt' || el.dataset.bound === '1') return;
  if (isDeskApp() || isAndroidApp() || isIOS) { el.remove(); return; }
  el.dataset.bound = '1';
  const close = () => hideApkPrompt();
  $('apkClose')?.addEventListener('click', close);
  $('apkSkip')?.addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  $('apkDl')?.addEventListener('click', () => markApkPromptSeen());
}
function maybeAppPrompts() {
  if (isAndroidWeb()) maybeApkPrompt();
  else maybeDeskPrompt();
}
function startFileDownload(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadWindowsApp() {
  markDeskPromptSeen();
  hideDeskPrompt();
  startFileDownload(DESK_SETUP, 'Muse-Setup.exe');
}
function downloadAndroidApp() {
  markApkPromptSeen();
  hideApkPrompt();
  startFileDownload(APK_URL, 'Muse.apk');
}

function popAvatarOk() {
  const av = $('pfAv');
  if (!av) return;
  av.classList.add('pf-pop');
  av.querySelector('.pf-check')?.remove();
  const ok = document.createElement('span');
  ok.className = 'pf-check';
  ok.innerHTML = ICO.check;
  av.appendChild(ok);
  setTimeout(() => {
    try {
      ok.remove();
      av.classList.remove('pf-pop');
    } catch {}
  }, 900);
}

function openAuth(tab = 'signin') {
  openModal(`
    <div class="mtabs">
      <button data-atab="signin" class="${tab === 'signin' ? 'on' : ''}">Sign in</button>
      <button data-atab="signup" class="${tab === 'signup' ? 'on' : ''}">Create account</button>
    </div>
    <h2 id="authTitle">${tab === 'signin' ? 'Welcome back' : 'Join Muse'}</h2>
    <p class="msub">Likes, playlists, and the songs you come back to.</p>
    <label class="fl">Username</label>
    <input type="text" id="aUser" maxlength="24" autocomplete="username" />
    <label class="fl">Password</label>
    <input type="password" id="aPass" autocomplete="current-password" />
    <div class="merr" id="aErr"></div>
    <div class="mrow">
      <button class="mbtn ghost" id="aCancel">Cancel</button>
      <button class="mbtn primary" id="aGo">${tab === 'signin' ? 'Sign in' : 'Create'}</button>
    </div>`);
  const box = $('modalBox');
  let mode = tab;
  box.querySelectorAll('[data-atab]').forEach((b) => b.addEventListener('click', () => openAuth(b.dataset.atab)));
  const submit = async () => {
    const err = $('aErr');
    err.textContent = '';
    try {
      const j = await post(mode === 'signin' ? '/api/login' : '/api/signup',
        { username: $('aUser').value.trim(), password: $('aPass').value });
      me = j.user;
      applyTheme();
      closeModal();
      await refreshMe();
      await refreshCounts();
      toast(`Welcome, ${me.display}`, true);
      hideOnboard();
      homeFyKey = '';
      if (pendingTake) {
        const t = pendingTake;
        pendingTake = null;
        await takeSharedPlaylist(t.handle, t.slug);
      } else {
        if (currentView === 'home') loadHomeFy();
        if (['foryou', 'liked', 'playlist', 'shared'].includes(currentView)) showView(currentView, viewArg);
      }
    } catch (e) { err.textContent = e.message; }
  };
  $('aGo').addEventListener('click', submit);
  $('aCancel').addEventListener('click', closeModal);
  $('aPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  $('aUser').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => $('aUser').focus(), 60);
}

function onboarded() {
  try { return localStorage.getItem('muse:onboarded') === '1'; } catch { return false; }
}
function markOnboarded() {
  try { localStorage.setItem('muse:onboarded', '1'); } catch {}
}

let onboardMode = 'signup';
function paintOnboard(mode) {
  onboardMode = mode;
  const signup = mode === 'signup';
  $('obTitle').textContent = signup ? 'Your music starts here' : 'Welcome back';
  $('obSub').textContent = signup
    ? 'Create an account to save likes and playlists. Then press play.'
    : 'Sign in to pick up your likes and playlists.';
  $('obGo').textContent = signup ? 'Create account' : 'Sign in';
  $('obSwitch').textContent = signup ? 'I already have one' : 'Create an account';
  $('obPass').autocomplete = signup ? 'new-password' : 'current-password';
  $('obErr').textContent = '';
}

function paintOnboardArts(tracks) {
  const box = $('obArts');
  if (!box || box.dataset.ready === '1') return;
  const list = (tracks || []).filter((t) => t && t.thumbnail).slice(0, 5);
  if (list.length < 3) return;
  box.innerHTML = list.map((t, i) =>
    `<img src="${ytThumb(t.id, t.thumbnail)}" alt="" style="--i:${i}"
      onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${t.id}/mqdefault.jpg'" />`).join('');
  box.dataset.ready = '1';
}

function showOnboard() {
  const el = $('onboard');
  if (!el) return;
  if (el.hidden) paintOnboard('signup');
  el.hidden = false;
  document.body.classList.add('onboarding');
  try {
    const saved = JSON.parse(localStorage.getItem('muse:popular') || 'null');
    if (saved?.tracks) paintOnboardArts(saved.tracks);
  } catch {}
  api('/api/popular?n=12').then((j) => {
    if (j?.tracks) paintOnboardArts(j.tracks);
  }).catch(() => {});
  setTimeout(() => { try { $('obUser').focus(); } catch {} }, 420);
}

function hideOnboard() {
  const el = $('onboard');
  markOnboarded();
  if (!el || el.hidden) return;
  el.classList.add('out');
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove('out');
    document.body.classList.remove('onboarding');
    maybeAppPrompts();
  }, 420);
}

async function submitOnboard() {
  if (submitOnboard.busy) return;
  const err = $('obErr');
  const go = $('obGo');
  err.textContent = '';
  submitOnboard.busy = true;
  go.disabled = true;
  try {
    const j = await post(onboardMode === 'signin' ? '/api/login' : '/api/signup',
      { username: $('obUser').value.trim(), password: $('obPass').value });
    me = j.user;
    applyTheme();
    hideOnboard();
    await refreshMe();
    await refreshCounts();
    toast(`Welcome, ${me.display}`, true);
    homeFyKey = '';
    if (currentView === 'home') loadHomeFy();
  } catch (e) { err.textContent = e.message; }
  finally {
    submitOnboard.busy = false;
    go.disabled = false;
  }
}

function bindOnboard() {
  const el = $('onboard');
  if (!el || el.dataset.bound) return;
  el.dataset.bound = '1';
  $('obGo').addEventListener('click', submitOnboard);
  $('obSwitch').addEventListener('click', () => paintOnboard(onboardMode === 'signup' ? 'signin' : 'signup'));
  $('obPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitOnboard(); });
  $('obUser').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitOnboard(); });
}

function maybeOnboard() {
  if (me || onboarded()) return;
  bindOnboard();
  showOnboard();
}

function openPlModal(pending = null) {
  // No naming step: playlists are born numbered (Плейлист 1, 2, …),
  // rename later with the pencil whenever you like.
  if (!me) { openAuth('signin'); return; }
  createPlaylistNow(pending);
}

function makeSheetRow(p, { animate = false } = {}) {
  const b = document.createElement('button');
  b.className = 'sheet-row' + (animate ? ' fresh' : '');
  b.dataset.pid = p.id;
  b.innerHTML = `${(p.custom_cover || p.cover) ? `<img src="${p.custom_cover || p.cover}" alt="" />` : `<span class="ph">${escapeHtml(((p.name || '#')[0] || '#').toUpperCase())}</span>`}
    <span class="nm">${escapeHtml(p.name)}</span>`;
  b.addEventListener('click', () => {
    closeLibrary();
    showView('playlist', p.id);
  });
  return b;
}

function sheetCardEl() {
  return document.querySelector('#sheet .sheet-card');
}

function nudgeSheetToContent(fromH) {
  const card = sheetCardEl();
  if (!card) return;
  const max = Math.round(window.innerHeight * 0.72);
  const to = Math.min(Math.ceil(card.scrollHeight), max);
  const from = Math.round(fromH);
  if (Math.abs(to - from) < 2) {
    card.style.height = '';
    card.style.overflow = '';
    card.classList.remove('sheet-nudge');
    return false;
  }
  card.classList.add('sheet-nudge');
  card.style.height = `${from}px`;
  card.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    card.style.transition = 'height 360ms cubic-bezier(0.22,1,0.36,1)';
    card.style.height = `${to}px`;
  });
  const clear = () => {
    card.style.height = '';
    card.style.transition = '';
    card.style.overflow = '';
    card.classList.remove('sheet-nudge');
  };
  const onEnd = (e) => {
    if (e && e.propertyName && e.propertyName !== 'height') return;
    card.removeEventListener('transitionend', onEnd);
    clear();
  };
  card.addEventListener('transitionend', onEnd);
  setTimeout(clear, 420);
  return true;
}

function appendSheetPlaylist(p) {
  const box = $('sheetPl');
  if (!box) return null;
  const card = sheetCardEl();
  const from = card ? card.getBoundingClientRect().height : 0;
  if (card) {
    card.classList.add('sheet-nudge');
    card.style.height = `${Math.round(from)}px`;
    card.style.overflow = 'hidden';
  }
  const empty = box.querySelector('.vempty');
  if (empty) empty.remove();
  const b = makeSheetRow(p, { animate: true });
  box.appendChild(b);
  const grew = card ? nudgeSheetToContent(from) : false;
  if (!grew) {
    try { b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
  }
  setTimeout(() => { try { b.classList.remove('fresh'); } catch {} }, 450);
  return b;
}

async function removeSheetPlaylist(pid) {
  const srow = document.querySelector(`#sheetPl [data-pid="${pid}"]`);
  const desk = document.querySelector(`#plList [data-pl="${pid}"]`);
  if (desk) {
    desk.style.transition = 'opacity 250ms ease, transform 250ms ease';
    desk.style.opacity = '0';
    desk.style.transform = 'translateY(8px)';
    setTimeout(() => { try { desk.remove(); } catch {} }, 260);
  }
  if (!srow) return;
  const card = sheetCardEl();
  const from = card ? card.getBoundingClientRect().height : 0;
  if (card) {
    card.classList.add('sheet-nudge');
    card.style.height = `${Math.round(from)}px`;
    card.style.overflow = 'hidden';
  }
  srow.classList.add('leaving');
  await new Promise((r) => setTimeout(r, 240));
  try { srow.remove(); } catch {}
  const box = $('sheetPl');
  if (box && !box.querySelector('.sheet-row')) {
    box.innerHTML = '<div class="vempty">No playlists yet — make one.</div>';
  }
  if (card) nudgeSheetToContent(from);
}

async function createPlaylistNow(pending = null) {
  try {
    const p = await post('/api/playlists', { name: '' });
    if (pending?.id) {
      await post(`/api/playlists/${p.id}/tracks`, { video_id: pending.id,
        title: pending.title || '', thumbnail: pending.thumbnail || '',
        duration: pending.duration ?? null });
    }
    await refreshCounts();
    const row = document.querySelector(`#plList [data-pl="${p.id}"]`);
    if (row) {
      row.classList.add('fresh');
      setTimeout(() => row.classList.remove('fresh'), 420);
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    try {
      if (isPhone()) {
        const sh = $('sheet');
        if (sh && !sh.hidden) {
          try { vibe(12); } catch {}
          appendSheetPlaylist(p);
        } else {
          await openLibrary();
          const srow = document.querySelector(`#sheetPl [data-pid="${p.id}"]`);
          if (srow) {
            srow.classList.add('fresh');
            try { srow.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
            setTimeout(() => { try { srow.classList.remove('fresh'); } catch {} }, 450);
          }
        }
      }
    } catch {
      if (isPhone() && $('sheet') && !$('sheet').hidden) appendSheetPlaylist(p);
    }
  } catch {}
}

/* Hard refresh: nuke service workers + caches, then reload truly fresh. */
async function hardRefresh() {
  try { sessionStorage.setItem('muse:fresh', '1'); } catch {}
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}
  location.reload();
}

function rowTrack(rowEl, id) {
  return viewQueue.concat(queue, results).find((r) => r.id === id) || {
    id, title: rowEl.querySelector('.tt')?.getAttribute('title') || '',
    thumbnail: rowEl.querySelector('img')?.src || '' };
}

document.addEventListener('click', (e) => {
  if (justTapPlayed() && !e.target.closest('[data-like], .likedot, #bLike, #bAdd')) return;
  if (lpFired) {
    lpFired = false;
    return;
  } // long-press ghost click
  if (justDropped()) return; // reorder drop ghost click
  const t = (sel) => e.target.closest(sel);
  let el;
  if ((el = t('[data-like]'))) {
    const row = el.closest('.trow');
    toggleLike(el.dataset.like, row ? rowTrack(row, el.dataset.like) : (trackMeta(el.dataset.like) || {})).then(() => {
      if (currentView === 'liked' && !likedSet.has(el.dataset.like)) {
        el.closest('.trow')?.remove();
        if (!document.querySelector('#view .trow')) renderLiked($('view'));
      }
    }).catch(() => {});
    return;
  }
  if ((el = t('[data-playrow]'))) {
    const row = el.closest('.trow');
    playId(el.dataset.playrow, rowTrack(row, el.dataset.playrow), viewQueue, currentView);
    return;
  }
  if ((el = t('[data-playall]'))) {
    if (el.classList.contains('playing')) { doPause(); return; }
    if (isOurQueue() && current?.id && viewQueue.some((t) => t.id === current.id)) { doPlay(); return; }
    if (viewQueue.length) playId(viewQueue[0].id, viewQueue[0], viewQueue, currentView);
    return;
  }
  if ((el = t('[data-fyplay]'))) {
    if (el.classList.contains('playing')) { doPause(); return; }
    const cards = [...document.querySelectorAll('#fyGrid .card')].map((c) => c.dataset.play);
    const list = cards.map((id) => viewQueue.find((r) => r.id === id)).filter(Boolean);
    if (isOurQueue() && current?.id && list.some((t) => t.id === current.id)) { doPlay(); return; }
    if (list.length) playId(list[0].id, list[0], list, 'foryou');
    else if (viewQueue.length) playId(viewQueue[0].id, viewQueue[0], viewQueue, currentView);
    return;
  }
  if ((el = t('[data-fyrefresh]'))) { renderForYou($('view')); return; }
  if ((el = t('[data-auth]'))) { openAuth('signin'); return; }
  if ((el = t('[data-openuser]'))) {
    const h = el.dataset.openuser;
    if (h) openPublic(h);
    return;
  }
  if ((el = t('[data-shareh]'))) {
    copyPlLink(el.dataset.shareh, el.dataset.shares, el.closest('.vshare-ic') || el);
    return;
  }
  if ((el = t('[data-takeh]'))) {
    takeSharedPlaylist(el.dataset.takeh, el.dataset.takes);
    return;
  }
  if ((el = t('[data-gohome]'))) {
    try { vibe(); } catch {}
    try { closeLibrary(); } catch {}
    showHome();
    if (!isPhone()) setTimeout(() => { try { $('q').focus({ preventScroll: true }); } catch { try { $('q').focus(); } catch {} } }, 80);
    return;
  }
  if ((el = t('[data-cover]'))) {
    e.preventDefault();
    const pid = +el.dataset.cover;
    if (!pid) return;
    coverKind = 'playlist';
    coverPid = pid;
    try { vibe(); } catch {}
    // Must fire synchronously inside the user gesture or mobile Safari blocks it.
    try { $('coverPick').click(); } catch {}
    return;
  }
  if ((el = t('[data-rename]'))) {
    const h = $('plName');
    if (!h || h.tagName !== 'H2') return; // already editing
    const input = document.createElement('input');
    input.className = 'vname';
    input.value = h.textContent;
    input.maxLength = 60;
    input.size = Math.min(26, Math.max(5, h.textContent.length + 2));
    h.replaceWith(input);
    input.focus();
    input.select();
    let saved = false;
    const save = async () => {
      if (saved || !input.isConnected) return;
      saved = true;
      const name = input.value.trim();
      const swapBack = (finalName) => {
        const h2 = document.createElement('h2');
        h2.id = 'plName';
        h2.textContent = finalName;
        input.replaceWith(h2);
      };
      if (name && name !== h.textContent) {
        try {
          const patched = await req('PATCH', `/api/playlists/${viewArg}`, { name });
          swapBack(name);
          refreshCounts();
          if (patched && patched.slug && meHandle()) setPath(plPath(meHandle(), patched.slug), true);
        } catch {
          swapBack(h.textContent);
        }
      } else {
        swapBack(h.textContent);
      }
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); });
    input.addEventListener('blur', save);
    return;
  }
});

/* ---------- drag-to-reorder playlist rows: grab ANYWHERE on the row ----------
 * Mouse: press + move. Touch: press, hold a beat (vibrate), then move —
 * so a normal swipe still scrolls the list instead of dragging. */
let drag = null;
let armTimer = 0;
let orderSave = Promise.resolve(); // reorder PATCHes run one at a time, in order
let lastDropAt = 0; // drops fire a ghost click — swallow it, don't start playback
const justDropped = () => Date.now() - lastDropAt < 400;

const SLIDE = 'transform 240ms cubic-bezier(0.22,1,0.36,1)';

document.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  const row = e.target.closest('#view .trow');
  if (!row || e.target.closest('button') || (currentView !== 'playlist' && currentView !== 'liked')) return;
  const isTouch = e.pointerType === 'touch';
  drag = { row, y0: e.clientY, lastY: e.clientY, active: false, ghost: null,
           armed: !isTouch, touch: isTouch, slot: -1 };
  clearTimeout(armTimer);
  if (isTouch) {
    armTimer = setTimeout(() => {
      if (!drag) return;
      drag.armed = true;
      try { navigator.vibrate?.(20); } catch {}
      drag.row.classList.add('armed');
    }, 320);
  }
});

/* Rows never move in the DOM mid-drag: positions are measured once, the
 * others slide with transforms to open a gap, and the DOM changes on drop. */
function startDrag() {
  const d = drag;
  d.active = true;
  closeMenu();
  const rows = [...document.querySelectorAll('#view .trow')];
  const sy = window.scrollY;
  d.from = rows.indexOf(d.row);
  d.others = rows.filter((r) => r !== d.row);
  d.mids = d.others.map((r) => { const b = r.getBoundingClientRect(); return b.top + sy + b.height / 2; });
  const rect = d.row.getBoundingClientRect();
  const next = rows[d.from + 1] || rows[d.from - 1];
  const gap = next ? Math.abs(next.getBoundingClientRect().top - rect.top) - rect.height : 0;
  d.step = rect.height + Math.max(0, gap);
  d.top0 = rect.top;
  d.h = rect.height;
  d.ghost = d.row.cloneNode(true);
  d.ghost.classList.add('drag-ghost');
  Object.assign(d.ghost.style, { width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top}px` });
  document.body.appendChild(d.ghost);
  d.row.classList.add('dragging');
  d.others.forEach((r) => { r.style.transition = SLIDE; });
  document.body.classList.add('reordering');
  try { navigator.vibrate?.(10); } catch {}
  d.raf = requestAnimationFrame(dragTick);
}

function placeGhost() {
  const d = drag;
  d.ghost.style.transform = `translateY(${d.lastY - d.y0}px) scale(1.025)`;
  const center = d.top0 + (d.lastY - d.y0) + window.scrollY + d.h / 2;
  let slot = 0;
  while (slot < d.mids.length && d.mids[slot] < center) slot++;
  if (slot === d.slot) return;
  d.slot = slot;
  d.others.forEach((r, k) => {
    const was = k < d.from ? k : k + 1;
    const now = k < slot ? k : k + 1;
    r.style.transform = was === now ? '' : `translateY(${(now - was) * d.step}px)`;
  });
}

// Edge auto-scroll: faster the closer the finger is to the edge.
function dragTick() {
  const d = drag;
  if (!d || !d.active) return;
  const edge = 90;
  const bottom = window.innerHeight - (document.body.classList.contains('has-player') ? 130 : 0);
  let v = 0;
  if (d.lastY < edge) v = -Math.ceil(((edge - d.lastY) / edge) * 18);
  else if (d.lastY > bottom - edge) v = Math.ceil(((d.lastY - (bottom - edge)) / edge) * 18);
  if (v) window.scrollBy(0, v);
  placeGhost();
  d.raf = requestAnimationFrame(dragTick);
}

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.touch && !drag.armed) return; // finger: still a maybe-scroll, hands off
  drag.lastY = e.clientY;
  if (!drag.active) {
    if (Math.abs(e.clientY - drag.y0) < 6) return;
    startDrag();
  }
  if (e.cancelable) e.preventDefault();
});

function finishDrag(commit) {
  clearTimeout(armTimer);
  const d = drag;
  drag = null;
  if (!d) return null;
  d.row.classList.remove('armed');
  if (!d.active) return null; // plain click on the row
  cancelAnimationFrame(d.raf);
  lastDropAt = Date.now();
  document.body.classList.remove('reordering');
  const ghostTop = d.ghost.getBoundingClientRect().top;
  d.ghost.remove();
  d.others.forEach((r) => { r.style.transition = 'none'; r.style.transform = ''; });
  const moved = commit && d.slot >= 0 && d.slot !== d.from;
  if (moved) {
    if (d.slot < d.others.length) d.others[d.slot].before(d.row);
    else d.others[d.others.length - 1].after(d.row);
  }
  void d.row.offsetHeight;
  d.others.forEach((r) => { r.style.transition = ''; });
  d.row.classList.remove('dragging');
  try {
    const dy = ghostTop - d.row.getBoundingClientRect().top;
    d.row.animate([
      { transform: `translateY(${dy}px) scale(1.025)`, background: 'rgba(255,255,255,0.08)' },
      { transform: 'none', background: 'rgba(255,255,255,0.05)', offset: 0.7 },
      { transform: 'none', background: 'transparent' },
    ], { duration: 420, easing: 'cubic-bezier(0.22,1,0.36,1)' });
  } catch {}
  return moved;
}

/* Move a row to the top/bottom with every row gliding to its new place. */
function moveRowTo(row, where) {
  const rows = [...document.querySelectorAll('#view .trow')];
  if (!row || rows.length < 2) return;
  if ((where === 'top' && rows[0] === row) || (where === 'bottom' && rows[rows.length - 1] === row)) return;
  const before = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]));
  if (where === 'top') rows[0].before(row);
  else rows[rows.length - 1].after(row);
  for (const r of rows) {
    const dy = before.get(r) - r.getBoundingClientRect().top;
    if (!dy) continue;
    try {
      r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: r === row ? 520 : 380, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    } catch {}
  }
  try {
    row.animate([{ background: 'rgba(255,255,255,0.08)' }, { background: 'transparent' }],
      { duration: 900, easing: 'ease-out' });
  } catch {}
  saveOrder();
}

async function endDragCommit() {
  if (finishDrag(true)) saveOrder();
}

function saveOrder() {
  const ids = [...document.querySelectorAll('#view .trow')].map((r) => r.dataset.row);
  const byItem = new Map(viewQueue.map((t) => [String(t.item_id ?? t.id), t]));
  viewQueue = ids.map((id) => byItem.get(String(id))).filter(Boolean);
  const url = currentView === 'liked'
    ? '/api/likes/order'
    : `/api/playlists/${viewArg}/order`;
  const payload = currentView === 'liked' ? { video_ids: ids } : { ids: ids.map(Number) };
  // Serialized: rapid successive drops queue behind each other instead of
  // racing (last-writer-wins with a stale order scrambled lists on reload).
  const view = currentView;
  const arg = viewArg;
  if (queueSource === view && (view !== 'playlist' || String(queuePid) === String(arg))
      && (view !== 'shared' || String(queuePid) === String(arg && arg.id))) {
    queue = viewQueue.slice();
    qi = queue.findIndex((t) => t.id === current?.id);
  }
  orderSave = orderSave.then(async () => {
    try {
      await req('PATCH', url, payload);
    } catch {
      if (currentView === view) {
        if (view === 'liked') renderLiked($('view'));
        else renderPlaylist($('view'), arg);
      }
    }
  });
}
document.addEventListener('pointerup', endDragCommit);
document.addEventListener('pointercancel', () => finishDrag(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag?.active) finishDrag(false); });

/* ---------- self-update notice ---------- */
async function checkUpdate() {
  try {
    const j = await (await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' })).json();
    if (j.build > (window.__museBuild || 0)) {
      if (document.getElementById('intro') || window.__museIntro !== 'done') return;
      try { sessionStorage.setItem('muse:updated', String(j.build)); } catch {}
      await hardRefresh();
    }
  } catch { /* offline — stay quiet */ }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!registerSW._p) {
    registerSW._p = navigator.serviceWorker.register('/sw.js').then((reg) => {
      try { tellWatch(); } catch {}
      return reg;
    }).catch(() => null);
    try {
      navigator.serviceWorker.addEventListener('message', (e) => {
        const d = (e && e.data) || {};
        if (d.type !== 'muse-notif-click') return;
        const h = String(d.handle || '').toLowerCase();
        if (h) openNotifChat(h);
        else if (d.url === '/market') showView('market');
        else openNotifChat('');
      });
    } catch {}
  }
  return registerSW._p;
}

/* ---------- Musely (desktop AI) ---------- */
const MUSELY_CLOSED = 'muse:muselyClosed';
const MUSELY_GOT = 'muse:muselyGot';
const MUSELY_STORE = 'muse:muselyHist';
const MUSELY_FRAME = { idle: 0, blink: 1, hop: 2, talk: 3, wave1: 4, wave2: 5, look: 6, wink: 7 };
const MUSELY_HIST_TURNS = 80;
const MUSELY_TURN_CHARS = 2000;
let muselyHist = [];
let muselyBusy = false;
let muselyMoodT = null;

function muselyHost() {
  try { return window.chrome && window.chrome.webview; } catch { return null; }
}

function muselyThinkDump(text) {
  const t = String(text || '');
  const low = t.toLowerCase();
  if (/thinking process|analyze user input|here's a thinking/.test(low)) return true;
  if (/^\s*1\.\s/.test(t) && t.includes('**')) return true;
  return false;
}

function muselyHistJunk(text) {
  const low = String(text || '').toLowerCase();
  if (muselyThinkDump(text)) return true;
  return /brain freeze|couldn't shape that|blank stare|ask me one more time/.test(low);
}

function muselyTracksFromText(text) {
  const t = String(text || '').trim();
  if (!t || t[0] === '{' || t[0] === '[') return [];
  if (/"mode"\s*:|"tracks"\s*:/.test(t)) return [];
  const lined = [];
  for (const ln of t.split(/\n+/)) {
    const m = ln.match(/^\s*(?:[-–—•*]|\d+[.)])\s+(.*\S)\s*$/);
    if (!m) continue;
    const q = m[1].replace(/^[\s\-–—•*]+/, '').trim().slice(0, 160);
    if (q.length >= 2 && !/[{}"]/.test(q)) lined.push({ title: (q.split(' - ')[0] || q).slice(0, 40), query: q });
  }
  if (lined.length >= 2) return lined.slice(0, 3);
  if (!/^[-–—•*]/.test(t) || (t.match(/ - /g) || []).length < 2) return lined.slice(0, 3);
  const parts = t.replace(/^[\s\-–—•*]+/, '').split(/\s+-\s+/).map((p) => p.replace(/^[\s\-–—•*]+/, '').trim()).filter((p) => p && !/[{}"]/.test(p));
  if (parts.length >= 3) {
    return parts.slice(0, 3).map((q) => ({ title: (q.split(' - ')[0] || q).slice(0, 40), query: q.slice(0, 160) }));
  }
  return lined.slice(0, 3);
}

function muselyCap(hist) {
  const out = [];
  const src = Array.isArray(hist) ? hist : [];
  for (const t of src.slice(-MUSELY_HIST_TURNS)) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant')) continue;
    const content = String(t.content || '').trim().slice(0, MUSELY_TURN_CHARS);
    if (!content) continue;
    if (t.role === 'assistant' && muselyHistJunk(content)) continue;
    out.push({ role: t.role, content });
  }
  return out;
}

function muselyPersist() {
  const hist = muselyCap(muselyHist);
  muselyHist = hist;
  try { localStorage.setItem(MUSELY_STORE, JSON.stringify(hist)); } catch {}
  const host = muselyHost();
  if (!host) return;
  try { host.postMessage(JSON.stringify({ type: 'musely-save', history: hist })); } catch {}
}

function muselyLoadHist() {
  return new Promise((resolve) => {
    const finish = (hist) => {
      muselyHist = muselyCap(hist);
      resolve();
    };
    const fromLs = () => {
      try { return JSON.parse(localStorage.getItem(MUSELY_STORE) || '[]'); }
      catch { return []; }
    };
    const seed = Array.isArray(window.__muselyChat) ? window.__muselyChat : fromLs();
    const host = muselyHost();
    if (!host) {
      finish(seed);
      return;
    }
    let settled = false;
    const done = (hist) => {
      if (settled) return;
      settled = true;
      try { host.removeEventListener('message', onMsg); } catch {}
      const fileHist = muselyCap(hist);
      const next = fileHist.length ? fileHist : muselyCap(seed);
      finish(next);
    };
    const onMsg = (e) => {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (d && d.type === 'musely-chat') done(d.history || []);
      } catch {}
    };
    try { host.addEventListener('message', onMsg); } catch {}
    try { host.postMessage(JSON.stringify({ type: 'musely-load' })); }
    catch { done(seed); return; }
    setTimeout(() => done(seed), 900);
  });
}

function muselyFrame(name) {
  const sp = $('muselySprite');
  if (!sp) return;
  const i = MUSELY_FRAME[name] || 0;
  sp.dataset.mood = name;
  sp.style.backgroundPosition = `${-i * 72}px 0`;
}

function muselyMood(name, ms) {
  const root = $('musely');
  const sp = $('muselySprite');
  if (!root) return;
  clearTimeout(muselyMoodT);
  muselyMoodT = null;
  root.classList.remove('is-talk', 'is-wave');
  if (sp) sp.style.backgroundPosition = '';
  if (name === 'talk') {
    root.classList.add('is-talk');
    if (sp) sp.dataset.mood = 'talk';
  } else if (name === 'wave1' || name === 'wave2') {
    root.classList.add('is-wave');
    if (sp) sp.dataset.mood = 'wave';
  } else {
    muselyFrame(name);
  }
  if (name === 'hop') {
    const guy = $('muselyGuy');
    if (guy) {
      guy.style.animation = 'none';
      void guy.offsetWidth;
      guy.style.animation = 'musely-hop 520ms var(--spring)';
      setTimeout(() => { guy.style.animation = ''; }, 540);
    }
    muselyFrame('hop');
  }
  if (ms) muselyMoodT = setTimeout(() => muselyMood('idle'), ms);
}

const MUSELY_HI = '<div class="musely-hi"><p class="musely-hi-a">Привет, Я Musely <i class="musely-hand" aria-hidden="true"></i></p><p class="musely-hi-b">могу найти трендовую музыку.</p></div>';

function muselyGroove() {
  const root = $('musely');
  if (!root) return;
  const live = !!$('bPlay')?.classList.contains('playing') && !root.classList.contains('is-closed');
  root.classList.toggle('is-groove', live);
}

let muselyAnimT = null;

function muselyOpen(on) {
  const root = document.getElementById('musely');
  const call = document.getElementById('muselyCall');
  if (!root) return;
  if (on && !muselyGate.unlocked) return;
  muselySetChat();
  const closed = root.classList.contains('is-closed');
  if (on === !closed) {
    if (on) muselyMood('wave1', 900);
    return;
  }
  clearTimeout(muselyAnimT);
  try { localStorage.setItem(MUSELY_CLOSED, on ? '0' : '1'); } catch {}
  if (on) {
    try { localStorage.setItem(MUSELY_GOT, '1'); } catch {}
    call?.classList.remove('is-on');
    call?.classList.add('is-out');
    root.classList.remove('is-closed', 'is-leave');
    void root.offsetWidth;
    root.classList.add('is-enter');
    muselyMood('wave1', 900);
    if (!$('muselyLog')?.childElementCount) muselyHello();
    setTimeout(() => { try { $('muselyQ')?.focus({ preventScroll: true }); } catch {} }, 120);
    muselyAnimT = setTimeout(() => {
      call?.classList.remove('is-out');
      root.classList.remove('is-enter');
    }, 520);
  } else {
    root.classList.remove('is-enter');
    root.classList.add('is-leave');
    call?.classList.remove('is-out');
    call?.classList.add('is-on');
    muselyAnimT = setTimeout(() => {
      root.classList.add('is-closed');
      root.classList.remove('is-leave');
    }, 360);
  }
  muselyGroove();
}

function muselySetChat() {
  const root = $('musely');
  if (root) root.classList.remove('is-chat');
  const scrim = $('muselyScrim');
  if (scrim) scrim.hidden = true;
}

function muselyHello() {
  const log = $('muselyLog');
  if (!log) return;
  muselySetChat();
  log.innerHTML = MUSELY_HI;
}

function muselyPaintTracks(tracks) {
  const log = $('muselyLog');
  if (!log) return;
  muselySetChat();
  log.innerHTML = '';
  for (const t of tracks.slice(0, 3)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'musely-track';
    b.dataset.mq = t.query || t.title || '';
    b.textContent = t.title || t.query || 'play';
    log.appendChild(b);
  }
}

function muselyAppend(cls, text) {
  const log = $('muselyLog');
  if (!log || !text) return;
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function muselyPaint(j) {
  const log = $('muselyLog');
  if (log) log.querySelector('.musely-dots')?.remove();
  let say = (j && j.say) || '';
  if (muselyThinkDump(say)) say = '';
  let tracks = ((j && j.tracks) || []).slice(0, 3);
  if (tracks.length < 2) {
    const fromSay = muselyTracksFromText(say);
    if (fromSay.length > tracks.length) {
      tracks = fromSay;
      say = '';
    }
  }
  if (tracks.length) {
    muselyPaintTracks(tracks);
    return;
  }
  if (say) {
    muselySetChat();
    if (log) log.innerHTML = '';
    muselyAppend('musely-say', say);
    return;
  }
  muselySetChat();
  if (log) log.innerHTML = '';
  muselyAppend('musely-say', 'завис — напиши ещё раз.');
}

function muselyWaiting() {
  const log = $('muselyLog');
  if (!log || log.querySelector('.musely-dots')) return;
  const d = document.createElement('div');
  d.className = 'musely-dots';
  d.innerHTML = '<i></i><i></i><i></i>';
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

function muselyErr(e) {
  const m = String((e && e.message) || 'blanked');
  if (/HTTP 50[234]|Failed to fetch|NetworkError|Load failed|ERR_CONNECTION/i.test(m)) {
    return 'завис — напиши ещё раз.';
  }
  return m.replace('Request timed out — YouTube is slow, try again', 'долго думал — напиши ещё раз');
}

async function muselyAsk(text) {
  if (muselyBusy) return;
  const q = (text || '').trim();
  if (!q) {
    muselyHello();
    return;
  }
  muselyBusy = true;
  muselyMood('talk');
  const root = $('musely');
  const log = $('muselyLog');
  if (log) log.innerHTML = '';
  muselyWaiting();
  try {
    const j = await fetchJSON('/api/musely', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q }),
    }, 18000);
    if (!(j.tracks || []).length) {
      const coerced = muselyTracksFromText(j.say || '');
      if (coerced.length) {
        j.tracks = coerced;
        j.say = '';
        j.mode = 'music';
      }
    }
    muselyPaint(j);
    muselyMood('hop', 700);
  } catch (e) {
    muselyPaint({ mode: 'chat', say: muselyErr(e) });
    muselyMood('wink', 800);
  } finally {
    muselyBusy = false;
    if (root) root.classList.remove('is-talk', 'is-wave');
    if (!muselyMoodT) muselyMood('idle');
  }
}

async function muselyPlay(query) {
  if (!query) return;
  muselyMood('hop', 600);
  try {
    const j = await fetchJSON(`/api/search?q=${encodeURIComponent(query)}&n=4`, {}, 12000);
    const r = (j.results || [])[0];
    if (!r) return;
    playId(r.id, r, j.results, 'search');
  } catch {}
}

const MUSELY_NEED = 3;
let muselyGate = { unlocked: false, have: 0, need: MUSELY_NEED, login: true };

function muselyApplyGate(g) {
  if (g && typeof g === 'object') muselyGate = {
    unlocked: !!g.unlocked,
    have: +g.have || 0,
    need: +g.need || MUSELY_NEED,
    login: !!g.login,
  };
  muselyPaintCall();
}

function muselyOk() {
  if (isAndroidApp()) return false;
  if (isPhone()) return false;
  return true;
}

function muselyPaintCall() {
  if (!muselyOk()) return;
  const call = $('muselyCall');
  const root = $('musely');
  if (!call) return;
  if (!muselyGate.unlocked) {
    root?.classList.add('is-closed');
    root?.classList.remove('is-chat');
    call.classList.add('is-on', 'is-locked');
    call.classList.remove('is-out');
    if (muselyGate.login) {
      call.textContent = 'Sign in for Musely';
      call.setAttribute('aria-label', 'Sign in for Musely');
    } else {
      call.textContent = `Listen ${muselyGate.have}/${muselyGate.need}`;
      call.setAttribute('aria-label', 'Listen to unlock Musely');
    }
    return;
  }
  call.classList.remove('is-locked');
  call.textContent = 'Позвать Musely';
  call.setAttribute('aria-label', 'Позвать Musely');
  const closed = !root || root.classList.contains('is-closed');
  call.classList.toggle('is-on', closed);
}

async function muselyRefreshGate() {
  if (!muselyOk()) return;
  try {
    const j = await fetchJSON('/api/musely', {}, 8000);
    muselyApplyGate(j.musely);
  } catch {}
}

function muselyPlaceCall() {
  let call = document.getElementById('muselyCall');
  const user = document.getElementById('sideUser');
  const foot = document.getElementById('sideFoot') || user?.parentNode;
  if (!call) {
    if (!user || !foot) return null;
    call = document.createElement('button');
    call.type = 'button';
    call.className = 'musely-call';
    call.id = 'muselyCall';
    call.setAttribute('aria-label', 'Позвать Musely');
    call.textContent = 'Позвать Musely';
    foot.insertBefore(call, user.nextSibling);
    muselyPaintCall();
    return call;
  }
  if (user && foot && call.previousElementSibling !== user) {
    foot.insertBefore(call, user.nextSibling);
  }
  muselyPaintCall();
  return call;
}

function muselyMount() {
  let root = document.getElementById('musely');
  const after = document.getElementById('sideFoot') || document.getElementById('sideUser');
  if (root) {
    muselyPlaceCall();
    return root;
  }
  if (!after || !after.parentNode) return null;
  root = document.createElement('div');
  root.id = 'musely';
  root.innerHTML = `
      <button type="button" class="musely-guy" id="muselyGuy" title="Musely" aria-label="Musely">
        <span class="musely-sprite" id="muselySprite" data-mood="idle"></span>
      </button>
      <section class="musely-box" id="muselyBox" aria-label="Musely">
        <header class="musely-hd">
          <button type="button" id="muselyClose" aria-label="Close Musely">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>
        <div class="musely-log" id="muselyLog">${MUSELY_HI}</div>
        <form id="muselyForm" class="musely-form">
          <input id="muselyQ" maxlength="200" placeholder="напиши…" autocomplete="off" spellcheck="false" />
          <button type="submit" aria-label="Send">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </button>
        </form>
      </section>
      <button type="button" class="musely-scrim" id="muselyScrim" hidden aria-label="Close chat"></button>`;
  after.parentNode.insertBefore(root, after);
  muselyPlaceCall();
  return root;
}

async function initMusely() {
  if (!muselyOk()) {
    document.getElementById('musely')?.remove();
    document.getElementById('muselyCall')?.remove();
    return;
  }
  const root = muselyMount();
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  const call = muselyPlaceCall();
  await muselyLoadHist();
  await muselyRefreshGate();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !muselyGate.unlocked) muselyRefreshGate();
  });
  let closed = true;
  try {
    if (muselyGate.unlocked && localStorage.getItem(MUSELY_GOT) === '1') {
      closed = localStorage.getItem(MUSELY_CLOSED) === '1';
    }
  } catch {}
  root.classList.toggle('is-closed', closed);
  call?.classList.toggle('is-on', closed);
  $('muselyClose')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    muselyOpen(false);
  });
  $('muselyCall')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!muselyGate.unlocked) {
      if (muselyGate.login) openAuth('signin');
      else toast(`Listen to ${Math.max(1, muselyGate.need - muselyGate.have)} more. Then he's yours.`);
      return;
    }
    muselyOpen(true);
  });
  $('muselyGuy')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (root.classList.contains('is-closed')) muselyOpen(true);
    else muselyMood('wave1', 800);
  });
  $('muselyForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('muselyQ');
    const v = (inp?.value || '').trim();
    if (!v || muselyBusy) return;
    inp.value = '';
    muselyAsk(v);
  });
  $('muselyLog')?.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mq]');
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    muselyPlay(t.dataset.mq);
  });
  setInterval(() => {
    if (muselyBusy) return;
    const sp = $('muselySprite');
    if (!sp || sp.dataset.mood !== 'idle') return;
    const r = Math.random();
    if (r < 0.12) muselyMood('blink', 220);
    else if (r < 0.18) muselyMood('look', 700);
    else if (r < 0.21) muselyMood('wink', 400);
  }, 1600);
  const groove = () => muselyGroove();
  groove();
  try {
    new MutationObserver(groove).observe($('bPlay') || document.body, { attributes: true, attributeFilter: ['class'] });
  } catch {}
  if (!closed) muselyHello();
  muselyPaintCall();
}

async function maybeColdRefresh() {
  try {
    if (playToken > 0 || userTouched) {
      checkUpdate();
      return;
    }
    if (document.getElementById('intro') || window.__museIntro !== 'done') {
      return;
    }
    if (!sessionStorage.getItem('muse:fresh')) {
      sessionStorage.setItem('muse:fresh', '1');
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        await hardRefresh();
        return;
      }
    }
  } catch {}
  checkUpdate();
}

function showUpdateBar(build) {
  if (document.getElementById('updBar')) return;
  const d = document.createElement('button');
  d.id = 'updBar';
  d.innerHTML = `<span class="udot"></span> New Muse build (b${build}) — reload`;
  d.addEventListener('click', () => location.reload());
  document.body.appendChild(d);
}

/* ---------- phone: tab bar, library sheet, expandable player ---------- */
let playerKids = null;

/* The footer nodes travel into the fullscreen overlay and back. If anything
 * ever strands them, the mini player degrades to a lone play button —
 * so every steward re-homes them first. */
function ensurePlayerHome() {
  try {
    const foot = document.querySelector('footer.player');
    if (!foot) return;
    const art = document.getElementById('art');
    const meta = document.querySelector('.p-meta');
    const center = document.querySelector('.p-center');
    const right = foot.querySelector('.p-right');
    [art, meta, center].forEach((n) => {
      if (n && n.parentElement !== foot) foot.appendChild(n);
    });
    if (right) foot.appendChild(right);
  } catch {}
}

function expandPlayer() {
  if (!isPhone() || $('player').hidden || !$('bigplayer').hidden) return;
  ensurePlayerHome();
  if (!playerKids) playerKids = [...$('player').children];
  const stage = $('bpStage');
  stage.append(
    document.querySelector('#player #art'),
    document.querySelector('#player .p-meta'),
    document.querySelector('#player .p-center')
  );
  if (stage.children.length < 3) {
    ensurePlayerHome();
    return;
  }
  const bp = $('bigplayer');
  bp.classList.remove('closing');
  delete bp.dataset.closing;
  bp.hidden = false;
  try {
    bp.style.animation = 'none';
    void bp.offsetWidth;
    bp.style.animation = '';
  } catch {}
}

function collapsePlayer() {
  if (!playerKids || $('bigplayer').hidden) return;
  const bp = $('bigplayer');
  if (bp.dataset.closing) return;
  const finish = () => {
    try {
      document.querySelectorAll('.art-morph').forEach((n) => n.remove());
      const art = document.getElementById('art');
      if (art) art.style.opacity = '';
    } catch {}
    try {
      playerKids.forEach((k) => { if (k && k.isConnected) $('player').appendChild(k); });
      ensurePlayerHome();
    } catch {}
    bp.hidden = true;
    bp.classList.remove('closing', 'morphing');
    delete bp.dataset.closing;
  };
  if (!(isPhone() && !REDUCED)) {
    finish();
    return;
  }
  bp.dataset.closing = '1';
  const art = document.getElementById('art');
  let from = null;
  try { from = art.getBoundingClientRect(); } catch {}
  let clone = null;
  if (art && from && from.width > 8) {
    try {
      clone = art.cloneNode(true);
      clone.removeAttribute('id');
      clone.className = 'art-morph';
      clone.style.cssText = [
        `left:${Math.round(from.left)}px`,
        `top:${Math.round(from.top)}px`,
        `width:${Math.round(from.width)}px`,
        `height:${Math.round(from.height)}px`,
        'border-radius:22px',
        'transition:none',
      ].join(';');
      document.body.appendChild(clone);
      art.style.opacity = '0';
    } catch { clone = null; }
  }
  bp.classList.add('morphing');
  try {
    playerKids.forEach((k) => { if (k && k.isConnected) $('player').appendChild(k); });
    ensurePlayerHome();
  } catch {}
  const live = document.getElementById('art');
  if (live) live.style.opacity = '0';
  let to = null;
  try { to = live.getBoundingClientRect(); } catch {}
  if (clone && to && to.width > 8) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        clone.style.transition = 'left 480ms cubic-bezier(0.22,1,0.36,1),top 480ms cubic-bezier(0.22,1,0.36,1),width 480ms cubic-bezier(0.22,1,0.36,1),height 480ms cubic-bezier(0.22,1,0.36,1),border-radius 480ms cubic-bezier(0.22,1,0.36,1)';
        clone.style.left = `${Math.round(to.left)}px`;
        clone.style.top = `${Math.round(to.top)}px`;
        clone.style.width = `${Math.round(to.width)}px`;
        clone.style.height = `${Math.round(to.height)}px`;
        clone.style.borderRadius = '11px';
      });
    });
  }
  setTimeout(finish, 500);
}
/* ---------- phone library sheet ---------- */
function closeLibrary() {
  $('sheet').hidden = true;
  try { moveTabInd(currentView); } catch {}
}

async function openLibrary() {
  const sh = $('sheet');
  const paintUser = () => {
    const u = $('sheetUser');
    if (me) {
      u.innerHTML = `${avatarHTML()}
        <span style="flex:1;min-width:0"><b>${escapeHtml(me.display)}</b><i>@${escapeHtml(meHandle() || me.username)}</i></span>`;
    } else {
      u.innerHTML = `<span class="avatar">?</span>
        <span style="flex:1;min-width:0"><b>Sign in</b><i>playlists live here</i></span>`;
    }
  };
  const paintLists = async () => {
    const box = $('sheetPl');
    if (!me) {
      box.innerHTML = '<div class="vempty">Sign in to build playlists.</div>';
      return;
    }
    try {
      const j = await api('/api/playlists');
      box.innerHTML = j.playlists.length ? '' : '<div class="vempty">No playlists yet — make one.</div>';
      j.playlists.forEach((p) => box.appendChild(makeSheetRow(p)));
    } catch {
      box.innerHTML = '<div class="vempty">Could not load.</div>';
    }
  };
  paintUser();
  sh.hidden = false;
  try { moveTabInd('library'); } catch {}
  await paintLists();
}

/* Mix: one tap shuffles your whole library (likes + every playlist). */
async function mixAll() {
  if (!me) {
    openAuth('signin');
    return;
  }
  try {
    const [likes, pls] = await Promise.all([api('/api/likes'), api('/api/playlists')]);
    let pool = (likes.tracks || []).map((t) => ({ ...t }));
    for (const p of pls.playlists || []) {
      try {
        const det = await api(`/api/playlists/${p.id}/tracks`);
        pool = pool.concat((det.tracks || []).map((t) => ({ ...t })));
      } catch {}
    }
    const seen = new Set();
    pool = pool.filter((t) => t.id && !seen.has(t.id) && (seen.add(t.id), true));
    if (!pool.length) return;
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    playId(pool[0].id, pool[0], pool, 'mix');
  } catch {}
}

/* Sleep timer: shut the music off after a while. */
let sleepTimer = null;
let sleepMins = 0;
function paintSleep() {
  document.querySelectorAll('[data-sleep]').forEach((el) => {
    el.textContent = sleepMins ? `${sleepMins}m` : 'Off';
  });
}
function cycleSleep() {
  sleepMins = sleepMins === 0 ? 15 : sleepMins === 15 ? 30 : sleepMins === 30 ? 60 : 0;
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
  if (sleepMins) {
    sleepTimer = setTimeout(() => {
      sleepMins = 0;
      paintSleep();
      doPause();
    }, sleepMins * 60000);
  }
  paintSleep();
}

function bootAccountUI() {
  // Intro is owned solely by endIntro() (phone: big-logo fade, desktop: flight).
  // No duplicate timer here — it used to race endIntro and hard-cut the logo.
  document.querySelectorAll('.snav button').forEach((b) =>
    b.addEventListener('click', () => {
      vibe();
      if (b.id === 'sideMore') { openMore(b); return; }
      if (!b.dataset.view) return;
      if (b.dataset.view === 'home') showHome();
      else showView(b.dataset.view);
    }));
  $('sideBrand').addEventListener('click', () => {
    vibe();
    showHome();
  });
  $('sideUser').addEventListener('click', (e) => {
    vibe();
    e.stopPropagation();
    if (me) openAcct($('sideUser'));
    else openAuth('signin');
  });
  $('newPl').addEventListener('click', () => openPlModal());
  $('bLike').addEventListener('click', async () => {
    if (!me) { openAuth('signin'); return; }
    if (!current?.id) return;
    await toggleLike(current.id, { title: current.title, thumbnail: current.thumbnail || '', duration: current.duration ?? null });
  });
  $('bAdd').addEventListener('click', () => {
    if (!me) { openAuth('signin'); return; }
    if (!current?.id) return;
    openPlPicker($('bAdd'), { id: current.id, title: current.title,
      thumbnail: current.thumbnail || '', duration: current.duration ?? null });
  });
  $('bFx')?.addEventListener('click', (e) => {
    e.stopPropagation();
    vibe();
    const pop = $('fxPop');
    if (pop && !pop.hidden) closeFxPop();
    else openFxPop($('bFx'));
  });
  $('tabMore')?.addEventListener('click', (e) => {
    vibe();
    e.stopPropagation();
    const pop = $('morePop');
    if (pop && !pop.hidden) closeMore();
    else openMore($('tabMore'));
  });
  $('sideMore')?.addEventListener('click', (e) => e.stopPropagation());
  $('morePop')?.addEventListener('click', (e) => {
    const act = e.target.closest('[data-more]')?.dataset.more;
    if (!act && e.target === $('morePop')) { closeMore(); return; }
    if (!act) return;
    closeMore();
    if (act === 'market') showView('market');
    else if (act === 'friends') {
      if (!me) { openAuth('signin'); return; }
      showView('friends');
    }
  });
  $('acctPop')?.addEventListener('click', (e) => {
    const act = e.target.closest('[data-acct]')?.dataset.acct;
    if (!act && e.target === $('acctPop')) { closeAcct(); return; }
    if (!act) return;
    closeAcct();
    if (act === 'profile') openPublic(meHandle());
    else if (act === 'settings') openSettings();
    else if (act === 'out') doLogout();
  });
  $('fxPop')?.addEventListener('click', (e) => {
    if (e.target === $('fxPop')) closeFxPop();
  });
  window.addEventListener('popstate', () => {
    if (document.body.classList.contains('chat-open')) {
      if (chatDismissOverlays()) {
        try { history.pushState({ ...(history.state || {}), museChat: chatWith || 1 }, ''); chatHistPushed = true; } catch {}
        return;
      }
      closeChatToList();
      return;
    }
    applyRoute();
  });
  $('modalWrap').addEventListener('click', (e) => {
    if (e.target !== $('modalWrap')) return;
    if ($('modalWrap').dataset.stay === '1') return;
    closeModal();
  });
  bindModalMarket();
  bindDeskPrompt();
  bindApkPrompt();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (mediaViewOpen()) { closeMediaView(); return; }
      if ($('deskPrompt') && !$('deskPrompt').hidden) { hideDeskPrompt(); return; }
      if ($('apkPrompt') && !$('apkPrompt').hidden) { hideApkPrompt(); return; }
      if ($('acctPop') && !$('acctPop').hidden) { closeAcct(); return; }
      if ($('morePop') && !$('morePop').hidden) { closeMore(); return; }
      if ($('fxPop') && !$('fxPop').hidden) { closeFxPop(); return; }
      if (document.body.classList.contains('chat-open')) {
        if (chatDismissOverlays()) return;
        closeChatToList();
        return;
      }
      closeMenu(); closeModal();
    }
  });
  $('menu')?.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.addEventListener('pointerdown', (e) => {
    const m = $('menu');
    if (m && !m.hidden && !m.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu();
    const ap = $('acctPop');
    if (ap && !ap.hidden && !ap.querySelector('.acct-card')?.contains(e.target)
        && !e.target.closest('#sideUser, #sheetUser')) closeAcct();
    const mp = $('morePop');
    if (mp && !mp.hidden && !mp.querySelector('.acct-card')?.contains(e.target)
        && !e.target.closest('#sideMore, #tabMore')) closeMore();
    const fx = $('fxPop');
    if (fx && !fx.hidden && !fx.querySelector('.fx-card')?.contains(e.target)
        && !e.target.closest('#bFx')) closeFxPop();
  });
  // Returning users boot from this device's last copy; the network answer
  // only redraws if the signed-in account actually changed.
  const bootMe = swrGet('/api/me')?.user || null;
  const afterMe = () => {
    refreshCounts();
    applyPlugs();
    restorePlace();
    if (currentView === 'home') loadHomeFy();
  };
  if (bootMe) { me = bootMe; applyTheme(); afterMe(); }
  refreshMe().then(() => {
    if (!bootMe || !me || me.id !== bootMe.id) {
      afterMe();
      paintLikedSet();
      if (!me && currentView === 'foryou') showHome();
    }
    if (me) {
      const ob = $('onboard');
      if (ob && !ob.hidden) hideOnboard();
    } else {
      maybeOnboard();
    }
  });
  if (!bootMe && !onboarded()) maybeOnboard();
  // Measured header offset: the docked list header (.vhead) pins exactly
  // under the sticky search bar, whatever its height actually is.
  const fitTop = () => {
    try {
      if (!isPhone()) return;
      const top = document.querySelector('.top');
      if (!top) return;
      const h = Math.ceil(top.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--topH', `${h}px`);
    } catch {}
  };
  // Measured bottom clearance: whatever the chrome heights actually are
  // (player ± tab bar ± safe area), the content always ends above them.
  const fitBottom = () => {
    try {
      const tab = document.querySelector('#tabbar');
      const pl = document.querySelector('#player');
      const phone = isPhone();
      let lift = 0;
      const tabOn = tab && getComputedStyle(tab).display !== 'none';
      if (phone && tabOn) {
        const th = Math.round(tab.getBoundingClientRect().height);
        if (th > 0) {
          document.documentElement.style.setProperty('--tabbar-h', `${th}px`);
          lift += th;
        }
      }
      if (pl && !pl.hidden) {
        const ph = Math.round(pl.getBoundingClientRect().height);
        if (ph > 0) lift += ph + (phone ? 8 : 22);
      }
      document.documentElement.style.setProperty('--player-lift', `${lift}px`);
      if (phone) {
        const wrap = document.querySelector('.wrap');
        const need = Math.max(lift ? 200 : 24, Math.ceil(lift) + 28);
        if (wrap) wrap.style.paddingBottom = `${need}px`;
      }
    } catch {}
    try { fitTop(); } catch {}
    try { fitChatKb(); } catch {}
  };
  setInterval(fitBottom, 1500);
  window.addEventListener('resize', () => { try { fitBottom(); } catch {} try { moveTabInd(currentView); } catch {} });
  try {
    window.visualViewport.addEventListener('resize', () => { try { trackChatKb(); } catch {} });
    window.visualViewport.addEventListener('scroll', () => { try { trackChatKb(); } catch {} });
  } catch {}
  window.addEventListener('orientationchange', () => setTimeout(() => { try { moveTabInd(currentView); } catch {} }, 300));
  setTimeout(fitBottom, 50);
  setTimeout(fitBottom, 500);
  setTimeout(() => { try { moveTabInd(currentView); } catch {} try { fitTop(); } catch {} }, 600);
  // phone chrome
  document.querySelectorAll('#tabbar button[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      vibe();
      if (b.dataset.view === 'home') showHome();
      else showView(b.dataset.view);
    }));
  $('tabLib').addEventListener('click', () => { vibe(); openLibrary(); });
  $('coverPick').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) openCoverEditor(f);
  });
  $('tabMix').addEventListener('click', mixAll);
  $('sleepRow').addEventListener('click', cycleSleep);
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeLibrary(); });
  let sheetY = null;
  $('sheet').addEventListener('touchstart', (e) => {
    if (e.target.closest('button, input')) { sheetY = null; return; }
    sheetY = e.touches[0].clientY;
  }, { passive: true });
  $('sheet').addEventListener('touchend', (e) => {
    if (sheetY == null) return;
    const dy = e.changedTouches[0].clientY - sheetY;
    sheetY = null;
    if (dy > 90) closeLibrary();
  });
  $('sheetNew').addEventListener('click', () => { vibe(); openPlModal(); });
  $('sheetUser').addEventListener('click', () => {
    closeLibrary();
    if (me) openAcct($('sheetUser'));
    else openAuth('signin');
  });
  $('player').addEventListener('click', (e) => {
    if (!isPhone()) return;
    if (e.target.closest('button, input, .p-line')) return;
    if (Date.now() - playerShownAt < 900) return; // just appeared under the finger — ignore
    expandPlayer();
  });
  $('bpClose').addEventListener('click', collapsePlayer);
  let swipeY = null;
  $('bigplayer').addEventListener('touchstart', (e) => {
    if (e.target.closest('button, input, .p-line')) { swipeY = null; return; }
    swipeY = e.touches[0].clientY;
  }, { passive: true });
  $('bigplayer').addEventListener('touchend', (e) => {
    if (swipeY == null) return;
    const dy = e.changedTouches[0].clientY - swipeY;
    swipeY = null;
    if (dy > 90) collapsePlayer();
  });
  try {
    matchMedia('(max-width: 760px)').addEventListener('change', (e) => { if (isDeskApp() || !e.matches) collapsePlayer(); });
  } catch {}
  setTimeout(maybeColdRefresh, 2200);
  setInterval(checkUpdate, 30000);
  if (isIOS) {
    setInterval(() => {
      try {
        if (!current || !audio.src || !('mediaSession' in navigator)) return;
        const live = !userPaused && !audio.paused && !audio.ended;
        navigator.mediaSession.playbackState = live ? 'playing' : 'paused';
        pushPositionState(true);
      } catch {}
    }, 1000);
  }
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    // A reload here destroys Control Center / lock screen. Re-bind instead.
    if (current && audio && audio.src) {
      primeAudioSession();
      try { mediaActions(); } catch {}
      pinNowPlaying(userPaused ? 'paused' : 'playing');
      if (!userPaused && audio.paused && !audio.ended) kickPlayback().catch(() => {});
      return;
    }
    location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && me) ensurePush();
  });
  const pushSoon = () => { registerSW(); ensurePush(); };
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') pushSoon();
  else setTimeout(pushSoon, 1500);
}

function bootWhenReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}
bootWhenReady(init);
bootWhenReady(bootAccountUI);
bootWhenReady(initMusely);
