"""Piksel → makine koordinatı, ve tespitlerin kayıtlı bitkilerle eşlenmesi.

`goruntu.py` "karede ne var" sorusunu piksel olarak cevaplıyor. Burası
"o şey yatağın neresinde" sorusunu milimetre olarak cevaplıyor. İkisi
bilerek ayrı: kalibrasyon değişince segmentasyon etkilenmemeli.

--------------------------------------------------------------------
İKİ MODEL — önce harita, yoksa ölçek+dönme
--------------------------------------------------------------------

**HARİTA (homografi).** Kalibrasyonda `harita` varsa bir pikselin yatak
koordinatı doğrudan ondan çıkıyor:

    (x, y) = harita_uygula(H, u, v)

Perspektifi de taşıyor. Bu kurulumda kamera yatağa sert açıyla bakıyor
ve sahada ölçüldü: ölçek+dönme modeli 52 mm, harita 9 mm yanıldı.

**ÖLÇEK + DÖNME (benzerlik).** Harita yoksa eski zincir aynen geçerli
ve `static/katmanlar/70-kamera-kareleri.js` ile birebir aynı:

    merkez  = kare konumu + (ofset_x, ofset_y)
    yerel   = (px - W/2, py - H/2) x mm_px
    aynala  → döndür → merkeze taşı

İKİ AYRI HESAP OLMAMALI. Panelde çizilen kare ile sunucunun "bu leke
şurada" dediği yer ayrışırsa, hangisinin doğru olduğunu anlamanın yolu
yok. O dosya da haritayı okuyor; biri değişirse diğeri de değişmeli.

--------------------------------------------------------------------
MUTLAK HARİTA — sabit kameranın karesi artık yerini biliyor
--------------------------------------------------------------------

Harita, yatağa yapıştırılmış etiketlerin MAKİNE koordinatlarından
çıkarılıyor; yani doğrudan yatak milimetresi veriyor. Sabit kamera hiç
oynamadığı için bu mutlak: aynı piksel hep aynı yeri gösteriyor ve
karenin bir "makine konumu" olmasına gerek yok. Sabit kamerada koordinat
vermeyi reddeden eski kural (`YOK_KONUM` / `SABIT_KAMERA`) tam da bu
bilginin eksikliğindendi; harita o boşluğu doldurduğu için ret kalktı.

Hareketli kamerada aynı harita yalnız ÖLÇÜLDÜĞÜ konumda geçerli. Ölçüm
anındaki makine konumu (`harita_makine_x/y`) kayıtlıysa aradaki fark
ekleniyor; kayıtlı değilse harita hareketli kamerada kullanılmıyor —
kaydırmayı tahmin etmektense benzerlik modeline düşmek doğru.

--------------------------------------------------------------------
Sessizce yapılmayanlar
--------------------------------------------------------------------

* **Kalibrasyon yoksa dönüşüm YOK.** `mm_px = 0` ve harita yok "daha
  ölçülmedi" demek. Uydurma bir ölçekle üretilmiş milimetre, yanlış
  olduğu belli olmayan bir sayıdır — en kötü tür.
* **Konum bilgisi hiçbir yerden çıkmıyorsa dönüşüm YOK.** Mutlak harita
  da yoksa ve kare nerede çekildiğini bilmiyorsa (PLC kopukken çekilmiş)
  koordinat üretilmiyor.
* **Makine hareket hâlindeyken çekilen kare kullanılmaz.** Hem
  bulanık hem de konumu belirsiz.
"""

from __future__ import annotations

import math
from typing import Any

import kalibrasyon

# Kalibrasyon yokken bu sebeplerden biri dönüyor; panel bunları yazıyor.
YOK_KALIBRASYON = ("Kamera kalibre edilmemiş (mm_px = 0, harita yok). Kamera "
                   "sekmesi → 'AprilTag ile kalibre et' ile ölçün — onsuz "
                   "pikseli milimetreye çeviremeyiz.")
YOK_KONUM = ("Karenin makine konumu yok (PLC kopukken çekilmiş) ve mutlak "
             "harita da yok. Nerede çekildiği bilinmeyen bir kare haritaya "
             "konamaz.")
SABIT_KAMERA = ("Sabit kamera henüz yatağa oturmadı: mutlak harita yok. Dört "
                "AprilTag'i yatağa yapıştırıp koordinatlarını girin ve "
                "'AprilTag ile kalibre et' deyin — ondan sonra bu karenin "
                "her pikseli yatak koordinatı verir. Şimdilik yalnız ölçüler "
                "(en, boy, çap) milimetre.")
HAREKETLI = ("Kare makine hareket hâlindeyken çekilmiş — hem bulanık hem de "
             "konumu belirsiz.")


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
        return s if math.isfinite(s) else varsayilan
    except (TypeError, ValueError):
        return varsayilan


