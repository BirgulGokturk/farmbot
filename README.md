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

**İki kamera var ve ikisi aynı şeyi görmüyor.** Uç kamerası uç kafasına bağlı,
yatağa yakın ve makineyle birlikte hareket ediyor; üst kamera sabit bir
direkte, yatağın tamamını uzaktan görüyor. Bu fark iki yerde sonuç doğuruyor:

* **mm/piksel her kamera için ayrı.** Yakındaki kameranın bir pikseli yarım
  milimetre, uzaktakinin birkaç milimetre. Kalibrasyon kamera başına
  saklanıyor ve çözümleme, karenin geldiği kameranın sayısını kullanıyor.
  Kalibre edilmemiş kamerada milimetre yazılmıyor — piksel yazılıyor.
* **Sabit kameranın karelerine makine konumu yazılmıyor.** Kamera makineyle
  gitmiyor; makinenin o anki yeri, o karenin yatağın neresini gösterdiği
  hakkında hiçbir şey söylemiyor. O kareden ölçü (çap, alan) çıkıyor, yatak
  koordinatı ve kayıtlı bitkilerle eşleştirme çıkmıyor.

#### Kamera sekmesi

**Kameraların tek yeri burası.** Solda üst kamera, sağda uç kamerası, yan
yana ve **ikisi de canlı**. Görüntü işleme burada çalışacağı için ikisini
aynı anda net görebilmek şart; sırayla bakılan iki görüntü, aynı anda ne
olduğunu söylemez.

Bir kameranın bütün ayarı **kendi yarısının altında**: cihaz seçimi,
çözünürlük, aç/kapa, kare aralığı, kalibrasyon. Bunlar önce Ayarlar'a ve
kalibrasyon bölümüne dağılmıştı; taşındılar, **kopyalanmadılar**. Aynı ayarın
iki yerde durması, ikisi çeliştiğinde hangisinin geçerli olduğunu bilinmez
yapar. Kalibrasyon bölümü de tek kopya: "Kalibrasyonu buraya getir" onu o
kameranın yarısına *taşıyor* ve seçili kamerayı da değiştiriyor — kutunun bir
yarının altında durup başka bir kamerayı ölçmesi, bulunması en zor hatalardan
biri olurdu.

Yerleşim dar ekranda alt alta geçiyor: Raspberry'nin 7" ekranında (800×480)
iki kamera hâlâ yan yana, telefon genişliğinde alt alta. Hiçbir genişlikte
yatay kaydırma yok.

**Sekmeden çıkınca canlı akış duruyor.** Akış sekmeye girerken kendiliğinden
açılıyor, çıkarken kapanıyor; boşta duran bir sayfanın saniyede on kare
çekmesi için sebep yok. Sahte kameralarla ölçüldüğünde iki kamera birlikte
~5 kare/sn akıyor ve sunucu+ajan CPU'su %0,9'dan %6,9'a çıkıyor; sekmeden
çıkınca %0,8'e dönüyor.

**Çözümleme ekrandayken kare donuyor.** Canlı akış saniyede beş kare atıyor
ve her yeni kare eski tespitleri siliyor (silmeli de: kutular artık o
görüntüye ait değil). İkisi bir arada, Çözümle'ye basınca kutuların 200 ms
görünüp kaybolması demekti. Kutuları akan görüntünün üstünde bırakmak
seçenek değil — yanlış yeri gösterirdi; onun yerine çözümlenen kare ekranda
donduruluyor. Rozet "donduruldu" yazıyor (yeşil "canlı" değil, çünkü görüntü
ilerlemiyor), akış arkada sürüyor, "Akışa dön" hem kutuları kaldırıyor hem
görüntüyü geri veriyor.

Panelde her kamera için ayrıca İzle sahnesinde bir yüzen kutu var: kendi
başına sürükleniyor, kendi boyut kademesini hatırlıyor, ayrı ayrı kapanıp
açılıyor. Kutuyu gizledikten sonra geri açan tek yer Kamera sekmesindeki
**Sahnede** düğmesi. Bir kamera kapalıyken ya da arızalıyken öteki çalışmaya
devam ediyor — her kameranın kendi iş parçacığı ve kendi hata sayacı var.

**İzle sekmesi de akış istiyor — saniyede 1 kare.** Yüzen kutu eskiden
yalnızca yeni bir kare geldiğinde görünür oluyordu. Uç kamerasında bu
farkedilmiyordu; sabit üst kameranın akışı ise Kamera sekmesinden çıkınca
duruyor, İzle'de hiç kare gelmiyor ve kutu hiç açılmıyordu — "Sahnede"
düğmesine basmak bile boş bir kutu açıyordu, çünkü beklenen kare hiç
gelmeyecekti. Artık İzle sekmesi açıkken kutusu görünen her kameranın akışı
sürüyor. Kamera sekmesindeki 5 kare/sn oraya bakan biri için; köşedeki
gözcü kutuya 1 yetiyor ve Pi'nin işlemcisi beşte biri kadar yükleniyor.
Kutu gizlenince o kameranın akışı duruyor, tarayıcı sekmesi arkaya
düşünce hepsi duruyor, ajan yeniden başlarsa istek yineleniyor.

Canlı akış yapamayan bir yolda (`fswebcam` gibi) "Canlı" düğmesi kapalı
geliyor ve sebebini söylüyor; basıp hata almak dürüst değil. Akış
yapabilenlerde kamera MJPEG üretiyorsa Pi'de yeniden kodlama yapılmıyor,
kare olduğu gibi geçiyor.

Canlı kapalıyken **kare aralığı** (5 sn · 1 dk · 1 saat) o kameraya işliyor.

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

Panelin iki katmanı var ve ikisi AYNI VERİYİ okuyor:

