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

    RGB → beyaz dengesi → ExG + renk kapıları → morfoloji
        → bağlı bileşenler → leke ölçüleri → (isteğe bağlı) alan süzgeci

ExG (Excess Green, ``2g − r − b``) neden işe yarıyor: önce her piksel
kendi toplam parlaklığına bölünüyor, yani elde kalan şey RENK ORANI.
Bunun sonucu olarak NÖTR bir piksel tam olarak SIFIR veriyor —
gri, beyaz, siyah, hepsinde ``r = g = b = 1/3`` ve ``2/3 − 1/3 − 1/3 = 0``.
Gölgedeki yaprak da, güneşe bakan yaprak da pozitif; metal, plastik ve
toprak sıfırın etrafında. Parlaklıktan bağımsız olması bu yüzden.

--------------------------------------------------------------------
ExG TEK BAŞINA YETMİYOR — sahada iki yönlü hata verdi
--------------------------------------------------------------------

Üst kameranın karesinde ölçüldü:

  * **Yanlış bulgu.** Yatağın önündeki MAVİ-TURKUAZ plastik kabın kenarı
    "filiz" sayıldı. Sebebi ExG'nin biçimi: turkuazda hem g hem b
    yüksek, r düşük. ``2g − r − b`` yine pozitif çıkıyor — indeks
    "yeşil"i değil "kırmızının azlığını" ölçüyor.
  * **Kaçırılan bulgu.** Toprağın ortasındaki gerçek fesleğen filizleri
    hiç bulunamadı. Kare soğuk/mavimsi geliyor (gölgedeki gökyüzü ışığı);
    mavi kanal her yerde şişince ``− b`` terimi yaprakların ExG'sini
    eşiğin altına itiyor.

Üç ek var ve üçü de farklı bir hatayı kesiyor:

1. **Beyaz dengesi** (`beyaz_denge`). Renk sapmasını ExG'den ÖNCE
   gideriyor. Mavimsi karede yaprağın yeşili geri geliyor.
2. **Renk kapıları** (`yesil_maske`). ExG'nin yanına ``g > r`` ve
   ``g > b`` şartı: turkuaz ``g > b``de düşüyor, kızıl toprak
   ``g > r``de. Bir de ExGR (``ExG − ExR``) ve küçük bir doygunluk
   tabanı; ikisi de nötr/gri gürültüyü eliyor.
3. **Alan süzgeci** (çağıranın verdiği `gecerli_mi`). Kalibrasyon artık
   pikselden milimetreye çevirdiği için her lekenin YATAK KOORDİNATI
   biliniyor; dikim alanının dışına düşen leke baştan eleniyor. Kabın
   kenarı, tezgâh, arka plan — hepsi alan dışında. Tek denetim, yanlış
   bulguların çoğu.

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
#
# BU SAYI 640x480'E GÖRE SEÇİLDİ. Çözünürlük 1920'ye çıkınca aynı 5x5
# pencere görüntünün dokuzda biri kadar alan kaplıyor ve açma işlemi
# artık gürültüyü temizlemiyor: 640'ta elenen tek piksellik JPEG
# çöpü, 1920'de 3x3 piksellik bir küme oluyor ve pencereden geçiyor.
# `yaricap_varsayilan` yarıçapı kare ölçüsüyle ölçekliyor.
YARICAP = 2

#: `YARICAP` hangi kare ölçüsüne göre seçilmişti — ölçekleme bundan çıkıyor.
OLCU_GENISLIK = 640

# Bundan küçük lekeler atılıyor. 640x480'de 150 piksel ≈ 12x12 px.
# DİKKAT: çimlenme denetiminde bu sayı çok büyük — fide 10 piksel
# olabiliyor. O çağrı kendi sınırını veriyor.
EN_AZ_PIKSEL = 150


def yaricap_varsayilan(genislik_px: float) -> int:
    """Morfoloji yarıçapını kare genişliğiyle ölçekliyor.

    Yarıçap PİKSEL cinsinden bir sayı ve çözünürlük değişince sessizce
    başka bir şey demeye başlıyor: 1920 piksellik karede 5x5 pencere,
    640'taki 5x5'in kapsadığı alanın dokuzda biri. Ölçekleyince
    "yatağın şu kadarından ince şeyler gürültüdür" demek oluyor —
    fiziksel bir büyüklük, piksel sayısı değil.

    Üst sınır 6 (13x13): ondan büyüğü ince fide yapraklarını yiyor.
    """
    g = max(1.0, float(genislik_px))
    return int(max(1, min(6, round(YARICAP * g / OLCU_GENISLIK))))


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


