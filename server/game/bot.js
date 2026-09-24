'use strict';
const { CARD_VALUE, HAND_BONUS } = require('./constants');

// Простой автопилот: для ботов и для игроков, которые вышли/отключились.
// Возвращает действие в том же формате, что присылает клиент.
function botAction(game) {
  const p = game.current;
  const e = game.activeEffect;
  const playable = p.hand.filter((c) => game.canPlay(c));

  if (e && (e.type === 'SIX' || e.type === 'SEVEN')) {
    return playable[0] ? { action: 'PLAY_CARD', cardId: playable[0].id } : { action: 'TAKE_PENALTY' };
  }

  if (playable.length === 0) {
    return game.drawnCardId ? { action: 'PASS' } : { action: 'DRAW_CARD' };
  }

  const others = (c) => p.hand.filter((x) => x !== c);
  const weight = (c) => {
    if (p.hand.length === 1) return 1000;
    if (c.id === 'K_spades') return 200;
    if (c.id === 'Q_spades') return 150; // избавиться от +20 на руке
    if (c.rank === 'Q') return -100;     // универсальную даму бережём
    if (c.rank === '8') return others(c).some((x) => x.suit === c.suit) ? 60 : -60;
    if (c.rank === '6' || c.rank === '7' || c.rank === 'A') return 50 + CARD_VALUE[c.rank];
    return CARD_VALUE[c.rank] + (HAND_BONUS[c.id] || 0);
  };
  const best = playable.sort((a, b) => weight(b) - weight(a))[0];
  const move = { action: 'PLAY_CARD', cardId: best.id };
  if (best.rank === 'Q') move.suit = favouriteSuit(others(best)) || best.suit;
  return move;
}

function favouriteSuit(cards) {
  const count = {};
  for (const c of cards) count[c.suit] = (count[c.suit] || 0) + 1;
  return Object.keys(count).sort((a, b) => count[b] - count[a])[0];
}

module.exports = { botAction };
