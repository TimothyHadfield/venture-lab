"use strict";
/* ============================================================================
   lab.js — Venture Lab driver.

   The board you see is the REAL Venture client presentation stack (vendor/):
   config · rules · math · engine · layout · geometry · four-corner-renderer ·
   rendering · styles.css. Nothing about the look is reimplemented here, which
   is the point — the board is identical to the live game.

   What this file supplies is everything the live client got from Firebase,
   multiplayer, auth, stats and the AI worker, none of which is vendored:

     1. the small set of globals + no-op stubs the render stack expects,
     2. the player actions (select / play / discard / draw), lifted verbatim
        from the game's own gamelogic.js so interaction behaves identically,
     3. a local offline opponent,
     4. LAB — the lab-only features: perfect information (revealed draw pile
        and revealed opponent hand, both ON by default) and the per-colour
        POTENTIAL readout.

   Two four-line patches in vendor/src/rendering.js let the reveals work in a
   live game; both are marked `LAB PATCH` and both fall back to the stock
   behaviour when LAB is absent.
   ========================================================================== */

/* ---------------------------------------------------------------- settings */
const LAB = {
  revealDeck: true,   // draw pile face-up (default ON — this is the lab)
  revealOpp:  true,   // opponent's hand face-up (default ON)
  potential:  true,   // per-colour potential under each pile
  assist: false,      // Venture Assistant (default OFF — it takes moves away)
  pickDraw: false,    // click any deck card to draw it (default OFF — see labPickDraw)
  ai: 'solid',        // 'casual' | 'solid' | 'sharp'
  aiDelayMs: 550,     // pause between the opponent's play and its draw
  topInset: 44,       // height of the lab bar; layout.js subtracts it from the
                      // viewport so the board is solved for the space it gets
};

/* ------------------------------------------------- stubs the stack expects
   rendering.js reaches for these on the game-over and replay paths, which the
   lab doesn't have. They must EXIST (they're called unguarded) but do nothing.
*/
function toast(msg){ _labFlash(msg); }
function toastInfo(msg){ _labFlash(msg); }
function toastError(msg){ _labFlash(msg); }
function loadStats(){ return { games:0, wins:0, losses:0, draws:0, byPersonality:{} }; }
function viewerName(){ return 'You'; }
function getName(){ return 'You'; }
function toggleScore(){}
function showReplayResults(){}
function toggleReplayDeck(){}
function pushUndoSnapshot(){}
function popUndoSnapshot(){}
function onTurnChange(){}
function confirmAbandonGame(){ if (confirm('Start a new game?')) newLabGame(); }
function showGameMenu(){ _labFlash('Menu lives in the top bar'); }
function extendedUndo(){ undoLastPlay(); }
// The spread-view backdrop in the game's own markup calls renderBoard() — a
// name that does not exist anywhere in the client (stale in his index.html).
// Aliased so dismissing a spread pile doesn't throw.
function renderBoard(){ renderGame(); }

/* A minimal toast so messages from the real action code still surface. */
let _labFlashTimer = 0;
function _labFlash(msg){
  const el = document.getElementById('lab-flash');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(_labFlashTimer);
  _labFlashTimer = setTimeout(() => el.classList.remove('on'), 2000);
}

/* ============================================================================
   PLAYER ACTIONS

   Lifted from the game's own src/gamelogic.js so that selecting, playing,
   discarding and drawing behave exactly as they do on the live site. The only
   removals are the Firebase writes and the tiered-undo snapshots (stubbed
   above). Each still mutates gameState through ENGINE and then emits
   'stateChanged', which _labApply below turns into a render.
   ========================================================================== */

function selectCard(cardId){
  if (gameState.currentTurn !== userSlot || gameState.phase !== 'play') return;
  // The assistant's grey-out is CSS; this is the rule. A click can still arrive
  // from a stale handler or a card that was blocked between render and press.
  if (_labAssistBlocked().has(cardId)){
    _labFlash('Assistant: play the lowest card of that colour first');
    return;
  }
  SFX.select();
  spreadPile = null;
  const hand = getCards(gameState, 'hands', userSlot);
  const card = hand.find(c => c.id === cardId);
  if (!card) return;
  selectedCard = (selectedCard && selectedCard.id === cardId) ? null : card;
  renderGame();
}

async function playToExpedition(color){
  if (!selectedCard || gameState.currentTurn !== userSlot || gameState.phase !== 'play') return;
  if (selectedCard.color !== color) return;
  const card = selectedCard;
  const moveNum = gameState.moveNumber;
  const result = ENGINE.playCard(gameState, userSlot, card, color);
  if (!result.success){ toast('Must be higher than top card'); return; }
  lastPlayedCard = { card, to:'play', color, moveNumber:moveNum };
  selectedCard = null;
  emit('stateChanged', { action:'play', card, color });
}

async function discardTo(color){
  if (!selectedCard || gameState.currentTurn !== userSlot || gameState.phase !== 'play') return;
  if (selectedCard.color !== color){
    toast('Discard to the ' + CONFIG.colorLabels[selectedCard.color] + ' pile'); return;
  }
  const card = selectedCard;
  const moveNum = gameState.moveNumber;
  ENGINE.discardCard(gameState, userSlot, card, color);
  lastPlayedCard = { card, to:'discard', color, moveNumber:moveNum };
  selectedCard = null;
  emit('stateChanged', { action:'discard', card, color });
}

async function drawFromDrawPile(){
  if (gameState.currentTurn !== userSlot || gameState.phase !== 'draw') return;
  const result = ENGINE.drawFromDeck(gameState, userSlot);
  if (!result.success) return;
  lastPlayedCard = null;
  emit('stateChanged', { action:'draw', card:result.card });
}

async function drawFromDiscard(color){
  if (gameState.currentTurn !== userSlot || gameState.phase !== 'draw') return;
  const pile = getCards(gameState, 'discards', color);
  if (pile.length === 0) return;
  const result = ENGINE.drawFromDiscard(gameState, userSlot, color);
  if (!result.success){ toast("Can't draw from the pile you just discarded to"); return; }
  lastPlayedCard = null;
  emit('stateChanged', { action:'draw', card:result.card, color });
}

