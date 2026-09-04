# FarmBot — Claude için yol haritası

Bu dosya arama süresini kısaltmak için var. Bir şeyi nerede bulacağını
buradan oku, dosyaları taramadan önce.

## Ne olduğu

Raspberry Pi 5 üstünde çalışan bir tarım robotu. Pi, PLC ile **Modbus
TCP** üzerinden konuşuyor (192.168.1.88:502); Arduino sensörleri, Hailo
AI HAT'i ve iki kamerası var. Panel `http://<pi>:8000` adresinde.

Üç parça:

- `ajan/` — donanımla konuşan süreç. PLC, Arduino, kameralar, Hailo.
- `sunucu/` — FastAPI panel sunucusu. Ajanla WebSocket üzerinden konuşuyor.
- `sunucu/static/` — panelin kendisi (tarayıcı tarafı, çerçeve yok, düz JS).

## Nerede ne var

| Soru | Dosya |
|---|---|
| Eksen hareketi, home, bölge denetimi, T ekseni | `ajan/plc.py` |
| Kamera açma, çözünürlük, canlı akış, denetimler | `ajan/kamera.py` |
| Uç kaymaları, tohum hazneleri | `ajan/uclar.py` |
| Komut yönlendirme, durum paketi | `ajan/ajan.py` |
| HTTP uçları, ajanla köprü | `sunucu/main.py` |
| Piksel → milimetre, leke → yatak koordinatı | `sunucu/tespit.py` |
| Yeşil ayıklama (ExG, eşik, morfoloji, bileşen) | `sunucu/goruntu.py` |
| Kamera kalibrasyonu ve harita (homografi) | `sunucu/kalibrasyon.py` |
| AprilTag ile kalibrasyon | `sunucu/etiket.py` |
| Filizlerin yatak koordinatı | `sunucu/filiz.py` |
| Sulama, ekim, dikim alanları | `sunucu/sulama.py`, `ekim.py`, `dikim.py` |
| Panel kabuğu, kameralar, ayar kartları | `sunucu/static/app.js` |
| 3B/2B sahne çekirdeği, katman sistemi | `sunucu/static/tarla.js` |
| Makinenin geometrisi (portal, kızak, başlar) | `sunucu/static/makine.js` |
| Sahnedeki her görsel katman | `sunucu/static/katmanlar/*.js` |

`app.js` 5800, `main.py` 4000, `tarla.js` 2600 satır. **Baştan sona
okuma** — `grep` ile yerini bul, sonra o aralığı oku.

## Dokunulmayacaklar

**Makineye ait ayar dosyaları.** `guncelle.sh` bunları koruyor, yani
depoda değiştirmek Pi'ye hiç ulaşmıyor; değeri panelden ya da Pi'de
girmek gerekiyor.

    ajan/gantry_calib.json    ajan/uclar.json
    ajan/ayarlar.json         ajan/kameralar.json

**Sırlar.** `sunucu/ortam` panel parolasını tutuyor; okuma, yazma, log'a
düşürme.

## İki oturum aynı depoda çalışıyor

Çakışmayı önlemek için bazı dosyalar bölünmüş durumda. Bir görev sana
"şu dosyalara dokunma" diyorsa gerekçesi bu; listeyi görev metni
veriyor. Yeni bir bölüm eklerken aynı yolu izle: kendi modülünü kur,
`main.py`'ye tek satır `include_router`, `index.html`'e tek boş `div`.

## Nasıl yazılıyor

- **Türkçe.** Değişken, işlev, yorum, günlük, arayüz metni — hepsi.
- Yorum **neden**i anlatıyor, ne yaptığını değil. Bir sayı ya da sıra
  seçildiyse hangi ölçüme dayandığı yazılıyor.
- Bir şey ölçülmediyse **uydurulmuyor**: kalibrasyon yoksa milimetre
  verilmiyor, sebebi yazılıyor. Yanlış olduğu belli olmayan sayı en kötü
  çıktı.
- Sessiz başarısızlık yok. Bir şey çizilmiyor ya da bulunmuyorsa sebebi
  panele veya günlüğe düşüyor.

## Değişiklik akışı

Windows'ta düzenlenip GitHub'a gidiyor, Pi'de `./guncelle.sh` çekiyor ve
iki servisi yeniden başlatıyor (`farmbot-sunucu`, `farmbot-ajan`).
Doğrudan Pi'ye erişim yok.

Söz dizimi denetimi ucuz, her değişiklikten sonra çalıştır:

    python -c "import ast,io; ast.parse(io.open('DOSYA',encoding='utf-8').read())"
    node --check sunucu/static/DOSYA.js
