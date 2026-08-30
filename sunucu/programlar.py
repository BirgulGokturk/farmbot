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
import re
import tempfile
import threading
from typing import Any

import noktalar

_KILIT = threading.RLock()
AZAMI_ADIM = 200
GECERLI_TIPLER = ("nokta", "bekle", "role", "uc")

# Değişken tipleri. FarmBot'ta Location/Number/Text/Peripheral/Sensor/Sequence
# var; bizde işi gören üçü: bir noktayı, bir sayıyı ve bir metni dışarıdan
# vermek. Asıl kazanç "nokta": tek bir "sula" dizisi 40 ayrı bitkiye
# uygulanabiliyor.
GECERLI_DEGISKEN_TIPLERI = ("nokta", "sayi", "metin")
AZAMI_DEGISKEN = 8

# Adım alanında "$ad" yazılırsa oraya değişkenin değeri konuyor.
_DEGISKEN_DESENI = re.compile(r"^\$([A-Za-z_][A-Za-z0-9_]*)$")



class ProgramHatasi(Exception):
    """Geçersiz program tanımı ya da çözülemeyen nokta."""


class EksikDegisken(ProgramHatasi):
    """Dizi bir değişken istiyor ama değeri verilmemiş."""


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


def degisken_mi(deger: Any) -> str | None:
    """Bir alan "$ad" biçiminde mi? Öyleyse değişken adını döndürür."""
    if not isinstance(deger, str):
        return None
    eslesme = _DEGISKEN_DESENI.match(deger.strip())
    return eslesme.group(1) if eslesme else None


def degisken_dogrula(d: dict[str, Any]) -> dict[str, Any]:
    ad = str(d.get("ad", "")).strip()
    if not _DEGISKEN_DESENI.match("$" + ad):
        raise ProgramHatasi(
            f"Geçersiz değişken adı: '{ad}' — harf ya da _ ile başlamalı, "
            "harf/rakam/_ içerebilir")
    tip = str(d.get("tip", "nokta"))
    if tip not in GECERLI_DEGISKEN_TIPLERI:
        raise ProgramHatasi(f"Bilinmeyen değişken tipi: '{tip}'")
    return {"ad": ad, "tip": tip, "aciklama": str(d.get("aciklama", ""))[:80]}


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
        # "$sure" gibi bir değişken referansı olduğu gibi saklanıyor; sayıya
        # çevirme işi diziyi çalıştırırken, değer bilindiğinde yapılıyor.
        if degisken_mi(adim.get("saniye")):
            return {"tip": "bekle", "saniye": str(adim["saniye"]).strip()}
        return {"tip": "bekle", "saniye": max(0.0, min(600.0, float(adim.get("saniye", 1))))}
    if tip == "role":
        ad = str(adim.get("ad", ""))
        if ad not in ("su_pompasi", "hava_pompasi"):
            raise ProgramHatasi(f"Bilinmeyen röle: '{ad}'")
        return {"tip": "role", "ad": ad, "durum": bool(adim.get("durum"))}
    return {"tip": "uc", "ad": str(adim.get("ad", "") or "")}


def hepsi() -> list[dict[str, Any]]:
    return oku()["programlar"]


def bul(ad: str) -> dict[str, Any] | None:
    ad = str(ad or "").strip()
    return next((p for p in hepsi() if p.get("ad") == ad), None)


