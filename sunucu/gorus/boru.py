"""
boru — elle ızgara + kuşbakışı + tespit + koordinat zinciri.

    kare ──► Izgara (elle köşeler) ──► kuşbakışı (warpPerspective)
                                            │
                                            ├─► tespit (YOLO ya da eşik)
                                            │
                                     ortho piksel ──► makine mm  (TAM dönüşüm)
                                            │
                                            ▼
                              gorus.tarama (eşleştirme, izleme,
                                            sınıflandırma, örtü, arşiv)

Tespit düzleştirilmiş görüntüde yapıldığı için koordinat dönüşümü ara değer
hesabı gerektirmez: ortho'da ölçek her yerde aynıdır.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import numpy as np
import cv2

from .izgara import Izgara
from .yolo import bolutleyici_sec, bulgulari_mm_yap, onerilen_px_mm


def kusbakisi_uret(kare, izgara: Izgara, px_mm=4.0, kenar_mm=0.0, lens=None):
    """
    Kareyi ızgaraya göre düzleştirir. Döner: (ortho, bilgi)

    lens: gorus.lens.Lens verilirse ÖNCE radyal bozulma giderilir. Sıra
    önemli — homografi lens bozulmasını soğuramaz (bkz. gorus/lens.py
    başındaki ölçüm tablosu). Lens verilecekse ızgara köşeleri de
    DÜZELTİLMİŞ karede tıklanmış olmalıdır.
    """
    bgr = kare if hasattr(kare, "shape") else cv2.imread(str(kare), cv2.IMREAD_COLOR)
    if bgr is None:
        raise FileNotFoundError(f"Kare okunamadı: {kare}")
    if lens is not None:
        bgr = lens.duzelt(bgr)
    boy = (bgr.shape[1], bgr.shape[0])
    ig = izgara if (izgara.kare_boyu is None or tuple(izgara.kare_boyu) == boy) \
        else izgara.olcekle(boy)
    ortho, bilgi = ig.kusbakisi(bgr, px_mm=px_mm, kenar_mm=kenar_mm)
    bilgi["kaynak_boyu"] = list(boy)
    bilgi["lens_duzeltildi"] = lens is not None
    bilgi["olcek_tavani"] = onerilen_px_mm(ig, boy)
    return ortho, bilgi


def tespit_et(ortho, bilgi, model_yolu=None, hef_yolu=None, bolutleyici=None,
              **kw) -> tuple[list[dict], dict]:
    """Kuşbakışı görüntüde tespit yapar ve sonucu makine mm'sine çevirir."""
    b = bolutleyici or bolutleyici_sec(model_yolu, hef_yolu,
                                       px_mm=bilgi["px_mm"], **kw)
    if not b.hazir:
        raise RuntimeError(f"Bölütleyici hazır değil: {b.sebep}")
    bulgular, tani = b.calistir(ortho)
    tespitler = bulgulari_mm_yap(bulgular, bilgi["ortho_to_mm"], bilgi["px_mm"])
    tani["sebep"] = getattr(b, "sebep", None)
    tani["tespit"] = len(tespitler)
    return tespitler, tani


