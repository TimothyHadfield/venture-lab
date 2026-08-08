"use strict";
/* ============================================================================
   computers.js — build computers, and test them.

   ── THE GAME THEY PLAY ────────────────────────────────────────────────────
   Solitaire, for now: no opponent to compete with. Shuffle a deck, take 8
   cards, then each turn play one card to a venture and draw one. The game ends
   when the draw pile empties — 52 turns, ending with 8 cards still in hand.

   The discard pile is a fallback, never a source: no computer ever draws from
   it. Most discard only when nothing is legally playable; a computer may also
   discard by choice if its own strategy refuses every legal play (Lowest 3+
   does exactly that), which is why intent is explicit in the contract below.

   ── WHAT A COMPUTER KNOWS ─────────────────────────────────────────────────
   With no opponent, the cards that remain unseen are exactly the ones in the
   deck plus the ones in hand — so a computer can know that SET exactly (not its
   order) just by tracking what has been played and discarded. `potentialFor`
   below uses that set, so nothing here peeks at the deck's order.

   ── ADDING A COMPUTER ─────────────────────────────────────────────────────
   Add an entry to COMPUTERS. `decide(view)` gets:
       view.hand      cards in hand
       view.piles     {colour: [cards played]}
       view.pool      {colour: [cards still unseen — deck + hand]}
       view.playable  the subset of hand that can legally be played now
       view.rng()     random in [0,1)
   and returns { card, action } where action is 'play' or 'discard'. Say which:
   the engine will NOT guess, because a computer that means to discard a card
   that happens to be playable would otherwise have it played instead.
   Everything else (legality, drawing, scoring) is handled here.
   ========================================================================== */

/* Potential of one colour: what that colour scores if every card still
   available to it gets played in order. `venturePotential` (lab.js) is the
   single definition of the rule, shared with the board's readout.

   The POOL here is deck + hand, with discards excluded — where the board's
   readout counts them. Deliberate: these computers never draw from a discard
   pile (see the header), so a card they discard is genuinely gone to them,
   while a player on the board can reach one. Same rule, different reachable
   set, which is the part that belongs to the caller. */
function potentialFor(piles, pool, color){
  return venturePotential(piles[color], pool[color]);
}

/* How much playing `card` costs that colour's potential. Playing out of order
   locks lower cards out, and playing any number locks out every remaining
   wager of that colour — so this is what makes "play low, wagers first" fall
   out of the rule rather than being hard-coded. */
function playCost(piles, pool, card){
  const color = card.color;
  const before = potentialFor(piles, pool, color);
  const pile2 = piles[color].concat([card]);
  const pool2 = pool[color].filter(c => c !== card);
  return before - venturePotential(pile2, pool2);
}

/* How much discarding `card` costs — it leaves the pool without joining a pile. */
function discardCost(piles, pool, card){
  const color = card.color;
  const before = potentialFor(piles, pool, color);
  const pool2 = pool[color].filter(c => c !== card);
  return before - venturePotential(piles[color], pool2);
}

/* ── REACHABLE potential — the same rule under a turn budget ────────────────
   `potentialFor` values a colour as if you could play every card of it that is
   still available. You cannot: the deck is a clock. Reachable potential is that
   same rule capped at the plays you actually have left, which is what makes a
   computer stop valuing cards it will never get down. See STRATEGY.md §6.

   In solitaire one deck card comes off per turn, so turns left = deck size, and
   the deck is the pool minus your hand. */
function turnsLeft(hand, pool){
  let n = 0;
  for (const c of CONFIG.colors) n += pool[c].length;
  return n - hand.length;
}

function reachableFor(piles, pool, color, turns){
  return venturePotential(piles[color], pool[color], turns);
}

/* What a move costs in reachable terms — and, unlike playCost/discardCost, on
   ONE scale for plays and discards alike. Both consume a turn, so both are
   priced against the same "before" with a budget one turn smaller afterwards.
   That is what lets a computer decide that every play available is worse than
   throwing something away, instead of being told to play whenever it legally
   can. */
function reachableCost(piles, pool, card, turns, action){
  const color = card.color;
  const before = reachableFor(piles, pool, color, turns);
  const pool2 = {}; pool2[color] = pool[color].filter(c => c !== card);
  const piles2 = {}; piles2[color] = action === 'play' ? piles[color].concat([card]) : piles[color];
  return before - reachableFor(piles2, pool2, color, turns - 1);
}

/* How much potential The Patient will pay for a play while it still has a free
   card to throw instead. Swept over paired shuffles: 0 → +108 against Wager
   Open, 20 → +115, 25 → +115, 30 → +113, 40 → +96. Flat across the middle, so
   25 is the centre of the plateau rather than a fitted number. */
const PATIENCE = 25;

/* Deterministic tie-break so a computer's play is reproducible: cheapest cost,
   then lowest card (wagers are 0, so they lead), then colour order. */
function _pickCheapest(cards, costOf){
  let best = null, bestCost = Infinity, bestVal = Infinity, bestCol = Infinity;
  for (const c of cards){
    const cost = costOf(c);
    const col = CONFIG.colors.indexOf(c.color);
    if (cost < bestCost - 1e-9 ||
       (Math.abs(cost - bestCost) < 1e-9 &&
         (c.value < bestVal || (c.value === bestVal && col < bestCol)))){
      best = c; bestCost = cost; bestVal = c.value; bestCol = col;
    }
  }
  return best;
}

/* The Lowest family, in one place. Play the cheapest card the gate permits; if
   the gate permits nothing, discard by the same cost rule and SAY so. `openable`
   decides whether a card may be played, and only ever matters for the first card
   of a colour — a started venture is already paid for, so there is nothing left
   to gate. Pass null for no gate. */
function _lowestGated(view, openable){
  const allowed = openable ? view.playable.filter(openable) : view.playable;
  if (allowed.length)
    return { action:'play',
             card: _pickCheapest(allowed, c => playCost(view.piles, view.pool, c)) };
  return { action:'discard',
           card: _pickCheapest(view.hand, c => discardCost(view.piles, view.pool, c)) };
}

/* ============================================================================
   THE COMPUTERS
   ========================================================================== */

