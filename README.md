# Tarım Robotu — akıllı tarım robotu paneli

Bu ilk sürüm bilerek küçük tutuldu: **hareket ettirme** ve **sensör grafikleri**.
Çalıştığını gördükten sonra üzerine ekleme yapacağız.

```
Arduino ──USB seri──> Raspberry Pi ──ev ağı──> tarayıcı
   sensörler            ajan + sunucu
   iki röle             (FastAPI + SQLite)
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
* Seri komutlar: `ROLE su_pompasi 1`, `ROLE hava_pompasi 0`, `KAPAT`, `OKU`.
  Hepsi bu — kart karar vermiyor, eşik tutmuyor, hiçbir şeyi hatırlamıyor.
* Röle pinleri: D7 su pompası, D8 hava pompası. Röle kartın "aktif yüksek"
  ise `#define ROLE_AKTIF_LOW 0` yap.
* Kart rölelerin GERÇEK durumunu (`r_su_pompasi`, `r_hava_pompasi`) ve kendi
  çalışma süresini bildiriyor; panel tahmin etmiyor. Süre geriye giderse kart
  yeniden başlamış, yani röleler kapanmış demektir.
* Barometre bulunamazsa sistem artık durmuyor; o kanal `null` gidiyor,
  diğer sensörler çalışmaya devam ediyor.

### Bağlantılar (Arduino Uno)

| Sensör | Ucu | Uno | Not |
|---|---|---|---|
| GY-68 (BMP180) | VCC · GND · SDA · SCL | **3.3V** · GND · A4 · A5 | 5V **bağlamayın** |
| DHT11 / DHT22 | VCC · GND · DATA | 5V · GND · D2 | Kart üstünde direnç yoksa VCC–DATA arası 10K |
| Toprak probu | VCC · GND · A0 | 5V · GND · **A1** | tool ucuna takılı, toprağa daldırılır |
| Su pompası rölesi | IN | D7 | pompa **NC** ucunda |
| Hava pompası rölesi | IN | D8 | pompa **NC** ucunda |

Pompalar rölenin **NC** (normalde kapalı) ucunda ve `ROLE_AKTIF_LOW 0` buna
göre ayarlı: pompayı çalıştırmak bobini bırakmak demek.

Bilinmesi gereken sonucu var. Bobin enerjisizken COM–NC kapalı olduğu için
**kart kapalıyken, sıfırlandığında, USB çıktığında ve her açılışta
önyükleyicinin beklediği 1-2 saniye boyunca pompa çalışır.** Yazılım o
anlarda çalışmadığı için bunu engelleyemez.

Bunu istemiyorsanız çözüm kabloda: pompa ucunu NC vidasından NO'ya alın ve
`ROLE_AKTIF_LOW`'u 1 yapın. O zaman enerjisiz durum "kapalı" olur, yani güç
kesintisi ve sıfırlama pompayı durdurur.

### Röle kutuplaması

Sketch'in başında tek satır var:

```c
#define ROLE_AKTIF_LOW 1     // kartların çoğu böyle: LOW = röle çeker
```

Yanlış seçim sessiz bir hata değil, **ters** bir sistem: panel "kapalı"
derken röle çekili kalır, "aç" deyince kapanır. Kartın çekince yanan
LED'ine bakarak anlarsınız. Ters çalışıyorsa bu satırı `0` yapıp sketch'i
yeniden yükleyin.

Pinler çıkışa alınırken önce kapalı seviye yazılıyor, sonra `pinMode`
çağrılıyor. Ters sırada pin bir an LOW kalıyor ve aktif-LOW kartta röle
çekiyor — yani her açılışta pompaya kısa bir darbe.

### Kamera

Panelden aç/kapa ve **kare aralığı** (5 sn · 30 sn · 5 dk · 1 saat). 5 saniye
canlıya en yakın olanı — gerçek bir video akışı değil, art arda kare.

Aralık seçmek kamerayı da açıyor: kapalıyken aralık seçip hiçbir şey
olmaması kafa karıştırıcıydı.