def ortho_gorsel(ortho, bilgi, tespitler=None, kararlar=None, izgara_mm=50.0,
                 izgara_hucreleri: Izgara | None = None):
    """
    Kuşbakışı görüntü + mm ızgarası + tespitler. Kalibrasyonun gözle denetimi:
    ızgara çizgileri toprağa oturmalı, hücre sınırları arasında kopma olmamalı.
    """
    from . import cizim as _c
    img = ortho.copy()
    x0, y0, x1, y1 = bilgi["kapsam_mm"]
    m2o = bilgi["mm_to_ortho"]

    for x in np.arange(np.ceil(x0 / izgara_mm) * izgara_mm, x1, izgara_mm):
        a, b = m2o([[x, y0], [x, y1]])
        cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), (120, 110, 90), 1)
    for y in np.arange(np.ceil(y0 / izgara_mm) * izgara_mm, y1, izgara_mm):
        a, b = m2o([[x0, y], [x1, y]])
        cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), (120, 110, 90), 1)

    if izgara_hucreleri is not None:
        for h in izgara_hucreleri.hucreler:
            k = np.round(m2o(h.mm)).astype(np.int32)
            cv2.polylines(img, [k], True, (230, 200, 60), 2, cv2.LINE_AA)
            cv2.putText(img, h.ad, tuple(k[0] + 6), cv2.FONT_HERSHEY_SIMPLEX,
                        0.6, (230, 200, 60), 2, cv2.LINE_AA)

    if tespitler:
        kx = {k["tespit_id"]: k for k in (kararlar or [])}
        renk = {"filiz": (60, 220, 60), "yabani": (40, 60, 230),
                "belirsiz": (30, 200, 245)}
        yazi = []
        for t in tespitler:
            k = kx.get(t["id"], {})
            sinif = k.get("sinif", t.get("model_sinifi", "bitki"))
            c = renk.get(sinif, (200, 200, 200))
            o = m2o([[t["x_mm"], t["y_mm"]]])[0]
            r = int(max((t.get("cap_mm") or 0) * 0.85, 8.0) * bilgi["px_mm"])
            cv2.circle(img, (int(o[0]), int(o[1])), r, c, 2, cv2.LINE_AA)
            cv2.drawMarker(img, (int(o[0]), int(o[1])), c, cv2.MARKER_CROSS, 14, 1)
            etiket = f"#{t['id']} {sinif}"
            if k.get("skor") is not None:
                etiket += f" {k['skor']:.2f}"
            yazi.append((o[0] + r + 4, o[1] - 9,
                         f"{etiket}\nX{t['x_mm']:.0f} Y{t['y_mm']:.0f}", c))
        img = _c._yazi(img, _c._cakismayi_coz(yazi, 14, genislik=140,
                                              kare_yuk=img.shape[0]), 14)
    return img


class IzgaraBoru:
    """Uçtan uca: kare -> kuşbakışı -> tespit -> ölçüm katmanı."""

    def __init__(self, izgara: Izgara, px_mm=4.0, model_yolu=None, hef_yolu=None,
                 tarama=None, cikti_dizin=None, lens=None):
        self.izgara = izgara
        self.lens = lens
        self.px_mm = float(px_mm)
        self.model_yolu, self.hef_yolu = model_yolu, hef_yolu
        self.tarama = tarama
        self.cikti_dizin = Path(cikti_dizin) if cikti_dizin else None
        self._bolutleyici = None

    def calistir(self, kare, ham_kayitlar=None, *, zaman_iso=None, kare_yolu=None,
                 gorsel=True, arsivle=True) -> dict:
        zaman = zaman_iso or dt.datetime.now().astimezone().isoformat(timespec="seconds")
        ortho, bilgi = kusbakisi_uret(kare, self.izgara, self.px_mm,
                                      lens=self.lens)

        if self._bolutleyici is None:
            self._bolutleyici = bolutleyici_sec(self.model_yolu, self.hef_yolu,
                                                px_mm=self.px_mm)
        tespitler, tespit_tani = tespit_et(ortho, bilgi,
                                           bolutleyici=self._bolutleyici)

        sonuc = {"zaman": zaman, "kare_yolu": kare_yolu,
                 "tespitler": tespitler,
                 "tani": {"kusbakisi": {k: v for k, v in bilgi.items()
                                        if k not in ("ortho_to_mm", "mm_to_ortho")},
                          "tespit": tespit_tani}}

        if self.tarama is not None:
            olcum = self.tarama.calistir(tespitler, ham_kayitlar,
                                         zaman_iso=zaman, kare_yolu=kare_yolu,
                                         arsivle=arsivle)
            sonuc.update({k: v for k, v in olcum.items() if k != "tani"})
            sonuc["tani"].update(olcum["tani"])

        if gorsel:
            img = ortho_gorsel(ortho, bilgi, tespitler,
                               kararlar=[{"tespit_id": t["id"], **t}
                                         for t in sonuc.get("tespitler", [])]
                               if self.tarama else None,
                               izgara_hucreleri=self.izgara)
            diz = self.cikti_dizin or (Path(kare_yolu).parent if kare_yolu
                                       else Path("."))
            diz.mkdir(parents=True, exist_ok=True)
            ad = Path(kare_yolu).stem if kare_yolu else zaman.replace(":", "")
            yol = diz / f"{ad}.kusbakisi.jpg"
            cv2.imwrite(str(yol), img, [cv2.IMWRITE_JPEG_QUALITY, 90])
            sonuc["kusbakisi_yolu"] = str(yol)
        return sonuc
