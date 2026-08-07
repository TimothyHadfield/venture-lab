// === GOLDEN RATIO (φ) LAYOUT SYSTEM ===
// Every measurement = cardH / φ^n for some integer n.
// cardH is solved from viewport dimensions to guarantee fit.

// The universal ruler: size at tier n = cardH / φ^n
// Semantic tiers:
//   n=0: cardH (the card, the base unit)
//   n=1: cardW (card minor dimension)
//   n=2: peek height, card overlap visible strip
//   n=3: textLg, board margin, big section spacing minimum
//   n=4: textMd (fontBase), slotPad, small section spacing minimum
//   n=5: textSm (small labels)
//   n=7: --space-micro (small UI spacing)
//   n=9: border width
function lvl(n, cardH) {
  return cardH / Math.pow(UI_MATH.PHI, n);
}

// Pile content height for N cards (local helper — uses UI_MATH.stackOffset)
function playContentHeight(N, cH) {
  return cH + Math.max(0, N - 1) * UI_MATH.stackOffset(N, cH);
}

// Seed for the fanned-hand height ratio (projH / cardH). The layout SOLVER derives
// the REAL ratio by measuring the cone projection (fanHeightRatio in computeLayout);
// this is only the first-pass estimate that breaks the circularity (the ratio
// depends weakly on cardH via cardH/R). Real measured values run ~1.11–1.18.
const CONE_BBOX_SEED = 1.15;

// Max cards per color (3 wagers + 2-10 = 12)
const MAX_CARDS_PER_COLOR = 12;

