"""Kamera kareleri — her kamera için ayrı halka, yalnızca son N tanesi.

Kareler diske yazılıyor (bellekte tutmak, sunucu her yeniden başladığında
görüntüyü kaybetmek demek) ama **sayısı sınırlı**: her yeni karede en eskisi
siliniyor. 30 saniyede bir kare, sınırsız saklamayla günde 2880 dosya ve
haftada ~800 MB eder; SD kartı doldurmak için fazlasıyla yeterli.

Dosya adı zaman damgası: sıralama, silme ve panelde gösterim bu tek alandan
çıkıyor, ayrı bir dizine ihtiyaç yok.

KAMERA BAŞINA KLASÖR — `kareler/<kamera>/<damga>[_x_y].jpg`. İki sebep:

  1. **Halka ayrı olmalı.** Ortak bir 12'lik halkada, 5 saniyede bir kare
     alan üst kamera, uç kamerasının bütün karelerini bir dakikada siler.
     Kullanıcının gözünde "uç kamerasının kareleri kayboluyor" olurdu ve
     sebebi hiçbir yerde yazmazdı.
  2. **Kare kimin, belli olmalı.** Çözümlemede kullanılacak mm/px kamera
     başına ayrı; hangi kameranın karesi olduğu bilinmeden doğru ölçek
     seçilemez. Klasör adı bu bilgiyi dosyanın kendisinde tutuyor.

Eski (tek kameralı) düz yerleşimdeki dosyalar ilk erişimde `uc/` altına
TAŞINIYOR — kimse elle bir şey yapmıyor, eski kareler kaybolmuyor.
"""

from __future__ import annotations

import base64
import os
import re
import shutil
import threading

_KILIT = threading.RLock()

# Kaç kare saklansın? 12 kare, 30 saniyelik aralıkla son 6 dakika demek —
# "az önce ne oldu" sorusuna yeter, disk yükü ~500 KB. Sınır KAMERA BAŞINA.
AZAMI_KARE = 12
# Tek karenin üst sınırı: bozuk ya da kötü niyetli bir ajan diski doldurmasın.
AZAMI_BAYT = 3 * 1024 * 1024

#: Kamera adı bir klasör adı oluyor: yol geçişine ("../") kapalı olmalı.
AD_BICIMI = re.compile(r"^[a-z0-9_-]{1,24}$")
VARSAYILAN_KAMERA = "uc"

_TASINDI = False


def ad_temizle(ham) -> str:
    """Kamera adını klasör adı olarak güvenli hâle getirir."""
    metin = str(ham or "").strip().lower()
    metin = "".join(h for h in metin if h.isalnum() or h in "_-")[:24]
    return metin if AD_BICIMI.match(metin) else VARSAYILAN_KAMERA


def _kok() -> str:
    veri = os.environ.get("VERI_YOLU")
    kok = os.path.dirname(veri) if veri else os.path.dirname(__file__)
    yol = os.path.join(kok or ".", "kareler")
    os.makedirs(yol, exist_ok=True)
    return yol


def _eskiyi_tasi() -> None:
    """Düz yerleşimdeki eski kareleri `uc/` altına taşır. Bir kez."""
    global _TASINDI
    if _TASINDI:
        return
    kok = _kok()
    try:
        duz = [a for a in os.listdir(kok) if a.endswith(".jpg")
               and os.path.isfile(os.path.join(kok, a))]
    except OSError:
        _TASINDI = True
        return
    if duz:
        hedef = os.path.join(kok, VARSAYILAN_KAMERA)
        os.makedirs(hedef, exist_ok=True)
        for ad in duz:
            try:
                shutil.move(os.path.join(kok, ad), os.path.join(hedef, ad))
            except OSError:
                pass
    _TASINDI = True


def _klasor(kamera: str = VARSAYILAN_KAMERA, olustur: bool = False) -> str:
    """Kameranın klasörü. OKURKEN OLUŞTURMUYOR: adı yanlış yazılmış bir
    istek, diskte boş bir klasör bırakıp kamera listesine hayalet eklemesin."""
    with _KILIT:
        _eskiyi_tasi()
        yol = os.path.join(_kok(), ad_temizle(kamera))
        if olustur:
            os.makedirs(yol, exist_ok=True)
        return yol


def kameralar() -> list[str]:
    """Karesi olan kamera adları."""
    with _KILIT:
        _eskiyi_tasi()
        kok = _kok()
        try:
            return sorted(a for a in os.listdir(kok)
                          if AD_BICIMI.match(a) and os.path.isdir(os.path.join(kok, a)))
        except OSError:
            return []


