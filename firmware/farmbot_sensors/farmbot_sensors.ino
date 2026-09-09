/*
 * FarmBot — sensör okuma, röle ve uç seçici servo
 * -----------------------------------------------
 * Arduino Uno. Yaptığı üç şey var:
 *   1. Sensörleri okuyup 2 saniyede bir tek satır JSON basmak.
 *   2. Pi'den gelen ROLE komutuyla iki röleyi açıp kapatmak.
 *   3. Pi'den gelen UC komutuyla uç seçici servoyu bir açıya sürmek.
 *
 * Başka bir şey yapmıyor. Karar vermiyor, eşik tutmuyor, HİÇBİR ŞEYİ
 * HATIRLAMIYOR. Sulama kararı Pi'de; kart yalnızca dediğini yapıyor ve
 * ne yaptığını geri söylüyor. Uç açıları da kartta DEĞİL: hangi ucun
 * hangi açıda olduğu ayar dosyasında (`ajan/uclar.json`) duruyor ve her
 * komutla birlikte geliyor — gerekçesi UC komutunun başlığında.
 *
 * TESİSAT
 *   D2   DHT11 veri
 *   D7   su pompası rölesi
 *   D8   hava pompası rölesi
 *   D9   uç seçici servo (sinyal)
 *
 * RÖLE KONTAĞI: pompalar şu an NC ucunda ve bu bilerek böyle bırakıldı —
 * kutuplama aşağıda ona göre ayarlı. Bilinmesi gereken sonucu var:
 * bobin enerjisizken COM–NC kapalı olduğu için kart kapalıyken,
 * sıfırlandığında, USB çıktığında ve açılışta önyükleyicinin beklediği
 * 1-2 saniye boyunca POMPA ÇALIŞIR. Yazılım bu anlarda çalışmıyor, yani
 * engelleyemiyor. Makineyi başıboş bırakmayın; su hattını uzun süre
 * gözetimsiz açık tutacaksanız pompa kablosunu NO ucuna alın, sonra
 * aşağıdaki satırı 1 yapın.
 *   A1   toprak nemi probu — iki uçlu, tool ucuna takılı, toprağa daldırılır
 *   A4/A5 GY-68 / BMP180 (I2C)
 *
 * Pi'ye giden satır:  VERI:{...}
 * Pi'den gelen komut: ROLE <su_pompasi|hava_pompasi> <0|1>
 *                     UC <indeks> <derece> <sure_ms>
 *                     KAPAT        — ikisini birden kapat
 *                     OKU          — beklemeden hemen ölç
 */

#include <Wire.h>
#include <Adafruit_BMP085.h>
#include <DHT.h>
#include <Servo.h>

// --------------------------------------------------------------- AYARLAR --
#define DHT_PIN        2
#define SU_POMPASI_PIN 7
#define HAVA_POMPASI_PIN 8
/* Tek toprak sensörü var ve tool ucunda: makine nereye giderse ölçüm
 * oradan geliyor. Eskiden yatağa sabit ikinci bir sensör varsayılıyordu
 * (A0); yok. Boş bir pini okumak, panelde gerçek veri gibi görünen
 * anlamsız sayı üretmek demekti.
 *
 * Ölçek: kuru toprakta değer YÜKSEK, ıslakta düşük. Yüzdeye çevirmek
 * panelin işi, ham değer olduğu gibi gidiyor. */
#define TOPRAK_PIN     A1

/* 0 = "aç" dediğimizde pine HIGH gidiyor. Bu, kartın kutuplamasıyla değil
 * KONTAKLA ilgili bir seçim: pompalar NC ucunda olduğu için pompayı
 * çalıştırmak bobini BIRAKMAK demek, çekmek değil. Yukarıdaki nota bakın.
 *
 * Pompa kablosunu NO ucuna alırsanız burayı 1 yapın. */
#define ROLE_AKTIF_LOW 0

#define SERVO_PIN      9

#define OLCUM_ARALIGI_MS 2000

