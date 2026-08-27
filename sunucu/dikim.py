"""Dikim alanları — yatağın içinde toprağın GERÇEKTEN bulunduğu dikdörtgenler.

Neden gerekti
-------------
Makinede yatak baştan sona tek bir toprak alanı değil: iki ayrı kap var ve
aralarında boşluk bulunuyor. Panel şimdiye kadar yatağın tamamını toprak
sayıyordu, dolayısıyla sahnede "buraya bir marul koyalım" dediğimiz nokta
makinede havaya denk gelebiliyordu. Hata ayıklarken en çok yanıltan şey buydu.

Neden AJANDA değil SUNUCUDA
---------------------------
Yasak bölgeler ve uç ayarları ajanda duruyor, çünkü onlar GÜVENLİK kararı:
panel çökse bile makinenin kendini koruması gerekiyor. Dikim alanı güvenlik
kararı değil, VERİ GEÇERLİLİĞİ kararı — "bu noktaya bitki kaydedilir mi".
Üç sonucu var:

  1. Ajan bağlı değilken de çalışması gerekiyor. Ekim planı çoğu zaman robot
     kapalıyken yapılıyor; o sırada "alan bilinmiyor, her yeri kabul et"
     demek özelliği işlevsiz bırakırdı.
  2. Doğrulamanın yapıldığı yer sunucu (`POST /api/noktalar`, `/api/toplu`).
     Veriyi ajandan sormak, ajan kopukken doğrulamayı sessizce kapatırdı.
  3. `noktalar.json`, `programlar.json`, `egriler.json` zaten burada; alanlar
     onlarla birlikte yedekleniyor.

Robotun HAREKETİNİ hâlâ ajan sınırlıyor (yumuşak sınırlar + yasak bölgeler).
Bu dosya oraya karışmıyor.

Geriye uyum
-----------
Alan tanımlı değilse eski davranış aynen sürüyor: yatağın tamamı ekilebilir.
Mevcut kurulumlar güncelleme sonrası olduğu gibi çalışmaya devam etsin diye
"alan yok" hiçbir zaman "hiçbir yere ekilemez" anlamına gelmiyor.

Yazma atomik — `noktalar.py` ile aynı gerekçe.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

_KILIT = threading.RLock()

AZAMI_AD = 40
AZAMI_ALAN = 24          # yirmi dört kap bir Pi panelinde zaten okunmaz olur
EN_KUCUK_KENAR = 5.0     # mm — sıfır genişlikte alan çizilemez, tıklanamaz

# Ekim derinliği toprak yüzeyinden ölçülüyor; bu tavan `turler.SINIR` ile aynı.
AZAMI_DERINLIK = 200.0


class DikimHatasi(Exception):
    """Geçersiz alan tanımı."""


def _yol() -> str:
    ozel = os.environ.get("DIKIM_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "dikim_alanlari.json")
    return os.path.join(os.path.dirname(__file__), "dikim_alanlari.json")


def _bos() -> dict[str, Any]:
    return {"surum": 1, "alanlar": []}


def oku() -> dict[str, Any]:
    yol = _yol()
    with _KILIT:
        if not os.path.exists(yol):
            return _bos()
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (OSError, json.JSONDecodeError):
            # Bozuk dosya "alan yok" demek DEĞİL ama burada güvenli taraf
            # boş listedir: alan yoksa yatağın tamamı kabul ediliyor, yani
            # kullanıcı en kötü ihtimalle eski davranışa düşüyor, veri
            # kaybetmiyor. (Yasak bölgelerde tam tersi geçerli, orada boş
            # liste korumayı kaldırırdı ve bu yüzden eski liste korunuyor.)
            return _bos()
        if not isinstance(veri, dict) or not isinstance(veri.get("alanlar"), list):
            return _bos()
        return veri


def yaz(veri: dict[str, Any]) -> None:
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        gecici = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=klasor, prefix=".dikim-", suffix=".tmp", delete=False)
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


def _sayi(deger: Any, ad: str) -> float:
    try:
        return float(deger)
    except (TypeError, ValueError):
        raise DikimHatasi(f"{ad} sayı olmalı") from None


def alan_dogrula(ham: Any, sira: int = 0) -> dict[str, Any]:
    """Tek bir alanı normalleştirir.

    Köşeler sıralanıyor (x1 < x2): kullanıcı dikdörtgeni sağdan sola
    çizdiğinde içerik testi sessizce hep 'dışarıda' derdi.
    """
    if not isinstance(ham, dict):
        raise DikimHatasi("Alan bir nesne olmalı")
    ad = str(ham.get("ad") or "").strip()[:AZAMI_AD] or f"alan{sira + 1}"
    x1 = _sayi(ham.get("x1"), "x1")
    y1 = _sayi(ham.get("y1"), "y1")
    x2 = _sayi(ham.get("x2"), "x2")
    y2 = _sayi(ham.get("y2"), "y2")
    x1, x2 = min(x1, x2), max(x1, x2)
    y1, y2 = min(y1, y2), max(y1, y2)
    if x2 - x1 < EN_KUCUK_KENAR or y2 - y1 < EN_KUCUK_KENAR:
        raise DikimHatasi(
            f"'{ad}' alanının kenarı en az {EN_KUCUK_KENAR:.0f} mm olmalı "
            f"({x2 - x1:.1f} × {y2 - y1:.1f} mm girildi)")
    alan = {"ad": ad, "x1": round(x1, 1), "y1": round(y1, 1),
            "x2": round(x2, 1), "y2": round(y2, 1)}
    # Kaba kendi toprak yüksekliği İSTEĞE BAĞLI: girilmemişse ajanın genel
    # `plc.toprak_z` değeri geçerli. Kaplar aynı hizada değilse burada
    # ayrışıyorlar.
    if ham.get("toprak_z") not in (None, ""):
        alan["toprak_z"] = round(_sayi(ham.get("toprak_z"), "toprak_z"), 1)
    return alan


def listele() -> list[dict[str, Any]]:
    return oku()["alanlar"]


def kaydet(yeni: list[Any]) -> list[dict[str, Any]]:
    if not isinstance(yeni, list):
        raise DikimHatasi("alanlar bir liste olmalı")
    if len(yeni) > AZAMI_ALAN:
        raise DikimHatasi(f"En fazla {AZAMI_ALAN} dikim alanı tanımlanabilir")
    dogrulanmis = [alan_dogrula(a, i) for i, a in enumerate(yeni)]
    adlar = [a["ad"] for a in dogrulanmis]
    tekrar = {a for a in adlar if adlar.count(a) > 1}
    if tekrar:
        raise DikimHatasi("Aynı adda birden çok alan var: " + ", ".join(sorted(tekrar)))
    with _KILIT:
        yaz({"surum": 1, "alanlar": dogrulanmis})
    return dogrulanmis


# ------------------------------------------------------------------ sorgular

def alan_bul(x: float, y: float, alanlar: list[dict[str, Any]] | None = None):
    """Noktanın düştüğü alanı döndürür; hiçbirine düşmüyorsa None.

    Alan HİÇ tanımlı değilse `("*", None)` benzeri bir kaçış üretmiyoruz —
    o kararı çağıran veriyor (`nokta_kabul`), çünkü "alan yok" ile "alan var
    ama nokta dışında" birbirinden ayrı iki durum.
    """
    if alanlar is None:
        alanlar = listele()
    for a in alanlar:
        if a["x1"] <= x <= a["x2"] and a["y1"] <= y <= a["y2"]:
            return a
    return None


def nokta_kabul(x: float, y: float, alanlar: list[dict[str, Any]] | None = None
                ) -> tuple[bool, str, dict[str, Any] | None]:
    """(kabul, gerekçe, alan) — gerekçe yalnız reddedilirken dolu."""
    if alanlar is None:
        alanlar = listele()
    if not alanlar:
        return True, "", None          # tanımsız = eski davranış, yatağın tamamı
    bulundu = alan_bul(x, y, alanlar)
    if bulundu:
        return True, "", bulundu
    kutular = ", ".join(
        f"{a['ad']} (X {a['x1']:.0f}–{a['x2']:.0f}, Y {a['y1']:.0f}–{a['y2']:.0f})"
        for a in alanlar)
    return False, (f"X{x:.1f} Y{y:.1f} hiçbir dikim alanının içinde değil. "
                   f"Tanımlı alanlar: {kutular}"), None


def toprak_yuzeyi(x: float, y: float, genel_z: float,
                  alanlar: list[dict[str, Any]] | None = None) -> float:
    """Bu noktadaki toprak yüzeyinin makine Z'si.

    Alanın kendi `toprak_z` değeri varsa o, yoksa ajanın `plc.toprak_z`
    değeri. Ekim derinliği ve uç açıklığı BU yüzeyden hesaplanıyor —
    yüzey sıfırda değil, ölçülen kurulumda 110 mm civarında.
    """
    a = alan_bul(x, y, alanlar)
    if a and a.get("toprak_z") is not None:
        return float(a["toprak_z"])
    return float(genel_z or 0.0)


def ekim_z(x: float, y: float, genel_z: float, derinlik_mm: float = 0.0,
           alanlar: list[dict[str, Any]] | None = None) -> float:
    """Tohumun bırakılacağı makine Z'si: yüzey eksi ekim derinliği."""
    derinlik = max(0.0, min(AZAMI_DERINLIK, float(derinlik_mm or 0.0)))
    return round(toprak_yuzeyi(x, y, genel_z, alanlar) - derinlik, 2)
