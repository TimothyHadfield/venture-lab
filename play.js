"use strict";
/* ============================================================================
   play.js — the PLAY side of the site (2026-10-27).

   lab.js is the board and the study tools. This file adds what a normal game
   of Lost Cities needs around them:

     - the New game sheet (opponent, 1 round or a 3-round match),
     - the match: running totals, round results, who starts the next round,
     - Settings (sounds and effects from fx.js, rules, guided first game, stats),
     - the rules sheet and the guided first game (coach.js),
     - My stats (profile.js): results per computer, Elo, achievements, Daily game,
     - the vendored sounds routed through fx.js so its Settings switches apply.

   Loaded after lab.js / computers.js, initialised after _labInit (both wait for
   DOMContentLoaded, this one registers later). Everything that touches a kit is
   guarded, so a missing kit file never takes the board down.
   ========================================================================== */

const PLAY = {
  rounds: 3,                 // 1 or 3 (the New game sheet)
  active: false,             // a game started from Play mode (single round or match)
  results: [],               // [{ my, opp, first }] per finished round
  first: null,               // who started the current round
  peeked: false,             // the lab tools were opened during this match
  recorded: false,           // the match is in My stats already
  daily: null,               // 'YYYY-MM-DD' when this is the Daily game
  tutorial: false,
  six: false,                // New game sheet: the sixth colour (purple, 72 cards); off by default
  matchSix: false,           // the match on the table uses six colours
  counted: false,            // this deal's result is in PLAY.results already
};
const PLAY_KEY = 'venture-lab-play';
const PLAY_SAVE_KEY = 'venture-lab-match';   // the match in progress, resumed after a reload

function _playLoad(){
  try {
    const s = JSON.parse(localStorage.getItem(PLAY_KEY) || 'null');
    if (s){
      if (s.rounds === 1 || s.rounds === 3) PLAY.rounds = s.rounds;
      if (typeof s.ai === 'string') LAB.ai = s.ai;
      PLAY.six = s.six === true;
    }
  } catch (e){}
}
function _playSave(){
  try { localStorage.setItem(PLAY_KEY, JSON.stringify({ rounds: PLAY.rounds, ai: LAB.ai, six: PLAY.six })); } catch (e){}
}

const _opp = () => (userSlot === 'player1' ? 'player2' : 'player1');
function _playScore(slot){
  return gameState ? MATH.scoreBreakdown(gameState.playPiles[slot] || {}).total : 0;
}
function _playTotals(){
  let my = 0, opp = 0;
  for (const r of PLAY.results){ my += r.my; opp += r.opp; }
  return { my, opp };
}
/* Per-colour lines for the round result: every colour either side started, in
   colour order, each side as { score, line } ("(33 − 20) × 3 + 20") or null
   when that side never started it. `my`/`opp` are MATH.scoreBreakdown(...).breakdown. */
function playColourRows(my, opp){
  const cell = b => {
    if (!b || !b.count) return null;
    let line = b.sum + ' − ' + CONFIG.scoring.baseCost;
    if (b.wagers) line = '(' + line + ') × ' + (b.wagers + 1);
    if (b.bonus) line += ' + ' + CONFIG.scoring.bonusPoints;
    return { score: b.score, line };
  };
  const rows = [];
  for (const c of CONFIG.colors){
    const a = cell(my[c]), b = cell(opp[c]);
    if (a || b) rows.push({ color: c, my: a, opp: b });
  }
  return rows;
}

/* A saved match (localStorage PLAY_SAVE_KEY) is resumed only if it is whole:
   this format, a live round of an unfinished match, and every card of a
   5- or 6-colour deck exactly once. Anything else is thrown away. */
function playSaveValid(s){
  try {
    if (!s || s.v !== 1 || !(s.colors === 5 || s.colors === 6)) return false;
    if (s.userSlot !== 'player1' && s.userSlot !== 'player2') return false;
    const p = s.play, g = s.gameState;
    if (!p || !(p.rounds === 1 || p.rounds === 3) || !Array.isArray(p.results) || p.results.length >= p.rounds) return false;
    if (!g || !g.hands || !g.playPiles || !g.discards || !Array.isArray(g.drawPile)) return false;
    const cols = CONFIG.allColors.slice(0, s.colors);
    const ids = [];
    for (const slot of ['player1', 'player2']){
      ids.push(...g.hands[slot].map(c => c.id));
      for (const c of cols) ids.push(...g.playPiles[slot][c].map(x => x.id));
    }
    for (const c of cols) ids.push(...g.discards[c].map(x => x.id));
    ids.push(...g.drawPile.map(c => c.id));
    const per = CONFIG.wagerCount + CONFIG.numberRange[1] - CONFIG.numberRange[0] + 1;
    if (ids.length !== cols.length * per || new Set(ids).size !== ids.length) return false;
    return ids.every(id => cols.includes(String(id).split('_')[0]));
  } catch (e){ return false; }
}
/* end of the pure helpers */

/* The name over their hand: the computer's name, also for the built-in levels
   (lab.js leaves those as "Opponent"). */
