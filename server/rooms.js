'use strict';
const crypto = require('crypto');
const { Game, GameError } = require('./game/engine');
const { botAction } = require('./game/bot');
const { STATUS, MIN_PLAYERS, MAX_PLAYERS } = require('./game/constants');

const BOT_DELAY_MS = process.env.BOT_DELAY_MS ? [+process.env.BOT_DELAY_MS, +process.env.BOT_DELAY_MS] : [700, 1300];
const AUTO_DELAY_MS = 900;          // игрок вышел из игры — ходит автопилот
const DISCONNECT_GRACE_MS = 30000;  // игрок потерял связь — ждём, потом ходит автопилот
const STARTING_MS = 1500;
const ROOM_TTL_MS = 30 * 60 * 1000; // пустая комната живёт 30 минут
const BOT_NAMES = ['Бот Алиса', 'Бот Борис', 'Бот Вера', 'Бот Гена', 'Бот Даша', 'Бот Егор'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map();        // code → Room
const playerRoom = new Map();   // playerId → code

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return s || 'Игрок';
}

class Room {
  constructor(hostId, maxPlayers) {
    this.code = makeCode();
    this.hostId = hostId;
    this.maxPlayers = clampPlayers(maxPlayers);
    this.game = new Game();
    this.sockets = new Map(); // playerId → Set<ws>
    this.starting = false;
    this.timer = null;
    this.emptySince = null;
  }

  isConnected(id) {
    const s = this.sockets.get(id);
    return !!s && s.size > 0;
  }

  status() {
    return this.starting ? STATUS.STARTING : this.game.status;
  }

  // ───── подключение ─────

  attach(id, ws) {
    if (!this.sockets.has(id)) this.sockets.set(id, new Set());
    this.sockets.get(id).add(ws);
    this.emptySince = null;
  }

  detach(id, ws) {
    const s = this.sockets.get(id);
    if (s) s.delete(ws);
    if (!this.hasHumansOnline()) this.emptySince = Date.now();
    this.broadcast();
  }

  hasHumansOnline() {
    for (const s of this.sockets.values()) if (s.size > 0) return true;
    return false;
  }

  join(id, name) {
    const g = this.game;
    const existing = g.players.find((p) => p.id === id);
    if (existing) {
      if (existing.auto && !existing.isBot && g.status !== STATUS.WAITING) g.setAuto(id, false);
      existing.name = name;
      return;
    }
    if (g.status !== STATUS.WAITING || this.starting) throw new GameError('Игра уже началась');
    if (g.players.length >= this.maxPlayers) throw new GameError('Комната заполнена');
    g.addPlayer({ id, name });
  }

  leave(id) {
    const g = this.game;
    const name = g.players.find((p) => p.id === id)?.name || 'Игрок';
    this.sockets.delete(id);
    if (g.status === STATUS.WAITING && !this.starting) g.removePlayer(id);
    else g.setAuto(id, true);
    g.say(`${name} выходит из комнаты`, 'system');
    if (this.hostId === id) this.migrateHost();
    if (!this.hasHumansOnline()) this.emptySince = Date.now();
  }

  migrateHost() {
    const next = this.game.players.find((p) => !p.isBot && !p.auto && this.sockets.has(p.id));
    this.hostId = next ? next.id : null;
  }

  // ───── команды ─────

  assertHost(id) {
    if (this.hostId !== id) throw new GameError('Это может сделать только создатель комнаты');
  }

  handle(id, msg) {
    const g = this.game;
    switch (msg.action) {
      case 'ADD_BOT':
        this.assertHost(id);
        this.addBot();
        break;
      case 'REMOVE_PLAYER':
        this.assertHost(id);
        if (msg.playerId === id) throw new GameError('Нельзя удалить себя');
        g.removePlayer(msg.playerId);
        playerRoom.delete(msg.playerId);
        this.kick(msg.playerId);
        break;
      case 'SET_MAX_PLAYERS':
        this.assertHost(id);
        if (g.status !== STATUS.WAITING) throw new GameError('Игра уже идёт');
        this.maxPlayers = Math.max(clampPlayers(msg.maxPlayers), g.players.length);
        break;
      case 'START_GAME':
        this.assertHost(id);
        this.start();
        break;
      case 'NEXT_ROUND':
        if (g.status !== STATUS.ROUND_FINISHED) throw new GameError('Раунд ещё не закончен');
        if (this.hostId && this.hostId !== id) throw new GameError('Следующий раунд запускает создатель комнаты');
        g.nextRound();
        break;
      case 'PLAY_AGAIN':
        this.assertHost(id);
        g.restart();
        break;
      case 'BACK_TO_LOBBY':
        this.assertHost(id);
        if (g.status !== STATUS.GAME_FINISHED) throw new GameError('Игра ещё не закончена');
        g.backToLobby();
        for (const p of [...g.players]) if (p.auto && !p.isBot) g.removePlayer(p.id);
        break;
      case 'PLAY_CARD':
        g.playCard(id, msg.cardId, msg.suit, msg.version);
        break;
      case 'DRAW_CARD':
        g.drawCard(id, msg.version);
        break;
      case 'TAKE_PENALTY':
        g.takePenalty(id, msg.version);
        break;
      case 'PASS':
        g.pass(id, msg.version);
        break;
      default:
        throw new GameError('Неизвестное действие');
    }
    this.broadcast();
  }

