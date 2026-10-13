#!/usr/bin/env python3
"""Muse — lightweight music search & play — yt-dlp music-only search + best-audio streaming.

Stdlib only (+ yt_dlp module). Run:  python server.py   →  http://127.0.0.1:8077
"""
import base64
import contextlib
import hashlib
import hmac
import json
import os
import random
import re
import secrets
import shutil
import sqlite3
import subprocess
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

try:
    from pywebpush import WebPushException, webpush
except ImportError:
    webpush = None
    WebPushException = Exception

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")


def _env_file_get(name):
    """Read one key from .env files without dumping the whole file into the process."""
    if os.environ.get(name):
        return os.environ[name]
    for path in (os.path.join(HERE, ".env"), os.path.join(HERE, "deploy", ".env")):
        try:
            with open(path, encoding="utf-8-sig") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    if k.strip() == name:
                        return v.strip().strip('"').strip("'")
        except OSError:
            pass
    return ""


PORT = int(os.environ.get("PORT") or 8090)
HOST = os.environ.get("HOST") or "0.0.0.0"
ON_RENDER = bool(os.environ.get("RENDER"))
PUBLIC_URL = (os.environ.get("PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "").rstrip("/")
DATABASE_URL = os.environ.get("DATABASE_URL") or ""  # set → Postgres (Supabase); unset → local SQLite
BUILD = 275  # bump every release — the UI polls this and prompts reload
DESKTOP_VERSION = os.environ.get("DESKTOP_VERSION") or "1.1.11"
DESKTOP_DIR = os.environ.get("DESKTOP_DIR") or os.path.join(HERE, "desktop-dist")
DESKTOP_AUTHOR = "https://github.com/voidzxcdev"
LINUX_VERSION = os.environ.get("LINUX_VERSION") or "1.0.2"
ANDROID_VERSION = os.environ.get("ANDROID_VERSION") or "1.0.3"
try:
        ANDROID_CODE = int(os.environ.get("ANDROID_CODE") or "7")
except ValueError:
    ANDROID_CODE = 7

SEARCH_TTL = 600      # seconds to cache a search
URL_TTL = 6 * 3600    # googlevideo URLs live ~6h

_search_cache = {}    # "query|n" -> (ts, results)
_search_inflight = {}  # key -> Event, coalesce identical in-flight searches
_search_inflight_lock = threading.Lock()
_url_cache = {}       # video_id -> (ts, payload)
CACHE_MAX = 400

# The free instance has 512 MB; a full extract can spawn a ~100 MB deno
# challenge solver, so only a couple may run at once.
_full_gate = threading.BoundedSemaphore(1)
_flat_gate = threading.BoundedSemaphore(4)


def _cache_put(cache, key, value):
    if len(cache) >= CACHE_MAX:
        for k in sorted(cache, key=lambda k: cache[k][0])[:CACHE_MAX // 4]:
            cache.pop(k, None)
    cache[key] = value

OPENROUTER_API_KEY = _env_file_get("OPENROUTER_API_KEY")
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL") or "qwen/qwen3.8-27b:free"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GROQ_API_KEY = _env_file_get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("GROQ_MODEL") or "openai/gpt-oss-120b"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
ZAI_URLS = (
    "https://api.z.ai/api/paas/v4/chat/completions",
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
)
CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
HF_URL = "https://router.huggingface.co/v1/chat/completions"
KILO_URL = "https://api.kilo.ai/api/gateway/chat/completions"
LLM7_URL = "https://api.llm7.io/v1/chat/completions"
OVH_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions"
_musely_lock = threading.Lock()
_musely_cache = {}  # prompt-key -> (ts, payload)
_musely_hits = {}   # ip -> [timestamps]
_musely_recent = {}  # ip -> [normalized titles we already served]
_musely_lane_n = 0
_musely_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="musely")
_webpush_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="webpush")
_vapid = {"priv": "", "pub": ""}
_vapid_lock = threading.Lock()


_MUSELY_THINK_TAGS = re.compile(
    r"<(think|thinking|reasoning|redacted_thinking|redacted_reasoning)\b[^>]*>.*?</\1>",
    re.I | re.S,
)
_MUSELY_THINK_MARK = re.compile(
    r"(?i)(?:here'?s a )?thinking process\s*:|analyze user input|"
    r"chain of thought|let me think(?:\s+step)?|redacted_reasoning"
)
_MUSELY_THINK_BODY = re.compile(
    r"(?i)thinking process|analyze user input|check context/conversation|"
    r"conversation history|chain of thought|let me think|"
    r"the user said|user input:|here'?s a thinking|step-by-step|"
    r"previous interactions show"
)
_MUSELY_HIST_JUNK = re.compile(
    r"(?i)brain freeze|thinking process|analyze user input|here'?s a thinking|"
    r"couldn't shape that|blank stare|ask me one more time|try me again"
)
_MUSELY_HI_RE = re.compile(
    r"^(?:привет(?:ик)?|привіт|здравствуй(?:те)?|здрастуй(?:те)?|"
    r"добр(?:ый|ий)\s+(?:день|вечер|вечір)|здарова?|хай|хей|ку+|йо+|еу|"
    r"hello+|hi+|hey+|yo+|sup|wassup)"
    r"(?:\s|[!?.…,👋😊😉😘])*?$",
    re.I | re.U,
)
_MUSELY_UK = re.compile(r"[іїєґІЇЄҐ]")


def _musely_sys():
    today = time.strftime("%Y-%m-%d")
    return (
        "You are Musely. Cool, brief, never cringe. "
        "Today is " + today + ". "
        "ALWAYS write the JSON field say in Russian (русский). "
        "Never Ukrainian. Never English. Never any other language. "
        "If the user writes Ukrainian, English, or anything else — still answer in Russian. "
        "Song titles and artist names in tracks stay as real names. "
        "Each message is a brand-new conversation. No memory of earlier turns. "
        "If they ask who/what you are: say exactly «ИИ от Muse» and nothing else. "
        "Never say Мюсли, mascot, маскот, pixel mascot, or that you are cereal. "
        "Never write a thinking process, analysis, steps, or 'the user said'. "
        "Never mention brain freeze. First character of your reply must be '{'. "
        "Decide mode. "
        "MUSIC — they want a song, vibe, recs, play, trending, an artist: "
        "pick 3 real songs out NOW. Prefer " + today[:4] + " and last year. "
        "No 2010s nostalgia, no 2020–2023 radio staples unless they named that song. "
        "NEVER As It Was, Bad Habit, Flowers, Anti-Hero, Stay, Blinding Lights, Heat Waves. "
        "Those are banned. Popular/trending = this week's songs, not old hits. "
        'JSON: {"mode":"music","say":"","tracks":[{"title":"short song name","query":"title artist"}]} '
        "Exactly 3 tracks. title = song name only. query = title + artist. say empty. "
        "CHAT — small talk, jokes, feelings, anything that is not finding music: "
        'JSON: {"mode":"chat","say":"одно короткое предложение по-русски","tracks":[]} '
        "Chat say = max 12 Russian words. No essays. No tracks unless they asked for music. "
        "If they want a song, hit, vibe, artist, or 'popular': ALWAYS music mode with 3 tracks. "
        "Never list songs in say. Never use markdown bullets. Return ONLY JSON."
    )


def _musely_strip_think(text):
    t = text or ""
    t = _MUSELY_THINK_TAGS.sub(" ", t)
    t = re.sub(r"</?(?:think|thinking|reasoning)[^>]*>", " ", t, flags=re.I)
    t = re.sub(r"<\|[^|]*\|>", " ", t)
    if _MUSELY_THINK_MARK.search(t):
        i = t.find("{")
        t = t[i:] if i >= 0 else ""
    return t.strip()


def _musely_looks_like_think(t):
    if not t:
        return True
    if _MUSELY_THINK_BODY.search(t):
        return True
    head = t.lstrip()[:220]
    if head.startswith("1.") and ("**" in head or "user" in head.lower()):
        return True
    return False


def _musely_hello_say(_msg=None):
    return "Привет! Что ставим?"


def _musely_ru_say(say):
    s = (say or "").strip()
    if not s:
        return s
    if _MUSELY_UK.search(s) or not re.search(r"[а-яёА-ЯЁ]", s):
        return "Привет! Чем могу помочь?"
    return s


def _musely_one_track(raw):
    q = re.sub(r"https?://\S+", "", str(raw or "")).strip()
    q = re.sub(r"^[\s\-–—•*]+", "", q)
    q = re.sub(r"\s+", " ", q).strip(" -–—,")[:160]
    if len(q) < 2:
        return None
    if re.search(r'[{}"]|^\s*(mode|say|tracks|query|title)\b', q, re.I):
        return None
    low = q.lower()
    if low in ("music", "tracks", "songs", "chat", "say", "mode") or _musely_looks_like_think(q):
        return None
    title = q.split(" - ", 1)[0].strip()[:40] if " - " in q else q[:40]
    if not title:
        return None
    return {"title": title, "query": q}


def _musely_tracks_from_text(text):
    t = (text or "").strip()
    if not t or t[0] in "{[":
        return []
    if re.search(r'"mode"\s*:|"tracks"\s*:', t):
        return []
    lined = []
    for ln in t.splitlines():
        m = re.match(r"^\s*(?:[-–—•*]|\d+[.)])\s+(.*\S)\s*$", ln)
        if not m:
            continue
        tr = _musely_one_track(m.group(1))
        if tr:
            lined.append(tr)
    if len(lined) >= 2:
        return lined[:3]
    if not re.match(r"^[\-–—•*]", t) or t.count(" - ") < 2:
        return lined[:3]
    blob = re.sub(r"^[\s\-–—•*]+", "", t)
    parts = [p.strip() for p in re.split(r"\s+-\s+", blob) if p.strip()]
    if len(parts) >= 3:
        out = []
        for p in parts[:3]:
            tr = _musely_one_track(p)
            if tr:
                out.append(tr)
        if len(out) >= 2:
            return out
    return lined[:3]


def _musely_track_items(obj):
    if not isinstance(obj, dict):
        return []
    raw = obj.get("tracks") or obj.get("songs") or obj.get("recommendations") or []
    tracks = []
    for it in raw[:5]:
        if isinstance(it, str):
            tr = _musely_one_track(it)
            if tr:
                tracks.append(tr)
            continue
        if not isinstance(it, dict):
            continue
        title = str(it.get("title") or it.get("name") or it.get("song") or it.get("track") or "")[:80]
        artist = str(it.get("artist") or it.get("by") or "")[:80]
        query = str(it.get("query") or it.get("q") or "").strip()
        if not query:
            query = f"{title} {artist}".strip()
        tr = _musely_one_track(query or title)
        if not tr:
            continue
        if title:
            label = title.split(" - ", 1)[0].strip()[:40] if " - " in title else title[:40]
            tr["title"] = label or tr["title"]
        tracks.append(tr)
        if len(tracks) >= 3:
            break
    return tracks


def _musely_parse(text):
    if not text:
        return None
    t = _musely_strip_think(text)
    if not t:
        return None
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", t, re.S)
    blob = m.group(1) if m else t
    if not m:
        i, j = blob.find("{"), blob.rfind("}")
        if i >= 0 and j > i:
            blob = blob[i:j + 1]
    obj = None
    try:
        loaded = json.loads(blob)
        if isinstance(loaded, dict):
            obj = loaded
    except json.JSONDecodeError:
        obj = None
    say = ""
    mode = ""
    tracks = []
    if obj:
        mode = str(obj.get("mode") or "").strip().lower()
        say = str(obj.get("say") or obj.get("message") or "")[:200]
        say = re.sub(r"(?i)мюсли", "Musely", say)
        say = re.sub(r"(?i)\bмаскот(а|ом|у|е)?\b", "", say)
        say = re.sub(r"(?i)\bmascot\b", "", say)
        say = re.sub(r"\s{2,}", " ", say).strip(" ,.—")
        if _musely_looks_like_think(say):
            say = ""
        tracks = _musely_track_items(obj)
    if len(tracks) < 2:
        extra = _musely_tracks_from_text(say)
        if len(extra) < 2 and not t.lstrip().startswith(("{", "[")):
            extra = _musely_tracks_from_text(t)
        if len(extra) > len(tracks):
            tracks = extra
    if tracks:
        return {"mode": "music", "say": "", "tracks": tracks[:3]}
    if mode == "music":
        return None
    if not obj:
        say = re.sub(r"\s+", " ", t).strip()[:160]
        if not say or _musely_looks_like_think(say) or len(say) > 140:
            return None
    words = say.split()
    if len(words) > 12:
        say = " ".join(words[:12])
    if not say or _musely_looks_like_think(say):
        return None
    return {"mode": "chat", "say": say, "tracks": []}


def _or_text(msg):
    c = (msg or {}).get("content")
    if isinstance(c, str) and c.strip():
        return c
    if isinstance(c, list):
        parts = []
        for p in c:
            if not isinstance(p, dict):
                parts.append(str(p))
                continue
            kind = str(p.get("type") or "").lower()
            if kind in ("thinking", "reasoning", "thought"):
                continue
            parts.append(p.get("text") or p.get("content") or "")
        joined = "".join(parts)
        if joined.strip():
            return joined
    for k in ("reasoning_content", "reasoning"):
        r = (msg or {}).get(k)
        if not isinstance(r, str) or "{" not in r:
            continue
        i, j = r.find("{"), r.rfind("}")
        if i >= 0 and j > i:
            return r[i:j + 1]
    return c if isinstance(c, str) else ""


def _openaiish_chat(url, key, model, messages, extra_headers=None, timeout=40, extra_body=None):
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": 900,
    }
    if extra_body:
        payload.update(extra_body)
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Muse/1.1.11",
    }
    if key:
        headers["Authorization"] = f"Bearer {key}"
    if extra_headers:
        headers.update(extra_headers)
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = json.loads(resp.read().decode("utf-8", "replace"))
    except HTTPError as e:
        err = ""
        try:
            err = e.read().decode("utf-8", "replace")[:400]
        except Exception:
            err = str(e)
        return None, f"{e.code}: {err}"
    except Exception as e:
        return None, f"{type(e).__name__}: {str(e)[:180]}"
    if raw.get("error"):
        return None, str(raw.get("error"))[:240]
    try:
        msg = (raw.get("choices") or [{}])[0].get("message") or {}
    except Exception:
        return None, "bad llm payload"
    text = _or_text(msg).strip()
    if not text:
        return None, "empty model reply"
    parsed = _musely_parse(text)
    if not parsed:
        return None, "think-only"
    return parsed, None


def _key_ok(k):
    k = (k or "").strip()
    if not k:
        return False
    return k.lower() not in ("replace-me", "changeme", "none", "null")


def _musely_models(*names):
    out = []
    for n in names:
        n = (n or "").strip()
        if n and n not in out:
            out.append(n)
    return out


def _musely_try(name, url, key, models, messages, extra_headers=None, timeout=20, keyless=False, extra_body=None):
    if not keyless and not _key_ok(key):
        return None, None
    last = None
    for model in _musely_models(*models):
        parsed, err = _openaiish_chat(
            url, key if _key_ok(key) else "", model, messages,
            extra_headers=extra_headers, timeout=timeout, extra_body=extra_body,
        )
        if parsed:
            print(f"[musely] {name} {model}", flush=True)
            return parsed, None
        last = err
        code = (err or "").split(":", 1)[0].strip()
        print(f"[musely] {name} fail {model} {code}", flush=True)
        if extra_body and code == "400":
            parsed, err = _openaiish_chat(
                url, key if _key_ok(key) else "", model, messages,
                extra_headers=extra_headers, timeout=timeout, extra_body=None,
            )
            if parsed:
                print(f"[musely] {name} {model}", flush=True)
                return parsed, None
            last = err
            code = (err or "").split(":", 1)[0].strip()
            print(f"[musely] {name} fail {model} {code}", flush=True)
        if code in ("401", "403"):
            break
    return None, last


def _musely_any_key():
    names = (
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GROQ_API_KEY",
        "ZAI_API_KEY",
        "CEREBRAS_API_KEY",
        "NVIDIA_API_KEY",
        "HF_TOKEN",
        "HUGGINGFACE_HUB_TOKEN",
        "CF_API_TOKEN",
        "CLOUDFLARE_API_TOKEN",
        "OPENROUTER_API_KEY",
    )
    return any(_key_ok(_env_file_get(n)) for n in names)


def _musely_race(jobs, messages, wait=8):
    last_err = None
    if not jobs:
        return None, last_err

    def _run(name, quality, kw):
        parsed, err = _musely_try(
            name, kw["url"], kw["key"], kw["models"], messages,
            extra_headers=kw.get("extra_headers"),
            timeout=kw.get("timeout") or 8,
            keyless=kw.get("keyless") or False,
            extra_body=kw.get("extra_body"),
        )
        return name, quality, parsed, err

    futs = [_musely_pool.submit(_run, name, quality, kw) for name, quality, kw in jobs]
    pending = set(futs)
    fast = None
    deadline = time.time() + wait
    while pending:
        left = deadline - time.time()
        if left <= 0:
            break
        try:
            done = next(as_completed(pending, timeout=left))
        except TimeoutError:
            break
        pending.discard(done)
        try:
            name, quality, parsed, err = done.result()
        except Exception as e:
            last_err = f"{type(e).__name__}: {str(e)[:120]}"
            continue
        last_err = err or last_err
        if not parsed:
            continue
        if quality:
            return parsed, None
        fast = parsed
        deadline = min(deadline, time.time() + 1.2)
    if fast:
        return fast, None
    return None, last_err


def _musely_llm(messages):
    groq = _env_file_get("GROQ_API_KEY") or os.environ.get("GROQ_API_KEY")
    if not _key_ok(groq):
        return None, "no_key"
    model = os.environ.get("GROQ_MODEL") or GROQ_MODEL
    return _musely_try(
        "groq",
        GROQ_URL,
        groq,
        (model, "openai/gpt-oss-120b", "openai/gpt-oss-20b"),
        messages,
        timeout=12,
    )


_MUSELY_MUSIC_RE = re.compile(
    r"song|track|album|artist|playlist|tiktok|billboard|chart|trend|play |listen|"
    r"popular|recommend|banger|hit\b|"
    r"музык|песн|тренд|трек|тикто|хит|чарт|включи|найди|послуша|исполнител|"
    r"альбом|популярн|посовет|топ\b",
    re.I,
)
_MUSELY_CHAT_RE = re.compile(
    r"поговор|пообщ|скучн|как дела|кто ты|любл|грустн|hello|hey\b|what'?s up|"
    r"how are|bored|lonely|\bchat\b|talk to me|поговори|привет(?!\s*,?\s*я)",
    re.I,
)
_MUSELY_STALE = {
    "as it was", "bad habit", "flowers", "anti-hero", "anti hero",
    "stay", "blinding lights", "heat waves", "watermelon sugar",
    "unholy", "about damn time", "levitating", "peaches", "industry baby",
    "good 4 u", "good for you", "drivers license", "save your tears",
    "cruel summer", "shapeshifter", "first class", "late night talking",
}
_MUSELY_OLD_YR = re.compile(r"\b(?:19\d{2}|200\d|201\d|202[0-3])\b")
_MUSELY_NEW_YR = re.compile(r"\b(?:2024|2025|2026|2027)\b")
_MUSELY_TREND = re.compile(
    r"trend|viral|popular|хит|тренд|популярн|тикток|tiktok|chart|новое|новинк|"
    r"свеж|new music|new song|this week|на этой неделе|сейчас",
    re.I,
)
_MUSELY_DUMP = re.compile(
    r"viral hits|tiktok hits?|hit summer|best of\b|best songs|top \d+\b|"
    r"\bplaylist\b|\bcompilation\b|1 hour|nightcore|sped up|throwback|"
    r"oldies|songs of \d{4}|hits of \d{4}|songs \d{4}|new music \d{4}|"
    r"trending songs|bass boosted|world cup songs|remix \d{4}",
    re.I,
)
_MUSELY_LANES = (
    "new songs 2026",
    "pop songs 2026",
    "русские хиты 2026",
    "new hip hop 2026",
    "afrobeats 2026",
    "k-pop 2026",
    "new r&b 2026",
    "latin pop 2026",
    "dance 2026",
    "indie pop 2026",
    "phonk 2026",
    "sad songs 2026",
    "uk drill 2026",
    "электронная музыка 2026",
    "this week's songs",
)
_MUSELY_VAGUE = re.compile(
    r"^(?:пожалуйста\s+|please\s+|pls\s+)?(?:включи\s+|найди\s+|посовет\w*\s+|play\s+|put on\s+)?"
    r"(?:мне\s+|me\s+|какую.?нить\s+|что.?нибудь\s+|что.?то\s+|a\s+|the\s+|some\s+)?"
    r"(?:популярн\w*\s+|трендов\w*\s+|viral\s+|trending\s+|popular\s+)?"
    r"(?:песн\w*|трек\w*|хит\w*|музык\w*|songs?|tracks?|hits?|music|bangers?|something|anything)?"
    r"(?:\s+пожалуйста|\s+please)?$",
    re.I | re.U,
)


def _musely_norm_title(s):
    t = (s or "").lower()
    t = re.sub(r"[^\w\s]+", " ", t, flags=re.U)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.split(r"\s+(?:feat|ft|with|prod)\s+", t, maxsplit=1)[0].strip()
    return t


def _musely_title_key(tr):
    return _musely_norm_title((tr or {}).get("title") or (tr or {}).get("query") or "")


def _musely_is_stale(tr):
    k = _musely_title_key(tr)
    if not k:
        return True
    return any(k == s or k.startswith(s + " ") or f" {s} " in f" {k} " for s in _MUSELY_STALE)


def _musely_dated_old(title):
    t = title or ""
    return bool(_MUSELY_OLD_YR.search(t) and not _MUSELY_NEW_YR.search(t))


def _musely_fresh_score(h):
    title = h.get("title") or ""
    s = 0
    if _musely_dated_old(title):
        s -= 16
    if _MUSELY_DUMP.search(title):
        s -= 24
    if _MUSELY_NEW_YR.search(title) and len(title) > 48:
        s -= 6
    dur = h.get("duration") or 0
    try:
        dur = float(dur)
    except (TypeError, ValueError):
        dur = 0
    if dur and 90 <= dur <= 360:
        s += 3
    if dur and dur < 45:
        s -= 6
    if dur and dur > 540:
        s -= 10
    return s


def _musely_label(title):
    t = re.sub(r"\s*[\(\[][^)\]]*(official|video|audio|lyric|visualiser|hd)[^)\]]*[\)\]]",
               "", title or "", flags=re.I)
    t = t.strip(" -–—")
    if " - " in t:
        t = t.split(" - ", 1)[0].strip()
    return (t or title or "play")[:40]


