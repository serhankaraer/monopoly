// Oda: lobi, koltuklar, oyun, zamanlayicilar, bot suruculeri.
import {
  createGame, applyAction, autoAction, legalActions, viewFor, finishByTime,
  normalizeSettings, defaultSettings, timeLimitOptions, START_CASH_OPTIONS,
} from '../../engine/src/index.js';
import { decide, generateTraits, thinkDelayMs, pickNames } from '../../ai/src/index.js';

const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function cleanName(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
}

export class Room {
  constructor(id, opts = {}) {
    this.id = id;
    this.opts = { graceMs: 30000, cleanupMs: 300000, botDelayScale: 1, onEmpty: () => {}, ...opts };
    this.playerCount = 4;
    const d = defaultSettings();
    this.settings = { mult: d.mult, startCash: d.startCash, timeLimitMinutes: null, houseRules: { ...d.houseRules } };
    this.seats = []; // {kind:'human'|'bot'|'open', name, token, conn, traits, memo, connected, botControl, reclaim, graceTimer}
    for (let i = 0; i < 6; i++) this.seats.push({ kind: 'open' });
    this.host = null; // koltuk numarasi
    this.game = null;
    this.timer = null;
    this.timeTimer = null;
    this.cleanupTimer = null;
    this.rand = Math.random;
    this.lastCurrent = null;
    this.touchCleanup();
  }

  // ------------------------------------------------------------ yardimcilar
  get started() { return this.game != null; }
  humanSeats() { return this.seats.map((s, i) => [s, i]).filter(([s, i]) => s.kind === 'human' && i < this.playerCount); }
  connectedHumans() { return this.humanSeats().filter(([s]) => s.connected).length; }
  seatOfToken(token) { return this.seats.findIndex((s, i) => s.kind === 'human' && s.token === token && (this.started || i < this.playerCount)); }
  usedNames() { return this.seats.filter((s) => s.kind !== 'open').map((s) => s.name); }