Döngü, bekleme süresinden **kare çekme süresini düşüyor**; yoksa "5 saniyede
bir" fiilen "5 + çekim süresi" oluyordu ve komut satırı yolunda çekim
saniyeler sürebiliyor. Kamera istenen hızı taşıyamıyorsa bu sessizce
yutulmuyor, günlüğe yazılıyor.

Bekleme parça parça yapılıyor (saniyelik dilimler): tek uzun bir beklemede
"1 saat"ten "5 saniye"ye geçmek bir sonraki tura, yani bir saat sonrasına
kalıyordu. Şimdi değişiklik en geç bir saniyede geçerli oluyor.

Sunucu **son 12 kareyi** saklıyor; 5 saniyede bir seçilirse bu son bir
dakika demek.

### Grafik düzleştirmesi

Grafikler ham seriyi değil düzleştirilmiş seriyi çiziyor: her nokta **son 10
ölçümün ortalaması**. Öncesinde aykırı değerler eleniyor — bir nokta,
**kendisi hariç** önceki 10 ölçümün ortalamasından **2 standart sapmadan**
fazla saparsa atılıyor. Normal dağılımda ±2σ ≈ %95,4. (±3σ %99,7'dir; "altı
sigma" adı ±6σ'dan gelir ve pratikte hiçbir şeyi elemez.)

Noktanın kendisi eşiğe katılmıyor, yoksa aykırı değer kendi eşiğini şişirip
kurtulurdu.

İki tuzağı var, ikisi de kapatıldı:

* **Sapma sıfır olabiliyor.** DHT11 tam sayı basıyor; sensör bir süre aynı
  değeri verirse σ = 0 oluyor ve o andan sonra HER nokta aykırı sayılıp
  grafik doniyordu. Kanalın çözünürlüğü kadar bir sapma her zaman normal
  kabul ediliyor (`DUZ_TABAN`).
* **Kademe değişimi aykırı değil.** Sulama sonrası nem gerçekten sıçrıyor.
  Bunu atarsak pencere eski değerlerde takılı kalıyor ve serinin geri kalanı
  tamamen eleniyor — grafik o noktadan sonra ölüyor. Üst üste 3 nokta aynı
  şekilde saparsa gürültü değil yeni gerçek sayılıp kabul ediliyor.

Düzleştirme **yalnızca grafikte**. Anlık değer kartları, tablo ve veritabanı
ham kalıyor: "sensör gerçekte ne dedi" sorusunun cevabı kaybolmamalı. Grafik
başlıklarında "10 ölçüm ort." yazıyor — etiketsiz düzleştirilmiş bir grafik
okuyucuya yalan söyler.

### DHT11 mi DHT22 mi

Artık elle seçmiyorsunuz: açılışta ikisi de deneniyor, hangisi okuma
veriyorsa o kullanılıyor ve adı panele bildiriliyor (kartın altında "DHT11"
ya da "DHT22" yazar). Yanlış tip seçilince kütüphane sessizce `NaN`
döndürüyor ve panelde sürekli "—" görünüyordu; sensör bozuk sanılıyordu.
Seri Monitör açılışta `DHT tipi: DHT22` gibi bir satır basar.

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
| X | 17.1782 | +1 | 0 mm | 0 – 535 mm |
| Y | 4.2686 | +1 | 0 mm | 0 – 630 mm |
| Z | 37.074 | **−1** | **438 mm** | 0 – 550 mm |

Aynı değerler `plc.py`'deki `VARSAYILAN_KALIB` listesinde de duruyor: o
liste yalnız `gantry_calib.json` bulunamazsa devreye giriyor ve dosyayla
**aynı** tutulmalı. Ayrışırsa, dosyanın kaybolduğu gün makine sahadaki
koordinatları sessizce sınır dışı sayar.

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

* **Panel** — anlık değerler, grafikler, zaman aralığı seçimi (15 dk → 7 gün).
  Kartlar ve grafikler yalnızca **gerçekten veri gelen** kanallar için
  görünür: bağlı olmayan bir sensör için boş eksen çizilmez. İşaret yapışkan,
  yani DHT'nin ara sıra atladığı bir okuma kartı gözden kaybettirmez.
* **Kontrol** — jog paneli, konuma git, hız, sürücü aç/kapa, röleler
  (düğme kartın bildirdiği gerçek durumu gösterir), kayıtlı noktalar, tohum ızgarası, yasak bölgeler, uç değiştirme,
  programlar ve kamera önizlemesi.
* **Tarla** — yatağın 3B görünümü: bitki ekleme, sürükleyerek taşıma,
  yayılım daireleri ve çakışma uyarıları (aşağıda).
* **Tablo** — aynı verinin sayı hâli; grafik okuyamadığınız durumlar için.

Jog düğmeleri **tıklayınca başlar, tekrar tıklayınca durur**; çalışan eksenin
düğmesi mavi yanar. Ok tuşları da aynı: `←→` X, `↑↓` Y, `PageUp/PageDown` Z,
**Esc** durdurur, **boşluk** acil durdurma. Jog yenilemeleri WebSocket'ten
gidiyor — saniyede birkaç HTTP isteği hem yavaş hem gereksizdi.

Basılı tutma yerine tıklama, "parmağını çekince durur" güvencesini ortadan
kaldırdığı için koruma tamamen ajana bindi:

* Panel yenilemeyi kesince (sekme gizlendi, pencere odağı gitti, soket koptu)
  eksen **1,2 saniyede** durur.
* Eksen yumuşak sınıra yaklaşınca ajanın bekçisi **kendiliğinden durdurur**;
  duruş payı hıza göre hesaplanır (hız × 0,5, en az 2 mm).
* Her yenilemede yasak bölge ileri-bakışı tekrarlanır.

**Jog yönü kalibrasyondaki `dir` değerine göre seçilir.** PLC'nin `jogf` biti
eksenin kendi ileri yönü; Z'de `dir` = −1 olduğu için o bit mm cinsinden
aşağı demek. Panelde `Z▲` her zaman **artı mm** yönünde hareket eder.

**`enable` her açılışta 0 → 1 kenarı üretir.** Register zaten 1 okurken üstüne
tekrar 1 yazmak hiçbir şey değiştirmiyor: bir arıza sonrası düşmüş sürücü
öylece kapalı kalıyor ve komutlar sessizce yutuluyor. Sahada tam olarak bu
yaşandı — hareket alınamamasının sebebi buydu.

### Sulama kararı

Karar **kartta değil**. Önceki sürümde Arduino kendi eşiğini EEPROM'da tutup
kendi açıp kapatıyordu; o mantık tersti (toprak ıslakken suluyordu) ve elle
verilen komutu bir sonraki ölçümde eziyordu. Sadeleştirirken tamamen
kaldırıldı: kart artık yalnızca ölçüyor ve dediğini yapıyor.

Sulama şu an panelden ya da ajandaki programdan sürülüyor — "noktaya git,
su pompasını aç, N saniye bekle, kapat". Otomatik karar geri gelecekse
Pi'de olacak: eşik ve geçmiş orada zaten var, kartta yoktu.

Toprak sensörü **tek** ve tool ucunda: makine nereye giderse ölçüm oradan
geliyor — "bitkiye git, nemini ölç, ona göre sula" mantığı buna dayanıyor.
Yatağa sabit ikinci bir sensör yok; kod bir dönem öyle varsayıyordu ve boş
bir pini okuyordu.

**Prob kalibre edilmeli.** Dirençli prob suda sıfır okumuyor: saf su bile
sonsuz iletken değil ve modülün seri direnci bölücüyü kaydırıyor. Ölçeği
0–1023 varsaymak, suya sokulan probun "%42" demesi ve panelin hiçbir zaman
ıslak göstermemesi demek. İki uç bir kez ölçülüyor:

```bash
python3 toprak-kalibre.py kuru     # prob havada
python3 toprak-kalibre.py islak    # prob su dolu bardakta
sudo systemctl restart farmbot-ajan
```

Değerler `ajan/ayarlar.json` → `arduino.toprak_kuru` / `toprak_islak`
altında durur, ajan panele bildirir, çevirimi panel yapar.

Toprak nemi panelde **yüzde** gösteriliyor. Prob kuruyken yüksek, ıslakken
düşük ham değer okuyor; ham sayıyı göstermek "nem arttıkça değer düşüyor" gibi tersine bir
okuma yaratıyordu. Ham değer kartın altında ayrıca yazıyor.

## Komut protokolü (ileride eklemek için)

Panel → sunucu: `POST /api/komut` `{"ad": "...", "arg": {...}}`
Sunucu → ajan (WebSocket): `{"tip":"komut","id":"...","ad":"...","arg":{...}}`
Ajan → sunucu: `{"tip":"sonuc","id":"...","ok":true,"mesaj":"..."}`

Tanımlı komutlar: `jog`, `jog_dur`, `git`, `home`, `dur`, `acil`,
`acil_temizle`, `enable`, `hiz`, `role`, `bolge_listele`,
`bolge_kaydet`, `uc_listele`, `uc_kaydet`, `uc_al`, `uc_birak`, `uc_degistir`,
`dizi_baslat`, `dizi_durdur`.

Sunucuda kalan, ajana hiç gitmeyen uçlar: `/api/noktalar`,
`/api/izgara/onizle`, `/api/izgara/uygula`, `/api/programlar`,
`/api/programlar/calistir`, `/api/kare/son`.

İstisna: `jog` ve `jog_dur` panel WebSocket'inden geçiyor ve yanıt
beklenmiyor — saniyede 3-4 yenileme için gidiş-dönüş beklemek gecikme yaratır.
Güvenlik yanıta değil, ajandaki kira bekçisine dayanıyor.

Yeni komut eklemek için üç yer: `sunucu/main.py → IZINLI_KOMUTLAR`,
`ajan/ajan.py → komut_isle`, arayüzde bir düğme.

## Nokta deposu, ızgara, bölgeler, uç değiştirme, programlar

### Kayıtlı noktalar
Bulunulan konum isimle kaydedilir; listeden "Git" mevcut `git` komutunu
çağırır (ikinci bir hareket yolu yok). Makinenin yumuşak sınırlarının dışında
kalan noktalar **silinmez**, uyarıyla işaretlenir ve "Git" düğmeleri kapanır —
sınırlar sonradan daralmış olabilir, kaydı çöpe atmak kullanıcının emeğini
çöpe atmaktır.

Veri `~/farmbot-veri/noktalar.json` içinde. **Neden JSON, neden SQLite değil:**
küçük, bütün okunup bütün yazılan bir yapılandırma verisi; aralık sorgusu ya
da seyreltme gerekmiyor. Gantry Studio'nun `gantry_store.json` biçimiyle aynı
mantıkta, elle düzeltmesi kolay, yedeklemesi `cp`. Telemetri farklı bir iş
(sürekli ekleme + zaman aralığı sorgusu) ve SQLite'ta kalıyor. Yazma atomik:
geçici dosya + `os.replace`.

### Tohum ızgarası
Alanlar dört grupta: **Başlangıç** (X, Y) · **Aralık** (ΔX, ΔY) · **Boyut**
(satır × sütun) · **Ad** (önek). Z alanı yok: noktalar tarla tasarımcısındaki
bitkilerle aynı kuralla, güvenli taşıma yüksekliğine (`guvenli_z`) yazılıyor —
"git" dendiğinde uç toprağa dalmasın diye. Ekim derinliği ayrı bir bilgi ve
türde duruyor.

Önizleme kaç nokta üretileceğini, ilk ve son noktayı, sınır dışı kalanları ve
üzerine yazılacakları söylüyor; ilk dört noktanın koordinat listesi bilerek
kaldırıldı — karar için gereken bilgi bu değildi ve noktaların tamamı zaten
Uygula'dan sonra listede görünüyor.
`x0,y0,z` + `dx,dy` + satır/sütun + önek → satır-öncelikli `s1..sN`.
Üretilen noktalar **aynı nokta deposuna** yazılıyor, ayrı bir yapı yok.
Uygulamadan önce önizleme: kaç nokta çıkacak, kaçı sınır dışı kalacak, kaç
mevcut noktanın üzerine yazılacak.

### Yasak bölgeler
Dikdörtgen alan (X/Y) + `izin_kosulu`. Denetim **ajanda**; panel çökse de
koruma çalışır. Değişkenler: `z, x, y, prox, tool, safe_z, zmax`.

    z>=safe_z          tool!='laser'          z>=safe_z or prox

`eval()` kullanılmıyor — karşılaştırma, `and/or/not`, parantez, sayı ve metin
sabiti destekleyen küçük bir değerlendirici (`ajan/kosul.py`) var. Bilinmeyen
isim, bozuk ifade ya da tip uyuşmazlığı → koşul **FALSE**, yani hareket
engellenir. Güvenlikte şüphe izin verme yönünde çözülmez.

İki nokta referanstan farklı:

* **Yol denetimi.** Yalnızca hedef değil, hareketin geçtiği yol da
  denetleniyor. Başlangıç ve hedef bölge dışında olsa bile aradan geçmek
  engelleniyor. Jog'da ise ileriye bakılıyor: eksen bölgeye *girmeden* duruyor.
* **İhlalden çıkış.** Makine bir bölgenin içinde koşulu sağlamadan kalırsa
  (elektrik kesintisi, bölge sonradan tanımlandı) her hareketi engellemek onu
  kilitlerdi. Bu durumda yalnızca **Z'yi yukarı almaya** izin veriliyor —
  açıklığı ancak artırabilecek tek hareket. Yanlamasına sürüklenme engelli.

### Uç değiştirme
Yandan yaklaşımlı kilit dizisi (`ajan/uclar.py`, ayarlar `ajan/uclar.json`).
Bütün X/Y yolculukları `travel_z` yüksekliğinde; alçak Z'deki tek yatay
hareket uca girip çıkan kısa kayma.

**Her adımın sonunda konum doğrulanıyor**; varılmadıysa dizi durur ve sonraki
adıma geçmez. (Referansta bazı adımların dönüşü denetlenmiyor.)

**Bölge esnetmesi — açıkça:** yuvalar bölgelerin içinde yaşadığı için dizi
boyunca yalnızca `yuva: true` işaretli bölgeler atlanıyor. Diğer bölgeler
dizinin ortasında da engelliyor; esnetme dizi bitince, hata verince ya da acil
durdurmada anında kapanıyor ve panelde "⚠ Yuva esnetmesi açık" rozetiyle
görünüyor. (Referans dizinin tamamında bütün bölge denetimlerini kapatıyor.)

`lock_reg` / `grip_reg` / `presence_reg` **0** olduğu sürece donanım bağlı
değil demektir: dizi çalışır ama sonunda "başarılı" değil
**"doğrulanamadı"** der.

**Uç değiştirme alanı (`tc_area`).** 4 köşeli bir alan; içinde X/Y jog için Z
güvenlik şartı devre dışı — uçları alçak Z'de takıp çıkarabilmek için.
Kapalıyken **hiçbir muafiyet yok** ve muafiyet alanın dışına taşmıyor. Alan
açıkken panelde sarı bir uyarı duruyor ve makinenin şu anda alanın içinde mi
dışında mı olduğunu yazıyor — sessizce açık kalan bir muafiyet, kilidin
kendisinden tehlikeli.

**`z_safe_reg`.** PLC'deki "Z güvenli yükseklikte" biti. Tanımlıysa milimetre
hesabının önüne geçer: gerçek bir switch, hesaptan güvenilirdir. 0 ise
kullanılmaz. Okuma hata verirse "güvenli değil" sayılır.

**`retreat`.** `approach`ın çıkış karşılığı: girişte ucun altına kayarken
izlenen yol ile çıkarken izlenen yol farklı olabilir. Boş bırakılırsa
`approach` kullanılır.

**Hareket önizlemesi.** Tak/Bırak'a basmadan önce izlenecek yol koordinat
koordinat panelde yazıyor, `travel_z` ile uç yüksekliği tutarsızsa uyarı
veriyor. Makinenin kendine çarpma riski en yüksek hareketi bu; "başlat"a
basıp ne olacağını izlemek yerine önce okunabilmesi gerekiyor.

**"Durumu temizle".** Dizi ortasında kesilen bir uç değiştirmeden sonra
yazılımın kaydı ile gerçek durum ayrışabiliyor. Bu düğme **yalnızca kaydı**
sıfırlar; hiçbir eksen hareket etmez. Otomatik kurtarma denemek, bilinmeyen
bir durumda kör hareket demek olurdu.

Sahadan gelen gerçek değerler `ajan/uclar.json` içinde: `safe_z` 280,
`travel_z` 280, `lift` 80, `approach` −55, `lock_dwell` 1500, `speed` 20,
`slide_axis` Y; uçlar tool1 (10, 70.5, 150), tool2 (5, 150, 200),
tool3 (5, 250, 250). `lock_dwell` milisaniye — 50'nin altındaki değerler
saniye kabul edilir (referans program 1.5 kullanıyordu; 1500'ü saniye sanmak
kilit servosu komutundan sonra 25 dakika donmak demekti). Bu servo
PLC register'ından sürülüyor, Arduino'yla ilgisi yok.

### Programlar
Adım tipleri: noktaya git · bekle · röle aç/kapa · uç değiştir.
Hepsi mevcut komutları çağırır. Dizi **ajanda** yürür (panel kapansa da acil
durdurma keser). Nokta adları sunucuda koordinata çevrilip ajana öyle gider;
çözülemeyen bir nokta varsa dizi **hiç başlamaz**. Bir adım hata verirse dizi
durur ve sebep panelde kalır. Acil durdurma diziyi keser, mandal
temizlenmeden yeniden başlamaz. Sonsuz tekrar yok (en fazla 1000 tur).

### Tarla haritası — katman mimarisi

Harita **katmanlardan** kuruluyor; her katman `sunucu/static/katmanlar/`
altında tek bir dosya ve tek tek açılıp kapanabiliyor. Tercih tarayıcıda
(`localStorage`) saklanıyor.

| Katman | Ne çiziyor | Varsayılan |
|---|---|---|
| Yatak ve çerçeve | toprak, karıklar, direkler, raylar | açık |
| Yasak bölgeler | ajandaki bölgeler, koşulu hatalıysa kırmızı | açık |
| Uç yuvaları | uçların yerleri + uç değiştirme alanı | açık |
| Yayılma çapı | tür yayılımı ve çakışma hesabı | açık |
| Bitkiler | gövde + yapraklar, yaşa göre büyüyen | açık |
| Kayıtlı noktalar | bitki olmayan noktalar (ızgara, referans) | açık |
| Sensör okumaları | toprak nemi, ölçüldüğü noktada renk noktası | kapalı |
| Kamera kareleri | karenin çekildiği koordinatta işaret; tıklayınca kare | kapalı |
| Robot izi | son 240 konumun soluklaşan çizgisi | kapalı |
| Robot | portal, kızak, Z kolonu, uç kafası — canlı konumda | açık |

**Kapalı katman hiç çizilmiyor.** Grubu sahneden çıkarılıyor, `guncelle` ve
`ciz2b` çağrılmıyor, nesneleri bellekten atılıyor. Pi'nin GPU'su için bu
gerçek bir fark: görünmeyen 300 bitkiyi her karede dönüştürmenin bedeli var.

**Yeni katman eklemek tek dosya eklemek.** `statik/katmanlar/` içine bir `.js`
koymanız yeterli — `GET /api/katmanlar` klasörü okuyor, panel dönen listeyi
sırayla yüklüyor. Dosya adının başındaki sayı çizim sırasını veriyor
(`10-…` altta, `90-…` üstte). HTML'e ya da bir listeye ad yazmak gerekmiyor;
yazsaydık her katman iki yerde kayıtlı olur, biri unutulduğunda katman
sessizce görünmezdi.

Katmanlar **birbirini tanımıyor**. Her biri `Tarla.katman({...})` çağırıyor ve
kendisine verilen bağlamdan (`o.veri`, `o.makine`, `o.sinir`, dönüşümler)
okuyor. Sözleşme `tarla.js`in başında yazılı.

### İki görünüm: 3B sahne ve 2B harita

Aynı veriyi kullanan iki görünüm var, ayrı bir depo yok:

* **3B sahne** — izlemek için. Makinenin nerede olduğunu, bitkilerin nasıl
  durduğunu görmek.
* **2B harita** — hassas iş için. Milimetre cetvelli, tıklanan yerin
  koordinatı listenin altında yazıyor, sürükle-bırak piksel piksel değil
  milimetre milimetre çalışıyor. 3B'de bir bitkiyi 5 mm oynatmak zor,
  planda kolay.

Birinde taşınan bitki diğerinde de taşınmış oluyor — çünkü ikisi de aynı
nokta deposunu okuyor.

### Makine ölçüleri tek dosyada

Ray yüksekliği, profil kalınlıkları, kızak ve uç kafası ölçüleri
`sunucu/static/makine.js` içinde **veri olarak** duruyor (FarmBot'un
`bot_versions.ts` dosyası gibi). Çizim kodunda tek bir sabit sayı yok.
Başka bir makine kurulursa dosyaya bir kayıt eklenip `secili` satırı
değiştiriliyor.

Yumuşak sınırlar (X/Y/Z aralığı) bu dosyada **değil**: onlar ajandan geliyor,
çünkü hareketi reddedecek olan ajan ve aynı sayının iki yerde durması en
tehlikeli hata türü.

### Konum bilgisi nereden geliyor

Üç yeni katman "nerede" sorusunu soruyor ve bu bilgi daha önce hiçbir yerde
tutulmuyordu:

* Ajan her **ölçüme** o anki eksen konumunu ekliyor; `depo.py`de
  `konum_x`/`konum_y` sütunları var (mevcut veritabanı `ALTER TABLE` ile
  büyütülüyor, geçmiş silinmiyor).
* Ajan her **kareye** konumu iliştiriyor; sunucu konumu dosya adında
  saklıyor (`<ts>_<x>_<y>.jpg`) — ayrı bir dizin dosyası tutsaydık budama
  sırasında ikisi birbirinden ayrı düşebilirdi.
* **Robot izi** sunucuya hiç yazılmıyor: panel durum akışını dinlerken
  biriktiriyor, yenilenince sıfırlanıyor. Amacı "az önce nereden geçti".

### Tarla tasarımcısı (3B)
Yatağın kuş bakışı ve serbest kamera görünümü. Tür seçilip **Bitki ekle** ile
yatağa tıklanınca bitki oraya konuyor; sürüklenerek taşınıyor, üstüne
tıklanınca kartı açılıyor (ekim derinliği, hasat süresi, günlük su, yayılım,
ışık, büyüme yüzdesi) ve **Buraya git** ile makine oraya gidiyor.

Dört tasarım kararı:

* **Bitki ayrı bir depo değil.** Bitki, `tur` ve `ekim` alanları taşıyan
  sıradan bir **nokta**. Böylece "buraya git" mevcut `git` komutu, sınır
  denetimi mevcut denetim, yedekleme mevcut yedekleme. Kontrol sekmesindeki
  nokta listesinde de görünüyorlar (başında 🌱 ile).
* **Ölçüler sabit yazılmıyor.** Yatak boyu `durum.sinirlar`dan geliyor
  (şu an X 425, Y 550); kalibrasyon değişince sahne kendiliğinden değişiyor.
* **Bitkinin Z'si güvenli taşıma yüksekliği.** Ekim derinliği türde duruyor;
  noktanın Z'si `guvenli_z` ki "buraya git" ucu toprağa daldırmasın.
* **Çakışma görünür.** Her bitkinin altında yayılım çapı kadar bir halka var;
  iki halka kesişirse ikisi de sarıya döner ve kaç mm iç içe oldukları
  listelenir. Yumuşak sınırın dışına düşen bitki kırmızıya döner — kayıt
  silinmez ama hareketi ajan zaten reddeder.

Teknik: `three.js` **yerel dosya** olarak duruyor (`statik/three.min.js`,
UMD, global `THREE`) — tıpkı `chart.umd.js` gibi. CDN yok, ES modülü yok,
derleme adımı yok; Pi internetsiz çalışıyor. React ya da React Three Fiber
kullanılmadı, yörünge denetimi de elle yazıldı (o modül bu sürümde yalnızca
ESM olarak geliyor). Üstten görünüm **ortografik**: ekrandaki mesafe ile
gerçek mm doğru orantılı.

Bitkiler prosedürel çiziliyor (gövde + yapraklar; tür rengi, yayılım çapı ve
`days_to_harvest`e göre büyüme). Fotoğraf dokusu eklemek isterseniz
`tarla.js` içindeki `DOKU` nesnesi bunun için ayrıldı: dosya adını yazıp
görselleri `statik/doku/` altına koymanız yeterli. **Depoda hiç doku dosyası
yok** — telifi doğrulanmamış görsel eklenmedi.

Tür kataloğu `docs/bitki_turleri.json` (37 tür) ve `GET /api/turler` ile
sunuluyor; dosyayı düzenlemek yeni tür eklemeye yetiyor.

### Kamera
`ayarlar.json` → `"kamera": {"aktif": true, "aralik_sn": 30}`. Kare yakalama
picamera2 → rpicam-still → libcamera-still → fswebcam sırasıyla deneniyor;
hiçbiri yoksa
kamera kapanır, geri kalan her şey çalışmaya devam eder. Kare WebSocket'ten
panellere yayılmıyor (40 KB base64 her panele ayrı giderdi): sunucu son 12
kareyi diskte tutuyor, panele "yeni kare var" haberi gidiyor, tarayıcı `<img>`
ile çekiyor.

**Şerit kablolu Pi kamera modülü için** Pi'de:

```bash
sudo apt install -y python3-picamera2 rpicam-apps
rpicam-hello --list-cameras          # kamera görünüyor mu
```

Bir uyarı: `pi-kur.sh` ajanın sanal ortamını artık `--system-site-packages`
ile kuruyor, yoksa apt'tan gelen `python3-picamera2` venv'in içinden
görünmüyor ve 1. yol sessizce eleniyordu. Ortam daha önce kurulduysa
yeniden yaratmak gerekir (`rm -rf ajan/.venv && bash pi-kur.sh`) — ya da hiç
uğraşmayın: `rpicam-still` yolu da aynı işi görüyor, 30 saniyede bir tek kare
için işlem açmanın maliyeti önemsiz.

## Sırada ne var

- [x] Nokta deposu ve "şu noktaya git"
- [x] Tohum ızgarası
- [x] Yasak bölgeler (`allow_if` koşullu)
- [x] Uç değiştirme dizisi
- [x] Kayıtlı program çalıştırma
- [x] Kamera görüntüsü
- [x] 3B tarla tasarımcısı (bitki yerleşimi, yayılım çakışması)
- [ ] Zamanlanmış sulama (eşik + saat kuralları)
- [ ] Uyarı kuralları (nem düşerse bildirim)
- [ ] Fide durumu takibi (sulandı / hasat edildi — ekim tarihi zaten tutuluyor)
- [ ] Nem ölçüm ucu ve otomatik sulama kararı (referanstaki `measure`/`water`)

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