def mm_px(kalib: dict[str, Any] | None) -> float:
    """Bir piksel kaç mm. 0 = kalibre edilmemiş.

    HARİTA VARSA BU SAYI ORTALAMADIR. Eğik bakan kamerada bir pikselin mm
    karşılığı karenin bir ucundan öbürüne değişiyor; `mm_px` etiketlerden
    çıkarılmış tek bir ortalama. Ölçü hesapları haritalı kamerada
    haritadan geçiyor (bkz. `leke_mm`), bu sayı yalnız kabaca "kare kaç
    mm" demek için duruyor.
    """
    return max(0.0, _sayi((kalib or {}).get("mm_px"), 0.0))


def harita(kalib: dict[str, Any] | None) -> Any:
    """Kalibrasyondaki homografi — yoksa ya da bozuksa None.

    Bozuk haritayı SESSİZCE atıyoruz: burada patlamak, kalibrasyonu
    bozuk tek bir kamera yüzünden bütün çözümleme yolunu kapatırdı.
    Doğrulama zaten `kalibrasyon.kaydet` içinde yapılıyor.
    """
    ham = (kalib or {}).get("harita")
    if not ham:
        return None
    try:
        kalibrasyon.harita_uygula(ham, 0.0, 0.0)
    except kalibrasyon.KalibrasyonHatasi:
        return None
    return ham


def _harita_kaydirma(kare: dict[str, Any] | None,
                     kalib: dict[str, Any] | None) -> tuple[float, float] | None:
    """Haritayı bu kareye taşımak için gereken kayma. None = harita kullanılamaz.

    Sabit kamera (ölçüm konumu yazılmamış): kayma yok, harita mutlak.
    Hareketli kamera: kare, haritanın ölçüldüğü konumdan ne kadar uzakta
    çekildiyse o kadar. Kare konumsuzsa harita kullanılamaz — hareketli
    kamerada nerede çekildiği bilinmeyen kare, haritayla da yerine oturmaz.
    """
    k = kalib or {}
    mx, my = k.get("harita_makine_x"), k.get("harita_makine_y")
    if mx in (None, "") or my in (None, ""):
        return (0.0, 0.0)
    if not kare or kare.get("x") is None or kare.get("y") is None:
        return None
    return (_sayi(kare.get("x")) - _sayi(mx), _sayi(kare.get("y")) - _sayi(my))


def haritali_mi(kare: dict[str, Any] | None, kalib: dict[str, Any] | None) -> bool:
    """Bu kare bu kalibrasyonun haritasıyla çözülebiliyor mu."""
    return harita(kalib) is not None and _harita_kaydirma(kare, kalib) is not None


def mutlak_mi(kalib: dict[str, Any] | None) -> bool:
    """Karenin makine konumu OLMADAN koordinat verebiliyor mu.

    Sabit üst kameranın karesi bunu sağlıyor: harita yatağa yapıştırılmış
    etiketlerden çıktığı için doğrudan yatak koordinatı veriyor.
    """
    return harita(kalib) is not None and _harita_kaydirma(None, kalib) is not None


def kalibre_mi(kalib: dict[str, Any] | None) -> bool:
    return mm_px(kalib) > 0.0 or harita(kalib) is not None


def _kalib_piksel(kalib: dict[str, Any] | None,
                  genislik_px: float | None,
                  yukseklik_px: float | None) -> tuple[float, float, float, float]:
    """(W, H, sx, sy) — işlenen kare ölçüsü ve kalibrasyon uzayına ölçek.

    Kare, kalibrasyon anındakinden başka bir çözünürlükte gelebiliyor
    (küçültülmüş kare, farklı kamera kipi). Piksel önce KALİBRASYON
    uzayına taşınıyor: harita orada tanımlı ve iki katı bir uzaydan
    gelen sayı bütün koordinatları ikiye katlardı.
    """
    k = kalib or {}
    W = _sayi(genislik_px, 0.0) or _sayi(k.get("genislik_px"), 640.0)
    H = _sayi(yukseklik_px, 0.0) or _sayi(k.get("yukseklik_px"), 480.0)
    kw = _sayi(k.get("genislik_px"), 640.0)
    kh = _sayi(k.get("yukseklik_px"), 480.0)
    return W, H, (kw / W if W else 1.0), (kh / H if H else 1.0)


