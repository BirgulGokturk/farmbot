"""Görüntü işleme çekirdeği — bitki/toprak ayrımı ve kare karşılaştırma.

Bu dosya PİKSEL dünyasında kalıyor. Milimetreye çevirme, makine konumu,
kalibrasyon — hiçbiri burada yok ve olmamalı: burası "görüntüde ne var"
sorusunu, `tespit.py` ise "o şey yatağın neresinde" sorusunu cevaplıyor.
İkisini karıştırmak, kalibrasyon değişince segmentasyonu da bozardı.

Hazır bir görüntü işleme kütüphanesi YOK, yalnız numpy. İki sebep: Pi'ye
yüz megabaytlık bir bağımlılık girmiyor, ve eşiklemeyi/etiketlemeyi
kendimiz yazınca ne yaptığımızı biliyoruz.

--------------------------------------------------------------------
Hattın tamamı
--------------------------------------------------------------------

    RGB → ExG → eşik → morfoloji → bağlı bileşenler → leke ölçüleri

ExG (Excess Green, ``2g − r − b``) neden işe yarıyor: önce her piksel
kendi toplam parlaklığına bölünüyor, yani elde kalan şey RENK ORANI.
Bunun sonucu olarak NÖTR bir piksel tam olarak SIFIR veriyor —
gri, beyaz, siyah, hepsinde ``r = g = b = 1/3`` ve ``2/3 − 1/3 − 1/3 = 0``.
Gölgedeki yaprak da, güneşe bakan yaprak da pozitif; metal, plastik ve
toprak sıfırın etrafında. Parlaklıktan bağımsız olması bu yüzden.

--------------------------------------------------------------------
Otsu neden VARSAYILAN DEĞİL
--------------------------------------------------------------------

Otsu eşiği görüntünün kendisine seçtirir ve "iki tepeli histogram"
varsayar. Bizim sahnemizde bu varsayım tutmuyor: arka planın tamamı
ExG ≈ 0'da yığılıyor. Gerçek ölçüm (makinenin kendi fotoğrafı):

    bitki karesi   piksellerin %53'ü  −0.05 .. +0.05 aralığında
    çıplak toprak  piksellerin %86'sı −0.05 .. +0.05 aralığında

Otsu bu yığının İÇİNDEN bölüp görüntünün %82'sini "bitki" ilan etti.
O yüzden varsayılan SABİT bir eşik ve keyfî değil: nötr sıfırsa, soru
"sıfırın ne kadar üstü yeşil sayılır" oluyor. Ölçülen ayrım:

    eşik +0.05 → bitki %17.6 / toprak %8.8    (ayrım zayıf)
    eşik +0.12 → bitki  %7.1 / toprak %0.2    (temiz)

`otsu()` yine de duruyor: sahne gerçekten iki tepeliyse (yakın çekim,
tek bitki, düz zemin) doğru araç odur ve `iki_tepeli()` bunu ölçüyor.
"""

from __future__ import annotations

from typing import Any

import numpy as np

# Nötr piksel ExG = 0. Bir pikselin "yeşil" sayılması için sıfırın bu
# kadar üstünde olması gerekiyor. Sahadan ölçüldü (bkz. dosya başlığı);
# ayarlanabilir olması gerekirse çağıran geçiriyor.
ESIK = 0.12

# Morfoloji yarıçapı. 2 → 5x5 pencere. Büyütmek ince yaprakları yer,
# küçültmek JPEG gürültüsünü bırakır.
YARICAP = 2

# Bundan küçük lekeler atılıyor. 640x480'de 150 piksel ≈ 12x12 px.
# DİKKAT: çimlenme denetiminde bu sayı çok büyük — fide 10 piksel
# olabiliyor. O çağrı kendi sınırını veriyor.
EN_AZ_PIKSEL = 150


