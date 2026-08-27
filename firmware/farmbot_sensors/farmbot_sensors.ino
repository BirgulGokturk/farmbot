/*
 * farmbot_sensors.ino — Farmbot sensör kartı + köprü çıktısı
 *
 * Senin mevcut sketch'inin üzerine iki şey eklendi:
 *   1) `VERI:{...}` önekli tek satırlık JSON — Raspberry Pi'deki ajan
 *      yalnızca bu satırı okur. Türkçe durum satırları duruyor, böylece
 *      Seri Monitör'den izlemeye devam edebilirsin.
 *   2) Seri komut girişi — panelden gelen komutlar (servo, röle, kip)
 *      Pi üzerinden buraya iner.
 *
 * ÖNEMLİ: Otonom sulama kararı bilerek burada bırakıldı. İnternet ya da Pi
 * gitse bile makinenin doğru davranması gerekiyor; karar mekanizması bulutta
 * olsaydı bağlantı koptuğunda vana açık kalabilirdi.
 *
 * Kütüphaneler: Adafruit BMP085 Library, DHT sensor library, Adafruit Unified Sensor
 * Seri hız: 9600 (ajandaki "baud" değeriyle aynı olmalı)
 */

#include <Wire.h>
#include <EEPROM.h>
#include <Adafruit_BMP085.h>
#include <DHT.h>
#include <Servo.h>

// --- BAĞLI DONANIM ---
// Şu anki tesisatta yalnızca üç sensör takılı: GY-68 (3.3V, A4/A5),
// DHT (D2), HW-103 (A0). Vana servosu ve röleler henüz bağlı değil.
//
// Bağlanmayan bir çıkışı sürmek zararsız görünür ama panelde yalan söyler:
// "vana açık" yazan bir kart, ortada vana yokken en kötü türden bilgidir.
// Bu yüzden bağlı olmayan donanım hem sürülmüyor hem de panele "yok" diye
// bildiriliyor; panel o kartları kendiliğinden gizliyor.
//
// Donanımı taktığınızda YALNIZCA aşağıdaki satırı 1 yapın, başka hiçbir yere
// dokunmanız gerekmiyor.
#define SERVO_BAGLI   0      // SG-5010 vana servosu (D9)
#define ROLELER_BAGLI 1      // su pompası / hava pompası / su vanası röleleri

// --- PİN TANIMLAMALARI ---
#define DHTPIN        2      // DHT veri ucu
#define YAGMUR_PIN    A0     // HW-103 analog çıkışı (YATAKTA sabit duran)

/* UÇTAKİ toprak nemi probu — iki uçlu, uca takılı, toprağa daldırılıyor.
 * Yataktaki HW-103'ten AYRI bir sensör: o sabit bir noktayı ölçüyor, bu
 * ise makinenin gittiği her yerde ölçüm alabiliyor. "Bitkiye git, nemini
 * ölç, ona göre sula" mantığı buna dayanacak.
 *
 * DİKKAT — D13 sensörün DİJİTAL çıkışı: yalnızca "eşiğin üstünde mi
 * altında mı" diyor ve eşiği modülün üstündeki potansiyometre belirliyor.
 * Yani 0 ya da 1. Yüzde okumak istiyorsak probun ANALOG ucunu A1'e alıp
 * aşağıdaki UC_TOPRAK_ANALOG'u 1 yapmak gerekiyor; nem miktarına göre
 * karar veren bir sulama ancak o zaman anlamlı olur.
 */
#define UC_TOPRAK_PIN     13
#define UC_TOPRAK_ANALOG  0    // 1: A1'den analog oku (0-1023) · 0: dijital (0/1)
#define SERVO_PIN     9      // SG-5010

// Röleler. Çoğu röle kartı "aktif düşük" çalışır (LOW = çeker).
// Karta LOW verince çekmiyor, HIGH verince çekiyorsa aşağıyı 0 yap.
#define ROLE_AKTIF_LOW 1
/* Pinler sahadaki kabloya göre. Değiştirirken kartın üstüne bakın:
 * yanlış pin, komutun sessizce hiçbir şey yapmaması demek — röle tıklamaz
 * ve hata da vermez. */
