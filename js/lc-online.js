/* lc-online.js — Lost Cities (Venture) for the shared online kit (js/online.js).
 *
 * The kit runs this on the host's phone: setup / toAct / apply / publicView /
 * privateView / bot / isOver (see Board and Card Games/_online/README.md). Same
 * 60 cards, ids and rules as the vendored client (vendor/src/rules.js, math.js,
 * engine.js); test/online_check.js holds it to them.
 *
 * Secrets: the room (publicView) holds the piles, the discards and COUNTS only.
 * Each hand lives in that player's private doc; the deck order stays on the host.
 *
 * A turn is two moves, like the board: play or discard a card, then draw.
 *   { t:'play', id }  { t:'discard', id }  { t:'draw', from:'deck' | <colour> }
 *
 * Plain script: window.LCOnline in the browser, module.exports in node.
 */
(function (root) {
  'use strict';
  var COLORS = ['red', 'green', 'blue', 'white', 'yellow'];   // == CONFIG.colors
  var WAGERS = 3, LOW = 2, HIGH = 10, HAND = 8;              // == CONFIG wagerCount, numberRange, handSize
  var BASE = 20, BONUS_AT = 8, BONUS = 20;                   // == CONFIG.scoring

  function allCards() {
    var out = [];
    COLORS.forEach(function (c) {
      for (var i = 0; i < WAGERS; i++) out.push({ color: c, value: 0, id: c + '_w' + i });
      for (var v = LOW; v <= HIGH; v++) out.push({ color: c, value: v, id: c + '_' + v });
    });
    return out;
  }
  function canPlay(card, pile) {                              // == RULES.canPlayOnPlayPile
    if (!pile || !pile.length) return true;
    var top = pile[pile.length - 1];
    if (card.value === 0) return top.value === 0;
    return card.value > top.value;
  }
  function pileScore(cards) {                                 // == MATH.scorePlayPile
    if (!cards || !cards.length) return 0;
    var w = 0, sum = 0;
    cards.forEach(function (c) { if (c.value === 0) w++; else sum += c.value; });
    return (sum - BASE) * (1 + w) + (cards.length >= BONUS_AT ? BONUS : 0);
  }
  function score(piles) { return COLORS.reduce(function (t, c) { return t + pileScore(piles[c]); }, 0); }
  function emptyPiles() { var o = {}; COLORS.forEach(function (c) { o[c] = []; }); return o; }

  var game = {
    id: 'lost-cities',
    minSeats: 2, maxSeats: 2,
    COLORS: COLORS,

    setup: function (n, options, rng, seats) {
      var deck = allCards();
      for (var i = deck.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
      var h0 = deck.splice(0, HAND), h1 = deck.splice(0, HAND);
      var first = options && (options.first === 0 || options.first === 1) ? options.first : (rng() < 0.5 ? 0 : 1);
      return {
        deck: deck, hands: [h0, h1], piles: [emptyPiles(), emptyPiles()], discards: emptyPiles(),
        turn: first, phase: 'play', lastDiscard: null, move: 0, over: false, scores: null, last: null,
        names: (seats || []).map(function (s) { return (s && s.name) || ''; }),
      };
    },

    toAct: function (s) { return s.over ? [] : [s.turn]; },

    apply: function (s, seat, a) {
      if (s.over) throw new Error('The game is over.');
      if (seat !== s.turn) throw new Error('Not your turn.');
      a = a || {};
      if (s.phase === 'play') {
        if (a.t !== 'play' && a.t !== 'discard') throw new Error('Play or discard a card first.');
        var hand = s.hands[seat], k = -1;
        for (var i = 0; i < hand.length; i++) if (hand[i].id === a.id) k = i;
        if (k < 0) throw new Error('That card is not in your hand.');
        var card = hand[k];
        if (a.t === 'play') {
          if (!canPlay(card, s.piles[seat][card.color])) throw new Error('Must be higher than top card');
          hand.splice(k, 1);
          s.piles[seat][card.color].push(card);
          s.lastDiscard = null;
        } else {
          hand.splice(k, 1);
          s.discards[card.color].push(card);
          s.lastDiscard = card.color;
        }
        s.phase = 'draw';
        s.last = { seat: seat, t: a.t, card: card };
      } else {
        if (a.t !== 'draw') throw new Error('Draw a card.');
        var got;
        if (a.from === 'deck') {
          if (!s.deck.length) throw new Error('The deck is empty.');
          got = s.deck.pop();
        } else {
          var pile = s.discards[a.from];
          if (!pile || !pile.length) throw new Error('That pile is empty.');
          if (a.from === s.lastDiscard) throw new Error("Can't draw from the pile you just discarded to");
          got = pile.pop();
        }
        s.hands[seat].push(got);
        s.last = { seat: seat, t: 'draw', from: a.from === 'deck' ? 'deck' : a.from, card: a.from === 'deck' ? null : got, play: s.last && s.last.seat === seat ? s.last : null };
        s.turn = 1 - seat;
        s.phase = 'play';
        s.lastDiscard = null;
        if (!s.deck.length) { s.over = true; s.scores = [score(s.piles[0]), score(s.piles[1])]; }
      }
      s.move++;
      return s;
    },

    publicView: function (s) {
      return {
        piles: s.piles, discards: s.discards, deckCount: s.deck.length,
        handCounts: [s.hands[0].length, s.hands[1].length],
        turn: s.turn, phase: s.phase, lastDiscard: s.lastDiscard, move: s.move,
        over: s.over, scores: s.scores, last: s.last,
      };
    },

    privateView: function (s, seat) { return { hand: s.hands[seat] || [] }; },

    // Plays a seat whose owner left. Fair: only the table and its own hand.
    // Plain rules: continue a started venture with a small step, start one when
    // the hand holds 20+ of that colour, otherwise throw away the least useful card.
    bot: function (ctx, seat) {
      var pub = ctx.pub, hand = (ctx.mine && ctx.mine.hand) || [], mine = pub.piles[seat];
      if (pub.phase === 'draw') {
        for (var c = 0; c < COLORS.length; c++) {
          var col = COLORS[c], d = pub.discards[col];
          if (!d.length || col === pub.lastDiscard) continue;
          var top = d[d.length - 1], p = mine[col];
          if (p.length && canPlay(top, p) && top.value - (p[p.length - 1].value || 0) <= 2) return { t: 'draw', from: col };
        }
        return { t: 'draw', from: 'deck' };
      }
      var best = null, gap = 99;
      hand.forEach(function (card) {
        var p = mine[card.color];
        if (!p.length || !canPlay(card, p)) return;
        var g = card.value - (p[p.length - 1].value || 0);
        if (g < gap) { gap = g; best = card; }
      });
      if (best && gap <= 3) return { t: 'play', id: best.id };
      var sums = {};
      hand.forEach(function (card) { sums[card.color] = (sums[card.color] || 0) + (card.value || 4); });
      var start = null;
      COLORS.forEach(function (col) { if (!mine[col].length && sums[col] >= 20 && (!start || sums[col] > sums[start])) start = col; });
      if (start && pub.deckCount > 12) {
        var low = hand.filter(function (card) { return card.color === start; }).sort(function (a, b) { return a.value - b.value; })[0];
        return { t: 'play', id: low.id };
      }
      if (best) return { t: 'play', id: best.id };
      // throw away: a card that can never go on its pile first, else the colour you hold least of
      var dead = hand.filter(function (card) { var p = mine[card.color]; return p.length && !canPlay(card, p); });
      if (dead.length) return { t: 'discard', id: dead[0].id };
      var pick = hand.slice().sort(function (a, b) { return (sums[a.color] - sums[b.color]) || (a.value - b.value); })[0];
      return { t: 'discard', id: pick.id };
    },

    isOver: function (s) { return !!s.over; },
  };

  var api = { game: game, allCards: allCards, score: score };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LCOnline = api;
})(typeof window !== 'undefined' ? window : this);
