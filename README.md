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
- **Empty slots wear their colour** — an empty pile is otherwise a neutral felt
  well that says nothing about which colour belongs there, which bites hardest
  on the colours you hold nothing of. Every empty slot, on both play rows and
  the discard row, is ringed and washed in its own colour; slots with cards on
  them are left plain, since the cards already answer it. Always on, not a
  toggle.

- **Info panel** — a readout column down the left: **projected turns** (also
  printed bare beside the draw pile), **free discards**, and per colour both
  **reachable** potential and what it still needs **to break even**. These are
  the numbers The Patient decides on, so you can read the position the way it
  does.
- **Assistant** — a toggle that greys out the cards the ascending rule says to
  hold back, and refuses to select them.
- **Pick draw** — a toggle: on your draw, click any card in the deck panel and
  you draw *that* card instead of the top one. The same ability the cheat
  toolkit has on the live site.

Each reveal toggle is a button in the top bar; all three are **on by default**.
The assistant is off by default — it takes moves away from you.

### Projected turns

**How many more times you get to play a card, if every draw from here comes from
the deck.**

A turn is play-then-draw and the game ends the moment the draw pile empties, so
each remaining turn burns exactly one deck card: `D` cards left is `D` turns
left, split between the two players. That is why it is *projected* rather than
*remaining* — a draw taken from a discard pile leaves the deck untouched and
stretches the game by a turn, so every discard draw either player takes adds
one.

It counts *your plays*, not the game's turns, since that is the quantity every
decision is actually against — including the assistant's. If you have already
played this turn, your next play is a full round away and the number reflects
that.

Adding another entry to the panel is one object in `LAB_INFO` (`lab.js`): a
label, a line of explanation, and either a `value()` for one number or a
`table()` for a row per colour.

### Reachable potential

Potential asks how far a colour could go and answers as if you had all the time
in the world. You do not. **Reachable** is the same rule under your actual turn
budget — the most a colour can still be worth in the plays you have left — and
it is the number a late-game decision should be made against. The gap between
the two is the time pressure, made visible.

Two consequences worth knowing:

- An **unstarted** colour is never reachable-negative: not opening it is always
  available. A **started** one can be, since the −20 is already spent — which is
  exactly what an opening gate wants to test.
- Reachable can read *higher* than potential. Potential plays every wager it
  can, and on a colour whose numbers cannot clear the 20 that multiplies a loss;
  under a budget those wagers are optional, so it declines them.

### Free discards

Cards your own piles have already climbed past. They can never be played, so
throwing one away costs nothing — which makes them the currency of patience:
while you hold one, you never have to make a play that locks out your own low
cards. It is the quantity The Patient's whole edge is built on.

### Assistant

A venture only ascends, so of the cards you hold in one colour, playing any but
the **lowest** locks the rest out for good. With the assistant on, those higher
cards are greyed and cannot be picked up. The move still exists — it just can't
happen by accident.

**The exception, and the reason this needs a number rather than a rule of
thumb:** holding cards back only pays if you will actually get to play them all.
Once a colour has more playable cards in hand than you have projected turns, you
cannot get them all down whatever you do — so the ascending rule stops being
free and becomes a real choice (the high cards score more, the low ones keep the
run alive). The assistant has no business making that trade for you, so it
releases the whole colour.

Two things the assistant never blocks:

- **Cards the pile has already climbed past.** They can only be discarded, and
  blocking a discard could leave you with no legal move at all.
- **Wagers behind other wagers.** They are all value 0, so none is *higher* than
  the lowest — wagers-before-numbers falls out of the same rule rather than
  being written in.

### Pick draw

On your draw, every card in the deck panel becomes a button: click one and you
draw it. Off by default — a lab where every draw is chosen is a different game,
and the deck panel is usually there to study the order you were actually dealt.

Nothing here reimplements drawing. The chosen card is moved to the deck's **pop
position** and the game's own `drawFromDrawPile()` runs, so the normal path does
the work — normal animation, sound, turn handoff and end-of-deck check — and the
rest of the deck keeps its order. (That is the same mechanism, and the same
one-line contract, as `pickdraw` in the cheat toolkit.)

