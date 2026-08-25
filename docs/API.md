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
| Tailscale (ev dışı, telefon) | `http://100.99.57.110:8000` |

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
    "bagli": true, "kip": "oto",
    "konum": {"x": 120.0, "y": 80.0, "z": 340.0},
    "plc": "bagli", "enable": true, "hareket": false, "jog": [],
    "z_guvenli": true, "guvenli_z": 340.0,
    "acil": {"acik": false, "saat": "", "neden": ""},
    "sinirlar": {"x": {"min": 0, "max": 425},
                 "y": {"min": 0, "max": 600},
                 "z": {"min": 0, "max": 550}},
    "hiz": 20.0, "hata": null, "arduino": true,
    "sunucu_saati": 1787496298.5
  },
  "olcum": {
    "hava_nem": 45.3, "hava_sicaklik": 26.3,
    "bmp_sicaklik": 27.1, "basinc": 1009.24, "rakim": 119.9,
    "toprak_nem": 350, "servo_aci": 0.0,
    "kip": "oto", "ts": 1787496298.07
  },
  "panel_kilitli": true
}
```

`ajan_bagli` / `durum.bagli` false ise `olcum` eski veri olabilir; `ts`
alanına bakın.

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
| `servo` | `{"aci": 90}` |
| `kip` | `{"deger": "oto"}` ya da `"manuel"` |
| `role` | `{"ad": "su_pompasi", "durum": true}` — `hava_pompasi`, `su_vanasi` |
| `jog` / `jog_dur` | REST yerine WebSocket'ten gönderin (aşağı bakın) |
| `bolge_listele` | `{}` — ajandaki yasak bölgeler |
| `bolge_kaydet` | `{"bolgeler":[{ad,x1,y1,x2,y2,izin_kosulu,yuva,aktif}]}` |
| `uc_listele` | `{}` — uç ayarları ve dizi durumu |
| `uc_kaydet` | `{"ayar": {...}}` — `gantry_tools.json` yapısı |
| `uc_al` / `uc_degistir` | `{"ad":"tool1"}` — yandan yaklaşımlı dizi |
| `uc_birak` | `{}` |
| `dizi_baslat` | `{"ad":…,"adimlar":[…],"tekrar":1}` — adımlar ÇÖZÜLMÜŞ olmalı |
| `dizi_durdur` | `{}` — sert duruş, hedefleri nötrler |
| `oto_esik` | `{"ham":600}` — otomatik sulama eşiği (HW-103 ham ADC, 0–1023). Panel yüzdeyi hama çevirir |
| `oto_cikis` | `{"ad":"yok"\|"servo"\|"su_vanasi"\|"su_pompasi"}` — otomatik kipte sürülecek çıkış |

### Nokta deposu, ızgara, programlar, kamera (ajana gitmeyen uçlar)

| Uç | Ne yapar |
|---|---|
| `GET /api/noktalar` | Kayıtlı noktalar |
| `POST /api/noktalar` | `{ad,x,y,z,ustune_yaz}` — aynı isim 409 döner. `tur` ve `ekim` alanları verilirse nokta bir **bitki** olur (tarla tasarımcısı bunu kullanıyor). `ozel: {alan: sayı}` **tek bitki düzeyinde** ezme: yalnız o bitkiyi etkiler, türün geri kalanı katalogdaki değerde kalır. Aralık dışı bir alan sessizce atılır, kaydın tamamı reddedilmez. `ustune_yaz` bütün kaydı değiştirdiği için gönderilmeyen alan silinir — panel her yazmada `egri_*` ve `ozel` alanlarını da yollar |
| `DELETE /api/noktalar?ad=…` | Siler |
| `POST /api/toplu` | Haritada seçilen noktalara toplu işlem: `{islem:"sil"\|"sula"\|"gez", noktalar:[ad…], saniye?}`. `sil` doğrudan depodan siler; `sula` ve `gez` adım listesini **sunucuda** kurup ajanın olağan dizi yoluna verir — panel tek tek hareket komutu göndermiyor, sıralama ve güvenlik denetimi ajanda kalıyor. Tek seferde en fazla **40** nokta; bir nokta çözülemezse dizi hiç başlamaz |
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
| `toprak_nem` | HW-103 | **ham ADC 0–1023**, kuruyken ~1023 |
| `servo_aci` | SG-5010 | derece |

`toprak_nem` ham geliyor. Yüzdeye çevirmek arayüzün işi:
`yuzde = (1023 - ham) / 1023 * 100`. Ham değeri de gösterin, ters okuma
karışıklık yaratıyor.

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
