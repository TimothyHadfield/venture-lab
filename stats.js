"use strict";
/* ============================================================================
   stats.js — the dealing-statistics section.

   A trial engine plus the statistics computed from it. Built to have more
   statistics added: a trial produces a record, and each statistic is a tally
   over those records.

   ── THE TRIAL ─────────────────────────────────────────────────────────────
   Shuffle a full deck, give each player 8 cards, then deal alternately until
   the deck is empty. 60 cards: 8+8 opening, then 44 alternating = 22 each, so
   both players finish with 30.

   ── STATISTIC 1: colour spread ────────────────────────────────────────────
   How many cards of each colour you ended up with.

   ── STATISTIC 2: colour potential ─────────────────────────────────────────
   What those cards are WORTH: the score of playing every card you received of
   that colour, lowest to highest, as one venture. Scored with the game's own
   MATH.scorePlayPile, so wagers multiply and 8+ cards take the bonus:
       (sum of numbers − 20) × (1 + wagers) + 20 if 8 or more cards
   Red 2,4,7,9,10 → (32 − 20) × 1 = 12.

   ── BOTH ARE REPORTED BY RANK ─────────────────────────────────────────────
   Each trial's five values are sorted ascending. Group 1 is whichever colour
   came out worst that trial, group 5 whichever came out best — the groups are
   ranks, not colours, so group 1 is red in one trial and blue in the next.
   The headline figure is each group's MEDIAN across all trials.
   ========================================================================== */

const MAX_PER_COLOR = CONFIG.wagerCount + (CONFIG.numberRange[1] - CONFIG.numberRange[0] + 1); // 12

/* Bounds for a single colour's potential, derived from the rules rather than
   hard-coded, so changing the scoring config can't silently overflow a tally.
   Worst case is holding only wagers — no numbers to pay off the −20, and the
   wagers multiply the loss. Best is the complete colour. */
const POT_MIN = (0 - CONFIG.scoring.baseCost) * (1 + CONFIG.wagerCount);
const POT_MAX = (function(){
  let sum = 0;
  for (let v = CONFIG.numberRange[0]; v <= CONFIG.numberRange[1]; v++) sum += v;
  return (sum - CONFIG.scoring.baseCost) * (1 + CONFIG.wagerCount)
       + (MAX_PER_COLOR >= CONFIG.scoring.bonusThreshold ? CONFIG.scoring.bonusPoints : 0);
})();

/* --------------------------------------------------------------- tallies

   Frequencies rather than a list of every trial: every quantity here is a
   bounded integer, so a tally holds any number of trials in constant memory
   and still gives an exact median. */

function newTally(min, max){
  return { min: min, n: 0, freq: new Int32Array(max - min + 1) };
}
function tallyAdd(t, v){
  const i = v - t.min;
  // Out of range would be silently DROPPED by the typed array while still
  // counting toward n — every statistic would skew with no visible symptom.
  // Fail loudly instead; the bounds are derived from the rules above, so this
  // firing means the rules changed.
  if (i < 0 || i >= t.freq.length) throw new RangeError('tally out of range: ' + v);
  t.freq[i]++; t.n++;
}

/* Exact median. For an even number of trials this is the mean of the two
   middle values, so it can land on a .5 — the real median of an integer
   sample, not a rounding artefact. */
function medianFromFreq(freq, n, offset){
  if (!n) return null;
  offset = offset || 0;
  const loPos = Math.floor((n - 1) / 2), hiPos = Math.floor(n / 2);
  let cum = 0, lo = null, hi = null;
  for (let k = 0; k < freq.length; k++){
    cum += freq[k];
    if (lo === null && cum > loPos) lo = k;
    if (hi === null && cum > hiPos) { hi = k; break; }
  }
  return (lo + hi) / 2 + offset;
}
function meanFromFreq(freq, n, offset){
  if (!n) return null;
  offset = offset || 0;
  let s = 0;
  for (let k = 0; k < freq.length; k++) s += k * freq[k];
  return s / n + offset;
}
function tallyStats(t){
  if (!t.n) return null;
  let min = null, max = null;
  for (let k = 0; k < t.freq.length; k++){
    if (t.freq[k]){ if (min === null) min = k; max = k; }
  }
  return {
    median: medianFromFreq(t.freq, t.n, t.min),
    mean:   meanFromFreq(t.freq, t.n, t.min),
    min: min + t.min, max: max + t.min,
    tally: t,
  };
}

