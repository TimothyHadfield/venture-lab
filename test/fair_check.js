// PLAY MODE: a computer opponent must not see your hand or the deck order.
//
// In the lab (study) board the computer plays with perfect information, like a
// measured duel. Play mode is the normal hidden-information game, so the view
// handed to the computer must hold the SAME unseen cards (your hand + the deck)
// but not where they are: shuffled and dealt back out in the same sizes.
// Also checks every computer still plays whole legal games on the fair view.
//
// LAB_JS=<path> points at another copy of lab.js (to watch it fail on the old one).
const fs = require('fs'), path = require('path'), vm = require('vm');
const LABDIR = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(LABDIR, p), 'utf8');
const ctx = { console, localStorage: { getItem: () => null, setItem: () => {} },
              document: { readyState: 'loading', addEventListener: () => {}, getElementById: () => null } };
vm.createContext(ctx);
for (const f of ['config.js', 'events.js', 'math.js', 'rules.js', 'constants.js', 'engine.js']) {
  let s = read('vendor/src/' + f).replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  if (f === 'constants.js')
    s = s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0] + '\n'
      + s.match(/function useSinglePile\(\)\{.*\}/)[0];
  vm.runInContext(s, ctx);
}
vm.runInContext('var variant = "classic";', ctx);
const L = fs.readFileSync(process.env.LAB_JS || path.join(LABDIR, 'lab.js'), 'utf8').split(/\r?\n/);
const cut = (from, to) => {
  const a = L.findIndex(l => l.includes(from)), b = L.findIndex(l => l.includes(to));
  if (a < 0 || b < 0 || b <= a) throw new Error('slice not found: ' + from + ' .. ' + to);
  return L.slice(a, b).join('\n');
};
vm.runInContext(cut('const LAB = {', 'stubs the stack expects'), ctx);
vm.runInContext(cut('function venturePotential(pile, pool', 'function labColorPotential'), ctx);
vm.runInContext(read('computers.js'), ctx);
vm.runInContext(cut('function _labCanPlay(card, pile)', 'POTENTIAL — the analysis feature').replace(/\/\* =+\s*$/, ''), ctx);
vm.runInContext(`
  let _seed = 11;
  Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
  var gameState = null, userSlot = 'player1';
  function _labFlash(){}
  globalThis.B = { COMPUTERS, CONFIG, RULES, ENGINE, MATH, LAB,
    setState: s => { gameState = s; }, view: _labCpuView, choose: _labCpuChooseTurn,
    setAI: v => { LAB.ai = v; } };
`, ctx);
const B = ctx.B;
let failed = 0;
const ok = (name, cond, extra) => { if (!cond) failed++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); };
const ids = a => a.map(c => c.id).sort().join(',');

ok('the page opens in play mode', B.LAB.mode === 'play', B.LAB.mode);
ok('with the opponent hand, deck and potential hidden', !B.LAB.revealOpp && !B.LAB.revealDeck && !B.LAB.potential);

console.log('the view a computer gets in play mode');
B.LAB.mode = 'play';
B.setAI('cpu:broker');
let sameHand = 0, sameDeck = 0;
const N = 50;
for (let i = 0; i < N; i++){
  const gs = B.ENGINE.initGame('classic', false);
  gs.currentTurn = 'player2';
  B.setState(gs);
  const v = B.view('player2');
  const realHand = gs.hands.player1, realDeck = gs.drawPile;
  if (i === 0){
    ok('its own hand is the real one', ids(v.hand) === ids(gs.hands.player2));
    ok('your hand is the right SIZE', v.oppHand.length === realHand.length, v.oppHand.length);
    ok('the deck is the right size', v.deck.length === realDeck.length, v.deck.length);
    ok('the unseen cards are the same set', ids(v.oppHand.concat(v.deck)) === ids(realHand.concat(realDeck)));
  }
  if (ids(v.oppHand) === ids(realHand)) sameHand++;
  if (v.deck.map(c => c.id).join() === realDeck.map(c => c.id).join()) sameDeck++;
}
ok('it never got your real hand', sameHand === 0, sameHand + ' of ' + N);
ok('it never got the real deck order', sameDeck === 0, sameDeck + ' of ' + N);

console.log('every computer still plays whole legal games on the fair view');
for (const key of Object.keys(B.COMPUTERS)){
  B.setAI('cpu:' + key);
  const gs = B.ENGINE.initGame('classic', false);
  gs.currentTurn = 'player2';
  B.setState(gs);
  let plies = 0, illegal = 0, bailed = 0;
  while (gs.status !== 'finished' && plies < 400){
    plies++;
    const slot = gs.currentTurn;
    if (slot === 'player2'){
      const mv = B.choose('player2');
      if (!mv){ bailed++; break; }
      if (mv.kind === 'play'){
        if (!B.RULES.canPlayOnPlayPile(mv.card, gs.playPiles[slot][mv.card.color])) illegal++;
        B.ENGINE.playCard(gs, slot, mv.card, mv.color);
      } else B.ENGINE.discardCard(gs, slot, mv.card, mv.color);
      const d = mv.draw ? B.ENGINE.drawFromDiscard(gs, slot, mv.draw) : { success: false };
      if (!d.success) B.ENGINE.drawFromDeck(gs, slot);
    } else {
      const hand = gs.hands[slot];
      const p = hand.find(c => B.RULES.canPlayOnPlayPile(c, gs.playPiles[slot][c.color]));
      if (p) B.ENGINE.playCard(gs, slot, p, p.color); else B.ENGINE.discardCard(gs, slot, hand[0], hand[0].color);
      B.ENGINE.drawFromDeck(gs, slot);
    }
  }
  ok(B.COMPUTERS[key].name + ': finished, legal, no fallback', gs.status === 'finished' && !illegal && !bailed,
     plies + ' plies, ' + illegal + ' illegal, ' + bailed + ' bailed');
}

console.log('lab mode is unchanged: perfect information');
B.LAB.mode = 'lab';
{
  const gs = B.ENGINE.initGame('classic', false);
  gs.currentTurn = 'player2';
  B.setState(gs);
  const v = B.view('player2');
  ok('your real hand', ids(v.oppHand) === ids(gs.hands.player1));
  ok('the real deck order', v.deck.map(c => c.id).join() === gs.drawPile.map(c => c.id).join());
}
if (failed){ console.log('\n' + failed + ' FAILED'); process.exit(1); }
console.log('\nall ok');
