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
total 102), the **computers**, a pairwise **duel**, and a **tournament**: the
whole field round-robin, with standings and a head-to-head grid. The tournament
is now where a strength claim should come from — see §3.

**Computers** — solitaire (`playSoloGame`) and **duel** (`playDuelGame`, two
computers on one deck, seats swapped). Built-ins: Lowest, Lowest 3+, Wager Open,
Wager Open 4, Random, **The Patient**, **The Broker**. Any of them — and anything
saved in the builder — can also be **your opponent on the board**, picked from
the top bar. The bridge is `_labCpuView` / `_labCpuChooseTurn` in `lab.js`: it
hands the live `gameState` over as the same `duelView` the duel runner uses, so
a computer plays you exactly as it plays a measured duel, perfect information
included. Covered by `test/opponent_check.js`.

**Build a computer** — a Python-shaped language with an editor, saved to
localStorage; saved computers join the picker and the tables.

## 3. What the numbers say

**The round robin is now the reference** (Statistics → Tournament, or
`node test/tourney_scores.js`). Every computer against every other, 200 deals a
pairing, seats swapped — **8,400 games**:

| # | | solitaire median | margin a game, whole field |
|---|---|---|---|
| 1 | **The Broker** | 158 | **+32.3 ± 2.0** |
| 2 | Lowest | 63 | +10.6 ± 2.0 |
| 3 | Lowest 3+ | — | +6.7 ± 2.1 |
| 4 | Wager Open 4 | — | +0.4 ± 2.0 |
| 5 | **The Patient** | **228** | **−10.2 ± 2.2** |
| 6 | Wager Open | 82 | −13.4 ± 2.2 |
| 7 | Random | 5 | −26.4 ± 1.8 |

**The lesson running through all of it: solitaire is a different game** — and the
round robin sharpened it from "different" to "inverted". It hands you every
card, twice the turns, and nobody who profits from your discards.

- **The Patient is FIFTH of seven, 18 points a game behind plain Lowest**, while
  winning solitaire by 126 and landing the 8-card bonus in 99% of games. Earlier
  notes had it "unable to separate itself from Wager Open"; that understated it.
  With an opponent present, patience is not neutral but a **liability** — waiting
  means discarding, and a discard is handed to someone who can use it.
- **The Broker's lead is not an artifact of the field**: it beats every computer
  individually, +15 against Lowest through +55 against Random. That is precisely
  what a round robin can say and a pairwise duel cannot.
- Exactly 1 of 21 pairings was undecided at 200 deals — The Patient vs Wager
  Open at +4, the same answer the duel reached at +4.8 ± 11.8. A second run on a
  different seed reproduced the whole ORDER, with individual margins moving a
  point or two, as their intervals say they should.

⚠️ **An average margin is relative to the FIELD** — add a weak computer and
everyone's rises. The standings describe these seven; the head-to-head grid is
the part that does not move. Duel scores (0–30) match what the strategy
literature reports for real games; solitaire scores (100–230) do not.

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
4. **Letting a computer play you looked like it worked, and half of every one
   of its turns was being played by something else.** A computer decides its
   card and its draw in ONE call; the board splits those across two waits. The
   first version fell through to the built-in opponent's draw whenever the
   computer named no pile — but naming no pile *is* the answer, and it means the
   deck (`playDuelGame` reads it that way, which is why every solitaire computer
   runs in a duel unchanged). Nothing about the game looked wrong. Found only
   because `opponent_check.js` counted what the computer asked for against what
   the engine was asked for: 1 against 11.

### The question the round robin opened

**Why does plain Lowest beat The Patient by 18 a game?** Lowest is four lines —
play the card that costs its colour the least potential — and it is second in
the field, ahead of every rule the strategy literature suggested. That is either
a real finding about Venture (tempo beats position when discards are contested)
or the field is too weak to tell them apart, and the tournament can now be
pointed at the question directly: build the variants and enter them.

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
- `sweep2.js`, `duel_scores.js` and `tourney_scores.js` in `test/` are
  **measurement** scripts, not pass/fail checks — they print tables. That is
  where the tuning numbers in the READMEs came from. `tourney_scores.js` is
  seeded, so §3's table reproduces exactly.
- The **solitaire** table is still the only place a computer is ranked by a
  number that has no opponent in it. §3 is now the round robin; treat a
  solitaire median as a description of the computer, not of its strength.
- ⚠️ **`build_check.js` is FLAKY, about 1 run in 20.** Its last assertion —
  "Wager Open written in the language beats the written-out Lowest" — compares
  two medians over 40 **unseeded** games, and they land close enough to cross.
  So a red `run-all` is not automatically a real failure: check whether the only
  line that failed is that one, and re-run. `duel_check.js` shows the fix (a
  seeded `Math.random` in the harness); doing it means re-reading whatever the
  new seed reports, so it was left alone rather than quietly re-baselined.

## 6. Related project

The **cheat toolkit** for the live site lives at
`…/Code Projects/Board and Card Games/Venture_Cheat/` with its own `progress.md`
— a separate concern (it plays the real game against the user's brother), but it
solved several of the same problems first and its notes are worth reading before
rebuilding one: an exact endgame solver, a Sage oracle, a repetition fail-safe,
and the same "measure, don't reason" discipline.
