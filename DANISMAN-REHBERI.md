# Danışman Okuma Rehberi

Bu belge projeyi dışarıdan inceleyecek kişi için yazıldı. Kurulum ve
kullanım `README.md`'de; burada **nereye bakılacağı**, hangi kararın neden
verildiği ve **nerede zayıf olduğumuzu bildiğimiz** anlatılıyor.

Amacımız iyi görünmek değil, eksikleri kapatmak. O yüzden son bölüm
(«Bildiğimiz zayıf noktalar») bu belgenin en önemli kısmı — oradan
başlanabilir.

---

## 1. Beş dakikada sistem

Raspberry Pi 5 üstünde **iki ayrı süreç** çalışıyor, aralarında WebSocket var:

```
Arduino ──USB seri──┐
                    ├─> ajan (donanım) ──WebSocket──> sunucu (FastAPI) ──> tarayıcı
PLC ──Modbus TCP────┤                                      │
                    │                                      └── SQLite (ölçüm geçmişi)
kameralar + Hailo ──┘
```

İkiye ayrılmasının sebebi: **donanım tarafı çökerse panel ayakta kalsın,
panel yeniden başlarsa makine hareketi kesilmesin.** Tek süreç olsaydı
kamera sürücüsünün kilitlenmesi sulamayı da durdururdu.

| Klasör | Ne | Satır |
|---|---|---|
| `ajan/` | PLC, Arduino, kameralar, Hailo — donanımla konuşan her şey | 10.750 |
| `sunucu/` | FastAPI uçları, iş mantığı, veritabanı | 11.768 |
| `sunucu/static/` | Panel (çerçevesiz JS, three.js, Chart.js) | 26.628 |
| `firmware/` | Arduino: sensörler, röleler, servo | 1.387 |
| `goru_kalib/` | Kamera kalibrasyon zinciri (ayrı araç takımı) | 1.702 |

Toplam 512 commit.

---

## 2. Okuma sırası

Kodun tamamını okumaya gerek yok. Sistemi anlamak için şu beş dosya yeter:

