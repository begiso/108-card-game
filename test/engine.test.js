'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, createDeck } = require('../server/game/engine');
const { botAction } = require('../server/game/bot');

const SUIT = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };
// c('10h') → { id: '10_hearts', rank: '10', suit: 'hearts' }
const c = (s) => {
  const rank = s.slice(0, -1), suit = SUIT[s.slice(-1)];
  return { id: `${rank}_${suit}`, rank, suit };
};

// Детерминированная раскладка: руки, верхняя карта, колода добора (снизу вверх — pop берёт последнюю)
function rig({ hands, top, pile, current = 0 }) {
  const g = new Game();
  hands.forEach((_, i) => g.addPlayer({ id: 'p' + i, name: 'P' + i }));
  g.status = 'PLAYING';
  g.round = 1;
  g.players.forEach((p, i) => { p.hand = hands[i].map(c); });
  g.discardPile = [c(top)];
  const used = new Set([top, ...hands.flat(), ...(pile || [])].map((x) => c(x).id));
  g.drawPile = pile ? pile.map(c) : createDeck().filter((x) => !used.has(x.id));
  g.currentIdx = current;
  g.starterIdx = 0;
  return g;
}
const ids = (hand) => hand.map((x) => x.id).sort();

test('колода: 36 уникальных карт', () => {
  const d = createDeck();
  assert.equal(d.length, 36);
  assert.equal(new Set(d.map((x) => x.id)).size, 36);
});

test('раздача: первому 3 карты, остальным 4, стартовая карта на столе', () => {
  for (let k = 0; k < 50; k++) {
    const g = new Game();
    for (let i = 0; i < 4; i++) g.addPlayer({ id: 'p' + i, name: 'P' + i });
    g.start();
    const total = g.players.reduce((s, p) => s + p.hand.length, 0) + g.drawPile.length + g.discardPile.length;
    assert.equal(total, 36);
    assert.equal(g.discardPile.length, 1);
    const start = g.discardPile[0];
    if (!['6', '7', 'K'].includes(start.rank)) {
      const sizes = g.players.map((p) => p.hand.length).sort();
      assert.deepEqual(sizes, [3, 4, 4, 4]);
    }
  }
});

test('обычный ход: по масти, по достоинству, дама на всё', () => {
  const g = rig({ hands: [['Kh', '9s', 'Qc', '10d'], ['6c']], top: '9h' });
  assert.equal(g.canPlay(c('Kh')), true);
  assert.equal(g.canPlay(c('9s')), true);
  assert.equal(g.canPlay(c('Qc')), true);
  assert.equal(g.canPlay(c('10d')), false);
});

test('стартовая 6 — первый игрок берёт 2 и пропускает ход (если нечем отбиться)', () => {
  const g = rig({ hands: [['9s', '10s', 'Js'], ['Kc', 'Kd', 'Kh', 'As']], top: '6h' });
  g.applyStartCard(c('6h'));
  g.resolveForced();
  assert.equal(g.players[0].hand.length, 5);
  assert.equal(g.currentIdx, 1);
  assert.equal(g.activeEffect, null);
});

test('стартовые K♠, туз, дама, восьмёрка', () => {
  let g = rig({ hands: [['9s', '10s', 'Js'], ['Kc']], top: 'Ks' });
  g.applyStartCard(c('Ks'));
  assert.equal(g.players[0].hand.length, 7);
  assert.equal(g.currentIdx, 1);

  g = rig({ hands: [['9s'], ['Kc']], top: 'Ah' });
  g.applyStartCard(c('Ah'));
  assert.equal(g.currentIdx, 1);

  g = rig({ hands: [['9s', '9h'], ['Kc']], top: 'Qh' });
  g.applyStartCard(c('Qh'));
  assert.equal(g.requiredSuit, 'hearts');
  assert.equal(g.canPlay(c('9s')), false);
  assert.equal(g.canPlay(c('9h')), true);

  g = rig({ hands: [['9s', '9h'], ['Kc']], top: '8h' });
  g.applyStartCard(c('8h'));
  assert.deepEqual(g.activeEffect, { type: 'EIGHT', suit: 'hearts' });
  assert.equal(g.currentIdx, 0);
});

