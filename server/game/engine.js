'use strict';
const crypto = require('crypto');
const {
  SUITS, SUIT_SYMBOL, RANKS, CARD_VALUE, QUEEN_OF_SPADES, KING_OF_SPADES,
  HAND_BONUS, FINISH_BONUS, CHAIN, KING_OF_SPADES_DRAW, HAND_SIZE,
  MIN_PLAYERS, MAX_PLAYERS, LIMIT, STATUS,
} = require('./constants');

class GameError extends Error {}

const label = (c) => `${c.rank}${SUIT_SYMBOL[c.suit]}`;
const isKingOfSpades = (c) => c.id === KING_OF_SPADES;

function randomInt(n) {
  return crypto.randomInt(n);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ id: `${rank}_${suit}`, rank, suit });
  return shuffle(deck);
}

// Разбор оставшихся на руке карт для экрана результатов (п. 17–19)
function scoreHand(hand) {
  const cards = hand.map((c) => ({ ...c, value: CARD_VALUE[c.rank], bonus: HAND_BONUS[c.id] || 0 }));
  const total = cards.reduce((s, c) => s + c.value + c.bonus, 0);
  return { cards, total };
}

// Правило 107/108 и выбывание (п. 21, 23)
function applyLimit(score) {
  if (score === LIMIT) return { score: 0, note: 'RESET_108' };
  if (score === LIMIT - 1) return { score: 54, note: 'HALF_107' };
  if (score > LIMIT) return { score, note: 'ELIMINATED' };
  return { score, note: null };
}

class Game {
  constructor({ rng } = {}) {
    if (rng) this.random = rng;
    this.players = [];
    this.status = STATUS.WAITING;
    this.round = 0;
    this.history = [];
    this.lastResult = null;
    this.winnerId = null;
    this.log = [];
    this.version = 0;
    this.resetRound();
  }

  random(n) {
    return randomInt(n);
  }

  resetRound() {
    this.drawPile = [];
    this.discardPile = [];
    this.currentIdx = 0;
    this.starterIdx = -1;
    this.activeEffect = null; // { type: 'SIX'|'SEVEN', count } | { type: 'EIGHT', suit }
    this.requiredSuit = null; // масть, заказанная дамой
    this.drawnCardId = null;  // карта, взятая обычным добором: только её можно сыграть
  }

  // ─────────────── игроки ───────────────

  addPlayer({ id, name, isBot = false }) {
    if (this.status !== STATUS.WAITING) throw new GameError('Игра уже идёт');
    if (this.players.some((p) => p.id === id)) return;
    if (this.players.length >= MAX_PLAYERS) throw new GameError('Комната заполнена');
    this.players.push({
      id, name, isBot, auto: isBot,
      score: 0, eliminated: false, hand: [], lastAction: null,
    });
    this.touch();
  }

  removePlayer(id) {
    if (this.status !== STATUS.WAITING) throw new GameError('Нельзя удалить игрока во время игры');
    this.players = this.players.filter((p) => p.id !== id);
    this.touch();
  }

  // Игрок покинул идущую игру — дальше за него ходит автопилот
  setAuto(id, auto) {
    const p = this.players.find((x) => x.id === id);
    if (p) { p.auto = auto; this.touch(); }
  }

