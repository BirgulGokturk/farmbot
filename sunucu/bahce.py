# -*- coding: utf-8 -*-
"""Bahçe modu — görev kartları, seri sayacı ve boş yer hesabı.

BU DOSYA KENDİ VERİSİNİ TUTMUYOR. Tek satır kalıcı hâli yok: her şey nokta
deposundan, tür kataloğundan, sensör okumalarından ve dikim alanlarından
hesaplanıyor. Sebebi basit — panelde "6 bitki susadı" yazarken bahçede
başka bir sayı yazsaydı hangisinin doğru olduğunu kimse bilemezdi.

Kartların hepsi GERÇEK BİR ÖLÇÜTTEN doğuyor ve her kart hangi ölçütten
doğduğunu `gerekce` alanında yazıyor. Uydurma görev yok; ölçüt yoksa kart
da yok. "Belki susamıştır" diye kart üretmek, kullanıcıyı boşuna makineye
koşturmak demek.

Susama kararında iki kanıt var ve hangisinin kullanıldığı söyleniyor:

  * ÖLÇÜLEN: bitkinin 100 mm yakınında son 24 saatte alınmış toprak nemi
    okuması varsa ve tür eşiği açıksa (%100 değilse), karar odur. Bu,
    sulama akışının kullandığı kanıtın AYNISI (`sulama.en_yakin_nem`) —
    kopyalamıyoruz, çağırıyoruz. İkisi ayrışırsa bahçe "susadı" derken
    sulama "atlandı" derdi.
  * GEÇEN GÜN: eşik kapalıysa ya da okuma yoksa, son sulamadan (hiç
    sulanmadıysa ekimden) geçen güne bakılıyor. Bu bir tahmin değil,
    ölçülebilir bir olgu; kart da bunu böyle yazıyor.

Hasat kartı yalnız ekim tarihi BİLİNEN bitkiler için çıkıyor. Tarih yoksa
kaç gün geçtiğini bilmiyoruz demektir ve "hasadın geldi" demek uydurma
olurdu.

TEK İSTİSNA: ERTELEME. "Yarın sor" bir KARAR, ölçüm değil — hiçbir yerden
türetilemiyor, o yüzden yazılması gerekiyor. Yeni bir dosya açmıyoruz,
zaten var olan SQLite'a tek satırlık bir tabloya yazıyoruz. Yazamazsak
bellekte tutuyoruz: erteleme kaybolabilir ama kartlar çalışmaya devam eder.

KART ŞERİDİ VE TAHTA AYNI HESABI KULLANIYOR. `kartlar()` susama ve hasat
hâlini KENDİ hesaplamıyor; çağıran ne hesapladıysa (`durumlar`) onu
alıyor. Eskiden ikisi ayrı ayrı çağırıyordu; aynı girdilerle aynı sonucu
verdikleri için pratikte tutuyorlardı ama bu bir tesadüftü — biri
değiştiğinde ekranda "4 bitki susadı" yazarken tahtada üç damla olurdu.
"""
from __future__ import annotations

import math
import threading
import time
from typing import Any

import depo
import dikim
import sulama

# Son sulamadan bu kadar gün geçtiyse "sulama zamanı". Tür başına bir su
# aralığı katalogda yok (`water_ml_per_day` günlük MİKTAR, aralık değil),
# o yüzden tek bir eşik: bir tam gün. Daha ince bir kural uydurmak, ölçüye
# dayanmayan bir sayıyı ölçüymüş gibi göstermek olurdu.
SUSAMA_GUN = 1.0

# Hasat kartı, olgunluk gününden bu kadar gün önce çıkmaya başlıyor.
HASAT_PAYI_GUN = 0.0

# Boş yer kartı en çok bu kadar yer öneriyor. Toplu işlem sınırı 40; 12
# hem onun altında hem de bir ekranda okunabilir.
AZAMI_ONERI = 12

# Boş yer taramasının adımı: yayılım çapının bu kadarda biri, en az 25 mm.
# Kaba tarama (yarım yayılım) sığan yeri kaçırıyordu — ızgara mevcut
# bitkilerin çemberine denk gelince o hücre eleniyor ve iki hücre arasında
# duran gerçek boşluk hiç sınanmıyordu. 400 hücrelik bir tarama beş
# bitkiyle 2000 uzaklık hesabı demek; ölçülemeyecek kadar ucuz.
TARAMA_BOLEN = 3.0
EN_KUCUK_ADIM_MM = 25.0

