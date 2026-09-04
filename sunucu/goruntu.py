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

import math
from typing import Any

import numpy as np

# Nötr piksel ExG = 0. Bir pikselin "yeşil" sayılması için sıfırın bu
# kadar üstünde olması gerekiyor. Sahadan ölçüldü (bkz. dosya başlığı);
# ayarlanabilir olması gerekirse çağıran geçiriyor.
ESIK = 0.12

# Morfoloji yarıçapı. 2 → 5x5 pencere. Büyütmek ince yaprakları yer,
# küçültmek JPEG gürültüsünü bırakır.
YARICAP = 2

#: `YARICAP` hangi kare ölçüsüne göre seçilmişti.
OLCU_GENISLIK = 640

# Bundan küçük lekeler atılıyor. 640x480'de 150 piksel ≈ 12x12 px.
# DİKKAT: çimlenme denetiminde bu sayı çok büyük — fide 10 piksel
# olabiliyor. O çağrı kendi sınırını veriyor.
EN_AZ_PIKSEL = 150

#: Bir kanal bu değerin üstündeyse o piksel DOYMUŞ — gerçek rengi
#: kaydedilmemiş, kırpılmış. Doymuş pikselde renk oranı anlamsız:
#: (255,255,255) nötr görünür ama altında ne olduğu bilinmiyor.
DOYMA_SINIRI = 250.0

#: Karenin bu kadarı doymuşsa "aşırı pozlanmış" diyoruz. %8 keyfi değil:
#: gün gören beyaz bir etiket ya da parlama karenin yüzde birkaçını
#: doyurabiliyor ve bu olağan; sekizde biri yanmışsa pozlama yanlış.
DOYMA_UYARI = 0.08

#: Ortalama parlaklık bunun altındaysa kare karanlık. Karanlıkta renk
#: oranları gürültüye boğuluyor ve yeşil ölçülemiyor.
KARANLIK_SINIRI = 35.0


def kapama_yaricapi(genislik_px: float) -> int:
    """KAPAMA yarıçapı — yaprağın içindeki boşlukları dolduran adım.

    Kapama (genişlet→aşın) yapıcı bir işlem: küçük bir lekeyi yok etmez,
    yalnız yakın parçaları birleştirir ve delikleri doldurur. Yarıçapı
    çözünürlükle büyütmek burada güvenli ve gerekli — 1920'lik karede
    bir yaprağın iki lobu arasındaki boşluk da üç kat daha çok piksel.

    Üst sınır 6 (13x13).
    """
    g = max(1.0, float(genislik_px))
    return int(max(1, min(6, round(YARICAP * g / OLCU_GENISLIK))))


def acma_yaricapi(en_az_piksel: float) -> int:
    """AÇMA yarıçapı — gürültüyü silen, dolayısıyla YIKICI adım.

    ÖNCE BUNU DA ÇÖZÜNÜRLÜKLE ÖLÇEKLEDİM VE YANLIŞTI. Gerekçe şuydu:
    "640'ta elenen tek piksellik çöp, 1920'de 3x3 piksellik bir küme
    olur". Premis yanlış: baskın gürültü kaynağı JPEG'in 8x8 DCT
    blokları ve sensör gürültüsü, ikisi de PİKSEL biriminde sabit —
    çözünürlükle büyümüyorlar. Ölçeklenen tek şey GERÇEK nesneler oldu.

    Sahada sonucu şu oldu (ölçüldü): 1920'de yarıçap 6, yani 13x13
    pencere. O pencere 16 piksellik (≈6 mm) bir fideyi TAMAMEN siliyor,
    20 piksellik (8 mm) fidenin de dörtte birini yiyor — ve gerçek bir
    kotiledon dolu daire değil, iki ince lop. Sonuç: maske tamamen boş,
    bağlı bileşen sayısı sıfır. Panel "eşiği düşürün" diyordu, oysa
    eşikle ilgisi yoktu.

    Yarıçap artık EN KÜÇÜK KABUL EDİLEN LEKEYE bağlı: açma penceresi o
    lekenin eşdeğer çapının üçte birini geçemiyor. Yani "saklamaya karar
    verdiğimiz şeyi silen" bir açma kurulamıyor. Gürültüyü zaten en az
    piksel kapısı ve dikim alanı süzgeci eliyor.
    """
    alan = max(1.0, float(en_az_piksel))
    cap = 2.0 * math.sqrt(alan / math.pi)
    return int(max(1, min(3, (cap / 3.0 - 1.0) / 2.0)))


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
    # GEÇERLİ PİKSELLER: ne tam siyah ne DOYMUŞ.
    #
    # Tam siyah pikseller (gece karesi, kararmış kenar) sayıyı aşağı
    # çekip kazancı şişiriyor.
    #
    # DOYMUŞ pikseller de dışarıda ve bunun gerekçesi ayrı: kırpılmış bir
    # piksel (255,255,255) gerçek renginden bağımsız olarak NÖTR okunuyor.
    # Parlak bir pencerenin ya da gün gören beyaz bir yüzeyin doymuş
    # bölgesi norma girince üç kanal da aynı tavana dayanıyor ve düzeltme
    # sıfıra yaklaşıyor — yani en çok düzeltmeye ihtiyaç duyulan karede
    # beyaz dengesi hiçbir şey yapmıyor.
    parlak = (x.max(axis=2) > 8.0) & (x.max(axis=2) < DOYMA_SINIRI)
    if not parlak.any():
        # Kadrajın tamamı ya siyah ya yanmış: düzeltilecek bilgi yok.
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


