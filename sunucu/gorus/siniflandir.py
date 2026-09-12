"""
siniflandir — her nesne için filiz / yabani / belirsiz kararı.

Üç bağımsız kanıtın ağırlıklı toplamı. Tek bir kanıtın hatası kararı
devirmesin diye skor üretilir, sert kural değil:

  konum   (w=0.60)  Ekim kaydına eşleşti mi, ne kadar yakın?
                    En güvenilir kanıt — robot nereye ektiğini biliyor.
  gorunum (w=0.25)  Alan, çap, dolulukk, uzanım, yeşillik. Faz 1'de elle
                    yazılmış aralık skoru; Faz 2'de RandomForest ya da
                    Hailo üstünde YOLO11n-seg sınıf olasılığı buraya girer.
  zaman   (w=0.15)  Kaç taramadır aynı yerde görülüyor, büyüme hızı ekim
                    tarihiyle tutarlı mı?

Çıktı üç sınıf: filiz / yabani / belirsiz. Belirsizler panelde kullanıcıya
sorulur; verilen cevap Faz 2'nin etiketli verisi olur. Otomatik müdahale
yalnız `filiz` ve `yabani` üzerinde konuşulabilir; `belirsiz` asla.
"""

from __future__ import annotations

import numpy as np


# Faz 1 görünüm önseli: türe göre beklenen aralıklar. Ölçülene kadar geniş
# tutulur; sunucudaki tür kaydından güncellenmelidir.
VARSAYILAN_PROFIL = {
    "cap_mm": (4.0, 120.0),        # kotiledondan olgun yaprağa
    "doluluk": (0.35, 1.0),        # yabani otlar genelde daha dağınık
    "uzanim": (1.0, 4.0),          # çok uzun ince = çim benzeri yabani
    "yesillik_a": (-60.0, -4.0),
}


def _aralik_skoru(deger, alt, ust, yumusatma=0.15):
    """Aralık içinde 1, dışında yumuşak düşüş. Sert kesme yerine skor."""
    if deger is None:
        return 0.5
    genislik = max(ust - alt, 1e-6)
    if alt <= deger <= ust:
        return 1.0
    d = (alt - deger) if deger < alt else (deger - ust)
    return float(max(0.0, 1.0 - d / (yumusatma * genislik + 1e-9)))


def gorunum_skoru(nesne, profil=None) -> tuple[float, dict]:
    p = {**VARSAYILAN_PROFIL, **(profil or {})}
    parcalar = {
        "cap": _aralik_skoru(nesne.cap_mm, *p["cap_mm"]),
        "doluluk": _aralik_skoru(nesne.doluluk, *p["doluluk"]),
        "uzanim": _aralik_skoru(nesne.uzanim, *p["uzanim"]),
        "yesillik": _aralik_skoru(nesne.yesillik_a, *p["yesillik_a"]),
    }
    return float(np.mean(list(parcalar.values()))), parcalar


def zaman_skoru(iz) -> tuple[float, dict]:
    """
    iz: izle.Iz ya da None.
      * Ekim tarihinden SONRA ve ekim noktasında belirdiyse -> yüksek
      * Aralarda birdenbire belirdiyse -> düşük
      * Tek karede görüldüyse -> nötr (0.5), henüz karar veremeyiz
    """
    if iz is None:
        return 0.5, {"sebep": "iz yok (ilk tarama)"}
    d = {"gorulme_sayisi": iz.gorulme_sayisi,
         "ilk_gorulme": iz.ilk_gorulme, "buyume_mm2_gun": iz.buyume_mm2_gun}
    if iz.gorulme_sayisi < 2:
        return 0.5, {**d, "sebep": "tek tarama"}
    skor = min(1.0, 0.4 + 0.15 * iz.gorulme_sayisi)
    if iz.buyume_mm2_gun is not None and iz.buyume_mm2_gun < 0:
        skor *= 0.7        # küçülüyor: gölge/ışık dalgalanması olabilir
    return float(skor), d


def karar(nesneler, eslesme_sonucu, izler, ayar, profiller=None) -> list[dict]:
    es = eslesme_sonucu.get("eslesme", {})
    cikti = []
    for n in nesneler:
        e = es.get(n.id)
        s_konum = e["konum_skoru"] if e else 0.0
        tur = e["tur"] if e else None
        s_gor, gor_detay = gorunum_skoru(n, (profiller or {}).get(tur))
        s_zam, zam_detay = zaman_skoru((izler or {}).get(n.id))

        skor = (ayar.w_konum * s_konum + ayar.w_gorunum * s_gor +
                ayar.w_zaman * s_zam)

        if skor >= ayar.filiz_esigi:
            sinif = "filiz"
        elif skor <= ayar.yabani_esigi:
            sinif = "yabani"
        else:
            sinif = "belirsiz"

        # Onay sayacı: geri alınamaz işten önce k taramada üst üste görülmeli.
        iz = (izler or {}).get(n.id)
        onayli = bool(iz and iz.gorulme_sayisi >= ayar.min_gorunum_kare)

        cikti.append({
            "nesne_id": n.id,
            "sinif": sinif,
            "skor": round(float(skor), 3),
            "onayli": onayli,
            "kayit_id": e["kayit_id"] if e else None,
            "tur": tur,
            "bilesenler": {
                "konum": round(s_konum, 3),
                "gorunum": round(s_gor, 3),
                "zaman": round(s_zam, 3),
            },
            "gorunum_detay": {k: round(v, 3) for k, v in gor_detay.items()},
            "zaman_detay": zam_detay,
            "eslesme_mesafe_mm": e["mesafe_mm"] if e else None,
        })
    return cikti
