
#include <Wire.h>
#include <Adafruit_BMP085.h>
#include <DHT.h>
#include <Servo.h>

/* --------------------------------------------------------- SRAM NOTU ----
 * SERIAL'A YAZILAN HER DÜZ METİN `F(...)` İÇİNDE. Bu süs değil.
 *
 * AVR'de düz metinler varsayılan olarak açılışta flash'tan SRAM'e
 * KOPYALANIYOR ve orada kalıyorlar — kullanılsalar da kullanılmasalar da.
 * Uno'da toplam SRAM 2048 bayt; bu sketch'te yardım satırı, VERI alan
 * adları ve onlarca KOMUT/HATA mesajı bir araya gelince derleyici şunu
 * yazıyordu:
 *     Global variables use 1678 bytes (81%), leaving 370 bytes
 *     Low memory available, stability problems may occur.
 * Kalan 370 bayt hem yığını (stack) hem de String'lerin öbeğini (heap)
 * BİRLİKTE besliyor. `komutIsle` bir komut işlerken String kopyaları
 * üretiyor; ikisi ortada karşılaşırsa bellek sessizce bozuluyor ve kart
 * ya kilitleniyor ya sıfırlanıyor.
 *
 * NEDEN ÖNEMLİ: sahada tam bu görüldü — komut kabul edildi, süpürme
 * başladı, bir derece adımladı, sonra açılış banner'ı geldi. O sırada bu
 * "besleme çöküyor" diye okundu. Yetersiz SRAM dışarıdan buna birebir
 * benziyor ve teşhisi doğrudan güç kaynağına yönlendiriyor.
 *
 * `F(...)` metni flash'ta bırakıyor. Yeni bir Serial satırı eklerken
 * sarmayı unutmayın; unutulan her satır bu payı geri yer. */

// --------------------------------------------------------------- AYARLAR --
#define DHT_PIN        2
#define SU_POMPASI_PIN 7
#define HAVA_POMPASI_PIN 8

/* Tek toprak sensörü var ve tool ucunda: makine nereye giderse ölçüm
 * oradan geliyor. Ölçek: kuru toprakta değer YÜKSEK, ıslakta düşük.
 * Yüzdeye çevirmek panelin işi, ham değer olduğu gibi gidiyor. */
#define TOPRAK_PIN     A1

/* 0 = "aç" dediğimizde pine HIGH gidiyor. Pompalar NC ucunda olduğu için
 * pompayı çalıştırmak bobini BIRAKMAK demek, çekmek değil. */
#define ROLE_AKTIF_LOW 0

/* SERVO SİNYALİ D12'DE. Sırasıyla D9 -> D10 -> D12 diye taşındı; her
 * taşımada kablo gitti, YAZILIM BİR ADIM GERİDE KALDI ve belirtisi hep aynı
 * oldu: kart komutu kabul ediyor, süpürmeyi başlatıyor, servo kımıldamıyor.
 * Çünkü kart o sırada BOŞ BİR PİNİ sürüyordu.
 *
 * BU SAYI KABLONUN NEREDE OLDUĞUNU SÖYLER, BAŞKA HİÇBİR ŞEYİ. Servo
 * kütüphanesi Uno'da herhangi bir dijital pini sürebiliyor (zamanlamayı
 * Timer1'den alıyor, pinin donanım PWM'inden değil), o yüzden 12'nin
 * seçilmesinin bir bedeli yok. D12 burada başka hiçbir şeye bağlı değil.
 *
 * DEĞİŞTİRİRKEN: `firmware/servo_testi/servo_testi.ino` içindeki SERVO_PIN
 * de aynı anda değişmeli. İkisi ayrı düşerse deneme sketch'i kopuk hattı
 * sürer ve "kullanıcının kendi kodunda da dönmedi, demek donanım bozuk"
 * gibi YANLIŞ bir sonuç üretir. */
#define SERVO_PIN      12

/* ---------------------------------------------------- SERVO DENEME KİPİ --
 * KONUMLU SERVO. `write(derece)` horn'u o açıya sürer ve orada tutar;
 * açı açıdır. Deneme döngüsü 0-90-180-0 turunu derece derece süpürüyor.
 *
 * BURADA BİR SÜRE BUNUN TAM TERSİ YAZIYORDU: "sürekli dönüşlü servo,
 * `write` hız verir, ölü bant çok dar, açı = hız × süre". O teşhis
 * YANLIŞTI ve yirmi satır aşağıdaki `SERVO_SUREKLI_DONUSLU 0` ile
 * çelişiyordu. Aynı dosyada iki gerçek durunca arıza aranırken yanlış
 * yere bakıldı; takılan servo 0-180 mikro servo, konumlu, anahtar 0
 * doğrudur. Metin silinmedi ki aynı yanlış yola tekrar girilmesin.
 *
 * KONUM YİNE DE AÇIK DÖNGÜ: servoda geri besleme yok. Kart ne KOMUT
 * ETTİĞİNİ bilir, horn'un oraya gidip gitmediğini bilmez; kart
 * sıfırlanırsa (pompa çekişinde oluyor) komut edilen açı da unutulur. */

