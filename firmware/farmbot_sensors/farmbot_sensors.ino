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
 *
 * RÖLE KONTAĞI: pompalar şu an NC ucunda ve bu bilerek böyle bırakıldı —
 * kutuplama aşağıda ona göre ayarlı. Bilinmesi gereken sonucu var:
 * bobin enerjisizken COM–NC kapalı olduğu için kart kapalıyken,
 * sıfırlandığında, USB çıktığında ve açılışta önyükleyicinin beklediği
 * 1-2 saniye boyunca POMPA ÇALIŞIR. Yazılım bu anlarda çalışmıyor, yani
 * engelleyemiyor. Makineyi başıboş bırakmayın; su hattını uzun süre
 * gözetimsiz açık tutacaksanız pompa kablosunu NO ucuna alın, sonra
 * aşağıdaki satırı 1 yapın.
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

/* 0 = "aç" dediğimizde pine HIGH gidiyor. Bu, kartın kutuplamasıyla değil
 * KONTAKLA ilgili bir seçim: pompalar NC ucunda olduğu için pompayı
 * çalıştırmak bobini BIRAKMAK demek, çekmek değil. Yukarıdaki nota bakın.
 *
 * Pompa kablosunu NO ucuna alırsanız burayı 1 yapın. */
#define ROLE_AKTIF_LOW 0

#define OLCUM_ARALIGI_MS 2000

// --------------------------------------------------------------- DURUM ----
/* DHT tipi ELLE SEÇİLMİYOR. Yanlış tip seçilince kütüphane sessizce NaN
 * döndürüyor: panelde sıcaklık ve nem kartları hiç görünmüyor ve sensör
 * bozuk sanılıyor. Açılışta ikisi de deneniyor, hangisi okuma veriyorsa o
 * kullanılıyor ve adı panele bildiriliyor. */
DHT dht11(DHT_PIN, DHT11);
DHT dht22(DHT_PIN, DHT22);
DHT *dht = &dht11;
const char *dhtAdi = "DHT11";
Adafruit_BMP085 bmp;
bool bmpVar = false;

// Rölelerin gerçek durumu. Panel bunu tahmin etmiyor, kart söylüyor.
bool suPompasiAcik = false;
bool havaPompasiAcik = false;

unsigned long sonOlcum = 0;
String girisTamponu = "";

// --------------------------------------------------------------- RÖLE -----
/* Pine kapalı seviyeyi YAZIP sonra OUTPUT yapıyoruz. Ters sırada pin bir
 * an LOW kalıyor ve aktif-LOW kartta röle çekiyor: her açılışta pompaya
 * kısa bir darbe demek. */
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

/** Hangi DHT takılı? Okuma verene karar veriyoruz.
 *
 * DHT11 önce deneniyor çünkü sahadaki kart o. İlk okuma kütüphane
 * ısınırken NaN dönebiliyor, o yüzden iki deneme yapılıyor. */
void dhtSec() {
  for (int tip = 0; tip < 2; tip++) {
    DHT *aday = tip == 0 ? &dht11 : &dht22;
    aday->begin();
    for (int deneme = 0; deneme < 2; deneme++) {
      delay(1200);                       // DHT iki okuma arası bekliyor
      if (!isnan(aday->readTemperature())) {
        dht = aday;
        dhtAdi = tip == 0 ? "DHT11" : "DHT22";
        Serial.print("BILGI: DHT tipi ");
        Serial.println(dhtAdi);
        return;
      }
    }
  }
  // İkisi de okumadı: sensör bağlı değil ya da bozuk. Sıcaklık/nem null
  // gidecek, geri kalan ölçümler çalışmaya devam edecek.
  dht = &dht11;
  dhtAdi = "yok";
  Serial.println("UYARI: DHT okumuyor — kabloyu ve D2'yi kontrol edin");
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
  dhtSec();
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
  float nem      = dht->readHumidity();
  float sicaklik = dht->readTemperature();

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
  /* Hangi DHT bulundu — ajan makul aralığı buna göre seçiyor (DHT11 ile
   * DHT22'nin çalışma aralıkları farklı) ve panel kartın altına yazıyor. */
  Serial.print(",\"dht\":\"");                 Serial.print(dhtAdi);
  Serial.print("\",\"toprak_nem\":");           Serial.print(analogRead(TOPRAK_PIN));
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
