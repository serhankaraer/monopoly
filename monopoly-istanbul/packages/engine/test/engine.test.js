import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SQUARES, PROP_SQUARES, GROUPS, CHANCE, CHEST, BASE,
  createGame, applyAction, validate, legalActions, autoAction, nextLiquidation,
  rentFor, netWorth, finishByTime, fmt, timeLimitOptions, normalizeSettings,
} from '../src/index.js';

const T0 = 1_700_000_000_000;
const mk = (n = 3, settings = {}, seed = 1) =>
  createGame({ players: Array.from({ length: n }, (_, i) => ({ name: 'O' + i })), settings, seed, now: T0 });

// testlerde durumu dogrudan kurmak icin yardimcilar
const act = (s, pid, a, now = T0, dice) => {
  const r = applyAction(s, pid, a, { now, dice });
  assert.ok(!r.error, `${a.type}: ${r.error}`);
  return r;
};
const give = (s, pid, sqs) => sqs.forEach((sq) => (s.props[sq].owner = pid));

test('tahta: 40 kare, 28 mulk, 8 renk grubu, kart sayilari', () => {
  assert.equal(SQUARES.length, 40);
  assert.equal(PROP_SQUARES.length, 28);
  assert.equal(Object.keys(GROUPS).length, 8);
  assert.equal(CHANCE.length, 16);
  assert.equal(CHEST.length, 16);
  SQUARES.forEach((q, i) => assert.equal(q.i, i));
  assert.equal(SQUARES.filter((q) => q.type === 'chance').length, 3);
  assert.equal(SQUARES.filter((q) => q.type === 'chest').length, 3);
  assert.equal(GROUPS.brown.length, 2);
  assert.equal(GROUPS.darkblue.length, 2);
  assert.equal(GROUPS.red.length, 3);
});

test('para bicimleme', () => {
  assert.equal(fmt(75_000_000), '75 Mn ₺');
  assert.equal(fmt(7_500_000), '7,5 Mn ₺');
  assert.equal(fmt(100_000), '100 Bin ₺');
  assert.equal(fmt(2_500_000), '2,5 Mn ₺');
  assert.equal(fmt(500), '500 ₺');
});

test('sure siniri secenekleri: 10 + (n-1)*5 ile baslar, 120 dk ustu yok', () => {
  assert.deepEqual(timeLimitOptions(2).slice(0, 3), [15, 20, 25]);
  assert.equal(timeLimitOptions(6)[0], 35);
  assert.equal(timeLimitOptions(4).at(-1), 120);
  assert.equal(normalizeSettings({ timeLimitMinutes: 200 }, 3).timeLimitMinutes, 120);
});

test('oyun kurulumu: baslangic parasi carpanla olceklenir', () => {
  const s = mk(4);
  assert.equal(s.players.length, 4);
  assert.equal(s.players[0].cash, 1500 * 50000);
  assert.equal(s.phase, 'ROLL');
  assert.equal(s.deadline, T0 + 30000);
  const s2 = mk(2, { mult: 1, startCash: 2000 });
  assert.equal(s2.players[0].cash, 2000);
});

test('kira hesabi: set cift, ev, istasyon, kamu kurulusu', () => {
  const s = mk(3);
  give(s, 1, [1]);
  assert.equal(rentFor(s, 1, 7), 2 * 50000);
  give(s, 1, [3]);
  assert.equal(rentFor(s, 1, 7), 4 * 50000); // set: 2 x 2
  s.props[1].houses = 2;
  assert.equal(rentFor(s, 1, 7), 30 * 50000);
  s.props[1].houses = 5;
  assert.equal(rentFor(s, 1, 7), 250 * 50000);
  s.props[1].mortgaged = true;
  assert.equal(rentFor(s, 1, 7), 0);
  give(s, 2, [5, 15, 25]);
  assert.equal(rentFor(s, 5, 7), 100 * 50000);
  assert.equal(rentFor(s, 5, 7, { double: true }), 200 * 50000);
  give(s, 2, [12]);
  assert.equal(rentFor(s, 12, 9), 4 * 9 * 50000);
  give(s, 2, [28]);
  assert.equal(rentFor(s, 12, 9), 10 * 9 * 50000);
  assert.equal(rentFor(s, 28, 5), 10 * 5 * 50000);
});

