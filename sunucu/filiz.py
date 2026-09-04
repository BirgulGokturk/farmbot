"""Filizleri bulup YATAK KOORDİNATI veriyor — sabit üst kamera için.

Neden ayrı bir dosya
--------------------
`goruntu.py` "karede ne var" sorusunu piksel olarak cevaplıyor,
`tespit.py` ise "o şey yatağın neresinde" sorusunu — ama tespit yolu
sabit kamerada koordinat vermeyi BİLEREK reddediyor:

    "Sabit kamera makineyle hareket etmiyor, o yüzden karenin bir
     makine konumu yok."

Bu doğruydu. Kalibrasyondan önce üst kameranın yatağın neresine baktığı
gerçekten bilinmiyordu. AprilTag kalibrasyonu tam olarak o eksik bilgiyi
veriyor: karenin yatak üzerindeki yeri, dönmesi, ölçeği ve — dört etiket
varsa — perspektifi. Yani gerekçe artık geçerli değil.

Burası o boşluğu dolduruyor: yeşil lekeleri `goruntu.py`den alıyor,
kalibrasyondan geçirip milimetre veriyor.

Hangi model kullanılıyor
------------------------
Varsa **harita** (perspektifli homografi). Yoksa ölçek + dönme.
Hangisinin kullanıldığı çıktıda YAZIYOR: kamera yatağa eğik bakıyor ve
iki model arasında sahada 40 mm fark ölçüldü. Kullanıcı hangi sayıya
baktığını bilmeli.

Kalibrasyon yoksa milimetre YOK. Uydurma bir ölçekten çıkan koordinat,
yanlış olduğu belli olmayan bir sayıdır.

Makineyi buradan HAREKET ETTİRMİYORUZ. Bu modülün işi "fide şurada"
demek; oraya gidip bakmak kullanıcının işi ve panelin zaten yapabildiği
bir şey. Ölçen ile hareket eden aynı düğme olursa, yanlış bir ölçüm
doğrudan yanlış bir harekete dönüşür.
"""

from __future__ import annotations

import base64
import math
from typing import Any

import kalibrasyon

#: Kalibrasyon yoksa dönüşüm yapılmıyor; sebebi bu metinle söyleniyor.
YOK_KALIBRASYON = (
    "Üst kamera kalibre edilmemiş. Kamera sekmesi → 'AprilTag ile kalibre et' "
    "ile en az iki etiketten kalibrasyon kaydedin; koordinat ancak ondan sonra "
    "verilebilir.")


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        return float(deger)
    except (TypeError, ValueError):
        return varsayilan


def cevirici(kalib: dict[str, Any] | None, genislik_px: float, yukseklik_px: float):
    """(piksel -> mm) işlevi ve kullanılan modelin adı. Yoksa (None, sebep).

    DÖNÜŞÜM HESABI BURADA DEĞİL. Hepsi `tespit.piksel_mm` içinde: harita
    varsa harita, yoksa ölçek+dönme, küçültülmüş kare ölçeklemesi dahil.
    İkinci bir hesap yazmak, bir gün sessizce ayrışacak iki hesap demek —
    ve hangisinin doğru olduğunu anlamanın yolu olmaz.

    Sabit kamera: karenin makine konumu diye bir şey yok. Mutlak harita
    varsa gerekmiyor zaten; yoksa boş bir kare sözlüğü veriyoruz ve
    karenin merkezi kalibrasyonun `ofset_x/y`sinde duruyor.
    """
    import tespit

    k = kalib or {}
    # Konum AÇIKÇA yok: harita mutlaksa (sabit kamera) zaten gerekmiyor,
    # mutlak değilse `tespit` haritayı kullanmayı reddedip ölçek+dönme
    # modeline düşüyor — kaymayı tahmin etmektense doğrusu bu.
    bos = {"x": None, "y": None}
    if not tespit.kalibre_mi(k):
        return None, YOK_KALIBRASYON

    def _cevir(u: float, v: float) -> tuple[float, float]:
        return tespit.piksel_mm(u, v, bos, k, genislik_px, yukseklik_px)

    return _cevir, ("harita" if tespit.haritali_mi(bos, k) else "benzerlik")


