#!/usr/bin/env python3
"""ADIM 2 — İç kalibrasyon fotoğraflarını çeker ve anında kapsama raporu verir.

Kamera tek bir süreçte açılabilir. Farmbot ajanı kamerayı tutuyorsa bu betik
kamerayı açamaz; o durumda ya ajanın kamerasını geçici olarak kapatın ya da
fotoğrafları başka yolla aynı kamera + aynı çözünürlükte çekip --kaynak klasor ile
yalnız analiz ettirin.

    python3 2_foto_cek.py --kaynak picamera2 --genislik 3840 --yukseklik 2880
    python3 2_foto_cek.py --kaynak rpicam   --genislik 3840 --yukseklik 2880 --aralik 4
    python3 2_foto_cek.py --kaynak opencv:0 --genislik 3840 --yukseklik 2880
    python3 2_foto_cek.py --kaynak klasor --klasor kalib_veri/ic_fotolar     # yalnız analiz

Enter = çek, q + Enter = bitir.  --aralik N verilirse N saniyede bir otomatik çeker.
"""
import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

import ortak

HEDEF_FOTO = 30


class Kamera:
    def __init__(self, kaynak: str, w: int, h: int, lens: float | None):
        self.kaynak, self.w, self.h = kaynak, w, h
        self.cam = None
        if kaynak == "picamera2":
            from picamera2 import Picamera2
            self.cam = Picamera2()
            cfg = self.cam.create_still_configuration(main={"size": (w, h), "format": "RGB888"})
            self.cam.configure(cfg)
            kontroller = self.cam.camera_controls
            if "AfMode" in kontroller:
                if lens is None:
                    print("UYARI: Kamerada otomatik odak var. Odak değişirse kalibrasyon bozulur. "
                          "--lens-konumu ile sabitleyin ve çalışma zamanında aynı değeri kullanın.")
                else:
                    from libcamera import controls
                    self.cam.set_controls({"AfMode": controls.AfModeEnum.Manual, "LensPosition": float(lens)})
            self.cam.start()
            time.sleep(1.5)
        elif kaynak.startswith("opencv:"):
            self.cam = cv2.VideoCapture(int(kaynak.split(":")[1]))
            self.cam.set(cv2.CAP_PROP_FRAME_WIDTH, w)
            self.cam.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
            self.cam.set(cv2.CAP_PROP_AUTOFOCUS, 0)
            if not self.cam.isOpened():
                raise ortak.KalibHata(f"OpenCV kamera {kaynak} açılamadı.")
        elif kaynak == "rpicam":
            if not shutil.which("rpicam-still"):
                raise ortak.KalibHata("rpicam-still bulunamadı.")
        else:
            raise ortak.KalibHata(f"Bilinmeyen kaynak: {kaynak}")
        self.lens = lens

    def cek(self, yol: Path) -> np.ndarray:
        if self.kaynak == "picamera2":
            img = self.cam.capture_array("main")          # RGB888 -> OpenCV'de BGR sırası
        elif self.kaynak.startswith("opencv:"):
            for _ in range(3):
                self.cam.grab()                            # tampondaki eski kareleri at
            ok, img = self.cam.read()
            if not ok:
                raise ortak.KalibHata("Kare okunamadı.")
        else:
            komut = ["rpicam-still", "-n", "-t", "800", "--width", str(self.w), "--height", str(self.h),
                     "-q", "95", "-o", str(yol)]
            if self.lens is not None:
                komut += ["--autofocus-mode", "manual", "--lens-position", str(self.lens)]
            r = subprocess.run(komut, capture_output=True, text=True)
            if r.returncode != 0:
                raise ortak.KalibHata("rpicam-still hata verdi (kamera başka süreçte açık olabilir):\n" + r.stderr[-400:])
            return ortak.resim_oku(yol)
        if img.shape[1] != self.w or img.shape[0] != self.h:
            raise ortak.KalibHata(f"Kamera {img.shape[1]}x{img.shape[0]} verdi, {self.w}x{self.h} istendi.")
        cv2.imwrite(str(yol), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return img

    def kapat(self):
        if self.kaynak == "picamera2" and self.cam:
            self.cam.stop()
        elif self.cam is not None and self.kaynak.startswith("opencv:"):
            self.cam.release()


def analiz(img, ayar, yol, gecerli):
    r = ortak.tahta_noktalari(img, ayar)
    netlik = cv2.Laplacian(ortak.gri(img), cv2.CV_64F).var()
    if r is None:
        print(f"  {yol.name}: tahta bulunamadı -> reddedilen/ klasörüne taşındı (netlik {netlik:.0f})")
        red = yol.parent / "reddedilen"
        red.mkdir(exist_ok=True)
        shutil.move(str(yol), red / yol.name)
        return
    gecerli.append(r[1])
    print(f"  {yol.name}: {len(r[1])} köşe, netlik {netlik:.0f}  | geçerli foto: {len(gecerli)}/{HEDEF_FOTO}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kaynak", default="picamera2")
    ap.add_argument("--klasor", default=str(ortak.VERI / "ic_fotolar"))
    ap.add_argument("--genislik", type=int, default=3840)
    ap.add_argument("--yukseklik", type=int, default=2880)
    ap.add_argument("--aralik", type=float, default=0.0, help="saniye; 0 = Enter ile çek")
    ap.add_argument("--lens-konumu", type=float, default=None)
    a = ap.parse_args()

    ayar = ortak.tahta_ayar_oku()
    klasor = Path(a.klasor)
    klasor.mkdir(parents=True, exist_ok=True)
    gecerli: list[np.ndarray] = []
    boyut = None

    if a.kaynak == "klasor":
        dosyalar = sorted(p for p in klasor.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if not dosyalar:
            raise ortak.KalibHata(f"{klasor} içinde fotoğraf yok.")
        for p in dosyalar:
            img = ortak.resim_oku(p)
            boyut = boyut or (img.shape[1], img.shape[0])
            if (img.shape[1], img.shape[0]) != boyut:
                raise ortak.KalibHata(f"{p.name} farklı çözünürlükte; tüm fotoğraflar aynı boyutta olmalı.")
            analiz(img, ayar, p, gecerli)
    else:
        kam = Kamera(a.kaynak, a.genislik, a.yukseklik, a.lens_konumu)
        boyut = (a.genislik, a.yukseklik)
        n = len(list(klasor.glob("foto_*.jpg")))
        print("Enter = çek, q + Enter = bitir" if not a.aralik else f"{a.aralik} sn'de bir çekiyor; Ctrl+C = bitir")
        try:
            while True:
                if a.aralik:
                    for k in range(int(a.aralik), 0, -1):
                        print(f"\r  {k} ", end="", flush=True)
                        time.sleep(1)
                    print("\r  ÇEK!")
                elif input("> ").strip().lower() == "q":
                    break
                yol = klasor / f"foto_{n:03d}.jpg"
                n += 1
                img = kam.cek(yol)
                analiz(img, ayar, yol, gecerli)
                if len(gecerli) % 5 == 0 and gecerli:
                    print(ortak.kapsama_yazdir(ortak.kapsama_haritasi(boyut, gecerli)))
        except KeyboardInterrupt:
            print()
        finally:
            kam.kapat()

    if gecerli:
        print("\nKAPSAMA (kadraj 8x6 hücre, her hücredeki toplam köşe):")
        print(ortak.kapsama_yazdir(ortak.kapsama_haritasi(boyut, gecerli)))
    print(f"Geçerli fotoğraf: {len(gecerli)}. Öneri: en az 20, ideal {HEDEF_FOTO}; boş hücre kalmasın.")


if __name__ == "__main__":
    try:
        main()
    except ortak.KalibHata as e:
        sys.exit(f"HATA: {e}")
