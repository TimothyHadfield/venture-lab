// rendering.js — Card rendering via persistent card pool, board layout, scoring display
// Layer 4 (UI). Cards are persistent DOM elements positioned via four-corner transforms.
// Non-card elements (pile spaces, labels, scores) rendered via innerHTML.

// Layer separation: Handle DOM changes from other layers via events
on('highContrastModeChange', (enabled) => {
  if (enabled) {
    document.body.classList.add('high-contrast');
  } else {
    document.body.classList.remove('high-contrast');
  }
});

let yourTurnUntil=0;
// Per-pile score placements collected by renderBoardStructure and positioned by
// positionAllCards into a PERSISTENT layer, so the scores glide (CSS top-transition)
// when a pile expands, instead of jumping with the innerHTML rebuild.
let _pileScores=[];
// cardId -> the DESTINATION matrix3d string for each user hand card this render.
// The select-hint glow twins ride these (not the live style.transform, which
// mid-deal is still animating from the draw pile).
let _handFinalTf={};
// cardId -> destination corners (pool space) for each user hand card, used to
// build the union clip-path for the clipped hand-shadow.
let _handCorners={};
// cardId -> the face z-index this render, so each shadow twin can sit at its own
// card's z (front cards then correctly occlude it).
let _handZ={};
let idleStart=0;
let idleShown=false;
function getIdleReminderMs(){
  const stored=localStorage.getItem(CONFIG.storagePrefix+'-idleReminder');
  return stored===null ? CONFIG.ui.idleMs : parseInt(stored,10);
}
function cycleIdleReminder(){
  const opts=CONFIG.ui.idleReminderOptions;
  const cur=getIdleReminderMs();
  const next=opts[(opts.indexOf(cur)+1) % opts.length];
  localStorage.setItem(CONFIG.storagePrefix+'-idleReminder',String(next));
  refreshIdleReminderBtn();
  if(next<0 && idleShown){
    idleShown=false; idleStart=0;
    const ov=document.getElementById('idle-overlay');
    if(ov){ov.classList.remove('visible');ov.innerHTML='';}
  }
}
function refreshIdleReminderBtn(){
  const btn=document.getElementById('idle-reminder-btn');
  if(!btn) return;
  const cur=getIdleReminderMs();
  const idx=CONFIG.ui.idleReminderOptions.indexOf(cur);
  btn.textContent='Idle Reminder: '+CONFIG.ui.idleReminderLabels[idx>=0?idx:CONFIG.ui.idleReminderOptions.indexOf(CONFIG.ui.idleMs)];
}

// Subscribe to renderNeeded events from other modules (dependency table compliance)
on('renderNeeded', function() { renderGame(); });

// ===== MAIN RENDER FUNCTION =====
function renderGame(){
  if(!gameState)return;

  const layout=computeLayout();

  const isMyTurn = gameState.currentTurn===userSlot;
  const inPlayPhase = gameState.phase==='play';
  const inDrawPhase = gameState.phase==='draw';

  // --- UI STATE (phase prompts, scores, glow, idle) ---
  renderUIState(isMyTurn, inPlayPhase, inDrawPhase);

  // --- BOARD STRUCTURE (pile spaces, labels, grid columns — no cards) ---
  renderBoardStructure(layout);

  // --- POSITION ALL CARDS via persistent card pool ---
  if (cardPoolMap.size > 0) {
    // _snapNextRender: set by the resize handler — viewport changes
    // (iOS URL bar, rotation) reposition instantly instead of animating.
    const immediate = renderGame._firstRender || renderGame._snapNextRender;
    renderGame._firstRender = false;
    renderGame._snapNextRender = false;
    positionAllCards(layout, immediate);
  }

  // --- PLAYABLE TARGETS ---
  if (typeof determinePlayableTargets === 'function' && typeof applyPlayableTargetStyles === 'function') {
    const targets = determinePlayableTargets(gameState, selectedCard);
    applyPlayableTargetStyles(targets);
  }

  // --- HAND SELECT HINT --- soft glow on your hand while it's your turn to
  // pick a card (play phase, nothing selected yet). Clears the moment a card
  // is selected (the destinations take over the highlight then).
  applyHandSelectHint(isMyTurn, inPlayPhase);

  // --- DRAWABLE HIGHLIGHT --- same selected-card treatment on the top card of
  // every pile you can draw from this turn (draw phase).
  applyDrawableHighlight();

  // --- CLIPPED HAND SHADOW --- (clip mode) restore the overlap-depth shadow
  // WITHOUT the bottom notches: one screen-space shadow layer clipped to the
  // union of the card silhouettes, so the shadow paints on the cards but never
  // on the glow behind them.
  applyHandShadowClip();

  emit('rendered');
}

// "Pick a card" glow on the user's hand — on only when it's your turn, play
// phase, no card selected yet, and not during replay playback. The glow is a
// twin element per hand card (same border+shadow as a selected card) placed in
// #card-pool at a z BELOW the hand faces (2900 < the 3000 hand band), so each
// twin is occluded by the neighbouring faces and the highlight reads only on
// the fan's OUTER silhouette — never on the internal overlap seams.
function applyHandSelectHint(isMyTurn, inPlayPhase) {
  const pool = document.getElementById('card-pool');
  if (!pool) return;
  const inReplay = typeof _replayActive !== 'undefined' && _replayActive;
  const hint = isMyTurn && inPlayPhase && !selectedCard && !inReplay
            && gameState && gameState.status === 'playing';
  // Don't bloom the glow until the dealt cards have LANDED — otherwise it appears
  // at the destinations while the hand is still flying in from the deck.
  const settled = handSettled();
  const show = hint && settled;
  const handSet = new Set(
    hint ? getCards(gameState, 'hands', userSlot).map(c => String(c.id)) : []
  );
  if (hint) {
    for (const idStr of handSet) {
      const tf = _handFinalTf[idStr];   // destination quad, not the mid-flight one
      if (!tf) continue; // not positioned this render (e.g. mid-drag)
      let twin = document.getElementById('hglow-' + idStr);
      let fresh = false;
      if (!twin) {
        twin = document.createElement('div');
        twin.id = 'hglow-' + idStr;
        twin.className = 'hand-glow-twin';
        twin.style.zIndex = 2900;
        pool.appendChild(twin);
        fresh = true;
      }
      twin.style.transform = tf;   // ride the exact same quad as the card
      if (show) {
        // Fade IN (0→1). A brand-new element needs its 0 to commit first (next
        // frame) or the browser jumps straight to 1 with no transition.
        if (fresh) requestAnimationFrame(() => { const t = document.getElementById('hglow-' + idStr); if (t) t.style.opacity = '1'; });
        else twin.style.opacity = '1';
      } else {
        twin.style.opacity = '0';
      }
    }
    if (!settled) scheduleHandGlowSettle();   // re-fire once the hand lands
  }
  // Fade out any twin that isn't a currently-hinted hand card.
  pool.querySelectorAll('.hand-glow-twin').forEach(twin => {
    if (!hint || !handSet.has(twin.id.slice('hglow-'.length))) twin.style.opacity = '0';
  });
  // Suppress the dark drop-shadow on lit hand faces only once the clipped shadow
  // is actually taking over (settled); during the deal the faces keep their shadow.
  for (const [cid, entry] of cardPoolMap) {
    entry.card.classList.toggle('hand-lit', show && handSet.has(String(cid)));
  }
}

// True when no user hand card is still animating (the dealt cards have landed).
function handSettled() {
  if (!gameState || typeof fourCornerRenderer === 'undefined') return true;
  const cards = getCards(gameState, 'hands', userSlot);
  for (const c of cards) if (fourCornerRenderer.isAnimating(c.id)) return false;
  return true;
}

// While the hand is still flying in, poll each frame; once it lands, re-run the
// glow + clipped shadow so they fade in on the settled hand.
let _handGlowSettleRaf = 0;
function scheduleHandGlowSettle() {
  if (_handGlowSettleRaf) return;
  const poll = () => {
    if (handSettled()) {
      _handGlowSettleRaf = 0;
      applyHandSelectHint(!!(gameState && gameState.currentTurn === userSlot),
                          !!(gameState && gameState.phase === 'play'));
      applyHandShadowClip();
    } else {
      _handGlowSettleRaf = requestAnimationFrame(poll);
    }
  };
  _handGlowSettleRaf = requestAnimationFrame(poll);
}

// Clipped hand-shadow (the "clip mode" answer to the cyclic layering). Keeps the
// overlap-depth drop-shadow but kills the bottom notches — and respects z, so a
// card's shadow only lands on cards BEHIND it, never on top of the ones in front.
// One dark drop-shadow twin per lit card, each a direct pool sibling of the faces
// at ITS OWN card's z (so front faces occlude it and back faces receive it), then
// clipped to the union of the OTHER cards mapped into that twin's local space (via
// the inverse homography) — so the shadow paints on the neighbours (depth) but is
// clipped away where it would fall on the glow (the notch) or on its own face.
function applyHandShadowClip() {
  const pool = document.getElementById('card-pool');
  if (!pool) return;
  const inReplay = typeof _replayActive !== 'undefined' && _replayActive;
  const on = !inReplay && gameState && gameState.status === 'playing'
    && gameState.currentTurn === userSlot && gameState.phase === 'play' && !selectedCard
    && handSettled();   // wait for the dealt cards to land, like the glow
  const ids = on ? getCards(gameState, 'hands', userSlot).map(c => String(c.id))
                    .filter(id => _handCorners[id] && _handFinalTf[id]) : [];
  const present = new Set(ids);
  if (ids.length) {
    const rs = getComputedStyle(document.documentElement);
    const w = parseFloat(rs.getPropertyValue('--card-w'));
    const h = parseFloat(rs.getPropertyValue('--card-h'));
    for (const id of ids) {
      const C = _handCorners[id];
      // Homography mapping SCREEN → this card's local rect (0,0)-(w,h).
      const H = computeHomography(C.TL.x, C.TL.y, C.TR.x, C.TR.y, C.BL.x, C.BL.y, C.BR.x, C.BR.y,
                                  0, 0, w, 0, 0, h, w, h);
      let clip = '';
      if (H) {
        const map = (px, py) => {
          const X = H[0]*px + H[1]*py + H[2];
          const Y = H[3]*px + H[4]*py + H[5];
          const W = H[6]*px + H[7]*py + H[8] || 1e-6;
          return X / W + ' ' + Y / W;
        };
        for (const jid of ids) {
          if (jid === id) continue;   // exclude self → shadow never darkens its own face
          const J = _handCorners[jid];
          clip += `M ${map(J.TL.x, J.TL.y)} L ${map(J.TR.x, J.TR.y)} L ${map(J.BR.x, J.BR.y)} L ${map(J.BL.x, J.BL.y)} Z `;
        }
      }
      let tw = document.getElementById('hsh-' + id);
      if (!tw) { tw = document.createElement('div'); tw.id = 'hsh-' + id; tw.className = 'hand-shadow-twin'; pool.appendChild(tw); }
      tw.style.transform = _handFinalTf[id];
      tw.style.zIndex = _handZ[id] || 3000;
      tw.style.clipPath = clip ? `path("${clip.trim()}")` : 'none';
      tw.style.display = clip ? '' : 'none';
    }
  }
  pool.querySelectorAll('.hand-shadow-twin').forEach(tw => { if (!present.has(tw.id.slice(4))) tw.style.display = 'none'; });
}