def kare_koseler(kare: dict[str, Any], kalib: dict[str, Any] | None,
                 genislik_px: float | None = None,
                 yukseklik_px: float | None = None
                 ) -> list[tuple[float, float]]:
    """Karenin dört köşesinin makine koordinatı (sol üstten saat yönünde).

    Haritalı kamerada kare haritada DİKDÖRTGEN DEĞİL: eğik bakış onu
    yamuğa çeviriyor. Dört köşe, "kare nereye düşüyor" sorusunun eksiksiz
    cevabı; en/boy ondan türetiliyor.
    """
    W, H, _, _ = _kalib_piksel(kalib, genislik_px, yukseklik_px)
    return [piksel_mm(u, v, kare, kalib, genislik_px, yukseklik_px)
            for u, v in ((0.0, 0.0), (W, 0.0), (W, H), (0.0, H))]


def kare_olcusu(kalib: dict[str, Any] | None,
                kare: dict[str, Any] | None = None) -> tuple[float, float]:
    """Karenin mm cinsinden (en, boy) ölçüsü.

    Haritalı kamerada köşelerin sınırlarından; yoksa piksel x mm_px.
    """
    k = kalib or {}
    if harita(k) is not None and _harita_kaydirma(kare or {"x": 0, "y": 0}, k):
        koseler = kare_koseler(kare or {"x": 0.0, "y": 0.0}, k)
        xs = [p[0] for p in koseler]
        ys = [p[1] for p in koseler]
        return (max(xs) - min(xs), max(ys) - min(ys))
    m = mm_px(k)
    return (_sayi(k.get("genislik_px"), 640.0) * m,
            _sayi(k.get("yukseklik_px"), 480.0) * m)


def merkez(kare: dict[str, Any], kalib: dict[str, Any] | None) -> tuple[float, float]:
    """Karenin makine koordinatındaki merkezi.

    Haritalı kamerada orta pikselin gittiği yer; yoksa kare konumu +
    kameranın uç ucundan kayması (`ofset_x/y`).
    """
    k = kalib or {}
    # Koşul `haritali_mi`: harita varken ama bu kareye uygulanamazken
    # buraya girmek, `piksel_mm`in benzerlik koluna düşüp tekrar buraya
    # dönmesi demek olurdu.
    if haritali_mi(kare, k):
        W = _sayi(k.get("genislik_px"), 640.0)
        H = _sayi(k.get("yukseklik_px"), 480.0)
        return piksel_mm(W / 2.0, H / 2.0, kare, k)
    return (_sayi(kare.get("x")) + _sayi(k.get("ofset_x")),
            _sayi(kare.get("y")) + _sayi(k.get("ofset_y")))


def piksel_mm(px: float, py: float, kare: dict[str, Any],
              kalib: dict[str, Any] | None,
              genislik_px: float | None = None,
              yukseklik_px: float | None = None) -> tuple[float, float]:
    """Karedeki (px, py) pikselinin makine koordinatı (mm).

    `genislik_px/yukseklik_px` verilmezse kalibrasyondaki değerler
    kullanılıyor. Vermek şu durumda gerekiyor: kare küçültülerek
    işlendiyse piksel uzayı kalibrasyondakinden farklı.

    HARİTA VARSA ONDAN GEÇİYOR — perspektif de düzeliyor.
    """
    k = kalib or {}
    W, H, sx, sy = _kalib_piksel(k, genislik_px, yukseklik_px)

    H_harita = harita(k)
    if H_harita is not None:
        kayma = _harita_kaydirma(kare, k)
        if kayma is not None:
            try:
                x, y = kalibrasyon.harita_uygula(H_harita, _sayi(px) * sx,
                                                 _sayi(py) * sy)
            except kalibrasyon.KalibrasyonHatasi:
                pass          # payda sıfır: bu piksel ufuk çizgisinde
            else:
                return (x + kayma[0], y + kayma[1])

    olcek = mm_px(k)
    # Küçültülmüş kare: aynı görüş alanı daha az piksele düştüğü için
    # bir pikselin mm karşılığı büyüyor.
    olcek_x = olcek * sx
    olcek_y = olcek * sy

    yerel_x = (_sayi(px) - W / 2.0) * olcek_x
    yerel_y = (_sayi(py) - H / 2.0) * olcek_y
    if k.get("ayna_x"):
        yerel_x = -yerel_x
    if k.get("ayna_y"):
        yerel_y = -yerel_y

    aci = math.radians(_sayi(k.get("donme")))
    c, s = math.cos(aci), math.sin(aci)
    cx, cy = merkez(kare, k)
    return (cx + yerel_x * c - yerel_y * s,
            cy + yerel_x * s + yerel_y * c)


