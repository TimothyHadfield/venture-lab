// playable-targets.js — Central playable target determination. Layer 1 (game logic).
// Single source of truth for what can be clicked/targeted in each game state.

// Central function to determine all playable targets based on game state
function determinePlayableTargets(gameState, selectedCard) {
  const isMyTurn = gameState.currentTurn === userSlot;
  const inPlayPhase = gameState.phase === 'play';
  const inDrawPhase = gameState.phase === 'draw';
  
  const targets = {
    origins: [],      // Things you can click to select/activate
    destinations: [], // Places selected cards can go  
    undo: []         // Undo targets
  };

  // Get config rules
  const phaseKey = inPlayPhase ? 'playPhase' : 'drawPhase';
  const turnKey = isMyTurn ? 'myTurn' : 'opponentTurn';
  const allowedOrigins = CONFIG.playableTargets[phaseKey][turnKey];

  // Origins (things you can click)
  allowedOrigins.forEach(originType => {
    switch (originType) {
      case 'hand-cards':
        // All cards in my hand are selectable
        const myHand = getCards(gameState, 'hands', userSlot);
        myHand.forEach(card => {
          targets.origins.push({
            type: 'hand-card',
            cardId: card.id,
            element: `card-${card.id}`
          });
        });
        break;
        
      case 'draw-pile':
        const drawPile = getCards(gameState, 'drawPile');
        if (drawPile.length > 0) {
          targets.origins.push({
            type: 'draw-pile',
            element: 'draw-pile'
          });
        }
        break;
        
      case 'discard-piles':
        // Drawable discards = any non-empty pile EXCEPT the one you just discarded
        // to. lastDiscardTarget is the canonical field the draw logic itself checks
        // (a colour in classic, 'single' in single-pile, cleared after a draw) — NOT
        // the phantom lastDiscardedColor, which was only ever null.
        if (useSinglePile()) {
          const pile = getCards(gameState, 'singlePile');
          if (pile.length > 0 && gameState.lastDiscardTarget !== 'single') {
            targets.origins.push({ type: 'discard-pile', color: null, element: 'single-pile' });
          }
        } else {
          CONFIG.colors.forEach(color => {
            const pile = getCards(gameState, 'discards', color);
            if (pile.length > 0 && gameState.lastDiscardTarget !== color) {
              targets.origins.push({ type: 'discard-pile', color: color, element: `discard-${color}` });
            }
          });
        }
        break;
        
      case 'pile-expansion':
        // Allow pile expansion during opponent turns
        if (!isMyTurn) {
          CONFIG.colors.forEach(color => {
            // Add both my piles and opponent piles as expandable
            ['my', 'opp'].forEach(who => {
              targets.origins.push({
                type: 'pile-expansion',
                who: who,
                color: color,
                element: `${who}-pile-${color}`
              });
            });
          });
        }
        break;
    }
  });

  // Destinations (where selected card can go)
  if (selectedCard && isMyTurn) {
    if (inPlayPhase) {
      // Can play to valid expedition or discard to matching color
      const myExpeditions = getCards(gameState, 'expeditions', userSlot);
      const expedition = myExpeditions[selectedCard.color] || [];
      
      // Check if card can be legally played to expedition
      if (canPlayCardToExpedition(selectedCard, expedition)) {
        targets.destinations.push({
          type: 'play-pile',
          color: selectedCard.color,
          element: `play-${selectedCard.color}`
        });
      }
      
      // Can always discard to matching color
      targets.destinations.push({
        type: 'discard-pile',
        color: selectedCard.color,
        element: useSinglePile() ? 'single-pile' : `discard-${selectedCard.color}`
      });
    }
  }

  // Undo targets
  const undoRules = CONFIG.playableTargets.undo;
  const canUndo = lastPlayedCard && 
                  (undoRules.availableIn === 'drawPhase' ? inDrawPhase : true) &&
                  (undoRules.requireMyTurn ? isMyTurn : true) &&
                  (!undoRules.disabledAfterDraw || !gameState.justDiscarded);
                  
  if (canUndo) {
    targets.undo.push({
      type: 'undo-card',
      cardId: lastPlayedCard.card.id,
      element: `card-${lastPlayedCard.card.id}`
    });
  }

  return targets;
}

// Helper function - check if card can be played to expedition
function canPlayCardToExpedition(card, expedition) {
  if (expedition.length === 0) return true; // Empty expedition
  
  const lastCard = expedition[expedition.length - 1];
  
  // Wagers (value 0) can only be played to empty expeditions or before number cards
  if (card.value === 0) {
    return expedition.length === 0 || expedition.every(c => c.value === 0);
  }
  
  // Number cards must be ascending and after wagers
  if (lastCard.value === 0) return true; // After wagers
  return card.value >= lastCard.value; // Ascending numbers
}

// Apply target classes/attributes to DOM elements (called from rendering layer)
function applyPlayableTargetStyles(targets) {
  // Clear existing targets
  document.querySelectorAll('.target').forEach(el => {
    el.classList.remove('target');
  });
  document.querySelectorAll('.undoable').forEach(el => {
    el.classList.remove('undoable');
  });
  
  // Apply origin targets (clickable)
  targets.origins.forEach(target => {
    const element = document.getElementById(target.element);
    if (element) {
      element.classList.add('target');
    }
  });
  
  // Apply destination targets (drop zones) - handled by ghost card system
  // (Ghost cards will be rendered by the rendering layer)
  
  // Apply undo targets
  targets.undo.forEach(target => {
    const element = document.querySelector(`[data-id="${target.cardId}"]`);
    if (element) {
      element.classList.add('undoable');
    }
  });
}