// Selected-card treatment (outer ring + glow) on the TOP card of every pile you
// can draw from this turn. Reuses determinePlayableTargets so the highlight can't
// drift from what's actually drawable (draw pile always; a discard unless it's the
// one you just discarded to). These are single exposed top cards, so the ring goes
// straight on the face — no twin needed (nothing overlaps them).
function applyDrawableHighlight() {
  const inReplay = typeof _replayActive !== 'undefined' && _replayActive;
  const lit = new Set();
  if (!inReplay && gameState && gameState.status === 'playing'
      && gameState.currentTurn === userSlot && gameState.phase === 'draw'
      && typeof determinePlayableTargets === 'function') {
    const { origins } = determinePlayableTargets(gameState, selectedCard);
    for (const o of origins) {
      let pile = null;
      if (o.type === 'draw-pile') pile = getCards(gameState, 'drawPile');
      else if (o.type === 'discard-pile') pile = useSinglePile()
        ? getCards(gameState, 'singlePile')
        : getCards(gameState, 'discards', o.color);
      if (pile && pile.length) lit.add(String(pile[pile.length - 1].id));
    }
  }
  for (const [cid, entry] of cardPoolMap) {
    entry.card.classList.toggle('draw-lit', lit.has(String(cid)));
  }
}

// ===== UI STATE (non-card elements) =====
function renderUIState(isMyTurn, inPlayPhase, inDrawPhase) {
  // Replay playback: the replay bar owns the screen. The replayed state
  // would otherwise read as "your turn" and fire the glow, cone, idle
  // nag, and turn sound on a game that isn't being played.
  if (typeof _replayActive !== 'undefined' && _replayActive) {
    const gs=document.getElementById('game-screen');
    if(gs) gs.classList.remove('your-turn-glow');
    const os=document.getElementById('opp-status');
    if(os) os.innerHTML='';
    document.title='Venture';
    renderNameTags();   // still show the recorded game's names on the board
    return;
  }
  const phaseBar=document.getElementById('phase-prompt');
  const oppStatus=document.getElementById('opp-status');
  const gameScreenEl=document.getElementById('game-screen');
  const wasMyTurn=gameScreenEl&&gameScreenEl.classList.contains('your-turn-glow');

  if(isMyTurn && !wasMyTurn && gameState.phase==='play'){
    SFX.yourTurn();
    yourTurnUntil=Date.now()+CONFIG.ui.turnFlashMs;
  }

  // (The cone glow under the hand was retired — the bottom bar's whose-turn tint
  // is the turn cue now.)

  // The prompt copy — shown on the bottom bar's turn indicator. Uses the
  // opponent's NAME (not "Opponent"). No transient "YOUR TURN" flash: it just
  // states the current action (Select a card / Play or discard / Draw a card).
  const _oppTurnNm = document.getElementById('opponent-name-store')?.textContent || 'Opponent';
  let phaseText = '';
  if (!isMyTurn) phaseText = _oppTurnNm + "'s turn";
  else if (inPlayPhase) phaseText = selectedCard ? 'Play or discard' : 'Select a card';
  else phaseText = 'Draw a card';

  // Phase prompt (kept for the hidden info row; the visible copy is the bar below)
  if(phaseBar){
    const phaseColor=(isMyTurn&&inDrawPhase)?'var(--gold-bright)':'var(--parchment-dark)';
    const phaseOpacity=isMyTurn?undefined:CONFIG.ui.opacity.faint;
    const phaseStyle=undefined;
    const newContent = renderText(phaseText,4,{font:'crimson',opacity:phaseOpacity,extraStyle:phaseStyle});
    if(phaseBar.innerHTML !== newContent) {
      gateAction('phase-text-update', () => { crossFadePhaseText(phaseBar, newContent); });
    }
  }
  // Whose-turn tint + the prompt copy, centred on the bottom bar (live mode).
  const bottomBar = document.getElementById('bottom-bar');
  if (bottomBar) bottomBar.classList.toggle('my-turn', isMyTurn && gameState.status === 'playing');
  const turnInd = document.getElementById('turn-indicator');
  if (turnInd) turnInd.textContent = phaseText;

  // Opponent status
  if(oppStatus){
    if(isMyTurn) oppStatus.innerHTML='';
    else oppStatus.innerHTML=renderText('thinking...',4,{});
  }

  // Idle overlay
  const idleOverlay=document.getElementById('idle-overlay');
  const idleMs=getIdleReminderMs();
  if(idleOverlay){
    if(isMyTurn && inPlayPhase && !selectedCard && idleMs>=0){
      if(!idleStart) idleStart=Date.now();
      if(!idleShown && Date.now()-idleStart>=idleMs){
        idleShown=true;
        idleOverlay.classList.add('visible');
        idleOverlay.innerHTML=
          renderText('Your turn',1,{block:true,align:'center',extraStyle:'animation:idlePulse calc(var(--dur-fade-slow) * 2) var(--ease-inout) infinite'})+
          renderText('tap anywhere',2,{font:'crimson',block:true,align:'center'});
        SFX.idleNag();
      }
    } else {
      idleStart=0;
      if(idleShown){ idleShown=false; idleOverlay.classList.remove('visible'); idleOverlay.innerHTML=''; }
    }
  }

  // Screen edge glow
  if(gameScreenEl) gameScreenEl.classList.toggle('your-turn-glow',isMyTurn);

  // Title
  document.title=isMyTurn?'\uD83D\uDFE1 Your Turn \u2014 Venture':'Venture';
  if(isMyTurn && !wasMyTurn && !isAIGame && document.hidden) notifyTurn();

  renderNameTags();
}

// Score sign colour — ONE place, shared by board pile scores + totals (mirrors the
// results screen's scColor): positive = gold, negative = red, zero = default parchment.
function scoreSignColor(v){ return v > 0 ? 'var(--gold-bright)' : v < 0 ? 'var(--danger)' : 'var(--parchment)'; }
// Metallic-points class for a score value (mirrors the results screen): positive =
// struck gold, negative = tarnished metal, zero = flat wash. Applied to the element
// so its background-clip:text gradient shows through the text.
function ptsClass(v){ return v > 0 ? 'pts' : v < 0 ? 'pts-neg' : 'pts-zero'; }
// Shared helper: wrap a POINT value in its metallic treatment. Use everywhere a point
// value renders (results, board, stats, match history) so points look like points
// consistently. Non-numeric (e.g. "--") passes through plain. `display` overrides text.
function ptsSpan(v, display){ const t = (display !== undefined ? display : v); return (typeof v === 'number' && isFinite(v)) ? `<span class="${ptsClass(v)}">${t}</span>` : `${t}`; }
// Deck-count heat: calm parchment while plenty remain, warming to gold, then red as
// the deck empties (a visual "running out" cue). Interpolated via color-mix.
function deckCountColor(n){
  // Parchment while plenty, warming straight to RED as it empties — deliberately NO
  // gold/amber, so the deck count can never be mistaken for a (metallic gold) point.
  if (n > 15) return 'var(--parchment)';
  const t = Math.round((15 - Math.max(0, n)) / 15 * 100);
  return `color-mix(in srgb, var(--danger) ${t}%, var(--parchment))`;
}

// Head-to-head outcome colour for a value vs its counterpart (record wins, etc.):
// ahead = gold (r-pos), behind = red (r-neg), tie = default parchment. ONE place —
// same win/loss/draw language as the score pairs.
function outcomeClass(mine, theirs){ return mine > theirs ? 'r-pos' : mine < theirs ? 'r-neg' : ''; }
// A results META row mirroring the score table's 3-column layout: [my value] · label ·
// [opp value]. The value spans are first/last child so the number-Cinzel rule catches
// them; the centre label stays Crimson. Shared by the Rating and Record rows.
function metaRow(leftHTML, leftCls, label, rightHTML, rightCls){
  const centre = `<span style="min-width:calc(var(--card-h)*1.15);padding:0 var(--space-micro);text-align:center;font-size:var(--text-body);line-height:var(--leading)">${label}</span>`;
  return `<div class="r-line sc-row" style="justify-content:center">`
    + `<span class="${leftCls||''}" style="flex:1;text-align:left">${leftHTML}</span>${centre}`
    + `<span class="${rightCls||''}" style="flex:1;text-align:right">${rightHTML}</span></div>`;
}
// Record row: my wins (left) vs opp wins (right), each coloured by its own standing;
// "Record" label centred, draw count beneath it. No W/L letters — a number under a
// name IS that player's wins.
function recordRowHTML(myWins, oppWins, draws){
  const label = draws > 0
    ? `Record<div style="opacity:.55;font-size:.78em;line-height:1.2">${draws} draw${draws>1?'s':''}</div>`
    : 'Record';
  // Uncolored — the columns already say whose wins are whose (mine left, opp right,
  // draws centre), so no outcome coloring needed. Plain parchment counts.
  return metaRow(myWins, '', label, oppWins, '');
}

