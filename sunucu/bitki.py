# -*- coding: utf-8 -*-
"""Bitki kartı — bir bitkiye dair ne varsa TEK kartta.

NEDEN VAR. Bitkinin kendisi (türü, yaşı, yayılımı, son sulaması) bir
ekranda, toprak nemi başka bir ekranda duruyordu. İkisini yan yana
görmenin yolu yoktu ve "bu bitki neden susadı" sorusu iki sekme arasında
gidip gelmeden cevaplanamıyordu.

BU MODÜL BİTKİYİ YENİDEN HESAPLAMIYOR. Susama kararı, eşik, ölçümün
künyesi (kendi üstünden mi, kaç mm ötede, kaç dakika önce) ve gerekçe
`/api/bahce`de zaten var; panel onları oradan çekiyor. İkinci bir hesap
kurmak, aynı soruya iki farklı cevap veren iki yer demekti — `bahce.py`
başındaki gerekçenin aynısı. Burada YALNIZ orada olmayanlar üretiliyor:

  * sulama süresi — ezme zincirinden çözülmüş hâli (`sulama.ayar_coz`),
  * nem eğilimi — ölçüm deposundaki KONUMLU okumalardan, bitkinin nem
    yarıçapı içine düşenler,
  * sulama ve ölçüm sayısı — aşağıdaki olay defterinden,
  * bahçe ortancasına göre durum — komşularıyla aynı ölçekte mi.

OLAY DEFTERİ NEDEN GEREKTİ. Nokta deposu yalnız SON sulama damgasını
tutuyor (`sulama_ts`); "kaç kez sulandı" hiçbir yerden türetilemiyordu.
Tek satırlık bir tablo açtık ve sayaç DEFTERİN BAŞLANGICINDAN itibaren
sayıyor — kart bunu böyle yazıyor. Geçmişi geriye doğru uydurmak,
ölçülmemiş bir sayıyı ölçülmüş gibi göstermek olurdu.

DEFTER TUTULAMAZSA İŞ DURMUYOR. Yazma hatası günlüğe düşüyor ama yukarı
fırlatılmıyor: sulamanın sayılamaması, sulamanın olmamasından iyi.
"""
from __future__ import annotations

import asyncio
import logging
import math
import statistics
import time
from typing import Any

import depo
import noktalar
import sulama
import turler

logger = logging.getLogger("tarim.bitki")

# Eğilim penceresi. `depo.SAKLAMA_GUN` ile AYNI olmak zorunda: budama
# ondan eskisini zaten siliyor, daha uzun bir pencere istemek boş dönmek
# olurdu.
EGILIM_GUN = depo.SAKLAMA_GUN

# Eğilim noktalarının çözünürlüğü — `depo.kova_okumalari`ya geçiyor.
# Saatlik kova, günlük sulama döngüsünde eğilimi göstermeye yetiyor;
# 50 mm hücre nem yarıçapının (100 mm) yarısı, yani bir bitkinin
# çevresinde en çok birkaç hücre var.
KOVA_SN = 3600.0
HUCRE_MM = 50.0

# Kartta çizilen en çok nokta. Yedi gün × saatlik kova = 168; bir kartın
# içindeki küçük çizgide 72 nokta zaten okunabilirliğin sınırı ve EN
# YENİLERİ tutuluyor.
AZAMI_NOKTA = 72

# Okuma sorgusunun önbelleği. Panel bu ucu 15 saniyede bir çağırıyor;
# her çağrıda yedi günlük tabloyu gruplamak Pi'de gereksiz yük. Kova
# zaten saatlik — 45 saniyelik önbellek gösterilen hiçbir şeyi
# değiştirmiyor.
ONBELLEK_SN = 45.0

_TABLO_KURULDU = False
_onbellek: dict[str, Any] = {"ts": 0.0, "okumalar": []}


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
        return s if math.isfinite(s) else varsayilan
    except (TypeError, ValueError):
        return varsayilan


# --------------------------------------------------------------------------- #
# Olay defteri
# --------------------------------------------------------------------------- #
def _tablo():
    """Defter tablosunu hazırlar. Ölçüm deposunun BAĞLANTISINI kullanıyor:
    ikinci bir SQLite dosyası açmak, aynı diskte ikinci bir WAL demekti."""
    global _TABLO_KURULDU
    db = depo.baglan()
    if _TABLO_KURULDU:
        return db
    with depo.kilit():
        db.execute("CREATE TABLE IF NOT EXISTS bitki_olay ("
                   "ts REAL NOT NULL, ad TEXT NOT NULL, tip TEXT NOT NULL, "
                   "deger REAL)")
        db.execute("CREATE INDEX IF NOT EXISTS bitki_olay_ad "
                   "ON bitki_olay(ad, ts)")
        db.commit()
    _TABLO_KURULDU = True
    return db


