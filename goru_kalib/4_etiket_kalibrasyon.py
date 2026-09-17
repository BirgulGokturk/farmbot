#!/usr/bin/env python3
"""ADIM 4 — Düzeltilmiş görüntüde 4 AprilTag × 4 köşe = 16 noktalı homografi.

    python3 4_etiket_kalibrasyon.py --foto kalib_veri/yatak_1.jpg [--foto kalib_veri/yatak_2.jpg ...]
    python3 4_etiket_kalibrasyon.py --cek picamera2 --adet 5       # kamerayla 5 kare çekip ortalar

Akış:
  1. Her kare kamera_ic.json ile düzeltilir (undistort).
  2. Düzeltilmiş karede etiketler ve 4'er köşesi alt-piksel hassasiyetle bulunur (birden çok kare varsa köşeler ortalanır).
  3. Her köşenin makine koordinatı etiketler.json'dan hesaplanır:
       - "koseler_mm" girilmişse doğrudan o ölçüler (sıra önemsiz, otomatik eşlenir),
       - yoksa probla ölçülen merkez + kumpasla ölçülen kenar uzunluğu + görüntüden bulunan etiket yönü.
  4. 16 nokta ile cv2.findHomography (en küçük kareler). getPerspectiveTransform yalnız tam 4 nokta
     kabul ettiği için 16 noktada findHomography kullanılır; 4 noktada ikisi aynı sonucu verir.
  5. Rapor: nokta başına mm artık hata, bir-etiket-dışarıda çapraz doğrulama, kontrol etiketleri,
     kamera yüksekliği ve eğimi (solvePnP) — metreyle karşılaştırılabilir.

Çıktı: kalib_veri/kamera_dis.json, kalib_veri/dis_rapor.txt, kalib_veri/dis_kontrol.jpg
"""
import argparse
import importlib.util
import itertools
import sys
from pathlib import Path

import cv2
import numpy as np

import ortak
from donusum import KameraDonusum

# OpenCV köşe sırası (etiketin kendi çerçevesinde): sol-üst, sağ-üst, sağ-alt, sol-alt
KANONIK = np.array([[-1, 1], [1, 1], [1, -1], [-1, -1]], dtype=np.float64) / 2.0


def etiket_ayar_oku(yol):
    veri = ortak.json_oku(yol)
    varsayilan = veri.get("kenar_mm_varsayilan")
    liste = []
    eksik = []
    for e in veri["etiketler"]:
        rol = e.get("rol", "referans")
        if rol not in ("referans", "kontrol", "yok"):
            raise ortak.KalibHata(f"Etiket {e['id']}: rol 'referans', 'kontrol' ya da 'yok' olmalı.")
        if rol == "yok":
            continue
        m = e.get("merkez_mm")
        if not m or any(v is None for v in m):
            eksik.append(f"id {e['id']} merkez_mm")
            continue
        k = e.get("kenar_mm")
        if k is None:
            k = varsayilan
        kos = e.get("koseler_mm")
        if rol == "referans" and kos is None and k is None:
            eksik.append(f"id {e['id']} kenar_mm (ya da kenar_mm_varsayilan veya koseler_mm)")
            continue
        if kos is not None and (len(kos) != 4 or any(v is None for p in kos for v in p)):
            raise ortak.KalibHata(f"Etiket {e['id']}: koseler_mm 4 adet [x, y] olmalı.")
        liste.append({"id": int(e["id"]), "rol": rol, "merkez": np.array(m, float),
                      "kenar": None if k is None else float(k),
                      "koseler": None if kos is None else np.array(kos, float)})
    if eksik:
        raise ortak.KalibHata("etiketler.json'da ölçülmemiş alanlar var (uydurma değer kullanılmaz):\n  - " + "\n  - ".join(eksik))
    ref = [e for e in liste if e["rol"] == "referans"]
    if len(ref) < 4:
        raise ortak.KalibHata(f"En az 4 referans etiket gerekli, {len(ref)} var.")
    return veri, liste


def kareler_al(a, d: KameraDonusum):
    kareler = []
    if a.cek:
        yol = Path(__file__).with_name("2_foto_cek.py")
        spec = importlib.util.spec_from_file_location("foto_cek", yol)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        W, H = d.ref_boyut
        kam = mod.Kamera(a.cek, W, H, a.lens_konumu)
        try:
            for i in range(a.adet):
                p = ortak.VERI / f"yatak_{i+1}.jpg"
                kareler.append((p.name, kam.cek(p)))
        finally:
            kam.kapat()
    for f in a.foto or []:
        kareler.append((Path(f).name, ortak.resim_oku(f)))
    if not kareler:
        raise ortak.KalibHata("--foto ya da --cek verilmeli.")
    return kareler