// --------------------------------------------------------------- DURUM ----
/* DHT tipi ELLE SEÇİLMİYOR. Yanlış tip seçilince kütüphane sessizce NaN
 * döndürüyor: panelde sıcaklık ve nem kartları hiç görünmüyor ve sensör
 * bozuk sanılıyor. Açılışta ikisi de deneniyor, hangisi okuma veriyorsa o
 * kullanılıyor ve adı panele bildiriliyor. */
DHT dht11(DHT_PIN, DHT11);
DHT dht22(DHT_PIN, DHT22);
DHT *dht = &dht11;
const char *dhtAdi = "DHT11";
Adafruit_BMP085 bmp;
bool bmpVar = false;

// Rölelerin gerçek durumu. Panel bunu tahmin etmiyor, kart söylüyor.
bool suPompasiAcik = false;
bool havaPompasiAcik = false;

/* ------------------------------------------------------------ UÇ SEÇİCİ --
 * SERVODA GERİ BESLEME YOK. Bu kart ne KOMUT ETTİĞİNİ bilir, horn'un
 * gerçekte nerede olduğunu bilmez. Aşağıdaki iki alan da o yüzden
 * "ölçüm" değil "komut edilen değer" ve VERI satırında da öyle
 * okunmalı; Pi tarafı bunları medyan/yuvarlama tablosuna sokmuyor.
 *
 * AÇILIŞTA KONUM BİLİNMİYOR ve sıfır VARSAYILMIYOR: -1 "hiç komut
 * verilmedi" demek. Kart sıfırlanırsa buraya geri düşüyor — `calisma_sn`
 * geriye gittiğinde Pi bunu zaten görüyor.
 *
 * SERVO AÇILIŞTA TAKILMIYOR (attach). Arduino'nun Servo kütüphanesinde
 * `attach()` darbe genişliğini DEFAULT_PULSE_WIDTH'e (1500 us, yaklaşık
 * 90 derece) kuruyor ve sinyali hemen üretmeye başlıyor; yani açılışta
 * attach etmek, horn'u komut vermeden 90 dereceye SÜRMEK demek. Konumun
 * bilinmediğini söyleyip aynı anda ortaya sürmek kendi kendini yalanlar.
 * İlk UC komutunda takılıyor. */
Servo ucServo;
bool ucTakili = false;
int ucSecili = -1;              // komut edilen uç indeksi; -1 = bilinmiyor
int ucAci = -1;                 // komut edilen derece; -1 = bilinmiyor
bool ucHarekette = false;
unsigned long ucKomutMs = 0;
unsigned long ucSureMs = 0;     // hareket süresi — KOMUTLA geliyor, ayardan

unsigned long sonOlcum = 0;
String girisTamponu = "";

// --------------------------------------------------------------- RÖLE -----
/* Pine kapalı seviyeyi YAZIP sonra OUTPUT yapıyoruz. Ters sırada pin bir
 * an LOW kalıyor ve aktif-LOW kartta röle çekiyor: her açılışta pompaya
 * kısa bir darbe demek. */
void roleHazirla(int pin) {
  digitalWrite(pin, ROLE_AKTIF_LOW ? HIGH : LOW);
  pinMode(pin, OUTPUT);
}

void roleYaz(int pin, bool acik) {
#if ROLE_AKTIF_LOW
  digitalWrite(pin, acik ? LOW : HIGH);
#else
  digitalWrite(pin, acik ? HIGH : LOW);
#endif
  if (pin == SU_POMPASI_PIN) suPompasiAcik = acik;
  else if (pin == HAVA_POMPASI_PIN) havaPompasiAcik = acik;
}

/** Hangi DHT takılı? Okuma verene karar veriyoruz.
 *
 * DHT11 önce deneniyor çünkü sahadaki kart o. İlk okuma kütüphane
 * ısınırken NaN dönebiliyor, o yüzden iki deneme yapılıyor. */
