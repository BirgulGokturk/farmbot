# FarmBot Görüntü İşleme Modülü — Mimari

Amaç: tepe kamerasından **filizleri tespit etmek**, koordinatlarını **makine
(X, Y) mm** eksenine çevirmek, yabani otları filizlerden ayırmak ve bunu
mevcut ajan/sunucu döngüsüne bozmadan takmak.

Öncelik sıranıza göre kurgulandı: **önce kalibrasyonu sağlam yapan ve
filizleri daire içine alan görsel**, sonra yabani ayrımı, en son müdahale.
Modül hiçbir geri alınamaz iş tetiklemez — yalnız ölçer ve raporlar.

---

## 1. Mevcut yapıya nasıl oturuyor

```
              Raspberry Pi 5
 ┌────────────────────────────────────────────────────────────┐
 │ farmbot-ajan.service            farmbot-sunucu.service     │
 │ ┌──────────────────┐            ┌───────────────────────┐  │
 │ │ kamera.py        │            │ FastAPI / uvicorn     │  │
 │ │  Picamera2 ◄─────┼── TEK      │  :8000                │  │
 │ │  (kamera sahibi) │   SAHİP    │                       │  │
 │ │                  │            │  gorus/api.py  ◄──────┼──┼─ panel
 │ │ ajan_kanca.py    │            │       │               │  │
 │ │  kare_cek komutu │            │       ▼               │  │
 │ └────────┬─────────┘            │  ProcessPool (1 işçi) │  │
 │          │ JPEG yaz             │   gorus/boru.py       │  │
 │          ▼                      │       │               │  │
 │   /veri/kareler/*.jpg ──────────┼───────┘               │  │
 │          ▲  yol WS ile duyurulur│       ▼               │  │
 │          └─────────────────────►│  gorus.sqlite         │  │
 │                                 └───────────────────────┘  │
 └────────────────────────────────────────────────────────────┘
```

Üç karar:

**Kamera sahibi ajan olarak kalıyor.** Sunucuda ikinci bir Picamera2 açmak
"Pipeline handler in use by another process" verir. Sunucu kamera açmaz;
ajan'a `{"komut":"kare_cek"}` yollar.

**Kare WebSocket'ten base64 olarak geçmiyor.** İki servis aynı Pi'de. Ajan
JPEG'i ortak dizine yazar, yalnız **yolu** duyurur. 3840×2880 bir kare
3–5 MB; base64 ile WS'ten geçirmek hem yavaş hem de köprüyü tıkar.

**Ağır iş uvicorn'un olay döngüsünde koşmuyor.** Açık bir alt süreçte
(`python -m gorus.isci`) koşar. Panel tarama sırasında donmaz, aynı anda iki
tarama başlayamaz, OpenCV'de bir çökme sunucuyu düşürmez.

`multiprocessing` havuzu bilerek kullanılmadı — ölçüldü: hem `spawn` hem
`forkserver`, çocuk süreçte ebeveynin `__main__` modülünü yeniden
çalıştırıyor (`spawn._main → _fixup_main_from_path`). Sunucu `python main.py`
ile açılıyorsa her tarama sunucuyu bir kez daha başlatmaya kalkardı. `fork`
ise uvicorn'un iş parçacıklarıyla kilitlenme riski taşıyor. Açık alt süreçte
ikisi de yok; bedeli süreç başına **~600 ms** açılış (python + cv2 import,
bu konteynerde ölçüldü).

---

## 2. Katmanlar

