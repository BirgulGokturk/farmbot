"""Toprağı karede bul, çevresine bir DÖRTGEN çıkar. Yalnız numpy + Pillow.

ROI elle çiziliyordu; kap eğik durduğu için dört köşeyi tek tek sürüklemek
gerekiyordu. Toprak renkçe çevresinden belirgin ayrı, o hâlde dörtgeni
makine çıkarabilir.

EŞİKLER ÖLÇÜLDÜ (kullanıcının kendi karesi, R-B = kırmızı eksi mavi):
    toprak 42,2 / doygunluk 0,508   beyaz plastik 8,5 / 0,185
    alüminyum 21,3 / 0,132          duvar 6,0 / 0,043   masa 1,1 / 0,108
Kapı ortadan geçiyor: R-B > 25 ve doygunluk > 0,30.

AÇMA YARIÇAPI DA ÖLÇÜLDÜ. Sarı hortum da sıcak tonlu ve toprağa değiyor;
ince bağlantı dışbükey zarfı köprü braketine kadar çekiyordu. 450x798
karede dörtgen doluluğu: yarıçap 1 -> 0,820 · 3 -> 0,953 · 6 -> 0,899 ·
8 -> 0,692 (toprak da aşınıyor). Seçilen: min(en,boy)'un %0,7'si.

ÖNCE KÜÇÜLTÜLÜYOR. Uzun kenar 320 piksele indiriliyor: bileşen etiketleme
saf Python ve tam çözünürlükte (2160x3840) dakikalar sürerdi. Köşeler
ORANLI döndüğü için küçültme sonucu değiştirmiyor — ölçüldü, 2x ve 0,5x
ölçekte aynı köşeler çıktı.
"""
from __future__ import annotations

import io
from typing import Any

import numpy as np

RB_ESIK = 25.0
DOY_ESIK = 0.30
ACMA_ORANI = 0.007
EN_AZ_ORAN = 0.02
#: Zarf en çok bu kadar köşeye iniyor — panelde her köşe bir tutamak,
#: 24'ten fazlası sürüklenemez hâle geliyor.
AZAMI_KOSE = 24
CALISMA_KENARI = 320


def _pencere_sayisi(m: np.ndarray, yaricap: int) -> np.ndarray:
    """Her pikselin (2r+1)^2 penceresindeki dolu piksel sayısı.

    Toplamsal görüntü (integral image) ile: pencere boyu ne olursa olsun
    maliyet aynı. Kenarlar sıfırla dolduruluyor, yani kenardaki pencere
    hiçbir zaman tam dolmuyor ve aşınma orayı siliyor — istenen de bu.
    """
    p = np.zeros((m.shape[0] + 1, m.shape[1] + 1), np.int32)
    p[1:, 1:] = np.cumsum(np.cumsum(m.astype(np.int32), 0), 1)
    h, w = m.shape
    y1 = np.clip(np.arange(h) - yaricap, 0, h)
    y2 = np.clip(np.arange(h) + yaricap + 1, 0, h)
    x1 = np.clip(np.arange(w) - yaricap, 0, w)
    x2 = np.clip(np.arange(w) + yaricap + 1, 0, w)
    return (p[np.ix_(y2, x2)] - p[np.ix_(y1, x2)]
            - p[np.ix_(y2, x1)] + p[np.ix_(y1, x1)])


def _asin(m, r):
    return _pencere_sayisi(m, r) == (2 * r + 1) ** 2


def _genislet(m, r):
    return _pencere_sayisi(m, r) > 0


def _ac_kapa(m, ac_r, kapa_r):
    """Önce AÇMA (gürültüyü ve ince uzantıları siler), sonra KAPAMA
    (toprağın içindeki taş/fide boşluklarını doldurur). Sıra önemli:
    tersi, hortum gibi ince bağlantıları önce kalınlaştırırdı."""
    a = _genislet(_asin(m, ac_r), ac_r)
    return _asin(_genislet(a, kapa_r), kapa_r)


def _en_buyuk_bilesen(m: np.ndarray) -> np.ndarray | None:
    """En büyük 8-komşuluk bileşeni. Koşu tabanlı birleşim-bulma:
    piksel piksel dolaşmak yerine satırdaki ardışık dolu diziler tek
    birim sayılıyor."""
    h, w = m.shape
    ata = [0]

    def kok(a):
        while ata[a] != a:
            ata[a] = ata[ata[a]]
            a = ata[a]
        return a

    def birles(a, b):
        ra, rb = kok(a), kok(b)
        if ra != rb:
            ata[max(ra, rb)] = min(ra, rb)

    onceki: list[tuple[int, int, int]] = []
    kosular: list[list[tuple[int, int, int]]] = []
    for y in range(h):
        satir = m[y]
        if not satir.any():
            onceki = []
            kosular.append([])
            continue
        d = np.diff(np.concatenate(([0], satir.view(np.int8), [0])))
        bas = np.flatnonzero(d == 1)
        son = np.flatnonzero(d == -1)
        simdiki = []
        for b, e in zip(bas.tolist(), son.tolist()):
            ata.append(len(ata))
            et = len(ata) - 1
            for pb, pe, pet in onceki:
                if pb <= e and b <= pe:          # 8-komşuluk: köşeler dahil
                    birles(et, pet)
            simdiki.append((b, e, et))
        kosular.append(simdiki)
        onceki = simdiki

    if len(ata) <= 1:
        return None
    boy: dict[int, int] = {}
    for satir in kosular:
        for b, e, et in satir:
            r = kok(et)
            boy[r] = boy.get(r, 0) + (e - b)
    en = max(boy, key=boy.get)
    cikti = np.zeros((h, w), bool)
    for y, satir in enumerate(kosular):
        for b, e, et in satir:
            if kok(et) == en:
                cikti[y, b:e] = True
    return cikti


