/* Muse frontend — vanilla, no deps. Type, stream, done. */
const $ = (id) => document.getElementById(id) || __nullEl;
const __nullEl = new Proxy(function () {}, {
  get: () => __nullEl,
  set: () => true,
  apply: () => undefined,
});
const audio = window.MusePlayer ? window.MusePlayer($('audio')) : $('audio');
const SPRING = 'cubic-bezier(0.22,1,0.36,1)';

let queue = [];      // last search results (prev/next walks this)
let qi = -1;
let queueSource = 'search'; // search | home | foryou | playlist | liked | radio | mix
let queuePid = null; // playlist id the queue came from (playlist source only)
let current = null;  // {id, ...}
let dragging = false;
let shuffle = false;
let repeat = 'off'; // off | all | one
let userPaused = false; // true only when a human pressed pause
let lastPlayingAt = 0;
let playerShownAt = 0; // taps right after the bar appears hit songs, not the bar
let lastLoopAt = 0;
let searchTimer = null;
let searchToken = 0;
let errTries = 0; // stream-error recovery stage, reset on every clean play

const fmt = (s) => {
  if (s == null || isNaN(s) || !isFinite(s)) return s ? String(s) : '';
  s = Math.floor(s);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastT = null;
function toast(msg, ok = false) {
  // Notifications are off by request — log quietly instead of popping up.
  try { console.debug('[muse]', msg); } catch {}
  clearTimeout(toastT);
}

async function fetchJSON(path, opts = {}, timeoutMs = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(path, { ...opts, signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Request timed out — YouTube is slow, try again');
    throw e;
  } finally {
    clearTimeout(t);
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

function cardHTML(r, i) {
  return `
  <div class="card" style="animation-delay:${Math.min(i * 55, 440)}ms" data-play="${r.id}" title="Play">
    <span class="likedot"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>
    <div class="thumb">
      <img ${i < 4 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" draggable="false" src="${r.thumbnail}"
        onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${r.id}/hqdefault.jpg'" alt="" />
      <span class="go"><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg></span></span>
      ${r.duration ? `<span class="dur">${fmt(r.duration)}</span>` : ''}
    </div>
    <h3>${escapeHtml(r.title)}</h3>
  </div>`;
}

function prewarm(results) {
  // Thumbnails: force the first rows into cache instantly.
  try {
    results.slice(0, 6).forEach((r) => { const im = new Image(); im.decoding = 'async'; im.src = r.thumbnail; });
  } catch { /* best-effort */ }
}

function showHome() {
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
  $('empty').hidden = false;
  setHome(true);
  loadHomeFy();
}

let homeFyKey = '';
function vibe(ms = 8) {
  try { navigator.vibrate?.(ms); } catch {}
}
function renderHomeTracks(tracks) {
  const box = $('homeFy');
  homeQueue = tracks.map((t) => ({ ...t }));
  box.innerHTML = `<div class="fyhead"><div data-fyopen style="cursor:pointer"><h2>For You</h2></div></div>
      <div class="grid">${tracks.map(recoCardHTML).join('')}</div>`;
  box.hidden = false;
  box.querySelector('[data-fyopen]').addEventListener('click', () => showView('foryou'));
  markLiked(tracks.map((t) => t.id));
  prewarm(tracks);
}
async function loadHomeFy() {
  const box = $('homeFy');
  if (!box || !me) {
    if (box) box.hidden = true;
    return;
  }
  const day = Math.floor(Date.now() / 86400000);
  const key = `${me.id}|${day}`;
  if (homeFyKey === key && box.innerHTML) {
    box.hidden = false;
    return;
  }
  homeFyKey = key;
  // Instant: paint today's saved mix now, refresh quietly behind it.
  try {
    const saved = JSON.parse(localStorage.getItem('muse:homefy') || 'null');
    if (saved && saved.day === day && saved.uid === me.id && saved.tracks?.length) {
      renderHomeTracks(saved.tracks);
    }
  } catch {}
  try {
    const j = await api('/api/recommendations?n=6');
    if (currentView !== 'home' || !me || homeFyKey !== key) return;
    if (!j.tracks.length && j.building) {
      setTimeout(() => {
        if (currentView === 'home' && homeFyKey === key) { homeFyKey = ''; loadHomeFy(); }
      }, 6000);
      return;
    }
    if (!j.tracks.length) {
      if (!box.innerHTML) box.hidden = true;
      return;
    }
    renderHomeTracks(j.tracks);
    try {
      localStorage.setItem('muse:homefy', JSON.stringify({ day, uid: me.id, tracks: j.tracks }));
    } catch {}
  } catch {
    if (!box.innerHTML) box.hidden = true;
  }
}

async function doSearch(q) {
  q = (q ?? $('q').value).trim();
  if (q.length < 2) return;
  const token = ++searchToken;
  clearTimeout(searchTimer);
  setHome(false);
  setViewNav('home');
  $('view').hidden = true;
  $('view').innerHTML = '';
  $('homeFy').hidden = true;
  $('empty').hidden = true;
  skel();
  try {
    const j = await api(`/api/search?q=${encodeURIComponent(q)}&n=12`);
    if (token !== searchToken) return; // stale keystroke — a newer search is flying
    $('loading').hidden = true;
    queue = j.results || [];
    qi = -1;
    if (!queue.length) {
      $('empty').hidden = false;
      toast('No songs found — try different words');
      return;
    }
    $('grid').innerHTML = queue.map(cardHTML).join('');
    $('grid').hidden = false;
    prewarm(queue);
    markLiked(queue.map((r) => r.id));
    enrichInBackground(queue.map((r) => r.id), token);
  } catch (e) {
    if (token !== searchToken) return;
    $('loading').hidden = true;
    $('empty').hidden = false;
    setHome(true);
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
        if (img && c.thumbnail && img.getAttribute('src') !== c.thumbnail) {
          img.style.opacity = '0';
          img.onload = () => { img.style.opacity = '1'; };
          img.src = c.thumbnail;
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
      const q = queue.find((r) => r.id === c.id);
      if (q) Object.assign(q, c);
    }
    for (const id of j.drop || []) {
      const el = document.querySelector(`#grid .card[data-play="${id}"]`);
      if (el) {
        el.style.transition = 'opacity 350ms, transform 350ms cubic-bezier(0.22,1,0.36,1)';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.92)';
        setTimeout(() => el.remove(), 360);
      }
      queue = queue.filter((r) => r.id !== id);
    }
  } catch { /* fast cards stay as-is — still playable */ }
}

/* ---------- playback (proxy first, direct URL as fallback) ---------- */
let userVol = 0.85;
let fadeRAF = 0;
let volumeTarget = 0.85; // the volume EVERYTHING must converge to — asserted on tab return

function rampTo(target, ms = 350) {
  volumeTarget = target;
  cancelAnimationFrame(fadeRAF);
  // Background tabs get no animation frames: a frozen mid-fade would leave
  // the player permanently near-silent while icons claim playback.
  if (document.hidden) {
    try { audio.volume = target; } catch {}
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
  if (!document.hidden) {
    // Coming back: snap to the intended volume in case a fade froze mid-way.
    cancelAnimationFrame(fadeRAF);
    try {
      if (Math.abs(audio.volume - volumeTarget) > 0.02) audio.volume = volumeTarget;
    } catch {}
  }
});

async function doPlay() {
  userPaused = false;
  try {
    await audio.play();
  } catch {
    return;
  }
  rampTo(userVol, 450);
}

async function doPause() {
  userPaused = true;
  await Promise.race([rampTo(0, 300), new Promise((r) => setTimeout(r, 350))]);
  try { audio.pause(); } catch {}
  audio.volume = userVol; // reset so the next play starts clean
}

function swapArt(url, instant = false) {
  const art = $('art');
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

function finalizePrev(completed) {
  if (!lastPlay) return;
  const p = lastPlay;
  lastPlay = null;
  const el = (Date.now() - p.t0) / 1000;
  if (completed) noteEvent('complete', p, p.duration || el);
  else if (el < 30) noteEvent('skip', p, el);
  else noteEvent('play', p, el);
}

let playToken = 0; // superseded plays bail out instead of fighting

/* Card data already carries title/art/duration, so the YouTube engine never
 * needs the server for a play; only bare ids (or the server-stream engine)
 * ask /api/play. */
async function trackMeta(id, item) {
  const thumb = item.thumbnail || item.thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
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

async function playId(id, meta = {}, list = null, source = 'search') {
  const myToken = ++playToken;
  finalizePrev(false);
  if (list) {
    queue = list.slice();
    qi = Math.max(0, list.findIndex((r) => r.id === id));
    queueSource = source;
    queuePid = source === 'playlist' ? viewArg : null;
  }
  const item = queue.find((r) => r.id === id) || meta;
  if (!list) qi = queue.findIndex((r) => r.id === id);
  current = { id, ...item };
  lastPlay = { ...current, t0: Date.now() };
  errTries = 0;
  warmedNextId = null;
  try { audio.muted = false; } catch {} // a scrub mute must never survive a track change
  try { audio.loop = (repeat === 'one'); } catch {}
  const firstShow = $('player').hidden;
  $('player').hidden = false;
  if ($('bigplayer').hidden) ensurePlayerHome();
  document.body.classList.add('has-player');
  playerShownAt = Date.now();
  $('ptitle').textContent = item.title || 'Loading…';
  swapArt(item.thumbnail, firstShow);
  setPlaying(false);
  // INSTANT: fire the stream now — metadata enriches in parallel, not in series.
  (async () => {
    try {
      if (audio.src && !audio.paused) {
        await Promise.race([rampTo(0, 220), new Promise((r) => setTimeout(r, 260))]);
        try { audio.pause(); } catch {}
      }
      if (myToken !== playToken) return;
      audio.volume = 0;
      audio.src = `/api/audio?v=${id}`;
      userPaused = false;
      try {
        await audio.play();
        if (myToken === playToken) rampTo(userVol, 500);
      } catch {}
    } catch {}
  })();
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

function mediaSession(m) {
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: m.title || '',
      artist: m.uploader || 'Muse',
      album: 'Muse',
      artwork: m.thumbnail ? [
        { src: m.thumbnail, sizes: '512x512', type: 'image/jpeg' }
      ] : []
    });
    try { navigator.mediaSession.playbackState = 'playing'; } catch {}
    try {
      navigator.mediaSession.setActionHandler('play', () => doPlay());
      navigator.mediaSession.setActionHandler('pause', () => doPause());
      navigator.mediaSession.setActionHandler('previoustrack', step(-1));
      navigator.mediaSession.setActionHandler('nexttrack', step(1));
      try { navigator.mediaSession.setActionHandler('seekto', (d) => { if (d && isFinite(d.seekTime) && audio.duration) { try { audio.currentTime = d.seekTime; } catch {} } }); } catch {}
    } catch {}
  } catch { /* older browsers */ }
}

/* Keep the lockscreen progress alive — iOS kills sessions with stale position. */
let lastPosState = 0;
function pushPositionState() {
  try {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!audio.duration || !isFinite(audio.duration)) return;
    const now = Date.now();
    if (now - lastPosState < 4000 && !audio.paused) return;
    lastPosState = now;
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime || 0, audio.duration)
    });
  } catch {}
}

