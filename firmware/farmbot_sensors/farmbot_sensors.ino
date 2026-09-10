
#include <Wire.h>
#include <Adafruit_BMP085.h>
#include <DHT.h>
#include <Servo.h>

// --------------------------------------------------------------- AYARLAR --
#define DHT_PIN        2
#define SU_POMPASI_PIN 7
#define HAVA_POMPASI_PIN 8

/* Tek toprak sensörü var ve tool ucunda: makine nereye giderse ölçüm
 * oradan geliyor. Ölçek: kuru toprakta değer YÜKSEK, ıslakta düşük.
 * Yüzdeye çevirmek panelin işi, ham değer olduğu gibi gidiyor. */
#define TOPRAK_PIN     A1

/* 0 = "aç" dediğimizde pine HIGH gidiyor. Pompalar NC ucunda olduğu için
 * pompayı çalıştırmak bobini BIRAKMAK demek, çekmek değil. */
#define ROLE_AKTIF_LOW 0

#define SERVO_PIN      9

/* ---------------------------------------------------- SERVO DENEME KİPİ --
 * KONUMLU (NORMAL) SERVO İÇİN. `write(derece)` hedef AÇI veriyor: servo
 * kendi sabit hızıyla oraya gidiyor ve orada duruyor.
 *
 * ÖNCE SÜREKLİ DÖNÜŞLÜ SANILMIŞTI ve kod ona göre yazılmıştı — hız yazıp
 * süreyle açı üretiyordu. Ölçüm bunu çürüttü: `HIZ 150` bir kez hareket
 * edip durdu ve HER değerde AYNI hızla hareket etti. Sürekli dönüşlüde
 * komut hızı belirler, yani 150 ile 120 farklı hızda dönerdi ve hiç
 * durmazdı. Aynı hız + durma = komut açıdır, hız değil.
 *
 * BUNUN SONUCU İYİ: konum tekrarlanabilir, kayma birikmiyor, uçların
 * açıları (`ajan/uclar.json`) doğrudan anlamlı ve mikro switch gerekmiyor.
 *
 * Geri besleme YİNE DE YOK: servo zorlanır ya da takılırsa kart bunu
 * bilemez. Bu yüzden `uc_secili`/`uc_aci` hâlâ "komut edilen", "ölçülen"
 * değil. Fark şu: artık yanlış olduklarında sebep bir arıza, biriken
 * kayma değil. */

/* AÇILIŞTA BAŞLASIN MI? Varsayılan 0 — kart pompa çekişinde sıfırlanıyor
 * ve açılışta kendiliğinden dönen bir servo, uçlar takılıyken istenmez.
 * Seri porttan "TEST" yazınca başlıyor, tekrar yazınca duruyor. */
#define TEST_ACILISTA 0

/* ⚙️ DEĞİŞTİREBİLECEĞİNİZ İNCE AYARLAR — hepsi burada, başka yerde yok. */

/* Denemenin gezeceği açılar. Uçların GERÇEK açıları burada DEĞİL: onlar
 * `ajan/uclar.json`'da duruyor ve UC komutuyla geliyor (gerekçesi UC'nin
 * başlığında). Bu liste yalnız mekanizmayı gözle görmek için — ölçtükten
 * sonra buraya kendi açılarınızı yazıp uçların gerçekten hizalandığını
 * doğrulayabilirsiniz. */
const int testAcilari[]     = {0, 90, 180, 90};
const int hareketSuresi     = 800;  // servonun hedefe varması için beklenen süre (ms)
const int duraklardaBekleme = 3000; // her açıda kaç ms beklesin

const int TEST_ACI_SAYISI = sizeof(testAcilari) / sizeof(testAcilari[0]);

#define OLCUM_ARALIGI_MS 2000

