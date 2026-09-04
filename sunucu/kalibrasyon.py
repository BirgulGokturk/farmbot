"""Kamera kalibrasyonu — fotoğrafı haritaya oturtan sayılar. KAMERA BAŞINA.

**mm_px her kamera için ayrıdır ve paylaşılamaz.** Uç kamerası yatağa 20-30
cm mesafede, bir pikseli yarım milimetre; sabit üst kamera iki metre
yukarıdan yatağın tamamını görüyor, bir pikseli birkaç milimetre. Aynı sayıyı
ikisine birden uygulamak, ölçüleri kat kat yanlış yapar — ve yanlış olduğu
belli olmaz, çünkü sonuç yine "milimetre" diye yazılır. Bu yüzden kayıt
kamera adına göre tutuluyor ve çözümleme, karenin GELDİĞİ kameranın sayısını
kullanıyor.

ÖLÇÜM YOLU TEK: APRILTAG (`etiket.py`)
--------------------------------------
Eskiden iki tıklama yöntemi vardı — "iki kare" (hareketli kamera) ve "ölçek"
(sabit kamera). İkisi de kullanıcının bir piksele tıklamasına dayanıyordu;
tıklama 3-5 piksel şaşıyor ve o şaşma bütün kareye yayılıyor. AprilTag'in
dört köşesi alt piksel hassasiyetiyle bulunuyor ve aynı iki bilgiyi
(ölçek, ve konumu bilinen etiketler varsa yerleşim) daha iyi veriyor.
İkisi de KALDIRILDI; elle sayı girmek duruyor, çünkü ölçüleni görmenin ve
gerektiğinde bir değeri zorlamanın yolu o.

İki model tutuluyor ve ikisi de aynı dosyada:

    mm_px / donme / ofset_x / ofset_y / ayna_x / ayna_y
        Benzerlik modeli. Kameranın yatağa DİK baktığını varsayıyor.
        Haritayı okumayan eski yerler bunu kullanmaya devam ediyor.

    harita (3x3 homografi)
        Perspektifi de taşıyor. Eğik bakan kamerada sahada ölçüldü:
        benzerlik 52 mm, harita 9 mm yanılıyordu. Varsa bu kazanıyor.

Neden JSON: nokta deposuyla aynı gerekçe — küçük, bütün okunup bütün yazılan
bir veri. Gerekçenin tamamı `noktalar.py` başında.
"""

from __future__ import annotations

import json
import math
import os
import re
import tempfile
import threading
from typing import Any

_KILIT = threading.RLock()

#: Kamera adı — `kareler.py` ile AYNI biçim. İkisi ayrışırsa bir kameranın
#: kareleri bir adla, kalibrasyonu başka bir adla saklanır ve eşleşmez.
AD_BICIMI = re.compile(r"^[a-z0-9_-]{1,24}$")
VARSAYILAN_KAMERA = "uc"


def ad_temizle(ham: Any) -> str:
    metin = str(ham or "").strip().lower()
    metin = "".join(h for h in metin if h.isalnum() or h in "_-")[:24]
    return metin if AD_BICIMI.match(metin) else VARSAYILAN_KAMERA


VARSAYILAN: dict[str, Any] = {
    "mm_px": 0.0,          # 0 = daha kalibre edilmedi
    "donme": 0.0,
    "ofset_x": 0.0,
    "ofset_y": 0.0,
    "ayna_x": False,
    "ayna_y": False,
    "genislik_px": 640,
    "yukseklik_px": 480,
    "guncelleme": 0.0,      # son kalibrasyon zamanı (unix)
    "yontem": "",           # "elle" | "etiket" (AprilTag) | "oto" (otokalib)
    # PİKSEL → MİLİMETRE HARİTASI (3x3 homografi). `mm_px`/`donme`/`ofset`
    # üçlüsü kameranın yatağa DİK baktığını varsayıyor; eğik bakan bir
    # kamerada bu varsayım sahada 52 mm hata verdi. Harita perspektifi de
    # taşıyor ve aynı ölçümde hatayı 9 mm'ye indirdi.
    #
    # Boş bırakılabilir: yoksa eski üçlü aynen geçerli ve hiçbir kurulum
    # değişmiyor. Harita VARSA ondan türetilen üçlü de yazılıyor, böylece
    # haritayı okumayan yerler bozulmadan çalışmaya devam ediyor.
    "harita": None,
    # Haritanın ölçülen sapması (mm) ve kaç noktadan çıktığı. Sayı
    # olmadan "kalibre" demek, ne kadar yanlış olduğunu bilmemek demek.
    "harita_sapma_mm": None,
    "harita_nokta": 0,
    # HARİTA HANGİ MAKİNE KONUMUNDA ÖLÇÜLDÜ.
    #
    # Harita, piksel → YATAK MİLİMETRESİ veriyor. Sabit kamerada bu mutlak:
    # kamera hiç oynamıyor, aynı piksel hep aynı yeri gösteriyor, kaydın
    # burası boş (None) kalıyor.
    #
    # Hareketli (uç) kamerada aynı harita yalnız ÖLÇÜLDÜĞÜ konumda geçerli;
    # makine 100 mm sağa gidince bütün kare 100 mm sağı gösteriyor. O yüzden
    # ölçüm anındaki makine konumu da yazılıyor ve okuyan taraf kareyle
    # arasındaki farkı ekliyor. Yazılmamışsa harita hareketli kamerada
    # KULLANILMIYOR — kaydırmayı tahmin etmektense eski modele düşmek doğru.
    "harita_makine_x": None,
    "harita_makine_y": None,
}

