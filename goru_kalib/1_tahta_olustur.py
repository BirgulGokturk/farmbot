#!/usr/bin/env python3
"""ADIM 1 — Yazdırılacak ChArUco kalibrasyon tahtasını üretir (PDF + PNG, gerçek ölçekte).

    python3 1_tahta_olustur.py                  # A4: 9x6 kare, 30 mm
    python3 1_tahta_olustur.py --kagit A3       # A3: 12x8 kare, 32 mm

Yazdırırken "Gerçek boyut / %100 / Sığdırma KAPALI" seçin. Sonra bir kareyi
kumpasla ölçüp tahta.json içindeki kare_mm'yi o ölçüyle güncelleyin.
"""
import argparse

import cv2
import numpy as np

import ortak

KAGIT = {"A4": (297.0, 210.0), "A3": (420.0, 297.0)}
VARSAYILAN = {"A4": (9, 6, 30.0), "A3": (12, 8, 32.0)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kagit", choices=KAGIT, default="A4")
    ap.add_argument("--kare-x", type=int)
    ap.add_argument("--kare-y", type=int)
    ap.add_argument("--kare-mm", type=float)
    ap.add_argument("--dpi", type=int, default=300)
    a = ap.parse_args()

    kx, ky, kmm = VARSAYILAN[a.kagit]
    kx, ky, kmm = a.kare_x or kx, a.kare_y or ky, a.kare_mm or kmm
    imm = round(kmm * 0.72, 2)                     # işaret/kare oranı 0.72
    kw, kh = KAGIT[a.kagit]
    if kx * kmm > kw - 10 or ky * kmm > kh - 10:
        raise ortak.KalibHata(f"{kx}x{ky} kare × {kmm} mm, {a.kagit} kâğıda (5 mm kenar payıyla) sığmıyor.")

    px_mm = a.dpi / 25.4
    sayfa = (int(round(kw * px_mm)), int(round(kh * px_mm)))
    tahta = ortak.charuco_tahtasi(kx, ky, kmm, imm)
    tw, th = int(round(kx * kmm * px_mm)), int(round(ky * kmm * px_mm))
    goruntu = tahta.generateImage((tw, th), marginSize=0, borderBits=1)
    tuval = np.full((sayfa[1], sayfa[0]), 255, np.uint8)
    ox, oy = (sayfa[0] - tw) // 2, (sayfa[1] - th) // 2
    tuval[oy:oy + th, ox:ox + tw] = goruntu
    yazi = f"ChArUco {kx}x{ky}  kare={kmm}mm  isaret={imm}mm  DICT_5X5_100  %100 yazdir"
    cv2.putText(tuval, yazi, (ox, max(40, oy - 20)), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 0, 2, cv2.LINE_AA)
    # 100 mm kontrol çizgisi: yazıcı ölçeğini cetvelle doğrulamak için
    y = sayfa[1] - max(30, (sayfa[1] - oy - th) // 2)
    x0 = ox
    cv2.line(tuval, (x0, y), (x0 + int(round(100 * px_mm)), y), 0, 3)
    cv2.putText(tuval, "100 mm", (x0 + int(round(105 * px_mm)), y + 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, 0, 2)

    ortak.VERI.mkdir(parents=True, exist_ok=True)
    png = ortak.VERI / f"charuco_{a.kagit}.png"
    cv2.imwrite(str(png), tuval)
    pdf = None
    try:
        from PIL import Image
        pdf = ortak.VERI / f"charuco_{a.kagit}.pdf"
        Image.fromarray(tuval).save(str(pdf), "PDF", resolution=float(a.dpi))
    except ImportError:
        print("Pillow yok; yalnız PNG üretildi (PDF için: pip install pillow).")

    ortak.json_yaz(ortak.VERI / "tahta.json", {
        "tur": "charuco", "kare_x": kx, "kare_y": ky, "kare_mm": kmm, "isaret_mm": imm,
        "sozluk": "DICT_5X5_100", "not": "Yazdırdıktan sonra kare_mm ve isaret_mm'yi kumpas ölçüsüyle güncelleyin.",
    })
    print(f"Tahta: {kx}x{ky} kare, kare {kmm} mm, işaret {imm} mm, iç köşe sayısı {(kx-1)*(ky-1)}")
    print(f"Yazdır: {pdf or png}")
    print(f"Ayar : {ortak.VERI / 'tahta.json'}")


if __name__ == "__main__":
    try:
        main()
    except ortak.KalibHata as e:
        raise SystemExit(f"HATA: {e}")
