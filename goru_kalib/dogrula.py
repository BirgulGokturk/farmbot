"""Kalibrasyonu BAĞIMSIZ doğrular: etiketleri bulur, mm'ye çevirir, ölçümle kıyaslar.

`4_etiket_kalibrasyon.py` kendi kurduğu homografiyi kendi raporluyor —
bir hesabın kendi içinde tutarlı olması onu doğru yapmıyor. Bu betik
zinciri dışarıdan yürüyor: kareyi çeker, etiketleri bulur, köşelerini
`donusum.KameraDonusum` ile mm'ye çevirir ve `etiketler.json`'daki
PROBLA ÖLÇÜLEN değerlerle karşılaştırır.

Çıkan fark, koordinat zincirinin uçtan uca gerçek hatasıdır: lens
düzeltmesi, homografi ve piksel tespiti birlikte. Filiz koordinatlarında
bekleyeceğin hata da bu mertebede olur.

Kullanım (ajan durdurulmuş olmalı):
    python3 dogrula.py
    python3 dogrula.py --foto kalib_veri/yatak_1.jpg
"""

from __future__ import annotations

import argparse
import json
import math

import cv2
import numpy as np

import ortak
from donusum import KameraDonusum


def kare_al(cihaz: int, g: int, y: int):
    cap = cv2.VideoCapture(cihaz)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, g)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, y)
    for _ in range(8):
        cap.read()
    ok, kare = cap.read()
    cap.release()
    if not ok or kare is None:
        raise SystemExit("Kamera kare vermedi — ajan kamerayı tutuyor olabilir.")
    return kare


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cihaz", type=int, default=0)
    ap.add_argument("--genislik", type=int, default=3840)
    ap.add_argument("--yukseklik", type=int, default=2160)
    ap.add_argument("--foto")
    a = ap.parse_args()

    kare = cv2.imread(a.foto) if a.foto else kare_al(a.cihaz, a.genislik, a.yukseklik)
    y, g = kare.shape[:2]
    print(f"kare: {g}x{y}")

    with open(ortak.ETIKET_DOSYA, encoding="utf-8") as d:
        tanim = json.load(d)
    beklenen = {}
    for e in tanim.get("etiketler", []):
        if str(e.get("rol", "referans")) == "yok":
            continue
        beklenen[int(e["id"])] = (e.get("merkez_mm"), e.get("koseler_mm"))

    sozluk = cv2.aruco.getPredefinedDictionary(ortak.ETIKET_SOZLUK)
    p = cv2.aruco.DetectorParameters()
    # Sahada gerekti: varsayılan eşik penceresiyle uzak etiketler
    # bulunamıyordu (id 0 hiç, id 8 10 karede 2).
    p.adaptiveThreshWinSizeMin = 3
    p.adaptiveThreshWinSizeMax = 53
    p.adaptiveThreshWinSizeStep = 4
    p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    kose, ids, _ = cv2.aruco.ArucoDetector(sozluk, p).detectMarkers(kare)
    if ids is None:
        raise SystemExit("Görüntüde etiket bulunamadı.")

    donusum = KameraDonusum()
    print(f"\n{'id':>4}  {'olculen mm':>18}  {'zincirden mm':>18}  {'fark':>7}")
    farklar = []
    for k, i in zip(kose, ids.flatten()):
        i = int(i)
        if i not in beklenen:
            print(f"{i:>4}  (etiketler.json'da yok, atlandi)")
            continue
        merkez, koseler = beklenen[i]
        # Etiketin görüntüdeki merkezi = dört köşesinin ortası
        px = k[0].mean(axis=0)
        mm = donusum.piksel_to_mm([px], (g, y), kaynak="ham")[0]
        if koseler:
            olculen = np.mean(np.array(koseler, dtype=float), axis=0)
        else:
            olculen = np.array(merkez, dtype=float)
        fark = math.dist(olculen, mm)
        farklar.append(fark)
        print(f"{i:>4}  {olculen[0]:>8.1f},{olculen[1]:>8.1f}  "
              f"{mm[0]:>8.1f},{mm[1]:>8.1f}  {fark:>7.2f}")

    if farklar:
        print(f"\nortalama {sum(farklar)/len(farklar):.2f} mm   "
              f"en buyuk {max(farklar):.2f} mm")
        print("\n(Bu sayi zincirin UCTAN UCA hatasi: lens duzeltmesi + homografi +")
        print(" piksel tespiti. Filiz koordinatlarinda da bu mertebede hata olur.)")


if __name__ == "__main__":
    main()