| # | Modül | İş | Girdi → Çıktı |
|---|---|---|---|
| 0 | `ajan_kanca.py` | portalı park et, pozlamayı kilitle, kare çek | komut → JPEG yolu |
| 1 | `etiket.py` | AprilTag 36h11 bul, **kalibrasyonu doğrula** | kare → etiket pikselleri + artık mm |
| 2 | `duzlem.py` | piksel ↔ mm, paralaks, ROI, ölçek | piksel → makine mm |
| 3 | `isik.py` | pozlama/beyaz denge normalizasyonu | kare → kare |
| 4 | `bolutle.py` | bitki örtüsü maskesi (ExG + L\*a\*b\*) | kare → ikili maske |
| 5 | `nesne.py` | bileşen + watershed, mm öznitelikler | maske → nesne listesi |
| 6 | `eslestir.py` | ekim kaydına global atama (Macar) | nesne + kayıt → eşleşme |
| 7 | `izle.py` | taramalar arası mm uzayında takip | nesne → iz, büyüme mm²/gün |
| 8 | `siniflandir.py` | filiz / yabani / belirsiz skoru | kanıtlar → karar |
| 9 | `cizim.py` | **daire içine alan görsel** + üstten görünüm | → JPEG |
| 10 | `boru.py` | zinciri yöneten `Tarama` | kare → sonuç sözlüğü |
| 11 | `depo.py` / `api.py` | SQLite + FastAPI router | → panel |
| — | `hailo.py` | Faz 2: AI HAT+ üstünde YOLO11n-seg | (opsiyonel) |
| — | `isci.py` | taramayı alt süreçte koşturan CLI | is.json → sonuc.json |
| — | `sinama.py` | sentetik sahneyle uçtan uca ölçüm | → rapor |

---

## 3. Koordinat dönüşümü — işin kalbi

### 3.1 Homografi

Dört AprilTag (0, 1, 8, 9) toprak yüzeyinde ve **aynı düzlemde**. Her
etiketin merkezi robot probuyla ölçülmüş mm değerine sahip. 4 nokta
homografiyi tam belirler:

```
[X]       [u]                  H : 3×3,  8 serbestlik derecesi
[Y] ~  H  [v]                  (u,v) = piksel,  (X,Y) = makine mm
[1]       [1]
```

### 3.2 Çözünürlük — birinci klasik hata

H **bir çözünürlüğe bağlıdır**. 3840×2880'de hesaplanan H'yi 640 px'lik canlı
kareye uygularsanız sonuç **6 kat** yanlıştır — ve sessizce yanlıştır.
Ajan'ın şu anki canlı ayarı `"genislik": 640`; sistem daha önce buradan
çökmüş olabilir.

Kodda iki koruma var:
* `Duzlem.olcekle(yeni_boy)` → `H' = H · diag(1/s, 1/s, 1)`
* `piksel_to_mm(..., kare_boyu=...)` kare boyunu doğrular, uyuşmazsa
  **ValueError atar**. Yanlış sayı üretmez.

Doğrulandı: H'yi yarıya indirip yarı çözünürlükteki noktadan okumak
**0.0000 mikron** fark veriyor.

### 3.3 Paralaks — ikinci klasik hata

Homografi **yalnız toprak düzleminde** geçerli. Kamera eğik baktığı için
*h* mm yüksekliğindeki bir filizin yaprakları, kökünden uzağa düşer:

```
kayma = |M − N| · h / H_kam            N = kameranın toprağa dik izdüşümü
taban = M − (M − N) · h / H_kam        H_kam = kamera yüksekliği
```

Ölçülen büyüklük: nadire 818 mm uzaklıkta, 950 mm kamera yüksekliğinde,
**20 mm boyundaki bir filiz 17.2 mm kayar**. Çapa hassasiyetiniz için bu
kabul edilemez.

İki katmanlı çözüm:
1. `nesne.py` taban noktası olarak konturun **nadire en yakın** noktasını
   alır (yapraklar kameradan uzağa taşar, kök taraf nadire yakındır).
2. Yükseklik **ölçülebiliyorsa** `paralaks_duzelt()` kaymayı geri alır.
   Ölçülemiyorsa düzeltme **yapılmaz** ve alan `paralaks: "yok"` damgalanır —
   tahmini yükseklikle düzeltmek, düzeltmemekten kötüdür.

**N ve H_kam nasıl ölçülür** (`duzlem.nadir_ve_yukseklik_coz`): aynı etiketi
önce toprağa, sonra bilinen yükseklikte bir takozun üstüne koyup iki farklı
konumda okuyun. 4 denklem, 3 bilinmeyen → en küçük kareler. 10 dakikalık iş,
tek seferlik.

### 3.4 Eksen yönü — üçüncü klasik hata

X/Y takası ya da bir eksenin ters olması çok sık. `cizim.etiket_isaretleri`
kayıtlı **mm** konumlarını piksele **geri projekte** eder. İşaret etiketin
üstüne düşmüyorsa eksenler yanlıştır — tek bakışta görülür.

### 3.5 Ölçek uydurulmuyor

