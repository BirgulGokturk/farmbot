"""
cizim — tespitleri kare üstüne basan görsel katman.  [madde 5]

KALİBRASYONA BAĞIMLI DEĞİL. Piksel↔mm dönüşümü sunucudaki kalibrasyondan
gelir; bu modül yalnız iki çağrı ister:

    mm_to_piksel(noktalar)  -> Nx2 piksel   (zorunlu)
    piksel_to_mm(noktalar)  -> Nx2 mm       (üstten görünüm için)

Böylece `kalibrasyon.py` nasıl çalışırsa çalışsın (homografi ya da ölçek+dönme)
bu katman aynı kalır. Bağdaştırıcıyı `harita_kur()` ile kurun.

Bu yalnız süs değil, kalibrasyonun TEK BAKIŞTA DENETİMİ:
  * Yatak sınırı ve 50 mm ızgara mm uzayında üretilip piksele projekte edilir.
    Izgara toprağa oturmuyorsa kalibrasyon bozuktur.
  * Tespit daireleri de mm uzayında çember olarak üretilir. Kamera eğikse
    ELİPS görünmeleri beklenen davranıştır; tam tepeden bakışta daire kalırlar.
"""

from __future__ import annotations

import numpy as np
import cv2

_RENK = {"filiz": (60, 220, 60), "yabani": (40, 60, 230), "belirsiz": (30, 200, 245),
         "yatak": (230, 200, 60), "izgara": (120, 110, 90),
         "bos_kayit": (180, 180, 180), "metin": (255, 255, 255), "zemin": (25, 25, 25)}

_ASCII = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")

try:
    from PIL import Image, ImageDraw, ImageFont
    _PIL = True
except ImportError:
    _PIL = False

_FONTLAR = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf"]
_fc = {}


def _font(boy):
    if not _PIL:
        return None
    if boy not in _fc:
        import os
        for y in _FONTLAR:
            if os.path.exists(y):
                _fc[boy] = ImageFont.truetype(y, boy); break
        else:
            _fc[boy] = ImageFont.load_default()
    return _fc[boy]


def _yazi(bgr, ogeler, boy=20):
    if not ogeler:
        return bgr
    if _PIL:
        im = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(im); f = _font(boy)
        for x, y, m, r in ogeler:
            d.text((x, y), m, font=f, fill=(int(r[2]), int(r[1]), int(r[0])),
                   stroke_width=3, stroke_fill=(0, 0, 0))
        return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    for x, y, m, r in ogeler:
        for kal, renk in ((4, (0, 0, 0)), (1, r)):
            cv2.putText(bgr, m.translate(_ASCII), (int(x), int(y + boy)),
                        cv2.FONT_HERSHEY_SIMPLEX, boy / 30.0, renk, kal, cv2.LINE_AA)
    return bgr


def _cakismayi_coz(ogeler, boy, satir=2, genislik=210, kare_yuk=None):
    yuk = boy * satir + 8
    yerlesik, cikti = [], []
    for oge in sorted(ogeler, key=lambda o: (o[1], o[0])):
        x, y, m, r = oge[0], oge[1], oge[2], oge[3]
        ek = tuple(oge[4:])
        yy = y
        for _ in range(40):
            c = next((b for b in yerlesik
                      if abs(b[0] - x) < genislik and abs(b[1] - yy) < yuk), None)
            if c is None:
                break
            yy = c[1] + yuk + 2
        if kare_yuk:
            yy = min(yy, kare_yuk - yuk - 4)
        yerlesik.append((x, yy)); cikti.append((x, yy, m, r) + ek)
    return cikti


class Harita:
    """Sunucudaki kalibrasyonu bu katmana bağlayan ince bağdaştırıcı."""

    def __init__(self, mm_to_piksel, piksel_to_mm=None, yatak_mm=(540.0, 645.0)):
        self._m2p = mm_to_piksel
        self._p2m = piksel_to_mm
        self.yatak_mm = tuple(yatak_mm)

    def mm_to_piksel(self, noktalar) -> np.ndarray:
        return np.asarray(self._m2p(np.asarray(noktalar, np.float64).reshape(-1, 2)),
                          np.float64).reshape(-1, 2)

    def cember(self, merkez_mm, yaricap_mm, n=48) -> np.ndarray:
        t = np.linspace(0, 2 * np.pi, n, endpoint=False)
        c = np.stack([merkez_mm[0] + yaricap_mm * np.cos(t),
                      merkez_mm[1] + yaricap_mm * np.sin(t)], axis=1)
        return self.mm_to_piksel(c)