def olay_yaz(kayitlar: list[tuple[str, str, Any]], ts: float | None = None) -> int:
    """[(ad, tip, deger)] satırlarını deftere yazar; yazılan sayıyı döner.

    `tip` "sula" (deger = saniye) ya da "nem" (deger = yüzde). Damga TEK:
    aynı dizide sulanan bitkiler aynı ana yazılıyor, çünkü komut o an
    gitti.
    """
    satirlar = [(str(a), str(t), None if d is None else _sayi(d))
                for a, t, d in (kayitlar or []) if str(a or "").strip()]
    if not satirlar:
        return 0
    damga = time.time() if ts is None else _sayi(ts, time.time())
    try:
        db = _tablo()
        with depo.kilit():
            db.executemany(
                "INSERT INTO bitki_olay (ts, ad, tip, deger) VALUES (?, ?, ?, ?)",
                [(damga, a, t, d) for a, t, d in satirlar])
            db.commit()
        return len(satirlar)
    except Exception:                                   # noqa: BLE001
        logger.exception("Bitki olay defterine yazılamadı")
        return 0


def defter() -> dict[str, Any]:
    """Bitki başına olay sayıları + defterdeki İLK kaydın anı.

    İlk kaydın anı kartta yazıyor: "3 kez" tek başına, defterin ne zaman
    açıldığı bilinmeden yanıltıcı bir sayı olurdu.
    """
    try:
        db = _tablo()
        with depo.kilit():
            satirlar = db.execute(
                "SELECT ad, tip, COUNT(*) AS adet, MAX(ts) AS son, "
                "SUM(deger) AS toplam FROM bitki_olay GROUP BY ad, tip"
            ).fetchall()
            ilk = db.execute("SELECT MIN(ts) AS ilk FROM bitki_olay").fetchone()
    except Exception:                                   # noqa: BLE001
        logger.exception("Bitki olay defteri okunamadı")
        return {"bas_ts": None, "sayilar": {}}
    sayilar: dict[str, dict[str, Any]] = {}
    for s in satirlar:
        sayilar.setdefault(str(s["ad"]), {})[str(s["tip"])] = {
            "adet": int(s["adet"] or 0),
            "son_ts": _sayi(s["son"], 0.0) or None,
            "toplam": _sayi(s["toplam"], 0.0),
        }
    bas = _sayi(ilk["ilk"], 0.0) if ilk else 0.0
    return {"bas_ts": bas or None, "sayilar": sayilar}


# --------------------------------------------------------------------------- #
# Nem eğilimi
# --------------------------------------------------------------------------- #
def _okumalar(simdi: float) -> list[dict[str, Any]]:
    if _onbellek["okumalar"] and simdi - _sayi(_onbellek["ts"]) < ONBELLEK_SN:
        return _onbellek["okumalar"]
    try:
        okumalar = depo.kova_okumalari(EGILIM_GUN, KOVA_SN, HUCRE_MM)
    except Exception:                                   # noqa: BLE001
        # Geçmiş okunamazsa kart yine çalışsın: eğilim boş kalır, geri
        # kalan her şey durur. Sessiz değil — günlüğe düşüyor.
        logger.exception("Nem geçmişi okunamadı")
        okumalar = []
    _onbellek["okumalar"] = okumalar
    _onbellek["ts"] = simdi
    return okumalar


