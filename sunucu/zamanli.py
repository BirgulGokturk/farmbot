# -*- coding: utf-8 -*-
"""Zamanlanmış görevler — "şu işi şu aralıkla yap".

NEDEN VAR. Programlar vardı ama hepsi ELLE çalışıyordu: "her 15 dakikada
bir bütün bitkilerin nemini ölç" demenin yolu yoktu ve nem ölçümü ancak
biri panelin başındayken oluyordu.

BU MODÜL İŞ ÇALIŞTIRMIYOR. Zamanı geldiğinde bahçenin KENDİ iş kuyruğuna
bir iş koyuyor, o kadar. Kuyruk zaten mevcut yolları kullanıyor (aynı
çözümleme, aynı yasak bölge ön kontrolü, aynı sınır denetimi) — ikinci
bir hareket yolu açmak, güvenlik denetimlerinin yalnız birinden geçen bir
hareket demekti.

MEŞGULKEN TİK ATLANIYOR, BİRİKTİRİLMİYOR.
Makine kopukken ya da başka bir iş sürerken tik ATLANIYOR ve sebebi
yazılıyor. Kuyruğa koyup beklemek kolay olurdu ama sonucu şu: bir saatlik
kopukluk dört tik biriktirir ve bağlantı gelince makine dört kez üst üste
bütün bahçeyi dolaşır — kimsenin istemediği bir iş yığını. Yarıda kalan
bir dizi, hiç başlamamış bir diziden kötü; hiç başlamamış bir dizi de
istenmeden başlamış dört diziden iyi.

Kuyrukta bekleyen bir iş varsa da atlanıyor: aralık işin süresinden
kısaysa kuyruk sessizce şişer ve zamanlayıcı gerçekte "her 15 dakikada
bir" değil "durmadan" çalışır hâle gelirdi.

SUNUCU YENİDEN BAŞLAYINCA GÖREV DURMUŞ GELİYOR.
Tanım diske yazılıyor — her güncellemeden sonra yeniden kurmak
istemiyoruz. Ama SAYAÇ kendiliğinden başlamıyor: `guncelle.sh` iki
servisi yeniden başlatıyor ve o an kimse panelin başında olmayabilir.
Kendi kendine hareket etmeye başlayan bir makine, elle başlatılması
gereken bir makineden çok daha kötü bir sürpriz.

ÇALIŞMA GEÇMİŞİ DİSKE YAZILMIYOR. "En son ne zaman çalıştı" yalnız bu
süreç için geçerli; yeniden başlatmadan sonra boş görünüyor ve panelde
öyle yazıyor. Yeniden başlatmadan önceki bir damgayı göstermek, o arada
zamanlayıcının çalıştığını ima ederdi — oysa duruyordu.
"""
from __future__ import annotations

import asyncio
import inspect
import itertools
import json
import logging
import math
import os
import tempfile
import threading
import time
from typing import Any

logger = logging.getLogger("tarim.zamanli")

# Aralık sınırları. ALTI 60 saniye: bütün bahçenin nemini ölçmek dakikalar
# sürüyor, daha sık bir tik her seferinde "meşgul" diye atlanırdı —
# hiç çalışmayan bir zamanlayıcı, olmayan bir zamanlayıcıdan kötü.
# Üstü bir gün: daha seyreği için takvim gerekir, aralık değil.
EN_KISA_ARALIK_SN = 60.0
EN_UZUN_ARALIK_SN = 24 * 3600.0

# Kaç görev tanımlanabilir. Hepsi aynı makineyi paylaşıyor; onikiden
# fazlası birbirini sürekli "meşgul" diye atlatmak demek.
AZAMI_GOREV = 12

# Döngünün bakma sıklığı. 5 saniyelik gecikme 15 dakikalık bir aralıkta
# görünmüyor; boşuna uyanmak ise küçük bir bilgisayarda görünüyor.
BAKMA_SN = 5.0

