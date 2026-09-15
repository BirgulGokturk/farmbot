"""olcum — `gorus` ölçüm katmanının sunucuya bağlandığı tek yer.

Katman şunu YAPMIYOR: kendi tespitini. Yeşil maske, piksel→mm ve kümeleme
`filiz.py`de; buradan geçen tespitler onun çıktısı. İkinci bir tespit hattı
aynı yatak için birbirini tutmayan iki cevap üretirdi — paketin kendi
OKUBENI dosyası da bunu söylüyor.

Katmanın yaptığı: ekim kaydıyla eşleştirme (Macar algoritması), filiz /
yabani / belirsiz kararı, taramalar arası izleme ve büyüme, örtü ölçümü,
görsel ve SQLite arşiv.

EKİM KAYDI `noktalar.py`den geliyor, `bitki.veri()`den DEĞİL. Paketin
örneği `bitki.veri()` diyor ama bu depoda o işlev sulama süresi ve nem
eğilimi döndürüyor; koordinat taşımıyor. Bitkinin x/y'si noktalarda.

KAYIT KİMLİĞİ ADIN CRC32'Sİ. Liste sırası kimlik olamaz: bir bitki
silinince bütün kimlikler kayar ve arşivdeki geçmiş başka bitkiye bağlanır.
"""

from __future__ import annotations

import base64
import os
import zlib
from typing import Any

import filiz
import kalibrasyon

#: Yatak ölçüsü hiç dikim alanı tanımlı değilse. Örtü yüzdesinin paydası
#: bu; uydurulmuş bir payda "kapsama %12" gibi anlamlı görünen ama
#: dayanaksız bir sayı üretir.
VARSAYILAN_YATAK_MM = (540.0, 645.0)


def _veri_dizin() -> str:
    """`noktalar.py` ve `kalibrasyon.py` ile aynı klasör (`~/farmbot-veri`)."""
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.dirname(veri) or "."
    return os.path.dirname(os.path.abspath(__file__))


def _db_yolu() -> str:
    ozel = os.environ.get("OLCUM_VERITABANI")
    return ozel or os.path.join(_veri_dizin(), "olcum.sqlite")


def _gorsel_dizin() -> str:
    return os.path.join(_veri_dizin(), "olcum")


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        return float(deger)
    except (TypeError, ValueError):
        return varsayilan


def kimlik(ad: str) -> int:
    """Bitki adından KARARLI tamsayı kimlik."""
    return zlib.crc32(str(ad).encode("utf-8")) & 0x7FFFFFFF


def ekim_kayitlari() -> tuple[list[dict[str, Any]], dict[int, str]]:
    """Türü olan noktalar = ekilmiş bitkiler. -> (ham kayıtlar, kimlik→ad)."""
    import noktalar

    ham: list[dict[str, Any]] = []
    adlar: dict[int, str] = {}
    for n in noktalar.hepsi():
        if not n.get("tur"):
            continue
        ad = str(n.get("ad") or "")
        if not ad:
            continue
        k = kimlik(ad)
        adlar[k] = ad
        ham.append({**n, "id": k})
    return ham, adlar


def yatak_olcusu() -> tuple[float, float]:
    """Dikim alanlarının kapladığı en uzak köşe. Örtü yüzdesinin paydası."""
    try:
        import dikim
        alanlar = dikim.listele()
    except Exception:                                       # noqa: BLE001
        alanlar = []
    if not alanlar:
        return VARSAYILAN_YATAK_MM
    en = max(_sayi(a.get("x2")) for a in alanlar)
    boy = max(_sayi(a.get("y2")) for a in alanlar)
    if en <= 0 or boy <= 0:
        return VARSAYILAN_YATAK_MM
    return (en, boy)


def _harita_baglayici(kalib: dict[str, Any] | None):
    """`cizim` için mm↔piksel çifti. Harita yoksa (None, sebep).

    Görsel yalnız HOMOGRAFİ varken çiziliyor. Ölçek+dönme modelinde mm→px
    tersi tek bir sayıya dayanır ve eğik kamerada ızgara toprağa oturmaz;
    oturmayan bir ızgara "kalibrasyon bozuk" diye okunur, oysa bozuk olan
    çizimdir.
    """
    import tespit

    H = tespit.harita(kalib)
    if H is None:
        return None, "Bu kamerada homografi yok — görsel çizilmiyor (ölçüm sürüyor)."
    try:
        import numpy as np
    except ImportError:
        return None, "numpy yok — görsel çizilemedi."

    def mm_to_piksel(noktalar):
        d = np.asarray(noktalar, dtype=float).reshape(-1, 2)
        return np.array([kalibrasyon.harita_geri(H, float(x), float(y))
                         for x, y in d], dtype=float)

    def piksel_to_mm(noktalar):
        d = np.asarray(noktalar, dtype=float).reshape(-1, 2)
        return np.array([kalibrasyon.harita_uygula(H, float(u), float(v))
                         for u, v in d], dtype=float)

    return (mm_to_piksel, piksel_to_mm), ""