/* AÇILIŞTA BAŞLASIN MI? Varsayılan 0 — kart pompa çekişinde sıfırlanıyor
 * ve açılışta kendiliğinden dönen bir servo, uçlar takılıyken istenmez.
 * Seri porttan "TEST" yazınca başlıyor, tekrar yazınca duruyor. */
#define TEST_ACILISTA 0

/* SERVO SÜREKLİ DÖNÜŞLÜ MÜ? 0 = konumlu, 1 = sürekli dönüşlü.
 *
 * ŞU ANKİ DONANIM: 0-180 derecelik mikro servo, yani KONUMLU. Burası 0.
 * (Bir ara MG996R konuşuldu; takılan o değil. Mikro servonun çekişini
 * Arduino'nun 5V pini karşılıyor.)
 *
 * NEDEN ANAHTAR DURUYOR: `UC` komutu servoya `write(derece)` yazıyor.
 * Konumlu servoda bu "o açıya git ve orada dur" demek. Sürekli dönüşlüde
 * aynı yazma "şu hızda dön" demek ve kendiliğinden durmuyor; o durumda
 * süre dolunca durma darbesi gerekiyor. Servo değişirse tek satır. */
#define SERVO_SUREKLI_DONUSLU 0
//: Sürekli dönüşlü servoda motorun durduğu değer. `write` ölçeğinde.
#define SERVO_DURMA_DEGERI 90

/* ⚙️ DENEME DÖNGÜSÜNÜN AYARLARI ARTIK BU BLOKTA DEĞİL.
 *
 * Döngü, kullanıcının yazıp sahada denediği kodun kendisi ve AYNEN
 * duruyor (aşağıda `testDongusu` ve `moveToAngle`). Açıları, adım
 * gecikmesini ve bekleme sürelerini oradaki satırlardan değiştirin:
 *     moveToAngle(90, 5);   <- hedef açı, derece başına ms
 *     delay(1000);          <- o açıda bekleme
 *
 * Değerleri buraya sabit olarak çıkarmak kodu "aynen" olmaktan
 * çıkarırdı; iki yerde iki gerçek olmasındansa tek yerde duruyorlar. */

#define OLCUM_ARALIGI_MS 2000

// --------------------------------------------------------------- DURUM ----
/* DHT tipi ELLE SEÇİLMİYOR. Yanlış tip seçilince kütüphane sessizce NaN
 * döndürüyor ve sensör bozuk sanılıyor. Açılışta ikisi de deneniyor. */
DHT dht11(DHT_PIN, DHT11);
DHT dht22(DHT_PIN, DHT22);
DHT *dht = &dht11;
const char *dhtAdi = "DHT11";
Adafruit_BMP085 bmp;
bool bmpVar = false;

// Rölelerin gerçek durumu. Panel bunu tahmin etmiyor, kart söylüyor.
bool suPompasiAcik = false;
bool havaPompasiAcik = false;

/* ------------------------------------------------------------ UÇ SEÇİCİ --
 * SERVODA GERİ BESLEME YOK. Kart ne KOMUT ETTİĞİNİ bilir, horn'un gerçekte
 * nerede olduğunu bilmez. -1 "hiç komut verilmedi" demek.
 *
 * SERVO AÇILIŞTA TAKILMIYOR (attach): `attach()` darbe genişliğini 1500 us'e
 * kurup sinyali hemen üretmeye başlıyor, yani açılışta attach etmek horn'u
 * komut vermeden 90 dereceye SÜRMEK demek. İlk komutta takılıyor. */
Servo ucServo;
bool ucTakili = false;
int ucSecili = -1;              // komut edilen uç indeksi; -1 = bilinmiyor
int ucAci = -1;                 // komut edilen derece; -1 = bilinmiyor
bool ucHarekette = false;
unsigned long ucKomutMs = 0;
unsigned long ucSureMs = 0;     // hareket süresi — KOMUTLA geliyor

unsigned long sonOlcum = 0;
String girisTamponu = "";

/* Deneme kipinin durumu. Sizin kodunuzdaki döngünün aynısı, ama `delay`
 * yerine `millis` ile: `delay` bu sketch'te olmaz — servo dönerken sensör
 * okuması ve seri komutlar da durur, kart 3 saniye sağır kalır. */
