#include <Servo.h>

Servo servo;
const int SERVO_PIN = 9;

// ======== AYARLAR: sadece burayı değiştir ========
int  aciListesi[] = {0, 90, 180, 90};   // istediğin kadar açı ekle/çıkar
int  stepDelay    = 5;                 // derece başına ms (büyük = yavaş)
int  bekleme      = 1000;               // her açıda durma süresi (ms)
bool otomatik     = true;               // açılışta döngü çalışsın mı
// =================================================

const int ACI_SAYISI = sizeof(aciListesi) / sizeof(aciListesi[0]);

int mevcutAci = 0;
int sirasi    = 0;
int yeniHedef = -1;   // seri porttan gelen elle hedef (-1 = yok)

// ---------------------------------------------------------------

void yaz(const char* etiket, int deger) {
  Serial.print(etiket);
  Serial.println(deger);
}

void durumYaz() {
  Serial.println(F("---- DURUM ----"));
  yaz("Mevcut aci   : ", mevcutAci);
  yaz("Adim gecikme : ", stepDelay);
  yaz("Bekleme (ms) : ", bekleme);
  Serial.print(F("Mod          : "));
  Serial.println(otomatik ? F("OTOMATIK") : F("ELLE"));
  Serial.print(F("Aci listesi  : "));
  for (int i = 0; i < ACI_SAYISI; i++) {
    Serial.print(aciListesi[i]);
    if (i < ACI_SAYISI - 1) Serial.print(F(", "));
  }
  Serial.println();
  Serial.println(F("---------------"));
}

void yardim() {
  Serial.println(F("\n=== SERVO KONTROL (D9) ==="));
  Serial.println(F("  0-180  : o aciya git (elle moda gecer)"));
  Serial.println(F("  a      : otomatik donguyu baslat/durdur"));
  Serial.println(F("  h <ms> : adim gecikmesi (hiz)  orn: h 30"));
  Serial.println(F("  b <ms> : acida bekleme suresi  orn: b 2000"));
  Serial.println(F("  ?      : durumu yazdir"));
  Serial.println(F("==========================\n"));
}

// Seri portu okur. Hareket sirasinda da cagrildigi icin bloklamaz.
void seriOku() {
  if (!Serial.available()) return;

  String s = Serial.readStringUntil('\n');
  s.trim();
  if (s.length() == 0) return;

  char c = s.charAt(0);

  if (c == 'a' || c == 'A') {
    otomatik = !otomatik;
    Serial.print(F(">> Mod: "));
    Serial.println(otomatik ? F("OTOMATIK") : F("ELLE"));
  }
  else if (c == 'h' || c == 'H') {
    int v = s.substring(1).toInt();
    if (v > 0 && v <= 200) { stepDelay = v; yaz(">> Adim gecikme = ", stepDelay); }
    else Serial.println(F(">> Gecersiz (1-200 ms)"));
  }
  else if (c == 'b' || c == 'B') {
    int v = s.substring(1).toInt();
    if (v >= 0) { bekleme = v; yaz(">> Bekleme = ", bekleme); }
  }
  else if (c == '?') {
    durumYaz();
  }
  else if (isDigit(c)) {
    int v = s.toInt();
    if (v >= 0 && v <= 180) {
      yeniHedef = v;
      otomatik  = false;
      yaz(">> Elle hedef: ", v);
    } else {
      Serial.println(F(">> Aci 0-180 arasinda olmali"));
    }
  }
  else {
    yardim();
  }
}

// Bekleme sirasinda da komut dinler
void bekleVeDinle(unsigned long sure) {
  unsigned long t0 = millis();
  while (millis() - t0 < sure) {
    seriOku();
    if (yeniHedef >= 0) return;   // yeni komut geldi, beklemeyi kes
    delay(5);
  }
}

// 1'er derece adimlayarak yavasca hedefe gider
void yavasGit(int hedef) {
  hedef = constrain(hedef, 0, 180);
  if (hedef == mevcutAci) return;

  Serial.print(F("[GIT] "));
  Serial.print(mevcutAci);
  Serial.print(F(" -> "));
  Serial.print(hedef);
  Serial.print(F(" ... "));

  unsigned long t0 = millis();
  int adim = (hedef > mevcutAci) ? 1 : -1;

  while (mevcutAci != hedef) {
    mevcutAci += adim;
    servo.write(mevcutAci);

    seriOku();
    if (yeniHedef >= 0) {          // hareket ortasinda yeni komut
      Serial.print(F("KESILDI @"));
      Serial.println(mevcutAci);
      return;
    }
    delay(stepDelay);
  }

  Serial.print(F("tamam ("));
  Serial.print(millis() - t0);
  Serial.println(F(" ms)"));
}

// ---------------------------------------------------------------

void setup() {
  Serial.begin(9600);
  Serial.setTimeout(50);          // readStringUntil bloklamasin
  while (!Serial && millis() < 3000) { }   // Leonardo/Micro icin

  servo.attach(SERVO_PIN);
  servo.write(0);
  mevcutAci = 0;
  delay(500);

  yardim();
  durumYaz();
}

void loop() {
  seriOku();

  if (yeniHedef >= 0) {
    int h = yeniHedef;
    yeniHedef = -1;
    yavasGit(h);
  }
  else if (otomatik) {
    yavasGit(aciListesi[sirasi]);
    sirasi = (sirasi + 1) % ACI_SAYISI;
    bekleVeDinle(bekleme);
  }
  else {
    delay(20);                    // elle modda bosta bekle
  }
}