function _playSyncOppName(){
  const el = document.getElementById('opponent-name-store');
  if (el) el.textContent = _playOppName();
}
function _playOppName(){
  const bot = _labCpuBot();
  if (bot) return bot.name;
  const k = String(LAB.ai || 'solid');
  return k[0].toUpperCase() + k.slice(1);
}
const _esc2 = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------- the match */

/* Round 1: a coin toss. After that the rulebook's rule: whoever has the most
   points so far starts; on a tie, whoever did not start the last round. */
function playNextStarter(results, lastFirst){
  let my = 0, opp = 0;
  for (const r of results){ my += r.my; opp += r.opp; }
  if (my > opp) return 'player1';
  if (opp > my) return 'player2';
  return lastFirst === 'player1' ? 'player2' : 'player1';
}

function playStartMatch(opts){
  opts = opts || {};
  PLAY.active = true;
  PLAY.results = [];
  PLAY.peeked = false;
  PLAY.recorded = false;
  _playEight = false;
  PLAY.daily = opts.daily || null;
  PLAY.tutorial = !!opts.tutorial;
  // The sixth colour is a New-game choice; the Daily game and the guided game are always five.
  PLAY.matchSix = PLAY.six && !opts.daily && !opts.tutorial;
  _playHideResult();
  const first = opts.first || (Math.random() < 0.5 ? 'player1' : 'player2');
  _playNewRound(first, opts.deckRng);
}

function _playNewRound(first, deckRng){
  PLAY.first = first;
  PLAY.counted = false;
  setVentureCount(PLAY.matchSix ? 6 : 5);
  // A seeded deal (Daily game) swaps Math.random only for the shuffle.
  if (deckRng){
    const real = Math.random;
    Math.random = deckRng;
    try { newLabGame(first); } finally { Math.random = real; }
  } else newLabGame(first);
  _playPaintMatch();
}

function playNextRound(){
  _playHideResult();
  _playNewRound(playNextStarter(PLAY.results, PLAY.first));
}

/* The top-bar chip: round and running totals (completed rounds only). */
function _playPaintMatch(){
  const el = document.getElementById('play-match');
  if (!el) return;
  if (!PLAY.active || PLAY.rounds === 1){ el.hidden = true; return; }
  const t = _playTotals();
  const n = Math.min(PLAY.results.length + 1, PLAY.rounds);
  el.hidden = false;
  el.innerHTML = '<span class="pm-r"><span class="pm-l">Round </span>' + n + '/' + PLAY.rounds + '</span> '
    + '<b>' + t.my + '</b><span class="pm-d">–</span><b>' + t.opp + '</b>';
  el.title = 'Match total so far: you ' + t.my + ', ' + _playOppName() + ' ' + t.opp;
}

/* Seeing the computer's move. Its whole turn takes about a second, so in Play
   mode it is also said in words on the flash line, and a deal the computer
   starts waits a moment so you see the board first. */
const PLAY_CPU_NOTE_MS = 4500, PLAY_CPU_START_MS = 900;
let _playCpuAct = null, _playStartPause = false;
function _playCardName(c){
  return c.color + (c.value === 0 ? ' wager' : ' ' + c.value);
}
function _playNoteCpu(kind, d){
  if (LAB.mode !== 'play' || !_labAIBusy || d.player === userSlot) return;
  if (kind !== 'draw'){ _playCpuAct = (kind === 'play' ? 'played ' : 'discarded ') + _playCardName(d.card); return; }
  const drew = d.source === 'deck' ? 'drew from the deck' : 'took ' + _playCardName(d.card) + ' from the discards';
  _labFlash(_playOppName() + ' ' + (_playCpuAct || '') + ' · ' + drew);
  clearTimeout(_labFlashTimer);
  _labFlashTimer = setTimeout(() => document.getElementById('lab-flash').classList.remove('on'), PLAY_CPU_NOTE_MS);
  _playCpuAct = null;
}
const _labSetOpponentNameLab = _labSetOpponentName;
_labSetOpponentName = function(){ _labSetOpponentNameLab(); _playSyncOppName(); };
const _labAITurnLab = _labAITurn;
_labAITurn = function(){
  if (_playStartPause && LAB.mode === 'play'){
    _playStartPause = false;
    _labFlash(_playOppName() + ' starts');
    const gen = _labAIGen;
    setTimeout(() => { if (gen === _labAIGen) _labAITurnLab(); }, PLAY_CPU_START_MS);
    return;
  }
  _playStartPause = false;
  _labAITurnLab();
};

/* lab.js calls _labGameOver by name at the end of every deal. In a Play game the
   round result + match panel replaces the lab's one-line result. */
const _labGameOverLab = _labGameOver;
_labGameOver = function(){
  if (!PLAY.active) return _labGameOverLab();
  _playRoundOver();
};