test('цепочка шестёрок: 6 → 6 → 6 = 6 карт, отбиться можно только шестёркой', () => {
  const g = rig({
    hands: [['6h', '9c'], ['6s', 'Qs', 'Ks', '7s'], ['6d', '9d'], ['Jc', 'Jd']],
    top: '9h',
  });
  g.playCard('p0', '6_hearts');
  assert.deepEqual(g.activeEffect, { type: 'SIX', count: 2 });
  assert.equal(g.currentIdx, 1);
  for (const x of ['Qs', 'Ks', '7s']) assert.equal(g.canPlay(c(x)), false, x);
  g.playCard('p1', '6_spades');
  g.playCard('p2', '6_diamonds');
  // У P3 нет шестёрки — берёт 6 автоматически и пропускает ход
  assert.equal(g.players[3].hand.length, 8);
  assert.equal(g.currentIdx, 0);
  assert.equal(g.activeEffect, null);
  // Дальше играют по масти последней 6
  assert.equal(g.canPlay(c('9d')), true);
  assert.equal(g.canPlay(c('9c')), false);
});

test('при цепочке можно не отбиваться и взять карты добровольно', () => {
  const g = rig({ hands: [['6h', '9c'], ['6s', 'Jc']], top: '9h' });
  g.playCard('p0', '6_hearts');
  assert.equal(g.currentIdx, 1);
  g.takePenalty('p1');
  assert.equal(g.players[1].hand.length, 4);
  assert.equal(g.currentIdx, 0);
});

test('цепочка семёрок: 7 → 7 → 7 = 3 карты', () => {
  const g = rig({ hands: [['7h', '9c'], ['7s', 'Jc'], ['7d', 'Jd'], ['Jh']], top: '9h' });
  g.playCard('p0', '7_hearts');
  g.playCard('p1', '7_spades');
  g.playCard('p2', '7_diamonds');
  assert.equal(g.players[3].hand.length, 4);
  assert.equal(g.currentIdx, 0);
});

test('восьмёрка: ход остаётся, 8 на 8 меняет масть, закрытие', () => {
  const g = rig({ hands: [['8h', '8s', '10s', 'Jc'], ['Js']], top: '9h' });
  g.playCard('p0', '8_hearts');
  assert.equal(g.currentIdx, 0);
  assert.equal(g.canPlay(c('10s')), false);
  g.playCard('p0', '8_spades');
  assert.equal(g.currentIdx, 0);
  assert.deepEqual(g.activeEffect, { type: 'EIGHT', suit: 'spades' });
  g.playCard('p0', '10_spades');
  assert.equal(g.activeEffect, null);
  assert.equal(g.currentIdx, 1);
  assert.equal(g.canPlay(c('Js')), true);
});

test('восьмёрка: дама закрывает и заказывает масть', () => {
  const g = rig({ hands: [['8h', 'Qc', '9c'], ['Jd', 'Jh']], top: '9h' });
  g.playCard('p0', '8_hearts');
  g.playCard('p0', 'Q_clubs', 'diamonds');
  assert.equal(g.activeEffect, null);
  assert.equal(g.requiredSuit, 'diamonds');
  assert.equal(g.currentIdx, 1);
  assert.equal(g.canPlay(c('Jd')), true);
  assert.equal(g.canPlay(c('Jh')), false);
});

test('восьмёрка: нет масти — добор до нужной масти, остановка на даме', () => {
  // pile: pop() берёт с конца → порядок добора: 9c, Js, Qd, Kh
  const g = rig({ hands: [['8h', '10c'], ['Jc']], top: '9h', pile: ['Kh', 'Qd', 'Js', '9c'] });
  g.playCard('p0', '8_hearts');
  assert.equal(g.view('p0').actions.draw, true);
  g.drawCard('p0');
  assert.deepEqual(ids(g.players[0].hand), ids(['10c', '9c', 'Js', 'Qd'].map(c)));
  assert.equal(g.currentIdx, 0);
  // Можно сыграть даму — или добирать дальше
  g.drawCard('p0');
  assert.ok(g.players[0].hand.some((x) => x.id === 'K_hearts'));
  assert.equal(g.view('p0').actions.draw, false, 'есть червы — добирать нельзя');
  assert.throws(() => g.drawCard('p0'));
  g.playCard('p0', 'K_hearts');
  assert.equal(g.currentIdx, 1);
});

