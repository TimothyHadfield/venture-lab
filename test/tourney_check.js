// The tournament: fixtures, and the arithmetic that turns a pile of margins
// into a standings table. Scratch only.
//
// The runner itself is requestAnimationFrame and markup and belongs to the
// browser; what is checked here is everything underneath it — which is where a
// round robin goes wrong. Double-counting a game, dropping the negation on the
// second seat, or letting a computer play itself all produce a table that looks
// entirely plausible and is wrong.
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
  let _seed = 11;
  Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
  globalThis.B = { COMPUTERS, CONFIG, RULES, seed: n => { _seed = n >>> 0; },
                   fixtures: tourneyFixtures, play: tourneyPlay, standings: tourneyStandings,
                   render: tourneyRender,
                   load: (keys, fxs, target) => Object.assign(TOURNEY,
                     { keys, fixtures: fxs, target, at: fxs.length, running: false }) };
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
const near = (name, got, want, tol) => ok(name, Math.abs(got - want) <= tol, got.toFixed(2) + ' vs ' + want.toFixed(2));

console.log('the fixture list');
{
  const f4 = B.fixtures(['a', 'b', 'c', 'd']);
  eq('every unordered pair, once', f4.length, 6);
  eq('and in a stable order', f4.map(f => f.a + f.b), ['ab', 'ac', 'ad', 'bc', 'bd', 'cd']);
  ok('nobody plays themselves', f4.every(f => f.a !== f.b));
  ok('no pairing appears twice, in either direction',
     new Set(f4.map(f => [f.a, f.b].sort().join('|'))).size === f4.length);
  eq('two computers is one fixture', B.fixtures(['a', 'b']).length, 1);
  eq('one computer is no tournament at all', B.fixtures(['a']).length, 0);
  eq('the seven built-ins make 21', B.fixtures(Object.keys(B.COMPUTERS)).length, 21);
}

console.log('');
console.log('a deal is played twice, and both results are from A\'s side');
{
  // Two computers that are not the same, on one deal. The fixture must come
  // back with TWO margins for ONE deal — the seat swap is the whole reason a
  // duel is trustworthy, and a fixture that recorded one game per deal would
  // quietly reintroduce the first-player edge.
  B.seed(5);
  const fx = B.fixtures(['broker', 'lowest'])[0];
  B.play(fx, 1);
  eq('one deal', fx.deals, 1);
  eq('two games', fx.margins.length, 2);
  ok('and some cards were played', fx.plies > 0, fx.plies + ' plies');

  // The same deal replayed by hand, to check the sign convention: the second
  // game has the seats swapped, so its raw margin is from B's side and must be
  // negated before it joins A's.
  B.seed(5);
  const deck = B.RULES.createDrawPile();
  const g1 = ctx.playDuelGame(B.COMPUTERS.broker, B.COMPUTERS.lowest, { deck });
  const g2 = ctx.playDuelGame(B.COMPUTERS.lowest, B.COMPUTERS.broker, { deck });
  eq('first game recorded as played', fx.margins[0], g1.margin);
  eq('second game NEGATED, so both read from A', fx.margins[1], -g2.margin);
}

console.log('');
console.log('the standings arithmetic');
{
  // Hand-built fixtures, so the expected table can be worked out on paper. No
  // games are played here at all — this is the fold, on its own.
  const fxs = [
    { a:'x', b:'y', margins: [ 10, 20 ], deals:1, plies:0, stalls:0, hung:0 },   // x +15 avg
    { a:'x', b:'z', margins: [ -4,  0 ], deals:1, plies:0, stalls:0, hung:0 },   // x  -2 avg
    { a:'y', b:'z', margins: [ -6, -6 ], deals:1, plies:0, stalls:0, hung:0 },   // y  -6 avg
  ];
  const keys = ['x', 'y', 'z'];
  const rows = B.standings(keys, fxs);
  const by = {}; for (const r of rows) by[r.key] = r;

  eq('one row per computer', rows.length, 3);
  eq('every game counted once for each side', rows.reduce((s, r) => s + r.games, 0), 2 * 6);
  eq('x played four games', by.x.games, 4);

  // x: +10, +20, -4, 0  ->  mean 6.5, 2 wins, 1 loss, 1 draw
  near('x averages +6.5', by.x.mean, 6.5, 1e-9);
  eq('x won 2, drew 1, lost 1', [by.x.wins, by.x.draws, by.x.losses], [2, 1, 1]);
  // y: -10, -20, -6, -6  ->  mean -10.5, 0 wins
  near('y averages -10.5', by.y.mean, -10.5, 1e-9);
  eq('y won none of four', [by.y.wins, by.y.draws, by.y.losses], [0, 0, 4]);
  // z: +4, 0, +6, +6     ->  mean 4
  near('z averages +4', by.z.mean, 4, 1e-9);
  eq('z won 3, drew 1', [by.z.wins, by.z.draws, by.z.losses], [3, 1, 0]);

  ok('a win for one side is a loss for the other, across the whole table',
     rows.reduce((s, r) => s + r.wins, 0) === rows.reduce((s, r) => s + r.losses, 0));
  ok('and draws are even', rows.reduce((s, r) => s + r.draws, 0) % 2 === 0);
  eq('the whole field\'s margins cancel to zero',
     +rows.reduce((s, r) => s + r.mean * r.games, 0).toFixed(9), 0);

  eq('ranked by average margin, best first', rows.map(r => r.key), ['x', 'z', 'y']);

  // The grid is the part that does not move when the field changes, so its
  // antisymmetry is worth asserting rather than assuming.
  near('x vs y reads +15', by.x.vs.y.mean, 15, 1e-9);
  near('and y vs x is exactly its negation', by.y.vs.x.mean, -15, 1e-9);
  ok('every cell mirrors its opposite',
     keys.every(r => keys.every(c => r === c ||
       Math.abs(by[r].vs[c].mean + by[c].vs[r].mean) < 1e-9)));
  ok('nobody has a cell against themselves', keys.every(k => by[k].vs[k] === undefined));
  eq('win rate is out of games played', +by.x.winPct.toFixed(1), 50.0);
}