def _bgr_coz(jpeg: bytes):
    """JPEG -> OpenCV BGR. cv2 yoksa None."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return None
    dizi = np.frombuffer(jpeg, dtype=np.uint8)
    return cv2.imdecode(dizi, cv2.IMREAD_COLOR)


def calistir(f: dict[str, Any], *, gorsel: bool = True,
             arsivle: bool = True) -> dict[str, Any]:
    """`filiz.tara` çıktısını ölçüm katmanından geçirir. Eşzamanlı."""
    from gorus import cizim as _cizim
    from gorus.tarama import Tarama

    ham_kayitlar, adlar = ekim_kayitlari()
    yatak = yatak_olcusu()

    kalib = kalibrasyon.oku(f.get("kamera") or "")
    baglayici, gorsel_notu = _harita_baglayici(kalib)

    kare = kare_yolu = harita = None
    if gorsel and baglayici is not None:
        ham = (f.get("kare") or "").split(",", 1)
        jpeg = base64.b64decode(ham[1]) if len(ham) == 2 else b""
        kare = _bgr_coz(jpeg) if jpeg else None
        if kare is None:
            gorsel_notu = "OpenCV (cv2) yok — görsel çizilemedi, ölçüm sürüyor."
        else:
            mm_to_px, px_to_mm = baglayici
            harita = _cizim.harita_kur(mm_to_piksel=mm_to_px,
                                       piksel_to_mm=px_to_mm, yatak_mm=yatak)
            os.makedirs(_gorsel_dizin(), exist_ok=True)
            kare_yolu = os.path.join(_gorsel_dizin(), "son.jpg")

    t = Tarama(db_yolu=_db_yolu(), yatak_mm=yatak)
    sonuc = t.calistir(
        ham_tespitler=f.get("fideler") or [],
        ham_kayitlar=ham_kayitlar,
        kare=kare,
        harita=harita,
        kare_yolu=kare_yolu,
        gorsel_dizin=_gorsel_dizin(),
        arsivle=arsivle,
    )

    # Kimlikler panelde ada dönüyor: kullanıcı "kayıt 1837291044" değil
    # "fesleğen 3" görüyor.
    sonuc["kayit_adlari"] = {str(k): a for k, a in adlar.items()}
    sonuc["bos_kayit_adlari"] = [adlar.get(k, str(k))
                                 for k in (sonuc.get("bos_kayitlar") or [])]
    for d in sonuc.get("tespitler") or []:
        d["kayit_ad"] = adlar.get(d.get("kayit_id")) if d.get("kayit_id") else None
    sonuc["yatak_mm"] = list(yatak)
    sonuc["gorsel_notu"] = gorsel_notu
    for a in ("gorsel_yolu", "ustten_yolu"):
        if sonuc.get(a):
            sonuc[a] = os.path.basename(sonuc[a])
    return sonuc


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def yonlendirici_kur(parola_dogrula, canli_kare):
    import asyncio

    from fastapi import APIRouter, HTTPException, Query
    from fastapi.responses import FileResponse

    yon = APIRouter()

    @yon.post("/api/bitkiolcum/tara")
    async def _tara(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        parola_dogrula(jeton)
        g = govde or {}
        try:
            import gorus  # noqa: F401
        except ImportError as hata:
            raise HTTPException(status_code=503,
                                detail=f"Ölçüm katmanı yüklenemedi: {hata}")

        f = await filiz.tara(g, canli_kare)
        try:
            sonuc = await asyncio.to_thread(
                calistir, f,
                gorsel=bool(g.get("gorsel", True)),
                arsivle=bool(g.get("arsivle", True)))
        except ImportError as hata:
            raise HTTPException(status_code=503,
                                detail=f"Ölçüm katmanının bağımlılığı eksik: {hata}")
        except Exception as hata:                           # noqa: BLE001
            raise HTTPException(status_code=500,
                                detail=f"{type(hata).__name__}: {hata}")

        f.pop("kare", None)      # taban64 kare iki kez gitmesin
        return {"olcum": sonuc, "filiz": f}

    @yon.get("/api/bitkiolcum/gecmis")
    async def _gecmis(gun: int = Query(default=30), jeton: str = Query(default="")):
        parola_dogrula(jeton)
        try:
            from gorus.depo import Depo
        except ImportError as hata:
            raise HTTPException(status_code=503, detail=str(hata))
        d = Depo(_db_yolu())
        _, adlar = ekim_kayitlari()
        return {"seri": d.zaman_serisi(max(1, int(gun))),
                "son": d.son_tarama(),
                "kayit_adlari": {str(k): a for k, a in adlar.items()}}

    @yon.post("/api/bitkiolcum/etiketle")
    async def _etiketle(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        """İnsan etiketi — 'belirsiz' üzerinde otomatik iş yapılmıyor, soruluyor."""
        parola_dogrula(jeton)
        g = govde or {}
        etiket = str(g.get("etiket") or "").strip()
        if etiket not in ("filiz", "yabani", "belirsiz"):
            raise HTTPException(status_code=422,
                                detail="etiket: filiz, yabani ya da belirsiz olmalı")
        try:
            from gorus.depo import Depo
        except ImportError as hata:
            raise HTTPException(status_code=503, detail=str(hata))
        import datetime as dt
        zaman = dt.datetime.now().astimezone().isoformat(timespec="seconds")
        d = Depo(_db_yolu())
        if g.get("tespit_id") is not None:
            d.insan_etiketle(int(g["tespit_id"]), etiket, zaman)
        elif g.get("tarama_id") is not None and g.get("tespit_no") is not None:
            d.gorselden_etiketle(int(g["tarama_id"]), int(g["tespit_no"]),
                                 etiket, zaman)
        else:
            raise HTTPException(status_code=422,
                                detail="tespit_id ya da (tarama_id, tespit_no) gerekli")
        return {"tamam": True}

    @yon.get("/api/bitkiolcum/gorsel")
    async def _gorsel(ad: str = Query(default=""), jeton: str = Query(default="")):
        parola_dogrula(jeton)
        ad = os.path.basename(str(ad or ""))
        if not ad.endswith(".jpg"):
            raise HTTPException(status_code=422, detail="Yalnız .jpg")
        yol = os.path.join(_gorsel_dizin(), ad)
        if not os.path.exists(yol):
            raise HTTPException(status_code=404, detail="Görsel yok")
        return FileResponse(yol, media_type="image/jpeg")

    return yon
