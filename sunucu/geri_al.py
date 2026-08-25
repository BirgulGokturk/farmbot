"""Silinen noktalar için geri alma penceresi.

Silme onay penceresiyle korunuyordu ama onay, yanlış seçimi düzeltmiyor:
"12 nokta silinecek, emin misiniz?" sorusuna evet dedikten sonra hangi 12
olduğunu görmenin yolu yok. Onun yerine silme HEMEN uygulanıyor, silinen
kayıtlar bir süre burada bekliyor ve panel "geri al" diyebiliyor.

Neden bellekte: pencere 30 saniye. Sunucu yeniden başlarsa geri alınabilir
silme kalmaz — bu doğru davranış, 30 saniyelik bir tamponu diske yazıp
kurtarmaya çalışmak, çözdüğünden çok sorun getirir.

Nokta deposundan HEMEN çıkıyorlar: yarı silinmiş bir nokta diziye, sınır
denetimine ve haritaya "var" görünürdü. Geri alma, kaydı olduğu gibi
(ad, konum, etiket, tür, ekim tarihi, eğri bağları) geri yazıyor.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

# Pencere: yanlışlıkla silmeyi fark edip düğmeye basmaya yeter, ekranda
# unutulmuş bir şerit bırakacak kadar uzun değil.
PENCERE_SN = 30.0
# Aynı anda bekleyen parti sayısı. Fazlası bellekte birikmesin.
AZAMI_PARTI = 20

_KILIT = threading.RLock()
_PARTILER: dict[str, dict[str, Any]] = {}


def _temizle(simdi: float | None = None) -> None:
    """Süresi dolmuş partileri atıyor. Ayrı bir zamanlayıcı yok: her
    dokunuşta bakmak, 30 saniyelik bir pencere için yeterli ve daha basit."""
    simdi = time.time() if simdi is None else simdi
    with _KILIT:
        for kimlik in [k for k, p in _PARTILER.items() if p["biter"] <= simdi]:
            _PARTILER.pop(kimlik, None)


def ekle(noktalar: list[dict[str, Any]], aciklama: str = "") -> dict[str, Any]:
    """Silinen kayıtları geri alma penceresine koyar.

    `noktalar` nokta deposundan gelen TAM kayıtlar; geri alma bunları
    olduğu gibi geri yazıyor.
    """
    _temizle()
    kimlik = uuid.uuid4().hex[:12]
    parti = {
        "kimlik": kimlik,
        "noktalar": [dict(n) for n in noktalar],
        "aciklama": aciklama or f"{len(noktalar)} nokta silindi",
        "silindi": time.time(),
        "biter": time.time() + PENCERE_SN,
        "pencere": PENCERE_SN,
    }
    with _KILIT:
        if len(_PARTILER) >= AZAMI_PARTI:
            # En eskisi gitsin: zaten sürenin dolmasına en yakın olan o.
            en_eski = min(_PARTILER.values(), key=lambda p: p["biter"])
            _PARTILER.pop(en_eski["kimlik"], None)
        _PARTILER[kimlik] = parti
    return ozet(parti)


def ozet(parti: dict[str, Any]) -> dict[str, Any]:
    """Panele giden hâli — nokta kayıtlarının tamamı gitmiyor, adları yeter."""
    return {
        "kimlik": parti["kimlik"],
        "aciklama": parti["aciklama"],
        "adet": len(parti["noktalar"]),
        "adlar": [n.get("ad") for n in parti["noktalar"]][:12],
        "kalan_sn": max(0.0, parti["biter"] - time.time()),
        "pencere": parti["pencere"],
    }


def al(kimlik: str) -> list[dict[str, Any]] | None:
    """Partiyi penceresinden ÇIKARIP kayıtlarını döndürür.

    Çıkarmak şart: aynı geri almanın iki kez çalışması, ikinci seferde
    "aynı isim zaten var" hatası verirdi.
    """
    _temizle()
    with _KILIT:
        parti = _PARTILER.pop(str(kimlik or ""), None)
    return parti["noktalar"] if parti else None


def bekleyenler() -> list[dict[str, Any]]:
    _temizle()
    with _KILIT:
        return [ozet(p) for p in sorted(_PARTILER.values(), key=lambda p: p["silindi"])]


def sifirla() -> None:
    """Yalnız testler için."""
    with _KILIT:
        _PARTILER.clear()