function _playRoundOver(){
  if (PLAY.results.length >= PLAY.rounds || PLAY.counted) return;   // already counted
  const my = _playScore(userSlot), opp = _playScore(_opp());
  PLAY.results.push({ my, opp, first: PLAY.first });
  PLAY.counted = true;
  if (_labPeeked) PLAY.peeked = true;
  if (_playRoundEight()) _playEight = true;
  renderGame();
  _playPaintMatch();
  const done = PLAY.results.length >= PLAY.rounds;
  const t = _playTotals();
  let rec = null;
  if (done && !PLAY.recorded){
    PLAY.recorded = true;
    rec = _playRecord(t);
  }
  _playShowResult(done, my, opp, t, rec);
  _playSaveMatch();
  if (typeof COACH !== 'undefined') COACH.emit('roundOver');
  if (window.FX){
    const won = done ? t.my > t.opp : my > opp;
    const lost = done ? t.my < t.opp : my < opp;
    if (done) FX.celebrate({ kind: won ? 'win' : lost ? 'lose' : 'big', colors: ['#d4a843', '#f0c860', '#e8dcc0', '#c0605a', '#3c7ac0'] });
    else FX.play(won ? 'ding' : 'cardFlip');
  }
}

function _playHideResult(){
  const el = document.getElementById('play-result');
  if (el) el.hidden = true;
  const lr = document.getElementById('lab-result');
  if (lr) lr.classList.remove('on');
}

function _playShowResult(done, my, opp, t, rec){
  const el = document.getElementById('play-result');
  if (!el) return;
  const name = _esc2(_playOppName());
  const multi = PLAY.rounds > 1;
  const rows = PLAY.results.map((r, i) =>
    '<tr><td>' + (multi ? 'Round ' + (i + 1) : 'Score') + '</td><td class="n">' + r.my + '</td><td class="n">' + r.opp + '</td></tr>').join('');
  const tot = multi ? '<tr class="tot"><td>Total</td><td class="n">' + t.my + '</td><td class="n">' + t.opp + '</td></tr>' : '';
  // This deal, colour by colour: (sum − 20) × (1 + wagers) + bonus.
  let by = '';
  if (gameState){
    const cell = x => x ? '<td class="n">' + x.score + '<small>' + x.line + '</small></td>' : '<td class="n pr-none">–</td>';
    const cr = playColourRows(MATH.scoreBreakdown(gameState.playPiles[userSlot] || {}).breakdown,
                              MATH.scoreBreakdown(gameState.playPiles[_opp()] || {}).breakdown);
    if (cr.length) by = '<table class="pr-t pr-c"><thead><tr><th>' + (multi ? 'Round ' + PLAY.results.length + ' by colour' : 'By colour') + '</th><th></th><th></th></tr></thead><tbody>'
      + cr.map(r => '<tr><td><i class="pr-dot" style="background:' + (CONFIG.colorHex[r.color] || '#888') + '"></i>'
        + _esc2(CONFIG.colorLabels[r.color] || r.color) + '</td>' + cell(r.my) + cell(r.opp) + '</tr>').join('')
      + '</tbody></table>';
  }
  const a = done ? t.my : my, b = done ? t.opp : opp;
  const head = !done ? (my > opp ? 'You won round ' : my < opp ? name + ' won round ' : 'Round ' ) + PLAY.results.length + (my === opp ? ' tied' : '')
             : (a > b ? (multi ? 'You win the match' : 'You win') : a < b ? name + (multi ? ' wins the match' : ' wins') : 'A tie');
  let foot = '';
  if (done){
    if (PLAY.peeked) foot = '<p class="pr-note">Lab tools were used, so this game isn’t in My stats.</p>';
    else if (rec && rec.elo) foot = '<p class="pr-note">Rating ' + rec.elo.after + ' (' + (rec.elo.change >= 0 ? '+' : '') + rec.elo.change + ')</p>';
  }
  el.innerHTML = '<div class="box" role="dialog" aria-label="Result">'
    + '<h2>' + head + '</h2>'
    + '<table class="pr-t"><thead><tr><th></th><th>You</th><th>' + name + '</th></tr></thead><tbody>' + rows + tot + '</tbody></table>'
    + by
    + foot
    + '<div class="acts">'
    + (done ? '<button type="button" data-act="stats">My stats</button><button type="button" class="primary" data-act="again">Play again</button>'
            : '<button type="button" data-act="look">See board</button><button type="button" class="primary" data-act="next">Round ' + (PLAY.results.length + 1) + '</button>')
    + '</div></div>';
  el.hidden = false;
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b){ if (e.target === el) _playMinimise(done); return; }
    const act = b.dataset.act;
    if (act === 'next') playNextRound();
    else if (act === 'again'){ _playHideResult(); playStartMatch(); }
    else if (act === 'stats'){ if (typeof Profile !== 'undefined') Profile.openPanel(); }
    else if (act === 'look') _playMinimise(done);
  };
  const p = el.querySelector('.primary');
  if (p) setTimeout(() => { try { p.focus({ preventScroll: true }); } catch (e){} }, 30);
}

