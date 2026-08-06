// math.js — All math functions: game scoring, ELO ratings, and UI geometry.
// Pure functions. Reads CONFIG only. No other dependencies.

// ===== SCORING (Layer 0 — Game Rules) =====

function scorePlayPile(cards) {
  if (!cards || cards.length === 0) return 0;
  let wagers = 0, sum = 0;
  for (const c of cards) {
    if (c.value === 0) wagers++;
    else sum += c.value;
  }
  return (sum - CONFIG.scoring.baseCost) * (1 + wagers)
    + (cards.length >= CONFIG.scoring.bonusThreshold ? CONFIG.scoring.bonusPoints : 0);
}

function scoreAll(playPiles) {
  let total = 0;
  const perColor = {};
  for (const color of CONFIG.colors) {
    const score = scorePlayPile(playPiles[color] || []);
    perColor[color] = score;
    total += score;
  }
  return { total, perColor };
}

function scoreBreakdown(playPiles) {
  let total = 0;
  const breakdown = {};
  CONFIG.colors.forEach(c => {
    const cards = (playPiles && playPiles[c]) || [];
    if (cards.length === 0) { breakdown[c] = {score: 0, count: 0, wagers: 0, sum: 0, subtotal: 0, bonus: false, values: []}; return; }
    const wagers = cards.filter(x => x.value === 0).length;
    const numCards = cards.filter(x => x.value > 0).sort((a, b) => a.value - b.value);
    const values = numCards.map(x => x.value);
    const sum = values.reduce((s, v) => s + v, 0);
    const subtotal = sum - CONFIG.scoring.baseCost;
    const bonus = cards.length >= CONFIG.scoring.bonusThreshold;
    const score = scorePlayPile(cards);
    breakdown[c] = {score, count: cards.length, wagers, sum, subtotal, bonus, values};
    total += score;
  });
  return {total, breakdown};
}

// ===== RIVALRY BONUS =====

function scoreWithRivalry(myPiles, oppPiles) {
  const my = scoreBreakdown(myPiles);
  const opp = scoreBreakdown(oppPiles);
  if (!CONFIG.rivalryEnabled) {
    // Rivalry variation off — return scores without rivalry bonus
    my.rivalry = 0; my.rivalryPerColor = {};
    opp.rivalry = 0; opp.rivalryPerColor = {};
    return { my, opp };
  }
  let myRivalry = 0, oppRivalry = 0;
  const rivalryPerColor = {};
  for (const color of CONFIG.colors) {
    const mCards = (myPiles && myPiles[color]) || [];
    const oCards = (oppPiles && oppPiles[color]) || [];
    if (mCards.length > 0 && oCards.length > 0) {
      // Both players ventured in this color — contested
      const mScore = my.breakdown[color].score;
      const oScore = opp.breakdown[color].score;
      if (mScore > oScore) {
        myRivalry += CONFIG.scoring.rivalryBonus;
        rivalryPerColor[color] = { my: CONFIG.scoring.rivalryBonus, opp: 0 };
      } else if (oScore > mScore) {
        oppRivalry += CONFIG.scoring.rivalryBonus;
        rivalryPerColor[color] = { my: 0, opp: CONFIG.scoring.rivalryBonus };
      } else {
        rivalryPerColor[color] = { my: 0, opp: 0 }; // Tied — no bonus
      }
    }
  }
  my.rivalry = myRivalry;
  my.rivalryPerColor = rivalryPerColor;
  my.total += myRivalry;
  opp.rivalry = oppRivalry;
  opp.rivalryPerColor = rivalryPerColor; // Same reference is safe — both sides' data is in each entry
  opp.total += oppRivalry;
  return { my, opp };
}

// ===== SINGLE-AUTHORITY MP RESULT =====
// Pure builder for the canonical rooms/$code/result payload: absolute per-slot
// scores from the shared board + both players' pre-ratings/game-counts. Both
// clients call this with the SAME synced playPiles + players node, so they build
// byte-identical candidates and the write-once transaction commits exactly one.
// Kept here (pure, requireable) so the app (multiplayer.js) and the headless
// two-client emulator test exercise ONE implementation. Caller adds `at`/`by`.
function buildCanonicalResult(playPiles, players, opts) {
  opts = opts || {};
  const start = (opts.startRating != null) ? opts.startRating : 1200;
  const num = (v, d) => (typeof v === 'number') ? v : d;
  const p = players || {};
  const rv = scoreWithRivalry(playPiles.player1, playPiles.player2);
  return {
    scores: { player1: rv.my.total, player2: rv.opp.total },
    ratingsBefore: {
      player1: num(p.player1 && p.player1.rating, start),
      player2: num(p.player2 && p.player2.rating, start)
    },
    gamesBefore: {
      player1: num(p.player1 && p.player1.gamesPlayed, 0),
      player2: num(p.player2 && p.player2.gamesPlayed, 0)
    },
    unranked: !!opts.unranked,
    variant: opts.variant || 'classic',
    moveNumber: num(opts.moveNumber, null)
  };
}

// ===== ELO RATING SYSTEM =====

function eloExpected(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

function eloChange(playerRating, opponentRating, actual, kFactor) {
  return Math.round(kFactor * (actual - eloExpected(playerRating, opponentRating)));
}

// ===== UI GEOMETRY (Layer 4 — Layout Math) =====

const PHI = 1.6180339887;
const STACK_K = 0.367;
const STACK_EXP = 0.613;

function phiTier(cardH, n) {
  return cardH / Math.pow(PHI, n);
}

function stackOffset(count, cardH) {
  if (count <= 1) return 0;
  return cardH * STACK_K / Math.pow(count, STACK_EXP);
}

function pileHeight(cardCount, cardOffset, cardH) {
  if (cardCount <= 0) return 0;
  return cardH + Math.max(0, cardCount - 1) * cardOffset;
}

function center(contentHeight, containerHeight) {
  return Math.max(0, Math.round((containerHeight - contentHeight) / 2));
}

function jitter(cardId, index) {
  const s = cardId + ':' + index;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  h = h & 0x7FFFFFFF; // ensure positive
  const rotation = (h % 100) / 100 * CONFIG.ui.jitter.degrees * 2 - CONFIG.ui.jitter.degrees;
  const x = ((h >>> 4) % 100) / 100 * CONFIG.ui.jitter.px * 2 - CONFIG.ui.jitter.px;
  const y = ((h >>> 8) % 100) / 100 * CONFIG.ui.jitter.px * 2 - CONFIG.ui.jitter.px;
  return { rotation, x, y };
}

// ===== EXPORTS =====

const MATH = {
  scorePlayPile, scoreAll, scoreBreakdown, scoreWithRivalry, buildCanonicalResult,
  eloExpected, eloChange,
  phiTier, stackOffset, pileHeight, center, jitter,
  PHI, STACK_K, STACK_EXP
};

// Backwards compatibility — UI_MATH alias
const UI_MATH = MATH;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MATH;
}
