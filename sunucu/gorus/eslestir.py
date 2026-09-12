"""
eslestir — tespitleri ekim kaydına bağlar.  [madde 2]

Ekim kaydı elinizde olduğu için mahsul/yabani ayrımındaki en güçlü sinyal
budur: robot nereye ektiğini biliyor. Görünüm sınıflandırması bunun üstüne
bir destek katmanıdır, tersi değil.

Eşleştirme EN YAKIN KOMŞU DEĞİL, GLOBAL ATAMA (Macar algoritması). Neden:
iki filiz yan yana çıktığında en yakın komşu ikisini de aynı kayda bağlayıp
diğerini yabani ilan eder. Global atama bir kayda bir tespit düşürür.

Kabul yarıçapı bitkinin yaşıyla büyür:
    r(yas) = min(taban + yas_gun * gunluk, max)
Taban yarıçap; ekim konum hatası + kalibrasyon artığı + filizin tohumdan
kayarak çıkmasını birlikte kapsamalı.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, asdict

import numpy as np

try:
    from scipy.optimize import linear_sum_assignment
    _SCIPY = True
except ImportError:
    _SCIPY = False


@dataclass
class EkimKaydi:
    id: int
    x_mm: float
    y_mm: float
    tur: str = ""
    yas_gun: float = 0.0
    durum: str = "ekili"


@dataclass
class EslestirmeAyari:
    taban_yaricap_mm: float = 25.0
    gunluk_buyume_mm: float = 1.5
    max_yaricap_mm: float = 90.0


_K_X = ("x_mm", "x", "X", "konum_x")
_K_Y = ("y_mm", "y", "Y", "konum_y")
_K_ID = ("id", "kimlik", "no", "bitki_id")
_K_TUR = ("tur", "tür", "cins", "isim", "ad", "bitki")
_K_TARIH = ("ekim_tarihi", "ekildi", "ekim", "tarih", "olusturma", "eklendi")


def _al(k, adaylar, vars=None):
    for a in adaylar:
        if a in k and k[a] is not None:
            return k[a]
    return vars


def _yas_gun(deger) -> float:
    if deger is None:
        return 0.0
    try:
        if isinstance(deger, (int, float)):
            sn = float(deger) / (1000.0 if deger > 1e11 else 1.0)
            t = dt.datetime.fromtimestamp(sn)
        else:
            t = dt.datetime.fromisoformat(str(deger).replace("Z", "+00:00"))
    except (ValueError, OSError, OverflowError):
        return 0.0
    if t.tzinfo:
        t = t.astimezone().replace(tzinfo=None)
    return max(0.0, (dt.datetime.now() - t).total_seconds() / 86400.0)


def kayitlara_cevir(ham) -> list[EkimKaydi]:
    """bitki.veri() ne döndürüyorsa ondan EkimKaydi üretir."""
    if ham is None:
        return []
    if isinstance(ham, dict):
        ham = [{**v, "id": k} if isinstance(v, dict) else v for k, v in ham.items()]
    kayitlar, gorulen = [], set()
    for i, k in enumerate(ham):
        if not isinstance(k, dict):
            k = getattr(k, "__dict__", None) or {}
        gorulen.update(k.keys())
        x, y = _al(k, _K_X), _al(k, _K_Y)
        if x is None or y is None:
            continue
        kayitlar.append(EkimKaydi(
            id=int(_al(k, _K_ID, i)), x_mm=float(x), y_mm=float(y),
            tur=str(_al(k, _K_TUR, "") or ""),
            yas_gun=_yas_gun(_al(k, _K_TARIH))))
    if ham and not kayitlar:
        raise ValueError(
            "Ekim kaydında koordinat bulunamadı. Görülen anahtarlar: "
            f"{sorted(gorulen)}. Denenen: X {_K_X}, Y {_K_Y}.")
    return kayitlar


def yaricap(kayit: EkimKaydi, ayar: EslestirmeAyari) -> float:
    return float(min(ayar.taban_yaricap_mm + kayit.yas_gun * ayar.gunluk_buyume_mm,
                     ayar.max_yaricap_mm))


def _acgozlu(maliyet, buyuk):
    satir, sutun, m = [], [], maliyet.copy()
    while m.size and m.min() < buyuk:
        i, j = np.unravel_index(np.argmin(m), m.shape)
        satir.append(i); sutun.append(j); m[i, :] = buyuk; m[:, j] = buyuk
    return np.asarray(satir, int), np.asarray(sutun, int)


def esle(tespitler, kayitlar, ayar: EslestirmeAyari | None = None) -> dict:
    """
    Döner:
      eslesme        : {tespit_id: {kayit_id, tur, yas_gun, mesafe_mm,
                                    yaricap_mm, konum_skoru}}
      eslesmeyenler  : [tespit_id...]   -> yabani adayları
      bos_kayitlar   : [kayit_id...]    -> çıkmamış ya da kaçırılmış tohumlar
    """
    ayar = ayar or EslestirmeAyari()
    if not tespitler or not kayitlar:
        return {"eslesme": {}, "eslesmeyenler": [t.id for t in tespitler],
                "bos_kayitlar": [k.id for k in kayitlar],
                "tani": {"sebep": "tespit ya da kayıt yok"}}

    T = np.array([t.mm for t in tespitler], np.float64)
    K = np.array([[k.x_mm, k.y_mm] for k in kayitlar], np.float64)
    R = np.array([yaricap(k, ayar) for k in kayitlar], np.float64)
    D = np.linalg.norm(T[:, None, :] - K[None, :, :], axis=2)
    BUYUK = 1e6
    maliyet = np.where(D <= R[None, :], D, BUYUK)

    if _SCIPY:
        si, sj = linear_sum_assignment(maliyet)
        ok = maliyet[si, sj] < BUYUK
        si, sj = si[ok], sj[ok]
    else:
        si, sj = _acgozlu(maliyet, BUYUK)

    eslesme = {}
    for i, j in zip(si, sj):
        eslesme[tespitler[i].id] = {
            "kayit_id": kayitlar[j].id, "tur": kayitlar[j].tur,
            "yas_gun": round(kayitlar[j].yas_gun, 2),
            "mesafe_mm": round(float(D[i, j]), 2),
            "yaricap_mm": round(float(R[j]), 1),
            "konum_skoru": round(float(max(0.0, 1.0 - D[i, j] / max(R[j], 1e-6))), 3),
        }
    eslesen_kayit = {v["kayit_id"] for v in eslesme.values()}
    mesafeler = [v["mesafe_mm"] for v in eslesme.values()]
    return {
        "eslesme": eslesme,
        "eslesmeyenler": [t.id for t in tespitler if t.id not in eslesme],
        "bos_kayitlar": [k.id for k in kayitlar if k.id not in eslesen_kayit],
        "tani": {"yontem": "macar" if _SCIPY else "acgozlu (scipy yok)",
                 "eslesen": len(eslesme),
                 "ortalama_mesafe_mm": round(float(np.mean(mesafeler)), 2) if mesafeler else None,
                 "max_mesafe_mm": round(float(np.max(mesafeler)), 2) if mesafeler else None},
    }


def cimlenme_raporu(kayitlar, eslestirme, izler=None) -> dict:
    """
    [madde 2 çıktısı] Hangi tohum çıktı, hangisi çıkmadı, kaç günde.
    'Kaç günde' ancak iz geçmişi varsa verilir — yoksa None döner, uydurulmaz.
    """
    es = eslestirme["eslesme"]
    kayit_tespit = {v["kayit_id"]: tid for tid, v in es.items()}
    ix = {i.kayit_id: i for i in (izler or []) if getattr(i, "kayit_id", None) is not None}

    cikan, cikmayan = [], []
    for k in kayitlar:
        if k.id in kayit_tespit:
            iz = ix.get(k.id)
            gun = None
            if iz is not None and iz.ilk_gorulme:
                try:
                    ilk = dt.datetime.fromisoformat(iz.ilk_gorulme)
                    gun = round(max(0.0, k.yas_gun - (dt.datetime.now().astimezone()
                                                      - ilk).total_seconds() / 86400.0), 1)
                except ValueError:
                    gun = None
            cikan.append({"kayit_id": k.id, "tur": k.tur,
                          "tespit_id": kayit_tespit[k.id],
                          "yas_gun": round(k.yas_gun, 1),
                          "cimlenme_gun": gun,
                          "mesafe_mm": es[kayit_tespit[k.id]]["mesafe_mm"]})
        else:
            cikmayan.append({"kayit_id": k.id, "tur": k.tur,
                             "yas_gun": round(k.yas_gun, 1)})
    return {
        "ekilen": len(kayitlar), "cikan": len(cikan), "cikmayan": len(cikmayan),
        "cikma_orani": round(len(cikan) / len(kayitlar), 3) if kayitlar else None,
        "cikanlar": cikan, "cikmayanlar": cikmayan,
        "not": ("cimlenme_gun yalnız iz geçmişi olan bitkilerde dolu; "
                "ilk taramada None'dır."),
    }