const COMPUTERS = {
  lowest: {
    name: 'Lowest',
    blurb: 'Plays the card that decreases that colour\'s potential the least. ' +
           'Ties break to the lowest card. When nothing is playable it discards ' +
           'by the same rule — the card whose loss costs the least potential.',
    decide(view){ return _lowestGated(view, null); },
  },

  lowest3: {
    name: 'Lowest 3+',
    blurb: 'Lowest, but it will not OPEN a colour unless it is holding at least 3 ' +
           'cards of that colour (the candidate counts toward the 3). Once a venture ' +
           'is started it plays there exactly like Lowest. If the gate leaves nothing ' +
           'it is willing to play, it discards — so unlike the others it can discard ' +
           'on a turn where a legal play existed.',
    decide(view){
      // Wagers are gated too: a wager on an empty pile opens the colour just as
      // a number does, and opening a colour you cannot fill is the thing being
      // avoided.
      return _lowestGated(view, c => view.piles[c.color].length > 0 ||
        view.hand.reduce((n, x) => n + (x.color === c.color ? 1 : 0), 0) >= 3);
    },
  },

  wageropen: {
    name: 'Wager Open',
    blurb: 'Lowest, but a colour can only be STARTED with a wager — a number may ' +
           'never be the first card of a venture. Once the colour is open it plays ' +
           'there exactly like Lowest, numbers included. Holding no wager of a ' +
           'colour it has not opened, it simply will not go there.',
    decide(view){
      return _lowestGated(view, c => view.piles[c.color].length > 0 || c.value === 0);
    },
  },

  wageropen4: {
    name: 'Wager Open 4',
    blurb: 'Wager Open, but it never spreads across every colour — once 4 ventures ' +
           'are running it will not start a 5th, whatever it draws. Every venture ' +
           'costs 20 up front, so leaving one colour alone saves that 20 and puts ' +
           'the same cards into fewer, longer ventures.',
    decide(view){
      // "Stops at 4" = one short of the full spread, derived from the colour
      // count rather than hard-coded, so it still means "all but one" if the
      // venture count is ever changed to 4 or 6.
      const maxOpen = CONFIG.colors.length - 1;
      return _lowestGated(view, c => {
        if (view.piles[c.color].length > 0) return true;   // already running
        if (c.value !== 0) return false;                   // open only on a wager
        let open = 0;
        for (const col of CONFIG.colors) if (view.piles[col].length > 0) open++;
        return open < maxOpen;
      });
    },
  },

  /* ── THE PATIENT ─────────────────────────────────────────────────────────
     The strongest computer here by a distance, and the two rules that make it
     so are both borrowed from human strategy writing (STRATEGY.md §2.6, §2.2).

     1. PATIENCE. A venture only ascends, so playing a 7 over a held 2 kills the
        2 — and every 3, 4, 5 and 6 still to come. Lowest and Wager Open have no
        choice: they play whenever a legal play exists, so they lock themselves
        out early and finish with short ventures. This one refuses: while it
        still holds a card that costs NOTHING to throw away (one the pile has
        already climbed past — a dead card), it will not make a play that costs
        more than PATIENCE potential. It spends the dead card instead and waits
        for the low cards to come to it.
     2. OPEN ANYTHING IT CAN PAY FOR. Wager Open never opens a colour without a
        multiplier, which strands every card of a colour it drew no wager in.
        This one opens with a number too, as long as the colour can still finish
        above zero in the turns left.

     Everything is priced in REACHABLE potential, so a colour is only worth what
     there is time to collect.

     ⚠️ Measured in SOLITAIRE, where every card eventually reaches you and a
     discard costs nothing because there is nobody to receive it. Patience is
     close to free under those rules and would not be against a real opponent —
     see STRATEGY.md §4 and §7.
     ────────────────────────────────────────────────────────────────────────── */
  patient: {
    name: 'The Patient',
    blurb: 'Never locks itself out. While it still holds a dead card it can throw ' +
           'for free, it refuses any play that would cost real potential — so the ' +
           'low cards it is waiting for still fit when they arrive. It opens a ' +
           'colour with a number as well as a wager, provided the colour can still ' +
           'finish above zero in the turns left, and prices everything by what ' +
           'there is time to collect. Lands an 8+ venture in 99% of games, against ' +
           '31% for Wager Open.',
    decide(view){
      const turns = Math.max(1, turnsLeft(view.hand, view.pool));

      const allowed = view.playable.filter(c => {
        if (view.piles[c.color].length > 0) return true;      // already running
        if (c.value === 0) return true;                       // a wager opens anything
        // A NUMBER may open a colour only if it can still be made to pay.
        const piles2 = {}; piles2[c.color] = [c];
        const pool2  = {}; pool2[c.color]  = view.pool[c.color].filter(x => x !== c);
        return reachableFor(piles2, pool2, c.color, turns - 1) >= 0;
      });

      const dump = _pickCheapest(view.hand, c => reachableCost(view.piles, view.pool, c, turns, 'discard'));
      const dumpCost = dump ? reachableCost(view.piles, view.pool, dump, turns, 'discard') : Infinity;

      if (allowed.length){
        const play = _pickCheapest(allowed, c => reachableCost(view.piles, view.pool, c, turns, 'play'));
        const cost = reachableCost(view.piles, view.pool, play, turns, 'play');
        // The patience rule. Both halves matter: an expensive play is only worth
        // refusing if there is something FREE to throw instead, or it would
        // stall for ever holding cards it can never afford to play.
        if (!(cost > PATIENCE && dumpCost <= 0)) return { action: 'play', card: play };
      }
      return { action: 'discard', card: dump };
    },
  },

  /* ── THE BROKER ──────────────────────────────────────────────────────────
     The first computer here that prices the other side of the table. Every
     move is scored in one currency — the projected final MARGIN, my total minus
     theirs — so the trade the whole thing exists for becomes a subtraction:

       play a card I would rather not:  costs me the lockout, gives them nothing
       discard a card they want:        costs me its use, GIVES THEM its value

     and whichever number is smaller wins. Denial needs no special case: keeping
     a card simply never adds it to their side.

     It uses the perfect information this lab has — the deck's order and the
     opponent's hand — so "who gets the red 6" is read off the alternation
     rather than guessed at.

     In SOLITAIRE it has no opponent to price, so it falls back to being a
     projection-maximiser; the duel is where it means anything.
     ──────────────────────────────────────────────────────────────────────── */
  broker: {
    name: 'The Broker',
    blurb: 'Scores every move by the projected final margin — what it gains me ' +
           'minus what it hands them. A discard is charged with what the card is ' +
           'worth in the opponent\'s ventures (nothing at all if their pile has ' +
           'climbed past it), so it will take a worse play over a generous ' +
           'discard, and hold a card they need rather than give it away. Uses the ' +
           'deck order and their hand, which this lab lets it see.',
    decide(view){
      const solo = !view.oppHand;                 // solitaire: nobody to trade with
      const deck = view.deck || [];
      const discards = view.discards || _byColor();

      // Solitaire hands over no ordered deck — only the SET of unseen cards —
      // and there nobody else is drawing, so every one of them reaches you and
      // the game lasts one turn per deck card. Reading the duel's alternation
      // into that world had it believing one turn was left from the very first
      // move, so it discarded all 52 cards and scored 0. Same computer, two
      // very different clocks.
      const deckCount = solo ? turnsLeft(view.hand, view.pool) : deck.length;
      const myTurns = Math.max(1, solo ? deckCount : Math.ceil(deckCount / 2));
      const theirTurns = solo ? 0 : Math.max(0, Math.floor(deckCount / 2));
      const sched = solo ? null : duelSchedule(view);

      const myAvail = base => {
        if (solo){
          // Everything unseen is mine eventually: the pool already IS hand+deck,
          // so rebuild it minus whichever card this move spends.
          const keep = {};
          for (const c of CONFIG.colors) keep[c] = view.pool[c].slice();
          const gone = view.hand.filter(c => base.indexOf(c) < 0);
          for (const g of gone){
            const i = keep[g.color].indexOf(g);
            if (i >= 0) keep[g.color].splice(i, 1);
          }
          return keep;
        }
        return duelAvailable(base, sched.mine, discards);
      };
      const theirAvailWith = extra => {
        const d = {};
        for (const c of CONFIG.colors) d[c] = (discards[c] || []).slice();
        if (extra) d[extra.color] = d[extra.color].concat([extra]);
        return duelAvailable(view.oppHand, sched.theirs, d);
      };

      // Their side is the same for every PLAY I could make — only a discard
      // changes what they can reach — so it is computed once.
      const theirBase = solo ? 0 : duelProject(view.oppPiles, theirAvailWith(null), theirTurns);

      let best = null;
      const consider = (action, card, mine, theirs) => {
        const value = mine - theirs;
        if (!best || value > best.value + 1e-9 ||
           (Math.abs(value - best.value) < 1e-9 && action === 'play' && best.action === 'discard')){
          best = { action, card, value };
        }
      };

      const handLess = card => view.hand.filter(c => c !== card);

      for (const card of view.playable){
        const piles2 = {};
        for (const c of CONFIG.colors) piles2[c] = view.piles[c];
        piles2[card.color] = view.piles[card.color].concat([card]);
        const mine = duelProject(piles2, myAvail(handLess(card)), myTurns - 1);
        consider('play', card, mine, theirBase);
      }
      for (const card of view.hand){
        const mine = duelProject(view.piles, myAvail(handLess(card)), myTurns - 1);
        // The gift: the card lands on a discard pile they may take from.
        const theirs = solo ? 0
          : duelProject(view.oppPiles, theirAvailWith(card), theirTurns);
        consider('discard', card, mine, theirs);
      }

      // The draw, priced the same way: what the card adds to me, less what
      // leaving it on the pile would have given them.
      let draw = 'deck';
      if (!solo){
        const next = deck.length ? deck[deck.length - 1] : null;
        let bestDraw = next
          ? duelProject(view.piles, myAvail(view.hand.concat([next])), myTurns - 1) - theirBase
          : -Infinity;
        for (const col of CONFIG.colors){
          const pile = discards[col];
          if (!pile || !pile.length) continue;
          if (best.action === 'discard' && best.card.color === col) continue;  // just discarded there
          const top = pile[pile.length - 1];
          const d = {};
          for (const c of CONFIG.colors) d[c] = (discards[c] || []).slice();
          d[col] = d[col].slice(0, -1);                       // taking it denies it to them
          const mine = duelProject(view.piles, duelAvailable(view.hand.concat([top]), sched.mine, d), myTurns - 1);
          const theirs = duelProject(view.oppPiles, duelAvailable(view.oppHand, sched.theirs, d), theirTurns);
          if (mine - theirs > bestDraw){ bestDraw = mine - theirs; draw = col; }
        }
      }
      return { action: best.action, card: best.card, draw };
    },
  },

  random: {
    name: 'Random',
    blurb: 'Plays a uniformly random legal card. When nothing is playable it ' +
           'discards a uniformly random card. The baseline everything else has to beat.',
    decide(view){
      const play = view.playable.length > 0;
      const from = play ? view.playable : view.hand;
      return { action: play ? 'play' : 'discard',
               card: from[Math.floor(view.rng() * from.length)] };
    },
  },
};