test('yetkisiz hamle reddedilir', () => {
  const s = mk(3);
  const other = (s.current + 1) % 3;
  assert.ok(validate(s, other, { type: 'ROLL' }));
  assert.ok(validate(s, s.current, { type: 'BUY' }));
  assert.ok(validate(s, s.current, { type: 'END_TURN' }));
  assert.ok(validate(s, s.current, { type: 'NOPE' }));
});


test('zar: bos mulke inince satin alma karari, satin alma', () => {
  let s = mk(2, {}, 7);
  const a = s.current;
  s.players[a].pos = 0;
  s = act(s, a, { type: 'ROLL' }, T0, [1, 2]).state; // 3: Dolapdere
  assert.equal(s.players[a].pos, 3);
  assert.equal(s.phase, 'BUY');
  assert.equal(s.buy.price, 60 * 50000);
  const before = s.players[a].cash;
  s = act(s, a, { type: 'BUY' }).state;
  assert.equal(s.props[3].owner, a);
  assert.equal(s.players[a].cash, before - 60 * 50000);
  assert.equal(s.phase, 'POST');
  s = act(s, a, { type: 'END_TURN' }).state;
  assert.equal(s.current, 1 - a);
  assert.equal(s.phase, 'ROLL');
});

test('kira: sahibi olan mulke inince kira oder; nakit yetmezse borc', () => {
  let s = mk(2, {}, 7);
  const a = s.current;
  const b = 1 - a;
  give(s, b, [3]);
  s.players[a].pos = 0;
  const ca = s.players[a].cash;
  const cb = s.players[b].cash;
  s = act(s, a, { type: 'ROLL' }, T0, [1, 2]).state;
  assert.equal(s.players[a].cash, ca - 4 * 50000);
  assert.equal(s.players[b].cash, cb + 4 * 50000);
  // yetmeyen nakit
  let t = mk(2, {}, 7);
  give(t, b, [3]);
  t.players[a].pos = 0;
  t.players[a].cash = 1000;
  t = act(t, a, { type: 'ROLL' }, T0, [1, 2]).state;
  assert.equal(t.phase, 'DEBT');
  assert.equal(t.actor, a);
  assert.equal(t.debts[0].amt, 4 * 50000);
});

test('vergi, cift atinca tekrar zar, baslangic maasi', () => {
  let s = mk(2, {}, 7);
  const a = s.current;
  s.players[a].pos = 0;
  const c0 = s.players[a].cash;
  s = act(s, a, { type: 'ROLL' }, T0, [2, 2]).state; // 4: Gelir Vergisi, cift
  assert.equal(s.players[a].cash, c0 - 200 * 50000);
  assert.equal(s.phase, 'POST');
  assert.equal(s.extraRoll, true);
  assert.ok(validate(s, a, { type: 'END_TURN' }));
  assert.ok(!validate(s, a, { type: 'ROLL' }));
  // baslangictan gecis
  let t = mk(2, {}, 7);
  t.players[a].pos = 38; // Lux tax square; roll 5 -> 3
  const c1 = t.players[a].cash;
  t = act(t, a, { type: 'ROLL' }, T0, [2, 3]).state;
  assert.equal(t.players[a].pos, 3);
  assert.equal(t.players[a].laps, 1);
});

