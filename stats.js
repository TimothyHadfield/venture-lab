"use strict";
/* ============================================================================
   stats.js — the dealing-statistics section.

   A trial engine plus the statistics computed from it. Built to have more
   statistics added: a trial produces a record, and each statistic is an
   accumulator over those records (see STAT_COLOR_SPREAD below).

   ── THE TRIAL ─────────────────────────────────────────────────────────────
   Shuffle a full deck, give each player 8 cards, then deal alternately until
   the deck is empty. 60 cards: 8+8 opening, then 44 alternating = 22 each, so
   both players finish with 30.

   ── STATISTIC 1: colour spread, by RANK ───────────────────────────────────
   Count your cards of each colour, then SORT those five counts ascending.
   That ordered five-tuple is one data set. Group 1 is whichever colour you
   ended up with fewest of, group 5 whichever you had most of — the groups are
   ranks, not colours, so "group 1" is red in one trial and blue in the next.
   The reported statistic is the MEDIAN of each group across all trials.
   ========================================================================== */

/* -------------------------------------------------------------- the trial */

/* Deal one game out to the end of the deck.
   Returns your per-colour counts, indexed like CONFIG.colors.

   The shuffle is the game's own `createDrawPile` (Fisher-Yates over the real
   60-card deck), so the trial is dealing the same deck the game deals. */
function dealTrialCounts(){
  const deck = RULES.createDrawPile();
  const colors = CONFIG.colors;
  const nc = colors.length;

  // Index by colour once; the inner loop is hot at high trial counts.
  const idx = {};
  for (let i = 0; i < nc; i++) idx[colors[i]] = i;

  const mine = new Array(nc).fill(0);
  let toMe = true;

  // Opening hands, one card at a time, alternating — the order the game deals.
  for (let i = 0; i < CONFIG.handSize * 2; i++){
    const c = deck.pop();
    if (toMe) mine[idx[c.color]]++;
    toMe = !toMe;
  }
  // Then back and forth until the deck is empty.
  while (deck.length){
    const c = deck.pop();
    if (toMe) mine[idx[c.color]]++;
    toMe = !toMe;
  }
  return mine;
}

/* ------------------------------------------------- statistic 1 accumulator

   Frequencies rather than a list of every trial: a count is 0..12, so a
   13-slot tally per group holds any number of trials in constant memory and
   still gives an exact median. */

const MAX_PER_COLOR = CONFIG.wagerCount + (CONFIG.numberRange[1] - CONFIG.numberRange[0] + 1); // 12

function newSpreadAccumulator(){
  const nc = CONFIG.colors.length;
  const mk = () => Array.from({ length: nc }, () => new Int32Array(MAX_PER_COLOR + 1));
  return {
    trials: 0,
    byRank:  mk(),   // byRank[g][k]  — group g (0 = fewest) had k cards, this often
    byColor: mk(),   // byColor[c][k] — colour c had k cards; the unbiasedness check
    cardsEach: 0,
  };
}

function accumulateSpread(acc, counts){
  acc.trials++;
  for (let c = 0; c < counts.length; c++) acc.byColor[c][counts[c]]++;
  const sorted = counts.slice().sort((a, b) => a - b);   // ascending: group 1 = fewest
  for (let g = 0; g < sorted.length; g++) acc.byRank[g][sorted[g]]++;
  if (!acc.cardsEach) acc.cardsEach = counts.reduce((s, v) => s + v, 0);
}

/* Exact median from a frequency tally. For an even number of trials this is
   the mean of the two middle values, so it can land on a .5 — that is the real
   median of an integer sample, not a rounding artefact. */
function medianFromFreq(freq, n){
  if (!n) return null;
  const loPos = Math.floor((n - 1) / 2), hiPos = Math.floor(n / 2);
  let cum = 0, lo = null, hi = null;
  for (let k = 0; k < freq.length; k++){
    cum += freq[k];
    if (lo === null && cum > loPos) lo = k;
    if (hi === null && cum > hiPos) { hi = k; break; }
  }
  return (lo + hi) / 2;
}

function meanFromFreq(freq, n){
  if (!n) return null;
  let s = 0;
  for (let k = 0; k < freq.length; k++) s += k * freq[k];
  return s / n;
}

function statsFromFreq(freq, n){
  let min = null, max = null;
  for (let k = 0; k < freq.length; k++){
    if (freq[k]){ if (min === null) min = k; max = k; }
  }
  return { median: medianFromFreq(freq, n), mean: meanFromFreq(freq, n), min, max, freq };
}

/* ============================================================================
   RUNNER — chunked so a large run doesn't freeze the page
   ========================================================================== */

const STATS = {
  acc: null,
  running: false,
  target: 0,
  chunk: 2000,
  _raf: 0,
};

function statsReset(){
  STATS.acc = newSpreadAccumulator();
  statsRender();
}