/* ============================================================================
   THE SOLITAIRE GAME
   ========================================================================== */

function playSoloGame(bot, rng){
  rng = rng || Math.random;
  const colors = CONFIG.colors;
  const deck = RULES.createDrawPile();

  const piles = {}, discards = {}, pool = {};
  for (const c of colors){ piles[c] = []; discards[c] = []; pool[c] = []; }
  // The pool starts as every card — deck plus the hand about to be dealt. It
  // shrinks only when a card is played or discarded, which is exactly what a
  // player can see.
  for (const c of deck) pool[c.color].push(c);

  const hand = [];
  for (let i = 0; i < CONFIG.handSize; i++) hand.push(deck.pop());

  let played = 0, discarded = 0;
  while (deck.length){
    const playable = hand.filter(c => RULES.canPlayOnPlayPile(c, piles[c.color]));
    const view = { hand, piles, pool, playable, rng };
    const move = bot.decide(view);
    const card = move.card;

    // Intent has to be EXPLICIT. Inferring "play if the card happens to be
    // legal" silently overrode a computer that had deliberately chosen to
    // discard — Lowest 3+ refuses to open a thin colour, but if the card it
    // picked to throw away was itself playable, it got played anyway and the
    // whole restriction leaked.
    const wantsPlay = move.action !== 'discard';
    const canPlay = playable.indexOf(card) >= 0;
    if (wantsPlay && !canPlay)
      throw new Error('computer tried to play an illegal card: ' + card.id);

    const i = hand.indexOf(card);
    hand.splice(i, 1);
    const pi = pool[card.color].indexOf(card);
    if (pi >= 0) pool[card.color].splice(pi, 1);

    if (wantsPlay){
      piles[card.color].push(card);
      played++;
    } else {
      discards[card.color].push(card);
      discarded++;
    }
    hand.push(deck.pop());               // the draw that ends the game when it empties
  }

  let score = 0;
  for (const c of colors) score += MATH.scorePlayPile(piles[c]);
  return { score, played, discarded, piles, discards, hand };
}

/* ============================================================================
   THE DUEL — two computers, one deck, perfect information

   Solitaire cannot express half of Venture: with nobody across the table, a
   discard costs nothing, denial is meaningless and there is no such thing as a
   card being worth more to them than to you. This is the same game with an
   opponent, and it is where a valuation that prices both sides can finally be
   measured.

   WHAT A DUEL COMPUTER CAN SEE. Everything: the ordered deck, the opponent's
   hand, both play piles, every discard. That is a deliberate choice — this is a
   perfect-information study board, not a simulation of a real player's
   knowledge — and it means "the chance I draw the red 6" is not a probability
   here, it is a lookup. A computer built for a real player, seeing only its own
   hand and the discards, is a different (and also interesting) exercise.

   The solitaire contract is a subset of the duel one, so every existing
   computer runs in a duel unchanged: hand, piles, pool, playable and rng mean
   what they always did.
   ========================================================================== */

function _byColor(){ const o = {}; for (const c of CONFIG.colors) o[c] = []; return o; }
function _other(slot){ return slot === 'player1' ? 'player2' : 'player1'; }

