// Runs the REAL builder language (builder.js) against the vendored rules: parse
// errors, set semantics, every value, and a full solitaire game. Scratch only.
const fs = require('fs'), path = require('path'), vm = require('vm');
const LABDIR = require('path').join(__dirname, '..');

const read = p => fs.readFileSync(path.join(LABDIR, p), 'utf8');
const ctx = { console, localStorage: { getItem: () => null, setItem: () => {} },
              document: { readyState: 'loading', addEventListener: () => {}, getElementById: () => null },
              Math };
vm.createContext(ctx);

for (const f of ['config.js', 'math.js', 'rules.js', 'constants.js']) {
  let s = read('vendor/src/' + f);
  s = s.replace(/if \(typeof document[\s\S]*?\n}/, '').replace(/if \(typeof module[\s\S]*$/, '');
  if (f === 'constants.js') s = s.match(/function getCards\(obj, \.\.\.keys\)\{[\s\S]*?\n\}/)[0];
  vm.runInContext(s, ctx);
}
// potentialFor / playCost / playSoloGame / COMPUTERS come from computers.js; it
// ends with a DOM init that the stub above absorbs. venturePotential is lab.js's.
const labSrc = read('lab.js').split(/\r?\n/);
const a = labSrc.findIndex(l => l.includes('function venturePotential(pile, pool'));
const b = labSrc.findIndex(l => l.includes('function labColorPotential'));
vm.runInContext(labSrc.slice(a, b).join('\n'), ctx);
vm.runInContext(read('computers.js'), ctx);
vm.runInContext(read('builder.js'), ctx);
vm.runInContext('globalThis.B = { compile: buildCompile, solo: playSoloGame, COMPUTERS, CONFIG, RULES };', ctx);
const B = ctx.B;

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want)));
};
const ok = (name, cond, extra) => eq(name + (extra !== undefined ? '  [' + extra + ']' : ''), !!cond, true);

const card = (color, value) => ({ id: color + value, color, value });
const empty = () => { const o = {}; for (const c of B.CONFIG.colors) o[c] = []; return o; };

// Everything red bar the 2 and one wager, so a hand holding those two sits in a
// pool with the whole colour still to come — a real game's pool, not a stub.
function restOfRed(){
  const out = [card('red', 0), card('red', 0)];
  for (let v = 3; v <= 10; v++) out.push(card('red', v));
  return out;
}

// A view the way playSoloGame builds one: pool = deck + hand.
function view(hand, pilesInit, deckExtra){
  const piles = Object.assign(empty(), pilesInit || {});
  const pool = empty();
  for (const c of hand) pool[c.color].push(c);
  for (const c of (deckExtra || [])) pool[c.color].push(c);
  const playable = hand.filter(c => B.RULES.canPlayOnPlayPile(c, piles[c.color]));
  return { hand, piles, pool, playable, rng: () => 0.5 };
}

console.log('the line the language exists for');
const lowest = B.compile([
  'for card in playable:',
  '    if change in potential min:',
  '        play',
].join('\n'));
{
  // With the whole colour still to come, a wager costs 0 potential (it blocks
  // nothing) and a red 2 costs 102 (it locks out all three wagers) — the two
  // numbers the README quotes. So the wager has to be the pick.
  // NOTE: with a THIN pool this flips, correctly: if a 2 and a wager are all
  // that is left of a colour, the pair scores -36 and the 2 alone -18, so
  // playing the 2 RAISES potential. Expecting the wager there was this harness
  // being wrong, not the language — the built-in Lowest agreed with the code.
  const hand = [card('red', 2), card('red', 0), card('green', 9)];
  const mv = lowest(view(hand, null, restOfRed()));
  eq('plays the cheapest card by change in potential', [mv.action, mv.card.color, mv.card.value],
     ['play', 'red', 0]);
  eq('it agrees with the built-in Lowest', mv.card.id,
     B.COMPUTERS.lowest.decide(view(hand, null, restOfRed())).card.id);
}