#define SU_POMPASI_PIN   4     // henüz bağlanmadı
#define HAVA_POMPASI_PIN 8
#define SU_VANASI_PIN    7

// --- ÖLÇÜM ARALIĞI ---
// DHT11 saniyede bir güncellenir; 2000 ms hem sensöre hem de grafiğe uygun.
// Çok düşürme: her ölçüm bulutta bir veritabanı satırı demek.
#define OLCUM_ARALIGI_MS 2000

// --- EŞİK DEĞERİ ---
// HW-103 kuruyken 1023'e yakın, su görünce 0'a yakın değer verir.
// Panelden `ESIK <0-1023>` ile değiştirilir ve EEPROM'a yazılır.
int suEsikDegeri = 600;

// --- OTOMATİK KİPTE HANGİ ÇIKIŞ ÇALIŞSIN ---
// Panelden `OTOCIKIS <yok|servo|su_vanasi|su_pompasi>` ile seçilir.
// "yok" = otomatik kip hiçbir şeyi sürmez (karar tamamen panelde).
// Ayar EEPROM'da durur: Arduino resetlense de seçim kaybolmaz. Karar
// mekanizması burada olduğu için ayarın da burada kalıcı olması gerekiyor —
// Pi kapalıyken açılan bir Arduino yine doğru çıkışı sürmeli.
#define CIKIS_YOK        0
#define CIKIS_SERVO      1
#define CIKIS_SU_VANASI  2
#define CIKIS_SU_POMPASI 3
// Varsayılan: servo bağlıysa servo, değilse "yok". Bağlı olmayan bir çıkışı
// varsayılan yapmak, otomatik kipin hiçbir şey yapmadan "çalışıyor" görünmesi
// demek olurdu.
byte otoCikis = SERVO_BAGLI ? CIKIS_SERVO : CIKIS_YOK;
bool otoAcik  = false;        // otomatik kip şu an çıkışı açtı mı

// EEPROM yerleşimi: [0]=imza 0x7B, [1..2]=eşik, [3]=oto çıkışı
#define EE_IMZA_ADRES  0
#define EE_IMZA        0x7B
#define EE_ESIK_ADRES  1
#define EE_CIKIS_ADRES 3

Adafruit_BMP085 bmp;

// DHT11 mi DHT22 mi? İkisi de aynı pinde, aynı kabloda ve dışarıdan çoğu
// zaman ayırt edilemiyor; yanlış tip seçilince kütüphane sessizce NaN
// döndürüyor ve panelde "sensör bozuk" gibi görünüyordu. Açılışta ikisi de
// deneniyor, hangisi okuma veriyorsa o kullanılıyor ve adı panele bildiriliyor.
DHT dht11(DHTPIN, DHT11);
DHT dht22(DHTPIN, DHT22);
DHT* dht = &dht11;
const char* dhtAdi = "DHT11";

Servo tarimServo;

bool otoKip = true;          // false ise otonom karar devre dışı (panelden manuel)
int  servoAci = SERVO_BAGLI ? 0 : -1;   // -1 = servo bağlı değil (panelde "—")
bool bmpVar = false;
unsigned long sonOlcum = 0;
String girisTamponu = "";

// --------------------------------------------------------------------------
void roleYaz(int pin, bool acik) {
#if !ROLELER_BAGLI
  (void)pin; (void)acik;          // röle kartı takılı değil
  return;
#else
#if ROLE_AKTIF_LOW
  digitalWrite(pin, acik ? LOW : HIGH);
#else
  digitalWrite(pin, acik ? HIGH : LOW);
#endif
#endif
}

void servoYaz(int aci) {
#if !SERVO_BAGLI
  (void)aci;                      // servo takılı değil, açı da bildirilmiyor
  return;
#else
  aci = constrain(aci, 0, 180);
  servoAci = aci;
  tarimServo.write(aci);
#endif
}

const char* cikisAdi(byte c) {
  if (c == CIKIS_SERVO)       return "servo";
  if (c == CIKIS_SU_VANASI)   return "su_vanasi";
  if (c == CIKIS_SU_POMPASI)  return "su_pompasi";
  return "yok";
}