function duelView(me, hands, piles, discards, deck, lastDiscard, rng){
  const opp = _other(me);
  // `pool` keeps its solitaire meaning — what is still gettable BY ME — which
  // under this lab's potential rule is the deck plus my own hand. Their hand is
  // visible (below) but is not mine to have.
  const pool = _byColor();
  for (const c of hands[me]) pool[c.color].push(c);
  for (const c of deck) pool[c.color].push(c);
  return {
    hand: hands[me], piles: piles[me], pool,
    playable: hands[me].filter(c => RULES.canPlayOnPlayPile(c, piles[me][c.color])),
    rng: rng || Math.random,
    // the duel extras
    me, opp, oppHand: hands[opp], oppPiles: piles[opp],
    deck,                       // ORDERED — deck[deck.length - 1] is the next card drawn
    discards, lastDiscard,
  };
}

/* One game. `opts.deck` replays a given shuffle, which is how the runner pairs
   a deal and swaps seats on it. */
function playDuelGame(botA, botB, opts){
  opts = opts || {};
  const deck = opts.deck ? opts.deck.slice() : RULES.createDrawPile();
  const hands = { player1: [], player2: [] };
  const piles = { player1: _byColor(), player2: _byColor() };
  const discards = _byColor();
  for (let i = 0; i < CONFIG.handSize; i++){ hands.player1.push(deck.pop()); hands.player2.push(deck.pop()); }

  const bots = { player1: botA, player2: botB };
  let turn = 'player1', lastDiscard = null, plies = 0, stalls = 0;
  // Both players can draw from discard piles for ever without touching the
  // deck, and then the game never ends — a real livelock, not a hypothetical.
  // The cap ends it and is counted, so a run cannot quietly become a different
  // experiment.
  const MAX_PLIES = opts.maxPlies || 400;

  while (deck.length > 0 && plies < MAX_PLIES){
    plies++;
    const me = turn;
    const move = bots[me].decide(duelView(me, hands, piles, discards, deck, lastDiscard, opts.rng));
    const card = move.card;
    const idx = hands[me].indexOf(card);
    if (idx < 0) throw new Error('computer played a card it does not hold');
    const wantsPlay = move.action !== 'discard';
    if (wantsPlay && !RULES.canPlayOnPlayPile(card, piles[me][card.color]))
      throw new Error('computer tried to play an illegal card: ' + card.id);

    hands[me].splice(idx, 1);
    if (wantsPlay){ piles[me][card.color].push(card); lastDiscard = null; }
    else { discards[card.color].push(card); lastDiscard = card.color; }

    // The draw. A computer that names no source takes the deck, which is what
    // every solitaire computer does — so they all still work here.
    const want = move.draw && move.draw !== 'deck' ? move.draw : null;
    let drew = null;
    if (want && want !== lastDiscard && discards[want] && discards[want].length){
      drew = discards[want].pop();
      stalls++;                        // the deck did not move: the game got longer
    } else {
      drew = deck.pop();
    }
    if (drew) hands[me].push(drew);
    turn = _other(me);
  }

  const score = s => { let t = 0; for (const c of CONFIG.colors) t += MATH.scorePlayPile(piles[s][c]); return t; };
  const p1 = score('player1'), p2 = score('player2');
  return { p1, p2, margin: p1 - p2, plies, stalls, hung: deck.length > 0, piles };
}

/* ============================================================================
   VALUING A MOVE — both sides of it

   The currency is the expected final MARGIN: what I finish with minus what they
   finish with. Everything else here exists to estimate those two numbers.

   Potential is a per-colour ceiling and five of them cannot be added, because
   turns are one budget shared between them. `duelProject` spends that budget
   greedily, best colour first, taking each colour at most once — the same
   conservative approximation the cheat toolkit's advisor uses for its footer.

   With the deck order known, "who gets the red 6" is not a guess: the cards
   alternate from the top of the deck, starting with whoever is to move. That
   assumption breaks the moment either player draws from a discard pile — it
   shifts the parity — which is exactly why it is called a projection.
   ========================================================================== */

function duelSchedule(view){
  const mine = [], theirs = [];
  for (let i = view.deck.length - 1, k = 0; i >= 0; i--, k++) (k % 2 ? theirs : mine).push(view.deck[i]);
  return { mine, theirs };
}

/* What each player can still get their hands on, per colour: their own hand,
   the deck cards the alternation sends them, and the top of each discard pile
   (only the top — the rest is buried, exactly as the board's readout has it). */
function duelAvailable(hand, scheduled, discards){
  const avail = _byColor();
  for (const c of hand) avail[c.color].push(c);
  for (const c of scheduled) avail[c.color].push(c);
  for (const col of CONFIG.colors){
    const pile = discards[col];
    if (pile && pile.length) avail[col].push(pile[pile.length - 1]);
  }
  return avail;
}

function duelProject(piles, avail, turns){
  let total = 0;
  for (const c of CONFIG.colors) total += MATH.scorePlayPile(piles[c]);
  let budget = Math.max(0, turns);
  const spent = {};
  while (budget > 0){
    let bestC = null, bestGain = 0, bestUsed = 0;
    for (const c of CONFIG.colors){
      if (spent[c]) continue;
      const plan = venturePlan(piles[c], avail[c] || [], budget);
      const gain = plan.score - MATH.scorePlayPile(piles[c]);
      if (gain > bestGain){ bestGain = gain; bestC = c; bestUsed = plan.used; }
    }
    if (!bestC) break;                      // nothing left that is worth a turn
    total += bestGain;
    budget -= Math.max(1, bestUsed);
    spent[bestC] = true;
  }
  return total;
}

/* ============================================================================
   RUNNER + UI
   ========================================================================== */

/* A computer's name is whatever the user typed in the builder, and it reaches
   every table, picker and tooltip on this page. Escaped once, here. */
const _esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                           .replace(/"/g, '&quot;');
const _sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);

/* A pile is at worst a venture of wagers alone, so a colour cannot score below
   (0 − baseCost) × (1 + wagerCount); at best it is the complete colour. */
const SCORE_MIN = CONFIG.colors.length * (0 - CONFIG.scoring.baseCost) * (1 + CONFIG.wagerCount);
const SCORE_MAX = CONFIG.colors.length * (function(){
  let s = 0;
  for (let v = CONFIG.numberRange[0]; v <= CONFIG.numberRange[1]; v++) s += v;
  return (s - CONFIG.scoring.baseCost) * (1 + CONFIG.wagerCount) + CONFIG.scoring.bonusPoints;
})();

const CPU = { runs: null, running: false, target: 0, chunk: 200, _raf: 0, keys: [] };

function cpuReset(){
  CPU.runs = {};
  for (const k of Object.keys(COMPUTERS)){
    CPU.runs[k] = { score: newTally(SCORE_MIN, SCORE_MAX), played: 0, discarded: 0, games: 0,
                    bonusGames: 0, bonusPiles: 0 };
  }
  cpuRender();
}

