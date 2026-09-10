/*
 * SERVO DENEME SKETCH'İ — tek işi servoyu döndürmek.
 * ---------------------------------------------------------------
 * Bu dosya, kullanıcının kendi yazıp SAHADA ÇALIŞTIĞINI DOĞRULADIĞI
 * koddur. Servo dönmediğinde "kod mu, donanım mı" sorusunu kapatmak için
 * duruyor: sensör yok, seri komut yok, JSON yok — sadece servo. Burada
 * dönüyorsa donanım sağlamdır ve arıza ana sketch'tedir; burada da
 * dönmüyorsa arıza donanımdadır (besleme, kablo, servo).
 *
 * TEK EKLEME: aşağıdaki RÖLE GÜVENLİĞİ bloğu. Servo mantığına
 * dokunulmadı, tek satırı değişmedi.
 *
 * DİKKAT — BU SKETCH YÜKLÜYKEN MAKİNE SENSÖRSÜZDÜR. Panel ölçüm
 * göstermez, röleler panelden sürülemez, uç seçimi çalışmaz. Deneme
 * bitince ana sketch'i geri yükleyin:
 *     cd ~/farmbot && bash arduino-yukle.sh
 *
 * BESLEME: takılan servo 0-180 derecelik bir MİKRO servo ve çekişini
 * Arduino'nun 5V pini karşılıyor — kullanıcının sahadaki gözlemi bu.
 * (Burada bir süre "MG996R, ayrı 2 A kaynak şart" yazıyordu; takılan o
 * değil. Yanlış donanım varsayımı bu arızada iki kez yanlış yere
 * baktırdı, o yüzden satır silinmedi, düzeltildi.)
 */

#include <Servo.h>

Servo myServo;

/* D10 — ANA SKETCH'LE AYNI PİN. Burada 9 yazıyordu ve bu, dosyayı tam da
 * var oluş sebebinin tersine çeviriyordu: sinyal D9'dan D10'a taşındı
 * (D9'da kopan bağlantı vardı), yani 9 yazan bu sketch KOPUK HATTI
 * sürüyor. "Kullanıcının kendi kodunda da dönmedi, demek servo/donanım
 * bozuk" sonucu buradan çıkardı ve YANLIŞ olurdu — ölçülen şey yalnızca
 * kopuk kablo olurdu. İki dosyadaki pin birlikte değişir. */
const int SERVO_PIN = 10;
int currentAngle = 0; // Tracks current servo position

void setup() {
  /* ---- RÖLE GÜVENLİĞİ — EKLENEN TEK ŞEY, İLK İŞ OLARAK -------------
   * Pompalar rölenin NC ucunda. Pin GİRİŞ ve boşta kaldığı sürece bobin
   * çekmiyor, NC kapalı kalıyor ve POMPA ÇALIŞIYOR. Yani bu iki satır
   * olmadan, servo denemesi boyunca su akar.
   *
   * LOW = bobin çekili = NC açık = pompa KAPALI (ana sketch'te
   * ROLE_AKTIF_LOW 0 ile aynı kutuplama). Önce seviye yazılıyor, sonra
   * pin çıkışa alınıyor: ters sırada pin bir an LOW'da kalıp röleye
   * darbe atıyor. */
  digitalWrite(7, LOW); pinMode(7, OUTPUT);   // su pompası
  digitalWrite(8, LOW); pinMode(8, OUTPUT);   // hava pompası
  /* ------------------------------------------------------------------ */

  myServo.attach(SERVO_PIN);
  myServo.write(currentAngle); // Move to 0 degrees initially
  delay(500);
}

void loop() {
  // Move to 90 degrees with a 20ms step delay (medium speed)
  moveToAngle(90, 5);
  delay(1000);

  // Move to 180 degrees with a 50ms step delay (slower speed)
  moveToAngle(180, 5);
  delay(1000);

  // Return to 0 degrees quickly with a 5ms step delay
  moveToAngle(0, 5);
  delay(2000);
}

// Function to move to target angle with speed control
void moveToAngle(int targetAngle, int stepDelay) {
  int step = (targetAngle > currentAngle) ? 1 : -1;

  while (currentAngle != targetAngle) {
    currentAngle += step;
    myServo.write(currentAngle);
    delay(stepDelay); // Larger delay = slower rotation speed
  }
}
