"""
izgara_arac — elle ızgara tanımlama, denetleme ve doğrulama aracı.

    # 1) Yatağın dört köşesini tek hücre olarak tanımla
    python -m gorus.izgara_arac olustur kare.jpg \
        --hucre yatak \
          --piksel 480,300 3390,315 3510,1980 350,1965 \
          --mm 0,0 540,0 540,645 0,645 \
        --cikti gorus/veri/izgara.json

    # 2) Kuşbakışı önizleme + denetim
    python -m gorus.izgara_arac onizle kare.jpg --izgara gorus/veri/izgara.json

    # 3) GERÇEK doğruluk: aleti bilinen noktalara sürüp piksellerini ver
    python -m gorus.izgara_arac dogrula kare.jpg --izgara gorus/veri/izgara.json \
        --nokta 1200,900=180,240 --nokta 2600,1500=400,480

Köşe sırası: sol-üst, sağ-üst, sağ-alt, sol-alt. Piksel ve mm aynı sırada
olmalı. `--sirala` verirseniz piksel köşeleri otomatik bu sıraya sokulur.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import cv2

from .izgara import Hucre, Izgara, dikdortgen_izgara, kose_sirala


def _cift_ayristir(metin, n=4):
    out = []
    for p in metin:
        try:
            a, b = p.split(",")
            out.append([float(a), float(b)])
        except ValueError:
            raise SystemExit(f"Nokta biçimi hatalı: {p!r}  (örnek: 480,300)")
    if len(out) != n:
        raise SystemExit(f"{n} nokta gerekiyor, {len(out)} verildi")
    return out


def _hucreleri_topla(argv_hucre, sirala=False):
    """--hucre AD --piksel p1 p2 p3 p4 --mm m1 m2 m3 m4  (tekrarlanabilir)"""
    hucreler = []
    for ad, pik, mm in argv_hucre:
        p = _cift_ayristir(pik)
        if sirala:
            p = kose_sirala(p)
        hucreler.append(Hucre(ad, p, _cift_ayristir(mm)))
    return hucreler


class _HucreEylem(argparse.Action):
    """--hucre AD --piksel ... --mm ... üçlüsünü sırayla toplar."""

    def __call__(self, parser, ns, deger, option_string=None):
        if not hasattr(ns, "_hucreler"):
            ns._hucreler = []
        if option_string == "--hucre":
            ns._hucreler.append([deger, None, None])
        else:
            if not getattr(ns, "_hucreler", None):
                raise SystemExit("--piksel/--mm'den önce --hucre gelmeli")
            ns._hucreler[-1][1 if option_string == "--piksel" else 2] = deger


def _kare_oku(yol):
    bgr = cv2.imread(str(yol), cv2.IMREAD_COLOR)
    if bgr is None:
        raise SystemExit(f"Kare okunamadı: {yol}")
    return bgr


def komut_olustur(a):
    bgr = _kare_oku(a.kare)
    boy = (bgr.shape[1], bgr.shape[0])
    hucreler = _hucreleri_topla(getattr(a, "_hucreler", []), a.sirala)
    if not hucreler:
        raise SystemExit("En az bir --hucre tanımlayın")

    ig = Izgara(hucreler=hucreler, kare_boyu=boy,
                yatak_mm=tuple(float(v) for v in a.yatak.split(",")),
                aciklama=a.aciklama or "")
    if a.bol and len(hucreler) == 1:
        h = hucreler[0]
        satir, sutun = (int(v) for v in a.bol.split("x"))
        ig = dikdortgen_izgara(h.piksel, h.mm, satir, sutun)
        ig.kare_boyu, ig.yatak_mm = boy, tuple(float(v) for v in a.yatak.split(","))
        print(f"Dış dörtgen {satir}x{sutun} hücreye bölündü. DİKKAT: ara köşeler "
              "ÖLÇÜLMEDİ, dış dörtgenden türetildi — tek homografiden daha doğru "
              "değildir. Asıl kazanç, ara köşeleri elle düzelttiğinizde gelir.")

    yol = ig.kaydet(a.cikti)
    print(f"yazıldı  : {yol}")
    print(f"kare_boyu: {list(boy)}  ← köşe pikselleri bu çözünürlüğe ait")
    _denetim_yaz(ig)
    return 0


def _denetim_yaz(ig: Izgara):
    d = ig.denetim()
    print(f"\nhücre    : {d['hucre_sayisi']}")
    for ad, h in d["hucreler"].items():
        o = h["olcek_mm_px"]
        print(f"  {ad:<10} mm/px {min(o.values()):.3f}–{max(o.values()):.3f} "
              f"(oran {h['olcek_orani']}x)  alan {h['mm_alani']:.0f} mm²")
    print(f"yatak kapsama : %{d['yatak_kapsama_yuzde']}")
    if d["cakisan_hucreler"]:
        print(f"çakışan       : {d['cakisan_hucreler']}")
    for u in d["uyarilar"]:
        print(f"  UYARI: {u}")
    print(f"\n{d['not']}")


def komut_onizle(a):
    from .boru import kusbakisi_uret, ortho_gorsel
    bgr = _kare_oku(a.kare)
    ig = Izgara.yukle(a.izgara)
    _denetim_yaz(ig)
    ortho, bilgi = kusbakisi_uret(bgr, ig, px_mm=a.px_mm)
    print(f"\nkuşbakışı : {bilgi['boyut'][0]}x{bilgi['boyut'][1]} px @ "
          f"{bilgi['px_mm']} px/mm   dolu %{bilgi['dolu_oran']*100:.0f}")
    t = bilgi["olcek_tavani"]
    print(f"ölçek tavanı: {t.get('tavan_px_mm')} px/mm  "
          f"(en kaba köşe {t.get('en_kaba_mm_px')} mm/px)")
    if t.get("tavan_px_mm") and a.px_mm > t["tavan_px_mm"]:
        print("  UYARI: px_mm tavanın üstünde — warp yalnız büyütüyor, "
              "yeni ayrıntı gelmiyor.")
    img = ortho_gorsel(ortho, bilgi, izgara_hucreleri=ig)
    yol = Path(a.cikti or "kusbakisi.jpg")
    cv2.imwrite(str(yol), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"\ngörsel   : {yol}")
    print("\nBAKILACAK: 50 mm ızgara toprağa oturuyor mu? Hücre sınırlarında "
          "kopma/kayma var mı? Yatak kenarları düz mü? Eğriyse köşe pikselleri "
          "yanlış tıklanmış demektir.")
    return 0


def komut_dogrula(a):
    ig = Izgara.yukle(a.izgara)
    bgr = _kare_oku(a.kare)
    olcumler = []
    for n in a.nokta:
        try:
            sol, sag = n.split("=")
            px, py = (float(v) for v in sol.split(","))
            mx, my = (float(v) for v in sag.split(","))
        except ValueError:
            raise SystemExit(f"--nokta biçimi hatalı: {n!r}  "
                             "(örnek: 1200,900=180,240)")
        olcumler.append(((px, py), (mx, my)))
    r = ig.dogrulama(olcumler, (bgr.shape[1], bgr.shape[0]))
    if not r["yapilabildi"]:
        print(f"YAPILAMADI — {r['sebep']}")
        for d in r.get("detay", []):
            print(f"  {d}")
        return 1
    print(f"nokta     : {r['nokta_sayisi']}")
    print(f"RMS       : {r['rms_mm']} mm")
    print(f"ortalama  : {r['ortalama_mm']} mm   max {r['max_mm']} mm")
    for d in sorted(r["detay"], key=lambda x: -(x["hata_mm"] or 0)):
        if d["hata_mm"] is None:
            print(f"  #{d['no']}  {d['sebep']}")
        else:
            print(f"  #{d['no']} [{d['hucre']}] {d['hata_mm']:6.2f} mm   "
                  f"kestirilen {d['kestirilen_mm']} / gerçek {d['gercek_mm']}")
    print(f"\n{r['not']}")
    if r["rms_mm"] > 5:
        print("\n5 mm üstü. Sebepler: köşe pikselleri şaşmış, köşelerin mm "
              "karşılığı yanlış girilmiş, ya da tek hücre lens bozulmasını "
              "kaldıramıyor — hücreyi bölmeyi deneyin (--bol 2x2).")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m gorus.izgara_arac")
    alt = p.add_subparsers(dest="komut", required=True)

    o = alt.add_parser("olustur", help="ızgarayı tanımla ve kaydet")
    o.add_argument("kare")
    o.add_argument("--hucre", action=_HucreEylem, metavar="AD")
    o.add_argument("--piksel", nargs=4, action=_HucreEylem, metavar="X,Y")
    o.add_argument("--mm", nargs=4, action=_HucreEylem, metavar="X,Y")
    o.add_argument("--bol", metavar="SATIRxSUTUN", default=None)
    o.add_argument("--sirala", action="store_true",
                   help="piksel köşelerini sol-üst'ten saat yönüne sok")
    o.add_argument("--yatak", default="540,645")
    o.add_argument("--aciklama", default="")
    o.add_argument("--cikti", default="gorus/veri/izgara.json")
    o.set_defaults(fn=komut_olustur)

    n = alt.add_parser("onizle", help="kuşbakışı üret ve denetle")
    n.add_argument("kare")
    n.add_argument("--izgara", default="gorus/veri/izgara.json")
    n.add_argument("--px-mm", type=float, default=4.0, dest="px_mm")
    n.add_argument("--cikti", default=None)
    n.set_defaults(fn=komut_onizle)

    d = alt.add_parser("dogrula", help="bağımsız noktalarla gerçek doğruluk")
    d.add_argument("kare")
    d.add_argument("--izgara", default="gorus/veri/izgara.json")
    d.add_argument("--nokta", action="append", required=True,
                   metavar="PX,PY=MMX,MMY")
    d.set_defaults(fn=komut_dogrula)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    raise SystemExit(main())