function cpuSelectedKeys(){
  const v = document.getElementById('lab-cpu-sel').value;
  return v === 'all' ? Object.keys(COMPUTERS) : [v];
}

function cpuRun(games){
  if (CPU.running) return;
  if (!CPU.runs) cpuReset();
  CPU.keys = cpuSelectedKeys();
  const start = CPU.runs[CPU.keys[0]].games;
  CPU.target = start + games;
  CPU.running = true;
  _cpuSyncButtons();
  const step = () => {
    if (!CPU.running){ _cpuSyncButtons(); return; }
    // A throw inside a requestAnimationFrame callback vanishes: the loop simply
    // stops, `running` stays true and the Run button stays disabled, with
    // nothing on screen to say why. That is how a stale cached script showed up
    // as "Lowest just doesn't do anything". Surface it instead.
    try {
      const end = Math.min(CPU.target, CPU.runs[CPU.keys[0]].games + CPU.chunk);
      while (CPU.runs[CPU.keys[0]].games < end){
        for (const k of CPU.keys){
          const r = playSoloGame(COMPUTERS[k]);
          const acc = CPU.runs[k];
          tallyAdd(acc.score, r.score);
          acc.played += r.played; acc.discarded += r.discarded; acc.games++;
          // The +20 length bonus: a venture of bonusThreshold cards or more.
          // Counted per GAME (did it land at all) and per pile, since one game
          // can finish more than one long venture.
          let bp = 0;
          for (const c of CONFIG.colors)
            if (r.piles[c].length >= CONFIG.scoring.bonusThreshold) bp++;
          if (bp) acc.bonusGames++;
          acc.bonusPiles += bp;
        }
      }
    } catch (e){
      CPU.running = false;
      _cpuSyncButtons();
      _cpuFail(e);
      return;
    }
    cpuRender();
    if (CPU.runs[CPU.keys[0]].games < CPU.target) CPU._raf = requestAnimationFrame(step);
    else { CPU.running = false; _cpuSyncButtons(); }
  };
  CPU._raf = requestAnimationFrame(step);
}

function _cpuFail(e){
  console.error('[computers] run failed:', e);
  const host = document.getElementById('lab-cpu-body');
  if (!host) return;
  // A missing cross-file function is nearly always a half-updated cache, so say
  // so rather than just printing the raw message.
  const stale = /is not a function|is not defined/.test(String(e && e.message));
  host.innerHTML = '<p class="err"><b>That run failed.</b> ' + (e && e.message ? e.message : e)
    + (stale ? '<br>This usually means the page loaded a mix of new and cached scripts — '
             + 'a hard refresh (<b>Ctrl+Shift+R</b>) should fix it.' : '')
    + '</p>' + host.innerHTML;
}

function cpuStop(){
  CPU.running = false;
  if (CPU._raf) cancelAnimationFrame(CPU._raf);
  _cpuSyncButtons();
}

/* Histogram over the OBSERVED range — the tally spans every score the rules
   allow, which is far wider than any computer actually reaches, so binning
   across all of it would squash the whole distribution into one column. */
function _hist(t, bins){
  const s = tallyStats(t);
  if (!s) return '';
  const lo = s.min, hi = s.max;
  const span = Math.max(1, hi - lo + 1);
  const nb = Math.min(bins, span);
  const per = span / nb;
  const b = new Array(nb).fill(0);
  for (let k = 0; k < t.freq.length; k++){
    if (!t.freq[k]) continue;
    const v = k + t.min;
    b[Math.min(nb - 1, Math.floor((v - lo) / per))] += t.freq[k];
  }
  let peak = 0; for (const v of b) if (v > peak) peak = v;
  const medBin = Math.min(nb - 1, Math.floor((s.median - lo) / per));
  let bars = '';
  for (let i = 0; i < nb; i++){
    const blo = Math.round(lo + i * per), bhi = Math.round(lo + (i + 1) * per - 1);
    bars += '<i class="' + (i === medBin ? 'med' : '') + '" style="height:'
         + (peak ? Math.max(2, 100 * b[i] / peak) : 2) + '%" title="'
         + (blo === bhi ? blo : blo + ' to ' + bhi) + ': ' + b[i] + ' games ('
         + (100 * b[i] / t.n).toFixed(1) + '%)"></i>';
  }
  return '<div class="hist">' + bars + '</div>'
       + '<div class="hist-ax"><span>' + lo + '</span><span class="mid">median '
       + s.median + '</span><span>' + hi + '</span></div>';
}

function cpuRender(){
  const host = document.getElementById('lab-cpu-body');
  if (!host) return;
  const runs = CPU.runs || {};
  const keys = Object.keys(COMPUTERS).filter(k => runs[k] && runs[k].games > 0);

  const anyGames = keys.length ? runs[keys[0]].games : 0;
  document.getElementById('lab-cpu-count').textContent =
    anyGames.toLocaleString() + ' game' + (anyGames === 1 ? '' : 's');
  const prog = document.getElementById('lab-cpu-prog');
  if (prog) prog.style.width = (CPU.running && CPU.target
    ? Math.min(100, 100 * anyGames / CPU.target) : 0) + '%';

  if (!keys.length){
    host.innerHTML = '<p class="note">No games yet — pick a computer and press <b>Run games</b>.</p>';
    return;
  }

  let rows = '';
  for (const k of keys){
    const a = runs[k], s = tallyStats(a.score);
    rows += '<tr><td class="g">' + _esc(COMPUTERS[k].name) + '</td>'
      + '<td class="med">' + s.median + '</td>'
      + '<td class="num">' + s.mean.toFixed(1) + '</td>'
      + '<td class="num">' + s.min + ' … ' + s.max + '</td>'
      + '<td class="num" title="' + a.bonusGames.toLocaleString() + ' of ' + a.games.toLocaleString()
        + ' games landed at least one venture of ' + CONFIG.scoring.bonusThreshold
        + '+ cards (+' + CONFIG.scoring.bonusPoints + '); '
        + (a.bonusPiles / a.games).toFixed(2) + ' such ventures per game">'
        + (100 * a.bonusGames / a.games).toFixed(1) + '%</td>'
      + '<td class="num">' + (100 * a.discarded / (a.played + a.discarded)).toFixed(1) + '%</td>'
      + '</tr>';
  }

  let charts = '';
  for (const k of keys){
    const a = runs[k], s = tallyStats(a.score);
    charts += '<div class="cpu-card"><div class="cpu-h">' + _esc(COMPUTERS[k].name)
      + '<span class="cpu-med">median ' + s.median + '</span></div>'
      + '<p class="note">' + COMPUTERS[k].blurb + '</p>'
      + _hist(a.score, 40) + '</div>';
  }

  host.innerHTML =
      '<table class="st"><thead><tr><th>Computer</th><th>Median score</th><th>Mean</th>'
    +   '<th>Range</th><th title="Share of games landing at least one venture of '
    +   CONFIG.scoring.bonusThreshold + '+ cards">' + CONFIG.scoring.bonusThreshold
    +   '+ bonus</th><th>Turns discarded</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + charts;
}