  send(seat, msg) {
    const s = this.seats[seat];
    if (s && s.kind === 'human' && s.connected && s.conn) s.conn.send(JSON.stringify(msg));
  }
  broadcast(fn) {
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (s.kind === 'human' && s.connected) this.send(i, typeof fn === 'function' ? fn(i) : fn);
    }
  }
  error(seat, message) { this.send(seat, { type: 'error', message }); }

  touchCleanup() {
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
    if (this.connectedHumans() === 0) {
      this.cleanupTimer = setTimeout(() => this.destroy(), this.opts.cleanupMs);
      this.cleanupTimer.unref?.();
    }
  }
  destroy() {
    clearTimeout(this.timer); clearTimeout(this.timeTimer); clearTimeout(this.cleanupTimer);
    for (const s of this.seats) { clearTimeout(s.graceTimer); }
    this.destroyed = true;
    this.opts.onEmpty(this);
  }

  // ------------------------------------------------------------ katilim
  join(conn, rawName, token) {
    const existing = this.seatOfToken(token);
    if (existing >= 0) return this.reconnect(existing, conn);
    if (this.started) return { error: 'Oyun başladı; yeni oyuncu alınamıyor.' };
    const name = cleanName(rawName);
    if (name.length < 2) return { error: 'Takma ad en az 2 karakter olmalı.' };
    if (this.usedNames().some((n) => n.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) return { error: 'Bu takma ad odada kullanılıyor.' };
    let seat = this.seats.findIndex((s, i) => i < this.playerCount && s.kind === 'open');
    if (seat < 0) seat = this.seats.findIndex((s, i) => i < this.playerCount && s.kind === 'bot');
    if (seat < 0) return { error: 'Oda dolu.' };
    this.seats[seat] = { kind: 'human', name, token, conn, connected: true };
    if (this.host == null) this.host = seat;
    this.bindConn(seat, conn);
    this.touchCleanup();
    this.sendJoined(seat);
    this.pushLobby();
    return { seat };
  }

  reconnect(seat, conn) {
    const s = this.seats[seat];
    if (s.conn && s.conn !== conn) { try { s.conn.removeAllListeners('close'); s.conn.close(1000); } catch { /* */ } }
    clearTimeout(s.graceTimer);
    s.conn = conn;
    s.connected = true;
    if (this.started && s.botControl) s.reclaim = true; // sonraki tur basinda devral
    else s.botControl = false;
    this.bindConn(seat, conn);
    this.touchCleanup();
    this.sendJoined(seat);
    if (this.started) { this.pushState(seat); } else this.pushLobby();
    return { seat };
  }

  bindConn(seat, conn) {
    conn.on('message', (text) => this.onMessage(seat, conn, text));
    conn.on('close', () => this.onDisconnect(seat, conn));
  }
  sendJoined(seat) {
    this.send(seat, { type: 'joined', room: this.id, seat, host: this.host === seat, started: this.started });
  }

  onDisconnect(seat, conn) {
    const s = this.seats[seat];
    if (!s || s.conn !== conn) return;
    s.connected = false;
    s.conn = null;
    if (!this.started) {
      // Lobide: koltugu hemen birak
      this.seats[seat] = { kind: 'open' };
      if (this.host === seat) this.reassignHost();
      this.pushLobby();
    } else {
      clearTimeout(s.graceTimer);
      s.graceTimer = setTimeout(() => {
        s.botControl = true;
        this.afterChange(false); // bot hemen oynayabilir
      }, this.opts.graceMs);
      s.graceTimer.unref?.();
      this.broadcast((i) => this.statusMsg(i));
    }
    this.touchCleanup();
  }

  reassignHost() {
    const next = this.humanSeats().find(([s]) => s.connected);
    this.host = next ? next[1] : null;
    if (this.host != null) this.send(this.host, { type: 'host', host: true });
  }

  // ------------------------------------------------------------ mesajlar
  onMessage(seat, conn, text) {
    let m;
    try { m = JSON.parse(text); } catch { return this.error(seat, 'Geçersiz mesaj.'); }
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'lobby.set': return this.lobbySet(seat, m);
      case 'seat.set': return this.seatSet(seat, m);
      case 'start': return this.start(seat);
      case 'act': return this.humanAct(seat, m.action);
      case 'rematch': return this.rematch(seat);
      case 'leave': return this.leave(seat);
      case 'ping': return this.send(seat, { type: 'pong', t: m.t });
      default: return this.error(seat, 'Bilinmeyen mesaj.');
    }
  }

  lobbySet(seat, m) {
    if (this.started) return this.error(seat, 'Oyun başladı.');
    if (seat !== this.host) return this.error(seat, 'Ayarları yalnızca oda sahibi değiştirebilir.');
    if (m.playerCount != null) {
      const n = clampInt(m.playerCount, 2, 6, this.playerCount);
      const humansBeyond = this.humanSeats().filter(([, i]) => i >= n);
      if (humansBeyond.length) return this.error(seat, 'Bu sayıda oyuncu için koltuklar dolu.');
      this.playerCount = n;
      for (let i = n; i < 6; i++) this.seats[i] = { kind: 'open' };
    }
    const st = m.settings || {};
    if (st.mult != null) this.settings.mult = clampInt(st.mult, 1, 10_000_000, this.settings.mult);
    if (st.startCash != null && START_CASH_OPTIONS.includes(Number(st.startCash))) this.settings.startCash = Number(st.startCash);
    if ('timeLimitMinutes' in st) this.settings.timeLimitMinutes = st.timeLimitMinutes == null ? null : clampInt(st.timeLimitMinutes, 1, 1000, null);
    if (st.houseRules && typeof st.houseRules === 'object') {
      for (const k of ['freeParkingJackpot', 'rentInJail', 'doubleGoLanding', 'evenBuild', 'noBuyFirstLap', 'auction']) {
        if (k in st.houseRules) this.settings.houseRules[k] = !!st.houseRules[k];
      }
    }
    this.pushLobby();
  }

  seatSet(seat, m) {
    if (this.started) return this.error(seat, 'Oyun başladı.');
    if (seat !== this.host) return this.error(seat, 'Koltukları yalnızca oda sahibi değiştirebilir.');
    const i = clampInt(m.seat, 0, 5, -1);
    if (i < 0 || i >= this.playerCount) return this.error(seat, 'Geçersiz koltuk.');
    const cur = this.seats[i];
    if (cur.kind === 'human') return this.error(seat, 'Bu koltukta bir oyuncu var.');
    if (m.kind === 'bot') this.seats[i] = this.makeBot();
    else this.seats[i] = { kind: 'open' };
    this.pushLobby();
  }

  makeBot(used = this.usedNames()) {
    const [name] = pickNames(1, this.rand, used);
    return { kind: 'bot', name, traits: generateTraits(this.rand), memo: {}, connected: false };
  }

  start(seat) {
    if (this.started) return;
    if (seat !== this.host) return this.error(seat, 'Oyunu yalnızca oda sahibi başlatabilir.');
    if (this.humanSeats().length < 1) return this.error(seat, 'En az bir insan oyuncu gerekli.');
    for (let i = 0; i < this.playerCount; i++) {
      if (this.seats[i].kind === 'open') this.seats[i] = this.makeBot();
    }
    const players = this.seats.slice(0, this.playerCount).map((s) => ({ name: s.name }));
    const now = Date.now();
    const settings = normalizeSettings({ ...this.settings, houseRules: { ...this.settings.houseRules }, ...(this.opts.engineSettings || {}) }, this.playerCount);
    this.game = createGame({ players, settings, seed: Math.floor(this.rand() * 2 ** 32), now });
    this.lastCurrent = this.game.current;
    clearTimeout(this.timeTimer);
    if (this.game.settings.timeLimitMinutes) {
      const ms = this.game.settings.timeLimitMinutes * 60000 * (this.opts.timeScale || 1);
      this.timeTimer = setTimeout(() => this.timeUp(), ms);
      this.timeTimer.unref?.();
    }
    for (let i = 0; i < this.playerCount; i++) if (this.seats[i].kind === 'human') this.sendJoined(i);
    this.pushState();
    this.schedule();
  }

  rematch(seat) {
    if (!this.game || this.game.phase !== 'GAME_OVER') return;
    if (seat !== this.host) return this.error(seat, 'Yalnızca oda sahibi yeniden başlatabilir.');
    clearTimeout(this.timer); clearTimeout(this.timeTimer);
    this.game = null;
    for (let i = 0; i < 6; i++) {
      const s = this.seats[i];
      if (s.kind === 'bot') this.seats[i] = { kind: 'open' };
      else if (s.kind === 'human') {
        if (!s.connected) this.seats[i] = { kind: 'open' };
        else { s.botControl = false; s.reclaim = false; }
      }
    }
    if (this.seats[this.host]?.kind !== 'human') this.reassignHost();
    for (let i = 0; i < this.playerCount; i++) if (this.seats[i].kind === 'human') this.sendJoined(i);
    this.pushLobby();
    this.touchCleanup();
  }

  leave(seat) {
    const s = this.seats[seat];
    if (!s || s.kind !== 'human') return;
    const conn = s.conn;
    if (!this.started) {
      this.seats[seat] = { kind: 'open' };
      if (this.host === seat) this.reassignHost();
      this.pushLobby();
    } else {
      Object.assign(s, { kind: 'bot', traits: generateTraits(this.rand), memo: {}, connected: false, conn: null, botControl: false });
      clearTimeout(s.graceTimer);
      if (this.host === seat) this.reassignHost();
      this.afterChange(false);
    }
    if (conn) { conn.removeAllListeners('close'); conn.removeAllListeners('message'); conn.close(1000); }
    this.touchCleanup();
    if (this.humanSeats().length === 0) this.destroy();
  }

  // ------------------------------------------------------------ oyun
  humanAct(seat, action) {
    if (!this.game) return this.error(seat, 'Oyun başlamadı.');
    const s = this.seats[seat];
    if (s.botControl) return this.error(seat, 'Koltuğunu bot yönetiyor; sıran gelince devralırsın.');
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') return this.error(seat, 'Geçersiz hamle.');
    const r = this.apply(seat, action);
    if (r.error) this.error(seat, r.error);
  }

  apply(pid, action) {
    const r = applyAction(this.game, pid, action, { now: Date.now() });
    if (r.error) return r;
    this.commit(r);
    return r;
  }

  commit(r) {
    this.game = r.state;
    if (r.events?.length) this.broadcast({ type: 'events', seq: this.game.seq, list: r.events });
    this.afterChange(true);
  }

  timeUp() {
    if (!this.game || this.game.phase === 'GAME_OVER') return;
    const r = finishByTime(this.game, Date.now());
    this.commit(r);
  }

  isBotSeat(i) {
    const s = this.seats[i];
    return s.kind === 'bot' || (s.kind === 'human' && s.botControl);
  }

  afterChange(push) {
    if (!this.game) return;
    const g = this.game;
    // Sira degisti: devralmak isteyen insanlar kontrolu geri alir
    if (g.current !== this.lastCurrent) {
      this.lastCurrent = g.current;
      const s = this.seats[g.current];
      if (s?.kind === 'human' && s.reclaim && s.connected) { s.botControl = false; s.reclaim = false; }
    }
    if (push) this.pushState(); else this.broadcast((i) => this.statusMsg(i));
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    const g = this.game;
    if (!g || g.phase === 'GAME_OVER') return;
    const actor = g.actor;
    if (actor == null) return;
    const now = Date.now();
    const untilDeadline = Math.max(0, g.deadline - now);
    if (this.isBotSeat(actor)) {
      const seat = this.seats[actor];
      const traits = seat.traits || (seat.traits = generateTraits(this.rand)); seat.memo ||= {};
      let delay = thinkDelayMs(traits);
      if (g.phase === 'AUCTION') delay *= 0.5;
      if (g.phase === 'DEBT') delay = Math.min(delay, 800);
      delay = Math.min(delay * this.opts.botDelayScale, untilDeadline);
      this.timer = setTimeout(() => this.botMove(actor), delay);
    } else {
      this.timer = setTimeout(() => this.timeout(g.seq, actor), untilDeadline + 50);
    }
    this.timer.unref?.();
  }

  botMove(actor) {
    const g = this.game;
    if (!g || g.actor !== actor || g.phase === 'GAME_OVER') return;
    const seat = this.seats[actor];
    seat.traits ||= generateTraits(this.rand); seat.memo ||= {};
    let action = null;
    try { action = decide(g, actor, seat.traits, this.rand, seat.memo); } catch (e) { action = null; }
    let r = action ? this.tryApply(actor, action) : null;
    if (!r || r.error) {
      const a = autoAction(g);
      r = a ? this.tryApply(a.pid, a.action) : null;
    }
  }
  tryApply(pid, action) {
    const r = applyAction(this.game, pid, action, { now: Date.now() });
    if (r.error) return r;
    this.commit(r);
    return r;
  }

  timeout(seq, actor) {
    const g = this.game;
    if (!g || g.seq !== seq || g.actor !== actor || g.phase === 'GAME_OVER') return;
    if (Date.now() < g.deadline) { this.schedule(); return; }
    const a = autoAction(g);
    if (a) this.tryApply(a.pid, a.action);
  }

  // ------------------------------------------------------------ gonderim
  lobbyMsg(forSeat) {
    return {
      type: 'lobby',
      room: this.id,
      host: this.host,
      you: forSeat,
      playerCount: this.playerCount,
      settings: this.settings,
      timeOptions: timeLimitOptions(this.playerCount),
      cashOptions: START_CASH_OPTIONS,
      seats: this.seats.slice(0, this.playerCount).map((s, i) => ({
        seat: i, kind: s.kind, name: s.name ?? null, connected: !!s.connected,
      })),
    };
  }
  pushLobby() { this.broadcast((i) => this.lobbyMsg(i)); }

  statusMsg(forSeat) {
    return {
      type: 'timer',
      deadline: this.game?.deadline ?? null,
      serverNow: Date.now(),
      seats: this.seatStatus(),
      you: forSeat,
    };
  }
  seatStatus() {
    return this.seats.slice(0, this.playerCount).map((s) => ({
      human: s.kind === 'human', connected: !!s.connected, bot: s.kind === 'bot' || !!s.botControl,
    }));
  }
  stateMsg(seat) {
    const g = this.game;
    return {
      type: 'state',
      seq: g.seq,
      you: seat,
      view: viewFor(g),
      legal: g.phase === 'GAME_OVER' ? [] : legalActions(g, seat),
      actor: g.actor,
      deadline: g.deadline,
      serverNow: Date.now(),
      seats: this.seatStatus(),
      host: this.host,
    };
  }
  pushState(only) {
    if (!this.game) return;
    if (only != null) return this.send(only, this.stateMsg(only));
    this.broadcast((i) => this.stateMsg(i));
  }
}