// Board name tags — used in BOTH live and replay (replay returns early above, so
// this must be callable from there too). In replay, show the recorded names.
function renderNameTags(){
  const labelOpts={font:'cinzel'};
  const _inRep=(typeof _replayActive!=='undefined'&&_replayActive);
  const _oppNm=(_inRep&&typeof _replayOppName!=='undefined'&&_replayOppName)?_replayOppName:(document.getElementById('opponent-name-store')?.textContent||'Opponent');
  const _myNm=(_inRep&&typeof _replayMyName!=='undefined'&&_replayMyName)?_replayMyName:(typeof viewerName==='function'?viewerName():'YOU');
  const oppNameTag=document.getElementById('opp-name-tag');
  if(oppNameTag) oppNameTag.innerHTML=renderText(_oppNm,3,labelOpts);
  const myNameTag=document.getElementById('my-name-tag');
  if(myNameTag) myNameTag.innerHTML=renderText(_myNm,3,labelOpts);
  // Highlight the active player's name — driven by GAME STATE (self-correcting every
  // render; can't get stuck like the old event-driven inline-style path). No live
  // highlight during replay. The .active style lives in CSS (.name-tag.active).
  const _playing = !_inRep && gameState && gameState.status === 'playing';
  const _myTurn = _playing && gameState.currentTurn === userSlot;
  if(myNameTag) myNameTag.classList.toggle('active', !!_myTurn);
  if(oppNameTag) oppNameTag.classList.toggle('active', !!(_playing && !_myTurn));
}

// SHARED play-pile vertical geometry — the SINGLE source that both the empty
// pile-space (renderBoardStructure) and the played cards (positionAllCards)
// index off, so a played card can only ever land on its own pile-space centre;
// they can't be "two positions that happen to match". `stackH` is the cards'
// height (cardH for a single card); the dashed slot pads it by slotPad. No
// isUser term — the slot top is identical for both players by construction.
function playPileTop(stackH, slotPad, sectionH) {
  // Unclamped centre — a normal pile (< section) sits at a positive top exactly
  // as before; an EXPANDED pile (taller than its section) gets a NEGATIVE top so
  // it overflows symmetrically both ways, not MATH.center's clamp-to-0 which only
  // let it grow downward (into the hand / play piles).
  return Math.round((sectionH - (stackH + slotPad)) / 2);
}

// Expanded-pile fan offset. When a pile is tapped to spread, fan every card wide
// enough that its top-left number stays visible (≈ the corner label's reach), so
// you can read the whole pile. Expanded piles may overflow their section — that's
// accepted; playPileTop recentres them. Returns 0 for a single card.
// Minimum expanded separation = just enough to reveal each card's top-left corner
// number. DERIVED from the .card-corner placement (styles.css): its box bottom sits
// at top(φ⁻⁹) + padTop(φ⁻⁹) + fontSize(φ⁻⁴) + padBottom(φ⁻⁹) = cardH·(1/φ⁴ + 3/φ⁹)
// from the card top, so a strip that tall shows the whole number.
function cornerRevealOffset(cardH) {
  return cardH * (1 / Math.pow(PHI, 4) + 3 / Math.pow(PHI, 9));
}
// Expanded-pile fan: generous for small piles (the 2-card spacing), tapering down
// to the corner-reveal minimum for big piles so a 12-high pile stays compact
// instead of towering. Linear in pile length between the two derived endpoints.
const EXPAND_TIGHT_AT = 8;   // pile size at which the expanded fan reaches its tightest (corner-reveal) spacing
// Expanded spacing = the SAME power law as the collapsed pile (stackOffset),
// scaled up by G so it lands exactly on the corner-reveal floor at EXPAND_TIGHT_AT
// cards. So small piles fan ~G× wider than collapsed (a clear "expanded" signal —
// a 2-card pile visibly spreads), the curve tightens like the collapsed one, and
// piles of 8+ sit at the floor. G is DERIVED, not tuned.
function expandedFanOffset(len, cardH) {
  if (len <= 1) return 0;
  const minSep = cornerRevealOffset(cardH);                        // corner number still visible
  const G = minSep / MATH.stackOffset(EXPAND_TIGHT_AT, cardH);     // scale so 8 cards → floor
  return Math.round(Math.max(minSep, MATH.stackOffset(len, cardH) * G));
}