# --------------------------------------------------------------------------- #
# 1. Bitki indeksi
# --------------------------------------------------------------------------- #
def exg(rgb: np.ndarray) -> np.ndarray:
    """Excess Green haritası. Girdi (h, w, 3) uint8, çıktı (h, w) float32.

    Değer aralığı [-1, +2]; pratikte bitki +0.1 .. +0.6, nötr 0 civarı,
    kırmızımsı (terracotta saksı, kızıl toprak) negatif.
    """
    x = np.asarray(rgb, dtype=np.float32)
    if x.ndim != 3 or x.shape[2] < 3:
        raise ValueError("exg (h, w, 3) RGB bekliyor")
    toplam = x[:, :, :3].sum(axis=2)
    # Tam siyah pikselde sıfıra bölme olurdu. 1.0 koyuyoruz: pay da sıfır
    # olduğu için sonuç 0 çıkıyor, yani "nötr" — doğru cevap.
    toplam[toplam == 0.0] = 1.0
    r = x[:, :, 0] / toplam
    g = x[:, :, 1] / toplam
    b = x[:, :, 2] / toplam
    return 2.0 * g - r - b


def bitki_orani(rgb: np.ndarray, esik: float = ESIK) -> float:
    """Karenin yüzde kaçı bitki. Çimlenme denetiminin tek sayılık hâli.

    Leke ayırmaya gerek olmayan yerde bu yeter: ekilen gözün üstündeki
    küçük pencerede oran zamanla yükseliyorsa bir şey çıkmış demektir.
    """
    return float((exg(rgb) > esik).mean())


# --------------------------------------------------------------------------- #
# 2. Eşikleme
# --------------------------------------------------------------------------- #
def otsu(deger: np.ndarray, kova: int = 256) -> float:
    """Gruplar arası değişimi en büyük yapan eşik.

    Sahnenin iki tepeli olduğundan emin değilseniz `iki_tepeli()` ile
    ölçün — değilse bu sayı anlamsızdır (dosya başlığındaki ölçüm).
    """
    d = np.asarray(deger, dtype=np.float32).ravel()
    alt, ust = float(d.min()), float(d.max())
    if not np.isfinite(alt) or not np.isfinite(ust) or ust <= alt:
        return alt
    sayim, kenar = np.histogram(d, bins=kova, range=(alt, ust))
    orta = (kenar[:-1] + kenar[1:]) / 2.0
    toplam = float(sayim.sum())
    if toplam <= 0:
        return alt
    kumulatif = np.cumsum(sayim)
    w0 = kumulatif / toplam
    w1 = 1.0 - w0
    m0 = np.cumsum(sayim * orta) / np.maximum(kumulatif, 1)
    genel = float((sayim * orta).sum()) / toplam
    m1 = (genel - w0 * m0) / np.maximum(w1, 1e-9)
    arasi = w0 * w1 * (m0 - m1) ** 2
    return float(orta[int(np.argmax(arasi))])


# Otsu'nun bölmesi ne kadar iyi olursa güvenilir sayılıyor. Sayı ölçümle
# seçildi, tahminle değil:
#
#     sentetik iki tepeli dağılım        0.980
#     %5 bitki + arka plan               0.824   ← ayrılabilir, güvenilir
#     ————————————— sınır 0.75 —————————————
#     tek tepeli gürültü                 0.643
#     GERÇEK toprak karesi               0.517
#     GERÇEK bitki karesi                0.383   ← Otsu burada çöktü
#
# Dikkat: η saf gürültüde bile 0.64 çıkıyor (bir Gauss'u ortasından
# bölmek değişimin üçte ikisini "açıklıyor"). Yani sınır 0.5 değil,
# yüksek olmak zorunda.
OTSU_AYRIM_SINIRI = 0.75


