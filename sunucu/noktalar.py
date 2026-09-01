"""Nokta deposu — isimlendirilmiş X/Y/Z konumları.

Neden SQLite değil de JSON
--------------------------
Bu veri yapılandırma niteliğinde: küçük, bütün olarak okunuyor, bütün olarak
yazılıyor. SQLite'ın kazandırdığı şey — aralık sorgusu, seyreltme, eşzamanlı
yazma — burada hiç kullanılmıyor. Buna karşılık JSON'un üç somut faydası var:

  1. Gantry Studio'nun `gantry_store.json` dosyası zaten bu biçimde; makinedeki
     mevcut noktalar elle dönüştürülmeden kopyalanabiliyor.
  2. Bir şey ters giderse düzeltmek metin düzenlemek kadar kolay. Sahada,
     telefondan SSH ile bakarken SQL istemcisi aramak istemezsiniz.
  3. Yedeklemek `cp` demek.

Telemetri farklı bir iş (sürekli ekleme, zaman aralığı sorgusu, seyreltme) ve
o yüzden `depo.py` içinde SQLite'ta kalıyor. Nokta sayısı on binleri bulursa —
ızgara üstüne ızgara üretilirse — bu dosya da SQLite'a taşınır; 2000 noktalık
bir dosya ~200 KB, o sınırın çok uzağındayız.

Yazma atomik: geçici dosyaya yazıp `os.replace` ile yerine koyuyoruz. Yarım
yazılmış bir JSON, elektrik kesintisinde bütün noktaları kaybetmek demek olurdu.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from typing import Any

import turler

_KILIT = threading.RLock()

# İsim uzunluğu sınırı: panelde okunabilir kalsın ve dosya şişmesin.
AZAMI_AD = 40
AZAMI_NOKTA = 5000


class NoktaHatasi(Exception):
    """Geçersiz isim, çakışan isim ya da bulunamayan nokta."""


def _yol() -> str:
    """Veri dosyasının yeri — SQLite ile aynı klasör.

    `pi-kur.sh` veriyi depo dışında (`~/farmbot-veri/`) tutuyor; depoyu
    güncellemek kayıtlı noktaları silmesin diye buraya bağlıyoruz.
    """
    ozel = os.environ.get("NOKTA_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "noktalar.json")
    return os.path.join(os.path.dirname(__file__), "noktalar.json")


def _bos() -> dict[str, Any]:
    return {"surum": 1, "noktalar": []}


def oku() -> dict[str, Any]:
    yol = _yol()
    with _KILIT:
        if not os.path.exists(yol):
            return _bos()
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            # Bozuk dosya sessizce yutulmaz ama sunucuyu da düşürmez: bozuğu
            # kenara alıp boş depoyla devam ediyoruz, kullanıcı dosyayı
            # kurtarabilsin.
            try:
                os.replace(yol, yol + ".bozuk")
            except OSError:
                pass
            return _bos()
        if not isinstance(veri, dict) or not isinstance(veri.get("noktalar"), list):
            return _bos()
        return veri


def yaz(veri: dict[str, Any]) -> None:
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        # Aynı klasöre yazıyoruz: os.replace yalnızca aynı dosya sisteminde
        # atomik ve /tmp farklı bir bağlama noktası olabilir.
        gecici = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=klasor, prefix=".noktalar-", suffix=".tmp", delete=False)
        try:
            json.dump(veri, gecici, ensure_ascii=False, indent=1)
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


def _ad_dogrula(ad: str) -> str:
    ad = str(ad or "").strip()
    if not ad:
        raise NoktaHatasi("Nokta adı boş olamaz")
    if len(ad) > AZAMI_AD:
        raise NoktaHatasi(f"Nokta adı en fazla {AZAMI_AD} karakter olabilir")
    return ad


def hepsi() -> list[dict[str, Any]]:
    return oku()["noktalar"]


def bul(ad: str) -> dict[str, Any] | None:
    ad = str(ad or "").strip()
    return next((n for n in hepsi() if n.get("ad") == ad), None)


# Bitki noktalarının taşıdığı ek alanlar. Bitkiler ayrı bir depoya değil bu
# depoya yazılıyor: "şu noktaya git", program adımı ve sınır denetimi bir
# bitki için de aynen çalışsın diye. Paralel bir nokta kavramı öğrenmek
# gerekmiyor; bitki, tür bilgisi taşıyan bir noktadan ibaret.
BITKI_ALANLARI = ("tur", "ekim", "egri_su", "egri_yayilim", "egri_yukseklik", "ozel")

# Eğri alanları bir eğrinin ADINI tutuyor, değerini değil: eğri düzenlenince
# ona bağlı bütün bitkiler kendiliğinden yeni değeri kullanıyor. Eğri
# silinmişse alan eski adı taşımaya devam eder ve panel "eğri yok" der —
# noktayı bozmaktansa.
EGRI_ALANLARI = ("egri_su", "egri_yayilim", "egri_yukseklik")


def _ozel_suz(kaynak: Any) -> dict[str, float]:
    """Tek bitki düzeyindeki ezmeler — "şu marul cılız kaldı, çapı 120".

    Türün kendisine dokunmuyor. Aralık denetimi türlerdekiyle aynı yerden
    geliyor (turler.alan_dogrula); iki ayrı sınır listesi tutmak, birini
    değiştirip diğerini unutmak demek olurdu. Geçersiz alan atılıyor,
    noktanın tamamı reddedilmiyor: bir bitkinin çapı yüzünden kaydın
    kaybolması, değerin katalogdan gelmesinden daha kötü.
    """
    if not isinstance(kaynak, dict):
        return {}
    cikti: dict[str, float] = {}
    for alan, deger in kaynak.items():
        if alan not in turler.DUZENLENEBILIR or deger is None:
            continue
        try:
            cikti[alan] = turler.alan_dogrula(alan, deger)
        except turler.TurHatasi:
            continue
    return cikti


def _ekstra_suz(kaynak: dict[str, Any]) -> dict[str, Any]:
    cikti = {}
    if kaynak.get("tur"):
        cikti["tur"] = str(kaynak["tur"])[:40]
    if kaynak.get("ekim") is not None:
        try:
            cikti["ekim"] = float(kaynak["ekim"])
        except (TypeError, ValueError):
            pass
    for alan in EGRI_ALANLARI:
        # Boş metin "eğri bağlı değil" demek; alanı hiç yazmıyoruz.
        if kaynak.get(alan):
            cikti[alan] = str(kaynak[alan])[:40]
    ozel = _ozel_suz(kaynak.get("ozel"))
    if ozel:
        cikti["ozel"] = ozel
    return cikti


def ekle(ad: str, x: float, y: float, z: float, ustune_yaz: bool = False,
         etiket: str = "", ekstra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Yeni nokta ekler ya da (izin verilirse) aynı isimdekini günceller."""
    ad = _ad_dogrula(ad)
    nokta = {
        "ad": ad,
        "x": round(float(x), 2),
        "y": round(float(y), 2),
        "z": round(float(z), 2),
        "etiket": str(etiket or ""),
        "ts": time.time(),
        **_ekstra_suz(ekstra or {}),
    }
    with _KILIT:
        veri = oku()
        liste = veri["noktalar"]
        mevcut = next((i for i, n in enumerate(liste) if n.get("ad") == ad), None)
        if mevcut is not None:
            if not ustune_yaz:
                raise NoktaHatasi(f"'{ad}' adında bir nokta zaten var")
            liste[mevcut] = nokta
        else:
            if len(liste) >= AZAMI_NOKTA:
                raise NoktaHatasi(f"Nokta sayısı sınırı aşıldı ({AZAMI_NOKTA})")
            liste.append(nokta)
        yaz(veri)
    return nokta