function statsRun(target){
  if (STATS.running) return;
  if (!STATS.acc) STATS.acc = newSpreadAccumulator();
  STATS.target = STATS.acc.trials + target;
  STATS.running = true;
  _statsSyncButtons();
  const step = () => {
    if (!STATS.running){ _statsSyncButtons(); return; }
    const end = Math.min(STATS.target, STATS.acc.trials + STATS.chunk);
    while (STATS.acc.trials < end) accumulateSpread(STATS.acc, dealTrialCounts());
    statsRender();
    if (STATS.acc.trials < STATS.target){
      STATS._raf = requestAnimationFrame(step);
    } else {
      STATS.running = false;
      _statsSyncButtons();
    }
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

const RANK_LABEL = ['fewest', '2nd fewest', 'middle', '2nd most', 'most'];

function _bar(freq, n, maxK){
  // A compact distribution strip: one cell per possible count, opacity by share.
  let peak = 0;
  for (let k = 0; k <= maxK; k++) if (freq[k] > peak) peak = freq[k];
  let out = '<span class="dist">';
  for (let k = 0; k <= maxK; k++){
    const share = peak ? freq[k] / peak : 0;
    const pct = n ? (100 * freq[k] / n) : 0;
    out += '<i style="opacity:' + (0.08 + 0.92 * share).toFixed(3) + '" title="' + k + ' cards: '
         + pct.toFixed(1) + '%"></i>';
  }
  return out + '</span>';
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
  const maxK = MAX_PER_COLOR;

  let rows = '';
  for (let g = 0; g < nc; g++){
    const s = statsFromFreq(acc.byRank[g], n);
    rows += '<tr>'
      + '<td class="g">Group ' + (g + 1) + '<span class="sub">' + RANK_LABEL[g] + '</span></td>'
      + '<td class="med">' + s.median + '</td>'
      + '<td class="num">' + s.mean.toFixed(3) + '</td>'
      + '<td class="num">' + s.min + '–' + s.max + '</td>'
      + '<td class="d">' + _bar(s.freq, n, maxK) + '</td>'
      + '</tr>';
  }

  // Control line: the same trials tallied by COLOUR instead of by rank. Every
  // colour must sit at 30/5 = 6, because the deal has no colour preference.
  // The gap between this flat 6 and the spread above is the whole point of
  // ranking: in any ONE deal the colours are lopsided, and ranking measures
  // that lopsidedness instead of averaging it away.
  let ctl = '';
  for (let c = 0; c < nc; c++){
    const s = statsFromFreq(acc.byColor[c], n);
    ctl += '<tr>'
      + '<td class="g" style="color:' + CONFIG.colorHex[CONFIG.colors[c]] + '">'
      + (CONFIG.colorLabels[CONFIG.colors[c]] || CONFIG.colors[c]) + '</td>'
      + '<td class="med">' + s.median + '</td>'
      + '<td class="num">' + s.mean.toFixed(3) + '</td>'
      + '<td class="num">' + s.min + '–' + s.max + '</td>'
      + '<td class="d">' + _bar(s.freq, n, maxK) + '</td>'
      + '</tr>';
  }

  const medians = [];
  for (let g = 0; g < nc; g++) medians.push(medianFromFreq(acc.byRank[g], n));

  host.innerHTML =
      '<div class="headline">'
    +   '<div class="hl-lab">Median cards per colour, ranked</div>'
    +   '<div class="hl-nums">' + medians.map(m => '<span>' + m + '</span>').join('') + '</div>'
    +   '<div class="hl-sub">fewest → most · ' + acc.cardsEach + ' cards dealt to you per trial</div>'
    + '</div>'
    + '<table class="st"><thead><tr><th>Group</th><th>Median</th><th>Mean</th><th>Range</th>'
    +   '<th>Distribution <span class="sub">0 → ' + maxK + '</span></th></tr></thead>'
    +   '<tbody>' + rows + '</tbody></table>'
    + '<details class="ctl"><summary>Same trials tallied by colour (control)</summary>'
    +   '<p class="note">The deal has no colour preference, so every colour sits at '
    +   '<b>' + (acc.cardsEach / nc) + '</b> on average — that is what makes the ranked spread '
    +   'above meaningful. Ranking measures how lopsided a single deal is; averaging by colour '
    +   'hides it.</p>'
    +   '<table class="st"><thead><tr><th>Colour</th><th>Median</th><th>Mean</th><th>Range</th>'
    +     '<th>Distribution</th></tr></thead><tbody>' + ctl + '</tbody></table>'
    + '</details>'
    + '<p class="note">Group medians do not sum to ' + acc.cardsEach
    +   ' — medians are not additive. The <i>means</i> do: '
    +   (function(){ let s=0; for(let g=0;g<nc;g++) s+=meanFromFreq(acc.byRank[g],n); return s.toFixed(3); })()
    +   '.</p>';
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
  if (!sec) return;
  sec.style.display = on ? '' : 'none';
  board.style.display = on ? 'none' : '';
  if (deck) deck.style.display = (on || !LAB.revealDeck) ? 'none' : '';
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