# "Yarın sor" kaçta sorsun. Sabit bir saat, "24 saat sonra"dan iyi: kart
# gece yarısı geri gelmiyor ve kullanıcı ertelediğinde ne zaman geri
# geleceğini TAM olarak biliyor — ekranda o saat yazıyor.
ERTELEME_SAATI = 7


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
        return s if math.isfinite(s) else varsayilan
    except (TypeError, ValueError):
        return varsayilan


# --------------------------------------------------------------------------- #
# Erteleme — "Yarın sor"
#
# Eski "Sonra" düğmesi kartı yalnız EKRANDAN siliyordu: sayfa yenilenince
# kart geri geliyordu ve kullanıcı erteledi mi, iptal mi etti, bir daha
# sorulacak mı bilmiyordu. Şimdi bir sözü var: yarın sabah yedide.
# --------------------------------------------------------------------------- #
_ERT_KILIT = threading.Lock()
_ERT_BELLEK: dict[str, float] = {}    # veritabanı yazılamazsa buraya


def _ert_tablo():
    """Erteleme tablosunu döndürür; veritabanı yoksa None.

    Ertelemenin çalışmaması kartların çalışmamasından iyi: hata yutulmuyor
    ama yukarı da fırlatılmıyor, bellek yedeğine düşüyoruz.
    """
    try:
        db = depo.baglan()
        db.execute("CREATE TABLE IF NOT EXISTS bahce_erteleme ("
                   "kimlik TEXT PRIMARY KEY, kadar REAL NOT NULL)")
        db.commit()
        return db
    except Exception:                                    # noqa: BLE001
        return None


def yarin_sabah(simdi: float | None = None, saat: int = ERTELEME_SAATI) -> float:
    """Bir sonraki sabahın damgası — YEREL saatle.

    UTC'ye göre hesaplamak, kullanıcıya "yarın 07:00'de" deyip başka bir
    saatte sormak olurdu.
    """
    simdi = time.time() if simdi is None else float(simdi)
    y = time.localtime(simdi + 86400.0)
    return time.mktime((y.tm_year, y.tm_mon, y.tm_mday, saat, 0, 0, 0, 0, -1))


def ertelemeler(simdi: float | None = None) -> dict[str, float]:
    """{kart kimliği: ne zamana kadar}. Süresi dolanlar temizleniyor."""
    simdi = time.time() if simdi is None else float(simdi)
    with _ERT_KILIT:
        db = _ert_tablo()
        if db is None:
            return {k: v for k, v in _ERT_BELLEK.items() if v > simdi}
        try:
            db.execute("DELETE FROM bahce_erteleme WHERE kadar <= ?", (simdi,))
            db.commit()
            return {str(s[0]): float(s[1]) for s in
                    db.execute("SELECT kimlik, kadar FROM bahce_erteleme")}
        except Exception:                                # noqa: BLE001
            return {k: v for k, v in _ERT_BELLEK.items() if v > simdi}


def ertele(kimlik: str, kadar: float | None = None,
           simdi: float | None = None) -> float:
    """Kartı ertele. `kadar` yoksa yarın sabah. -> ne zamana ertelendiği."""
    kimlik = str(kimlik or "").strip()
    if not kimlik:
        raise ValueError("Kart kimliği gerekiyor")
    kadar = yarin_sabah(simdi) if kadar is None else float(kadar)
    with _ERT_KILIT:
        _ERT_BELLEK[kimlik] = kadar
        db = _ert_tablo()
        if db is not None:
            try:
                db.execute("INSERT INTO bahce_erteleme (kimlik, kadar) VALUES (?, ?) "
                           "ON CONFLICT(kimlik) DO UPDATE SET kadar=excluded.kadar",
                           (kimlik, kadar))
                db.commit()
            except Exception:                            # noqa: BLE001
                pass
    return kadar


