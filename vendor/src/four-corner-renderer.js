// four-corner-renderer.js — Four-corner card rendering system. Layer 4 (UI).
// Renders cards as arbitrary quadrilaterals using CSS transforms from TL/TR/BL/BR coordinates.
// Works alongside FLIP system - four-corner for cards, FLIP for other elements.

class FourCornerRenderer {
  constructor() {
    this.activeCards = new Map(); // cardId -> current transform state
    this.animationFrame = null;
    this._cardW = 0; // cached card dimensions (invalidated on resize)
    this._cardH = 0;
    this._anims = new Map(); // cardId -> running corner-lerp animation
    this._settledZ = new Map(); // cardId -> last landed/immediate z (pre-flight truth)
  }

  // Is this card mid corner-lerp (e.g. still dealing/flying in)?
  isAnimating(cardId) { return this._anims.has(cardId); }

  // Invalidate cached card dimensions (call on resize)
  invalidateCache() {
    this._cardW = 0;
    this._cardH = 0;
  }

  // Render card at four corner positions with smooth transitions.
  //
  // Movement is animated by LERPING THE FOUR CORNERS per frame and
  // recomputing the homography — never by CSS-transitioning matrix3d.
  // CSS interpolates matrices by decomposition, and WebKit's
  // decomposition between the hand's perspective homography and a flat
  // rectangle swings the element through wild intermediate transforms:
  // on iOS every select/draw made the card fly off the bottom of the
  // screen and back. Corner-space lerp gives sane intermediate quads by
  // construction, identically on every engine.
  renderCard(cardId, corners, immediate = false) {
    // Use card pool wrapper (not inner .card) for positioning
    const poolEntry = cardPoolMap.get(cardId);
    const element = poolEntry ? poolEntry.el : document.querySelector(`[data-card-id="${cardId}"]`);
    if (!element) return;

    const transform = this.computeTransformMatrix(corners);
    if (!transform) return;

    const animMs = CONFIG.ui.animMs || 300;
    // Skip animation if card was off-screen (hidden at -200,-200)
    const prev = this.activeCards.get(cardId);
    const wasOffscreen = prev && prev.corners && prev.corners.TL.x < -100;
    const running = this._anims.get(cardId);

    // updateCardVisual has already written the DESTINATION z onto the element.
    // _settledZ remembers the last landed z, so we can tell raises from lowers.
    const destZ = parseInt(element.style.zIndex) || 2000;

    if (immediate || !prev || wasOffscreen) {
      if (running) { cancelAnimationFrame(running.raf); this._anims.delete(cardId); }
      element.style.transition = 'none';
      element.style.transform = `matrix3d(${transform.join(',')})`;
      this._settledZ.set(cardId, destZ);
    } else {
      const moved = !prev.transform || transform.some((v, i) => Math.abs(v - prev.transform[i]) > 0.01);
      if (moved) {
        // Z during flight = max(settled z, destination z): raises apply
        // immediately, LOWERS are deferred until the card lands. This keeps
        // a played card (settled at selected z 5000) above everything while
        // it travels to pile depth, WITHOUT the old flat +3500 boost — that
        // boost lifted only MOVING cards, so a moving lower card rendered
        // above a stationary higher card in the same pile and the stack
        // visibly reshuffled mid-flight on spread/collapse.
        const settledZ = this._settledZ.has(cardId) ? this._settledZ.get(cardId) : destZ;
        const from = running ? running.current : prev.corners;
        if (running) cancelAnimationFrame(running.raf);
        element.style.zIndex = Math.max(settledZ, destZ);
        this._startCornerLerp(cardId, element, from, corners, animMs, destZ);
      } else {
        // Not moving: destination z (already on the element) is now settled.
        if (running) running.restoreZ = destZ;
        else this._settledZ.set(cardId, destZ);
      }
    }

    // Store target state (diffing always compares against the destination)
    this.activeCards.set(cardId, {
      corners,
      transform,
      element
    });
  }