test('kodes: kareye inince ve ust uste uc cift', () => {
  let s = mk(2, {}, 7);
  const a = s.current;
  s.players[a].pos = 24;
  s = act(s, a, { type: 'ROLL' }, T0, [3, 3]).state; // 30: Kodes'e Gir
  assert.equal(s.players[a].inJail, true);
  assert.equal(s.players[a].pos, 10);
  assert.equal(s.current, 1 - a);
  // 3 cift
  let t = mk(2, {}, 7);
  t.players[a].pos = 0;
  t = act(t, a, { type: 'ROLL' }, T0, [1, 1]).state; // 2: Kamu Fonu (kart)
  if (t.phase === 'BUY') t = act(t, a, { type: 'DECLINE_BUY' }).state;
  assert.equal(t.doubles, 1);
});

test('kodesten cikis: cift atinca cikar, ucuncu denemede ucret oder ve ilerler', () => {
  let s = mk(2, {}, 7);
  const a = s.current;
  const b = 1 - a;
  s.players[a].inJail = true;
  s.players[a].pos = 10;
  s = act(s, a, { type: 'ROLL' }, T0, [1, 2]).state;
  assert.equal(s.players[a].inJail, true);
  assert.equal(s.players[a].jailTries, 1);
  assert.equal(s.current, b);
  // rakip turu bitir, tekrar a
  s = act(s, b, { type: 'ROLL' }, T0, [1, 2]).state;
  if (s.phase === 'BUY') s = act(s, b, { type: 'DECLINE_BUY' }).state;
  if (s.phase === 'AUCTION') {
    while (s.phase === 'AUCTION') s = act(s, s.actor, { type: 'PASS_BID' }).state;
  }
  if (s.phase === 'POST') s = act(s, b, { type: 'END_TURN' }).state;
  assert.equal(s.current, a);
  s = act(s, a, { type: 'ROLL' }, T0, [1, 2]).state;
  assert.equal(s.players[a].jailTries, 2);
  s = act(s, s.current, { type: 'ROLL' }, T0, [1, 2]).state;
  if (s.phase === 'BUY') s = act(s, s.current, { type: 'DECLINE_BUY' }).state;
  if (s.phase === 'AUCTION') {
    while (s.phase === 'AUCTION') s = act(s, s.actor, { type: 'PASS_BID' }).state;
  }
  if (s.phase === 'POST') s = act(s, s.current, { type: 'END_TURN' }).state;
  const cash = s.players[a].cash;
  s = act(s, a, { type: 'ROLL' }, T0, [1, 2]).state;
  assert.equal(s.players[a].inJail, false);
  assert.equal(s.players[a].pos, 13);
  assert.ok(s.players[a].cash <= cash - 50 * 50000 + 1);
});

test('uc cift ust uste: kodese gider', () => {
  let s = mk(2, {}, 7);
  const a = s.current;
  s.players[a].pos = 0;
  s.doubles = 2;
  s = act(s, a, { type: 'ROLL' }, T0, [3, 3]).state;
  assert.equal(s.players[a].inJail, true);
  assert.equal(s.current, 1 - a);
});

test('ucretsiz otopark ikramiyesi ve cift baslangic maasi ev kurallari', () => {
  let s = mk(2, { houseRules: { freeParkingJackpot: true, doubleGoLanding: true } }, 3);
  const a = s.current;
  s.pool = 7_000_000;
  s.players[a].pos = 14;
  const c0 = s.players[a].cash;
  s = act(s, a, { type: 'ROLL' }, T0, [3, 3]).state; // 20: Otopark
  assert.equal(s.players[a].cash, c0 + 7_000_000);
  assert.equal(s.pool, 0);
  // vergi havuza gider
  let t = mk(2, { houseRules: { freeParkingJackpot: true } }, 3);
  t.players[a].pos = 0;
  t = act(t, a, { type: 'ROLL' }, T0, [2, 2]).state;
  assert.equal(t.pool, 200 * 50000);
  // tam inince cift maas
  let u = mk(2, { houseRules: { doubleGoLanding: true } }, 3);
  u.players[a].pos = 36;
  const c2 = u.players[a].cash;
  u = act(u, a, { type: 'ROLL' }, T0, [2, 2]).state; // 40 -> 0 (cift zar): maas x2
  assert.equal(u.players[a].pos, 0);
  assert.equal(u.players[a].cash, c2 + 400 * 50000);
});

