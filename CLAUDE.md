# Venture Lab — notes for Claude

A perfect-information study board and strategy lab for Venture, a re-skin of the
two-player card game Lost Cities. Tim uses it to study positions, play against
computer strategies and measure which ones win. Single user, no accounts, no
backend: everything runs in the browser, and the only stored data is the
builder's saved computers in `localStorage` (key `venture-lab-computers`).

- Live: https://timothyhadfield.github.io/venture-lab/ (also `/simple.html`)
- Read first: `PROGRESS.md` (state of play and working rules), then `README.md`
  (how every feature works) and `STRATEGY.md` (the strategy survey and idea menu).

## Files
| path | what it is |
|---|---|
| `index.html` | the page: board markup, lab bar, all lab CSS, script tags (`?v=DEV`) |
| `lab.js` | game loop, offline opponent + the bridge that lets a computer play you, reveals, potential, info panel, assistant, pick draw |
| `stats.js` | Statistics → dealing trials |
| `computers.js` | the computers, solitaire + duel runners, duel/tournament UI |
| `builder.js` | Build a computer: the Python-shaped language and its page |
| `vendor/` | the live Venture client's presentation stack, vendored (see Traps) |
| `simple.html` | the earlier standalone lab, own renderer, kept as-is |
| `js/online.js` | shared online kit v2 (copy of `Board and Card Games/_online/online.js`; never edit here) |
| `js/lc-online.js`, `js/lc-net.js` | online friend rooms: the game for the kit, and the board ↔ room bridge (see PROGRESS.md 2026-10-27) |
| `test/` | Node checks that slice the real functions out of the source |
| `docs/screenshots/` | images used by README |
| `.github/workflows/pages.yml` | the Pages deploy |

## Run locally
`python -m http.server 8125` in the repo, then open http://localhost:8125/.
No build step, no dependencies.

## Test
- `node test/run-all.js` (fast, ~10 s). `--slow` adds the measurement suites (minutes).
- The checks slice functions by their SIGNATURE (e.g. `function venturePotential(pile, pool`).
  Renaming or re-signing a sliced function makes them fail with "slice not found".
- `build_check.js` is flaky about 1 run in 20 (an unseeded median comparison).
  If that is the only red line, re-run it.
- `sweep2.js`, `duel_scores.js`, `tourney_scores.js` print tables; they are not pass/fail.

## Deploy
Push to `main`, then `gh workflow run "Deploy Pages" --ref main` and check
`gh run list --limit 1`. PROGRESS.md says `on: push` does not fire reliably, so
the manual trigger is required. The workflow rewrites `?v=DEV` to the commit sha.

## Standing instructions (from PROGRESS.md)
- Push every change and trigger the deploy; Tim asked for this and does not want
  to be asked each time.
- Measure, don't reason: every strength claim comes from a paired or seeded run.
- Phone (2026-09-27): below 600px the top bar wraps and the info panel is hidden.
  Hiding the info panel at phone width is Tim's call; don't change it.

## Traps
- Only two vendor edits, both marked `LAB PATCH` (`rendering.js`, `layout.js`),
  plus the deliberately absent `#idle-overlay`. Hook new behaviour from `lab.js`
  (`CONFIG.cardSortComparator`, wrapping `renderGame`, the `rendered` event)
  instead of editing `vendor/`. Re-vendoring means re-applying the patches.
- `LAB_NARROW` in lab.js must match the 600px media query in index.html.
- Headless WebKit on Windows has no 3D transforms, so hand fans look skewed there.
  Playwright's normal `click` on the lab bar times out in phone WebKit (its
  stability check never settles); use a forced click or `--eval` DOM clicks.
- New game must cancel the opponent's pending turn (`_labCancelAI`); the
  opponent's two `setTimeout` waits otherwise act on the new game.
- `reference/` in the main checkout is a saved copy of a third-party page; it is
  git-ignored and must stay out of the public repo.
