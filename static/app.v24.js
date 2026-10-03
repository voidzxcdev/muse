/* Muse frontend — vanilla, no deps. Type, stream, done. */
const $ = (id) => document.getElementById(id);
const audio = $('audio');
const SPRING = 'cubic-bezier(0.22,1,0.36,1)';

let queue = [];      // last search results (prev/next walks this)
let qi = -1;
let current = null;  // {id, ...}
let dragging = false;
let shuffle = false;
let repeat = 'off'; // off | all | one
let searchTimer = null;
let searchToken = 0;
let proxiedOnce = false;

const fmt = (s) => {
  if (s == null || isNaN(s) || !isFinite(s)) return s ? String(s) : '';
  s = Math.floor(s);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastT = null;
function toast(msg, ok = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('ok', ok);
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 4200);
}

async function api(path) {
  const r = await fetch(path);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function req(method, path, body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const post = (p, b) => req('POST', p, b);

const setHome = (h) => document.body.classList.toggle('home', h);

/* ---------- live search (every letter, debounced, stale-safe) ---------- */
function skel(n = 8) {
  $('loading').innerHTML = Array.from({ length: n }, () => '<div class="skel"></div>').join('');
  $('loading').hidden = false;
}

function cardHTML(r, i) {
  return `
  <div class="card" style="animation-delay:${Math.min(i * 55, 440)}ms" data-play="${r.id}" title="Play">
    <button class="dots" data-menu="${r.id}" title="More">⋮</button>
    <span class="likedot"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>
    <div class="thumb">
      <img ${i < 4 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" src="${r.thumbnail}"
        onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${r.id}/hqdefault.jpg'" alt="" />
      <span class="go"><span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></span></span>
      ${r.duration ? `<span class="dur">${fmt(r.duration)}</span>` : ''}
    </div>
    <h3>${escapeHtml(r.title)}</h3>
  </div>`;
}

function prewarm(results) {
  // Thumbnails: force the first rows into cache instantly.
  // Top song: touch its stream so the CDN edge + server cache are hot.
  try {
    results.slice(0, 6).forEach((r) => { const im = new Image(); im.decoding = 'async'; im.src = r.thumbnail; });
    if (results[0]) fetch(`/api/play?v=${results[0].id}`).catch(() => {});
  } catch { /* best-effort */ }
}

function showHome() {
  clearTimeout(searchTimer);
  searchToken++;
  queue = [];
  qi = -1;
  setViewNav('home');
  $('view').hidden = true;
  $('view').innerHTML = '';
  $('grid').hidden = true;
  $('grid').innerHTML = '';
  $('loading').hidden = true;
  $('empty').hidden = false;
  setHome(true);
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
  $('empty').hidden = true;
  $('grid').hidden = true;
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

/* ---------- real FFT visualizer (Web Audio, same-origin proxy stream) ---------- */
let actx = null, analyser = null, freq = null, vizReal = false, zeroFrames = 0;
const BANDS = [[1, 2], [3, 5], [6, 9], [10, 15], [16, 24]];

function initViz() {
  if (actx) { try { actx.resume(); } catch {} return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.78;
    src.connect(analyser);
    analyser.connect(actx.destination);
    freq = new Uint8Array(analyser.frequencyBinCount);
    requestAnimationFrame(vizLoop);
  } catch { /* no Web Audio — CSS fallback keeps dancing */ }
}

function vizLoop() {
  const bars = document.querySelectorAll('#qbadge .vq i');
  if (analyser && freq && !audio.paused && !audio.ended && audio.src) {
    analyser.getByteFrequencyData(freq);
    let peak = 0;
    BANDS.forEach((b, i) => {
      let s = 0, n = 0;
      for (let k = b[0]; k <= b[1] && k < freq.length; k++) { s += freq[k]; n++; }
      const v = n ? s / (n * 255) : 0;
      peak = Math.max(peak, v);
      if (bars[i]) bars[i].style.transform = `scaleY(${Math.max(0.12, Math.min(1, v * 1.15)).toFixed(3)})`;
    });
    if (peak > 0.02) {
      zeroFrames = 0;
      if (!vizReal) { vizReal = true; $('qbadge').classList.add('live'); }
    } else if (++zeroFrames > 180) {
      // Tainted/blocked stream (all zeros) — fall back to the CSS dance.
      vizReal = false;
      $('qbadge').classList.remove('live');
      zeroFrames = 0;
    }
  }
  requestAnimationFrame(vizLoop);
}

/* ---------- playback (proxy first, direct URL as fallback) ---------- */
function swapArt(url) {
  const art = $('art');
  if (!url || art.getAttribute('src') === url) return;
  art.src = url;
  try {
    art.animate(
      [{ opacity: 0, transform: 'scale(0.92)', filter: 'blur(6px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }],
      { duration: 600, easing: SPRING }
    );
  } catch { /* WAAPI unavailable */ }
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

async function playId(id, meta = {}, list = null) {
  finalizePrev(false);
  if (list) {
    queue = list.slice();
    qi = Math.max(0, list.findIndex((r) => r.id === id));
  }
  const item = queue.find((r) => r.id === id) || meta;
  if (!list) qi = queue.findIndex((r) => r.id === id);
  current = { id, ...item };
  lastPlay = { ...current, t0: Date.now() };
  proxiedOnce = false;
  initViz();
  $('player').hidden = false;
  document.body.classList.add('has-player');
  $('ptitle').textContent = item.title || 'Loading…';
  swapArt(item.thumbnail);
  setPlaying(false);
  try {
    const m = await api(`/api/play?v=${id}`);
    current = { ...m };
    audio.src = `/api/audio?v=${id}`; // same-origin → analyser reads real FFT
    $('ptitle').textContent = m.title;
    swapArt(m.thumbnail);
    $('dur').textContent = fmt(m.duration);
    $('qbadge').title = m.abr ? `${Math.round(m.abr)} kbps ${m.ext}` : 'Now playing';
    if (me) markLiked([id]);
    await audio.play();
    mediaSession(m);
  } catch (e) {
    toast('Could not play: ' + e.message);
  }
}

function mediaSession(m) {
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: m.title || '',
      artwork: m.thumbnail ? [{ src: m.thumbnail }] : []
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', step(-1));
    navigator.mediaSession.setActionHandler('nexttrack', step(1));
  } catch { /* older browsers */ }
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
  $('iPlay').hidden = p;
  $('iPause').hidden = !p;
  if (!vizReal) $('qbadge').classList.toggle('paused', !p);
  try {
    $('bPlay').classList.remove('pop');
    void $('bPlay').offsetWidth;
    $('bPlay').classList.add('pop');
  } catch { /* cosmetic */ }
}

/* ---------- events ---------- */
let introDone = false;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Letter-cascade: split the intro pill text for a staggered rise.
(function splitIntro() {
  const pill = document.querySelector('.intro-pill');
  if (!pill) return;
  const text = pill.textContent;
  pill.textContent = '';
  [...text].forEach((c, i) => {
    if (c === ' ') { pill.appendChild(document.createTextNode(' ')); return; }
    const s = document.createElement('span');
    s.className = 'ch';
    s.style.setProperty('--i', i);
    s.textContent = c;
    pill.appendChild(s);
  });
})();

function hardCutIntro() {
  introDone = true;
  $('intro')?.remove();
  document.body.classList.remove('intro');
  try { $('q').focus({ preventScroll: true }); } catch { try { $('q').focus(); } catch {} }
}

function endIntro() {
  if (introDone) return;
  if (REDUCED) { hardCutIntro(); return; }
  const intro = $('intro');
  const pill = document.querySelector('.intro-pill');
  const brand = document.querySelector('#sideBrand');
  if (!intro || !pill || !brand) { hardCutIntro(); return; }
  introDone = true;
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
    intro.remove();
    document.body.classList.remove('intro');
    try { $('q').focus({ preventScroll: true }); } catch { try { $('q').focus(); } catch {} }
  };
  flight.onfinish = finish;
  setTimeout(finish, 1500); // safety net
}

function init() {
  setHome(true);
  $('qbadge').classList.add('paused');
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
    const menuBtn = e.target.closest('[data-menu]');
    if (menuBtn) {
      const card = menuBtn.closest('[data-play]');
      openTrackMenu(menuBtn, trackMeta(menuBtn.dataset.menu, card));
      return;
    }
    const play = e.target.closest('[data-play]');
    if (play) {
      const card = play.closest('.card');
      const meta = card ? {
        title: card.querySelector('h3')?.textContent || '',
        thumbnail: card.querySelector('img')?.src || ''
      } : {};
      if (play.closest('#view') && viewQueue.length) playId(play.dataset.play, meta, viewQueue);
      else playId(play.dataset.play, meta);
    }
  });

  $('bPlay').addEventListener('click', () => { initViz(); audio.paused ? audio.play() : audio.pause(); });
  $('bNext').addEventListener('click', step(1));
  $('bPrev').addEventListener('click', step(-1));
  $('bShuffle').addEventListener('click', () => {
    shuffle = !shuffle;
    $('bShuffle').classList.toggle('on', shuffle);
  });
  $('bRepeat').addEventListener('click', () => {
    repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    const b = $('bRepeat');
    b.classList.toggle('on', repeat !== 'off');
    b.classList.toggle('one', repeat === 'one');
    audio.loop = repeat === 'one';
    b.title = 'Repeat: ' + repeat;
  });

  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', () => {
    finalizePrev(true);
    if (repeat === 'one') return; // audio.loop replays natively
    if (repeat === 'all' || shuffle || qi < queue.length - 1) step(1)();
  });
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    // Proxy hiccup? Retry once over the direct stream URL.
    if (!proxiedOnce && current?.id && audio.src.includes('/api/audio')) {
      proxiedOnce = true;
      api(`/api/play?v=${current.id}`).then((m) => {
        if (m.audio_url) { audio.src = m.audio_url; audio.play().catch(() => toast('Stream broke — try playing it again')); }
        else toast('Stream broke — try playing it again');
      }).catch(() => toast('Stream broke — try playing it again'));
    } else if (proxiedOnce) {
      toast('Stream broke — try playing it again');
    }
  });
  audio.addEventListener('timeupdate', () => { if (!dragging) paintProgress(); });
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
    seekRatio(ratioAt(e));
  });
  pline.addEventListener('pointermove', (e) => { if (dragging) seekRatio(ratioAt(e)); });
  pline.addEventListener('pointerup', () => { dragging = false; pline.classList.remove('drag'); });
  $('vol').addEventListener('input', (e) => { audio.volume = e.target.value / 100; });
  audio.volume = 0.85;

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
    if (document.activeElement === $('q')) return;
    if (e.code === 'Space') { e.preventDefault(); initViz(); audio.paused ? audio.play() : audio.pause(); }
    if (e.key === 'ArrowRight' && audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
    if (e.key === 'ArrowLeft' && audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 10);
  });
}

