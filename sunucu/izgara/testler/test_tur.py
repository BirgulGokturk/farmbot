"""Uçtan uca: sahte makine + sahte kamera ile tam kalibrasyon turu.

Kare gerçekten çiziliyor ve işaret gerçekten aranıyor — böylece işaret
bulucunun alt piksel doğruluğu da ölçüme giriyor, varsayılmıyor.

    python3 -m izgara.testler.test_tur
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from izgara.isaret import AprilTagBulucu
from izgara.model import Nokta, kur, dogrula, capraz_dogrula
from izgara.testler.benzetim import SanalKamera, rastgele_mm
from izgara.tur import Tur, tur_planla

ETIKET_KIMLIK = 23
ETIKET_MM = 34.0          # kafadaki etiketin kenar uzunluğu
Z_TOPRAK = -140.0         # probun toprağa değdiği makine Z'si
ISARET_OFSET = 62.0       # prob toprağa değerken etiketin yüksekliği


def etiket_resmi(kenar_px=420):
    d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_APRILTAG_36h11)
    im = cv2.aruco.generateImageMarker(d, ETIKET_KIMLIK, kenar_px)
    pay = int(kenar_px * 0.3)
    kagit = np.full((kenar_px + 2 * pay, kenar_px + 2 * pay), 240, np.uint8)
    kagit[pay:pay + kenar_px, pay:pay + kenar_px] = im
    return cv2.cvtColor(kagit, cv2.COLOR_GRAY2BGR), pay


class SahteDunya:
    """Makine bir yere gidiyor, kamera o yerde etiketi görüyor."""

    def __init__(self, kam: SanalKamera):
        self.kam = kam
        self.etiket, self.pay = etiket_resmi()
        self.konum = (0.0, 0.0, 0.0)
        self.rng = np.random.default_rng(7)

    def git(self, x, y, z):
        # makine tekrarlanabilirliği: 0.3 mm sigma
        self.konum = (x + self.rng.normal(0, 0.3),
                      y + self.rng.normal(0, 0.3), z)

    def kare_al(self):
        x, y, z = self.konum
        h = (z - Z_TOPRAK) + ISARET_OFSET
        yari = ETIKET_MM / 2.0
        dunya = np.array([[x - yari, y - yari], [x + yari, y - yari],
                          [x + yari, y + yari], [x - yari, y + yari]])
        hedef = self.kam.px(dunya, h_mm=h).astype(np.float32)
        t = self.etiket.shape[0]
        p = self.pay
        kaynak = np.float32([[p, p], [t - p, p], [t - p, t - p], [p, t - p]])
        # Bu kamera modelinde dünya->görüntü dönüşümü sarım yönünü çeviriyor;
        # düzeltilmezse etiket AYNA görünür ve hiçbir sözlükte çözülmez.
        # (Gerçek kamerada böyle bir şey yok, bu yalnız çizim ayrıntısı.)
        alan = 0.5 * sum(hedef[i][0]*hedef[(i+1) % 4][1]
                         - hedef[(i+1) % 4][0]*hedef[i][1] for i in range(4))
        if alan < 0:
            hedef = hedef[[1, 0, 3, 2]]
        H = cv2.getPerspectiveTransform(kaynak, hedef)
        zemin = np.full((self.kam.kare[1], self.kam.kare[0], 3), 92, np.uint8)
        zemin[:, :, 2] = 118
        cv2.randn(zemin2 := np.zeros_like(zemin), 0, 9)
        zemin = cv2.add(zemin, zemin2)
        kare = cv2.warpPerspective(self.etiket, H, self.kam.kare, dst=zemin,
                                   borderMode=cv2.BORDER_TRANSPARENT)
        return cv2.GaussianBlur(kare, (3, 3), 0)


def main() -> int:
    kam = SanalKamera()
    dunya = SahteDunya(kam)
    tur = Tur(git=dunya.git, kare_al=dunya.kare_al,
              bulucu=AprilTagBulucu(kimlik=ETIKET_KIMLIK),
              z_toprak_mm=Z_TOPRAK, isaret_ofset_mm=ISARET_OFSET,
              bekleme_s=0.0, deneme=1)

    plan = tur_planla(nx=4, ny=6, z_listesi=(Z_TOPRAK - ISARET_OFSET,
                                             Z_TOPRAK - ISARET_OFSET + 30.0))
    print(f"plan: {len(plan)} durak, yükseklikler "
          f"{sorted({round(tur.yukseklik(z),1) for _,_,z in plan})} mm")

    noktalar, rapor = tur.calistir(plan, onay=True)
    print(f"tur: {rapor.bulunan}/{rapor.istenen} noktada işaret bulundu")
    for u in rapor.uyarilar:
        print("  uyarı:", u)
    if rapor.bulunan < 12:
        print("YETERSİZ NOKTA"); return 1

    model = kur(noktalar, kam.kare)
    print(f"\nmodel: {model.tur}, ölçek {model.rapor['olcek_mm_px_en_kucuk']}-"
          f"{model.rapor['olcek_mm_px_en_buyuk']} mm/px "
          f"(%{model.rapor['olcek_degisimi_yuzde']} değişim)")
    print("kendi artığı (doğruluk DEĞİL):",
          model.rapor["kendi_artigi_rms_mm"], "mm")
    cd = capraz_dogrula(noktalar, kam.kare)
    print("çapraz doğrulama rms:", cd.get("rms_mm"), "mm")

    print(f"\n{'yaprak yüksekliği':>18s} {'bağımsız rms':>13s} {'maks':>8s} "
          f"{'sistematik kayma':>18s}")
    tamam = True
    for h in (0.0, 10.0, 25.0, 40.0):
        TEST = rastgele_mm(30, tohum=5)
        px = kam.px(TEST, h_mm=h)
        kontrol = [Nokta(float(a), float(b), float(c), float(d), h)
                   for (a, b), (c, d) in zip(px, TEST)]
        r = dogrula(model, kontrol)
        print(f"{h:15.0f} mm {r['rms_mm']:13.3f} {r['maks_mm']:8.3f} "
              f"{str(r['sistematik_kayma_mm']):>18s}")
        if r["rms_mm"] > 1.0:
            tamam = False

    print("\n" + ("TUM KONTROLLER GECTI" if tamam
                  else "KALDI: 1 mm üstünde hata var"))
    return 0 if tamam else 1


if __name__ == "__main__":
    raise SystemExit(main())
