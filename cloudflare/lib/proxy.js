// Routes API traffic: accounts + library go to the Supabase Edge Function
// (muse-api), YouTube work goes to the Render backend (yt-dlp can't run on
// Workers). Same-origin to the browser, so the session cookie just works.
const DEFAULT_ORIGIN = "https://muse-xbrh.onrender.com";
const SEARCH_TTL = 600; // matches the backend's own search cache
const SESSION_TTL = 30 * 86400;

const LIBRARY = /^\/(covers\/|api\/(me|signup|login|logout|playlists|playlist-items|likes|liked_ids|like|survey|event)(\/|$))/;

function sessionCookie(req) {
  const m = /(?:^|;\s*)muse_session=([^;]+)/.exec(req.headers.get("cookie") || "");
  return m ? m[1] : "";
}

async function library({ request, env }, url) {
  const headers = new Headers({ authorization: `Bearer ${env.SUPABASE_ANON_KEY}` });
  for (const h of ["content-type", "content-length"]) {
    if (request.headers.get(h)) headers.set(h, request.headers.get(h));
  }
  const token = sessionCookie(request);
  if (token) headers.set("x-muse-session", token);
  const resp = await fetch(`${env.SUPABASE_FN}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });
  const out = new Response(resp.body, resp);
  const set = resp.headers.get("x-set-session");
  out.headers.delete("x-set-session");
  out.headers.delete("set-cookie");
  if (set !== null) {
    out.headers.append("set-cookie", set
      ? `muse_session=${set}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Lax`
      : "muse_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  }
  return out;
}

const VID = /^[\w-]{11}$/;
const AUDIO_TTL = 14 * 86400;

// Whole songs live in the edge cache so a locked phone can switch from the
// YouTube embed to <audio> instantly; Range reads are served from the copy.
async function audio({ request, env, waitUntil }, url) {
  const v = url.searchParams.get("v");
  const key = `${url.origin}/__audio/${v}`;
  const cache = caches.default;
  const range = request.headers.get("range");
  const hit = await cache.match(new Request(key, { headers: range ? { range } : {} }));
  if (hit) return hit;

  const origin = env.BACKEND_ORIGIN || DEFAULT_ORIGIN;
  const store = async () => {
    const up = await fetch(`${origin}/api/audio?v=${v}`, { headers: { "user-agent": "muse-edge" } });
    if (up.status !== 200 || !up.headers.get("content-length")) return false;
    const out = new Response(up.body, {
      headers: {
        "content-type": up.headers.get("content-type") || "audio/mp4",
        "content-length": up.headers.get("content-length"),
        "accept-ranges": "bytes",
        "cache-control": `public, max-age=${AUDIO_TTL}`,
      },
    });
    await cache.put(key, out);
    return true;
  };

  if (url.searchParams.has("warm")) {
    let ok = false;
    try { ok = await store(); } catch {}
    return new Response(null, { status: ok ? 204 : 502 });
  }
  if (!range || /^bytes=0-/.test(range)) waitUntil(store().catch(() => {}));
  const headers = new Headers(request.headers);
  headers.delete("host");
  return fetch(`${origin}/api/audio?v=${v}`, { headers });
}

export async function proxy(ctx) {
  const { request, env, waitUntil } = ctx;
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/audio" && VID.test(url.searchParams.get("v") || "")) {
    return audio(ctx, url);
  }
  const cacheable = request.method === "GET" && (url.pathname === "/api/search" || url.pathname.startsWith("/covers/"));
  const cache = caches.default;

  if (cacheable) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }

  let resp;
  if (LIBRARY.test(url.pathname)) {
    resp = await library(ctx, url);
  } else {
    const headers = new Headers(request.headers);
    headers.delete("host");
    resp = await fetch(new URL(url.pathname + url.search, env.BACKEND_ORIGIN || DEFAULT_ORIGIN), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
  }

  if (cacheable && resp.ok) {
    const out = new Response(resp.body, resp);
    if (url.pathname === "/api/search") out.headers.set("Cache-Control", `public, max-age=${SEARCH_TTL}`);
    waitUntil(cache.put(request, out.clone()));
    return out;
  }
  return resp;
}
