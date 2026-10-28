"use strict";
/* ============================================================================
   lc-net.js — play a friend online (2026-10-27).

   New game → Online: make a room (a 5-letter code) or join one. Each player is
   on their own phone. Uses the shared kit js/online.js (byte-identical copy of
   Board and Card Games/_online/online.js, Firestore project th-board-games) with
   the rules in js/lc-online.js. The kit and the Firebase SDK load only when
   someone opens a room, joins one, or comes back to one after a reload.

   The board is the same vendored board. Online, gameState is rebuilt from each
   room snapshot: your hand is real; the opponent's hand and the deck are face
   down, so they are filled with the cards nobody can see (which ones is
   arbitrary — the real ones never reach this phone). _netFill keeps that filling
   stable between snapshots so cards fly from the right place: a card the
   opponent reveals comes out of their hand, a card you draw comes off the deck.

   Your move goes to the room instead of the local engine (the four player
   actions are wrapped below); play, discard and taking a discard show at once,
   a deck draw shows when the room answers. Loaded after play.js.
   ========================================================================== */

const NET = {
  on: false,          // an online game is on the board
  room: null, loading: null, snap: null,
  busy: false, msg: '',
  seen: -1,           // pub.move last drawn
  opp: [], deck: [],  // the face-down filling: card ids, deck top = last
  over: false,
};
const NET_NAME_KEY = 'venture-lab-netname';
const NET_SRC = (document.currentScript && document.currentScript.src) || location.href;

const _netSlot = (seat) => (seat === 0 ? 'player1' : 'player2');
const _netCard = (() => { let m = null; return (id) => { if (!m){ m = {}; allCards().forEach(c => { m[c.id] = c; }); } return m[id]; }; })();

function _netLoad(){
  if (NET.room) return Promise.resolve(NET.room);
  if (!NET.loading){
    const v = (NET_SRC.split('?')[1] || '');
    NET.loading = import(new URL('online.js' + (v ? '?' + v : ''), NET_SRC).href).then((m) => {
      NET.room = m.createOnline({ game: LCOnline.game, gameId: 'lost-cities', botDelayMs: 900 });
      NET.room.on('change', _netSnap);
      NET.room.on('error', (e) => { if (NET.on) _labFlash(typeof e === 'string' ? e : (e && e.message) || 'Online error'); });
      return NET.room;
    }).catch((e) => { NET.loading = null; throw e; });
  }
  return NET.loading;
}

/* ------------------------------------------------------------- the sheet */