def _musely_search_q(msg):
    m = (msg or "").strip()
    year = time.strftime("%Y")
    if not m or _MUSELY_VAGUE.match(m) or _MUSELY_TREND.search(m or ""):
        global _musely_lane_n
        with _musely_lock:
            _musely_lane_n += 1
            n = _musely_lane_n
        if m and _MUSELY_TREND.search(m) and not _MUSELY_VAGUE.match(m):
            if not re.search(r"20\d{2}", m):
                return f"{m} {year}"
            return m
        return _MUSELY_LANES[n % len(_MUSELY_LANES)]
    return m


def _musely_live_three(query, ip=""):
    year = time.strftime("%Y")
    trend = (query in _MUSELY_LANES) or bool(_MUSELY_TREND.search(query or ""))
    qs = [query]
    if query and query not in _MUSELY_LANES and not re.search(r"20\d{2}", query):
        qs.append(f"{query} {year}")
    hits, seen_id = [], set()
    for q in qs[:2]:
        try:
            batch = ytm_tracks(q, 20)
        except Exception:
            batch = []
        for h in batch:
            vid = h.get("id") or ""
            if vid in seen_id:
                continue
            if vid:
                seen_id.add(vid)
            hits.append(h)
    with _musely_lock:
        ban = set(_musely_recent.get(ip) or [])
    ban |= _MUSELY_STALE
    ranked = []
    for i, h in enumerate(hits):
        title = (h.get("title") or "").strip()
        if not title:
            continue
        key = _musely_norm_title(title)
        if not key or key in ban:
            continue
        if _musely_is_stale({"title": title}):
            continue
        if trend and _musely_dated_old(title):
            continue
        if _MUSELY_DUMP.search(title):
            continue
        ranked.append((_musely_fresh_score(h), -i, h, key))
    ranked.sort(key=lambda x: (x[0], x[1]), reverse=True)
    out, seen_up, seen_t = [], set(), set()
    for _sc, _i, h, key in ranked:
        if key in seen_t:
            continue
        up = _musely_norm_title(h.get("uploader") or "")
        if up and up in seen_up:
            continue
        title = (h.get("title") or "").strip()
        q = f"{title} {h.get('uploader') or ''}".strip()
        out.append({"title": _musely_label(title), "query": q[:160]})
        seen_t.add(key)
        if up:
            seen_up.add(up)
        if len(out) >= 3:
            break
    if len(out) < 3:
        try:
            extra = ytm_tracks(f"new songs {year}", 16)
        except Exception:
            extra = []
        for h in extra:
            title = (h.get("title") or "").strip()
            key = _musely_norm_title(title)
            if not title or key in seen_t or key in ban or _musely_is_stale({"title": title}):
                continue
            if _MUSELY_DUMP.search(title):
                continue
            q = f"{title} {h.get('uploader') or ''}".strip()
            out.append({"title": _musely_label(title), "query": q[:160]})
            seen_t.add(key)
            if len(out) >= 3:
                break
    if ip and out:
        with _musely_lock:
            prev = _musely_recent.get(ip) or []
            _musely_recent[ip] = [t for t in ([_musely_title_key(x) for x in out] + prev) if t][:30]
    return out[:3]


def _musely_use_search(msg):
    if _MUSELY_CHAT_RE.search(msg or "") and not _MUSELY_MUSIC_RE.search(msg or ""):
        return False
    return True


# Free models are smaller than Inkling; keep a short working window.
_MUSELY_HIST_TURNS = 24
_MUSELY_TURN_CHARS = 1200
_MUSELY_HIST_CHARS = 24_000


def _musely_hist_msgs(history):
    picked = []
    for turn in (history or []):
        if not isinstance(turn, dict):
            continue
        role = turn.get("role")
        content = str(turn.get("content") or "").strip()[:_MUSELY_TURN_CHARS]
        if role not in ("user", "assistant") or not content:
            continue
        if role == "assistant" and (
            _MUSELY_HIST_JUNK.search(content) or _musely_looks_like_think(content)
        ):
            continue
        picked.append({"role": role, "content": content})
    picked = picked[-_MUSELY_HIST_TURNS:]
    total = sum(len(t["content"]) for t in picked)
    while picked and total > _MUSELY_HIST_CHARS:
        total -= len(picked[0]["content"])
        picked.pop(0)
    return picked


def _musely_limited(ip):
    now = time.time()
    with _musely_lock:
        hits = [t for t in _musely_hits.get(ip, []) if now - t < 600]
        if len(hits) >= 24:
            _musely_hits[ip] = hits
            return True
        hits.append(now)
        _musely_hits[ip] = hits
    return False


def musely_reply(message, history, ip=""):
    user_msg = (message or "").strip()[:400]
    if not user_msg:
        return {"ok": True, "say": "", "tracks": [], "mode": "chat"}
    if re.search(r"(?i)кто ты|ты кто|хто ти|who are you|what are you|что ты так(ое|ой)|що ти|ты (бот|ии|ai)\b", user_msg):
        return {"ok": True, "mode": "chat", "say": "ИИ от Muse", "tracks": []}
    if _MUSELY_HI_RE.match(user_msg):
        return {"ok": True, "mode": "chat", "say": _musely_hello_say(user_msg), "tracks": []}
    if _musely_limited(ip):
        return {"ok": False, "say": "тихо — минутку.", "tracks": [], "mode": "chat"}
    want_music = bool(_MUSELY_MUSIC_RE.search(user_msg))
    if want_music:
        live = _musely_live_three(_musely_search_q(user_msg), ip)
        if len(live) >= 2:
            return {"ok": True, "mode": "music", "say": "", "tracks": live[:3]}
    messages = [{"role": "system", "content": _musely_sys()}]
    messages.append({"role": "user", "content": user_msg})
    parsed, err = _musely_llm(messages)
    if not parsed:
        return {"ok": False, "say": "завис — напиши ещё раз.", "tracks": [], "mode": "chat"}
    tracks = [t for t in (parsed.get("tracks") or []) if not _musely_is_stale(t)]
    if len(tracks) < 2:
        extra = [t for t in _musely_tracks_from_text(parsed.get("say") or "") if not _musely_is_stale(t)]
        if len(extra) > len(tracks):
            tracks = extra
    if tracks and (want_music or parsed.get("mode") == "music" or len(tracks) >= 2):
        live = _musely_live_three(_musely_search_q(user_msg), ip)
        if len(live) >= 2:
            tracks = live
        return {"ok": True, "mode": "music", "say": "", "tracks": tracks[:3]}
    out = {
        "ok": True,
        "mode": "chat",
        "say": _musely_ru_say(parsed.get("say") or "ещё раз"),
        "tracks": [],
    }
    if want_music:
        out["say"] = "напиши вайб или артиста — кину три."
    return out


MUSELY_NEED = 3  # unique songs listened ~30s — earn Groq, no money


def musely_gate(user):
    """Earn Musely by signing in and actually listening. Not a paywall."""
    if not user:
        return {"unlocked": False, "have": 0, "need": MUSELY_NEED, "login": True}
    with _db_lock, db() as con:
        row = con.execute(
            "SELECT COUNT(DISTINCT video_id) AS c FROM plays "
            "WHERE user_id=? AND (completed=1 OR COALESCE(position,0) >= 30)",
            (user["id"],),
        ).fetchone()
    have = int((row["c"] if row else 0) or 0)
    return {
        "unlocked": have >= MUSELY_NEED,
        "have": min(have, MUSELY_NEED),
        "need": MUSELY_NEED,
        "login": False,
    }


_file_hashes = {}  # path -> (mtime_ns, sha256, size)


def desktop_exe_path():
    return os.path.join(DESKTOP_DIR, "Muse.exe")


def desktop_setup_path():
    return os.path.join(DESKTOP_DIR, "Muse-Setup.exe")


def android_apk_path():
    return os.path.join(DESKTOP_DIR, "Muse.apk")


def linux_appimage_path():
    for p in (
        os.path.join(DESKTOP_DIR, "Muse.AppImage"),
        os.path.join(STATIC, "Muse.AppImage"),
    ):
        if os.path.isfile(p):
            return p
    return os.path.join(STATIC, "Muse.AppImage")


def file_sha(path):
    st = os.stat(path)
    prev = _file_hashes.get(path)
    if prev and prev[0] == st.st_mtime_ns:
        return prev[1], prev[2]
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    digest = h.hexdigest()
    _file_hashes[path] = (st.st_mtime_ns, digest, st.st_size)
    return digest, st.st_size


def desktop_sha(path):
    return file_sha(path)


def desktop_meta():
    path = desktop_exe_path()
    if not os.path.isfile(path):
        return None
    digest, size = desktop_sha(path)
    base = PUBLIC_URL or ""
    return {
        "version": DESKTOP_VERSION,
        "url": f"{base}/desktop/Muse.exe?v={DESKTOP_VERSION}",
        "setup": f"{base}/desktop/Muse-Setup.exe?v={DESKTOP_VERSION}",
        "sha256": digest,
        "size": size,
        "author": DESKTOP_AUTHOR,
    }


def android_meta():
    path = android_apk_path()
    if not os.path.isfile(path):
        return None
    digest, size = file_sha(path)
    base = PUBLIC_URL or ""
    return {
        "version": ANDROID_VERSION,
        "versionCode": ANDROID_CODE,
        "url": f"{base}/android/Muse.apk?v={ANDROID_VERSION}",
        "sha256": digest,
        "size": size,
    }


def linux_meta():
    path = linux_appimage_path()
    if not os.path.isfile(path):
        return None
    digest, size = file_sha(path)
    base = PUBLIC_URL or ""
    return {
        "version": LINUX_VERSION,
        "url": f"{base}/linux/Muse.AppImage?v={LINUX_VERSION}",
        "sha256": digest,
        "size": size,
    }

MUSIC_DIR = os.path.join(HERE, "music")
_mp3_lock = threading.Lock()

DB_PATH = os.path.join(HERE, "muse.db")
SESSION_TTL = 30 * 86400
# Postgres does its own locking; SQLite needs writes serialized.
_db_lock = contextlib.nullcontext() if DATABASE_URL else threading.Lock()
_pg_pool = None
_PG_ID_TABLES = ("users", "playlists", "playlist_items", "plays", "chat_msgs", "notifs", "chat_files")


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
  hue INTEGER DEFAULT 145, avatar TEXT DEFAULT '', created DOUBLE PRECISION);
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
CREATE TABLE IF NOT EXISTS reco(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ts DOUBLE PRECISION NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS avatars(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data BYTEA NOT NULL, ctype TEXT NOT NULL);
"""


def _ensure_social(con, pg=False):
    pk = "SERIAL PRIMARY KEY" if pg else "INTEGER PRIMARY KEY"
    stmts = [
        """CREATE TABLE IF NOT EXISTS market_listings(
          playlist_id INTEGER PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created DOUBLE PRECISION)""",
        """CREATE TABLE IF NOT EXISTS market_likes(
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          created DOUBLE PRECISION,
          PRIMARY KEY (user_id, playlist_id))""",
        "CREATE INDEX IF NOT EXISTS idx_market_likes_pl ON market_likes(playlist_id)",
        """CREATE TABLE IF NOT EXISTS friend_reqs(
          from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created DOUBLE PRECISION,
          PRIMARY KEY (from_id, to_id))""",
        """CREATE TABLE IF NOT EXISTS friends(
          a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created DOUBLE PRECISION,
          PRIMARY KEY (a, b))""",
        f"""CREATE TABLE IF NOT EXISTS chat_msgs(
          id {pk},
          lo INTEGER NOT NULL,
          hi INTEGER NOT NULL,
          sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          body TEXT DEFAULT '',
          payload TEXT DEFAULT '{{}}',
          created DOUBLE PRECISION)""",
        "CREATE INDEX IF NOT EXISTS idx_chat_thread ON chat_msgs(lo, hi, id)",
        f"""CREATE TABLE IF NOT EXISTS notifs(
          id {pk},
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          from_id INTEGER,
          title TEXT DEFAULT '',
          body TEXT DEFAULT '',
          payload TEXT DEFAULT '{{}}',
          created DOUBLE PRECISION,
          seen INTEGER DEFAULT 0)""",
        "CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifs(user_id, id)",
        "CREATE INDEX IF NOT EXISTS idx_notifs_unseen ON notifs(user_id, seen, id)",
        """CREATE TABLE IF NOT EXISTS push_subs(
          endpoint TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          created DOUBLE PRECISION)""",
        "CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subs(user_id)",
    ]
    for s in stmts:
        con.execute(s)
    _ensure_chat_extra(con, pg)


def _who(u):
    return ((u or {}).get("display") or (u or {}).get("handle") or "Muse")[:40]


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _vapid_generate():
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    key = ec.generate_private_key(ec.SECP256R1())
    priv = key.private_numbers().private_value.to_bytes(32, "big")
    pub = key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return _b64url(priv), _b64url(pub)


def _secret_set(con, name, value):
    if DATABASE_URL:
        con.execute(
            "INSERT INTO secrets(name,value) VALUES(?,?) "
            "ON CONFLICT (name) DO UPDATE SET value=excluded.value",
            (name, value))
    else:
        con.execute(
            "INSERT OR REPLACE INTO secrets(name,value) VALUES(?,?)",
            (name, value))


def _vapid_load(con=None):
    with _vapid_lock:
        if _vapid["priv"] and _vapid["pub"]:
            return _vapid["priv"], _vapid["pub"]
        if con is None:
            return "", ""
        row = con.execute(
            "SELECT value FROM secrets WHERE name='vapid_private'").fetchone()
        pub = con.execute(
            "SELECT value FROM secrets WHERE name='vapid_public'").fetchone()
        priv_s = (row["value"] if row else "") or ""
        pub_s = (pub["value"] if pub else "") or ""
        if not priv_s or not pub_s:
            priv_s, pub_s = _vapid_generate()
            _secret_set(con, "vapid_private", priv_s)
            _secret_set(con, "vapid_public", pub_s)
        _vapid["priv"], _vapid["pub"] = priv_s, pub_s
        return priv_s, pub_s


def _notif_open_url(kind, payload):
    payload = payload if isinstance(payload, dict) else {}
    h = str(payload.get("handle") or "").strip()
    if kind == "chat" and h:
        return "/friends/" + h
    if kind == "like":
        return "/market"
    return "/friends"


def _webpush_fanout(user_id, title, body, extra):
    if not webpush:
        return
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return
    extra = extra if isinstance(extra, dict) else {}
    subs = []
    priv = ""
    try:
        with _db_lock, db() as con:
            priv, _pub = _vapid_load(con)
            rows = con.execute(
                "SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id=?",
                (uid,)).fetchall()
            subs = [(r["endpoint"], r["p256dh"], r["auth"]) for r in rows]
    except Exception as e:
        print(f"webpush subs: {e}", flush=True)
        return
    if not priv or not subs:
        return
    if len(priv) % 4:
        priv = priv + ("=" * ((4 - len(priv) % 4) % 4))
    payload = json.dumps({
        "title": title or "Muse",
        "body": body or "",
        "tag": extra.get("tag") or "muse",
        "url": extra.get("url") or "/friends",
        "kind": extra.get("kind") or "",
        "handle": extra.get("handle") or "",
    }, ensure_ascii=False)
    dead = []
    for endpoint, p256dh, auth in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": endpoint,
                    "keys": {"p256dh": p256dh, "auth": auth},
                },
                data=payload,
                vapid_private_key=priv,
                vapid_claims={"sub": "mailto:hello@getmuse.eu"},
                ttl=86400,
                timeout=12,
            )
        except WebPushException as e:
            status = 0
            try:
                status = int(getattr(getattr(e, "response", None), "status_code", 0) or 0)
            except Exception:
                status = 0
            if status in (404, 410, 403):
                dead.append(endpoint)
            else:
                print(f"webpush {status or 'err'}: {e}", flush=True)
        except Exception as e:
            print(f"webpush fail: {e}", flush=True)
    if not dead:
        return
    try:
        with _db_lock, db() as con:
            for ep in dead:
                con.execute("DELETE FROM push_subs WHERE endpoint=?", (ep,))
    except Exception:
        pass


def _push_notif(con, user_id, kind, from_u, title, body, payload=None):
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return
    fid = None
    if from_u and from_u.get("id") is not None:
        try:
            fid = int(from_u["id"])
        except (TypeError, ValueError):
            fid = None
    if fid is not None and fid == uid:
        return
    title = (title or "Muse")[:80]
    body = (body or "")[:200]
    payload = payload if isinstance(payload, dict) else {}
    blob = json.dumps(payload, ensure_ascii=False)
    now = time.time()
    con.execute(
        "INSERT INTO notifs(user_id,kind,from_id,title,body,payload,created,seen) "
        "VALUES(?,?,?,?,?,?,?,0)",
        (uid, kind, fid, title, body, blob, now))
    handle = str(payload.get("handle") or "")
    extra = {
        "kind": kind,
        "handle": handle,
        "tag": f"{kind}-{handle or fid or 'muse'}",
        "url": _notif_open_url(kind, payload),
    }
    try:
        _webpush_pool.submit(_webpush_fanout, uid, title, body, extra)
    except Exception:
        pass


def _ensure_pl_origin(con, pg=False):
    cols = [
        ("origin_id", "INTEGER"),
        ("origin_user_id", "INTEGER"),
        ("origin_name", "TEXT DEFAULT ''"),
        ("origin_cover", "TEXT DEFAULT ''"),
        ("origin_vids", "TEXT DEFAULT ''"),
    ]
    if pg:
        for name, typ in cols:
            con.execute(f"ALTER TABLE playlists ADD COLUMN IF NOT EXISTS {name} {typ}")
        return
    have = {r[1] for r in con.execute("PRAGMA table_info(playlists)")}
    for name, typ in cols:
        if name not in have:
            con.execute(f"ALTER TABLE playlists ADD COLUMN {name} {typ}")


def _pl_vids(con, pid):
    rows = con.execute(
        "SELECT video_id FROM playlist_items WHERE playlist_id=?", (pid,)).fetchall()
    return [r["video_id"] for r in rows if r["video_id"]]


def _cover_hash(con, pid, cover_fn=""):
    if DATABASE_URL:
        blob = con.execute(
            "SELECT data FROM covers WHERE playlist_id=?", (pid,)).fetchone()
        if blob and blob["data"]:
            return hashlib.sha256(bytes(blob["data"])).hexdigest()
        return ""
    fn = (cover_fn or "").strip()
    if not fn:
        return ""
    path = os.path.join(COVERS_DIR, fn)
    try:
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return ""


def _origin_need(con, pl):
    if not _ug(pl, "origin_id", None):
        return []
    need = []
    oname = (_ug(pl, "origin_name", "") or "").strip().lower()
    if (pl["name"] or "").strip().lower() == oname:
        need.append("name")
    oh = _ug(pl, "origin_cover", "") or ""
    ch = _cover_hash(con, pl["id"], _ug(pl, "cover", "") or "")
    if ch == (oh or ""):
        need.append("cover")
    try:
        orig = set(json.loads(_ug(pl, "origin_vids", "") or "[]"))
    except Exception:
        orig = set()
    cur = set(_pl_vids(con, pl["id"]))
    if not (cur - orig) or not (orig - cur):
        need.append("tracks")
    return need


def _dup_market_set(con, user_id, pid, vids):
    vset = set(vids)
    if len(vset) < 6:
        return False
    rows = con.execute(
        "SELECT playlist_id, user_id FROM market_listings WHERE playlist_id<>?",
        (pid,)).fetchall()
    uid = int(user_id)
    for r in rows:
        if int(r["user_id"]) == uid:
            continue
        if set(_pl_vids(con, r["playlist_id"])) == vset:
            return True
    return False


def init_db():
    global _pg_pool
    os.makedirs(COVERS_DIR, exist_ok=True)
    os.makedirs(CHAT_DIR, exist_ok=True)
    if DATABASE_URL:
        from psycopg_pool import ConnectionPool
        # prepare_threshold=None: Supabase's pooler can't hold prepared statements.
        _pg_pool = ConnectionPool(DATABASE_URL, min_size=2, max_size=10, open=True,
                                  kwargs={"prepare_threshold": None})
        with _pg_pool.connection() as con:
            con.execute(PG_SCHEMA)
            try:
                con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT DEFAULT ''")
            except Exception:
                pass
            try:
                con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT")
                con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS handle_at DOUBLE PRECISION")
                con.execute(
                    "CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower "
                    "ON users (LOWER(handle)) WHERE handle IS NOT NULL AND handle <> ''")
            except Exception as e:
                print(f"handle migrate: {e}", flush=True)
            try:
                con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen DOUBLE PRECISION")
                con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS now_playing TEXT DEFAULT ''")
            except Exception as e:
                print(f"last_seen migrate: {e}", flush=True)
            try:
                _ensure_privacy_cols(con, True)
            except Exception as e:
                print(f"privacy migrate: {e}", flush=True)
            try:
                _ensure_social(con, True)
            except Exception as e:
                print(f"social schema: {e}", flush=True)
            try:
                _ensure_pl_origin(con, True)
            except Exception as e:
                print(f"playlist origin: {e}", flush=True)
            row = con.execute("SELECT value FROM secrets WHERE name='ytdlp_cookies'").fetchone()
        try:
            with db() as bcon:
                _backfill_handles(bcon)
        except Exception as e:
            print(f"handle backfill: {e}", flush=True)
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
        CREATE TABLE IF NOT EXISTS reco(
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          ts REAL NOT NULL, data TEXT NOT NULL);
        """)
        # Backfill columns for DBs created by older versions.
        cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
        for name, ddl in (("display", "TEXT DEFAULT ''"), ("accent", "TEXT DEFAULT '#1ed760'"),
                          ("hue", "INTEGER DEFAULT 145"), ("avatar", "TEXT DEFAULT ''"),
                          ("handle", "TEXT"), ("handle_at", "REAL"),
                          ("last_seen", "REAL"),
                          ("now_playing", "TEXT DEFAULT ''"),
                          ("profile_hidden", "INTEGER DEFAULT 0"),
                          ("profile_anon", "INTEGER DEFAULT 0"),
                          ("hide_playlists", "INTEGER DEFAULT 0"),
                          ("hide_likes", "INTEGER DEFAULT 0"),
                          ("hide_badges", "INTEGER DEFAULT 0"),
                          ("hide_avatar", "INTEGER DEFAULT 0")):
            if name not in cols:
                con.execute(f"ALTER TABLE users ADD COLUMN {name} {ddl}")
        try:
            con.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS users_handle_uq "
                "ON users(handle) WHERE handle IS NOT NULL AND handle <> ''")
        except Exception:
            pass
        try:
            _backfill_handles(con)
        except Exception as e:
            print(f"handle backfill: {e}", flush=True)
        con.execute("""
            CREATE TABLE IF NOT EXISTS avatars(
              user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
              data BLOB NOT NULL, ctype TEXT NOT NULL)""")
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
        try:
            _ensure_social(con, False)
        except Exception as e:
            print(f"social schema: {e}", flush=True)
        try:
            _ensure_pl_origin(con, False)
        except Exception as e:
            print(f"playlist origin: {e}", flush=True)


