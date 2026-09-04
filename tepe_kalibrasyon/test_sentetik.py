#!/usr/bin/env python3
"""
Sentetik dogrulama. Bilinen bir kamera ile 3840x2880 kare uretir, boru hattini
calistirir ve olculen sayilari basar. Kurulumun dogru calistigini kanitlar;
ayrica "havada etiket" senaryosunda duzlemsellik uyarisinin gercekten tetiklendigini
gosterir.

Calistirma:  python3 test_sentetik.py
"""

from __future__ import annotations

import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kalibrasyon as kal

GEN, YUK = 3840, 2880
F = 2200.0
YATAK = (540.0, 645.0)
KENAR_MM = 30.0
ETIKETLER = {0: (60.0, 60.0), 1: (480.0, 70.0), 8: (70.0, 580.0), 9: (470.0, 575.0)}
ACILAR = {0: 12.0, 1: -25.0, 8: 40.0, 9: 3.0}


def kamera():
    K = np.array([[F, 0, GEN / 2.0], [0, F, YUK / 2.0], [0, 0, 1]], dtype=np.float64)
    goz = np.array([270.0, -350.0, 1300.0])
    hedef = np.array([270.0, 322.0, 0.0])
    ileri = hedef - goz
    ileri /= np.linalg.norm(ileri)
    yukari_d = np.array([0.0, 0.0, 1.0])
    sag = np.cross(ileri, yukari_d)
    sag /= np.linalg.norm(sag)
    asagi = np.cross(ileri, sag)
    R = np.vstack([sag, asagi, ileri])          # dunya -> kamera
    t = -R @ goz
    egim = math.degrees(math.acos(abs(ileri[2])))
    return K, R, t, egim


def yansit(K, R, t, P3):
    P3 = np.atleast_2d(np.asarray(P3, dtype=np.float64))
    kam = (R @ P3.T).T + t
    uv = (K @ kam.T).T
    return uv[:, :2] / uv[:, 2:3]


def etiket_gorseli(kimlik: int, boy: int) -> np.ndarray:
    """
    36h11 etiketi. 'boy' hedef ekran boyutunun ~2 katinda uretilir; boylece
    warpPerspective'te asiri kucultmeden dogan bit bozulmasi (aliasing) olmaz.
    Gercek kamerada bu is optik bulanikligin isi; asagida GaussianBlur ile temsil ediliyor.
    """
    boy = int(8 * max(4, round(boy / 8)))
    m = cv2.aruco.generateImageMarker(
        cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_APRILTAG_36h11), kimlik, boy
    )
    return cv2.cvtColor(m, cv2.COLOR_GRAY2BGR)


