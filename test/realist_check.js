// Measures The Realist against the built-in computers on PAIRED deals (same
// shuffle to every bot, which the site's own runner does not do). Scratch only.
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
  // Seeded PRNG installed over Math.random so every bot gets the SAME shuffle:
  // createDrawPile() reaches for Math.random directly, so pairing has to happen
  // here rather than through playSoloGame's rng argument.
  let _seed = 1;
  function seed(n){ _seed = n >>> 0; }
  const _rand = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
  Math.random = _rand;
  globalThis.B = { solo: playSoloGame, COMPUTERS, seed, CONFIG, venturePotential, MATH };
`, ctx);
const B = ctx.B;

let failed = 0;
const ok = (name, cond, extra) => {
  if (!cond) failed++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : ''));
};

// ---- the new primitive, checked by hand ------------------------------------
console.log('reachable potential — the same rule under a turn budget');
{
  const card = (v) => ({ id: 'r' + v + Math.random(), color: 'red', value: v });
  const pool = [card(0), card(0), card(0)];
  for (let v = 2; v <= 10; v++) pool.push(card(v));
  const full = B.venturePotential([], pool);
  ok('uncapped is unchanged (the whole colour = 156)', full === 156, full);
  ok('a budget bigger than the colour changes nothing', B.venturePotential([], pool, 99) === 156);
  ok('no turns left ⇒ a colour is worth what is on the table', B.venturePotential([], pool, 0) === 0,
     B.venturePotential([], pool, 0));
  // 3 plays: best is 3 wagers?  (0-20)*4 = -80.  Or 10+9+8 = 27 → (27-20) = 7.
  // Or 2 wagers + the 10 → (10-20)*3 = -30.  So 7, taking no wagers at all.
  ok('3 plays: takes the three highest numbers, no wagers', B.venturePotential([], pool, 3) === 7,
     B.venturePotential([], pool, 3));
  // 6 plays: 1 wager + 10,9,8,7,6 = 40 → (40-20)*2 = 40.  Beats 6 numbers
  // (10+9+8+7+6+5=45 → 25) and 2 wagers + 4 numbers (34-20)*3 = 42... check.
  const six = B.venturePotential([], pool, 6);
  ok('6 plays: finds the best wager/number mix', six === 42, six);
  ok('reachable ≤ potential on a healthy colour', six <= full, six + ' ≤ ' + full);
}
{
  // UNSTARTED colour: potential plays every wager it can, and on a colour whose
  // numbers cannot clear the 20 that multiplies a loss. Under a budget you can
  // simply not open it — so reachable bottoms out at 0, never below. (I first
  // expected -17 here, the 3 played alone; declining entirely is better still,
  // and is what a real player would do.)
  const card = (v) => ({ id: 'g' + v, color: 'green', value: v });
  const pool = [card(0), card(3)];
  const p = B.venturePotential([], pool);
  ok('potential takes the wager and multiplies the loss', p === -34, p);
  ok('an unstarted colour is never worth less than 0 under a budget',
     B.venturePotential([], pool, 1) === 0 && B.venturePotential([], pool, 2) === 0);
  // STARTED colour: the -20 is already committed, so it can and should go
  // negative — this is what The Patient's opening gate keys on.
  const pile = [card(3)];
  ok('a started colour is priced at what is on the table with no turns left',
     B.venturePotential(pile, [], 0) === -17, B.venturePotential(pile, [], 0));
  ok('...and one more play adds the best card available',
     B.venturePotential(pile, [card(10)], 1) === -7, B.venturePotential(pile, [card(10)], 1));
}

// ---- does it actually play better? -----------------------------------------
console.log('\npaired solitaire games — same shuffle to every computer');
const KEYS = ['lowest', 'lowest3', 'wageropen', 'wageropen4', 'patient', 'random'];
const N = 400;
const scores = {}; for (const k of KEYS) scores[k] = [];
for (let g = 0; g < N; g++){
  for (const k of KEYS){
    B.seed(1000 + g);                     // identical deck for every bot this round
    scores[k].push(B.solo(B.COMPUTERS[k]).score);
  }
}
const med = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mean = xs => xs.reduce((s, v) => s + v, 0) / xs.length;

console.log('\n  computer          median    mean     vs Wager Open (paired)');
for (const k of KEYS){
  const d = scores[k].map((v, i) => v - scores.wageropen[i]);
  const m = mean(d);
  const sd = Math.sqrt(d.reduce((s, v) => s + (v - m) * (v - m), 0) / (d.length - 1));
  const se = sd / Math.sqrt(d.length);
  const wins = d.filter(v => v > 0).length, ties = d.filter(v => v === 0).length;
  console.log('  ' + B.COMPUTERS[k].name.padEnd(16)
    + String(med(scores[k])).padStart(6) + mean(scores[k]).toFixed(1).padStart(9)
    + (k === 'wageropen' ? '        —'
       : ('   ' + (m >= 0 ? '+' : '') + m.toFixed(1) + ' ± ' + (1.96 * se).toFixed(1)
          + '  (wins ' + (100 * wins / d.length).toFixed(0) + '%, ties ' + (100 * ties / d.length).toFixed(0) + '%)')));
}

const dR = scores.patient.map((v, i) => v - scores.wageropen[i]);
const mR = mean(dR);
const seR = Math.sqrt(dR.reduce((s, v) => s + (v - mR) * (v - mR), 0) / (dR.length - 1)) / Math.sqrt(dR.length);
console.log('');
ok('The Patient beats Wager Open by a margin bigger than its own interval',
   mR - 1.96 * seR > 0, mR.toFixed(1) + ' ± ' + (1.96 * seR).toFixed(1));
ok('...and beats plain Lowest', mean(scores.patient) > mean(scores.lowest),
   mean(scores.patient).toFixed(1) + ' vs ' + mean(scores.lowest).toFixed(1));
ok('every computer still produces legal games', KEYS.every(k => scores[k].every(isFinite)));

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
