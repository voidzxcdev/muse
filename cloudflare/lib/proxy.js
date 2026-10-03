// Forwards API traffic to the Render backend (YouTube + accounts live there:
// yt-dlp can't run on Workers). Same-origin to the browser, so session
// cookies set by the backend just work.
const DEFAULT_ORIGIN = "https://muse-xbrh.onrender.com";
const SEARCH_TTL = 600; // matches the backend's own search cache

export async function proxy({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.BACKEND_ORIGIN || DEFAULT_ORIGIN);
  const cacheable = request.method === "GET" && url.pathname === "/api/search";
  const cache = caches.default;

  if (cacheable) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }

  const headers = new Headers(request.headers);
  headers.delete("host");
  const resp = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });

  if (cacheable && resp.ok) {
    const out = new Response(resp.body, resp);
    out.headers.set("Cache-Control", `public, max-age=${SEARCH_TTL}`);
    waitUntil(cache.put(request, out.clone()));
    return out;
  }
  return resp;
}