/* Single-pile variant is not used in the lab (classic only), but rendering.js
   emits calls to these when variant==='single'. Kept so nothing can throw. */
async function discardToSingle(){}
async function drawFromSingle(){}

async function undoLastPlay(){
  if (!lastPlayedCard || gameState.phase !== 'draw' || gameState.currentTurn !== userSlot) return;
  const { card, to, color } = lastPlayedCard;
  const result = ENGINE.undo(gameState, { type: to === 'play' ? 'play' : 'discard', card, color });
  if (!result.success) return;
  selectedCard = card;
  lastPlayedCard = null;
  emit('stateChanged', { action:'undo', card, color });
}

/* Pile spread (click a pile to fan it out) is rendering.js's own toggleSpread. */

/* ------------------------------------------------- state change -> render */
on('stateChanged', ({ action }) => {
  if (action === 'play') SFX.play();
  else if (action === 'discard') SFX.discard();
  else if (action === 'draw') SFX.drawCard();
  else if (action === 'undo') SFX.undo();

  renderGame();

  if (gameState.status === 'finished'){ _labGameOver(); return; }
  if (gameState.currentTurn !== userSlot) _labAITurn();
});

/* ============================================================================
   THE OPPONENT

   A local, offline opponent. Deliberately NOT the real Sage bot (that is a
   WASM worker on his site) — the lab is for studying positions, so the
   opponent only has to play sensibly.
   ========================================================================== */

function _labPileScore(pile){ return MATH.scorePlayPile(pile); }

function _labCanPlay(card, pile){
  return RULES.canPlayOnPlayPile ? RULES.canPlayOnPlayPile(card, pile) : _labCanPlayFallback(card, pile);
}
function _labCanPlayFallback(card, pile){
  if (!pile.length) return true;
  const top = pile[pile.length - 1];
  if (card.value === 0) return top.value === 0;
  return card.value > top.value;
}

function _labAIChoosePlay(slot){
  const hand = getCards(gameState, 'hands', slot);
  const level = LAB.ai;
  if (level === 'casual'){
    const legal = hand.filter(c => _labCanPlay(c, getCards(gameState,'playPiles',slot,c.color)));
    if (legal.length && Math.random() < 0.7){
      const c = legal[Math.floor(Math.random()*legal.length)];
      return { kind:'play', card:c, color:c.color };
    }
    const c = hand[Math.floor(Math.random()*hand.length)];
    return { kind:'discard', card:c, color:c.color };
  }
  // solid / sharp: continue a started venture, or open one deep enough to
  // clear the -20; otherwise dump the least useful card.
  let best = null, bestK = -Infinity;
  for (const c of hand){
    const pile = getCards(gameState,'playPiles',slot,c.color);
    if (!_labCanPlay(c, pile)) continue;
    const started = pile.length > 0;
    let k;
    if (started) k = 1000 - c.value;
    else {
      const held = hand.filter(x => x.color === c.color).length;
      if (held < 3 && c.value !== 0) continue;
      k = 500 + held*10 - c.value;
    }
    if (level === 'sharp'){
      k += (_labPileScore(pile.concat([c])) - _labPileScore(pile)) * 0.2;
    }
    if (k > bestK){ bestK = k; best = c; }
  }
  if (best) return { kind:'play', card:best, color:best.color };
  let dump = null, dumpK = Infinity;
  for (const c of hand){
    const k = (getCards(gameState,'playPiles',slot,c.color).length ? 1000 : 0) + c.value;
    if (k < dumpK){ dumpK = k; dump = c; }
  }
  const c = dump || hand[0];
  return { kind:'discard', card:c, color:c.color };
}

function _labAIChooseDraw(slot){
  for (const color of CONFIG.colors){
    if (gameState.lastDiscardTarget === color) continue;
    const pile = getCards(gameState,'discards',color);
    if (!pile.length) continue;
    const card = pile[pile.length-1];
    if (_labCanPlay(card, getCards(gameState,'playPiles',slot,card.color))) return { source:'discard', color };
  }
  return { source:'deck' };
}

let _labAIBusy = false;
function _labAITurn(){
  if (_labAIBusy || !gameState || gameState.status === 'finished') return;
  const slot = gameState.currentTurn;
  if (slot === userSlot) return;
  _labAIBusy = true;
  setTimeout(() => {
    if (gameState.phase === 'play'){
      const mv = _labAIChoosePlay(slot);
      if (mv.kind === 'play') ENGINE.playCard(gameState, slot, mv.card, mv.color);
      else ENGINE.discardCard(gameState, slot, mv.card, mv.color);
      SFX[mv.kind === 'play' ? 'play' : 'discard']();
      renderGame();
    }
    setTimeout(() => {
      if (gameState.currentTurn === slot && gameState.phase === 'draw'){
        const d = _labAIChooseDraw(slot);
        if (d.source === 'deck') ENGINE.drawFromDeck(gameState, slot);
        else if (!ENGINE.drawFromDiscard(gameState, slot, d.color).success) ENGINE.drawFromDeck(gameState, slot);
        SFX.drawCard();
      }
      _labAIBusy = false;
      renderGame();
      if (gameState.status === 'finished') _labGameOver();
      else if (gameState.currentTurn !== userSlot) _labAITurn();
    }, LAB.aiDelayMs);
  }, LAB.aiDelayMs);
}