def _izgara(okumalar: list[dict[str, Any]]) -> dict[tuple[int, int], list]:
    """Okumaları hücrelere dağıtır.

    Hücresiz hâli her bitki için BÜTÜN okumaları taramaktı: 40 bitki ×
    60 bin okuma = 2,4 milyon uzaklık hesabı, hem de 15 saniyede bir.
    Hücreyle bitki başına en çok 25 hücreye bakılıyor.
    """
    kutu: dict[tuple[int, int], list[dict[str, Any]]] = {}
    for o in okumalar:
        anahtar = (int(_sayi(o.get("x")) // HUCRE_MM),
                   int(_sayi(o.get("y")) // HUCRE_MM))
        kutu.setdefault(anahtar, []).append(o)
    return kutu


def _gecmis(bitki: dict[str, Any], izgara: dict, kalib: dict[str, Any],
            simdi: float) -> list[dict[str, Any]]:
    """Bitkinin nem yarıçapına düşen okumalar, zaman sırasıyla.

    YARIÇAP SULAMANINKİYLE AYNI (`sulama.NEM_YARICAP_MM`). Daha genişini
    almak, komşunun ıslaklığını bu bitkinin eğilimi diye çizmek olurdu.
    """
    bx, by = _sayi(bitki.get("x")), _sayi(bitki.get("y"))
    yaricap = sulama.NEM_YARICAP_MM
    adim = int(yaricap // HUCRE_MM) + 1
    cx, cy = int(bx // HUCRE_MM), int(by // HUCRE_MM)
    cikti: list[dict[str, Any]] = []
    for i in range(cx - adim, cx + adim + 1):
        for j in range(cy - adim, cy + adim + 1):
            for o in izgara.get((i, j), ()):
                if math.hypot(_sayi(o.get("x")) - bx,
                              _sayi(o.get("y")) - by) > yaricap:
                    continue
                yuzde = sulama.nem_yuzde(o.get("ham"), kalib)
                if yuzde is None:
                    continue
                cikti.append({"ts": round(_sayi(o.get("ts")), 1),
                              "yuzde": round(float(yuzde), 1)})
    cikti.sort(key=lambda p: p["ts"])
    return cikti[-AZAMI_NOKTA:]


def _egilim(gecmis: list[dict[str, Any]]) -> dict[str, Any] | None:
    """İlk ve son okuma arasındaki fark — PUAN olarak.

    Eğri uydurmuyoruz; dönen sayı ölçülen iki sayının farkı. Tek okuma
    varsa eğilim YOK: "sabit" demek, bilmediğini bilmemek olurdu.
    """
    if len(gecmis) < 2:
        return None
    ilk, son = gecmis[0], gecmis[-1]
    sure = son["ts"] - ilk["ts"]
    if sure <= 0:
        return None
    return {"adet": len(gecmis), "ilk": ilk["yuzde"], "son": son["yuzde"],
            "degisim": round(son["yuzde"] - ilk["yuzde"], 1),
            "sure_sn": round(sure, 1)}


def _kendi_nemi(bitki: dict[str, Any], simdi: float) -> float | None:
    """Bitkinin KENDİ taze ölçümü — yoksa None.

    `bahce.susama_durumu` ile aynı ölçüt: nokta kaydındaki `nem_yuzde` ve
    `nem_ts`, tazelik `sulama.NEM_AZAMI_YAS_SN`. Komşudan ödünç alınan
    okuma buraya girmiyor — ortancayı ondan hesaplamak aynı okumayı
    birkaç bitki adına saymak olurdu.
    """
    ts = _sayi(bitki.get("nem_ts"), 0.0)
    y = bitki.get("nem_yuzde")
    if y in (None, "") or not ts:
        return None
    yas = simdi - ts
    if yas < 0 or yas > sulama.NEM_AZAMI_YAS_SN:
        return None
    return _sayi(y)


# --------------------------------------------------------------------------- #
# Görüntü
# --------------------------------------------------------------------------- #
def veri(toprak_kalib: dict[str, Any] | None = None,
         simdi: float | None = None) -> dict[str, Any]:
    """Kartın EK verisi — bitki adına göre.

    Panel bunu `/api/bahce`nin bitki listesiyle birleştiriyor. Burada
    dönen hiçbir alan orada yok; orada olan hiçbir alan burada
    hesaplanmıyor.
    """
    simdi = time.time() if simdi is None else _sayi(simdi, time.time())
    kalib = toprak_kalib or {}
    hepsi = [n for n in noktalar.hepsi() if n.get("tur")]
    tur_indeks = {t.get("slug"): t for t in turler.hepsi()}
    izgara = _izgara(_okumalar(simdi))
    d = defter()

    taze = [y for y in (_kendi_nemi(b, simdi) for b in hepsi) if y is not None]
    ortanca = round(statistics.median(taze), 1) if taze else None

    ek: dict[str, Any] = {}
    for b in hepsi:
        ad = str(b.get("ad"))
        tur = tur_indeks.get(str(b.get("tur") or "")) or {}
        ayar = sulama.ayar_coz(b, tur)
        gecmis = _gecmis(b, izgara, kalib, simdi)
        sayac = d["sayilar"].get(ad) or {}
        kendi = _kendi_nemi(b, simdi)
        ek[ad] = {
            "sulama_saniye": round(_sayi(ayar.get("sulama_saniye"),
                                         turler.VARSAYILAN["sulama_saniye"]), 1),
            "sulama_deseni": str(ayar.get("sulama_deseni") or "ust"),
            "gecmis": gecmis,
            "egilim": _egilim(gecmis),
            "sula_adet": int((sayac.get("sula") or {}).get("adet") or 0),
            "nem_adet": int((sayac.get("nem") or {}).get("adet") or 0),
            "sula_toplam_sn": round(_sayi((sayac.get("sula") or {}).get("toplam")), 1),
            # Ortancaya göre fark yalnız KENDİ taze ölçümü olan bitki için:
            # ödünç okumayla "komşularının altında" demek, komşunun
            # okumasını komşusuyla karşılaştırmak olurdu.
            "ortanca_fark": (None if kendi is None or ortanca is None
                             else round(kendi - ortanca, 1)),
        }

    return {
        "ek": ek,
        "ortanca": ortanca,
        "ortanca_adet": len(taze),
        "defter_bas_ts": d["bas_ts"],
        "pencere_gun": EGILIM_GUN,
        "yaricap_mm": sulama.NEM_YARICAP_MM,
        "azami_yas_sn": sulama.NEM_AZAMI_YAS_SN,
        "ts": simdi,
    }


def yonlendirici_kur(parola_dogrula, toprak_kalib):
    """`toprak_kalib()` ajanın {kuru, islak} sayımlarını veriyor.

    Ham ADC okumasını yüzdeye çeviren tek şey o ve ajandan geliyor;
    modül onu kendisi okumaya kalkmıyor.
    """
    from fastapi import APIRouter, Query

    yon = APIRouter()

    @yon.get("/api/bitki")
    async def _bitki(jeton: str = Query(default="")):
        parola_dogrula(jeton)
        kalib = toprak_kalib() or {}
        return await asyncio.to_thread(veri, kalib)

    return yon
