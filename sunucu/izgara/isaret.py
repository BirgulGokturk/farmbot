"""Karede işareti bulma — alt piksel.

İşaret makine kafasına monte edilir ve YUKARI bakar. Seçim önemli:
konum hatasının tamamı buradan ve makinenin enkoderinden geliyor.
Benzetimde ölçüldü: işaret bulmada 1 piksel gürültü -> 0.166 mm,
2 piksel -> 0.65 mm (makine gürültüsüyle birlikte).

AprilTag önerilir: dört köşesi alt piksel iyileştirmeden geçer, kimliği
doğrulanır, toprakta/kırıntıda yanlış eşleşme yapmaz. Daire daha keskin
merkez verir ama benzer koyu lekelerle karışabilir.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Bulgu:
    u_px: float
    v_px: float
    guven: float = 1.0
    not_: str = ""


class AprilTagBulucu:
    """Kafadaki tek bir AprilTag'in merkezi.

    kimlik: yalnız bu kimliği kabul eder. Yataktaki kalibrasyon
    etiketleriyle (0,1,8,9) ÇAKIŞMAYAN bir sayı seçin.
    """

    def __init__(self, kimlik: int = 23, sozluk: str = "DICT_APRILTAG_36h11",
                 en_kucuk_cevre_orani: float = 0.005):
        self.kimlik = int(kimlik)
        d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, sozluk))
        p = cv2.aruco.DetectorParameters()
        p.minMarkerPerimeterRate = en_kucuk_cevre_orani
        p.adaptiveThreshWinSizeMin = 5
        p.adaptiveThreshWinSizeMax = 45
        p.adaptiveThreshWinSizeStep = 4
        p.polygonalApproxAccuracyRate = 0.05
        p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_APRILTAG
        p.cornerRefinementWinSize = 7
        p.cornerRefinementMaxIterations = 60
        p.cornerRefinementMinAccuracy = 0.01
        self.dedektor = cv2.aruco.ArucoDetector(d, p)

    def bul(self, bgr: np.ndarray) -> Bulgu | None:
        gri = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
        koseler, kimlikler, _ = self.dedektor.detectMarkers(gri)
        if kimlikler is None:
            return None
        for k, kose in zip(kimlikler.flatten().tolist(), koseler):
            if int(k) != self.kimlik:
                continue
            c = np.asarray(kose, np.float64).reshape(4, 2)
            kenar = np.linalg.norm(c[1] - c[0])
            return Bulgu(float(c[:, 0].mean()), float(c[:, 1].mean()),
                         guven=1.0, not_=f"kenar {kenar:.1f} px")
        return None


class DaireBulucu:
    """Açık zemin üstünde koyu dolu daire. Ağırlık merkezi alt pikseldir.

    `en_az_px` / `en_cok_px`: dairenin beklenen piksel alanı aralığı.
    Aralık verilmezse karede en dairesel koyu leke seçilir — kalabalık
    bir kadrajda yanılabilir, o yüzden aralığı vermek yeğdir.
    """

    def __init__(self, en_az_px: int = 60, en_cok_px: int = 40000,
                 en_az_yuvarlaklik: float = 0.75, koyu: bool = True):
        self.en_az_px, self.en_cok_px = en_az_px, en_cok_px
        self.en_az_yuvarlaklik = en_az_yuvarlaklik
        self.koyu = koyu

    def bul(self, bgr: np.ndarray) -> Bulgu | None:
        gri = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
        gri = cv2.GaussianBlur(gri, (5, 5), 0)
        tip = cv2.THRESH_BINARY_INV if self.koyu else cv2.THRESH_BINARY
        _, ikili = cv2.threshold(gri, 0, 255, tip + cv2.THRESH_OTSU)
        konturlar, _ = cv2.findContours(ikili, cv2.RETR_EXTERNAL,
                                        cv2.CHAIN_APPROX_NONE)
        en_iyi, en_iyi_y = None, 0.0
        for k in konturlar:
            A = cv2.contourArea(k)
            if not (self.en_az_px <= A <= self.en_cok_px):
                continue
            P = cv2.arcLength(k, True)
            if P <= 0:
                continue
            y = 4 * np.pi * A / (P * P)
            if y < self.en_az_yuvarlaklik or y < en_iyi_y:
                continue
            M = cv2.moments(k)
            if M["m00"] <= 0:
                continue
            en_iyi = Bulgu(M["m10"] / M["m00"], M["m01"] / M["m00"], guven=float(y),
                           not_=f"alan {A:.0f} px, yuvarlaklik {y:.2f}")
            en_iyi_y = y
        return en_iyi


class SatrancBulucu:
    """Kâğıt satranç tahtasının TÜM iç köşeleri — tek karede yüzlerce nokta.

    Makine turuna alternatif değil, tamamlayıcı: tahta distorsiyonu ve
    haritanın şeklini verir ama makine koordinatında nerede durduğunu
    bilmez. Tahtanın birkaç köşesine makineyle dokunup çapalarsanız
    ikisi birleşir (bkz. OKUBENI, "birleştirme").
    """

    def __init__(self, ic_kose=(9, 6), kare_mm: float = 20.0):
        self.ic_kose = tuple(ic_kose)
        self.kare_mm = float(kare_mm)

    def bul_hepsi(self, bgr: np.ndarray):
        gri = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
        ok, kose = cv2.findChessboardCornersSB(
            gri, self.ic_kose, flags=cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY)
        if not ok:
            ok, kose = cv2.findChessboardCorners(
                gri, self.ic_kose,
                cv2.CALIB_CB_ADAPTIVE_THRESH + cv2.CALIB_CB_NORMALIZE_IMAGE)
            if ok:
                cv2.cornerSubPix(
                    gri, kose, (11, 11), (-1, -1),
                    (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.01))
        if not ok:
            return None, None
        nx, ny = self.ic_kose
        yerel = np.array([[i * self.kare_mm, j * self.kare_mm]
                          for j in range(ny) for i in range(nx)], np.float64)
        return kose.reshape(-1, 2).astype(np.float64), yerel
