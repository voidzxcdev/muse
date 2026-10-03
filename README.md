# Muse — minimal music search & play

Search any song, see its **title + thumbnail**, stream the **best audio quality**
available. Matte black, no clutter, no accounts needed to listen — but with
one you get **playlists, likes, a learning For You page, and full profile
themes**.

## Run

Double-click **`start.bat`**, or:

```
python server.py
```

Opens `http://127.0.0.1:8090` automatically. Needs Python + `yt_dlp` module.
Data lives in `muse.db` (SQLite, same folder).

## How it works

- **Search** → YouTube **Music** search (songs only — no vlogs, trailers,
  news, or podcasts: non-`Music` categories are dropped), enriched with
  duration and maxres thumbnails. Typing searches live (debounced,
  stale-safe).
- **Play** → highest-bitrate **audio-only** stream, served through a
  same-origin `/api/audio` passthrough (Range-aware), so the Web Audio
  analyser reads **real FFT data** for the visualizer. Direct stream URL is
  the automatic fallback.
- Every network hop has a hard deadline (search 25s per index, enrich 14s,
  UI aborts at 60s) — a throttled YouTube shows a toast, never an
  eternal skeleton.
- Shortcuts: `/` focuses search, `Space` play/pause, `←/→` seek 10s.
- OS media keys work via MediaSession.

## Accounts & library (optional, local)

- **Sign up / sign in** from the bottom-left chip (scrypt-hashed passwords,
  cookie sessions, nothing leaves your machine).
- **Playlists** — create, rename, reorder (↑↓), delete, play-all; add any song
  via its ⋮ menu. Covers come from the first track.
- **Liked Songs** — heart anything (cards, rows, player); hearts sync
  everywhere and feed recommendations.
- **Profile themes** — display name, accent color (re-skins the whole UI),
  avatar energy slider.
- **Song menu (⋮)** — Like, Play next, Copy link, Add to playlist.

## For You — the recommendation engine

- New accounts get a **taste survey** (genres, moments, artists) → instant mix.
- Every listen trains it: **likes ×3, finishes ×2, plays ×1, fast skips −1**,
  per artist and per title-token, plus survey seeds.
- Candidates come from your top artists, your word streaks, and your survey;
  already-heard songs are excluded, each pick carries its **reason**
  (“More DJ Javi26”, “For your bluff streak”, “Pairs with a liked song”).
- **Orbit signal (the real stuff).** Beyond names, Muse pulls each seed song's
  auto-generated YouTube mix — YouTube's own co-watch + audio-similarity
  graph — and boosts whatever orbits your songs (“In the orbit of …”).
- **Anti-bubble slots.** A couple of picks always come from survey genres that
  nothing matched, so the mix keeps surprising you.
- **For You lives on home** too — a 6-song “Today's mix” drawn from a daily
  rotating window, so it changes every day and grows as your taste does.

## Files

- `server.py` — stdlib HTTP server + yt-dlp (threaded, JSON API)
- `static/` — vanilla UI (no frameworks): `index.html`, `style.css`, `app.js`
- `start.bat` — one-click launch

## API

- `GET /api/search?q=...&n=12` → `{results:[{id,title,duration,thumbnail}], music_only:true}`
- `GET /api/play?v=VIDEO_ID` → `{title,duration,thumbnail,audio_url,ext,abr,categories}`
- `GET /api/audio?v=VIDEO_ID` → audio bytes (Range-aware passthrough, same-origin)
- `POST /api/signup|login|logout`, `GET /api/me`, `PATCH /api/me`
- Playlists: `GET/POST /api/playlists`, `PATCH/DELETE /api/playlists/:id`,
  `GET/POST /api/playlists/:id/tracks`, `PATCH .../order`, `DELETE /api/playlist-items/:id`
- `POST /api/like`, `GET /api/likes`, `GET /api/liked_ids?ids=…`
- `POST /api/event` (play/complete/skip telemetry), `POST/GET /api/survey`,
  `GET /api/recommendations?n=12`

## Notes

- Icons: Feather (MIT) + Font Awesome Free 6 play/pause (CC BY 4.0).

- Stream URLs are signed and expire after a few hours — replay re-resolves.
- If a video is age-restricted or region-blocked, you'll get a clear toast
  instead of a hang.
