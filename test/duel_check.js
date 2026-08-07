// The duel harness and The Broker. Every pairing plays each deal twice with the
// seats swapped, so no result can be first-player advantage. Scratch only.
const fs = require('fs'), path = require('path'), vm = require('vm');
const LABDIR = require('path').join(__dirname, '..');
const read = p => fs.readFileSync(path.join(LABDIR, p), 'utf8');
const ctx = { console, localStorage: { getItem: () => null, setItem: () => {} },
              document: { readyState: 'loading', addEventListener: () => {}, getElementById: () => null } };
vm.createContext(ctx);
for (const f of ['config.js', 'math.js', 'rules.js', 'constants.js']) {
  let s = read('vendor/src/' + f).replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  if (f === 'constants.js') s = s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0];
  vm.runInContext(s, ctx);
}
const L = read('lab.js').split(/\r?\n/);
vm.runInContext(L.slice(L.findIndex(l => l.includes('function venturePotential(pile, pool')),
                        L.findIndex(l => l.includes('function labColorPotential'))).join('\n'), ctx);
vm.runInContext(read('computers.js'), ctx);
vm.runInContext(`
  let _seed = 1;
  Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
  globalThis.B = { duel: playDuelGame, solo: playSoloGame, COMPUTERS, CONFIG, RULES,
                   seed: n => { _seed = n >>> 0; },
                   plan: venturePlan, pot: venturePotential,
                   project: duelProject, schedule: duelSchedule, avail: duelAvailable,
                   view: duelView };
`, ctx);
const B = ctx.B;

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '  = ' + JSON.stringify(got)
    : '\n         got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want)));
};
const ok = (name, cond, extra) => eq(name + (extra !== undefined ? '  [' + extra + ']' : ''), !!cond, true);

console.log('venturePlan — the rule now reports what it spends');
{
  const card = v => ({ id: 'r' + v, color: 'red', value: v });
  const pool = [card(0), card(0), card(0)];
  for (let v = 2; v <= 10; v++) pool.push(card(v));
  eq('score still matches venturePotential', B.plan([], pool, 6).score, B.pot([], pool, 6));
  eq('and it says how many plays that took', B.plan([], pool, 6).used, 6);
  eq('an unused budget spends nothing', B.plan([], [card(3)], 5).used, 0);   // opening a lone 3 is worse than not
  eq('uncapped reports every addition', B.plan([], pool).used, pool.length);
}

console.log('\nthe schedule — who gets which deck card');
{
  const c = (n) => ({ id: 'c' + n, color: 'red', value: n });
  const deck = [c(1), c(2), c(3), c(4), c(5)];        // last = next drawn
  const s = B.schedule({ deck });
  eq('the player to move takes the top card', s.mine.map(x => x.id), ['c5', 'c3', 'c1']);
  eq('and the other player gets the alternates', s.theirs.map(x => x.id), ['c4', 'c2']);
}

console.log('\nthe duel harness');
{
  B.seed(7);
  const r = B.duel(B.COMPUTERS.lowest, B.COMPUTERS.wageropen);
  ok('a duel between two solitaire computers runs', isFinite(r.p1) && isFinite(r.p2), r.p1 + ' vs ' + r.p2);
  ok('...and empties the deck rather than hitting the cap', !r.hung, r.plies + ' plies');
  ok('...with both sides scoring like a real game', Math.abs(r.p1) < 400 && Math.abs(r.p2) < 400);

  B.seed(7);
  const again = B.duel(B.COMPUTERS.lowest, B.COMPUTERS.wageropen);
  eq('the same seed replays the same game', [again.p1, again.p2], [r.p1, r.p2]);
}
{
  // A computer that names a discard pile really draws from it, and the deck
  // does not shrink when it does.
  const stall = { decide(view){
    const top = CONFIG => null;
    let col = null;
    for (const c of B.CONFIG.colors) if (view.discards[c].length && c !== view.lastDiscard) { col = c; break; }
    return { action: 'discard', card: view.hand[0], draw: col || 'deck' };
  } };
  B.seed(11);
  const r = B.duel(stall, B.COMPUTERS.lowest);
  ok('discard draws are honoured and stretch the game', r.stalls > 0, r.stalls + ' stalled draws');
  ok('...and the ply cap stops a livelock rather than hanging', r.plies <= 400);
}

