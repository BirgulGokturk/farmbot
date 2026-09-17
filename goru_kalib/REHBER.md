# Tepe Kamerası Kalibrasyonu — Adım Adım Rehber

Zincir: **ham piksel → (K, distCoeffs) → düzeltilmiş piksel → (16 noktalı homografi) → makine X,Y mm**

| Dosya | Ne yapar | Ne zaman |
|---|---|---|
| `test_sentetik.py` | Kamerasız kurulum testi | Kurulumdan hemen sonra, bir kez |
| `1_tahta_olustur.py` | Yazdırılacak ChArUco tahtası | Bir kez |
| `2_foto_cek.py` | Kalibrasyon fotoğrafları + kapsama raporu | Lens/odak/çözünürlük değişince |
| `3_ic_kalibrasyon.py` | `cameraMatrix` + `distCoeffs` | 2'den sonra |
| `etiketler.json` | Etiketlerin probla ölçülen koordinatları | Etiket yeri değişince |
| `4_etiket_kalibrasyon.py` | Undistort → 16 köşe → homografi + rapor | Kamera kıpırdayınca, etiket değişince |
| `donusum.py` | Çalışma zamanı kütüphanesi | Filiz kodunuz bunu içe aktarır |
| `filiz_koordinat.py` | Tespitleri mm'ye çevirir, daire çizer, ekimle kıyaslar | Her tespitte |

Tüm çıktılar `kalib_veri/` klasörüne gider.

---

## 0. Kurulum (bilgisayar başında, bir kez)

```bash
# dizüstünden Pi'ye kopyala (Tailscale)
scp -r goru_kalib batupi@100.122.207.116:/home/batupi/farmbot/

# Pi'de
cd /home/batupi/farmbot/goru_kalib
python3 -m venv --system-site-packages .venv      # picamera2 sistemden görünür kalsın
source .venv/bin/activate
pip install -r requirements.txt
python3 test_sentetik.py
```

Test sonunda `SONUÇ: GEÇTİ` görmelisiniz. Test, distorsiyonlu ve ~39° eğik sanal bir kamerayla bütün zinciri çalıştırır; bu makinede ölçülen değerler:

| Ölçüm | Sonuç |
|---|---|
| İç kalibrasyon RMS | 0,19 px |
| 16 nokta homografi artığı | RMS 0,30 mm, en büyük 0,57 mm |
| Kontrol etiketi (homografiye katılmadı) | 0,04 mm |
| 24 filiz, yeni zincir | ortalama 0,76 mm, en büyük 1,05 mm |
| Aynı 24 filiz, **eski yöntem** (undistort yok, 4 merkez) | ortalama 3,21 mm, en büyük 4,99 mm |
| Topraktan 25 mm yukarıdaki nokta, yükseklik düzeltmesi olmadan | ortalama 21,1 mm kayma |
| Aynı nokta, `yukseklik_mm=25` ile | ortalama 0,31 mm |

Son iki satır önemli: eğik kamerada **yükseklik**, distorsiyondan daha büyük hata üretebilir (bkz. Adım 7).

> OpenCV'yi apt ile kurmak isterseniz: `sudo apt install python3-opencv` (Trixie'de 4.10, yeterli).

---

## 1. Değişmezler — kalibrasyondan önce sabitleyin

Kalibrasyon yalnız **bu üçü sabit kaldıkça** geçerlidir:

1. **Odak / zoom:** Lensin odak halkasını ayarlayıp kilitleyin (HQ kamerada vidayı sıkın, üstüne bant). Otomatik odaklı kamerada `--lens-konumu` ile sabitleyin ve çalışma zamanında aynı değeri kullanın.
2. **Çözünürlük ve sensör modu:** Kalibrasyonu en yüksek çözünürlükte (ör. 3840×2880) yapın. Çalışma zamanında aynı en-boy oranındaki küçük çözünürlük (1920×1440, 640×480) otomatik ölçeklenir. Farklı oran (ör. 1920×1080) kırpılmış bir moddur, ayrı kalibrasyon ister; kod bu durumda hata verir.
3. **Kameranın yeri:** Kamera kıpırdarsa yalnız Adım 6 tekrarlanır (iç kalibrasyon bozulmaz).

Kamera tek süreçte açılabilir. Farmbot ajanı kamerayı tutuyorsa `2_foto_cek.py` açamaz; kalibrasyon süresince ajanın kamerasını devre dışı bırakın ya da fotoğrafları aynı kamera ve aynı çözünürlükle başka yolla çekip `--kaynak klasor` ile analiz ettirin.

---

## 2. Kalibrasyon tahtasını hazırlayın

