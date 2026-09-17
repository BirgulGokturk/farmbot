#!/usr/bin/env python3
"""ADIM 6 — Filiz tespitlerini makine X,Y (mm) koordinatına çevirir, daire içine alıp çizer.

Kendi YOLO kodunuzdan içe aktarma:
    from donusum import KameraDonusum
    from filiz_koordinat import tespitleri_mm
    d = KameraDonusum()
    sonuc = tespitleri_mm(kutular, d, (w, h), kaynak="ham")   # kutular: [(x1,y1,x2,y2,guven), ...]

Komut satırı (tespitler JSON dosyasından):
    python3 filiz_koordinat.py --foto kare.jpg --tespit tespit.json --kaynak ham
    python3 filiz_koordinat.py --foto kare.jpg --tespit tespit.json --bitkiler ekilenler.csv

tespit.json biçimi: [{"x1":..,"y1":..,"x2":..,"y2":..,"guven":0.9}, ...]  ya da  [[x1,y1,x2,y2,guven], ...]
ekilenler.csv biçimi: x_mm,y_mm[,ad]   (sunucudaki ekim kaydı) -> her tespitin en yakın ekime sapmasını raporlar
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import cv2
import numpy as np

import ortak
from donusum import KameraDonusum


def _kutu(t):
    if isinstance(t, dict):
        return float(t["x1"]), float(t["y1"]), float(t["x2"]), float(t["y2"]), float(t.get("guven", t.get("conf", 1.0)))
    t = list(t)
    return float(t[0]), float(t[1]), float(t[2]), float(t[3]), float(t[4]) if len(t) > 4 else 1.0


def tespitleri_mm(tespitler, d: KameraDonusum, boyut, kaynak="ham", nokta="merkez", yukseklik_mm=0.0):
    """Kutuları mm'ye çevirir.

    nokta="merkez": kutu merkezi (tepeden bakan kamerada küçük filiz için uygun)
    nokta="alt"   : kutunun alt-orta noktası (eğik kamerada gövde dibine daha yakın)
    yukseklik_mm  : seçilen noktanın topraktan yüksekliği (ör. filiz tepesi için 20). 0 = toprak düzlemi.
    """
    kutular = [_kutu(t) for t in tespitler]
    if not kutular:
        return []
    k = np.array(kutular)
    if nokta == "merkez":
        pts = np.c_[(k[:, 0] + k[:, 2]) / 2, (k[:, 1] + k[:, 3]) / 2]
    elif nokta == "alt":
        pts = np.c_[(k[:, 0] + k[:, 2]) / 2, k[:, 3]]
    else:
        raise ValueError("nokta 'merkez' ya da 'alt' olmalı")
    mm = d.piksel_to_mm(pts, boyut, kaynak=kaynak, yukseklik_mm=yukseklik_mm)
    # kutunun mm cinsinden yaklaşık çapı (köşeleri de dönüştürerek)
    kose = np.vstack([k[:, [0, 1]], k[:, [2, 1]], k[:, [2, 3]], k[:, [0, 3]]])
    kmm = d.piksel_to_mm(kose, boyut, kaynak=kaynak).reshape(4, -1, 2)
    cap = (np.linalg.norm(kmm[0] - kmm[2], axis=1) + np.linalg.norm(kmm[1] - kmm[3], axis=1)) / 2 / np.sqrt(2)
    return [{"piksel": [float(p[0]), float(p[1])], "kutu": list(map(float, kb[:4])), "guven": float(kb[4]),
             "x_mm": float(m[0]), "y_mm": float(m[1]), "cap_mm": float(c)}
            for p, kb, m, c in zip(pts, kutular, mm, cap)]


def ciz(img, sonuc, d, kaynak, izgara=True):
    h, w = img.shape[:2]
    out = img.copy()
    if izgara:
        yatak = (d.dis_bilgi or {}).get("yatak_mm") or {"x": [0, 540], "y": [0, 645]}
        out = d.izgara_ciz(out, kaynak, 50.0, yatak["x"], yatak["y"], renk=(0, 200, 255))
    kal = max(1, w // 1000)
    for s in sonuc:
        x1, y1, x2, y2 = s["kutu"]
        r = int(max(x2 - x1, y2 - y1) * 0.6) + 2 * kal
        c = (int(round(s["piksel"][0])), int(round(s["piksel"][1])))
        cv2.circle(out, c, r, (0, 255, 0), 2 * kal, cv2.LINE_AA)
        cv2.circle(out, c, 2 * kal, (0, 0, 255), -1)
        cv2.putText(out, f"{s['x_mm']:.0f},{s['y_mm']:.0f}", (c[0] + r, c[1]), cv2.FONT_HERSHEY_SIMPLEX,
                    0.5 * kal, (255, 255, 255), kal, cv2.LINE_AA)
    return out


def ekimle_karsilastir(sonuc, ekilen, esik_mm=30.0):
    """Her ekime en yakın tespiti (en fazla esik_mm) eşler; dX, dY döndürür."""
    if not sonuc or not ekilen:
        return []
    T = np.array([[s["x_mm"], s["y_mm"]] for s in sonuc])
    eslesme, kullanilan = [], set()
    ciftler = sorted(((np.linalg.norm(T[j] - np.array(e[:2])), i, j)
                      for i, e in enumerate(ekilen) for j in range(len(T))))
    goruldu = set()
    for dist, i, j in ciftler:
        if dist > esik_mm or i in goruldu or j in kullanilan:
            continue
        goruldu.add(i)
        kullanilan.add(j)
        e = ekilen[i]
        eslesme.append({"ad": e[2], "ekim": e[:2], "tespit": T[j].tolist(),
                        "dX": float(T[j][0] - e[0]), "dY": float(T[j][1] - e[1]), "mesafe": float(dist)})
    return eslesme


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--foto", required=True)
    ap.add_argument("--tespit", required=True)
    ap.add_argument("--kaynak", choices=["ham", "duz"], default="ham",
                    help="tespitler ham karede mi, duzelt() çıktısında mı yapıldı")
    ap.add_argument("--nokta", choices=["merkez", "alt"], default="merkez")
    ap.add_argument("--yukseklik-mm", type=float, default=0.0)
    ap.add_argument("--bitkiler", help="ekilenler CSV: x_mm,y_mm[,ad]")
    ap.add_argument("--cikti", default=str(ortak.VERI / "filiz_sonuc"))
    a = ap.parse_args()

    d = KameraDonusum()
    img = ortak.resim_oku(a.foto)
    if a.kaynak == "duz":
        print("Not: --kaynak duz seçildi; --foto olarak duzelt() çıktısını verin.")
    tespit = json.loads(Path(a.tespit).read_text(encoding="utf-8"))
    boyut = (img.shape[1], img.shape[0])
    sonuc = tespitleri_mm(tespit, d, boyut, a.kaynak, a.nokta, a.yukseklik_mm)
    for i, s in enumerate(sonuc):
        print(f"  filiz {i:2d}: X {s['x_mm']:7.1f} mm  Y {s['y_mm']:7.1f} mm  çap≈{s['cap_mm']:.0f} mm  güven {s['guven']:.2f}")

    rapor = {"foto": a.foto, "kaynak": a.kaynak, "nokta": a.nokta, "yukseklik_mm": a.yukseklik_mm, "filizler": sonuc}
    if a.bitkiler:
        ekilen = []
        with open(a.bitkiler, encoding="utf-8") as f:
            for satir in csv.reader(f):
                if not satir or satir[0].strip().lower().startswith(("x", "#")):
                    continue
                ekilen.append([float(satir[0]), float(satir[1]), satir[2] if len(satir) > 2 else str(len(ekilen))])
        es = ekimle_karsilastir(sonuc, ekilen)
        rapor["ekim_karsilastirma"] = es
        if es:
            dx = np.array([e["dX"] for e in es])
            dy = np.array([e["dY"] for e in es])
            m = np.array([e["mesafe"] for e in es])
            print(f"\nEkim kaydıyla eşleşen: {len(es)}/{len(ekilen)}")
            print(f"  ortalama dX {dx.mean():+.1f} mm, dY {dy.mean():+.1f} mm  (sistematik kayma)")
            print(f"  mesafe ortanca {np.median(m):.1f} mm, en büyük {m.max():.1f} mm")
        else:
            print("Ekim kaydıyla eşleşen tespit yok (30 mm içinde).")

    Path(a.cikti).parent.mkdir(parents=True, exist_ok=True)
    Path(a.cikti + ".json").write_text(json.dumps(rapor, ensure_ascii=False, indent=2), encoding="utf-8")
    cv2.imwrite(a.cikti + ".jpg", ciz(img, sonuc, d, a.kaynak))
    print(f"\nKaydedildi: {a.cikti}.json, {a.cikti}.jpg")


if __name__ == "__main__":
    try:
        main()
    except ortak.KalibHata as e:
        sys.exit(f"HATA: {e}")
