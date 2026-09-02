# -*- coding: utf-8 -*-
"""Bitki fotoğraf arşivi — büyüme filminin kaynağı.

NEDEN AYRI BİR DEPO. Kare halkası kamera başına 12 kare tutuyor ve tutmalı
da: amacı "az önce ne gördü", geçmiş değil. 5 saniyede bir kare çeken bir
kamerada 12 kare bir dakika demek. Bir büyüme filmi ise aylar demek. İkisini
aynı halkaya sığdırmaya çalışmak ya halkayı şişirip diski doldurur ya da
filmi bir dakikaya indirir.

O yüzden arşiv AYRI ve SEYREK: bitki başına günde bir kare, üst kameranın
karesinden KIRPILMIŞ küçük bir kare. Tam kare 40-100 KB; kırpılmış kare
5-8 KB. 20 bitki × 120 gün × 7 KB ≈ 17 MB — Pi'nin kartında sorun değil,
tam kare saklasaydık 200 MB olurdu.

KIRPMA PENCERESİ SABİT. Pencere, bitkinin O ANKİ yayılımına göre değil,
TÜRÜN OLGUN yayılımına göre seçiliyor. Yaşa göre büyüyen bir pencerede
bitki her karede aynı boyda görünür — yani büyüme filmi büyümeyi
göstermez. Sabit pencerede fide küçük başlar ve kareyi doldurur; filmin
bütün anlamı bu.

FİLM BİR EKİME AİT, BİR ADA DEĞİL. Klasör adı `<nokta adı>_<ekim damgası>`.
Hasat edilip aynı ada yeniden ekilen bir yerde, eski bitkinin fotoğrafları
yeni bitkinin filmine karışırdı — film "tohumdan bugüne" demek, "bu
koordinatta bugüne kadar" demek değil.

numpy/Pillow İSTEĞE BAĞLI. Yoksa arşiv sessizce kapalı kalıyor; sulama,
ekim ve hareket etkilenmiyor. Panelde de sebebi yazıyor.
"""
from __future__ import annotations

import io
import math
import os
import re
import time
from typing import Any

import kareler

# Kırpılan karenin kenar uzunluğu = olgun yayılım × bu çarpan. 1.8 seçildi:
# bitki kareyi doldurduğunda etrafında bir parça toprak kalıyor, yani
# yayılımın komşuya değdiği de görülüyor.
PENCERE_CARPAN = 1.8
EN_KUCUK_PENCERE_MM = 90.0
EN_BUYUK_PENCERE_MM = 420.0

# Saklanan karenin piksel boyu. Kare (1:1) — filmde kareler üst üste
# binerken en-boy oranı değişirse bitki zıplıyor.
KARE_PX = 240

# Kendiliğinden arşivleme aralığı. 20 saat: "günde bir" demek ama gün
# başına kilitlenmiyor; kullanıcı her gün aynı saatte bakmak zorunda değil.
ARALIK_SN = 20 * 3600.0

# Bir bitki için saklanan en fazla kare (≈ 8 ay günlük).
AZAMI_KARE_BITKI = 240

# Bütün arşivin üst sınırı. Aşılınca en eski kareler siliniyor.
AZAMI_TOPLAM_BAYT = 80 * 1024 * 1024

_AD_TEMIZ = re.compile(r"[^a-z0-9_-]+")


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
        return s if math.isfinite(s) else varsayilan
    except (TypeError, ValueError):
        return varsayilan


# --------------------------------------------------------------------------- #
# Yerleşim
# --------------------------------------------------------------------------- #
def _kok() -> str:
    veri = os.environ.get("VERI_YOLU", "")
    taban = os.path.dirname(veri) if veri else os.path.dirname(os.path.abspath(__file__))
    return os.path.join(taban or ".", "bahce_arsiv")


def film_kimlik(bitki: dict[str, Any]) -> str:
    """Bu EKİMİN klasör adı: `<ad>_<ekim damgası>`."""
    ad = _AD_TEMIZ.sub("-", str(bitki.get("ad") or "").strip().lower())[:40] or "nokta"
    ekim = int(_sayi(bitki.get("ekim"), 0.0))
    return f"{ad}_{ekim}"


def _klasor(kimlik: str, olustur: bool = False) -> str:
    yol = os.path.join(_kok(), kimlik)
    if olustur:
        os.makedirs(yol, exist_ok=True)
    return yol