**Neden satranç tahtası değil de ChArUco?** Satranç tahtası tümüyle görünmek zorunda, bu yüzden kadrajın köşelerine götürülemez; distorsiyon en çok köşelerdedir. ChArUco yarısı kadraj dışındayken bile köşe verir. (Satranç tahtası kullanmak isterseniz `kalib_veri/tahta.json` dosyasını `{"tur":"satranc","ic_kose_x":9,"ic_kose_y":6,"kare_mm":25.0}` gibi yazın.)

1. Tahtayı üretin:
   ```bash
   python3 1_tahta_olustur.py --kagit A3      # A3 yazıcı yoksa: --kagit A4
   ```
2. `kalib_veri/charuco_A3.pdf` dosyasını **mat kâğıda**, **"Gerçek boyut / %100"**, **"Sayfaya sığdır" kapalı** yazdırın.
3. Sayfanın altındaki **100 mm** çizgisini cetvelle ölçün. 99–101 mm dışındaysa yazıcı ölçekliyordur, ayarı düzeltip tekrar yazdırın.
4. Kâğıdı **düz ve rijit** bir yüzeye kabarcıksız yapıştırın: cam, dekota, alüminyum kompozit. Karton eğilir, kullanmayın. **Tahtanın düzlüğü, kalibrasyonun en önemli şartıdır.**
5. Kumpasla **10 kare boyunca** ölçün ve 10'a bölün (tek kare ölçmekten daha hassas). `kalib_veri/tahta.json` içinde `kare_mm` değerini bununla değiştirin. `isaret_mm` değerini de aynı oranda güncelleyin (`isaret_mm = kare_mm × 0,72`).

---

## 3. İç kalibrasyon fotoğraflarını çekin (sahada)

Kamera son yerinde, odağı kilitli, ışık düzgün (tahtada parlama yok) olmalı.

```bash
python3 2_foto_cek.py --kaynak picamera2 --genislik 3840 --yukseklik 2880            # Enter ile çeker
python3 2_foto_cek.py --kaynak picamera2 --genislik 3840 --yukseklik 2880 --aralik 5   # tek başınızaysanız: 5 sn'de bir
```

Her çekimden sonra kaç köşe bulunduğunu, her 5 fotoğrafta bir de kadrajın **8×6 kapsama haritasını** yazar. Bulunamayan fotoğraf `reddedilen/` klasörüne taşınır.

### Tahtayı nasıl tutacaksınız — 30 fotoğraflık reçete

Tahtayı **kenarından** tutun, parmaklarınız karelerin üstüne gelmesin. Deklanşörde **tamamen hareketsiz** durun. En kolayı, tahtayı bir kutuya ya da tuğlaya yaslayıp elinizi çekmek.

| # | Konum | Tutuş | Adet |
|---|---|---|---|
| 1 | Yatağın ortası | Toprağa düz yatırılmış | 1 |
| 2 | Yatağın 4 köşesi | Düz | 4 |
| 3 | **Kadrajın** 4 köşesi (yatağın değil!) | Tahta yarı kadraj dışında olabilir | 4 |
| 4 | Kadrajın üst/alt/sol/sağ kenar ortaları | Yarı dışarıda olabilir | 4 |
| 5 | Orta | Kameraya doğru **30–45°** öne eğik, sonra arkaya eğik | 2 |
| 6 | Orta | Sağa **30–45°** dönük, sonra sola dönük | 2 |
| 7 | Sol üst, sağ üst, sol alt, sağ alt bölgeler | Farklı yönlere 20–40° eğik | 8 |
| 8 | Rastgele | Kendi düzleminde 30–45° döndürülmüş | 2 |
| 9 | Orta | Toprağın 15–20 cm üstünde (hâlâ net) ve düz | 3 |

**Kurallar:**

- Tahta kadrajın yaklaşık **%20–50'sini** kaplasın.
- Bulanık fotoğraf işe yaramaz. `netlik` değeri diğerlerinin yarısının altındaysa o kareyi tekrar çekin.
- Bittiğinde kapsama haritasında **boş hücre (`.`) kalmasın**, özellikle en dış satır ve sütunlarda. Boş hücreye ek fotoğraf çekin.
- Tahtayı kameraya çok yaklaştırmayın: odak yatak mesafesine kilitli olduğundan yakın tahta bulanık çıkar.

---

## 4. İç kalibrasyonu hesaplayın (bilgisayar başında)

```bash
python3 3_ic_kalibrasyon.py
```

**Raporu nasıl okuyacaksınız:**