def cozumle(lekeler_px: list[dict[str, Any]], kalib: dict[str, Any] | None,
            genislik_px: float, yukseklik_px: float) -> dict[str, Any]:
    """Lekelere yatak koordinatı ekliyor. -> {lekeler, yontem, ret}"""
    cevir, ad = cevirici(kalib, genislik_px, yukseklik_px)
    if cevir is None:
        return {"lekeler": [], "yontem": None, "ret": ad}

    cikti = []
    for b in lekeler_px:
        x, y = cevir(b["cx"], b["cy"])
        # ÖLÇÜ DE HARİTADAN GEÇİYOR. Eğik bakan kamerada bir pikselin mm
        # karşılığı karenin bir ucundan öbürüne değişiyor; tek bir
        # mm/px ile çarpmak, uzaktaki fideyi olduğundan küçük gösterir.
        sol, _ = cevir(b["x1"], b["cy"])
        sag, _ = cevir(b["x2"], b["cy"])
        _, ust = cevir(b["cx"], b["y1"])
        _, alt = cevir(b["cx"], b["y2"])
        en, boy = abs(sag - sol), abs(alt - ust)
        cikti.append({
            "no": b["no"],
            "x": round(x, 1), "y": round(y, 1),
            "en_mm": round(en, 1), "boy_mm": round(boy, 1),
            "cap_mm": round(max(en, boy), 1),
            "alan_px": b["alan_px"], "dolgu": b["dolgu"],
            "cx": b["cx"], "cy": b["cy"],
            "kutu": [b["x1"], b["y1"], b["x2"], b["y2"]],
        })
    return {"lekeler": cikti, "yontem": ad, "ret": ""}


#: Bir fidenin olabileceği en büyük çap (mm). Kümelemenin zincirleme
#: büyümesini durduran sınır — bkz. `kume`.
AZAMI_FIDE_MM = 60.0


def kume(lekeler: list[dict[str, Any]], mesafe_mm: float,
         azami_mm: float = AZAMI_FIDE_MM) -> list[dict[str, Any]]:
    """Birbirine yakın lekeleri tek fide sayıyor.

    Bir filizin iki yaprağı ayrı ayrı lekelenebiliyor; araya giren
    toprak bağlantıyı koparıyor. Sayım o zaman iki kat çıkıyor ve
    "kaç fide çıktı" sorusunun cevabı yanlış oluyor.

    Birleştirilen merkez ALANLA AĞIRLIKLANDIRILIYOR: kopan küçük bir
    yaprak parçası, fidenin merkezini kendine doğru çekmemeli.

    ZİNCİRLEME SINIRI — sahada ölçüldü. Yakınlık kuralı tek başına
    zincirleniyor: A ile B 25 mm yakınsa, B ile C 25 mm yakınsa, A ile C
    200 mm uzakta olsa bile üçü tek kümeye giriyor. Kırıntı yoğun
    olduğunda bütün kare tek "fide" oluyordu — 208 leke birleşip 79 mm
    çapında bir küme çıktı ve tablo onu bir fide diye yazdı.

    Sınır fiziksel: bir fide `azami_mm`den büyük olamaz. Bir leke,
    kümeyi bu sınırın ötesine taşıyacaksa alınmıyor; kendi kümesini
    kuruyor. Böylece yoğunluk arttıkça sayı artıyor, tek dev leke
    çıkmıyor.
    """
    kalan = list(lekeler)
    kumeler: list[list[dict[str, Any]]] = []
    while kalan:
        grup = [kalan.pop(0)]
        degisti = True
        while degisti:
            degisti = False
            for b in list(kalan):
                if not any(math.dist((b["x"], b["y"]), (g["x"], g["y"])) <= mesafe_mm
                           for g in grup):
                    continue
                # Kümenin ÇAPI sınırı aşacaksa alma. Yakınlık yetmiyor;
                # sonuçtaki bütün da bir fide büyüklüğünde kalmalı.
                if any(math.dist((b["x"], b["y"]), (g["x"], g["y"])) > azami_mm
                       for g in grup):
                    continue
                grup.append(b)
                kalan.remove(b)
                degisti = True
        kumeler.append(grup)

    cikti = []
    sirali = sorted(kumeler, key=lambda g: -sum(b["alan_px"] for b in g))
    for i, grup in enumerate(sirali, 1):
        toplam = sum(b["alan_px"] for b in grup) or 1
        cikti.append({
            "no": i,
            "x": round(sum(b["x"] * b["alan_px"] for b in grup) / toplam, 1),
            "y": round(sum(b["y"] * b["alan_px"] for b in grup) / toplam, 1),
            "cap_mm": round(max(b["cap_mm"] for b in grup), 1),
            "alan_px": toplam,
            "parca": len(grup),
            "kutu": [min(b["kutu"][0] for b in grup), min(b["kutu"][1] for b in grup),
                     max(b["kutu"][2] for b in grup), max(b["kutu"][3] for b in grup)],
        })
    return cikti


