# Venture Lab — chat log (one entry per session)

## 2026-10-27 — board-games improvements wave (builder)
- **Asked:** proper Play experience on par with the wave: Play by default with the opponent's hand hidden (Lab one tap away), 3-round match, hand fits iPhone, `_table` look, `_fx` sounds, `_online` rooms (Online guard), rules + guided game (`_coach`), My stats (`_profile`), home-screen install (`_pwa`).
- **Built:** Play mode + fair computer view + match + sheets + coach + profile (c38accc); `_pwa` + local fonts (928fbf7); wooden table (743c737); reviewer fixes: computer's move in words, start pause, name tag, phone chip round (abb0869).
- **Verified:** `node test/run-all.js` green; new `fair_check.js` failed 5 checks on old lab.js; `tools/pwa-check.mjs` 18/18 WebKit + Chromium (old build 4/18); headless 3-round match to the end (result table, starter rule, `Profile.stats().games` = 1); screenshots 393 WebKit/Chrome, 1440, lab mode; live checks after each deploy (service worker active on live, build abb0869).
- **Decided:** online not built (guard: ~400–540 writes per match, busy day ~60–80K writes vs 2K limit). Hand layout unchanged (fits in Chrome at 393/320/landscape).
- **Open (Tim):** online despite quota; laptop board size; per-colour breakdown in the result; save a match across reload; wording/wood colour.
