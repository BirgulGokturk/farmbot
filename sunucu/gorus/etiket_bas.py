"""
etiket_bas — yazdırılabilir AprilTag 36h11 sayfası üretir.

36h11 ailesinde 587 kimlik var; elinizdekilere yenisini eklemek sadece
yazdırma işi. Bu araç seçtiğiniz kimlikleri, beyaz kenarlığı ve kesme
çizgileriyle birlikte tek bir PNG'ye dizer.

    python -m gorus.etiket_bas --id 2 --id 3 --kenar 60 --cikti etiketler.png

ÖLÇEK DERDİ YOK: yazıcı büzüştürse bile önemli değil, çünkü panel zaten
basılmış siyah karenin kumpasla ölçülmüş kenarını istiyor. Bastıktan sonra
ölçün, çıkan sayıyı panele girin.

Yapıştırmadan önce: kalın kâğıda basın ya da lamine edin, mukavvaya
yapıştırın. Kabaran kâğıt etiketi toprak düzleminden kaldırır ve
kalibrasyonu bozar.
"""

from __future__ import annotations

import argparse

import numpy as np
import cv2


def sayfa(idler, kenar_mm=60.0, dpi=300, sutun=2, pay_orani=0.25) -> np.ndarray:
    px_mm = dpi / 25.4
    kenar = int(round(kenar_mm * px_mm))
    pay = int(round(kenar * pay_orani))          # beyaz sessiz bölge
    kutu = kenar + 2 * pay
    yazi_alani = int(round(8 * px_mm))
    hucre_h = kutu + yazi_alani

    sozluk = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_APRILTAG_36h11)
    satir = (len(idler) + sutun - 1) // sutun
    bosluk = int(round(10 * px_mm))
    W = sutun * kutu + (sutun + 1) * bosluk
    H = satir * hucre_h + (satir + 1) * bosluk
    sayfa = np.full((H, W, 3), 255, np.uint8)

    for n, kimlik in enumerate(idler):
        r, c = divmod(n, sutun)
        x0 = bosluk + c * (kutu + bosluk)
        y0 = bosluk + r * (hucre_h + bosluk)
        tag = cv2.cvtColor(cv2.aruco.generateImageMarker(sozluk, int(kimlik), kenar),
                           cv2.COLOR_GRAY2BGR)
        sayfa[y0 + pay:y0 + pay + kenar, x0 + pay:x0 + pay + kenar] = tag
        # kesme çizgisi — beyaz kenarlığın DIŞINDAN kesin
        cv2.rectangle(sayfa, (x0, y0), (x0 + kutu, y0 + kutu), (190, 190, 190), 1)
        cv2.putText(sayfa, f"36h11 id={kimlik}  kenar {kenar_mm:g} mm (KUMPASLA OLCUN)",
                    (x0, y0 + kutu + int(6 * px_mm)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5 * px_mm / 11.8, (60, 60, 60),
                    max(1, int(px_mm / 12)), cv2.LINE_AA)
    return sayfa


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m gorus.etiket_bas")
    p.add_argument("--id", action="append", type=int, required=True,
                   help="basılacak etiket kimliği (36h11: 0-586)")
    p.add_argument("--kenar", type=float, default=60.0, metavar="MM",
                   help="siyah karenin hedef kenarı, mm")
    p.add_argument("--dpi", type=int, default=300)
    p.add_argument("--sutun", type=int, default=2)
    p.add_argument("--cikti", default="etiketler.png")
    a = p.parse_args(argv)

    for i in a.id:
        if not 0 <= i <= 586:
            raise SystemExit(f"36h11 kimlikleri 0-586 arasında: {i}")

    img = sayfa(a.id, a.kenar, a.dpi, a.sutun)
    cv2.imwrite(a.cikti, img)
    print(f"yazıldı : {a.cikti}  {img.shape[1]}x{img.shape[0]} px @ {a.dpi} DPI")
    print(f"kimlik  : {a.id}")
    print(f"kağıtta : {img.shape[1]/a.dpi*25.4:.0f} x {img.shape[0]/a.dpi*25.4:.0f} mm")
    print("\nYazdırırken 'ölçekle/sığdır' KAPALI olsun (%100).")
    print("Bastıktan sonra siyah karenin kenarını KUMPASLA ölçüp panele girin —")
    print("yazıcı büzüştürse bile ölçtüğünüz sayı doğru olduğu sürece sorun yok.")
    print("Lamine edin ya da mukavvaya yapıştırın: kabaran kâğıt etiketi toprak")
    print("düzleminden kaldırır ve kalibrasyonu bozar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
