/*
 * sensor_testi.ino — sensör teşhisi (v2, ham kayıt okumalı)
 *
 * v1 "değerler saçma" dedi ama nedenini söyleyemedi. Bu sürüm nedeni
 * ayırt etmek için üç şeye bakıyor:
 *
 *   1. BMP180'in KALİBRASYON KATSAYILARI ham hâlde. Bu sensörde sıcaklık ve
 *      basınç, fabrikada yazılmış 11 katsayıdan hesaplanıyor. Katsayılar
 *      0x0000 ya da 0xFFFF geliyorsa okuma hattı bozuktur ve hesap da
 *      -59 °C / 1810 hPa gibi çöp verir. Katsayılar makulse sorun başka
 *      yerdedir. Kütüphane bunları içeride tutup göstermiyor; burada
 *      doğrudan I2C'den okuyoruz.
 *   2. I2C ZAMAN AŞIMI BAYRAĞI. Hattı çeken/yanıt vermeyen bir cihaz varsa
 *      Wire zaman aşımına düşüyor ve okuma sessizce yarım kalıyor — bayrak
 *      bunu açıkça söylüyor.
 *   3. DHT DATA PİNİNİN BOŞTAKİ SEVİYESİ. Sağlam bir kurulumda hat yukarı
 *      çekilidir (HIGH). Sürekli LOW ise sensör beslenmiyor, DATA yanlış
 *      pinde ya da pull-up direnci yok demektir. NaN'ın en sık sebebi bu.
 *
 * Hiçbir çıkış sürülmüyor: röle, EEPROM, seri komut yok.
 * Kütüphaneler: Adafruit BMP085 Library, DHT sensor library, Adafruit Unified Sensor
 * Seri hız: 9600
 */

#include <Wire.h>
#include <Adafruit_BMP085.h>
#include <DHT.h>

#define DHTPIN     2
#define YAGMUR_PIN A0
#define BMP_ADRES  0x77

DHT dht11(DHTPIN, DHT11);
DHT dht22(DHTPIN, DHT22);
Adafruit_BMP085 bmp;

bool bmpVar = false;
byte bmpAdres = 0;
unsigned long tur = 0;

/* ------------------------------------------------------------- I2C okuma */
uint8_t kayit8(uint8_t adres, uint8_t kayit) {
  Wire.beginTransmission(adres);
  Wire.write(kayit);
  if (Wire.endTransmission() != 0) return 0;
  Wire.requestFrom(adres, (uint8_t)1);
  return Wire.available() ? Wire.read() : 0;
}

uint16_t kayit16(uint8_t adres, uint8_t kayit) {
  Wire.beginTransmission(adres);
  Wire.write(kayit);
  if (Wire.endTransmission() != 0) return 0;
  Wire.requestFrom(adres, (uint8_t)2);
  if (Wire.available() < 2) return 0;
  uint16_t yuksek = Wire.read();
  uint16_t alcak = Wire.read();
  return (yuksek << 8) | alcak;
}

/** Katsayı geçerli mi: BMP180'de hiçbir katsayı 0x0000 ya da 0xFFFF olamaz. */
void katsayi(const char* ad, uint8_t kayit) {
  uint16_t d = kayit16(bmpAdres, kayit);
  Serial.print("  ");
  Serial.print(ad);
  Serial.print(" = ");
  Serial.print((int16_t)d);
  Serial.print("  (0x");
  if (d < 0x1000) Serial.print("0");
  if (d < 0x100) Serial.print("0");
  if (d < 0x10) Serial.print("0");
  Serial.print(d, HEX);
  Serial.print(")");
  if (d == 0x0000 || d == 0xFFFF) Serial.print("   <-- GECERSIZ");
  Serial.println();
}

byte i2cTara() {
  Serial.println("I2C taramasi:");
  byte ilk = 0;
  for (byte adres = 1; adres < 127; adres++) {
    Wire.beginTransmission(adres);
    if (Wire.endTransmission() == 0) {
      Serial.print("  0x");
      if (adres < 16) Serial.print("0");
      Serial.print(adres, HEX);
      if (adres == 0x77) Serial.print("  <- BMP180/BMP085 olagan adresi");
      if (adres == 0x76) Serial.print("  <- BMP280/BME280 olagan adresi");
      Serial.println();
      if (!ilk) ilk = adres;
    }
  }
  if (!ilk) Serial.println("  HICBIR CIHAZ YOK -> SDA(A4)/SCL(A5)/GND ya da besleme");
  return ilk;
}

/* ------------------------------------------------------------ DHT hattı */
void dhtHattiOlc() {
  // Dahili pull-up ile: sağlam bir DHT hattı HIGH durur.
  pinMode(DHTPIN, INPUT_PULLUP);
  delay(5);
  byte yuksek = 0;
  for (byte i = 0; i < 20; i++) { if (digitalRead(DHTPIN)) yuksek++; delay(1); }

  // Pull-up'sız: sensörün kendi/harici direnci hattı tutuyor mu?
  pinMode(DHTPIN, INPUT);
  delay(5);
  byte yuksek2 = 0;
  for (byte i = 0; i < 20; i++) { if (digitalRead(DHTPIN)) yuksek2++; delay(1); }

  Serial.print(" DHT hatti (D");
  Serial.print(DHTPIN);
  Serial.print("): pull-up ile ");
  Serial.print(yuksek);
  Serial.print("/20 HIGH, pull-up'siz ");
  Serial.print(yuksek2);
  Serial.println("/20 HIGH");

  if (yuksek == 0)
    Serial.println("   -> HAT SUREKLI LOW: DATA yanlis pinde, GND'ye kacmis ya da sensor bozuk");
  else if (yuksek2 == 0)
    Serial.println("   -> Harici pull-up YOK: VCC-DATA arasina 10K direnc gerekiyor");
  else if (yuksek == 20 && yuksek2 == 20)
    Serial.println("   -> Hat saglikli duruyor; sorun besleme (5V/GND) ya da sensorun kendisi");
}