/* ================= accounts · playlists · likes · For You ================= */
let me = null;
let currentView = 'home';
let viewArg = null;
let viewQueue = [];
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
    me = (await api('/api/me')).user;
  } catch {
    me = null;
  }
  applyTheme();
  if (me) {
    $('avatar').textContent = ((me.display || '?')[0] || '?').toUpperCase();
    $('avatar').style.background = avatarBG(me.hue);
    $('uname').textContent = me.display;
    $('usub').textContent = '@' + me.username;
  } else {
    $('avatar').textContent = '?';
    $('avatar').style.background = 'linear-gradient(135deg, #333, #111)';
    $('uname').textContent = 'Sign in';
    $('usub').textContent = 'account & themes';
  }
}

async function refreshCounts() {
  if (!me) {
    $('likeCount').textContent = '';
    renderPlList([]);
    return;
  }
  try {
    const [likes, pls] = await Promise.all([api('/api/likes'), api('/api/playlists')]);
    $('likeCount').textContent = likes.tracks.length ? `(${likes.tracks.length})` : '';
    renderPlList(pls.playlists);
  } catch { /* offline-ish: keep old numbers */ }
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
      ${p.cover ? `<img src="${p.cover}" alt="" />` : `<span class="ph">${escapeHtml(((p.name || '#')[0] || '#').toUpperCase())}</span>`}
      <span class="nm">${escapeHtml(p.name)}</span><span class="cnt">${p.count}</span>
    </button>`).join('');
  box.querySelectorAll('.pl').forEach((b) => b.addEventListener('click', () => showView('playlist', +b.dataset.pl)));
}

const F = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ic = (inner) => `<svg ${F}>${inner}</svg>`;
const ICO = {
  heart: ic('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
  plus: ic('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
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

function trackMeta(id, card) {
  const fromLists = queue.concat(viewQueue).find((r) => r.id === id);
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
  document.querySelectorAll('#plList .pl').forEach((b) => b.classList.toggle('on',
    view === 'playlist' && +b.dataset.pl === viewArg));
}

async function showView(name, arg = null) {
  closeMenu();
  viewArg = arg;
  setViewNav(name);
  clearTimeout(searchTimer);
  searchToken++;
  if (name === 'home') { $('view').hidden = true; $('view').innerHTML = ''; return; }
  setHome(false);
  $('grid').hidden = true;
  $('loading').hidden = true;
  $('empty').hidden = true;
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
    <div class="vcover">${cover ? `<img src="${cover}" alt="" />` : tiles[kind] || tiles.pl}</div>
    <div style="min-width:0;flex:1"><h2>${escapeHtml(title)}</h2><p>${sub}</p>
    <div class="vactions" data-vact></div></div></div>`;
}

