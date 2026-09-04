"""Fide tanıma — yeşil lekeyi kırpıp türünü söyleyen hat, ve veri toplama.

`goruntu.py` "karede yeşil nerede" sorusunu cevaplıyor, `tespit.py` "o şey
yatağın neresinde" sorusunu. Burası üçüncü soruyu cevaplıyor: **o şey ne**.

--------------------------------------------------------------------
Sıra: önce hat, sonra model
--------------------------------------------------------------------

Model olmadan da bu hat uçtan uca çalışabilir (`sahte` sınıflandırıcı) ve
doğrulanabilir; tersi mümkün değil. O yüzden hat önce kuruldu. Model
yoksa hiçbir şey kırılmıyor: her leke "bilinmiyor" dönüyor ve sebebi
yazıyor.

**UYDURMA TÜR ADI YAZMIYORUZ.** Model yoksa, `onnxruntime` kurulu
değilse ya da güven eşiğin altındaysa sınıf `None` kalıyor. Yanlış bir
tür etiketi etiketsizlikten kötü: "bu marul" diyen bir sayı, sulama ve
hasat kararlarına girip sessizce yanlış iş yaptırır.

Sahte sınıflandırıcı çıktısında `sahte: true` taşıyor. Gerçek bir
tahminle karıştırılmaması için bayrak şart — panelde de o bayrağa
bakılmalı.

--------------------------------------------------------------------
Model ve etiketler
--------------------------------------------------------------------

    <veri>/model/fide.onnx        ONNX modeli
    <veri>/model/siniflar.json    {"siniflar": [...], "girdi": 224,
                                   "ortalama": [...], "sapma": [...]}

Sınıf adları MODELİN YANINDAN geliyor, koda gömülü değil. Sebep: bugün
model Plant Seedlings'in 12 sınıfıyla eğitiliyor (Aarhus veri seti),
yarın kendi topladığımız veriyle bizim tür adlarımıza göre yeniden
eğitilecek. İki farklı sözlük ve hangisinin geçerli olduğunu modelin
kendisi söylemeli.

Ön işleme sayıları da (girdi boyu, ortalama, sapma) o dosyadan
okunuyor; eğitim betiği neyle eğittiyse onu yazsın. Dosya yoksa
ImageNet varsayılanları kullanılıyor — MobileNetV3 aktarımlı öğrenmede
olağan olan bu.

Hailo derlemesi BİLEREK yok. Birkaç leke için MobileNet CPU'da yeterince
hızlı ve Hailo derleyicisi ayrı bir iş; `onnxruntime` ile başlıyoruz.

--------------------------------------------------------------------
Veri toplama — konumdan gelen bedava etiket
--------------------------------------------------------------------

Elimizde başkasında olmayan bir şey var: nereye ne ektiğimizi sistem
biliyor. Kalibrasyon oturunca her lekeye "bu, X noktasındaki şu tür"
etiketi kendiliğinden yapışıyor (`tespit.eslestir`). Çözümleme sırasında
o eşleşmeyi kullanıp kırpılmış görüntüyü türünün klasörüne yazıyoruz;
eşleşmeyen lekeler `bilinmiyor/` klasörüne gidiyor — onlar da yabani ot
adayı ve etiketlenmeye değer.

Düzen, ImageFolder düzeni (torchvision'ın beklediği ve bu tür eğitim
betiklerinin okuduğu biçim):

    <veri>/fide_veri/<tur>/<kamera>_<damga>_<leke>.jpg
    <veri>/fide_veri/kunye.jsonl        her kırpma için bir satır

`kunye.jsonl` izlenebilirlik için: hangi kare, hangi leke, yatağın
neresi, ne kadar büyük. Etiketin yanlış olduğu sonradan anlaşılırsa
hangi kayıtların atılacağı ancak bununla bulunuyor.

DOLUNCA SİLMİYOR, DURUYOR. Üst sınıra gelince yazmayı kesiyor ve bunu
söylüyor. Eski kayıtları silmek geri alınamaz; durmak alınabilir.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from typing import Any

# --------------------------------------------------------------------------- #
# Ayarlar
# --------------------------------------------------------------------------- #
#: Güven bunun altındaysa sınıf yazılmıyor. 0.60 keyfî değil: 12 sınıflı
#: bir modelde rastgele tahmin 0.083; 0.60 "model gerçekten bir şeye
#: karar verdi" demek için makul bir alt sınır. Çağıran değiştirebiliyor.
EN_AZ_GUVEN = 0.60

#: Kırpma kutusunun çevresine bırakılan pay (kutunun uzun kenarının
#: katı). Yaprağın hemen dışındaki toprak bağlam veriyor; kutuyu tam
#: sınırdan kesmek modeli yalnız yeşil dokuya bakmaya zorluyor.
PAY_ORANI = 0.25

#: Girdi boyu ve normalleştirme — `siniflar.json` yoksa bunlar geçerli.
#: ImageNet değerleri: MobileNetV3 aktarımlı öğrenmede olağan olan bu ve
#: eğitim betiği başka bir şey kullanıyorsa dosyaya yazmalı.
VARSAYILAN_GIRDI = 224
IMAGENET_ORTALAMA = (0.485, 0.456, 0.406)
IMAGENET_SAPMA = (0.229, 0.224, 0.225)

#: Toplanan veri kümesinin üst sınırı. 512 MB, 224x224 JPEG'de kabaca
#: 30-40 bin kırpma: ince ayar için fazlasıyla yeterli ve Pi'nin SD
#: kartını doldurmuyor.
AZAMI_BAYT = 512 * 1024 * 1024

#: Klasör adı olarak kabul edilen tür adı biçimi.
_AD_BICIMI = re.compile(r"[^a-z0-9_-]+")

#: Eşleşmeyen lekelerin klasörü. Yabani ot adayı; etiketlenmeye değer.
BILINMIYOR = "bilinmiyor"

_KILIT = threading.RLock()


def _veri_koku() -> str:
    """Veri klasörü — `kareler.py`/`kalibrasyon.py` ile aynı gerekçe."""
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.dirname(veri) or "."
    return os.path.dirname(os.path.abspath(__file__))


def model_yolu() -> str:
    return os.environ.get("TANIMA_MODEL") or os.path.join(
        _veri_koku(), "model", "fide.onnx")


def siniflar_yolu() -> str:
    return os.environ.get("TANIMA_SINIFLAR") or os.path.join(
        _veri_koku(), "model", "siniflar.json")


def veri_koku() -> str:
    return os.environ.get("FIDE_VERI_YOLU") or os.path.join(
        _veri_koku(), "fide_veri")


def tur_klasoru(tur: Any) -> str:
    """Tür adını klasör adına çeviriyor. Boş/bilinmeyen -> `bilinmiyor`."""
    ad = _AD_BICIMI.sub("-", str(tur or "").strip().lower()).strip("-")
    return ad[:40] or BILINMIYOR


# --------------------------------------------------------------------------- #
# 1. Kırpma — hem sınıflandırma hem veri toplama aynı kırpmayı kullanıyor
# --------------------------------------------------------------------------- #
def kirp(rgb: Any, leke: dict[str, Any], boy: int = VARSAYILAN_GIRDI,
         pay_orani: float = PAY_ORANI) -> Any:
    """Lekenin kutusundan KARE bir kırpma çıkarıp `boy`a ölçekliyor.

    KARE YAPMANIN SEBEBİ: model kare girdi bekliyor ve dikdörtgen bir
    kırpmayı zorla kareye esnetmek yaprağın en-boy oranını bozuyor —
    ince uzun bir kotiledon yuvarlak görünür hâle geliyor. Kutunun
    merkezinden kare alıp kadrajın dışına taşan kısmı kırpıyoruz.

    Çıktı (boy, boy, 3) float32, 0-255 aralığında.
    """
    import numpy as np

    x = np.asarray(rgb, dtype=np.float32)
    h, w = x.shape[0], x.shape[1]
    x1 = float(leke.get("x1", 0)); y1 = float(leke.get("y1", 0))
    x2 = float(leke.get("x2", 0)); y2 = float(leke.get("y2", 0))
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    kenar = max(x2 - x1 + 1.0, y2 - y1 + 1.0) * (1.0 + 2.0 * pay_orani)
    kenar = max(8.0, min(kenar, float(min(h, w))))
    yarim = kenar / 2.0
    # Merkezi kadraja çekiyoruz: kenardaki bir leke için kutu dışarı
    # taşıyor ve dışarısı siyahla doldurulsaydı model o siyahı öğrenirdi.
    cx = min(max(cx, yarim), w - yarim)
    cy = min(max(cy, yarim), h - yarim)
    a = int(round(cx - yarim)); b = int(round(cx + yarim))
    c = int(round(cy - yarim)); d = int(round(cy + yarim))
    parca = x[max(0, c):max(1, d), max(0, a):max(1, b), :3]
    if parca.size == 0:
        parca = x[:1, :1, :3]
    return _olcekle(parca, int(boy))


def _olcekle(parca: Any, boy: int) -> Any:
    """(h, w, 3) -> (boy, boy, 3). OpenCV varsa ondan, yoksa Pillow'dan.

    `filiz._rgb` ile aynı gerekçe: ikisi de isteğe bağlı ve hangisi
    varsa o kullanılıyor.
    """
    import numpy as np

    try:
        import cv2
        return cv2.resize(np.ascontiguousarray(parca), (boy, boy),
                          interpolation=cv2.INTER_AREA).astype(np.float32)
    except ImportError:
        from PIL import Image
        im = Image.fromarray(np.clip(parca, 0, 255).astype("uint8"))
        return np.asarray(im.resize((boy, boy), Image.BILINEAR),
                          dtype=np.float32)


# --------------------------------------------------------------------------- #
# 2. Model — tembel yükleniyor, yoksa hat çalışmaya devam ediyor
# --------------------------------------------------------------------------- #
class _Model:
    """Yüklenmiş ONNX oturumu ve künyesi. Tek örnek, süreç ömrü boyunca."""

    def __init__(self) -> None:
        self.oturum = None
        self.siniflar: list[str] = []
        self.girdi = VARSAYILAN_GIRDI
        self.ortalama = IMAGENET_ORTALAMA
        self.sapma = IMAGENET_SAPMA
        self.girdi_adi = ""
        self.sebep = "henüz yüklenmedi"
        self.damga = 0.0          # yüklenen dosyanın mtime'ı


_MODEL: _Model | None = None


def _kunye_oku(m: _Model) -> None:
    """`siniflar.json` — sınıf adları ve ön işleme sayıları."""
    yol = siniflar_yolu()
    try:
        with open(yol, encoding="utf-8") as dosya:
            veri = json.load(dosya)
    except (OSError, json.JSONDecodeError):
        return
    if isinstance(veri, list):
        veri = {"siniflar": veri}
    if not isinstance(veri, dict):
        return
    siniflar = veri.get("siniflar") or veri.get("classes") or []
    m.siniflar = [str(s) for s in siniflar]
    try:
        m.girdi = int(veri.get("girdi") or veri.get("input") or m.girdi)
    except (TypeError, ValueError):
        pass
    ort = veri.get("ortalama") or veri.get("mean")
    sap = veri.get("sapma") or veri.get("std")
    if isinstance(ort, (list, tuple)) and len(ort) == 3:
        m.ortalama = tuple(float(v) for v in ort)
    if isinstance(sap, (list, tuple)) and len(sap) == 3:
        m.sapma = tuple(float(v) for v in sap)


def _yukle() -> _Model:
    """Modeli bir kez yükleyip saklıyor; dosya değişirse yeniden yüklüyor.

    Yeniden yükleme ölçüte bağlı (dosyanın mtime'ı), sürekli değil:
    her çözümlemede ONNX oturumu açmak Pi'de saniyeler alır.
    """
    global _MODEL
    with _KILIT:
        yol = model_yolu()
        try:
            damga = os.path.getmtime(yol)
        except OSError:
            damga = 0.0
        if _MODEL is not None and _MODEL.damga == damga:
            return _MODEL

        m = _Model()
        m.damga = damga
        if not damga:
            m.sebep = (f"Model dosyası yok ({yol}). Eğitilmiş modeli oraya "
                       "koyun; o zamana kadar her leke 'bilinmiyor'.")
            _MODEL = m
            return m
        try:
            import onnxruntime
        except ImportError:
            m.sebep = ("onnxruntime kurulu değil — tanıma kapalı. Pi'de: "
                       "pip install onnxruntime")
            _MODEL = m
            return m
        _kunye_oku(m)
        try:
            # Tek iş parçacığı: sunucu zaten eşzamanlı istek görüyor ve
            # ONNX'in kendi havuzu Pi'de öteki işleri aç bırakıyor.
            se = onnxruntime.SessionOptions()
            se.intra_op_num_threads = 1
            m.oturum = onnxruntime.InferenceSession(
                yol, sess_options=se, providers=["CPUExecutionProvider"])
            m.girdi_adi = m.oturum.get_inputs()[0].name
            m.sebep = ""
        except Exception as hata:                          # noqa: BLE001
            m.oturum = None
            m.sebep = f"Model yüklenemedi: {hata}"
        if m.oturum is not None and not m.siniflar:
            m.sebep = (f"Sınıf adları yok ({siniflar_yolu()}). Model çalışıyor "
                       "ama çıktının hangi türe karşılık geldiği bilinmiyor; "
                       "sınıf yazılmıyor.")
        _MODEL = m
        return m


def hazir_mi() -> dict[str, Any]:
    """Tanıma çalışabilir mi ve çalışamıyorsa NEDEN. Panel bunu yazıyor."""
    m = _yukle()
    calisir = m.oturum is not None and bool(m.siniflar)
    return {"hazir": calisir, "sebep": m.sebep,
            "model": model_yolu(), "sinif_sayisi": len(m.siniflar),
            "siniflar": list(m.siniflar), "girdi": m.girdi}


def _yumusak_azami(dizi: Any) -> Any:
    """Softmax — ama çıktı ZATEN olasılıksa dokunmuyor.

    Model son katmanda softmax taşıyabiliyor da taşımayabiliyor da. İki
    kez softmax uygulamak dağılımı düzleştirip güveni sahte biçimde
    düşürür. Tahmin etmek yerine ÖLÇÜYORUZ: bütün değerler [0,1]
    aralığında ve toplamları 1'e yakınsa çıktı olasılıktır.
    """
    import numpy as np

    x = np.asarray(dizi, dtype=np.float64).ravel()
    if x.size and float(x.min()) >= 0.0 and float(x.max()) <= 1.0 \
            and abs(float(x.sum()) - 1.0) < 1e-3:
        return x
    x = x - x.max()
    us = np.exp(x)
    return us / max(float(us.sum()), 1e-12)


def _sahte_tahmin(parca: Any, siniflar: list[str]) -> tuple[int, float]:
    """Modelsiz uçtan uca deneme için — GERÇEK BİR TAHMİN DEĞİL.

    Kırpmanın ortalama renginden belirlenimci bir sınıf üretiyor: aynı
    görüntü hep aynı sonucu veriyor, yani hattın çalıştığı tekrar
    edilebilir biçimde görülebiliyor. Çıktı `sahte: true` taşıyor;
    bayrağı olmayan hiçbir yerde gerçek tahminle karıştırılmamalı.
    """
    import numpy as np

    ort = np.asarray(parca, dtype=np.float64).reshape(-1, 3).mean(axis=0)
    tohum = int(abs(ort[0] * 7 + ort[1] * 13 + ort[2] * 3)) % max(1, len(siniflar))
    # Güven de renkten türüyor ama eşiğin üstünde kalıyor: hattın
    # "bilinmiyor" dalını değil, sınıf yazan dalını denemek için.
    guven = 0.62 + (float(ort[1]) % 30.0) / 100.0
    return tohum, min(0.97, guven)


def siniflandir(rgb: Any, lekeler: list[dict[str, Any]], *,
                en_az_guven: float = EN_AZ_GUVEN,
                sahte: bool = False) -> dict[str, Any]:
    """Her lekeyi kırpıp sınıflandırıyor. -> {sonuc: {leke_no: {...}}, ...}

    Her kayıt: `sinif` (None = bilinmiyor), `guven`, `sahte`.
    `sinif` yalnız güven eşiği geçtiğinde doluyor — eşiğin altındaki bir
    tahmini yazmak, olmayan bir bilgiyi varmış gibi göstermek olurdu.
    """
    if not lekeler:
        return {"sonuc": {}, "hazir": False, "sebep": "leke yok",
                "sahte": bool(sahte), "sure_ms": 0}

    basladi = time.monotonic()
    m = _yukle()
    siniflar = m.siniflar
    if sahte:
        # Sahte kipte de sınıf adı gerekiyor; model künyesi yoksa
        # yer tutucu adlar kullanılıyor ve `sahte` bayrağı zaten var.
        siniflar = siniflar or [f"sinif-{i}" for i in range(1, 5)]
    elif m.oturum is None or not siniflar:
        return {"sonuc": {b.get("no"): {"sinif": None, "guven": 0.0,
                                        "sahte": False} for b in lekeler},
                "hazir": False, "sebep": m.sebep, "sahte": False, "sure_ms": 0}

    import numpy as np

    sonuc: dict[Any, dict[str, Any]] = {}
    for b in lekeler:
        parca = kirp(rgb, b, m.girdi)
        if sahte:
            indeks, guven = _sahte_tahmin(parca, siniflar)
        else:
            girdi = ((parca / 255.0 - np.asarray(m.ortalama, np.float32))
                     / np.asarray(m.sapma, np.float32))
            girdi = np.ascontiguousarray(
                girdi.transpose(2, 0, 1)[None], dtype=np.float32)
            try:
                cikti = m.oturum.run(None, {m.girdi_adi: girdi})[0]
            except Exception as hata:                      # noqa: BLE001
                sonuc[b.get("no")] = {"sinif": None, "guven": 0.0,
                                      "sahte": False, "hata": str(hata)}
                continue
            olasilik = _yumusak_azami(cikti)
            indeks = int(np.argmax(olasilik))
            guven = float(olasilik[indeks])
        yeter = guven >= float(en_az_guven)
        sonuc[b.get("no")] = {
            # EŞİĞİN ALTINDA SINIF YOK. Adı yine de veriyoruz ama ayrı
            # bir alanda: "model şunu düşündü ama yeterince emin değil"
            # ile "model şu dedi" birbirinden ayrı iki şey.
            "sinif": (siniflar[indeks] if yeter and indeks < len(siniflar)
                      else None),
            "aday": (siniflar[indeks] if indeks < len(siniflar) else None),
            "guven": round(guven, 3),
            "sahte": bool(sahte),
        }
    return {"sonuc": sonuc, "hazir": True,
            "sebep": "" if not sahte else "sahte sınıflandırıcı — gerçek tahmin değil",
            "sahte": bool(sahte), "siniflar": list(siniflar),
            "en_az_guven": float(en_az_guven),
            "sure_ms": int((time.monotonic() - basladi) * 1000)}


# --------------------------------------------------------------------------- #
# 3. Veri toplama — konumdan gelen bedava etiket
# --------------------------------------------------------------------------- #
def _klasor_boyutu(kok: str) -> int:
    toplam = 0
    for dizin, _, dosyalar in os.walk(kok):
        for ad in dosyalar:
            try:
                toplam += os.path.getsize(os.path.join(dizin, ad))
            except OSError:
                pass
    return toplam


def _yaz_jpeg(yol: str, parca: Any, kalite: int = 88) -> int:
    import numpy as np
    from PIL import Image

    im = Image.fromarray(np.clip(parca, 0, 255).astype("uint8"))
    im.save(yol, format="JPEG", quality=kalite)
    try:
        return os.path.getsize(yol)
    except OSError:
        return 0


def topla(rgb: Any, lekeler: list[dict[str, Any]],
          eslesen: list[dict[str, Any]] | None = None, *,
          damga: str = "", kamera: str = "", kok: str | None = None,
          boy: int = VARSAYILAN_GIRDI,
          azami_bayt: int = AZAMI_BAYT) -> dict[str, Any]:
    """Lekeleri kırpıp türünün klasörüne yazıyor. -> özet sözlüğü

    Etiket `eslesen`den geliyor: `tespit.eslestir` lekeyi kayıtlı bir
    bitkiyle eşlediyse o bitkinin türü, eşlemediyse `bilinmiyor`.
    Eşleşmeyenleri de yazıyoruz — yabani ot adayı ve etiketlenmeye değer.

    DOLUNCA DURUYOR, SİLMİYOR. Üst sınıra gelince yazmayı kesip
    `doldu: true` dönüyor; eski kayıtları atmak geri alınamaz bir iş ve
    kararı kullanıcının.
    """
    if not lekeler:
        return {"yazilan": 0, "atlanan": 0, "doldu": False, "kok": kok or veri_koku()}

    kok = kok or veri_koku()
    # Leke numarası -> tür. `eslesen` içindeki `leke` sözlüğü milimetre
    # lekesi ama `no` alanı piksel lekesiyle AYNI — eşleşme oradan.
    etiket: dict[Any, str] = {}
    for e in (eslesen or []):
        no = (e.get("leke") or {}).get("no")
        if no is not None:
            etiket[no] = tur_klasoru(e.get("tur"))

    yazilan = atlanan = 0
    doldu = False
    with _KILIT:
        try:
            os.makedirs(kok, exist_ok=True)
        except OSError as hata:
            return {"yazilan": 0, "atlanan": len(lekeler), "doldu": False,
                    "kok": kok, "hata": str(hata)}
        boyut = _klasor_boyutu(kok)
        kunye_yolu = os.path.join(kok, "kunye.jsonl")
        satirlar: list[str] = []
        for b in lekeler:
            if boyut >= azami_bayt:
                doldu = True
                atlanan += 1
                continue
            tur = etiket.get(b.get("no"), BILINMIYOR)
            klasor = os.path.join(kok, tur)
            ad = f"{kamera or 'kam'}_{damga or int(time.time())}_{b.get('no')}.jpg"
            try:
                os.makedirs(klasor, exist_ok=True)
                boyut += _yaz_jpeg(os.path.join(klasor, ad), kirp(rgb, b, boy))
            except Exception:                              # noqa: BLE001
                atlanan += 1
                continue
            yazilan += 1
            # KÜNYE İZLENEBİLİRLİK İÇİN. Etiketin yanlış olduğu sonradan
            # anlaşılırsa hangi kayıtların atılacağı ancak bununla bulunuyor.
            satirlar.append(json.dumps({
                "dosya": f"{tur}/{ad}", "tur": tur, "kamera": kamera,
                "damga": damga, "leke": b.get("no"),
                "alan_px": b.get("alan_px"),
                "x": b.get("yatak_x"), "y": b.get("yatak_y"),
                "ts": round(time.time(), 3),
            }, ensure_ascii=False))
        if satirlar:
            try:
                with open(kunye_yolu, "a", encoding="utf-8") as dosya:
                    dosya.write("\n".join(satirlar) + "\n")
            except OSError:
                pass
    return {"yazilan": yazilan, "atlanan": atlanan, "doldu": doldu,
            "kok": kok, "bayt": boyut, "azami_bayt": int(azami_bayt)}


def veri_durumu(kok: str | None = None) -> dict[str, Any]:
    """Toplanan verinin özeti: tür başına kaç kırpma, toplam kaç bayt."""
    kok = kok or veri_koku()
    if not os.path.isdir(kok):
        return {"kok": kok, "var": False, "turler": {}, "toplam": 0, "bayt": 0}
    turler: dict[str, int] = {}
    for ad in sorted(os.listdir(kok)):
        yol = os.path.join(kok, ad)
        if os.path.isdir(yol):
            turler[ad] = sum(1 for d in os.listdir(yol) if d.endswith(".jpg"))
    return {"kok": kok, "var": True, "turler": turler,
            "toplam": sum(turler.values()), "bayt": _klasor_boyutu(kok),
            "azami_bayt": AZAMI_BAYT}
