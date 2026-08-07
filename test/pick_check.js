// Slices labPickDraw out of lab.js and checks the reorder contract: the chosen
// card is what the game's own pop() takes, and nothing else moves. Scratch only.
const fs = require('fs'), path = require('path'), vm = require('vm');
const LABDIR = require('path').join(__dirname, '..');

const src = fs.readFileSync(path.join(LABDIR, 'lab.js'), 'utf8').split(/\r?\n/);
const a = src.findIndex(l => l.includes('async function labPickDraw(cardId){'));
const b = src.findIndex(l => l.includes('GAME SETUP / TEARDOWN')) - 1;  // -1: skip the /* opener
const slice = src.slice(a, b).join('\n');

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(`
  let gameState = null, _deckSig = 'stale', drew = null, flashes = [];
  const userSlot = 'player1';
  const LAB = { pickDraw: true };
  function _labFlash(m){ flashes.push(m); }
  // Stands in for the lab's real draw: ENGINE.drawFromDeck pops the LAST card.
  async function drawFromDrawPile(){
    if (gameState.currentTurn !== userSlot || gameState.phase !== 'draw') return;
    drew = gameState.drawPile.pop();
  }
  ${slice}
  globalThis.T = {
    pick: labPickDraw,
    set: gs => { gameState = gs; drew = null; flashes = []; _deckSig = 'stale'; },
    drew: () => drew, deck: () => gameState.drawPile.map(c => c.id),
    flashes: () => flashes, sig: () => _deckSig,
    off: () => { LAB.pickDraw = false; }, on: () => { LAB.pickDraw = true; },
  };
`, ctx);
const T = ctx.T;

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '\n         got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want)));
};

const card = (id) => ({ id, color: 'red', value: 5 });
const deckOf = () => ['a', 'b', 'c', 'd', 'e', 'f'].map(card);
const state = (o) => ({ drawPile: deckOf(), currentTurn: o.turn || 'player1', phase: o.phase || 'draw' });

(async () => {
  // The contract: pick a card from the MIDDLE and the game's pop() takes it.
  T.set(state({}));
  eq('picks the buried card', await T.pick('c'), true);
  eq('the game drew exactly that card', T.drew().id, 'c');
  eq('every other card is still there, in order', T.deck(), ['a', 'b', 'd', 'e', 'f']);
  eq('the panel is told to rebuild', T.sig(), '');

  // The top card is still a normal draw.
  T.set(state({}));
  await T.pick('f');
  eq('picking the top card draws the top card', T.drew().id, 'f');
  eq('...and disturbs nothing', T.deck(), ['a', 'b', 'c', 'd', 'e']);

  // Guards.
  T.off();
  T.set(state({}));
  eq('does nothing while pick draw is OFF', await T.pick('c'), false);
  eq('...and nothing was drawn', T.drew(), null);
  T.on();

  T.set(state({ phase: 'play' }));
  eq('refuses during the play phase', await T.pick('c'), false);
  eq('...and says why', T.flashes().length > 0, true);
  eq('...and the deck is untouched', T.deck(), ['a', 'b', 'c', 'd', 'e', 'f']);

  T.set(state({ turn: 'player2' }));
  eq("refuses on the opponent's turn", await T.pick('c'), false);
  eq('...deck untouched', T.deck(), ['a', 'b', 'c', 'd', 'e', 'f']);

  T.set(state({}));
  eq('refuses a card that is not in the deck', await T.pick('zzz'), false);
  eq('...deck untouched', T.deck(), ['a', 'b', 'c', 'd', 'e', 'f']);

  process.exit(failed ? 1 : 0);
})();
