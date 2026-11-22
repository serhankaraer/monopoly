// Tahta verisi: Hasbro Turkiye baskisi (Istanbul semtleri), klasik Monopoly degerleri.
// Tum tutarlar "baz" birimdir; oyunda ayarlardaki carpanla (varsayilan 50.000) olceklenir.

const street = (i, name, group, price, house, rent) => ({ i, type: 'street', name, group, price, house, rent });
const station = (i, name, short) => ({ i, type: 'station', name, short, price: 200 });
const utility = (i, name, short) => ({ i, type: 'utility', name, short, price: 150 });

export const SQUARES = [
  { i: 0, type: 'go', name: 'Başlangıç' },
  street(1, 'Kasımpaşa', 'brown', 60, 50, [2, 10, 30, 90, 160, 250]),
  { i: 2, type: 'chest', name: 'Kamu Fonu' },
  street(3, 'Dolapdere', 'brown', 60, 50, [4, 20, 60, 180, 320, 450]),
  { i: 4, type: 'tax', name: 'Gelir Vergisi', amount: 200 },
  station(5, 'Haydarpaşa Tren İstasyonu', 'Haydarpaşa'),
  street(6, 'Sultanahmet', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  { i: 7, type: 'chance', name: 'Şans' },
  street(8, 'Karaköy', 'lightblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  street(9, 'Sirkeci', 'lightblue', 120, 50, [8, 40, 100, 300, 450, 600]),
  { i: 10, type: 'jail', name: 'Kodes / Ziyaretçi' },
  street(11, 'Beyoğlu', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  utility(12, 'Elektrik İdaresi', 'Elektrik'),
  street(13, 'Beşiktaş', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  street(14, 'Taksim', 'pink', 160, 100, [12, 60, 180, 500, 700, 900]),
  station(15, 'Kadıköy Vapur İskelesi', 'Kadıköy Vapur'),
  street(16, 'Harbiye', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  { i: 17, type: 'chest', name: 'Kamu Fonu' },
  street(18, 'Şişli', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  street(19, 'Mecidiyeköy', 'orange', 200, 100, [16, 80, 220, 600, 800, 1000]),
  { i: 20, type: 'parking', name: 'Ücretsiz Otopark' },
  street(21, 'Bostancı', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  { i: 22, type: 'chance', name: 'Şans' },
  street(23, 'Erenköy', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  street(24, 'Caddebostan', 'red', 240, 150, [20, 100, 300, 750, 925, 1100]),
  station(25, 'Kabataş Vapur İskelesi', 'Kabataş Vapur'),
  street(26, 'Nişantaşı', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  street(27, 'Teşvikiye', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  utility(28, 'Sular İdaresi', 'Sular'),
  street(29, 'Maçka', 'yellow', 280, 150, [24, 120, 360, 850, 1025, 1200]),
  { i: 30, type: 'gotojail', name: "Kodes'e Gir" },
  street(31, 'Levent', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  street(32, 'Etiler', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  { i: 33, type: 'chest', name: 'Kamu Fonu' },
  street(34, 'Bebek', 'green', 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  station(35, 'Sirkeci Tren İstasyonu', 'Sirkeci Tren'),
  { i: 36, type: 'chance', name: 'Şans' },
  street(37, 'Tarabya', 'darkblue', 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  { i: 38, type: 'tax', name: 'Lüks Vergisi', amount: 100 },
  street(39, 'Yeniköy', 'darkblue', 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];

export const PROP_SQUARES = SQUARES.filter((q) => ['street', 'station', 'utility'].includes(q.type)).map((q) => q.i);
export const STATIONS = [5, 15, 25, 35];
export const UTILITIES = [12, 28];

export const GROUPS = {};
for (const q of SQUARES) {
  if (q.type === 'street') (GROUPS[q.group] ||= []).push(q.i);
}

export const GROUP_COLORS = {
  brown: '#955436',
  lightblue: '#aae0fa',
  pink: '#d93a96',
  orange: '#f7941d',
  red: '#ed1b24',
  yellow: '#fef200',
  green: '#1fb25a',
  darkblue: '#0072bb',
};

export const BASE = {
  salary: 200,
  jailFee: 50,
  startCash: 1500,
  auctionMin: 10,
  auctionInc: 10,
  houses: 32,
  hotels: 12,
  jailMaxTries: 3,
};

export const START_CASH_OPTIONS = [1000, 1500, 2000, 2500];

// Sure siniri secenekleri: 10 + (oyuncu - 1) * 5 dk ile baslar, 5'er dk artar, en fazla 120 dk.
export function timeLimitOptions(playerCount) {
  const out = [];
  for (let m = 10 + (playerCount - 1) * 5; m <= 120; m += 5) out.push(m);
  return out;
}
