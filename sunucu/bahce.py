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
"""
from __future__ import annotations

import math
import time
from typing import Any

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


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
        return s if math.isfinite(s) else varsayilan
    except (TypeError, ValueError):
        return varsayilan


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
    yuzde, uzak, yas = sulama.en_yakin_nem(bx, by, okumalar, simdi, toprak_kalib)

    if esik < 100.0 and yuzde is not None:
        susadi = yuzde < esik
        return {
            "susadi": susadi, "kanit": "olculen", "nem_yuzde": yuzde,
            "nem_esigi": esik,
            "gerekce": (f"toprak nemi %{yuzde:.0f} < eşik %{esik:.0f} "
                        f"({uzak:.0f} mm ötede, {yas / 60:.0f} dk önce)"
                        if susadi else
                        f"toprak nemi %{yuzde:.0f} ≥ eşik %{esik:.0f}"),
        }

    # Ölçüm yok ya da eşik kapalı: geçen güne bakıyoruz.
    son = _son_ilgi(bitki)
    gecen = (simdi - son) / 86400.0 if son else None
    if gecen is None:
        return {"susadi": False, "kanit": "yok", "nem_yuzde": yuzde,
                "nem_esigi": esik,
                "gerekce": "ne sulama ne ekim tarihi var — bilmiyoruz"}
    hic_sulanmadi = bitki.get("sulama_ts") in (None, "")
    return {
        "susadi": gecen >= SUSAMA_GUN, "kanit": "gecen_gun",
        "nem_yuzde": yuzde, "nem_esigi": esik, "gecen_gun": gecen,
        "gerekce": (f"{'ekildiğinden' if hic_sulanmadi else 'son sulamadan'} "
                    f"beri {sure_yaz(simdi - son)} geçti"
                    + ("" if esik < 100.0 else " · nem eşiği kapalı (%100)")),
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
            yaricaplar: dict[str, float], okumalar: list[dict[str, Any]],
            toprak_kalib: dict[str, Any] | None,
            alanlar: list[dict[str, Any]],
            sinirlar: dict[str, Any] | None = None,
            simdi: float | None = None) -> list[dict[str, Any]]:
    """Bugünün görev kartları. Ölçüt yoksa kart yok."""
    simdi = time.time() if simdi is None else simdi
    hepsi = bitkiler(noktalar)
    cikti: list[dict[str, Any]] = []

    # --- susayanlar ------------------------------------------------------
    susayan, gerekceler = [], []
    for b in hepsi:
        d = susama_durumu(b, _tur(tur_indeks, b), okumalar, toprak_kalib, simdi)
        if d["susadi"]:
            susayan.append(b)
            gerekceler.append(f"{b.get('ad')}: {d['gerekce']}")
    if susayan:
        adlar = [str(b.get("ad")) for b in susayan][:40]
        olculen = any("nemi" in g for g in gerekceler)
        cikti.append({
            "kimlik": "sula",
            "tip": "sula",
            "simge": "💧",
            "baslik": (f"{len(susayan)} bitki susadı" if len(susayan) > 1
                       else f"{_tur_ad(tur_indeks, susayan[0])} susadı"),
            "aciklama": _liste_yaz(
                [_tur_ad(tur_indeks, b) for b in susayan]) + " sulanacak.",
            "gerekce": gerekceler[:6],
            "kanit": "ölçülen toprak nemi" if olculen else "son sulamadan geçen gün",
            "evet": "Sula",
            "noktalar": adlar,
        })

    # --- hasadı gelenler -------------------------------------------------
    hasat, hasat_gerekce = [], []
    for b in hepsi:
        d = hasat_durumu(b, _tur(tur_indeks, b), simdi)
        if d["hazir"]:
            hasat.append(b)
            hasat_gerekce.append(f"{b.get('ad')}: {d['gerekce']}")
    if hasat:
        cikti.append({
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
    tur_slug = _son_ekilen_tur(hepsi)
    tur = tur_indeks.get(tur_slug) or {}
    yayilim = _sayi(tur.get("spread_mm"), 0.0)
    if tur_slug and yayilim > 0:
        yerler = bos_yerler(noktalar, yaricaplar, alanlar, yayilim, sinirlar)
        if yerler:
            cikti.append({
                "kimlik": "bos-yer",
                "tip": "ek",
                "simge": "🌱",
                "baslik": f"{len(yerler)} boş yer var",
                "aciklama": (f"Dikim alanında {len(yerler)} tane daha "
                             f"{tur.get('name_tr') or tur_slug} sığıyor."),
                "gerekce": [f"yayılım {yayilim:.0f} mm · dikim alanının içinde "
                            f"ve mevcut bitkilerin çemberine girmiyor"],
                "kanit": "dikim alanı · yayılım çapı",
                "evet": "Ek",
                "tur": tur_slug,
                "yerler": yerler,
            })
    return cikti


def _son_ekilen_tur(hepsi: list[dict[str, Any]]) -> str:
    """En son ekilen tür — öneri buradan doğuyor.

    Sabit bir tür ("marul") önermek, bahçesinde hiç marul olmayan birine
    marul önermek demekti. Bahçede ne varsa onun devamı öneriliyor.
    """
    en_yeni, slug = -1.0, ""
    for b in hepsi:
        t = _sayi(b.get("ekim"), 0.0)
        if t > en_yeni:
            en_yeni, slug = t, str(b.get("tur") or "")
    if slug:
        return slug
    sayim: dict[str, int] = {}
    for b in hepsi:
        s = str(b.get("tur") or "")
        sayim[s] = sayim.get(s, 0) + 1
    return max(sayim, key=sayim.get) if sayim else ""


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