console.log('\nset semantics');
{
  const prog = B.compile([
    'for card in hand:',
    '    if card num > 5:',
    '        discard',
    '    else:',
    '        play',
  ].join('\n'));
  const mv = prog(view([card('red', 9), card('blue', 3)], null, []));
  eq('the if branch acts on the cards that passed', [mv.action, mv.card.value], ['discard', 9]);

  // Nothing passes ⇒ else gets the leftovers.
  const mv2 = prog(view([card('red', 2), card('blue', 3)], null, []));
  eq('else gets what failed the test', [mv2.action, mv2.card.value], ['play', 2]);
}
{
  const prog = B.compile([
    'for card in hand:',
    '    if card color == red:',
    '        if card num max:',
    '            discard',
  ].join('\n'));
  const mv = prog(view([card('red', 4), card('red', 8), card('blue', 10)], null, []));
  eq('conditions stack: highest RED, not highest card', [mv.action, mv.card.color, mv.card.value],
     ['discard', 'red', 8]);
}
{
  // play is skipped when nothing in the narrowed set is legal, so the program
  // falls through to the next statement instead of crashing the runner.
  const prog = B.compile([
    'for card in hand:',
    '    if card color == red:',
    '        play',
    'for card in hand:',
    '    if card num min:',
    '        discard',
  ].join('\n'));
  const mv = prog(view([card('red', 3), card('blue', 7)], { red: [card('red', 9)] }, []));
  eq('an illegal play is skipped, not thrown', [mv.action, mv.card.color], ['discard', 'red']);
}

console.log('\nvalues');
{
  const mk = body => B.compile('for card in hand:\n' + body);
  const hand = [card('red', 4), card('red', 6), card('blue', 2)];
  const deck = [card('red', 10), card('green', 5), card('green', 7)];   // deck = 3 ⇒ turns = 3
  const v = () => view(hand, null, deck);

  eq('proj turns counts the deck', mk('    if proj turns == 3:\n        discard')(v()).action, 'discard');
  eq('deck is the same number here', mk('    if deck == 3:\n        discard')(v()).action, 'discard');
  eq('hand is the hand size', mk('    if hand == 3:\n        discard')(v()).action, 'discard');
  eq('same color in hand counts the colour',
     mk('    if same color in hand == 2:\n        if card num max:\n            discard')(v()).card.value, 6);
  eq('open colors is 0 before anything is played',
     mk('    if open colors == 0:\n        discard')(v()).action, 'discard');
  eq('pile size sees a started venture',
     B.compile('for card in hand:\n    if pile size == 1:\n        discard')(
       view(hand, { red: [card('red', 2)] }, deck)).card.color, 'red');
  // Potential is what the colour could still reach FROM THIS POOL, so a thin
  // pool means a small number: red here is only {4,6,10} ⇒ (20 − 20) = 0.
  eq('potential reads the thin pool honestly',
     mk('    if potential == 0:\n        if card num max:\n            discard')(v()).card.value, 6);
  // 11 of the 12 reds available (restOfRed is a wager short): the 9 numbers sum
  // to 54, so (54 − 20) × (1 + 2 wagers) + 20 for length = 122.
  eq('...and a nearly full colour reaches its real ceiling',
     B.compile('for card in hand:\n    if potential == 122:\n        discard')(
       view([card('red', 2)], null, restOfRed())).action, 'discard');
  eq('and/or join comparisons',
     mk('    if card num > 5 or card color == blue:\n        if card num min:\n            discard')(v()).card.value, 2);
}

