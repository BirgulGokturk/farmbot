"""
izle — taramalar arası zamansal takip.

Kamera sabit, yatak sabit. Bu yüzden takip mm uzayında yapılır; piksel
uzayında değil. Aynı filiz her taramada aynı (X,Y) civarında olmalıdır.

Ne kazandırır:
  * Yanlış pozitif kırımı: bir taramada beliren, bir sonrakinde kaybolan
    leke (gölge, yaprak kırıntısı, su damlası) iz üretemez, onay alamaz.
  * Büyüme hızı: mm²/gün. Ekim tarihiyle tutarlı büyüyen nesne filizdir;
    bir gecede beliren olgun yaprak yabanidir.
  * "Çıkmadı" raporu: ekim kaydı var, N gündür hiçbir izle eşleşmiyor.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np


@dataclass
class Iz:
    id: int
    x_mm: float
    y_mm: float
    alan_mm2: float
    ilk_gorulme: str
    son_gorulme: str
    gorulme_sayisi: int = 1
    kayip_sayisi: int = 0
    kayit_id: int | None = None
    sinif: str = "belirsiz"
    gecmis: list = field(default_factory=list)      # [(zaman, alan_mm2)]
    buyume_mm2_gun: float | None = None

    def sozluk(self):
        return asdict(self)


def _buyume(gecmis):
    """En küçük kareler eğim, mm²/gün. 2'den az nokta varsa None döner."""
    if len(gecmis) < 2:
        return None
    import datetime as dt
    t = [dt.datetime.fromisoformat(g[0]).timestamp() / 86400.0 for g in gecmis]
    a = [g[1] for g in gecmis]
    t = np.asarray(t) - t[0]
    if t[-1] < 1e-6:
        return None
    egim = np.polyfit(t, a, 1)[0]
    return round(float(egim), 3)


def guncelle(izler: list[Iz], nesneler, zaman_iso: str,
             kapi_mm: float = 20.0, max_kayip: int = 5) -> tuple[list[Iz], dict]:
    """
    Döner: (guncel_izler, {nesne_id: Iz})
    kapi_mm: bir nesnenin var olan bir ize bağlanabileceği en büyük mesafe.
             Filizler büyürken merkez biraz kayar; 20 mm makul başlangıçtır,
             sahada ölçülüp ayarlanmalıdır.
    """
    nesne_iz = {}
    if not izler:
        yeni = []
        for i, n in enumerate(nesneler):
            yeni.append(Iz(id=i, x_mm=n.taban_mm[0], y_mm=n.taban_mm[1],
                           alan_mm2=n.alan_mm2, ilk_gorulme=zaman_iso,
                           son_gorulme=zaman_iso,
                           gecmis=[(zaman_iso, n.alan_mm2)]))
            nesne_iz[n.id] = yeni[-1]
        return yeni, nesne_iz

    sonraki_id = max(i.id for i in izler) + 1
    if nesneler:
        N = np.array([n.taban_mm for n in nesneler], np.float64)
        I = np.array([[i.x_mm, i.y_mm] for i in izler], np.float64)
        D = np.linalg.norm(N[:, None, :] - I[None, :, :], axis=2)
        BUYUK = 1e6
        maliyet = np.where(D <= kapi_mm, D, BUYUK)
        try:
            from scipy.optimize import linear_sum_assignment
            si, sj = linear_sum_assignment(maliyet)
            ok = maliyet[si, sj] < BUYUK
            ciftler = list(zip(si[ok], sj[ok]))
        except ImportError:
            ciftler = []
            m = maliyet.copy()
            while m.size and m.min() < BUYUK:
                i, j = np.unravel_index(np.argmin(m), m.shape)
                ciftler.append((i, j)); m[i, :] = BUYUK; m[:, j] = BUYUK
    else:
        ciftler = []

    eslesen_iz = set()
    for i, j in ciftler:
        n, iz = nesneler[i], izler[j]
        # konumu yumuşat: ani sıçramalara direnç (üstel ortalama)
        iz.x_mm = 0.7 * iz.x_mm + 0.3 * n.taban_mm[0]
        iz.y_mm = 0.7 * iz.y_mm + 0.3 * n.taban_mm[1]
        iz.alan_mm2 = n.alan_mm2
        iz.son_gorulme = zaman_iso
        iz.gorulme_sayisi += 1
        iz.kayip_sayisi = 0
        iz.gecmis.append((zaman_iso, n.alan_mm2))
        iz.gecmis = iz.gecmis[-40:]
        iz.buyume_mm2_gun = _buyume(iz.gecmis)
        nesne_iz[n.id] = iz
        eslesen_iz.add(iz.id)

    for iz in izler:
        if iz.id not in eslesen_iz:
            iz.kayip_sayisi += 1

    eslesen_nesne = {nesneler[i].id for i, _ in ciftler}
    for n in nesneler:
        if n.id in eslesen_nesne:
            continue
        iz = Iz(id=sonraki_id, x_mm=n.taban_mm[0], y_mm=n.taban_mm[1],
                alan_mm2=n.alan_mm2, ilk_gorulme=zaman_iso,
                son_gorulme=zaman_iso, gecmis=[(zaman_iso, n.alan_mm2)])
        sonraki_id += 1
        izler.append(iz)
        nesne_iz[n.id] = iz

    izler = [i for i in izler if i.kayip_sayisi <= max_kayip]
    return izler, nesne_iz