console.log('\nThe Broker prices the other side of the table');
{
  // A hand-built position: their red is open with two wagers, so a red 9 is
  // worth 27 to them. My own red is dead (I have played the 10). The 9 is
  // therefore pure gift — The Broker must not throw it.
  const card = (color, v, tag) => ({ id: color + v + (tag || ''), color, v: 0, value: v });
  const hands = { player1: [card('red', 9), card('blue', 2)], player2: [card('green', 4)] };
  const piles = { player1: {}, player2: {} };
  for (const c of B.CONFIG.colors){ piles.player1[c] = []; piles.player2[c] = []; }
  piles.player1.red = [card('red', 10, 'mine')];
  piles.player2.red = [card('red', 0, 'w1'), card('red', 0, 'w2')];
  const discards = {}; for (const c of B.CONFIG.colors) discards[c] = [];
  const deck = [card('blue', 7), card('blue', 8), card('green', 9), card('green', 10)];
  const view = B.view('player1', hands, piles, discards, deck, null, Math.random);
  const mv = B.COMPUTERS.broker.decide(view);
  ok('it refuses to hand over the card their wagered venture wants',
     !(mv.action === 'discard' && mv.card.color === 'red'),
     mv.action + ' ' + mv.card.color + mv.card.value);

  // Same position, but their red pile has climbed past the 9 — now it is dead
  // to them, so it is the safe throw and the blue 2 (still useful to me) is not.
  piles.player2.red = [card('red', 0, 'w1'), card('red', 0, 'w2'), card('red', 10, 'theirs')];
  const mv2 = B.COMPUTERS.broker.decide(B.view('player1', hands, piles, discards, deck, null, Math.random));
  ok('once the card is dead to them, it becomes the throw',
     mv2.action === 'discard' && mv2.card.color === 'red',
     mv2.action + ' ' + mv2.card.color + mv2.card.value);
}

console.log('\nhead to head — paired deals, seats swapped');
function series(a, b, deals){
  const margins = [];
  for (let d = 0; d < deals; d++){
    B.seed(3000 + d);
    const deck = B.RULES.createDrawPile();
    const g1 = B.duel(B.COMPUTERS[a], B.COMPUTERS[b], { deck });
    const g2 = B.duel(B.COMPUTERS[b], B.COMPUTERS[a], { deck });
    margins.push(g1.margin);        // a as player1
    margins.push(-g2.margin);       // a as player2 on the same deal
  }
  const mean = margins.reduce((s, v) => s + v, 0) / margins.length;
  const sd = Math.sqrt(margins.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (margins.length - 1));
  const wins = margins.filter(v => v > 0).length, ties = margins.filter(v => v === 0).length;
  return { mean, ci: 1.96 * sd / Math.sqrt(margins.length),
           win: 100 * wins / margins.length, tie: 100 * ties / margins.length, n: margins.length };
}
const DEALS = 60;
for (const [a, b] of [['broker', 'patient'], ['broker', 'wageropen'], ['patient', 'wageropen'],
                      ['broker', 'lowest'], ['wageropen', 'random']]){
  const r = series(a, b, DEALS);
  console.log('  ' + (B.COMPUTERS[a].name + ' vs ' + B.COMPUTERS[b].name).padEnd(34)
    + (r.mean >= 0 ? '+' : '') + r.mean.toFixed(1) + ' ± ' + r.ci.toFixed(1)
    + '   wins ' + r.win.toFixed(0) + '%, ties ' + r.tie.toFixed(0) + '%  (' + r.n + ' games)');
}

console.log('\nsolitaire is unaffected');
{
  B.seed(99); const a = B.solo(B.COMPUTERS.patient).score;
  B.seed(99); const b = B.solo(B.COMPUTERS.patient).score;
  eq('the solitaire runner still works and is deterministic per seed', a, b);
  B.seed(99);
  ok('The Broker also plays a legal solitaire game', isFinite(B.solo(B.COMPUTERS.broker).score));
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