def leke_mm(leke: dict[str, Any], kare: dict[str, Any], kalib: dict[str, Any] | None,
            genislik_px: float | None = None,
            yukseklik_px: float | None = None) -> dict[str, Any]:
    """Bir lekenin milimetre karşılığı: merkez, kutu, en/boy, alan.

    En/boy DÖNDÜRÜLMÜŞ kutunun eksen hizalı sınırlarından değil, kutunun
    kendi kenarlarından hesaplanıyor: dönme 0 değilken ikisi farklı ve
    bize bitkinin gerçek genişliği lazım, ekrandaki kutunun değil.
    """
    k = kalib or {}
    _, _, sx, _ = _kalib_piksel(k, genislik_px, yukseklik_px)
    olcek_x = mm_px(k) * sx

    cx, cy = piksel_mm(leke["cx"], leke["cy"], kare, k, genislik_px, yukseklik_px)
    # Dört köşe: dönme varsa kutu haritada eğik duruyor.
    koseler = [piksel_mm(x, y, kare, k, genislik_px, yukseklik_px)
               for x, y in ((leke["x1"], leke["y1"]), (leke["x2"], leke["y1"]),
                            (leke["x2"], leke["y2"]), (leke["x1"], leke["y2"]))]
    xs = [p[0] for p in koseler]
    ys = [p[1] for p in koseler]

    # ÖLÇÜ DE HARİTADAN GEÇİYOR. Eğik bakan kamerada bir pikselin mm
    # karşılığı karenin bir ucundan öbürüne değişiyor; tek bir ortalama
    # mm/px ile çarpmak, uzaktaki bitkiyi olduğundan küçük gösterir.
    # Lekenin KENDİ yerinde ölçüyoruz: orta yatay ve orta dikey kesit.
    if haritali_mi(kare, k):
        sol = piksel_mm(leke["x1"], leke["cy"], kare, k, genislik_px, yukseklik_px)
        sag = piksel_mm(leke["x2"], leke["cy"], kare, k, genislik_px, yukseklik_px)
        ust = piksel_mm(leke["cx"], leke["y1"], kare, k, genislik_px, yukseklik_px)
        alt = piksel_mm(leke["cx"], leke["y2"], kare, k, genislik_px, yukseklik_px)
        en_mm = math.dist(sol, sag)
        boy_mm = math.dist(ust, alt)
        # Piksel başına mm, tam bu lekenin durduğu yerde.
        yerel_olcek = (en_mm / max(1e-6, _sayi(leke.get("en_px")))
                       if _sayi(leke.get("en_px")) > 0 else olcek_x)
    else:
        en_mm = _sayi(leke.get("en_px")) * olcek_x
        boy_mm = _sayi(leke.get("boy_px")) * olcek_x
        yerel_olcek = olcek_x

    alan_px = max(_sayi(leke.get("alan_px")), 0.0)
    return {
        "no": leke.get("no"),
        "x": round(cx, 1), "y": round(cy, 1),
        "x1": round(min(xs), 1), "y1": round(min(ys), 1),
        "x2": round(max(xs), 1), "y2": round(max(ys), 1),
        "en_mm": round(en_mm, 1),
        "boy_mm": round(boy_mm, 1),
        # Alan mm²: piksel alanı x (mm/piksel)². Yaprağın gerçek yüzeyi
        # değil, üstten görünen izdüşümü — büyüme takibi için yeterli.
        "alan_mm2": round(alan_px * yerel_olcek * yerel_olcek, 1),
        "alan_px": leke.get("alan_px"),
        "dolgu": leke.get("dolgu"),
        # Dairesel eşdeğer çap: alanı aynı olan dairenin çapı. Yayılım
        # ölçüsü olarak kutu genişliğinden sağlam — tek bir uzun yaprak
        # kutuyu şişiriyor ama alanı şişirmiyor.
        "cap_mm": round(2.0 * math.sqrt(alan_px / math.pi) * yerel_olcek, 1),
    }


def leke_boyut_mm(leke: dict[str, Any], kalib: dict[str, Any] | None,
                  genislik_px: float | None = None) -> dict[str, Any]:
    """Yalnız ÖLÇÜ — konum yok. Sabit kameranın verebildiği kadarı.

    Sabit kamera yatağın neresine baktığını bilmiyor, ama bir pikselin kaç
    mm olduğunu biliyor (kendi `mm_px`i). Yaprak çapı, alan, en/boy bu
    sayıdan çıkıyor ve doğru. Çıkmayan tek şey lekenin yatak koordinatı;
    onu uydurmuyoruz, hiç yazmıyoruz.
    """
    k = kalib or {}
    _, _, sx, _ = _kalib_piksel(k, genislik_px, None)
    olcek_x = mm_px(k) * sx
    alan_px = max(_sayi(leke.get("alan_px")), 0.0)
    return {
        "no": leke.get("no"),
        "en_mm": round(_sayi(leke.get("en_px")) * olcek_x, 1),
        "boy_mm": round(_sayi(leke.get("boy_px")) * olcek_x, 1),
        "alan_mm2": round(alan_px * olcek_x * olcek_x, 1),
        "alan_px": leke.get("alan_px"),
        "dolgu": leke.get("dolgu"),
        "cap_mm": round(2.0 * math.sqrt(alan_px / math.pi) * olcek_x, 1),
    }


