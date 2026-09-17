"""Ortak yardımcılar: JSON okuma/yazma, AprilTag/ChArUco dedektörleri, çözünürlük ölçekleme.

Bu modül tek başına çalışmaz; diğer betikler ve donusum.py tarafından içe aktarılır.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
from pathlib import Path

import cv2
import numpy as np

KLASOR = Path(__file__).resolve().parent
VERI = Path(os.environ.get("GORU_KALIB_VERI", KLASOR / "kalib_veri"))  # tüm kalibrasyon çıktıları burada durur
IC_DOSYA = VERI / "kamera_ic.json"      # intrinsic: K + distCoeffs
DIS_DOSYA = VERI / "kamera_dis.json"    # homografi + kamera pozu
ETIKET_DOSYA = KLASOR / "etiketler.json"

# ChArUco tahtası AprilTag 36h11 KULLANMAZ; böylece yatak etiketleriyle karışmaz.
CHARUCO_SOZLUK = cv2.aruco.DICT_5X5_100
ETIKET_SOZLUK = cv2.aruco.DICT_APRILTAG_36h11


class KalibHata(RuntimeError):
    """Kullanıcıya gösterilecek, açıklamalı hata."""


def _minimum_opencv():
    ana, alt = (int(x) for x in cv2.__version__.split(".")[:2])
    if (ana, alt) < (4, 8):
        raise KalibHata(
            f"OpenCV {cv2.__version__} bulundu; en az 4.8 gerekli (ArucoDetector/CharucoDetector API). "
            "Kurulum: pip install -U 'opencv-python>=4.8' --break-system-packages"
        )


_minimum_opencv()


# ---------------------------------------------------------------- JSON
def json_yaz(yol: Path, veri: dict) -> None:
    yol = Path(yol)
    yol.parent.mkdir(parents=True, exist_ok=True)
    veri = dict(veri)
    veri.setdefault("tarih", _dt.datetime.now().isoformat(timespec="seconds"))
    gecici = yol.with_suffix(yol.suffix + ".tmp")
    with open(gecici, "w", encoding="utf-8") as f:
        json.dump(veri, f, ensure_ascii=False, indent=2, default=_json_np)
    os.replace(gecici, yol)  # yarım yazılmış dosya kalmasın


def json_oku(yol: Path) -> dict:
    yol = Path(yol)
    if not yol.exists():
        raise KalibHata(f"Dosya yok: {yol}")
    with open(yol, encoding="utf-8") as f:
        return json.load(f)


def _json_np(o):
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    raise TypeError(type(o))


# ---------------------------------------------------------------- görüntü
def gri(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def resim_oku(yol) -> np.ndarray:
    img = cv2.imread(str(yol), cv2.IMREAD_COLOR)
    if img is None:
        raise KalibHata(f"Görüntü okunamadı: {yol}")
    return img


# ---------------------------------------------------------------- dedektörler
def etiket_dedektoru() -> cv2.aruco.ArucoDetector:
    """Küçük ve eğik görünen 36h11 etiketleri için ayarlanmış dedektör.

    Varsayılan parametreler karede küçük/eğik etiketleri kaçırıyordu; burada
    minimum çevre oranı düşürüldü, eşikleme pencereleri genişletildi ve
    köşeler alt-piksel hassasiyetle iyileştiriliyor (16 nokta için kritik).
    """
    p = cv2.aruco.DetectorParameters()
    p.adaptiveThreshWinSizeMin = 3
    p.adaptiveThreshWinSizeMax = 63
    p.adaptiveThreshWinSizeStep = 6
    p.minMarkerPerimeterRate = 0.005
    p.maxMarkerPerimeterRate = 4.0
    p.polygonalApproxAccuracyRate = 0.04
    p.minCornerDistanceRate = 0.02
    p.minDistanceToBorder = 2
    p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    p.cornerRefinementWinSize = 5
    p.cornerRefinementMaxIterations = 60
    p.cornerRefinementMinAccuracy = 0.005
    sozluk = cv2.aruco.getPredefinedDictionary(ETIKET_SOZLUK)
    return cv2.aruco.ArucoDetector(sozluk, p)


def etiketleri_bul(img: np.ndarray) -> dict[int, np.ndarray]:
    """{id: (4,2) köşe dizisi}. Köşe sırası OpenCV'nin: etiketin kendi
    çerçevesinde sol-üst, sağ-üst, sağ-alt, sol-alt. Aynı id iki kez
    görülürse hata verir (yanlış etiket basılmış olabilir)."""
    g = gri(img)
    det = etiket_dedektoru()
    koseler, idler, _ = det.detectMarkers(g)
    if idler is None or len(idler) == 0:
        # düşük kontrast için ikinci deneme
        g2 = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(g)
        koseler, idler, _ = det.detectMarkers(g2)
    sonuc: dict[int, np.ndarray] = {}
    if idler is None:
        return sonuc
    for k, i in zip(koseler, idler.ravel()):
        i = int(i)
        if i in sonuc:
            raise KalibHata(f"Etiket {i} karede iki kez görüldü; aynı id'li iki kâğıt olmamalı.")
        sonuc[i] = k.reshape(4, 2).astype(np.float64)
    return sonuc


def charuco_tahtasi(kare_x: int, kare_y: int, kare_mm: float, isaret_mm: float) -> cv2.aruco.CharucoBoard:
    sozluk = cv2.aruco.getPredefinedDictionary(CHARUCO_SOZLUK)
    return cv2.aruco.CharucoBoard((kare_x, kare_y), kare_mm, isaret_mm, sozluk)


# ---------------------------------------------------------------- ölçekleme
def olcek_matrisi(ref_boyut, yeni_boyut) -> tuple[float, np.ndarray]:
    """Yeni çözünürlükteki pikseli referans çözünürlüğe götüren 3x3 matris.

    Aynı sensör kadrajının farklı çözünürlüğü olmalı (en-boy oranı aynı).
    Oran farklıysa büyük olasılıkla kamera kırpılmış bir mod kullanıyordur;
    o durumda ölçeklemek YANLIŞ olur ve kalibrasyon o çözünürlükte tekrarlanmalıdır.
    """
    W0, H0 = ref_boyut
    W, H = yeni_boyut
    sx, sy = W / W0, H / H0
    if abs(sx - sy) / sx > 0.005:
        raise KalibHata(
            f"Çözünürlük {W}x{H}, kalibrasyon {W0}x{H0}; en-boy oranı farklı "
            f"(ölçek x={sx:.4f}, y={sy:.4f}). Bu çözünürlükte ayrıca kalibrasyon yapın."
        )
    s = sx
    A = np.array([[1 / s, 0, 0.5 / s - 0.5], [0, 1 / s, 0.5 / s - 0.5], [0, 0, 1]], dtype=np.float64)
    return s, A


def K_olcekle(K: np.ndarray, s: float) -> np.ndarray:
    K = np.array(K, dtype=np.float64).copy()
    K[0, 0] *= s
    K[1, 1] *= s
    K[0, 2] = (K[0, 2] + 0.5) * s - 0.5
    K[1, 2] = (K[1, 2] + 0.5) * s - 0.5
    return K


def homografi_uygula(H: np.ndarray, pts) -> np.ndarray:
    pts = np.asarray(pts, dtype=np.float64).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, np.asarray(H, dtype=np.float64)).reshape(-1, 2)


def kosegen_kesisimi(kose4: np.ndarray) -> np.ndarray:
    """Perspektifte etiketin gerçek merkezi = köşegenlerin kesişimi (köşe ortalaması değil)."""
    a, b, c, d = [np.append(p, 1.0) for p in kose4]
    l1 = np.cross(a, c)
    l2 = np.cross(b, d)
    x = np.cross(l1, l2)
    return x[:2] / x[2]


# ---------------------------------------------------------------- kalibrasyon tahtası algılama
def tahta_ayar_oku() -> dict:
    yol = VERI / "tahta.json"
    if not yol.exists():
        raise KalibHata("kalib_veri/tahta.json yok. Önce 1_tahta_olustur.py çalıştırın "
                        "(satranç tahtası kullanıyorsanız REHBER.md'deki satranç örneğiyle elle oluşturun).")
    return json_oku(yol)


def tahta_noktalari(img: np.ndarray, ayar: dict):
    """Kalibrasyon tahtasının (nesne_mm Nx3, piksel Nx2) eşleşmesini döndürür; bulamazsa None.

    ChArUco: tahtanın bir kısmı kadraj dışında olsa da çalışır -> kadraj köşeleri doldurulabilir.
    Satranç: tahtanın tamamı görünmeli.
    """
    g = gri(img)
    if ayar["tur"] == "charuco":
        tahta = charuco_tahtasi(ayar["kare_x"], ayar["kare_y"], ayar["kare_mm"], ayar["isaret_mm"])
        cp = cv2.aruco.CharucoParameters()
        cp.minMarkers = 1
        dp = cv2.aruco.DetectorParameters()
        dp.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_NONE  # ChArUco köşeleri ayrıca iyileştiriliyor
        dp.minMarkerPerimeterRate = 0.01
        det = cv2.aruco.CharucoDetector(tahta, cp, dp)
        kose, idler, _, _ = det.detectBoard(g)
        if idler is None or len(idler) < 6:
            return None
        nesne, piksel = tahta.matchImagePoints(kose, idler)
        if nesne is None or len(nesne) < 6:
            return None
        return nesne.reshape(-1, 3).astype(np.float32), piksel.reshape(-1, 2).astype(np.float32)
    if ayar["tur"] == "satranc":
        desen = (int(ayar["ic_kose_x"]), int(ayar["ic_kose_y"]))
        ok, kose = cv2.findChessboardCornersSB(g, desen, flags=cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY)
        if not ok:
            return None
        s = float(ayar["kare_mm"])
        nesne = np.zeros((desen[0] * desen[1], 3), np.float32)
        nesne[:, :2] = np.mgrid[0:desen[0], 0:desen[1]].T.reshape(-1, 2) * s
        return nesne, kose.reshape(-1, 2).astype(np.float32)
    raise KalibHata(f"tahta.json içinde bilinmeyen tur: {ayar['tur']}")


def kapsama_haritasi(boyut, piksel_listeleri, sutun=8, satir=6) -> np.ndarray:
    """Kadrajı sutun x satir hücreye bölüp her hücreye düşen köşe sayısını sayar."""
    W, H = boyut
    say = np.zeros((satir, sutun), int)
    for p in piksel_listeleri:
        cx = np.clip((p[:, 0] / W * sutun).astype(int), 0, sutun - 1)
        cy = np.clip((p[:, 1] / H * satir).astype(int), 0, satir - 1)
        np.add.at(say, (cy, cx), 1)
    return say


def kapsama_yazdir(say: np.ndarray) -> str:
    satirlar = []
    for r in say:
        satirlar.append(" ".join("  . " if v == 0 else f"{min(v, 999):4d}" for v in r))
    bos = int((say == 0).sum())
    satirlar.append(f"Boş hücre: {bos}/{say.size}  (kadrajın her bölgesine, özellikle köşelere köşe düşmeli)")
    return "\n".join(satirlar)
