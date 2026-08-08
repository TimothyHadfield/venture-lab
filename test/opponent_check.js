// Playing a COMPUTER on the board — the bridge in lab.js that hands the live
// gameState to a computer as the duel view it was measured on.
//
// The point of the check is that the bridge is the ONLY new thing: every
// computer here is unmodified, so if one plays an illegal card on the board
// while playing legally in a duel, the fault is the translation. So each
// computer plays a full game as the lab opponent, driven through the real
// ENGINE, and every move is checked against the real rules.
//
// Slices lab.js by signature, same as the other checks — rename one of those
// functions and this fails loudly rather than quietly testing nothing.
const fs = require('fs'), path = require('path'), vm = require('vm');
const LABDIR = require('path').join(__dirname, '..');
const read = p => fs.readFileSync(path.join(LABDIR, p), 'utf8');

let flashed = [], warned = [];
const ctx = { console: Object.assign(Object.create(console), { warn: m => warned.push(m) }),
              localStorage: { getItem: () => null, setItem: () => {} },
              document: { readyState: 'loading', addEventListener: () => {}, getElementById: () => null } };
vm.createContext(ctx);
for (const f of ['config.js', 'events.js', 'math.js', 'rules.js', 'constants.js', 'engine.js']) {
  let s = read('vendor/src/' + f).replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  // constants.js is mostly Firebase/notification plumbing; take only the two
  // helpers the engine actually calls, from the real file rather than a copy.
  if (f === 'constants.js')
    s = s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0] + '\n'
      + s.match(/function useSinglePile\(\)\{.*\}/)[0];
  vm.runInContext(s, ctx);
}
// The lab is always the classic variant (lab.js `_labInit`); useSinglePile reads it.
vm.runInContext('var variant = "classic";', ctx);

const L = read('lab.js').split(/\r?\n/);
const cut = (from, to) => {
  const a = L.findIndex(l => l.includes(from)), b = L.findIndex(l => l.includes(to));
  if (a < 0 || b < 0 || b <= a) throw new Error('slice not found: ' + from + ' .. ' + to);
  return L.slice(a, b).join('\n');
};
vm.runInContext(cut('const LAB = {', 'stubs the stack expects'), ctx);
vm.runInContext(cut('function venturePotential(pile, pool', 'function labColorPotential'), ctx);
vm.runInContext(read('computers.js'), ctx);
// The bridge itself, plus the legality helper it shares with the built-in
// opponent. `_labFlash` is a DOM toast; stubbed so a fallback is observable.
// One contiguous run: the legality helpers, both built-in levels, the computer
// bridge, and _labAITurn — which is the glue that has to carry a computer's
// chosen DRAW across the two halves of its turn.
vm.runInContext(cut('function _labCanPlay(card, pile)', 'POTENTIAL — the analysis feature').replace(/\/\* =+\s*$/, ''), ctx);
// What the opponent picker offers. Only the pure list — labSyncOpponentList
// itself is markup and belongs to the browser.
vm.runInContext(cut('const LAB_LEVELS = [', 'function labSyncOpponentList'), ctx);
vm.runInContext(`
  let _seed = 7;
  Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
  var gameState = null;
  var userSlot = 'player1';
  // _labAITurn's two waits are the animation pacing; running them straight
  // through turns one call into one complete opponent turn.
  var setTimeout = f => f();
  var SFX = { play(){}, discard(){}, drawCard(){}, win(){}, gameOver(){}, select(){}, undo(){} };
  function renderGame(){}
  function _labGameOver(){ globalThis.__over++; }
  function _labFlash(m){ globalThis.__flash.push(m); }
  globalThis.B = {
    COMPUTERS, CONFIG, RULES, ENGINE, MATH,
    seed: n => { _seed = n >>> 0; },
    setAI: v => { LAB.ai = v; },
    setState: s => { gameState = s; },
    state: () => gameState,
    view: _labCpuView, choose: _labCpuChooseTurn, bot: _labCpuBot,
    turn: () => { _labAIBusy = false; _labAITurn(); },
    // What newLabGame() and the opponent picker's onchange both do.
    freshWarning: () => { _labCpuWarned = false; },
  };
`, ctx);
ctx.__flash = flashed;
ctx.__over = 0;
const B = ctx.B;

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '  = ' + JSON.stringify(got)
    : '\n         got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want)));
};
const ok = (name, cond, extra) => eq(name + (extra !== undefined ? '  [' + extra + ']' : ''), !!cond, true);

