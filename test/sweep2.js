// Finer sweep around the winner, plus diagnostics: is the gain real, and is the
// reachable pricing doing any of the work or is it all the hold rule?
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
  const T = view => Math.max(1, turnsLeft(view.hand, view.pool));

  // cost model: 'reach' = turn-budgeted, 'plain' = the existing playCost/discardCost
  function mk(hTheta, oTheta, model){
    const pc = (view, c, t) => model === 'plain' ? playCost(view.piles, view.pool, c)
                                                 : reachableCost(view.piles, view.pool, c, t, 'play');
    const dc = (view, c, t) => model === 'plain' ? discardCost(view.piles, view.pool, c)
                                                 : reachableCost(view.piles, view.pool, c, t, 'discard');
    return function(view){
      const t = T(view);
      const allowed = view.playable.filter(c => {
        if (view.piles[c.color].length > 0) return true;
        if (c.value === 0) return true;
        if (oTheta === null) return false;               // wager-only openings
        const piles2 = {}; piles2[c.color] = [c];
        const pool2  = {}; pool2[c.color]  = view.pool[c.color].filter(x => x !== c);
        return reachableFor(piles2, pool2, c.color, t - 1) >= oTheta;
      });
      const d = _pickCheapest(view.hand, c => dc(view, c, t));
      const dCost = d ? dc(view, d, t) : Infinity;
      if (allowed.length){
        const p = _pickCheapest(allowed, c => pc(view, c, t));
        if (!(hTheta !== null && pc(view, p, t) > hTheta && dCost <= 0)) return { action:'play', card:p };
      }
      return { action:'discard', card:d };
    };
  }
  globalThis.B = { solo: playSoloGame, COMPUTERS, seed: n => { _seed = n >>> 0; }, mk, CONFIG };
`, ctx);
const B = ctx.B;

const N = 1000;
function run(decide){
  const s = [], extra = { discards: 0, turns: 0, bonusGames: 0, bonusPiles: 0, opened: 0 };
  for (let g = 0; g < N; g++){
    B.seed(500 + g);
    const r = B.solo({ decide });
    s.push(r.score);
    extra.discards += r.discarded; extra.turns += r.played + r.discarded;
    let bp = 0, op = 0;
    for (const c of B.CONFIG.colors){
      if (r.piles[c].length >= B.CONFIG.scoring.bonusThreshold) bp++;
      if (r.piles[c].length) op++;
    }
    if (bp) extra.bonusGames++;
    extra.bonusPiles += bp; extra.opened += op;
  }
  return { s, extra };
}
const med = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mean = xs => xs.reduce((a, v) => a + v, 0) / xs.length;

const ref = run(B.COMPUTERS.wageropen.decide);
const rows = [['wager open (ref)', B.COMPUTERS.wageropen.decide]];
for (const h of [0, 10, 20, 25, 30, 40]) rows.push(['hold ' + h + ' / wager-only', B.mk(h, null, 'reach')]);
for (const o of [0, 10, 20, 30]) rows.push(['hold 25 / open ' + o, B.mk(25, o, 'reach')]);
rows.push(['hold 25 / open 20, PLAIN cost', B.mk(25, 20, 'plain')]);
rows.push(['hold 30 / open 20, PLAIN cost', B.mk(30, 20, 'plain')]);

console.log('paired over ' + N + ' identical shuffles\n');
console.log('  candidate                        median    mean   disc%  8+bonus  colours   vs ref');
for (const [name, fn] of rows){
  const { s, extra } = run(fn);
  const d = s.map((v, i) => v - ref.s[i]);
  const m = mean(d);
  const sd = Math.sqrt(d.reduce((a, v) => a + (v - m) * (v - m), 0) / (d.length - 1));
  const ci = 1.96 * sd / Math.sqrt(d.length);
  console.log('  ' + name.padEnd(32) + String(med(s)).padStart(5) + mean(s).toFixed(1).padStart(9)
    + (100 * extra.discards / extra.turns).toFixed(0).padStart(7)
    + (100 * extra.bonusGames / N).toFixed(0).padStart(8) + '%'
    + (extra.opened / N).toFixed(1).padStart(8)
    + '   ' + (m >= 0 ? '+' : '') + m.toFixed(1) + ' ± ' + ci.toFixed(1));
}
