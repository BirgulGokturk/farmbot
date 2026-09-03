#!/usr/bin/env python3
"""Satranç tahtasıyla lens kalibrasyonu — terminalden.

NEDEN TERMİNAL. Kalibrasyon, tahtayı elde tutup kameranın önünde
gezdirmeyi gerektiriyor: bir elde tahta, diğer elde fare istemiyor.
Burada tek tuş yetiyor ve sonuç aynı satırda görünüyor — kabul mü, ret
mi, sebebi ne, hangi bölge hâlâ boş.

PANELLE AYNI YOLU KULLANIYOR. Kendi başına kamera açmıyor; sunucunun
`/api/kamera/tahta/*` uçlarına gidiyor. İki gerekçe:

  * Kamerayı ajan zaten açık tutuyor. Bir USB kamerayı aynı anda tek
    program açabiliyor; buradan ayrıca açmaya kalkmak "device busy"
    demek ve canlı akışı da düşürüyor.
  * Eleme kuralları (bulanıklık, tahta bulunamadı, çok küçük) tek yerde
    kalıyor. İki ayrı yerde olsaydı biri "kabul" derken diğeri
    "ret" der ve hangisinin doğru olduğu bilinmezdi.

KULLANIM

    python3 tahta-kalibre.py                      # üst kamera, 9x6, 25 mm
    python3 tahta-kalibre.py --kamera uc
    python3 tahta-kalibre.py --kose 9x6 --mm 25

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

BOLGE = ["sol üst", "üst orta", "sağ üst",
         "sol orta", "orta", "sağ orta",
         "sol alt", "alt orta", "sağ alt"]


def istek(adres: str, yol: str, jeton: str, govde=None, yontem="POST"):
    tam = f"{adres}{yol}{'&' if '?' in yol else '?'}jeton={urllib.parse.quote(jeton)}"
    veri = json.dumps(govde).encode() if govde is not None else None
    ist = urllib.request.Request(tam, data=veri, method=yontem,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(ist, timeout=30) as yanit:
            return json.loads(yanit.read().decode() or "{}"), None
    except urllib.error.HTTPError as hata:
        try:
            ayrinti = json.loads(hata.read().decode()).get("detail")
        except Exception:
            ayrinti = hata.reason
        return None, str(ayrinti)
    except urllib.error.URLError as hata:
        return None, f"Sunucuya ulaşılamadı: {hata.reason}"


def kapsama_yaz(kapsanan: list[int]) -> None:
    """3x3 ızgarayı terminale çiziyor — hangi bölge boş, gözle görünsün."""
    dolu = set(kapsanan or [])
    print()
    for satir in range(3):
        print("   " + " ".join("██" if satir * 3 + s in dolu else "··"
                               for s in range(3)))
    bos = [BOLGE[i] for i in range(9) if i not in dolu]
    if bos:
        print(f"   boş: {', '.join(bos)}")
    else:
        print("   bütün bölgeler kapsandı")
    print()


def main() -> int:
    ayr = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ayr.add_argument("--adres", default="http://localhost:8000")
    ayr.add_argument("--kamera", default="ust")
    ayr.add_argument("--kose", default="9x6",
                     help="iç köşe sayısı (kare değil kesişim): 9x6")
    ayr.add_argument("--mm", type=float, default=25.0, help="kare ölçüsü (mm)")
    a = ayr.parse_args()

    try:
        kx, ky = (int(p) for p in a.kose.lower().split("x", 1))
    except ValueError:
        print(f"HATA: --kose 'GENİŞLİKxYÜKSEKLİK' olmalı (verilen: {a.kose})")
        return 2

    jeton = os.environ.get("PANEL_PAROLA")
    if jeton is None:
        try:
            import getpass
            jeton = getpass.getpass("Panel parolası (yoksa boş geçin): ")
        except (EOFError, KeyboardInterrupt):
            return 130

    temel = {"kamera": a.kamera, "ic_kose_x": kx, "ic_kose_y": ky, "kare_mm": a.mm}

    print(f"\nKamera: {a.kamera} · iç köşe {kx}x{ky} · kare {a.mm:g} mm")
    print("Tahtayı kameraya gösterin ve ENTER'a basın. Bitince 'h' + ENTER.")
    print("Diğer tuşlar: 't' baştan başla · 'q' çık\n")

    # Var olan toplama varsa üstüne eklemek yerine kullanıcıya söylüyoruz:
    # yarım kalmış bir toplama, arada çözünürlük değişmişse sessizce
    # yanlış sonuç demek.
    d, hata = istek(a.adres, f"/api/kamera/tahta/durum?kamera={a.kamera}",
                    jeton, yontem="GET")
    if hata:
        print(f"HATA: {hata}")
        return 1
    varolan = (d.get("toplama") or {}).get("kare_sayisi") or 0
    if varolan:
        print(f"NOT: bu kamerada zaten {varolan} kare toplanmış. Üstüne "
              "ekleniyor; baştan başlamak için 't'.\n")

    while True:
        try:
            girdi = input("kare > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return 130

        if girdi == "q":
            return 0

        if girdi == "t":
            _, hata = istek(a.adres, "/api/kamera/tahta/temizle", jeton,
                            {"kamera": a.kamera})
            print("HATA: " + hata if hata else "Toplama temizlendi.\n")
            continue

        if girdi == "h":
            print("\nHesaplanıyor…")
            y, hata = istek(a.adres, "/api/kamera/tahta/hesapla", jeton,
                            {**temel, "kaydet": True})
            if hata:
                print(f"HATA: {hata}\n")
                continue
            s = y["sonuc"]
            yorum = ("iyi" if s["rms"] <= 0.5
                     else "kabul edilebilir" if s["rms"] <= 1.0
                     else "YÜKSEK — kareleri gözden geçirin")
            print(f"  ölçüm hatası : {s['rms']} piksel · {yorum}")
            print(f"  kare         : {s['kare_sayisi']}")
            print(f"  çözünürlük   : {s['boyut'][0]}x{s['boyut'][1]}")
            print(f"  uzaklık      : {s['uzaklik_ortanca_mm']} mm "
                  f"({s['uzaklik_en_az_mm']}–{s['uzaklik_en_cok_mm']})")
            print(f"  bozulma      : "
                  + " · ".join(f"{x:.4f}" for x in s["bozulma"][:3]))
            print(f"  duruş çeşit. : {s.get('uzaklik_yayilim_mm', '?')} mm")
            # DÜŞÜK HATA TEK BAŞINA YETMİYOR: bütün kareler aynı duruştaysa
            # çözüm o tek kareyi kusursuz eşliyor ve hata küçücük çıkıyor.
            if s.get("uyari"):
                print(f"\n  ! {s['uyari']}")
            print("\n  KAYDEDİLDİ\n")
            print("  Not: bu kalibrasyon yalnız "
                  f"{s['boyut'][0]}x{s['boyut'][1]} çözünürlüğünde geçerli.\n")
            return 0

        y, hata = istek(a.adres, "/api/kamera/tahta/kare", jeton, temel)
        if hata:
            print(f"  ✕ {hata}")
            continue
        print(f"  ✓ {y['kare_sayisi']}. kare · {BOLGE[y['hucre']]} · "
              f"netlik {y['netlik']} · karenin %{y['alan_yuzde']}'i")
        kapsama_yaz(y.get("kapsanan"))


if __name__ == "__main__":
    sys.exit(main())