bool testAcik = false;
/* Kaçıncı tur. KULLANICININ KODUNUN DIŞINDA sayılıyor; tek işi turun
 * gerçekten dönüp dönmediğini ölçülebilir kılmak. */
unsigned long turNo = 0;
/* İleri bildirim: `ucKomut` bu dosyada `testDurdur`dan ÖNCE tanımlı. */
void testDurdur();
void moveToAngle(int targetAngle, int stepDelay);  // testDongusu bundan once tanimli
void testDongusu();
int  usDeger(int derece);   // testBasla bunu kendinden ONCE cagiriyor
void testBasla();   // setup, TEST_ACILISTA 1 iken bunu çağırıyor
/* KULLANICININ DEĞİŞKENİ, AYNEN. `moveToAngle` bunu okuyup yazıyor. */
int currentAngle = 0; // Tracks current servo position

/* KULLANICININ KODU `myServo` DİYOR. Aynı pini süren ikinci bir Servo
 * nesnesi açmak olmaz — tek pin, tek nesne. Bu yüzden yeni nesne değil,
 * mevcut `ucServo`ya bir TAKMA AD veriliyor: kullanıcının satırları
 * harfi harfine kalıyor, sürülen nesne yine tek. */
Servo &myServo = ucServo;

// --------------------------------------------------------------- RÖLE -----
/* Pine kapalı seviyeyi YAZIP sonra OUTPUT yapıyoruz. Ters sırada pin bir
 * an LOW kalıyor ve aktif-LOW kartta röle çekiyor. */
void roleHazirla(int pin) {
  digitalWrite(pin, ROLE_AKTIF_LOW ? HIGH : LOW);
  pinMode(pin, OUTPUT);
}

void roleYaz(int pin, bool acik) {
#if ROLE_AKTIF_LOW
  digitalWrite(pin, acik ? LOW : HIGH);
#else
  digitalWrite(pin, acik ? HIGH : LOW);
#endif
  if (pin == SU_POMPASI_PIN) suPompasiAcik = acik;
  else if (pin == HAVA_POMPASI_PIN) havaPompasiAcik = acik;
}

/** Hangi DHT takılı? Okuma verene karar veriyoruz. */
void dhtSec() {
  for (int tip = 0; tip < 2; tip++) {
    DHT *aday = tip == 0 ? &dht11 : &dht22;
    aday->begin();
    for (int deneme = 0; deneme < 2; deneme++) {
      /* 2 saniye: DHT11 veri sayfası açılıştan sonra 1 sn kararlılık
       * istiyor, klonlar daha uzun sürebiliyor. */
      delay(2000);
      if (!isnan(aday->readTemperature())) {
        dht = aday;
        dhtAdi = tip == 0 ? "DHT11" : "DHT22";
        Serial.print(F("BILGI: DHT tipi "));
        Serial.println(dhtAdi);
        return;
      }
    }
  }
  dht = &dht11;
  dhtAdi = "yok";
  Serial.println(F("UYARI: DHT okumuyor — kabloyu ve D2'yi kontrol edin"));
}

// --------------------------------------------------------------- KURULUM --
void setup() {
  /* İLK İŞ BU. Serial.begin bile sonra geliyor: sıfırlamadan bu satıra
   * kadar pinler GİRİŞ ve boşta duruyor, aktif-LOW röle kartında boşta
   * giriş "röle çeksin" demek. */
  roleHazirla(SU_POMPASI_PIN);
  roleHazirla(HAVA_POMPASI_PIN);
  roleYaz(SU_POMPASI_PIN, false);
  roleYaz(HAVA_POMPASI_PIN, false);

  Serial.begin(9600);
  dhtSec();
  bmpVar = bmp.begin();
  if (!bmpVar) Serial.println(F("UYARI: BMP180 bulunamadi, digerleriyle devam"));

  Serial.println(F("Hazir. Komutlar: ROLE <ad> <0|1> | UC <indeks> <derece> <sure_ms> | KAPAT | OKU | TEST <0|1> | ACI <0-180> | US <544-2400>"));
#if TEST_ACILISTA
  testBasla();
#endif
}

// ------------------------------------------------------------- UÇ SEÇİCİ --
/* Açı ve süre KOMUTLA geliyor, kartta saklanmıyor: kart pompa çekişinde
 * sıfırlanıyor ve saklanan bir tablo sessizce silinirdi. Servoda geri
 * besleme olmadığı için bunu yakalayacak hiçbir yol yok. */