def ac_kapa(mask: np.ndarray, yaricap: int = YARICAP,
            kapa_yaricap: int | None = None) -> np.ndarray:
    """Önce AÇMA (aşın→genişlet), sonra KAPAMA (genişlet→aşın).

    Açma tek piksellik gürültüyü siliyor, kapama yaprağın ortasındaki
    delikleri dolduruyor. Sıra önemli: önce temizle sonra doldur; tersi
    gürültüyü büyütür.

    İKİ YARIÇAP AYRI OLABİLİYOR ve olmalı da: açma YIKICI (küçük bir
    lekeyi tamamen siler), kapama YAPICI (yalnız birleştirir ve
    doldurur). İkisini tek sayıya bağlamak, boşluk doldurmak için
    büyütülen yarıçapın fideyi de silmesi demekti — sahada tam bu oldu.
    Verilmezse eski davranış: ikisi de aynı.
    """
    kapa = yaricap if kapa_yaricap is None else kapa_yaricap
    a = genislet(asin(mask, yaricap), yaricap)
    return asin(genislet(a, kapa), kapa)


# --------------------------------------------------------------------------- #
# 4. Bağlı bileşenler
# --------------------------------------------------------------------------- #
def kapa_ac(mask: np.ndarray, kapa_yaricap: int = YARICAP,
            ac_yaricap: int = 1) -> np.ndarray:
    """Önce KAPAMA, sonra AÇMA — yaprak maskesi için doğru sıra bu.

    `ac_kapa` bunun tersini yapıyor ve gerekçesi şuydu: "önce temizle
    sonra doldur; tersi gürültüyü büyütür." O gerekçe SAĞLAM bir nesnenin
    üstündeki tuz gürültüsü için doğru, GÖZENEKLİ bir nesne için felaket.

    Yaprak maskesi gözenekli: damar, gölge, parlama ve JPEG'in kroma
    altörneklemesi yüzünden yaprağın içi delik deşik çıkıyor — eşiği
    geçen piksel oranı yaprağın %60'ı kadar. Açma ise 3x3 pencerenin
    TAMAMEN dolu olmasını istiyor; gözenekli bir lekede öyle pencere
    neredeyse hiç yok, dolayısıyla açma yaprağı silip atıyor.

    ÖLÇÜLDÜ (1920x1440, dört fesleğen fidesi, maske %62 dolu, üstüne
    1010 piksel dağınık gürültü):

        ham maske                    1673 px, 1014 bileşen, 4 leke ≥80px
        AÇ→KAPA (bugünkü)              45 px,    4 bileşen, 0 leke ≥80px
        KAPA→AÇ                      1174 px,    4 bileşen, 4 leke ≥80px

    Yani açma önce gelince fidenin 663 pikselinden geriye 45 piksel
    kalıyor ve hiçbiri en küçük fide kapısını geçemiyor. Sıra
    değişince dört fide de bütün birer leke (~290 px) olarak çıkıyor —
    ve gürültünün 1010 pikselinin tamamı yine eleniyor, yani sıranın
    tersine çevrilmesi gürültüyü içeri almıyor.

    Kapama önce: delikleri doldurup yaprağı bütünlüyor. Açma sonra:
    artık sağlam olan lekeyi bozmadan dağınık gürültüyü siliyor.
    """
    k = int(kapa_yaricap)
    a = int(ac_yaricap)
    kapali = asin(genislet(mask, k), k)
    return genislet(asin(kapali, a), a)


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