# En küçük leke eşiği burada piksel olarak hesaplanıyordu (kare alanıyla
# ölçekleyerek). Kaldırıldı: ölçekleme eşiğin FİZİKSEL karşılığını her
# çözünürlükte aynı bırakıyordu, yani çözünürlüğü yükseltmek küçük fideyi
# bulmuyordu. Kapı artık `tespit.en_az_piksel` ile milimetre cinsinden
# konuyor — bkz. `_bul`.


def _rgb(jpeg: bytes):
    """JPEG -> float32 RGB dizisi. OpenCV varsa ondan, yoksa Pillow'dan."""
    import numpy as np
    try:
        import cv2
    except ImportError:
        import io
        from PIL import Image
        return np.asarray(Image.open(io.BytesIO(jpeg)).convert("RGB"),
                          dtype=np.float32)
    dizi = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if dizi is None:
        raise ValueError("JPEG çözülemedi — kare bozuk olabilir")
    return dizi[:, :, ::-1].astype(np.float32)


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def yonlendirici_kur(parola_dogrula, canli_kare):
    """`canli_kare(kamera) -> bytes` taze kare veriyor.

    Eşzamanlı da olabilir eşzamansız da: sunucu ajandan TAM çözünürlüklü
    kare isteyen bir eşyordam veriyor (640'ta filiz birkaç piksel kalıp
    eleniyordu), denemeler düz bir işlev veriyor.
    """
    import inspect

    from fastapi import APIRouter, HTTPException, Query

    yon = APIRouter()

    @yon.post("/api/kamera/filiz/bul")
    async def _bul(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        parola_dogrula(jeton)
        g = govde or {}
        kam = kalibrasyon.ad_temizle(g.get("kamera"))

        try:
            jpeg = canli_kare(kam)
            if inspect.isawaitable(jpeg):
                jpeg = await jpeg
        except Exception as hata:                       # noqa: BLE001
            raise HTTPException(status_code=409, detail=str(hata))
        if not jpeg:
            raise HTTPException(
                status_code=409,
                detail=("Taze kare alınamadı. Canlı akış yalnız Kamera sekmesi "
                        "açıkken sürüyor — sekmeyi açık tutun."))

        try:
            import goruntu
        except ImportError as hata:
            raise HTTPException(status_code=503,
                                detail=f"Görüntü hattı yüklenemedi: {hata}")
        try:
            rgb = _rgb(jpeg)
        except ImportError as hata:
            raise HTTPException(status_code=503, detail=f"Görüntü kütüphanesi yok: {hata}")
        except ValueError as hata:
            raise HTTPException(status_code=422, detail=str(hata))

        boy, en = int(rgb.shape[0]), int(rgb.shape[1])
        kalib = kalibrasyon.oku(kam)
        esik = g.get("esik")
        esik = goruntu.ESIK if esik in (None, "") else float(esik)
        birlestir = _sayi(g.get("birlestir_mm"), 25.0)
        azami = _sayi(g.get("azami_fide_mm"), AZAMI_FIDE_MM)
        cap_mm = _sayi(g.get("en_kucuk_cap_mm"), 0.0)

        import tespit
        # EN KÜÇÜK LEKE EŞİĞİ ARTIK MİLİMETREDEN GELİYOR.
        #
        # Piksel eşiğini kare alanıyla ölçekliyordum ve doğru görünüyordu,
        # ama sonucu şuydu: eşiğin FİZİKSEL karşılığı her çözünürlükte
        # aynı kalıyor (13 mm). Yani çözünürlüğü yükseltmek küçük fideyi
        # bulmuyordu — fesleğen kotiledonu 8-10 mm ve kapı 13 mm'de.
        # `tespit.en_az_piksel` kapıyı milimetre olarak koyuyor.
        if int(_sayi(g.get("en_az_piksel"), 0)):
            en_az = int(_sayi(g.get("en_az_piksel"), 0))
        elif cap_mm > 0:
            en_az = tespit.en_az_piksel(kalib, en, boy, cap_mm=cap_mm)
        else:
            en_az = tespit.en_az_piksel(kalib, en, boy)

        # ALAN SÜZGECİ. Yeşil arayan indeks kadrajda ne varsa hepsine
        # bakıyor: kabın mavi kenarı, tezgâh profili, arka plandaki
        # çimen. Hiçbiri dikim alanının içinde değil ve alan koordinatı
        # zaten biliniyor. Renk ölçütü bunların bir kısmını keser; alan
        # denetimi hepsini birden keser, çünkü sorduğu soru başka:
        # "bu şey ne renk" değil, "bu şey toprağın üstünde mi".
        gecerli = tespit.alan_suzgeci(kalib, en, boy)

        # KADRAJ YATAĞA BAKIYOR MU. Alan süzgeci lekeleri eliyorsa iki
        # ayrı sebep olabilir: leke gerçekten toprağın dışında, ya da
        # KADRAJIN KENDİSİ yatağın dışında. İkisi panelde aynı görünüyordu
        # ("hepsi alan dışı") ve ilkini varsayıp fideyi aramak boşuna
        # emek. Örtüşme sıfırsa hangi eşik konursa konsun fide bulunamaz.
        try:
            ortusme = tespit.kadraj_ortusme(kalib, en, boy)
        except Exception:                                   # noqa: BLE001
            ortusme = None

        y = goruntu.bul(rgb, esik=esik, en_az_piksel=en_az, gecerli_mi=gecerli)
        c = cozumle(y["lekeler"], kalib, en, boy)
        fideler = (kume(c["lekeler"], birlestir, azami)
                   if c["lekeler"] and birlestir > 0 else c["lekeler"])
        return {
            "kamera": kam, "genislik_px": en, "yukseklik_px": boy,
            "esik": esik, "en_az_piksel": en_az, "birlestir_mm": birlestir,
            "azami_fide_mm": azami,
            "en_az_kendiliginden": not int(_sayi(g.get("en_az_piksel"), 0)),
            "en_kucuk_cap_mm": cap_mm or tespit.EN_KUCUK_CAP_MM,
            "yesil_oran": round(y["oran"], 4),
            "leke_sayisi": len(y["lekeler"]), "ham_leke": int(y["ham_leke"]),
            # NEDEN BULAMADI sorusu artık tahminle değil sayıyla
            # cevaplanıyor.
            #
            # `elenen` bir SAYI DEĞİL, sözlük: her renk kapısının
            # (mavi, kırmızı, exgr, doygunluk) karenin ne kadarını
            # elediği. Sayıya çevirmeye çalışmak çökertiyordu; olduğu
            # gibi geçiriyoruz ve panel hangi kapının kestiğini yazıyor
            # — "yeşil bulunamadı"nın sebebi tam olarak orada duruyor.
            "elenen": y.get("elenen") or {},
            "alan_disi": int(y.get("alan_disi") or 0),
            "denge_kazanc": y.get("denge_kazanc"),
            "exg_oran": y.get("exg_oran"),
            "maske_oran": y.get("maske_oran"),
            # SONUCUN TEK CÜMLELİK GEREKÇESİ. Panel "eşiği düşürün"
            # diye sabit bir öğüt veriyordu; kare bembeyaz yanmışsa o
            # öğüt yanlış ve kullanıcıyı boşuna uğraştırıyor. `tani`
            # önce karenin ölçülebilir olup olmadığına bakıyor.
            "tani": y.get("tani") or "",
            "kadraj_oran": (None if not ortusme
                            else round(float(ortusme.get("oran") or 0), 4)),
            "kadraj_alan_var": bool(ortusme and ortusme.get("alan_var")),
            "kare_kalite": y.get("kare") or {},
            "yontem": c["yontem"], "ret": c["ret"],
            "lekeler": c["lekeler"], "fideler": fideler,
            "kare": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(),
        }

    return yon
