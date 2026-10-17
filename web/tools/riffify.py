#!/usr/bin/env python3
"""Build web/index.html from Riff's index.html (MIT, (c) 2026 rootscripts, commit 935ae2d).

Riff's markup is kept as is; this only applies Muse branding, self-hosted assets and
inserts Muse's account / friends / chat views and dialogs (styled with Riff's classes).
Usage: python3 web/tools/riffify.py /path/to/riff/index.html > web/index.html
"""
import sys, re

src = open(sys.argv[1], encoding='utf-8').read()
s = src

def rep(old, new, count=1):
    global s
    if old not in s:
        raise SystemExit('missing: ' + old[:90])
    s = s.replace(old, new, count)

HEAD = r'''<!DOCTYPE html>
<!-- UI from Riff (https://github.com/rootscripts/riff, commit 935ae2d) — MIT License, Copyright (c) 2026 rootscripts. See /riff/LICENSE and THIRD_PARTY_NOTICES.md. -->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script>
  (function () {
    var p = location.pathname || '/';
    var lane = null;
    if (/^\/pc(\/|$)/.test(p)) lane = 'pc';
    else if (/^\/web(\/|$)/.test(p)) lane = 'web';
    else if (/^\/mobile\/iphone(\/|$)/.test(p)) lane = 'iphone';
    else if (/^\/mobile\/android(\/|$)/.test(p)) lane = 'android';
    try {
      if (window.chrome && window.chrome.webview) { document.documentElement.classList.add('muse-app'); window.__museDesktop = 1; if (!lane) lane = 'pc'; }
      if (/MuseAndroid/i.test(navigator.userAgent || '')) { document.documentElement.classList.add('muse-android'); window.__museAndroid = 1; if (!lane) lane = 'android'; }
    } catch (e) {}
    if (lane) { window.__museLane = lane; document.documentElement.setAttribute('data-lane', lane); try { sessionStorage.setItem('muse:lane', lane); } catch (e) {} }
    window.__museBuild = __MUSE_BUILD__;
  })();
  </script>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content">
  <meta name="theme-color" content="#121214">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Muse">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png?v=3">
  <link rel="icon" type="image/png" href="/favicon.png?v=172" sizes="32x32">
  <link rel="icon" href="/favicon.ico?v=172" sizes="any">
  <link rel="preconnect" href="https://i.ytimg.com" crossorigin>
  <title>Muse</title>
  <link rel="stylesheet" href="/muse/fonts.css?v=__MUSE_BUILD__">
  <link rel="stylesheet" href="/riff/styles.css?v=__MUSE_BUILD__">
  <link rel="stylesheet" href="/muse/muse.css?v=__MUSE_BUILD__">
  <script src="/muse/bridge.js?v=__MUSE_BUILD__"></script>
</head>'''
s = HEAD + s[s.index('</head>') + len('</head>'):]

# --- branding: name + Muse's logo where Riff shows its own ---
rep('<span class="logo-dot" id="titlebar-logo-dot"></span>\n        <span class="logo-text">Riff</span>',
    '<img class="muse-logo-mark" id="titlebar-logo-dot" src="/icons/icon-192.png" alt="" width="18" height="18">\n        <span class="logo-text">Muse</span>')
rep('<img src="assets/icon.png" alt="Riff"', '<img src="/icons/icon-192.png" alt="Muse"')
rep('<span class="setting-name">Riff</span>', '<span class="setting-name">Muse</span>')
rep('<span id="about-version" style="font-size: calc(12px * var(--font-scale, 1)); color: var(--md-sys-color-outline);">Version 42.2.0</span>',
    '<span id="about-version" style="font-size: calc(12px * var(--font-scale, 1)); color: var(--md-sys-color-outline);">Build __MUSE_BUILD__</span>')