# Yapılabilecek işler — kuyruğun tanıdığı tiplerin AYNISI. Buraya yeni bir
# satır eklemek, kuyruğun da o tipi bilmesini gerektiriyor.
ISLER = {
    "nem": "Nem ölçümü",
    "sula": "Sulama",
    "foto": "Fotoğraf",
    "gez": "Ziyaret",
}

# Hangi bitkilere. "susayanlar" ve "olcumsuz" her tikte YENİDEN
# hesaplanıyor: donmuş bir liste, sulanan bitkiyi sulamaya devam ederdi.
KAPSAMLAR = {
    "hepsi": "bütün bitkiler",
    "susayanlar": "susayanlar",
    "olcumsuz": "kendi taze ölçümü olmayanlar",
    "secili": "seçili bitkiler",
}

_KILIT = threading.RLock()
_sayac = itertools.count(1)
_gorevler: list[dict[str, Any]] = []
_yuklendi = False


class ZamanliHatasi(Exception):
    """Geçersiz görev tanımı."""


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
        return s if math.isfinite(s) else varsayilan
    except (TypeError, ValueError):
        return varsayilan


# --------------------------------------------------------------------------- #
# Kalıcılık — `programlar.py` ile aynı biçim ve aynı gerekçe
# --------------------------------------------------------------------------- #
def _yol() -> str:
    ozel = os.environ.get("ZAMANLI_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "zamanli.json")
    return os.path.join(os.path.dirname(__file__), "zamanli.json")


def _bos_calisma(g: dict[str, Any]) -> dict[str, Any]:
    """Çalışma alanlarının sıfır hâli — diskten gelen görev bunu alıyor."""
    g.update({"calisiyor": False, "zorla": False, "sonraki_ts": 0.0,
              "son_ts": 0.0, "son_sonuc": "", "son_atlama": "",
              "son_atlama_ts": 0.0, "calisma_adet": 0, "atlama_adet": 0})
    return g


def yukle() -> None:
    """Tanımları diskten okur. Görevler DURMUŞ geliyor (bkz. dosya başı)."""
    global _yuklendi, _sayac
    yol = _yol()
    with _KILIT:
        _gorevler.clear()
        _yuklendi = True
        if not os.path.exists(yol):
            return
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            # Bozuk dosya sunucuyu düşürmesin: kenara alıp boş başlıyoruz.
            logger.exception("Zamanlanmış görev dosyası okunamadı")
            try:
                os.replace(yol, yol + ".bozuk")
            except OSError:
                pass
            return
        for ham in (veri.get("gorevler") or []):
            try:
                _gorevler.append(_bos_calisma(_temiz(ham, yeni=False)))
            except ZamanliHatasi as hata:
                logger.warning("Zamanlanmış görev atlandı: %s", hata)
        # Kimlik sayacı en büyük kimliğin ÜSTÜNDEN devam ediyor; yoksa
        # yeni bir görev diskten gelenin kimliğini alır ve onu ezerdi.
        enbuyuk = 0
        for g in _gorevler:
            try:
                enbuyuk = max(enbuyuk, int(str(g["kimlik"]).lstrip("z")))
            except ValueError:
                continue
        _sayac = itertools.count(enbuyuk + 1)


def _yaz() -> None:
    """Yalnız TANIM yazılıyor; çalışma geçmişi diske gitmiyor."""
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    alanlar = ("kimlik", "ad", "is", "kapsam", "noktalar", "aralik_sn")
    veri = {"surum": 1,
            "gorevler": [{a: g[a] for a in alanlar} for g in _gorevler]}
    try:
        os.makedirs(klasor, exist_ok=True)
        gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                             prefix=".zaman-", suffix=".tmp",
                                             delete=False)
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
    except Exception:                                   # noqa: BLE001
        # Yazamamak görevin ÇALIŞMASINI engellemiyor; yalnız yeniden
        # başlatmadan sonra kaybolur. Sessiz değil — günlüğe düşüyor.
        logger.exception("Zamanlanmış görevler diske yazılamadı")