def koseleri_topla(kareler, d):
    toplam: dict[int, list] = {}
    duz0 = None
    for ad, img in kareler:
        if (img.shape[1], img.shape[0]) != d.ref_boyut:
            raise ortak.KalibHata(f"{ad} {img.shape[1]}x{img.shape[0]}; iç kalibrasyon {d.ref_boyut[0]}x{d.ref_boyut[1]}. "
                                  "Homografi kalibrasyonu iç kalibrasyonla aynı çözünürlükte yapılmalı.")
        duz = d.duzelt(img)
        duz0 = duz if duz0 is None else duz0
        bulunan = ortak.etiketleri_bul(duz)
        print(f"  {ad}: bulunan etiketler {sorted(bulunan)}")
        for i, k in bulunan.items():
            toplam.setdefault(i, []).append(k)
    ort = {}
    sapma = {}
    for i, ks in toplam.items():
        ks = np.stack(ks)
        ort[i] = ks.mean(axis=0)
        sapma[i] = float(np.abs(ks - ort[i]).max()) if len(ks) > 1 else None
    return ort, sapma, duz0, len(kareler)


def dunya_koseleri(e, p_kaba):
    """p_kaba: kaba homografiyle (merkezlerden) mm'ye taşınmış 4 görüntü köşesi."""
    c = e["merkez"]
    if e["koseler"] is not None:
        en_iyi = min(itertools.permutations(range(4)),
                     key=lambda perm: np.linalg.norm(e["koseler"][list(perm)] - p_kaba, axis=1).sum())
        w = e["koseler"][list(en_iyi)]
        return w, {"kaynak": "probla ölçülen köşeler",
                   "eslesme_mm": float(np.linalg.norm(w - p_kaba, axis=1).max())}
    s = e["kenar"]
    q = KANONIK * s
    A = (p_kaba - c).T @ q
    U, _, Vt = np.linalg.svd(A)
    M = U @ Vt                                     # dönme (+ gerekirse ayna): makine eksen yönünü otomatik yakalar
    w = c + (M @ q.T).T
    kenar_goruntu = float(np.mean(np.linalg.norm(p_kaba - np.roll(p_kaba, -1, axis=0), axis=1)))
    return w, {"kaynak": "merkez + kenar + görüntüden yön",
               "aci_derece": float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))),
               "ayna": bool(np.linalg.det(M) < 0),
               "kenar_girilen_mm": s, "kenar_goruntuden_mm": kenar_goruntu,
               "kare_uyum_mm": float(np.linalg.norm(w - p_kaba, axis=1).max())}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--foto", action="append")
    ap.add_argument("--cek", help="picamera2 | rpicam | opencv:0")
    ap.add_argument("--adet", type=int, default=5)
    ap.add_argument("--lens-konumu", type=float)
    ap.add_argument("--etiketler", default=str(ortak.ETIKET_DOSYA))
    a = ap.parse_args()

    d = KameraDonusum(dis_yol=None)
    ayar_veri, etiketler = etiket_ayar_oku(a.etiketler)
    kareler = kareler_al(a, d)
    goruntu_kose, sapma, duz, n_kare = koseleri_topla(kareler, d)

    ref = [e for e in etiketler if e["rol"] == "referans"]
    kontrol = [e for e in etiketler if e["rol"] == "kontrol"]
    eksik = [e["id"] for e in ref if e["id"] not in goruntu_kose]
    if eksik:
        raise ortak.KalibHata(f"Referans etiket(ler) görüntüde bulunamadı: {eksik}. Bulunanlar: {sorted(goruntu_kose)}. "
                              "Etiket gölgede/parlamada mı, tamamı kadrajda mı, kâğıt düz mü?")

    # --- kaba homografi: yalnız merkezler (sadece köşe yönünü bulmak için)
    merkez_img = np.array([ortak.kosegen_kesisimi(goruntu_kose[e["id"]]) for e in ref])
    merkez_mm = np.array([e["merkez"] for e in ref])
    H_kaba, _ = cv2.findHomography(merkez_img, merkez_mm, 0)
    if H_kaba is None:
        raise ortak.KalibHata("Merkezlerden homografi kurulamadı; merkez_mm değerleri aynı doğru üzerinde olabilir.")

    img_pts, mm_pts, sahip, bilgi = [], [], [], {}
    for e in ref:
        p_kaba = ortak.homografi_uygula(H_kaba, goruntu_kose[e["id"]])
        w, b = dunya_koseleri(e, p_kaba)
        img_pts.append(goruntu_kose[e["id"]])
        mm_pts.append(w)
        sahip += [e["id"]] * 4
        bilgi[e["id"]] = b
    img_pts = np.vstack(img_pts)
    mm_pts = np.vstack(mm_pts)
    sahip = np.array(sahip)
    aynalar = {b["ayna"] for b in bilgi.values() if "ayna" in b}
    if len(aynalar) > 1:
        raise ortak.KalibHata("Etiketlerin bir kısmı aynalı görünüyor: merkez_mm'lerden birinde X/Y yer değiştirmiş olabilir.")

    # --- 16 noktalı homografi
    H, _ = cv2.findHomography(img_pts, mm_pts, 0)
    tahmin = ortak.homografi_uygula(H, img_pts)
    artik = np.linalg.norm(tahmin - mm_pts, axis=1)
    rms_mm = float(np.sqrt(np.mean(artik ** 2)))

    # --- bir etiket dışarıda çapraz doğrulama: 12 noktayla kur, dışarıdaki etiketin probla ölçülen merkezini tahmin et
    cv_hata = {}
    for e in ref:
        m = sahip != e["id"]
        Hc, _ = cv2.findHomography(img_pts[m], mm_pts[m], 0)
        t = ortak.homografi_uygula(Hc, [ortak.kosegen_kesisimi(goruntu_kose[e["id"]])])[0]
        cv_hata[e["id"]] = (t - e["merkez"], float(np.linalg.norm(t - e["merkez"])))

    kontrol_hata = {}
    for e in kontrol:
        if e["id"] not in goruntu_kose:
            kontrol_hata[e["id"]] = None
            continue
        t = ortak.homografi_uygula(H, [ortak.kosegen_kesisimi(goruntu_kose[e["id"]])])[0]
        kontrol_hata[e["id"]] = (t - e["merkez"], float(np.linalg.norm(t - e["merkez"])))

    # --- kamera pozu (yükseklik/eğim) — düzeltilmiş görüntü, yeniK, distorsiyon yok
    obj3 = np.c_[mm_pts, np.zeros(len(mm_pts))]
    ok, rvec, tvec = cv2.solvePnP(obj3, img_pts, d.yeniK0, None, flags=cv2.SOLVEPNP_IPPE)
    if not ok:
        raise ortak.KalibHata("solvePnP başarısız.")
    rvec, tvec = cv2.solvePnPRefineLM(obj3, img_pts, d.yeniK0, None, rvec, tvec)
    izd, _ = cv2.projectPoints(obj3, rvec, tvec, d.yeniK0, None)
    pnp_px = float(np.sqrt(np.mean(np.sum((izd.reshape(-1, 2) - img_pts) ** 2, axis=1))))
    R, _ = cv2.Rodrigues(rvec)
    C = (-R.T @ tvec).ravel()
    eksen = R.T @ np.array([0, 0, 1.0])
    egim = float(np.degrees(np.arccos(abs(eksen[2]))))
    W, Hh = d.ref_boyut
    mm_px = []
    for u, v in [(W / 2, Hh / 2)]:
        p = ortak.homografi_uygula(H, [[u, v], [u + 1, v], [u, v + 1]])
        mm_px.append((np.linalg.norm(p[1] - p[0]), np.linalg.norm(p[2] - p[0])))

    # --- rapor
    S = [f"Kare sayısı: {n_kare}   çözünürlük: {W}x{Hh}   iç kalibrasyon RMS: {d.ic_bilgi['rms_px']:.3f} px", ""]
    S.append("ETİKETLER")
    for e in ref:
        b = bilgi[e["id"]]
        s = f"  id {e['id']:>3}: merkez ({e['merkez'][0]:.1f}, {e['merkez'][1]:.1f}) mm, {b['kaynak']}"
        if "aci_derece" in b:
            s += (f"\n           yön {b['aci_derece']:+.1f}°, kenar girilen {b['kenar_girilen_mm']:.2f} / görüntüden {b['kenar_goruntuden_mm']:.2f} mm"
                  f", kare uyumu {b['kare_uyum_mm']:.2f} mm")
        else:
            s += f"\n           ölçülen köşe ile görüntü uyumu {b['eslesme_mm']:.2f} mm"
        if sapma.get(e["id"]) is not None:
            s += f", kareler arası köşe titremesi {sapma[e['id']]:.2f} px"
        S.append(s)
    S += ["", "16 NOKTALI HOMOGRAFİ — nokta başına artık (mm)"]
    adlar = ["SolÜst", "SağÜst", "SağAlt", "SolAlt"]
    for i in range(0, len(artik), 4):
        S.append(f"  id {sahip[i]:>3}: " + "  ".join(f"{adlar[j]} {artik[i+j]:.2f}" for j in range(4)))
    S.append(f"  RMS {rms_mm:.2f} mm, en büyük {artik.max():.2f} mm")
    S += ["", "ÇAPRAZ DOĞRULAMA — etiket hesaba katılmadan merkezi tahmin edilince hata (mm)"]
    for i, (dv, n) in cv_hata.items():
        S.append(f"  id {i:>3}: dX {dv[0]:+.2f}  dY {dv[1]:+.2f}  |{n:.2f}|")
    if kontrol_hata:
        S += ["", "KONTROL ETİKETLERİ — homografiye katılmadı (mm)"]
        for i, v in kontrol_hata.items():
            S.append(f"  id {i:>3}: " + ("GÖRÜNMEDİ" if v is None else f"dX {v[0][0]:+.2f}  dY {v[0][1]:+.2f}  |{v[1]:.2f}|"))
    S += ["", "KAMERA POZU (solvePnP, metreyle karşılaştırın)",
          f"  kamera konumu: X {C[0]:.0f} mm, Y {C[1]:.0f} mm, toprak düzleminden yükseklik {abs(C[2]):.0f} mm",
          f"  optik eksenin düşeyle açısı: {egim:.1f}°",
          f"  poz yeniden izdüşüm hatası: {pnp_px:.2f} px",
          f"  görüntü merkezinde 1 piksel ≈ {mm_px[0][0]:.3f} mm (yatay) × {mm_px[0][1]:.3f} mm (dikey)", ""]
    uyari = []
    if rms_mm > 1.5:
        uyari.append(f"16 nokta RMS {rms_mm:.2f} mm. Etiketler aynı düzlemde değil, bir merkez yanlış ölçülmüş ya da kenar yanlış girilmiş olabilir.")
    kotu = [i for i, (dv, n) in cv_hata.items() if n > 3.0]
    if kotu:
        uyari.append(f"Çapraz doğrulamada 3 mm'yi aşan etiket(ler): {kotu}. Önce bu etiketlerin merkezini yeniden probla ölçün.")
    for i, b in bilgi.items():
        if "kenar_goruntuden_mm" in b and abs(b["kenar_goruntuden_mm"] - b["kenar_girilen_mm"]) > 0.05 * b["kenar_girilen_mm"]:
            uyari.append(f"id {i}: görüntüden bulunan kenar girilenden %5'ten fazla farklı. Kenar ölçüsünü ve merkez ölçümünü kontrol edin.")
    S += ["UYARI: " + u for u in uyari] or ["Uyarı yok."]
    rapor = "\n".join(S)
    print(rapor)

    ortak.json_yaz(ortak.DIS_DOSYA, {
        "tur": "kamera_dis", "goruntu_boyutu": list(d.ref_boyut), "ic_rms_px": d.ic_bilgi["rms_px"],
        "H_piksel_mm": H, "rvec": rvec.ravel(), "tvec": tvec.ravel(),
        "kamera_konum_mm": C, "egim_derece": egim, "rms_mm": rms_mm, "en_buyuk_mm": float(artik.max()),
        "capraz_dogrulama_mm": {str(i): n for i, (dv, n) in cv_hata.items()},
        "noktalar": {"piksel_duz": img_pts, "mm": mm_pts, "etiket": sahip},
        "yatak_mm": ayar_veri.get("yatak_mm"),
    })
    (ortak.VERI / "dis_rapor.txt").write_text(rapor, encoding="utf-8")

    # --- görsel kontrol
    d2 = KameraDonusum()
    yatak = ayar_veri.get("yatak_mm") or {"x": [0, 540], "y": [0, 645]}
    cizim = d2.izgara_ciz(duz, "duz", 50.0, yatak["x"], yatak["y"])
    kal = max(2, W // 900)
    geri = ortak.homografi_uygula(np.linalg.inv(H), mm_pts)
    for p, q in zip(img_pts, geri):
        cv2.circle(cizim, tuple(np.round(p).astype(int)), 5 * kal, (0, 255, 0), kal, cv2.LINE_AA)
        cv2.drawMarker(cizim, tuple(np.round(q).astype(int)), (0, 0, 255), cv2.MARKER_CROSS, 8 * kal, kal)
    for e in etiketler:
        if e["id"] in goruntu_kose:
            m = ortak.kosegen_kesisimi(goruntu_kose[e["id"]])
            cv2.putText(cizim, f"{e['id']} {e['rol'][0].upper()}", tuple(np.round(m).astype(int)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8 * kal, (255, 0, 255), kal, cv2.LINE_AA)
    olcek = min(1.0, 2000 / W)
    cv2.imwrite(str(ortak.VERI / "dis_kontrol.jpg"), cv2.resize(cizim, None, fx=olcek, fy=olcek))
    print(f"Kaydedildi: {ortak.DIS_DOSYA}\nGörsel kontrol: {ortak.VERI / 'dis_kontrol.jpg'} "
          "(sarı = 50 mm makine ızgarası, yeşil daire = bulunan köşe, kırmızı artı = homografinin koyduğu köşe)")


if __name__ == "__main__":
    try:
        main()
    except ortak.KalibHata as e:
        sys.exit(f"HATA: {e}")
