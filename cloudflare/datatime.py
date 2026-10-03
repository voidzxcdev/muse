import http.cookiejar, json, sys, time, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://museapp.pages.dev"
USER = sys.argv[2] if len(sys.argv) > 2 else "zz_speedtest"
PASS = "speedtest-123"

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
UA = {"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"}


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=UA)
    t = time.time()
    try:
        with op.open(req, timeout=90) as r:
            out = r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        out, code = e.read(), e.code
    dt = time.time() - t
    print(f"{method:5} {path:38} {code} {dt:6.2f}s")
    try:
        return json.loads(out)
    except Exception:
        return {}


r = call("POST", "/api/login", {"username": USER, "password": PASS})
if "user" not in r:
    call("POST", "/api/signup", {"username": USER, "password": PASS})
call("GET", "/api/me")
p = call("GET", "/api/playlists")
if not p.get("playlists"):
    pl = call("POST", "/api/playlists", {"name": "speed"})
    for vid in ["J7p4bzqLvCw", "RmYCOm4ehKs", "bpOSxM0rNPM"]:
        call("POST", f"/api/playlists/{pl.get('id')}/tracks", {"video_id": vid, "title": vid})
    call("POST", "/api/like", {"video_id": "J7p4bzqLvCw", "title": "x"})
    p = call("GET", "/api/playlists")
call("GET", "/api/likes")
call("GET", "/api/survey")
call("GET", "/api/recommendations?n=12")
for pl in p.get("playlists", [])[:2]:
    call("GET", f"/api/playlists/{pl['id']}/tracks")
call("GET", "/api/liked_ids?ids=J7p4bzqLvCw,RmYCOm4ehKs")
call("GET", "/api/me")
call("GET", "/api/version")