COVERS_DIR = os.path.join(HERE, "covers")
CHAT_DIR = os.path.join(COVERS_DIR, "chat")
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


HANDLE_COOLDOWN = 30 * 86400
OWNER_HANDLES = frozenset({"void"})
OWNER_IDS = frozenset({3})
RESERVED_HANDLES = frozenset({
    "api", "android", "desktop", "static", "covers", "assets", "sw", "favicon",
    "index", "login", "signup", "admin", "muse", "musely", "www", "cdn", "auth",
    "me", "settings", "plugins", "profile", "app", "health", "audio", "search",
    "play", "liked", "home", "for-you", "foryou", "account", "u", "users",
    "badges", "p", "pc", "web", "mobile", "market", "friends", "marketplace",
    "more",
})


def _ug(r, k, default=None):
    try:
        v = r[k]
    except Exception:
        return default
    return default if v is None else v


_PRIV_COLS = (
    "profile_hidden", "profile_anon", "hide_playlists",
    "hide_likes", "hide_badges", "hide_avatar",
)


def _ensure_privacy_cols(con, pg=False):
    if pg:
        for name in _PRIV_COLS:
            con.execute(
                f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} INTEGER DEFAULT 0")
        return
    cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
    for name in _PRIV_COLS:
        if name not in cols:
            con.execute(f"ALTER TABLE users ADD COLUMN {name} INTEGER DEFAULT 0")


def _profile_privacy(u):
    def bit(name):
        try:
            return 1 if int(_ug(u, name, 0) or 0) else 0
        except (TypeError, ValueError):
            return 0
    return {
        "hidden": bit("profile_hidden"),
        "anon": bit("profile_anon"),
        "playlists": bit("hide_playlists"),
        "likes": bit("hide_likes"),
        "badges": bit("hide_badges"),
        "avatar": bit("hide_avatar"),
    }


def _mask_public_user(pub, flags):
    if not pub or not flags:
        return pub
    if flags.get("hidden") or flags.get("anon"):
        pub["display"] = "Аноним"
        pub["online"] = False
        pub["seen"] = 0
        pub["listening"] = ""
    if flags.get("hidden") or flags.get("avatar"):
        pub["avatar"] = ""
    return pub


def valid_handle(h):
    h = (h or "").strip().lower().lstrip("@")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.]{1,23}", h):
        return False
    if h in RESERVED_HANDLES or ".." in h:
        return False
    return True


def handle_taken(con, h, except_id=None):
    h = (h or "").strip().lower()
    if except_id is not None:
        return bool(con.execute(
            "SELECT 1 FROM users WHERE LOWER(handle)=? AND id<>?",
            (h, except_id)).fetchone())
    return bool(con.execute(
        "SELECT 1 FROM users WHERE LOWER(handle)=?", (h,)).fetchone())


def unique_handle(con, want, except_id=None):
    base = re.sub(r"[^a-z0-9_.]", "", (want or "").lower())[:18] or "user"
    if not base[0].isalnum():
        base = "u" + base
    n = 0
    while n < 80:
        h = (base if n == 0 else f"{base}{n}")[:24]
        if valid_handle(h) and not handle_taken(con, h, except_id):
            return h
        n += 1
    return f"u{except_id or int(time.time())}"[:24]


def handle_wait(r):
    t = float(_ug(r, "handle_at", 0) or 0)
    if t <= 0:
        return 0
    left = HANDLE_COOLDOWN - (time.time() - t)
    return max(0, int(left))


def _backfill_handles(con):
    try:
        rows = con.execute("SELECT id, username, handle FROM users").fetchall()
    except Exception:
        return
    taken = set()
    for r in rows:
        h = (_ug(r, "handle", "") or "").strip().lower()
        if h:
            taken.add(h)
    for r in rows:
        if (_ug(r, "handle", "") or "").strip():
            continue
        h = unique_handle(con, _ug(r, "username", "") or f"u{r['id']}", r["id"])
        con.execute("UPDATE users SET handle=? WHERE id=?", (h, r["id"]))


BADGE_CATALOG = [
    {"id": "owner", "tier": "legendary", "name": "Владелец",
     "desc": "Сделал Muse."},
    {"id": "dev", "tier": "legendary", "name": "Разработчик",
     "desc": "Пишет код Muse."},
    {"id": "founder", "tier": "legendary", "name": "Основатель",
     "desc": "Запустил Muse с нуля."},
    {"id": "mythic", "tier": "legendary", "name": "Миф",
     "desc": "Знак команды Muse."},
    {"id": "omega", "tier": "legendary", "name": "Омега",
     "desc": "Высший знак Muse."},
    {"id": "early", "tier": "special", "name": "Ранний",
     "desc": "Зарегистрировался в самом начале."},
    {"id": "h1", "tier": "special", "name": "1 час",
     "desc": "Прослушал музыку 1 час."},
    {"id": "h5", "tier": "special", "name": "5 часов",
     "desc": "Прослушал музыку 5 часов."},
    {"id": "h10", "tier": "special", "name": "10 часов",
     "desc": "Прослушал музыку 10 часов."},
    {"id": "h50", "tier": "special", "name": "50 часов",
     "desc": "Прослушал музыку 50 часов."},
    {"id": "h100", "tier": "special", "name": "100 часов",
     "desc": "Прослушал музыку 100 часов."},
    {"id": "vinyl", "tier": "special", "name": "Винил",
     "desc": "Прослушал музыку 25 часов."},
    {"id": "first", "tier": "special", "name": "Первая песня",
     "desc": "Включил первую песню."},
    {"id": "songs10", "tier": "special", "name": "10 треков",
     "desc": "Послушал 10 разных песен."},
    {"id": "songs50", "tier": "special", "name": "50 треков",
     "desc": "Послушал 50 разных песен."},
    {"id": "songs100", "tier": "special", "name": "100 треков",
     "desc": "Послушал 100 разных песен."},
    {"id": "like", "tier": "special", "name": "Сердце",
     "desc": "Поставил лайк на песню."},
    {"id": "likes10", "tier": "special", "name": "10 лайков",
     "desc": "Поставил 10 лайков."},
    {"id": "likes50", "tier": "special", "name": "50 лайков",
     "desc": "Поставил 50 лайков."},
    {"id": "plays10", "tier": "special", "name": "10 прослушиваний",
     "desc": "Включил музыку 10 раз."},
    {"id": "plays100", "tier": "special", "name": "100 прослушиваний",
     "desc": "Включил музыку 100 раз."},
    {"id": "plays500", "tier": "special", "name": "500 прослушиваний",
     "desc": "Включил музыку 500 раз."},
    {"id": "fire", "tier": "special", "name": "В огне",
     "desc": "Включил музыку 20 раз."},
    {"id": "curator", "tier": "special", "name": "Куратор",
     "desc": "Создал плейлист."},
    {"id": "collector", "tier": "special", "name": "Коллекционер",
     "desc": "Создал 5 плейлистов."},
    {"id": "week", "tier": "special", "name": "Неделя",
     "desc": "В Muse уже неделю."},
    {"id": "month", "tier": "special", "name": "Месяц",
     "desc": "В Muse уже месяц."},
    {"id": "pioneer", "tier": "special", "name": "Пионер",
     "desc": "Один из первых пользователей."},
    {"id": "night", "tier": "special", "name": "Ночная сова",
     "desc": "Слушает музыку ночью."},
]


EARLY_UID_MAX = 21
PIONEER_UID_MAX = 24
_SPA_PATH = re.compile(
    r"^/(?:pc|web|mobile/iphone|mobile/android|market|friends(?:/[A-Za-z0-9_.-]{2,24})?|home|liked"
    r"|@[A-Za-z0-9_.-]{2,24}|p/[^/]+(?:/[^/]+)?)?/?$"
)


def _playlist_slug(name):
    s = re.sub(r"[\s_]+", "-", (name or "").strip().lower())
    s = re.sub(r"[^\w.\-]+", "", s, flags=re.UNICODE)
    s = re.sub(r"-{2,}", "-", s).strip("-.")[:48]
    return s or "playlist"


def _assign_slugs(rows):
    used, out = set(), {}
    for r in rows:
        pid = int(r["id"])
        base = _playlist_slug(r["name"])
        slug, n = base, 2
        while slug.lower() in used:
            slug = f"{base}-{pid}"
            if slug.lower() in used:
                slug = f"{base}-{n}"
                n += 1
        used.add(slug.lower())
        out[pid] = slug
    return out


def public_playlist(handle, slug, viewer_id=None):
    h = (handle or "").strip().lower().lstrip("@")
    want = urllib.parse.unquote(slug or "").strip()
    if not h or not want:
        return None
    with _db_lock, db() as con:
        u = con.execute("SELECT * FROM users WHERE LOWER(handle)=?", (h,)).fetchone()
        if not u:
            return None
        uid = u["id"]
        rows = con.execute(
            "SELECT id, name, cover FROM playlists WHERE user_id=? ORDER BY id",
            (uid,)).fetchall()
        slugs = _assign_slugs(rows)
        pl = None
        got = want
        if re.fullmatch(r"\d+", want):
            pl = next((r for r in rows if str(r["id"]) == want), None)
            if pl:
                got = slugs[pl["id"]]
        if not pl:
            want_l = want.lower()
            for r in rows:
                if slugs[r["id"]].lower() == want_l:
                    pl = r
                    got = slugs[r["id"]]
                    break
        if not pl:
            return None
        flags = _profile_privacy(u)
        is_owner = viewer_id is not None and int(viewer_id) == int(uid)
        listed = con.execute(
            "SELECT 1 FROM market_listings WHERE playlist_id=?", (pl["id"],)).fetchone()
        if not is_owner and not listed and (flags["hidden"] or flags["playlists"]):
            return None
        items = con.execute(
            "SELECT id, video_id, title, thumb, duration FROM playlist_items "
            "WHERE playlist_id=? ORDER BY pos, id", (pl["id"],)).fetchall()
        av = "" if (not is_owner and (flags["hidden"] or flags["avatar"])) else (_ug(u, "avatar", "") or "")
        display = (_ug(u, "display", "") or u["username"])
        if not is_owner and (flags["hidden"] or flags["anon"]):
            display = "Аноним"
        first = items[0]["thumb"] if items else ""
        return {
            "owner": {
                "display": display,
                "handle": (_ug(u, "handle", "") or u["username"] or "").lower(),
                "hue": _ug(u, "hue", 145) if _ug(u, "hue", None) is not None else 145,
                "avatar": cover_url(av) if av else "",
            },
            "playlist": {
                "id": pl["id"],
                "name": pl["name"],
                "slug": got,
                "cover": first or "",
                "custom_cover": cover_url(pl["cover"] or ""),
                "count": len(items),
                "tracks": [{"item_id": t["id"], "id": t["video_id"],
                            "title": t["title"], "thumbnail": t["thumb"],
                            "duration": t["duration"]} for t in items],
            },
        }


def take_public_playlist(user_id, handle, slug):
    data = public_playlist(handle, slug, viewer_id=user_id)
    if not data:
        return None, "not found"
    src = data["playlist"]
    owner = data["owner"]
    with _db_lock, db() as con:
        mine = con.execute(
            "SELECT id FROM playlists WHERE id=? AND user_id=?",
            (src["id"], user_id)).fetchone()
        if mine:
            return {"id": src["id"], "name": src["name"], "slug": src["slug"],
                    "mine": True}, None
        names = {(r["name"] or "").strip().lower() for r in con.execute(
            "SELECT name FROM playlists WHERE user_id=?", (user_id,)).fetchall()}
        want = (src["name"] or "Playlist").strip()[:60] or "Playlist"
        if want.lower() in names:
            tagged = f"{want} from @{owner['handle']}"[:60]
            want = tagged if tagged.lower() not in names else None
            if not want:
                n = 2
                while f"{src['name']} {n}".lower() in names:
                    n += 1
                want = f"{src['name']} {n}"[:60]
        src_row = con.execute(
            "SELECT * FROM playlists WHERE id=?", (src["id"],)).fetchone()
        src_vids = [it["video_id"] for it in con.execute(
            "SELECT video_id FROM playlist_items WHERE playlist_id=? ORDER BY pos, id",
            (src["id"],)).fetchall() if it["video_id"]]
        root_id = _ug(src_row, "origin_id", None) or src["id"]
        root_uid = _ug(src_row, "origin_user_id", None) or owner.get("id")
        origin_cover = _cover_hash(con, src["id"], _ug(src_row, "cover", "") or "")
        cur = con.execute(
            "INSERT INTO playlists(user_id,name,created,origin_id,origin_user_id,"
            "origin_name,origin_cover,origin_vids) VALUES(?,?,?,?,?,?,?,?)",
            (user_id, want, time.time(), int(root_id),
             int(root_uid) if root_uid else None,
             want[:60], origin_cover,
             json.dumps(src_vids, separators=(",", ":"))))
        new_id = cur.lastrowid
        items = con.execute(
            "SELECT video_id, title, thumb, duration, pos FROM playlist_items "
            "WHERE playlist_id=? ORDER BY pos, id", (src["id"],)).fetchall()
        for it in items:
            con.execute(
                "INSERT INTO playlist_items(playlist_id,video_id,title,thumb,duration,pos) "
                "VALUES(?,?,?,?,?,?)",
                (new_id, it["video_id"], it["title"], it["thumb"],
                 it["duration"], it["pos"]))
        src_cover = (src_row["cover"] if src_row else "") or ""
        if DATABASE_URL:
            blob = con.execute(
                "SELECT data, ctype FROM covers WHERE playlist_id=?",
                (src["id"],)).fetchone()
            if blob:
                con.execute(
                    "INSERT INTO covers(playlist_id,data,ctype) VALUES(?,?,?) "
                    "ON CONFLICT(playlist_id) DO UPDATE SET data=excluded.data,"
                    " ctype=excluded.ctype",
                    (new_id, blob["data"], blob["ctype"]))
                ext = ".png" if "png" in (blob["ctype"] or "") else ".jpg"
                fn = f"{new_id}-{int(time.time())}{ext}"
                con.execute("UPDATE playlists SET cover=? WHERE id=?", (fn, new_id))
        elif src_cover:
            src_path = os.path.join(COVERS_DIR, src_cover)
            ext = os.path.splitext(src_cover)[1] or ".jpg"
            fn = f"{new_id}{ext}"
            try:
                if os.path.isfile(src_path):
                    os.makedirs(COVERS_DIR, exist_ok=True)
                    shutil.copyfile(src_path, os.path.join(COVERS_DIR, fn))
                    con.execute("UPDATE playlists SET cover=? WHERE id=?", (fn, new_id))
            except OSError:
                pass
        slugs = _assign_slugs(con.execute(
            "SELECT id, name FROM playlists WHERE user_id=? ORDER BY id",
            (user_id,)).fetchall())
    return {"id": new_id, "name": want, "slug": slugs.get(new_id, _playlist_slug(want)),
            "mine": False}, None


def _pair(a, b):
    a, b = int(a), int(b)
    return (a, b) if a < b else (b, a)


def _handle_user(con, handle):
    h = (handle or "").strip().lower().lstrip("@")
    if not h:
        return None
    return con.execute("SELECT * FROM users WHERE LOWER(handle)=?", (h,)).fetchone()


_ONLINE_SEC = 45
_presence_seq = {}


def _is_online(ts):
    try:
        seen = float(ts or 0)
    except (TypeError, ValueError):
        return False
    if seen <= 0:
        return False
    ago = time.time() - seen
    return 0 <= ago < _ONLINE_SEC


def _set_presence(con, uid, listening="", away=False, seq=0):
    """Only an explicit heartbeat from a visible page counts as online.

    Any authenticated request used to bump last_seen. A push waking a
    background tab, or the sender's own request, then showed the other
    person as online.
    """
    try:
        uid = int(uid)
    except (TypeError, ValueError):
        return
    try:
        seq = int(seq or 0)
    except (TypeError, ValueError):
        seq = 0
    if seq and seq < _presence_seq.get(uid, 0):
        return
    if seq:
        _presence_seq[uid] = seq
    try:
        if away:
            con.execute(
                "UPDATE users SET last_seen=0, now_playing='' WHERE id=?", (uid,))
            return
        title = (listening or "").strip()[:80]
        con.execute(
            "UPDATE users SET last_seen=?, now_playing=? WHERE id=?",
            (time.time(), title, uid))
    except Exception:
        pass


def _pub_user(r, live=False):
    av = _ug(r, "avatar", "") or ""
    seen = float(_ug(r, "last_seen", 0) or 0) if live else 0
    online = _is_online(seen) if live else False
    listening = ""
    if online:
        listening = (_ug(r, "now_playing", "") or "").strip()[:80]
    return {
        "id": int(r["id"]),
        "display": (_ug(r, "display", "") or r["username"]),
        "handle": (_ug(r, "handle", "") or r["username"] or "").lower(),
        "hue": _ug(r, "hue", 145) if _ug(r, "hue", None) is not None else 145,
        "avatar": cover_url(av) if av else "",
        "online": online,
        "seen": seen if live else 0,
        "listening": listening,
    }


def _friend_presence(con, uid):
    out = {}
    try:
        rows = con.execute("SELECT a, b FROM friends WHERE a=? OR b=?", (uid, uid)).fetchall()
    except Exception:
        return out
    ids = []
    for r in rows:
        ids.append(int(r["b"] if int(r["a"]) == uid else r["a"]))
    if not ids:
        return out
    q = ",".join("?" * len(ids))
    try:
        people = con.execute(f"SELECT * FROM users WHERE id IN ({q})", ids).fetchall()
    except Exception:
        return out
    for ou in people:
        pub = _pub_user(ou, live=True)
        h = pub.get("handle") or ""
        if h:
            out[h] = {
                "online": pub["online"],
                "seen": pub["seen"],
                "listening": pub.get("listening") or "",
            }
    return out


CHAT_KINDS = frozenset({
    "text", "song", "playlist", "profile",
    "voice", "audio", "video", "round", "gif", "image",
})
CHAT_REACTS = frozenset({"❤️", "🔥", "👍", "😂", "😮", "😢", "🎉"})
CHAT_FILE_KINDS = frozenset({"voice", "audio", "video", "round", "gif", "image"})
CHAT_MAX = {
    "voice": 8_000_000,
    "audio": 16_000_000,
    "video": 40_000_000,
    "round": 24_000_000,
    "gif": 8_000_000,
    "image": 8_000_000,
}
_GIF_HOSTS = (
    "tenor.com", "c.tenor.com", "media.tenor.com",
    "media.tenor.co", "giphy.com", "i.giphy.com", "media.giphy.com",
)
_chat_typing = {}
_chat_typing_lock = threading.Lock()


def _ensure_chat_extra(con, pg=False):
    pk = "SERIAL PRIMARY KEY" if pg else "INTEGER PRIMARY KEY"
    num = "DOUBLE PRECISION" if pg else "REAL"
    cols = [
        ("reply_to", "INTEGER"),
        ("edited", "INTEGER DEFAULT 0"),
        ("deleted", "INTEGER DEFAULT 0"),
        ("edited_at", num),
        ("updated", num),
    ]
    if pg:
        for name, typ in cols:
            con.execute(f"ALTER TABLE chat_msgs ADD COLUMN IF NOT EXISTS {name} {typ}")
        con.execute(
            """CREATE TABLE IF NOT EXISTS chat_reads(
              lo INTEGER NOT NULL, hi INTEGER NOT NULL,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              last_id INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (lo, hi, user_id))""")
        con.execute(
            f"""CREATE TABLE IF NOT EXISTS chat_files(
              id {pk},
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              kind TEXT NOT NULL,
              key TEXT UNIQUE NOT NULL,
              name TEXT DEFAULT '',
              ctype TEXT NOT NULL,
              size INTEGER NOT NULL,
              duration {num},
              created {num})""")
        con.execute(
            f"""CREATE TABLE IF NOT EXISTS chat_reacts(
              msg_id INTEGER NOT NULL,
              user_id INTEGER NOT NULL,
              emoji TEXT NOT NULL,
              created {num},
              PRIMARY KEY (msg_id, user_id))""")
        con.execute("CREATE INDEX IF NOT EXISTS idx_chat_reacts_msg ON chat_reacts(msg_id)")
        return
    have = {r[1] for r in con.execute("PRAGMA table_info(chat_msgs)")}
    for name, typ in cols:
        if name not in have:
            con.execute(f"ALTER TABLE chat_msgs ADD COLUMN {name} {typ}")
    con.execute(
        """CREATE TABLE IF NOT EXISTS chat_reads(
          lo INTEGER NOT NULL, hi INTEGER NOT NULL,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          last_id INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (lo, hi, user_id))""")
    con.execute(
        f"""CREATE TABLE IF NOT EXISTS chat_files(
          id {pk},
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          key TEXT UNIQUE NOT NULL,
          name TEXT DEFAULT '',
          ctype TEXT NOT NULL,
          size INTEGER NOT NULL,
          duration {num},
          created {num})""")
    con.execute(
        f"""CREATE TABLE IF NOT EXISTS chat_reacts(
          msg_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          emoji TEXT NOT NULL,
          created {num},
          PRIMARY KEY (msg_id, user_id))""")
    con.execute("CREATE INDEX IF NOT EXISTS idx_chat_reacts_msg ON chat_reacts(msg_id)")


def _run_ffmpeg(args, timeout=90):
    try:
        r = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
            capture_output=True, timeout=timeout, check=False,
        )
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


_HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"heif"}