### Potential

For one colour and one player: **the score that pile would reach if that player
received every card still reachable *by them* that could legally be added to
it.**

Reachable, for that player, means the draw pile, **their own hand**, and the
colour's **discard pile**. Two things are excluded, for two different reasons:

- **Cards already played** are gone for good — either side's play pile is
  permanent.
- **Cards in the other player's hand** are out of reach. You cannot draw what
  someone else is holding. It may come back later (they might discard it), but
  as the position stands it is not yours to get, and counting it would pad your
  ceiling with their cards.

Discards *do* count. A discard pile is a real source — drawing its top is half
of the game's turn — and cards buried under the top become reachable as the pile
is drawn down. That is a generous assumption, which is what a ceiling is for.

So the two numbers under a colour are genuinely per player: each counts its own
holder's hand, neither counts the other's. They will differ from the opening
deal onwards.

There is nothing to search: a venture ascends and values are unique per colour,
so every number above the pile's top can be added, and wagers only while the
pile has no numbers yet.

Reading it:

- **+156** is the ceiling's own ceiling — the whole colour available to one
  player, `(2+…+10 − 20) × 4 wagers + 20 bonus`. You only see it for a colour
  the opponent holds none of; each card in their hand takes a bite out of your
  number and leaves theirs alone.
- It falls as cards leave play, and **collapses when you play high**: put a 9
  down and everything below 9 is locked out of that pile forever. The gap
  between a pile's score and its potential is the headroom you still have.
- **A card moving from their hand to a discard pile RAISES your potential** —
  it went from unreachable to reachable. That is the readout working, not a
  glitch, and it is worth watching: it is the moment a colour opens up for you.
- It is a **ceiling, not a forecast** — it assumes that player gets every
  card still reachable to them, which never happens. Both players can show a
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

| computer | strategy | median score | 8+ bonus |
|---|---|---|---|
| **The Patient** | never locks itself out: spends dead cards rather than make a costly play | **220** | 99% |
| **Wager Open** | Lowest, but a colour can only be *started* with a wager | **98** | 29% |
| **Lowest** | plays the card that decreases that colour's potential the least | **73** | 13% |
| **Lowest 3+** | Lowest, but won't *open* a colour unless holding 3+ of it | **70** | 11% |
| **Wager Open 4** | Wager Open, but never opens a 5th colour — stops at 4 | **56** | 8% |
| **Random** | plays a uniformly random legal card | **12** | 1% |

Medians over 3,000 deals. **8+ bonus** is the share of games landing at least
one venture of 8+ cards, worth +20 each.

⚠️ The runner gives each computer its own shuffle, so those columns are not
paired — the head-to-head figures below come from a paired harness that seeds
one shuffle per round and hands it to every computer.

**The Patient is far the strongest — +126.3 ± 6.4 over Wager Open on paired
shuffles, winning 98% of them.** It more than doubles the previous best median
(220 against 98), and the mechanism is visible in one column: it lands an 8+
venture in **99%** of games against Wager Open's 29%.

Two rules do it, both taken from human strategy writing (see
[STRATEGY.md](STRATEGY.md)):

- **Patience.** A venture only ascends, so playing a 7 over a held 2 kills the
  2 and every 3–6 still to come. Lowest and Wager Open have no choice — they
  play whenever a legal play exists, so they lock themselves out early and
  finish with short ventures. The Patient refuses: while it holds a card its own
  pile has already climbed past (a **dead card**, free to throw), it will not
  make a play costing more than 25 potential. It spends the dead card and waits.
  Worth **+115** on its own.
- **Open anything it can pay for.** Wager Open strands every card of a colour it
  drew no wager in. The Patient opens with a number too, provided the colour can
  still finish above zero in the turns left. Worth a further **+13**.

Everything is priced in **reachable potential** — potential capped by the plays
actually left — which is worth about **+18** of that total over plain potential.

