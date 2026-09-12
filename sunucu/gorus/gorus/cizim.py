"""
cizim — tespitleri kare üstüne basan görsel katman.

Bu yalnız süs değil, kalibrasyonun TEK GÖZLE DOĞRULAMA aracıdır:

  * Yatak sınırı ve 50 mm'lik ızgara, mm uzayında üretilip piksele
    projekte edilir. Kalibrasyon doğruysa ızgara toprağın üstüne oturur ve
    eğik bakışta perspektifle daralır. Izgara yatağın dışına taşıyorsa ya da
    düzgün bir dikdörtgen gibi duruyorsa kalibrasyon yanlıştır.
  * Tespit daireleri de mm uzayında çember olarak üretilir; eğik kamerada
    ELİPS görünmeleri BEKLENEN davranıştır. Kusursuz daire görüyorsanız
    homografi uygulanmamış demektir.
  * Etiketlerin üstüne, kayıtlı mm konumlarının geri projeksiyonu basılır.
    İşaret etiketin üstüne düşmüyorsa eksenler takas/ters çevrilmiştir.

Türkçe karakterler için PIL varsa TTF, yoksa OpenCV Hershey (ASCII'ye
sadeleştirilmiş metin) kullanılır.
"""

from __future__ import annotations

import numpy as np
import cv2

_RENK = {
    "filiz":     (60, 220, 60),
    "yabani":    (40, 60, 230),
    "belirsiz":  (30, 200, 245),
    "yatak":     (230, 200, 60),
    "izgara":    (120, 110, 90),
    "etiket":    (255, 120, 255),
    "bos_kayit": (180, 180, 180),
    "metin":     (255, 255, 255),
    "zemin":     (25, 25, 25),
}

_ASCII = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")

try:
    from PIL import Image, ImageDraw, ImageFont
    _PIL = True
except ImportError:
    _PIL = False

_FONT_YOLLARI = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
]
_font_onbellek = {}


def _font(boy):
    if not _PIL:
        return None
    if boy in _font_onbellek:
        return _font_onbellek[boy]
    import os
    for y in _FONT_YOLLARI:
        if os.path.exists(y):
            _font_onbellek[boy] = ImageFont.truetype(y, boy)
            return _font_onbellek[boy]
    _font_onbellek[boy] = ImageFont.load_default()
    return _font_onbellek[boy]


def _cakismayi_coz(ogeler, boy, satir_sayisi=3, genislik_tah=230, kare_yuk=None):
    """
    Uzak sıradaki bitkiler karede birbirine girer; etiketleri üst üste biner.
    Basit açgözlü çözüm: yukarıdan aşağı sırala, çakışan kutuyu aşağı it.
    """
    yuk = boy * satir_sayisi + 8
    yerlesik = []
    cikti = []
    for oge in sorted(ogeler, key=lambda o: (o[1], o[0])):
        x, y, m, r = oge[0], oge[1], oge[2], oge[3]
        ek = tuple(oge[4:])
        yy = y
        for _ in range(40):
            carpisma = next((b for b in yerlesik
                             if abs(b[0] - x) < genislik_tah and abs(b[1] - yy) < yuk), None)
            if carpisma is None:
                break
            yy = carpisma[1] + yuk + 2
        if kare_yuk:
            yy = min(yy, kare_yuk - yuk - 4)
        yerlesik.append((x, yy))
        cikti.append((x, yy, m, r) + ek)
    return cikti


