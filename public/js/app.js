import { createConnection } from './net.js';

// Клиент ничего не решает сам: чей ход, что можно положить, сколько брать и очки —
// всё приходит с сервера. Здесь только отрисовка и отправка действий.

const SUIT = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SUIT_NAME = { hearts: 'Червы', diamonds: 'Бубны', clubs: 'Крести', spades: 'Пики' };
const SUIT_ORDER = ['hearts', 'diamonds', 'clubs', 'spades'];
const RED = new Set(['hearts', 'diamonds']);
const AVATAR_COLORS = ['#e07a5f', '#3d9a8b', '#8e7cc3', '#e0a43a', '#5b8fd6', '#c65d8a', '#6aa84f', '#d4694a'];
const NAME_KEY = '108.name';

const tg = window.Telegram?.WebApp;
const inTelegram = !!tg?.initData;
if (inTelegram) { tg.ready(); tg.expand(); }

const urlCode = new URLSearchParams(location.search).get('room');
const ui = {
  screen: 'home',
  msg: null,          // последнее состояние от сервера
  busy: false,        // ждём ответа на ход — защита от двойного нажатия
  modal: null,
  name: loadName(),
  maxPlayers: 4,
  bots: 3,
  joinCode: (urlCode || tg?.initDataUnsafe?.start_param || '').toUpperCase().slice(0, 4),
  seenHand: new Set(),
  lastTopId: null,
  wasMyTurn: false,
  online: true,
};

function loadName() {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {}
  const u = tg?.initDataUnsafe?.user;
  return u ? [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 20) : '';
}

const conn = createConnection({
  onMessage: handleMessage,
  onStatus(ok) {
    ui.online = ok;
    document.getElementById('conn').hidden = ok;
  },
});

function handleMessage(m) {
  switch (m.type) {
    case 'STATE': {
      const prevStatus = ui.msg?.game.status;
      ui.msg = m;
      ui.busy = false;
      if (ui.screen !== 'room') { ui.screen = 'room'; ui.modal = null; }
      if (prevStatus && prevStatus !== m.game.status && ui.modal?.type !== 'rules') ui.modal = null;
      const url = `${location.pathname}?room=${m.room.code}`;
      if (location.search !== `?room=${m.room.code}`) history.replaceState(null, '', url);
      notifyTurn();
      render();
      break;
    }
    case 'ERROR':
      ui.busy = false;
      toast(m.message, 'error');
      haptic('error');
      break;
    case 'NO_ROOM':
      if (ui.screen === 'room') goHome();
      else render();
      break;
    case 'LEFT_ROOM':
      if (m.reason) toast(m.reason);
      goHome();
      break;
  }
}

function goHome() {
  ui.screen = 'home';
  ui.msg = null;
  ui.modal = null;
  ui.seenHand.clear();
  ui.lastTopId = null;
  ui.wasMyTurn = false;
  document.title = '108 — карточная игра';
  history.replaceState(null, '', location.pathname);
  render();
}

function send(action, extra = {}) {
  conn.send({ action, ...extra });
}

// Игровое действие: прикладываем версию состояния и блокируем повторные нажатия
function sendMove(action, extra = {}) {
  if (ui.busy) return;
  ui.busy = true;
  send(action, { ...extra, version: ui.msg.game.version });
  render();
}

function notifyTurn() {
  const g = ui.msg.game;
  const myTurn = g.status === 'PLAYING' && g.currentPlayerId === ui.msg.you;
  if (myTurn && !ui.wasMyTurn) haptic('turn');
  ui.wasMyTurn = myTurn;
  document.title = myTurn ? '● Ваш ход — 108' : '108 — карточная игра';
}

function haptic(kind) {
  const h = tg?.HapticFeedback;
  if (!h) return;
  if (kind === 'error') h.notificationOccurred('error');
  else if (kind === 'turn') h.notificationOccurred('success');
  else h.impactOccurred('light');
}

