// ONLINE: js/lc-online.js, the game object the shared online kit (js/online.js) runs.
//
// Plays whole games with its own computer, checks the rules (ascending, wagers
// first, no drawing back the card you just discarded, turn order, game ends on
// the last deck card), scores with the vendored MATH.scorePlayPile, and checks
// the secrets: the room (publicView) never holds a hand or the deck order, and a
// private doc holds only that seat's hand. Ends with a whole game in a local kit
// room, the same code path a real room uses.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { pathToFileURL } = require('url');
const LABDIR = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(LABDIR, p), 'utf8');
const ctx = { console };
vm.createContext(ctx);
for (const f of ['config.js', 'math.js', 'rules.js']) {
  const s = read('vendor/src/' + f).replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  vm.runInContext(s, ctx);
}
vm.runInContext('globalThis.V = { CONFIG, MATH, RULES };', ctx);
const V = ctx.V;
const { game } = require(path.join(LABDIR, 'js/lc-online.js'));

let failed = 0;
const ok = (name, cond, extra) => { if (!cond) failed++; console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : '')); };
const copy = s => JSON.parse(JSON.stringify(s));
function mulberry(a){ return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const throws = f => { try { f(); return false; } catch (e){ return true; } };
const people = [{ kind: 'human', name: 'A' }, { kind: 'human', name: 'B' }];
const step = (s, rng) => { const seat = game.toAct(s)[0]; return game.apply(copy(s), seat, game.bot({ pub: game.publicView(s), mine: game.privateView(s, seat) }, seat, rng), rng); };

// --- the deck is the vendored one: 60 cards, same ids
{
  const s = game.setup(2, {}, mulberry(1), people);
  const ids = s.deck.concat(s.hands[0], s.hands[1]).map(c => c.id).sort();
  const want = V.RULES.allCards().map(c => c.id).sort();
  ok('60 cards, same ids as the vendored deck', JSON.stringify(ids) === JSON.stringify(want), ids.length);
  ok('8 cards each, 44 in the deck', s.hands[0].length === 8 && s.hands[1].length === 8 && s.deck.length === 44);
  ok('colours match CONFIG', JSON.stringify(game.COLORS) === JSON.stringify(V.CONFIG.colors));
}

// --- whole games: legal, JSON-safe, end on the last deck card, scores = MATH
{
  let games = 0, bad = 0, turns = 0, scoreBad = 0, total = 0;
  for (let g = 0; g < 200; g++){
    const rng = mulberry(g + 7);
    let s = game.setup(2, {}, rng, people);
    let k = 0;
    while (!game.isOver(s)){
      if (game.toAct(s).length !== 1){ bad++; break; }
      s = step(s, rng);
      if (JSON.stringify(copy(s)) !== JSON.stringify(s)) bad++;
      if (++k > 400){ bad++; break; }
    }
    turns += k; games++;
    if (s.deck.length !== 0) bad++;
    for (let p = 0; p < 2; p++){
      const m = V.CONFIG.colors.reduce((t, c) => t + V.MATH.scorePlayPile(s.piles[p][c]), 0);
      if (m !== s.scores[p]) scoreBad++;
      total += s.scores[p];
      for (const c of V.CONFIG.colors){
        const pile = s.piles[p][c];
        for (let i = 1; i < pile.length; i++) if (!V.RULES.canPlayOnPlayPile(pile[i], pile.slice(0, i))) bad++;
      }
    }
  }
  ok('200 computer games end on the last deck card, every pile ascending', bad === 0, bad);
  ok('final scores equal the vendored MATH.scorePlayPile', scoreBad === 0, scoreBad);
  ok('the online computer scores above zero on average', total / 400 > 0, (total / 400).toFixed(1));
  console.log('        (' + (turns / games).toFixed(0) + ' moves a game)');
}

// --- the rules
{
  const rng = mulberry(3);
  let s = game.setup(2, { first: 0 }, rng, people);
  ok('first player from options', game.toAct(s)[0] === 0);
  ok('the other seat cannot move', throws(() => game.apply(copy(s), 1, { t: 'discard', id: s.hands[1][0].id }, rng)));
  ok('cannot draw in the play phase', throws(() => game.apply(copy(s), 0, { t: 'draw', from: 'deck' }, rng)));
  ok('cannot play a card you do not hold', throws(() => game.apply(copy(s), 0, { t: 'play', id: s.hands[1][0].id }, rng)));
  // build a pile: a 6 then try a 4 of the same colour
  s.hands[0][0] = { color: 'red', value: 6, id: 'red_6' };
  s.hands[0][1] = { color: 'red', value: 4, id: 'red_4' };
  s.hands[0][2] = { color: 'red', value: 0, id: 'red_w0' };
  s.deck = s.deck.filter(c => !['red_6', 'red_4', 'red_w0'].includes(c.id));
  s.hands[1] = s.hands[1].filter(c => !['red_6', 'red_4', 'red_w0'].includes(c.id));
  while (s.hands[1].length < 8) s.hands[1].push(s.deck.pop());
  s = game.apply(s, 0, { t: 'play', id: 'red_6' }, rng);
  ok('after a play: draw phase, same seat', s.phase === 'draw' && game.toAct(s)[0] === 0);
  s = game.apply(s, 0, { t: 'draw', from: 'deck' }, rng);
  s = game.apply(s, 1, { t: 'discard', id: s.hands[1][0].id }, rng);
  const dcColor = s.lastDiscard;
  ok('cannot draw back the card just discarded', throws(() => game.apply(copy(s), 1, { t: 'draw', from: s.lastDiscard }, rng)));
  s = game.apply(s, 1, { t: 'draw', from: 'deck' }, rng);
  ok('a 4 cannot follow a 6', throws(() => game.apply(copy(s), 0, { t: 'play', id: 'red_4' }, rng)));
  ok('a wager cannot follow a number', throws(() => game.apply(copy(s), 0, { t: 'play', id: 'red_w0' }, rng)));
  const before = s.discards.red.length;
  s = game.apply(s, 0, { t: 'discard', id: 'red_4' }, rng);
  ok('discard goes on its colour pile', s.discards.red.length === before + 1);
  if (dcColor !== 'red') ok('an older discard pile can be taken', !throws(() => game.apply(copy(s), 0, { t: 'draw', from: dcColor }, rng)));
  ok('the pile just discarded to cannot', throws(() => game.apply(copy(s), 0, { t: 'draw', from: 'red' }, rng)));
}

// --- secrets
{
  let leaks = 0, privBad = 0, n = 0;
  for (let g = 0; g < 30; g++){
    const rng = mulberry(100 + g);
    let s = game.setup(2, {}, rng, people);
    while (!game.isOver(s)){
      const pv = game.publicView(s), pub = JSON.stringify(pv);
      // a card taken from a discard pile was seen by both players: the last move may name it
      const seen = new Set([pv.last && pv.last.card, pv.last && pv.last.play && pv.last.play.card].filter(Boolean).map(c => c.id));
      const hidden = s.hands[0].concat(s.hands[1], s.deck).filter(c => !seen.has(c.id));
      for (const c of hidden) if (pub.includes('"' + c.id + '"')) leaks++;
      for (let p = 0; p < 2; p++){
        const mine = game.privateView(s, p);
        const keys = Object.keys(mine).join(',');
        if (keys !== 'hand' || JSON.stringify(mine.hand) !== JSON.stringify(s.hands[p])) privBad++;
      }
      n++;
      s = step(s, rng);
    }
  }
  ok('the room never holds a hidden card (either hand or the deck)', leaks === 0, leaks + ' in ' + n + ' views');
  ok('a private doc is exactly that seat\'s hand', privBad === 0, privBad);
}

// --- a local kit room plays to the end
(async () => {
  const { createLocal } = await import(pathToFileURL(path.join(LABDIR, 'js/online.js')).href);
  const room = createLocal({ game, seats: ['human', 'human'], options: {}, names: ['A', 'B'], botDelayMs: 0 });
  let snap = null;
  room.on('change', x => { snap = x; });
  room.start();
  const rng = mulberry(5);
  for (let i = 0; i < 400 && snap.status !== 'finished'; i++){
    const seat = snap.toAct[0];
    const v = room.view(seat);
    room.act(game.bot({ pub: v.pub, mine: v.mine }, seat, rng), seat);
    await new Promise(r => setTimeout(r, 0));
  }
  ok('a local kit room with two people plays to the end', snap.status === 'finished' && snap.pub.over === true, snap.status);
  console.log(failed ? '\n' + failed + ' FAILED' : '\nall online checks passed');
  process.exit(failed ? 1 : 0);
})();
