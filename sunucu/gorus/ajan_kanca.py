"""
ajan_kanca — AJAN'a eklenecek "kare_cek" komutu.

Sunucu tarama isteyince ajan'a `{"komut": "kare_cek"}` gelir; bu kanca
canlı akışı duraklatır, tam çözünürlükte kare çeker, akışı geri açar ve
dosya yolunu döndürür.

ajan.py'nin komut çözücüsüne tek satır:

    elif komut == "kare_cek":
        cevap = await kare_cek(kamera_yok_farketmez, mesaj, portal)

Üst kamera (CSI/picamera2) bu paketin işi değil — ajan'ın kendi
kamera.py'sinde kalıyor, ikinci bir kopyası tutulmuyor.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from pathlib import Path

KARE_DIZINI = Path("/home/batupi/farmbot/veri/kareler")

# Ölçüm kamerasının KARARLI yolu. /dev/video0 kullanmayın: MX Brio takılınca
# video0 oldu ve panelin akışı CSI yerine onu kaptı. USB sırası değişince
# hangi kameranın açılacağı kurayla belirlenir.
# Gerçek yolu `python -m gorus.usb_kamera --listele` yazdırır.
USB_KAMERA_YOLU = "/dev/v4l/by-id/usb-046d_MX_Brio_2613ZBA0H858-video-index0"
USB_COZUNURLUK = (3840, 2160)

# Panelin canlı akışı (ffmpeg) aynı kamerayı tutuyor. UVC tekil erişimli
# olduğu için 4K kare çekilirken duraklatılmalı. Ajan'ın kendi başlat/durdur
# çağrılarını buraya bağlayın — akışı dışarıdan öldürüp yeniden doğurmak,
# ffmpeg stdout'unu WebSocket'e bağlayan boruyu koparır.
AKIS_DURDUR = None      # ör. ajan.akisi_durdur
AKIS_BASLAT = None      # ör. ajan.akisi_baslat


async def kare_cek(kamera, mesaj: dict, portal=None) -> dict:
    """
    portal_park: Portal yatağın üstündeyse kadrajı kapatır ve gölge düşürür;
    bir AprilTag'i örterse kalibrasyon doğrulaması da düşer. Kare çekmeden
    önce park edilir ve DURDUĞU doğrulanır.
    """
    from .akis import CanliAkis
    from .usb_kamera import UsbKamera

    genislik = int(mesaj.get("genislik", USB_COZUNURLUK[0]))
    yukseklik = int(mesaj.get("yukseklik", USB_COZUNURLUK[1]))
    etiket = str(mesaj.get("etiket", "tarama"))

    if mesaj.get("portal_park") and portal is not None:
        try:
            await portal.park_et()
            await portal.hareketsiz_bekle(zaman_asimi=20.0)
            await asyncio.sleep(0.7)          # titreşim sönümü
        except Exception as e:
            return {"tamam": False, "hata": f"portal park edilemedi: {e}"}

    KARE_DIZINI.mkdir(parents=True, exist_ok=True)
    yol = KARE_DIZINI / f"{etiket}_{dt.datetime.now():%Y%m%d_%H%M%S}_{genislik}.jpg"

    akis = CanliAkis(USB_KAMERA_YOLU, durdur=AKIS_DURDUR, baslat=AKIS_BASLAT)
    try:
        async with akis:                      # canlı akış durur
            kam = UsbKamera(USB_KAMERA_YOLU, genislik, yukseklik,
                            tek_seferlik=False)
            bilgi = await asyncio.to_thread(kam.hazirla)
            r = await asyncio.to_thread(kam.cek, str(yol))
            kam.kapat()
                                              # çıkışta akış geri gelir
        return {"tamam": True, "yol": r["yol"], "boyut": r["boyut"],
                "cozunurluk": r["cozunurluk"],
                "kilitlenemeyen": bilgi.get("kilitlenemeyen"),
                "akis": {"duraklat": getattr(akis, "rapor_duraklat", None),
                         "devam": getattr(akis, "rapor_devam", None)},
                "zaman": dt.datetime.now().astimezone().isoformat(timespec="seconds")}
    except Exception as e:
        try:
            await akis.devam()                # hata olsa da paneli geri ver
        except Exception:
            pass
        return {"tamam": False, "hata": f"{type(e).__name__}: {e}"}


def eski_kareleri_temizle(gun: int = 21, en_az_birak: int = 50) -> int:
    """Kare deposu SD kartı doldurmasın. Saklamak istediklerinizi ayırın."""
    import time
    if not KARE_DIZINI.exists():
        return 0
    kareler = sorted(KARE_DIZINI.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
    sinir = time.time() - gun * 86400
    silinen = 0
    for p in (kareler[:-en_az_birak] if len(kareler) > en_az_birak else []):
        if p.stat().st_mtime < sinir:
            p.unlink(); silinen += 1
    return silinen
