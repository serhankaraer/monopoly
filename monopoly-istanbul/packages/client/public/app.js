import { SQUARES, GROUPS, GROUP_COLORS } from '/shared/data.js';
import { h, fmt, parseMoney, PLAYER_COLORS } from './util.js';
import { Board } from './board.js';

const $root = document.getElementById('root');
const $toasts = document.getElementById('toasts');
const $modal = document.getElementById('modal');

const RULE_LABELS = {
  auction: 'Satın alınmayan mülk müzayedeye çıksın',
  evenBuild: 'Eşit yapılaşma zorunlu (evler dengeli dağıtılır)',
  rentInJail: 'Kodes\'tekiler de kira toplayabilsin',
  freeParkingJackpot: 'Vergi ve cezalar Ücretsiz Otopark\'ta birikir, oraya inen alır',
  doubleGoLanding: 'Başlangıç\'a tam inene çifte maaş',
  noBuyFirstLap: 'İlk turda mülk satın alınamaz',
};

const A = {
  ws: null, token: null, name: '', room: null, you: null, host: false,
  screen: 'home', lobby: null, st: null, offset: 0, timerTotal: 30000,
  animPos: {}, animQueue: [], animating: false, diceFresh: false,
  ui: { bid: '', trade: null }, retry: 0, fatal: false, banner: '', board: null, els: {}, lastPhaseKey: '',
};

// ---------------------------------------------------------------- yardimcilar
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* */ } },
};
function uid() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function toast(text, kind = 'info', ms = 3200) {
  const t = h('div', { class: `toast ${kind}` }, text);
  $toasts.append(t);
  setTimeout(() => t.remove(), ms);
}
function send(o) { if (A.ws && A.ws.readyState === 1) A.ws.send(JSON.stringify(o)); }
function act(action) { send({ type: 'act', action }); }
const mult = () => A.st?.view.settings.mult ?? 1;
const money = (base) => fmt(base * mult());

// ---------------------------------------------------------------- baglanti
function connect(first) {
  A.fatal = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  A.ws = ws;
  ws.onopen = () => { A.retry = 0; setBanner(''); ws.send(JSON.stringify(first)); };
  ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => {
    if (A.ws !== ws) return;
    A.ws = null;
    if (A.fatal || !A.room) return;
    setBanner('Bağlantı koptu, yeniden bağlanılıyor…');
    const delay = Math.min(5000, 600 * 2 ** A.retry++);
    setTimeout(() => {
      if (!A.ws && A.room && !A.fatal) connect({ type: 'join', room: A.room, name: A.name, token: A.token });
    }, delay);
  };
}
function setBanner(t) {
  A.banner = t;
  let b = document.getElementById('banner');
  if (!t) { b?.remove(); return; }
  if (!b) { b = h('div', { id: 'banner' }); document.body.append(b); }
  b.textContent = t;
}
function endSession(message) {
  A.fatal = true;
  A.room = null; A.you = null; A.st = null; A.lobby = null; A.board = null;
  store.set('room', null);
  history.replaceState(null, '', location.pathname);
  try { A.ws?.close(); } catch { /* */ }
  A.ws = null;
  setBanner('');
  A.screen = 'home';
  render();
  if (message) toast(message, 'err', 4500);
}

function onMsg(m) {
  switch (m.type) {
    case 'joined':
      A.room = m.room; A.you = m.seat; A.host = m.host;
      store.set('room', m.room);
      history.replaceState(null, '', `?oda=${m.room}`);
      break;
    case 'host': A.host = m.host; if (A.screen === 'lobby') render(); break;
    case 'lobby':
      A.lobby = m; A.st = null; A.board = null; A.host = m.host === m.you; A.you = m.you;
      A.screen = 'lobby'; A.animPos = {}; A.animQueue = [];
      closeModal(); render();
      break;
    case 'state': onState(m); break;
    case 'events': onEvents(m); break;
    case 'timer':
      if (A.st) {
        A.offset = m.serverNow - Date.now();
        A.st.seats = m.seats;
        if (m.deadline) A.st.deadline = m.deadline;
        renderPlayers();
      }
      break;
    case 'error':
      if (m.fatal) { endSession(m.message); } else toast(m.message, 'err');
      break;
    default:
  }
}

function onState(m) {
  const first = !A.st;
  A.st = m;
  A.host = m.host === m.you;
  A.offset = m.serverNow - Date.now();
  A.timerTotal = Math.max(1000, m.deadline - m.serverNow);
  if (A.screen !== 'game' || !A.board) { A.screen = 'game'; A.board = null; render(); }
  else if (first) render();
  updateGame();
}