/* ============================================================================
   POTENTIAL — the analysis feature

   For one colour and one player: the score that pile would reach if that
   player received EVERY card still REACHABLE BY THEM that could legally be
   added to it.

   Reachable, for that player = the draw pile + their OWN hand + the colour's
   discard pile. Two exclusions, for two different reasons:

     - **Played cards are gone.** Either side's play pile is permanent.
     - **The opponent's hand is out of reach.** You cannot draw a card someone
       else is holding. It may come back into play later — they might discard
       it — but from where the position stands now it is not yours to get, and
       counting it inflates your ceiling with their cards.

   Discards DO count: a discard pile is a real source (drawing its top is half
   the game's turn), and cards buried under the top become reachable as the
   pile is drawn down. It is a generous assumption, but generosity is what a
   ceiling is for — the number answers "how far could this colour possibly go
   for me", not "how far will it".

   So the two numbers under a colour are now genuinely per player: each counts
   its own holder's hand and neither counts the other's.

   The legal additions are forced by the rules, so there is nothing to search:
   a venture ascends, so every number above the pile's top can be added (values
   are unique per colour), and wagers can only be added while the pile has no
   numbers yet.
   ========================================================================== */

/* The rule itself, as a pure function of a pile and the cards still available
   to it. Shared with the computers in computers.js, so "potential" means one
   thing across the whole site and is defined in exactly one place.

   `maxAdds` is optional and is what makes REACHABLE potential (below) possible:
   with a budget, you can no longer play everything, so the question changes from
   "what does this colour come to" into "what is the best I could get out of it
   in N more plays". Left out, the function is exactly what it always was. */
function venturePotential(pile, pool, maxAdds){
  const hasNumbers = pile.some(c => c.value > 0);
  const topValue = hasNumbers ? pile[pile.length - 1].value : 0;

  const wagers = [], numbers = [];
  if (!hasNumbers){                                    // wagers precede all numbers
    for (const c of pool) if (c.value === 0) wagers.push(c);
  }
  for (const c of pool) if (c.value > topValue) numbers.push(c);

  // No budget: the original rule, untouched — every legal addition goes on,
  // wagers first.
  if (!(maxAdds >= 0)){
    const additions = wagers.concat(numbers).sort((a, b) => a.value - b.value);
    return MATH.scorePlayPile(pile.concat(additions));
  }

  // Budgeted. For a fixed number of number-cards the best set is simply the
  // highest ones (any set of them plays in ascending order, and the 8+ bonus
  // depends on the COUNT, which the budget already fixes) — so the only real
  // question is how many of the slots to spend on wagers, and that is small
  // enough to try exhaustively.
  //
  // ⚠️ The budgeted branch runs even when the budget does not bind, and that is
  // deliberate: it also lets a colour DECLINE cards, which the all-in rule
  // cannot. Falling back to the all-in rule at the boundary made the number
  // jump — an unstarted colour holding a wager and a 3 read 0 with one turn left
  // and −34 with two, because at two the all-in rule took over and played a
  // wager onto a loss. Reachable now only ever rises with the budget.
  //
  // The consequence to know: an UNSTARTED colour is never reachable-negative,
  // because not opening it is always available. A started one can be, since the
  // −20 is already spent — which is exactly what an opening gate wants to test.
  const cap = Math.min(Math.floor(maxAdds), wagers.length + numbers.length);
  const desc = numbers.slice().sort((a, b) => b.value - a.value);
  let best = MATH.scorePlayPile(pile);
  for (let w = 0; w <= Math.min(wagers.length, cap); w++){
    const take = desc.slice(0, cap - w).sort((a, b) => a.value - b.value);
    const score = MATH.scorePlayPile(pile.concat(wagers.slice(0, w)).concat(take));
    if (score > best) best = score;
  }
  return best;
}

/* The pool is built from THIS slot's point of view: the deck and the discards
   are open to both, the hand is not. (_labPoolOf, below the potential section,
   is that rule in one place — the reachable readout uses the same pool, so the
   two numbers are always about the same set of cards.) */
function labColorPotential(slot, color){
  return venturePotential(_labPileOf(slot, color), _labPoolOf(slot, color));
}

/* --- render the potential row under each pile ---------------------------
   Drawn as its own absolutely-positioned layer inside .board-area, driven off
   the SAME layout the renderer uses (computeLayout + the section/column
   geometry), so the numbers sit under the right columns at any window size.
   Hooked to the 'rendered' event that renderGame() emits, so it re-lays out
   whenever the board does — no changes to the render stack itself.
*/
function _labRenderPotential(){
  const board = document.querySelector('.board-area');
  if (!board) return;
  let layer = document.getElementById('lab-potential-layer');
  if (!layer){
    layer = document.createElement('div');
    layer.id = 'lab-potential-layer';
    board.appendChild(layer);
  }
  if (!LAB.potential || !gameState){ layer.innerHTML = ''; return; }

  const oppSlot = userSlot === 'player1' ? 'player2' : 'player1';
  const boardRect = board.getBoundingClientRect();

  // Position from the LAYOUT, never by measuring the cards. 'rendered' fires at
  // the START of the card animation, so a card's rect is still its old one at
  // this moment — anchoring to it leaves every label a move out of date. This is
  // the same derivation rendering.js uses for its own pile scores: the pile's
  // height from the card count, then playPileTop to centre it in the section.
  const layout   = computeLayout();
  const cardH    = layout.cardH;
  const slotPad  = layout.slotPad;
  const sectionH = layout.sectionHeights.play_row;
  const cs       = getComputedStyle(document.documentElement);
  const scoreLineH = Math.round(parseFloat(cs.getPropertyValue('--text-body')) *
                                parseFloat(cs.getPropertyValue('--leading'))) || 14;

  let html = '';
  for (const [slot, secId, who] of [[userSlot, 'play_user', 'my'], [oppSlot, 'play_opp', 'opp']]){
    const row = document.getElementById(secId);
    if (!row) continue;
    const rowRect = row.getBoundingClientRect();
    const sectionTop = rowRect.top - boardRect.top;
    const cols = row.querySelectorAll('.card-col');

    CONFIG.colors.forEach((color, ci) => {
      const col = cols[ci];
      if (!col) return;

      const pile = getCards(gameState, 'playPiles', slot, color);
      const isExp = spreadPile && spreadPile.who === who && spreadPile.color === color;
      const off = pile.length > 0
        ? (isExp ? expandedFanOffset(pile.length, cardH) : Math.round(MATH.stackOffset(pile.length, cardH)))
        : 0;
      const pileH = pile.length > 0 ? cardH + (pile.length - 1) * off : cardH;
      let bottom = playPileTop(pileH, slotPad, sectionH) + slotPad/2 + pileH;

      // The opponent's pile score is drawn BELOW their pile (the user's sits
      // above theirs), so clear it on that side — otherwise the two numbers
      // land on each other. _pileScores carries the score's exact y.
      if (typeof _pileScores !== 'undefined'){
        const sc = _pileScores.find(s => s.id === who + '-' + color);
        if (sc && sc.pos === 'below') bottom = Math.max(bottom, sc.top + scoreLineH);
      }

      const colRect = col.getBoundingClientRect();
      const cx  = colRect.left + colRect.width/2 - boardRect.left;
      const pot = labColorPotential(slot, color);
      const cls = pot > 0 ? 'pos' : pot < 0 ? 'neg' : 'zero';
      html += '<div class="lab-pot ' + cls + '" style="left:' + cx + 'px;top:' + (sectionTop + bottom) + 'px">'
            + (pot > 0 ? '+' : '') + pot + '</div>';
    });
  }
  layer.innerHTML = html;
}