/* Warm the NEXT stream while the current one still plays, so `ended`
 * fires into a hot server cache instead of a cold yt-dlp resolve.
 * Only the server-stream engine has a cache to warm. */
let warmedNextId = null;
function warmNext() {
  try {
    if (shuffle || audio.engine === 'yt') return;
    const nxt = queue[qi + 1];
    if (!nxt || !nxt.id || nxt.id === warmedNextId) return;
    warmedNextId = nxt.id;
    fetch(`/api/play?v=${nxt.id}`).catch(() => {});
  } catch {}
}

/* When a stray song (search/home/For You) ends with nowhere to go,
 * keep the music alive from your own library: liked first, else any playlist. */
async function pickLibraryNext(excludeId) {
  try {
    const [likes, pls] = await Promise.all([api('/api/likes'), api('/api/playlists')]);
    let pool = (likes.tracks || []).map((t) => ({ ...t }));
    if (!pool.length && pls.playlists.length) {
      const p = pls.playlists[Math.floor(Math.random() * pls.playlists.length)];
      const det = await api(`/api/playlists/${p.id}/tracks`);
      pool = (det.tracks || []).map((t) => ({ ...t }));
    }
    pool = pool.filter((t) => t.id !== excludeId);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  } catch {
    return null;
  }
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
    audio.volume = 0;
    audio.src = `/api/audio?v=${current.id}`;
    await audio.play();
    rampTo(userVol, 400);
  } catch {
    audio.volume = userVol;
    toast('Repeat broke — press play to retry');
  }
}

function step(d) {
  return () => {
    if (!queue.length) return;
    let n;
    if (shuffle && queue.length > 1) {
      do { n = Math.floor(Math.random() * queue.length); } while (n === qi);
    } else {
      n = qi < 0 ? (d > 0 ? 0 : queue.length - 1) : (qi + d + queue.length) % queue.length;
    }
    playId(queue[n].id, queue[n]);
  };
}

let playFail = null; // {id, at} — last playId rejection, so auto-advance skips corpses fast
let timeAdvAt = 0; // last timeupdate-driven advance (prevents double-fire with `ended`)

/* Single choke point for track-end advancement. `ended` and the background
 * watchdog both come here. Backgrounded iOS throttles timers and suspends
 * rAF, so the background path must NOT wait for confirm loops or radio
 * fetches — it fires the next queued src immediately (pre-warmed). */
async function advanceFromPlayback(from) {
  try { timeAdvAt = Date.now(); } catch {}
  try { finalizePrev(true); } catch {}
  if (repeat === 'one') { try { restartLoop(); } catch {} return; }
  const hidden = (() => { try { return document.hidden; } catch { return false; } })();
  if (shuffle || qi < queue.length - 1) {
    if (queue.length) {
      if (hidden) {
        // Fast path: next queued track NOW, no 10s confirm wait.
        try {
          let n = qi + 1;
          if (shuffle && queue.length > 1) {
            do { n = Math.floor(Math.random() * queue.length); } while (n === qi);
          }
          const t = queue[n];
          if (t) { playId(t.id, t, queue, queueSource); return; }
        } catch {}
      }
      try { await stepAuto(); } catch {}
      return;
    }
  }
  if (!me) return;
  if (queueSource === 'playlist' || queueSource === 'liked' || queueSource === 'foryou') {
    try {
      const j = await api('/api/recommendations?n=10');
      const fresh = (j.tracks || []).filter((t) => t.id !== current?.id);
      if (fresh.length) { playId(fresh[0].id, fresh[0], fresh, 'foryou'); return; }
    } catch {}
    if (queueSource !== 'foryou') return;
  }
  if (!['search', 'home', 'foryou', 'radio'].includes(queueSource)) return;
  try {
    const nxt = await pickLibraryNext(current?.id);
    if (nxt) playId(nxt.id, nxt, [nxt], 'radio');
  } catch {}
}