// Seçili otomatik çıkışı aç/kapa. Tek yerden geçmesi önemli: çıkış
// değiştirilirken eskisinin AÇIK kalmaması buna bağlı.
void otoCikisYaz(byte cikis, bool ac) {
  if (cikis == CIKIS_SERVO)           servoYaz(ac ? 90 : 0);
  else if (cikis == CIKIS_SU_VANASI)  roleYaz(SU_VANASI_PIN, ac);
  else if (cikis == CIKIS_SU_POMPASI) roleYaz(SU_POMPASI_PIN, ac);
}

/** Seçilen çıkış fiilen bağlı mı? Bağlı olmayan bir çıkışı seçmek, otomatik
 *  kipin sessizce hiçbir şey yapmaması demek — reddedip sebebini söylüyoruz. */
bool cikisBagli(byte c) {
  if (c == CIKIS_YOK) return true;
  if (c == CIKIS_SERVO) return SERVO_BAGLI;
  return ROLELER_BAGLI;
}

void otoCikisSec(byte yeni) {
  if (yeni == otoCikis) return;
  otoCikisYaz(otoCikis, false);      // eskisini KAPAT — açık unutulmasın
  otoCikis = yeni;
  otoAcik = false;
  EEPROM.update(EE_CIKIS_ADRES, otoCikis);
}

void esikYaz(int yeni) {
  suEsikDegeri = constrain(yeni, 0, 1023);
  EEPROM.update(EE_ESIK_ADRES, suEsikDegeri & 0xFF);
  EEPROM.update(EE_ESIK_ADRES + 1, (suEsikDegeri >> 8) & 0xFF);
}

void ayarlariOku() {
  if (EEPROM.read(EE_IMZA_ADRES) != EE_IMZA) {
    // İlk açılış: EEPROM boş (0xFF). Varsayılanları yaz.
    EEPROM.update(EE_IMZA_ADRES, EE_IMZA);
    esikYaz(suEsikDegeri);
    EEPROM.update(EE_CIKIS_ADRES, otoCikis);
    return;
  }
  suEsikDegeri = EEPROM.read(EE_ESIK_ADRES) | (EEPROM.read(EE_ESIK_ADRES + 1) << 8);
  suEsikDegeri = constrain(suEsikDegeri, 0, 1023);
  byte c = EEPROM.read(EE_CIKIS_ADRES);
  otoCikis = (c <= CIKIS_SU_POMPASI) ? c : CIKIS_YOK;
  // Donanım sökülmüş ya da sketch başka bir kartta olabilir: EEPROM'daki
  // seçim artık bağlı değilse "yok"a düşüyoruz.
  if (!cikisBagli(otoCikis)) otoCikis = CIKIS_YOK;
}

/** DHT11 mi DHT22 mi — okuma veren hangisiyse o.
 *
 *  İki tip aynı pini, aynı bağlantıyı kullanıyor ama protokol zamanlaması
 *  farklı; yanlış tiple kütüphane NaN döndürüyor. Elle `#define DHTTYPE`
 *  değiştirmek, sensörü tanımayan birinin panelde "hep tire" görüp sensörü
 *  bozuk sanmasına yol açıyordu. İlk okuma çoğu zaman NaN geldiği için her
 *  tip üç kez deneniyor.
 */
void dhtSec() {
  dht11.begin();
  for (byte i = 0; i < 3; i++) {
    delay(1100);
    if (!isnan(dht11.readHumidity())) { dht = &dht11; dhtAdi = "DHT11"; return; }
  }
  dht22.begin();
  for (byte i = 0; i < 3; i++) {
    delay(1100);
    if (!isnan(dht22.readHumidity())) { dht = &dht22; dhtAdi = "DHT22"; return; }
  }
  // Hiçbiri okumadı: kablo çıkmış olabilir. Sistem durmuyor, diğer sensörler
  // çalışmaya devam ediyor; panelde nem/sıcaklık kartı görünmüyor.
  dht = &dht11;
  dhtAdi = "yok";
}