/* --------------------------------------------------------------- kurulum */
void setup() {
  Serial.begin(9600);
  delay(300);
  Serial.println();
  Serial.println("==================================================");
  Serial.println("  SENSOR TESTI v2 - ham kayit okumali teshis");
  Serial.println("==================================================");

  Wire.begin();
#if defined(WIRE_HAS_TIMEOUT)
  Wire.setWireTimeout(3000, true);
  Wire.clearWireTimeoutFlag();
  Serial.println("I2C zaman asimi korumasi: acik");
#else
  Serial.println("I2C zaman asimi korumasi: YOK (eski Wire surumu)");
#endif

  bmpAdres = i2cTara();
  if (!bmpAdres) bmpAdres = BMP_ADRES;

  Serial.println();
  Serial.print("Cip kimligi (0xD0) = 0x");
  uint8_t kimlik = kayit8(bmpAdres, 0xD0);
  Serial.print(kimlik, HEX);
  if (kimlik == 0x55)      Serial.println("  -> BMP180/BMP085 dogrulandi");
  else if (kimlik == 0x58) Serial.println("  -> Bu bir BMP280! BMP085 kutuphanesi bunu okuyamaz");
  else if (kimlik == 0x60) Serial.println("  -> Bu bir BME280! BMP085 kutuphanesi bunu okuyamaz");
  else                     Serial.println("  -> Taninmadi (0 ise okuma hic gelmiyor)");

  Serial.println();
  Serial.println("Kalibrasyon katsayilari (fabrika degerleri, sabit olmali):");
  katsayi("AC1", 0xAA); katsayi("AC2", 0xAC); katsayi("AC3", 0xAE);
  katsayi("AC4", 0xB0); katsayi("AC5", 0xB2); katsayi("AC6", 0xB4);
  katsayi("B1 ", 0xB6); katsayi("B2 ", 0xB8);
  katsayi("MB ", 0xBA); katsayi("MC ", 0xBC); katsayi("MD ", 0xBE);
  Serial.println("  (hepsi GECERSIZ ise: I2C okumasi calismiyor -> kablo/pull-up/besleme)");

  bmpVar = bmp.begin();
  Serial.println();
  Serial.println(bmpVar ? "bmp.begin(): BASARILI" : "bmp.begin(): BASARISIZ");

  dht11.begin();
  dht22.begin();
  Serial.println("--------------------------------------------------");
  Serial.println();
}

void satir(const char* ad, float deger, const char* birim) {
  Serial.print("  ");
  Serial.print(ad);
  if (isnan(deger)) { Serial.println("YOK (NaN)"); return; }
  Serial.print(deger);
  Serial.print(" ");
  Serial.println(birim);
}

/* ----------------------------------------------------------------- döngü */
void loop() {
  tur++;
  Serial.print("--- tur ");
  Serial.print(tur);
  Serial.println(" ---");

  dhtHattiOlc();

  float n11 = dht11.readHumidity();
  delay(2200);
  float n22 = dht22.readHumidity();
  Serial.print(" DHT okuma: DHT11 nem=");
  if (isnan(n11)) Serial.print("NaN"); else Serial.print(n11);
  Serial.print(" | DHT22 nem=");
  if (isnan(n22)) Serial.println("NaN"); else Serial.println(n22);

  // BMP: önce ham sayaçlar, sonra kütüphanenin hesabı. Ham sayaç makul ama
  // sonuç saçmaysa sorun katsayılarda; ham sayaç da 0/65535 ise okuma hattında.
  Serial.println(" BMP180:");
  uint16_t hamSicaklik = 0;
  Wire.beginTransmission(bmpAdres);
  Wire.write(0xF4); Wire.write(0x2E);
  Wire.endTransmission();
  delay(6);
  hamSicaklik = kayit16(bmpAdres, 0xF6);
  Serial.print("  ham sicaklik sayaci = ");
  Serial.print(hamSicaklik);
  if (hamSicaklik == 0 || hamSicaklik == 0xFFFF) Serial.print("   <-- GECERSIZ");
  Serial.println();
  if (bmpVar) {
    satir("hesaplanan sicaklik : ", bmp.readTemperature(), "C");
    satir("hesaplanan basinc   : ", bmp.readPressure() / 100.0, "hPa");
  }

#if defined(WIRE_HAS_TIMEOUT)
  Serial.print(" I2C zaman asimi bayragi: ");
  if (Wire.getWireTimeoutFlag()) {
    Serial.println("DUSTU  <-- I2C hatti saglikli degil (kablo/pull-up/GND)");
    Wire.clearWireTimeoutFlag();
  } else {
    Serial.println("temiz");
  }
#endif

  // HW-103: sabit mi, oynuyor mu? Tek bir sayı bunu söylemiyor.
  int enAz = 1023, enCok = 0;
  for (byte i = 0; i < 20; i++) {
    int d = analogRead(YAGMUR_PIN);
    if (d < enAz) enAz = d;
    if (d > enCok) enCok = d;
    delay(2);
  }
  Serial.print(" HW-103: ");
  Serial.print(enAz);
  Serial.print(" - ");
  Serial.print(enCok);
  Serial.print("  (oynama ");
  Serial.print(enCok - enAz);
  Serial.println(")");

  Serial.println();
  delay(2200);
}