on('rendered', _labRenderPotential);

/* ============================================================================
   EMPTY SLOT COLOURS

   An empty pile is a neutral felt well: nothing on the board says which colour
   it belongs to. That is fine once the column order is in your fingers and a
   nuisance before then — and it bites hardest exactly where it matters, on a
   colour you hold nothing of. So every EMPTY slot is ringed and tinted in its
   own colour. Occupied slots are left alone: the cards sitting on them already
   answer the question, and ten coloured rings on a full board is noise.

   Applies to both play rows and the discard row. The draw pile and the live-
   score column are not colours, and are skipped by looping over CONFIG.colors
   (they are the trailing columns in their rows).

   Re-applied on every 'rendered', because renderBoardStructure rewrites those
   rows' innerHTML and throws away anything we set — the same reason the
   potential layer redraws rather than persisting.
   ========================================================================== */
function _labColorEmptySlots(){
  if (!gameState) return;
  const oppSlot = userSlot === 'player1' ? 'player2' : 'player1';
  const rows = [
    ['play_user',    color => getCards(gameState, 'playPiles', userSlot, color)],
    ['play_opp',     color => getCards(gameState, 'playPiles', oppSlot,  color)],
    ['discard_draw', color => getCards(gameState, 'discards', color)],
  ];

  for (const [rowId, cardsOf] of rows){
    const row = document.getElementById(rowId);
    if (!row) continue;
    const cols = row.querySelectorAll('.card-col');
    CONFIG.colors.forEach((color, ci) => {
      const slot = cols[ci] && cols[ci].querySelector('.pile-space');
      if (!slot) return;
      const hex = CONFIG.colorHex[color];
      if (!hex || cardsOf(color).length > 0){
        slot.style.outline = ''; slot.style.outlineOffset = ''; slot.style.backgroundColor = '';
        return;
      }
      // outline, not border or box-shadow: the well's sunken felt look IS a stack
      // of inset shadows, and its size comes from the card metrics — an outline
      // disturbs neither, and a negative offset pulls the ring inside the well's
      // own edge so it never bleeds into the next column.
      slot.style.outline = 'calc(var(--border-w) * 2) solid ' + hex;
      slot.style.outlineOffset = 'calc(var(--border-w) * -2)';
      // A wash rather than a fill: enough to read peripherally, dark enough that
      // the felt texture over it still shows and an empty slot still looks empty.
      slot.style.backgroundColor = 'color-mix(in srgb, ' + hex + ' 16%, var(--felt-base))';
    });
  }
}

on('rendered', _labColorEmptySlots);

/* ============================================================================
   PROJECTED TURNS

   How many more times a player gets to PLAY a card, if every draw for the rest
   of the game comes from the deck.

   A turn is play-then-draw and the game ends the moment the draw pile empties,
   so each remaining turn burns exactly one deck card: D cards left means D
   turns left in total, split between the two players. A draw taken from a
   discard pile instead leaves the deck untouched and stretches the game by a
   turn — which is exactly why this is *projected* and not *remaining*.

   Counting, from the player to move: their draw is the 1st of the D, the other
   player's is the 2nd, and so on alternately. Every one of those draws has a
   play in front of it except possibly the current one — if the player to move
   has already played this turn (phase 'draw'), their next play is a full round
   away.
   ========================================================================== */
function labProjectedTurns(slot){
  if (!gameState) return 0;
  const D = getCards(gameState, 'drawPile').length;
  if (D <= 0) return 0;
  const toMove = gameState.currentTurn;
  const playsForMover = (gameState.phase === 'play' ? 1 : 0) + Math.floor((D - 1) / 2);
  const playsForOther = Math.floor(D / 2);
  return slot === toMove ? playsForMover : playsForOther;
}

/* ============================================================================
   REACHABLE POTENTIAL, and what a colour still needs

   Potential answers "how far could this colour go", and answers it as if you
   had all the time in the world. You do not: the deck is a clock, and a colour
   needing six more cards with three plays left is not worth what potential says
   it is. REACHABLE potential is the same rule under your actual turn budget,
   and it is the number a decision late in the game should be made against.

   The gap between the two IS the time pressure, made visible.

   ⚠️ Reachable can come out ABOVE potential in one odd case, and it is not a
   bug: potential plays every wager it can, and on a colour whose numbers cannot
   clear the 20, wagers multiply a loss. Under a budget the wagers are optional,
   so it declines them. Where that happens, potential is being pessimistic about
   a colour you would never play that way.
   ========================================================================== */
function labReachablePotential(slot, color){
  return venturePotential(_labPileOf(slot, color), _labPoolOf(slot, color),
                          labProjectedTurns(slot));
}

