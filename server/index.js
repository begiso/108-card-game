'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { GameError } = require('./game/engine');
const { createRoom, createBotGame, joinRoom, leaveCurrent, roomOf, send } = require('./rooms');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

// ───── статика ─────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    else if (err) file = path.join(PUBLIC_DIR, 'index.html'); // /room/ABCD и т. п.
    fs.readFile(file, (err2, data) => {
      if (err2) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
});

// ───── WebSocket ─────
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.playerId = null;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      handle(ws, msg);
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      send(ws, { type: 'ERROR', message: e instanceof GameError ? e.message : 'Ошибка сервера', requestId: msg.requestId });
      // После ошибки присылаем актуальное состояние, чтобы клиент не «застрял»
      const room = ws.playerId && roomOf(ws.playerId);
      if (room) send(ws, room.snapshot(ws.playerId));
    }
  });

  ws.on('close', () => {
    const room = ws.playerId && roomOf(ws.playerId);
    if (room) room.detach(ws.playerId, ws);
  });
});

function handle(ws, msg) {
  if (msg.action === 'HELLO') {
    const id = String(msg.playerId || '');
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) throw new GameError('Некорректный идентификатор игрока');
    ws.playerId = id;
    send(ws, { type: 'HELLO_OK' });
    // Reconnect: если игрок уже в комнате — возвращаем его туда
    const room = roomOf(id);
    if (room) {
      room.attach(id, ws);
      room.broadcast();
    } else {
      send(ws, { type: 'NO_ROOM' });
    }
    return;
  }

  const id = ws.playerId;
  if (!id) throw new GameError('Нет соединения с игроком');

  switch (msg.action) {
    case 'CREATE_ROOM': {
      const room = createRoom(id, msg.name, msg.maxPlayers);
      room.attach(id, ws);
      room.broadcast();
      return;
    }
    case 'PLAY_WITH_BOTS': {
      const room = createBotGame(id, msg.name, msg.bots);
      room.attach(id, ws);
      room.broadcast();
      return;
    }
    case 'JOIN_ROOM': {
      const room = joinRoom(id, msg.name, msg.code);
      room.attach(id, ws);
      room.broadcast();
      return;
    }
    case 'LEAVE_ROOM':
      leaveCurrent(id);
      send(ws, { type: 'LEFT_ROOM' });
      return;
    default: {
      const room = roomOf(id);
      if (!room) throw new GameError('Вы не в комнате');
      room.handle(id, msg);
    }
  }
}

// Отключаем «мёртвые» соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000).unref();

server.listen(PORT, () => {
  console.log(`«108» запущена: http://localhost:${PORT}`);
});
