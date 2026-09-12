"""
tarama — ölçüm katmanının tek giriş noktası.  [2,3,4,5,6,7 birlikte]

    filiz.py tespitleri  ─┐
    bitki.veri() kaydı   ─┼─►  Tarama.calistir()  ─►  sonuç + görsel + arşiv
    önceki izler (depo)  ─┘

Bu katman KENDİ TESPİTİNİ YAPMAZ; segmentasyon ve piksel→mm sunucudadır.
Yaptığı: eşleştirme → izleme → sınıflandırma → örtü ölçümü → görsel → kayıt.

Kullanım (ör. zamanli.py'den ya da bir uçtan):

    from gorus.tarama import Tarama
    t = Tarama(db_yolu="/home/batupi/farmbot/veri/olcum.sqlite")
    sonuc = t.calistir(
        ham_tespitler = filiz.bul(...),        # filiz.py çıktısı
        ham_kayitlar  = bitki.veri(),          # ekim kaydı
        kare          = bgr_veya_yol,          # görsel istiyorsanız
        harita        = cizim.harita_kur(H=H), # kalibrasyondan
    )
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

from . import cizim as _cizim
from . import ortu as _ortu
from . import siniflandir as _sinif
from .depo import Depo
from .eslestir import EslestirmeAyari, esle, kayitlara_cevir, cimlenme_raporu
from .girdi import eksik_alanlar, tespitlere_cevir
from .izle import guncelle


class Tarama:
    def __init__(self, db_yolu=None, yatak_mm=(540.0, 645.0),
                 eslestirme=None, sinif=None, iz_kapi_mm=20.0):
        self.depo = Depo(db_yolu) if db_yolu else None
        self.yatak_mm = tuple(yatak_mm)
        self.eslestirme = eslestirme or EslestirmeAyari()
        self.sinif = sinif or _sinif.SinifAyari()
        self.iz_kapi_mm = float(iz_kapi_mm)

    def calistir(self, ham_tespitler, ham_kayitlar=None, *, kare=None,
                 harita=None, H=None, zaman_iso=None, kare_yolu=None,
                 maske_alani_mm2=None, tespit_donusturucu=None,
                 kayit_donusturucu=None, gorsel_dizin=None,
                 arsivle=True, tur_profilleri=None) -> dict:
        zaman = zaman_iso or dt.datetime.now().astimezone().isoformat(timespec="seconds")

        tespitler = tespitlere_cevir(ham_tespitler, donusturucu=tespit_donusturucu)
        kayitlar = (kayit_donusturucu(ham_kayitlar) if kayit_donusturucu
                    else kayitlara_cevir(ham_kayitlar))

        # --- 2. eşleştirme ---
        es = esle(tespitler, kayitlar, self.eslestirme)

        # --- 4. izleme ---
        onceki = self.depo.izleri_yukle() if self.depo else []
        izler, tespit_iz = guncelle(onceki, tespitler, zaman, self.iz_kapi_mm)
        for tid, e in es["eslesme"].items():
            if tid in tespit_iz:
                tespit_iz[tid].kayit_id = e["kayit_id"]

        # --- 3. sınıflandırma ---
        kararlar = _sinif.karar(tespitler, es, tespit_iz, self.sinif, tur_profilleri)
        for k in kararlar:
            if k["tespit_id"] in tespit_iz:
                tespit_iz[k["tespit_id"]].sinif = k["sinif"]

        sayim = {"filiz": 0, "yabani": 0, "belirsiz": 0}
        for k in kararlar:
            sayim[k["sinif"]] += 1

        # --- 7. örtü ölçümleri ---
        ortu = _ortu.olc(tespitler, self.yatak_mm, maske_alani_mm2, kararlar)

        # --- 2. çimlenme raporu ---
        cimlenme = cimlenme_raporu(kayitlar, es, izler)

        # --- 5. görsel ---
        gorsel_yolu = ustten_yolu = None
        if kare is not None and (harita is not None or H is not None):
            gorsel_yolu, ustten_yolu = self._gorsel(
                kare, harita, H, tespitler, kararlar, kayitlar, es,
                zaman, sayim, cimlenme, ortu, gorsel_dizin, kare_yolu)

        karar_ix = {k["tespit_id"]: k for k in kararlar}
        tespit_ciktisi = []
        for t in tespitler:
            d = t.sozluk()
            k = karar_ix[t.id]
            # Karar gerekçesi de taşınır: panelde "belirsiz" bir tespiti
            # kullanıcıya sorarken NEDEN belirsiz olduğunu gösterebilmek
            # gerekiyor, yoksa cevap veremez.
            d.update({a: k[a] for a in ("sinif", "skor", "onayli", "kayit_id",
                                        "tur", "bilesenler", "gorunum_detay",
                                        "zaman_detay", "eslesme_mesafe_mm")})
            d["iz_id"] = k["iz_id"]
            tespit_ciktisi.append(d)

        sonuc = {
            "zaman": zaman, "kare_yolu": kare_yolu,
            "gorsel_yolu": gorsel_yolu, "ustten_yolu": ustten_yolu,
            "tespitler": tespit_ciktisi, "sayim": sayim,
            "cimlenme": cimlenme, "ortu": ortu,
            "bos_kayitlar": es["bos_kayitlar"],
            "izler": [i.sozluk() for i in izler],
            "tani": {"girdi": eksik_alanlar(tespitler),
                     "eslestirme": es["tani"],
                     "kayit_sayisi": len(kayitlar),
                     "iz_sayisi": len(izler)},
        }
        if arsivle and self.depo:
            sonuc["tarama_id"] = self.depo.tarama_yaz(sonuc)
        return sonuc

    def _gorsel(self, kare, harita, H, tespitler, kararlar, kayitlar, es,
                zaman, sayim, cimlenme, ortu, dizin, kare_yolu):
        import cv2
        bgr = kare if hasattr(kare, "shape") else cv2.imread(str(kare), cv2.IMREAD_COLOR)
        if bgr is None:
            return None, None
        harita = harita or _cizim.harita_kur(H=H, yatak_mm=self.yatak_mm)

        kapsama = ortu.get("kapsama_yuzde")
        basliklar = [
            f"{zaman}   {bgr.shape[1]}x{bgr.shape[0]}",
            (f"filiz {sayim['filiz']}  yabani {sayim['yabani']}  "
             f"belirsiz {sayim['belirsiz']}   |   ekilen {cimlenme['ekilen']}  "
             f"çıkan {cimlenme['cikan']}  çıkmayan {cimlenme['cikmayan']}"),
            (f"kapsama %{kapsama}" if kapsama is not None
             else "kapsama: alan bilgisi gelmedi"),
        ]
        img = _cizim.gorsel(bgr, harita, tespitler, kararlar, kayitlar=kayitlar,
                            bos_kayit_idleri=es["bos_kayitlar"], basliklar=basliklar)

        kok = Path(dizin) if dizin else (Path(kare_yolu).parent if kare_yolu
                                         else Path("."))
        kok.mkdir(parents=True, exist_ok=True)
        ad = Path(kare_yolu).stem if kare_yolu else zaman.replace(":", "").replace("-", "")
        g = kok / f"{ad}.gorsel.jpg"
        cv2.imwrite(str(g), img, [cv2.IMWRITE_JPEG_QUALITY, 90])

        u = None
        if H is not None:
            ortho, mmf = _cizim.ustten_gorunum(bgr, H, self.yatak_mm)
            ortho = _cizim.ustten_tespitler(ortho, mmf, tespitler, kararlar,
                                            yatak_mm=self.yatak_mm)
            u = kok / f"{ad}.ustten.jpg"
            cv2.imwrite(str(u), ortho, [cv2.IMWRITE_JPEG_QUALITY, 88])
        return str(g), (str(u) if u else None)