⚠️ **This is a solitaire result and patience is unusually cheap here**: every
card eventually reaches you, and a discard costs nothing because there is nobody
to receive it. Against a real opponent, discards are gifts and you see half the
deck. Expect the margin to shrink — by how much is exactly what a two-player
harness would tell us.

A dead end worth recording: pricing plays and discards on **one** scale and
taking the cheapest move — which looks like the natural generalisation — scores
**39**, worse than Lowest. Potential measures what a position could still become
and gives no credit for banking points, so as an arbiter between playing and
discarding it is not just weak but actively misleading. The built-ins' hard
"play if you legally can" is load-bearing, and the patience rule works precisely
because it overrides that only when the alternative is *free*.

Historic, and still true of the others: **Wager Open beats Lowest by +21.4 ± 0.7
head to head** (it wins 63.7% of deals, ties 18.8%). The reason is that the wager
multiplier dominates scoring: a venture is worth `(sum − 20) × (1 + wagers)`.
Lowest only avoids wasting wagers it is *holding*; when it holds none of a
colour it opens with a number anyway and forfeits all three of that colour's
wagers permanently. Wager Open never makes that trade. It still gets all five
colours open in a typical game, so the restriction costs it almost no tempo —
and it actually discards *less* than Lowest (49% of turns vs 52%).

**Capping at 4 colours is a disaster — −43.0 ± 0.6 against Wager Open**, which
wins 96% of deals head to head. The −20 an extra venture costs is trivial next
to what a colour yields, and refusing to open one strands every card of it:
the discard rate jumps from 49% to 62%. Venture length is capped by the
ascending rule, not by how many colours you have running, so a 5th venture
takes nothing away from the other four — its 8+ bonus rate *falls* (8% vs 29%)
rather than rising.

**The 3+ gate, by contrast, makes things slightly worse**: plain Lowest beats it
by **4.9 ± 0.6**. Refusing to open a thin colour costs tempo without buying much
safety — in solitaire the whole deck comes to you eventually, so an early open
usually gets filled.

With no opponent, the cards still unseen are exactly deck + hand, so a computer
can know that *set* (not its order) just by tracking what has been played and
discarded. `potentialFor` uses only that, so nothing peeks at the deck order.

Its pool is deck + hand — **discards excluded**, unlike the board's readout
above. That is not an inconsistency: these computers never draw from a discard
pile, so a card they discard really is gone to them. Both call the same
`venturePotential` rule; what differs is which cards each says are reachable,
which is exactly the thing that should be context-dependent.

"Play what costs the least potential" turns out to encode more than it looks:
playing any number locks out every remaining wager of that colour, so a red 2
onto an empty pile costs **102** while a red wager costs **0**. Wagers-first and
play-low both fall out of the one rule rather than being written in.

**Adding a computer in JavaScript** — add an entry to `COMPUTERS` in
`computers.js` with a `decide(view)` returning `{ card, action }`, action being
`'play'` or `'discard'`. `view` gives the hand, piles, pool, the legally playable
subset, and an rng; legality, drawing and scoring are handled for you. Say the
action explicitly — the engine will not guess, and rejects a `'play'` that is
illegal.

**Adding one without JavaScript** — **Build a computer**, below.

## Build a computer

A button in the Computers controls opens an editor where you write a computer in
a small language shaped like Python. Saved computers join the picker and the
table and are measured by the same runner as the built-in five. They live in
`localStorage`, and can be named, edited and deleted.

### The one idea

A `for` loop does **not** walk the cards one at a time. It holds a **set** of
candidates, and every line inside narrows it:

```
for card in hand:                    # the set starts as your whole hand
    if change in potential min:      # narrowed to the single cheapest card
        play                         # play what is left
```

That is Lowest, and it reads as what it does. Walking one card at a time could
not express it: *is this card the minimum?* is a question about the whole set,
not about one card.

