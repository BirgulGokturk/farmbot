"""
tara — sunucuya hiç dokunmadan, tek bir kare üstünde tarama denemesi.

Kalibrasyonu kurduktan sonraki ilk gerçek sınav budur. Sunucu, ajan, panel
gerekmez; elinizdeki JPEG yeter.

    python -m gorus.tara kare.jpg --kalibrasyon gorus/veri/kalibrasyon.json \
        --kayit 120,200 --kayit 300,200 --kayit 120,450

Ekim kaydını dosyadan da verebilirsiniz (liste ya da {id: kayıt} sözlüğü;
alan adları api.py'deki sezgiyle aynı):

    python -m gorus.tara kare.jpg --kayit-json bitkiler.json

Ekim kaydı hiç vermezseniz konum kanıtı devre dışı kalır ve her şey
"belirsiz"e düşer — bu beklenen davranıştır, hata değil.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2

from . import cizim
from .ayarlar import Ayarlar
from .boru import Tarama
from .duzlem import Duzlem
from .eslestir import EkimKaydi


def _kayitlari_oku(kayit_listesi, kayit_json):
    kayitlar = []
    for i, k in enumerate(kayit_listesi or []):
        try:
            x, y = (float(v) for v in k.split(","))
        except ValueError:
            raise SystemExit(f"--kayit biçimi hatalı: {k!r}  (örnek: 120,200)")
        kayitlar.append(EkimKaydi(id=i, x_mm=x, y_mm=y))
    if kayit_json:
        from .api import _kayitlara_cevir
        ham = json.loads(Path(kayit_json).read_text("utf-8"))
        kayitlar += _kayitlara_cevir(ham)
    return kayitlar


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m gorus.tara")
    p.add_argument("kare")
    p.add_argument("--kalibrasyon", default="gorus/veri/kalibrasyon.json")
    p.add_argument("--kayit", action="append", metavar="X,Y")
    p.add_argument("--kayit-json", default=None)
    p.add_argument("--genislik", type=int, default=None,
                   help="işleme genişliği (varsayılan ayarlardaki 1920)")
    p.add_argument("--cikti-dizin", default=".")
    p.add_argument("--json", action="store_true", help="ham sonucu da yaz")
    a = p.parse_args(argv)

    ayar = Ayarlar.yukle()
    ayar.kalibrasyon_yolu = a.kalibrasyon
    if a.genislik:
        ayar.kare.isleme_genisligi = a.genislik
    try:
        D = Duzlem.yukle(a.kalibrasyon)
    except FileNotFoundError:
        raise SystemExit(f"Kalibrasyon yok: {a.kalibrasyon}\n"
                         "Önce: python -m gorus.kalibre ...")

    kayitlar = _kayitlari_oku(a.kayit, a.kayit_json)
    t = Tarama(ayar, D)
    s = t.calistir(a.kare, kayitlar=kayitlar, izler=[])

    kal = s["tani"]["kalibrasyon"]
    print(f"kare        : {a.kare}  ->  {s['kare_boyu'][0]}x{s['kare_boyu'][1]} "
          f"(ham {s['ham_kare_boyu'][0]}x{s['ham_kare_boyu'][1]})")
    print(f"kalibrasyon : {'GEÇERLİ' if s['gecerli'] else 'GEÇERSİZ'}   "
          f"artık {kal.get('artik_rms_mm')} mm   "
          f"etiket {kal.get('bulunan_sayi')}/{len(ayar.gerekli_etiketler)}")
    if not s["gecerli"]:
        print(f"  SEBEP: {s['gecersizlik_sebebi']}")
        print("  Koordinat yayımlanmadı. Kamera oynamış ya da etiket kapalı.")
    print(f"bölütleme   : eşik {s['tani']['bolutleme']['esik_exgr']} "
          f"({s['tani']['bolutleme']['esik_kaynagi']})  "
          f"yeşil oran {s['tani']['bolutleme']['yesil_oran_morfoloji_sonrasi']}")
    if s["tani"]["bolutleme"].get("uyari"):
        print(f"  UYARI: {s['tani']['bolutleme']['uyari']}")
    print(f"nesne       : {s['tani']['nesne']['nesne_sayisi']} "
          f"(elenen: {s['tani']['nesne']['elenen']})")
    print(f"eşleştirme  : {s['tani']['eslestirme']}")
    print(f"sayım       : {s['sayim']}   eşleşmeyen kayıt: {s['bos_kayitlar']}")
    print(f"süre ms     : {s['sureler_ms']}  toplam {sum(s['sureler_ms'].values()):.0f}")

    print(f"\n{'#':>3} {'sınıf':<9} {'skor':>5} {'X mm':>7} {'Y mm':>7} "
          f"{'alan':>8} {'çap':>6} {'kayıt':>6}")
    for d in s["tespitler"]:
        tb = d["taban_mm"] or (float("nan"), float("nan"))
        print(f"{d['id']:>3} {d['sinif']:<9} {d['skor']:>5.2f} "
              f"{tb[0]:>7.1f} {tb[1]:>7.1f} "
              f"{(d['alan_mm2'] or 0):>7.1f}² {(d['cap_mm'] or 0):>5.1f} "
              f"{str(d['kayit_id']):>6}")

    diz = Path(a.cikti_dizin); diz.mkdir(parents=True, exist_ok=True)
    g = diz / (Path(a.kare).stem + ".gorsel.jpg")
    t.gorsel_kaydet(s, g)
    bgr = cv2.imread(a.kare, cv2.IMREAD_COLOR)
    o = min(ayar.kare.isleme_genisligi / bgr.shape[1], 1.0)
    kucuk = cv2.resize(bgr, (int(bgr.shape[1] * o), int(bgr.shape[0] * o)),
                       interpolation=cv2.INTER_AREA)
    Dp = t._duzlem((kucuk.shape[1], kucuk.shape[0]))
    ortho, mmf = cizim.ustten_gorunum(kucuk, Dp, px_mm=2.0)
    ortho = cizim.ustten_tespitler(ortho, mmf, s["_nesneler"], s["_kararlar"],
                                   px_mm=2.0, yatak_mm=Dp.yatak_mm)
    u = diz / (Path(a.kare).stem + ".ustten.jpg")
    cv2.imwrite(str(u), ortho, [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(f"\ngörseller   : {g}\n              {u}")

    if a.json:
        for k in ("gorsel", "_nesneler", "_kararlar"):
            s.pop(k, None)
        j = diz / (Path(a.kare).stem + ".sonuc.json")
        j.write_text(json.dumps(s, ensure_ascii=False, indent=2, default=str), "utf-8")
        print(f"              {j}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