/* Auto-advance that verifies sound actually started, skipping dead tracks
 * (up to a few) instead of dying silently on the first corpse. */
async function stepAuto() {
  if (!queue.length) return;
  let order;
  if (shuffle && queue.length > 1) {
    order = queue.map((_, i) => i).filter((i) => i !== qi);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  } else {
    order = [];
    for (let k = 1; k <= 3 && qi + k < queue.length; k++) order.push(qi + k);
  }
  for (const n of order) {
    const t = queue[n];
    if (!t) continue;
    try {
      await playIdAndConfirm(t);
      return;
    } catch (e) {
    }
  }
}

function playIdAndConfirm(t) {
  playId(t.id, t, queue, queueSource);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (current?.id !== t.id) return reject(new Error('superseded'));
        if (playFail?.id === t.id && Date.now() - playFail.at < 20000) {
          return reject(new Error('rejected'));
        }
        const ok = !audio.paused && !audio.ended
          && (audio.currentTime > 0.25
            || (audio.buffered.length > 0 && audio.buffered.end(audio.buffered.length - 1) > 2));
        if (ok) return resolve(true);
      } catch {}
      if (Date.now() - t0 > 10000) return reject(new Error('no-play'));
      setTimeout(tick, 500);
    };
    tick();
  });
}

/* thin-line progress */
function paintProgress() {
  const r = audio.duration ? audio.currentTime / audio.duration : 0;
  const pct = (Math.min(1, Math.max(0, r)) * 100).toFixed(2) + '%';
  $('pfill').style.width = pct;
  $('pknob').style.left = pct;
  $('pos').textContent = fmt(audio.currentTime);
  $('dur').textContent = fmt(audio.duration);
}

function seekRatio(ratio) {
  if (!audio.duration) return;
  audio.currentTime = Math.min(0.999, Math.max(0, ratio)) * audio.duration;
  paintProgress();
}

function setPlaying(p) {
  $('bPlay').classList.toggle('playing', p);
  if (p) errTries = 0; // clean playback resets the recovery ladder
  paintHeaderPlay();
  try {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'playing' : 'paused';
  } catch {}
  try { pushPositionState(); } catch {}
  try {
    $('bPlay').classList.remove('pop');
    void $('bPlay').offsetWidth;
    $('bPlay').classList.add('pop');
  } catch { /* cosmetic */ }
}

/* ---------- events ---------- */
let introDone = false;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

function hardCutIntro() {
  introDone = true;
  $('intro')?.remove();
  document.body.classList.remove('intro');
  if (isPhone()) return; // mobile: no keyboard pop-up, no flight
  try { $('q').focus({ preventScroll: true }); } catch { try { $('q').focus(); } catch {} }
}

async function endIntro() {
  if (introDone) return;
  if (REDUCED) { hardCutIntro(); return; }
  // Phone: big logo fades in (CSS), then fades out. No pill flight, no text.
  if (isPhone()) {
    introDone = true;
    const intro = $('intro');
    if (!intro) { hardCutIntro(); return; }
    intro.classList.add('phonefade');
    setTimeout(() => {
      try { intro.remove(); } catch {}
      document.body.classList.remove('intro');
    }, 750);
    return;
  }
  const intro = $('intro');
  const pill = document.querySelector('.intro-pill');
  const brand = document.querySelector('#sideBrandText');
  if (!intro || !pill || !brand) { hardCutIntro(); return; }
  introDone = true;
  // Measure in FINAL type: if Clash Display lands mid-flight the two boxes
  // have different widths and the dock jumps. Cap the wait so a slow font
  // CDN can never hold the intro hostage.
  try {
    await Promise.race([
      (document.fonts ? document.fonts.ready : Promise.resolve()),
      new Promise((r) => setTimeout(r, 1200)),
    ]);
  } catch {}
  // Dissolve the blackout, keep the pill, fly it straight into the brand slot.
  intro.classList.add('clear');
  try { pill.getAnimations().forEach((a) => a.cancel()); } catch {}
  const p = pill.getBoundingClientRect();
  const b = brand.getBoundingClientRect();
  const dx = (b.left + b.width / 2) - (p.left + p.width / 2);
  const dy = (b.top + b.height / 2) - (p.top + p.height / 2);
  // Identical type on both ends → pure translation, fully opaque, invisible swap.
  const flight = pill.animate([
    { transform: 'translate(0px, 0px)' },
    { transform: `translate(${dx * 0.82}px, ${dy * 0.82}px)`, offset: 0.78 },
    { transform: `translate(${dx}px, ${dy}px)` }
  ], { duration: 880, easing: SPRING, fill: 'forwards' });
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    // Kill every retained animation fill (they alter text rasterization),
    // pin the final transform explicitly, settle two frames, then swap.
    try { pill.getAnimations({ subtree: true }).forEach((a) => a.cancel()); } catch {}
    pill.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      intro.remove();
      document.body.classList.remove('intro');
      if (!isPhone()) {
        try { $('q').focus({ preventScroll: true }); } catch { try { $('q').focus(); } catch {} }
      }
    }));
  };
  flight.onfinish = finish;
  setTimeout(finish, 1700); // safety net, measured from flight start
}