`Duzlem.olcek_ozeti()` yatağın 5 noktasında mm/piksel'i H'den **hesaplar**.
Sentetik sahnede ölçülen: yakın kenar 0.31 mm/px, uzak kenar 0.80 mm/px —
eğik kamerada ölçek yatak boyunca **2.5 kat** değişiyor. Bu yüzden alan
hesabı "piksel sayısı × sabit" değil, konturu mm'ye taşıyıp ayakkabı bağı
formülüyle yapılıyor.

---

## 4. Bölütleme — neden klasik, neden model değil (henüz)

**Faz 1: ExG + Otsu + L\*a\*b\***

```
r,g,b = normalize kromatiklik (R,G,B / (R+G+B))    ← parlaklığı böler, gölgeyi siler
ExG   = 2g − r − b
ExGR  = ExG − (1.4r − g)                            ← toprak kırmızısını bastırır
maske = (ExGR ≥ Otsu_ROI) ∧ (a* ≤ −3) ∧ (25 < V < 250)
        → morfolojik açma(3) + kapama(5)
```

Otsu eşiği **yalnız yatak ROI'sinin** histogramından çıkarılır. Kadrajda
yatağın dışı da var; dışarıdaki çim histogramı bozar.

Bunu seçme sebepleri:
* Etiketli veri gerektirmez — **ilk günden koordinat üretir**.
* Kalibrasyon hatasını model hatasından ayırt edilebilir kılar. Sistem
  çalışmadığında "geometri mi, renk mi?" sorusuna cevap verir.
* Faz 2'nin eğitim verisini bu üretir (zayıf etiketleme).

