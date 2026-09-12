"""
boru — tek bir taramanın uçtan uca akışı.

    kare -> kalibrasyon doğrula -> ışık normalize -> ROI -> yeşil maske
         -> nesneler -> ekim kaydıyla eşleştir -> izle -> sınıflandır
         -> görsel -> sonuç

Güvenilirlik kuralı: adım 2 (kalibrasyon doğrulama) düşerse tarama
`gecerli=False` ile biter ve KOORDİNAT YAYIMLANMAZ. Nesneler yine
raporlanır ama mm değerleri None'dır; panelde "kalibrasyon kaymış" uyarısı
çıkar. Yanlış koordinat üretip robota vermektense hiç üretmemek yeğdir.

Her adımın süresi ölçülür (`sureler_ms`) — bütçe tahmini değil, ölçüm.
"""

from __future__ import annotations

import time
import datetime as dt
from pathlib import Path

import numpy as np
import cv2

from . import bolutle, cizim, eslestir, etiket, isik, izle, nesne as nesne_mod
from .ayarlar import Ayarlar
from .duzlem import Duzlem


class Zaman:
    def __init__(self):
        self.d = {}
        self._t = time.perf_counter()

    def isaret(self, ad):
        s = time.perf_counter()
        self.d[ad] = round((s - self._t) * 1000, 1)
        self._t = s


def _kare_oku(yol_veya_dizi, hedef_genislik):
    if isinstance(yol_veya_dizi, np.ndarray):
        bgr = yol_veya_dizi
    else:
        bgr = cv2.imread(str(yol_veya_dizi), cv2.IMREAD_COLOR)
        if bgr is None:
            raise FileNotFoundError(f"Kare okunamadı: {yol_veya_dizi}")
    ham = (bgr.shape[1], bgr.shape[0])
    if hedef_genislik and bgr.shape[1] != hedef_genislik:
        o = hedef_genislik / bgr.shape[1]
        bgr = cv2.resize(bgr, (hedef_genislik, int(round(bgr.shape[0] * o))),
                         interpolation=cv2.INTER_AREA)
    return bgr, ham


