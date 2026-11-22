import { fmt } from '/shared/util.js';
export { fmt };

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// "2,5 Mn", "500 bin", "1.500.000" -> tam sayi TL
export function parseMoney(str) {
  let s = String(str ?? '').toLowerCase().replace(/₺|tl/g, '').trim();
  if (!s) return NaN;
  let f = 1;
  if (/milyon|mn/.test(s)) { f = 1e6; s = s.replace(/milyon|mn/, ''); }
  else if (/bin|k/.test(s)) { f = 1e3; s = s.replace(/bin|k/, ''); }
  s = s.trim();
  if (f > 1) return Math.round(parseFloat(s.replace(',', '.')) * f);
  return Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.')));
}

export const PLAYER_COLORS = ['#e63946', '#1d6fe0', '#2a9d4f', '#f4a300', '#8e44ad', '#12a8a8'];