* **Bahçe** — bahçeyle uğraşan ama robotla uğraşmak istemeyen biri için.
  Koordinat yok, ayar yok, soru yok. Ayrıntısı [Bahçe modu](#bahçe-modu)
  başlığında.
* **Teknik sekmeler** (İzle · Sür · Tarla · Kamera · Otomasyon · Ayarlar) —
  makineyi süren, kalibre eden, program yazan taraf. Bahçe modu bunların
  hiçbirini değiştirmedi.

İkisi ayrı depo tutmuyor: bahçedeki bitki, teknik paneldeki noktanın
kendisi. Ayrı tutsalardı hangisinin doğru olduğunu kimse bilemezdi.

* **Panel** — anlık değerler, grafikler, zaman aralığı seçimi (15 dk → 7 gün).
  Kartlar ve grafikler yalnızca **gerçekten veri gelen** kanallar için
  görünür: bağlı olmayan bir sensör için boş eksen çizilmez. İşaret yapışkan,
  yani DHT'nin ara sıra atladığı bir okuma kartı gözden kaybettirmez.
* **Kontrol** — jog paneli, konuma git, hız, sürücü aç/kapa, röleler
  (düğme kartın bildirdiği gerçek durumu gösterir), kayıtlı noktalar, tohum ızgarası, yasak bölgeler, başlar ve tohumluk,
  programlar.
* **Tarla** — yatağın 3B görünümü: bitki ekleme, sürükleyerek taşıma,
  yayılım daireleri ve çakışma uyarıları (aşağıda).
* **Kamera** — iki kamera **yan yana ve ikisi de canlı**: solda üst kamera,
  sağda uç kamerası. Kameranın bütün ayarı kendi yarısının altında —
  cihaz seçimi, çözünürlük, aç/kapa, kare aralığı, kalibrasyon. Aynı ayar
  başka bir yerde İKİNCİ KEZ durmuyor; ikisi birbiriyle çelişirse hangisinin
  geçerli olduğunu kimse bilemez. Ayrıntısı aşağıda.
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

## Nokta deposu, ızgara, bölgeler, başlar, programlar

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

### Üç sabit baş

Z ekseninin ucuna **üç baş kalıcı olarak vidalı** ve yan yana duruyorlar:
soldaki sulama başlığı, ortadaki toprak nemi probu, sağdaki tohum alma
ucu. Hiçbiri sökülmüyor, hiçbiri yuvaya gitmiyor. **"Hangi uç takılı"
diye bir soru yok** — uç değiştirme dizisi, uç yuvaları, kilit servosu,
varlık sensörü, uç teyidi ve birinci onay kaldırıldı; hepsi olmayan bir
işi doğruluyordu.

#### Kayma bir tercih değil, geometrinin kendisi

Üçü aynı anda takılı olduğu için **hiçbiri Z ekseninin tam merkezinde
değil**. Her başın merkeze göre kendi X/Y kayması var ve makine bir işi
yaparken o başın kaymasını eklemek zorunda:

| İş | Baş | Makine nereye gider |
|---|---|---|
| Sula | sulama başlığı | hedef + sulama kayması |
| Nem ölç | nem probu | hedef + prob kayması |
| Ek | tohum ucu | hedef + tohum ucu kayması |

Aynı `X300 Y200` noktasına bu makinede sulama `X360 Y260`'a, ekim
`X230 Y200`'e gidiyor — aralarında 130 mm var. Kayma uygulanmazsa iş
ortadaki başla değil başka bir başla yapılır: sahada tam bu yaşandı,
ekim tohum ucunun kayması uygulanmadığı için yanlış yere düşüyordu.

Kaymalar `ajan/uclar.json`daki `baslar` bloğunda, Ayarlar → **Başlar ve
tohumluk** bölümünden düzenleniyor. Her başın ayrıca **Z tabanı** (o
başın inebileceği en alçak mutlak Z — çarpma sınırı) ve **derinliği**
(işini yaparken yüzeyin ne kadar altına indiği; nem probu toprağa
dalıyor, sulama başlığı dalmıyor) var. Sürüm geçişinde eski
`sulama_basligi` değeri sulama başına taşınıyor: sahada ölçülmüş +60/+60
kaybolmuyor.

Hesap tek yerde (`sunucu/baslar.py`) ve sulama, nem ölçümü, ekim üçü de
oradan geçiyor. Her akış kendi hesabını yapsaydı üçü birbirinden
ayrışırdı.

**Üç baş arabanın ÖNÜNDE.** Kaymalar (`uclar.json` → `dx/dy`) makinenin
referans noktasına göre tanımlı, arabaya ya da Z sütununa göre değil.
Sahnede olduğu gibi uygulanınca küme sütunun üstüne biniyordu: sütun
kızak yerelinde x = +1,7 profil, z = 0'da duruyor ve başların x yayılımı
tam onun üstünden geçiyor; ikisi aynı z düzleminde olduğu için sütun
başları örtüyordu.

X ekseninde iki yön de denendi, ikisi de işe yaramadı — yaramaması da
gerekiyordu: sütun belirli bir x'te duruyor ve kümeyi aynı doğru üzerinde
kaydırmak onu sütunun düzleminden çıkarmıyor. Kurtulmanın tek yolu o
düzlemi terk etmek, yani **sahne z'sinde** kaymak (kızak kirişte sahne
x'inde kayıyor, kirişe dik yön z).

Yön sabit yazılmıyor, **ölçülüyor**: köprü sahne z'sinde yürüyor ve nötr
konumu z = 0, dolayısıyla dikim alanlarının alanla ağırlıklandırılmış z
merkezinin işareti doğrudan "yatak kirişin hangi yanında" sorusunun
cevabı. Yatak taşınırsa küme de onunla birlikte doğru yana geçiyor.
Yatak simetrikse işaret çıkmıyor; o durumda beraberliği sahnenin
varsayılan bakış yönü (+z) bozuyor — fiziksel bir iddia değil, yalnız
beraberlik bozucu.

Mesafe de sabit değil, kümenin kendi z yayılımından: **arkada kalan baş**
engelin ötesine geçecek kadar. Sabit bir mesafe yetmiyor ve bu ölçüldü —
başların z'si eşit değil, sulama başlığının kendi `dy`si 60 mm. Arabanın
yarı derinliği kadar ötelemek yalnız en öndeki başı kurtarıyor, sulama
başlığı sütunun içinde kalmaya devam ediyordu. Engel, başların
yüksekliğinde duran tek şey: Z kılavuz sütunu, artı plakanın payı ve
küçük bir açıklık. Uygulanan şey **katı bir öteleme** — üç başa da aynı
vektör ekleniyor, birbirlerine göre yerleri hiç değişmiyor.

Taşıyıcı plaka sıfır noktasını da kapsamaya devam ediyor, yani küme
ötelenirken plaka arabaya değmeyi sürdürüyor ve dışarı taşan bir konsol
gibi duruyor — gerçekte de öyle.

**3B sahnede de üçü yan yana.** Nem probu bir süre "görünmüyor" diye
kaldı ve sebebi ölçülünce çıktı: parça kuruluyordu, yeri de doğruydu
(`Tarla.katmanTanimi("robot").suDurumu()` → `probVar` doğru, `probX` 0)
— ama taşıyıcı plakanın tam altında duruyor ve plakadan yalnız 79 mm
sarkıyordu; plakanın kendi kenarı 76 mm. Yani ucun plakanın altından
görünebilmesi için sahneye 44 dereceden daha yatık bakmak gerekiyordu,
üstten bakışta plaka probu tamamen örtüyordu. Bıçaklar da 4,8 mm
enindeydi — tezgâh ayağı denk geldiğinde birkaç piksel kalıp
kayboluyordu. Prob artık plakadan 146 mm sarkıyor (28 derecede
görünüyor), bıçaklar gerçek oranına yakın (10 mm en) ve kendi `dx/dy`
ayarı girilmemişse makine merkezine değil **sulama başlığı ile tohum
ucunun tam ortasına** konuyor. Ayar girilmemiş makinede yedek dizilim de
gerçek sırayı gösteriyor: solda sulama, ortada prob, sağda tohum ucu —
eskiden yedek değerler sulamayı probun sağına koyuyordu.

**Erişilebilir alan da başa göre.** Makine `hedef + kayma`ya gittiği ve
kendisi yumuşak sınırların dışına çıkamadığı için pozitif kaymalı bir
baş yatağın uzak kenarına yetişemiyor. Sulama başlığı için sağ ve üst
kenarda suyun gidemediği bir şerit vardı; artık her başın kendi şeridi
var ve bahçedeki taralı gölge **o an hangi iş yapılacaksa ona göre**
çiziliyor.

#### Tohum ucunun kendi dikey ekseni (T / PLC'de j4)

Ana Z bütün başları birden indirip kaldırıyor; tohum ucu bunun üstüne
bir de **kendi ekseniyle** iniyor. Yalnız iki anda: tohumu alırken ve
tohumu toprağa bırakırken. İkisinin de hemen ardından çekiliyor.

Register haritası X/Y/Z ile aynı deseni izliyor (`ajan/plc.py`):

| | jogf | jogb | go | home | hedef | hız | hızlanma | yavaşlama | konum |
|---|---|---|---|---|---|---|---|---|---|
| T | 1090 | 1091 | 1092 | 1093 | 1094 | 1096 | 1098 | 1100 | 1102 |

Sahadan ölçülen kalibrasyon `gantry_calib.json`ın dördüncü satırında ve
Ayarlar → Kalibrasyon tablosunda T satırı olarak duruyor:

| | cpm | dir | home | min | max |
|---|---|---|---|---|---|
| T | 87 | +1 | 0 | 0 | 55 |

`cpm` ve `dir` — X/Y/Z'de olduğu gibi — panelden düzenlenmiyor: yanlış
`cpm` "gitmeyi reddetmek" değil **yanlış mesafe gitmek** demek.

**Kurulmamış bir eksen kilitli kalıyor.** `cpm` sıfırsa hiçbir T
hareketi yapılmıyor, panel sebebini yazıyor ve ekim akışı bugünkü
hâliyle, her şeyi ana Z yaparak sürüyor — T adımları hiç yazılmıyor.

**Hangi ucun "yukarı" olduğunu yazılım ÖLÇEMİYOR.** Kalibrasyonun
`home`unu (bu makinede T 0) çekilmiş kabul ediyoruz — eksen referansa
gittiğinde uç yukarıdadır, normal kurulum bu. Ters bağlıysa güvenlik
kuralı tersine döner ve uç aşağıdayken X/Y serbest kalır; o yüzden
varsayım gizli değil: Sür ekranında *"Yukarı = T 0.0 mm"* yazıyor ve
Ayarlar → Başlar'daki **yukarı T** kutusundan değiştiriliyor.

**Uç aşağıdayken X/Y hareketi yok.** Ana Z yukarıda olsa bile tohum ucu
kendi ekseniyle inmiş olabiliyor; o hâlde X ya da Y sürmek ucu toprağa
ya da kabın kenarına sürtmek demek. Kural jog'da da, koordinat
hareketinde de, dizi içinde de geçerli. Z hareketi serbest kalıyor:
kaçış yolunu kapatmak makineyi kilitler.

#### Nem ölçümü — bitki başına, probun kendisiyle

Nem probu artık makinenin üstünde kalıcı olduğu için her bitkinin kendi
üstüne gidip ölçebiliyoruz. Bahçede bir bitkiye **"Nem ölç"** dendiğinde
makine o bitkinin üstüne (+ prob kayması) gidiyor, probu toprağa
daldırıyor (derinlik ayardan), okuyor, kaldırıyor; okunan değer **o
bitkinin kaydına** yazılıyor (`nem_yuzde`, `nem_ham`, `nem_ts`).

Bahçe kartı artık önce bu ölçüme bakıyor ve gerekçesinde *"kendi
üstünden"* yazıyor. Bitkinin kendi ölçümü yoksa (ya da 24 saatten
eskiyse) eski kanıta düşüyor: 100 mm yarıçapta alınmış en taze okuma,
gerekçede *"90 mm ötede"* diye. Şimdiye kadar "4 bitki susadı" derken
dördü için de aynı tek okumaya bakılıyordu.

