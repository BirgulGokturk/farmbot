"""Kayıtlı programlar — adım listeleri.

Noktalar gibi burada da JSON: küçük, bütün okunup bütün yazılan bir veri.
Gerekçenin tamamı `noktalar.py` başında.

Bu modülün ikinci işi **çözümleme**: program adımları nokta *adı* tutuyor,
ajana ise koordinat gidiyor. Ajan nokta deposunu bilmediği için diziyi
başlatırken isimleri burada koordinata çeviriyoruz. Böylece bir noktanın adı
değişse bile süren dizi bozulmuyor ve ajanın durumu küçük kalıyor.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

import noktalar

_KILIT = threading.RLock()
AZAMI_ADIM = 200
GECERLI_TIPLER = ("nokta", "bekle", "role", "servo", "uc")


class ProgramHatasi(Exception):
    """Geçersiz program tanımı ya da çözülemeyen nokta."""


def _yol() -> str:
    ozel = os.environ.get("PROGRAM_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "programlar.json")
    return os.path.join(os.path.dirname(__file__), "programlar.json")


def oku() -> dict[str, Any]:
    yol = _yol()
    with _KILIT:
        if not os.path.exists(yol):
            return {"surum": 1, "programlar": []}
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            try:
                os.replace(yol, yol + ".bozuk")
            except OSError:
                pass
            return {"surum": 1, "programlar": []}
        if not isinstance(veri.get("programlar"), list):
            return {"surum": 1, "programlar": []}
        return veri


def yaz(veri: dict[str, Any]) -> None:
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                             prefix=".prog-", suffix=".tmp", delete=False)
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


def adim_dogrula(adim: dict[str, Any]) -> dict[str, Any]:
    tip = str(adim.get("tip", ""))
    if tip not in GECERLI_TIPLER:
        raise ProgramHatasi(f"Bilinmeyen adım tipi: '{tip}'")
    if tip == "nokta":
        ad = str(adim.get("ad", "")).strip()
        if not ad:
            raise ProgramHatasi("Nokta adımı bir nokta adı ister")
        return {"tip": "nokta", "ad": ad}
    if tip == "bekle":
        return {"tip": "bekle", "saniye": max(0.0, min(600.0, float(adim.get("saniye", 1))))}
    if tip == "role":
        ad = str(adim.get("ad", ""))
        if ad not in ("su_pompasi", "hava_pompasi", "su_vanasi"):
            raise ProgramHatasi(f"Bilinmeyen röle: '{ad}'")
        return {"tip": "role", "ad": ad, "durum": bool(adim.get("durum"))}
    if tip == "servo":
        aci = int(adim.get("aci", 0))
        if not 0 <= aci <= 180:
            raise ProgramHatasi("Servo açısı 0-180 arasında olmalı")
        return {"tip": "servo", "aci": aci}
    return {"tip": "uc", "ad": str(adim.get("ad", "") or "")}


def hepsi() -> list[dict[str, Any]]:
    return oku()["programlar"]


def bul(ad: str) -> dict[str, Any] | None:
    ad = str(ad or "").strip()
    return next((p for p in hepsi() if p.get("ad") == ad), None)


def kaydet(ad: str, adimlar: list[dict[str, Any]], tekrar: int = 1) -> dict[str, Any]:
    ad = str(ad or "").strip()
    if not ad:
        raise ProgramHatasi("Program adı boş olamaz")
    if not isinstance(adimlar, list) or not adimlar:
        raise ProgramHatasi("Programda en az bir adım olmalı")
    if len(adimlar) > AZAMI_ADIM:
        raise ProgramHatasi(f"En fazla {AZAMI_ADIM} adım olabilir")

    program = {
        "ad": ad[:40],
        "adimlar": [adim_dogrula(a) for a in adimlar],
        "tekrar": max(1, min(1000, int(tekrar or 1))),
    }
    with _KILIT:
        veri = oku()
        mevcut = next((i for i, p in enumerate(veri["programlar"]) if p.get("ad") == program["ad"]), None)
        if mevcut is not None:
            veri["programlar"][mevcut] = program
        else:
            veri["programlar"].append(program)
        yaz(veri)
    return program


def sil(ad: str) -> bool:
    ad = str(ad or "").strip()
    with _KILIT:
        veri = oku()
        once = len(veri["programlar"])
        veri["programlar"] = [p for p in veri["programlar"] if p.get("ad") != ad]
        if len(veri["programlar"]) == once:
            return False
        yaz(veri)
    return True


def coz(program: dict[str, Any]) -> list[dict[str, Any]]:
    """Nokta adlarını koordinata çevirir — ajana bu hâli gidiyor.

    Eksik bir nokta diziyi ortasında durdurmasın diye çözümleme **başlamadan
    önce** yapılıyor: bir isim bulunamazsa dizi hiç başlamıyor.
    """
    cozulmus = []
    eksik = []
    for adim in program.get("adimlar", []):
        if adim.get("tip") != "nokta":
            cozulmus.append(dict(adim))
            continue
        nokta = noktalar.bul(adim["ad"])
        if nokta is None:
            eksik.append(adim["ad"])
            continue
        cozulmus.append({"tip": "nokta", "ad": nokta["ad"],
                         "x": nokta["x"], "y": nokta["y"], "z": nokta["z"]})
    if eksik:
        raise ProgramHatasi("Şu noktalar bulunamadı: " + ", ".join(sorted(set(eksik))))
    return cozulmus
