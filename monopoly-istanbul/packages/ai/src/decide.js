// Bot karar mantigi: decide(state, oyuncuId, ozellikler, rand, memo) -> eylem | null
import {
  SQUARES, GROUPS, BASE, PROP_SQUARES,
  legalActions, validate, nextLiquidation, ownedSquares,
} from '../../engine/src/index.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function reserveOf(tr, mult) {
  return (0.15 + 0.85 * (tr.cashBuffer / 100)) * 250 * mult;
}
function lowLine(tr, mult) {
  return (tr.mortgageLine / 100) * 60 * mult;
}
function ownedFraction(s) {
  return PROP_SQUARES.filter((i) => s.props[i].owner != null).length / PROP_SQUARES.length;
}
function groupList(sq) {
  const q = SQUARES[sq];
  if (q.type === 'street') return GROUPS[q.group];
  if (q.type === 'station') return [5, 15, 25, 35];
  return [12, 28];
}
// Mulkun bu oyuncu icin set degeri: 1 = seti tamamlar, 0..1 = kismi
function setProgress(s, pid, sq, extra = []) {
  const others = groupList(sq).filter((i) => i !== sq);
  const mine = others.filter((i) => s.props[i].owner === pid || extra.includes(i)).length;
  return others.length ? mine / others.length : 0;
}
// Rakip seti tamamlamak uzere mi? (diger tum kareler tek bir rakipte)
function blocksOpponent(s, pid, sq) {
  const others = groupList(sq).filter((i) => i !== sq);
  const owners = new Set(others.map((i) => s.props[i].owner));
  return owners.size === 1 && !owners.has(null) && !owners.has(pid);
}

export function decide(state, pid, tr, rand = Math.random, memo = {}) {
  const legal = legalActions(state, pid);
  if (!legal.length) return null;
  const has = (t) => legal.find((a) => a.type === t);
  const mult = state.settings.mult;
  const me = state.players[pid];
  const reserve = reserveOf(tr, mult);

  switch (state.phase) {
    case 'BUY': {
      const { sq, price } = state.buy;
      const q = SQUARES[sq];
      let score = tr.appetite / 100;
      const prog = setProgress(state, pid, sq);
      if (q.type === 'street' && prog === 1) score += 0.6;
      else if (prog > 0) score += 0.25 * (tr.setFocus / 100) * prog + 0.1;
      if (blocksOpponent(state, pid, sq)) score += 0.3 * (tr.setFocus / 100) + 0.1;
      if (q.type === 'station') score += 0.15;
      if (q.type === 'utility') score -= 0.05;
      if (ownedFraction(state) < 0.4) score += 0.15;
      if (me.cash - price < reserve) score -= prog === 1 ? 0.15 : 0.5;
      score += rand() * 0.3 - 0.15;
      return score > 0.45 && has('BUY') ? has('BUY') : has('DECLINE_BUY');
    }

    case 'AUCTION': {
      const au = state.auction;
      const q = SQUARES[au.sq];
      const price = q.price * mult;
      const inc = BASE.auctionInc * mult;
      const prog = setProgress(state, pid, au.sq);
      let max = price * (0.55 + 0.7 * (tr.auctionAggr / 100));
      if (q.type === 'street' && prog === 1) max *= 1.6;
      else if (prog > 0) max *= 1 + 0.3 * (tr.setFocus / 100) * prog;
      if (blocksOpponent(state, pid, au.sq)) max *= 1 + 0.35 * (tr.setFocus / 100);
      const cap = me.cash - (prog === 1 ? 0 : reserve * 0.6);
      max = Math.floor(Math.min(max, cap));
      const bid = has('BID');
      if (bid && max >= bid.min) {
        const step = Math.max(inc, Math.round((max - au.high) / 3 / inc) * inc);
        const amount = Math.max(bid.min, Math.min(max, au.high + step));
        if (!validate(state, pid, { type: 'BID', amount })) return { type: 'BID', amount };
      }
      return has('PASS_BID') || null;
    }

    case 'DEBT':
      return nextLiquidation(state, pid) || has('DECLARE_BANKRUPT');

    case 'TRADE':
      return decideTradeResponse(state, pid, tr, legal);

    case 'ROLL':
    case 'POST': {
      if (state.phase === 'ROLL' && me.inJail) {
        const out = jailPlan(state, pid, tr, rand, reserve, has);
        if (out) return out;
      }
      const m = manage(state, pid, tr, rand, memo, legal, reserve);
      if (m) return m;
      return has('ROLL') || has('END_TURN') || null;
    }
    default:
      return null;
  }
}

function jailPlan(s, pid, tr, rand, reserve, has) {
  const frac = ownedFraction(s);
  const pOut = frac < 0.55 ? 0.9 : (1 - tr.jailStrategy / 100) * 0.8 + 0.1;
  const wantsOut = rand() < pOut;
  if (!wantsOut) return null; // zar atip cift denemek
  if (has('JAIL_USE_CARD')) return has('JAIL_USE_CARD');
  const fee = BASE.jailFee * s.settings.mult;
  if (has('JAIL_PAY') && s.players[pid].cash - fee >= reserve * 0.5) return has('JAIL_PAY');
  return null;
}