// ---------------------------------------------------------------- olaylar / animasyon
function onEvents(m) {
  for (const ev of m.list) {
    if (ev.t === 'move') A.animQueue.push(ev);
    else if (ev.t === 'dice') A.diceFresh = true;
    else if (ev.t === 'card') showCard(ev);
  }
  runAnim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runAnim() {
  if (A.animating) return;
  A.animating = true;
  while (A.animQueue.length) {
    const ev = A.animQueue.shift();
    const forward = !ev.jail && (ev.to > ev.from || ev.passed);
    A.animPos[ev.pid] = ev.from;
    drawTokens();
    if (forward) {
      let p = ev.from;
      let guard = 0;
      while (p !== ev.to && guard++ < 41) {
        p = (p + 1) % 40;
        A.animPos[ev.pid] = p;
        drawTokens();
        await sleep(85);
      }
    } else {
      await sleep(250);
      A.animPos[ev.pid] = ev.to;
      drawTokens();
    }
    await sleep(160);
    if (!A.animQueue.some((e) => e.pid === ev.pid)) delete A.animPos[ev.pid];
    drawTokens();
  }
  A.animating = false;
}
function drawTokens() {
  if (A.board && A.st) A.board.renderTokens(A.st.view, A.animPos, A.st.view.current);
}
function showCard(ev) {
  const v = A.st?.view;
  const who = v?.players[ev.pid]?.name ?? '';
  const pop = h('div', { class: `cardpop ${ev.deck}` },
    h('div', { class: 'cp-title' }, ev.deck === 'chance' ? 'ŞANS' : 'KAMU FONU'),
    h('div', { class: 'cp-who' }, who),
    h('div', { class: 'cp-text' }, ev.text));
  const pops = $toasts.querySelectorAll('.cardpop');
  if (pops.length >= 2) pops[0].remove();
  $toasts.append(pop);
  setTimeout(() => pop.classList.add('out'), 3300);
  setTimeout(() => pop.remove(), 3800);
}

// ---------------------------------------------------------------- ekranlar
function render() {
  $root.replaceChildren();
  if (A.screen === 'home') $root.append(homeView());
  else if (A.screen === 'lobby') $root.append(lobbyView());
  else if (A.screen === 'game') $root.append(gameShell());
}

function homeView() {
  const params = new URLSearchParams(location.search);
  const nameIn = h('input', { id: 'nick', maxlength: 16, placeholder: 'Takma adın', value: store.get('nick') || '', autocomplete: 'off' });
  const codeIn = h('input', { id: 'code', maxlength: 4, placeholder: 'ODA KODU', value: (params.get('oda') || '').toUpperCase(), autocomplete: 'off', class: 'code' });
  const go = (type) => {
    const name = nameIn.value.trim();
    if (name.length < 2) { toast('Takma ad en az 2 karakter olmalı.', 'err'); nameIn.focus(); return; }
    A.name = name; A.token = store.get('token') || uid(); store.set('token', A.token); store.set('nick', name);
    const msg = { type, name, token: A.token };
    if (type === 'join') {
      const code = codeIn.value.trim().toUpperCase();
      if (code.length !== 4) { toast('Oda kodu 4 karakter olmalı.', 'err'); codeIn.focus(); return; }
      msg.room = code;
    }
    A.fatal = false;
    connect(msg);
  };
  for (const i of [nameIn, codeIn]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(codeIn.value.trim() ? 'join' : 'create'); });
  return h('div', { class: 'home' },
    h('div', { class: 'home-card' },
      h('h1', {}, 'Emlak Ticareti', h('span', {}, 'İstanbul')),
      h('p', { class: 'tag' }, 'Semtleri satın al, ev dik, rakiplerini iflasa sürükle.'),
      h('label', {}, 'Takma adın', nameIn),
      h('button', { class: 'btn primary big', onclick: () => go('create') }, 'Yeni Oda Kur'),
      h('div', { class: 'or' }, 'ya da'),
      h('div', { class: 'row' }, codeIn, h('button', { class: 'btn big', onclick: () => go('join') }, 'Odaya Katıl')),
      h('p', { class: 'small' }, '2–6 oyuncu · boş koltuklara karakterli botlar oturur · her kararda 30 saniye')));
}