def _zarf(noktalar):
    """Dışbükey zarf (Andrew monoton zinciri)."""
    p = sorted(set(noktalar))
    if len(p) < 3:
        return p

    def yari(ps):
        y = []
        for n in ps:
            while len(y) >= 2:
                (x1, y1), (x2, y2) = y[-2], y[-1]
                if (x2 - x1) * (n[1] - y1) - (y2 - y1) * (n[0] - x1) <= 0:
                    y.pop()
                else:
                    break
            y.append(n)
        return y

    return yari(p)[:-1] + yari(p[::-1])[:-1]


def _ucgen(a, b, c) -> float:
    return abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2.0


def _sadelestir(z, azami: int):
    """Zarfı `azami` köşeye indirir — ALANI EN AZ BOZAN köşeyi atarak.

    Sabit aralıkla nokta seçmek zarfı kesiyor ve toprağın kapsanan oranı
    düşüyor (ölçüldü: 15 köşelik zarf %99,7 kapsarken sabit aralıkla
    12 köşeye inen sürüm %83,6'ya düşüyordu). Burada her adımda
    KALDIRILMASI en küçük üçgeni doğuran köşe atılıyor, yani şekil
    bozulmadan seyreliyor.
    """
    z = list(z)
    while len(z) > azami:
        n = len(z)
        en_kucuk, indeks = None, 0
        for i in range(n):
            a, b, c = z[i - 1], z[i], z[(i + 1) % n]
            alan = _ucgen(a, b, c)
            if en_kucuk is None or alan < en_kucuk:
                en_kucuk, indeks = alan, i
        del z[indeks]
    return z


def _maske(rgb: np.ndarray) -> np.ndarray:
    a = np.asarray(rgb, dtype=np.float32)
    kirmizi, mavi = a[..., 0], a[..., 2]
    en_buyuk = a.max(axis=2)
    en_kucuk = a.min(axis=2)
    doygunluk = np.where(en_buyuk > 0,
                         (en_buyuk - en_kucuk) / np.maximum(en_buyuk, 1e-6), 0.0)
    return (kirmizi - mavi > RB_ESIK) & (doygunluk > DOY_ESIK)


def _icinde(xx: np.ndarray, yy: np.ndarray, kose) -> np.ndarray:
    """Dörtgenin içi — ışın atma, dizi üstünde."""
    ic = np.zeros(xx.shape, dtype=bool)
    n = len(kose)
    for i in range(n):
        x1, y1 = kose[i]
        x2, y2 = kose[(i - 1) % n]
        kesisiyor = ((y1 > yy) != (y2 > yy))
        bol = (y2 - y1) if (y2 - y1) != 0 else 1e-9
        sinir = (x2 - x1) * (yy - y1) / bol + x1
        ic ^= kesisiyor & (xx < sinir)
    return ic


def bul(rgb: np.ndarray) -> dict[str, Any] | None:
    """(h, w, 3) kare -> dörtgen ve ölçüleri, ya da None."""
    h, w = rgb.shape[:2]
    if h < 16 or w < 16:
        return None
    yaricap = max(2, int(round(min(w, h) * ACMA_ORANI)))
    m = _ac_kapa(_maske(rgb), yaricap, max(yaricap, 4))
    bilesen = _en_buyuk_bilesen(m)
    if bilesen is None:
        return None
    piksel = int(bilesen.sum())
    if piksel < EN_AZ_ORAN * h * w:
        return None
    ys, xs = np.nonzero(bilesen)
    # DÖRTGEN DEĞİL, ZARF. Kap yuvarlak köşeli ve perspektifte yamuk; dört
    # köşeli bir şekil köşeleri kesiyor ve orada gerçek fide kaybediliyor.
    # ÖLÇÜLDÜ (aynı kare): dörtgen toprağın %94,2'sini kapsıyor, zarf
    # %99,7'sini. Zarfın aldığı fazlalık kabın iç kenarı (%6,4 -> %10,6),
    # uzaktaki makine değil — kenardaki fideyi kaybetmekten iyi.
    kose = _sadelestir(_zarf(list(zip(xs.tolist(), ys.tolist()))), AZAMI_KOSE)
    if len(kose) < 3:
        return None
    alan = 0.0
    for i in range(len(kose)):
        x1, y1 = kose[i - 1]
        x2, y2 = kose[i]
        alan += x1 * y2 - x2 * y1
    alan = abs(alan) / 2.0
    # DOLULUK: dörtgenin içinde kalan toprak oranı. Düşükse maskeye
    # yabancı bir şey karışmış ve kullanıcının bunu bilmesi gerekiyor.
    yy, xx = np.mgrid[0:h, 0:w]
    ic = _icinde(xx, yy, kose)
    doluluk = float((bilesen & ic).sum()) / max(float(ic.sum()), 1.0)
    return {
        "kose": [[x / w, y / h] for x, y in kose],
        "kare_px": [w, h],
        "maske_px": piksel,
        "alan_px": float(alan),
        "doluluk": round(doluluk, 3),
        "acma_yaricapi": yaricap,
    }


def bayttan(ham: bytes) -> dict[str, Any] | None:
    """JPEG/PNG baytlarından dörtgen. Kare önce küçültülüyor."""
    try:
        from PIL import Image
    except Exception:                                   # noqa: BLE001
        return None
    try:
        with Image.open(io.BytesIO(ham)) as im:
            im = im.convert("RGB")
            uzun = max(im.size)
            if uzun > CALISMA_KENARI:
                o = CALISMA_KENARI / float(uzun)
                im = im.resize((max(1, int(im.width * o)),
                                max(1, int(im.height * o))))
            return bul(np.asarray(im))
    except Exception:                                   # noqa: BLE001
        return None
