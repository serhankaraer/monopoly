// 100 bot ismi (50 kadin, 50 erkek), lakapsiz.
export const NAMES = [
  'Ayşe', 'Fatma', 'Emine', 'Hatice', 'Zeynep', 'Elif', 'Merve', 'Büşra', 'Esra', 'Seda',
  'Derya', 'Gül', 'Selin', 'Burcu', 'Ebru', 'Pınar', 'Özlem', 'Sevgi', 'Nur', 'Melek',
  'Yasemin', 'İpek', 'Deniz', 'Ceren', 'Gamze', 'Dilara', 'Tuğba', 'Sibel', 'Aslı', 'Hande',
  'Kübra', 'Sena', 'Naz', 'Defne', 'Ece', 'Irmak', 'Duygu', 'Cansu', 'Beren', 'Nehir',
  'Aylin', 'Berna', 'Filiz', 'Gizem', 'Hülya', 'Jale', 'Kader', 'Leyla', 'Müge', 'Neslihan',
  'Mehmet', 'Mustafa', 'Ahmet', 'Ali', 'Hüseyin', 'Hasan', 'İbrahim', 'Yusuf', 'Emre', 'Burak',
  'Can', 'Cem', 'Kerem', 'Barış', 'Onur', 'Serkan', 'Murat', 'Volkan', 'Tolga', 'Uğur',
  'Oğuz', 'Koray', 'Selim', 'Kaan', 'Arda', 'Efe', 'Berk', 'Mert', 'Eren', 'Okan',
  'Orhan', 'Taner', 'Umut', 'Yiğit', 'Alper', 'Bora', 'Cihan', 'Doruk', 'Erkan', 'Furkan',
  'Gökhan', 'Harun', 'İlker', 'Kemal', 'Metin', 'Necati', 'Rıza', 'Sinan', 'Tayfun', 'Zafer',
];

export function pickNames(count, rand = Math.random, exclude = []) {
  const pool = NAMES.filter((n) => !exclude.includes(n));
  const out = [];
  while (out.length < count && pool.length) {
    const i = Math.floor(rand() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
