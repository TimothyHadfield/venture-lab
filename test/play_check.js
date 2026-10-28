// PLAY extras (2026-10-28): the per-colour score lines in the round result,
// the saved match that survives a reload, and the "sixth expedition" option
// (six colours, 72 cards) that every Play-mode opponent must be able to play.
//
// Slices by signature from play.js (playColourRows, playSaveValid) and runs
// every listed opponent through whole six-colour games on the real board code
// (lab.js, Play mode = fair view), the way test/rate_levels.js does.
// PLAY_JS=<path> points at another copy of play.js (to watch it fail on the old one).
const fs = require('fs'), path = require('path'), vm = require('vm');
const LABDIR = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(LABDIR, p), 'utf8');
const ctx = { console, localStorage: { getItem: () => null, setItem: () => {} },
              document: { readyState: 'loading', addEventListener: () => {}, getElementById: () => null,
                          documentElement: { style: { setProperty: () => {} } } } };
vm.createContext(ctx);
for (const f of ['config.js', 'events.js', 'math.js', 'rules.js', 'constants.js', 'engine.js']) {
  let s = read('vendor/src/' + f).replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  if (f === 'constants.js')
    s = s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0] + '\n'
      + s.match(/function useSinglePile\(\)\{.*\}/)[0] + '\n'
      + s.match(/function setVentureCount\(n\)\{[\s\S]*?\n\}/)[0];
  vm.runInContext(s, ctx);
}
vm.runInContext('var variant = "classic";', ctx);
const cutFrom = (src, from, to) => {
  const L = src.split(/\r?\n/);
  const a = L.findIndex(l => l.includes(from)), b = L.findIndex((l, i) => i > a && l.includes(to));
  if (a < 0 || b < 0) throw new Error('slice not found: ' + from + ' .. ' + to);
  return L.slice(a, b).join('\n');
};
const LABSRC = read('lab.js');
const cut = (from, to) => cutFrom(LABSRC, from, to);
vm.runInContext(cut('const LAB = {', 'stubs the stack expects'), ctx);
vm.runInContext(cut('function venturePotential(pile, pool', 'function labColorPotential'), ctx);
vm.runInContext(read('computers.js'), ctx);
vm.runInContext(cut('function _labPileScore(pile)', 'POTENTIAL — the analysis feature').replace(/\/\* =+\s*$/, ''), ctx);
vm.runInContext(cut('const LAB_LEVELS = [', 'function labSyncOpponentList'), ctx);
const PLAYSRC = fs.readFileSync(process.env.PLAY_JS || path.join(LABDIR, 'play.js'), 'utf8');
let failed = 0;
const ok = (name, cond, extra) => { if (!cond) failed++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); };
try {
  vm.runInContext(cutFrom(PLAYSRC, 'function playColourRows(my, opp', '/* end of the pure helpers */'), ctx);
} catch (e){ ok('play.js has playColourRows + playSaveValid', false, e.message); }
vm.runInContext(`
  let _seed = 5; Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
  var gameState = null, userSlot = 'player1';
  function _labFlash(){}
  globalThis.B = { ENGINE, MATH, CONFIG, LAB, opts: labOpponentOptions, setVentureCount,
    rows: typeof playColourRows === 'function' ? playColourRows : null,
    valid: typeof playSaveValid === 'function' ? playSaveValid : null,
    deal(seed){ _seed = seed >>> 0; const gs = ENGINE.initGame('classic', false); gs.currentTurn = 'player1'; gameState = gs; return gs; },
    play(keyA, keyB, seed){
      const gs = this.deal(seed);
      const keys = { player1: keyA, player2: keyB };
      let plies = 0;
      while (gs.status !== 'finished' && plies < 500){
        plies++;
        const slot = gs.currentTurn;
        LAB.ai = keys[slot];
        const cpu = _labCpuChooseTurn(slot);
        const mv = cpu || _labAIChoosePlay(slot);
        const r = mv.kind === 'play' ? ENGINE.playCard(gs, slot, mv.card, mv.color) : ENGINE.discardCard(gs, slot, mv.card, mv.color);
        if (r && r.success === false) return { illegal: true };
        const d = cpu ? (cpu.draw ? { source: 'discard', color: cpu.draw } : { source: 'deck' }) : _labAIChooseDraw(slot);
        if (d.source === 'deck' || !ENGINE.drawFromDiscard(gs, slot, d.color).success) ENGINE.drawFromDeck(gs, slot);
      }
      const sc = s => MATH.scoreBreakdown(gs.playPiles[s]).total;
      let n = 0;
      for (const s of ['player1', 'player2']){ n += gs.hands[s].length; for (const c of CONFIG.colors) n += gs.playPiles[s][c].length; }
      for (const c of CONFIG.colors) n += gs.discards[c].length;
      n += gs.drawPile.length;
      const purple = ['player1', 'player2'].some(s => gs.playPiles[s].purple && gs.playPiles[s].purple.length);
      return { finished: gs.status === 'finished', plies, cards: n, margin: sc('player1') - sc('player2'), purple };
    } };
`, ctx);
const B = ctx.B;
B.LAB.mode = 'play';