def _chat_normalize(full, kind, ext, ctype):
    """H.264 / AAC / JPEG so iPhone actually plays chat media."""
    if not full or not os.path.isfile(full):
        return full, ext, ctype
    base = full.rsplit(".", 1)[0]

    def take(out, new_ext, new_ctype):
        if not os.path.isfile(out) or os.path.getsize(out) < 64:
            return None
        if os.path.abspath(out) != os.path.abspath(full):
            try:
                os.remove(full)
            except OSError:
                pass
        return out, new_ext, new_ctype

    if kind in ("video", "round"):
        out = base + ".mp4"
        vf = ("crop=min(iw\\,ih):min(iw\\,ih),scale=480:480"
              if kind == "round"
              else "scale=trunc(iw/2)*2:trunc(ih/2)*2")
        args = ["-i", full, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "96k",
                "-movflags", "+faststart"]
        if kind == "round":
            args += ["-t", "60"]
        args.append(out)
        if _run_ffmpeg(args):
            hit = take(out, ".mp4", "video/mp4")
            if hit:
                return hit
        args2 = ["-i", full, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p",
                 "-preset", "veryfast", "-crf", "23", "-an", "-movflags", "+faststart", out]
        if _run_ffmpeg(args2):
            hit = take(out, ".mp4", "video/mp4")
            if hit:
                return hit
        if _run_ffmpeg(["-i", full, "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "96k",
                        "-movflags", "+faststart", out]):
            hit = take(out, ".mp4", "video/mp4")
            if hit:
                return hit
    elif kind in ("voice", "audio"):
        out = base + ".m4a"
        if _run_ffmpeg(["-i", full, "-c:a", "aac", "-b:a", "64k", "-ac", "1", out]):
            hit = take(out, ".m4a", "audio/mp4")
            if hit:
                return hit
    elif kind == "image" and (
            ext in (".heic", ".heif") or "heic" in (ctype or "") or "heif" in (ctype or "")):
        out = base + ".jpg"
        if _run_ffmpeg(["-i", full, "-q:v", "3", out]):
            hit = take(out, ".jpg", "image/jpeg")
            if hit:
                return hit
    return full, ext, ctype


def _media_sniff(data, kind=""):
    if not data or len(data) < 12:
        return None, None
    if data[:4] == b"\x1a\x45\xdf\xa3":
        mime = "audio/webm" if kind in ("voice", "audio") else "video/webm"
        return ".webm", mime
    ftyp_at = data.find(b"ftyp", 0, 64)
    if ftyp_at >= 4:
        brand = bytes(data[ftyp_at + 4:ftyp_at + 8])
        if brand.lower() in _HEIC_BRANDS:
            return ".heic", "image/heic"
        audio_brand = brand in (b"M4A ", b"M4B ", b"M4P ")
        if kind in ("voice", "audio") or audio_brand:
            return ".m4a", "audio/mp4"
        return ".mp4", "video/mp4"
    if data[4:8] == b"mdat" or data[4:8] == b"moov" or data[4:8] == b"wide":
        if kind in ("voice", "audio"):
            return ".m4a", "audio/mp4"
        return ".mov", "video/quicktime"
    if data[:4] == b"OggS":
        return ".ogg", "audio/ogg"
    if data[:3] == b"ID3" or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return ".mp3", "audio/mpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return ".wav", "audio/wav"
    if data[:4] == b"fLaC":
        return ".flac", "audio/flac"
    return cover_info(data)


def _gif_ok(url):
    try:
        p = urllib.parse.urlparse(url or "")
    except Exception:
        return False
    if p.scheme not in ("https", "http") or not p.netloc:
        return False
    host = p.netloc.lower()
    return any(host == h or host.endswith("." + h) for h in _GIF_HOSTS)


def _set_typing(lo, hi, uid):
    with _chat_typing_lock:
        _chat_typing[(int(lo), int(hi), int(uid))] = time.time()


def _peer_typing(lo, hi, uid):
    key = (int(lo), int(hi), int(uid))
    with _chat_typing_lock:
        ts = _chat_typing.get(key, 0)
    return (time.time() - ts) < 3.4


def _chat_payload(r):
    try:
        p = json.loads(r["payload"] or "{}")
    except Exception:
        p = {}
    return p if isinstance(p, dict) else {}


def _reply_snip(con, rid):
    try:
        rid = int(rid or 0)
    except (TypeError, ValueError):
        return None
    if rid <= 0:
        return None
    r = con.execute("SELECT id, kind, body, payload, deleted FROM chat_msgs WHERE id=?",
                    (rid,)).fetchone()
    if not r:
        return None
    deleted = bool(int(_ug(r, "deleted", 0) or 0))
    body = "" if deleted else (r["body"] or "")
    kind = "deleted" if deleted else (r["kind"] or "text")
    payload = {} if deleted else _chat_payload(r)
    return {"id": int(r["id"]), "kind": kind, "body": body[:140], "payload": payload,
            "deleted": deleted}


def _pack_reacts(con, mid, uid):
    try:
        rows = con.execute(
            "SELECT emoji, COUNT(*) AS n, "
            "MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS mine "
            "FROM chat_reacts WHERE msg_id=? GROUP BY emoji "
            "ORDER BY n DESC, emoji",
            (int(uid), int(mid))).fetchall()
    except Exception:
        return []
    out = []
    for row in rows:
        e = row["emoji"] if hasattr(row, "keys") else row[0]
        if e not in CHAT_REACTS:
            continue
        n = int(_ug(row, "n", 0) or 0)
        if n <= 0:
            continue
        out.append({
            "e": e,
            "n": n,
            "mine": bool(int(_ug(row, "mine", 0) or 0)),
        })
    return out


def _pack_msg(con, r, uid, peer_read=0):
    mid = int(r["id"])
    mine = int(r["sender_id"]) == int(uid)
    deleted = bool(int(_ug(r, "deleted", 0) or 0))
    kind = "deleted" if deleted else (r["kind"] or "text")
    body = "" if deleted else (r["body"] or "")
    payload = {} if deleted else _chat_payload(r)
    reply = None if deleted else _reply_snip(con, _ug(r, "reply_to", 0))
    return {
        "id": mid,
        "mine": mine,
        "kind": kind,
        "body": body,
        "payload": payload,
        "created": r["created"] or 0,
        "reply": reply,
        "edited": bool(int(_ug(r, "edited", 0) or 0)) and not deleted,
        "deleted": deleted,
        "read": bool(mine and mid <= int(peer_read or 0)),
        "updated": _ug(r, "updated", None) or r["created"] or 0,
        "reacts": [] if deleted else _pack_reacts(con, mid, uid),
    }


def _mark_chat_read(con, lo, hi, uid, last_id):
    try:
        last_id = int(last_id or 0)
    except (TypeError, ValueError):
        return
    if last_id <= 0:
        return
    row = con.execute(
        "SELECT last_id FROM chat_reads WHERE lo=? AND hi=? AND user_id=?",
        (lo, hi, uid)).fetchone()
    if not row:
        con.execute(
            "INSERT INTO chat_reads(lo,hi,user_id,last_id) VALUES(?,?,?,?)",
            (lo, hi, uid, last_id))
        return
    if int(row["last_id"] or 0) < last_id:
        con.execute(
            "UPDATE chat_reads SET last_id=? WHERE lo=? AND hi=? AND user_id=?",
            (last_id, lo, hi, uid))


def _peer_read_id(con, lo, hi, peer_id):
    row = con.execute(
        "SELECT last_id FROM chat_reads WHERE lo=? AND hi=? AND user_id=?",
        (lo, hi, peer_id)).fetchone()
    return int(row["last_id"] or 0) if row else 0


def _chat_file_url(key):
    return f"/api/chat/file/{key}" if key else ""


def _load_chat_file(con, key):
    key = re.sub(r"[^a-zA-Z0-9]", "", key or "")[:40]
    if not key:
        return None
    return con.execute("SELECT * FROM chat_files WHERE key=?", (key,)).fetchone()


def _can_see_file(con, row, uid):
    if int(row["user_id"]) == int(uid):
        return True
    return bool(con.execute(
        "SELECT 1 FROM chat_msgs WHERE payload LIKE ? AND (lo=? OR hi=?)",
        (f'%"file": "{row["key"]}"%', uid, uid)).fetchone())


def _file_payload(con, uid, kind, payload):
    key = str((payload or {}).get("file") or "").strip()
    row = _load_chat_file(con, key)
    if not row or int(row["user_id"]) != int(uid):
        return None
    if row["kind"] != kind and not (kind == "gif" and row["kind"] in ("gif", "image", "video")):
        return None
    return {
        "file": row["key"],
        "url": _chat_file_url(row["key"]),
        "ctype": row["ctype"],
        "duration": _ug(row, "duration", None),
    }


CHAT_PREVIEW = {
    "song": "отправил трек",
    "playlist": "отправил плейлист",
    "profile": "отправил профиль",
    "voice": "голосовое сообщение",
    "audio": "аудио",
    "video": "видео",
    "round": "видеосообщение",
    "gif": "GIF",
    "image": "фото",
}


def friend_status(con, me_id, other_id):
    me_id, other_id = int(me_id), int(other_id)
    if me_id == other_id:
        return "self"
    lo, hi = _pair(me_id, other_id)
    if con.execute("SELECT 1 FROM friends WHERE a=? AND b=?", (lo, hi)).fetchone():
        return "friends"
    if con.execute("SELECT 1 FROM friend_reqs WHERE from_id=? AND to_id=?",
                   (me_id, other_id)).fetchone():
        return "outgoing"
    if con.execute("SELECT 1 FROM friend_reqs WHERE from_id=? AND to_id=?",
                   (other_id, me_id)).fetchone():
        return "incoming"
    return "none"


def _listing_card(con, pid, me_id=None):
    pl = con.execute("SELECT * FROM playlists WHERE id=?", (pid,)).fetchone()
    listed = con.execute(
        "SELECT user_id, created FROM market_listings WHERE playlist_id=?",
        (pid,)).fetchone()
    if not pl or not listed:
        return None
    owner = con.execute("SELECT * FROM users WHERE id=?", (listed["user_id"],)).fetchone()
    if not owner:
        return None
    owner_pub = _mask_public_user(_pub_user(owner), _profile_privacy(owner))
    n = int(con.execute(
        "SELECT COUNT(*) c FROM playlist_items WHERE playlist_id=?",
        (pid,)).fetchone()["c"] or 0)
    likes = int(con.execute(
        "SELECT COUNT(*) c FROM market_likes WHERE playlist_id=?",
        (pid,)).fetchone()["c"] or 0)
    thumb = con.execute(
        "SELECT thumb FROM playlist_items WHERE playlist_id=? ORDER BY pos LIMIT 1",
        (pid,)).fetchone()
    slugs = _assign_slugs(con.execute(
        "SELECT id, name FROM playlists WHERE user_id=? ORDER BY id",
        (listed["user_id"],)).fetchall())
    liked = False
    if me_id:
        liked = bool(con.execute(
            "SELECT 1 FROM market_likes WHERE user_id=? AND playlist_id=?",
            (me_id, pid)).fetchone())
    return {
        "id": pid,
        "name": pl["name"],
        "slug": slugs.get(pid, _playlist_slug(pl["name"])),
        "count": n,
        "likes": likes,
        "liked": liked,
        "cover": (thumb["thumb"] if thumb else "") or "",
        "custom_cover": cover_url(pl["cover"] or ""),
        "created": listed["created"] or 0,
        "owner": owner_pub,
        "mine": bool(me_id and int(me_id) == int(listed["user_id"])),
    }


def market_feed(me_id=None):
    with _db_lock, db() as con:
        rows = con.execute(
            "SELECT playlist_id FROM market_listings").fetchall()
        cards = []
        for r in rows:
            c = _listing_card(con, r["playlist_id"], me_id)
            if c:
                cards.append(c)
        cards.sort(key=lambda x: (-int(x["likes"]), -float(x["created"] or 0)))
        top = cards[:3]
        rest_ids = {c["id"] for c in top}
        rest = [c for c in cards if c["id"] not in rest_ids]
        mine = [c["id"] for c in cards if c.get("mine")]
    return {"top": top, "listings": rest, "all": cards, "mine": mine}


def profile_badges(u, st):
    handle = (_ug(u, "handle", "") or _ug(u, "username", "") or "").strip().lower()
    uid = int(u["id"])
    is_owner = handle in OWNER_HANDLES or uid in OWNER_IDS
    hours = float(st.get("hours") or 0)
    songs = int(st.get("songs") or 0)
    plays = int(st.get("plays") or 0)
    likes = int(st.get("likes") or 0)
    pls = int(st.get("playlists") or 0)
    created = float(st.get("created") or 0) or 0
    age = time.time() - created if created else 0
    earned = {
        "early": uid <= EARLY_UID_MAX,
        "h1": hours >= 1,
        "h5": hours >= 5,
        "h10": hours >= 10,
        "h50": hours >= 50,
        "h100": hours >= 100,
        "vinyl": hours >= 25,
        "first": songs >= 1 or plays >= 1,
        "songs10": songs >= 10,
        "songs50": songs >= 50,
        "songs100": songs >= 100,
        "like": likes >= 1,
        "likes10": likes >= 10,
        "likes50": likes >= 50,
        "plays10": plays >= 10,
        "plays100": plays >= 100,
        "plays500": plays >= 500,
        "fire": plays >= 20,
        "curator": pls >= 1,
        "collector": pls >= 5,
        "week": age >= 7 * 86400,
        "month": age >= 30 * 86400,
        "pioneer": uid <= PIONEER_UID_MAX,
        "night": bool(st.get("night")),
    }
    out = []
    for b in BADGE_CATALOG:
        if b["tier"] == "legendary":
            if is_owner:
                out.append(dict(b))
            continue
        if earned.get(b["id"]):
            out.append(dict(b))
    return out


def public_profile(handle):
    h = (handle or "").strip().lower().lstrip("@")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.]{1,23}", h or ""):
        return None
    with _db_lock, db() as con:
        u = con.execute(
            "SELECT * FROM users WHERE LOWER(handle)=?", (h,)).fetchone()
        if not u:
            return None
        uid = u["id"]
        if DATABASE_URL:
            sec_sql = (
                "SELECT COALESCE(SUM(LEAST("
                "CASE WHEN completed=1 THEN COALESCE(NULLIF(duration,0), COALESCE(position,0), 0) "
                "ELSE COALESCE(position,0) END, "
                "COALESCE(NULLIF(duration,0), 86400))), 0) s FROM plays WHERE user_id=?"
            )
        else:
            sec_sql = (
                "SELECT COALESCE(SUM(MIN("
                "CASE WHEN completed=1 THEN COALESCE(NULLIF(duration,0), COALESCE(position,0), 0) "
                "ELSE COALESCE(position,0) END, "
                "COALESCE(NULLIF(duration,0), 86400))), 0) s FROM plays WHERE user_id=?"
            )
        secs = float(con.execute(sec_sql, (uid,)).fetchone()["s"] or 0)
        songs = int(con.execute(
            "SELECT COUNT(DISTINCT video_id) c FROM plays "
            "WHERE user_id=? AND (completed=1 OR COALESCE(position,0) >= 30)",
            (uid,)).fetchone()["c"] or 0)
        plays_n = int(con.execute(
            "SELECT COUNT(*) c FROM plays WHERE user_id=?", (uid,)).fetchone()["c"] or 0)
        likes_n = int(con.execute(
            "SELECT COUNT(*) c FROM likes WHERE user_id=?", (uid,)).fetchone()["c"] or 0)
        if DATABASE_URL:
            night_sql = (
                "SELECT COUNT(*) c FROM plays WHERE user_id=? AND ("
                "CAST(EXTRACT(HOUR FROM TO_TIMESTAMP(played_at)) AS int) <= 5 "
                "OR CAST(EXTRACT(HOUR FROM TO_TIMESTAMP(played_at)) AS int) >= 23)"
            )
        else:
            night_sql = (
                "SELECT COUNT(*) c FROM plays WHERE user_id=? AND ("
                "CAST(strftime('%H', played_at, 'unixepoch') AS INTEGER) <= 5 "
                "OR CAST(strftime('%H', played_at, 'unixepoch') AS INTEGER) >= 23)"
            )
        try:
            night_n = int(con.execute(night_sql, (uid,)).fetchone()["c"] or 0)
        except Exception:
            night_n = 0
        liked_rows = con.execute(
            "SELECT video_id, title, thumb, duration FROM likes "
            "WHERE user_id=? ORDER BY pos ASC", (uid,)).fetchall()
        pls = con.execute(
            "SELECT id, name, cover FROM playlists WHERE user_id=? ORDER BY id",
            (uid,)).fetchall()
        slug_map = _assign_slugs(pls)
        playlists = []
        for p in pls:
            n = con.execute(
                "SELECT COUNT(*) c FROM playlist_items WHERE playlist_id=?",
                (p["id"],)).fetchone()["c"]
            cover = con.execute(
                "SELECT thumb FROM playlist_items WHERE playlist_id=? "
                "ORDER BY pos LIMIT 1", (p["id"],)).fetchone()
            tracks = con.execute(
                "SELECT video_id, title, thumb, duration FROM playlist_items "
                "WHERE playlist_id=? ORDER BY pos, id LIMIT 12",
                (p["id"],)).fetchall()
            playlists.append({
                "id": p["id"],
                "name": p["name"],
                "slug": slug_map.get(p["id"], _playlist_slug(p["name"])),
                "count": n,
                "cover": (cover["thumb"] if cover else "") or "",
                "custom_cover": cover_url(p["cover"] or ""),
                "tracks": [{"id": t["video_id"], "title": t["title"],
                            "thumbnail": t["thumb"], "duration": t["duration"]}
                           for t in tracks],
            })
    likes = []
    seen_likes = set()
    for r in liked_rows:
        vid = r["video_id"]
        if not vid or vid in seen_likes:
            continue
        seen_likes.add(vid)
        likes.append({
            "id": vid,
            "title": r["title"] or vid,
            "thumbnail": r["thumb"] or "",
            "duration": r["duration"],
        })
    av = _ug(u, "avatar", "") or ""
    return {
        "user": {
            "display": (_ug(u, "display", "") or u["username"]),
            "handle": (_ug(u, "handle", "") or u["username"] or "").lower(),
            "hue": _ug(u, "hue", 145) if _ug(u, "hue", None) is not None else 145,
            "avatar": cover_url(av) if av else "",
            "created": _ug(u, "created", 0) or 0,
            "mine": False,
            "online": _is_online(_ug(u, "last_seen", 0) or 0),
            "seen": float(_ug(u, "last_seen", 0) or 0),
        },
        "stats": {
            "hours": round(secs / 3600.0, 2),
            "seconds": int(secs),
            "songs": songs,
            "plays": plays_n,
        },
        "badges": profile_badges(u, {
            "hours": secs / 3600.0,
            "songs": songs,
            "plays": plays_n,
            "likes": likes_n,
            "playlists": len(playlists),
            "created": _ug(u, "created", 0) or 0,
            "night": night_n > 0,
        }),
        "likes": likes,
        "playlists": playlists,
        "privacy": _profile_privacy(u),
    }


def valid_hex_color(c):
    return bool(re.fullmatch(r"#[0-9a-fA-F]{6}", c or ""))


def row_user(r):
    av = ""
    try:
        av = r["avatar"] or ""
    except Exception:
        av = ""
    handle = (_ug(r, "handle", "") or r["username"] or "").strip().lower()
    created = float(_ug(r, "created", 0) or 0)
    return {"id": r["id"], "username": r["username"],
            "display": r["display"] or r["username"],
            "accent": r["accent"] or "#1ed760",
            "hue": r["hue"] if r["hue"] is not None else 145,
            "avatar": cover_url(av) if av else "",
            "handle": handle,
            "handle_in": handle_wait(r),
            "created": created,
            "privacy": _profile_privacy(r)}


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
    "socket_timeout": 10,
    "retries": 2,
    # Audio comes from direct https formats; the HLS/DASH manifests are extra
    # round-trips to googlevideo that sometimes hang for the full timeout.
    "extractor_args": {"youtube": {"skip": ["hls", "dash"]},
                       "youtubepot-bgutilscript": {"server_home": ["/opt/bgutil/server"]}},
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

# Cookie-free Innertube clients. `web` is what throws "Sign in to confirm you're
# not a bot"; android_vr / visionos / web_embedded need no cookies and no PO token.
_ANON_CLIENTS = (
    ("ios", "android"),
    ("android_vr", "visionos", "web_embedded"),
)


def _ydl_opts(clients=None, cookies=False, **extra):
    opts = dict(BASE_YDL)
    if not cookies:
        opts.pop("cookiefile", None)
    ea = {}
    for k, v in (opts.get("extractor_args") or {}).items():
        ea[k] = dict(v) if isinstance(v, dict) else v
    yt = dict(ea.get("youtube") or {})
    if clients:
        yt["player_client"] = list(clients)
    # Skip the watch-page HTML: that is what returns "sign in to confirm you're
    # not a bot" on flagged IPs. Innertube player clients do not need it.
    skip_player = list(yt.get("player_skip") or [])
    for item in ("webpage", "configs"):
        if item not in skip_player:
            skip_player.append(item)
    yt["player_skip"] = skip_player
    ea["youtube"] = yt
    opts["extractor_args"] = ea
    opts.update(extra)
    return opts


def _yt_thumb(vid):
    # mqdefault is true 16:9. hqdefault is 4:3 with black bars AND the 16:9
    # album upload's colored side fill — that is what showed as "borders".
    return f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg"


_art_mem = {}
_ART_TTL = 6 * 3600


def yt_art_bytes(video_id):
    hit = _art_mem.get(video_id)
    if hit and time.time() - hit[0] < _ART_TTL:
        return hit[1]
    for name in ("mqdefault.jpg", "hqdefault.jpg", "default.jpg"):
        url = f"https://i.ytimg.com/vi/{video_id}/{name}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as r:
                data = r.read()
            if data and len(data) > 800:
                if len(_art_mem) > 300:
                    for k in list(_art_mem)[:80]:
                        _art_mem.pop(k, None)
                _art_mem[video_id] = (time.time(), data)
                return data
        except Exception:
            continue
    return None


def _pick_thumb(thumbs, vid):
    """Prefer square YTM art; else 16:9 mqdefault (CSS cover crops it to square)."""
    fallback = _yt_thumb(vid)
    if not thumbs:
        return fallback
    scored = []
    for t in thumbs:
        url = (t.get("url") or "").strip()
        w = int(t.get("width") or 0)
        h = int(t.get("height") or 0)
        if not url or w < 120:
            continue
        ar = w / max(h, 1)
        square = 1.0 - min(abs(ar - 1.0), 1.0)
        scored.append((square, w, url))
    if not scored:
        return fallback
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    if scored[0][0] >= 0.8:
        url = scored[0][2]
        url = re.sub(r"=w\d+-h\d+", "=w544-h544", url)
        return url
    return fallback


