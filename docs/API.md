# Pi sunucusunun API'si — başka bir arayüzden bağlanmak

Bu belge, `farmbot-web` gibi **ayrı bir arayüzün** Pi'deki sunucudan gerçek
sensör verisini alması ve komut göndermesi içindir. MQTT'ye ya da Arduino'ya
doğrudan bağlanmaya gerek yok: ajan Arduino'yu okuyup bu sunucuya yazıyor,
arayüz de buradan çekiyor.

```
Arduino ──seri──> ajan ──WebSocket──> sunucu ──HTTP/WS──> herhangi bir arayüz
                                     (Pi, port 8000)
```

## Adres

| Nereden | Adres |
|---|---|
| Ev ağı | `http://batupi.local:8000` |
| Tailscale (ev dışı, telefon) | Pi'de `tailscale ip -4` ile öğrenilir |

## Kimlik doğrulama

`PANEL_PAROLA` doluysa **her istekte** `jeton` sorgu parametresi gerekir;
yanlışsa `401 {"detail": "Parola hatalı"}` döner.

```
GET /api/durum?jeton=PAROLA
```

Parola `sunucu/ortam` dosyasında. Boş bırakılırsa kimlik doğrulama tamamen
kapanır (yalnız yerel ağ için uygun).

## CORS — tarayıcıdan çağırmadan önce şart

Sunucu varsayılan olarak hiçbir dış kökene izin vermiyor. Robotu hareket
ettiren bir API'de "herkese açık" varsayılanı doğru değil, o yüzden köken tek
tek sayılıyor. Pi'de `sunucu/ortam` dosyasına ekleyin:

```
IZINLI_KOKENLER="http://localhost:5173,http://batupi.local:3000"
```

Sonra `sudo systemctl restart farmbot-sunucu`. Açılış kaydında
`CORS acik: ...` satırını görürsünüz. Bu ayar yokken tarayıcı istekleri
sessizce engellenir (sunucu 200 döner ama tarayıcı okumaz).

## Uçlar

### `GET /saglik`
Kimlik istemez. Servisin ayakta olup olmadığı ve ajanın bağlı olup olmadığı.

```json
{"ok": true, "ajan_bagli": true}
```

### `GET /api/durum`
Anlık makine durumu ve son ölçüm.

```json
{
  "durum": {
    "bagli": true,
    "konum": {"x": 120.0, "y": 80.0, "z": 340.0},
    "plc": "bagli", "enable": true, "hareket": false, "jog": [],
    "z_guvenli": true, "guvenli_z": 340.0, "toprak_z": 110.0,
    "acil": {"acik": false, "saat": "", "neden": ""},
    "sinirlar": {"x": {"min": 0, "max": 425},
                 "y": {"min": 0, "max": 630},
                 "z": {"min": 0, "max": 550}},
    "hiz": 20.0, "hata": null, "arduino": true,
    "sunucu_saati": 1787496298.5
  },
  "olcum": {
    "hava_nem": 45, "hava_sicaklik": 26,
    "bmp_sicaklik": 27.1, "basinc": 1009.2, "rakim": 120,
    "toprak_nem": 350,
    "r_su_pompasi": 0, "r_hava_pompasi": 1, "calisma_sn": 7412,
    "ham": {"hava_nem": 47, "hava_sicaklik": 27,
            "bmp_sicaklik": 27.14, "basinc": 1009.24,
            "rakim": 119.9, "toprak_nem": 356},
    "ts": 1787496298.07
  },
  "panel_kilitli": true
}
```

`ajan_bagli` / `durum.bagli` false ise `olcum` eski veri olabilir; `ts`
alanına bakın.

`toprak_z` toprak yüzeyinin **makine Z'si**. Yüzey sıfırda değil; ölçülen
kurulumda 110 mm. Ayarda `plc.toprak_z` olarak duruyor, `toprak-olc.py` ucu
yüzeye indirip yazıyor. Hareketi sınırlamıyor — panel sahneyi doğru
yükseklikte kursun ve ekim derinliği yüzeyden hesaplansın diye yayınlanıyor.
PLC koptuğunda da gönderiliyor, çünkü değer PLC'den değil ayardan geliyor.

`durum.uc.tohumluk` = `{x, y, z}` ya da `{}`. Uç profilinin ucundaki delikli
blok; `uclar.json` içinde uçlarla aynı yerde duruyor. `x` boşsa tohumluk
tanımsız sayılır ve çizilmez.

### `GET /api/gecmis?dakika=N`
Grafik için geçmiş. `dakika` 1 ile 10080 (7 gün) arası. Sunucu en fazla ~600
nokta döndürür — daha uzun aralıklar SQL tarafında seyreltilir, yani 6 saatlik
istek 10 bin satır değil ~600 nokta getirir.

Yanıt, kanal adından diziye eşleşen bir nesnedir; `ts` dizisi ile aynı
sıradadır.

### `POST /api/komut?jeton=PAROLA`
Gövde: `{"ad": "git", "arg": {"x": 100, "y": 50, "z": 400}}`

Yanıt: `{"ok": true, "mesaj": "..."}` — ajan yanıtlamazsa 20 saniyede zaman
aşımı.

