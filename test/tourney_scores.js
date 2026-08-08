// The round robin, headless — the source of the standings table in README and
// PROGRESS. A MEASUREMENT script, not a pass/fail check: it prints and exits.
//
//     node test/tourney_scores.js [deals]      default 200
//
// 200 deals over the seven built-ins is 8,400 games and takes about a minute.
// Uses the real tourneyFixtures / tourneyPlay / tourneyStandings out of
// computers.js, so this and the page in the browser cannot disagree.
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
  let _seed = 1; Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
  globalThis.B = { COMPUTERS, RULES, seed: n => { _seed = n >>> 0; },
                   fixtures: tourneyFixtures, play: tourneyPlay, standings: tourneyStandings };
`, ctx);
const B = ctx.B;

const DEALS = Math.max(1, parseInt(process.argv[2], 10) || 200);
const keys = Object.keys(B.COMPUTERS);
B.seed(4242);

const t = Date.now();
const fxs = B.fixtures(keys);
for (const fx of fxs) B.play(fx, DEALS);
const secs = (Date.now() - t) / 1000;
const rows = B.standings(keys, fxs);

console.log(keys.length + ' computers · ' + fxs.length + ' pairings · ' + DEALS + ' deals each = '
  + fxs.length * DEALS * 2 + ' games in ' + secs.toFixed(1) + 's');
console.log('Each deal played twice with the seats swapped, so none of this is first-player edge.\n');

console.log('#  ' + 'computer'.padEnd(15) + 'W-D-L'.padEnd(17) + 'win%'.padEnd(8) + 'margin a game');
rows.forEach((r, i) => console.log(
  String(i + 1).padEnd(3) + r.name.padEnd(15)
  + (r.wins + '-' + r.draws + '-' + r.losses).padEnd(17)
  + (r.winPct.toFixed(1) + '%').padEnd(8)
  + (r.mean >= 0 ? '+' : '') + r.mean.toFixed(1) + ' ± ' + r.ci.toFixed(1)));

console.log('\nHead to head — the row\'s margin per game against the column.');
console.log('(brackets) = the interval still spans zero, so that pairing is NOT separated.\n');
console.log(''.padEnd(15) + rows.map(c => c.name.slice(0, 8).padStart(9)).join(''));
for (const r of rows){
  console.log(r.name.slice(0, 14).padEnd(15) + rows.map(c => {
    if (c.key === r.key) return '        —';
    const v = r.vs[c.key];
    const s = (v.mean > 0 ? '+' : '') + v.mean.toFixed(0);
    return (Math.abs(v.mean) <= v.ci ? '(' + s + ')' : s).padStart(9);
  }).join(''));
}

const undecided = rows.flatMap(r => Object.keys(r.vs)
  .filter(k => Math.abs(r.vs[k].mean) <= r.vs[k].ci)
  .map(k => [r.key, k].sort().join(' vs ')));
const uniq = Array.from(new Set(undecided));
console.log('\nUndecided pairings: ' + uniq.length + ' of ' + fxs.length
  + (uniq.length ? ' — ' + uniq.join(', ') : ''));
const hung = fxs.reduce((s, f) => s + f.hung, 0);
if (hung) console.log(hung + ' game(s) hit the 400-ply cap.');
console.log('\n⚠️  An average margin is relative to the FIELD — change who is in it and every');
console.log('   average moves. The head-to-head grid is the part that does not.');
