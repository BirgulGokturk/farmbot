"""Kamera kalibrasyonu — fotoğrafı haritaya oturtan sayılar.

Kamera uç kafasına bağlı; her kare çekildiği eksen konumuyla saklanıyor
(bkz. `kareler.py`). Kareyi haritanın DOĞRU yerine, doğru ölçekte ve doğru
açıyla koyabilmek için dört şey gerekiyor:

    mm_px    — bir piksel kaç mm (yükseklik sabitken sabit)
    donme    — kamera ekseninin makine eksenine göre açısı (derece)
    ofset_x  — kamera merkezinin uç ucundan kayması (mm)
    ofset_y
    ayna_x   — görüntü yatayda ters mi (montaj yönüne göre)
    ayna_y

Bunlar elle girilebiliyor ama asıl yol **iki kare**: makineyi bilinen bir
mesafe kadar oynatıp aynı toprak parçasını iki karede işaretlemek. Aradaki
piksel farkı ile mm farkı hem ölçeği hem açıyı veriyor. Hesap `coz()` içinde;
panel yalnızca tıklanan pikselleri gönderiyor.

Neden JSON: nokta deposuyla aynı gerekçe — küçük, bütün okunup bütün yazılan
bir veri. Gerekçenin tamamı `noktalar.py` başında.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
import threading
from typing import Any

_KILIT = threading.RLock()

VARSAYILAN: dict[str, Any] = {
    "mm_px": 0.0,          # 0 = daha kalibre edilmedi
    "donme": 0.0,
    "ofset_x": 0.0,
    "ofset_y": 0.0,
    "ayna_x": False,
    "ayna_y": False,
    "genislik_px": 640,
    "yukseklik_px": 480,
    "guncelleme": 0.0,      # son kalibrasyon zamanı (unix)
    "yontem": "",           # "elle" | "iki-kare"
}

# Makul aralıklar. Panelden gelen sayıya körlemesine güvenmiyoruz: saçma bir
# ölçek haritayı kilometrelerce büyütür.
SINIR = {
    "mm_px": (0.01, 20.0),
    "donme": (-180.0, 180.0),
    "ofset_x": (-500.0, 500.0),
    "ofset_y": (-500.0, 500.0),
    "genislik_px": (16, 8000),
    "yukseklik_px": (16, 8000),
}


class KalibrasyonHatasi(Exception):
    """Kalibrasyon hesaplanamadı ya da verilen değer geçersiz."""


def _yol() -> str:
    ozel = os.environ.get("KALIBRASYON_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "kamera_kalibrasyon.json")
    return os.path.join(os.path.dirname(__file__), "kamera_kalibrasyon.json")


def oku() -> dict[str, Any]:
    yol = _yol()
    with _KILIT:
        if not os.path.exists(yol):
            return dict(VARSAYILAN)
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            return dict(VARSAYILAN)
        if not isinstance(veri, dict):
            return dict(VARSAYILAN)
        return {**VARSAYILAN, **veri}


def _yaz(veri: dict[str, Any]) -> None:
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                             prefix=".kalib-", suffix=".tmp", delete=False)
        try:
            json.dump(veri, gecici, ensure_ascii=False, indent=1)
            gecici.flush()
            os.fsync(gecici.fileno())
            gecici.close()
            os.replace(gecici.name, yol)
        except Exception:
            try:
                os.unlink(gecici.name)
            except OSError:
                pass
            raise


def _sinirla(ad: str, deger: float) -> float:
    alt, ust = SINIR[ad]
    sayi = float(deger)
    if not math.isfinite(sayi):
        raise KalibrasyonHatasi(f"'{ad}' sayı olmalı")
    if not alt <= sayi <= ust:
        raise KalibrasyonHatasi(f"'{ad}' {alt} ile {ust} arasında olmalı (verilen: {sayi})")
    return sayi


def kaydet(ham: dict[str, Any]) -> dict[str, Any]:
    mevcut = oku()
    yeni = dict(mevcut)
    for ad in ("mm_px", "donme", "ofset_x", "ofset_y"):
        if ad in ham and ham[ad] is not None:
            # mm_px = 0 "kalibre edilmedi" demek; sıfırlamayı engellememeliyiz.
            if ad == "mm_px" and float(ham[ad]) == 0:
                yeni[ad] = 0.0
                continue
            yeni[ad] = _sinirla(ad, ham[ad])
    for ad in ("genislik_px", "yukseklik_px"):
        if ad in ham and ham[ad] is not None:
            yeni[ad] = int(_sinirla(ad, ham[ad]))
    for ad in ("ayna_x", "ayna_y"):
        if ad in ham:
            yeni[ad] = bool(ham[ad])
    if "yontem" in ham:
        yeni["yontem"] = str(ham["yontem"])[:20]
    if "guncelleme" in ham:
        yeni["guncelleme"] = float(ham["guncelleme"] or 0)
    _yaz(yeni)
    return yeni


def coz(kare1: dict[str, Any], kare2: dict[str, Any]) -> dict[str, float]:
    """İki kareden ölçek ve açı çıkarır.

    Her kare: {"x","y"} makine konumu (mm) ve {"u","v"} aynı toprak
    parçasının o karedeki piksel yeri.

    Makine Δ kadar hareket ettiğinde SABİT bir toprak parçası kameraya göre
    −Δ kadar kayar. Görüntüdeki piksel kayması ΔU ise:

        −Δ = s · R(θ) · ΔU

    Buradan ölçek iki uzunluğun oranı, açı da iki yönün farkı.
    """
    dx = float(kare2["x"]) - float(kare1["x"])
    dy = float(kare2["y"]) - float(kare1["y"])
    du = float(kare2["u"]) - float(kare1["u"])
    dv = float(kare2["v"]) - float(kare1["v"])

    mm_uzunluk = math.hypot(dx, dy)
    px_uzunluk = math.hypot(du, dv)

    # Çok küçük hareket = büyük hata. 20 mm ve 12 px, gürültünün üstünde
    # kalmak için makul bir alt sınır.
    if mm_uzunluk < 20:
        raise KalibrasyonHatasi(
            f"İki kare arasında en az 20 mm hareket olmalı (şu an {mm_uzunluk:.1f} mm). "
            "Makineyi biraz daha oynatıp yeniden çekin.")
    if px_uzunluk < 12:
        raise KalibrasyonHatasi(
            f"İşaretlenen iki nokta arasında en az 12 piksel olmalı "
            f"(şu an {px_uzunluk:.1f} px). Aynı toprak parçasını işaretlediğinizden emin olun.")

    mm_px = mm_uzunluk / px_uzunluk
    donme = math.degrees(math.atan2(-dy, -dx) - math.atan2(dv, du))
    # -180..180 aralığına indir
    donme = (donme + 180) % 360 - 180
    return {"mm_px": mm_px, "donme": donme,
            "mm_mesafe": mm_uzunluk, "px_mesafe": px_uzunluk}