| Komut | arg |
|---|---|
| `git` | `{"x":100,"y":50,"z":400}` — eksenler isteğe bağlı, sıra Z→Y→X |
| `home` | `{"eksen":"z"}` ya da `{}` (hepsi) |
| `dur` | `{}` |
| `acil` | `{}` — mandallı acil durdurma |
| `acil_temizle` | `{}` |
| `enable` | `{"deger": true}` |
| `hiz` | `{"mm_s": 20}` |
| `role` | `{"ad": "su_pompasi", "durum": true}` — ya da `hava_pompasi` |
| `jog` / `jog_dur` | REST yerine WebSocket'ten gönderin (aşağı bakın) |
| `bolge_listele` | `{}` — ajandaki yasak bölgeler |
| `bolge_kaydet` | `{"bolgeler":[{ad,x1,y1,x2,y2,izin_kosulu,yuva,aktif}]}` |
| `uc_listele` | `{}` — kafa ayarları: üç baş ve tohumluk |
| `uc_kaydet` | `{"ayar":{"baslar":{…},"tohumluk":{…},"safe_z":…}}` — başların kayması/derinliği ve tohumluk gözleri. Baş başına birleştiriyor: tek başın `dx`ini yollamak ötekileri silmiyor |
| `tohum_ucu` | `{"yukari":true}` ya da `{"mm":12.5}` — tohum ucunun KENDİ dikey ekseni (PLC'de j4, kodda T). Kalibre değilse reddediyor |
| `dizi_baslat` | `{"ad":…,"adimlar":[…],"tekrar":1}` — adımlar ÇÖZÜLMÜŞ olmalı |
| `dizi_durdur` | `{}` — sert duruş, hedefleri nötrler |

### Nokta deposu, ızgara, programlar, kamera (ajana gitmeyen uçlar)

| Uç | Ne yapar |
|---|---|
| `GET /api/noktalar` | Kayıtlı noktalar |
| `POST /api/noktalar` | `{ad,x,y,z,ustune_yaz}` — aynı isim 409 döner. `tur` ve `ekim` alanları verilirse nokta bir **bitki** olur (tarla tasarımcısı bunu kullanıyor). `ozel: {alan: sayı}` **tek bitki düzeyinde** ezme: yalnız o bitkiyi etkiler, türün geri kalanı katalogdaki değerde kalır. Aralık dışı bir alan sessizce atılır, kaydın tamamı reddedilmez. `ustune_yaz` bütün kaydı değiştirdiği için gönderilmeyen alan silinir — panel her yazmada `egri_*` ve `ozel` alanlarını da yollar |
| `DELETE /api/noktalar?ad=…` | Siler |
| `POST /api/izgara/onizle` | `{x0,y0,z,dx,dy,satir,sutun,onek}` → sayım + sınır dışı + üzerine yazılacaklar |
| `POST /api/izgara/uygula` | Aynı gövde; noktaları depoya yazar |
| `GET/POST /api/programlar` | Program listesi / kaydet |
| `DELETE /api/programlar?ad=…` | Siler |
| `POST /api/programlar/calistir` | `{ad}` — nokta adlarını çözer, ajana yollar |
| `GET /api/noktalar/tursuz?yaricap=25` | Türü YAZILI OLMAYAN noktalar. `ustuste` = bir bitkinin yarıçapı içinde duranlar (tür yazılmadan üretilmiş eski ızgara noktaları), `yalniz` = tek başına duranlar (referans olabilir, dokunulmuyor). Silmiyor; silme geri alınabilir olan `/api/toplu` "sil" yolundan geçiyor |
| `GET /api/kare/son?kamera=uc` | O kameranın son karesi (JPEG) |
| `GET /api/kare/canli?kamera=uc` | O kameranın canlı akışındaki son kare (bellekten) |
| `GET /api/kare/liste?kamera=` | Kare künyeleri: `damga`, `ts`, **`kamera`** ve **çekildiği konum** (`x`, `y`). `kamera` boşsa hepsi. **Sabit kameranın karelerinde `x`/`y` her zaman `null`** — o kamera makineyle hareket etmiyor. Konumsuz olması artık "haritaya konamaz" demek DEĞİL: AprilTag haritası varsa karenin her pikseli doğrudan yatak koordinatı veriyor |
| `GET /api/kare/<damga>?kamera=uc` | Tek kare, JPEG |
| `GET /api/kamera/kalibrasyon?kamera=uc` | O kameranın `mm_px`, `donme`, `ofset_x/y`, `ayna_x/y`, **`harita`** (3x3 homografi), `harita_sapma_mm`, `harita_nokta`, `harita_makine_x/y` + `kalibrasyonlar` (hepsi) |
| `POST /api/kamera/kalibrasyon` | Aynı alanlar + `kamera`. **Yalnız o kamerayı yazar**, ötekine dokunmaz. Elle giriş yolu; olağan yol AprilTag taramasının kaydetmesi |
| `GET/POST /api/kamera/etiket/konumlar` | AprilTag kenar ölçüsü ve kimlik → yatak koordinatı kaydı |
| `POST /api/kamera/etiket/tara` | `{kamera, kaydet}` — TAM çözünürlüklü kareyi tarar. Bir etiket → `mm_px`; konumu bilinen iki etiket → `donme` + `ofset_x/y`; **dört etiket → `harita`** (perspektifli homografi) ve `harita_artik_mm`. Hareketli kamerada sonuç göreceliye çevriliyor (makinenin tarama anındaki konumu çıkarılıyor) ve `harita_makine_x/y` yazılıyor; sabit kamerada mutlak kalıyor |
| `POST /api/kamera/filiz/bul` | `{kamera, esik, en_az_piksel, birlestir_mm}` — TAM çözünürlüklü karede yeşil lekeleri bulup **yatak koordinatı** veriyor. `yontem` alanı hangi modelin kullanıldığını yazıyor: `harita` ya da `benzerlik` |
| `GET /api/goruntu/durum?kamera=uc` | O kameranın kare sayısı ve kalibrasyonu; `hareketli` bayrağı |
| `POST /api/goruntu/coz` | `{damga, esik, kamera}` — `damga` boşsa o kameranın en yeni karesi. Yanıtta `kamera`, `hareketli`, **`mutlak_harita`** ve `yalniz_olcu`. **Sabit kamerada haritası yoksa** `lekeler` ölçü taşır ama `x`/`y` taşımaz ve eşleştirme yapılmaz; **harita varsa** koordinat da eşleştirme de çıkıyor. `kare_mm` haritalıyken `harita: true` ve `kose` (dört köşenin yatak koordinatı) taşıyor — kare haritada dikdörtgen değil, yamuk |
| `GET /api/katmanlar` | Tarla haritasının katman dosyaları (`statik/katmanlar/*.js`), ada göre sıralı. Panel bu listeyi sırayla yüklüyor |
| `GET /api/olcum/konumlu?dakika=1440&azami=400` | Konumu bilinen toprak nemi okumaları — `{ts,x,y,toprak_nem}`. 10 mm'lik hücrelerde en yeni okuma |
| `GET /api/turler` | `{turler, alanlar}`. Türler = katalog (`docs/bitki_turleri.json`, 37 tür) + tür ezmeleri birleşmiş hâli; her tür `ezili: {alan: katalog_degeri}` taşır — boşsa katalogdan hiç sapılmamış demektir. `alanlar` = düzenlenebilir dört alanın başlık/birim/alt/üst tanımı. Katalog dosyası değişmedikçe önbellekten döner; `TUR_YOLU` ile başka bir dosya gösterilebilir |
| `POST /api/turler` | `{slug, alanlar:{spread_mm?, sow_depth_mm?, days_to_harvest?, water_ml_per_day?}}` — **tür düzeyinde** ezme. Katalog dosyasına YAZILMAZ; ezmeler `tur_ezme.json` dosyasında (`TUR_EZME_YOLU`, yoksa `VERI_YOLU`nun klasörü) tutulur. Katalogdakiyle aynı değer ezme sayılmaz, kaydedilmez |
| `DELETE /api/turler?slug=…&alan=…` | `alan` verilirse o alanı, verilmezse türün bütün ezmelerini katalog değerine döndürür |
| `GET /api/dikim` | `{alanlar, azami, en_kucuk_kenar, toprak_z}` — dikim alanları ve ajandan gelen genel toprak yüzeyi |
| `PUT /api/dikim` | `{alanlar:[{ad,x1,y1,x2,y2,toprak_z?}…]}` — doğrulanmış hâli geri döner |
| `POST /api/sulama/onizle` | `{noktalar:[ad…], saniye?}` — sulamayı BAŞLATMADAN nereye gidileceğini döndürür |

### Bahçe modu (kullanıcı katmanı)

Bu uçlar YENİ BİR DEPO AÇMIYOR. Bitkiler nokta deposundan, tür bilgisi
katalogdan, nem sensörden, alanlar dikimden okunuyor; yazma da aynı
yerlere — sulama `/api/toplu`, ekim aynı ekim akışı. Tek yeni kalıcı şey
bitki fotoğraf arşivi (`bahce_arsiv/`), çünkü onun karşılığı başka hiçbir
yerde tutulmuyor.

| Uç | Ne yapar |
|---|---|
| `GET /api/bahce` | Ekranın **bütün** anlık görüntüsü tek çağrıda: `bitkiler` (susama/hasat hâli ve gerekçesi, `su_olcum` = ölçülen nem künyesi, `su_tahmin`, yarıçap, çakışma, film künyesi), `kartlar`, `ertelenmis`, `seri`, `kuyruk`, `ekim`, `turler`, `kamera` (kalibrasyon dâhil), `alanlar`, `sinirlar`, `sulama_basligi`, `bolgeler`, `konum`, `mesgul`, `bagli`. Susama ve hasat hâli **bir kez** hesaplanıp hem bitki listesine hem kartlara veriliyor: kart "4 bitki susadı" diyorsa tahtada tam o dört damla var |
| `POST /api/bahce/is` | `{tip: sula\|ek\|gez\|foto, noktalar:[ad], saniye?}` — kuyruğa koyar ve **hemen döner**. Kullanıcı beklemiyor |
| `POST /api/bahce/is/iptal` | `{kimlik}` ya da `{kimlik:"hepsi"}`. Yalnız BEKLEYEN iş iptal edilir; çalışanı durdurmanın yolu teknik paneldeki Dur |
| `POST /api/bahce/ek` | `{tur, x, y}` ya da `{tur, yerler:[{x,y}]}` — noktayı yaratır (`etiket:"bitki"`, `tur`, `ekim`) ve ekimi kuyruğa koyar. Dikim alanı dışına 422 |
| `POST /api/bahce/hasat` | `{noktalar:[ad]}` — **kayıt işlemi, hareket değil**: makine hasat edemiyor, toplayan kullanıcı. Yeri boşaltır, 30 sn `geri_al` verir. Film SİLİNMEZ |
| `POST /api/bahce/onay` | Bekleyen ekim onayını geçer (`/api/ekim/onayla`ya iletir) |
| `POST /api/bahce/foto` | `{noktalar:[ad]}` — üst kameranın son karesinden şimdi kırpar. Makine hareket etmez. Kalibrasyon yoksa 409 ve **sebebini söyler** |
| `GET /api/bahce/bos-yer?tur=` | Seçilen TÜRE göre boş yer sayısı ve yerleri: `{adet, sinirda, yayilim_mm, hazne, yerler}`. Sayı türün yayılım çapından geliyor — havuç (100 mm) beş, marul (250 mm) sıfır. Yayılımı yazılı olmayan türde 422 |
| `POST /api/bahce/ertele` | `{kimlik}` kartı **yarın 07:00'ye** erteler, `{kimlik, iptal:true}` geri alır. SQLite'ta duruyor: sayfa yenilenince kart geri gelmiyor |
| `POST /api/bahce/esik` | `{turler:[slug], yuzde}` — sulama nem eşiğini bahçeden değiştirir. Yeni bir ayar değil: `turler.kaydet` ile **tür ezmesine** yazıyor. Cevapta `kendi_esigi_olan`: kendi `ozel.sulama_nem_esigi` değeri yüzünden bu yazımdan etkilenmeyen bitkiler |
| `POST /api/bahce/tasi` | `{ad, x, y}` — bitkinin **kaydını** taşır (sürükleyip bırakma). Mevcut kaydı okuyup üstüne yazar: tür, ekim tarihi, sulama damgası ve filmi korunur. Makine HAREKET ETMEZ. Sınırların ya da dikim alanının dışına 422 |
| `POST /api/bahce/yakin` | `{ad}` — robotu bitkinin üstüne gönderen bir ziyaret işini kuyruğa koyar (`gez`, `yakin:true`); panel uç kamerası şeridini kendiliğinden açar |
| `GET /api/bahce/film?kimlik=` | O ekimin arşiv kareleri (`damga`, `ts`, `bayt`). `kimlik` boşsa bütün filmler + toplam bayt |
| `GET /api/bahce/film/kare?kimlik=&damga=` | Tek arşiv karesi (JPEG, bir gün önbelleklenir) |

**Kuyruk** (`sunucu/kuyruk.py`) bellekte duruyor, diske yazılmıyor: sunucu
yeniden başladığında istenmeyen işler saatler sonra yapılmasın. En fazla
40 bekleyen iş, son 12 bitmiş iş ekranda tutuluyor. İşçi döngüsü makine
boşaldıkça (`dizi.calisiyor` yok, hareket yok, ekim oturumu yok) sıradaki
işi `/api/toplu`ya veriyor — yani aynı ön kontrollerden geçiriyor.

**Arşiv** (`sunucu/arsiv.py`): `<veri klasörü>/bahce_arsiv/<nokta>_<ekim
damgası>/<ts>.jpg`. Kırpma penceresi türün OLGUN `spread_mm` değerinin
1.8 katı (90–420 mm arası), çıktı 240×240. Bitki başına en fazla 240 kare,
toplam en fazla 80 MB; aşılırsa en eski kareler silinir. `numpy`/`Pillow`
yoksa arşiv sessizce kapalı kalır, bahçenin geri kalanı çalışır.

`{"tip":"bahce","kuyruk":{…}}` — kuyruk değişince panel soketine düşen
haber. Panelin bahçe ekranı bunu ve `{"tip":"ekim"}`i dinliyor.

### AI HAT (Hailo) — kamera karelerinde tespit

`durum.hailo` = `{aktif, kilitli, sahte, model, islenen, dusen, hatali,
son_sure_ms, son_hata, tespit, tespitler, tespit_ts}`.

**Çıkarım kamera döngüsünün İÇİNDE değil.** Gerekçe gecikme değil —
çıkarım ~7 ms, kamera aralığı saniyeler. Gerekçe **arıza yalıtımı**: bu
donanımın kilitlenebildiği sahada görüldü (`/dev/hailo0` "error 5" ile
açılamaz oldu, sonra sürücü yüklüyken cihaz düğümü hiç oluşmadı). Çıkarım
kamera döngüsünde olsaydı kilitlenen Hailo kamerayı da durdururdu.

Akış: kare çekilir → **sunucuya gider** → sonra kuyruğa bırakılır. Panelin
kare akışı hiçbir koşulda tespiti beklemiyor.

**Kuyruk tek elemanlı** (`maxsize=1`). Normal işleyişte hiç dolmuyor;
tek işi arıza anında tampon olmak ve o anda eski kare değersiz. Doluysa
yeni kare düşüyor, `dusen` artıyor. **`dusen` normal işleyişte sıfır
kalmalı** — sorunu fark etmenin en hızlı yolu bu sayaç. Kare kuyruğa
kopyalanarak giriyor: kamera tamponu yeniden kullanılıyorsa referans
bırakmak, işçinin üstüne yazılan bir kareyi okuması demek olurdu.

**Ölü adam anahtarı.** HailoRT çağrıları C seviyesinde bloke, Python'dan
kesilemiyor; iş parçacığı tek başına hiç dönmeyen bir çağrıyı
kurtarmıyor. Uçuştaki kare `kilit_sn` (varsayılan 30 sn) süresini geçerse
cihaz `kilitli` işaretleniyor, besleme duruyor ve durum panele çıkıyor.
Takılı işçi orada kalıyor (daemon, süreci rehin almıyor), ajanın gerisi
çalışmaya devam ediyor.

**Ardışık hata.** `azami_hata` (varsayılan 5) kez üst üste başarısız
olursa tespit kapanıyor; sıcak döngüde tekrar denemek günlüğü
doldurmaktan başka işe yaramıyor.

**Kendi kendine kurtarma YOK.** `modprobe -r hailo_pci` denendi ve işi
kötüleştirdi: cihaz düğümü kayboldu, geri gelmesi için güç çevrimi
gerekti. Ajan sürücüye asla dokunmuyor; kilitlenince tek söylediği
"Pi'nin yeniden başlatılması gerekiyor".

Model dosyasındaki son ek çipi söylüyor: `_h8` = Hailo-8 (26 TOPS, AI
HAT+), `_h8l` = Hailo-8L (13 TOPS), `_h10` = Hailo-10H (AI HAT+ 2).
Ölçülen: `yolov8s_h8.hef` ile 310 FPS, 6,66 ms gecikme.

`aktif: false` varsayılan — AI HAT'i olmayan kurulumda hiçbir şey
denenmiyor. Kütüphane, HEF ya da cihaz bulunamazsa Hailo kendini kapatıp
sebebi günlüğe yazıyor; **ajan çalışmaya devam ediyor**.

### Sulama ofseti

Bitkinin tam üstüne akıtmak her tür için doğru değil: besleyici kökler
kanopinin kenarında. Ofset **tek bir formülden** çıkıyor —

    ofset = sulama_oran × (bitkinin O ANKİ yarıçapı)

— ve sorulan üç model bunun içinde birer özel hâl, ayrı bir kip anahtarı yok:

| Durum | Ne oluyor |
|---|---|
| Bitkiye `egri_yayilim` bağlı | Yarıçap YAŞA göre; 0. günde gövde, olgunlukta damlama hattı |
| Eğri yok | Yarıçap türün OLGUN `spread_mm`/2'si — oran bir yüzde gibi çalışır |
| Tür düzeyinde ikisi de sabit | Sonuç sabit mm |

Ayrı bir `sabit_mm` terimi **yok**: eğrisiz hâl zaten onu veriyor.

**Eğrisiz hâlin tuzağı:** yayılım eğrisi bağlı değilse fideye ilk günden
olgun bitki mesafesi verilir. Tür formunda alanın altında bu yazıyor ve
önizleme her seferinde `uyari` olarak da bildiriyor.

#### Alanlar (tür şeması, `ozel` ile bitki başına ezilebilir)

| alan | değer | varsayılan |
|---|---|---|
| `sulama_deseni` | `ust` \| `yan` \| `iki` \| `cember` | `ust` |
| `sulama_oran` | 0–1,5 (o anki yarıçapın katı) | 0 |
| `sulama_aci` | 0–359° (makine çerçevesi, 0 = +X) | 0 |
| `sulama_nokta` | 2–8 (yalnız `cember`) | 4 |
| `sulama_aciklik_mm` | 0–300 (kanopinin üstünde) | 50 |
| `sulama_nem_esigi` | 0–100 % (altındaysa sula) | 100 = kapalı |

`sulama_deseni` şemadaki ilk **seçenekli** alan: `turler.alan_dogrula`
sayısal aralık yerine kapalı listeye bakıyor. Öncelik `spread_mm` ile aynı:
`ozel` > tür ezmesi > varsayılan.

**Varsayılan `ust` + oran 0**, yani güncelleme sonrası hiçbir kurulumun
davranışı değişmiyor; sulama eskisi gibi bitkinin tam üstüne akıtıyor.

#### Sulama başlığı kayması

Başlık Z eksenine ayrı takılı ve ucun merkezinden kaymış. `uclar.json`
içinde `sulama_basligi: {dx, dy, z_min}`, `durum.uc.sulama_basligi` ile
yayınlanıyor. Türden **bağımsız**: desen ofsetinin üstüne biniyor.

    makinenin gittiği nokta = suyun düşeceği nokta + (dx, dy)

İki nokta **ayrı denetleniyor** ve bu ayrım önemli:

| nokta | ne | denetim |
|---|---|---|
| `su_x, su_y` | suyun düştüğü yer | **dikim alanı** |
| `x, y` | makinenin gittiği yer | **yumuşak sınır + yasak bölge** (ajanda) |

Tek noktaya bakmak ya suyu kabın dışına döktürür ya da geçerli bir
sulamayı reddeder. Haritada halka suyu, ince daire ucu gösteriyor; ikisi
çizgiyle bağlı, yani kayma gözle görünüyor.

`z_min` mutlak Z tabanı: `sulama_z = kıs(yüzey + boy + açıklık, alt=z_min,
üst=guvenli_z)`. Ölçülen kurulumda yüzey 170 + açıklık 50 = 220 çıkıyor ve
başlık o yükseklikte sürtüyor; taban 230. Tabana çekilme **sessiz değil**,
`uyari` düşüyor.

#### Sulama kararı toprak nemine göre

Tür alanı `sulama_nem_esigi` (%). Toprak nemi bu yüzdenin **altındaysa**
sulanıyor, üstündeyse **atlanıyor** ve o bitki hiç adım üretmiyor.
**100 = nem bakılmaz, her zaman sula** ve varsayılan bu — güncelleme
sonrası hiçbir kurulumun sulaması sessizce durmuyor.

- Kaynak `toprak_nem` (A1'deki prob), **`hava_nem` DEĞİL**. Karışırsa
  yağmurlu bir günde hava nemi yüksek olur ve susuz toprakta sulama
  atlanır. Ayrım koda ve teste açıkça yazılı.
- Karşılaştırma **kalibre yüzde** üzerinden: `(kuru − ham) / (kuru − ıslak)
  × 100`, `durum.toprak_kalib`'den. Ham 0-1023 varsayımı yok — bu makinede
  ıslak uç 593 ölçüldü, ham ölçek %42 derken gerçek %100. Formül yön
  bağımsız, ters bağlanmış probda da doğru. Haritadaki sensör katmanı da
  artık aynı formülü kullanıyor.
- Okuma **100 mm** yarıçapta ve en fazla **24 saatlik** olmalı. Daha
  uzaktaki bir okuma bu bitkinin kökü hakkında bir şey söylemiyor; üç gün
  önceki okuma bugünün kararını veremez.
- **Okuma yoksa SULANIR** ve gerekçesi yazılır. Bitki kaybetmek, su
  israfından kötü; sessizce atlamak "neden kurudu" sorusunu cevapsız
  bırakır.

Önizleme her bitki için `sulanacak`, `nem_yuzde`, `nem_esigi`,
`nem_gerekce` döndürüyor; panel atlananları adıyla ve gerekçesiyle
yazıyor.

#### Desen maliyeti

Bitki başına adım: `ust`/`yan` 4, `iki` 8, `cember` 4N. Asıl bedel adım
sayısı değil, **her fazladan noktanın bir Z çevrimi ödetmesi**. Sulama Z'si
güvenli Z'nin altındaysa nokta başına `2 × (guvenli_z − sulama_z) / hız`
saniye ekleniyor. `programlar.AZAMI_ADIM` aşılırsa dizi hiç başlamıyor.

**Spiral bilerek yok:** değeri akarken hareket etmekte, oysa adım
sözlüğünde (`nokta, bekle, role, uc`) "röle açıkken hareket et" diye bir
şey yok — `nokta` bloke eden bir hareket. Ayrıklaştırılmış spiral, aynı
adım sayısındaki çemberden kesinlikle daha kötü.

#### Z ekseni

    sulama_z = alanın toprak yüzeyi + o anki boy (egri_yukseklik) + açıklık

`guvenli_z` tavanına kısılıyor ve kırpma **sessiz değil**: uç istenen
yükseklikte duramadıysa `uyari` düşüyor. Bitkinin kayıtlı `z`si burada
KULLANILMIYOR — o "bu noktaya gidilirken ucun bulunacağı yükseklik", ekim
derinliği ise türde.

#### Su BÖLÜNÜYOR

Bitkinin ihtiyacı hacim, süre değil (`water_ml_per_day` zaten ml). N
noktalı desende her noktaya `saniye/N` düşüyor, toplam korunuyor. Nokta
başına süre **1 saniyenin** altına inecekse süre kısaltılmıyor, **nokta
sayısı düşürülüyor** ve sebebi bildiriliyor: kısa bir vana darbesinin
büyük kısmı geçici rejim olur ve giden gerçek hacim hesaptan sapar.

#### Denetim sırası

1. **Dikim alanı** — artık bitkinin kendi konumu değil, **ofsetli her
   nokta** denetleniyor. Ret mesajı sebebi ve çözümü birlikte veriyor:
   `X312.4 Y88.0 dikim alanı dışında (0° yönünde 150 mm ofset) — ofset
   yönünü (sulama_aci) çevirin, ofseti (sulama_oran) küçültün ya da bu
   bitkide deseni 'tam üst' yapın`.
2. **Yasak bölge + yumuşak sınır** — `nokta_denetle` komutuyla **ajana
   soruluyor**; sunucu kuralları kopyalamıyor. Karar ajanda kalıyor.
   Amaç 40 bitkilik bir dizinin ortasında çarpıp durmasını önlemek.
3. Biri bile geçmezse dizi **hiç başlamıyor** — kısmi sulama, hangi
   bitkinin sulandığını bilinmez yapardı.

Koordinatlar **sunucuda donuyor** ve diziye mutlak olarak yazılıyor; ajan
hiçbir şey türetmiyor. Ofset yaşa göre değiştiği için bu şart: ajan kendi
hesaplasaydı panelin önizlemede gösterdiği nokta ile robotun gittiği nokta
ayrışabilirdi.

`POST /api/sulama/onizle` → `{ozet:[{ad,desen,ofset_mm,yuzey_z,boy_mm,
egriden,noktalar:[{x,y,z,saniye,aci}],ret,uyari}], ret, uyari, adim,
toplam_nokta, toplam_saniye, azami_adim}`. Panelde "Sulama noktaları"
katmanı (varsayılan kapalı) bu yanıtı çiziyor.

### Dikim alanları

Yatakta toprağın **gerçekten** bulunduğu dikdörtgenler. Makinede iki ayrı kap
var ve aralarında boşluk bulunuyor; panel şimdiye kadar yatağın tamamını
toprak sayıyordu ve sahnede "buraya bir marul koyalım" dediğimiz nokta
makinede havaya denk gelebiliyordu.

- **Alan tanımlı değilse eski davranış sürüyor**: yatağın tamamı ekilebilir.
  Boş liste hiçbir zaman "hiçbir yere ekilemez" anlamına gelmiyor, yoksa
  güncelleme mevcut kurulumları bozardı.
- `POST /api/noktalar` yalnız `etiket: "bitki"` olan noktayı denetliyor ve
  alan dışına düşeni **422** ile reddediyor; gerekçe koordinatı ve tanımlı
  alanları yazıyor. Uç yuvası, kalibrasyon ve gezinti noktaları toprağın
  dışında olabilir, onlar denetlenmiyor.
- `POST /api/toplu` `islem:"sula"` seçimde alan dışına düşen bir nokta varsa
  **422** döner ve dizi hiç başlamaz — su, toprağın olmadığı yere
  dökülmesin. `gez` denetlenmiyor.
- Köşeler kaydederken sıralanıyor (`x1 < x2`): sağdan sola çizilen bir
  dikdörtgen sessizce "her nokta dışarıda" derdi. Kenar en az 5 mm, en fazla
  24 alan, aynı ad iki kez olamaz.
- `toprak_z` alan başına **isteğe bağlı**: girilmemişse ajanın genel
  `plc.toprak_z` değeri geçerli. Kaplar aynı hizada değilse burada ayrışıyor;
  ekim derinliği ve uç açıklığı bu yüzeyden hesaplanıyor.
- `POST /api/izgara/onizle` yanıtında `alan_disi` var ama **reddetmiyor**:
  ızgara noktaları `ızgara` etiketli, ille de bitki değil.

Alanlar **ajanda değil sunucuda** duruyor (`sunucu/dikim.py`). Yasak bölgeler
güvenlik kararı olduğu için ajanda; dikim alanı veri geçerliliği kararı ve
ajan kopukken de işlemesi gerekiyor — ekim planı çoğu zaman robot kapalıyken
yapılıyor. Robotun hareketini hâlâ ajan sınırlıyor (yumuşak sınırlar + yasak
bölgeler); bu dosya oraya karışmıyor.

### `POST /api/toplu?jeton=PAROLA`

Haritada seçilmiş noktalara toplu işlem. Gövde:

```json
{"islem": "sula", "noktalar": ["fide-1", "fide-2"], "saniye": 3}
```

| `islem` | Ne yapar |
|---|---|
| `sil` | Noktaları depodan siler. Yanıt: `{"ok": true, "silinen": [...]}` |
| `gez` | Sırayla her noktaya gider |
| `sula` | Her noktaya gidip su vanasını `saniye` kadar açar |
| `ek` | Seçimdeki BİTKİLERİ eker. Türü yazılı olmayan noktalar **atlanır**, ekimi durdurmazlar (bitkiler ve çıplak noktalar aynı depoda; kutu seçimi ikisini birden alıyor). Kaç tanesinin atlandığı `/api/ekim/onizle` yanıtındaki `atlanan_sayisi` ve oturumun `atlanan` alanında yazıyor. Seçimde tür yazılı **hiç** bitki yoksa `422` |

Sınırlar — ikisi de sunucuda zorlanıyor, panelden gelen değere güvenilmiyor:

* **En fazla 40 nokta.** Üstü hem dizi adım sınırını (200) zorlar hem de
  yanlışlıkla yapılmış bir seçimi tehlikeli hâle getirir. Aşılırsa `400`.
* **`saniye` 1-60 arasına kırpılır** (varsayılan 3).

`gez` ve `sula` tek tek hareket komutu göndermez: sunucu, kayıtlı dizilerin
kullandığı **aynı denetimli adım tipleriyle** geçici bir dizi kurup ajanın
olagan yürütücüsüne verir. Yani yumuşak sınırlar, Z kilidi, yasak bölgeler ve
acil durdurma mandalı toplu işlemde de aynen geçerli.

### `WS /ws/panel?jeton=PAROLA`
Canlı akış. Bağlanınca ilk paket anlık görüntü, sonrası olay bazlı:

| `tip` | İçerik |
|---|---|
| `anlik` | `{durum, olcum}` — ilk paket |
| `olcum` | `{veri: {...}}` — yeni sensör okuması |
| `durum` | `{durum: {...}}` — konum, bağlantı, acil durum değişimi |
| `gunluk` | `{seviye, metin}` — olay günlüğü satırı |
| `kare` | `{ts, kamera}` — o kameradan yeni kare var; görüntü `GET /api/kare/son?kamera=…` ile alınır |
| `canli` | `{ts, kamera}` — canlı akıştan yeni kare; `GET /api/kare/canli?kamera=…` |

**UÇ DEĞİŞTİRME KALKTI.** Z ekseninin ucunda üç baş kalıcı olarak vidalı
(sulama başlığı, nem probu, tohum ucu); alınıp bırakılan bir uç yok. Şunlar
kaldırıldı: `uc_al` / `uc_birak` / `uc_degistir` / `uc_beyan` / `uc_onizle` /
`uc_yollari` / `uc_durum_temizle` komutları, `uc` adım tipi, uç yuvaları
(`tools`, `tools_konum`), uç değiştirme alanı (`tc_area`), kilit servosu
(`lock_reg`), varlık sensörü (`presence_reg`), uç teyidi (`onay_uc`),
birinci onay (`onay1`) ve `uclar_sabit` / `uc_adi` / `bitince_birak`
ayarları. Ekim akışı doğrudan `hazne` ile başlıyor. `onay2` ("tohum ucta
mı") kalıyor — o vakumu soruyor, uç değiştirmeyi değil.

**BAŞ BAŞINA KAYMA.** Üçü aynı anda takılı olduğu için hiçbiri Z'nin
merkezinde değil; makine `hedef + o başın kayması`na gidiyor. `durum.uc.baslar`
üç başı taşıyor (`dx`, `dy`, `z_min`, `derinlik_mm`, tohum ucunda ayrıca
`t_asagi_mm`) ve `GET /api/bahce` her başın **erişebildiği** dikdörtgenini
de veriyor. Adımlar hem MAKİNE koordinatını (`x`/`y`) hem İŞ koordinatını
(`is_x`/`is_y`) taşıyor: dikim alanı ve yasak bölge denetimi işin yerine,
yumuşak sınır denetimi makinenin yerine bakıyor.

**TOHUM UCUNUN KENDİ DİKEY EKSENİ** (`durum.tohum_ucu`, PLC'de j4, kodda T):
`{kalibre, mm, yukari_mm, yukarida}`. Kalibrasyon `gantry_calib.json`ın
dördüncü satırında (bu makinede `cpm 87 · dir +1 · home 0 · 0–55`) ve
panelin kalibrasyon tablosunda T satırı olarak görünüyor; `cpm` sıfırsa
eksen kilitli ve her hareket sebebiyle reddediliyor. "Yukarı" ucu
`home` sayılıyor, `baslar.tohum.t_yukari_mm` ile eziliyor. **Uç
aşağıdayken X/Y hareketi yapılmıyor** — jog, koordinat hareketi ve dizi
adımı, üçü de reddediyor; Z serbest kalıyor (kaçış yolu).

**`POST /api/toplu` `{"islem":"nem","noktalar":[…]}`** — nem probunu
bitkilerin üstüne götürüp toprağa daldırıyor ve okunan değeri **o bitkiye**
yazıyor (`nem_yuzde`, `nem_ham`, `nem_ts`). Bahçe kartı önce bu ölçüme
bakıyor ("kendi üstünden"), yoksa 100 mm yarıçaptaki en taze okumaya düşüyor.
Bahçe kuyruğunda `tip: "nem"` olarak da veriliyor.

`durum` paketine eklenen alanlar: `bolgeler`, `esnetme_acik`, `islem`,
`uc` (üç baş + tohumluk), `tohum_ucu` (T ekseni), `dizi` (program ilerlemesi),
`kameralar` (sıralı kamera künyeleri: `ad`, `etiket`, `hareketli`, `cihaz`,
`acik`, `aktif`, `yontem`, `aralik_sn`, `canli`, `canli_var`, `hata`).
`kamera` tekili hâlâ var ve ilk kameranın hâlini taşıyor — tek kameraya göre
yazılmış çağrı yerleri bozulmasın diye.

`canli_var` "bu kamera canlı akış yapabiliyor mu" demek; `fswebcam` yolunda
akış yok. Panel bu bayrak yanlışken "Canlı" düğmesini kapatıyor: basıp hata
almak, sebebini önceden söylemekten kötü.

Panelin Kamera sekmesi açılırken her kamera için
`{"ad": "kamera", "arg": {"kamera": "ust", "canli": true, "fps": 5}}`,
sekmeden çıkarken aynısını `"canli": false` ile yolluyor. Canlı kareler
**diske yazılmıyor**, sunucunun belleğinde kamera başına son kare olarak
duruyor (`GET /api/kare/canli?kamera=…`); aralıklı kareler diskteki halkaya
gitmeye devam ediyor ve canlı açıkken aralıklı döngü duruyor.

İstemciden gönderilebilen tek mesaj basılı-tut jog'u:

```json
{"tip": "jog", "eksen": "x", "yon": 1, "basili": true}
```

Bırakınca `{"tip": "jog", "hepsi_dur": true}`.

## Kanallar

| Alan | Kaynak | Birim |
|---|---|---|
| `hava_sicaklik` | DHT11 | °C |
| `hava_nem` | DHT11 | % |
| `bmp_sicaklik` | BMP180 | °C |
| `basinc` | BMP180 | hPa |
| `rakim` | BMP180 | m |
| `toprak_nem` | tool ucundaki prob (A1) | **ham ADC 0–1023**, kuruyken ~1023 |

Ayrıca ölçüm satırında rölelerin gerçek durumu (`r_su_pompasi`,
`r_hava_pompasi`; 0/1) ve kartın çalışma süresi (`calisma_sn`) geliyor.
Süre geriye giderse kart yeniden başlamış, yani röleler kapanmıştır.

`toprak_nem` ham geliyor. Yüzdeye çevirmek arayüzün işi ve **ölçek
0–1023 değil**: gerçek prob suda sıfır okumuyor. Ajan `durum` paketinde
`toprak_kalib: {kuru, islak}` gönderiyor; çevirim

    yuzde = (kuru - ham) / (kuru - islak) * 100      # 0..100 arasına kırpın

Kalibrasyon `ajan/ayarlar.json` → `arduino.toprak_kuru` / `toprak_islak`
altında; ölçmek için `toprak-kalibre.py`. Ham değeri de gösterin, ters okuma
(kurudukça yükselen sayı) karışıklık yaratıyor.

### Değerler ajanda düzeltiliyor

Yukarıdaki kanallar **ham okuma değil**. Ajan (`ajan/arduino.py`,
`Duzeltici`) veriyi sunucuya göndermeden önce üç iş yapıyor:

1. **Saçma okumayı atıyor.** DHT11 okuyamadığında 0/0 ya da 255 basıyor;
   bu değerler ölçüm değil arıza deseni ve hiç kaydedilmiyor (kanal
   `null` gider, satırın geri kalanı kaydedilir; hiçbir kanal kalmazsa
   satır hiç üretilmez).
2. **Çözünürlüğe yuvarlıyor.** DHT11 tam sayı üretir — 26,3 °C yazmak
   sensörün yapmadığı bir hassasiyeti uydurmaktır. Adımlar: DHT11 1 °C /
   %1 (DHT22 takılıysa 0,1), BMP180 0,1 °C ve 0,1 hPa, rakım 1 m, toprak
   probu 1 sayım.
3. **Medyan alıyor.** Son N örneğin ortancası (varsayılan N=5, ayarda
   `arduino.medyan_pencere`). Ortalama değil: tek tük sıçrama ortalamayı
   çeker, medyan görmez. Rölelerin durumu bu yoldan HİÇ geçmiyor: o bir
   ölçüm değil, kartın bildirdiği kesin durum.

Düzeltme **ajanda**, çünkü veritabanına baştan temiz veri girsin ve
geçmiş de doğru olsun. Sunucuda yapılsaydı kayıt kirli kalır, panelde
yapılsaydı her istemci başka sayı gösterebilirdi.

Ham okuma atılmıyor: canlı paketlerde `olcum.ham` alanında geliyor ve
panel kartların altındaki küçük yazıda gösteriyor. `ham` **kaydedilmiyor**
— veritabanındaki değer düzeltilmiş olan.

Veri 7 gün saklanıp budanıyor.

## Dikkat

* **Güvenlik kararları arayüzde değil.** Yumuşak sınırlar, Z kilidi, jog
  kirası ve acil durdurma mandalı ajanda. Arayüz sınır denetimi yapmasa da
  makine korunur; ama kullanıcıya sınır dışı hedefi baştan göstermek daha iyi
  (`durum.sinirlar`).
* **Jog mandallıdır.** Basılı tutuldukça yenilenmezse ajandaki bekçi 1,2
  saniyede ekseni durdurur. Arayüz düğme basılıyken saniyede 3-4 kez `jog`
  mesajı yollamalı.
* **Aynı anda tek yazıcı.** Bu API'yi kullanan kaç arayüz olursa olsun sorun
  yok; ama PLC'ye yazan ikinci bir program (Gantry Studio, eski `farmbot-agent`
  servisi) çalışmamalı.
