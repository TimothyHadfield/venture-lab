// Checks the new potential rule by slicing the REAL functions out of lab.js and
// running them against the vendored math.js/config.js. Scratch only.
const fs = require('fs'), path = require('path'), vm = require('vm');
const LAB = require('path').join(__dirname, '..');

const src = fs.readFileSync(path.join(LAB, 'lab.js'), 'utf8').split(/\r?\n/);
const start = src.findIndex(l => l.includes('function venturePotential(pile, pool'));
const end = src.findIndex(l => l.includes('/* --- render the potential row'));
// labColorPotential now leans on _labPileOf/_labPoolOf, which live in the
// reachable-potential block further down; take that too (minus 1 line, so the
// slice does not end inside the info panel's opening comment).
const start2 = src.findIndex(l => l.includes('function labProjectedTurns(slot)'));
const end2 = src.findIndex(l => l.includes('   THE INFO PANEL')) - 1;
const slice = src.slice(start, end).join('\n') + '\n' + src.slice(start2, end2).join('\n');

const ctx = { console };
vm.createContext(ctx);
for (const f of ['config.js', 'math.js', 'constants.js']) {
  let s = fs.readFileSync(path.join(LAB, 'vendor/src', f), 'utf8');
  s = s.replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  // constants.js touches the DOM/Notification at load; keep only getCards.
  if (f === 'constants.js') s = s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0];
  vm.runInContext(s, ctx);
}

const card = (color, value, n) => ({ id: color + '_' + value + '_' + (n || 0), color, value });
const W = n => card('red', 0, n);                       // red wager
const R = v => card('red', v);
const empty = () => ({ red: [], green: [], blue: [], white: [], yellow: [] });

vm.runInContext(`
  let gameState = null;
  ${slice}
  globalThis.T = { venturePotential, labColorPotential, set: gs => { gameState = gs; },
                   score: p => MATH.scorePlayPile(p) };
`, ctx);
const T = ctx.T;

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '  = ' + JSON.stringify(got)
    : '\n         got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want)));
};

// The whole red colour: 3 wagers + 2..10.
const allRed = [W(1), W(2), W(3)].concat([2,3,4,5,6,7,8,9,10].map(R));
const MAX = T.score(allRed);                       // (54-20)*4 + 20 = 156

const state = (o) => ({
  drawPile: o.deck || [], hands: { player1: o.p1 || [], player2: o.p2 || [] },
  playPiles: { player1: Object.assign(empty(), o.piles1 || {}), player2: Object.assign(empty(), o.piles2 || {}) },
  discards: Object.assign(empty(), o.disc || {}),
});

console.log('theoretical max red venture = ' + MAX);

// 1. Everything in the deck: both players see the whole colour.
T.set(state({ deck: allRed }));
eq('all 12 red in the deck: mine', T.labColorPotential('player1', 'red'), MAX);
eq('all 12 red in the deck: theirs', T.labColorPotential('player2', 'red'), MAX);

// 2. THE CHANGE, part one — a card in the OPPONENT's hand no longer counts for
//    me, but still counts for them (they are holding it).
T.set(state({ deck: allRed.filter(c => c.value !== 10), p2: [R(10)] }));
const mineNo10 = T.labColorPotential('player1', 'red');
eq('their hand is out of my reach (10 gone from my ceiling)', mineNo10 < MAX, true);
eq('...and exactly the 10 is missing', mineNo10, T.score(allRed.filter(c => c.value !== 10)));
eq('...while THEY still count the 10 they hold', T.labColorPotential('player2', 'red'), MAX);

// 3. My own hand counts for me and not for them (the mirror image).
T.set(state({ deck: allRed.filter(c => c.value !== 10), p1: [R(10)] }));
eq('my own hand counts for me', T.labColorPotential('player1', 'red'), MAX);
eq('...and not for them', T.labColorPotential('player2', 'red'), mineNo10);

// 4. Discards. The rule has since been refined: only the TOP card counts, and
//    only if it was already there when that player's turn began. Timing is
//    covered properly in discard_check.js — here we only pin down that a
//    discard is NOT free potential the way it briefly was.
T.set(state({ deck: allRed.filter(c => c.value !== 7), disc: { red: [R(7)] } }));
eq('a discard nobody has had a turn to reach does not count',
   T.labColorPotential('player1', 'red'), T.score(allRed.filter(c => c.value !== 7)));

// 5. Unchanged behaviour: played cards are gone, and playing high locks out low.
T.set(state({ deck: allRed.filter(c => c.value !== 9), piles1: { red: [R(9)] } }));
eq('playing the red 9 locks out everything below it', T.labColorPotential('player1', 'red'),
   T.score([R(9), R(10)]));
eq('...and the 9 they can never have is gone from their ceiling too',
   T.labColorPotential('player2', 'red'), T.score(allRed.filter(c => c.value !== 9)));

// 6. A realistic opening deal: 8 cards each, so the two numbers differ.
const deal = () => {
  const deck = allRed.slice();
  const p1 = [deck.splice(2, 1)[0]];                 // one red in my hand
  const p2 = [deck.splice(0, 1)[0], deck.splice(3, 1)[0]];  // two in theirs
  return { deck, p1, p2 };
};
const d = deal();
T.set(state(d));
const mine = T.labColorPotential('player1', 'red'), theirs = T.labColorPotential('player2', 'red');
console.log('  opening deal — mine ' + mine + ', theirs ' + theirs + ' (both were ' + MAX + ' before)');
eq('neither player starts at the theoretical max any more', [mine < MAX, theirs < MAX], [true, true]);

process.exit(failed ? 1 : 0);
