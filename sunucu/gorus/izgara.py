"""
izgara — elle tanımlanan dörtgen bölgelerle perspektif kalibrasyonu.

FİKİR: kamera görüntüsü üzerinde bir ya da daha çok dörtgen (hücre) tanımlanır.
Her hücrenin dört köşesinin PİKSEL konumu ve karşılık gelen GERÇEK makine
(X, Y) mm koordinatı elle girilir. Her hücre için cv2.getPerspectiveTransform
ile kendi homografisi çözülür.

NEDEN ÇOK HÜCRE TEK HÜCREDEN İYİ
Tek homografi, kameranın ideal bir delik iğne (pinhole) olduğunu ve toprağın
kusursuz düzlem olduğunu varsayar. İkisi de tam doğru değildir: lens kenarlara
doğru bozar, toprak çukurludur. Her hücre kendi homografisiyle çözülünce bu
sapmalar parça parça soğurulur — hücre küçüldükçe varsayım daha az yanlış olur.
Bedeli, girilecek köşe sayısının artması.

DÜRÜST UYARI — ARTIK SIFIR ÇIKAR VE BU BİR DOĞRULUK ÖLÇÜSÜ DEĞİLDİR
Homografinin 8 serbestlik derecesi var; her köşe 2 denklem verir. TAM 4 köşeyle
çözüm noktalardan birebir geçer, artık zorunlu olarak 0'dır. "Köşeler tam
oturdu" demek, kalibrasyonun doğru olduğunu GÖSTERMEZ. Gerçek doğruluğu
ölçmenin tek yolu bağımsız denetim noktalarıdır: aleti toprak yüzeyinde bilinen
(X, Y) noktalarına sürüp modelin ne dediğine bakmak. `dogrulama()` bunun içindir.

KOORDİNAT DÖNÜŞÜMÜ İNTERPOLASYONLA YAPILMAZ
Perspektif düzeltilmiş (kuşbakışı) görüntüde piksel↔mm ilişkisi saf ölçek +
kaydırmadır. `kusbakisi()` bu ölçeği kendisi kurar; `ortho_to_mm()` tam
dönüşümü verir. Dörtgenin içinde iki doğrusal ara değer hesaplamak gerekmez —
warp bunu zaten tam olarak yapıyor.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path

import numpy as np
import cv2


def _dizi(noktalar) -> np.ndarray:
    a = np.asarray(noktalar, dtype=np.float64).reshape(-1, 2)
    return a


def _saat_yonu_sirala(p: np.ndarray) -> np.ndarray:
    """
    Dört köşeyi sol-üst, sağ-üst, sağ-alt, sol-alt sırasına sokar.
    Elle girilen köşelerin sırası karışırsa homografi burulur ve görüntü
    kelebek gibi katlanır; bu yüzden sıra kullanıcıya bırakılmaz.
    """
    merkez = p.mean(axis=0)
    aci = np.arctan2(p[:, 1] - merkez[1], p[:, 0] - merkez[0])
    sirali = p[np.argsort(aci)]
    # sol-üstten başlat
    bas = np.argmin(sirali.sum(axis=1))
    return np.roll(sirali, -bas, axis=0)


@dataclass
class Hucre:
    """Tek bir dörtgen bölge: 4 köşe pikseli + 4 köşe makine koordinatı (mm)."""
    ad: str
    piksel: list                      # [[x,y] x4]
    mm: list                          # [[X,Y] x4]  aynı sırada
    _H: np.ndarray | None = field(default=None, repr=False, compare=False)
    _Hi: np.ndarray | None = field(default=None, repr=False, compare=False)

    def __post_init__(self):
        p, m = _dizi(self.piksel), _dizi(self.mm)
        if len(p) != 4 or len(m) != 4:
            raise ValueError(f"[{self.ad}] dörtgen 4 köşe ister "
                             f"(piksel {len(p)}, mm {len(m)})")
        self.piksel, self.mm = p.tolist(), m.tolist()
        self._coz()

    def _coz(self):
        p, m = _dizi(self.piksel).astype(np.float32), _dizi(self.mm).astype(np.float32)
        if cv2.contourArea(p) < 1e-6:
            raise ValueError(f"[{self.ad}] piksel köşeleri dejenere (alan ~0) — "
                             "köşeler eşdoğrusal ya da üst üste olabilir")
        if cv2.contourArea(m) < 1e-6:
            raise ValueError(f"[{self.ad}] mm köşeleri dejenere (alan ~0)")
        self._H = cv2.getPerspectiveTransform(p, m).astype(np.float64)   # piksel -> mm
        self._Hi = np.linalg.inv(self._H)

    # ---- dönüşüm ----
    @property
    def H(self) -> np.ndarray:
        if self._H is None:
            self._coz()
        return self._H

    def piksel_to_mm(self, noktalar) -> np.ndarray:
        n = _dizi(noktalar)
        h = np.hstack([n, np.ones((len(n), 1))]) @ self.H.T
        return h[:, :2] / h[:, 2:3]

    def mm_to_piksel(self, noktalar) -> np.ndarray:
        n = _dizi(noktalar)
        h = np.hstack([n, np.ones((len(n), 1))]) @ self._Hi.T
        return h[:, :2] / h[:, 2:3]

    # ---- kapsama ----
    def piksel_icinde(self, noktalar, pay=0.0) -> np.ndarray:
        c = _dizi(self.piksel).astype(np.float32)
        return np.array([cv2.pointPolygonTest(c, (float(x), float(y)), True) >= -pay
                         for x, y in _dizi(noktalar)], bool)

    def mm_icinde(self, noktalar, pay=0.0) -> np.ndarray:
        c = _dizi(self.mm).astype(np.float32)
        return np.array([cv2.pointPolygonTest(c, (float(x), float(y)), True) >= -pay
                         for x, y in _dizi(noktalar)], bool)

    def mm_sinirlari(self) -> tuple[float, float, float, float]:
        m = _dizi(self.mm)
        return float(m[:, 0].min()), float(m[:, 1].min()), \
               float(m[:, 0].max()), float(m[:, 1].max())

    def olcek_mm_px(self) -> dict:
        """Hücrenin dört köşesinde mm/piksel. Eğik bakışta köşeler arası fark açılır."""
        out = {}
        for i, ad in enumerate(("k1", "k2", "k3", "k4")):
            p0 = _dizi(self.piksel)[i]
            a = self.piksel_to_mm([p0])[0]
            b = self.piksel_to_mm([[p0[0] + 1.0, p0[1]]])[0]
            c = self.piksel_to_mm([[p0[0], p0[1] + 1.0]])[0]
            out[ad] = round(float((np.linalg.norm(b - a) + np.linalg.norm(c - a)) / 2), 4)
        return out

    def sozluk(self) -> dict:
        return {"ad": self.ad, "piksel": self.piksel, "mm": self.mm}


@dataclass
class Izgara:
    """Bir ya da daha çok hücre. Hücreler bitişik olabilir, olmak zorunda değil."""
    hucreler: list[Hucre]
    kare_boyu: tuple[int, int] | None = None       # H'lerin geçerli olduğu kare
    yatak_mm: tuple[float, float] = (540.0, 645.0)
    aciklama: str = ""

    # ---------- kayıt ----------
    @classmethod
    def yukle(cls, yol) -> "Izgara":
        d = json.loads(Path(yol).read_text("utf-8"))
        return cls(
            hucreler=[Hucre(ad=h.get("ad", f"h{i}"), piksel=h["piksel"], mm=h["mm"])
                      for i, h in enumerate(d["hucreler"])],
            kare_boyu=tuple(d["kare_boyu"]) if d.get("kare_boyu") else None,
            yatak_mm=tuple(d.get("yatak_mm", (540.0, 645.0))),
            aciklama=d.get("aciklama", ""))

    def kaydet(self, yol) -> Path:
        yol = Path(yol)
        yol.parent.mkdir(parents=True, exist_ok=True)
        yol.write_text(json.dumps({
            "surum": 1, "aciklama": self.aciklama,
            "kare_boyu": list(self.kare_boyu) if self.kare_boyu else None,
            "yatak_mm": list(self.yatak_mm),
            "hucreler": [h.sozluk() for h in self.hucreler],
        }, indent=2, ensure_ascii=False), "utf-8")
        return yol

    # ---------- çözünürlük ----------
    def olcekle(self, yeni_boy) -> "Izgara":
        """
        Köşe pikselleri bir ÇÖZÜNÜRLÜĞE bağlıdır. 3840 genişlikte tıklanan
        köşeleri 640 piksellik kareye uygulamak 6 kat hata demektir.
        """
        if self.kare_boyu is None:
            raise ValueError("kare_boyu bilinmiyor; ölçekleme yapılamaz")
        gx = yeni_boy[0] / self.kare_boyu[0]
        gy = yeni_boy[1] / self.kare_boyu[1]
        if abs(gx - gy) > 1e-3:
            raise ValueError(f"En-boy oranı değişmiş: {self.kare_boyu} -> "
                             f"{tuple(yeni_boy)}. Kırpılmış kareye uygulanamaz.")
        return Izgara(
            hucreler=[Hucre(h.ad, (_dizi(h.piksel) * gx).tolist(), h.mm)
                      for h in self.hucreler],
            kare_boyu=tuple(yeni_boy), yatak_mm=self.yatak_mm,
            aciklama=self.aciklama)

    def _boyu_dogrula(self, kare_boyu):
        if kare_boyu is None or self.kare_boyu is None:
            return
        if tuple(kare_boyu) != tuple(self.kare_boyu):
            raise ValueError(f"Izgara {self.kare_boyu} için tanımlı; kare "
                             f"{tuple(kare_boyu)}. Önce Izgara.olcekle() çağırın.")

    # ---------- dönüşüm ----------
    def hucre_bul_piksel(self, nokta, pay=0.0) -> Hucre | None:
        for h in self.hucreler:
            if h.piksel_icinde([nokta], pay)[0]:
                return h
        return None

    def hucre_bul_mm(self, nokta, pay=0.0) -> Hucre | None:
        for h in self.hucreler:
            if h.mm_icinde([nokta], pay)[0]:
                return h
        return None

    def piksel_to_mm(self, noktalar, kare_boyu=None, disari_izin=False):
        """
        Döner: (mm dizisi, hucre_adlari). Hiçbir hücreye düşmeyen nokta için
        mm = [nan, nan] ve ad = None — en yakın hücreyle tahmin ETMEZ.
        disari_izin=True derseniz en yakın hücrenin modeliyle DIŞARI TAŞIYARAK
        hesaplar ve adın başına "~" koyar; o değer güvenilmezdir.
        """
        self._boyu_dogrula(kare_boyu)
        n = _dizi(noktalar)
        cikti = np.full((len(n), 2), np.nan)
        adlar: list[str | None] = [None] * len(n)
        for i, p in enumerate(n):
            h = self.hucre_bul_piksel(p)
            if h is None and disari_izin and self.hucreler:
                h = min(self.hucreler,
                        key=lambda c: -cv2.pointPolygonTest(
                            _dizi(c.piksel).astype(np.float32),
                            (float(p[0]), float(p[1])), True))
                adlar[i] = "~" + h.ad
            elif h is not None:
                adlar[i] = h.ad
            if h is not None:
                cikti[i] = h.piksel_to_mm([p])[0]
        return cikti, adlar

    def mm_to_piksel(self, noktalar, kare_boyu=None, disari_izin=False):
        self._boyu_dogrula(kare_boyu)
        n = _dizi(noktalar)
        cikti = np.full((len(n), 2), np.nan)
        adlar: list[str | None] = [None] * len(n)
        for i, p in enumerate(n):
            h = self.hucre_bul_mm(p)
            if h is None and disari_izin and self.hucreler:
                h = min(self.hucreler,
                        key=lambda c: -cv2.pointPolygonTest(
                            _dizi(c.mm).astype(np.float32),
                            (float(p[0]), float(p[1])), True))
                adlar[i] = "~" + h.ad
            elif h is not None:
                adlar[i] = h.ad
            if h is not None:
                cikti[i] = h.mm_to_piksel([p])[0]
        return cikti, adlar

    # ---------- kuşbakışı ----------
    def mm_kapsami(self) -> tuple[float, float, float, float]:
        if not self.hucreler:
            return (0.0, 0.0, *self.yatak_mm)
        k = np.array([h.mm_sinirlari() for h in self.hucreler])
        return (float(k[:, 0].min()), float(k[:, 1].min()),
                float(k[:, 2].max()), float(k[:, 3].max()))

    def kusbakisi(self, bgr, px_mm=4.0, kenar_mm=0.0, kapsam=None):
        """
        Bütün hücreleri tek bir kuşbakışı tuvale diker.

        Döner: (ortho_bgr, bilgi) — bilgi içinde `ortho_to_mm` / `mm_to_ortho`
        dönüşümleri var ve bunlar SAF ÖLÇEK+KAYDIRMA'dır:
            mm = ortho_px / px_mm + (x0, y0)
        Bu yüzden düzleştirilmiş görüntüde tespit yapıp koordinat çıkarmak
        tamdır; ara değer hesabı gerekmez.
        """
        x0, y0, x1, y1 = kapsam or self.mm_kapsami()
        x0 -= kenar_mm; y0 -= kenar_mm; x1 += kenar_mm; y1 += kenar_mm
        W = int(round((x1 - x0) * px_mm))
        Hh = int(round((y1 - y0) * px_mm))
        if W <= 0 or Hh <= 0:
            raise ValueError("Kuşbakışı tuval boyutu sıfır — mm kapsamı bozuk")

        # mm -> ortho piksel:  p = (mm - (x0,y0)) * px_mm
        S = np.array([[px_mm, 0, -x0 * px_mm],
                      [0, px_mm, -y0 * px_mm],
                      [0, 0, 1.0]], np.float64)

        tuval = np.zeros((Hh, W, 3), np.uint8)
        dolu = np.zeros((Hh, W), np.uint8)
        for h in self.hucreler:
            M = S @ h.H                                   # kamera pikseli -> ortho
            parca = cv2.warpPerspective(bgr, M, (W, Hh), flags=cv2.INTER_LINEAR)
            maske = np.zeros((Hh, W), np.uint8)
            kose = cv2.perspectiveTransform(
                _dizi(h.piksel).reshape(1, -1, 2), M).reshape(-1, 2)
            cv2.fillConvexPoly(maske, np.round(kose).astype(np.int32), 255)
            yeni = (maske > 0) & (dolu == 0)              # çakışmada ilk hücre kazanır
            tuval[yeni] = parca[yeni]
            dolu[maske > 0] = 255

        def ortho_to_mm(noktalar):
            n = _dizi(noktalar)
            return np.stack([n[:, 0] / px_mm + x0, n[:, 1] / px_mm + y0], axis=1)

        def mm_to_ortho(noktalar):
            n = _dizi(noktalar)
            return np.stack([(n[:, 0] - x0) * px_mm, (n[:, 1] - y0) * px_mm], axis=1)

        bilgi = {"px_mm": float(px_mm), "kapsam_mm": [x0, y0, x1, y1],
                 "boyut": [W, Hh], "ortho_to_mm": ortho_to_mm,
                 "mm_to_ortho": mm_to_ortho,
                 "dolu_oran": round(float(np.mean(dolu > 0)), 4)}
        return tuval, bilgi

    # ---------- denetim ----------
    def denetim(self) -> dict:
        """
        Yapısal denetim. DİKKAT: köşe artığı 4 noktada zorunlu olarak ~0'dır,
        doğruluk ölçüsü değildir — `dogrulama()` kullanın.
        """
        rapor = {"hucre_sayisi": len(self.hucreler), "hucreler": {}, "uyarilar": []}
        for h in self.hucreler:
            geri = h.piksel_to_mm(h.piksel)
            artik = float(np.max(np.linalg.norm(geri - _dizi(h.mm), axis=1)))
            olcek = h.olcek_mm_px()
            d = {"kose_artigi_mm": round(artik, 6),
                 "olcek_mm_px": olcek,
                 "olcek_orani": round(max(olcek.values()) / max(min(olcek.values()), 1e-9), 2),
                 "mm_alani": round(float(cv2.contourArea(_dizi(h.mm).astype(np.float32))), 1),
                 "piksel_alani": round(float(cv2.contourArea(
                     _dizi(h.piksel).astype(np.float32))), 1)}
            if d["olcek_orani"] > 3.0:
                rapor["uyarilar"].append(
                    f"[{h.ad}] hücre içi ölçek {d['olcek_orani']}x değişiyor — "
                    "bakış çok eğik ya da hücre çok büyük; bölmeyi düşünün")
            rapor["hucreler"][h.ad] = d

        # hücreler arası çakışma / boşluk
        cakisan = []
        for i, a in enumerate(self.hucreler):
            for b in self.hucreler[i + 1:]:
                ka = _dizi(a.mm).astype(np.float32)
                kb = _dizi(b.mm).astype(np.float32)
                kesisim, _ = cv2.intersectConvexConvex(ka, kb)
                if kesisim > 1.0:
                    cakisan.append({"a": a.ad, "b": b.ad,
                                    "kesisim_mm2": round(float(kesisim), 1)})
        rapor["cakisan_hucreler"] = cakisan
        if cakisan:
            rapor["uyarilar"].append(
                f"{len(cakisan)} hücre çifti mm uzayında çakışıyor; çakışan "
                "bölgede ilk tanımlanan hücre kullanılır")

        kapsam = self.mm_kapsami()
        kapsanan = sum(cv2.contourArea(_dizi(h.mm).astype(np.float32))
                       for h in self.hucreler)
        yatak_alani = self.yatak_mm[0] * self.yatak_mm[1]
        rapor["mm_kapsami"] = [round(v, 1) for v in kapsam]
        rapor["kapsanan_alan_mm2"] = round(float(kapsanan), 1)
        rapor["yatak_kapsama_yuzde"] = round(100.0 * kapsanan / yatak_alani, 1)
        if rapor["yatak_kapsama_yuzde"] < 90:
            rapor["uyarilar"].append(
                f"Hücreler yatağın yalnız %{rapor['yatak_kapsama_yuzde']}'ini "
                "kapsıyor; dışarıda kalan bölgede koordinat üretilmez")
        rapor["not"] = ("Köşe artığı 4 noktada zorunlu olarak ~0 çıkar (8 denklem, "
                        "8 bilinmeyen). Doğruluk ölçüsü DEĞİLDİR; dogrulama() ile "
                        "bağımsız nokta ölçün.")
        return rapor

    def dogrulama(self, olcumler, kare_boyu=None) -> dict:
        """
        GERÇEK DOĞRULUK. olcumler: [((piksel_x, piksel_y), (mm_X, mm_Y)), ...]
        Aleti toprak yüzeyinde bilinen noktalara sürüp, o noktanın karedeki
        pikselini işaretleyerek toplayın. Köşelerden BAĞIMSIZ noktalar olsun;
        köşeleri tekrar ölçmek sıfır verir ve hiçbir şey söylemez.
        """
        if not olcumler:
            return {"yapilabildi": False, "sebep": "denetim noktası verilmedi"}
        hatalar, detay = [], []
        for i, (pik, gercek) in enumerate(olcumler):
            mm, adlar = self.piksel_to_mm([pik], kare_boyu)
            if np.isnan(mm[0]).any():
                detay.append({"no": i, "hucre": None, "hata_mm": None,
                              "sebep": "hiçbir hücrenin içine düşmüyor"})
                continue
            h = float(np.linalg.norm(mm[0] - np.asarray(gercek, float)))
            hatalar.append(h)
            detay.append({"no": i, "hucre": adlar[0], "hata_mm": round(h, 2),
                          "kestirilen_mm": [round(float(v), 1) for v in mm[0]],
                          "gercek_mm": [round(float(v), 1) for v in gercek]})
        if not hatalar:
            return {"yapilabildi": False, "sebep": "hiçbir nokta hücrelere düşmedi",
                    "detay": detay}
        d = np.asarray(hatalar)
        return {"yapilabildi": True, "nokta_sayisi": len(hatalar),
                "rms_mm": round(float(np.sqrt(np.mean(d ** 2))), 2),
                "ortalama_mm": round(float(d.mean()), 2),
                "max_mm": round(float(d.max()), 2),
                "detay": detay,
                "not": "Bu sayı sistemin gerçek konum doğruluğudur."}


# ------------------------------------------------------------------ yardımcılar

def dikdortgen_izgara(piksel_koseler, mm_koseler, satir=1, sutun=1,
                      ad_onek="h") -> Izgara:
    """
    Tek bir dış dörtgeni satır x sütun hücreye böler. Ara köşeler, dış
    dörtgenin homografisiyle üretilir — yani ARA KÖŞELER ÖLÇÜLMÜŞ DEĞİL,
    TÜRETİLMİŞTİR. Bu, tek homografiden daha doğru sonuç vermez; yalnız
    başlangıç şablonu üretir. Asıl kazanç, ara köşeleri sonra ELLE
    düzelttiğinizde gelir.
    """
    dis = Hucre(f"{ad_onek}_dis", piksel_koseler, mm_koseler)
    m = _dizi(mm_koseler)
    hucreler = []
    for i in range(satir):
        for j in range(sutun):
            u, v = i / satir, j / sutun
            u2, v2 = (i + 1) / satir, (j + 1) / sutun

            def koy(a, b):
                # dış dörtgenin mm köşeleri üzerinde iki doğrusal ara değer
                ust = m[0] + (m[1] - m[0]) * b
                alt = m[3] + (m[2] - m[3]) * b
                return ust + (alt - ust) * a

            mm4 = [koy(u, v), koy(u, v2), koy(u2, v2), koy(u2, v)]
            pik4 = dis.mm_to_piksel(mm4)
            hucreler.append(Hucre(f"{ad_onek}{i}{j}", pik4.tolist(),
                                  np.asarray(mm4).tolist()))
    return Izgara(hucreler=hucreler)


def kose_sirala(piksel_koseler) -> list:
    """Elle girilen dört köşeyi sol-üst'ten saat yönüne sokar."""
    return _saat_yonu_sirala(_dizi(piksel_koseler)).tolist()
