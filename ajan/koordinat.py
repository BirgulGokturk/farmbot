"""Piksel → makine milimetresi. Kalibrasyon varsa; yoksa SESSİZ DEĞİL.

Leke bulucu piksel üretiyor (`lekeler.py`), robot milimetre istiyor. Bu
modül ikisinin arasında duruyor ve dönüşümü `goru_kalib` paketindeki
kalibrasyona yaptırıyor — orada iç kalibrasyon (lens distorsiyonu) ve 16
noktalı homografi birlikte duruyor.

AYRI MODÜL, `lekeler.py` İÇİNDE DEĞİL. Leke bulmanın kalibrasyona
ihtiyacı yok ve olmamalı: kamera nereye takılırsa takılsın "şurada bitki
var" diyebiliyor. Kalibrasyon ayrı bir yetenek ve yoksa yalnız koordinat
kapanıyor, tespit çalışmaya devam ediyor.

DÖNDÜRME BURADA GERİ ALINIYOR
-----------------------------
Ajan panele `dondur: 90` uygulanmış kare gönderiyor ve leke bulucu da o
kareyi işliyor. Kalibrasyon ise HAM karenin koordinat sisteminde kuruldu
(kalibrasyon betikleri kamerayı doğrudan açıyor, ajanın döndürmesini
görmüyor). İkisini karıştırmak bütün kalibrasyonu boşa çıkarır — rehber
de bu adımdaki hatanın "bütün kalibrasyonu boşa çıkardığını" ayrıca
uyarıyor.

Bu yüzden kutular mm'ye çevrilmeden önce ham karenin uzayına geri
döndürülüyor. Dönüşüm yerelde doğrulandı (PIL ROTATE_270 = saat yönünde
90°):

    ham (x, y)   -> dönük (H-1-y, x)
    dönük (x, y) -> ham (y, H-1-x)        H = ham karenin YÜKSEKLİĞİ

KALİBRASYON YOKSA
-----------------
`hazir` False dönüyor ve `sebep` neden olduğunu yazıyor. Uydurma bir
ölçekle milimetre üretmek, yanlış yeri bitki diye göstermek olurdu;
projenin kuralı da bunu yasaklıyor.
"""

from __future__ import annotations

import os
import sys
import threading
from typing import Any

#: `goru_kalib` deposun içinde, ajanın kardeşi. Ortam değişkeniyle
#: taşınabiliyor: kalibrasyon başka bir yerde tutulmak istenebilir.
KALIB_KLASOR = os.environ.get(
    "GORU_KALIB", os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "goru_kalib"))

_KILIT = threading.Lock()
_DURUM: dict[str, Any] = {"donusum": None, "sebep": "", "denendi": False}


def _yukle() -> None:
    """Kalibrasyonu bir kez yükler. Kilit ÇAĞIRANDA tutuluyor."""
    _DURUM["denendi"] = True
    if not os.path.isdir(KALIB_KLASOR):
        _DURUM["sebep"] = f"kalibrasyon klasörü yok: {KALIB_KLASOR}"
        return
    if KALIB_KLASOR not in sys.path:
        sys.path.insert(0, KALIB_KLASOR)
    try:
        from donusum import KameraDonusum
        _DURUM["donusum"] = KameraDonusum()
        _DURUM["sebep"] = ""
    except Exception as hata:                               # noqa: BLE001
        # En sık sebep: homografi hiç kurulmamış ya da iç kalibrasyon
        # yenilenip homografi eski kalmış (donusum.py bunu reddediyor).
        _DURUM["donusum"] = None
        _DURUM["sebep"] = f"{type(hata).__name__}: {hata}"


def hazir() -> tuple[bool, str]:
    """(kalibrasyon var mı, yoksa sebebi)."""
    with _KILIT:
        if not _DURUM["denendi"]:
            _yukle()
        return (_DURUM["donusum"] is not None, _DURUM["sebep"])


def yenile() -> tuple[bool, str]:
    """Kalibrasyon dosyaları değiştiyse yeniden okur."""
    with _KILIT:
        _DURUM["donusum"] = None
        _DURUM["denendi"] = False
        _yukle()
        return (_DURUM["donusum"] is not None, _DURUM["sebep"])


def _ham_uzaya(x: float, y: float, derece: int,
               ham_g: int, ham_y: int) -> tuple[float, float]:
    """Döndürülmüş karedeki noktayı ham karenin uzayına çevirir."""
    d = int(derece) % 360
    if d == 90:
        return (y, ham_y - 1 - x)
    if d == 180:
        return (ham_g - 1 - x, ham_y - 1 - y)
    if d == 270:
        return (ham_g - 1 - y, x)
    return (x, y)


def mm_ekle(sonuc: dict[str, Any], derece: int = 0,
            nokta: str = "merkez", yukseklik_mm: float = 0.0) -> dict[str, Any]:
    """Leke sonucuna `x_mm` / `y_mm` ekler. Sonucu YERİNDE değiştirir.

    `derece`: karenin döndürülme açısı (ajandaki `dondur`). Kutular önce
    ham karenin uzayına geri çevriliyor.

    `nokta`: "merkez" kutunun ortası, "alt" kutunun alt-orta noktası.
    Eğik kamerada filizin tepesi toprağa değdiği noktadan kaymış
    görünüyor; hangisinin doğru olduğu ekim kaydıyla karşılaştırılarak
    seçiliyor, bu yüzden ikisi de duruyor.
    """
    lekeler = sonuc.get("lekeler") or []
    if not lekeler:
        return sonuc

    var, sebep = hazir()
    if not var:
        sonuc["mm_sebep"] = sebep or "kalibrasyon yok"
        return sonuc

    kare = sonuc.get("kare_px") or [0, 0]
    don = int(derece) % 360
    # Ham karenin ölçüsü: 90/270 döndürmede en ve boy yer değiştirmiş
    # hâlde geliyor, geri alıyoruz.
    ham_g, ham_y = (kare[1], kare[0]) if don in (90, 270) else (kare[0], kare[1])

    noktalar = []
    for l in lekeler:
        x1, y1, x2, y2 = l.get("kutu") or [0, 0, 0, 0]
        if nokta == "alt":
            px, py = (x1 + x2) / 2.0, float(y2)
        else:
            px, py = float(l.get("x", (x1 + x2) / 2.0)), float(l.get("y", (y1 + y2) / 2.0))
        noktalar.append(_ham_uzaya(px, py, don, ham_g, ham_y))

    try:
        with _KILIT:
            donusum = _DURUM["donusum"]
        mm = donusum.piksel_to_mm(noktalar, (ham_g, ham_y), kaynak="ham",
                                  yukseklik_mm=float(yukseklik_mm))
    except Exception as hata:                               # noqa: BLE001
        sonuc["mm_sebep"] = f"dönüşüm başarısız: {hata}"
        return sonuc

    for l, p in zip(lekeler, mm):
        l["x_mm"] = round(float(p[0]), 1)
        l["y_mm"] = round(float(p[1]), 1)
    sonuc["mm_sebep"] = ""
    sonuc["mm_nokta"] = nokta
    return sonuc
