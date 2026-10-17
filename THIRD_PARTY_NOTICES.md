# Third-party notices

Muse includes code and design adapted from the projects below. Their licenses
are reproduced or referenced here as their terms require.

## Riff — https://github.com/rootscripts/riff (commit 935ae2d)

Muse's web UI design (Material 3 palette/theme system, navigation rail, play bar,
squiggly progress scrubber, M3 expressive sliders, track rows, lyrics styling,
audio settings panel) and its Web Audio playback engine are ported from Riff.

Ported files and where they came from:

| Muse file | Riff source |
| --- | --- |
| `web/src/player/riff-engine.ts` | `audio-engine.js` (RiffAudioEngine: graph, HQ enhancer, EQ, reverb/echo/distortion, fades, analyser, offline render) |
| `web/src/lib/riff-theme.ts` | `app.js` (hexToRgb/rgbToHsl/hslToHex, PALETTE_STYLES, generateM3Palette, analyzeCover, computeButtonColors, auto-theme derivation) |
| `web/src/components/riff-ui.tsx` | `app.js` (squiggly scrubber + mini visualizer render loop, enhanceSliders) and `styles.css` (`.sl`) |
| `web/src/components/sound-panel.tsx` | `index.html` audio menu (Enhancer / Speed & Pitch / Audio FX / Equalizer, crossfade) |
| `web/src/index.css` (Riff section) | `styles.css` (M3 tokens, shape/motion scale, `.btn-play-pause`, `.control-btn`, `.track-row`, lyric lines, mesh gradient) |
| `web/src/player/store.ts` (engine glue) | `app.js` (playSmooth/pauseSmooth, crossfade trigger, 50 % prefetch, hls.js config) |

```
MIT License

Copyright (c) 2026 rootscripts

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Google Sans (font) — via `@fontsource-variable/google-sans`

Copyright 2017 Google, Inc. Licensed under the SIL Open Font License, Version 1.1
(https://openfontlicense.org). Self-hosted from the npm package (Latin and
Cyrillic subsets); no request goes to Google Fonts.

## hls.js — https://github.com/video-dev/hls.js

Copyright (c) 2017 Dailymotion. Licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0). Loaded on demand only for HLS
(`.m3u8`) sources in browsers without native HLS.
