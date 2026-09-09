/*
 * Servo testi — uç seçici, MİKROSANİYE ile
 * ----------------------------------------
 * NEDEN DERECE DEĞİL. `Servo.write(0..180)` kütüphanenin uydurduğu bir
 * eşleme: varsayılanı 544-2400 µs. Servonun gerçek aralığı bu değilse
 * uçlarda mekanik durdurucuya dayanıyor, arada kalan açılar da kayıyor.
 * Sahada görülen belirti: üç durak yerine iki uç arasında gidip gelme.
 * Telde giden şey mikrosaniye; ölçüp saklayacağımız da o olmalı.
 *
 * SERVO KONUM BİLDİRMİYOR. Potansiyometreyi kendi içinde okuyor, dışarı
 * söylemiyor. "Şu an 90 derecede" diyemeyiz, ancak "1500 µs komut ettik"
 * diyebiliriz. Panelde de böyle yazılacak.
 *
 * TESİSAT
 *   D9   servo sinyali
 *   Besleme AYRI 5V + ortak toprak. Yük altında 0,5-1 A çekiyor.
 *
 * STALL UYARISI: mil mekanik durdurucuya dayandığında motor dönmeye
 * çalışmaya devam eder, akım fırlar, dişli sıyrılabilir. Servo VIZILDAMAYA
 * başlarsa ya da mil kımıldamayı bırakırsa HEMEN geri gelin (a / A).
 * Uçları ararken küçük adımlarla yaklaşın.
 *
 * KOMUTLAR (seri ekran, 9600 baud)
 *   a / d     -25 / +25 µs   ince ayar
 *   A / D    -100 / +100 µs  kaba ayar
 *   q w e     o anki değeri 1., 2., 3. uca KAYDET
 *   1 2 3     kayıtlı uca git
 *   t         kayıtlı uçlar arasında tur at (durakta 5 sn bekleyerek)
 *   + / -     durak süresini 1 sn artır / azalt
 *   x         turu durdur
 *   p         kayıtlı değerleri yazdır
 *   m         ortaya dön (1500 µs)
 *
 * Bulduğunuz üç sayıyı not edin: `uclar.json`a girilecek olan bunlar.
 */

#include <Servo.h>

#define SERVO_PIN        9
#define SU_POMPASI_PIN   7
#define HAVA_POMPASI_PIN 8

/* Kütüphanenin izin verdiği en geniş aralık. Servonuz bunun tamamını
 * kullanmıyor olabilir — zaten aradığımız şey nereye kadar gittiği. */
#define US_MIN  500
#define US_MAX  2500
/* Turda her durakta bekleme. Uzun: uca bakip olcmek icin duragin
 * yeterince surmesi gerekiyor. Seri ekrandan '+' ve '-' ile
 * degistirilebiliyor, yeniden yukleme gerekmiyor. */
int turMs = 5000;

Servo servo;
int us = 1500;
int uc[3] = {0, 0, 0};      /* 0 = henüz kaydedilmedi */
bool turAtiyor = false;
int adim = 0;
unsigned long sonAdim = 0;

void yaz(const char *neden) {
  Serial.print("us=");            Serial.print(us);
  Serial.print("  calisma_sn=");  Serial.print(millis() / 1000UL);
  Serial.print("  ");             Serial.println(neden);
}

void git(int hedef, const char *neden) {
  us = constrain(hedef, US_MIN, US_MAX);
  servo.writeMicroseconds(us);
  yaz(neden);
}

void kaydet(int i) {
  uc[i] = us;
  Serial.print("KAYIT: uc");  Serial.print(i + 1);
  Serial.print(" = ");        Serial.print(us);
  Serial.println(" us");
}

void yazdir() {
  for (int i = 0; i < 3; i++) {
    Serial.print("uc");  Serial.print(i + 1);  Serial.print(" = ");
    if (uc[i]) { Serial.print(uc[i]); Serial.println(" us"); }
    else Serial.println("(kaydedilmedi)");
  }
}

void setup() {
  /* İLK İŞ: röleleri kapalıya çek — asıl firmware'deki roleYaz(pin,false)
   * ile aynı (ROLE_AKTIF_LOW 0 olduğu için kapalı = LOW). Pompalar NC
   * ucunda, yani sürülmezse su akar. */
  pinMode(SU_POMPASI_PIN, OUTPUT);   digitalWrite(SU_POMPASI_PIN, LOW);
  pinMode(HAVA_POMPASI_PIN, OUTPUT); digitalWrite(HAVA_POMPASI_PIN, LOW);

  Serial.begin(9600);
  servo.attach(SERVO_PIN, US_MIN, US_MAX);
  git(1500, "acilis - orta");
  Serial.println("a/d = -+25us | A/D = -+100us | q w e = kaydet 1/2/3 | 1 2 3 = git");
  Serial.println("t = tur | x = dur | p = yazdir | m = orta | + - = durak suresi");
  Serial.println("UYARI: servo vizildarsa ya da kimildamiyorsa durdurucuya dayanmistir, geri gelin.");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if      (c == 'a') { turAtiyor = false; git(us -  25, "ince"); }
    else if (c == 'd') { turAtiyor = false; git(us +  25, "ince"); }
    else if (c == 'A') { turAtiyor = false; git(us - 100, "kaba"); }
    else if (c == 'D') { turAtiyor = false; git(us + 100, "kaba"); }
    else if (c == 'm') { turAtiyor = false; git(1500, "orta"); }
    else if (c == 'q') kaydet(0);
    else if (c == 'w') kaydet(1);
    else if (c == 'e') kaydet(2);
    else if (c >= '1' && c <= '3') {
      int i = c - '1';
      turAtiyor = false;
      if (uc[i]) git(uc[i], "kayitli uc");
      else { Serial.print("uc"); Serial.print(i + 1); Serial.println(" kaydedilmedi"); }
    }
    else if (c == 'p') yazdir();
    else if (c == '+') { turMs = min(20000, turMs + 1000); Serial.print("durak = "); Serial.print(turMs); Serial.println(" ms"); }
    else if (c == '-') { turMs = max(500,   turMs - 1000); Serial.print("durak = "); Serial.print(turMs); Serial.println(" ms"); }
    else if (c == 'x') { turAtiyor = false; Serial.println("tur durdu"); }
    else if (c == 't') {
      if (uc[0] && uc[1] && uc[2]) { turAtiyor = true; Serial.println("tur basladi"); }
      else Serial.println("once uc uc de kaydedilmeli (q w e)");
    }
  }

  if (turAtiyor && millis() - sonAdim >= (unsigned long)turMs) {
    sonAdim = millis();
    git(uc[adim], "tur");
    adim = (adim + 1) % 3;
  }
}
