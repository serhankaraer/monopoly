// Yardimcilar: tohumlu rastgelelik, para bicimleme.

// mulberry32; durum state.rng icinde tutulur (uint32).
export function rnd(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffle(arr, state) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(state) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const trim = (x) => x.replace(/\.?0+$/, '').replace('.', ',');

// 75000000 -> "75 Mn ₺", 7500000 -> "7,5 Mn ₺", 100000 -> "100 Bin ₺", 500 -> "500 ₺"
export function fmt(n) {
  n = Math.round(n);
  if (n >= 1e6) return `${trim((n / 1e6).toFixed(2))} Mn ₺`;
  if (n >= 1e3) return `${trim((n / 1e3).toFixed(1))} Bin ₺`;
  return `${n} ₺`;
}
