# Farmbot — akıllı tarım robotu paneli

Bu ilk sürüm bilerek küçük tutuldu: **hareket ettirme** ve **sensör grafikleri**.
Çalıştığını gördükten sonra üzerine ekleme yapacağız.

```
Arduino ──USB seri──> Raspberry Pi ──ev ağı──> tarayıcı
   sensörler            ajan + sunucu
   servo, röleler       (FastAPI + SQLite)
                             │
                             └── Modbus TCP ──> PLC (X / Y / Z hareketi)
```

> ⚠️ **Tek yazıcı kuralı.** Ajan çalışırken PLC'ye başka hiçbir program
> yazmamalı. `gantry_studio.py` aynı register'lara yazıyor; ikisi birlikte
> çalışırsa komutlar çakışır. Ajanı başlatmadan önce Gantry Studio'yu kapatın.
> Register haritası ve güvenlik mantığı zaten ondan alındı.

Üç parça var, üçü de tek başına anlaşılabilir:

| Klasör | Ne yapar | Nerede çalışır |
|---|---|---|
| `sunucu/` | WebSocket köprüsü + ölçüm geçmişi + web arayüzü | Raspberry Pi |
| `ajan/` | Arduino'yu okur, PLC'ye yazar, buluta bağlanır | Raspberry Pi |
| `firmware/` | Sensör okuma + otonom vana kararı | Arduino |

**Neden karar mekanizması Arduino'da?** Pi ya da ağ giderse makinenin doğru
davranmaya devam etmesi gerekiyor. Panel yalnızca gösteriyor ve komut
iletiyor; hiçbir güvenlik kararı orada değil.

---

## 1. Sunucu — Raspberry Pi'nin kendisinde

Sunucu ve ajan aynı Pi'de çalışır, bulut sunucusuna gerek yoktur. Pi zaten
robot için 7/24 açık olmak zorunda; köprü işini de o görüyor. Kazancı: uyku
yok, ücret yok, ölçüm geçmişi SD kartta kalıcı.

Pi'de:

```bash
git clone <deponuz> ~/farmbot && cd ~/farmbot
bash pi-kur.sh
```

Betik iki sanal ortamı kurar, `AJAN_JETONU`'nu rastgele üretir, panel
parolasını sorar (yazarken ekranda görünmez), `ajan/ayarlar.json`'ı doldurur
ve iki systemd servisini yazar. Tekrar çalıştırılabilir: var olan jetonu ve
donanım ayarlarını bozmaz.

Sonra servisleri başlatın:

```bash
sudo systemctl enable --now farmbot-sunucu
sudo systemctl enable --now farmbot-ajan
```

Panel `http://<pi-ip>:8000` adresinde, ev ağındaki her cihazdan açılır.

Gizli değerler `sunucu/ortam` dosyasında durur — yalnızca sahibi okuyabilir ve
`.gitignore`'da olduğu için depoya gitmez:

| Değişken | Anlamı |
|---|---|
| `AJAN_JETONU` | Ajanın sunucuya kimliği. `pi-kur.sh` üretir; `ayarlar.json`daki `jeton` ile aynıdır. |
| `PANEL_PAROLA` | Doluysa panel parola sorar. Paneli ev ağı dışına açacaksanız zorunlu sayın. |
| `VERI_YOLU` | SQLite dosyasının yeri: `~/farmbot-veri/farmbot.db`. |

**Evin dışından erişim.** Panel varsayılan olarak yalnız yerel ağdan görünür;
en güvenli hâli budur. Dışarıdan girmeniz gerekiyorsa modeme port açmayın —
Tailscale kurun. Pi'ye ve telefonunuza kurulur, panel özel bir ağ üzerinden
açılır, adres internete hiç çıkmaz. Herkese açık bir link şartsa Tailscale
Funnel onu da veriyor.

## 2. Arduino

`firmware/farmbot_sensors/farmbot_sensors.ino` — senin sketch'inin üzerine
kurulu. Kütüphaneler: *Adafruit BMP085*, *DHT sensor library*, *Adafruit
Unified Sensor*.

Eklenenler:

* `VERI:{...}` satırı — ajan yalnızca bunu okur, Türkçe satırlar durduğu için
  Seri Monitör'den izlemeye devam edebilirsin.
* Seri komutlar: `AC`, `KAPA`, `SERVO 45`, `AUTO`, `MANUEL`, `OKU`,
  `ROLE su_pompasi 1`.