function lockedHTML(title, sub) {
  return vheadHTML('lock', title, `${sub} <span class="vsub">Sign in to unlock.</span>`, '') +
    `<div class="vactions"><button class="vplay" data-auth="1">Sign in</button></div>`;
}

function trowHTML(t, i, opts = {}) {
  return `<div class="trow" style="animation-delay:${Math.min(i * 40, 320)}ms">
    <img src="${t.thumbnail}" data-playrow="${t.id}" alt="" loading="lazy"
      onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${t.id}/hqdefault.jpg'" />
    <span class="tt" data-playrow="${t.id}" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}${t.reason ? `<small>${escapeHtml(t.reason)}</small>` : ''}</span>
    <span class="td">${t.duration ? fmt(t.duration) : ''}</span>
    <button class="icb${t._liked ? ' loved' : ''}" data-like="${t.id}" title="Like">${ICO.heart}</button>
    <button class="icb" data-next="${t.id}" title="Play next">${ICO.plus}</button>
    ${opts.playlist ? `<button class="icb" data-move="${t.item_id}|-1" title="Move up">${ICO.up}</button>
      <button class="icb" data-move="${t.item_id}|1" title="Move down">${ICO.down}</button>
      <button class="icb" data-unpl="${t.item_id}" title="Remove">${ICO.x}</button>` : ''}
    ${opts.liked ? `<button class="icb" data-unlike="${t.id}" title="Unlike">${ICO.x}</button>` : ''}
  </div>`;
}

