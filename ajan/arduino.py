"""Arduino köprüsü — USB seri port üzerinden sensör okuma ve komut yazma.

Arduino iki tür satır basıyor: insan için Türkçe durum satırları ve köprü
için `VERI:{...}` önekli JSON satırı. Burada yalnızca `VERI:` satırı
okunuyor; diğerleri günlüğe düşüyor. Böylece Arduino IDE'nin Seri
Monitör'ünden sistemi izlemeye devam edebilirsiniz.
"""

from __future__ import annotations

import glob
import json
import logging
import os
import math
import random
import statistics
import threading
import time
from typing import Any, Callable

import tani

logger = logging.getLogger("ajan.arduino")

ONEK = "VERI:"
# Port açıldıktan sonra bu kadar süre VERI satırı gelmezse sketch eski ya da
# baud hızı tutmuyor demektir; sessizce beklemek yerine söylüyoruz.
VERI_BEKLEME_SN = 15.0

# --------------------------------------------------------------------------- #
# Ölçüm düzeltme
# --------------------------------------------------------------------------- #
class Duzeltici:
    """Ham sensör okumasını panele ve veritabanına girecek hâle getirir.

    NEREDE YAPILIYOR: AJANDA — bilerek. Üç seçenek vardı:

      * Panelde: her istemci kendi hesabını yapar, iki tarayıcı aynı anda
        başka sayı gösterebilir ve tabloyu CSV olarak indiren yine ham
        veriyi alır.
      * Sunucuda: veritabanına kirli veri girer; düzeltme kuralı sonradan
        değişince GEÇMİŞ düzelmez, çünkü kaydedilen şey zaten kirliydi.
      * Ajanda: veriyi üreten yere en yakın nokta. Veritabanına baştan
        temiz veri giriyor, geçmiş de doğru oluyor.

    Üç iş, bu sırayla:

      1. SAÇMA OKUMAYI AT. Arızalı bir sensör susmuyor, saçmalıyor.
         DHT11 kütüphanesi okuyamadığında sık sık 0 ya da 255 basıyor;
         bunlar ölçüm değil, arıza deseni. Kaydedilirse grafikte uçurum,
         tabloda yalan, ortalamada bozulma oluyor.
      2. ÇÖZÜNÜRLÜĞE YUVARLA. DHT11 tam sayı üretiyor; panelde 26,3 °C
         yazmak sensörün yapmadığı bir hassasiyeti uydurmak. Her kanal
         kendi veri sayfasındaki adıma yuvarlanıyor.
      3. MEDYAN. Son N örneğin ORTANCASI gösteriliyor. Ortalama değil:
         tek bir sıçrama ortalamayı da yukarı çekiyor, medyan onu hiç
         görmüyor. Pencere TEK sayı tutuluyor ki ortanca iki değerin
         ortalaması olmasın — o da olmayan bir ara değer uydurmak olurdu.

    HAM DEĞER ATILMIYOR: `ham` alanında pakete iliştiriliyor, panel kartın
    altındaki küçük yazıda gösteriyor. "Sensör gerçekte ne dedi" sorusunun
    cevabı duruyor; sadece grafiğin ve geçmişin kaynağı olmaktan çıkıyor.
    """

    #: Kanal -> yuvarlama adımı. Kaynak: sensör veri sayfaları.
    #: DHT11 sıcaklık/nem 1 birim (tam sayı basıyor); DHT22 takılıysa
    #: aşağıdaki DHT22_ADIM devreye giriyor.
    #: BMP180: sıcaklık 0,1 °C; basınç gürültü tabanı ~0,06 hPa, 0,1 hPa
    #: bunun hemen üstü. Rakım basınçtan türetiliyor, metre altı anlamsız.
    #: HW-103: 10 bitlik ADC, birim = sayım.
    ADIM = {
        "hava_sicaklik": 1.0,
        "hava_nem": 1.0,
        "bmp_sicaklik": 0.1,
        "basinc": 0.1,
        "rakim": 1.0,
        "toprak_nem": 1.0,
        # Uçtaki prob: 10 bitlik ADC, birim = sayım.
        "uc_toprak": 1.0,
    }
    DHT22_ADIM = {"hava_sicaklik": 0.1, "hava_nem": 0.1}

    #: Medyan UYGULANMAYAN kanallar. Şu an yok: kartın bildirdiği her
    #: kanal gerçek bir ölçüm ve gürültü taşıyor. Rölelerin durumu bu
    #: tablodan hiç geçmiyor — o ölçüm değil, kesin durum.
    MEDYANSIZ: set[str] = set()

    #: DHT11 veri sayfası çalışma aralığı. Bunun dışı ölçüm değil arıza.
    DHT11_ARALIK = {"hava_sicaklik": (0.0, 50.0), "hava_nem": (20.0, 90.0)}
    DHT22_ARALIK = {"hava_sicaklik": (-40.0, 80.0), "hava_nem": (0.0, 100.0)}

    #: Bu kadar saniye veri gelmezse pencere sıfırlanıyor: aradan yarım
    #: saat geçmişse eski örneklerin bugünkü ölçümle ilgisi yok.
    KOPUKLUK_SN = 60.0

    def __init__(self, pencere: int = 5):
        pencere = max(1, int(pencere))
        if pencere % 2 == 0:
            pencere += 1                      # tek sayı: ortanca gerçek bir örnek
        self.pencere = pencere
        self._gecmis: dict[str, list[float]] = {}
        self._son_zaman = 0.0
        self._atilan: dict[str, int] = {}

    # -- yardımcılar ------------------------------------------------------
    @staticmethod
    def _yuvarla(deger: float, adim: float) -> float:
        n = round(deger / adim) * adim
        # Kayan nokta çöpünü temizle: 0.1 adımda 26.400000000000002 çıkıyor.
        return round(n, 6)

    def _at(self, kanal: str, sebep: str, deger: Any) -> None:
        adet = self._atilan.get(kanal, 0) + 1
        self._atilan[kanal] = adet
        # Her okumada log basmak seri portu boğuyor; ilk seferi ve sonra
        # her 50'de biri yeter — sorunun sürdüğü yine görünüyor.
        if adet == 1 or adet % 50 == 0:
            logger.warning("%s okuması atıldı (%s): %s — toplam %d",
                           kanal, sebep, deger, adet)

    def _dht_temizle(self, veri: dict[str, Any]) -> None:
        """DHT11/DHT22'nin bilinen arıza desenlerini eler."""
        dht22 = str(veri.get("dht") or "").upper().startswith("DHT22")
        aralik = self.DHT22_ARALIK if dht22 else self.DHT11_ARALIK

        s, n = veri.get("hava_sicaklik"), veri.get("hava_nem")
        # Çerçevenin tamamı sıfır: kütüphane okuyamadı, tamponu sıfırladı.
        # Tek başına 0 °C gerçek olabilir, 0 °C VE %0 nem olamaz.
        if s is not None and n is not None and float(s) == 0.0 and float(n) == 0.0:
            self._at("dht", "0 °C ve %0 birlikte — okunamamış çerçeve", "0/0")
            veri["hava_sicaklik"] = veri["hava_nem"] = None
            return
        for ad in ("hava_sicaklik", "hava_nem"):
            deger = veri.get(ad)
            if deger is None:
                continue
            sayi = float(deger)
            # 255 = 0xFF; tek baytlık iletişim arızasının imzası.
            if sayi == 255.0:
                self._at(ad, "255 (0xFF) — iletişim arızası", sayi)
                veri[ad] = None
                continue
            alt, ust = aralik[ad]
            if not (alt <= sayi <= ust):
                self._at(ad, f"veri sayfası aralığı dışı ({alt}..{ust})", sayi)
                veri[ad] = None

    # -- ana giriş --------------------------------------------------------
    def isle(self, veri: dict[str, Any], simdi: float | None = None,
             ham_kaynak: dict[str, Any] | None = None) -> dict[str, Any]:
        """Ham paketi düzeltilmiş paketle değiştirir; `ham` alanını ekler.

        `ham_kaynak`: sensörden ÇIKTIĞI hâliyle paket. Verilmezse `veri`
        kullanılıyor — ama çağıran (bkz. Arduino._veri_isle) bunu
        veriyor, çünkü `_makul_suz` aralık dışı okumayı zaten `None`
        yapmış oluyor ve kartta gösterilecek "sensör gerçekte ne dedi"
        değeri o noktada kaybolmuş olurdu.
        """
        simdi = time.time() if simdi is None else simdi
        if self._son_zaman and simdi - self._son_zaman > self.KOPUKLUK_SN:
            self._gecmis.clear()
        self._son_zaman = simdi

        dht22 = str(veri.get("dht") or "").upper().startswith("DHT22")
        kaynak = veri if ham_kaynak is None else ham_kaynak
        ham: dict[str, Any] = {}
        for ad in self.ADIM:
            if kaynak.get(ad) is not None:
                ham[ad] = kaynak[ad]

        self._dht_temizle(veri)

        for ad, temel_adim in self.ADIM.items():
            deger = veri.get(ad)
            if deger is None:
                # Okuma yoksa pencereye BOŞLUK yazmıyoruz; bir sonraki
                # gerçek okuma eski örneklerle karşılaştırılabilsin.
                continue
            try:
                sayi = float(deger)
            except (TypeError, ValueError):
                veri[ad] = None
                continue
            adim = (self.DHT22_ADIM.get(ad, temel_adim) if dht22 else temel_adim)
            sayi = self._yuvarla(sayi, adim)
            if ad in self.MEDYANSIZ:
                veri[ad] = sayi
                continue
            kuyruk = self._gecmis.setdefault(ad, [])
            kuyruk.append(sayi)
            if len(kuyruk) > self.pencere:
                del kuyruk[0]
            veri[ad] = self._yuvarla(statistics.median(kuyruk), adim)

        veri["ham"] = ham
        return veri

    @property
    def bos_mu_sayaci(self) -> dict[str, int]:
        """Kanal başına atılan okuma sayısı — tanı ekranı için."""
        return dict(self._atilan)


