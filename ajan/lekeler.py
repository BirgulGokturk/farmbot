"""Karedeki bitki lekelerini bulur — TÜRDEN BAĞIMSIZ.

Bu modül "şurada bir bitki var" diyor, "bu marul" demiyor. Ayrım bilerek:
ekilen tür listesi büyüyor ve tür listesine bağlı bir bulucu her yeni
türde yeniden eğitim (ve Hailo yolunda yeniden HEF derlemesi) isterdi.
Yeşil bir leke yeşil bir lekedir; hangi bitki olduğu sonraki katmanın
işi ve orada tür bilgisi veriden geliyor, koddan değil.

NEDEN KLASİK YÖNTEMLE BAŞLIYOR
------------------------------
ExG (aşırı yeşil) eşiklemesi bugün çalışıyor: eğitim verisi, etiket,
model derlemesi istemiyor ve OpenCV Pi'de zaten kurulu. Hailo yolu bunun
yerine değil, ARDINDAN geliyor ve aynı sözleşmeyi döndürecek — üstteki
katmanlar hangi yolun çalıştığını bilmek zorunda kalmasın diye.

Sıralamanın ikinci gerekçesi pratik: sinir ağını eğitmek için etiketli
kare gerekiyor ve o etiketlerin ilk taslağını bu modül üretiyor. Elle
kutu çizmek yerine buradan çıkan lekeleri düzeltmek çok daha hızlı.

MİLİMETRE YOK
-------------
Çıktının tamamı PİKSEL. Kamera kalibrasyonu olmadan milimetre vermek
uydurma olurdu; kalibrasyon ayrı bir katman ve bu modül onu beklemiyor.
Kamera nereye takılırsa takılsın, hareket etse de etmese de çalışıyor.

EŞİK ÖLÇÜLÜYOR, SEÇİLMİYOR
--------------------------
Sabit bir ExG eşiği sabah ile öğlende, ışık açıkken ile kapalıyken
tutmuyor. Otsu eşiği her karede histogramdan hesaplanıyor. Bunun bir
bedeli var: karede hiç bitki yoksa Otsu yine bir eşik buluyor ve toprak
dokusunu ikiye bölüyor. `en_az_yesil_oran` bu durumu yakalıyor — ayrılan
alan çok küçükse "bitki yok" deniyor, leke uydurulmuyor.
"""

from __future__ import annotations

import time
from typing import Any

