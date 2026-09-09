/*
 * Servo testi — uç seçici
 * -----------------------
 * TEK İŞİ: servonun dönüp dönmediğini ve beslemenin yetip yetmediğini
 * göstermek. Sensör okumuyor, röle sürmüyor, Pi ile konuşmuyor. Asıl
 * firmware'e (farmbot_sensors) dokunmadan önce donanımı doğrulamak için.
 *
 * TESİSAT
 *   D9    servo sinyali
 *   Servo BESLEMESİ AYRI 5V'tan — Arduino'nun 5V pininden DEĞİL. Yük
 *   altında 0,5-1 A çekiyor, USB'den gelen 5V bunu veremiyor ve kart
 *   hareket ortasında sıfırlanıyor. Ortak toprak (GND) şart, yoksa
 *   sinyalin referansı olmaz.
 *
 * RÖLELER NEDEN BURADA
 * Pompalar NC ucunda: bobin enerjisizken pompa ÇALIŞIYOR. Bu taslak
 * röleleri sürmese bile pinleri asıl firmware'deki kapalı hâline
 * (LOW) çekiyor — yoksa test boyunca su akardı. Yine de pompa
 * kablosunu çıkarmak en güvenlisi: kart sıfırlanırsa açılışın ilk
 * 1-2 saniyesinde yazılım hiç çalışmıyor ve engelleyemiyor.
 *
 * SIFIRLANMA NASIL ANLAŞILIR
 * Her satırda kartın açık kalma süresi yazıyor. Sayı GERİ GİDERSE kart
 * sıfırlanmıştır — sebebi neredeyse her zaman servonun akım çekişidir.
 * Tahmin etmeye gerek yok, ekranda görünüyor.
 *
 * KULLANIM
 * Seri ekranı 9600 baud aç. Kendiliğinden 0 -> 90 -> 180 -> 90 turu
 * atıyor. Elle denemek için tek karakter gönder:
 *   0 1 2   sırasıyla 0, 90, 180 derece
 *   d       tek adım sağa (5 derece) — horn hizasını bulmak için
 *   a       tek adım sola
 *   s       tur atmayı durdur / başlat
 * Bulduğunuz gerçek açıları not edin: uç açıları hiçbir zaman tam
 * 0/90/180 çıkmıyor ve asıl firmware'de ayar dosyasından gelecek.
 */

#include <Servo.h>

#define SERVO_PIN        9
#define SU_POMPASI_PIN   7
#define HAVA_POMPASI_PIN 8

/* Adım başına bekleme. Servo 90 dereceyi anında dönmüyor; ölçmeden
 * "vardı" demek, sonraki katmanda yanlış varsayımın kaynağı olur. */
#define VARIS_MS 900

Servo servo;
int aci = 90;
bool turAtiyor = true;
unsigned long sonAdim = 0;
int adim = 0;
const int TUR[] = {0, 90, 180, 90};

void yaz(const char *neden) {
  Serial.print("aci=");        Serial.print(aci);
  Serial.print("  calisma_sn=");  Serial.print(millis() / 1000UL);
  Serial.print("  ");          Serial.println(neden);
}

void git(int hedef, const char *neden) {
  aci = constrain(hedef, 0, 180);
  servo.write(aci);
  yaz(neden);
}

void setup() {
  /* İLK İŞ: röleleri kapalıya çek. Asıl firmware'deki `roleYaz(pin,
   * false)` ile aynı: ROLE_AKTIF_LOW 0 olduğu için kapalı = LOW. */
  pinMode(SU_POMPASI_PIN, OUTPUT);
  digitalWrite(SU_POMPASI_PIN, LOW);
  pinMode(HAVA_POMPASI_PIN, OUTPUT);
  digitalWrite(HAVA_POMPASI_PIN, LOW);

  Serial.begin(9600);
  servo.attach(SERVO_PIN);
  git(90, "acilis - orta");
  Serial.println("Komutlar: 0 1 2 = 0/90/180 derece | a d = 5 derece sol/sag | s = tur dur/basla");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '0') { turAtiyor = false; git(0,   "elle"); }
    else if (c == '1') { turAtiyor = false; git(90,  "elle"); }
    else if (c == '2') { turAtiyor = false; git(180, "elle"); }
    else if (c == 'd') { turAtiyor = false; git(aci + 5, "ince ayar"); }
    else if (c == 'a') { turAtiyor = false; git(aci - 5, "ince ayar"); }
    else if (c == 's') {
      turAtiyor = !turAtiyor;
      Serial.println(turAtiyor ? "tur basladi" : "tur durdu");
    }
  }

  if (turAtiyor && millis() - sonAdim >= VARIS_MS) {
    sonAdim = millis();
    git(TUR[adim], "tur");
    adim = (adim + 1) % 4;
  }
}