// ===== CARD POOL POSITIONING =====
// Updates all 60 persistent card elements based on game state.
// Cards animate via CSS transitions on their wrapper elements.
function positionAllCards(layout, immediate) {
  const boardEl = document.querySelector('.board-area');
  if (!boardEl) return;
  // A spread (or collapsing) pile floats above the score layer + chrome — lift the pool.
  const _pool = document.getElementById('card-pool');
  if (_pool) _pool.classList.toggle('pile-focus', !!(spreadPile || collapsingPile));
  const boardRect = boardEl.getBoundingClientRect();

  const cardW = layout.cardW, cardH = layout.cardH, slotPad = layout.slotPad;
  const isSingle = useSinglePile();
  const playScoreH = layout.playScoreH;
  const cardContentH = layout.playContentH;
  const sectionH = layout.sectionHeights.play_row;
  const midH = layout.sectionHeights.discard_draw;
  const oppSlot = userSlot === 'player1' ? 'player2' : 'player1';
  const isMyTurn = gameState.currentTurn === userSlot;
  const inPlayPhase = gameState.phase === 'play';

  function stackOffset(count) { return Math.round(MATH.stackOffset(count, cardH)); }

  // Board-relative column center X
  function colCenterX(sectionId, colIndex) {
    const section = document.getElementById(sectionId);
    if (!section || !section.children[colIndex]) return boardRect.width / 2;
    const r = section.children[colIndex].getBoundingClientRect();
    return r.left - boardRect.left + r.width / 2;
  }
  // Board-relative section top Y
  function sectionY(sectionId) {
    const el = document.getElementById(sectionId);
    return el ? el.getBoundingClientRect().top - boardRect.top : 0;
  }

  // Rectangle corners centered at (cx, cy) with jitter
  function pileCorners(cardId, index, cx, cy) {
    const hw = cardW / 2, hh = cardH / 2;
    const j = fourCornerRenderer.computeJitter(cardId, index);
    const cos = Math.cos(j.rotation), sin = Math.sin(j.rotation);
    return {
      TL: { x: cx+j.offsetX+(-hw*cos - -hh*sin), y: cy+j.offsetY+(-hw*sin + -hh*cos) },
      TR: { x: cx+j.offsetX+(hw*cos - -hh*sin),  y: cy+j.offsetY+(hw*sin + -hh*cos) },
      BL: { x: cx+j.offsetX+(-hw*cos - hh*sin),  y: cy+j.offsetY+(-hw*sin + hh*cos) },
      BR: { x: cx+j.offsetX+(hw*cos - hh*sin),   y: cy+j.offsetY+(hw*sin + hh*cos) }
    };
  }
  function flatCorners(cx, cy) {
    const hw = cardW / 2, hh = cardH / 2;
    return { TL:{x:cx-hw,y:cy-hh}, TR:{x:cx+hw,y:cy-hh}, BL:{x:cx-hw,y:cy+hh}, BR:{x:cx+hw,y:cy+hh} };
  }

  const positioned = new Set();

  // --- USER HAND (cone projection) ---
  _handFinalTf = {}; _handCorners = {}; _handZ = {};   // rebuilt below with this render's destinations
  const hand = getCards(gameState, 'hands', userSlot);
  const manualSorted = typeof handSort !== 'undefined' ? handSort.applyOrder(hand) : null;
  const activeDragId = typeof handSort !== 'undefined' ? handSort.getDragCardId() : null;
  const sorted = manualSorted || [...hand].sort(CONFIG.cardSortComparator);
  // Note: dragged card stays in sorted so cone reserves its slot (visible gap); rendering skips it
  if (sorted.length > 0) {
    const handArea = document.getElementById('hand_user');
    const handAreaRect = handArea ? handArea.getBoundingClientRect() : null;
    const containerW = handAreaRect ? handAreaRect.width : CONFIG.ui.fallbackWidth;
    const cone = computeCone(sorted.length, containerW);
    let minSY = Infinity, maxSY = -Infinity;
    const hCorners = [];
    for (let i = 0; i < sorted.length; i++) {
      const c = computeHandCardCorners(i, sorted.length, cone);
      if (!c) continue;
      for (const p of c.corners) { if (p.y < minSY) minSY = p.y; if (p.y > maxSY) maxSY = p.y; }
      hCorners.push(c);
    }
    const liftPx = lvl(4, cardH);
    const projH = maxSY - minSY;
    const offsetSY = -minSY;   // fan fills the band (no reserved lift push-down)
    const baseX = handAreaRect ? handAreaRect.left - boardRect.left : 0;
    const baseY = handAreaRect ? handAreaRect.top - boardRect.top : sectionY('hand_user');
    const handCX = containerW / 2;
    const vertOff = MATH.center(projH, handAreaRect ? handAreaRect.height : layout.sectionHeights.hand_user);

    for (let i = 0; i < sorted.length; i++) {
      const card = sorted[i];
      const cd = hCorners[i];
      if (!cd) continue;
      if (card.id === activeDragId) {
        positioned.add(card.id); // Mark positioned so cleanup doesn't park it offscreen
        continue; // But skip cone-slot render — hand-sort.js is positioning it at the cursor
      }
      positioned.add(card.id);
      const isSel = selectedCard && selectedCard.id === card.id;

      if (isSel) {
        const cx4 = (cd.TL.x + cd.TR.x + cd.BL.x + cd.BR.x) / 4;
        const cx = baseX + handCX + cx4;
        const cy = baseY + vertOff + cardH / 2 - liftPx;   // lift rises into the gap above
        updateCardVisual(card.id, { faceUp:true, zIndex:CONFIG.ui.zIndex.selected, selected:true, onclick:()=>selectCard(card.id), immediate });
        fourCornerRenderer.renderCard(card.id, flatCorners(cx, cy), !!immediate);
      } else {
        const corners = {
          TL: { x: baseX + cd.TL.x + handCX, y: baseY + cd.TL.y + offsetSY + vertOff },
          TR: { x: baseX + cd.TR.x + handCX, y: baseY + cd.TR.y + offsetSY + vertOff },
          BL: { x: baseX + cd.BL.x + handCX, y: baseY + cd.BL.y + offsetSY + vertOff },
          BR: { x: baseX + cd.BR.x + handCX, y: baseY + cd.BR.y + offsetSY + vertOff }
        };
        updateCardVisual(card.id, { faceUp:true, zIndex:3000+i, selected:false, onclick:()=>selectCard(card.id), immediate });
        fourCornerRenderer.renderCard(card.id, corners, !!immediate);
        const _m = fourCornerRenderer.computeTransformMatrix(corners);
        if (_m) { _handFinalTf[String(card.id)] = 'matrix3d(' + _m.join(',') + ')'; _handCorners[String(card.id)] = corners; _handZ[String(card.id)] = 3000 + i; }
      }
    }
  }

  // --- OPPONENT HAND (mirrored cone, face-down) ---
  const oppHand = getCards(gameState, 'hands', oppSlot);
  const oppHandRow = document.getElementById('hand_opp');
  if (oppHand.length > 0 && oppHandRow) {
    const oppW = oppHandRow.offsetWidth || CONFIG.ui.fallbackWidth;
    const oppCone = computeCone(oppHand.length, oppW);
    let oMinY = Infinity, oMaxY = -Infinity;
    const oCorners = [];
    for (let i = 0; i < oppHand.length; i++) {
      const c = computeHandCardCorners(i, oppHand.length, oppCone);
      if (!c) continue;
      for (const p of c.corners) { if (p.y < oMinY) oMinY = p.y; if (p.y > oMaxY) oMaxY = p.y; }
      oCorners.push(c);
    }
    const oppRect = oppHandRow.getBoundingClientRect();
    const oppBaseX = oppRect.left - boardRect.left;
    const oppBaseY = oppRect.top - boardRect.top;
    const oppCX = oppW / 2;
    const visH = oppRect.height || Math.round(cardH * 0.35);
    const projHO = oMaxY - oMinY;
    // The opponent hand is the exact VERTICAL MIRROR of the user hand. Neither band
    // reserves the selected-card lift now, so both fans simply CENTRE in their band:
    // the user hand via MATH.center(projH, handAreaRect.height) above, the mirror via
    // (visH - projHO)/2 here (oppLiftPx stays 0 to keep the two in lockstep).
    const oppLiftPx = 0;   // opp hand never lifts a card — fan just fills its band
    // LAB PATCH — the lab reveals the opponent's hand in LIVE play. Upstream
    // only ever revealed it during replay; the `LAB.revealOpp ||` prefix is the
    // whole change, and with LAB absent this is the stock expression. The
    // corner-swap below (which un-mirrors the numerals) already keys off
    // revealOpp, so a revealed live hand reads right-side-up for free.
    const revealOpp = (typeof LAB !== 'undefined' && LAB.revealOpp) ||
                      (typeof _replayActive !== 'undefined' && _replayActive &&
                       typeof _replayRevealHands !== 'undefined' && _replayRevealHands);
    const mirrorY = (y) => -(y - oMaxY) + (visH - projHO - oppLiftPx) / 2;

    for (let i = 0; i < oppHand.length; i++) {
      const card = oppHand[i];
      const cd = oCorners[i];
      if (!cd) continue;
      positioned.add(card.id);
      const pt = (c) => ({ x: oppBaseX + cd[c].x + oppCX, y: oppBaseY + mirrorY(cd[c].y) });
      // The opponent hand is vertically mirrored (mirrorY) so it fans from the
      // top edge. That mirror also flips the FACE content upside-down — fine
      // while it's a face-DOWN peek, but on Reveal the numerals read inverted.
      // Un-flip by swapping the source top/bottom rows (TL<->BL, TR<->BR): the
      // four screen points (the card's footprint) are UNCHANGED, only which
      // source corner maps where — so the face rights itself without the card
      // moving. Face-down peek keeps the natural mapping.
      const corners = revealOpp
        ? { TL: pt('BL'), TR: pt('BR'), BL: pt('TL'), BR: pt('TR') }
        : { TL: pt('TL'), TR: pt('TR'), BL: pt('BL'), BR: pt('BR') };
      // In replay, clicking an opponent CARD toggles Reveal (so reveal triggers
      // only on the hand itself or the eye — not the whole empty row).
      updateCardVisual(card.id, { faceUp:revealOpp, zIndex:(revealOpp?7000:3000)+i, selected:false,
        onclick: (typeof _replayActive !== 'undefined' && _replayActive && typeof toggleReplayReveal === 'function') ? toggleReplayReveal : null });
      fourCornerRenderer.renderCard(card.id, corners, !!immediate);
    }
  }

  // --- PLAY PILES (both players, orthographic with jitter) ---
  const canUndo = lastPlayedCard && gameState.phase === 'draw' && isMyTurn;
  for (const [slot, secId] of [[userSlot,'play_user'],[oppSlot,'play_opp']]) {
    const secTop = sectionY(secId);
    CONFIG.colors.forEach((color, ci) => {
      const pile = getCards(gameState, 'playPiles', slot, color);
      const who = slot === userSlot ? 'my' : 'opp';
      const isExp = spreadPile && spreadPile.who === who && spreadPile.color === color;
      // Expanded: fan wide but contained within the play section (no hand overlap).
      const offset = pile.length > 0 ? (isExp ? expandedFanOffset(pile.length, cardH) : stackOffset(pile.length)) : 0;
      // The played cards derive their top off playPileTop — the SAME function the
      // empty pile-space uses — so a played card always lands on its slot's centre
      // (not a separate number that happens to match). pileH excludes ghost cards.
      const pileH = pile.length > 0 ? cardH + (pile.length - 1) * offset : cardH;
      const top = playPileTop(pileH, slotPad, sectionH);
      const cx = colCenterX(secId, ci);
      pile.forEach((card, i) => {
        positioned.add(card.id);
        const cy = secTop + top + slotPad/2 + i*offset + cardH/2;
        const isTop = i === pile.length - 1;
        const isUndoTarget = isTop && slot === userSlot && canUndo && lastPlayedCard.to === 'play' && lastPlayedCard.color === color;
        const zBase = pileZBase(who, color, isExp); // Expanded piles float above everything
        updateCardVisual(card.id, {
          faceUp: true, zIndex: zBase + i, selected: false,
          undoable: isUndoTarget,
          onclick: isUndoTarget ? () => undoLastPlay() : null,
          immediate
        });
        fourCornerRenderer.renderCard(card.id, pileCorners(card.id, i, cx, cy), !!immediate);
      });
    });
  }

  // --- GHOST CARDS (play destinations + discard destinations) ---
  // All ghost cards rendered in card-pool for consistent z-order and appearance
  document.querySelectorAll('#card-pool .ghost-card').forEach(el => el.remove());
  if (inPlayPhase && isMyTurn && selectedCard) {
    const pool = document.getElementById('card-pool');
    // Helper: create and position a ghost card in the pool
    function addGhost(cx, cy, label, onclick) {
      const ghost = document.createElement('div');
      ghost.className = 'card-wrapper ghost-card';
      ghost.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;z-index:2999;pointer-events:auto;cursor:pointer';
      ghost.onclick = onclick;
      ghost.innerHTML = `<div class="card target" style="opacity:0.4;border:var(--border-w-thick) dashed var(--gold-bright);background:transparent"><span class="target-label">${label}</span></div>`;
      pool.appendChild(ghost);
      const corners = flatCorners(cx, cy);
      const matrix = fourCornerRenderer.computeTransformMatrix(corners);
      if (matrix) ghost.style.transform = `matrix3d(${matrix.join(',')})`;
    }

    CONFIG.colors.forEach((color, ci) => {
      // Play pile ghost
      const playCards = getCards(gameState, 'playPiles', userSlot, color);
      if (selectedCard.color === color && canPlayOnPlayPile(selectedCard, playCards)) {
        const ghostN = playCards.length + 1;
        const ghostOff = stackOffset(ghostN);
        const ghostPileH = cardH + (ghostN - 1) * ghostOff;
        const pTop = playPileTop(ghostPileH, slotPad, sectionH);  // land exactly where the card will play
        const pSecTop = sectionY('play_user');
        const pCx = colCenterX('play_user', ci);
        const pCy = pSecTop + pTop + slotPad/2 + playCards.length * ghostOff + cardH/2;
        addGhost(pCx, pCy, 'Play', () => playToExpedition(color));
      }

      // Discard pile ghost (always available for matching color during play phase)
      if (!isSingle && selectedCard.color === color) {
        const discCards = getCards(gameState, 'discards', color);
        const dTop = playPileTop(cardH, slotPad, midH);
        const dSecTop = sectionY('discard_draw');
        const dCx = colCenterX('discard_draw', ci);
        const dCy = dSecTop + dTop + slotPad/2 + cardH/2; // offset=0, ghost on top of collapsed pile
        addGhost(dCx, dCy, 'Discard', () => discardTo(color));
      }
    });

    // Single pile mode: one discard ghost at column 0
    if (isSingle) {
      const dTop = playPileTop(cardH, slotPad, midH);
      const dSecTop = sectionY('discard_draw');
      const dCx = colCenterX('discard_draw', 0);
      const dCy = dSecTop + dTop + slotPad/2 + cardH/2;
      addGhost(dCx, dCy, 'Discard', () => discardToSingle());
    }
  }

  // --- DISCARD PILES (unified: classic per-color OR single shared) ---
  {
    const dSecTop = sectionY('discard_draw');
    const dTop = playPileTop(cardH, slotPad, midH);
    if (isSingle) {
      // Single shared discard — column 0, collapsed (offset=0) unless expanded
      const pile = getCards(gameState, 'singlePile');
      const isExp = spreadPile && spreadPile.who === 'discard' && spreadPile.color === 'single';
      // Expanded: fan contained within the middle row, CENTRED by its full height
      // (was fixed at the 1-card top, so it only grew downward into the play piles).
      const offset = isExp ? expandedFanOffset(pile.length, cardH) : 0;
      const pTop = isExp ? playPileTop(cardH + (pile.length-1)*offset, slotPad, midH) : dTop;
      const cx = colCenterX('discard_draw', 0);
      pile.forEach((card, i) => {
        positioned.add(card.id);
        const cy = dSecTop + pTop + slotPad/2 + i*offset + cardH/2;
        const isTop = i === pile.length - 1;
        const isUndoSingle = isTop && canUndo && lastPlayedCard.to === 'single';
        const zBase = pileZBase('discard', 'single', isExp);
        updateCardVisual(card.id, { faceUp:true, zIndex:zBase+i, selected:false, undoable:isUndoSingle, onclick:isUndoSingle ? ()=>undoLastPlay() : null, immediate });
        fourCornerRenderer.renderCard(card.id, pileCorners(card.id, i, cx, cy), !!immediate);
      });
    } else {
      // Classic: one discard pile per color, each collapsed unless expanded
      CONFIG.colors.forEach((color, ci) => {
        const pile = getCards(gameState, 'discards', color);
        const isExp = spreadPile && spreadPile.who === 'discard' && spreadPile.color === color;
        // Expanded: fan contained within the middle row, CENTRED by its full height
        // (was fixed at the 1-card top, so it only grew downward into the play piles).
        const offset = isExp ? expandedFanOffset(pile.length, cardH) : 0;
        const pTop = isExp ? playPileTop(cardH + (pile.length-1)*offset, slotPad, midH) : dTop;
        const cx = colCenterX('discard_draw', ci);
        pile.forEach((card, i) => {
          positioned.add(card.id);
          const cy = dSecTop + pTop + slotPad/2 + i*offset + cardH/2;
          const isTop = i === pile.length - 1;
          const isUndoDiscard = isTop && canUndo && lastPlayedCard.to === 'discard' && lastPlayedCard.color === color;
          const zBase = pileZBase('discard', color, isExp);
          updateCardVisual(card.id, { faceUp:true, zIndex:zBase+i, selected:false, undoable:isUndoDiscard, onclick:isUndoDiscard ? ()=>undoLastPlay() : null, immediate });
          fourCornerRenderer.renderCard(card.id, pileCorners(card.id, i, cx, cy), !!immediate);
        });
      });
    }
  }

  // --- DRAW PILE (face-down, stacked with jitter for visual depth) ---
  // Always the rightmost column in discard_draw (unified for classic and single)
  const drawPile = getCards(gameState, 'drawPile');
  const nDiscCols = useSinglePile() ? 1 : CONFIG.colors.length;
  const drawCX = colCenterX('discard_draw', nDiscCols); // rightmost column
  const drawSecY = sectionY('discard_draw');
  const drawTop = playPileTop(cardH, slotPad, midH);  // match the discard slot centring
  // Only show top N cards visually (rest hidden behind)
  const maxShow = CONFIG.ui.maxDrawPileShow || 10;
  // Replay-only deck inspection: tapping cycles normal → flipped (face-up, stacked) →
  // expanded (face-up, fanned). The fan REUSES the pile spread system — spreadPile /
  // collapsingPile / expandedFanOffset / pileZBase — exactly like a spread discard pile.
  const inReplay = (typeof _replayActive !== 'undefined' && _replayActive);
  const revealDeck = inReplay && typeof _replayDeckFaceUp !== 'undefined' && _replayDeckFaceUp;
  const deckExp = spreadPile && spreadPile.who === 'deck';                        // fanned
  const deckCollapsing = collapsingPile && collapsingPile.who === 'deck';         // fan collapsing back
  const cyDeck = drawSecY + drawTop + slotPad/2 + cardH/2;
  const deckOff = deckExp ? expandedFanOffset(drawPile.length, cardH) : 0;
  const deckFanTop = drawSecY + (deckExp ? playPileTop(cardH + (drawPile.length - 1) * deckOff, slotPad, midH) : drawTop);
  const deckZBase = pileZBase('deck', 'deck', deckExp);                           // floats at 3500 while fanned/collapsing
  // In REPLAY, order the deck by the sequence cards are actually DRAWN (draws are
  // recorded actions, not pop()) and put the next-drawn card on top ALWAYS — so a
  // draw animates the top card, not a random middle one; the flip then reveals
  // them top-to-bottom in draw order. In LIVE, drawFromDeck pops the last element,
  // which the existing array-order stack already puts on top — so live is unchanged.
  let deckSeq = drawPile;
  if (inReplay && typeof _replayData !== 'undefined' && _replayData && typeof _replayStep !== 'undefined') {
    const order = new Map();
    let n = 0;
    for (let k = _replayStep; k < _replayData.actions.length; k++) {
      const a = _replayData.actions[k];
      if (a && a.type === 'draw' && (a.drawFrom === 'deck' || a.source === 'deck') && a.card && !order.has(a.card.id)) order.set(a.card.id, n++);
    }
    const idx = c => order.has(c.id) ? order.get(c.id) : n + drawPile.indexOf(c); // never-drawn keep tail order
    deckSeq = drawPile.slice().sort((x, y) => idx(x) - idx(y));  // j=0 = next drawn
  }
  deckSeq.forEach((card, j) => {
    positioned.add(card.id);
    const i = drawPile.indexOf(card);
    // Fanned (and its collapse) shows EVERY card so the whole fan animates in/out;
    // otherwise only the top few draw, the rest hide behind the stack.
    const visible = (deckExp || deckCollapsing) ? true : (inReplay ? (j < maxShow) : (i >= drawPile.length - maxShow));
    const jitterIdx = inReplay ? j : (visible ? i - (drawPile.length - maxShow) : 0);
    updateCardVisual(card.id, {
      faceUp: revealDeck,
      // Next-drawn on top. Replay: by draw order (j=0 highest). Live: array order.
      zIndex: inReplay ? (deckZBase + (deckSeq.length - j)) : (2000 + jitterIdx),
      selected: false,
      // stopPropagation: the deck fully handles its own click via the cycle; without
      // it, the click bubbles to the global click-outside-collapse handler
      // (gamelogic.js), which — because deck cards live in #card-pool, not a .card-col —
      // reads it as "outside" and instantly collapses the fan we just opened.
      onclick: inReplay ? (e) => { if (e) e.stopPropagation(); toggleReplayDeck(); } : null
    });
    if (deckExp) {
      // Fanned in draw order, cascading UPWARD (next-drawn j=0 at the bottom-front),
      // centred in the middle row.
      const cy = deckFanTop + slotPad/2 + (deckSeq.length - 1 - j)*deckOff + cardH/2;
      fourCornerRenderer.renderCard(card.id, pileCorners(card.id, j, drawCX, cy), !!immediate);
    } else if (visible) {
      // Stacked at the deck (normal, flipped, and collapsing-back all animate to here).
      // Constant jitter index (0) so a card's jitter is fixed as the pile changes.
      fourCornerRenderer.renderCard(card.id, pileCorners(card.id, 0, drawCX, cyDeck), !!immediate);
    } else {
      fourCornerRenderer.renderCard(card.id, flatCorners(drawCX, cyDeck), true);
    }
  });

  // Deck "N left" count — in the pile-score layer (z above #card-pool) so it's
  // ABOVE the deck cards + their drop-shadows, and hugs the deck's bottom edge.
  {
    let scLayer = document.getElementById('pile-score-layer');
    if (!scLayer) { scLayer = document.createElement('div'); scLayer.id = 'pile-score-layer'; boardEl.appendChild(scLayer); }
    let dc = document.getElementById('psc-deck');
    if (!dc) { dc = document.createElement('div'); dc.id = 'psc-deck'; dc.className = 'pile-score'; dc.style.transition = `top ${(CONFIG.ui && CONFIG.ui.animMs) || 300}ms var(--ease-inout), opacity var(--dur-snap) var(--anim-ease)`; scLayer.appendChild(dc); }
    const _clear = Math.round(lvl(5, cardH));   // clears the deck's jitter + drop-shadow
    if (useSinglePile()) {
      dc.style.left = (drawCX + cardW / 2 + _clear) + 'px'; dc.style.top = cyDeck + 'px';
      dc.style.transform = 'translateY(-50%)'; dc.style.textAlign = 'left';
    } else {
      dc.style.left = drawCX + 'px'; dc.style.top = (cyDeck + cardH / 2 + _clear) + 'px';
      dc.style.transform = 'translateX(-50%)'; dc.style.textAlign = 'center';
    }
    dc.innerHTML = renderText(String(drawPile.length), 4, { font:'cinzel', extraStyle:'display:block' });
    // Colour on the PERSISTENT dc element (the inner span inherits) so the heat ramp
    // can transition smoothly as the deck depletes, instead of snapping each rebuild.
    dc.style.color = deckCountColor(drawPile.length);
    dc.style.transition = `top ${(CONFIG.ui && CONFIG.ui.animMs) || 300}ms var(--ease-inout), opacity var(--dur-snap) var(--anim-ease), color var(--dur-fade) var(--anim-ease)`;
    // Dimmed to sit quietly under the deck; hidden entirely when the Deck Count toggle is off.
    dc.style.opacity = ((typeof deckCountEnabled === 'undefined' || deckCountEnabled) && drawPile.length > 0) ? '0.6' : '0';
  }

  // Hide unpositioned cards off-screen
  for (const [cardId] of cardPoolMap) {
    if (!positioned.has(cardId)) {
      updateCardVisual(cardId, { faceUp:false, zIndex:-1, selected:false, onclick:null });
      fourCornerRenderer.renderCard(cardId, flatCorners(-200, -200), true);
    }
  }

  // Per-pile scores in a PERSISTENT layer, positioned here (colCenterX/sectionY)
  // with a CSS top-transition, so they GLIDE when a pile expands rather than
  // jumping with the row's innerHTML rebuild — matching the cards' movement.
  positionPileScores();
  function positionPileScores() {
    let layer = document.getElementById('pile-score-layer');
    if (!layer) { layer = document.createElement('div'); layer.id = 'pile-score-layer'; boardEl.appendChild(layer); }
    const animMs = (CONFIG.ui && CONFIG.ui.animMs) || 300;
    const present = new Set();
    for (const s of _pileScores) {
      present.add(s.id);
      let el = document.getElementById('psc-' + s.id);
      const isNew = !el;
      if (isNew) {
        el = document.createElement('div'); el.id = 'psc-' + s.id; el.className = 'pile-score';
        el.style.opacity = '0';   // hidden until its card lands (see below)
        el.style.transition = `top ${animMs}ms var(--ease-inout), opacity ${animMs}ms var(--anim-ease)`;
        layer.appendChild(el);
      }
      el.style.left = colCenterX(s.secId, s.col) + 'px';
      el.style.top = (sectionY(s.secId) + s.top) + 'px';
      const riv = (liveScoreEnabled && s.riv > 0) ? `<span class="ps-riv" style="${s.pos === 'above' ? 'bottom:100%' : 'top:100%'}">+${s.riv}</span>` : '';
      // Per-pile scores: sign-coloured but DIMMED — quieter than the full-strength
      // running total, so the total reads as the headline (CEO: dim > bigger/bolder).
      el.className = 'pile-score ' + ptsClass(s.score);   // metallic points fill
      el.innerHTML = renderText(s.score, 4, { align:'center', extraStyle:'display:block' }) + riv;
      const PILE_DIM = '1';   // no dim — the metallic fill now distinguishes points; size separates per-pile from the total
      if (!liveScoreEnabled) el.style.opacity = '0';
      else if (isNew) { const _e = el; setTimeout(() => { _e.style.opacity = PILE_DIM; }, animMs); } // a brand-new pile's score waits for the played card to land before fading in
      else el.style.opacity = PILE_DIM;
    }
    for (const el of Array.from(layer.children)) {
      if (el.id !== 'psc-deck' && !present.has(el.id.replace('psc-', ''))) el.style.opacity = '0';   // psc-deck (deck count) is managed separately
    }
  }
}

