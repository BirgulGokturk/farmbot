# -*- coding: utf-8 -*-
"""Bitki ışığı — gece besleme takvimi (Arduino D11).

NEDEN SUNUCUDA. Kartta saat yok. Uno'da RTC de yok; açılıştan beri geçen
milisaniye var, o kadar. "Gece 00.00–06.00" diyebilmek için takvimi saati
OLAN bir yerin tutması gerekiyor ve o yer Pi.

Kart takvimi bilmiyor, yalnız `ROLE isik <0|1>` alıyor. Böylece kart
sıfırlandığında (pompa çekişinde oluyor) ışık sönüyor ve sunucu en geç
otuz saniye içinde geri yakıyor. Kartın takvimi tutması hâlinde aynı
sıfırlama, saati de sıfırlardı ve ışık yanlış saatte yanardı.

KARTIN KENDİ ÇIKTISI TEK DOĞRU KAYNAK. Döngü "komutu gönderdim, demek
yanıyor" demiyor: her bakışta ölçüm paketindeki `r_isik`e bakıyor ve
istenenle tutmuyorsa yeniden yolluyor. Gönderilmiş ama düşmüş bir komut
böylece kendiliğinden düzeliyor.

EL İLE AÇMA BİR SONRAKİ TAKVİM DEĞİŞİMİNE KADAR. "Şimdi yak" deyip
takvimi tamamen kapatmak, ertesi gün ışığın hiç yanmadığını fark etmekle
sonuçlanır. Elle verilen karar, takvimin bir sonraki AÇ/KAPA anına kadar
geçerli; o an gelince takvim kendiliğinden devralıyor. Panelde hangi
kipte olduğu yazıyor.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import threading
import time
from typing import Any

logger = logging.getLogger("tarim.isik")

#: Takvime ne sıklıkla bakılıyor. Bir dakikalık çözünürlükte bir takvim
#: için otuz saniye yeterli: en kötü durumda ışık yarım dakika geç yanar.
BAKMA_SN = 30.0

#: Kart durumu okunamıyorsa komut bu aralıkla yineleniyor. Ölçüm paketi
#: gelmiyorsa "gönderdim" demek tek dayanağımız kalıyor ve o dayanak,
#: araya giren bir kart sıfırlamasını göremiyor.
YENILEME_SN = 300.0

VARSAYILAN: dict[str, Any] = {
    # Takvim etkin mi. Kapalıyken ışık yalnız elle yakılıyor.
    "acik": True,
    # Gece besleme aralığı. Kullanıcının istediği: 00.00 – 06.00.
    "bas": "00:00",
    "bit": "06:00",
}

_KILIT = threading.RLock()
_bellek: dict[str, Any] | None = None

# Elle verilen karar. None = takvim yönetiyor.
# {"durum": bool, "takvim": bool}  — `takvim`, karar verildiği ANDA
# takvimin ne istediği; takvim bundan farklı bir şey isteyince el kalkıyor.
_elle: dict[str, Any] | None = None

_son_hedef: bool | None = None
_son_gonderim: float = 0.0


class IsikHatasi(Exception):
    """Geçersiz saat ya da geçersiz alan."""


def _yol() -> str:
    ozel = os.environ.get("ISIK_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "isik.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "isik.json")


def _dakika(metin: Any, alan: str) -> int:
    """"SS:DD" -> gün içindeki dakika. Serbest metin kabul edilmiyor."""
    ham = str(metin or "").strip()
    parca = ham.split(":")
    if len(parca) != 2:
        raise IsikHatasi(f"{alan}: saat 'SS:DD' biçiminde olmalı (örn. 00:00)")
    try:
        s, d = int(parca[0]), int(parca[1])
    except ValueError:
        raise IsikHatasi(f"{alan}: saat 'SS:DD' biçiminde olmalı (örn. 00:00)")
    if not (0 <= s <= 23 and 0 <= d <= 59):
        raise IsikHatasi(f"{alan}: saat 00:00 ile 23:59 arasında olmalı")
    return s * 60 + d


def _saat(dakika: int) -> str:
    return f"{dakika // 60:02d}:{dakika % 60:02d}"


def _temiz(ham: Any) -> dict[str, Any]:
    h = ham if isinstance(ham, dict) else {}
    bas = _dakika(h.get("bas", VARSAYILAN["bas"]), "Başlangıç")
    bit = _dakika(h.get("bit", VARSAYILAN["bit"]), "Bitiş")
    if bas == bit:
        raise IsikHatasi("Başlangıç ve bitiş aynı olamaz — bu aralık hiç "
                         "yanmayan bir ışık demek.")
    return {"acik": bool(h.get("acik", True)), "bas": _saat(bas), "bit": _saat(bit)}


def oku() -> dict[str, Any]:
    global _bellek
    with _KILIT:
        if _bellek is not None:
            return dict(_bellek)
        yol = _yol()
        veri = dict(VARSAYILAN)
        if os.path.exists(yol):
            try:
                with open(yol, encoding="utf-8") as d:
                    veri = _temiz(json.load(d))
            except (OSError, ValueError, IsikHatasi) as hata:
                # BOZUK DOSYA SESSİZCE VARSAYILANA DÜŞMÜYOR: ışığın neden
                # beklenen saatte yanmadığı, günlükte yazmalı.
                logger.warning("isik.json okunamadı, varsayılan kullanılıyor: %s", hata)
                veri = dict(VARSAYILAN)
        _bellek = veri
        return dict(veri)


def _yaz(veri: dict[str, Any]) -> None:
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                         prefix=".isik-", suffix=".tmp", delete=False)
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


def kaydet(ham: Any) -> dict[str, Any]:
    global _bellek
    veri = _temiz(ham)
    with _KILIT:
        _yaz(veri)
        _bellek = veri
    return dict(veri)


def takvim_istiyor(ayar: dict[str, Any] | None = None,
                   simdi: float | None = None) -> bool:
    """Takvime göre ışık şu an yanmalı mı? Gece aşan aralık destekleniyor."""
    a = ayar or oku()
    if not a.get("acik"):
        return False
    bas, bit = _dakika(a["bas"], "Başlangıç"), _dakika(a["bit"], "Bitiş")
    if bas == bit:
        return False
    t = time.localtime(simdi if simdi is not None else time.time())
    n = t.tm_hour * 60 + t.tm_min
    # 22:00–06:00 gibi gece yarısını aşan aralık: iki parçanın birleşimi.
    return (bas <= n < bit) if bas < bit else (n >= bas or n < bit)


def elle_kur(durum: bool | None) -> dict[str, Any]:
    """`None` = takvime dön. Aksi hâlde bir sonraki takvim değişimine kadar."""
    global _elle
    with _KILIT:
        if durum is None:
            _elle = None
        else:
            _elle = {"durum": bool(durum), "takvim": takvim_istiyor()}
    return durum_ozeti()


def _hedef() -> tuple[bool, str]:
    """(ışık yanmalı mı, gerekçe). Elin süresi dolduysa burada düşüyor."""
    global _elle
    ayar = oku()
    takvim = takvim_istiyor(ayar)
    with _KILIT:
        el = dict(_elle) if _elle else None
        if el is not None and bool(el["takvim"]) != takvim:
            # Takvim bir AÇ/KAPA anından geçti: el kalkıyor.
            _elle = None
            el = None
    if el is not None:
        return bool(el["durum"]), ("elle açıldı" if el["durum"] else "elle kapatıldı")
    if not ayar.get("acik"):
        return False, "takvim kapalı"
    return takvim, (f"takvimde ({ayar['bas']}–{ayar['bit']})" if takvim
                    else f"takvim dışı ({ayar['bas']}–{ayar['bit']})")


def durum_ozeti(kart: Any = None) -> dict[str, Any]:
    ayar = oku()
    hedef, gerekce = _hedef()
    with _KILIT:
        el = dict(_elle) if _elle else None
    return {
        "ayar": ayar,
        "istenen": hedef,
        "gerekce": gerekce,
        "takvim": takvim_istiyor(ayar),
        "elle": None if el is None else bool(el["durum"]),
        "kart": None if kart is None else int(kart),
        "son_gonderim": _son_gonderim or None,
    }


async def dongu(komut_yolla, olcum_al) -> None:
    """`komut_yolla(ad, arg)` ajana komut atıyor, `olcum_al()` son ölçüm.

    Görev sunucuyla birlikte başlıyor ve DURMUYOR: elle başlatılması
    gereken bir gece aydınlatması, sabaha kadar karanlık kalmış bir
    aydınlatmadır. (`zamanli.py` bilerek tersini yapıyor — orada tik
    makineyi HAREKET ettiriyor, burada yalnız bir çıkış sürülüyor.)
    """
    global _son_hedef, _son_gonderim
    while True:
        try:
            hedef, _ = _hedef()
            olcum = (olcum_al() or {}) if callable(olcum_al) else {}
            ham = olcum.get("r_isik")
            kart = None
            if ham is not None:
                try:
                    kart = int(ham)
                except (TypeError, ValueError):
                    kart = None

            simdi = time.time()
            if kart is not None:
                gonder = kart != int(hedef)
            else:
                gonder = (_son_hedef != hedef
                          or (simdi - _son_gonderim) >= YENILEME_SN)

            if gonder:
                await komut_yolla("role", {"ad": "isik", "durum": bool(hedef)})
                _son_hedef = hedef
                _son_gonderim = simdi
        except asyncio.CancelledError:
            raise
        except Exception:                                   # noqa: BLE001
            # Ajan kopuksa komut atılamıyor; döngü ölmüyor, sonraki
            # bakışta yeniden deniyor.
            logger.debug("ışık döngüsü tik atladı", exc_info=True)
        await asyncio.sleep(BAKMA_SN)


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def yonlendirici_kur(parola_dogrula, olcum_al):
    from fastapi import APIRouter, HTTPException, Query

    yon = APIRouter()

    def _kart() -> Any:
        return ((olcum_al() or {}) if callable(olcum_al) else {}).get("r_isik")

    @yon.get("/api/isik")
    async def _durum(jeton: str = Query(default="")):
        parola_dogrula(jeton)
        return durum_ozeti(_kart())

    @yon.post("/api/isik")
    async def _kaydet(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        parola_dogrula(jeton)
        try:
            kaydet(govde or {})
        except IsikHatasi as hata:
            raise HTTPException(status_code=422, detail=str(hata))
        # Takvim değişti: elle verilmiş karar da düşüyor, yoksa yeni
        # takvim ilk değişimine kadar hiç uygulanmaz.
        elle_kur(None)
        return durum_ozeti(_kart())

    @yon.post("/api/isik/elle")
    async def _elle(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        parola_dogrula(jeton)
        g = govde or {}
        if g.get("otomatik"):
            return elle_kur(None)
        if "durum" not in g:
            raise HTTPException(status_code=422,
                                detail="durum (true/false) ya da otomatik: true gerekli")
        return elle_kur(bool(g.get("durum")))

    return yon
