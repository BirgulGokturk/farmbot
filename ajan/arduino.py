"""Arduino köprüsü — USB seri port üzerinden sensör okuma ve komut yazma.

Arduino iki tür satır basıyor: insan için Türkçe durum satırları ve köprü
için `VERI:{...}` önekli JSON satırı. Burada yalnızca `VERI:` satırı
okunuyor; diğerleri günlüğe düşüyor. Böylece Arduino IDE'nin Seri
Monitör'ünden sistemi izlemeye devam edebilirsiniz.
"""

from __future__ import annotations

import json
import logging
import math
import random
import threading
import time
from typing import Any, Callable

logger = logging.getLogger("ajan.arduino")

ONEK = "VERI:"


class Arduino:
    """Seri portu kendi iş parçacığında okur, kopunca kendi kendine döner."""

    def __init__(self, port: str, baud: int = 9600, geri_cagir: Callable[[dict[str, Any]], None] | None = None):
        self.port = port
        self.baud = baud
        self.geri_cagir = geri_cagir
        self._seri = None
        self._calisiyor = False
        self._is_parcacigi: threading.Thread | None = None
        self._yazma_kilidi = threading.Lock()
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
        logger.info("Arduino açıldı: %s @ %d", self.port, self.baud)

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
                    self._veri_isle(satir[len(ONEK):])
                else:
                    logger.debug("Arduino: %s", satir)
            except Exception as hata:
                logger.warning("Seri port hatası (%s), 3 sn sonra yeniden denenecek", hata)
                try:
                    if self._seri is not None:
                        self._seri.close()
                except Exception:
                    pass
                self._seri = None
                time.sleep(3.0)

    def _veri_isle(self, govde: str) -> None:
        try:
            veri = json.loads(govde)
        except json.JSONDecodeError:
            logger.warning("VERI satırı çözülemedi: %.120s", govde)
            return
        if not isinstance(veri, dict):
            return
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
            self._veri_isle(
                json.dumps(
                    {
                        "hava_nem": round(nem, 1),
                        "hava_sicaklik": round(sicaklik, 1),
                        "bmp_sicaklik": round(sicaklik + 0.8, 1),
                        "basinc": round(1012 + 3 * math.sin(t / 3600), 2),
                        "rakim": round(120 + random.uniform(-2, 2), 1),
                        "toprak_nem": int(toprak),
                        "servo_aci": self.servo_aci,
                        "kip": "oto",
                    }
                )
            )
            time.sleep(self.aralik)

    def komut(self, metin: str) -> None:
        metin = metin.strip().upper()
        if metin == "AC":
            self.servo_aci = 90.0
        elif metin == "KAPA":
            self.servo_aci = 0.0
        elif metin.startswith("SERVO"):
            try:
                self.servo_aci = float(metin.split()[1])
            except (IndexError, ValueError):
                raise RuntimeError("SERVO komutu bir açı bekliyor")
        logger.info("Sahte Arduino komutu: %s", metin)