test('дама на даму: последняя заказанная масть главная', () => {
  const g = rig({ hands: [['Qh', '9c'], ['Qc', '9d'], ['9s', 'Js']], top: '9h' });
  assert.throws(() => g.playCard('p0', 'Q_hearts'), /масть/);
  g.playCard('p0', 'Q_hearts', 'clubs');
  g.playCard('p1', 'Q_clubs', 'spades');
  assert.equal(g.requiredSuit, 'spades');
  assert.equal(g.canPlay(c('9s')), true);
});

test('туз: следующий пропускает; K♠: +4 и пропуск', () => {
  let g = rig({ hands: [['Ah', '9c'], ['Jc'], ['Jd']], top: '9h' });
  g.playCard('p0', 'A_hearts');
  assert.equal(g.currentIdx, 2);

  g = rig({ hands: [['Ks', '9c'], ['Jc'], ['Jd']], top: '9s' });
  g.playCard('p0', 'K_spades');
  assert.equal(g.players[1].hand.length, 5);
  assert.equal(g.currentIdx, 2);
});

test('K♠ нельзя положить на активную шестёрку', () => {
  const g = rig({ hands: [['6s', '9c'], ['Ks', 'Jc']], top: '9s' });
  g.playCard('p0', '6_spades');
  assert.throws(() => g.playCard('p1', 'K_spades'));
});

test('добор: неподходящая карта — ход переходит', () => {
  const g = rig({ hands: [['Jc', '9c'], ['Jd']], top: '9h', pile: ['10d'] });
  g.drawCard('p0');
  assert.equal(g.currentIdx, 1);
  assert.equal(g.players[0].hand.length, 3);
});

test('добор: подходящую взятую карту можно сыграть — только её — или пас', () => {
  const g = rig({ hands: [['Jh', '9c'], ['Jd']], top: '9h', pile: ['Kh'] });
  // добровольный добор при наличии подходящей Jh
  g.drawCard('p0');
  assert.equal(g.currentIdx, 0);
  assert.deepEqual(g.view('p0').playable, ['K_hearts']);
  assert.throws(() => g.playCard('p0', 'J_hearts'));
  assert.throws(() => g.drawCard('p0'));
  g.pass('p0');
  assert.equal(g.currentIdx, 1);
});

test('последняя карта 6 — следующий всё равно берёт 2, раунд окончен', () => {
  const g = rig({ hands: [['6h'], ['Jc', '6s']], top: '9h' });
  g.playCard('p0', '6_hearts');
  assert.equal(g.players[1].hand.length, 4);
  assert.equal(g.status, 'ROUND_FINISHED');
  assert.equal(g.lastResult.winnerId, 'p0');
});

test('последняя карта 8 — раунд заканчивается сразу', () => {
  const g = rig({ hands: [['8h'], ['Jc']], top: '9h' });
  g.playCard('p0', '8_hearts');
  assert.equal(g.status, 'ROUND_FINISHED');
});

test('подсчёт очков, Q♠ = 23, K♠ = 44, закончил Q♠ = −20', () => {
  const g = rig({ hands: [['Qs'], ['6h', '7h', '8h', '9h', '10h'], ['Jc', 'Qd', 'Kd', 'Ac'], ['Qs'.replace('s', 'c'), 'Ks']], top: '9s' });
  g.players[3].hand = [c('Ks')];
  g.players[1].hand = [c('6h'), c('7h'), c('8h'), c('9h'), c('10h')];
  g.players[0].hand = [c('Qs')];
  g.playCard('p0', 'Q_spades');
  const pts = Object.fromEntries(g.lastResult.rows.map((r) => [r.id, r.roundPoints]));
  assert.deepEqual(pts, { p0: -20, p1: 31, p2: 2 + 3 + 4 + 11, p3: 44 });
  assert.equal(g.players[0].score, -20, 'отрицательный счёт разрешён');
});

test('закончил K♠ = −40; оставшаяся Q♠ = 23', () => {
  const g = rig({ hands: [['Ks'], ['Qs', '9d']], top: '9s' });
  g.playCard('p0', 'K_spades');
  const pts = Object.fromEntries(g.lastResult.rows.map((r) => [r.id, r.roundPoints]));
  assert.equal(pts.p0, -40);
  // Q♠ (23) + 9 (0) + 4 карты K♠ — они добраны уже после, считаем по факту руки
  assert.equal(pts.p1, g.lastResult.rows[1].cards.reduce((s, x) => s + x.value + x.bonus, 0));
  assert.ok(pts.p1 >= 23);
});

