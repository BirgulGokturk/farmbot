"""
girdi — filiz.py'nin çıktısını ölçüm katmanının anlayacağı biçime çevirir.

TASARIM KURALI: bu paket KENDİ TESPİTİNİ YAPMAZ. Yeşil maske, bölütleme ve
piksel→mm dönüşümü sunucuda zaten var (filiz.py + kalibrasyon.py). İkinci bir
tespit hattı, aynı yatak için birbiriyle çelişen iki cevap üretir.

Buradaki adaptör, filiz.py ne döndürüyorsa ondan alan adlarını sezerek
`Tespit` üretir. Hiçbir alan adı tutmazsa GÖRDÜĞÜ ANAHTARLARI yazan bir hata
verir — sessizce yanlış koordinat üretmez.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict

_X = ("x_mm", "x", "X", "mm_x", "konum_x")
_Y = ("y_mm", "y", "Y", "mm_y", "konum_y")
_ALAN = ("alan_mm2", "alan", "area_mm2", "alan_mm", "yaprak_alani")
_CAP = ("cap_mm", "cap", "capraz_mm", "esdeger_cap")
_PIKSEL = ("piksel", "px", "merkez_px", "piksel_merkez")
_ID = ("id", "no", "kimlik", "idx", "sira")


@dataclass
class Tespit:
    """Tek bir yeşil nesne. Koordinat MAKİNE mm'sinde."""
    id: int
    x_mm: float
    y_mm: float
    alan_mm2: float | None = None
    cap_mm: float | None = None
    piksel: tuple[float, float] | None = None
    kontur_piksel: list | None = field(default=None, repr=False)
    ek: dict = field(default_factory=dict)     # filiz.py'den gelen diğer alanlar

    @property
    def mm(self) -> tuple[float, float]:
        return (self.x_mm, self.y_mm)

    def sozluk(self, kontur_dahil=False) -> dict:
        d = asdict(self)
        if not kontur_dahil:
            d.pop("kontur_piksel", None)
        return d


def _al(k: dict, adaylar, varsayilan=None):
    for a in adaylar:
        if a in k and k[a] is not None:
            return k[a]
    return varsayilan


class GirdiHatasi(ValueError):
    pass


def tespitlere_cevir(ham, *, donusturucu=None) -> list[Tespit]:
    """
    ham: filiz.py'nin döndürdüğü liste ya da {"tespitler": [...]} sözlüğü.
    donusturucu: kendi çeviricinizi verirseniz sezgi atlanır.
    """
    if donusturucu is not None:
        return list(donusturucu(ham))
    if ham is None:
        return []
    if isinstance(ham, dict):
        for anahtar in ("tespitler", "filizler", "nesneler", "bitkiler", "sonuc"):
            if isinstance(ham.get(anahtar), list):
                ham = ham[anahtar]
                break
        else:
            ham = [{**v, "id": k} if isinstance(v, dict) else v
                   for k, v in ham.items()]

    cikti, gorulen = [], set()
    for i, t in enumerate(ham):
        if not isinstance(t, dict):
            t = getattr(t, "__dict__", None) or {}
        gorulen.update(t.keys())
        x, y = _al(t, _X), _al(t, _Y)
        if x is None or y is None:
            continue
        piksel = _al(t, _PIKSEL)
        if piksel is not None:
            try:
                piksel = (float(piksel[0]), float(piksel[1]))
            except (TypeError, ValueError, IndexError):
                piksel = None
        alan = _al(t, _ALAN)
        cap = _al(t, _CAP)
        bilinen = set(_X) | set(_Y) | set(_ALAN) | set(_CAP) | set(_PIKSEL) | set(_ID)
        cikti.append(Tespit(
            id=int(_al(t, _ID, i)), x_mm=float(x), y_mm=float(y),
            alan_mm2=float(alan) if alan is not None else None,
            cap_mm=float(cap) if cap is not None else None,
            piksel=piksel,
            kontur_piksel=t.get("kontur_piksel") or t.get("kontur"),
            ek={k: v for k, v in t.items() if k not in bilinen},
        ))

    if ham and not cikti:
        raise GirdiHatasi(
            "Tespitlerde mm koordinatı bulunamadı. Görülen anahtarlar: "
            f"{sorted(gorulen)}. Denenen adlar X için {_X}, Y için {_Y}. "
            "Biçiminiz farklıysa tespitlere_cevir(donusturucu=...) geçin.")
    return cikti


def eksik_alanlar(tespitler: list[Tespit]) -> dict:
    """
    Hangi öznitelikler gelmedi? Sınıflandırma bunlara göre kendini kısıyor;
    eksikse uydurmak yerine o kanıtı nötr sayıyor.
    """
    if not tespitler:
        return {"tespit": 0}
    return {
        "tespit": len(tespitler),
        "alan_mm2_yok": sum(1 for t in tespitler if t.alan_mm2 is None),
        "cap_mm_yok": sum(1 for t in tespitler if t.cap_mm is None),
        "piksel_yok": sum(1 for t in tespitler if t.piksel is None),
        "kontur_yok": sum(1 for t in tespitler if not t.kontur_piksel),
        "ek_alanlar": sorted({k for t in tespitler for k in t.ek}),
    }
