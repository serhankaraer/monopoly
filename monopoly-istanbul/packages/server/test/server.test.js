import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.msgs = [];
    this.waiters = [];
    this.closed = false;
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      this.msgs.push(m);
      if (m.type === 'state') this.state = m;
      if (m.type === 'lobby') this.lobby = m;
      if (m.type === 'joined') this.joined = m;
      this.waiters = this.waiters.filter((w) => !w(m));
    };
    this.ws.onclose = () => { this.closed = true; this.waiters = this.waiters.filter((w) => !w(null)); };
    this.opened = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
  }
  async send(o) { await this.opened; this.ws.send(JSON.stringify(o)); }
  next(pred, ms = 5000) {
    const found = this.msgs.find(pred);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('zaman asimi')), ms);
      this.waiters.push((m) => {
        if (m && pred(m)) { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); res(m); return true; }
        if (m === null) { clearTimeout(t); rej(new Error('baglanti kapandi')); return true; }
        return false;
      });
    });
  }
  close() { try { this.ws.close(); } catch { /* */ } }
}

async function boot(roomOpts = {}) {
  const app = createServer({ port: 0, host: '127.0.0.1', roomOpts });
  const port = await app.listen();
  return { app, port };
}
const tok = (n) => 'token-' + n + '-xxxxxxxx';

test('oda kur, lobi ayarlari, baslat, botlar dolar', async () => {
  const { app, port } = await boot({ botDelayScale: 0.01 });
  const a = new Client(port);
  await a.send({ type: 'create', name: 'Serhan', token: tok(1) });
  const j = await a.next((m) => m.type === 'joined');
  assert.equal(j.seat, 0);
  assert.equal(j.host, true);
  assert.match(j.room, /^[A-Z0-9]{4}$/);
  let l = await a.next((m) => m.type === 'lobby');
  assert.equal(l.playerCount, 4);
  await a.send({ type: 'lobby.set', playerCount: 3, settings: { mult: 1000, houseRules: { auction: false } } });
  l = await a.next((m) => m.type === 'lobby' && m.playerCount === 3);
  assert.equal(l.settings.mult, 1000);
  assert.equal(l.settings.houseRules.auction, false);
  assert.equal(l.seats.length, 3);
  await a.send({ type: 'seat.set', seat: 1, kind: 'bot' });
  l = await a.next((m) => m.type === 'lobby' && m.seats[1].kind === 'bot');
  assert.ok(l.seats[1].name);
  await a.send({ type: 'start' });
  const st = await a.next((m) => m.type === 'state');
  assert.equal(st.view.players.length, 3);
  assert.equal(st.view.settings.mult, 1000);
  assert.equal(st.view.rng, undefined);
  assert.equal(st.you, 0);
  assert.ok(st.view.players.every((p) => p.cash === 1500 * 1000));
  assert.ok(st.deadline > st.serverNow);
  a.close();
  await app.close();
});

test('ikinci oyuncu katilir; yetkisiz islemler reddedilir; ad cakismasi', async () => {
  const { app, port } = await boot({ botDelayScale: 0.01 });
  const a = new Client(port);
  await a.send({ type: 'create', name: 'Ayşe', token: tok(1) });
  const code = (await a.next((m) => m.type === 'joined')).room;
  const b = new Client(port);
  await b.send({ type: 'join', room: code.toLowerCase(), name: 'Bora', token: tok(2) });
  const jb = await b.next((m) => m.type === 'joined');
  assert.equal(jb.seat, 1);
  assert.equal(jb.host, false);
  await b.send({ type: 'lobby.set', playerCount: 6 });
  assert.match((await b.next((m) => m.type === 'error')).message, /oda sahibi/);
  await b.send({ type: 'start' });
  assert.match((await b.next((m) => m.type === 'error')).message, /oda sahibi/);
  const c = new Client(port);
  await c.send({ type: 'join', room: code, name: 'ayşe', token: tok(3) });
  assert.match((await c.next((m) => m.type === 'error')).message, /kullanılıyor/);
  const d = new Client(port);
  await d.send({ type: 'join', room: 'ZZZZ', name: 'Deniz', token: tok(4) });
  assert.match((await d.next((m) => m.type === 'error')).message, /bulunamadı/i);
  await a.send({ type: 'start' });
  const st = await b.next((m) => m.type === 'state');
  assert.equal(st.you, 1);
  assert.equal(st.view.players.length, 4);
  // gecersiz hamleler
  const other = st.actor === 1 ? a : b;
  await other.send({ type: 'act', action: { type: 'ROLL' } });
  assert.ok((await other.next((m) => m.type === 'error')).message);
  [a, b, c, d].forEach((x) => x.close());
  await app.close();
});