function recoCardHTML(t, i) {
  return `
  <div class="card" style="animation-delay:${Math.min(i * 55, 440)}ms" data-play="${t.id}" title="Play">
    <button class="dots" data-menu="${t.id}" title="More">⋮</button>
    <span class="likedot">${ICO.heart}</span>
    <div class="thumb">
      <img loading="lazy" decoding="async" src="${t.thumbnail}"
        onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${t.id}/hqdefault.jpg'" alt="" />
      <span class="go"><span>${ICO.play}</span></span>
      ${t.duration ? `<span class="dur">${fmt(t.duration)}</span>` : ''}
    </div>
    <h3>${escapeHtml(t.title)}</h3>
    <div class="reason">${escapeHtml(t.reason || '')}</div>
  </div>`;
}

/* ---------- For You ---------- */
async function renderForYou(v) {
  if (!me) { v.innerHTML = lockedHTML('For You', 'Muse learns your ears and tunes this page.'); return; }
  v.innerHTML = vheadHTML('foryou', 'For You', 'Tuned by your ears · refreshes as you listen', '') +
    `<div class="vactions" style="margin-bottom:14px">
       <button class="vplay" data-fyplay="1">${ICO.play} Play all</button>
       <button class="vghost" data-fyrefresh="1">${ICO.refresh} Refresh</button>
     </div><div class="grid" id="fyGrid"></div>`;
  try {
    const j = await api('/api/recommendations?n=12');
    if (currentView !== 'foryou') return;
    if (!j.tracks.length) {
      v.insertAdjacentHTML('beforeend',
        '<div class="vempty">Like a few songs or answer the taste survey — then this page reads your mind.</div>');
      return;
    }
    viewQueue = j.tracks.map((t) => ({ ...t }));
    $('fyGrid').innerHTML = j.tracks.map(recoCardHTML).join('');
    markLiked(j.tracks.map((t) => t.id));
    prewarm(j.tracks);
  } catch (e) {
    v.insertAdjacentHTML('beforeend', `<div class="vempty">Couldn't tune in: ${escapeHtml(e.message)}</div>`);
  }
}

