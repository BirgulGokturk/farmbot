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
#include <Adafruit_BMP085.h>
#include <DHT.h>
#include <Servo.h>

// --- PİN TANIMLAMALARI ---
#define DHTPIN        2      // DHT veri ucu
#define DHTTYPE       DHT11  // Sensör DHT22 ise burayı DHT22 yap
#define YAGMUR_PIN    A0     // HW-103 analog çıkışı
#define SERVO_PIN     9      // SG-5010

// Röleler. Çoğu röle kartı "aktif düşük" çalışır (LOW = çeker).
// Karta LOW verince çekmiyor, HIGH verince çekiyorsa aşağıyı 0 yap.
#define ROLE_AKTIF_LOW 1
#define SU_POMPASI_PIN   4
#define HAVA_POMPASI_PIN 5
#define SU_VANASI_PIN    6

// --- ÖLÇÜM ARALIĞI ---
// DHT11 saniyede bir güncellenir; 2000 ms hem sensöre hem de grafiğe uygun.
// Çok düşürme: her ölçüm bulutta bir veritabanı satırı demek.
#define OLCUM_ARALIGI_MS 2000

// --- EŞİK DEĞERİ ---
// HW-103 kuruyken 1023'e yakın, su görünce 0'a yakın değer verir.
int suEsikDegeri = 600;

Adafruit_BMP085 bmp;
DHT dht(DHTPIN, DHTTYPE);
Servo tarimServo;

bool otoKip = true;          // false ise otonom karar devre dışı (panelden manuel)
int  servoAci = 0;
bool bmpVar = false;
unsigned long sonOlcum = 0;
String girisTamponu = "";

// --------------------------------------------------------------------------
void roleYaz(int pin, bool acik) {
#if ROLE_AKTIF_LOW
  digitalWrite(pin, acik ? LOW : HIGH);
#else
  digitalWrite(pin, acik ? HIGH : LOW);
#endif
}

void servoYaz(int aci) {
  aci = constrain(aci, 0, 180);
  servoAci = aci;
  tarimServo.write(aci);
}

void setup() {
  Serial.begin(9600);
  Serial.println("Sistem Baslatiliyor...");

  tarimServo.attach(SERVO_PIN);
  servoYaz(0);                 // Başlangıç konumu: kapalı

  pinMode(SU_POMPASI_PIN, OUTPUT);
  pinMode(HAVA_POMPASI_PIN, OUTPUT);
  pinMode(SU_VANASI_PIN, OUTPUT);
  roleYaz(SU_POMPASI_PIN, false);
  roleYaz(HAVA_POMPASI_PIN, false);
  roleYaz(SU_VANASI_PIN, false);

  dht.begin();

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
// --------------------------------------------------------------------------
void komutIsle(String komut) {
  komut.trim();
  if (komut.length() == 0) return;
  String buyuk = komut;
  buyuk.toUpperCase();

  if (buyuk == "AC") {
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
    Serial.println("KOMUT: Otomatik kip");
  } else if (buyuk == "MANUEL") {
    otoKip = false;
    Serial.println("KOMUT: Manuel kip");
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

  float nem          = dht.readHumidity();
  float dhtSicaklik  = dht.readTemperature();
  bool  dhtGecerli   = !isnan(nem) && !isnan(dhtSicaklik);

  float bmpSicaklik  = bmpVar ? bmp.readTemperature() : NAN;
  float basincHpa    = bmpVar ? bmp.readPressure() / 100.0 : NAN;
  float rakim        = bmpVar ? bmp.readAltitude() : NAN;
  int   yagmurDegeri = analogRead(YAGMUR_PIN);

  // --- OTONOM KARAR MEKANİZMASI (yalnızca oto kipte) ---
  if (otoKip) {
    if (yagmurDegeri < suEsikDegeri) servoYaz(90);
    else                             servoYaz(0);
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
  Serial.print(" | Servo: ");
  Serial.println(servoAci);

  // --- Köprü satırı: ajan yalnızca bunu okur ---
  Serial.print("VERI:{");
  jsonSayi("hava_nem",      nem,         dhtGecerli, 1, false);
  jsonSayi("hava_sicaklik", dhtSicaklik, dhtGecerli, 1, false);
  jsonSayi("bmp_sicaklik",  bmpSicaklik, bmpVar,     1, false);
  jsonSayi("basinc",        basincHpa,   bmpVar,     2, false);
  jsonSayi("rakim",         rakim,       bmpVar,     1, false);
  Serial.print("\"toprak_nem\":");
  Serial.print(yagmurDegeri);
  Serial.print(",\"servo_aci\":");
  Serial.print(servoAci);
  Serial.print(",\"kip\":\"");
  Serial.print(otoKip ? "oto" : "manuel");
  Serial.println("\"}");

  Serial.println("----------------------------------------");
}
