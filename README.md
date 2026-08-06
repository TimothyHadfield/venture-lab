# Venture Lab

A standalone, offline **Venture** card game — a sandbox for tinkering with
probability, computer opponents, and strategy. No online play, no accounts,
no build step: it's a single `index.html` you can open in any browser.

**▶ Play:** https://timothyhadfield.github.io/venture-lab/

## The game

Build **ventures** — ascending runs of a single colour in your play area.
Wagers (`×2`) must come *before* any numbers and multiply that venture.

- A venture scores **(sum of numbers − 20) × (1 + wagers)**, plus **+20** if it
  reaches 8 cards. The −20 is the cost of starting, so short ventures lose points.
- **Your turn:** ① play one card to a venture, or discard it · ② draw from the
  deck or a discard-pile top (not the pile you just discarded to).
- The game ends when the **draw pile empties**. Highest total wins.

## Modes

- **You vs Computer** — three AI tiers: Casual (loose), Solid (greedy), Sharp
  (greedy + value nudge).
- **2-Player Hotseat** — pass the device back and forth.

## The probability panel

The right sidebar shows what's still **unseen** — the cards in the deck plus the
opponent's hand, which you can't tell apart. It's a starting point for exploring
the odds: what's likely to come next, which colours are running dry, and how that
should steer which ventures you commit to.

## Tinkering

Everything is in `index.html`. Good places to experiment:

- `aiMove()` — the computer's decision logic. Add a smarter tier, a lookahead, or
  a Monte-Carlo rollout here.
- `pileScore()` / the constants at the top — change the scoring or deck shape.
- `renderProb()` / `unseen()` — build richer probability tools (draw odds,
  expected value of a venture, opponent-hand inference).

No dependencies. Edit, refresh, done.
