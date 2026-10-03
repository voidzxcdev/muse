#!/usr/bin/env python3
"""Muse — lightweight music search & play — yt-dlp music-only search + best-audio streaming.

Stdlib only (+ yt_dlp module). Run:  python server.py   →  http://127.0.0.1:8077
"""
import contextlib
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError

import yt_dlp

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
PORT = int(os.environ.get("PORT") or 8090)
HOST = "0.0.0.0"  # localhost-only would be "127.0.0.1"; 0.0.0.0 = this LAN (phone, tablet, …)
ON_RENDER = bool(os.environ.get("RENDER"))
PUBLIC_URL = (os.environ.get("RENDER_EXTERNAL_URL") or "").rstrip("/")
DATABASE_URL = os.environ.get("DATABASE_URL") or ""  # set → Postgres (Supabase); unset → local SQLite
BUILD = 130  # bump every release — the UI polls this and prompts reload

SEARCH_TTL = 600      # seconds to cache a search
URL_TTL = 6 * 3600    # googlevideo URLs live ~6h

_search_cache = {}    # "query|n" -> (ts, results)
_url_cache = {}       # video_id -> (ts, payload)

MUSIC_DIR = os.path.join(HERE, "music")
_mp3_lock = threading.Lock()

DB_PATH = os.path.join(HERE, "muse.db")
SESSION_TTL = 30 * 86400
# Postgres does its own locking; SQLite needs writes serialized.
_db_lock = contextlib.nullcontext() if DATABASE_URL else threading.Lock()
_pg_pool = None
_PG_ID_TABLES = ("users", "playlists", "playlist_items", "plays")


class _PgRow(dict):
    """sqlite3.Row lookalike: r["col"] and r[0] both work."""

    def __init__(self, cols, vals):
        vals = [bytes(v) if isinstance(v, memoryview) else v for v in vals]
        super().__init__(zip(cols, vals))
        self._vals = vals

    def __getitem__(self, k):
        return self._vals[k] if isinstance(k, int) else super().__getitem__(k)


class _PgCursor:
    def __init__(self, cur, lastrowid=None):
        self._cur = cur
        self.rowcount = cur.rowcount
        self.lastrowid = lastrowid
        self._cols = [d.name for d in cur.description] if cur.description else []

    def fetchone(self):
        r = self._cur.fetchone() if self._cols else None
        return _PgRow(self._cols, r) if r is not None else None

    def fetchall(self):
        return [_PgRow(self._cols, r) for r in self._cur.fetchall()] if self._cols else []

    def __iter__(self):
        return iter(self.fetchall())


class _PgConn:
    """Speaks the sqlite3 dialect the handlers use (? params, lastrowid)."""

    def __init__(self, con):
        self._con = con

    def execute(self, sql, params=()):
        sql = sql.replace("%", "%%").replace("?", "%s")
        want_id = re.match(r"\s*INSERT INTO (%s)\b" % "|".join(_PG_ID_TABLES), sql)
        if want_id:
            sql += " RETURNING id"
        cur = self._con.execute(sql, tuple(params))
        if want_id:
            return _PgCursor(cur, lastrowid=cur.fetchone()[0])
        return _PgCursor(cur)


@contextlib.contextmanager
def _pg_db():
    with _pg_pool.connection() as con:
        yield _PgConn(con)


