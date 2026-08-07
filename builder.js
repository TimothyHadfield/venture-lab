/* ============================================================================
   builder.js — BUILD A COMPUTER

   A small Python-shaped language for writing a Venture computer, and the page
   you write it on. A program compiles to the same `decide(view)` contract the
   built-in computers use (computers.js), so a saved computer appears in the
   computers list and is measured by exactly the same runner.

   ── THE IDEA THAT MAKES IT READ LIKE ENGLISH ─────────────────────────────────
   A `for` loop does NOT walk the cards one at a time. It holds a SET of
   candidate cards, and every statement inside narrows that set:

       for card in hand:            <- the set starts as your whole hand
           if change in potential min:   <- narrowed to the one card that scores lowest
               play                      <- play what is left

   which is the line the whole language exists to make readable: *play the card
   that changes the potential the least*. Walking one card at a time could not
   express it — "is this card the minimum?" is a question about the whole set,
   not about one card, and you would need a variable and a second pass to ask it.

   Under set semantics:
     - `if <value> <op> <number>:` keeps the cards that pass; `else` gets the
       ones that failed (so the chain carries the leftovers forward).
     - `if <value> min:` / `max:` keeps the single best card.
     - `if random:` keeps one card at random.
     - `play` / `discard` acts on the set and ENDS the turn.
   ========================================================================== */

/* ------------------------------------------------------------------ values */
/* `card: true` means the value belongs to one card, so it is only meaningful
   inside a `for` loop — using one outside is a compile error rather than a
   mystery at run time. */
const BUILD_VALUES = {
  'change in potential': { card: true, get: (x, c) => x.playCost(c),
    doc: 'how much potential that colour loses if you play this card (low = cheap)' },
  'change in reachable': { card: true, get: (x, c) => x.reachCost(c),
    doc: 'the same, but counting only what there is time to play. What The Patient uses.' },
  'potential':           { card: true, get: (x, c) => x.potential(c.color),
    doc: "the card's colour potential right now" },
  'reachable potential': { card: true, get: (x, c) => x.reachable(c.color),
    doc: 'potential capped by the turns you have left — potential you have time for' },
  'break even gap':      { card: true, get: (x, c) => x.breakEven(c.color),
    doc: 'number points this colour still needs to clear its −20 (0 once in profit)' },
  'dead cards':          { card: false, get: x => x.deadCards(),
    doc: 'cards in hand your own piles have climbed past — free to throw away' },
  'same color in hand':  { card: true, get: (x, c) => x.sameColor(c.color),
    doc: 'how many cards of this colour you hold (including this one)' },
  'pile size':           { card: true, get: (x, c) => x.piles[c.color].length,
    doc: 'cards already played in this colour' },
  'card num':            { card: true, get: (x, c) => c.value,
    doc: "the card's number — a wager is 0" },
  'card color':          { card: true, color: true, get: (x, c) => c.color,
    doc: 'compare against a colour word: card color == red' },
  'proj turns':          { card: false, get: x => x.turns,
    doc: 'plays you have left (solitaire: one per deck card)' },
  'deck':                { card: false, get: x => x.deck,
    doc: 'cards left in the draw pile' },
  'hand':                { card: false, get: x => x.hand.length,
    doc: 'how many cards you hold — also what `for card in hand` walks' },
  'hand size':           { card: false, get: x => x.hand.length, doc: 'same as `hand`' },
  'opphand':             { card: false, get: x => x.opphand,
    doc: "cards in the opponent's hand — 0 in the solitaire runner" },
  'open colors':         { card: false, get: x => x.openColors(),
    doc: 'how many ventures you have started' },
  'rand':                { card: false, rand: true, get: x => x.roll,
    doc: 'a fresh number from 0 to 1, rolled once per line' },
};

const BUILD_LISTS = {
  hand:     x => x.hand,
  playable: x => x.playable,
};

