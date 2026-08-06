// engine.js — Pure game state mutations.
// Takes state + params, mutates state, emits events.
// No rendering, no sound, no animation, no Firebase.


function playCard(state, player, card, color) {
  if (card.color !== color) return { success: false, reason: 'wrong color' };
  const playPile = getCards(state, 'playPiles', player, color);
  if (!canPlayOnPlayPile(card, playPile)) {
    return { success: false, reason: 'illegal play' };
  }
  // Mutate state
  state.hands[player] = state.hands[player].filter(c => c.id !== card.id);
  if (!state.playPiles[player][color]) state.playPiles[player][color] = [];
  state.playPiles[player][color].push(card);
  state.lastDiscardTarget = null;
  state.justDiscarded = false;
  state.moveNumber++;
  _transitionToDrawOrFinish(state, player);
  emit('cardPlayed', { player, card, color });
  return { success: true };
}

function discardCard(state, player, card, color) {
  state.hands[player] = state.hands[player].filter(c => c.id !== card.id);
  if (!state.discards[color]) state.discards[color] = [];
  state.discards[color].push(card);
  state.lastDiscardTarget = color;
  state.moveNumber++;
  _transitionToDrawOrFinish(state, player);
  emit('cardDiscarded', { player, card, color });
  return { success: true };
}

function discardToSingle(state, player, card) {
  state.hands[player] = state.hands[player].filter(c => c.id !== card.id);
  if (!state.singlePile) state.singlePile = [];
  state.singlePile.push(card);
  state.lastDiscardTarget = 'single';
  state.justDiscarded = true;
  state.moveNumber++;
  _transitionToDrawOrFinish(state, player);
  emit('cardDiscarded', { player, card, color: card.color, pile: 'single' });
  return { success: true };
}

// After play/discard: enter draw phase.
function _transitionToDrawOrFinish(state, player) {
  state.phase = 'draw';
}

function _finishDraw(state, player, card, source) {
  const opp = player === 'player1' ? 'player2' : 'player1';
  state.hands[player].push(card);
  state.currentTurn = opp;
  state.phase = 'play';
  state.lastDiscardTarget = null; // Clear after successful draw
  state.moveNumber++; // Increment for race condition protection
  if (state.drawPile.length === 0) {
    state.status = 'finished';
  }

  emit('cardDrawn', { player, card, source });
  emit('turnChanged', { newTurn: opp, gamePhase: state.phase, player });
  return { success: true, card };
}

function drawFromDeck(state, player) {
  if (!state.drawPile || state.drawPile.length === 0) {
    return { success: false, reason: 'deck empty' };
  }
  const card = state.drawPile.pop();
  return _finishDraw(state, player, card, 'deck');
}

function drawFromDiscard(state, player, color) {
  const pile = getCards(state, 'discards', color);
  if (pile.length === 0) return { success: false, reason: 'pile empty' };
  if (state.lastDiscardTarget === color) {
    return { success: false, reason: 'cannot draw from just-discarded pile' };
  }
  const card = pile.pop();
  return _finishDraw(state, player, card, 'discard');
}

function drawFromSingle(state, player) {
  const pile = state.singlePile || [];
  if (pile.length === 0) return { success: false, reason: 'pile empty' };
  if (state.lastDiscardTarget === 'single' || state.justDiscarded) {
    return { success: false, reason: 'cannot draw from just-discarded pile' };
  }
  const card = pile.pop();
  return _finishDraw(state, player, card, 'single');
}

function initGame(variant, animated = false) {
  const drawPile = createDrawPile();
  
  let hand1, hand2;
  if (animated) {
    // For animated dealing: start with empty hands, full deck
    hand1 = [];
    hand2 = [];
  } else {
    // Current behavior: instant deal
    hand1 = drawPile.splice(0, CONFIG.handSize);
    hand2 = drawPile.splice(0, CONFIG.handSize);
  }
  
  const exps1 = {}, exps2 = {}, discards = {};
  CONFIG.colors.forEach(c => {
    exps1[c] = [];
    exps2[c] = [];
    discards[c] = [];
  });
  const state = {
    drawPile,
    hands: { player1: hand1, player2: hand2 },
    playPiles: { player1: exps1, player2: exps2 },
    currentTurn: 'player1',
    phase: 'play',
    status: 'playing',
    lastDiscardTarget: null, // Unified: tracks which pile was discarded to (color string or 'single')
    moveNumber: 0, // Race condition protection for undo
  };
  if (useSinglePile()) {
    state.singlePile = [];
  } else {
    state.discards = discards;
  }
  return state;
}

// Deal all cards to both hands at once, then signal for a single render.
// With persistent card pool, cards animate from draw pile to hand simultaneously.
async function animatedDeal(state) {
  // Deal CONFIG.handSize cards to each player, alternating
  for (let i = 0; i < CONFIG.handSize; i++) {
    if (state.drawPile.length > 0) state.hands.player1.push(state.drawPile.pop());
    if (state.drawPile.length > 0) state.hands.player2.push(state.drawPile.pop());
  }
  emit('dealComplete');
}