// ===== BOARD STRUCTURE (pile spaces, labels, scores — NO cards) =====
function renderBoardStructure(layout) {
  const oppSlot = userSlot === 'player1' ? 'player2' : 'player1';
  const isMyTurn = gameState.currentTurn === userSlot;
  const inPlayPhase = gameState.phase === 'play';
  const inDrawPhase = gameState.phase === 'draw';
  // In replay, playback is inspect-only: no game action fires, so every pile falls
  // through to toggleSpread (expand) and the deck to its cycle.
  const inReplay = (typeof _replayActive !== 'undefined' && _replayActive);
  const canUndo = !inReplay && lastPlayedCard && inDrawPhase && isMyTurn;
  const drawPileLen = getCards(gameState, 'drawPile').length;

  const cardH = layout.cardH, cardW = layout.cardW, slotPad = layout.slotPad;
  const playScoreH = layout.playScoreH;
  const cardContentH = layout.playContentH;
  const sectionH = layout.sectionHeights.play_row;

  // Post-jitter card edge: each card is jittered up to ±3px + ±3° (deterministic
  // from card.id + index), so the score hugs the ACTUAL lowest/highest edge, not
  // the un-jittered pile box. Extent = the whole-card offsetY plus the rotated
  // card's horizontal throw (its corner drops by ~cardW/2·sinθ). Same card.id +
  // index the renderer uses, so this matches exactly what's drawn.
  function jitterEdge(card, index) {
    const j = fourCornerRenderer.computeJitter(card.id, index);
    const throw_ = Math.abs(cardW / 2 * Math.sin(j.rotation));
    return { down: j.offsetY + throw_, up: throw_ - j.offsetY };
  }
  // Breathing room between the pile's farthest (post-jitter) card edge and its
  // score label = the score text's own leading (line-height − font-size at the
  // body tier). line = font × --leading, so the gap = font × (leading − 1). Standard,
  // not a magic px.
  const _cs = getComputedStyle(document.documentElement);
  const _tmd = parseFloat(_cs.getPropertyValue('--text-body'));
  const _lead = parseFloat(_cs.getPropertyValue('--leading'));
  // Score = the text's full line box (font × leading), positioned so the LINE BOX
  // TOUCHES the pile's post-jitter extent (no extra gap). The glyph's own half-leading
  // inside the box is the only visible breathing room. User-side score sits ABOVE its
  // pile, so it's bottom-aligned by subtracting this height.
  const scoreLineH = Math.round(_tmd * _lead);

  // SINGLE symmetric derivation for both play halves — and the SAME playPileTop
  // the played cards (positionAllCards) use, so the empty slot, the played cards
  // and the score label are all one derivation, symmetric by construction (not
  // separate numbers that happen to match). `stackH` = the cards' height (cardH
  // for one card). The score sits just past the cards on the INNER (middle-ward)
  // side: user above the pile, opp below it — the vertical mirror.
  function playContentLayout(stackH, isUser) {
    const pileTop     = playPileTop(stackH, slotPad, sectionH);  // slot top (both sides)
    const cardsTop    = pileTop + slotPad/2;                     // first card's top
    const cardsBottom = cardsTop + stackH;                       // last card's bottom
    const scoreTop    = isUser ? (cardsTop - scoreLineH) : cardsBottom;
    return { pileTop, scoreTop };
  }
  const cbLabel = c => colorblindMode ? renderText(CONFIG.colorSymbols[c], 5, { opacity:CONFIG.ui.opacity.faint, extraStyle:'position:absolute;bottom:var(--border-w);left:50%;transform:translateX(-50%)' }) : '';

  function pileSpaceHTML(top, color, label) {
    const cls = label ? 'card target' : 'card pile-space';
    // Empty slot is a neutral felt well (styles.css); colour only drives the colourblind
    // symbol, not the well itself.
    const content = label ? '<span class="target-label">'+label+'</span>' : (color ? cbLabel(color) : '');
    return `<div class="${cls}" style="position:absolute;top:${top}px;left:50%;transform:translateX(-50%)">${content}</div>`;
  }


  const playColCount = liveScoreEnabled ? CONFIG.colors.length + 1 : CONFIG.colors.length;

  // Compute rivalry for live scores
  let liveRivalry = null;
  if (liveScoreEnabled && gameState.playPiles) {
    const myPiles = gameState.playPiles[userSlot];
    const oPiles = gameState.playPiles[oppSlot];
    if (myPiles && oPiles) {
      const r = MATH.scoreWithRivalry(myPiles, oPiles);
      liveRivalry = r.my.rivalryPerColor;
    }
  }

  // --- Opponent play row ---
  const oppRow = document.getElementById('play_opp');
  oppRow.style.gridTemplateColumns = `repeat(${playColCount},var(--col-w))`;
  // Empty pile-space position — centred by its real height, identical both sides.
  const pileSpaceTop = playContentLayout(cardH, false).pileTop;
  const pileSpaceTopUser = playContentLayout(cardH, true).pileTop;
  _pileScores = [];   // filled here, positioned (persistent + gliding) in positionAllCards
  let oppHTML = CONFIG.colors.map((c, ci) => {
    const cards = getCards(gameState, 'playPiles', oppSlot, c);
    const ps = pileSpaceHTML(pileSpaceTop, c, '');
    // Score sits BELOW the actual pile bottom (playPileTop derivation + the bottom
    // card's post-jitter edge). Collected for the persistent score layer.
    if (cards.length > 0) {
      const isExp = spreadPile && spreadPile.who === 'opp' && spreadPile.color === c;
      const off = isExp ? expandedFanOffset(cards.length, cardH) : Math.round(MATH.stackOffset(cards.length, cardH));
      const pH = cardH + (cards.length - 1) * off;
      const oppRiv = liveRivalry && liveRivalry[c] ? liveRivalry[c].opp : 0;
      const edge = jitterEdge(cards[cards.length - 1], cards.length - 1).down;
      _pileScores.push({ id:'opp-'+c, secId:'play_opp', col:ci, top: playContentLayout(pH, false).scoreTop + edge, score: MATH.scorePlayPile(cards), riv:oppRiv, pos:'below' });
    }
    const onclick = cards.length > 0 ? ` onclick="toggleSpread('opp','${c}')"` : '';
    return `<div class="card-col" style="height:${sectionH}px"${onclick}>${ps}</div>`;
  }).join('');
  if (liveScoreEnabled) {
    const oppRivTotal = liveRivalry ? Object.values(liveRivalry).reduce((s,r) => s + (r.opp||0), 0) : 0;
    const oppS = gameState.playPiles ? MATH.scoreBreakdown(gameState.playPiles[oppSlot]) : null;
    const t = (oppS ? oppS.total : 0) + oppRivTotal;
    // Always show the running total (incl. a plain "0" before the first play),
    // symmetric with the user total below — never blank one side.
    const sc = `<span class="${ptsClass(t)}">` + renderText(t, 3, { font:'cinzel', cls:'t-emphasis' }) + `</span>`;  // t-emphasis = half-φ bump above body: out-sizes per-pile scores, small enough not to clip its slot
    const scoreMidY = pileSpaceTop + (cardH + slotPad) / 2;
    const rScore = (typeof _replayActive !== 'undefined' && _replayActive);
    // In replay the total opens the full results — the WHOLE cell is the target
    // (the pill is just the affordance), not only the text.
    const scInner = rScore ? `<span class="score-pill">${sc}</span>` : sc;
    oppHTML += `<div class="card-col"${rScore?' onclick="showReplayResults()"':''} style="height:${sectionH}px;position:relative;${rScore?'cursor:pointer':''}"><div style="position:absolute;top:${scoreMidY}px;left:0;right:0;transform:translateY(-50%);text-align:center">${scInner}</div></div>`;
  }
  oppRow.innerHTML = oppHTML;

  // --- Discard/draw row (unified: n_discard + 1 draw column) ---
  // Classic: 5 discard + 1 draw = 6 columns. Single: 1 discard + 1 draw = 2 columns.
  const discardRow = document.getElementById('discard_draw');
  const singleContainer = document.getElementById('single-pile-area');
  const drawPileSlot = document.getElementById('draw-pile-slot');
  if (singleContainer) singleContainer.style.display = 'none';
  if (drawPileSlot) drawPileSlot.style.display = 'none';
  discardRow.style.display = '';
  const midH = layout.sectionHeights.discard_draw;
  const isSingle = useSinglePile();
  const discardTop = playPileTop(cardH, slotPad, midH);  // same derivation as the play slots

  // Discard columns
  let discHTML = '';
  if (isSingle) {
    // Single shared discard pile
    const pile = getCards(gameState, 'singlePile');
    const topCard = pile.length > 0;
    const canDrawSingle = !inReplay && inDrawPhase && isMyTurn && topCard && gameState.lastDiscardTarget !== 'single';
    const canDiscardSingle = !inReplay && inPlayPhase && isMyTurn && selectedCard;
    const hasAction = canDrawSingle || canDiscardSingle;
    const handler = hasAction ? (inDrawPhase ? 'drawFromSingle()' : 'discardToSingle()') : (pile.length >= 1 ? "toggleSpread('discard','single')" : '');
    const ps = pileSpaceHTML(discardTop, null, '');
    discHTML = `<div class="card-col" style="height:${midH}px" onclick="${handler}">${ps}</div>`;
  } else {
    // Classic: one discard per color
    discHTML = CONFIG.colors.map(c => {
      const pile = getCards(gameState, 'discards', c);
      const topCard = pile.length > 0;
      const canDraw = !inReplay && inDrawPhase && isMyTurn && topCard && c !== gameState.lastDiscardTarget;
      const canDiscard = !inReplay && selectedCard && selectedCard.color === c && inPlayPhase && isMyTurn;
      const hasAction = canDraw || canDiscard;
      const handler = hasAction ? (inDrawPhase ? `drawFromDiscard('${c}')` : `discardTo('${c}')`) : (pile.length >= 1 ? `toggleSpread('discard','${c}')` : '');
      const ps = pileSpaceHTML(discardTop, c, '');
      return `<div class="card-col" style="height:${midH}px" onclick="${handler}">${ps}</div>`;
    }).join('');
  }

  // Draw pile column (always rightmost). The "N left" count sits BELOW the draw
  // pile in classic (the 6 columns fill the width — no room beside it), but in
  // single-pile mode there's empty space to the right, so put it there, vertically
  // centred on the pile — cleaner than hanging under it.
  const drawPs = pileSpaceHTML(discardTop, null, (!inReplay && isMyTurn && inDrawPhase) ? 'Draw' : '');
  // Just the number — at the body floor "N left" no longer fits on one line under
  // the narrow deck column, and a lone count on the only face-down stack is clear.
  // The "N left" deck count is rendered in the pile-score LAYER (positionAllCards)
  // so it sits ABOVE the deck cards + their shadows — it's an annotation, not part
  // of the board's physical stack — and hugs the deck's bottom like a per-pile score.
  discHTML += `<div class="card-col" style="height:${midH}px" onclick="${inReplay ? 'event.stopPropagation();toggleReplayDeck()' : 'drawFromDrawPile()'}">${drawPs}</div>`;

  const nDiscardCols = isSingle ? 1 : CONFIG.colors.length;
  discardRow.style.gridTemplateColumns = `repeat(${nDiscardCols},var(--col-w)) var(--col-w)`;
  discardRow.innerHTML = discHTML;

  // --- User play row ---
  const myRow = document.getElementById('play_user');
  myRow.style.gridTemplateColumns = `repeat(${playColCount},var(--col-w))`;
  let myHTML = CONFIG.colors.map((c, ci) => {
    const realCards = getCards(gameState, 'playPiles', userSlot, c);
    const canPlay = !inReplay && selectedCard && selectedCard.color === c && inPlayPhase && isMyTurn && canPlayOnPlayPile(selectedCard, realCards);
    const isUndoTarget = canUndo && lastPlayedCard.to === 'play' && lastPlayedCard.color === c;
    const ps = pileSpaceHTML(pileSpaceTopUser, c, '');
    // Score sits ABOVE the actual pile top. Collected for the persistent score layer.
    if (realCards.length > 0) {
      const isExpM = spreadPile && spreadPile.who === 'my' && spreadPile.color === c;
      const offM = isExpM ? expandedFanOffset(realCards.length, cardH) : Math.round(MATH.stackOffset(realCards.length, cardH));
      const pHM = cardH + (realCards.length - 1) * offM;
      const myRiv = liveRivalry && liveRivalry[c] ? liveRivalry[c].my : 0;
      const edge = jitterEdge(realCards[0], 0).up;
      _pileScores.push({ id:'my-'+c, secId:'play_user', col:ci, top: playContentLayout(pHM, true).scoreTop - edge, score: MATH.scorePlayPile(realCards), riv:myRiv, pos:'above' });
    }
    const stackClick = canPlay || isUndoTarget ? `playToExpedition('${c}')` : `toggleSpread('my','${c}')`;
    return `<div class="card-col" style="height:${sectionH}px" onclick="${stackClick}">${ps}</div>`;
  }).join('');
  if (liveScoreEnabled) {
    const myRivTotal = liveRivalry ? Object.values(liveRivalry).reduce((s,r) => s + (r.my||0), 0) : 0;
    const myS = gameState.playPiles ? MATH.scoreBreakdown(gameState.playPiles[userSlot]) : null;
    const t = (myS ? myS.total : 0) + myRivTotal;
    // Always show the running total (incl. a plain "0" before the first play) —
    // never hide it. Gold when >=0, red only when genuinely negative.
    const sc = `<span class="${ptsClass(t)}">` + renderText(t, 3, { font:'cinzel', cls:'t-emphasis' }) + `</span>`;  // t-emphasis = half-φ bump above body: out-sizes per-pile scores, small enough not to clip its slot
    const scoreMidYUser = pileSpaceTopUser + (cardH + slotPad) / 2;
    const rScoreU = (typeof _replayActive !== 'undefined' && _replayActive);
    const scInnerU = rScoreU ? `<span class="score-pill">${sc}</span>` : sc;
    myHTML += `<div class="card-col"${rScoreU?' onclick="showReplayResults()"':''} style="height:${sectionH}px;position:relative;${rScoreU?'cursor:pointer':''}"><div style="position:absolute;top:${scoreMidYUser}px;left:0;right:0;transform:translateY(-50%);text-align:center">${scInnerU}</div></div>`;
  }
  myRow.innerHTML = myHTML;
}