const OPP = 'player2';                 // the lab is always player1
const fresh = () => {
  const gs = B.ENGINE.initGame('classic', false);
  gs.currentTurn = OPP;
  return gs;
};

console.log('the view handed to a computer');
{
  B.setAI('cpu:broker');
  const gs = fresh();
  B.setState(gs);
  const v = B.view(OPP);

  eq('it is the opponent who is to move', v.me, OPP);
  eq('and the lab is across the table', v.opp, 'player1');
  ok('their hand is the hand the state holds',
     v.hand.length === B.CONFIG.handSize && v.hand.every(c => gs.hands[OPP].indexOf(c) >= 0));
  ok('our hand is visible to them — the duel is perfect information',
     v.oppHand.length === B.CONFIG.handSize);
  eq('the deck is the whole draw pile', v.deck.length, gs.drawPile.length);
  ok('and it is ORDERED the way the engine pops it — last is next',
     v.deck[v.deck.length - 1] === gs.drawPile[gs.drawPile.length - 1]);
  ok('every colour has an array on both piles and the discards',
     B.CONFIG.colors.every(c => Array.isArray(v.piles[c]) && Array.isArray(v.oppPiles[c])
                             && Array.isArray(v.discards[c])));
  ok('playable is what the real rules allow, not a copy of the logic',
     JSON.stringify(v.playable.map(c => c.id))
     === JSON.stringify(v.hand.filter(c => B.RULES.canPlayOnPlayPile(c, v.piles[c.color])).map(c => c.id)));
  ok('the cards are the state\'s own objects, not clones — computers compare by reference',
     v.hand[0] === gs.hands[OPP][0]);
}

console.log('');
console.log('a missing colour array does not throw');
{
  // getCards exists because this is a real shape the state can take. A computer
  // indexing straight into piles[colour] would throw on it, so the view has to
  // fill the gaps rather than pass the state through.
  B.setAI('cpu:broker');
  const gs = fresh();
  delete gs.discards[B.CONFIG.colors[0]];
  delete gs.playPiles[OPP][B.CONFIG.colors[1]];
  B.setState(gs);
  let threw = null;
  try { B.choose(OPP); } catch (e){ threw = e.message; }
  eq('the bridge survives it', threw, null);
  eq('and no computer had to be bailed out', warned.length, 0);
}

console.log('');
console.log('every computer plays a whole game on the board, legally');
{
  // The lab's own side plays the plainest legal move there is — this is a test
  // of the opponent bridge, not a match. What is asserted is that the game
  // reaches its end with every move the computer made a legal one.
  const plainMove = (gs, slot) => {
    const hand = gs.hands[slot];
    const p = hand.find(c => B.RULES.canPlayOnPlayPile(c, gs.playPiles[slot][c.color]));
    return p ? { play: true, card: p } : { play: false, card: hand[0] };
  };

  for (const key of Object.keys(B.COMPUTERS)){
    const name = B.COMPUTERS[key].name;
    B.seed(101);
    B.setAI('cpu:' + key);
    flashed.length = 0; warned.length = 0;
    const gs = fresh();
    B.setState(gs);

    let cpuMoves = 0, illegal = 0, plies = 0, bailed = 0;
    while (gs.status !== 'finished' && plies < 400){
      plies++;
      const slot = gs.currentTurn;
      if (slot === OPP){
        const mv = B.choose(OPP);
        if (!mv){ bailed++; break; }
        cpuMoves++;
        if (mv.kind === 'play'){
          // The assertion that matters: what it chose was legal at the moment
          // it chose it, judged by the real rules and not by our own copy.
          if (!B.RULES.canPlayOnPlayPile(mv.card, gs.playPiles[slot][mv.card.color])) illegal++;
          B.ENGINE.playCard(gs, slot, mv.card, mv.color);
        } else {
          B.ENGINE.discardCard(gs, slot, mv.card, mv.color);
        }
        const drew = mv.draw ? B.ENGINE.drawFromDiscard(gs, slot, mv.draw) : { success: false };
        if (!drew.success) B.ENGINE.drawFromDeck(gs, slot);
      } else {
        const m = plainMove(gs, slot);
        if (m.play) B.ENGINE.playCard(gs, slot, m.card, m.card.color);
        else B.ENGINE.discardCard(gs, slot, m.card, m.card.color);
        B.ENGINE.drawFromDeck(gs, slot);
      }
    }
    const score = s => B.CONFIG.colors.reduce((t, c) => t + B.MATH.scorePlayPile(gs.playPiles[s][c]), 0);
    ok(name + ' — never chose an illegal play', illegal === 0, illegal + ' illegal of ' + cpuMoves);
    ok(name + ' — never had to be bailed out', bailed === 0 && warned.length === 0, warned[0] || 'clean');
    ok(name + ' — the game finished', gs.status === 'finished', plies + ' plies');
    ok(name + ' — and it scored', typeof score(OPP) === 'number', score('player1') + ' – ' + score(OPP));
  }
}