function lobbyView() {
  const L = A.lobby;
  const host = A.host;
  const link = `${location.origin}/?oda=${L.room}`;
  const s = L.settings;
  const set = (patch) => send({ type: 'lobby.set', ...patch });
  const timeSel = h('select', { disabled: !host, onchange: (e) => set({ settings: { timeLimitMinutes: e.target.value === '' ? null : Number(e.target.value) } }) },
    h('option', { value: '' }, 'Süresiz (tek oyuncu kalana kadar)'),
    L.timeOptions.map((m) => h('option', { value: m, selected: s.timeLimitMinutes === m }, `${m} dakika`)));
  if (s.timeLimitMinutes == null) timeSel.value = '';
  const multIn = h('input', { type: 'text', value: s.mult.toLocaleString('tr'), disabled: !host, inputmode: 'numeric', class: 'num',
    onchange: (e) => { const n = parseMoney(e.target.value); if (n >= 1) set({ settings: { mult: n } }); else e.target.value = s.mult.toLocaleString('tr'); } });
  return h('div', { class: 'lobby' },
    h('div', { class: 'lobby-card' },
      h('div', { class: 'lobby-head' },
        h('div', {}, h('div', { class: 'small' }, 'Oda kodu'), h('div', { class: 'roomcode' }, L.room)),
        h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Davet bağlantısı kopyalandı.'); } catch { toast(link); } } }, 'Davet Bağlantısını Kopyala')),
      h('h3', {}, 'Oyuncular'),
      h('div', { class: 'seats' }, L.seats.map((seat) => seatRow(seat, L, host))),
      h('h3', {}, 'Ayarlar', host ? '' : h('span', { class: 'small' }, '  (yalnızca oda sahibi değiştirir)')),
      h('div', { class: 'form' },
        h('label', {}, 'Oyuncu sayısı', h('select', { disabled: !host, onchange: (e) => set({ playerCount: Number(e.target.value) }) },
          [2, 3, 4, 5, 6].map((n) => h('option', { value: n, selected: n === L.playerCount }, `${n} oyuncu`)))),
        h('label', {}, 'Başlangıç parası (baz)', h('select', { disabled: !host, onchange: (e) => set({ settings: { startCash: Number(e.target.value) } }) },
          L.cashOptions.map((c) => h('option', { value: c, selected: c === s.startCash }, `${c.toLocaleString('tr')} → ${fmt(c * s.mult)}`)))),
        h('label', {}, 'Para çarpanı', multIn, h('span', { class: 'small' }, `Orijinal tutarlar × ${s.mult.toLocaleString('tr')} (Başlangıç maaşı ${fmt(200 * s.mult)})`)),
        h('label', {}, 'Oyun süresi', timeSel)),
      h('h3', {}, 'Ev kuralları'),
      h('div', { class: 'rules' }, Object.entries(RULE_LABELS).map(([k, label]) =>
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!s.houseRules[k], disabled: !host, onchange: (e) => set({ settings: { houseRules: { [k]: e.target.checked } } }) }), label))),
      h('div', { class: 'lobby-foot' },
        h('button', { class: 'btn', onclick: () => { send({ type: 'leave' }); endSession(); } }, 'Odadan Çık'),
        host ? h('button', { class: 'btn primary big', onclick: () => send({ type: 'start' }) }, 'Oyunu Başlat') : h('span', { class: 'small' }, 'Oda sahibinin başlatması bekleniyor…'))));
}

function seatRow(seat, L, host) {
  const you = seat.seat === L.you;
  let body;
  if (seat.kind === 'human') body = h('span', { class: 'sname' }, seat.name, you ? h('em', {}, ' (sen)') : '', seat.seat === L.host ? h('span', { class: 'badge' }, 'oda sahibi') : '');
  else if (seat.kind === 'bot') body = h('span', { class: 'sname bot' }, seat.name, h('span', { class: 'badge bot' }, 'BOT'));
  else body = h('span', { class: 'sname empty' }, 'Boş koltuk (başlarken bot oturur)');
  return h('div', { class: 'seat' },
    h('span', { class: 'dot', style: { background: PLAYER_COLORS[seat.seat] } }), body,
    host && seat.kind !== 'human' ? h('button', { class: 'btn small', onclick: () => send({ type: 'seat.set', seat: seat.seat, kind: seat.kind === 'bot' ? 'open' : 'bot' }) }, seat.kind === 'bot' ? 'Boşalt' : 'Bot ekle') : null);
}

