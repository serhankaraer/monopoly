// SVG 11x11 karton tahta
import { SQUARES, GROUP_COLORS } from '/shared/data.js';
import { fmt, PLAYER_COLORS } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const C = 110;
const W = (1000 - 2 * C) / 9;
const BAND = 24;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

export function geom(i) {
  if (i === 0) return { x: 1000 - C, y: 1000 - C, w: C, h: C, side: 'corner' };
  if (i < 10) return { x: 1000 - C - i * W, y: 1000 - C, w: W, h: C, side: 'bottom' };
  if (i === 10) return { x: 0, y: 1000 - C, w: C, h: C, side: 'corner' };
  if (i < 20) return { x: 0, y: 1000 - C - (i - 10) * W, w: C, h: W, side: 'left' };
  if (i === 20) return { x: 0, y: 0, w: C, h: C, side: 'corner' };
  if (i < 30) return { x: C + (i - 21) * W, y: 0, w: W, h: C, side: 'top' };
  if (i === 30) return { x: 1000 - C, y: 0, w: C, h: C, side: 'corner' };
  return { x: 1000 - C, y: C + (i - 31) * W, w: C, h: W, side: 'right' };
}

function inner(g) {
  switch (g.side) {
    case 'bottom': return { x: g.x, y: g.y + BAND, w: g.w, h: g.h - BAND };
    case 'top': return { x: g.x, y: g.y, w: g.w, h: g.h - BAND };
    case 'left': return { x: g.x, y: g.y, w: g.w - BAND, h: g.h };
    case 'right': return { x: g.x + BAND, y: g.y, w: g.w - BAND, h: g.h };
    default: return { x: g.x, y: g.y, w: g.w, h: g.h };
  }
}
function band(g) {
  switch (g.side) {
    case 'bottom': return { x: g.x, y: g.y, w: g.w, h: BAND };
    case 'top': return { x: g.x, y: g.y + g.h - BAND, w: g.w, h: BAND };
    case 'left': return { x: g.x + g.w - BAND, y: g.y, w: BAND, h: g.h };
    case 'right': return { x: g.x, y: g.y, w: BAND, h: g.h };
    default: return null;
  }
}
function ownerBar(g) {
  const t = 7;
  switch (g.side) {
    case 'bottom': return { x: g.x, y: g.y + g.h - t, w: g.w, h: t };
    case 'top': return { x: g.x, y: g.y, w: g.w, h: t };
    case 'left': return { x: g.x, y: g.y, w: t, h: g.h };
    case 'right': return { x: g.x + g.w - t, y: g.y, w: t, h: g.h };
    default: return null;
  }
}
function wrap(text, max) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}
function textLines(parent, lines, cx, y0, size, attrs = {}) {
  lines.forEach((ln, k) => parent.append(el('text', { x: cx, y: y0 + k * (size + 2), 'text-anchor': 'middle', 'font-size': size, ...attrs }, ln)));
}
const ICON = { 5: '🚆', 35: '🚆', 15: '⛴️', 25: '⛴️', 12: '💡', 28: '💧' };

