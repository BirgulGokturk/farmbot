/*
 * FarmBot — sensör okuma ve röle kontrolü
 * ---------------------------------------
 * Arduino Uno. Yaptığı iki şey var:
 *   1. Sensörleri okuyup 2 saniyede bir tek satır JSON basmak.
 *   2. Pi'den gelen ROLE komutuyla iki röleyi açıp kapatmak.
 *
 * Başka bir şey yapmıyor. Karar vermiyor, eşik tutmuyor, hiçbir şeyi
 * hatırlamıyor. Sulama kararı Pi'de; kart yalnızca dediğini yapıyor ve
 * ne yaptığını geri söylüyor.
 *
 * TESİSAT
 *   D2   DHT11 veri
 *   D7   su pompası rölesi
 *   D8   hava pompası rölesi
 *   A1   toprak nemi probu — iki uçlu, tool ucuna takılı, toprağa daldırılır
 *   A4/A5 GY-68 / BMP180 (I2C)
 *
 * Pi'ye giden satır:  VERI:{...}
 * Pi'den gelen komut: ROLE <su_pompasi|hava_pompasi> <0|1>
 *                     KAPAT        — ikisini birden kapat
 *                     OKU          — beklemeden hemen ölç
 */

#include <Wire.h>
#include <Adafruit_BMP085.h>
#include <DHT.h>

// --------------------------------------------------------------- AYARLAR --
#define DHT_PIN        2
#define SU_POMPASI_PIN 7
#define HAVA_POMPASI_PIN 8
/* Tek toprak sensörü var ve tool ucunda: makine nereye giderse ölçüm
 * oradan geliyor. Eskiden yatağa sabit ikinci bir sensör varsayılıyordu
 * (A0); yok. Boş bir pini okumak, panelde gerçek veri gibi görünen
 * anlamsız sayı üretmek demekti.
 *
 * Ölçek: kuru toprakta değer YÜKSEK, ıslakta düşük. Yüzdeye çevirmek
 * panelin işi, ham değer olduğu gibi gidiyor. */
#define TOPRAK_PIN     A1

/* SAHADA ÖLÇÜLDÜ: bu kart AKTİF-HIGH. Yani pine HIGH verince röle çekiyor.
 * Röle kartlarının çoğu tersi olduğu için burası 1 yazıyordu ve sistem
 * baştan sona ters çalışıyordu: "aç" deyince kapanıyor, "kapalı" derken
 * röle çekili kalıyordu.
 *
 * Yan etkisi daha kötüydü: 1 iken kapalı seviye HIGH demekti, yani kart
 * her açılışta iki röleyi de ÇEKİYORDU. Pompanın kalkış akımı beslemeyi
 * cökertince kart sıfırlanıyor, sıfırlanınca yine çekiyordu — pompaların
 * "aç kapa yapıp durması" buydu.
 *
 * Kart değişirse: LOW'da çekiyorsa 1 yapın. */
#define ROLE_AKTIF_LOW 0

#define OLCUM_ARALIGI_MS 2000

// --------------------------------------------------------------- DURUM ----
DHT dht(DHT_PIN, DHT11);
Adafruit_BMP085 bmp;
bool bmpVar = false;

// Rölelerin gerçek durumu. Panel bunu tahmin etmiyor, kart söylüyor.
bool suPompasiAcik = false;
bool havaPompasiAcik = false;

unsigned long sonOlcum = 0;
String girisTamponu = "";

// --------------------------------------------------------------- RÖLE -----
/* Pine kapalı seviyeyi YAZIP sonra OUTPUT yapıyoruz. pinMode bir pini
 * çıkışa alırken LOW'dan başlatıyor; aktif-LOW bir kartta ters sıra her
 * açılışta pompaya kısa bir darbe demek olurdu. Bu kart aktif-HIGH, yani
 * şu an kapalı seviye zaten LOW — ama kart değişirse bu sıra doğru
 * kalsın diye böyle duruyor. */
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

