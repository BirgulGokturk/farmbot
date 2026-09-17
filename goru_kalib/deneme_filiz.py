"""Leke bulucusunu kalibrasyona bağlayıp mm koordinatı üretir — DENEME.

Zincirin uçtan uca çalıştığını görmek için: kare çek -> lekeleri bul ->
piksel kutularını makine milimetresine çevir -> ekrana yaz ve işaretli
kareyi kaydet.

HAM KARE KULLANILIYOR, ajanın döndürdüğü kare değil. Ajan panele
`dondur: 90` uygulanmış kare gönderiyor ama kalibrasyon ham karenin
koordinat sisteminde kuruldu. İkisini karıştırmak bütün kalibrasyonu
boşa çıkarır; burada kamerayı doğrudan açıp ham kareyi alıyoruz.

NOKTA SEÇİMİ. Eğik kamerada filizin tepesi, toprağa değdiği noktadan
kaymış görünüyor. Üç seçenek var ve hangisinin doğru olduğu ancak ekim
kaydıyla karşılaştırınca anlaşılıyor:
    --nokta merkez   kutunun ortası (varsayılan)
    --nokta alt      kutunun alt-orta noktası; gövde dibi kameraya uzak
                     tarafta görünüyorsa daha doğru
    --yukseklik-mm N kutu merkezinin topraktan tahmini yüksekliği

Kullanım (ajan durdurulmuş olmalı, kamera tek süreçte açılıyor):
    python3 deneme_filiz.py
    python3 deneme_filiz.py --nokta alt
    python3 deneme_filiz.py --yukseklik-mm 20
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2

# Leke bulucu ajan tarafında; kalibrasyon kütüphaneleri burada.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ajan"))
import lekeler as lekeler_modul                          # noqa: E402

from donusum import KameraDonusum                        # noqa: E402
from filiz_koordinat import ciz, tespitleri_mm           # noqa: E402


def kare_cek(cihaz: int, genislik: int, yukseklik: int):
    cap = cv2.VideoCapture(cihaz)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, genislik)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, yukseklik)
    # İlk kareler pozlama oturmadan geliyor; birkaçını atıyoruz.
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
    ap.add_argument("--nokta", default="merkez", choices=("merkez", "alt"))
    ap.add_argument("--yukseklik-mm", type=float, default=0.0)
    ap.add_argument("--foto", help="kamera yerine hazır kare")
    ap.add_argument("--cikti", default="/home/batupi/farmbot/sunucu/static/_kalib_bak.jpg")
    a = ap.parse_args()

    kare = cv2.imread(a.foto) if a.foto else kare_cek(a.cihaz, a.genislik, a.yukseklik)
    y, g = kare.shape[:2]
    print(f"kare: {g}x{y}")

    # Leke bulucu JPEG bayt bekliyor (ajanla aynı yol).
    ok, jpg = cv2.imencode(".jpg", kare, [cv2.IMWRITE_JPEG_QUALITY, 92])
    sonuc = lekeler_modul.bul(jpg.tobytes())
    lekeler = sonuc.get("lekeler") or []
    print(f"leke : {len(lekeler)}  ({sonuc.get('sure_ms')} ms, yontem {sonuc.get('yontem')})")
    if sonuc.get("sebep"):
        print(f"sebep: {sonuc['sebep']}")
    if not lekeler:
        return

    # `tespitleri_mm` [x1, y1, x2, y2, guven] bekliyor. Leke bulucunun
    # güven değeri yok — ExG eşiği ikili bir karar, olasılık üretmiyor.
    # 1.0 yazmak "kesin" demek değil, alanın istediği biçimi doldurmak.
    kutular = [[*l["kutu"], 1.0] for l in lekeler]

    donusum = KameraDonusum()
    filizler = tespitleri_mm(kutular, donusum, (g, y), kaynak="ham",
                             nokta=a.nokta, yukseklik_mm=a.yukseklik_mm)

    print(f"\nnokta={a.nokta}  yukseklik_mm={a.yukseklik_mm}")
    print(f"{'#':>3}  {'X mm':>8} {'Y mm':>8} {'cap mm':>8}   {'alan px':>8}  parca")
    for i, (f, l) in enumerate(zip(filizler, lekeler), 1):
        print(f"{i:>3}  {f['x_mm']:>8.1f} {f['y_mm']:>8.1f} {f.get('cap_mm', 0):>8.1f}"
              f"   {l['alan_px']:>8}  {l.get('parca', 1)}")

    cv2.imwrite(a.cikti, cv2.resize(ciz(kare, filizler, donusum, "ham"),
                                    (1600, int(1600 * y / g))),
                [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(f"\nisaretli kare: {a.cikti}")


if __name__ == "__main__":
    main()