def _thumb(entry, vid):
    thumbs = list(entry.get("thumbnails") or [])
    if entry.get("thumbnail"):
        thumbs.append({"url": entry["thumbnail"], "width": 480, "height": 360})
    return _pick_thumb(thumbs, vid)


YTM_CLIENT = {
    "clientName": "WEB_REMIX",
    "clientVersion": "1.20250407.01.00",
    "hl": "en",
    "gl": "US",
}
# YouTube Music "Songs" filter (ytmusicapi).
YTM_SONGS_PARAMS = "EgWKAQIIAWoKEAMQBBAJEAoQBQ=="
_YTM_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
           "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# Cookie-free player JSON. Same Innertube path as YTM search — no watch-page,
# so YouTube's "sign in to confirm you're not a bot" HTML challenge never runs.
_INNERTUBE_PLAYERS = (
    {
        # ANDROID_VR still returns plain googlevideo URLs without PO tokens.
        # https://github.com/JuanBindez/pytubefix — default client for bot checks.
        "client": {
            "clientName": "ANDROID_VR",
            "clientVersion": "1.60.19",
            "hl": "en",
            "gl": "US",
        },
        "ua": ("com.google.android.apps.youtube.vr.oculus/1.60.19 "
               "(Linux; U; Android 12; eureka-user Build/SQ3A.220605.009.A1) gzip"),
        "name": "28",
        "origin": "https://www.youtube.com",
        "endpoint": "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    },
    {
        "client": {
            "clientName": "ANDROID",
            "clientVersion": "21.26.364",
            "androidSdkVersion": 34,
            "hl": "en",
            "gl": "US",
        },
        "ua": "com.google.android.youtube/21.26.364 (Linux; U; Android 14) gzip",
        "name": "3",
        "origin": "https://www.youtube.com",
        "endpoint": "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    },
    {
        "client": {
            "clientName": "IOS",
            "clientVersion": "21.26.4",
            "deviceMake": "Apple",
            "deviceModel": "iPhone16,2",
            "osName": "iPhone",
            "osVersion": "17.6.1.21G93",
            "hl": "en",
            "gl": "US",
        },
        "ua": "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 17_6_1 like Mac OS X)",
        "name": "5",
        "origin": "https://www.youtube.com",
        "endpoint": "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    },
    {
        "client": None,  # filled with YTM_CLIENT at call time
        "ua": _YTM_UA,
        "name": "67",
        "origin": "https://music.youtube.com",
        "endpoint": "https://music.youtube.com/youtubei/v1/player?prettyPrint=false",
        "ytm": True,
    },
)


def _pick_player_audio(data, vid):
    status = ((data.get("playabilityStatus") or {}).get("status") or "")
    if status and status != "OK":
        return None
    sd = data.get("streamingData") or {}
    formats = list(sd.get("adaptiveFormats") or []) + list(sd.get("formats") or [])
    audio = []
    for f in formats:
        url = f.get("url")
        if not url:
            continue
        mime = f.get("mimeType") or ""
        if f.get("audioQuality") or mime.startswith("audio/"):
            audio.append(f)
        elif mime.startswith("video/mp4") and "mp4a" in mime:
            audio.append(f)
    if not audio:
        return None
    audio.sort(key=lambda f: ("mp4" in (f.get("mimeType") or ""),
                              int(f.get("bitrate") or 0)), reverse=True)
    f = audio[0]
    details = data.get("videoDetails") or {}
    dur = details.get("lengthSeconds")
    try:
        dur = int(dur) if dur is not None else None
    except (TypeError, ValueError):
        dur = None
    thumbs = (details.get("thumbnail") or {}).get("thumbnails") or []
    mime = f.get("mimeType") or ""
    return {
        "title": details.get("title") or "",
        "uploader": details.get("author") or "",
        "duration": dur,
        "thumbnail": _pick_thumb(thumbs, vid),
        "audio_url": f["url"],
        "ext": "m4a" if "mp4" in mime else "webm",
        "abr": round(int(f.get("bitrate") or 0) / 1000) or None,
    }


def _innertube_audio(vid):
    """Resolve a stream URL with no cookies and no yt-dlp watch page."""
    for spec in _INNERTUBE_PLAYERS:
        client = dict(YTM_CLIENT) if spec.get("ytm") else dict(spec["client"])
        label = client.get("clientName") or "?"
        try:
            payload = {
                "context": {"client": client},
                "videoId": vid,
                "contentCheckOk": True,
                "racyCheckOk": True,
            }
            req = urllib.request.Request(
                spec["endpoint"],
                data=json.dumps(payload).encode(),
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": spec["ua"],
                    "X-YouTube-Client-Name": spec["name"],
                    "X-YouTube-Client-Version": client["clientVersion"],
                    "Origin": spec["origin"],
                    "Referer": spec["origin"] + "/",
                },
                method="POST",
            )
            with _yt_open(req, timeout=12) as resp:
                data = json.loads(resp.read().decode("utf-8", "replace"))
            picked = _pick_player_audio(data, vid)
            if picked and picked.get("audio_url"):
                print(f"innertube {vid} {label}: ok", flush=True)
                return picked
            st = (data.get("playabilityStatus") or {}).get("reason") or (
                data.get("playabilityStatus") or {}).get("status")
            print(f"innertube {vid} {label}: {st or 'no formats'}", flush=True)
        except Exception as e:
            print(f"innertube {vid} {label}: {str(e)[:100]}", flush=True)
    return None


def _parse_mmss(s):
    parts = (s or "").strip().split(":")
    if not (2 <= len(parts) <= 3) or not all(p.isdigit() for p in parts):
        return None
    vals = [int(p) for p in parts]
    if len(vals) == 2:
        return vals[0] * 60 + vals[1]
    return vals[0] * 3600 + vals[1] * 60 + vals[2]


def _ytm_item(r):
    """musicResponsiveListItemRenderer -> card dict, or None."""
    vid = (r.get("playlistItemData") or {}).get("videoId")
    if not vid:
        try:
            vid = (r["overlay"]["musicItemThumbnailOverlayRenderer"]["content"]
                   ["musicPlayButtonRenderer"]["playNavigationEndpoint"]
                   ["watchEndpoint"]["videoId"])
        except Exception:
            vid = None
    if not vid or not re.fullmatch(r"[\w-]{11}", vid):
        return None
    title, uploader, dur = vid, "", None
    try:
        title = (r["flexColumns"][0]["musicResponsiveListItemFlexColumnRenderer"]
                 ["text"]["runs"][0]["text"]) or vid
    except Exception:
        pass
    try:
        runs = (r["flexColumns"][1]["musicResponsiveListItemFlexColumnRenderer"]
                ["text"]["runs"])
        texts = [(x.get("text") or "").strip() for x in runs]
        for t in texts:
            d = _parse_mmss(t)
            if d is not None:
                dur = d
                break
        skip = {"•", "Song", "Video", "Album", "EP", "Single"}
        for t in texts:
            if t in skip or _parse_mmss(t) is not None:
                continue
            if t:
                uploader = t
                break
    except Exception:
        pass
    thumbs = []
    try:
        thumbs = r["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"]
    except Exception:
        thumbs = []
    thumb = _pick_thumb(thumbs, vid)
    return {"id": vid, "title": title, "uploader": uploader,
            "duration": dur, "thumbnail": thumb}


def _ytm_two_row(r):
    vid = None
    try:
        vid = r["navigationEndpoint"]["watchEndpoint"]["videoId"]
    except Exception:
        vid = None
    if not vid:
        try:
            vid = (r["overlay"]["musicItemThumbnailOverlayRenderer"]["content"]
                   ["musicPlayButtonRenderer"]["playNavigationEndpoint"]
                   ["watchEndpoint"]["videoId"])
        except Exception:
            vid = None
    if not vid or not re.fullmatch(r"[\w-]{11}", vid):
        return None
    title = vid
    try:
        title = r["title"]["runs"][0]["text"]
    except Exception:
        try:
            title = r["title"]["simpleText"] or vid
        except Exception:
            pass
    up = ""
    try:
        up = r["subtitle"]["runs"][0]["text"]
    except Exception:
        pass
    thumbs = []
    try:
        thumbs = r["thumbnailRenderer"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"]
    except Exception:
        try:
            thumbs = r["thumbnail"]["musicThumbnailRenderer"]["thumbnail"]["thumbnails"]
        except Exception:
            thumbs = []
    return {"id": vid, "title": title or vid, "uploader": up,
            "duration": None, "thumbnail": _pick_thumb(thumbs, vid)}


def _ytm_collect(node, out, seen, n):
    if len(out) >= n:
        return
    if isinstance(node, list):
        for x in node:
            _ytm_collect(x, out, seen, n)
            if len(out) >= n:
                return
        return
    if not isinstance(node, dict):
        return
    r = node.get("musicResponsiveListItemRenderer")
    if r:
        item = _ytm_item(r)
        if item and item["id"] not in seen:
            seen.add(item["id"])
            out.append(item)
            if len(out) >= n:
                return
    r2 = node.get("musicTwoRowItemRenderer")
    if r2:
        item = _ytm_two_row(r2)
        if item and item["id"] not in seen:
            seen.add(item["id"])
            out.append(item)
            if len(out) >= n:
                return
    for v in node.values():
        if isinstance(v, (dict, list)):
            _ytm_collect(v, out, seen, n)
            if len(out) >= n:
                return


def ytm_innertube(query, n=12, songs=True):
    """YouTube Music search via innertube. Direct (no WARP) — search is not IP-bound."""
    payload = {
        "context": {"client": dict(YTM_CLIENT)},
        "query": query,
    }
    if songs:
        payload["params"] = YTM_SONGS_PARAMS
    req = urllib.request.Request(
        "https://music.youtube.com/youtubei/v1/search?prettyPrint=false",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "User-Agent": _YTM_UA,
            "Origin": "https://music.youtube.com",
            "Referer": "https://music.youtube.com/search?q=" + urllib.parse.quote_plus(query),
            "X-YouTube-Client-Name": "67",
            "X-YouTube-Client-Version": YTM_CLIENT["clientVersion"],
        },
        method="POST",
    )
    # Direct on purpose: WARP adds ~8s. Streams still use YT_PROXY.
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8", "replace"))
    out, seen = [], set()
    _ytm_collect(data, out, seen, n)
    return out


def ytm_browse(browse_id, n=16):
    payload = {
        "context": {"client": dict(YTM_CLIENT)},
        "browseId": browse_id,
    }
    req = urllib.request.Request(
        "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "User-Agent": _YTM_UA,
            "Origin": "https://music.youtube.com",
            "Referer": "https://music.youtube.com/",
            "X-YouTube-Client-Name": "67",
            "X-YouTube-Client-Version": YTM_CLIENT["clientVersion"],
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8", "replace"))
    out, seen = [], set()
    _ytm_collect(data, out, seen, n)
    return out


def ytm_fresh(n=20):
    out, seen = [], set()
    for bid in ("FEmusic_new_releases", "FEmusic_charts"):
        try:
            batch = ytm_browse(bid, n)
        except Exception:
            batch = []
        for h in batch:
            vid = h.get("id")
            if not vid or vid in seen:
                continue
            seen.add(vid)
            out.append(h)
            if len(out) >= n:
                return out
    year = time.strftime("%Y")
    try:
        for h in ytm_tracks(f"new songs {year}", n):
            vid = h.get("id")
            if not vid or vid in seen:
                continue
            seen.add(vid)
            out.append(h)
            if len(out) >= n:
                break
    except Exception:
        pass
    return out[:n]


_YT_WEB_CLIENT = {
    "clientName": "WEB",
    "clientVersion": "2.20250407.01.00",
    "hl": "en",
    "gl": "US",
}
_SEARCH_JUNK = re.compile(
    r"slowed|reverb|nightcore|sped\s*up|8d audio|mashup|\bcover\b|1\s*hour|"
    r"hour\s*version|lyrics?|tiktok|nightcore|ultra\s*slowed|432\s*hz",
    re.I,
)


def _yt_video_item(r):
    vid = r.get("videoId")
    if not vid or not re.fullmatch(r"[\w-]{11}", vid):
        return None
    title = ""
    try:
        title = "".join((x.get("text") or "") for x in (r["title"]["runs"]))
    except Exception:
        title = ((r.get("title") or {}).get("simpleText") or vid)
    up = ""
    for key in ("ownerText", "shortBylineText", "longBylineText"):
        try:
            up = "".join((x.get("text") or "") for x in (r[key]["runs"]))
            if up:
                break
        except Exception:
            pass
    dur = None
    try:
        dur = _parse_mmss((r.get("lengthText") or {}).get("simpleText") or "")
    except Exception:
        pass
    thumbs = []
    try:
        thumbs = r["thumbnail"]["thumbnails"]
    except Exception:
        pass
    return {"id": vid, "title": title or vid, "uploader": up,
            "duration": dur, "thumbnail": _pick_thumb(thumbs, vid)}


def _yt_collect_videos(node, out, seen, n):
    if len(out) >= n:
        return
    if isinstance(node, list):
        for x in node:
            _yt_collect_videos(x, out, seen, n)
            if len(out) >= n:
                return
        return
    if not isinstance(node, dict):
        return
    r = node.get("videoRenderer") or node.get("compactVideoRenderer")
    if r:
        item = _yt_video_item(r)
        if item and item["id"] not in seen:
            seen.add(item["id"])
            out.append(item)
            if len(out) >= n:
                return
    for v in node.values():
        if isinstance(v, (dict, list)):
            _yt_collect_videos(v, out, seen, n)
            if len(out) >= n:
                return


def yt_web_search(query, n=12):
    """YouTube search (not Music Songs). Finds videos like Electronic Gems HOME - Resonance."""
    payload = {
        "context": {"client": dict(_YT_WEB_CLIENT)},
        "query": query,
    }
    req = urllib.request.Request(
        "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "User-Agent": _YTM_UA,
            "Origin": "https://www.youtube.com",
            "Referer": "https://www.youtube.com/results?search_query=" + urllib.parse.quote_plus(query),
            "X-YouTube-Client-Name": "1",
            "X-YouTube-Client-Version": _YT_WEB_CLIENT["clientVersion"],
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode("utf-8", "replace"))
    out, seen = [], set()
    _yt_collect_videos(data, out, seen, n)
    return out


def _search_tokens(query):
    return [t for t in re.split(r"[^\w]+", (query or "").lower()) if len(t) > 1]


def _search_score(track, tokens):
    title = (track.get("title") or "")
    up = (track.get("uploader") or "")
    blob = f"{title} {up}".lower()
    title_l = title.lower()
    if not tokens:
        return 0
    hits = sum(1 for tok in tokens if tok in blob)
    score = hits * 12
    if hits == len(tokens) and all(tok in title_l for tok in tokens):
        score += 40
    elif hits == len(tokens):
        score += 16
    if " - " in title and hits == len(tokens):
        score += 10
    if _SEARCH_JUNK.search(title) and not _SEARCH_JUNK.search(" ".join(tokens)):
        score -= 28
    dur = track.get("duration") or 0
    if dur and dur < 90:
        score -= 8
    if dur and dur > 600:
        score -= 18
    return score


def _search_rank(query, tracks, n):
    tokens = _search_tokens(query)
    seen, ranked = set(), []
    for i, t in enumerate(tracks):
        vid = (t or {}).get("id")
        if not vid or vid in seen:
            continue
        seen.add(vid)
        ranked.append((_search_score(t, tokens), -i, t))
    ranked.sort(key=lambda x: (x[0], x[1]), reverse=True)
    # Keep junk only if nothing else scored.
    good = [t for s, _, t in ranked if s >= 12]
    if len(good) >= min(4, n):
        return good[:n]
    return [t for _, _, t in ranked[:n]]


def ytm_tracks(query, n=12):
    """Song hits — innertube first (~0.5s), yt-dlp scrape only if that is empty."""
    try:
        hits = ytm_innertube(query, n, songs=True)
        if len(hits) < min(4, n):
            try:
                extra = ytm_innertube(query, n, songs=False)
                seen = {t["id"] for t in hits}
                for t in extra:
                    if t["id"] not in seen:
                        hits.append(t)
                        seen.add(t["id"])
                    if len(hits) >= n:
                        break
            except Exception:
                pass
        if hits:
            return hits[:n]
    except Exception:
        pass
    opts = dict(BASE_YDL, extract_flat=True)
    with _flat_gate, yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(
            "https://music.youtube.com/search?q=" + urllib.parse.quote_plus(query),
            download=False)
    out = []
    seen = set()
    for e in (info.get("entries") or [])[:40]:
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
        with _flat_gate, yt_dlp.YoutubeDL(opts) as ydl:
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


def _light_meta(vid):
    """Metadata via anonymous player clients: no cookies, no web bot-check."""
    opts = _ydl_opts(clients=_ANON_CLIENTS[0], cookies=False,
                     skip_download=True, ignore_no_formats_error=True)
    with _flat_gate, yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)


def enrich_one(vid):
    """Full metadata for one song; falls back to a playable stub on failure."""
    try:
        m = _cached_audio(vid) or _light_meta(vid)
        return {"id": vid, "title": m.get("title") or vid,
                "uploader": m.get("uploader") or "", "duration": m.get("duration"),
                "categories": m.get("categories") or [],
                "thumbnail": m.get("thumbnail") or _yt_thumb(vid)}
    except Exception:
        return {"id": vid, "title": vid, "uploader": "",
                "duration": None, "thumbnail": _yt_thumb(vid)}


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
    with _flat_gate, yt_dlp.YoutubeDL(opts) as ydl:
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
    """YouTube + YouTube Music, ranked so 'HOME Resonance' hits Electronic Gems first."""
    query = query.strip()
    key = f"{query}|{n}|yt1"
    now = time.time()
    if key in _search_cache and now - _search_cache[key][0] < SEARCH_TTL:
        return _search_cache[key][1]
    leader = False
    with _search_inflight_lock:
        ev = _search_inflight.get(key)
        if ev is None:
            ev = threading.Event()
            _search_inflight[key] = ev
            leader = True
    if not leader:
        ev.wait(timeout=12)
        if key in _search_cache:
            return _search_cache[key][1]
        return []
    try:
        want = max(n, 10)

        def _ytm():
            try:
                return ytm_innertube(query, want, songs=True) or []
            except Exception:
                return []

        def _web():
            try:
                return yt_web_search(query, want) or []
            except Exception:
                try:
                    return regular_topup(query, set(), want)
                except Exception:
                    return []

        ytm, web = [], []
        with ThreadPoolExecutor(max_workers=2) as ex:
            f_ytm = ex.submit(_ytm)
            f_web = ex.submit(_web)
            try:
                ytm = f_ytm.result(timeout=6) or []
            except Exception:
                ytm = []
            try:
                web = f_web.result(timeout=6) or []
            except Exception:
                web = []
        raw = web + ytm
        ranked = _search_rank(query, raw, n)
        out = []
        seen = set()
        for t in ranked:
            vid = t.get("id")
            if not vid or vid in seen:
                continue
            seen.add(vid)
            out.append({
                "id": vid,
                "title": t.get("title") or vid,
                "uploader": t.get("uploader") or "",
                "duration": t.get("duration"),
                "thumbnail": t.get("thumbnail") or _yt_thumb(vid),
            })
        if not out:
            try:
                ex = ThreadPoolExecutor(max_workers=1)
                try:
                    out = ex.submit(regular_topup, query, set(), n).result(timeout=6)
                finally:
                    ex.shutdown(wait=False, cancel_futures=True)
            except Exception:
                out = []
        _cache_put(_search_cache, key, (time.time(), out))
        return out
    finally:
        ev.set()
        with _search_inflight_lock:
            _search_inflight.pop(key, None)


def search_users(q, n=12, me_id=None):
    q = (q or "").strip().lstrip("@")
    if len(q) < 1:
        return []
    try:
        n = max(1, min(20, int(n)))
    except (TypeError, ValueError):
        n = 12
    like = f"%{q}%"
    prefix = f"{q}%"
    with _db_lock, db() as con:
        rows = con.execute(
            "SELECT * FROM users "
            "WHERE handle IS NOT NULL AND handle <> '' AND ("
            "LOWER(handle) LIKE LOWER(?) OR LOWER(COALESCE(display,'')) LIKE LOWER(?) "
            "OR LOWER(username) LIKE LOWER(?)) "
            "ORDER BY CASE WHEN LOWER(handle)=LOWER(?) THEN 0 "
            "WHEN LOWER(handle) LIKE LOWER(?) THEN 1 ELSE 2 END, id LIMIT ?",
            (like, like, like, q, prefix, n),
        ).fetchall()
        out = []
        for r in rows:
            handle = (_ug(r, "handle", "") or "").strip().lower()
            if not handle:
                continue
            st = "none"
            if me_id:
                if int(r["id"]) == int(me_id):
                    st = "self"
                else:
                    st = friend_status(con, me_id, r["id"])
            flags = _profile_privacy(r)
            if flags["hidden"] and st != "self":
                continue
            pub = _pub_user(r)
            if st != "self":
                _mask_public_user(pub, flags)
            pub["friend"] = st
            out.append(pub)
    return out


def enrich_ids(ids):
    """Phase 2 (background): full metadata + strict music filter + stream precache."""
    out, drop = [], []
    ids = [v for v in (ids or []) if re.fullmatch(r"[\w-]{11}", v or "")][:12]
    if not ids:
        return out, drop
    done = {}
    ex = ThreadPoolExecutor(max_workers=2)
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
    """MP3 from the cookie-free playback stream (never yt-dlp's web client)."""
    meta = best_audio_url(video_id)
    os.makedirs(MUSIC_DIR, exist_ok=True)
    target = mp3_path(video_id, meta.get("title") or video_id)
    if os.path.exists(target) and os.path.getsize(target) > 1024:
        return target, meta
    with _mp3_lock:
        if os.path.exists(target) and os.path.getsize(target) > 1024:
            return target, meta
        src = _audio_file(video_id)
        tmp_src = None
        tmp = target + ".part"
        try:
            if not src:
                audio_url = meta.get("audio_url") or ""
                if not audio_url:
                    raise RuntimeError("no audio url")
                tmp_src = os.path.join(MUSIC_DIR, f"{video_id}.src")
                _save_stream(audio_url, tmp_src)
                src = tmp_src
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", src, "-vn",
                 "-c:a", "libmp3lame", "-q:a", "0", "-f", "mp3", tmp],
                check=True, timeout=180, stdin=subprocess.DEVNULL)
            os.replace(tmp, target)
        finally:
            with contextlib.suppress(OSError):
                if tmp_src:
                    os.remove(tmp_src)
            with contextlib.suppress(OSError):
                if os.path.exists(tmp) and tmp != target:
                    os.remove(tmp)
        if not os.path.exists(target) or os.path.getsize(target) < 1024:
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