void dhtSec() {
  for (int tip = 0; tip < 2; tip++) {
    DHT *aday = tip == 0 ? &dht11 : &dht22;
    aday->begin();
    for (int deneme = 0; deneme < 2; deneme++) {
      /* 2 saniye: DHT11 veri sayfası açılıştan sonra 1 sn kararlılık
       * istiyor, klonlar daha uzun sürebiliyor ve iki okuma arası da en az
       * 2 sn olmalı. 1,2 sn ile ilk deneme sınırda kalıyordu — sağlam bir
       * sensörü "yok" saymak, olmayan bir arızayı aratır. */
      delay(2000);
      if (!isnan(aday->readTemperature())) {
        dht = aday;
        dhtAdi = tip == 0 ? "DHT11" : "DHT22";
        Serial.print("BILGI: DHT tipi ");
        Serial.println(dhtAdi);
        return;
      }
    }
  }
  // İkisi de okumadı: sensör bağlı değil ya da bozuk. Sıcaklık/nem null
  // gidecek, geri kalan ölçümler çalışmaya devam edecek.
  dht = &dht11;
  dhtAdi = "yok";
  Serial.println("UYARI: DHT okumuyor — kabloyu ve D2'yi kontrol edin");
}

// --------------------------------------------------------------- KURULUM --
void setup() {
  /* İLK İŞ BU. Serial.begin bile sonra geliyor: sıfırlamadan bu satıra
   * kadar geçen her milisaniyede pinler GİRİŞ ve boşta duruyor, aktif-LOW
   * röle kartında boşta giriş "röle çeksin" demek.
   *
   * Ama bu, sorunu tamamen çözmüyor ve çözemez: Uno'nun önyükleyicisi
   * setup'tan ÖNCE ~1-2 saniye bekliyor ve o sürede hiçbir komut
   * çalışmıyor. Yani kart her sıfırlandığında pompa bir-iki saniye
   * çalışıyor. Bunun tek gerçek çözümü donanımda: her röle girişinden
   * 5V'a 10K direnç (pin boştayken girişi YÜKSEK, yani röleyi kapalı
   * tutar). Pompanın çekişi kartı sıfırlıyorsa bu kendini besleyen bir
   * döngüye dönüşüyor — röle kartını ve pompaları Arduino'nun 5V'undan
   * değil ayrı bir kaynaktan besleyin. */
  roleHazirla(SU_POMPASI_PIN);
  roleHazirla(HAVA_POMPASI_PIN);
  roleYaz(SU_POMPASI_PIN, false);
  roleYaz(HAVA_POMPASI_PIN, false);

  Serial.begin(9600);
  dhtSec();
  bmpVar = bmp.begin();
  if (!bmpVar) Serial.println("UYARI: BMP180 bulunamadi, digerleriyle devam");

  Serial.println("Hazir. Komutlar: ROLE <ad> <0|1> | UC <indeks> <derece> <sure_ms> | KAPAT | OKU");
}

// ------------------------------------------------------------- UÇ SEÇİCİ --
/* NEDEN AÇI KOMUTLA GELİYOR, ÖNCEDEN KAYDEDİLMİYOR
 *
 * İki biçim vardı: (a) `UC_ACI <indeks> <derece>` ile açıları önceden
 * karta bildirmek ve sonra `UC <indeks>` demek, (b) açıyı her komutta
 * taşımak. (b) seçildi, üç gerekçeyle:
 *
 * 1. KART SIFIRLANIYOR ve bu varsayım değil, ölçülen bir olgu: röle
 *    notunda yazılı olduğu gibi pompa çekişinde besleme çöküyor ve
 *    `calisma_sn` geriye gidiyor. (a) ile sıfırlama açı tablosunu
 *    sessizce siler; sonraki `UC 1` ya hiçbir şey yapmaz ya da eski bir
 *    açıya gider. Servoda geri besleme olmadığı için bunu yakalayacak
 *    hiçbir yol yok. Açı komutun içindeyse sıfırlama tabloyu
 *    bozamaz — bozulacak tablo yok.
 * 2. Kartın kendi ilkesi: "karar vermiyor, hiçbir şeyi hatırlamıyor".
 *    Açı tablosu tutmak kartı yapılandırma taşıyan bir cihaza çevirir ve
 *    "Pi'deki ayar ile karttaki tablo ayrışmış olabilir mi" diye yeni
 *    bir soru doğurur.
 * 3. Ayar değişince "tabloyu karta yeniden gönder" diye bir adım
 *    kalmıyor; unutulacak bir adım da kalmıyor.
 *
 * Bedeli komut başına birkaç bayt. Uç seçimi saatte birkaç kez oluyor.
 *
 * HAREKET SÜRESİ DE KOMUTLA. Aynı gerekçe: süre servonun ve mekanizmanın
 * özelliği, yani bir AYAR. Karta gömmek uydurma bir sabit yazmak olurdu.
 * Eksikse komut reddediliyor — sessizce bir varsayılana düşmek, panelde
 * "vardı" yazarken horn'un hâlâ yolda olması demekti. */