def _yazi_toplu(bgr, ogeler, boy=22):
    """ogeler: [(x, y, metin, renk_bgr)] — tek geçişte basar."""
    if not ogeler:
        return bgr
    if _PIL:
        im = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
        d = ImageDraw.Draw(im)
        f = _font(boy)
        for x, y, m, r in ogeler:
            d.text((x, y), m, font=f, fill=(int(r[2]), int(r[1]), int(r[0])),
                   stroke_width=3, stroke_fill=(0, 0, 0))
        return cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
    for x, y, m, r in ogeler:
        m = m.translate(_ASCII)
        p = (int(x), int(y + boy))
        cv2.putText(bgr, m, p, cv2.FONT_HERSHEY_SIMPLEX, boy / 30.0, (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(bgr, m, p, cv2.FONT_HERSHEY_SIMPLEX, boy / 30.0, r, 1, cv2.LINE_AA)
    return bgr


def _cizgi_mm(img, duzlem, p0, p1, renk, kalinlik=2, adim=12):
    """mm'deki doğru parçası perspektifte eğrilir; parçalara bölerek çiz."""
    t = np.linspace(0, 1, adim)
    nok = np.stack([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t], 1)
    pk = duzlem.mm_to_piksel(nok)
    cv2.polylines(img, [np.round(pk).astype(np.int32)], False, renk, kalinlik, cv2.LINE_AA)


def yatak_ve_izgara(img, duzlem, izgara_mm=50.0):
    W, H = duzlem.yatak_mm
    for x in np.arange(izgara_mm, W, izgara_mm):
        _cizgi_mm(img, duzlem, (x, 0), (x, H), _RENK["izgara"], 1)
    for y in np.arange(izgara_mm, H, izgara_mm):
        _cizgi_mm(img, duzlem, (0, y), (W, y), _RENK["izgara"], 1)
    for a, b in [((0, 0), (W, 0)), ((W, 0), (W, H)), ((W, H), (0, H)), ((0, H), (0, 0))]:
        _cizgi_mm(img, duzlem, a, b, _RENK["yatak"], 3)
    return img


def etiket_isaretleri(img, duzlem, dogrulama=None):
    yazi = []
    for sid, kayit in (duzlem.etiketler or {}).items():
        p = duzlem.mm_to_piksel([kayit["mm"]])[0]      # mm -> piksel geri projeksiyon
        cv2.drawMarker(img, (int(p[0]), int(p[1])), _RENK["etiket"],
                       cv2.MARKER_TILTED_CROSS, 40, 2, cv2.LINE_AA)
        h = ((dogrulama or {}).get("etiket_basina_mm") or {}).get(sid)
        m = f"tag {sid}" + (f"  {h:.1f} mm" if h is not None else "")
        yazi.append((p[0] + 22, p[1] - 12, m, _RENK["etiket"]))
    return _yazi_toplu(img, yazi, 20)


def tespitler(img, duzlem, nesneler, kararlar, daire_yaricap_mm=None,
              kontur_ciz=True):
    karar_ix = {k["nesne_id"]: k for k in kararlar}
    yazi = []
    for n in nesneler:
        k = karar_ix.get(n.id, {"sinif": "belirsiz", "skor": 0.0})
        renk = _RENK.get(k["sinif"], _RENK["belirsiz"])

        if kontur_ciz and n.kontur_piksel:
            c = np.round(np.asarray(n.kontur_piksel)).astype(np.int32)
            cv2.polylines(img, [c], True, renk, 2, cv2.LINE_AA)

        # mm uzayında çember -> eğik kamerada elips. Kalibrasyonun kanıtı.
        r = daire_yaricap_mm or max(n.cap_mm * 0.85, 12.0)
        cember = duzlem.mm_cember_piksel(n.taban_mm, r)
        cv2.polylines(img, [np.round(cember).astype(np.int32)], True, renk, 3, cv2.LINE_AA)

        tp = duzlem.mm_to_piksel([n.taban_mm])[0]
        cv2.drawMarker(img, (int(tp[0]), int(tp[1])), renk, cv2.MARKER_CROSS, 26, 2, cv2.LINE_AA)

        etiket = (f"#{n.id} {k['sinif']} {k.get('skor', 0):.2f}\n"
                  f"X{n.taban_mm[0]:.0f} Y{n.taban_mm[1]:.0f}  {n.alan_mm2:.0f}mm²")
        yazi.append((cember[:, 0].max() + 8, cember[:, 1].min() - 10, etiket, renk,
                     (float(tp[0]), float(tp[1]))))

    # çakışma çöz (çapa noktası etiketle birlikte taşınır), sonra bağla
    yerlesik = _cakismayi_coz(yazi, 20, satir_sayisi=2, genislik_tah=210,
                              kare_yuk=img.shape[0])
    for x, y, m, r, capa in yerlesik:
        if abs(y - capa[1]) > 26 or abs(x - capa[0]) > 60:
            cv2.line(img, (int(capa[0]), int(capa[1])), (int(x) - 4, int(y) + 20),
                     r, 1, cv2.LINE_AA)
    return _yazi_toplu(img, [(x, y, m, r) for x, y, m, r, _ in yerlesik], 20)


def bos_kayitlar(img, duzlem, kayitlar, bos_idler):
    """Ekilmiş ama görülmemiş noktalar — 'çıkmadı mı, kaçırdık mı?'"""
    ix = {k.id: k for k in kayitlar}
    yazi = []
    for kid in bos_idler:
        k = ix.get(kid)
        if k is None:
            continue
        cember = duzlem.mm_cember_piksel((k.x_mm, k.y_mm), 18.0)
        c = np.round(cember).astype(np.int32)
        for i in range(0, len(c), 4):                       # kesikli çember
            cv2.polylines(img, [c[i:i + 3]], False, _RENK["bos_kayit"], 2, cv2.LINE_AA)
        yazi.append((cember[:, 0].min(), cember[:, 1].min() - 26,
                     f"kayıt #{kid} görülmedi", _RENK["bos_kayit"]))
    return _yazi_toplu(img, yazi, 18)


def bilgi_seridi(img, satirlar):
    h, w = img.shape[:2]
    yuk = 30 * len(satirlar) + 20
    katman = img.copy()
    cv2.rectangle(katman, (0, 0), (w, yuk), _RENK["zemin"], -1)
    cv2.addWeighted(katman, 0.72, img, 0.28, 0, img)
    return _yazi_toplu(img, [(18, 10 + 30 * i, s, _RENK["metin"])
                             for i, s in enumerate(satirlar)], 22)


def ustdenklestir(bgr, duzlem, nesneler, kararlar, *, kayitlar=None,
                  bos_kayit_idleri=None, dogrulama=None, basliklar=None,
                  izgara=True) -> np.ndarray:
    """Tam katmanlı görsel. Panelde ve /gorus/tarama/{id}/gorsel.jpg'de kullanılır."""
    img = bgr.copy()
    if izgara:
        yatak_ve_izgara(img, duzlem)
    img = etiket_isaretleri(img, duzlem, dogrulama)
    if kayitlar and bos_kayit_idleri:
        img = bos_kayitlar(img, duzlem, kayitlar, bos_kayit_idleri)
    img = tespitler(img, duzlem, nesneler, kararlar)
    if basliklar:
        img = bilgi_seridi(img, basliklar)
    return img


def ustten_gorunum(bgr, duzlem, px_mm: float = 2.0, kenar_mm: float = 20.0):
    """
    Kareyi homografiyle DÜZLEŞTİRİR: yatağa tam tepeden bakan, ölçekli bir
    görüntü. Eğik bakışın bütün kısaltması kalkar, 1 piksel her yerde aynı
    mm'dir. İki işe yarar:
      * Kalibrasyonun gözle denetimi: yatak kenarları dümdüz ve dikdörtgen
        değilse homografi bozuktur.
      * Panelde bahçeyi kuşbakışı göstermek (Bahçe sekmesinin altlığı).

    Döner: (ortho_bgr, mm_to_ortho_piksel fonksiyonu)
    """
    W, H = duzlem.yatak_mm
    ow = int(round((W + 2 * kenar_mm) * px_mm))
    oh = int(round((H + 2 * kenar_mm) * px_mm))
    # mm -> ortho piksel:  p = (mm + kenar) * px_mm
    M = np.array([[px_mm, 0, kenar_mm * px_mm],
                  [0, px_mm, kenar_mm * px_mm],
                  [0, 0, 1.0]], np.float64)
    donusum = M @ duzlem.H                      # kamera pikseli -> ortho piksel
    ortho = cv2.warpPerspective(bgr, donusum, (ow, oh), flags=cv2.INTER_LINEAR)

    def mm_to_ortho(noktalar):
        n = np.asarray(noktalar, np.float64).reshape(-1, 2)
        return (n + kenar_mm) * px_mm

    return ortho, mm_to_ortho


def ustten_tespitler(ortho, mm_to_ortho, nesneler, kararlar, px_mm=2.0,
                     izgara_mm=50.0, yatak_mm=(540.0, 645.0)):
    """Ortorektifiye görüntü üstüne ızgara + tespit daireleri (burada GERÇEK daire)."""
    img = ortho.copy()
    W, H = yatak_mm
    for x in np.arange(0, W + 1e-6, izgara_mm):
        a, b = mm_to_ortho([[x, 0], [x, H]])
        cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), _RENK["izgara"], 1)
    for y in np.arange(0, H + 1e-6, izgara_mm):
        a, b = mm_to_ortho([[0, y], [W, y]])
        cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), _RENK["izgara"], 1)
    kose = mm_to_ortho([[0, 0], [W, 0], [W, H], [0, H]]).astype(np.int32)
    cv2.polylines(img, [kose], True, _RENK["yatak"], 2, cv2.LINE_AA)

    karar_ix = {k["nesne_id"]: k for k in kararlar}
    yazi = []
    for n in nesneler:
        k = karar_ix.get(n.id, {"sinif": "belirsiz", "skor": 0.0})
        renk = _RENK.get(k["sinif"], _RENK["belirsiz"])
        c = mm_to_ortho([n.taban_mm])[0]
        r = int(max(n.cap_mm * 0.85, 10.0) * px_mm)
        cv2.circle(img, (int(c[0]), int(c[1])), r, renk, 2, cv2.LINE_AA)
        cv2.drawMarker(img, (int(c[0]), int(c[1])), renk, cv2.MARKER_CROSS, 12, 1)
        yazi.append((c[0] + r + 4, c[1] - 9,
                     f"#{n.id} {k['sinif']}\nX{n.taban_mm[0]:.0f} Y{n.taban_mm[1]:.0f}",
                     renk))
    yazi = _cakismayi_coz(yazi, 14, satir_sayisi=2, genislik_tah=130,
                          kare_yuk=img.shape[0])
    return _yazi_toplu(img, yazi, 14)
