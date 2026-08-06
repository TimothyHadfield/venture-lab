# Venture Lab

A **perfect-information Venture board** for studying positions: the real game's
board, with the whole draw pile laid out as colour columns, the opponent's hand
face-up, and a per-colour **potential** readout under every pile.

Open `index.html` in a browser. No build step, no accounts, no network.

> ⚠️ This vendors the live Venture client's own presentation code (see below).
> The repo is public and deployed, so that code is republished here.

## What's on screen

The board *is* the live game's board — same layout engine, same card art, same
fans and animations. What's different:

- **Deck columns** — the draw pile as a panel down the right: one column per
  colour, one row per draw position, top = next. Same layout as the xray panel
  in the cheat toolkit. The board's own draw pile is left face-down as normal;
  the order is read off the panel. Empty cells are the information — a gap in
  the red column means another colour fills that spot in the sequence. Rows are
  shorter than a card so the whole deck fits without scrolling, and each number
  is pinned to its card's top strip so the overlap never hides it. The next card
  is ringed gold and tagged NEXT.
- **Opponent's hand face-up**, in place, right way up.
- **Potential** — one number under each of the ten piles (yours and theirs).

Each toggle is a button in the top bar; all three are **on by default**.

### Potential

For one colour and one player: **the score that pile would reach if that player
received every card still in play that could legally be added to it.**

"Still in play" means the draw pile plus both hands. Cards already played or
sitting in a discard pile are excluded — a played card is gone, and a discarded
one is only reachable as a pile top under conditions, so counting it would
overstate the ceiling.

There is nothing to search: a venture ascends and values are unique per colour,
so every number above the pile's top can be added, and wagers only while the
pile has no numbers yet.

Reading it:

- It starts at **+156** everywhere — the whole colour is still available, and
  `(2+…+10 − 20) × 4 wagers + 20 bonus` is the theoretical maximum venture.
- It falls as cards leave play, and **collapses when you play high**: put a 9
  down and everything below 9 is locked out of that pile forever. The gap
  between a pile's score and its potential is the headroom you still have.
- It is a **ceiling, not a forecast** — it assumes one player gets every
  remaining card of that colour, which never happens. Both players can show a
  high number for the same colour; they are competing for the same cards.

## Dealing statistics

A second section (**Statistics** in the bar) runs dealing trials.

**One trial:** shuffle a full deck, deal 8 cards to each player, then deal
alternately until the deck is empty. All 60 cards go out, so you finish with 30.

Both statistics are reported **by rank**: each trial's five values are sorted,
so group 1 is whichever colour came out worst *that trial* and group 5 whichever
came out best. The groups are ranks, not colours — group 1 is red in one trial
and blue in the next. The reported figure is each group's median across trials.

**Statistic 1 — cards per colour.** How many cards of each colour you received.
Over 20,000 trials the medians are **4 · 5 · 6 · 7 · 8**.

**Statistic 2 — potential points per colour.** What those cards are *worth*: the
score of playing every card you received of that colour, lowest to highest, as
one venture — the game's own `MATH.scorePlayPile`, so wagers multiply and 8+
cards take the bonus. Red 2,4,7,9,10 → (32 − 20) × 1 = **12**.

Over 20,000 trials the medians are **−9 · 4 · 15 · 28 · 64**, and a **Total**
row under group 5 gives the whole hand's potential: median **102**.

