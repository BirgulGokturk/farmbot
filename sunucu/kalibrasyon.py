"""Kamera kalibrasyonu — fotoğrafı haritaya oturtan sayılar. KAMERA BAŞINA.

**mm_px her kamera için ayrıdır ve paylaşılamaz.** Uç kamerası yatağa 20-30
cm mesafede, bir pikseli yarım milimetre; sabit üst kamera iki metre
yukarıdan yatağın tamamını görüyor, bir pikseli birkaç milimetre. Aynı sayıyı
ikisine birden uygulamak, ölçüleri kat kat yanlış yapar — ve yanlış olduğu
belli olmaz, çünkü sonuç yine "milimetre" diye yazılır. Bu yüzden kayıt
kamera adına göre tutuluyor ve çözümleme, karenin GELDİĞİ kameranın sayısını
kullanıyor.

İki kalibrasyon yöntemi var ve hangisinin işe yaradığını kameranın hareketli
olup olmaması belirliyor:

  * **iki kare** (hareketli kamera) — makine bilinen bir mesafe oynuyor, aynı
    toprak parçası iki karede işaretleniyor. Hem ölçeği hem açıyı veriyor.
  * **ölçek** (sabit kamera) — makine oynayınca sabit kameranın gördüğü sahne
    DEĞİŞMİYOR, dolayısıyla iki kare yöntemi orada çalışmıyor. Onun yerine
    karede bilinen uzunlukta bir şeyin iki ucu işaretlenip gerçek mesafesi
    yazılıyor. Yalnız ölçek çıkıyor; açı ve konum çıkmıyor — çünkü sabit
    kameranın karesinin makine koordinatı zaten yok.

Kareyi haritanın DOĞRU yerine, doğru ölçekte ve doğru
açıyla koyabilmek için dört şey gerekiyor:

    mm_px    — bir piksel kaç mm (yükseklik sabitken sabit)
    donme    — kamera ekseninin makine eksenine göre açısı (derece)
    ofset_x  — kamera merkezinin uç ucundan kayması (mm)
    ofset_y
    ayna_x   — görüntü yatayda ters mi (montaj yönüne göre)
    ayna_y

Bunlar elle girilebiliyor ama asıl yol **iki kare**: makineyi bilinen bir
mesafe kadar oynatıp aynı toprak parçasını iki karede işaretlemek. Aradaki
piksel farkı ile mm farkı hem ölçeği hem açıyı veriyor. Hesap `coz()` içinde;
panel yalnızca tıklanan pikselleri gönderiyor.

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
    "yontem": "",           # "elle" | "iki-kare"
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
    if "yontem" in ham:
        yeni["yontem"] = str(ham["yontem"])[:20]
    if "guncelleme" in ham:
        yeni["guncelleme"] = float(ham["guncelleme"] or 0)
    yeni.pop("kamera", None)
    tumu[kam] = yeni
    _yaz(tumu)
    return {**yeni, "kamera": kam}


def coz(kare1: dict[str, Any], kare2: dict[str, Any]) -> dict[str, float]:
    """İki kareden ölçek ve açı çıkarır.

    Her kare: {"x","y"} makine konumu (mm) ve {"u","v"} aynı toprak
    parçasının o karedeki piksel yeri.

    Makine Δ kadar hareket ettiğinde SABİT bir toprak parçası kameraya göre
    −Δ kadar kayar. Görüntüdeki piksel kayması ΔU ise:

        −Δ = s · R(θ) · ΔU

    Buradan ölçek iki uzunluğun oranı, açı da iki yönün farkı.
    """
    dx = float(kare2["x"]) - float(kare1["x"])
    dy = float(kare2["y"]) - float(kare1["y"])
    du = float(kare2["u"]) - float(kare1["u"])
    dv = float(kare2["v"]) - float(kare1["v"])

    mm_uzunluk = math.hypot(dx, dy)
    px_uzunluk = math.hypot(du, dv)

    # Çok küçük hareket = büyük hata. 20 mm ve 12 px, gürültünün üstünde
    # kalmak için makul bir alt sınır.
    if mm_uzunluk < 20:
        raise KalibrasyonHatasi(
            f"İki kare arasında en az 20 mm hareket olmalı (şu an {mm_uzunluk:.1f} mm). "
            "Makineyi biraz daha oynatıp yeniden çekin.")
    if px_uzunluk < 12:
        raise KalibrasyonHatasi(
            f"İşaretlenen iki nokta arasında en az 12 piksel olmalı "
            f"(şu an {px_uzunluk:.1f} px). Aynı toprak parçasını işaretlediğinizden emin olun.")

    mm_px = mm_uzunluk / px_uzunluk
    donme = math.degrees(math.atan2(-dy, -dx) - math.atan2(dv, du))
    # -180..180 aralığına indir
    donme = (donme + 180) % 360 - 180
    return {"mm_px": mm_px, "donme": donme,
            "mm_mesafe": mm_uzunluk, "px_mesafe": px_uzunluk}


#: İki işaret arasında en az bu kadar piksel olsun. 40 px, 640 genişlikte
#: karenin ~%6'sı: tıklama hatası (birkaç piksel) sonucu belirgin bozmasın.
EN_AZ_OLCEK_PX = 40.0
#: Ve en az bu kadar milimetre — 3 cm'lik bir cetvel parçasından ölçek
#: çıkarmak, ölçüm hatasını olduğu gibi ölçeğe taşır.
EN_AZ_OLCEK_MM = 50.0


def coz_olcek(u1: float, v1: float, u2: float, v2: float,
              gercek_mm: float) -> dict[str, float]:
    """Tek kareden ölçek — SABİT kameranın tek kalibrasyon yolu.

    Sabit kamera makineyle gitmiyor: makine oynadığında karedeki sahne
    değişmiyor, dolayısıyla `coz()` (iki kare) yöntemi orada hiçbir şey
    ölçemez. Onun yerine karede uzunluğu BİLİNEN bir şeyin iki ucu
    işaretleniyor — bir cetvel, yatağın kenarı, iki tepsi gözü arası.

    Yalnız `mm_px` çıkıyor. Açı ve konum ÇIKMIYOR ve uydurulmuyor: sabit
    kameranın karesinin makine koordinatı yok, çıkarılacak bir konum da yok.
    """
    du = float(u2) - float(u1)
    dv = float(v2) - float(v1)
    px = math.hypot(du, dv)
    mm = float(gercek_mm)
    if not math.isfinite(px) or px < EN_AZ_OLCEK_PX:
        raise KalibrasyonHatasi(
            f"İki işaret arasında en az {EN_AZ_OLCEK_PX:.0f} piksel olmalı "
            f"(şu an {px:.1f} px). Karede daha uzun bir şeyin iki ucunu seçin — "
            "kısa mesafede tıklama hatası ölçeği bozar.")
    if not math.isfinite(mm) or mm < EN_AZ_OLCEK_MM:
        raise KalibrasyonHatasi(
            f"Gerçek mesafe en az {EN_AZ_OLCEK_MM:.0f} mm olmalı "
            f"(verilen: {gercek_mm}). Kısa bir mesafeden çıkarılan ölçek, "
            "ölçüm hatanızı bütün karede büyütür.")
    mm_px = mm / px
    alt, ust = SINIR["mm_px"]
    if not alt <= mm_px <= ust:
        raise KalibrasyonHatasi(
            f"Çıkan ölçek {mm_px:.3f} mm/px — {alt} ile {ust} arasında olmalı. "
            "İşaretler ya da girilen mesafe hatalı olabilir.")
    return {"mm_px": mm_px, "px_mesafe": px, "mm_mesafe": mm}