| Satır | İyi | Kabul edilir | Tekrar çekin |
|---|---|---|---|
| RMS yeniden izdüşüm hatası | < 0,5 px | 0,5–1,0 px | > 1,0 px |
| fx ± sapma | fx'in %0,5'inden az | %1'e kadar | > %1 (eğik foto az) |
| Boş kapsama hücresi | 0 | 1–4 (orta bölgede) | > 4 ya da köşelerde |
| Foto başına hata listesi | Hepsi benzer | — | Birkaçı 2× üstünde: o fotoğrafları silip çalıştırın |

- Betik, medyanın 2,5 katından büyük hatalı fotoğrafları bir kez kendisi atar ve yazdırır.
- `kalib_veri/ic_ornek_duzeltilmis.jpg` dosyasını açın: solda ham, sağda düzeltilmiş kare. Sağ tarafta yatak kasası, duvar kenarı gibi **gerçekte düz olan çizgiler düz** görünmeli. Kenarlardaki siyah bölgeler normaldir (`--alpha 1`, hiçbir piksel kaybolmasın diye).
- Kenarlarda hâlâ bükülme varsa (geniş açılı lens): `python3 3_ic_kalibrasyon.py --model rasyonel`, ardından köşelere birkaç fotoğraf daha ekleyin.

---

## 5. Etiketleri yerleştirin ve ölçün (sahada)

### 5.1 Yerleştirme

1. Mevcut **AprilTag 36h11** etiketlerinizi (**0, 1, 8, 9**) kullanın ya da resmî görsellerden mat kâğıda basın. Siyah karenin çevresinde en az bir hücre genişliğinde beyaz pay kalsın. Kod OpenCV'nin `DICT_APRILTAG_36h11` sözlüğünü kullanır; Adım 6 bulunan id'leri yazdırır, doğrulamayı oradan yapın.
2. Her etiketi **düz, ince, rijit bir plakaya** (3 mm PVC/dekota) yapıştırın.
3. Plakaları **toprak yüzeyine, filizlerin çıktığı seviyeye** gömerek yatırın. Etiket havada durursa eğik kamerada santimlerce kayma yapar. Hepsi aynı düzlemde olmalı.
4. Etiketleri **olabildiğince dışa, yatağın 4 köşesine** yakın koyun. Homografi etiketlerin çevrelediği alanın içinde en doğrudur; dışında hata büyür. **Filizlerin hepsi 4 etiketin oluşturduğu dörtgenin içinde kalsın.**
5. Etiketin yönü serbesttir; kod yönü görüntüden kendi bulur.
6. *(Önerilir)* Farklı id'li 1–3 etiketi daha (ör. 2, 3) yatağın ortasına ve kenarlarına **kontrol** olarak koyun. Bunlar hesaba katılmaz, yalnız hatayı ölçmek için kullanılır.

### 5.2 Ölçüm — iki yoldan birini seçin

**Yol A — Merkez + kenar (hızlı, 4 prob ölçümü):**

1. Kumpasla her etiketin **siyah karesinin dış kenarını** iki yönde ölçüp ortalamasını alın (beyaz pay dahil değil).
2. Kurşun kalemle siyah karenin **iki köşegenini** ince çizin; kesişim noktası merkezdir.
3. Robotun probunu kesişimin tam üstüne indirin ve paneldeki X, Y değerini okuyun. **Boşluk (backlash) etkisi olmasın diye her etikete aynı yönden yaklaşın.** İki kez ölçüp ortalamasını alın.
4. Z değerini de not edin: dört etiketin Z'si birbirinden **±2 mm'den** fazla farklıysa etiketler aynı düzlemde değildir, düzeltin.

**Yol B — 4 köşe (en hassas, 16 prob ölçümü):** Probu her etiketin siyah karesinin 4 köşesine indirip okuyun. Köşelerin sırası önemsiz, kod görüntüyle kendi eşler.

### 5.3 `etiketler.json` dosyasını doldurun

Aşağıdaki sayılar **yalnızca biçim örneğidir**; kendi ölçtüklerinizi yazın. Boş (`null`) alan kalırsa kod çalışmaz ve hangi alanın eksik olduğunu yazar; tahmini değer kullanmaz.

```json
{
  "kenar_mm_varsayilan": 60.2,
  "yatak_mm": {"x": [0, 540], "y": [0, 645]},
  "etiketler": [
    {"id": 0, "rol": "referans", "merkez_mm": [41.5, 38.0],  "kenar_mm": null},
    {"id": 1, "rol": "referans", "merkez_mm": [502.0, 40.5], "kenar_mm": null},
    {"id": 8, "rol": "referans", "merkez_mm": [39.0, 610.0], "kenar_mm": 60.4},
    {"id": 9, "rol": "referans", "merkez_mm": [500.5, 607.5],
     "koseler_mm": [[470.1,577.2],[530.6,577.9],[530.0,638.1],[469.8,637.4]]},
    {"id": 2, "rol": "kontrol",  "merkez_mm": [270.0, 320.0]}
  ]
}
```