The total is tallied per trial and medianed like the groups — it is not the
five group medians added up, which would be wrong (medians aren't additive).
The *means* are additive, and that identity is asserted in testing: the total
mean equals the sum of the group means exactly.

That first number is the striking one: your *worst* colour is typically worth
**negative** points, so playing it out costs you. Nearly all of a hand's value
sits in its top two or three colours.

That spread is the whole point. Tallied by *colour* instead, every colour sits
flat at 6 — averaging hides the lopsidedness that ranking measures. You should
expect one colour you are starved of and one you are flooded with, every game.

Note the deal only ever produces one independent data set per trial: with all
60 cards dealt, the opponent's count for a colour is exactly `12 −` yours, so
their data is a deterministic mirror, not a second sample.

Verified against theory — each colour count is a hypergeometric draw (30 from
60, 12 per colour), and the simulated distribution matches the exact
probabilities to within 0.3 percentage points at 20k trials.

## Computers

The statistics section also builds and tests computers. Each game is
**solitaire** — no opponent. Take 8 cards, then every turn play one card to a
venture and draw one, until the draw pile empties (52 turns, ending with 8 cards
still in hand). A computer **discards only when it cannot legally play
anything**, and never draws from the discards.

| computer | strategy | median score |
|---|---|---|
| **Lowest** | plays the card that decreases that colour's potential the least | **73** |
| **Lowest 3+** | Lowest, but won't *open* a colour unless holding 3+ of it | **70** |
| **Wager Open** | Lowest, but a colour can only be *started* with a wager | **98** |
| **Random** | plays a uniformly random legal card | **12** |

Medians over 3,000 identical deals played by all four.

**Wager Open is far the strongest — +21.4 ± 0.7 over Lowest head to head on the
same deal** (it wins 63.7% of deals, ties 18.8%). The reason is that the wager
multiplier dominates scoring: a venture is worth `(sum − 20) × (1 + wagers)`.
Lowest only avoids wasting wagers it is *holding*; when it holds none of a
colour it opens with a number anyway and forfeits all three of that colour's
wagers permanently. Wager Open never makes that trade. It still gets all five
colours open in a typical game, so the restriction costs it almost no tempo —
and it actually discards *less* than Lowest (49% of turns vs 52%).

**The 3+ gate, by contrast, makes things slightly worse**: plain Lowest beats it
by **4.9 ± 0.6**. Refusing to open a thin colour costs tempo without buying much
safety — in solitaire the whole deck comes to you eventually, so an early open
usually gets filled.

With no opponent, the cards still unseen are exactly deck + hand, so a computer
can know that *set* (not its order) just by tracking what has been played and
discarded. `potentialFor` uses only that, so nothing peeks at the deck order.

"Play what costs the least potential" turns out to encode more than it looks:
playing any number locks out every remaining wager of that colour, so a red 2
onto an empty pile costs **102** while a red wager costs **0**. Wagers-first and
play-low both fall out of the one rule rather than being written in.

**Adding a computer** — add an entry to `COMPUTERS` in `computers.js` with a
`decide(view)` returning `{ card, action }`, action being `'play'` or
`'discard'`. `view` gives the hand, piles, pool, the legally playable subset,
and an rng; legality, drawing and scoring are handled for you. Say the action
explicitly — the engine will not guess, and rejects a `'play'` that is illegal.

## Layout of the code

| path | what it is |
|---|---|
| `index.html` | the page: game-screen markup + the lab control bar |
| `lab.js` | game loop, offline opponent, reveals, potential |
| `stats.js` | the dealing-trials section |
| `computers.js` | the computers and the solitaire game they're tested on |
| `vendor/styles.css`, `vendor/src/*.js` | the live Venture client's presentation stack, unchanged apart from two lines |
| `simple.html` | the earlier standalone Venture Lab (self-contained, own renderer) |

`lab.js` supplies what the vendored stack used to get from Firebase,
multiplayer, auth, stats and the AI worker — none of which is vendored. The
player actions (`selectCard` / `playToExpedition` / `discardTo` / `drawFrom*`)
are lifted from the game's own `gamelogic.js` so interaction behaves identically.

### The two vendor edits

All marked `LAB PATCH`, all no-ops when `LAB` is undefined:

- `rendering.js` — reveal the opponent's hand in live play (upstream: replay only)
- `layout.js` — subtract the lab bar's height and the deck panel's width from
  the viewport the board solves against

Re-vendoring from the live site means re-applying these two.

## The game

Build **ventures** — ascending runs of a single colour. Wagers (`×2`) must come
*before* any numbers and multiply that venture.

- A venture scores **(sum of numbers − 20) × (1 + wagers)**, plus **+20** at 8
  cards. The −20 is the cost of starting, so short ventures lose points.
- **Your turn:** ① play one card to a venture, or discard it · ② draw from the
  deck or a discard-pile top (not the one you just discarded to).
- The game ends when the **draw pile empties**. Highest total wins.

The opponent is a local heuristic (Casual / Solid / Sharp) — deliberately not
the real bot, since the point here is studying positions.

## Deploying

Pages is built by `.github/workflows/pages.yml` (Actions), not the legacy
builder — the legacy one failed opaquely and pinned the site to a stale commit.

Local asset URLs carry `?v=DEV`; the workflow rewrites that to the commit sha
before uploading, so a deploy can never be mixed with cached older scripts.
(That mix is real: `Lowest` once broke while `Random` kept working, because only
`Lowest` called a function that had moved into a file the browser had cached.)

If a push does not appear on the site, check whether a run actually started:

```
gh run list --limit 3
gh workflow run "Deploy Pages" --ref main     # trigger it by hand
```