  _startCornerLerp(cardId, element, from, to, animMs, restoreZ) {
    const self = this;
    const t0 = performance.now();
    element.style.transition = 'none';
    const anim = { raf: 0, current: from, restoreZ };
    this._anims.set(cardId, anim);
    function ease(t) { // ease-in-out cubic (matches the old CSS feel)
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    function frame(now) {
      const t = Math.min(1, (now - t0) / animMs);
      const k = ease(t);
      const cur = {};
      for (const c of ['TL', 'TR', 'BL', 'BR']) {
        cur[c] = { x: from[c].x + (to[c].x - from[c].x) * k,
                   y: from[c].y + (to[c].y - from[c].y) * k };
      }
      anim.current = cur;
      const m = self.computeTransformMatrix(cur);
      if (m) element.style.transform = `matrix3d(${m.join(',')})`;
      if (t < 1) {
        anim.raf = requestAnimationFrame(frame);
      } else {
        if (anim.restoreZ !== undefined) { // landed — settle to destination z
          element.style.zIndex = anim.restoreZ;
          self._settledZ.set(cardId, anim.restoreZ);
        }
        self._anims.delete(cardId);
      }
    }
    anim.raf = requestAnimationFrame(frame);
  }

  // Compute CSS matrix3d transform from four corners
  // Source quad must match the card element's pixel dimensions (--card-w × --card-h)
  computeTransformMatrix(corners) {
    const { TL, TR, BL, BR } = corners;
    // Cache card dimensions — only changes on resize (set by layout.js)
    if (!this._cardW || !this._cardH) {
      this._cardW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w'));
      this._cardH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-h'));
    }
    const w = this._cardW;
    const h = this._cardH;

    try {
      // Compute homography from card rectangle to arbitrary quadrilateral
      const transform = computeHomography(
        0, 0,     w, 0,     0, h,     w, h,      // Source: card pixel rectangle
        TL.x, TL.y, TR.x, TR.y, BL.x, BL.y, BR.x, BR.y  // Dest: four corners
      );
      
      if (!transform) return null;
      
      // Convert 3x3 homography to CSS matrix3d format (4x4)
      // CSS expects: [m00, m10, 0, m20, m01, m11, 0, m21, 0, 0, 1, 0, m02, m12, 0, m22]
      return [
        transform[0], transform[3], 0, transform[6],  // First column
        transform[1], transform[4], 0, transform[7],  // Second column  
        0, 0, 1, 0,                                   // Third column (Z)
        transform[2], transform[5], 0, transform[8]   // Fourth column (translation)
      ];
    } catch (error) {
      console.warn('Four-corner transform failed:', error);
      return null;
    }
  }

  // Render hand cards using cone projection + four-corner display
  renderHandCards(cards, coneParams, containerElement) {
    const results = [];
    
    cards.forEach((card, index) => {
      // Use existing DRY cone projection function
      const corners = computeHandCardCorners(index, cards.length, coneParams);
      if (!corners) return;
      
      // Apply four-corner rendering
      this.renderCard(card.id, corners, false);
      
      results.push({
        card,
        corners,
        centerX: (corners.TL.x + corners.TR.x + corners.BL.x + corners.BR.x) / 4,
        centerY: (corners.TL.y + corners.TR.y + corners.BL.y + corners.BR.y) / 4
      });
    });

    return results;
  }

  // Render pile cards using orthographic projection + four-corner display
  renderPileCards(cards, pilePosition, pileLayout) {
    const results = [];
    
    cards.forEach((card, index) => {
      // Compute orthographic four corners (rectangles with jitter)
      const corners = this.computePileCardCorners(card, index, pilePosition, pileLayout);
      if (!corners) return;
      
      // Apply four-corner rendering
      this.renderCard(card.id, corners, false);
      
      results.push({
        card,
        corners
      });
    });

    return results;
  }

  // Compute four corners for a simple rectangle (no jitter, optional rotation)
  computeRectangleCorners(centerX, centerY, width, height, rotation = 0) {
    const hw = width / 2;
    const hh = height / 2;
    
    if (rotation === 0) {
      // Fast path for axis-aligned rectangles
      return {
        TL: { x: centerX - hw, y: centerY - hh },
        TR: { x: centerX + hw, y: centerY - hh },
        BL: { x: centerX - hw, y: centerY + hh },
        BR: { x: centerX + hw, y: centerY + hh }
      };
    }
    
    // Rotate corners around center
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    
    return {
      TL: {
        x: centerX + (-hw * cos - -hh * sin),
        y: centerY + (-hw * sin + -hh * cos)
      },
      TR: {
        x: centerX + (hw * cos - -hh * sin), 
        y: centerY + (hw * sin + -hh * cos)
      },
      BL: {
        x: centerX + (-hw * cos - hh * sin),
        y: centerY + (-hw * sin + hh * cos)
      },
      BR: {
        x: centerX + (hw * cos - hh * sin),
        y: centerY + (hw * sin + hh * cos)
      }
    };
  }

  // Compute four corners from element's current DOM position
  computeCornersFromElement(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return this.computeRectangleCorners(centerX, centerY, rect.width, rect.height);
  }

  // Grab current position for FLIP-style animation (before state change)
  grabCardPosition(cardId) {
    const element = document.querySelector(`[data-id="${cardId}"]`);
    if (!element) return null;
    
    const corners = this.computeCornersFromElement(element);
    return { cardId, corners, element };
  }

  // Compute four corners for pile cards (orthographic rectangles with jitter)
  computePileCardCorners(card, index, pilePosition, pileLayout) {
    const { x, y, cardW, cardH } = pilePosition;
    const { offsetX, offsetY, rotation } = this.computeJitter(card.id, index);
    
    // Base rectangle corners
    const hw = cardW / 2;
    const hh = cardH / 2;
    
    // Apply jitter offset and rotation
    const centerX = x + offsetX;
    const centerY = y + offsetY + (index * pileLayout.cardSpacing);
    
    // Rotate corners around center
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    
    return {
      TL: {
        x: centerX + (-hw * cos - -hh * sin),
        y: centerY + (-hw * sin + -hh * cos)
      },
      TR: {
        x: centerX + (hw * cos - -hh * sin), 
        y: centerY + (hw * sin + -hh * cos)
      },
      BL: {
        x: centerX + (-hw * cos - hh * sin),
        y: centerY + (-hw * sin + hh * cos)
      },
      BR: {
        x: centerX + (hw * cos - hh * sin),
        y: centerY + (hw * sin + hh * cos)
      }
    };
  }

  // Compute jitter for pile cards (deterministic based on card ID)
  computeJitter(cardId, index) {
    // Mix card ID with index so same card at different positions gets different jitter
    const hash = this.hashString(cardId + ':' + index);
    const jitterConfig = CONFIG.ui.jitter;

    if (!jitterConfig) {
      throw new Error('CONFIG.ui.jitter not found - jitter config required');
    }
    
    return {
      offsetX: ((hash % 1000) / 500 - 1) * jitterConfig.px,
      offsetY: (((hash >> 10) % 1000) / 500 - 1) * jitterConfig.px,
      rotation: (((hash >> 20) % 1000) / 500 - 1) * jitterConfig.degrees * Math.PI / 180
    };
  }

  // Hash function for consistent jitter — good bit distribution for similar strings
  hashString(str) {
    let h = 0x9e3779b9; // golden ratio fractional bits
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x5bd1e995);
      h ^= h >>> 15;
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return Math.abs(h);
  }

