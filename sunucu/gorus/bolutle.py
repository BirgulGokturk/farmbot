"""
bolutle — bitki örtüsü / toprak ayrımı (yeşil maske).

Faz 1 algoritma (öğrenmesiz, veri seti gerektirmez, Pi 5 CPU'da milisaniyeler):

  1. Normalize kromatiklik:  r=R/(R+G+B), g=G/(...), b=B/(...)
     Parlaklığa bölmek gölge/ışık farkını büyük ölçüde siler.
  2. ExG  = 2g - r - b        (Woebbecke, aşırı yeşil indeksi)
     ExR  = 1.4r - g
     ExGR = ExG - ExR         (toprak kırmızısını daha sert bastırır)
  3. Otsu eşiği ExGR üstünde — yatak ROI'si içindeki histogramdan, kadrajın
     tamamından değil. Yatağın dışındaki çim/beton histogramı bozar.
  4. L*a*b* a* kanalı ile AND: a* < 0 yeşil demektir ve parlaklıktan
     büyük ölçüde bağımsızdır. İki bağımsız kanıt, yanlış pozitifi düşürür.
  5. Gölge ve yanmış piksel elemesi (HSV V), morfolojik açma+kapama.

Neden bu, hazır bir modelle başlamak yerine:
  * Etiketli veri yok. Faz 1 ilk günden koordinat üretir.
  * Kalibrasyon hatasını modelin hatasından ayırt edilebilir kılar — sistem
    çalışmadığında sorunun geometride mi renkte mi olduğu görülebilir.
  * Faz 2'de (Hailo) üretilen bu maske zayıf etiket (weak label) olarak
    kullanılır; veri toplama işi kendiliğinden döner.
"""

from __future__ import annotations

import numpy as np
import cv2


def _indeksler(bgr: np.ndarray):
    f = bgr.astype(np.float32)
    B, G, R = f[:, :, 0], f[:, :, 1], f[:, :, 2]
    top = B + G + R
    np.maximum(top, 1e-6, out=top)
    r, g, b = R / top, G / top, B / top
    exg = 2.0 * g - r - b
    exr = 1.4 * r - g
    return exg, exg - exr


def yesil_maske(bgr, ayar, roi_maske=None) -> tuple[np.ndarray, dict]:
    """Döner: (maske uint8 0/255, tani)"""
    exg, exgr = _indeksler(bgr)

    # --- Otsu eşiğini yalnız ROI histogramından çıkar ---
    if ayar.otsu_kullan:
        vals = exgr if roi_maske is None else exgr[roi_maske > 0]
        if vals.size < 1000:
            esik, otsu_kaynak = float(ayar.exg_alt_sinir), "yetersiz_roi_taban_esik"
        else:
            u8 = np.clip((vals + 1.0) * 127.5, 0, 255).astype(np.uint8)
            t_u8, _ = cv2.threshold(u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            esik, otsu_kaynak = float(t_u8) / 127.5 - 1.0, "otsu"
        # Otsu, karede hiç bitki yokken toprağı ikiye böler; tabanla korunuruz.
        if esik < ayar.exg_alt_sinir:
            esik, otsu_kaynak = float(ayar.exg_alt_sinir), otsu_kaynak + "+taban"
    else:
        esik, otsu_kaynak = float(ayar.exg_alt_sinir), "sabit"

    m = (exgr >= esik).astype(np.uint8) * 255

    # --- ikinci kanıt: L*a*b* a* ---
    a_orani = None
    if ayar.lab_agirlik:
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
        a = lab[:, :, 1].astype(np.int16) - 128      # OpenCV a* = a+128
        a_maske = (a <= ayar.lab_a_ust_sinir).astype(np.uint8) * 255
        a_orani = float(np.mean(a_maske > 0))
        m = cv2.bitwise_and(m, a_maske)

    # --- gölge / yanma elemesi ---
    v = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 2]
    m[v < ayar.gölge_v_alt] = 0
    m[v > ayar.parlak_v_ust] = 0

    if roi_maske is not None:
        m = cv2.bitwise_and(m, roi_maske)

    ham_oran = float(np.mean(m > 0))

    # --- morfoloji ---
    if ayar.acma_px > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ayar.acma_px, ayar.acma_px))
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    if ayar.kapama_px > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ayar.kapama_px, ayar.kapama_px))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k)

    tani = {
        "esik_exgr": round(esik, 4),
        "esik_kaynagi": otsu_kaynak,
        "yesil_oran_ham": round(ham_oran, 5),
        "yesil_oran_morfoloji_sonrasi": round(float(np.mean(m > 0)), 5),
        "lab_a_oran": round(a_orani, 5) if a_orani is not None else None,
        "roi_piksel": int(cv2.countNonZero(roi_maske)) if roi_maske is not None else None,
    }
    # Aşırı uçlar sessizce geçmesin: sonuç şüpheliyse damgala.
    if tani["yesil_oran_morfoloji_sonrasi"] > 0.45:
        tani["uyari"] = "yeşil oran çok yüksek — eşik düşük ya da yatakta örtü var"
    elif tani["yesil_oran_morfoloji_sonrasi"] < 1e-5:
        tani["uyari"] = "hiç yeşil bulunamadı — pozlama, eşik ya da ROI hatalı olabilir"
    return m, tani