function playOnlineOpen(){
  NET.msg = '';
  _playOpenSheet('online', '', _netClick);
  _netPaint();
}
function _netSheet(){
  const s = document.getElementById('play-sheet');
  return s && s.dataset.sheet === 'online' ? s : null;
}
function _netPaint(){
  const wrap = _netSheet();
  if (!wrap) return;
  const box = wrap.querySelector('.box');
  const s = NET.snap;
  let html;
  if (s && s.status === 'joining'){
    html = '<h2>Online</h2><p class="pr-note">' + (s.askingHost ? 'Waiting for the host to let you in…' : 'Joining ' + _esc2(s.code || '') + '…') + '</p>'
      + '<div class="acts"><button type="button" data-act="leave">Cancel</button></div>';
  } else if (s && s.status === 'lobby'){
    const seats = s.seats.map((x, i) => '<div class="ps-row"><span>' + (x.kind === 'human' ? _esc2(x.name || 'Player') : 'Waiting for a friend…') + '</span><span class="pr-note">'
      + (i === s.mySeat ? 'you' : '') + (x.isHost ? (i === s.mySeat ? ' · ' : '') + 'host' : '') + '</span></div>').join('');
    html = '<h2>Online room</h2><div class="net-code">' + _esc2(s.code) + '</div>'
      + '<p class="pr-note">Your friend opens this site, taps New game, Online, and types the code.</p>'
      + seats
      + (s.isHost && s.seats.some(x => x.kind !== 'human') ? '<p class="pr-note">Start now and a computer takes the empty seat.</p>' : '')
      + '<div class="acts"><button type="button" data-act="leave">Leave</button>'
      + (s.isHost ? '<button type="button" class="primary" data-act="start">Start</button>' : '<span class="pr-note">The host starts the game.</span>') + '</div>';
  } else {
    let nm = '';
    try { nm = localStorage.getItem(NET_NAME_KEY) || ''; } catch (e){}
    html = '<h2>Online</h2><p class="pr-note">Play a friend on their own phone. One round.</p>'
      + '<label class="ps-row"><span>Your name</span><input type="text" id="net-name" maxlength="20" autocomplete="nickname" value="' + _esc2(nm) + '"></label>'
      + '<div class="acts"><button type="button" data-act="cancel">Cancel</button><button type="button" class="primary" data-act="create"' + (NET.busy ? ' disabled' : '') + '>Make a room</button></div>'
      + '<label class="ps-row"><span>Room code</span><input type="text" id="net-code" maxlength="5" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>'
      + '<div class="acts"><button type="button" data-act="join"' + (NET.busy ? ' disabled' : '') + '>Join</button></div>'
      + (NET.msg ? '<p class="pr-note net-bad">' + _esc2(NET.msg) + '</p>' : '');
  }
  box.innerHTML = html;
}
function _netClick(act, b, wrap){
  if (act === 'cancel') _playCloseSheet();
  else if (act === 'create' || act === 'join') _netGo(act, wrap);
  else if (act === 'start'){ if (NET.room) NET.room.start().then(r => { if (!r.ok) _labFlash(r.message); }); }
  else if (act === 'leave'){ _netLeave(); _playCloseSheet(); }
}
async function _netGo(kind, wrap){
  if (NET.busy) return;
  const name = ((wrap.querySelector('#net-name') || {}).value || '').trim().slice(0, 20) || 'Player';
  try { localStorage.setItem(NET_NAME_KEY, name); } catch (e){}
  const code = ((wrap.querySelector('#net-code') || {}).value || '').trim().toUpperCase();
  if (kind === 'join' && code.length !== 5){ NET.msg = 'Room codes have 5 letters.'; _netPaint(); return; }
  NET.busy = true; NET.msg = ''; _netPaint();
  let r;
  try {
    const room = await _netLoad();
    r = kind === 'create' ? await room.createRoom({ name, seats: ['human', 'empty'], options: {} })
                          : await room.joinRoom(code, name);
  } catch (e){ r = { ok: false, message: 'Online play couldn’t load. Check your internet and try again.' }; }
  NET.busy = false;
  if (!r.ok) NET.msg = r.message || 'That didn’t work. Try again.';
  _netPaint();
}
function _netLeave(){
  const room = NET.room, was = NET.on;
  NET.snap = null;
  if (room) room.leave();
  if (was) _netExit();
}
/* Back to a normal game against the computer. */
function _netExit(){
  NET.on = false; NET.seen = -1; NET.key = ""; NET.opp = []; NET.deck = []; NET.over = false;
  userSlot = 'player1';
  document.body.classList.remove('net-on');
  _playHideResult();
  const r = document.getElementById('play-resume'); if (r) r.hidden = true;
  createCardPool();
  playStartMatch();
}

/* ------------------------------------------------------------- snapshots */

function _netSnap(s){
  NET.snap = s;
  if (['none', 'closed', 'left'].includes(s.status)){
    if (NET.on){ _labFlash(s.status === 'closed' ? 'The room was closed.' : 'You left the room.'); _netExit(); }
    _netPaint();
    return;
  }
  if (s.status === 'lobby' || s.status === 'joining' || !s.pub){
    if (!_netSheet() && s.status === 'lobby') playOnlineOpen();
    _netPaint();
    return;
  }
  if (!NET.on) _netEnter(s);
  _netShow(s);
}