def olcum_bos_mu(veri: dict[str, Any]) -> bool:
    """Pakette tek bir gerçek sensör okuması bile kalmadı mı?

    Kaldıysa satır kaydedilmeli: bir kanalın arızalı olması ötekini
    değersiz yapmıyor. Hiçbiri kalmadıysa satırı hiç yazmıyoruz — boş
    satırlar grafikte "veri var ama hepsi boş" gibi görünüp geçmişi
    şişiriyor.
    """
    return all(veri.get(ad) is None for ad in Duzeltici.ADIM)


class Arduino:
    """Seri portu kendi iş parçacığında okur, kopunca kendi kendine döner."""

    def __init__(self, port: str, baud: int = 9600,
                 geri_cagir: Callable[[dict[str, Any]], None] | None = None,
                 medyan_pencere: int = 5):
        # Eyleme dönük arıza tanısı — panel bunu gösteriyor. None = sorun yok.
        self.tani: dict[str, Any] | None = None
        self._ilk_veri_bekleniyor = 0.0
        self.port = port
        self.baud = baud
        self.geri_cagir = geri_cagir
        self._seri = None
        self._calisiyor = False
        self._is_parcacigi: threading.Thread | None = None
        self._yazma_kilidi = threading.Lock()
        self._makul_uyarildi: set[str] = set()
        self.son_veri: dict[str, Any] = {}
        self.son_veri_zamani: float = 0.0
        # Yuvarlama + medyan burada, yani veri üretildiği yerin hemen
        # yanında. Veritabanına ve panele giden şey artık temizlenmiş veri.
        self.duzeltici = Duzeltici(medyan_pencere)

    @property
    def bagli(self) -> bool:
        return self._seri is not None and getattr(self._seri, "is_open", False)

    def baslat(self) -> None:
        self._calisiyor = True
        self._is_parcacigi = threading.Thread(target=self._dongu, name="arduino", daemon=True)
        self._is_parcacigi.start()

    def durdur(self) -> None:
        self._calisiyor = False
        if self._seri is not None:
            try:
                self._seri.close()
            except Exception:
                pass

    def _ac(self) -> None:
        import serial  # pyserial

        self._seri = serial.Serial(self.port, self.baud, timeout=2)
        # Arduino, seri port açıldığında kendini sıfırlar (DTR). İlk saniyede
        # gelen satırlar yarım olur; bu yüzden bekleyip tamponu boşaltıyoruz.
        time.sleep(2.0)
        self._seri.reset_input_buffer()
        self.tani = None                  # açıldı — varsa eski tanı düşsün
        self._ilk_veri_bekleniyor = time.time()
        self._hata_sayaci = 0        # acildi, sayac sifirlansin
        logger.info("Arduino açıldı: %s @ %d", self.port, self.baud)

    def _acilamadi(self, hata: Exception) -> None:
        """Port neden açılamadı — eyleme dönük tanıyı buradan alıyoruz.

        Üç ayrı durum, üç ayrı iş listesi: port hiç yok, port var ama izin
        yok, port açıldı ama VERI satırı gelmiyor. Hepsini "seri port hatası"
        diye tek satıra toplamak, kabloyu boşuna kontrol ettiriyor.
        """
        metin = str(hata)
        varmi = os.path.exists(self.port)
        if not varmi and not glob.glob("/dev/ttyUSB*") and not glob.glob("/dev/ttyACM*"):
            self.tani = tani.arduino_port_yok(metin)
        elif "ermission" in metin or (varmi and not os.access(self.port, os.R_OK | os.W_OK)):
            self.tani = tani.arduino_izin_yok(self.port, metin)
        else:
            self.tani = tani.arduino_port_yok(metin)

    def _dongu(self) -> None:
        while self._calisiyor:
            try:
                if not self.bagli:
                    self._ac()
                ham = self._seri.readline()
                if not ham:
                    continue
                satir = ham.decode("utf-8", errors="replace").strip()
                if not satir:
                    continue
                if satir.startswith(ONEK):
                    self._ilk_veri_bekleniyor = 0.0
                    self.tani = None      # veri akıyor — arıza yok
                    self._veri_isle(satir[len(ONEK):])
                else:
                    logger.debug("Arduino: %s", satir)
                # Port açık ama uzun süredir VERI satırı yoksa sketch eski ya
                # da baud hızı tutmuyor; bunu da söylemek gerekiyor.
                if (self._ilk_veri_bekleniyor and self.tani is None
                        and time.time() - self._ilk_veri_bekleniyor > VERI_BEKLEME_SN):
                    self.tani = tani.arduino_veri_yok(self.port, self.baud)
            except Exception as hata:
                # Arduino takili degilse bu hata her 3 saniyede bir tekrarlar.
                # Her seferinde uyari yazmak gunlugu doldurup ise yarar
                # satirlari goremez hale getiriyordu: ilkini yaz, sonra
                # seyrelt (yaklasik dakikada bir).
                self._hata_sayaci = getattr(self, "_hata_sayaci", 0) + 1
                if self._hata_sayaci == 1 or self._hata_sayaci % 20 == 0:
                    logger.warning(
                        "Seri port hatası (%s), 3 sn sonra yeniden denenecek "
                        "(%d. deneme)", hata, self._hata_sayaci)
                self._acilamadi(hata)
                try:
                    if self._seri is not None:
                        self._seri.close()
                except Exception:
                    pass
                self._seri = None
                time.sleep(3.0)

    def _makul_suz(self, veri: dict[str, Any]) -> dict[str, Any]:
        """Fiziken imkânsız okumaları `null`a çevirir ve sebebini bir kez loglar.

        Neden gerekli: arızalı bir sensör çoğu zaman susmuyor, saçmalıyor.
        Sahada BMP180 -59 °C ve 1810 hPa bildirdi; bu değerler grafiğe
        çizilince eksen eziliyor, tabloya girince ortalama bozuluyor ve en
        kötüsü "veri var" izlenimi veriyor. Sensörün kendi veri sayfasındaki
        çalışma aralığının dışına çıkan bir okuma, ölçüm değil arıza
        belirtisidir; kaydetmek yerine kanalı boş bırakıp uyarıyoruz.

        Sınırlar sensörlerin veri sayfasından: BMP180 -40..85 °C / 300..1100
        hPa, DHT11 0..50 °C / 20..90 %RH (DHT22 daha geniş olduğu için onun
        aralığı alındı), HW-103 10 bitlik ADC.
        """
        SINIR = {
            "hava_sicaklik": (-40.0, 85.0, "°C"),
            "bmp_sicaklik": (-40.0, 85.0, "°C"),
            "hava_nem": (0.0, 100.0, "%"),
            "basinc": (300.0, 1100.0, "hPa"),
            "rakim": (-500.0, 9000.0, "m"),
            "toprak_nem": (0.0, 1023.0, ""),
            "uc_toprak": (0.0, 1023.0, ""),
        }
        for ad, (alt, ust, birim) in SINIR.items():
            deger = veri.get(ad)
            if deger is None:
                continue
            try:
                sayi = float(deger)
            except (TypeError, ValueError):
                veri[ad] = None
                continue
            if sayi != sayi or not (alt <= sayi <= ust):     # NaN ya da aralık dışı
                veri[ad] = None
                if ad not in self._makul_uyarildi:
                    self._makul_uyarildi.add(ad)
                    logger.warning(
                        "%s makul olmayan değer bildiriyor: %s %s (beklenen %s..%s) — "
                        "bu kanal boş geçiliyor, sensörü/kabloyu kontrol edin",
                        ad, sayi, birim, alt, ust)
        return veri

    def _veri_isle(self, govde: str) -> None:
        try:
            veri = json.loads(govde)
        except json.JSONDecodeError:
            logger.warning("VERI satırı çözülemedi: %.120s", govde)
            return
        if not isinstance(veri, dict):
            return
        # İki katman, iki ayrı iş: `_makul_suz` sensörün FİZİKEN
        # üretemeyeceği değerleri (BMP180'in -59 °C bildirmesi gibi)
        # eliyor; `duzeltici` sensöre ÖZGÜ arıza desenlerini eleyip
        # çözünürlüğe yuvarlıyor ve medyan alıyor.
        ham_kaynak = dict(veri)          # süzülmeden önceki hâli
        veri = self._makul_suz(veri)
        veri = self.duzeltici.isle(veri, ham_kaynak=ham_kaynak)
        if olcum_bos_mu(veri):
            # Tek bir geçerli okuma kalmadı: satırı hiç üretmiyoruz.
            # Boş satır "veri var" izlenimi verip geçmişi şişiriyor.
            return
        self.son_veri = veri
        self.son_veri_zamani = time.time()
        if self.geri_cagir:
            try:
                self.geri_cagir(veri)
            except Exception:
                logger.exception("Ölçüm geri çağrısı hata verdi")

    def komut(self, metin: str) -> None:
        """Arduino'ya bir satır komut gönderir: ROLE <ad> <0|1> · KAPAT · OKU."""
        if not self.bagli:
            raise RuntimeError("Arduino bağlı değil")
        with self._yazma_kilidi:
            self._seri.write((metin.strip() + "\n").encode("ascii", errors="ignore"))
            self._seri.flush()
        logger.info("Arduino'ya gönderildi: %s", metin)