  // Clear card from four-corner system (for cards being removed)
  removeCard(cardId) {
    this.activeCards.delete(cardId);
  }

  // Get center point for card (used by other systems like turn notifications)
  getCardCenter(cardId) {
    const cardState = this.activeCards.get(cardId);
    if (!cardState) return null;
    
    const { corners } = cardState;
    return {
      x: (corners.TL.x + corners.TR.x + corners.BL.x + corners.BR.x) / 4,
      y: (corners.TL.y + corners.TR.y + corners.BL.y + corners.BR.y) / 4
    };
  }

  // Get hand center for turn notifications (average of all hand card centers)
  getHandCenter(playerSlot) {
    const handCards = [];
    
    this.activeCards.forEach((state, cardId) => {
      // Check if this card belongs to the specified hand
      // (This is a simplified check - in practice would need better hand detection)
      const element = state.element;
      const isInHand = element.closest('#hand_user, #hand_opp');
      const isMyHand = element.closest('#hand_user');
      
      if (isInHand && ((playerSlot === userSlot && isMyHand) || (playerSlot !== userSlot && !isMyHand))) {
        const center = this.getCardCenter(cardId);
        if (center) handCards.push(center);
      }
    });

    if (handCards.length === 0) return null;

    // Return average center point
    return {
      x: handCards.reduce((sum, card) => sum + card.x, 0) / handCards.length,
      y: handCards.reduce((sum, card) => sum + card.y, 0) / handCards.length
    };
  }
}

// Global instance
const fourCornerRenderer = new FourCornerRenderer();

// ===== CARD POOL — Persistent DOM elements for all 60 cards =====
const cardPoolMap = new Map(); // cardId → { el: wrapper, card: inner }

