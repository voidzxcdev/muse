const { contextBridge, ipcRenderer } = require("electron");

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
  `;
  root.appendChild(css);
}

paint();
document.addEventListener("DOMContentLoaded", paint);