// The cards in a play/discard pile, whichever kind `who` names.
function _pileCardsFor(who, color) {
  if (who === 'deck') return getCards(gameState, 'drawPile');   // replay: the deck spreads like a pile
  if (who === 'discard') {
    return color === 'single' ? getCards(gameState, 'singlePile') : getCards(gameState, 'discards', color);
  }
  const slot = who === 'my' ? userSlot : (userSlot === 'player1' ? 'player2' : 'player1');
  return getCards(gameState, 'playPiles', slot, color);
}

// Tiny wobble on a pile's cards — tactile feedback for a tap that can't do
// anything useful (a 1–2 card pile has nothing to spread). Runs on the inner
// .card face so it doesn't fight the wrapper's positioning transform.
function jigglePile(cards) {
  cards.forEach(c => {
    const entry = cardPoolMap.get(c.id);
    const face = entry && entry.el && entry.el.querySelector('.card');
    if (!face) return;
    face.classList.remove('jiggle');
    void face.offsetWidth;               // reflow so the animation restarts on re-tap
    face.classList.add('jiggle');
    setTimeout(() => face.classList.remove('jiggle'), 340);
  });
}

function toggleSpread(who, color) {
  SFX.select();
  // Only a SINGLE card can't spread — jiggle it for feedback. Two cards have room
  // to spread, and a visible spread is a clearer signal than a jiggle.
  const pileCards = _pileCardsFor(who, color);
  if (pileCards.length <= 1) { jigglePile(pileCards); return; }
  if (spreadPile && spreadPile.who === who && spreadPile.color === color) {
    spreadPile = null;
    // Keep the pile floating at spread z (3000 base) until the collapse
    // animation lands — lowering z at animation START put stationary cards
    // below still-flying ones and the stack visibly reshuffled mid-flight.
    collapsingPile = { who, color };
    setTimeout(() => {
      if (collapsingPile && collapsingPile.who === who && collapsingPile.color === color) {
        collapsingPile = null;
        renderGame(); // settle the whole pile to pile-depth z in one pass
      }
    }, (CONFIG.ui.animMs || 300) + 50);
  } else {
    spreadPile = { who, color };
  }
  renderGame();
}