def kare_kalitesi(rgb: np.ndarray) -> dict[str, Any]:
    """Karenin kendisi ölçülebilir mi. -> {parlaklik, doymus, karanlik, netlik}

    "Filiz bulunamadı" cevabını vermeden ÖNCE sorulması gereken soru:
    bu karede yeşil ölçülebilir mi? Aşırı pozlanmış bir karede yaprak da
    beyaz çıkıyor ve nötr okunuyor; karanlık bir karede renk oranları
    gürültü. İkisinde de eşiği düşürmek işe yaramaz — panelin verdiği
    öğüt yanlış olur.

    `netlik`: Laplace benzeri komşu farkının değişimi. Bulanık karede
    küçük, net karede büyük. Mutlak bir eşiği yok (sahneye bağlı), ama
    aynı kameranın iki karesi arasında karşılaştırılabilir ve "kare
    bulanık mıydı" sorusu ancak bir sayıyla cevaplanıyor.
    """
    x = np.asarray(rgb, dtype=np.float32)[:, :, :3]
    gri = x.mean(axis=2)
    doymus = float((x.max(axis=2) >= DOYMA_SINIRI).mean())
    # Komşu farkının değişimi — ayrık Laplace'ın ucuz karşılığı.
    if gri.shape[0] > 2 and gri.shape[1] > 2:
        lap = (4.0 * gri[1:-1, 1:-1] - gri[:-2, 1:-1] - gri[2:, 1:-1]
               - gri[1:-1, :-2] - gri[1:-1, 2:])
        netlik = float(lap.var())
    else:
        netlik = 0.0
    return {
        "parlaklik": round(float(gri.mean()), 1),
        "doymus": round(doymus, 4),
        "karanlik": round(float((gri < 16.0).mean()), 4),
        "netlik": round(netlik, 1),
    }


