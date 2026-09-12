"""
ortu — yaprak alanı ve yatak kapsama ölçümleri.  [madde 7]

Sulama ve hasat kararlarına sayı üretir. Hesaplanamayan hiçbir alan
uydurulmaz: alan bilgisi gelmeyen tespit "alani_bilinmeyen" sayısına düşer
ve toplamlar o tespitler HARİÇ verilir, sebebi raporda yazar.

Kapsama yüzdesi iki şekilde hesaplanabilir:
  * tespitlerin alan toplamı / yatak alanı  (varsayılan)
  * filiz.py maske pikseli veriyorsa doğrudan o  (daha doğru; üst üste binen
    yapraklar iki kez sayılmaz)
İkincisi mevcutsa tercih edilir.
"""

from __future__ import annotations


def olc(tespitler, yatak_mm=(540.0, 645.0), maske_alani_mm2=None,
        kararlar=None) -> dict:
    yatak_alani = float(yatak_mm[0]) * float(yatak_mm[1])

    alanli = [t for t in tespitler if t.alan_mm2 is not None]
    alansiz = len(tespitler) - len(alanli)
    toplam = sum(t.alan_mm2 for t in alanli)

    if maske_alani_mm2 is not None:
        kapsama_mm2 = float(maske_alani_mm2)
        kaynak = "maske (ust uste binme sayilmaz)"
    elif alanli:
        kapsama_mm2 = toplam
        kaynak = "tespit alanlari toplami"
    else:
        kapsama_mm2 = None
        kaynak = None

    # sınıfa göre ayrıştır — yabani örtüsü ayrı bir işletme göstergesi
    sinif_ix = {k["tespit_id"]: k["sinif"] for k in (kararlar or [])}
    sinif_alan = {}
    for t in alanli:
        s = sinif_ix.get(t.id, "bilinmiyor")
        sinif_alan[s] = sinif_alan.get(s, 0.0) + t.alan_mm2

    filizler = [t for t in alanli if sinif_ix.get(t.id) == "filiz"]
    return {
        "yatak_alani_mm2": round(yatak_alani, 1),
        "kapsama_mm2": round(kapsama_mm2, 1) if kapsama_mm2 is not None else None,
        "kapsama_yuzde": (round(100.0 * kapsama_mm2 / yatak_alani, 2)
                          if kapsama_mm2 is not None else None),
        "kapsama_kaynagi": kaynak,
        "sinifa_gore_alan_mm2": {k: round(v, 1) for k, v in sorted(sinif_alan.items())},
        "filiz_basina": ({
            "adet": len(filizler),
            "ortalama_yaprak_alani_mm2": round(sum(t.alan_mm2 for t in filizler) / len(filizler), 1),
            "en_kucuk_mm2": round(min(t.alan_mm2 for t in filizler), 1),
            "en_buyuk_mm2": round(max(t.alan_mm2 for t in filizler), 1),
        } if filizler else None),
        "alani_bilinmeyen": alansiz,
        "not": (None if not alansiz else
                f"{alansiz} tespitin alanı gelmedi; toplamlar onlar HARİÇ. "
                "filiz.py alan döndürmüyorsa bu sayı tespit sayısına eşit olur."),
    }
