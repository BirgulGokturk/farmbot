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
                 "y": {"min": 0, "max": 600},
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
| `uc_listele` | `{}` — uç ayarları ve dizi durumu |
| `uc_kaydet` | `{"ayar": {...}}` — `gantry_tools.json` yapısı |
| `uc_al` / `uc_degistir` | `{"ad":"tool1"}` — yandan yaklaşımlı dizi |
| `uc_birak` | `{}` |
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
| `GET /api/kare/son` | Son kamera karesi (JPEG) |
| `GET /api/kare/liste` | Saklanan karelerin damgaları ve **çekildikleri konum** (`x`, `y`; eski karelerde `null`) |
| `GET /api/kare/<damga>` | Tek kare, JPEG |
| `GET /api/katmanlar` | Tarla haritasının katman dosyaları (`statik/katmanlar/*.js`), ada göre sıralı. Panel bu listeyi sırayla yüklüyor |
| `GET /api/olcum/konumlu?dakika=1440&azami=400` | Konumu bilinen toprak nemi okumaları — `{ts,x,y,toprak_nem}`. 10 mm'lik hücrelerde en yeni okuma |
| `GET /api/turler` | `{turler, alanlar}`. Türler = katalog (`docs/bitki_turleri.json`, 37 tür) + tür ezmeleri birleşmiş hâli; her tür `ezili: {alan: katalog_degeri}` taşır — boşsa katalogdan hiç sapılmamış demektir. `alanlar` = düzenlenebilir dört alanın başlık/birim/alt/üst tanımı. Katalog dosyası değişmedikçe önbellekten döner; `TUR_YOLU` ile başka bir dosya gösterilebilir |
| `POST /api/turler` | `{slug, alanlar:{spread_mm?, sow_depth_mm?, days_to_harvest?, water_ml_per_day?}}` — **tür düzeyinde** ezme. Katalog dosyasına YAZILMAZ; ezmeler `tur_ezme.json` dosyasında (`TUR_EZME_YOLU`, yoksa `VERI_YOLU`nun klasörü) tutulur. Katalogdakiyle aynı değer ezme sayılmaz, kaydedilmez |
| `DELETE /api/turler?slug=…&alan=…` | `alan` verilirse o alanı, verilmezse türün bütün ezmelerini katalog değerine döndürür |
| `GET /api/dikim` | `{alanlar, azami, en_kucuk_kenar, toprak_z}` — dikim alanları ve ajandan gelen genel toprak yüzeyi |
| `PUT /api/dikim` | `{alanlar:[{ad,x1,y1,x2,y2,toprak_z?}…]}` — doğrulanmış hâli geri döner |
| `POST /api/sulama/onizle` | `{noktalar:[ad…], saniye?}` — sulamayı BAŞLATMADAN nereye gidileceğini döndürür |

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

`sulama_deseni` şemadaki ilk **seçenekli** alan: `turler.alan_dogrula`
sayısal aralık yerine kapalı listeye bakıyor. Öncelik `spread_mm` ile aynı:
`ozel` > tür ezmesi > varsayılan.

**Varsayılan `ust` + oran 0**, yani güncelleme sonrası hiçbir kurulumun
davranışı değişmiyor; sulama eskisi gibi bitkinin tam üstüne akıtıyor.

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
| `kare` | `{ts}` — yeni kamera karesi var; görüntü `GET /api/kare/son` ile alınır |

`durum` paketine eklenen alanlar: `bolgeler`, `esnetme_acik`, `islem`,
`uc` (dizi ilerlemesi + takılı uç), `dizi` (program ilerlemesi).

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