- `kenar_mm: null` ise `kenar_mm_varsayilan` kullanılır.
- `koseler_mm` girilmiş etikette kenar ve yön kullanılmaz, doğrudan köşe ölçüleri kullanılır.
- Geçici olarak devre dışı bırakmak istediğiniz etikete `"rol": "yok"` yazın.

---

## 6. 16 noktalı homografiyi hesaplayın

Kadrajda kimse olmasın, gölge ve parlama olmasın. Birkaç kare çekip köşeleri ortalamak gürültüyü azaltır:

```bash
python3 4_etiket_kalibrasyon.py --cek picamera2 --adet 5
# ya da önceden çekilmiş kareyle:
python3 4_etiket_kalibrasyon.py --foto kalib_veri/yatak_1.jpg
```

Betik şunları yapar: her kareyi `kamera_ic.json` ile **undistort** eder, düzeltilmiş karede 4 etiketin 4'er köşesini alt-piksel hassasiyetle bulur, köşelerin mm karşılığını hesaplar ve **16 noktayla `cv2.findHomography`** kurar.

> Not: `cv2.getPerspectiveTransform` **yalnız tam 4 nokta** kabul eder. 16 nokta için aynı işi en küçük karelerle yapan `cv2.findHomography(..., 0)` kullanılır; 4 noktada ikisi aynı sonucu verir.

### Raporu okuma

| Bölüm | Hedef | Aşılırsa ilk bakılacak yer |
|---|---|---|
| **kenar girilen / görüntüden** | %2 içinde | Kenar yanlış ölçülmüş ya da o etiketin merkezi yanlış |
| **kare uyumu** | < 1 mm | Etiket kâğıdı buruşuk ya da eğik yatıyor |
| **16 nokta RMS** | < 1 mm | Etiketler aynı düzlemde değil, bir merkez hatalı |
| **Çapraz doğrulama** (etiket dışarıda bırakılınca merkez hatası) | < 2 mm | Değeri en büyük çıkan etiketi yeniden ölçün |
| **Kontrol etiketleri** | < 2 mm | Gerçek doğruluk budur. Kenardakiler büyükse iç kalibrasyonda köşe fotoğrafı eksiktir |
| **Kamera yüksekliği / eğimi** | Metreyle ±%3 | Tutmuyorsa iç kalibrasyon (fx) ya da tahta ölçüsü hatalı |
| **kareler arası köşe titremesi** | < 0,5 px | Işık titriyor ya da kamera sabit değil |

`kalib_veri/dis_kontrol.jpg` dosyasını açın. **Sarı ızgara** 50 mm aralıklı makine koordinatlarıdır ve yatak kenarlarına paralel, düz, eşit aralıklı görünmeli. **Yeşil daireler** (bulunan köşeler) ile **kırmızı artılar** (homografinin koyduğu köşeler) üst üste olmalı.

### Hızlı saha doğrulaması

Robotu `(100,100)`, `(270,320)`, `(480,580)` gibi 3–4 noktaya götürün. Probun altına toprağa küçük yeşil bir işaret (şişe kapağı) koyun, fotoğraf çekip `filiz_koordinat.py` ile koordinatını okuyun ve robotun konumuyla karşılaştırın.

---

## 7. Filiz tespitine bağlama

```python
import cv2
from donusum import KameraDonusum
from filiz_koordinat import tespitleri_mm, ciz

d = KameraDonusum()                         # program başında bir kez
kare = cv2.imread("kare.jpg")               # HAM kare
h, w = kare.shape[:2]

# --- sizin tespitiniz: kutular HAM karenin piksel koordinatında olmalı
# ultralytics örneği (kutuları orijinal kare boyutuna kendisi döndürür):
#   r = model(kare)[0]
#   kutular = [[*b.xyxy[0].tolist(), float(b.conf)] for b in r.boxes]
kutular = [[1203, 880, 1241, 921, 0.91]]

filizler = tespitleri_mm(kutular, d, (w, h), kaynak="ham", nokta="merkez", yukseklik_mm=0)
for f in filizler:
    print(f["x_mm"], f["y_mm"], f["cap_mm"])
cv2.imwrite("isaretli.jpg", ciz(kare, filizler, d, "ham"))
```

**Dikkat edilecekler:**