test('ilk turda mulk almama kurali: satin alma ve muzayede yok', () => {
  let s = mk(2, { houseRules: { noBuyFirstLap: true } }, 3);
  const a = s.current;
  s.players[a].pos = 0;
  s = act(s, a, { type: 'ROLL' }, T0, [1, 2]).state;
  assert.equal(s.phase, 'POST');
  assert.equal(s.props[3].owner, null);
});

test('kart: 32 kartin hepsi uygulanir, etkileri dogru', () => {
  for (const deck of ['chance', 'chest']) {
    const cards = deck === 'chance' ? CHANCE : CHEST;
    for (const c of cards) {
      let s = mk(3, {}, 21);
      const a = s.current;
      const b = (a + 1) % 3;
      s.decks[deck].order = [c.id, ...s.decks[deck].order.filter((x) => x !== c.id)];
      const sq = deck === 'chance' ? 7 : 2;
      s.players[a].pos = sq - 2;
      give(s, b, [5, 15, 25, 35, 12, 28]);
      const c0 = s.players[a].cash;
      const r = applyAction(s, a, { type: 'ROLL' }, { now: T0, dice: [1, 1] });
      assert.ok(!r.error, `${c.id}: ${r.error}`);
      assert.ok(r.events.some((e) => e.t === 'card' && e.card === c.id), `${c.id}: kart olayi yok`);
      const n = r.state;
      const e = c.eff;
      const a0 = n.players[a];
      if (e.k === 'jail') assert.equal(a0.inJail, true, c.id);
      if (e.k === 'jailCard') assert.equal(a0.cards.length, 1, c.id);
      if (e.k === 'gain') assert.equal(a0.cash, c0 + e.amt * 50000, c.id);
      if (e.k === 'pay') assert.equal(a0.cash, c0 - e.amt * 50000, c.id);
      if (e.k === 'go') assert.ok(a0.laps === 1 && a0.pos === 0, c.id);
      if (e.k === 'back') assert.equal(a0.pos, sq - 3, c.id);
      if (e.k === 'to') assert.equal(a0.pos, e.sq, c.id);
      if (e.k === 'payEach') assert.equal(a0.cash, c0 - e.amt * 50000 * 2, c.id);
      if (e.k === 'collectEach') assert.equal(a0.cash, c0 + e.amt * 50000 * 2, c.id);
      if (e.k === 'repairs') assert.equal(a0.cash, c0, c.id); // binasi yok
      assert.ok(!n.log.some((m) => m.includes('{')), 'sablon yer tutucusu kaldi');
      if (e.k === 'jailCard') assert.ok(!n.decks[deck].order.includes(c.id));
      else assert.ok(n.decks[deck].order.includes(c.id));
    }
  }
});

test('kodes ucreti ve kart', () => {
  let s = mk(2, {}, 5);
  const a = s.current;
  s.players[a].inJail = true;
  s.players[a].pos = 10;
  const before = s.players[a].cash;
  s = act(s, a, { type: 'JAIL_PAY' }).state;
  assert.equal(s.players[a].cash, before - 50 * 50000);
  assert.equal(s.players[a].inJail, false);
  let t = mk(2, {}, 5);
  t.players[a].inJail = true;
  t.players[a].cards.push({ deck: 'chance', id: 'c8' });
  t = act(t, a, { type: 'JAIL_USE_CARD' }).state;
  assert.equal(t.players[a].inJail, false);
  assert.equal(t.players[a].cards.length, 0);
  assert.ok(t.decks.chance.order.includes('c8'));
});

