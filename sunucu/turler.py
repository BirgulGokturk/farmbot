"""Bitki türleri — kurtarılmış katalog + kullanıcının ezmeleri.

Üç katman var, üstteki alttakini eziyor:

    1. docs/bitki_turleri.json   kurtarılmış kaynak veri — SALT OKUNUR
    2. tur_ezme.json             tür düzeyinde ezme (bu dosya)
    3. noktanın `ozel` alanı     tek bitki düzeyinde ezme (noktalar.py)

Katalog dosyasına neden yazmıyoruz: o dosya kurtarılmış bir kaynak. Üstüne
yazmak, bir kere bozulduğunda geri dönülecek yeri yok etmek demek. Kullanıcı
bir değeri değiştirdiğinde kaynak olduğu gibi duruyor, değişiklik ayrı bir
dosyaya yazılıyor ve "türden farklı" diye işaretlenebiliyor — hangi değerin
elle konduğu, hangisinin katalogdan geldiği her zaman belli.

Tür düzeyi ile bitki düzeyi ayrımı:
  - Tür düzeyi: "marulun çapı bizim yatakta 180 mm" — o türden EKLENECEK
    bitkiler de bunu kullanıyor.
  - Bitki düzeyi: "şu marul cılız kaldı, çapı 120" — türün geri kalanı
    etkilenmiyor.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

_KILIT = threading.RLock()

# Kullanıcının değiştirebileceği alanlar. Ad, renk ve simge listede YOK:
# onlar kataloğun kimliği; değiştirilmesi gerekirse yeni bir tür eklemek
# doğru yol olur.
DUZENLENEBILIR = ("spread_mm", "sow_depth_mm", "days_to_harvest", "water_ml_per_day",
                  "sulama_deseni", "sulama_oran", "sulama_aci", "sulama_nokta",
                  "sulama_aciklik_mm", "sulama_nem_esigi")

# SULAMA OFSETİ — bitkinin tam üstüne akıtmak her tür için doğru değil.
# Besleyici kökler kanopinin kenarında (damlama hattı); fideye 80 mm uzağa
# su vermek boşa akıtmak, olgun bir domatese gövdeye akıtmak yaprağı
# ıslatıp kökü kuru bırakmak.
#
# Ofset TEK bir formülden çıkıyor:
#
#     ofset = sulama_oran x (bitkinin O ANKİ yarıçapı)
#
# Sorulan üç model bunun içinde birer özel hâl:
#   - `egri_yayilim` bağlıysa yarıçap yaşa göre değişiyor (asıl istenen),
#   - eğri yoksa yarıçap türün OLGUN `spread_mm`/2 değeri, yani oran yüzde,
#   - tür düzeyinde ikisi de sabitse sonuç sabit mm.
# Ayrı bir `sabit_mm` terimi bilerek YOK: eğrisiz hâl zaten onu veriyor ve
# altıncı bir alan panelde karşılığı olmayan karmaşıklık olurdu.
SECENEK = {
    "sulama_deseni": ("ust", "yan", "iki", "cember"),
}

# Seçeneklerin panelde görünen adı.
SECENEK_ADI = {
    "sulama_deseni": {
        "ust": "Tam üst (ofset yok)",
        "yan": "Tek yana kaydır",
        "iki": "Karşılıklı iki nokta",
        "cember": "Çember (N nokta)",
    },
}

# Katalogda sulama alanları YOK — kurtarılmış veri onları taşımıyor.
# Varsayılanlar burada, tek kaynakta. VARSAYILAN "ust" + oran 0: yani
# güncelleme sonrası hiçbir kurulumun davranışı değişmiyor, sulama eskisi
# gibi bitkinin tam üstüne akıtıyor. Ofset ancak kullanıcı açarsa başlıyor.
VARSAYILAN = {
    "sulama_deseni": "ust",
    "sulama_oran": 0.0,
    "sulama_aci": 0.0,
    "sulama_nokta": 4.0,
    "sulama_aciklik_mm": 50.0,
    "sulama_nem_esigi": 100.0,
}

# Hangi alan hangi desende anlamlı — panel gereksiz alanı gizliyor.
KOSUL = {
    "sulama_oran": ("yan", "iki", "cember"),
    "sulama_aci": ("yan", "iki", "cember"),
    "sulama_nokta": ("cember",),
}

# Alanın altında görünen açıklama. `sulama_oran`daki not önemli: eğri
# bağlı değilken yarıçap katalogdaki OLGUN çaptan geliyor, yani fideye ilk
# günden olgun mesafe veriliyor. Bunu bilmeden oran açan kullanıcı,
# fidenin suyunu 10 cm ötesine döktüğünü fark etmez.
NOT = {
    "sulama_oran": ("Bitkinin O ANKİ yarıçapının kaçta kaçı. 0 = tam üst. "
                    "0,8 tipik: damlama hattının hemen içi. "
                    "DİKKAT: bitkiye yayılım eğrisi (egri_yayilim) bağlı "
                    "DEĞİLSE yarıçap katalogdaki OLGUN çaptan hesaplanır — "
                    "yani fideye ilk günden olgun bitki mesafesi verilir. "
                    "Yaşa göre ölçeklenmesi için bitkiye yayılım eğrisi bağlayın."),
    "sulama_aci": ("Ofsetin yönü. 0° = +X. SABİT bir açı: yatağın kenarına "
                   "yakın bitkide su alan dışına nişanlanabilir; öyle bir "
                   "durumda sulama reddedilir ve açıyı çevirmeniz istenir."),
    "sulama_nokta": ("Çemberdeki nokta sayısı. Her nokta ayrı bir hareket "
                     "demek: 40 bitkilik bir koşuda 8 nokta, 4 noktanın iki "
                     "katı süre eder. 2-4 arası tavsiye edilir."),
    "sulama_aciklik_mm": ("Ucun bitkinin TEPESİNDEN ne kadar yukarıda "
                          "duracağı. Boy `egri_yukseklik`ten okunuyor; eğri "
                          "yoksa yüzeyden bu kadar yukarısı kullanılır."),
    "sulama_deseni": ("Suyun bırakılacağı desen. Tam üst eski davranış ve "
                      "varsayılan; fide, tohum ve kök sebzesi için doğrusu bu."),
    "sulama_nem_esigi": (
        "TOPRAK nemi (hava nemi değil) bu yüzdenin altındaysa sulanır, "
        "üstündeyse atlanır. 100 = nem bakılmaz, her zaman sula "
        "(varsayılan). Karşılaştırma kalibre edilmiş yüzde üzerinden "
        "yapılır, ham 0-1023 sayımı üzerinden değil. Bitkinin yakınında "
        "taze bir okuma yoksa SULANIR ve gerekçesi yazılır — bitki "
        "kaybetmek, su israfından kötü."),
}

# Makul aralıklar — panelden gelen sayıya körlemesine güvenmiyoruz. Sıfır
# fazla yazmak kolay ve 4000 mm çaplı bir marul haritayı okunmaz yapıyor.
SINIR = {
    "spread_mm": (10.0, 3000.0),
    "sow_depth_mm": (0.0, 200.0),
    "days_to_harvest": (1.0, 400.0),
    "water_ml_per_day": (0.0, 20000.0),
    # 1,5 tavanı: kanopinin bir parça dışına su vermek meşru (yayılan kök),
    # daha fazlası komşu bitkinin dibine akıtmak olurdu.
    "sulama_oran": (0.0, 1.5),
    "sulama_aci": (0.0, 359.0),
    # 8 tavan ölçüyle konuldu: her ek nokta bir Z çevrimi demek ve yazılım
    # ölçümünde nokta başına saniyeler ediyor. 2 alt sınır, çünkü tek
    # noktalı "çember" zaten `yan` deseni.
    "sulama_nokta": (2.0, 8.0),
    "sulama_aciklik_mm": (0.0, 300.0),
    # Toprak nemi bu YÜZDENİN altındaysa sulanıyor, üstündeyse atlanıyor.
    # 100 = "nem bakılmaz, her zaman sula" ve VARSAYILAN bu: güncelleme
    # sonrası hiçbir kurulumun sulaması sessizce durmuyor.
    "sulama_nem_esigi": (0.0, 100.0),
}

BIRIM = {
    "spread_mm": "mm",
    "sow_depth_mm": "mm",
    "days_to_harvest": "gün",
    "water_ml_per_day": "ml/gün",
    "sulama_deseni": "",
    "sulama_oran": "× yarıçap",
    "sulama_aci": "°",
    "sulama_nokta": "nokta",
    "sulama_aciklik_mm": "mm",
    "sulama_nem_esigi": "% nem",
}

BASLIK = {
    "spread_mm": "Yayılma çapı",
    "sow_depth_mm": "Ekim derinliği",
    "days_to_harvest": "Hasat süresi",
    "water_ml_per_day": "Günlük su",
    "sulama_deseni": "Sulama deseni",
    "sulama_oran": "Sulama ofseti",
    "sulama_aci": "Ofset yönü",
    "sulama_nokta": "Çember noktası",
    "sulama_aciklik_mm": "Uç açıklığı",
    "sulama_nem_esigi": "Sulama nem eşiği",
}


class TurHatasi(Exception):
    """Geçersiz alan ya da aralık dışı değer."""


# --------------------------------------------------------------------------- #
# 1. katman — kurtarılmış katalog (salt okunur)
# --------------------------------------------------------------------------- #
_KATALOG = {"ts": 0.0, "veri": []}


def _katalog_yolu() -> str:
    ozel = os.environ.get("TUR_YOLU")
    if ozel:
        return ozel
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "docs", "bitki_turleri.json")


def katalog() -> list[dict[str, Any]]:
    """Kaynak veri. Bu fonksiyonun yazan bir eşi YOK ve olmayacak."""
    yol = _katalog_yolu()
    try:
        damga = os.path.getmtime(yol)
    except OSError:
        return []
    # Dosya değişmediyse yeniden okumuyoruz; her panel açılışında 10 KB JSON
    # ayrıştırmanın anlamı yok.
    if damga == _KATALOG["ts"] and _KATALOG["veri"]:
        return _KATALOG["veri"]
    try:
        with open(yol, encoding="utf-8") as dosya:
            veri = json.load(dosya)
    except (json.JSONDecodeError, OSError):
        return []
    if not isinstance(veri, list):
        return []
    _KATALOG.update(ts=damga, veri=veri)
    return veri


# --------------------------------------------------------------------------- #
# 2. katman — tür düzeyinde ezmeler
# --------------------------------------------------------------------------- #
def _ezme_yolu() -> str:
    ozel = os.environ.get("TUR_EZME_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "tur_ezme.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "tur_ezme.json")


def ezmeler() -> dict[str, dict[str, float]]:
    yol = _ezme_yolu()
    with _KILIT:
        if not os.path.exists(yol):
            return {}
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            try:
                os.replace(yol, yol + ".bozuk")
            except OSError:
                pass
            return {}
        return veri.get("turler", {}) if isinstance(veri, dict) else {}


def _ezme_yaz(turler: dict[str, dict[str, float]]) -> None:
    yol = _ezme_yolu()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                             prefix=".tur-", suffix=".tmp", delete=False)
        try:
            json.dump({"surum": 1, "turler": turler}, gecici, ensure_ascii=False, indent=1)
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


def alan_dogrula(alan: str, deger: Any) -> float | str:
    if alan not in DUZENLENEBILIR:
        raise TurHatasi(f"'{alan}' düzenlenebilir bir alan değil "
                        f"(düzenlenebilenler: {', '.join(DUZENLENEBILIR)})")
    # SEÇENEKLİ alan: sayı değil, kapalı bir listeden metin. Sayısal aralık
    # makinesi bunu kapsamıyor, tek dal burada ayrılıyor.
    if alan in SECENEK:
        metin = str(deger or "").strip().lower()
        if metin not in SECENEK[alan]:
            raise TurHatasi(
                f"{BASLIK[alan]} şunlardan biri olmalı: "
                + ", ".join(SECENEK[alan]) + f" (verilen: {deger!r})")
        return metin
    try:
        sayi = float(deger)
    except (TypeError, ValueError):
        raise TurHatasi(f"{BASLIK[alan]} sayı olmalı")
    alt, ust = SINIR[alan]
    if not alt <= sayi <= ust:
        raise TurHatasi(f"{BASLIK[alan]} {alt:g} ile {ust:g} {BIRIM[alan]} arasında olmalı "
                        f"(verilen: {sayi:g})")
    return sayi


def ezme_dogrula(alanlar: dict[str, Any]) -> dict[str, float | str]:
    return {a: alan_dogrula(a, d) for a, d in (alanlar or {}).items() if d is not None}


def varsayilanlari_uygula(tur: dict[str, Any]) -> dict[str, Any]:
    """Katalogda olmayan sulama alanlarını varsayılanla doldurur.

    Kurtarılmış katalog sulama alanlarını taşımıyor. Tüketicilerin her
    yerde `t.get(alan) or VARSAYILAN[alan]` yazmasındansa değeri burada,
    tek yerde tamamlıyoruz — yoksa sunucu ile panel farklı varsayılana
    düşer ve önizleme gerçekle tutmaz.
    """
    for alan, deger in VARSAYILAN.items():
        if tur.get(alan) in (None, ""):
            tur[alan] = deger
    return tur


def kaydet(slug: str, alanlar: dict[str, Any]) -> dict[str, Any]:
    """Tür düzeyinde ezme yazar. Katalog dosyasına DOKUNMUYOR."""
    slug = str(slug or "").strip()
    if not any(t.get("slug") == slug for t in katalog()):
        raise TurHatasi(f"'{slug}' adında bir tür yok")
    temiz = ezme_dogrula(alanlar)
    with _KILIT:
        hepsi_ezme = ezmeler()
        mevcut = dict(hepsi_ezme.get(slug, {}))
        mevcut.update(temiz)
        # Katalogdakiyle aynı değer ezme sayılmıyor: "türden farklı" işareti
        # gerçekten farklı olanı göstersin.
        kaynak = next((t for t in katalog() if t.get("slug") == slug), {})
        # Katalogdakiyle aynı değer ezme sayılmıyor. Sulama alanları
        # katalogda hiç yok, onların ölçütü VARSAYILAN: varsayılana eşit
        # bir değer de ezme değil, yoksa "katalogdan farklı" rozeti
        # dokunulmamış türlerde de yanardı.
        def _ezme_mi(alan: str, deger: Any) -> bool:
            olcut = kaynak.get(alan)
            if olcut is None:
                olcut = VARSAYILAN.get(alan)
            if olcut is None:
                return True
            if isinstance(deger, str):
                return str(olcut) != deger
            try:
                return float(olcut) != float(deger)
            except (TypeError, ValueError):
                return True
        mevcut = {a: d for a, d in mevcut.items() if _ezme_mi(a, d)}
        if mevcut:
            hepsi_ezme[slug] = mevcut
        else:
            hepsi_ezme.pop(slug, None)
        _ezme_yaz(hepsi_ezme)
    return bul(slug)


def sifirla(slug: str, alan: str | None = None) -> dict[str, Any]:
    """Bir alanı ya da türün bütün ezmelerini katalog değerine döndürür."""
    slug = str(slug or "").strip()
    with _KILIT:
        hepsi_ezme = ezmeler()
        if alan:
            if alan not in DUZENLENEBILIR:
                raise TurHatasi(f"'{alan}' düzenlenebilir bir alan değil")
            mevcut = dict(hepsi_ezme.get(slug, {}))
            mevcut.pop(alan, None)
            if mevcut:
                hepsi_ezme[slug] = mevcut
            else:
                hepsi_ezme.pop(slug, None)
        else:
            hepsi_ezme.pop(slug, None)
        _ezme_yaz(hepsi_ezme)
    return bul(slug)


# --------------------------------------------------------------------------- #
# Birleştirme
# --------------------------------------------------------------------------- #
def hepsi() -> list[dict[str, Any]]:
    """Katalog + tür ezmeleri. Her tür `ezili` alanıyla geliyor.

    `ezili` = {alan: katalogdaki_deger}. Panel bununla hem "türden farklı"
    işaretini koyuyor hem de "geri al" düğmesinde neye dönüleceğini biliyor.
    """
    ez = ezmeler()
    cikti = []
    for ham in katalog():
        tur = dict(ham)
        slug = tur.get("slug")
        ezili = {}
        for alan, deger in (ez.get(slug) or {}).items():
            if alan not in DUZENLENEBILIR:
                continue
            ezili[alan] = ham.get(alan)          # katalogdaki hâli
            tur[alan] = deger
        tur["ezili"] = ezili
        cikti.append(varsayilanlari_uygula(tur))
    return cikti


def bul(slug: str) -> dict[str, Any] | None:
    slug = str(slug or "").strip()
    return next((t for t in hepsi() if t.get("slug") == slug), None)


def alan_bilgisi() -> dict[str, Any]:
    """Panelin form kurarken kullandığı alan tanımları.

    `tip` alanı panelin sayı kutusu mu açılır liste mi çizeceğini söylüyor;
    `kosul` hangi desende görüneceğini, `not` da altındaki açıklamayı.
    """
    cikti: dict[str, Any] = {}
    for a in DUZENLENEBILIR:
        bilgi: dict[str, Any] = {"baslik": BASLIK[a], "birim": BIRIM[a]}
        if a in SECENEK:
            bilgi["tip"] = "secenek"
            bilgi["secenekler"] = [{"deger": d, "ad": SECENEK_ADI[a][d]}
                                   for d in SECENEK[a]]
        else:
            bilgi["tip"] = "sayi"
            bilgi["alt"] = SINIR[a][0]
            bilgi["ust"] = SINIR[a][1]
        if a in VARSAYILAN:
            bilgi["varsayilan"] = VARSAYILAN[a]
        if a in KOSUL:
            bilgi["kosul"] = {"alan": "sulama_deseni", "degerler": list(KOSUL[a])}
        if a in NOT:
            bilgi["not"] = NOT[a]
        cikti[a] = bilgi
    return cikti