function init() {
  window.__museBooted = true;
  setHome(true);
  audio.volume = userVol;
  // Magic-burst intro, then the bar glides up top. Click skips it.
  setTimeout(endIntro, 1700);
  $('intro')?.addEventListener('click', endIntro);

  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); doSearch(); });
  $('q').addEventListener('input', () => {
    const v = $('q').value;
    if (!v.trim()) { showHome(); return; }
    if (v.trim().length < 2) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(v.trim()), 450);
  });
  document.querySelectorAll('.chips button').forEach((b) => {
    b.addEventListener('click', () => { $('q').value = b.dataset.q; doSearch(b.dataset.q); });
  });

  document.addEventListener('click', (e) => {
    if (lpFired) {
      lpFired = false;
      return;
    } // long-press just opened a menu — swallow the ghost click
    if (justDropped()) return; // reorder drop — don't start playback
    const play = e.target.closest('[data-play]');
    if (play) {
      const card = play.closest('.card');
      const meta = card ? {
        title: card.querySelector('h3')?.textContent || '',
        thumbnail: card.querySelector('img')?.src || ''
      } : {};
      const scope = play.closest('#view') ? viewQueue : (play.closest('#homeFy') ? homeQueue : null);
      const src = play.closest('#view') ? currentView : (play.closest('#homeFy') ? 'home' : 'search');
      if (scope && scope.length) playId(play.dataset.play, meta, scope, src);
      else playId(play.dataset.play, meta, null, src);
    }
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

  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', async () => {
    // The position watchdog below may already have advanced for this track.
    if (timeAdvAt && Date.now() - timeAdvAt < 5000) return;
    try { advanceFromPlayback('ended'); } catch {}
  });
  audio.addEventListener('error', () => {
    if (!audio.src || !current?.id) return;
    // Mix tape rule: a track that never produced a single frame is dead —
    // skip it, don't mourn it with recovery ladders.
    if (queueSource === 'mix' && audio.readyState === 0 && qi < queue.length - 1) {
      step(1)();
      return;
    }
    errTries++;
    // Stage 1: proxy hiccup → jump to the direct stream URL.
    if (errTries === 1 && audio.src.includes('/api/audio')) {
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
      setTimeout(async () => {
        if (errTries > 2) {
          toast('Still broken — this video may be gone. Try another song.');
          return;
        }
        try {
          const m = await api(`/api/play?v=${current.id}`);
          if (!m.audio_url) throw new Error('no url');
          current = { ...current, ...m };
          audio.volume = 0;
          audio.src = `/api/audio?v=${current.id}`;
          await audio.play();
          rampTo(userVol, 500);
        } catch {
          toast('Still broken — this video may be gone. Try another song.');
        }
      }, 2500);
    }
  });
  audio.addEventListener('timeupdate', () => {
    if (!dragging) paintProgress();
    try { pushPositionState(); } catch {}
    // Pre-resolve the next stream while this one still plays (gapless handoff).
    try {
      if (audio.duration && isFinite(audio.duration) && !shuffle) {
        if (audio.duration - (audio.currentTime || 0) < 45) warmNext();
      }
    } catch {}
    // Watchdog: if `ended` never fires (weird durations), loop by position.
    if (repeat === 'one' && audio.duration && !audio.paused && !audio.seeking
        && audio.duration - audio.currentTime < 0.4) {
      restartLoop();
      return;
    }
    // Background watchdog: if the track ended but `ended` was swallowed
    // (iOS suspending the page), advance from here instead of stalling.
    try {
      if (!audio.paused && audio.duration && isFinite(audio.duration)
          && audio.duration - (audio.currentTime || 0) < 0.35
          && audio.currentTime > 1 && repeat !== 'one') {
        if (!timeAdvAt || Date.now() - timeAdvAt > 5000) {
          timeAdvAt = Date.now();
          advanceFromPlayback('timeupdate');
        }
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
            audio.src = `/api/audio?v=${current.id}`;
            audio.currentTime = pos;
            audio.play().catch(() => { try { audio.pause(); } catch {} });
            return;
          }
          try {
            const m = await api(`/api/play?v=${current.id}`);
            current = { ...current, ...m };
            audio.volume = 0;
            audio.src = `/api/audio?v=${current.id}`;
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
  audio.addEventListener('loadedmetadata', () => paintProgress());
  const pline = $('pline');
  const ratioAt = (e) => {
    const r = pline.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  pline.addEventListener('pointerdown', (e) => {
    dragging = true;
    pline.classList.add('drag');
    try { pline.setPointerCapture(e.pointerId); } catch {}
    audio.muted = true; // silence the scrub — no more cursed sounds
    seekRatio(ratioAt(e));
  });
  pline.addEventListener('pointermove', (e) => { if (dragging) seekRatio(ratioAt(e)); });
  const endScrub = () => {
    if (!dragging) return;
    dragging = false;
    pline.classList.remove('drag');
    audio.muted = false;
  };
  pline.addEventListener('pointerup', endScrub);
  pline.addEventListener('pointercancel', endScrub);
  const setVolFill = (el) => el.style.setProperty('--v', `${el.value}%`);
  try {
    const sv = parseFloat(localStorage.getItem('muse:vol'));
    if (!isNaN(sv)) {
      userVol = Math.min(1, Math.max(0, sv));
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
    if (document.activeElement === $('q')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!audio.src) return;
      if (audio.paused) doPlay();
      else doPause();
    }
    if (e.key === 'ArrowRight' && audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
    if (e.key === 'ArrowLeft' && audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 10);
  });
}

/* ================= accounts · playlists · likes · For You ================= */
let me = null;
let currentView = 'home';
let viewArg = null;
let viewQueue = [];
let homeQueue = [];
let likedSet = new Set();

function avatarBG(hue) {
  hue = +hue || 0;
  return `linear-gradient(135deg, hsl(${hue} 75% 52%), hsl(${(hue + 50) % 360} 72% 32%)`;
}

function applyTheme() {
  document.documentElement.style.setProperty('--green', (me && me.accent) || '#1ed760');
}

async function refreshMe() {
  try {
    const j = await api('/api/me');
    me = j.user;
    swrPut('/api/me', j);
    if (!me) swrClear();
  } catch {
    me = null;
  }
  applyTheme();
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
  if (!me) {
    box.innerHTML = '<div class="plock">Sign in to build playlists that live here.</div>';
    return;
  }
  box.innerHTML = pls.map((p) => `
    <button class="pl${currentView === 'playlist' && +viewArg === p.id ? ' on' : ''}" data-pl="${p.id}" title="${escapeHtml(p.name)}">
      ${(p.custom_cover || p.cover) ? `<img src="${p.custom_cover || p.cover}" alt="" />` : `<span class="ph">${escapeHtml(((p.name || '#')[0] || '#').toUpperCase())}</span>`}
      <span class="nm">${escapeHtml(p.name)}</span>
    </button>`).join('');
  box.querySelectorAll('.pl').forEach((b) => b.addEventListener('click', () => showView('playlist', +b.dataset.pl)));
}

const F = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ic = (inner) => `<svg ${F}>${inner}</svg>`;
const ICO = {
  heart: ic('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
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
  x: ic('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  play: ic('<polygon points="5 3 19 12 5 21 5 3"/>'),
  pencil: ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
  trash: ic('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  refresh: ic('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  music: ic('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
};

const FA_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>';
const plEmptyHTML = () => `<div class="mempty">${ICO.music}<b>No playlists yet</b><span>Make your first Playlist below</span></div>`;
const vplayIc = (attrs) => `<button class="vplay-ic" ${attrs} title="Play">
  <svg class="ic-play" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor"><path d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9s33.7 8.1 48.5-.9L361 297c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>
  <svg class="ic-pause" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512" fill="currentColor"><path d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"/></svg>
</button>`;

/* Header discs mirror the transport: pause while their list plays. */
function paintHeaderPlay(view = currentView, arg = viewArg) {
  const playingList = !audio.paused && !!audio.src
    && queueSource === view
    && (view !== 'playlist' || queuePid === arg);
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
  return true;
}

function trackMeta(id, card) {
  // View list first: it carries extra keys (item_id) the search queue lacks.
  const fromLists = viewQueue.find((r) => r.id === id)
    || queue.find((r) => r.id === id);
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
    if (!matchMedia('(max-width: 760px)').matches) return;
    const bar = $('tabbar');
    const ind = $('tabInd');
    if (!bar || !ind) return;
    let btn = bar.querySelector(`button[data-view="${view}"]`);
    // Library has no data-view (it opens a sheet) — highlight it while open.
    if (view === 'library') btn = $('tabLib');
    if (!btn) return;
    const br = bar.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    ind.style.left = `${r.left - br.left + 6}px`;
    ind.style.width = `${r.width - 12}px`;
  } catch {}
}

async function restorePlace() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('muse:place') || 'null'); } catch {}
  if (!saved) return;
  if ((saved.view === 'playlist' || saved.view === 'liked' || saved.view === 'foryou') && !me) return;
  if (saved.view === 'playlist' && saved.arg) showView('playlist', +saved.arg);
  else if (saved.view === 'liked') showView('liked');
  else if (saved.view === 'foryou') showView('foryou');
  else if (saved.view === 'home' && saved.q && saved.q.trim().length >= 2) {
    $('q').value = saved.q;
    doSearch(saved.q);
  }
}

async function showView(name, arg = null) {
  closeMenu();
  if ($('bigplayer').hidden) ensurePlayerHome();
  window.scrollTo(0, 0);
  if (name === currentView && (name !== 'playlist' || arg === viewArg)) return; // already here — no replay
  viewArg = arg;
  setViewNav(name);
  clearTimeout(searchTimer);
  searchToken++;
  if (name === 'home') { $('view').hidden = true; $('view').innerHTML = ''; return; }
  setHome(false);
  $('grid').hidden = true;
  $('loading').hidden = true;
  $('empty').hidden = true;
  $('homeFy').hidden = true;
  const v = $('view');
  v.hidden = false;
  if (name === 'foryou') return renderForYou(v);
  if (name === 'liked') return renderLiked(v);
  if (name === 'playlist') return renderPlaylist(v, arg);
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
    <img src="${t.thumbnail}" data-playrow="${t.id}" alt="" loading="lazy" draggable="false"
      onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${t.id}/hqdefault.jpg'" />
    <span class="tt" data-playrow="${t.id}" title="${escapeHtml(t.title)}"><span class="t">${escapeHtml(t.title)}</span>${t.duration ? `<span class="tdur">${fmt(t.duration)}</span>` : ''}</span>
    <button class="icb${t._liked ? ' loved' : ''}" data-like="${t.id}" title="Like">${ICO.heart}</button>
  </div>`;
}

function recoCardHTML(t, i) {
  return `
  <div class="card" style="animation-delay:${Math.min(i * 55, 440)}ms" data-play="${t.id}" title="Play">
    <span class="likedot">${ICO.heart}</span>
    <div class="thumb">
      <img loading="lazy" decoding="async" draggable="false" src="${t.thumbnail}"
        onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${t.id}/hqdefault.jpg'" alt="" />
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
          '<div class="vempty">Like a few songs or answer the taste survey — then this page reads your mind.</div>');
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
    const cover = pl.custom_cover || (pl.tracks.length ? pl.tracks[0].thumbnail : '');
    v.innerHTML = `<div class="vhead">
        <div class="vcover has-edit" data-cover="${pl.id}" title="Change cover">${cover ? `<img src="${cover}" alt="" />` : ICO.music}<button class="editcover" data-cover="${pl.id}" title="Change cover" tabindex="-1">${ICO.pencil}</button></div>
        <div style="min-width:0;flex:1"><div class="vtitle-row"><h2 id="plName">${escapeHtml(pl.name)}</h2>
        <button class="pencil" data-rename="1" title="Rename">${ICO.pencil}</button></div>
        <p>${pl.tracks.length} songs${total ? ' • ' + fmt(total) : ''}</p>
        <div class="vactions">
          ${pl.tracks.length ? vplayIc('data-playall="1"') : ''}
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
  refreshCounts();
}

async function toggleLike(id, meta = {}) {
  vibe();
  if (!me) { openAuth('signin'); return null; }
  try {
    const r = await post('/api/like', { video_id: id, title: meta.title || '',
      thumbnail: meta.thumbnail || meta.thumb || '', duration: meta.duration ?? null });
    paintLike(id, r.liked);
    toast(r.liked ? 'Liked' : 'Unliked', r.liked);
    return r.liked;
  } catch (e) {
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
    const j = await api('/api/playlists');
    if (menuTrack !== track) return; // menu moved on
    box.innerHTML = j.playlists.length ? '' : plEmptyHTML();
    j.playlists.forEach((p) => {
      const b = document.createElement('button');
      b.innerHTML = `${(p.custom_cover || p.cover) ? `<img src="${p.custom_cover || p.cover}" alt="" />` : ICO.music}<span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</span>`;
      b.addEventListener('click', async () => {
        try {
          await post(`/api/playlists/${p.id}/tracks`, { video_id: track.id, title: track.title || '',
            thumbnail: track.thumbnail || '', duration: track.duration ?? null });
          toast(`Added to ${p.name}`, true);
        } catch (e) { toast('Add failed: ' + e.message); }
        closeMenu();
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
      // Phone sheet is NOT painted by refreshCounts (desktop sidebar only) —
      // remove the row with animation so it doesn't ghost.
      try {
        const srow = document.querySelector(`#sheetPl [data-pid="${pid}"]`);
        if (srow) {
          srow.classList.add('leaving');
          setTimeout(() => { try { srow.remove(); } catch {} }, 380);
        }
        if (!$('sheet').hidden) {
          // Re-sync after the leave animation so counts/order match server.
          setTimeout(() => { try { openLibrary(); } catch {} }, 420);
        }
      } catch {}
      if (currentView === 'playlist' && viewArg === pid) showHome();
    } catch {}
  });
}

