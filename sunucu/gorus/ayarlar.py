"""Modül ayarları. Tek JSON dosyasından okunur, panelden düzenlenebilir."""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict, field
from pathlib import Path

KOK = Path(__file__).resolve().parent
VERI = KOK / "veri"


@dataclass
class BolutlemeAyari:
    # ExG = 2g - r - b (normalize kromatiklik). Otsu eşiği bunun üstüne biner.
    otsu_kullan: bool = True
    exg_alt_sinir: float = 0.05        # Otsu çok düşük çıkarsa taban eşik
    lab_a_ust_sinir: float = -3.0      # L*a*b* a* kanalı: yeşil < 0
    lab_agirlik: bool = True           # ExG ∧ a* birlikte istensin mi
    gölge_v_alt: int = 25              # HSV V bunun altı = gölge, elenir
    parlak_v_ust: int = 250            # yanmış piksel, elenir
    acma_px: int = 3                   # morfolojik açma çekirdeği
    kapama_px: int = 5                 # morfolojik kapama çekirdeği


@dataclass
class NesneAyari:
    min_alan_mm2: float = 8.0          # çift kotiledon ~15-30 mm²; altı gürültü
    max_alan_mm2: float = 40000.0      # üstü büyük küme, ayrıca işaretlenir
    watershed_kullan: bool = True      # birbirine değen bitkileri ayır
    watershed_mesafe_orani: float = 0.45
    kenar_payi_mm: float = 5.0         # yatak sınırına bu kadar yakınlar şüpheli
    min_kompaktlik: float = 0.02       # 4πA/P² — halka/çizgi biçimli kalıntıları eler


@dataclass
class EslestirmeAyari:
    # Kayıtlı ekim noktasına bu yarıçap içindeki nesne o bitkinin adayıdır.
    taban_yaricap_mm: float = 25.0
    gunluk_buyume_mm: float = 1.5      # yarıçap yaşla büyür: taban + yaş*bu
    max_yaricap_mm: float = 90.0


@dataclass
class SinifAyari:
    filiz_esigi: float = 0.60          # skor >= bu -> filiz
    yabani_esigi: float = 0.35         # skor <= bu -> yabani, arası belirsiz
    w_konum: float = 0.60              # ekim kaydı ağırlığı (en güçlü sinyal)
    w_gorunum: float = 0.25
    w_zaman: float = 0.15
    min_gorunum_kare: int = 2          # kaç taramada görülürse onaylanır


@dataclass
class KareAyari:
    # Kalibrasyon 3840x2880'de yapıldı; tespit yarı çözünürlükte koşar.
    isleme_genisligi: int = 1920
    kalibrasyon_genisligi: int = 3840
    jpeg_kalitesi: int = 92
    poz_kilitli: bool = True           # picamera2: AeEnable=False, AwbEnable=False


@dataclass
class Ayarlar:
    kalibrasyon_yolu: str = str(VERI / "kalibrasyon.json")
    kare_deposu: str = "/home/batupi/farmbot/veri/kareler"
    db_yolu: str = "/home/batupi/farmbot/veri/gorus.sqlite"
    yatak_mm: tuple[float, float] = (540.0, 645.0)
    # Yatak maskesi sınırdan bu kadar içeri çekilir (kenar sızıntısı için).
    roi_ic_pay_mm: float = 6.0
    kare: KareAyari = field(default_factory=KareAyari)
    bolutleme: BolutlemeAyari = field(default_factory=BolutlemeAyari)
    nesne: NesneAyari = field(default_factory=NesneAyari)
    eslestirme: EslestirmeAyari = field(default_factory=EslestirmeAyari)
    sinif: SinifAyari = field(default_factory=SinifAyari)
    # Kalibrasyon doğrulama: her taramada etiketler yeniden bulunur.
    max_kalibrasyon_artigi_mm: float = 3.0
    gerekli_etiketler: tuple[int, ...] = (0, 1, 8, 9)

    @classmethod
    def yukle(cls, yol: str | Path | None = None) -> "Ayarlar":
        yol = Path(yol or VERI / "ayarlar.json")
        if not yol.exists():
            return cls()
        ham = json.loads(yol.read_text("utf-8"))
        a = cls()
        for k, v in ham.items():
            if not hasattr(a, k):
                continue
            mevcut = getattr(a, k)
            if hasattr(mevcut, "__dataclass_fields__") and isinstance(v, dict):
                for k2, v2 in v.items():
                    if hasattr(mevcut, k2):
                        setattr(mevcut, k2, v2)
            else:
                setattr(a, k, v)
        return a

    def kaydet(self, yol: str | Path | None = None) -> Path:
        yol = Path(yol or VERI / "ayarlar.json")
        yol.parent.mkdir(parents=True, exist_ok=True)
        yol.write_text(json.dumps(asdict(self), indent=2, ensure_ascii=False), "utf-8")
        return yol
