import { create } from 'zustand';
import { toast } from 'sonner';
import { api, fetchJSON, post } from '@/lib/api';
import { cookiesAll, isAndroidApp, isIOS, lane, tellAndroid } from '@/lib/env';
import { useSession } from '@/lib/session';
import type { Track } from '@/lib/types';
import { hiddenTrack, prettyTitle, ytThumb } from '@/lib/utils';
import { setThemeCover } from '@/hooks/theme';
import { RiffAudioEngine, defaultAudioSettings, defaultHqSettings, type AudioSettings, type HqSettings } from './riff-engine';

export type Repeat = 'off' | 'all' | 'one';
/* Quick presets (Muse) expressed as Riff engine settings: speedPitch = rate with pitch,
   eq.low = Riff's 200 Hz low shelf, reverb = Riff convolver mix. */
export const FX_MODES = [
  { id: 'normal', name: 'Normal', rate: 1, bass: 0, reverb: 0 },
  { id: 'nightcore', name: 'Nightcore', rate: 1.25, bass: 0, reverb: 0 },
  { id: 'daycore', name: 'Daycore', rate: 0.82, bass: 0, reverb: 0 },
  { id: 'bass', name: 'Bass Boost', rate: 1, bass: 10, reverb: 0 },
  { id: 'nightbass', name: 'Nightcore + Bass', rate: 1.25, bass: 8, reverb: 0 },
  { id: 'slowed', name: 'Slowed + reverb', rate: 0.85, bass: 4, reverb: 28 },
] as const;

export interface SoundState { settings: AudioSettings; hqEnabled: boolean; hq: HqSettings; crossfade: number }
const SOUND_KEY = 'muse:sound';
function loadSound(): SoundState {
  const base: SoundState = { settings: defaultAudioSettings(), hqEnabled: false, hq: defaultHqSettings(), crossfade: 0 };
  try {
    const j = JSON.parse(localStorage.getItem(SOUND_KEY) || 'null');
    if (j && typeof j === 'object') return { ...base, ...j, settings: { ...base.settings, ...(j.settings || {}), eq: { ...base.settings.eq, ...(j.settings?.eq || {}) } }, hq: { ...base.hq, ...(j.hq || {}) } };
  } catch {}
  return base;
}