def otsu_ayrim(deger: np.ndarray, kova: int = 256) -> float:
    """Otsu bölmesinin AYRIM KALİTESİ (η): gruplar arası / toplam değişim.

    Otsu her zaman bir eşik döndürür — sahnede iki grup olmasa bile.
    Bu, o eşiğin anlamlı olup olmadığını söyleyen sayı ve Otsu'nun kendi
    ölçütü. Tepe saymaktan sağlam: gürültülü histogramda onlarca sahte
    yerel tepe var ve tepe arayan bir ölçüt onlara takılıyor (denendi,
    gerçek karelerde iki durumu da ayıramadı).

    0 = bölmenin hiçbir şey açıklamadığı, 1 = kusursuz ayrılmış iki grup.
    """
    d = np.asarray(deger, dtype=np.float32).ravel()
    alt, ust = float(d.min()), float(d.max())
    if not np.isfinite(alt) or not np.isfinite(ust) or ust <= alt:
        return 0.0
    sayim, kenar = np.histogram(d, bins=kova, range=(alt, ust))
    orta = (kenar[:-1] + kenar[1:]) / 2.0
    toplam = float(sayim.sum())
    if toplam <= 0:
        return 0.0
    kumulatif = np.cumsum(sayim)
    w0 = kumulatif / toplam
    w1 = 1.0 - w0
    m0 = np.cumsum(sayim * orta) / np.maximum(kumulatif, 1)
    genel = float((sayim * orta).sum()) / toplam
    m1 = (genel - w0 * m0) / np.maximum(w1, 1e-9)
    arasi = float((w0 * w1 * (m0 - m1) ** 2).max())
    toplam_degisim = float((sayim * (orta - genel) ** 2).sum()) / toplam
    return float(arasi / max(toplam_degisim, 1e-12))


def otsu_guvenilir(deger: np.ndarray, sinir: float = OTSU_AYRIM_SINIRI) -> bool:
    """Bu sahnede Otsu'ya güvenilir mi? Değilse sabit eşik kullanın."""
    return otsu_ayrim(deger) >= sinir


# --------------------------------------------------------------------------- #
# 3. Morfoloji
# --------------------------------------------------------------------------- #
def _pencere_sayisi(m: np.ndarray, yaricap: int) -> np.ndarray:
    """(2r+1) kare pencerede kaç komşu True — toplamsal görüntü ile.

    Maliyeti pencere boyutundan BAĞIMSIZ; yarıçapı büyütmek bedava.

    Çıktı boyutu girdiyle AYNI olmak zorunda. Bu sabit değil, düzeltilmiş
    bir hata: önceki hâli her çağrıda diziyi bir piksel büyütüyordu ve
    `ac_kapa` bunu dört kez çağırdığı için maske görüntüden dört piksel
    kayıyordu — hizasız bir maske, sessizce yanlış yeri işaretler.
    """
    r = int(yaricap)
    p = np.pad(np.asarray(m, dtype=bool).astype(np.int32), r)
    t = np.zeros((p.shape[0] + 1, p.shape[1] + 1), np.int32)
    t[1:, 1:] = p.cumsum(0).cumsum(1)      # sıfır satır/sütun = kenar şartı yok
    h, w = m.shape
    k = 2 * r + 1
    return (t[k:k + h, k:k + w] - t[0:h, k:k + w]
            - t[k:k + h, 0:w] + t[0:h, 0:w])


def asin(mask: np.ndarray, yaricap: int = YARICAP) -> np.ndarray:
    """Aşınma: pencerenin TAMAMI dolu olan pikseller kalır."""
    return _pencere_sayisi(mask, yaricap) == (2 * yaricap + 1) ** 2


def genislet(mask: np.ndarray, yaricap: int = YARICAP) -> np.ndarray:
    """Genişleme: pencerede EN AZ BİR dolu piksel varsa dolu."""
    return _pencere_sayisi(mask, yaricap) > 0


def ac_kapa(mask: np.ndarray, yaricap: int = YARICAP) -> np.ndarray:
    """Önce AÇMA (aşın→genişlet), sonra KAPAMA (genişlet→aşın).

    Açma tek piksellik gürültüyü siliyor, kapama yaprağın ortasındaki
    delikleri dolduruyor. Sıra önemli: önce temizle sonra doldur; tersi
    gürültüyü büyütür.
    """
    a = genislet(asin(mask, yaricap), yaricap)
    return asin(genislet(a, yaricap), yaricap)


