import json, sys, time, urllib.request, urllib.parse

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8090"

def get(path, rng=None):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "smoke"})
    if rng:
        req.add_header("Range", rng)
    t = time.time()
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read(200000)
        return r.status, time.time() - t, body, r.headers

s, dt, body, _ = get("/")
print("index", s, f"{dt:.2f}s", len(body), "bytes")
s, dt, body, _ = get("/api/version")
print("version", s, f"{dt:.2f}s", body[:80])
q = urllib.parse.quote("daft punk get lucky")
s, dt, body, _ = get(f"/api/search?q={q}")
print("search #1", s, f"{dt:.2f}s")
s, dt, body2, h = get(f"/api/search?q={q}")
print("search #2", s, f"{dt:.2f}s", "cf-cache:", h.get("cf-cache-status"))
data = json.loads(body)
items = data if isinstance(data, list) else (data.get("results") or data.get("items") or [])
print("results", len(items))
if items:
    vid = items[0].get("id") or items[0].get("videoId")
    s, dt, body, h = get(f"/api/play?v={vid}")
    print("play", s, f"{dt:.2f}s", body[:120])
    s, dt, body, h = get(f"/api/audio?v={vid}", rng="bytes=0-65535")
    print("audio", s, f"{dt:.2f}s", len(body), "bytes", h.get("content-type"))
