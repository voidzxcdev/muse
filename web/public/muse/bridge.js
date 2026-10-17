/* Muse bridge for the Riff UI (web/public/riff, MIT, (c) 2026 rootscripts).
   Loaded before riff's audio-engine.js and app.js. Riff talks to a local server at
   http://127.0.0.1:<port>/api/*; here those calls are answered from Muse's own /api/*
   (search, streams, lyrics, prefetch). It also keeps Muse's playback guarantees:
   - stall watchdog + one re-resolve retry (build 318),
   - prefetch of the next track and top results,
   - iPhone: no Web Audio routing (background / lock-screen audio keeps working),
   - desktop/Android shell bridges (MPRIS, Android playback service). */
(function () {
  'use strict';
  var ua = navigator.userAgent || '';
  var lane = window.__museLane || '';
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ua));
  var iphone = isIOS || lane === 'iphone';
  var androidApp = /MuseAndroid/i.test(ua) || !!window.__museAndroid;
  var touch = matchMedia('(pointer: coarse)').matches;
  var root = document.documentElement;
  root.classList.add('muse-web');
  if (iphone) root.classList.add('muse-ios');
  if (androidApp) root.classList.add('muse-android');
  if (touch) root.classList.add('muse-touch');

  var RIFF_PORT = 38472; // riff's default state.serverPort when there is no electronAPI
  var RIFF_API = 'http://127.0.0.1:' + RIFF_PORT + '/api/';
  var origFetch = window.fetch.bind(window);

  /* ---------- helpers ---------- */
  function json(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }
  function getJSON(path, signal) {
    return origFetch(path, { credentials: 'same-origin', signal: signal }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  var YT = /^[\w-]{11}$/;
  function cleanArtist(u) { return String(u || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim(); }
  function prettyTitle(s) {
    return String(s || '').replace(/\s*\[[^[\]]*\]/g, '').replace(/\s*［[^］]*］/g, '').replace(/\s*【[^】]*】/g, '')
      .replace(/\s*\((?:official\s*(?:music\s*)?(?:video|audio|visuali[sz]er|lyric(?:s)?\s*video)|lyrics?|audio|official|hd|4k|mv|m\/v|video\s*oficial|clip\s*officiel)[^)]*\)/ig, '')
      .replace(/\s{2,}/g, ' ').replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim();
  }
  var byId = Object.create(null);   // raw Muse rows by video id (for lyrics: raw title + duration)
  function toRiff(r) {
    if (!r || !YT.test(r.id || '')) return null;
    byId[r.id] = r;
    var t = prettyTitle(r.title || '');
    var a = cleanArtist(r.uploader || r.artist || '');
    var m = t.match(/^(.{1,80}?)\s+[-–—]\s+(.+)$/);
    if (m) { a = m[1].trim(); t = m[2].trim(); }
    return {
      id: r.id, title: t || r.title || 'Untitled', artist: a || 'Unknown artist',
      duration: Math.round(r.duration || 0),
      thumbnail: 'https://i.ytimg.com/vi/' + r.id + '/hqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=' + r.id, platform: 'youtube'
    };
  }
  function idOf(params) {
    var id = params.get('id') || '';
    if (YT.test(id)) return id;
    var u = params.get('url') || '';
    var m = u.match(/[?&]v=([\w-]{11})/) || u.match(/youtu\.be\/([\w-]{11})/);
    return m ? m[1] : '';
  }
  function streamUrl(id) { return '/api/audio?v=' + id + (iphone ? '&ios=1' : ''); }
  window.__museStreamUrl = streamUrl;

  /* prefetch (build 318): resolve the next track / top results into the server URL cache */
  var prefetched = Object.create(null), prefetchCount = 0;
  function prefetch(ids) {
    var want = ids.filter(function (x) { return x && YT.test(x) && !prefetched[x]; }).slice(0, 3);
    if (!want.length) return;
    want.forEach(function (x) { prefetched[x] = 1; prefetchCount++; });
    if (prefetchCount > 200) { prefetched = Object.create(null); prefetchCount = 0; }
    origFetch('/api/prefetch?v=' + want.join(','), { credentials: 'same-origin' }).catch(function () {});
  }
  window.__musePrefetch = prefetch;

  /* custom lyrics (riff's editor) are kept in this browser */
  var CUSTOM_LY = 'muse_custom_lyrics';
  function lyKey(t, a) { return (String(t || '') + '|' + String(a || '')).toLowerCase(); }
  function customLyrics() { try { return JSON.parse(localStorage.getItem(CUSTOM_LY) || '{}') || {}; } catch (e) { return {}; } }
  function fmtLrc(t) { var m = Math.floor(t / 60), s = t - m * 60; return '[' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(2) + ']'; }

  function findRaw(title, artist) {
    var cur = window.museRiff && window.museRiff.state && window.museRiff.state.currentTrack;
    if (cur && cur.title === title && byId[cur.id]) return byId[cur.id];
    for (var k in byId) { var t = toRiffCache(k); if (t && t.title === title && t.artist === artist) return byId[k]; }
    return null;
  }
  var riffCache = Object.create(null);
  function toRiffCache(id) { if (!riffCache[id]) riffCache[id] = toRiff(byId[id]); return riffCache[id]; }

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }

  /* ---------- riff /api/* → Muse ---------- */
  var handlers = {
    'tools-status': function () { return json({ ytDlp: true, ffmpeg: true, progress: { status: 'idle' } }); },
    'tools-install': function () { return json({ started: false }); },
    'state': function () { return json({ success: true }); },
    'search': function (p, init) {
      var q = (p.get('q') || '').trim();
      if (!q) return json({ success: false, error: 'empty query' });
      var n = Math.max(4, Math.min(15, parseInt(p.get('limit') || '15', 10) || 15));
      return getJSON('/api/search?q=' + encodeURIComponent(q) + '&n=' + n, init && init.signal).then(function (j) {
        var tracks = (j.results || []).map(toRiff).filter(Boolean);
        prefetch(tracks.slice(0, 2).map(function (t) { return t.id; }));
        return json({ success: true, tracks: tracks });
      }, function (e) { if (e && e.name === 'AbortError') throw e; return json({ success: false, error: e.message || 'search failed' }); });
    },
    'stream-info': function (p, init) {
      var id = idOf(p);
      if (!id) return json({ success: false, error: 'This track has no playable source' });
      // riff's prefetchNextQueueTrack() calls stream-info without a signal: only warm the cache.
      if (!init || !init.signal) { prefetch([id]); return json({ success: true, prefetch: true }); }
      return json({ success: true, streamUrl: streamUrl(id), isHls: false });
    },
    'prefetch': function (p) { prefetch([idOf(p)]); return json({ success: true }); },
    'check-cache': function () { return json({ cached: false, streamUrl: null }); },
    'lyrics': function (p) {
      var title = p.get('title') || '', artist = p.get('artist') || '';
      var mine = customLyrics()[lyKey(title, artist)];
      if (mine) return json({ success: true, lyrics: mine, isCustom: true });
      var raw = findRaw(title, artist);
      var q = '/api/lyrics?title=' + encodeURIComponent(raw ? raw.title : title) + '&artist=' + encodeURIComponent(raw ? cleanArtist(raw.uploader) || artist : artist) + '&duration=' + (raw ? raw.duration || 0 : 0);
      return getJSON(q).then(function (j) {
        var lines = j.lines || [];
        if (!lines.length) return json({ success: false });
        var synced = j.synced !== false && lines.some(function (l) { return l.t > 0; });
        var lrc = lines.map(function (l) { return (synced ? fmtLrc(l.t || 0) : '') + (l.text || ''); }).join('\n');
        return json({ success: true, lyrics: lrc, synced: synced });
      }, function () { return json({ success: false }); });
    },
    'save-custom-lyrics': function (p, init) {
      var body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
      var all = customLyrics(); var k = lyKey(p.get('title'), p.get('artist'));
      var text = body.lyrics != null ? body.lyrics : body.text;
      if (text) all[k] = String(text).slice(0, 60000); else delete all[k];
      try { localStorage.setItem(CUSTOM_LY, JSON.stringify(all)); } catch (e) {}
      return json({ success: true });
    },
    'artist': function (p) {
      var name = (p.get('name') || '').replace(/ - Topic|VEVO|Official|Records/gi, '').trim();
      if (!name) return json({ success: false, error: 'Missing artist name' }, 400);
      return getJSON('/api/search?q=' + encodeURIComponent(name) + '&n=15').then(function (j) {
        var tracks = (j.results || []).map(toRiff).filter(Boolean);
        var low = name.toLowerCase();
        var own = tracks.filter(function (t) { return t.artist.toLowerCase().indexOf(low) >= 0 || low.indexOf(t.artist.toLowerCase()) >= 0; });
        var list = own.length >= 3 ? own : tracks;
        return json({ success: true, artist: { name: (own[0] && own[0].artist) || name, avatar: list[0] ? list[0].thumbnail : '', bio: '', isVerified: false, tracks: list } });
      }, function () { return json({ success: false }); });
    },
    'vibe': function (p, init) {
      var body = {}; try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
      var limit = Math.max(4, Math.min(15, body.limit || 10));
      var seen = Object.create(null);
      (body.history || []).concat(body.favorites || []).forEach(function (t) { if (t && t.id) seen[t.id] = 1; });
      var pool = [];
      function finish() {
        var out = [], keys = Object.create(null);
        shuffle(pool).forEach(function (t) {
          var k = (t.artist + '|' + t.title).toLowerCase();
          if (!t || seen[t.id] || keys[k] || out.length >= limit) return;
          keys[k] = 1; out.push(t);
        });
        prefetch(out.slice(0, 1).map(function (t) { return t.id; }));
        return json({ success: out.length > 0, tracks: out });
      }
      var reco = window.museSession && window.museSession.me
        ? getJSON('/api/recommendations?n=15').then(function (j) { (j.tracks || []).map(toRiff).forEach(function (t) { if (t) pool.push(t); }); }, function () {})
        : Promise.resolve();
      return reco.then(function () {
        if (pool.length >= limit) return finish();
        var count = Object.create(null);
        (body.favorites || []).concat(body.history || []).forEach(function (t) { if (t && t.artist) count[t.artist] = (count[t.artist] || 0) + 1; });
        var seeds = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).slice(0, 4);
        seeds = shuffle(seeds).slice(0, 3);
        return Promise.all(seeds.map(function (a) {
          return getJSON('/api/search?q=' + encodeURIComponent(a) + '&n=8').then(function (j) {
            (j.results || []).map(toRiff).forEach(function (t) { if (t) pool.push(t); });
          }, function () {});
        })).then(finish);
      });
    },
    'translate': function () { return json({ success: false, error: 'Translation is not available in Muse' }); },
    'library': function () { return json({ success: true, tracks: [], items: [] }); },
    'offline-library': function () { return json({ success: true, tracks: [], items: [], size: 0 }); },
    'spotify-status': function () { return json({ success: true, connected: false }); }
  };

  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url) || '';
    if (raw.indexOf(RIFF_API) === 0) {
      var u = new URL(raw);
      var name = u.pathname.replace(/^\/api\//, '');
      var h = handlers[name];
      try {
        if (h) return Promise.resolve(h(u.searchParams, init || {}));
      } catch (e) { return Promise.resolve(json({ success: false, error: String(e && e.message || e) })); }
      return Promise.resolve(json({ success: false, error: 'Not available in Muse' }));
    }
    return origFetch(input, init);
  };

  /* ---------- engine routing guard ----------
     iPhone: a MediaElementSource'd <audio> goes silent when the AudioContext is suspended
     in the background / on the lock screen, and element volume is read-only. So on iOS the
     engine never attaches: the element plays natively (speed & pitch still work through
     playbackRate; EQ, enhancer, reverb/echo/distortion, crossfade and visualizers are off).
     Android app WebView: attach lazily, only once a Web Audio feature is switched on. */
  function routeAllowed(eng) {
    if (iphone) return false;
    if (!androidApp) return true;
    var s = eng.audioSettings || {};
    return !!(eng.hqEnabled || (eng.isModified && eng.isModified() && (s.reverb || s.echo || s.distortion || s.volume !== 1 || (s.eqBands || []).some(Boolean) || (s.eq && (s.eq.low || s.eq.mid || s.eq.high)))) || parseInt(localStorage.getItem('riff_crossfade') || '0', 10) > 0);
  }
  function patchEngine(E) {
    if (!E || E.__musePatched) return E;
    E.__musePatched = true;
    var P = E.prototype, init = P.init, master = P._applyMasterVolume, hq = P.setHqEnabled, set = P.setAudioSettings;
    P.init = function (el) {
      this._museEl = el || this._museEl;
      if (!this.ctx && !routeAllowed(this)) {
        if (el) this.applySettings(el);
        this._applyMasterVolume();
        return;
      }
      return init.call(this, el);
    };
    P._applyMasterVolume = function () {
      if (this.masterGain) return master.call(this);
      var el = this._museEl;
      if (el && !iphone) { try { el.volume = Math.max(0, Math.min(1, (this.isMuted ? 0 : this.volume) * Math.min(1, (this.audioSettings || {}).volume || 1))); } catch (e) {} }
    };
    P.setHqEnabled = function (on) { var r = hq.call(this, on); if (androidApp && this._museEl && !this.ctx && routeAllowed(this)) this.init(this._museEl); return r; };
    if (set) P.setAudioSettings = function (s) { var r = set.call(this, s); if (androidApp && this._museEl && !this.ctx && routeAllowed(this)) this.init(this._museEl); return r; };
    return E;
  }
  var EngineRef;
  try {
    Object.defineProperty(window, 'RiffAudioEngine', { configurable: true, get: function () { return EngineRef; }, set: function (v) { EngineRef = patchEngine(v); } });
  } catch (e) {}

  /* ---------- playback guard: stall watchdog + error retry (build 318) ---------- */
  var STALL_MS = 7000;
  function toast(msg, type) { try { window.museRiff && window.museRiff.showToast(msg, type || 'error'); } catch (e) {} }
  function attachWatchdog(audio) {
    var timer = null, attempt = 0, curId = '', errTries = 0;
    function clear() { if (timer) { clearTimeout(timer); timer = null; } }
    function idFromSrc() { var m = (audio.currentSrc || audio.src || '').match(/[?&]v=([\w-]{11})/); return m ? m[1] : ''; }
    function wantPlay() { return document.body.classList.contains('is-playing'); }
    function arm() {
      clear();
      timer = setTimeout(function () {
        if (!wantPlay() || idFromSrc() !== curId) return;
        if (audio.currentTime > 0.2 && !audio.paused && audio.readyState > 2) return;
        if (attempt === 0) {
          attempt = 1;
          try { audio.src = streamUrl(curId) + '&r=' + Date.now(); audio.play().catch(function () {}); } catch (e) {}
          arm();
          return;
        }
        toast('Track won\'t start: YouTube is not responding. Try again or pick another track.');
        try { window.pauseSmooth ? window.pauseSmooth() : audio.pause(); } catch (e) {}
      }, STALL_MS);
    }
    audio.addEventListener('loadstart', function () {
      var id = idFromSrc();
      if (!id) return;
      if (id !== curId) { curId = id; attempt = 0; errTries = 0; }
      arm();
    });
    audio.addEventListener('playing', function () { clear(); attempt = 0; });
    audio.addEventListener('waiting', function () { if (curId && wantPlay()) arm(); });
    audio.addEventListener('pause', clear);
    audio.addEventListener('timeupdate', function () {
      // prefetch the next queue track halfway through (riff only warms it on 'play')
      var s = window.museRiff && window.museRiff.state;
      if (!s || !audio.duration || audio.currentTime < audio.duration * 0.5) return;
      var n = s.queue && s.queue[s.queueIndex + 1];
      if (n && n.id) prefetch([n.id]);
    });
    audio.addEventListener('error', function () {
      var id = idFromSrc() || curId;
      if (!id) return;
      if (errTries < 1) {
        errTries++;
        var t = audio.currentTime;
        origFetch('/api/play?v=' + id, { credentials: 'same-origin' }).catch(function () {}).then(function () {
          if (idFromSrc() !== id && curId !== id) return;
          audio.src = streamUrl(id) + '&r=' + Date.now();
          if (t > 1) { try { audio.currentTime = t; } catch (e) {} }
          if (wantPlay()) audio.play().catch(function () {});
        });
        return;
      }
      var s = window.museRiff && window.museRiff.state;
      toast('Track failed to load, skipping');
      var next = document.getElementById('btn-next');
      if (s && s.queue && s.queue.length > 1 && next) next.click();
    });
  }

  /* ---------- presence (friends see "listening to …") ---------- */
  var presenceSeq = 0;
  function beat(away) {
    if (!window.museSession || !window.museSession.me) return;
    if (!away && document.hidden) return;
    var s = window.museRiff && window.museRiff.state, t = s && s.currentTrack;
    var listening = !away && t && s.isPlaying ? (t.artist ? t.artist + ' — ' : '') + t.title : '';
    presenceSeq++;
    origFetch('/api/presence', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(away ? { away: true, seq: presenceSeq } : { listening: String(listening).slice(0, 80), seq: presenceSeq }) }).catch(function () {});
  }
  setInterval(function () { beat(false); }, 12000);
  document.addEventListener('visibilitychange', function () { beat(document.hidden); });
  window.addEventListener('pagehide', function () { beat(true); });

  /* ---------- desktop (Linux MPRIS) / Android shell bridges ---------- */
  function shellTick(audio) {
    var s = window.museRiff && window.museRiff.state; if (!s) return;
    var t = s.currentTrack;
    try {
      if (typeof window.__musePushMpris === 'function') {
        window.__musePushMpris({ id: t ? t.id : '', title: t ? t.title : '', artist: t ? t.artist : '', art: t ? t.thumbnail : '',
          url: t ? t.url : '', playing: !audio.paused, stopped: !t, position: audio.currentTime || 0,
          duration: (isFinite(audio.duration) && audio.duration) || (t && t.duration) || 0, volume: s.volume });
      }
    } catch (e) {}
    if (androidApp) { try { window.MuseAndroid && window.MuseAndroid.playback && window.MuseAndroid.playback(!audio.paused, t ? t.title : 'Muse'); } catch (e) {} }
    try {
      if (t && 'setPositionState' in navigator.mediaSession && audio.duration > 0 && isFinite(audio.duration)) {
        navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.duration, audio.currentTime || 0), playbackRate: audio.playbackRate || 1 });
      }
    } catch (e) {}
  }
  // Android app notification buttons call these legacy globals.
  function click(id) { var b = document.getElementById(id); if (b) b.click(); }
  window.doPlay = function () { if (window.museRiff && !window.museRiff.state.isPlaying) click('btn-play-pause'); };
  window.doPause = function () { if (window.museRiff && window.museRiff.state.isPlaying) click('btn-play-pause'); };
  window.step = function (d) { return function () { click(d > 0 ? 'btn-next' : 'btn-prev'); }; };
  // Linux preload clicks these ids for MPRIS commands.
  function shellProxies() {
    var box = document.createElement('div'); box.id = 'muse-shell-proxy'; box.hidden = true;
    [['bPlay', 'btn-play-pause'], ['bNext', 'btn-next'], ['bPrev', 'btn-prev']].forEach(function (p) {
      var b = document.createElement('button'); b.id = p[0]; b.type = 'button'; b.tabIndex = -1;
      b.addEventListener('click', function () { click(p[1]); }); box.appendChild(b);
    });
    document.body.appendChild(box);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var audio = document.getElementById('native-audio');
    if (!audio) return;
    audio.setAttribute('playsinline', ''); audio.setAttribute('webkit-playsinline', '');
    attachWatchdog(audio);
    if (typeof window.__musePushMpris === 'function') shellProxies();
    var last = 0;
    audio.addEventListener('timeupdate', function () { var n = Date.now(); if (n - last > 1000) { last = n; shellTick(audio); } });
    ['play', 'pause', 'ended', 'loadstart'].forEach(function (ev) { audio.addEventListener(ev, function () { shellTick(audio); }); });
    var bPlay = document.getElementById('bPlay');
    if (bPlay) { audio.addEventListener('play', function () { bPlay.classList.add('playing'); }); audio.addEventListener('pause', function () { bPlay.classList.remove('playing'); }); }
  }, { once: true });

  window.museBridge = { toRiff: toRiff, prettyTitle: prettyTitle, cleanArtist: cleanArtist, streamUrl: streamUrl, prefetch: prefetch, getJSON: getJSON, fetch: origFetch, iphone: iphone, androidApp: androidApp };
})();
