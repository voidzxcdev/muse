/* Muse accounts, profiles, friends and chats inside the Riff UI.
   Markup reuses Riff's components (content-view, view-header, track-row, btn-pill-primary,
   btn-icon-pill, dialog-card, sp-modes, m3-dropdown, artist-hero-card) so these screens look
   like the rest of Riff. Talks only to Muse's /api/*. */
(function () {
  'use strict';
  var B = window.museBridge, R = null;
  var S = window.museSession = { me: null, friends: null, unseen: 0 };
  var $ = function (id) { return document.getElementById(id); };
  var fetchRaw = B ? B.fetch : window.fetch.bind(window);
  var desktopShell = !!(window.chrome && window.chrome.webview) || !!window.__museDesktop || window.__museLane === 'pc';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toast(msg, type) { if (R) R.showToast(msg, type || 'info'); }
  function req(method, path, body, timeoutMs) {
    var ctl = new AbortController(); var t = setTimeout(function () { ctl.abort(); }, timeoutMs || 30000);
    var opts = { method: method, credentials: 'same-origin', signal: ctl.signal };
    if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    return fetchRaw(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    }, function (e) { if (e && e.name === 'AbortError') throw new Error('Request timed out, try again'); throw e; })
      .finally(function () { clearTimeout(t); });
  }
  var api = function (p) { return req('GET', p); };
  var post = function (p, b) { return req('POST', p, b || {}); };
  function upload(path, blob, headers) {
    var h = { 'Content-Type': blob.type || 'application/octet-stream' };
    for (var k in (headers || {})) h[k] = headers[k];
    return fetchRaw(path, { method: 'POST', credentials: 'same-origin', headers: h, body: blob }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    });
  }
  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function timeOf(ts) { try { return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function seenLabel(u) {
    if (!u) return '';
    if (u.online) return u.listening ? 'Listening to ' + u.listening : 'Online';
    if (!u.seen) return '';
    var d = Date.now() / 1000 - u.seen;
    if (d < 3600) return 'Seen ' + Math.max(1, Math.round(d / 60)) + ' min ago';
    if (d < 86400) return 'Seen ' + Math.round(d / 3600) + ' h ago';
    return 'Seen ' + Math.round(d / 86400) + ' d ago';
  }
  function avatar(u, size, online) {
    u = u || {};
    var letter = ((u.display || u.handle || '?')[0] || '?').toUpperCase();
    var inner = u.avatar ? '<img src="' + esc(u.avatar) + '" alt="" draggable="false">'
      : '<span class="muse-avatar-letter" style="background:hsl(' + (u.hue != null ? u.hue : 145) + ' 42% 38%)">' + esc(letter) + '</span>';
    return '<span class="muse-avatar" style="--s:' + (size || 40) + 'px">' + inner + (online ? '<i class="muse-online"></i>' : '') + '</span>';
  }
  var ICON = {
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
    pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>',
    chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    add: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="5 12.5 10 17.5 19 7.5"></polyline></svg>',
    check1: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="5 12.5 10 17.5 19 7.5"></polyline></svg>',
    checks: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="2 12.5 7 17.5 16 7.5"></polyline><polyline points="10 15.5 12 17.5 21 7.5"></polyline></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    more: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle><circle cx="5" cy="12" r="2"></circle></svg>',
    link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
    out: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>',
    bell: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
    user: '<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path></svg>'
  };
  function go(view) { if (R) R.switchView(view); }
  function writeClip(t) { try { return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return false; }); } catch (e) { return Promise.resolve(false); } }
  function publicLink(h) { return location.origin + '/@' + h; }
  // pointerdown-started taps on touch (Сёма's rule) and plain clicks elsewhere; never fires twice
  function onTap(node, fn) {
    if (!node) return;
    var downAt = 0;
    node.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch' || e.button > 0) return;
      downAt = Date.now(); node._sx = e.clientX; node._sy = e.clientY;
    });
    node.addEventListener('pointerup', function (e) {
      if (e.pointerType !== 'touch' || !downAt) return;
      var moved = Math.abs(e.clientX - node._sx) > 10 || Math.abs(e.clientY - node._sy) > 10;
      downAt = 0; if (moved) return;
      node._tapped = Date.now(); fn(e);
    });
    node.addEventListener('click', function (e) { if (node._tapped && Date.now() - node._tapped < 700) { node._tapped = 0; return; } fn(e); });
  }

  /* ---------------- confirm (Riff dialog-card) ---------------- */
  function confirmBox(title, text, okLabel) {
    return new Promise(function (res) {
      var m = $('muse-confirm-modal');
      $('muse-confirm-title').textContent = title; $('muse-confirm-text').textContent = text || '';
      $('btn-muse-confirm-ok').textContent = okLabel || 'OK';
      var done = function (v) { R.closeModal(m); $('btn-muse-confirm-ok').onclick = null; $('btn-muse-confirm-cancel').onclick = null; res(v); };
      $('btn-muse-confirm-ok').onclick = function () { done(true); };
      $('btn-muse-confirm-cancel').onclick = function () { done(false); };
      R.openModal(m);
    });
  }

  /* ---------------- session ---------------- */
  var RAIL_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>';
  function setMe(u) {
    var was = S.me && S.me.id;
    S.me = u || null;
    var rail = $('muse-rail-avatar');
    if (rail) rail.innerHTML = S.me ? avatar(S.me, 28) : RAIL_ICON;
    var nav = $('nav-account'); if (nav) nav.title = S.me ? (S.me.display || S.me.handle) : 'Sign in';
    if ((S.me && S.me.id) !== was) {
      S.friends = null;
      if (S.me) { startNotifs(); syncLikesFromServer(); ensurePush(); } else stopNotifs();
    }
    if (R && R.state.currentView === 'account') renderAccount();
    if (R && R.state.currentView === 'friends') renderFriends();
  }
  function refreshMe() { return api('/api/me').then(function (j) { setMe(j.user); }, function () {}); }

  /* ---------------- auth dialog ---------------- */
  var authMode = 'signin', authAfter = null;
  function setAuthMode(m) {
    authMode = m;
    document.querySelectorAll('#muse-auth-modes button').forEach(function (b) { b.classList.toggle('active', b.dataset.mode === m); });
    $('muse-auth-title').textContent = m === 'signin' ? 'Sign in to Muse' : 'Create a Muse account';
    $('btn-muse-auth-submit').textContent = m === 'signin' ? 'Sign in' : 'Create account';
    $('muse-auth-tos-row').classList.toggle('hidden', m !== 'signup');
    $('muse-auth-pass').autocomplete = m === 'signin' ? 'current-password' : 'new-password';
    $('muse-auth-error').classList.add('hidden');
  }
  function openAuth(mode, after) {
    authAfter = after || null;
    setAuthMode(mode || 'signin');
    R.openModal($('muse-auth-modal'));
    setTimeout(function () { try { $('muse-auth-user').focus(); } catch (e) {} }, 220);
  }
  function needAuth(after) { if (S.me) return false; openAuth('signin', after); return true; }
  function bindAuth() {
    document.querySelectorAll('#muse-auth-modes button').forEach(function (b) { onTap(b, function () { setAuthMode(b.dataset.mode); }); });
    onTap($('btn-muse-auth-cancel'), function () { R.closeModal($('muse-auth-modal')); });
    $('muse-auth-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var u = $('muse-auth-user').value.trim(), p = $('muse-auth-pass').value, err = $('muse-auth-error');
      var body = { username: u, password: p };
      if (authMode === 'signup') {
        if (!$('muse-auth-tos').checked) { err.textContent = 'Accept the terms to create an account'; err.classList.remove('hidden'); return; }
        body.accepted_tos = true;
      }
      var btn = $('btn-muse-auth-submit'); btn.disabled = true;
      post(authMode === 'signin' ? '/api/login' : '/api/signup', body).then(function (j) {
        R.closeModal($('muse-auth-modal'));
        $('muse-auth-pass').value = '';
        setMe(j.user);
        toast(authMode === 'signin' ? 'Signed in as @' + j.user.handle : 'Welcome to Muse, @' + j.user.handle, 'success');
        var a = authAfter; authAfter = null; if (a) a();
      }, function (ex) { err.textContent = ex.message || 'Could not sign in'; err.classList.remove('hidden'); })
        .finally(function () { btn.disabled = false; });
    });
  }

  /* ---------------- account view (Riff's artist hero + settings rows) ---------------- */
  var BACK_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>';
  function heroHTML(u, opts) {
    opts = opts || {};
    return '<div class="artist-hero-card muse-hero">' +
      (opts.back ? '<button class="btn-icon-pill btn-back-artist" data-act="back" title="Back">' + BACK_SVG + '</button>' : '') +
      '<div class="artist-card-body"><div class="artist-avatar-wrap muse-hero-avatar">' + (opts.avatar || avatar(u, 104, opts.online)) + '</div>' +
      '<div class="artist-meta-box">' + (opts.badge ? '<div class="artist-verified-badge"><span>' + esc(opts.badge) + '</span></div>' : '') +
      '<h1 class="artist-title">' + esc(opts.title || (u && (u.display || u.handle)) || '') + '</h1>' +
      '<p class="artist-bio-snippet muse-bio">' + esc(opts.sub || '') + '</p>' +
      '<div class="artist-actions-bar">' + (opts.actions || '') + '</div></div></div></div>';
  }
  function settingRow(name, desc, right) {
    return '<div class="setting-item"><div class="setting-item-top muse-setting-top">' +
      '<div class="muse-setting-text"><span class="setting-name">' + esc(name) + '</span>' +
      '<span class="muse-setting-desc">' + esc(desc) + '</span></div>' + right + '</div></div>';
  }
  function bindActs(box, map) {
    box.querySelectorAll('[data-act]').forEach(function (b) { var f = map[b.dataset.act]; if (f) onTap(b, function (e) { e.stopPropagation(); f(b, e); }); });
  }
  function renderAccount() {
    var box = $('account-body'); if (!box) return;
    if (!S.me) {
      box.innerHTML = heroHTML(null, { avatar: '<img class="muse-hero-logo" src="/icons/icon-512.png" alt="">', title: 'Muse account', badge: 'Optional',
        sub: 'Sign in to chat with friends, share tracks and see what they are listening to.',
        actions: '<button class="btn-pill-primary" data-act="signin">Sign in</button><button class="btn-outline-pill" data-act="signup">Create account</button>' });
      bindActs(box, { signin: function () { openAuth('signin'); }, signup: function () { openAuth('signup'); } });
      return;
    }
    var u = S.me;
    var pushOn = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    box.innerHTML = heroHTML(u, { badge: '@' + u.handle, sub: 'On Muse since ' + new Date((u.created || 0) * 1000).toLocaleDateString([], { month: 'long', year: 'numeric' }),
      actions: '<button class="btn-pill-primary" data-act="edit">' + ICON.edit + '<span>Edit profile</span></button>' +
        '<button class="btn-outline-pill" data-act="link">' + ICON.link + '<span>Copy link</span></button>' +
        '<button class="btn-outline-pill" data-act="chats">' + ICON.chat + '<span>Chats</span></button>' }) +
      '<div class="artist-content-section"><div class="section-sub-header"><h3>Account</h3></div><div class="m3-group">' +
      settingRow('Notifications', pushOn ? 'New messages and friend requests reach you here.' : 'Get notified about new messages and friend requests.', pushOn ? '<span class="view-subtitle">On</span>' : '<button class="btn-outline-pill" data-act="notif">' + ICON.bell + '<span>Turn on</span></button>') +
      settingRow('Public profile', publicLink(u.handle), '<button class="btn-outline-pill" data-act="profile">Open</button>') +
      settingRow('Sign out', 'Favorites and playlists stay in this browser.', '<button class="btn-outline-pill" data-act="logout">' + ICON.out + '<span>Sign out</span></button>') +
      '</div></div>';
    bindActs(box, {
      edit: openProfileEdit,
      link: function () { writeClip(publicLink(u.handle)).then(function (ok) { toast(ok ? 'Link copied' : publicLink(u.handle), ok ? 'success' : 'info'); }); },
      chats: function () { go('friends'); },
      notif: function () { askNotif(); },
      profile: function () { openUser(u.handle); },
      logout: function () {
        confirmBox('Sign out', 'Sign out of @' + u.handle + ' on this device?', 'Sign out').then(function (ok) {
          if (!ok) return;
          dropPush().finally(function () { post('/api/logout').catch(function () {}).finally(function () { setMe(null); toast('Signed out'); }); });
        });
      }
    });
  }

  /* edit profile */
  function openProfileEdit() {
    var u = S.me; if (!u) return;
    $('muse-edit-avatar').innerHTML = avatar(u, 72);
    $('muse-edit-display').value = u.display || '';
    $('muse-edit-handle').value = u.handle || '';
    $('muse-profile-error').classList.add('hidden');
    R.openModal($('muse-profile-modal'));
  }
  function bindProfileEdit() {
    onTap($('btn-muse-profile-cancel'), function () { R.closeModal($('muse-profile-modal')); });
    onTap($('btn-muse-avatar'), function () { $('muse-avatar-file').click(); });
    $('muse-avatar-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      prepImage(f, 1024).then(function (blob) { return upload('/api/me/avatar', blob); }).then(function (j) {
        if (j.user) setMe(j.user);
        $('muse-edit-avatar').innerHTML = avatar(S.me, 72);
        toast('Photo updated', 'success');
      }, function (ex) { toast(ex.message || 'Upload failed', 'error'); });
    });
    onTap($('btn-muse-profile-save'), function () {
      var u = S.me, err = $('muse-profile-error');
      var body = { display: $('muse-edit-display').value.trim() };
      var h = $('muse-edit-handle').value.trim().replace(/^@/, '').toLowerCase();
      if (h && h !== u.handle) body.handle = h;
      post('/api/me', body).then(function (j) {
        if (j.user) setMe(j.user); else refreshMe();
        R.closeModal($('muse-profile-modal')); toast('Profile saved', 'success');
      }, function (ex) { err.textContent = ex.message; err.classList.remove('hidden'); });
    });
  }

  /* ---------------- other users' profiles ---------------- */
  var userBack = 'friends';
  function openUser(handle) {
    handle = String(handle || '').replace(/^@/, '');
    if (!handle) return;
    if (R.state.currentView !== 'user') userBack = R.state.currentView;
    var box = $('user-body');
    box.innerHTML = '<div class="empty-hint">Loading @' + esc(handle) + '...</div>';
    go('user');
    api('/api/u/' + encodeURIComponent(handle)).then(function (d) {
      var u = d.user || {}, locked = !!d.hidden && !u.mine;
      var act = '';
      if (u.mine) act = '<button class="btn-pill-primary" data-act="edit">' + ICON.edit + '<span>Edit profile</span></button>';
      else if (d.friend === 'friends') act = '<button class="btn-pill-primary" data-act="msg">' + ICON.chat + '<span>Message</span></button>';
      else if (d.friend === 'outgoing') act = '<button class="btn-outline-pill" disabled>Request sent</button>';
      else if (d.friend === 'incoming') act = '<button class="btn-pill-primary" data-act="accept">' + ICON.check + '<span>Accept request</span></button>';
      else act = '<button class="btn-pill-primary" data-act="add">' + ICON.add + '<span>Add friend</span></button>';
      act += '<button class="btn-outline-pill" data-act="link">' + ICON.link + '<span>Copy link</span></button>';
      var omitted = {}; (d.omitted || []).forEach(function (k) { omitted[k] = 1; });
      var likes = !locked && (u.mine || !omitted.likes) ? (d.likes || []) : [];
      box.innerHTML = heroHTML(u, { back: true, online: !u.mine && u.online, title: locked ? 'Private profile' : (u.display || u.handle), badge: '@' + (u.handle || handle),
        sub: locked ? 'This profile is private.' : (u.mine ? 'This is you' : seenLabel(u)), actions: act, avatar: locked ? '<span class="artist-avatar-fallback">' + ICON.user + '</span>' : null }) +
        (locked ? '' : '<div class="artist-content-section"><div class="section-sub-header"><h3>Favorite tracks</h3><span class="view-subtitle">' + likes.length + ' tracks</span></div><div class="tracks-list" id="user-likes"></div></div>');
      var tracks = likes.map(B.toRiff).filter(Boolean);
      var list = $('user-likes');
      if (list) { if (tracks.length) R.renderTracks(list, tracks, 'profile'); else list.innerHTML = '<div class="empty-hint">Nothing here yet.</div>'; }
      var friendAct = function (path, ok) { if (needAuth()) return; post(path, { handle: u.handle }).then(function () { toast(ok, 'success'); openUser(u.handle); loadFriends(); }, function (e) { toast(e.message, 'error'); }); };
      bindActs(box, {
        back: function () { go(userBack && userBack !== 'user' ? userBack : 'friends'); },
        edit: openProfileEdit, msg: function () { openChat(u.handle); },
        accept: function () { friendAct('/api/friends/accept', 'You are now friends'); },
        add: function () { friendAct('/api/friends/request', 'Friend request sent'); },
        link: function () { writeClip(publicLink(u.handle || handle)).then(function () { toast('Link copied', 'success'); }); }
      });
    }, function () {
      box.innerHTML = heroHTML(null, { back: true, avatar: '<span class="artist-avatar-fallback">' + ICON.user + '</span>', title: 'Not found', sub: 'There is no @' + handle + ' on Muse.' });
      bindActs(box, { back: function () { go('friends'); } });
    });
  }

  /* ---------------- friends view (Riff track rows) ---------------- */
  function personRow(u, idx, opts) {
    opts = opts || {};
    return '<div class="track-row muse-person-row' + (opts.active ? ' playing' : '') + '" tabindex="0" data-handle="' + esc(u.handle) + '">' +
      '<span class="track-row-index">' + (idx + 1) + '</span>' + avatar(u, 40, u.online) +
      '<div class="track-row-info"><span class="track-row-title">' + esc(u.display || u.handle) + '</span>' +
      '<span class="track-row-artist' + (u.online ? ' muse-online-text' : '') + '">' + esc(opts.sub != null ? opts.sub : (seenLabel(u) || '@' + u.handle)) + '</span></div>' +
      '<div class="muse-row-actions">' + (opts.right || '') + '</div></div>';
  }
  function section(title, count, body) {
    return '<div class="section-sub-header muse-section"><h3>' + esc(title) + '</h3>' + (count != null ? '<span class="view-subtitle">' + count + '</span>' : '') + '</div><div class="tracks-list">' + body + '</div>';
  }
  var SPINNER = '<div class="m3-loader-container muse-loader"><svg class="g-spinner" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20"/></svg></div>';
  var searchHits = null, searchQ = '';
  function loadFriends() {
    if (!S.me) return Promise.resolve();
    return api('/api/friends').then(function (j) { S.friends = j; if (R.state.currentView === 'friends') renderFriends(); }, function () {});
  }
  function renderFriends() {
    var box = $('friends-body'); if (!box) return;
    var sb = $('friends-search-box');
    if (!S.me) {
      sb.classList.add('hidden');
      $('friends-subtitle').textContent = 'Sign in to chat';
      box.innerHTML = '<div class="empty-hint muse-empty"><span>Sign in to add friends, send tracks, voice messages and round videos, and see what friends are listening to.</span><button class="btn-pill-primary" data-act="signin">Sign in</button></div>';
      bindActs(box, { signin: function () { openAuth('signin'); } });
      return;
    }
    sb.classList.remove('hidden');
    var d = S.friends;
    if (!d) { box.innerHTML = SPINNER; return; }
    $('friends-subtitle').textContent = d.friends.length + (d.friends.length === 1 ? ' friend' : ' friends') + (d.incoming.length ? ' · ' + d.incoming.length + ' new requests' : '');
    var html = '';
    var has = function (list, h) { return list.some(function (f) { return f.handle === h; }); };
    var isF = function (h) { return has(d.friends, h); };
    if (searchHits) {
      var hits = searchHits.filter(function (u) { return u.handle !== S.me.handle; });
      html += section('People', hits.length, hits.length ? hits.map(function (u, i) {
        var right = isF(u.handle) ? '<button class="btn-outline-pill" data-chat="' + esc(u.handle) + '">' + ICON.chat + '<span>Chat</span></button>'
          : has(d.outgoing, u.handle) ? '<span class="view-subtitle">Sent</span>'
          : has(d.incoming, u.handle) ? '<button class="btn-pill-primary" data-accept="' + esc(u.handle) + '">Accept</button>'
          : '<button class="btn-icon-pill" title="Add friend" aria-label="Add friend" data-add="' + esc(u.handle) + '">' + ICON.add + '</button>';
        return personRow(u, i, { right: right });
      }).join('') : '<div class="empty-hint">Nobody found.</div>');
    }
    if (d.incoming.length) html += section('Requests', d.incoming.length, d.incoming.map(function (u, i) {
      return personRow(u, i, { sub: '@' + u.handle + ' wants to be friends', right: '<button class="btn-icon-pill" title="Accept" aria-label="Accept" data-accept="' + esc(u.handle) + '">' + ICON.check + '</button><button class="btn-icon-pill delete-btn" title="Decline" aria-label="Decline" data-decline="' + esc(u.handle) + '">' + ICON.x + '</button>' });
    }).join(''));
    html += section('Friends', d.friends.length, d.friends.length ? d.friends.map(function (u, i) {
      return personRow(u, i, { right: '<button class="btn-icon-pill" title="Message" aria-label="Message" data-chat="' + esc(u.handle) + '">' + ICON.chat + '</button>' });
    }).join('') : '<div class="empty-hint">No friends yet. Find people by @handle above.</div>');
    if (d.outgoing.length) html += section('Sent requests', d.outgoing.length, d.outgoing.map(function (u, i) { return personRow(u, i, { sub: 'Waiting for an answer' }); }).join(''));
    box.innerHTML = html;
    var openRow = function (h) { if (isF(h)) openChat(h); else openUser(h); };
    box.querySelectorAll('.muse-person-row').forEach(function (row) {
      var h = row.dataset.handle;
      onTap(row, function (e) { if (e.target.closest('button')) return; openRow(h); });
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter') openRow(h); });
    });
    var act = function (path, h, ok) { post(path, { handle: h }).then(function () { toast(ok, 'success'); loadFriends(); }, function (e) { toast(e.message, 'error'); }); };
    box.querySelectorAll('[data-chat]').forEach(function (b) { onTap(b, function (e) { e.stopPropagation(); openChat(b.dataset.chat); }); });
    box.querySelectorAll('[data-add]').forEach(function (b) { onTap(b, function (e) { e.stopPropagation(); act('/api/friends/request', b.dataset.add, 'Friend request sent'); }); });
    box.querySelectorAll('[data-accept]').forEach(function (b) { onTap(b, function (e) { e.stopPropagation(); act('/api/friends/accept', b.dataset.accept, 'You are now friends'); }); });
    box.querySelectorAll('[data-decline]').forEach(function (b) { onTap(b, function (e) { e.stopPropagation(); act('/api/friends/decline', b.dataset.decline, 'Declined'); }); });
  }
  function bindFriendsSearch() {
    var inp = $('friends-search-input'), timer = null, ctl = null;
    inp.addEventListener('input', function () {
      searchQ = inp.value.trim().replace(/^@/, '');
      clearTimeout(timer); if (ctl) ctl.abort();
      if (searchQ.length < 2) { searchHits = null; renderFriends(); return; }
      timer = setTimeout(function () {
        ctl = new AbortController();
        fetchRaw('/api/users?q=' + encodeURIComponent(searchQ) + '&n=8', { credentials: 'same-origin', signal: ctl.signal })
          .then(function (r) { return r.json(); }).then(function (j) { searchHits = j.users || []; renderFriends(); }, function () {});
      }, 250);
    });
  }

  /* ---------------- chat ---------------- */
  var REACTS = ['❤️', '🔥', '👍', '😂', '😮', '😢', '🎉'];
  var C = { handle: null, peer: null, msgs: [], lastId: 0, since: 0, timer: null, replyTo: null, editId: null, busy: false, typingAt: 0, gen: 0 };
  function openChat(handle) {
    if (needAuth(function () { openChat(handle); })) return;
    handle = String(handle || '').replace(/^@/, '');
    stopChatPoll();
    C.handle = handle; C.peer = null; C.msgs = []; C.lastId = 0; C.since = 0; C.replyTo = null; C.editId = null; C.gen++;
    $('chat-log').innerHTML = SPINNER;
    $('chat-peer-name').textContent = '@' + handle; $('chat-peer-status').textContent = '';
    $('chat-peer-avatar').innerHTML = avatar({ handle: handle }, 40);
    setReply(null);
    go('chat');
    pollChat(true);
    post('/api/notifs/seen', { handle: handle }).then(pollNotifs, function () {});
  }
  function watchSW() {
    try { var c = navigator.serviceWorker && navigator.serviceWorker.controller; if (c) c.postMessage({ type: 'muse-watch', handle: R.state.currentView === 'chat' ? (C.handle || '') : '', visible: !document.hidden }); } catch (e) {}
  }
  function stopChatPoll() { clearTimeout(C.timer); C.timer = null; }
  function schedulePoll() { stopChatPoll(); if (R.state.currentView === 'chat' && C.handle) C.timer = setTimeout(function () { pollChat(false); }, document.hidden ? 10000 : 2500); }
  function pollChat(first) {
    var h = C.handle, gen = C.gen; if (!h) return;
    var q = '/api/friends/chat?with=' + encodeURIComponent(h) + (C.lastId ? '&after=' + C.lastId + '&since=' + C.since : '');
    api(q).then(function (j) {
      if (gen !== C.gen) return;
      C.peer = j['with'] || C.peer;
      if (C.peer) {
        $('chat-peer-name').textContent = C.peer.display || C.peer.handle;
        $('chat-peer-avatar').innerHTML = avatar(C.peer, 40, C.peer.online);
      }
      $('chat-peer-status').textContent = j.typing ? 'typing...' : seenLabel(C.peer);
      merge(j.messages || [], j.edits || [], j.peer_read || 0, first);
    }, function (e) {
      if (gen !== C.gen) return;
      if (first) $('chat-log').innerHTML = '<div class="empty-hint">' + esc(e.status === 403 ? 'You can only chat with friends.' : (e.message || 'Could not load the chat')) + '</div>';
    }).finally(function () { if (gen === C.gen) schedulePoll(); });
  }
  function merge(msgs, edits, peerRead, first) {
    var changed = first, byId = {};
    C.msgs.forEach(function (m, i) { byId[m.id] = i; });
    msgs.concat(edits).forEach(function (m) {
      if (byId[m.id] != null) { C.msgs[byId[m.id]] = m; changed = true; }
      else { byId[m.id] = C.msgs.length; C.msgs.push(m); changed = true; }
      if (m.id > C.lastId) C.lastId = m.id;
      var up = m.updated || m.created || 0; if (up > C.since) C.since = up;
    });
    C.msgs.forEach(function (m) { if (m.mine) { var r = m.id <= peerRead; if (r !== m.read) { m.read = r; changed = true; } } });
    C.msgs.sort(function (a, b) { return a.id - b.id; });
    if (changed) renderLog(first || msgs.length > 0);
  }
  function snippet(m) {
    if (!m) return '';
    if (m.kind === 'deleted') return 'Deleted message';
    if (m.body) return m.body;
    var p = m.payload || {};
    return ({ song: 'Track: ' + (p.title || ''), playlist: 'Playlist: ' + (p.name || ''), profile: 'Profile @' + (p.handle || ''), voice: 'Voice message', audio: 'Audio', video: 'Video', round: 'Round video', gif: 'GIF', image: 'Photo' })[m.kind] || 'Message';
  }
  function bubbleBody(m) {
    var p = m.payload || {}, txt = m.body ? '<div class="muse-msg-text">' + esc(m.body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>') + '</div>' : '';
    switch (m.kind) {
      case 'deleted': return '<div class="muse-msg-text muse-msg-deleted">Message deleted</div>';
      case 'song': return '<div class="track-row muse-msg-song" data-song="' + esc(p.id) + '"><img class="track-row-thumb" src="' + esc(p.thumbnail || ('https://i.ytimg.com/vi/' + p.id + '/hqdefault.jpg')) + '" alt="" loading="lazy">' +
        '<div class="track-row-info"><span class="track-row-title">' + esc(B.prettyTitle ? B.prettyTitle(p.title || 'Track') : (p.title || 'Track')) + '</span><span class="track-row-artist">' + (p.duration ? fmt(p.duration) : 'Track') + '</span></div>' +
        '<span class="muse-msg-play">' + ICON.play + '</span></div>' + txt;
      case 'profile': return '<div class="track-row muse-msg-song" data-user="' + esc(p.handle) + '">' + avatar(p, 40) + '<div class="track-row-info"><span class="track-row-title">' + esc(p.display || p.handle) + '</span><span class="track-row-artist">@' + esc(p.handle) + '</span></div></div>' + txt;
      case 'playlist': return '<div class="track-row muse-msg-song"><div class="track-row-info"><span class="track-row-title">' + esc(p.name || 'Playlist') + '</span><span class="track-row-artist">' + (p.count || 0) + ' tracks · @' + esc(p.handle || '') + '</span></div></div>' + txt;
      case 'image': return '<img class="muse-msg-media" data-media="image" src="' + esc(p.url) + '" alt="" loading="lazy">' + txt;
      case 'gif': return (/\.(mp4|webm)(\?|$)/i.test(p.url || '') || /video/.test(p.ctype || '') ? '<video class="muse-msg-media" src="' + esc(p.url) + '" autoplay loop muted playsinline></video>' : '<img class="muse-msg-media" data-media="image" src="' + esc(p.url) + '" alt="GIF" loading="lazy">') + txt;
      case 'video': return '<video class="muse-msg-media" data-media="video" src="' + esc(p.url) + '#t=0.1" preload="metadata" playsinline></video>' + txt;
      case 'round': return '<div class="muse-round" data-round><video src="' + esc(p.url) + '#t=0.1" preload="metadata" playsinline webkit-playsinline></video><span class="muse-round-play">' + ICON.play + '</span><span class="muse-round-time">' + fmt(p.duration) + '</span></div>' + txt;
      case 'voice': case 'audio': {
        var bars = ''; for (var i = 0; i < 28; i++) { var hgt = 25 + Math.round(70 * Math.abs(Math.sin((m.id + 1) * (i + 3) * 0.37))); bars += '<i style="height:' + hgt + '%"></i>'; }
        return '<div class="muse-voice" data-voice="' + esc(p.url) + '"><button class="btn-play-pause muse-voice-btn" aria-label="Play">' + ICON.play + '</button><span class="muse-voice-bars">' + bars + '</span><span class="muse-voice-time">' + fmt(p.duration) + '</span></div>' + txt;
      }
      default: return txt;
    }
  }
  function renderLog(stick) {
    var log = $('chat-log'); if (!log) return;
    var nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 120;
    if (!C.msgs.length) { log.innerHTML = '<div class="empty-hint">No messages yet. Say hi or send a track.</div>'; return; }
    var html = '', lastDay = '';
    C.msgs.forEach(function (m) {
      var day = new Date(m.created * 1000).toDateString();
      if (day !== lastDay) { lastDay = day; html += '<div class="muse-day"><span>' + esc(new Date(m.created * 1000).toLocaleDateString([], { day: 'numeric', month: 'long' })) + '</span></div>'; }
      var media = /^(image|gif|video|round)$/.test(m.kind) && !m.body;
      html += '<div class="muse-msg' + (m.mine ? ' mine' : '') + (media ? ' media' : '') + (m.kind === 'round' ? ' round' : '') + '" data-id="' + m.id + '">' +
        '<div class="muse-bubble">' + (m.reply ? '<div class="muse-msg-reply" data-jump="' + m.reply.id + '">' + esc(snippet(m.reply)) + '</div>' : '') + bubbleBody(m) +
        '<span class="muse-msg-meta">' + (m.edited ? 'edited · ' : '') + timeOf(m.created) + (m.mine && m.kind !== 'deleted' ? ' <span class="muse-tick' + (m.read ? ' read' : '') + '">' + (m.read ? ICON.checks : ICON.check1) + '</span>' : '') + '</span></div>' +
        (m.reacts && m.reacts.length ? '<div class="muse-reacts">' + m.reacts.map(function (r) { return '<button class="muse-react' + (r.mine ? ' mine' : '') + '" data-react="' + esc(r.e) + '">' + esc(r.e) + (r.n > 1 ? ' ' + r.n : '') + '</button>'; }).join('') + '</div>' : '') +
        '</div>';
    });
    log.innerHTML = html;
    if (stick || nearBottom) log.scrollTop = log.scrollHeight;
  }
  function findMsg(id) { id = +id; for (var i = 0; i < C.msgs.length; i++) if (C.msgs[i].id === id) return C.msgs[i]; return null; }
  function upsert(m) { if (!m) return; var have = findMsg(m.id); if (have) Object.assign(have, m); else { C.msgs.push(m); if (m.id > C.lastId) C.lastId = m.id; } renderLog(true); }
  function sendMsg(kind, body, payload) {
    if (!C.handle) return Promise.reject(new Error('No chat'));
    var data = { handle: C.handle, kind: kind, body: body || '', payload: payload || {} };
    if (C.replyTo) data.reply_to = C.replyTo;
    return post('/api/friends/chat', data).then(function (j) { setReply(null); upsert(j.message); return j.message; }, function (e) { toast(e.message || 'Could not send', 'error'); throw e; });
  }
  function setReply(m, edit) {
    C.replyTo = m && !edit ? m.id : null; C.editId = m && edit ? m.id : null;
    var box = $('chat-reply');
    if (!m) { box.classList.add('hidden'); return; }
    $('chat-reply-text').textContent = (edit ? 'Editing: ' : 'Reply: ') + snippet(m);
    box.classList.remove('hidden');
    if (edit) { $('chat-input').value = m.body || ''; syncCompose(); }
    $('chat-input').focus();
  }
  function syncCompose() {
    var inp = $('chat-input'), has = inp.value.trim().length > 0;
    $('btn-chat-send').classList.toggle('hidden', !has); $('btn-chat-mic').classList.toggle('hidden', has);
    inp.style.height = 'auto'; inp.style.height = Math.min(140, inp.scrollHeight) + 'px';
  }
  function submitText() {
    var inp = $('chat-input'), text = inp.value.trim(); if (!text || C.busy) return;
    C.busy = true;
    var p = C.editId ? post('/api/friends/chat/edit', { id: C.editId, body: text }).then(function (j) { setReply(null); upsert(j.message); }, function (e) { toast(e.message, 'error'); throw e; }) : sendMsg('text', text);
    p.then(function () { inp.value = ''; syncCompose(); }, function () {}).finally(function () { C.busy = false; });
  }

  /* uploads */
  function fileKind(f) {
    var t = (f.type || '').toLowerCase(), n = (f.name || '').toLowerCase();
    if (t === 'image/gif' || /\.gif$/.test(n)) return 'gif';
    if (t.indexOf('image/') === 0 || /\.(heic|heif|jpe?g|png|webp)$/.test(n)) return 'image';
    if (t.indexOf('video/') === 0 || /\.(mov|m4v|mp4|webm)$/.test(n)) return 'video';
    if (t.indexOf('audio/') === 0 || /\.(m4a|aac|caf|mp3|wav|ogg|opus)$/.test(n)) return 'audio';
    return '';
  }
  function prepImage(f, max) {
    // downscale big photos in the browser; formats the browser can't decode (HEIC on desktop) go up as-is
    return new Promise(function (res) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type || '') || f.size < 600000) return res(f);
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * sc); cv.height = Math.round(img.naturalHeight * sc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        cv.toBlob(function (b) { res(b || f); }, 'image/jpeg', 0.88);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(f); };
      img.src = url;
    });
  }
  function mediaDuration(blob) {
    return new Promise(function (res) {
      var v = document.createElement(/^audio/.test(blob.type) ? 'audio' : 'video'), u = URL.createObjectURL(blob), done = false;
      var fin = function (d) { if (done) return; done = true; URL.revokeObjectURL(u); res(isFinite(d) ? d : 0); };
      v.preload = 'metadata'; v.onloadedmetadata = function () { fin(v.duration); }; v.onerror = function () { fin(0); };
      setTimeout(function () { fin(0); }, 4000); v.src = u;
    });
  }
  function sendFile(blob, kind, dur) {
    if (!C.handle) return Promise.resolve();
    var label = { image: 'photo', video: 'video', audio: 'audio', voice: 'voice message', round: 'round video', gif: 'GIF' }[kind] || 'file';
    toast('Sending ' + label + '...');
    var p = kind === 'image' ? prepImage(blob, 2560) : Promise.resolve(blob);
    return p.then(function (b) {
      return (dur != null ? Promise.resolve(dur) : (/^(video|audio|voice|round)$/.test(kind) ? mediaDuration(b) : Promise.resolve(0))).then(function (d) {
        return upload('/api/friends/chat/file', b, { 'X-Muse-Kind': kind, 'X-Muse-Duration': String(Math.round((d || 0) * 10) / 10) });
      });
    }).then(function (j) { return sendMsg(j.kind || kind, '', { file: j.file }); }).catch(function (e) { toast(e.message || 'Upload failed', 'error'); });
  }

  /* voice + round recording */
  var REC = null;
  function pickMime(video) {
    var list = video ? ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'] : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
    if (typeof MediaRecorder === 'undefined') return '';
    for (var i = 0; i < list.length; i++) { try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) {} }
    return '';
  }
  function startRec(video) {
    if (REC) return;
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { toast('Recording is not supported in this browser', 'error'); return; }
    var cons = video ? { audio: true, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } } } : { audio: true };
    navigator.mediaDevices.getUserMedia(cons).then(function (stream) {
      var mime = pickMime(video), rec;
      try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); } catch (e) { rec = new MediaRecorder(stream); }
      REC = { rec: rec, stream: stream, chunks: [], video: video, t0: Date.now(), send: false, tick: null };
      rec.ondataavailable = function (e) { if (e.data && e.data.size) REC.chunks.push(e.data); };
      rec.onstop = function () {
        var r = REC; REC = null; clearInterval(r.tick);
        r.stream.getTracks().forEach(function (t) { t.stop(); });
        var pv = $('chat-rec-preview'); pv.srcObject = null; pv.classList.add('hidden');
        $('chat-rec').classList.add('hidden'); $('chat-compose').classList.remove('hidden');
        var dur = (Date.now() - r.t0) / 1000;
        if (!r.send || dur < 0.6) return;
        var blob = new Blob(r.chunks, { type: (rec.mimeType || mime || (video ? 'video/webm' : 'audio/webm')).split(';')[0] });
        sendFile(blob, video ? 'round' : 'voice', dur);
      };
      rec.start(250);
      $('chat-rec-label').textContent = video ? 'Recording round video' : 'Recording voice';
      var pv = $('chat-rec-preview');
      if (video) { pv.srcObject = stream; pv.classList.remove('hidden'); pv.play().catch(function () {}); }
      $('chat-compose').classList.add('hidden'); $('chat-rec').classList.remove('hidden');
      REC.tick = setInterval(function () {
        var s = (Date.now() - REC.t0) / 1000; $('chat-rec-time').textContent = fmt(s);
        if (s >= (video ? 60 : 300)) stopRec(true);
      }, 250);
    }, function () { toast(video ? 'Camera or microphone access was denied' : 'Microphone access was denied', 'error'); });
  }
  function stopRec(send) { if (!REC) return; REC.send = !!send; try { REC.rec.stop(); } catch (e) {} }

  /* inline players: one at a time, pause Muse playback while a clip speaks */
  var clip = null;
  function stopClip() { if (clip) { try { clip.el.pause(); } catch (e) {} clip.box.classList.remove('playing'); var b = clip.box.querySelector('.muse-voice-btn,.muse-round-play'); if (b) b.innerHTML = ICON.play; clip = null; } }
  function pauseMain() { var a = $('native-audio'); if (a && !a.paused) { var b = $('btn-play-pause'); if (b) b.click(); else a.pause(); } }
  function toggleVoice(box) {
    if (clip && clip.box === box) { stopClip(); return; }
    stopClip();
    var a = new Audio(box.dataset.voice); a.preload = 'auto';
    var btn = box.querySelector('.muse-voice-btn'), time = box.querySelector('.muse-voice-time'), bars = box.querySelectorAll('.muse-voice-bars i');
    clip = { el: a, box: box }; box.classList.add('playing'); btn.innerHTML = ICON.pause; pauseMain();
    a.ontimeupdate = function () { var f = a.duration ? a.currentTime / a.duration : 0; time.textContent = fmt(a.currentTime); bars.forEach(function (b, i) { b.classList.toggle('on', i / bars.length <= f); }); };
    a.onended = function () { bars.forEach(function (b) { b.classList.remove('on'); }); stopClip(); };
    a.play().catch(function () { toast('Could not play this clip', 'error'); stopClip(); });
  }
  function toggleRound(box) {
    var v = box.querySelector('video');
    if (clip && clip.box === box) { stopClip(); return; }
    stopClip(); clip = { el: v, box: box }; box.classList.add('playing'); box.querySelector('.muse-round-play').innerHTML = ''; pauseMain();
    v.muted = false; v.currentTime = 0;
    v.ontimeupdate = function () { box.querySelector('.muse-round-time').textContent = fmt(v.currentTime); };
    v.onended = function () { stopClip(); };
    v.play().catch(function () { stopClip(); });
  }
  function openMedia(kind, src) {
    var st = $('muse-media-stage');
    st.innerHTML = kind === 'video' ? '<video src="' + esc(src) + '" controls autoplay playsinline></video>' : '<img src="' + esc(src) + '" alt="">';
    if (kind === 'video') pauseMain();
    R.openModal($('muse-media-modal'));
  }

  /* floating message menu (Riff dropdown look) */
  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMsgMenu(m, x, y) {
    closeMenu(); if (!m || m.kind === 'deleted') return;
    var d = document.createElement('div');
    d.className = 'muse-msg-menu';
    var items = '<div class="muse-react-row">' + REACTS.map(function (e) { return '<button class="muse-react-pick" data-e="' + e + '">' + e + '</button>'; }).join('') + '</div>' +
      '<button class="m3-dropdown-option" data-m="reply">Reply</button>' +
      (m.body ? '<button class="m3-dropdown-option" data-m="copy">Copy text</button>' : '') +
      (m.mine && m.kind === 'text' ? '<button class="m3-dropdown-option" data-m="edit">Edit</button>' : '') +
      (m.mine ? '<button class="m3-dropdown-option muse-danger" data-m="delete">Delete</button>' : '');
    d.innerHTML = items; document.body.appendChild(d); menuEl = d;
    var w = d.offsetWidth, h = d.offsetHeight;
    d.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    d.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
    d.querySelectorAll('[data-e]').forEach(function (b) { onTap(b, function () { closeMenu(); react(m.id, b.dataset.e); }); });
    d.querySelectorAll('[data-m]').forEach(function (b) {
      onTap(b, function () {
        closeMenu();
        var a = b.dataset.m;
        if (a === 'reply') setReply(m);
        else if (a === 'edit') setReply(m, true);
        else if (a === 'copy') writeClip(m.body).then(function () { toast('Copied', 'success'); });
        else if (a === 'delete') confirmBox('Delete message', 'Delete this message for both of you?', 'Delete').then(function (ok) {
          if (ok) post('/api/friends/chat/delete', { id: m.id }).then(function (j) { upsert(j.message); }, function (e) { toast(e.message, 'error'); });
        });
      });
    });
  }
  function react(id, e) { post('/api/friends/chat/react', { id: id, emoji: e }).then(function (j) { upsert(j.message); }, function (ex) { toast(ex.message, 'error'); }); }

  /* pickers: track / gif (Riff dialog + track rows) */
  var pick = { mode: null, timer: null, ctl: null };
  function openPicker(mode) {
    pick.mode = mode;
    $('muse-pick-title').textContent = mode === 'gif' ? 'Send a GIF' : 'Send a track';
    var inp = $('muse-pick-input'); inp.value = ''; inp.placeholder = mode === 'gif' ? 'Search GIFs...' : 'Search tracks...';
    var list = $('muse-pick-list');
    list.className = mode === 'gif' ? 'muse-gif-grid' : 'tracks-list muse-pick-list';
    if (mode === 'song') {
      var recent = (R.state.history || []).slice(0, 12).map(function (h) { return h.track || h; }).filter(function (t) { return t && /^[\w-]{11}$/.test(t.id || ''); });
      renderPick(recent.length ? recent : (R.state.favorites || []).slice(0, 12));
    } else list.innerHTML = '<div class="empty-hint">Type to search.</div>';
    R.openModal($('muse-pick-modal'));
    setTimeout(function () { try { inp.focus(); } catch (e) {} }, 200);
  }
  function renderPick(items) {
    var list = $('muse-pick-list');
    if (!items || !items.length) { list.innerHTML = '<div class="empty-hint">Nothing found.</div>'; return; }
    if (pick.mode === 'gif') {
      list.innerHTML = items.map(function (g, i) { return '<button class="muse-gif" data-i="' + i + '"><img src="' + esc(g.preview || g.url) + '" alt="GIF" loading="lazy"></button>'; }).join('');
      list.querySelectorAll('.muse-gif').forEach(function (b) { onTap(b, function () { R.closeModal($('muse-pick-modal')); var g = items[+b.dataset.i]; sendMsg('gif', '', { url: g.url, preview: g.preview, w: g.w, h: g.h }); }); });
      return;
    }
    list.innerHTML = items.map(function (t, i) {
      return '<div class="track-row" data-i="' + i + '" tabindex="0"><span class="track-row-index">' + (i + 1) + '</span><img class="track-row-thumb" src="' + esc(t.thumbnail || '') + '" alt="" loading="lazy">' +
        '<div class="track-row-info"><span class="track-row-title">' + esc(t.title) + '</span><span class="track-row-artist">' + esc(t.artist || '') + '</span></div><span class="track-row-duration">' + (t.duration ? fmt(t.duration) : '') + '</span></div>';
    }).join('');
    list.querySelectorAll('.track-row').forEach(function (row) { onTap(row, function () { R.closeModal($('muse-pick-modal')); sendTrack(items[+row.dataset.i]); }); });
  }
  function sendTrack(t) {
    if (!t || !/^[\w-]{11}$/.test(t.id || '')) { toast('Only Muse tracks can be shared', 'error'); return; }
    var title = t.artist && t.artist !== 'Unknown artist' ? t.artist + ' - ' + t.title : t.title;
    sendMsg('song', '', { id: t.id, title: title, thumbnail: t.thumbnail, duration: t.duration });
  }
  function bindPicker() {
    onTap($('btn-muse-pick-cancel'), function () { R.closeModal($('muse-pick-modal')); });
    $('muse-pick-input').addEventListener('input', function (e) {
      var q = e.target.value.trim(); clearTimeout(pick.timer); if (pick.ctl) pick.ctl.abort();
      if (q.length < 2) return;
      pick.timer = setTimeout(function () {
        pick.ctl = new AbortController();
        var url = pick.mode === 'gif' ? '/api/gifs?q=' + encodeURIComponent(q) : '/api/search?q=' + encodeURIComponent(q) + '&n=12';
        fetchRaw(url, { credentials: 'same-origin', signal: pick.ctl.signal }).then(function (r) { return r.json(); }).then(function (j) {
          renderPick(pick.mode === 'gif' ? (j.gifs || []) : (j.results || []).map(B.toRiff).filter(Boolean));
        }, function () {});
      }, 300);
    });
  }

  function bindChat() {
    var inp = $('chat-input'), log = $('chat-log'), attach = $('chat-attach');
    inp.addEventListener('input', function () {
      syncCompose();
      if (C.handle && Date.now() - C.typingAt > 3000) { C.typingAt = Date.now(); post('/api/friends/typing', { handle: C.handle }).catch(function () {}); }
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !(B && (B.iphone || B.androidApp))) { e.preventDefault(); submitText(); }
      else if (e.key === 'Escape') { setReply(null); }
    });
    onTap($('btn-chat-send'), submitText);
    onTap($('btn-chat-mic'), function () { startRec(false); });
    onTap($('btn-rec-cancel'), function () { stopRec(false); });
    onTap($('btn-rec-send'), function () { stopRec(true); });
    onTap($('btn-chat-reply-cancel'), function () { if (C.editId) { inp.value = ''; syncCompose(); } setReply(null); });
    onTap($('btn-chat-back'), function () { go('friends'); });
    onTap($('btn-chat-peer'), function () { if (C.handle) openUser(C.handle); });
    onTap($('btn-chat-remove'), function () {
      var h = C.handle; if (!h) return;
      confirmBox('Remove friend', 'Remove @' + h + ' from your friends? The chat closes for both of you.', 'Remove').then(function (ok) {
        if (ok) post('/api/friends/remove', { handle: h }).then(function () { toast('Removed @' + h); loadFriends(); go('friends'); }, function (e) { toast(e.message, 'error'); });
      });
    });
    onTap($('btn-chat-attach'), function (e) { e.stopPropagation(); attach.classList.toggle('open'); });
    document.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('#chat-attach')) attach.classList.remove('open');
      if (menuEl && !e.target.closest('.muse-msg-menu')) closeMenu();
    }, true);
    attach.querySelectorAll('[data-attach]').forEach(function (b) {
      onTap(b, function () {
        attach.classList.remove('open');
        var a = b.dataset.attach;
        if (a === 'file') $('chat-file').click();
        else if (a === 'song') openPicker('song');
        else if (a === 'gif') openPicker('gif');
        else if (a === 'round') startRec(true);
        else if (a === 'now') { var t = R.state.currentTrack; if (t) sendTrack(t); else toast('Nothing is playing'); }
      });
    });
    $('chat-file').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
      files.slice(0, 10).reduce(function (p, f) {
        return p.then(function () { var k = fileKind(f); if (!k) { toast('Unsupported file: ' + f.name, 'error'); return; } return sendFile(f, k); });
      }, Promise.resolve());
    });
    // drag & drop / paste images
    log.addEventListener('dragover', function (e) { e.preventDefault(); });
    log.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f && fileKind(f)) sendFile(f, fileKind(f)); });
    inp.addEventListener('paste', function (e) {
      var it = e.clipboardData && Array.prototype.find.call(e.clipboardData.items || [], function (i) { return i.kind === 'file'; });
      var f = it && it.getAsFile(); if (f && fileKind(f)) { e.preventDefault(); sendFile(f, fileKind(f)); }
    });
    // message interactions (delegated)
    var press = null;
    log.addEventListener('pointerdown', function (e) {
      var msg = e.target.closest('.muse-msg'); if (!msg || e.button > 0) return;
      clearTimeout(press && press.t);
      press = { x: e.clientX, y: e.clientY, fired: false, t: setTimeout(function () { press.fired = true; openMsgMenu(findMsg(msg.dataset.id), press.x, press.y); }, 480) };
    });
    var cancelPress = function (e) { if (press && (!e || Math.abs(e.clientX - press.x) > 10 || Math.abs(e.clientY - press.y) > 10 || e.type !== 'pointermove')) clearTimeout(press.t); };
    log.addEventListener('pointermove', cancelPress); log.addEventListener('pointercancel', cancelPress); log.addEventListener('scroll', function () { cancelPress(); }, { passive: true });
    log.addEventListener('pointerup', function () { if (press) clearTimeout(press.t); });
    log.addEventListener('contextmenu', function (e) { var msg = e.target.closest('.muse-msg'); if (!msg) return; e.preventDefault(); openMsgMenu(findMsg(msg.dataset.id), e.clientX, e.clientY); });
    log.addEventListener('click', function (e) {
      if (press && press.fired) { press = null; return; }
      var t = e.target, el;
      if ((el = t.closest('[data-react]'))) { react(+el.closest('.muse-msg').dataset.id, el.dataset.react); return; }
      if ((el = t.closest('.muse-voice'))) { toggleVoice(el); return; }
      if ((el = t.closest('[data-round]'))) { toggleRound(el); return; }
      if ((el = t.closest('[data-song]'))) {
        var p = findMsg(el.closest('.muse-msg').dataset.id).payload || {};
        var tr = B.toRiff({ id: p.id, title: p.title, duration: p.duration }); if (tr) R.playTrack(tr, [tr], 0, 'chat');
        return;
      }
      if ((el = t.closest('[data-user]'))) { openUser(el.dataset.user); return; }
      if ((el = t.closest('[data-media]'))) { openMedia(el.dataset.media, el.currentSrc || el.src); return; }
      if ((el = t.closest('[data-jump]'))) { var target = log.querySelector('.muse-msg[data-id="' + el.dataset.jump + '"]'); if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('muse-flash'); setTimeout(function () { target.classList.remove('muse-flash'); }, 1200); } }
    });
    onTap($('btn-muse-media-close'), function () { var st = $('muse-media-stage'); R.closeModal($('muse-media-modal')); setTimeout(function () { st.innerHTML = ''; }, 300); });
    $('muse-media-modal').addEventListener('click', function (e) { if (e.target === e.currentTarget) $('btn-muse-media-close').click(); });
  }

  /* ---------------- notifications, badge, OS notifications, web push ---------------- */
  var N = { after: 0, timer: null, first: true };
  function setBadge(n) {
    S.unseen = n;
    var b = $('friends-count'); if (!b) return;
    b.textContent = n > 99 ? '99+' : String(n || 0);
    b.classList.toggle('muse-zero', !n);
  }
  function pollNotifs() {
    if (!S.me) return Promise.resolve();
    return api('/api/notifs?after=' + N.after).then(function (j) {
      var list = j.notifs || [];
      list.forEach(function (n) {
        if (n.id > N.after) N.after = n.id;
        if (N.first || n.seen) return;
        var h = n.payload && n.payload.handle;
        var inThisChat = n.kind === 'chat' && h && h === C.handle && R.state.currentView === 'chat';
        if (inThisChat) { post('/api/notifs/seen', { handle: h }).catch(function () {}); return; }
        if (n.kind === 'request' || n.kind === 'accept') loadFriends();
        if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted' && !pushOn) {
          try { var on = new Notification(n.title || 'Muse', { body: n.body || '', icon: '/icons/icon-192.png', tag: 'muse-' + n.id }); on.onclick = function () { window.focus(); if (h) openChat(h); on.close(); }; } catch (e) {}
        } else if (!document.hidden) {
          toast((n.title ? n.title + ': ' : '') + (n.body || ''), 'info');
        }
      });
      N.first = false;
      setBadge(j.unseen || 0);
      if (j.presence && S.friends) {
        var byH = j.presence || {};
        var dirty = false;
        S.friends.friends.forEach(function (f) { var p = byH[f.handle]; if (p) { if (p.online !== f.online || p.listening !== f.listening) dirty = true; Object.assign(f, p); } });
        if (dirty && R.state.currentView === 'friends') renderFriends();
      }
    }, function (e) { if (e.status === 401) setMe(null); });
  }
  function startNotifs() {
    stopNotifs(); N.first = true; N.after = 0;
    var tick = function () { pollNotifs().finally(function () { N.timer = setTimeout(tick, document.hidden ? 15000 : 4000); }); };
    tick(); loadFriends();
  }
  function stopNotifs() { clearTimeout(N.timer); N.timer = null; setBadge(0); }
  var pushOn = false;
  function b64u(s) { var p = '='.repeat((4 - s.length % 4) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); var a = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; }
  function ensurePush() {
    if (!S.me || desktopShell || !('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return Promise.resolve();
    return navigator.serviceWorker.ready.then(function (reg) {
      return api('/api/push/key').then(function (k) {
        if (!k.key) return;
        return reg.pushManager.getSubscription().then(function (sub) {
          return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(k.key) });
        }).then(function (sub) { var j = sub.toJSON(); return post('/api/push/sub', { endpoint: j.endpoint, keys: j.keys }).then(function () { pushOn = true; }); });
      });
    }).catch(function () {});
  }
  function dropPush() {
    if (!('serviceWorker' in navigator)) return Promise.resolve();
    return navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg || !reg.pushManager) return;
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return;
        var ep = sub.endpoint; pushOn = false;
        return post('/api/push/unsub', { endpoint: ep }).catch(function () {}).then(function () { return sub.unsubscribe(); });
      });
    }).catch(function () {});
  }
  function askNotif() {
    if (typeof Notification === 'undefined') { toast(B && B.iphone ? 'Add Muse to the Home Screen to get notifications' : 'Notifications are not supported here', 'info'); return; }
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') { toast('Notifications on', 'success'); ensurePush(); } else toast('Notifications are blocked in the browser settings', 'info');
      if (R.state.currentView === 'account') renderAccount();
    });
  }

  /* ---------------- favorites <-> Muse likes ---------------- */
  var liked = null, syncing = false;
  function favIds(arr) { var s = {}; (arr || []).forEach(function (t) { if (t && /^[\w-]{11}$/.test(t.id || '')) s[t.id] = t; }); return s; }
  function syncLikesFromServer() {
    api('/api/likes').then(function (j) {
      var server = (j.tracks || []).map(B.toRiff).filter(Boolean);
      liked = {}; server.forEach(function (t) { liked[t.id] = 1; });
      var have = favIds(R.state.favorites), added = 0;
      server.slice().reverse().forEach(function (t) { if (!have[t.id]) { R.state.favorites.unshift(t); added++; } });
      // local favorites the account doesn't have yet go up once
      Object.keys(have).forEach(function (id) { if (!liked[id]) pushLike(have[id]); });
      if (added) {
        syncing = true; try { localStorage.setItem('devsize_favorites', JSON.stringify(R.state.favorites)); } finally { syncing = false; }
        if (R.updateFavoritesBadge) R.updateFavoritesBadge();
        if (R.state.currentView === 'favorites' && R.renderFavoritesView) R.renderFavoritesView();
      }
    }, function () {});
  }
  function pushLike(t) {
    if (!liked || liked[t.id]) return;
    liked[t.id] = 1;
    var title = t.artist && t.artist !== 'Unknown artist' ? t.artist + ' - ' + t.title : t.title;
    post('/api/like', { video_id: t.id, title: title, thumbnail: t.thumbnail, duration: t.duration }).then(function (j) {
      if (j.liked === false) post('/api/like', { video_id: t.id, title: title, thumbnail: t.thumbnail, duration: t.duration }).catch(function () {});
    }, function () { delete liked[t.id]; });
  }
  function dropLike(id) {
    if (!liked || !liked[id]) return;
    delete liked[id];
    post('/api/like', { video_id: id }).then(function (j) { if (j.liked === true) post('/api/like', { video_id: id }).catch(function () {}); }, function () { liked[id] = 1; });
  }
  (function hookFavorites() {
    var proto = Storage.prototype, orig = proto.setItem;
    proto.setItem = function (k, v) {
      var before = null;
      if (this === window.localStorage && k === 'devsize_favorites' && !syncing && S.me && liked) {
        try { before = favIds(JSON.parse(this.getItem(k) || '[]')); } catch (e) { before = {}; }
      }
      var r = orig.apply(this, arguments);
      if (before) {
        try {
          var after = favIds(JSON.parse(v || '[]'));
          Object.keys(after).forEach(function (id) { if (!before[id]) pushLike(after[id]); });
          Object.keys(before).forEach(function (id) { if (!after[id]) dropLike(id); });
        } catch (e) {}
      }
      return r;
    };
  })();

  /* ---------------- new build notice (Riff's update modal) ---------------- */
  function checkBuild() {
    api('/api/version').then(function (j) {
      var cur = +window.__museBuild || 0, b = +j.build || 0;
      if (!cur || b <= cur || +localStorage.getItem('muse_skip_build') === b) return;
      $('update-title').textContent = 'Muse build ' + b + ' is available';
      $('update-text').textContent = 'A new version of Muse is ready. Reload to use it.';
      $('update-progress').classList.add('hidden');
      $('btn-update-now').textContent = 'Reload now'; $('btn-update-now').classList.remove('hidden');
      $('btn-update-later').textContent = 'Later'; $('btn-update-later').classList.remove('hidden');
      $('btn-update-ignore').dataset.build = b;
      R.openModal($('update-modal'));
    }, function () {});
  }
  function bindUpdate() {
    var m = $('update-modal'); if (!m || window.electronAPI) return;
    onTap($('btn-update-now'), function () {
      var go2 = function () { location.reload(); };
      if (window.caches) caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }).then(go2, go2); else go2();
    });
    onTap($('btn-update-later'), function () { R.closeModal(m); });
    onTap($('btn-update-ignore'), function () { localStorage.setItem('muse_skip_build', $('btn-update-ignore').dataset.build || ''); R.closeModal(m); });
    onTap($('btn-close-update'), function () { R.closeModal(m); });
  }

  /* ---------------- client error log (no PII: message + file:line only) ---------------- */
  var logQ = [], logT = null;
  function clog(line) {
    if (logQ.length > 30) return;
    logQ.push(String(line).slice(0, 200));
    clearTimeout(logT);
    logT = setTimeout(function () { var lines = logQ.splice(0); fetchRaw('/api/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: lines }), keepalive: true }).catch(function () {}); }, 1500);
  }
  window.addEventListener('error', function (e) { clog('err b' + window.__museBuild + ' ' + (e.message || '') + ' @' + String(e.filename || '').split('/').pop() + ':' + (e.lineno || 0)); });
  window.addEventListener('unhandledrejection', function (e) { var r = e.reason; if (r && r.name === 'AbortError') return; clog('rej b' + window.__museBuild + ' ' + (r && r.message || r)); });

  /* ---------------- deep links ---------------- */
  function deepLink() {
    var p = location.pathname, qs = new URLSearchParams(location.search), m;
    if ((m = p.match(/^\/@([\w.-]{2,32})\/?$/)) || (m = p.match(/^\/u\/([\w.-]{2,32})\/?$/))) { openUser(m[1]); return; }
    if ((m = p.match(/^\/friends\/([\w.-]{2,24})\/?$/))) { openChat(m[1]); return; }
    if (/^\/friends\/?$/.test(p)) { go('friends'); return; }
    var chat = qs.get('chat'); if (chat) { openChat(chat); return; }
    var v = qs.get('v') || ((m = p.match(/^\/(?:watch|track|t)\/([\w-]{11})$/)) && m[1]);
    if (v && /^[\w-]{11}$/.test(v)) {
      api('/api/search?q=' + encodeURIComponent(v) + '&n=4').then(function (j) {
        var hit = (j.results || []).filter(function (r) { return r.id === v; })[0] || { id: v, title: 'Shared track' };
        var t = B.toRiff(hit); if (t) R.playTrack(t, [t], 0, 'link');
      }, function () {});
    }
    var view = qs.get('view'); if (view && $('view-' + view)) go(view);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    R = window.museRiff;
    bindAuth(); bindProfileEdit(); bindFriendsSearch(); bindPicker(); bindChat(); bindUpdate();
    // phones: Riff's now-playing panel is a sheet there; start closed, close it when a tab is picked
    var phone = function () { return window.innerWidth <= 600 && !window.electronAPI; };
    if (phone() && R.state.isRightPanelOpen) { R.state.isRightPanelOpen = false; var rp = document.querySelector('.right-panel'); if (rp) rp.classList.add('hidden'); var lb = $('btn-toggle-lyrics-panel'); if (lb) lb.classList.remove('active'); }
    document.querySelectorAll('.sidebar .nav-item').forEach(function (n) {
      n.addEventListener('click', function () { if (phone() && R.state.isRightPanelOpen) { var x = $('btn-close-right-panel'); if (x) x.click(); } });
    });
    onTap($('nav-friends'), function () { go('friends'); });
    onTap($('nav-account'), function () { go('account'); });
    document.addEventListener('muse:view', function (e) {
      var v = e.detail;
      if (v !== 'chat') { stopChatPoll(); stopClip(); if (REC) stopRec(false); }
      if (v === 'chat' || v === 'user') { var n = $('nav-friends'); if (n) n.classList.add('active'); }
      if (v === 'friends') { renderFriends(); loadFriends(); }
      if (v === 'account') renderAccount();
      if (v === 'chat' && C.handle && !C.timer) schedulePoll();
      watchSW();
    });
    document.addEventListener('visibilitychange', function () { watchSW(); if (!document.hidden && S.me) { pollNotifs(); if (R.state.currentView === 'chat') pollChat(false); } });
    refreshMe().then(function () { deepLink(); });
    setTimeout(checkBuild, 15000); setInterval(checkBuild, 15 * 60 * 1000);
    if ('serviceWorker' in navigator && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (e) { var d = e.data || {}; if (d.type === 'muse-notif-click') { if (d.handle) openChat(d.handle); else go('friends'); } });
    }
  }
  window.museSocial = { openAuth: openAuth, openChat: openChat, openUser: openUser, refreshMe: refreshMe, session: S };
  if (window.museRiff) boot(); else document.addEventListener('muse:riff-ready', boot, { once: true });
})();
