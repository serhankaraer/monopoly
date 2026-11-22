// Saf oyun motoru: applyAction(state, oyuncuId, action, { now }) -> { state, events } | { error }
// Durum JSON uyumludur; her uygulamada kopyalanir (girdi durumu degismez).

import { SQUARES, PROP_SQUARES, STATIONS, UTILITIES, GROUPS, BASE, timeLimitOptions } from './data.js';
import { DECKS, CARD_BY_ID } from './cards.js';
import { rnd, shuffle, fmt } from './util.js';

export const PHASES = ['ROLL', 'BUY', 'AUCTION', 'DEBT', 'POST', 'TRADE', 'GAME_OVER'];

export function defaultSettings() {
  return {
    mult: 50000,
    startCash: BASE.startCash,
    timeLimitMinutes: null,
    turnSeconds: 30,
    tradeSeconds: 15,
    houseRules: {
      freeParkingJackpot: false,
      rentInJail: true,
      doubleGoLanding: false,
      evenBuild: true,
      noBuyFirstLap: false,
      auction: true,
    },
  };
}

export function normalizeSettings(input = {}, playerCount = 2) {
  const d = defaultSettings();
  const s = { ...d, ...input, houseRules: { ...d.houseRules, ...(input.houseRules || {}) } };
  s.mult = Math.max(1, Math.round(Number(s.mult) || d.mult));
  s.startCash = Math.max(100, Math.round(Number(s.startCash) || d.startCash));
  if (s.timeLimitMinutes != null) {
    const opts = timeLimitOptions(playerCount);
    const v = Math.round(Number(s.timeLimitMinutes));
    s.timeLimitMinutes = opts.includes(v) ? v : opts.find((o) => o >= v) ?? opts[opts.length - 1];
  }
  return s;
}

// ---------------------------------------------------------------- yardimcilar

const M = (s, base) => base * s.settings.mult;
const P = (s, id) => s.players[id];
const cur = (s) => s.players[s.current];
const alive = (s) => s.players.filter((p) => !p.bankrupt);
const rules = (s) => s.settings.houseRules;
const clone = (x) => structuredClone(x);

export function ownedSquares(s, id) {
  return PROP_SQUARES.filter((i) => s.props[i].owner === id);
}
function ownsAll(s, id, group) {
  return GROUPS[group].every((i) => s.props[i].owner === id);
}
function groupHouses(s, group) {
  return GROUPS[group].map((i) => s.props[i].houses);
}
function countOwned(s, id, list) {
  return list.filter((i) => s.props[i].owner === id).length;
}
function mortgageValueBase(q) {
  return q.price / 2;
}
function unmortgageCost(s, sq) {
  return M(s, Math.ceil((mortgageValueBase(SQUARES[sq]) * 11) / 10));
}
function houseCost(s, sq) {
  return M(s, SQUARES[sq].house);
}

export function rentFor(s, sq, diceSum, opts = {}) {
  const q = SQUARES[sq];
  const pr = s.props[sq];
  if (pr.owner == null || pr.mortgaged) return 0;
  let base = 0;
  if (q.type === 'street') {
    if (pr.houses > 0) base = q.rent[pr.houses];
    else base = q.rent[0] * (ownsAll(s, pr.owner, q.group) ? 2 : 1);
  } else if (q.type === 'station') {
    base = 25 * 2 ** (countOwned(s, pr.owner, STATIONS) - 1);
    if (opts.double) base *= 2;
  } else if (q.type === 'utility') {
    const factor = opts.tenTimes ? 10 : countOwned(s, pr.owner, UTILITIES) === 2 ? 10 : 4;
    base = factor * (diceSum || 0);
  }
  return M(s, base);
}

export function netWorth(s, id) {
  const p = P(s, id);
  let w = p.cash;
  for (const i of ownedSquares(s, id)) {
    const q = SQUARES[i];
    const pr = s.props[i];
    w += M(s, pr.mortgaged ? mortgageValueBase(q) : q.price);
    if (q.type === 'street') w += pr.houses * M(s, q.house);
  }
  return w;
}

function say(s, ev, obj) {
  ev.push(obj);
  if (obj.msg) {
    s.log.push(obj.msg);
    if (s.log.length > 80) s.log.splice(0, s.log.length - 80);
  }
}

function setPhase(s, phase, actor, now, secs) {
  s.phase = phase;
  s.actor = actor;
  s.deadline = phase === 'GAME_OVER' ? null : now + (secs ?? s.settings.turnSeconds) * 1000;
}

// ---------------------------------------------------------------- olusturma

