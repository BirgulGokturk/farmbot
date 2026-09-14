"""Komut satırı.

    python3 -m izgara.cli plan    --nx 4 --ny 6 --z 0 30 -o plan.json
    python3 -m izgara.cli kur     noktalar.json --kare 2160 3840 -o model.json
    python3 -m izgara.cli dogrula model.json kontrol.json
    python3 -m izgara.cli kopru   model.json --h 0
    python3 -m izgara.cli sorgu   model.json --px 1040 1810 --h 20
    python3 -m izgara.cli test
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from .model import Model, Nokta, kur, dogrula, capraz_dogrula


def _oku(yol) -> list[Nokta]:
    return [Nokta(**d) for d in json.loads(Path(yol).read_text(encoding="utf-8"))]


def _yaz(o, yol=None):
    m = json.dumps(o, ensure_ascii=False, indent=2)
    if yol:
        Path(yol).write_text(m, encoding="utf-8")
        print(f"yazıldı: {yol}")
    print(m)


def k_plan(a):
    from .tur import tur_planla
    p = tur_planla(yatak_mm=tuple(a.yatak), nx=a.nx, ny=a.ny,
                   pay_mm=a.pay, z_listesi=a.z)
    _yaz([{"x_mm": x, "y_mm": y, "z_mm": z} for x, y, z in p], a.cikti)
    print(f"\n{len(p)} durak, {len(set(a.z))} yükseklik.")
    if len(set(a.z)) < 2:
        print("UYARI: tek yükseklik -> paralaks çözülmez ('duzlem' modeli).")
    return 0


def k_kur(a):
    n = _oku(a.noktalar)
    m = kur(n, tuple(a.kare), zorla=a.zorla)
    m.rapor["capraz_dogrulama"] = capraz_dogrula(n, tuple(a.kare), a.kat, a.zorla)
    if a.cikti:
        m.kaydet(a.cikti)
        print(f"model yazıldı: {a.cikti}")
    _yaz(m.rapor)
    return 0


def k_dogrula(a):
    _yaz(dogrula(Model.yukle(a.model), _oku(a.kontrol)))
    return 0


def k_kopru(a):
    from .baglayici import harita_uret
    u = harita_uret(Model.yukle(a.model), a.h)
    _yaz(u, a.cikti)
    print("\nharita/mm_px/genislik_px/yukseklik_px alanlarını mevcut "
          "kalibrasyon kaydına yazabilirsiniz; kopru_kaybi yazılmaz.")
    return 0


def k_sorgu(a):
    m = Model.yukle(a.model)
    if a.px:
        px = [[a.px[0], a.px[1]]]
        mm = m.px2mm(px, a.h if m.tur == "uzay" else None)[0]
        ic = bool(m.kalibre_bolgede_mi(px)[0])
        print(f"piksel {a.px} @ h={a.h} mm  ->  X {mm[0]:.2f}  Y {mm[1]:.2f} mm")
        print(f"yerel ölçek {float(m.yerel_mm_px(px, a.h if m.tur=='uzay' else 0.0)[0]):.4f} mm/px")
        if not ic:
            print("UYARI: bu piksel kalibre edilen bölgenin DIŞINDA — "
                  "sonuç uzatmadır, hatası ölçülmedi.")
    if a.mm:
        px = m.mm2px([[a.mm[0], a.mm[1]]], a.h if m.tur == "uzay" else 0.0)[0]
        print(f"mm {a.mm} @ h={a.h}  ->  piksel {px[0]:.1f}, {px[1]:.1f}")
    return 0


def k_test(a):
    from .testler.test_model import main as m1
    from .testler.test_tur import main as m2
    return (m1() or 0) + (m2() or 0)


def main(argv=None) -> int:
    p = argparse.ArgumentParser("izgara")
    alt = p.add_subparsers(dest="komut", required=True)

    s = alt.add_parser("plan", help="kalibrasyon turu planı üret")
    s.add_argument("--yatak", nargs=2, type=float, default=[495.0, 610.0])
    s.add_argument("--nx", type=int, default=4)
    s.add_argument("--ny", type=int, default=6)
    s.add_argument("--pay", type=float, default=40.0)
    s.add_argument("--z", nargs="+", type=float, default=[0.0, 30.0])
    s.add_argument("-o", "--cikti")
    s.set_defaults(fn=k_plan)

    s = alt.add_parser("kur", help="noktalardan model kur")
    s.add_argument("noktalar")
    s.add_argument("--kare", nargs=2, type=int, required=True)
    s.add_argument("--zorla", choices=["duzlem", "uzay"], default=None)
    s.add_argument("--kat", type=int, default=5)
    s.add_argument("-o", "--cikti")
    s.set_defaults(fn=k_kur)

    s = alt.add_parser("dogrula", help="bağımsız noktalarla doğruluk ölç")
    s.add_argument("model"); s.add_argument("kontrol")
    s.set_defaults(fn=k_dogrula)

    s = alt.add_parser("kopru", help="mevcut kalibrasyon.py biçimine çevir")
    s.add_argument("model"); s.add_argument("--h", type=float, default=0.0)
    s.add_argument("-o", "--cikti")
    s.set_defaults(fn=k_kopru)

    s = alt.add_parser("sorgu", help="tek nokta çevir")
    s.add_argument("model")
    s.add_argument("--px", nargs=2, type=float)
    s.add_argument("--mm", nargs=2, type=float)
    s.add_argument("--h", type=float, default=0.0)
    s.set_defaults(fn=k_sorgu)

    s = alt.add_parser("test", help="benzetimle ölçüm")
    s.set_defaults(fn=k_test)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    raise SystemExit(main())
