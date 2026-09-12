"""
hailo — Faz 2: AI HAT+ (Hailo-8, 26 TOPS) üstünde öğrenmeli bölütleme.

Faz 1 (ExG+Otsu) toprağı bitkiden ayırır ama TÜR ayırmaz. Yabani otu
filizden görünümle ayırmak, ya da filizler birbirine girdiğinde tek tek
saymak gerektiğinde öğrenmeli model devreye girer. Hailo-8 bu işi CPU'yu
hiç meşgul etmeden yapar; klasik yol yedek olarak yerinde kalır.

Zincir:
  1. VERİ. Faz 1 zaten üretiyor: her taramada kare + maske + ekim kaydı
     eşleşmesi diske yazılıyor. Ekim kaydına düşen nesne "filiz", kayıttan
     uzak nesne "yabani" olarak ZAYIF ETİKETLENİR; panelde kullanıcının
     düzelttiği tespitler (depo.egitim_kumesi) kuvvetli etikettir.
     Hedef: ~300-800 kare, tür başına birkaç yüz örnek.
  2. EĞİTİM (Pi'de değil, masaüstünde/bulutta):
       yolo train model=yolo11n-seg.pt data=yatak.yaml imgsz=640 epochs=150
     Önceden eğitim için hazır kümeler: PhenoBench, CropAndWeed, Plant
     Seedlings Dataset. Kendi yatağınızla ince ayar şart.
  3. İHRAÇ:  yolo export model=best.pt format=onnx opset=13 imgsz=640
  4. DERLEME (Hailo Dataflow Compiler, x86'da):
       hailomz compile yolov8n_seg --ckpt best.onnx --hw-arch hailo8 \
           --calib-path ./kalibrasyon_kareleri --classes 2
     Çıktı: model.hef  -> Pi'ye kopyalanır.
  5. KOŞTURMA: HailoRT Python API (hailort / degirum). Aşağıdaki sarmalayıcı.

ÖNEMLİ — çözünürlük: model 640x640 girer, yatak karesi 1920x1440'tır. Yatak
ROI'si kırpılıp ölçeklenir; maske geri ölçeklenirken TAM kare koordinatına
döndürülmelidir, yoksa homografi yanlış piksele uygulanır. `_geri_olcekle`
bunu yapar.
"""

from __future__ import annotations

import numpy as np
import cv2

VARSAYILAN_HEF = "/home/batupi/farmbot/gorus/modeller/yatak_seg.hef"


