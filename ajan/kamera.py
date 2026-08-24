"""Kamera — Pi'den periyodik kare.

Kare yakalama üç yoldan denenir, ilk çalışan kullanılır:

  1. **picamera2** — Raspberry Pi kamera modülü (şerit kablo). Bookworm'ün
     önerdiği kütüphane.
  2. **rpicam-still / libcamera-still / fswebcam** — komut satırı araçları.
     Bookworm'de `libcamera-still` yerini `rpicam-still`e bıraktı; ikisi de
     aranıyor. USB webcam ya da picamera2'nin kurulu olmadığı sistemler için.

     Not: `pi-kur.sh` sanal ortamı `--system-site-packages` olmadan kurarsa
     apt ile gelen `python3-picamera2` venv'in içinden GÖRÜNMEZ ve 1. yol
     sessizce elenir. Bu yüzden komut satırı yolu bir yedek değil, Pi kamera
     modülünde de fiilen ana yol olabiliyor — ve tek kare için işlem açmak
     30 saniyede bir için tamamen yeterli.
  3. **sahte** — donanım olmadan paneli denemek için üretilen kare.

Neden JPEG ve neden küçük: kare WebSocket üzerinden sunucuya gidiyor ve orada
saklanıyor. 1640x1232 ham bir kare 6 MB; 640 piksel genişliğinde JPEG ~40 KB.
Panelde bitki görmek için bu fazlasıyla yeterli, ağ ve disk ise rahat ediyor.

Kare aralığı bilerek uzun (varsayılan 30 sn): bu bir güvenlik kamerası değil,
"bitkiler nasıl" sorusunun cevabı.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Any, Callable

logger = logging.getLogger("ajan.kamera")

VARSAYILAN = {
    "aktif": False,
    "aralik_sn": 30.0,
    "genislik": 640,
    "kalite": 75,
    "sahte": False,
    "cihaz": "/dev/video0",     # fswebcam için
}


class Kamera:
    def __init__(self, ayar: dict[str, Any], gonder: Callable[[str, float], None],
                 gunluk_cb: Callable[[str, str], None] | None = None) -> None:
        self.ayar = {**VARSAYILAN, **(ayar or {})}
        self.gonder = gonder
        self.gunluk_cb = gunluk_cb or (lambda m, s="bilgi": None)
        self._calisiyor = False
        self._yontem: str | None = None
        self._picam = None
        self.son_hata: str | None = None

    # --- yakalama yolları ---
    def _picamera2_dene(self) -> bool:
        try:
            from picamera2 import Picamera2  # type: ignore
        except ImportError:
            return False
        try:
            self._picam = Picamera2()
            genislik = int(self.ayar["genislik"])
            yapilandirma = self._picam.create_still_configuration(
                main={"size": (genislik, int(genislik * 3 / 4))})
            self._picam.configure(yapilandirma)
            self._picam.start()
            time.sleep(2)   # otomatik pozlama otursun
            return True
        except Exception as hata:
            logger.warning("picamera2 açılamadı: %s", hata)
            self._picam = None
            return False

    def _picamera2_kare(self) -> bytes:
        tampon = io.BytesIO()
        self._picam.capture_file(tampon, format="jpeg")
        return tampon.getvalue()

    def _komut_kare(self) -> bytes:
        """libcamera-still ya da fswebcam ile tek kare."""
        genislik = int(self.ayar["genislik"])
        gecici = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        gecici.close()
        try:
            if self._yontem in ("rpicam", "libcamera"):
                arac = "rpicam-still" if self._yontem == "rpicam" else "libcamera-still"
                komut = [arac, "-n", "-t", "800", "--width", str(genislik),
                         "--height", str(int(genislik * 3 / 4)),
                         "-q", str(int(self.ayar["kalite"])), "-o", gecici.name]
            else:
                komut = ["fswebcam", "-d", str(self.ayar["cihaz"]), "-r",
                         f"{genislik}x{int(genislik * 3 / 4)}", "--no-banner",
                         "-q", gecici.name]
            try:
                subprocess.run(komut, check=True, capture_output=True, timeout=20)
            except subprocess.CalledProcessError as hata:
                # Kameranın neden kare vermediği stderr'de yazıyor; onu
                # yutmak "kamera hatası" diye içi boş bir mesaj bırakıyordu.
                ayrinti = (hata.stderr or b"").decode("utf-8", "replace").strip()
                raise RuntimeError(f"{komut[0]} başarısız: {ayrinti[-300:] or hata}") from hata
            with open(gecici.name, "rb") as dosya:
                return dosya.read()
        finally:
            try:
                os.unlink(gecici.name)
            except OSError:
                pass

    def _sahte_kare(self) -> bytes:
        """Donanım olmadan panelin kare akışını denemek için üretilen kare."""
        from PIL import Image, ImageDraw

        genislik = int(self.ayar["genislik"])
        yukseklik = int(genislik * 3 / 4)
        gorsel = Image.new("RGB", (genislik, yukseklik), (26, 40, 26))
        cizim = ImageDraw.Draw(gorsel)
        # Yatak ızgarası + saat: kareyi gerçekten yenilendiğini görebilmek için.
        for x in range(0, genislik, 64):
            cizim.line([(x, 0), (x, yukseklik)], fill=(38, 58, 38))
        for y in range(0, yukseklik, 64):
            cizim.line([(0, y), (genislik, y)], fill=(38, 58, 38))
        for i in range(6):
            cx, cy = 70 + i * 90, yukseklik // 2
            cizim.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=(58, 130, 66))
        cizim.text((12, 10), "SAHTE KAMERA — " + time.strftime("%H:%M:%S"), fill=(220, 230, 220))
        tampon = io.BytesIO()
        gorsel.save(tampon, format="JPEG", quality=int(self.ayar["kalite"]))
        return tampon.getvalue()

    def _yontem_sec(self) -> str:
        if self.ayar.get("sahte"):
            return "sahte"
        if self._picamera2_dene():
            return "picamera2"
        if shutil.which("rpicam-still"):
            return "rpicam"
        if shutil.which("libcamera-still"):
            return "libcamera"
        if shutil.which("fswebcam"):
            return "fswebcam"
        return ""

    def kare_al(self) -> bytes:
        if self._yontem == "sahte":
            return self._sahte_kare()
        if self._yontem == "picamera2":
            return self._picamera2_kare()
        return self._komut_kare()

    # --- döngü ---
    def baslat(self) -> None:
        if not self.ayar.get("aktif"):
            return
        self._yontem = self._yontem_sec()
        if not self._yontem:
            # Kamera yoksa ajan çalışmaya devam etmeli: kamera bir eklenti,
            # makinenin çalışması ona bağlı değil.
            self.gunluk_cb(
                "Kamera bulunamadı (picamera2 / rpicam-still / libcamera-still / "
                "fswebcam yok) — kamera kapalı, diğer her şey çalışıyor", "uyari")
            return
        self._calisiyor = True
        self.gunluk_cb(f"Kamera açıldı ({self._yontem})", "bilgi")
        threading.Thread(target=self._dongu, name="kamera", daemon=True).start()

    def durdur(self) -> None:
        self._calisiyor = False
        if self._picam is not None:
            try:
                self._picam.stop()
            except Exception:
                pass

    def _dongu(self) -> None:
        aralik = max(2.0, float(self.ayar.get("aralik_sn", 30.0)))
        hata_sayaci = 0
        while self._calisiyor:
            try:
                ham = self.kare_al()
                self.gonder(base64.b64encode(ham).decode("ascii"), time.time())
                self.son_hata = None
                hata_sayaci = 0
            except Exception as hata:
                hata_sayaci += 1
                self.son_hata = str(hata)
                # Her turda günlüğe yazmak, kamerası çıkmış bir Pi'de günlüğü
                # doldurur. İlk hatayı ve sonra seyrek olarak bildiriyoruz.
                if hata_sayaci == 1 or hata_sayaci % 20 == 0:
                    self.gunluk_cb(f"Kare alınamadı ({hata_sayaci}. kez): {hata}", "hata")
            time.sleep(aralik)