def _dosyalar(kamera: str = VARSAYILAN_KAMERA) -> list[str]:
    klasor = _klasor(kamera)
    try:
        adlar = [a for a in os.listdir(klasor) if a.endswith(".jpg")]
    except OSError:
        return []
    return sorted(adlar)


def _ad_coz(ad: str, kamera: str) -> dict:
    """Dosya adından damga ve konumu çıkarır.

    Ad biçimi: `<ts>.jpg` ya da `<ts>_<x>_<y>.jpg`. Konumu ayrı bir dizin
    dosyasında tutmak yerine ADIN İÇİNE koyduk: budama sırasında dizinle
    kare listesinin birbirinden ayrı düşme ihtimali kalmıyor, dosyayı silmek
    konumu da siliyor. Eski kareler (konumsuz) aynen okunmaya devam ediyor.

    Konumun BOŞ olması iki farklı şey demek olabiliyor: PLC kopukken çekilmiş
    bir uç karesi ya da zaten konumu olmayan sabit kamera karesi. Ayrımı
    kameranın kendisi biliyor (`hareketli`); burası yalnız olguyu yazıyor.
    """
    govde = ad[:-4]
    parca = govde.split("_")
    kayit = {"damga": parca[0], "ts": 0.0, "x": None, "y": None, "kamera": kamera}
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


def _dosya_bul(damga: str, kamera: str) -> str | None:
    """Damgaya karşılık gelen dosyayı bulur (adın sonunda konum olabilir)."""
    for ad in _dosyalar(kamera):
        if ad[:-4].split("_")[0] == damga:
            return ad
    return None


def ekle(b64: str, ts: float, konum: dict | None = None,
         kamera: str = VARSAYILAN_KAMERA) -> bool:
    if not b64:
        return False
    try:
        ham = base64.b64decode(b64, validate=True)
    except Exception:
        return False
    if not ham or len(ham) > AZAMI_BAYT:
        return False

    kam = ad_temizle(kamera)
    klasor = _klasor(kam, olustur=True)
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
        # Budama YALNIZ bu kameranın klasöründe: bir kameranın hızlı çekmesi
        # ötekinin geçmişini silmemeli.
        fazla = _dosyalar(kam)[:-AZAMI_KARE]
        for eski in fazla:
            try:
                os.unlink(os.path.join(klasor, eski))
            except OSError:
                pass
    return True


def son(kamera: str = VARSAYILAN_KAMERA) -> bytes | None:
    kam = ad_temizle(kamera)
    with _KILIT:
        adlar = _dosyalar(kam)
        if not adlar:
            return None
        try:
            with open(os.path.join(_klasor(kam), adlar[-1]), "rb") as dosya:
                return dosya.read()
        except OSError:
            return None


def son_kayit(kamera: str = VARSAYILAN_KAMERA) -> dict | None:
    """Son karenin künyesi — damga, konum, kamera."""
    kam = ad_temizle(kamera)
    with _KILIT:
        adlar = _dosyalar(kam)
        if not adlar:
            return None
        return _ad_coz(adlar[-1], kam)


def getir(damga: str, kamera: str = VARSAYILAN_KAMERA) -> bytes | None:
    # Yol geçişini engelle: yalnızca rakamlardan oluşan damgalar geçerli.
    damga = str(damga).replace(".jpg", "")
    if not damga.isdigit():
        return None
    kam = ad_temizle(kamera)
    ad = _dosya_bul(damga, kam)
    if not ad:
        return None
    yol = os.path.join(_klasor(kam), ad)
    try:
        with open(yol, "rb") as dosya:
            return dosya.read()
    except OSError:
        return None


def liste(kamera: str | None = None) -> list[dict]:
    """Kare künyeleri. `kamera` verilmezse HEPSİ (her kaydın içinde adı var)."""
    adlar = [ad_temizle(kamera)] if kamera else (kameralar() or [VARSAYILAN_KAMERA])
    cikti = []
    for kam in adlar:
        klasor = _klasor(kam)
        for ad in _dosyalar(kam):
            try:
                boyut = os.path.getsize(os.path.join(klasor, ad))
            except OSError:
                continue
            kayit = _ad_coz(ad, kam)
            if not kayit["ts"]:
                continue
            cikti.append({**kayit, "bayt": boyut})
    cikti.sort(key=lambda k: k["ts"])
    return cikti