test('buyuk mesajlar (16 ve 64 bit uzunluk) ve parcalama', async () => {
  const { app, port } = await boot();
  const a = new Client(port);
  await a.send({ type: 'create', name: 'Uzun', token: tok(9) });
  await a.next((m) => m.type === 'joined');
  await a.send({ type: 'ping', t: 'x'.repeat(70000) });
  const p = await a.next((m) => m.type === 'pong');
  assert.equal(p.t.length, 70000);
  await a.send({ type: 'ping', t: 'y'.repeat(300) });
  assert.equal((await a.next((m) => m.type === 'pong')).t.length, 300);
  a.close();
  await app.close();
});

test('insan oyuncu: sure dolunca otomatik hamle; bot oynamaya devam eder', async () => {
  const { app, port } = await boot({ botDelayScale: 0.01, engineSettings: { turnSeconds: 1 } });
  const a = new Client(port);
  await a.send({ type: 'create', name: 'Uykucu', token: tok(1) });
  await a.next((m) => m.type === 'joined');
  await a.send({ type: 'lobby.set', playerCount: 2 });
  await a.send({ type: 'start' });
  const first = await a.next((m) => m.type === 'state');
  // hic hamle yapmadan ilerlemeli
  const later = await a.next((m) => m.type === 'state' && m.seq >= first.seq + 6, 15000);
  assert.ok(later.seq > first.seq);
  a.close();
  await app.close();
});

test('baglanti kopar -> bot devralir; geri gelince sonraki turda kontrol doner', async () => {
  const { app, port } = await boot({ botDelayScale: 0.01, graceMs: 150, engineSettings: { turnSeconds: 2 } });
  const a = new Client(port);
  await a.send({ type: 'create', name: 'Kopuk', token: tok(1) });
  const code = (await a.next((m) => m.type === 'joined')).room;
  await a.send({ type: 'lobby.set', playerCount: 2 });
  await a.send({ type: 'start' });
  await a.next((m) => m.type === 'state');
  a.close();
  await sleep(100);
  const room = app.rooms.get(code);
  assert.equal(room.seats[0].connected, false);
  assert.equal(!!room.seats[0].botControl, false); // tolerans suresi icinde
  await sleep(250);
  assert.equal(room.seats[0].botControl, true);
  const seq1 = room.game.seq;
  await sleep(600);
  assert.ok(room.game.seq > seq1 + 3, 'bot oyunu ilerletmeli');
  // geri bagla
  const b = new Client(port);
  await b.send({ type: 'join', room: code, name: 'Kopuk', token: tok(1) });
  const jb = await b.next((m) => m.type === 'joined');
  assert.equal(jb.seat, 0);
  const st = await b.next((m) => m.type === 'state');
  assert.equal(st.you, 0);
  // sonraki tur basinda kontrol insana doner
  const deadline = Date.now() + 15000;
  while (room.seats[0].botControl && Date.now() < deadline) await sleep(50);
  assert.equal(room.seats[0].botControl, false);
  b.close();
  await app.close();
});