**1. `README.md`** — mimari şeması ve "tek yazıcı kuralı" (ajan çalışırken
PLC'ye başka program yazmamalı). İlk 60 satır.

**2. `ajan/plc.py`** — makinenin kalbi. Eksen hareketi, home anahtarları,
bölge denetimi. Özellikle `anahtara_sur()` ve `_anahtarda_sifirla()`:
konum PLC'de bir **sayaçtan** geliyor, geri besleme yok. Eksen takılsa bile
sayaç yürüyor. Makinenin gerçekten uçta olduğunu söyleyen tek şey home
anahtarı; bu iki fonksiyon sayacın kaymasını ölçüp düzeltiyor.

**3. `ajan/lekeler.py`** — görüntüden bitki bulma. Model kullanmıyor,
ölçüm kullanıyor: normalize ExG + kare başına Otsu eşiği + HSV ton kapısı.
Türden bağımsız olmasının gerekçesi dosya başında yazılı — tür listesine
bağlı bir bulucu her yeni türde yeniden eğitim isterdi.

**4. `ajan/koordinat.py` + `goru_kalib/REHBER.md`** — piksel → milimetre
zinciri. İç kalibrasyon (lens bozulması) ve 16 noktalı homografi.
Kalibrasyon yoksa milimetre **verilmiyor**, sebebi yazılıyor.

**5. `sunucu/main.py`** — HTTP uçları ve ajanla köprü. 4.454 satır, baştan
sona okunmamalı; `grep` ile ilgili uca gidilmeli.

Panel tarafına bakılacaksa: `sunucu/static/tarla.js` (3B/2B sahne
çekirdeği ve katman sistemi) ve `sunucu/static/katmanlar/` — her görsel
katman kendi dosyasında, birbirini tanımıyor, tek tek açılıp kapanıyor.

---

## 3. Bugün çalışan ve çalışmayan

BİGG formundaki ayrımın aynısı. Burada da aynısını yazıyoruz ki iki belge
çelişmesin.

**Prototipte doğrulanmış:**

- Dört eksende milimetrik konumlandırma; home anahtarlarıyla gerçek konum
  doğrulaması ve sayaç kaymasının ölçülüp düzeltilmesi
- Hassas tohum ekimi, hedefe yönelik sulama (süre ve miktar kayıtlı)
- Uç değiştirme: takılı başın algılanması ve göreve göre uç seçimi
- Sürekli toprak nemi ve sıcaklık ölçümü, kesintisiz kayıt
- Kamera kalibrasyonu ve görüntüden bitki–toprak ayrımı
- Cihaz üzerindeki hızlandırıcıda (Hailo) görüntü çıkarımı, fide türü tanıma
- Çalışır yönetim paneli: bahçe görünümü, bitki kartları, olay defteri,
  görev dizileri, zamanlanmış görevler, ölçüm geçmişi
- Güvenlik: eksen sınırları, güvenli yükseklik, bölge denetimi, acil
  durdurma, komutun donanımdan geri okunarak doğrulanması

**Henüz yok:** otomatik gübreleme ve dozajlama, ot temizleme ucu, hasat
ucu, robot kol, otomatik takım magazini, UV/LED, pH/EC/CO₂ sensörleri,
off-grid enerji paketi, çoklu ünite yönetimi.

**Ölçülmüş fiziksel sınırlar** (`ajan/gantry_calib.json`): çalışma alanı
540 × 645 mm, dikey eksen 120–414 mm (294 mm hareket), uç ekseni 0–55 mm.
İş planındaki 1,5 × 3 m ve 1 m bitki yüksekliği **hedef**, bugünkü makine
değil.

---

## 4. Kod okurken

**Her şey Türkçe** — değişken, fonksiyon, yorum, günlük, arayüz.

**Yorumlar "ne yaptığını" değil "neden" anlatıyor.** Bir sayı ya da sıra
seçildiyse hangi ölçüme dayandığı yazılı. Örnek (`ajan/plc.py`):

> `ANAHTAR_ARAMA_SN = 90.0` — "Eksenin bir ucundan ötekine jog hızıyla
> gitmesi en kötü hâl; 645 mm'lik Y 20 mm/s ile 32 saniye. 90 saniye o
> yolun üstünde kalıyor ve takılmış bir eksende sonsuza kadar beklemiyoruz."

**Commit mesajları belgenin bir parçası.** Bir kararın gerekçesini
aramanın en hızlı yolu `git log -S<arama>` ya da `git log --oneline` .
Mesajlarda ölçülen değerler, denenip reddedilen alternatifler ve bilinen
sınırlar yazılı. Örnek:

```
git log --oneline --grep="olcul" | head -20
```

**Uydurulmuş sayı yok.** Kalibrasyon yoksa milimetre verilmiyor; sensör
susmuşsa son değer tekrarlanmıyor, "SENSÖR SUSMUŞ" yazılıyor. Bu kural
bilinçli: yanlış olduğu belli olmayan sayı en kötü çıktı.

---

## 5. Bildiğimiz zayıf noktalar

Bu bölüm yardım istediğimiz yer.

**Otomatik test yok.** `goru_kalib/test_sentetik.py` ve
`tepe_kalibrasyon/test_sentetik.py` dışında test yok, CI yok. Doğrulama
bugün söz dizimi denetimi (`python -c "import ast..."`, `node --check`) ve
elle deneme ile yapılıyor. Donanıma bağlı kodun testi zor ama PLC ve
Arduino katmanları taklit edilerek dizi mantığı, bölge denetimi ve
koordinat dönüşümü test edilebilir. **Bizce en büyük eksik bu.**

**`sunucu/static/app.js` 5.711 satır.** 96 üst düzey fonksiyon ve 45
değişken doğrudan global alanda. Panelin geri kalanı (`tarla.js`,
`bahce.js`, `leke.js`) kapalı kalıpta yazılmış; `app.js` istisna ve asıl
teknik borç orada. Bölünmesi gerekiyor.

**Frontend'de tip denetimi yok.** `ses.js` üzerinde bir pilot yapıldı (commit `f6c0c16`)
(ES modülü + JSDoc + `tsc --noEmit`, derleme adımı olmadan); ölçüm
dosyanın temiz olduğunu gösterdi ama kalan 26.000 satıra uygulanmadı.

**Toprak nemi kalibre edilmedi.** Panel okumaları ADC tavanında
(ham 1023) duruyor, yani prob havadaymış gibi okuyor. `toprak-kalibre.py`
ile kuru/ıslak referansı girilmeli.

**Donanım: Arduino pompa çekişinde brownout'a giriyor.** Servo ve pompa
için ayrı besleme, ortak GND ve snubber gerekiyor. Yazılım tarafında
kısmen tolere ediliyor (komut doğrulama, tutma süresinin karttan geri
okunarak yeniden gönderilmesi) ama kök sebep elektriksel.

**Birim maliyet ölçülmedi.** BİGG başvurusundaki 1.200 USD hedef maliyet;
prototipin gerçek malzeme maliyeti henüz sistematik olarak çıkarılmadı.
Fiyat ve marj hesapları bu ölçümle kalibre edilecek.

**Müşteri doğrulaması yapılmadı.** Teknik yapılabilirliğe odaklanıldı;
potansiyel kullanıcılarla yapılandırılmış görüşme yürütülmedi.

**Küçük ama görünür:** dizi hatayla durduğunda paneldeki uyarı şeridi
kapatılamıyor — hata yalnız yeni bir dizi başlayınca temizleniyor
(`ajan/dizi.py`), ajan yeniden başlatılmadan gitmiyor.

---

## 6. İddiaları kendiniz doğrulamak

Bu belgedeki hiçbir şeye inanmak zorunda değilsiniz.

**Neyin ne zaman yapıldığı:**
```
git log --oneline --since="2026-09-01"
```

**Bir kararın gerekçesi** (örnek: home anahtarı):
```
git log --grep="home anahtari" --format="%h %s%n%b"
```

**Fiziksel sınırlar:** `ajan/gantry_calib.json` — min/max değerleri
makinede ölçülmüş, depoya elle yazılmıyor (`guncelle.sh` bu dosyayı
koruyor).

**Kalibrasyon doğruluğu:** `goru_kalib/4_etiket_kalibrasyon.py` çalıştığında
hata raporu üretiyor; `goru_kalib/REHBER.md` zinciri adım adım anlatıyor.

**Panelin bağımsızlığı:** `sunucu/static/index.html` içinde tek bir dış
kaynak yok — CDN yok, font servisi yok. İnternet kesildiğinde arayüz de
çalışmaya devam ediyor. Görüntü çıkarımı da cihaz üstünde
(`ajan/hailo.py`), dışarıya veri gitmiyor.

---

## 7. Dokunulmaması gerekenler

- `ajan/gantry_calib.json`, `ajan/uclar.json`, `ajan/ayarlar.json`,
  `ajan/kameralar.json` — makineye ait ölçülmüş değerler. `guncelle.sh`
  bunları koruyor; depoda değiştirmek Pi'ye ulaşmıyor.
- `sunucu/ortam` — panel parolasını tutuyor, depoda yok.
- `<veri>/model/` ve `<veri>/fide_veri/` — model ve toplanan veri,
  makinede duruyor.