# Makul aralıklar. Panelden gelen sayıya körlemesine güvenmiyoruz: saçma bir
# ölçek haritayı kilometrelerce büyütür.
SINIR = {
    "mm_px": (0.01, 20.0),
    "donme": (-180.0, 180.0),
    "ofset_x": (-500.0, 500.0),
    "ofset_y": (-500.0, 500.0),
    "genislik_px": (16, 8000),
    "yukseklik_px": (16, 8000),
}


class KalibrasyonHatasi(Exception):
    """Kalibrasyon hesaplanamadı ya da verilen değer geçersiz."""


def _harita_dogrula(ham: Any) -> list[list[float]] | None:
    """3x3 homografi — ya geçerli ya None.

    YARIM BİR HARİTA, HİÇ HARİTA OLMAMASINDAN KÖTÜ: sekiz sayısı doğru
    dokuzuncusu bozuk bir dizi, ölçüleri sessizce saçmalatır. Ya tamamı
    sayı ve son eleman sıfır değil, ya da hiç kaydetmiyoruz.
    """
    if ham in (None, "", [], {}):
        return None
    try:
        satirlar = [[float(x) for x in satir] for satir in ham]
    except (TypeError, ValueError):
        raise KalibrasyonHatasi("Harita 3x3 sayı dizisi olmalı") from None
    if len(satirlar) != 3 or any(len(s) != 3 for s in satirlar):
        raise KalibrasyonHatasi(
            f"Harita 3x3 olmalı (verilen: {len(satirlar)} satır)")
    if abs(satirlar[2][2]) < 1e-12:
        raise KalibrasyonHatasi(
            "Haritanın son elemanı sıfır olamaz — dönüşüm tanımsız kalır")
    # Ölçekleme serbestliğini kaldırıyoruz: aynı harita farklı katsayılarla
    # yazılabiliyor ve karşılaştırma imkânsızlaşıyor.
    b = satirlar[2][2]
    return [[round(x / b, 10) for x in satir] for satir in satirlar]


def harita_uygula(harita: Any, u: float, v: float) -> tuple[float, float]:
    """Bir pikseli haritadan geçirip milimetreye çevirir."""
    H = _harita_dogrula(harita)
    if H is None:
        raise KalibrasyonHatasi("Harita tanımlı değil")
    payda = H[2][0] * u + H[2][1] * v + H[2][2]
    if abs(payda) < 1e-12:
        raise KalibrasyonHatasi("Harita bu piksel için tanımsız")
    return ((H[0][0] * u + H[0][1] * v + H[0][2]) / payda,
            (H[1][0] * u + H[1][1] * v + H[1][2]) / payda)


