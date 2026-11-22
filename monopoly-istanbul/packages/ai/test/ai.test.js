import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, autoAction } from '../../engine/src/index.js';
import { decide, generateTraits, normalTrait, thinkDelayMs, pickNames, NAMES, TRAIT_KEYS } from '../src/index.js';

function lcg(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

test('ozellikler 1-100, ortalama ~50, normal dagilim', () => {
  const r = lcg(5);
  const xs = Array.from({ length: 5000 }, () => normalTrait(r));
  assert.ok(xs.every((x) => x >= 1 && x <= 100 && Number.isInteger(x)));
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(Math.abs(mean - 50) < 2, `ortalama ${mean}`);
  const mid = xs.filter((x) => x >= 32 && x <= 68).length / xs.length;
  assert.ok(mid > 0.64 && mid < 0.74, `orta oran ${mid}`);
  assert.deepEqual(Object.keys(generateTraits(r)), TRAIT_KEYS);
});

test('dusunme gecikmesi 1000-3000 ms', () => {
  assert.equal(thinkDelayMs({ thinkDelay: 1 }), 1000);
  assert.equal(thinkDelayMs({ thinkDelay: 100 }), 3000);
  const mid = thinkDelayMs({ thinkDelay: 50 });
  assert.ok(mid > 1900 && mid < 2100);
});

test('isimler: 100 benzersiz, secim tekrarsiz', () => {
  assert.equal(NAMES.length, 100);
  assert.equal(new Set(NAMES).size, 100);
  const p = pickNames(5, lcg(3), ['Ayşe']);
  assert.equal(new Set(p).size, 5);
  assert.ok(!p.includes('Ayşe'));
});

// Botlar arasi tam oyun: her karar gecerli olmali, oyun bitmeli ya da sure sinirina dayanmali.
function botGame(seed, n, settings = {}, maxSteps = 30000) {
  const rand = lcg(seed * 31 + 7);
  const traits = Array.from({ length: n }, () => generateTraits(rand));
  const memos = Array.from({ length: n }, () => ({}));
  let s = createGame({ players: Array.from({ length: n }, (_, i) => ({ name: 'B' + i })), settings, seed, now: 0 });
  let now = 0;
  let steps = 0;
  let trades = 0;
  let auctions = 0;
  while (s.phase !== 'GAME_OVER' && steps++ < maxSteps) {
    now += 1500;
    const actor = s.phase === 'TRADE' ? s.trade.to : s.actor;
    let a = decide(s, actor, traits[actor], rand, memos[actor]);
    assert.ok(a, `bot hamle bulamadi: faz ${s.phase} oyuncu ${actor}`);
    let r = applyAction(s, actor, a, { now });
    if (r.error) {
      // gecersiz bot hamlesi bir hatadir
      assert.fail(`gecersiz bot hamlesi ${JSON.stringify(a)} faz ${s.phase}: ${r.error}`);
    }
    if (a.type === 'TRADE_PROPOSE') trades++;
    if (s.phase !== 'AUCTION' && r.state.phase === 'AUCTION') auctions++;
    s = r.state;
    // Sonsuz dongu onleme: cok uzun oyunda sure siniri ile bitir
    if (s.turnNo > 1500) break;
  }
  return { s, steps, trades, auctions };
}

test('botlar arasi oyun: gecersiz hamle yok, cogu oyun biter', () => {
  let over = 0;
  let trades = 0;
  let auctions = 0;
  const N = 16;
  for (let seed = 1; seed <= N; seed++) {
    const n = 2 + (seed % 5);
    const out = botGame(seed, n);
    if (out.s.phase === 'GAME_OVER') over++;
    trades += out.trades;
    auctions += out.auctions;
  }
  assert.ok(over >= N * 0.5, `biten oyun: ${over}/${N}`);
  console.log(`  [bilgi] biten ${over}/${N}, takas teklifi ${trades}, muzayede ${auctions}`);
});

test('bot oyunu: ev kurallari farkli', () => {
  const out = botGame(77, 4, { houseRules: { freeParkingJackpot: true, doubleGoLanding: true, noBuyFirstLap: true, rentInJail: false, evenBuild: false, auction: false } });
  assert.ok(out.steps > 50);
});