test('tam oyun: bir insan + botlar, insan legal listesinden oynar', async () => {
  const { app, port } = await boot({ botDelayScale: 0.002, engineSettings: { turnSeconds: 3 } });
  const a = new Client(port);
  await a.send({ type: 'create', name: 'Oyuncu', token: tok(1) });
  await a.next((m) => m.type === 'joined');
  await a.send({ type: 'lobby.set', playerCount: 3, settings: { mult: 1 } });
  await a.send({ type: 'start' });
  let last = null;
  let humanMoves = 0;
  const end = Date.now() + 25000;
  let over = false;
  while (Date.now() < end) {
    const m = await a.next((x) => x.type === 'state', 5000).catch(() => null);
    if (!m) break;
    last = m;
    if (m.view.phase === 'GAME_OVER') { over = true; break; }
    if (m.actor === 0 && m.legal.length) {
      const pick = m.legal.find((x) => ['ROLL', 'BUY', 'END_TURN', 'PASS_BID', 'AUTO_DEBT', 'TRADE_REJECT', 'DECLINE_BUY'].includes(x.type)) || m.legal[0];
      let action = pick;
      if (pick.type === 'BID') action = { type: 'PASS_BID' };
      await a.send({ type: 'act', action });
      humanMoves++;
    }
  }
  assert.ok(humanMoves > 10, `insan hamlesi: ${humanMoves}`);
  assert.ok(last.seq > 50);
  // sure siniri ile bitirme
  console.log(`  [bilgi] seq ${last.seq}, oyun bitti: ${over}, insan hamlesi ${humanMoves}`);
  a.close();
  await app.close();
});

test('sure siniri dolunca oyun net servete gore biter', async () => {
  const { app, port } = await boot({ botDelayScale: 0.01, timeScale: 0.00005 });
  const a = new Client(port);
  await a.send({ type: 'create', name: 'Sureli', token: tok(1) });
  await a.next((m) => m.type === 'joined');
  await a.send({ type: 'lobby.set', playerCount: 2, settings: { timeLimitMinutes: 15 } });
  await a.send({ type: 'start' });
  const over = await a.next((m) => m.type === 'state' && m.view.phase === 'GAME_OVER', 8000);
  assert.equal(over.view.endReason, 'time');
  assert.ok(over.view.ranking.length >= 1);
  assert.deepEqual(over.legal, []);
  // yeniden baslat -> lobi
  await a.send({ type: 'rematch' });
  const l = await a.next((m) => m.type === 'lobby');
  assert.equal(l.seats[1].kind, 'open');
  a.close();
  await app.close();
});

test('bos oda temizlenir; ayrilan insanin yerine bot gecer', async () => {
  const { app, port } = await boot({ botDelayScale: 0.01, cleanupMs: 150 });
  const a = new Client(port);
  await a.send({ type: 'create', name: 'Gecici', token: tok(1) });
  const code = (await a.next((m) => m.type === 'joined')).room;
  const b = new Client(port);
  await b.send({ type: 'join', room: code, name: 'Ikinci', token: tok(2) });
  await b.next((m) => m.type === 'joined');
  await a.send({ type: 'lobby.set', playerCount: 2 });
  await a.send({ type: 'start' });
  await a.next((m) => m.type === 'state');
  await b.send({ type: 'leave' });
  await sleep(50);
  const room = app.rooms.get(code);
  assert.equal(room.seats[1].kind, 'bot');
  a.close();
  await sleep(400);
  assert.equal(app.rooms.has(code), false);
  await app.close();
});

test('statik dosya ve saglik ucu', async () => {
  const { app, port } = await boot();
  const r = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(await r.text(), 'ok');
  const r2 = await fetch(`http://127.0.0.1:${port}/../../package.json`);
  assert.ok([403, 404].includes(r2.status));
  await app.close();
});

test('istemci dosyalari ve paylasilan veri sunulur', async () => {
  const { app, port } = await boot();
  for (const f of ['/', '/app.js', '/board.js', '/util.js', '/style.css', '/shared/data.js', '/shared/util.js']) {
    const r = await fetch(`http://127.0.0.1:${port}${f}`);
    assert.equal(r.status, 200, f);
  }
  const bad = await fetch(`http://127.0.0.1:${port}/shared/engine.js`);
  assert.equal(bad.status, 404);
  await app.close();
});
