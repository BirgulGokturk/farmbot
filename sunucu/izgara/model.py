"""Izgara kalibrasyonu — makinenin kendi hareketiyle piksel↔mm öğrenme.

Neden ızgara, neden dört etiket değil
-------------------------------------
Benzetimde ölçüldü (testler/test_model.py):

    4 etiket, ideal lens            0.00 mm   <- yanıltıcı
    4 etiket, gerçek lens           6.09 mm   <- ve etiketlerdeki artık YİNE 0
    12 nokta + distorsiyon          0.03 mm

Sebep matematiksel: homografi 8 serbestlik, radyal distorsiyon 2 daha.
Dört nokta 8 kısıt verir; 10 parametreyi çözemez. Distorsiyon hatası
homografinin içine emilir, etiketlerin üstünde sıfır artık bırakır ve
GÖRÜNMEZ. Beşinci noktadan sonra görünür hale gelir.

İki model var, hangisinin kurulduğu çıktıda yazar:

  "duzlem"  — tek yükseklikte nokta toplandıysa. Homografi + distorsiyon
              (12 parametre). Yalnız o yükseklik için geçerli. Yaprak
              topraktan yüksekteyse kayar; ne kadar kaydığı bilinmez.

  "uzay"    — en az iki yükseklikte nokta toplandıysa. Tam kamera modeli
              (odak, merkez, distorsiyon, dönme, öteleme = 12 parametre).
              Her yükseklik için ayrı geçerli: paralaks çözülür.
              Benzetimde 30 mm boyundaki yaprak 27.49 mm → 0.03 mm.

Hiçbir sayı uydurulmuyor: yükseklik bilgisi yoksa model "duzlem" kalır ve
`h_mm` parametresi verildiğinde HATA verir, sessizce sıfır saymaz.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Sequence

import numpy as np

try:
    import cv2
except ImportError as _e:                                   # pragma: no cover
    raise ImportError("izgara.model OpenCV gerektiriyor (pip install "
                      "opencv-python-headless)") from _e
from scipy.optimize import least_squares


class KalibrasyonHatasi(ValueError):
    pass


# --------------------------------------------------------------------------- #
# Girdi
# --------------------------------------------------------------------------- #
@dataclass
class Nokta:
    """Makine bir yere gitti, karede işaret şurada görüldü.

    u_px, v_px : işaretin karedeki yeri (alt piksel)
    x_mm, y_mm : makinenin o andaki konumu — GERÇEK, enkoderden
    h_mm       : işaretin TOPRAK YÜZEYİNDEN yüksekliği
                 = (makine_z - toprağa_değdiği_z) + işaretin_kendi_ofseti
                 Bu sayı yanlışsa kalibrasyon sessizce yanlış olur:
                 benzetimde her 1 mm yükseklik hatası 0.86 mm konum hatası.
    """
    u_px: float
    v_px: float
    x_mm: float
    y_mm: float
    h_mm: float = 0.0
    etiket: str = ""


def _diziye(noktalar: Sequence[Nokta]):
    px = np.array([[n.u_px, n.v_px] for n in noktalar], np.float64)
    mm = np.array([[n.x_mm, n.y_mm] for n in noktalar], np.float64)
    h = np.array([n.h_mm for n in noktalar], np.float64)
    return px, mm, h


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #
@dataclass
class Model:
    tur: str                      # "duzlem" | "uzay"
    kare_boyutu: tuple[int, int]  # (genislik, yukseklik) piksel
    p: list[float]                # parametreler (tür'e göre)
    olcek_px: float               # distorsiyon yarıçapının normalize ölçeği
    yukseklikler_mm: list[float] = field(default_factory=list)
    kabuk_px: list[list[float]] = field(default_factory=list)  # kalibre edilen bölge
    rapor: dict = field(default_factory=dict)
    zaman: str = ""

    # -- kurulum ----------------------------------------------------------
    def kare_ici_mi(self, px) -> np.ndarray:
        g, y = self.kare_boyutu
        px = np.atleast_2d(np.asarray(px, float))
        return (px[:, 0] >= 0) & (px[:, 0] < g) & (px[:, 1] >= 0) & (px[:, 1] < y)

    def kalibre_bolgede_mi(self, px) -> np.ndarray:
        """Sorgu, noktaların gerçekten toplandığı bölgenin içinde mi.

        Dışarısı UZATMADIR: model orada ölçülmedi. Uçtaki distorsiyon
        hızla büyür. Uçtan e-end denemede ızgaranın 40 mm payı dışında
        kalan test noktaları hatayı 0.41 mm'den 0.64 mm'ye çıkardı.
        """
        px = np.atleast_2d(np.asarray(px, float))
        if not self.kabuk_px:
            return np.ones(len(px), bool)
        k = np.asarray(self.kabuk_px, np.float32)
        return np.array([cv2.pointPolygonTest(k, (float(a), float(b)), False) >= 0
                         for a, b in px], bool)

    # -- piksel -> mm -----------------------------------------------------
    def px2mm(self, px, h_mm: float | None = None) -> np.ndarray:
        px = np.atleast_2d(np.asarray(px, float))
        if self.tur == "duzlem":
            if h_mm not in (None, 0.0):
                raise KalibrasyonHatasi(
                    f"Bu kalibrasyon tek yükseklikte kuruldu (duzlem modeli); "
                    f"h_mm={h_mm} için geçerli değil. İki farklı yükseklikte "
                    "tur atıp 'uzay' modeli kurun.")
            return _duzlem_px2mm(self.p, self.olcek_px, px)
        return _uzay_px2mm(self.p, px, float(h_mm or 0.0))

    def mm2px(self, mm, h_mm: float = 0.0) -> np.ndarray:
        mm = np.atleast_2d(np.asarray(mm, float))
        if self.tur == "duzlem":
            if h_mm:
                raise KalibrasyonHatasi("duzlem modelinde h_mm kullanılamaz.")
            return _duzlem_mm2px(self.p, self.olcek_px, mm)
        return _uzay_mm2px(self.p, mm, float(h_mm))

    def yerel_mm_px(self, px, h_mm: float = 0.0, d: float = 5.0) -> np.ndarray:
        """İstenen pikselin CİVARINDAKİ ölçek. Eğik kamerada sabit değil."""
        px = np.atleast_2d(np.asarray(px, float))
        a = self.px2mm(px, h_mm)
        b = self.px2mm(px + [d, 0], h_mm)
        c = self.px2mm(px + [0, d], h_mm)
        return np.sqrt(np.linalg.norm(b - a, axis=1) *
                       np.linalg.norm(c - a, axis=1)) / d

    # -- kalıcılık --------------------------------------------------------
    def kaydet(self, yol) -> Path:
        yol = Path(yol); yol.parent.mkdir(parents=True, exist_ok=True)
        yol.write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2),
                       encoding="utf-8")
        return yol

    @classmethod
    def yukle(cls, yol) -> "Model":
        d = json.loads(Path(yol).read_text(encoding="utf-8"))
        d["kare_boyutu"] = tuple(d["kare_boyutu"])
        return cls(**d)


# --------------------------------------------------------------------------- #
# "duzlem" modeli: homografi + radyal distorsiyon  (12 parametre)
# --------------------------------------------------------------------------- #
# Distorsiyon merkezi ve katsayıları da çözülüyor; odak uzaklığı GEREKMİYOR
# çünkü yarıçap sabit bir ölçeğe (karenin yarı genişliği) normalize ediliyor
# ve k1,k2 o ölçeği içine alıyor.
def _duzeltilmis(p, olcek, px):
    cx, cy, k1, k2 = p[8], p[9], p[10], p[11]
    x = (px[:, 0] - cx) / olcek
    y = (px[:, 1] - cy) / olcek
    r2 = x * x + y * y
    s = 1.0 + k1 * r2 + k2 * r2 * r2
    s = np.where(np.abs(s) < 1e-6, 1e-6, s)
    return np.c_[x / s * olcek + cx, y / s * olcek + cy]


def _duzlem_px2mm(p, olcek, px):
    H = np.r_[np.asarray(p[:8], float), 1.0].reshape(3, 3)
    d = _duzeltilmis(np.asarray(p, float), olcek, np.asarray(px, float))
    return cv2.perspectiveTransform(d.reshape(-1, 1, 2), H).reshape(-1, 2)


def _duzlem_mm2px(p, olcek, mm):
    """Ters yön: H⁻¹ ile düzeltilmiş piksele, sonra distorsiyonu geri koy."""
    H = np.r_[np.asarray(p[:8], float), 1.0].reshape(3, 3)
    d = cv2.perspectiveTransform(np.asarray(mm, float).reshape(-1, 1, 2),
                                 np.linalg.inv(H)).reshape(-1, 2)
    cx, cy, k1, k2 = p[8], p[9], p[10], p[11]
    x = (d[:, 0] - cx) / olcek
    y = (d[:, 1] - cy) / olcek
    r2 = x * x + y * y
    s = 1.0 + k1 * r2 + k2 * r2 * r2       # düzeltmenin tersi
    return np.c_[x * s * olcek + cx, y * s * olcek + cy]


def _duzlem_kur(px, mm, kare_boyutu, olcek):
    if len(px) < 6:
        raise KalibrasyonHatasi(
            f"'duzlem' modeli için en az 6 nokta gerekli, {len(px)} verildi. "
            "(Homografi 8 + distorsiyon 2 = 10 bilinmeyen; 4 nokta 8 kısıt "
            "verir ve distorsiyonu GÖREMEZ.)")
    H0, _ = cv2.findHomography(px, mm, 0)
    if H0 is None:
        raise KalibrasyonHatasi("Homografi kurulamadı: noktalar neredeyse "
                                "aynı doğru üzerinde olabilir.")
    H0 = H0 / H0[2, 2]
    p0 = np.r_[H0.ravel()[:8], kare_boyutu[0] / 2.0, kare_boyutu[1] / 2.0, 0.0, 0.0]

    def artik(p):
        return (_duzlem_px2mm(p, olcek, px) - mm).ravel()

    s = least_squares(artik, p0, method="lm", max_nfev=20000)
    return list(map(float, s.x))


# --------------------------------------------------------------------------- #
# "uzay" modeli: tam kamera  (fx, fy, cx, cy, k1, k2, rvec3, tvec3)
# --------------------------------------------------------------------------- #
def _uzay_parcala(p):
    p = np.asarray(p, float)
    K = np.array([[p[0], 0, p[2]], [0, p[1], p[3]], [0, 0, 1.0]])
    dist = np.array([p[4], p[5], 0.0, 0.0], float)
    rvec = p[6:9].reshape(3, 1)
    tvec = p[9:12].reshape(3, 1)
    return K, dist, rvec, tvec


def _uzay_mm2px(p, mm, h_mm):
    K, dist, rvec, tvec = _uzay_parcala(p)
    mm = np.atleast_2d(np.asarray(mm, float))
    P = np.c_[mm, np.full(len(mm), float(h_mm))].astype(np.float64)
    uv, _ = cv2.projectPoints(P, rvec, tvec, K, dist)
    return uv.reshape(-1, 2)


def _uzay_px2mm(p, px, h_mm):
    """Işını h yüksekliğindeki düzlemle kesiştir."""
    K, dist, rvec, tvec = _uzay_parcala(p)
    px = np.atleast_2d(np.asarray(px, float))
    yon_k = cv2.undistortPoints(px.reshape(-1, 1, 2).astype(np.float64),
                                K, dist).reshape(-1, 2)
    d_kam = np.c_[yon_k, np.ones(len(yon_k))]
    R, _ = cv2.Rodrigues(rvec)
    C = (-R.T @ tvec).ravel()                  # kamera merkezi, dünya
    d = d_kam @ R                              # yön, dünya  (= (R.T @ d_k.T).T)
    dz = np.where(np.abs(d[:, 2]) < 1e-12, 1e-12, d[:, 2])
    t = (float(h_mm) - C[2]) / dz
    return C[None, :2] + t[:, None] * d[:, :2]


def _uzay_kur(px, mm, h, kare_boyutu):
    yuk = np.unique(np.round(h, 3))
    if len(yuk) < 2:
        raise KalibrasyonHatasi("'uzay' modeli en az iki farklı yükseklik ister.")
    if len(px) < 10:
        raise KalibrasyonHatasi(
            f"'uzay' modeli için en az 10 nokta gerekli, {len(px)} verildi.")

    P = np.c_[mm, h].astype(np.float32)
    g, y = kare_boyutu
    K0 = np.array([[g * 0.9, 0, g / 2.0], [0, g * 0.9, y / 2.0], [0, 0, 1.0]])
    bayrak = (cv2.CALIB_USE_INTRINSIC_GUESS | cv2.CALIB_FIX_K3 |
              cv2.CALIB_ZERO_TANGENT_DIST | cv2.CALIB_FIX_ASPECT_RATIO)
    try:
        _, K, dist, rv, tv = cv2.calibrateCamera(
            [P], [px.astype(np.float32).reshape(-1, 1, 2)], (g, y),
            K0.copy(), np.zeros(5), flags=bayrak)
        p0 = np.r_[K[0, 0], K[1, 1], K[0, 2], K[1, 2], dist.ravel()[0],
                   dist.ravel()[1], rv[0].ravel(), tv[0].ravel()]
    except cv2.error:
        p0 = np.r_[g * 0.9, g * 0.9, g / 2.0, y / 2.0, 0.0, 0.0,
                   np.array([np.pi, 0.0, 0.0]), np.array([0.0, 0.0, 600.0])]

    def artik(p):
        cikti = []
        for hh in np.unique(h):
            m = h == hh
            cikti.append((_uzay_mm2px(p, mm[m], float(hh)) - px[m]).ravel())
        return np.concatenate(cikti)

    s = least_squares(artik, p0, method="lm", max_nfev=40000)
    return list(map(float, s.x))


# --------------------------------------------------------------------------- #
# Kurulum + dürüst doğruluk
# --------------------------------------------------------------------------- #
def kur(noktalar: Sequence[Nokta], kare_boyutu: tuple[int, int],
        zorla: str | None = None) -> Model:
    """Noktalardan model kurar. Yükseklik çeşitliliği varsa 'uzay' seçer."""
    import datetime as dt

    if len(noktalar) < 6:
        raise KalibrasyonHatasi(f"En az 6 nokta gerekli, {len(noktalar)} var.")
    px, mm, h = _diziye(noktalar)
    olcek = float(kare_boyutu[0]) / 2.0
    yuk = sorted(float(v) for v in np.unique(np.round(h, 3)))

    tur = zorla or ("uzay" if len(yuk) >= 2 else "duzlem")
    if tur == "uzay":
        p = _uzay_kur(px, mm, h, kare_boyutu)
    else:
        if len(yuk) >= 2:
            raise KalibrasyonHatasi(
                "Noktalar birden çok yükseklikte ama 'duzlem' zorlandı; "
                "bu, yükseklik farkını görmezden gelmek demek.")
        p = _duzlem_kur(px, mm, kare_boyutu, olcek)

    kabuk = cv2.convexHull(px.astype(np.float32)).reshape(-1, 2)
    model = Model(tur=tur, kare_boyutu=tuple(map(int, kare_boyutu)), p=p,
                  olcek_px=olcek, yukseklikler_mm=yuk,
                  kabuk_px=[[float(u), float(v)] for u, v in kabuk],
                  zaman=dt.datetime.now().astimezone().isoformat(timespec="seconds"))
    model.rapor = _rapor(model, noktalar)
    return model


def _artiklar(model: Model, noktalar: Sequence[Nokta]) -> np.ndarray:
    px, mm, h = _diziye(noktalar)
    out = np.empty(len(noktalar))
    for hh in np.unique(h):
        m = h == hh
        t = model.px2mm(px[m], float(hh) if model.tur == "uzay" else None)
        out[m] = np.linalg.norm(t - mm[m], axis=1)
    return out


def capraz_dogrula(noktalar: Sequence[Nokta], kare_boyutu, kat: int = 5,
                   zorla: str | None = None) -> dict:
    """Ek nokta ölçmeden DÜRÜST doğruluk: her nokta bir kez dışarıda kalır.

    Kalibrasyon noktalarının üstündeki artık doğruluk ölçüsü DEĞİLDİR —
    dört noktayla kurulan bir homografide o artık matematiksel olarak
    sıfırdır. Bu işlev modeli noktaların bir kısmı olmadan kurup
    dışarıda bıraktıklarında ölçer.
    """
    n = len(noktalar)
    kat = int(min(max(2, kat), n))
    rng = np.random.default_rng(0)
    sira = rng.permutation(n)
    hata: list[float] = []
    basarisiz = 0
    for k in range(kat):
        test_ix = set(sira[k::kat].tolist())
        egitim = [noktalar[i] for i in range(n) if i not in test_ix]
        test = [noktalar[i] for i in range(n) if i in test_ix]
        try:
            m = kur(egitim, kare_boyutu, zorla)
        except KalibrasyonHatasi:
            basarisiz += 1
            continue
        hata.extend(_artiklar(m, test).tolist())
    if not hata:
        return {"olculemedi": True,
                "sebep": "Katlara bölününce her katta model kurulamadı; "
                         "daha çok nokta gerekiyor."}
    a = np.asarray(hata)
    return {
        "kat": kat, "test_nokta": len(a),
        "rms_mm": round(float(np.sqrt(np.mean(a ** 2))), 3),
        "ortalama_mm": round(float(a.mean()), 3),
        "maks_mm": round(float(a.max()), 3),
        "yuzde90_mm": round(float(np.percentile(a, 90)), 3),
        "kurulamayan_kat": basarisiz,
    }


def _rapor(model: Model, noktalar: Sequence[Nokta]) -> dict:
    a = _artiklar(model, noktalar)
    # Ölçek karenin köşelerinde DEĞİL, kalibre edilen bölgede ölçülür:
    # eğik kamerada kare köşesi ufka yakındır ve mm/px orada patlar,
    # bu da anlamsız bir "%116000 değişim" gibi görünür.
    kpx, _, _ = _diziye(noktalar)
    olcek = model.yerel_mm_px(kpx, 0.0)
    r = {
        "model": model.tur,
        "nokta": len(noktalar),
        "yukseklikler_mm": model.yukseklikler_mm,
        "kendi_artigi_rms_mm": round(float(np.sqrt(np.mean(a ** 2))), 4),
        "kendi_artigi_maks_mm": round(float(a.max()), 4),
        "olcek_mm_px_en_kucuk": round(float(olcek.min()), 4),
        "olcek_mm_px_en_buyuk": round(float(olcek.max()), 4),
        "olcek_degisimi_yuzde": round(float(100 * (olcek.max() - olcek.min())
                                            / max(olcek.min(), 1e-9)), 1),
        "uyarilar": [],
    }
    if model.tur == "duzlem":
        r["uyarilar"].append(
            "Tek yükseklikte kuruldu: topraktan yüksekteki yaprak kayar ve "
            "kayma ölçülemez. İki yükseklikte tur atarsanız 'uzay' modeli "
            "kurulur ve paralaks çözülür.")
    if len(noktalar) < 12:
        r["uyarilar"].append(
            f"{len(noktalar)} nokta az. Benzetimde 12 nokta 0.03 mm veriyordu; "
            "daha azında distorsiyon tam ayrışmıyor.")
    r["uyarilar"].append(
        "Bu satırdaki 'kendi_artigi' DOĞRULUK DEĞİLDİR — model bu noktalara "
        "uydurulmuş. Gerçek sayı için capraz_dogrula() ya da makineyle "
        "ölçülmüş yeni kontrol noktaları.")
    return r


def dogrula(model: Model, kontrol: Sequence[Nokta]) -> dict:
    """Kalibrasyonda KULLANILMAMIŞ noktalarla gerçek doğruluk."""
    if not kontrol:
        return {"nokta": 0, "rms_mm": None,
                "not": "Kontrol noktası verilmedi; doğruluk bilinmiyor."}
    a = _artiklar(model, kontrol)
    px, mm, _ = _diziye(kontrol)
    fark = np.array([model.px2mm(px[i:i + 1],
                                 kontrol[i].h_mm if model.tur == "uzay" else None)[0]
                     - mm[i] for i in range(len(kontrol))])
    return {
        "nokta": len(kontrol),
        "rms_mm": round(float(np.sqrt(np.mean(a ** 2))), 3),
        "ortalama_mm": round(float(a.mean()), 3),
        "maks_mm": round(float(a.max()), 3),
        # Sistematik mi rastgele mi: ortalama vektörün boyu toplam hataya
        # yakınsa kayma sistematiktir (model/orijin), sıfıra yakınsa gürültü.
        "sistematik_kayma_mm": [round(float(fark[:, 0].mean()), 3),
                                round(float(fark[:, 1].mean()), 3)],
        "sistematik_oran": round(float(np.linalg.norm(fark.mean(axis=0))
                                       / max(a.mean(), 1e-9)), 2),
    }