/* Look at the final board: the panel folds into a button on the bottom bar. */
function _playMinimise(done){
  const el = document.getElementById('play-result');
  if (el) el.hidden = true;
  const btn = document.getElementById('play-resume');
  if (btn){
    btn.hidden = false;
    btn.textContent = done ? 'Result' : 'Round ' + (PLAY.results.length + 1) + ' ›';
  }
}

/* ------------------------------------------------------------- My stats */

const PLAY_LEVELS_FALLBACK = [];
function _playLevels(){
  // Elo of each opponent from measured games (test/rate_levels.js, fair view,
  // 400 deals a pairing, seats swapped). Listed opponents are rated; a computer
  // written in the builder is not.
  return (typeof PLAY_RATINGS !== 'undefined' ? PLAY_RATINGS : PLAY_LEVELS_FALLBACK);
}

const PLAY_ACH = [
  { id: 'first-win',   title: 'First win',        desc: 'Win a game against the computer.', test: c => c.stats.wins >= 1 },
  { id: 'match-win',   title: 'Three rounds',     desc: 'Win a 3-round match.', test: c => !!(c.last && c.last.won && c.last.extra && c.last.extra.rounds === 3) },
  { id: 'big-round',   title: 'Big round',        desc: 'Score 60 or more in one round.', test: c => !!(c.last && c.last.extra && c.last.extra.best >= 60) },
  { id: 'eight',       title: 'Long expedition',  desc: 'Finish a venture of 8+ cards (the +20 bonus).', test: c => !!(c.last && c.last.extra && c.last.extra.eight) },
  { id: 'broker',      title: 'Beat The Broker',  desc: 'Win against The Broker, the strongest computer.', test: c => !!(c.last && c.last.won && c.last.level === 'cpu:broker') },
  { id: 'streak3',     title: 'On a roll',        desc: 'Win 3 games in a row.', test: c => c.stats.bestStreak >= 3 },
];

let _playEight = false;      // a venture of 8+ cards this match (set at each round end)
function _playRoundEight(){
  if (!gameState) return false;
  const piles = gameState.playPiles[userSlot] || {};
  return CONFIG.colors.some(c => (piles[c] || []).length >= 8);
}

function _playRecord(t){
  if (typeof Profile === 'undefined' || PLAY.peeked || PLAY.tutorial) return null;
  try {
    const best = Math.max.apply(null, PLAY.results.map(r => r.my));
    const won = t.my > t.opp ? true : t.my < t.opp ? false : null;
    const listed = _playLevels().some(l => l.id === LAB.ai);
    return Profile.recordResult({
      mode: 'computer', level: listed ? LAB.ai : undefined,
      won, draw: t.my === t.opp, score: t.my - t.opp, daily: !!PLAY.daily,
      extra: { rounds: PLAY.rounds, best, eight: _playEight, opp: LAB.ai },
    });
  } catch (e){ console.warn('[play] stats', e); return null; }
}

/* Daily game: the same deal for everyone today, one round against The Broker. */
function playStartDaily(){
  if (typeof Profile === 'undefined') return;
  if (Profile.daily.played()){ Profile.openPanel({ tab: 'daily' }); return; }
  if (Profile.isOpen()) Profile.closePanel();
  if (LAB.mode !== 'play') labSetMode('play');
  const day = Profile.daily.date();
  LAB.ai = 'cpu:broker';
  _playSyncOpponent();
  PLAY.rounds = 1;
  _playCloseSheet();
  playStartMatch({ daily: day, first: 'player1', deckRng: Profile.daily.rng(day) });
  _labFlash('Daily game: today’s deal vs The Broker');
}

/* ------------------------------------------------------------- sheets */

function _playOpenSheet(id, html, onClick){
  _playCloseSheet();
  const wrap = document.createElement('div');
  wrap.id = 'play-sheet';
  wrap.className = 'play-sheet';
  wrap.innerHTML = '<div class="box" role="dialog" aria-modal="true">' + html + '</div>';
  wrap.dataset.sheet = id;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap){ _playCloseSheet(); return; }
    const b = e.target.closest('[data-act]');
    if (b) onClick(b.dataset.act, b, wrap);
  });
  document.body.appendChild(wrap);
  return wrap;
}
function _playCloseSheet(){
  const s = document.getElementById('play-sheet');
  if (s) s.remove();
}
function _playSheetOpen(){ return !!document.getElementById('play-sheet'); }

function _playSyncOpponent(){
  const sel = document.getElementById('lab-ai');
  if (sel) sel.value = LAB.ai;
  _labCpuWarned = false;
  _labSetOpponentName();
  _playSave();
}