// ---------------------------------------------------------------- oyun ekrani
function gameShell() {
  const boardWrap = h('div', { class: 'board-wrap' });
  const E = A.els = {
    timer: h('div', { class: 'timerbox' }),
    players: h('div', { class: 'players' }),
    action: h('div', { class: 'action' }),
    props: h('div', { class: 'props' }),
    log: h('div', { class: 'log' }),
  };
  A.board = new Board(boardWrap, (i) => showDeed(i));
  return h('div', { class: 'game' },
    boardWrap,
    h('aside', { class: 'side' },
      h('div', { class: 'topbar' },
        h('span', { class: 'rc' }, `Oda ${A.room}`),
        h('button', { class: 'btn small', onclick: () => { if (confirm('Oyundan çıkarsan yerine bot geçer. Çıkılsın mı?')) { send({ type: 'leave' }); endSession(); } } }, 'Çık')),
      E.timer, E.players, E.action, E.props, h('h4', {}, 'Olaylar'), E.log));
}

function updateGame() {
  if (!A.board) return;
  const m = A.st;
  A.board.render({ ...m.view, diceFresh: A.diceFresh });
  A.diceFresh = false;
  drawTokens();
  renderPlayers(); renderAction(); renderProps(); renderLog(); tickTimer();
  const key = `${m.view.phase}:${m.view.actor}`;
  if (A.ui.trade && !(m.view.phase === 'ROLL' || m.view.phase === 'POST') ) closeModal();
  A.lastPhaseKey = key;
}

function keepFocus(fn) {
  const a = document.activeElement;
  const id = a && a.id;
  const sel = a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (id) { const n = document.getElementById(id); if (n) { n.focus(); if (sel && n.setSelectionRange) try { n.setSelectionRange(...sel); } catch { /* */ } } }
}

function renderPlayers() {
  if (!A.els.players || !A.st) return;
  const m = A.st, v = m.view;
  A.els.players.replaceChildren(...v.players.map((p) => {
    const st = m.seats?.[p.id] || {};
    const owned = Object.values(v.props).filter((x) => x.owner === p.id).length;
    const badges = [];
    if (p.id === m.you) badges.push(h('span', { class: 'badge you' }, 'sen'));
    if (st.human && !st.connected) badges.push(h('span', { class: 'badge off' }, st.bot ? 'bot devraldı' : 'bağlantı yok'));
    else if (st.bot && !st.human) badges.push(h('span', { class: 'badge bot' }, 'BOT'));
    if (p.inJail) badges.push(h('span', { class: 'badge jail' }, 'Kodes'));
    if (p.cards.length) badges.push(h('span', { class: 'badge card' }, `🎟️×${p.cards.length}`));
    if (p.bankrupt) badges.push(h('span', { class: 'badge off' }, 'iflas'));
    return h('div', { class: `prow${p.id === v.current && v.phase !== 'GAME_OVER' ? ' cur' : ''}${p.bankrupt ? ' dead' : ''}` },
      h('span', { class: 'dot', style: { background: PLAYER_COLORS[p.id] } }),
      h('span', { class: 'pname' }, p.name),
      h('span', { class: 'pbad' }, badges),
      h('span', { class: 'pcash' }, fmt(p.cash)),
      h('span', { class: 'pprops', title: 'Mülk sayısı' }, `🏠${owned}`));
  }));
}

function tickTimer() {
  const box = A.els.timer;
  if (!box || !A.st) return;
  const m = A.st, v = m.view;
  if (v.phase === 'GAME_OVER') { box.replaceChildren(); return; }
  const left = Math.max(0, (m.deadline - (Date.now() + A.offset)) / 1000);
  const actor = v.players[m.actor];
  let bar = box.querySelector('.bar > i');
  if (!bar) {
    box.replaceChildren(h('div', { class: 'tline' }, h('span', { class: 'who' }), h('span', { class: 'secs' })), h('div', { class: 'bar' }, h('i')));
    bar = box.querySelector('.bar > i');
  }
  box.querySelector('.who').textContent = m.actor === m.you ? 'Senin kararın' : `${actor?.name ?? ''} düşünüyor`;
  box.querySelector('.secs').textContent = `${Math.ceil(left)} sn`;
  bar.style.width = `${Math.min(100, (left * 1000 / A.timerTotal) * 100)}%`;
  box.classList.toggle('low', left <= 5);
  box.classList.toggle('mine', m.actor === m.you);
}
setInterval(tickTimer, 250);

function renderLog() {
  const box = A.els.log;
  if (!box || !A.st) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.replaceChildren(...A.st.view.log.map((t) => h('div', { class: 'lg' }, t)));
  if (atBottom) box.scrollTop = box.scrollHeight;
}

