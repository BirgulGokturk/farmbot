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

### `WS /ws/panel?jeton=PAROLA`
Canlı akış. Bağlanınca ilk paket anlık görüntü, sonrası olay bazlı:

| `tip` | İçerik |
|---|---|
| `anlik` | `{durum, olcum}` — ilk paket |
| `olcum` | `{veri: {...}}` — yeni sensör okuması |
| `durum` | `{durum: {...}}` — konum, bağlantı, acil durum değişimi |
| `gunluk` | `{seviye, metin}` — olay günlüğü satırı |

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