// --------------------------------------------------------------- KURULUM --
void setup() {
  /* İLK İŞ BU. Serial.begin bile sonra geliyor: sıfırlamadan bu satıra
   * kadar geçen her milisaniyede pinler GİRİŞ ve boşta duruyor, aktif-LOW
   * röle kartında boşta giriş "röle çeksin" demek.
   *
   * Ama bu, sorunu tamamen çözmüyor ve çözemez: Uno'nun önyükleyicisi
   * setup'tan ÖNCE ~1-2 saniye bekliyor ve o sürede hiçbir komut
   * çalışmıyor. Yani kart her sıfırlandığında pompa bir-iki saniye
   * çalışıyor. Bunun tek gerçek çözümü donanımda: her röle girişinden
   * 5V'a 10K direnç (pin boştayken girişi YÜKSEK, yani röleyi kapalı
   * tutar). Pompanın çekişi kartı sıfırlıyorsa bu kendini besleyen bir
   * döngüye dönüşüyor — röle kartını ve pompaları Arduino'nun 5V'undan
   * değil ayrı bir kaynaktan besleyin. */
  roleHazirla(SU_POMPASI_PIN);
  roleHazirla(HAVA_POMPASI_PIN);
  roleYaz(SU_POMPASI_PIN, false);
  roleYaz(HAVA_POMPASI_PIN, false);

  Serial.begin(9600);
  dht.begin();
  bmpVar = bmp.begin();
  if (!bmpVar) Serial.println("UYARI: BMP180 bulunamadi, digerleriyle devam");

  Serial.println("Hazir. Komutlar: ROLE <ad> <0|1> | KAPAT | OKU");
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
    Serial.println("KOMUT: hepsi kapatildi");
    sonOlcum = 0;                 // yeni durum hemen bildirilsin
    return;
  }

  if (buyuk == "OKU") { sonOlcum = 0; return; }

  if (buyuk.startsWith("ROLE ")) {
    // "ROLE su_pompasi 1"
    int b1 = komut.indexOf(' ');
    int b2 = komut.indexOf(' ', b1 + 1);
    if (b2 < 0) { Serial.println("HATA: ROLE <ad> <0|1>"); return; }

    String ad = komut.substring(b1 + 1, b2);
    bool durum = komut.substring(b2 + 1).toInt() != 0;

    if (ad == "su_pompasi")        roleYaz(SU_POMPASI_PIN, durum);
    else if (ad == "hava_pompasi") roleYaz(HAVA_POMPASI_PIN, durum);
    else { Serial.println("HATA: ad su_pompasi ya da hava_pompasi olmali"); return; }

    Serial.print("KOMUT: ");
    Serial.print(ad);
    Serial.println(durum ? " ACIK" : " KAPALI");
    // Panelin düğmeyi beklemeden güncelleyebilmesi için hemen bildir.
    sonOlcum = 0;
    return;
  }

  Serial.println("HATA: bilinmeyen komut");
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
  if (isnan(d)) Serial.print("null");
  else Serial.print(d, 1);
}

void olcVeYaz() {
  float nem      = dht.readHumidity();
  float sicaklik = dht.readTemperature();

  float bmpSicaklik = NAN, basinc = NAN, rakim = NAN;
  if (bmpVar) {
    bmpSicaklik = bmp.readTemperature();
    basinc      = bmp.readPressure() / 100.0;
    rakim       = bmp.readAltitude();
  }

  Serial.print("VERI:{\"hava_sicaklik\":");   sayiYaz(sicaklik);
  Serial.print(",\"hava_nem\":");             sayiYaz(nem);
  Serial.print(",\"bmp_sicaklik\":");         sayiYaz(bmpSicaklik);
  Serial.print(",\"basinc\":");               sayiYaz(basinc);
  Serial.print(",\"rakim\":");                sayiYaz(rakim);
  Serial.print(",\"toprak_nem\":");           Serial.print(analogRead(TOPRAK_PIN));
  Serial.print(",\"r_su_pompasi\":");         Serial.print(suPompasiAcik ? 1 : 0);
  Serial.print(",\"r_hava_pompasi\":");       Serial.print(havaPompasiAcik ? 1 : 0);
  /* Kartın açık kaldığı süre. Geriye giderse kart yeniden başlamıştır ve
   * röleler kapanmıştır — pompa çekişinde besleme çökerse tam bunu
   * görüyoruz. Panel sebebi adıyla söyleyebilsin diye gönderiliyor. */
  Serial.print(",\"calisma_sn\":");           Serial.print(millis() / 1000UL);
  Serial.println("}");
}

// --------------------------------------------------------------- DÖNGÜ ----
void loop() {
  seriOku();
  if (millis() - sonOlcum >= OLCUM_ARALIGI_MS) {
    sonOlcum = millis();
    olcVeYaz();
  }
}
