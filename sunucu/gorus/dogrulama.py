"""dogrulama — kalibrasyonun GERÇEK doğruluğu (birini-dışarıda-bırak)."""
from __future__ import annotations
import argparse, sys
import numpy as np, cv2
from . import etiket
from .duzlem import Duzlem


def capraz_dogrulama(ciftler: dict, kare_boyu, yatak_mm) -> dict:
    idler = list(ciftler)
    if len(idler) < 5:
        return {"yapilabildi": False, "etiket_sayisi": len(idler),
                "sebep": (f"{len(idler)} etiket var. 4 noktayla homografi tam "
                          "belirlenir, artık zorunlu olarak 0 çıkar — bu bir "
                          "doğruluk ölçüsü değildir. En az 5, tercihen 6 koyun.")}
    hatalar = {}
    for disarida in idler:
        kalan = {k: v for k, v in ciftler.items() if k != disarida}
        D = Duzlem.etiketlerden(kalan, kare_boyu, yatak_mm)
        pik, gercek = ciftler[disarida]
        kestirim = D.piksel_to_mm([pik])[0]
        hatalar[disarida] = float(np.linalg.norm(
            kestirim - np.asarray(gercek, np.float64)))
    d = np.array(list(hatalar.values()))
    return {"yapilabildi": True, "etiket_sayisi": len(idler),
            "etiket_basina_mm": {str(k): round(v, 2) for k, v in hatalar.items()},
            "rms_mm": round(float(np.sqrt(np.mean(d ** 2))), 3),
            "max_mm": round(float(d.max()), 3)}


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m gorus.dogrulama")
    p.add_argument("kare")
    p.add_argument("--etiket", action="append", required=True, metavar="ID=X,Y")
    p.add_argument("--yatak", default="540,645", metavar="W,H")
    a = p.parse_args(argv)

    etiket_mm = {}
    for d in a.etiket:
        kimlik, koord = d.split("=", 1)
        x, y = koord.split(",")
        etiket_mm[int(kimlik)] = (float(x), float(y))
    yatak = tuple(float(v) for v in a.yatak.split(","))

    bgr = cv2.imread(a.kare, cv2.IMREAD_COLOR)
    if bgr is None:
        sys.exit(f"Kare okunamadı: {a.kare}")
    boy = (bgr.shape[1], bgr.shape[0])
    b = etiket.bul(bgr, list(etiket_mm))
    print(f"kare      : {boy[0]}x{boy[1]}")
    print(f"bulunan   : {b['tani']['bulunan_idler']}  "
          f"(en küçük kenar {b['tani']['en_kucuk_kenar_px']} px)")
    if b["eksik"]:
        sys.exit(f"EKSİK etiket: {b['eksik']}")

    ciftler = {i: (b["etiketler"][i]["merkez"], etiket_mm[i]) for i in etiket_mm}
    D = Duzlem.etiketlerden(ciftler, boy, yatak)
    oz = D.oz_denetim()
    print(f"\nuyum artığı (ALDATICI): {oz['artik_rms_mm']:.3f} mm")
    if len(ciftler) <= 4:
        print("  ^ 4 etikette bu sayı zorunlu olarak ~0'dır.")

    cd = capraz_dogrulama(ciftler, boy, yatak)
    print("\nGERÇEK DOĞRULUK (birini dışarıda bırak):")
    if not cd["yapilabildi"]:
        print(f"  YAPILAMADI — {cd['sebep']}")
        return 1
    print(f"  RMS {cd['rms_mm']} mm   max {cd['max_mm']} mm")
    for k, v in sorted(cd["etiket_basina_mm"].items(), key=lambda x: -x[1]):
        print(f"    etiket {k:>2} dışarıda -> {v:6.2f} mm şaşma")
    en_kotu = max(cd["etiket_basina_mm"], key=lambda k: cd["etiket_basina_mm"][k])
    if cd["rms_mm"] > 3.0:
        print(f"\n  UYARI: 3 mm'nin üstünde. En şüpheli etiket: {en_kotu}")
        print("    · toprak düzleminde mi, kâğıt kabarmış mı?")
        print("    · prob ölçümü doğru girilmiş mi (merkez, köşe değil)?")
        print("    · etiketler kadraja yayılmış mı, üçü bir hizada mı?")
    print(f"\n  ölçek: {D.olcek_ozeti()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
