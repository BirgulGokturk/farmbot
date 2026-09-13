"""
lens — kamera iç parametreleri ve radyal bozulma düzeltmesi.

NEDEN GEREKLİ — ÖLÇÜLDÜ
Elle ızgara (getPerspectiveTransform) yalnız PERSPEKTİFİ düzeltir. Lens
bozulması düzlemsel bir dönüşümle ifade edilemez; tek homografi onu soğuramaz.
Sentetik sahnede ölçülen (25 bitkinin ortalama konum hatası, mm, tıklama
hatası yokken):

    yöntem                       k1=-0.05  k1=-0.12  k1=-0.25
    tek hücre (4 köşe)              1.72      4.20      9.06
    2x2 ölçülmüş köşe (9)           0.51      1.24      2.73
    3x3 ölçülmüş köşe (16)          0.23      0.58      1.28
    4x4 ölçülmüş köşe (25)          0.15      0.36      0.80
    6x6 ölçülmüş köşe (49)          0.04      0.14      0.33
    LENS DÜZELTME + tek hücre       0.01      0.01      0.01

İki şey birden doğru:
  * Hücreyi bölmek gerçekten yardım eder — ama ARA KÖŞELER TEK TEK ÖLÇÜLÜRSE.
    Dış dörtgenden türetilen ara köşeler (izgara.dikdortgen_izgara) hiçbir şey
    kazandırmaz; hepsi aynı homografiyi paylaşır.
  * Lens düzeltme bozulmayı kaynağında siler; tek hücre yeter.

AMA TIKLAMA HASSASİYETİ TAVANI BELİRLER. Aynı sahnede, k1=-0.12, 5 tohum
ortalaması:

    yöntem                       0 px    2 px    5 px   <- köşe tıklama hatası
    tek hücre (4 köşe)           4.20    4.06    4.04
    2x2 (9 köşe)                 1.24    1.41    1.94
    3x3 (16 köşe)                0.58    0.82    1.48
    4x4 (25 köşe)                0.36    0.67    1.47
    lens düzeltme + tek hücre    0.01    0.59    1.48

Gerçekçi 2-5 piksel tıklama hatasında hepsi ~1.5 mm'de buluşuyor. Yani
3x3'ün ötesine geçmek ya da lens kalibrasyonu eklemek, köşeleri daha hassas
tıklamadan karşılık vermez. Pratik öneri: TEK HÜCREYLE BAŞLAYIN, `dogrula`
ile gerçek hatayı ölçün, ancak gerekiyorsa bölün ya da lens kalibre edin.

ÖNCE ÖLÇÜN, SONRA UĞRAŞIN: `bozulma_var_mi()` kuşbakışı görüntüde düz olması
gereken çizgilerin ne kadar büküldüğüne bakar. Bükülme yoksa lens
kalibrasyonuna hiç girmeyin.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import cv2


@dataclass
class Lens:
    K: np.ndarray                 # 3x3 iç parametre
    D: np.ndarray                 # bozulma katsayıları
    kare_boyu: tuple[int, int]
    rms_px: float | None = None
    kare_sayisi: int | None = None

    @classmethod
    def yukle(cls, yol) -> "Lens":
        d = json.loads(Path(yol).read_text("utf-8"))
        return cls(np.asarray(d["K"], np.float64), np.asarray(d["D"], np.float64),
                   tuple(d["kare_boyu"]), d.get("rms_px"), d.get("kare_sayisi"))

    def kaydet(self, yol) -> Path:
        yol = Path(yol); yol.parent.mkdir(parents=True, exist_ok=True)
        yol.write_text(json.dumps({"surum": 1, "K": self.K.tolist(),
                                   "D": self.D.tolist(),
                                   "kare_boyu": list(self.kare_boyu),
                                   "rms_px": self.rms_px,
                                   "kare_sayisi": self.kare_sayisi},
                                  indent=2), "utf-8")
        return yol

    def _olcekli(self, boy):
        if tuple(boy) == tuple(self.kare_boyu):
            return self.K
        g = boy[0] / self.kare_boyu[0]
        if abs(g - boy[1] / self.kare_boyu[1]) > 1e-3:
            raise ValueError(f"En-boy oranı değişmiş: {self.kare_boyu} -> {tuple(boy)}")
        K = self.K.copy(); K[:2] *= g
        return K

    def duzelt(self, bgr) -> np.ndarray:
        """Bozulmayı giderir. ÇIKTI AYNI BOYUTTADIR — ızgara köşeleri
        düzeltilmiş karede tıklanmalıdır, ham karede değil."""
        boy = (bgr.shape[1], bgr.shape[0])
        return cv2.undistort(bgr, self._olcekli(boy), self.D)

    def nokta_duzelt(self, noktalar, boy) -> np.ndarray:
        """Ham karede bilinen pikselleri düzeltilmiş karedeki yerlerine taşır."""
        K = self._olcekli(boy)
        n = np.asarray(noktalar, np.float64).reshape(-1, 1, 2)
        return cv2.undistortPoints(n, K, self.D, P=K).reshape(-1, 2)


def satranctan_kalibre(kareler, ic_kose=(9, 6), kare_mm=25.0) -> Lens:
    """
    Satranç tahtası kareleriyle iç parametreleri çözer.

    kareler  : dosya yolları ya da BGR dizileri (en az 10, ideali 20)
    ic_kose  : İÇ köşe sayısı — 10x7 kareli tahtada (9, 6)
    kare_mm  : bir karenin kenarı; bozulma için ölçek önemsiz ama K için iyi

    Tahtayı kadrajın her yerinde, farklı açılarda ve mesafelerde gösterin.
    Hepsini merkezde tutarsanız kenar bozulması ölçülemez.
    """
    hedef = np.zeros((ic_kose[0] * ic_kose[1], 3), np.float32)
    hedef[:, :2] = np.mgrid[0:ic_kose[0], 0:ic_kose[1]].T.reshape(-1, 2) * kare_mm
    nesne, goruntu, boy = [], [], None
    for k in kareler:
        bgr = k if hasattr(k, "shape") else cv2.imread(str(k), cv2.IMREAD_COLOR)
        if bgr is None:
            continue
        gri = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        boy = (gri.shape[1], gri.shape[0])
        ok, kose = cv2.findChessboardCorners(
            gri, ic_kose,
            cv2.CALIB_CB_ADAPTIVE_THRESH + cv2.CALIB_CB_NORMALIZE_IMAGE)
        if not ok:
            continue
        kose = cv2.cornerSubPix(
            gri, kose, (11, 11), (-1, -1),
            (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001))
        nesne.append(hedef); goruntu.append(kose)
    if len(nesne) < 5:
        raise ValueError(f"Yalnız {len(nesne)} karede tahta bulundu; en az 5 "
                         "(ideali 15-20) gerekiyor. Tahta kadraja tam sığsın, "
                         "net ve eğik açılardan da çekilsin.")
    rms, K, D, *_ = cv2.calibrateCamera(nesne, goruntu, boy, None, None)
    return Lens(np.asarray(K), np.asarray(D).ravel(), boy, round(float(rms), 4),
                len(nesne))


def bozulma_var_mi(izgara, kare, px_mm=4.0, ornek=40) -> dict:
    """
    LENS KALİBRASYONUNA GİRMEDEN ÖNCE: gerçekten bozulma var mı?

    Izgaranın mm uzayında düz olan kenarlarını kuşbakışına taşır ve ne kadar
    büküldüğüne bakar. Homografi düz çizgiyi düz tutar; bükülme görülüyorsa
    kaynağı lens bozulmasıdır.

    Döner: {"maks_sapma_mm": ..., "gerekli": bool}
    """
    from .boru import kusbakisi_uret
    _, bilgi = kusbakisi_uret(kare, izgara, px_mm=px_mm)
    x0, y0, x1, y1 = bilgi["kapsam_mm"]

    sapmalar = []
    for h in izgara.hucreler:
        m = np.asarray(h.mm, np.float64)
        for i in range(4):
            a, b = m[i], m[(i + 1) % 4]
            t = np.linspace(0, 1, ornek)[:, None]
            mm_hat = a + (b - a) * t                       # mm'de düz çizgi
            pik = h.mm_to_piksel(mm_hat)                   # kameraya taşı
            geri = h.piksel_to_mm(pik)                     # geri getir
            # düz çizgiden sapma: noktaların a-b doğrusuna dik uzaklığı
            yon = (b - a) / max(np.linalg.norm(b - a), 1e-9)
            dik = np.array([-yon[1], yon[0]])
            sapmalar.append(float(np.max(np.abs((geri - a) @ dik))))

    maks = max(sapmalar) if sapmalar else 0.0
    return {
        "maks_sapma_mm": round(maks, 3),
        "gerekli": maks > 1.0,
        "not": ("Bu sınama ızgaranın KENDİ tutarlılığını ölçer; gerçek lens "
                "bozulmasını görmek için kuşbakışı görselde yatağın kenarına "
                "ve 50 mm ızgarasına bakın — düz olması gerekenler bükülüyorsa "
                "lens kalibrasyonu gerekir. Kesin ölçüm için satranç tahtası."),
    }