# --------------------------------------------------------------------------- #
# Tanım
# --------------------------------------------------------------------------- #
def _temiz(ham: dict[str, Any], yeni: bool = True) -> dict[str, Any]:
    is_ = str(ham.get("is") or "")
    if is_ not in ISLER:
        raise ZamanliHatasi(f"Bilinmeyen iş: {is_!r}")
    kapsam = str(ham.get("kapsam") or "hepsi")
    if kapsam not in KAPSAMLAR:
        raise ZamanliHatasi(f"Bilinmeyen kapsam: {kapsam!r}")
    noktalar = [str(a).strip() for a in (ham.get("noktalar") or []) if str(a).strip()]
    if kapsam == "secili" and not noktalar:
        raise ZamanliHatasi("Seçili kapsam için en az bir bitki gerekiyor")
    aralik = _sayi(ham.get("aralik_sn"), 0.0)
    if not (EN_KISA_ARALIK_SN <= aralik <= EN_UZUN_ARALIK_SN):
        raise ZamanliHatasi(
            f"Aralık {EN_KISA_ARALIK_SN / 60:.0f} dakika ile "
            f"{EN_UZUN_ARALIK_SN / 3600:.0f} saat arasında olmalı")
    kimlik = str(ham.get("kimlik") or "").strip()
    if not kimlik:
        if not yeni:
            raise ZamanliHatasi("Kimliksiz görev")
        kimlik = f"z{next(_sayac)}"
    ad = str(ham.get("ad") or "").strip()[:60]
    if not ad:
        ad = f"{ISLER[is_]} · {KAPSAMLAR[kapsam]}"
    return {"kimlik": kimlik, "ad": ad, "is": is_, "kapsam": kapsam,
            "noktalar": noktalar[:40], "aralik_sn": round(aralik, 1)}


def _bul(kimlik: str) -> dict[str, Any] | None:
    return next((g for g in _gorevler if g["kimlik"] == str(kimlik)), None)


def kaydet(ham: dict[str, Any]) -> dict[str, Any]:
    """Görev ekler ya da var olanı günceller.

    ARALIK DEĞİŞİNCE SAYAÇ BAŞTAN. Eski `sonraki_ts`yi korumak, "15 dakika"
    yazarken bir saat sonra çalışan bir görev demekti.
    """
    with _KILIT:
        if not _yuklendi:
            yukle()
        temiz = _temiz(ham)
        mevcut = _bul(temiz["kimlik"])
        if mevcut is None:
            if len(_gorevler) >= AZAMI_GOREV:
                raise ZamanliHatasi(f"En fazla {AZAMI_GOREV} zamanlanmış görev olabilir")
            _gorevler.append(_bos_calisma(temiz))
            sonuc = _bul(temiz["kimlik"])
        else:
            mevcut.update(temiz)
            if mevcut.get("calisiyor"):
                mevcut["sonraki_ts"] = time.time() + mevcut["aralik_sn"]
            sonuc = mevcut
        _yaz()
        return dict(sonuc or {})


def sil(kimlik: str) -> bool:
    with _KILIT:
        g = _bul(kimlik)
        if g is None:
            return False
        _gorevler.remove(g)
        _yaz()
        return True


def durum_yaz(kimlik: str, calisiyor: bool) -> dict[str, Any]:
    """Başlat / durdur.

    BAŞLATINCA HEMEN ÇALIŞMIYOR: ilk tik bir aralık sonra. Düğmeye basınca
    makinenin anında kalkması, "başlat"ı "şimdi çalıştır" ile karıştırmak
    olurdu — onun ayrı bir düğmesi var.
    """
    with _KILIT:
        g = _bul(kimlik)
        if g is None:
            raise ZamanliHatasi(f"'{kimlik}' diye bir görev yok")
        g["calisiyor"] = bool(calisiyor)
        g["sonraki_ts"] = (time.time() + g["aralik_sn"]) if calisiyor else 0.0
        if not calisiyor:
            g["zorla"] = False
        return dict(g)


