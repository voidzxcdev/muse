// Accounts + library for Muse (everything that is only database work).
// Reached through the Cloudflare Pages function, which turns the browser's
// muse_session cookie into the x-muse-session header and back.
import postgres from "npm:postgres@3.4.5";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// Every function instance would hold its own direct connections and exhaust
// the 60 slots, so go through Supavisor's transaction pool instead.
const db = new URL(Deno.env.get("SUPABASE_DB_URL")!);
const sql = postgres({
  host: "aws-1-eu-central-1.pooler.supabase.com",
  port: 6543,
  database: "postgres",
  username: "postgres.ewfrnuevdhgspulgazvc",
  password: decodeURIComponent(db.password),
  ssl: "require",
  prepare: false,
  max: 1,
  idle_timeout: 10,
});

const SESSION_TTL = 30 * 86400;
const VID = /^[\w-]{11}$/;
const now = () => Date.now() / 1000;

const json = (obj: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...extra } });

const hashPass = (password: string, salt: Buffer) =>
  scryptSync(Buffer.from(password, "utf8"), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

const rowUser = (r: any) => ({
  id: r.id,
  username: r.username,
  display: r.display || r.username,
  accent: r.accent || "#1ed760",
  hue: r.hue ?? 145,
});

const coverUrl = (fn: string) => (fn ? `/covers/${fn}` : "");

function coverInfo(b: Uint8Array): [string, string] | [] {
  const s = (n: number, m: number) => String.fromCharCode(...b.subarray(n, m));
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return [".webp", "image/webp"];
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return [".jpg", "image/jpeg"];
  if (s(0, 8) === "\x89PNG\r\n\x1a\n") return [".png", "image/png"];
  if (s(0, 6) === "GIF87a" || s(0, 6) === "GIF89a") return [".gif", "image/gif"];
  return [];
}

async function createSession(userId: number) {
  const token = randomBytes(32).toString("hex");
  const t = now();
  await sql`INSERT INTO muse.sessions(token,user_id,created,expires) VALUES(${token},${userId},${t},${t + SESSION_TTL})`;
  return token;
}

async function sessionUser(token: string | null) {
  if (!token) return null;
  const t = now();
  const [s] = await sql`UPDATE muse.sessions SET expires=${t + SESSION_TTL}
    WHERE token=${token} AND expires >= ${t} RETURNING user_id`;
  if (!s) return null;
  const [u] = await sql`SELECT * FROM muse.users WHERE id=${s.user_id}`;
  return u ? rowUser(u) : null;
}

async function nextPlaylistName(userId: number) {
  const rows = await sql`SELECT name FROM muse.playlists WHERE user_id=${userId}`;
  let mx = 0;
  for (const r of rows) {
    const m = /^Плейлист (\d+)$/.exec((r.name || "").trim());
    if (m) mx = Math.max(mx, +m[1]);
  }
  return `Плейлист ${mx + 1}`;
}

function cleanList(v: unknown, limit = 12, size = 40) {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>(), out: string[] = [];
  for (const x of v) {
    const s = (typeof x === "string" ? x : "").trim().slice(0, size);
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
    if (out.length >= limit) break;
  }
  return out;
}

const num = (v: unknown) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/muse-api/, "");
  const method = req.method;
  const token = req.headers.get("x-muse-session");
  let m: RegExpExecArray | null;

  if (method === "GET" && (m = /^\/covers\/(\d+)-\d+\.(jpg|jpeg|png|webp|gif)$/.exec(path))) {
    const [row] = await sql`SELECT data, ctype FROM muse.covers WHERE playlist_id=${+m[1]}`;
    if (!row) return new Response(null, { status: 404 });
    return new Response(row.data, {
      headers: { "content-type": row.ctype, "cache-control": "public, max-age=31536000, immutable" },
    });
  }

  const isCover = /^\/api\/playlists\/\d+\/cover$/.test(path);
  const body: any = method === "GET" || isCover ? {} : await req.json().catch(() => ({}));
  const me = () => sessionUser(token);
  const needUser = async () => (await me()) ?? null;
  const unauth = () => json({ error: "sign in required" }, 401);

  if (method === "GET") {
    if (path === "/api/me") return json({ user: await me() });

    if (path === "/api/playlists") {
      const u = await needUser();
      if (!u) return unauth();
      const has = url.searchParams.get("has") || "";
      const rows = await sql`
        SELECT p.id, p.name, p.cover,
          (SELECT COUNT(*)::int FROM muse.playlist_items i WHERE i.playlist_id=p.id) AS count,
          (SELECT thumb FROM muse.playlist_items i WHERE i.playlist_id=p.id ORDER BY pos LIMIT 1) AS first,
          (SELECT id FROM muse.playlist_items i WHERE i.playlist_id=p.id AND i.video_id=${VID.test(has) ? has : ""} LIMIT 1) AS has_item
        FROM muse.playlists p WHERE p.user_id=${u.id} ORDER BY p.id`;
      return json({
        playlists: rows.map((p) => ({
          id: p.id, name: p.name, count: p.count, cover: p.first || "", custom_cover: coverUrl(p.cover || ""),
          has_item: p.has_item,
        })),
      });
    }

    if ((m = /^\/api\/playlists\/(\d+)\/tracks$/.exec(path))) {
      const u = await needUser();
      if (!u) return unauth();
      const [pl] = await sql`SELECT id, name, cover FROM muse.playlists WHERE id=${+m[1]} AND user_id=${u.id}`;
      if (!pl) return json({ error: "no such playlist" }, 404);
      const rows = await sql`SELECT id, video_id, title, thumb, duration FROM muse.playlist_items
        WHERE playlist_id=${pl.id} ORDER BY pos, id`;
      return json({
        id: pl.id, name: pl.name, custom_cover: coverUrl(pl.cover || ""),
        tracks: rows.map((r) => ({ item_id: r.id, id: r.video_id, title: r.title, thumbnail: r.thumb, duration: r.duration })),
      });
    }

    if (path === "/api/likes") {
      const u = await needUser();
      if (!u) return unauth();
      const rows = await sql`SELECT video_id, title, thumb, duration FROM muse.likes
        WHERE user_id=${u.id} ORDER BY pos ASC`;
      return json({ tracks: rows.map((r) => ({ id: r.video_id, title: r.title, thumbnail: r.thumb, duration: r.duration })) });
    }

    if (path === "/api/liked_ids") {
      const u = await me();
      const ids = (url.searchParams.get("ids") || "").split(",").filter((v) => VID.test(v));
      if (!u || !ids.length) return json({ liked: [] });
      const rows = await sql`SELECT video_id FROM muse.likes WHERE user_id=${u.id} AND video_id = ANY(${ids})`;
      return json({ liked: rows.map((r) => r.video_id) });
    }

    if (path === "/api/popular") {
      let n = 18;
      try { n = Math.max(6, Math.min(24, parseInt(url.searchParams.get("n") || "18", 10) || 18)); } catch { n = 18; }
      const rows = await sql`
        SELECT video_id, MAX(title) AS title, MAX(thumb) AS thumb, MAX(duration) AS duration, COUNT(*)::int AS c
        FROM muse.plays
        WHERE COALESCE(title, '') <> ''
        GROUP BY video_id
        ORDER BY c DESC, MAX(played_at) DESC
        LIMIT ${n}`;
      return json({
        tracks: rows.map((r) => ({
          id: r.video_id,
          title: r.title || r.video_id,
          thumbnail: r.thumb || `https://i.ytimg.com/vi/${r.video_id}/hqdefault.jpg`,
          duration: r.duration,
        })),
      });
    }

    if (path === "/api/survey") {
      const u = await needUser();
      if (!u) return unauth();
      const [s] = await sql`SELECT genres, moods, artists FROM muse.survey WHERE user_id=${u.id}`;
      if (!s) return json({ survey: null });
      try {
        return json({ survey: { genres: JSON.parse(s.genres || "[]"), moods: JSON.parse(s.moods || "[]"), artists: JSON.parse(s.artists || "[]") } });
      } catch {
        return json({ survey: null });
      }
    }
  }

  if (method === "POST") {
    if (path === "/api/signup") {
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!/^[A-Za-z0-9_.-]{2,24}$/.test(username)) return json({ error: "username: 2-24 letters, digits, _ . -" }, 400);
      if (password.length < 4) return json({ error: "password too short (min 4)" }, 400);
      const [taken] = await sql`SELECT 1 FROM muse.users WHERE username=${username}`;
      if (taken) return json({ error: "name taken" }, 409);
      const salt = randomBytes(16);
      const [r] = await sql`INSERT INTO muse.users(username,pass,salt,display,created)
        VALUES(${username},${hashPass(password, salt)},${salt},${username},${now()}) RETURNING *`;
      return json({ user: rowUser(r) }, 200, { "x-set-session": await createSession(r.id) });
    }

    if (path === "/api/login") {
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const [r] = await sql`SELECT * FROM muse.users WHERE username=${username}`;
      if (!r || !timingSafeEqual(hashPass(password, Buffer.from(r.salt)), Buffer.from(r.pass))) {
        return json({ error: "wrong name or password" }, 401);
      }
      return json({ user: rowUser(r) }, 200, { "x-set-session": await createSession(r.id) });
    }

    if (path === "/api/logout") {
      if (token) await sql`DELETE FROM muse.sessions WHERE token=${token}`;
      return json({ ok: true }, 200, { "x-set-session": "" });
    }

    if (path === "/api/playlists") {
      const u = await needUser();
      if (!u) return unauth();
      const name = String(body.name || "").trim().slice(0, 60) || (await nextPlaylistName(u.id));
      const [p] = await sql`INSERT INTO muse.playlists(user_id,name,created) VALUES(${u.id},${name},${now()}) RETURNING id`;
      return json({ id: p.id, name, count: 0, cover: "" });
    }

    if ((m = /^\/api\/playlists\/(\d+)\/tracks$/.exec(path))) {
      const u = await needUser();
      if (!u) return unauth();
      const v = String(body.video_id || "");
      if (!VID.test(v)) return json({ error: "bad video id" }, 400);
      const [pl] = await sql`SELECT id FROM muse.playlists WHERE id=${+m[1]} AND user_id=${u.id}`;
      if (!pl) return json({ error: "no such playlist" }, 404);
      const [dup] = await sql`SELECT 1 FROM muse.playlist_items WHERE playlist_id=${pl.id} AND video_id=${v}`;
      if (dup) return json({ ok: true, duplicate: true });
      const [it] = await sql`INSERT INTO muse.playlist_items(playlist_id,video_id,title,thumb,duration,pos)
        VALUES(${pl.id},${v},${String(body.title || "").slice(0, 200)},${String(body.thumbnail || "").slice(0, 500)},
          ${num(body.duration)},
          (SELECT COALESCE(MAX(pos),-1)+1 FROM muse.playlist_items WHERE playlist_id=${pl.id}))
        RETURNING id`;
      return json({ ok: true, item_id: it.id });
    }

    if (path === "/api/event") {
      const u = await me();
      if (!u) return json({ ok: true });
      const v = String(body.video_id || "");
      if (!VID.test(v)) return json({ error: "bad video id" }, 400);
      const pos = num(body.position) ?? 0;
      const dur = num(body.duration);
      const title = String(body.title || "").slice(0, 200);
      const uploader = String(body.uploader || "").slice(0, 200);
      const thumb = String(body.thumbnail || "").slice(0, 500);
      if (body.type === "complete") {
        const r = await sql`UPDATE muse.plays SET completed=1, position=${pos} WHERE user_id=${u.id} AND video_id=${v}`;
        if (!r.count) {
          await sql`INSERT INTO muse.plays(user_id,video_id,title,uploader,thumb,duration,position,completed,played_at)
            VALUES(${u.id},${v},${title},${uploader},${thumb},${dur},${pos},1,${now()})`;
        }
      } else {
        await sql`INSERT INTO muse.plays(user_id,video_id,title,uploader,thumb,duration,position,completed,played_at)
          VALUES(${u.id},${v},${title},${uploader},${thumb},${dur},${pos},0,${now()})`;
      }
      return json({ ok: true });
    }

    if (path === "/api/survey") {
      const u = await needUser();
      if (!u) return unauth();
      const genres = cleanList(body.genres), moods = cleanList(body.moods), artists = cleanList(body.artists);
      await sql`INSERT INTO muse.survey(user_id,genres,moods,artists,created)
        VALUES(${u.id},${JSON.stringify(genres)},${JSON.stringify(moods)},${JSON.stringify(artists)},${now()})
        ON CONFLICT(user_id) DO UPDATE SET genres=excluded.genres, moods=excluded.moods,
          artists=excluded.artists, created=excluded.created`;
      return json({ ok: true, survey: { genres, moods, artists } });
    }

    if ((m = /^\/api\/playlists\/(\d+)\/cover$/.exec(path))) {
      const u = await needUser();
      if (!u) return unauth();
      const data = new Uint8Array(await req.arrayBuffer());
      if (!data.length || data.length > 8_000_000) return json({ error: "bad upload" }, 400);
      const [ext, ctype] = coverInfo(data);
      if (!ext) return json({ error: "not an image" }, 400);
      const pid = +m[1];
      const [pl] = await sql`SELECT id FROM muse.playlists WHERE id=${pid} AND user_id=${u.id}`;
      if (!pl) return json({ error: "no such playlist" }, 404);
      const fn = `${pid}-${Math.floor(now())}${ext}`;
      await sql.begin(async (tx) => {
        await tx`INSERT INTO muse.covers(playlist_id,data,ctype) VALUES(${pid},${Buffer.from(data)},${ctype})
          ON CONFLICT(playlist_id) DO UPDATE SET data=excluded.data, ctype=excluded.ctype`;
        await tx`UPDATE muse.playlists SET cover=${fn} WHERE id=${pid}`;
      });
      return json({ ok: true, custom_cover: coverUrl(fn) });
    }

    if (path === "/api/like") {
      const u = await needUser();
      if (!u) return unauth();
      const v = String(body.video_id || "");
      if (!VID.test(v)) return json({ error: "bad video id" }, 400);
      const liked = await sql.begin(async (tx) => {
        const gone = await tx`DELETE FROM muse.likes WHERE user_id=${u.id} AND video_id=${v}`;
        if (gone.count) return false;
        await tx`UPDATE muse.likes SET pos = pos + 1 WHERE user_id=${u.id}`;
        await tx`INSERT INTO muse.likes(user_id,video_id,title,thumb,duration,created,pos)
          VALUES(${u.id},${v},${String(body.title || "").slice(0, 200)},${String(body.thumbnail || "").slice(0, 500)},
            ${num(body.duration)},${now()},0)`;
        return true;
      });
      return json({ liked });
    }
  }

  if (method === "PATCH") {
    if (path === "/api/me") {
      const u = await needUser();
      if (!u) return unauth();
      const display = String(body.display || "").trim().slice(0, 24);
      const accent = String(body.accent || "");
      let hue = num(body.hue);
      if (hue !== null) hue = Math.max(0, Math.min(360, Math.trunc(hue)));
      if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) return json({ error: "bad color" }, 400);
      const [r] = await sql`UPDATE muse.users SET
          display = COALESCE(${display || null}, display),
          accent = COALESCE(${accent || null}, accent),
          hue = COALESCE(${hue}::int, hue)
        WHERE id=${u.id} RETURNING *`;
      return json({ user: rowUser(r) });
    }

    if ((m = /^\/api\/playlists\/(\d+)$/.exec(path))) {
      const u = await needUser();
      if (!u) return unauth();
      const name = String(body.name || "").trim().slice(0, 60);
      if (!name) return json({ error: "empty name" }, 400);
      const r = await sql`UPDATE muse.playlists SET name=${name} WHERE id=${+m[1]} AND user_id=${u.id}`;
      if (!r.count) return json({ error: "no such playlist" }, 404);
      return json({ ok: true, name });
    }

    if ((m = /^\/api\/playlists\/(\d+)\/order$/.exec(path))) {
      const u = await needUser();
      if (!u) return unauth();
      const ids = (Array.isArray(body.ids) ? body.ids : []).filter((i: unknown) => Number.isInteger(i)).slice(0, 500);
      const [pl] = await sql`SELECT id FROM muse.playlists WHERE id=${+m[1]} AND user_id=${u.id}`;
      if (!pl) return json({ error: "no such playlist" }, 404);
      if (ids.length) {
        await sql`UPDATE muse.playlist_items i SET pos = o.pos - 1
          FROM unnest(${ids}::int[]) WITH ORDINALITY AS o(id, pos)
          WHERE i.id = o.id AND i.playlist_id = ${pl.id}`;
      }
      return json({ ok: true });
    }

    if (path === "/api/likes/order") {
      const u = await needUser();
      if (!u) return unauth();
      const vids = (Array.isArray(body.video_ids) ? body.video_ids : [])
        .filter((v: unknown) => typeof v === "string" && VID.test(v)).slice(0, 500);
      if (vids.length) {
        await sql`UPDATE muse.likes l SET pos = o.pos - 1
          FROM unnest(${vids}::text[]) WITH ORDINALITY AS o(vid, pos)
          WHERE l.user_id = ${u.id} AND l.video_id = o.vid`;
      }
      return json({ ok: true });
    }
  }

  if (method === "DELETE") {
    if ((m = /^\/api\/playlists\/(\d+)$/.exec(path))) {
      const u = await needUser();
      if (!u) return unauth();
      const r = await sql`DELETE FROM muse.playlists WHERE id=${+m[1]} AND user_id=${u.id}`;
      if (!r.count) return json({ error: "no such playlist" }, 404);
      return json({ ok: true });
    }

    if ((m = /^\/api\/playlist-items\/(\d+)$/.exec(path))) {
      const u = await needUser();
      if (!u) return unauth();
      const r = await sql`DELETE FROM muse.playlist_items WHERE id=${+m[1]}
        AND playlist_id IN (SELECT id FROM muse.playlists WHERE user_id=${u.id})`;
      if (!r.count) return json({ error: "not found" }, 404);
      return json({ ok: true });
    }
  }

  return json({ error: "not found" }, 404);
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    return json({ error: `${(e as Error).name}: ${String((e as Error).message).slice(0, 200)}` }, 500);
  }
});