void setup() {
  Serial.begin(9600);
  Serial.println("Sistem Baslatiliyor...");

#if !UC_TOPRAK_ANALOG
  /* UYARI: D13'te Uno'nun dahili LED'i ve seri direnci var. Pin GİRİŞ
   * olarak kullanıldığında bu devre pini hafifçe aşağı çekiyor ve
   * sensörün "kuru" sinyali bazen okunmuyor. Okuma kararsızsa probu
   * başka bir dijital pine (örneğin D12) ya da analog uca alın. */
  pinMode(UC_TOPRAK_PIN, INPUT);
#endif

#if SERVO_BAGLI
  tarimServo.attach(SERVO_PIN);
  servoYaz(0);                 // Başlangıç konumu: kapalı
#else
  Serial.println("BILGI: Vana servosu bagli degil (SERVO_BAGLI 0)");
#endif

#if ROLELER_BAGLI
  pinMode(SU_POMPASI_PIN, OUTPUT);
  pinMode(HAVA_POMPASI_PIN, OUTPUT);
  pinMode(SU_VANASI_PIN, OUTPUT);
  roleYaz(SU_POMPASI_PIN, false);
  roleYaz(HAVA_POMPASI_PIN, false);
  roleYaz(SU_VANASI_PIN, false);
#else
  Serial.println("BILGI: Roleler bagli degil (ROLELER_BAGLI 0)");
#endif

  ayarlariOku();
  Serial.print("Ayarlar: esik=");
  Serial.print(suEsikDegeri);
  Serial.print(" otocikis=");
  Serial.println(cikisAdi(otoCikis));

  dhtSec();
  Serial.print("DHT tipi: ");
  Serial.println(dhtAdi);

  // Barometre yoksa ESKİDEN sistem duruyordu (while(1)). Artık durmuyor:
  // tek bir sensörün kablosu çıktı diye nem okuması ve vana kontrolü de
  // kaybedilmemeli. Eksik sensör JSON'da null olarak gider, panelde "—" görünür.
  bmpVar = bmp.begin();
  if (!bmpVar) {
    Serial.println("UYARI: GY-68 barometre bulunamadi. Diger sensorlerle devam ediliyor.");
  }

  Serial.println("Sensorler hazir. Olcumler basliyor...");
  Serial.println("----------------------------------------");
}