_resolve_fail = {}   # video_id -> (ts, message)
RESOLVE_FAIL_TTL = 600


def best_audio_url(video_id):
    hit = _cached_audio(video_id)
    if hit:
        return hit
    # A video YouTube refuses us (region claim, removed) stays refused for a
    # while; re-running yt-dlp on every client retry got the IP rate-limited
    # and pushed the instance out of memory.
    fail = _resolve_fail.get(video_id)
    if fail and time.time() - fail[0] < RESOLVE_FAIL_TTL:
        raise RuntimeError(fail[1])
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
        fail = _resolve_fail.get(video_id)
        if fail and time.time() - fail[0] < RESOLVE_FAIL_TTL:
            raise RuntimeError(fail[1])
    try:
        return _resolve_audio(video_id)
    except Exception as e:
        _cache_put(_resolve_fail, video_id, (time.time(), str(e)[:200]))
        raise
    finally:
        if owner:
            with _inflight_lock:
                _inflight.pop(video_id, None)
            ev.set()


# Piped (https://github.com/TeamPiped/Piped) talks to YouTube from *their*
# IPs and rewrites googlevideo through pipedproxy, so a blocked VPS can
# still get a playable URL without WARP. Public instances die; try several.
_PIPED_APIS = (
    "https://api.piped.private.coffee",
    "https://pipedapi.kavin.rocks",
    "https://piped-api.lunar.icu",
    "https://pipedapi.adminforge.de",
)


def _piped_url_ok(url):
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0", "Range": "bytes=0-1"})
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status in (200, 206)
    except Exception:
        return False


def _piped_audio(video_id):
    for base in _PIPED_APIS:
        try:
            req = urllib.request.Request(
                f"{base}/streams/{video_id}",
                headers={"User-Agent": "Mozilla/5.0 Muse/1"})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            print(f"piped {video_id} {base}: {str(e)[:90]}", flush=True)
            continue
        streams = [f for f in (data.get("audioStreams") or [])
                   if f.get("url") and not f.get("videoOnly")]
        streams.sort(key=lambda f: (
            "mp4" in (f.get("mimeType") or "")
            or str(f.get("format") or "").upper() in ("M4A", "MP4"),
            int(f.get("bitrate") or 0),
        ), reverse=True)
        if not streams:
            streams = [f for f in (data.get("videoStreams") or [])
                       if f.get("url") and not f.get("videoOnly")
                       and ("mp4" in (f.get("mimeType") or "").lower()
                            or str(f.get("format") or "").upper() in ("MP4", "MPEG_4", "M4A"))]
        if not streams:
            print(f"piped {video_id} {base}: no streams", flush=True)
            continue
        url = streams[0]["url"]
        if not _piped_url_ok(url):
            print(f"piped {video_id} {base}: url dead", flush=True)
            continue
        mime = streams[0].get("mimeType") or ""
        print(f"piped {video_id} {base}: ok", flush=True)
        return {
            "title": data.get("title") or video_id,
            "uploader": data.get("uploader") or "",
            "duration": data.get("duration"),
            "thumbnail": data.get("thumbnailUrl") or _yt_thumb(video_id),
            "audio_url": url,
            "ext": "m4a" if "mp4" in mime.lower() or "m4a" in mime.lower() else "mp4",
            "abr": None,
        }
    return None


def _resolve_audio(video_id):
    with _full_gate:
        hit = _cached_audio(video_id)
        return hit or _resolve_audio_locked(video_id)


def _resolve_audio_locked(video_id):
    now = time.time()
    picked = _innertube_audio(video_id)
    if picked and picked.get("audio_url") and _stream_works(picked["audio_url"]):
        payload = {
            "id": video_id,
            "title": picked.get("title") or video_id,
            "uploader": picked.get("uploader") or "",
            "duration": picked.get("duration"),
            "categories": [],
            "thumbnail": picked.get("thumbnail") or _yt_thumb(video_id),
            "audio_url": picked["audio_url"],
            "ext": picked.get("ext") or "",
            "abr": picked.get("abr"),
        }
        _cache_put(_url_cache, video_id, (now, payload))
        print(f"resolve {video_id}: innertube {time.time() - now:.1f}s", flush=True)
        return payload
    url = f"https://www.youtube.com/watch?v={video_id}"
    info = None
    last_err = None
    for clients in _ANON_CLIENTS:
        opts = _ydl_opts(clients=clients, cookies=False,
                         format="bestaudio/best", skip_download=True)
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
            t_extract = time.time() - now
            stream = info.get("url") or ""
            ok = bool(stream) and _stream_works(stream)
            if not ok:
                audio_only = [f for f in (info.get("formats") or [])
                              if f.get("url") and f.get("acodec") not in (None, "none")
                              and f.get("vcodec") in (None, "none")]
                if audio_only:
                    audio_only.sort(key=lambda f: (f.get("ext") == "m4a",
                                                    f.get("abr") or 0), reverse=True)
                    ok = _stream_works(audio_only[0]["url"])
            print(f"resolve {video_id} {'+'.join(clients)}: extract "
                  f"{t_extract:.1f}s ok={ok}", flush=True)
            if ok:
                break
            info = None
        except yt_dlp.utils.DownloadError as e:
            last_err = e
            print(f"anon {video_id} {'+'.join(clients)}: {str(e)[:120]}", flush=True)
            info = None
    if info is None:
        piped = _piped_audio(video_id)
        if piped and piped.get("audio_url"):
            payload = {
                "id": video_id,
                "title": piped.get("title") or video_id,
                "uploader": piped.get("uploader") or "",
                "duration": piped.get("duration"),
                "categories": [],
                "thumbnail": piped.get("thumbnail") or _yt_thumb(video_id),
                "audio_url": piped["audio_url"],
                "ext": piped.get("ext") or "m4a",
                "abr": piped.get("abr"),
            }
            _cache_put(_url_cache, video_id, (now, payload))
            print(f"resolve {video_id}: piped {time.time() - now:.1f}s", flush=True)
            return payload
        raise last_err or RuntimeError("no anonymous audio stream")
    audio_only = [f for f in (info.get("formats") or [])
                  if f.get("url") and f.get("acodec") not in (None, "none")
                  and f.get("vcodec") in (None, "none")]
    if audio_only:
        # AAC first: iOS Safari can't be relied on for Opus/WebM.
        audio_only.sort(key=lambda f: (f.get("ext") == "m4a", f.get("abr") or 0), reverse=True)
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
        "thumbnail": info.get("thumbnail") or _yt_thumb(video_id),
        "audio_url": stream,
        "ext": ext,
        "abr": abr,
    }
    _cache_put(_url_cache, video_id, (now, payload))
    return payload


# Remuxed AAC on the music volume so iOS <audio> can keep playing with the
# screen locked (Safari will not play a YouTube iframe in the background).
AUDIO_DIR = os.path.join(MUSIC_DIR, "stream")
AUDIO_DIR_MAX = 4 * 1024 * 1024 * 1024
os.makedirs(AUDIO_DIR, exist_ok=True)
# googlevideo throttles one big request to real-time speed; sub-10 MB ranges aren't.
AUDIO_CHUNK = 4 * 1024 * 1024
_audio_jobs = set()
_audio_jobs_lock = threading.Lock()


def _save_stream(audio_url, dest):
    """Pull a googlevideo URL in ranged chunks (same path as playback)."""
    pos, total = 0, None
    with open(dest, "wb") as f:
        while total is None or pos < total:
            req = urllib.request.Request(audio_url, headers={
                "User-Agent": "Mozilla/5.0",
                "Range": f"bytes={pos}-{pos + AUDIO_CHUNK - 1}"})
            with _yt_open(req, timeout=30) as r:
                if total is None:
                    m = re.search(r"/(\d+)\s*$", r.headers.get("Content-Range") or "")
                    total = int(m.group(1)) if m else -1
                data = r.read()
            if not data:
                break
            f.write(data)
            pos += len(data)
            if total < 0:
                break
    if pos < 1024:
        raise RuntimeError("empty audio download")
    return pos


def _audio_file(video_id, aac_only=False):
    for ext in (("m4a",) if aac_only else ("m4a", "webm")):
        p = os.path.join(AUDIO_DIR, f"{video_id}.{ext}")
        if os.path.exists(p) and os.path.getsize(p) > 1024:
            return p
    return None


def _wait_audio_file(video_id, timeout=20, aac_only=False):
    deadline = time.time() + timeout
    while time.time() < deadline:
        p = _audio_file(video_id, aac_only=aac_only)
        if p:
            return p
        time.sleep(0.2)
    return _audio_file(video_id, aac_only=aac_only)


def _prune_audio():
    try:
        files = [os.path.join(AUDIO_DIR, n) for n in os.listdir(AUDIO_DIR) if not n.endswith(".part")]
        files.sort(key=os.path.getmtime)
        total = sum(os.path.getsize(p) for p in files)
        while files and total > AUDIO_DIR_MAX:
            p = files.pop(0)
            total -= os.path.getsize(p)
            os.remove(p)
    except OSError:
        pass


def _download_audio(video_id):
    tmp = None
    flat = None
    try:
        info = best_audio_url(video_id)
        src_ext = "webm" if str(info.get("ext") or "").startswith("webm") else "m4a"
        os.makedirs(AUDIO_DIR, exist_ok=True)
        final = os.path.join(AUDIO_DIR, f"{video_id}.m4a")
        tmp = final + ".part"
        t0, pos, total = time.time(), 0, None
        with open(tmp, "wb") as f:
            while total is None or pos < total:
                req = urllib.request.Request(info["audio_url"], headers={
                    "User-Agent": "Mozilla/5.0", "Range": f"bytes={pos}-{pos + AUDIO_CHUNK - 1}"})
                with _yt_open(req, timeout=30) as r:
                    if total is None:
                        m = re.search(r"/(\d+)\s*$", r.headers.get("Content-Range") or "")
                        total = int(m.group(1)) if m else -1
                    data = r.read()
                if not data:
                    break
                f.write(data)
                pos += len(data)
                if total < 0:
                    break
        # Always publish AAC/MP4: iOS Safari will not play Opus/WebM in <audio>,
        # and YouTube's fragmented m4a has a bogus duration until remuxed.
        flat = final + ".flat"
        if src_ext == "m4a":
            cmd = ["ffmpeg", "-v", "error", "-y", "-i", tmp, "-vn", "-c:a", "copy",
                   "-movflags", "+faststart", "-f", "mp4", flat]
        else:
            cmd = ["ffmpeg", "-v", "error", "-y", "-i", tmp, "-vn",
                   "-c:a", "aac", "-b:a", "192k",
                   "-movflags", "+faststart", "-f", "mp4", flat]
        try:
            subprocess.run(cmd, check=True, timeout=120, stdin=subprocess.DEVNULL)
            os.replace(flat, tmp)
            flat = None
        except Exception as e:
            print(f"audio mux {video_id} failed: {str(e)[:120]}", flush=True)
            with contextlib.suppress(OSError):
                if flat:
                    os.remove(flat)
            flat = None
            if src_ext == "webm":
                webm = os.path.join(AUDIO_DIR, f"{video_id}.webm")
                os.replace(tmp, webm)
                tmp = None
                print(f"cached audio {video_id}: webm fallback {pos // 1024} KB", flush=True)
                _prune_audio()
                return
        os.replace(tmp, final)
        tmp = None
        with contextlib.suppress(OSError):
            os.remove(os.path.join(AUDIO_DIR, f"{video_id}.webm"))
        print(f"cached audio {video_id}: {pos // 1024} KB m4a in {time.time() - t0:.1f}s", flush=True)
        _prune_audio()
    except Exception as e:
        print(f"audio cache {video_id} failed: {str(e)[:150]}", flush=True)
    finally:
        if tmp:
            with contextlib.suppress(OSError):
                os.remove(tmp)
        if flat:
            with contextlib.suppress(OSError):
                os.remove(flat)
        with _audio_jobs_lock:
            _audio_jobs.discard(video_id)


def _warm_audio(video_id, force=False):
    """Start a background AAC remux. Returns True if cached or a job is running.

    Prefetch is capped: a stampede of ffmpeg/yt-dlp jobs starves /api/like and
    playlist POSTs on the same process. Play itself may force a job.
    """
    if _audio_file(video_id, aac_only=True):
        return True
    with _audio_jobs_lock:
        if video_id in _audio_jobs:
            return True
        if not force and len(_audio_jobs) >= 1:
            return False
        _audio_jobs.add(video_id)
    threading.Thread(target=_download_audio, args=(video_id,), daemon=True).start()
    return True


_reco_cache = {}     # user_id -> (ts, tracks); mirrored in the reco table
_reco_stale = set()  # taste changed since the cached mix was built
_reco_busy = set()   # users with a rebuild in flight
_reco_lock = threading.Lock()
# A rebuild fans out into ~15 YouTube lookups; on a fraction of a CPU two at
# once would starve every other request, so they queue.
_reco_gate = threading.Semaphore(1)
RECO_TTL = 1800
RECO_N = 15

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

    ex = ThreadPoolExecutor(max_workers=3)
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
    _reco_stale.add(uid)


def _last_activity(uid):
    """Newest like/play/survey time. Those writes happen in the Supabase
    function, so this replaces the in-process _bust_reco signal."""
    with _db_lock, db() as con:
        row = con.execute(
            "SELECT GREATEST("
            "(SELECT MAX(created) FROM likes WHERE user_id=?),"
            "(SELECT MAX(played_at) FROM plays WHERE user_id=?),"
            "(SELECT MAX(created) FROM survey WHERE user_id=?)) t"
            if DATABASE_URL else
            "SELECT MAX(COALESCE((SELECT MAX(created) FROM likes WHERE user_id=?),0),"
            "COALESCE((SELECT MAX(played_at) FROM plays WHERE user_id=?),0),"
            "COALESCE((SELECT MAX(created) FROM survey WHERE user_id=?),0)) t",
            (uid, uid, uid)).fetchone()
    return (row["t"] if row else None) or 0


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
            with _flat_gate, yt_dlp.YoutubeDL(opts) as ydl:
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


def _reco_save(uid, tracks):
    now = time.time()
    _reco_cache[uid] = (now, tracks)
    try:
        with _db_lock, db() as con:
            con.execute("INSERT INTO reco(user_id, ts, data) VALUES(?,?,?) "
                        "ON CONFLICT(user_id) DO UPDATE SET ts=excluded.ts, data=excluded.data",
                        (uid, now, json.dumps(tracks)))
    except Exception as e:
        print(f"reco save failed: {e}", flush=True)


def _reco_rebuild(uid):
    try:
        _reco_stale.discard(uid)
        try:
            with _reco_gate:
                tracks = _compute_recos(uid)
        except Exception as e:
            print(f"reco build failed for {uid}: {e}", flush=True)
            tracks = []
        if tracks:
            _reco_save(uid, tracks)
        return tracks
    finally:
        with _reco_lock:
            _reco_busy.discard(uid)


def _reco_claim(uid):
    with _reco_lock:
        if uid in _reco_busy:
            return False
        _reco_busy.add(uid)
        return True