Prob toprakta 4 saniye bekliyor ve bu süre **sensörün ölçüm aralığından
uzun olmak zorunda**: 2 saniyeyle denendi, prob aşağıdayken tek bir okuma
bile gelmedi ve ölçüm sessizce boşa gitti.

### Programlar### Programlar
Adım tipleri: noktaya git · bekle · röle aç/kapa · tohum ucunu indir/kaldır.
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
| Tohumluk | tohum haznelerinin yerleri ve profili | açık |
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
Kameralar `ayarlar.json` → `"kameralar": [...]` içinde tanımlı ama asıl yer
ajandaki **`kameralar.json`**: panelden (Kamera sekmesi → o kameranın yarısı
→ Ayarlar) kaydedilenler oraya yazılıyor ve bundan sonra o dosya okunuyor. Eski tek kameralı
`"kamera": {...}` bloğu bozulmuyor — "uc" adlı kameraya dönüşüyor.

Her kameranın kendi `yol`u var: `pi` şerit kablolu modül
(picamera2 → rpicam-still → libcamera-still), `usb` USB webcam
(fswebcam → ffmpeg), `oto` sırayla dener. **`rpicam-still` USB kamerayı
sürmüyor**, o yüzden USB kamerada `usb` seçmek gerekiyor.

**USB kameranın cihaz yolu sabit yazılmıyor.** `/dev/videoN` numarası kamera
çıkarılıp takılınca değişiyor; adı değişmiyor. `cihaz_adi` alanına adın bir
parçası yazılıyor (panelde "Bağlı cihazları tara" listeyi getiriyor) ve cihaz
her açılışta `/sys/class/video4linux/*/name` üzerinden adından bulunuyor.
Kare alınamadığında yol yeniden çözülüyor — kabloyu takıp paneli yeniden
başlatmak gerekmiyor. `cihaz` alanı yalnızca ad bulunamazsa kullanılan yedek.

Bir kamera açılamazsa yalnızca o kamera kapalı kalıyor, ötekiler ve makine
çalışmaya devam ediyor.

**Çekim 1920, akış 640 — iki ayrı genişlik.** Kamera 640x480 çekerken yeni
çıkmış bir filiz karede birkaç piksel kalıyor, en küçük leke eşiğinin
altına düşüp eleniyordu; AprilTag de o boyutta okunamıyordu. Çekim
genişliği (`genislik`) 1920'ye çıktı. Ağ bundan etkilenmiyor: canlı akış
`canli_genislik`e (varsayılan 640) küçültülerek gönderiliyor — 1920x1440
JPEG ~400 KB, saniyede 5 kare 2 MB/s eder ve kareler buluttaki sunucu
üzerinden geçiyor; aynı akış 640'ta ~40 KB.

Çözümleme (AprilTag taraması, filiz bulma) küçültülmüş kareyi **almıyor**:
ajan tam çözünürlüklü son kareyi bellekte tutuyor ve sunucu `kamera_kare`
komutuyla onu istiyor. Akış açıkken kamerayı ikinci kez açmak mümkün
olmadığı için kare, küçültülmeden **önce** saklanıyor. `canli_genislik`i 0
yapmak küçültmeyi tamamen kapatıyor. Küçültme Pillow ile yapılıyor; kurulu
değilse akış tam çözünürlükte gidiyor ve sebebi günlüğe bir kez yazılıyor.

Kare WebSocket'ten panellere yayılmıyor (40 KB base64 her panele ayrı
giderdi): sunucu **kamera başına** son 12 kareyi `kareler/<kamera>/` altında
diskte tutuyor, panele "yeni kare var" haberi kamera adıyla gidiyor, tarayıcı
`<img>` ile çekiyor. Halkanın kamera başına olması şart: ortak bir halkada
5 saniyede bir çeken üst kamera, uç kamerasının bütün karelerini bir dakikada
silerdi.

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

### Kamera kalibrasyonu — tek yol: AprilTag

Kareyi haritanın doğru yerine koyabilmek için bir pikselin kaç milimetre
olduğunu ve kameranın nasıl durduğunu bilmek gerekiyor. **Ölçüm yolu tek:
yatağa yapıştırılan AprilTag'ler.**