void ucKomut(int indeks, int derece, long sureMs) {
  /* Deneme kipi açıkken gelen gerçek bir uç komutu denemeyi kapatıyor:
   * ikisi aynı servoyu sürüyor. */
  if (testAcik) testDurdur();
  if (!ucTakili) { ucServo.attach(SERVO_PIN); ucTakili = true; }
  ucServo.write(derece);
  /* DENEMENİN BAŞLANGIÇ NOKTASI DA GÜNCELLENİYOR. `currentAngle` horn'un
   * nerede olduğuna dair kartın tek kaydı ve `moveToAngle` adım yönünü
   * ondan hesaplıyor. Burada güncellenmediği sürece şu oluyordu: panelden
   * bir baş seçilip horn 140 dereceye gidiyor, sonra deneme başlatılıyor,
   * `moveToAngle(85, 5)` hâlâ 0'dan başladığını sanıyor ve ilk yazdığı
   * değer 1 oluyor — yani horn 140'tan 1'e TEK HAMLEDE çarpıyor, sonra
   * 85'e yürüyor. Adımlı süpürmenin bütün amacı o çarpmayı önlemekti.
   * `aciyaSur` bunu zaten yapıyordu; `UC` yolunda unutulmuştu. */
  currentAngle = derece;
  ucSecili = indeks;
  ucAci = derece;
  ucSureMs = (unsigned long)sureMs;
  ucKomutMs = millis();
  /* VARIŞ ANINDA DEĞİL. Komut yazıldığı anda "vardı" demek, Pi'nin ucu
   * daha yoldayken iş başlatmasına izin verirdi. */
  ucHarekette = true;
}

void ucGozet() {
  if (ucHarekette && millis() - ucKomutMs >= ucSureMs) {
#if SERVO_SUREKLI_DONUSLU
    /* DURDURMA ŞART. Sürekli dönüşlü servoda `write(derece)` hız
     * veriyor ve süre dolduğunda kendiliğinden durmuyor: kart "vardım"
     * derken servo dönmeye devam eder. Konumlu servoda bu satır
     * yanlış olurdu — horn'u 90 dereceye sürerdi — o yüzden anahtarın
     * arkasında. */
    ucServo.write(SERVO_DURMA_DEGERI);
#endif
    ucHarekette = false;
    sonOlcum = 0;                   // "vardı" bilgisi beklemeden gitsin
  }
}

// ---------------------------------------------------- SERVO DENEME KİPİ --
/* AŞAĞIDAKİ İKİ İŞLEV KULLANICININ KODUDUR — HARFİ HARFİNE.
 *
 * Yorumları dâhil tek karakteri değiştirilmedi. Sebebi: bu kod sahada
 * denendi ve servonun döndüğü görüldü. Ondan sonraki her uyuşmazlık
 * "acaba çevirirken mi bozdum" sorusunu doğurdu. Artık o soru yok.
 *
 * BEDELİ BİLEREK KABUL EDİLDİ: `delay` kullanıyor. Deneme AÇIKKEN kart bir
 * tur boyunca (~5,8 sn) başka hiçbir şey yapmaz — sensör satırı gelmez,
 * seri komut işlenmez, dolayısıyla `TEST 0` ancak turun sonunda görülür.
 * Deneme KAPALIYKEN hiçbir etkisi yok; bu yüzden döngü ana `loop`a
 * gömülmedi, `testAcik` kapısının arkasında duruyor.
 *
 * TUR SÜRESİ AŞAĞIDAKİ SATIRLARDAN ÇIKIYOR, sabit değil:
 *     0->85 @5ms = 425 ms  +  delay(1000)
 *    85->180 @5ms = 475 ms  +  delay(1000)
 *   180->0 @5ms = 900 ms    +  delay(2000)
 *   toplam ~5800 ms
 * Açıları ya da adım gecikmesini değiştirirseniz bu sayı da değişir ve
 * dosyadaki "~5,8 sn" ifadeleri eskir. */