def harita_kur(H=None, mm_to_piksel=None, piksel_to_mm=None,
               yatak_mm=(540.0, 645.0)) -> Harita:
    """
    H verilirse (3x3 piksel->mm homografisi) tersi alınıp kullanılır.
    Kendi dönüşüm çağrılarınız varsa doğrudan onları geçin.
    """
    if mm_to_piksel is None:
        if H is None:
            raise ValueError("H ya da mm_to_piksel verilmeli")
        Hi = np.linalg.inv(np.asarray(H, np.float64))

        def mm_to_piksel(n):
            n = np.asarray(n, np.float64).reshape(-1, 2)
            h = np.hstack([n, np.ones((len(n), 1))]) @ Hi.T
            return h[:, :2] / h[:, 2:3]
    return Harita(mm_to_piksel, piksel_to_mm, yatak_mm)


def _cizgi_mm(img, harita, p0, p1, renk, kalinlik=2, adim=12):
    t = np.linspace(0, 1, adim)
    nok = np.stack([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t], 1)
    cv2.polylines(img, [np.round(harita.mm_to_piksel(nok)).astype(np.int32)],
                  False, renk, kalinlik, cv2.LINE_AA)


def yatak_ve_izgara(img, harita, izgara_mm=50.0):
    W, H = harita.yatak_mm
    for x in np.arange(izgara_mm, W, izgara_mm):
        _cizgi_mm(img, harita, (x, 0), (x, H), _RENK["izgara"], 1)
    for y in np.arange(izgara_mm, H, izgara_mm):
        _cizgi_mm(img, harita, (0, y), (W, y), _RENK["izgara"], 1)
    for a, b in [((0, 0), (W, 0)), ((W, 0), (W, H)), ((W, H), (0, H)), ((0, H), (0, 0))]:
        _cizgi_mm(img, harita, a, b, _RENK["yatak"], 3)
    return img


def tespitleri_ciz(img, harita, tespitler, kararlar, daire_mm=None):
    kx = {k["tespit_id"]: k for k in kararlar}
    yazi = []
    for t in tespitler:
        k = kx.get(t.id, {"sinif": "belirsiz", "skor": 0.0})
        renk = _RENK.get(k["sinif"], _RENK["belirsiz"])
        if t.kontur_piksel:
            cv2.polylines(img, [np.round(np.asarray(t.kontur_piksel)).astype(np.int32)],
                          True, renk, 2, cv2.LINE_AA)
        r = daire_mm or max((t.cap_mm or 0) * 0.85, 12.0)
        cember = harita.cember(t.mm, r)
        cv2.polylines(img, [np.round(cember).astype(np.int32)], True, renk, 3, cv2.LINE_AA)
        mp = harita.mm_to_piksel([t.mm])[0]
        cv2.drawMarker(img, (int(mp[0]), int(mp[1])), renk, cv2.MARKER_CROSS, 26, 2)
        alan = f"{t.alan_mm2:.0f}mm²" if t.alan_mm2 is not None else "alan yok"
        yazi.append((cember[:, 0].max() + 8, cember[:, 1].min() - 10,
                     f"#{t.id} {k['sinif']} {k.get('skor', 0):.2f}\n"
                     f"X{t.x_mm:.0f} Y{t.y_mm:.0f}  {alan}", renk,
                     (float(mp[0]), float(mp[1]))))
    yerlesik = _cakismayi_coz(yazi, 20, kare_yuk=img.shape[0])
    for x, y, m, r, capa in yerlesik:
        if abs(y - capa[1]) > 26 or abs(x - capa[0]) > 60:
            cv2.line(img, (int(capa[0]), int(capa[1])), (int(x) - 4, int(y) + 20),
                     r, 1, cv2.LINE_AA)
    return _yazi(img, [(x, y, m, r) for x, y, m, r, _ in yerlesik], 20)


def bos_kayitlari_ciz(img, harita, kayitlar, bos_idler):
    """Ekilmiş ama görülmemiş noktalar — 'çıkmadı mı, kaçırdık mı?'"""
    ix = {k.id: k for k in kayitlar}
    yazi = []
    for kid in bos_idler:
        k = ix.get(kid)
        if k is None:
            continue
        c = np.round(harita.cember((k.x_mm, k.y_mm), 18.0)).astype(np.int32)
        for i in range(0, len(c), 4):
            cv2.polylines(img, [c[i:i + 3]], False, _RENK["bos_kayit"], 2, cv2.LINE_AA)
        yazi.append((c[:, 0].min(), c[:, 1].min() - 26,
                     f"kayıt #{kid} görülmedi", _RENK["bos_kayit"]))
    return _yazi(img, yazi, 18)