/* ============================================================================
   THE DUEL RUNNER

   Every deal is played TWICE with the seats swapped, and both results are kept
   from A's point of view. Venture gives the first player a real edge (they take
   the last card), so an unpaired duel would measure the seat as much as the
   computer.
   ========================================================================== */
const DUEL = { running: false, raf: 0, a: null, b: null, margins: [], deals: 0,
               target: 0, plies: 0, stalls: 0, hung: 0 };

function duelRun(a, b, deals){
  if (DUEL.running) return;
  Object.assign(DUEL, { running: true, a, b, margins: [], deals: 0, target: deals,
                        plies: 0, stalls: 0, hung: 0 });
  _duelSync();
  const step = () => {
    if (!DUEL.running){ _duelSync(); return; }
    try {
      const end = Math.min(DUEL.target, DUEL.deals + 4);
      while (DUEL.deals < end){
        const deck = RULES.createDrawPile();
        const g1 = playDuelGame(COMPUTERS[a], COMPUTERS[b], { deck });
        const g2 = playDuelGame(COMPUTERS[b], COMPUTERS[a], { deck });
        DUEL.margins.push(g1.margin, -g2.margin);      // both from A's side
        DUEL.plies += g1.plies + g2.plies;
        DUEL.stalls += g1.stalls + g2.stalls;
        DUEL.hung += (g1.hung ? 1 : 0) + (g2.hung ? 1 : 0);
        DUEL.deals++;
      }
    } catch (e){
      DUEL.running = false; _duelSync();
      const host = document.getElementById('lab-duel-body');
      if (host) host.innerHTML = '<p class="err"><b>That duel failed.</b> ' + (e && e.message ? e.message : e) + '</p>';
      console.error('[duel] failed:', e);
      return;
    }
    duelRender();
    if (DUEL.deals < DUEL.target) DUEL.raf = requestAnimationFrame(step);
    else { DUEL.running = false; _duelSync(); }
  };
  DUEL.raf = requestAnimationFrame(step);
}

function duelRender(){
  const host = document.getElementById('lab-duel-body');
  const count = document.getElementById('lab-duel-count');
  if (!host) return;
  const n = DUEL.margins.length;
  if (count) count.textContent = DUEL.deals ? (DUEL.deals + ' deals · ' + n + ' games') : '';
  if (!n){ host.innerHTML = '<p class="note">No games yet — pick two computers and press <b>Run duel</b>.</p>'; return; }

  const mean = DUEL.margins.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(DUEL.margins.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1)) : 0;
  const ci = 1.96 * sd / Math.sqrt(n);
  const wins = DUEL.margins.filter(v => v > 0).length;
  const ties = DUEL.margins.filter(v => v === 0).length;
  const nameA = _esc(COMPUTERS[DUEL.a].name), nameB = _esc(COMPUTERS[DUEL.b].name);
  // An interval that still spans zero has not decided anything yet — say so
  // rather than let a number that could be noise read as a result.
  const decided = Math.abs(mean) > ci;

  host.innerHTML =
      '<table class="st"><thead><tr><th>Result</th><th>' + nameA + ' vs ' + nameB + '</th></tr></thead><tbody>'
    + '<tr><td class="g">Margin per game</td><td class="med">' + (mean >= 0 ? '+' : '') + mean.toFixed(1)
    +   ' ± ' + ci.toFixed(1) + '</td></tr>'
    + '<tr><td class="g">' + nameA + ' wins</td><td class="num">' + (100 * wins / n).toFixed(1) + '%'
    +   (ties ? '  (ties ' + (100 * ties / n).toFixed(1) + '%)' : '') + '</td></tr>'
    + '<tr><td class="g">Game length</td><td class="num">' + (DUEL.plies / (2 * DUEL.deals)).toFixed(0)
    +   ' plies, ' + (DUEL.stalls / (2 * DUEL.deals)).toFixed(1) + ' discard draws</td></tr>'
    + (DUEL.hung ? '<tr><td class="g">Hit the ply cap</td><td class="num">' + DUEL.hung + '</td></tr>' : '')
    + '</tbody></table>'
    + '<p class="note">' + (decided
        ? '<b>' + (mean > 0 ? nameA : nameB) + '</b> is ahead by more than the interval, so this is a real difference.'
        : 'The interval still spans zero — on this many deals the two are <b>indistinguishable</b>. Run more.')
    + ' Each deal is played twice with the seats swapped, so the first-player edge cancels.</p>';
}

/* ============================================================================
   THE TOURNAMENT — every computer against every other

   A duel answers one question: is A better than B. It cannot answer the one
   actually worth asking, which is who is strongest, because a margin only means
   anything relative to whoever it was measured against. The table in
   PROGRESS.md was assembled a pairing at a time against The Patient, and every
   number in it inherits The Patient's particular weaknesses.

   A round robin removes that. Every computer meets every other over the same
   number of deals, so one average is comparable with another.

   Two things it still cannot do, both stated on the page rather than hidden:
   an average over the FIELD moves when the field does — enter three weak
   computers and everyone's average rises — and a pairing whose interval spans
   zero has not been decided, however confident the ranking above it looks.
   ========================================================================== */

const TOURNEY = { running: false, raf: 0, keys: [], fixtures: [], at: 0, target: 0,
                  ms: 30 };   // milliseconds of work per animation frame

/* The fixtures: every unordered pair, once. A computer never plays itself —
   with the seats swapped that is zero by construction, and it would only
   dilute the averages with a result nobody is in doubt about. */
function tourneyFixtures(keys){
  const out = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      out.push({ a: keys[i], b: keys[j], margins: [], deals: 0, plies: 0, stalls: 0, hung: 0 });
  return out;
}

/* Play `n` more deals of one fixture. Each deal is played twice with the seats
   swapped and BOTH margins recorded from A's side, so the first-player edge
   cancels — the same arrangement duelRun uses, for the same reason. */
function tourneyPlay(fx, n, mkDeck){
  for (let i = 0; i < n; i++){
    const deck = mkDeck ? mkDeck() : RULES.createDrawPile();
    const g1 = playDuelGame(COMPUTERS[fx.a], COMPUTERS[fx.b], { deck });
    const g2 = playDuelGame(COMPUTERS[fx.b], COMPUTERS[fx.a], { deck });
    fx.margins.push(g1.margin, -g2.margin);
    fx.plies += g1.plies + g2.plies;
    fx.stalls += g1.stalls + g2.stalls;
    fx.hung += (g1.hung ? 1 : 0) + (g2.hung ? 1 : 0);
    fx.deals++;
  }
  return fx;
}

function _meanCI(v){
  const n = v.length;
  if (!n) return { n: 0, mean: 0, ci: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1)) : 0;
  return { n, mean, ci: 1.96 * sd / Math.sqrt(n) };
}