VARSAYILAN: dict[str, Any] = {
    # İŞLEME GENİŞLİĞİ. Kare 3840 px geliyor; tam çözünürlükte morfoloji
    # ve bağlı bileşen Pi'de saniyeler alıyor ve hiçbir şey kazandırmıyor:
    # bir filiz 1280 px'de de onlarca piksel kaplıyor. Sonuç koordinatları
    # gerçek karenin ölçeğine geri çevriliyor, yani küçültme dışarıdan
    # görünmüyor. 0 = küçültme yok.
    #
    # Bu değer JPEG ÇÖZMEYİ de etkiliyor (`_kare_coz`): düşürmek kareyi
    # daha küçük DCT ölçeğinde çözdürüyor ve asıl kazanç orada.
    "islem_genislik": 1280,

    # EN KÜÇÜK LEKE — karenin alanına ORAN olarak. Piksel vermek
    # çözünürlük değişince sessizce anlamını yitirirdi. 1/20000: 1280x720
    # karede ~46 px, yani yaklaşık 7x7'lik bir yeşillik. Bunun altı
    # genellikle yaprak kırıntısı ya da yosun.
    "en_kucuk_oran": 1.0 / 20000.0,

    # EN BÜYÜK LEKE. Karenin bu kadarını kaplayan bir "leke" bitki değil:
    # yeşil bir kap kenarı, çim zemin ya da eşiğin tamamen kaçırdığı bir
    # kare. Bitki diye göstermek yanlış koordinat üretir.
    "en_buyuk_oran": 0.25,

    # AYRILAN ALAN bunun altındaysa karede bitki yok sayılıyor. Otsu her
    # koşulda bir eşik bulduğu için gerekli — gerekçesi dosya başında.
    "en_az_yesil_oran": 0.0005,

    # MORFOLOJİ ÇEKİRDEĞİ — işleme genişliğine oranla. Sabit 3x3, 1280 px
    # bir karede hiçbir şey temizlemiyor. 1/320: 1280'de 4 px.
    "cekirdek_oran": 1.0 / 320.0,

    # ExG eşiği Otsu ile bulunuyor; bu değer yalnız Otsu'nun bulduğu eşiğe
    # eklenen güvenlik payı (ExG ölçeğinde, -255..255). Pozitif = daha
    # seçici. 0 = Otsu'ya dokunma.
    "esik_payi": 0.0,

    # TON KAPISI (HSV hue, OpenCV ölçeği 0-179). ExG "yeşil" bulmuyor,
    # "R'den fazla G" buluyor: sarı bir hortumda R ve G birlikte yüksek,
    # B düşük — 2G-R-B güçlü pozitif çıkıyor. Turkuaz bir kabloda da
    # aynısı oluyor. Sahada tam bu görüldü: sarı sulama hortumu ve mavi
    # kablolar bitki sanıldı.
    #
    # SINIRLAR ÖLÇÜLDÜ, seçilmedi. Bu makinenin iki kamerasından alınan
    # karelerde her lekenin medyan tonu okundu (15.09.2026, gündüz ışığı):
    #
    #   24-25  sarı sulama hortumu     (doygunluk 164-199)
    #   33-63  BİTKİ YAPRAĞI           (doygunluk  83-149)
    #   87-98  turkuaz ve mavi kablo   (doygunluk 122-200)
    #
    # İki geniş boşluk var: 25->33 ve 63->87. Kapı ikisinin ortasına
    # konuldu. En düşük yaprak 33, en yüksek 63; iki yanda da pay var.
    #
    # Doygunluk da ayrım veriyor ama ÖRTÜŞÜYOR (yaprak 149'a, kablo
    # 122'ye kadar çıkıyor); ikinci bir kapı eklemek eleme gücü
    # katmadan karmaşa katardı. Ölçümü yine de her lekede yazıyoruz.
    #
    # DİKKAT: bu ölçüm tek bir ışık koşulundan. Ton ışıkla pek
    # kaymıyor (ExG'nin aksine) ama bambaşka bir aydınlatmada —
    # örneğin yalnız bitki ışığı (D11) yanarken — panelden yeniden
    # bakılmalı. İkisi de 0 yapılırsa kapı tamamen kapanıyor.
    "ton_alt": 30,
    "ton_ust": 75,

    # LEKELERİ BİRLEŞTİRME. Bir fidenin iki yaprağı çoğu zaman AYRI
    # bileşen çıkıyor: aralarındaki gövde ince ve toprak rengine yakın,
    # eşik onu ayıramıyor. Panelde iki kutu görünüyor ama tek bitki var,
    # ve "kaç bitki" sorusunun cevabı iki katına çıkıyor.
    #
    # Ölçek bağımsız: iki lekenin KUTULARI arasındaki boşluk, ikisinin
    # ortalama kutu kenarının bu katından küçükse aynı bitki sayılıyor.
    # Örtüşen kutuların boşluğu sıfır, yani her zaman birleşiyorlar.
    # Sabit piksel eşiği kamera yüksekliği değişince anlamını yitirirdi.
    #
    # 0.5'ten 0.3'E İNDİRİLDİ. Sahada 0.5 sık bir kümede beş filizi tek
    # kutuya düşürdü. Yapay bir sırada ölçüldü (beş fide, her biri iki
    # yaprak, fideler arası boşluk eşiğe yakın): 0.5 -> 4 bitki (biri iki
    # fideyi toplamış), 0.3 -> 5 bitki ve her biri kendi iki yaprağıyla.
    # Üç yapraklı tek fide her iki değerde de tek bitki kalıyor.
    #
    # Panelde kaydırağı var; 0 birleştirmeyi tamamen kapatıyor. Fazla
    # büyütmek komşu İKİ FİDEYİ tek bitki yapar ve bu, bir fideyi ikiye
    # bölmekten daha kötü: var olmayan bir bitki yaratmak yerine olanı
    # kaybediyor.
    "birlestir_orani": 0.3,

    # KÜMENİN BÜYÜYEBİLECEĞİ ÜST SINIR — parça kenarının kaç katı.
    #
    # Yalnız yakınlık eşiği yetmiyor: sık ekilmiş bir sırada her fide
    # komşusuna eşik kadar yakınsa, birleşme turdan tura yayılıp bütün
    # sırayı tek bitki yapıyor. Ölçüldü: beş fide (on yaprak), fideler
    # arası boşluk eşiğe tam eşitken 0.5 oranında iki kümeye düştü, biri
    # SEKİZ parçalı.
    #
    # Bir fide kendi yaprağının birkaç katıdır, on katı değil. 3.0 =
    # kümenin kutusu, parçalarının ortalama kenarının üç katını geçemez.
    # 0 = sınır yok (eski davranış).
    "azami_kume_orani": 3.0,
}