def hemen(kimlik: str) -> dict[str, Any]:
    """Bir kez, şimdi. Görev duruyorsa da çalışıyor — "aralığı beklemeden
    bir dene" demenin tek yolu bu; yoksa 15 dakika bekleyip görmek gerekir."""
    with _KILIT:
        g = _bul(kimlik)
        if g is None:
            raise ZamanliHatasi(f"'{kimlik}' diye bir görev yok")
        g["zorla"] = True
        return dict(g)


def hepsi() -> list[dict[str, Any]]:
    with _KILIT:
        if not _yuklendi:
            yukle()
        return [dict(g) for g in _gorevler]


def goruntu(simdi: float | None = None) -> dict[str, Any]:
    simdi = time.time() if simdi is None else simdi
    gorevler = []
    for g in hepsi():
        kalan = (_sayi(g["sonraki_ts"]) - simdi) if g.get("calisiyor") else None
        gorevler.append({
            **{a: g[a] for a in ("kimlik", "ad", "is", "kapsam", "noktalar",
                                 "aralik_sn", "calisiyor", "son_ts",
                                 "son_sonuc", "son_atlama", "son_atlama_ts",
                                 "calisma_adet", "atlama_adet")},
            "is_ad": ISLER.get(g["is"], g["is"]),
            "kapsam_ad": KAPSAMLAR.get(g["kapsam"], g["kapsam"]),
            "sonraki_ts": _sayi(g["sonraki_ts"]) if g.get("calisiyor") else None,
            "kalan_sn": None if kalan is None else max(0.0, round(kalan, 1)),
        })
    return {"gorevler": gorevler, "isler": ISLER, "kapsamlar": KAPSAMLAR,
            "en_kisa_sn": EN_KISA_ARALIK_SN, "en_uzun_sn": EN_UZUN_ARALIK_SN,
            "azami": AZAMI_GOREV, "ts": simdi}


# --------------------------------------------------------------------------- #
# Döngü
# --------------------------------------------------------------------------- #
def _atla(kimlik: str, sebep: str, simdi: float) -> None:
    with _KILIT:
        g = _bul(kimlik)
        if g is None:
            return
        g["son_atlama"] = str(sebep)
        g["son_atlama_ts"] = simdi
        g["atlama_adet"] = int(g.get("atlama_adet") or 0) + 1
        g["sonraki_ts"] = simdi + _sayi(g["aralik_sn"], EN_KISA_ARALIK_SN)


def _calisti(kimlik: str, sonuc: str, simdi: float) -> None:
    with _KILIT:
        g = _bul(kimlik)
        if g is None:
            return
        g["son_ts"] = simdi
        g["son_sonuc"] = str(sonuc)
        g["son_atlama"] = ""
        g["calisma_adet"] = int(g.get("calisma_adet") or 0) + 1
        g["sonraki_ts"] = simdi + _sayi(g["aralik_sn"], EN_KISA_ARALIK_SN)


async def _belki(deger: Any) -> Any:
    return await deger if inspect.isawaitable(deger) else deger


