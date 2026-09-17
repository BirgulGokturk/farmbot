#!/usr/bin/env python3
"""Kurulum doğrulaması — gerçek kamera olmadan tüm zinciri bilinen doğruyla test eder.

Distorsiyonlu, ~35° eğik sanal bir kamera üretir; ChArUco fotoğrafları ve üzerinde
4 AprilTag + 1 kontrol etiketi + yeşil "filizler" olan bir yatak görüntüsü çizer;
sonra 3_ic_kalibrasyon.py, 4_etiket_kalibrasyon.py ve filiz_koordinat.py'yi GERÇEK
komut satırı olarak çalıştırır ve bulunan mm koordinatlarını doğruyla karşılaştırır.

    python3 test_sentetik.py            # 1-3 dakika sürer; çıktılar geçici klasöre gider
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

KLASOR = Path(__file__).resolve().parent
RNG = np.random.default_rng(7)

W, H = 1920, 1440
K = np.array([[1500.0, 0, 968.0], [0, 1500.0, 713.0], [0, 0, 1]])
DIST = np.array([-0.32, 0.14, 0.0006, -0.0004, -0.03])


def isinlar():
    u, v = np.meshgrid(np.arange(W, dtype=np.float64), np.arange(H, dtype=np.float64))
    p = np.stack([u.ravel(), v.ravel()], 1).reshape(-1, 1, 2)
    n = cv2.undistortPointsIter(p, K, DIST, None, None, (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 40, 1e-9))
    n = n.reshape(-1, 2)
    return np.c_[n, np.ones(len(n))]


def ciz_duzlem(isin, R, t, doku, mm_to_doku):
    """Dünya düzlemi Z=0 üzerindeki dokuyu distorsiyonlu kameradan görüntüler."""
    C = -R.T @ t
    d = isin @ R                       # dünya yönleri
    s = -C[2] / d[:, 2]
    P = C[None, :2] + s[:, None] * d[:, :2]
    uv = mm_to_doku(P)
    uv[s <= 0] = -1e6
    mx = uv[:, 0].reshape(H, W).astype(np.float32)
    my = uv[:, 1].reshape(H, W).astype(np.float32)
    img = cv2.remap(doku, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(90, 90, 90))
    img = cv2.GaussianBlur(img, (3, 3), 0.6)
    gurultu = RNG.normal(0, 2.0, img.shape)
    return np.clip(img.astype(np.float64) + gurultu, 0, 255).astype(np.uint8)


def bak(C, hedef, ust=np.array([0, 1.0, 0])):
    z = hedef - C
    z /= np.linalg.norm(z)
    x = np.cross(ust, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    R = np.stack([x, y, z])
    return R, -R @ C


def calistir(*arg):
    r = subprocess.run([sys.executable, *arg], cwd=KLASOR, capture_output=True, text=True, env=os.environ.copy())
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise SystemExit(f"BAŞARISIZ: {arg[0]}")
    return r.stdout


def main():
    tmp = Path(tempfile.mkdtemp(prefix="goru_kalib_test_"))
    os.environ["GORU_KALIB_VERI"] = str(tmp)
    print(f"Geçici klasör: {tmp}")
    isin = isinlar()

    # ---------------- 1) ChArUco fotoğrafları
    calistir("1_tahta_olustur.py", "--kagit", "A3")
    ayar = json.loads((tmp / "tahta.json").read_text())
    sayfa = cv2.imread(str(tmp / "charuco_A3.png"))
    ppm0 = 300 / 25.4
    tw, th = int(round(ayar["kare_x"] * ayar["kare_mm"] * ppm0)), int(round(ayar["kare_y"] * ayar["kare_mm"] * ppm0))
    ox, oy = (sayfa.shape[1] - tw) // 2, (sayfa.shape[0] - th) // 2
    ppm = 4.0
    doku = cv2.resize(sayfa, None, fx=ppm / ppm0, fy=ppm / ppm0, interpolation=cv2.INTER_AREA)
    oxm, oym = ox / ppm0, oy / ppm0
    bw, bh = ayar["kare_x"] * ayar["kare_mm"], ayar["kare_y"] * ayar["kare_mm"]

    klasor = tmp / "ic_fotolar"
    klasor.mkdir()
    n = 0
    hedefler = [(gx, gy) for gx in np.linspace(-0.42, 0.42, 5) for gy in np.linspace(-0.40, 0.40, 4)]
    for i, (gx, gy) in enumerate(hedefler + hedefler[::3]):
        Z = RNG.uniform(650, 1000)
        P = np.array([gx * W / K[0, 0] * Z, gy * H / K[1, 1] * Z, Z])
        ax, ay, az = np.radians(RNG.uniform(-40, 40)), np.radians(RNG.uniform(-40, 40)), np.radians(RNG.uniform(-25, 25))
        R = cv2.Rodrigues(np.array([ax, ay, 0.0]))[0] @ cv2.Rodrigues(np.array([0, 0, az]))[0]
        merkez = np.array([bw / 2, bh / 2, 0])
        t = P - R @ merkez
        img = ciz_duzlem(isin, R, t, doku, lambda Pm: (Pm + [oxm, oym]) * ppm)
        cv2.imwrite(str(klasor / f"foto_{n:03d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        n += 1
    print(f"{n} sentetik ChArUco fotoğrafı üretildi.")
    out = calistir("3_ic_kalibrasyon.py")
    ic = json.loads((tmp / "kamera_ic.json").read_text())
    Kb, Db = np.array(ic["K"]), np.array(ic["dist"])
    # distorsiyon doğruluğu: kadraj genelinde düzeltilmiş nokta farkı (piksel)
    g = np.stack(np.meshgrid(np.linspace(0, W - 1, 25), np.linspace(0, H - 1, 19)), -1).reshape(-1, 1, 2)
    kr = (cv2.TERM_CRITERIA_COUNT | cv2.TERM_CRITERIA_EPS, 60, 1e-9)
    a1 = cv2.undistortPointsIter(g, K, DIST, None, K, kr).reshape(-1, 2)
    a2 = cv2.undistortPointsIter(g, Kb, Db, None, Kb, kr).reshape(-1, 2)
    # ölçek/ötelenme farkı homografiyle zaten emilir; önemli olan kalan (düz çizgiyi büken) hata
    Hh, _ = cv2.findHomography(a2, a1, 0)
    a2 = cv2.perspectiveTransform(a2.reshape(-1, 1, 2), Hh).reshape(-1, 2)
    print(f"[İç] RMS {ic['rms_px']:.3f} px | fx {Kb[0,0]:.1f} (doğru 1500) cx {Kb[0,2]:.1f} (968) cy {Kb[1,2]:.1f} (713)")
    print(f"[İç] düzeltme sonrası kalan bükülme (homografiyle giderilemeyen): ortalama {np.linalg.norm(a1-a2,axis=1).mean():.2f} px, en büyük {np.linalg.norm(a1-a2,axis=1).max():.2f} px")

    # ---------------- 2) Yatak sahnesi (sağ elli makine ekseni, kamera yatağın dışından eğik)
    x0, y1 = -250.0, 900.0              # dokunun sol-üst köşesi (mm)  -> doku yukarıdan bakınca doğru görünür
    dW, dH = int(1050 * ppm), int(1200 * ppm)
    yatak = np.full((dH, dW, 3), (40, 60, 85), np.uint8)
    yatak = np.clip(yatak.astype(int) + RNG.integers(-12, 12, (dH, dW, 1)), 0, 255).astype(np.uint8)

    def mm2doku(Pm):
        return np.c_[(Pm[:, 0] - x0) * ppm, (y1 - Pm[:, 1]) * ppm]

    sozluk = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_APRILTAG_36h11)
    kenar = 60.0
    etiketler = {0: (55, 50, 0.0), 1: (485, 55, 3.0), 8: (50, 595, -2.0), 9: (490, 590, 90.0), 5: (270, 330, 10.0)}
    for i, (ex, ey, aci) in etiketler.items():
        kpx = int(round(kenar * ppm))
        m = cv2.aruco.generateImageMarker(sozluk, i, kpx, borderBits=1)
        pay = int(10 * ppm)
        kagit = cv2.copyMakeBorder(m, pay, pay, pay, pay, cv2.BORDER_CONSTANT, value=255)
        kagit = cv2.cvtColor(kagit, cv2.COLOR_GRAY2BGR)
        s = kagit.shape[0]
        c = mm2doku(np.array([[ex, ey]]))[0]
        M = cv2.getRotationMatrix2D((s / 2, s / 2), aci, 1.0)   # görüntüde saat yönü tersine = yukarıdan bakınca CCW
        M[:, 2] += c - s / 2
        maske = cv2.warpAffine(np.full((s, s), 255, np.uint8), M, (dW, dH))
        kag = cv2.warpAffine(kagit, M, (dW, dH), flags=cv2.INTER_LINEAR)
        yatak[maske > 128] = kag[maske > 128]
    filizler = [(x, y) for x in (130, 200, 270, 340, 410) for y in (150, 250, 420, 520)]
    filizler += [(20, 320), (520, 320), (270, 630), (270, 15)]      # kenarlara yakın
    for fx, fy in filizler:
        c = mm2doku(np.array([[fx, fy]]))[0]
        cv2.circle(yatak, tuple(np.round(c).astype(int)), int(7 * ppm), (40, 200, 60), -1, cv2.LINE_AA)
    yatak = cv2.GaussianBlur(yatak, (0, 0), 1.0)

    Cc = np.array([270.0, -330.0, 820.0])
    R, t = bak(Cc, np.array([270.0, 330.0, 0.0]), ust=np.array([0, 0, 1.0]))
    R = np.stack([-R[0], -R[1], R[2]])     # 180° döndür: görüntüde yukarı = +Y yönü
    t = -R @ Cc
    ham = ciz_duzlem(isin, R, t, yatak, mm2doku)
    cv2.imwrite(str(tmp / "yatak_1.jpg"), ham, [cv2.IMWRITE_JPEG_QUALITY, 95])
    print(f"[Sahne] kamera eğimi {np.degrees(np.arccos(abs((R.T@[0,0,1])[2]))):.1f}°, yükseklik {Cc[2]:.0f} mm")

    # probla ölçüm gürültüsü ±0.3 mm
    et = {"kenar_mm_varsayilan": kenar, "yatak_mm": {"x": [0, 540], "y": [0, 645]}, "etiketler": []}
    for i, (ex, ey, _) in etiketler.items():
        et["etiketler"].append({"id": i, "rol": "kontrol" if i == 5 else "referans",
                                "merkez_mm": [ex + RNG.uniform(-0.3, 0.3), ey + RNG.uniform(-0.3, 0.3)], "kenar_mm": None})
    (tmp / "etiketler.json").write_text(json.dumps(et))
    out = calistir("4_etiket_kalibrasyon.py", "--foto", str(tmp / "yatak_1.jpg"), "--etiketler", str(tmp / "etiketler.json"))
    print("\n".join("  " + s for s in out.splitlines() if s.strip()))

    # ---------------- 3) Filiz tespiti (basit yeşil eşik — sizin YOLO'nuzun yerine)
    def yesil_kutular(img):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        m = cv2.inRange(hsv, (40, 80, 60), (85, 255, 255))
        n, _, st, _ = cv2.connectedComponentsWithStats(m)
        return [[int(x), int(y), int(x + w), int(y + h), 1.0] for x, y, w, h, a in st[1:] if a > 15]

    sys.path.insert(0, str(KLASOR))
    from donusum import KameraDonusum
    from filiz_koordinat import tespitleri_mm
    d = KameraDonusum()

    def eslestir(mm):
        dogru = np.array(filizler, float)
        hata = []
        for p in mm:
            j = np.argmin(np.linalg.norm(dogru - p, axis=1))
            hata.append(np.linalg.norm(dogru[j] - p))
        return np.array(hata)

    kutular = yesil_kutular(ham)
    tespit_json = tmp / "tespit.json"
    tespit_json.write_text(json.dumps(kutular))
    calistir("filiz_koordinat.py", "--foto", str(tmp / "yatak_1.jpg"), "--tespit", str(tespit_json))
    sonuc = tespitleri_mm(kutular, d, (W, H), "ham")
    yeni = eslestir(np.array([[s["x_mm"], s["y_mm"]] for s in sonuc]))
    print(f"\n[Filiz] {len(sonuc)}/{len(filizler)} filiz; YENİ zincir hata: ortalama {yeni.mean():.2f} mm, en büyük {yeni.max():.2f} mm")

    # Aynı karenin 960x720 hali (ölçekleme)
    kucuk = cv2.resize(ham, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
    kk = yesil_kutular(kucuk)
    sk = tespitleri_mm(kk, d, (W // 2, H // 2), "ham")
    hk = eslestir(np.array([[s["x_mm"], s["y_mm"]] for s in sk]))
    print(f"[Filiz] 960x720 karede: {len(sk)} filiz; hata ortalama {hk.mean():.2f} mm, en büyük {hk.max():.2f} mm")

    # Düzeltilmiş kare üzerinde tespit
    duz = d.duzelt(ham)
    kd = yesil_kutular(duz)
    sd = tespitleri_mm(kd, d, (W, H), "duz")
    hd = eslestir(np.array([[s["x_mm"], s["y_mm"]] for s in sd]))
    print(f"[Filiz] düzeltilmiş karede tespit: {len(sd)} filiz; hata ortalama {hd.mean():.2f} mm, en büyük {hd.max():.2f} mm")

    # ESKİ yöntem: distorsiyon düzeltmesi yok, 4 merkezle tek dönüşüm
    import ortak
    ham_et = ortak.etiketleri_bul(ham)
    ref = [0, 1, 8, 9]
    src = np.array([ortak.kosegen_kesisimi(ham_et[i]) for i in ref])
    dst = np.array([e["merkez_mm"] for e in et["etiketler"] if e["id"] in ref])
    He = cv2.getPerspectiveTransform(src.astype(np.float32), dst.astype(np.float32))
    pts = np.array([[(k[0] + k[2]) / 2, (k[1] + k[3]) / 2] for k in kutular])
    eski = eslestir(ortak.homografi_uygula(He, pts))
    print(f"[Filiz] ESKİ yöntem (undistort yok, 4 merkez): ortalama {eski.mean():.2f} mm, en büyük {eski.max():.2f} mm")

    # Yükseklik düzeltmesi: toprak üstünde 25 mm'deki noktalar
    h = 25.0
    P3 = np.array([[x, y, h] for x, y in filizler])
    proj, _ = cv2.projectPoints(P3, cv2.Rodrigues(R)[0], t, K, DIST)
    duzeltmesiz = np.linalg.norm(d.piksel_to_mm(proj.reshape(-1, 2), (W, H), "ham", 0.0) - P3[:, :2], axis=1)
    duzeltmeli = np.linalg.norm(d.piksel_to_mm(proj.reshape(-1, 2), (W, H), "ham", h) - P3[:, :2], axis=1)
    print(f"[Yükseklik] 25 mm yukarıdaki nokta: düzeltmesiz ortalama {duzeltmesiz.mean():.1f} mm, "
          f"yukseklik_mm=25 ile ortalama {duzeltmeli.mean():.2f} mm")

    # mm->piksel->mm gidiş dönüş
    geri = d.piksel_to_mm(d.mm_to_piksel(np.array(filizler, float), (W, H), "ham"), (W, H), "ham")
    print(f"[Gidiş-dönüş] mm->ham piksel->mm en büyük fark {np.abs(geri - np.array(filizler)).max():.4f} mm")

    iyi = yeni.max() < 2.0 and hk.max() < 3.0 and hd.max() < 2.0
    print(f"\nSONUÇ: {'GEÇTİ' if iyi else 'KALDI'}   (çıktılar: {tmp})")
    sys.exit(0 if iyi else 1)


if __name__ == "__main__":
    main()
