"""Çalışma zamanı dönüşüm kütüphanesi — filiz tespit kodunuz yalnız bunu içe aktarır.

    from donusum import KameraDonusum
    d = KameraDonusum()                       # kalib_veri/kamera_ic.json + kamera_dis.json
    duz = d.duzelt(ham_kare)                  # lens distorsiyonu giderilmiş kare
    mm  = d.piksel_to_mm([[u, v]], kaynak="ham")   # ham karedeki piksel -> makine X,Y (mm)

Zincir:  ham piksel --(K, distCoeffs)--> düzeltilmiş piksel --(16 noktalı H)--> makine mm

Kalibrasyon hangi çözünürlükte yapıldıysa, aynı kadrajın başka bir çözünürlüğü
(ör. 3840x2880 yerine 640x480) otomatik ölçeklenir. En-boy oranı farklıysa hata verir.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

import ortak
from ortak import KalibHata

_KRITER = (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 100, 1e-8)


class KameraDonusum:
    def __init__(self, ic_yol: Path | str = ortak.IC_DOSYA, dis_yol: Path | str | None = ortak.DIS_DOSYA):
        ic = ortak.json_oku(ic_yol)
        if ic.get("tur") != "kamera_ic":
            raise KalibHata(f"{ic_yol} bir iç kalibrasyon dosyası değil.")
        self.ref_boyut = tuple(int(x) for x in ic["goruntu_boyutu"])
        self.K0 = np.array(ic["K"], dtype=np.float64)
        self.dist = np.array(ic["dist"], dtype=np.float64).ravel()
        self.yeniK0 = np.array(ic["yeniK"], dtype=np.float64)
        self.ic_bilgi = ic

        self.H0 = None          # referans düzeltilmiş piksel -> mm
        self.rvec = self.tvec = None
        self.dis_bilgi = None
        if dis_yol is not None and Path(dis_yol).exists():
            dis = ortak.json_oku(dis_yol)
            if tuple(dis["goruntu_boyutu"]) != self.ref_boyut:
                raise KalibHata("kamera_dis.json başka bir iç kalibrasyonla üretilmiş; 4_etiket_kalibrasyon.py'yi tekrar çalıştırın.")
            if abs(dis.get("ic_rms_px", -1) - ic["rms_px"]) > 1e-9:
                raise KalibHata("İç kalibrasyon değişmiş ama homografi eski. 4_etiket_kalibrasyon.py'yi tekrar çalıştırın.")
            self.H0 = np.array(dis["H_piksel_mm"], dtype=np.float64)
            self.rvec = np.array(dis["rvec"], dtype=np.float64).reshape(3, 1)
            self.tvec = np.array(dis["tvec"], dtype=np.float64).reshape(3, 1)
            self.dis_bilgi = dis
        self._onbellek: dict[tuple[int, int], dict] = {}

    # ------------------------------------------------------------ çözünürlük
    def _durum(self, boyut) -> dict:
        boyut = (int(boyut[0]), int(boyut[1]))
        if boyut in self._onbellek:
            return self._onbellek[boyut]
        s, A = ortak.olcek_matrisi(self.ref_boyut, boyut)
        K = ortak.K_olcekle(self.K0, s)
        yeniK = ortak.K_olcekle(self.yeniK0, s)
        d = {"s": s, "K": K, "yeniK": yeniK, "harita": None}
        if self.H0 is not None:
            d["H"] = self.H0 @ A                 # yeni-çözünürlük düz piksel -> mm
            d["Hinv"] = np.linalg.inv(d["H"])
        self._onbellek[boyut] = d
        return d

    def _gerekli_H(self, d):
        if "H" not in d:
            raise KalibHata("Homografi yok: önce 4_etiket_kalibrasyon.py çalıştırılmalı.")

    # ------------------------------------------------------------ görüntü
    def duzelt(self, img: np.ndarray) -> np.ndarray:
        """cv2.undistort ile aynı sonucu verir; haritalar bir kez hesaplanıp önbelleğe alınır
        (3840x2880 karede her seferinde cv2.undistort çağırmaktan çok daha hızlı)."""
        h, w = img.shape[:2]
        d = self._durum((w, h))
        if d["harita"] is None:
            d["harita"] = cv2.initUndistortRectifyMap(d["K"], self.dist, None, d["yeniK"], (w, h), cv2.CV_16SC2)
        m1, m2 = d["harita"]
        return cv2.remap(img, m1, m2, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)

    # ------------------------------------------------------------ nokta dönüşümleri
    def ham_to_duz(self, pts, boyut) -> np.ndarray:
        d = self._durum(boyut)
        p = np.asarray(pts, dtype=np.float64).reshape(-1, 1, 2)
        if len(p) == 0:
            return np.zeros((0, 2))
        out = cv2.undistortPointsIter(p, d["K"], self.dist, None, d["yeniK"], _KRITER)
        return out.reshape(-1, 2)

    def duz_to_ham(self, pts, boyut) -> np.ndarray:
        d = self._durum(boyut)
        p = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        if len(p) == 0:
            return np.zeros((0, 2))
        Kinv = np.linalg.inv(d["yeniK"])
        n = (Kinv @ np.c_[p, np.ones(len(p))].T).T
        n3 = np.c_[n[:, 0] / n[:, 2], n[:, 1] / n[:, 2], np.ones(len(p))]
        out, _ = cv2.projectPoints(n3, np.zeros(3), np.zeros(3), d["K"], self.dist)
        return out.reshape(-1, 2)

    def piksel_to_mm(self, pts, boyut, kaynak: str = "ham", yukseklik_mm: float = 0.0) -> np.ndarray:
        """Piksel(ler)i makine X,Y mm'ye çevirir.

        kaynak="ham": ham kameradaki piksel (tespit ham karede yapıldıysa)
        kaynak="duz": duzelt() çıktısındaki piksel
        yukseklik_mm: nokta toprak düzleminden ne kadar yukarıda (filiz tepesi gibi).
            0 ise 16 noktalı homografi kullanılır; >0 ise kamera pozuyla ışın-düzlem
            kesişimi yapılır (eğik kamerada yüksek noktaların kaymasını düzeltir).
        """
        boyut = (int(boyut[0]), int(boyut[1]))
        d = self._durum(boyut)
        self._gerekli_H(d)
        if kaynak == "ham":
            duz = self.ham_to_duz(pts, boyut)
        elif kaynak == "duz":
            duz = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        else:
            raise ValueError("kaynak 'ham' ya da 'duz' olmalı")
        if len(duz) == 0:
            return np.zeros((0, 2))
        if not yukseklik_mm:
            return ortak.homografi_uygula(d["H"], duz)
        return self._isin_duzlem(duz, d, float(yukseklik_mm))

    def mm_to_piksel(self, mm, boyut, hedef: str = "duz", yukseklik_mm: float = 0.0) -> np.ndarray:
        boyut = (int(boyut[0]), int(boyut[1]))
        d = self._durum(boyut)
        self._gerekli_H(d)
        mm = np.asarray(mm, dtype=np.float64).reshape(-1, 2)
        if yukseklik_mm:
            z = self._z_isareti() * yukseklik_mm
            p3 = np.c_[mm, np.full(len(mm), z)]
            duz, _ = cv2.projectPoints(p3, self.rvec, self.tvec, d["yeniK"], None)
            duz = duz.reshape(-1, 2)
        else:
            duz = ortak.homografi_uygula(d["Hinv"], mm)
        return duz if hedef == "duz" else self.duz_to_ham(duz, boyut)

    # ------------------------------------------------------------ yükseklik
    def _z_isareti(self) -> float:
        R, _ = cv2.Rodrigues(self.rvec)
        C = (-R.T @ self.tvec).ravel()
        return 1.0 if C[2] > 0 else -1.0   # kameranın bulunduğu taraf "yukarı"

    def _isin_duzlem(self, duz, d, h):
        R, _ = cv2.Rodrigues(self.rvec)
        C = (-R.T @ self.tvec).ravel()
        z = self._z_isareti() * h
        Kinv = np.linalg.inv(d["yeniK"])
        isin_kam = (Kinv @ np.c_[duz, np.ones(len(duz))].T).T
        isin_dunya = isin_kam @ R            # = (R.T @ isin).T
        t = (z - C[2]) / isin_dunya[:, 2]
        return C[:2] + t[:, None] * isin_dunya[:, :2]

    # ------------------------------------------------------------ çizim
    def izgara_ciz(self, img: np.ndarray, hedef: str = "duz", adim_mm: float = 50.0,
                   x_aralik=(0, 540), y_aralik=(0, 645), renk=(0, 255, 255)) -> np.ndarray:
        """Makine koordinatlarında mm ızgarasını görüntüye çizer (görsel doğrulama)."""
        out = img.copy()
        h, w = img.shape[:2]
        kalin = max(1, w // 1200)
        xs = np.arange(x_aralik[0], x_aralik[1] + 1e-6, adim_mm)
        ys = np.arange(y_aralik[0], y_aralik[1] + 1e-6, adim_mm)
        for x in xs:
            yy = np.linspace(y_aralik[0], y_aralik[1], 60)
            p = self.mm_to_piksel(np.c_[np.full_like(yy, x), yy], (w, h), hedef)
            cv2.polylines(out, [np.round(p).astype(np.int32)], False, renk, kalin, cv2.LINE_AA)
        for y in ys:
            xx = np.linspace(x_aralik[0], x_aralik[1], 60)
            p = self.mm_to_piksel(np.c_[xx, np.full_like(xx, y)], (w, h), hedef)
            cv2.polylines(out, [np.round(p).astype(np.int32)], False, renk, kalin, cv2.LINE_AA)
        o = self.mm_to_piksel([[x_aralik[0], y_aralik[0]]], (w, h), hedef)[0]
        cv2.circle(out, tuple(np.round(o).astype(int)), 6 * kalin, (0, 0, 255), -1)
        cv2.putText(out, "0,0", tuple(np.round(o + 8 * kalin).astype(int)), cv2.FONT_HERSHEY_SIMPLEX,
                    0.6 * kalin, (0, 0, 255), kalin, cv2.LINE_AA)
        return out
