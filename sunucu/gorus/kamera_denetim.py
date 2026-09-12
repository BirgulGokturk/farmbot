"""
kamera_denetim — bir kameranın ÖLÇÜM işine uygun olup olmadığını sınar.

Megapiksel sayısı değil, şu üçü belirler:
  1. Odak sabit mi? Otomatik odak kalibrasyonu sessizce bozar — odak değişince
     görüş açısı da değişir, homografi kayar.
  2. Pozlama ve beyaz denge kilitlenebiliyor mu? Otomatikse ExG eşiği her
     karede başka yere düşer.
  3. Montaj sağlam mı? Titreşim ve gevşek vida etiketleri piksellerce oynatır.

Kullanım: kamerayı kurun, etiketler kadrajda olacak şekilde bir saat boyunca
(ya da ışık değişimini kapsayan bir aralıkta) N kare kaydedin, sonra:

    python -m gorus.kamera_denetim /veri/kareler/denetim/*.jpg

Bu üçünü ölçer ve geçer/kalır der. Kamera almadan önce iade süresi içinde
çalıştırın.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

from . import etiket


def calistir(yollar, etiket_idleri=None, kayma_esigi_px=2.0,
             boyut_esigi_yuzde=1.0, parlaklik_esigi_yuzde=8.0) -> int:
    yollar = [Path(y) for y in yollar]
    if len(yollar) < 3:
        raise SystemExit("En az 3 kare gerek (ideali: bir saate yayılmış 10+).")

    kayit, parlaklik, boyutlar, atlanan = {}, [], {}, []
    for y in sorted(yollar):
        bgr = cv2.imread(str(y), cv2.IMREAD_COLOR)
        if bgr is None:
            atlanan.append((y.name, "okunamadı")); continue
        gri = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        parlaklik.append(float(gri.mean()))
        b = etiket.bul(bgr, etiket_idleri)
        if not b["etiketler"]:
            atlanan.append((y.name, "etiket bulunamadı")); continue
        for i, e in b["etiketler"].items():
            kayit.setdefault(i, []).append(e["merkez"])
            boyutlar.setdefault(i, []).append(e["kenar_px"])

    if not kayit:
        print("Hiçbir karede etiket bulunamadı — denetim yapılamıyor.")
        for ad, s in atlanan[:5]:
            print(f"  {ad}: {s}")
        return 2

    print(f"kare sayısı : {len(yollar) - len(atlanan)} / {len(yollar)}")
    if atlanan:
        print(f"atlanan     : {len(atlanan)}  ({atlanan[0][1]} ...)")

    print("\n1) MONTAJ / ODAK KARARLILIĞI — etiket merkezinin piksel kayması")
    en_kotu_kayma = 0.0
    for i in sorted(kayit):
        p = np.asarray(kayit[i], np.float64)
        if len(p) < 2:
            continue
        d = np.linalg.norm(p - p.mean(axis=0), axis=1)
        en_kotu_kayma = max(en_kotu_kayma, float(d.max()))
        print(f"   etiket {i:>2} : std {d.std():5.2f} px   max sapma {d.max():5.2f} px"
              f"   ({len(p)} kare)")

    print("\n2) ODAK / GÖRÜŞ AÇISI KAYMASI — etiket kenar uzunluğu")
    en_kotu_boyut = 0.0
    for i in sorted(boyutlar):
        k = np.asarray(boyutlar[i], np.float64)
        if len(k) < 2 or k.mean() <= 0:
            continue
        yuzde = float((k.max() - k.min()) / k.mean() * 100)
        en_kotu_boyut = max(en_kotu_boyut, yuzde)
        print(f"   etiket {i:>2} : ort {k.mean():6.1f} px   değişim %{yuzde:.2f}")

    print("\n3) POZLAMA KİLİDİ — kare ortalama parlaklığı")
    pr = np.asarray(parlaklik)
    p_yuzde = float((pr.max() - pr.min()) / max(pr.mean(), 1e-6) * 100)
    print(f"   min {pr.min():6.1f}   ort {pr.mean():6.1f}   max {pr.max():6.1f}"
          f"   değişim %{p_yuzde:.1f}")

    print("\n" + "=" * 62)
    sonuc = []
    sonuc.append(("Montaj/odak kararlılığı", en_kotu_kayma, kayma_esigi_px, "px",
                  "Titreşim, gevşek vida ya da otomatik odak. Montajı sıkın, "
                  "odağı kilitleyin."))
    sonuc.append(("Görüş açısı sabitliği", en_kotu_boyut, boyut_esigi_yuzde, "%",
                  "Odak nefes alıyor (otomatik odak/zoom). Manuel odaklı bir "
                  "kamera şart."))
    sonuc.append(("Pozlama kilidi", p_yuzde, parlaklik_esigi_yuzde, "%",
                  "Otomatik pozlama/AWB açık. v4l2-ctl ile kapatın, "
                  "kapanmıyorsa bu kamera ölçüme uygun değil."))
    kalan = 0
    for ad, deger, esik, birim, oneri in sonuc:
        ok = deger <= esik
        kalan += 0 if ok else 1
        print(f"{'GEÇTİ' if ok else 'KALDI':>6}  {ad:<26} {deger:6.2f} {birim:<2} "
              f"(eşik {esik} {birim})")
        if not ok:
            print(f"        → {oneri}")
    print("=" * 62)
    if kalan == 0:
        print("Kamera ölçüm için uygun. Kalibrasyona geçebilirsiniz.")
    else:
        print(f"{kalan} başlıkta kaldı — kalibrasyon yapmadan önce bunları çözün, "
              "yoksa hata kaynağını ayırt edemezsiniz.")
    return 0 if kalan == 0 else 1


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m gorus.kamera_denetim")
    p.add_argument("kareler", nargs="+")
    p.add_argument("--etiket-id", type=int, action="append", default=None)
    p.add_argument("--kayma-esigi", type=float, default=2.0, metavar="PX")
    p.add_argument("--boyut-esigi", type=float, default=1.0, metavar="YUZDE")
    p.add_argument("--parlaklik-esigi", type=float, default=8.0, metavar="YUZDE")
    a = p.parse_args(argv)
    return calistir(a.kareler, a.etiket_id, a.kayma_esigi,
                    a.boyut_esigi, a.parlaklik_esigi)


if __name__ == "__main__":
    raise SystemExit(main())
