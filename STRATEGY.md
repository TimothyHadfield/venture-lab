# Lost Cities strategy — what other people have worked out

Venture is a re-skin of **Lost Cities** (Reiner Knizia, 1999), which is the name
the whole strategy literature uses. Same 60 cards, same five colours, same 2–10
plus three multipliers, same −20 to open an expedition, same +20 for eight
cards. So everything written about Lost Cities applies here directly, and this
file is a survey of it.

Two halves:

1. **[What the sources say](#part-1--what-the-sources-say)** — other people's
   findings, with links.
2. **[Ideas for the lab](#part-2--ideas-for-the-lab)** — variables and computers
   we could build on top of it. Nothing here is implemented yet.

A note on quality: almost none of this is measured. It is experienced players'
folklore, and where sources disagree I have said so rather than picking a
winner. Wherever the lab can *test* a claim, that is called out — turning this
folklore into measurements is the whole point of having a lab.

---

# Part 1 — what the sources say

## 1. The arithmetic everyone starts from

| quantity | value |
|---|---|
| Cards in the deck | 60 |
| Dealt to each player | 8 |
| Left in the draw pile | 44 |
| Turns each, if nobody draws from a discard pile | **~22** |
| Number points in one colour (2+…+10) | **54** |
| Cost to open an expedition | **−20** |
| Multipliers | ×2 / ×3 / ×4 (they multiply losses too) |
| Bonus at 8+ cards | **+20** |

Two consequences the sources return to constantly:

- **You need 20 points of numbers in a colour just to reach zero**, and a hand
  is only 8 cards, so opening an expedition is always a bet on cards you have
  not drawn yet ([Opinionated Gamers](https://opinionatedgamers.com/2015/12/04/lost-cities/)).
- **Roughly half the deck comes to you**, so ~27 of a colour's 54 points is the
  amount you can expect to see — which makes a lone colour worth about
  `27 − 20 = 7` points before multipliers
  ([BoostYourPlay](https://boostyourplay.com/lost-cities-strategy-tips-to-outwit-your-opponent/)).

For calibration on what a score means: a BGG thread on average scores puts an
"average OK" round at about **30 points** and a strong one at about **50**
([Average score? — BGG](https://boardgamegeek.com/thread/405890/average-score)).

## 2. The consensus, in rough order of how strongly it is held

### 2.1 Run three or four colours, not five

The most repeated advice in the literature, and one of the few things nobody
argues with.

> "Nearly always I'm shooting for commitment to 3 or 4 colors by the end and
> usually when I take that 5th color I regret it."
> — [The Thoughtful Gamer](https://thethoughtfulgamer.com/2021/02/07/5-strategy-tips-for-lost-cities/)

The reasoning is that at least 16 cards go unplayed, so spreading thin means
paying −20 several times for expeditions that never clear it. Echoed by
[BGA's own tips page](https://en.doc.boardgamearena.com/Tips_lostcities) and
[BoostYourPlay](https://boostyourplay.com/lost-cities-strategy-tips-to-outwit-your-opponent/),
which suggests three as the default with a fourth when the draw justifies it.

⚠️ **Our solitaire harness measured the opposite** (Wager Open 4, which refuses
to open a fifth colour, loses by 43 points). That is not a contradiction — see
[§4](#4-where-our-own-numbers-disagree-with-the-folklore-and-why).

### 2.2 Do not open what you cannot finish — but nobody agrees on the number

Everyone agrees there is a threshold. The thresholds themselves vary a lot:

| source | rule |
|---|---|
| BGG strategy discussion | 8+ points in hand early; 10–12 by mid-game |
| mikeg2, [BGA forum](https://forum.boardgamearena.com/viewtopic.php?t=16096) | "If I have 15 or more points in a color but no double, I'll put the 2/3 up on the table" |
| mikeg2, same thread | "If I have 12 or more points **and an opponent has already started that color**, I will start that color without the double card" |
| [BoostYourPlay](https://boostyourplay.com/lost-cities-strategy-tips-to-outwit-your-opponent/) | Wagers-only openings are fine early; from a third of the way in, want 10+ points of numbers behind a wager |
| [gedblog](https://gedblog.com/2012/08/22/lost-cities-tips-tricks/) | Open with a 4 or 5 rather than a 2 or 3 — "low cards don't yield many points anyway" |

The cleanest formulation is **the one card rule**: commit only if playing what
you hold now plus **one** more playable draw would break even
([The Thoughtful Gamer](https://thethoughtfulgamer.com/2021/02/07/5-strategy-tips-for-lost-cities/)).
That article attaches a figure — roughly **82%** odds of drawing one of the 8, 9
or 10 when holding 5–7 — which is quoted without a derivation and is worth
checking rather than trusting; it is exactly the kind of claim the lab can
settle.

Dissent, and it is real: [Dan on games](https://danongames.wordpress.com/2017/07/10/lost-cities-the-card-game-tips/)
argues against waiting for perfection — play the 6 and 7 without the 5, and even
open a weak colour, because "the whole stack is only worth a single point… but
it's better than discarding."

### 2.3 Multipliers are early-or-never, and they cut both ways

Wagers must precede every number, so the option to use one **expires** the
moment you play a number in that colour. Hence: play them early to bank the
multiplier and get the most draws behind them
([BoostYourPlay](https://boostyourplay.com/lost-cities-strategy-tips-to-outwit-your-opponent/),
[Dan on games](https://danongames.wordpress.com/2017/07/10/lost-cities-the-card-game-tips/)).

Against that: a multiplier on an underfunded expedition multiplies the loss, and
"committing to several handshakes raises the stakes enormously"
([Opinionated Gamers](https://opinionatedgamers.com/2015/12/04/lost-cities/)).
BGA's tips settle on **play a wager only when you already hold number cards of
that colour** ([BGA](https://en.doc.boardgamearena.com/Tips_lostcities)).

Two refinements worth keeping:

- **Two early wagers in one colour is the signal to commit** — go for that
  colour hard and slow-play its numbers to maximise draws behind them
  ([BoostYourPlay](https://boostyourplay.com/lost-cities-strategy-tips-to-outwit-your-opponent/)).
- **Play the wager in the colour where you hold the fewest numbers**, so it does
  not telegraph which colour you actually care about
  ([BoostYourPlay](https://boostyourplay.com/lost-cities-strategy-tips-to-outwit-your-opponent/)).
- A wager can also be **discarded as bait** — it puts the decision on the
  opponent, who may not have time to use it
  ([Jon Ericson](https://jlericson.com/2021/12/07/lost_cities.html)).

### 2.4 Every discard is a gift — price it

The strongest defensive idea in the literature.

- Never discard into a colour the opponent has open, and especially not one with
  wagers behind it: "If an opponent has 3 doublers on a color, I will not
  discard anything they can use" (mikeg2,
  [BGA forum](https://forum.boardgamearena.com/viewtopic.php?t=16096)).
- Cards of 5 or below are the safe discards against a player with no wager down
  ([BoostYourPlay](https://boostyourplay.com/lost-cities-strategy-tips-to-outwit-your-opponent/)).
- The comparison is not "which card is worth least to me" but **"which card is
  worth least to them"** — a high card into a colour they have not opened can be
  safer than a low one into a colour they have three wagers in
  ([The Thoughtful Gamer](https://thethoughtfulgamer.com/2021/02/07/5-strategy-tips-for-lost-cities/)).
- When abandoning a colour, **dump the high cards first** — they are the ones
  that let an opponent extend ([BGA](https://en.doc.boardgamearena.com/Tips_lostcities)).
- Discarding low cards can **bait** an opponent into throwing away wagers in a
  colour they think is uncontested
  ([The Thoughtful Gamer](https://thethoughtfulgamer.com/2021/02/07/5-strategy-tips-for-lost-cities/)).

### 2.5 The deck is a clock, and you can push it both ways

- Count it. 18 left ≈ 9 turns each ([gedblog](https://gedblog.com/2012/08/22/lost-cities-tips-tricks/));
  BGA's version is "divide the counter by 2"
  ([BGA](https://en.doc.boardgamearena.com/Tips_lostcities)).
- **Try to take the last card yourself**, which leaves the opponent's final draw
  unplayable ([BGA](https://en.doc.boardgamearena.com/Tips_lostcities), and
  echoed on the BGA forum).
- **Drawing from a discard pile does not shrink the deck**, so it buys a turn.
  Behind, or holding more cards than you have turns to play — stall. Ahead —
  draw from the deck and run out the clock
  ([Jon Ericson](https://jlericson.com/2021/12/07/lost_cities.html),
  [BoostYourPlay](https://boostyourplay.com/lost-cities-strategy-tips-to-outwit-your-opponent/)).
- And watch for it being done to you: "if you see your opponent drawing
  seemingly useless cards from the board… end the game as quickly as you can."
- The default, absent a reason, is still the deck: discards are visible, lower
  value, and taking one tells the opponent something
  ([BGA](https://en.doc.boardgamearena.com/Tips_lostcities)).

### 2.6 Playing high locks out low — manage the gaps

Because a venture only ascends, a 7 played over a held 2 kills the 2 (and the
3, 4, 5, 6 you have not drawn yet).

- "If I have a 4 or 5 card gap (eg, 2,7), I'll hold off on playing the 7,
  especially if the opponent hasn't played that color" (mikeg2,
  [BGA forum](https://forum.boardgamearena.com/viewtopic.php?t=16096)).
- Conversely, gaps on the table **leak information**, so avoid leaving obvious
  ones ([BGA](https://en.doc.boardgamearena.com/Tips_lostcities)).
- High cards early are "something of a curse" — they block your own lows and
  announce your intentions ([Jon Ericson](https://jlericson.com/2021/12/07/lost_cities.html)).
- As the deck empties, the correct willingness to skip numbers rises
  ([Meeple and the Moose](https://meepleandthemoose.com/2021/08/28/lost-cities-dont-start-what-you-cant-finish/)).

### 2.7 The 8-card bonus is a target, not an accident

Rare, but worth steering for once you are close
([BGA](https://en.doc.boardgamearena.com/Tips_lostcities): "remember the 8-card
rule; expeditions packed with numerous cards add a whopping 20 points"). The
route is the one in §2.3: a colour with early wagers, numbers slow-played to
buy draws. Note the bonus is added **after** the multiplier, so it does not
scale — which makes it a length prize, not a multiplier prize.

### 2.8 A minority tactic: buy time with a junk expedition

> "A 3-4-5 expedition costs only −8 points while you buy time hunting for
> handshakes in premium colors."
> — [The Thoughtful Gamer](https://thethoughtfulgamer.com/2021/02/07/5-strategy-tips-for-lost-cities/)

[Dan on games](https://danongames.wordpress.com/2017/07/10/lost-cities-the-card-game-tips/)
goes further: open colours you are weak in deliberately, as a private dumping
ground that denies the opponent the cards. This sits squarely against §2.1 and
§2.2, and it is one of the sharpest disagreements in the literature — a good
first thing to settle with measurement.

## 3. What people disagree about

| question | one side | the other |
|---|---|---|
| Is it a skill game? | "much more random than you might think… like Can't Stop or Yahtzee" (dschingis27) | "a lot to determining what is your statistically best play… like poker" (CaptainKong) — [BGA forum](https://forum.boardgamearena.com/viewtopic.php?t=16096) |
| Open weak colours? | Yes — cheap, denies cards, buys turns ([Dan on games](https://danongames.wordpress.com/2017/07/10/lost-cities-the-card-game-tips/)) | No — every opening is −20 you must earn back ([most sources](#21-run-three-or-four-colours-not-five)) |
| Draw from discards? | Routinely, to control tempo | Rarely — the deck is where value and secrecy are ([BGA](https://en.doc.boardgamearena.com/Tips_lostcities)) |
| Wagers before numbers? | Always, early, to bank the multiplier | Only with numbers already in hand |

The one thing both sides of the skill argument agree on: **tight play is what
distinguishes strong players.** "The better players play more of a tight game
and that is why their results are much more consistent" (CaptainKong).

## 4. Where our own numbers disagree with the folklore — and why

The lab's [computers](README.md#computers) measured **Wager Open 4** — which
refuses to open a fifth colour — at **−43 against plain Wager Open**. Human
consensus (§2.1) is the exact opposite: three or four colours, never five.

Both are probably right, about different games. Our runner is **solitaire**:

- **Every card comes to you.** In a real game the opponent takes half the deck,
  so the 12 cards of a colour are contested and a fifth expedition is far more
  likely to strand.
- **You get ~44 turns, not ~22.** Time is the binding constraint on a fifth
  colour in the real game, and our harness removes it.
- **Nothing punishes you.** No opponent profits from your discards, so the cost
  of spreading thin is only the −20 and never the gift.

That is a genuinely useful result: it isolates *which part of the real game*
makes the folklore true. The 3–4 colour rule is not about the −20 at all — it is
about **contested cards and halved tempo**. Which means the single most valuable
thing we could build is a **two-player harness**, because most of the interesting
advice in Part 1 (denial, baiting, tempo racing, blocking) is invisible to a
solitaire test by construction.

Two smaller things the lab already knows that the literature does not discuss:

- **Dealt colour strength is wildly lopsided.** Ranked medians of the five
  colours you are dealt: **−9 · 4 · 15 · 28 · 64** (total 102). Your worst
  colour is typically worth *negative* points — the folklore's "focus on 3–4"
  is downstream of this, and we have the number for it.
- **"Play what costs the least potential" encodes wagers-first and play-low for
  free** — a red 2 onto an empty pile costs 102 potential, a red wager costs 0.
  Two separate pieces of folklore fall out of one rule.

---

# Part 2 — ideas for the lab

Nothing below is built. It is a menu, roughly ordered by how much I think each
would teach us.

## 5. The structural change everything else wants

**A two-player computers harness.** Today `playSoloGame` deals one hand and
never models an opponent, so the entire defensive half of the game — the half
the sources care most about — cannot be expressed, let alone measured. With two
computers on one deck we could finally test: does denial pay? does the 3-colour
rule hold? is stalling worth a turn? is baiting real?

It also fixes a smaller thing I noticed while reading the runner: the README
says the computers play "3,000 **identical** deals", but `cpuRun` calls
`playSoloGame` with no shared rng, so each computer gets its own random deck.
The comparisons are unpaired, which makes them noisier than they claim to be.
Pairing deals across computers is a small change and would tighten every number
in that table.

## 6. Variables worth adding

Grouped by what they let you express. The ones marked ★ are the ones I would add
first — each unlocks a piece of strategy the current vocabulary simply cannot
say.

### Time and tempo
- ★ **`turns left`** — already there as `proj turns`.
- ★ **`playable turns`** = `min(cards I could still play, turns left)`. The
  binding constraint, and the thing that makes a "potential" honest.
- **`turns if I stall`** — what a discard draw buys.
- **`i take the last card`** — whether the current parity leaves the final draw
  to me (§2.5, and a real tactic).
- **`opponent is stalling`** — has the opponent drawn from discards recently.

### Break-even and commitment
- ★ **`break even gap`** — points still needed in a colour to clear the −20.
  Every threshold in §2.2 is a statement about this number.
- ★ **`cards to break even`** — how many more cards of that colour it takes.
- **`one card rule`** — true if one more playable card clears it (§2.2 as a
  primitive).
- **`opens a colour`** — whether this play is the first card of a venture, so a
  program can gate openings without hand-rolling it.
- **`hand points in colour`** — the raw number every human threshold uses.

### Potential, made honest
- ★ **`reachable potential`** — potential capped by `playable turns`. The
  current `potential` assumes you can play twelve cards in six turns; this is
  the version a real decision wants.
- **`potential per turn`** — value density, for choosing between colours.
- **`change in reachable potential`** — the same fix applied to the cost rule.

### The opponent (needs §5)
- ★ **`gift value`** — what discarding this card is worth to the opponent, given
  their open colours and multipliers. §2.4 is entirely this number.
- ★ **`opp break even gap`** per colour — is a colour still a liability for them.
- **`opp wagers`** in a colour, **`opp pile top`**, **`opp is open`**.
- **`blocking value`** — points denied by holding a card they need.
- **`margin`** — my score minus theirs, which is what switches a computer
  between racing and stalling (§2.5).

### Cards and sequence
- ★ **`lockout cost`** — how many points of my own hand this play kills by
  ascending past them. The gap rule (§2.6) is this number.
- **`gap below`** — how many playable lower cards of that colour are still
  unseen.
- **`unseen in colour`** — cards of a colour not yet visible anywhere; the base
  of every probability question.
- **`chance i draw one`** — hypergeometric, from `unseen` and `turns left`. We
  already do this maths in the dealing-statistics section.
- **`is wager`** — expressible today as `card num == 0`, but worth a name.

### The bonus
- **`cards in pile`**, **`cards to bonus`** (8 − pile size), **`bonus
  reachable`** (given turns and unseen cards). §2.7 needs all three.

### Language shape, not just vocabulary
- ★ **Compare two values.** Today the right-hand side of a comparison must be a
  number, so `if potential > opp potential:` cannot be written. This is the
  single biggest limitation of the language as it stands.
- ★ **A `score` statement.** Instead of only filtering
  (`if change in potential min:`), let a program *rank*:
  `score = potential - 2 * lockout cost` then `play max`. Every strong computer
  is really an evaluation function, and filters express those clumsily.
- **Arithmetic** (`potential - 20`), **`for color in colors:`** for colour-level
  choices, and **named constants** so a threshold can be tuned in one place.

## 7. Computers worth building

Each is a hypothesis from Part 1, stated so it can be measured against the
others. The first group is buildable in today's language; the second needs §6;
the third needs the two-player harness.

### Buildable now
1. **Break-Even** — never open a colour holding under N points of it. The
   headline folklore, and N is a dial we can sweep (8, 10, 12, 15) to find where
   the sources' disagreement actually lands.
2. **Open Late, Open Never** — refuse to open any colour after turn T. Tests
   §2.2's "no time to start another expedition".
3. **Junk Dump** — deliberately opens a cheap colour to buy turns (§2.8),
   against a computer that never does. Settles the sharpest disagreement in the
   literature.
4. **High-Card Curse** — never opens with a number above 5 (gedblog's rule
   inverted), versus one that opens with anything.

### Needs the new variables
5. **The Realist** — plays to `reachable potential` rather than potential.
   My guess: this is the single biggest strength gain available, because the
   current rule cheerfully values cards it will never have time to play.
6. **One Card Rule** — the §2.2 formulation, exactly as written.
7. **Sequencer** — weighs `lockout cost`, so it holds the 7 over a held 2 while
   the colour is still live and stops caring as the deck empties (§2.6).
8. **Bonus Hunter** — picks one colour with early wagers and steers for eight
   cards, slow-playing numbers (§2.7).
9. **Evaluator** — a single scoring function over every legal move
   (`reachable potential − lockout cost + tempo`), which is what the cheat
   toolkit's advisor does. The natural "strong baseline" to beat.

### Needs a two-player harness
10. **The Miser** — discards purely by `gift value` (§2.4). The cleanest test of
    whether denial is worth real points.
11. **The Baiter** — throws low cards early to tempt wagers out (§2.4), which
    would be the first computer that plays the *opponent* rather than the cards.
12. **Tempo** — races when ahead, stalls when behind, and tries to take the last
    card (§2.5).
13. **Three Colours** — commits to its best three by dealt potential and dumps
    the rest. The point is the head-to-head: our solitaire result says this is
    terrible and every human says it is correct, so whichever way it lands we
    learn exactly what the harness was hiding.
14. **The Folklore** — every rule in Part 1 at once, as one computer. If the
    consensus is coherent it should be strong; if it is a pile of contradictory
    proverbs, it will be beaten by something much simpler, and that would be the
    most interesting result on this page.
15. **Endgame Solver** — exact search once the deck is short. Perfect
    information over the last few cards needs no opponent model, so it is the
    one component that is *provably* right — and a useful yardstick for how much
    the heuristics leave on the table.

## Sources

- [The Thoughtful Gamer — 5 Strategy Tips for Lost Cities](https://thethoughtfulgamer.com/2021/02/07/5-strategy-tips-for-lost-cities/)
- [BoostYourPlay — Lost Cities: Strategy Tips to Outwit Your Opponent](https://boostyourplay.com/lost-cities-strategy-tips-to-outwit-your-opponent/)
- [Board Game Arena — Tips: Lost Cities](https://en.doc.boardgamearena.com/Tips_lostcities)
- [Board Game Arena forum — Strategy Tips?](https://forum.boardgamearena.com/viewtopic.php?t=16096)
- [Dan on games — Lost Cities the Card Game tips](https://danongames.wordpress.com/2017/07/10/lost-cities-the-card-game-tips/)
- [gedblog — Lost Cities Tips & Tricks](https://gedblog.com/2012/08/22/lost-cities-tips-tricks/)
- [Jon Quixote (Jon Ericson) — Lost Cities](https://jlericson.com/2021/12/07/lost_cities.html)
- [The Opinionated Gamers — Lost Cities](https://opinionatedgamers.com/2015/12/04/lost-cities/)
- [Meeple and the Moose — Don't Start What You Can't Finish](https://meepleandthemoose.com/2021/08/28/lost-cities-dont-start-what-you-cant-finish/)
- [Meadow Party — Lost Cities](https://meadowparty.com/blog/2010/07/06/lost-cities/)
- [BoardGameGeek — Key strategies for LC](https://boardgamegeek.com/thread/2695397/key-strategies-for-lc)
- [BoardGameGeek — Average score?](https://boardgamegeek.com/thread/405890/average-score)
- [Wikipedia — Lost Cities](https://en.wikipedia.org/wiki/Lost_Cities)
- [aadcock/lost_cities](https://github.com/aadcock/lost_cities) — a Python
  strategy-simulation repo. Structure only; it publishes no results.

⚠️ **BoardGameGeek blocks automated fetching (HTTP 403)**, so the two BGG threads
above are included from search summaries rather than read in full. They are the
one obvious gap in this survey — worth reading by hand, since BGG is where the
most experienced players actually argue.
