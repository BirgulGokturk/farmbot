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
import threading
import time
from typing import Any, Callable

import tani

logger = logging.getLogger("ajan.arduino")

ONEK = "VERI:"
# Port açıldıktan sonra bu kadar süre VERI satırı gelmezse sketch eski ya da
# baud hızı tutmuyor demektir; sessizce beklemek yerine söylüyoruz.
VERI_BEKLEME_SN = 15.0


class Arduino:
    """Seri portu kendi iş parçacığında okur, kopunca kendi kendine döner."""

    def __init__(self, port: str, baud: int = 9600, geri_cagir: Callable[[dict[str, Any]], None] | None = None):
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
                logger.warning("Seri port hatası (%s), 3 sn sonra yeniden denenecek", hata)
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
            "servo_aci": (0.0, 180.0, "°"),
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
        veri = self._makul_suz(veri)
        self.son_veri = veri
        self.son_veri_zamani = time.time()
        if self.geri_cagir:
            try:
                self.geri_cagir(veri)
            except Exception:
                logger.exception("Ölçüm geri çağrısı hata verdi")

    def komut(self, metin: str) -> None:
        """Arduino'ya bir satır komut gönderir (AC, KAPA, SERVO 45, AUTO, OKU...)."""
        if not self.bagli:
            raise RuntimeError("Arduino bağlı değil")
        with self._yazma_kilidi:
            self._seri.write((metin.strip() + "\n").encode("ascii", errors="ignore"))
            self._seri.flush()
        logger.info("Arduino'ya gönderildi: %s", metin)


class SahteArduino(Arduino):
    """Sensör yokken paneli denemek için makul görünen veri üretir.

    Değerler rastgele değil: günün saatine bağlı bir sinüs eğrisi + küçük
    gürültü. Rastgele veri grafikte "bozuk sensör" gibi görünüyor ve
    arayüzün doğru çalışıp çalışmadığını anlamayı zorlaştırıyor.
    """

    def __init__(self, geri_cagir=None, aralik: float = 2.0):
        super().__init__(port="sahte", baud=0, geri_cagir=geri_cagir)
        self.aralik = aralik
        self.servo_aci = 0.0
        # Gerçek kartta bunlar EEPROM'da; burada bellekte taklit ediliyor ki
        # panelin otomatik sulama ekranı sahte kipte de denenebilsin.
        self.esik = 600
        # Sahadaki tesisat: şu an yalnızca üç sensör takılı, vana servosu ve
        # röleler bağlı değil. Sahte kip bunu taklit ediyor ki panel gerçekte
        # göreceğimiz hâliyle denenebilsin (firmware'deki SERVO_BAGLI /
        # ROLELER_BAGLI ile aynı anlam).
        self.servo_var = 0
        self.role_var = 0
        self.oto_cikis = "servo" if self.servo_var else "yok"
        self.kip = "oto"

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
        while self._calisiyor:
            t = time.time()
            gun_orani = (t % 86400) / 86400 * 2 * math.pi
            sicaklik = 22 + 6 * math.sin(gun_orani - 1.5) + random.uniform(-0.3, 0.3)
            nem = 55 - 12 * math.sin(gun_orani - 1.5) + random.uniform(-1.5, 1.5)
            toprak = 520 + 180 * math.sin(t / 900) + random.uniform(-15, 15)
            if self.kip == "oto" and self.oto_cikis == "servo" and self.servo_var:
                self.servo_aci = 90.0 if toprak < self.esik else 0.0
            self._veri_isle(
                json.dumps(
                    {
                        "hava_nem": round(nem, 1),
                        "hava_sicaklik": round(sicaklik, 1),
                        "bmp_sicaklik": round(sicaklik + 0.8, 1),
                        "basinc": round(1012 + 3 * math.sin(t / 3600), 2),
                        "rakim": round(120 + random.uniform(-2, 2), 1),
                        "toprak_nem": int(toprak),
                        "servo_aci": self.servo_aci if self.servo_var else None,
                        "dht": "DHT11",
                        "servo_var": self.servo_var,
                        "role_var": self.role_var,
                        "esik": self.esik,
                        "oto_cikis": self.oto_cikis,
                        "oto_acik": 1 if (self.oto_cikis != "yok" and toprak < self.esik) else 0,
                        "kip": self.kip,
                    }
                )
            )
            time.sleep(self.aralik)

    def komut(self, metin: str) -> None:
        metin = metin.strip().upper()
        if metin == "AC":
            self.servo_aci = 90.0
            self.kip = "manuel"
        elif metin == "KAPA":
            self.servo_aci = 0.0
            self.kip = "manuel"
        elif metin.startswith("SERVO"):
            try:
                self.servo_aci = float(metin.split()[1])
            except (IndexError, ValueError):
                raise RuntimeError("SERVO komutu bir açı bekliyor")
            self.kip = "manuel"
        elif metin == "AUTO":
            self.kip = "oto"
        elif metin == "MANUEL":
            self.kip = "manuel"
        elif metin.startswith("ESIK"):
            try:
                self.esik = max(0, min(1023, int(metin.split()[1])))
            except (IndexError, ValueError):
                raise RuntimeError("ESIK komutu bir sayı bekliyor")
        elif metin.startswith("OTOCIKIS"):
            try:
                ad = metin.split()[1].lower()
            except IndexError:
                raise RuntimeError("OTOCIKIS bir ad bekliyor")
            if ad not in ("yok", "servo", "su_vanasi", "su_pompasi"):
                raise RuntimeError(f"Bilinmeyen çıkış: {ad}")
            bagli = {"yok": True, "servo": bool(self.servo_var),
                     "su_vanasi": bool(self.role_var), "su_pompasi": bool(self.role_var)}
            if not bagli[ad]:
                raise RuntimeError(f"'{ad}' bağlı değil")
            self.oto_cikis = ad
        logger.info("Sahte Arduino komutu: %s", metin)