def kareler_listesi(kimlik: str) -> list[dict[str, Any]]:
    """Bu filmin kareleri, eskiden yeniye."""
    yol = _klasor(kimlik)
    try:
        adlar = os.listdir(yol)
    except OSError:
        return []
    cikti = []
    for a in adlar:
        if not a.endswith(".jpg"):
            continue
        damga = a[:-4]
        try:
            ts = float(damga)
        except ValueError:
            continue
        try:
            bayt = os.path.getsize(os.path.join(yol, a))
        except OSError:
            bayt = 0
        cikti.append({"damga": damga, "ts": ts, "bayt": bayt})
    cikti.sort(key=lambda k: k["ts"])
    return cikti


def kare_oku(kimlik: str, damga: str) -> bytes | None:
    if not re.fullmatch(r"[0-9]+(\.[0-9]+)?", str(damga)):
        return None
    yol = os.path.join(_klasor(kimlik), f"{damga}.jpg")
    try:
        with open(yol, "rb") as d:
            return d.read()
    except OSError:
        return None


def son_damga(kimlik: str) -> float:
    """Bu filmin en yeni karesinin damgası — özetten, taramadan."""
    return float((ozet()["filmler"].get(kimlik) or {}).get("son") or 0.0)


# --------------------------------------------------------------------------- #
# Milimetre -> piksel (tespit.piksel_mm'in TERSİ)
# --------------------------------------------------------------------------- #
def mm_piksel(x_mm: float, y_mm: float, kare: dict[str, Any],
              kalib: dict[str, Any] | None,
              genislik_px: float | None = None,
              yukseklik_px: float | None = None) -> tuple[float, float]:
    """Makine koordinatının karedeki piksel karşılığı.

    `tespit.piksel_mm`in tersi; aynı sırayla geri alınıyor: önce dönme,
    sonra ayna, sonra ölçek. Sırayı değiştirmek dönme sıfırdan farklıyken
    sessizce kayan bir kırpma verir.
    """
    k = kalib or {}
    olcek = max(0.0, _sayi(k.get("mm_px")))
    if olcek <= 0:
        raise ValueError("kamera kalibre değil (mm_px = 0)")
    kal_w = _sayi(k.get("genislik_px"), 640.0)
    kal_h = _sayi(k.get("yukseklik_px"), 480.0)
    W = _sayi(genislik_px, 0.0) or kal_w
    H = _sayi(yukseklik_px, 0.0) or kal_h
    olcek_x = olcek * (kal_w / W)
    olcek_y = olcek * (kal_h / H)

    cx = _sayi(kare.get("x")) + _sayi(k.get("ofset_x"))
    cy = _sayi(kare.get("y")) + _sayi(k.get("ofset_y"))
    dx, dy = _sayi(x_mm) - cx, _sayi(y_mm) - cy

    aci = math.radians(_sayi(k.get("donme")))
    c, s = math.cos(aci), math.sin(aci)
    yerel_x = dx * c + dy * s
    yerel_y = -dx * s + dy * c
    if k.get("ayna_x"):
        yerel_x = -yerel_x
    if k.get("ayna_y"):
        yerel_y = -yerel_y
    return (yerel_x / olcek_x + W / 2.0, yerel_y / olcek_y + H / 2.0)


def pencere_mm(tur: dict[str, Any] | None) -> float:
    """Kırpma penceresinin kenarı (mm) — türün OLGUN yayılımından."""
    yayilim = _sayi((tur or {}).get("spread_mm"), 0.0)
    if yayilim <= 0:
        return EN_KUCUK_PENCERE_MM
    return max(EN_KUCUK_PENCERE_MM,
               min(EN_BUYUK_PENCERE_MM, yayilim * PENCERE_CARPAN))


# --------------------------------------------------------------------------- #
# Kare çekme
# --------------------------------------------------------------------------- #
# Pencere kareye sığmıyorsa küçültülüyor; bu kadarın altına inerse kare
# hiç çekilmiyor. Yatağın kenarındaki bir bitkiyi 40 mm'lik bir delikten
# izlemek film değil.
EN_KUCUK_SIGAN_MM = 60.0