/* Fold the fixtures into one row per computer. Pure — it reads the fixtures and
   returns a table, which is what lets a check hold it to the arithmetic without
   a browser.

   Every game is counted TWICE, once from each side, with the margin negated for
   the second. That is not double counting: a game is a result for both players,
   and a win for one is a loss for the other. It is also what makes the totals
   self-checking — wins across the whole table must equal losses. */
function tourneyStandings(keys, fixtures){
  const row = {};
  for (const k of keys)
    row[k] = { key: k, name: (COMPUTERS[k] && COMPUTERS[k].name) || k,
               games: 0, wins: 0, draws: 0, losses: 0, margins: [], vs: {} };

  for (const fx of fixtures){
    const A = row[fx.a], B = row[fx.b];
    if (!A || !B) continue;                 // a computer deleted mid-run
    for (const m of fx.margins){
      A.margins.push(m);  B.margins.push(-m);
      A.games++;          B.games++;
      if (m > 0){ A.wins++; B.losses++; }
      else if (m < 0){ A.losses++; B.wins++; }
      else { A.draws++; B.draws++; }
    }
    const s = _meanCI(fx.margins);
    A.vs[fx.b] = { mean:  s.mean, ci: s.ci, n: s.n };
    B.vs[fx.a] = { mean: -s.mean, ci: s.ci, n: s.n };
  }

  const rows = keys.map(k => {
    const r = row[k], s = _meanCI(r.margins);
    r.mean = s.mean; r.ci = s.ci;
    r.winPct = r.games ? 100 * r.wins / r.games : 0;
    return r;
  });
  // Ranked on average margin — the quantity every pairing contributes to
  // equally. Win rate breaks ties, then the name, so the order is stable
  // between renders instead of shuffling as results come in.
  rows.sort((x, y) => y.mean - x.mean || y.winPct - x.winPct || x.name.localeCompare(y.name));
  return rows;
}

function tourneyRun(keys, deals){
  if (TOURNEY.running) return;
  const host = document.getElementById('lab-tny-body');
  if (keys.length < 2){
    if (host) host.innerHTML = '<p class="err"><b>A tournament needs at least two computers.</b> '
      + 'Tick some more of the field above.</p>';
    return;
  }
  Object.assign(TOURNEY, { running: true, keys: keys.slice(),
                           fixtures: tourneyFixtures(keys), at: 0, target: deals });
  _tourneySync();
  const step = () => {
    if (!TOURNEY.running){ _tourneySync(); return; }
    try {
      // Time-boxed rather than a fixed deal count. A pairing with The Broker on
      // both sides costs ~50x one between two cheap computers, so any fixed
      // chunk is either a stutter on the expensive pairings or an idle page on
      // the cheap ones. One deal is always played, so a pairing slower than the
      // whole box still advances instead of spinning.
      const until = Date.now() + TOURNEY.ms;
      do {
        const fx = TOURNEY.fixtures[TOURNEY.at];
        if (!fx) break;
        if (fx.deals >= TOURNEY.target){ TOURNEY.at++; continue; }
        tourneyPlay(fx, 1);
      } while (TOURNEY.at < TOURNEY.fixtures.length && Date.now() < until);
    } catch (e){
      TOURNEY.running = false; _tourneySync();
      if (host) host.innerHTML = '<p class="err"><b>That tournament failed.</b> '
        + (e && e.message ? e.message : e) + '</p>' + host.innerHTML;
      console.error('[tournament] failed:', e);
      return;
    }
    tourneyRender();
    if (TOURNEY.at < TOURNEY.fixtures.length) TOURNEY.raf = requestAnimationFrame(step);
    else { TOURNEY.running = false; _tourneySync(); }
  };
  TOURNEY.raf = requestAnimationFrame(step);
}

function tourneyStop(){
  TOURNEY.running = false;
  if (TOURNEY.raf) cancelAnimationFrame(TOURNEY.raf);
  _tourneySync();
  tourneyRender();
}

function _tourneySync(){
  const run = document.getElementById('lab-tny-run');
  const stop = document.getElementById('lab-tny-stop');
  if (run){ run.disabled = TOURNEY.running; run.textContent = TOURNEY.running ? 'Running…' : 'Run tournament'; }
  if (stop) stop.style.display = TOURNEY.running ? '' : 'none';
}