// ───────────────────────── helpers ─────────────────────────

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function initials(name) {
  const parts = String(name).replace(/^Бот\s+/, '').trim().split(/\s+/);
  return esc(((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase());
}

function avatarColor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function avatar(p, cls = '') {
  const bot = p.isBot ? '<span class="avatar-bot" title="Бот">🤖</span>' : '';
  return `<div class="avatar ${cls}" style="--av:${avatarColor(p.id)}">${initials(p.name)}${bot}</div>`;
}

function cardHTML(c, { cls = '', attrs = '' } = {}) {
  const color = RED.has(c.suit) ? 'red' : 'black';
  const s = SUIT[c.suit];
  const face = ['J', 'Q', 'K'].includes(c.rank);
  const center = face
    ? `<span class="c-face">${c.rank}<i>${s}</i></span>`
    : `<span class="c-pip">${s}</span>`;
  return `<div class="card ${color} ${cls}" ${attrs} aria-label="${c.rank} ${SUIT_NAME[c.suit]}">
    <span class="c-corner"><b>${c.rank}</b>${s}</span>${center}<span class="c-corner c-br"><b>${c.rank}</b>${s}</span>
  </div>`;
}

function miniCard(c, extra = '') {
  const color = RED.has(c.suit) ? 'red' : 'black';
  return `<span class="mini ${color}">${c.rank}${SUIT[c.suit]}${extra}</span>`;
}

function suitSpan(s) {
  return `<span class="suit ${RED.has(s) ? 'red' : 'black'}">${SUIT[s]}</span>`;
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const cardsWord = (n) => `${n} ${plural(n, 'карту', 'карты', 'карт')}`;
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

function inviteLink(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

// ───────────────────────── render ─────────────────────────

const app = document.getElementById('app');

function render() {
  if (ui.screen === 'home') {
    app.innerHTML = renderHome();
  } else {
    const status = ui.msg.room.status;
    app.innerHTML = status === 'WAITING' || status === 'STARTING' ? renderLobby() : renderGame();
  }
  renderModal();
}

// ───── главный экран ─────

function renderHome() {
  const counts = [2, 3, 4, 5, 6].map((n) =>
    `<button class="seg ${ui.maxPlayers === n ? 'on' : ''}" data-act="home-max" data-n="${n}">${n}</button>`).join('');
  const bots = [1, 2, 3, 4, 5].map((n) =>
    `<button class="seg ${ui.bots === n ? 'on' : ''}" data-act="home-bots" data-n="${n}">${n}</button>`).join('');
  return `
  <main class="home">
    <header class="home-top">
      <div class="logo" aria-label="108">
        <span class="logo-card lc1">1</span><span class="logo-card lc2">0</span><span class="logo-card lc3">8</span>
      </div>
      <p class="tagline">Карточная игра для компании. Набери меньше всех — и не перевали за&nbsp;108.</p>
    </header>

    <section class="panel">
      <label class="field">
        <span>Ваше имя</span>
        <input id="name" maxlength="20" autocomplete="nickname" placeholder="Как вас зовут?" value="${esc(ui.name)}">
      </label>

      <div class="field">
        <span>Соперников-ботов</span>
        <div class="segs">${bots}</div>
      </div>
      <button class="btn primary big" data-act="play-bots">Играть с ботами</button>

      <div class="or"><span>или с друзьями</span></div>

      <div class="field">
        <span>Игроков в комнате</span>
        <div class="segs">${counts}</div>
      </div>
      <button class="btn big" data-act="create">Создать комнату</button>

      <div class="or"><span>или войти по коду</span></div>

      <div class="join-row">
        <input id="code" class="code-input" maxlength="4" autocomplete="off" autocapitalize="characters"
          placeholder="A82F" value="${esc(ui.joinCode)}">
        <button class="btn" data-act="join">Войти</button>
      </div>
    </section>

    <button class="link" data-act="rules">Правила игры</button>
  </main>`;
}

// ───── лобби ─────

function renderLobby() {
  const { room, game, you } = ui.msg;
  const isHost = room.hostId === you;
  const slots = [];
  for (let i = 0; i < room.maxPlayers; i++) {
    const p = game.players[i];
    if (p) {
      const tags = [
        p.id === room.hostId ? '<span class="tag gold">Создатель</span>' : '',
        p.id === you ? '<span class="tag">Вы</span>' : '',
        !room.online[p.id] ? '<span class="tag dim">Нет связи</span>' : '',
      ].join('');
      const remove = isHost && p.id !== you
        ? `<button class="slot-x" data-act="remove" data-id="${p.id}" aria-label="Удалить ${esc(p.name)}">×</button>` : '';
      slots.push(`<div class="slot filled">${avatar(p)}<div class="slot-name">${esc(p.name)}</div><div class="slot-tags">${tags}</div>${remove}</div>`);
    } else if (isHost) {
      slots.push(`<button class="slot empty" data-act="add-bot"><span class="slot-plus">+</span><span>Добавить бота</span></button>`);
    } else {
      slots.push(`<div class="slot empty"><span class="slot-plus">·</span><span>Свободно</span></div>`);
    }
  }

  const maxSel = isHost ? `
    <div class="lobby-max">
      <span>Мест</span>
      <div class="segs small">${[2, 3, 4, 5, 6].map((n) =>
        `<button class="seg ${room.maxPlayers === n ? 'on' : ''}" data-act="room-max" data-n="${n}" ${n < game.players.length ? 'disabled' : ''}>${n}</button>`).join('')}</div>
    </div>` : '';

  const enough = game.players.length >= 2;
  const footer = isHost
    ? `<button class="btn primary big" data-act="start" ${enough ? '' : 'disabled'}>${enough ? 'Начать игру' : 'Нужно минимум 2 игрока'}</button>`
    : `<p class="wait-note">Ждём, пока создатель комнаты начнёт игру…</p>`;

  const starting = room.status === 'STARTING'
    ? `<div class="starting"><div class="deal-anim"><i></i><i></i><i></i></div><p>Раздаём карты…</p></div>` : '';

  return `
  <main class="lobby">
    ${topbar(`Комната`, true)}
    <section class="invite">
      <div class="room-code-label">Код комнаты</div>
      <div class="room-code">${room.code.split('').map((ch) => `<span>${ch}</span>`).join('')}</div>
      <button class="btn ghost" data-act="invite">Пригласить друзей</button>
    </section>
    <section class="slots">${slots.join('')}</section>
    ${maxSel}
    <footer class="lobby-foot">${footer}</footer>
    ${starting}
  </main>`;
}

function topbar(title, inLobby = false) {
  const g = ui.msg?.game;
  const right = inLobby ? '' : `<button class="icon-btn" data-act="scores" aria-label="Счёт">Счёт</button>`;
  return `
  <header class="topbar">
    <button class="icon-btn" data-act="leave" aria-label="Выйти">←</button>
    <div class="topbar-title">${title}</div>
    <div class="topbar-right">${right}<button class="icon-btn" data-act="rules" aria-label="Правила">?</button></div>
  </header>`;
}

// ───── игровой экран ─────

function statusOf(p, g, room) {
  if (g.winnerId === p.id) return ['Победитель', 'win'];
  if (p.eliminated) return ['Вне игры', 'out'];
  if (p.auto && !p.isBot) return ['Автопилот', 'off'];
  if (!p.isBot && !room.online[p.id]) return ['Нет связи', 'off'];
  if (p.isCurrent) return p.lastAction === 'draw' ? ['Берёт карты', 'turn'] : ['Ходит', 'turn'];
  return ['Ждёт', ''];
}

function seatHTML(p, g, room, pos) {
  const [st, stCls] = statusOf(p, g, room);
  const backs = Math.min(p.cardCount, 7);
  const fan = Array.from({ length: backs }, (_, i) => `<i style="--i:${i - (backs - 1) / 2}"></i>`).join('');
  return `
  <div class="seat ${p.isCurrent ? 'current' : ''} ${p.eliminated ? 'eliminated' : ''}" style="left:${pos.x}%;top:${pos.y}%">
    <div class="seat-fan">${fan}</div>
    ${avatar(p, p.isCurrent ? 'ring' : '')}
    <div class="seat-name">${esc(p.name)}</div>
    <div class="seat-meta"><span title="Карт на руке">${p.eliminated ? '—' : `${p.cardCount}<small> ${plural(p.cardCount, 'карта', 'карты', 'карт')}</small>`}</span><span class="dot">·</span><span title="Очки"><b>${p.score}</b> оч.</span></div>
    <div class="seat-status ${stCls}">${st}</div>
  </div>`;
}

// Соперники по часовой стрелке: следующий — слева, дальше через верх направо
function seatPositions(k) {
  // На узком экране растягиваем дугу вниз по бокам стола, чтобы места не наезжали
  const portrait = innerHeight > innerWidth * 1.2;
  const extra = portrait && k > 2 ? 0.45 : 0.05;
  const from = Math.PI + extra, to = -extra;
  const pos = [];
  for (let i = 0; i < k; i++) {
    const t = k === 1 ? Math.PI / 2 : from - (i * (from - to)) / (k - 1);
    pos.push({ x: 50 + (portrait ? 37 : 41) * Math.cos(t), y: (portrait ? 47 : 52) - (portrait ? 34 : 38) * Math.sin(t) });
  }
  return pos;
}

function effectChip(g) {
  const e = g.activeEffect;
  if (e?.type === 'SIX' || e?.type === 'SEVEN') {
    return `<div class="chip danger">Цепочка ${e.type === 'SIX' ? '6' : '7'} · +${cardsWord(e.count)}</div>`;
  }
  if (e?.type === 'EIGHT') return `<div class="chip warn">Восьмёрка · закрыть ${suitSpan(e.suit)}</div>`;
  if (g.requiredSuit) return `<div class="chip">Заказ дамы · ${suitSpan(g.requiredSuit)} ${SUIT_NAME[g.requiredSuit]}</div>`;
  return '';
}

function promptFor(g, me, myTurn) {
  if (g.status !== 'PLAYING') return '';
  if (!myTurn) {
    const cur = g.players.find((p) => p.isCurrent);
    return cur ? `Ходит ${esc(cur.name)}` : '';
  }
  const e = g.activeEffect;
  if (e?.type === 'SIX') return `Положите 6 или возьмите ${cardsWord(e.count)}`;
  if (e?.type === 'SEVEN') return `Положите 7 или возьмите ${cardsWord(e.count)}`;
  if (e?.type === 'EIGHT') {
    return g.actions.draw
      ? `Нет ${SUIT[e.suit]} — добирайте до нужной масти${g.playable.length ? ' или сыграйте 8 / даму' : ''}`
      : `Закройте восьмёрку: положите ${suitSpan(e.suit)}, 8 или даму`;
  }
  if (g.drawnCardId) return 'Взятая карта подходит — положите её или пасуйте';
  if (g.requiredSuit) return `Заказано ${suitSpan(g.requiredSuit)} — положите ${SUIT_NAME[g.requiredSuit].toLowerCase()} или даму`;
  return g.playable.length ? 'Ваш ход' : 'Подходящей карты нет — возьмите из колоды';
}

function renderGame() {
  const { room, game: g, you } = ui.msg;
  const meIdx = g.players.findIndex((p) => p.id === you);
  const me = g.players[meIdx];
  const myTurn = g.status === 'PLAYING' && g.currentPlayerId === you;

  const others = [];
  for (let k = 1; k < g.players.length; k++) others.push(g.players[(meIdx + k) % g.players.length]);
  const pos = seatPositions(others.length);
  const seats = others.map((p, i) => seatHTML(p, g, room, pos[i])).join('');

  // Анимация новой карты на столе
  const top = g.topCard;
  const topEnter = top && top.id !== ui.lastTopId ? 'enter' : '';
  ui.lastTopId = top?.id || null;

  const playable = new Set(g.playable);
  const n = g.hand.length;
  const handCards = g.hand.map((c) => {
    const isNew = !ui.seenHand.has(c.id) && ui.seenHand.size > 0 ? 'fresh' : '';
    const state = !myTurn ? 'idle' : playable.has(c.id) ? 'playable' : 'disabled';
    const drawn = g.drawnCardId === c.id ? 'drawn' : '';
    return cardHTML(c, { cls: `${state} ${isNew} ${drawn}`, attrs: `data-act="card" data-id="${c.id}" role="button" tabindex="0"` });
  }).join('');
  ui.seenHand = new Set(g.hand.map((c) => c.id));

  const a = g.actions;
  const buttons = [];
  if (a.take) buttons.push(`<button class="btn danger" data-act="take" ${ui.busy ? 'disabled' : ''}>Взять ${cardsWord(g.activeEffect.count)}</button>`);
  if (a.draw) buttons.push(`<button class="btn primary" data-act="draw" ${ui.busy ? 'disabled' : ''}>${g.activeEffect?.type === 'EIGHT' ? 'Добрать до масти' : 'Взять карту'}</button>`);
  if (a.pass) buttons.push(`<button class="btn" data-act="pass" ${ui.busy ? 'disabled' : ''}>Пас</button>`);

  const log = g.log.slice(-4).map((l, i, arr) =>
    `<li class="${l.kind} ${i === arr.length - 1 ? 'last' : ''}">${esc(l.text)}</li>`).join('');

  const meStatus = me ? statusOf(me, g, room) : ['', ''];

  return `
  <main class="game ${myTurn ? 'my-turn' : ''} ${g.status === 'PLAYING' && !myTurn ? 'other-turn' : ''}">
    ${topbar(`Раунд ${g.round}`)}
    <section class="table">
      <div class="felt"></div>
      ${seats}
      <div class="center">
        ${turnBanner(g, you, myTurn)}
        <div class="piles">
          <div class="pile deck" title="Колода добора">
            <div class="card back"></div><div class="card back"></div>
            <span class="pile-count">${g.drawPileCount}</span>
          </div>
          <div class="pile discard">
            ${g.previousCards.map((c, i, arr) => cardHTML(c, { cls: `prev-card prev-${arr.length - i}` })).join('')}
            ${top ? cardHTML(top, { cls: `table-card ${topEnter}` }) : ''}
          </div>
        </div>
        ${effectChip(g)}
      </div>
      <ul class="log">${log}</ul>
    </section>

    <section class="me ${myTurn ? 'turn' : ''}">
      <div class="me-row">
        ${me ? avatar(me, myTurn ? 'ring' : '') : ''}
        <div class="me-info">
          <div class="me-name">${me ? esc(me.name) : ''} <span class="seat-status ${meStatus[1]}">${meStatus[0]}</span></div>
          <div class="me-score"><b>${me?.score ?? 0}</b> очков · ${cardsWord(n)}</div>
        </div>
      </div>
      <div class="prompt">${promptFor(g, me, myTurn)}</div>
      <div class="hand" style="--n:${Math.max(n, 1)}">${handCards}</div>
      <div class="actions">${buttons.join('')}</div>
    </section>
    ${g.status === 'ROUND_FINISHED' ? renderRoundResult() : ''}
    ${g.status === 'GAME_FINISHED' ? renderGameOver() : ''}
  </main>`;
}

function turnBanner(g, you, myTurn) {
  if (g.status !== 'PLAYING') return '';
  if (myTurn) return '<div class="turn-banner mine">Ваш ход!</div>';
  const cur = g.players.find((p) => p.isCurrent);
  if (!cur) return '';
  return `<div class="turn-banner"><span class="tb-dot" style="--av:${avatarColor(cur.id)}"></span>Ходит: <b>${esc(cur.name)}</b></div>`;
}

// ───── результаты раунда ─────

const NOTE = {
  RESET_108: '<span class="tag gold">108 → 0</span>',
  HALF_107: '<span class="tag gold">107 → 54</span>',
  ELIMINATED: '<span class="tag red">Вне игры ✕</span>',
};

function resultTable(r) {
  const rows = [...r.rows].sort((x, y) => (y.isWinner - x.isWinner) || x.after - y.after);
  return rows.map((row) => {
    const cards = row.isWinner
      ? `<span class="res-note">Последняя карта ${miniCard(r.lastCard)}${row.finishBonus ? ` <b class="bonus">${signed(row.finishBonus)}</b>` : ''}</span>`
      : row.cards.length
        ? row.cards.map((c) => miniCard(c, `<sub>${c.value + c.bonus}</sub>`)).join('') +
          row.cards.filter((c) => c.bonus).map((c) => ` <b class="bonus">${c.rank}${SUIT[c.suit]} +${c.bonus}</b>`).join('')
        : '<span class="res-note">Без карт</span>';
    const pts = row.isWinner && !row.roundPoints ? '—' : signed(row.roundPoints);
    return `
      <tr class="${row.isWinner ? 'winner' : ''} ${row.note === 'ELIMINATED' ? 'elim' : ''}">
        <td class="res-player">${row.isWinner ? '🥇 ' : ''}${esc(row.name)}${row.id === ui.msg.you ? ' <small>(вы)</small>' : ''}<div class="res-cards">${cards}</div></td>
        <td class="num">${pts}</td>
        <td class="num total">${row.note && row.note !== 'ELIMINATED' ? `<s>${row.raw}</s> ` : ''}<b>${row.after}</b><div>${NOTE[row.note] || ''}</div></td>
      </tr>`;
  }).join('');
}

function renderRoundResult() {
  const { room, game: g, you } = ui.msg;
  const r = g.lastResult;
  const winner = g.players.find((p) => p.id === r.winnerId);
  const isHost = room.hostId === you;
  return `
  <div class="overlay">
    <div class="sheet result">
      <div class="sheet-kicker">Раунд ${r.round}</div>
      <h2>🥇 Без карт — ${esc(winner?.name || '')}</h2>
      <table class="res-table">
        <thead><tr><th>Игрок · оставшиеся карты</th><th class="num">Раунд</th><th class="num">Итого</th></tr></thead>
        <tbody>${resultTable(r)}</tbody>
      </table>
      <div class="sheet-actions">
        <button class="btn ghost" data-act="scores">История раундов</button>
        ${isHost ? '<button class="btn primary" data-act="next-round">Следующий раунд</button>' : '<p class="wait-note">Ждём создателя комнаты…</p>'}
      </div>
    </div>
  </div>`;
}

function renderGameOver() {
  const { room, game: g, you } = ui.msg;
  const champ = g.players.find((p) => p.id === g.winnerId);
  const isHost = room.hostId === you;
  const sorted = [...g.players].sort((a, b) =>
    (a.id === g.winnerId ? -1 : b.id === g.winnerId ? 1 : 0) || (a.eliminated - b.eliminated) || a.score - b.score);
  const last = g.lastResult ? `<details class="last-round"><summary>Последний раунд</summary><table class="res-table"><tbody>${resultTable(g.lastResult)}</tbody></table></details>` : '';
  return `
  <div class="overlay">
    <div class="sheet gameover">
      <div class="sheet-kicker">Игра окончена</div>
      <div class="trophy">🏆</div>
      <h2>${esc(champ?.name || '')}${champ?.id === you ? ' — это вы!' : ''}</h2>
      <ol class="final">
        ${sorted.map((p) => `<li class="${p.eliminated ? 'out' : ''} ${p.id === g.winnerId ? 'champ' : ''}">
          ${avatar(p, 'sm')}<span>${esc(p.name)}</span><b>${p.eliminated ? `Вне игры · ${p.score}` : p.score}</b></li>`).join('')}
      </ol>
      ${last}
      <div class="sheet-actions">
        <button class="btn ghost" data-act="scores">История раундов</button>
        ${isHost ? `<button class="btn" data-act="back-lobby">В лобби</button><button class="btn primary" data-act="play-again">Играть снова</button>`
          : '<button class="btn" data-act="leave-now">Выйти</button>'}
      </div>
    </div>
  </div>`;
}

// ───── модальные окна ─────

function renderModal() {
  const root = document.getElementById('modal-root');
  const m = ui.modal;
  if (!m) { root.innerHTML = ''; return; }
  let body = '';
  if (m.type === 'suit') {
    body = `
      <h3>Выберите масть</h3>
      <p class="muted">Следующий игрок должен будет положить эту масть или даму</p>
      <div class="suit-grid">${SUIT_ORDER.map((s) =>
        `<button class="suit-btn ${RED.has(s) ? 'red' : 'black'}" data-act="suit" data-suit="${s}"><span>${SUIT[s]}</span>${SUIT_NAME[s]}</button>`).join('')}</div>
      <button class="btn ghost wide" data-act="close">Отмена</button>`;
  } else if (m.type === 'confirm-draw') {
    body = `
      <h3>Взять карту?</h3>
      <p class="muted">У вас есть подходящая карта. Если взятая не подойдёт — ход перейдёт дальше.</p>
      <div class="row-btns"><button class="btn ghost" data-act="close">Отмена</button><button class="btn primary" data-act="draw-confirmed">Взять</button></div>`;
  } else if (m.type === 'leave') {
    const playing = ui.msg && !['WAITING', 'STARTING'].includes(ui.msg.room.status);
    body = `
      <h3>Выйти из комнаты?</h3>
      <p class="muted">${playing ? 'Игра продолжится без вас — за вас будет ходить автопилот. Вернуться можно по коду комнаты.' : 'Вы покинете лобби.'}</p>
      <div class="row-btns"><button class="btn ghost" data-act="close">Остаться</button><button class="btn danger" data-act="leave-now">Выйти</button></div>`;
  } else if (m.type === 'scores') {
    body = renderScores();
  } else if (m.type === 'rules') {
    body = renderRules();
  }
  root.innerHTML = `<div class="modal-back" data-act="close-back"><div class="modal ${m.type}" role="dialog" aria-modal="true">${body}</div></div>`;
}

function renderScores() {
  const g = ui.msg.game;
  const head = g.players.map((p) => `<th class="num">${esc(p.name)}</th>`).join('');
  const rows = g.history.map((h) => `<tr><td>${h.round}</td>${g.players.map((p) => {
    const cell = h.points[p.id];
    if (!cell) return '<td class="num dim">—</td>';
    const win = h.winnerId === p.id ? ' win' : '';
    return `<td class="num${win}">${signed(cell.pts)}<small>${cell.total}${cell.note === 'ELIMINATED' ? ' ✕' : ''}</small></td>`;
  }).join('')}</tr>`).join('');
  const totals = g.players.map((p) => `<td class="num"><b>${p.score}</b>${p.eliminated ? ' ✕' : ''}</td>`).join('');
  return `
    <h3>История раундов</h3>
    <div class="scroll-x"><table class="score-table">
      <thead><tr><th>#</th>${head}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${g.players.length + 1}" class="muted">Раундов пока не было</td></tr>`}</tbody>
      <tfoot><tr><td>Σ</td>${totals}</tr></tfoot>
    </table></div>
    <button class="btn wide" data-act="close">Закрыть</button>`;
}

function renderRules() {
  return `
    <h3>Правила «108»</h3>
    <div class="rules">
      <p><b>Цель</b> — набрать как можно меньше очков. У кого больше 108 — выбывает. Побеждает последний оставшийся.</p>
      <p><b>Раздача.</b> Колода 36 карт. Первый игрок получает 3 карты, остальные по 4. Открывается стартовая карта — её эффект сразу действует на первого игрока. В следующих раундах первым ходит тот, кто набрал больше всех очков в прошлом раунде.</p>
      <p><b>Ход.</b> Кладите карту той же масти или того же достоинства. Нечем ходить — возьмите карту; если подходит, её можно сразу положить. Взять карту можно и добровольно.</p>
      <ul>
        <li><b>6</b> — следующий берёт 2 и пропускает ход. Отбиться можно только шестёркой: цепочка 6→6→6 = 6 карт.</li>
        <li><b>7</b> — следующий берёт 1 и пропускает ход. Цепочка 7→7→7 = 3 карты.</li>
        <li><b>8</b> — вы ходите ещё раз и закрываете восьмёрку её мастью. 8 на 8 меняет масть. Нет масти — добираете, пока не придёт.</li>
        <li><b>Дама</b> кладётся на что угодно и заказывает масть.</li>
        <li><b>Туз</b> — следующий пропускает ход.</li>
        <li><b>K♠</b> — следующий берёт 4 и пропускает ход.</li>
      </ul>
      <p><b>Очки</b> за карты на руке: 6–8 и 10 — по номиналу, 9 — 0, J — 2, Q — 3, K — 4, A — 11. Q♠ на руке = 23, K♠ = 44. Закончили раунд дамой пик — −20, королём пик — −40.</p>
      <p><b>108 и 107.</b> Ровно 108 — счёт обнуляется. Ровно 107 — становится 54.</p>
    </div>
    <button class="btn wide" data-act="close">Понятно</button>`;
}

// ───────────────────────── события ─────────────────────────

document.addEventListener('input', (e) => {
  if (e.target.id === 'name') ui.name = e.target.value;
  if (e.target.id === 'code') {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    ui.joinCode = e.target.value;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.modal) { ui.modal = null; renderModal(); }
  if (e.key === 'Enter') {
    if (e.target.id === 'code') act('join', {});
    else if (e.target.id === 'name') act(ui.joinCode.length === 4 ? 'join' : 'play-bots', {});
    else if (e.target.matches?.('.card[data-act]')) act('card', e.target.dataset);
  }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.dataset.act === 'close-back' && e.target !== el) return;
  act(el.dataset.act, el.dataset, el);
});

function requireName() {
  const name = ui.name.trim();
  if (!name) {
    toast('Введите имя', 'error');
    document.getElementById('name')?.focus();
    return null;
  }
  try { localStorage.setItem(NAME_KEY, name); } catch {}
  return name;
}

function act(name, data, el) {
  const g = ui.msg?.game;
  switch (name) {
    case 'home-max': ui.maxPlayers = Number(data.n); render(); break;
    case 'home-bots': ui.bots = Number(data.n); render(); break;
    case 'play-bots': {
      const n = requireName();
      if (n) send('PLAY_WITH_BOTS', { name: n, bots: ui.bots });
      break;
    }
    case 'create': {
      const n = requireName();
      if (n) send('CREATE_ROOM', { name: n, maxPlayers: ui.maxPlayers });
      break;
    }
    case 'join': {
      const n = requireName();
      if (!n) break;
      if (ui.joinCode.length !== 4) { toast('Введите код из 4 символов', 'error'); break; }
      send('JOIN_ROOM', { name: n, code: ui.joinCode });
      break;
    }
    case 'room-max': send('SET_MAX_PLAYERS', { maxPlayers: Number(data.n) }); break;
    case 'add-bot': send('ADD_BOT'); break;
    case 'remove': send('REMOVE_PLAYER', { playerId: data.id }); break;
    case 'start': send('START_GAME'); break;
    case 'invite': invite(); break;

    case 'card': {
      if (!g || g.status !== 'PLAYING') break;
      if (g.currentPlayerId !== ui.msg.you) { toast('Сейчас не ваш ход'); break; }
      if (!g.playable.includes(data.id)) {
        el?.classList.remove('shake'); void el?.offsetWidth; el?.classList.add('shake');
        haptic('error');
        break;
      }
      haptic('light');
      const card = g.hand.find((c) => c.id === data.id);
      if (card.rank === 'Q' && g.hand.length > 1) { ui.modal = { type: 'suit', cardId: card.id }; renderModal(); break; }
      sendMove('PLAY_CARD', { cardId: data.id });
      break;
    }
    case 'suit': {
      const cardId = ui.modal?.cardId;
      ui.modal = null;
      renderModal();
      if (cardId) sendMove('PLAY_CARD', { cardId, suit: data.suit });
      break;
    }
    case 'draw':
      // Добровольный добор — переспрашиваем, если есть чем ходить
      if (g.playable.length && !g.activeEffect) { ui.modal = { type: 'confirm-draw' }; renderModal(); }
      else sendMove('DRAW_CARD');
      break;
    case 'draw-confirmed': ui.modal = null; renderModal(); sendMove('DRAW_CARD'); break;
    case 'take': sendMove('TAKE_PENALTY'); break;
    case 'pass': sendMove('PASS'); break;
    case 'next-round': send('NEXT_ROUND'); break;
    case 'play-again': send('PLAY_AGAIN'); break;
    case 'back-lobby': send('BACK_TO_LOBBY'); break;

    case 'scores': ui.modal = { type: 'scores' }; renderModal(); break;
    case 'rules': ui.modal = { type: 'rules' }; renderModal(); break;
    case 'leave': ui.modal = { type: 'leave' }; renderModal(); break;
    case 'leave-now': ui.modal = null; send('LEAVE_ROOM'); break;
    case 'close': case 'close-back': ui.modal = null; renderModal(); break;
  }
}

async function invite() {
  const code = ui.msg.room.code;
  const link = inviteLink(code);
  const text = `Заходи играть в «108»! Код комнаты: ${code}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: '108', text, url: link }); return; } catch {}
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('Ссылка-приглашение скопирована');
  } catch {
    toast(`Код комнаты: ${code}`);
  }
}

render();