def kirp(ham: bytes, x_mm: float, y_mm: float, kenar_mm: float,
         kalib: dict[str, Any], Image) -> bytes | None:
    """Tam kareden bitkinin çevresini kırpar. Sığmazsa PENCEREYİ KÜÇÜLTÜR.

    Bitki HER ZAMAN ortada kalıyor. Pencereyi kaydırarak sığdırmak daha
    çok toprak gösterirdi ama bitki karenin bir köşesine kayardı ve film
    büyüme yerine kayma gösterirdi. Küçültmek bunu bozmuyor: bitki
    yerinden oynamadığı için pencere de ömrü boyunca aynı kalıyor.

    Taşan kırpmayı siyahla doldurmuyoruz: yarısı boş bir kare, filme
    girdiğinde bitkiyi kaydırır.
    """
    im = Image.open(io.BytesIO(ham)).convert("RGB")
    kare = {"x": None, "y": None}          # sabit kamera: karenin konumu yok
    try:
        cx, cy = mm_piksel(x_mm, y_mm, kare, kalib, im.width, im.height)
    except ValueError:
        return None
    if not (0 <= cx < im.width and 0 <= cy < im.height):
        return None                        # bitki karenin dışında
    olcek = max(1e-9, _sayi(kalib.get("mm_px")))
    # Piksel/mm: kalibrasyonun piksel uzayı ile gerçek karenin piksel
    # uzayı farklı olabilir (kare küçültülmüş olabilir).
    px_mm = (1.0 / olcek) * (im.width / max(1.0, _sayi(kalib.get("genislik_px"), 640.0)))
    yari = kenar_mm / 2.0 * px_mm
    # Ortada kalarak sığan en büyük yarı kenar.
    sigan = min(yari, cx, cy, im.width - cx, im.height - cy)
    if sigan < EN_KUCUK_SIGAN_MM / 2.0 * px_mm:
        return None
    yari = sigan
    sol, ust = int(round(cx - yari)), int(round(cy - yari))
    sag, alt = int(round(cx + yari)), int(round(cy + yari))
    if sag - sol < 8 or alt - ust < 8:
        return None
    kirpik = im.crop((sol, ust, sag, alt)).resize((KARE_PX, KARE_PX))
    tampon = io.BytesIO()
    kirpik.save(tampon, "JPEG", quality=82)
    return tampon.getvalue()


def yaz(kimlik: str, veri: bytes, ts: float | None = None) -> str:
    """Kareyi diske yazar ve damgasını döndürür."""
    ts = time.time() if ts is None else float(ts)
    damga = f"{ts:.0f}"
    yol = _klasor(kimlik, olustur=True)
    with open(os.path.join(yol, f"{damga}.jpg"), "wb") as d:
        d.write(veri)
    ozet_bosalt()
    _buda_bitki(kimlik)
    _buda_toplam()
    return damga


def _buda_bitki(kimlik: str) -> None:
    liste = kareler_listesi(kimlik)
    fazla = len(liste) - AZAMI_KARE_BITKI
    yol = _klasor(kimlik)
    for k in liste[:max(0, fazla)]:
        try:
            os.remove(os.path.join(yol, f"{k['damga']}.jpg"))
        except OSError:
            pass


def _buda_toplam() -> None:
    """Bütün arşiv sınırı aşarsa en eski kareleri siler.

    Sınır bitki başına değil TOPLAM: otuz bitkinin her biri sınırın
    altında kalıp toplamda diski doldurabilir.
    """
    o = ozet(zorla=True)
    if o["bayt"] <= AZAMI_TOPLAM_BAYT:
        return
    hepsi: list[tuple[float, str, str, int]] = []
    toplam = 0
    for kimlik in o["filmler"]:
        for k in kareler_listesi(kimlik):
            hepsi.append((k["ts"], kimlik, k["damga"], k["bayt"]))
            toplam += k["bayt"]
    hepsi.sort()
    for ts, kimlik, damga, bayt in hepsi:
        if toplam <= AZAMI_TOPLAM_BAYT:
            break
        try:
            os.remove(os.path.join(_klasor(kimlik), f"{damga}.jpg"))
            toplam -= bayt
        except OSError:
            break


def filmler() -> list[str]:
    try:
        return sorted(a for a in os.listdir(_kok())
                      if os.path.isdir(os.path.join(_kok(), a)))
    except OSError:
        return []


# --------------------------------------------------------------------------- #
# Özet — bahçe ekranının her isteğinde arşivi baştan taramamak için
# --------------------------------------------------------------------------- #
# Bahçe ekranı her açılışta arşivi ÜÇ KEZ dolaşıyordu: bitki başına bir
# `listdir`, seri sayacı için bütün filmler, bir de toplam bayt. Yirmi
# bitki ve aylarca kare biriktiğinde bu, Pi'nin SD kartında saniyeler
# demek — ve saniyeler süren bir uç nokta, sunucu yeniden başlarken
# tarayıcıda "Failed to fetch" olarak görünen şeyin ta kendisi.
#
# Tek tarama, kısa ömürlü önbellek. Arşiv günde bir değişiyor; beş
# saniyelik bir önbellek hiçbir şeyi bayatlatmıyor ama tarama sayısını
# istek başına üçten sıfıra indiriyor.
_OZET: dict[str, Any] = {"ts": 0.0, "veri": None}
OZET_OMUR_SN = 5.0