console.log('per-colour score lines (round result)');
if (B.rows){
  const piles = { red: [{ value: 0 }, { value: 0 }, { value: 6 }, { value: 8 }, { value: 9 }, { value: 10 }],
                  blue: [{ value: 2 }, { value: 5 }, { value: 9 }, { value: 10 }],
                  green: [{ value: 0 }], white: [], yellow: [] };
  for (const c of Object.keys(piles)) piles[c] = piles[c].map(x => Object.assign({ color: c }, x));
  const opp = { yellow: [2,3,4,5,6,7,8,9].map(v => ({ color: 'yellow', value: v })), red: [], green: [], blue: [], white: [] };
  const rows = B.rows(B.MATH.scoreBreakdown(piles).breakdown, B.MATH.scoreBreakdown(opp).breakdown);
  const by = Object.fromEntries(rows.map(r => [r.color, r]));
  ok('only colours someone started are listed, in colour order', rows.map(r => r.color).join() === 'red,green,blue,yellow', rows.map(r => r.color).join());
  ok('2 wagers, 6 8 9 10 = (33 − 20) × 3 = 39', by.red.my.score === 39 && by.red.my.line === '(33 − 20) × 3', by.red.my.line + ' = ' + by.red.my.score);
  ok('no wager: 26 − 20 = 6', by.blue.my.score === 6 && by.blue.my.line === '26 − 20', by.blue.my.line);
  ok('a lone wager still costs: (0 − 20) × 2 = −40', by.green.my.score === -40 && by.green.my.line === '(0 − 20) × 2', by.green.my.line);
  ok('8 cards add the bonus: 44 − 20 + 20 = 44', by.yellow.opp.score === 44 && by.yellow.opp.line === '44 − 20 + 20', by.yellow.opp.line);
  ok('a colour the other side never started is empty', by.yellow.my === null && by.red.opp === null);
}

console.log('the saved match');
if (B.valid){
  B.setVentureCount(5);
  const gs = B.deal(77);
  const save = { v: 1, colors: 5, userSlot: 'player1', ai: 'solid', play: { rounds: 3, results: [{ my: 12, opp: -4, first: 'player2' }], first: 'player1' }, gameState: JSON.parse(JSON.stringify(gs)) };
  ok('a real deal, through JSON, is accepted', B.valid(save) === true);
  ok('nothing saved is rejected', B.valid(null) === false && B.valid({}) === false);
  ok('a save from an older format is rejected', B.valid(Object.assign({}, save, { v: 0 })) === false);
  const lost = JSON.parse(JSON.stringify(save)); lost.gameState.drawPile.pop();
  ok('a save missing a card is rejected', B.valid(lost) === false);
  const fin = JSON.parse(JSON.stringify(save)); fin.play.results = [1, 2, 3].map(() => ({ my: 1, opp: 0, first: 'player1' }));
  ok('a finished match is not resumed', B.valid(fin) === false);
  const six = JSON.parse(JSON.stringify(save)); six.colors = 6;
  ok('colour count must match the cards', B.valid(six) === false);
}

console.log('sixth expedition: every Play opponent, six colours, 72 cards');
B.setVentureCount(6);
ok('six colours', B.CONFIG.colors.length === 6 && B.CONFIG.colors[5] === 'purple');
const keys = B.opts().map(o => o.value);
let bad = 0, illegal = 0, purple = 0, games = 0, plies = 0;
for (const k of keys){
  for (let d = 0; d < 6; d++){
    for (const [a, b] of [[k, 'solid'], ['solid', k]]){
      const r = B.play(a, b, 4000 + d * 131);
      games++;
      if (r.illegal){ illegal++; continue; }
      if (!r.finished || r.cards !== 72) bad++;
      if (r.purple) purple++;
      plies += r.plies;
    }
  }
}
ok('every game ends with all 72 cards on the table', bad === 0 && illegal === 0, games + ' games, ' + bad + ' bad, ' + illegal + ' illegal');
ok('the sixth colour gets played', purple > games / 2, purple + '/' + games + ' games');
ok('a six-colour round is longer (more turns)', plies / games > 50, (plies / games).toFixed(1) + ' plies a game');
B.setVentureCount(5);

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
