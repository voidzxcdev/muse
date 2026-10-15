# Muse React UI — mobile audit (against Сёма's mobile UI guide)

Audited 2026-10-15 on `main` (web/). "Before" = state at commit d5f2f9e; "After" = this commit.
Automated check: `PW_CHANNEL=chrome node scripts/mobile.mjs http://127.0.0.1:8090` (touch emulation, isMobile, DPR 2;
widths 320/375/390/414/768/1024 portrait and 844×390 / 667×375 landscape; reports horizontal overflow incl. clipped
chrome, fixed-layer overlap, sub-16px inputs, sub-44px targets). Report: `web/screens/v3/report.txt`.

| # | Rule | Before | After | Notes |
|---|------|--------|-------|-------|
| 1 | Mobile-first, primary actions in thumb zone | PASS | PASS | Tab bar + mini-player + play controls at the bottom |
| 2 | Viewport meta `viewport-fit=cover` (+ max-scale/user-scalable per guide) | PARTIAL | PASS | Added `maximum-scale=1, user-scalable=no, interactive-widget=resizes-content` |
| 2b | `touch-action: manipulation` | FAIL | PASS | On `html`, plus no tap highlight and `text-size-adjust:100%` |
| 3 | dvh/svh, never 100vh | PARTIAL | PASS | No `100vh`. The chat height was a hard-coded `calc(100dvh-…)` that ignored safe areas, the keyboard and whether the player was shown; it is now `h-full` inside the app shell (`h-[var(--app-h,100dvh)]`) |
| 4 | Bottom tab bar 3–5 items, icon+label, `calc(56px+safe-area)`; content padded by nav + safe area | PARTIAL | PASS | Tab bar was auto height (~57px). Now exactly `56px + env(safe-area-inset-bottom)` with left/right insets; content uses `.nav-pad` = nav + safe area + mini-player |
| 5 | Safe-area insets on every fixed/sticky edge element | FAIL | PASS | Top header: added `safe-area-inset-top` + left/right. Mini-player: left/right. Sheets: left/right. Toasts: below the notch. Cookie bar: above tab bar + player + safe area. Now Playing already had it |
| 6 | Touch targets ≥44px, ≥8px gaps | FAIL | PASS | Many 28–36px targets (card like/more, row actions, search switch/clear, sheet close, NP tabs/close/like, sidebar). On `(pointer:coarse)`: hit area ≥44px for every button via `::after`; shadcn Button sizes go to 44px; gaps widened to 8–12px. Audit: 0 small buttons. The only remaining flag is the search `<input>` itself (42px tall inside a 44px tappable field) |
| 7 | Hover only under `(hover:hover)`; pressed feedback; focus-visible | PARTIAL | PASS | Tailwind v4 already gates `hover:` to `(hover:hover)`. Touch devices now get pressed feedback (opacity, plus the existing `active:scale` on buttons, tabs and sheet items). Focus-visible rings kept |
| 8 | Body text and inputs ≥16px on mobile | FAIL | PASS | The search input and textareas were 14px (iOS zoom). Inputs, textareas and selects are now 16px at <768px and on any coarse pointer; sheet items use 16px text; tab labels 10→11px |
| 9 | Sheets/drawers for secondary actions | FAIL | PASS | The track "…" menu was a desktop dropdown on phones. On touch it is now a bottom sheet (artwork header, 48px rows, inline "Add to playlist" sub-list). All bottom sheets get a Vaul-style drag handle (drag down to dismiss, Motion spring) |
| 10 | Keyboard must not cover inputs (visualViewport) | FAIL | PASS | New `useKeyboardInset()`: the shell is sized to `visualViewport.height` while typing, `html.kb-open` hides the tab bar, mini-player and cookie bar, the composer is scrolled into view, and iOS layout-viewport panning is cancelled |
| 11 | No horizontal overflow at 320–768, portrait + landscape | FAIL | PASS | The top bar overflowed at 320/375 when signed in (search form lacked `min-w-0`), pushing the account avatar off-screen. Fixed; the audit now counts clipped chrome too. 0px everywhere except 2px inside the clipped chat pane at 768 (not scrollable) |
| 12 | 8pt spacing; max-width on wide screens | PASS | PASS | |
| 13 | Code-split routes / lazy images | FAIL | PASS | Search, library, market/profile and chat are `React.lazy` with Suspense; vendor libs are in a long-lived chunk. App chunk 716.6 KB → 119.9 KB (gzip 219.5 → 35.5 KB) |
| 14 | PWA manifest 192/512/maskable/apple-touch, standalone, theme-color | PARTIAL | PASS | Added maskable 192/512 icons, `id`, apple-touch entry and `display_override`. Theme color is now #000 to match the UI; orientation changed from `portrait` to `any` (landscape supported) |
| 15 | No z-index overlap (cookie vs mini-player vs tab bar) | PARTIAL | PASS | The cookie bar used a fixed `140px` offset and z-60 (above sheets). It now sits at nav + player + safe area + 12px with z-45, below dialogs. The audit found 0 overlaps |
| 16 | a11y: dark-mode contrast, SR labels | PARTIAL | PASS | Added aria-labels to the logo/home button. Icon buttons were already labelled. Vercel tokens give AA contrast |

## Not changed / known
- Bottom sheets are built on our Radix Dialog + Motion (drag-to-dismiss) rather than adding the `vaul` package. Same behaviour, one fewer dependency.
- `/api/popular` returns 404 on a fresh local DB (no plays yet). That is the source of the console 404s seen in earlier smoke runs; it is harmless and the UI falls back.
- At 320px the card duration chip sits under the enlarged like/more buttons. Cosmetic only.
- The vendor chunk is 561 KB raw / 174 KB gzip (React, Motion, Radix). It is cached across deploys.
