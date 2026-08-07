# Venture Lab — PROGRESS (handoff)

> **You were just told to catch up. Read this file, then [README.md](README.md)
> (what everything is and how it works) and [STRATEGY.md](STRATEGY.md) (what the
> world knows about Lost Cities strategy, and the menu of ideas we are working
> through). This file is the state of play and the working rules; the other two
> are the substance.**

Venture is a re-skin of **Lost Cities** (Knizia, 1999) — same 60 cards, same
scoring — so the whole strategy literature applies directly. That is what
STRATEGY.md surveys.

Live at <https://timothyhadfield.github.io/venture-lab/>.

---

## 1. The rules that bite

- **Push every change, and trigger the deploy.** The user asked for this
  explicitly and does not want to be asked each time:
  ```
  git push
  gh workflow run "Deploy Pages" --ref main     # REQUIRED — `on: push` does NOT fire
  gh run list --limit 1                          # confirm it went green
  ```
  Skipping the manual trigger leaves the site on the old commit while `git push`
  reports success.
- **Run the tests**: `node test/run-all.js` (fast, ~10s) or `--slow` for the
  measurement suites. They slice the real functions out of the source, so they
  test what ships — and they break loudly if you rename a sliced function.
- **Two vendor edits only** (`vendor/src/`, both marked `LAB PATCH`), plus one
  deliberate omission. Re-vendoring means re-applying them. See README →
  *The two vendor edits*. Everything else the lab adds is hooked from `lab.js`
  without touching vendor code — there are usually seams (`CONFIG.cardSortComparator`,
  wrapping `renderGame`) if you look for them.
- **Measure, don't reason.** Every strong claim in these files came from a
  paired run, and several overturned a confident prediction — including three of
  mine, recorded below. Intuition about this game has a bad record.

## 2. What exists

**The board** — the live Venture client's own presentation stack, vendored, with
the deck face-up as colour columns, the opponent's hand revealed, and a
**potential** readout under every pile. Plus: an **Info panel** down the left
(projected turns, free discards, per-colour reachable and break-even), hands
**ordered by colour potential**, empty slots **ringed in their colour**, a
**Venture Assistant** that greys out cards the ascending rule says to hold, and
**pick draw** (click any deck card to draw it).

**Statistics** — dealing trials (ranked colour medians −9 · 4 · 15 · 28 · 64,
total 102) and the **computers**.

**Computers** — solitaire (`playSoloGame`) and **duel** (`playDuelGame`, two
computers on one deck, seats swapped). Built-ins: Lowest, Lowest 3+, Wager Open,
Wager Open 4, Random, **The Patient**, **The Broker**.

**Build a computer** — a Python-shaped language with an editor, saved to
localStorage; saved computers join the picker and the tables.

## 3. What the numbers say

| | solitaire median | duel (vs The Patient) |
|---|---|---|
| The Patient | **228** | −16 |
| The Broker | 158 | **+20** |
| Wager Open | 82 | −13 |
| Lowest | 63 | +3 |
| Random | 5 | −33 |

Head to head, paired, seats swapped: **The Broker beats The Patient by
+32.2 ± 9.5** and Wager Open by +34.5 ± 9.0. **The Patient cannot separate itself
from Wager Open in a duel** (+4.8 ± 11.8) despite winning solitaire by 126.

**The lesson running through all of it: solitaire is a different game.** It
hands you every card, twice the turns, and nobody who profits from your
discards. Patience is nearly free there and ordinary across a table. Duel scores
(0–30) match what the strategy literature reports for real games; solitaire
scores (100–230) do not.

## 4. Three things I predicted wrong

Kept because the pattern matters more than the individual mistakes.

1. **A single play/discard scale from potential** — the natural generalisation —
   scored 39, worse than plain Lowest. Potential measures what a position could
   *become* and gives no credit for banking points, so it cannot arbitrate
   between playing and discarding. The built-ins' hard *play if you legally can*
   is load-bearing.
2. **I then diagnosed that as "it discards too much".** Its discard rate was 48%
   against Wager Open's 49%. The measurement corrected the theory.
3. **The Broker scored 0 in solitaire**, discarding all 52 cards, because
   solitaire hands over no ordered deck and it read *one turn left* from the
   opening move. Found by a diagnostic print, not by reasoning about the code.

## 5. Where to look for the next move

STRATEGY.md is the menu. The two items I would pick up first:

- **§6a — the endgame solver.** With the deck short the true best move is
  computable with no model at all, which turns "is The Broker's valuation any
  good" from an argument into a measurement (agreement rate against ground
  truth). It is the only way to know whether the valuation is *right* rather
  than merely better than what came before.
- **§6 — the variables The Broker's ideas suggest but nothing exposes yet**:
  `gift value` and `dead to them` on the board, so a human can see what a
  computer prices. *Dead to them* is the cheap one — no probabilities at all,
  and the intersection with the panel's *free discards* is the perfect throw.

Smaller, known, unfixed:

- The **solitaire** computers table still gives each computer its own shuffle
  (`cpuRun`), so those columns are unpaired. Duels are paired; solitaire is not.
- The **builder language** cannot compare two values (`if potential > opp
  potential:` is unwritable — the right-hand side must be a number) and has no
  `score = …` / `play max` statement, which is how a strong computer actually
  wants to be written. Neither the duel view nor the opponent-facing values are
  exposed to it yet.
- `sweep2.js` and `duel_scores.js` in `test/` are **measurement** scripts, not
  pass/fail checks — they print tables. That is where the tuning numbers in the
  READMEs came from.

## 6. Related project

The **cheat toolkit** for the live site lives at
`…/Code Projects/Board and Card Games/Venture_Cheat/` with its own `progress.md`
— a separate concern (it plays the real game against the user's brother), but it
solved several of the same problems first and its notes are worth reading before
rebuilding one: an exact endgame solver, a Sage oracle, a repetition fail-safe,
and the same "measure, don't reason" discipline.