console.log('\nrandom');
{
  const prog = B.compile('for card in hand:\n    if random:\n        discard');
  const hand = [card('red', 4), card('blue', 6), card('green', 8)];
  const seen = new Set();
  const v = view(hand, null, []);
  let r = 0;
  v.rng = () => [0.05, 0.4, 0.9][r++ % 3];
  for (let i = 0; i < 3; i++) seen.add(prog(v).card.id);
  eq('random reaches every card', seen.size, 3);
}
{
  // rand is ONE roll per line, so it is a coin flip for the branch — not a
  // random filter that keeps some cards and drops others.
  const prog = B.compile([
    'for card in hand:',
    '    if rand < 0.5:',
    '        if card num max:',
    '            discard',
    '    else:',
    '        if card num min:',
    '            discard',
  ].join('\n'));
  const hand = [card('red', 4), card('blue', 9)];
  const lo = view(hand, null, []); lo.rng = () => 0.1;
  const hi = view(hand, null, []); hi.rng = () => 0.9;
  eq('rand low takes the if branch', prog(lo).card.value, 9);
  eq('rand high takes the else branch', prog(hi).card.value, 4);
}

console.log('\nerrors point at the line');
const bad = (src, wantLine, what) => {
  let e = null;
  try { B.compile(src); } catch (err){ e = err; }
  ok('rejects ' + what, e && e.line === wantLine, e ? 'line ' + e.line + ': ' + e.message : 'no error!');
};
bad('for card in hand:\n    if card num > 5:\n        play\n  else:\n        play', 4, 'a misaligned else');
bad('for card in hand:\n    if card num > 5:\n', 2, 'an if with no body');
bad('if card num > 5:\n    play', 1, 'a card value outside a for loop');
bad('for card in hand:\n    if change in potential min and card num > 2:\n        play', 2, 'min joined with and');
bad('for card in hand:\n    if potatoes > 2:\n        play', 2, 'an unknown value');
bad('for card in hand:\n    if card color == purple:\n        play', 2, 'a colour that is not in play');
bad('for card in deck:\n    play', 1, 'a list you cannot loop over');
bad('for card in hand:\n    if proj turns min:\n        play', 2, 'min on a value that is the same for every card');
bad('for card in hand:\n    if card num > 5:\n        play\n            play', 4, 'a stray extra indent');
bad('', 1, 'an empty program');

console.log('\nwhole solitaire games');
{
  const prog = B.compile([
    'for card in playable:',
    '    if change in potential min:',
    '        play',
    'for card in hand:',
    '    if change in potential min:',
    '        discard',
  ].join('\n'));
  const mine = [], built = [];
  for (let i = 0; i < 40; i++){
    mine.push(B.solo({ decide: prog }).score);
    built.push(B.solo(B.COMPUTERS.lowest).score);
  }
  const med = xs => xs.slice().sort((p, q) => p - q)[Math.floor(xs.length / 2)];
  ok('a written-out Lowest plays a full game', mine.every(s => isFinite(s)));
  eq('...and never falls back to the default move', prog.fallbacks, 0);
  ok('...scoring in the same country as the built-in Lowest',
     Math.abs(med(mine) - med(built)) < 25, 'median ' + med(mine) + ' vs ' + med(built));

  // Wager Open, written in the language: only open a colour with a wager.
  const wo = B.compile([
    'for card in playable:',
    '    if pile size > 0 or card num == 0:',
    '        if change in potential min:',
    '            play',
    'for card in hand:',
    '    if change in potential min:',
    '        discard',
  ].join('\n'));
  const woS = [], builtWo = [];
  for (let i = 0; i < 40; i++){
    woS.push(B.solo({ decide: wo }).score);
    builtWo.push(B.solo(B.COMPUTERS.wageropen).score);
  }
  ok('Wager Open written in the language lands near the built-in one',
     Math.abs(med(woS) - med(builtWo)) < 30, 'median ' + med(woS) + ' vs ' + med(builtWo));
  ok('...and beats the written-out Lowest, as the README says it should',
     med(woS) > med(mine), 'wager-open ' + med(woS) + ' vs lowest ' + med(mine));
}
{
  // A program that decides nothing still has to produce legal moves every turn.
  const noop = B.compile('for card in hand:\n    if card num > 99:\n        play');
  const r = B.solo({ decide: noop });
  ok('a program that never decides still plays out legally', isFinite(r.score));
  ok('...and every one of those turns is counted as a fallback',
     noop.fallbacks === r.played + r.discarded, noop.fallbacks + ' of ' + (r.played + r.discarded));
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
