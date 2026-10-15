"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { app } = require("electron");

const FEED = "https://getmuse.eu/api/linux";
const UA = () => "Muse/" + app.getVersion() + " (Linux; AppImage; https://getmuse.eu)";

let busy = false;

function appImagePath() {
  const env = process.env.APPIMAGE || "";
  if (env && fs.existsSync(env)) return env;
  const arg = process.env.ARGV0 || "";
  if (/\.AppImage$/i.test(arg) && fs.existsSync(arg)) return arg;
  return "";
}

function newer(remote, local) {
  const a = String(remote || "").split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(local || "").split(".").map((n) => parseInt(n, 10) || 0);
  const n = Math.max(a.length, b.length, 3);
  for (let i = 0; i < n; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function get(url, hops, extra) {
  if ((hops || 0) > 6) return Promise.reject(new Error("redirect"));
  const lib = String(url).startsWith("https") ? https : http;
  const headers = Object.assign({
    "User-Agent": UA(),
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Accept-Encoding": "identity",
  }, extra || {});
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { headers }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        const next = new URL(loc, url).href;
        get(next, (hops || 0) + 1, extra).then(resolve, reject);
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function fetchJson(url) {
  const res = await get(url, 0, { Accept: "application/json" });
  if (res.statusCode !== 200) throw new Error("feed " + res.statusCode);
  let raw = "";
  for await (const chunk of res) raw += chunk;
  return JSON.parse(raw);
}

async function download(url, dest, onProgress) {
  const res = await get(url, 0, { Accept: "application/octet-stream, */*" });
  if (res.statusCode !== 200) throw new Error("download " + res.statusCode);
  const total = Number(res.headers["content-length"]) || 0;
  const hash = crypto.createHash("sha256");
  let got = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    res.on("data", (c) => {
      hash.update(c);
      got += c.length;
      out.write(c);
      if (onProgress) {
        const p = total > 0
          ? 0.08 + 0.82 * got / total
          : Math.min(0.88, 0.1 + got / 80_000_000);
        onProgress(p);
      }
    });
    res.on("end", () => out.end());
    res.on("error", reject);
    out.on("finish", resolve);
    out.on("error", reject);
  });
  const head = Buffer.alloc(16);
  const fd = fs.openSync(dest, "r");
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  const start = head.toString("utf8");
  if (/^\s*</.test(start) || /html/i.test(start)) throw new Error("html");
  if (got < 1_000_000) throw new Error("tiny");
  return hash.digest("hex");
}

function sweepOld() {
  const self = appImagePath();
  if (!self) return;
  for (const p of [self + ".old", self + ".part"]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* leftover */ }
  }
}

function applyScript(self, part) {
  const sh = path.join(app.getPath("temp"), "muse-apply.sh");
  fs.writeFileSync(sh, [
    "#!/bin/bash",
    "set -e",
    `SELF=${JSON.stringify(self)}`,
    `NEW=${JSON.stringify(part)}`,
    `PID=${process.pid}`,
    "for i in $(seq 1 48); do",
    '  kill -0 "$PID" 2>/dev/null || break',
    "  sleep 0.25",
    "done",
    "sleep 0.5",
    'if [ -f "$SELF.old" ]; then rm -f "$SELF.old" || true; fi',
    'mv -f "$SELF" "$SELF.old" 2>/dev/null || true',
    'mv -f "$NEW" "$SELF"',
    'chmod +x "$SELF"',
    'rm -f "$SELF.old" || true',
    'exec "$SELF"',
    "",
  ].join("\n"));
  fs.chmodSync(sh, 0o755);
  const child = spawn("bash", [sh], { detached: true, stdio: "ignore" });
  child.unref();
}

async function tick(hooks) {
  const self = appImagePath();
  if (!self) return;
  if (busy) return;
  busy = true;
  try {
    const meta = await fetchJson(FEED);
    if (!meta || !meta.version || !meta.url) return;
    if (!newer(meta.version, app.getVersion())) return;

    if (hooks && typeof hooks.begin === "function") hooks.begin(meta.version);

    const part = self + ".part";
    try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch { /* */ }
    const sha = await download(meta.url, part, (p) => {
      if (hooks && typeof hooks.progress === "function") hooks.progress(p);
    });
    if (meta.sha256 && sha.toLowerCase() !== String(meta.sha256).toLowerCase()) {
      try { fs.unlinkSync(part); } catch { /* */ }
      throw new Error("hash");
    }
    try { fs.chmodSync(part, 0o755); } catch { /* */ }
    if (hooks && typeof hooks.progress === "function") hooks.progress(1);
    applyScript(self, part);
    await new Promise((r) => setTimeout(r, 180));
    if (hooks && typeof hooks.apply === "function") hooks.apply();
  } catch (err) {
    busy = false;
    if (hooks && typeof hooks.fail === "function") {
      try { hooks.fail(); } catch { /* */ }
    }
    throw err;
  }
}

function arm(hooks) {
  sweepOld();
  const loop = () => { tick(hooks).catch((err) => console.warn("update:", err.message)); };
  setTimeout(() => {
    loop();
    setInterval(loop, 90_000);
  }, 2500);
}

module.exports = { arm, sweepOld };
