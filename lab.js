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
   player received EVERY card still in play that could legally be added to it.

   "Still in play" = the draw pile + both players' hands. Cards already played
   (either side) or sitting in a discard pile are excluded: a played card is
   gone for good, and a discarded one is only reachable as a pile top under
   conditions, so counting it would overstate the ceiling.

   The legal additions are forced by the rules, so there is nothing to search:
   a venture ascends, so every number above the pile's top can be added (values
   are unique per colour), and wagers can only be added while the pile has no
   numbers yet.
   ========================================================================== */

/* The rule itself, as a pure function of a pile and the cards still available
   to it. Shared with the computers in computers.js, so "potential" means one
   thing across the whole site and is defined in exactly one place. */
function venturePotential(pile, pool){
  const hasNumbers = pile.some(c => c.value > 0);
  const topValue = hasNumbers ? pile[pile.length - 1].value : 0;

  const additions = [];
  if (!hasNumbers){                                    // wagers precede all numbers
    for (const c of pool) if (c.value === 0) additions.push(c);
  }
  for (const c of pool) if (c.value > topValue) additions.push(c);
  additions.sort((a, b) => a.value - b.value);

  return MATH.scorePlayPile(pile.concat(additions));
}

function labColorPotential(slot, color){
  const pile = getCards(gameState, 'playPiles', slot, color);
  const pool = []
    .concat(getCards(gameState, 'drawPile'))
    .concat(getCards(gameState, 'hands', 'player1'))
    .concat(getCards(gameState, 'hands', 'player2'))
    .filter(c => c.color === color);
  return venturePotential(pile, pool);
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

  const sig = order.map(c => c.id).join(',');
  if (sig === _deckSig) return;                      // nothing changed — don't rebuild
  _deckSig = sig;

  _deckEl.querySelector('#vc-deck-h').textContent =
    'DECK — ' + draw.length + ' left   (top = next draw ↓)';

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
    list.appendChild(f);
  });
}

on('rendered', _labDeckPanel);

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
  document.getElementById('lab-ai').onchange   = (e) => { LAB.ai = e.target.value; };

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