function computeLayout() {
  // LAB PATCH — the lab bar is a fixed strip across the top. computeLayout
  // solves the whole board against the raw viewport height, so without this the
  // board would be laid out for a taller window than it actually gets and the
  // bottom would overflow. LAB.topInset matches #game-screen's padding-top.
  const vh = window.innerHeight - ((typeof LAB !== 'undefined' && LAB.topInset) || 0);
  // rightInset and leftInset reserve the strips the deck panel (right) and the
  // info panel (left) occupy, so the board is solved for the width it actually
  // gets instead of running underneath them.
  const vw = window.innerWidth - ((typeof LAB !== 'undefined' && LAB.rightInset) || 0)
                               - ((typeof LAB !== 'undefined' && LAB.leftInset)  || 0);

  // Skip if nothing that affects the solve changed
  if (computeLayout._vh === vh && computeLayout._vw === vw) return computeLayout._result;
  // Invalidate four-corner renderer cache on resize
  if (typeof fourCornerRenderer !== 'undefined') fourCornerRenderer.invalidateCache();

  const numColors = typeof CONFIG !== 'undefined' ? CONFIG.colors.length : 5;

  // --- Section height ratios (multiples of cardH) ---
  const peekR       = 1 / (UI_MATH.PHI * UI_MATH.PHI);                    // n=2: 0.382
  const infoRowR    = 1 / (UI_MATH.PHI * UI_MATH.PHI * UI_MATH.PHI);          // n=3: 0.236
  const maxN        = MAX_CARDS_PER_COLOR;
  const playContentR = 1 + (maxN - 1) * UI_MATH.STACK_K / Math.pow(maxN, UI_MATH.STACK_EXP);
  const playScoreR = 1 / Math.pow(UI_MATH.PHI, 4);                // n=4: textSm line-height, in normal flow
  const playRowR   = playContentR + playScoreR;

  // Slot height = card + slotPad
  const slotPadR    = 1 / Math.pow(UI_MATH.PHI, 4);                // n=4
  const slotHR      = 1 + slotPadR;

  // Middle section = just the card slot. The "N left" label floats in the big
  // elastic gap below the draw pile (it doesn't need reserved space — and in
  // classic mode it sits over the score area, not the piles), so no extra padding
  // here. This also removes the centring gap above/below the discard slots.
  const midR = slotHR;

  // Hand area
  // handR (fanned-hand bbox + lift) is DERIVED below by measuring the real cone
  // projection — no hard-coded ratio.

  // Player-name row above/below each hand — a real flow row so the name's own
  // line-height (leading) sets its spacing automatically. The band = the name's
  // EXACT line box (text + leading), DERIVED from the text tier: the name renders
  // at tier NAME_TEXT_TIER (see rendering.js renderNameTags) and its line-height
  // is one φ-tier up. So this tracks the text — it isn't a free-standing 1/φ².
  const NAME_TEXT_TIER = 3;                                        // keep in sync with renderNameTags
  const nameRowR    = 1 / Math.pow(UI_MATH.PHI, NAME_TEXT_TIER - 1);  // line-height = one tier up

  // Board margin
  const marginR     = 1 / Math.pow(UI_MATH.PHI, 4);          // n=4 — board margin (one φ-tier tighter)

  // --- Section spacing minimums ---
  // 5 sections (hand·play·middle·play·hand) → 4 gaps: 2 big + 2 small.
  const bigGapMinR  = 1 / (UI_MATH.PHI * UI_MATH.PHI * UI_MATH.PHI);          // n=3 (2 big section spacings)
  const smallGapMinR = 1 / Math.pow(UI_MATH.PHI, 4);               // n=4 (2 small section spacings)
  const totalMinGapR = 2 * bigGapMinR + 2 * smallGapMinR;

  // Bottom bar band only (live: undo/timer · replay: scrubber). φ-derived: a
  // control (cardH/φ) + slot padding + a small gap. The board fills the space
  // ABOVE the bar and is symmetric WITHIN that space — no matching empty band at
  // the top (nav chrome overlays the top corners instead).
  const bandR = 1 / UI_MATH.PHI + slotPadR + smallGapMinR;

  // --- Solve for cardH ---
  // Horizontal constraint — no column gap, column width IS the content space.
  // Independent of the hand height, so solve it once up front.
  const colWR = 1 / UI_MATH.PHI + slotPadR;  // cardW + card padding
  const totalWR = (numColors + 1) * colWR + 2 * marginR; // +1 for draw pile column
  const cardH_h = Math.floor(vw / totalWR);

  // Everything on the vertical constraint EXCEPT the two hands (derived below).
  const fixedVertR = 2 * nameRowR + 2 * playRowR + midR + totalMinGapR + 2 * marginR + bandR;

  // Measure the fanned-hand bbox / cardH from the REAL cone projection at a given
  // cardH (computeCone gets explicit dims — the CSS vars aren't set yet). 3% margin
  // so rounding never clips; sane-range guard falls back to the seed.
  function fanHeightRatio(cardH) {
    try {
      const cardW = Math.round(lvl(1, cardH));
      const containerW = vw - 2 * Math.round(lvl(3, cardH));  // board width ≈ vw − 2 margins
      const cone = computeCone(CONFIG.handSize, containerW, { cardW, cardH });
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < CONFIG.handSize; i++) {
        const c = computeHandCardCorners(i, CONFIG.handSize, cone);
        for (const k of ['TL','TR','BL','BR']) { minY = Math.min(minY, c[k].y); maxY = Math.max(maxY, c[k].y); }
      }
      const r = (maxY - minY) / cardH;
      return (r > 0.8 && r < 1.6) ? r * 1.03 : CONE_BBOX_SEED;
    } catch (e) { return CONE_BBOX_SEED; }
  }

  // Fixed-point solve: measure the ratio at the current cardH, re-solve, repeat
  // until cardH stops moving (±1px). It's a negative feedback (bigger reserved
  // height → smaller cardH → smaller fan → smaller ratio), so it converges fast —
  // typically 2 iterations. The cap (8) is a safety backstop against a ±1px
  // floor() oscillation, never a real limit.
  let handBBoxR = CONE_BBOX_SEED;
  let cardH = cardH_h;                       // seed from the width constraint
  let _passes = 0;
  for (let pass = 0; pass < 8; pass++) {
    _passes = pass + 1;
    handBBoxR = fanHeightRatio(cardH);       // ratio at the current cardH
    const totalR = 2 * handBBoxR + fixedVertR;
    const nextCardH = Math.max(12, Math.min(Math.floor(vh / totalR), cardH_h));
    if (Math.abs(nextCardH - cardH) <= 1) { cardH = nextCardH; break; }
    cardH = nextCardH;
  }
  computeLayout._passes = _passes;
  handBBoxR = fanHeightRatio(cardH);         // ratio consistent with the final cardH
  // Each hand band reserves ONLY the fan bbox — not the selected-card lift. The
  // lifted (selected) card is a transient overlay that rises into the small gap
  // above the hand; reserving permanent height for it (on BOTH hands, though only
  // the user hand ever lifts) was the odd bit. liftPx still drives the actual lift
  // in rendering.js.
  const handR = handBBoxR;

  // --- Derive all sizes ---
  const cardW       = Math.round(lvl(1, cardH));
  const colW        = Math.round(cardW + lvl(4, cardH));
  const boardMargin = Math.round(lvl(4, cardH));   // keep in sync with marginR (n=4)

  // Text sizes (φ tiers, negative n = larger). MIN_TEXT is an absolute
  // legibility floor (px) — a real-world constraint, not derivable from cardH.
  // Applied UNIFORMLY: max() with a shared constant preserves the φ ordering, so
  // the tiers can never invert (the old lone floor on textSm let it grow larger
  // than textLg/textMd at small card heights — the "# left looked huge" bug).
  // Role-named φ tiers. φ³ (body) is the legibility FLOOR — no prose/UI text is
  // smaller. MIN_TEXT is now ONLY a tiny-screen safety net so the floor can't
  // collapse on unusually short viewports (not a design knob). On-card
  // annotations (out of scope; future card art) use --text-card, a separate
  // card-relative micro size that is allowed below the prose floor.
  const MIN_TEXT = 12;
  const textDisplay = lvl(-1, cardH);                     // cardH × φ  — splash logo only
  const textTitle   = Math.max(lvl(1, cardH), MIN_TEXT);  // ÷φ  — screen titles
  const textHeading = Math.max(lvl(2, cardH), MIN_TEXT);  // ÷φ² — headings, primary buttons
  const textBody    = Math.max(lvl(3, cardH), MIN_TEXT);  // ÷φ³ — FLOOR: all readable text
  const textEmphasis = textBody * Math.sqrt(UI_MATH.PHI); // ×√φ — half-tier bump above body (running totals); always > body, so no tier inversion
  const textCard    = Math.max(lvl(5, cardH), 7);         // on-card annotations (exempt)

  // Line heights are no longer separate tokens — line-height = font × var(--leading)
  // in CSS (one φ-tier up), a single knob. (Was 7 --line-* tokens, all == text × φ.)

  // Non-elastic spacing tokens (φ tiers)
  const gapXxl = lvl(1, cardH);   // huge
  const gapXl = lvl(2, cardH);    // large
  const gapXs = lvl(5, cardH);    // small
  const gapMicro = lvl(6, cardH); // tiny
  const spaceThin = Math.max(2, Math.round(lvl(8, cardH))); // ≈2px — used for drop shadows / thin offsets
  const borderWThick = Math.max(2, Math.round(lvl(8, cardH))); // one tier thicker than --border-w

  // Spacing
  const slotPad = Math.round(lvl(4, cardH));
  const spaceMicro = Math.round(lvl(7, cardH)); // --space-micro (n=7) — smallest UI spacing tier
  const borderW = Math.max(1, Math.round(lvl(9, cardH)));

  // --- Section heights in pixels ---
  // Keys match SECTION_REGISTRY heightKey values for DRY
  const sectionHeights = {
    name_row:     Math.round(cardH * nameRowR),  // player-name band (flow leading)
    hand_opp:     Math.round(cardH * handR),   // full hand now (was peekR)
    play_row:     Math.round(cardH * playRowR),
    discard_draw: Math.round(cardH * midR),
    hand_user:    Math.round(cardH * handR),
  };

  // --- Elastic section spacing distribution ---
  // Fixed content + min section spacings (both hands full; 2 name bands; info rows gone)
  const fixedH = 2 * sectionHeights.name_row + sectionHeights.hand_opp + 2 * sectionHeights.play_row + sectionHeights.discard_draw + sectionHeights.hand_user + 2 * boardMargin + Math.round(bandR * cardH);
  const bigGapMin = Math.round(lvl(3, cardH));
  const smallGapMin = Math.round(lvl(4, cardH));
  const totalMinGapPx = 2 * bigGapMin + 2 * smallGapMin;
  const spareH = vh - fixedH - totalMinGapPx;

  // Distribute surplus proportionally (big section spacings get φ× weight)
  const bigW = UI_MATH.PHI, smallW = 1;
  const totalWeight = 2 * bigW + 2 * smallW;
  const surplus = Math.max(0, spareH);
  const bigGapPx = Math.round(bigGapMin + surplus * bigW / totalWeight);
  const smallGapPx = Math.round(smallGapMin + surplus * smallW / totalWeight);

  // --- Set CSS custom properties ---
  const root = document.documentElement.style;
  root.setProperty('--card-h', cardH + 'px');
  root.setProperty('--card-w', cardW + 'px');
  root.setProperty('--col-w', colW + 'px');
  root.setProperty('--text-display', textDisplay.toFixed(1) + 'px');
  root.setProperty('--text-title', textTitle.toFixed(1) + 'px');
  root.setProperty('--text-heading', textHeading.toFixed(1) + 'px');
  root.setProperty('--text-body', textBody.toFixed(1) + 'px');
  root.setProperty('--text-emphasis', textEmphasis.toFixed(1) + 'px');
  root.setProperty('--text-card', textCard.toFixed(1) + 'px');
  root.setProperty('--gap-xxl', gapXxl.toFixed(1) + 'px');
  root.setProperty('--gap-xl', gapXl.toFixed(1) + 'px');
  root.setProperty('--gap-xs', gapXs.toFixed(1) + 'px');
  root.setProperty('--gap-micro', gapMicro.toFixed(1) + 'px');
  root.setProperty('--space-micro', spaceMicro + 'px');
  root.setProperty('--space-thin', spaceThin + 'px');
  root.setProperty('--border-w-thick', borderWThick + 'px');
  // Dimensionless φ ratios: --phi-n = 1/φⁿ — for calc() multipliers on any base (cardH, cardW, etc.)
  for (let n = 0; n <= 9; n++) {
    root.setProperty('--phi-' + n, (1 / Math.pow(UI_MATH.PHI, n)).toFixed(6));
  }
  root.setProperty('--gap-lg', bigGapPx + 'px');
  root.setProperty('--gap-sm', smallGapPx + 'px');
  root.setProperty('--slot-pad', slotPad + 'px');
  root.setProperty('--border-w', borderW + 'px');
  root.setProperty('--board-margin', boardMargin + 'px');
  root.setProperty('--num-colors', numColors);
  // Chrome band height — reserved top AND bottom by the board (padding), filled
  // by the nav chrome (top) and the bar (bottom).
  root.setProperty('--bar-band-h', (bandR * cardH).toFixed(1) + 'px');

  // --- Apply section heights and spacing (DRY via registry) ---
  applySectionLayout(sectionHeights, bigGapPx, smallGapPx);

  // --- Store result ---
  const result = {
    cardW, cardH, sectionHeights, colW, boardMargin,
    bigGapPx, smallGapPx, slotPad, borderW,
    playContentR, playScoreR, slotHR,
    playContentH: Math.round(playContentHeight(MAX_CARDS_PER_COLOR, cardH)),
    playScoreH: Math.round(lvl(4, cardH)),   // play-pile score row height (φ⁴; on-card scale)
    numColors, peekR, infoRowR, playRowR, midR, handR,
  };
  computeLayout._vh = vh;
  computeLayout._vw = vw;
  computeLayout._result = result;
  return result;
}

// Expose globally
window.lvl = lvl;
window.stackOffset = UI_MATH.stackOffset;
window.computeLayout = computeLayout;