def kare_uret(yukseklikler: dict[int, float] | None = None):
    """yukseklikler: {kimlik: mm} — etiketi toprak yuzeyinden ne kadar yukarida tutalim."""
    yukseklikler = yukseklikler or {}
    K, R, t, egim = kamera()
    tuval = np.full((YUK, GEN, 3), 60, dtype=np.uint8)
    tuval += np.random.default_rng(7).integers(-8, 9, tuval.shape, dtype=np.int16).astype(np.uint8)

    # toprak yatak
    kose3 = np.array([[0, 0, 0], [YATAK[0], 0, 0], [YATAK[0], YATAK[1], 0], [0, YATAK[1], 0]], dtype=np.float64)
    kose2 = yansit(K, R, t, kose3).astype(np.int32)
    cv2.fillConvexPoly(tuval, kose2, (72, 92, 118))
    rng = np.random.default_rng(3)
    for _ in range(1200):  # toprak dokusu
        p = kose3[0] + rng.random(3) * [YATAK[0], YATAK[1], 0]
        q = yansit(K, R, t, p)[0].astype(int)
        cv2.circle(tuval, tuple(q), int(rng.integers(2, 9)), tuple(int(x) for x in rng.integers(50, 130, 3)), -1)

    gercek_merkezler = {}
    for kimlik, (cx, cy) in ETIKETLER.items():
        z = float(yukseklikler.get(kimlik, 0.0))
        a = math.radians(ACILAR[kimlik])
        ca, sa = math.cos(a), math.sin(a)
        yari = KENAR_MM / 2.0
        yerel = [(-yari, -yari), (yari, -yari), (yari, yari), (-yari, yari)]
        d3 = np.array([[cx + u * ca - v * sa, cy + u * sa + v * ca, z] for u, v in yerel])
        hedef = yansit(K, R, t, d3).astype(np.float32)
        # Yansitma dunya duzlemini goruntude ters cevirebilir. Kaynak dortgenle ayni
        # donme yonune getirilmezse etiket aynalanmis basilir ve hicbir dedektor okuyamaz.
        ekran_kenar = float(np.mean([np.linalg.norm(hedef[i] - hedef[(i + 1) % 4]) for i in range(4)]))
        g = etiket_gorseli(kimlik, ekran_kenar * 2.0)
        b = g.shape[0]
        kaynak = np.array([[0, 0], [b, 0], [b, b], [0, b]], dtype=np.float32)
        if np.sign(cv2.contourArea(hedef, True)) != np.sign(cv2.contourArea(kaynak, True)):
            hedef = hedef[::-1].copy()
        Hw = cv2.getPerspectiveTransform(kaynak, hedef)
        # beyaz sessiz bolge (etiketin kagit kenari)
        pay = b * 0.25
        beyaz_kaynak = np.array([[-pay, -pay], [b + pay, -pay], [b + pay, b + pay], [-pay, b + pay]], dtype=np.float32)
        beyaz_hedef = cv2.perspectiveTransform(beyaz_kaynak.reshape(-1, 1, 2), Hw).reshape(-1, 2)
        cv2.fillConvexPoly(tuval, beyaz_hedef.astype(np.int32), (238, 238, 238))
        yama = cv2.warpPerspective(g, Hw, (GEN, YUK), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_TRANSPARENT,
                                   dst=tuval.copy())
        maske = cv2.warpPerspective(np.full((b, b), 255, np.uint8), Hw, (GEN, YUK), flags=cv2.INTER_NEAREST)
        tuval[maske > 0] = yama[maske > 0]
        gercek_merkezler[kimlik] = yansit(K, R, t, np.array([[cx, cy, z]]))[0]

    tuval = cv2.GaussianBlur(tuval, (3, 3), 0.7)
    gurultu = np.random.default_rng(11).normal(0, 2.5, tuval.shape)
    tuval = np.clip(tuval.astype(np.float64) + gurultu, 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", tuval, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    tuval = cv2.imdecode(buf, cv2.IMREAD_COLOR)  # JPEG sikistirmasi da gercege dahil
    return tuval, gercek_merkezler, egim


def senaryo(ad: str, yukseklikler=None, dosya=None):
    print("=" * 74)
    print(ad)
    print("=" * 74)
    kare, gercek, egim = kare_uret(yukseklikler)
    if dosya:
        cv2.imwrite(dosya, kare, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        print(f"  kare yazildi: {dosya}")
    print(f"  kameranin dikeyden egimi (gercek): {egim:.1f} derece")

    tespitler, rapor = kal.etiketleri_bul(kare, list(ETIKETLER))
    print(f"  tespit: {rapor['bulunan_kimlikler']}  eksik: {rapor['eksik_kimlikler']}")
    for s in rapor["gecis_gunlugu"]:
        print("    " + s)
    for t in tespitler:
        g = gercek[t.kimlik]
        d = float(np.linalg.norm(np.array(t.merkez) - g))
        print(f"    id {t.kimlik}: kenar {t.kenar_px:.1f} px, asama {t.asama}, "
              f"merkez hatasi {d:.3f} px (alt piksel kaymasi {t.alt_piksel_kayma_px} px)")

    sonuc = kal.kalibre_et(tespitler, ETIKETLER, KENAR_MM, YATAK)
    b, h = sonuc.get("benzerlik", {}), sonuc.get("homografi", {})
    if b.get("hesaplanabilir"):
        print(f"  BENZERLIK  olcek {b['olcek_mm_px']:.5f} mm/px, donme {b['donme_derece']:.2f} deg")
        print(f"             ic artik RMS {b['ic_hata']['rms_mm']} mm, maks {b['ic_hata']['maks_mm']} mm")
        lo = b["loo"]
        print(f"             LOO {'RMS ' + str(lo['rms_mm']) + ' mm, maks ' + str(lo['maks_mm']) + ' mm' if lo['hesaplanabilir'] else lo['sebep']}")
    if h.get("hesaplanabilir"):
        print(f"  HOMOGRAFI  ic artik RMS {h['ic_hata']['rms_mm']} mm  <- 4 noktayla zorunlu sifir")
        lo = h["loo"]
        print("             LOO: " + (f"RMS {lo['rms_mm']} mm, maks {lo['maks_mm']} mm"
                                      if lo["hesaplanabilir"] else "HESAPLANAMAZ — " + lo["sebep"]))
        kt = h["kose_tutarliligi"]
        if kt.get("hesaplanabilir"):
            print(f"             kose tutarliligi ({kt['denklem_sayisi']} denklem / {kt['bilinmeyen_sayisi']} bilinmeyen): "
                  f"RMS {kt['genel_rms_mm']} mm = {kt['genel_rms_px']} px, "
                  f"uydurulan kenar {kt['uydurulan_kenar_mm']} mm (%{kt['kenar_sapma_yuzde']:+.2f})")
            print("               " + ", ".join(f"id{x['kimlik']}={x['rms_mm']} mm" for x in kt["etiket_basina"]))
        kk = h["kenar_kontrolu"]
        if kk.get("hesaplanabilir"):
            print(f"             kenar kontrolu (ornek disi): sistematik %{kk['sistematik_sapma_yuzde']:+.2f}, "
                  f"yayilim %{kk['olcek_yayilimi_yuzde']:.2f}")
            for e in kk["etiketler"]:
                print(f"               id {e['kimlik']}: haritalanan kenar {e['haritalanan_ortalama_kenar_mm']:.2f} mm "
                      f"(%{e['sapma_yuzde']:+.2f})")
        e = h["egiklik"]
        print(f"             yerel olcek {e['yerel_olcek_min_mm_px']:.4f} - {e['yerel_olcek_maks_mm_px']:.4f} mm/px, "
              f"oran {e['olcek_orani']:.3f}")
        print(f"             benzerlik-homografi maks fark {e.get('benzerlik_homografi_maks_fark_mm')} mm")
    print("  UYARILAR:")
    for u in sonuc["uyarilar"]:
        print("    - " + u)
    if not sonuc["uyarilar"]:
        print("    (yok)")
    print()
    return sonuc


if __name__ == "__main__":
    kok = os.path.dirname(os.path.abspath(__file__))
    senaryo("SENARYO 1 — dort etiket de toprak yuzeyinde", None, os.path.join(kok, "ornek_kare.jpg"))
    senaryo("SENARYO 2 — etiket 9 toprakta degil, 25 mm havada (kutu uzerinde)", {9: 25.0})
