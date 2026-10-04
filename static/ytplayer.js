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

  // opts.handoff (phones): YouTube plays while the app is open; the song is
  // copied to the edge cache meanwhile, and when the screen locks (which
  // pauses the embed) <audio> resumes from that copy at the same position.
  // iOS plays one media element at a time, so nothing pre-rolls alongside.
  window.MusePlayer = function (el, opts = {}) {
    const handoff = !!opts.handoff;
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

    // --- lock-screen handoff ------------------------------------------------
    // <audio> must play once inside a tap so iOS lets it start later while
    // the page is hidden; a blip of silence does that without fighting the embed.
    let unlocked = false;
    let warmed = '';
    let osPauseTimer = 0;

    const dbgBuf = [];
    const dbgT0 = Date.now();
    const dbg = (msg) => {
      if (!handoff) return;
      dbgBuf.push(`${((Date.now() - dbgT0) / 1000).toFixed(1)}s ${msg} | mode=${mode} hidden=${document.hidden}`
        + ` el:${el.paused ? 'paused' : 'playing'} muted=${el.muted} t=${(el.currentTime || 0).toFixed(1)}`
        + ` rs=${el.readyState} yt=${ytState} unlocked=${unlocked}`);
    };
    const dbgFlush = () => {
      if (!dbgBuf.length) return;
      const lines = dbgBuf.splice(0, dbgBuf.length);
      try {
        navigator.sendBeacon('/api/clientlog',
          new Blob([JSON.stringify({ lines })], { type: 'application/json' }));
      } catch {}
    };
    if (handoff) {
      setInterval(dbgFlush, 3000);
      ['play', 'playing', 'pause', 'waiting', 'stalled', 'emptied', 'ended', 'suspend'].forEach((t) =>
        el.addEventListener(t, () => dbg(`el ${t}`)));
      el.addEventListener('error', () => dbg(`el error ${el.error && el.error.code}`));
      document.addEventListener('visibilitychange', () => {
        dbg(`visibility ${document.visibilityState}`);
        if (document.hidden) dbgFlush();
      });
      window.addEventListener('pagehide', () => { dbg('pagehide'); dbgFlush(); });
    }
    const ytTime = () => { try { return yt.getCurrentTime() || 0; } catch { return 0; } };

    let silentUrl = '';
    function silence() {
      if (silentUrl) return silentUrl;
      const n = 800;
      const v = new DataView(new ArrayBuffer(44 + n));
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
      v.setUint16(32, 1, true); v.setUint16(34, 8, true);
      w(36, 'data'); v.setUint32(40, n, true);
      for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
      silentUrl = URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
      return silentUrl;
    }

    function unlock() {
      if (unlocked || mode !== 'yt') return;
      unlocked = true;
      el.muted = true;
      el.src = silence();
      el.play().then(() => {
        dbg('unlocked');
        if (mode === 'yt') { try { el.pause(); } catch {} }
      }).catch((e) => { unlocked = false; dbg(`unlock rejected ${e && e.name}`); });
    }

    function warm(id) {
      if (!id || warmed === id) return;
      warmed = id;
      fetch(`/api/audio?v=${id}&warm=1`).catch(() => {});
    }

    // The screen locked mid-song: carry on from the cached copy.
    function lockHandoff() {
      clearTimeout(osPauseTimer);
      osPauseTimer = 0;
      if (mode !== 'yt' || paused || !ytId) return;
      const id = ytId;
      const at = loaded ? ytTime() : cueStart;
      dbg(`lockHandoff ${id} at=${at.toFixed(1)}`);
      toHtml(id, at, true);
    }

    if (handoff) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && mode === 'yt' && !paused && ytId) lockHandoff();
      });
    }

    // --- html fallback ---------------------------------------------------
    function toHtml(id, startAt, autoplay) {
      dbg(`toHtml ${id} at=${(startAt || 0).toFixed(1)} autoplay=${autoplay}`);
      clearTimeout(osPauseTimer);
      clearTimeout(startTimer);
      stopTick();
      try { yt && ytReady && yt.stopVideo(); } catch {}
      mode = 'html';
      ytId = null;
      el.volume = volume;
      el.muted = muted;
      el.loop = loop;
      // #t= lets Safari fetch the bytes at the resume point first instead of
      // loading from 0:00 and seeking afterwards.
      el.src = id ? `/api/audio?v=${id}${startAt > 0 ? `#t=${startAt.toFixed(2)}` : ''}` : src;
      if (startAt > 0) {
        const seek = () => {
          el.removeEventListener('loadedmetadata', seek);
          try { if (Math.abs(el.currentTime - startAt) > 0.5) el.currentTime = startAt; } catch {}
        };
        el.addEventListener('loadedmetadata', seek);
      }
      if (autoplay) {
        el.play().then(() => settle(true)).catch((e) => { dbg(`toHtml play rejected ${e && e.name}`); settle(false, e); });
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
      dbg(`yt state ${e.data}`);
      const S = window.YT.PlayerState;
      if (ytState === S.PLAYING) {
        clearTimeout(startTimer);
        clearTimeout(osPauseTimer);
        applyVolume();
        paused = false;
        if (handoff) warm(ytId);
        startTick();
        if (!metaSent && api.duration > 0) { metaSent = true; emit('loadedmetadata'); }
        emit('play');
        emit('playing');
        settle(true);
      } else if (ytState === S.PAUSED) {
        // Paused without pause(): the OS locking the screen. visibilitychange
        // can land a moment after this, so wait before calling it a pause.
        if (handoff && !paused) {
          if (document.hidden) return lockHandoff();
          clearTimeout(osPauseTimer);
          osPauseTimer = setTimeout(() => {
            osPauseTimer = 0;
            if (mode !== 'yt' || paused || ytState !== S.PAUSED) return;
            stopTick();
            paused = true;
            emit('pause');
          }, 1200);
          return;
        }
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
        clearTimeout(osPauseTimer);
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
          // Hidden: leave <audio> untouched so play() can swap its src without
          // a gap; stopping it would end the session iOS won't let us restart.
          if (mode === 'html' && !(handoff && document.hidden)) {
            try { el.pause(); el.removeAttribute('src'); el.load(); } catch {}
          }
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
        const want = ytId || (pendingLoad && pendingLoad.id);
        dbg(`play() ${want}`);
        // A locked phone can't start the embed at all: go straight to <audio>.
        if (handoff && document.hidden && want) {
          const at = loaded ? ytTime() : cueStart;
          paused = false;
          return new Promise((resolve, reject) => {
            playWaiters.push({ resolve, reject });
            pendingLoad = null;
            toHtml(want, at, true);
          });
        }
        paused = false;
        return new Promise((resolve, reject) => {
          playWaiters.push({ resolve, reject });
          if (handoff) unlock();
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
        dbg('pause()');
        if (mode === 'html') return el.pause();
        clearTimeout(osPauseTimer);
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