def erteleme_kaldir(kimlik: str) -> None:
    """Ertelemeyi geri al — kart hemen geri gelsin."""
    kimlik = str(kimlik or "").strip()
    with _ERT_KILIT:
        _ERT_BELLEK.pop(kimlik, None)
        db = _ert_tablo()
        if db is not None:
            try:
                db.execute("DELETE FROM bahce_erteleme WHERE kimlik = ?", (kimlik,))
                db.commit()
            except Exception:                            # noqa: BLE001
                pass


def saat_yaz(damga: float) -> str:
    """"yarın 07:00" / "bugün 07:00" / "5 Eylül 07:00" — yerel saatle."""
    t = time.localtime(float(damga))
    bugun = time.localtime()
    fark = (int(time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1)))
            - int(time.mktime((bugun.tm_year, bugun.tm_mon, bugun.tm_mday,
                               0, 0, 0, 0, 0, -1)))) // 86400
    saat = f"{t.tm_hour:02d}:{t.tm_min:02d}"
    if fark == 0:
        return f"bugün {saat}"
    if fark == 1:
        return f"yarın {saat}"
    aylar = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz",
             "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
    return f"{t.tm_mday} {aylar[t.tm_mon - 1]} {saat}"


def sure_yaz(saniye: float) -> str:
    """İnsanın söyleyeceği gibi bir süre.

    Gün'e yuvarlamak yalan söylüyordu: yarım gün önce sulanmış bir bitki
    için "1 gün geçti", iki saat önce sulanmış için "0 gün geçti" yazıyordu.
    İkisi de yanlış ve ikincisi anlamsız.
    """
    sn = max(0.0, _sayi(saniye))
    if sn < 3600:
        return f"{max(1, round(sn / 60)):.0f} dakika"
    if sn < 86400:
        return f"{sn / 3600:.0f} saat"
    gun = sn / 86400.0
    if gun < 2:
        return "1 gün"
    return f"{gun:.0f} gün"


