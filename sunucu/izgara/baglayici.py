"""Mevcut `kalibrasyon.py` biçimine köprü.

Sunucudaki `tespit.piksel_mm()` kalibrasyondaki `harita` alanını (3x3
homografi) okuyor ve distorsiyon bilmiyor. Bu modül ızgara modelinden o
biçime EN İYİ YAKLAŞIMI üretiyor — ve ne kadar doğruluk kaybedildiğini
SAYIYLA söylüyor, çünkü köprü kayıpsız değil:

  * homografi radyal distorsiyonu temsil edemez
  * tek bir homografi tek bir yükseklik içindir; paralaks düzeltmesi
    köprüden geçmez

Kayıp kabul edilebilir çıkarsa hiçbir dosyayı değiştirmeden bugün
kullanmaya başlarsınız. Kabul edilemezse tam modeli bağlamak gerekir.
"""
from __future__ import annotations

import numpy as np

try:
    import cv2
except ImportError as _e:                                   # pragma: no cover
    raise ImportError("izgara.baglayici OpenCV gerektiriyor") from _e

from .model import Model


def _ornek_pikseller(model: Model, adet: int = 60) -> np.ndarray:
    """Kalibre edilen bölgeyi kaplayan örnek noktalar."""
    k = np.asarray(model.kabuk_px, float)
    if k.size == 0:
        g, y = model.kare_boyutu
        k = np.array([[0, 0], [g, 0], [g, y], [0, y]], float)
    x0, y0 = k.min(axis=0)
    x1, y1 = k.max(axis=0)
    n = int(np.sqrt(adet)) + 1
    gx, gy = np.meshgrid(np.linspace(x0, x1, n), np.linspace(y0, y1, n))
    px = np.c_[gx.ravel(), gy.ravel()]
    return px[model.kalibre_bolgede_mi(px)]


def harita_uret(model: Model, h_mm: float = 0.0) -> dict:
    """`kalibrasyon.py` biçiminde alanlar + köprünün kaybı.

    Dönen sözlükteki `harita`, `mm_px`, `genislik_px`, `yukseklik_px`
    doğrudan mevcut kalibrasyon kaydına yazılabilir. `kopru_kaybi`
    yazılmaz; kararı vermek için okunur.
    """
    px = _ornek_pikseller(model)
    if len(px) < 8:
        raise ValueError("Kalibre edilen bölge çok küçük; köprü kurulamadı.")
    mm = model.px2mm(px, h_mm if model.tur == "uzay" else None)

    H, _ = cv2.findHomography(px, mm, 0)
    if H is None:
        raise ValueError("Köprü homografisi kurulamadı.")
    geri = cv2.perspectiveTransform(px.reshape(-1, 1, 2), H).reshape(-1, 2)
    d = np.linalg.norm(geri - mm, axis=1)

    olcek = model.yerel_mm_px(px, h_mm if model.tur == "uzay" else 0.0)
    return {
        # --- mevcut kalibrasyon kaydına yazılacak alanlar
        "harita": [[float(v) for v in satir] for satir in H],
        "mm_px": float(np.median(olcek)),
        "genislik_px": int(model.kare_boyutu[0]),
        "yukseklik_px": int(model.kare_boyutu[1]),
        # --- karar için
        "kopru_kaybi": {
            "yukseklik_mm": float(h_mm),
            "ornek_nokta": int(len(px)),
            "rms_mm": round(float(np.sqrt(np.mean(d ** 2))), 3),
            "maks_mm": round(float(d.max()), 3),
            "not": ("Bu, ızgara modeli ile tek homografi arasındaki fark. "
                    "Gerçek hata = bu + modelin kendi hatası. Paralaks "
                    "düzeltmesi köprüden GEÇMEZ: bu homografi yalnız "
                    f"{h_mm:.0f} mm yüksekliği için geçerli."),
        },
        "olcek_mm_px_en_kucuk": round(float(olcek.min()), 4),
        "olcek_mm_px_en_buyuk": round(float(olcek.max()), 4),
    }


def kayda_yaz(kalib: dict, model: Model, h_mm: float = 0.0) -> dict:
    """Var olan kalibrasyon sözlüğünün KOPYASINI güncelleyip döner.

    Yerinde değiştirmiyor: çağıran ne yazacağına kendisi karar versin.
    """
    u = harita_uret(model, h_mm)
    yeni = dict(kalib or {})
    for a in ("harita", "mm_px", "genislik_px", "yukseklik_px"):
        yeni[a] = u[a]
    yeni["izgara_kaynak"] = {"model": model.tur, "zaman": model.zaman,
                             "yukseklik_mm": float(h_mm),
                             "kopru_rms_mm": u["kopru_kaybi"]["rms_mm"]}
    return yeni