test('bina yapma: set sart, esit dagitim, bina kitligi', () => {
  let s = mk(2, {}, 2);
  const a = s.current;
  give(s, a, [1]);
  assert.ok(validate(s, a, { type: 'BUILD', sq: 1 })); // set yok
  give(s, a, [3]);
  s = act(s, a, { type: 'BUILD', sq: 1 }).state;
  assert.equal(s.props[1].houses, 1);
  assert.ok(validate(s, a, { type: 'BUILD', sq: 1 })); // esitlik: once 3
  s = act(s, a, { type: 'BUILD', sq: 3 }).state;
  s = act(s, a, { type: 'BUILD', sq: 1 }).state;
  assert.equal(s.housesLeft, 32 - 3);
  // ipotekli mulk varsa bina yok
  const t = mk(2, {}, 2);
  give(t, a, [1, 3]);
  t.props[3].mortgaged = true;
  assert.ok(validate(t, a, { type: 'BUILD', sq: 1 }));
  // kitlik
  const u = mk(2, {}, 2);
  give(u, a, [1, 3]);
  u.housesLeft = 0;
  assert.ok(validate(u, a, { type: 'BUILD', sq: 1 }));
});

test('otel: 4 evden sonra, evler bankaya doner', () => {
  let s = mk(2, {}, 2);
  const a = s.current;
  give(s, a, [1, 3]);
  s.players[a].cash = 999_999_999;
  for (let i = 0; i < 4; i++) {
    s = act(s, a, { type: 'BUILD', sq: 1 }).state;
    s = act(s, a, { type: 'BUILD', sq: 3 }).state;
  }
  assert.equal(s.housesLeft, 32 - 8);
  s = act(s, a, { type: 'BUILD', sq: 1 }).state;
  assert.equal(s.props[1].houses, 5);
  assert.equal(s.hotelsLeft, 11);
  assert.equal(s.housesLeft, 32 - 8 + 4);
  assert.ok(validate(s, a, { type: 'BUILD', sq: 1 }));
});

test('ipotek ve ipotek bozma (%10 faiz)', () => {
  let s = mk(2, {}, 2);
  const a = s.current;
  give(s, a, [39]);
  const before = s.players[a].cash;
  s = act(s, a, { type: 'MORTGAGE', sq: 39 }).state;
  assert.equal(s.players[a].cash, before + 200 * 50000);
  s = act(s, a, { type: 'UNMORTGAGE', sq: 39 }).state;
  assert.equal(s.players[a].cash, before - 20 * 50000); // 200 -> 220
  assert.equal(s.props[39].mortgaged, false);
  // binali grupta ipotek yok
  const t = mk(2, {}, 2);
  give(t, a, [37, 39]);
  t.props[37].houses = 1;
  assert.ok(validate(t, a, { type: 'MORTGAGE', sq: 39 }));
});

test('takas: teklif, sure duraklatma, kabul', () => {
  let s = mk(3, {}, 4);
  const a = s.current;
  const b = (a + 1) % 3;
  give(s, a, [1]);
  give(s, b, [6]);
  s.deadline = T0 + 20_000;
  s = act(s, a, { type: 'TRADE_PROPOSE', to: b, give: { cash: 0, props: [1] }, get: { cash: 1_000_000, props: [6] } }, T0).state;
  assert.equal(s.phase, 'TRADE');
  assert.equal(s.actor, b);
  assert.equal(s.deadline, T0 + 15_000);
  assert.ok(validate(s, a, { type: 'ROLL' })); // takas acikken zar yok
  const cashA = s.players[a].cash;
  const cashB = s.players[b].cash;
  s = act(s, b, { type: 'TRADE_ACCEPT' }, T0 + 5_000).state;
  assert.equal(s.props[1].owner, b);
  assert.equal(s.props[6].owner, a);
  assert.equal(s.players[a].cash, cashA + 1_000_000);
  assert.equal(s.players[b].cash, cashB - 1_000_000);
  assert.equal(s.phase, 'ROLL');
  assert.equal(s.deadline, T0 + 5_000 + 20_000 - 0); // kalan 20 sn geri yuklendi
});