async def dongu(engel, adlari_coz, is_ekle, yayinla=None) -> None:
    """Zamanı gelen görevleri kuyruğa koyar.

    `engel()` -> "" ya da neden çalıştırılamadığını anlatan METİN. Metin
        dönerse tik ATLANIYOR ve o metin panelde yazıyor: "atlandı" tek
        başına, kullanıcıya sebebini söylemeden iş yapmamak demekti.
    `adlari_coz(kapsam, noktalar)` -> bitki adları. Her tikte yeniden
        çağrılıyor; donmuş bir liste sulanmış bitkiyi sulamaya devam ederdi.
    `is_ekle(tip, etiket, adlar)` -> kuyruğa koyar; hata fırlatabilir
        (kuyruk dolu gibi) ve o hata atlama sebebi olarak yazılıyor.
    """
    # Tanimlar BIR KEZ yukleniyor. `yukle()` listeyi sifirdan kuruyor ve
    # gorevleri DURMUS hale getiriyor; dongu bir sekilde yeniden baslarsa
    # calisan gorevleri sessizce durdurmus olurdu.
    if not _yuklendi:
        await asyncio.to_thread(yukle)
    while True:
        try:
            await asyncio.sleep(BAKMA_SN)
            simdi = time.time()
            degisti = False
            for g in hepsi():
                zorla = bool(g.get("zorla"))
                if not zorla:
                    if not g.get("calisiyor"):
                        continue
                    if simdi < _sayi(g.get("sonraki_ts"), 0.0):
                        continue
                if zorla:
                    with _KILIT:
                        canli = _bul(g["kimlik"])
                        if canli is not None:
                            canli["zorla"] = False
                degisti = True

                sebep = await _belki(engel())
                if sebep:
                    _atla(g["kimlik"], str(sebep), simdi)
                    continue
                try:
                    adlar = list(await _belki(adlari_coz(g["kapsam"],
                                                         g.get("noktalar"))))
                except Exception as hata:                # noqa: BLE001
                    logger.exception("Zamanlanmış görev: kapsam çözülemedi")
                    _atla(g["kimlik"], f"bitkiler çözülemedi: {hata}", simdi)
                    continue
                if not adlar:
                    _atla(g["kimlik"], "kapsama giren bitki yok", simdi)
                    continue
                etiket = f"{g['ad']} · {len(adlar)} bitki"
                try:
                    await _belki(is_ekle(g["is"], etiket, adlar))
                except Exception as hata:                # noqa: BLE001
                    _atla(g["kimlik"], str(hata), simdi)
                    continue
                _calisti(g["kimlik"], f"{len(adlar)} bitki kuyruğa alındı", simdi)
            if degisti and yayinla is not None:
                await _belki(yayinla())
        except asyncio.CancelledError:
            raise
        except Exception:                                # noqa: BLE001
            logger.exception("Zamanlanmış görev döngüsü")
            await asyncio.sleep(2)


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def yonlendirici_kur(parola_dogrula):
    from fastapi import APIRouter, HTTPException, Query

    yon = APIRouter()

    @yon.get("/api/zamanli")
    async def _liste(jeton: str = Query(default="")):
        parola_dogrula(jeton)
        return goruntu()

    @yon.post("/api/zamanli")
    async def _kaydet(govde: dict[str, Any], jeton: str = Query(default="")):
        parola_dogrula(jeton)
        try:
            gorev = await asyncio.to_thread(kaydet, govde or {})
        except ZamanliHatasi as hata:
            raise HTTPException(status_code=400, detail=str(hata))
        return {"ok": True, "gorev": gorev, **goruntu()}

    @yon.post("/api/zamanli/durum")
    async def _durum(govde: dict[str, Any], jeton: str = Query(default="")):
        parola_dogrula(jeton)
        try:
            durum_yaz(str((govde or {}).get("kimlik") or ""),
                      bool((govde or {}).get("calisiyor")))
        except ZamanliHatasi as hata:
            raise HTTPException(status_code=404, detail=str(hata))
        return {"ok": True, **goruntu()}

    @yon.post("/api/zamanli/simdi")
    async def _simdi(govde: dict[str, Any], jeton: str = Query(default="")):
        parola_dogrula(jeton)
        try:
            hemen(str((govde or {}).get("kimlik") or ""))
        except ZamanliHatasi as hata:
            raise HTTPException(status_code=404, detail=str(hata))
        return {"ok": True, **goruntu()}

    @yon.delete("/api/zamanli")
    async def _sil(kimlik: str = Query(...), jeton: str = Query(default="")):
        parola_dogrula(jeton)
        if not await asyncio.to_thread(sil, kimlik):
            raise HTTPException(status_code=404, detail=f"'{kimlik}' diye bir görev yok")
        return {"ok": True, **goruntu()}

    return yon