// Pile z base: spread (or still collapsing) piles float ABOVE everything —
// including both hand fans (the 3000 band) — at 3500; settled piles sit at 2000
// (below the hands, but they're collapsed so they never reach into a hand row).
// An expanded pile fans tall enough to overlap the opponent hand, so it has to
// out-rank it; not hacky — an expanded pile is a temporary focus overlay, and z
// is exactly the tool for that. Stays below the selected card (5000) and a
// revealed opponent hand (7000). Applied uniformly to a whole pile so within-
// pile order (zBase + index) can never invert during a transition.
function pileZBase(who, color, isExp) {
  const isFloating = isExp || (collapsingPile && collapsingPile.who === who && collapsingPile.color === color);
  return isFloating ? 3500 : 2000;
}

// ===== GAME OVER SCREEN =====
// SINGLE results-screen renderer — the live game-over AND the replay results
// both call this, so the two paths can't drift (the missing match record was one
// symptom of them diverging). Caller supplies the scores, names, the match-record
// line, and the mode; this owns ALL the DOM writes (winner text, breakdown, match
// line, buttons).
//   mode 'live'           — a game that just ended: Rematch + Main Menu, reset rematch.
//   mode 'replay-live'    — its dismissed replay reopened: Rematch + Main Menu.
//   mode 'replay-history' — a match-history replay: a back-arrow, no actions.
function populateResults({ my, opp, myWin, oppWin, myName, oppName, matchText, mode }) {
  const w = document.getElementById('winner-text');
  if (w) {
    w.textContent = myWin ? 'Victory!' : oppWin ? 'Defeated' : 'A Draw!';
    const _tc = myWin ? 'var(--gold-bright)' : oppWin ? 'var(--danger)' : 'var(--parchment)';
    w.style.cssText = `font-family:'Cinzel',serif;color:${_tc}`;   // results title: Cinzel, coloured by outcome
  }
  renderGameOverScreen(my, opp, myWin, oppWin, myName, oppName);
  const matchEl = document.getElementById('match-score');
  if (matchEl) { matchEl.innerHTML = matchText || ''; matchEl.style.display = matchText ? 'block' : 'none'; }

  const showActions = mode !== 'replay-history';   // live + replay-live keep Rematch/Leave
  const rb = document.getElementById('rematch-btn');
  const lb = document.getElementById('leave-btn');
  const hint = document.getElementById('results-hint');
  const bb = document.getElementById('results-back-btn');
  if (rb) {
    rb.style.display = showActions ? '' : 'none';
    if (mode === 'live') { rb.textContent = 'Rematch'; rb.style.opacity = ''; rb.dataset.disabled = ''; }
  }
  if (lb) { lb.style.display = showActions ? '' : 'none'; if (showActions) lb.textContent = 'Main Menu'; }
  const rvb = document.getElementById('review-btn');
  if (rvb) rvb.style.display = showActions ? '' : 'none';   // enters the game review (same as tapping the backdrop)
  if (hint) hint.style.display = 'none';
  if (bb) bb.style.display = showActions ? 'none' : '';
}