def db():
    if DATABASE_URL:
        return _pg_db()
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  pass BYTEA NOT NULL, salt BYTEA NOT NULL,
  display TEXT DEFAULT '', accent TEXT DEFAULT '#1ed760',
  hue INTEGER DEFAULT 145, created DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created DOUBLE PRECISION, expires DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS playlists(
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created DOUBLE PRECISION, cover TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS playlist_items(
  id SERIAL PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL, title TEXT DEFAULT '', thumb TEXT DEFAULT '',
  duration DOUBLE PRECISION, pos INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_items_pl ON playlist_items(playlist_id, pos);
CREATE TABLE IF NOT EXISTS likes(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL, title TEXT DEFAULT '', thumb TEXT DEFAULT '',
  duration DOUBLE PRECISION, created DOUBLE PRECISION, pos INTEGER,
  PRIMARY KEY(user_id, video_id));
CREATE TABLE IF NOT EXISTS plays(
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL, title TEXT DEFAULT '', uploader TEXT DEFAULT '',
  thumb TEXT DEFAULT '', duration DOUBLE PRECISION, position DOUBLE PRECISION DEFAULT 0,
  completed INTEGER DEFAULT 0, played_at DOUBLE PRECISION);
CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id, played_at);
CREATE TABLE IF NOT EXISTS survey(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  genres TEXT DEFAULT '[]', moods TEXT DEFAULT '[]',
  artists TEXT DEFAULT '[]', created DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS secrets(name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS covers(
  playlist_id INTEGER PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
  data BYTEA NOT NULL, ctype TEXT NOT NULL);
"""


def init_db():
    global _pg_pool
    if DATABASE_URL:
        from psycopg_pool import ConnectionPool
        # prepare_threshold=None: Supabase's pooler can't hold prepared statements.
        _pg_pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=True,
                                  kwargs={"prepare_threshold": None})
        with _pg_pool.connection() as con:
            con.execute(PG_SCHEMA)
            row = con.execute("SELECT value FROM secrets WHERE name='ytdlp_cookies'").fetchone()
        if row and "cookiefile" not in BASE_YDL:
            path = os.path.join(HERE, ".cookies.txt")
            with open(path, "w", encoding="utf-8") as f:
                f.write(row[0])
            BASE_YDL["cookiefile"] = path
        return
    with _db_lock, db() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users(
          id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
          pass BLOB NOT NULL, salt BLOB NOT NULL,
          display TEXT DEFAULT '', accent TEXT DEFAULT '#1ed760',
          hue INTEGER DEFAULT 145, created REAL);
        CREATE TABLE IF NOT EXISTS sessions(
          token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created REAL, expires REAL);
        CREATE TABLE IF NOT EXISTS playlists(
          id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL, created REAL, cover TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS playlist_items(
          id INTEGER PRIMARY KEY,
          playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          video_id TEXT NOT NULL, title TEXT DEFAULT '', thumb TEXT DEFAULT '',
          duration REAL, pos INTEGER DEFAULT 0);
        CREATE INDEX IF NOT EXISTS idx_items_pl ON playlist_items(playlist_id, pos);
        CREATE TABLE IF NOT EXISTS likes(
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          video_id TEXT NOT NULL, title TEXT DEFAULT '', thumb TEXT DEFAULT '',
          duration REAL, created REAL,
          PRIMARY KEY(user_id, video_id));
        CREATE TABLE IF NOT EXISTS plays(
          id INTEGER PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          video_id TEXT NOT NULL, title TEXT DEFAULT '', uploader TEXT DEFAULT '',
          thumb TEXT DEFAULT '', duration REAL, position REAL DEFAULT 0,
          completed INTEGER DEFAULT 0, played_at REAL);
        CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id, played_at);
        CREATE TABLE IF NOT EXISTS survey(
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          genres TEXT DEFAULT '[]', moods TEXT DEFAULT '[]',
          artists TEXT DEFAULT '[]', created REAL);
        """)
        # Backfill columns for DBs created by older versions.
        cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
        for name, ddl in (("display", "TEXT DEFAULT ''"), ("accent", "TEXT DEFAULT '#1ed760'"),
                          ("hue", "INTEGER DEFAULT 145")):
            if name not in cols:
                con.execute(f"ALTER TABLE users ADD COLUMN {name} {ddl}")
        like_cols = {r[1] for r in con.execute("PRAGMA table_info(likes)")}
        if "pos" not in like_cols:
            con.execute("ALTER TABLE likes ADD COLUMN pos INTEGER")
            # Newest first, so the existing newest-on-top order is preserved.
            con.execute("""
                UPDATE likes SET pos = (
                  SELECT COUNT(*) FROM likes l2
                  WHERE l2.user_id = likes.user_id
                    AND (l2.created > likes.created
                         OR (l2.created = likes.created AND l2.video_id < likes.video_id)))""")
        pl_cols = {r[1] for r in con.execute("PRAGMA table_info(playlists)")}
        if "cover" not in pl_cols:
            con.execute("ALTER TABLE playlists ADD COLUMN cover TEXT DEFAULT ''")


COVERS_DIR = os.path.join(HERE, "covers")
COVER_TYPES = {
    b"\xff\xd8\xff": (".jpg", "image/jpeg"),
    b"\x89PNG\r\n\x1a\n": (".png", "image/png"),
    b"GIF87a": (".gif", "image/gif"),
    b"GIF89a": (".gif", "image/gif"),
}


def cover_info(data):
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp", "image/webp"
    for magic, info in COVER_TYPES.items():
        if data.startswith(magic):
            return info
    return None, None


def cover_url(filename):
    if not filename:
        return ""
    if DATABASE_URL:  # "<pid>-<version>.<ext>" — the version already busts caches
        return f"/covers/{filename}"
    try:
        mtime = int(os.path.getmtime(os.path.join(COVERS_DIR, filename)))
    except OSError:
        mtime = 0
    return f"/covers/{filename}?t={mtime}"


def hash_pass(password, salt=None):
    salt = salt or os.urandom(16)
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32), salt


def valid_username(u):
    return bool(re.fullmatch(r"[A-Za-z0-9_.-]{2,24}", u or ""))


def valid_hex_color(c):
    return bool(re.fullmatch(r"#[0-9a-fA-F]{6}", c or ""))


def row_user(r):
    return {"id": r["id"], "username": r["username"],
            "display": r["display"] or r["username"],
            "accent": r["accent"] or "#1ed760",
            "hue": r["hue"] if r["hue"] is not None else 145}


def create_session(user_id):
    token = secrets.token_hex(32)
    now = time.time()
    with _db_lock, db() as con:
        con.execute("INSERT INTO sessions(token,user_id,created,expires) VALUES(?,?,?,?)",
                    (token, user_id, now, now + SESSION_TTL))
    return token


def session_user(token):
    if not token:
        return None
    now = time.time()
    with _db_lock, db() as con:
        r = con.execute("SELECT user_id, expires FROM sessions WHERE token=?", (token,)).fetchone()
        if not r or r["expires"] < now:
            return None
        con.execute("UPDATE sessions SET expires=? WHERE token=?", (now + SESSION_TTL, token))
        u = con.execute("SELECT * FROM users WHERE id=?", (r["user_id"],)).fetchone()
        return row_user(u) if u else None


def drop_session(token):
    with _db_lock, db() as con:
        con.execute("DELETE FROM sessions WHERE token=?", (token,))

BASE_YDL = {
    "quiet": True,
    "no_warnings": not ON_RENDER,
    "noplaylist": True,
    "socket_timeout": 20,
    "retries": 2,
}
# YouTube sometimes demands sign-in from datacenter IPs; a Netscape cookies.txt
# (Render secret file) gets past it.
_COOKIES = os.environ.get("YTDLP_COOKIES") or "/etc/secrets/cookies.txt"
if os.environ.get("YTDLP_COOKIES_TXT"):  # cookies.txt contents pasted into an env var
    _COOKIES = os.path.join(HERE, ".cookies.txt")
    with open(_COOKIES, "w", encoding="utf-8") as f:
        f.write(os.environ["YTDLP_COOKIES_TXT"].replace("\\n", "\n"))
if os.path.isfile(_COOKIES):
    BASE_YDL["cookiefile"] = _COOKIES
# Stream URLs are bound to the IP that resolved them, so the audio passthrough
# must leave through the same proxy as yt-dlp.
YT_PROXY = os.environ.get("YT_PROXY") or ""
if YT_PROXY:
    BASE_YDL["proxy"] = YT_PROXY
    _yt_open = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": YT_PROXY, "https": YT_PROXY})).open
else:
    _yt_open = urllib.request.urlopen


def _thumb(entry, vid):
    thumbs = entry.get("thumbnails") or []
    if thumbs:
        best = max(thumbs, key=lambda t: (t.get("width") or 0))
        if best.get("url"):
            return best["url"]
    if entry.get("thumbnail"):
        return entry["thumbnail"]
    return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"


def ytm_tracks(query, n=12):
    """(id, title) pairs from YouTube *Music* search — music only, no vlogs/trailers."""
    opts = dict(BASE_YDL, extract_flat=True)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(
            "https://music.youtube.com/search?q=" + urllib.parse.quote_plus(query),
            download=False)
    out = []
    seen = set()
    for e in (info.get("entries") or [])[:40]:  # albums/artists interleave; scan wide
        vid = (e or {}).get("id")
        if vid and re.fullmatch(r"[\w-]{11}", vid) and vid not in seen:
            seen.add(vid)
            out.append({"id": vid, "title": (e or {}).get("title") or vid})
            if len(out) >= n:
                break
    return out


def ytm_ids(query, n=12):
    return [t["id"] for t in ytm_tracks(query, n)]


def regular_map(query, n=24):
    """Fast flat metadata map: id -> {title, uploader, duration, thumbnail}."""
    try:
        opts = dict(BASE_YDL, extract_flat=True)
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
    except Exception:
        return {}
    out = {}
    for e in (info.get("entries") or []):
        if not e or not e.get("id"):
            continue
        vid = e["id"]
        if not re.fullmatch(r"[\w-]{11}", vid) or vid in out:
            continue
        out[vid] = {"title": e.get("title") or vid,
                    "uploader": e.get("uploader") or e.get("channel") or "",
                    "duration": e.get("duration"),
                    "thumbnail": _thumb(e, vid)}
    return out


def enrich_one(vid):
    """Full metadata for one song; falls back to a playable stub on failure."""
    try:
        m = best_audio_url(vid)  # also pre-caches the stream URL → instant Play
        return {"id": vid, "title": m.get("title") or vid,
                "uploader": m.get("uploader") or "", "duration": m.get("duration"),
                "categories": m.get("categories") or [],
                "thumbnail": m.get("thumbnail") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"}
    except Exception:
        return {"id": vid, "title": vid, "uploader": "",
                "duration": None, "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"}


def _looks_like_music(e):
    """Cheap flat-metadata signals: auto-generated music channels, reasonable length."""
    up = (e.get("uploader") or e.get("channel") or "")
    if up.endswith("- Topic") or "VEVO" in up.upper():
        return True
    dur = e.get("duration")
    return bool(dur and 20 <= dur <= 720)


def regular_topup(query, have, need):
    """Plain YouTube search as last-resort filler, music-looking only."""
    opts = dict(BASE_YDL, extract_flat=True)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"ytsearch{need * 3}:{query}", download=False)
    out = []
    for e in (info.get("entries") or []):
        if not e or not e.get("id"):
            continue
        vid = e["id"]
        if not re.fullmatch(r"[\w-]{11}", vid) or vid in have:
            continue
        if not _looks_like_music(e):
            continue
        out.append({
            "id": vid,
            "title": e.get("title") or vid,
            "uploader": e.get("uploader") or e.get("channel") or "",
            "duration": e.get("duration"),
            "thumbnail": _thumb(e, vid),
        })
        have.add(vid)
        if len(out) >= need:
            break
    return out


def _keep_song(m):
    """Drop non-music (podcasts, news, vlogs): not in Music category, very long,
    no music signals. Long mixes/radios/albums with music keywords survive."""
    up = m.get("uploader") or ""
    if up.endswith("- Topic") or "VEVO" in up.upper():
        return True
    t = (m.get("title") or "").lower()
    if re.search(r"official\s+(video|audio|music)|\(official|lyrics?|slowed|nightcore|sped\s*up|\bcover\b|live\s+performance|\baudio\b", t):
        return True
    cats = m.get("categories") or []
    if cats and "Music" not in cats:
        return False
    dur = m.get("duration")
    if dur is None:
        return True  # livestreams / unknown — don't punish
    if dur <= 600:
        return True
    return any(k in t for k in ("mix", "radio", "live", "playlist", "compilation", "album"))


def search_songs(query, n=10):
    """Phase 1 (~2-4s): YTM order + flat metadata merged, zero full extracts."""
    query = query.strip()
    key = f"{query}|{n}"
    now = time.time()
    if key in _search_cache and now - _search_cache[key][0] < SEARCH_TTL:
        return _search_cache[key][1]
    # Hard deadline: a throttled YouTube must never hold the request hostage.
    # (Plain `with` would still wait for hung threads on exit — hence manual shutdown.)
    ex = ThreadPoolExecutor(max_workers=2)
    try:
        f_ytm = ex.submit(ytm_tracks, query, n)
        f_reg = ex.submit(regular_map, query, n * 2)
        try:
            tracks = f_ytm.result(timeout=25)
        except Exception:
            tracks = []
        try:
            meta = f_reg.result(timeout=25)
        except Exception:
            meta = {}
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
    out = []
    for t in tracks:
        m = meta.get(t["id"], {})
        out.append({"id": t["id"],
                    "title": m.get("title") or t["title"] or t["id"],
                    "duration": m.get("duration"),
                    "thumbnail": m.get("thumbnail") or f"https://i.ytimg.com/vi/{t['id']}/maxresdefault.jpg"})
    if len(out) < 4:
        try:
            out += regular_topup(query, {m["id"] for m in out}, n - len(out))
        except Exception:
            pass
    _search_cache[key] = (now, out)
    return out


def enrich_ids(ids):
    """Phase 2 (background): full metadata + strict music filter + stream precache."""
    out, drop = [], []
    ids = [v for v in (ids or []) if re.fullmatch(r"[\w-]{11}", v or "")][:12]
    if not ids:
        return out, drop
    done = {}
    ex = ThreadPoolExecutor(max_workers=10)
    try:
        futs = {ex.submit(enrich_one, vid): vid for vid in ids}
        try:
            for fut in as_completed(futs, timeout=14):
                try:
                    m = fut.result()
                except Exception:
                    continue
                if m:
                    done[futs[fut]] = m
        except TimeoutError:
            pass
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
        for fut in futs:
            fut.cancel()
    for vid in ids:  # preserve search order
        m = done.get(vid)
        if not m:
            continue  # too slow — leave the fast card untouched
        if _keep_song(m):
            m.pop("categories", None)
            out.append(m)
        else:
            drop.append(vid)
    return out, drop


def safe_name(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name or "").strip().rstrip(".")
    return (name[:100] or "track")


def mp3_path(video_id, title):
    return os.path.join(MUSIC_DIR, f"{safe_name(title)} [{video_id}].mp3")


def ensure_mp3(video_id):
    """Download best audio + convert to MP3 (cached). Returns (path, meta)."""
    meta = best_audio_url(video_id)
    os.makedirs(MUSIC_DIR, exist_ok=True)
    target = mp3_path(video_id, meta.get("title") or video_id)
    if os.path.exists(target) and os.path.getsize(target) > 1024:
        return target, meta
    with _mp3_lock:
        if os.path.exists(target) and os.path.getsize(target) > 1024:
            return target, meta
        opts = dict(BASE_YDL, format="bestaudio/best",
                    outtmpl=os.path.join(MUSIC_DIR, "%(id)s.%(ext)s"),
                    postprocessors=[{"key": "FFmpegExtractAudio",
                                     "preferredcodec": "mp3", "preferredquality": "0"}])
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([f"https://www.youtube.com/watch?v={video_id}"])
        tmp = os.path.join(MUSIC_DIR, f"{video_id}.mp3")
        if os.path.exists(tmp) and tmp != target:
            try:
                os.replace(tmp, target)
            except OSError:
                target = tmp
        if not os.path.exists(target):
            raise RuntimeError("conversion produced no file")
    return target, meta


_inflight = {}        # video_id -> Event, so concurrent requests share one resolve
_inflight_lock = threading.Lock()


def _cached_audio(video_id):
    hit = _url_cache.get(video_id)
    if hit and time.time() - hit[0] < URL_TTL - 300:
        return hit[1]
    return None


def _stream_works(stream):
    try:
        req = urllib.request.Request(stream, headers={"User-Agent": "Mozilla/5.0",
                                                      "Range": "bytes=0-1"})
        with _yt_open(req, timeout=8) as r:
            return r.status in (200, 206)
    except Exception as e:
        print(f"stream check failed: {str(e)[:120]}", flush=True)
        return False


def best_audio_url(video_id):
    hit = _cached_audio(video_id)
    if hit:
        return hit
    with _inflight_lock:
        ev = _inflight.get(video_id)
        owner = ev is None
        if owner:
            ev = _inflight[video_id] = threading.Event()
    if not owner:
        ev.wait(120)
        hit = _cached_audio(video_id)
        if hit:
            return hit
    try:
        return _resolve_audio(video_id)
    finally:
        if owner:
            with _inflight_lock:
                _inflight.pop(video_id, None)
            ev.set()


def _resolve_audio(video_id):
    now = time.time()
    url = f"https://www.youtube.com/watch?v={video_id}"
    info = None
    if "cookiefile" in BASE_YDL:
        # Cookies make yt-dlp use logged-in clients that need the slow JS
        # challenge solver. The anonymous visionOS client needs none, so try it
        # first and only fall back when its stream won't actually play.
        fast = {k: v for k, v in BASE_YDL.items() if k != "cookiefile"}
        fast.update(format="bestaudio/best", skip_download=True,
                    extractor_args={"youtube": {"player_client": ["visionos"]}})
        try:
            with yt_dlp.YoutubeDL(fast) as ydl:
                info = ydl.extract_info(url, download=False)
            if not _stream_works(info.get("url") or ""):
                print(f"fast path: {video_id} stream refused, falling back", flush=True)
                info = None
        except yt_dlp.utils.DownloadError as e:
            print(f"fast path: {video_id} {str(e)[:120]}, falling back", flush=True)
            info = None
    if info is None:
        opts = dict(BASE_YDL, format="bestaudio/best", skip_download=True)
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    audio_only = [f for f in (info.get("formats") or [])
                  if f.get("url") and f.get("acodec") not in (None, "none")
                  and f.get("vcodec") in (None, "none")]
    if audio_only:
        # Highest bitrate first; prefer opus/m4a containers browsers play well.
        audio_only.sort(key=lambda f: (f.get("abr") or 0), reverse=True)
        fmt = audio_only[0]
        stream, ext, abr = fmt["url"], fmt.get("ext", ""), fmt.get("abr")
    else:
        rd = (info.get("requested_downloads") or [{}])[0]
        stream, ext, abr = info.get("url", ""), rd.get("ext", ""), rd.get("abr")
    payload = {
        "id": video_id,
        "title": info.get("title") or video_id,
        "uploader": info.get("uploader") or info.get("channel") or "",
        "duration": info.get("duration"),
        "categories": info.get("categories") or [],
        "thumbnail": info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "audio_url": stream,
        "ext": ext,
        "abr": abr,
    }
    _url_cache[video_id] = (now, payload)
    return payload


_reco_cache = {}     # user_id -> (ts, tracks)
RECO_TTL = 600

_STOPWORDS = {"official", "video", "audio", "lyrics", "lyric", "hd", "hq",
             "4k", "full", "album", "ep", "feat", "ft", "vs", "part", "music",
             "song", "songs", "the", "and", "for", "with", "this", "that",
             "from", "2024", "2025", "2026", "vol"}


def _tokens(text):
    return [t for t in re.split(r"[^a-z0-9]+", (text or "").lower())
            if len(t) >= 3 and t not in _STOPWORDS]


def taste_profile(user_id):
    """Weighted affinity maps from everything the user heard + their survey.
    Returns (uploader_aff, token_aff, heard_ids, liked_titles, survey, seeds)
    where seeds = [(video_id, title)] of top liked + most completed tracks."""
    up_aff, tok_aff = {}, {}
    heard, liked_titles = set(), []
    liked_seeds, completed_seeds = [], []
    survey = {"genres": [], "moods": [], "artists": []}
    with _db_lock, db() as con:
        for r in con.execute(
                "SELECT video_id, title FROM likes WHERE user_id=? ORDER BY created DESC LIMIT 6",
                (user_id,)):
            heard.add(r["video_id"])
            liked_titles.append(r["title"] or "")
            liked_seeds.append((r["video_id"], r["title"] or ""))
            for t in _tokens(r["title"]):
                tok_aff[t] = tok_aff.get(t, 0) + 3
        for r in con.execute(
                "SELECT video_id, title, uploader, duration, position, completed, played_at"
                " FROM plays WHERE user_id=? ORDER BY played_at DESC LIMIT 400", (user_id,)):
            heard.add(r["video_id"])
            dur = r["duration"] or 0
            frac = (r["position"] or 0) / dur if dur > 0 else 0
            done = bool(r["completed"] or frac >= 0.85)
            if done:
                w = 2
                if len(completed_seeds) < 3:
                    completed_seeds.append((r["video_id"], r["title"] or ""))
            elif frac >= 0.3 or (r["position"] or 0) >= 60:
                w = 1
            else:
                w = -1  # skipped fast — mild penalty
            if r["uploader"]:
                up_aff[r["uploader"]] = up_aff.get(r["uploader"], 0) + w
            for t in _tokens(r["title"]):
                tok_aff[t] = tok_aff.get(t, 0) + w
        s = con.execute("SELECT genres, moods, artists FROM survey WHERE user_id=?",
                        (user_id,)).fetchone()
        if s:
            try:
                survey = {"genres": json.loads(s["genres"] or "[]"),
                          "moods": json.loads(s["moods"] or "[]"),
                          "artists": json.loads(s["artists"] or "[]")}
            except Exception:
                pass
    for a in survey["artists"]:
        if a.strip():
            up_aff[a.strip()] = up_aff.get(a.strip(), 0) + 2
    for g in survey["genres"]:
        for t in _tokens(g):
            tok_aff[t] = tok_aff.get(t, 0) + 2
    seeds = liked_seeds[:2] + [s for s in completed_seeds if s[0] not in {v for v, _ in liked_seeds}][:1]
    return up_aff, tok_aff, heard, liked_titles, survey, [s for s in seeds if s[0]][:3]


def _ytm_many(queries, per=5):
    """Parallel YTM searches -> ordered unique tracks tagged with their query."""
    out, seen = [], set()

    def one(q):
        try:
            return [(t["id"], t["title"]) for t in ytm_tracks(q, per)]
        except Exception:
            return []

    ex = ThreadPoolExecutor(max_workers=6)
    rank = {q: i for i, q in enumerate(queries)}
    by_id = {}
    try:
        futs = {ex.submit(one, q): q for q in queries}
        try:
            for fut in as_completed(futs, timeout=30):
                q = futs[fut]
                try:
                    tracks = fut.result()
                except Exception:
                    continue
                for vid, title in tracks:
                    prev = by_id.get(vid)
                    if prev is None or rank[q] < rank[prev["via"]]:
                        by_id[vid] = {"id": vid, "title": title, "via": q}
        except TimeoutError:
            pass
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
    return sorted(by_id.values(), key=lambda t: rank.get(t["via"], 999))


def _bust_reco(uid):
    for k in [k for k in _reco_cache if k[0] == uid]:
        _reco_cache.pop(k, None)


def mix_orbit(seeds, per=12):
    """YouTube's own similarity graph: the auto-generated RD mix for a seed
    video — co-watch + audio similarity, not names. Returns (id, title, seed)."""
    out = []

    def one(seed):
        vid, title = seed
        try:
            # NOTE: noplaylist must be OFF here, or yt-dlp drops the RD list
            # and returns the lone video (zero entries). playlist_items keeps
            # it to the 15 most relevant orbit tracks (~1s, not ~22s).
            opts = dict(BASE_YDL, extract_flat=True, noplaylist=False,
                        playlist_items="1:15")
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={vid}&list=RD{vid}", download=False)
            return [(e.get("id"), e.get("title") or "", vid, title)
                    for e in (info.get("entries") or [])[:per]
                    if e and re.fullmatch(r"[\w-]{11}", e.get("id") or "")]
        except Exception:
            return []

    ex = ThreadPoolExecutor(max_workers=3)
    try:
        futs = [ex.submit(one, s) for s in seeds[:3]]
        try:
            for fut in as_completed(futs, timeout=25):
                try:
                    out.extend(fut.result())
                except Exception:
                    continue
        except TimeoutError:
            pass
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
    return out


def recommendations(user_id, n=12):
    now = time.time()
    day = int(now // 86400)
    key = (user_id, day, n)
    if key in _reco_cache and now - _reco_cache[key][0] < RECO_TTL:
        return _reco_cache[key][1]
    up_aff, tok_aff, heard, liked_titles, survey, seeds = taste_profile(user_id)
    queries = []
    top_ups = sorted(((a, w) for a, w in up_aff.items() if w > 0),
                     key=lambda x: -x[1])[:3]
    queries += [a for a, _ in top_ups]
    top_toks = sorted(((t, w) for t, w in tok_aff.items() if w > 0 and len(t) >= 4),
                      key=lambda x: -x[1])[:4]
    queries += [t for t, _ in top_toks]
    queries += [g for g in survey["genres"][:4] if g.strip()]
    queries += [a for a in survey["artists"][:3] if a.strip()]
    queries = [q for q in dict.fromkeys(queries) if q][:12]
    if not queries:  # brand-new account, no survey yet
        queries = ["phonk", "slowed reverb", "lofi hip hop"]
    cands = []
    mixt = []
    ex = ThreadPoolExecutor(max_workers=2)
    try:
        f_cands = ex.submit(_ytm_many, queries)
        f_mix = ex.submit(mix_orbit, seeds)
        try:
            cands = f_cands.result(timeout=35)
        except Exception:
            cands = []
        try:
            mixt = f_mix.result(timeout=35)
        except Exception:
            mixt = []
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
    # Orbit signal: how often each track appears across seed mixes.
    mix_freq, mix_seed = {}, {}
    seed_ids = {s for s, _ in seeds}
    for vid, _t, seed_vid, seed_title in mixt:
        if vid in heard or vid in seed_ids:
            continue
        mix_freq[vid] = mix_freq.get(vid, 0) + 1
        mix_seed.setdefault(vid, (seed_title or "a song you love")[:42])
    # Orbit tracks join the candidate pool outright (tagged via='mix'),
    # so pure orbit picks surface even when text search missed them.
    seen = {c["id"] for c in cands}
    for vid, title, _sv, _st in mixt:
        if vid not in seen and vid not in heard and vid not in seed_ids:
            seen.add(vid)
            cands.append({"id": vid, "title": title, "via": "mix"})
    liked_sets = [_tokens(t) for t in liked_titles if t]
    genre_set = {g.strip().lower() for g in survey["genres"] if g.strip()}
    scored = []
    for c in cands:
        if c["id"] in heard:
            continue
        ctoks = _tokens(c["title"])
        score, why = 0.0, ""
        via_aff = up_aff.get(c.get("via", ""), 0)
        if via_aff > 0:
            score += via_aff * 1.5
            why = f"More {c['via']}"
        if c["id"] in mix_freq:
            score += 4 * mix_freq[c["id"]]
            if not why or "streak" in why:
                why = f"In the orbit of {mix_seed[c['id']]}"
        for t in ctoks:
            if t in tok_aff and tok_aff[t] > 0:
                score += tok_aff[t]
                if not why:
                    for g in survey["genres"]:
                        if t in _tokens(g):
                            why = f"{g.strip().title()} pick"
                            break
                    else:
                        why = f"For your {t} streak"
        for a in survey["artists"]:
            if a.strip().lower() in c["title"].lower():
                score += 3
                why = f"Because you follow {a.strip()}"
        for lt in liked_sets:
            if len(set(ctoks) & set(lt)) >= 2:
                score += 2
                if not why and c["title"]:
                    why = "Pairs with a liked song"
                break
        scored.append((score, c, why))
    scored.sort(key=lambda x: -x[0])
    mains = [(s, c, w or "On your wavelength") for s, c, w in scored if s > 0]
    # Anti-bubble slot: tracks from your survey genres that NOTHING matched —
    # genuine exploration, not a worse guess at the same thing.
    used = {c["id"] for _, c, _ in mains} | heard
    explores = []
    for s, c, _w in scored:
        if c["id"] in used or c.get("via", "").lower() not in genre_set:
            continue
        g = c.get("via", "")
        explores.append((s, c, f"Outside your bubble: {g.strip().title()}"))
        used.add(c["id"])
        if len(explores) >= 2:
            break
    picked = mains[:max(0, n - len(explores))] + explores
    if not picked:  # brand-new ears — still show fresh finds
        picked = [(1.0, c, "Fresh for you") for _, c, _ in scored[:n] if c["id"] not in heard]
    pool = [{"id": c["id"], "title": c["title"], "duration": None,
             "thumbnail": f"https://i.ytimg.com/vi/{c['id']}/maxresdefault.jpg",
             "reason": why} for _, c, why in picked]
    if not pool:
        pool = [{"id": c["id"], "title": c["title"], "duration": None,
                 "thumbnail": f"https://i.ytimg.com/vi/{c['id']}/maxresdefault.jpg",
                 "reason": "Fresh for you"} for c in cands if c["id"] not in heard][:30]
    # Daily rotation: same growing pool, a different window every day.
    start = (day * 7) % max(1, len(pool))
    tracks = [pool[(start + i) % len(pool)] for i in range(min(n, len(pool)))]
    _reco_cache[key] = (now, tracks)
    return tracks


def next_playlist_name(user_id):
    with _db_lock, db() as con:
        rows = con.execute("SELECT name FROM playlists WHERE user_id=?", (user_id,)).fetchall()
    mx = 0
    for r in rows:
        m = re.fullmatch(r"Плейлист (\d+)", (r["name"] or "").strip())
        if m:
            mx = max(mx, int(m.group(1)))
    return f"Плейлист {mx + 1}"


class Handler(SimpleHTTPRequestHandler):
    server_version = "muse/1.0"
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".webmanifest": "application/manifest+json"}

    def _cookies(self):
        out = {}
        for part in (self.headers.get("Cookie") or "").split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                out[k.strip()] = v.strip()
        return out

    def _me(self):
        return session_user(self._cookies().get("muse_session"))

    def _need_user(self):
        u = self._me()
        if not u:
            self._json({"error": "sign in required"}, 401)
            return None
        return u

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > 1_000_000:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8", "replace"))
        except Exception:
            return {}

    def _set_session_cookie(self, token):
        self.send_header("Set-Cookie",
                         f"muse_session={token}; Path=/; Max-Age={SESSION_TTL}; "
                         f"HttpOnly; SameSite=Lax")

    def _clear_session_cookie(self):
        self.send_header("Set-Cookie",
                         "muse_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json_cookie(self, obj, token=None, clear=False, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if token:
            self._set_session_cookie(token)
        if clear:
            self._clear_session_cookie()
        self.end_headers()
        self.wfile.write(body)

    def _proxy_audio(self, video_id):
        try:
            stream = best_audio_url(video_id)["audio_url"]
        except Exception as e:
            return self._json({"error": f"resolve failed: {str(e)[:150]}"}, 502)
        req = urllib.request.Request(stream, headers={"User-Agent": "Mozilla/5.0"})
        client_range = self.headers.get("Range")
        if client_range:
            req.add_header("Range", client_range)
        try:
            upstream = _yt_open(req, timeout=30)
        except HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            return
        except Exception:
            self.send_response(502)
            self.end_headers()
            return
        try:
            self.send_response(upstream.status)
            self.send_header("Content-Type", upstream.headers.get("Content-Type", "audio/webm"))
            self.send_header("Accept-Ranges", "bytes")
            for h in ("Content-Length", "Content-Range"):
                if upstream.headers.get(h):
                    self.send_header(h, upstream.headers[h])
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                shutil.copyfileobj(upstream, self.wfile, length=64 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client seeked away / closed — normal
        finally:
            try:
                upstream.close()
            except Exception:
                pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path, qs = parsed.path, urllib.parse.parse_qs(parsed.query)
        try:
            if path == "/api/health":
                return self._json({"ok": True, "build": BUILD})
            if path == "/api/version":
                return self._json({"build": BUILD})
            if path == "/api/search":
                q = (qs.get("q") or [""])[0]
                if not q.strip():
                    return self._json({"error": "empty query"}, 400)
                try:
                    n = max(4, min(15, int((qs.get("n") or ["10"])[0])))
                except ValueError:
                    n = 10
                return self._json({"results": search_songs(q, n), "music_only": True})
            if path == "/api/play":
                v = (qs.get("v") or [""])[0]
                if not re.fullmatch(r"[\w-]{11}", v or ""):
                    return self._json({"error": "bad video id"}, 400)
                data = best_audio_url(v)
                liked = False
                u = self._me()
                if u:
                    with _db_lock, db() as con:
                        liked = bool(con.execute(
                            "SELECT 1 FROM likes WHERE user_id=? AND video_id=?",
                            (u["id"], v)).fetchone())
                return self._json({**data, "liked": liked})
            if path == "/api/enrich":
                raw = (qs.get("ids") or [""])[0]
                cards, drop = enrich_ids(raw.split(","))
                return self._json({"cards": cards, "drop": drop})
            if path == "/api/audio":
                # Same-origin audio passthrough (Range-aware) so the Web Audio
                # analyser can read real FFT data instead of a fake animation.
                v = (qs.get("v") or [""])[0]
                if not re.fullmatch(r"[\w-]{11}", v or ""):
                    return self._json({"error": "bad video id"}, 400)
                return self._proxy_audio(v)
            if path == "/api/mp3":
                v = (qs.get("v") or [""])[0]
                if not re.fullmatch(r"[\w-]{11}", v or ""):
                    return self._json({"error": "bad video id"}, 400)
                try:
                    target, meta = ensure_mp3(v)
                except yt_dlp.utils.DownloadError as e:
                    return self._json({"error": f"yt-dlp: {str(e)[:150]}"}, 502)
                except Exception as e:
                    return self._json({"error": f"{type(e).__name__}: {str(e)[:150]}"}, 500)
                try:
                    size = os.path.getsize(target)
                    name = os.path.basename(target).encode("utf-8", "replace").decode("latin-1")
                    self.send_response(200)
                    self.send_header("Content-Type", "audio/mpeg")
                    self.send_header("Content-Length", str(size))
                    self.send_header("Content-Disposition",
                                     f"attachment; filename*=UTF-8''{urllib.parse.quote(os.path.basename(target))}")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    if self.command != "HEAD":
                        with open(target, "rb") as f:
                            shutil.copyfileobj(f, self.wfile, length=256 * 1024)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            if path == "/api/me":
                u = self._me()
                return self._json({"user": u} if u else {"user": None})
            if path == "/api/playlists":
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    pls = con.execute(
                        "SELECT id, name, cover FROM playlists WHERE user_id=? ORDER BY id",
                        (u["id"],)).fetchall()
                    out = []
                    for p in pls:
                        n = con.execute(
                            "SELECT COUNT(*) c FROM playlist_items WHERE playlist_id=?",
                            (p["id"],)).fetchone()["c"]
                        cover = con.execute(
                            "SELECT thumb FROM playlist_items WHERE playlist_id=? "
                            "ORDER BY pos LIMIT 1", (p["id"],)).fetchone()
                        out.append({"id": p["id"], "name": p["name"], "count": n,
                                    "cover": (cover["thumb"] if cover else "") or "",
                                    "custom_cover": cover_url(p["cover"] or "")})
                return self._json({"playlists": out})
            m = re.fullmatch(r"/api/playlists/(\d+)/tracks", path)
            if m:
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    pl = con.execute(
                        "SELECT id, name, cover FROM playlists WHERE id=? AND user_id=?",
                        (int(m.group(1)), u["id"])).fetchone()
                    if not pl:
                        return self._json({"error": "no such playlist"}, 404)
                    rows = con.execute(
                        "SELECT id, video_id, title, thumb, duration FROM playlist_items "
                        "WHERE playlist_id=? ORDER BY pos, id", (pl["id"],)).fetchall()
                return self._json({"id": pl["id"], "name": pl["name"],
                                   "custom_cover": cover_url(pl["cover"] or ""),
                                   "tracks": [{"item_id": r["id"], "id": r["video_id"],
                                               "title": r["title"], "thumbnail": r["thumb"],
                                               "duration": r["duration"]} for r in rows]})
            if path == "/api/likes":
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    rows = con.execute(
                        "SELECT video_id, title, thumb, duration FROM likes "
                        "WHERE user_id=? ORDER BY pos ASC", (u["id"],)).fetchall()
                return self._json({"tracks": [
                    {"id": r["video_id"], "title": r["title"],
                     "thumbnail": r["thumb"], "duration": r["duration"]} for r in rows]})
            if path == "/api/liked_ids":
                u = self._me()
                if not u:
                    return self._json({"liked": []})
                ids = [v for v in (qs.get("ids") or [""])[0].split(",")
                       if re.fullmatch(r"[\w-]{11}", v or "")]
                if not ids:
                    return self._json({"liked": []})
                with _db_lock, db() as con:
                    rows = con.execute(
                        f"SELECT video_id FROM likes WHERE user_id=? AND video_id IN "
                        f"({','.join('?' * len(ids))})", (u["id"], *ids)).fetchall()
                return self._json({"liked": [r["video_id"] for r in rows]})
            if path == "/api/survey":
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    s = con.execute("SELECT genres, moods, artists FROM survey WHERE user_id=?",
                                    (u["id"],)).fetchone()
                if not s:
                    return self._json({"survey": None})
                try:
                    return self._json({"survey": {
                        "genres": json.loads(s["genres"] or "[]"),
                        "moods": json.loads(s["moods"] or "[]"),
                        "artists": json.loads(s["artists"] or "[]")}})
                except Exception:
                    return self._json({"survey": None})
            if path == "/api/recommendations":
                u = self._need_user()
                if not u:
                    return
                try:
                    n = max(4, min(15, int((qs.get("n") or ["12"])[0])))
                except ValueError:
                    n = 12
                return self._json({"tracks": recommendations(u["id"], n)})
            if path.startswith("/covers/"):
                fn = path.rsplit("/", 1)[-1]
                cm = re.fullmatch(r"(\d+)-\d+\.(jpg|jpeg|png|webp|gif)", fn or "")
                if DATABASE_URL and cm:
                    with _db_lock, db() as con:
                        row = con.execute("SELECT data, ctype FROM covers WHERE playlist_id=?",
                                          (int(cm.group(1)),)).fetchone()
                    if row:
                        try:
                            self.send_response(200)
                            self.send_header("Content-Type", row["ctype"])
                            self.send_header("Content-Length", str(len(row["data"])))
                            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                            self.end_headers()
                            if self.command != "HEAD":
                                self.wfile.write(row["data"])
                        except (BrokenPipeError, ConnectionResetError):
                            pass
                        return
                if re.fullmatch(r"\d+\.(jpg|jpeg|png|webp|gif)", fn or ""):
                    full = os.path.join(COVERS_DIR, fn)
                    if os.path.isfile(full):
                        ctype = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
                                 "png": "image/png", "webp": "image/webp",
                                 "gif": "image/gif"}[fn.rsplit(".", 1)[-1]]
                        try:
                            with open(full, "rb") as f:
                                body = f.read()
                            self.send_response(200)
                            self.send_header("Content-Type", ctype)
                            self.send_header("Content-Length", str(len(body)))
                            self.send_header("Cache-Control", "public, max-age=86400")
                            self.end_headers()
                            if self.command != "HEAD":
                                self.wfile.write(body)
                        except (BrokenPipeError, ConnectionResetError):
                            pass
                        return
                self.send_response(404)
                self.end_headers()
                return
            self.directory = STATIC
            if path == "/":
                self.path = "/index.html"
            return super().do_GET()
        except yt_dlp.utils.DownloadError as e:
            return self._json({"error": f"yt-dlp: {str(e)[:200]}"}, 502)
        except Exception as e:  # keep the box alive no matter what
            return self._json({"error": f"{type(e).__name__}: {str(e)[:200]}"}, 500)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            # Raw-binary routes read the body themselves — pre-reading here
            # as JSON would starve their read and hang the request forever.
            is_cover = re.fullmatch(r"/api/playlists/(\d+)/cover", path)
            body = {} if is_cover else self._body()
            if path == "/api/signup":
                username = (body.get("username") or "").strip()
                password = body.get("password") or ""
                if not valid_username(username):
                    return self._json({"error": "username: 2-24 letters, digits, _ . -"}, 400)
                if len(password) < 4:
                    return self._json({"error": "password too short (min 4)"}, 400)
                pw, salt = hash_pass(password)
                with _db_lock, db() as con:
                    if con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
                        return self._json({"error": "name taken"}, 409)
                    cur = con.execute(
                        "INSERT INTO users(username,pass,salt,display,created) "
                        "VALUES(?,?,?,?,?)", (username, pw, salt, username, time.time()))
                    u = row_user(con.execute("SELECT * FROM users WHERE id=?",
                                             (cur.lastrowid,)).fetchone())
                return self._json_cookie({"user": u}, token=create_session(u["id"]))
            if path == "/api/login":
                username = (body.get("username") or "").strip()
                password = body.get("password") or ""
                with _db_lock, db() as con:
                    r = con.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
                if not r or not hmac.compare_digest(hash_pass(password, r["salt"])[0], r["pass"]):
                    return self._json({"error": "wrong name or password"}, 401)
                return self._json_cookie({"user": row_user(r)}, token=create_session(r["id"]))
            if path == "/api/logout":
                drop_session(self._cookies().get("muse_session"))
                return self._json_cookie({"ok": True}, clear=True)
            if path == "/api/playlists":
                u = self._need_user()
                if not u:
                    return
                name = (body.get("name") or "").strip()[:60] or next_playlist_name(u["id"])
                with _db_lock, db() as con:
                    cur = con.execute(
                        "INSERT INTO playlists(user_id,name,created) VALUES(?,?,?)",
                        (u["id"], name, time.time()))
                    pid = cur.lastrowid
                return self._json({"id": pid, "name": name, "count": 0, "cover": ""})
            m = re.fullmatch(r"/api/playlists/(\d+)/tracks", path)
            if m:
                u = self._need_user()
                if not u:
                    return
                v = body.get("video_id") or ""
                if not re.fullmatch(r"[\w-]{11}", v or ""):
                    return self._json({"error": "bad video id"}, 400)
                with _db_lock, db() as con:
                    pl = con.execute(
                        "SELECT id FROM playlists WHERE id=? AND user_id=?",
                        (int(m.group(1)), u["id"])).fetchone()
                    if not pl:
                        return self._json({"error": "no such playlist"}, 404)
                    if con.execute(
                            "SELECT 1 FROM playlist_items WHERE playlist_id=? AND video_id=?",
                            (pl["id"], v)).fetchone():
                        return self._json({"ok": True, "duplicate": True})
                    mx = con.execute(
                        "SELECT COALESCE(MAX(pos),-1) m FROM playlist_items WHERE playlist_id=?",
                        (pl["id"],)).fetchone()["m"]
                    cur = con.execute(
                        "INSERT INTO playlist_items(playlist_id,video_id,title,thumb,duration,pos)"
                        " VALUES(?,?,?,?,?,?)",
                        (pl["id"], v, (body.get("title") or "")[:200],
                         (body.get("thumbnail") or "")[:500],
                         body.get("duration"), mx + 1))
                return self._json({"ok": True, "item_id": cur.lastrowid})
            if path == "/api/event":
                # Listening telemetry: play | complete | skip. Guests are ignored.
                u = self._me()
                if not u:
                    return self._json({"ok": True})
                v = body.get("video_id") or ""
                if not re.fullmatch(r"[\w-]{11}", v or ""):
                    return self._json({"error": "bad video id"}, 400)
                kind = body.get("type") or "play"
                try:
                    pos = float(body.get("position") or 0)
                except (TypeError, ValueError):
                    pos = 0
                try:
                    dur = body.get("duration")
                    dur = float(dur) if dur is not None else None
                except (TypeError, ValueError):
                    dur = None
                with _db_lock, db() as con:
                    if kind == "complete":
                        cur = con.execute(
                            "UPDATE plays SET completed=1, position=? WHERE user_id=? AND video_id=?",
                            (pos, u["id"], v))
                        if not cur.rowcount:
                            con.execute(
                                "INSERT INTO plays(user_id,video_id,title,uploader,thumb,duration,"
                                "position,completed,played_at) VALUES(?,?,?,?,?,?,?,1,?)",
                                (u["id"], v, (body.get("title") or "")[:200],
                                 (body.get("uploader") or "")[:200],
                                 (body.get("thumbnail") or "")[:500], dur, pos, time.time()))
                    else:
                        con.execute(
                            "INSERT INTO plays(user_id,video_id,title,uploader,thumb,duration,"
                            "position,completed,played_at) VALUES(?,?,?,?,?,?,?,0,?)",
                            (u["id"], v, (body.get("title") or "")[:200],
                             (body.get("uploader") or "")[:200],
                             (body.get("thumbnail") or "")[:500], dur, pos, time.time()))
                _bust_reco(u["id"])  # taste changed — refresh recos next time
                return self._json({"ok": True})
            if path == "/api/survey":
                u = self._need_user()
                if not u:
                    return

                def clean_list(v, limit=12, size=40):
                    if not isinstance(v, list):
                        return []
                    seen, out = set(), []
                    for x in v:
                        x = (x if isinstance(x, str) else "") .strip()[:size]
                        if x and x.lower() not in seen:
                            seen.add(x.lower())
                            out.append(x)
                        if len(out) >= limit:
                            break
                    return out

                genres = clean_list(body.get("genres"))
                moods = clean_list(body.get("moods"))
                artists = clean_list(body.get("artists"))
                with _db_lock, db() as con:
                    con.execute(
                        "INSERT INTO survey(user_id,genres,moods,artists,created) VALUES(?,?,?,?,?) "
                        "ON CONFLICT(user_id) DO UPDATE SET genres=excluded.genres,"
                        " moods=excluded.moods, artists=excluded.artists",
                        (u["id"], json.dumps(genres), json.dumps(moods),
                         json.dumps(artists), time.time()))
                _bust_reco(u["id"])
                return self._json({"ok": True,
                                   "survey": {"genres": genres, "moods": moods, "artists": artists}})
            m = re.fullmatch(r"/api/playlists/(\d+)/cover", path)
            if m:
                # Custom cover: raw image bytes (the editor always sends a
                # 512px JPEG). Validated by magic, stored per playlist id.
                u = self._need_user()
                if not u:
                    return
                pid = int(m.group(1))
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                except ValueError:
                    n = 0
                if n <= 0 or n > 8_000_000:
                    return self._json({"error": "bad upload"}, 400)
                try:
                    data = self.rfile.read(n)
                except Exception:
                    return self._json({"error": "unreadable upload"}, 400)
                ext, ctype = cover_info(data)
                if not ext:
                    return self._json({"error": "not an image"}, 400)
                with _db_lock, db() as con:
                    pl = con.execute("SELECT id FROM playlists WHERE id=? AND user_id=?",
                                     (pid, u["id"])).fetchone()
                    if not pl:
                        return self._json({"error": "no such playlist"}, 404)
                    if DATABASE_URL:
                        con.execute(
                            "INSERT INTO covers(playlist_id,data,ctype) VALUES(?,?,?) "
                            "ON CONFLICT(playlist_id) DO UPDATE SET data=excluded.data,"
                            " ctype=excluded.ctype", (pid, data, ctype))
                        fn = f"{pid}-{int(time.time())}{ext}"
                        con.execute("UPDATE playlists SET cover=? WHERE id=?", (fn, pid))
                        return self._json({"ok": True, "custom_cover": cover_url(fn)})
                    os.makedirs(COVERS_DIR, exist_ok=True)
                    fn = f"{pid}{ext}"
                    with open(os.path.join(COVERS_DIR, fn), "wb") as f:
                        f.write(data)
                    # drop a stale sibling in another format
                    for other in ("jpg", "jpeg", "png", "webp", "gif"):
                        if other != ext.lstrip("."):
                            try:
                                os.remove(os.path.join(COVERS_DIR, f"{pid}.{other}"))
                            except OSError:
                                pass
                    con.execute("UPDATE playlists SET cover=? WHERE id=?", (fn, pid))
                return self._json({"ok": True, "custom_cover": cover_url(fn)})
            if path == "/api/like":
                u = self._need_user()
                if not u:
                    return
                v = body.get("video_id") or ""
                if not re.fullmatch(r"[\w-]{11}", v or ""):
                    return self._json({"error": "bad video id"}, 400)
                with _db_lock, db() as con:
                    if con.execute("SELECT 1 FROM likes WHERE user_id=? AND video_id=?",
                                   (u["id"], v)).fetchone():
                        con.execute("DELETE FROM likes WHERE user_id=? AND video_id=?",
                                    (u["id"], v))
                        _bust_reco(u["id"])
                        return self._json({"liked": False})
                    con.execute(
                        "INSERT INTO likes(user_id,video_id,title,thumb,duration,created,pos)"
                        " VALUES(?,?,?,?,?,?,?)",
                        (u["id"], v, (body.get("title") or "")[:200],
                         (body.get("thumbnail") or "")[:500], body.get("duration"), time.time(), -1))
                    # New likes land on top: shift everything down, park at 0.
                    con.execute("UPDATE likes SET pos = pos + 1 WHERE user_id=? AND video_id<>?",
                                (u["id"], v))
                    con.execute("UPDATE likes SET pos = 0 WHERE user_id=? AND video_id=?",
                                (u["id"], v))
                    _bust_reco(u["id"])
                    return self._json({"liked": True})
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            return self._json({"error": f"{type(e).__name__}: {str(e)[:200]}"}, 500)

    def do_PATCH(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            body = self._body()
            if path == "/api/me":
                u = self._need_user()
                if not u:
                    return
                display = (body.get("display") or "").strip()[:24]
                accent = body.get("accent") or ""
                hue = body.get("hue")
                try:
                    hue = max(0, min(360, int(hue))) if hue is not None else None
                except (TypeError, ValueError):
                    hue = None
                if accent and not valid_hex_color(accent):
                    return self._json({"error": "bad color"}, 400)
                with _db_lock, db() as con:
                    if display:
                        con.execute("UPDATE users SET display=? WHERE id=?", (display, u["id"]))
                    if accent:
                        con.execute("UPDATE users SET accent=? WHERE id=?", (accent, u["id"]))
                    if hue is not None:
                        con.execute("UPDATE users SET hue=? WHERE id=?", (hue, u["id"]))
                    r = con.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
                return self._json({"user": row_user(r)})
            m = re.fullmatch(r"/api/playlists/(\d+)", path)
            if m:
                u = self._need_user()
                if not u:
                    return
                name = (body.get("name") or "").strip()[:60]
                if not name:
                    return self._json({"error": "empty name"}, 400)
                with _db_lock, db() as con:
                    cur = con.execute("UPDATE playlists SET name=? WHERE id=? AND user_id=?",
                                      (name, int(m.group(1)), u["id"]))
                    if not cur.rowcount:
                        return self._json({"error": "no such playlist"}, 404)
                return self._json({"ok": True, "name": name})
            m = re.fullmatch(r"/api/playlists/(\d+)/order", path)
            if m:
                u = self._need_user()
                if not u:
                    return
                ids = [i for i in (body.get("ids") or []) if isinstance(i, int)][:500]
                with _db_lock, db() as con:
                    pl = con.execute("SELECT id FROM playlists WHERE id=? AND user_id=?",
                                     (int(m.group(1)), u["id"])).fetchone()
                    if not pl:
                        return self._json({"error": "no such playlist"}, 404)
                    for pos, item_id in enumerate(ids):
                        con.execute("UPDATE playlist_items SET pos=? WHERE id=? AND playlist_id=?",
                                    (pos, item_id, pl["id"]))
                return self._json({"ok": True})
            if path == "/api/likes/order":
                u = self._need_user()
                if not u:
                    return
                vids = [v for v in (body.get("video_ids") or [])
                        if isinstance(v, str) and re.fullmatch(r"[\w-]{11}", v)][:500]
                with _db_lock, db() as con:
                    for pos, vid in enumerate(vids):
                        con.execute("UPDATE likes SET pos=? WHERE user_id=? AND video_id=?",
                                    (pos, u["id"], vid))
                return self._json({"ok": True})
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            return self._json({"error": f"{type(e).__name__}: {str(e)[:200]}"}, 500)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            m = re.fullmatch(r"/api/playlists/(\d+)", path)
            if m:
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    cur = con.execute("DELETE FROM playlists WHERE id=? AND user_id=?",
                                      (int(m.group(1)), u["id"]))
                    if not cur.rowcount:
                        return self._json({"error": "no such playlist"}, 404)
                return self._json({"ok": True})
            m = re.fullmatch(r"/api/playlist-items/(\d+)", path)
            if m:
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    cur = con.execute(
                        "DELETE FROM playlist_items WHERE id=? AND playlist_id IN "
                        "(SELECT id FROM playlists WHERE user_id=?)",
                        (int(m.group(1)), u["id"]))
                    if not cur.rowcount:
                        return self._json({"error": "not found"}, 404)
                return self._json({"ok": True})
            return self._json({"error": "not found"}, 404)
        except Exception as e:
            return self._json({"error": f"{type(e).__name__}: {str(e)[:200]}"}, 500)

    def end_headers(self):
        # App shell must never sit in browser cache: a stale index.html
        # pointing at stale assets is exactly how clients get permanently stuck.
        try:
            p = urllib.parse.urlparse(self.path).path
            if (p in ("/", "/index.html", "/sw.js", "/manifest.webmanifest")
                    or p.startswith("/app.") or p.startswith("/style.")):
                self.send_header("Cache-Control", "no-store")
        except Exception:
            pass
        super().end_headers()

    def log_message(self, *args):
        pass  # stay quiet


def keep_awake():
    """Render's free tier sleeps after 15 idle minutes; a request through the
    public URL every 10 counts as traffic and keeps the instance warm."""
    while True:
        time.sleep(600)
        try:
            urllib.request.urlopen(f"{PUBLIC_URL}/api/version", timeout=30).read()
        except Exception as e:
            print(f"keep-awake ping failed: {e}", flush=True)


def main():
    init_db()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Muse on  http://127.0.0.1:{PORT}", flush=True)
    print(f"yt-dlp {yt_dlp.version.__version__}, cookies: {BASE_YDL.get('cookiefile') or 'none'}, "
          f"js runtime: {shutil.which('deno') or 'none'}, proxy: {YT_PROXY or 'none'}", flush=True)
    if PUBLIC_URL:
        threading.Thread(target=keep_awake, daemon=True).start()
    if not ON_RENDER:
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye.")


if __name__ == "__main__":
    main()