def _tani(yesil: dict[str, Any], kalite: dict[str, Any],
          ham_leke: int, leke: int, asamalar: dict[str, Any],
          esik: float, en_az_piksel: int) -> str:
    """Sonucun tek cümlelik gerekçesi. Boş = söylenecek bir sorun yok.

    SIRA ÖNEMLİ: önce kullanıcının verdiği sayılar makul mü, sonra kare
    ölçülebilir mi, sonra yeşil var mı, en sonda lekelerin hâli. Ters
    sırada "eşiği düşürün" denirdi ve kare bembeyaz yanmışken ya da
    eşik zaten on kat yüksekken o öğüt hiçbir işe yaramaz.
    """
    # EŞİK MAKUL MU. ExG aralığı [-1, +2] ve yaprak tipik olarak
    # +0.1 .. +0.6. 0.4 üstü bir eşik yalnız en koyu yeşili geçirir;
    # 0.6 gibi bir sayı (virgül kaymasıyla 0.06 yerine yazılıyor)
    # neredeyse her şeyi eler ve sonuç "karede yeşil yok" olur.
    if esik > 0.40 and yesil["exg_oran"] <= 0.002:
        return (f"Yeşil eşiği {esik:g} — bu çok yüksek. ExG ölçeğinde yaprak "
                "tipik olarak 0.1–0.6 arasında; 0.4 üstü bir eşik yalnız en "
                "koyu yeşili geçirir. Olağan değer 0.06–0.12.")
    if kalite["doymus"] >= DOYMA_UYARI:
        return (f"Kare aşırı pozlanmış: piksellerin %{kalite['doymus'] * 100:.0f}'i "
                "doymuş (kırpılmış). Doymuş pikselde renk yok, yaprak da beyaz "
                "çıkıyor — eşiği düşürmek işe yaramaz. Kameranın pozlamasını "
                "kısın (Kamera → Denetimler → exposure).")
    if kalite["parlaklik"] < KARANLIK_SINIRI:
        return (f"Kare karanlık (ortalama parlaklık {kalite['parlaklik']:.0f}/255). "
                "Renk oranları gürültüye boğuluyor; yeşil ölçülemez.")
    if yesil["exg_oran"] <= 0.0002:
        return ("Karede yeşile yakın piksel yok (ExG eşiği geçen oran binde ikinin "
                "altında). Kamera yatağa mı bakıyor, kadrajda bitki var mı? "
                "Önizleme karesinde yatağı göremiyorsanız hiçbir eşik yardım etmez.")

    kapi = asamalar.get("kapi") or {}
    morf = asamalar.get("morfoloji") or {}
    if leke == 0 and yesil["maske_oran"] <= 0.0:
        en_cok = max(yesil["elenen"], key=yesil["elenen"].get)
        return (f"ExG %{yesil['exg_oran'] * 100:.1f} yeşil buldu ama renk "
                f"kapılarının hepsi eledi (en çok '{en_cok}'). Kalan yeşil "
                "mavi-turkuaza ya da nötre çok yakın — gerçekten yaprak mı?")

    # MORFOLOJİ YEDİ Mİ. Kapılardan çıkan maske doluyken morfoloji
    # sonrası neredeyse hiçbir şey kalmadıysa sebep eşik değil, morfoloji.
    if kapi.get("piksel", 0) > 0 and morf.get("piksel", 0) < kapi["piksel"] * 0.2:
        return (f"Renk kapılarından {kapi['piksel']} piksel çıktı ama morfoloji "
                f"sonrası {morf.get('piksel', 0)} piksel kaldı: maske gözenekli "
                "(yaprağın içi delik deşik) ve temizleme adımı onu yiyor. "
                "Eşiği biraz düşürmek maskeyi doldurur.")

    # PARÇALI. En küçük fide kapısı bunu ELEYEN sebep gibi görünüyor ama
    # asıl sebep lekelerin bütün çıkmaması: hepsini toplasan kapıyı
    # geçecek kadar yeşil var. "En küçük fideyi düşürün" demek burada
    # yanlış yönlendirme — kapı zaten düşük, düşürmek gürültüyü içeri alır.
    toplam = morf.get("piksel", 0)
    if leke == 0 and ham_leke > 0:
        if toplam >= en_az_piksel and morf.get("en_buyuk", 0) < en_az_piksel:
            return (f"{ham_leke} leke bulundu, hepsi en küçük fide kapısının "
                    f"altında (en büyüğü {morf.get('en_buyuk', 0)} piksel, kapı "
                    f"{en_az_piksel}). Ama toplamda {toplam} piksel yeşil var — "
                    "yani fide KADRAJDA, maske onu bütün bir leke olarak "
                    "çıkaramıyor, parçalara bölüyor. En küçük fideyi düşürmeyin "
                    "(gürültüyü içeri alır); eşiği biraz düşürüp maskeyi "
                    "doldurmak ya da birleştirme mesafesini artırmak doğru yol.")
        return (f"{ham_leke} leke bulundu ama hepsi en küçük fide kapısının "
                f"altında kaldı (en büyüğü {morf.get('en_buyuk', 0)} piksel, "
                f"kapı {en_az_piksel}). En küçük fideyi (mm) düşürün.")
    if leke == 0 and ham_leke == 0:
        return ("Yeşil pikseller vardı ama hiçbiri bağlı bir lekeye dönüşmedi: "
                "dağınık, tek tük pikseller. Eşiği biraz düşürmek maskeyi "
                "bütünleştirebilir.")
    return ""