/* Points of NUMBER cards a colour still needs before it is worth anything —
   the "-20 to break even" every strategy discussion turns on. Zero once the
   venture is in profit; null when the colour has not been started, since there
   is nothing to break even on yet. */
function labBreakEvenGap(slot, color){
  const pile = _labPileOf(slot, color);
  if (!pile.length) return null;
  let sum = 0;
  for (const c of pile) sum += c.value;
  return Math.max(0, (CONFIG.scoring ? CONFIG.scoring.baseCost : 20) - sum);
}

/* Cards in your hand that your own play piles have already climbed past. They
   can never be played again, so throwing one away costs you nothing — which
   makes them the currency of patience: while you hold one, you never have to
   make a play that locks out your own low cards (STRATEGY.md §2.6). The
   Patient's whole edge is spending these instead of playing badly. */
function labDeadCards(slot){
  const hand = getCards(gameState, 'hands', slot);
  let n = 0;
  for (const c of hand) if (!canPlayOnPlayPile(c, _labPileOf(slot, c.color))) n++;
  return n;
}

function _labPileOf(slot, color){ return getCards(gameState, 'playPiles', slot, color); }

function _labPoolOf(slot, color){
  return []
    .concat(getCards(gameState, 'drawPile'))
    .concat(getCards(gameState, 'hands', slot))
    .concat(getCards(gameState, 'discards', color))
    .filter(c => c.color === color);
}

/* ============================================================================
   THE INFO PANEL — a readout column down the left

   Entries are declared here rather than in the markup, so adding one later is
   an object in this list: a label, the one line of explanation that stops the
   number being a mystery, and either a `value()` for a single number or a
   `table()` for a row per colour. Both are called on every render.
   ========================================================================== */
const LAB_INFO = [
  {
    key:   'projected-turns',
    label: 'Projected turns',
    help:  'plays you have left, if every draw from here comes from the deck',
    value: () => labProjectedTurns(userSlot),
  },
  {
    key:   'dead-cards',
    label: 'Free discards',
    help:  'cards your own piles have climbed past. They cost nothing to throw, '
         + 'so while you hold one you never have to make a play that locks out '
         + 'your own low cards.',
    value: () => labDeadCards(userSlot),
  },
  {
    key:   'reachable',
    label: 'Reachable',
    help:  'the most each colour can still be worth in the turns you have left. '
         + 'The board shows potential; this is potential you have time for.',
    table: () => ({
      head: ['', 'reach'],
      rows: CONFIG.colors.map(c => [c, _labNum(labReachablePotential(userSlot, c))]),
    }),
  },
  {
    key:   'break-even',
    label: 'To break even',
    help:  'number-card points a started venture still needs to clear its −20. '
         + '“—” means the colour is unstarted, or already in profit.',
    table: () => ({
      head: ['', 'need'],
      rows: CONFIG.colors.map(c => {
        const g = labBreakEvenGap(userSlot, c);
        return [c, g === null || g === 0 ? '—' : String(g)];
      }),
    }),
  },
];

function _labNum(n){ return (n > 0 ? '+' : '') + n; }

let _infoEl = null;

function _labInfoPanel(){
  if (!_infoEl){
    _infoEl = document.createElement('div');
    _infoEl.id = 'lab-info';
    _infoEl.innerHTML = '<h2>INFO</h2><div id="lab-info-rows"></div>';
    document.body.appendChild(_infoEl);
  }
  if (!gameState) return;
  const rows = _infoEl.querySelector('#lab-info-rows');
  rows.innerHTML = LAB_INFO.map(item => {
    let body;
    // An entry that throws must not take the board's render down with it.
    try { body = item.table ? _labInfoTable(item.table()) : '<span class="v">' + item.value() + '</span>'; }
    catch (e){ body = '<span class="v">—</span>'; }
    return '<div class="lab-info-row" data-key="' + item.key + '">'
         + '<span class="k">' + item.label + '</span>'
         + body
         + (item.help ? '<span class="h">' + item.help + '</span>' : '')
         + '</div>';
  }).join('');
}

/* A per-colour block: each colour's name written in its own colour, then its
   numbers. The colour is carried by the label rather than a swatch, so the
   panel reads the same way the deck columns do. */
function _labInfoTable(t){
  const head = '<tr>' + t.head.map(h => '<th>' + h + '</th>').join('') + '</tr>';
  const body = t.rows.map(r => {
    const color = r[0];
    const hex = (CONFIG.colorHex && CONFIG.colorHex[color]) || '#888';
    const name = (CONFIG.colorLabels && CONFIG.colorLabels[color]) || color;
    return '<tr><td class="c" style="color:' + hex + '">' + name + '</td>'
         + r.slice(1).map(v => '<td class="n">' + v + '</td>').join('') + '</tr>';
  }).join('');
  return '<table class="lab-info-t">' + head + body + '</table>';
}

/* The same number beside the draw pile, on its own — you read it while looking
   at the board, and by then you know what it is.

   Positioned off the draw pile's empty SLOT, not off the cards: 'rendered'
   fires at the start of the card animation, so a card's rect is still its old
   one (the same trap the potential layer documents). The slot is plain markup
   and is already where it will be. */
function _labTurnsBesideDeck(){
  const board = document.querySelector('.board-area');
  if (!board) return;
  let layer = document.getElementById('lab-turns-layer');
  if (!layer){
    layer = document.createElement('div');
    layer.id = 'lab-turns-layer';
    board.appendChild(layer);
  }
  const row = document.getElementById('discard_draw');
  const cols = row ? row.querySelectorAll('.card-col') : [];
  const drawCol = cols[cols.length - 1];              // draw pile is always last
  const slot = drawCol && drawCol.querySelector('.pile-space, .card');
  if (!gameState || !slot){ layer.innerHTML = ''; return; }

  const boardRect = board.getBoundingClientRect();
  const r = slot.getBoundingClientRect();
  const gap = 6;
  const cy = r.top + r.height / 2 - boardRect.top;
  // Outside the pile on the right if the board has room there, otherwise on its
  // left — at the narrow end of the window the draw column sits hard against
  // the board edge and a right-hand label would be half off it.
  const roomRight = boardRect.right - r.right;
  const html = roomRight >= 26
    ? '<div class="lab-turns" style="left:' + (r.right + gap - boardRect.left) + 'px;top:' + cy + 'px">'
    : '<div class="lab-turns" style="left:' + (r.left - gap - boardRect.left) + 'px;top:' + cy + 'px;transform:translate(-100%,-50%)">';
  layer.innerHTML = html + labProjectedTurns(userSlot) + '</div>';
}