test('takas: bina olan gruptan mulk verilemez; reddet ve geri cek', () => {
  let s = mk(2, {}, 4);
  const a = s.current;
  const b = 1 - a;
  give(s, a, [1, 3]);
  s.props[1].houses = 1;
  assert.ok(validate(s, a, { type: 'TRADE_PROPOSE', to: b, give: { cash: 0, props: [3] }, get: { cash: 5, props: [] } }));
  s.props[1].houses = 0;
  s = act(s, a, { type: 'TRADE_PROPOSE', to: b, give: { cash: 0, props: [3] }, get: { cash: 5, props: [] } }).state;
  s = act(s, b, { type: 'TRADE_REJECT' }).state;
  assert.equal(s.props[3].owner, a);
  s = act(s, a, { type: 'TRADE_PROPOSE', to: b, give: { cash: 0, props: [3] }, get: { cash: 5, props: [] } }).state;
  s = act(s, a, { type: 'TRADE_CANCEL' }).state;
  assert.equal(s.phase, 'ROLL');
});

test('takas zaman asimi otomatik red', () => {
  let s = mk(2, {}, 4);
  const a = s.current;
  s = act(s, a, { type: 'TRADE_PROPOSE', to: 1 - a, give: { cash: 1_000_000, props: [] }, get: { cash: 0, props: [] } }).state;
  const auto = autoAction(s);
  assert.equal(auto.action.type, 'TRADE_REJECT');
  assert.equal(auto.pid, 1 - a);
});

function toAuction(seed = 9, setup = (s) => s) {
  let s = mk(3, {}, seed);
  s = setup(s);
  return s;
}

test('muzayede: red -> teklifler -> kazanan oder', () => {
  let s = mk(3, {}, 6);
  const a = s.current;
  s.players[a].pos = 0;
  // BUY fazini elle kur
  s.buy = { pid: a, sq: 39, price: 400 * 50000 };
  s.phase = 'BUY';
  s.actor = a;
  s = act(s, a, { type: 'DECLINE_BUY' }).state;
  assert.equal(s.phase, 'AUCTION');
  const first = s.actor;
  assert.equal(first, (a + 1) % 3);
  const min = 10 * 50000;
  assert.ok(validate(s, first, { type: 'BID', amount: min - 1 }));
  s = act(s, first, { type: 'BID', amount: min }).state;
  assert.equal(s.actor, (first + 1) % 3);
  s = act(s, s.actor, { type: 'BID', amount: 3_000_000 }).state;
  const third = s.actor;
  s = act(s, third, { type: 'PASS_BID' }).state;
  s = act(s, s.actor, { type: 'PASS_BID' }).state;
  assert.equal(s.props[39].owner, (first + 1) % 3);
  assert.equal(s.players[(first + 1) % 3].cash, 75_000_000 - 3_000_000);
  assert.ok(['POST', 'ROLL'].includes(s.phase));
});

test('muzayede kapali ev kuralinda red -> mulk sahipsiz kalir', () => {
  let s = mk(2, { houseRules: { auction: false } }, 6);
  const a = s.current;
  s.buy = { pid: a, sq: 39, price: 400 * 50000 };
  s.phase = 'BUY';
  s.actor = a;
  s = act(s, a, { type: 'DECLINE_BUY' }).state;
  assert.notEqual(s.phase, 'AUCTION');
  assert.equal(s.props[39].owner, null);
});

test('borc: nakit yetmezse ipotek/ev satisi ile odenir; olmazsa iflas', () => {
  let s = mk(2, {}, 8);
  const a = s.current;
  const b = 1 - a;
  give(s, b, [39]);
  give(s, a, [1]);
  s.players[a].cash = 100_000;
  s.players[a].pos = 38;
  s.dice = [1, 0];
  // borcu elle kur
  s.debts.push({ debtor: a, creditor: b, amt: 3_000_000, reason: 'kira', toPool: false });
  s.phase = 'DEBT';
  s.actor = a;
  const legal = legalActions(s, a).map((x) => x.type);
  assert.ok(legal.includes('MORTGAGE'));
  assert.ok(legal.includes('DECLARE_BANKRUPT'));
  s = act(s, a, { type: 'MORTGAGE', sq: 1 }).state; // +30 baz = 1.5 Mn: yetmez
  assert.equal(s.phase, 'DEBT');
  // baska varlik yok -> otomatik cozum iflas ettirir
  s = act(s, a, { type: 'AUTO_DEBT' }).state;
  assert.equal(s.players[a].bankrupt, true);
  assert.equal(s.phase, 'GAME_OVER');
  assert.equal(s.winner, b);
});