void ucKomut(int indeks, int derece, long sureMs) {
  if (!ucTakili) { ucServo.attach(SERVO_PIN); ucTakili = true; }
  ucServo.write(derece);
  ucSecili = indeks;
  ucAci = derece;
  ucSureMs = (unsigned long)sureMs;
  ucKomutMs = millis();
  /* VARIŞ ANINDA DEĞİL. Servo 90 dereceyi anında dönmüyor; komut yazıldığı
   * anda "vardı" demek, Pi'nin ucu daha yoldayken iş başlatmasına izin
   * verirdi. Süre dolana kadar `uc_hareket` 1 kalıyor. */
  ucHarekette = true;
}

void ucGozet() {
  if (ucHarekette && millis() - ucKomutMs >= ucSureMs) {
    ucHarekette = false;
    sonOlcum = 0;                   // "vardı" bilgisi beklemeden gitsin
  }
}

// --------------------------------------------------------------- KOMUT ----
void komutIsle(String komut) {
  komut.trim();
  if (!komut.length()) return;

  String buyuk = komut;
  buyuk.toUpperCase();

  if (buyuk == "KAPAT") {
    roleYaz(SU_POMPASI_PIN, false);
    roleYaz(HAVA_POMPASI_PIN, false);
    Serial.println("KOMUT: hepsi kapatildi");
    sonOlcum = 0;                 // yeni durum hemen bildirilsin
    return;
  }

  if (buyuk == "OKU") { sonOlcum = 0; return; }

  if (buyuk.startsWith("ROLE ")) {
    // "ROLE su_pompasi 1"
    int b1 = komut.indexOf(' ');
    int b2 = komut.indexOf(' ', b1 + 1);
    if (b2 < 0) { Serial.println("HATA: ROLE <ad> <0|1>"); return; }

    String ad = komut.substring(b1 + 1, b2);
    bool durum = komut.substring(b2 + 1).toInt() != 0;

    if (ad == "su_pompasi")        roleYaz(SU_POMPASI_PIN, durum);
    else if (ad == "hava_pompasi") roleYaz(HAVA_POMPASI_PIN, durum);
    else { Serial.println("HATA: ad su_pompasi ya da hava_pompasi olmali"); return; }

    Serial.print("KOMUT: ");
    Serial.print(ad);
    Serial.println(durum ? " ACIK" : " KAPALI");
    // Panelin düğmeyi beklemeden güncelleyebilmesi için hemen bildir.
    sonOlcum = 0;
    return;
  }

  if (buyuk.startsWith("UC ")) {
    // "UC 1 90 900" — indeks, derece, hareket süresi (ms).
    int b1 = komut.indexOf(' ');
    int b2 = komut.indexOf(' ', b1 + 1);
    int b3 = b2 < 0 ? -1 : komut.indexOf(' ', b2 + 1);
    if (b2 < 0 || b3 < 0) {
      Serial.println("HATA: UC <indeks> <derece> <sure_ms>");
      return;
    }
    int indeks  = komut.substring(b1 + 1, b2).toInt();
    int derece  = komut.substring(b2 + 1, b3).toInt();
    long sureMs = komut.substring(b3 + 1).toInt();
    /* SINIRLAR BURADA DA DENETLENİYOR. Pi zaten deniyor ama kart, seri
     * porta elle yazılan bir komutu da alıyor (bring-up böyle yapılıyor)
     * ve servoyu mekanik sınırının dışına sürmek dişliyi zorlar. */
    if (indeks < 0 || indeks > 2) { Serial.println("HATA: UC indeksi 0-2"); return; }
    if (derece < 0 || derece > 180) { Serial.println("HATA: UC derecesi 0-180"); return; }
    if (sureMs <= 0 || sureMs > 10000) {
      Serial.println("HATA: UC sure_ms 1-10000");
      return;
    }
    ucKomut(indeks, derece, sureMs);
    Serial.print("KOMUT: uc ");
    Serial.print(indeks);
    Serial.print(" -> ");
    Serial.print(derece);
    Serial.println(" derece (gidiyor)");
    sonOlcum = 0;                   // panel beklemeden görsün
    return;
  }

  Serial.println("HATA: bilinmeyen komut");
}

