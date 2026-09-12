"""
duzlem — piksel <-> yatak (mm) dönüşümü.

Kalibrasyon, yatağın üstüne toprak yüzeyine yapıştırılmış 4 adet AprilTag
36h11 (kimlikler 0, 1, 8, 9) ile kurulur. Homografi H, kalibrasyon karesinin
piksel koordinatlarını makine düzlemine (X 0..540, Y 0..645 mm) taşır.

DİKKAT — en sık yapılan üç hata bu modülde tuzağa düşürülmüştür:

  1) H bir ÇÖZÜNÜRLÜĞE bağlıdır. 3840x2880'de hesaplanan H'yi 640 px'lik bir
     kareye uygularsanız sonuç 6 kat yanlıştır. `Duzlem.olcekle()` bunu
     düzeltir; `piksel_to_mm` çağrısı kare boyutunu doğrular ve uyuşmazsa
     ValueError atar. Sessizce yanlış sayı üretmez.

  2) Homografi YALNIZ toprak düzleminde geçerlidir. Kamera eğik baktığı için
     h mm yüksekliğindeki bir filizin tepesi, tabanından
        kayma = |M - N| * h / Hkam
     kadar uzağa düşer (N = kameranın toprağa dik izdüşümü, Hkam = kamera
     yüksekliği). `paralaks_duzelt()` bunu geri alır.

  3) Eksen yönü / kaynak köşe karışması. `oz_denetim()` kayıtlı etiket
     mm koordinatlarını piksele geri projekte eder; etiketlerin üstüne
     düşmüyorsa X/Y takas edilmiş ya da bir eksen ters demektir.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


def _homojen(p: np.ndarray) -> np.ndarray:
    p = np.asarray(p, dtype=np.float64).reshape(-1, 2)
    return np.hstack([p, np.ones((len(p), 1))])


def _bol(ph: np.ndarray) -> np.ndarray:
    w = ph[:, 2:3]
    if np.any(np.abs(w) < 1e-12):
        raise ValueError("Homografi tekil nokta üretti (ufuk çizgisi).")
    return ph[:, :2] / w


@dataclass
class Duzlem:
    H: np.ndarray                       # 3x3, piksel -> mm
    kare_boyu: tuple[int, int]          # H'nin geçerli olduğu (genislik, yukseklik)
    yatak_mm: tuple[float, float] = (540.0, 645.0)
    nadir_mm: tuple[float, float] | None = None      # kameranın toprağa dik izdüşümü
    kamera_yuksekligi_mm: float | None = None
    etiketler: dict | None = None       # {"0": {"piksel":[x,y], "mm":[X,Y]}, ...}
    artik_rms_mm: float | None = None

    # ---------- kurulum ----------

    @classmethod
    def yukle(cls, yol: str | Path) -> "Duzlem":
        d = json.loads(Path(yol).read_text("utf-8"))
        return cls(
            H=np.asarray(d["H"], dtype=np.float64),
            kare_boyu=tuple(d["kare_boyu"]),
            yatak_mm=tuple(d.get("yatak_mm", (540.0, 645.0))),
            nadir_mm=tuple(d["nadir_mm"]) if d.get("nadir_mm") else None,
            kamera_yuksekligi_mm=d.get("kamera_yuksekligi_mm"),
            etiketler=d.get("etiketler"),
            artik_rms_mm=d.get("artik_rms_mm"),
        )

    def kaydet(self, yol: str | Path) -> Path:
        yol = Path(yol)
        yol.parent.mkdir(parents=True, exist_ok=True)
        yol.write_text(json.dumps({
            "surum": 1,
            "H": self.H.tolist(),
            "kare_boyu": list(self.kare_boyu),
            "yatak_mm": list(self.yatak_mm),
            "nadir_mm": list(self.nadir_mm) if self.nadir_mm else None,
            "kamera_yuksekligi_mm": self.kamera_yuksekligi_mm,
            "etiketler": self.etiketler,
            "artik_rms_mm": self.artik_rms_mm,
        }, indent=2, ensure_ascii=False), "utf-8")
        return yol

    @classmethod
    def etiketlerden(cls, piksel_mm_ciftleri: dict[int, tuple], kare_boyu,
                     yatak_mm=(540.0, 645.0)) -> "Duzlem":
        """
        piksel_mm_ciftleri: {etiket_id: ((px, py), (X_mm, Y_mm))}
        En az 4 etiket gerekir (homografi 8 serbestlik derecesi).
        """
        import cv2
        if len(piksel_mm_ciftleri) < 4:
            raise ValueError(
                f"Homografi için en az 4 etiket gerek, {len(piksel_mm_ciftleri)} var."
            )
        src = np.array([v[0] for v in piksel_mm_ciftleri.values()], np.float64)
        dst = np.array([v[1] for v in piksel_mm_ciftleri.values()], np.float64)
        H, _ = cv2.findHomography(src, dst, method=0)  # tam çözüm, RANSAC yok
        if H is None:
            raise ValueError("Homografi çözülemedi; etiketler eşdoğrusal olabilir.")
        d = cls(H=H, kare_boyu=tuple(kare_boyu), yatak_mm=tuple(yatak_mm),
                etiketler={str(k): {"piksel": list(v[0]), "mm": list(v[1])}
                           for k, v in piksel_mm_ciftleri.items()})
        d.artik_rms_mm = d.oz_denetim()["artik_rms_mm"]
        return d

    # ---------- çözünürlük ----------

    def olcekle(self, yeni_boy: tuple[int, int]) -> "Duzlem":
        """H'yi başka bir kare boyutuna taşı. Oran korunmalı."""
        gx = yeni_boy[0] / self.kare_boyu[0]
        gy = yeni_boy[1] / self.kare_boyu[1]
        if abs(gx - gy) > 1e-3:
            raise ValueError(
                f"En-boy oranı değişmiş: {self.kare_boyu} -> {yeni_boy}. "
                "Kırpılmış kareye kalibrasyon uygulanamaz."
            )
        S_ters = np.diag([1.0 / gx, 1.0 / gy, 1.0])
        return Duzlem(H=self.H @ S_ters, kare_boyu=tuple(yeni_boy),
                      yatak_mm=self.yatak_mm, nadir_mm=self.nadir_mm,
                      kamera_yuksekligi_mm=self.kamera_yuksekligi_mm,
                      etiketler=self.etiketler, artik_rms_mm=self.artik_rms_mm)

    def _boyu_dogrula(self, kare_boyu):
        if kare_boyu is None:
            return
        if tuple(kare_boyu) != tuple(self.kare_boyu):
            raise ValueError(
                f"Kalibrasyon {self.kare_boyu} için; kare {tuple(kare_boyu)}. "
                "Önce Duzlem.olcekle() çağırın."
            )

    # ---------- dönüşüm ----------

    def piksel_to_mm(self, noktalar, kare_boyu=None) -> np.ndarray:
        self._boyu_dogrula(kare_boyu)
        return _bol(_homojen(noktalar) @ self.H.T)

    def mm_to_piksel(self, noktalar, kare_boyu=None) -> np.ndarray:
        self._boyu_dogrula(kare_boyu)
        return _bol(_homojen(noktalar) @ np.linalg.inv(self.H).T)

    def paralaks_duzelt(self, mm, yukseklik_mm: float) -> np.ndarray:
        """
        Toprak düzlemine projekte edilmiş noktayı, cismin gerçek taban
        konumuna geri çeker.  taban = M - (M - N) * h / Hkam
        nadir/kamera yüksekliği bilinmiyorsa nokta olduğu gibi döner.
        """
        mm = np.asarray(mm, np.float64).reshape(-1, 2)
        if self.nadir_mm is None or not self.kamera_yuksekligi_mm:
            return mm
        N = np.asarray(self.nadir_mm, np.float64)
        k = float(yukseklik_mm) / float(self.kamera_yuksekligi_mm)
        return mm - (mm - N) * k

    # ---------- ölçek / alan ----------

    def mm_basina_piksel(self, mm_noktasi) -> float:
        """Verilen mm noktasında yerel ölçek (px/mm). Eğik kamerada yere göre değişir."""
        p0 = self.mm_to_piksel([mm_noktasi])[0]
        p1 = self.mm_to_piksel([[mm_noktasi[0] + 1.0, mm_noktasi[1]]])[0]
        p2 = self.mm_to_piksel([[mm_noktasi[0], mm_noktasi[1] + 1.0]])[0]
        return float((np.linalg.norm(p1 - p0) + np.linalg.norm(p2 - p0)) / 2.0)

    def olcek_ozeti(self) -> dict:
        """Yatağın 5 noktasında ölçülmüş mm/piksel. Tahmin değil, H'den hesap."""
        W, Hy = self.yatak_mm
        nok = {"sol_ust": (0, 0), "sag_ust": (W, 0), "sol_alt": (0, Hy),
               "sag_alt": (W, Hy), "merkez": (W / 2, Hy / 2)}
        return {ad: round(1.0 / self.mm_basina_piksel(p), 4) for ad, p in nok.items()}

    def alan_mm2(self, kontur_piksel) -> float:
        """Konturu mm'ye taşıyıp ayakkabı bağı formülüyle gerçek alan. Ölçek
        yatak boyunca değiştiği için piksel alanı * sabit yapılmaz."""
        mm = self.piksel_to_mm(np.asarray(kontur_piksel).reshape(-1, 2))
        x, y = mm[:, 0], mm[:, 1]
        return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2.0)

    # ---------- yardımcı ----------

    def yatak_icinde(self, mm, pay_mm: float = 0.0) -> np.ndarray:
        mm = np.asarray(mm, np.float64).reshape(-1, 2)
        W, Hy = self.yatak_mm
        return ((mm[:, 0] >= -pay_mm) & (mm[:, 0] <= W + pay_mm) &
                (mm[:, 1] >= -pay_mm) & (mm[:, 1] <= Hy + pay_mm))

    def yatak_maskesi(self, kare_boyu, ic_pay_mm: float = 0.0) -> np.ndarray:
        """
        Yatak dışını eleyen ikili maske.

        ic_pay_mm: yatak sınırından İÇERİ doğru bırakılan pay. Yatağın kenarı
        keskin bir çizgi değildir: çerçeve tahtası, dışarıdaki çim ve warp
        kenarındaki karışık pikseller sınırın hemen içine yeşil sızdırır ve
        yatağı çevreleyen ince bir halka sahte nesne üretir. Birkaç mm pay bu
        halkayı kaynağında keser. Payı, kenardaki gerçek filizleri kaçırmamak
        için olabildiğince küçük tutun.
        """
        import cv2
        W, Hy = self.yatak_mm
        p = float(ic_pay_mm)
        kose = self.mm_to_piksel([(p, p), (W - p, p), (W - p, Hy - p), (p, Hy - p)],
                                 kare_boyu)
        m = np.zeros((kare_boyu[1], kare_boyu[0]), np.uint8)
        cv2.fillPoly(m, [np.round(kose).astype(np.int32)], 255)
        return m

    def mm_cember_piksel(self, merkez_mm, yaricap_mm: float, n: int = 48) -> np.ndarray:
        """
        mm uzayında bir çember -> piksel uzayında çokgen (eğik kamerada elips).
        Tespitleri daire içine alırken bunu kullanın: daire gerçekten yatakta
        r mm ise kalibrasyon doğrudur; yamuk duruyorsa değildir.
        """
        t = np.linspace(0, 2 * np.pi, n, endpoint=False)
        cember = np.stack([merkez_mm[0] + yaricap_mm * np.cos(t),
                           merkez_mm[1] + yaricap_mm * np.sin(t)], axis=1)
        return self.mm_to_piksel(cember)

    # ---------- öz denetim ----------

    def oz_denetim(self) -> dict:
        """
        Kalibrasyonun kendi etiketleri üzerindeki artığı. Bu sayı taramanın
        güvenilirlik damgasıdır; eşiği aşarsa koordinat yayımlanmaz.
        """
        if not self.etiketler:
            return {"artik_rms_mm": None, "sebep": "etiket kaydı yok"}
        pik = np.array([e["piksel"] for e in self.etiketler.values()], np.float64)
        gercek = np.array([e["mm"] for e in self.etiketler.values()], np.float64)
        kestirim = self.piksel_to_mm(pik)
        hata = np.linalg.norm(kestirim - gercek, axis=1)
        return {
            "artik_rms_mm": float(np.sqrt(np.mean(hata ** 2))),
            "artik_max_mm": float(hata.max()),
            "etiket_basina_mm": {k: round(float(h), 3)
                                 for k, h in zip(self.etiketler.keys(), hata)},
        }