/* ---------- Liked ---------- */
async function renderLiked(v) {
  if (!me) { v.innerHTML = lockedHTML('Liked Songs', 'Everything you heart lands here.'); return; }
  try {
    const j = await api('/api/likes');
    if (currentView !== 'liked') return;
    viewQueue = j.tracks.map((t) => ({ ...t }));
    const total = j.tracks.reduce((a, t) => a + (t.duration || 0), 0);
    v.innerHTML = vheadHTML('liked', 'Liked Songs',
      `${j.tracks.length} songs${total ? ' • ' + fmt(total) : ''}`, '') +
      (j.tracks.length ? `<div class="vactions" style="margin-bottom:10px">
        <button class="vplay" data-playall="1">${ICO.play} Play</button></div>` +
        j.tracks.map((t, i) => trowHTML({ ...t, _liked: true }, i, { liked: true })).join('')
        : '<div class="vempty">Nothing hearted yet — tap the ⋮ on any song and hit Like.</div>');
  } catch (e) {
    v.innerHTML = `<div class="vempty">Couldn't load likes: ${escapeHtml(e.message)}</div>`;
  }
}

/* ---------- Playlist detail ---------- */
async function renderPlaylist(v, pid) {
  if (!me) { v.innerHTML = lockedHTML('Playlist', 'Your collections live here.'); return; }
  try {
    const pl = await api(`/api/playlists/${pid}/tracks`);
    if (currentView !== 'playlist' || viewArg !== pid) return;
    viewQueue = pl.tracks.map((t) => ({ ...t }));
    const total = pl.tracks.reduce((a, t) => a + (t.duration || 0), 0);
    const cover = pl.tracks.length ? pl.tracks[0].thumbnail : '';
    v.innerHTML = `<div class="vhead">
        <div class="vcover">${cover ? `<img src="${cover}" alt="" />` : ICO.music}</div>
        <div style="min-width:0;flex:1"><h2 id="plName">${escapeHtml(pl.name)}</h2>
        <p>${pl.tracks.length} songs${total ? ' • ' + fmt(total) : ''}</p>
        <div class="vactions">
          ${pl.tracks.length ? `<button class="vplay" data-playall="1">${ICO.play} Play</button>` : ''}
          <button class="vghost" data-rename="1">${ICO.pencil} Rename</button>
          <button class="vghost danger" data-delpl="${pl.id}">${ICO.trash} <span>Delete</span></button>
        </div></div></div>` +
      (pl.tracks.length
        ? pl.tracks.map((t, i) => trowHTML(t, i, { playlist: true })).join('')
        : '<div class="vempty">Empty playlist — find songs via search, hit ⋮ → Add to playlist.</div>');
    markLiked(pl.tracks.map((t) => t.id));
  } catch (e) {
    v.innerHTML = `<div class="vempty">Couldn't open playlist: ${escapeHtml(e.message)}</div>`;
  }
}