def sil(ad: str) -> bool:
    return bool(sil_coklu([ad]))


def sil_coklu(adlar: list[str]) -> list[dict[str, Any]]:
    """Verilen noktaları siler ve SİLİNEN TAM KAYITLARI döndürür.

    Kayıtları döndürmesi geri alma içindir (bkz. `geri_al.py`): 30 saniye
    sonra kalıcı olacak bir silmenin, o süre boyunca geri konabilmesi için
    ad ve konumun yanı sıra etiket, tür, ekim tarihi ve eğri bağlarının da
    saklanması gerekiyor.

    Tek tek `sil` çağırmak 12 noktalık bir seçimde dosyayı 12 kez baştan
    yazmak olurdu; burada tek yazma var.
    """
    istenen = {str(a or "").strip() for a in adlar}
    istenen.discard("")
    if not istenen:
        return []
    with _KILIT:
        veri = oku()
        silinen = [dict(n) for n in veri["noktalar"] if n.get("ad") in istenen]
        if not silinen:
            return []
        veri["noktalar"] = [n for n in veri["noktalar"] if n.get("ad") not in istenen]
        yaz(veri)
    return silinen


def geri_koy(kayitlar: list[dict[str, Any]]) -> list[str]:
    """Silinen kayıtları olduğu gibi geri yazar — geri almanın karşılığı.

    Aynı isim bu arada yeniden kullanılmışsa o kayıt ATLANIYOR: kullanıcının
    silmeden sonra oluşturduğu bir noktayı sessizce ezmek, geri almanın
    düzeltmesi gereken hatadan daha kötü olur.
    """
    if not kayitlar:
        return []
    with _KILIT:
        veri = oku()
        mevcut = {n.get("ad") for n in veri["noktalar"]}
        konan = []
        for kayit in kayitlar:
            ad = kayit.get("ad")
            if not ad or ad in mevcut:
                continue
            veri["noktalar"].append(dict(kayit))
            mevcut.add(ad)
            konan.append(ad)
        if konan:
            yaz(veri)
    return konan


