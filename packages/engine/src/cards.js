// Sans ve Kamu Fonu kartlari. Etkiler standart Hasbro setinden uyarlanmistir, metinler ozgundur.
// {a}: para tutari, {h}: ev basina tutar, {o}: otel basina tutar (carpanla olceklenip bicimlenir).
// Efekt turleri: go, to(sq), nearest(what), back(n), gain(amt), pay(amt), payEach(amt), collectEach(amt),
// jail, jailCard, repairs(house, hotel)

export const CHANCE = [
  { id: 'c1', eff: { k: 'go' }, text: "Vapur tam kalkarken yetiştin! Başlangıç'a ilerle ve maaşını al." },
  { id: 'c2', eff: { k: 'to', sq: 24 }, text: "Bağdat Caddesi'nde kahve molası canın çekti. Caddebostan'a ilerle; Başlangıç'tan geçersen maaşını al." },
  { id: 'c3', eff: { k: 'to', sq: 11 }, text: "İstiklal'de simit yemeye karar verdin. Beyoğlu'na ilerle; Başlangıç'tan geçersen maaşını al." },
  { id: 'c4', eff: { k: 'nearest', what: 'utility' }, text: 'Fatura günü! En yakın kamu kuruluşuna ilerle. Sahibi varsa zar at ve zarın 10 katını öde.' },
  { id: 'c5', eff: { k: 'nearest', what: 'station' }, text: 'Metrobüste oturacak yer buldun, bugün şanslısın! En yakın istasyona ilerle. Sahibi varsa kirayı iki katı öde.' },
  { id: 'c6', eff: { k: 'nearest', what: 'station' }, text: 'Dolmuşu kaçırdın, koşarak en yakın istasyona gidiyorsun. Sahibi varsa kirayı iki katı öde.' },
  { id: 'c7', eff: { k: 'gain', amt: 50 }, text: 'Çekmecede unuttuğun eski hisse senedi birden değerlendi. Bankadan {a} al.' },
  { id: 'c8', eff: { k: 'jailCard' }, text: "\"Kodes'ten Ücretsiz Çık\" kartı. \"Ben hiçbir şey yapmadım\" demene gerek kalmadı. Sakla ya da sat." },
  { id: 'c9', eff: { k: 'back', n: 3 }, text: 'Navigasyon seni yanlış sokağa soktu. 3 kare geri git.' },
  { id: 'c10', eff: { k: 'jail' }, text: "Trafikte makas atarken yakalandın. Doğruca Kodes'e git; Başlangıç'tan geçsen de maaş yok." },
  { id: 'c11', eff: { k: 'repairs', house: 25, hotel: 100 }, text: 'Apartman yönetimi çatı tamiri kararı aldı. Her evin için {h}, her otelin için {o} öde.' },
  { id: 'c12', eff: { k: 'pay', amt: 15 }, text: "Köprüden HGS'siz geçtin, ceza geldi. {a} öde." },
  { id: 'c13', eff: { k: 'to', sq: 5 }, text: "Haydarpaşa'da nostaljik tren turu! Haydarpaşa'ya ilerle; Başlangıç'tan geçersen maaşını al." },
  { id: 'c14', eff: { k: 'to', sq: 39 }, text: "Boğaz'da yalı bakmaya çıktın. Yeniköy'e ilerle; Başlangıç'tan geçersen maaşını al." },
  { id: 'c15', eff: { k: 'payEach', amt: 50 }, text: 'Site yöneticisi seçildin, çaylar senden. Her oyuncuya {a} öde.' },
  { id: 'c16', eff: { k: 'gain', amt: 150 }, text: 'Birikim hesabının vadesi doldu! Bankadan {a} al.' },
];

export const CHEST = [
  { id: 'h1', eff: { k: 'go' }, text: "Mahalle bakkalı veresiye defterini sildi, havalardasın! Başlangıç'a ilerle ve maaşını al." },
  { id: 'h2', eff: { k: 'gain', amt: 200 }, text: 'Banka hatası senin lehine çıktı. {a} al. (Teşekkür etmek zorunda değilsin.)' },
  { id: 'h3', eff: { k: 'pay', amt: 50 }, text: "Diş hekimi \"küçük bir dolgu\" demişti. Fatura {a}." },
  { id: 'h4', eff: { k: 'gain', amt: 50 }, text: 'Eski hisselerin satıldı. {a} al.' },
  { id: 'h5', eff: { k: 'jailCard' }, text: "\"Kodes'ten Ücretsiz Çık\" kartı. Her zaman işe yarar. Sakla ya da sat." },
  { id: 'h6', eff: { k: 'jail' }, text: "Dolmabahçe'de izinsiz piknik yaptın. Doğruca Kodes'e git; Başlangıç'tan geçsen de maaş yok." },
  { id: 'h7', eff: { k: 'gain', amt: 100 }, text: 'Tatil fonun vadesi doldu. {a} al ve bavulu hazırla.' },
  { id: 'h8', eff: { k: 'gain', amt: 20 }, text: 'Vergi iadesi sonunda yattı. {a} al.' },
  { id: 'h9', eff: { k: 'collectEach', amt: 10 }, text: 'Doğum günün! Her oyuncudan {a} al. Pasta yoksa hediye de yok.' },
  { id: 'h10', eff: { k: 'gain', amt: 100 }, text: 'Hayat sigortanın vadesi doldu. {a} al.' },
  { id: 'h11', eff: { k: 'pay', amt: 100 }, text: 'Hastane masrafları. {a} öde, geçmiş olsun.' },
  { id: 'h12', eff: { k: 'pay', amt: 50 }, text: 'Okul harcı dönemi geldi. {a} öde.' },
  { id: 'h13', eff: { k: 'gain', amt: 25 }, text: 'Danışmanlık ücretin yattı: {a} al. (Kimse tam olarak ne yaptığını bilmiyor.)' },
  { id: 'h14', eff: { k: 'repairs', house: 40, hotel: 115 }, text: 'Belediye yolu söküp yeniden yaptı. Her ev için {h}, her otel için {o} öde.' },
  { id: 'h15', eff: { k: 'gain', amt: 10 }, text: 'Güzellik yarışmasında ikinci oldun. {a} al.' },
  { id: 'h16', eff: { k: 'gain', amt: 100 }, text: 'Uzak bir akrabadan miras kaldı. {a} al ve yas tut (ya da tutma).' },
];

export const DECKS = { chance: CHANCE, chest: CHEST };
export const CARD_BY_ID = Object.fromEntries([...CHANCE, ...CHEST].map((c) => [c.id, c]));
