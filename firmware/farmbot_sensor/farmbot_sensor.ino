/*
 * farmbot_sensor.ino — sadece sensör okuma
 *
 * Üç sensörü okur ve iki biçimde basar:
 *   - insan için okunabilir satırlar (Seri Monitör'den bakarken)
 *   - `VERI:{...}` önekli tek satırlık JSON (Raspberry Pi'deki ajan bunu okur)
 *
 * Bu dosyada servo, röle, otomatik sulama, EEPROM ve seri komut YOK.
 * Vana ve pompalar bağlanınca `farmbot_sensors.ino` (çoğul) sürümüne
 * dönersiniz; o dosya bu üç sensörü aynen okur, üstüne kontrol ekler.
 *
 * Kütüphaneler: Adafruit BMP085 Library, DHT sensor library, Adafruit Unified Sensor
 * Seri hız: 9600 (ajandaki "baud" ile aynı olmalı)
 *
 * Bağlantılar (Arduino Uno):
 *   GY-68 (BMP180) : VCC→3.3V  GND→GND  SDA→A4  SCL→A5
 *   DHT11 / DHT22  : VCC→5V    GND→GND  DATA→D2
 *   HW-103         : VCC→5V    GND→GND  A0→A0     (D0 boşta)
 */

#include <Wire.h>
#include <Adafruit_BMP085.h>
#include <DHT.h>

#define DHTPIN            2
#define YAGMUR_PIN        A0
#define OLCUM_ARALIGI_MS  2000   // DHT11 saniyede bir güncelleniyor; 2 sn rahat

// Sensör tipi. Elinizdeki DHT22 ise tek yapmanız gereken aşağıdaki satırı
// DHT22 yapmak — başka hiçbir yere dokunmak gerekmiyor.
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);

Adafruit_BMP085 bmp;
bool bmpVar = false;
unsigned long sonOlcum = 0;

/** JSON alanı yazar; okuma geçersizse `null` basar (NaN geçerli JSON değil). */
void alan(const char* ad, float deger, bool gecerli, byte basamak) {
  Serial.print("\"");
  Serial.print(ad);
  Serial.print("\":");
  if (gecerli) Serial.print(deger, basamak);
  else         Serial.print("null");
  Serial.print(",");
}

void setup() {
  Serial.begin(9600);
  delay(200);
  Serial.println();
  Serial.println("Farmbot sensor karti baslatiliyor...");

  dht.begin();

  // Barometre bulunamazsa duruyoruz demek değil: o kanal null gider,
  // nem ve toprak okumaları çalışmaya devam eder.
  bmpVar = bmp.begin();
  Serial.println(bmpVar ? "BMP180: hazir" : "BMP180: bulunamadi (bu kanal bos gecilecek)");

  Serial.println("Olcumler basliyor.");
  Serial.println("----------------------------------------");
}

void loop() {
  if (millis() - sonOlcum < OLCUM_ARALIGI_MS) return;
  sonOlcum = millis();

  float nem         = dht.readHumidity();
  float dhtSicaklik = dht.readTemperature();
  bool  dhtGecerli  = !isnan(nem) && !isnan(dhtSicaklik);

  float bmpSicaklik = bmpVar ? bmp.readTemperature() : NAN;
  float basincHpa   = bmpVar ? bmp.readPressure() / 100.0 : NAN;
  float rakim       = bmpVar ? bmp.readAltitude() : NAN;
  int   toprakHam   = analogRead(YAGMUR_PIN);

  // --- insan için ---
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
  Serial.print(" hPa | Toprak/Yagmur: ");
  Serial.println(toprakHam);

  // --- ajan için: tek satır, tek kaynak ---
  Serial.print("VERI:{");
  alan("hava_nem",      nem,         dhtGecerli, 1);
  alan("hava_sicaklik", dhtSicaklik, dhtGecerli, 1);
  alan("bmp_sicaklik",  bmpSicaklik, bmpVar,     1);
  alan("basinc",        basincHpa,   bmpVar,     2);
  alan("rakim",         rakim,       bmpVar,     1);
  Serial.print("\"toprak_nem\":");
  Serial.print(toprakHam);
  // Bu kartta vana ve röle yok; panel bunu bilsin ki o kartları göstermesin.
  Serial.println(",\"servo_aci\":null,\"servo_var\":0,\"role_var\":0}");

  Serial.println("----------------------------------------");
}