const BUILD_OPS = {
  '<':  (a, b) => a <  b,
  '<=': (a, b) => a <= b,
  '>':  (a, b) => a >  b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a === b,
  '=':  (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

// Longest first, so 'card num' is never matched as 'card' and 'hand size' is
// never matched as 'hand'.
const _VALUE_NAMES = Object.keys(BUILD_VALUES).sort((a, b) => b.length - a.length);

class BuildError extends Error {
  constructor(msg, line){ super(msg); this.line = line; }
}

/* ------------------------------------------------------------------ parsing */
/* Lines to a tree, by indentation. Tabs count as 4 so a mixed file still
   parses instead of failing on something invisible. */
function buildParse(source){
  const raw = String(source || '').split('\n');
  const lines = [];
  raw.forEach((text, i) => {
    const noComment = text.split('#')[0];
    if (!noComment.trim()) return;                       // blank / comment-only
    const expanded = noComment.replace(/\t/g, '    ');
    const indent = expanded.length - expanded.replace(/^ +/, '').length;
    lines.push({ n: i + 1, indent, text: expanded.trim() });
  });

  let pos = 0;
  function block(indent){
    const out = [];
    while (pos < lines.length && lines[pos].indent >= indent){
      const ln = lines[pos];
      if (ln.indent > indent)
        throw new BuildError('unexpected indent — this line is deeper than the one above it', ln.n);
      pos++;
      out.push(statement(ln));
    }
    return out;
  }
  function body(after){
    const next = lines[pos];
    if (!next || next.indent <= after.indent)
      throw new BuildError('"' + after.text + '" needs an indented line under it', after.n);
    return block(next.indent);
  }
  function statement(ln){
    const t = ln.text;

    let m = /^for\s+(\w+)\s+in\s+(\w+)\s*:$/i.exec(t);
    if (m){
      const list = m[2].toLowerCase();
      if (!BUILD_LISTS[list])
        throw new BuildError('cannot loop over "' + m[2] + '" — try ' + Object.keys(BUILD_LISTS).join(' or '), ln.n);
      return { type: 'for', list, line: ln.n, body: body(ln) };
    }

    m = /^if\s+(.+):$/i.exec(t);
    if (m){
      const node = { type: 'if', line: ln.n,
                     branches: [{ cond: buildCondition(m[1], ln.n), body: body(ln) }] };
      // elif/else must sit at the SAME indent as their if, exactly as in Python.
      while (pos < lines.length && lines[pos].indent === ln.indent){
        const nxt = lines[pos];
        const em = /^elif\s+(.+):$/i.exec(nxt.text);
        if (em){
          pos++;
          node.branches.push({ cond: buildCondition(em[1], nxt.n), body: body(nxt) });
          continue;
        }
        if (/^else\s*:$/i.test(nxt.text)){
          pos++;
          node.branches.push({ cond: null, body: body(nxt) });
          break;                                          // else closes the chain
        }
        break;
      }
      return node;
    }

    if (/^(elif|else)\b/i.test(t))
      throw new BuildError('"' + t + '" has no matching "if" at the same indent', ln.n);
    if (/^play$/i.test(t))    return { type: 'play', line: ln.n };
    if (/^discard$/i.test(t)) return { type: 'discard', line: ln.n };

    throw new BuildError('I do not understand "' + t + '"', ln.n);
  }

  const tree = block(0);
  if (!tree.length) throw new BuildError('there is no code here yet', 1);
  return tree;
}

/* --------------------------------------------------------------- conditions */
function _matchValue(text){
  const low = text.toLowerCase();
  for (const name of _VALUE_NAMES){
    if (low === name || low.startsWith(name + ' '))
      return { name, rest: text.slice(name.length).trim() };
  }
  return null;
}

/* A condition is either ONE selector (min / max / random — a question about the
   whole set) or one or more comparisons joined by and/or. The two cannot mix:
   "the smallest card AND bigger than 5" has no answer that is still a single
   choice, and quietly picking one reading would be worse than saying so. */
function buildCondition(text, line){
  const src = text.trim();
  if (/^random$/i.test(src)) return { kind: 'random' };

  const v = _matchValue(src);
  if (v && /^(min|max)$/i.test(v.rest)){
    const def = BUILD_VALUES[v.name];
    if (!def.card)
      throw new BuildError('"' + v.name + ' ' + v.rest.toLowerCase() + '" makes no sense — '
        + v.name + ' is the same for every card', line);
    return { kind: v.rest.toLowerCase(), value: v.name };
  }

  // Comparisons, left to right: `and` binds no tighter than `or` here. One
  // level of precedence keeps the language honest — write two ifs if you need
  // grouping, which is clearer than parentheses nobody can see the effect of.
  const parts = src.split(/\s+(and|or)\s+/i);
  const terms = [], joins = [];
  for (let i = 0; i < parts.length; i++){
    if (i % 2) joins.push(parts[i].toLowerCase());
    else terms.push(_buildTerm(parts[i].trim(), line));
  }
  return { kind: 'test', terms, joins };
}

function _buildTerm(text, line){
  if (/^(min|max|random)$/i.test(text))
    throw new BuildError('"' + text.toLowerCase() + '" picks one card out of the whole set, '
      + 'so it cannot be joined with and/or — put it in an if of its own', line);

  const v = _matchValue(text);
  if (!v){
    // Name the word that is wrong, not the whole line — "potatoes" is the
    // useful half of "potatoes > 2".
    const word = (text.split(/\s*(<=|>=|==|!=|=|<|>)/)[0] || text).trim();
    throw new BuildError('I do not know a value called "' + word + '"', line);
  }
  const def = BUILD_VALUES[v.name];

  if (/^(min|max)$/i.test(v.rest))
    throw new BuildError('"' + v.name + ' ' + v.rest.toLowerCase() + '" picks one card out of the '
      + 'whole set, so it cannot be joined with and/or — put it in an if of its own', line);

  const m = /^(<=|>=|==|!=|=|<|>)\s*(.+)$/.exec(v.rest);
  if (!m)
    throw new BuildError('"' + v.name + '" needs a comparison after it, like "' + v.name + ' > 5"'
      + (def.card ? ' or "' + v.name + ' min"' : ''), line);

  const op = m[1], rhsText = m[2].trim();
  let rhs;
  if (def.color){
    const c = rhsText.toLowerCase();
    if (CONFIG.colors.indexOf(c) < 0)
      throw new BuildError('"' + rhsText + '" is not a colour — try ' + CONFIG.colors.join(', '), line);
    if (op !== '==' && op !== '=' && op !== '!=')
      throw new BuildError('colours can only be compared with == or !=', line);
    rhs = c;
  } else {
    rhs = Number(rhsText);
    if (!isFinite(rhs)) throw new BuildError('"' + rhsText + '" is not a number', line);
  }
  return { value: v.name, op, rhs };
}

/* ----------------------------------------------------------------- compiling */
/* Card values only mean something inside a loop, so that is checked once, here,
   instead of turning into a silent wrong answer 3,000 games later. */
function _checkScope(tree, inLoop){
  for (const st of tree){
    if (st.type === 'for'){ _checkScope(st.body, true); continue; }
    if (st.type !== 'if') continue;
    for (const br of st.branches){
      if (br.cond && !inLoop){
        const names = br.cond.kind === 'test' ? br.cond.terms.map(t => t.value)
                    : br.cond.kind === 'random' ? [] : [br.cond.value];
        for (const nm of names){
          if (BUILD_VALUES[nm].card)
            throw new BuildError('"' + nm + '" belongs to one card, so it needs to be inside '
              + 'a "for card in hand:" loop', st.line);
        }
        if (br.cond.kind === 'random')
          throw new BuildError('"random" picks a card, so it needs to be inside a '
            + '"for card in hand:" loop', st.line);
      }
      _checkScope(br.body, inLoop);
    }
  }
}

/* Deterministic order for everything that has to choose: cheapest number first,
   then colour order. Same rule the built-in computers tie-break on, so a
   program that does not fully specify a choice still behaves the same way twice
   in a row. */
function _ordered(cards){
  return cards.slice().sort((a, b) =>
    a.value - b.value || CONFIG.colors.indexOf(a.color) - CONFIG.colors.indexOf(b.color));
}

function _narrow(cond, ctx, set){
  if (cond.kind === 'min' || cond.kind === 'max'){
    const def = BUILD_VALUES[cond.value];
    let best = null, bestV = null;
    for (const c of _ordered(set)){
      const v = def.get(ctx, c);
      if (bestV === null || (cond.kind === 'min' ? v < bestV - 1e-9 : v > bestV + 1e-9)){
        best = c; bestV = v;
      }
    }
    return best ? [best] : [];
  }
  if (cond.kind === 'random'){
    if (!set.length) return [];
    return [set[Math.floor(ctx.rng() * set.length)]];
  }
  // `rand` is rolled ONCE per line, not once per card: "if rand < 0.3" is meant
  // to be a coin flip for the whole branch, not a random filter of your hand.
  ctx.roll = ctx.rng();
  return set.filter(card => {
    let acc = null;
    for (let i = 0; i < cond.terms.length; i++){
      const t = cond.terms[i];
      const def = BUILD_VALUES[t.value];
      const got = def.get(ctx, card);
      const one = BUILD_OPS[t.op](got, t.rhs);
      acc = i === 0 ? one : (cond.joins[i - 1] === 'or' ? (acc || one) : (acc && one));
    }
    return acc === null ? true : acc;
  });
}

function _runBlock(tree, ctx, set){
  for (const st of tree){
    if (st.type === 'play' || st.type === 'discard'){
      const ordered = _ordered(set);
      if (st.type === 'discard'){
        if (ordered.length) return { action: 'discard', card: ordered[0] };
        continue;                                    // nothing to act on — read on
      }
      // A `play` that names an illegal card would throw inside the runner and
      // kill the whole run, so it simply does not fire: the set is filtered to
      // what is legal, and if none of it is, the program carries on to its next
      // statement. That makes "for card in hand: ... play" safe to write.
      const legal = ordered.filter(c => ctx.legal(c));
      if (legal.length) return { action: 'play', card: legal[0] };
      continue;
    }

    if (st.type === 'for'){
      const got = _runBlock(st.body, ctx, BUILD_LISTS[st.list](ctx).slice());
      if (got) return got;
      continue;
    }

    if (st.type === 'if'){
      let rest = set;                                // what earlier branches left
      for (const br of st.branches){
        if (!br.cond){                               // else
          if (!rest.length) break;
          const got = _runBlock(br.body, ctx, rest);
          if (got) return got;
          break;
        }
        const pass = _narrow(br.cond, ctx, rest);
        if (pass.length){
          const got = _runBlock(br.body, ctx, pass);
          if (got) return got;
          break;                                     // the branch was taken
        }
        rest = rest.filter(c => pass.indexOf(c) < 0);
      }
    }
  }
  return null;
}

/* Compile source into a `decide(view)`. Throws BuildError (with .line) on a
   program that cannot run — the editor shows that against the line. */
function buildCompile(source){
  const tree = buildParse(source);
  _checkScope(tree, false);

  const decide = function(view){
    let poolN = 0;
    for (const c of CONFIG.colors) poolN += view.pool[c].length;
    const ctx = {
      hand: view.hand, piles: view.piles, pool: view.pool, playable: view.playable,
      rng: view.rng || Math.random,
      roll: 0,
      // pool = deck + hand, so the deck is what is left once your hand is out of
      // it. One deck card per turn, so that is also how many plays you have.
      deck: poolN - view.hand.length,
      turns: poolN - view.hand.length,
      opphand: view.opphand ? view.opphand.length : 0,
      legal: c => view.playable.indexOf(c) >= 0,
      potential: color => potentialFor(view.piles, view.pool, color),
      playCost: card => playCost(view.piles, view.pool, card),
      // The turn-budgeted family. `turns` is computed just above, so a program
      // gets the same numbers The Patient decides on.
      reachable: color => reachableFor(view.piles, view.pool, color,
                                       Math.max(1, poolN - view.hand.length)),
      reachCost: card => reachableCost(view.piles, view.pool, card,
                                       Math.max(1, poolN - view.hand.length), 'play'),
      breakEven: color => {
        const pile = view.piles[color];
        if (!pile.length) return 0;
        let sum = 0;
        for (const c of pile) sum += c.value;
        return Math.max(0, CONFIG.scoring.baseCost - sum);
      },
      deadCards: () => view.hand.reduce((n, c) =>
        n + (view.playable.indexOf(c) < 0 ? 1 : 0), 0),
      sameColor: color => view.hand.reduce((n, c) => n + (c.color === color ? 1 : 0), 0),
      openColors: () => CONFIG.colors.reduce((n, c) => n + (view.piles[c].length ? 1 : 0), 0),
    };
    const got = _runBlock(tree, ctx, view.hand.slice());
    if (got) return got;

    // The program said nothing about this position. Rather than guess well (a
    // silent fallback that plays like Lowest would flatter a program that never
    // decides anything), take the plainest legal move and COUNT it, so the test
    // panel can tell you how much of the game your code is actually running.
    decide.fallbacks++;
    const legal = _ordered(view.playable);
    if (legal.length) return { action: 'play', card: legal[0] };
    return { action: 'discard', card: _ordered(view.hand)[0] };
  };
  decide.fallbacks = 0;
  return decide;
}

/* ============================================================================
   SAVED COMPUTERS

   localStorage, one JSON array. Each saved computer is registered into
   COMPUTERS under a `user:` key, so the runner, the table and the picker in the
   Statistics section pick it up with no special cases anywhere.
   ========================================================================== */
const BUILD_KEY = 'venture-lab-computers';

function buildLoadAll(){
  try {
    const raw = localStorage.getItem(BUILD_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e){ return []; }
}

function buildSaveAll(list){
  try { localStorage.setItem(BUILD_KEY, JSON.stringify(list)); }
  catch (e){ _labFlash('Could not save — browser storage is full or blocked'); }
}

function buildKeyOf(c){ return 'user:' + c.id; }

/* Put every saved computer into COMPUTERS, replacing whatever was there. A
   program that no longer compiles is skipped rather than registered broken —
   it stays in the list to be edited, but it cannot break a run. */
function buildRegisterAll(){
  for (const k of Object.keys(COMPUTERS)) if (k.indexOf('user:') === 0) delete COMPUTERS[k];
  let bad = 0;
  for (const c of buildLoadAll()){
    let decide;
    try { decide = buildCompile(c.code); }
    catch (e){ bad++; continue; }
    COMPUTERS[buildKeyOf(c)] = {
      name: c.name,
      blurb: 'Built in the computer builder. ' + (c.code.split('\n').filter(l => l.trim()).length)
             + ' lines of code — open Build a computer to read or edit it.',
      decide,
      custom: true,
    };
  }
  if (typeof cpuSyncList === 'function') cpuSyncList();
  return bad;
}

/* ============================================================================
   THE PAGE
   ========================================================================== */

const BUILD = { editing: null };      // id of the computer open in the editor

function buildShow(on){
  const sec = document.getElementById('lab-build');
  const stats = document.getElementById('lab-stats');
  const board = document.getElementById('game-screen');
  const deck = document.getElementById('vc-deck');
  const info = document.getElementById('lab-info');
  if (!sec) return;
  sec.style.display = on ? '' : 'none';
  if (on){
    if (stats) stats.style.display = 'none';
    board.style.display = 'none';
    if (deck) deck.style.display = 'none';
    if (info) info.style.display = 'none';
    buildRenderList();
  } else {
    statsShow(true);                  // came from Statistics, so go back to it
  }
}

function buildRenderList(){
  const host = document.getElementById('lab-build-list');
  if (!host) return;
  const list = buildLoadAll();
  if (!list.length){
    host.innerHTML = '<p class="note">No computers yet. Write one on the right and press '
                   + '<b>Save</b> — it joins the list in the Computers section.</p>';
    return;
  }
  host.innerHTML = list.map(c => {
    let err = '';
    try { buildCompile(c.code); }
    catch (e){ err = ' <span class="bad" title="' + String(e.message).replace(/"/g, "'")
                   + '">line ' + e.line + ': ' + e.message + '</span>'; }
    return '<div class="bc-item' + (BUILD.editing === c.id ? ' on' : '') + '">'
         + '<b>' + _buildEsc(c.name) + '</b>' + err
         + '<span class="bc-act">'
         + '<button data-edit="' + c.id + '">Edit</button>'
         + '<button data-del="' + c.id + '" class="danger">Delete</button>'
         + '</span></div>';
  }).join('');
  host.querySelectorAll('[data-edit]').forEach(b => {
    b.onclick = () => buildOpen(b.getAttribute('data-edit'));
  });
  host.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = () => buildDelete(b.getAttribute('data-del'));
  });
}

function _buildEsc(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildOpen(id){
  const c = buildLoadAll().find(x => x.id === id);
  if (!c) return;
  BUILD.editing = c.id;
  document.getElementById('lab-build-name').value = c.name;
  document.getElementById('lab-build-code').value = c.code;
  _buildStatus('Editing “' + c.name + '”.', '');
  buildRenderList();
}

function buildNew(){
  BUILD.editing = null;
  document.getElementById('lab-build-name').value = '';
  document.getElementById('lab-build-code').value = BUILD_EXAMPLE;
  _buildStatus('New computer — the example is Lowest, written out. Change it and save.', '');
  buildRenderList();
}

const BUILD_EXAMPLE = [
  '# Play the card that costs the least potential;',
  '# if nothing can be played, throw away the cheapest.',
  'for card in playable:',
  '    if change in potential min:',
  '        play',
  'for card in hand:',
  '    if change in potential min:',
  '        discard',
].join('\n');

function buildSave(){
  const name = document.getElementById('lab-build-name').value.trim();
  const code = document.getElementById('lab-build-code').value;
  if (!name){ _buildStatus('Give it a name first.', 'bad'); return; }
  try { buildCompile(code); }
  catch (e){ _buildStatus('Line ' + e.line + ': ' + e.message, 'bad'); return; }

  const list = buildLoadAll();
  if (BUILD.editing){
    const i = list.findIndex(c => c.id === BUILD.editing);
    if (i >= 0) list[i] = Object.assign({}, list[i], { name, code });
    else list.push({ id: BUILD.editing, name, code });
  } else {
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    list.push({ id, name, code });
    BUILD.editing = id;
  }
  buildSaveAll(list);
  buildRegisterAll();
  buildRenderList();
  _buildStatus('Saved. “' + name + '” is in the Computers list — the run counts were '
             + 'reset, since every computer has to be measured over the same number of games.', 'ok');
}

function buildDelete(id){
  const list = buildLoadAll();
  const c = list.find(x => x.id === id);
  if (!c) return;
  if (!confirm('Delete “' + c.name + '”?')) return;
  buildSaveAll(list.filter(x => x.id !== id));
  if (BUILD.editing === id) buildNew();
  buildRegisterAll();
  buildRenderList();
  _buildStatus('Deleted “' + c.name + '”.', '');
}

/* Run the code in the editor over a few hundred solitaire games, without saving
   it. The fallback rate is the useful half: it is the share of turns your
   program had nothing to say about, which is how you find out that a rule you
   thought was doing the work never fires. */
function buildTest(){
  const code = document.getElementById('lab-build-code').value;
  let decide;
  try { decide = buildCompile(code); }
  catch (e){ _buildStatus('Line ' + e.line + ': ' + e.message, 'bad'); return; }

  const N = 200;
  const scores = [];
  let turns = 0;
  try {
    for (let i = 0; i < N; i++){
      const r = playSoloGame({ decide });
      scores.push(r.score);
      turns += r.played + r.discarded;
    }
  } catch (e){ _buildStatus('It ran, but the game rejected a move: ' + e.message, 'bad'); return; }

  scores.sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)];
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const fb = 100 * decide.fallbacks / Math.max(1, turns);
  _buildStatus('Over ' + N + ' games: median <b>' + median + '</b>, mean ' + mean.toFixed(1)
    + ', range ' + scores[0] + ' … ' + scores[scores.length - 1] + '. '
    + (decide.fallbacks
        ? 'Your code decided ' + (100 - fb).toFixed(0) + '% of turns; the other '
          + fb.toFixed(0) + '% fell back to "play the lowest legal card".'
        : 'Your code decided every turn.'), 'ok');
}

function _buildStatus(html, cls){
  const el = document.getElementById('lab-build-status');
  if (!el) return;
  el.className = 'bc-status ' + (cls || '');
  el.innerHTML = html;
}

/* ---------------------------------------------------------------- the editor */
/* Python-shaped editing: Enter keeps the current indent and adds one level
   after a line that opens a block, Tab indents, Backspace at the start of a
   line takes a whole level off. Without this you are counting spaces by hand,
   which is exactly the part of Python people get wrong. */
const BUILD_TAB = '    ';

function _buildEditorKeys(ta){
  ta.addEventListener('keydown', e => {
    const s = ta.selectionStart, t = ta.value;

    if (e.key === 'Enter'){
      e.preventDefault();
      const lineStart = t.lastIndexOf('\n', s - 1) + 1;
      const line = t.slice(lineStart, s);
      let indent = (line.match(/^ */) || [''])[0];
      if (/:\s*$/.test(line.split('#')[0])) indent += BUILD_TAB;   // it opens a block
      _buildInsert(ta, '\n' + indent);
      return;
    }

    if (e.key === 'Tab'){
      e.preventDefault();
      if (e.shiftKey){ _buildDedent(ta); return; }
      _buildInsert(ta, BUILD_TAB);
      return;
    }

    if (e.key === 'Backspace' && ta.selectionStart === ta.selectionEnd){
      const lineStart = t.lastIndexOf('\n', s - 1) + 1;
      const before = t.slice(lineStart, s);
      if (before.length >= BUILD_TAB.length && /^ +$/.test(before)){
        e.preventDefault();                              // eat a whole indent level
        ta.value = t.slice(0, s - BUILD_TAB.length) + t.slice(s);
        ta.selectionStart = ta.selectionEnd = s - BUILD_TAB.length;
      }
    }
  });
}

function _buildInsert(ta, text){
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
  ta.selectionStart = ta.selectionEnd = s + text.length;
}

function _buildDedent(ta){
  const s = ta.selectionStart, t = ta.value;
  const lineStart = t.lastIndexOf('\n', s - 1) + 1;
  const cut = Math.min(BUILD_TAB.length, (t.slice(lineStart).match(/^ */) || [''])[0].length);
  if (!cut) return;
  ta.value = t.slice(0, lineStart) + t.slice(lineStart + cut);
  ta.selectionStart = ta.selectionEnd = Math.max(lineStart, s - cut);
}

/* ------------------------------------------------------------------ reference */
function _buildReference(){
  const val = _VALUE_NAMES.slice().sort().map(n =>
    '<dt>' + n + '</dt><dd>' + BUILD_VALUES[n].doc + '</dd>').join('');
  return ''
    + '<h3>Commands</h3><dl>'
    + '<dt>play</dt><dd>play the card the set has narrowed to, and end the turn. '
    + 'Skipped if none of the set can legally be played.</dd>'
    + '<dt>discard</dt><dd>throw it away, and end the turn.</dd>'
    + '</dl>'
    + '<h3>Structure</h3><dl>'
    + '<dt>for card in hand:</dt><dd>start from every card you hold. '
    + '<code>for card in playable:</code> starts from the legal ones only.</dd>'
    + '<dt>if … : / elif … : / else:</dt><dd>narrow the set. Whatever fails the test '
    + 'is what <code>elif</code> and <code>else</code> get to work with.</dd>'
    + '<dt>&lt;value&gt; min / max</dt><dd>keep the single best card of the set.</dd>'
    + '<dt>random</dt><dd>keep one card of the set at random.</dd>'
    + '<dt>and / or</dt><dd>join comparisons. Left to right, no brackets — and never '
    + 'with min/max/random, which choose from the whole set.</dd>'
    + '</dl>'
    + '<h3>Values</h3><dl>' + val + '</dl>'
    + '<h3>Notes</h3><ul>'
    + '<li>Indent with 4 spaces — Enter indents for you after a line ending in <code>:</code>.</li>'
    + '<li><code># after a hash</code> is a comment.</li>'
    + '<li>Values that belong to a card only work inside a <code>for</code> loop.</li>'
    + '<li>If your code reaches the end without a play or discard, the plainest legal '
    + 'move is taken and counted — <b>Test</b> shows you how often that happened.</li>'
    + '</ul>';
}

function _buildInit(){
  const sec = document.getElementById('lab-build');
  if (!sec) return;
  document.getElementById('lab-build-ref').innerHTML = _buildReference();
  _buildEditorKeys(document.getElementById('lab-build-code'));
  document.getElementById('lab-build-back').onclick  = () => { SFX.select(); buildShow(false); };
  document.getElementById('lab-build-new').onclick   = () => { SFX.select(); buildNew(); };
  document.getElementById('lab-build-save').onclick  = () => { SFX.select(); buildSave(); };
  document.getElementById('lab-build-test').onclick  = () => { SFX.select(); buildTest(); };
  const open = document.getElementById('lab-cpu-build');
  if (open) open.onclick = () => { SFX.select(); buildShow(true); };
  buildNew();
  const bad = buildRegisterAll();
  if (bad) _buildStatus(bad + ' saved computer(s) no longer compile and were left out of the '
    + 'Computers list. Open one to fix it.', 'bad');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _buildInit);
else _buildInit();