console.log('');
console.log('the turn loop carries the computer\'s chosen DRAW');
{
  // A computer decides its card and its draw in ONE call, from the position
  // before the card is played — that is the contract playDuelGame uses, and so
  // it is what these computers were measured making. On the board the two
  // halves are seconds apart, so the draw has to be held across them. Nothing
  // above this point tests that: the checks call the bridge and then do the
  // drawing themselves.
  //
  // The Broker is the computer that names a pile at all — the rest fall through
  // to the deck — so it is the one that can catch a dropped handoff.
  const named = [], attempted = [];
  const realDecide = B.COMPUTERS.broker.decide;
  const realDraw = B.ENGINE.drawFromDiscard;
  B.COMPUTERS.broker.decide = function(view){
    const m = realDecide.call(this, view);
    named.push(m.draw && m.draw !== 'deck' ? m.draw : null);
    return m;
  };
  B.ENGINE.drawFromDiscard = function(state, player, color){
    const r = realDraw.call(this, state, player, color);
    attempted.push({ color, ok: r.success });
    return r;
  };

  B.seed(2024);
  B.setAI('cpu:broker');
  B.freshWarning();
  flashed.length = 0; warned.length = 0; ctx.__over = 0;
  const gs = fresh();
  B.setState(gs);

  let plies = 0;
  while (gs.status !== 'finished' && plies < 400){
    plies++;
    if (gs.currentTurn === OPP){
      B.turn();                        // the real _labAITurn: play, then draw
    } else {
      const hand = gs.hands['player1'];
      const p = hand.find(c => B.RULES.canPlayOnPlayPile(c, gs.playPiles['player1'][c.color]));
      if (p) B.ENGINE.playCard(gs, 'player1', p, p.color);
      else B.ENGINE.discardCard(gs, 'player1', hand[0], hand[0].color);
      B.ENGINE.drawFromDeck(gs, 'player1');
    }
  }

  ok('the game played itself out through _labAITurn', gs.status === 'finished', plies + ' plies');
  ok('and the end was noticed', ctx.__over === 1, ctx.__over + ' game-over calls');
  ok('The Broker asked for a discard pile at least once — otherwise this proves nothing',
     named.filter(Boolean).length > 0, named.filter(Boolean).length + ' pile draws asked for');
  eq('every pile it asked for was the pile the engine was asked for',
     attempted.map(a => a.color), named.filter(Boolean));
  ok('and nothing was drawn from a pile it did not ask for',
     attempted.length === named.filter(Boolean).length);
  ok('no fallbacks along the way', flashed.length === 0 && warned.length === 0, warned[0] || 'clean');

  B.COMPUTERS.broker.decide = realDecide;
  B.ENGINE.drawFromDiscard = realDraw;
}