/* -------------------------------------------------------------- the trial */

/* Deal one game out to the end of the deck and measure your hand.

   The shuffle is the game's own `createDrawPile` (Fisher-Yates over the real
   60-card deck), and the potentials are scored with the game's own
   MATH.scorePlayPile — so both the deal and the scoring are the real ones. */
function dealTrial(){
  const deck = RULES.createDrawPile();
  const colors = CONFIG.colors;
  const nc = colors.length;

  const idx = {};
  for (let i = 0; i < nc; i++) idx[colors[i]] = i;

  const mine = Array.from({ length: nc }, () => []);
  let toMe = true;

  // Opening hands one card at a time, alternating — the order the game deals.
  for (let i = 0; i < CONFIG.handSize * 2; i++){
    const c = deck.pop();
    if (toMe) mine[idx[c.color]].push(c);
    toMe = !toMe;
  }
  // Then back and forth until the deck is empty.
  while (deck.length){
    const c = deck.pop();
    if (toMe) mine[idx[c.color]].push(c);
    toMe = !toMe;
  }

  const counts = new Array(nc), potentials = new Array(nc);
  for (let c = 0; c < nc; c++){
    counts[c] = mine[c].length;
    // Playing them lowest to highest is what scorePlayPile assumes; order
    // doesn't change the sum, so no sort is needed for the score itself.
    potentials[c] = MATH.scorePlayPile(mine[c]);
  }
  return { counts, potentials };
}

/* ------------------------------------------------------------ accumulator */

function newAccumulator(){
  const nc = CONFIG.colors.length;
  const cnt = () => Array.from({ length: nc }, () => newTally(0, MAX_PER_COLOR));
  const pot = () => Array.from({ length: nc }, () => newTally(POT_MIN, POT_MAX));
  return {
    trials: 0,
    cardsEach: 0,
    countByRank: cnt(), countByColor: cnt(),
    potByRank:   pot(), potByColor:   pot(),
    potTotal: newTally(nc * POT_MIN, nc * POT_MAX),
  };
}

function accumulate(acc, rec){
  acc.trials++;
  const nc = rec.counts.length;

  for (let c = 0; c < nc; c++){
    tallyAdd(acc.countByColor[c], rec.counts[c]);
    tallyAdd(acc.potByColor[c],   rec.potentials[c]);
  }
  const sc = rec.counts.slice().sort((a, b) => a - b);
  const sp = rec.potentials.slice().sort((a, b) => a - b);
  for (let g = 0; g < nc; g++){
    tallyAdd(acc.countByRank[g], sc[g]);
    tallyAdd(acc.potByRank[g],   sp[g]);
  }
  let tot = 0;
  for (let c = 0; c < nc; c++) tot += rec.potentials[c];
  tallyAdd(acc.potTotal, tot);

  if (!acc.cardsEach) acc.cardsEach = rec.counts.reduce((s, v) => s + v, 0);
}

/* ============================================================================
   RUNNER — chunked so a large run doesn't freeze the page
   ========================================================================== */

const STATS = { acc: null, running: false, target: 0, chunk: 2000, _raf: 0 };

function statsReset(){ STATS.acc = newAccumulator(); statsRender(); }

function statsRun(target){
  if (STATS.running) return;
  if (!STATS.acc) STATS.acc = newAccumulator();
  STATS.target = STATS.acc.trials + target;
  STATS.running = true;
  _statsSyncButtons();
  const step = () => {
    if (!STATS.running){ _statsSyncButtons(); return; }
    try {
      const end = Math.min(STATS.target, STATS.acc.trials + STATS.chunk);
      while (STATS.acc.trials < end) accumulate(STATS.acc, dealTrial());
    } catch (e){
      // Same reason as computers.js: a throw in a rAF callback is invisible.
      STATS.running = false; _statsSyncButtons();
      console.error('[stats] run failed:', e);
      const host = document.getElementById('lab-stats-body');
      if (host) host.innerHTML = '<p class="err"><b>That run failed.</b> '
        + (e && e.message ? e.message : e) + '</p>' + host.innerHTML;
      return;
    }
    statsRender();
    if (STATS.acc.trials < STATS.target) STATS._raf = requestAnimationFrame(step);
    else { STATS.running = false; _statsSyncButtons(); }
  };
  STATS._raf = requestAnimationFrame(step);
}

function statsStop(){
  STATS.running = false;
  if (STATS._raf) cancelAnimationFrame(STATS._raf);
  _statsSyncButtons();
}