def _kutu_olcekle(deger: float, olcek: float) -> int:
    return int(round(deger * olcek))


def _kare_coz(ham: bytes, hedef_genislik: int, cv2, np):
    """JPEG'i çözer — mümkünse ZATEN KÜÇÜLTÜLMÜŞ olarak.

    ÖLÇÜLDÜ: 3840x2880 bir kareyi `cv2.imdecode` ile tam çözmek Pi 5'te
    bütün işlemin yarısından fazlasını yiyordu (toplam ~1000 ms). Oysa
    leke bulma 1280 px'de yapılıyor; tam çözümde üretilen piksellerin
    dörtte üçü çözülür çözülmez atılıyordu.

    PIL'in `draft` kipi JPEG'i DCT seviyesinde 1/2, 1/4, 1/8 ölçekte
    çözebiliyor: atılacak piksel hiç üretilmiyor. Tam hedefe inmiyor
    (yalnız ikinin katları), kalanı `bul` içindeki resize tamamlıyor.

    PIL yoksa ya da dosya JPEG değilse OpenCV'ye düşüyoruz — yavaş ama
    çalışıyor. Hangi yolun kullanıldığı çıktıda yazıyor; "neden bu kadar
    sürdü" sorusunun cevabı görünür olsun.
    """
    import io

    try:
        from PIL import Image
    except ImportError:
        kare = cv2.imdecode(np.frombuffer(ham, dtype=np.uint8),
                            cv2.IMREAD_COLOR)
        if kare is None:
            return None, 0, 0, "opencv"
        return kare, kare.shape[1], kare.shape[0], "opencv"

    try:
        gorsel = Image.open(io.BytesIO(ham))
        tam_g, tam_y = gorsel.size
        if hedef_genislik and tam_g > hedef_genislik:
            # draft en yakın ikinin katını seçiyor; hedefin altına
            # DÜŞMÜYOR, yani çözünürlük kaybı yaşanmıyor.
            oran = hedef_genislik / float(tam_g)
            gorsel.draft("RGB", (hedef_genislik,
                                 max(1, int(round(tam_y * oran)))))
        gorsel = gorsel.convert("RGB")
        # PIL RGB veriyor, buradan sonrası OpenCV ve o BGR bekliyor.
        kare = np.asarray(gorsel)[:, :, ::-1].copy()
        return kare, tam_g, tam_y, "pil-draft"
    except Exception:
        kare = cv2.imdecode(np.frombuffer(ham, dtype=np.uint8),
                            cv2.IMREAD_COLOR)
        if kare is None:
            return None, 0, 0, "opencv"
        return kare, kare.shape[1], kare.shape[0], "opencv"


def _kenar(leke: dict[str, Any]) -> float:
    """Lekenin ortalama kutu kenarı — yakınlık ölçeği."""
    x1, y1, x2, y2 = leke.get("kutu") or [0, 0, 0, 0]
    return ((x2 - x1) + (y2 - y1)) / 2.0


def _bosluk(a: dict[str, Any], b: dict[str, Any]) -> float:
    """İki lekenin KUTULARI arasındaki boşluk. Örtüşüyorlarsa 0.

    Merkez mesafesi DEĞİL ve bu fark önemli: iki yaprak kutusu üst üste
    binmiş olsa bile merkezleri, kutuların yarısı kadar uzak olabiliyor.
    Merkezle ölçtüğümüzde örtüşen kutular bile "uzak" çıkıyordu.
    """
    ax1, ay1, ax2, ay2 = a.get("kutu") or [0, 0, 0, 0]
    bx1, by1, bx2, by2 = b.get("kutu") or [0, 0, 0, 0]
    dx = max(0.0, max(ax1, bx1) - min(ax2, bx2))
    dy = max(0.0, max(ay1, by1) - min(ay2, by2))
    return (dx * dx + dy * dy) ** 0.5