- **Kutuların koordinat sistemi:** Model kareyi 640×640 gibi bir boyuta küçültüp (letterbox) çalışıyorsa, kutuları dönüştürmeden önce **orijinal kare pikseline geri çevirin**. Ultralytics bunu kendisi yapar; Hailo gibi ham çıktılarda sizin yapmanız gerekir. Bu adımdaki bir hata, bütün kalibrasyonu boşa çıkarır.
- **`kaynak`:** Tespiti ham karede yaptıysanız `"ham"`, `d.duzelt(kare)` çıktısında yaptıysanız `"duz"`. İkisi de test edildi (yukarıdaki tablo).
- **Çözünürlük:** Ajan 640 px kare çekiyorsa dönüşüm çalışır, ama 640 px'te 1 piksel birkaç mm'ye denk gelir. Koordinat hassasiyeti istiyorsanız tespiti yüksek çözünürlüklü karede yapın.
- **Yükseklik ve paralaks:** Eğik kamerada filizin **tepesi** toprağa değdiği noktadan kaymış görünür (sanal testte 25 mm yükseklik → 21 mm kayma). Seçenekler:
  - `nokta="alt"`: kutunun alt-orta noktası. Gövde dibi kameraya uzak tarafta görünüyorsa daha doğrudur.
  - `yukseklik_mm=h`: kutu merkezinin topraktan tahmini yüksekliği. Kamera pozuyla ışın-düzlem kesişimi yapılır.
  - Hangisinin sizin kurulumda doğru olduğunu ekim kaydıyla karşılaştırarak seçin (aşağıda).

### Ekim kaydıyla karşılaştırma — asıl sapmanın ölçüsü

Sunucudaki ekim koordinatlarını `x_mm,y_mm,ad` biçiminde CSV'ye yazın ve karşılaştırın:

```bash
python3 filiz_koordinat.py --foto kare.jpg --tespit tespit.json --bitkiler ekilenler.csv
python3 filiz_koordinat.py --foto kare.jpg --tespit tespit.json --bitkiler ekilenler.csv --nokta alt
python3 filiz_koordinat.py --foto kare.jpg --tespit tespit.json --bitkiler ekilenler.csv --yukseklik-mm 20
```

Çıktıdaki **ortalama dX/dY** sistematik kaymayı, **ortanca mesafe** ise dağılmayı gösterir. Üç varyanttan ortancası en küçük olanı kullanın. Ortalama dX/dY sıfırdan belirgin farklıysa ekim anındaki robot konumu ile kalibrasyondaki prob konumu arasında ofset olabilir (ör. tohum ucu ile prob ucu aynı nokta değil).

---

## 8. Ne zaman neyi tekrarlayacaksınız

| Olay | Tekrarlanacak |
|---|---|
| Kamera çarptı / yeri değişti | Adım 6 |
| Etiketlerden biri yer değiştirdi | Adım 5.2 (o etiket) + Adım 6 |
| Toprak seviyesi belirgin değişti (çapa, yeni toprak) | Etiketleri yeni yüzeye yerleştirin → 5 + 6 |
| Odak/zoom değişti, lens söküldü | 3 + 4 + 6 |
| Farklı en-boy oranında çözünürlük | 3 + 4 + 6 (o çözünürlükte) |
| Aynı oranda farklı çözünürlük | Hiçbiri (otomatik ölçeklenir) |

`donusum.py`, iç kalibrasyon yenilenip homografi eski kalırsa çalışmayı reddeder ve Adım 6'yı tekrarlamanızı söyler.

## Sorun giderme

| Belirti | Olası neden → çözüm |
|---|---|
| `Referans etiket(ler) görüntüde bulunamadı` | Parlama/gölge; etiket kadrajın siyah (undistort) kenarında; beyaz pay yok. Işığı değiştirin, etiketi içeri alın. |
| İç RMS > 1 px | Tahta düz değil, bulanık kareler, `kare_mm` yanlış → tahtayı rijit yüzeye alın, bulanıkları silin. |
| Kontrol etiketi ortada iyi, kenarda kötü | Köşe/kenar kalibrasyon fotoğrafı az → Adım 3'teki 3 ve 4 numaralı satırları çoğaltın, `--model rasyonel` deneyin. |
| Kamera yüksekliği metreyle tutmuyor | `fx` hatalı → eğik tahta fotoğraflarını çoğaltın. |
| `Etiketlerin bir kısmı aynalı görünüyor` | Bir etiketin `merkez_mm` değerinde X ve Y yer değiştirmiş. |
| Filizler sabit bir yöne kayık | Tespit noktası/yükseklik (Adım 7) ya da ekim ucu ofseti. |