function _netEnter(s){
  _playCloseSheet();
  _labCancelAI();
  if (LAB.mode !== 'play') labSetMode('play');
  NET.on = true; NET.seen = -1; NET.key = ""; NET.opp = []; NET.deck = []; NET.over = false;
  PLAY.active = false;
  const chip = document.getElementById('play-match'); if (chip) chip.hidden = true;
  _playHideResult();
  document.body.classList.add('net-on');
  userSlot = _netSlot(s.mySeat);
  selectedCard = null; lastPlayedCard = null; spreadPile = null;
  if (typeof setVentureCount === 'function') setVentureCount(5);   // rooms are the five-colour game
  if (typeof playClearSave === 'function') playClearSave();         // the local match gives way to the room
  createCardPool();                         // first render places every card without flying
  const other = s.seats[1 - s.mySeat];
  const el = document.getElementById('opponent-name-store');
  if (el) el.textContent = (other && other.name) || 'Friend';
  _labFlash('Online · room ' + s.code);
}
const _netOppName = () => { const s = NET.snap, o = s && s.seats[1 - s.mySeat]; return (o && o.kind === 'human' && o.name) || 'Computer'; };

/* The face-down filling. Visible: your hand, every pile, every discard. The
   rest (U) fills the opponent's hand and the deck. Kept stable: last time's ids
   stay where they were when they can, and before drawing, a card that comes out
   of hiding is first moved (invisibly, all face down) to where it really came
   from, so it flies from there. */
function _netFill(pub, hand, me){
  const opp = 1 - me;
  const visible = new Set(hand.map(c => c.id));
  for (const p of [0, 1]) for (const c of CONFIG.colors) pub.piles[p][c].forEach(x => visible.add(x.id));
  for (const c of CONFIG.colors) pub.discards[c].forEach(x => visible.add(x.id));
  const U = new Set(allCards().map(c => c.id).filter(id => !visible.has(id)));
  let o = NET.opp.slice(), d = NET.deck.slice();
  let swapped = false;
  if (o.length || d.length){
    const mineNow = new Set(hand.map(c => c.id));
    for (const id of o.concat(d)){
      if (U.has(id)) continue;
      if (mineNow.has(id)){                       // you drew it: it came off the deck top
        const top = d.length - 1;
        const at = d.indexOf(id);
        if (at >= 0 && at !== top){ d[at] = d[top]; d[top] = id; swapped = true; }
        else if (at < 0){ const k = o.indexOf(id); if (top >= 0){ o[k] = d[top]; d[top] = id; swapped = true; } }
      } else if (d.includes(id)){                 // they played / threw it: it came out of their hand
        const k = o.findIndex(x => U.has(x));
        if (k >= 0){ const at = d.indexOf(id); d[at] = o[k]; o[k] = id; swapped = true; }
      }
    }
  }
  const before = { o: o.slice(), d: d.slice() };
  o = o.filter(id => U.has(id));
  d = d.filter(id => U.has(id));
  const placed = new Set(o.concat(d));
  const fresh = [...U].filter(id => !placed.has(id));   // just went face down: taken from a discard by them
  const want = pub.handCounts[opp];
  while (o.length < want && fresh.length) o.push(fresh.shift());
  while (o.length < want && d.length) o.push(d.pop());
  while (o.length > want) d.unshift(o.pop());
  d = fresh.concat(d);                                    // anything else unplaced goes under the deck
  while (d.length > pub.deckCount) o.push(d.shift());    // (never, unless a snapshot was skipped)
  return { o, d, swapped, before };
}

function _netState(pub, hand, me, o, d){
  const piles = { player1: {}, player2: {} }, discards = {};
  for (const c of CONFIG.colors){
    piles.player1[c] = pub.piles[0][c].slice();
    piles.player2[c] = pub.piles[1][c].slice();
    discards[c] = pub.discards[c].slice();
  }
  const hands = {};
  hands[_netSlot(me)] = hand.slice();
  hands[_netSlot(1 - me)] = o.map(_netCard);
  return {
    drawPile: d.map(_netCard), hands, playPiles: piles, discards,
    currentTurn: _netSlot(pub.turn), phase: pub.phase, status: pub.over ? 'finished' : 'playing',
    lastDiscardTarget: pub.lastDiscard, moveNumber: pub.move,
  };
}