function undo(state, lastAction) {
  if (!lastAction) return { success: false, reason: 'no action to undo' };
  const { type, card, color } = lastAction;
  const hand = getCards(state, 'hands', state.currentTurn);
  hand.push(card);
  if (type === 'play') {
    const exp = getCards(state, 'playPiles', state.currentTurn, color);
    exp.pop();
  } else if (type === 'discard') {
    const pile = getCards(state, 'discards', color);
    pile.pop();
  } else if (type === 'discardToSingle') {
    const pile = state.singlePile || [];
    pile.pop();
    state.singlePile = pile;
  } else {
    return { success: false, reason: 'unknown action type' };
  }
  state.phase = 'play';
  state.lastDiscardTarget = null;
  state.moveNumber++; // Increment for race condition protection
  return { success: true };
}

// A tiered (Dominion-style) undo is "fair" — the game stays ranked — only
// when it reverts the acting player's own play/discard that they have NOT yet
// drawn behind: it is still their turn, in the draw phase, so no opponent move
// and no hidden-card draw has intervened. Reverting a draw (you saw the card
// you pulled), or reaching back past the opponent's move / across turns, is
// "unfair": still allowed, but it flags the game unranked + no-achievements.
// Pure predicate so the ranked/unranked decision has one testable source.
function isUndoFair(entry, state, usrSlot) {
  if (!entry || !state) return false;
  return (entry.actionType === 'play' || entry.actionType === 'discard')
    && state.currentTurn === usrSlot
    && state.phase === 'draw';
}

// Pure transform for the multiplayer undo Firebase transaction: given the
// target rollback state (a snapshot from before the undoer's action) and the
// CURRENTLY committed state, produce the next state to write. moveNumber is
// bumped above the committed value so the monotonicity rule accepts it and the
// write serializes against a simultaneous opponent move; the game stays
// unranked (consent), and a single-use ('once') grant is consumed here.
function mpUndoNextState(target, cur, scope) {
  const next = JSON.parse(JSON.stringify(target));
  next.unranked = true;
  next.undoAllowed = (scope === 'once') ? null : ((cur && cur.undoAllowed) || scope);
  next.moveNumber = ((cur && cur.moveNumber) || 0) + 1;
  return next;
}

function applyReplayAction(state, action) {
  if (!action || !state) return { success: false, reason: 'missing state or action' };
  const { type, player, card, color } = action;

  if (type === 'play') {
    const hand = getCards(state, 'hands', player);
    const idx = hand.findIndex(c => c.id === card.id);
    if (idx === -1) return { success: false, reason: 'card not in hand' };
    const c = hand.splice(idx, 1)[0];
    const exp = getCards(state, 'playPiles', player, color);
    exp.push(c);
    state.phase = 'draw';
    state.lastDiscardTarget = null;
    
    // Emit phase change event (same player, different phase)
    emit('turnChanged', { newTurn: player, gamePhase: state.phase, player });
    
    return { success: true, gameOver: false };

  } else if (type === 'discard') {
    const hand = getCards(state, 'hands', player);
    const idx = hand.findIndex(c => c.id === card.id);
    if (idx === -1) return { success: false, reason: 'card not in hand' };
    const c = hand.splice(idx, 1)[0];
    if (action.source === 'single' || action.drawFrom === 'single') {
      const pile = state.singlePile || [];
      pile.push(c);
      state.singlePile = pile;
      state.lastDiscardTarget = 'single';
    } else {
      const pile = getCards(state, 'discards', color);
      pile.push(c);
      state.lastDiscardTarget = color;
    }
    state.phase = 'draw';
    
    // Emit phase change event (same player, different phase)
    emit('turnChanged', { newTurn: player, gamePhase: state.phase, player });
    
    return { success: true, gameOver: false };

  } else if (type === 'draw') {
    let drawn = null;
    const src = action.source || action.drawFrom;
    if (src === 'deck') {
      const drawPile = getCards(state, 'drawPile');
      const dpIdx = action.card ? drawPile.findIndex(c => c.id === action.card.id) : -1;
      if (dpIdx !== -1) {
        drawn = drawPile.splice(dpIdx, 1)[0];
      } else if (drawPile.length > 0) {
        drawn = drawPile.pop();
      }
      if (state.drawPile.length === 0) state.status = 'finished';
    } else if (src === 'discard') {
      const pile = getCards(state, 'discards', action.drawColor || (card && card.color) || color);
      if (pile.length > 0) drawn = pile.pop();
    } else if (src === 'single') {
      const pile = state.singlePile || [];
      if (pile.length > 0) {
        drawn = pile.pop();
        state.singlePile = pile;
      }
    }
    if (drawn) {
      const hand = getCards(state, 'hands', player);
      hand.push(drawn);
    }
    const opp = player === 'player1' ? 'player2' : 'player1';
    state.currentTurn = opp;
    state.phase = 'play';
    state.lastDiscardTarget = null;
    
    // Emit turn change event for turn notification system
    emit('turnChanged', { newTurn: opp, gamePhase: state.phase, player });
    
    const gameOver = state.status === 'finished';
    return { success: true, gameOver };

  } else {
    return { success: false, reason: 'unknown action type' };
  }
}

const ENGINE = { playCard, discardCard, discardToSingle, drawFromDeck, drawFromDiscard, drawFromSingle, initGame, animatedDeal, undo, applyReplayAction, isUndoFair, mpUndoNextState };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ENGINE;
}
