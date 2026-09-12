"""
etiket — AprilTag 36h11 bulucu (kalibrasyon ve her taramadaki doğrulama için).

Ek bağımlılık istemez: OpenCV'nin kendi ArUco çözücüsünde DICT_APRILTAG_36h11
hazır gelir. `pupil-apriltags` kuruluysa ve daha iyi sonuç veriyorsa
`motor="pupil"` ile ona geçilebilir.

Sahada öğrenilen iki kural koda gömülüdür:
  * Etiketler karede küçük ve eğik göründüğünde VARSAYILAN parametreler onları
    kaçırır. Aşağıdaki parametre seti kaçırmamak üzere gevşetilmiştir
    (yavaş ama doğru): alt örnekleme kapalı, köşe iyileştirme açık,
    uyarlamalı eşikleme penceresi geniş.
  * Etiketler toprak yüzeyinde ve aynı düzlemde olmalıdır. Havada duran etiket
    eğik kamerada santimlerce kaydırır; `duzlem.paralaks_duzelt` bunu ancak
    yüksekliği biliyorsa düzeltebilir.
"""

from __future__ import annotations

import numpy as np
import cv2


def _dedektor():
    sozluk = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_APRILTAG_36h11)
    p = cv2.aruco.DetectorParameters()
    # --- küçük ve eğik etiketler için gevşetilmiş eşikler ---
    p.adaptiveThreshWinSizeMin = 5
    p.adaptiveThreshWinSizeMax = 45
    p.adaptiveThreshWinSizeStep = 4
    p.adaptiveThreshConstant = 7
    p.minMarkerPerimeterRate = 0.005      # varsayılan 0.03 -> çok küçükleri kaçırır
    p.maxMarkerPerimeterRate = 4.0
    p.polygonalApproxAccuracyRate = 0.06  # eğik bakışta köşeler bozulur
    p.minCornerDistanceRate = 0.03
    p.perspectiveRemovePixelPerCell = 8
    p.perspectiveRemoveIgnoredMarginPerCell = 0.13
    p.maxErroneousBitsInBorderRate = 0.5
    p.errorCorrectionRate = 0.8
    # --- alt piksel köşe iyileştirme: kalibrasyon doğruluğunun anası ---
    p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_APRILTAG
    p.cornerRefinementWinSize = 7
    p.cornerRefinementMaxIterations = 60
    p.cornerRefinementMinAccuracy = 0.01
    return cv2.aruco.ArucoDetector(sozluk, p)


_DED = None


def bul(bgr: np.ndarray, beklenen_idler=None) -> dict:
    """
    Döner: {"etiketler": {id: {"merkez":[x,y], "koseler":[[x,y]x4],
                              "kenar_px": float}},
            "eksik": [id...], "tani": {...}}
    Merkez, dört köşenin köşegen kesişimi değil ortalamasıdır; 36h11 için
    kare merkezi budur.
    """
    global _DED
    if _DED is None:
        _DED = _dedektor()
    gri = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
    koseler, idler, _ = _DED.detectMarkers(gri)

    cikti = {}
    if idler is not None:
        for k, i in zip(koseler, idler.flatten()):
            k = k.reshape(4, 2).astype(np.float64)
            kenarlar = [float(np.linalg.norm(k[j] - k[(j + 1) % 4])) for j in range(4)]
            cikti[int(i)] = {
                "merkez": k.mean(axis=0).tolist(),
                "koseler": k.tolist(),
                "kenar_px": float(np.mean(kenarlar)),
                "kenar_sapma_px": float(np.std(kenarlar)),  # büyükse çok eğik bakış
            }

    beklenen = list(beklenen_idler or [])
    eksik = [i for i in beklenen if i not in cikti]
    return {
        "etiketler": cikti,
        "eksik": eksik,
        "tani": {
            "bulunan_sayi": len(cikti),
            "bulunan_idler": sorted(cikti),
            "kare_boyu": [int(gri.shape[1]), int(gri.shape[0])],
            "en_kucuk_kenar_px": (round(min(e["kenar_px"] for e in cikti.values()), 1)
                                  if cikti else None),
        },
    }