def nokta_listesi_uret(ciftler: list[Any], z: float,
                       onek: str = "s") -> list[dict[str, Any]]:
    """Tek tek yazılmış X/Y çiftlerinden nokta üretir.

    Her ekim düzenli bir ızgaraya oturmuyor: kullanıcı "şuraya ve
    şuraya" diyebilmeli. Izgarayı zorlayıp sonra fazla noktaları elle
    silmek, istenen üç noktayı yazmaktan zor.

    Kabul edilen biçimler — panel serbest metin gönderiyor ve kullanıcı
    üçünü de yazar:
        [[300, 150], [340, 150]]
        [{"x": 300, "y": 150}, …]
        ["300,150", "340 150"]

    HATA SESSİZ DEĞİL: okunamayan satır atlanmıyor, sebebiyle birlikte
    reddediliyor. Sessizce atlanan bir satır, ekilmediği fark edilmeyen
    bir bitki demek.
    """
    onek = _ad_dogrula(onek or "s")
    if not isinstance(ciftler, list) or not ciftler:
        raise NoktaHatasi("Koordinat listesi boş — her satıra 'X, Y' yazın.")
    if len(ciftler) > AZAMI_NOKTA:
        raise NoktaHatasi(f"Çok fazla nokta: {len(ciftler)}")

    cikti: list[dict[str, Any]] = []
    for sira, ham in enumerate(ciftler, start=1):
        if isinstance(ham, dict):
            x, y = ham.get("x"), ham.get("y")
        elif isinstance(ham, str):
            parca = [p for p in ham.replace(";", ",").replace("\t", ",")
                     .replace(" ", ",").split(",") if p]
            if len(parca) != 2:
                raise NoktaHatasi(
                    f"{sira}. satır okunamadı ({ham!r}) — 'X, Y' bekleniyor.")
            x, y = parca
        elif isinstance(ham, (list, tuple)) and len(ham) == 2:
            x, y = ham
        else:
            raise NoktaHatasi(f"{sira}. satır okunamadı — 'X, Y' bekleniyor.")
        try:
            fx, fy = float(x), float(y)
        except (TypeError, ValueError):
            raise NoktaHatasi(f"{sira}. satırda sayı olmayan değer: {x!r}, {y!r}")
        cikti.append({
            "ad": f"{onek}{sira}",
            "x": round(fx, 1), "y": round(fy, 1), "z": round(float(z), 1),
            "etiket": "ızgara",
        })
    return cikti


def toplu_ekle(yeni: list[dict[str, Any]]) -> dict[str, int]:
    """Izgara üretimi için: aynı isimdekilerin üzerine yazar, yenileri ekler.

    Tek tek `ekle` çağırmak her nokta için dosyayı baştan yazmak olurdu; 60
    noktalık bir ızgarada 60 kez disk yazması demek.
    """
    with _KILIT:
        veri = oku()
        indeks = {n.get("ad"): i for i, n in enumerate(veri["noktalar"])}
        eklendi = guncellendi = 0
        for n in yeni:
            ad = _ad_dogrula(n["ad"])
            kayit = {
                "ad": ad,
                "x": round(float(n["x"]), 2),
                "y": round(float(n["y"]), 2),
                "z": round(float(n["z"]), 2),
                "etiket": str(n.get("etiket", "")),
                "ts": time.time(),
                **_ekstra_suz(n),
            }
            if ad in indeks:
                veri["noktalar"][indeks[ad]] = kayit
                guncellendi += 1
            else:
                if len(veri["noktalar"]) >= AZAMI_NOKTA:
                    raise NoktaHatasi(f"Nokta sayısı sınırı aşıldı ({AZAMI_NOKTA})")
                indeks[ad] = len(veri["noktalar"])
                veri["noktalar"].append(kayit)
                eklendi += 1
        yaz(veri)
    return {"eklendi": eklendi, "guncellendi": guncellendi}


# --------------------------------------------------------------------------- #
# Tohum ızgarası
# --------------------------------------------------------------------------- #
def izgara_uret(x0: float, y0: float, z: float, dx: float, dy: float,
                satir: int, sutun: int, onek: str = "s") -> list[dict[str, Any]]:
    """Satır-öncelikli ızgara: 1 numara (x0, y0), sütun X'te, satır Y'de ilerler.

    Numaralandırma `gantry_studio.gen_seed_grid` ile aynı: `<önek>1..<önek>N`,
    satır-öncelikli. Tek satırlık bir ızgara böylece s1, s2, s3… oluyor.
    """
    satir = max(1, int(satir))
    sutun = max(1, int(sutun))
    onek = _ad_dogrula(onek or "s")
    if satir * sutun > AZAMI_NOKTA:
        raise NoktaHatasi(f"Izgara çok büyük: {satir * sutun} nokta")

    cikti = []
    sayac = 0
    for r in range(satir):
        for c in range(sutun):
            sayac += 1
            cikti.append({
                "ad": f"{onek}{sayac}",
                "x": round(float(x0) + c * float(dx), 1),
                "y": round(float(y0) + r * float(dy), 1),
                "z": round(float(z), 1),
                "etiket": "ızgara",
            })
    return cikti
