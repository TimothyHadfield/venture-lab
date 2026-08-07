// Slices labProjectedTurns + _labAssistBlocked out of lab.js and runs them
// against the vendored config/math/rules. Scratch only.
const fs = require('fs'), path = require('path'), vm = require('vm');
const LABDIR = require('path').join(__dirname, '..');

const src = fs.readFileSync(path.join(LABDIR, 'lab.js'), 'utf8').split(/\r?\n/);
const cut = (from, to) => {
  const a = src.findIndex(l => l.includes(from));
  const b = src.findIndex(l => l.includes(to));
  if (a < 0 || b < 0) throw new Error('slice not found: ' + from);
  return src.slice(a, b).join('\n');
};
const slice = cut('function labProjectedTurns(slot){', 'function _labApplyAssist(){');

const ctx = { console };
vm.createContext(ctx);
for (const f of ['config.js', 'math.js', 'rules.js', 'constants.js']) {
  let s = fs.readFileSync(path.join(LABDIR, 'vendor/src', f), 'utf8');
  s = s.replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  if (f === 'constants.js') s = s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0];
  vm.runInContext(s, ctx);
}

vm.runInContext(`
  let gameState = null, userSlot = 'player1';
  const LAB = { assist: true };
  ${slice}
  globalThis.T = {
    turns: labProjectedTurns,
    blocked: () => Array.from(_labAssistBlocked()),
    set: gs => { gameState = gs; },
    assist: on => { LAB.assist = on; },
    canPlay: (c, pile) => canPlayOnPlayPile(c, pile),
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

const card = (color, value) => ({ id: color + value + '_' + Math.random().toString(36).slice(2, 5), color, value });
const empty = () => ({ red: [], green: [], blue: [], white: [], yellow: [] });
const state = o => ({
  drawPile: new Array(o.deck || 0).fill(0).map(() => card('blue', 3)),
  hands: { player1: o.hand || [], player2: [] },
  playPiles: { player1: Object.assign(empty(), o.piles || {}), player2: empty() },
  discards: empty(),
  currentTurn: o.turn || 'player1', phase: o.phase || 'play',
});

console.log('projected turns — a turn burns one deck card, so D cards = D turns split two ways');
T.set(state({ deck: 10, turn: 'player1', phase: 'play' }));
eq('D=10, my turn to play: mine', T.turns('player1'), 5);
eq('D=10, my turn to play: theirs', T.turns('player2'), 5);
T.set(state({ deck: 10, turn: 'player1', phase: 'draw' }));
eq('D=10, already played this turn: mine drops by one', T.turns('player1'), 4);
eq('...theirs is unchanged', T.turns('player2'), 5);
T.set(state({ deck: 1, turn: 'player1', phase: 'play' }));
eq('D=1: I get the last play', T.turns('player1'), 1);
eq('...and they get none', T.turns('player2'), 0);
T.set(state({ deck: 0, turn: 'player1', phase: 'play' }));
eq('empty deck: nobody plays again', [T.turns('player1'), T.turns('player2')], [0, 0]);
T.set(state({ deck: 7, turn: 'player2', phase: 'play' }));
eq('their turn, D=7: they get 4, I get 3', [T.turns('player2'), T.turns('player1')], [4, 3]);

console.log('\nassistant — hold everything but the lowest of a colour');
const r4 = card('red', 4), r7 = card('red', 7), r9 = card('red', 9);
T.set(state({ deck: 20, hand: [r4, r7, r9] }));           // 20 deck ⇒ 10 plays, plenty
eq('blocks the two higher reds, leaves the 4', T.blocked().sort(), [r7.id, r9.id].sort());

T.assist(false);
eq('nothing is blocked with the assistant off', T.blocked(), []);
T.assist(true);

// THE EXCEPTION. 3 playable reds needs 3 plays; give it only 2.
T.set(state({ deck: 4, hand: [r4, r7, r9] }));            // D=4 ⇒ 2 plays for me
eq('exception: not enough turns for all three, so none are blocked', T.blocked(), []);
T.set(state({ deck: 6, hand: [r4, r7, r9] }));            // D=6 ⇒ 3 plays — exactly enough
eq('exactly enough turns: the rule applies again', T.blocked().sort(), [r7.id, r9.id].sort());

// Wagers are value 0, so they are the lowest cards there are — and equal.
const w1 = card('red', 0), w2 = card('red', 0), r5 = card('red', 5);
T.set(state({ deck: 20, hand: [w1, w2, r5] }));
eq('two wagers never block each other; the number is blocked', T.blocked(), [r5.id]);

// A card the pile has climbed past is dead — discard fodder, never blocked.
T.set(state({ deck: 20, hand: [r4, card('red', 8)], piles: { red: [card('red', 5)] } }));
eq('dead low card + one live card: nothing blocked', T.blocked(), []);
const r8 = card('red', 8), r10 = card('red', 10);
T.set(state({ deck: 20, hand: [r4, r8, r10], piles: { red: [card('red', 5)] } }));
eq('the dead 4 is ignored; the live 10 is blocked behind the live 8', T.blocked(), [r10.id]);

// Colours are independent.
const g3 = card('green', 3), g6 = card('green', 6);
T.set(state({ deck: 20, hand: [r4, r7, g3, g6] }));
eq('each colour holds back its own', T.blocked().sort(), [r7.id, g6.id].sort());

// A wager is dead once the pile has a number: it can only be discarded.
T.set(state({ deck: 20, hand: [w1, r8], piles: { red: [card('red', 6)] } }));
eq('a wager stranded behind a number is not blocked', T.blocked(), []);

process.exit(failed ? 1 : 0);