// The "You W – L Bot" head-to-head line for an AI game — shared by the live
// game-over and the replay results so the wording matches. `fold` optionally adds
// the just-finished (ranked) game into the durable tally.
// The lifetime head-to-head Record ROW for an AI game (my wins vs the bot's wins,
// draws beneath). `fold` optionally adds the just-finished ranked game into the tally.
function matchRecordText(personality, fold) {
  if (!personality || typeof loadStats !== 'function' || !(CONFIG.personalities && CONFIG.personalities[personality])) return '';
  const rec = (loadStats().byPersonality || {})[personality] || { w:0, l:0, d:0 };
  let w = rec.w||0, l = rec.l||0, d = rec.d||0;   // w = my wins, l = my losses (= bot wins), d = draws
  if (fold) { if (fold.myWin) w++; else if (fold.oppWin) l++; else d++; }
  return (w+l+d>0) ? recordRowHTML(w, l, d) : '';
}

function renderGameOverScreen(my, opp, myWin, oppWin, myName, oppName){
  const youLabel = myName || 'You';
  const oppLabel = oppName || 'Opp';
  const chex=CONFIG.colorHex;
  const neg=v=>ptsClass(v);       // metallic points (breakdown sub-values are point values too)
  const goldPlus=v=>ptsClass(v);
  const sign=v=>v>=0?'<span class="sc-sign">+</span>'+v:'<span class="sc-sign">−</span>'+Math.abs(v);
  const fmt=v=>v<0?'<span class="sc-sign">-</span>'+Math.abs(v):''+v;
  const dash='';
  // Scores colour by SIGN (one place): positive = gold, negative = red, zero = default parchment.
  const scColor = score => score>0?'class="pts"':score<0?'class="pts-neg"':'class="pts-zero"';
  function colorStyle(score,isWinner){ return scColor(score); }
  function winStyle(score,isW){ return scColor(score); }
  function row(mV,label,oV,mC,oC,extra){
    return `<div class="r-line sc-row" style="justify-content:center;${extra||''}"><span style="flex:1;text-align:left" class="${mC||''}">${mV}</span>${renderText(label, 4, {align:'center', extraStyle:'min-width:calc(var(--card-h) * 0.78);padding:0 var(--space-micro)'})}<span style="flex:1;text-align:right" class="${oC||''}">${oV}</span></div>`;
  }
  // Names sit at the two edges (space-between) and size to their content
  // (flex:0 1 auto). A short name leaves the whole middle open for the other; each
  // only ellipsises when the two would collide past the min gap between them. (Was
  // flex:1 1 0 = fixed halves, which truncated "Strategist" with a wide-open left.)
  const nameGap = 'calc(var(--card-h) * .5)';
  let html=`<div class="r-line sc-row r-names" style="justify-content:space-between;gap:${nameGap}">
    ${renderText(youLabel, 3, {font:'cinzel', extraStyle:'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left'})}${renderText(oppLabel, 3, {font:'cinzel', extraStyle:'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right'})}</div>`;
  let colorIdx=0;
  CONFIG.colors.forEach(c=>{
    const m=my.breakdown[c], o=opp.breakdown[c];
    if(m.count===0&&o.count===0)return;
    const riv=my.rivalryPerColor&&my.rivalryPerColor[c];
    const mWithRiv=m.score+(riv?riv.my:0);
    const oWithRiv=o.score+(riv?riv.opp:0);
    const mS=m.count>0?fmt(mWithRiv):'', oS=o.count>0?fmt(oWithRiv):'';
    const idx=colorIdx++;
    const mWinC=mWithRiv>oWithRiv, oWinC=oWithRiv>mWithRiv;
    // Compact: plain digits + wager icons, coloured by the pile (no boxes) — a
    // concise stats summary; wraps only in the extreme full-pile case.
    const mCards=m.count>0?(Array(m.wagers).fill(WAGER_ICON).join(' ')+(m.values.length?(m.wagers?' ':'')+m.values.join(' '):'')):'';
    const oCards=o.count>0?(Array(o.wagers).fill(WAGER_ICON).join(' ')+(o.values.length?(o.wagers?' ':'')+o.values.join(' '):'')):'';
    if(idx>0) html+=`<div class="r-sep-color"></div>`;
    html+=`<div id="sc-row-${idx}" style="cursor:pointer" onclick="toggleScore(${idx})"><div class="r-line sc-row r-color-total" style="justify-content:center"><span style="flex:1;text-align:left" ${m.count?colorStyle(m.score,mWinC):'class="r-muted"'}>${mS}</span><span style="min-width:calc(var(--card-h) * 0.78);text-align:center;padding:0 var(--space-micro);align-self:center"><span class="color-dot" style="background:${chex[c]};width:calc(var(--card-h) * var(--phi-2));height:calc(var(--card-h) * var(--phi-2));display:inline-flex;align-items:center;justify-content:center;font-size:calc(var(--card-h) * var(--phi-4))">▼</span></span><span style="flex:1;text-align:right" ${o.count?colorStyle(o.score,oWinC):'class="r-muted"'}>${oS}</span></div></div>`;
    html+=`<div id="sc-exp-${idx}" style="display:none;cursor:pointer" onclick="toggleScore(${idx})"><div class="r-line sc-row" style="justify-content:center"><span class="sc-cards" style="flex:1;text-align:left;color:${chex[c]}">${mCards}</span><span style="min-width:calc(var(--card-h) * 0.78);text-align:center;padding:0 var(--space-micro);align-self:center"><span class="color-dot" style="background:${chex[c]};width:calc(var(--card-h) * var(--phi-2));height:calc(var(--card-h) * var(--phi-2));display:inline-flex;align-items:center;justify-content:center;font-size:calc(var(--card-h) * var(--phi-4))">▲</span></span><span class="sc-cards" style="flex:1;text-align:right;color:${chex[c]}">${oCards}</span></div></div>`;
    html+=`<div id="sc-body-${idx}" style="display:none">`;
    html+=row(m.count?m.sum:dash,'Card total',o.count?o.sum:dash,m.count?neg(m.sum):'',o.count?neg(o.sum):'');
    html+=row(m.count?'<span class="sc-sign">−</span>20':dash,'Venture cost',o.count?'<span class="sc-sign">−</span>20':dash,'pts-neg','pts-neg');
    const maxW=Math.max(m.wagers,o.wagers);
    for(let i=0;i<maxW;i++) html+=row(i<m.wagers?sign(m.subtotal):dash,WAGER_ICON,i<o.wagers?sign(o.subtotal):dash,i<m.wagers?goldPlus(m.subtotal):'',i<o.wagers?goldPlus(o.subtotal):'');
    if(m.bonus||o.bonus) html+=row(m.bonus?'<span class="sc-sign">+</span>20':dash,'8+ bonus',o.bonus?'<span class="sc-sign">+</span>20':dash,m.bonus?'pts':'',o.bonus?'pts':'');
    html+=`<div class="r-sep-breakdown"></div>`;
    // Color total (pure score, no rivalry)
    html+=`<div class="r-line sc-row r-color-total" style="justify-content:center"><span style="flex:1;text-align:left" ${m.count?colorStyle(m.score,mWinC):'class="r-muted"'}>${m.count?fmt(m.score):dash}</span><span style="min-width:calc(var(--card-h) * 0.78);text-align:center;padding:0 var(--space-micro)"></span><span style="flex:1;text-align:right" ${o.count?colorStyle(o.score,oWinC):'class="r-muted"'}>${o.count?fmt(o.score):dash}</span></div>`;
    // Rivalry bonus below total (detail text size) — riv already declared above
    if(riv&&(riv.my>0||riv.opp>0)) html+=row(riv.my>0?'<span class="sc-sign">+</span>'+riv.my:dash,'Rivalry',riv.opp>0?'<span class="sc-sign">+</span>'+riv.opp:dash,riv.my>0?'pts':'',riv.opp>0?'pts':'');
    html+=`</div>`;
  });
  html+=`<div style="border-top:calc(var(--border-w) * 2) solid var(--gold);margin:0"></div>`;
  html+=`<div class="r-line sc-row" style="justify-content:center"><span style="flex:1;text-align:left;font-size:var(--text-title);line-height:var(--leading)" ${winStyle(my.total,myWin)}>${fmt(my.total)}</span><span style="min-width:calc(var(--card-h) * 0.78);text-align:center;padding:0 var(--space-micro)"></span><span style="flex:1;text-align:right;font-size:var(--text-title);line-height:var(--leading)" ${winStyle(opp.total,oppWin)}>${fmt(opp.total)}</span></div>`;
  document.getElementById('score-summary').innerHTML='';
  document.getElementById('score-details').innerHTML=html;
}

// ===== UTILITIES =====
document.addEventListener('click',function(){
  if(idleShown){
    idleShown=false;
    // For Immediate (0ms), dismiss is a one-shot clear for this turn. For 10s/30s, restart the clock.
    idleStart=(getIdleReminderMs()>0) ? Date.now() : 0;
    const ov=document.getElementById('idle-overlay');
    if(ov){ov.classList.remove('visible');ov.innerHTML='';}
  }
});

setInterval(function(){
  const idleMs=getIdleReminderMs();
  if(idleMs>=0 && idleStart && !idleShown && Date.now()-idleStart>=idleMs){
    if(typeof renderGame==='function') renderGame();
  }
},CONFIG.ui.idlePollMs);

function crossFadePhaseText(element, newContent) {
  const phaseTransitionsEnabled = localStorage.getItem(CONFIG.storagePrefix + '-phase-transitions') !== 'false';
  if (!phaseTransitionsEnabled) { element.innerHTML = newContent; return; }
  const temp = document.createElement('div');
  temp.innerHTML = newContent;
  temp.style.position = 'absolute'; temp.style.top = '0'; temp.style.left = '0'; temp.style.right = '0'; temp.style.opacity = '0';
  const fadeMs = CONFIG.ui.phaseTextMs;
  temp.style.transition = `opacity ${fadeMs}ms var(--anim-ease)`;
  element.style.position = 'relative';
  element.appendChild(temp);
  element.style.transition = `opacity ${fadeMs}ms var(--anim-ease)`;
  element.style.opacity = '0.5';
  temp.style.opacity = '1';
  setTimeout(() => { element.innerHTML = newContent; element.style.opacity = '1'; element.style.transition = ''; element.style.position = ''; }, fadeMs);
}
