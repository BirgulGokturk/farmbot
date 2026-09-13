"""
ajan_kanca — ajan'ın `kamera_kare` komutuna USB kamera desteği ekler.

MEVCUT PROTOKOLE UYAR, YENİ KOMUT GETİRMEZ. Sunucu zaten şunu yolluyor
(main.py `_cozumleme_karesi`):

    komut_gonder("kamera_kare", {"kamera": <ad>, "azami_yas_sn": 5.0})

ve şu biçimde cevap bekliyor:

    {"ok": True, "veri": {"kare": "<base64 JPEG>"}}

Cevap gelmezse sunucu canlı akışın küçük karesine düşüyor, o da yoksa hata
veriyor. Sahada görülen hata buydu: ajan `uc` kamerası için tam çözünürlüklü
kare üretemiyor, çünkü elindeki tek şey ffmpeg'in 640x480 akışı.

BU KANCA NE YAPAR
  1. Canlı akışı duraklatır (UVC tekil erişimli — akış açıkken 4K çekilemez)
  2. Kilitli pozlamayla 3840x2160 kare çeker
  3. Akışı geri açar
  4. JPEG'i base64 olarak döndürür

`azami_yas_sn` gözetilir: bu süre içinde çekilmiş bir kare varsa yeniden
çekilmez, önbellekten verilir. Ölçüm arka arkaya çağrıldığında kamerayı
gereksiz yere açıp kapatmayalım diye.

AJANA BAĞLAMA — ajan.py:966 civarındaki komut çözücüde:

    if ad == "kamera_kare":
        from gorus.ajan_kanca import kamera_kare_usb, USB_KAMERALAR
        if arg.get("kamera") in USB_KAMERALAR:
            return await kamera_kare_usb(arg)
        ...                       # mevcut CSI yolu olduğu gibi kalır
"""

from __future__ import annotations

import asyncio
import base64
import time
from pathlib import Path

# Hangi kamera adları USB'den okunacak. Panelde "Uç kamerası" olarak
# görünen kamera bu listede olmalı; adı sunucudaki kamera kaydıyla aynı.
USB_KAMERALAR = ("uc",)

# Ölçüm kamerasının KARARLI yolu. /dev/video0 kullanmayın: MX Brio takılınca
# video0 oldu ve panelin akışı CSI yerine onu kaptı. USB sırası değişince
# hangi kameranın açılacağı kurayla belirlenir.
# Gerçek yolu `python -m gorus.usb_kamera --listele` yazdırır.
USB_KAMERA_YOLU = "/dev/v4l/by-id/usb-046d_MX_Brio_2613ZBA0H858-video-index0"
USB_COZUNURLUK = (3840, 2160)

# Ajan'ın kendi akış başlat/durdur çağrılarını buraya bağlayın. Akışı
# dışarıdan öldürüp yeniden doğurmak, ffmpeg stdout'unu WebSocket'e bağlayan
# boruyu koparır; kendi çağrılarınız yeniden bağlamayı bilir.
AKIS_DURDUR = None      # ör. ajan.akisi_durdur
AKIS_BASLAT = None      # ör. ajan.akisi_baslat

# İsteğe bağlı: kare diske de yazılsın (arşiv/hata ayıklama). None = yazma.
KARE_DIZINI: Path | None = Path("/home/batupi/farmbot/veri/kareler")

_onbellek: dict[str, tuple[float, bytes]] = {}
_kilit = asyncio.Lock()


async def kamera_kare_usb(arg: dict) -> dict:
    """Sunucunun `kamera_kare` komutunu USB kamerayla karşılar."""
    kamera = str(arg.get("kamera") or "uc")
    azami_yas = float(arg.get("azami_yas_sn") or 0.0)
    genislik = int(arg.get("genislik") or USB_COZUNURLUK[0])
    yukseklik = int(arg.get("yukseklik") or USB_COZUNURLUK[1])

    # --- önbellek: yeterince taze kare varsa yeniden çekme ---
    onceki = _onbellek.get(kamera)
    if onceki and azami_yas > 0 and (time.time() - onceki[0]) <= azami_yas:
        return {"ok": True, "veri": {"kare": base64.b64encode(onceki[1]).decode(),
                                     "kaynak": "onbellek",
                                     "yas_sn": round(time.time() - onceki[0], 2)}}

    async with _kilit:                      # aynı anda tek çekim
        onceki = _onbellek.get(kamera)      # kilidi beklerken başkası çekmiş olabilir
        if onceki and azami_yas > 0 and (time.time() - onceki[0]) <= azami_yas:
            return {"ok": True, "veri": {"kare": base64.b64encode(onceki[1]).decode(),
                                         "kaynak": "onbellek"}}
        try:
            ham, bilgi = await _cek(genislik, yukseklik)
        except Exception as e:
            return {"ok": False, "hata": f"{type(e).__name__}: {e}",
                    "kamera": kamera}
        _onbellek[kamera] = (time.time(), ham)

    return {"ok": True, "veri": {"kare": base64.b64encode(ham).decode(),
                                 "kaynak": "usb", "cozunurluk": bilgi["cozunurluk"],
                                 "boyut": len(ham), "yol": bilgi.get("yol"),
                                 "kilitlenemeyen": bilgi.get("kilitlenemeyen")}}


async def _cek(genislik, yukseklik) -> tuple[bytes, dict]:
    import datetime as dt

    from .akis import CanliAkis
    from .usb_kamera import UsbKamera

    hedef = None
    if KARE_DIZINI is not None:
        KARE_DIZINI.mkdir(parents=True, exist_ok=True)
        hedef = KARE_DIZINI / f"olcum_{dt.datetime.now():%Y%m%d_%H%M%S}_{genislik}.jpg"

    akis = CanliAkis(USB_KAMERA_YOLU, durdur=AKIS_DURDUR, baslat=AKIS_BASLAT)
    async with akis:                         # canlı akış durur, çıkışta geri gelir
        kam = UsbKamera(USB_KAMERA_YOLU, genislik, yukseklik, tek_seferlik=False)
        bilgi = await asyncio.to_thread(kam.hazirla)
        try:
            kare = await asyncio.to_thread(kam.kare_al)
        finally:
            kam.kapat()

    import cv2
    ok, tampon = cv2.imencode(".jpg", kare, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise RuntimeError("JPEG kodlanamadı")
    ham = tampon.tobytes()
    if hedef is not None:
        hedef.write_bytes(ham)
    return ham, {"cozunurluk": [kare.shape[1], kare.shape[0]],
                 "yol": str(hedef) if hedef else None,
                 "kilitlenemeyen": bilgi.get("kilitlenemeyen"),
                 "akis": {"duraklat": getattr(akis, "rapor_duraklat", None),
                          "devam": getattr(akis, "rapor_devam", None)}}


def onbellegi_temizle(kamera: str | None = None) -> None:
    """Portal hareket ettiyse ya da ışık değiştiyse önbelleği düşürün."""
    if kamera is None:
        _onbellek.clear()
    else:
        _onbellek.pop(kamera, None)


def eski_kareleri_temizle(gun: int = 21, en_az_birak: int = 50) -> int:
    """Kare deposu SD kartı doldurmasın. Saklamak istediklerinizi ayırın."""
    if KARE_DIZINI is None or not KARE_DIZINI.exists():
        return 0
    kareler = sorted(KARE_DIZINI.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
    sinir = time.time() - gun * 86400
    silinen = 0
    for p in (kareler[:-en_az_birak] if len(kareler) > en_az_birak else []):
        if p.stat().st_mtime < sinir:
            p.unlink(); silinen += 1
    return silinen
