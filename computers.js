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
   RUNNER + UI
   ========================================================================== */

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
    rows += '<tr><td class="g">' + COMPUTERS[k].name + '</td>'
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
    charts += '<div class="cpu-card"><div class="cpu-h">' + COMPUTERS[k].name
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
    + Object.keys(COMPUTERS).map(k => '<option value="' + k + '">' + COMPUTERS[k].name + '</option>').join('');
  if (keep && sel.querySelector('option[value="' + keep + '"]')) sel.value = keep;
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
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _cpuInit);
else _cpuInit();