/* ============================================================================
   RENDERING
   ========================================================================== */

const RANK_LABEL = ['worst', '2nd worst', 'middle', '2nd best', 'best'];
const RANK_LABEL_COUNT = ['fewest', '2nd fewest', 'middle', '2nd most', 'most'];

/* Distribution strip. A count spans 13 values so it gets one cell each; a
   potential spans ~240, so those are binned to keep the strip readable. */
function _bar(t, bins){
  const len = t.freq.length;
  const nb = Math.min(bins || 26, len);
  const per = len / nb;
  const b = new Array(nb).fill(0);
  for (let k = 0; k < len; k++) b[Math.min(nb - 1, Math.floor(k / per))] += t.freq[k];
  let peak = 0;
  for (const v of b) if (v > peak) peak = v;
  let out = '<span class="dist">';
  for (let i = 0; i < nb; i++){
    const share = peak ? b[i] / peak : 0;
    const lo = Math.round(t.min + i * per), hi = Math.round(t.min + (i + 1) * per - 1);
    out += '<i style="opacity:' + (0.08 + 0.92 * share).toFixed(3) + '" title="'
        + (lo === hi ? lo : lo + '–' + hi) + ': ' + (t.n ? (100 * b[i] / t.n).toFixed(1) : 0) + '%"></i>';
  }
  return out + '</span>';
}

function _rows(tallies, labels, fmt, bins, colorLabels){
  let out = '';
  for (let i = 0; i < tallies.length; i++){
    const s = tallyStats(tallies[i]);
    if (!s) continue;
    const head = colorLabels
      ? '<td class="g" style="color:' + CONFIG.colorHex[CONFIG.colors[i]] + '">'
        + (CONFIG.colorLabels[CONFIG.colors[i]] || CONFIG.colors[i]) + '</td>'
      : '<td class="g">Group ' + (i + 1) + '<span class="sub">' + labels[i] + '</span></td>';
    out += '<tr>' + head
      + '<td class="med">' + fmt(s.median) + '</td>'
      + '<td class="num">' + s.mean.toFixed(2) + '</td>'
      + '<td class="num">' + s.min + ' … ' + s.max + '</td>'
      + '<td class="d">' + _bar(s.tally, bins) + '</td>'
      + '</tr>';
  }
  return out;
}

/* A summary row appended under the five groups — same columns, ruled off. */
function _totalRow(label, t, bins, fmt){
  const s = tallyStats(t);
  if (!s) return '';
  return '<tr class="tot"><td class="g">' + label + '</td>'
    + '<td class="med">' + fmt(s.median) + '</td>'
    + '<td class="num">' + s.mean.toFixed(2) + '</td>'
    + '<td class="num">' + s.min + ' … ' + s.max + '</td>'
    + '<td class="d">' + _bar(s.tally, bins) + '</td></tr>';
}

function _table(headFirst, distLabel, rows){
  return '<table class="st"><thead><tr><th>' + headFirst + '</th><th>Median</th><th>Mean</th>'
       + '<th>Range</th><th>Distribution <span class="sub">' + distLabel + '</span></th></tr></thead>'
       + '<tbody>' + rows + '</tbody></table>';
}

function _headline(label, tallies, fmt, sub){
  const meds = tallies.map(t => fmt(tallyStats(t).median));
  return '<div class="headline"><div class="hl-lab">' + label + '</div>'
       + '<div class="hl-nums">' + meds.map(m => '<span>' + m + '</span>').join('') + '</div>'
       + '<div class="hl-sub">' + sub + '</div></div>';
}

