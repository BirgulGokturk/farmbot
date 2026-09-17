#!/usr/bin/env python3
"""ADIM 3 — Intrinsic (iç) kalibrasyon: cameraMatrix (K) ve distCoeffs hesaplar.

    python3 3_ic_kalibrasyon.py
    python3 3_ic_kalibrasyon.py --model rasyonel      # geniş açı / belirgin fıçı bozulması
    python3 3_ic_kalibrasyon.py --alpha 0             # düzeltilmiş karede siyah kenar istemiyorsanız

Çıktı: kalib_veri/kamera_ic.json, kalib_veri/ic_rapor.txt, kalib_veri/ic_ornek_duzeltilmis.jpg
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

import ortak

MIN_KOSE = 8
MIN_FOTO = 10


def kalibre(nesne, piksel, boyut, bayrak):
    rms, K, dist, rv, tv, std_ic, _, hata = cv2.calibrateCameraExtended(
        nesne, piksel, boyut, None, None, flags=bayrak,
        criteria=(cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 200, 1e-10))
    return rms, K, dist, std_ic.ravel(), hata.ravel()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--klasor", default=str(ortak.VERI / "ic_fotolar"))
    ap.add_argument("--model", choices=["standart", "rasyonel"], default="standart")
    ap.add_argument("--alpha", type=float, default=1.0,
                    help="1 = hiçbir piksel kaybolmaz (kenarlarda siyah alan), 0 = yalnız geçerli alan (kenarlar kırpılır)")
    a = ap.parse_args()

    ayar = ortak.tahta_ayar_oku()
    klasor = Path(a.klasor)
    dosyalar = sorted(p for p in klasor.glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if not dosyalar:
        raise ortak.KalibHata(f"{klasor} içinde fotoğraf yok. Önce 2_foto_cek.py.")

    nesne, piksel, adlar, boyut = [], [], [], None
    for p in dosyalar:
        img = ortak.resim_oku(p)
        b = (img.shape[1], img.shape[0])
        if boyut is None:
            boyut = b
        elif b != boyut:
            raise ortak.KalibHata(f"{p.name} {b[0]}x{b[1]}, diğerleri {boyut[0]}x{boyut[1]}. Hepsi aynı çözünürlükte olmalı.")
        r = ortak.tahta_noktalari(img, ayar)
        if r is None or len(r[0]) < MIN_KOSE:
            print(f"  atlandı: {p.name} ({0 if r is None else len(r[0])} köşe)")
            continue
        nesne.append(r[0])
        piksel.append(r[1])
        adlar.append(p.name)
    print(f"Kullanılabilir fotoğraf: {len(adlar)}/{len(dosyalar)}")
    if len(adlar) < MIN_FOTO:
        raise ortak.KalibHata(f"En az {MIN_FOTO} kullanılabilir fotoğraf gerekli, {len(adlar)} var. REHBER.md adım 3'e bakın.")

    bayrak = cv2.CALIB_RATIONAL_MODEL if a.model == "rasyonel" else 0
    rms, K, dist, std, hata = kalibre(nesne, piksel, boyut, bayrak)

    # Aykırı fotoğrafları bir kez ele (bulanık, tahtası bükülmüş, yanlış eşleşmiş)
    esik = max(2.5 * float(np.median(hata)), 0.5)
    atilan = [i for i in np.argsort(-hata) if hata[i] > esik][: max(1, len(adlar) // 5)]
    atilan = [i for i in atilan if hata[i] > esik]
    ilk_rms = rms
    if atilan and len(adlar) - len(atilan) >= MIN_FOTO:
        kalan = [i for i in range(len(adlar)) if i not in atilan]
        print("Aykırı çıkarılan: " + ", ".join(f"{adlar[i]} ({hata[i]:.2f} px)" for i in atilan))
        nesne = [nesne[i] for i in kalan]
        piksel = [piksel[i] for i in kalan]
        adlar = [adlar[i] for i in kalan]
        rms, K, dist, std, hata = kalibre(nesne, piksel, boyut, bayrak)

    yeniK, _ = cv2.getOptimalNewCameraMatrix(K, dist, boyut, a.alpha, boyut)
    kapsama = ortak.kapsama_haritasi(boyut, piksel)
    W, H = boyut
    ad = ["fx", "fy", "cx", "cy"]
    satirlar = [
        f"Çözünürlük      : {W}x{H}",
        f"Fotoğraf        : {len(adlar)}   toplam köşe: {sum(len(p) for p in piksel)}",
        f"Model           : {a.model} ({dist.size} katsayı)",
        f"RMS yeniden izdüşüm hatası: {rms:.3f} px" + (f"  (aykırılar çıkarılmadan önce {ilk_rms:.3f})" if ilk_rms != rms else ""),
        "",
        "Kamera matrisi (± 1 standart sapma):",
    ]
    for j, (n, v) in enumerate(zip(ad, [K[0, 0], K[1, 1], K[0, 2], K[1, 2]])):
        satirlar.append(f"  {n} = {v:9.2f} ± {std[j]:.2f} px")
    satirlar.append(f"  asal nokta merkezden sapma: dx={K[0,2]-(W-1)/2:+.1f} px, dy={K[1,2]-(H-1)/2:+.1f} px")
    satirlar.append(f"  yatay görüş açısı: {np.degrees(2*np.arctan(W/(2*K[0,0]))):.1f}°")
    satirlar.append("distCoeffs: " + ", ".join(f"{x:+.5f}" for x in dist.ravel()))
    satirlar.append("")
    satirlar.append("Fotoğraf başına hata (px):")
    for n, e in sorted(zip(adlar, hata), key=lambda t: -t[1]):
        satirlar.append(f"  {n:24s} {e:.3f}")
    satirlar.append("")
    satirlar.append("Kapsama (kadraj 8x6):")
    satirlar.append(ortak.kapsama_yazdir(kapsama))
    satirlar.append("")
    uyarilar = []
    if rms > 1.0:
        uyarilar.append(f"RMS {rms:.2f} px yüksek (hedef < 0.5 px). Bulanık foto, düz olmayan tahta ya da yanlış kare ölçüsü olabilir.")
    if (kapsama == 0).sum() > 4:
        uyarilar.append(f"{int((kapsama == 0).sum())} hücre boş: kenar/köşe distorsiyonu tahmin edilmiyor, o bölgelere foto ekleyin.")
    if abs(K[0, 0] - K[1, 1]) / K[0, 0] > 0.02:
        uyarilar.append("fx ile fy %2'den fazla farklı; eğik açılı foto az olabilir.")
    if std[0] / K[0, 0] > 0.01:
        uyarilar.append("fx belirsizliği %1'den büyük; tahtayı 20-45° eğik tuttuğunuz foto sayısını artırın.")
    satirlar += ["UYARI: " + u for u in uyarilar] or ["Uyarı yok."]
    rapor = "\n".join(satirlar)
    print(rapor)

    ortak.json_yaz(ortak.IC_DOSYA, {
        "tur": "kamera_ic", "goruntu_boyutu": [W, H], "K": K, "dist": dist.ravel(), "yeniK": yeniK,
        "alpha": a.alpha, "model": a.model, "rms_px": float(rms), "foto_sayisi": len(adlar),
        "std_fx_fy_cx_cy": std[:4], "tahta": ayar,
    })
    (ortak.VERI / "ic_rapor.txt").write_text(rapor, encoding="utf-8")

    ornek = ortak.resim_oku(klasor / adlar[0])
    m1, m2 = cv2.initUndistortRectifyMap(K, dist, None, yeniK, boyut, cv2.CV_16SC2)
    duz = cv2.remap(ornek, m1, m2, cv2.INTER_LINEAR)
    yan = np.hstack([ornek, duz])
    olcek = min(1.0, 2400 / yan.shape[1])
    cv2.imwrite(str(ortak.VERI / "ic_ornek_duzeltilmis.jpg"), cv2.resize(yan, None, fx=olcek, fy=olcek))
    print(f"\nKaydedildi: {ortak.IC_DOSYA}")
    print("Not: iç kalibrasyon değiştiği için 4_etiket_kalibrasyon.py yeniden çalıştırılmalı (REHBER adım 6).")


if __name__ == "__main__":
    try:
        main()
    except ortak.KalibHata as e:
        sys.exit(f"HATA: {e}")
