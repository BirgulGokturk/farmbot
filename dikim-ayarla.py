"""Dikim alanlarını ölçülen değerlere ayarlar.

    cd ~/farmbot && python3 dikim-ayarla.py

Neden betik: dikim alanları `sunucu/dikim_alanlari.json` içinde duruyor ve
o dosya makineye özel — depoya dahil değil, yani bir commit'le gelmiyor.
Panelden tek tek girmek yerine ölçülen değerleri tek komutla yazıyoruz.

Sahadan ölçülen (30.08.2026):
    Kap 1  X 235-495 · Y   0-275
    Kap 2  X 235-495 · Y 335-610      (Kap 1'in 6 cm ötesi)

Yüzey Z ikisinde de 170. Kap 1'in ölçümü Y0 ucunda 165, Y275 ucunda 170
çıkmıştı; alan tek değer aldığı için YÜKSEK olanı alıyoruz. Yüksek yüzey
varsaymak iniş Z'sini yukarıda tutuyor: hata yaparsak uç toprağın üstünde
kalır, içine girmez. Ters yanılmak daha pahalı.

Eski alanları siliyor. Panelden girdiğiniz başka bir alan varsa önce
`sunucu/dikim_alanlari.json` dosyasının bir kopyasını alın.
"""

import json
import os
import re
import shutil
import sys

KOK = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(KOK, "sunucu"))


def ortami_yukle() -> None:
    """`sunucu/ortam` içindeki VERI_YOLU'nu bu sürece de taşır.

    ŞART: sunucu systemd altında EnvironmentFile=sunucu/ortam ile
    çalışıyor ve dikim dosyasının yerini VERI_YOLU belirliyor. Betik düz
    kabuktan çalıştığında o değişken yok; ayarları yazar, sunucu başka bir
    dosyayı okur ve panelde hiçbir şey değişmez — sessiz ve kafa karıştırıcı.
    """
    yol = os.path.join(KOK, "sunucu", "ortam")
    if not os.path.exists(yol):
        return
    with open(yol, encoding="utf-8") as f:
        for satir in f:
            esles = re.match(r"^\s*([A-Z_]+)=(.*)$", satir)
            if not esles:
                continue
            ad, deger = esles.group(1), esles.group(2).strip()
            if deger.startswith('"'):
                try:
                    deger = json.loads(deger)
                except ValueError:
                    deger = deger.strip('"')
            # Kabukta zaten verilmişse ona dokunmuyoruz: elle yol vermek
            # (DIKIM_YOLU=... gibi) her zaman kazanmalı.
            os.environ.setdefault(ad, deger)


ortami_yukle()

ALANLAR = [
    {"ad": "kap 1", "x1": 235.0, "y1": 0.0,   "x2": 495.0, "y2": 275.0, "toprak_z": 170.0},
    {"ad": "kap 2", "x1": 235.0, "y1": 335.0, "x2": 495.0, "y2": 610.0, "toprak_z": 170.0},
]


def main() -> int:
    import dikim

    yol = dikim._yol()
    print(f"Yazılacak dosya: {yol}")
    if os.path.exists(yol):
        yedek = yol + ".yedek"
        shutil.copy2(yol, yedek)
        print(f"Eski dosya yedeklendi: {yedek}")
        try:
            with open(yol, encoding="utf-8") as f:
                eski = json.load(f).get("alanlar", [])
            for a in eski:
                print(f"  siliniyor: {a.get('ad')} "
                      f"X{a.get('x1')}-{a.get('x2')} Y{a.get('y1')}-{a.get('y2')}")
        except Exception:
            pass

    # `dikim.yaz` doğrulamadan geçmiyor; doğrulamayı kendimiz çağırıyoruz ki
    # geçersiz bir alan sessizce dosyaya girmesin.
    temiz = [dikim.alan_dogrula(a) for a in ALANLAR]
    dikim.yaz({"surum": 1, "alanlar": temiz})

    print()
    for a in dikim.listele():
        en = a["x2"] - a["x1"]
        boy = a["y2"] - a["y1"]
        print(f"  {a['ad']}: X{a['x1']:.0f}-{a['x2']:.0f} · Y{a['y1']:.0f}-{a['y2']:.0f}"
              f" · yüzey Z{a.get('toprak_z')}  ({en:.0f} × {boy:.0f} mm)")
    print()
    print("Yazıldı. Panelde Ctrl+F5 yapın; sunucuyu yeniden başlatmak gerekmiyor.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