Under set semantics `if` keeps what passes and hands what failed to `elif` /
`else`; `min` / `max` keep the single best card; `random` keeps one at random;
`play` and `discard` act on the set and end the turn.

### The vocabulary

| | |
|---|---|
| **loops** | `for card in hand:` · `for card in playable:` |
| **branches** | `if … :` · `elif … :` · `else:` |
| **selectors** | `<value> min` · `<value> max` · `random` |
| **comparisons** | `<value>` `< <= > >= == !=` `<number>`, joined with `and` / `or` (left to right, no brackets) |
| **commands** | `play` · `discard` |
| **per-card values** | `change in potential` · `change in reachable` · `potential` · `reachable potential` · `break even gap` · `same color in hand` · `pile size` · `card num` · `card color` |
| **position values** | `proj turns` · `deck` · `hand` / `hand size` · `open colors` · `dead cards` · `opphand` · `rand` |

The reference column on the page carries the same list with a line on each.

Wager Open, the strongest built-in, is four lines:

```
for card in playable:
    if pile size > 0 or card num == 0:
        if change in potential min:
            play
for card in hand:
    if change in potential min:
        discard
```

### Rules worth knowing

- **Editing is Python-shaped.** Enter keeps your indent and adds a level after a
  line ending in `:`; Tab indents, Shift+Tab and Backspace take a level off.
- **Card values need a loop.** `card num` outside a `for` is a compile error
  with the line number, not a mystery 3,000 games later.
- **Selectors don't mix with `and`/`or`.** "the smallest card AND bigger than 5"
  has no answer that is still a single choice, so it is refused rather than
  guessed at.
- **`play` is skipped, never fatal.** If nothing in the narrowed set can legally
  be played, the statement does nothing and the program carries on — an illegal
  play would otherwise throw and kill the whole run.
- **`rand` is rolled once per line**, so `if rand < 0.3:` is a coin flip for that
  branch rather than a random filter of your hand. `random` is the per-card one.
- **Falling off the end is counted.** A program that says nothing about a
  position gets the plainest legal move, and **Test** reports what share of turns
  went that way — which is how you find out a rule you thought was doing the work
  never fires.
- **Saving resets the run counts**, because every row of the table is a count of
  games and mixing a newcomer's 200 in with everyone else's 3,000 would put two
  experiments in one table.

## Layout of the code

| path | what it is |
|---|---|
| `index.html` | the page: game-screen markup + the lab control bar |
| `lab.js` | game loop, offline opponent, reveals, potential |
| `stats.js` | the dealing-trials section |
| `computers.js` | the computers and the solitaire game they're tested on |
| `builder.js` | the build-a-computer language and its page |
| `STRATEGY.md` | survey of Lost Cities strategy writing, and a menu of ideas from it |
| `vendor/styles.css`, `vendor/src/*.js` | the live Venture client's presentation stack, unchanged apart from two lines |
| `simple.html` | the earlier standalone Venture Lab (self-contained, own renderer) |

`lab.js` supplies what the vendored stack used to get from Firebase,
multiplayer, auth, stats and the AI worker — none of which is vendored. The
player actions (`selectCard` / `playToExpedition` / `discardTo` / `drawFrom*`)
are lifted from the game's own `gamelogic.js` so interaction behaves identically.

### The two vendor edits

All marked `LAB PATCH`, all no-ops when `LAB` is undefined:

- `rendering.js` — reveal the opponent's hand in live play (upstream: replay only)
- `layout.js` — subtract the lab bar's height and both side panels' widths (the
  deck columns right, the info panel left) from the viewport the board solves
  against

Re-vendoring from the live site means re-applying these two.

One thing is deliberately **absent** rather than patched: the game's idle
reminder — the "Your turn / tap anywhere" scrim after 30 seconds. `rendering.js`
only nags if `#idle-overlay` exists in the page, and the lab's `index.html`
leaves it out, which also keeps the 200 ms idle poll inert (it never gets an
`idleStart`). The lab is a board you sit and think over; being prodded for
thinking is wrong here. Don't reinstate that element.

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