class Tarama:
    def __init__(self, ayarlar: Ayarlar | None = None, duzlem: Duzlem | None = None):
        self.ayar = ayarlar or Ayarlar.yukle()
        self.duzlem_ham = duzlem or Duzlem.yukle(self.ayar.kalibrasyon_yolu)
        self._duzlem_onbellek = {}

    def _duzlem(self, kare_boyu):
        a = tuple(kare_boyu)
        if a not in self._duzlem_onbellek:
            self._duzlem_onbellek[a] = (self.duzlem_ham if a == tuple(self.duzlem_ham.kare_boyu)
                                        else self.duzlem_ham.olcekle(a))
        return self._duzlem_onbellek[a]

    def calistir(self, kare, *, kayitlar=None, izler=None, zaman_iso=None,
                 gorsel=True, bitki_yuksekligi_mm=None) -> dict:
        z = Zaman()
        zaman_iso = zaman_iso or dt.datetime.now().astimezone().isoformat(timespec="seconds")

        bgr, ham_boy = _kare_oku(kare, self.ayar.kare.isleme_genisligi)
        boy = (bgr.shape[1], bgr.shape[0])
        D = self._duzlem(boy)
        z.isaret("kare_hazirla")

        # --- 1. kalibrasyon hâlâ geçerli mi? (etiket arama tarama başına 1 kez) ---
        et_ham = etiket.bul_pencereli(bgr, D, self.ayar.gerekli_etiketler)
        dogrulama = etiket.dogrula(bgr, D, self.ayar.gerekli_etiketler,
                                   self.ayar.max_kalibrasyon_artigi_mm,
                                   bulunan=et_ham)
        z.isaret("kalibrasyon_dogrula")

        # --- 2. ışık (etiket beyazı referans alınır) ---
        roi = D.yatak_maskesi(boy, self.ayar.roi_ic_pay_mm)
        bgr_n, isik_tani = isik.normalize(bgr, roi, et_ham)
        z.isaret("isik")

        # --- 3. bölütleme ---
        maske, bol_tani = bolutle.yesil_maske(bgr_n, self.ayar.bolutleme, roi)
        z.isaret("bolutle")

        # --- 4. nesneler ---
        nesneler, nes_tani = nesne_mod.cikar(maske, bgr_n, D, self.ayar.nesne)
        nesne_mod.paralaks_uygula(nesneler, D, bitki_yuksekligi_mm)
        z.isaret("nesne")

        # --- 5. ekim kaydıyla eşleştir ---
        kayitlar = list(kayitlar or [])
        es = eslestir.esle(nesneler, kayitlar, self.ayar.eslestirme)
        z.isaret("eslestir")

        # --- 6. izleme ---
        izler = list(izler or [])
        izler, nesne_iz = izle.guncelle(izler, nesneler, zaman_iso)
        for nid, e in es["eslesme"].items():
            if nid in nesne_iz:
                nesne_iz[nid].kayit_id = e["kayit_id"]
        z.isaret("izle")

        # --- 7. sınıflandır ---
        from . import siniflandir
        kararlar = siniflandir.karar(nesneler, es, nesne_iz, self.ayar.sinif)
        for k in kararlar:
            if k["nesne_id"] in nesne_iz:
                nesne_iz[k["nesne_id"]].sinif = k["sinif"]
        z.isaret("siniflandir")

        sayim = {"filiz": 0, "yabani": 0, "belirsiz": 0}
        for k in kararlar:
            sayim[k["sinif"]] += 1

        # --- 8. görsel ---
        gorsel_dizi = None
        if gorsel:
            basliklar = [
                f"{zaman_iso}   {boy[0]}x{boy[1]} (ham {ham_boy[0]}x{ham_boy[1]})",
                (f"kalibrasyon: {'GEÇERLİ' if dogrulama['gecerli'] else 'GEÇERSİZ'}  "
                 f"artık {dogrulama.get('artik_rms_mm')} mm  "
                 f"etiket {dogrulama.get('bulunan_sayi')}/{len(self.ayar.gerekli_etiketler)}"),
                (f"filiz {sayim['filiz']}  yabani {sayim['yabani']}  "
                 f"belirsiz {sayim['belirsiz']}  |  eşleşmeyen kayıt "
                 f"{len(es['bos_kayitlar'])}  |  eşik ExGR {bol_tani['esik_exgr']}"),
            ]
            if not dogrulama["gecerli"]:
                basliklar.append(f"UYARI: {dogrulama.get('sebep')} — koordinat yayımlanmadı")
            gorsel_dizi = cizim.ustdenklestir(
                bgr, D, nesneler, kararlar, kayitlar=kayitlar,
                bos_kayit_idleri=es["bos_kayitlar"], dogrulama=dogrulama,
                basliklar=basliklar)
            z.isaret("cizim")

        gecerli = bool(dogrulama["gecerli"])
        tespitler = []
        for n in nesneler:
            k = next(k for k in kararlar if k["nesne_id"] == n.id)
            d = n.sozluk()
            if not gecerli:                       # güvenilmezse mm yayımlama
                d["merkez_mm"] = d["taban_mm"] = None
                d["alan_mm2"] = d["cap_mm"] = d["cevre_mm"] = None
            d.update({k2: k[k2] for k2 in ("sinif", "skor", "onayli",
                                           "kayit_id", "tur", "bilesenler")})
            d["iz_id"] = nesne_iz[n.id].id if n.id in nesne_iz else None
            tespitler.append(d)

        return {
            "zaman": zaman_iso,
            "gecerli": gecerli,
            "gecersizlik_sebebi": dogrulama.get("sebep") if not gecerli else None,
            "kare_boyu": list(boy),
            "ham_kare_boyu": list(ham_boy),
            "tespitler": tespitler,
            "sayim": sayim,
            "bos_kayitlar": es["bos_kayitlar"],
            "izler": [i.sozluk() for i in izler],
            "gorsel": gorsel_dizi,
            "tani": {
                "kalibrasyon": dogrulama,
                "olcek_mm_px": self._duzlem(boy).olcek_ozeti(),
                "isik": isik_tani,
                "bolutleme": bol_tani,
                "nesne": nes_tani,
                "eslestirme": es["tani"],
            },
            "sureler_ms": z.d,
            # çizim katmanının tekrar kullanabilmesi için ham nesneler
            "_nesneler": nesneler,
            "_kararlar": kararlar,
        }

    def gorsel_kaydet(self, sonuc, yol) -> Path | None:
        if sonuc.get("gorsel") is None:
            return None
        yol = Path(yol)
        yol.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(yol), sonuc["gorsel"],
                    [cv2.IMWRITE_JPEG_QUALITY, self.ayar.kare.jpeg_kalitesi])
        return yol