function _netShow(s){
  const pub = s.pub, me = s.mySeat, hand = (s.mine && s.mine.hand) || [];
  if (hand.length !== pub.handCounts[me]) return;          // hand and table out of step: wait for the next one
  const key = pub.move + '|' + pub.over + '|' + hand.map(c => c.id).join(',');
  if (key === NET.key) return;
  NET.key = key;
  const first = NET.seen < 0;
  const f = _netFill(pub, hand, me);
  if (f.swapped && !first && NET._pub){     // the invisible re-filling, drawn without movement
    gameState = _netState(NET._pub, NET._hand, me, f.before.o, f.before.d);
    renderGame._snapNextRender = true;
    renderGame();
  }
  NET.opp = f.o; NET.deck = f.d;
  const prevMove = NET.seen;
  NET.seen = pub.move;
  NET._pub = pub; NET._hand = hand;
  if (selectedCard && !hand.some(c => c.id === selectedCard.id)) selectedCard = null;
  lastPlayedCard = null;
  gameState = _netState(pub, hand, me, f.o, f.d);
  renderGame();
  if (!first && pub.move > prevMove && pub.last) _netNote(pub.last, me);
  if (pub.over && !NET.over){ NET.over = true; _netOver(s); }
}
function _netCardName(c){ return c.color + (c.value === 0 ? ' wager' : ' ' + c.value); }
function _netNote(last, me){
  if (last.seat === me){ if (last.t === 'draw' && last.from === 'deck') SFX.drawCard(); return; }
  if (last.t === 'play') SFX.play();
  else if (last.t === 'discard') SFX.discard();
  else {
    SFX.drawCard();
    const p = last.play;
    const did = p ? (p.t === 'play' ? 'played ' : 'discarded ') + _netCardName(p.card) + ' · ' : '';
    const drew = last.from === 'deck' ? 'drew from the deck' : 'took ' + _netCardName(last.card) + ' from the discards';
    _labFlash(_netOppName() + ' ' + did + drew);
  }
}

function _netOver(s){
  const me = s.mySeat, sc = s.pub.scores || [0, 0];
  const my = sc[me], opp = sc[1 - me], name = _esc2(_netOppName());
  if (my > opp) SFX.win(); else SFX.gameOver();
  if (window.FX) try { FX.celebrate({ kind: my > opp ? 'win' : my < opp ? 'lose' : 'big', colors: ['#d4a843', '#f0c860', '#e8dcc0', '#c0605a', '#3c7ac0'] }); } catch (e){}
  let done = '';
  try { done = localStorage.getItem('venture-lab-netdone') || ''; localStorage.setItem('venture-lab-netdone', s.code); } catch (e){}
  if (typeof Profile !== 'undefined' && done !== s.code) try {   // once per room, not again after a reload
    Profile.recordResult({ mode: 'online', won: my > opp ? true : my < opp ? false : null, draw: my === opp, score: my - opp, extra: { rounds: 1, best: my } });
  } catch (e){}
  const el = document.getElementById('play-result');
  if (!el) return;
  el.innerHTML = '<div class="box" role="dialog" aria-label="Result">'
    + '<h2>' + (my > opp ? 'You win' : my < opp ? name + ' wins' : 'A tie') + '</h2>'
    + '<table class="pr-t"><thead><tr><th></th><th>You</th><th>' + name + '</th></tr></thead><tbody>'
    + '<tr><td>Score</td><td class="n">' + my + '</td><td class="n">' + opp + '</td></tr></tbody></table>'
    + '<div class="acts"><button type="button" data-act="look">See board</button><button type="button" class="primary" data-act="done">Leave room</button></div></div>';
  el.hidden = false;
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b){ if (e.target === el) _netFold(); return; }
    if (b.dataset.act === 'look') _netFold();
    else if (b.dataset.act === 'done') _netLeave();
  };
}
function _netFold(){
  document.getElementById('play-result').hidden = true;
  const btn = document.getElementById('play-resume');
  if (btn){ btn.hidden = false; btn.textContent = 'Result'; }
}

