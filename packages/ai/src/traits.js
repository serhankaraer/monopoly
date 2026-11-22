// Bot karakter ozellikleri: hepsi 1-100, normal dagilim (uclar seyrek, ortalar sik).

export const TRAIT_KEYS = [
  'appetite', 'setFocus', 'cashBuffer', 'buildDrive', 'auctionAggr',
  'tradeDrive', 'mortgageLine', 'jailStrategy', 'thinkDelay',
];

export const TRAIT_LABELS = {
  appetite: 'Satın alma iştahı',
  setFocus: 'Set odağı',
  cashBuffer: 'Nakit tamponu',
  buildDrive: 'Yapılaşma hırsı',
  auctionAggr: 'Müzayede agresifliği',
  tradeDrive: 'Takas eğilimi',
  mortgageLine: 'İpotek eşiği',
  jailStrategy: 'Hapis stratejisi',
  thinkDelay: 'Düşünme gecikmesi',
};

// Box-Muller; ortalama 50, standart sapma 18, 1-100 araligina kirpilir.
export function normalTrait(rand = Math.random, mean = 50, sd = 18) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(100, Math.max(1, Math.round(mean + sd * z)));
}

export function generateTraits(rand = Math.random) {
  const t = {};
  for (const k of TRAIT_KEYS) t[k] = normalTrait(rand);
  return t;
}

// Dusunme gecikmesi 1-3 sn: ozellik 1 -> 1000 ms, 100 -> 3000 ms.
export function thinkDelayMs(traits) {
  return Math.round(1000 + ((traits.thinkDelay - 1) / 99) * 2000);
}