/* ============================================================================
   THE VENTURE ASSISTANT

   A venture only ascends, so of the cards you hold in one colour, playing any
   but the LOWEST locks the rest out for good. With the assistant on, those
   higher cards are greyed and cannot be picked up — the move is still there to
   be made, just not by accident.

   THE EXCEPTION — and it is the whole reason this needs a number rather than a
   rule of thumb: holding back only pays if you will actually get to play them
   all. Once a colour has more playable cards in hand than you have projected
   turns, you cannot get them all down whatever you do, so the ascending rule
   stops being free and starts being a choice between them (the high ones score
   more; the low ones keep the run alive). The assistant has no business making
   that trade for you, so it lets the whole colour go.

   Cards that CANNOT legally join the venture — the pile has already climbed
   past them — are never blocked. Their only remaining use is to be discarded,
   and blocking a discard could leave you with no legal move at all.
   ========================================================================== */
function _labAssistBlocked(){
  const out = new Set();
  if (!LAB.assist || !gameState || !gameState.hands) return out;
  const hand  = getCards(gameState, 'hands', userSlot);
  const turns = labProjectedTurns(userSlot);
  for (const color of CONFIG.colors){
    const pile = getCards(gameState, 'playPiles', userSlot, color);
    const live = hand.filter(c => c.color === color && canPlayOnPlayPile(c, pile))
                     .sort((a, b) => a.value - b.value);
    if (live.length < 2) continue;          // nothing to hold back behind
    if (turns < live.length) continue;      // the exception: not enough turns anyway
    // Strictly higher, so the three wagers of a colour (all value 0) never
    // block each other — and they are the lowest cards there are, which is the
    // wagers-before-numbers rule falling out rather than being written in.
    for (const c of live) if (c.value > live[0].value) out.add(c.id);
  }
  return out;
}

function _labApplyAssist(){
  if (!gameState || !gameState.hands) return;
  const blocked = _labAssistBlocked();
  for (const c of getCards(gameState, 'hands', userSlot)){
    const el = document.querySelector('[data-card-id="' + c.id + '"]');
    if (el) el.classList.toggle('lab-blocked', blocked.has(c.id));
  }
}

on('rendered', () => { _labInfoPanel(); _labTurnsBesideDeck(); _labApplyAssist(); });

/* ============================================================================
   THE DECK PANEL — draw pile as COLOUR COLUMNS on the right

   A port of the xray panel from the cheat toolkit (cheats.js `_xrayUpdate`),
   which is how this was built for the live site. The board's own draw pile is
   left alone (face-down, as the game draws it); the whole order is read off
   this panel instead.

   One column per colour, one grid ROW per draw position, top = next draw. A
   card sits in its colour's column at its depth row, so the EMPTY cells are
   the information: a gap in the red column at row 7 means some other colour
   fills that spot in the sequence. Rows are shorter than a card so the whole
   deck fits without scrolling — cards overlap, and each card's number is
   pinned to its TOP strip so the overlap never hides it. Deeper cards paint on
   top, for the same reason.
   ========================================================================== */

let _deckEl = null, _deckSig = '', _labCS = null;

/* Measure a real card once — the panel uses the game's own card size so the
   columns match the board. */
function _labCardSize(){
  if (_labCS && _labCS.w > 0) return _labCS;
  const t = document.createElement('div');
  t.className = 'card color-red';
  t.style.cssText = 'position:absolute;visibility:hidden;left:-9999px';
  document.body.appendChild(t);
  const w = t.offsetWidth, h = t.offsetHeight;
  t.remove();
  _labCS = { w: w || 51, h: h || 83 };
  return _labCS;
}

/* A deck card: the game's own card art, with the number/wager pinned to a top
   strip `labelH` tall — the strip is the part the vertical overlap leaves
   visible. */
function _labDeckFace(card, labelH){
  const isW = card.value === 0;
  const el = document.createElement('div');
  el.className = 'card color-' + card.color + (isW ? ' wager' : '');
  el.style.position = 'relative';
  el.style.pointerEvents = 'none';
  el.style.cursor = 'default';
  const fs = Math.max(9, Math.min(labelH * 0.82, _labCardSize().h * 0.32));
  const lab = document.createElement('div');
  lab.innerHTML = isW ? WAGER_ICON : card.value;
  lab.style.cssText = 'position:absolute;top:0;left:0;right:0;height:' + labelH + 'px;z-index:2;'
    + 'display:flex;align-items:center;justify-content:center;'
    + "font:700 " + fs + "px 'Cinzel',serif;color:#fff;"
    + 'text-shadow:0 1px 2px rgba(0,0,0,.95),0 0 3px rgba(0,0,0,.7)';
  if (isW){ const s = lab.querySelector('svg'); if (s){ s.style.height = fs + 'px'; s.style.width = 'auto'; } }
  el.appendChild(lab);
  return el;
}

