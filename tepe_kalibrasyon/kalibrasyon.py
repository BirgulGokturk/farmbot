"""
Tepe kamerasi kalibrasyon cekirdegi.

Girdi : bir kare (BGR numpy dizisi) + her AprilTag kimligi icin makine koordinati
Cikti : goruntu pikseli -> makine milimetresi donusumu (iki model) ve durust hata olcusu

Bu dosya arayuzden bagimsizdir; sunucu.py bunu cagirir.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import Any

import cv2
import numpy as np

SURUM = "1.0"

# ---------------------------------------------------------------------------
# 1) Tespit
# ---------------------------------------------------------------------------


def _parametreler() -> Any:
    """
    Kucuk ve perspektifte yamulmus etiketler icin ayarlanmis tespit parametreleri.

    Varsayilanlardan farklari ve nedenleri:
      - useAruco3Detection = False : Aruco3 hizi icin kareyi kucultup arar,
        kucuk etiketleri tam da bu yuzden kacirir.
      - minMarkerPerimeterRate 0.03 -> 0.008 : 3840 px genislikte 0.03 orani
        yaklasik 29 px kenardan kucuk etiketi eler. 0.008 ile ~8 px kenara iner.
      - polygonalApproxAccuracyRate 0.03 -> 0.06 : egik bakista kenarlar hafif
        egri gorunur; siki tolerans dortgeni reddeder.
      - perspectiveRemovePixelPerCell 4 -> 8 : bit okumasi yamuk etikette daha
        cok orneklemeyle daha guvenilir.
      - maxErroneousBitsInBorderRate 0.35 -> 0.5 ve errorCorrectionRate 0.6 :
        36h11 guclu hata duzeltmeye sahip, esigi gevsetmek kayip etiket sayisini
        dusuruyor.
      - adaptiveThreshWinSize araligi genis : yatak uzerinde isik gradyani varsa
        tek pencere boyu yetmez.
      - minDistanceToBorder 3 -> 1 : kadrajin kenarina yakin etiket de sayilsin.
    """
    a = cv2.aruco
    p = a.DetectorParameters()
    p.useAruco3Detection = False
    p.adaptiveThreshWinSizeMin = 3
    p.adaptiveThreshWinSizeMax = 63
    p.adaptiveThreshWinSizeStep = 6
    p.adaptiveThreshConstant = 7
    p.minMarkerPerimeterRate = 0.008
    p.maxMarkerPerimeterRate = 4.0
    p.polygonalApproxAccuracyRate = 0.06
    p.minCornerDistanceRate = 0.02
    p.minMarkerDistanceRate = 0.01
    p.minDistanceToBorder = 1
    p.perspectiveRemovePixelPerCell = 8
    p.perspectiveRemoveIgnoredMarginPerCell = 0.13
    p.maxErroneousBitsInBorderRate = 0.5
    p.errorCorrectionRate = 0.6
    p.detectInvertedMarker = True
    p.markerBorderBits = 1
    p.cornerRefinementMethod = a.CORNER_REFINE_SUBPIX
    p.cornerRefinementWinSize = 5
    p.cornerRefinementMaxIterations = 60
    p.cornerRefinementMinAccuracy = 0.01
    return p


def parametre_ozeti() -> dict:
    p = _parametreler()
    return {
        k: getattr(p, k)
        for k in (
            "useAruco3Detection",
            "adaptiveThreshWinSizeMin",
            "adaptiveThreshWinSizeMax",
            "adaptiveThreshWinSizeStep",
            "minMarkerPerimeterRate",
            "polygonalApproxAccuracyRate",
            "perspectiveRemovePixelPerCell",
            "maxErroneousBitsInBorderRate",
            "errorCorrectionRate",
            "minDistanceToBorder",
        )
    }


def _ham_tespit(gri: np.ndarray, sozluk_kimlik: int | None = None):
    """
    Dondurur: ({kimlik: 4x2 kose}, reddedilen_aday_listesi)

    Reddedilen adaylar onemli: dedektor kare bir sekil gordu ama icindeki biti
    okuyamadi demektir. Hic etiket bulunamadiginda "hic kare sekil yok" ile
    "kareler var ama cozulemiyor" ayrimini bu sayi verir.
    """
    a = cv2.aruco
    sozluk = a.getPredefinedDictionary(a.DICT_APRILTAG_36h11 if sozluk_kimlik is None else sozluk_kimlik)
    dedektor = a.ArucoDetector(sozluk, _parametreler())
    koseler, kimlikler, reddedilen = dedektor.detectMarkers(gri)
    sonuc: dict[int, np.ndarray] = {}
    if kimlikler is not None:
        for k, c in zip(kimlikler.flatten().tolist(), koseler):
            sonuc[int(k)] = c.reshape(4, 2).astype(np.float64)
    return sonuc, (list(reddedilen) if reddedilen is not None else [])


def _aday_ozeti(adaylar: list, gri: np.ndarray | None = None, olcek: float = 1.0) -> dict:
    """
    Reddedilen dortgenlerin ozeti (orijinal kare pikselinde).

    Toprak dokusu yuzlerce kucuk sahte aday uretiyor, bu yuzden HAM medyan
    anlamsiz. Etiketler en buyuk adaylar arasindadir; olculer en buyuk 20 aday
    uzerinden veriliyor. Keskinlik de yalnizca o yamalar icinde olculuyor —
    kare genelinde Laplace varyansi duz zeminle seyreliyor ve calisan bir kareyi
    "bulanik" diye isaretliyor (olculdu: calisan temiz karede genel varyans 24).
    """
    kutular = []
    for c in adaylar:
        p = np.asarray(c, dtype=np.float64).reshape(-1, 2) / olcek
        if len(p) != 4:
            continue
        kenar = float(np.mean([np.linalg.norm(p[i] - p[(i + 1) % 4]) for i in range(4)]))
        kutular.append((kenar, p))
    if not kutular:
        return {"sayi": int(len(adaylar)), "buyuk_aday_sayisi": 0}
    kutular.sort(key=lambda z: -z[0])
    buyuk = kutular[:20]
    k = np.array([z[0] for z in buyuk])
    ozet = {
        "sayi": int(len(adaylar)),
        "buyuk_aday_sayisi": int(sum(1 for z in kutular if z[0] >= 12.0)),
        "en_buyuk_20_medyan_kenar_px": round(float(np.median(k)), 2),
        "en_buyuk_kenar_px": round(float(k.max()), 2),
    }
    if gri is not None:
        keskinlik = []
        for _, p in buyuk:
            x0, y0 = np.floor(p.min(0) * olcek).astype(int)
            x1, y1 = np.ceil(p.max(0) * olcek).astype(int)
            x0, y0 = max(0, x0), max(0, y0)
            x1, y1 = min(gri.shape[1], x1), min(gri.shape[0], y1)
            yama = gri[y0:y1, x0:x1]
            if yama.size > 50:
                keskinlik.append(float(cv2.Laplacian(yama, cv2.CV_64F).var()))
        if keskinlik:
            ozet["aday_yerel_keskinlik"] = round(float(np.median(keskinlik)), 1)
    return ozet


_TANI_SOZLUKLER = [
    ("AprilTag 36h11 (beklenen)", "DICT_APRILTAG_36h11"),
    ("AprilTag 36h10", "DICT_APRILTAG_36h10"),
    ("AprilTag 25h9", "DICT_APRILTAG_25h9"),
    ("AprilTag 16h5", "DICT_APRILTAG_16h5"),
    ("ArUco 4x4", "DICT_4X4_250"),
    ("ArUco 5x5", "DICT_5X5_250"),
    ("ArUco 6x6", "DICT_6X6_250"),
    ("ArUco 7x7", "DICT_7X7_250"),
    ("ArUco orijinal", "DICT_ARUCO_ORIGINAL"),
]


def tani(bgr: np.ndarray, beklenen: list[int] | None = None) -> dict:
    """
    Hicbir etiket bulunamadiginda ne oldugunu anlamak icin olculebilir kontroller.
    Tahmin uretmez; yalnizca ne bulundugunu ve ne bulunmadigini yazar.

    'beklenen' verilirse iddialar keskinlesir: toprak dokusu gevsetilmis
    parametrelerle ara sira sahte kimlik cozduruyor (olculdu: etiketleri 36h11 olan
    bulanik bir karede ArUco 4x4 ailesinde alakasiz iki kimlik cikti). Bu yuzden
    "yanlis aile" ya da "aynalanmis" denmesi icin o ailede BEKLENEN kimliklerden
    en az ikisinin cozulmesi sart kosuluyor.
    """
    beklenen_kume = set(int(x) for x in (beklenen or []))
    gri = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
    H, W = gri.shape[:2]
    bulgular = []

    # 1) Baska etiket aileleri: yanlis aile basilmis olabilir
    for ad, anahtar in _TANI_SOZLUKLER:
        kod = getattr(cv2.aruco, anahtar, None)
        if kod is None:
            continue
        try:
            bulundu, _ = _ham_tespit(gri, kod)
        except cv2.error:
            continue
        if bulundu:
            bulgular.append({"tur": "aile", "ad": ad, "kimlikler": sorted(bulundu.keys())})

    # 2) Aynalanmis baski: yansitilmis karede 36h11 cozuluyor mu
    aynali, _ = _ham_tespit(cv2.flip(gri, 1))
    if aynali:
        bulgular.append({"tur": "ayna", "ad": "yatay aynalanmis 36h11", "kimlikler": sorted(aynali.keys())})

    # 3) Kare sekil var mi, ne kadar buyuk, ne kadar keskin
    _, adaylar_1x = _ham_tespit(gri)
    aday_1x = _aday_ozeti(adaylar_1x, gri)
    buyuk = cv2.resize(gri, (W * 2, H * 2), interpolation=cv2.INTER_CUBIC)
    _, adaylar_2x = _ham_tespit(buyuk)
    aday_2x = _aday_ozeti(adaylar_2x, buyuk, olcek=2.0)
    del buyuk

    yorumlar = []
    # Aile iddiasi icin en az 2 ayri kimlik sart: toprak dokusu tek bir sahte
    # kimlik uretebiliyor (olculdu) ve tek kimlikle "yanlis aile" demek yaniltir.
    def _ikna_edici(b: dict) -> bool:
        k = set(b["kimlikler"])
        if beklenen_kume:
            return len(k & beklenen_kume) >= 2
        return len(k) >= 3          # beklenen liste verilmediyse daha yuksek esik

    aile = [b for b in bulgular
            if b["tur"] == "aile" and not b["ad"].startswith("AprilTag 36h11") and _ikna_edici(b)]
    if aile:
        yorumlar.append(
            "Etiketler BAŞKA bir ailede çözülüyor: " +
            "; ".join(f"{b['ad']} → kimlik {b['kimlikler']}" for b in aile) +
            ". Beklediğiniz kimliklerin en az ikisi bu ailede çözüldüğü için bu sahte bir eşleşme değil: "
            "kâğıda basılan etiketler 36h11 değil. Ya 36h11 basın ya da o aileyi kullanın."
        )
    if any(b["tur"] == "ayna" and _ikna_edici(b) for b in bulgular):
        ay = next(b for b in bulgular if b["tur"] == "ayna")
        yorumlar.append(
            f"Kare yatay aynalandığında etiketler çözülüyor (kimlik {ay['kimlikler']}). Baskı ya da "
            f"kamera görüntüsü aynalanmış; aynalanmış bir AprilTag hiçbir dedektör tarafından okunamaz."
        )
    en_iyi = aday_2x if aday_2x.get("buyuk_aday_sayisi", 0) >= aday_1x.get("buyuk_aday_sayisi", 0) else aday_1x
    if en_iyi.get("buyuk_aday_sayisi", 0) == 0:
        yorumlar.append(
            "Karede 12 px'ten büyük kare biçimli hiçbir aday yok. Etiketler kadrajda olmayabilir, "
            "çok küçük kalıyor olabilir ya da kontrast okunamayacak kadar düşük olabilir."
        )
    else:
        yorumlar.append(
            f"Karede 12 px'ten büyük {en_iyi['buyuk_aday_sayisi']} kare biçimli aday var; en büyük 20 "
            f"adayın medyan kenarı {en_iyi['en_buyuk_20_medyan_kenar_px']} px, en büyüğü "
            f"{en_iyi['en_buyuk_kenar_px']} px. Bunlar dedektörün kare olarak gördüğü ama bit desenini "
            f"36h11 diye çözemediği şekiller (toprak dokusu da bolca sahte aday üretir). "
            f"Bu boru hattında ölçülen alt sınır ~16 px etiket kenarıdır."
        )
    if "aday_yerel_keskinlik" in en_iyi:
        yorumlar.append(
            f"Aday yamalarındaki yerel keskinlik {en_iyi['aday_yerel_keskinlik']} "
            f"(referans olarak ölçüldü: net sentetik karede ~1000–1500, 1.6 px bulanıklıkta ~80–110). "
            f"Bu tek başına bir hüküm değil — bulanıklığın etiketi kaybettirip kaybettirmediği etiketin "
            f"kaç piksel olduğuna bağlı: 48 px etikette bu değer 78 iken dördü de bulunuyordu, "
            f"21 px etikette 112 iken hiçbiri bulunamadı."
        )

    return {
        "kare_boyutu": [int(W), int(H)],
        "bulgular": bulgular,
        "aday_dortgenler_1x": aday_1x,
        "aday_dortgenler_2x": aday_2x,
        "parlaklik_ortalama": round(float(gri.mean()), 1),
        "parlaklik_std": round(float(gri.std()), 1),
        "yorumlar": yorumlar,
    }


def _alt_piksel_iyilestir(gri: np.ndarray, koseler: np.ndarray) -> tuple[np.ndarray, float]:
    """Orijinal cozunurlukte cornerSubPix. Kaydirma miktarini da dondurur (px)."""
    kenar = float(np.mean([np.linalg.norm(koseler[i] - koseler[(i + 1) % 4]) for i in range(4)]))
    win = int(max(2, min(11, round(kenar / 10.0))))
    nokta = koseler.astype(np.float32).reshape(-1, 1, 2).copy()
    olcut = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 0.005)
    try:
        cv2.cornerSubPix(gri, nokta, (win, win), (-1, -1), olcut)
    except cv2.error:
        return koseler, 0.0
    yeni = nokta.reshape(4, 2).astype(np.float64)
    kayma = float(np.max(np.linalg.norm(yeni - koseler, axis=1)))
    # cornerSubPix bazen kacar; makul olmayan sicramayi geri al
    if kayma > max(2.0, kenar * 0.15):
        return koseler, 0.0
    return yeni, kayma


@dataclass
class Tespit:
    kimlik: int
    koseler: list[list[float]]          # 4x2, orijinal kare pikselinde, alt piksel
    merkez: list[float]                 # kosegen kesisimi (projektif olarak dogru merkez)
    kenar_px: float
    asama: str                          # hangi gecisde bulundu
    alt_piksel_kayma_px: float


def _merkez(koseler: np.ndarray) -> np.ndarray:
    """
    Kosegenlerin kesisimi. Perspektifte dort kosenin ortalamasi etiket merkezini
    vermez (yamuk sekil), kosegen kesisimi verir.
    """
    p1, p2, p3, p4 = koseler
    d1 = p3 - p1
    d2 = p4 - p2
    A = np.array([[d1[0], -d2[0]], [d1[1], -d2[1]]], dtype=np.float64)
    b = p2 - p1
    det = np.linalg.det(A)
    if abs(det) < 1e-9:
        return koseler.mean(axis=0)
    t = np.linalg.solve(A, b)
    return p1 + t[0] * d1


def etiketleri_bul(bgr: np.ndarray, beklenen: list[int] | None = None) -> tuple[list[Tespit], dict]:
    """
    Coklu gecisli tespit:
      1. gecis : orijinal cozunurluk
      2. gecis : 2x buyutme (kucuk etiketler icin)
      3. gecis : 4x buyutme (yalnizca hala eksik varsa; karanlik/cok kucuk kare)
    Sonraki gecisler yalnizca hala eksik olan kimlikleri arar; koseler her zaman
    orijinal kare koordinatina geri tasinip orada alt piksel iyilestirilir.
    """
    gri = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
    H, W = gri.shape[:2]
    bulunan: dict[int, Tespit] = {}
    gunluk: list[str] = []

    def kaydet(kimlik: int, kose_orj: np.ndarray, asama: str):
        if kimlik in bulunan:
            return
        iyi, kayma = _alt_piksel_iyilestir(gri, kose_orj)
        kenar = float(np.mean([np.linalg.norm(iyi[i] - iyi[(i + 1) % 4]) for i in range(4)]))
        bulunan[kimlik] = Tespit(
            kimlik=kimlik,
            koseler=iyi.tolist(),
            merkez=_merkez(iyi).tolist(),
            kenar_px=kenar,
            asama=asama,
            alt_piksel_kayma_px=round(kayma, 3),
        )

    # 1. gecis
    ilk, ilk_adaylar = _ham_tespit(gri)
    for k, c in ilk.items():
        kaydet(k, c, "1x")
    gunluk.append(f"1. geçiş (1x): {len(bulunan)} etiket, {len(ilk_adaylar)} çözülemeyen kare aday")

    def eksik_var() -> bool:
        if beklenen:
            return any(k not in bulunan for k in beklenen)
        return len(bulunan) < 4

    # 2. ve 3. gecis: buyutup yeniden dene. Olculdu: 2x, varsayilan gecisin kacirdigi
    # etiketleri geri kazaniyor; 4x ise yalnizca cok karanlik/cok kucuk karelerde
    # ek kazanc sagliyor, o yuzden sadece hala eksik varsa calisiyor.
    for olcek in (2, 4):
        if not eksik_var():
            break
        onceki = len(bulunan)
        buyuk = cv2.resize(gri, (W * olcek, H * olcek), interpolation=cv2.INTER_CUBIC)
        b, _ = _ham_tespit(buyuk)
        for k, c in b.items():
            kaydet(k, c / float(olcek), f"{olcek}x")
        del buyuk
        gunluk.append(f"{olcek}x büyütme geçişi: +{len(bulunan) - onceki} etiket")

    tespitler = sorted(bulunan.values(), key=lambda t: t.kimlik)
    rapor = {
        "kare_boyutu": [int(W), int(H)],
        "gecis_gunlugu": gunluk,
        "bulunan_kimlikler": [t.kimlik for t in tespitler],
        "eksik_kimlikler": [k for k in (beklenen or []) if k not in bulunan],
        "parametreler": parametre_ozeti(),
    }
    return tespitler, rapor


# ---------------------------------------------------------------------------
# 2) Modeller
# ---------------------------------------------------------------------------


def _umeyama(px: np.ndarray, mm: np.ndarray, ayna: bool) -> np.ndarray | None:
    n = len(px)
    mp, mm_ = px.mean(axis=0), mm.mean(axis=0)
    a = px - mp
    b = mm - mm_
    var = float((a ** 2).sum()) / n
    if var < 1e-12:
        return None
    C = (b.T @ a) / n
    U, S, Vt = np.linalg.svd(C)
    D = np.eye(2)
    istenen = -1.0 if ayna else 1.0
    if np.sign(np.linalg.det(U) * np.linalg.det(Vt)) != istenen:
        D[1, 1] = -1.0
    R = U @ D @ Vt
    s = float(np.trace(np.diag(S) @ D) / var)
    if s <= 0:
        return None
    M = np.eye(3)
    M[:2, :2] = s * R
    M[:2, 2] = mm_ - s * (R @ mp)
    return M


def benzerlik_uydur(px: np.ndarray, mm: np.ndarray) -> np.ndarray | None:
    """
    Olcek + donme + kaydirma (4 serbestlik), en kucuk kareler (Umeyama kapali formulu).

    Yansima notu: goruntu ekseni asagi dogru, makine Y ekseni yukari dogru oldugunda
    goruntu -> makine donusumunun determinanti negatif olur. Bu fiziksel bir aynalama
    degil, eksen yonu farkidir; ama sadece "duz donme" arayan bir uydurma bu durumda
    yuzlerce mm hata verir. Bu yuzden iki aile de (aynali/aynasiz) uydurulur ve
    olculen hatasi kucuk olan secilir.
    """
    if len(px) < 2:
        return None
    adaylar = [m for m in (_umeyama(px, mm, False), _umeyama(px, mm, True)) if m is not None]
    if not adaylar:
        return None
    return min(adaylar, key=lambda M: float(np.linalg.norm(uygula(M, px) - mm)))


def homografi_uydur(px: np.ndarray, mm: np.ndarray) -> np.ndarray | None:
    """Projektif donusum (8 serbestlik). En az 4 nokta gerekir."""
    if len(px) < 4:
        return None
    Hm, _ = cv2.findHomography(px.astype(np.float64), mm.astype(np.float64), method=0)
    if Hm is None or not np.isfinite(Hm).all():
        return None
    if abs(np.linalg.det(Hm)) < 1e-12:
        return None
    return Hm.astype(np.float64)


def uygula(M: np.ndarray, noktalar: np.ndarray) -> np.ndarray:
    p = np.hstack([noktalar, np.ones((len(noktalar), 1))])
    q = (M @ p.T).T
    w = q[:, 2:3]
    if np.any(np.abs(w) < 1e-12):
        return np.full((len(noktalar), 2), np.nan)
    return q[:, :2] / w


def _dogrusal_mi(p: np.ndarray, esik_px: float = 1.0) -> bool:
    """Uc veya daha fazla noktanin dogrusala yakin olup olmadigi (dejenere uydurma)."""
    if len(p) < 3:
        return True
    merkez = p.mean(axis=0)
    _, s, _ = np.linalg.svd(p - merkez)
    return bool(s[1] < esik_px)


# ---------------------------------------------------------------------------
# 3) Hata
# ---------------------------------------------------------------------------


def _hatalar(M: np.ndarray, px: np.ndarray, mm: np.ndarray) -> dict:
    tah = uygula(M, px)
    d = np.linalg.norm(tah - mm, axis=1)
    return {
        "nokta_hatalari_mm": [round(float(x), 4) for x in d],
        "rms_mm": round(float(np.sqrt((d ** 2).mean())), 4),
        "maks_mm": round(float(d.max()), 4),
    }


def _kosul(p: np.ndarray) -> float:
    """
    Nokta kumesinin dejenereye ne kadar yakin oldugu: en ince ucgenin alani /
    tum kumenin dis bukey alani. 1'e yakin = iyi yayilmis, 0'a yakin = uc nokta
    neredeyse ayni dogru uzerinde ve uydurma kararsiz.
    """
    n = len(p)
    if n < 3:
        return 0.0
    en_ince = float("inf")
    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                alan = abs(np.cross(p[j] - p[i], p[k] - p[i])) / 2.0
                en_ince = min(en_ince, float(alan))
    kabuk = cv2.convexHull(p.astype(np.float32))
    kabuk_alan = float(abs(cv2.contourArea(kabuk)))
    if kabuk_alan < 1e-9:
        return 0.0
    return en_ince / kabuk_alan


def _ic_mi(nokta: np.ndarray, kume: np.ndarray) -> bool:
    """Disarida birakilan nokta, uydurmada kullanilan noktalarin ic bolgesinde mi?"""
    if len(kume) < 3:
        return False
    kabuk = cv2.convexHull(kume.astype(np.float32))
    return cv2.pointPolygonTest(kabuk, (float(nokta[0]), float(nokta[1])), False) >= 0


def _loo(uydur, px: np.ndarray, mm: np.ndarray, kimlikler: list[int], min_nokta: int) -> dict:
    """
    Bir noktayi disarida birakma. Donusum N-1 noktayla kurulur, disarida
    birakilan noktada sapma olculur. Uydurma icin gereken nokta sayisi
    saglanamiyorsa hesap yapilmaz; uydurma deger uretilmez.
    """
    n = len(px)
    if n - 1 < min_nokta:
        return {
            "hesaplanabilir": False,
            "sebep": (
                f"Model uydurmak için en az {min_nokta} nokta gerekiyor; "
                f"bir nokta dışarıda bırakılınca geriye {n - 1} nokta kalıyor. "
                f"En az {min_nokta + 1} etiket/nokta gerekli."
            ),
        }
    kayitlar = []
    sapmalar = []
    for i in range(n):
        maske = [j for j in range(n) if j != i]
        alt_px, alt_mm = px[maske], mm[maske]
        if _dogrusal_mi(alt_px):
            kayitlar.append({"kimlik": kimlikler[i], "hata_mm": None, "not": "kalan noktalar doğrusal, uydurma dejenere"})
            continue
        Mi = uydur(alt_px, alt_mm)
        if Mi is None:
            kayitlar.append({"kimlik": kimlikler[i], "hata_mm": None, "not": "uydurma başarısız"})
            continue
        tah = uygula(Mi, px[i:i + 1])[0]
        if not np.isfinite(tah).all():
            kayitlar.append({"kimlik": kimlikler[i], "hata_mm": None, "not": "tahmin sonsuzda"})
            continue
        d = float(np.linalg.norm(tah - mm[i]))
        kosul = _kosul(alt_px)
        ic = _ic_mi(px[i], alt_px)
        guvenilir = kosul >= 0.06
        if guvenilir:
            sapmalar.append(d)
        kayitlar.append({
            "kimlik": kimlikler[i],
            "hata_mm": round(d, 4),
            "kosullanma": round(kosul, 4),
            "guvenilir": guvenilir,
            "ic_nokta": bool(ic),
            "beklenen_mm": [round(float(v), 3) for v in mm[i]],
            "tahmin_mm": [round(float(v), 3) for v in tah],
            "sapma_vektoru_mm": [round(float(v), 3) for v in (tah - mm[i])],
        })
    guvenilmez = [k["kimlik"] for k in kayitlar if k.get("guvenilir") is False]
    notlar = []
    if guvenilmez:
        notlar.append(
            "Şu katmanlar dışlandı: " + ", ".join(str(x) for x in guvenilmez) +
            ". O noktalar çıkarıldığında geriye kalan noktalar neredeyse aynı doğru üzerinde kalıyor; "
            "böyle bir katmanın verdiği büyük sayı kalibrasyon hatası değil, geometrinin kararsızlığıdır. "
            "Noktaları yatağa daha dengeli dağıtın."
        )
    if not sapmalar:
        return {
            "hesaplanabilir": False,
            "sebep": "Hiçbir katman güvenilir değil — nokta geometrisi dejenereye çok yakın.",
            "katmanlar": kayitlar,
            "notlar": notlar,
        }
    a = np.array(sapmalar)
    ic_sapma = [k["hata_mm"] for k in kayitlar if k.get("guvenilir") and k.get("ic_nokta")]
    if not ic_sapma:
        notlar.append(
            "Dışarıda bırakılan her nokta, kalan noktaların oluşturduğu dörtgenin DIŞINDA kaldı; "
            "yani bu sayı bir dışdeğerbiçim (ekstrapolasyon) sınavıdır ve yatağın içindeki noktalar için "
            "gerçekte olacak hatadan kötümserdir. Yatağın içinden probla ölçtüğünüz doğrulama noktaları "
            "girerseniz gerçek iç hatayı görürsünüz."
        )
    sonuc = {
        "hesaplanabilir": True,
        "rms_mm": round(float(np.sqrt((a ** 2).mean())), 4),
        "maks_mm": round(float(a.max()), 4),
        "ortalama_mm": round(float(a.mean()), 4),
        "kullanilan_katman_sayisi": int(len(a)),
        "katmanlar": kayitlar,
        "notlar": notlar,
    }
    if ic_sapma:
        b = np.array(ic_sapma)
        sonuc["ic_noktalar_rms_mm"] = round(float(np.sqrt((b ** 2).mean())), 4)
    return sonuc


# ---------------------------------------------------------------------------
# 4) Duzlemsellik / yukseklik kontrolu (homografi icin gercek ornek disi olcum)
# ---------------------------------------------------------------------------


def kenar_kontrolu(Hm: np.ndarray, tespitler: list[Tespit], kenar_mm: float) -> dict:
    """
    Homografi yalnizca etiket MERKEZLERI ile uyduruluyor. Etiketlerin KOSELERI
    uydurmaya girmiyor; dolayisiyla koseleri mm'ye tasiyip olculen kenar
    uzunlugu ile karsilastirmak gercek bir ornek disi olcumdur.

    Etiket toprak duzleminde ise haritalanan kenar ~ kumpasla olculen kenar.
    Etiket havada (kameraya yakin) ise buyuk gorunur, haritalanan kenar uzar.

    Ayrica haritalanan dortgenin karelikten sapmasi, etiketin kendi duzleminin
    yatak duzlemine gore egik oldugunu gosterir (kagit kivrilmasi, egimli yuzey).
    """
    if kenar_mm is None or kenar_mm <= 0:
        return {"hesaplanabilir": False, "sebep": "etiket kenar uzunluğu girilmedi"}
    kayit = []
    oranlar = []
    for t in tespitler:
        k = uygula(Hm, np.array(t.koseler, dtype=np.float64))
        if not np.isfinite(k).all():
            kayit.append({"kimlik": t.kimlik, "not": "köşe haritalanamadı"})
            continue
        kenarlar = [float(np.linalg.norm(k[i] - k[(i + 1) % 4])) for i in range(4)]
        kosegenler = [float(np.linalg.norm(k[0] - k[2])), float(np.linalg.norm(k[1] - k[3]))]
        ort = float(np.mean(kenarlar))
        oran = ort / kenar_mm
        oranlar.append(oran)
        # kareye benzerlik: kenarlarin sacilimi + kosegen esitsizligi
        kenar_sacilim = (max(kenarlar) - min(kenarlar)) / ort if ort > 0 else float("nan")
        kosegen_fark = abs(kosegenler[0] - kosegenler[1]) / float(np.mean(kosegenler))
        kayit.append({
            "kimlik": t.kimlik,
            "haritalanan_kenarlar_mm": [round(x, 3) for x in kenarlar],
            "haritalanan_ortalama_kenar_mm": round(ort, 3),
            "olculen_kenar_mm": kenar_mm,
            "oran": round(oran, 5),
            "sapma_yuzde": round((oran - 1.0) * 100.0, 3),
            "kenar_sacilimi_yuzde": round(kenar_sacilim * 100.0, 3),
            "kosegen_farki_yuzde": round(kosegen_fark * 100.0, 3),
        })
    if not oranlar:
        return {"hesaplanabilir": False, "sebep": "hiçbir etiketin köşesi haritalanamadı"}
    a = np.array(oranlar)
    yayilim = float(a.max() - a.min())
    sistematik = float(a.mean() - 1.0)
    uyarilar = []
    # Esikler: %1 olcek farki, kameradan ~1 m uzaklikta yaklasik 1 cm yukseklik farkina karsilik gelir.
    if yayilim > 0.02:
        uyarilar.append(
            f"Etiketler arası ölçek yayılımı %{yayilim * 100:.2f}. Etiketler aynı düzlemde görünmüyor. "
            f"Hangi etiketin suçlu olduğunu bu sayıdan okumaya çalışmayın: homografi dört merkeze birden "
            f"uydurulduğu için havadaki etiketin hatası bütün etiketlere dağılıyor. Suçlu için aşağıdaki "
            f"köşe tutarlılık kontrolüne bakın."
        )
    elif yayilim > 0.01:
        uyarilar.append(
            f"Etiketler arası ölçek yayılımı %{yayilim * 100:.2f} — sınırda. Etiketlerin toprak yüzeyine "
            f"tam oturduğunu gözle bir kez daha doğrulayın."
        )
    if abs(sistematik) > 0.02 and yayilim <= 0.02:
        uyarilar.append(
            f"Tüm etiketler aynı yönde %{sistematik * 100:+.2f} sapıyor. Bu düzlemsellik değil, ölçü sorunu: "
            f"kumpasla ölçülen kenar muhtemelen farklı bir kenar (siyah kare mi, beyaz çerçeve dahil mi?) "
            f"ya da etiketler kâğıda ölçeksiz basılmış. Haritanın doğruluğunu etkilemez, bu kontrolü etkiler."
        )
    return {
        "hesaplanabilir": True,
        "etiketler": kayit,
        "olcek_yayilimi_yuzde": round(yayilim * 100.0, 3),
        "sistematik_sapma_yuzde": round(sistematik * 100.0, 3),
        "uyarilar": uyarilar,
        "aciklama": (
            "Bu ölçüm homografiyi uydururken kullanılmadı (uydurmaya yalnızca etiket merkezleri girdi), "
            "bu yüzden gerçek bir örnek dışı kontroldür."
        ),
    }


def _lm(artik, p0: np.ndarray, adim: int = 120) -> np.ndarray:
    """
    Kucuk Levenberg-Marquardt (sayisal Jacobian). Scipy bagimliligi eklememek icin
    burada duruyor; 13 parametre / 40 artik icin fazlasiyla yeterli.
    """
    p = p0.astype(np.float64).copy()
    lam = 1e-3
    r = artik(p)
    maliyet = float(r @ r)
    for _ in range(adim):
        n = len(p)
        J = np.zeros((len(r), n))
        for i in range(n):
            h = max(1e-7, abs(p[i]) * 1e-6)
            q = p.copy()
            q[i] += h
            J[:, i] = (artik(q) - r) / h
        A = J.T @ J
        g = J.T @ r
        for _ in range(12):
            try:
                dp = np.linalg.solve(A + lam * np.diag(np.maximum(np.diag(A), 1e-12)), -g)
            except np.linalg.LinAlgError:
                lam *= 10
                continue
            r2 = artik(p + dp)
            m2 = float(r2 @ r2)
            if m2 < maliyet:
                p = p + dp
                r, maliyet = r2, m2
                lam = max(lam * 0.3, 1e-9)
                break
            lam *= 10
        else:
            break
        if np.linalg.norm(dp) < 1e-10:
            break
    return p


def kose_tutarlilik_kontrolu(
    Hm0: np.ndarray, tespitler: list[Tespit], koordinatlar: dict[int, tuple[float, float]], kenar_mm: float
) -> dict:
    """
    Dort etiketle homografinin ic artigi sifir cikar; bu, hatanin olculemedigi
    anlamina gelir. Ama etiketlerin KOSELERI de elimizde ve uydurmaya girmedi.

    Burada su model uydurulur:
        bilinmeyenler = homografi (8) + her etiketin yatak uzerindeki donme acisi (N)
                        + ortak etiket kenar uzunlugu (1)
        veri          = her etiketin 4 kosesi + merkezi  = 10*N denklem

    Dort etiket icin 40 denklem / 13 bilinmeyen: fazla belirtilmis, yani artik
    ANLAMLI. Etiketlerin hepsi ayni duzlemdeyse ve duz yatiyorsa artik kucuk kalir.
    Bir etiket havadaysa ya da kivrilmissa kendi artigi ayrisir.

    Kenar uzunlugunun serbest birakilmasi bilerekdir: kose bulmanin ~0.2 px'lik
    sistematik ic sapmasini ve baskidaki olcek hatasini soguruyor, boylece geriye
    kalan artik gercekten duzlemsellikle ilgili oluyor.
    """
    kul = [t for t in tespitler if t.kimlik in koordinatlar]
    N = len(kul)
    if N < 3:
        return {"hesaplanabilir": False, "sebep": f"En az 3 etiket gerekiyor, {N} var."}
    if not kenar_mm or kenar_mm <= 0:
        return {"hesaplanabilir": False, "sebep": "etiket kenar uzunlugu girilmedi"}

    kose_px = np.array([t.koseler for t in kul], dtype=np.float64)          # N,4,2
    merkez_px = np.array([t.merkez for t in kul], dtype=np.float64)         # N,2
    merkez_mm = np.array([koordinatlar[t.kimlik] for t in kul], dtype=np.float64)

    # baslangic: 4 nokta homografisiyle koseleri mm'ye tasi, her etiketin acisini oku
    yon = []
    for i in range(N):
        k = uygula(Hm0, kose_px[i])
        v = k[1] - k[0]
        yon.append(math.atan2(v[1], v[0]))
    # Yerel kare kosesi siralamasi (asagida) pozitif isaretli alan verir; tespit edilen
    # koseler mm duzleminde ters yonde donuyorsa yerel kareyi de ters cevir, yoksa
    # hicbir aci uymaz ve uydurma kenar uzunlugunu sifira cekerek "kacar".
    isaret = 1.0 if cv2.contourArea(uygula(Hm0, kose_px[0]).astype(np.float32), True) > 0 else -1.0

    def kare_koseleri(cx, cy, aci, s):
        c, sn = math.cos(aci), math.sin(aci)
        yari = s / 2.0
        yerel = np.array([[-yari, -yari], [yari, -yari], [yari, yari], [-yari, yari]]) * [1.0, isaret]
        R = np.array([[c, -sn], [sn, c]])
        return (R @ yerel.T).T + [cx, cy]

    def paket(H, aci, s):
        return np.concatenate([(H / H[2, 2]).ravel()[:8], aci, [s]])

    def ac(p):
        H = np.append(p[:8], 1.0).reshape(3, 3)
        return H, p[8:8 + N], p[8 + N]

    def artik(p):
        H, aci, s = ac(p)
        cikti = []
        for i in range(N):
            k = uygula(H, kose_px[i])
            m = uygula(H, merkez_px[i:i + 1])[0]
            if not np.isfinite(k).all() or not np.isfinite(m).all():
                return np.full(10 * N, 1e6)
            cikti.append((k - kare_koseleri(merkez_mm[i, 0], merkez_mm[i, 1], aci[i], s)).ravel())
            cikti.append(m - merkez_mm[i])
        return np.concatenate(cikti)

    p0 = paket(Hm0, np.array(yon), float(kenar_mm))
    # aci baslangicini kaba bir taramayla duzelt (yerel minimuma dusmemek icin)
    for i in range(N):
        en_iyi, en_iyi_d = p0[8 + i], None
        for da in np.linspace(-math.pi, math.pi, 25):
            q = p0.copy()
            q[8 + i] = p0[8 + i] + da
            d = float(np.linalg.norm(artik(q)))
            if en_iyi_d is None or d < en_iyi_d:
                en_iyi, en_iyi_d = q[8 + i], d
        p0[8 + i] = en_iyi

    p = _lm(artik, p0)
    H, aci, s = ac(p)
    r = artik(p).reshape(N, 10)
    etiket_rms = []
    for i in range(N):
        v = r[i].reshape(5, 2)
        etiket_rms.append(float(np.sqrt((v ** 2).sum() / 5)))
    etiket_rms = np.array(etiket_rms)
    genel = float(np.sqrt((r ** 2).sum() / (5 * N)))

    # Artigi piksele cevir: esik goruntu olceginden bagimsiz olsun.
    yerel = float(np.median([_yerel_olcek(H, merkez_px[i]) for i in range(N)]))
    genel_px = genel / yerel if yerel > 0 else float("nan")

    ort = float(np.median(etiket_rms))
    uyarilar = []
    supheli = [t.kimlik for i, t in enumerate(kul) if etiket_rms[i] > max(3.0 * ort, ort + 0.5 * yerel)]
    # Esikler olculdu: bu boru hattinda dort etiket de duzlemdeyken artik ~0.3 px,
    # bir etiket 25 mm yukseltildiginde ~0.9 px cikiyor.
    if genel_px > 0.70:
        uyarilar.append(
            f"Etiket köşeleri tek bir düz düzlemle uyuşmuyor: artık {genel:.2f} mm ({genel_px:.2f} px). "
            f"Temiz bir kurulumda bu sayı 0.3 px civarında kalır. Etiketlerden en az biri toprak yüzeyinde "
            f"düz yatmıyor (altında bir şey var, kâğıt kıvrılmış) ya da kare bulanık. "
            + (f"En çok ayrışan: etiket {', '.join(str(x) for x in supheli)}." if supheli else
               "Hangi etiketin suçlu olduğu bu veriden güvenilir şekilde ayrılamıyor — homografi dört "
               "merkeze birden uydurulduğu için hata hepsine dağılıyor; etiketleri gözle kontrol edin.")
        )
    elif genel_px > 0.45:
        uyarilar.append(
            f"Köşe artığı sınırda: {genel:.2f} mm ({genel_px:.2f} px). Temiz kurulumda ~0.3 px beklenir. "
            f"Etiketlerin toprak yüzeyine tam oturduğunu bir kez gözle doğrulayın."
        )
    olcek_sapma = (s / kenar_mm - 1.0) * 100.0
    if abs(olcek_sapma) > 3.0:
        uyarilar.append(
            f"Uydurulan etiket kenarı {s:.2f} mm, kumpasla girdiğiniz {kenar_mm:.2f} mm'den "
            f"%{olcek_sapma:+.1f} farklı. Ya ölçülen kenar farklı bir kenar (siyah karenin dışı mı?), "
            f"ya baskı ölçeği kaymış, ya da etiketler yatak düzleminde değil."
        )

    return {
        "hesaplanabilir": True,
        "aciklama": (
            f"Homografi (8) + etiket başına dönme açısı ({N}) + ortak kenar uzunluğu (1) = {8 + N + 1} bilinmeyen, "
            f"{10 * N} denklem. Fazla belirtilmiş olduğu için bu artık — homografinin sıfır çıkan iç artığının "
            f"aksine — ANLAMLI bir sayıdır."
        ),
        "bilinmeyen_sayisi": 8 + N + 1,
        "denklem_sayisi": 10 * N,
        "genel_rms_mm": round(genel, 4),
        "genel_rms_px": round(float(genel_px), 4),
        "temiz_kurulum_beklentisi_px": 0.3,
        "korlik_notu": (
            "Dikkat: dört etiketin hepsi aynı yükseklikte ortak bir tablanın üzerindeyse bu kontrol "
            "HİÇBİR ŞEY bulamaz — köşeler mükemmel uyar, çünkü o da bir düzlemdir. Harita o zaman "
            "toprak yüzeyini değil tablanın yüzeyini öğrenir ve görüntüde bunu ele verecek hiçbir iz kalmaz. "
            "Etiketlerin toprakta olduğu yalnızca fiziksel olarak doğrulanabilir."
        ),
        "uydurulan_kenar_mm": round(float(s), 4),
        "olculen_kenar_mm": kenar_mm,
        "kenar_sapma_yuzde": round(olcek_sapma, 3),
        "etiket_basina": [
            {"kimlik": t.kimlik, "rms_mm": round(float(etiket_rms[i]), 4)} for i, t in enumerate(kul)
        ],
        "supheli_kimlikler": supheli,
        "uyarilar": uyarilar,
    }


# ---------------------------------------------------------------------------
# 5) Egiklik olcusu
# ---------------------------------------------------------------------------


def _yerel_olcek(Hm: np.ndarray, nokta: np.ndarray, h: float = 1.0) -> float:
    """Verilen pikselde mm/px yerel olcek (Jacobian determinantinin karekoku)."""
    p0 = uygula(Hm, nokta.reshape(1, 2))[0]
    px_ = uygula(Hm, (nokta + [h, 0]).reshape(1, 2))[0]
    py_ = uygula(Hm, (nokta + [0, h]).reshape(1, 2))[0]
    J = np.column_stack([(px_ - p0) / h, (py_ - p0) / h])
    return float(math.sqrt(abs(np.linalg.det(J))))


def egiklik_olcusu(Hm: np.ndarray, Sm: np.ndarray | None, yatak_mm: tuple[float, float]) -> dict:
    """
    Kameranin ne kadar egik oldugunu iki olculebilir sayiyla verir:
      1. Yatak uzerinde mm/px yerel olceginin en kucuk/en buyuk orani.
         Dik bakan kamerada 1.00'e yakin.
      2. Benzerlik modeli ile homografi modelinin ayni pikselde verdigi
         mm farkinin yatak uzerindeki en buyuk degeri. Basit modelin
         gercekten ne kadar yanildigini dogrudan mm cinsinden soyler.
    """
    Hinv = np.linalg.inv(Hm)
    X, Y = yatak_mm
    izgara_mm = np.array([[x, y] for x in np.linspace(0, X, 11) for y in np.linspace(0, Y, 11)], dtype=np.float64)
    izgara_px = uygula(Hinv, izgara_mm)
    gecerli = np.isfinite(izgara_px).all(axis=1)
    izgara_px = izgara_px[gecerli]
    izgara_mm = izgara_mm[gecerli]
    if len(izgara_px) < 4:
        return {"hesaplanabilir": False, "sebep": "yatak köşeleri kareye geri taşınamadı"}
    olcekler = np.array([_yerel_olcek(Hm, p) for p in izgara_px])
    olcekler = olcekler[np.isfinite(olcekler) & (olcekler > 0)]
    sonuc = {
        "hesaplanabilir": True,
        "yerel_olcek_min_mm_px": round(float(olcekler.min()), 5),
        "yerel_olcek_maks_mm_px": round(float(olcekler.max()), 5),
        "olcek_orani": round(float(olcekler.max() / olcekler.min()), 4),
    }
    if Sm is not None:
        fark = np.linalg.norm(uygula(Sm, izgara_px) - izgara_mm, axis=1)
        fark = fark[np.isfinite(fark)]
        if len(fark):
            sonuc["benzerlik_homografi_maks_fark_mm"] = round(float(fark.max()), 3)
            sonuc["benzerlik_homografi_rms_fark_mm"] = round(float(np.sqrt((fark ** 2).mean())), 3)
    return sonuc


# ---------------------------------------------------------------------------
# 6) Ust seviye kalibrasyon
# ---------------------------------------------------------------------------


def kalibre_et(
    tespitler: list[Tespit],
    koordinatlar: dict[int, tuple[float, float]],
    kenar_mm: float | None = None,
    yatak_mm: tuple[float, float] = (540.0, 645.0),
    dogrulama_noktalari: list[dict] | None = None,
) -> dict:
    """
    tespitler          : etiketleri_bul ciktisi
    koordinatlar       : {kimlik: (x_mm, y_mm)} — etiket merkezinin makine koordinati
    kenar_mm           : kumpasla olculen etiket kenari (siyah kare kenari)
    dogrulama_noktalari: [{"px":[u,v], "mm":[x,y], "ad":...}] — uydurmaya girmeyen,
                         kullanicinin probla olctugu bagimsiz kontrol noktalari
    """
    kullanilan = [t for t in tespitler if t.kimlik in koordinatlar]
    kimlikler = [t.kimlik for t in kullanilan]
    px = np.array([t.merkez for t in kullanilan], dtype=np.float64)
    mm = np.array([koordinatlar[t.kimlik] for t in kullanilan], dtype=np.float64)

    cikti: dict[str, Any] = {
        "surum": SURUM,
        "nokta_sayisi": len(kullanilan),
        "kullanilan_kimlikler": kimlikler,
        "etiket_kenar_mm": kenar_mm,
        "yatak_mm": list(yatak_mm),
        "uyarilar": [],
        "hatalar": [],
    }

    bulunmayan = sorted(k for k in koordinatlar if k not in {t.kimlik for t in tespitler})
    if bulunmayan:
        cikti["uyarilar"].append(
            "Şu etiketler için koordinat girilmiş ama etiket karede bulunamadı, bu yüzden hesaba "
            "girmediler: " + ", ".join(str(x) for x in bulunmayan) + "."
        )
    if len(kullanilan) < 2:
        cikti["hatalar"].append(
            f"En az 2 nokta gerekiyor; kullanılabilir {len(kullanilan)} nokta var "
            f"(hem karede bulunmuş hem koordinatı girilmiş). Hiçbir model hesaplanmadı."
        )
        return cikti
    if _dogrusal_mi(px):
        cikti["hatalar"].append(
            "Etiket merkezleri karede neredeyse aynı doğru üzerinde. Bu geometride dönüşüm "
            "tek türlü belirlenmez; uydurma değer üretilmedi. Etiketleri yatağa daha yaygın dağıtın."
        )
        return cikti

    # yatak sinirlari disi koordinat uyarisi
    for t in kullanilan:
        x, y = koordinatlar[t.kimlik]
        if not (-1 <= x <= yatak_mm[0] + 1) or not (-1 <= y <= yatak_mm[1] + 1):
            cikti["uyarilar"].append(
                f"Etiket {t.kimlik} için girilen koordinat ({x}, {y}) mm, tanımlı çalışma alanının "
                f"(0..{yatak_mm[0]}, 0..{yatak_mm[1]}) dışında. Yazım hatası olabilir."
            )

    # --- Benzerlik ---
    Sm = benzerlik_uydur(px, mm)
    if Sm is None:
        cikti["benzerlik"] = {"hesaplanabilir": False, "sebep": "uydurma basarisiz"}
    else:
        A = Sm[:2, :2]
        olcek = float(math.sqrt(abs(np.linalg.det(A))))
        ayna = bool(np.linalg.det(A) < 0)
        B = A @ np.diag([1.0, -1.0]) if ayna else A
        aci = float(math.degrees(math.atan2(B[1, 0], B[0, 0])))
        cikti["benzerlik"] = {
            "hesaplanabilir": True,
            "aciklama": "Ölçek + dönme + kaydırma (4 serbestlik). Kameranın yatağa DİK baktığını varsayar.",
            "matris_px_to_mm": Sm.tolist(),
            "olcek_mm_px": round(olcek, 6),
            "donme_derece": round(aci, 4),
            "eksen_yansimasi": ayna,
            "eksen_yansimasi_notu": (
                "Görüntü v ekseni aşağı, makine Y ekseni yukarı olduğu için dönüşüm bir eksen yansıması "
                "içeriyor. Bu normaldir, hata değildir." if ayna else
                "Dönüşüm saf dönme; görüntü ve makine eksenleri aynı yönelimde."
            ),
            "kaydirma_mm": [round(float(Sm[0, 2]), 3), round(float(Sm[1, 2]), 3)],
            "serbestlik": 4,
            "denklem_sayisi": 2 * len(px),
            "ic_hata": _hatalar(Sm, px, mm),
            "ic_hata_notu": (
                f"{len(px)} nokta = {2 * len(px)} denklem, model 4 serbestlik. Fazla belirtilmiş, "
                f"bu yüzden bu artık anlamlı bir sayıdır."
            ),
            "loo": _loo(benzerlik_uydur, px, mm, kimlikler, min_nokta=2),
        }
        cikti["uyarilar"].extend("Benzerlik modelinin LOO'su hakkında — " + n
                                 for n in cikti["benzerlik"]["loo"].get("notlar", []))

    # --- Homografi ---
    Hm = homografi_uydur(px, mm)
    if Hm is None:
        cikti["homografi"] = {
            "hesaplanabilir": False,
            "sebep": f"Homografi 4 nokta gerektirir, {len(px)} nokta var (ya da geometri dejenere).",
        }
    else:
        ic = _hatalar(Hm, px, mm)
        h = {
            "hesaplanabilir": True,
            "aciklama": "Projektif dönüşüm (8 serbestlik). Eğik bakışı ve perspektifi çözer.",
            "matris_px_to_mm": (Hm / Hm[2, 2]).tolist(),
            "matris_mm_to_px": (np.linalg.inv(Hm) / np.linalg.inv(Hm)[2, 2]).tolist(),
            "serbestlik": 8,
            "denklem_sayisi": 2 * len(px),
            "ic_hata": ic,
        }
        if len(px) == 4:
            h["ic_hata_notu"] = (
                "TUZAK: 4 nokta = 8 denklem, homografi 8 serbestlik. Uydurma tam belirtilmiş, "
                "bu yüzden iç artık matematiksel olarak sıfırdır ve kalibrasyonun doğruluğu hakkında "
                "HİÇBİR ŞEY söylemez. Kusursuzluk kanıtı değildir."
            )
            cikti["uyarilar"].append(
                "Homografinin iç artığı 4 etiketle zorunlu olarak sıfır. Bunu doğruluk olarak okumayın; "
                "aşağıdaki kenar uzunluğu kontrolüne ve varsa doğrulama noktalarına bakın."
            )
        else:
            h["ic_hata_notu"] = (
                f"{len(px)} nokta = {2 * len(px)} denklem, model 8 serbestlik. Fazla belirtilmiş, "
                f"artık anlamlı."
            )
        h["loo"] = _loo(homografi_uydur, px, mm, kimlikler, min_nokta=4)
        cikti["uyarilar"].extend("Homografinin LOO'su hakkında — " + n for n in h["loo"].get("notlar", []))
        if not h["loo"].get("hesaplanabilir"):
            cikti["uyarilar"].append(
                "Homografi için bir-dışarıda-bırakma hatası 4 etiketle HESAPLANAMAZ: 3 noktayla homografi "
                "kurulamaz (6 denklem, 8 bilinmeyen). Dürüst bir bağımsız hata sayısı için 5. bir ölçülmüş "
                "nokta gerekir — 5. etiket ekleyin ya da probla yataktaki bir noktayı ölçüp karede "
                "işaretleyerek doğrulama noktası girin."
            )
        h["kenar_kontrolu"] = kenar_kontrolu(Hm, kullanilan, kenar_mm) if kenar_mm else {
            "hesaplanabilir": False, "sebep": "etiket kenar uzunlugu girilmedi"
        }
        if h["kenar_kontrolu"].get("hesaplanabilir"):
            cikti["uyarilar"].extend(h["kenar_kontrolu"].get("uyarilar", []))
        h["kose_tutarliligi"] = (
            kose_tutarlilik_kontrolu(Hm, kullanilan, koordinatlar, kenar_mm) if kenar_mm else
            {"hesaplanabilir": False, "sebep": "etiket kenar uzunlugu girilmedi"}
        )
        if h["kose_tutarliligi"].get("hesaplanabilir"):
            cikti["uyarilar"].extend(h["kose_tutarliligi"].get("uyarilar", []))
        h["egiklik"] = egiklik_olcusu(Hm, Sm, yatak_mm)
        cikti["homografi"] = h

    # --- Bagimsiz dogrulama noktalari ---
    if dogrulama_noktalari:
        dpx = np.array([d["px"] for d in dogrulama_noktalari], dtype=np.float64)
        dmm = np.array([d["mm"] for d in dogrulama_noktalari], dtype=np.float64)
        dg = {"nokta_sayisi": len(dpx)}
        if Sm is not None:
            dg["benzerlik"] = _hatalar(Sm, dpx, dmm)
        if Hm is not None:
            dg["homografi"] = _hatalar(Hm, dpx, dmm)
        dg["not"] = "Bu noktalar uydurmaya girmedi; bu sayılar gerçek örnek dışı hatadır."
        cikti["dogrulama_noktalari"] = dg

    # --- Model secimi tavsiyesi (olculen sayilara dayali) ---
    cikti["model_karsilastirma"] = _model_karsilastirma(cikti)
    return cikti


def _model_karsilastirma(c: dict) -> dict:
    b = c.get("benzerlik", {})
    h = c.get("homografi", {})
    if not b.get("hesaplanabilir") or not h.get("hesaplanabilir"):
        return {"sonuc": "İki model birden hesaplanamadığı için karşılaştırma yapılmadı."}
    b_loo = b.get("loo", {})
    satirlar = []
    if b_loo.get("hesaplanabilir"):
        satirlar.append(
            f"Benzerlik modeli, bir-dışarıda-bırakma ile {b_loo['rms_mm']:.2f} mm RMS "
            f"(en kötü {b_loo['maks_mm']:.2f} mm) sapıyor."
        )
    e = h.get("egiklik", {})
    if e.get("hesaplanabilir"):
        if "benzerlik_homografi_maks_fark_mm" in e:
            satirlar.append(
                f"İki model yatak üzerinde en fazla {e['benzerlik_homografi_maks_fark_mm']:.1f} mm ayrışıyor "
                f"(RMS {e['benzerlik_homografi_rms_fark_mm']:.1f} mm). Bu fark doğrudan kameranın eğikliğinin bedelidir."
            )
        satirlar.append(
            f"Yerel ölçek yatak üzerinde {e['yerel_olcek_min_mm_px']:.4f} – {e['yerel_olcek_maks_mm_px']:.4f} mm/px "
            f"aralığında değişiyor (oran {e['olcek_orani']:.3f}). Dik bakan kamerada bu oran 1.000 olurdu."
        )
    kk = h.get("kenar_kontrolu", {})
    if kk.get("hesaplanabilir"):
        satirlar.append(
            f"Homografinin örnek dışı kontrolü (etiket kenar uzunlukları): sistematik sapma "
            f"%{kk['sistematik_sapma_yuzde']:+.2f}, etiketler arası yayılım %{kk['olcek_yayilimi_yuzde']:.2f}."
        )
    return {"sonuc": "Homografi kullanın — basit model bu kurulumda yeterli değil." if e.get("olcek_orani", 1) > 1.02 else
            "İki model birbirine yakın; yine de homografi güvenli seçim.", "sayilar": satirlar}