/* ---------- likes ---------- */
async function markLiked(ids) {
  if (!me || !ids.length) return;
  try {
    const j = await api(`/api/liked_ids?ids=${ids.join(',')}`);
    likedSet = new Set(j.liked);
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

async function openTrackMenu(btn, track) {
  closeMenu();
  menuTrack = track;
  const m = $('menu');
  const liked = likedSet.has(track.id);
  m.innerHTML = `
    <button data-m="like" class="${liked ? 'loved' : ''}">${ICO.heart}${liked ? 'Unlike' : 'Like'}</button>
    <button data-m="next">${ICO.plus}Play next</button>
    <button data-m="copy">${ICO.link}Copy song link</button>
    <div class="sep"></div><div class="mhead">Add to playlist</div>
    <div class="mpl"><div class="mhead">…</div></div>
    <button data-m="newpl">${ICO.plus}New playlist…</button>`;
  m.hidden = false;
  const r = btn.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(window.innerWidth - 228, r.left)) + 'px';
  m.style.top = Math.max(8, Math.min(window.innerHeight - m.offsetHeight - 12, r.bottom + 6)) + 'px';
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
    box.innerHTML = j.playlists.length ? '' : '<div class="mhead">No playlists yet</div>';
    j.playlists.forEach((p) => {
      const b = document.createElement('button');
      b.innerHTML = `${ICO.music}<span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</span>`;
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
  if (kind !== 'newpl' && kind !== 'auth') closeMenu();
  if (!t) return;
  if (kind === 'like') toggleLike(t.id, t);
  else if (kind === 'next') playNext(t);
  else if (kind === 'copy') {
    try {
      await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${t.id}`);
      toast('Link copied', true);
    } catch { toast('Copy blocked by browser'); }
  } else if (kind === 'auth') openAuth('signin');
  else if (kind === 'newpl') openPlModal(t);
}

/* ---------- modals ---------- */
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
  if (!me) { openAuth('signin'); return; }
  openModal(`
    <h2>New playlist</h2>
    <p class="msub">${pending ? `“${escapeHtml((pending.title || '').slice(0, 48))}” lands here first.` : 'A fresh crate for your finds.'}</p>
    <label class="fl">Name</label>
    <input type="text" id="plName" maxlength="60" placeholder="Midnight drives" />
    <div class="mrow">
      <button class="mbtn ghost" id="plCancel">Cancel</button>
      <button class="mbtn primary" id="plCreate">Create</button>
    </div>`);
  const create = async () => {
    const name = $('plName').value.trim() || 'New playlist';
    try {
      const p = await post('/api/playlists', { name });
      if (pending?.id) {
        await post(`/api/playlists/${p.id}/tracks`, { video_id: pending.id,
          title: pending.title || '', thumbnail: pending.thumbnail || '',
          duration: pending.duration ?? null });
        toast(`Added to ${name}`, true);
      } else toast(`Playlist “${name}” ready`, true);
      closeModal();
      refreshCounts();
    } catch (e) { toast('Create failed: ' + e.message); }
  };
  $('plCreate').addEventListener('click', create);
  $('plCancel').addEventListener('click', closeModal);
  $('plName').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  setTimeout(() => $('plName').focus(), 60);
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
  $('pfLogout').addEventListener('click', async () => {
    try { await post('/api/logout', {}); } catch {}
    me = null;
    likedSet = new Set();
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
  if ((el = t('[data-next]'))) {
    const row = el.closest('.trow');
    playNext(row ? rowTrack(row, el.dataset.next) : (trackMeta(el.dataset.next) || {}));
    return;
  }
  if ((el = t('[data-move]'))) {
    const [itemId, dir] = el.dataset.move.split('|').map(Number);
    const rows = [...document.querySelectorAll('#view .trow')];
    const ids = rows.map((r) => +r.dataset.row);
    const i = ids.indexOf(itemId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try {
      await req('PATCH', `/api/playlists/${viewArg}/order`, { ids });
      renderPlaylist($('view'), viewArg);
    } catch (err) { toast('Reorder failed: ' + err.message); }
    return;
  }
  if ((el = t('[data-unpl]'))) {
    try {
      await req('DELETE', `/api/playlist-items/${el.dataset.unpl}`);
      renderPlaylist($('view'), viewArg);
      refreshCounts();
    } catch (err) { toast('Remove failed: ' + err.message); }
    return;
  }
  if ((el = t('[data-unlike]'))) {
    await toggleLike(el.dataset.unlike, {});
    el.closest('.trow')?.remove();
    if (!document.querySelector('#view .trow')) renderLiked($('view'));
    return;
  }
  if ((el = t('[data-playrow]'))) {
    const row = el.closest('.trow');
    playId(el.dataset.playrow, rowTrack(row, el.dataset.playrow), viewQueue);
    return;
  }
  if ((el = t('[data-playall]'))) {
    if (viewQueue.length) playId(viewQueue[0].id, viewQueue[0], viewQueue);
    return;
  }
  if ((el = t('[data-fyrefresh]'))) { renderForYou($('view')); return; }
  if ((el = t('[data-auth]'))) { openAuth('signin'); return; }
  if ((el = t('[data-rename]'))) {
    const h = $('plName');
    const input = document.createElement('input');
    input.className = 'vname';
    input.value = h.textContent;
    input.maxLength = 60;
    h.replaceWith(input);
    input.focus();
    input.select();
    const save = async () => {
      const name = input.value.trim();
      if (name && name !== h.textContent) {
        try {
          await req('PATCH', `/api/playlists/${viewArg}`, { name });
          toast('Renamed', true);
        } catch (err) { toast('Rename failed: ' + err.message); }
      }
      renderPlaylist($('view'), viewArg);
      refreshCounts();
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') save(); });
    input.addEventListener('blur', save);
    return;
  }
  if ((el = t('[data-delpl]'))) {
    if (!el.classList.contains('armed')) {
      el.classList.add('armed');
      el.querySelector('span').textContent = 'Sure?';
      setTimeout(() => { el.classList?.remove('armed'); const s = el.querySelector('span'); if (s) s.textContent = 'Delete'; }, 3000);
      return;
    }
    try {
      await req('DELETE', `/api/playlists/${viewArg}`);
      toast('Playlist deleted', true);
      showHome();
      refreshCounts();
    } catch (err) { toast('Delete failed: ' + err.message); }
    return;
  }
});

/* ---------- boot ---------- */
function bootAccountUI() {
  document.querySelectorAll('.snav button').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.view === 'home') showHome();
      else showView(b.dataset.view);
    }));
  $('sideBrand').addEventListener('click', showHome);
  $('newPl').addEventListener('click', () => openPlModal());
  $('userChip').addEventListener('click', () => (me ? openProfile() : openAuth('signin')));
  $('bLike').addEventListener('click', async () => {
    if (!me) { openAuth('signin'); return; }
    if (!current?.id) return;
    await toggleLike(current.id, { title: current.title, thumbnail: current.thumbnail || '', duration: current.duration ?? null });
  });
  $('modalWrap').addEventListener('click', (e) => { if (e.target === $('modalWrap')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeMenu(); closeModal(); }
  });
  document.addEventListener('pointerdown', (e) => {
    const m = $('menu');
    if (m && !m.hidden && !m.contains(e.target) && !e.target.closest('[data-menu]')) closeMenu();
  });
  refreshMe().then(() => { refreshCounts(); maybeSurvey(); });
}

document.addEventListener('DOMContentLoaded', bootAccountUI);