function _labDeckPanel(){
  if (!LAB.revealDeck){
    if (_deckEl){ _deckEl.style.display = 'none'; }
    _deckSig = '';
    return;
  }
  if (!_deckEl){
    _deckEl = document.createElement('div');
    _deckEl.id = 'vc-deck';
    _deckEl.innerHTML =
      '<div id="vc-deck-head"><b id="vc-deck-h"></b></div><div id="vc-deck-list"></div>';
    document.body.appendChild(_deckEl);
  }
  _deckEl.style.display = '';
  if (!gameState) return;

  const draw  = getCards(gameState, 'drawPile').filter(Boolean);
  const order = draw.slice().reverse();              // index 0 = next card drawn

  // Turn and phase are in the signature because pick draw wires click handlers
  // onto the cards: playing a card does not change the deck's ORDER, so an
  // order-only signature would leave the panel unbuilt exactly when your draw
  // arrives, and nothing would be clickable.
  const canPick = LAB.pickDraw && gameState.currentTurn === userSlot && gameState.phase === 'draw';
  const sig = order.map(c => c.id).join(',') + '|' + gameState.currentTurn + gameState.phase
            + (LAB.pickDraw ? 'P' : '');
  if (sig === _deckSig) return;                      // nothing changed — don't rebuild
  _deckSig = sig;

  _deckEl.querySelector('#vc-deck-h').textContent =
    canPick ? 'DECK — ' + draw.length + ' left   (click a card to draw it)'
            : 'DECK — ' + draw.length + ' left   (top = next draw ↓)';

  const list = _deckEl.querySelector('#vc-deck-list');
  list.innerHTML = '';

  const colors = CONFIG.colors;
  const nc = colors.length;
  const { w: cw, h: ch } = _labCardSize();
  const gapX = 8;

  // Fit the columns to the panel with a uniform zoom (never upscale).
  const innerW = _deckEl.clientWidth - 22;
  const zoom = Math.max(0.4, Math.min(1, innerW / (nc * cw + (nc - 1) * gapX)));

  // Shrink each depth-row below one card tall so the WHOLE deck fits the panel
  // height without scrolling. 14px floor keeps the pinned number legible.
  const headerH = 22;
  const headEl = _deckEl.querySelector('#vc-deck-head');
  const availH = Math.max(140, _deckEl.clientHeight - (headEl ? headEl.offsetHeight : 24) - 12);
  const nRows = order.length;
  let rowH = ch;
  if (nRows > 1){
    const fit = (availH / zoom - ch - headerH) / (nRows - 1);
    rowH = Math.max(14, Math.min(ch, fit));
  }
  const labelH = Math.max(14, Math.min(rowH, ch));

  list.style.display = 'grid';
  list.style.gridTemplateColumns = 'repeat(' + nc + ', ' + cw + 'px)';
  list.style.gridTemplateRows = 'auto';              // row 1 = headers, sized to content
  list.style.gridAutoRows = rowH + 'px';             // < card height ⇒ cards overlap
  list.style.columnGap = gapX + 'px';
  list.style.rowGap = '0px';
  list.style.justifyContent = 'center';
  list.style.justifyItems = 'center';
  list.style.alignItems = 'start';
  list.style.zoom = String(zoom);

  // Column headers — a coloured label per colour so the columns read at a glance.
  colors.forEach((col, ci) => {
    const h = document.createElement('div');
    h.textContent = CONFIG.colorLabels[col] || col;
    h.style.cssText = 'grid-column:' + (ci + 1) + ';grid-row:1;align-self:center;text-align:center;'
      + 'width:100%;font:700 11px monospace;color:#fff;border-radius:4px;padding:1px 0;margin-bottom:3px;'
      + 'background:' + (CONFIG.colorHex[col] || '#888');
    list.appendChild(h);
  });

  // Column = colour, row = depth. Deeper cards sit ON TOP so each card's top
  // strip (which holds its number) is what the overlap leaves showing.
  order.forEach((c, i) => {
    const ci = colors.indexOf(c.color);
    const f = _labDeckFace(c, labelH);
    f.style.gridColumn = String((ci < 0 ? 0 : ci) + 1);
    f.style.gridRow = String(i + 2);                 // +2: row 1 holds the headers
    f.style.zIndex = String(i + 1);                  // deeper cards on top
    if (i === 0){                                    // the NEXT draw
      f.style.outline = '3px solid #ffd700';
      f.style.outlineOffset = '-1px';
      const tag = document.createElement('div');
      tag.textContent = 'NEXT';
      tag.style.cssText = 'position:absolute;top:-3px;right:-2px;z-index:4;'
        + 'font:700 8px monospace;color:#1a0f0a;background:#ffd700;padding:0 3px;border-radius:3px';
      f.appendChild(tag);
    }
    // Pick draw: on your own draw, the deck's cards become the buttons.
    if (canPick){
      f.style.pointerEvents = 'auto';
      f.style.cursor = 'pointer';
      f.title = 'draw this card';
      f.addEventListener('mouseenter', () => { f.style.filter = 'brightness(1.35)'; });
      f.addEventListener('mouseleave', () => { f.style.filter = ''; });
      f.addEventListener('click', () => labPickDraw(c.id));
    }
    list.appendChild(f);
  });
}

on('rendered', _labDeckPanel);

/* ============================================================================
   PICK DRAW — take any card in the deck, not just the top

   The same ability as on the live site (the toolkit's `pickdraw`), and it works
   the same way: move the chosen card to the deck's POP position, then let the
   game's own draw run. Nothing here reimplements drawing — `drawFromDrawPile`
   pops the last element, so putting your card there and calling it means the
   normal path does the work, with the normal animation, sound, turn handoff and
   end-of-game check. The rest of the deck keeps its order.

   Off by default: a lab where every draw is chosen is a different game, and the
   point of the deck panel is usually to study the order you are actually dealt.
   ========================================================================== */
async function labPickDraw(cardId){
  if (!LAB.pickDraw || !gameState) return false;
  if (gameState.currentTurn !== userSlot){ _labFlash('Not your turn'); return false; }
  if (gameState.phase !== 'draw'){ _labFlash('Play or discard first, then pick your draw'); return false; }
  const deck = gameState.drawPile || [];
  const idx = deck.findIndex(c => c && c.id === cardId);
  if (idx < 0) return false;
  const card = deck.splice(idx, 1)[0];
  deck.push(card);                       // the pop position — the game draws THIS one
  _deckSig = '';                         // the order changed; force a rebuild
  await drawFromDrawPile();
  return true;
}

