'use strict';

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const SUIT_SYMBOL = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Стоимость карт, оставшихся на руках (п. 17)
const CARD_VALUE = { '6': 6, '7': 7, '8': 8, '9': 0, '10': 10, J: 2, Q: 3, K: 4, A: 11 };

// Специальные карты (п. 18–19): бонус, если осталась на руках / вычет, если ею закончили раунд
const QUEEN_OF_SPADES = 'Q_spades';
const KING_OF_SPADES = 'K_spades';
const HAND_BONUS = { [QUEEN_OF_SPADES]: 20, [KING_OF_SPADES]: 40 };
const FINISH_BONUS = { [QUEEN_OF_SPADES]: -20, [KING_OF_SPADES]: -40 };

// Цепочки 6 и 7 (п. 10–11): сколько карт добавляет каждая карта цепочки
const CHAIN = { '6': { type: 'SIX', per: 2 }, '7': { type: 'SEVEN', per: 1 } };

const KING_OF_SPADES_DRAW = 4;
const HAND_SIZE = 4;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const LIMIT = 108;

const STATUS = {
  WAITING: 'WAITING',
  STARTING: 'STARTING',
  PLAYING: 'PLAYING',
  ROUND_FINISHED: 'ROUND_FINISHED',
  GAME_FINISHED: 'GAME_FINISHED',
};

module.exports = {
  SUITS, SUIT_SYMBOL, RANKS, CARD_VALUE,
  QUEEN_OF_SPADES, KING_OF_SPADES, HAND_BONUS, FINISH_BONUS,
  CHAIN, KING_OF_SPADES_DRAW, HAND_SIZE, MIN_PLAYERS, MAX_PLAYERS, LIMIT, STATUS,
};