/* ------------------------------------------------------------- your moves */

function _netAct(a){
  if (!NET.room) return;
  // a refused move: the error event says why, and the room's next snapshot puts the board back
  NET.room.act(a).then(r => { if (!r.ok){ NET.key = ''; if (NET.snap && NET.snap.pub) _netShow(NET.snap); } });
}
function _netMyTurn(phase){ return NET.on && !NET.over && gameState.currentTurn === userSlot && gameState.phase === phase; }

const _netPlayLocal = playToExpedition;
playToExpedition = async function(color){
  if (!NET.on) return _netPlayLocal(color);
  if (!selectedCard || !_netMyTurn('play') || selectedCard.color !== color) return;
  const card = selectedCard;
  if (!ENGINE.playCard(gameState, userSlot, card, color).success){ toast('Must be higher than top card'); return; }
  selectedCard = null; SFX.play(); renderGame();
  _netAct({ t: 'play', id: card.id });
};
const _netDiscardLocal = discardTo;
discardTo = async function(color){
  if (!NET.on) return _netDiscardLocal(color);
  if (!selectedCard || !_netMyTurn('play')) return;
  if (selectedCard.color !== color){ toast('Discard to the ' + CONFIG.colorLabels[selectedCard.color] + ' pile'); return; }
  const card = selectedCard;
  ENGINE.discardCard(gameState, userSlot, card, color);
  selectedCard = null; SFX.discard(); renderGame();
  _netAct({ t: 'discard', id: card.id });
};
const _netDeckLocal = drawFromDrawPile;
drawFromDrawPile = async function(){
  if (!NET.on) return _netDeckLocal();
  if (!_netMyTurn('draw') || !gameState.drawPile.length) return;
  _netAct({ t: 'draw', from: 'deck' });      // the card shows when the room answers
};
const _netDiscardDrawLocal = drawFromDiscard;
drawFromDiscard = async function(color){
  if (!NET.on) return _netDiscardDrawLocal(color);
  if (!_netMyTurn('draw')) return;
  if (!getCards(gameState, 'discards', color).length) return;
  if (gameState.lastDiscardTarget === color){ toast("Can't draw from the pile you just discarded to"); return; }
  ENGINE.drawFromDiscard(gameState, userSlot, color);
  SFX.drawCard(); renderGame();
  _netAct({ t: 'draw', from: color });
};
const _netUndoLocal = undoLastPlay;
undoLastPlay = async function(){ if (!NET.on) return _netUndoLocal(); };   // a move sent to the room can't be taken back
const _netAILocal = _labAITurn;
_labAITurn = function(){ if (!NET.on) return _netAILocal(); };

/* Leaving: New game, the back arrow and the Lab button ask first. */
function _netAskLeave(then){
  labConfirm(NET.over ? 'Leave the room?' : 'Leave the room? A computer takes your seat.').then(ok => {
    if (!ok) return;
    _netLeave();
    if (then) then();
  });
}
const _netNewGameLocal = playOpenNewGame;
playOpenNewGame = function(){ if (NET.on) return _netAskLeave(_netNewGameLocal); return _netNewGameLocal(); };
const _netAbandonLocal = confirmAbandonGame;
confirmAbandonGame = function(){ if (NET.on) return _netAskLeave(); return _netAbandonLocal(); };
const _netModeLocal = labSetMode;
labSetMode = function(mode, quiet){
  if (NET.on && mode === 'lab'){ _labFlash('The lab tools are off in an online game'); return; }
  return _netModeLocal(mode, quiet);
};

/* Back into the room after a reload (only loads the kit if this browser was in one). */
function _netResume(){
  try { if (!localStorage.getItem('online.lost-cities')) return; } catch (e){ return; }
  _netLoad().then(room => room.resume()).catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(_netResume, 0));
else setTimeout(_netResume, 0);