/* ============================================================================
   GAME SETUP / TEARDOWN
   ========================================================================== */

function newLabGame(){
  selectedCard = null;
  lastPlayedCard = null;
  spreadPile = null;
  _labAIBusy = false;

  gameState = ENGINE.initGame(variant, false);
  gameState.currentTurn = Math.random() < 0.5 ? 'player1' : 'player2';

  createCardPool();
  document.getElementById('lab-result').classList.remove('on');
  emit('newGame');
  renderGame();
  if (gameState.currentTurn !== userSlot) _labAITurn();
}

function _labGameOver(){
  const oppSlot = userSlot === 'player1' ? 'player2' : 'player1';
  const my  = MATH.scoreBreakdown(gameState.playPiles[userSlot]).total;
  const opp = MATH.scoreBreakdown(gameState.playPiles[oppSlot]).total;
  const el = document.getElementById('lab-result');
  el.textContent = my > opp ? ('You win ' + my + ' – ' + opp)
                 : opp > my ? ('Opponent wins ' + opp + ' – ' + my)
                 : ('Tie ' + my + ' – ' + opp);
  el.classList.add('on');
  if (my > opp) SFX.win(); else SFX.gameOver();
  renderGame();
}

/* ------------------------------------------------------------- lab controls */

/* Show/hide the deck panel. The panel occupies a real strip down the right, so
   the board has to be re-solved for the narrower viewport — LAB.rightInset is
   what layout.js subtracts, and #game-screen's padding-right matches it, so the
   board never runs underneath the panel. */
function _labSetDeckPanel(on){
  LAB.revealDeck = !!on;
  const w = LAB.revealDeck ? _labDeckPanelWidth() : 0;
  LAB.rightInset = w;
  document.getElementById('game-screen').style.paddingRight = w + 'px';
  if (_deckEl) _deckEl.style.width = Math.max(0, w - 8) + 'px';
  _deckSig = '';                       // geometry changed — force a rebuild
  computeLayout._vw = null;            // invalidate the layout cache
  renderGame._snapNextRender = true;
  _labSyncToggles();
  renderGame();
}

/* Wide enough for one card per colour plus gaps, capped so it never eats more
   than a third of a narrow window (the zoom in _labDeckPanel takes up any
   slack below that). */
function _labDeckPanelWidth(){
  const { w: cw } = _labCardSize();
  const nc = CONFIG.colors.length;
  const want = nc * cw + (nc - 1) * 8 + 30;
  return Math.round(Math.max(150, Math.min(want, window.innerWidth / 3)));
}

function _labSyncToggles(){
  const set = (id, on) => {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('on', !!on);
  };
  set('lab-deck', LAB.revealDeck);
  set('lab-opp',  LAB.revealOpp);
  set('lab-pot',  LAB.potential);
  set('lab-assist', LAB.assist);
  set('lab-pick',   LAB.pickDraw);
}

/* The info panel is permanent chrome down the left, so — exactly like the deck
   panel on the right — the board has to be solved for the width it actually
   gets. LAB.leftInset is what layout.js subtracts; #game-screen's padding-left
   matches it, so the board never runs underneath the panel. */
const LAB_INFO_W = 170;                 // == #lab-info width in index.html
function _labSetInfoInset(){
  LAB.leftInset = LAB_INFO_W + 8;       // + the panel's 4px offset each side
  document.getElementById('game-screen').style.paddingLeft = LAB.leftInset + 'px';
  computeLayout._vw = null;             // invalidate the layout cache
  renderGame._snapNextRender = true;
}

function _labSetAssist(on){
  LAB.assist = !!on;
  // A card selected before the assistant came on may be one it now rules out;
  // leaving it selected would let the block be walked straight through.
  if (LAB.assist && selectedCard && _labAssistBlocked().has(selectedCard.id)) selectedCard = null;
  _labSyncToggles();
  renderGame();
}

function _labInit(){
  // Identity: the lab is always player1, always a local game. isAIGame keeps
  // the render stack off every multiplayer path.
  myId = 'lab';
  userSlot = 'player1';
  isAIGame = true;
  variant = 'classic';
  roomRef = null;
  document.getElementById('opponent-name-store').textContent = 'Opponent';

  document.getElementById('lab-new').onclick   = () => { SFX.select(); newLabGame(); };
  document.getElementById('lab-deck').onclick  = () => { SFX.select(); _labSetDeckPanel(!LAB.revealDeck); };
  document.getElementById('lab-opp').onclick   = () => { LAB.revealOpp  = !LAB.revealOpp;  _labSyncToggles(); renderGame(); };
  document.getElementById('lab-pot').onclick   = () => { LAB.potential  = !LAB.potential;  _labSyncToggles(); renderGame(); };
  document.getElementById('lab-assist').onclick = () => { SFX.select(); _labSetAssist(!LAB.assist); };
  document.getElementById('lab-pick').onclick  = () => {
    SFX.select();
    LAB.pickDraw = !LAB.pickDraw;
    // Picking is done ON the deck panel, so it has to be open to use it.
    if (LAB.pickDraw && !LAB.revealDeck) _labSetDeckPanel(true);
    _deckSig = '';                      // the cards need their click handlers now
    _labSyncToggles();
    renderGame();
  };
  document.getElementById('lab-ai').onchange   = (e) => { LAB.ai = e.target.value; };

  _labSetInfoInset();                 // reserves the left strip for the info panel
  _labSetDeckPanel(LAB.revealDeck);   // reserves the strip and sizes the board for it
  _labSyncToggles();
  newLabGame();

  // The board is sized from the viewport — re-render on resize, as the real
  // client does (renderGame._snapNextRender makes it snap rather than glide).
  window.addEventListener('resize', () => {
    // The reserved strip is derived from the card size, which is derived from
    // the viewport — so a resize has to re-reserve before the board re-solves.
    _labCS = null;
    if (LAB.revealDeck) _labSetDeckPanel(true);
    else { renderGame._snapNextRender = true; renderGame(); }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _labInit);
else _labInit();