console.log('');
console.log('the edges');
{
  eq('no fixtures at all is an empty table, not a crash', B.standings([], []).length, 0);
  const empty = B.standings(['x', 'y'], B.fixtures(['x', 'y']));
  eq('a fixture with no games played yet', empty.map(r => r.games), [0, 0]);
  eq('  …and no margin invented for it', empty.map(r => r.mean), [0, 0]);
  eq('  …and no win rate either', empty.map(r => r.winPct), [0, 0]);

  // The builder can delete a computer while a run is in flight, which leaves
  // fixtures naming a key that is no longer in the field.
  const orphan = B.standings(['x'], [{ a:'x', b:'gone', margins:[5, 5], deals:1, plies:0, stalls:0, hung:0 }]);
  eq('a fixture naming a computer that has gone is skipped', orphan[0].games, 0);
}

console.log('');
console.log('a real tournament of the built-ins holds together');
{
  // Small — this is a consistency check on the machinery, not a measurement.
  // The one thing asserted about STRENGTH is the finding the duel already
  // established at length, and it is asserted loosely.
  B.seed(31);
  const keys = ['broker', 'patient', 'wageropen', 'lowest', 'random'];
  const fxs = B.fixtures(keys);
  for (const fx of fxs) B.play(fx, 6);
  const rows = B.standings(keys, fxs);

  eq('every pairing played', fxs.filter(f => f.deals === 6).length, 10);
  eq('every computer met every other', rows.map(r => Object.keys(r.vs).length), [4, 4, 4, 4, 4]);
  eq('and played the same number of games', new Set(rows.map(r => r.games)).size, 1);
  ok('wins and losses still balance',
     rows.reduce((s, r) => s + r.wins, 0) === rows.reduce((s, r) => s + r.losses, 0));
  eq('margins still cancel across the field',
     +rows.reduce((s, r) => s + r.mean * r.games, 0).toFixed(6), 0);
  ok('Random finishes last', rows[rows.length - 1].key === 'random', rows.map(r => r.name).join(' > '));
  ok('The Broker finishes above Random by a distance',
     rows.find(r => r.key === 'broker').mean - rows.find(r => r.key === 'random').mean > 20,
     (rows.find(r => r.key === 'broker').mean - rows.find(r => r.key === 'random').mean).toFixed(1));
}

console.log('');
console.log('the page it draws');
{
  // tourneyRender is one long string builder, and a typo in it shows up only
  // when someone opens the page. A stub DOM is enough to run it for real and
  // read what came out — not a substitute for looking at it, but it means a
  // broken template cannot reach the site.
  const el = () => ({ innerHTML: '', textContent: '', style: {} });
  const nodes = { 'lab-tny-body': el(), 'lab-tny-count': el(), 'lab-tny-prog': el() };
  ctx.document.getElementById = id => nodes[id] || null;

  B.seed(77);
  const keys = ['broker', 'patient', 'random'];
  const fxs = B.fixtures(keys);
  for (const fx of fxs) B.play(fx, 4);
  B.load(keys, fxs, 4);
  let threw = null;
  try { B.render(); } catch (e){ threw = e.message; }
  const out = nodes['lab-tny-body'].innerHTML;

  eq('it renders without throwing', threw, null);
  ok('a standings table', /<table class="st">/.test(out));
  ok('and a head-to-head grid', /<table class="mx">/.test(out));
  ok('every computer is named in it',
     keys.every(k => out.indexOf(B.COMPUTERS[k].name) >= 0));
  const cells = (out.match(/<td class="(win|loss|near|self)"/g) || []).length;
  eq('the grid is square — 3 computers, 9 cells', cells, 9);
  eq('three of them the diagonal', (out.match(/class="self"/g) || []).length, 3);
  ok('the progress bar reflects a finished run', nodes['lab-tny-prog'].style.width === '100.0%',
     nodes['lab-tny-prog'].style.width);
  ok('the count says how much was played', /12 of 12 deals · 3 pairings/.test(nodes['lab-tny-count'].textContent),
     nodes['lab-tny-count'].textContent);
  ok('and it says out loud that the ranking depends on the field',
     /relative to the field/.test(out));

  // A name with markup in it must not become markup — the builder lets the
  // user name a computer whatever they like, and that name reaches this page.
  B.COMPUTERS['__x'] = { name: '<img src=x onerror=alert(1)>', decide: B.COMPUTERS.random.decide };
  const fx2 = B.fixtures(['random', '__x']);
  B.play(fx2[0], 2);
  B.load(['random', '__x'], fx2, 2);
  B.render();
  const out2 = nodes['lab-tny-body'].innerHTML;
  ok('a computer named with markup is escaped, not rendered', out2.indexOf('<img') < 0);
  ok('  …and still shows its name', out2.indexOf('&lt;img') >= 0);
  delete B.COMPUTERS['__x'];

  // Nothing played yet is the state the page opens in.
  B.load(['a', 'b'], B.fixtures(['a', 'b']), 50);
  B.render();
  ok('before any games it says so instead of drawing an empty table',
     /No games yet/.test(nodes['lab-tny-body'].innerHTML));
}

console.log('');
console.log(failed ? failed + ' FAILED' : 'all passed');
process.exit(failed ? 1 : 0);
