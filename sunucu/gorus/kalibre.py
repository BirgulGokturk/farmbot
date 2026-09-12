"""
kalibre — gerçek bir kareden kalibrasyon dosyası üretir.

Etiketlerin mm konumlarını robot probuyla zaten ölçüyorsunuz. Bu araç kareyi
alır, AprilTag'leri bulur, homografiyi kurar, artığı ÖLÇER ve
`kalibrasyon.json`'u yazar. Ayrıca iki denetim görseli üretir; kalibrasyonun
doğru olduğunu gözle görmeden bir sonraki adıma geçmeyin.

    python -m gorus.kalibre kare.jpg \
        --etiket 0=45,45 --etiket 1=495,45 --etiket 8=495,600 --etiket 9=45,600 \
        --yatak 540,645 --cikti gorus/veri/kalibrasyon.json

`kare_boyu` alanı otomatik olarak KARENİN KENDİ boyutundan yazılır — elle
JSON düzenlerken en sık yapılan hata buydu.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

from . import cizim, etiket
from .duzlem import Duzlem


def _etiket_ayristir(degerler) -> dict[int, tuple[float, float]]:
    out = {}
    for d in degerler:
        try:
            kimlik, koord = d.split("=", 1)
            x, y = koord.split(",")
            out[int(kimlik)] = (float(x), float(y))
        except ValueError:
            raise SystemExit(f"--etiket biçimi hatalı: {d!r}  (örnek: 0=45,45)")
    return out


def calistir(kare_yolu, etiket_mm, yatak_mm, cikti, gorsel_dizin=None) -> dict:
    bgr = cv2.imread(str(kare_yolu), cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"Kare okunamadı: {kare_yolu}")
    boy = (bgr.shape[1], bgr.shape[0])
    print(f"kare        : {kare_yolu}  {boy[0]}x{boy[1]}")

    b = etiket.bul(bgr, list(etiket_mm))
    print(f"bulunan     : {b['tani']['bulunan_idler']}  "
          f"(en küçük kenar {b['tani']['en_kucuk_kenar_px']} px)")
    if b["eksik"]:
        print(f"EKSİK       : {b['eksik']}")
        print("  · Etiketler kadrajda mı? Portal üstlerinde olmasın.")
        print("  · Kâğıt parlıyor ya da gölgede kalıyor olabilir.")
        print("  · Karede etiket kenarı ~25 px'in altındaysa daha yüksek")
        print("    çözünürlükte kare çekin.")
        raise SystemExit(2)

    ciftler = {i: (b["etiketler"][i]["merkez"], etiket_mm[i]) for i in etiket_mm}
    D = Duzlem.etiketlerden(ciftler, boy, yatak_mm)
    oz = D.oz_denetim()

    print(f"\nartık RMS   : {oz['artik_rms_mm']:.3f} mm   (max {oz['artik_max_mm']:.3f} mm)")
    for k, v in oz["etiket_basina_mm"].items():
        print(f"  etiket {k:>2} : {v:6.3f} mm")
    olcek = D.olcek_ozeti()
    print("\nölçek mm/px :", "  ".join(f"{k} {v}" for k, v in olcek.items()))
    oran = max(olcek.values()) / min(olcek.values())
    print(f"ölçek oranı : {oran:.2f}x  (1.0 = tam tepeden; büyükse kamera eğik)")

    if oz["artik_rms_mm"] > 2.0:
        print("\nUYARI: artık 2 mm'nin üstünde. Olası sebepler:")
        print("  · Etiketler aynı düzlemde/toprak yüzeyinde değil")
        print("  · Prob ölçümlerinden biri yanlış girilmiş")
        print("  · Etiket merkezi yerine köşesi ölçülmüş")

    yol = Path(cikti)
    D.kaydet(yol)
    print(f"\nyazıldı     : {yol}")
    print(f"  kare_boyu = {list(boy)}  ← tespit karesi bu ORANDA olmalı")

    giz = Path(gorsel_dizin or yol.parent)
    giz.mkdir(parents=True, exist_ok=True)
    g = bgr.copy()
    cizim.yatak_ve_izgara(g, D)
    g = cizim.etiket_isaretleri(g, D, {"etiket_basina_mm": oz["etiket_basina_mm"]})
    g = cizim.bilgi_seridi(g, [
        f"KALİBRASYON DENETİMİ   {boy[0]}x{boy[1]}",
        f"artık RMS {oz['artik_rms_mm']:.2f} mm   ölçek {min(olcek.values())}–"
        f"{max(olcek.values())} mm/px",
        "Izgara toprağa oturmalı; mor artılar etiketlerin üstüne düşmeli.",
    ])
    g_yolu = giz / "kalibrasyon_denetim.jpg"
    cv2.imwrite(str(g_yolu), g, [cv2.IMWRITE_JPEG_QUALITY, 90])

    ortho, _ = cizim.ustten_gorunum(bgr, D, px_mm=2.0)
    o_yolu = giz / "kalibrasyon_ustten.jpg"
    cv2.imwrite(str(o_yolu), ortho, [cv2.IMWRITE_JPEG_QUALITY, 90])

    print(f"\ndenetim görselleri:\n  {g_yolu}\n  {o_yolu}")
    print("\nİKİSİNE DE BAKIN:")
    print("  · kalibrasyon_denetim.jpg — ızgara toprağa oturuyor mu, mor artılar")
    print("    etiketlerin üstünde mi? Değilse X/Y takas ya da bir eksen ters.")
    print("  · kalibrasyon_ustten.jpg — yatak dümdüz dikdörtgen, etiketler kare")
    print("    çıkıyor mu? Yamuksa homografi bozuk.")
    return {"artik_rms_mm": oz["artik_rms_mm"], "kalibrasyon": str(yol),
            "gorseller": [str(g_yolu), str(o_yolu)]}


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m gorus.kalibre")
    p.add_argument("kare")
    p.add_argument("--etiket", action="append", required=True,
                   metavar="ID=X,Y", help="probla ölçülmüş etiket merkezi, mm")
    p.add_argument("--yatak", default="540,645", metavar="W,H")
    p.add_argument("--cikti", default="gorus/veri/kalibrasyon.json")
    p.add_argument("--gorsel-dizin", default=None)
    a = p.parse_args(argv)
    yatak = tuple(float(v) for v in a.yatak.split(","))
    calistir(a.kare, _etiket_ayristir(a.etiket), yatak, a.cikti, a.gorsel_dizin)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
