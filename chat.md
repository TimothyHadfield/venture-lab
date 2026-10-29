# Venture Lab — chat log (one entry per session)

## 2026-10-27 — board-games improvements wave (builder)
- **Asked:** proper Play experience on par with the wave: Play by default with the opponent's hand hidden (Lab one tap away), 3-round match, hand fits iPhone, `_table` look, `_fx` sounds, `_online` rooms (Online guard), rules + guided game (`_coach`), My stats (`_profile`), home-screen install (`_pwa`).
- **Built:** Play mode + fair computer view + match + sheets + coach + profile (c38accc); `_pwa` + local fonts (928fbf7); wooden table (743c737); reviewer fixes: computer's move in words, start pause, name tag, phone chip round (abb0869).
- **Verified:** `node test/run-all.js` green; new `fair_check.js` failed 5 checks on old lab.js; `tools/pwa-check.mjs` 18/18 WebKit + Chromium (old build 4/18); headless 3-round match to the end (result table, starter rule, `Profile.stats().games` = 1); screenshots 393 WebKit/Chrome, 1440, lab mode; live checks after each deploy (service worker active on live, build abb0869).
- **Decided:** online not built (guard: ~400–540 writes per match, busy day ~60–80K writes vs 2K limit). Hand layout unchanged (fits in Chrome at 393/320/landscape).
- **Open (Tim):** online despite quota; laptop board size; per-colour breakdown in the result; save a match across reload; wording/wood colour.

## 2026-10-28 — wave 3 "just make the games better" (builder)
- **Asked:** Tim: "Just make the games better" (videos, variants, practical settings, iPhone layout).
- **Built:** per-colour breakdown in the round result; match saved across reload; Sixth colour option (purple, 72 cards; Play vs computer only); Rules → Videos (5 checked links). Laptop board size skipped (height-bound, would need a vendor layout edit).
- **Verified:** `node test/run-all.js` green incl. new `play_check.js` (fails on the old play.js: slice not found); headless WebKit 393 / 320 (iPhone SE) / landscape / 1440 / 1280: six columns fit, no sideways scroll, no console errors; reload mid round 2 resumed the same deck, hand, results and 6 colours; match end clears the save; Statistics refused on 6 colours.
- **Open (Tim):** name "Sixth colour"; landscape result panel scrolls; bigger laptop board needs a vendor layout change.

## 2026-10-28 — kit sweep (builder b4)
- Built adb0bd2: game-coach 1.2.0 (offer off your hand) + game-pwa 1.4.0 + page-drawn dark selects. Verified: run-all green (build_check flaked once, re-run green), pwa-check 18/18, offer rects at 3 sizes (0 overlap), sheets at 320 px 286/286, deploy workflow success, live-check LIVE + live offer re-measured.
