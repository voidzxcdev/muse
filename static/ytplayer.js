/* Muse playback engine.
 * Wraps the YouTube IFrame player in the subset of the HTMLMediaElement API
 * app.js uses, so songs stream straight from YouTube to the listener (no
 * server hop, no datacenter-IP blocking). Videos that refuse embedding fall
 * back to the server stream on the real <audio> element. */
(function () {
  const YT_ERR_FALLBACK = new Set([2, 5, 100, 101, 150]);
  const START_TIMEOUT = 6000;
  const BLOCKED_KEY = 'muse-noembed';

  const idFrom = (src) => {
    const m = /[?&]v=([\w-]{11})/.exec(String(src || ''));
    return m ? m[1] : null;
  };

  function loadApi(timeoutMs) {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try { prev && prev(); } catch {}
        resolve(window.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => reject(new Error('iframe api blocked'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('iframe api timeout')), timeoutMs);
    });
  }

  window.MusePlayer = function (el) {
    let blocked;
    try { blocked = new Set(JSON.parse(localStorage.getItem(BLOCKED_KEY) || '[]')); }
    catch { blocked = new Set(); }
    const rememberBlocked = (id) => {
      blocked.add(id);
      try { localStorage.setItem(BLOCKED_KEY, JSON.stringify([...blocked].slice(-500))); } catch {}
    };

    const listeners = new Map(); // type -> Set(fn)
    const emit = (type) => {
      const set = listeners.get(type);
      if (!set) return;
      const ev = new Event(type);
      for (const fn of [...set]) { try { fn.call(api, ev); } catch (e) { console.error(e); } }
    };

    let mode = 'yt';        // 'yt' | 'html'
    let src = '';
    let ytId = null;        // video loaded in the YT player
    let yt = null;          // YT.Player once ready
    let ytReady = false;
    let ytAvailable = true; // false once the iframe API failed to load
    let ytState = -1;
    let paused = true;
    let loop = false;
    let volume = 1;
    let muted = false;
    let metaSent = false;
    let tick = 0;
    let startTimer = 0;
    let playWaiters = [];   // {resolve, reject} for pending play() promises
    let pendingLoad = null; // {id, start, autoplay} queued until API ready

    const settle = (ok, err) => {
      const w = playWaiters;
      playWaiters = [];
      w.forEach((p) => (ok ? p.resolve() : p.reject(err)));
    };

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;right:0;bottom:0;width:200px;height:200px;'
      + 'opacity:0;pointer-events:none;z-index:-1;overflow:hidden';
    const mount = document.createElement('div');
    host.appendChild(mount);
    document.body.appendChild(host);

    const applyVolume = () => {
      if (!yt || !ytReady) return;
      try {
        yt.setVolume(Math.round(volume * 100));
        if (muted) yt.mute(); else yt.unMute();
      } catch {}
    };

    const stopTick = () => { clearInterval(tick); tick = 0; };
    const startTick = () => {
      if (tick) return;
      tick = setInterval(() => {
        if (mode !== 'yt') return stopTick();
        if (!metaSent && api.duration > 0) { metaSent = true; emit('loadedmetadata'); }
        emit('timeupdate');
      }, 250);
    };

    // --- html fallback ---------------------------------------------------
    function toHtml(id, startAt, autoplay) {
      clearTimeout(startTimer);
      stopTick();
      try { yt && ytReady && yt.stopVideo(); } catch {}
      mode = 'html';
      ytId = null;
      el.volume = volume;
      el.muted = muted;
      el.loop = loop;
      el.src = id ? `/api/audio?v=${id}` : src;
      if (startAt > 0) {
        const seek = () => { el.removeEventListener('loadedmetadata', seek); try { el.currentTime = startAt; } catch {} };
        el.addEventListener('loadedmetadata', seek);
      }
      if (autoplay) {
        el.play().then(() => settle(true)).catch((e) => settle(false, e));
      }
    }

    function fallback(id, why) {
      if (!id || mode !== 'yt' || ytId !== id) return;
      console.debug('[muse] server stream for', id, why);
      if (why.startsWith('error')) rememberBlocked(id);
      const at = (() => { try { return yt.getCurrentTime() || 0; } catch { return 0; } })();
      toHtml(id, at, !paused);
    }

    // --- youtube ---------------------------------------------------------
    // Selecting a track only records it; the player loads on play(). Cueing
    // first and then calling playVideo leaves the embed stuck in CUED.
    let cueStart = 0;
    let loaded = false; // ytId is actually loaded in the iframe
    function ytLoad(id, startAt, autoplay) {
      if (!ytReady) { pendingLoad = { id, start: startAt, autoplay }; return; }
      ytId = id;
      cueStart = startAt || 0;
      metaSent = false;
      ytState = -1;
      loaded = false;
      if (!autoplay) return;
      loaded = true;
      applyVolume();
      yt.loadVideoById({ videoId: id, startSeconds: cueStart });
      armStartTimer(id);
    }

    function armStartTimer(id, extended = false) {
      clearTimeout(startTimer);
      startTimer = setTimeout(() => {
        if (mode !== 'yt' || ytId !== id || ytState === 1 || paused || document.hidden) return;
        // Still buffering on a slow connection: give it one more window.
        if (ytState === 3 && !extended) return armStartTimer(id, true);
        // Never started (autoplay refused, region lock, silent failure).
        fallback(id, `no start (state ${ytState})`);
      }, START_TIMEOUT);
    }

    function onState(e) {
      if (mode !== 'yt' || !loaded) return;
      ytState = e.data;
      const S = window.YT.PlayerState;
      if (ytState === S.PLAYING) {
        clearTimeout(startTimer);
        applyVolume();
        paused = false;
        startTick();
        if (!metaSent && api.duration > 0) { metaSent = true; emit('loadedmetadata'); }
        emit('play');
        emit('playing');
        settle(true);
      } else if (ytState === S.PAUSED) {
        stopTick();
        if (!paused) { paused = true; emit('pause'); }
      } else if (ytState === S.ENDED) {
        stopTick();
        if (loop) {
          try { yt.seekTo(0, true); yt.playVideo(); } catch {}
          return;
        }
        paused = true;
        emit('timeupdate');
        emit('pause');
        emit('ended');
      } else if (ytState === S.BUFFERING) {
        startTick();
      }
    }

    loadApi(8000).then((YT) => {
      yt = new YT.Player(mount, {
        width: 200,
        height: 200,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, playsinline: 1,
          rel: 0, iv_load_policy: 3, origin: location.origin },
        events: {
          onReady: () => {
            ytReady = true;
            applyVolume();
            if (pendingLoad && mode === 'yt') {
              const p = pendingLoad;
              pendingLoad = null;
              ytLoad(p.id, p.start, p.autoplay || !paused);
            }
          },
          onStateChange: onState,
          onError: (e) => {
            if (mode !== 'yt') return;
            if (YT_ERR_FALLBACK.has(e.data)) fallback(ytId, `error ${e.data}`);
          },
        },
      });
    }).catch(() => {
      // YouTube script blocked (ad blocker, network): server streams only.
      const p = pendingLoad;
      pendingLoad = null;
      ytAvailable = false;
      if (mode === 'yt') {
        mode = 'html';
        if (p) toHtml(p.id, p.start, p.autoplay || !paused);
      }
    });

    const forwarders = new Map(); // fn -> wrapper on <audio>

    const api = {
      get src() { return src; },
      set src(v) {
        src = String(v || '');
        clearTimeout(startTimer);
        settle(false, new DOMException('superseded', 'AbortError'));
        const proxied = src.includes('/api/audio');
        const id = proxied ? idFrom(src) : null;
        if (!src) {
          stopTick();
          try { yt && ytReady && yt.stopVideo(); } catch {}
          try { el.pause(); el.removeAttribute('src'); el.load(); } catch {}
          ytId = null;
          paused = true;
          return;
        }
        if (id && ytAvailable && !blocked.has(id)) {
          if (mode === 'html') { try { el.pause(); el.removeAttribute('src'); el.load(); } catch {} }
          mode = 'yt';
          paused = true;
          stopTick();
          if (loaded) { try { yt.pauseVideo(); } catch {} }
          ytLoad(id, 0, false);
          return;
        }
        toHtml(id, 0, false);
      },
      play() {
        if (mode === 'html') {
          return el.play();
        }
        paused = false;
        return new Promise((resolve, reject) => {
          playWaiters.push({ resolve, reject });
          if (!ytReady) {
            if (pendingLoad) pendingLoad.autoplay = true;
            return;
          }
          if (!ytId) { settle(false, new DOMException('no source', 'NotSupportedError')); return; }
          if (loaded && ytState === 1) { settle(true); return; }
          if (!loaded) ytLoad(ytId, cueStart, true);
          else { try { yt.playVideo(); } catch {} armStartTimer(ytId); }
        });
      },
      pause() {
        if (mode === 'html') return el.pause();
        clearTimeout(startTimer);
        try { yt && ytReady && yt.pauseVideo(); } catch {}
        if (!paused) { paused = true; stopTick(); emit('pause'); }
      },
      get paused() { return mode === 'html' ? el.paused : paused; },
      get ended() { return mode === 'html' ? el.ended : loaded && ytState === 0; },
      get currentTime() {
        if (mode === 'html') return el.currentTime;
        if (!loaded) return cueStart;
        try { return yt.getCurrentTime() || 0; } catch { return 0; }
      },
      set currentTime(t) {
        if (mode === 'html') { el.currentTime = t; return; }
        const at = Math.max(0, +t || 0);
        if (pendingLoad) { pendingLoad.start = at; return; }
        if (!ytReady || !ytId) return;
        if (!loaded) { cueStart = at; return; }
        try { yt.seekTo(at, true); } catch {}
        emit('timeupdate');
      },
      get duration() {
        if (mode === 'html') return el.duration;
        try { const d = loaded ? yt.getDuration() : 0; return d > 0 ? d : NaN; } catch { return NaN; }
      },
      get volume() { return mode === 'html' ? el.volume : volume; },
      set volume(v) {
        volume = Math.min(1, Math.max(0, +v || 0));
        if (mode === 'html') { el.volume = volume; return; }
        applyVolume();
      },
      get muted() { return mode === 'html' ? el.muted : muted; },
      set muted(m) {
        muted = !!m;
        if (mode === 'html') { el.muted = muted; return; }
        applyVolume();
      },
      get loop() { return loop; },
      set loop(l) { loop = !!l; el.loop = loop; },
      get readyState() {
        if (mode === 'html') return el.readyState;
        if (!ytId || !(api.duration > 0)) return 0;
        return ytState === 3 ? 2 : 4;
      },
      get buffered() {
        if (mode === 'html') return el.buffered;
        const d = api.duration;
        const f = (() => { try { return yt.getVideoLoadedFraction() || 0; } catch { return 0; } })();
        return d > 0
          ? { length: 1, start: () => 0, end: () => f * d }
          : { length: 0, start: () => 0, end: () => 0 };
      },
      get seeking() { return mode === 'html' ? el.seeking : false; },
      get playbackRate() { return mode === 'html' ? el.playbackRate : 1; },
      get engine() { return mode; },
      videoData() {
        try { return mode === 'yt' && ytReady ? yt.getVideoData() : null; } catch { return null; }
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
        const w = (e) => { if (mode === 'html') fn.call(api, e); };
        if (!forwarders.has(fn)) forwarders.set(fn, new Map());
        forwarders.get(fn).set(type, w);
        el.addEventListener(type, w);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
        const w = forwarders.get(fn)?.get(type);
        if (w) { el.removeEventListener(type, w); forwarders.get(fn).delete(type); }
      },
    };
    return api;
  };
})();
