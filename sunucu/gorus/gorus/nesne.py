"""
nesne — yeşil maskeden ayrık bitki nesneleri ve mm cinsinden öznitelikler.

Adımlar:
  1. Bağlantılı bileşen etiketleme.
  2. Değen bitkileri ayırmak için mesafe dönüşümü + watershed (isteğe bağlı).
     Filizler ayrıksa gereksiz; sıra kapandığında şart olur.
  3. Her nesne için öznitelikler DOĞRUDAN mm uzayında hesaplanır. Piksel
     alanını sabit bir katsayıyla çarpmak eğik kamerada yanlıştır: ölçek
     yatağın uzak ucunda yakın ucundan farklıdır (bkz. duzlem.olcek_ozeti).

Taban noktası: Homografi yalnız toprak düzleminde geçerli olduğundan filizin
yapraklarının ağırlık merkezi, gerçek kök noktasından kameradan UZAĞA doğru
kaymış görünür. İki kestirim birlikte üretilir:
  * merkez_mm  — kontur ağırlık merkezinin düzleme izdüşümü (ham)
  * taban_mm   — nadire en yakın kontur noktası; yükseklik biliniyorsa
                 ayrıca paralaks düzeltmesi uygulanır.
Nadir/kamera yüksekliği kalibrasyonda yoksa taban_mm = merkez_mm döner ve
`paralaks` alanı "yok" olarak işaretlenir. Uydurma düzeltme yapılmaz.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np
import cv2


@dataclass
class Nesne:
    id: int
    merkez_mm: tuple[float, float]
    taban_mm: tuple[float, float]
    alan_mm2: float
    cap_mm: float                     # eşdeğer daire çapı
    cevre_mm: float
    doluluk: float                    # alan / dışbükey zarf alanı
    uzanim: float                     # uzun eksen / kısa eksen
    kompaktlik: float                 # 4*pi*alan / çevre²  (1 = daire)
    yesillik_a: float                 # ortalama L*a*b* a* (negatif = yeşil)
    piksel_kutu: tuple[int, int, int, int]
    piksel_merkez: tuple[float, float]
    kontur_piksel: list = field(repr=False, default_factory=list)
    paralaks: str = "yok"
    bayraklar: list = field(default_factory=list)

    def sozluk(self, kontur_dahil=False):
        d = asdict(self)
        if not kontur_dahil:
            d.pop("kontur_piksel")
        return d


def _watershed(maske, oran):
    mesafe = cv2.distanceTransform(maske, cv2.DIST_L2, 5)
    if mesafe.max() <= 0:
        return maske
    _, tepe = cv2.threshold(mesafe, oran * mesafe.max(), 255, cv2.THRESH_BINARY)
    tepe = tepe.astype(np.uint8)
    n, isaret = cv2.connectedComponents(tepe)
    if n <= 2:
        return maske
    bilinmeyen = cv2.subtract(maske, tepe)
    isaret = isaret + 1
    isaret[bilinmeyen > 0] = 0
    renkli = cv2.cvtColor(maske, cv2.COLOR_GRAY2BGR)
    isaret = cv2.watershed(renkli, isaret)
    ayrik = maske.copy()
    ayrik[isaret == -1] = 0           # havzalar arası sınırı kes
    return ayrik


def cikar(maske, bgr, duzlem, ayar) -> tuple[list[Nesne], dict]:
    calisma = _watershed(maske, ayar.watershed_mesafe_orani) if ayar.watershed_kullan else maske

    konturlar, _ = cv2.findContours(calisma, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    lab_a = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[:, :, 1].astype(np.int16) - 128

    nadir = np.asarray(duzlem.nadir_mm, np.float64) if duzlem.nadir_mm else None
    nesneler, elenen = [], {"kucuk": 0, "yatak_disi": 0, "bozuk": 0, "bicimsiz": 0}

    for c in konturlar:
        if len(c) < 5:
            elenen["bozuk"] += 1
            continue
        c2 = c.reshape(-1, 2).astype(np.float64)
        try:
            alan = duzlem.alan_mm2(c2)
        except ValueError:
            elenen["bozuk"] += 1
            continue
        if alan < ayar.min_alan_mm2:
            elenen["kucuk"] += 1
            continue

        mm = duzlem.piksel_to_mm(c2)
        merkez_mm = mm.mean(axis=0)
        if not duzlem.yatak_icinde([merkez_mm], pay_mm=0.0)[0]:
            elenen["yatak_disi"] += 1
            continue

        # --- taban noktası ---
        if nadir is not None:
            taban_mm = mm[np.argmin(np.linalg.norm(mm - nadir, axis=1))]
            paralaks = "nadire_en_yakin_kontur"
        else:
            taban_mm = merkez_mm
            paralaks = "yok"

        # --- geometrik öznitelikler, mm uzayında ---
        kapali = np.vstack([mm, mm[:1]])
        cevre = float(np.sum(np.linalg.norm(np.diff(kapali, axis=0), axis=1)))
        cap = float(2.0 * np.sqrt(alan / np.pi))
        try:
            zarf = cv2.convexHull(c)
            zarf_alan = duzlem.alan_mm2(zarf.reshape(-1, 2).astype(np.float64))
            doluluk = float(alan / zarf_alan) if zarf_alan > 0 else 0.0
        except Exception:
            doluluk = 0.0
        merkezli = mm - merkez_mm
        ozdeger = np.linalg.eigvalsh(np.cov(merkezli.T) + np.eye(2) * 1e-9)
        uzanim = float(np.sqrt(max(ozdeger) / max(min(ozdeger), 1e-9)))
        kompaktlik = float(4 * np.pi * alan / max(cevre ** 2, 1e-9))

        x, y, w, h = cv2.boundingRect(c)
        nm = np.zeros(maske.shape, np.uint8)
        cv2.drawContours(nm, [c], -1, 255, -1)
        yesillik = float(cv2.mean(lab_a.astype(np.float32), mask=nm)[0])

        # Halka/çizgi biçimli kalıntı (yatak kenarı sızıntısı, sulama hortumu):
        # alanı büyük ama çevresi devasa. Bitki asla böyle olmaz.
        if kompaktlik < getattr(ayar, "min_kompaktlik", 0.0):
            elenen["bicimsiz"] = elenen.get("bicimsiz", 0) + 1
            continue

        bayraklar = []
        if alan > ayar.max_alan_mm2:
            bayraklar.append("kume")
        if not duzlem.yatak_icinde([merkez_mm], pay_mm=-ayar.kenar_payi_mm)[0]:
            bayraklar.append("yatak_kenari")

        nesneler.append(Nesne(
            id=len(nesneler), merkez_mm=tuple(map(float, merkez_mm)),
            taban_mm=tuple(map(float, taban_mm)), alan_mm2=round(alan, 2),
            cap_mm=round(cap, 2), cevre_mm=round(cevre, 2),
            doluluk=round(doluluk, 3), uzanim=round(uzanim, 3),
            kompaktlik=round(kompaktlik, 3), yesillik_a=round(yesillik, 2),
            piksel_kutu=(int(x), int(y), int(w), int(h)),
            piksel_merkez=tuple(map(float, c2.mean(axis=0))),
            kontur_piksel=c2.tolist(), paralaks=paralaks, bayraklar=bayraklar,
        ))

    tani = {
        "kontur_sayisi": len(konturlar),
        "nesne_sayisi": len(nesneler),
        "elenen": elenen,
        "watershed": bool(ayar.watershed_kullan),
        "alan_mm2_ozet": ({
            "min": round(min(n.alan_mm2 for n in nesneler), 2),
            "medyan": round(float(np.median([n.alan_mm2 for n in nesneler])), 2),
            "max": round(max(n.alan_mm2 for n in nesneler), 2),
        } if nesneler else None),
    }
    return nesneler, tani


def paralaks_uygula(nesneler, duzlem, yukseklik_kestirimi_mm) -> None:
    """
    Yükseklik ÖLÇÜLEBİLİYORSA (ör. robot probu, stereo, ya da bitki kaydındaki
    boy kaydı) taban noktalarını yerine oturtur. Yükseklik None ise hiçbir şey
    yapmaz — tahmini yükseklikle düzeltme yapmak, düzeltmemekten kötüdür.
    """
    if yukseklik_kestirimi_mm is None or duzlem.nadir_mm is None:
        return
    for n in nesneler:
        yeni = duzlem.paralaks_duzelt([n.taban_mm], yukseklik_kestirimi_mm)[0]
        n.taban_mm = tuple(map(float, yeni))
        n.paralaks = f"duzeltildi_h={yukseklik_kestirimi_mm:g}mm"
