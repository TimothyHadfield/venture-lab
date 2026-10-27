// MEASUREMENT (not pass/fail): Elo ratings for every Play-mode opponent, for
// My stats (profile.js rates your games against these numbers).
//
//     node test/rate_levels.js [deals]      default 100 deals a pairing
//
// Every opponent plays every other on the SAME deals with the seats swapped,
// through the real board code in lab.js (built-in levels via _labAIChoosePlay /
// _labAIChooseDraw, computers via _labCpuChooseTurn) in PLAY mode, so each side
// sees only what a player sees. Ratings are fitted to the win counts (draws =
// half) by Bradley-Terry, anchored so Solid (the default opponent) = 1200.
// Prints a ratings.js body to paste.
const fs = require('fs'), path = require('path'), vm = require('vm');
const LABDIR = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(LABDIR, p), 'utf8');
const ctx = { console, localStorage: { getItem: () => null, setItem: () => {} },
              document: { readyState: 'loading', addEventListener: () => {}, getElementById: () => null } };
vm.createContext(ctx);
for (const f of ['config.js', 'events.js', 'math.js', 'rules.js', 'constants.js', 'engine.js']) {
  let s = read('vendor/src/' + f).replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  if (f === 'constants.js')
    s = s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0] + '\n' + s.match(/function useSinglePile\(\)\{.*\}/)[0];
  vm.runInContext(s, ctx);
}
vm.runInContext('var variant = "classic";', ctx);
const L = read('lab.js').split(/\r?\n/);
const cut = (from, to) => { const a = L.findIndex(l => l.includes(from)), b = L.findIndex(l => l.includes(to)); return L.slice(a, b).join('\n'); };
vm.runInContext(cut('const LAB = {', 'stubs the stack expects'), ctx);
vm.runInContext(cut('function venturePotential(pile, pool', 'function labColorPotential'), ctx);
vm.runInContext(read('computers.js'), ctx);
vm.runInContext(cut('function _labPileScore(pile)', 'POTENTIAL — the analysis feature').replace(/\/\* =+\s*$/, ''), ctx);
vm.runInContext(cut('const LAB_LEVELS = [', 'function labSyncOpponentList'), ctx);
vm.runInContext(`
  let _seed = 1; Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
  var gameState = null, userSlot = 'player1';
  function _labFlash(){}
  globalThis.B = { ENGINE, MATH, CONFIG, LAB, opts: labOpponentOptions,
    seed: n => { _seed = n >>> 0; },
    play(keyA, keyB, dealSeed){
      _seed = dealSeed >>> 0;
      const gs = ENGINE.initGame('classic', false);
      gs.currentTurn = 'player1';
      gameState = gs;
      const keys = { player1: keyA, player2: keyB };
      let plies = 0;
      while (gs.status !== 'finished' && plies < 400){
        plies++;
        const slot = gs.currentTurn;
        LAB.ai = keys[slot];
        const cpu = _labCpuChooseTurn(slot);
        const mv = cpu || _labAIChoosePlay(slot);
        if (mv.kind === 'play') ENGINE.playCard(gs, slot, mv.card, mv.color); else ENGINE.discardCard(gs, slot, mv.card, mv.color);
        const d = cpu ? (cpu.draw ? { source: 'discard', color: cpu.draw } : { source: 'deck' }) : _labAIChooseDraw(slot);
        if (d.source === 'deck' || !ENGINE.drawFromDiscard(gs, slot, d.color).success) ENGINE.drawFromDeck(gs, slot);
      }
      const sc = s => CONFIG.colors.reduce((t, c) => t + MATH.scorePlayPile(gs.playPiles[s][c] || []), 0);
      return sc('player1') - sc('player2');
    } };
`, ctx);
const B = ctx.B;
B.LAB.mode = 'play';
const DEALS = Math.max(1, parseInt(process.argv[2], 10) || 100);
const keys = B.opts().map(o => o.value), names = Object.fromEntries(B.opts().map(o => [o.value, o.label]));
const W = {};                 // W[a][b] = points (win 1, draw .5) a took from b
for (const a of keys){ W[a] = {}; for (const b of keys) W[a][b] = 0; }
const t0 = Date.now();
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++){
  const a = keys[i], b = keys[j];
  for (let d = 0; d < DEALS; d++){
    const seed = 1000 + d * 7919;
    for (const [p1, p2] of [[a, b], [b, a]]){
      const m = B.play(p1, p2, seed);
      const s = m > 0 ? 1 : m < 0 ? 0 : 0.5;
      W[p1][p2] += s; W[p2][p1] += 1 - s;
    }
  }
}
// Bradley-Terry (MM algorithm), then Elo = 400 log10(strength).
let g = Object.fromEntries(keys.map(k => [k, 1]));
for (let it = 0; it < 2000; it++){
  const ng = {};
  for (const a of keys){
    let wins = 0, den = 0;
    for (const b of keys) if (a !== b){ wins += W[a][b]; den += (2 * DEALS) / (g[a] + g[b]); }
    ng[a] = Math.max(1e-6, wins) / den;
  }
  g = ng;
}
const elo = Object.fromEntries(keys.map(k => [k, 400 * Math.log10(g[k])]));
const shift = 1200 - elo.solid;
const rows = keys.map(k => ({ id: k, name: names[k], rating: Math.round(elo[k] + shift),
  pct: keys.filter(b => b !== k).reduce((t, b) => t + W[k][b], 0) / ((keys.length - 1) * 2 * DEALS) * 100 }))
  .sort((x, y) => y.rating - x.rating);
console.log(keys.length + ' opponents, ' + DEALS + ' deals a pairing, seats swapped: '
  + (keys.length * (keys.length - 1) * DEALS) + ' games in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s\n');
for (const r of rows) console.log(r.name.padEnd(14) + String(r.rating).padStart(6) + '   ' + r.pct.toFixed(1) + '% of all games');
console.log('\nconst PLAY_RATINGS = [');
for (const r of rows) console.log("  { id: '" + r.id + "', name: '" + r.name + "', rating: " + r.rating + ' },');
console.log('];');
