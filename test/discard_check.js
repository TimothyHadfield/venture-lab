// The discard rule is about TIMING, so this drives a turn sequence rather than
// inspecting a frozen position. Scratch only.
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
  if (a < 0 || b < 0) throw new Error('slice not found: ' + from);
  return L.slice(a, b).join('\n');
};
const src = cut('function venturePotential(pile, pool', '/* --- render the potential row')
          + '\n' + cut('function labProjectedTurns(slot)', '   THE INFO PANEL', 1);

vm.runInContext(`
  let gameState = null, userSlot = 'player1';
  function renderGame(){}
  ${src}
  globalThis.T = {
    tick: _labRefreshTurnSnapshot,          // what the render wrapper calls
    reset: _labResetTurnSnapshot,
    pot: labColorPotential,
    pool: (slot, c) => _labPoolOf(slot, c).map(x => x.id),
    set: gs => { gameState = gs; },
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
const card = (color, value, tag) => ({ id: color + value + (tag || ''), color, value });
const empty = () => { const o = {}; for (const c of T.colors) o[c] = []; return o; };

// A position where red's potential is entirely about which reds are available.
function fresh(){
  const gs = {
    drawPile: [card('red', 9)],
    hands: { player1: [card('red', 4)], player2: [card('red', 5)] },
    playPiles: { player1: empty(), player2: empty() },
    discards: empty(),
    currentTurn: 'player1', phase: 'play',
  };
  T.reset(); T.set(gs); T.tick();            // start of player1's turn
  return gs;
}

console.log('a card you discard stops counting for you at once');
{
  const gs = fresh();
  const before = T.pot('player1', 'red');
  const r7 = card('red', 7);
  gs.discards.red.push(r7);                  // player1 discards during their own turn
  T.tick();                                  // a render inside the turn must not refresh
  eq('the freshly discarded card is not in my pool', T.pool('player1', 'red').indexOf('red7') < 0, true);
  eq('...so my potential is unchanged by throwing it', T.pot('player1', 'red'), before);
  eq('...and it is not in theirs either, this turn', T.pool('player2', 'red').indexOf('red7') < 0, true);
}

console.log('\nand starts counting again on your next turn, if it survives');
{
  const gs = fresh();
  const r7 = card('red', 7);
  gs.discards.red.push(r7);
  T.tick();
  const during = T.pot('player1', 'red');

  gs.currentTurn = 'player2'; T.tick();      // opponent's turn begins
  eq('it is takeable by the OPPONENT on their turn', T.pool('player2', 'red').indexOf('red7') >= 0, true);
  eq('...and still not by me, mid-opponent-turn', T.pool('player1', 'red').indexOf('red7') < 0, true);

  gs.currentTurn = 'player1'; T.tick();      // my next turn begins, card still there
  eq('back in my pool at the start of my next turn', T.pool('player1', 'red').indexOf('red7') >= 0, true);
  eq('...and my potential rises accordingly', T.pot('player1', 'red') > during, true);
}

console.log('\nonly the TOP card, never what is buried');
{
  const gs = fresh();
  gs.discards.red.push(card('red', 3), card('red', 7));   // 3 buried under 7
  gs.currentTurn = 'player2'; T.tick();
  gs.currentTurn = 'player1'; T.tick();
  const pool = T.pool('player1', 'red');
  eq('the top card counts', pool.indexOf('red7') >= 0, true);
  eq('the buried one does not', pool.indexOf('red3') < 0, true);
}

console.log('\nthe opponent burying your card takes it away again');
{
  const gs = fresh();
  const mine = card('red', 7);
  gs.discards.red.push(mine);
  gs.currentTurn = 'player2'; T.tick();
  gs.currentTurn = 'player1'; T.tick();
  eq('mine is takeable at the start of my turn', T.pool('player1', 'red').indexOf('red7') >= 0, true);

  // Their turn: they drop a card on top of it.
  gs.currentTurn = 'player2'; T.tick();
  gs.discards.red.push(card('red', 8));
  gs.currentTurn = 'player1'; T.tick();      // my turn starts with the NEW card on top
  const pool = T.pool('player1', 'red');
  eq('the new top is takeable', pool.indexOf('red8') >= 0, true);
  eq('...and mine, now buried, is not', pool.indexOf('red7') < 0, true);
}

console.log('\nthe opponent TAKING your card removes it entirely');
{
  const gs = fresh();
  gs.discards.red.push(card('red', 7));
  gs.currentTurn = 'player2'; T.tick();
  gs.discards.red.pop();                      // they draw it
  gs.hands.player2.push(card('red', 7));
  gs.currentTurn = 'player1'; T.tick();
  eq('it is gone from my pool', T.pool('player1', 'red').indexOf('red7') < 0, true);
  eq('...because it is in their hand, which never counts for me',
     T.pool('player1', 'red').indexOf('red5') < 0, true);
}

console.log('\nhousekeeping');
{
  const gs = fresh();
  gs.discards.red.push(card('red', 7));
  gs.currentTurn = 'player2'; T.tick();
  gs.currentTurn = 'player1'; T.tick();
  eq('takeable before a new game', T.pool('player1', 'red').indexOf('red7') >= 0, true);
  T.reset();                                  // newLabGame does this
  eq('a reset clears the snapshot, so nothing is takeable until a turn starts',
     T.pool('player1', 'red').indexOf('red7') < 0, true);
  T.tick();
  eq('...and the first tick of the new turn restores it',
     T.pool('player1', 'red').indexOf('red7') >= 0, true);
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
