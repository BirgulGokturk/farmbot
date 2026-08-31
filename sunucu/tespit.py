"""Piksel → makine koordinatı, ve tespitlerin kayıtlı bitkilerle eşlenmesi.

`goruntu.py` "karede ne var" sorusunu piksel olarak cevaplıyor. Burası
"o şey yatağın neresinde" sorusunu milimetre olarak cevaplıyor. İkisi
bilerek ayrı: kalibrasyon değişince segmentasyon etkilenmemeli.

--------------------------------------------------------------------
Dönüşüm — haritadaki kare katmanıyla AYNI matematik
--------------------------------------------------------------------

`static/katmanlar/70-kamera-kareleri.js` fotoğrafı haritaya şöyle
oturtuyor ve burası onu birebir tekrarlıyor:

    merkez  = kare konumu + (ofset_x, ofset_y)
    ölçü    = (genislik_px, yukseklik_px) x mm_px
    görüntü merkeze konur, `ayna_x/ayna_y` ile aynalanır,
    `donme` derece döndürülür

Bir pikselin makine koordinatı da bu zincirin aynısı:

    yerel   = (px - W/2, py - H/2) x mm_px
    aynala  → döndür → merkeze taşı

İKİ AYRI HESAP OLMAMALI. Panelde çizilen kare ile sunucunun "bu leke
şurada" dediği yer ayrışırsa, hangisinin doğru olduğunu anlamanın yolu
yok. Bir gün biri değişirse diğeri de değişmeli — bu yüzden formül
burada, o dosyaya atıfla yazılı.

--------------------------------------------------------------------
Sessizce yapılmayanlar
--------------------------------------------------------------------

* **Kalibrasyon yoksa dönüşüm YOK.** `mm_px = 0` "daha ölçülmedi"
  demek. Uydurma bir ölçekle üretilmiş milimetre, yanlış olduğu
  belli olmayan bir sayıdır — en kötü tür.
* **Karenin konumu yoksa dönüşüm YOK.** PLC kopukken çekilen kare
  saklanıyor ama nerede çekildiği bilinmiyor.
* **Makine hareket hâlindeyken çekilen kare kullanılmaz.** Hem
  bulanık hem de konumu belirsiz.
"""

from __future__ import annotations

import math
from typing import Any

# Kalibrasyon yokken bu sebeplerden biri dönüyor; panel bunları yazıyor.
YOK_KALIBRASYON = ("Kamera kalibre edilmemiş (mm_px = 0). Ayarlar → Kamera "
                   "kalibrasyonu bölümünden iki kare yöntemiyle ölçün — "
                   "onsuz pikseli milimetreye çeviremeyiz.")
YOK_KONUM = ("Karenin makine konumu yok (PLC kopukken çekilmiş). Nerede "
             "çekildiği bilinmeyen bir kare haritaya konamaz.")
HAREKETLI = ("Kare makine hareket hâlindeyken çekilmiş — hem bulanık hem de "
             "konumu belirsiz.")


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
        return s if math.isfinite(s) else varsayilan
    except (TypeError, ValueError):
        return varsayilan


def mm_px(kalib: dict[str, Any] | None) -> float:
    """Bir piksel kaç mm. 0 = kalibre edilmemiş."""
    return max(0.0, _sayi((kalib or {}).get("mm_px"), 0.0))


def kalibre_mi(kalib: dict[str, Any] | None) -> bool:
    return mm_px(kalib) > 0.0


def kare_olcusu(kalib: dict[str, Any] | None) -> tuple[float, float]:
    """Karenin mm cinsinden (en, boy) ölçüsü."""
    k = kalib or {}
    m = mm_px(k)
    return (_sayi(k.get("genislik_px"), 640.0) * m,
            _sayi(k.get("yukseklik_px"), 480.0) * m)