def bitkiler(noktalar: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Türü yazılı olanlar. Ayrım paneldeki ile aynı: `tur` doluysa bitki."""
    return [n for n in (noktalar or []) if n.get("tur")]


def _tur(tur_indeks: dict[str, dict[str, Any]], bitki: dict[str, Any]) -> dict[str, Any]:
    return tur_indeks.get(str(bitki.get("tur") or "")) or {}


def _tur_ad(tur_indeks: dict[str, dict[str, Any]], bitki: dict[str, Any]) -> str:
    t = _tur(tur_indeks, bitki)
    return str(t.get("name_tr") or bitki.get("tur") or "bitki")


def _son_ilgi(bitki: dict[str, Any]) -> float:
    """Bu bitkiye en son ne zaman su gitti — hiç gitmediyse ekim zamanı.

    `sulama_ts` "su düştü" demek değil, "sulama komutu gitti" demek; akış
    sensörü yok. Kart da bunu bu şekilde yazıyor.
    """
    for alan in ("sulama_ts", "ekim"):
        d = bitki.get(alan)
        if d not in (None, ""):
            return _sayi(d)
    return 0.0


# --------------------------------------------------------------------------- #
# Susama
# --------------------------------------------------------------------------- #
def susama_durumu(bitki: dict[str, Any], tur: dict[str, Any] | None,
                  okumalar: list[dict[str, Any]], toprak_kalib: dict[str, Any] | None,
                  simdi: float) -> dict[str, Any]:
    """Bir bitkinin susama hâli — kanıtıyla birlikte.

    Dönen `kanit` alanı "olculen" ya da "gecen_gun": kartın hangi ölçüte
    dayandığını kullanıcıya yazabilmek için. Kanıtı gizlemek, kullanıcıya
    sebebini söylemeden iş yaptırmak olurdu.
    """
    ayar = sulama.ayar_coz(bitki, tur)
    esik = _sayi(ayar.get("sulama_nem_esigi"), 100.0)
    bx, by = _sayi(bitki.get("x")), _sayi(bitki.get("y"))

    # BİTKİNİN KENDİ ÖLÇÜMÜ VARSA O KAZANIR.
    #
    # Nem probu artık makinenin üstünde kalıcı ve "nemini ölç" dendiğinde
    # makine o bitkinin üstüne gidip probu daldırıyor; okunan değer
    # noktanın kaydına yazılıyor (`nem_yuzde`, `nem_ts`). Bu ölçüm
    # bitkinin TAM YERİNDEN ve o bitki için alınmış — 90 mm ötede
    # gezinirken alınmış bir okumadan her zaman iyi. Eskisi (yarıçap
    # içindeki en taze okuma) yedek olarak duruyor: prob henüz o bitkiye
    # gitmediyse elimizdeki tek şey o.
    kendi = bitki.get("nem_yuzde")
    kendi_ts = _sayi(bitki.get("nem_ts"), 0.0)
    kendi_yas = simdi - kendi_ts if kendi_ts else None
    if (kendi not in (None, "") and kendi_yas is not None
            and 0 <= kendi_yas <= sulama.NEM_AZAMI_YAS_SN):
        yuzde, uzak, yas = _sayi(kendi), 0.0, kendi_yas
        kendi_olcum = True
    else:
        yuzde, uzak, yas = sulama.en_yakin_nem(
            bx, by, okumalar, simdi, toprak_kalib)
        kendi_olcum = False

    # ÖLÇÜMÜN KÜNYESİ HER ZAMAN DÖNÜYOR — karar ona dayanmasa bile. Kart
    # "ölçülen toprak nemi" derken sayıyı göstermiyordu; kullanıcı kaç
    # ölçüldüğünü, eşiğin kaç olduğunu ve okumanın bitkiye ne kadar yakın
    # olduğunu göremiyordu. Ölçüt yazıp ölçümü saklamak, gerekçe
    # göstermemekle aynı şey.
    # ÖLÇÜM SULAMADAN ÖNCEYSE BAYAT. Okuma penceresi 24 saat; su döküldükten
    # sonra o noktada yeni bir ölçüm alınmadıysa en taze okuma hâlâ sulama
    # ÖNCESİNİN kuru toprağı oluyor ve kart sulanmış bitkiye "susadı"
    # demeye devam ediyordu. Kanıtın eylemden eski olduğunu görüp geçen
    # güne düşüyoruz — ölçümü uydurmuyoruz, sadece güvenmiyoruz.
    sulama_ts = _sayi(bitki.get("sulama_ts"), 0.0)
    olcum_ts = (simdi - _sayi(yas, 0.0)) if yuzde is not None else 0.0
    bayat = bool(yuzde is not None and sulama_ts and sulama_ts > olcum_ts)

    olcum = {
        "var": yuzde is not None,
        "bayat": bayat,
        # Bu okuma BİTKİNİN KENDİ ölçümü mü, yoksa yakınlarda alınmış bir
        # okuma mı. Kart bunu yazıyor: "kendi üstünden" ile "90 mm ötede"
        # aynı güvenilirlikte değil.
        "kendi": kendi_olcum,
        "yuzde": None if yuzde is None else round(float(yuzde), 1),
        "uzak_mm": None if uzak is None else round(float(uzak), 1),
        "yas_sn": None if yas is None else round(float(yas), 1),
        "esik": esik,
        "esik_acik": esik < 100.0,
        "yaricap_mm": sulama.NEM_YARICAP_MM,
        "azami_yas_sn": sulama.NEM_AZAMI_YAS_SN,
    }

    if esik < 100.0 and yuzde is not None and not bayat:
        susadi = yuzde < esik
        return {
            "susadi": susadi, "kanit": "olculen", "nem_yuzde": yuzde,
            "nem_esigi": esik, "olcum": olcum, "tahmin": False,
            "gerekce": (
                f"toprak nemi %{yuzde:.0f} "
                f"{'<' if susadi else '≥'} eşik %{esik:.0f} ("
                + (f"kendi üstünden, {yas / 60:.0f} dk önce" if kendi_olcum
                   else f"{uzak:.0f} mm ötede, {yas / 60:.0f} dk önce")
                + ")"),
        }

    # Ölçüm yok ya da eşik kapalı: geçen güne bakıyoruz. BU BİR TAHMİN ve
    # kart da öyle yazıyor — ölçüye dayanmayan bir kararı ölçüymüş gibi
    # göstermek, kullanıcıya yalan söylemek olurdu.
    son = _son_ilgi(bitki)
    gecen = (simdi - son) / 86400.0 if son else None
    if gecen is None:
        return {"susadi": False, "kanit": "yok", "nem_yuzde": yuzde,
                "nem_esigi": esik, "olcum": olcum, "tahmin": True,
                "gerekce": "ne sulama ne ekim tarihi var — bilmiyoruz"}
    hic_sulanmadi = bitki.get("sulama_ts") in (None, "")
    if bayat:
        neden = (f"son ölçüm (%{yuzde:.0f}) sulamadan ÖNCE alınmış — "
                 f"o noktada yeni ölçüm yok")
    elif not olcum["esik_acik"]:
        neden = ("nem eşiği kapalı (%100)" if yuzde is None else
                 f"toprak nemi %{yuzde:.0f} ölçüldü ama nem eşiği kapalı (%100)")
    else:
        neden = (f"son {sure_yaz(sulama.NEM_AZAMI_YAS_SN)} içinde "
                 f"{sulama.NEM_YARICAP_MM:.0f} mm yakınında ölçüm yok")
    return {
        "susadi": gecen >= SUSAMA_GUN, "kanit": "gecen_gun",
        "nem_yuzde": yuzde, "nem_esigi": esik, "gecen_gun": gecen,
        "olcum": olcum, "tahmin": True,
        "gerekce": (f"{'ekildiğinden' if hic_sulanmadi else 'son sulamadan'} "
                    f"beri {sure_yaz(simdi - son)} geçti · {neden}"),
    }


# --------------------------------------------------------------------------- #
# Hasat
# --------------------------------------------------------------------------- #
def hasat_durumu(bitki: dict[str, Any], tur: dict[str, Any] | None,
                 simdi: float) -> dict[str, Any]:
    """Olgunluk hâli. Ekim tarihi yoksa karar YOK — uydurmuyoruz."""
    t = tur or {}
    olgun = _sayi(t.get("days_to_harvest"), 0.0)
    if bitki.get("ekim") in (None, "") or olgun <= 0:
        return {"hazir": False, "bilinmiyor": True, "gun": None, "olgun": olgun,
                "gerekce": "ekim tarihi ya da olgunluk süresi yok"}
    gun = sulama.yas_gun(bitki, simdi)
    hazir = gun >= (olgun - HASAT_PAYI_GUN)
    return {
        "hazir": hazir, "bilinmiyor": False, "gun": gun, "olgun": olgun,
        "oran": max(0.0, min(1.0, gun / olgun)) if olgun else 0.0,
        "gerekce": (f"ekildiğinden {gun:.0f} gün geçti, olgunluk {olgun:.0f} gün"),
    }


# --------------------------------------------------------------------------- #
# Boş yer
# --------------------------------------------------------------------------- #
def bos_yerler(noktalar: list[dict[str, Any]], yaricaplar: dict[str, float],
               alanlar: list[dict[str, Any]], yayilim_mm: float,
               sinirlar: dict[str, Any] | None = None,
               azami: int = AZAMI_ONERI) -> list[dict[str, float]]:
    """Dikim alanlarında bu yayılıma sığan boş noktalar.

    Yer "boş" demek üç şeyin birden doğru olması: dikim alanının içinde,
    yumuşak sınırların içinde ve hiçbir mevcut bitkinin yayılım çemberine
    girmiyor. Üçünü de burada tek yerde sınıyoruz ki kartın önerdiği yer
    ekim akışında reddedilmesin — kullanıcıya "şuraya ek" deyip sonra
    "olmaz" demek, hiç önermemekten kötü.
    """
    if yayilim_mm <= 0 or not alanlar:
        return []
    r = yayilim_mm / 2.0
    adim = max(EN_KUCUK_ADIM_MM, yayilim_mm / TARAMA_BOLEN)
    mevcut = [(_sayi(n.get("x")), _sayi(n.get("y")),
               _sayi(yaricaplar.get(n.get("ad")), r))
              for n in bitkiler(noktalar)]

    sx = (sinirlar or {}).get("x") or {}
    sy = (sinirlar or {}).get("y") or {}
    x_alt, x_ust = _sayi(sx.get("min"), -1e9), _sayi(sx.get("max"), 1e9)
    y_alt, y_ust = _sayi(sy.get("min"), -1e9), _sayi(sy.get("max"), 1e9)

    cikti: list[dict[str, float]] = []
    for alan in alanlar:
        x1, x2 = sorted((_sayi(alan.get("x1")), _sayi(alan.get("x2"))))
        y1, y2 = sorted((_sayi(alan.get("y1")), _sayi(alan.get("y2"))))
        x = x1 + r
        while x <= x2 - r:
            y = y1 + r
            while y <= y2 - r:
                if x_alt <= x <= x_ust and y_alt <= y <= y_ust:
                    kabul, _, _ = dikim.nokta_kabul(x, y, alanlar)
                    if kabul and all(
                            math.hypot(x - mx, y - my) >= (r + mr) * 0.98
                            for mx, my, mr in mevcut):
                        cikti.append({"x": round(x, 1), "y": round(y, 1)})
                        mevcut.append((x, y, r))
                        if len(cikti) >= azami:
                            return cikti
                y += adim
            x += adim
    return cikti


# --------------------------------------------------------------------------- #
# Seri sayacı
# --------------------------------------------------------------------------- #
def ilgi_gunleri(noktalar: list[dict[str, Any]],
                 ek_damgalar: list[float] | None = None) -> set[int]:
    """Bahçeyle ilgilenilen günler — MEVCUT VERİDEN türetiliyor.

    Yeni bir "günlük" dosyası tutmuyoruz: ekim tarihi, sulama damgası ve
    arşivdeki fotoğrafın tarihi zaten kayıtlı. Üçünün birleşimi "o gün
    bahçeye dokunuldu" demek için yeterli ve ikinci bir gerçek doğurmuyor.
    """
    gunler: set[int] = set()
    for n in (noktalar or []):
        for alan in ("ekim", "sulama_ts"):
            d = n.get(alan)
            if d not in (None, ""):
                gunler.add(int(_sayi(d) // 86400))
    for d in (ek_damgalar or []):
        gunler.add(int(_sayi(d) // 86400))
    return gunler


def seri(gunler: set[int], simdi: float | None = None) -> dict[str, Any]:
    """Kaç gün üst üste. Bugün boşsa dün'den sayıyor — gün henüz bitmedi.

    Bugün hiçbir şey yapılmamış olması seriyi HEMEN bozmuyor: saat 09:00'da
    "serin bitti" demek, günün kalanını yok saymak olurdu.
    """
    simdi = time.time() if simdi is None else simdi
    bugun = int(simdi // 86400)
    if not gunler:
        return {"gun": 0, "bugun_var": False, "son": None}
    bugun_var = bugun in gunler
    basla = bugun if bugun_var else bugun - 1
    if basla not in gunler:
        return {"gun": 0, "bugun_var": bugun_var, "son": max(gunler)}
    n = 0
    g = basla
    while g in gunler:
        n += 1
        g -= 1
    return {"gun": n, "bugun_var": bugun_var, "son": max(gunler)}


# --------------------------------------------------------------------------- #
# Kartlar
# --------------------------------------------------------------------------- #
def kartlar(noktalar: list[dict[str, Any]], tur_indeks: dict[str, dict[str, Any]],
            yaricaplar: dict[str, float],
            alanlar: list[dict[str, Any]],
            durumlar: dict[str, dict[str, Any]],
            hazne_turleri: list[str] | None = None,
            sinirlar: dict[str, Any] | None = None,
            simdi: float | None = None,
            ertelenmis: dict[str, float] | None = None) -> list[dict[str, Any]]:
    """Bugünün görev kartları. Ölçüt yoksa kart yok.

    `durumlar` ZORUNLU ve dışarıdan geliyor: {bitki adı: {"su": …, "hasat": …}}.
    Kart şeridi ile tahtanın aynı şeyi söylemesinin tek garantisi bu — kart
    "4 bitki susadı" diyorsa o dördü, tahtada damla gösterilen bitkilerin
    ta kendisi.
    """
    simdi = time.time() if simdi is None else simdi
    ertelenmis = ertelenmis if ertelenmis is not None else ertelemeler(simdi)
    hepsi = bitkiler(noktalar)
    cikti: list[dict[str, Any]] = []

    def _kart(k: dict[str, Any]) -> None:
        kadar = ertelenmis.get(k["kimlik"])
        if kadar and kadar > simdi:
            k["ertelendi"] = kadar
            k["ertelendi_yazi"] = saat_yaz(kadar)
        cikti.append(k)

    # --- susayanlar ------------------------------------------------------
    susayan, gerekceler, olcumler = [], [], []
    for b in hepsi:
        d = (durumlar.get(str(b.get("ad"))) or {}).get("su") or {}
        if d.get("susadi"):
            susayan.append(b)
            gerekceler.append(f"{b.get('ad')}: {d.get('gerekce') or ''}")
            o = dict(d.get("olcum") or {})
            o.update({"ad": b.get("ad"), "tur_ad": _tur_ad(tur_indeks, b),
                      "kanit": d.get("kanit"), "gerekce": d.get("gerekce"),
                      "gecen_gun": d.get("gecen_gun")})
            olcumler.append(o)
    if susayan:
        adlar = [str(b.get("ad")) for b in susayan][:40]
        olculen = [o for o in olcumler if o.get("kanit") == "olculen"]
        tahmin = [o for o in olcumler if o.get("kanit") != "olculen"]
        # Kartın eşiği: bu karttaki türlerin eşikleri aynıysa o sayı,
        # farklıysa None — tek bir kutuda göstermek yanlış olurdu.
        esikler = {round(_sayi(o.get("esik"), 100.0), 1) for o in olcumler}
        slugler: list[str] = []
        for b in susayan:
            s = str(b.get("tur") or "")
            if s and s not in slugler:
                slugler.append(s)
        cikti_olcum = sorted(
            olcumler,
            key=lambda o: (0 if o.get("kanit") == "olculen" else 1,
                           _sayi(o.get("yuzde"), 999.0)))
        _kart({
            "kimlik": "sula",
            "tip": "sula",
            "simge": "💧",
            "baslik": (f"{len(susayan)} bitki susadı" if len(susayan) > 1
                       else f"{_tur_ad(tur_indeks, susayan[0])} susadı"),
            "aciklama": _liste_yaz(
                [_tur_ad(tur_indeks, b) for b in susayan]) + " sulanacak.",
            "gerekce": gerekceler[:6],
            "kanit": ("ölçülen toprak nemi" if olculen and not tahmin else
                      "son sulamadan geçen gün" if tahmin and not olculen else
                      "kimi ölçülen nem, kimi geçen gün"),
            "olcumler": cikti_olcum[:8],
            "olculen_adet": len(olculen),
            "tahmin_adet": len(tahmin),
            "tahmin": bool(tahmin),
            "esik": esikler.pop() if len(esikler) == 1 else None,
            "turler": slugler,
            "evet": "Sula",
            "noktalar": adlar,
        })

    # --- hasadı gelenler -------------------------------------------------
    hasat, hasat_gerekce = [], []
    for b in hepsi:
        d = (durumlar.get(str(b.get("ad"))) or {}).get("hasat") or {}
        if d.get("hazir"):
            hasat.append(b)
            hasat_gerekce.append(f"{b.get('ad')}: {d.get('gerekce') or ''}")
    if hasat:
        _kart({
            "kimlik": "hasat",
            "tip": "hasat",
            "simge": "🧺",
            "baslik": (f"{len(hasat)} bitki hasada hazır" if len(hasat) > 1
                       else f"{_tur_ad(tur_indeks, hasat[0])} hasada hazır"),
            "aciklama": _liste_yaz([_tur_ad(tur_indeks, b) for b in hasat])
                        + " olgunluk süresini doldurdu. Toplayınca bahçeden düşer.",
            "gerekce": hasat_gerekce[:6],
            "kanit": "ekimden geçen gün · türün olgunluk süresi",
            "evet": "Fotoğrafla",
            "noktalar": [str(b.get("ad")) for b in hasat][:40],
        })

    # --- boş yer ---------------------------------------------------------
    kart = bos_yer_karti(noktalar, tur_indeks, yaricaplar, alanlar,
                         hazne_turleri, sinirlar)
    if kart:
        _kart(kart)
    return cikti


def tur_secenekleri(tur_indeks: dict[str, dict[str, Any]],
                    hazne_turleri: list[str] | None = None
                    ) -> list[dict[str, Any]]:
    """Ekilebilecek türler — haznede tohumu olanlar önde.

    TÜRÜ BİZ SEÇMİYORUZ. Eskiden kart "en son ekilen tür"ü kendi seçip
    "12 tane daha maydanoz sığıyor" diyordu; kullanıcı maydanozu seçmemişti.
    Şimdi seçenekleri sıralıyoruz, sayıyı seçilen türün KENDİ yayılım
    çapından hesaplıyoruz — marul seçilince sayı gerçekten değişiyor.
    """
    hazneli = set(hazne_turleri or [])
    liste = []
    for slug, t in (tur_indeks or {}).items():
        yayilim = _sayi(t.get("spread_mm"), 0.0)
        if yayilim <= 0:
            continue
        liste.append({
            "slug": slug,
            "ad": t.get("name_tr") or slug,
            "simge": t.get("icon") or "🌱",
            "yayilim_mm": round(yayilim, 1),
            "hazne": slug in hazneli,
        })
    liste.sort(key=lambda t: (0 if t["hazne"] else 1, t["yayilim_mm"], t["ad"]))
    return liste


def bos_yer_karti(noktalar: list[dict[str, Any]],
                  tur_indeks: dict[str, dict[str, Any]],
                  yaricaplar: dict[str, float],
                  alanlar: list[dict[str, Any]],
                  hazne_turleri: list[str] | None = None,
                  sinirlar: dict[str, Any] | None = None
                  ) -> dict[str, Any] | None:
    """"N boş yer var" — TÜR SEÇİLMEDEN.

    Başlıktaki sayının bir tabanı olmak zorunda: yayılım çapı bilinmeden
    kaç bitki sığdığı hesaplanamaz. Taban, HAZNEDEKİ en dar yayılımlı tohum
    — yani "en iyi ihtimalle bu kadar". Kart bunu saklamıyor, taban türü
    adıyla yazıyor; kullanıcı bir tür seçince sayı o türe göre yeniden
    hesaplanıyor ve genelde düşüyor.
    """
    secenekler = tur_secenekleri(tur_indeks, hazne_turleri)
    if not secenekler or not alanlar:
        return None
    taban = secenekler[0]
    yerler = bos_yerler(noktalar, yaricaplar, alanlar, taban["yayilim_mm"], sinirlar)
    if not yerler:
        return None
    return {
        "kimlik": "bos-yer",
        "tip": "ek",
        "simge": "🌱",
        "baslik": (f"{len(yerler)}+ boş yer var" if len(yerler) >= AZAMI_ONERI
                   else f"{len(yerler)} boş yer var"),
        "aciklama": "Ne ekelim? Tür seçince kaç tane sığdığını hesaplarım.",
        "gerekce": [f"taban: {taban['ad']} · yayılım {taban['yayilim_mm']:.0f} mm"],
        "kanit": "dikim alanı · seçilen türün yayılım çapı",
        "evet": "Ek",
        "tur": "",                       # SEÇİLMEDİ — Ek düğmesi kapalı
        "taban_tur": taban["slug"],
        "taban_ad": taban["ad"],
        "secenekler": secenekler[:24],
        "adet": len(yerler),
        "sinirda": len(yerler) >= AZAMI_ONERI,
        "yerler": yerler,
    }


def _liste_yaz(adlar: list[str], azami: int = 3) -> str:
    """"marul, fesleğen ve 2 tane daha" — ekrana sığan bir liste."""
    benzersiz: list[str] = []
    for a in adlar:
        if a not in benzersiz:
            benzersiz.append(a)
    if not benzersiz:
        return ""
    if len(benzersiz) <= azami:
        if len(benzersiz) == 1:
            return benzersiz[0].capitalize()
        return (", ".join(benzersiz[:-1]) + " ve " + benzersiz[-1]).capitalize()
    kalan = len(benzersiz) - azami
    return (", ".join(benzersiz[:azami]) + f" ve {kalan} tane daha").capitalize()
