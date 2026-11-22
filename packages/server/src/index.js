// HTTP + WebSocket sunucusu: odalari yonetir, istemciyi statik olarak sunar.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acceptUpgrade } from './ws.js';
import { Room, cleanName } from './room.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
};
const CODE_CHARS = 'ABCDEFGHJKLMNPRSTUVYZ23456789';

export function createServer({ port = 3000, host = '0.0.0.0', clientDir, roomOpts = {} } = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = clientDir || path.resolve(here, '../../client/public');
  const sharedDir = path.resolve(here, '../../engine/src');
  const rooms = new Map();

  function newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(c)) return c;
    }
  }
  function makeRoom() {
    const id = newCode();
    const room = new Room(id, { ...roomOpts, onEmpty: (r) => rooms.delete(r.id) });
    rooms.set(id, room);
    return room;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      let base = root;
      // Istemcinin ihtiyac duydugu paylasilan veri dosyalari (tahta, para bicimi)
      if (rel === '/shared/data.js' || rel === '/shared/util.js') { base = sharedDir; rel = rel.slice(7); }
      const file = path.normalize(path.join(base, rel));
      if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bulunamadı');
    }
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws') return socket.destroy();
    const conn = acceptUpgrade(req, socket);
    if (!conn) return;
    let bound = false;
    const timer = setTimeout(() => { if (!bound) conn.close(1008); }, 10000);
    conn.on('close', () => clearTimeout(timer));
    // Ilk mesaj: create | join
    conn.once('message', (text) => {
      let m;
      try { m = JSON.parse(text); } catch { return conn.close(1003); }
      const token = String(m.token || '').slice(0, 64);
      if (token.length < 8) { conn.send(JSON.stringify({ type: 'error', message: 'Geçersiz oturum.' })); return conn.close(1008); }
      let room;
      if (m.type === 'create') {
        if (cleanName(m.name).length < 2) { conn.send(JSON.stringify({ type: 'error', message: 'Takma ad en az 2 karakter olmalı.' })); return conn.close(1008); }
        room = makeRoom();
      } else if (m.type === 'join') {
        room = rooms.get(String(m.room || '').toUpperCase().trim());
        if (!room) { conn.send(JSON.stringify({ type: 'error', message: 'Oda bulunamadı.', fatal: true })); return conn.close(1008); }
      } else return conn.close(1003);
      const r = room.join(conn, m.name, token);
      if (r.error) {
        conn.send(JSON.stringify({ type: 'error', message: r.error, fatal: true }));
        if (m.type === 'create') room.destroy();
        return conn.close(1008);
      }
      bound = true;
    });
  });

  // Kalp atisi: olu baglantilari temizle
  const hb = setInterval(() => {
    for (const room of rooms.values()) {
      for (const s of room.seats) {
        if (s.kind === 'human' && s.conn) {
          if (!s.conn.alive) { s.conn.close(1001); continue; }
          s.conn.alive = false;
          s.conn.ping();
        }
      }
    }
  }, 20000);
  hb.unref();

  return {
    server, rooms,
    listen: () => new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => {
      clearInterval(hb);
      for (const r of [...rooms.values()]) r.destroy();
      for (const r of rooms.values()) for (const s of r.seats) s.conn?.close?.(1001);
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const app = createServer({ port, roomOpts: { botDelayScale: Number(process.env.BOT_DELAY_SCALE) || 1, timeScale: Number(process.env.TIME_SCALE) || 1 } });
  app.listen().then((p) => console.log(`Emlak Ticareti: İstanbul — http://localhost:${p}`));
}