document.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // native menu never appears
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
  if (drag && drag.active) e.preventDefault();
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
  try {
    const j = await api('/api/playlists');
    if (menuTrack !== track) return;
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
          toast(`Added to ${p.name}`, true);
        } catch (e) { toast('Add failed: ' + e.message); }
        closeMenu();
        refreshCounts();
      });
      box.appendChild(b);
    });
  } catch {
    box.innerHTML = '';
  }
}

/* ---------- custom playlist covers + mini editor ---------- */
let coverPid = null;

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
  openModal(`
    <h2>Playlist cover</h2>
    <div class="cov-stage" id="covStage">
      <img id="covBase" alt="" draggable="false" />
      <div class="cov-crop" id="covCrop">
        <img id="covTop" alt="" draggable="false" />
        <span class="cov-h" data-h="nw"></span><span class="cov-h" data-h="ne"></span>
        <span class="cov-h" data-h="sw"></span><span class="cov-h" data-h="se"></span>
      </div>
    </div>
    <div class="cov-tools" id="covTools">
      <button class="toolbtn" data-t="gray" title="Black &amp; white"><svg width="19" height="19" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg></button>
    </div>
    <div class="cov-brow" title="Brightness"><svg width="17" height="17" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg><input type="range" id="covBright" min="0.5" max="1.5" step="0.01" value="1" /></div>
    <div class="merr" id="covErr"></div>
    <div class="mrow">
      <button class="mbtn ghost" id="covCancel">Cancel</button>
      <button class="mbtn primary" id="covSave">Save</button>
    </div>`);
  const base = $('covBase');
  const top = $('covTop');
  const stage = $('covStage');
  const crop = $('covCrop');
  let nw = 0, nh = 0, gray = false, bright = 1;
  let cropR = null; // {x, y, s} in stage px
  const filt = () => `grayscale(${gray ? 1 : 0}) brightness(${bright})`;
  const fit = () => {
    const W = stage.clientWidth;
    const H = stage.clientHeight || W;
    const sc = Math.min(W / nw, H / nh);
    const dw = nw * sc;
    const dh = nh * sc;
    return { W, H, dw, dh, ix: (W - dw) / 2, iy: (H - dh) / 2 };
  };
  const paint = () => {
    if (!nw || !cropR) return;
    const { W, H, dw, dh, ix, iy } = fit();
    for (const [el, extra] of [[base, 'brightness(0.42) '], [top, '']]) {
      el.style.left = `${ix}px`;
      el.style.top = `${iy}px`;
      el.style.width = `${dw}px`;
      el.style.height = 'auto';
      el.style.filter = extra + filt();
    }
    let { x, y, s } = cropR;
    s = Math.max(60, Math.min(s, dw, dh));
    x = Math.min(ix + dw - s, Math.max(ix, x));
    y = Math.min(iy + dh - s, Math.max(iy, y));
    cropR = { x, y, s };
    crop.style.left = `${x}px`;
    crop.style.top = `${y}px`;
    crop.style.width = `${s}px`;
    crop.style.height = `${s}px`;
    top.style.left = `${ix - x}px`;
    top.style.top = `${iy - y}px`;
    top.style.width = `${dw}px`;
    top.style.height = 'auto';
  };
  base.addEventListener('load', () => {
    nw = base.naturalWidth;
    nh = base.naturalHeight;
    if (!nw || !nh) return;
    top.src = url;
    const { dw, dh, ix, iy } = fit();
    const s = Math.min(dw, dh);
    cropR = { x: ix + (dw - s) / 2, y: iy + (dh - s) / 2, s };
    paint();
  });
  base.addEventListener('error', () => {
    try {
      let err = $('covErr');
      if (err) {
        err.textContent = 'Could not read that image (HEIC from iPhone camera often fails). Try a JPG/PNG screenshot instead.';
      }
    } catch {}
  });
  base.src = url;
  $('covBright').addEventListener('input', (e) => { bright = +e.target.value; paint(); });
  document.querySelector('#covTools [data-t="gray"]').addEventListener('click', (e) => {
    gray = !gray;
    e.currentTarget.classList.toggle('on', gray);
    paint();
  });
  const pointers = new Map();
  let mode = null;
  const resizeTo = (px, py, corner) => {
    const r = stage.getBoundingClientRect();
    const x = px - r.left;
    const y = py - r.top;
    let { x: cx0, y: cy0, s } = cropR;
    if (corner === 'se') { s = Math.min(x - cx0, y - cy0); }
    else if (corner === 'nw') {
      const ax = cx0 + s, ay = cy0 + s;
      s = Math.min(ax - x, ay - y); cx0 = ax - s; cy0 = ay - s;
    } else if (corner === 'ne') {
      const ax = cx0, ay = cy0 + s;
      s = Math.min(x - ax, ay - y); cy0 = ay - s;
    } else {
      const ax = cx0 + s, ay = cy0;
      s = Math.min(ax - x, y - ay); cx0 = ax - s;
    }
    cropR = { x: cx0, y: cy0, s };
    paint();
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!cropR) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const h = e.target.closest('.cov-h');
    if (h) {
      mode = { kind: 'resize', corner: h.dataset.h };
    } else if (pointers.size === 2) {
      const p = [...pointers.values()];
      mode = { kind: 'pinch', d: Math.max(1, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)),
               s: cropR.s, cx: cropR.x + cropR.s / 2, cy: cropR.y + cropR.s / 2 };
    } else {
      mode = { kind: 'move', dx: e.clientX - cropR.x, dy: e.clientY - cropR.y };
    }
    try { stage.setPointerCapture(e.pointerId); } catch {}
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !cropR) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && mode && mode.kind !== 'resize') {
      const p = [...pointers.values()];
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const ns = mode.s * d / mode.d;
      cropR.s = ns;
      cropR.x = mode.cx - ns / 2;
      cropR.y = mode.cy - ns / 2;
      paint();
      return;
    }
    if (!mode) return;
    if (mode.kind === 'move') {
      cropR.x = e.clientX - mode.dx;
      cropR.y = e.clientY - mode.dy;
      paint();
    } else if (mode.kind === 'resize') {
      resizeTo(e.clientX, e.clientY, mode.corner);
    }
  });
  const endP = (e) => {
    if (e && e.pointerId != null) pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      mode = null;
    } else if (pointers.size === 1 && cropR) {
      const p = [...pointers.values()][0];
      mode = { kind: 'move', dx: p.x - cropR.x, dy: p.y - cropR.y };
    }
  };
  stage.addEventListener('pointerup', endP);
  stage.addEventListener('pointercancel', endP);
  $('covCancel').addEventListener('click', () => { URL.revokeObjectURL(url); closeModal(); });
  $('covSave').addEventListener('click', () => {
    const pid = coverPid;
    const errBox = $('covErr');
    try {
      if (!pid) { if (errBox) errBox.textContent = 'No playlist selected.'; return; }
      if (!cropR || !nw) { if (errBox) errBox.textContent = 'Image still loading — wait a second and try again.'; return; }
      const S = 512;
      const { dw, ix, iy } = fit();
      const scale = nw / dw;
      const sx = (cropR.x - ix) * scale;
      const sy = (cropR.y - iy) * scale;
      const ss = cropR.s * scale;
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const cx = cv.getContext('2d');
      try { cx.filter = filt(); } catch {}
      cx.drawImage(base, sx, sy, ss, ss, 0, 0, S, S);
      cv.toBlob(async (blob) => {
        if (!blob) { if (errBox) errBox.textContent = 'Could not process image.'; return; }
        try {
          const r = await fetch(`/api/playlists/${pid}/cover`, {
            method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || r.status);
          URL.revokeObjectURL(url);
          closeModal();
          // Only touch the artwork if we're still looking at that playlist.
          if (currentView === 'playlist' && viewArg === pid) swapDetailCover(j.custom_cover);
          refreshCounts();
        } catch (e) { if (errBox) errBox.textContent = 'Save failed: ' + (e.message || 'error'); }
      }, 'image/jpeg', 0.9);
    } catch (e) { if (errBox) errBox.textContent = 'Save failed: ' + (e.message || 'error'); }
  });
}
function openModal(html) {
  $('modalBox').innerHTML = html;
  $('modalWrap').hidden = false;
}
function closeModal() { $('modalWrap').hidden = true; }

