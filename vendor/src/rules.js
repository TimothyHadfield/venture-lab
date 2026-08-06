// rules.js — Card legality checks and deck construction.
// Pure functions. Reads CONFIG only.

function canPlayOnPlayPile(card, playPile) {
  if (!playPile || playPile.length === 0) return true;
  const top = playPile[playPile.length - 1];
  if (card.value === 0) return top.value === 0;
  return card.value > top.value;
}

function allCards() {
  const cards = [];
  for (const c of CONFIG.colors) {
    for (let i = 0; i < CONFIG.wagerCount; i++)
      cards.push({ color: c, value: 0, id: c + '_w' + i });
    for (let v = CONFIG.numberRange[0]; v <= CONFIG.numberRange[1]; v++)
      cards.push({ color: c, value: v, id: c + '_' + v });
  }
  return cards;
}

function createDrawPile() {
  const drawPile = allCards();
  for (let i = drawPile.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [drawPile[i], drawPile[j]] = [drawPile[j], drawPile[i]];
  }
  return drawPile;
}

const RULES = { canPlayOnPlayPile, createDrawPile, allCards };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RULES;
}