function statsRender(){
  const host = document.getElementById('lab-stats-body');
  if (!host) return;
  const acc = STATS.acc;
  const n = acc ? acc.trials : 0;

  document.getElementById('lab-stats-count').textContent =
    n.toLocaleString() + ' trial' + (n === 1 ? '' : 's');
  const prog = document.getElementById('lab-stats-prog');
  if (prog) prog.style.width = (STATS.running && STATS.target
    ? Math.min(100, 100 * n / STATS.target) : 0) + '%';

  if (!n){
    host.innerHTML = '<p class="note">No trials yet — set a count and press <b>Run trials</b>.</p>';
    return;
  }

  const nc = CONFIG.colors.length;
  const id = v => v;
  const totS = tallyStats(acc.potTotal);

  host.innerHTML =

    // ---- statistic 2: potential ----
      '<h2>Potential points per colour</h2>'
    + '<p class="note">The score of playing every card you received of a colour, lowest to '
    +   'highest, as one venture: <b>(sum − ' + CONFIG.scoring.baseCost + ') × (1 + wagers)</b>, '
    +   'plus <b>' + CONFIG.scoring.bonusPoints + '</b> at ' + CONFIG.scoring.bonusThreshold
    +   '+ cards. Sorted worst to best, so group 1 is whichever colour came out worst that trial.</p>'
    + _headline('Median potential, ranked', acc.potByRank, id,
        'worst → best · total across all five: <b>' + totS.median + '</b>')
    // The total is a row of its own rather than a sixth group: it is the whole
    // hand's potential per trial, tallied and medianed like the groups — NOT the
    // five group medians added up, which would be wrong (medians aren't additive).
    + _table('Group', POT_MIN + ' → ' + POT_MAX,
        _rows(acc.potByRank, RANK_LABEL, id, 26)
        + _totalRow('Total<span class="sub">all five colours</span>', acc.potTotal, 26, id))

    // ---- statistic 1: counts ----
    + '<h2>Cards per colour</h2>'
    + '<p class="note">How many cards of each colour you ended up with, sorted fewest to most.</p>'
    + _headline('Median cards per colour, ranked', acc.countByRank, id,
        'fewest → most · ' + acc.cardsEach + ' cards dealt to you per trial')
    + _table('Group', '0 → ' + MAX_PER_COLOR, _rows(acc.countByRank, RANK_LABEL_COUNT, id, MAX_PER_COLOR + 1))

    // ---- control ----
    + '<details class="ctl"><summary>Same trials tallied by colour (control)</summary>'
    +   '<p class="note">The deal has no colour preference, so tallied by colour every entry is '
    +   'the same — cards flat at <b>' + (acc.cardsEach / nc) + '</b>. That is what makes the '
    +   'ranked tables meaningful: ranking measures how lopsided a single deal is, averaging by '
    +   'colour hides it.</p>'
    +   _table('Colour', 'cards 0 → ' + MAX_PER_COLOR,
              _rows(acc.countByColor, null, id, MAX_PER_COLOR + 1, true))
    +   _table('Colour', 'potential', _rows(acc.potByColor, null, id, 26, true))
    + '</details>'

    + '<p class="note">Group medians do not sum to the total — medians are not additive. '
    +   'The <i>means</i> are: cards '
    +   acc.countByRank.reduce((s, t) => s + tallyStats(t).mean, 0).toFixed(2)
    +   ', potential '
    +   acc.potByRank.reduce((s, t) => s + tallyStats(t).mean, 0).toFixed(2)
    +   ' (mean total ' + totS.mean.toFixed(2) + ').</p>';
}

function _statsSyncButtons(){
  const run = document.getElementById('lab-stats-run');
  const stop = document.getElementById('lab-stats-stop');
  if (run) run.disabled = STATS.running;
  if (stop) stop.style.display = STATS.running ? '' : 'none';
}

/* --------------------------------------------------------------- section UI */

function statsShow(on){
  const sec = document.getElementById('lab-stats');
  const board = document.getElementById('game-screen');
  const deck = document.getElementById('vc-deck');
  const info = document.getElementById('lab-info');
  if (!sec) return;
  sec.style.display = on ? '' : 'none';
  board.style.display = on ? 'none' : '';
  // Both side panels are fixed and paint ABOVE the stats section, so they have
  // to go with the board rather than float over the statistics.
  if (deck) deck.style.display = (on || !LAB.revealDeck) ? 'none' : '';
  if (info) info.style.display = on ? 'none' : '';
  const btn = document.getElementById('lab-statsbtn');
  if (btn) btn.classList.toggle('on', !!on);
  if (on) statsRender();
  else { renderGame._snapNextRender = true; renderGame(); }
}

function _statsInit(){
  document.getElementById('lab-statsbtn').onclick = () => {
    SFX.select();
    statsShow(document.getElementById('lab-stats').style.display === 'none');
  };
  document.getElementById('lab-stats-run').onclick = () => {
    const v = parseInt(document.getElementById('lab-stats-n').value, 10);
    statsRun(Math.max(1, Math.min(1e7, isFinite(v) ? v : 10000)));
  };
  document.getElementById('lab-stats-stop').onclick = statsStop;
  document.getElementById('lab-stats-reset').onclick = () => { statsStop(); statsReset(); };
  statsReset();
  statsShow(false);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _statsInit);
else _statsInit();