def _kume_kutu(parcalar: list[dict[str, Any]]) -> list[int]:
    """Parçaları saran en küçük dikdörtgen."""
    return [min(p["kutu"][0] for p in parcalar),
            min(p["kutu"][1] for p in parcalar),
            max(p["kutu"][2] for p in parcalar),
            max(p["kutu"][3] for p in parcalar)]


def _birlestir(lekeler: list[dict[str, Any]], oran: float) -> list[dict[str, Any]]:
    """Yakın lekeleri tek bitkide toplar — KARŞILIKLI EN YAKIN eşleşmeyle.

    ZİNCİRLEME KALDIRILDI. Önceki sürüm tek bağlantılı kümeleme
    yapıyordu: A-B yakın, B-C yakın ise A-B-C tek bitki. Sık ekilmiş bir
    yatakta o zincir hiç kopmuyor — sahada beş filiz tek kutuya düştü.
    Zincirleme, aralarında hiç yakınlık olmayan iki lekeyi bile
    aradaki köprüler yüzünden aynı bitki sayabiliyor.

    Şimdi yalnız KARŞILIKLI en yakın komşular birleşiyor: i'nin en yakını
    j VE j'nin en yakını i ise aynı bitki. Bir fidenin iki yaprağı
    birbirinin en yakınıdır; iki ayrı fidenin komşu yaprakları değildir,
    çünkü her birinin kendi öbür yaprağı daha yakın durur. Ölçüt aynı
    kalıyor: kutular arası boşluk, ortalama kutu kenarının `oran` katı.

    TEKRARLI ama SINIRLI. Bir turda yalnız çiftler birleşiyor, sonra
    kümeler yeniden değerlendiriliyor — üç yapraklı bir fide ikinci
    turda tamamlanıyor. Tur sayısı sınırlı: sınırsız tekrar,
    zincirlemenin yavaş çekimde geri gelmesi olurdu. Dört tur, sekiz
    parçaya kadar bir fideyi toplamaya yetiyor.
    """
    if oran <= 0 or len(lekeler) < 2:
        return [{**l, "parca": 1} for l in lekeler]

    azami = float(VARSAYILAN["azami_kume_orani"])
    # Her küme bir parça listesi; başlangıçta hepsi tek parça.
    kumeler: list[list[dict[str, Any]]] = [[l] for l in lekeler]

    for _ in range(4):
        n = len(kumeler)
        if n < 2:
            break
        kutular = [_kume_kutu(k) for k in kumeler]
        # EŞİK PARÇALARIN BOYUNA GÖRE, kümenin büyümüş kutusuna göre
        # DEĞİL. Küme kutusu her turda büyüyor; eşiği ona bağlamak eşiği
        # de büyütüyor ve küme komşu fideye atlıyordu — ölçüldü: beş
        # fide (on yaprak) 0.5 oranında iki kümeye düşüyordu, biri sekiz
        # parçalı. Parça kenarı turlar boyunca sabit kalıyor, yani bir
        # yaprağın komşusuna uzanabileceği mesafe de sabit.
        kenarlar = [sum(_kenar(p) for p in k) / len(k) for k in kumeler]

        # Her küme için EN YAKIN komşu ve o komşuya olan boşluk.
        en_yakin: list[int] = [-1] * n
        for i in range(n):
            iyi, iyi_bosluk = -1, None
            for j in range(n):
                if i == j:
                    continue
                b = _bosluk({"kutu": kutular[i]}, {"kutu": kutular[j]})
                if b > oran * (kenarlar[i] + kenarlar[j]) / 2.0:
                    continue                      # eşiğin dışında
                if iyi_bosluk is None or b < iyi_bosluk:
                    iyi, iyi_bosluk = j, b
            en_yakin[i] = iyi

        # KARŞILIKLI olanlar birleşiyor. Her küme en fazla bir kez
        # eşleşiyor: bir turda ikiden çok parça toplamak, zincirlemeyi
        # arka kapıdan geri getirirdi.
        kullanildi = [False] * n
        yeni_kumeler: list[list[dict[str, Any]]] = []
        degisti = False
        for i in range(n):
            if kullanildi[i]:
                continue
            j = en_yakin[i]
            birlesir = (j >= 0 and not kullanildi[j] and en_yakin[j] == i)
            if birlesir and azami > 0:
                # Birleşince ne kadar büyüyecek? Parça boyuna göre çok
                # büyüyen bir küme artık bir bitki değil, bir sıra.
                aday = kumeler[i] + kumeler[j]
                ak = _kume_kutu(aday)
                kume_kenar = ((ak[2] - ak[0]) + (ak[3] - ak[1])) / 2.0
                parca_kenar = sum(_kenar(p) for p in aday) / len(aday)
                if kume_kenar > azami * max(1.0, parca_kenar):
                    birlesir = False
            if birlesir:
                yeni_kumeler.append(kumeler[i] + kumeler[j])
                kullanildi[i] = kullanildi[j] = True
                degisti = True
            else:
                yeni_kumeler.append(kumeler[i])
                kullanildi[i] = True
        kumeler = yeni_kumeler
        if not degisti:
            break

    cikti: list[dict[str, Any]] = []
    for parcalar in kumeler:
        if len(parcalar) == 1:
            cikti.append({**parcalar[0], "parca": 1})
            continue
        alan = sum(float(p["alan_px"]) for p in parcalar)
        x1, y1, x2, y2 = _kume_kutu(parcalar)
        agirlik = alan or 1.0
        mx = sum(float(p["x"]) * float(p["alan_px"]) for p in parcalar) / agirlik
        my = sum(float(p["y"]) * float(p["alan_px"]) for p in parcalar) / agirlik
        # Renk EN BÜYÜK parçadan: medyanların ortalaması, küçük bir
        # parçanın gölgeli tonunu bitkinin tonu diye yazardı.
        en_buyuk = max(parcalar, key=lambda p: p["alan_px"])
        kutu_alan = max(1, (x2 - x1) * (y2 - y1))
        cikti.append({
            "x": int(round(mx)), "y": int(round(my)),
            "kutu": [x1, y1, x2, y2],
            "alan_px": int(round(alan)),
            # DOLGU birleşik kutuya göre: iki yaprak arasındaki boşluk
            # da sayılıyor ve bu doğru — bir fide kutusunu bir kablodan
            # daha az dolduruyorsa bunu görmek gerekiyor.
            "dolgu": round(alan / float(kutu_alan), 3),
            "en_boy": round((x2 - x1) / float(max(1, y2 - y1)), 3),
            "ton": en_buyuk.get("ton"),
            "doygunluk": en_buyuk.get("doygunluk"),
            "parlaklik": en_buyuk.get("parlaklik"),
            "parca": len(parcalar),
        })
    cikti.sort(key=lambda l: l["alan_px"], reverse=True)
    return cikti