export function createGame({ players, settings, seed, now }) {
  const n = players.length;
  if (n < 2 || n > 6) throw new Error('Oyuncu sayısı 2-6 olmalı.');
  const set = normalizeSettings(settings, n);
  const s = {
    v: 1,
    settings: set,
    rng: (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0,
    seq: 0,
    log: [],
    players: players.map((p, id) => ({
      id,
      name: p.name,
      cash: set.startCash * set.mult,
      pos: 0,
      inJail: false,
      jailTries: 0,
      cards: [],
      bankrupt: false,
      laps: 0,
    })),
    props: {},
    decks: {},
    housesLeft: BASE.houses,
    hotelsLeft: BASE.hotels,
    pool: 0,
    current: 0,
    doubles: 0,
    extraRoll: false,
    turnEnds: false,
    dice: null,
    phase: 'ROLL',
    actor: 0,
    deadline: null,
    buy: null,
    auction: null,
    auctionQueue: [],
    debts: [],
    trade: null,
    resume: null,
    startedAt: now ?? Date.now(),
    turnNo: 1,
    winner: null,
    endReason: null,
    ranking: null,
  };
  for (const i of PROP_SQUARES) s.props[i] = { owner: null, mortgaged: false, houses: 0 };
  for (const [name, cards] of Object.entries(DECKS)) {
    s.decks[name] = { order: shuffle(cards.map((c) => c.id), s) };
  }
  s.current = Math.floor(rnd(s) * n);
  setPhase(s, 'ROLL', s.current, s.startedAt);
  s.log.push(`Oyun başladı. İlk sıra ${cur(s).name} oyuncusunda.`);
  return s;
}

export function viewFor(s) {
  const v = clone(s);
  delete v.rng;
  v.decks = { chance: { left: s.decks.chance.order.length }, chest: { left: s.decks.chest.order.length } };
  return v;
}

// ---------------------------------------------------------------- dogrulama

function liquidateAllowed(s, pid) {
  return (
    ((s.phase === 'ROLL' || s.phase === 'POST') && s.current === pid) ||
    (s.phase === 'DEBT' && s.debts[0] && s.debts[0].debtor === pid)
  );
}
function manageAllowed(s, pid) {
  return (s.phase === 'ROLL' || s.phase === 'POST') && s.current === pid;
}
function tradeItemsError(s, pid, side, items) {
  const seen = new Set();
  for (const sq of items.props || []) {
    if (!PROP_SQUARES.includes(sq) || seen.has(sq)) return 'Geçersiz mülk.';
    seen.add(sq);
    if (s.props[sq].owner !== pid) return `${SQUARES[sq].name} sana ait değil.`;
    const q = SQUARES[sq];
    if (q.type === 'street' && groupHouses(s, q.group).some((h) => h > 0)) {
      return `${q.name} grubunda bina var; önce binaları sat.`;
    }
  }
  if (!Number.isInteger(items.cash) || items.cash < 0) return 'Geçersiz para tutarı.';
  if (!Number.isInteger(items.jailCards || 0) || (items.jailCards || 0) < 0) return 'Geçersiz kart sayısı.';
  if (items.cash > P(s, pid).cash) return 'Yeterli nakit yok.';
  if ((items.jailCards || 0) > P(s, pid).cards.length) return 'Yeterli Kodes kartı yok.';
  return null;
}
function tradeFee(s, receiver, props) {
  // Ipotekli mulk alan, ipotek degerinin %10'unu bankaya hemen oder.
  return props.reduce((sum, sq) => sum + (s.props[sq].mortgaged ? M(s, Math.ceil(mortgageValueBase(SQUARES[sq]) / 10)) : 0), 0);
}

export function validate(s, pid, a) {
  if (!a || typeof a.type !== 'string') return 'Geçersiz hamle.';
  if (s.phase === 'GAME_OVER') return 'Oyun bitti.';
  const p = s.players[pid];
  if (!p || p.bankrupt) return 'Oyuncu oyunda değil.';
  const r = rules(s);
  switch (a.type) {
    case 'ROLL':
      if (s.current !== pid) return 'Sıra sende değil.';
      if (s.phase === 'ROLL') return null;
      if (s.phase === 'POST' && s.extraRoll) return null;
      return 'Şu an zar atılamaz.';
    case 'JAIL_PAY':
      if (s.phase !== 'ROLL' || s.current !== pid || !p.inJail) return 'Kodes ücreti şu an ödenemez.';
      if (p.cash < M(s, BASE.jailFee)) return 'Yeterli nakit yok.';
      return null;
    case 'JAIL_USE_CARD':
      if (s.phase !== 'ROLL' || s.current !== pid || !p.inJail) return 'Kart şu an kullanılamaz.';
      if (p.cards.length === 0) return 'Kartın yok.';
      return null;
    case 'END_TURN':
      if (s.phase !== 'POST' || s.current !== pid) return 'Turu şu an bitiremezsin.';
      if (s.extraRoll) return 'Çift attığın için tekrar zar atmalısın.';
      return null;
    case 'BUY':
    case 'DECLINE_BUY':
      if (s.phase !== 'BUY' || !s.buy || s.buy.pid !== pid) return 'Satın alma sırası sende değil.';
      return null;
    case 'BID': {
      if (s.phase !== 'AUCTION' || s.actor !== pid) return 'Müzayede sırası sende değil.';
      const au = s.auction;
      const min = au.high ? au.high + M(s, BASE.auctionInc) : M(s, BASE.auctionMin);
      if (!Number.isInteger(a.amount)) return 'Geçersiz teklif.';
      if (a.amount < min) return `Teklif en az ${fmt(min)} olmalı.`;
      if (a.amount > p.cash) return 'Teklif nakdini aşıyor.';
      return null;
    }
    case 'PASS_BID':
      if (s.phase !== 'AUCTION' || s.actor !== pid) return 'Müzayede sırası sende değil.';
      if (s.auction.highBidder === pid) return 'En yüksek teklif sende.';
      return null;
    case 'BUILD': {
      if (!manageAllowed(s, pid)) return 'Şu an bina yapamazsın.';
      const q = SQUARES[a.sq];
      if (!q || q.type !== 'street') return 'Geçersiz mülk.';
      const pr = s.props[a.sq];
      if (!ownsAll(s, pid, q.group)) return 'Renk grubunun tamamı sende değil.';
      if (GROUPS[q.group].some((i) => s.props[i].mortgaged)) return 'Grupta ipotekli mülk var.';
      if (pr.houses >= 5) return 'Zaten otel var.';
      if (r.evenBuild && pr.houses > Math.min(...groupHouses(s, q.group))) return 'Binalar eşit dağıtılmalı.';
      if (p.cash < houseCost(s, a.sq)) return 'Yeterli nakit yok.';
      if (pr.houses < 4 && s.housesLeft <= 0) return 'Bankada ev kalmadı.';
      if (pr.houses === 4 && s.hotelsLeft <= 0) return 'Bankada otel kalmadı.';
      return null;
    }
    case 'SELL_BUILDING': {
      if (!liquidateAllowed(s, pid)) return 'Şu an bina satamazsın.';
      const q = SQUARES[a.sq];
      if (!q || q.type !== 'street') return 'Geçersiz mülk.';
      const pr = s.props[a.sq];
      if (pr.owner !== pid || pr.houses <= 0) return 'Satılacak bina yok.';
      if (r.evenBuild && pr.houses < Math.max(...groupHouses(s, q.group))) return 'Önce binası en çok olan mülkten sat.';
      return null;
    }
    case 'MORTGAGE': {
      if (!liquidateAllowed(s, pid)) return 'Şu an ipotek yapamazsın.';
      const q = SQUARES[a.sq];
      if (!q || !PROP_SQUARES.includes(a.sq)) return 'Geçersiz mülk.';
      const pr = s.props[a.sq];
      if (pr.owner !== pid) return 'Mülk sana ait değil.';
      if (pr.mortgaged) return 'Zaten ipotekli.';
      if (q.type === 'street' && groupHouses(s, q.group).some((h) => h > 0)) return 'Gruptaki binaları önce sat.';
      return null;
    }
    case 'UNMORTGAGE': {
      if (!manageAllowed(s, pid)) return 'Şu an ipotek bozamazsın.';
      if (!PROP_SQUARES.includes(a.sq)) return 'Geçersiz mülk.';
      const pr = s.props[a.sq];
      if (pr.owner !== pid || !pr.mortgaged) return 'İpotekli mülk değil.';
      if (p.cash < unmortgageCost(s, a.sq)) return 'Yeterli nakit yok.';
      return null;
    }
    case 'DECLARE_BANKRUPT':
      if (s.phase !== 'DEBT' || s.debts[0].debtor !== pid) return 'İflas ilan edemezsin.';
      return null;
    case 'AUTO_DEBT':
      if (s.phase !== 'DEBT' || s.debts[0].debtor !== pid) return 'Borç yok.';
      return null;
    case 'TRADE_PROPOSE': {
      if (!manageAllowed(s, pid)) return 'Şu an takas teklif edemezsin.';
      const to = s.players[a.to];
      if (!to || to.bankrupt || a.to === pid) return 'Geçersiz oyuncu.';
      const give = a.give || {};
      const get = a.get || {};
      const e1 = tradeItemsError(s, pid, 'give', { cash: 0, ...give });
      if (e1) return e1;
      const e2 = tradeItemsError(s, a.to, 'get', { cash: 0, ...get });
      if (e2) return e2;
      const total = (give.cash || 0) + (give.props || []).length + (give.jailCards || 0) + (get.cash || 0) + (get.props || []).length + (get.jailCards || 0);
      if (total === 0) return 'Boş teklif.';
      return null;
    }
    case 'TRADE_ACCEPT':
    case 'TRADE_REJECT':
      if (s.phase !== 'TRADE' || s.trade.to !== pid) return 'Bu teklif sana değil.';
      if (a.type === 'TRADE_ACCEPT') {
        const t = s.trade;
        const e1 = tradeItemsError(s, t.from, 'give', { cash: 0, ...t.give });
        if (e1) return 'Teklif artık geçerli değil.';
        const e2 = tradeItemsError(s, t.to, 'get', { cash: 0, ...t.get });
        if (e2) return 'Teklif artık geçerli değil.';
        const fee = tradeFee(s, t.to, t.give.props || []);
        const feeFrom = tradeFee(s, t.from, t.get.props || []);
        if (P(s, t.to).cash - (t.get.cash || 0) + (t.give.cash || 0) < fee) return 'İpotek ücretini ödeyecek nakdin yok.';
        if (P(s, t.from).cash - (t.give.cash || 0) + (t.get.cash || 0) < feeFrom) return 'Teklifi yapanın ipotek ücreti için nakdi yok.';
      }
      return null;
    case 'TRADE_CANCEL':
      if (s.phase !== 'TRADE' || s.trade.from !== pid) return 'İptal edemezsin.';
      return null;
    default:
      return 'Bilinmeyen hamle.';
  }
}

// ---------------------------------------------------------------- yasal hamleler

export function legalActions(s, pid) {
  const out = [];
  const add = (a) => {
    if (!validate(s, pid, a)) out.push(a);
  };
  const p = s.players[pid];
  if (!p || p.bankrupt || s.phase === 'GAME_OVER') return out;
  const manage = () => {
    for (const sq of ownedSquares(s, pid)) {
      add({ type: 'BUILD', sq });
      add({ type: 'SELL_BUILDING', sq });
      add({ type: 'MORTGAGE', sq });
      add({ type: 'UNMORTGAGE', sq });
    }
    if (manageAllowed(s, pid) && alive(s).length > 1) out.push({ type: 'TRADE_PROPOSE' });
  };
  switch (s.phase) {
    case 'ROLL':
      add({ type: 'ROLL' });
      add({ type: 'JAIL_PAY' });
      add({ type: 'JAIL_USE_CARD' });
      manage();
      break;
    case 'POST':
      add({ type: 'ROLL' });
      add({ type: 'END_TURN' });
      manage();
      break;
    case 'BUY':
      add({ type: 'BUY' });
      add({ type: 'DECLINE_BUY' });
      break;
    case 'AUCTION': {
      const au = s.auction;
      const min = au.high ? au.high + M(s, BASE.auctionInc) : M(s, BASE.auctionMin);
      if (!validate(s, pid, { type: 'BID', amount: min })) out.push({ type: 'BID', min, max: p.cash });
      add({ type: 'PASS_BID' });
      break;
    }
    case 'DEBT':
      for (const sq of ownedSquares(s, pid)) {
        add({ type: 'SELL_BUILDING', sq });
        add({ type: 'MORTGAGE', sq });
      }
      add({ type: 'DECLARE_BANKRUPT' });
      break;
    case 'TRADE':
      add({ type: 'TRADE_ACCEPT' });
      add({ type: 'TRADE_REJECT' });
      add({ type: 'TRADE_CANCEL' });
      break;
    default:
  }
  return out;
}

// Sure dolunca uygulanacak otomatik hamle.
export function autoAction(s) {
  switch (s.phase) {
    case 'ROLL':
      return { pid: s.actor, action: { type: 'ROLL' } };
    case 'POST':
      return { pid: s.actor, action: s.extraRoll ? { type: 'ROLL' } : { type: 'END_TURN' } };
    case 'BUY':
      return { pid: s.actor, action: { type: 'DECLINE_BUY' } };
    case 'AUCTION':
      return { pid: s.actor, action: { type: 'PASS_BID' } };
    case 'DEBT':
      return { pid: s.actor, action: { type: 'AUTO_DEBT' } };
    case 'TRADE':
      return { pid: s.trade.to, action: { type: 'TRADE_REJECT' } };
    default:
      return null;
  }
}

// Borc icin siradaki en az zararli nakit yaratma hamlesi (bot ve otomatik cozum icin).
export function nextLiquidation(s, pid) {
  const owned = ownedSquares(s, pid);
  const ok = (a) => !validate(s, pid, a);
  const single = owned
    .filter((sq) => ok({ type: 'MORTGAGE', sq }) && !(SQUARES[sq].type === 'street' && ownsAll(s, pid, SQUARES[sq].group)))
    .sort((x, y) => SQUARES[x].price - SQUARES[y].price);
  if (single.length) return { type: 'MORTGAGE', sq: single[0] };
  const sells = owned
    .filter((sq) => ok({ type: 'SELL_BUILDING', sq }))
    .sort((x, y) => SQUARES[x].house - SQUARES[y].house || s.props[y].houses - s.props[x].houses);
  if (sells.length) return { type: 'SELL_BUILDING', sq: sells[0] };
  const rest = owned.filter((sq) => ok({ type: 'MORTGAGE', sq })).sort((x, y) => SQUARES[x].price - SQUARES[y].price);
  if (rest.length) return { type: 'MORTGAGE', sq: rest[0] };
  return null;
}

// ---------------------------------------------------------------- uygulama

export function applyAction(state, pid, action, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const err = validate(state, pid, action);
  if (err) return { error: err };
  const s = clone(state);
  const ev = [];
  if (ctx.dice) s.forceDice = ctx.dice; // yalnizca testler icin
  execute(s, pid, action, now, ev);
  delete s.forceDice;
  s.seq++;
  return { state: s, events: ev };
}

// Sure siniri dolunca oyunu net servete gore bitirir.
export function finishByTime(state, now = Date.now()) {
  if (state.phase === 'GAME_OVER') return { state, events: [] };
  const s = clone(state);
  const ev = [];
  const ranked = alive(s)
    .map((p) => ({ id: p.id, worth: netWorth(s, p.id), cash: p.cash }))
    .sort((a, b) => b.worth - a.worth || b.cash - a.cash);
  s.winner = ranked[0].id;
  s.ranking = ranked;
  s.endReason = 'time';
  s.buy = null;
  s.auction = null;
  s.trade = null;
  s.debts = [];
  setPhase(s, 'GAME_OVER', null, now);
  say(s, ev, { t: 'gameover', winner: s.winner, reason: 'time', msg: `Süre doldu! Net servete göre kazanan: ${P(s, s.winner).name} (${fmt(ranked[0].worth)}).` });
  s.seq++;
  return { state: s, events: ev };
}

function execute(s, pid, a, now, ev) {
  const p = P(s, pid);
  switch (a.type) {
    case 'ROLL':
      return doRoll(s, now, ev);
    case 'JAIL_PAY': {
      p.cash -= M(s, BASE.jailFee);
      if (rules(s).freeParkingJackpot) s.pool += M(s, BASE.jailFee);
      p.inJail = false;
      p.jailTries = 0;
      say(s, ev, { t: 'jailpay', pid, msg: `${p.name} Kodes'ten çıkmak için ${fmt(M(s, BASE.jailFee))} ödedi.` });
      s.deadline = now + s.settings.turnSeconds * 1000;
      return;
    }
    case 'JAIL_USE_CARD': {
      const c = p.cards.pop();
      s.decks[c.deck].order.push(c.id);
      p.inJail = false;
      p.jailTries = 0;
      say(s, ev, { t: 'jailcard', pid, msg: `${p.name} "Kodes'ten Ücretsiz Çık" kartını kullandı.` });
      s.deadline = now + s.settings.turnSeconds * 1000;
      return;
    }
    case 'END_TURN':
      return endTurn(s, now, ev);
    case 'BUY': {
      const { sq, price } = s.buy;
      p.cash -= price;
      s.props[sq].owner = pid;
      s.buy = null;
      say(s, ev, { t: 'buy', pid, sq, amt: price, msg: `${p.name}, ${SQUARES[sq].name} mülkünü ${fmt(price)} karşılığında satın aldı.` });
      return proceed(s, now, ev);
    }
    case 'DECLINE_BUY': {
      const { sq } = s.buy;
      s.buy = null;
      say(s, ev, { t: 'decline', pid, sq, msg: `${p.name}, ${SQUARES[sq].name} mülkünü almadı.` });
      if (rules(s).auction) startAuction(s, sq, now, ev);
      return proceed(s, now, ev);
    }
    case 'BID': {
      const au = s.auction;
      au.high = a.amount;
      au.highBidder = pid;
      say(s, ev, { t: 'bid', pid, amt: a.amount, msg: `${p.name} teklif verdi: ${fmt(a.amount)}.` });
      advanceAuction(s, now, ev);
      return proceed(s, now, ev);
    }
    case 'PASS_BID': {
      const au = s.auction;
      au.active = au.active.filter((x) => x !== pid);
      say(s, ev, { t: 'pass', pid, msg: `${p.name} müzayededen çekildi.` });
      advanceAuction(s, now, ev);
      return proceed(s, now, ev);
    }
    case 'BUILD': {
      const pr = s.props[a.sq];
      const cost = houseCost(s, a.sq);
      p.cash -= cost;
      if (pr.houses < 4) {
        pr.houses++;
        s.housesLeft--;
      } else {
        pr.houses = 5;
        s.hotelsLeft--;
        s.housesLeft += 4;
      }
      say(s, ev, { t: 'build', pid, sq: a.sq, houses: pr.houses, msg: `${p.name}, ${SQUARES[a.sq].name} mülküne ${pr.houses === 5 ? 'otel' : 'ev'} yaptı (${fmt(cost)}).` });
      s.deadline = now + s.settings.turnSeconds * 1000;
      return;
    }
    case 'SELL_BUILDING': {
      const pr = s.props[a.sq];
      const half = houseCost(s, a.sq) / 2;
      let refund = half;
      if (pr.houses === 5) {
        s.hotelsLeft++;
        if (s.housesLeft >= 4) {
          s.housesLeft -= 4;
          pr.houses = 4;
        } else {
          refund = half * 5;
          pr.houses = 0;
        }
      } else {
        pr.houses--;
        s.housesLeft++;
      }
      p.cash += refund;
      say(s, ev, { t: 'sell', pid, sq: a.sq, amt: refund, msg: `${p.name}, ${SQUARES[a.sq].name} üzerindeki binayı bankaya sattı (${fmt(refund)}).` });
      return afterLiquidation(s, now, ev);
    }
    case 'MORTGAGE': {
      const val = M(s, mortgageValueBase(SQUARES[a.sq]));
      s.props[a.sq].mortgaged = true;
      p.cash += val;
      say(s, ev, { t: 'mortgage', pid, sq: a.sq, amt: val, msg: `${p.name}, ${SQUARES[a.sq].name} mülkünü ipotek etti (${fmt(val)}).` });
      return afterLiquidation(s, now, ev);
    }
    case 'UNMORTGAGE': {
      const cost = unmortgageCost(s, a.sq);
      s.props[a.sq].mortgaged = false;
      p.cash -= cost;
      say(s, ev, { t: 'unmortgage', pid, sq: a.sq, amt: cost, msg: `${p.name}, ${SQUARES[a.sq].name} ipotegini kaldırdı (${fmt(cost)}).` });
      s.deadline = now + s.settings.turnSeconds * 1000;
      return;
    }
    case 'AUTO_DEBT': {
      for (let guard = 0; guard < 60 && s.phase === 'DEBT' && s.debts[0] && s.debts[0].debtor === pid; guard++) {
        const step = nextLiquidation(s, pid);
        if (!step) break;
        execute(s, pid, step, now, ev);
      }
      if (s.phase === 'DEBT' && s.debts[0] && s.debts[0].debtor === pid) return bankrupt(s, pid, now, ev);
      return;
    }
    case 'DECLARE_BANKRUPT':
      return bankrupt(s, pid, now, ev);
    case 'TRADE_PROPOSE': {
      const t = {
        from: pid,
        to: a.to,
        give: { cash: a.give?.cash || 0, props: [...(a.give?.props || [])], jailCards: a.give?.jailCards || 0 },
        get: { cash: a.get?.cash || 0, props: [...(a.get?.props || [])], jailCards: a.get?.jailCards || 0 },
        resumePhase: s.phase,
        resumeMs: Math.max(1000, (s.deadline ?? now) - now),
      };
      s.trade = t;
      setPhase(s, 'TRADE', a.to, now, s.settings.tradeSeconds);
      say(s, ev, { t: 'trade', pid, to: a.to, msg: `${p.name}, ${P(s, a.to).name} oyuncusuna takas teklif etti.` });
      return;
    }
    case 'TRADE_ACCEPT': {
      const t = s.trade;
      const A = P(s, t.from);
      const B = P(s, t.to);
      A.cash += (t.get.cash || 0) - (t.give.cash || 0);
      B.cash += (t.give.cash || 0) - (t.get.cash || 0);
      for (const sq of t.give.props) s.props[sq].owner = t.to;
      for (const sq of t.get.props) s.props[sq].owner = t.from;
      A.cash -= tradeFee(s, t.from, t.get.props);
      B.cash -= tradeFee(s, t.to, t.give.props);
      for (let i = 0; i < (t.give.jailCards || 0); i++) B.cards.push(A.cards.pop());
      for (let i = 0; i < (t.get.jailCards || 0); i++) A.cards.push(B.cards.pop());
      say(s, ev, { t: 'tradeok', from: t.from, to: t.to, msg: `${B.name}, ${A.name} oyuncusunun takas teklifini kabul etti.` });
      return endTrade(s, now);
    }
    case 'TRADE_REJECT': {
      const t = s.trade;
      say(s, ev, { t: 'tradeno', from: t.from, to: t.to, msg: `${P(s, t.to).name}, takas teklifini reddetti.` });
      return endTrade(s, now);
    }
    case 'TRADE_CANCEL': {
      say(s, ev, { t: 'tradeno', from: s.trade.from, to: s.trade.to, msg: `${p.name} takas teklifini geri çekti.` });
      return endTrade(s, now);
    }
    default:
  }
}

function endTrade(s, now) {
  const t = s.trade;
  s.trade = null;
  s.phase = t.resumePhase;
  s.actor = s.current;
  s.deadline = now + t.resumeMs;
}

// ---------------------------------------------------------------- tur akisi

function doRoll(s, now, ev) {
  const p = cur(s);
  const d1 = s.forceDice ? s.forceDice[0] : 1 + Math.floor(rnd(s) * 6);
  const d2 = s.forceDice ? s.forceDice[1] : 1 + Math.floor(rnd(s) * 6);
  const sum = d1 + d2;
  const dbl = d1 === d2;
  s.dice = [d1, d2];
  s.extraRoll = false;
  say(s, ev, { t: 'dice', pid: p.id, dice: [d1, d2], msg: `${p.name} zar attı: ${d1} + ${d2}${dbl ? ' (çift)' : ''}.` });

  if (p.inJail) {
    if (dbl) {
      p.inJail = false;
      p.jailTries = 0;
      say(s, ev, { t: 'jailout', pid: p.id, msg: `${p.name} çift atarak Kodes'ten çıktı.` });
      movePlayer(s, p.id, sum, now, ev);
      land(s, p.id, now, ev, {});
      return proceed(s, now, ev);
    }
    p.jailTries++;
    if (p.jailTries >= BASE.jailMaxTries) {
      p.inJail = false;
      p.jailTries = 0;
      say(s, ev, { t: 'jailforce', pid: p.id, msg: `${p.name} üç denemede çift atamadı; Kodes ücretini ödeyip çıkıyor.` });
      s.resume = { k: 'move', steps: sum };
      charge(s, p.id, null, M(s, BASE.jailFee), 'kodes', ev);
      return proceed(s, now, ev);
    }
    say(s, ev, { t: 'jailstay', pid: p.id, msg: `${p.name} Kodes'te kalıyor (${p.jailTries}. deneme).` });
    s.turnEnds = true;
    return proceed(s, now, ev);
  }

  if (dbl) {
    s.doubles++;
    if (s.doubles >= 3) {
      say(s, ev, { t: 'speeding', pid: p.id, msg: `${p.name} üst üste üç çift attı ve Kodes'e gönderildi!` });
      sendToJail(s, p.id, ev);
      return proceed(s, now, ev);
    }
    s.extraRoll = true;
  }
  movePlayer(s, p.id, sum, now, ev);
  land(s, p.id, now, ev, {});
  if (p.inJail) s.extraRoll = false;
  return proceed(s, now, ev);
}

function endTurn(s, now, ev) {
  s.doubles = 0;
  s.extraRoll = false;
  s.turnEnds = false;
  s.dice = null;
  let next = s.current;
  for (let i = 0; i < s.players.length; i++) {
    next = (next + 1) % s.players.length;
    if (!P(s, next).bankrupt) break;
  }
  s.current = next;
  s.turnNo++;
  setPhase(s, 'ROLL', next, now);
  say(s, ev, { t: 'turn', pid: next, msg: `Sıra ${P(s, next).name} oyuncusunda.` });
}

function checkOver(s, ev, now) {
  const left = alive(s);
  if (left.length > 1) return false;
  s.winner = left[0].id;
  s.endReason = 'last';
  s.ranking = [{ id: left[0].id, worth: netWorth(s, left[0].id), cash: left[0].cash }];
  setPhase(s, 'GAME_OVER', null, now);
  say(s, ev, { t: 'gameover', winner: s.winner, reason: 'last', msg: `Oyun bitti! Kazanan: ${left[0].name}.` });
  return true;
}

// Bekleyen karar/borc/muzayede kalmadiysa akisi surdurur.
function proceed(s, now, ev) {
  for (let guard = 0; guard < 50; guard++) {
    if (s.phase === 'GAME_OVER') return;
    if (checkOver(s, ev, now)) return;
    if (s.buy || s.auction) return;
    if (s.debts.length) {
      payAffordableDebts(s, ev);
      if (s.debts.length) {
        const d = s.debts[0];
        if (s.phase !== 'DEBT' || s.actor !== d.debtor) setPhase(s, 'DEBT', d.debtor, now);
        return;
      }
      continue;
    }
    if (s.auctionQueue.length) {
      startAuction(s, s.auctionQueue.shift(), now, ev);
      continue;
    }
    if (s.resume) {
      const r = s.resume;
      s.resume = null;
      if (r.k === 'move') {
        const p = cur(s);
        if (!p.bankrupt) {
          movePlayer(s, p.id, r.steps, now, ev);
          land(s, p.id, now, ev, {});
        }
      }
      continue;
    }
    const p = cur(s);
    if (p.bankrupt || s.turnEnds) return endTurn(s, now, ev);
    if (s.phase !== 'POST' || s.actor !== p.id) setPhase(s, 'POST', p.id, now);
    return;
  }
}

// ---------------------------------------------------------------- hareket ve kare cozumu

function advanceTo(s, pid, target, now, ev, opts = {}) {
  const p = P(s, pid);
  const from = p.pos;
  const dist = (target - from + 40) % 40;
  const passed = opts.salary !== false && from + dist >= 40;
  p.pos = target;
  say(s, ev, { t: 'move', pid, from, to: target, passed });
  if (passed) {
    p.laps++;
    let amt = M(s, BASE.salary);
    if (target === 0 && rules(s).doubleGoLanding) amt *= 2;
    p.cash += amt;
    say(s, ev, { t: 'salary', pid, amt, msg: `${p.name} Başlangıç'tan geçti ve ${fmt(amt)} aldı.` });
  }
}

function movePlayer(s, pid, steps, now, ev) {
  const target = (P(s, pid).pos + steps) % 40;
  advanceTo(s, pid, target, now, ev);
}

function sendToJail(s, pid, ev) {
  const p = P(s, pid);
  const from = p.pos;
  p.pos = 10;
  p.inJail = true;
  p.jailTries = 0;
  s.turnEnds = true;
  s.extraRoll = false;
  say(s, ev, { t: 'move', pid, from, to: 10, passed: false, jail: true });
  say(s, ev, { t: 'jail', pid, msg: `${p.name} Kodes'e girdi.` });
}

// Odeme: yeterli nakit varsa hemen oder, yoksa borc kuyruguna ekler.
function charge(s, debtor, creditor, amt, reason, ev, toPool = true) {
  if (amt <= 0) return;
  const d = P(s, debtor);
  if (d.cash >= amt) {
    transfer(s, debtor, creditor, amt, reason, ev, toPool);
  } else {
    s.debts.push({ debtor, creditor, amt, reason, toPool });
  }
}

function transfer(s, debtor, creditor, amt, reason, ev, toPool) {
  P(s, debtor).cash -= amt;
  if (creditor != null) P(s, creditor).cash += amt;
  else if (toPool && rules(s).freeParkingJackpot) s.pool += amt;
  const who = P(s, debtor).name;
  const msg =
    reason === 'kira'
      ? `${who}, ${P(s, creditor).name} oyuncusuna ${fmt(amt)} kira ödedi.`
      : creditor != null
        ? `${who}, ${P(s, creditor).name} oyuncusuna ${fmt(amt)} ödedi.`
        : `${who}, bankaya ${fmt(amt)} ödedi (${reason}).`;
  say(s, ev, { t: 'pay', from: debtor, to: creditor, amt, reason, msg });
}

function payAffordableDebts(s, ev) {
  while (s.debts.length && P(s, s.debts[0].debtor).cash >= s.debts[0].amt) {
    const d = s.debts.shift();
    transfer(s, d.debtor, d.creditor, d.amt, d.reason, ev, d.toPool);
  }
}

function afterLiquidation(s, now, ev) {
  if (s.phase === 'DEBT') {
    payAffordableDebts(s, ev);
    proceed(s, now, ev);
    if (s.phase === 'DEBT') s.deadline = now + s.settings.turnSeconds * 1000;
  } else {
    s.deadline = now + s.settings.turnSeconds * 1000;
  }
}

function land(s, pid, now, ev, ctx) {
  const p = P(s, pid);
  const q = SQUARES[p.pos];
  switch (q.type) {
    case 'street':
    case 'station':
    case 'utility': {
      const pr = s.props[q.i];
      if (pr.owner == null) {
        const price = M(s, q.price);
        if (rules(s).noBuyFirstLap && p.laps === 0) {
          say(s, ev, { t: 'nobuy', pid, msg: `${q.name}: ilk turda mülk alınamaz.` });
        } else if (p.cash >= price) {
          s.buy = { pid, sq: q.i, price };
          setPhase(s, 'BUY', pid, now);
        } else if (rules(s).auction) {
          startAuction(s, q.i, now, ev);
        }
      } else if (pr.owner !== pid && !pr.mortgaged) {
        if (P(s, pr.owner).inJail && !rules(s).rentInJail) {
          say(s, ev, { t: 'norent', pid, msg: `${P(s, pr.owner).name} Kodes'te olduğu için kira alamıyor.` });
        } else {
          const sum = s.dice ? s.dice[0] + s.dice[1] : 0;
          const rent = rentFor(s, q.i, sum, ctx);
          charge(s, pid, pr.owner, rent, 'kira', ev, false);
        }
      }
      return;
    }
    case 'tax':
      charge(s, pid, null, M(s, q.amount), q.name, ev);
      return;
    case 'chance':
    case 'chest':
      return drawCard(s, pid, q.type === 'chance' ? 'chance' : 'chest', now, ev);
    case 'gotojail':
      say(s, ev, { t: 'gotojail', pid, msg: `${p.name} "Kodes'e Gir" karesine geldi.` });
      return sendToJail(s, pid, ev);
    case 'parking':
      if (rules(s).freeParkingJackpot && s.pool > 0) {
        p.cash += s.pool;
        say(s, ev, { t: 'jackpot', pid, amt: s.pool, msg: `${p.name} Ücretsiz Otopark ikramiyesini aldı: ${fmt(s.pool)}.` });
        s.pool = 0;
      }
      return;
    default:
  }
}

function cardText(s, card) {
  const e = card.eff;
  return card.text
    .replace('{a}', fmt(M(s, e.amt || 0)))
    .replace('{h}', fmt(M(s, e.house || 0)))
    .replace('{o}', fmt(M(s, e.hotel || 0)));
}

function drawCard(s, pid, deckName, now, ev) {
  const p = P(s, pid);
  const deck = s.decks[deckName];
  const id = deck.order.shift();
  const card = CARD_BY_ID[id];
  const text = cardText(s, card);
  say(s, ev, { t: 'card', pid, deck: deckName, card: id, text, msg: `${p.name} ${deckName === 'chance' ? 'Şans' : 'Kamu Fonu'} kartı çekti: ${text}` });
  const e = card.eff;
  if (e.k === 'jailCard') p.cards.push({ deck: deckName, id });
  else deck.order.push(id);
  switch (e.k) {
    case 'go':
      advanceTo(s, pid, 0, now, ev);
      return land(s, pid, now, ev, {});
    case 'to':
      advanceTo(s, pid, e.sq, now, ev);
      return land(s, pid, now, ev, {});
    case 'nearest': {
      const list = e.what === 'station' ? STATIONS : UTILITIES;
      const target = list.find((i) => i > p.pos) ?? list[0];
      advanceTo(s, pid, target, now, ev);
      if (e.what === 'utility') {
        const pr = s.props[target];
        if (pr.owner != null && pr.owner !== pid && !pr.mortgaged) {
          const d1 = 1 + Math.floor(rnd(s) * 6);
          const d2 = 1 + Math.floor(rnd(s) * 6);
          s.dice = [d1, d2];
          say(s, ev, { t: 'dice', pid, dice: [d1, d2], msg: `${p.name} kart için zar attı: ${d1} + ${d2}.` });
        }
        return land(s, pid, now, ev, { tenTimes: true });
      }
      return land(s, pid, now, ev, { double: true });
    }
    case 'back': {
      const target = (p.pos - e.n + 40) % 40;
      advanceTo(s, pid, target, now, ev, { salary: false });
      return land(s, pid, now, ev, {});
    }
    case 'gain':
      p.cash += M(s, e.amt);
      say(s, ev, { t: 'gain', pid, amt: M(s, e.amt), msg: `${p.name} bankadan ${fmt(M(s, e.amt))} aldı.` });
      return;
    case 'pay':
      return charge(s, pid, null, M(s, e.amt), 'kart', ev);
    case 'jail':
      return sendToJail(s, pid, ev);
    case 'jailCard':
      return;
    case 'repairs': {
      let total = 0;
      for (const sq of ownedSquares(s, pid)) {
        const pr = s.props[sq];
        if (SQUARES[sq].type !== 'street') continue;
        total += pr.houses === 5 ? M(s, e.hotel) : pr.houses * M(s, e.house);
      }
      return charge(s, pid, null, total, 'tamir', ev);
    }
    case 'payEach':
      for (const o of alive(s)) if (o.id !== pid) charge(s, pid, o.id, M(s, e.amt), 'kart', ev);
      return;
    case 'collectEach':
      for (const o of alive(s)) if (o.id !== pid) charge(s, o.id, pid, M(s, e.amt), 'kart', ev);
      return;
    default:
  }
}

// ---------------------------------------------------------------- muzayede

function startAuction(s, sq, now, ev) {
  const order = [];
  for (let i = 1; i <= s.players.length; i++) {
    const id = (s.current + i) % s.players.length;
    if (!P(s, id).bankrupt) order.push(id);
  }
  s.auction = { sq, order, active: order.slice(), high: 0, highBidder: null };
  say(s, ev, { t: 'auction', sq, msg: `${SQUARES[sq].name} için müzayede başladı.` });
  // Ilk teklifi verebilecek kimse yoksa ya da tek kisi kaldiysa hemen sonuclanir.
  const minNext = M(s, BASE.auctionMin);
  s.auction.active = s.auction.active.filter((id) => P(s, id).cash >= minNext);
  s.auction.turn = s.auction.order[s.auction.order.length - 1];
  advanceAuction(s, now, ev, true);
}

function advanceAuction(s, now, ev, fresh = false) {
  const au = s.auction;
  const minNext = au.high ? au.high + M(s, BASE.auctionInc) : M(s, BASE.auctionMin);
  au.active = au.active.filter((id) => id === au.highBidder || P(s, id).cash >= minNext);
  if (au.active.length === 0 || (au.active.length === 1 && au.highBidder === au.active[0])) {
    endAuction(s, ev);
    return true;
  }
  const from = au.order.indexOf(fresh ? au.order[au.order.length - 1] : au.turn);
  let next = null;
  for (let i = 1; i <= au.order.length; i++) {
    const id = au.order[(from + i) % au.order.length];
    if (au.active.includes(id)) {
      next = id;
      break;
    }
  }
  au.turn = next;
  setPhase(s, 'AUCTION', next, now);
  return false;
}

function endAuction(s, ev) {
  const au = s.auction;
  s.auction = null;
  if (au.highBidder != null) {
    const w = P(s, au.highBidder);
    w.cash -= au.high;
    s.props[au.sq].owner = w.id;
    say(s, ev, { t: 'sold', pid: w.id, sq: au.sq, amt: au.high, msg: `${SQUARES[au.sq].name} müzayedede ${w.name} oyuncusuna ${fmt(au.high)} karşılığında satıldı.` });
  } else {
    say(s, ev, { t: 'unsold', sq: au.sq, msg: `${SQUARES[au.sq].name} için teklif çıkmadı.` });
  }
}

// ---------------------------------------------------------------- iflas

function bankrupt(s, pid, now, ev) {
  const p = P(s, pid);
  const debt = s.debts.find((d) => d.debtor === pid);
  const creditor = debt ? debt.creditor : null;
  // Binalar yarisina bankaya satilir.
  for (const sq of ownedSquares(s, pid)) {
    const pr = s.props[sq];
    if (pr.houses > 0) {
      const half = houseCost(s, sq) / 2;
      if (pr.houses === 5) {
        s.hotelsLeft++;
        p.cash += half * 5;
      } else {
        s.housesLeft += pr.houses;
        p.cash += half * pr.houses;
      }
      pr.houses = 0;
    }
  }
  say(s, ev, { t: 'bankrupt', pid, to: creditor, msg: `${p.name} iflas etti${creditor != null ? `; varlıkları ${P(s, creditor).name} oyuncusuna geçti` : '; mülkleri bankaya döndü'}.` });
  if (creditor != null) {
    const c = P(s, creditor);
    c.cash += p.cash;
    for (const sq of ownedSquares(s, pid)) s.props[sq].owner = creditor;
    c.cards.push(...p.cards);
  } else {
    for (const sq of ownedSquares(s, pid)) {
      s.props[sq] = { owner: null, mortgaged: false, houses: 0 };
      if (rules(s).auction) s.auctionQueue.push(sq);
    }
    for (const c of p.cards) s.decks[c.deck].order.push(c.id);
  }
  p.cards = [];
  p.cash = 0;
  p.bankrupt = true;
  s.debts = s.debts.filter((d) => d.debtor !== pid && d.creditor !== pid);
  if (s.current === pid) s.turnEnds = true;
  s.extraRoll = false;
  if (s.phase === 'DEBT') s.phase = 'POST';
  proceed(s, now, ev);
}