# --------------------------------------------------------------------------- #
# 4. Bağlı bileşenler
# --------------------------------------------------------------------------- #
def etiketle(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """Bağlı bileşen etiketleme, 8 komşuluk. -> (etiket haritası, adet)

    KOŞU TABANLI (run-length) birleşim-bulma. Piksel piksel dolaşmak
    yerine her satırdaki ardışık dolu dizileri ("koşu") tek birim sayıp
    yalnız komşu satırların koşularını birleştiriyoruz: maliyet piksel
    sayısıyla değil KOŞU sayısıyla orantılı. 640x480'de saf piksel
    döngüsü yüzlerce milisaniye sürüyordu, bu onlarca.
    """
    m = np.asarray(mask, dtype=bool)
    h, w = m.shape
    etiket = np.zeros((h, w), np.int32)

    ata: list[int] = [0]

    def bul(a: int) -> int:
        while ata[a] != a:
            ata[a] = ata[ata[a]]           # yol sıkıştırma
            a = ata[a]
        return a

    def birlestir(a: int, b: int) -> None:
        ra, rb = bul(a), bul(b)
        if ra != rb:
            ata[max(ra, rb)] = min(ra, rb)

    def kosular(satir: np.ndarray) -> list[tuple[int, int]]:
        """Satırdaki dolu dizilerin [(bas, bit_haric), ...] listesi."""
        if not satir.any():
            return []
        d = np.diff(np.concatenate(([0], satir.view(np.int8), [0])))
        return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))

    onceki: list[tuple[int, int, int]] = []      # (bas, bit, etiket)
    for y in range(h):
        simdiki: list[tuple[int, int, int]] = []
        for bas, bit in kosular(m[y]):
            # Üst satırda ÇAKIŞAN koşular (8 komşuluk: bir piksel taşma payı)
            komsu = [e for (b0, b1, e) in onceki if b0 < bit + 1 and bas - 1 < b1]
            if komsu:
                e = min(komsu)
                for k in komsu:
                    birlestir(e, k)
            else:
                ata.append(len(ata))
                e = len(ata) - 1
            etiket[y, bas:bit] = e
            simdiki.append((bas, bit, e))
        onceki = simdiki

    if len(ata) <= 1:
        return etiket, 0

    # İkinci geçiş: kökleri çöz ve 1..N'e yeniden numarala. Tablo üzerinden
    # yapıyoruz, piksel üzerinden değil — tek `take` çağrısı.
    kok = np.array([bul(i) for i in range(len(ata))], np.int32)
    yeni = np.zeros(len(ata), np.int32)
    sayac = 0
    for i in range(1, len(ata)):
        if kok[i] == i:
            sayac += 1
            yeni[i] = sayac
    return np.take(yeni[kok], etiket), sayac


def lekeler(etiket: np.ndarray, adet: int,
            en_az_piksel: int = EN_AZ_PIKSEL) -> list[dict[str, Any]]:
    """Leke başına ölçüler — hepsi PİKSEL cinsinden.

    Milimetreye çevirmek çağıranın işi: kalibrasyon ve karenin makine
    konumu burada bilinmiyor ve bilinmemeli.

    `dolgu` = alan / kutu alanı. Yaprakta yüksek, dağınık yosunda düşük;
    yanlış pozitifleri elemenin ucuz bir yolu.
    """
    if adet <= 0:
        return []
    e = np.asarray(etiket)
    # Bütün lekelerin istatistiği TEK geçişte: bincount, döngüden hızlı.
    duz = e.ravel()
    alan = np.bincount(duz, minlength=adet + 1)[1:]
    h, w = e.shape
    yy, xx = np.mgrid[0:h, 0:w]
    x_top = np.bincount(duz, weights=xx.ravel(), minlength=adet + 1)[1:]
    y_top = np.bincount(duz, weights=yy.ravel(), minlength=adet + 1)[1:]

    cikti: list[dict[str, Any]] = []
    for i in range(adet):
        if alan[i] < en_az_piksel:
            continue
        ys, xs = np.nonzero(e == i + 1)
        x1, x2 = int(xs.min()), int(xs.max())
        y1, y2 = int(ys.min()), int(ys.max())
        kutu_alani = max(1, (x2 - x1 + 1) * (y2 - y1 + 1))
        cikti.append({
            "no": i + 1,
            "alan_px": int(alan[i]),
            "cx": round(float(x_top[i] / alan[i]), 1),
            "cy": round(float(y_top[i] / alan[i]), 1),
            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "en_px": x2 - x1 + 1, "boy_px": y2 - y1 + 1,
            "dolgu": round(float(alan[i]) / kutu_alani, 3),
        })
    return sorted(cikti, key=lambda b: -b["alan_px"])


