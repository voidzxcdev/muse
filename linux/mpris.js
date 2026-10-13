"use strict";

function createMpris(hooks) {
  let player = null;
  try {
    const Player = require("mpris-service");
    player = Player({
      name: "muse",
      identity: "Muse",
      desktopEntry: "muse",
      supportedUriSchemes: ["https", "http"],
      supportedMimeTypes: ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg"],
      supportedInterfaces: ["player"],
    });
  } catch (err) {
    console.warn("mpris:", err && err.message ? err.message : err);
    return { update() {}, destroy() {} };
  }

  player.canControl = true;
  player.canPlay = true;
  player.canPause = true;
  player.canGoNext = true;
  player.canGoPrevious = true;
  player.canSeek = true;
  player.playbackStatus = "Stopped";

  let positionUs = 0;
  player.getPosition = () => positionUs;

  const send = (type, value) => {
    try { hooks.send(type, value); } catch { /* window gone */ }
  };

  player.on("raise", () => { try { hooks.raise(); } catch { /* */ } });
  player.on("quit", () => { try { hooks.quit(); } catch { /* */ } });
  player.on("play", () => send("play"));
  player.on("pause", () => send("pause"));
  player.on("playpause", () => send("playpause"));
  player.on("stop", () => send("stop"));
  player.on("next", () => send("next"));
  player.on("previous", () => send("previous"));
  player.on("seek", (offset) => send("seek", offset));
  player.on("position", (_id, pos) => send("position", pos));
  player.on("volume", (vol) => send("volume", vol));

  let lastMeta = "";
  let lastStatus = "";
  let lastVol = -1;

  function update(state) {
    if (!player || !state) return;
    positionUs = Math.max(0, Math.round((Number(state.position) || 0) * 1e6));
    const status = state.stopped ? "Stopped" : (state.playing ? "Playing" : "Paused");
    if (status !== lastStatus) {
      lastStatus = status;
      try { player.playbackStatus = status; } catch { /* dbus */ }
    }
    if (typeof state.volume === "number" && Number.isFinite(state.volume)) {
      const v = Math.min(1, Math.max(0, state.volume));
      if (Math.abs(lastVol - v) > 0.01) {
        lastVol = v;
        try { player.volume = v; } catch { /* dbus */ }
      }
    }
    const title = String(state.title || "").trim() || "Muse";
    const artist = String(state.artist || "").trim() || "Muse";
    const art = String(state.art || "").trim();
    const durUs = Math.max(0, Math.round((Number(state.duration) || 0) * 1e6));
    const key = `${title}\n${artist}\n${art}\n${durUs}`;
    if (key === lastMeta) return;
    lastMeta = key;
    const meta = {
      "mpris:trackid": player.objectPath("track/1"),
      "xesam:title": title.slice(0, 180),
      "xesam:artist": [artist.slice(0, 180)],
      "xesam:album": "Muse",
    };
    if (durUs) meta["mpris:length"] = durUs;
    if (art) meta["mpris:artUrl"] = art;
    try { player.metadata = meta; } catch { /* dbus */ }
  }

  function destroy() {
    try {
      if (player && player._bus) player._bus.disconnect();
    } catch { /* already gone */ }
    player = null;
  }

  return { update, destroy };
}

module.exports = { createMpris };
