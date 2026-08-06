"use strict";
/* ============================================================================
   computers.js — build computers, and test them.

   ── THE GAME THEY PLAY ────────────────────────────────────────────────────
   Solitaire, for now: no opponent to compete with. Shuffle a deck, take 8
   cards, then each turn play one card to a venture and draw one. The game ends
   when the draw pile empties — 52 turns, ending with 8 cards still in hand.

   The discard pile exists but is only ever a fallback: a computer discards ONLY
   when it cannot legally play anything, and never draws from the discards.

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
   and returns { card } — the card to play, or to discard if `playable` is
   empty. Everything else (legality, drawing, scoring) is handled here.
   ========================================================================== */

/* Potential of one colour: what that colour scores if every card still
   available to it gets played in order. `venturePotential` (lab.js) is the
   single definition of the rule, shared with the board's readout. */
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

/* ============================================================================
   THE COMPUTERS
   ========================================================================== */

const COMPUTERS = {
  lowest: {
    name: 'Lowest',
    blurb: 'Plays the card that decreases that colour\'s potential the least. ' +
           'Ties break to the lowest card. When nothing is playable it discards ' +
           'by the same rule — the card whose loss costs the least potential.',
    decide(view){
      if (view.playable.length)
        return { card: _pickCheapest(view.playable, c => playCost(view.piles, view.pool, c)) };
      return { card: _pickCheapest(view.hand, c => discardCost(view.piles, view.pool, c)) };
    },
  },

  random: {
    name: 'Random',
    blurb: 'Plays a uniformly random legal card. When nothing is playable it ' +
           'discards a uniformly random card. The baseline everything else has to beat.',
    decide(view){
      const from = view.playable.length ? view.playable : view.hand;
      return { card: from[Math.floor(view.rng() * from.length)] };
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
    const card = bot.decide(view).card;

    const i = hand.indexOf(card);
    hand.splice(i, 1);
    const pi = pool[card.color].indexOf(card);
    if (pi >= 0) pool[card.color].splice(pi, 1);

    if (playable.length && playable.indexOf(card) >= 0){
      piles[card.color].push(card);
      played++;
    } else {
      discards[card.color].push(card);   // fallback only: nothing was playable
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
    CPU.runs[k] = { score: newTally(SCORE_MIN, SCORE_MAX), played: 0, discarded: 0, games: 0 };
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
    +   '<th>Range</th><th>Turns discarded</th></tr></thead><tbody>' + rows + '</tbody></table>'
    + charts;
}

function _cpuSyncButtons(){
  const run = document.getElementById('lab-cpu-run');
  const stop = document.getElementById('lab-cpu-stop');
  if (run) run.disabled = CPU.running;
  if (stop) stop.style.display = CPU.running ? '' : 'none';
}

function _cpuInit(){
  const sel = document.getElementById('lab-cpu-sel');
  sel.innerHTML = '<option value="all">All computers</option>'
    + Object.keys(COMPUTERS).map(k => '<option value="' + k + '">' + COMPUTERS[k].name + '</option>').join('');
  document.getElementById('lab-cpu-run').onclick = () => {
    const v = parseInt(document.getElementById('lab-cpu-n').value, 10);
    cpuRun(Math.max(1, Math.min(200000, isFinite(v) ? v : 1000)));
  };
  document.getElementById('lab-cpu-stop').onclick = cpuStop;
  document.getElementById('lab-cpu-reset').onclick = () => { cpuStop(); cpuReset(); };
  cpuReset();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _cpuInit);
else _cpuInit();