def recommendations(user_id, n=12):
    """Stale-while-revalidate: any saved mix answers instantly; a rebuild runs
    in the background when it's old, from another day, or taste changed."""
    hit = _reco_cache.get(user_id)
    if hit is None:
        with _db_lock, db() as con:
            row = con.execute("SELECT ts, data FROM reco WHERE user_id=?", (user_id,)).fetchone()
        if row:
            hit = (row["ts"], json.loads(row["data"]))
            _reco_cache[user_id] = hit
    if hit:
        now = time.time()
        stale = (now - hit[0] > RECO_TTL or user_id in _reco_stale
                 or int(hit[0] // 86400) != int(now // 86400)
                 or _last_activity(user_id) > hit[0])
        if stale and _reco_claim(user_id):
            threading.Thread(target=_reco_rebuild, args=(user_id,), daemon=True).start()
        return hit[1][:n]
    # First mix ever: build in the background and give it a short head start;
    # the client polls (see "building") instead of hanging on a slow build.
    if _reco_claim(user_id):
        threading.Thread(target=_reco_rebuild, args=(user_id,), daemon=True).start()
    for _ in range(12):
        time.sleep(0.5)
        if user_id in _reco_cache:
            return _reco_cache[user_id][1][:n]
    return []


def _compute_recos(user_id, n=RECO_N):
    now = time.time()
    day = int(now // 86400)
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
             "thumbnail": _yt_thumb(c["id"]),
             "reason": why} for _, c, why in picked]
    if not pool:
        pool = [{"id": c["id"], "title": c["title"], "duration": None,
                 "thumbnail": _yt_thumb(c["id"]),
                 "reason": "Fresh for you"} for c in cands if c["id"] not in heard][:30]
    # Daily rotation: same growing pool, a different window every day.
    start = (day * 7) % max(1, len(pool))
    return [pool[(start + i) % len(pool)] for i in range(min(n, len(pool)))]


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

    def _post_musely(self, body):
        u = self._me()
        gate = musely_gate(u)
        if not gate["unlocked"]:
            if gate["login"]:
                say = "sign in, then listen to 3 songs."
            else:
                left = max(1, gate["need"] - gate["have"])
                say = f"listen to {left} more song" + ("s" if left != 1 else "") + " — then he's yours."
            return self._json({
                "ok": False, "say": say, "tracks": [], "mode": "chat", "musely": gate,
            })
        ip = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()[:64]
        if not ip:
            ip = (self.client_address[0] if self.client_address else "")[:64]
        msg = (body.get("message") or "").strip()
        hist = body.get("history") if isinstance(body.get("history"), list) else []
        out = musely_reply(msg, hist, ip=ip)
        out["musely"] = gate
        return self._json(out)

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
                         f"HttpOnly; SameSite=Lax"
                         f"{'; Secure' if PUBLIC_URL.startswith('https') else ''}")

    def _clear_session_cookie(self):
        self.send_header("Set-Cookie",
                         "muse_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")

    def _send_local_file(self, full, ctype, cache="private, max-age=86400"):
        if not os.path.isfile(full):
            return self._json({"error": "missing"}, 404)
        try:
            size = os.path.getsize(full)
            start, end = 0, size - 1
            rng = (self.headers.get("Range") or "").strip()
            m = re.fullmatch(r"bytes=(\d*)-(\d*)", rng)
            partial = False
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Accept-Ranges", "bytes")
                    self.end_headers()
                    return
                partial = True
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Cache-Control", "private, no-store, no-transform")
            self.send_header("CDN-Cache-Control", "no-store")
            self.send_header("Cloudflare-CDN-Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                with open(full, "rb") as f:
                    f.seek(start)
                    left = end - start + 1
                    while left > 0:
                        chunk = f.read(min(256 * 1024, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return True

    def _send_desktop_file(self, path, filename, ctype="application/octet-stream"):
        if not os.path.isfile(path):
            return self._json({"error": "desktop build not published"}, 404)
        try:
            size = os.path.getsize(path)
            start, end = 0, size - 1
            rng = (self.headers.get("Range") or "").strip()
            m = re.fullmatch(r"bytes=(\d*)-(\d*)", rng)
            partial = False
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                partial = True
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(end - start + 1))
            if partial:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{filename}"; filename*=UTF-8\'\'{filename}',
            )
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "private, no-store, no-transform")
            self.send_header("CDN-Cache-Control", "no-store")
            self.send_header("Cloudflare-CDN-Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                with open(path, "rb") as f:
                    f.seek(start)
                    left = end - start + 1
                    while left > 0:
                        chunk = f.read(min(256 * 1024, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
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

    def _serve_audio_file(self, path):
        size = os.path.getsize(path)
        start, end = 0, size - 1
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", (self.headers.get("Range") or "").strip())
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            if start >= size or start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
        try:
            os.utime(path)
        except OSError:
            pass
        self.send_response(206 if m and (m.group(1) or m.group(2)) else 200)
        self.send_header("Content-Type", "audio/webm" if path.endswith(".webm") else "audio/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if m and (m.group(1) or m.group(2)):
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(64 * 1024, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _client_ios(self, qs=None):
        if qs and (qs.get("ios") or [""])[0] in ("1", "true"):
            return True
        ua = self.headers.get("User-Agent") or ""
        return bool(re.search(r"iPhone|iPad|iPod", ua))

    def _proxy_audio(self, video_id, ios=False):
        cached = _audio_file(video_id, aac_only=ios)
        if cached:
            return self._serve_audio_file(cached)
        _warm_audio(video_id, force=True)
        if ios:
            # Safari cannot play a YouTube iframe with the screen locked, and
            # it cannot play a live Opus/WebM proxy either. Remuxed AAC is
            # best, but blocking GET for 40s makes the first tap after a
            # reload look dead. HEAD must look like audio — JSON 503 makes
            # Safari never send GET.
            if self.command == "HEAD":
                self.send_response(200)
                self.send_header("Content-Type", "audio/mp4")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            # Don't sit here waiting for remux — a 2s sleep delayed the first
            # tap and held a worker while like / playlist requests queued.
            try:
                info = best_audio_url(video_id)
            except Exception:
                cached = _wait_audio_file(video_id, timeout=38, aac_only=True)
                if cached:
                    return self._serve_audio_file(cached)
                self.send_response(502)
                self.send_header("Content-Type", "audio/mp4")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
            if str(info.get("ext") or "") == "m4a":
                stream = info["audio_url"]
            else:
                # Hold the GET that Safari's play() is waiting on. A 503
                # rejects that gesture, and a later retry is ignored.
                cached = _wait_audio_file(video_id, timeout=45, aac_only=True)
                if cached:
                    return self._serve_audio_file(cached)
                self.send_response(503)
                self.send_header("Content-Type", "audio/mp4")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                return
        else:
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
            ctype = upstream.headers.get("Content-Type") or ("audio/mp4" if ios else "audio/webm")
            self.send_header("Content-Type", ctype)
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
            if path == "/api/musely":
                return self._json({
                    "ok": True,
                    "ready": _key_ok(_env_file_get("GROQ_API_KEY")),
                    "musely": musely_gate(self._me()),
                })
            if path == "/api/version":
                return self._json({"build": BUILD})
            if path == "/api/desktop":
                meta = desktop_meta()
                if not meta:
                    return self._json({"error": "desktop build not published"}, 404)
                return self._json(meta)
            if path == "/api/android":
                meta = android_meta()
                if not meta:
                    return self._json({"error": "android build not published"}, 404)
                return self._json(meta)
            if path == "/api/linux":
                meta = linux_meta()
                if not meta:
                    return self._json({"error": "linux build not published"}, 404)
                return self._json(meta)
            if path == "/desktop/Muse.exe":
                return self._send_desktop_file(desktop_exe_path(), "Muse.exe")
            if path == "/desktop/Muse-Setup.exe":
                return self._send_desktop_file(desktop_setup_path(), "Muse-Setup.exe")
            if path == "/android/Muse.apk":
                return self._send_desktop_file(
                    android_apk_path(), "Muse.apk",
                    "application/vnd.android.package-archive")
            if path == "/linux/Muse.AppImage":
                return self._send_desktop_file(
                    linux_appimage_path(), "Muse.AppImage")
            if path == "/api/search":
                q = (qs.get("q") or [""])[0]
                if not q.strip():
                    return self._json({"error": "empty query"}, 400)
                try:
                    n = max(4, min(15, int((qs.get("n") or ["10"])[0])))
                except ValueError:
                    n = 10
                return self._json({"results": search_songs(q, n), "music_only": True})
            if path == "/api/users":
                q = (qs.get("q") or [""])[0]
                if not str(q).strip():
                    return self._json({"error": "empty query"}, 400)
                try:
                    n = max(1, min(20, int((qs.get("n") or ["12"])[0])))
                except ValueError:
                    n = 12
                me = self._me()
                return self._json({"users": search_users(q, n, me_id=me["id"] if me else None)})
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
                if "warm" in qs:
                    started = _warm_audio(v)
                    return self._json({
                        "cached": bool(_audio_file(v)),
                        "started": bool(started),
                    }, 202)
                return self._proxy_audio(v, ios=self._client_ios(qs))
            if path == "/api/art":
                v = (qs.get("v") or [""])[0]
                if not re.fullmatch(r"[\w-]{11}", v or ""):
                    return self._json({"error": "bad video id"}, 400)
                data = yt_art_bytes(v)
                if not data:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(data)
                return
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
            if path == "/api/market":
                u = self._me()
                return self._json(market_feed(u["id"] if u else None))
            if path == "/api/notifs":
                u = self._need_user()
                if not u:
                    return
                try:
                    after = int((qs.get("after") or ["0"])[0] or 0)
                except ValueError:
                    after = 0
                inbox = str((qs.get("inbox") or ["0"])[0] or "").lower() in ("1", "true", "yes")
                uid = int(u["id"])
                with _db_lock, db() as con:
                    unseen = int(con.execute(
                        "SELECT COUNT(*) c FROM notifs WHERE user_id=? AND seen=0",
                        (uid,)).fetchone()["c"] or 0)
                    if inbox:
                        rows = list(con.execute(
                            "SELECT * FROM notifs WHERE user_id=? "
                            "ORDER BY id DESC LIMIT 30", (uid,)).fetchall())
                        rows.reverse()
                    else:
                        rows = con.execute(
                            "SELECT * FROM notifs WHERE user_id=? AND id>? "
                            "ORDER BY id LIMIT 40", (uid, after)).fetchall()
                    out = []
                    for r in rows:
                        frm = None
                        if r["from_id"]:
                            ou = con.execute(
                                "SELECT * FROM users WHERE id=?", (r["from_id"],)).fetchone()
                            if ou:
                                frm = _pub_user(ou)
                        try:
                            payload = json.loads(r["payload"] or "{}")
                        except Exception:
                            payload = {}
                        out.append({
                            "id": r["id"],
                            "kind": r["kind"],
                            "title": r["title"] or "",
                            "body": r["body"] or "",
                            "payload": payload if isinstance(payload, dict) else {},
                            "from": frm,
                            "created": r["created"] or 0,
                            "seen": bool(r["seen"]),
                        })
                    presence = _friend_presence(con, uid)
                return self._json({"notifs": out, "unseen": unseen, "presence": presence})
            if path == "/api/push/key":
                u = self._need_user()
                if not u:
                    return
                if not webpush:
                    return self._json({"key": ""})
                try:
                    with _db_lock, db() as con:
                        _priv, pub = _vapid_load(con)
                except Exception as e:
                    print(f"vapid key: {e}", flush=True)
                    return self._json({"key": ""})
                return self._json({"key": pub or ""})
            if path == "/api/friends":
                u = self._need_user()
                if not u:
                    return
                uid = int(u["id"])
                with _db_lock, db() as con:
                    fr = con.execute(
                        "SELECT a, b FROM friends WHERE a=? OR b=?", (uid, uid)).fetchall()
                    friends = []
                    for r in fr:
                        oid = int(r["b"] if int(r["a"]) == uid else r["a"])
                        ou = con.execute("SELECT * FROM users WHERE id=?", (oid,)).fetchone()
                        if ou:
                            friends.append(_pub_user(ou, live=True))
                    incoming, outgoing = [], []
                    for r in con.execute(
                            "SELECT from_id FROM friend_reqs WHERE to_id=?", (uid,)).fetchall():
                        ou = con.execute("SELECT * FROM users WHERE id=?",
                                         (r["from_id"],)).fetchone()
                        if ou:
                            incoming.append(_pub_user(ou))
                    for r in con.execute(
                            "SELECT to_id FROM friend_reqs WHERE from_id=?", (uid,)).fetchall():
                        ou = con.execute("SELECT * FROM users WHERE id=?",
                                         (r["to_id"],)).fetchone()
                        if ou:
                            outgoing.append(_pub_user(ou))
                friends.sort(key=lambda x: (not x.get("online"), (x.get("display") or "").lower()))
                return self._json({"friends": friends, "incoming": incoming, "outgoing": outgoing})
            if path == "/api/friends/chat":
                u = self._need_user()
                if not u:
                    return
                handle = (qs.get("with") or [""])[0]
                try:
                    after = int((qs.get("after") or ["0"])[0] or 0)
                except ValueError:
                    after = 0
                try:
                    since = float((qs.get("since") or ["0"])[0] or 0)
                except ValueError:
                    since = 0
                try:
                    before = int((qs.get("before") or ["0"])[0] or 0)
                except ValueError:
                    before = 0
                with _db_lock, db() as con:
                    other = _handle_user(con, handle)
                    if not other:
                        return self._json({"error": "not found"}, 404)
                    if friend_status(con, u["id"], other["id"]) != "friends":
                        return self._json({"error": "not friends"}, 403)
                    lo, hi = _pair(u["id"], other["id"])
                    uid = int(u["id"])
                    oid = int(other["id"])
                    if before:
                        rows = list(con.execute(
                            "SELECT * FROM chat_msgs WHERE lo=? AND hi=? AND id<? "
                            "ORDER BY id DESC LIMIT 60", (lo, hi, before)).fetchall())
                        rows.reverse()
                    elif after:
                        rows = con.execute(
                            "SELECT * FROM chat_msgs WHERE lo=? AND hi=? AND id>? "
                            "ORDER BY id LIMIT 80", (lo, hi, after)).fetchall()
                    else:
                        rows = list(con.execute(
                            "SELECT * FROM chat_msgs WHERE lo=? AND hi=? "
                            "ORDER BY id DESC LIMIT 80", (lo, hi)).fetchall())
                        rows.reverse()
                    edits = []
                    if since and after:
                        edits = con.execute(
                            "SELECT * FROM chat_msgs WHERE lo=? AND hi=? AND id<=? "
                            "AND COALESCE(updated, created, 0)>? "
                            "ORDER BY id LIMIT 80",
                            (lo, hi, after, since)).fetchall()
                    theirs = [int(r["id"]) for r in rows if int(r["sender_id"]) != uid]
                    if theirs:
                        _mark_chat_read(con, lo, hi, uid, max(theirs))
                    peer_read = _peer_read_id(con, lo, hi, oid)
                    msgs = [_pack_msg(con, r, uid, peer_read) for r in rows]
                    changed = [_pack_msg(con, r, uid, peer_read) for r in edits]
                return self._json({
                    "with": _pub_user(other, live=True),
                    "messages": msgs,
                    "edits": changed,
                    "typing": _peer_typing(lo, hi, oid),
                    "peer_read": peer_read,
                    "more": bool(before) and len(rows) >= 60,
                })
            if path == "/api/gifs":
                u = self._need_user()
                if not u:
                    return
                q = (qs.get("q") or [""])[0].strip()[:64]
                if not q:
                    return self._json({"gifs": []})
                url = ("https://g.tenor.com/v1/search?"
                       + urllib.parse.urlencode({
                           "q": q, "key": "LIVDSRZULELA", "limit": 24,
                           "media_filter": "minimal", "contentfilter": "medium",
                       }))
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "Muse/1"})
                    with urllib.request.urlopen(req, timeout=8) as resp:
                        data = json.loads(resp.read().decode("utf-8", "replace") or "{}")
                except Exception:
                    return self._json({"gifs": []})
                out = []
                for item in (data.get("results") or [])[:24]:
                    media = (item.get("media") or [{}])[0]
                    gif = (media.get("tinygif") or media.get("gif") or {})
                    src = gif.get("url") or ""
                    prev = (media.get("nanogif") or media.get("tinygif") or {}).get("url") or src
                    if not _gif_ok(src):
                        continue
                    dims = gif.get("dims") or [220, 160]
                    out.append({
                        "url": src, "preview": prev if _gif_ok(prev) else src,
                        "w": int(dims[0] if dims else 220),
                        "h": int(dims[1] if len(dims) > 1 else 160),
                    })
                return self._json({"gifs": out})
            m = re.fullmatch(r"/api/chat/file/([a-zA-Z0-9]{8,40})", path)
            if m:
                u = self._need_user()
                if not u:
                    return
                key = m.group(1)
                with _db_lock, db() as con:
                    row = _load_chat_file(con, key)
                    if not row or not _can_see_file(con, row, u["id"]):
                        return self._json({"error": "not found"}, 404)
                    ctype = row["ctype"] or "application/octet-stream"
                fn = (_ug(row, "name", "") or "").strip()
                if not fn or ".." in fn or "/" in fn or "\\" in fn:
                    fn = key
                hit = os.path.join(CHAT_DIR, fn)
                return self._send_local_file(hit, ctype)
            if path == "/api/me":
                u = self._me()
                return self._json({"user": u, "musely": musely_gate(u)} if u else {"user": None, "musely": musely_gate(None)})
            m = re.fullmatch(r"/api/u/([A-Za-z0-9_.-]{2,24})", path)
            if m:
                data = public_profile(m.group(1))
                if not data:
                    return self._json({"error": "not found"}, 404)
                me = self._me()
                data["friend"] = "none"
                if me and (me.get("handle") or "").lower() == data["user"]["handle"]:
                    data["user"]["mine"] = True
                    data["friend"] = "self"
                elif me:
                    with _db_lock, db() as con:
                        other = _handle_user(con, data["user"]["handle"])
                        if other:
                            data["friend"] = friend_status(con, me["id"], other["id"])
                if data.get("friend") != "friends":
                    data["user"]["online"] = False
                    data["user"]["seen"] = 0
                privacy = data.pop("privacy", None) or {}
                mine = data.get("friend") == "self"
                if mine:
                    data["privacy"] = privacy
                elif privacy.get("hidden"):
                    handle = data["user"]["handle"]
                    hue = data["user"].get("hue", 145)
                    data = {
                        "hidden": True,
                        "friend": data.get("friend") or "none",
                        "user": {
                            "handle": handle, "display": "", "avatar": "",
                            "hue": hue, "mine": False, "online": False,
                            "seen": 0, "created": 0,
                        },
                        "stats": {}, "badges": [], "likes": [], "playlists": [],
                        "omitted": ["likes", "playlists", "badges"],
                    }
                else:
                    omitted = []
                    if privacy.get("anon"):
                        data["user"]["display"] = "Аноним"
                        data["user"]["online"] = False
                        data["user"]["seen"] = 0
                    if privacy.get("avatar"):
                        data["user"]["avatar"] = ""
                    if privacy.get("playlists"):
                        data["playlists"] = []
                        omitted.append("playlists")
                    if privacy.get("likes"):
                        data["likes"] = []
                        omitted.append("likes")
                    if privacy.get("badges"):
                        data["badges"] = []
                        omitted.append("badges")
                    data["omitted"] = omitted
                return self._json(data)
            m = re.fullmatch(r"/api/p/([A-Za-z0-9_.-]{2,24})/([^/]+)", path)
            if m:
                me = self._me()
                data = public_playlist(m.group(1), m.group(2), me["id"] if me else None)
                if not data:
                    return self._json({"error": "not found"}, 404)
                data["mine"] = bool(
                    me and (me.get("handle") or "").lower() == data["owner"]["handle"])
                return self._json(data)
            if path == "/api/playlists":
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    pls = con.execute(
                        "SELECT * FROM playlists WHERE user_id=? ORDER BY id",
                        (u["id"],)).fetchall()
                    slug_map = _assign_slugs(pls)
                    out = []
                    for p in pls:
                        n = con.execute(
                            "SELECT COUNT(*) c FROM playlist_items WHERE playlist_id=?",
                            (p["id"],)).fetchone()["c"]
                        cover = con.execute(
                            "SELECT thumb FROM playlist_items WHERE playlist_id=? "
                            "ORDER BY pos LIMIT 1", (p["id"],)).fetchone()
                        listed = bool(con.execute(
                            "SELECT 1 FROM market_listings WHERE playlist_id=?",
                            (p["id"],)).fetchone())
                        need = _origin_need(con, p)
                        clone = bool(_ug(p, "origin_id", None))
                        out.append({"id": p["id"], "name": p["name"], "count": n,
                                    "slug": slug_map.get(p["id"], _playlist_slug(p["name"])),
                                    "cover": (cover["thumb"] if cover else "") or "",
                                    "custom_cover": cover_url(p["cover"] or ""),
                                    "listed": listed,
                                    "clone": clone,
                                    "need": need,
                                    "can_publish": (not listed) and int(n or 0) > 0 and not need})
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
                    allpl = con.execute(
                        "SELECT id, name FROM playlists WHERE user_id=? ORDER BY id",
                        (u["id"],)).fetchall()
                    slugs = _assign_slugs(allpl)
                return self._json({"id": pl["id"], "name": pl["name"],
                                   "slug": slugs.get(pl["id"], _playlist_slug(pl["name"])),
                                   "handle": (u.get("handle") or u.get("username") or "").lower(),
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
                tracks = recommendations(u["id"], n)
                return self._json({"tracks": tracks,
                                   "building": not tracks and u["id"] in _reco_busy})
            if path.startswith("/covers/"):
                fn = path.rsplit("/", 1)[-1]
                am = re.fullmatch(r"u(\d+)-\d+\.(jpg|jpeg|png|webp|gif)", fn or "")
                if am:
                    with _db_lock, db() as con:
                        row = con.execute("SELECT data, ctype FROM avatars WHERE user_id=?",
                                          (int(am.group(1)),)).fetchone()
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
            if _SPA_PATH.match(path):
                self.path = "/index.html"
            return super().do_GET()
        except yt_dlp.utils.DownloadError as e:
            return self._json({"error": f"yt-dlp: {str(e)[:200]}"}, 502)
        except Exception as e:  # keep the box alive no matter what
            return self._json({"error": f"{type(e).__name__}: {str(e)[:200]}"}, 500)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            # Raw-binary routes read the body themselves — pre-reading here
            # as JSON would starve their read and hang the request forever.
            is_cover = re.fullmatch(r"/api/playlists/(\d+)/cover", path)
            is_bin = bool(is_cover) or path in ("/api/me/avatar", "/api/friends/chat/file")
            body = {} if is_bin else self._body()
            if path == "/api/musely":
                return self._post_musely(body)
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
                    h = unique_handle(con, username)
                    cur = con.execute(
                        "INSERT INTO users(username,pass,salt,display,created,handle) "
                        "VALUES(?,?,?,?,?,?)", (username, pw, salt, username, time.time(), h))
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
            if path == "/api/presence":
                u = self._need_user()
                if not u:
                    return
                listening = body.get("listening") or ""
                if not isinstance(listening, str):
                    listening = ""
                away = bool(body.get("away"))
                try:
                    seq = int(body.get("seq") or 0)
                except (TypeError, ValueError):
                    seq = 0
                with _db_lock, db() as con:
                    _set_presence(con, u["id"], listening, away=away, seq=seq)
                return self._json({"ok": True})
            if path == "/api/push/sub":
                u = self._need_user()
                if not u:
                    return
                endpoint = str(body.get("endpoint") or "").strip()
                keys = body.get("keys") if isinstance(body.get("keys"), dict) else {}
                p256dh = str(keys.get("p256dh") or "").strip()
                auth = str(keys.get("auth") or "").strip()
                if not endpoint.startswith("https://") or len(endpoint) > 1024:
                    return self._json({"error": "bad endpoint"}, 400)
                if not re.fullmatch(r"[A-Za-z0-9_-]{20,200}", p256dh or ""):
                    return self._json({"error": "bad p256dh"}, 400)
                if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", auth or ""):
                    return self._json({"error": "bad auth"}, 400)
                uid = int(u["id"])
                with _db_lock, db() as con:
                    con.execute("DELETE FROM push_subs WHERE endpoint=?", (endpoint,))
                    con.execute(
                        "INSERT INTO push_subs(endpoint,user_id,p256dh,auth,created) "
                        "VALUES(?,?,?,?,?)",
                        (endpoint, uid, p256dh, auth, time.time()))
                    extra = [r["endpoint"] for r in con.execute(
                        "SELECT endpoint FROM push_subs WHERE user_id=? "
                        "ORDER BY created DESC", (uid,)).fetchall()]
                    for ep in extra[8:]:
                        con.execute("DELETE FROM push_subs WHERE endpoint=?", (ep,))
                return self._json({"ok": True})
            if path == "/api/push/unsub":
                u = self._need_user()
                if not u:
                    return
                endpoint = str(body.get("endpoint") or "").strip()
                if not endpoint:
                    return self._json({"error": "bad endpoint"}, 400)
                with _db_lock, db() as con:
                    con.execute(
                        "DELETE FROM push_subs WHERE user_id=? AND endpoint=?",
                        (int(u["id"]), endpoint))
                return self._json({"ok": True})
            m = re.fullmatch(r"/api/p/([A-Za-z0-9_.-]{2,24})/([^/]+)/take", path)
            if m:
                u = self._need_user()
                if not u:
                    return
                data, err = take_public_playlist(u["id"], m.group(1), m.group(2))
                if err:
                    return self._json({"error": err}, 404 if err == "not found" else 400)
                return self._json(data)
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
                    slugs = _assign_slugs(con.execute(
                        "SELECT id, name FROM playlists WHERE user_id=? ORDER BY id",
                        (u["id"],)).fetchall())
                return self._json({"id": pid, "name": name, "count": 0, "cover": "",
                                   "slug": slugs.get(pid, _playlist_slug(name))})
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
            if path == "/api/clientlog":
                ua = (self.headers.get("User-Agent") or "")[:70]
                for line in (body.get("lines") or [])[:40]:
                    print(f"clientlog [{ua}] {str(line)[:200]}", flush=True)
                return self._json({"ok": True})
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
            if path == "/api/me/avatar":
                u = self._need_user()
                if not u:
                    return
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
                fn = f"u{u['id']}-{int(time.time())}{ext}"
                with _db_lock, db() as con:
                    con.execute(
                        "INSERT INTO avatars(user_id,data,ctype) VALUES(?,?,?) "
                        "ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,"
                        " ctype=excluded.ctype", (u["id"], data, ctype))
                    con.execute("UPDATE users SET avatar=? WHERE id=?", (fn, u["id"]))
                    r = con.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
                return self._json({"ok": True, "avatar": cover_url(fn), "user": row_user(r)})
            if path == "/api/friends/chat/file":
                u = self._need_user()
                if not u:
                    return
                kind = (self.headers.get("X-Muse-Kind") or "").strip()
                if kind not in CHAT_FILE_KINDS:
                    return self._json({"error": "bad kind"}, 400)
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                except ValueError:
                    n = 0
                cap = CHAT_MAX.get(kind, 8_000_000)
                if n <= 0 or n > cap:
                    return self._json({"error": "file too big"}, 400)
                try:
                    data = self.rfile.read(n)
                except Exception:
                    return self._json({"error": "unreadable upload"}, 400)
                ext, ctype = _media_sniff(data, kind)
                if not ext:
                    return self._json({"error": "bad file"}, 400)
                if kind in ("image",) and not (ctype or "").startswith("image/"):
                    return self._json({"error": "not an image"}, 400)
                if kind in ("voice", "audio") and "webm" in (ctype or ""):
                    ctype = "audio/webm"
                if kind in ("voice", "audio") and "mp4" in (ctype or ""):
                    ctype = "audio/mp4"
                if kind in ("video", "round") and ctype in ("audio/mp4", "audio/mpeg"):
                    ctype = "video/mp4"
                if kind == "gif" and ctype not in (
                        "image/gif", "image/webp", "video/mp4", "video/webm"):
                    return self._json({"error": "not a gif"}, 400)
                try:
                    dur = float(self.headers.get("X-Muse-Duration") or 0)
                except (TypeError, ValueError):
                    dur = 0
                dur = max(0.0, min(300.0, dur))
                key = secrets.token_hex(16)
                os.makedirs(CHAT_DIR, exist_ok=True)
                full = os.path.join(CHAT_DIR, f"{key}{ext}")
                with open(full, "wb") as f:
                    f.write(data)
                full, ext, ctype = _chat_normalize(full, kind, ext, ctype)
                name = os.path.basename(full)
                try:
                    n = os.path.getsize(full)
                except OSError:
                    n = 0
                with _db_lock, db() as con:
                    con.execute(
                        "INSERT INTO chat_files(user_id,kind,key,name,ctype,size,duration,created) "
                        "VALUES(?,?,?,?,?,?,?,?)",
                        (u["id"], kind, key, name, ctype, n, dur, time.time()))
                return self._json({
                    "ok": True, "file": key, "url": _chat_file_url(key),
                    "ctype": ctype, "duration": dur,
                })
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
            if path == "/api/market":
                u = self._need_user()
                if not u:
                    return
                pid = int(body.get("playlist_id") or 0)
                if pid <= 0:
                    return self._json({"error": "bad playlist"}, 400)
                with _db_lock, db() as con:
                    pl = con.execute(
                        "SELECT * FROM playlists WHERE id=? AND user_id=?",
                        (pid, u["id"])).fetchone()
                    if not pl:
                        return self._json({"error": "no such playlist"}, 404)
                    n = int(con.execute(
                        "SELECT COUNT(*) c FROM playlist_items WHERE playlist_id=?",
                        (pid,)).fetchone()["c"] or 0)
                    if n < 1:
                        return self._json({"error": "playlist is empty"}, 400)
                    need = _origin_need(con, pl)
                    if need:
                        bits = {"name": "название", "cover": "обложку", "tracks": "состав треков"}
                        msg = "Смени " + ", ".join(bits[k] for k in need if k in bits)
                        return self._json({"error": msg or "Сначала переделай плейлист", "need": need}, 400)
                    vids = _pl_vids(con, pid)
                    if _dup_market_set(con, u["id"], pid, vids):
                        return self._json({
                            "error": "Этот набор треков уже в маркетплейсе. Добавь и убери песни.",
                        }, 400)
                    listed_n = int(con.execute(
                        "SELECT COUNT(*) c FROM market_listings WHERE user_id=?",
                        (u["id"],)).fetchone()["c"] or 0)
                    if listed_n >= 20:
                        return self._json({"error": "limit 20 published playlists"}, 400)
                    if con.execute(
                            "SELECT 1 FROM market_listings WHERE playlist_id=?",
                            (pid,)).fetchone():
                        return self._json({"ok": True, "already": True})
                    con.execute(
                        "INSERT INTO market_listings(playlist_id,user_id,created) VALUES(?,?,?)",
                        (pid, u["id"], time.time()))
                    card = _listing_card(con, pid, u["id"])
                return self._json({"ok": True, "listing": card})
            if path == "/api/market/unpublish":
                u = self._need_user()
                if not u:
                    return
                pid = int(body.get("playlist_id") or 0)
                with _db_lock, db() as con:
                    con.execute(
                        "DELETE FROM market_listings WHERE playlist_id=? AND user_id=?",
                        (pid, u["id"]))
                    con.execute("DELETE FROM market_likes WHERE playlist_id=?", (pid,))
                return self._json({"ok": True})
            if path == "/api/market/like":
                u = self._need_user()
                if not u:
                    return
                pid = int(body.get("playlist_id") or 0)
                with _db_lock, db() as con:
                    if not con.execute(
                            "SELECT 1 FROM market_listings WHERE playlist_id=?",
                            (pid,)).fetchone():
                        return self._json({"error": "not found"}, 404)
                    row = con.execute(
                        "SELECT 1 FROM market_likes WHERE user_id=? AND playlist_id=?",
                        (u["id"], pid)).fetchone()
                    if row:
                        con.execute(
                            "DELETE FROM market_likes WHERE user_id=? AND playlist_id=?",
                            (u["id"], pid))
                        liked = False
                    else:
                        con.execute(
                            "INSERT INTO market_likes(user_id,playlist_id,created) VALUES(?,?,?)",
                            (u["id"], pid, time.time()))
                        liked = True
                        owner = con.execute(
                            "SELECT user_id FROM market_listings WHERE playlist_id=?",
                            (pid,)).fetchone()
                        if owner and int(owner["user_id"]) != int(u["id"]):
                            pname = con.execute(
                                "SELECT name FROM playlists WHERE id=?", (pid,)).fetchone()
                            nm = (pname["name"] if pname else "плейлист")[:40]
                            _push_notif(
                                con, owner["user_id"], "like", u, "Лайк",
                                f"{_who(u)} лайкнул «{nm}»",
                                {"playlist_id": pid})
                    n = int(con.execute(
                        "SELECT COUNT(*) c FROM market_likes WHERE playlist_id=?",
                        (pid,)).fetchone()["c"] or 0)
                return self._json({"ok": True, "liked": liked, "likes": n})
            if path == "/api/friends/request":
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    other = _handle_user(con, body.get("handle"))
                    if not other:
                        return self._json({"error": "user not found"}, 404)
                    if int(other["id"]) == int(u["id"]):
                        return self._json({"error": "that's you"}, 400)
                    st = friend_status(con, u["id"], other["id"])
                    if st == "friends":
                        return self._json({"ok": True, "status": "friends"})
                    if st == "outgoing":
                        return self._json({"ok": True, "status": "outgoing"})
                    if st == "incoming":
                        lo, hi = _pair(u["id"], other["id"])
                        con.execute(
                            "DELETE FROM friend_reqs WHERE (from_id=? AND to_id=?) "
                            "OR (from_id=? AND to_id=?)",
                            (u["id"], other["id"], other["id"], u["id"]))
                        con.execute(
                            "INSERT INTO friends(a,b,created) VALUES(?,?,?)",
                            (lo, hi, time.time()))
                        _push_notif(
                            con, other["id"], "accept", u, "Новый друг",
                            f"{_who(u)} принял заявку",
                            {"handle": (u.get("handle") or "")})
                        return self._json({"ok": True, "status": "friends"})
                    con.execute(
                        "INSERT INTO friend_reqs(from_id,to_id,created) VALUES(?,?,?)",
                        (u["id"], other["id"], time.time()))
                    _push_notif(
                        con, other["id"], "request", u, "Заявка в друзья",
                        f"{_who(u)} хочет добавить тебя",
                        {"handle": (u.get("handle") or "")})
                return self._json({"ok": True, "status": "outgoing"})
            if path == "/api/friends/accept":
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    other = _handle_user(con, body.get("handle"))
                    if not other:
                        return self._json({"error": "user not found"}, 404)
                    req = con.execute(
                        "SELECT 1 FROM friend_reqs WHERE from_id=? AND to_id=?",
                        (other["id"], u["id"])).fetchone()
                    if not req:
                        return self._json({"error": "no request"}, 404)
                    lo, hi = _pair(u["id"], other["id"])
                    con.execute(
                        "DELETE FROM friend_reqs WHERE (from_id=? AND to_id=?) "
                        "OR (from_id=? AND to_id=?)",
                        (u["id"], other["id"], other["id"], u["id"]))
                    if not con.execute(
                            "SELECT 1 FROM friends WHERE a=? AND b=?", (lo, hi)).fetchone():
                        con.execute(
                            "INSERT INTO friends(a,b,created) VALUES(?,?,?)",
                            (lo, hi, time.time()))
                    _push_notif(
                        con, other["id"], "accept", u, "Новый друг",
                        f"{_who(u)} принял заявку",
                        {"handle": (u.get("handle") or "")})
                return self._json({"ok": True, "status": "friends"})
            if path == "/api/friends/decline":
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    other = _handle_user(con, body.get("handle"))
                    if not other:
                        return self._json({"error": "user not found"}, 404)
                    con.execute(
                        "DELETE FROM friend_reqs WHERE from_id=? AND to_id=?",
                        (other["id"], u["id"]))
                return self._json({"ok": True})
            if path == "/api/friends/remove":
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    other = _handle_user(con, body.get("handle"))
                    if not other:
                        return self._json({"error": "user not found"}, 404)
                    lo, hi = _pair(u["id"], other["id"])
                    con.execute("DELETE FROM friends WHERE a=? AND b=?", (lo, hi))
                    con.execute(
                        "DELETE FROM friend_reqs WHERE (from_id=? AND to_id=?) "
                        "OR (from_id=? AND to_id=?)",
                        (u["id"], other["id"], other["id"], u["id"]))
                return self._json({"ok": True})
            if path == "/api/friends/typing":
                u = self._need_user()
                if not u:
                    return
                with _db_lock, db() as con:
                    other = _handle_user(con, body.get("handle"))
                    if not other:
                        return self._json({"error": "not found"}, 404)
                    if friend_status(con, u["id"], other["id"]) != "friends":
                        return self._json({"error": "not friends"}, 403)
                    lo, hi = _pair(u["id"], other["id"])
                _set_typing(lo, hi, u["id"])
                return self._json({"ok": True})
            if path == "/api/friends/chat/read":
                u = self._need_user()
                if not u:
                    return
                try:
                    last_id = int(body.get("last_id") or 0)
                except (TypeError, ValueError):
                    last_id = 0
                with _db_lock, db() as con:
                    other = _handle_user(con, body.get("handle"))
                    if not other:
                        return self._json({"error": "not found"}, 404)
                    if friend_status(con, u["id"], other["id"]) != "friends":
                        return self._json({"error": "not friends"}, 403)
                    lo, hi = _pair(u["id"], other["id"])
                    _mark_chat_read(con, lo, hi, u["id"], last_id)
                    peer_read = _peer_read_id(con, lo, hi, other["id"])
                return self._json({"ok": True, "peer_read": peer_read})
            if path == "/api/friends/chat/edit":
                u = self._need_user()
                if not u:
                    return
                try:
                    mid = int(body.get("id") or 0)
                except (TypeError, ValueError):
                    mid = 0
                text = (body.get("body") or "").strip()[:2000]
                if not mid or not text:
                    return self._json({"error": "empty"}, 400)
                with _db_lock, db() as con:
                    r = con.execute("SELECT * FROM chat_msgs WHERE id=?", (mid,)).fetchone()
                    if not r or int(r["sender_id"]) != int(u["id"]):
                        return self._json({"error": "not found"}, 404)
                    if int(_ug(r, "deleted", 0) or 0):
                        return self._json({"error": "gone"}, 400)
                    now = time.time()
                    con.execute(
                        "UPDATE chat_msgs SET body=?, edited=1, edited_at=?, updated=? WHERE id=?",
                        (text, now, now, mid))
                    r = con.execute("SELECT * FROM chat_msgs WHERE id=?", (mid,)).fetchone()
                    peer = int(r["hi"] if int(r["lo"]) == int(u["id"]) else r["lo"])
                    peer_read = _peer_read_id(con, r["lo"], r["hi"], peer)
                    msg = _pack_msg(con, r, u["id"], peer_read)
                return self._json({"ok": True, "message": msg})
            if path == "/api/friends/chat/react":
                u = self._need_user()
                if not u:
                    return
                try:
                    mid = int(body.get("id") or 0)
                except (TypeError, ValueError):
                    mid = 0
                emoji = (body.get("emoji") or "").strip()
                if not mid or emoji not in CHAT_REACTS:
                    return self._json({"error": "bad react"}, 400)
                uid = int(u["id"])
                with _db_lock, db() as con:
                    r = con.execute("SELECT * FROM chat_msgs WHERE id=?", (mid,)).fetchone()
                    if not r:
                        return self._json({"error": "not found"}, 404)
                    if int(r["lo"]) != uid and int(r["hi"]) != uid:
                        return self._json({"error": "not found"}, 404)
                    if int(_ug(r, "deleted", 0) or 0):
                        return self._json({"error": "gone"}, 400)
                    peer = int(r["hi"] if int(r["lo"]) == uid else r["lo"])
                    if friend_status(con, uid, peer) != "friends":
                        return self._json({"error": "not friends"}, 403)
                    now = time.time()
                    have = con.execute(
                        "SELECT emoji FROM chat_reacts WHERE msg_id=? AND user_id=?",
                        (mid, uid)).fetchone()
                    if have and (have["emoji"] if hasattr(have, "keys") else have[0]) == emoji:
                        con.execute(
                            "DELETE FROM chat_reacts WHERE msg_id=? AND user_id=?",
                            (mid, uid))
                    else:
                        con.execute(
                            "DELETE FROM chat_reacts WHERE msg_id=? AND user_id=?",
                            (mid, uid))
                        con.execute(
                            "INSERT INTO chat_reacts(msg_id, user_id, emoji, created) "
                            "VALUES(?,?,?,?)",
                            (mid, uid, emoji, now))
                    con.execute("UPDATE chat_msgs SET updated=? WHERE id=?", (now, mid))
                    r = con.execute("SELECT * FROM chat_msgs WHERE id=?", (mid,)).fetchone()
                    peer_read = _peer_read_id(con, r["lo"], r["hi"], peer)
                    msg = _pack_msg(con, r, uid, peer_read)
                return self._json({"ok": True, "message": msg})
            if path == "/api/friends/chat/delete":
                u = self._need_user()
                if not u:
                    return
                try:
                    mid = int(body.get("id") or 0)
                except (TypeError, ValueError):
                    mid = 0
                if not mid:
                    return self._json({"error": "bad id"}, 400)
                with _db_lock, db() as con:
                    r = con.execute("SELECT * FROM chat_msgs WHERE id=?", (mid,)).fetchone()
                    if not r or int(r["sender_id"]) != int(u["id"]):
                        return self._json({"error": "not found"}, 404)
                    now = time.time()
                    con.execute("DELETE FROM chat_reacts WHERE msg_id=?", (mid,))
                    con.execute(
                        "UPDATE chat_msgs SET deleted=1, body='', payload='{}', updated=? WHERE id=?",
                        (now, mid))
                    r = con.execute("SELECT * FROM chat_msgs WHERE id=?", (mid,)).fetchone()
                    peer = int(r["hi"] if int(r["lo"]) == int(u["id"]) else r["lo"])
                    peer_read = _peer_read_id(con, r["lo"], r["hi"], peer)
                    msg = _pack_msg(con, r, u["id"], peer_read)
                return self._json({"ok": True, "message": msg})
            if path == "/api/friends/chat":
                u = self._need_user()
                if not u:
                    return
                kind = (body.get("kind") or "text").strip()
                if kind not in CHAT_KINDS:
                    return self._json({"error": "bad kind"}, 400)
                raw = body.get("payload") if isinstance(body.get("payload"), dict) else {}
                text = (body.get("body") or "").strip()[:2000]
                try:
                    reply_to = int(body.get("reply_to") or 0)
                except (TypeError, ValueError):
                    reply_to = 0
                if kind == "text" and not text:
                    return self._json({"error": "empty"}, 400)
                with _db_lock, db() as con:
                    other = _handle_user(con, body.get("handle"))
                    if not other:
                        return self._json({"error": "not found"}, 404)
                    if friend_status(con, u["id"], other["id"]) != "friends":
                        return self._json({"error": "not friends"}, 403)
                    lo, hi = _pair(u["id"], other["id"])
                    if reply_to:
                        rr = con.execute(
                            "SELECT id FROM chat_msgs WHERE id=? AND lo=? AND hi=?",
                            (reply_to, lo, hi)).fetchone()
                        if not rr:
                            reply_to = 0
                    payload = {}
                    if kind == "song":
                        vid = raw.get("id") or ""
                        if not re.fullmatch(r"[\w-]{11}", str(vid)):
                            return self._json({"error": "bad song"}, 400)
                        payload = {
                            "id": vid,
                            "title": str(raw.get("title") or "Song")[:200],
                            "thumbnail": str(raw.get("thumbnail") or "")[:500],
                            "duration": raw.get("duration"),
                        }
                    elif kind == "playlist":
                        handle = str(raw.get("handle") or "").strip().lower().lstrip("@")
                        slug = str(raw.get("slug") or "").strip()
                        if not handle or not slug:
                            return self._json({"error": "bad playlist"}, 400)
                        payload = {
                            "id": int(raw.get("id") or 0),
                            "name": str(raw.get("name") or "Playlist")[:80],
                            "handle": handle,
                            "slug": slug,
                            "cover": str(raw.get("cover") or raw.get("custom_cover") or "")[:500],
                            "count": int(raw.get("count") or 0),
                        }
                    elif kind == "profile":
                        handle = str(raw.get("handle") or u.get("handle") or "").strip().lower().lstrip("@")
                        if not valid_handle(handle):
                            return self._json({"error": "bad profile"}, 400)
                        who = _handle_user(con, handle)
                        if not who:
                            return self._json({"error": "no such profile"}, 404)
                        flags = _profile_privacy(who)
                        hue = int(_ug(who, "hue", 145) or 145)
                        if flags["hidden"]:
                            payload = {
                                "handle": handle, "display": "", "avatar": "",
                                "hue": hue, "hidden": True,
                            }
                        else:
                            display = "Аноним" if flags["anon"] else (
                                _ug(who, "display", "") or who["username"] or handle)
                            av = "" if flags["avatar"] else cover_url(_ug(who, "avatar", "") or "")
                            payload = {
                                "handle": handle,
                                "display": str(display)[:40],
                                "avatar": av[:500],
                                "hue": hue,
                            }
                    elif kind == "gif" and raw.get("url") and not raw.get("file"):
                        src = str(raw.get("url") or "")
                        if not _gif_ok(src):
                            return self._json({"error": "bad gif"}, 400)
                        prev = str(raw.get("preview") or src)
                        payload = {
                            "url": src[:500],
                            "preview": prev[:500] if _gif_ok(prev) else src[:500],
                            "w": int(raw.get("w") or 0),
                            "h": int(raw.get("h") or 0),
                        }
                    elif kind in CHAT_FILE_KINDS:
                        payload = _file_payload(con, u["id"], kind, raw)
                        if not payload:
                            return self._json({"error": "bad file"}, 400)
                    now = time.time()
                    cur = con.execute(
                        "INSERT INTO chat_msgs(lo,hi,sender_id,kind,body,payload,created,"
                        "reply_to,edited,deleted,updated) VALUES(?,?,?,?,?,?,?,?,0,0,?)",
                        (lo, hi, u["id"], kind, text,
                         json.dumps(payload, ensure_ascii=False), now, reply_to or None, now))
                    mid = int(cur.lastrowid or 0)
                    if not mid:
                        row = con.execute(
                            "SELECT id FROM chat_msgs WHERE lo=? AND hi=? AND sender_id=? "
                            "ORDER BY id DESC LIMIT 1", (lo, hi, u["id"])).fetchone()
                        mid = int(row["id"]) if row else 0
                    r = con.execute("SELECT * FROM chat_msgs WHERE id=?", (mid,)).fetchone()
                    preview = text or CHAT_PREVIEW.get(kind) or "новое сообщение"
                    _push_notif(
                        con, other["id"], "chat", u, _who(u), preview[:200],
                        {"handle": (u.get("handle") or "")})
                    msg = _pack_msg(con, r, u["id"], _peer_read_id(con, lo, hi, other["id"])) if r else {
                        "id": mid, "mine": True, "kind": kind, "body": text,
                        "payload": payload, "created": now, "reply": None,
                        "edited": False, "deleted": False, "read": False,
                    }
                return self._json({"ok": True, "message": msg})
            if path == "/api/notifs/seen":
                u = self._need_user()
                if not u:
                    return
                uid = int(u["id"])
                with _db_lock, db() as con:
                    if body.get("all"):
                        con.execute(
                            "UPDATE notifs SET seen=1 WHERE user_id=? AND seen=0",
                            (uid,))
                    elif body.get("handle"):
                        other = _handle_user(con, body.get("handle"))
                        if other:
                            con.execute(
                                "UPDATE notifs SET seen=1 WHERE user_id=? AND from_id=? "
                                "AND kind='chat' AND seen=0",
                                (uid, int(other["id"])))
                    else:
                        raw = body.get("ids") or []
                        ids = []
                        for x in raw[:80]:
                            try:
                                ids.append(int(x))
                            except (TypeError, ValueError):
                                pass
                        for i in ids:
                            con.execute(
                                "UPDATE notifs SET seen=1 WHERE id=? AND user_id=?",
                                (i, uid))
                    unseen = int(con.execute(
                        "SELECT COUNT(*) c FROM notifs WHERE user_id=? AND seen=0",
                        (uid,)).fetchone()["c"] or 0)
                return self._json({"ok": True, "unseen": unseen})
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
                new_handle = body.get("handle")
                h = None
                if new_handle is not None:
                    h = (new_handle or "").strip().lower().lstrip("@")
                    if not valid_handle(h):
                        return self._json({"error": "handle: 2-24 letters, digits, _ ."}, 400)
                with _db_lock, db() as con:
                    curu = con.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
                    if h is not None:
                        cur_h = (_ug(curu, "handle", "") or "").strip().lower()
                        if h != cur_h:
                            wait = handle_wait(curu)
                            if wait > 0:
                                days = max(1, (wait + 86399) // 86400)
                                return self._json({
                                    "error": f"handle can change in {days}d",
                                    "wait": wait,
                                }, 429)
                            if handle_taken(con, h, u["id"]):
                                return self._json({"error": "handle taken"}, 409)
                            con.execute(
                                "UPDATE users SET handle=?, handle_at=? WHERE id=?",
                                (h, time.time(), u["id"]))
                    if display:
                        con.execute("UPDATE users SET display=? WHERE id=?", (display, u["id"]))
                    if accent:
                        con.execute("UPDATE users SET accent=? WHERE id=?", (accent, u["id"]))
                    if hue is not None:
                        con.execute("UPDATE users SET hue=? WHERE id=?", (hue, u["id"]))
                    priv = body.get("privacy")
                    if isinstance(priv, dict):
                        cols = {
                            "hidden": "profile_hidden",
                            "anon": "profile_anon",
                            "playlists": "hide_playlists",
                            "likes": "hide_likes",
                            "badges": "hide_badges",
                            "avatar": "hide_avatar",
                        }
                        sets, vals = [], []
                        for key, col in cols.items():
                            if key not in priv:
                                continue
                            sets.append(f"{col}=?")
                            vals.append(1 if priv.get(key) else 0)
                        if sets:
                            con.execute(
                                f"UPDATE users SET {', '.join(sets)} WHERE id=?",
                                (*vals, u["id"]))
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
                    slugs = _assign_slugs(con.execute(
                        "SELECT id, name FROM playlists WHERE user_id=? ORDER BY id",
                        (u["id"],)).fetchall())
                return self._json({"ok": True, "name": name,
                                   "slug": slugs.get(int(m.group(1)), _playlist_slug(name))})
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
            if (p in ("/", "/index.html", "/sw.js", "/manifest.webmanifest",
                      "/pc", "/web", "/mobile/iphone", "/mobile/android",
                      "/market", "/friends")
                    or p.startswith("/app.") or p.startswith("/style.")
                    or p.startswith("/@")):
                self.send_header("Cache-Control", "no-store")
            self.send_header("Permissions-Policy", "camera=(self), microphone=(self)")
            self.send_header("Feature-Policy", "camera 'self'; microphone 'self'")
        except Exception:
            pass
        super().end_headers()

    def log_message(self, *args):
        pass  # stay quiet


def keep_awake():
    """Render's free tier sleeps after 15 idle minutes; a request through the
    public URL every 10 counts as traffic and keeps the instance warm."""
    n = 0
    while True:
        time.sleep(120)
        n += 1
        if DATABASE_URL:
            # Keeps the pooled Supabase connection open so the next real
            # request doesn't pay for a fresh TLS + auth handshake.
            try:
                with db() as con:
                    con.execute("SELECT 1").fetchone()
            except Exception as e:
                print(f"db keep-warm failed: {e}", flush=True)
        if n % 5 == 0:
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
    if not ON_RENDER and os.environ.get("MUSE_OPEN_BROWSER", "1") != "0":
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye.")


if __name__ == "__main__":
    main()