Önceki iki yöntem — "iki kare" (hareketli kamera) ve "ölçek" (sabit
kamera) — kaldırıldı. İkisi de kullanıcının bir piksele tıklamasına
dayanıyordu; tıklama 3-5 piksel şaşıyor ve o şaşma bütün kareye
yayılıyor. Etiketin dört köşesi matematiksel olarak tanımlı ve algılayıcı
onları alt piksel hassasiyetiyle buluyor. Elle sayı girme duruyor:
ölçüleni görmenin ve gerektiğinde bir değeri zorlamanın yolu o.

Kaç etiket, ne veriyor:

| Etiket | Çıkan |
|---|---|
| 1 (kenar ölçüsü girilmiş) | `mm_px` |
| 2+ (koordinatları kayıtlı) | `mm_px`, `donme`, `ofset_x/y` |
| 3+ | üsttekiler + ölçülen sapma (`artik_mm`) |
| 4+ | üsttekiler + **harita** (perspektifli homografi) ve sapması |

**Harita neden gerekli.** Ölçek + dönme modeli kameranın yatağa DİK
baktığını varsayıyor. Bu kurulumda kamera sert bir açıyla bakıyor ve
sahada ölçüldü: aynı noktalarda benzerlik 51,8 mm, harita 9,3 mm
yanılıyordu. Harita varsa `tespit.py`, `filiz.py` ve haritadaki kare
katmanı onu kullanıyor; yoksa eski model aynen geçerli ve hiçbir kurulum
değişmiyor. Üçlü (ölçek/dönme/ofset) harita yazılırken de kaydediliyor —
haritayı okumayan yerler bozulmadan çalışsın diye.

**Sabit kameranın karesi artık yatağa oturuyor.** Etiketler yatağa
yapıştırılı ve koordinatları biliniyor; haritadan çıkan koordinat
doğrudan yatak koordinatı, karenin bir makine konumu olmasına gerek yok.
Eskiden bu yüzden "karenin makine konumu yok" denip koordinat
verilmiyordu — üst kameranın lekesi ölçülüyor ama nerede olduğu
söylenmiyordu. O ret kalktı: harita varsa üst kamera da koordinat veriyor,
kayıtlı bitkilerle eşleşiyor ve karesi tarla haritasında yerine oturuyor.

**Hareketli kamerada sonuç göreceliye çevriliyor.** Etiket koordinatları
mutlak olduğu için çözüm de mutlak çıkıyor; uç kamerasında `ofset`
"kameranın uçtan kayması" demek ve makinenin tarama anındaki konumu
çıkarılıyor. Harita için de ölçüm anındaki konum (`harita_makine_x/y`)
kaydediliyor ve okuyan taraf kareyle arasındaki farkı ekliyor. Kayıtlı
değilse harita hareketli kamerada **kullanılmıyor** — kaydırmayı tahmin
etmektense eski modele düşmek doğru.

### Yeşil bulma — ExG tek başına yetmiyor

Sahada iki yönlü hata verdi: yatağın önündeki **mavi-turkuaz plastik
kabın kenarı** "filiz" sayıldı, toprağın ortasındaki **gerçek fesleğen
filizleri** ise hiç bulunamadı. Üç ayrı sebep ölçüldü ve üçü de ayrı
düzeltme istiyor.

**1. Beyaz dengesi.** Kare soğuk geliyor. Üst kameranın gerçek karesinde
ölçüldü: kanal ortalamaları R 65 · G 72 · B 85 — kadrajın çoğu kahverengi
toprakken en güçlü kanal mavi. Kabın gün gören beyaz üst kenarı
0.295/0.336/0.369 okuyor (nötr 0.333). ExG piksel başına
normalleştirdiği için PARLAKLIKTAN bağımsız ama RENK SAPMASINDAN değil.
"Shades of grey" (Minkowski p=6) düzeltmesi o beyaz kenarı
0.328/0.334/0.338'e getiriyor — ölçülebilir biçimde nötr.

Gri-dünya (p=1) burada YANLIŞ olurdu: kadrajın çoğu tek renk (toprak) ve
o yöntem sahnenin ortalamasının gri olduğunu varsayıyor, dolayısıyla
maviyi aşırı kaldırırdı. Beyaz-yama (p=∞) da yanlış: en parlak piksel
çoğu zaman bir yansıma parıltısı. p=6 ikisinin arasında.

**2. Renk kapıları.** ExG (`2g − r − b`) aslında "yeşil"i değil
"kırmızının azlığını" ölçüyor. Turkuazda r düşük, g ve b birlikte
yüksek; indeks pozitif çıkıyor. Kabın kenarında ölçülen ExG %11 pikselde
0.12 eşiğini geçiyor. Karara `g > b`, `g > r`, ExGR ve küçük bir
doygunluk tabanı eklendi; ölçülen kesim kabın kenarında %29–67 arası.
Yaprak dördünü de rahat geçiyor (yaprakta `g − b` 0.10 üstü, eşik 0.02).

**3. Alan sınırı — en etkilisi.** Kalibrasyon artık pikselden milimetreye
çevirdiği için her lekenin yatak koordinatı biliniyor. Kabın kenarı
Y 609 mm'ye düşüyor, dikim alanı Y 80–400 mm; tezgâh, arka plan, çimen
hepsi dışarıda. Tek denetim, yanlış bulguların çoğu — ve sorduğu soru
renk sorusundan başka: "bu şey ne renk" değil, "bu şey toprağın üstünde
mi". `tespit.alan_suzgeci()` bu süzgeci üretiyor, `goruntu.bul()` de
`gecerli_mi=` ile alıyor.

**Eşiği kareden türetmek denendi, çalışmıyor.** Gerçek karede ExG
ortancası −0.103, sigma 0.131, "ortanca + 4σ" +0.42 çıkıyor — o eşikte
karenin binde beşi geçiyor. Yöntem arka planın tek ve dar bir yığın
olduğunu varsayıyor; bizim kadrajımızda arka plan üç ayrı şey (kızıl
toprak, mavi plastik, gri arka plan) ve sigma yığının genişliğini değil
grupların birbirinden uzaklığını ölçüyor. Sabit eşik + renk kapıları
kalıyor.

### Çözünürlüğü yükseltmek tek başına küçük fideyi bulmuyor

Üst kamerayı 1920'ye çıkarmak gerekli ama yeterli değil, çünkü en küçük
leke eşiği **piksel** cinsindeydi ve kare alanıyla ölçekleniyordu:

| Çözünürlük | mm/piksel | en_az_piksel | fiziksel karşılığı |
|---|---|---|---|
| 640×480 | 0.938 | 150 | 13.0 mm çapında leke |
| 1920×1440 | 0.312 | 1350 | 13.0 mm çapında leke |

Eşik de ölçeklendiği için oran aynı kalıyor: **13 mm'nin altındaki her
fide iki çözünürlükte de eleniyor** ve fesleğen kotiledonu 8–10 mm.
Çözünürlük fideyi daha iyi ÇÖZÜYOR (JPEG bulamacı azalıyor) ama boy
kapısını açan o değil — kapının milimetre cinsinden konması.
`tespit.en_az_piksel(kalib, W, H, cap_mm=4)` bu çeviriyi yapıyor: 640'ta
14 piksel, 1920'de 129 piksel. Aynı fiziksel fide, iki çözünürlükte de
geçiyor — ve 1920'de 129 piksellik bir leke gürültüden rahatça ayrılıyor.

