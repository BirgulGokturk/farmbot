#!/usr/bin/env python3
"""Kamerayı makinenin kendi hassasiyetiyle kalibre eder.

Kafanın üstüne bir AprilTag yapıştırılıyor. Makine yatakta bir ızgarayı
geziyor, her durakta bir kare alınıyor ve işaretin görüntüde nereye
düştüğü ölçülüyor. Makinenin nereye gittiği zaten milimetresi
milimetresine biliniyor; ikisinden "bu piksel şu milimetre" haritası
çıkıyor.

NEDEN SATRANÇ TAHTASINDAN İYİ. Tahtayı kadranın köşelerine, yakına
uzağa, eğik düz götürmek gerekiyordu; yukarıya sabitlenmiş bir kamerada
bunu elle yapmak neredeyse imkânsız. Burada hareketi MAKİNE yapıyor.

EĞİK BAKAN KAMERAYI DA ÇÖZÜYOR. Dört noktadan sonra perspektif de
hesaba giriyor. Ölçüm iki modele birden uyduruluyor ve ikisinin hatası
da yazılıyor: aradaki fark, kameranın ne kadar eğik baktığını söylüyor.

HARİTA TEK DÜZLEMDE GEÇERLİ: işaretin bulunduğu yükseklikte. `--z` ile
toprak yüzeyine yakın bir yükseklik verin; ekim ve sulama orada oluyor.

KULLANIM

    python3 kamera-otokalibre.py --etiket 7
    python3 kamera-otokalibre.py --etiket 7 --z 380 --izgara 4x4
    python3 kamera-otokalibre.py --etiket 7 --alan 80,80,460,560

Parola: `PANEL_PAROLA` ortam değişkeninden okunuyor; yoksa soruyor.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def istek(adres, yol, jeton, govde=None, yontem="POST"):
    tam = f"{adres}{yol}{'&' if '?' in yol else '?'}jeton={urllib.parse.quote(jeton)}"
    veri = json.dumps(govde).encode() if govde is not None else None
    ist = urllib.request.Request(tam, data=veri, method=yontem,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(ist, timeout=120) as yanit:
            return json.loads(yanit.read().decode() or "{}"), None
    except urllib.error.HTTPError as hata:
        try:
            ayrinti = json.loads(hata.read().decode()).get("detail")
        except Exception:
            ayrinti = hata.reason
        return None, str(ayrinti)
    except urllib.error.URLError as hata:
        return None, f"Sunucuya ulaşılamadı: {hata.reason}"


def izgara(alan, nx, ny):
    x0, y0, x1, y1 = alan
    xs = [x0] if nx < 2 else [x0 + (x1 - x0) * i / (nx - 1) for i in range(nx)]
    ys = [y0] if ny < 2 else [y0 + (y1 - y0) * i / (ny - 1) for i in range(ny)]
    # Yılan sırası: satır sonunda yandaki noktaya geçiyor, baştan başlamıyor.
    # Boşuna kat edilen yol, boşuna geçen zaman.
    noktalar = []
    for j, y in enumerate(ys):
        sira = xs if j % 2 == 0 else list(reversed(xs))
        noktalar += [(x, y) for x in sira]
    return noktalar


def main() -> int:
    a = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--adres", default="http://localhost:8000")
    a.add_argument("--kamera", default="ust")
    a.add_argument("--etiket", type=int, required=True,
                   help="kafadaki AprilTag'in kimligi")
    a.add_argument("--z", type=float, default=None,
                   help="olcum yuksekligi (bos: Z'ye dokunmaz)")
    a.add_argument("--alan", default="80,80,460,560",
                   help="x0,y0,x1,y1 — olcum yapilacak dikdortgen")
    a.add_argument("--izgara", default="3x3")
    a.add_argument("--temizle", action="store_true",
                   help="once eski olcumleri sil")
    p = a.parse_args()

    try:
        alan = tuple(float(v) for v in p.alan.split(","))
        if len(alan) != 4:
            raise ValueError
        nx, ny = (int(v) for v in p.izgara.lower().split("x", 1))
    except ValueError:
        print("HATA: --alan 'x0,y0,x1,y1' ve --izgara 'NxM' olmalı")
        return 2

    jeton = os.environ.get("PANEL_PAROLA")
    if jeton is None:
        import getpass
        try:
            jeton = getpass.getpass("Panel parolası (yoksa boş geçin): ")
        except (EOFError, KeyboardInterrupt):
            return 130

    noktalar = izgara(alan, nx, ny)
    print(f"\nKamera: {p.kamera} · işaret: {p.etiket} · {nx}x{ny} = "
          f"{len(noktalar)} nokta")
    print(f"Alan: X {alan[0]:g}–{alan[2]:g} · Y {alan[1]:g}–{alan[3]:g}"
          + (f" · Z {p.z:g}" if p.z is not None else " · Z'ye dokunulmuyor"))
    print("\nMAKİNE HAREKET EDECEK. Yatağın üstü boş olsun, kafanın yolunda")
    print("bir şey bulunmasın. Kamera sekmesi açık ve canlı akış çalışıyor olmalı.")
    try:
        if input("\nBaşlatmak için ENTER (iptal için q): ").strip().lower() == "q":
            return 0
    except (EOFError, KeyboardInterrupt):
        return 130

    if p.temizle:
        istek(p.adres, "/api/kamera/otokalib/temizle", jeton, {"kamera": p.kamera})
        print("Eski ölçümler silindi.")

    basarili = 0
    for i, (x, y) in enumerate(noktalar, 1):
        govde = {"kamera": p.kamera, "x": round(x, 1), "y": round(y, 1),
                 "etiket": p.etiket}
        if p.z is not None:
            govde["z"] = p.z
        print(f"  {i}/{len(noktalar)} · X{x:.0f} Y{y:.0f} … ", end="", flush=True)
        y_, hata = istek(p.adres, "/api/kamera/otokalib/nokta", jeton, govde)
        if hata:
            # TEK NOKTA BAŞARISIZSA DURMUYORUZ: kalan noktalar hâlâ işe
            # yarıyor ve dokuz noktanın sekizi yeter. Sebebi yazıp geçiyoruz.
            print(f"✕ {hata}")
            continue
        basarili += 1
        print(f"✓ piksel {y_['px'][0]:.0f},{y_['px'][1]:.0f}")

    print(f"\n{basarili}/{len(noktalar)} nokta ölçüldü. Hesaplanıyor…\n")
    y_, hata = istek(p.adres, "/api/kamera/otokalib/hesapla", jeton,
                     {"kamera": p.kamera, "kaydet": True})
    if hata:
        print(f"HATA: {hata}")
        return 1

    s = y_["sonuc"]
    print(f"  ölçek        : {s['mm_px']:.4f} mm/piksel")
    print(f"  dönme        : {s['donme']:.2f}°")
    print(f"  yansıma      : {'var' if s['ayna_y'] else 'yok'}")
    print(f"  nokta        : {s['nokta_sayisi']} · yayılım {s['yayilim_mm']} mm")
    print()
    print(f"  hata (ölçek+dönme)   : {s['benzerlik_artik_mm']} mm")
    print(f"  hata (perspektifli)  : {s['projektif_artik_mm']} mm")
    fark = (s["benzerlik_artik_mm"] or 0) - (s["projektif_artik_mm"] or 0)
    if fark > 2.0:
        print(f"\n  Aradaki {fark:.1f} mm, kameranın EĞİK baktığından geliyor.")
        print("  Perspektifli harita bunu düzeltiyor.")
    if s.get("uyari"):
        print(f"\n  ! {s['uyari']}")
    print("\n  KAYDEDİLDİ\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