def boyutlar_mm(lekeler_px: list[dict[str, Any]], kalib: dict[str, Any] | None,
                *, genislik_px: float | None = None) -> dict[str, Any]:
    """Konumsuz kare için ölçü listesi. -> {lekeler, ret}

    Kalibrasyon yoksa yine hiçbir şey: kalibre edilmemiş kamerada milimetre
    yazmak, piksel yazmaktan KÖTÜ — yanlış olduğu görünmüyor.
    """
    if not kalibre_mi(kalib):
        return {"lekeler": [], "ret": [YOK_KALIBRASYON]}
    return {"lekeler": [leke_boyut_mm(b, kalib, genislik_px) for b in lekeler_px],
            "ret": []}


def cozumle(lekeler_px: list[dict[str, Any]], kare: dict[str, Any],
            kalib: dict[str, Any] | None, *,
            genislik_px: float | None = None, yukseklik_px: float | None = None,
            hareket: bool = False) -> dict[str, Any]:
    """Piksel lekelerini milimetreye çevirir. -> {lekeler, ret}

    `ret` doluysa dönüşüm YAPILMADI ve sebebi orada. Kısmi sonuç
    dönmüyoruz: yarısı milimetre yarısı piksel bir liste, okuyanın
    hangisinin ne olduğunu bilemeyeceği bir liste.
    """
    ret: list[str] = []
    if not kalibre_mi(kalib):
        ret.append(YOK_KALIBRASYON)
    # KONUM İKİ KAYNAKTAN GELEBİLİYOR: karenin kendi makine konumundan ya da
    # mutlak haritadan. İkisi de yoksa koordinat üretilmiyor.
    elif not haritali_mi(kare, kalib) and (kare.get("x") is None
                                           or kare.get("y") is None):
        ret.append(YOK_KONUM)
    if hareket:
        ret.append(HAREKETLI)
    if ret:
        return {"lekeler": [], "ret": ret, "kare_mm": None}

    en, boy = kare_olcusu(kalib, kare)
    cx, cy = merkez(kare, kalib)
    haritali = haritali_mi(kare, kalib)
    kare_mm: dict[str, Any] = {
        "x": round(cx, 1), "y": round(cy, 1),
        "en": round(en, 1), "boy": round(boy, 1),
        # Haritalı karede tek bir "dönme" yok — kare haritada yamuk
        # duruyor. Sınır denetimi (`kare_icinde`) dönmeyi sıfır alıp
        # köşelerin sınırlarına bakıyor, doğrusu da bu.
        "donme": 0.0 if haritali else _sayi((kalib or {}).get("donme")),
        "mm_px": round(mm_px(kalib), 4),
        "harita": haritali,
    }
    if haritali:
        # Dört köşe: paneldeki kare katmanı fotoğrafı bu dörtgene
        # oturtuyor — dikdörtgen çizmek eğik bakışta kareyi yatağın
        # yanlış yerine koyardı.
        kare_mm["kose"] = [[round(x, 1), round(y, 1)]
                           for x, y in kare_koseler(kare, kalib,
                                                    genislik_px, yukseklik_px)]
    return {
        "lekeler": [leke_mm(b, kare, kalib, genislik_px, yukseklik_px)
                    for b in lekeler_px],
        "ret": [],
        "kare_mm": kare_mm,
    }


# --------------------------------------------------------------------------- #
# Kutu biçimi 0-1 olan tespitler (Hailo/YOLO çıktısı)
# --------------------------------------------------------------------------- #
def oranli_kutu_mm(kutu: dict[str, Any], kare: dict[str, Any],
                   kalib: dict[str, Any] | None) -> dict[str, Any] | None:
    """0-1 aralığında normalize edilmiş kutuyu milimetreye çevirir.

    Hailo tespitleri bu biçimde geliyor. Aynı dönüşüm, tek fark kutunun
    önce piksele açılması — böylece sinir ağı çıktısı ile klasik
    segmentasyon çıktısı haritada aynı uzayda buluşuyor.
    """
    if not kalibre_mi(kalib):
        return None
    if kare.get("x") is None and not haritali_mi(kare, kalib):
        return None
    k = kalib or {}
    W = _sayi(k.get("genislik_px"), 640.0)
    H = _sayi(k.get("yukseklik_px"), 480.0)
    sahte = {
        "no": None,
        "cx": (_sayi(kutu.get("x1")) + _sayi(kutu.get("x2"))) / 2.0 * W,
        "cy": (_sayi(kutu.get("y1")) + _sayi(kutu.get("y2"))) / 2.0 * H,
        "x1": _sayi(kutu.get("x1")) * W, "y1": _sayi(kutu.get("y1")) * H,
        "x2": _sayi(kutu.get("x2")) * W, "y2": _sayi(kutu.get("y2")) * H,
        "en_px": (_sayi(kutu.get("x2")) - _sayi(kutu.get("x1"))) * W,
        "boy_px": (_sayi(kutu.get("y2")) - _sayi(kutu.get("y1"))) * H,
        "alan_px": ((_sayi(kutu.get("x2")) - _sayi(kutu.get("x1"))) * W
                    * (_sayi(kutu.get("y2")) - _sayi(kutu.get("y1"))) * H),
        "dolgu": 1.0,
    }
    cikti = leke_mm(sahte, kare, k)
    cikti["sinif"] = str(kutu.get("sinif", ""))
    cikti["guven"] = round(_sayi(kutu.get("guven")), 3)
    return cikti


