"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { app } = require("electron");

const FEED = "https://getmuse.eu/api/linux";

function appImagePath() {
  return process.env.APPIMAGE || "";
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

function get(url, hops) {
  if ((hops || 0) > 5) return Promise.reject(new Error("redirect"));
  const lib = String(url).startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
        res.resume();
        get(loc, (hops || 0) + 1).then(resolve, reject);
        return;
      }
      resolve(res);
    }).on("error", reject);
  });
}

async function fetchJson(url) {
  const res = await get(url);
  if (res.statusCode !== 200) throw new Error("feed " + res.statusCode);
  let raw = "";
  for await (const chunk of res) raw += chunk;
  return JSON.parse(raw);
}

async function download(url, dest) {
  const res = await get(url);
  if (res.statusCode !== 200) throw new Error("download " + res.statusCode);
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    res.on("data", (c) => { hash.update(c); });
    res.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    res.on("error", reject);
  });
  return hash.digest("hex");
}

function sweepOld() {
  const self = appImagePath();
  if (!self) return;
  for (const p of [self + ".old", self + ".part"]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* leftover */ }
  }
}

async function tick(hooks) {
  const self = appImagePath();
  if (!self) return;
  const meta = await fetchJson(FEED);
  if (!meta || !meta.version || !meta.url) return;
  if (!newer(meta.version, app.getVersion())) return;

  const part = self + ".part";
  try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch { /* */ }
  const sha = await download(meta.url, part);
  if (meta.sha256 && sha.toLowerCase() !== String(meta.sha256).toLowerCase()) {
    try { fs.unlinkSync(part); } catch { /* */ }
    throw new Error("hash");
  }
  try { fs.chmodSync(part, 0o755); } catch { /* */ }

  const sh = path.join(app.getPath("temp"), "muse-apply.sh");
  fs.writeFileSync(sh, [
    "#!/bin/bash",
    "set -e",
    `SELF=${JSON.stringify(self)}`,
    `NEW=${JSON.stringify(part)}`,
    "for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do",
    "  sleep 0.5",
    '  mv -f "$NEW" "$SELF" && break',
    "done",
    'chmod +x "$SELF"',
    'exec "$SELF"',
    "",
  ].join("\n"));
  fs.chmodSync(sh, 0o755);
  const child = spawn("bash", [sh], { detached: true, stdio: "ignore" });
  child.unref();
  if (hooks && typeof hooks.apply === "function") hooks.apply();
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
