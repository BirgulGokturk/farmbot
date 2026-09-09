/*
 * Servo testi — SÜREKLİ DÖNÜŞLÜ servo, zamanlı hareket
 * ----------------------------------------------------
 * SAHADA ÖLÇÜLDÜ: bu servo sürekli dönüşlü (continuous rotation).
 * Darbe genişliği KONUMU değil HIZI söylüyor:
 *     1500 µs  -> dur
 *     < 1500   -> bir yön, uzaklaştıkça hızlanır
 *     > 1500   -> öteki yön
 * Belirtiler bunu doğruladı: "0'dan 180'e gitmiyor, iki noktada gidip
 * geliyor" (iki konum değil, iki YÖN) ve 1500'ün az dışında bırakınca
 * durmadan dönmesi.
 *
 * KONUM ZAMANLA ÖLÇÜLÜYOR. Sürekli dönüşlü servoda konum = hız x süre.
 * Bu taslak tam olarak bunu yapıyor: seçilen hızda seçilen süre kadar
 * döndürüp kesiyor. "90 derece kaç saniye sürüyor" sorusunu masa
 * başında ölçmek için.
 *
 * BİLİNMESİ GEREKEN SINIR — bu bir ÖLÇÜM DEĞİL, AÇIK ÇEVRİM.
 * Servo nerede olduğunu söylemiyor ve zamanla konumlandırma KAYIYOR:
 * besleme gerilimi, yük, sıcaklık ve motorun kalkış/duruş gecikmesi her
 * seferinde biraz farklı bir açı veriyor. Birkaç turdan sonra uçlar
 * yerinden kayar. Kalıcı çözüm için ya her uç konumuna bir anahtar
 * (index) koymak ya da standart konumlu servoya geçmek gerekiyor.
 * Şimdilik ölçüyoruz; kayma miktarını da ölçeceğiz.
 *
 * TESİSAT
 *   D9   servo sinyali
 *   Besleme AYRI 5V + ortak toprak. Yük altında 0,5-1 A çekiyor.
 *
 * KOMUTLAR (seri ekran, 9600 baud)
 *   g         İLERİ  yönde `sure` ms dön, sonra dur
 *   f         GERİ   yönde `sure` ms dön, sonra dur
 *   s         hemen dur
 *   + / -     süreyi 50 ms artır / azalt
 *   h / y     hızı artır / azalt (1500'den uzaklık)
 *   r         `tekrar` kadar arka arkaya darbe at (aralarında 400 ms)
 *   R / T     tekrar sayısını artır / azalt
 *   p         ayarları yazdır
 *
 * ÖLÇÜM YOLU
 *   1. Mile bir işaret koyun (bant, kalem).
 *   2. `g` ile tek darbe atın, dönen açıyı ölçün.
 *   3. 90 dereceye kaç darbe gerektiğini sayın ya da `+` ile süreyi
 *      büyütüp tek darbede 90 dereceyi tutturun.
 *   4. Bulduğunuz süre + hız ikilisini not edin: `uclar.json`a girilecek
 *      olan bunlar. Derece hiçbir yerde saklanmayacak.
 */

#include <Servo.h>

#define SERVO_PIN        9
#define SU_POMPASI_PIN   7
#define HAVA_POMPASI_PIN 8

#define US_DUR   1500       /* sürekli dönüşlü servoda "dur" */
#define US_MIN   1000
#define US_MAX   2000

Servo servo;
int  hiz     = 80;          /* 1500'den uzaklık — küçük = yavaş */
int  sure    = 100;         /* bir darbenin süresi, ms */
int  tekrar  = 1;           /* r ile kaç darbe */
int  kalanTekrar = 0;
int  yon     = 1;           /* +1 ileri, -1 geri */
bool donuyor = false;
unsigned long basladi = 0, bekleme = 0;

void ayarYaz() {
  Serial.print("hiz=");     Serial.print(hiz);
  Serial.print(" us  sure=");  Serial.print(sure);
  Serial.print(" ms  tekrar="); Serial.print(tekrar);
  Serial.print("  calisma_sn="); Serial.println(millis() / 1000UL);
}

void dur(const char *neden) {
  servo.writeMicroseconds(US_DUR);
  donuyor = false;
  Serial.print("DUR  ");  Serial.println(neden);
}

void basla(int y) {
  yon = y;
  int us = constrain(US_DUR + y * hiz, US_MIN, US_MAX);
  servo.writeMicroseconds(us);
  donuyor = true;
  basladi = millis();
  Serial.print(y > 0 ? "ILERI" : "GERI");
  Serial.print("  us=");    Serial.print(us);
  Serial.print("  sure=");  Serial.print(sure);
  Serial.println(" ms");
}

void setup() {
  /* İLK İŞ: röleleri kapalıya çek — asıl firmware'deki roleYaz(pin,false)
   * ile aynı (ROLE_AKTIF_LOW 0 olduğu için kapalı = LOW). Pompalar NC
   * ucunda, yani sürülmezse su akar. */
  pinMode(SU_POMPASI_PIN, OUTPUT);   digitalWrite(SU_POMPASI_PIN, LOW);
  pinMode(HAVA_POMPASI_PIN, OUTPUT); digitalWrite(HAVA_POMPASI_PIN, LOW);

  Serial.begin(9600);
  servo.attach(SERVO_PIN, US_MIN, US_MAX);
  dur("acilis");
  Serial.println("g = ileri darbe | f = geri darbe | s = dur");
  Serial.println("+ - = sure  |  h y = hiz  |  r = tekrar at  |  R T = tekrar sayisi  |  p = yazdir");
  ayarYaz();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if      (c == 'g') { kalanTekrar = 0; basla(+1); }
    else if (c == 'f') { kalanTekrar = 0; basla(-1); }
    else if (c == 's') { kalanTekrar = 0; dur("elle"); }
    else if (c == '+') { sure = min(5000, sure + 50); ayarYaz(); }
    else if (c == '-') { sure = max(20,   sure - 50); ayarYaz(); }
    else if (c == 'h') { hiz  = min(500,  hiz + 10);  ayarYaz(); }
    else if (c == 'y') { hiz  = max(10,   hiz - 10);  ayarYaz(); }
    else if (c == 'R') { tekrar = min(50, tekrar + 1); ayarYaz(); }
    else if (c == 'T') { tekrar = max(1,  tekrar - 1); ayarYaz(); }
    else if (c == 'p') ayarYaz();
    else if (c == 'r') {
      kalanTekrar = tekrar;
      Serial.print("TEKRAR x"); Serial.println(tekrar);
      basla(+1);
      kalanTekrar--;
    }
  }

  /* Darbe süresi dolunca kes. Sürekli dönüşlü servoda konumu belirleyen
   * tek şey bu süre; bu yüzden kesme işi gecikmesiz olmalı. */
  if (donuyor && millis() - basladi >= (unsigned long)sure) {
    unsigned long gecen = millis() - basladi;
    dur("sure doldu");
    Serial.print("  gercek sure = "); Serial.print(gecen); Serial.println(" ms");
    if (kalanTekrar > 0) bekleme = millis();
  }

  /* Tekrarlar arasında kısa bekleme: motorun tamamen durması için.
   * Beklemeden art arda darbe atmak, tek uzun darbeyle aynı şey olurdu
   * ve saydığımız sayı anlamını yitirirdi. */
  if (!donuyor && kalanTekrar > 0 && bekleme && millis() - bekleme >= 400) {
    bekleme = 0;
    basla(yon);
    kalanTekrar--;
  }
}