console.log('');
console.log('a broken computer falls back instead of wedging the game');
{
  // Computers can be written in the builder thirty seconds before they are
  // played, so the bridge has to survive one that is wrong — not just one that
  // is weak. Each of these is a different way to be wrong.
  const gs = fresh();
  B.setState(gs);
  const stolen = { id: 'not-in-any-hand', color: B.CONFIG.colors[0], value: 5 };
  const broken = {
    'throws':                { name: 'Thrower',  decide(){ throw new Error('boom'); } },
    'returns nothing':       { name: 'Empty',    decide(){ return null; } },
    'names a card it does not hold': { name: 'Thief', decide(){ return { action:'play', card: stolen }; } },
  };
  // A play that the ascending rule forbids: the pile's top card, played again.
  gs.playPiles[OPP][B.CONFIG.colors[0]] = [{ id:'seed10', color:B.CONFIG.colors[0], value:10 }];
  const low = gs.hands[OPP].find(c => c.color === B.CONFIG.colors[0] && c.value > 0 && c.value < 10)
           || gs.hands[OPP][0];
  broken['plays an illegal card'] = { name: 'Illegal',
    decide(){ return { action:'play', card: { id: low.id, color: B.CONFIG.colors[0], value: 2 } }; } };

  for (const [why, bot] of Object.entries(broken)){
    B.COMPUTERS['__test'] = bot;
    B.setAI('cpu:__test');
    B.freshWarning();                  // switching opponent clears the last one
    flashed.length = 0; warned.length = 0;
    let threw = null, mv;
    try { mv = B.choose(OPP); } catch (e){ threw = e.message; }
    eq('a computer that ' + why + ' — does not throw', threw, null);
    eq('  …returns nothing, so the built-in opponent takes over', mv, null);
    ok('  …and says so on the board', flashed.length === 1, flashed[0]);
    ok('  …and in the console, for the detail', warned.length === 1, warned[0]);

    // The flag is the whole reason a broken computer is playable at all: a
    // fallback happens EVERY turn, and one toast per turn for 44 turns would
    // bury the board it is trying to warn about.
    B.choose(OPP); B.choose(OPP);
    ok('  …and then stops repeating itself', flashed.length === 1, flashed.length + ' messages in 3 turns');
  }
  delete B.COMPUTERS['__test'];
}

console.log('');
console.log('what the picker offers is what the bridge can read back');
{
  // The one thing the option VALUES have to satisfy: every one of them either
  // names a built-in level or resolves to the computer whose name is on the
  // label. Get the 'cpu:' prefix wrong at either end and the bar silently
  // offers opponents that quietly play as Solid.
  const opts = ctx.labOpponentOptions();
  const levels = opts.filter(o => o.group === 'Built-in levels').map(o => o.value);
  eq('the three built-in levels come first', levels, ['casual', 'solid', 'sharp']);
  eq('and then every computer', opts.length - 3, Object.keys(B.COMPUTERS).length);

  let mismatched = [];
  for (const o of opts){
    B.setAI(o.value);
    const bot = B.bot();
    if (levels.indexOf(o.value) >= 0 ? bot !== null : (!bot || bot.name !== o.label))
      mismatched.push(o.value);
  }
  eq('every option resolves to exactly the opponent it names', mismatched, []);
  ok('the labels are the computers\' own names',
     opts.slice(3).map(o => o.label).join(', ') === Object.keys(B.COMPUTERS).map(k => B.COMPUTERS[k].name).join(', '),
     opts.slice(3).map(o => o.label).join(', '));
}

console.log('');
console.log('the built-in levels are untouched by any of this');
{
  for (const level of ['casual', 'solid', 'sharp']){
    B.setAI(level);
    B.setState(fresh());
    eq(level + ' resolves to no computer', B.bot(), null);
    eq('  …so the bridge declines and the level plays', B.choose(OPP), null);
  }
  B.setAI('cpu:no-such-computer');
  eq('a deleted computer declines too, rather than throwing', B.choose(OPP), null);
}

console.log('');
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exit(failed ? 1 : 0);