  indexOf(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) throw new GameError('Вы не участвуете в этой игре');
    return i;
  }

  active() {
    return this.players.filter((p) => !p.eliminated);
  }

  // Следующий активный игрок по часовой стрелке (п. 6)
  nextIdx(i) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (!this.players[j].eliminated) return j;
    }
    return i;
  }

  get current() {
    return this.players[this.currentIdx];
  }

  top() {
    return this.discardPile[this.discardPile.length - 1] || null;
  }

  say(text, kind = 'info') {
    this.log.push({ id: this.version + '_' + this.log.length, text, kind });
    if (this.log.length > 80) this.log.splice(0, this.log.length - 80);
  }

  touch() {
    this.version++;
  }

  // ─────────────── жизненный цикл ───────────────

  start() {
    if (this.status !== STATUS.WAITING) throw new GameError('Игра уже идёт');
    if (this.players.length < MIN_PLAYERS) throw new GameError(`Нужно минимум ${MIN_PLAYERS} игрока`);
    this.startRound();
  }

  // Кто получает 3 карты и ходит первым (п. 4)
  pickStarter() {
    const activeIdx = this.players.map((_, i) => i).filter((i) => !this.players[i].eliminated);
    if (!this.lastResult) return activeIdx[this.random(activeIdx.length)];
    const pts = new Map(this.lastResult.rows.map((r) => [r.id, r.roundPoints]));
    const max = Math.max(...activeIdx.map((i) => pts.get(this.players[i].id) ?? -Infinity));
    const top = activeIdx.filter((i) => (pts.get(this.players[i].id) ?? -Infinity) === max);
    return top[this.random(top.length)];
  }

  startRound() {
    this.resetRound();
    this.round++;
    this.status = STATUS.PLAYING;
    this.drawPile = createDeck();
    for (const p of this.players) { p.hand = []; p.lastAction = null; }

    this.starterIdx = this.pickStarter();
    for (const p of this.active()) {
      const n = p === this.players[this.starterIdx] ? HAND_SIZE - 1 : HAND_SIZE;
      for (let k = 0; k < n; k++) p.hand.push(this.drawPile.pop());
    }
    this.lastResult = null;
    this.currentIdx = this.starterIdx;
    this.say(`Раунд ${this.round}. ${this.current.name} получает 3 карты и ходит первым`, 'round');

    // Стартовая карта (п. 5): её эффект сразу действует на первого игрока
    const start = this.drawPile.pop();
    this.discardPile.push(start);
    this.say(`Стартовая карта: ${label(start)}`);
    this.applyStartCard(start);
    this.resolveForced();
    this.touch();
  }

  applyStartCard(card) {
    const first = this.currentIdx;
    if (CHAIN[card.rank]) {
      const { type, per } = CHAIN[card.rank];
      this.activeEffect = { type, count: per };
    } else if (card.rank === '8') {
      this.activeEffect = { type: 'EIGHT', suit: card.suit };
      this.say(`${this.current.name} закрывает восьмёрку по ${SUIT_SYMBOL[card.suit]}`);
    } else if (card.rank === 'Q') {
      this.requiredSuit = card.suit;
    } else if (card.rank === 'A') {
      this.say(`${this.players[first].name} пропускает ход`, 'effect');
      this.currentIdx = this.nextIdx(first);
    } else if (isKingOfSpades(card)) {
      const got = this.drawCards(first, KING_OF_SPADES_DRAW);
      this.say(`${this.players[first].name} берёт ${got} и пропускает ход`, 'effect');
      this.currentIdx = this.nextIdx(first);
    }
  }

  nextRound() {
    if (this.status !== STATUS.ROUND_FINISHED) throw new GameError('Раунд ещё не закончен');
    this.startRound();
  }

  // «Играть снова» — те же игроки, счёт с нуля
  restart() {
    if (this.status !== STATUS.GAME_FINISHED) throw new GameError('Игра ещё не закончена');
    this.resetScores();
    this.startRound();
  }

  backToLobby() {
    this.resetScores();
    this.status = STATUS.WAITING;
    this.touch();
  }

  resetScores() {
    for (const p of this.players) {
      p.score = 0; p.eliminated = false; p.hand = []; p.lastAction = null;
    }
    this.round = 0;
    this.history = [];
    this.lastResult = null;
    this.winnerId = null;
    this.log = [];
    this.resetRound();
  }

  // ─────────────── правила хода ───────────────

  canPlay(card) {
    if (this.drawnCardId && card.id !== this.drawnCardId) return false;
    const e = this.activeEffect;
    if (e && e.type === 'SIX') return card.rank === '6';
    if (e && e.type === 'SEVEN') return card.rank === '7';
    if (e && e.type === 'EIGHT') return card.suit === e.suit || card.rank === '8' || card.rank === 'Q';
    if (card.rank === 'Q') return true;
    if (this.requiredSuit) return card.suit === this.requiredSuit;
    const t = this.top();
    return card.rank === t.rank || card.suit === t.suit;
  }

  // Колода добора кончилась — перемешиваем сброс, кроме верхней карты (п. 25)
  drawOne(i) {
    if (this.drawPile.length === 0 && this.discardPile.length > 1) {
      const top = this.discardPile.pop();
      this.drawPile = shuffle(this.discardPile);
      this.discardPile = [top];
      this.say('Сброс перемешан в новую колоду', 'system');
    }
    const c = this.drawPile.pop();
    if (!c) return null;
    this.players[i].hand.push(c);
    return c;
  }

  drawCards(i, n) {
    let got = 0;
    for (let k = 0; k < n; k++) if (this.drawOne(i)) got++;
    return got;
  }

  assertTurn(id, version) {
    if (this.status !== STATUS.PLAYING) throw new GameError('Сейчас нельзя ходить');
    // Защита от двойного хода: действие должно относиться к актуальному состоянию
    if (version != null && version !== this.version) throw new GameError('Состояние обновилось, повторите действие');
    const i = this.indexOf(id);
    if (i !== this.currentIdx) throw new GameError('Сейчас не ваш ход');
    return i;
  }

  playCard(id, cardId, suit, version) {
    const i = this.assertTurn(id, version);
    const p = this.players[i];
    const hi = p.hand.findIndex((c) => c.id === cardId);
    if (hi < 0) throw new GameError('У вас нет такой карты');
    const card = p.hand[hi];
    if (!this.canPlay(card)) throw new GameError('Эту карту сейчас нельзя положить');
    const isLast = p.hand.length === 1;
    if (card.rank === 'Q' && !isLast && !SUITS.includes(suit)) throw new GameError('Выберите масть');

    const prev = this.activeEffect;
    p.hand.splice(hi, 1);
    p.lastAction = 'play';
    this.discardPile.push(card);
    this.drawnCardId = null;
    this.activeEffect = null;
    this.requiredSuit = null;
    const next = this.nextIdx(i);

    // Последняя карта — раунд заканчивается сразу (п. 16)
    if (isLast) {
      this.say(`${p.name}: ${label(card)} — последняя карта!`, 'play');
      let penalty = 0;
      if (CHAIN[card.rank]) penalty = this.chainCount(card, prev);
      else if (isKingOfSpades(card)) penalty = KING_OF_SPADES_DRAW;
      if (penalty) {
        const got = this.drawCards(next, penalty);
        this.say(`${this.players[next].name} всё равно берёт ${got}`, 'effect');
      }
      this.endRound(i, card);
      this.touch();
      return;
    }

    if (card.rank === '8') {
      this.activeEffect = { type: 'EIGHT', suit: card.suit };
      this.say(`${p.name}: ${label(card)} — закрывает по ${SUIT_SYMBOL[card.suit]}`, 'play');
    } else if (card.rank === 'Q') {
      this.requiredSuit = suit;
      this.say(`${p.name}: ${label(card)} — заказывает ${SUIT_SYMBOL[suit]}`, 'play');
      this.currentIdx = next;
    } else if (CHAIN[card.rank]) {
      const count = this.chainCount(card, prev);
      this.activeEffect = { type: CHAIN[card.rank].type, count };
      this.say(`${p.name}: ${label(card)} — следующий берёт ${count}`, 'play');
      this.currentIdx = next;
    } else if (isKingOfSpades(card)) {
      const got = this.drawCards(next, KING_OF_SPADES_DRAW);
      this.players[next].lastAction = 'take';
      this.say(`${p.name}: ${label(card)} — ${this.players[next].name} берёт ${got} и пропускает ход`, 'play');
      this.currentIdx = this.nextIdx(next);
    } else if (card.rank === 'A') {
      this.say(`${p.name}: ${label(card)} — ${this.players[next].name} пропускает ход`, 'play');
      this.currentIdx = this.nextIdx(next);
    } else {
      this.say(`${p.name}: ${label(card)}`, 'play');
      this.currentIdx = next;
    }

    this.resolveForced();
    this.touch();
  }

  chainCount(card, prev) {
    const { type, per } = CHAIN[card.rank];
    return (prev && prev.type === type ? prev.count : 0) + per;
  }

  // Если у игрока нет карты, чтобы продолжить цепочку 6/7, он берёт автоматически
  resolveForced() {
    const e = this.activeEffect;
    if (!e || (e.type !== 'SIX' && e.type !== 'SEVEN')) return;
    const rank = e.type === 'SIX' ? '6' : '7';
    if (!this.current.hand.some((c) => c.rank === rank)) this.takeChain();
  }

  takeChain() {
    const { count } = this.activeEffect;
    const got = this.drawCards(this.currentIdx, count);
    this.current.lastAction = 'take';
    this.say(`${this.current.name} берёт ${got} и пропускает ход`, 'effect');
    this.activeEffect = null; // дальше играют по масти последней 6/7
    this.currentIdx = this.nextIdx(this.currentIdx);
  }

  // Взять штрафные карты цепочки 6/7 вместо того, чтобы отбиться
  takePenalty(id, version) {
    this.assertTurn(id, version);
    const e = this.activeEffect;
    if (!e || (e.type !== 'SIX' && e.type !== 'SEVEN')) throw new GameError('Нечего брать');
    this.takeChain();
    this.touch();
  }

  drawCard(id, version) {
    const i = this.assertTurn(id, version);
    const p = this.players[i];
    const e = this.activeEffect;

    if (e && (e.type === 'SIX' || e.type === 'SEVEN')) {
      this.takeChain();
      this.touch();
      return;
    }

    // Восьмёрка (п. 12.4): добираем, пока не придёт нужная масть; на даме или восьмёрке
    // останавливаемся — игрок сам решает, сыграть её или брать дальше
    if (e && e.type === 'EIGHT') {
      if (p.hand.some((c) => c.suit === e.suit)) throw new GameError(`У вас есть ${SUIT_SYMBOL[e.suit]} — закройте восьмёрку`);
      let n = 0;
      let c;
      while ((c = this.drawOne(i))) {
        n++;
        if (c.suit === e.suit || c.rank === 'Q' || c.rank === '8') break;
      }
      p.lastAction = 'draw';
      if (!c) {
        this.say(`${p.name} берёт ${n}, колода пуста — ход переходит`, 'effect');
        this.activeEffect = null;
        this.currentIdx = this.nextIdx(i);
      } else {
        this.say(`${p.name} добирает ${n} ${plural(n, 'карту', 'карты', 'карт')} до ${SUIT_SYMBOL[e.suit]}`, 'draw');
      }
      this.touch();
      return;
    }

    // Обычный или добровольный добор (п. 8–9)
    if (this.drawnCardId) throw new GameError('Вы уже взяли карту');
    const c = this.drawOne(i);
    p.lastAction = 'draw';
    if (!c) {
      this.say(`${p.name}: колода пуста, ход переходит`, 'draw');
      this.currentIdx = this.nextIdx(i);
    } else if (this.canPlay(c)) {
      this.drawnCardId = c.id;
      this.say(`${p.name} берёт карту`, 'draw');
    } else {
      this.say(`${p.name} берёт карту и пропускает`, 'draw');
      this.currentIdx = this.nextIdx(i);
    }
    this.touch();
  }

  // Не играть взятую подходящую карту
  pass(id, version) {
    const i = this.assertTurn(id, version);
    if (!this.drawnCardId) throw new GameError('Пасовать можно только после добора');
    this.drawnCardId = null;
    this.say(`${this.players[i].name}: пас`, 'draw');
    this.currentIdx = this.nextIdx(i);
    this.touch();
  }

  // ─────────────── подсчёт (п. 17–24) ───────────────

  endRound(winnerIdx, lastCard) {
    const winner = this.players[winnerIdx];
    const rows = [];
    for (const p of this.players) {
      if (p.eliminated) continue;
      const isWinner = p === winner;
      const { cards, total } = scoreHand(p.hand);
      const finishBonus = isWinner ? FINISH_BONUS[lastCard.id] || 0 : 0;
      const roundPoints = isWinner ? finishBonus : total;
      const before = p.score;
      const { score, note } = applyLimit(before + roundPoints);
      p.score = score;
      if (note === 'ELIMINATED') p.eliminated = true;
      rows.push({ id: p.id, name: p.name, isWinner, cards, finishBonus, roundPoints, before, raw: before + roundPoints, after: score, note });
    }

    this.lastResult = { round: this.round, winnerId: winner.id, lastCard, rows };
    this.history.push({ round: this.round, winnerId: winner.id, points: Object.fromEntries(rows.map((r) => [r.id, { pts: r.roundPoints, total: r.after, note: r.note }])) });
    this.say(`Раунд ${this.round}: без карт — ${winner.name}`, 'round');
    for (const r of rows) if (r.note === 'ELIMINATED') this.say(`${r.name}: ${r.after} очков — выбывает`, 'elim');

    this.activeEffect = null;
    this.requiredSuit = null;
    this.drawnCardId = null;

    const alive = this.active();
    if (alive.length <= 1) {
      const champ = alive[0] || winner;
      this.winnerId = champ.id;
      this.status = STATUS.GAME_FINISHED;
      this.say(`Игра окончена. Победитель — ${champ.name}!`, 'round');
    } else {
      this.status = STATUS.ROUND_FINISHED;
    }
  }

  // ─────────────── представление для клиента ───────────────

  // Каждый игрок видит только свои карты; всё «вычисляемое» (чей ход, что можно
  // положить, что делать) сервер отдаёт готовым — клиент ничего не решает сам
  view(forId) {
    const me = this.players.findIndex((p) => p.id === forId);
    const playing = this.status === STATUS.PLAYING;
    const myTurn = playing && me === this.currentIdx;
    const hand = me >= 0 ? sortHand(this.players[me].hand) : [];
    const e = this.activeEffect;
    const chain = e && (e.type === 'SIX' || e.type === 'SEVEN');
    const hasEightSuit = e && e.type === 'EIGHT' && hand.some((c) => c.suit === e.suit);

    return {
      version: this.version,
      status: this.status,
      round: this.round,
      direction: 'CLOCKWISE',
      players: this.players.map((p, i) => ({
        id: p.id, name: p.name, isBot: p.isBot, auto: p.auto,
        score: p.score, eliminated: p.eliminated, cardCount: p.hand.length,
        isCurrent: playing && i === this.currentIdx,
        isStarter: i === this.starterIdx,
        lastAction: p.lastAction,
      })),
      currentPlayerId: playing ? this.current.id : null,
      hand,
      topCard: this.top(),
      previousCards: this.discardPile.slice(-3, -1), // две карты под верхней, старшая первой
      drawPileCount: this.drawPile.length,
      discardCount: this.discardPile.length,
      activeEffect: e,
      requiredSuit: this.requiredSuit,
      drawnCardId: myTurn ? this.drawnCardId : null,
      playable: myTurn ? hand.filter((c) => this.canPlay(c)).map((c) => c.id) : [],
      actions: {
        draw: myTurn && !chain && !this.drawnCardId && !hasEightSuit,
        take: myTurn && !!chain,
        pass: myTurn && !!this.drawnCardId,
      },
      lastResult: this.lastResult,
      history: this.history,
      winnerId: this.winnerId,
      log: this.log.slice(-30),
    };
  }
}

function sortHand(hand) {
  const so = { spades: 0, clubs: 1, diamonds: 2, hearts: 3 };
  return [...hand].sort((a, b) => so[a.suit] - so[b.suit] || RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

module.exports = { Game, GameError, createDeck, scoreHand, applyLimit, QUEEN_OF_SPADES };