function playOpenNewGame(){
  const opts = labOpponentOptions();
  let html = '', group = null;
  for (const o of opts){
    if (o.group !== group){ if (group) html += '</optgroup>'; html += '<optgroup label="' + _esc2(o.group) + '">'; group = o.group; }
    html += '<option value="' + _esc2(o.value) + '"' + (o.value === LAB.ai ? ' selected' : '') + '>' + _esc2(o.label) + '</option>';
  }
  if (group) html += '</optgroup>';
  const seg = (n, label) => '<button type="button" data-act="len" data-n="' + n + '" class="' + (PLAY.rounds === n ? 'on' : '') + '">' + label + '</button>';
  _playOpenSheet('new',
    '<h2>New game</h2>'
    + '<label class="ps-row"><span>Opponent</span><select id="ps-ai">' + html + '</select></label>'
    + '<div class="ps-row"><span>Length</span><span class="ps-seg">' + seg(1, '1 round') + seg(3, '3 rounds') + '</span></div>'
    + '<div class="ps-row"><span>Sixth colour</span><span class="ps-seg">'
    + '<button type="button" data-act="six" data-on="0" class="' + (PLAY.six ? '' : 'on') + '">Off</button>'
    + '<button type="button" data-act="six" data-on="1" class="' + (PLAY.six ? 'on' : '') + '">On</button></span></div>'
    + '<p class="ps-note">Adds purple: 72 cards, longer rounds. Not online.</p>'
    + '<div class="acts"><button type="button" data-act="online" id="ps-online" hidden>Online</button>'
    + '<button type="button" data-act="cancel">Cancel</button>'
    + '<button type="button" class="primary" data-act="start">Deal</button></div>',
    (act, b, wrap) => {
      if (act === 'len'){
        PLAY.rounds = +b.dataset.n;
        wrap.querySelectorAll('[data-act=len]').forEach(x => x.classList.toggle('on', x === b));
      } else if (act === 'six'){
        PLAY.six = b.dataset.on === '1';
        wrap.querySelectorAll('[data-act=six]').forEach(x => x.classList.toggle('on', x === b));
      } else if (act === 'cancel') _playCloseSheet();
      else if (act === 'online'){ _playCloseSheet(); if (typeof playOnlineOpen === 'function') playOnlineOpen(); }
      else if (act === 'start'){
        LAB.ai = wrap.querySelector('#ps-ai').value;
        _playSyncOpponent();
        _playCloseSheet();
        playStartMatch();
      }
    });
  if (typeof playOnlineOpen === 'function'){ const o = document.getElementById('ps-online'); if (o) o.hidden = false; }
}

function playOpenSettings(){
  const me = (typeof Profile !== 'undefined')
    ? '<button type="button" data-act="stats" class="ps-wide">' + Profile.avatarSVG(Profile.avatar, 22) + '<span>My stats</span></button>' : '';
  const w = _playOpenSheet('settings',
    '<h2>Settings</h2>'
    + '<div class="ps-btns">' + me
    + '<button type="button" data-act="rules" class="ps-wide">Rules</button>'
    + '<button type="button" data-act="tour" class="ps-wide">Guided game</button>'
    + (typeof Profile !== 'undefined' ? '<button type="button" data-act="daily" class="ps-wide">Daily game</button>' : '')
    + '</div>'
    + '<div id="ps-fx"></div>'
    + '<div class="acts"><button type="button" class="primary" data-act="close">Done</button></div>',
    (act) => {
      if (act === 'close') _playCloseSheet();
      else if (act === 'stats'){ _playCloseSheet(); Profile.openPanel(); }
      else if (act === 'rules'){ _playCloseSheet(); playOpenRules(); }
      else if (act === 'tour'){ _playCloseSheet(); playStartTutorial(); }
      else if (act === 'daily'){ _playCloseSheet(); playStartDaily(); }
    });
  if (window.FX) try { FX.renderSettings(w.querySelector('#ps-fx')); } catch (e){}
}

/* ------------------------------------------------------------- rules */

/* Checked 2026-10-28 with youtube.com/oembed (200, titles as below). */
const PLAY_VIDEOS = [
  { id: 'KEW8STc6wpA', title: 'How to Play Lost Cities in 3 Minutes', by: 'The Rules Girl' },
  { id: '3h0n48Vf4Qg', title: 'How to Play Lost Cities', by: 'Casual Cardboard' },
  { id: 'yWp4tHAWqIg', title: 'Get better at Lost Cities: basic strategy', by: 'Boardgaming Life' },
  { id: 'EAq--8-4Lo8', title: 'Lost Cities Unboxing and Basic Strategy', by: 'Show Me How To Win' },
  { id: 'Rz1F-dceEnM', title: 'Lost Cities Review', by: 'The Dice Tower' },
];