#: Beyaz dengesinin Minkowski üssü. p=1 gri-dünya (sahnenin ORTALAMASI
#: gridir), p=∞ beyaz-yama (en parlak piksel beyazdır). İkisi de bizim
#: sahnemizde tek başına yanılıyor: kadrajın çoğu kahverengi toprak, o
#: yüzden gri-dünya maviyi aşırı kaldırıyor; en parlak piksel de çoğu
#: zaman bir yansıma parıltısı, beyaz değil. p=6 ikisinin arasında ve
#: literatürde ("shades of grey") genel amaçlı en iyi çıkan değer.
DENGE_USSU = 6.0

#: Kazanç bu aralığın dışına çıkamaz. Sınırsız bırakmak, tek renkli bir
#: kadrajda (kamera toprağa çok yaklaşırsa) görüntüyü tamamen boyamak
#: demek. Düzeltme yapılamıyorsa yapılmamış olması daha iyi.
DENGE_ALT, DENGE_UST = 0.55, 1.9


def beyaz_denge(rgb: np.ndarray, us: float = DENGE_USSU) -> tuple[np.ndarray, list[float]]:
    """Renk sapmasını gideriyor. -> (dengelenmiş RGB, kanal kazançları)

    NEDEN ExG'DEN ÖNCE. ExG piksel başına normalleştiriyor, yani
    PARLAKLIKTAN bağımsız — ama RENK SAPMASINDAN değil. Kare mavimsi
    geliyorsa mavi kanal her yerde şişiyor ve ``2g − r − b`` içindeki
    ``− b`` terimi bütün yaprakları aşağı çekiyor. Sahada tam bu oldu:
    gölgedeki gökyüzü ışığı altında çekilen karede fesleğen filizleri
    eşiğin altında kaldı ve hiç bulunamadı.

    Yöntem "shades of grey": her kanalın Minkowski normu alınıyor ve
    üçü ortak bir ortalamaya çekiliyor. Kazançlar SINIRLI (`DENGE_ALT`
    .. `DENGE_UST`) — aşırı düzeltme, düzeltmemekten kötü.

    Kazançlar geri veriliyor: "kare mavimsiydi, düzelttim" demenin tek
    dürüst yolu sayıyı göstermek.
    """
    x = np.asarray(rgb, dtype=np.float32)
    if x.ndim != 3 or x.shape[2] < 3:
        raise ValueError("beyaz_denge (h, w, 3) RGB bekliyor")
    x = x[:, :, :3]
    # Tam siyah pikseller norma katılmıyor: gece karesinde ya da kadrajın
    # kararmış kenarında sayıyı aşağı çekip kazancı şişiriyorlar.
    parlak = x.max(axis=2) > 8.0
    if not parlak.any():
        return x, [1.0, 1.0, 1.0]
    secili = x[parlak]                                     # (n, 3)
    norm = np.power(np.mean(np.power(secili, us), axis=0), 1.0 / us)
    norm = np.maximum(norm, 1e-6)
    hedef = float(norm.mean())
    kazanc = np.clip(hedef / norm, DENGE_ALT, DENGE_UST).astype(np.float32)
    return np.clip(x * kazanc, 0.0, 255.0), [round(float(k), 3) for k in kazanc]