def bul_pencereli(bgr, duzlem, beklenen_idler, pencere_kat=3.5) -> dict:
    """
    Etiketler taşınmadıkça KAREDE NEREDE OLDUKLARI bilinir. Tam kareyi taramak
    yerine her etiketin bilinen konumu çevresinde küçük bir pencere aranır;
    tam çözünürlükte bu, tarama başına yüzlerce milisaniye kazandırır.

    Bir etiket penceresinde bulunamazsa TAM KARE aramasına düşülür — kamera
    gerçekten oynamış olabilir ve bunu kaçırmak, yavaş kalmaktan kötüdür.
    """
    if not duzlem.etiketler:
        return bul(bgr, beklenen_idler)
    Hkare, Wkare = bgr.shape[:2]
    bulunan, pencere_tani = {}, {}
    for sid, kayit in duzlem.etiketler.items():
        i = int(sid)
        if beklenen_idler and i not in beklenen_idler:
            continue
        try:
            merkez = duzlem.mm_to_piksel([kayit["mm"]])[0]
        except ValueError:
            return bul(bgr, beklenen_idler)
        kenar = float(kayit.get("kenar_px") or 0) or (min(Wkare, Hkare) * 0.05)
        yari = int(max(kenar * pencere_kat, 60))
        x0 = max(0, int(merkez[0]) - yari); x1 = min(Wkare, int(merkez[0]) + yari)
        y0 = max(0, int(merkez[1]) - yari); y1 = min(Hkare, int(merkez[1]) + yari)
        if x1 - x0 < 40 or y1 - y0 < 40:
            continue
        alt = bul(bgr[y0:y1, x0:x1], [i])
        if i in alt["etiketler"]:
            e = alt["etiketler"][i]
            e["merkez"] = [e["merkez"][0] + x0, e["merkez"][1] + y0]
            e["koseler"] = [[k[0] + x0, k[1] + y0] for k in e["koseler"]]
            bulunan[i] = e
            pencere_tani[sid] = [x1 - x0, y1 - y0]

    beklenen = list(beklenen_idler or [])
    eksik = [i for i in beklenen if i not in bulunan]
    if eksik:                                   # pencerede yoksa tam kareye düş
        tam = bul(bgr, beklenen_idler)
        tam["tani"]["arama"] = f"pencere_basarisiz({eksik})->tam_kare"
        return tam
    return {"etiketler": bulunan, "eksik": [],
            "tani": {"bulunan_sayi": len(bulunan), "bulunan_idler": sorted(bulunan),
                     "kare_boyu": [Wkare, Hkare], "arama": "pencere",
                     "pencereler": pencere_tani,
                     "en_kucuk_kenar_px": (round(min(e["kenar_px"] for e in bulunan.values()), 1)
                                           if bulunan else None)}}


def dogrula(bgr, duzlem, gerekli_idler, max_artik_mm: float,
            bulunan: dict | None = None) -> dict:
    """
    Her taramanın ilk adımı. Kalibrasyon hâlâ geçerli mi?
      * Bir etiket eksikse: kadraj kapalı (portal yatağın üstünde?) ya da
        kamera oynamış.
      * Artık büyükse: kamera kaymış -> koordinat yayımlama.

    `bulunan`: daha önce çağrılmış bul() sonucu. Etiket arama karenin en pahalı
    adımıdır (tam çözünürlükte yüz milisaniyeler); tarama başına bir kez
    çalışsın diye sonuç dışarıdan geçirilir.
    """
    b = bulunan if bulunan is not None else bul(bgr, gerekli_idler)
    if bulunan is not None:
        b = dict(b)
        b["eksik"] = [i for i in (gerekli_idler or []) if i not in b["etiketler"]]
    if b["eksik"]:
        return {"gecerli": False, "sebep": f"etiket görünmüyor: {b['eksik']}",
                "artik_rms_mm": None, **b["tani"]}
    if not duzlem.etiketler:
        return {"gecerli": False, "sebep": "kalibrasyonda etiket kaydı yok",
                "artik_rms_mm": None, **b["tani"]}

    hatalar, detay = [], {}
    for sid, kayit in duzlem.etiketler.items():
        i = int(sid)
        if i not in b["etiketler"]:
            continue
        olculen = duzlem.piksel_to_mm([b["etiketler"][i]["merkez"]])[0]
        h = float(np.linalg.norm(olculen - np.asarray(kayit["mm"], np.float64)))
        hatalar.append(h)
        detay[sid] = round(h, 2)

    if not hatalar:
        return {"gecerli": False, "sebep": "eşleşen etiket yok",
                "artik_rms_mm": None, **b["tani"]}

    rms = float(np.sqrt(np.mean(np.square(hatalar))))
    return {
        "gecerli": rms <= max_artik_mm,
        "sebep": None if rms <= max_artik_mm
                 else f"kalibrasyon kaymış: {rms:.1f} mm > {max_artik_mm} mm",
        "artik_rms_mm": round(rms, 3),
        "artik_max_mm": round(max(hatalar), 3),
        "etiket_basina_mm": detay,
        **b["tani"],
    }
