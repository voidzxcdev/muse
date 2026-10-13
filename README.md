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

Muse is a music player that searches YouTube Music, streams the best audio it can find, and stays out of the way. Matte black. No clutter. An account is optional. With one, you get likes, playlists, Friends, badges, and a For You page that trains on what you actually play.

The live product is [getmuse.eu](https://getmuse.eu). This repository is that product: the Python server, the vanilla web UI, the Windows WebView2 shell, the Linux Electron shell, and the Android WebView shell.

## Features

- **Search** that stays on songs. Vlogs, trailers, news, and podcasts are dropped.
- **Playback** through a same-origin audio proxy, so the visualizer reads real FFT data.
- **Library** with likes, playlists, covers, and profile themes.
- **For You** mixes from your likes, finishes, skips, and YouTube's related graph.
- **Friends** to see what people around you hear.
- **Musely**, an in-app companion. Desktop shells keep the chat on disk.
- **Windows and Linux** desktop apps. Close hides to the tray. Audio keeps going.
- **Android** with a foreground playback service.
- **iPhone** as a PWA. In Safari, open the site, then Add to Home Screen.

## Get the apps

**Web and iPhone.** Open [https://getmuse.eu](https://getmuse.eu).

**Linux (x64).** One command:

```bash
curl -fL https://getmuse.eu/Muse.AppImage -o Muse.AppImage && chmod +x Muse.AppImage && ./Muse.AppImage
```

On Arch, install `fuse2`, `gtk3`, `nss`, `libxss`, `libxtst`, `libnotify`, `xdg-utils`, `at-spi2-core`, and `libsecret` first.

**Windows.** Build `winapp/` with .NET 10 (`dotnet publish -c Release`). `winsetup/` wraps the published `Muse.exe` into an installer.

**Android.** Open `android/` in Android Studio and run the `app` module. Release signing reads `android/keystore.properties` on your machine. That file is not in git.

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
| `server.py` | HTTP server, search, audio proxy, accounts, recommendations |
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

## License

MIT. See [LICENSE](LICENSE).
