// Checks the new hand ordering against the vendored rules: both hands ranked by
// their own colour potential, ties broken sanely, and the render wrapper intact.
const fs = require('fs'), path = require('path'), vm = require('vm');
const LABDIR = require('path').join(__dirname, '..');
const read = p => fs.readFileSync(path.join(LABDIR, p), 'utf8');

const ctx = { console };
vm.createContext(ctx);
for (const f of ['config.js', 'math.js', 'rules.js', 'constants.js']) {
  let s = read('vendor/src/' + f).replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  if (f === 'constants.js') s = s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0];
  vm.runInContext(s, ctx);
}
const L = read('lab.js').split(/\r?\n/);
const cut = (from, to, back) => {
  const a = L.findIndex(l => l.includes(from));
  const b = L.findIndex(l => l.includes(to)) - (back || 0);
  if (a < 0 || b < 0) throw new Error('slice not found: ' + from + ' .. ' + to);
  return L.slice(a, b).join('\n');
};
const src = cut('function venturePotential(pile, pool', '/* --- render the potential row')
          + '\n' + cut('function labProjectedTurns(slot)', '   THE INFO PANEL', 1)   // -1: skip the /* opener;

vm.runInContext(`
  let gameState = null;
  let userSlot = 'player1';
  let renderCalls = 0;
  function renderGame(){ renderCalls++; return 'original'; }
  renderGame._firstRender = true;
  ${src}
  globalThis.T = {
    hook: _labHookHandOrder,
    sortHands: _labSortHands,
    cmp: (a, b) => CONFIG.cardSortComparator(a, b),
    render: () => renderGame(),
    renderCalls: () => renderCalls,
    flags: () => ({ first: renderGame._firstRender, snap: renderGame._snapNextRender }),
    set: gs => { gameState = gs; },
    setSlot: s => { userSlot = s; },
    pot: (slot, c) => labColorPotential(slot, c),
    colors: CONFIG.colors.slice(),
  };
`, ctx);
const T = ctx.T;

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '  = ' + JSON.stringify(got)
    : '\n         got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want)));
};

const card = (color, value) => ({ id: color + value, color, value });
const empty = () => { const o = {}; for (const c of T.colors) o[c] = []; return o; };
const state = o => ({
  drawPile: o.deck || [],
  hands: { player1: o.p1 || [], player2: o.p2 || [] },
  playPiles: { player1: Object.assign(empty(), o.piles1 || {}), player2: Object.assign(empty(), o.piles2 || {}) },
  discards: Object.assign(empty(), o.disc || {}),
  currentTurn: 'player1', phase: 'play',
});
const show = cards => cards.map(c => c.color[0] + c.value).join(' ');

T.hook();

console.log('my hand — best colour on the left');
{
  // red is rich (whole colour in the deck), blue is nearly gone, green in between.
  const deck = [];
  for (let v = 2; v <= 10; v++) deck.push(card('red', v));
  deck.push(card('red', 0), card('red', 0), card('red', 0));
  deck.push(card('green', 9), card('green', 10));
  const hand = [card('blue', 4), card('green', 5), card('red', 7), card('red', 3)];
  T.set(state({ deck, p1: hand }));
  T.sortHands();
  const sorted = hand.slice().sort(T.cmp);
  console.log('   potentials: ' + T.colors.map(c => c + ' ' + T.pot('player1', c)).join(', '));
  eq('red (richest) leads, blue (poorest) trails', show(sorted), 'r3 r7 g5 b4');
  eq('...and a colour keeps its own ascending run', sorted[0].value < sorted[1].value, true);
}

console.log('\nthe opponent hand is sorted in place, by THEIR potential');
{
  // player2 has played red 9, so red is nearly dead FOR THEM while it is still
  // rich for player1 — the two hands must therefore order differently.
  const deck = [];
  for (let v = 2; v <= 10; v++) deck.push(card('red', v));
  deck.push(card('yellow', 8), card('yellow', 9), card('yellow', 10));
  const mine = [card('red', 5), card('yellow', 3)];
  const theirs = [card('red', 6), card('yellow', 4)];
  T.set(state({ deck, p1: mine, p2: theirs, piles2: { red: [card('red', 9)] } }));
  T.sortHands();
  console.log('   mine:   ' + T.colors.map(c => c + ' ' + T.pot('player1', c)).join(', '));
  console.log('   theirs: ' + T.colors.map(c => c + ' ' + T.pot('player2', c)).join(', '));
  eq('their hand array was reordered in place', show(theirs), 'y4 r6');
  eq('mine ranks red first, theirs ranks it last', [show(mine.slice().sort(T.cmp)), show(theirs)],
     ['r5 y3', 'y4 r6']);
}

console.log('\nties and edges');
{
  // Two colours with identical potential must not swap about at random: colour
  // order decides, so the layout is stable between renders.
  const deck = [card('red', 7), card('blue', 7)];
  const hand = [card('blue', 2), card('red', 2)];
  T.set(state({ deck, p1: hand }));
  T.sortHands();
  eq('equal potentials fall back to colour order', show(hand.slice().sort(T.cmp)), 'r2 b2');
  eq('...and the sort is stable across repeated calls',
     show(hand.slice().sort(T.cmp)), show(hand.slice().sort(T.cmp)));
}
{
  T.set(state({ deck: [], p1: [], p2: [] }));
  T.sortHands();
  eq('an empty hand is fine', show([].sort(T.cmp)), '');
}
{
  // Playing high kills a colour's potential, so that colour should fall to the
  // right of the hand — the "these are your discards" end.
  const deck = [];
  for (let v = 2; v <= 10; v++){ deck.push(card('red', v)); deck.push(card('green', v)); }
  const hand = [card('red', 3), card('green', 3)];
  T.set(state({ deck, p1: hand, piles1: { red: [card('red', 10)] } }));
  T.sortHands();
  eq('a locked-out colour sinks to the right', show(hand.slice().sort(T.cmp)), 'g3 r3');
}

console.log('\nthe render wrapper');
{
  const before = T.renderCalls();
  T.set(state({ deck: [], p1: [card('red', 4)], p2: [card('blue', 5)] }));
  eq('renderGame still calls through to the original', T.render(), 'original');
  eq('...exactly once', T.renderCalls() - before, 1);
  eq('...and carries its own render flags', T.flags().first, true);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
