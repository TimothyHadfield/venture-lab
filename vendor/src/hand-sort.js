// hand-sort.js — Drag-and-drop hand reordering. Layer 4 (UI).
// Maintains manual sort order. Falls back to auto-sort (color then value) until first drag.

const handSort = (() => {
  let manualOrder = null; // array of card IDs, or null for auto-sort
  let autoSort = localStorage.getItem(CONFIG.storagePrefix + '-autoSort') !== 'false'; // on by default
  let dragState = null;
  let longPressTimer = null;
  let isDragging = false;
  let dragCardId = null; // card being dragged — used by rendering to leave its slot empty
  let cardDims = null;   // cached card width/height for flat positioning

  // Insert a new card next to the same-color card closest in value (rightmost wins on tie),
  // placed on the side that keeps values ordered. Falls back to end if no same-color exists.
  function insertSorted(cardId, hand) {
    const card = hand.find(c => c.id === cardId);
    if (!card || !manualOrder) return;
    const byId = {};
    for (const c of hand) byId[c.id] = c;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < manualOrder.length; i++) {
      const existing = byId[manualOrder[i]];
      if (!existing || existing.color !== card.color) continue;
      const d = Math.abs(existing.value - card.value);
      if (d <= bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx < 0) { manualOrder.push(cardId); return; }
    const neighbor = byId[manualOrder[bestIdx]];
    const insertAt = card.value < neighbor.value ? bestIdx : bestIdx + 1;
    manualOrder.splice(insertAt, 0, cardId);
  }

  function getOrder(hand) {
    if (!manualOrder) return null;
    const handIds = new Set(hand.map(c => c.id));
    // Remove cards no longer in hand
    manualOrder = manualOrder.filter(id => handIds.has(id));
    // If NONE of the manually-ordered cards remain, the custom arrangement is gone
    // (a fresh hand — new game). Fall back to canonical auto-sort. This is the only
    // reset MP games get: they never fire 'newGame', so without it a stale manualOrder
    // rebuilds new hands via insertSorted, which groups colours in first-appearance
    // order, not canonical colour order (the "cards aren't colour-sorted" bug).
    if (manualOrder.length === 0) { manualOrder = null; return null; }
    // Insert new cards
    for (const c of hand) {
      if (!manualOrder.includes(c.id)) {
        if (autoSort) {
          insertSorted(c.id, hand);
        } else {
          manualOrder.push(c.id); // Manual: new cards go to right end
        }
      }
    }
    return manualOrder;
  }

  function applyOrder(hand) {
    const order = getOrder(hand);
    if (!order) return null;
    const byId = {};
    for (const c of hand) byId[c.id] = c;
    return order.map(id => byId[id]).filter(Boolean);
  }

  function reset() {
    manualOrder = null;
    dragState = null;
    dragCardId = null;
  }

  function getDragCardId() { return dragCardId; }

  function initDragListeners() {
    const board = document.querySelector('.board-area');
    if (!board) return;
    board.addEventListener('touchstart', onTouchStart, { passive: false });
    board.addEventListener('touchmove', onTouchMove, { passive: false });
    board.addEventListener('touchend', onTouchEnd);
    board.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function findHandCard(el) {
    const wrapper = el.closest('.card-wrapper');
    if (!wrapper) return null;
    const cardId = wrapper.dataset.cardId;
    if (!cardId) return null;
    const hand = getCards(gameState, 'hands', userSlot);
    if (!hand.some(c => c.id === cardId)) return null;
    return { cardId, cardEl: wrapper };
  }

  // Get center X positions of all hand cards except the dragged one
  function getHandCardPositions() {
    const positions = [];
    if (!manualOrder) return positions;
    for (const id of manualOrder) {
      if (id === dragCardId) continue; // Skip dragged card
      const el = document.querySelector(`.card-wrapper[data-card-id="${id}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        positions.push({ id, cx: rect.left + rect.width / 2 });
      }
    }
    return positions;
  }

  function findTargetIndex(cursorX) {
    const positions = getHandCardPositions();
    if (positions.length === 0) return 0;
    // Find the gap closest to cursor
    // Gaps are: before first card, between each pair, after last card
    for (let i = 0; i < positions.length; i++) {
      if (cursorX < positions[i].cx) return i;
    }
    return positions.length; // After last card
  }

  function onTouchStart(e) {
    if (!gameState || gameState.status === 'finished') return;
    const touch = e.touches[0];
    const found = findHandCard(touch.target);
    if (!found) return;
    longPressTimer = setTimeout(() => {
      isDragging = true;
      startDrag(found.cardId, found.cardEl, touch.clientX, touch.clientY);
    }, 200);
    dragState = { cardId: found.cardId, startX: touch.clientX, startY: touch.clientY, cardEl: found.cardEl };
  }

  function onTouchMove(e) {
    if (!dragState) return;
    const touch = e.touches[0];
    if (!isDragging) {
      const dx = touch.clientX - dragState.startX;
      const dy = touch.clientY - dragState.startY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        clearTimeout(longPressTimer);
        dragState = null;
      }
      return;
    }
    e.preventDefault();
    moveDrag(touch.clientX, touch.clientY);
  }

  function onTouchEnd() {
    clearTimeout(longPressTimer);
    if (isDragging && dragState) endDrag();
    isDragging = false;
    dragState = null;
  }

  function onMouseDown(e) {
    if (!gameState || gameState.status === 'finished') return;
    if (e.button !== 0 || (!e.shiftKey && !e.altKey)) return;
    const found = findHandCard(e.target);
    if (!found) return;
    e.preventDefault();
    isDragging = true;
    dragState = { cardId: found.cardId, startX: e.clientX, startY: e.clientY, cardEl: found.cardEl };
    startDrag(found.cardId, found.cardEl, e.clientX, e.clientY);
  }

  function onMouseMove(e) {
    if (!isDragging || !dragState) return;
    e.preventDefault();
    moveDrag(e.clientX, e.clientY);
  }

  function onMouseUp() {
    if (isDragging && dragState) endDrag();
    isDragging = false;
    dragState = null;
  }

  // Convert screen coords (clientX/Y) to board-relative flat corners for renderCard
  function flatCornersAt(x, y) {
    const boardRect = document.querySelector('.board-area')?.getBoundingClientRect();
    if (!boardRect) return null;
    if (!cardDims) {
      const cs = getComputedStyle(document.documentElement);
      cardDims = {
        w: parseFloat(cs.getPropertyValue('--card-w')) || 40,
        h: parseFloat(cs.getPropertyValue('--card-h')) || 60
      };
    }
    const cx = x - boardRect.left;
    const cy = y - boardRect.top;
    const hw = cardDims.w / 2, hh = cardDims.h / 2;
    return {
      TL: { x: cx - hw, y: cy - hh },
      TR: { x: cx + hw, y: cy - hh },
      BL: { x: cx - hw, y: cy + hh },
      BR: { x: cx + hw, y: cy + hh }
    };
  }

  function positionAtCursor(x, y) {
    const corners = flatCornersAt(x, y);
    if (corners && typeof fourCornerRenderer !== 'undefined') {
      fourCornerRenderer.renderCard(dragCardId, corners, true); // immediate — snaps to cursor
    }
  }

  function startDrag(cardId, cardEl, x, y) {
    if (!manualOrder) {
      const hand = getCards(gameState, 'hands', userSlot);
      const sorted = [...hand].sort(CONFIG.cardSortComparator);
      manualOrder = sorted.map(c => c.id);
    }
    dragCardId = cardId;

    // Reuse the normal selected-card path: mark selected + face up, position flat at cursor.
    // No clone element — we move the actual card. renderCard replaces transforms cleanly.
    if (typeof updateCardVisual !== 'undefined') {
      updateCardVisual(cardId, {
        faceUp: true,
        zIndex: CONFIG.ui.zIndex.selected,
        selected: true,
        immediate: true
      });
    }
    renderGame(); // Rebuilds cone with this slot empty → visible gap
    positionAtCursor(x, y); // Snaps dragged card to cursor after render
    if (typeof SFX !== 'undefined') SFX.select();
  }

  function moveDrag(x, y) {
    if (!dragCardId) return;
    if (dragState) dragState.lastX = x;

    positionAtCursor(x, y); // Card tracks cursor instantly

    // Live reorder: move dragged card in manualOrder to the target slot
    if (!manualOrder) return;
    const targetIdx = findTargetIndex(x);
    const currentIdx = manualOrder.indexOf(dragCardId);
    if (targetIdx !== currentIdx && currentIdx !== -1) {
      manualOrder.splice(currentIdx, 1);
      manualOrder.splice(targetIdx, 0, dragCardId);
      renderGame();         // Gap shifts to new target; other cards reflow in cone
      positionAtCursor(x, y); // Keep dragged card at cursor (renderGame skipped it)
    }
  }

  function endDrag() {
    // Card is already face-up, visible, at the cursor position. Clearing dragCardId
    // causes the next renderGame to include it in the cone render, which triggers a
    // smooth transform animation from its current (cursor) position to the cone slot —
    // identical to the normal deselect animation.
    dragCardId = null;
    if (typeof selectedCard !== 'undefined' && selectedCard) {
      selectedCard = null;
    }

    // The browser synthesizes a click event after mouseup/touchend on the card wrapper,
    // which would hit the card's onclick → selectCard → re-select. Swallow that one click.
    const suppressClick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      window.removeEventListener('click', suppressClick, true);
    };
    window.addEventListener('click', suppressClick, true);
    setTimeout(() => window.removeEventListener('click', suppressClick, true), 400);

    renderGame();
  }

  function isAutoSort() { return autoSort; }

  function setAutoSort(val) {
    autoSort = val;
    localStorage.setItem(CONFIG.storagePrefix + '-autoSort', val);
    if (val) manualOrder = null;
    renderGame();
  }

  return { getOrder, applyOrder, reset, initDragListeners, isAutoSort, setAutoSort, getDragCardId };
})();

// Initialize drag listeners when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => handSort.initDragListeners());
  } else {
    handSort.initDragListeners();
  }
}

// Reset manual sort on new game
if (typeof on !== 'undefined') {
  on('newGame', () => handSort.reset());
}