def bul(rgb: np.ndarray, esik: float = ESIK, yaricap: int = YARICAP,
        en_az_piksel: int = EN_AZ_PIKSEL) -> dict[str, Any]:
    """Hattın tamamı tek çağrıda. -> {esik, oran, lekeler, maske}"""
    e = exg(rgb)
    maske = ac_kapa(e > esik, yaricap)
    etiket, adet = etiketle(maske)
    return {
        "esik": float(esik),
        "oran": float(maske.mean()),
        "ham_leke": int(adet),
        "lekeler": lekeler(etiket, adet, en_az_piksel),
        "maske": maske,
    }


# --------------------------------------------------------------------------- #
# 5. İki kare arasındaki fark
# --------------------------------------------------------------------------- #
# Gürültünün kaç katı gerçek değişim sayılsın. 3 sigma ile rastgele
# gürültünün binde üçü geçer; morfoloji onu da eler.
SIGMA_KATI = 3.0

# Gürültü tahmini bu kadarın altına inemez. Tamamen düz bir sahnede
# tahmin sıfıra yaklaşıyor ve eşik de sıfır oluyor; o zaman JPEG'in tek
# bir bit oynaması "değişim" sayılırdı.
EN_AZ_ESIK = 4.0


def fark(a: np.ndarray, b: np.ndarray, yaricap: int = YARICAP
         ) -> dict[str, Any]:
    """AYNI koordinatta çekilmiş iki kare arasındaki değişim.

    Makine aynı noktaya dönebildiği için kareler piksel piksel hizalı ve
    hizalama adımına gerek yok — gantry'nin görüntü işleme açısından en
    büyük kozu bu.

    `koyulasan` = b, a'dan koyu (ıslanmış toprak, düşen gölge).
    `acilan`    = b, a'dan açık (kuruma, yeni beyaz nesne).

    Eşik SABİT DEĞİL: farkın kendi dağılımından türüyor. Sabit bir sayı,
    gündüz çalışırken bulut geçince ya hep tetikler ya hiç tetiklemez.
    """
    ga = np.asarray(a, dtype=np.float32)[:, :, :3].mean(axis=2)
    gb = np.asarray(b, dtype=np.float32)[:, :, :3].mean(axis=2)
    if ga.shape != gb.shape:
        raise ValueError(f"kareler aynı boyutta olmalı: {ga.shape} vs {gb.shape}")
    d = ga - gb

    # Gürültü tahmini: ortanca mutlak sapma (MAD). Ortalama/std kullanmak
    # yanlış olurdu — asıl aradığımız büyük değişim istatistiği kendisi
    # şişirir ve eşiği kendi üstüne çıkarır.
    ortanca = float(np.median(d))
    mad = float(np.median(np.abs(d - ortanca)))
    sigma = max(1.4826 * mad, 0.5)          # MAD → standart sapma katsayısı
    esik = max(SIGMA_KATI * sigma, EN_AZ_ESIK)

    koyulasan = ac_kapa(d > esik, yaricap)
    acilan = ac_kapa(d < -esik, yaricap)
    return {
        "sigma": round(sigma, 2),
        "esik": round(esik, 2),
        "koyulasan_oran": float(koyulasan.mean()),
        "acilan_oran": float(acilan.mean()),
        "koyulasan": koyulasan,
        "acilan": acilan,
        "fark": d,
    }


def kutu(maske: np.ndarray) -> dict[str, int] | None:
    """Maskedeki dolu piksellerin sınır kutusu ve merkezi; boşsa None."""
    ys, xs = np.nonzero(maske)
    if not len(xs):
        return None
    return {"x1": int(xs.min()), "y1": int(ys.min()),
            "x2": int(xs.max()), "y2": int(ys.max()),
            "cx": int(round(float(xs.mean()))), "cy": int(round(float(ys.mean()))),
            "alan_px": int(len(xs))}
