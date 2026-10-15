"use strict";

function asInt(n) {
  const x = Math.round(Number(n) || 0);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function dbusId(raw) {
  const s = String(raw || "x").replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
  return s || "x";
}

function createMpris(hooks) {
  let player = null;
  try {
    const Player = require("mpris-service");
    player = Player({
      name: "muse",
      identity: "Muse",
      desktopEntry: "muse",
      supportedUriSchemes: ["https", "http", "file"],
      supportedMimeTypes: ["audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg"],
      supportedInterfaces: ["player"],
    });
  } catch (err) {
    console.warn("mpris:", err && err.stack ? err.stack : err);
    return { update() {}, destroy() {} };
  }

  player.on("error", (err) => {
    console.warn("mpris dbus:", err && err.stack ? err.stack : err);
  });

  player.canControl = true;
  player.canPlay = true;
  player.canPause = true;
  player.canGoNext = true;
  player.canGoPrevious = true;
  player.canSeek = true;
  player.canRaise = true;
  player.rate = 1;
  player.minimumRate = 1;
  player.maximumRate = 1;
  player.playbackStatus = "Stopped";

  let positionUs = 0;
  player.getPosition = () => positionUs;

  let echoing = false;
  const send = (type, value) => {
    if (echoing) return;
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
  player.on("position", (ev) => {
    const pos = ev && typeof ev === "object" ? ev.position : ev;
    send("position", pos);
  });
  player.on("volume", (vol) => send("volume", vol));

  let lastMeta = "";
  let lastStatus = "";
  let lastVol = -1;
  let lastSeekedAt = 0;
  let lastSeekedPos = -1;

  function emitSeeked(force) {
    const now = Date.now();
    if (!force && now - lastSeekedAt < 700) return;
    if (!force && Math.abs(positionUs - lastSeekedPos) < 400000) return;
    lastSeekedAt = now;
    lastSeekedPos = positionUs;
    try { player.seeked(positionUs); } catch { /* dbus */ }
  }

  function emptyMeta() {
    return {
      "mpris:trackid": "/org/mpris/MediaPlayer2/TrackList/NoTrack",
    };
  }

  function update(state) {
    if (!player || !state) return;
    positionUs = Math.max(0, asInt((Number(state.position) || 0) * 1e6));
    const status = state.stopped ? "Stopped" : (state.playing ? "Playing" : "Paused");
    echoing = true;
    try {
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
    } finally {
      setImmediate(() => { echoing = false; });
    }

    if (state.stopped) {
      if (lastMeta !== "stopped") {
        lastMeta = "stopped";
        try { player.metadata = emptyMeta(); } catch { /* dbus */ }
      }
      return;
    }

    const title = String(state.title || "").trim();
    const artist = String(state.artist || "").trim();
    const art = String(state.art || "").trim();
    const url = String(state.url || "").trim();
    const durUs = asInt((Number(state.duration) || 0) * 1e6);
    const tid = dbusId(state.id || title || "track");
    const key = `${tid}\n${title}\n${artist}\n${art}\n${durUs}\n${url}`;
    if (key !== lastMeta) {
      lastMeta = key;
      const meta = {
        "mpris:trackid": player.objectPath("track/" + tid),
        "xesam:title": (title || "Muse").slice(0, 180),
        "xesam:artist": [(artist || "Muse").slice(0, 180)],
        "xesam:album": "Muse",
      };
      if (durUs) meta["mpris:length"] = durUs;
      if (art) meta["mpris:artUrl"] = art;
      if (url) meta["xesam:url"] = url;
      try { player.metadata = meta; } catch (err) {
        console.warn("mpris metadata:", err && err.message ? err.message : err);
      }
      emitSeeked(true);
    } else if (status === "Playing") {
      emitSeeked(false);
    }
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
