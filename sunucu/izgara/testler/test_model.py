"""Izgara kalibrasyonunun ölçümü. Donanım gerekmez.

    python3 -m izgara.testler.test_model
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from izgara.model import Nokta, kur, dogrula, capraz_dogrula, KalibrasyonHatasi
from izgara.testler.benzetim import SanalKamera, izgara_mm, rastgele_mm


def _nokta(kam, mm, h=0.0, gurultu_px=0.0, makine_gurultu_mm=0.0, tohum=None):
    px = kam.px(mm, h, gurultu_px, tohum)
    mmg = mm
    if makine_gurultu_mm:
        mmg = mm + np.random.default_rng(tohum).normal(0, makine_gurultu_mm, mm.shape)
    return [Nokta(u_px=float(a), v_px=float(b), x_mm=float(c), y_mm=float(d), h_mm=h)
            for (a, b), (c, d) in zip(px, mmg)]


def bolum(ad):
    print("\n" + ad)
    print("-" * len(ad))


def main() -> int:
    kam = SanalKamera()
    print(f"sanal kamera: {kam.kare[0]}x{kam.kare[1]}, "
          f"ortalama {kam.mm_px_ortalama():.3f} mm/px, k1={kam.k1}")

    TEST = rastgele_mm(40)
    sonuc = {}

    bolum("1) Nokta sayısı — tek yükseklik ('duzlem' modeli)")
    print(f"{'ızgara':>12s} {'nokta':>6s} {'çapraz rms':>11s} {'bağımsız rms':>13s} {'maks':>8s}")
    for nx, ny in ((2, 2), (3, 2), (3, 4), (4, 6), (6, 8)):
        n = _nokta(kam, izgara_mm(nx=nx, ny=ny))
        try:
            m = kur(n, kam.kare)
        except KalibrasyonHatasi as e:
            print(f"{f'{nx}x{ny}':>12s} {nx*ny:6d}   KURULAMADI: {str(e)[:52]}")
            continue
        cd = capraz_dogrula(n, kam.kare)
        dg = dogrula(m, _nokta(kam, TEST))
        print(f"{f'{nx}x{ny}':>12s} {nx*ny:6d} {cd.get('rms_mm', float('nan')):11.3f} "
              f"{dg['rms_mm']:13.3f} {dg['maks_mm']:8.3f}")
        sonuc[f"duzlem_{nx}x{ny}"] = dg["rms_mm"]

    bolum("2) İki yükseklik ('uzay' modeli) — paralaks çözülüyor mu")
    n2 = _nokta(kam, izgara_mm(4, 6), 0.0) + _nokta(kam, izgara_mm(4, 6), 30.0)
    m2 = kur(n2, kam.kare)
    m1 = kur(_nokta(kam, izgara_mm(4, 6), 0.0), kam.kare)
    print(f"model: {m2.tur}, {len(n2)} nokta, yükseklikler {m2.yukseklikler_mm}")
    print(f"{'yaprak yüksekliği':>18s} {'duzlem modeli':>15s} {'uzay modeli':>13s}")
    for h in (0.0, 10.0, 20.0, 30.0, 50.0):
        k = _nokta(kam, TEST, h)
        try:
            d1 = dogrula(m1, [Nokta(x.u_px, x.v_px, x.x_mm, x.y_mm, 0.0) for x in k])
            a = d1["rms_mm"]
        except KalibrasyonHatasi:
            a = float("nan")
        d2 = dogrula(m2, k)
        print(f"{h:15.0f} mm {a:15.2f} {d2['rms_mm']:13.3f}")
        sonuc[f"uzay_h{int(h)}"] = d2["rms_mm"]

    bolum("3) Gürültü — nereye kadar dayanıyor")
    print(f"{'işaret bulma':>13s} {'makine':>9s} {'bağımsız rms':>13s}")
    for ip, mg in ((0.0, 0.0), (0.3, 0.0), (1.0, 0.0), (0.0, 0.25),
                   (0.0, 1.0), (1.0, 0.5), (2.0, 1.0)):
        rms = []
        for t in range(8):
            n = (_nokta(kam, izgara_mm(4, 6), 0.0, ip, mg, tohum=t) +
                 _nokta(kam, izgara_mm(4, 6), 30.0, ip, mg, tohum=100 + t))
            try:
                mm_ = kur(n, kam.kare)
                rms.append(dogrula(mm_, _nokta(kam, TEST, 15.0))["rms_mm"])
            except (KalibrasyonHatasi, np.linalg.LinAlgError):
                pass
        print(f"{ip:10.1f} px {mg:6.2f} mm {np.mean(rms):13.3f}")
        sonuc[f"gurultu_{ip}_{mg}"] = round(float(np.mean(rms)), 3)

    bolum("4) Yükseklik yanlış girilirse")
    print(f"{'h hatası':>10s} {'sonuç rms':>11s}")
    for dh in (0.0, 1.0, 2.0, 5.0, 10.0):
        n = (_nokta(kam, izgara_mm(4, 6), 0.0) +
             [Nokta(x.u_px, x.v_px, x.x_mm, x.y_mm, 30.0 + dh)
              for x in _nokta(kam, izgara_mm(4, 6), 30.0)])
        m = kur(n, kam.kare)
        print(f"{dh:7.0f} mm {dogrula(m, _nokta(kam, TEST, 0.0))['rms_mm']:11.3f}")

    bolum("5) Dört etiketle karşılaştırma (şimdiki yöntem)")
    dort = np.array([[60., 60.], [435., 60.], [435., 550.], [60., 550.]])
    try:
        kur(_nokta(kam, dort), kam.kare)
    except KalibrasyonHatasi as e:
        print("4 nokta ->", str(e).split("(")[0].strip())
    import cv2
    p4 = kam.px(dort); H, _ = cv2.findHomography(p4, dort, 0)
    t = cv2.perspectiveTransform(kam.px(TEST).reshape(-1, 1, 2), H).reshape(-1, 2)
    h4 = np.linalg.norm(t - TEST, axis=1)
    g4 = cv2.perspectiveTransform(p4.reshape(-1, 1, 2), H).reshape(-1, 2)
    print(f"4 etiket + yalın homografi:  etiketlerin üstünde artık "
          f"{np.linalg.norm(g4-dort, axis=1).max():.4f} mm  <- sıfır, yanıltıcı")
    print(f"                             bağımsız noktalarda GERÇEK hata "
          f"{h4.mean():.2f} mm ort / {h4.max():.2f} mm maks")
    sonuc["dort_etiket"] = round(float(h4.mean()), 2)

    bolum("KARAR")
    gecti, kaldi = [], []
    (gecti if sonuc.get("duzlem_3x4", 9) < 0.5 else kaldi).append("12 nokta < 0.5 mm")
    (gecti if sonuc.get("uzay_h30", 9) < 0.5 else kaldi).append("30 mm yaprak < 0.5 mm")
    (gecti if sonuc.get("dort_etiket", 0) > 1.0 else kaldi).append(
        "4 etiket belirgin kötü (beklenen)")
    for g in gecti:
        print("  GECTI ", g)
    for k in kaldi:
        print("  KALDI ", k)
    return 0 if not kaldi else 1


if __name__ == "__main__":
    raise SystemExit(main())