const PLAY_RULES = [
  { id: 'goal', title: 'Goal', short: 'Goal', html:
    '<p>Two players, five colours of cards. Over the game you build <b>ventures</b>: one row per colour on your side. '
  + 'Each venture you start costs 20 points, so start only the colours you can fill. Highest score wins.</p>'
  + '<p>The deck has 60 cards: in each colour the numbers 2 to 10 and three <b>wager</b> cards (the handshake).</p>' },
  { id: 'turn', title: 'Your turn', short: 'Turn', html:
    '<ol><li><b>Tap a card</b> in your hand.</li>'
  + '<li><b>Play it</b> on your venture of that colour (your row), <b>or discard it</b> face up on that colour’s discard pile (the middle row).</li>'
  + '<li><b>Draw one card</b>: the top of the deck, or the top card of any discard pile.</li></ol>'
  + '<p class="tip">You can’t take back the card you just discarded in the same turn.</p>' },
  { id: 'ventures', title: 'Building a venture', short: 'Ventures', html:
    '<ul><li>Cards in a venture only go <b>up</b>: a 6 can follow a 4, but a 4 can never follow a 6.</li>'
  + '<li>Wagers go <b>first</b>, before any number of that colour. You can play several.</li>'
  + '<li>So hold your low cards: playing a 7 now throws away every 2–6 of that colour you hold.</li></ul>' },
  { id: 'score', title: 'Scoring', short: 'Scoring', html:
    '<p>Each started venture: <b>(sum of its numbers − 20) × (1 + wagers)</b>.</p>'
  + '<ul><li>No numbers yet? It still costs 20 (times the wagers).</li>'
  + '<li>A venture with <b>8 or more cards</b> gets <b>+20</b> after the multiplying.</li>'
  + '<li>Colours you never started score 0.</li></ul>'
  + '<table><tr><td>2 + 5 + 9 + 10, no wager</td><td>26 − 20 = <b>6</b></td></tr>'
  + '<tr><td>wager, 4, 7, 8</td><td>(19 − 20) × 2 = <b>−2</b></td></tr>'
  + '<tr><td>2 wagers, 6, 8, 9, 10</td><td>(33 − 20) × 3 = <b>39</b></td></tr></table>' },
  { id: 'end', title: 'End of a round', short: 'End', html:
    '<p>The round ends the moment the <b>last card of the deck is drawn</b>. Cards still in hands don’t count.</p>'
  + '<p class="tip">Drawing from a discard pile doesn’t shorten the deck, so it buys time.</p>' },
  { id: 'match', title: 'A match', short: 'Match', html:
    '<p>A match is <b>3 rounds</b>; points add up and the higher total wins. You can also play a single round (New game).</p>'
  + '<p>After round 1, whoever has more points so far starts the next round.</p>' },
  { id: 'six', title: 'Sixth colour', short: 'Sixth', html:
    '<p>An option in New game, off by default: a <b>sixth colour (purple)</b> joins the deck, 72 cards in all. '
  + 'Same rules and scoring; rounds run longer and there is one more venture to choose from.</p>'
  + '<p class="tip">Against the computer only, not in online rooms. Statistics in the lab always use five colours.</p>' },
  { id: 'videos', title: 'Videos', short: 'Videos', html:
    '<p>Lost Cities on YouTube (Venture plays the same):</p><ul>'
  + PLAY_VIDEOS.map(v => '<li><a href="https://www.youtube.com/watch?v=' + v.id + '" target="_blank" rel="noopener">' + v.title + '</a> · ' + v.by + '</li>').join('')
  + '</ul>' },
  { id: 'lab', title: 'Lab tools', short: 'Lab', html:
    '<p>Tap <b>Lab</b> in the top bar to open the study board: the opponent’s hand and the whole deck face up, '
  + 'potential under every pile, the Assistant, pick draw and Statistics. Tap Lab again to go back.</p>'
  + '<p class="tip">A game where the lab was opened isn’t counted in My stats. In Play the computer can’t see your hand or the deck either.</p>' },
];

function playOpenRules(open){
  if (typeof COACH === 'undefined') return;
  COACH.rules({ title: 'How to play', sections: PLAY_RULES, open: open || 'goal' });
}

/* ------------------------------------------------------------- guided first game */

let _playTour = null;
function _playMyTurn(phase){ return gameState && gameState.status === 'playing' && gameState.currentTurn === userSlot && (!phase || gameState.phase === phase); }

function _playBuildTour(){
  if (typeof COACH === 'undefined') return null;
  return COACH.tour({
    id: 'venture-first-game',
    pauseIf: () => _playSheetOpen() || (typeof Profile !== 'undefined' && Profile.isOpen()) || (COACH.rulesOpen && COACH.rulesOpen())
                 || !document.getElementById('play-result').hidden,
    steps: [
      { title: 'Your hand', text: 'These 8 cards are yours. Tap one to pick it up.',
        target: '#hand_user', when: () => _playMyTurn('play'), until: () => !!selectedCard },
      { title: 'Play or discard', text: 'Tap the glowing spot in your row to start that colour’s venture, or the middle row to discard it.',
        target: () => [document.getElementById('play_user'), document.getElementById('discard_draw')], waitFor: 'moved' },
      { title: 'Draw a card', text: 'Now take a card: the deck, or the top card of a discard pile.',
        target: '#middle-section', waitFor: 'draw' },
      { title: 'Their turn', text: 'The computer plays the same way. You can’t see its hand, and it can’t see yours.',
        target: '#hand_opp', next: true },
      { title: 'Up only', text: 'A venture only climbs: a 4 can’t go on a 6. Wagers (handshakes) go first and multiply.',
        target: '#play_user', next: true },
      { title: 'Scoring', text: 'Each venture scores its numbers minus 20. Start only colours you can fill.',
        target: '#play_user', next: true },
      { title: 'The deck is the clock', text: 'The round ends when the deck runs out. Three rounds make a match.',
        target: () => document.querySelector('#discard_draw .card-col:last-child') || document.getElementById('middle-section'), next: true },
      { title: 'Lab and help', text: 'Rules are under “?”. Lab shows every card and the study tools.',
        target: () => document.getElementById('play-lab'), next: true },
    ],
    onFinish: () => { PLAY.tutorial = false; },
  });
}