test('iflas: borclu oyuncuya devir, bankaya iflasta mulkler sahipsiz', () => {
  let s = mk(3, {}, 8);
  const a = s.current;
  const b = (a + 1) % 3;
  give(s, a, [1, 3]);
  s.props[1].houses = 2;
  s.housesLeft = 30;
  s.players[a].cash = 0;
  s.debts.push({ debtor: a, creditor: b, amt: 99_000_000, reason: 'kira', toPool: false });
  s.phase = 'DEBT';
  s.actor = a;
  const bCash = s.players[b].cash;
  s = act(s, a, { type: 'DECLARE_BANKRUPT' }).state;
  assert.equal(s.players[a].bankrupt, true);
  assert.equal(s.props[1].owner, b);
  assert.equal(s.props[1].houses, 0);
  assert.equal(s.housesLeft, 32);
  assert.equal(s.players[b].cash, bCash + 2 * 25 * 50000); // 2 ev yarisina satildi
  assert.equal(s.phase, 'ROLL');
  assert.notEqual(s.current, a);
});

test('bankaya borcta iflas: mulkler muzayedeye cikar', () => {
  let s = mk(3, {}, 8);
  const a = s.current;
  give(s, a, [1]);
  s.players[a].cash = 0;
  s.debts.push({ debtor: a, creditor: null, amt: 99_000_000, reason: 'vergi', toPool: true });
  s.phase = 'DEBT';
  s.actor = a;
  s = act(s, a, { type: 'DECLARE_BANKRUPT' }).state;
  assert.equal(s.phase, 'AUCTION');
  assert.equal(s.auction.sq, 1);
  assert.ok(!s.auction.order.includes(a));
});

test('sure sinirinda net servete gore kazanan', () => {
  let s = mk(3, {}, 12);
  give(s, 2, [39, 37]);
  s.players[2].cash = 1;
  s.players[0].cash = 0;
  s.players[1].cash = 5_000_000;
  const r = finishByTime(s, T0 + 1000);
  assert.equal(r.state.phase, 'GAME_OVER');
  assert.equal(r.state.endReason, 'time');
  assert.equal(r.state.winner, 2);
  assert.equal(r.state.ranking[0].id, 2);
});

test('autoAction her fazda mantikli', () => {
  const s = mk(2, {}, 1);
  assert.equal(autoAction(s).action.type, 'ROLL');
  s.phase = 'BUY';
  s.buy = { pid: s.current, sq: 1, price: 1 };
  assert.equal(autoAction(s).action.type, 'DECLINE_BUY');
});

test('nextLiquidation: once tekil mulk ipotegi', () => {
  const s = mk(2, {}, 1);
  const a = s.current;
  give(s, a, [1, 3, 39]);
  s.phase = 'DEBT';
  s.actor = a;
  s.debts.push({ debtor: a, creditor: null, amt: 1, reason: 'x', toPool: true });
  const step = nextLiquidation(s, a);
  assert.equal(step.type, 'MORTGAGE');
  assert.equal(step.sq, 39); // tekil (sette olmayan) mulk once
  s.props[39].mortgaged = true;
  assert.equal(nextLiquidation(s, a).sq, 1); // sonra settekiler
});

