// Wager mark — ONE inline SVG (references the #icon-wager sprite symbol) used on
// wager card faces and in the score breakdown, so the wager glyph is identical on
// every OS instead of the 🤝 emoji, which each platform draws differently.
const WAGER_ICON = '<svg class="wager-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-wager"/></svg>';

const CONFIG = {
  // === L0: Game Rules ===
  allColors: ['red', 'green', 'blue', 'white', 'yellow', 'purple'],
  colors: ['red', 'green', 'blue', 'white', 'yellow'], // derived from ventureCount
  ventureCount: 5, // 4, 5, or 6
  wagerCount: 3,
  numberRange: [2, 10],
  handSize: 8,

  // Scoring
  scoring: {
    baseCost: 20,
    bonusThreshold: 8,
    bonusPoints: 20,
    rivalryBonus: 10,
  },

  // Rivalry bonus variation — off by default
  rivalryEnabled: false,

  // Variants
  variants: {
    classic: { discardPiles: null },  // Set below to colors.length
    single:  { discardPiles: 1 },     // Shared pile
  },

  // Color display — values from constants.js
  colorHex: { red: '#c04040', green: '#40a060', blue: '#4080c0', white: '#909098', yellow: '#c0a030', purple: '#8060b0' },
  colorLabels: { red: 'Red', green: 'Green', blue: 'Blue', white: 'White', yellow: 'Yellow', purple: 'Purple' },
  colorSymbols: { red: '\u25B2', green: '\u25CF', blue: '\u2248', white: '\u25C6', yellow: '\u2605', purple: '\u2726' },

  // === L2: AI Parameters ===
  // AI personalities — values from constants.js + elo.js AI_RATINGS
  // RETIRED (2026-07-14 hygiene pass): the 5 evolved genomes (explorer/scholar/
  // collector/spy/gambler), Neural v9, and Neural NFSP were removed from the roster
  // (none had a picker button; all lost badly: genomes 67-91% to Strategist, v9 ~23%
  // WR, NFSP ~54%). FAIL-LOUD, no silent substitution (P4): a stale localStorage key
  // now console.warns and is ignored (ui.js load), keeping the initialized default
  // (it is NOT swapped for another bot); the two former `|| .scholar` display-name
  // fallbacks in ai-game.js were replaced with a console.error (no default name
  // substituted). Worker dispatch/loaders (ai-worker.js, v9/nfsp_neural_ai.js) are now
  // UI-unreachable but left in place (out of scope for this config-only pass).
  // Seer/Oracle are cosmetically Strategist (cheat info wired but unused) \u2014
  // their edge is seeing your hand, not better play.
  // SAGE-ONLY PICKER (CEO 2026-07-22): only `expert` (Sage) has a picker button
  // now; all other entries below are RETAINED (not deleted) so match-history /
  // replay / elo can still resolve bot NAMES for older games. Do not prune.
  personalities: {
    // Challenge-tier ratings below are MEASURED (2026-07-10 balanced-field round
    // robin, Bradley-Terry Elo, 300 games/pairing): Sage 1551 > Tactician 1545 >
    // Prodigy 1471 > Strategist 1403. Strategist is the weakest challenge bot.
    heuristic: { name: 'Strategist', emoji: '\u{1F9E0}',       rating: 1410, tier: 'challenge' },
    // Tactician (WORKING NAME — pending CEO/branding confirmation): lockout triage
    // heuristic (beats Strategist 61.8% held-out) + exact-solver endgame PIMC
    // (deck<=5). All Rust->WASM (docs/endgame-wasm-deploy.md). Additional to
    // Strategist; Strategist stays as the reference baseline.
    // noSinglePile: the tactician WASM (triage heuristic + endgame solver) is
    // classic-only — in single-pile the worker would silently fall back to the
    // Strategist heuristic. The picker gates it out of single-pile (ui.js).
    tactician: { name: 'Tactician', emoji: '\u{1F9ED}', rating: 1545, tier: 'challenge', warn: 'Endgame solver may take ~1-2s/move.', noSinglePile: true },
    // neural_pimc NOT in the measured tournament (needs pyspiel/ONNX headless) —
    // 1550 is an estimate from its historical ~81% vs Strategist.
    neural_pimc: { name: 'Neural+Search', emoji: '\u{1F9D9}', rating: 1550, tier: 'challenge', warn: 'Slow (~1-3s/move). Search-augmented AI.' },
    // Sage (WORKING NAME): faithful port of the Python "expert-rules" bot — a
    // distributional, no-search public-info AI (beats Strategist ~52-58% in
    // Python). Pure cheap arithmetic, near-instant; ported AS-IS to observe its
    // real play. See public/ai-worker.js expertDecide().
    // noSinglePile: the classic route is WASM Sage; the single-pile JS route
    // (expertDecide) bails on non-classic and hard-errors the worker. Gated out
    // of single-pile by the picker (ui.js) until single-pile lands in the WASM.
    expert: { name: 'Sage', emoji: '\u{1F9D3}', rating: 1550, tier: 'challenge', warn: 'Experimental expert-rules AI.', noSinglePile: true },
    // Prodigy (WORKING NAME — CEO may rename): faithful port of the Python
    // kid-rules bot (expert_ai/simple_bot.py). The simplest solid rules an
    // 8-year-old could follow, in game points. See ai-worker.js kidDecide().
    // noSinglePile: kidDecide bails on non-classic (per-color rules), so the
    // worker would silently fall back to the Strategist heuristic. Picker-gated.
    kid: { name: 'Prodigy', emoji: '\u{1F9D2}', rating: 1470, tier: 'challenge', warn: 'Simple-rules kid bot.', noSinglePile: true },
    seer:      { name: 'The Seer',   emoji: '\u{1F441}\uFE0F', rating: 1450, boss: true, tier: 'boss', warn: 'Can see your cards' },
    oracle:    { name: 'The Oracle', emoji: '\u{1F52E}',       rating: 1600, boss: true, tier: 'boss', warn: 'Knows everything' },
  },

  // AI thresholds — from ai-worker.js
  ai: {
    endgameDeckSize: 6,
    endgameRolloutThreshold: 12,
    minimaxDeckThresholds: [4, 8, 12],
    mcSimulations: 500,
    heuristicDeckPhases: { early: 35, mid: 25, late: 15 },
  },

  // === L3: Multiplayer ===
  // Multiplayer — from multiplayer.js
  matchmakingTimeoutMs: 60000,

  // === L4: UI ===
  // UI thresholds — from rendering.js + animations.js
  ui: {
    idleMs: 30000, // default idle reminder delay; user setting in localStorage overrides
    idleReminderOptions: [-1, 0, 10000, 30000], // Off, Immediate, 10s, 30s
    idleReminderLabels: ['Off', 'Immediate', '10s', '30s'],
    turnFlashMs: 2000,
    animMs: 300,
    maxDrawPileShow: 10,
    jitter: { degrees: 3, px: 3 },
    zIndex: { spread: 100, selected: 5000 },
    fallbackWidth: 375,
    idlePollMs: 200,
    opacity: { active: 0.7, dim: 0.5, faint: 0.4 },
    letterSpacing: '1.5px',
    phaseTextMs: 150,
    // CSS-var strings (not hex) so a theme swap of the underlying token reaches these
    // JS-set colors too. Consumed as CSS values (el.style.color = …) in timer.js/ui.js.
    colors: {
      danger: 'var(--danger)',
      warning: 'var(--warning)',
      normal: 'var(--parchment)',
      success: 'var(--success)',
      error: 'var(--danger)',
    },
    glow: {
      radialBlur: 8,
      radialTransitionMs: 300,
      screenEdgeOpacity: { off: 0, medium: 0.15, high: 0.25 },
      screenEdgeTransitionMs: 400,
      radiusScale: 0.618,
      handOffset: 30,
    },
    timing: {
      nameHighlightMs: 300,
      idleNotificationMs: 300,
      gameEndPauseMs: 600,
      scoreRevealMs: 300,
    },
  },

  // Playable targets - config-driven instead of scattered logic
  playableTargets: {
    playPhase: {
      myTurn: ['hand-cards'],
      opponentTurn: ['hand-cards', 'pile-expansion']  // Allow selection + expansion, but no playable effects
    },
    drawPhase: {
      myTurn: ['draw-pile', 'discard-piles'],
      opponentTurn: ['hand-cards', 'pile-expansion']  // Allow selection + expansion, but no playable effects
    },
    // Undo availability rules
    undo: {
      availableIn: 'drawPhase',
      requireMyTurn: true,
      disabledAfterDraw: true
    }
  },

  // ELO — from elo.js
  elo: {
    startRating: 1200,
    historyMax: 50,
    kFactor: { provisional: 32, established: 16, threshold: 20 },
  },

  // === L4: Timer ===
  // Timer — from timer.js
  timer: {
    options: ['30', '60', '90', 'friendly'],
    warningAt: 10,
    criticalAt: 5,
  },

  // === L4: Achievements ===
  // Achievement thresholds — from achievements.js
  // Achievements: the catalog (tiered templates + categories) lives in
  // src/achievements.js as a declarative ACH_TEMPLATES array \u2014 it couples
  // thresholds with metric functions, so it belongs with the engine.

  // Storage
  storagePrefix: 'expedition',
};

// Canonical hand sort: by color order, then value ascending
CONFIG.cardSortComparator = function(a, b) {
  const ci = CONFIG.colors.indexOf(a.color) - CONFIG.colors.indexOf(b.color);
  return ci !== 0 ? ci : a.value - b.value;
};

if (typeof document !== 'undefined') {
  document.documentElement.style.setProperty('--num-colors', CONFIG.colors.length);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
