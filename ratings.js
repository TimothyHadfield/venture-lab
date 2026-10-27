"use strict";
/* Elo of each Play-mode opponent, for My stats. Measured, not guessed:
   `node test/rate_levels.js 200` (fair view, every pairing on the same deals
   with seats swapped, Bradley-Terry fit, Solid = 1200). Re-run and paste when a
   computer changes. A computer written in the builder is not listed = unrated. */
const PLAY_RATINGS = [
  { id: 'cpu:lowest', name: 'Lowest', rating: 1303 },
  { id: 'cpu:lowest3', name: 'Lowest 3+', rating: 1271 },
  { id: 'cpu:patient', name: 'The Patient', rating: 1262 },
  { id: 'cpu:broker', name: 'The Broker', rating: 1249 },
  { id: 'cpu:wageropen4', name: 'Wager Open 4', rating: 1210 },
  { id: 'solid', name: 'Solid', rating: 1200 },
  { id: 'sharp', name: 'Sharp', rating: 1154 },
  { id: 'cpu:wageropen', name: 'Wager Open', rating: 1143 },
  { id: 'cpu:random', name: 'Random', rating: 1032 },
  { id: 'casual', name: 'Casual', rating: 967 },
];