# --------------------------------------------------------------------------- #
# Tespit ↔ kayıtlı bitki eşlemesi
# --------------------------------------------------------------------------- #
# Eşleşme yarıçapı için taban. Bitkinin kendi yayılımı bundan küçükse
# bile bu kadar pay veriyoruz: yeni ekilmiş bir fidenin yarıçapı ~0 ve
# sıfır yarıçapla hiçbir şey eşleşmez.
EN_AZ_YARICAP_MM = 30.0

# Yayılımın kaç katına kadar eşleşme sayılsın. 1.0 = tam kanopi kenarı.
# 1.5 pay bırakıyor: leke merkezi yaprakların ağırlık merkezi, gövdenin
# tam üstü değil.
YARICAP_KATI = 1.5

# Hiçbir koşulda bundan uzağa eşleşme yok. Olgun bir bitkinin kanopisi
# 300 mm olabiliyor ve tek başına bırakılırsa karenin yarısındaki her
# lekeyi sahipleniyor.
AZAMI_YARICAP_MM = 120.0


def _eslesme_siniri(bitki_yaricap: float, leke_yaricap: float,
                    en_az: float, kat: float) -> float:
    """Bu leke bu bitkiye en fazla kaç mm uzaktan eşleşebilir.

    İKİ tarafı da hesaba katıyor ve KÜÇÜĞÜNÜ alıyor. Sebebi ölçüldü:
    yalnız bitkinin yayılımına bakınca, yayılım eğrisi bağlı değilken
    katalogdaki OLGUN çap kullanılıyor (bkz. `sulama.guncel_yaricap_mm`
    ve oradaki uyarı) ve yeni ekilmiş bir marul fidesi 130 mm ötedeki
    lekeyi sahipleniyordu.

    Lekenin kendi yarıçapı da sınırlıyor: 13 mm'lik bir leke, merkezi
    43 mm'den uzaktaki bir bitkinin kanopisi olamaz. `en_az` payı
    tohumun tam noktaya düşmemesi ve fidenin eğik çıkması için.
    """
    bitki = max(0.0, bitki_yaricap) * kat
    leke = max(0.0, leke_yaricap) + en_az
    return max(en_az, min(bitki if bitki > 0 else leke, leke, AZAMI_YARICAP_MM))