// --------------------------------------------------------------- DURUM ----
/* DHT tipi ELLE SEÇİLMİYOR. Yanlış tip seçilince kütüphane sessizce NaN
 * döndürüyor ve sensör bozuk sanılıyor. Açılışta ikisi de deneniyor. */
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
 * SERVODA GERİ BESLEME YOK. Kart ne KOMUT ETTİĞİNİ bilir, horn'un gerçekte
 * nerede olduğunu bilmez. -1 "hiç komut verilmedi" demek.
 *
 * SERVO AÇILIŞTA TAKILMIYOR (attach): `attach()` darbe genişliğini 1500 us'e
 * kurup sinyali hemen üretmeye başlıyor, yani açılışta attach etmek horn'u
 * komut vermeden 90 dereceye SÜRMEK demek. İlk komutta takılıyor. */
Servo ucServo;
bool ucTakili = false;
int ucSecili = -1;              // komut edilen uç indeksi; -1 = bilinmiyor
int ucAci = -1;                 // komut edilen derece; -1 = bilinmiyor
bool ucHarekette = false;
unsigned long ucKomutMs = 0;
unsigned long ucSureMs = 0;     // hareket süresi — KOMUTLA geliyor

unsigned long sonOlcum = 0;
String girisTamponu = "";

/* Deneme kipinin durumu. Sizin kodunuzdaki döngünün aynısı, ama `delay`
 * yerine `millis` ile: `delay` bu sketch'te olmaz — servo dönerken sensör
 * okuması ve seri komutlar da durur, kart 3 saniye sağır kalır. */
bool testAcik = false;
/* İleri bildirim: `ucKomut` bu dosyada `testDurdur`dan ÖNCE tanımlı. */
void testDurdur();
void testBasla();   // setup, TEST_ACILISTA 1 iken bunu çağırıyor
unsigned long testAdimMs = 0;   // bu adım ne zaman başladı

// --------------------------------------------------------------- RÖLE -----
/* Pine kapalı seviyeyi YAZIP sonra OUTPUT yapıyoruz. Ters sırada pin bir
 * an LOW kalıyor ve aktif-LOW kartta röle çekiyor. */
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