// ---- kullanıcının kodu: BAŞLANGIÇ -----------------------------------
void testDongusu() {
  // Move to 90 degrees with a 20ms step delay (medium speed)
  moveToAngle(85, 5); 
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
// ---- kullanıcının kodu: BİTİŞ ---------------------------------------

void testBasla() {
  testAcik = true;
  turNo = 0;
  /* KULLANICININ `setup`'INDAKİ ÜÇ SATIR BURADA.
   *
   * Kendi sketch'inde bunlar `setup`ta duruyordu: kart her açıldığında
   * servo takılıp 0 dereceye sürülüyordu. Ana sketch'te bu olmaz —
   * açılışta `attach` etmek horn'u komut verilmeden sürmek demek ve kart
   * pompa çekişinde sıfırlanıyor; her sıfırlanmada uç kendiliğinden
   * dönerdi. Satırlar silinmedi, denemenin başına alındı: denemenin
   * gördüğü davranış birebir aynı, makinenin açılışı etkilenmiyor. */
  myServo.attach(SERVO_PIN);
  ucTakili = true;
  myServo.write(currentAngle); // Move to 0 degrees initially
  delay(500);

  /* HANGİ UÇ SEÇİLİ BİLİNMİYOR: deneme horn'u uçlarla eşleşmeyen açılara
   * götürüyor, eski kaydı bırakmak bilinmeyeni bilinen gibi göstermek
   * olurdu. */
  ucSecili = -1;
  ucAci = currentAngle;
  ucHarekette = false;
  Serial.println(F("KOMUT: servo denemesi BASLADI — 90, 180, 0 turu. Durdurmak icin TEST 0"));
  Serial.println(F("       (deneme acikken kart tur basina ~5,8 sn sessiz kalir)"));
  sonOlcum = 0;
}

void testDurdur() {
  testAcik = false;
  /* SERVOYU BIRAKMIYORUZ (detach yok) ve SERVOYA YENİ BİR AÇI YAZMIYORUZ:
   * horn nerede durduysa orada kalsın. Durdurma anında bir açı yazmak,
   * "dur" komutuna hareketle cevap vermek olurdu. Aşağıdaki satır servoyu
   * değil, kartın RAPORUNU düzeltiyor; ikisi ayrı şey. */
  /* RAPOR EDİLEN AÇI GERÇEĞE ÇEKİLİYOR. `ucAci` denemenin başında bir kez
   * yazılıp bir daha güncellenmiyordu: deneme boyunca ve bittikten sonra
   * kart, horn 180'deyken bile "0 derece" bildiriyordu. Komut edilen son
   * değer `currentAngle`; rapor da onu söylemeli. SERVOYA BİR ŞEY
   * YAZILMIYOR — horn nerede durduysa orada kalıyor. */
  ucAci = currentAngle;
  Serial.print(F("KOMUT: servo denemesi DURDU — son aci "));
  Serial.println(currentAngle);
  sonOlcum = 0;
}

/** Turun başına ve sonuna birer imza atar — deneme kipinin tek penceresi.
 *
 *  Deneme açıkken kart bir tur boyunca (~5,8 sn) susuyor ve o sessizlikte
 *  birbirinden çok farklı üç durum aynı görünüyordu: tur hiç başlamadı,
 *  tur döndü ama horn kımıldamadı, tur ortasında kart sıfırlandı. Sahada
 *  tam üçüncüsü bir kez yaşandı — süpürme başladı, bir derece adımladı,
 *  sonra açılış banner'ı geldi. Böyle bir olayı ayırt etmenin tek yolu,
 *  turun iki ucuna zaman damgası koymak. */
void turYaz(const char *durum) {
  Serial.print(F("TUR: "));
  Serial.print(turNo);
  Serial.print(' ');
  Serial.print(durum);
  Serial.print(F(" t="));
  Serial.print(millis());
  Serial.print(F(" aci="));
  Serial.println(currentAngle);
}

/** Bir `write(derece)` değerinin kaç mikrosaniyelik darbeye karşılık
 *  geldiği. Arduino'nun Servo kütüphanesi 0..180'i 544..2400 us'e
 *  eşliyor — yani `write(90)` 1500 DEĞİL, 1472 us. Servo beklenmedik
 *  yerde duruyorsa bakılacak sayı bu; derece bunu göstermiyor. */
int usDeger(int derece) {
  return 544 + (int)((long)derece * (2400L - 544L) / 180L);
}

/** Servoyu doğrudan bir açıya sürer — mekanizmayı elle yoklamak için.
 *
 *  NEDEN VAR: uç açıları ayar dosyasında ve panelden geliyor; ama makine
 *  başındayken "şu açıda hangi uç iniyor" sorusunu yeniden yükleme
 *  yapmadan cevaplamak gerekiyor. Ölçüp panele gireceğiniz sayıları
 *  burada buluyorsunuz.
 *
 *  TEK HAMLEDE yazıyor, adımlamıyor: elle yoklarken hedefin neresi
 *  olduğu önemli, oraya nasıl gidildiği değil. */
void aciyaSur(int derece) {
  if (testAcik) testDurdur();
  if (!ucTakili) { ucServo.attach(SERVO_PIN); ucTakili = true; }
  ucServo.write(derece);
  currentAngle = derece;          // deneme buradan devam edebilsin
  /* UÇ BİLGİSİ GEÇERSİZ: elle sürmek horn'u bir uçla eşleşmeyen açıya
   * götürebilir, "şu uç seçili" kaydı artık doğruyu anlatmaz. */
  ucSecili = -1;
  ucAci = derece;
  ucHarekette = false;
  Serial.print(F("KOMUT: aci "));
  Serial.print(derece);
  Serial.print(F(" ("));
  Serial.print(usDeger(derece));
  Serial.println(F(" us)"));
  sonOlcum = 0;
}

/** Servoyu doğrudan MİKROSANİYE ile sürer — 1 us çözünürlük.
 *
 *  `write(derece)` bir dereceyi ~10,3 us'ye eşliyor, yani en küçük adım
 *  10 us. Servonun tam olarak nerede durduğunu ya da nerede kımıldamaya
 *  başladığını aramak gerektiğinde o adım fazla kaba kalıyor. */
void usYaz(int mikro) {
  if (testAcik) testDurdur();
  if (!ucTakili) { ucServo.attach(SERVO_PIN); ucTakili = true; }
  ucServo.writeMicroseconds(mikro);
  /* Mikrosaniyeden dereceye GERİ çeviriyoruz: `usDeger`in tersi. Tahmin
   * değil, aynı doğrusal eşlemenin tersi — yalnız yuvarlama payı var.
   * Yapılmazsa `currentAngle` bu komuttan sonra eskimiş kalır ve deneme
   * yanlış yerden başlar (bkz. `ucKomut`). */
  currentAngle = (int)(((long)(mikro - 544) * 180L + 928L) / 1856L);
  ucSecili = -1;
  /* `ucAci` YİNE -1: derece raporu "hangi baş seçili" sorusuna hizmet
   * ediyor ve `US` komutu horn'u hiçbir başla eşleşmeyen bir yere
   * götürmüş olabilir. `currentAngle` kartın iç kaydı, `ucAci` dışarıya
   * verilen cevap; ikisi ayrı sorulara bakıyor. */
  ucAci = -1;
  ucHarekette = false;
  Serial.print(F("KOMUT: "));
  Serial.print(mikro);
  Serial.println(F(" us"));
  sonOlcum = 0;
}

// --------------------------------------------------------------- KOMUT ----
void komutIsle(String komut) {
  komut.trim();
  if (!komut.length()) return;

  String buyuk = komut;
  buyuk.toUpperCase();

  if (buyuk == "KAPAT") {
    roleYaz(SU_POMPASI_PIN, false);
    roleYaz(HAVA_POMPASI_PIN, false);
    Serial.println(F("KOMUT: hepsi kapatildi"));
    sonOlcum = 0;
    return;
  }

  if (buyuk == "OKU") { sonOlcum = 0; return; }

  // Servo denemesini başlat/durdur. Ayarlar dosyanın başındaki blokta.
  /* Servo denemesi. Çıplak "TEST" DEĞİŞTİRİR; "TEST 1" / "TEST 0" ise
   * DURUMU KESİN KURAR.
   *
   * İKİ BİÇİM DE GEREKLİ. Seri porttan elle yazarken "TEST" kısa ve
   * yeterli. PANEL DÜĞMESİ için değiştirmek yanlış: komut kaybolur ya da
   * iki kez giderse düğme ile kartın hâli ayrışıyor — düğme "başlat"
   * derken kart durduruyor. Panel her zaman İSTEDİĞİ durumu yazıyor.
   *
   * BU BLOK BİR SÜRE EKSİK KALDI ve belirtisi kafa karıştırıcıydı:
   * yardım satırı "TEST <0|1>" yazıyordu ama ayrıştırıcı yalnız çıplak
   * "TEST"i tanıdığı için panelden gelen "TEST 1" komutuna kart
   * "bilinmeyen komut" diyordu. Panel "başlıyor" yazıyor, servo
   * kımıldamıyordu. Yardım metniyle ayrıştırıcı ayrı düşerse hata
   * kullanıcıya YANLIŞ YERİ gösteriyor. */
  if (buyuk == "TEST" || buyuk.startsWith("TEST ")) {
    if (buyuk == "TEST") {
      if (testAcik) testDurdur(); else testBasla();
      return;
    }
    bool istenen = komut.substring(komut.indexOf(' ') + 1).toInt() != 0;
    if (istenen == testAcik) {
      Serial.print(F("KOMUT: servo denemesi zaten "));
      Serial.println(testAcik ? F("ACIK") : F("KAPALI"));
      return;
    }
    if (istenen) testBasla(); else testDurdur();
    return;
  }

  if (buyuk.startsWith("US ")) {
    // "US 1530" — darbe genişliğini doğrudan ver. 1500 = dur (nominal).
    int mikro = komut.substring(komut.indexOf(' ') + 1).toInt();
    /* Servo kütüphanesinin kendi aralığı 544-2400. Dışına yazmak sessizce
     * kırpılır; kırpıldığını söylemek, olmayan bir değeri denediğini
     * sanmaktan iyi. */
    if (mikro < 544 || mikro > 2400) { Serial.println(F("HATA: US 544-2400")); return; }
    usYaz(mikro);
    return;
  }

  /* "ACI 120" — servoyu o açıya sürer. "HIZ" da kabul ediliyor ama adı
   * düzeltilerek: servo sürekli dönüşlü sanılırken komut HIZ'dı; ezber
   * hâline gelmiş bir komutu sessizce "bilinmeyen" yapmak yerine ne
   * değiştiğini söylüyoruz. */
  if (buyuk.startsWith("ACI ") || buyuk.startsWith("HIZ ")) {
    if (buyuk.startsWith("HIZ ")) {
      Serial.println(F("BILGI: komut artik ACI (derece), HIZ degil"));
    }
    int derece = komut.substring(komut.indexOf(' ') + 1).toInt();
    if (derece < 0 || derece > 180) { Serial.println(F("HATA: ACI 0-180")); return; }
    aciyaSur(derece);
    return;
  }

  if (buyuk.startsWith("ROLE ")) {
    // "ROLE su_pompasi 1"
    int b1 = komut.indexOf(' ');
    int b2 = komut.indexOf(' ', b1 + 1);
    if (b2 < 0) { Serial.println(F("HATA: ROLE <ad> <0|1>")); return; }

    String ad = komut.substring(b1 + 1, b2);
    bool durum = komut.substring(b2 + 1).toInt() != 0;

    if (ad == "su_pompasi")        roleYaz(SU_POMPASI_PIN, durum);
    else if (ad == "hava_pompasi") roleYaz(HAVA_POMPASI_PIN, durum);
    else { Serial.println(F("HATA: ad su_pompasi ya da hava_pompasi olmali")); return; }

    Serial.print(F("KOMUT: "));
    Serial.print(ad);
    Serial.println(durum ? F(" ACIK") : F(" KAPALI"));
    sonOlcum = 0;
    return;
  }

  if (buyuk.startsWith("UC ")) {
    // "UC 1 90 900" — indeks, derece, hareket süresi (ms).
    int b1 = komut.indexOf(' ');
    int b2 = komut.indexOf(' ', b1 + 1);
    int b3 = b2 < 0 ? -1 : komut.indexOf(' ', b2 + 1);
    if (b2 < 0 || b3 < 0) {
      Serial.println(F("HATA: UC <indeks> <derece> <sure_ms>"));
      return;
    }
    int indeks  = komut.substring(b1 + 1, b2).toInt();
    int derece  = komut.substring(b2 + 1, b3).toInt();
    long sureMs = komut.substring(b3 + 1).toInt();
    /* SINIRLAR BURADA DA DENETLENİYOR: kart seri porta elle yazılan bir
     * komutu da alıyor ve servoyu mekanik sınırının dışına sürmek dişliyi
     * zorlar. */
    if (indeks < 0 || indeks > 2) { Serial.println(F("HATA: UC indeksi 0-2")); return; }
    if (derece < 0 || derece > 180) { Serial.println(F("HATA: UC derecesi 0-180")); return; }
    if (sureMs <= 0 || sureMs > 10000) {
      Serial.println(F("HATA: UC sure_ms 1-10000"));
      return;
    }
    ucKomut(indeks, derece, sureMs);
    Serial.print(F("KOMUT: uc "));
    Serial.print(indeks);
    Serial.print(F(" -> "));
    Serial.print(derece);
    Serial.println(F(" derece (gidiyor)"));
    sonOlcum = 0;
    return;
  }

  Serial.println(F("HATA: bilinmeyen komut"));
}

void seriOku() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (girisTamponu.length()) { komutIsle(girisTamponu); girisTamponu = ""; }
    } else if (girisTamponu.length() < 40) {
      girisTamponu += c;
    }
  }
}