interface PlayerState {
  current: Track | null;
  queue: Track[];
  qi: number;
  source: string;
  sourceId: string | number | null;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: Repeat;
  fx: string;
  sleepMins: number;
  expanded: boolean;
  sound: SoundState;
  routed: boolean;
  play: (t: Track, list?: Track[] | null, source?: string, sourceId?: string | number | null) => void;
  toggle: () => void;
  next: () => Promise<void>;
  prev: () => void;
  seek: (ratio: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setFx: (id: string) => void;
  cycleSleep: () => void;
  playNext: (t: Track) => void;
  addToQueue: (t: Track) => void;
  setExpanded: (on: boolean) => void;
  setSound: (patch: Partial<Omit<SoundState, 'settings' | 'hq'>> & { settings?: Partial<AudioSettings>; hq?: Partial<HqSettings> }) => void;
  resetSound: () => void;
}

/* ---------- audio engine ---------- */
const audioEl = document.createElement('audio');
audioEl.id = 'audio';
audioEl.preload = 'auto';
audioEl.setAttribute('playsinline', '');
audioEl.setAttribute('webkit-playsinline', '');
document.body.appendChild(audioEl);

/* pc lane + cookie consent → YouTube iframe engine from /ytplayer.js (same as legacy). */
const useEmbed = lane() === 'pc' && typeof window.MusePlayer === 'function' && cookiesAll();
const audio: HTMLAudioElement & { engine?: string; videoData?: () => any } =
  useEmbed ? window.MusePlayer(audioEl, { handoff: false }) : audioEl;

export function streamUrl(id: string) {
  const p = new URLSearchParams({ v: id });
  if (isIOS || lane() === 'iphone') p.set('ios', '1');
  return `/api/audio?${p}`;
}

/* ---------- Riff audio engine (Web Audio graph on the same <audio>) ----------
   Routed where it is safe: desktop browsers, the Windows/Linux shells and Android web.
   Not routed (element plays natively, effects degrade gracefully):
   - iOS Safari / the iPhone lane: a MediaElementSource'd element is silenced when the
     AudioContext gets suspended in the background / on the lock screen, and element
     volume is read-only — so iPhone keeps the plain media path (background audio,
     lock-screen controls). Speed & pitch still work (playbackRate); EQ, enhancer,
     reverb/echo/distortion, crossfade and the visualizer are disabled.
   - the YouTube iframe engine (pc lane + cookies): no media element to route.
   - Android app WebView: routed lazily, only once a Web Audio feature is switched on. */
export const engine = new RiffAudioEngine();
try { (window as any).__museEngine = engine; } catch {}
const routeMode = (): 'always' | 'lazy' | 'never' => {
  if (isIOS || lane() === 'iphone' || audio !== audioEl || audio.engine === 'yt') return 'never';
  try { if (localStorage.getItem('muse:engine') === 'native') return 'never'; } catch {}
  return isAndroidApp ? 'lazy' : 'always';
};
export const engineSupported = () => routeMode() !== 'never';
function needsGraph(s: SoundState) {
  const a = s.settings;
  return s.hqEnabled || s.crossfade > 0 || a.reverb > 0 || a.echo > 0 || a.distortion > 0 || a.volume !== 1 ||
    a.eq.low !== 0 || a.eq.mid !== 0 || a.eq.high !== 0 || a.eqBands.some((v) => v !== 0);
}
/* Must run inside a user gesture the first time (AudioContext autoplay policy). */
function initEngine() {
  const mode = routeMode();
  const st = usePlayer.getState();
  /* only with transient user activation: an AudioContext created without one starts
     suspended and would silence the routed element (bridge/media-key/autoplay starts) */
  const act = (navigator as any).userActivation;
  const gesture = !act || act.isActive;
  if (mode !== 'never' && !engine.ready && gesture && (mode === 'always' || needsGraph(st.sound))) {
    engine.init(audioEl);
    if (engine.ready) { try { audioEl.volume = 1; } catch {} usePlayer.setState({ routed: true }); }
  } else if (engine.ready) engine.resumeAudioContext();
  pushSound();
}
function pushSound() {
  const { sound, volume } = usePlayer.getState();
  if (crossFadeInPending) {
    /* mid-crossfade: graph settings are unchanged; don't stomp the master-gain ramp */
    try { engine.volume = volume; engine.applyRate(audioEl); } catch {}
    return;
  }
  engine.setHqEnabled(sound.hqEnabled);
  engine.setHqSettings(sound.hq);
  engine.setAudioSettings({ ...sound.settings, eq: { ...sound.settings.eq }, eqBands: sound.settings.eqBands.slice() });
  engine.setVolume(volume, false);
  try { engine.applySettings(audioEl); } catch {}
  if (!engine.ready) { try { audio.volume = volume; } catch {} }
}
function presetSettings(id: string): Partial<AudioSettings> {
  const m = FX_MODES.find((x) => x.id === id) || FX_MODES[0];
  return { speed: 1, speedPitch: m.rate, pitch: 0, reverb: m.reverb, eq: { low: m.bass, mid: 0, high: 0 } };
}

/* Plays started without a gesture get routed on the next tap anywhere. */
document.addEventListener('pointerdown', () => { if (!engine.ready && usePlayer.getState().current) initEngine(); }, { capture: true, passive: true });

/* Riff playSmooth / pauseSmooth: ~60 ms gain ramps around play/pause when routed. */
let smoothFadeToken = 0;
function playSmooth() {
  const tok = ++smoothFadeToken;
  initEngine();
  const fg = engine.fadeGain, ctx = engine.ctx;
  if (fg && ctx && !crossFadeInPending) { try { fg.gain.cancelScheduledValues(ctx.currentTime); fg.gain.setValueAtTime(0, ctx.currentTime); } catch {} }
  const p = audio.play();
  if (fg && ctx) { try { fg.gain.setTargetAtTime(1, ctx.currentTime, 0.05); } catch {} }
  void tok;
  return p;
}
function pauseSmooth() {
  const tok = ++smoothFadeToken;
  const fg = engine.fadeGain, ctx = engine.ctx;
  if (!fg || !ctx || audio.paused || document.hidden) { try { audio.pause(); } catch {} engine.flushEffects(); return; }
  try { fg.gain.cancelScheduledValues(ctx.currentTime); fg.gain.setTargetAtTime(0, ctx.currentTime, 0.06); } catch {}
  usePlayer.setState({ playing: false });
  setTimeout(() => { if (tok !== smoothFadeToken) return; try { audio.pause(); } catch {} engine.flushEffects(); }, 280);
}

/* hls.js where relevant (Riff: data.isHls). Muse's /api/audio is a progressive same-origin
   stream, so this only kicks in for .m3u8 sources; Safari/iOS use native HLS. */
let hls: any = null;
function setSource(url: string) {
  if (hls) { try { hls.destroy(); } catch {} hls = null; }
  const isHls = /\.m3u8(\?|$)/i.test(url);
  if (isHls && audio === audioEl && !audioEl.canPlayType('application/vnd.apple.mpegurl')) {
    void import('hls.js').then(({ default: Hls }) => {
      if (!Hls.isSupported()) { audio.src = url; return; }
      hls = new Hls({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 30, maxMaxBufferLength: 60, maxBufferSize: 30 * 1000 * 1000 });
      hls.loadSource(url); hls.attachMedia(audioEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { audio.play().catch(() => {}); });
    });
    return;
  }
  audio.src = url;
}

/* Riff crossfade: X s before the end fade the master out over X/2 and start the next
   track, which fades in over X/2. Only with the Web Audio route. */
let crossTriggered = false;
let crossFadeInPending = false;
let nextPrefetched = false;

const meId = () => useSession.getState().me?.id;
function rememberHeard(id: string) {
  const uid = meId(); if (!uid) return;
  try {
    const k = `muse:heard:${uid}`;
    const s = new Set<string>(JSON.parse(localStorage.getItem(k) || '[]'));
    s.add(id);
    localStorage.setItem(k, JSON.stringify([...s].slice(-40)));
  } catch {}
}

/* Listening telemetry: identical semantics to legacy (play ≥30s | complete | skip). */
let lastPlay: (Track & { t0: number; credited?: boolean }) | null = null;
async function noteEvent(type: string, p: Track, pos: number) {
  if (!meId() || !p?.id) return;
  try {
    await post('/api/event', { type, video_id: p.id, title: p.title || '', uploader: p.uploader || '',
      thumbnail: p.thumbnail || p.thumb || '', duration: p.duration ?? null, position: pos ?? 0 });
  } catch {}
}
function listenSeconds(p: { id: string; t0: number }) {
  const wall = Math.max(0, (Date.now() - p.t0) / 1000);
  const t = usePlayer.getState().current?.id === p.id && audio.currentTime > 0 ? audio.currentTime : 0;
  return Math.max(t, wall);
}
function finalizePrev(completed: boolean) {
  if (!lastPlay) return;
  const p = lastPlay; lastPlay = null;
  const el = listenSeconds(p);
  const heard = completed || el >= 30 || !!p.credited;
  void (async () => {
    if (completed) await noteEvent('complete', p, el);
    else if (!heard) await noteEvent('skip', p, el);
    else if (!p.credited) await noteEvent('play', p, el);
    if (heard) rememberHeard(p.id);
  })();
}

let playToken = 0;
/* Stall watchdog: no silent hangs. 7s without 'playing' → reload the stream once;
   another 7s → clear error and stop the spinner (or skip in a queue). */
let watchdog: ReturnType<typeof setTimeout> | null = null;
export const STALL_MS = 7000;
function clearWatchdog() { if (watchdog) { clearTimeout(watchdog); watchdog = null; } }
function armWatchdog(token: number, id: string, attempt = 0) {
  clearWatchdog();
  watchdog = setTimeout(() => {
    if (token !== playToken || userPaused || usePlayer.getState().current?.id !== id) return;
    if (audio.currentTime > 0.2 && !audio.paused) return;
    if (attempt === 0) {
      try { setSource(streamUrl(id) + `&r=${Date.now()}`); audio.play().catch(() => {}); } catch {}
      armWatchdog(token, id, 1);
      return;
    }
    toast.error('Трек не запускается — YouTube не отвечает. Попробуйте ещё раз или другой трек.');
    usePlayer.setState({ playing: false, loading: false });
    try { audio.pause(); } catch {}
  }, STALL_MS);
}
const prefetched = new Set<string>();
export function prefetchStreams(ids: (string | undefined)[]) {
  const want = ids.filter((x): x is string => !!x && /^[\w-]{11}$/.test(x) && !prefetched.has(x)).slice(0, 3);
  if (!want.length) return;
  want.forEach((x) => prefetched.add(x));
  if (prefetched.size > 200) prefetched.clear();
  fetch(`/api/prefetch?v=${want.join(',')}`, { credentials: 'same-origin' }).catch(() => {});
}
let errTries = 0;
let extending: Promise<boolean> | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;
let userPaused = false;
const storedVol = (() => { try { const v = parseFloat(localStorage.getItem('muse:vol') || ''); return Number.isFinite(v) ? v : 0.85; } catch { return 0.85; } })();

function norm(s: string) { return (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function songName(t: Track) { const p = (t.title || '').split(/\s[-–—|]\s/); return norm((p[1] || p[0]).replace(/\(.*?\)|\[.*?\]/g, '')); }

async function extendQueue(): Promise<boolean> {
  if (extending) return extending;
  extending = (async () => {
    const { queue, current } = usePlayer.getState();
    const seen = new Set(queue.map((t) => t.id));
    if (current) seen.add(current.id);
    const names = new Set(queue.concat(current ? [current] : []).map(songName).filter((n) => n.length > 2));
    const add: Track[] = [];
    const take = (list?: Track[]) => {
      for (const t of list || []) {
        if (!t?.id || seen.has(t.id) || hiddenTrack(t) || [...names].some((n) => norm(t.title).includes(n))) continue;
        seen.add(t.id); add.push({ ...t });
        const n = songName(t); if (n.length > 2) names.add(n);
      }
    };
    if (meId()) { try { take((await api('/api/recommendations?n=15')).tracks); } catch {} }
    const parts = (current?.title || '').split(/\s[-–—|]\s/);
    const artist = (parts.length > 1 ? parts[0].replace(/\(.*?\)|\[.*?\]/g, '').trim() : '')
      || (current?.uploader || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    for (const q of artist.length > 1 ? [artist, `${artist} best songs`, `songs like ${artist}`] : []) {
      if (add.length >= 4) break;
      try { take((await api(`/api/search?q=${encodeURIComponent(q)}&n=12`)).results); } catch {}
    }
    if (add.length < 4 && meId()) {
      try { take(((await api('/api/likes')).tracks || []).sort(() => Math.random() - 0.5)); } catch {}
    }
    if (!add.length) return false;
    usePlayer.setState((s) => ({ queue: [...s.queue, ...add.slice(0, 15)] }));
    return true;
  })().finally(() => { extending = null; });
  return extending;
}

let shufflePick: { qi: number; n: number } | null = null;
function shuffleIndex() {
  const { queue, qi } = usePlayer.getState();
  if (queue.length < 2) return 0;
  if (shufflePick && shufflePick.qi === qi) return shufflePick.n;
  let n; do { n = Math.floor(Math.random() * queue.length); } while (n === qi);
  shufflePick = { qi, n };
  return n;
}

function mediaSession(t: Track | null, state?: 'playing' | 'paused') {
  if (!('mediaSession' in navigator) || !t) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: prettyTitle(t.title), artist: String(t.uploader || '').replace(/\s*-\s*Topic$/i, ''), album: 'Muse',
      artwork: [{ src: ytThumb(t.id, t.thumbnail), sizes: '320x180', type: 'image/jpeg' }],
    });
    if (state) navigator.mediaSession.playbackState = state;
  } catch {}
}

export const usePlayer = create<PlayerState>((set, get) => ({
  current: null, queue: [], qi: -1, source: 'search', sourceId: null,
  playing: false, loading: false, time: 0, duration: 0,
  volume: storedVol,
  shuffle: localStorage.getItem('muse:shuffle') === '1',
  repeat: ((localStorage.getItem('muse:repeat') as Repeat) || 'off'),
  fx: (() => { try { return localStorage.getItem('muse:fx:0') || 'normal'; } catch { return 'normal'; } })(),
  sleepMins: 0,
  expanded: false,
  sound: loadSound(),
  routed: false,

  play: (t, list = null, source = 'search', sourceId = null) => {
    if (list) list = list.filter((r) => r && !hiddenTrack(r));
    if (hiddenTrack(t)) { if (list?.length) get().play(list[0], list, source, sourceId); return; }
    const token = ++playToken;
    finalizePrev(false);
    let { queue, qi } = get();
    if (list) { queue = list.slice(); qi = Math.max(0, list.findIndex((r) => r.id === t.id)); }
    else { const i = queue.findIndex((r) => r.id === t.id); qi = i; if (i < 0) { queue = [...queue, t]; qi = queue.length - 1; } }
    const item = queue[qi] || t;
    const cur: Track = { ...item, title: prettyTitle(item.title) || item.title, thumbnail: ytThumb(item.id, item.thumbnail || item.thumb) };
    lastPlay = { ...cur, t0: Date.now() };
    errTries = 0; userPaused = false;
    set({ current: cur, queue, qi, source: list ? source : get().source, sourceId: list ? sourceId : get().sourceId,
      playing: true, loading: true, time: 0, duration: item.duration || 0 });
    crossTriggered = false; nextPrefetched = false;
    setThemeCover(t.id);
    try { audio.loop = get().repeat === 'one'; } catch {}
    try { setSource(streamUrl(t.id)); } catch {}
    if (engine.masterGain && engine.ctx && !crossFadeInPending) { try { engine.masterGain.gain.cancelScheduledValues(engine.ctx.currentTime); } catch {} }
    const p = playSmooth();
    if (p && typeof p.then === 'function') p.catch((e: any) => {
      if (token !== playToken) return;
      if (e?.name === 'NotAllowedError') set({ playing: false });
    });
    armWatchdog(token, t.id);
    pushSound();
    mediaSession(cur, 'playing');
    useSession.getState().markLiked([t.id]);
    if (!item.title || !item.duration) {
      api(`/api/play?v=${t.id}`).then((m: any) => {
        if (token !== playToken) return;
        set((s) => ({ current: s.current ? { ...s.current, ...m, id: t.id, title: prettyTitle(m.title || s.current.title) || s.current.title,
          thumbnail: ytThumb(t.id, m.thumbnail || s.current.thumbnail) } : s.current, duration: m.duration || s.duration }));
        if ('liked' in m) { const ss = useSession.getState(); if (ss.likedIds.has(t.id) !== !!m.liked) { const n = new Set(ss.likedIds); if (m.liked) n.add(t.id); else n.delete(t.id); useSession.setState({ likedIds: n }); } }
        mediaSession(get().current);
      }).catch((e: any) => {
        if (token !== playToken) return;
        const msg = String(e?.message || e);
        toast.error(/private|unavailable|deleted|removed|login|sign in|copyright|blocked|age/i.test(msg)
          ? "This video can't be played (private, deleted, or restricted)" : 'Could not play: ' + msg.slice(0, 90));
      });
    }
  },

  toggle: () => {
    if (!get().current) return;
    if (audio.paused) { userPaused = false; playSmooth()?.catch?.(() => {}); if (audio.currentTime < 0.2) armWatchdog(playToken, get().current!.id, 1); }
    else { userPaused = true; clearWatchdog(); pauseSmooth(); }
  },

  next: async () => {
    const { queue, qi, shuffle } = get();
    if (!shuffle && qi >= queue.length - 1) {
      if (await extendQueue()) { const q = get().queue; get().play(q[get().qi + 1]); }
      return;
    }
    if (!queue.length) return;
    const n = shuffle && queue.length > 1 ? shuffleIndex() : (qi + 1) % queue.length;
    get().play(queue[n]);
  },
  prev: () => {
    const { queue, qi } = get();
    if (audio.currentTime > 4) { audio.currentTime = 0; return; }
    if (!queue.length) return;
    const n = qi <= 0 ? queue.length - 1 : qi - 1;
    get().play(queue[n]);
  },
  seek: (ratio) => {
    const d = get().duration || audio.duration;
    if (!d || !Number.isFinite(d)) return;
    try { audio.currentTime = Math.max(0, Math.min(d - 0.25, ratio * d)); set({ time: audio.currentTime }); } catch {}
  },
  setVolume: (v) => {
    v = Math.max(0, Math.min(1, v));
    if (engine.ready) engine.setVolume(v, false); else { try { audio.volume = v; } catch {} }
    try { localStorage.setItem('muse:vol', String(v)); } catch {}
    set({ volume: v });
  },
  toggleShuffle: () => { const on = !get().shuffle; shufflePick = null; localStorage.setItem('muse:shuffle', on ? '1' : '0'); set({ shuffle: on }); },
  cycleRepeat: () => {
    const r: Repeat = get().repeat === 'off' ? 'all' : get().repeat === 'all' ? 'one' : 'off';
    try { audio.loop = r === 'one'; } catch {}
    localStorage.setItem('muse:repeat', r); set({ repeat: r });
  },
  setFx: (id) => {
    try { localStorage.setItem('muse:fx:0', id); } catch {}
    const ps = presetSettings(id);
    set({ fx: id });
    get().setSound({ settings: { ...ps, eq: { ...get().sound.settings.eq, ...ps.eq } } });
  },
  setSound: (patch) => {
    const cur = get().sound;
    const next: SoundState = {
      ...cur, ...patch,
      settings: { ...cur.settings, ...(patch.settings || {}), eq: { ...cur.settings.eq, ...(patch.settings?.eq || {}) }, eqBands: (patch.settings?.eqBands || cur.settings.eqBands).slice() },
      hq: { ...cur.hq, ...(patch.hq || {}) },
    };
    set({ sound: next });
    try { localStorage.setItem(SOUND_KEY, JSON.stringify(next)); } catch {}
    if (!engine.ready && routeMode() === 'lazy' && needsGraph(next) && !audio.paused) initEngine(); else pushSound();
  },
  resetSound: () => { set({ fx: 'normal' }); try { localStorage.setItem('muse:fx:0', 'normal'); } catch {} get().setSound({ settings: defaultAudioSettings(), hqEnabled: false, hq: defaultHqSettings(), crossfade: 0 }); },
  cycleSleep: () => {
    const m = get().sleepMins;
    const n = m === 0 ? 15 : m === 15 ? 30 : m === 30 ? 60 : 0;
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = n ? setTimeout(() => { set({ sleepMins: 0 }); userPaused = true; pauseSmooth(); }, n * 60000) : null;
    set({ sleepMins: n });
  },
  playNext: (t) => set((s) => {
    const q = s.queue.filter((x) => x.id !== t.id);
    const at = Math.max(0, q.findIndex((x) => x.id === s.current?.id)) + 1;
    q.splice(s.current ? at : 0, 0, t);
    return { queue: q, qi: s.current ? at - 1 : -1 };
  }),
  addToQueue: (t) => set((s) => ({ queue: s.queue.some((x) => x.id === t.id) ? s.queue : [...s.queue, t] })),
  setExpanded: (on) => set({ expanded: on }),
}));

/* ---------- element events → store ---------- */
let lastTick = 0;
audio.addEventListener('playing', () => {
  clearWatchdog();
  if (crossFadeInPending) { crossFadeInPending = false; const X = usePlayer.getState().sound.crossfade; if (X > 0 && engine.ready) engine.fadeIn(X / 2); else engine._applyMasterVolume(); }
  usePlayer.setState({ playing: true, loading: false }); tick(true);
  const { queue, qi, shuffle } = usePlayer.getState();
  if (!shuffle) prefetchStreams([queue[qi + 1]?.id]);
});
audio.addEventListener('play', () => usePlayer.setState({ playing: true }));
audio.addEventListener('pause', () => { usePlayer.setState({ playing: false }); mediaSession(usePlayer.getState().current, 'paused'); tick(true); });
audio.addEventListener('waiting', () => usePlayer.setState({ loading: true }));
audio.addEventListener('loadedmetadata', () => {
  const d = audio.duration;
  if (Number.isFinite(d) && d > 0) usePlayer.setState({ duration: d });
});
audio.addEventListener('timeupdate', () => {
  const now = performance.now();
  if (now - lastTick < 200) return;
  lastTick = now;
  usePlayer.setState({ time: audio.currentTime || 0 });
  const st = usePlayer.getState();
  const cur = audio.currentTime || 0, dur = audio.duration || st.duration || 0;
  if (!nextPrefetched && st.playing && dur > 0 && cur / dur > 0.5) {
    nextPrefetched = true;
    const n = st.shuffle && st.queue.length > 1 ? st.queue[shuffleIndex()] : st.queue[st.qi + 1];
    prefetchStreams([n?.id]);
  }
  const X = st.sound.crossfade;
  if (X > 0 && engine.ready && !crossTriggered && st.repeat !== 'one' && dur > X && cur >= dur - X && !engine.isLiveStream(audioEl) && !userPaused) {
    crossTriggered = true; crossFadeInPending = true;
    engine.fadeOut(X / 2);
    const tok = playToken;
    setTimeout(() => { if (tok !== playToken || userPaused) { crossFadeInPending = false; if (tok === playToken) engine._applyMasterVolume(); return; } finalizePrev(true); void usePlayer.getState().next(); }, (X / 2) * 1000);
  }
  if (lastPlay && !lastPlay.credited && listenSeconds(lastPlay) >= 30) {
    lastPlay.credited = true; const p = lastPlay;
    noteEvent('play', p, 30).then(() => rememberHeard(p.id));
  }
  tick(false);
});
audio.addEventListener('ended', async () => {
  const s = usePlayer.getState();
  if (s.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  finalizePrev(true);
  if (!s.shuffle && s.qi >= s.queue.length - 1 && s.repeat === 'all' && s.queue.length) { s.play(s.queue[0]); return; }
  await s.next();
});
audio.addEventListener('error', async () => {
  const s = usePlayer.getState();
  if (!s.current || !audio.src || audio.src.startsWith('data:')) return;
  const id = s.current.id;
  if (errTries < 1) {
    errTries++;
    try { await api(`/api/play?v=${id}`); } catch {}
    if (usePlayer.getState().current?.id !== id) return;
    const t = audio.currentTime;
    setSource(streamUrl(id) + `&r=${Date.now()}`);
    try { if (t > 1) audio.currentTime = t; await audio.play(); } catch {}
    return;
  }
  toast.error('Track failed to load — skipping');
  if (s.queue.length > 1) s.next(); else usePlayer.setState({ playing: false, loading: false });
});

/* OS media keys / lock screen */
try {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => { userPaused = false; playSmooth()?.catch?.(() => {}); });
  ms.setActionHandler('pause', () => { userPaused = true; pauseSmooth(); });
  ms.setActionHandler('nexttrack', () => usePlayer.getState().next());
  ms.setActionHandler('previoustrack', () => usePlayer.getState().prev());
  ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
} catch {}

/* Linux (Electron MPRIS) + Android shell bridges */
let lastPush = 0;
function tick(force: boolean) {
  const s = usePlayer.getState();
  const now = Date.now();
  if (!force && now - lastPush < 1000) return;
  lastPush = now;
  try {
    if (typeof window.__musePushMpris === 'function') {
      const t = s.current;
      window.__musePushMpris({
        id: t?.id || '', title: t ? prettyTitle(t.title) : '', artist: String(t?.uploader || '').replace(/\s*-\s*Topic$/i, ''),
        art: t?.thumbnail || '', url: t ? `https://www.youtube.com/watch?v=${t.id}` : '',
        playing: !audio.paused, stopped: !t, position: audio.currentTime || 0, duration: s.duration || 0, volume: s.volume,
      });
    }
  } catch {}
  if (isAndroidApp) tellAndroid(!audio.paused, s.current?.title || 'Muse');
  try {
    if (s.current && 'setPositionState' in navigator.mediaSession && s.duration > 0) {
      navigator.mediaSession.setPositionState({ duration: s.duration, position: Math.min(s.duration, audio.currentTime || 0), playbackRate: audio.playbackRate || 1 });
    }
  } catch {}
}

/* Presence heartbeat (friends see "listening"). */
let presenceSeq = 0;
export function beatPresence(away = false) {
  if (!meId()) return;
  if (!away && document.hidden) return;
  const s = usePlayer.getState();
  const listening = !document.hidden && s.current && s.playing && !userPaused ? prettyTitle(s.current.title).slice(0, 80) : '';
  presenceSeq++;
  fetchJSON('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(away ? { away: true, seq: presenceSeq } : { listening, seq: presenceSeq }) }, 8000).catch(() => {});
}
setInterval(() => beatPresence(false), 12000);
document.addEventListener('visibilitychange', () => { beatPresence(document.hidden); engine.setHidden(document.hidden); });
window.addEventListener('pagehide', () => beatPresence(true));

export const getAudio = () => audio;