def harita_ters(harita: Any) -> list[list[float]]:
    """Haritanın tersi — milimetreden piksele dönmek için.

    Ekim noktasının üstündeki pencereye bakmak (çimlenme denetimi) ve
    haritada bir yeri karede göstermek bu yönü istiyor. Homografi tersi
    yine bir homografi; 3x3 matris tersini açık formülle alıyoruz —
    numpy burada zorunlu bir bağımlılık olmasın diye.
    """
    H = _harita_dogrula(harita)
    if H is None:
        raise KalibrasyonHatasi("Harita tanımlı değil")
    a, b, c = H[0]
    d, e, f = H[1]
    g, h, i = H[2]
    det = (a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g))
    if abs(det) < 1e-15:
        raise KalibrasyonHatasi(
            "Harita tersi alınamıyor — dört nokta aynı doğru üstünde olabilir")
    ters = [
        [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
        [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
        [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
    ]
    return _harita_dogrula(ters)


def harita_geri(harita: Any, x: float, y: float) -> tuple[float, float]:
    """Yatak milimetresini karedeki piksele çevirir."""
    return harita_uygula(harita_ters(harita), x, y)


def _yol() -> str:
    ozel = os.environ.get("KALIBRASYON_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "kamera_kalibrasyon.json")
    return os.path.join(os.path.dirname(__file__), "kamera_kalibrasyon.json")


def _ham_oku() -> dict[str, Any]:
    """Dosyanın tamamı, kamera adlarına göre.

    ESKİ BİÇİM: dosya doğrudan tek bir kalibrasyon sözlüğüydü (`mm_px` en
    üstte). O dosya "uc" kamerasının kalibrasyonu sayılıyor — tek kamera
    varken ölçülen sayı uç kamerasının sayısıydı. Kullanıcının elle bir şey
    yapması gerekmiyor, ölçümü de kaybolmuyor.
    """
    yol = _yol()
    with _KILIT:
        if not os.path.exists(yol):
            return {}
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            return {}
    if not isinstance(veri, dict):
        return {}
    if isinstance(veri.get("kameralar"), dict):
        return {ad_temizle(a): d for a, d in veri["kameralar"].items()
                if isinstance(d, dict)}
    if "mm_px" in veri:
        return {VARSAYILAN_KAMERA: veri}
    return {}


def hepsi() -> dict[str, dict[str, Any]]:
    """Bütün kameraların kalibrasyonu — panel tek istekle alsın diye."""
    return {ad: {**VARSAYILAN, **d} for ad, d in _ham_oku().items()}


def oku(kamera: str = VARSAYILAN_KAMERA) -> dict[str, Any]:
    """Bir kameranın kalibrasyonu. Yoksa varsayılan (mm_px = 0)."""
    kam = ad_temizle(kamera)
    veri = _ham_oku().get(kam)
    if not isinstance(veri, dict):
        return {**VARSAYILAN, "kamera": kam}
    return {**VARSAYILAN, **veri, "kamera": kam}


def _yaz(veri: dict[str, dict[str, Any]]) -> None:
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                             prefix=".kalib-", suffix=".tmp", delete=False)
        try:
            json.dump({"kameralar": veri}, gecici, ensure_ascii=False, indent=1)
            gecici.flush()
            os.fsync(gecici.fileno())
            gecici.close()
            os.replace(gecici.name, yol)
        except Exception:
            try:
                os.unlink(gecici.name)
            except OSError:
                pass
            raise


def _sinirla(ad: str, deger: float) -> float:
    alt, ust = SINIR[ad]
    sayi = float(deger)
    if not math.isfinite(sayi):
        raise KalibrasyonHatasi(f"'{ad}' sayı olmalı")
    if not alt <= sayi <= ust:
        raise KalibrasyonHatasi(f"'{ad}' {alt} ile {ust} arasında olmalı (verilen: {sayi})")
    return sayi


def kaydet(ham: dict[str, Any], kamera: str = VARSAYILAN_KAMERA) -> dict[str, Any]:
    """Bir kameranın kalibrasyonunu yazar; DİĞER kameralara dokunmaz."""
    kam = ad_temizle(ham.get("kamera") or kamera)
    tumu = _ham_oku()
    yeni = {**VARSAYILAN, **(tumu.get(kam) or {})}
    for ad in ("mm_px", "donme", "ofset_x", "ofset_y"):
        if ad in ham and ham[ad] is not None:
            # mm_px = 0 "kalibre edilmedi" demek; sıfırlamayı engellememeliyiz.
            if ad == "mm_px" and float(ham[ad]) == 0:
                yeni[ad] = 0.0
                continue
            yeni[ad] = _sinirla(ad, ham[ad])
    for ad in ("genislik_px", "yukseklik_px"):
        if ad in ham and ham[ad] is not None:
            yeni[ad] = int(_sinirla(ad, ham[ad]))
    for ad in ("ayna_x", "ayna_y"):
        if ad in ham:
            yeni[ad] = bool(ham[ad])
    if "harita" in ham:
        yeni["harita"] = _harita_dogrula(ham["harita"])
    for ad in ("harita_sapma_mm",):
        if ad in ham and ham[ad] is not None:
            yeni[ad] = round(float(ham[ad]), 3)
    if "harita_nokta" in ham and ham["harita_nokta"] is not None:
        yeni["harita_nokta"] = int(ham["harita_nokta"])
    # Harita ölçüm konumu: AÇIKÇA None yazılabilmeli (sabit kamera). O
    # yüzden `is not None` süzgeci yok — anahtar varsa değeri geçerli.
    for ad in ("harita_makine_x", "harita_makine_y"):
        if ad in ham:
            yeni[ad] = (None if ham[ad] in (None, "")
                        else round(float(ham[ad]), 3))
    if "yontem" in ham:
        yeni["yontem"] = str(ham["yontem"])[:20]
    if "guncelleme" in ham:
        yeni["guncelleme"] = float(ham["guncelleme"] or 0)
    yeni.pop("kamera", None)
    tumu[kam] = yeni
    _yaz(tumu)
    return {**yeni, "kamera": kam}