def eslestir(lekeler: list[dict[str, Any]], bitkiler: list[dict[str, Any]], *,
             yaricap_mm: dict[str, float] | None = None,
             yasa_gore: dict[str, bool] | None = None,
             en_az_yaricap: float = EN_AZ_YARICAP_MM,
             kat: float = YARICAP_KATI) -> dict[str, Any]:
    """Lekeleri kayıtlı bitkilerle eşler.

    -> {eslesen, yabani_aday, gorunmeyen}

      * `eslesen`      — lekenin yanında kayıtlı bitki var: bitki YAŞIYOR
        ve lekenin ölçüsü o bitkinin ölçüsü.
      * `yabani_aday`  — hiçbir kayıtlı bitkiye yakın olmayan leke.
        ADAY diyoruz: yosun, düşmüş yaprak, gölge ya da kayıt edilmemiş
        bir bitki de olabilir. Otomatik hiçbir işlem yapılmıyor.
      * `gorunmeyen`   — karenin içinde kalması gereken ama eşleşen
        lekesi olmayan bitkiler. "Öldü" DEMİYOR: henüz çimlenmemiş de
        olabilir, kare onu kaçırmış da olabilir.

    Yarıçap bitki başına dışarıdan geliyor (`yaricap_mm`), çünkü onu
    hesaplayan zincir (tür → eğri → ezme) sulamada ve burada AYNI
    olmalı; kopyalamak ikisinin ayrışması demek.
    """
    yr = yaricap_mm or {}
    yg = yasa_gore or {}
    kalan = list(bitkiler)
    eslesen: list[dict[str, Any]] = []
    yabani: list[dict[str, Any]] = []

    # Lekeyi büyükten küçüğe geziyoruz: büyük leke büyük bitkiye ait,
    # ve bir bitkiye iki leke eşleşmesin diye eşleşen bitki listeden
    # çıkıyor. Küçükten başlasaydık ufak bir yosun lekesi bitkiyi
    # kapıp asıl kanopiyi yabani aday yapardı.
    for leke in sorted(lekeler, key=lambda b: -_sayi(b.get("alan_mm2"))):
        en_iyi = None
        en_iyi_uzaklik = None
        for bitki in kalan:
            bx, by = _sayi(bitki.get("x")), _sayi(bitki.get("y"))
            d = math.hypot(_sayi(leke.get("x")) - bx, _sayi(leke.get("y")) - by)
            sinir = _eslesme_siniri(_sayi(yr.get(bitki.get("ad")), 0.0),
                                    _sayi(leke.get("cap_mm")) / 2.0,
                                    en_az_yaricap, kat)
            if d <= sinir and (en_iyi_uzaklik is None or d < en_iyi_uzaklik):
                en_iyi, en_iyi_uzaklik = bitki, d
        if en_iyi is None:
            yabani.append(leke)
            continue
        kalan.remove(en_iyi)
        # O YAŞTA beklenen çap. Katalogdaki OLGUN yayılım değil: yarıçap
        # zinciri (tür → eğri → ezme) sulamayla aynı kaynaktan geliyor ve
        # bugünkü değeri veriyor. Yeni ekilmiş bir marulu olgun çapla
        # kıyaslamak her fideyi "geride kalmış" gösterirdi.
        # 0 = yarıçap bilinmiyor; panel o zaman kıyas yazmıyor.
        beklenen = _sayi(yr.get(en_iyi.get("ad")), 0.0) * 2.0
        # BU BAYRAK OLMADAN KIYAS YANILTICI. Bitkiye yayılım eğrisi
        # bağlı değilse zincir katalogdaki OLGUN çapa düşüyor
        # (`sulama.guncel_yaricap_mm`, son satır) — ve dün ekilmiş bir
        # marul olgun çapla kıyaslanınca ister istemez "geride" çıkıyor.
        # Geride olduğu için değil, kıyas yanlış olduğu için. Panel bunu
        # ayırıp farklı yazıyor.
        yasa = bool(yg.get(en_iyi.get("ad")))
        eslesen.append({
            "ad": en_iyi.get("ad"), "tur": en_iyi.get("tur") or "",
            "bitki_x": _sayi(en_iyi.get("x")), "bitki_y": _sayi(en_iyi.get("y")),
            "uzaklik_mm": round(en_iyi_uzaklik, 1),
            "beklenen_cap_mm": round(beklenen, 1),
            "beklenen_yasa_gore": yasa,
            "leke": leke,
            # Kayıtlı konum ile görülen konum arasındaki kayma. Sürekli
            # aynı yönde çıkıyorsa kalibrasyon ofseti şüphelidir.
            "kayma_x": round(_sayi(leke.get("x")) - _sayi(en_iyi.get("x")), 1),
            "kayma_y": round(_sayi(leke.get("y")) - _sayi(en_iyi.get("y")), 1),
        })
    return {"eslesen": eslesen, "yabani_aday": yabani, "gorunmeyen": kalan}


def kare_icinde(bitkiler: list[dict[str, Any]], kare_mm: dict[str, Any] | None,
                pay: float = 0.0) -> list[dict[str, Any]]:
    """Karenin görüş alanına düşen kayıtlı bitkiler.

    `gorunmeyen` listesini anlamlı yapan şey bu: karenin dışındaki bir
    bitkinin görünmemesi haber değil.

    Dönme varsa kutuyu eksen hizalı sınırına genişletiyoruz — biraz
    cömert, ama "kaçırdım" demektense "belki içindeydi" demek doğru
    tarafta hata yapmak.
    """
    if not kare_mm:
        return []
    aci = math.radians(_sayi(kare_mm.get("donme")))
    en, boy = _sayi(kare_mm.get("en")), _sayi(kare_mm.get("boy"))
    yari_en = (abs(en * math.cos(aci)) + abs(boy * math.sin(aci))) / 2.0 + pay
    yari_boy = (abs(en * math.sin(aci)) + abs(boy * math.cos(aci))) / 2.0 + pay
    cx, cy = _sayi(kare_mm.get("x")), _sayi(kare_mm.get("y"))
    return [b for b in bitkiler
            if abs(_sayi(b.get("x")) - cx) <= yari_en
            and abs(_sayi(b.get("y")) - cy) <= yari_boy]


