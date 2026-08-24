"""Kamera kareleri — yalnızca son N tanesi.

Kareler diske yazılıyor (bellekte tutmak, sunucu her yeniden başladığında
görüntüyü kaybetmek demek) ama **sayısı sınırlı**: her yeni karede en eskisi
siliniyor. 30 saniyede bir kare, sınırsız saklamayla günde 2880 dosya ve
haftada ~800 MB eder; SD kartı doldurmak için fazlasıyla yeterli.

Dosya adı zaman damgası: sıralama, silme ve panelde gösterim bu tek alandan
çıkıyor, ayrı bir dizine ihtiyaç yok.
"""

from __future__ import annotations

import base64
import os
import threading

_KILIT = threading.RLock()

# Kaç kare saklansın? 12 kare, 30 saniyelik aralıkla son 6 dakika demek —
# "az önce ne oldu" sorusuna yeter, disk yükü ~500 KB.
AZAMI_KARE = 12
# Tek karenin üst sınırı: bozuk ya da kötü niyetli bir ajan diski doldurmasın.
AZAMI_BAYT = 3 * 1024 * 1024


def _klasor() -> str:
    veri = os.environ.get("VERI_YOLU")
    kok = os.path.dirname(veri) if veri else os.path.dirname(__file__)
    yol = os.path.join(kok or ".", "kareler")
    os.makedirs(yol, exist_ok=True)
    return yol


def _dosyalar() -> list[str]:
    klasor = _klasor()
    try:
        adlar = [a for a in os.listdir(klasor) if a.endswith(".jpg")]
    except OSError:
        return []
    return sorted(adlar)


def _ad_coz(ad: str) -> dict:
    """Dosya adından damga ve konumu çıkarır.

    Ad biçimi: `<ts>.jpg` ya da `<ts>_<x>_<y>.jpg`. Konumu ayrı bir dizin
    dosyasında tutmak yerine ADIN İÇİNE koyduk: budama sırasında dizinle
    kare listesinin birbirinden ayrı düşme ihtimali kalmıyor, dosyayı silmek
    konumu da siliyor. Eski kareler (konumsuz) aynen okunmaya devam ediyor.
    """
    govde = ad[:-4]
    parca = govde.split("_")
    kayit = {"damga": parca[0], "ts": 0.0, "x": None, "y": None}
    try:
        kayit["ts"] = float(parca[0])
    except ValueError:
        return kayit
    if len(parca) >= 3:
        try:
            kayit["x"] = float(parca[1])
            kayit["y"] = float(parca[2])
        except ValueError:
            pass
    return kayit


def _dosya_bul(damga: str) -> str | None:
    """Damgaya karşılık gelen dosyayı bulur (adın sonunda konum olabilir)."""
    for ad in _dosyalar():
        if ad[:-4].split("_")[0] == damga:
            return ad
    return None


def ekle(b64: str, ts: float, konum: dict | None = None) -> bool:
    if not b64:
        return False
    try:
        ham = base64.b64decode(b64, validate=True)
    except Exception:
        return False
    if not ham or len(ham) > AZAMI_BAYT:
        return False

    klasor = _klasor()
    ad = f"{ts:.0f}.jpg"
    k = konum or {}
    if k.get("x") is not None and k.get("y") is not None:
        # Konum tam sayı mm olarak yazılıyor: dosya adında ondalık nokta,
        # uzantı ayırıcısıyla karışıyor. Bir fotoğrafın çekildiği yer için
        # milimetre altı hassasiyetin zaten anlamı yok.
        ad = f"{ts:.0f}_{round(float(k['x']))}_{round(float(k['y']))}.jpg"
    with _KILIT:
        gecici = os.path.join(klasor, "." + ad + ".tmp")
        with open(gecici, "wb") as dosya:
            dosya.write(ham)
        os.replace(gecici, os.path.join(klasor, ad))

        # Budama yazmadan sonra: önce yazıp sonra silmek, kısa bir an için
        # bir fazla kare demek — tersi ise bir an için hiç kare olmaması.
        fazla = _dosyalar()[:-AZAMI_KARE]
        for eski in fazla:
            try:
                os.unlink(os.path.join(klasor, eski))
            except OSError:
                pass
    return True


def son() -> bytes | None:
    with _KILIT:
        adlar = _dosyalar()
        if not adlar:
            return None
        try:
            with open(os.path.join(_klasor(), adlar[-1]), "rb") as dosya:
                return dosya.read()
        except OSError:
            return None


def getir(damga: str) -> bytes | None:
    # Yol geçişini engelle: yalnızca rakamlardan oluşan damgalar geçerli.
    damga = str(damga).replace(".jpg", "")
    if not damga.isdigit():
        return None
    ad = _dosya_bul(damga)
    if not ad:
        return None
    yol = os.path.join(_klasor(), ad)
    try:
        with open(yol, "rb") as dosya:
            return dosya.read()
    except OSError:
        return None


def liste() -> list[dict]:
    klasor = _klasor()
    cikti = []
    for ad in _dosyalar():
        try:
            boyut = os.path.getsize(os.path.join(klasor, ad))
        except OSError:
            continue
        kayit = _ad_coz(ad)
        if not kayit["ts"]:
            continue
        cikti.append({**kayit, "bayt": boyut})
    return cikti
