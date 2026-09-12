"""
isik — kareler arası pozlama/renk kaymasını düzleştirir.

Neden gerekli: bitki örtüsü eşikleri (ExG, a*) mutlak renk üstünde çalışır.
Sabah ve öğlen çekilen iki karede aynı filiz farklı eşiğe düşer; otomatik
pozlama ve otomatik beyaz denge açıksa tek bir bulut bile eşiği kaydırır.

İki katman:
  1) Kamerada kilit: picamera2'de AeEnable=False, AwbEnable=False ve sabit
     ExposureTime/AnalogueGain/ColourGains. Asıl çözüm budur (bkz. ajan_kanca).
  2) Karede telafi: kilitlenemeyen durumlar için gri-dünya ya da AprilTag'in
     beyaz kâğıdını referans alan kazanç düzeltmesi. Etiketler zaten kadrajda,
     bilinen beyaz yüzey bedava geliyor.
"""

from __future__ import annotations

import numpy as np
import cv2


def _kazanclar(bgr, maske) -> np.ndarray:
    ort = cv2.mean(bgr, mask=maske)[:3]  # B, G, R
    ort = np.asarray(ort, np.float64)
    if np.any(ort < 1e-3):
        return np.ones(3)
    hedef = ort.mean()
    return np.clip(hedef / ort, 0.5, 2.0)


def beyaz_referans_maskesi(bgr, etiket_sonucu, kucultme=0.45) -> np.ndarray | None:
    """AprilTag'lerin beyaz kenarlığını referans yüzey olarak işaretler."""
    et = (etiket_sonucu or {}).get("etiketler") or {}
    if not et:
        return None
    m = np.zeros(bgr.shape[:2], np.uint8)
    for e in et.values():
        k = np.asarray(e["koseler"], np.float64)
        merkez = k.mean(axis=0)
        ic = merkez + (k - merkez) * (1.0 + kucultme)   # kareyi biraz büyüt
        dis = merkez + (k - merkez) * (1.0 + kucultme + 0.35)
        cv2.fillPoly(m, [np.round(dis).astype(np.int32)], 255)
        cv2.fillPoly(m, [np.round(ic).astype(np.int32)], 0)
    # Yalnız gerçekten açık pikseller kalsın (kâğıt), gölgeye düşenler çıksın
    gri = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    m[gri < 90] = 0
    return m if cv2.countNonZero(m) > 500 else None


def normalize(bgr, roi_maske=None, etiket_sonucu=None) -> tuple[np.ndarray, dict]:
    """
    Döner: (duzeltilmis_bgr, tani)
    tani: hangi yöntemin kullanıldığı ve uygulanan kazançlar — hepsi ölçülmüş
    değerler, varsayım yok.
    """
    ref = beyaz_referans_maskesi(bgr, etiket_sonucu)
    yontem = "etiket_beyazi"
    if ref is None:
        ref = roi_maske
        yontem = "gri_dunya_roi" if roi_maske is not None else "gri_dunya_tam"

    g = _kazanclar(bgr, ref)
    # 8-bit kanalda kazanç = 256 girişli arama tablosu. Tam kareyi float32'ye
    # çevirip çarpmaktan bir kat hızlı; sonuç birebir aynı.
    taban = np.arange(256, dtype=np.float32)
    lut = np.ascontiguousarray(
        np.stack([np.clip(taban * g[k], 0, 255).astype(np.uint8)
                  for k in range(3)], axis=1).reshape(1, 256, 3))
    duz = cv2.LUT(bgr, lut)

    gri = cv2.cvtColor(duz, cv2.COLOR_BGR2GRAY)
    tani = {
        "yontem": yontem,
        "kazanc_bgr": [round(float(x), 4) for x in g],
        "ortalama_parlaklik": round(float(cv2.mean(gri, mask=roi_maske)[0]), 2),
        "yanmis_piksel_orani": round(float(np.mean(gri >= 253)), 5),
        "koyu_piksel_orani": round(float(np.mean(gri <= 8)), 5),
    }
    return duz, tani