* Röle pinleri: D4 su pompası, D5 hava pompası, D6 su vanası. Röle kartın
  "aktif yüksek" ise `#define ROLE_AKTIF_LOW 0` yap.
* Barometre bulunamazsa sistem artık durmuyor; o kanal `null` gidiyor,
  diğer sensörler çalışmaya devam ediyor.

Bağlantılar (Uno): BMP180 `SDA→A4, SCL→A5, VCC→3.3V` · DHT11 `DATA→D2` ·
HW-103 `A0` · Servo `D9`.

## 3. Ajan — elle kurulum

`pi-kur.sh` bunların hepsini zaten yapıyor. Bu bölüm ne yaptığını görmek ya da
tek tek denemek isteyenler için:

```bash
sudo apt install -y python3-venv
git clone <deponuz> ~/farmbot && cd ~/farmbot/ajan
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp ayarlar.ornek.json ayarlar.json && nano ayarlar.json
sudo usermod -aG dialout $USER      # seri port izni — sonra yeniden başlat
.venv/bin/python ajan.py ayarlar.json
```

Canlı günlük: `journalctl -u farmbot-ajan -f`

### ayarlar.json'da doldurulacaklar

* `sunucu` — sunucu aynı Pi'de olduğu için `ws://127.0.0.1:8000/ws/ajan`
* `jeton` — `sunucu/ortam` dosyasındaki `AJAN_JETONU` ile birebir aynı
  (`pi-kur.sh` ikisini de kendisi yazar)
* `arduino.port` — genelde `/dev/ttyUSB0` (klon kartlar) ya da `/dev/ttyACM0`.
  `ls /dev/tty*` ile Arduino'yu takıp çıkararak bulabilirsin.
* `plc.ip` / `plc.port` — Modbus TCP adresi (Gantry Studio'daki değer:
  `192.168.1.88:502`, unit 1).
* `plc.guvenli_z` — X/Y hareketi için Z'nin olması gereken en düşük yükseklik
  (komisyonlanmış değer 340 mm).
* `gantry_calib.json` — eksen kalibrasyonu, Gantry Studio'nun kendi dosyası.
  Depoda makinenden gelen değerlerle duruyor; Pi'de yenisi varsa üzerine
  kopyalayın.

### PLC ile konuşma — bilinmesi gerekenler

Register haritası `ajan/plc.py` içinde, `gantry_studio.py`den birebir alındı
(X=Axis_1, Y=Axis_2, Z=Axis_3; enable 1010, X hedef 1024, X konum 1026 …).

| Konu | Nasıl |
|---|---|
| Sayı biçimi | 32 bit IEEE **float**, iki register, **düşük kelime önce** |
| Birim | count. `raw = dir × (mm − home) × cpm` |
| Hareket | hedef yaz → `go` = 1 → 0.12 sn → `go` = 0 |
| Jog | `jogf` / `jogb` **mandal** — 1 yazılınca durmaz, 0 yazılana kadar gider |
| Referans | `home` = 1 → 0.2 sn → `home` = 0 |
| Enable | register 1010 |

Kalibrasyon değerleri (`gantry_calib.json`):

| Eksen | cpm | dir | home | sınırlar |
|---|---|---|---|---|
| X | 7.0 | +1 | 0 mm | 0 – 425 mm |
| Y | 2.2746 | +1 | 0 mm | 0 – 600 mm |
| Z | 56.8376 | **−1** | **438 mm** | 0 – 550 mm |

### Güvenlik — dört kural, hepsi ajanda

1. **Yumuşak sınırlar.** Hedef PLC'ye gitmeden denetlenir. PLC sizi durdurmaz;
   sınır dışı hedef fiziksel çarpma demektir.
2. **Z kilidi.** Z 340 mm'nin altındayken X/Y hareketi reddedilir. Kontrol jog
   yenilemelerinin her birinde tekrarlanır: jog sırasında Z düşerse hareket
   kendiliğinden durur.
3. **Jog kirası.** Jog bitleri mandal olduğu için panel basılı tuttukça
   yeniliyor; yenileme kesilirse ajandaki bekçi 1,2 saniyede biti düşürür.
   Tarayıcı kapansa, telefon kilitlense, internet gitse de eksen durur.
4. **Acil durdurma mandallı.** Enable'ı kesmek yetmez — PLC'nin hedef
   register'ı son komutu tutmaya devam eder ve yeniden enable verildiğinde
   sürücü yarım kalan hareketi sürdürür. Bu yüzden acil durdurma her eksenin
   hedefini bulunduğu yere çeker ve panel "temizle" demeden hiçbir hareket
   komutu geçmez.

