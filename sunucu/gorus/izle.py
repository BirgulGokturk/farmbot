"""
izle — taramalar arası zamansal takip ve büyüme ölçümü.  [madde 4]

Kamera sabit, yatak sabit. Bu yüzden takip mm uzayında yapılır, piksel
uzayında değil. Aynı filiz her taramada aynı (X,Y) civarında olmalıdır.

Ne kazandırır:
  * Yanlış pozitif kırımı — bir taramada beliren, sonrakinde kaybolan leke
    (gölge, su damlası, yaprak kırıntısı) iz üretemez, onay alamaz.
  * Büyüme hızı mm²/gün — ekim tarihiyle tutarlı büyüyen nesne filizdir;
    bir gecede beliren olgun yaprak yabanidir.
  * "Çıkmadı" ile "kaçırdık" ayrımı — ekim kaydı var, N gündür hiçbir izle
    eşleşmiyorsa gerçekten çıkmamıştır.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np


@dataclass
class Iz:
    id: int
    x_mm: float
    y_mm: float
    alan_mm2: float | None
    ilk_gorulme: str
    son_gorulme: str
    gorulme_sayisi: int = 1
    kayip_sayisi: int = 0
    kayit_id: int | None = None
    sinif: str = "belirsiz"
    gecmis: list = field(default_factory=list)     # [(zaman_iso, alan_mm2)]
    buyume_mm2_gun: float | None = None

    def sozluk(self):
        return asdict(self)


def _buyume(gecmis):
    """En küçük kareler eğim, mm²/gün. Yetersiz veride None — uydurulmaz."""
    import datetime as dt
    nokta = [(g[0], g[1]) for g in gecmis if g[1] is not None]
    if len(nokta) < 2:
        return None
    try:
        t = [dt.datetime.fromisoformat(z).timestamp() / 86400.0 for z, _ in nokta]
    except ValueError:
        return None
    a = [v for _, v in nokta]
    t = np.asarray(t) - t[0]
    if t[-1] < 1e-6:
        return None
    return round(float(np.polyfit(t, a, 1)[0]), 3)


def guncelle(izler: list[Iz], tespitler, zaman_iso: str,
             kapi_mm: float = 20.0, max_kayip: int = 5):
    """
    Döner: (guncel_izler, {tespit_id: Iz})
    kapi_mm: bir tespitin var olan bir ize bağlanabileceği en büyük mesafe.
             Filizler büyürken merkez biraz kayar; 20 mm makul başlangıçtır,
             sahada ölçülüp ayarlanmalıdır.
    """
    izler = list(izler or [])
    tespit_iz = {}

    if not izler:
        for i, t in enumerate(tespitler):
            iz = Iz(id=i, x_mm=t.x_mm, y_mm=t.y_mm, alan_mm2=t.alan_mm2,
                    ilk_gorulme=zaman_iso, son_gorulme=zaman_iso,
                    gecmis=[(zaman_iso, t.alan_mm2)])
            izler.append(iz); tespit_iz[t.id] = iz
        return izler, tespit_iz

    sonraki = max(i.id for i in izler) + 1
    ciftler = []
    if tespitler:
        T = np.array([t.mm for t in tespitler], np.float64)
        I = np.array([[i.x_mm, i.y_mm] for i in izler], np.float64)
        D = np.linalg.norm(T[:, None, :] - I[None, :, :], axis=2)
        BUYUK = 1e6
        maliyet = np.where(D <= kapi_mm, D, BUYUK)
        try:
            from scipy.optimize import linear_sum_assignment
            si, sj = linear_sum_assignment(maliyet)
            ok = maliyet[si, sj] < BUYUK
            ciftler = list(zip(si[ok], sj[ok]))
        except ImportError:
            m = maliyet.copy()
            while m.size and m.min() < BUYUK:
                i, j = np.unravel_index(np.argmin(m), m.shape)
                ciftler.append((i, j)); m[i, :] = BUYUK; m[:, j] = BUYUK

    eslesen_iz = set()
    for i, j in ciftler:
        t, iz = tespitler[i], izler[j]
        # konumu yumuşat: ani sıçramalara direnç
        iz.x_mm = 0.7 * iz.x_mm + 0.3 * t.x_mm
        iz.y_mm = 0.7 * iz.y_mm + 0.3 * t.y_mm
        iz.alan_mm2 = t.alan_mm2
        iz.son_gorulme = zaman_iso
        iz.gorulme_sayisi += 1
        iz.kayip_sayisi = 0
        iz.gecmis = (iz.gecmis + [(zaman_iso, t.alan_mm2)])[-40:]
        iz.buyume_mm2_gun = _buyume(iz.gecmis)
        tespit_iz[t.id] = iz
        eslesen_iz.add(iz.id)

    for iz in izler:
        if iz.id not in eslesen_iz:
            iz.kayip_sayisi += 1

    eslesen_tespit = {tespitler[i].id for i, _ in ciftler}
    for t in tespitler:
        if t.id in eslesen_tespit:
            continue
        iz = Iz(id=sonraki, x_mm=t.x_mm, y_mm=t.y_mm, alan_mm2=t.alan_mm2,
                ilk_gorulme=zaman_iso, son_gorulme=zaman_iso,
                gecmis=[(zaman_iso, t.alan_mm2)])
        sonraki += 1
        izler.append(iz); tespit_iz[t.id] = iz

    return [i for i in izler if i.kayip_sayisi <= max_kayip], tespit_iz


def izlerden_yukle(satirlar) -> list[Iz]:
    import json
    out = []
    for r in satirlar:
        r = dict(r)
        gec = r.get("gecmis")
        if isinstance(gec, str):
            gec = json.loads(gec or "[]")
        out.append(Iz(id=r["id"], x_mm=r["x_mm"], y_mm=r["y_mm"],
                      alan_mm2=r.get("alan_mm2"), ilk_gorulme=r["ilk_gorulme"],
                      son_gorulme=r["son_gorulme"],
                      gorulme_sayisi=r.get("gorulme_sayisi", 1),
                      kayip_sayisi=r.get("kayip_sayisi", 0),
                      kayit_id=r.get("kayit_id"),
                      sinif=r.get("sinif") or "belirsiz",
                      gecmis=[tuple(g) for g in (gec or [])],
                      buyume_mm2_gun=r.get("buyume_mm2_gun")))
    return out