function openAuth(tab = 'signin') {
  openModal(`
    <div class="mtabs">
      <button data-atab="signin" class="${tab === 'signin' ? 'on' : ''}">Sign in</button>
      <button data-atab="signup" class="${tab === 'signup' ? 'on' : ''}">Create account</button>
    </div>
    <h2 id="authTitle">${tab === 'signin' ? 'Welcome back' : 'Join Muse'}</h2>
    <p class="msub">Playlists, likes and a For You page that learns your ears.</p>
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
      maybeSurvey();
      if (currentView === 'home') loadHomeFy();
      if (['foryou', 'liked', 'playlist'].includes(currentView)) showView(currentView, viewArg);
    } catch (e) { err.textContent = e.message; }
  };
  $('aGo').addEventListener('click', submit);
  $('aCancel').addEventListener('click', closeModal);
  $('aPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  $('aUser').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => $('aUser').focus(), 60);
}

const GENRES = ['Phonk', 'Slowed', 'Lo-fi', 'Hip-hop', 'Pop', 'Rock', 'EDM', 'Jazz', 'R&B', 'Metal', 'Indie', 'Latin', 'K-pop', 'Classical', 'Ambient', 'Soul'];
const MOODS = ['Workout', 'Chill', 'Focus', 'Party', 'Night drive', 'Rainy day'];

function openSurvey() {
  openModal(`
    <h2>What moves you?</h2>
    <p class="msub">Pick what you love — Muse builds your first For You mix instantly. Skip anytime.</p>
    <label class="fl">Genres</label>
    <div class="pickchips" id="svG">${GENRES.map((g) => `<button data-v="${g}">${g}</button>`).join('')}</div>
    <label class="fl">Moments</label>
    <div class="pickchips" id="svM">${MOODS.map((g) => `<button data-v="${g}">${g}</button>`).join('')}</div>
    <label class="fl">Artists (comma separated)</label>
    <input type="text" id="svA" placeholder="e.g. DJ Javi26, Lofi Girl" />
    <div class="mrow">
      <button class="mbtn ghost" id="svSkip">Skip</button>
      <button class="mbtn primary" id="svSave">Tune my mix</button>
    </div>`);
  document.querySelectorAll('.pickchips button').forEach((b) =>
    b.addEventListener('click', () => b.classList.toggle('on')));
  $('svSkip').addEventListener('click', () => {
    try { sessionStorage.museSurveySkip = '1'; } catch {}
    closeModal();
  });
  $('svSave').addEventListener('click', async () => {
    const pick = (id) => [...document.querySelectorAll(`#${id} button.on`)].map((b) => b.dataset.v);
    const artists = $('svA').value.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      await post('/api/survey', { genres: pick('svG'), moods: pick('svM'), artists });
      closeModal();
      toast('Taste saved — For You is tuned', true);
      if (currentView === 'foryou') showView('foryou');
    } catch (e) { toast('Survey failed: ' + e.message); }
  });
}

