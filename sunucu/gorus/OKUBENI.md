# gorus — ölçüm kamerası ve bitki ölçüm katmanı

Kalibrasyon ve filiz **tespiti** bu pakette yok — onlar sunucuda zaten var
(`sunucu/etiket.py`, `kalibrasyon.py`, `filiz.py`, panelin "AprilTag ile
kalibre et" bölümü). Bu paket tespitleri **girdi alır**, üstüne ölçüm ve
karar koyar. İkinci bir tespit hattı, birbiriyle çelişen iki cevap üretir.

### Kamera katmanı

| modül | iş |
|---|---|
| `usb_kamera` | UVC kontrollerini kilitler, tam çözünürlükte kare çeker |
| `akis` | panelin ffmpeg akışını tarama süresince duraklatır |
| `kamera_denetim` | kamera ölçüme uygun mu — odak/pozlama/montaj testi |
| `etiket_bas` | yazdırılabilir AprilTag 36h11 sayfası üretir |
| `ajan_kanca` | ajan'a eklenecek `kare_cek` komutu |

### Ölçüm katmanı

| modül | madde | iş |
|---|---|---|
| `girdi` | — | filiz.py çıktısını `Tespit`e çevirir |
| `eslestir` | 2 | ekim kaydıyla global atama (Macar) + çimlenme raporu |
| `siniflandir` | 3 | filiz / yabani / belirsiz |
| `izle` | 4 | taramalar arası takip, mm²/gün büyüme |
| `cizim` | 5 | daire içine alma + ortorektifiye kuşbakışı |
| `depo` | 6 | SQLite arşiv, zaman serisi, insan etiketi |
| `ortu` | 7 | yaprak alanı, yatak kapsama yüzdesi |
| `tarama` | — | hepsini birleştiren tek giriş noktası |

## Ölçüm katmanını bağlama

```python
from gorus.tarama import Tarama
from gorus import cizim

t = Tarama(db_yolu="/home/batupi/farmbot/veri/olcum.sqlite")
sonuc = t.calistir(
    ham_tespitler = filiz.bul(...),          # filiz.py ne döndürüyorsa
    ham_kayitlar  = bitki.veri(),            # ekim kaydı
    kare          = "/veri/kareler/x.jpg",   # görsel istiyorsanız
    H             = harita_matrisi,          # kalibrasyondan (piksel->mm 3x3)
)
```

`filiz.py` ve `bitki.veri()` alan adlarını sezgiyle bulur (`x_mm/x/X`,
`alan_mm2/alan`, ...). Hiçbiri tutmazsa **gördüğü anahtarları yazan** bir
hata verir; biçiminiz farklıysa `tespit_donusturucu=` / `kayit_donusturucu=`
ile kendi çeviricinizi geçin.

### Sınıflandırma nasıl karar veriyor

Üç kanıtın ağırlıklı toplamı, sert kural değil:

* **konum (0.60)** — ekim kaydına uzaklık. En güçlü kanıt; robot nereye
  ektiğini biliyor.
* **görünüm (0.25)** — *akranlara göre* boyut. Aynı taramada ekim kaydına
  oturmuş bitkilerin alan ortancası referanstır; bitkiler büyüdükçe referans
  kendiliğinden kayar, sabit eşik güncellemeye gerek kalmaz.
* **zaman (0.15)** — **doğrulayıcıdır, üretici değil.** Eşleşmiş bir nesnenin
  ısrarı onu doğrular; eşleşmemiş bir nesnenin ısrarı onu mahsul yapmaz,
  tersine yabani olduğunu pekiştirir.

Son madde ilk sürümde yanlıştı: salt ısrar ödüllendiriliyordu ve ısrarcı
yabani otlar üç taramada "belirsiz"e kayıyordu. Ölçülen davranış (düzeltme
sonrası, beş ardışık tarama):

| tarama | filiz | yabani | belirsiz | yabani skorları |
|---|---|---|---|---|
| 1 | 6 | 1 | 0 | 0.07 |
| 3 | 8 | 2 | 0 | 0.03, 0.04 |
| 5 | 8 | 2 | 0 | 0.01, 0.01 |

Akran karşılaştırması (mahsul ortancası ~121 mm²):

| eşleşmeyen nesnenin alanı | görünüm skoru |
|---|---|
| 125 mm² (mahsulle aynı) | 0.99 |
| 160 mm² | 0.39 |
| 220 mm² ve üstü | 0.00 |
| 40 mm² (çok küçük) | 0.02 |

## Neden bu üçü gerekli

**Tekil erişim.** UVC kamera aynı anda tek süreç tarafından açılabilir.
Panelin canlı akışı (640x480 ffmpeg) kamerayı tuttuğu sürece 3840x2160 kare
çekilemez — ikinci açan `VIDIOC_REQBUFS returned -1 (Device or resource busy)`
alır. `akis` bunu çözer.

**Otomatik ayarlar kalibrasyonu bozar.** Odak değişince görüş açısı da
değişir, homografi kayar. MX Brio'da ölçülen durum:

* `focus_automatic_continuous` YOK — otomatik odak anahtarı Linux'a
  açılmıyor. `focus_absolute`'a değer yazmak kapatıyor.
* `zoom_absolute` YOK — görüş açısı (65/78/90°) yalnız Windows/Mac'teki
  Logi Options+'tan değişiyor.
* `pan_absolute` / `tilt_absolute` VAR — sensör içinde dijital kaydırma
  yapar, sıfırdan farklıysa kadraj kayar ve kalibrasyon bozulur. 0'a
  sabitleniyor.
* `power_line_frequency` fabrikada 2 (60 Hz). Türkiye 50 Hz; yanlış değer
  LED/floresan altında bant üretir ve yeşil eşiğini oynatır. 1'e çekiliyor.
* `backlight_compensation` fabrikada 1 (açık) — kamera arka plandaki
  parlaklığa göre pozlamayı oynatır. Kapatılıyor.
* `contrast`/`saturation`/`sharpness` fabrikada 150/132/145. Bunlar "yüz
  güzel görünsün" ayarları; ölçümde doğrusal olmayan müdahale istenmez,
  nötr 128'e çekiliyor.

**Kabul testi.** Kalibrasyon yapmadan önce kameranın KARARLI olduğunu
ölçmek gerekir, yoksa sonradan hata kaynağını ayırt edemezsiniz.

## Kullanım sırası

```bash
cd /home/batupi/farmbot/sunucu
DEV=/dev/v4l/by-id/usb-046d_MX_Brio_2613ZBA0H858-video-index0

# 1. Cihazı ve desteklenen biçimleri gör
.venv/bin/python -m gorus.usb_kamera --listele

# 2. Kontrolleri kilitle, odağı sabitle, deneme karesi çek
.venv/bin/python -m gorus.usb_kamera --cihaz $DEV --ogren \
    --cek /home/batupi/farmbot/veri/kareler/deneme.jpg

# 3. Kabul testi: ışığın değiştiği bir aralığa yayılmış 10 kare
.venv/bin/python -m gorus.usb_kamera --cihaz $DEV --seri 10 --aralik 300 \
    --cek /home/batupi/farmbot/veri/kareler/denetim/x.jpg
.venv/bin/python -m gorus.kamera_denetim /home/batupi/farmbot/veri/kareler/denetim/*.jpg

# 4. Geçtiyse: panel -> Kamera -> "AprilTag ile kalibre et"
```

Adım 2 ve 3 kamerayı tek başına açar; panelin akışı çalışıyorsa önce
duraklatın (`gorus.akis`) ya da paneldeki akışı kapatın.

## Ajan'a bağlama — mevcut `kamera_kare` protokolüne

Yeni komut YOK. Sunucu zaten `kamera_kare` yolluyor (main.py
`_cozumleme_karesi`); eksik olan, ajanın bu komutu USB kamera için
karşılayamaması. Ajan tam çözünürlüklü kareyi bellekten veriyor; CSI'da o
kare var (picamera2 tam çözünürlükte çekiyor), USB'de yok — elde yalnız
ffmpeg'in 640x480 akışı var.

`ajan.py` komut çözücüsünde (`if ad == "kamera_kare":` satırı):

```python
if ad == "kamera_kare":
    from gorus.ajan_kanca import kamera_kare_usb, USB_KAMERALAR
    if arg.get("kamera") in USB_KAMERALAR:
        return await kamera_kare_usb(arg)
    ...                       # mevcut CSI yolu olduğu gibi kalır
```

Kanca protokolü birebir karşılar: `{"kamera", "azami_yas_sn"}` alır,
`{"ok": True, "veri": {"kare": "<base64 JPEG>"}}` döner. Başarısız olursa
`ok: False` döner ve sunucu kendi yedeğine (küçük canlı kare) düşer —
akış zinciri bozulmaz.

Yaptığı: canlı akışı duraklat → 3840x2160 kare çek → akışı geri aç.
`azami_yas_sn` gözetilir; ölçüm arka arkaya çağrıldığında kamerayı
gereksiz açıp kapatmamak için o süre içindeki kare önbellekten verilir.

`AKIS_DURDUR` / `AKIS_BASLAT` değerlerine ajan'ın kendi akış çağrılarını
verin. Boş bırakılırsa modül cihazı tutan ffmpeg süreçlerini bulup
sonlandırır ve komut satırını kaydedip geri başlatır — ama ffmpeg'in
stdout'u WebSocket'e bağlıysa o boru kopar ve panel görüntüsü dönmez.

`USB_KAMERALAR` içindeki ad, sunucudaki kamera kaydıyla aynı olmalı
(panelde "Uç kamerası" görünen kamera).

## Panelde yapılacak iki düzeltme

1. Canlı akışın cihazını indeksten kurtarın: `ajan.py`'deki ffmpeg
   komutunda `/dev/video0` yerine yukarıdaki `by-id` yolu.
2. "AprilTag ile kalibre et" bölümündeki **Kamera** listesinden ölçüm
   kamerasını seçin (şu an "Üst kamera" = CSI, eğik bakan).

## Kalibrasyon hakkında (bu pakette değil ama önemli)

Etiketleri yatağın tamamına yayın ve **en az 5, tercihen 6** tane koyun.
Homografinin 8 serbestlik derecesi var, her etiket 2 denklem verir; tam 4
etiketle çözüm noktalardan birebir geçer ve artık zorunlu olarak ~0 çıkar.
Paneldeki "±0,0 mm" doğruluk değil, aritmetiktir — `sunucu/etiket.py`
zaten bunu söylüyor (satır 391 ve 411). Beşinci etiket, kalibrasyonun
gerçekte kaç mm tuttuğunu ilk kez görünür kılar.