// --------------------------------------------------------------- ÖLÇÜM ----
/* JSON'da sayı yerine null basmak gerekebiliyor: sensör okumadıysa 0
 * yazmak "ölçtüm, sıfır çıktı" demek olurdu ve grafikte gerçek bir
 * uçurum gibi görünürdü. */
void sayiYaz(float d) {
  if (isnan(d)) Serial.print(F("null"));
  else Serial.print(d, 1);
}

void olcVeYaz() {
  float nem      = dht->readHumidity();
  float sicaklik = dht->readTemperature();

  float bmpSicaklik = NAN, basinc = NAN, rakim = NAN;
  if (bmpVar) {
    bmpSicaklik = bmp.readTemperature();
    basinc      = bmp.readPressure() / 100.0;
    rakim       = bmp.readAltitude();
  }

  Serial.print(F("VERI:{\"hava_sicaklik\":"));   sayiYaz(sicaklik);
  Serial.print(F(",\"hava_nem\":"));             sayiYaz(nem);
  Serial.print(F(",\"bmp_sicaklik\":"));         sayiYaz(bmpSicaklik);
  Serial.print(F(",\"basinc\":"));               sayiYaz(basinc);
  Serial.print(F(",\"rakim\":"));                sayiYaz(rakim);
  /* Hangi DHT bulundu — ajan makul aralığı buna göre seçiyor. */
  Serial.print(F(",\"dht\":\""));                Serial.print(dhtAdi);
  Serial.print(F("\",\"toprak_nem\":"));         Serial.print(analogRead(TOPRAK_PIN));
  Serial.print(F(",\"r_su_pompasi\":"));         Serial.print(suPompasiAcik ? 1 : 0);
  Serial.print(F(",\"r_hava_pompasi\":"));       Serial.print(havaPompasiAcik ? 1 : 0);
  /* UÇ SEÇİCİ — KOMUT EDİLEN DEĞER, ÖLÇÜM DEĞİL. Hiç komut verilmediyse
   * ikisi de null gidiyor: sıfır yazmak "0 numaralı uç seçili" demek
   * olurdu ve bu, bilinmeyeni bilinen gibi göstermenin ta kendisi. */
  Serial.print(F(",\"uc_secili\":"));
  if (ucSecili < 0) Serial.print(F("null")); else Serial.print(ucSecili);
  Serial.print(F(",\"uc_aci\":"));
  if (ucAci < 0) Serial.print(F("null")); else Serial.print(ucAci);
  // 1 = komut verildi ama hareket süresi dolmadı; horn hâlâ yolda.
  Serial.print(F(",\"uc_hareket\":"));           Serial.print(ucHarekette ? 1 : 0);
  /* SERVO DENEMESİ AÇIK MI. Panelde düğme bunu okuyor: düğmenin kendi
   * hafızasına güvenmek, kart sıfırlandığında (pompa çekişinde oluyor)
   * panelin "çalışıyor" demeye devam etmesi demekti. Doğruyu kart
   * söylüyor. */
  Serial.print(F(",\"servo_test\":"));           Serial.print(testAcik ? 1 : 0);
  /* Kartın açık kaldığı süre. Geriye giderse kart yeniden başlamıştır ve
   * röleler kapanmıştır — pompa çekişinde besleme çökerse tam bunu
   * görüyoruz. */
  Serial.print(F(",\"calisma_sn\":"));           Serial.print(millis() / 1000UL);
  Serial.println(F("}"));
}

