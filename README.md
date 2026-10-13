<p align="center">
  <img src="static/muselogo.png" width="96" alt="Muse" />
</p>

<h1 align="center">Muse</h1>

<p align="center">
  Search a song. Press play. Keep going.
  <br />
  <a href="https://getmuse.eu"><strong>getmuse.eu</strong></a>
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-1ed760?style=flat-square" />
  <img alt="Python 3.13" src="https://img.shields.io/badge/python-3.13-3776ab?style=flat-square" />
  <img alt="Platforms" src="https://img.shields.io/badge/web%20·%20windows%20·%20linux%20·%20android%20·%20ios-0a0a0b?style=flat-square" />
</p>

Muse is an independent music player. Search a song. Press play. Stay out of the way. Matte black. No clutter. An account is optional. With one, you get likes, playlists, Friends, badges, and a For You page that trains on what you actually play.

Muse is not affiliated with YouTube, Google, or any record label. The MIT license covers this source code, not the songs you hear. See [LEGAL.md](LEGAL.md).

The live product is [getmuse.eu](https://getmuse.eu). This repository is that product: the Python server, the vanilla web UI, the Windows WebView2 shell, the Linux Electron shell, and the Android WebView shell.

## Features

- **Search** that stays on songs. Vlogs, trailers, news, and podcasts are dropped.
- **Playback** through a same-origin audio proxy, so the visualizer reads real FFT data.
- **Library** with likes, playlists, covers, and profile themes.
- **For You** mixes from your likes, finishes, and skips.
- **Friends** to see what people around you hear.
- **Musely**, an in-app companion. Desktop shells keep the chat on disk.
- **Windows and Linux** desktop apps. Close hides to the tray. Audio keeps going.
- **Android** with a foreground playback service.
- **iPhone** as a PWA. In Safari, open the site, then Add to Home Screen.

## Get the apps

Downloads are the live builds from [getmuse.eu](https://getmuse.eu). Windows and Linux check that host and update themselves.

| App | Download |
|---|---|
| **Windows** | [Muse-Setup.exe](https://getmuse.eu/desktop/Muse-Setup.exe) |
| **Linux AppImage** | [Muse.AppImage](https://getmuse.eu/linux/Muse.AppImage) |
| **Android** | [Muse.apk](https://getmuse.eu/android/Muse.apk) |
| **Web and iPhone** | [getmuse.eu](https://getmuse.eu) (Safari: Add to Home Screen) |

**Linux, one command:**

```bash
curl -fL https://getmuse.eu/linux/Muse.AppImage -o Muse.AppImage && chmod +x Muse.AppImage && ./Muse.AppImage
```

On Arch, install `fuse2`, `gtk3`, `nss`, `libxss`, `libxtst`, `libnotify`, `xdg-utils`, `at-spi2-core`, and `libsecret` first.

The Linux build speaks MPRIS, so Hyprland, media keys, and status bars see Muse as a normal player.

## Run it locally

This starts a player on `http://127.0.0.1:8090`. You need Python 3.11 or newer, and ffmpeg on your PATH.

```bash
pip install -r requirements.txt
python server.py
```

On Windows you can double-click `start.bat` instead.

Data lives in `muse.db` in the project folder. Search and playback work with no extra config. Git ignores local databases, cookies, and secret files.

## Self-host with Docker

```bash
cd deploy
cp .env.example .env
```

Put host secrets only in `deploy/.env`. Compose reads a Postgres password and, if you want a public hostname, a Cloudflare tunnel token. Then:

```bash
docker compose up --build
```

The app listens on port 8090 inside the stack. Do not commit `.env`.

Optional fronts (Cloudflare Pages, a hosted Postgres) belong in those product dashboards. This repo does not ship live hostnames, tokens, or keys.

## Repository layout

| Path | Role |
|---|---|
| `server.py` | HTTP server, catalog adapter, accounts, recommendations |
| `docs/CATALOG.md` | Clean-room contract: clients talk only to Muse's HTTP API |
| `static/` | Web UI: HTML, CSS, JS, icons, badges |
| `winapp/` | Windows desktop shell (WebView2) |
| `linux/` | Linux desktop shell (Electron) |
| `android/` | Android app (WebView and playback service) |
| `winsetup/` | Windows installer |
| `deploy/` | Docker Compose and host hardening |
| `cloudflare/` | Optional Pages proxy in front of the API |
| `supabase/functions/muse-api/` | Optional Edge Function for library routes |

## Shortcuts

`/` focuses search. Space toggles play. Left and right seek 10 seconds. OS media keys work through Media Session.

## Legal

Muse source is MIT. That is a software license, not a music license.

The UI and desktop shells speak only Muse's own HTTP API ([docs/CATALOG.md](docs/CATALOG.md)). A second implementer can write a new catalog adapter from that spec without reading the stock server. That is clean-room structure for Muse's API. It does not license third-party media.

If you self-host, you are the operator. Prefer an official player embed or a catalog you are licensed to stream. Muse does not export catalog media as MP3 files.

Copyright reports for user files stored on getmuse.eu: **hello@getmuse.eu**. Full text: [LEGAL.md](LEGAL.md), [NOTICE](NOTICE).

## License

MIT. See [LICENSE](LICENSE). Code only, not content.
