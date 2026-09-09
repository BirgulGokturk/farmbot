/*
 * Servo testi — sürekli dönüşlü servo
 *
 * Bu servoda darbe genişliği konumu değil HIZI söyler.
 * 1500 = dur. Konum = hız x süre, o yüzden süreyle konumlandırıyoruz.
 *
 * D9 = sinyal. Servo beslemesi ayrı 5V, Arduino ile ortak toprak.
 *
 * Seri ekran 9600 baud:  g = ileri,  f = geri,  s = dur
 */

#include <Servo.h>

// ------------------------------------------------- AYARLAR (elle değiştir)

const int HIZ  = 80;    // 1500'den uzaklık. Küçük = yavaş. 10-400 arası dene.
const int SURE = 100;   // bir darbe kaç ms döner

// -------------------------------------------------------------------------

Servo servo;
bool donuyor = false;
unsigned long basladi = 0;

void dur() {
  servo.writeMicroseconds(1500);
  donuyor = false;
  Serial.println("dur");
}

void basla(int yon) {
  servo.writeMicroseconds(1500 + yon * HIZ);
  donuyor = true;
  basladi = millis();
  Serial.println(yon > 0 ? "ileri" : "geri");
}

void setup() {
  // Pompalar NC ucunda: pinler sürülmezse su akar.
  pinMode(7, OUTPUT); digitalWrite(7, LOW);
  pinMode(8, OUTPUT); digitalWrite(8, LOW);

  Serial.begin(9600);
  servo.attach(9, 1000, 2000);
  dur();
  Serial.print("hiz="); Serial.print(HIZ);
  Serial.print("  sure="); Serial.println(SURE);
  Serial.println("g = ileri | f = geri | s = dur");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if      (c == 'g') basla(+1);
    else if (c == 'f') basla(-1);
    else if (c == 's') dur();
  }

  if (donuyor && millis() - basladi >= SURE) dur();
}
