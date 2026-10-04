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

export async function proxy(ctx) {
  const { request, env, waitUntil } = ctx;
  const url = new URL(request.url);
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