def bul(ham: bytes, ayar: dict[str, Any] | None = None) -> dict[str, Any]:
    """JPEG karede bitki lekelerini bulur.

    Dönüş SÖZLEŞMESİ (Hailo yolu da aynısını döndürecek):

        {
          "lekeler": [{"x", "y", "kutu", "alan_px", "dolgu", "en_boy"}, …],
          "kare_px": [genişlik, yükseklik],   # GERÇEK karenin ölçüsü
          "yontem": "exg-otsu",
          "esik": <Otsu'nun bulduğu ExG eşiği>,
          "yesil_oran": <ayrılan alanın kareye oranı>,
          "sure_ms": <toplam>,
          "sebep": ""    # boş değilse leke listesi boş ve nedeni burada
        }

    `x`/`y` lekenin AĞIRLIK MERKEZİ, gerçek karenin piksel ölçeğinde.
    Kutunun ortası değil: yaprakları bir yana yatmış bir filizde ağırlık
    merkezi gövdeye kutu ortasından daha yakın duruyor.
    """
    a = {**VARSAYILAN, **(ayar or {})}
    basladi = time.monotonic()
    bos = {"lekeler": [], "kare_px": [0, 0], "yontem": "exg-otsu",
           "esik": None, "yesil_oran": 0.0, "sure_ms": 0.0, "sebep": ""}

    try:
        import cv2
        import numpy as np
    except ImportError as hata:
        # Sessiz kapanmıyor: sebep çağırana gidiyor, oradan panele.
        return {**bos, "sebep": f"OpenCV/NumPy yok: {hata}"}

    hedef = int(a.get("islem_genislik") or 0)
    coz_basi = time.monotonic()
    kare, tam_g, tam_y, coz_yolu = _kare_coz(ham, hedef, cv2, np)
    coz_ms = round((time.monotonic() - coz_basi) * 1000.0, 1)
    if kare is None:
        return {**bos, "sebep": "kare çözülemedi (bozuk ya da boş JPEG)"}
    bos["kare_px"] = [tam_g, tam_y]

    # --- küçültme ---------------------------------------------------------
    # `_kare_coz` yalnız ikinin katlarına inebiliyor; kalan farkı burada
    # kapatıyoruz. Zaten hedefteyse bu adım atlanıyor.
    if hedef and kare.shape[1] > hedef:
        oran = hedef / float(kare.shape[1])
        kare = cv2.resize(kare, (hedef, max(1, int(round(kare.shape[0] * oran)))),
                          interpolation=cv2.INTER_AREA)
    yuk, gen = kare.shape[:2]
    # Küçültülmüş piksel -> gerçek piksel. Sonuçlar bununla geri ölçekleniyor.
    geri = tam_g / float(gen)

    # --- ExG --------------------------------------------------------------
    # Normalize edilmiş kanallar kullanılıyor: ham RGB'de gölgedeki bir
    # yaprak ile güneşteki toprak benzer ExG verebiliyor. Toplama bölmek
    # parlaklığı düşürüp rengi bırakıyor.
    b, y, k = cv2.split(kare.astype(np.float32))    # BGR sırası
    toplam = b + y + k
    # Sıfıra bölmeyi engelle: tamamen siyah piksel (dolgu, kadraj dışı).
    toplam[toplam < 1.0] = 1.0
    exg = (2.0 * y - k - b) / toplam * 255.0
    exg8 = np.clip(exg, 0, 255).astype(np.uint8)

    # --- eşik -------------------------------------------------------------
    esik, maske = cv2.threshold(exg8, 0, 255,
                                cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    pay = float(a.get("esik_payi") or 0.0)
    if pay:
        _, maske = cv2.threshold(exg8, min(255.0, esik + pay), 255,
                                 cv2.THRESH_BINARY)
        esik = esik + pay

    # --- ton kapısı -------------------------------------------------------
    # HSV her koşulda hesaplanıyor: kapı kapalı olsa bile her lekenin
    # ölçülen tonu çıktıya giriyor. "Önce ölç, sonra eşik koy" ancak
    # ölçüm hep elde olursa işliyor.
    hsv = cv2.cvtColor(kare, cv2.COLOR_BGR2HSV)
    ton_alt, ton_ust = int(a.get("ton_alt") or 0), int(a.get("ton_ust") or 0)
    ton_elenen = 0
    if ton_alt or ton_ust:
        alt = max(0, min(179, ton_alt))
        ust = max(0, min(179, ton_ust)) or 179
        # `cv2.inRange` DEĞİL: tek kanallı bir dilime skaler sınır
        # geçmek OpenCV bağlamasında "lowerb is not a numpy array,
        # neither a scalar" ile patlıyor (5.0.0'da doğrulandı). NumPy
        # karşılaştırması bağlamaya hiç dokunmuyor ve aynı sonucu
        # veriyor.
        ton_k = hsv[:, :, 0]
        ton_maske = ((ton_k >= alt) & (ton_k <= ust)).astype(np.uint8) * 255
        onceki = int(np.count_nonzero(maske))
        maske = cv2.bitwise_and(maske, ton_maske)
        ton_elenen = onceki - int(np.count_nonzero(maske))

    yesil_oran = float(np.count_nonzero(maske)) / float(gen * yuk)
    bos["esik"] = round(float(esik), 1)
    bos["yesil_oran"] = round(yesil_oran, 5)
    if yesil_oran < float(a["en_az_yesil_oran"]):
        return {**bos, "sebep": (
            f"karede bitki görünmüyor — ayrılan yeşil alan %{yesil_oran*100:.3f}, "
            f"eşik %{float(a['en_az_yesil_oran'])*100:.3f}"),
            "coz_yolu": coz_yolu, "coz_ms": coz_ms,
            "sure_ms": round((time.monotonic() - basladi) * 1000.0, 1)}

    # --- morfoloji --------------------------------------------------------
    # Önce AÇMA: tek tük parlayan pikselleri siliyor. Sonra KAPAMA:
    # yaprak üstündeki ışık lekesinin açtığı delikleri dolduruyor. Sıra
    # ters olsaydı kapama önce gürültüyü de büyütürdü.
    kk = max(2, int(round(gen * float(a["cekirdek_oran"]))))
    cekirdek = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kk, kk))
    maske = cv2.morphologyEx(maske, cv2.MORPH_OPEN, cekirdek)
    maske = cv2.morphologyEx(maske, cv2.MORPH_CLOSE, cekirdek)

    # --- bileşenler -------------------------------------------------------
    sayi, etiketli, istatistik, merkezler = cv2.connectedComponentsWithStats(
        maske, connectivity=8)
    kare_alan = float(gen * yuk)
    en_kucuk = kare_alan * float(a["en_kucuk_oran"])
    en_buyuk = kare_alan * float(a["en_buyuk_oran"])

    lekeler: list[dict[str, Any]] = []
    elenen_kucuk = elenen_buyuk = 0
    for no in range(1, sayi):                        # 0 = arka plan
        x, y0, w, h, alan = istatistik[no]
        if alan < en_kucuk:
            elenen_kucuk += 1
            continue
        if alan > en_buyuk:
            elenen_buyuk += 1
            continue
        mx, my = merkezler[no]
        # Ölçüm YALNIZ kutunun içinde: bütün karede maske kurmak leke
        # başına bir tam kare taraması demekti (75 leke = 75 tarama).
        pencere = etiketli[y0:y0 + h, x:x + w] == no
        hsv_p = hsv[y0:y0 + h, x:x + w]
        if pencere.any():
            ton_d = int(np.median(hsv_p[:, :, 0][pencere]))
            doy_d = int(np.median(hsv_p[:, :, 1][pencere]))
            par_d = int(np.median(hsv_p[:, :, 2][pencere]))
        else:
            ton_d = doy_d = par_d = None
        lekeler.append({
            "x": _kutu_olcekle(mx, geri),
            "y": _kutu_olcekle(my, geri),
            "kutu": [_kutu_olcekle(x, geri), _kutu_olcekle(y0, geri),
                     _kutu_olcekle(x + w, geri), _kutu_olcekle(y0 + h, geri)],
            # Gerçek karenin ölçeğinde alan: küçültme oranının karesi.
            "alan_px": int(round(alan * geri * geri)),
            # DOLGU = lekenin kendi kutusunu ne kadar doldurduğu. Yuvarlak
            # bir fide ~0.7-0.8; ince uzun bir ot sapı ya da kap kenarı
            # çok daha düşük. Tür söylemiyor ama "bu bir bitki mi yoksa
            # çizgi mi" sorusuna veri veriyor.
            "dolgu": round(float(alan) / float(max(1, w * h)), 3),
            "en_boy": round(float(w) / float(max(1, h)), 3),
            # ÖLÇÜLEN RENK — eşik koymak için değil, eşiği SEÇMEK için.
            # Sahada sarı hortum ve turkuaz kablo bitki sanıldı; hangi
            # tonda olduklarını tahmin etmek yerine burada yazıyoruz.
            # Medyan, ortalama değil: tek parlak piksel ortalamayı
            # kaydırıyor, medyan kaydırmıyor.
            "ton": ton_d,
            "doygunluk": doy_d,
            "parlaklik": par_d,
        })

    # Büyükten küçüğe: panelde ve eşleştirmede önce belirgin olan.
    lekeler.sort(key=lambda l: l["alan_px"], reverse=True)

    ham_adet = len(lekeler)
    lekeler = _birlestir(lekeler, float(a.get("birlestir_orani") or 0.0))

    sebep = ""
    if not lekeler:
        # Yeşil vardı ama hiçbiri leke sayılmadı — sebebi söylüyoruz,
        # boş liste tek başına "bitki yok" anlamına gelmesin.
        sebep = (f"yeşil alan bulundu (%{yesil_oran*100:.2f}) ama leke "
                 f"kalmadı: {elenen_kucuk} tanesi çok küçük, "
                 f"{elenen_buyuk} tanesi çok büyük")

    # --- ÖLÇÜM ÖZETİ -----------------------------------------------------
    # Kalibrasyon olmadığı için milimetre yok; bunlar KARE İÇİ ölçüler ve
    # kendi aralarında karşılaştırılabilir. Aynı kameradan aynı yerden
    # alınan iki kare arasındaki değişim, büyümenin kendisi.
    #
    # `yesil_oran` zaten kareye oranlı olduğu için kamera yüksekliği
    # değişmedikçe zaman içinde karşılaştırılabilir; `alan_px` ise
    # çözünürlüğe bağlı, o yüzden ikisi birlikte yazılıyor.
    alanlar = sorted((int(l["alan_px"]) for l in lekeler), reverse=True)
    olcum = {
        "adet": len(lekeler),
        "ham_adet": ham_adet,
        "toplam_alan_px": sum(alanlar),
        "en_buyuk_px": alanlar[0] if alanlar else 0,
        "ortanca_px": alanlar[len(alanlar) // 2] if alanlar else 0,
        # Kareye oran: çözünürlükten bağımsız, zaman serisinde asıl
        # karşılaştırılabilir olan sayı.
        "kapladigi_oran": (round(sum(alanlar) / float(max(1, tam_g * tam_y)), 6)
                           if alanlar else 0.0),
    }

    return {
        "lekeler": lekeler,
        "olcum": olcum,
        "kare_px": [tam_g, tam_y],
        "yontem": "exg-otsu",
        "esik": round(float(esik), 1),
        "yesil_oran": round(yesil_oran, 5),
        "elenen": {"kucuk": elenen_kucuk, "buyuk": elenen_buyuk,
                   "ton_px": ton_elenen},
        "ton_kapisi": ([ton_alt, ton_ust] if (ton_alt or ton_ust) else None),
        # Çözme ayrı yazılıyor: toplam süre yükseldiğinde suçlunun JPEG
        # çözme mi yoksa leke bulma mı olduğu tahmin edilmesin.
        "coz_yolu": coz_yolu,
        "coz_ms": coz_ms,
        "sure_ms": round((time.monotonic() - basladi) * 1000.0, 1),
        "sebep": sebep,
    }


# --------------------------------------------------------------------------- #
# Ölçüm aracı
# --------------------------------------------------------------------------- #
# Ajana bağlamadan önce gerçek karelerde denemek için. Eşik ve süre
# tahmin edilmiyor, burada ölçülüyor.
#
#   python3 lekeler.py kare.jpg [kare2.jpg …]
#   python3 lekeler.py kare.jpg --isaretle cikti.jpg
#
if __name__ == "__main__":
    import json
    import sys

    argumanlar = [a for a in sys.argv[1:]]
    isaret_yolu = ""
    if "--isaretle" in argumanlar:
        i = argumanlar.index("--isaretle")
        isaret_yolu = argumanlar[i + 1] if i + 1 < len(argumanlar) else ""
        del argumanlar[i:i + 2]

    if not argumanlar:
        print(__doc__.strip().splitlines()[0])
        print("\nKullanım: python3 lekeler.py KARE.jpg [...] [--isaretle CIKTI.jpg]")
        raise SystemExit(2)

    for yol in argumanlar:
        with open(yol, "rb") as dosya:
            veri = dosya.read()
        sonuc = bul(veri)
        ozet = {k: v for k, v in sonuc.items() if k != "lekeler"}
        print(f"\n=== {yol} ===")
        print(json.dumps(ozet, ensure_ascii=False))
        print(f"leke: {len(sonuc['lekeler'])}  "
              f"(cozme {sonuc.get('coz_ms')} ms / toplam {sonuc.get('sure_ms')} ms, "
              f"yol={sonuc.get('coz_yolu')})")
        for leke in sonuc["lekeler"][:15]:
            print(f"  ({leke['x']:5d},{leke['y']:5d})  alan={leke['alan_px']:7d} "
                  f"dolgu={leke['dolgu']:.2f} en/boy={leke['en_boy']:.2f} "
                  f"ton={leke.get('ton')} doyg={leke.get('doygunluk')} "
                  f"parl={leke.get('parlaklik')}")

        if isaret_yolu and sonuc["lekeler"]:
            import cv2
            import numpy as np
            kare = cv2.imdecode(np.frombuffer(veri, dtype=np.uint8),
                                cv2.IMREAD_COLOR)
            for leke in sonuc["lekeler"]:
                x1, y1, x2, y2 = leke["kutu"]
                cv2.rectangle(kare, (x1, y1), (x2, y2), (0, 0, 255), 3)
                cv2.circle(kare, (leke["x"], leke["y"]), 6, (255, 0, 0), -1)
            cv2.imwrite(isaret_yolu, kare)
            print(f"işaretli kare yazıldı: {isaret_yolu}")