def nadir_ve_yukseklik_coz(olcumler) -> dict:
    """
    Paralaks düzeltmesi için N (nadir) ve Hkam'ı ÖLÇÜMDEN çözer.

    olcumler: [(taban_mm, yukseklik_mm, olculen_mm), ...]
      Aynı etiketi önce toprağa, sonra bilinen h yüksekliğinde bir takozun
      üstüne koyup homografiyle okuduğunuz iki değer. En az 2 farklı konum.

        olculen - taban = (taban - N) * h / (Hkam - h)
      k = h/(Hkam-h) olmak üzere doğrusal en küçük kareler ile N ve k çözülür.
    """
    A, b = [], []
    for taban, h, olculen in olcumler:
        taban = np.asarray(taban, np.float64)
        olculen = np.asarray(olculen, np.float64)
        d = olculen - taban
        # d = k*(taban - N)  ->  k*taban - k*N = d ; bilinmeyen: k, kNx, kNy
        A.append([taban[0], -1.0, 0.0]); b.append(d[0])
        A.append([taban[1], 0.0, -1.0]); b.append(d[1])
    A = np.asarray(A); b = np.asarray(b)
    if len(A) < 3:
        raise ValueError("En az 2 farklı konumda ölçüm gerekir.")
    coz, artik, *_ = np.linalg.lstsq(A, b, rcond=None)
    k, kNx, kNy = coz
    if abs(k) < 1e-9:
        raise ValueError("Kayma ölçülemedi; takoz yüksekliği yetersiz olabilir.")
    h_ort = float(np.mean([o[1] for o in olcumler]))
    return {
        "nadir_mm": [float(kNx / k), float(kNy / k)],
        "kamera_yuksekligi_mm": float(h_ort / k + h_ort),
        "artik": float(artik[0]) if len(artik) else None,
    }