test('правило 108 → 0, 107 → 54, 109+ → выбывание и победа последнего', () => {
  let g = rig({ hands: [['Jh'], ['10c'], ['Ac'], ['9c']], top: '9h' });
  g.players[1].score = 98;  // +10 = 108 → 0
  g.players[2].score = 96;  // +11 = 107 → 54
  g.players[3].score = 108; // +0 = 108 → 0
  g.playCard('p0', 'J_hearts');
  assert.equal(g.players[1].score, 0);
  assert.equal(g.players[2].score, 54);
  assert.equal(g.players[3].score, 0);
  assert.equal(g.status, 'ROUND_FINISHED');

  g = rig({ hands: [['Jh'], ['10c'], ['Ac']], top: '9h' });
  g.players[1].score = 100; // 110 → выбыл
  g.players[2].score = 50;
  g.playCard('p0', 'J_hearts');
  assert.equal(g.players[1].eliminated, true);
  assert.equal(g.status, 'ROUND_FINISHED');
  // Выбывший пропускается при ходе
  assert.equal(g.nextIdx(0), 2);

  g = rig({ hands: [['Jh'], ['10c']], top: '9h' });
  g.players[1].score = 100;
  g.playCard('p0', 'J_hearts');
  assert.equal(g.status, 'GAME_FINISHED');
  assert.equal(g.winnerId, 'p0');
});

test('следующий раунд начинает игрок с наибольшими очками за раунд', () => {
  const g = rig({ hands: [['Jh'], ['10c'], ['Ac', 'Ad'], ['9c']], top: '9h' });
  g.playCard('p0', 'J_hearts');
  g.nextRound();
  assert.equal(g.starterIdx, 2);
  assert.equal(g.players[2].hand.length + (['6', '7', 'K'].includes(g.discardPile[0].rank) ? 0 : 0) >= 3, true);
});

test('колода кончилась — сброс (кроме верхней) перемешивается', () => {
  const g = rig({ hands: [['Jc', '9c'], ['Jd']], top: '9h', pile: [] });
  g.discardPile = [c('10h'), c('10s'), c('9h')];
  g.drawCard('p0');
  assert.deepEqual(g.discardPile.map((x) => x.id), ['9_hearts']);
  assert.equal(g.players[0].hand.length + g.drawPile.length, 4);
});

test('защита от двойного хода: устаревшая версия отклоняется', () => {
  const g = rig({ hands: [['Jh', '9h'], ['Jd']], top: '9s' });
  const v = g.version;
  g.playCard('p0', '9_hearts', null, v);
  assert.throws(() => g.playCard('p0', 'J_hearts', null, v), /обновилось|не ваш/);
  assert.throws(() => g.playCard('p1', 'J_diamonds', null, v), /обновилось/);
});

test('клиент не видит чужие карты', () => {
  const g = rig({ hands: [['Jh', '9h'], ['Jd']], top: '9s' });
  const v = JSON.stringify(g.view('p1'));
  assert.ok(!v.includes('J_hearts'));
  assert.ok(v.includes('J_diamonds'));
});

test('симуляция: 300 партий ботов доходят до конца без ошибок, карты не теряются', () => {
  for (let k = 0; k < 300; k++) {
    const g = new Game();
    const n = 2 + (k % 5);
    for (let i = 0; i < n; i++) g.addPlayer({ id: 'b' + i, name: 'B' + i, isBot: true });
    g.start();
    let steps = 0;
    while (g.status !== 'GAME_FINISHED') {
      assert.ok(++steps < 200000, 'игра зависла');
      if (g.status === 'ROUND_FINISHED') { g.nextRound(); continue; }
      const id = g.current.id;
      const m = botAction(g);
      if (m.action === 'PLAY_CARD') g.playCard(id, m.cardId, m.suit);
      else if (m.action === 'DRAW_CARD') g.drawCard(id);
      else if (m.action === 'TAKE_PENALTY') g.takePenalty(id);
      else g.pass(id);
      if (g.status === 'PLAYING') {
        const total = g.players.reduce((s, p) => s + p.hand.length, 0) + g.drawPile.length + g.discardPile.length;
        assert.equal(total, 36);
      }
    }
    assert.equal(g.active().length, 1);
    assert.equal(g.winnerId, g.active()[0].id);
  }
});
