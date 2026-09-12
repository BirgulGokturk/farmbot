"""
eslestir — tespitleri sunucudaki ekim kaydına bağlar.

Ekim kaydı elinizde olduğu için mahsul/yabani ayrımındaki en güçlü sinyal
budur: robot nereye ektiğini biliyor. Görünüm sınıflandırması bunun üstüne
bir destek katmanıdır, tersi değil.

Eşleştirme, en yakın komşu değil GLOBAL atamadır (Macar algoritması). Neden:
iki filiz yan yana çıktığında en yakın komşu ikisini de aynı kayda bağlayıp
diğerini yabani ilan eder. Global atama bir kayda bir nesne düşürür.

Kabul yarıçapı bitkinin yaşıyla büyür:
    r(yas) = min(taban_yaricap + yas_gun * gunluk_buyume, max_yaricap)
Taban yarıçap, ekim konum hatası + kalibrasyon artığı + paralaksı kapsamalıdır.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

try:
    from scipy.optimize import linear_sum_assignment
    _SCIPY = True
except ImportError:                                  # scipy yoksa açgözlü yedek
    _SCIPY = False


@dataclass
class EkimKaydi:
    id: int
    x_mm: float
    y_mm: float
    tur: str = ""
    yas_gun: float = 0.0
    durum: str = "ekili"        # ekili | filizlendi | hasat | kayip


def _greedy(maliyet, buyuk):
    satir, sutun = [], []
    m = maliyet.copy()
    while True:
        i, j = np.unravel_index(np.argmin(m), m.shape)
        if m[i, j] >= buyuk:
            break
        satir.append(i); sutun.append(j)
        m[i, :] = buyuk; m[:, j] = buyuk
    return np.asarray(satir, int), np.asarray(sutun, int)


def yaricap(kayit: EkimKaydi, ayar) -> float:
    return float(min(ayar.taban_yaricap_mm + kayit.yas_gun * ayar.gunluk_buyume_mm,
                     ayar.max_yaricap_mm))


def esle(nesneler, kayitlar: list[EkimKaydi], ayar) -> dict:
    """
    Döner:
      {"eslesme": {nesne_id: {"kayit_id":..., "mesafe_mm":..., "yaricap_mm":...}},
       "eslesmeyen_nesneler": [nesne_id...],     # yabani adayları
       "bos_kayitlar": [kayit_id...],            # çıkmamış / kaçırılmış filizler
       "tani": {...}}
    """
    if not nesneler or not kayitlar:
        return {"eslesme": {}, "eslesmeyen_nesneler": [n.id for n in nesneler],
                "bos_kayitlar": [k.id for k in kayitlar],
                "tani": {"sebep": "nesne ya da kayıt yok"}}

    N = np.array([n.taban_mm for n in nesneler], np.float64)
    K = np.array([[k.x_mm, k.y_mm] for k in kayitlar], np.float64)
    R = np.array([yaricap(k, ayar) for k in kayitlar], np.float64)

    D = np.linalg.norm(N[:, None, :] - K[None, :, :], axis=2)   # nesne x kayıt
    BUYUK = 1e6
    maliyet = np.where(D <= R[None, :], D, BUYUK)

    if _SCIPY:
        si, sj = linear_sum_assignment(maliyet)
        gecerli = maliyet[si, sj] < BUYUK
        si, sj = si[gecerli], sj[gecerli]
    else:
        si, sj = _greedy(maliyet, BUYUK)

    eslesme = {}
    for i, j in zip(si, sj):
        eslesme[nesneler[i].id] = {
            "kayit_id": kayitlar[j].id,
            "tur": kayitlar[j].tur,
            "yas_gun": kayitlar[j].yas_gun,
            "mesafe_mm": round(float(D[i, j]), 2),
            "yaricap_mm": round(float(R[j]), 1),
            # 0 mesafede 1.0, yarıçap kenarında 0.0 — konum güven skoru
            "konum_skoru": round(float(max(0.0, 1.0 - D[i, j] / max(R[j], 1e-6))), 3),
        }

    eslesen_kayit = {v["kayit_id"] for v in eslesme.values()}
    mesafeler = [v["mesafe_mm"] for v in eslesme.values()]
    return {
        "eslesme": eslesme,
        "eslesmeyen_nesneler": [n.id for n in nesneler if n.id not in eslesme],
        "bos_kayitlar": [k.id for k in kayitlar if k.id not in eslesen_kayit],
        "tani": {
            "yontem": "macar" if _SCIPY else "acgozlu(scipy yok)",
            "eslesen": len(eslesme),
            "ortalama_mesafe_mm": round(float(np.mean(mesafeler)), 2) if mesafeler else None,
            "max_mesafe_mm": round(float(np.max(mesafeler)), 2) if mesafeler else None,
        },
    }