def ozet(zorla: bool = False) -> dict[str, Any]:
    """{'filmler': {kimlik: {'adet','bayt','son'}}, 'bayt': toplam}."""
    simdi = time.time()
    if not zorla and _OZET["veri"] is not None and simdi - _OZET["ts"] < OZET_OMUR_SN:
        return _OZET["veri"]
    cikti: dict[str, Any] = {"filmler": {}, "bayt": 0, "gunler": []}
    kok = _kok()
    try:
        klasorler = list(os.scandir(kok))
    except OSError:
        klasorler = []
    for k in klasorler:
        if not k.is_dir():
            continue
        adet, bayt, son = 0, 0, 0.0
        try:
            for d in os.scandir(k.path):
                if not d.name.endswith(".jpg"):
                    continue
                try:
                    ts = float(d.name[:-4])
                except ValueError:
                    continue
                adet += 1
                try:
                    bayt += d.stat().st_size
                except OSError:
                    pass
                son = max(son, ts)
                cikti["gunler"].append(ts)
        except OSError:
            continue
        cikti["filmler"][k.name] = {"adet": adet, "bayt": bayt, "son": son}
        cikti["bayt"] += bayt
    _OZET["veri"], _OZET["ts"] = cikti, simdi
    return cikti


def ozet_bosalt() -> None:
    """Yazma sonrası önbelleği düşürür — yeni kare hemen görünsün."""
    _OZET["veri"] = None


def toplam_bayt() -> int:
    return int(ozet()["bayt"])


def sil(kimlik: str) -> int:
    """Bir filmin bütün karelerini siler. Kaç kare silindiğini döndürür."""
    yol = _klasor(kimlik)
    liste = kareler_listesi(kimlik)
    for k in liste:
        try:
            os.remove(os.path.join(yol, f"{k['damga']}.jpg"))
        except OSError:
            pass
    try:
        os.rmdir(yol)
    except OSError:
        pass
    ozet_bosalt()
    return len(liste)


# --------------------------------------------------------------------------- #
# Toplu çekim
# --------------------------------------------------------------------------- #
def cekilecekler(bitkiler_listesi: list[dict[str, Any]], simdi: float | None = None,
                 aralik_sn: float = ARALIK_SN) -> list[dict[str, Any]]:
    """Arşiv karesi vakti gelmiş bitkiler."""
    simdi = time.time() if simdi is None else simdi
    cikti = []
    for b in bitkiler_listesi:
        if not b.get("tur"):
            continue
        kimlik = film_kimlik(b)
        if simdi - son_damga(kimlik) >= aralik_sn:
            cikti.append(b)
    return cikti


def cek(bitkiler_listesi: list[dict[str, Any]], tur_indeks: dict[str, dict[str, Any]],
        kalib: dict[str, Any], Image, kamera: str = "ust",
        zorla: bool = False, simdi: float | None = None) -> dict[str, Any]:
    """Üst kameranın son karesinden verilen bitkiler için kare arşivler.

    Tek bir tam kare okunuyor ve hepsi ondan kırpılıyor: aynı anın
    fotoğrafı. Bitki başına ayrı kare okumak hem pahalı hem de yanlış —
    kareler arasında makine gölgesi gezerdi.
    """
    simdi = time.time() if simdi is None else simdi
    if max(0.0, _sayi(kalib.get("mm_px"))) <= 0:
        return {"ok": False, "sebep": "kalibrasyon-yok", "cekilen": [], "atlanan": []}
    ham = kareler.son(kareler.ad_temizle(kamera))
    if not ham:
        return {"ok": False, "sebep": "kare-yok", "cekilen": [], "atlanan": []}

    cekilen, atlanan = [], []
    for b in bitkiler_listesi:
        if not b.get("tur"):
            continue
        kimlik = film_kimlik(b)
        if not zorla and simdi - son_damga(kimlik) < ARALIK_SN:
            continue
        kenar = pencere_mm(tur_indeks.get(str(b.get("tur") or "")))
        try:
            veri = kirp(ham, _sayi(b.get("x")), _sayi(b.get("y")), kenar, kalib, Image)
        except Exception:                       # bozuk kare — arşiv sessiz kalsın
            veri = None
        if not veri:
            atlanan.append({"ad": b.get("ad"),
                            "sebep": "bitki karenin dışında ya da kenarına çok yakın"})
            continue
        yaz(kimlik, veri, simdi)
        cekilen.append({"ad": b.get("ad"), "kimlik": kimlik})
    return {"ok": True, "sebep": "", "cekilen": cekilen, "atlanan": atlanan}
