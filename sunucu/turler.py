"""Bitki türleri — kurtarılmış katalog + kullanıcının ezmeleri.

Üç katman var, üstteki alttakini eziyor:

    1. docs/bitki_turleri.json   kurtarılmış kaynak veri — SALT OKUNUR
    2. tur_ezme.json             tür düzeyinde ezme (bu dosya)
    3. noktanın `ozel` alanı     tek bitki düzeyinde ezme (noktalar.py)

Katalog dosyasına neden yazmıyoruz: o dosya kurtarılmış bir kaynak. Üstüne
yazmak, bir kere bozulduğunda geri dönülecek yeri yok etmek demek. Kullanıcı
bir değeri değiştirdiğinde kaynak olduğu gibi duruyor, değişiklik ayrı bir
dosyaya yazılıyor ve "türden farklı" diye işaretlenebiliyor — hangi değerin
elle konduğu, hangisinin katalogdan geldiği her zaman belli.

Tür düzeyi ile bitki düzeyi ayrımı:
  - Tür düzeyi: "marulun çapı bizim yatakta 180 mm" — o türden EKLENECEK
    bitkiler de bunu kullanıyor.
  - Bitki düzeyi: "şu marul cılız kaldı, çapı 120" — türün geri kalanı
    etkilenmiyor.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

_KILIT = threading.RLock()

# Kullanıcının değiştirebileceği alanlar. Ad, renk ve simge listede YOK:
# onlar kataloğun kimliği; değiştirilmesi gerekirse yeni bir tür eklemek
# doğru yol olur.
DUZENLENEBILIR = ("spread_mm", "sow_depth_mm", "days_to_harvest", "water_ml_per_day")

# Makul aralıklar — panelden gelen sayıya körlemesine güvenmiyoruz. Sıfır
# fazla yazmak kolay ve 4000 mm çaplı bir marul haritayı okunmaz yapıyor.
SINIR = {
    "spread_mm": (10.0, 3000.0),
    "sow_depth_mm": (0.0, 200.0),
    "days_to_harvest": (1.0, 400.0),
    "water_ml_per_day": (0.0, 20000.0),
}

BIRIM = {
    "spread_mm": "mm",
    "sow_depth_mm": "mm",
    "days_to_harvest": "gün",
    "water_ml_per_day": "ml/gün",
}

BASLIK = {
    "spread_mm": "Yayılma çapı",
    "sow_depth_mm": "Ekim derinliği",
    "days_to_harvest": "Hasat süresi",
    "water_ml_per_day": "Günlük su",
}


class TurHatasi(Exception):
    """Geçersiz alan ya da aralık dışı değer."""


# --------------------------------------------------------------------------- #
# 1. katman — kurtarılmış katalog (salt okunur)
# --------------------------------------------------------------------------- #
_KATALOG = {"ts": 0.0, "veri": []}


def _katalog_yolu() -> str:
    ozel = os.environ.get("TUR_YOLU")
    if ozel:
        return ozel
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "docs", "bitki_turleri.json")


def katalog() -> list[dict[str, Any]]:
    """Kaynak veri. Bu fonksiyonun yazan bir eşi YOK ve olmayacak."""
    yol = _katalog_yolu()
    try:
        damga = os.path.getmtime(yol)
    except OSError:
        return []
    # Dosya değişmediyse yeniden okumuyoruz; her panel açılışında 10 KB JSON
    # ayrıştırmanın anlamı yok.
    if damga == _KATALOG["ts"] and _KATALOG["veri"]:
        return _KATALOG["veri"]
    try:
        with open(yol, encoding="utf-8") as dosya:
            veri = json.load(dosya)
    except (json.JSONDecodeError, OSError):
        return []
    if not isinstance(veri, list):
        return []
    _KATALOG.update(ts=damga, veri=veri)
    return veri


# --------------------------------------------------------------------------- #
# 2. katman — tür düzeyinde ezmeler
# --------------------------------------------------------------------------- #
def _ezme_yolu() -> str:
    ozel = os.environ.get("TUR_EZME_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "tur_ezme.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "tur_ezme.json")


def ezmeler() -> dict[str, dict[str, float]]:
    yol = _ezme_yolu()
    with _KILIT:
        if not os.path.exists(yol):
            return {}
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            try:
                os.replace(yol, yol + ".bozuk")
            except OSError:
                pass
            return {}
        return veri.get("turler", {}) if isinstance(veri, dict) else {}


def _ezme_yaz(turler: dict[str, dict[str, float]]) -> None:
    yol = _ezme_yolu()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                             prefix=".tur-", suffix=".tmp", delete=False)
        try:
            json.dump({"surum": 1, "turler": turler}, gecici, ensure_ascii=False, indent=1)
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


def alan_dogrula(alan: str, deger: Any) -> float:
    if alan not in DUZENLENEBILIR:
        raise TurHatasi(f"'{alan}' düzenlenebilir bir alan değil "
                        f"(düzenlenebilenler: {', '.join(DUZENLENEBILIR)})")
    try:
        sayi = float(deger)
    except (TypeError, ValueError):
        raise TurHatasi(f"{BASLIK[alan]} sayı olmalı")
    alt, ust = SINIR[alan]
    if not alt <= sayi <= ust:
        raise TurHatasi(f"{BASLIK[alan]} {alt:g} ile {ust:g} {BIRIM[alan]} arasında olmalı "
                        f"(verilen: {sayi:g})")
    return sayi


def ezme_dogrula(alanlar: dict[str, Any]) -> dict[str, float]:
    return {a: alan_dogrula(a, d) for a, d in (alanlar or {}).items() if d is not None}


def kaydet(slug: str, alanlar: dict[str, Any]) -> dict[str, Any]:
    """Tür düzeyinde ezme yazar. Katalog dosyasına DOKUNMUYOR."""
    slug = str(slug or "").strip()
    if not any(t.get("slug") == slug for t in katalog()):
        raise TurHatasi(f"'{slug}' adında bir tür yok")
    temiz = ezme_dogrula(alanlar)
    with _KILIT:
        hepsi_ezme = ezmeler()
        mevcut = dict(hepsi_ezme.get(slug, {}))
        mevcut.update(temiz)
        # Katalogdakiyle aynı değer ezme sayılmıyor: "türden farklı" işareti
        # gerçekten farklı olanı göstersin.
        kaynak = next((t for t in katalog() if t.get("slug") == slug), {})
        mevcut = {a: d for a, d in mevcut.items()
                  if kaynak.get(a) is None or float(kaynak.get(a)) != d}
        if mevcut:
            hepsi_ezme[slug] = mevcut
        else:
            hepsi_ezme.pop(slug, None)
        _ezme_yaz(hepsi_ezme)
    return bul(slug)


def sifirla(slug: str, alan: str | None = None) -> dict[str, Any]:
    """Bir alanı ya da türün bütün ezmelerini katalog değerine döndürür."""
    slug = str(slug or "").strip()
    with _KILIT:
        hepsi_ezme = ezmeler()
        if alan:
            if alan not in DUZENLENEBILIR:
                raise TurHatasi(f"'{alan}' düzenlenebilir bir alan değil")
            mevcut = dict(hepsi_ezme.get(slug, {}))
            mevcut.pop(alan, None)
            if mevcut:
                hepsi_ezme[slug] = mevcut
            else:
                hepsi_ezme.pop(slug, None)
        else:
            hepsi_ezme.pop(slug, None)
        _ezme_yaz(hepsi_ezme)
    return bul(slug)


# --------------------------------------------------------------------------- #
# Birleştirme
# --------------------------------------------------------------------------- #
def hepsi() -> list[dict[str, Any]]:
    """Katalog + tür ezmeleri. Her tür `ezili` alanıyla geliyor.

    `ezili` = {alan: katalogdaki_deger}. Panel bununla hem "türden farklı"
    işaretini koyuyor hem de "geri al" düğmesinde neye dönüleceğini biliyor.
    """
    ez = ezmeler()
    cikti = []
    for ham in katalog():
        tur = dict(ham)
        slug = tur.get("slug")
        ezili = {}
        for alan, deger in (ez.get(slug) or {}).items():
            if alan not in DUZENLENEBILIR:
                continue
            ezili[alan] = ham.get(alan)          # katalogdaki hâli
            tur[alan] = deger
        tur["ezili"] = ezili
        cikti.append(tur)
    return cikti


def bul(slug: str) -> dict[str, Any] | None:
    slug = str(slug or "").strip()
    return next((t for t in hepsi() if t.get("slug") == slug), None)


def alan_bilgisi() -> dict[str, Any]:
    """Panelin form kurarken kullandığı alan tanımları."""
    return {a: {"baslik": BASLIK[a], "birim": BIRIM[a],
                "alt": SINIR[a][0], "ust": SINIR[a][1]}
            for a in DUZENLENEBILIR}