function playStartTutorial(){
  if (LAB.mode !== 'play') labSetMode('play');
  if (!_playTour) _playTour = _playBuildTour();
  if (!_playTour) return;
  _playTour.reset();
  PLAY.rounds = 1;
  LAB.ai = 'solid';
  _playSyncOpponent();
  playStartMatch({ first: 'player1', tutorial: true });
  _playTour.start(0);
}

/* ------------------------------------------------------------- sounds */

/* The vendored client has its own little synth (vendor/src/sound.js). Route its
   cues through fx.js so the Settings switches (sound, volume, game sounds,
   alerts) apply to them. Lab mode's result keeps using SFX.win / gameOver. */
function _playRouteSounds(){
  if (!window.FX || typeof SFX === 'undefined') return;
  try { FX.init({ game: 'lost-cities', accent: '#d4a843', clicks: false }); } catch (e){ return; }
  const map = { select: 'tap', play: 'cardSlide', discard: 'cardFlip', drawCard: 'cardDeal', undo: 'whoosh',
                yourTurn: 'turn', idleNag: 'turn', error: 'error', timeUp: 'alarm', achievement: 'ding',
                win: 'win', gameOver: 'lose' };
  for (const k of Object.keys(map)) SFX[k] = () => { try { FX.play(map[k]); } catch (e){} };
}

/* ------------------------------------------------------------- saved match */

/* The match in progress is saved at every turn boundary and resumed after a
   reload. Not saved: a study game started in the lab, the guided game, online
   rooms (the room has its own resume), and never in the middle of the
   computer's turn (it decides its card and draw together). */
const _playOnline = () => typeof NET !== 'undefined' && NET.on;
function playClearSave(){ try { localStorage.removeItem(PLAY_SAVE_KEY); } catch (e){} }
function _playSaveMatch(){
  if (!PLAY.active || PLAY.tutorial || _playOnline()){ playClearSave(); return; }
  if (!gameState) return;
  if (PLAY.results.length >= PLAY.rounds){ playClearSave(); return; }
  if (gameState.currentTurn !== userSlot && gameState.phase === 'draw' && gameState.status !== 'finished') return;
  try {
    localStorage.setItem(PLAY_SAVE_KEY, JSON.stringify({
      v: 1, colors: CONFIG.colors.length, userSlot, ai: LAB.ai, labPeeked: _labPeeked,
      play: { rounds: PLAY.rounds, results: PLAY.results, first: PLAY.first, peeked: PLAY.peeked,
              daily: PLAY.daily, matchSix: PLAY.matchSix, counted: PLAY.counted, eight: _playEight },
      gameState }));
  } catch (e){}
}
function _playResume(){
  let s = null;
  try { s = JSON.parse(localStorage.getItem(PLAY_SAVE_KEY) || 'null'); } catch (e){}
  if (!s) return false;
  if (!playSaveValid(s)){ playClearSave(); return false; }
  try { if (localStorage.getItem('online.lost-cities')) return false; } catch (e){}   // the room resumes instead
  _labCancelAI();
  setVentureCount(s.colors);
  userSlot = s.userSlot;
  LAB.ai = s.ai;
  _playSyncOpponent();
  const p = s.play;
  Object.assign(PLAY, { active: true, recorded: false, tutorial: false, rounds: p.rounds, results: p.results,
                        first: p.first, peeked: !!p.peeked, daily: p.daily || null, matchSix: !!p.matchSix, counted: !!p.counted });
  _playEight = !!p.eight;
  _labPeeked = !!s.labPeeked;
  gameState = s.gameState;
  selectedCard = null; lastPlayedCard = null; spreadPile = null;
  _labResetTurnSnapshot();
  createCardPool();
  renderGame._snapNextRender = true;
  renderGame();
  _playPaintMatch();
  if (gameState.status === 'finished'){
    if (!PLAY.counted) _playRoundOver();
    else {
      const last = PLAY.results[PLAY.results.length - 1];
      _playShowResult(false, last.my, last.opp, _playTotals(), null);
    }
  } else {
    _labFlash(PLAY.rounds > 1 ? 'Match resumed: round ' + (PLAY.results.length + 1) : 'Game resumed');
    if (gameState.currentTurn !== userSlot) _labAITurn();
  }
  return true;
}

/* The lab's Statistics, computer runs, duels and tournaments are measured on
   the five-colour game (their score ranges are fixed at load). */
function _playFiveOnly(run){
  return function(){
    if (CONFIG.colors.length !== 5){ _labFlash('Statistics use five colours: tap New first'); return; }
    return run.apply(this, arguments);
  };
}

/* ------------------------------------------------------------- boot */