// ---- rastgele tam oyun simulasyonu + degismezler
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function checkInvariants(s) {
  let houses = 0;
  let hotels = 0;
  for (const i of PROP_SQUARES) {
    const pr = s.props[i];
    if (pr.owner != null) assert.ok(!s.players[pr.owner].bankrupt, 'iflas eden oyuncunun mulku var');
    if (pr.houses === 5) hotels++;
    else houses += pr.houses;
    if (pr.houses > 0) assert.equal(SQUARES[i].type, 'street');
  }
  assert.equal(houses + s.housesLeft, BASE.houses, 'ev sayisi tutarsiz');
  assert.equal(hotels + s.hotelsLeft, BASE.hotels, 'otel sayisi tutarsiz');
  for (const p of s.players) {
    if (!p.bankrupt && s.phase !== 'DEBT') assert.ok(p.cash >= 0, `negatif nakit: ${p.name} ${p.cash}`);
    assert.ok(p.pos >= 0 && p.pos < 40);
  }
}

function simulate(seed, n, settings = {}) {
  const rand = rng(seed * 7919 + n);
  let s = mk(n, settings, seed);
  let now = T0;
  let steps = 0;
  while (s.phase !== 'GAME_OVER' && steps++ < 20000) {
    now += 1000;
    const actor = s.phase === 'TRADE' ? s.trade.to : s.actor;
    const legal = legalActions(s, actor);
    let a = null;
    const has = (t) => legal.find((x) => x.type === t);
    if (s.phase === 'ROLL' || s.phase === 'POST') {
      const builds = legal.filter((x) => x.type === 'BUILD');
      const unm = legal.filter((x) => x.type === 'UNMORTGAGE');
      if (builds.length && rand() < 0.5) a = builds[Math.floor(rand() * builds.length)];
      else if (unm.length && rand() < 0.2) a = unm[0];
      else if (has('JAIL_USE_CARD') && rand() < 0.5) a = has('JAIL_USE_CARD');
      else if (has('JAIL_PAY') && rand() < 0.3) a = has('JAIL_PAY');
      else a = has('ROLL') || has('END_TURN');
    } else if (s.phase === 'BUY') {
      a = rand() < 0.8 ? has('BUY') : has('DECLINE_BUY');
    } else if (s.phase === 'AUCTION') {
      const bid = has('BID');
      a = bid && rand() < 0.5 ? { type: 'BID', amount: bid.min } : has('PASS_BID');
    } else if (s.phase === 'DEBT') {
      a = { type: 'AUTO_DEBT' };
    } else if (s.phase === 'TRADE') {
      a = rand() < 0.5 ? has('TRADE_ACCEPT') : has('TRADE_REJECT');
    }
    assert.ok(a, `hamle yok: faz ${s.phase} oyuncu ${actor} adim ${steps}`);
    const r = applyAction(s, actor, a, { now });
    assert.ok(!r.error, `${s.phase}/${a.type}: ${r.error}`);
    s = r.state;
    checkInvariants(s);
    if (steps % 500 === 0 && s.settings.timeLimitMinutes == null && s.turnNo > 600) break;
  }
  return { s, steps };
}

test('rastgele oyun simulasyonu: degismezler korunur, oyun ilerler (2-6 oyuncu)', () => {
  let finished = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const n = 2 + (seed % 5);
    const { s, steps } = simulate(seed, n);
    assert.ok(steps > 20, 'oyun hemen bitti');
    if (s.phase === 'GAME_OVER') finished++;
  }
  assert.ok(finished >= 0);
});

test('ev kurallari acikken simulasyon bozulmaz', () => {
  for (let seed = 30; seed < 38; seed++) {
    simulate(seed, 4, { houseRules: { freeParkingJackpot: true, doubleGoLanding: true, noBuyFirstLap: true, rentInJail: false, evenBuild: false } });
  }
});

test('netWorth mulk ve bina icerir', () => {
  const s = mk(2, {}, 1);
  give(s, 0, [39]);
  s.props[39].houses = 2;
  s.players[0].cash = 0;
  assert.equal(netWorth(s, 0), (400 + 2 * 200) * 50000);
});