**Kenar sızıntısı**: yatak sınırı keskin bir çizgi değil — çerçeve tahtası,
dışarıdaki çim ve warp kenarındaki karışık pikseller sınırın içine yeşil
sızdırıp yatağı çevreleyen ince bir halka üretiyordu (ölçülen: her karede
**358 mm²**'lik sahte nesne). Çözüm: ROI'yi sınırdan **6 mm** içeri çekmek
(`roi_ic_pay_mm`) ve kompaktlığı düşük (`4πA/P² < 0.02`) halka/çizgi
biçimlerini elemek. Ölçüldü: boş yatakta 4 farklı tohumda **0 sahte tespit**,
kenardan 12–14 mm içerideki filizler hâlâ **4/4** bulunuyor.

---

## 5. Filiz / yabani ayrımı — üç kanıtın füzyonu

| Kanıt | Ağırlık | Nereden |
|---|---|---|
| **Konum** | 0.60 | Ekim kaydındaki (X,Y)'ye uzaklık |
| **Görünüm** | 0.25 | Çap, doluluk, uzanım, yeşillik aralıkları |
| **Zaman** | 0.15 | Kaç taramada görüldü, büyüme mm²/gün |

**Konum en güçlü kanıt, çünkü robot nereye ektiğini biliyor.** Ekim kaydınız
olduğu için bu tek başına işin büyük kısmını çözüyor. Görünüm bunun üstüne
destek katmanıdır, tersi değil.

Eşleştirme **en yakın komşu değil, global atama** (Macar algoritması). En
yakın komşu, yan yana çıkan iki filizde ikisini de aynı kayda bağlayıp
diğerini yabani ilan eder. Global atama bir kayda bir nesne düşürür.

Kabul yarıçapı yaşla büyür:
`r(yaş) = min(25 mm + yaş_gün × 1.5 mm, 90 mm)`

Çıktı **üç sınıf**: `filiz`, `yabani`, `belirsiz`. Belirsizler panelde
kullanıcıya sorulur; verilen cevap Faz 2'nin etiketli verisi olur — veri
çarkı kendiliğinden döner. Belirsiz olan hiçbir şey üzerinde otomatik iş
yapılmaz.

`bos_kayitlar` ayrı raporlanır: ekilmiş ama hiç görülmemiş noktalar.
"Çıkmadı mı, biz mi kaçırdık?" sorusunun cevabı.

---

## 6. Çalışma döngüsüne entegrasyon

```
tetik (zamanlı / panel düğmesi / ekim-sulama sonrası)
  │
  ├─► sunucu: ajan'a {"komut":"kare_cek","genislik":1920,"portal_park":true}
  │
  ├─► ajan: PORTALI PARK ET ──► hareketsiz bekle ──► 0.7 s titreşim sönümü
  │        pozlama kilitli çek ──► /veri/kareler/tarama_*.jpg  ──► yol döner
  │
  ├─► sunucu (ProcessPool, ayrı süreç):
  │     1  etiket bul (pencereli)  →  kalibrasyon geçerli mi?
  │        └─ GEÇERSİZ ise: koordinat YAYIMLANMAZ, panel uyarı verir, biter
  │     2  ışık normalize  →  3 ROI + yeşil maske  →  4 nesneler
  │     5  ekim kaydıyla eşleştir  →  6 izleri güncelle  →  7 sınıflandır
  │     8  görsel üret (daireler + ızgara + üstten görünüm)
  │
  ├─► SQLite'a yaz (tarama, tespit, iz)
  └─► panele WS ile duyur  →  Bahçe sekmesi mm uzayında çizer
```

**Portal parkı atlanamaz.** Portal yatağın üstündeyse kadrajı kapatır ve
gölge düşürür; tespitlerin yarısı kaybolur. Sistemin "çalışmıyor"
görünmesinin en sık sebeplerinden biri budur. Ayrıca bir AprilTag portalın
altında kaldığında kalibrasyon doğrulaması zaten düşer ve tarama
"geçersiz" biter — sessizce yanlış sonuç üretmez.

### Bahçe sekmesiyle ilişki

Bahçe sekmesi Canvas 2B'de yatağı mm uzayında çiziyor. Bu modülün çıktısı
doğrudan o uzayda: her tespit `{x_mm, y_mm, alan_mm2, cap_mm, sinif, skor}`.
Ek dönüşüm gerekmez. `cizim.ustten_gorunum()` ayrıca yatağın
**ortorektifiye** (tam tepeden, ölçekli) görüntüsünü üretir — Bahçe
sekmesinin altlığı olarak birebir kullanılabilir.

### Sunucuya bağlanma — enjeksiyon kalıbı

`gorus/api.py` **`sunucu` tarafından hiçbir şey import etmez.** Üç sebep:

* `sunucu` bir paket değil — `__init__.py` yok, `main.py` düz import
  kullanıyor (`import noktalar`, `import bitki`). `from sunucu.X import Y`
  çalışmaz; sunucu `sunucu/` dizini sys.path'teyken koşuyor.
* İşlev içine saklanmış import açılışta patlamaz; ilgili uç çağrılana kadar
  sessiz kalır, sonra 500 verir. En kötü hata türü.
* Depoda zaten `bitki.yonlendirici_kur(...)` kalıbı var; aynısı kullanıldı.

`gorus/` dizinini `sunucu/` altına koyun (böylece `import gorus.api` çalışır),
sonra `main.py`'ye:

```python
import gorus.api as gorus_api

app.include_router(gorus_api.yonlendirici_kur(
    komut_gonder=merkez.komut_gonder,   # main.py'deki gerçek köprü
    bitki_kaynagi=bitki.veri,           # ekim kaydını veren çağrı
))
```

`komut_gonder` eşzamanlı da olabilir async de — ikisi de destekleniyor.
Bağımlılık eksik ya da çağrılabilir değilse **yönlendirici kurulurken**
`TypeError` atılır; açılışta, sessizce değil.

`bitki.veri()`'nin döndürdüğü kayıt biçimini bilmiyorum. `_kayitlara_cevir`
yaygın alan adlarını deniyor (`x_mm/x/X/konum_x`, `y_mm/y/Y/konum_y`,
`id/kimlik/no`, `ekim_tarihi/ekildi/tarih`, hem liste hem `{id: kayit}`
sözlüğü). Hiçbiri tutmazsa **gördüğü anahtarları yazan** bir hata verir —
sessizce yanlış koordinat üretmez. Biçiminiz farklıysa:

```python
gorus_api.yonlendirici_kur(..., kayit_donusturucu=benim_cevirici)
```

`prefix="/gorus"`; mevcut `/api/goruntu/*` ve `/api/kamera/kalibrasyon`
uçlarıyla çakışmıyor. `gorus/` yeni ve ayrı bir paket; `sunucu/etiket.py`,
`filiz.py`, `tanima.py`, `bitki.py` dosyalarına dokunmuyor.

Uçlar:

| Yöntem | Yol | İş |
|---|---|---|
| POST | `/gorus/tarama` | yeni tarama (kare yoksa ajan'dan ister) |
| GET | `/gorus/tarama/son` | son tarama + tespitleri |
| GET | `/gorus/tarama/{id}/gorsel.jpg` | daire içine alınmış kamera görünümü |
| GET | `/gorus/tarama/{id}/ustten.jpg` | ortorektifiye kuşbakışı |
| GET | `/gorus/tespitler?sinif=` | filiz / yabani / belirsiz listesi |
| POST | `/gorus/tespit/{id}/etiket` | kullanıcı düzeltmesi (Faz 2 verisi) |
| GET | `/gorus/kalibrasyon` | H, etiketler, artık, ölçek |
| GET | `/gorus/saglik` | bağımlılıklar bağlı mı, kalibrasyon yerinde mi |

---

## 7. Görsel katman

İki görünüm üretilir:

**Kamera görünümü** (`ustdenklestir`) — ham kare üzerine:
* yatak sınırı ve **50 mm ızgara**, mm uzayında üretilip piksele projekte
* her tespit için **mm uzayında çember** → eğik kamerada **elips** çizilir
* taban noktasında artı işareti, yanında `#id sınıf skor / X… Y… / alan`
* etiket konumlarının geri projeksiyonu (eksen denetimi)
* ekilmiş ama görülmemiş noktalar kesikli gri çemberle
* üstte bilgi şeridi: kalibrasyon artığı, etiket sayısı, sınıf sayımları, eşik

> Daireler **elips** görünüyorsa homografi uygulanmış demektir. Kusursuz
> daire görüyorsanız kalibrasyon devrede değildir. Izgara toprağa oturmuyorsa
> kalibrasyon bozuktur. Bu görsel, kalibrasyonun tek bakışta denetimidir.

**Üstten görünüm** (`ustten_gorunum`) — kare homografiyle düzleştirilir:
tam tepeden, 1 piksel her yerde aynı mm. Yatak dümdüz dikdörtgen, ızgara
kare, etiketler kare çıkmıyorsa kalibrasyon bozuktur. Kalibrasyonun en
güçlü görsel kanıtı budur.

Etiket yazıları çakışma çözücüden geçer (uzak sırada bitkiler birbirine
girer), taşınan etiket nesneye ince bir çizgiyle bağlanır.

---

## 8. "Daha önce denedik, çalışmadı" — teşhis listesi

Sırayla denetleyin; her maddenin kodda karşılığı var.

| # | Belirti / sebep | Denetim |
|---|---|---|
| 1 | **H yanlış çözünürlükte uygulanıyor** (3840'ta kalibre, 640'ta kullanım → 6× hata) | `piksel_to_mm` artık ValueError atıyor; `GET /gorus/kalibrasyon` → `kare_boyu` |
| 2 | **Etiketler toprak düzleminde değil** (havada duran etiket santimlerce kaydırır) | Etiketleri kâğıtla toprağa yapıştırın; `oz_denetim().artik_rms_mm` |
| 3 | **Etiketler küçük/eğik, varsayılan parametreler kaçırıyor** | `etiket.py` parametreleri gevşetildi; `tani.en_kucuk_kenar_px` |
| 4 | **X/Y takası ya da eksen tersliği** | Görselde etiket geri projeksiyonu etiketin üstüne düşüyor mu |
| 5 | **Paralaks** (20 mm boy, ölçülen kayma 17.2 mm) | `nadir_mm` + `kamera_yuksekligi_mm` doldurulmuş mu; `saglik.paralaks_duzeltmesi` |
| 6 | **Portal kadrajı kapatıyor / gölge düşürüyor** | `portal_park: true`; eksik etiket → tarama geçersiz |
| 7 | **Kamera kalibrasyondan sonra oynamış** | Her taramada artık ölçülür; ölçüldü: **10 px kayma → 5.96 mm artık → tarama geçersiz** |
| 8 | **Otomatik pozlama/AWB eşikleri kaydırıyor** | `ajan_kanca.poz_ogren()` bir kez öğrenip kilitler; `isik.tani.kazanc_bgr` |
| 9 | **640 px'lik canlı karede filiz birkaç piksel** | Tespit karesi 1920 (ölçülen 0.31–0.80 mm/px); 640'ta filiz kotiledonu ~2 px |
| 10 | **Yatak kenarı yeşil sızdırıyor** (her karede 358 mm² sahte nesne) | `roi_ic_pay_mm = 6`, `min_kompaktlik = 0.02` |

---

## 9. Ölçülen sayılar

`python -m gorus.sinama` — sentetik yatak sahnesi: gerçek AprilTag 36h11
görüntüleri, bilinen mm konumlarında filizler, eğik kamera warp'ı, ışık
eğimi ve toprak dokusu gürültüsü. Gerçek mm ↔ bulunan mm karşılaştırılır.

Eğim ve gürültü taraması (10 filiz + 4–6 yabani, 1920×1440):

| eğim | gürültü | bulunan | ort. hata | max hata | sınıf doğruluğu |
|---|---|---|---|---|---|
| 0.15 | 5 | 14/14 | 1.06 mm | 2.09 mm | 1.00 |
| 0.15 | 14 | 14/14 | 0.99 mm | 2.40 mm | 1.00 |
| 0.45 | 5 | 14/14 | 1.20 mm | 2.34 mm | 1.00 |
| 0.45 | 14 | 14/14 | 1.12 mm | 2.05 mm | 1.00 |
| 0.75 | 5 | 14/14 | 1.63 mm | 3.09 mm | 1.00 |
| 0.75 | 14 | 14/14 | 1.63 mm | 2.57 mm | 1.00 |

Korumalar:

| Senaryo | Sonuç |
|---|---|
| Kamera 3 px kaydı | artık 1.70 mm → geçerli, koordinat yayımlanıyor |
| Kamera 10 px kaydı | artık 5.96 mm → **geçersiz**, koordinat yayımlanmıyor |
| Kamera 30 px kaydı | artık 17.76 mm → **geçersiz** |
| Bir etiket kapalı | **geçersiz** — "etiket görünmüyor: [0]" |
| Boş yatak (4 tohum) | **0 sahte tespit** |
| Kenardan 12–14 mm içerideki filizler | 4/4 bulundu |
| Yanlış çözünürlük / en-boy oranı / 4'ten az etiket | ValueError |

Uç noktalar (sahte köprü + sahte ekim kaydıyla, TestClient üstünde ölçüldü):

| Senaryo | Sonuç |
|---|---|
| Normal tarama | HTTP 200, 5 filiz + 2 yabani, hepsi doğru kayda eşleşti |
| Olmayan kare yolu | HTTP 404 "Kare bulunamadı: …" |
| Bozuk JPEG | HTTP 500 "Kare okunamadı: …" |
| Ajan kare veremedi | HTTP 503 "ajan kare veremedi: kamera meşgul" |
| Ajan cevabında yol yok | HTTP 502, gördüğü anahtarları yazıyor |
| Eşzamanlı köprü / async köprü | ikisi de HTTP 200 |
| Zaman aşımı | HTTP 504, alt süreç öldürülüyor |
| Tanınmayan kayıt biçimi | HTTP 500, **gördüğü anahtarları listeliyor** |
| Bağımlılık eksik | açılışta TypeError (uç çağrılınca 500 değil) |
| Uçtan uca duvar saati | 1.29–1.71 sn (boru içi 0.70–1.09 sn + ~0.6 sn süreç açılışı) |

Süreler (1920×1440, **Intel Xeon 2.10 GHz, 2 çekirdek** — Pi 5 değil):

| adım | ms |
|---|---|
| etiket bul + kalibrasyon doğrula | 91 |
| ışık normalize | 15 |
| bölütleme | 149 |
| nesne + öznitelik | 65 |
| eşleştirme + izleme + sınıflandırma | 1 |
| çizim | 93 |
| **toplam** | **~414** |

> Bu sayılar bu konteynerde ölçüldü, Pi 5'te değil. Pi'de ölçmek için:
> `python -m gorus.sinama` — çıktıdaki `sureler_ms` gerçek rakamınızdır.
> Tahmin yürütmedim.

İki hızlandırma zaten uygulandı: etiket araması tarama başına **bir kez**
(412 → 91 ms) ve ışık düzeltmesi float32 çarpım yerine 256 girişli arama
tablosu (446 → 15 ms).

---

## 10. Faz planı

**Faz 1 — şimdi (bu paket).** Klasik CV. Kalibrasyon doğrulaması, filiz
tespiti, mm koordinatları, daire içine alan görsel, ekim kaydı eşleştirmesi,
zamansal takip. Model yok, veri seti yok, GPU yok.

**Faz 2 — veri biriktikçe.** AI HAT+ (Hailo-8, 26 TOPS) üstünde
YOLO11n-seg. Zincir `gorus/hailo.py` başında adım adım yazılı:
1. Veri: Faz 1 zaten üretiyor. Ekim kaydına düşen nesne "filiz", uzak
   nesne "yabani" → **zayıf etiket**. Panelde kullanıcının düzelttiği
   tespitler → **kuvvetli etiket** (`depo.egitim_kumesi`).
   Hedef ~300–800 kare. Ön eğitim için PhenoBench, CropAndWeed, Plant
   Seedlings Dataset.
2. `yolo train model=yolo11n-seg.pt imgsz=640 epochs=150`
3. `yolo export format=onnx opset=13`
4. `hailomz compile yolov8n_seg --hw-arch hailo8 --calib-path ...` → `.hef`
5. `HailoBolutleyici` ile koştur; **klasik yol yedek kalır** (model yoksa
   `hazir=False` döner, boru hattı `bolutle.yesil_maske`'ye düşer).

26 TOPS bu iş için fazlasıyla yeterli; darboğaz CPU'daki JPEG çözme ve
morfoloji olacak, model değil.

**Faz 3 — müdahale.** Yabani listesi → iş kuyruğu → onay adımı → portal
hareketi. Bu paket bilerek buraya girmiyor.

---

## 11. Kurulum

```bash
# Pi'ye kopyala (Tailscale: batupi-1 = 100.122.207.116)
rsync -av gorus/ batupi@100.122.207.116:/home/batupi/farmbot/sunucu/gorus/

# sunucu venv'i
/home/batupi/farmbot/sunucu/.venv/bin/pip install opencv-python-headless scipy pillow

# gorus/ dizinini sunucu/ altına koyun, main.py'ye:
#   import gorus.api as gorus_api
#   app.include_router(gorus_api.yonlendirici_kur(
#       komut_gonder=merkez.komut_gonder, bitki_kaynagi=bitki.veri))

# ajan tarafı: ajan.py komut çözücüsüne
#   elif komut == "kare_cek":
#       cevap = await kare_cek(kamera, mesaj, portal)

# kalibrasyonu gorus/veri/kalibrasyon.json'a yaz (mevcut HMI'nizin H'si,
# hangi çözünürlükte hesaplandıysa kare_boyu ona eşit olmalı)

# doğrulama
python -m gorus.sinama
curl localhost:8000/gorus/saglik
curl -X POST localhost:8000/gorus/tarama
```

Sözdizimi denetimi (isteğiniz üzerine, başka denetim çalıştırılmadı):

```bash
python -c "import ast,glob; [ast.parse(open(f).read()) for f in glob.glob('gorus/*.py')]"
```

---

## 12. İlk gün ne yapmalı

1. `python -m gorus.sinama` çalıştırın — zincirin sağlam olduğunu Pi'ye
   dokunmadan görün, `sureler_ms`'i kaydedin.
2. Mevcut kalibrasyonunuzu `kalibrasyon.json`'a taşıyın. **`kare_boyu`
   alanını H'nin hesaplandığı çözünürlüğe eşitleyin** — 1 numaralı hata.
3. Ajan'a `kare_cek` komutunu ekleyin, portal parkını bağlayın.
4. `POST /gorus/tarama` → `gorsel.jpg`'ye bakın. Izgara toprağa oturuyor mu,
   etiket işaretleri etiketlerin üstünde mi? Oturmuyorsa 8. bölüme dönün.
5. `nadir_ve_yukseklik_coz` ile N ve H_kam'ı ölçün (10 dk). Paralaks
   düzeltmesini açın; robot probuyla birkaç filizin gerçek (X,Y)'sini ölçüp
   modülün verdiğiyle karşılaştırın. **Asıl doğruluk sayınız budur.**
6. Ondan sonra yabani ayrımının eşiklerine bakın.