Hareket asla çapraz değil: sıra **Z → Y → X**, her eksen bitmeden diğeri
başlamıyor. X/Y yer değiştirecekse Z önce güvenli yüksekliğe çıkıyor.

### Donanım olmadan denemek

`ayarlar.json` içinde `"sahte": true` yapın (hem `arduino` hem `plc` için).

Sahte PLC üst seviyeyi değil **register davranışını** taklit ediyor: aynı
float çiftleri, aynı go/home mandalları, aynı jog bitleri. Yani sınır
denetimi, Z kilidi, jog kirası ve acil durdurmanın hedef nötrleme mantığı
simülasyonda da gerçekten çalışıyor — sahada ilk kez denenmiş olmuyor.
(Bu yaklaşım daha yazarken bir hata yakaladı: hedef register'ı canlı takip
etmeyen ilk sürümde acil durdurma sonrası makine eski hedefine devam
ediyordu.)

---

## Panel

* **Panel** — anlık değerler, 4 grafik, zaman aralığı seçimi (15 dk → 7 gün).
* **Kontrol** — jog paneli, konuma git, hız, sürücü aç/kapa, servo, kip,
  röleler.
* **Tablo** — aynı verinin sayı hâli; grafik okuyamadığınız durumlar için.

Jog düğmeleri **basılı tutuldukça** hareket eder (makinedeki gerçek davranış),
bırakınca durur. Ok tuşları da aynı şekilde çalışır: `←→` X, `↑↓` Y,
`PageUp/PageDown` Z, **boşluk** acil durdurma. Jog yenilemeleri WebSocket'ten
gidiyor — saniyede birkaç HTTP isteği hem yavaş hem gereksizdi.

Toprak nemi panelde **yüzde** gösteriliyor. HW-103 kuruyken ~1023, ıslakken ~0
okuyor; ham sayıyı göstermek "nem arttıkça değer düşüyor" gibi tersine bir
okuma yaratıyordu. Ham değer kartın altında ayrıca yazıyor.

## Komut protokolü (ileride eklemek için)

Panel → sunucu: `POST /api/komut` `{"ad": "...", "arg": {...}}`
Sunucu → ajan (WebSocket): `{"tip":"komut","id":"...","ad":"...","arg":{...}}`
Ajan → sunucu: `{"tip":"sonuc","id":"...","ok":true,"mesaj":"..."}`

Tanımlı komutlar: `jog`, `jog_dur`, `git`, `home`, `dur`, `acil`,
`acil_temizle`, `enable`, `hiz`, `servo`, `kip`, `role`.

İstisna: `jog` ve `jog_dur` panel WebSocket'inden geçiyor ve yanıt
beklenmiyor — saniyede 3-4 yenileme için gidiş-dönüş beklemek gecikme yaratır.
Güvenlik yanıta değil, ajandaki kira bekçisine dayanıyor.

Yeni komut eklemek için üç yer: `sunucu/main.py → IZINLI_KOMUTLAR`,
`ajan/ajan.py → komut_isle`, arayüzde bir düğme.

## Sırada ne var (bunlar çalışınca)

1. Nokta/bitki haritası ve "şu noktaya git" dizileri (Gantry Studio'daki
   `gantry_store.json` ve fide ızgarası buraya taşınabilir)
2. Uç değiştirme dizisi (yan yaklaşımlı kilit) — en riskli parça, en son
3. Zamanlanmış sulama (eşik + saat kuralları)
4. Kamera görüntüsü ve uyarı kuralları

---

## Ek — bulutta barındırmak (Render)

Sunucuyu Pi yerine bulutta çalıştırmak isterseniz `render.yaml` duruyor:
Render → **New → Blueprint** → depoyu seçin. Ortam değişkenleri aynı
(`AJAN_JETONU` otomatik üretilir, `PANEL_PAROLA`'yı elle girersiniz), tek fark
`ayarlar.json`daki adresin `wss://<render-adresiniz>/ws/ajan` olması.

Ücretsiz planın iki bedeli var: servis 15 dakika trafik almazsa uykuya dalar
ve kalıcı disk olmadığı için **her dağıtımda ölçüm geçmişi sıfırlanır**. Canlı
veri ve kontrol etkilenmez. Geçmiş sizin için önemliyse Pi'de barındırmak hem
ücretsiz hem kalıcıdır.