**Morfoloji: açma ve kapama artık AYRI yarıçapta.** Yarıçap piksel
cinsindeydi ve ölçeklenmiyordu; onu kare genişliğiyle ölçekledim ve bu
YANLIŞTI. Gerekçe "640'ta elenen tek piksellik çöp, 1920'de 3×3'lük bir
küme olur" idi; premis yanlış, çünkü baskın gürültü kaynağı JPEG'in 8×8
DCT blokları ve sensör gürültüsü — ikisi de piksel biriminde sabit,
çözünürlükle büyümüyorlar. Ölçeklenen tek şey gerçek nesneler oldu.

Sahada sonucu ölçüldü: 1920'de yarıçap 6, yani 13×13 pencere.

| şekil | eski (13×13 açma) | yeni (açma 5×5, kapama 13×13) |
|---|---|---|
| 16 px (6 mm) dolu daire | **0 leke** — tamamen silindi | 1 leke, 193 px |
| 20 px (8 mm) dolu daire | 1 leke, 225/305 px | 1 leke, 305 px |
| iki loplu kotiledon 22×9 px | **0 leke** — tamamen silindi | 1 leke, 277 px |

Panel "hiç yeşil leke kalmadı, eşiği düşürün" diyordu; eşikle ilgisi
yoktu, maskeyi morfoloji siliyordu. Açma (aşın→genişlet) YIKICI, kapama
(genişlet→aşın) YAPICI — ikisini tek sayıya bağlamak, yaprağın içindeki
boşluğu doldurmak için büyütülen yarıçapın fideyi de silmesi demekti.
Açma artık **en küçük kabul edilen lekeye** bağlı (penceresi o lekenin
eşdeğer çapının üçte birini geçemiyor: saklamaya karar verdiğimiz şeyi
silen bir açma kurulamıyor), kapama ise çözünürlükle ölçekleniyor.

**Morfolojinin SIRASI yanlıştı: önce kapama, sonra açma.** `ac_kapa`
önce açma yapıyordu ve gerekçesi "önce temizle sonra doldur; tersi
gürültüyü büyütür" idi. O gerekçe sağlam bir nesnenin üstündeki tuz
gürültüsü için doğru, **gözenekli** bir nesne için felaket. Yaprak
maskesi gözenekli: damar, gölge, parlama ve JPEG'in kroma altörneklemesi
yüzünden yaprağın içi delik deşik çıkıyor, eşiği geçen piksel oranı
yaprağın ancak %60'ı kadar. Açma ise pencerenin TAMAMEN dolu olmasını
istiyor; öyle pencere neredeyse hiç yok ve açma yaprağı silip atıyor.

Ölçüldü (1920×1440, dört fesleğen fidesi, maske %62 dolu, üstüne 1010
piksel dağınık gürültü):

| | piksel | bileşen | ≥80 px leke |
|---|---|---|---|
| ham maske | 1673 | 1014 | 4 |
| AÇ→KAPA (eski) | **45** | 4 | **0** |
| KAPA→AÇ (yeni) | 1174 | 4 | **4** |

Fidenin 663 pikselinden geriye 45 piksel kalıyordu ve hiçbiri en küçük
fide kapısını geçemiyordu — panelde "38 leke, hepsi kapının altında"
tam olarak buydu. Sıra değişince dört fide de bütün birer leke (~290 px)
olarak çıkıyor ve gürültünün 1010 pikselinin **tamamı yine eleniyor**;
yani sıranın tersine çevrilmesi gürültüyü içeri almıyor.

**Ara adımlar artık ölçülüyor.** "Leke neden bu kadar küçük ve parçalı"
sorusu ancak her aşamanın kaç piksel ve kaç bileşen bıraktığı görülünce
cevaplanıyordu; tek bir "0 leke" çıktısıyla morfolojinin mi eşiğin mi
kapının mı yediği anlaşılmıyordu. `asamalar` üç aşamayı da veriyor:
renk kapılarından çıkan ham maske, morfoloji sonrası, en küçük fide
kapısı sonrası — her biri için piksel, bileşen ve en büyük leke.

**Tanı "parçalı" durumunu ayrı bir sebep olarak söylüyor.** Lekelerin
hepsi kapının altındaysa ama toplamları kapıyı geçiyorsa, sebep kapının
yüksekliği değil maskenin fideyi bütün çıkaramaması. O durumda "en küçük
fideyi düşürün" yanlış yönlendirme — kapı zaten düşük, düşürmek
gürültüyü içeri alır. Aynı şekilde eşik 0.4 üstündeyse (0.06 yerine 0.6
yazmak kolay) tanı önce onu söylüyor: ExG ölçeğinde yaprak 0.1–0.6
arasında, o eşik yalnız en koyu yeşili geçirir.

**Kamera yatağa bakıyor mu — ölçülebilir hâli.** `tespit.kadraj_ortusme()`
kadrajı bir ızgarayla tarayıp her noktanın yatak koordinatını çıkarıyor
ve dikim alanının içinde kalan oranı ile kadrajın yatak koordinatındaki
sınırlarını veriyor. Sıfır çıkması kesin bir şey söylüyor: bu kamera
yatağı hiç görmüyor, hangi eşik konursa konsun fide bulunamaz. Yüksek
çıkması ise kanıt değil — kamera fiziksel olarak çevrildiyse kalibrasyon
eskimiştir ve eski sayılar kadrajı hâlâ yatağın üstünde gösterir. Gerçek
denetim önizleme karesine bakmak.

**Karenin kendisi de ölçülüyor.** "Filiz bulunamadı" üç ayrı şey
olabiliyor ve üçünün çaresi farklı: karede gerçekten yeşil yok, kare
aşırı pozlanmış/karanlık (yeşil **ölçülemez**), ya da yeşil var ama renk
kapıları eledi. `goruntu.kare_kalitesi()` parlaklığı, doymuş piksel
oranını ve netliği veriyor; `tani` alanı da tek cümlelik gerekçeyi.
Doymuş bir karede "eşiği düşürün" öğüdü yanlıştır — kırpılmış piksel
(255,255,255) gerçek renginden bağımsız olarak nötr okunur, yaprak da
beyaz çıkar. Aynı sebeple beyaz dengesi artık doymuş pikselleri norma
katmıyor: parlak bir pencere üç kanalı da aynı tavana dayayıp düzeltmeyi
sıfıra indiriyordu, yani en çok düzeltme gereken karede hiçbir şey
yapmıyordu.

## Bahçe modu

Panelin ikinci katmanı: bahçeyle uğraşan ama robotla uğraşmak istemeyen
biri için. Teknik sekmeler olduğu gibi duruyor — bu onların yerine değil,
önlerine geliyor.

**Kural: bu katman kendi verisini tutmuyor.** Bitkiler aynı nokta
deposundan, tür bilgisi aynı katalogdan, nem aynı sensörden geliyor;
sulama `/api/toplu` ile, ekim aynı ekim akışıyla yazıyor. Panelde ne
yazıyorsa bahçede de o yazıyor, çünkü ikisi aynı satırı okuyor. İki ayrı
gerçek olsaydı hangisinin doğru olduğunu kimse bilemezdi.

### Zemin çizim değil, kendi toprağınız