class SahteArduino(Arduino):
    """Sensör yokken paneli denemek için GERÇEKÇİ ham veri üretir.

    "Gerçekçi" burada "temiz" demek değil. Önceki sürüm sıcaklığı
    `round(x, 1)` ile basıyordu — yani sahte DHT11, gerçek DHT11'in
    yapamadığı bir hassasiyette ölçüyordu. Böyle bir taklit üzerinde
    yuvarlama/medyan gibi düzeltmeleri denemek imkânsız: düzeltilecek
    bir bozukluk yok ki.

    Şimdi taklit edilen şey ORTAM değil, SENSÖRÜN ORTAMI NASIL GÖRDÜĞÜ:

      * DHT11 tam sayı basıyor, ±2 °C doğrulukta, nemde daha da gürültülü.
      * DHT11 arada okuyamıyor; kütüphane 0/0 ya da 255 basıyor.
      * BMP180 0,1 °C ve 0,1 hPa çözünürlükte, küçük ama sürekli gürültülü —
        panelin basınç grafiğini hız trenine çeviren şey tam olarak bu.
      * HW-103 analog: kayan taban + belirgin gürültü.

    Rastgelelik TOHUMLU: aynı süre boyunca çalışan iki koşu aynı ham
    veriyi üretiyor. Düzeltmenin öncesi/sonrası ancak öyle karşılaştırılır.

    Temel basınç ~907 hPa: sahadaki kurulum ~1000 m rakımda ve panelde
    görülen değer bu. Deniz seviyesi değeri (1013) taklit edilirse
    grafikteki sorun sahadakiyle aynı yerde çıkmıyor.
    """

    #: Ortamın "gerçek" değerleri — hiçbir sensör bunları tam göremiyor.
    ORTAM = {"sicaklik": 22.0, "nem": 55.0, "basinc": 907.0}

    def __init__(self, geri_cagir=None, aralik: float = 2.0, medyan_pencere: int = 5):
        super().__init__(port="sahte", baud=0, geri_cagir=geri_cagir,
                         medyan_pencere=medyan_pencere)
        self.aralik = aralik
        # Kart iki röle tutuyor; sahte kip de aynısını taklit ediyor ki
        # panel gerçekte göreceğimiz hâliyle denenebilsin.
        self.roleler = {"su_pompasi": False, "hava_pompasi": False}
        self._baslangic = time.time()

    @property
    def bagli(self) -> bool:
        return True

    def baslat(self) -> None:
        self._calisiyor = True
        self._is_parcacigi = threading.Thread(target=self._sahte_dongu, name="arduino-sahte", daemon=True)
        self._is_parcacigi.start()
        logger.warning("SAHTE Arduino modu — üretilen veriler gerçek değildir")

    def durdur(self) -> None:
        self._calisiyor = False

    def _sahte_dongu(self) -> None:
        # Tohumlu üreteç: aynı adım sayısı aynı ham veriyi veriyor.
        rast = random.Random(20260826)
        adim = 0
        while self._calisiyor:
            t = time.time()
            adim += 1
            # Ortam yavaş değişiyor: 10 dakikalık bir kayıtta neredeyse sabit.
            # Değerlerin oynaması ortamdan değil SENSÖRDEN geliyor — zaten
            # düzeltilmek istenen şey de bu.
            gun_orani = (t % 86400) / 86400 * 2 * math.pi
            sicaklik = self.ORTAM["sicaklik"] + 6 * math.sin(gun_orani - 1.5)
            nem = self.ORTAM["nem"] - 12 * math.sin(gun_orani - 1.5)
            basinc = self.ORTAM["basinc"] + 0.8 * math.sin(t / 3600)
            toprak_gercek = 520 + 180 * math.sin(t / 900)

            # DHT11: TAM SAYI basıyor, ±2 °C doğruluk, nemde daha gürültülü.
            dht_s = int(round(sicaklik + rast.gauss(0, 0.9)))
            dht_n = int(round(nem + rast.gauss(0, 2.6)))
            # Arada okunamıyor. Sahada gördüğümüz iki desen: bütün çerçeve
            # sıfır, ya da tek alan 0xFF.
            p = rast.random()
            if p < 0.020:
                dht_s = dht_n = 0
            elif p < 0.032:
                dht_n = 255
            # BMP180: ince çözünürlük ama sürekli gürültü.
            bmp_s = round(sicaklik + 0.8 + rast.gauss(0, 0.14), 1)
            bmp_p = round(basinc + rast.gauss(0, 0.13), 2)
            # Rakım basınçtan türetiliyor, yani basıncın gürültüsünü büyüterek
            # taşıyor — gerçek BMP180'de de böyle.
            rakim = round(44330.0 * (1.0 - (bmp_p / 1013.25) ** 0.1903), 1)
            # HW-103: analog, kayan taban + belirgin gürültü.
            toprak = int(max(0, min(1023, toprak_gercek + rast.gauss(0, 13))))

            # Uçtaki prob yataktakinden biraz ayrı okusun ki iki kanalın
            # ayrı olduğu panelde görünsün.
            uc = int(max(0, min(1023, toprak + rast.gauss(0, 25))))
            self._veri_isle(
                json.dumps(
                    {
                        "hava_nem": dht_n,
                        "hava_sicaklik": dht_s,
                        "bmp_sicaklik": bmp_s,
                        "basinc": bmp_p,
                        "rakim": rakim,
                        "toprak_nem": toprak,
                        "uc_toprak": uc,
                        "dht": "DHT11",
                        "r_su_pompasi": 1 if self.roleler["su_pompasi"] else 0,
                        "r_hava_pompasi": 1 if self.roleler["hava_pompasi"] else 0,
                        "calisma_sn": int(time.time() - self._baslangic),
                    }
                )
            )
            time.sleep(self.aralik)

    def komut(self, metin: str) -> None:
        """Kartın anladığı komutlar: ROLE <ad> <0|1> · KAPAT · OKU."""
        metin = metin.strip()
        buyuk = metin.upper()
        if buyuk == "KAPAT":
            for ad in self.roleler:
                self.roleler[ad] = False
        elif buyuk == "OKU":
            pass
        elif buyuk.startswith("ROLE "):
            parca = metin.split()
            if len(parca) != 3:
                raise RuntimeError("ROLE <ad> <0|1>")
            ad = parca[1].lower()
            if ad not in self.roleler:
                raise RuntimeError(f"Bilinmeyen röle: {ad}")
            self.roleler[ad] = parca[2] != "0"
        else:
            raise RuntimeError(f"Bilinmeyen komut: {metin}")
        logger.info("Sahte Arduino komutu: %s", metin)
