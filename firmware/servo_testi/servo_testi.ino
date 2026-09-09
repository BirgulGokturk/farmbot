/*
 * Servo testi — uç seçici, MİKROSANİYE ve RAMPA ile
 * -------------------------------------------------
 * NEDEN DERECE DEĞİL. `Servo.write(0..180)` kütüphanenin uydurduğu bir
 * eşleme: varsayılanı 544-2400 µs. Servonun gerçek aralığı bu değilse
 * uçlarda mekanik durdurucuya dayanıyor, arada kalan açılar da kayıyor.
 * Sahada görülen belirti buydu: üç durak yerine iki uç arasında gidip
 * gelme. Telde giden şey mikrosaniye; ölçülecek ve saklanacak olan da o.
 *
 * NEDEN RAMPA. Hobi servosunun hız ayarı YOK: komut verildiği anda
 * hedefe tam hızla gider. Yavaşlatmanın tek yolu hedefi küçük adımlarla
 * kaydırmak. `hedef` istenen yer, `us` o an gerçekten yazılan değer;
 * `us` hedefe `hizUsSn` µs/saniye hızıyla yürüyor.
 *
 * SERVO KONUM BİLDİRMİYOR. Potansiyometreyi kendi içinde okuyor, dışarı
 * söylemiyor. "Şu an 90 derecede" diyemeyiz, ancak "1500 µs komut ettik"
 * diyebiliriz. Panelde de böyle yazılacak.
 *
 * İKİ UÇ. Şu an iki konum aranıyor. Üçüncüsü gerekirse UC_SAYI ile
 * birlikte tur döngüsü de büyüyor.
 *
 * TESİSAT
 *   D9   servo sinyali
 *   Besleme AYRI 5V + ortak toprak. Yük altında 0,5-1 A çekiyor.
 *
 * STALL UYARISI: mil mekanik durdurucuya dayandığında motor zorlamaya
 * devam eder, akım fırlar, dişli sıyrılabilir. Servo VIZILDAMAYA başlarsa
 * ya da mil kımıldamayı bırakırsa HEMEN geri gelin (a / A).
 *
 * KOMUTLAR (seri ekran, 9600 baud)
 *   a / d     -25 / +25 µs    ince ayar
 *   A / D    -100 / +100 µs   kaba ayar
 *   q w       o anki değeri 1., 2. uç olarak KAYDET
 *   1 2       kayıtlı uca git
 *   t / x     tur başlat / durdur
 *   p         kayıtlı değerleri yazdır
 *   m         ortaya dön (1500 µs)
 *   + / -     durakta bekleme süresi  +-1 sn
 *   y / h     yavaşlat / hızlandır    (rampa hızı)
 *
 * Bulunan değerler `uclar.json`a girilecek olanlar — derece değil.
 */

#include <Servo.h>

#define SERVO_PIN        9
#define SU_POMPASI_PIN   7
#define HAVA_POMPASI_PIN 8

#define US_MIN  500
#define US_MAX  2500
#define UC_SAYI 2           /* şu an iki konum aranıyor */

/* Rampa adımı 20 ms: servonun kendi darbe aralığı da bu. Daha sık
 * yazmanın karşılığı yok. */
#define ADIM_MS 20

Servo servo;
int  us    = 1500;          /* o an yazılan değer */
int  hedef = 1500;          /* gidilmek istenen değer */
int  uc[UC_SAYI] = {0, 0};  /* 0 = henüz kaydedilmedi */
int  hizUsSn = 300;         /* rampa hızı, µs/saniye — düşük = yavaş */
int  turMs   = 5000;        /* durakta bekleme */
bool turAtiyor = false;
int  adim = 0;
unsigned long sonAdim = 0, sonTik = 0;
bool vardiYazildi = true;

void durumYaz(const char *neden) {
  Serial.print("us=");            Serial.print(us);
  Serial.print("  hedef=");       Serial.print(hedef);
  Serial.print("  hiz=");         Serial.print(hizUsSn);
  Serial.print("  calisma_sn=");  Serial.print(millis() / 1000UL);
  Serial.print("  ");             Serial.println(neden);
}

void git(int yeni, const char *neden) {
  hedef = constrain(yeni, US_MIN, US_MAX);
  vardiYazildi = false;
  durumYaz(neden);
}

void kaydet(int i) {
  uc[i] = hedef;
  Serial.print("KAYIT: uc");  Serial.print(i + 1);
  Serial.print(" = ");        Serial.print(hedef);
  Serial.println(" us");
}

