"""Tüm bitkileri kapsayan sulama süresi — açıkken tür ayarını eziyor.

NİYE VAR. Süre zaten bitki başına çözülüyor (`sulama.ayar_coz`: bitkinin
`ozel` alanı > tür ezmesi > varsayılan) ve bu doğru düzen; fide ile olgun
bir marul aynı suyu istemiyor. Ama "bugün hepsine 8 saniye ver" demenin
yolu yoktu: ya her türün ayarını tek tek değiştirecektin ya da paneldeki
tek atımlık süreyi her seferinde yeniden yazacaktın.

TÜRE ÖZGÜ AYAR SİLİNMİYOR. Bu anahtar kapatıldığı an her bitki yine kendi
zincirinden çözülüyor — üstüne yazmıyor, ÖNÜNE geçiyor. Tür ayarlarını
toplu değiştirmek geri dönüşü olmayan bir işlem olurdu.

ÖNCELİK SIRASI:
    1. İstekte açıkça verilen süre   (tek atımlık deneme, panelin alanı)
    2. BU AYAR, açıksa               (tüm bitkiler)
    3. Bitki `ozel` > tür ezmesi > varsayılan
İsteğin üstte kalması bilinçli: kullanıcı o an bir sayı yazdıysa kastı
açık, kayıtlı bir anahtarın onu sessizce ezmesi şaşırtırdı.

SUNUCUDA TUTULUYOR. Tarayıcıda tutulsaydı zamanlı görevler ve "ölç, düşükse
sula" işi bu ayarı hiç görmezdi — panel kapalıyken çalışıyorlar. "Tüm
bitkileri kapsıyor" demek, panelden başlatılmayan sulamaları da kapsamak
demek.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

from fastapi import APIRouter, HTTPException, Query

_KILIT = threading.RLock()

#: Sınırlar `main._istek_saniye` ile AYNI. Ayrışsalardı panelden 90 sn
#: yazılabilir, aynı sayı istek alanından 60'a kırpılırdı ve hangisinin
#: geçerli olduğu kullanıcıya görünmezdi.
EN_AZ_SANIYE = 0.5
EN_COK_SANIYE = 60.0

VARSAYILAN: dict[str, Any] = {"acik": False, "saniye": 5.0}


def _yol() -> str:
    ozel = os.environ.get("SULAMA_GENEL_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "sulama_genel.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "sulama_genel.json")


def _kirp(ham: Any) -> float:
    try:
        deger = float(ham)
    except (TypeError, ValueError):
        return float(VARSAYILAN["saniye"])
    if deger != deger:                      # NaN
        return float(VARSAYILAN["saniye"])
    return max(EN_AZ_SANIYE, min(EN_COK_SANIYE, deger))


def oku() -> dict[str, Any]:
    """{"acik": bool, "saniye": float}. Dosya yoksa varsayılan."""
    yol = _yol()
    with _KILIT:
        if not os.path.exists(yol):
            return dict(VARSAYILAN)
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            # Bozuk dosya sessizce yutulmuyor, yanına taşınıyor.
            try:
                os.replace(yol, yol + ".bozuk")
            except OSError:
                pass
            return dict(VARSAYILAN)
    if not isinstance(veri, dict):
        return dict(VARSAYILAN)
    return {"acik": bool(veri.get("acik")), "saniye": _kirp(veri.get("saniye"))}


def _yaz(durum: dict[str, Any]) -> None:
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        gecici = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=klasor, prefix=".sulama-genel-",
            suffix=".tmp", delete=False)
        try:
            json.dump({"surum": 1, "acik": bool(durum["acik"]),
                       "saniye": float(durum["saniye"])},
                      gecici, ensure_ascii=False, indent=1)
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


def yaz(acik: Any, saniye: Any) -> dict[str, Any]:
    """Anahtarı ve süreyi kaydeder; kırpılmış hâlini döner.

    SÜRE ANAHTAR KAPALIYKEN DE SAKLANIYOR: kullanıcı kapatıp açtığında
    yazdığı sayıyı yeniden aramasın.
    """
    simdiki = oku()
    yeni = {"acik": bool(acik),
            "saniye": _kirp(simdiki["saniye"] if saniye in (None, "") else saniye)}
    _yaz(yeni)
    return yeni


def saniye() -> float | None:
    """Açıksa süre, kapalıysa None.

    None dönmesi şart: 0 dönseydi "sulama yok" ile "ayar kapalı" aynı
    sayıya düşerdi ve çağıran ikisini ayıramazdı.
    """
    durum = oku()
    return float(durum["saniye"]) if durum["acik"] else None


def yonlendirici_kur(parola_dogrula) -> APIRouter:
    """Uçları kurar. `main` içe aktarılmıyor — bağımlılık dışarıdan."""
    yonlendirici = APIRouter(prefix="/api/sulama/genel", tags=["sulama"])

    @yonlendirici.get("")
    async def genel_oku(jeton: str = Query(default="")):
        parola_dogrula(jeton)
        durum = oku()
        return {**durum, "en_az": EN_AZ_SANIYE, "en_cok": EN_COK_SANIYE}

    @yonlendirici.post("")
    async def genel_yaz(govde: dict[str, Any] | None = None,
                        jeton: str = Query(default="")):
        """{"acik": true, "saniye": 8} — ikisi de isteğe bağlı."""
        parola_dogrula(jeton)
        istek = govde or {}
        if "acik" not in istek and "saniye" not in istek:
            raise HTTPException(status_code=400,
                                detail="acik ya da saniye verilmeli")
        simdiki = oku()
        durum = yaz(istek.get("acik", simdiki["acik"]), istek.get("saniye"))
        return {**durum, "en_az": EN_AZ_SANIYE, "en_cok": EN_COK_SANIYE}

    return yonlendirici