// --------------------------------------------------------------------------
// Seri komutlar — Pi'deki ajan ya da Seri Monitör buraya yazabilir.
//   AC | KAPA | SERVO <0-180> | AUTO | MANUEL | OKU | ROLE <ad> <0|1>
//   ESIK <0-1023> | OTOCIKIS <yok|servo|su_vanasi|su_pompasi>
// --------------------------------------------------------------------------
void komutIsle(String komut) {
  komut.trim();
  if (komut.length() == 0) return;
  String buyuk = komut;
  buyuk.toUpperCase();

  if (buyuk == "AC" || buyuk == "KAPA" || buyuk.startsWith("SERVO")) {
#if !SERVO_BAGLI
    Serial.println("HATA: vana servosu bagli degil");
    return;
#endif
  }
  if (buyuk.startsWith("ROLE")) {
#if !ROLELER_BAGLI
    Serial.println("HATA: roleler bagli degil");
    return;
#endif
  }

  if (buyuk == "AC") {
    if (otoKip && otoAcik && otoCikis != CIKIS_SERVO) { otoCikisYaz(otoCikis, false); otoAcik = false; }
    otoKip = false;
    servoYaz(90);
    Serial.println("KOMUT: Vana acildi (MANUEL kip)");
  } else if (buyuk == "KAPA") {
    otoKip = false;
    servoYaz(0);
    Serial.println("KOMUT: Vana kapatildi (MANUEL kip)");
  } else if (buyuk.startsWith("SERVO")) {
    otoKip = false;
    servoYaz(buyuk.substring(5).toInt());
    Serial.print("KOMUT: Servo -> ");
    Serial.println(servoAci);
  } else if (buyuk == "AUTO") {
    otoKip = true;
    // Otomatik kipe geçerken çıkışı bilinen bir hâle getiriyoruz. Elle yarı
    // açık bırakılmış bir vana, "sulama gerekmiyor" kararıyla öylece açık
    // kalmamalı; gerekiyorsa bir sonraki ölçümde zaten açılacak.
    otoCikisYaz(otoCikis, false);
    otoAcik = false;
    Serial.print("KOMUT: Otomatik kip -> ");
    Serial.println(cikisAdi(otoCikis));
  } else if (buyuk == "MANUEL") {
    // Otomatik kipten çıkarken otomatiğin açtığı çıkışı KAPATIYORUZ.
    // Aksi hâlde "manuele aldım" dedikten sonra pompa açık kalabiliyordu.
    if (otoKip && otoAcik) { otoCikisYaz(otoCikis, false); otoAcik = false; }
    otoKip = false;
    Serial.println("KOMUT: Manuel kip");
  } else if (buyuk.startsWith("ESIK")) {
    esikYaz(komut.substring(4).toInt());
    Serial.print("KOMUT: Esik -> ");
    Serial.println(suEsikDegeri);
  } else if (buyuk.startsWith("OTOCIKIS")) {
    String ad = komut.substring(8);
    ad.trim();
    ad.toLowerCase();
    byte yeni = CIKIS_YOK;
    if (ad == "servo")           yeni = CIKIS_SERVO;
    else if (ad == "su_vanasi")  yeni = CIKIS_SU_VANASI;
    else if (ad == "su_pompasi") yeni = CIKIS_SU_POMPASI;
    else if (ad != "yok") { Serial.println("HATA: OTOCIKIS <yok|servo|su_vanasi|su_pompasi>"); return; }
    if (!cikisBagli(yeni)) { Serial.println("HATA: o cikis bagli degil"); return; }
    otoCikisSec(yeni);
    Serial.print("KOMUT: Oto cikisi -> ");
    Serial.println(cikisAdi(otoCikis));
  } else if (buyuk == "OKU") {
    sonOlcum = 0;               // bir sonraki loop'ta hemen ölçsün
  } else if (buyuk.startsWith("ROLE")) {
    // "ROLE su_pompasi 1"  (ad küçük harf gelir, buyuk kopyası büyük)
    int bosluk1 = komut.indexOf(' ');
    int bosluk2 = komut.indexOf(' ', bosluk1 + 1);
    if (bosluk1 < 0 || bosluk2 < 0) {
      Serial.println("HATA: ROLE <ad> <0|1>");
      return;
    }
    String ad = komut.substring(bosluk1 + 1, bosluk2);
    bool durum = komut.substring(bosluk2 + 1).toInt() != 0;
    if (ad == "su_pompasi")        roleYaz(SU_POMPASI_PIN, durum);
    else if (ad == "hava_pompasi") roleYaz(HAVA_POMPASI_PIN, durum);
    else if (ad == "su_vanasi")    roleYaz(SU_VANASI_PIN, durum);
    else { Serial.println("HATA: bilinmeyen role"); return; }
    Serial.print("KOMUT: ");
    Serial.print(ad);
    Serial.println(durum ? " ACIK" : " KAPALI");
  } else {
    Serial.print("HATA: bilinmeyen komut -> ");
    Serial.println(komut);
  }
}

void seriOku() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (girisTamponu.length()) {
        komutIsle(girisTamponu);
        girisTamponu = "";
      }
    } else if (girisTamponu.length() < 40) {
      girisTamponu += c;
    }
  }
}

// --------------------------------------------------------------------------
// JSON'a sayı ya da null yazar. Sensör okunamadığında 0 göndermek panelde
// "sıcaklık 0 derece" gibi yanlış bir grafik çizerdi; null "veri yok" demek.
void jsonSayi(const char* ad, float deger, bool gecerli, int basamak, bool sonMu) {
  Serial.print("\"");
  Serial.print(ad);
  Serial.print("\":");
  if (gecerli) Serial.print(deger, basamak);
  else         Serial.print("null");
  if (!sonMu) Serial.print(",");
}