rep('Riff made by rootless, support me: <a href="https://t.me/riffplayer" target="_blank" rel="noopener">t.me/riffplayer</a>',
    'Muse. Design &amp; audio engine from <a href="https://github.com/rootscripts/riff" target="_blank" rel="noopener">Riff</a> by rootless (MIT)')
rep('<span class="settings-version-tag">v42.2.0</span>', '<span class="settings-version-tag">build __MUSE_BUILD__</span>')
s = s.replace("because Riff will get laggy", "because Muse will get laggy")
s = s.replace('Riff needs yt-dlp and ffmpeg', 'Muse needs yt-dlp and ffmpeg')
s = s.replace("and Riff is open-source", "and Muse's player is open-source")
s = s.replace('Add a .css file to restyle Riff.', 'Add a .css file to restyle Muse.')
s = s.replace('Tip: Riff sets its color', 'Tip: Muse sets its color')
s = s.replace('start a second Riff window', 'start a second Muse window')
assert 'Riff' not in re.sub(r'<!--.*?-->', '', s.split('</head>', 1)[1].replace('>Riff</a>', ''), flags=re.S), [m.start() for m in re.finditer('Riff', s)]

# --- rail: labels for the phone tab bar; Muse items (Chats, Account) ---
LABELS = {'discover': 'Home', 'favorites': 'Favorites', 'local': 'My files', 'history': 'History', 'queue': 'Queue', 'settings': 'Settings'}
for view, label in LABELS.items():
    pat = re.compile(r'(<button class="nav-item[^"]*" data-view="%s"[^>]*>\s*<div class="nav-indicator">.*?</div>)' % view, re.S)
    s, n = pat.subn(lambda m: m.group(1) + '\n          <span class="nav-label">%s</span>' % label, s, count=1)
    assert n == 1, view

CHAT_ITEM = '''
        <button class="nav-item" data-view="friends" id="nav-friends" title="Chats">
          <div class="nav-indicator">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            <span class="nav-badge muse-zero" id="friends-count">0</span>
          </div>
          <span class="nav-label">Chats</span>
        </button>
'''
rep('''        <div class="rail-divider"></div>

        <button class="nav-item" data-view="settings"''', CHAT_ITEM + '''
        <div class="rail-divider"></div>

        <button class="nav-item" data-view="settings"''')
ACCOUNT_ITEM = '''
        <button class="nav-item" data-view="account" id="nav-account" title="Account">
          <div class="nav-indicator">
            <span class="muse-rail-avatar" id="muse-rail-avatar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg></span>
          </div>
          <span class="nav-label">Account</span>
        </button>
'''
# after the settings nav item (end of .sidebar-nav)
i = s.index('data-view="settings" id="nav-settings"')
j = s.index('</nav>', i)
s = s[:j] + ACCOUNT_ITEM.lstrip('\n') + '      ' + s[j:]

# --- Muse views inside <main> (after riff's settings view) ---
VIEWS = open(__file__.replace('riffify.py', 'muse-views.html'), encoding='utf-8').read()
k = s.index('<aside class="right-panel')
mclose = s.rindex('</main>', 0, k)
s = s[:mclose] + VIEWS + '    ' + s[mclose:]

# --- dialogs + scripts ---
DIALOGS = open(__file__.replace('riffify.py', 'muse-dialogs.html'), encoding='utf-8').read()
rep('''  <script src="assets/hls.min.js"></script>
  <script src="audio-engine.js"></script>
  <script src="app.js"></script>''', DIALOGS + '''
  <script src="/riff/hls.min.js?v=__MUSE_BUILD__"></script>
  <script src="/riff/audio-engine.js?v=__MUSE_BUILD__"></script>
  <script src="/riff/app.js?v=__MUSE_BUILD__"></script>
  <script src="/muse/social.js?v=__MUSE_BUILD__"></script>
  <script>if ('serviceWorker' in navigator) addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });</script>''')
s = s.replace('src="assets/', 'src="/riff/assets/')
sys.stdout.write(s)
