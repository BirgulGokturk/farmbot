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

    Kare, kalibrasyon anındakinden farklı çözünürlükte gelebiliyor
    (küçültülmüş kare, farklı kamera kipi). Piksel önce KALİBRASYON
    uzayına ölçekleniyor — harita o uzayda tanımlı ve iki katı bir
    uzaydan gelen sayı bütün koordinatları ikiye katlardı.
    """
    k = kalib or {}
    kw = _sayi(k.get("genislik_px"), 0.0) or genislik_px
    kh = _sayi(k.get("yukseklik_px"), 0.0) or yukseklik_px
    sx = kw / genislik_px if genislik_px else 1.0
    sy = kh / yukseklik_px if yukseklik_px else 1.0

    harita = k.get("harita")
    if harita:
        try:
            kalibrasyon.harita_uygula(harita, kw / 2.0, kh / 2.0)
        except kalibrasyon.KalibrasyonHatasi as hata:
            return None, f"Harita kullanılamadı: {hata}"

        def _harita(u: float, v: float) -> tuple[float, float]:
            return kalibrasyon.harita_uygula(harita, u * sx, v * sy)

        return _harita, "harita"

    if _sayi(k.get("mm_px")) <= 0:
        return None, YOK_KALIBRASYON

    import tespit
    # Sabit kamera: karenin makine konumu diye bir şey yok, karenin
    # MERKEZİ kalibrasyonun `ofset_x/y`sinde duruyor. Boş bir kare
    # sözlüğü vererek `tespit` zincirini olduğu gibi kullanıyoruz —
    # ikinci bir dönüşüm hesabı yazmak, bir gün ayrışacak iki hesap
    # demekti.
    bos = {"x": 0.0, "y": 0.0}

    def _benzerlik(u: float, v: float) -> tuple[float, float]:
        return tespit.piksel_mm(u, v, bos, k, genislik_px, yukseklik_px)

    return _benzerlik, "benzerlik"


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


def kume(lekeler: list[dict[str, Any]], mesafe_mm: float) -> list[dict[str, Any]]:
    """Birbirine yakın lekeleri tek fide sayıyor.

    Bir filizin iki yaprağı ayrı ayrı lekelenebiliyor; araya giren
    toprak bağlantıyı koparıyor. Sayım o zaman iki kat çıkıyor ve
    "kaç fide çıktı" sorusunun cevabı yanlış oluyor.

    Birleştirilen merkez ALANLA AĞIRLIKLANDIRILIYOR: kopan küçük bir
    yaprak parçası, fidenin merkezini kendine doğru çekmemeli.
    """
    kalan = list(lekeler)
    kumeler: list[list[dict[str, Any]]] = []
    while kalan:
        grup = [kalan.pop(0)]
        degisti = True
        while degisti:
            degisti = False
            for b in list(kalan):
                if any(math.dist((b["x"], b["y"]), (g["x"], g["y"])) <= mesafe_mm
                       for g in grup):
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


#: `goruntu.EN_AZ_PIKSEL` hangi kare ölçüsüne göre seçilmişti.
OLCU_KARE = 640 * 480


def en_az_varsayilan(genislik_px: float, yukseklik_px: float, taban: int) -> int:
    """En küçük leke eşiğini kare ALANIYLA ölçekliyor.

    Eşik mutlak piksel sayısı olarak duruyordu ve bu, çözünürlük
    değişince sessizce başka bir şey demeye başlıyor: 640x480'de 150
    piksel yatağın binde 0.5'i, 1920x1440'ta binde 0.05'i. Aynı fide bir
    çözünürlükte eleniyor, ötekinde geçiyordu — kullanıcı da neden
    değiştiğini göremiyordu.

    Ölçekleyince eşik FİZİKSEL bir büyüklüğe karşılık geliyor: "yatağın
    şu kadarından küçük şeyler gürültüdür".
    """
    alan = max(1.0, float(genislik_px) * float(yukseklik_px))
    return max(20, int(round(taban * alan / OLCU_KARE)))


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
    """`canli_kare(kamera) -> bytes` taze kare veriyor."""
    from fastapi import APIRouter, HTTPException, Query

    yon = APIRouter()

    @yon.post("/api/kamera/filiz/bul")
    async def _bul(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        parola_dogrula(jeton)
        g = govde or {}
        kam = kalibrasyon.ad_temizle(g.get("kamera"))

        try:
            jpeg = canli_kare(kam)
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
        esik = g.get("esik")
        esik = goruntu.ESIK if esik in (None, "") else float(esik)
        # Kullanıcı bir sayı verdiyse aynen o; vermediyse kare ölçüsüne
        # göre ölçeklenmiş varsayılan.
        en_az = (int(_sayi(g.get("en_az_piksel"), 0))
                 or en_az_varsayilan(en, boy, goruntu.EN_AZ_PIKSEL))
        birlestir = _sayi(g.get("birlestir_mm"), 25.0)

        y = goruntu.bul(rgb, esik=esik, en_az_piksel=en_az)
        c = cozumle(y["lekeler"], kalibrasyon.oku(kam), en, boy)
        fideler = (kume(c["lekeler"], birlestir)
                   if c["lekeler"] and birlestir > 0 else c["lekeler"])
        return {
            "kamera": kam, "genislik_px": en, "yukseklik_px": boy,
            "esik": esik, "en_az_piksel": en_az, "birlestir_mm": birlestir,
            "en_az_kendiliginden": not int(_sayi(g.get("en_az_piksel"), 0)),
            "yesil_oran": round(y["oran"], 4),
            "leke_sayisi": len(y["lekeler"]), "ham_leke": int(y["ham_leke"]),
            "yontem": c["yontem"], "ret": c["ret"],
            "lekeler": c["lekeler"], "fideler": fideler,
            "kare": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(),
        }

    return yon