  addBot() {
    const g = this.game;
    if (g.players.length >= this.maxPlayers) throw new GameError('Комната заполнена');
    const used = new Set(g.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Бот ${g.players.length + 1}`;
    g.addPlayer({ id: 'bot_' + crypto.randomUUID().slice(0, 8), name, isBot: true });
  }

  start() {
    const g = this.game;
    if (g.status !== STATUS.WAITING || this.starting) throw new GameError('Игра уже идёт');
    if (g.players.length < MIN_PLAYERS) throw new GameError(`Нужно минимум ${MIN_PLAYERS} игрока`);
    this.starting = true;
    setTimeout(() => {
      this.starting = false;
      try { g.start(); } catch (e) { console.error(e); }
      this.broadcast();
    }, STARTING_MS);
  }

  kick(id) {
    const s = this.sockets.get(id);
    if (s) for (const ws of s) send(ws, { type: 'LEFT_ROOM', reason: 'Вас удалили из комнаты' });
    this.sockets.delete(id);
  }

  // ───── рассылка и автопилот ─────

  snapshot(id) {
    return {
      type: 'STATE',
      room: {
        code: this.code,
        hostId: this.hostId,
        maxPlayers: this.maxPlayers,
        status: this.status(),
        online: Object.fromEntries(this.game.players.map((p) => [p.id, p.isBot || this.isConnected(p.id)])),
      },
      you: id,
      game: this.game.view(id),
    };
  }

  broadcast() {
    for (const [id, set] of this.sockets) {
      if (!set.size) continue;
      const data = JSON.stringify(this.snapshot(id));
      for (const ws of set) if (ws.readyState === 1) ws.send(data);
    }
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    const g = this.game;
    if (g.status !== STATUS.PLAYING) return;
    const p = g.current;
    let delay;
    if (p.isBot) delay = BOT_DELAY_MS[0] + Math.random() * (BOT_DELAY_MS[1] - BOT_DELAY_MS[0]);
    else if (p.auto) delay = AUTO_DELAY_MS;
    else if (!this.isConnected(p.id)) delay = DISCONNECT_GRACE_MS;
    else return;
    const version = g.version;
    this.timer = setTimeout(() => this.autoMove(version), delay);
  }

  autoMove(version) {
    const g = this.game;
    if (g.status !== STATUS.PLAYING || g.version !== version) return;
    const id = g.current.id;
    const m = botAction(g);
    try {
      this.applyAuto(id, m);
    } catch (e) {
      // На всякий случай — чтобы игра никогда не зависла на автопилоте
      console.error('autopilot', e.message, m);
      try { g.drawnCardId ? g.pass(id) : g.drawCard(id); } catch (e2) { console.error('autopilot fallback', e2.message); }
    }
    this.broadcast();
  }

  applyAuto(id, m) {
    const g = this.game;
    if (m.action === 'PLAY_CARD') g.playCard(id, m.cardId, m.suit);
    else if (m.action === 'DRAW_CARD') g.drawCard(id);
    else if (m.action === 'TAKE_PENALTY') g.takePenalty(id);
    else if (m.action === 'PASS') g.pass(id);
  }
}

function clampPlayers(n) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v)) return MAX_PLAYERS;
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, v));
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function createRoom(id, name, maxPlayers) {
  leaveCurrent(id);
  const room = new Room(id, maxPlayers);
  rooms.set(room.code, room);
  room.join(id, cleanName(name));
  playerRoom.set(id, room.code);
  return room;
}

// Одиночная игра: комната сразу заполняется ботами и стартует
function createBotGame(id, name, bots) {
  const n = Math.min(MAX_PLAYERS - 1, Math.max(1, Number.parseInt(bots, 10) || 1));
  const room = createRoom(id, name, n + 1);
  for (let i = 0; i < n; i++) room.addBot();
  room.start();
  return room;
}

function joinRoom(id, name, code) {
  const room = rooms.get(String(code || '').toUpperCase().trim());
  if (!room) throw new GameError('Комната не найдена');
  if (playerRoom.get(id) !== room.code) leaveCurrent(id);
  room.join(id, cleanName(name));
  playerRoom.set(id, room.code);
  if (!room.hostId) room.hostId = id;
  return room;
}

function leaveCurrent(id) {
  const code = playerRoom.get(id);
  if (!code) return;
  playerRoom.delete(id);
  const room = rooms.get(code);
  if (!room) return;
  room.leave(id);
  room.broadcast();
}

function roomOf(id) {
  const code = playerRoom.get(id);
  return code ? rooms.get(code) || null : null;
}

// Удаляем комнаты, где давно никого нет
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince && now - room.emptySince > ROOM_TTL_MS) {
      clearTimeout(room.timer);
      for (const p of room.game.players) if (playerRoom.get(p.id) === code) playerRoom.delete(p.id);
      rooms.delete(code);
    }
  }
}, 60 * 1000).unref();

module.exports = { createRoom, createBotGame, joinRoom, leaveCurrent, roomOf, cleanName, send, rooms };
