// WebSocket-соединение с автопереподключением.
// Сервер узнаёт игрока по playerId из localStorage — так работает reconnect.

const PID_KEY = '108.playerId';

export function getPlayerId() {
  let id = null;
  try { id = localStorage.getItem(PID_KEY); } catch {}
  if (!id) {
    id = 'p_' + crypto.getRandomValues(new Uint32Array(3)).reduce((s, n) => s + n.toString(36), '');
    try { localStorage.setItem(PID_KEY, id); } catch {}
  }
  return id;
}

export function createConnection({ onMessage, onStatus }) {
  const playerId = getPlayerId();
  let ws = null;
  let retry = 0;
  let queue = [];

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      onStatus(true);
      ws.send(JSON.stringify({ action: 'HELLO', playerId }));
      for (const m of queue) ws.send(JSON.stringify(m));
      queue = [];
    };
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); }
    };
    ws.onclose = () => {
      onStatus(false);
      const delay = Math.min(8000, 400 * 2 ** retry++);
      setTimeout(connect, delay);
    };
  }

  connect();

  return {
    playerId,
    send(msg) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
      else queue.push(msg);
    },
  };
}