def _oranlar(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Piksel başına normalleştirilmiş (r, g, b); toplamları 1."""
    x = np.asarray(rgb, dtype=np.float32)
    if x.ndim != 3 or x.shape[2] < 3:
        raise ValueError("(h, w, 3) RGB bekleniyor")
    toplam = x[:, :, :3].sum(axis=2)
    # Tam siyah pikselde sıfıra bölme olurdu. 1.0 koyuyoruz: pay da sıfır
    # olduğu için sonuç 0 çıkıyor, yani "nötr" — doğru cevap.
    toplam = np.where(toplam == 0.0, 1.0, toplam)
    return (x[:, :, 0] / toplam, x[:, :, 1] / toplam, x[:, :, 2] / toplam)


def exr(rgb: np.ndarray) -> np.ndarray:
    """Excess Red, ``1.4r − g``. ExGR'nin çıkarılan yarısı."""
    r, g, _ = _oranlar(rgb)
    return 1.4 * r - g


#: Yeşil sayılmak için ``g`` ötekilerden bu kadar büyük olmalı (oran
#: uzayında, yani birimi "toplam parlaklığın kesri").
#:
#: MAVİ PAYI ASIL OLAN. Turkuaz plastikte r düşük, g ve b birlikte
#: yüksek; ExG pozitif çıkıyor ama ``g − b`` sıfırın etrafında. Yaprakta
#: aynı fark 0.10–0.20 arasında ölçüldü, yani 0.02 eşiği yaprağı hiç
#: zorlamıyor ama turkuazı kesiyor.
MAVI_PAYI = 0.02
KIRMIZI_PAYI = 0.01

#: Nötr piksel eşiği. ``1 − 3·min(r,g,b)`` HSI doygunluğu: gri tam 0,
#: saf renk 1. Karanlık köşelerdeki JPEG bulamacı buranın altında kalıyor.
EN_AZ_DOYGUNLUK = 0.08


def yesil_maske(rgb: np.ndarray, esik: float = ESIK,
                mavi_payi: float = MAVI_PAYI,
                kirmizi_payi: float = KIRMIZI_PAYI,
                en_az_doygunluk: float = EN_AZ_DOYGUNLUK) -> dict[str, Any]:
    """"Bu piksel yeşil mi" kararı — ExG artık tek başına karar vermiyor.

    Dört kapı ve her biri farklı bir yanlış bulguyu kesiyor:

        ExG > eşik        yeşilin gücü — eski davranış, aynen duruyor
        g − b > mavi      MAVİ/TURKUAZ plastiği eler (kabın kenarı)
        g − r > kırmızı   kızıl toprağı, terracotta saksıyı eler
        ExGR > 0          ikisinin birleşimi; kırmızıya karşı ikinci sıra
        doygunluk         gri/nötr gürültüyü eler

    Hepsi VE ile bağlı. Yaprak dördünü de rahat geçiyor: ölçülen tipik
    yaprakta ``g − b`` 0.10 üstü, eşik 0.02.

    Dönen sözlükte hangi kapının ne kadar eledi de var — "neden
    bulunamadı" sorusu tahminle değil sayıyla cevaplansın diye.
    """
    r, g, b = _oranlar(rgb)
    e = 2.0 * g - r - b
    kirmizi_fazlasi = 1.4 * r - g
    doygunluk = 1.0 - 3.0 * np.minimum(np.minimum(r, g), b)

    guclu = e > esik
    maviden = (g - b) > mavi_payi
    kirmizidan = (g - r) > kirmizi_payi
    exgr = (e - kirmizi_fazlasi) > 0.0
    doygun = doygunluk > en_az_doygunluk

    maske = guclu & maviden & kirmizidan & exgr & doygun
    toplam = float(guclu.mean())
    return {
        "maske": maske,
        "exg": e,
        # Her kapının TEK BAŞINA bıraktığı oran ve ExG'nin eledikleri:
        # panelde "ExG %4 buldu, mavi kapısı %3.6'sını attı" diyebilmek
        # için. Sayı olmadan "neden bulmadı" cevaplanamıyor.
        "exg_oran": round(toplam, 5),
        "maske_oran": round(float(maske.mean()), 5),
        "elenen": {
            "mavi": round(float((guclu & ~maviden).mean()), 5),
            "kirmizi": round(float((guclu & ~kirmizidan).mean()), 5),
            "exgr": round(float((guclu & ~exgr).mean()), 5),
            "doygunluk": round(float((guclu & ~doygun).mean()), 5),
        },
    }


# EŞİĞİ KAREDEN TÜRETMEK DENENDİ, ÇALIŞMIYOR — ölçüldü.
#
# Fikir makuldü: nötr yığının ortancasını ve MAD'ini ölçüp "yığının k
# sigma üstü yeşildir" demek. Fark eşiğinde (`fark`) tam bu yöntem
# çalışıyor. Üst kameranın GERÇEK karesinde ölçüldü:
#
#     ExG ortancası  −0.103      (kadrajın çoğu kahverengi toprak)
#     sigma           0.131      (mavi kap + toprak + arka plan, geniş)
#     ortanca + 4σ   +0.423   ←  bu eşikte karenin yalnız binde 5'i geçiyor
#
# Sebebi şu: yöntem "arka plan TEK ve DAR bir yığındır" varsayıyor.
# Bizim kadrajımızda arka plan üç ayrı şey — kızıl toprak (ExG negatif),
# mavi plastik (sıfırın biraz üstü), açık gri arka plan (sıfır). Ortanca
# yığının ortasını değil toprağı gösteriyor; sigma da yığının genişliğini
# değil üç grubun BİRBİRİNDEN uzaklığını ölçüyor.
#
# Sabit eşik + renk kapıları kalıyor. Kapılar zaten yüksek eşiğin yaptığı
# işi daha doğrudan yapıyor: eşik "ne kadar yeşil" diye soruyordu,
# kapılar "yeşil mi" diye soruyor.


def bitki_orani(rgb: np.ndarray, esik: float = ESIK,
                denge: bool = True) -> float:
    """Karenin yüzde kaçı bitki. Çimlenme denetiminin tek sayılık hâli.

    Leke ayırmaya gerek olmayan yerde bu yeter: ekilen gözün üstündeki
    küçük pencerede oran zamanla yükseliyorsa bir şey çıkmış demektir.

    `bul` ile AYNI KARARI kullanıyor (beyaz dengesi + renk kapıları).
    Ayrı bir ölçüt olsaydı çimlenme "çıktı" derken leke bulucu aynı
    karede hiçbir şey bulmazdı ve hangisinin doğru olduğu anlaşılmazdı.

    Sayı bu değişiklikle KAYIYOR: mavimsi karelerde eskisi yaprakları
    kaçırıyordu, yani eski seriyle yenisi doğrudan karşılaştırılamaz.
    Eğilim yine okunuyor, çünkü kayma tek yönlü ve her karede aynı.
    """
    x = beyaz_denge(rgb)[0] if denge else rgb
    return float(yesil_maske(x, esik)["maske"].mean())


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


def bul(rgb: np.ndarray, esik: float = ESIK, yaricap: int | None = None,
        en_az_piksel: int = EN_AZ_PIKSEL, denge: bool = True,
        gecerli_mi=None) -> dict[str, Any]:
    """Hattın tamamı tek çağrıda.

    -> {esik, oran, ham_leke, lekeler, maske, denge_kazanc, exg_oran,
        elenen, alan_disi}

    ESKİ ÇAĞRI AYNEN ÇALIŞIYOR. `bul(rgb, esik=..., en_az_piksel=...)`
    imzası bozulmadı; yeni parametrelerin hepsi isteğe bağlı ve
    varsayılanları eski davranışa en yakın olanı.

    `yaricap=None`   → morfoloji yarıçapını kare genişliğinden türet.
                       1920'lik karede sabit 2 artık gürültü temizlemiyor.
    `denge=False`    → beyaz dengesini atla (ham RGB ile eski davranış).
    `gecerli_mi(leke)` → ALAN SÜZGECİ. Leke sözlüğünü alıp True/False
                       döndüren bir işlev; False diyene liste dışı.
                       `tespit.alan_suzgeci(...)` tam bunu üretiyor:
                       lekenin yatak koordinatını çıkarıp dikim alanının
                       dışındaysa eliyor. Verilmezse hiçbir şey elenmiyor.
    """
    dengeli, kazanc = (beyaz_denge(rgb) if denge else (rgb, [1.0, 1.0, 1.0]))
    y = yesil_maske(dengeli, float(esik))
    r = yaricap_varsayilan(rgb.shape[1]) if yaricap is None else int(yaricap)
    maske = ac_kapa(y["maske"], r)
    etiket, adet = etiketle(maske)
    ham = lekeler(etiket, adet, en_az_piksel)

    # ALAN SÜZGECİ EN SONDA. Önce elemek, morfolojiyi ve etiketlemeyi
    # eksik bir maske üstünde çalıştırmak demekti; leke ölçüleri de o
    # eksik maskeden çıkardı.
    if gecerli_mi is None:
        secili, disarida = ham, []
    else:
        secili, disarida = [], []
        for b in ham:
            (secili if gecerli_mi(b) else disarida).append(b)

    return {
        "esik": float(esik),
        "oran": float(maske.mean()),
        "ham_leke": int(adet),
        "lekeler": secili,
        "maske": maske,
        # Kararın nasıl verildiği: "neden bulmadı" tahminle değil sayıyla
        # cevaplansın. `denge_kazanc` 1'den uzaksa karede renk sapması
        # vardı; `elenen` hangi kapının ne kadar attığını söylüyor.
        "denge_kazanc": kazanc,
        "yaricap": r,
        "exg_oran": y["exg_oran"],
        "elenen": y["elenen"],
        "alan_disi": len(disarida),
        "alan_disi_lekeler": disarida,
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