function createCardPool() {
  const pool = document.getElementById('card-pool');
  if (!pool) return;
  pool.innerHTML = '';
  cardPoolMap.clear();
  fourCornerRenderer.activeCards.clear();
  renderGame._firstRender = true; // First render after pool creation skips animation

  const cards = allCards(); // 60 cards from rules.js
  const animMs = CONFIG.ui.animMs || 300;

  for (const card of cards) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-wrapper';
    wrapper.dataset.cardId = card.id;
    // Bespoke card MOVEMENT; animMs speed is CONFIG single-source (intentionally distinct from --dur-*).
    wrapper.style.transition = `transform ${animMs}ms var(--ease-inout)`;
    // Park offscreen until the first positioning render. Without this, cards
    // sit at the pool's origin (top-left) and flash there during the gap
    // before positionAllCards runs — most visible in multiplayer, where the
    // first render waits on the dealt state arriving from Firebase.
    wrapper.style.transform = 'translate(-9999px,-9999px)';

    const isWager = card.value === 0;
    const inner = document.createElement('div');
    inner.className = `card color-${card.color}${isWager ? ' wager' : ''} card-back`;
    inner.dataset.id = card.id;

    const corner = document.createElement('div');
    corner.className = 'card-corner';
    corner.innerHTML = isWager ? WAGER_ICON : card.value;

    const value = document.createElement('div');
    value.className = 'card-value';
    value.innerHTML = isWager ? WAGER_ICON : card.value;

    // Colorblind symbol (hidden by default, shown when colorblindMode is on)
    if (CONFIG.colorSymbols && CONFIG.colorSymbols[card.color]) {
      const cb = document.createElement('div');
      cb.className = 'cb-sym';
      cb.textContent = CONFIG.colorSymbols[card.color];
      cb.style.display = 'none';
      inner.appendChild(cb);
    }

    inner.appendChild(corner);
    inner.appendChild(value);
    wrapper.appendChild(inner);
    pool.appendChild(wrapper);

    cardPoolMap.set(card.id, { el: wrapper, card: inner });
  }
}

// Update a card's visual state (face up/down, classes, click handler, z-index)
function updateCardVisual(cardId, opts) {
  const entry = cardPoolMap.get(cardId);
  if (!entry) return;
  const { el, card } = entry;

  // Face up/down — card-back hides face content, shows back design via CSS
  if (opts.faceUp !== undefined) {
    const isFaceUp = opts.faceUp;
    const wasFaceDown = card.classList.contains('card-back');
    const isFlipping = isFaceUp !== !wasFaceDown; // ANY face change animates (reveal OR hide)

    // Record the LATEST desired face on the element; applyFace reads it at fire time
    // (not a stale closure). A re-render (e.g. a Firebase state echo landing mid-flip)
    // that changes the target then wins, instead of a queued timer snapping the old
    // face over the new one — the "mixed flipped/unflipped hand" tear.
    card._faceTarget = isFaceUp;
    const applyFace = () => {
      const up = card._faceTarget;
      card.classList.toggle('card-back', !up);
      if (!up) {
        CONFIG.colors.forEach(c => card.classList.remove('color-' + c));
      } else {
        const color = cardId.split('_')[0];
        if (CONFIG.colors.includes(color)) card.classList.add('color-' + color);
      }
      const corner = card.querySelector('.card-corner');
      const value = card.querySelector('.card-value');
      if (corner) corner.style.display = up ? '' : 'none';
      if (value) value.style.display = up ? '' : 'none';
      const cbSym = card.querySelector('.cb-sym');
      if (cbSym) cbSym.style.display = (up && colorblindMode) ? '' : 'none';
    };

    // Cancel any pending flip timer before deciding this render — a stale one must
    // never fire after a newer render already set the face.
    if (card._flipTimer) { clearTimeout(card._flipTimer); card._flipTimer = null; }
    if (isFlipping && !opts.immediate) {
      // Animate a scaleX flip on the INNER card (the wrapper owns the matrix3d
      // position); swap the face at the thinnest moment (animation midpoint).
      const animMs = CONFIG.ui.animMs || 300;
      card.style.animation = `cardFlip ${animMs}ms var(--anim-ease)`;
      const clearFlip = () => { card.style.animation = ''; card.removeEventListener('animationend', clearFlip); };
      card.addEventListener('animationend', clearFlip);
      card._flipTimer = setTimeout(() => { card._flipTimer = null; applyFace(); }, animMs / 2);
    } else {
      applyFace();
    }
  }

  // Z-index
  if (opts.zIndex !== undefined) el.style.zIndex = opts.zIndex;

  // Extra CSS classes on card (selected, target, undoable)
  card.classList.toggle('selected', !!opts.selected);
  card.classList.toggle('target', !!opts.target);
  card.classList.toggle('undoable', !!opts.undoable);

  // Click handler — cards without onclick pass clicks through to grid below
  if (opts.onclick !== undefined) {
    el.onclick = opts.onclick;
    el.style.pointerEvents = opts.onclick ? 'auto' : 'none';
  }
}

// Legacy stubs — no-ops since the universal move system handles animation automatically.
// Cards animate via CSS transitions on their persistent wrapper elements.
function grabPos() { return null; }
function slideFrom() {}
function slideFromEl() {}
function onAnimationsDone(cb) { cb(); }