def kaydet(ad: str, adimlar: list[dict[str, Any]], tekrar: int = 1,
           degiskenler: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    ad = str(ad or "").strip()
    if not ad:
        raise ProgramHatasi("Program adı boş olamaz")
    if not isinstance(adimlar, list) or not adimlar:
        raise ProgramHatasi("Programda en az bir adım olmalı")
    if len(adimlar) > AZAMI_ADIM:
        raise ProgramHatasi(f"En fazla {AZAMI_ADIM} adım olabilir")

    ham_degisken = list(degiskenler or [])
    if len(ham_degisken) > AZAMI_DEGISKEN:
        raise ProgramHatasi(f"En fazla {AZAMI_DEGISKEN} değişken tanımlanabilir")
    cozulmus_degisken = [degisken_dogrula(d) for d in ham_degisken]
    adlar = [d["ad"] for d in cozulmus_degisken]
    if len(set(adlar)) != len(adlar):
        raise ProgramHatasi("Aynı değişken adı iki kez tanımlanamaz")

    program = {
        "ad": ad[:40],
        "degiskenler": cozulmus_degisken,
        "adimlar": [adim_dogrula(a) for a in adimlar],
        "tekrar": max(1, min(1000, int(tekrar or 1))),
    }

    # Adımlarda geçen ama tanımlanmamış bir değişken, dizi çalıştırılana kadar
    # fark edilmezdi. Kaydederken söylüyoruz.
    bilinmeyen = sorted({
        d for adim in program["adimlar"] for alan in ("ad", "saniye", "aci")
        if (d := degisken_mi(adim.get(alan))) and d not in adlar
    })
    if bilinmeyen:
        raise ProgramHatasi(
            "Adımlarda tanımlanmamış değişken var: " + ", ".join("$" + b for b in bilinmeyen))
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


def degiskenleri_yerlestir(program: dict[str, Any],
                           degerler: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Adımlardaki "$ad" referanslarını verilen değerlerle değiştirir.

    Dizi çalıştırılmadan ÖNCE yapılıyor: değeri verilmemiş bir değişken varsa
    dizi hiç başlamıyor. Yarıda "değer yok" diye durmaktansa.
    """
    degerler = dict(degerler or {})
    tanimli = {d["ad"]: d for d in program.get("degiskenler", [])}

    # Değeri verilmemiş değişken var mı?
    eksik = [ad for ad in tanimli if ad not in degerler or degerler[ad] in ("", None)]
    if eksik:
        raise EksikDegisken("Şu değişkenlerin değeri verilmedi: "
                            + ", ".join("$" + a for a in sorted(eksik)))

    def coz_alan(deger: Any) -> Any:
        ad = degisken_mi(deger)
        if ad is None:
            return deger
        if ad not in degerler:
            raise EksikDegisken(f"'${ad}' değişkeninin değeri verilmedi")
        return degerler[ad]

    yerlesmis = []
    for ham in program.get("adimlar", []):
        adim = dict(ham)
        for alan in ("ad", "saniye", "aci"):
            if alan in adim:
                adim[alan] = coz_alan(adim[alan])
        # Değişkenden gelen sayılar metin olabilir; adım doğrulaması sayıya
        # çevirsin ve sınırları uygulasın.
        yerlesmis.append(adim_dogrula(adim))
    return yerlesmis


def coz(program: dict[str, Any],
        degerler: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Değişkenleri yerleştirir, sonra nokta adlarını koordinata çevirir.

    Ajana bu hâli gidiyor. Eksik bir nokta ya da değeri verilmemiş bir
    değişken diziyi ortasında durdurmasın diye çözümleme **başlamadan önce**
    yapılıyor: biri bile eksikse dizi hiç başlamıyor.
    """
    adimlar = degiskenleri_yerlestir(program, degerler)
    cozulmus = []
    eksik = []
    for adim in adimlar:
        if adim.get("tip") != "nokta":
            cozulmus.append(dict(adim))
            continue
        # ÖNCEDEN ÇÖZÜLMÜŞ adım: x/y/z zaten dolu. Sulama ofseti böyle
        # geliyor — koordinat bitkinin kendi konumu DEĞİL, ofsetli sulama
        # noktası, ve depoya bakmak onu bitkinin üstüne geri çekerdi.
        # Kayıtlı programların adımları koordinat taşımıyor, onlar eskisi
        # gibi isimden çözülüyor.
        if all(adim.get(k) is not None for k in ("x", "y", "z")):
            cozulmus.append({"tip": "nokta", "ad": adim.get("ad", ""),
                             "x": float(adim["x"]), "y": float(adim["y"]),
                             "z": float(adim["z"])})
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