Tahtanın zemini **üst kameranın canlı karesi**. Çizilmiş bir yatak güzel
durur ama yalan söyler: ekranda gördüğüne bakıp "toprağım kurumuş"
diyemezsin. Kare tahtayı germiyor, kendi milimetre yerine oturuyor — yani
fotoğraftaki toprak parçası gerçekte bulunduğu yerde görünüyor ve
bitkinin yayılım halkasıyla fotoğraftaki yeşil aynı yere düşüyor.

Nereye oturacağını iki model söyleyebiliyor ve **varsa harita kazanıyor**:

* **harita** — dört AprilTag'den çıkan 3x3 homografi. Perspektifi de
  taşıyor. Kamera yatağa sert açıyla bakıyor ve sahada ölçüldü: ölçek +
  dönme modeli 52 mm, harita 9 mm yanıldı.
* **ölçek + dönme** — `ofset_x/y` merkez, `genislik_px × mm_px` ölçü,
  `donme` açı. Harita yokken aynen geçerli; hiçbir kurulum değişmiyor.

Tohumu toprağa bırakınca bırakma noktası kameranın `mm_px` ölçeğiyle
milimetreye çevriliyor, nokta deposuna gerçek bir bitki olarak giriyor ve
ekim kuyruğa alınıyor.

**Kalibre değilse kırılmıyor.** Ölçek yoksa piksel–milimetre dönüşümü
yapılamaz; ekran çizilmiş yatağa düşüyor, tek satırla sebebini söylüyor
(*"Üst kamera henüz ölçeklenmedi… Bahçe çalışıyor"*) ve her şey — sulama,
hasat, kartlar — çalışmaya devam ediyor. "Önce kalibre et" demek,
bahçesine bakmak isteyen birini kamera ayarına göndermek olurdu.

### Ekran koordinatı ölçülüyor, hesaplanmıyor

Tahta eğik duruyor (CSS 3B dönüşümü). Parmağın değdiği pikselin hangi
milimetreye denk geldiğini dönüşüm matrisini elle çarparak bulmak,
CSS'teki her değişiklikte sessizce kayacak bir hesap demekti. Onun yerine
düzlemin dört köşesine görünmez ölçü noktaları konuyor, gerçek ekran
yerleri `getBoundingClientRect` ile okunuyor ve aradaki izdüşüm
(homografi) buradan çıkarılıyor. Tarayıcı ne çiziyorsa hesap onu izliyor.
Perspektif varken dönüşüm afin değil projektif — üç nokta yetmiyor, dördü
gerekiyor.

### Soru sorulmuyor, işler sıraya giriyor

Makine tek dizi çalıştırabiliyor; ikinci istek teknik panelde doğru
biçimde reddediliyor. Bahçede bu yanlış olurdu: iki bitkiye arka arkaya
dokunan birine "makine meşgul" demek, kullanıcıyı makinenin takvimine
uydurmak demek. Burada işler **kuyruğa** giriyor (`sunucu/kuyruk.py`),
kullanıcı devam ediyor, robot sırayla yapıyor.

Kuyruk güvenliği aşmıyor: her iş yine `/api/toplu`dan, yani aynı
çözümleme, aynı yasak bölge ön kontrolü, aynı sınır denetiminden geçiyor.
Kuyruk bir kestirme değil, bir bekleme odası. Bellekte duruyor, diske
yazılmıyor — sunucu yeniden başladığında istenmeyen işleri saatler sonra
yapmasın diye.

**Ekimin "tohum ucta mı" onayı duruyor** ve durmalı: makinenin tohumu
gerçekten aldığını doğrulayan tek şey o. Bahçe onu bir soru kutusu olarak
değil, kuyruk şeridinde tek bir düğme olarak gösteriyor — makine
bekliyor, kullanıcı beklemiyor.

### Ne gerektiği bir bakışta

* Susayan bitkinin üstünde **damla**, hasadı gelenin üstünde **sepet**.
  İkisi birden olabiliyor ve ikisi birden görünüyor.
* Her bitkinin etrafında **türün gerçek yayılma çapı** kadar bir halka;
  iki halka çakışırsa ikisi de renk değiştiriyor. Kimse milimetre
  hesaplamıyor.
* Sulama başlığı Z ekseninin yanında (`sulama_basligi.dx/dy`, bu makinede
  60 mm), o yüzden kenarda suyun gidemediği bir şerit var. Bu bir hata
  kutusuyla değil, tahtada **taralı gölge** olarak duruyor; sulama kabını
  tutunca belirginleşiyor. Kullanıcı yasağı okuyarak değil görerek
  öğreniyor. Dikim alanının dışı da karartılıyor: toprağın olduğu yer
  aydınlık.
* Ekrandaki robot makinenin bildirdiği konumda. Hareket etmiyorsa
  görünmüyor — süslemek için hareket eklenmedi.

### Görev kartları — hepsi gerçek ölçütten

Bahçeyi açınca bugün ne gerektiğini söylüyor ve **her kart hangi ölçütten
doğduğunu yazıyor**. Uydurma görev yok; ölçüt yoksa kart da yok.

| Kart | Ölçüt |
|---|---|
| Sulama | Tür eşiği açıksa (`sulama_nem_esigi` < %100) ve bitkinin 100 mm yakınında son 24 saatte toprak nemi okuması varsa **ölçülen nem**; yoksa **son sulamadan geçen gün**. Hangisi kullanıldıysa kartta yazıyor. |
| Hasat | Ekim tarihi **bilinen** bitkilerde `days_to_harvest` doldu mu. Tarih yoksa kart yok — "hasadın geldi" demek uydurma olurdu. |
| Boş yer | Dikim alanının içinde, yumuşak sınırların içinde ve hiçbir bitkinin yayılım çemberine girmeyen yerler. **Türü kullanıcı seçiyor** (aşağıya bakın). |

Nem kanıtı sulama akışının kullandığının aynısı (`sulama.en_yakin_nem`) —
kopyalanmıyor, çağrılıyor. İkisi ayrışsaydı bahçe "susadı" derken sulama
"atlandı" derdi.

#### Kart sayıyı gösteriyor, ölçütü değil

"Ölçüt: ölçülen toprak nemi" yazıp sayıyı saklamak, gerekçe göstermemekle
aynı şeydi. Kart artık her bitki için tek satır yazıyor:

```
Marul   %32  < eşik %40      0 mm · 17 dk önce
```

Yani kaç ölçülmüş, eşik kaç, okuma bitkiye **ne kadar yakın** alınmış ve
**ne kadar taze**. Dördüncü satırdan sonrası "+2 bitki daha"ya katlanıyor;
hepsi kartın `title`ında duruyor.

**Tahmin saklanmıyor.** Ölçüm yoksa ya da eşik kapalıysa karar son
sulamadan geçen güne dayanıyor ve kart bunu açıkça yazıyor — satır sarı
kenarlı ve altında *"Bu karar ÖLÇÜME değil, son sulamadan geçen güne
dayanıyor"* duruyor. Kimi bitkide ölçüm varken kimisinde yoksa ölçüt
*"kimi ölçülen nem, kimi geçen gün"* olarak yazılıyor ve kaç tanesinin
tahmin olduğu söyleniyor. Bir kararın neye dayandığını gizlemek, o karara
güvenilip güvenilmeyeceğini kullanıcıdan saklamaktır.