async function maybeSurvey() {
  if (!me) return;
  try { if (sessionStorage.museSurveySkip) return; } catch {}
  try {
    const s = await api('/api/survey');
    if (!s.survey) openSurvey();
  } catch { /* offline-ish */ }
}

function openPlModal(pending = null) {
  // No naming step: playlists are born numbered (Плейлист 1, 2, …),
  // rename later with the pencil whenever you like.
  if (!me) { openAuth('signin'); return; }
  createPlaylistNow(pending);
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
    // Pop the newborn row so you see exactly where it landed.
    const row = document.querySelector(`#plList [data-pl="${p.id}"]`);
    if (row) {
      row.classList.add('fresh');
      setTimeout(() => row.classList.remove('fresh'), 1000);
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    // Phone: the sheet stays open (we no longer close it first), so repaint
    // in place. If it was closed, reopen it so the newborn is visible —
    // this is what previously forced a 2nd Library tap.
    try {
      if (isPhone()) {
        await openLibrary();
        const srow = document.querySelector(`#sheetPl [data-pid="${p.id}"]`);
        if (srow) {
          try { vibe(12); } catch {}
          srow.classList.add('fresh');
          try { srow.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch {}
          setTimeout(() => { try { srow.classList.remove('fresh'); } catch {} }, 1100);
        }
      }
      else if (!$('sheet').hidden) openLibrary();
    } catch { if (!$('sheet').hidden) openLibrary(); }
  } catch {}
}

/* Hard refresh: nuke service workers + caches, then reload truly fresh. */
async function hardRefresh() {
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

function openProfile() {
  if (!me) { openAuth('signin'); return; }
  const swatches = ['#1ed760', '#1da1f2', '#a78bfa', '#ff5ea8', '#ffb020', '#ff4d4d'];
  openModal(`
    <h2>Your profile</h2>
    <p class="msub">Make Muse yours — name, color story, avatar energy.</p>
    <div class="profiletop">
      <span class="avatar big" id="pfAv">${escapeHtml((me.display[0] || '?').toUpperCase())}</span>
      <div style="flex:1;min-width:0">
        <label class="fl" style="margin-top:0">Display name</label>
        <input type="text" id="pfName" maxlength="24" value="${escapeHtml(me.display)}" />
      </div>
    </div>
    <label class="fl">Accent color</label>
    <div class="swatches" id="pfSw">
      ${swatches.map((c) => `<button data-c="${c}" style="background:${c};color:${c}" class="${c.toLowerCase() === (me.accent || '').toLowerCase() ? 'on' : ''}" title="${c}"></button>`).join('')}
      <input type="color" id="pfCustom" value="${me.accent}" title="Custom" />
    </div>
    <label class="fl">Avatar energy</label>
    <div class="huerow">
      <input type="range" id="pfHue" min="0" max="360" value="${me.hue}" />
    </div>
    <div class="mrow">
      <button class="mbtn ghost" id="pfLogout">Log out</button>
      <button class="mbtn primary" id="pfSave">Save</button>
    </div>
    <div class="mrow">
      <button class="mbtn ghost" id="pfHard">Hard refresh</button>
    </div>`);
  let accent = me.accent, hue = me.hue;
  const paintAv = () => {
    $('pfAv').style.background = avatarBG(hue);
    $('pfAv').textContent = (($('pfName').value.trim()[0]) || '?').toUpperCase();
  };
  $('pfSw').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    accent = b.dataset.c;
    $('pfSw').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('pfCustom').addEventListener('input', (e) => {
    accent = e.target.value;
    $('pfSw').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
  });
  $('pfHue').addEventListener('input', (e) => { hue = +e.target.value; paintAv(); });
  $('pfName').addEventListener('input', paintAv);
  paintAv();
  $('pfSave').addEventListener('click', async () => {
    try {
      const j = await req('PATCH', '/api/me', { display: $('pfName').value.trim(), accent, hue });
      me = j.user;
      applyTheme();
      closeModal();
      await refreshMe();
      toast('Profile saved', true);
    } catch (e) { toast('Save failed: ' + e.message); }
  });
  $('pfHard').addEventListener('click', hardRefresh);
  $('pfLogout').addEventListener('click', async () => {
    try { await post('/api/logout', {}); } catch {}
    me = null;
    swrClear();
    likedSet = new Set();
    homeFyKey = '';
    $('homeFy').hidden = true;
    closeModal();
    await refreshMe();
    await refreshCounts();
    paintLikedSet();
    if (['foryou', 'liked', 'playlist'].includes(currentView)) showView(currentView, viewArg);
    toast('Signed out');
  });
}

/* ---------- row + misc actions (delegated) ---------- */
function rowTrack(rowEl, id) {
  return viewQueue.concat(queue).find((r) => r.id === id) || {
    id, title: rowEl.querySelector('.tt')?.getAttribute('title') || '',
    thumbnail: rowEl.querySelector('img')?.src || '' };
}

document.addEventListener('click', async (e) => {
  if (lpFired) {
    lpFired = false;
    return;
  } // long-press ghost click
  if (justDropped()) return; // reorder drop ghost click
  const t = (sel) => e.target.closest(sel);
  let el;
  if ((el = t('[data-like]'))) {
    const row = el.closest('.trow');
    await toggleLike(el.dataset.like, row ? rowTrack(row, el.dataset.like) : (trackMeta(el.dataset.like) || {}));
    if (currentView === 'liked' && !likedSet.has(el.dataset.like)) {
      el.closest('.trow')?.remove();
      if (!document.querySelector('#view .trow')) renderLiked($('view'));
    }
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
          await req('PATCH', `/api/playlists/${viewArg}`, { name });
          swapBack(name);
          refreshCounts(); // sidebar label only — the list itself never re-renders
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

document.addEventListener('pointerdown', (e) => {
  const row = e.target.closest('#view .trow');
  if (!row || (currentView !== 'playlist' && currentView !== 'liked')) return;
  const isTouch = e.pointerType === 'touch';
  drag = { item: row.dataset.row, row, y0: e.clientY, active: false,
           before: null, line: null, ghost: null,
           armed: !isTouch, touch: isTouch };
  clearTimeout(armTimer);
  if (isTouch) {
    armTimer = setTimeout(() => {
      if (!drag) return;
      drag.armed = true;
      try { navigator.vibrate?.(20); } catch {}
    }, 320);
  }
});

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.touch && !drag.armed) return; // finger: still a maybe-scroll, hands off
  if (!drag.active) {
    if (Math.abs(e.clientY - drag.y0) < 8) return;
    drag.active = true;
    closeMenu(); // a drag wins over any open menu
    const rect = drag.row.getBoundingClientRect();
    drag.ghost = drag.row.cloneNode(true);
    drag.ghost.classList.add('drag-ghost');
    drag.ghost.style.width = `${rect.width}px`;
    drag.ghost.style.left = `${rect.left}px`;
    drag.ghost.style.top = `${rect.top}px`;
    document.body.appendChild(drag.ghost);
    drag.row.classList.add('dragging');
    document.body.style.cursor = 'grabbing';
    drag.line = document.createElement('div');
    drag.line.className = 'drop-line';
  }
  if (e.cancelable) e.preventDefault();
  drag.ghost.style.transform = `translateY(${e.clientY - drag.y0}px)`;
  const rows = [...document.querySelectorAll('#view .trow')].filter((r) => r !== drag.row);
  drag.before = null;
  for (const r of rows) {
    const rect = r.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      drag.before = r;
      break;
    }
  }
  if (drag.before) drag.before.before(drag.line);
  else $('view').appendChild(drag.line);
});

async function endDragCommit(e) {
  clearTimeout(armTimer);
  if (!drag) return;
  const d = drag;
  drag = null;
  d.ghost?.remove();
  d.line?.remove();
  d.row.classList.remove('dragging');
  document.body.style.cursor = '';
  if (!d.active) return; // plain click on the grip
  lastDropAt = Date.now();
  // Settle instantly in the DOM the eye is already looking at — no rebuild flash.
  if (d.before && d.before.isConnected) d.before.before(d.row);
  else $('view').appendChild(d.row);
  try {
    d.row.animate(
      [{ boxShadow: '0 0 0 2px rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.06)' }, {}],
      { duration: 700, easing: 'cubic-bezier(0.22,1,0.36,1)' });
  } catch {}
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
document.addEventListener('pointercancel', () => {
  clearTimeout(armTimer);
  if (!drag) return;
  drag.ghost?.remove();
  drag.line?.remove();
  drag.row.classList.remove('dragging');
  document.body.style.cursor = '';
  drag = null;
});

/* ---------- self-update notice ---------- */
async function checkUpdate() {
  try {
    const j = await (await fetch(`/api/version?t=${Date.now()}`, { cache: 'no-store' })).json();
    if (j.build > (window.__museBuild || 0)) showUpdateBar(j.build);
  } catch { /* offline — stay quiet */ }
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
const isPhone = () => matchMedia('(max-width: 760px)').matches;
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
    // Move failed — never strand the footer, abort the overlay instead.
    ensurePlayerHome();
    return;
  }
  $('bigplayer').hidden = false;
}

function collapsePlayer() {
  if (!playerKids || $('bigplayer').hidden) return;
  const bp = $('bigplayer');
  // Animated shrink: slide the fullscreen down/fade, then hand nodes back
  // and pop the mini player in. Instant hide felt like a cut.
  try {
    if (isPhone() && !REDUCED) {
      if (bp.dataset.closing) return;
      bp.dataset.closing = '1';
      bp.classList.add('closing');
      setTimeout(() => {
        try {
          playerKids.forEach((k) => { if (k && k.isConnected) $('player').appendChild(k); });
          ensurePlayerHome();
          bp.hidden = true;
          bp.classList.remove('closing');
          delete bp.dataset.closing;
          const foot = $('player');
          try {
            foot.classList.remove('pop-in');
            void foot.offsetWidth;
            foot.classList.add('pop-in');
            setTimeout(() => { try { foot.classList.remove('pop-in'); } catch {} }, 500);
          } catch {}
        } catch {}
      }, 360);
      return;
    }
  } catch {}
  playerKids.forEach((k) => { if (k && k.isConnected) $('player').appendChild(k); });
  ensurePlayerHome();
  $('bigplayer').hidden = true;
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
      u.innerHTML = `<span class="avatar" style="background:${avatarBG(me.hue)}">${escapeHtml(((me.display || '?')[0] || '?').toUpperCase())}</span>
        <span style="flex:1;min-width:0"><b>${escapeHtml(me.display)}</b><i>@${escapeHtml(me.username)}</i></span>`;
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
      j.playlists.forEach((p) => {
        const b = document.createElement('button');
        b.className = 'sheet-row';
        b.dataset.pid = p.id;
        b.innerHTML = `${(p.custom_cover || p.cover) ? `<img src="${p.custom_cover || p.cover}" alt="" />` : `<span class="ph">${escapeHtml(((p.name || '#')[0] || '#').toUpperCase())}</span>`}
          <span class="nm">${escapeHtml(p.name)}</span>`;
        b.addEventListener('click', () => {
          closeLibrary();
          showView('playlist', p.id);
        });
        box.appendChild(b);
      });
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
      if (b.dataset.view === 'home') showHome();
      else showView(b.dataset.view);
    }));
  $('sideBrand').addEventListener('click', (e) => {
    vibe();
    if (e.target.closest('#acctLink')) {
      if (me) openProfile();
      else openAuth('signin');
      return;
    }
    showHome();
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
  $('modalWrap').addEventListener('click', (e) => { if (e.target === $('modalWrap')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMenu(); closeModal(); }
  });
  document.addEventListener('pointerdown', (e) => {
    const m = $('menu');
    if (m && !m.hidden && !m.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu();
  });
  // Returning users boot from this device's last copy; the network answer
  // only redraws if the signed-in account actually changed.
  const bootMe = swrGet('/api/me')?.user || null;
  const afterMe = () => { refreshCounts(); if (currentView === 'home') loadHomeFy(); restorePlace(); };
  if (bootMe) { me = bootMe; applyTheme(); afterMe(); }
  refreshMe().then(() => {
    if (!bootMe || !me || me.id !== bootMe.id) {
      afterMe();
      paintLikedSet();
      if (!me && ['foryou', 'liked', 'playlist'].includes(currentView)) showView('home');
    }
    maybeSurvey();
  });
  // Measured header offset: the docked list header (.vhead) pins exactly
  // under the sticky search bar, whatever its height actually is.
  const fitTop = () => {
    try {
      if (!matchMedia('(max-width: 760px)').matches) return;
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
      if (!matchMedia('(max-width: 760px)').matches) return;
      const tab = document.querySelector('#tabbar');
      const pl = document.querySelector('footer.player');
      let h = 24;
      if (tab) h += tab.getBoundingClientRect().height;
      if (pl && !pl.hidden) h += pl.getBoundingClientRect().height;
      // Never shrink below the CSS baseline (280px) — that baseline is what
      // guarantees the last row clears the mini-player + tab bar.
      const need = Math.max(280, Math.ceil(h) + 40);
      document.querySelector('.wrap').style.paddingBottom = `${need}px`;
    } catch {}
    try { fitTop(); } catch {}
  };
  setInterval(fitBottom, 1500);
  window.addEventListener('resize', () => { try { fitBottom(); } catch {} try { moveTabInd(currentView); } catch {} });
  window.addEventListener('orientationchange', () => setTimeout(() => { try { moveTabInd(currentView); } catch {} }, 300));
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
    if (me) openProfile();
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
    matchMedia('(max-width: 760px)').addEventListener('change', (e) => { if (!e.matches) collapsePlayer(); });
  } catch {}
  setTimeout(checkUpdate, 8000);
  setInterval(checkUpdate, 30000);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function bootWhenReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}
bootWhenReady(init);
bootWhenReady(bootAccountUI);
