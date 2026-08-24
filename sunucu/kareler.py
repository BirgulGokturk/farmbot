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


def ekle(b64: str, ts: float) -> bool:
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
    yol = os.path.join(_klasor(), damga + ".jpg")
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
        cikti.append({"damga": ad[:-4], "ts": float(ad[:-4]), "bayt": boyut})
    return cikti