void yazdir() {
  for (int i = 0; i < UC_SAYI; i++) {
    Serial.print("uc");  Serial.print(i + 1);  Serial.print(" = ");
    if (uc[i]) { Serial.print(uc[i]); Serial.println(" us"); }
    else Serial.println("(kaydedilmedi)");
  }
  Serial.print("hiz = ");   Serial.print(hizUsSn); Serial.println(" us/sn");
  Serial.print("durak = "); Serial.print(turMs);   Serial.println(" ms");
}

void setup() {
  /* İLK İŞ: röleleri kapalıya çek — asıl firmware'deki roleYaz(pin,false)
   * ile aynı (ROLE_AKTIF_LOW 0 olduğu için kapalı = LOW). Pompalar NC
   * ucunda, yani sürülmezse su akar. */
  pinMode(SU_POMPASI_PIN, OUTPUT);   digitalWrite(SU_POMPASI_PIN, LOW);
  pinMode(HAVA_POMPASI_PIN, OUTPUT); digitalWrite(HAVA_POMPASI_PIN, LOW);

  Serial.begin(9600);
  servo.attach(SERVO_PIN, US_MIN, US_MAX);
  servo.writeMicroseconds(us);
  durumYaz("acilis - orta");
  Serial.println("a/d = -+25us | A/D = -+100us | q w = kaydet 1/2 | 1 2 = git");
  Serial.println("t = tur | x = dur | p = yazdir | m = orta | + - = durak | y h = yavas/hizli");
  Serial.println("UYARI: servo vizildarsa durdurucuya dayanmistir, geri gelin.");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if      (c == 'a') { turAtiyor = false; git(hedef -  25, "ince"); }
    else if (c == 'd') { turAtiyor = false; git(hedef +  25, "ince"); }
    else if (c == 'A') { turAtiyor = false; git(hedef - 100, "kaba"); }
    else if (c == 'D') { turAtiyor = false; git(hedef + 100, "kaba"); }
    else if (c == 'm') { turAtiyor = false; git(1500, "orta"); }
    else if (c == 'q') kaydet(0);
    else if (c == 'w') kaydet(1);
    else if (c >= '1' && c < '1' + UC_SAYI) {
      int i = c - '1';
      turAtiyor = false;
      if (uc[i]) git(uc[i], "kayitli uc");
      else { Serial.print("uc"); Serial.print(i + 1); Serial.println(" kaydedilmedi"); }
    }
    else if (c == 'p') yazdir();
    else if (c == 'x') { turAtiyor = false; Serial.println("tur durdu"); }
    else if (c == 't') {
      bool hepsi = true;
      for (int i = 0; i < UC_SAYI; i++) if (!uc[i]) hepsi = false;
      if (hepsi) { turAtiyor = true; sonAdim = 0; Serial.println("tur basladi"); }
      else Serial.println("once iki uc de kaydedilmeli (q w)");
    }
    else if (c == '+') { turMs = min(20000, turMs + 1000);
                         Serial.print("durak = "); Serial.print(turMs); Serial.println(" ms"); }
    else if (c == '-') { turMs = max(500, turMs - 1000);
                         Serial.print("durak = "); Serial.print(turMs); Serial.println(" ms"); }
    else if (c == 'y') { hizUsSn = max(25, hizUsSn - 50);
                         Serial.print("hiz = "); Serial.print(hizUsSn); Serial.println(" us/sn"); }
    else if (c == 'h') { hizUsSn = min(3000, hizUsSn + 50);
                         Serial.print("hiz = "); Serial.print(hizUsSn); Serial.println(" us/sn"); }
  }

  /* RAMPA: `us` hedefe adım adım yürüyor. Servo her adımda yalnız birkaç
   * mikrosaniyelik yeni bir hedef görüyor, o yüzden yavaş dönüyor. */
  unsigned long simdi = millis();
  if (simdi - sonTik >= ADIM_MS) {
    sonTik = simdi;
    if (us != hedef) {
      int pay = (int)((long)hizUsSn * ADIM_MS / 1000L);
      if (pay < 1) pay = 1;
      if (abs(hedef - us) <= pay) us = hedef;
      else us += (hedef > us) ? pay : -pay;
      servo.writeMicroseconds(us);
    } else if (!vardiYazildi) {
      vardiYazildi = true;
      durumYaz("vardi");
    }
  }

  /* Tur beklemesi ancak rampa BİTTİKTEN sonra sayılıyor: yoksa yolda
   * geçen süre durakta geçmiş gibi olur ve 5 saniyelik durak gerçekte
   * çok daha kısa sürerdi. */
  if (turAtiyor && us == hedef) {
    if (sonAdim == 0) sonAdim = simdi;
    if (simdi - sonAdim >= (unsigned long)turMs) {
      sonAdim = 0;
      adim = (adim + 1) % UC_SAYI;
      git(uc[adim], "tur");
    }
  }
}
