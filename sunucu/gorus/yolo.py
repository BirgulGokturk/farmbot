"""
yolo — kuşbakışı görüntü üzerinde nesne tespiti (filiz / yabani).

NEDEN DÜZLEŞTİRİLMİŞ GÖRÜNTÜ ÜZERİNDE
  * Ölçek her yerde aynı. Modelin gördüğü filiz, yatağın uzak ucunda da yakın
    ucunda da aynı piksel boyunda; öğrenmesi kolaylaşır, kutu boyutu doğrudan
    mm'ye çevrilir.
  * Koordinat dönüşümü TAM olur. Ortho piksel -> mm saf ölçek+kaydırmadır;
    ara değer hesabı gerekmez.
  * Bitkiler perspektifle burulmaz; aynı tür her yerde aynı şekilde görünür.

BEDELİ: warp bir kez daha örnekleme yapar, çok küçük nesnelerde hafif bulanıklık
katar. px_mm'yi kaynak çözünürlüğün altında seçmeyin (bkz. `onerilen_px_mm`).

ARKA UÇLAR — hangisi varsa o kullanılır, yoksa sebebi yazılır:
  ultralytics : .pt / .onnx        (CPU; Pi 5'te yavaş ama çalışır)
  onnxruntime : .onnx
  hailo       : .hef               (AI HAT+ 26 TOPS; asıl hedef)
Model yoksa `EsikBolutleyici` klasik yola düşer — ExG + Otsu. Veri toplarken
ve boru hattını sınarken bunu kullanın; model gelince değiştirin.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import cv2


@dataclass
class Bulgu:
    """Kuşbakışı görüntüdeki tek nesne. Koordinatlar ORTHO PİKSEL."""
    sinif: str
    guven: float
    kutu: tuple[float, float, float, float]      # x, y, w, h
    merkez: tuple[float, float]
    maske: np.ndarray | None = field(default=None, repr=False)
    alan_px: float | None = None


def onerilen_px_mm(izgara, kaynak_kare_boyu) -> dict:
    """
    Kuşbakışı ölçeği kaynak çözünürlüğün üstüne çıkarmak bilgi eklemez, yalnız
    dosyayı büyütür. Hücrelerin en KABA köşesindeki çözünürlük tavandır.
    """
    en_kaba = 0.0
    for h in izgara.hucreler:
        en_kaba = max(en_kaba, max(h.olcek_mm_px().values()))
    if en_kaba <= 0:
        return {"tavan_px_mm": None, "sebep": "ölçek hesaplanamadı"}
    tavan = 1.0 / en_kaba
    return {"tavan_px_mm": round(tavan, 2),
            "onerilen_px_mm": round(min(tavan, 4.0), 2),
            "en_kaba_mm_px": round(en_kaba, 4),
            "not": "px_mm bu tavanın üstünde seçilirse warp yalnız büyütür, "
                   "yeni ayrıntı gelmez."}


# ----------------------------------------------------------------- arka uçlar

class Bolutleyici:
    """Ortak arayüz: calistir(ortho_bgr) -> (list[Bulgu], tani)."""
    hazir = False
    sebep: str | None = None

    def calistir(self, ortho_bgr):
        raise NotImplementedError


class EsikBolutleyici(Bolutleyici):
    """
    Model gerektirmeyen yedek: ExG + Otsu ile bitki örtüsü, sonra bağlantılı
    bileşen. TÜR AYIRMAZ — hepsini "bitki" olarak döndürür; filiz/yabani
    ayrımını konum ve akran karşılaştırması yapar (bkz. gorus.siniflandir).
    """

    def __init__(self, min_alan_mm2=8.0, px_mm=4.0, acma=3, kapama=5):
        self.hazir = True
        self.min_alan_px = float(min_alan_mm2) * px_mm * px_mm
        self.acma, self.kapama = int(acma), int(kapama)

    def calistir(self, ortho_bgr):
        f = ortho_bgr.astype(np.float32)
        B, G, R = f[:, :, 0], f[:, :, 1], f[:, :, 2]
        top = np.maximum(B + G + R, 1e-6)
        r, g, b = R / top, G / top, B / top
        exgr = (2 * g - r - b) - (1.4 * r - g)

        gecerli = ortho_bgr.any(axis=2)                 # warp dışı siyah alan
        if gecerli.sum() < 1000:
            return [], {"motor": "esik", "uyari": "kuşbakışı tuval neredeyse boş"}
        u8 = np.clip((exgr[gecerli] + 1.0) * 127.5, 0, 255).astype(np.uint8)
        t, _ = cv2.threshold(u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        esik = max(float(t) / 127.5 - 1.0, 0.05)

        m = ((exgr >= esik) & gecerli).astype(np.uint8) * 255
        lab_a = cv2.cvtColor(ortho_bgr, cv2.COLOR_BGR2LAB)[:, :, 1].astype(np.int16) - 128
        m[lab_a > -3] = 0
        if self.acma:
            m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (self.acma, self.acma)))
        if self.kapama:
            m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (self.kapama, self.kapama)))

        konturlar, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        bulgular = []
        elenen = 0
        for c in konturlar:
            alan = float(cv2.contourArea(c))
            if alan < self.min_alan_px:
                elenen += 1
                continue
            x, y, w, hh = cv2.boundingRect(c)
            mm = cv2.moments(c)
            cx = mm["m10"] / mm["m00"] if mm["m00"] else x + w / 2
            cy = mm["m01"] / mm["m00"] if mm["m00"] else y + hh / 2
            nm = np.zeros(m.shape, np.uint8)
            cv2.drawContours(nm, [c], -1, 255, -1)
            bulgular.append(Bulgu("bitki", 1.0, (x, y, w, hh), (cx, cy),
                                  maske=nm, alan_px=alan))
        return bulgular, {"motor": "esik", "esik_exgr": round(esik, 4),
                          "kontur": len(konturlar), "elenen_kucuk": elenen,
                          "yesil_oran": round(float(np.mean(m > 0)), 5)}


class YoloBolutleyici(Bolutleyici):
    """
    Ultralytics ya da onnxruntime üstünde YOLO. Model dosyası yoksa
    `hazir=False` ve `sebep` dolar; çağıran yedeğe düşebilir.
    """

    def __init__(self, model_yolu, siniflar=("filiz", "yabani"), esik=0.35,
                 girdi=640, arka_uc="otomatik"):
        self.model_yolu = str(model_yolu)
        self.siniflar = tuple(siniflar)
        self.esik = float(esik)
        self.girdi = int(girdi)
        self.arka_uc = None
        self._m = None
        if not Path(self.model_yolu).exists():
            self.sebep = f"model dosyası yok: {self.model_yolu}"
            return
        for deneme in (["ultralytics", "onnx"] if arka_uc == "otomatik" else [arka_uc]):
            try:
                getattr(self, f"_kur_{deneme}")()
                self.arka_uc, self.hazir = deneme, True
                return
            except Exception as e:
                self.sebep = f"{deneme}: {type(e).__name__}: {e}"

    def _kur_ultralytics(self):
        from ultralytics import YOLO
        self._m = YOLO(self.model_yolu)

    def _kur_onnx(self):
        import onnxruntime as ort
        self._m = ort.InferenceSession(self.model_yolu,
                                       providers=["CPUExecutionProvider"])

    def calistir(self, ortho_bgr):
        if not self.hazir:
            raise RuntimeError(f"YOLO hazır değil: {self.sebep}")
        if self.arka_uc == "ultralytics":
            return self._calistir_ultralytics(ortho_bgr)
        raise NotImplementedError(
            "onnxruntime arka ucunda çıktı çözümlemesi modelin ihraç biçimine "
            "bağlı (NMS içeride mi, çıktı düzeni ne). İhraç komutunuzu "
            "paylaşın, bu kısmı ona göre yazayım — uydurma bir çözümleme "
            "yanlış koordinat üretir.")

    def _calistir_ultralytics(self, ortho_bgr):
        # Büyük kuşbakışı tuvali modele olduğu gibi vermek ayrıntı kaybettirir;
        # ultralytics kendi ölçeklemesini yapar ve kutuları geri ölçekler.
        s = self._m.predict(ortho_bgr, imgsz=self.girdi, conf=self.esik,
                            verbose=False)[0]
        bulgular = []
        adlar = getattr(self._m, "names", {}) or {}
        maskeler = None
        if getattr(s, "masks", None) is not None and s.masks is not None:
            maskeler = s.masks.data.cpu().numpy()
        for i, kutu in enumerate(s.boxes):
            x1, y1, x2, y2 = [float(v) for v in kutu.xyxy[0].tolist()]
            sid = int(kutu.cls[0])
            ad = adlar.get(sid, self.siniflar[sid] if sid < len(self.siniflar)
                           else str(sid))
            m = None
            alan = None
            if maskeler is not None and i < len(maskeler):
                m = cv2.resize((maskeler[i] > 0.5).astype(np.uint8) * 255,
                               (ortho_bgr.shape[1], ortho_bgr.shape[0]),
                               interpolation=cv2.INTER_NEAREST)
                alan = float(np.count_nonzero(m))
            bulgular.append(Bulgu(ad, float(kutu.conf[0]),
                                  (x1, y1, x2 - x1, y2 - y1),
                                  ((x1 + x2) / 2, (y1 + y2) / 2),
                                  maske=m,
                                  alan_px=alan if alan is not None
                                  else (x2 - x1) * (y2 - y1) * 0.6))
        return bulgular, {"motor": f"yolo/{self.arka_uc}", "model": self.model_yolu,
                          "esik": self.esik, "girdi": self.girdi,
                          "bulgu": len(bulgular),
                          "maske_var": maskeler is not None}


class HailoBolutleyici(Bolutleyici):
    """AI HAT+ (Hailo-8) üstünde .hef. Çıktı çözümlemesi derlemeye bağlıdır."""

    def __init__(self, hef_yolu, siniflar=("filiz", "yabani"), girdi=(640, 640)):
        self.hef_yolu, self.siniflar, self.girdi = str(hef_yolu), tuple(siniflar), girdi
        if not Path(self.hef_yolu).exists():
            self.sebep = f"hef yok: {self.hef_yolu}"
            return
        try:
            import hailo_platform  # noqa: F401
            self.sebep = ("hailo_platform kurulu ve .hef var, ama çıktı "
                          "çözümlemesi derleme biçimine bağlı — hailomz compile "
                          "komutunuzu paylaşın, bu kısmı ona göre yazayım.")
        except ImportError:
            self.sebep = "hailo_platform kurulu değil"

    def calistir(self, ortho_bgr):
        raise NotImplementedError(self.sebep)


def bolutleyici_sec(model_yolu=None, hef_yolu=None, px_mm=4.0, **kw) -> Bolutleyici:
    """Sırayla Hailo -> YOLO -> eşik. Hangisinin seçildiği `sebep`te görünür."""
    for kurucu in ((lambda: HailoBolutleyici(hef_yolu, **kw)) if hef_yolu else None,
                   (lambda: YoloBolutleyici(model_yolu, **kw)) if model_yolu else None):
        if kurucu is None:
            continue
        b = kurucu()
        if b.hazir:
            return b
    y = EsikBolutleyici(px_mm=px_mm)
    y.sebep = "model verilmedi ya da yüklenemedi — klasik eşik yoluna düşüldü"
    return y


# ------------------------------------------------------- ortho -> makine mm

def bulgulari_mm_yap(bulgular, ortho_to_mm, px_mm) -> list[dict]:
    """
    Kuşbakışı piksel -> makine mm. Ortho'da ölçek her yerde aynı olduğu için
    bu dönüşüm TAMDIR; ara değer hesabı yapılmaz.
    """
    cikti = []
    for i, b in enumerate(bulgular):
        mm = ortho_to_mm([b.merkez])[0]
        x, y, w, h = b.kutu
        kose = ortho_to_mm([[x, y], [x + w, y + h]])
        alan_mm2 = (b.alan_px / (px_mm * px_mm)) if b.alan_px is not None else None
        cikti.append({
            "id": i, "x_mm": float(mm[0]), "y_mm": float(mm[1]),
            "alan_mm2": round(alan_mm2, 2) if alan_mm2 is not None else None,
            "cap_mm": (round(2.0 * float(np.sqrt(alan_mm2 / np.pi)), 2)
                       if alan_mm2 else None),
            "en_mm": round(float(abs(kose[1][0] - kose[0][0])), 2),
            "boy_mm": round(float(abs(kose[1][1] - kose[0][1])), 2),
            "model_sinifi": b.sinif, "guven": round(float(b.guven), 3),
            "ortho_piksel": [round(float(v), 1) for v in b.merkez],
        })
    return cikti