/** Hangi DHT takılı? Okuma verene karar veriyoruz. */
void dhtSec() {
  for (int tip = 0; tip < 2; tip++) {
    DHT *aday = tip == 0 ? &dht11 : &dht22;
    aday->begin();
    for (int deneme = 0; deneme < 2; deneme++) {
      /* 2 saniye: DHT11 veri sayfası açılıştan sonra 1 sn kararlılık
       * istiyor, klonlar daha uzun sürebiliyor. */
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
  dht = &dht11;
  dhtAdi = "yok";
  Serial.println("UYARI: DHT okumuyor — kabloyu ve D2'yi kontrol edin");
}

// --------------------------------------------------------------- KURULUM --
void setup() {
  /* İLK İŞ BU. Serial.begin bile sonra geliyor: sıfırlamadan bu satıra
   * kadar pinler GİRİŞ ve boşta duruyor, aktif-LOW röle kartında boşta
   * giriş "röle çeksin" demek. */
  roleHazirla(SU_POMPASI_PIN);
  roleHazirla(HAVA_POMPASI_PIN);
  roleYaz(SU_POMPASI_PIN, false);
  roleYaz(HAVA_POMPASI_PIN, false);

  Serial.begin(9600);
  dhtSec();
  bmpVar = bmp.begin();
  if (!bmpVar) Serial.println("UYARI: BMP180 bulunamadi, digerleriyle devam");

  Serial.println("Hazir. Komutlar: ROLE <ad> <0|1> | UC <indeks> <derece> <sure_ms> | KAPAT | OKU | TEST | ACI <0-180>");
#if TEST_ACILISTA
  testBasla();
#endif
}

// ------------------------------------------------------------- UÇ SEÇİCİ --
/* Açı ve süre KOMUTLA geliyor, kartta saklanmıyor: kart pompa çekişinde
 * sıfırlanıyor ve saklanan bir tablo sessizce silinirdi. Servoda geri
 * besleme olmadığı için bunu yakalayacak hiçbir yol yok. */
void ucKomut(int indeks, int derece, long sureMs) {
  /* Deneme kipi açıkken gelen gerçek bir uç komutu denemeyi kapatıyor:
   * ikisi aynı servoyu sürüyor. */
  if (testAcik) testDurdur();
  if (!ucTakili) { ucServo.attach(SERVO_PIN); ucTakili = true; }
  ucServo.write(derece);
  ucSecili = indeks;
  ucAci = derece;
  ucSureMs = (unsigned long)sureMs;
  ucKomutMs = millis();
  /* VARIŞ ANINDA DEĞİL. Komut yazıldığı anda "vardı" demek, Pi'nin ucu
   * daha yoldayken iş başlatmasına izin verirdi. */
  ucHarekette = true;
}

void ucGozet() {
  if (ucHarekette && millis() - ucKomutMs >= ucSureMs) {
    ucHarekette = false;
    sonOlcum = 0;                   // "vardı" bilgisi beklemeden gitsin
  }
}

// ---------------------------------------------------- SERVO DENEME KİPİ --
/* `testAcilari` listesini sırayla geziyor: bir açıya git, varması için
 * bekle, sonra durakta bekle, sonraki açı.
 *
 * `delay` YOK. `delay` ile yazılsaydı servo giderken ve durakta beklerken
 * kart sağır kalırdı — sensör okunmaz, seri komut işlenmez, panel
 * "Arduino sustu" derdi. Her adım "başlangıç anı + süre" ile bitiyor. */
int  testSirasi = 0;            // testAcilari içinde neredeyiz
bool testGidiyor = false;       // true: hedefe gidiyor, false: durakta

/** Bir `write(derece)` değerinin kaç mikrosaniyelik darbeye karşılık
 *  geldiği. Arduino'nun Servo kütüphanesi 0..180'i 544..2400 us'e
 *  eşliyor — yani `write(90)` 1500 DEĞİL, 1472 us. Servo beklenmedik
 *  yerde duruyorsa bakılacak sayı bu; derece bunu göstermiyor. */
int usDeger(int derece) {
  return 544 + (int)((long)derece * (2400L - 544L) / 180L);
}

/** Servoyu doğrudan bir açıya sürer — mekanizmayı elle yoklamak için.
 *
 *  NEDEN VAR: uç açıları ayar dosyasında ve panelden geliyor; ama makine
 *  başındayken "şu açıda hangi uç iniyor" sorusunu yeniden yükleme
 *  yapmadan cevaplamak gerekiyor. Ölçüp panele gireceğiniz sayıları
 *  burada buluyorsunuz. */
void aciyaSur(int derece) {
  if (testAcik) testDurdur();
  if (!ucTakili) { ucServo.attach(SERVO_PIN); ucTakili = true; }
  ucServo.write(derece);
  /* UÇ BİLGİSİ GEÇERSİZ: elle sürmek horn'u bir uçla eşleşmeyen bir açıya
   * götürebilir, "şu uç seçili" kaydı artık doğruyu anlatmaz. */
  ucSecili = -1;
  ucAci = derece;
  ucHarekette = false;
  Serial.print("KOMUT: aci ");
  Serial.print(derece);
  Serial.print(" (");
  Serial.print(usDeger(derece));
  Serial.println(" us)");
  sonOlcum = 0;
}

void testAdimUygula() {
  if (!ucTakili) { ucServo.attach(SERVO_PIN); ucTakili = true; }
  if (testGidiyor) {
    ucServo.write(testAcilari[testSirasi]);
    ucAci = testAcilari[testSirasi];
  }
  testAdimMs = millis();
}

void testBasla() {
  testAcik = true;
  testSirasi = 0;
  testGidiyor = true;
  /* HANGİ UÇ SEÇİLİ BİLİNMİYOR: deneme listesi uçların gerçek açıları
   * değil, mekanizmayı görmek için bir tarama. Eski değeri bırakmak
   * bilinmeyeni bilinen gibi göstermek olurdu. */
  ucSecili = -1;
  ucHarekette = false;
  testAdimUygula();
  Serial.print("KOMUT: servo denemesi BASLADI — aci listesi:");
  for (int i = 0; i < TEST_ACI_SAYISI; i++) {
    Serial.print(' ');
    Serial.print(testAcilari[i]);
  }
  Serial.println(". Durdurmak icin tekrar TEST");
  sonOlcum = 0;
}

void testDurdur() {
  testAcik = false;
  /* Servoyu BIRAKMIYORUZ (detach yok): konumlu servo detach edilince
   * horn'u tutmayı bırakır ve mekanizmanın ağırlığı onu kaydırabilir.
   * Nerede durduysa orada tutuyor. */
  Serial.println("KOMUT: servo denemesi DURDU");
  sonOlcum = 0;
}

void testGozet() {
  if (!testAcik) return;
  unsigned long sure = testGidiyor ? (unsigned long)hareketSuresi
                                   : (unsigned long)duraklardaBekleme;
  if (millis() - testAdimMs < sure) return;
  if (testGidiyor) {
    testGidiyor = false;            // vardı, şimdi durakta bekle
  } else {
    testGidiyor = true;             // bekleme bitti, sıradaki açıya
    testSirasi = (testSirasi + 1) % TEST_ACI_SAYISI;
  }
  testAdimUygula();
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
    sonOlcum = 0;
    return;
  }

  if (buyuk == "OKU") { sonOlcum = 0; return; }

  // Servo denemesini başlat/durdur. Ayarlar dosyanın başındaki blokta.
  if (buyuk == "TEST") {
    if (testAcik) testDurdur(); else testBasla();
    return;
  }

  /* "ACI 120" — servoyu o açıya sürer.
   *
   * "HIZ" DA KABUL EDİLİYOR ama adı düzeltilerek: servo sürekli dönüşlü
   * sanılırken komut HIZ'dı. Sessizce "bilinmeyen komut" demek, ezber
   * hâline gelmiş bir komutu bozardı; ne değiştiğini söylemek daha iyi. */
  if (buyuk.startsWith("ACI ") || buyuk.startsWith("HIZ ")) {
    if (buyuk.startsWith("HIZ ")) {
      Serial.println("BILGI: servo konumlu — komut artik ACI, HIZ degil");
    }
    int derece = komut.substring(komut.indexOf(' ') + 1).toInt();
    if (derece < 0 || derece > 180) { Serial.println("HATA: ACI 0-180"); return; }
    aciyaSur(derece);
    return;
  }

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
    /* SINIRLAR BURADA DA DENETLENİYOR: kart seri porta elle yazılan bir
     * komutu da alıyor ve servoyu mekanik sınırının dışına sürmek dişliyi
     * zorlar. */
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
    sonOlcum = 0;
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
  /* Hangi DHT bulundu — ajan makul aralığı buna göre seçiyor. */
  Serial.print(",\"dht\":\"");                Serial.print(dhtAdi);
  Serial.print("\",\"toprak_nem\":");         Serial.print(analogRead(TOPRAK_PIN));
  Serial.print(",\"r_su_pompasi\":");         Serial.print(suPompasiAcik ? 1 : 0);
  Serial.print(",\"r_hava_pompasi\":");       Serial.print(havaPompasiAcik ? 1 : 0);
  /* UÇ SEÇİCİ — KOMUT EDİLEN DEĞER, ÖLÇÜM DEĞİL. Hiç komut verilmediyse
   * ikisi de null gidiyor: sıfır yazmak "0 numaralı uç seçili" demek
   * olurdu ve bu, bilinmeyeni bilinen gibi göstermenin ta kendisi. */
  Serial.print(",\"uc_secili\":");
  if (ucSecili < 0) Serial.print("null"); else Serial.print(ucSecili);
  Serial.print(",\"uc_aci\":");
  if (ucAci < 0) Serial.print("null"); else Serial.print(ucAci);
  // 1 = komut verildi ama hareket süresi dolmadı; horn hâlâ yolda.
  Serial.print(",\"uc_hareket\":");           Serial.print(ucHarekette ? 1 : 0);
  /* Kartın açık kaldığı süre. Geriye giderse kart yeniden başlamıştır ve
   * röleler kapanmıştır — pompa çekişinde besleme çökerse tam bunu
   * görüyoruz. */
  Serial.print(",\"calisma_sn\":");           Serial.print(millis() / 1000UL);
  Serial.println("}");
}

// --------------------------------------------------------------- DÖNGÜ ----
void loop() {
  seriOku();
  ucGozet();
  testGozet();
  if (millis() - sonOlcum >= OLCUM_ARALIGI_MS) {
    sonOlcum = millis();
    olcVeYaz();
  }
}