def merkez(kare: dict[str, Any], kalib: dict[str, Any] | None) -> tuple[float, float]:
    """Karenin makine koordinatındaki merkezi.

    Kamera ucun ekseninden kaymış olabiliyor; `ofset_x/y` o kayma.
    """
    k = kalib or {}
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
    """
    k = kalib or {}
    olcek = mm_px(k)
    W = _sayi(genislik_px, 0.0) or _sayi(k.get("genislik_px"), 640.0)
    H = _sayi(yukseklik_px, 0.0) or _sayi(k.get("yukseklik_px"), 480.0)
    # Küçültülmüş kare: aynı görüş alanı daha az piksele düştüğü için
    # bir pikselin mm karşılığı büyüyor.
    olcek_x = olcek * (_sayi(k.get("genislik_px"), 640.0) / W)
    olcek_y = olcek * (_sayi(k.get("yukseklik_px"), 480.0) / H)

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
    olcek = mm_px(k)
    W = _sayi(genislik_px, 0.0) or _sayi(k.get("genislik_px"), 640.0)
    olcek_x = olcek * (_sayi(k.get("genislik_px"), 640.0) / W)

    cx, cy = piksel_mm(leke["cx"], leke["cy"], kare, k, genislik_px, yukseklik_px)
    # Dört köşe: dönme varsa kutu haritada eğik duruyor.
    koseler = [piksel_mm(x, y, kare, k, genislik_px, yukseklik_px)
               for x, y in ((leke["x1"], leke["y1"]), (leke["x2"], leke["y1"]),
                            (leke["x2"], leke["y2"]), (leke["x1"], leke["y2"]))]
    xs = [p[0] for p in koseler]
    ys = [p[1] for p in koseler]
    return {
        "no": leke.get("no"),
        "x": round(cx, 1), "y": round(cy, 1),
        "x1": round(min(xs), 1), "y1": round(min(ys), 1),
        "x2": round(max(xs), 1), "y2": round(max(ys), 1),
        "en_mm": round(_sayi(leke.get("en_px")) * olcek_x, 1),
        "boy_mm": round(_sayi(leke.get("boy_px")) * olcek_x, 1),
        # Alan mm²: piksel alanı x (mm/piksel)². Yaprağın gerçek yüzeyi
        # değil, üstten görünen izdüşümü — büyüme takibi için yeterli.
        "alan_mm2": round(_sayi(leke.get("alan_px")) * olcek_x * olcek_x, 1),
        "alan_px": leke.get("alan_px"),
        "dolgu": leke.get("dolgu"),
        # Dairesel eşdeğer çap: alanı aynı olan dairenin çapı. Yayılım
        # ölçüsü olarak kutu genişliğinden sağlam — tek bir uzun yaprak
        # kutuyu şişiriyor ama alanı şişirmiyor.
        "cap_mm": round(2.0 * math.sqrt(max(_sayi(leke.get("alan_px")), 0.0) / math.pi)
                        * olcek_x, 1),
    }


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
    if kare.get("x") is None or kare.get("y") is None:
        ret.append(YOK_KONUM)
    if hareket:
        ret.append(HAREKETLI)
    if ret:
        return {"lekeler": [], "ret": ret, "kare_mm": None}

    en, boy = kare_olcusu(kalib)
    cx, cy = merkez(kare, kalib)
    return {
        "lekeler": [leke_mm(b, kare, kalib, genislik_px, yukseklik_px)
                    for b in lekeler_px],
        "ret": [],
        "kare_mm": {"x": round(cx, 1), "y": round(cy, 1),
                    "en": round(en, 1), "boy": round(boy, 1),
                    "donme": _sayi((kalib or {}).get("donme")),
                    "mm_px": round(mm_px(kalib), 4)},
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
    if not kalibre_mi(kalib) or kare.get("x") is None:
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
        eslesen.append({
            "ad": en_iyi.get("ad"), "tur": en_iyi.get("tur") or "",
            "bitki_x": _sayi(en_iyi.get("x")), "bitki_y": _sayi(en_iyi.get("y")),
            "uzaklik_mm": round(en_iyi_uzaklik, 1),
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
    if not kalibre_mi(kalib) or kare.get("x") is None:
        return None
    k = kalib or {}
    W = int(_sayi(genislik_px, 0.0) or _sayi(k.get("genislik_px"), 640.0))
    H = int(_sayi(yukseklik_px, 0.0) or _sayi(k.get("yukseklik_px"), 480.0))
    olcek = mm_px(k) * (_sayi(k.get("genislik_px"), 640.0) / W)
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