function tourneyRender(){
  const host = document.getElementById('lab-tny-body');
  const count = document.getElementById('lab-tny-count');
  const prog = document.getElementById('lab-tny-prog');
  if (!host) return;

  const fxs = TOURNEY.fixtures;
  const total = fxs.length * TOURNEY.target;
  const done = fxs.reduce((s, f) => s + f.deals, 0);
  if (prog) prog.style.width = total ? (100 * done / total).toFixed(1) + '%' : '0';
  if (count) count.textContent = done
    ? done + ' of ' + total + ' deals · ' + fxs.length + ' pairing' + (fxs.length === 1 ? '' : 's')
    : '';
  if (!done){
    host.innerHTML = '<p class="note">No games yet — choose the field above and press '
      + '<b>Run tournament</b>. Every pairing plays the same number of deals, so the '
      + 'expensive computers set the pace.</p>';
    return;
  }

  const rows = tourneyStandings(TOURNEY.keys, fxs);
  const scale = Math.max(1, ...rows.map(r => Math.abs(r.mean) + 0.001));
  const undecided = fxs.filter(f => { const s = _meanCI(f.margins); return Math.abs(s.mean) <= s.ci; });

  // ---- standings
  let html = '<table class="st"><thead><tr>'
    + '<th>#</th><th>Computer</th><th>Won<span class="sub"> · drew · lost</span></th>'
    + '<th>Win rate</th><th>Margin a game</th><th>&nbsp;</th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    const w = 50 * Math.abs(r.mean) / scale;
    html += '<tr><td class="num">' + (i + 1) + '</td>'
      + '<td class="g">' + _esc(r.name) + '</td>'
      + '<td class="num">' + r.wins + ' · ' + r.draws + ' · ' + r.losses + '</td>'
      + '<td class="num">' + r.winPct.toFixed(1) + '%</td>'
      + '<td class="med">' + _sgn(r.mean) + '<span class="sub" style="opacity:.5;font-size:.72rem"> ± '
      +   r.ci.toFixed(1) + '</span></td>'
      + '<td class="d"><span class="bar"><u></u>'
      +   '<i class="' + (r.mean >= 0 ? 'pos' : 'neg') + '" style="'
      +   (r.mean >= 0 ? 'left:50%;' : 'right:50%;') + 'width:' + w.toFixed(1) + '%"></i>'
      +   '</span></td></tr>';
  });
  html += '</tbody></table>';

  // ---- head to head
  html += '<h3 style="font-family:\'Cinzel\',Georgia,serif;color:var(--gold,#d4a843);'
        + 'font-size:.9rem;margin:22px 0 8px;letter-spacing:.03em">Head to head</h3>'
        + '<div class="mxwrap"><table class="mx"><thead><tr><th></th>';
  for (const c of rows) html += '<th>' + _esc(c.name) + '</th>';
  html += '</tr></thead><tbody>';
  for (const r of rows){
    html += '<tr><th>' + _esc(r.name) + '</th>';
    for (const c of rows){
      if (c.key === r.key){ html += '<td class="self">—</td>'; continue; }
      const v = r.vs[c.key];
      if (!v || !v.n){ html += '<td class="self">·</td>'; continue; }
      const cls = Math.abs(v.mean) <= v.ci ? 'near' : (v.mean > 0 ? 'win' : 'loss');
      html += '<td class="' + cls + '" title="' + _esc(r.name) + ' vs ' + _esc(c.name)
            + ': ' + _sgn(v.mean) + ' ± ' + v.ci.toFixed(1) + ' over ' + v.n + ' games">'
            + _sgn(v.mean) + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  html += '<p class="note">Each cell is the row\'s margin per game against the column, so the grid '
    + 'mirrors about its diagonal. <span style="color:var(--gold-bright,#f0c860)">Gold</span> is a win, '
    + '<span style="color:var(--danger,#c0605a)">red</span> a loss, and <b style="opacity:.45">faded</b> '
    + 'a pairing whose interval still spans zero — those two are <b>not yet separated</b>, whatever '
    + 'the order above suggests'
    + (undecided.length ? ' (' + undecided.length + ' of ' + fxs.length + ' pairings, so far)' : '')
    + '. Every deal is played twice with the seats swapped, so none of this is first-player advantage.'
    + '</p>'
    + '<p class="note">⚠️ A margin is only ever <b>relative to the field</b>. Add a weak computer and '
    + 'everyone\'s average rises; the ranking is a statement about these ' + rows.length
    + ' computers and not about Venture. The head-to-head grid is the part that does not move.</p>'
    + (fxs.some(f => f.hung)
        ? '<p class="note">' + fxs.reduce((s, f) => s + f.hung, 0) + ' game(s) hit the ply cap — '
          + 'both sides fed off the discard piles and the deck never emptied.</p>'
        : '');

  host.innerHTML = html;
}

/* One checkbox per computer, all on. Rebuilt by cpuSyncList when the builder
   saves or deletes one; the ticks survive it, and a computer that has just
   appeared arrives ticked. */
function tourneySyncField(){
  const host = document.getElementById('lab-tny-field');
  if (!host) return;
  const was = {};
  for (const el of host.querySelectorAll('input')) was[el.value] = el.checked;
  host.innerHTML = Object.keys(COMPUTERS).map(k =>
      '<label class="' + (was[k] === false ? '' : 'on') + '">'
    + '<input type="checkbox" value="' + k + '"' + (was[k] === false ? '' : ' checked') + '>'
    + _esc(COMPUTERS[k].name) + '</label>').join('');
  for (const el of host.querySelectorAll('input'))
    el.onchange = () => el.parentNode.classList.toggle('on', el.checked);
}

function tourneySelectedKeys(){
  const host = document.getElementById('lab-tny-field');
  if (!host) return Object.keys(COMPUTERS);
  return Array.from(host.querySelectorAll('input'))
              .filter(el => el.checked && COMPUTERS[el.value]).map(el => el.value);
}

function _tourneyInit(){
  const btn = document.getElementById('lab-tny-run');
  if (!btn) return;
  tourneySyncField();
  btn.onclick = () => {
    const v = parseInt(document.getElementById('lab-tny-n').value, 10);
    tourneyRun(tourneySelectedKeys(), Math.max(1, Math.min(2000, isFinite(v) ? v : 50)));
  };
  document.getElementById('lab-tny-stop').onclick = tourneyStop;
  _tourneySync();
  tourneyRender();
}

function _duelSync(){
  const run = document.getElementById('lab-duel-run');
  if (run){ run.disabled = DUEL.running; run.textContent = DUEL.running ? 'Running…' : 'Run duel'; }
}

function duelSyncList(){
  const opts = Object.keys(COMPUTERS)
    .map(k => '<option value="' + k + '">' + _esc(COMPUTERS[k].name) + '</option>').join('');
  for (const [id, fallback] of [['lab-duel-a', 'broker'], ['lab-duel-b', 'patient']]){
    const sel = document.getElementById(id);
    if (!sel) continue;
    const keep = sel.value;
    sel.innerHTML = opts;
    sel.value = (keep && COMPUTERS[keep]) ? keep : (COMPUTERS[fallback] ? fallback : Object.keys(COMPUTERS)[0]);
  }
}

function _duelInit(){
  const btn = document.getElementById('lab-duel-run');
  if (!btn) return;
  duelSyncList();
  btn.onclick = () => {
    const v = parseInt(document.getElementById('lab-duel-n').value, 10);
    duelRun(document.getElementById('lab-duel-a').value,
            document.getElementById('lab-duel-b').value,
            Math.max(1, Math.min(2000, isFinite(v) ? v : 50)));
  };
  duelRender();
}

function _cpuSyncButtons(){
  const run = document.getElementById('lab-cpu-run');
  const stop = document.getElementById('lab-cpu-stop');
  if (run) run.disabled = CPU.running;
  if (stop) stop.style.display = CPU.running ? '' : 'none';
}

/* Rebuild the picker and start the counts over. Called at boot and again by the
   builder whenever a computer is saved or deleted: every row in the table is a
   count of games played, so mixing a newcomer's 200 games in with everyone
   else's 3,000 would put two different experiments in one table. */
function cpuSyncList(){
  const sel = document.getElementById('lab-cpu-sel');
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = '<option value="all">All computers</option>'
    + Object.keys(COMPUTERS).map(k => '<option value="' + k + '">' + _esc(COMPUTERS[k].name) + '</option>').join('');
  if (keep && sel.querySelector('option[value="' + keep + '"]')) sel.value = keep;
  if (typeof duelSyncList === 'function') duelSyncList();   // builder computers duel too
  if (typeof tourneySyncField === 'function') tourneySyncField();        // …and enter the field
  if (typeof labSyncOpponentList === 'function') labSyncOpponentList();  // …and play you
  cpuStop();
  cpuReset();
}

function _cpuInit(){
  cpuSyncList();
  document.getElementById('lab-cpu-run').onclick = () => {
    const v = parseInt(document.getElementById('lab-cpu-n').value, 10);
    cpuRun(Math.max(1, Math.min(200000, isFinite(v) ? v : 1000)));
  };
  document.getElementById('lab-cpu-stop').onclick = cpuStop;
  document.getElementById('lab-cpu-reset').onclick = () => { cpuStop(); cpuReset(); };
  _duelInit();
  _tourneyInit();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _cpuInit);
else _cpuInit();