void seriOku() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (girisTamponu.length()) { komutIsle(girisTamponu); girisTamponu = ""; }
    } else if (girisTamponu.length() < 40) {
      girisTamponu += c;
    }
  }
}

// --------------------------------------------------------------- ÖLÇÜM ----
/* JSON'da sayı yerine null basmak gerekebiliyor: sensör okumadıysa 0
 * yazmak "ölçtüm, sıfır çıktı" demek olurdu ve grafikte gerçek bir
 * uçurum gibi görünürdü. */
void sayiYaz(float d) {
  if (isnan(d)) Serial.print("null");
  else Serial.print(d, 1);
}

void olcVeYaz() {
  float nem      = dht->readHumidity();
  float sicaklik = dht->readTemperature();

  float bmpSicaklik = NAN, basinc = NAN, rakim = NAN;
  if (bmpVar) {
    bmpSicaklik = bmp.readTemperature();
    basinc      = bmp.readPressure() / 100.0;
    rakim       = bmp.readAltitude();
  }

  Serial.print("VERI:{\"hava_sicaklik\":");   sayiYaz(sicaklik);
  Serial.print(",\"hava_nem\":");             sayiYaz(nem);
  Serial.print(",\"bmp_sicaklik\":");         sayiYaz(bmpSicaklik);
  Serial.print(",\"basinc\":");               sayiYaz(basinc);
  Serial.print(",\"rakim\":");                sayiYaz(rakim);
  /* Hangi DHT bulundu — ajan makul aralığı buna göre seçiyor (DHT11 ile
   * DHT22'nin çalışma aralıkları farklı) ve panel kartın altına yazıyor. */
  Serial.print(",\"dht\":\"");                 Serial.print(dhtAdi);
  Serial.print("\",\"toprak_nem\":");           Serial.print(analogRead(TOPRAK_PIN));
  Serial.print(",\"r_su_pompasi\":");         Serial.print(suPompasiAcik ? 1 : 0);
  Serial.print(",\"r_hava_pompasi\":");       Serial.print(havaPompasiAcik ? 1 : 0);
  /* UÇ SEÇİCİ — KOMUT EDİLEN DEĞER, ÖLÇÜM DEĞİL. Servoda geri besleme
   * yok; bunlar kartın ne yazdığı, horn'un nerede olduğu değil. Hiç
   * komut verilmediyse (açılış ya da sıfırlama) ikisi de null gidiyor:
   * sıfır yazmak "0 numaralı uç seçili" demek olurdu ve bu, bilinmeyeni
   * bilinen gibi göstermenin ta kendisi. */
  Serial.print(",\"uc_secili\":");
  if (ucSecili < 0) Serial.print("null"); else Serial.print(ucSecili);
  Serial.print(",\"uc_aci\":");
  if (ucAci < 0) Serial.print("null"); else Serial.print(ucAci);
  // 1 = komut verildi ama hareket süresi dolmadı; horn hâlâ yolda.
  Serial.print(",\"uc_hareket\":");          Serial.print(ucHarekette ? 1 : 0);
  /* Kartın açık kaldığı süre. Geriye giderse kart yeniden başlamıştır ve
   * röleler kapanmıştır — pompa çekişinde besleme çökerse tam bunu
   * görüyoruz. Panel sebebi adıyla söyleyebilsin diye gönderiliyor. */
  Serial.print(",\"calisma_sn\":");           Serial.print(millis() / 1000UL);
  Serial.println("}");
}

// --------------------------------------------------------------- DÖNGÜ ----
void loop() {
  seriOku();
  ucGozet();
  if (millis() - sonOlcum >= OLCUM_ARALIGI_MS) {
    sonOlcum = millis();
    olcVeYaz();
  }
}