// --------------------------------------------------------------- DÖNGÜ ----
void loop() {
  seriOku();
  ucGozet();
  /* DENEME AÇIKSA KULLANICININ TURU ÇALIŞIR. Bir tur ~5,8 sn sürüyor ve
   * `delay` içerdiği için o sürede `seriOku` ile ölçüm çalışmıyor; tur
   * bitince sıra onlara geliyor. Deneme kapalıyken maliyeti bir
   * karşılaştırma. */
  if (testAcik) {
    /* İMZALAR KULLANICININ BLOĞUNUN DIŞINDA: satırlar `testDongusu`nun
     * İÇİNE değil, ÇAĞRISININ iki yanına yazılıyor. Kullanıcının kodu
     * harfi harfine duruyor, turun zamanlaması değişmiyor (iki satır,
     * 9600 baud'da ~70 ms, hem de süpürmenin dışında).
     *
     * ÇIKTININ OKUNUŞU:
     *   "basliyor" var, "bitti" yok, ardından açılış banner'ı
     *       -> kart tur ORTASINDA SIFIRLANDI: besleme çöküyor.
     *   "basliyor" ve "bitti" var, arada ~5800 ms
     *       -> döngü sonuna kadar çalıştı, kart darbeyi üretiyor.
     *          Horn buna rağmen kımıldamıyorsa arıza kartın ÇIKIŞINDAN
     *          sonrasında: D12 hattı, GND ortaklığı, servo.
     *   hiç "TUR:" yok
     *       -> `testAcik` kurulmadı; komut karta ulaşmamış demektir. */
    turNo++;
    turYaz("basliyor");
    testDongusu();
    turYaz("bitti");
  }
  if (millis() - sonOlcum >= OLCUM_ARALIGI_MS) {
    sonOlcum = millis();
    olcVeYaz();
  }
}