"""Kalibrasyon turu — makine noktalara gider, her durakta kare alınır.

BU MODÜL MAKİNEYİ KENDİ SÜRMÜYOR. Hareket ve kare alma işlevlerini siz
veriyorsunuz:

    tur = Tur(git=..., kare_al=..., bulucu=AprilTagBulucu(kimlik=23),
              z_toprak_mm=..., isaret_ofset_mm=...)
    noktalar, rapor = tur.calistir(plan, onay=True)

Neden geri çağırma: sizin hareket API'nizi bilmiyorum ve tahmin etmek,
yanlış bir eksene yanlış bir komut göndermek demek. İki işlevi kendiniz
bağlayın, gerisi buranın işi.

ONAY: makine hareket edecek. `onay=True` verilmeden tek adım atılmaz.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

import numpy as np

from .model import Nokta

Git = Callable[[float, float, float], None]      # (x_mm, y_mm, z_mm)
KareAl = Callable[[], "np.ndarray"]              # -> BGR


def tur_planla(yatak_mm=(495.0, 610.0), nx: int = 4, ny: int = 6,
               pay_mm: float = 40.0,
               z_listesi: Sequence[float] = (0.0, 30.0)) -> list[tuple]:
    """Yılankavi sıra: yatağı en az yolla tarar.

    nx*ny: benzetimde 12 nokta 0.055 mm, 24 nokta 0.050 mm veriyordu —
    12'den sonrası konum doğruluğuna az katıyor, ama fazla nokta
    gürültüye karşı pay bırakıyor. 4x6 = 24 makul.

    z_listesi: EN AZ İKİ farklı yükseklik verin. Tek yükseklikte model
    'duzlem' kalır ve topraktan yüksekteki yaprak kayar — benzetimde
    30 mm boyundaki yaprak 29.75 mm yanlış yerde görünüyordu.
    """
    xs = np.linspace(pay_mm, yatak_mm[0] - pay_mm, int(nx))
    ys = np.linspace(pay_mm, yatak_mm[1] - pay_mm, int(ny))
    plan: list[tuple] = []
    for z in z_listesi:
        for j, y in enumerate(ys):
            sira = xs if j % 2 == 0 else xs[::-1]
            for x in sira:
                plan.append((float(x), float(y), float(z)))
    return plan


@dataclass
class TurRaporu:
    istenen: int = 0
    bulunan: int = 0
    kacirilan: list[dict] = field(default_factory=list)
    sureler_s: dict = field(default_factory=dict)
    uyarilar: list[str] = field(default_factory=list)


class Tur:
    def __init__(self, git: Git, kare_al: KareAl, bulucu,
                 z_toprak_mm: float, isaret_ofset_mm: float,
                 bekleme_s: float = 1.2, deneme: int = 2):
        """
        z_toprak_mm     : probun toprağa DEĞDİĞİ makine Z'si. Ölçün.
        isaret_ofset_mm : işaretin, prob ucu toprağa değerken toprak
                          yüzeyinden yüksekliği. Kumpasla ölçün.

        Bu iki sayı yanlışsa kalibrasyon sessizce yanlış olur: benzetimde
        1 mm yükseklik hatası 0.4 mm konum hatası bırakıyor.

        bekleme_s : hareketten sonra titreşim sönene kadar. Bulanık kare
                    işaretin merkezini kaydırır; kısa tutmayın.
        """
        self.git, self.kare_al, self.bulucu = git, kare_al, bulucu
        self.z_toprak_mm = float(z_toprak_mm)
        self.isaret_ofset_mm = float(isaret_ofset_mm)
        self.bekleme_s = float(bekleme_s)
        self.deneme = int(deneme)

    def yukseklik(self, z_makine: float) -> float:
        """İşaretin toprak yüzeyinden yüksekliği."""
        return (float(z_makine) - self.z_toprak_mm) + self.isaret_ofset_mm

    def calistir(self, plan: Sequence[tuple], onay: bool = False,
                 ilerleme: Callable[[int, int, str], None] | None = None
                 ) -> tuple[list[Nokta], TurRaporu]:
        if not onay:
            raise PermissionError(
                "Bu tur MAKİNEYİ HAREKET ETTİRİR. Yolun boş olduğundan emin "
                "olun ve onay=True geçin.")
        rapor = TurRaporu(istenen=len(plan))
        noktalar: list[Nokta] = []
        t0 = time.time()
        for i, (x, y, z) in enumerate(plan, 1):
            self.git(x, y, z)
            time.sleep(self.bekleme_s)
            bulgu = None
            for _ in range(self.deneme):
                kare = self.kare_al()
                if kare is None:
                    continue
                bulgu = self.bulucu.bul(kare)
                if bulgu is not None:
                    break
                time.sleep(0.4)
            if bulgu is None:
                rapor.kacirilan.append({"x_mm": x, "y_mm": y, "z_mm": z,
                                        "sebep": "işaret bulunamadı"})
            else:
                noktalar.append(Nokta(u_px=bulgu.u_px, v_px=bulgu.v_px,
                                      x_mm=x, y_mm=y, h_mm=self.yukseklik(z),
                                      etiket=bulgu.not_))
            if ilerleme:
                ilerleme(i, len(plan), "bulundu" if bulgu else "kaçtı")
        rapor.bulunan = len(noktalar)
        rapor.sureler_s = {"toplam": round(time.time() - t0, 1),
                           "nokta_basina": round((time.time() - t0)
                                                 / max(1, len(plan)), 2)}
        if rapor.kacirilan:
            rapor.uyarilar.append(
                f"{len(rapor.kacirilan)} noktada işaret bulunamadı. Hepsi "
                "kadrajın aynı kenarındaysa kamera yatağın o kısmını "
                "görmüyordur — kalibrasyon oraya UZATILIR ve orada hatası "
                "ölçülmemiş olur.")
        yuk = {round(self.yukseklik(z), 2) for _, _, z in plan}
        if len(yuk) < 2:
            rapor.uyarilar.append(
                "Tek yükseklik: 'uzay' modeli kurulamaz, paralaks çözülmez.")
        return noktalar, rapor


# --------------------------------------------------------------------------- #
def noktalari_yaz(noktalar: Sequence[Nokta], yol) -> Path:
    """Ham noktaları sakla — modeli yeniden kurmak için tur tekrarlanmasın."""
    import json
    from dataclasses import asdict
    yol = Path(yol); yol.parent.mkdir(parents=True, exist_ok=True)
    yol.write_text(json.dumps([asdict(n) for n in noktalar],
                              ensure_ascii=False, indent=2), encoding="utf-8")
    return yol


def noktalari_oku(yol) -> list[Nokta]:
    import json
    return [Nokta(**d) for d in json.loads(Path(yol).read_text(encoding="utf-8"))]