def bul(rgb: np.ndarray, esik: float = ESIK, yaricap: int | None = None,
        en_az_piksel: int = EN_AZ_PIKSEL, denge: bool = True,
        gecerli_mi=None) -> dict[str, Any]:
    """Hattın tamamı tek çağrıda.

    -> {esik, oran, ham_leke, lekeler, maske, denge_kazanc, exg_oran,
        elenen, alan_disi}

    ESKİ ÇAĞRI AYNEN ÇALIŞIYOR. `bul(rgb, esik=..., en_az_piksel=...)`
    imzası bozulmadı; yeni parametrelerin hepsi isteğe bağlı ve
    varsayılanları eski davranışa en yakın olanı.

    `yaricap=None`   → AÇMA yarıçapını en küçük lekeden türet
                       (`acma_yaricapi`), KAPAMA'yı kare genişliğinden
                       (`kapama_yaricapi`). Açma yıkıcı, kapama yapıcı;
                       ikisini tek sayıya bağlamak fideyi siliyordu.
    `denge=False`    → beyaz dengesini atla (ham RGB ile eski davranış).
    `gecerli_mi(leke)` → ALAN SÜZGECİ. Leke sözlüğünü alıp True/False
                       döndüren bir işlev; False diyene liste dışı.
                       `tespit.alan_suzgeci(...)` tam bunu üretiyor:
                       lekenin yatak koordinatını çıkarıp dikim alanının
                       dışındaysa eliyor. Verilmezse hiçbir şey elenmiyor.
    """
    kalite = kare_kalitesi(rgb)
    dengeli, kazanc = (beyaz_denge(rgb) if denge else (rgb, [1.0, 1.0, 1.0]))
    y = yesil_maske(dengeli, float(esik))
    # AÇMA en küçük lekeden, KAPAMA çözünürlükten. Gerekçeleri
    # `acma_yaricapi` / `kapama_yaricapi` başlarında.
    r = acma_yaricapi(en_az_piksel) if yaricap is None else int(yaricap)
    kapa = kapama_yaricapi(rgb.shape[1]) if yaricap is None else int(yaricap)
    # SIRA: ÖNCE KAPAMA, SONRA AÇMA. Gerekçesi ve ölçümü `kapa_ac`
    # başında — açma önce gelince gözenekli yaprak maskesi siliniyordu.
    maske = kapa_ac(y["maske"], kapa, r)
    etiket, adet = etiketle(maske)
    ham = lekeler(etiket, adet, en_az_piksel)

    # ARA ADIMLARIN ÖLÇÜSÜ. "Leke neden bu kadar küçük ve parçalı"
    # sorusu ancak her aşamanın kaç piksel ve kaç bileşen bıraktığı
    # görülünce cevaplanıyor; tek bir "0 leke" çıktısıyla morfolojinin mi
    # eşiğin mi kapının mı yediği anlaşılmıyordu.
    def _asama(m: np.ndarray) -> dict[str, Any]:
        e, n = etiketle(m)
        buyukler = sorted((b["alan_px"] for b in lekeler(e, n, 1)), reverse=True)
        return {"piksel": int(m.sum()), "leke": int(n),
                "en_buyuk": buyukler[0] if buyukler else 0}
    asamalar = {
        "kapi": _asama(y["maske"]),          # renk kapılarından çıkan ham maske
        "morfoloji": _asama(maske),          # kapama + açma sonrası
        "en_az": {"piksel": int(sum(b["alan_px"] for b in ham)),
                  "leke": len(ham),
                  "en_buyuk": max((b["alan_px"] for b in ham), default=0)},
    }

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
        "kapama_yaricap": kapa,
        "exg_oran": y["exg_oran"],
        "elenen": y["elenen"],
        # KARENİN KENDİSİ ÖLÇÜLÜYOR. "Filiz bulunamadı" üç ayrı şey
        # olabiliyor ve üçünün çaresi farklı: karede gerçekten yeşil yok,
        # kare aşırı pozlanmış/karanlık (yeşil ÖLÇÜLEMEZ), ya da yeşil
        # var ama kapılar eledi. Panel eşiği düşürmeyi öneriyordu; kare
        # bembeyaz yanmışsa o öneri yanlış.
        "kare": kalite,
        "asamalar": asamalar,
        "tani": _tani(y, kalite, int(adet), len(secili), asamalar,
                      float(esik), int(en_az_piksel)),
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