**Eşik kartın içinde.** Nem eşiği tür ayarlarının dibinde duruyordu ve
bahçeden görünmüyordu — hâlbuki kartın söylediği her şeyi belirleyen sayı
o. Kutuya bir sayı yazmak, kartta adı geçen türlerin **tür ezmesini**
yazıyor (`POST /api/bahce/esik` → `turler.kaydet`); yeni bir ayar
mekanizması yok, teknik panelin yazdığı yerin aynısı. %100 "kapalı"
demek ve kutu bunu söylüyor. Bir bitkinin kendi `ozel.sulama_nem_esigi`
değeri tür ezmesini yeniyor; öyle bitkiler varsa **adlarıyla** bildiriliyor
— sessizce yazıp "oldu" demek, değişmeyen bir sayıyı değişmiş gibi
göstermek olurdu.

**Seri sayacı** da uydurma değil ve yeni bir dosya tutmuyor: ekim tarihi,
sulama damgası ve arşivdeki fotoğrafın tarihi zaten kayıtlı; "o gün
bahçeye dokunuldu" bu üçünün birleşimi. Bugün henüz bir şey yapılmadıysa
seri hemen bozulmuyor — saat dokuzda "serin bitti" demek günün kalanını
yok saymak olurdu.

#### Türü kullanıcı seçiyor, biz seçmiyoruz

Kart eskiden "en son ekilen tür"ü kendi seçip *"dikim alanında 12 tane
daha maydanoz sığıyor"* diyordu. Maydanozu kullanıcı seçmemişti; ekranın
kendi kendine bir tür seçip onu öneriyor olması, kullanıcının kararını
ekranın vermesiydi.

Şimdi kart *"5 boş yer var — ne ekelim?"* diyor ve tohum rafındaki türleri
sıralıyor. Bir tür seçilince sayı **o türün yayılım çapından** yeniden
hesaplanıyor (`GET /api/bahce/bos-yer?tur=`): aynı yatakta havuç (100 mm)
beş tane alıyor, roka (150 mm) iki, marul (250 mm) hiç. **Seçilmeden `Ek`
çalışmıyor.**

Başlıktaki ilk sayının da bir tabanı olmak zorunda — yayılım bilinmeden
kaç tane sığdığı hesaplanamaz. Taban, **haznedeki en dar yayılımlı tohum**;
yani "en iyi ihtimalle bu kadar". Kart bunu saklamıyor, taban türü adıyla
gerekçesinde yazıyor. Haznede tohumu olmayan türler listede **silik**
duruyor ve seçilirse *"haznede bu tohum yok — ekim reddedilir"* yazıyor:
listeden çıkarmak "neden yok" sorusunu doğururdu, sessizce kabul etmek de
makinenin reddedeceği bir işi sıraya sokmak olurdu.

#### "Yarın sor" — erteleme bir söz veriyor

Eski "Sonra" düğmesi kartı yalnız **ekrandan** siliyordu: sayfa
yenilenince geri geliyordu ve kullanıcı erteledi mi, iptal mi etti, bir
daha sorulacak mı bilmiyordu. Şimdi düğmenin adı ne yaptığını söylüyor ve
basılınca kartın üstünde *"yarın 07:00 yeniden soracağım"* yazıyor; kart
ancak o okunacak kadar bekledikten sonra uçuyor. Şeritte tek satır
kalıyor: *"Hasat kartı yarın 07:00 geri gelecek · Şimdi göster"*.

Sabit bir saat, "24 saat sonra"dan iyi: kart gece yarısı geri gelmiyor ve
ne zaman geleceği tam olarak biliniyor.

Erteleme **yazılıyor** — bahçe katmanının kendi verisini tutmama kuralının
tek istisnası. Bir erteleme ölçümden türetilemez, o bir karardır. Yeni bir
dosya açmıyoruz: zaten var olan SQLite'a tek satırlık bir tabloya
(`bahce_erteleme`) yazıyoruz ve yazılamazsa belleğe düşüyoruz — erteleme
kaybolabilir ama kartlar çalışmaya devam eder.

#### Kart şeridi ile tahta aynı hesaptan besleniyor

Kart "4 bitki susadı" diyorsa tahtada **tam o dört bitkinin** üstünde
damla var. Susama ve hasat hâli artık bir kez hesaplanıyor
(`_bahce_veri` → `durumlar`) ve hem bitki listesine hem `bahce.kartlar()`a
aynı sözlükten veriliyor. Eskiden ikisi ayrı ayrı çağırıyordu; aynı
girdilerle aynı sonucu verdikleri için pratikte tutuyorlardı ama bu bir
tesadüftü — biri değiştiğinde ekranda "4 bitki susadı" yazarken tahtada üç
damla olurdu ve hangisinin doğru olduğu belli olmazdı.

### Büyüme filmi

Her bitkinin **kendi fotoğraflarından** yapılmış, tohumdan bugüne bir
filmi var (`sunucu/arsiv.py`).

Kare halkası buna yetmiyor ve yetmemeli: halka kamera başına 12 kare
tutuyor, amacı "az önce ne gördü". Arşiv ayrı ve seyrek — bitki başına
günde bir, üst kameranın karesinden **kırpılmış** küçük bir kare. Tam kare
40–100 KB, kırpılmış kare 5–8 KB: 20 bitki × 120 gün ≈ 17 MB. Tam kare
saklasaydık 200 MB olurdu.

Üç karar filmi film yapıyor:

* **Pencere sabit.** Kırpma penceresi bitkinin o anki yayılımına göre
  değil, TÜRÜN OLGUN yayılımına göre (`spread_mm × 1.8`). Yaşa göre
  büyüyen bir pencerede bitki her karede aynı boyda görünür — yani büyüme
  filmi büyümeyi göstermez. Sabit pencerede fide küçük başlar ve kareyi
  doldurur.
* **Bitki hep ortada.** Pencere kareye sığmıyorsa kaydırılmıyor,
  küçültülüyor. Kaydırmak daha çok toprak gösterirdi ama bitki köşeye
  kayar ve film büyüme yerine kayma gösterirdi. Bitki yerinden
  oynamadığı için küçültülmüş pencere de ömrü boyunca aynı kalıyor.
* **Film bir EKİME ait, bir ada değil.** Klasör adı `<nokta>_<ekim
  damgası>`. Hasat edilip aynı ada yeniden ekilen bir yerde eski bitkinin
  fotoğrafları yeni bitkinin filmine karışırdı; "tohumdan bugüne" demek,
  "bu koordinatta bugüne kadar" demek değil.

Kareler kendiliğinden birikiyor (sunucuda beş dakikada bir bakılıyor,
bitki başına en fazla günde bir çekiliyor); "Fotoğraf" düğmesi hem şimdi
bir kare çekiyor hem filmi açıyor. Makine bunun için hareket etmiyor —
üst kamera yatağın tamamını zaten görüyor ve filmin tutarlı olması için
bütün kareler aynı kameradan gelmeli.

Toplam arşiv 80 MB'ı aşarsa en eski kareler siliniyor.

### Bitkiye dokunmanın beş yolu

Halka menü (tek dokunuş) tek başına yetmiyordu: bahçede insan bakar,
karıştırır, taşır. Aynı parmakla yapılan işler:

| Hareket | Ne oluyor | Neden böyle |
|---|---|---|
| **Dokun** | Halka menü — su, hasat, fotoğraf | En sık yapılan üç iş, alt sayfa açmadan |
| **Uzun bas (480 ms)** | Bitki kartı — yaş, hasat günü, son sulama, yayılım, gerekçe, film şeridi, dört düğme | Menüye sığmayan her şey; kartta **ham koordinat yok** |
| **Sürükle** | Bitkiyi toprakta taşı | Yanlış yere ekilmiş bir fideyi düzeltmenin başka yolu yoktu |
| **İki parmak / tekerlek** | Yakınlaştır, kaydır | 7" ekranda fide simgesi 20 px; yakınlaşmadan hangi bitkiye dokunulduğu belli olmuyor |
| **"Birkaç bitki seç" + kutu** | Çoklu seçim, sonra tek toplu iş | Altı bitkiyi tek tek sulamak altı ayrı iş demekti |

Düğmenin adı **ne yaptığını**, altındaki satır **nasıl yapıldığını**
söylüyor: *"Bir kutu çizin, içindeki bitkiler seçilsin — ya da tek tek
dokunun."* "Seç" tek başına hiçbir şey anlatmıyordu ve dokunmatikte kimse
kutu çizmeyi kendiliğinden denemez. Seçim varken düğme *"3 bitki seçili"*
yazıyor, kapatan hâli *"Seçimi bitir"*.

Dört karar burada özellikle önemli:

* **Taşımak makineyi hareket ettirmiyor.** Sürükleme, kaydın x/y'sini
  düzeltiyor — "burayı yanlış işaretlemişim" demek. Fideyi gerçekten
  taşımak robotun yapabileceği bir şey değil. Tür ve ekim tarihi
  korunuyor: `/api/bahce/tasi` mevcut kaydı okuyup **üstüne** yazıyor,
  yoksa bitkinin filmi kopardı. Dikim alanının ya da sınırların dışına
  bırakmak 422 ile reddediliyor ve hayalet kırmızıya dönüyor — bırakmadan
  önce görülüyor.
* **Vuruş sınaması ekranda değil, toprakta.** Bitkiler eğik 3B düzlemin
  içinde; oradaki bir öğenin `getBoundingClientRect`i göründüğü yeri
  vermiyor ve seçim kutusu hiçbir bitki bulamıyordu. Kullanıcının çizdiği
  dikdörtgenin dört köşesi ölçülen dönüşümle toprağa çevriliyor ve
  bitkinin toprak koordinatı o **dörtgenin** içinde mi diye bakılıyor.
  Perspektifte dikdörtgenin izdüşümü dikdörtgen değil.
* **Yakınlaştırma eğimin dışında.** Eğim düzlemde, büyütme onun
  dışındaki katmanda (`#bh-zum`). Tek zincirde olsalardı büyütme
  izdüşümden önce uygulanır ve parmağın altındaki nokta kayardı. Şimdi
  ölçülüyor: yakınlaşmadan önceki toprak noktası, yakınlaştıktan sonra
  yeniden ölçülüp kaydırma farkı kadar düzeltiliyor — 1 mm içinde
  yerinde kalıyor.
* **Parmak ekrandayken tahta boyu değişmiyor.** Seçim ve sürükleme
  başladıkları andaki ekran ölçüsüne dayanıyor; tahta ortada büyürse kutu
  toprakta bambaşka bir yere denk gelir.

### Kameralar bahçenin içinde

Zemin zaten üst kameranın karesi; iki ek yer daha var.

* **Kamera şeridi** — tahtanın altında iki küçük canlı pencere (üst ve
  uç). Kapalıyken uç kamerası akmıyor; açıkken boşta **1 kare/sn**, bir iş
  çalışırken **4 kare/sn**. Robot hareket ederken uçtan bakmak, ekranda
  olanın gerçekten olduğunu doğrulamanın en kısa yolu.
* **"Yakından bak"** (bitki kartında) — robotu bitkinin üstüne gönderiyor
  ve şeridi kendiliğinden açıyor. Bu bir ziyaret işi, kuyruğa giriyor;
  ayrı bir hareket yolu açmıyor.

### Sunucu gidip gelince

`bash guncelle.sh` sunucuyu yeniden başlatıyor. Panel açık kalırsa o
sırada uçan istek ağ düzeyinde düşüyor ve ekranda `Failed to fetch`
görülüyordu. Üç şey değişti:

* Not satırı **anahtarlı**: yükleme, işlem ve zemin notları ayrı
  tutuluyor. Eskiden zemin çizimi saniyede bir `notYaz("")` çağırıyor ve
  hata uyarısını bir saniye sonra siliyordu — kullanıcı sebebini
  okuyamıyordu.
* Sebebe göre ayrı söz: ağ kesintisi ("yeniden başlıyor, kendim yeniden
  deneyeceğim"), 404 ("sunucu eski, Pi'de `bash guncelle.sh`"), 401
  ("parola kabul edilmedi"). Arka planda 1,2 → 2,5 → 5 → 8 sn ile yeniden
  deneniyor ve **ekrandaki bahçe silinmiyor**.
* WebSocket yeniden bağlanınca sürüm damgası tazeleniyor ve bahçe
  kendiliğinden yeniden okunuyor.

### Dokunmatik ve ısınma

Ekran Raspberry'nin 7" dokunmatiğinde parmakla kullanılıyor: dokunulan
her şey en az 48 px, halka menü düğmeleri 68 px. Sürükleme gerçek
işaretçi olaylarıyla, 4 piksel ölü bölgeyle (dokunmatikte parmak hep
biraz kayıyor; her dokunuş sürükleme sayılırsa tohuma basmak imkânsız).

Alçak ya da dar ekranda görev kartları tek satıra iniyor ve yan yana
kaydırılıyor; açıklama ve ölçüt kartın `title`ında kalıyor. Tahtanın
yüksekliği kartların altında **ekranda kalan yere** göre hesaplanıyor —
sabit bir oran, üç kart varken tahtayı ekranın dışına itiyordu.

Isınma tarafında dört önlem var:

* Canlı zemin **1 kare/sn** (Kamera sekmesi 5 istiyor; toprak o kadar hızlı
  değişmiyor). Sekmeden çıkınca akış duruyor.
* Bahçe açıkken **3B sahne çizmiyor** (`Tarla.gorunurluk(false)`).
* **Sakin mod**: bütün canlandırmayı durduran tek düğme, seçim
  hatırlanıyor.
* Sekmeye girerken **bir saniyelik kare süresi ölçülüyor**; tarayıcı
  yetişemiyorsa sakin moda kendiliğinden geçiliyor ve sebebi yazılıyor.
  Cihazı çekirdek sayısından tahmin etmedik — aynı Pi'de tarayıcı
  hızlandırma açık ve kapalıyken arasındaki fark on kat.

Sekme arkaya alınınca (`visibilitychange`) canlandırma da duruyor.

## Sırada ne var

- [x] Nokta deposu ve "şu noktaya git"
- [x] Tohum ızgarası
- [x] Yasak bölgeler (`allow_if` koşullu)
- [x] Üç sabit baş, baş başına kayma, tohum ucunun kendi ekseni
- [x] Kayıtlı program çalıştırma
- [x] Kamera görüntüsü
- [x] 3B tarla tasarımcısı (bitki yerleşimi, yayılım çakışması)
- [x] Bahçe modu (kullanıcı katmanı, canlı kamera zemini, büyüme filmi)
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
