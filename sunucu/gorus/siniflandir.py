"""
siniflandir — filiz / yabani / belirsiz kararı.  [madde 3]

Üç bağımsız kanıtın ağırlıklı toplamı. Tek bir kanıtın hatası kararı
devirmesin diye skor üretilir, sert kural değil:

  konum   (0.60)  Ekim kaydına eşleşti mi, ne kadar yakın?
                  En güvenilir kanıt — robot nereye ektiğini biliyor.
  görünüm (0.25)  AKRANLARA GÖRE boyut. Aynı taramada ekim kaydına oturmuş
                  bitkilerin alan dağılımı referanstır; ondan uzak düşen
                  nesne yabani adayıdır. Bu, sabit bir eşikten iyidir:
                  bitkiler büyüdükçe referans kendiliğinden kayar.
                  Yeterli akran yoksa tür profiline, o da yoksa NÖTR'e düşer
                  ve raporda "kullanılamadı" yazar — uydurulmaz.
  zaman   (0.15)  DOĞRULAYICIDIR, tek başına mahsulleştirmez. Ekim kaydına
                  oturmuş bir nesnenin ısrarı onu doğrular; kayda oturmamış
                  bir nesnenin ısrarı onu mahsul yapmaz, tersine yabani
                  olduğunu pekiştirir. (İlk sürümde bu ayrım yoktu ve
                  ısrarcı yabani otlar üç taramada "belirsiz"e kayıyordu.)

Üç sınıf çıkar. `belirsiz` olanlar panelde kullanıcıya sorulur; verilen
cevap ileride model eğitiminin etiketli verisi olur. Geri alınamaz hiçbir iş
`belirsiz` üzerinde yapılmaz.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class SinifAyari:
    filiz_esigi: float = 0.60
    yabani_esigi: float = 0.35
    w_konum: float = 0.60
    w_gorunum: float = 0.25
    w_zaman: float = 0.15
    min_gorunum_kare: int = 2      # onay için kaç taramada görülmeli


# Tür profili: beklenen aralıklar. Ölçülene kadar geniş tutulur; sunucudaki
# tür kaydından güncellenmelidir.
VARSAYILAN_PROFIL = {
    "cap_mm": (4.0, 120.0),
    "alan_mm2": (8.0, 40000.0),
}


def _aralik_skoru(deger, alt, ust, yumusatma=0.15):
    if deger is None:
        return None
    genislik = max(ust - alt, 1e-6)
    if alt <= deger <= ust:
        return 1.0
    d = (alt - deger) if deger < alt else (deger - ust)
    return float(max(0.0, 1.0 - d / (yumusatma * genislik + 1e-9)))


def akran_referansi(tespitler, eslestirme, en_az=3) -> dict | None:
    """
    Ekim kaydına oturmuş bitkilerin alan dağılımı. Aynı tarlaya aynı gün
    ekilmiş bitkiler birbirine benzer; referans onlardır. Bitkiler büyüdükçe
    referans kendiliğinden kayar, sabit eşik güncellemeye gerek kalmaz.
    """
    es = eslestirme.get("eslesme", {})
    alanlar = [t.alan_mm2 for t in tespitler
               if t.id in es and t.alan_mm2 is not None]
    if len(alanlar) < en_az:
        return None
    a = np.asarray(alanlar, float)
    orta = float(np.median(a))
    mad = float(np.median(np.abs(a - orta)))
    return {"ortanca_mm2": round(orta, 1), "mad_mm2": round(mad, 1),
            "akran_sayisi": len(alanlar)}


def gorunum_skoru(tespit, profil=None, akran=None):
    if akran is not None and tespit.alan_mm2 is not None:
        orta, mad = akran["ortanca_mm2"], akran["mad_mm2"]
        # genişlik: MAD sıfıra yakınsa ortancanın %15'i taban alınır
        sigma = 2.5 * mad + 0.15 * orta
        z = (tespit.alan_mm2 - orta) / max(sigma, 1e-6)
        skor = float(np.exp(-0.5 * z * z))
        return skor, {"durum": "akran karsilastirmasi", "z": round(float(z), 2),
                      "akran_ortancasi_mm2": orta, "akran_sayisi": akran["akran_sayisi"]}

    p = {**VARSAYILAN_PROFIL, **(profil or {})}
    parca = {"cap": _aralik_skoru(tespit.cap_mm, *p["cap_mm"]),
             "alan": _aralik_skoru(tespit.alan_mm2, *p["alan_mm2"])}
    gecerli = [v for v in parca.values() if v is not None]
    if not gecerli:
        return 0.5, {**parca, "durum": "kullanilamadi (oznitelik yok)"}
    return float(np.mean(gecerli)), {**parca, "durum": "tur profili (akran yetersiz)"}


def zaman_skoru(iz, eslesti: bool):
    """
    Zaman DOĞRULAYICI kanıttır, üretici değil.
      eşleşmiş + ısrarlı            -> yükselir (mahsul doğrulanır)
      eşleşmemiş + ısrarlı          -> DÜŞER (ekim yerinde olmayan bir şey
                                       ısrarla duruyorsa yabanidir)
      tek tarama                    -> nötr, henüz karar veremeyiz
    """
    if iz is None:
        return 0.5, {"durum": "iz yok (ilk tarama)"}
    d = {"gorulme_sayisi": iz.gorulme_sayisi, "ilk_gorulme": iz.ilk_gorulme,
         "buyume_mm2_gun": iz.buyume_mm2_gun, "eslesti": eslesti}
    if iz.gorulme_sayisi < 2:
        return 0.5, {**d, "durum": "tek tarama"}
    if not eslesti:
        # ısrar arttıkça yabani olduğuna güven artar
        return (float(max(0.05, 0.4 - 0.1 * (iz.gorulme_sayisi - 1))),
                {**d, "durum": "eslesmeyen israr -> yabani lehine"})
    skor = min(1.0, 0.4 + 0.15 * iz.gorulme_sayisi)
    if iz.buyume_mm2_gun is not None and iz.buyume_mm2_gun < 0:
        skor *= 0.7        # küçülüyor: ışık dalgalanması ya da yanlış tespit
    return float(skor), {**d, "durum": "eslesen israr -> mahsul dogrulanir"}


def karar(tespitler, eslestirme, izler=None, ayar=None, profiller=None) -> list[dict]:
    ayar = ayar or SinifAyari()
    es = eslestirme.get("eslesme", {})
    akran = akran_referansi(tespitler, eslestirme)
    cikti = []
    for t in tespitler:
        e = es.get(t.id)
        s_konum = e["konum_skoru"] if e else 0.0
        tur = e["tur"] if e else None
        # Akran referansı yalnız EŞLEŞMEYENLERİ sınamak için anlamlı;
        # eşleşenler zaten referansı oluşturuyor, kendilerini ölçmezler.
        s_gor, gor_detay = gorunum_skoru(t, (profiller or {}).get(tur),
                                         None if e else akran)
        iz = (izler or {}).get(t.id)
        s_zam, zam_detay = zaman_skoru(iz, eslesti=e is not None)

        skor = ayar.w_konum * s_konum + ayar.w_gorunum * s_gor + ayar.w_zaman * s_zam
        if skor >= ayar.filiz_esigi:
            sinif = "filiz"
        elif skor <= ayar.yabani_esigi:
            sinif = "yabani"
        else:
            sinif = "belirsiz"

        cikti.append({
            "tespit_id": t.id, "sinif": sinif, "skor": round(float(skor), 3),
            "onayli": bool(iz and iz.gorulme_sayisi >= ayar.min_gorunum_kare),
            "kayit_id": e["kayit_id"] if e else None, "tur": tur,
            "bilesenler": {"konum": round(s_konum, 3), "gorunum": round(s_gor, 3),
                           "zaman": round(s_zam, 3)},
            "gorunum_detay": gor_detay, "zaman_detay": zam_detay,
            "akran_referansi": akran,
            "eslesme_mesafe_mm": e["mesafe_mm"] if e else None,
            "iz_id": iz.id if iz else None,
        })
    return cikti