# --------------------------------------------------------------------------- #
# Çimlenme penceresi
# --------------------------------------------------------------------------- #
# Ekilen noktanın çevresinde bakılacak pencere YARIÇAPI.
#
# İki yönlü bir ödünleşme ve sayı ölçümle seçildi:
#
#   BÜYÜK pencere  tohum tam noktaya düşmese de fideyi yakalar, ama
#                  oranı SULANDIRIR — 26 mm'lik bir bitki 40 mm'lik
#                  pencerede %8.9 çıkıyor, fesleğen çeneği (4 mm) ise
#                  binde üçe düşer ve gürültünün altında kalır.
#   KÜÇÜK pencere  oranı yükseltir ama tohum kayarsa fideyi kaçırır.
#
# 20 mm orta yol: 4 mm'lik bir çenek burada ~%1.3 veriyor, ölçülebilir.
# Panelden nokta başına değiştirilebiliyor.
CIMLENME_PENCERE_MM = 20.0


def pencere_px(x_mm: float, y_mm: float, kare: dict[str, Any],
               kalib: dict[str, Any] | None,
               yaricap_mm: float = CIMLENME_PENCERE_MM,
               genislik_px: float | None = None,
               yukseklik_px: float | None = None) -> dict[str, int] | None:
    """Makine koordinatındaki bir noktanın çevresindeki piksel penceresi.

    Çimlenme denetiminin can alıcı noktası: bütün yatağa değil, EKİLEN
    NOKTANIN üstündeki küçük pencereye bakmak. Nerede ektiğinizi
    bildiğiniz için yanlış pozitiflerin çoğu daha bakmadan eleniyor.

    Kare o noktayı içermiyorsa None.
    """
    k = kalib or {}
    if not kalibre_mi(k):
        return None
    haritali = haritali_mi(kare, k)
    if not haritali and kare.get("x") is None:
        return None
    Wf, Hf, sx, sy = _kalib_piksel(k, genislik_px, yukseklik_px)
    W, H = int(Wf), int(Hf)

    if haritali:
        # HARİTANIN TERSİ. Noktanın kendisini ve 'yarıçap kadar sağını'
        # ayrı ayrı çevirip aradaki PİKSEL mesafesini ölçüyoruz: eğik
        # bakan kamerada yarıçap karenin her yerinde aynı piksel sayısı
        # değil, uzak kenarda daha az.
        H_harita = harita(k)
        kayma = _harita_kaydirma(kare, k)
        try:
            u0, v0 = kalibrasyon.harita_geri(H_harita, _sayi(x_mm) - kayma[0],
                                             _sayi(y_mm) - kayma[1])
            u1, v1 = kalibrasyon.harita_geri(H_harita,
                                             _sayi(x_mm) - kayma[0] + yaricap_mm,
                                             _sayi(y_mm) - kayma[1])
        except kalibrasyon.KalibrasyonHatasi:
            return None
        # Kalibrasyon uzayından işlenen karenin uzayına.
        px, py = u0 / (sx or 1.0), v0 / (sy or 1.0)
        r = max(1.0, math.hypot((u1 - u0) / (sx or 1.0), (v1 - v0) / (sy or 1.0)))
    else:
        olcek = mm_px(k) * sx
        if olcek <= 0:
            return None
        # Ters dönüşüm: merkeze göre kaydır, geri döndür, aynala, piksele böl.
        cx, cy = merkez(kare, k)
        dx, dy = _sayi(x_mm) - cx, _sayi(y_mm) - cy
        aci = -math.radians(_sayi(k.get("donme")))
        c, s = math.cos(aci), math.sin(aci)
        yerel_x = dx * c - dy * s
        yerel_y = dx * s + dy * c
        if k.get("ayna_x"):
            yerel_x = -yerel_x
        if k.get("ayna_y"):
            yerel_y = -yerel_y
        px = yerel_x / olcek + W / 2.0
        py = yerel_y / olcek + H / 2.0
        r = max(1.0, yaricap_mm / olcek)
    x1, y1 = int(round(px - r)), int(round(py - r))
    x2, y2 = int(round(px + r)), int(round(py + r))
    # Kırpıp kareye sığdırıyoruz; hiç kesişmiyorsa pencere yok.
    kx1, ky1 = max(0, x1), max(0, y1)
    kx2, ky2 = min(W, x2), min(H, y2)
    if kx2 - kx1 < 2 or ky2 - ky1 < 2:
        return None
    return {"x1": kx1, "y1": ky1, "x2": kx2, "y2": ky2,
            "px": round(px, 1), "py": round(py, 1),
            "yaricap_px": round(r, 1),
            # Pencere kareye taşıyorsa kısmen görülüyor demektir.
            "tam": bool(x1 >= 0 and y1 >= 0 and x2 <= W and y2 <= H)}
