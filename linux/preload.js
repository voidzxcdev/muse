const { contextBridge, ipcRenderer, webFrame } = require("electron");

const listeners = new Set();

contextBridge.exposeInMainWorld("__museDesktop", 1);
contextBridge.exposeInMainWorld("__muselyChat", ipcRenderer.sendSync("musely-seed"));
contextBridge.exposeInMainWorld("chrome", {
  webview: {
    postMessage(msg) {
      ipcRenderer.send("muse-host", String(msg));
    },
    addEventListener(type, fn) {
      if (type === "message" && typeof fn === "function") listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === "message") listeners.delete(fn);
    },
  },
});

ipcRenderer.on("muse-host", (_event, data) => {
  const ev = { data };
  for (const fn of listeners) {
    try { fn(ev); } catch { /* a page listener must not kill the bridge */ }
  }
});

function paint() {
  const root = document.documentElement;
  if (!root) return;
  root.classList.add("muse-app");
  if (document.getElementById("muse-linux-css")) return;
  const css = document.createElement("style");
  css.id = "muse-linux-css";
  css.textContent = `
    .muse-app *:focus, .muse-app *:focus-visible {
      outline: none !important; outline-offset: 0 !important;
    }
    .muse-app .search input:focus, .muse-app .search input:focus-visible {
      outline: none !important; box-shadow: none !important;
    }
    .muse-app #onboard input:focus, .muse-app #onboard input:focus-visible {
      outline: 2px solid #fff !important; outline-offset: 0 !important; box-shadow: none !important;
    }
    .muse-app ::selection { background: transparent; color: inherit; }
    html, body {
      width: 100% !important;
      height: 100% !important;
      min-height: 100% !important;
      max-height: 100% !important;
    }
    html.muse-app, html.muse-app body, html.muse-app body.home {
      width: 100% !important;
      height: 100% !important;
      min-height: 100% !important;
      max-height: 100% !important;
    }
  `;
  root.appendChild(css);
}

paint();
document.addEventListener("DOMContentLoaded", paint);

function parseClock(s) {
  const parts = String(s || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function absUrl(u) {
  if (!u) return "";
  try { return new URL(u, "https://getmuse.eu").href; } catch { return ""; }
}

function snapshot() {
  const bar = document.getElementById("player");
  const play = document.getElementById("bPlay");
  const titleEl = document.getElementById("ptitle");
  const art = document.getElementById("art");
  const pos = document.getElementById("pos");
  const dur = document.getElementById("dur");
  const vol = document.getElementById("vol");
  const hidden = !bar || bar.hasAttribute("hidden");
  const title = ((titleEl && titleEl.textContent) || "").trim();
  const blank = !title || title === "—" || title === "-" || title === "–" || title === "Loading…";
  const stopped = hidden || blank;
  let artUrl = "";
  try { artUrl = art && art.currentSrc ? art.currentSrc : (art && art.src) || ""; } catch { artUrl = ""; }
  return {
    title: stopped ? "" : title,
    artist: stopped ? "" : "Muse",
    art: absUrl(artUrl),
    playing: !stopped && !!(play && play.classList.contains("playing")),
    stopped,
    position: parseClock(pos && pos.textContent),
    duration: parseClock(dur && dur.textContent),
    volume: vol ? Number(vol.value) / 100 : 0.85,
  };
}

let lastJson = "";
let ticking = false;
function tick() {
  if (ticking) return;
  ticking = true;
  const state = snapshot();
  const readMeta = `(() => {
    try {
      const md = navigator.mediaSession && navigator.mediaSession.metadata;
      if (!md) return null;
      return {
        title: md.title || "",
        artist: md.artist || "",
        art: (md.artwork && md.artwork[0] && md.artwork[0].src) || ""
      };
    } catch (e) { return null; }
  })()`;
  Promise.resolve(webFrame.executeJavaScript(readMeta, true)).then((md) => {
    ticking = false;
    if (md && !state.stopped) {
      if (md.title) state.title = md.title;
      if (md.artist) state.artist = md.artist;
      if (md.art) state.art = absUrl(md.art);
    }
    const json = JSON.stringify(state);
    if (json === lastJson) return;
    lastJson = json;
    ipcRenderer.send("mpris-state", state);
  }).catch(() => {
    ticking = false;
    const json = JSON.stringify(state);
    if (json === lastJson) return;
    lastJson = json;
    ipcRenderer.send("mpris-state", state);
  });
}

function playingNow() {
  const el = document.getElementById("bPlay");
  return !!(el && el.classList.contains("playing"));
}

function clickId(id) {
  const el = document.getElementById(id);
  if (el) el.click();
}

function seekToRatio(ratio) {
  const line = document.getElementById("pline");
  if (!line) return;
  const box = line.getBoundingClientRect();
  if (!box.width) return;
  const x = box.left + box.width * Math.min(0.999, Math.max(0, ratio));
  const y = box.top + box.height / 2;
  const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, buttons: 1 };
  line.dispatchEvent(new PointerEvent("pointerdown", opts));
  line.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 }));
}

function applyCmd(type, value) {
  if (type === "play") { if (!playingNow()) clickId("bPlay"); return; }
  if (type === "pause" || type === "stop") { if (playingNow()) clickId("bPlay"); return; }
  if (type === "playpause") { clickId("bPlay"); return; }
  if (type === "next") { clickId("bNext"); return; }
  if (type === "previous") { clickId("bPrev"); return; }
  if (type === "volume" && typeof value === "number") {
    const vol = document.getElementById("vol");
    if (!vol) return;
    vol.value = String(Math.round(Math.min(1, Math.max(0, value)) * 100));
    vol.dispatchEvent(new Event("input", { bubbles: true }));
    vol.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (type !== "seek" && type !== "position") return;
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  const duration = parseClock(document.getElementById("dur") && document.getElementById("dur").textContent);
  if (!duration) return;
  let seconds;
  if (type === "seek") seconds = parseClock(document.getElementById("pos") && document.getElementById("pos").textContent) + value / 1e6;
  else seconds = value / 1e6;
  seekToRatio(seconds / duration);
}

ipcRenderer.on("mpris-cmd", (_event, msg) => {
  if (!msg || typeof msg.type !== "string") return;
  try { applyCmd(msg.type, msg.value); } catch { /* page not ready */ }
});

setInterval(tick, 400);
document.addEventListener("DOMContentLoaded", tick);