def bilgi_seridi(img, satirlar):
    h, w = img.shape[:2]
    yuk = 30 * len(satirlar) + 20
    k = img.copy()
    cv2.rectangle(k, (0, 0), (w, yuk), _RENK["zemin"], -1)
    cv2.addWeighted(k, 0.72, img, 0.28, 0, img)
    return _yazi(img, [(18, 10 + 30 * i, s, _RENK["metin"])
                       for i, s in enumerate(satirlar)], 22)


def gorsel(bgr, harita, tespitler, kararlar, *, kayitlar=None,
           bos_kayit_idleri=None, basliklar=None, izgara=True) -> np.ndarray:
    img = bgr.copy()
    if izgara:
        yatak_ve_izgara(img, harita)
    if kayitlar and bos_kayit_idleri:
        img = bos_kayitlari_ciz(img, harita, kayitlar, bos_kayit_idleri)
    img = tespitleri_ciz(img, harita, tespitler, kararlar)
    if basliklar:
        img = bilgi_seridi(img, basliklar)
    return img


def ustten_gorunum(bgr, H, yatak_mm=(540.0, 645.0), px_mm=2.0, kenar_mm=20.0):
    """
    Kareyi homografiyle DÜZLEŞTİRİR: tam tepeden bakan, ölçekli görüntü.
    H: piksel -> mm homografisi (3x3). Bahçe sekmesinin altlığı ve
    kalibrasyonun en güçlü görsel kanıtı — yatak dümdüz dikdörtgen çıkmalı.
    Döner: (ortho_bgr, mm_to_ortho_piksel)
    """
    W, Hy = yatak_mm
    ow = int(round((W + 2 * kenar_mm) * px_mm))
    oh = int(round((Hy + 2 * kenar_mm) * px_mm))
    M = np.array([[px_mm, 0, kenar_mm * px_mm],
                  [0, px_mm, kenar_mm * px_mm], [0, 0, 1.0]], np.float64)
    ortho = cv2.warpPerspective(bgr, M @ np.asarray(H, np.float64), (ow, oh),
                                flags=cv2.INTER_LINEAR)

    def mm_to_ortho(n):
        return (np.asarray(n, np.float64).reshape(-1, 2) + kenar_mm) * px_mm

    return ortho, mm_to_ortho


def ustten_tespitler(ortho, mm_to_ortho, tespitler, kararlar, px_mm=2.0,
                     izgara_mm=50.0, yatak_mm=(540.0, 645.0)):
    img = ortho.copy()
    W, H = yatak_mm
    for x in np.arange(0, W + 1e-6, izgara_mm):
        a, b = mm_to_ortho([[x, 0], [x, H]])
        cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), _RENK["izgara"], 1)
    for y in np.arange(0, H + 1e-6, izgara_mm):
        a, b = mm_to_ortho([[0, y], [W, y]])
        cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), _RENK["izgara"], 1)
    cv2.polylines(img, [mm_to_ortho([[0, 0], [W, 0], [W, H], [0, H]]).astype(np.int32)],
                  True, _RENK["yatak"], 2, cv2.LINE_AA)
    kx = {k["tespit_id"]: k for k in kararlar}
    yazi = []
    for t in tespitler:
        k = kx.get(t.id, {"sinif": "belirsiz"})
        renk = _RENK.get(k["sinif"], _RENK["belirsiz"])
        c = mm_to_ortho([t.mm])[0]
        r = int(max((t.cap_mm or 0) * 0.85, 10.0) * px_mm)
        cv2.circle(img, (int(c[0]), int(c[1])), r, renk, 2, cv2.LINE_AA)
        cv2.drawMarker(img, (int(c[0]), int(c[1])), renk, cv2.MARKER_CROSS, 12, 1)
        yazi.append((c[0] + r + 4, c[1] - 9,
                     f"#{t.id} {k['sinif']}\nX{t.x_mm:.0f} Y{t.y_mm:.0f}", renk))
    return _yazi(img, _cakismayi_coz(yazi, 14, genislik=130, kare_yuk=img.shape[0]), 14)