// ---- eylem paneli
const legalList = () => A.st.legal;
const hasL = (t) => legalList().find((a) => a.type === t);

function btn(label, action, cls = 'primary', extra = {}) {
  return h('button', { class: `btn ${cls}`, onclick: () => (typeof action === 'function' ? action() : act(action)), ...extra }, label);
}
function propCard(sq) {
  const q = SQUARES[sq];
  const col = q.type === 'street' ? GROUP_COLORS[q.group] : '#888';
  return h('div', { class: 'propcard' }, h('i', { style: { background: col } }), h('b', {}, q.name), h('span', {}, money(q.price)));
}

function renderAction() {
  const box = A.els.action;
  if (!box || !A.st) return;
  keepFocus(() => {
    box.replaceChildren();
    const m = A.st, v = m.view, me = m.you;
    const meP = v.players[me];
    const mine = v.current === me;
    const name = (i) => v.players[i]?.name ?? '';
    if (v.phase === 'GAME_OVER') return box.append(gameOverView());
    if (meP.bankrupt) box.append(h('p', { class: 'note' }, 'İflas ettin. Oyunu izlemeye devam edebilirsin.'));

    if (v.phase === 'ROLL' || v.phase === 'POST') {
      if (!mine) { box.append(h('p', { class: 'note' }, `Sıra ${name(v.current)} oyuncusunda.`)); return; }
      const row = h('div', { class: 'btns' });
      if (v.phase === 'ROLL' && meP.inJail) box.append(h('p', { class: 'note' }, `Kodes'tesin (${meP.jailTries}/3 deneme). Çift atarak çık ya da kefalet öde.`));
      if (v.phase === 'POST' && v.extraRoll) box.append(h('p', { class: 'note' }, 'Çift attın, bir kez daha zar atabilirsin.'));
      if (hasL('ROLL')) row.append(btn(v.phase === 'POST' ? 'Tekrar Zar At' : 'Zar At', { type: 'ROLL' }));
      if (hasL('JAIL_PAY')) row.append(btn(`Kefalet Öde (${money(50)})`, { type: 'JAIL_PAY' }, ''));
      if (hasL('JAIL_USE_CARD')) row.append(btn('Kodes Kartını Kullan', { type: 'JAIL_USE_CARD' }, ''));
      if (hasL('END_TURN')) row.append(btn('Turu Bitir', { type: 'END_TURN' }, v.extraRoll ? '' : 'primary'));
      if (hasL('TRADE_PROPOSE')) row.append(btn('Takas Teklif Et', openTrade, ''));
      box.append(row);
    } else if (v.phase === 'BUY') {
      const sq = v.buy.sq;
      if (m.actor !== me) { box.append(h('p', { class: 'note' }, `${name(m.actor)}, ${SQUARES[sq].name} mülkünü alıp almayacağına karar veriyor.`)); return; }
      box.append(h('h4', {}, 'Boş mülke geldin'), propCard(sq),
        h('p', { class: 'small' }, v.settings.houseRules.auction ? 'Vazgeçersen mülk herkese müzayedeyle açılır.' : 'Vazgeçersen mülk sahipsiz kalır.'),
        h('div', { class: 'btns' },
          hasL('BUY') ? btn(`Satın Al (${fmt(v.buy.price)})`, { type: 'BUY' }) : h('span', { class: 'note' }, 'Nakdin yetmiyor.'),
          btn('Vazgeç', { type: 'DECLINE_BUY' }, '')));
    } else if (v.phase === 'AUCTION') {
      const au = v.auction;
      const bid = hasL('BID');
      box.append(h('h4', {}, 'Müzayede'), propCard(au.sq),
        h('p', { class: 'hi' }, au.highBidder == null ? 'Henüz teklif yok.' : `En yüksek teklif: ${fmt(au.high)} — ${name(au.highBidder)}`),
        h('div', { class: 'chips' }, au.order.map((id) => h('span', { class: `chip${au.active.includes(id) ? '' : ' out'}${id === m.actor ? ' now' : ''}`, style: { borderColor: PLAYER_COLORS[id] } }, name(id)))));
      if (m.actor === me && bid) {
        const inc = 10 * mult();
        if (!A.ui.bid || parseMoney(A.ui.bid) < bid.min) A.ui.bid = String(bid.min);
        const inp = h('input', { id: 'bidin', class: 'num', value: A.ui.bid, inputmode: 'decimal', oninput: (e) => { A.ui.bid = e.target.value; } });
        const bump = (n) => { const cur = Math.max(bid.min, parseMoney(A.ui.bid) || bid.min); A.ui.bid = String(Math.min(bid.max, cur + n)); inp.value = A.ui.bid; };
        const submit = () => {
          const amount = parseMoney(A.ui.bid);
          if (!(amount >= bid.min)) { toast(`En az ${fmt(bid.min)} teklif etmelisin.`, 'err'); return; }
          if (amount > bid.max) { toast('Nakdinden fazla teklif veremezsin.', 'err'); return; }
          act({ type: 'BID', amount });
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        box.append(h('div', { class: 'bidrow' }, inp, btn('Teklif Ver', submit)),
          h('div', { class: 'btns' }, btn(`+${fmt(inc)}`, () => bump(inc), ''), btn(`+${fmt(inc * 5)}`, () => bump(inc * 5), ''), btn(`+${fmt(inc * 20)}`, () => bump(inc * 20), ''), btn('Çekil', { type: 'PASS_BID' }, 'danger')));
      } else if (m.actor === me) {
        box.append(h('div', { class: 'btns' }, btn('Çekil', { type: 'PASS_BID' }, 'danger')));
      } else box.append(h('p', { class: 'note' }, `Sıra ${name(m.actor)} oyuncusunda.`));
    } else if (v.phase === 'DEBT') {
      const d = v.debts[0];
      box.append(h('h4', {}, 'Borç'), h('p', { class: 'hi' }, `${name(d.debtor)} → ${d.creditor == null ? 'Banka' : name(d.creditor)}: ${fmt(d.amt)}`, h('small', {}, `  ${d.reason || ''}`)));
      if (m.actor === me) {
        box.append(h('p', { class: 'note' }, 'Nakdin yetmiyor. Aşağıdan bina sat / mülk ipotek et ya da otomatik çözdür.'),
          h('div', { class: 'btns' }, btn('Otomatik Çöz', { type: 'AUTO_DEBT' }), btn('İflas Et', () => { if (confirm('İflas etmek istediğine emin misin?')) act({ type: 'DECLARE_BANKRUPT' }); }, 'danger')));
      } else box.append(h('p', { class: 'note' }, `${name(d.debtor)} borcunu ödemeye çalışıyor…`));
    } else if (v.phase === 'TRADE') {
      const t = v.trade;
      box.append(h('h4', {}, 'Takas Teklifi'), h('p', { class: 'small' }, `${name(t.from)} → ${name(t.to)}`),
        h('div', { class: 'trade2' }, tradeSide(`${name(t.from)} veriyor`, t.give), tradeSide(`${name(t.to)} veriyor`, t.get)));
      if (me === t.to) box.append(h('div', { class: 'btns' }, btn('Kabul Et', { type: 'TRADE_ACCEPT' }), btn('Reddet', { type: 'TRADE_REJECT' }, 'danger')));
      else if (me === t.from) box.append(h('div', { class: 'btns' }, btn('Teklifi Geri Çek', { type: 'TRADE_CANCEL' }, '')));
    }
  });
}
function tradeSide(title, side) {
  const items = [];
  if (side.cash) items.push(h('div', {}, `💰 ${fmt(side.cash)}`));
  for (const sq of side.props) items.push(propCard(sq));
  if (side.jailCards) items.push(h('div', {}, `🎟️ Kodes kartı ×${side.jailCards}`));
  if (!items.length) items.push(h('div', { class: 'small' }, '—'));
  return h('div', { class: 'tside' }, h('b', {}, title), items);
}

function gameOverView() {
  const v = A.st.view;
  const w = v.players[v.winner];
  const rank = v.ranking;
  return h('div', { class: 'gameover' },
    h('h3', {}, '🏆 Oyun bitti'),
    h('p', { class: 'win' }, w ? `Kazanan: ${w.name}` : ''),
    v.endReason === 'time' ? h('p', { class: 'small' }, 'Süre doldu; net servete göre sıralandı.') : null,
    rank ? h('ol', {}, rank.map((r) => h('li', {}, `${v.players[r.id].name} — ${fmt(r.worth)}`))) : null,
    h('div', { class: 'btns' },
      A.host ? btn('Yeniden Oyna (Lobiye Dön)', () => send({ type: 'rematch' })) : h('span', { class: 'small' }, 'Oda sahibi yeniden başlatabilir.'),
      btn('Odadan Çık', () => { send({ type: 'leave' }); endSession(); }, '')));
}

// ---- mulklerim
function renderProps() {
  const box = A.els.props;
  if (!box || !A.st) return;
  const m = A.st, v = m.view;
  const sqs = Object.keys(v.props).map(Number).filter((i) => v.props[i].owner === m.you).sort((a, b) => a - b);
  box.replaceChildren();
  if (!sqs.length) return;
  const L = new Set(m.legal.map((a) => (a.sq != null ? `${a.type}:${a.sq}` : a.type)));
  box.append(h('h4', {}, 'Mülklerim'));
  for (const sq of sqs) {
    const q = SQUARES[sq], pr = v.props[sq];
    const col = q.type === 'street' ? GROUP_COLORS[q.group] : '#777';
    const status = pr.mortgaged ? 'ipotekli' : pr.houses === 5 ? 'otel' : pr.houses ? `${pr.houses} ev` : '';
    const b = [];
    const add = (type, label, title, cls = '') => { if (L.has(`${type}:${sq}`)) b.push(h('button', { class: `mini ${cls}`, title, onclick: () => act({ type, sq }) }, label)); };
    if (q.type === 'street') {
      add('BUILD', '＋', `${pr.houses === 4 ? 'Otel' : 'Ev'} yap (${money(q.house)})`);
      add('SELL_BUILDING', '－', `Binayı sat (+${money(q.house / 2)})`);
    }
    add('MORTGAGE', 'İpotek', `İpotek et (+${money(q.price / 2)})`);
    add('UNMORTGAGE', 'Kaldır', `İpoteği kaldır (−${money(Math.ceil(q.price / 2 * 1.1))})`);
    box.append(h('div', { class: `myprop${pr.mortgaged ? ' mort' : ''}` },
      h('i', { style: { background: col } }), h('span', { class: 'mpn', onclick: () => showDeed(sq) }, q.name),
      h('small', {}, status), h('span', { class: 'mpb' }, b)));
  }
}

// ---------------------------------------------------------------- modallar
function closeModal() { $modal.hidden = true; $modal.replaceChildren(); A.ui.trade = null; }
function openModal(content) {
  $modal.replaceChildren(h('div', { class: 'backdrop', onclick: closeModal }), h('div', { class: 'dialog' }, content));
  $modal.hidden = false;
}

function showDeed(i) {
  const q = SQUARES[i];
  if (!['street', 'station', 'utility'].includes(q.type)) return;
  const v = A.st?.view;
  const mu = v ? v.settings.mult : 1;
  const pr = v?.props[i];
  const rows = [];
  let head;
  if (q.type === 'street') {
    head = h('div', { class: 'deed-head', style: { background: GROUP_COLORS[q.group] } }, q.name);
    q.rent.forEach((r, k) => rows.push([k === 0 ? 'Kira' : k === 5 ? 'Otel' : `${k} ev`, fmt(r * mu)]));
    rows.push(['Set tamamsa (evsiz)', fmt(q.rent[0] * 2 * mu)], ['Ev / otel maliyeti', fmt(q.house * mu)]);
  } else if (q.type === 'station') {
    head = h('div', { class: 'deed-head grey' }, q.name);
    [25, 50, 100, 200].forEach((r, k) => rows.push([`${k + 1} istasyon`, fmt(r * mu)]));
  } else {
    head = h('div', { class: 'deed-head grey' }, q.name);
    rows.push(['1 kamu kuruluşu', 'zar × 4'], ['2 kamu kuruluşu', 'zar × 10'], ['Çarpan', fmt(mu)]);
  }
  rows.push(['Satın alma', fmt(q.price * mu)], ['İpotek değeri', fmt(q.price / 2 * mu)]);
  const owner = pr && pr.owner != null ? v.players[pr.owner].name : 'Sahipsiz';
  openModal(h('div', { class: 'deed' }, head, h('table', {}, rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', { class: 'r' }, b)))), h('p', { class: 'small' }, `Sahibi: ${owner}${pr?.mortgaged ? ' (ipotekli)' : ''}`), h('button', { class: 'btn', onclick: closeModal }, 'Kapat')));
}

function openTrade() {
  const m = A.st, v = m.view, me = m.you;
  const others = v.players.filter((p) => p.id !== me && !p.bankrupt);
  if (!others.length) return;
  A.ui.trade = { to: others[0].id, give: new Set(), get: new Set(), giveCash: '', getCash: '', giveCards: 0, getCards: 0 };
  drawTrade();
}
function drawTrade() {
  const m = A.st, v = m.view, me = m.you, T = A.ui.trade;
  if (!T) return;
  const others = v.players.filter((p) => p.id !== me && !p.bankrupt);
  const locked = (sq) => { const q = SQUARES[sq]; return q.type === 'street' && GROUPS[q.group].some((i) => v.props[i].houses > 0); };
  const list = (pid, set) => {
    const sqs = Object.keys(v.props).map(Number).filter((i) => v.props[i].owner === pid).sort((a, b) => a - b);
    if (!sqs.length) return h('div', { class: 'small' }, 'Mülk yok');
    return h('div', { class: 'tlist' }, sqs.map((sq) => {
      const q = SQUARES[sq];
      const dis = locked(sq);
      return h('label', { class: `tp${dis ? ' dis' : ''}`, title: dis ? 'Bu renk grubunda bina var; takas edilemez.' : '' },
        h('input', { type: 'checkbox', checked: set.has(sq), disabled: dis, onchange: (e) => { e.target.checked ? set.add(sq) : set.delete(sq); } }),
        h('i', { style: { background: q.type === 'street' ? GROUP_COLORS[q.group] : '#777' } }), q.name, v.props[sq].mortgaged ? h('small', {}, ' (ipotekli)') : '');
    }));
  };
  const myCards = v.players[me].cards.length, theirCards = v.players[T.to].cards.length;
  const cardSel = (n, key) => (n ? h('label', { class: 'small' }, 'Kodes kartı ', h('select', { onchange: (e) => { T[key] = Number(e.target.value); } }, Array.from({ length: n + 1 }, (_, k) => h('option', { value: k, selected: T[key] === k }, k)))) : null);
  const content = h('div', { class: 'tradebuilder' },
    h('h3', {}, 'Takas Teklifi'),
    h('label', {}, 'Kimle? ', h('select', { onchange: (e) => { T.to = Number(e.target.value); T.get = new Set(); T.getCards = 0; drawTrade(); } },
      others.map((p) => h('option', { value: p.id, selected: p.id === T.to }, p.name)))),
    h('div', { class: 'trade2' },
      h('div', { class: 'tside' }, h('b', {}, 'Sen verirsin'), list(me, T.give),
        h('label', { class: 'small' }, 'Nakit ', h('input', { class: 'num', placeholder: 'ör. 2,5 Mn', value: T.giveCash, oninput: (e) => { T.giveCash = e.target.value; } })), cardSel(myCards, 'giveCards')),
      h('div', { class: 'tside' }, h('b', {}, 'Sen alırsın'), list(T.to, T.get),
        h('label', { class: 'small' }, 'Nakit ', h('input', { class: 'num', placeholder: 'ör. 500 Bin', value: T.getCash, oninput: (e) => { T.getCash = e.target.value; } })), cardSel(theirCards, 'getCards'))),
    h('p', { class: 'small' }, 'Karşı taraf 15 saniye içinde yanıtlamazsa teklif reddedilmiş sayılır. İpotekli mülk alan %10 işlem bedeli öder.'),
    h('div', { class: 'btns' },
      btn('Teklifi Gönder', () => {
        const gc = T.giveCash.trim() ? parseMoney(T.giveCash) : 0;
        const tc = T.getCash.trim() ? parseMoney(T.getCash) : 0;
        if (Number.isNaN(gc) || Number.isNaN(tc) || gc < 0 || tc < 0) { toast('Nakit tutarı anlaşılamadı. Örnek: 2,5 Mn', 'err'); return; }
        const give = { cash: gc, props: [...T.give], jailCards: T.giveCards };
        const get = { cash: tc, props: [...T.get], jailCards: T.getCards };
        if (!give.cash && !give.props.length && !give.jailCards && !get.cash && !get.props.length && !get.jailCards) { toast('Teklif boş.', 'err'); return; }
        act({ type: 'TRADE_PROPOSE', to: T.to, give, get });
      }),
      btn('Vazgeç', closeModal, '')));
  const tr = A.ui.trade;
  openModal(content);
  A.ui.trade = tr;
}

// ---------------------------------------------------------------- baslangic
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$modal.hidden) closeModal(); });
(function boot() {
  A.token = store.get('token');
  A.name = store.get('nick') || '';
  const saved = store.get('room');
  const urlRoom = new URLSearchParams(location.search).get('oda');
  if (A.token && A.name && saved && (!urlRoom || urlRoom.toUpperCase() === saved)) {
    A.room = saved; // yeniden baglan
    connect({ type: 'join', room: saved, name: A.name, token: A.token });
  }
  render();
})();