/* Home-screen kit (js/pwa.js): may a new deploy reload the page by itself?
   Only when nothing is lost. Games are not saved across a reload, so a deal in
   progress (even untouched) or a match with rounds still to play is not safe. */
function _playSafeToReload(){
  if (document.querySelector('.play-sheet:not([hidden]):not(#play-result), .pf-ov, .coach-layer:not(.coach-off), .coach-offer')) return false;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
  if ((typeof STATS !== 'undefined' && STATS.running) || (typeof CPU !== 'undefined' && CPU.running)) return false;
  if (typeof gameState === 'undefined' || !gameState || gameState.status !== 'finished') return false;
  if (PLAY.active && PLAY.results.length < PLAY.rounds) return false;
  return true;
}

function _playInit(){
  if (window.PWA) PWA.safeToReload = _playSafeToReload;
  _playLoad();
  labSyncOpponentList();
  _playSyncOpponent();
  _playRouteSounds();

  // Coach + profile
  if (typeof Profile !== 'undefined'){
    try {
      Profile.init({
        game: 'lost-cities', levels: _playLevels(), achievements: PLAY_ACH,
        modes: { computer: { name: 'vs computer' }, online: { name: 'Online' } },
        daily: { title: 'Daily game', onPlay: () => playStartDaily() },
      });
    } catch (e){ console.warn('[play] profile', e); }
  }

  // Top bar
  const newBtn = document.getElementById('lab-new');
  newBtn.onclick = () => {
    SFX.select();
    if (LAB.mode === 'lab'){ PLAY.active = false; playClearSave(); setVentureCount(5); _playHideResult(); _playPaintMatch(); newLabGame(); }
    else playOpenNewGame();
  };
  document.getElementById('play-lab').onclick = () => {
    SFX.select();
    labSetMode(LAB.mode === 'lab' ? 'play' : 'lab');
  };
  document.getElementById('play-rules').onclick = () => { SFX.select(); playOpenRules(); };
  document.getElementById('play-menu').onclick = () => { SFX.select(); playOpenSettings(); };
  document.getElementById('play-resume').onclick = () => {
    document.getElementById('play-resume').hidden = true;
    document.getElementById('play-result').hidden = false;
  };
  on('labMode', (mode) => {
    document.getElementById('play-lab').classList.toggle('on', mode === 'lab');
    _playPaintMatch();
  });
  document.getElementById('play-lab').classList.toggle('on', LAB.mode === 'lab');
  // A new deal hides the folded result button.
  on('newGame', () => { const r = document.getElementById('play-resume'); if (r) r.hidden = true; _playStartPause = true; _playSyncOppName(); });
  on('cardPlayed', d => _playNoteCpu('play', d));
  on('cardDiscarded', d => _playNoteCpu('discard', d));
  on('cardDrawn', d => _playNoteCpu('draw', d));
  // Opponent changed from the lab bar mid-match: keep the sheet's default in step.
  document.getElementById('lab-ai').addEventListener('change', _playSave);

  // Tell the guided game what happened.
  on('stateChanged', ({ action }) => {
    if (typeof COACH === 'undefined') return;
    if (action === 'play' || action === 'discard') COACH.emit('moved');
    else if (action === 'draw') COACH.emit('draw');
  });

  // Escape closes a sheet.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _playSheetOpen()) _playCloseSheet(); });

  // Every turn boundary saves the match in progress.
  on('turnChanged', _playSaveMatch);
  on('stateChanged', _playSaveMatch);
  on('newGame', () => setTimeout(_playSaveMatch, 0));
  if (typeof statsRun === 'function') statsRun = _playFiveOnly(statsRun);
  if (typeof cpuRun === 'function') cpuRun = _playFiveOnly(cpuRun);
  if (typeof duelRun === 'function') duelRun = _playFiveOnly(duelRun);
  if (typeof tourneyRun === 'function') tourneyRun = _playFiveOnly(tourneyRun);

  // A match saved before a reload carries on; otherwise, opened in Play, the
  // deal on the table becomes round 1.
  const resumed = _playResume();
  if (!resumed && LAB.mode === 'play'){
    PLAY.active = true; PLAY.results = []; PLAY.first = gameState ? gameState.currentTurn : 'player1';
    PLAY.matchSix = false; PLAY.counted = false;
  }
  _playPaintMatch();
  _labSetTopInset();
  renderGame._snapNextRender = true;
  renderGame();

  // First visit: offer the guided game once.
  if (typeof COACH !== 'undefined' && LAB.mode === 'play'){
    if (!_playTour) _playTour = _playBuildTour();
    if (_playTour && _playTour.saved()) { /* a reload mid-tour: start a fresh tutorial deal */ }
    setTimeout(() => {
      try {
        COACH.offer({ id: 'venture-first', title: 'First time here?', text: 'A short guided game shows how to play.',
                      yes: 'Show me', no: 'No thanks', onYes: () => playStartTutorial(),
                      place: 'auto', avoid: ['#hand_user'] });
      } catch (e){}
    }, 600);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _playInit);
else _playInit();
