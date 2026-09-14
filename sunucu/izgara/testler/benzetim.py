"""Donanımsız doğrulama için eğik, distorsiyonlu sanal kamera.

Gerçek bir Pi kamerayı taklit etmiyor — SAYILARIN nereden geldiğini
gösteriyor. Buradaki k1/k2 seçilmiş değerler; sizin lensinizde farklı
çıkar. Değişmeyen şey yapısal olan: dört noktayla distorsiyon ölçülemez.
"""
from __future__ import annotations

import cv2
import numpy as np


class SanalKamera:
    def __init__(self, kare=(2160, 3840), gorus_derece=66.0, egim=35.0,
                 yukseklik=450.0, donme=4.0, k1=-0.28, k2=0.10,
                 yatak=(495.0, 610.0)):
        self.kare = kare
        self.yatak = yatak
        self.f = (kare[0] / 2) / np.tan(np.deg2rad(gorus_derece / 2))
        self.cx, self.cy = kare[0] / 2, kare[1] / 2
        self.k1, self.k2 = k1, k2
        a, b = np.deg2rad(180 - egim), np.deg2rad(donme)
        Rx = np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
        Rz = np.array([[np.cos(b), -np.sin(b), 0], [np.sin(b), np.cos(b), 0], [0, 0, 1]])
        self.R = Rx @ Rz
        merkez = np.array([yatak[0] / 2, yatak[1] / 2, 0.0])
        self.C = merkez + np.array([0.0, -yukseklik * np.tan(np.deg2rad(egim)),
                                    yukseklik])

    def px(self, mm, h_mm=0.0, gurultu_px=0.0, tohum=None):
        """(N,2) yatak mm + yükseklik -> (N,2) piksel."""
        mm = np.atleast_2d(np.asarray(mm, float))
        P = np.c_[mm, np.full(len(mm), float(h_mm))]
        Pc = (P - self.C) @ self.R.T
        x, y = Pc[:, 0] / Pc[:, 2], Pc[:, 1] / Pc[:, 2]
        r2 = x * x + y * y
        s = 1 + self.k1 * r2 + self.k2 * r2 * r2
        uv = np.c_[self.f * x * s + self.cx, self.f * y * s + self.cy]
        if gurultu_px:
            rng = np.random.default_rng(tohum)
            uv = uv + rng.normal(0, gurultu_px, uv.shape)
        return uv

    def mm_px_ortalama(self):
        k = self.px([[0, 0], [self.yatak[0], 0]])
        return self.yatak[0] / np.linalg.norm(k[1] - k[0])


def izgara_mm(nx=4, ny=6, yatak=(495.0, 610.0), pay=40.0):
    xs = np.linspace(pay, yatak[0] - pay, nx)
    ys = np.linspace(pay, yatak[1] - pay, ny)
    return np.array([[x, y] for y in ys for x in xs], float)


def rastgele_mm(n=40, yatak=(495.0, 610.0), pay=15.0, tohum=1):
    r = np.random.default_rng(tohum)
    return np.c_[r.uniform(pay, yatak[0] - pay, n),
                 r.uniform(pay, yatak[1] - pay, n)]