void loop() {
  seriOku();

  if (millis() - sonOlcum < OLCUM_ARALIGI_MS) return;
  sonOlcum = millis();

  float nem          = dht->readHumidity();
  float dhtSicaklik  = dht->readTemperature();
  bool  dhtGecerli   = !isnan(nem) && !isnan(dhtSicaklik);

  float bmpSicaklik  = bmpVar ? bmp.readTemperature() : NAN;
  float basincHpa    = bmpVar ? bmp.readPressure() / 100.0 : NAN;
  float rakim        = bmpVar ? bmp.readAltitude() : NAN;
  int   yagmurDegeri = analogRead(YAGMUR_PIN);

  // --- OTONOM KARAR MEKANİZMASI (yalnızca oto kipte) ---
  // Hangi çıkışın sürüleceği `otoCikis` ile seçilir; "yok" seçilirse
  // otomatik kip hiçbir şeye dokunmaz (kararın tamamı panelde kalır).
  if (otoKip && otoCikis != CIKIS_YOK) {
    bool gerek = (yagmurDegeri < suEsikDegeri);   // ham değer düştükçe toprak ıslak
    if (gerek != otoAcik) {
      otoCikisYaz(otoCikis, gerek);
      otoAcik = gerek;
    }
  }

  // --- İnsan için okunabilir satırlar ---
  if (dhtGecerli) {
    Serial.print("Hava Nemi: %");
    Serial.print(nem);
    Serial.print(" | Sicaklik: ");
    Serial.print(dhtSicaklik);
    Serial.println(" *C");
  } else {
    Serial.println("HATA: DHT sensorunden veri okunamadi!");
  }
  Serial.print("Basinc: ");
  if (bmpVar) Serial.print(basincHpa); else Serial.print("--");
  Serial.print(" hPa | Yagmur/Nem Seviyesi: ");
  Serial.println(yagmurDegeri);
  Serial.print("DURUM: ");
  Serial.print(otoKip ? "OTO" : "MANUEL");
  Serial.print(" | Cikis: ");
  Serial.print(cikisAdi(otoCikis));
  Serial.print(" | Esik: ");
  Serial.print(suEsikDegeri);
  Serial.print(" | Servo: ");
  if (servoAci < 0) Serial.println("bagli degil"); else Serial.println(servoAci);

  // --- Köprü satırı: ajan yalnızca bunu okur ---
  Serial.print("VERI:{");
  jsonSayi("hava_nem",      nem,         dhtGecerli, 1, false);
  jsonSayi("hava_sicaklik", dhtSicaklik, dhtGecerli, 1, false);
  jsonSayi("bmp_sicaklik",  bmpSicaklik, bmpVar,     1, false);
  jsonSayi("basinc",        basincHpa,   bmpVar,     2, false);
  jsonSayi("rakim",         rakim,       bmpVar,     1, false);
  Serial.print("\"toprak_nem\":");
  Serial.print(yagmurDegeri);
  /* Uçtaki prob. Ham değeri olduğu gibi gönderiyoruz; ölçeklemek panelin
   * işi. `uc_toprak_kip` de gidiyor ki panel 0/1 ile 0-1023'ü karıştırıp
   * "nem %0" demesin. */
  Serial.print(",\"uc_toprak\":");
#if UC_TOPRAK_ANALOG
  Serial.print(analogRead(UC_TOPRAK_PIN));
  Serial.print(",\"uc_toprak_kip\":\"analog\"");
#else
  Serial.print(digitalRead(UC_TOPRAK_PIN) ? 1 : 0);
  Serial.print(",\"uc_toprak_kip\":\"dijital\"");
#endif
  Serial.print(",\"servo_aci\":");
  if (servoAci < 0) Serial.print("null"); else Serial.print(servoAci);
  Serial.print(",\"dht\":\"");
  Serial.print(dhtAdi);
  Serial.print("\",\"servo_var\":");
  Serial.print(SERVO_BAGLI);
  Serial.print(",\"role_var\":");
  Serial.print(ROLELER_BAGLI);
  Serial.print(",\"esik\":");
  Serial.print(suEsikDegeri);
  Serial.print(",\"oto_acik\":");
  Serial.print(otoKip && otoAcik ? 1 : 0);
  Serial.print(",\"oto_cikis\":\"");
  Serial.print(cikisAdi(otoCikis));
  Serial.print("\",\"kip\":\"");
  Serial.print(otoKip ? "oto" : "manuel");
  Serial.println("\"}");

  Serial.println("----------------------------------------");
}