class HailoBolutleyici:
    """
    Kullanım:
        h = HailoBolutleyici()          # model yoksa hazir=False
        if h.hazir:
            maske, siniflar, tani = h.calistir(bgr, roi_maske)
        else:
            maske, tani = bolutle.yesil_maske(bgr, ayar, roi_maske)
    """

    def __init__(self, hef=VARSAYILAN_HEF, girdi=(640, 640), esik=0.35):
        self.hef, self.girdi, self.esik = hef, girdi, esik
        self.hazir, self.sebep, self._model = False, None, None
        try:
            import hailo_platform as hp          # noqa: F401
            from pathlib import Path
            if not Path(hef).exists():
                self.sebep = f"model dosyası yok: {hef}"
                return
            self._kur()
            self.hazir = True
        except ImportError:
            self.sebep = "hailort/hailo_platform kurulu değil"
        except Exception as e:
            self.sebep = f"Hailo başlatılamadı: {e}"

    def _kur(self):
        import hailo_platform as hp
        self._hp = hp
        self._hef_nesne = hp.HEF(self.hef)
        self._hedef = hp.VDevice()
        cfg = hp.ConfigureParams.create_from_hef(
            self._hef_nesne, interface=hp.HailoStreamInterface.PCIe)
        self._ag = self._hedef.configure(self._hef_nesne, cfg)[0]

    # --- ön/arka işleme ---
    def _hazirla(self, bgr, roi_maske):
        if roi_maske is not None:
            x, y, w, h = cv2.boundingRect(roi_maske)
        else:
            x, y, w, h = 0, 0, bgr.shape[1], bgr.shape[0]
        kirp = bgr[y:y + h, x:x + w]
        o = min(self.girdi[0] / w, self.girdi[1] / h)
        yeni = (int(round(w * o)), int(round(h * o)))
        kucuk = cv2.resize(kirp, yeni, interpolation=cv2.INTER_LINEAR)
        tuval = np.zeros((self.girdi[1], self.girdi[0], 3), np.uint8)
        tuval[:yeni[1], :yeni[0]] = kucuk
        return tuval, (x, y, w, h, o, yeni)

    @staticmethod
    def _geri_olcekle(maske_640, don, tam_boy):
        x, y, w, h, o, yeni = don
        kes = maske_640[:yeni[1], :yeni[0]]
        geri = cv2.resize(kes, (w, h), interpolation=cv2.INTER_NEAREST)
        tam = np.zeros((tam_boy[1], tam_boy[0]), np.uint8)
        tam[y:y + h, x:x + w] = geri
        return tam

    def calistir(self, bgr, roi_maske=None):
        if not self.hazir:
            raise RuntimeError(f"Hailo hazır değil: {self.sebep}")
        girdi, don = self._hazirla(bgr, roi_maske)
        with self._ag.activate():
            with self._hp.InferVStreams(
                self._ag,
                self._hp.InputVStreamParams.make(self._ag),
                self._hp.OutputVStreamParams.make(self._ag),
            ) as akis:
                ad = list(akis.get_input_vstream_infos())[0].name if hasattr(
                    akis, "get_input_vstream_infos") else self._hef_nesne \
                    .get_input_vstream_infos()[0].name
                cikti = akis.infer({ad: np.expand_dims(girdi, 0)})
        maske, siniflar = self._ciktiyi_coz(cikti)
        tam = self._geri_olcekle(maske, don, (bgr.shape[1], bgr.shape[0]))
        return tam, siniflar, {"motor": "hailo8", "hef": self.hef,
                               "girdi": list(self.girdi), "esik": self.esik}

    def _ciktiyi_coz(self, cikti):
        """
        YOLO-seg çıktısının HEF'e göre biçimi değişir (post-process HEF içinde
        mi, dışında mı). Derlemede hangi biçimi seçtiyseniz burayı ona göre
        yazın; sahte bir çözüm döndürmek yanlış koordinat üretir.
        """
        raise NotImplementedError(
            "HEF çıktı biçiminiz derleme sırasında belli olur; _ciktiyi_coz'u "
            "o biçime göre doldurun (proto maske x katsayı ya da hazır maske).")


def zayif_etiket_disari_aktar(depo, hedef_dizin, en_az_skor=0.8) -> dict:
    """
    Faz 1'in ürettiği yüksek güvenli tespitleri YOLO-seg biçiminde diske yazar.
    İnsan etiketi olanlar 'kuvvetli', yalnız ekim kaydına dayananlar 'zayif'
    klasörüne gider; eğitimde kuvvetliler ağırlıklandırılır.
    """
    from pathlib import Path
    import json
    hedef = Path(hedef_dizin)
    (hedef / "kuvvetli").mkdir(parents=True, exist_ok=True)
    (hedef / "zayif").mkdir(parents=True, exist_ok=True)
    sayim = {"kuvvetli": 0, "zayif": 0}
    for r in depo.egitim_kumesi():
        sayim["kuvvetli"] += 1
        (hedef / "kuvvetli" / f"{r['id']}.json").write_text(
            json.dumps(dict(r), ensure_ascii=False, default=str), "utf-8")
    for r in depo.tespitler():
        if r.get("insan_etiketi") or (r.get("skor") or 0) < en_az_skor:
            continue
        sayim["zayif"] += 1
        (hedef / "zayif" / f"{r['id']}.json").write_text(
            json.dumps(dict(r), ensure_ascii=False, default=str), "utf-8")
    return sayim
