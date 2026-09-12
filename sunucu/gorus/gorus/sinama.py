"""
sinama — sentetik yatak sahnesiyle uçtan uca doğrulama ve süre ölçümü.

Pi'ye ve gerçek kameraya hiç dokunmadan şunu ölçer: gerçek mm konumu BİLİNEN
filizleri, eğik bir kameradan bakıp koordinatlarını kaç mm hatayla geri
buluyoruz? Zincirdeki (etiket bulma -> homografi -> bölütleme -> nesne ->
taban noktası) her hata bu sayıya yansır.

Kullanım:
    python -m gorus.sinama                 # varsayılan sahne, rapor + görsel
    python -m gorus.sinama --filiz 14 --egim 0.55 --gurultu 9
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import cv2

from .ayarlar import Ayarlar
from .boru import Tarama
from .duzlem import Duzlem
from .eslestir import EkimKaydi
from . import etiket

YATAK = (540.0, 645.0)
ETIKET_MM = {0: (45.0, 45.0), 1: (495.0, 45.0), 8: (495.0, 600.0), 9: (45.0, 600.0)}
ETIKET_KENAR_MM = 40.0


def ustten_sahne(filiz_mm, yabani_mm, px_mm=4.0, gurultu=8, tohum=7):
    rng = np.random.default_rng(tohum)
    W, H = int(YATAK[0] * px_mm), int(YATAK[1] * px_mm)
    img = np.zeros((H, W, 3), np.uint8)
    img[:, :] = (58, 74, 104)                                  # BGR: kahverengi toprak
    img += rng.normal(0, gurultu, img.shape).astype(np.int16).clip(-60, 60).astype(np.uint8)
    for _ in range(2500):                                      # toprak dokusu / çakıl
        x, y = rng.integers(0, W), rng.integers(0, H)
        r = int(rng.integers(2, 7))
        t = int(rng.integers(-28, 34))
        cv2.circle(img, (x, y), r, (58 + t, 74 + t, 104 + t), -1)

    sozluk = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_APRILTAG_36h11)
    kenar = int(ETIKET_KENAR_MM * px_mm)
    for eid, (mx, my) in ETIKET_MM.items():
        tag = cv2.aruco.generateImageMarker(sozluk, eid, kenar)
        tag = cv2.cvtColor(tag, cv2.COLOR_GRAY2BGR)
        pay = int(kenar * 0.22)                                 # beyaz kâğıt kenarlığı
        kagit = np.full((kenar + 2 * pay, kenar + 2 * pay, 3), 245, np.uint8)
        kagit[pay:pay + kenar, pay:pay + kenar] = tag
        cx, cy = int(mx * px_mm), int(my * px_mm)
        y0, x0 = cy - kagit.shape[0] // 2, cx - kagit.shape[1] // 2
        img[y0:y0 + kagit.shape[0], x0:x0 + kagit.shape[1]] = kagit

    def bitki(mm, yaricap_mm, renk, yaprak, tohum2):
        r2 = np.random.default_rng(tohum2)
        cx, cy = mm[0] * px_mm, mm[1] * px_mm
        for i in range(yaprak):
            a = 2 * np.pi * i / yaprak + r2.uniform(0, 0.6)
            d = yaricap_mm * px_mm * r2.uniform(0.35, 0.62)
            eksen = (int(yaricap_mm * px_mm * r2.uniform(0.45, 0.75)),
                     int(yaricap_mm * px_mm * r2.uniform(0.22, 0.40)))
            t = tuple(int(c + r2.integers(-16, 16)) for c in renk)
            cv2.ellipse(img, (int(cx + d * np.cos(a)), int(cy + d * np.sin(a))),
                        eksen, np.degrees(a), 0, 360, t, -1)
        cv2.circle(img, (int(cx), int(cy)), max(2, int(2.0 * px_mm)),
                   (40, 120, 40), -1)

    for i, mm in enumerate(filiz_mm):
        bitki(mm, 9.0, (60, 150, 55), 4, 100 + i)               # filiz: derli toplu
    for i, mm in enumerate(yabani_mm):
        bitki(mm, 13.0, (75, 165, 80), 9, 500 + i)              # yabani: dağınık, çok yaprak
    return img, px_mm


def egik_kamera(ustten, px_mm, kare=(1920, 1440), egim=0.45, tohum=7):
    """Üstten sahneyi eğik bakan bir kameraya taşır, kadraja yatak dışını da koyar."""
    rng = np.random.default_rng(tohum)
    W, H = kare
    tuval = np.zeros((H, W, 3), np.uint8)
    tuval[:, :] = (70, 95, 70)                                  # yatak dışı: çim
    for _ in range(6000):
        x, y = rng.integers(0, W), rng.integers(0, H)
        cv2.circle(tuval, (x, y), int(rng.integers(2, 9)),
                   (60 + int(rng.integers(0, 45)), 110 + int(rng.integers(0, 60)),
                    60 + int(rng.integers(0, 40))), -1)

    uh, uw = ustten.shape[:2]
    kacis = egim * W * 0.16
    hedef = np.float32([[W * 0.20 + kacis, H * 0.20],
                        [W * 0.80 - kacis, H * 0.20],
                        [W * 0.94, H * 0.90],
                        [W * 0.06, H * 0.90]])
    kaynak = np.float32([[0, 0], [uw, 0], [uw, uh], [0, uh]])
    Hwarp = cv2.getPerspectiveTransform(kaynak, hedef)
    yatak = cv2.warpPerspective(ustten, Hwarp, (W, H))
    m = cv2.warpPerspective(np.full((uh, uw), 255, np.uint8), Hwarp, (W, H))
    tuval[m > 0] = yatak[m > 0]

    # hafif ışık eğimi (güneş) — eşiklerin buna dayanması gerekiyor
    gx = np.linspace(0.86, 1.14, W, dtype=np.float32)[None, :, None]
    tuval = np.clip(tuval.astype(np.float32) * gx, 0, 255).astype(np.uint8)
    return tuval


def calistir(n_filiz=10, n_yabani=6, egim=0.45, gurultu=8, tohum=7, yaz=True):
    rng = np.random.default_rng(tohum)
    # filizler ekim ızgarasında, yabaniler rastgele
    xs = np.linspace(120, 430, 5)
    ys = np.linspace(140, 520, int(np.ceil(n_filiz / 5)))
    filiz = [(float(x), float(y)) for y in ys for x in xs][:n_filiz]
    yabani = [(float(rng.uniform(70, 480)), float(rng.uniform(80, 570)))
              for _ in range(n_yabani)]
    # yabaniler filizlere çok yakın düşmesin (senaryo gereği ayrık olsunlar)
    yabani = [y for y in yabani
              if min(np.hypot(y[0] - f[0], y[1] - f[1]) for f in filiz) > 45]

    ustten, px_mm = ustten_sahne(filiz, yabani, gurultu=gurultu, tohum=tohum)
    kamera = egik_kamera(ustten, px_mm, egim=egim, tohum=tohum)

    # --- kalibrasyon: etiketleri bul, homografiyi kur ---
    b = etiket.bul(kamera, list(ETIKET_MM))
    if b["eksik"]:
        return {"hata": f"sentetik sahnede etiket bulunamadı: {b['eksik']}",
                "tani": b["tani"]}
    ciftler = {i: (b["etiketler"][i]["merkez"], ETIKET_MM[i]) for i in ETIKET_MM}
    D = Duzlem.etiketlerden(ciftler, (kamera.shape[1], kamera.shape[0]), YATAK)

    ayar = Ayarlar()
    ayar.kare.isleme_genisligi = kamera.shape[1]
    ayar.gerekli_etiketler = tuple(ETIKET_MM)
    kayitlar = [EkimKaydi(id=i, x_mm=f[0], y_mm=f[1], tur="test", yas_gun=10.0)
                for i, f in enumerate(filiz)]

    t = Tarama(ayar, D)
    s = t.calistir(kamera, kayitlar=kayitlar, izler=[])

    # --- ölçüm: gerçek mm ile bulunan mm arasındaki hata ---
    gercek = [("filiz", f) for f in filiz] + [("yabani", y) for y in yabani]
    hatalar, dogru_sinif, bulunan = [], 0, 0
    for tur, g in gercek:
        adaylar = [d for d in s["tespitler"] if d["taban_mm"]]
        if not adaylar:
            continue
        en = min(adaylar, key=lambda d: np.hypot(d["taban_mm"][0] - g[0],
                                                 d["taban_mm"][1] - g[1]))
        h = float(np.hypot(en["taban_mm"][0] - g[0], en["taban_mm"][1] - g[1]))
        if h < 35.0:
            bulunan += 1
            hatalar.append(h)
            if en["sinif"] == tur:
                dogru_sinif += 1

    rapor = {
        "sahne": {"filiz": len(filiz), "yabani": len(yabani),
                  "kare": list(s["kare_boyu"]), "egim": egim},
        "kalibrasyon_artigi_mm": D.oz_denetim()["artik_rms_mm"],
        "olcek_mm_px": D.olcek_ozeti(),
        "tespit": {"bulunan": bulunan, "gercek": len(gercek),
                   "nesne_sayisi": len(s["tespitler"])},
        "konum_hatasi_mm": ({"ortalama": round(float(np.mean(hatalar)), 2),
                             "medyan": round(float(np.median(hatalar)), 2),
                             "max": round(float(np.max(hatalar)), 2)}
                            if hatalar else None),
        "sinif_dogrulugu": (round(dogru_sinif / bulunan, 3) if bulunan else None),
        "sayim": s["sayim"],
        "sureler_ms": s["sureler_ms"],
        "bolutleme": s["tani"]["bolutleme"],
        "nesne": s["tani"]["nesne"],
        "eslestirme": s["tani"]["eslestirme"],
    }
    if yaz:
        from . import cizim as _c
        cv2.imwrite("/tmp/sinama_kamera.jpg", kamera, [cv2.IMWRITE_JPEG_QUALITY, 90])
        t.gorsel_kaydet(s, "/tmp/sinama_gorsel.jpg")
        Dp = t._duzlem(tuple(s["kare_boyu"]))
        ortho, mmf = _c.ustten_gorunum(kamera, Dp, px_mm=2.0)
        nesneler_gorsel = s.pop("_nesneler", None)
        if nesneler_gorsel:
            ortho = _c.ustten_tespitler(ortho, mmf, nesneler_gorsel,
                                        s["_kararlar"], px_mm=2.0, yatak_mm=YATAK)
            s.pop("_kararlar", None)
        cv2.imwrite("/tmp/sinama_ustten.jpg", ortho, [cv2.IMWRITE_JPEG_QUALITY, 90])
        rapor["cikti"] = ["/tmp/sinama_kamera.jpg", "/tmp/sinama_gorsel.jpg",
                          "/tmp/sinama_ustten.jpg"]
    return rapor


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--filiz", type=int, default=10)
    p.add_argument("--yabani", type=int, default=6)
    p.add_argument("--egim", type=float, default=0.45)
    p.add_argument("--gurultu", type=int, default=8)
    p.add_argument("--tohum", type=int, default=7)
    a = p.parse_args()
    print(json.dumps(calistir(a.filiz, a.yabani, a.egim, a.gurultu, a.tohum),
                     indent=2, ensure_ascii=False, default=str))
