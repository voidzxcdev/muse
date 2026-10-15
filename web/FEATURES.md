# Muse React UI — feature inventory & parity checklist

Legacy source: `static/app.js` (+ `static/index.html`). New UI: `web/` (React 19 + Vite 6 + TS + Tailwind v4 + shadcn/Radix + motion).
Enable: build `web/` then run `server.py` with `MUSE_UI=react` (legacy UI stays default otherwise).

Legend: ✅ done · 🟡 partial / changed · ❌ not ported

## Shell / platform
| Feature | Status | Notes |
|---|---|---|
| Lanes /pc /web /mobile/iphone /mobile/android, `/` rewrite | ✅ | inline script in `web/index.html` |
| Dark/light theme (Vercel / Geist) | ✅ | `muse:theme`, account menu switch |
| PWA: `sw.js` registration, update toast via `/api/version` vs build | 🟡 | toast with "Reload" instead of forced hard refresh |
| WebView2 bridge (`muse-chrome` mini mode, `.muse-mini`) | ✅ | |
| Linux preload DOM IDs (player, bPlay, bPrev, bNext, ptitle, art, pos, dur, vol, pline) + `__musePushMpris` | ✅ | kept on PlayerBar |
| Android `MuseAndroid.playback` | ✅ | |
| YouTube embed player (`MusePlayer`, cookies=all on pc) | ✅ | loads `/ytplayer.js` |
| Cookie bar (`muse:cookies`) | ✅ | |
| Desktop / APK install prompts | ✅ | |
| Intro splash animation | ❌ | dropped |
| iOS audio hacks (rebind, silence keep-alive, lock-screen recovery) | ❌ | needs device testing |
| Client log `/api/clientlog` | ✅ | |

## Auth / account
| Feature | Status |
|---|---|
| Sign up / sign in with ToS consent, logout | ✅ |
| Onboarding | ✅ |
| Settings: display name, handle, avatar upload, privacy toggles, cookies, notifications, data export, delete account, legal | ✅ |
| Push subscribe/unsubscribe, notification polling (4s), inbox | ✅ |
| Presence beat (12s), now-playing | ✅ |

## Playback
| Feature | Status |
|---|---|
| Queue, next/prev, auto-extend, shuffle, repeat (persisted) | ✅ |
| Seek, volume (`muse:vol`), keyboard shortcuts, MediaSession | ✅ |
| Now Playing fullscreen, synced lyrics `/api/lyrics`, queue tab, drag-to-close | ✅ |
| FX modes + bass (WebAudio) | 🟡 | visible (legacy had them disabled) |
| Sleep timer | ✅ |
| Telemetry `/api/event` play/skip/complete, heard history | ✅ |

## Content
| Feature | Status |
|---|---|
| Home: greeting, quick links, popular (`muse:popular` cache), For You, app downloads | ✅ |
| Search songs + people, `/` and Ctrl+K, enrich cards | ✅ |
| Liked songs + reorder `/api/likes/order` | ✅ |
| Playlists: create, rename, cover crop upload, share, publish/unpublish, delete, remove item, reorder, mix all | ✅ |
| Shared playlist take | ✅ |
| Marketplace | ✅ |
| User profiles (stats, badges, privacy-aware) | ✅ |
| Friends: list, requests, search, remove | ✅ |
| Chat: text, reply, edit, delete, reactions, typing, read ticks, history paging, file/image/video/audio upload, voice + round video recording, song/playlist/GIF pickers, share now-playing | ✅ |
| Media viewer | ✅ |
| `/api/survey`, musely endpoints | ❌ | not used by legacy app.js either |

## Known gaps
- Single 716 KB JS bundle (219 KB gzip), no code splitting yet.
- iOS-specific audio robustness not ported; needs real-device QA.
- Smoke run reports a few console 404s (likely missing lyrics/thumbnail lookups) — not investigated.