function manage(s, pid, tr, rand, memo, legal, reserve) {
  const mult = s.settings.mult;
  const me = s.players[pid];
  const line = lowLine(tr, mult);

  // 1) Nakit cok azsa tekil bir mulku ipotek et.
  if (me.cash < line) {
    const single = legal
      .filter((a) => a.type === 'MORTGAGE')
      .filter((a) => !(SQUARES[a.sq].type === 'street' && setProgress(s, pid, a.sq) === 1))
      .sort((x, y) => SQUARES[x.sq].price - SQUARES[y.sq].price);
    if (single.length) return single[0];
  }

  // 2) Nakit bolsa ipotek boz (en degerli once).
  const unm = legal.filter((a) => a.type === 'UNMORTGAGE').sort((x, y) => SQUARES[y.sq].price - SQUARES[x.sq].price);
  for (const a of unm) {
    const cost = Math.ceil((SQUARES[a.sq].price / 2) * 1.1) * mult;
    if (me.cash - cost >= Math.max(1.5 * reserve, 2 * line + 50 * mult)) return a;
  }

  // 3) Bina yap.
  const builds = legal.filter((a) => a.type === 'BUILD');
  if (builds.length && rand() < 0.4 + 0.6 * (tr.buildDrive / 100)) {
    const need = reserve * (1 - 0.7 * (tr.buildDrive / 100));
    const ranked = builds
      .map((a) => {
        const q = SQUARES[a.sq];
        const h = s.props[a.sq].houses;
        return { a, cost: q.house * mult, gain: (q.rent[h + 1] - q.rent[h]) / q.house };
      })
      .filter((x) => me.cash - x.cost >= need)
      .sort((x, y) => y.gain - x.gain);
    if (ranked.length) return ranked[0].a;
  }

  // 4) Takas: bir setin son parcasini nakitle almayi dene.
  const trade = proposeTrade(s, pid, tr, rand, memo, reserve);
  if (trade) return trade;
  return null;
}

function proposeTrade(s, pid, tr, rand, memo, reserve) {
  if (!legalCanTrade(s, pid)) return null;
  if (rand() > (tr.tradeDrive / 100) * 0.5) return null;
  const mult = s.settings.mult;
  const me = s.players[pid];
  memo.tried ||= {};
  for (const g of Object.keys(GROUPS)) {
    const missing = GROUPS[g].filter((i) => s.props[i].owner !== pid);
    if (missing.length !== 1) continue;
    const sq = missing[0];
    const owner = s.props[sq].owner;
    if (owner == null || s.players[owner].bankrupt) continue;
    const key = `${owner}:${sq}`;
    if (memo.tried[key] != null && s.turnNo - memo.tried[key] < 15) continue;
    const price = SQUARES[sq].price * mult;
    const cash = Math.round((price * (1.3 + (tr.tradeDrive / 100) * 0.9)) / mult) * mult;
    if (cash > me.cash - reserve * 0.3) continue;
    const action = { type: 'TRADE_PROPOSE', to: owner, give: { cash, props: [], jailCards: 0 }, get: { cash: 0, props: [sq], jailCards: 0 } };
    if (validate(s, pid, action)) continue;
    memo.tried[key] = s.turnNo;
    return action;
  }
  return null;
}
function legalCanTrade(s, pid) {
  return (s.phase === 'ROLL' || s.phase === 'POST') && s.current === pid && s.players.filter((p) => !p.bankrupt).length > 1;
}

function decideTradeResponse(s, pid, tr, legal) {
  const t = s.trade;
  const mult = s.settings.mult;
  const accept = legal.find((a) => a.type === 'TRADE_ACCEPT');
  const reject = legal.find((a) => a.type === 'TRADE_REJECT');
  if (!accept) return reject;
  const incoming = t.give; // bana gelen
  const outgoing = t.get; // benden giden
  const incomingSet = incoming.props || [];
  const outgoingSet = outgoing.props || [];
  const value = (sq, gaining) => {
    const q = SQUARES[sq];
    let v = q.price * mult * (s.props[sq].mortgaged ? 0.6 : 1);
    if (gaining) {
      const prog = setProgress(s, pid, sq, incomingSet);
      if (q.type === 'street' && prog === 1) v *= 1.9;
      else if (prog > 0) v *= 1.2;
    } else {
      if (q.type === 'street' && setProgress(s, pid, sq) === 1) v *= 2.2;
      // Rakibe set tamamlatiyor mu?
      const others = groupList(sq).filter((i) => i !== sq);
      if (others.every((i) => s.props[i].owner === t.from || incomingSet.includes(i) === false && s.props[i].owner === t.from)) v += q.price * mult * 0.9;
    }
    return v;
  };
  let gain = (incoming.cash || 0) + (incoming.jailCards || 0) * 50 * mult;
  let loss = (outgoing.cash || 0) + (outgoing.jailCards || 0) * 50 * mult;
  for (const sq of incomingSet) gain += value(sq, true);
  for (const sq of outgoingSet) loss += value(sq, false);
  const net = gain - loss;
  const ok = net > 0 || (tr.tradeDrive > 75 && net > -0.08 * loss);
  return ok ? accept : reject;
}

// Disaridan kullanim: botun sahip oldugu mulkleri vs. icin
export { ownedSquares };
