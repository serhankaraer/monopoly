# Emlak Ticareti: İstanbul

İstanbul semtlerinden oluşan, tarayıcıda çok oyunculu oynanan Monopoly tarzı masa oyunu.
Bağımlılık yok: yalnızca Node.js 22+ gerekir (WebSocket sunucusu yerleşik yazıldı).

## Çalıştırma

    npm start            # http://localhost:3000   (PORT=8080 npm start ile port değişir)
    npm test             # motor, bot ve sunucu testleri

Oda kur, kodu/bağlantıyı arkadaşlarına gönder. Boş koltuklara oyun başlarken karakterli botlar oturur.
Aynı ağdan oynamak için sunucu makinenin IP'sini kullan (örn. http://192.168.1.20:3000).

## Yapı

    packages/engine   Saf oyun motoru (sunucu otoriteli). applyAction(state, oyuncu, eylem) -> yeni durum + olaylar
    packages/ai       Bot karakterleri (9 özellik, 1-100 normal dağılım), karar mantığı, 100 isim
    packages/server   HTTP + yerleşik WebSocket, oda/lobi, 30 sn süre sınırı, bot sürücüsü, yeniden bağlanma
    packages/client   Vanilla JS + SVG tahta (build gerekmez)

## Ayarlar (lobide)

Oyuncu sayısı 2-6 · başlangıç parası · para çarpanı (varsayılan ×50.000) · oyun süresi
(süresiz ya da 10 + (oyuncu-1)×5 dakikadan 120'ye, 5'er dk) · 6 ev kuralı.

## Sunucu ortam değişkenleri

PORT (3000), BOT_DELAY_SCALE (bot düşünme süresi çarpanı, test için), TIME_SCALE (oyun süresi çarpanı, test için)
