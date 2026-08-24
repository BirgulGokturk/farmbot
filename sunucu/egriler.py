"""Eğriler — zamana göre değişen değerler.

"Günde 250 ml" sabit bir sayı; oysa fide üç günlükken de hasada bir hafta
kalmışken de aynı suyu istemiyor. Eğri, bitkinin YAŞINA göre bir değer
veriyor:

    [[0, 20], [10, 80], [30, 200], [60, 250]]
     gün  ml   gün  ml   gün  ml    gün  ml

Aradaki günler doğrusal ara değerle bulunuyor; ilk noktadan önce ilk değer,
son noktadan sonra son değer geçerli (uçlarda düz devam).

Üç tip var:
    su         — ml/gün
    yayilim    — mm, bitkinin o yaştaki çapı (harita halkası bunu kullanıyor)
    yukseklik  — mm, bitkinin boyu

Neden JSON: nokta ve program deposuyla aynı gerekçe — küçük, bütün okunup
bütün yazılan bir veri. Gerekçenin tamamı `noktalar.py` başında.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

_KILIT = threading.RLock()

GECERLI_TIPLER = ("su", "yayilim", "yukseklik")
BIRIM = {"su": "ml/gün", "yayilim": "mm", "yukseklik": "mm"}
AZAMI_NOKTA = 24
AZAMI_EGRI = 60
AZAMI_GUN = 400
# Tipe göre üst sınır: bir eğriyi elle düzenlerken sıfır fazla yazmak kolay.
AZAMI_DEGER = {"su": 20000.0, "yayilim": 3000.0, "yukseklik": 3000.0}

# Başlangıç şablonları. Kopyalanıp düzenlensin diye: boş bir eğri düzenleyici
# karşısında "kaç ml yazmalıyım" diye düşünmek zorunda kalmayın.
SABLONLAR: list[dict[str, Any]] = [
    {"ad": "Yapraklı sebze — su", "tip": "su",
     "noktalar": [[0, 20], [7, 60], [21, 140], [45, 200]]},
    {"ad": "Meyveli — su", "tip": "su",
     "noktalar": [[0, 30], [14, 120], [35, 320], [70, 450]]},
    {"ad": "Kök sebze — su", "tip": "su",
     "noktalar": [[0, 25], [10, 70], [30, 150], [60, 180]]},
    {"ad": "Yapraklı sebze — yayılım", "tip": "yayilim",
     "noktalar": [[0, 20], [14, 90], [30, 180], [45, 250]]},
    {"ad": "Meyveli — yayılım", "tip": "yayilim",
     "noktalar": [[0, 25], [20, 150], [45, 380], [70, 500]]},
    {"ad": "Yapraklı sebze — yükseklik", "tip": "yukseklik",
     "noktalar": [[0, 10], [14, 60], [30, 140], [45, 200]]},
]


class EgriHatasi(Exception):
    """Geçersiz eğri tanımı."""


def _yol() -> str:
    ozel = os.environ.get("EGRI_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "egriler.json")
    return os.path.join(os.path.dirname(__file__), "egriler.json")


def oku() -> dict[str, Any]:
    yol = _yol()
    with _KILIT:
        if not os.path.exists(yol):
            return {"surum": 1, "egriler": []}
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            try:
                os.replace(yol, yol + ".bozuk")
            except OSError:
                pass
            return {"surum": 1, "egriler": []}
        if not isinstance(veri.get("egriler"), list):
            return {"surum": 1, "egriler": []}
        return veri


def _yaz(veri: dict[str, Any]) -> None:
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                             prefix=".egri-", suffix=".tmp", delete=False)
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


def hepsi() -> list[dict[str, Any]]:
    return oku()["egriler"]


def bul(ad: str) -> dict[str, Any] | None:
    ad = str(ad or "").strip()
    return next((e for e in hepsi() if e.get("ad") == ad), None)


def dogrula(ad: str, tip: str, noktalar: list) -> dict[str, Any]:
    ad = str(ad or "").strip()
    if not ad:
        raise EgriHatasi("Eğri adı boş olamaz")
    if tip not in GECERLI_TIPLER:
        raise EgriHatasi(f"Bilinmeyen eğri tipi: '{tip}'")
    if not isinstance(noktalar, list) or len(noktalar) < 2:
        raise EgriHatasi("Eğride en az iki nokta olmalı")
    if len(noktalar) > AZAMI_NOKTA:
        raise EgriHatasi(f"En fazla {AZAMI_NOKTA} nokta olabilir")

    temiz: list[list[float]] = []
    for ham in noktalar:
        try:
            gun, deger = float(ham[0]), float(ham[1])
        except (TypeError, ValueError, IndexError):
            raise EgriHatasi("Her nokta [gün, değer] biçiminde olmalı")
        if not 0 <= gun <= AZAMI_GUN:
            raise EgriHatasi(f"Gün 0 ile {AZAMI_GUN} arasında olmalı (verilen: {gun:g})")
        ust = AZAMI_DEGER[tip]
        if not 0 <= deger <= ust:
            raise EgriHatasi(
                f"{BIRIM[tip]} değeri 0 ile {ust:g} arasında olmalı (verilen: {deger:g})")
        temiz.append([gun, deger])

    temiz.sort(key=lambda n: n[0])
    gunler = [n[0] for n in temiz]
    if len(set(gunler)) != len(gunler):
        raise EgriHatasi("Aynı gün iki kez tanımlanamaz")
    return {"ad": ad[:40], "tip": tip, "birim": BIRIM[tip], "noktalar": temiz}


def kaydet(ad: str, tip: str, noktalar: list) -> dict[str, Any]:
    egri = dogrula(ad, tip, noktalar)
    with _KILIT:
        veri = oku()
        if len(veri["egriler"]) >= AZAMI_EGRI and not any(
                e.get("ad") == egri["ad"] for e in veri["egriler"]):
            raise EgriHatasi(f"En fazla {AZAMI_EGRI} eğri saklanabilir")
        mevcut = next((i for i, e in enumerate(veri["egriler"])
                       if e.get("ad") == egri["ad"]), None)
        if mevcut is not None:
            veri["egriler"][mevcut] = egri
        else:
            veri["egriler"].append(egri)
        _yaz(veri)
    return egri


def sil(ad: str) -> bool:
    ad = str(ad or "").strip()
    with _KILIT:
        veri = oku()
        once = len(veri["egriler"])
        veri["egriler"] = [e for e in veri["egriler"] if e.get("ad") != ad]
        if len(veri["egriler"]) == once:
            return False
        _yaz(veri)
    return True


def deger(egri: dict[str, Any], gun: float) -> float:
    """Eğrinin `gun` yaşındaki değeri — aradaki günler doğrusal ara değerle.

    Uçlarda düz devam ediyor: ekimden önceki bir gün ilk değeri, hasat
    gününden sonrası son değeri veriyor. Böylece eğri hiçbir yaşta tanımsız
    kalmıyor — bir bitkinin ekim tarihi eksik olsa bile bir sayı çıkıyor.
    """
    noktalar = egri.get("noktalar") or []
    if not noktalar:
        return 0.0
    if gun <= noktalar[0][0]:
        return float(noktalar[0][1])
    if gun >= noktalar[-1][0]:
        return float(noktalar[-1][1])
    for i in range(1, len(noktalar)):
        g0, d0 = noktalar[i - 1]
        g1, d1 = noktalar[i]
        if gun <= g1:
            if g1 == g0:
                return float(d1)
            oran = (gun - g0) / (g1 - g0)
            return float(d0 + (d1 - d0) * oran)
    return float(noktalar[-1][1])