function drawSquare(layer, q, st, onSquare) {
  const g = geom(q.i);
  const mult = st.settings.mult;
  const pr = st.props[q.i];
  const grp = el('g', { class: 'sq', 'data-sq': q.i });
  grp.append(el('rect', { x: g.x, y: g.y, width: g.w, height: g.h, class: 'cell' }));
  const inn = inner(g);
  const cx = inn.x + inn.w / 2;

  if (q.type === 'street') {
    const b = band(g);
    grp.append(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: GROUP_COLORS[q.group], class: 'band' }));
    if (pr.houses > 0) {
      const horiz = g.side === 'bottom' || g.side === 'top';
      if (pr.houses === 5) {
        const bw = horiz ? 30 : 16, bh = horiz ? 16 : 30;
        grp.append(el('rect', { x: b.x + b.w / 2 - bw / 2, y: b.y + b.h / 2 - bh / 2, width: bw, height: bh, rx: 3, class: 'hotel' }));
      } else {
        for (let k = 0; k < pr.houses; k++) {
          const s = 13, gap = 4, total = pr.houses * s + (pr.houses - 1) * gap;
          const ox = horiz ? b.x + b.w / 2 - total / 2 + k * (s + gap) : b.x + b.w / 2 - s / 2;
          const oy = horiz ? b.y + b.h / 2 - s / 2 : b.y + b.h / 2 - total / 2 + k * (s + gap);
          grp.append(el('rect', { x: ox, y: oy, width: s, height: s, rx: 2, class: 'house' }));
        }
      }
    }
    textLines(grp, wrap(q.name, 11), cx, inn.y + 22, 12.5, { class: 'qname' });
    grp.append(el('text', { x: cx, y: inn.y + inn.h - 12, 'text-anchor': 'middle', 'font-size': 12, class: 'qprice' }, fmt(q.price * mult)));
  } else if (q.type === 'station' || q.type === 'utility') {
    grp.append(el('text', { x: cx, y: inn.y + inn.h - 28, 'text-anchor': 'middle', 'font-size': 26 }, ICON[q.i]));
    textLines(grp, wrap(q.short, 11), cx, inn.y + 16, 12.5, { class: 'qname' });
    grp.append(el('text', { x: cx, y: inn.y + inn.h - 12, 'text-anchor': 'middle', 'font-size': 12, class: 'qprice' }, fmt(q.price * mult)));
  } else if (q.type === 'chance' || q.type === 'chest') {
    grp.append(el('text', { x: cx, y: inn.y + inn.h / 2 + 14, 'text-anchor': 'middle', 'font-size': 46, class: q.type === 'chance' ? 'chance' : 'chest' }, q.type === 'chance' ? '?' : '✦'));
    textLines(grp, [q.name], cx, inn.y + 20, 13, { class: 'qname' });
  } else if (q.type === 'tax') {
    grp.append(el('text', { x: cx, y: inn.y + inn.h - 28, 'text-anchor': 'middle', 'font-size': 26 }, '💸'));
    textLines(grp, wrap(q.name, 11), cx, inn.y + 16, 12.5, { class: 'qname' });
    grp.append(el('text', { x: cx, y: inn.y + inn.h - 12, 'text-anchor': 'middle', 'font-size': 12, class: 'qprice' }, fmt(q.amount * mult)));
  } else if (q.type === 'go') {
    grp.append(el('text', { x: g.x + C / 2, y: g.y + 20, 'text-anchor': 'middle', 'font-size': 15, class: 'corner-t' }, 'BAŞLANGIÇ'));
    grp.append(el('text', { x: g.x + C / 2, y: g.y + 36, 'text-anchor': 'middle', 'font-size': 10.5 }, `Maaş ${fmt(200 * mult)}`));
    grp.append(el('text', { x: g.x + C / 2, y: g.y + 66, 'text-anchor': 'middle', 'font-size': 28, fill: '#c0392b' }, '⬅'));
  } else if (q.type === 'jail') {
    grp.append(el('rect', { x: g.x + 8, y: g.y + 8, width: 62, height: 62, class: 'jailbox' }));
    grp.append(el('text', { x: g.x + 39, y: g.y + 44, 'text-anchor': 'middle', 'font-size': 12, class: 'corner-t' }, 'KODES'));
    grp.append(el('text', { x: g.x + 82, y: g.y + 76, 'text-anchor': 'middle', 'font-size': 10 }, 'Ziyaretçi'));
  } else if (q.type === 'parking') {
    grp.append(el('text', { x: g.x + C / 2, y: g.y + 19, 'text-anchor': 'middle', 'font-size': 13, class: 'corner-t' }, 'ÜCRETSİZ'));
    grp.append(el('text', { x: g.x + C / 2, y: g.y + 34, 'text-anchor': 'middle', 'font-size': 13, class: 'corner-t' }, 'OTOPARK'));
    grp.append(el('text', { x: g.x + C / 2, y: g.y + 62, 'text-anchor': 'middle', 'font-size': 26 }, '🅿️'));
    if (st.settings.houseRules.freeParkingJackpot && st.pool) grp.append(el('text', { x: g.x + C / 2, y: g.y + 107, 'text-anchor': 'middle', 'font-size': 11, class: 'qprice' }, fmt(st.pool)));
  } else if (q.type === 'gotojail') {
    grp.append(el('text', { x: g.x + C / 2, y: g.y + 19, 'text-anchor': 'middle', 'font-size': 13, class: 'corner-t' }, "KODES'E"));
    grp.append(el('text', { x: g.x + C / 2, y: g.y + 34, 'text-anchor': 'middle', 'font-size': 13, class: 'corner-t' }, 'GİR'));
    grp.append(el('text', { x: g.x + C / 2, y: g.y + 62, 'text-anchor': 'middle', 'font-size': 26 }, '👮'));
  }

  if (pr && pr.owner != null) {
    const o = ownerBar(g);
    grp.append(el('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: PLAYER_COLORS[pr.owner], class: 'owner' }));
    if (pr.mortgaged) {
      grp.append(el('rect', { x: g.x, y: g.y, width: g.w, height: g.h, class: 'mortgage' }));
      grp.append(el('text', { x: g.x + g.w / 2, y: g.y + g.h / 2 + 5, 'text-anchor': 'middle', 'font-size': 13, class: 'mtext', transform: `rotate(-18 ${g.x + g.w / 2} ${g.y + g.h / 2})` }, 'İPOTEKLİ'));
    }
  }
  grp.addEventListener('click', () => onSquare?.(q.i));
  layer.append(grp);
}

export class Board {
  constructor(container, onSquare) {
    this.onSquare = onSquare;
    this.svg = el('svg', { viewBox: '0 0 1000 1000', class: 'board', role: 'img', 'aria-label': 'Oyun tahtası' });
    this.squares = el('g');
    this.center = el('g');
    this.tokens = el('g', { class: 'tokens' });
    this.svg.append(el('rect', { x: 0, y: 0, width: 1000, height: 1000, class: 'frame' }), this.squares, this.center, this.tokens);
    container.append(this.svg);
    this.tokenEls = new Map();
    this.dicePrev = null;
  }

  // Kareleri ve ortayi cizer
  render(st) {
    this.squares.replaceChildren();
    for (const q of SQUARES) drawSquare(this.squares, q, st, this.onSquare);
    this.renderCenter(st);
  }

  renderCenter(st) {
    this.center.replaceChildren();
    const g = this.center;
    g.append(el('rect', { x: C, y: C, width: 1000 - 2 * C, height: 1000 - 2 * C, class: 'felt' }));
    g.append(el('text', { x: 500, y: 330, 'text-anchor': 'middle', class: 'title', 'font-size': 52 }, 'EMLAK TİCARETİ'));
    g.append(el('text', { x: 500, y: 385, 'text-anchor': 'middle', class: 'subtitle', 'font-size': 34 }, 'İSTANBUL'));
    const bw = 60;
    if (st.dice) {
      const shake = this.dicePrev !== JSON.stringify([st.seq, st.dice]) && st.diceFresh;
      const dg = el('g', { class: shake ? 'dice shake' : 'dice' });
      drawDie(dg, 500 - bw - 14, 470, bw, st.dice[0]);
      drawDie(dg, 500 + 14, 470, bw, st.dice[1]);
      g.append(dg);
    }
    const cur = st.players[st.current];
    if (cur && st.phase !== 'GAME_OVER') {
      g.append(el('text', { x: 500, y: 620, 'text-anchor': 'middle', 'font-size': 24, fill: PLAYER_COLORS[st.current], class: 'turnname' }, `Sıra: ${cur.name}`));
    }
    g.append(el('text', { x: 500, y: 690, 'text-anchor': 'middle', 'font-size': 16, class: 'supply' }, `Ev: ${st.housesLeft}   Otel: ${st.hotelsLeft}`));
  }

  tokenPos(i, pid, inJail) {
    const g = geom(i);
    if (i === 10) {
      if (inJail) return { x: g.x + 20 + (pid % 3) * 20, y: g.y + 24 + Math.floor(pid / 3) * 22 };
      return { x: g.x + 46 + (pid % 3) * 22, y: g.y + 90 + Math.floor(pid / 3) * 15 };
    }
    if (g.side === 'corner') return { x: g.x + C / 2 + ((pid % 3) - 1) * 24, y: g.y + 80 + Math.floor(pid / 3) * 22 };
    const n = inner(g);
    return { x: n.x + n.w / 2 + ((pid % 3) - 1) * 21, y: n.y + n.h / 2 + 8 + (Math.floor(pid / 3) - 0.5) * 22 };
  }

  // positions: pid -> kare (animasyonlu gosterim konumu)
  renderTokens(st, positions, current) {
    st.players.forEach((p) => {
      let t = this.tokenEls.get(p.id);
      if (!t) {
        t = el('g', { class: 'token' });
        t.append(el('circle', { r: 11, fill: PLAYER_COLORS[p.id], class: 'tok' }), el('text', { y: 4, 'text-anchor': 'middle', 'font-size': 12, class: 'tokt' }, p.name.slice(0, 1).toLocaleUpperCase('tr')));
        this.tokens.append(t);
        this.tokenEls.set(p.id, t);
      }
      const pos = this.tokenPos(positions[p.id] ?? p.pos, p.id, p.inJail && (positions[p.id] ?? p.pos) === 10);
      t.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      t.classList.toggle('bankrupt', p.bankrupt);
      t.classList.toggle('current', p.id === current && st.phase !== 'GAME_OVER');
    });
  }
}

const PIPS = {
  1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};
function drawDie(parent, x, y, s, v) {
  parent.append(el('rect', { x, y, width: s, height: s, rx: 10, class: 'die' }));
  for (const [i, j] of PIPS[v] || []) parent.append(el('circle', { cx: x + s * (0.22 + 0.28 * i), cy: y + s * (0.22 + 0.28 * j), r: 5.5, class: 'pip' }));
}
