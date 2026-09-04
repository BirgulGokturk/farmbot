"""AprilTag ile kamera kalibrasyonu — ölçümün TEK yolu.

NEDEN VAR. Önceki iki yöntem de kullanıcının bir piksele TIKLAMASINA
dayanıyordu: "iki kare" hareketli kamerada, "ölçek" sabit kamerada.
Tıklama 3-5 piksel şaşıyor ve o şaşma karenin tamamına yayılıyor — 640
piksellik bir karede 4 piksel, %0,6 ölçek hatası demek; 535 mm'lik
yatakta 3 mm. İkisi de kaldırıldı; buradaki yol ikisinin de yerini
alıyor.

AprilTag'in dört köşesi matematiksel olarak tanımlı ve algılayıcı onları
alt piksel hassasiyetiyle buluyor. İnsan eli işin içinden çıkıyor.

SABİT KAMERANIN ASIL DERDİNİ DE BU ÇÖZÜYOR. Sabit kameranın karesinin
makine koordinatı yok; bu yüzden çözümleme "bu leke yatağın şurasında"
diyemiyordu. Koordinatı BİLİNEN yerlere etiket yapıştırılırsa kamera
ölçeği, dönmeyi ve konumu birden öğreniyor — kare yatağa oturuyor.

ÜÇ SEVİYE:

  * **bir etiket + kenar ölçüsü** → yalnız `mm_px`. Kayıt gerekmiyor,
    etiketi eline alıp kadraja tutman yetiyor.
  * **iki ya da daha çok etiket + makine koordinatları** → `mm_px`,
    `donme`, `ofset_x/y`. Bahçenin zemini yerine oturuyor.
  * **dört ya da daha çok etiket** → üstüne **harita** (perspektifli
    homografi). Eğik bakan kamerada sahada ölçüldü: benzerlik 51,8 mm,
    harita 9,3 mm yanılıyordu.

HAREKETLİ KAMERADA SONUÇ GÖRECELİYE ÇEVRİLİYOR. Etiketler yatağa
yapıştırılı, koordinatları mutlak; çözüm de mutlak çıkıyor. Sabit
kamerada aranan tam bu. Uç kamerasında ise `ofset` "kameranın UÇTAN
kayması" demek ve makinenin tarama anındaki konumu çıkarılıyor.

Üç ve daha çok etiketle ARTIK (residual) anlamlı oluyor ve kalibrasyonun
ne kadar tuttuğunu söylüyor. İki etikette artık her zaman sıfır çıkar —
iki nokta benzerlik dönüşümünü tam belirler — o yüzden orada "0,0 mm"
yazıp güven vermiyoruz, "iki etiketle artık ölçülemez" diyoruz.

OpenCV İSTEĞE BAĞLI. `goruntu.py` ile aynı gerekçe: kurulu değilse yalnız
bu yol kapanıyor, elle kalibrasyon ve makinenin geri kalanı çalışmaya
devam ediyor.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
import threading
from typing import Any

_KILIT = threading.RLock()

#: AprilTag ailesi. 36h11 en dayanıklısı ve en yaygını: 587 farklı kimlik,
#: yanlış okuma oranı pratikte sıfır. Aile değiştirmek basılı etiketleri
#: çöpe atmak demek, o yüzden sabit.
AILE = "DICT_APRILTAG_36h11"

#: Etiketin fiziksel kenar uzunluğu bilinmiyorsa ölçek çıkarılamaz.
#: Varsayılan yok — uydurulmuş bir kenar, uydurulmuş bir milimetre demek.
VARSAYILAN_KONUMLAR: dict[str, Any] = {
    "kenar_mm": 0.0,     # etiketin SİYAH karesinin kenarı (mm), 0 = bilinmiyor
    "etiketler": {},     # {"0": {"x": 20.0, "y": 20.0}, ...} makine mm
}


class EtiketHatasi(Exception):
    """Etiket algılanamadı ya da verilen değer geçersiz."""


# --------------------------------------------------------------------------- #
# Algılama
# --------------------------------------------------------------------------- #
def _cv2():
    """OpenCV'yi tembel içe aktarıyor.

    Kurulu değilse SEBEBİ yazan bir hata veriyoruz: "etiket okunamadı" gibi
    içi boş bir mesaj, kullanıcıyı kameraya ve baskıya baktırırdı.
    """
    try:
        import cv2  # type: ignore
    except ImportError as hata:
        raise EtiketHatasi(
            "OpenCV kurulu değil — AprilTag okunamıyor. Pi'de: "
            "sudo apt install -y python3-opencv") from hata
    if not hasattr(cv2, "aruco"):
        raise EtiketHatasi(
            "OpenCV'de aruco modülü yok (contrib derlemesi gerekiyor). "
            "Pi'de: sudo apt install -y python3-opencv")
    if not hasattr(cv2.aruco, AILE):
        raise EtiketHatasi(
            f"Bu OpenCV sürümü {AILE} ailesini tanımıyor; 4.7 ve üstü gerekiyor.")
    return cv2


def _parametreler(cv2):
    """Küçük ve eğik duran etiketler için ayarlanmış algılama parametreleri.

    Varsayılanlar, kadrajı dolduran ve karşıdan bakılan etikete göre
    seçilmiş. Bizim durumumuz ikisi de değil: etiketler karede ~40 piksel
    ve kamera yatağa sert açıyla bakıyor. Sahada dört etiketin ikisi
    bulunamadı; aşağıdaki üç ayar tam bu iki zorluğa denk geliyor.
    """
    par = (cv2.aruco.DetectorParameters() if hasattr(cv2.aruco, "ArucoDetector")
           else cv2.aruco.DetectorParameters_create())

    # KÜÇÜK ETİKET. Aday dörtgenin çevresi, görüntü kenarının en az bu
    # kadarı olmalı. 0.03 varsayılanı 640 piksellik karede ~19 piksellik
    # kenar demek; uzaktaki etiket bunun altına düşüp elenmeden önce
    # okunabilir hâlde kalıyor. Sıfıra indirmiyoruz — çok küçük adaylar
    # gürültüden ayırt edilemez ve yanlış okuma üretir.
    par.minMarkerPerimeterRate = 0.01

    # EĞİK BAKIŞ. Kare, perspektifte yamuğa dönüşüyor; köşe bulucunun
    # çokgen yaklaşımına verdiği pay dar kalınca dörtgen "dörtgen değil"
    # diye eleniyor.
    par.polygonalApproxAccuracyRate = 0.06

    # DEĞİŞKEN IŞIK. Yatağın bir ucu gölgede, öbürü pencereden ışık
    # alıyor. Eşikleme penceresini geniş bir aralıkta deniyoruz.
    par.adaptiveThreshWinSizeMin = 3
    par.adaptiveThreshWinSizeMax = 43
    par.adaptiveThreshWinSizeStep = 4

    # ALT PİKSEL KÖŞE. Kalibrasyonun tamamı köşe konumlarından çıkıyor;
    # tam piksele yuvarlanmış köşe, doğrudan milimetre hatası demek.
    if hasattr(cv2.aruco, "CORNER_REFINE_SUBPIX"):
        par.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        par.cornerRefinementWinSize = 5

    return par


def _algilayici(cv2):
    """Sürüm farkını burada yutuyoruz: 4.7'de sınıf, öncesinde işlev."""
    sozluk = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, AILE))
    par = _parametreler(cv2)
    if hasattr(cv2.aruco, "ArucoDetector"):
        return cv2.aruco.ArucoDetector(sozluk, par)
    return None, sozluk, par


def algila_ve_boyut(jpeg: bytes) -> tuple[list[dict[str, Any]], int, int]:
    """`algila` + karenin piksel ölçüsü, TEK çözmeyle.

    Ölçü karenin kendisinden okunuyor, panelden gelen sayıya güvenilmiyor:
    kalibrasyonun ofseti kare merkezine göre tanımlı ve yanlış bir genişlik
    bütün yerleşimi kaydırırdı.
    """
    etiketler = algila(jpeg)
    import numpy as np
    cv2 = _cv2()
    gri = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if gri is None:
        raise EtiketHatasi("Kare çözülemedi — JPEG bozuk olabilir")
    return etiketler, int(gri.shape[1]), int(gri.shape[0])


def algila(jpeg: bytes) -> list[dict[str, Any]]:
    """Karedeki AprilTag'ler — [{"kimlik", "kose", "merkez", "kenar_px"}].

    `kose` dört köşenin piksel koordinatı, algılayıcının verdiği sırada.
    `kenar_px` dört kenarın ortalaması: ölçek bundan çıkıyor ve tek bir
    kenara bakmaktan daha dayanıklı, çünkü etiket hafif eğik durursa
    kenarlar farklı uzunlukta görünüyor.
    """
    cv2 = _cv2()
    import numpy as np  # cv2 zaten numpy'a bağlı

    dizi = np.frombuffer(jpeg, dtype=np.uint8)
    gri = cv2.imdecode(dizi, cv2.IMREAD_GRAYSCALE)
    if gri is None:
        raise EtiketHatasi("Kare çözülemedi — JPEG bozuk olabilir")

    alg = _algilayici(cv2)

    def _bul(g):
        if isinstance(alg, tuple):
            return cv2.aruco.detectMarkers(g, alg[1], parameters=alg[2])
        return alg.detectMarkers(g)

    koseler, kimlikler, _ = _bul(gri)
    olcek = 1.0

    # BÜYÜTÜP TEKRAR DENEME.
    #
    # Etiket karede ne kadar küçükse, hücre başına o kadar az piksel
    # düşüyor ve kod çözme bir noktada tamamen başarısız oluyor —
    # kenarları görülen etiket okunamıyor. Kareyi iki katına çıkarmak
    # yeni bilgi eklemiyor ama çözücüye hücre başına dört kat piksel
    # veriyor ve eşikleme kararı kararsız piksellerde yumuşuyor.
    #
    # BEDELİ VAR: dört kat piksel, dört kat süre. Bu yüzden yalnız az
    # etiket bulunduğunda deneniyor, her karede değil. Bulunan sonuç
    # daha fazlaysa o kazanıyor; eşitse büyütülmüş hâl daha kararlı
    # köşe verdiği için yine o alınıyor.
    bulunan = 0 if kimlikler is None else len(kimlikler)
    if bulunan < 4 and max(gri.shape) <= 2000:
        buyuk = cv2.resize(gri, None, fx=2.0, fy=2.0,
                           interpolation=cv2.INTER_CUBIC)
        k2, i2, _ = _bul(buyuk)
        if i2 is not None and len(i2) >= max(1, bulunan):
            koseler, kimlikler, olcek = k2, i2, 2.0

    if kimlikler is None or len(kimlikler) == 0:
        return []

    cikti: list[dict[str, Any]] = []
    for kose_dizi, kimlik in zip(koseler, kimlikler.flatten()):
        # Büyütülmüş karede bulunduysa koordinatlar ORİJİNAL kareye
        # geri ölçekleniyor: kalibrasyon karenin kendi piksel uzayında
        # tanımlı ve iki katı bir uzaydan gelen sayı her şeyi ikiye
        # katlardı.
        k = [[float(u) / olcek, float(v) / olcek]
             for u, v in kose_dizi.reshape(4, 2)]
        kenarlar = [math.dist(k[i], k[(i + 1) % 4]) for i in range(4)]
        cikti.append({
            "kimlik": int(kimlik),
            "kose": k,
            "merkez": [sum(p[0] for p in k) / 4.0, sum(p[1] for p in k) / 4.0],
            "kenar_px": sum(kenarlar) / 4.0,
            # Kenarların birbirinden ne kadar ayrıldığı: büyükse etiket eğik
            # duruyor ya da kamera dik bakmıyor demek. Sessizce yutmuyoruz.
            "kenar_sapma_yuzde": (
                (max(kenarlar) - min(kenarlar)) / (sum(kenarlar) / 4.0) * 100.0
                if sum(kenarlar) else 0.0),
        })
    cikti.sort(key=lambda e: e["kimlik"])
    return cikti


# --------------------------------------------------------------------------- #
# Etiket konumları — hangi kimlik yatağın neresinde
# --------------------------------------------------------------------------- #
def _yol() -> str:
    ozel = os.environ.get("ETIKET_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "etiket_konumlari.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "etiket_konumlari.json")


def konumlar_oku() -> dict[str, Any]:
    with _KILIT:
        try:
            with open(_yol(), encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (OSError, json.JSONDecodeError):
            return dict(VARSAYILAN_KONUMLAR)
    if not isinstance(veri, dict):
        return dict(VARSAYILAN_KONUMLAR)
    return {
        "kenar_mm": float(veri.get("kenar_mm") or 0.0),
        "etiketler": {str(a): {"x": float(b.get("x", 0.0)), "y": float(b.get("y", 0.0))}
                      for a, b in (veri.get("etiketler") or {}).items()
                      if isinstance(b, dict)},
    }


def konumlar_yaz(ham: dict[str, Any]) -> dict[str, Any]:
    """Etiket kenarı ve kimlik→koordinat kaydı.

    KENAR ÖLÇÜSÜ BASILAN ETİKETİN ÖLÇÜSÜ OLMALI, tasarlananın değil.
    Yazıcılar %0,2-0,5 büzüşüyor ve bu sayı doğrudan `mm_px`i belirliyor;
    buradaki hata bütün kareye yayılıyor.
    """
    try:
        kenar = float(ham.get("kenar_mm") or 0.0)
    except (TypeError, ValueError):
        raise EtiketHatasi("Etiket kenarı sayı olmalı") from None
    if kenar and not 5.0 <= kenar <= 1000.0:
        raise EtiketHatasi(f"Etiket kenarı 5-1000 mm arasında olmalı (verilen: {kenar:g})")

    etiketler: dict[str, dict[str, float]] = {}
    for anahtar, deger in (ham.get("etiketler") or {}).items():
        try:
            kimlik = int(anahtar)
        except (TypeError, ValueError):
            raise EtiketHatasi(f"Etiket kimliği tam sayı olmalı: {anahtar!r}") from None
        if not 0 <= kimlik <= 586:
            raise EtiketHatasi(f"36h11 ailesinde kimlik 0-586 arasında (verilen: {kimlik})")
        if not isinstance(deger, dict):
            raise EtiketHatasi(f"{kimlik} numaralı etiketin konumu bir nesne olmalı")
        try:
            x, y = float(deger.get("x")), float(deger.get("y"))
        except (TypeError, ValueError):
            raise EtiketHatasi(f"{kimlik} numaralı etiketin X/Y değeri sayı olmalı") from None
        if not (-2000.0 <= x <= 2000.0 and -2000.0 <= y <= 2000.0):
            raise EtiketHatasi(f"{kimlik} numaralı etiketin konumu makul aralıkta değil")
        etiketler[str(kimlik)] = {"x": x, "y": y}

    veri = {"kenar_mm": kenar, "etiketler": etiketler}
    with _KILIT:
        yol = _yol()
        klasor = os.path.dirname(os.path.abspath(yol)) or "."
        os.makedirs(klasor, exist_ok=True)
        # Geçici dosya + rename: yarım yazılmış bir kalibrasyon kaydı,
        # hiç kayıt olmamasından kötü.
        tut = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                          delete=False, suffix=".tmp")
        try:
            json.dump(veri, tut, ensure_ascii=False, indent=1)
            tut.flush()
            os.fsync(tut.fileno())
        finally:
            tut.close()
        os.replace(tut.name, yol)
    return veri


# --------------------------------------------------------------------------- #
# Hesap
# --------------------------------------------------------------------------- #
def coz_olcek(bulunanlar: list[dict[str, Any]], kenar_mm: float) -> dict[str, Any]:
    """Etiket kenarından `mm_px`. Tek etiket yeter.

    Bütün etiketlerin bütün kenarları kullanılıyor ve ORTANCA alınıyor:
    bir etiket eğik durursa ortalama kayar, ortanca kaymaz.
    """
    if not bulunanlar:
        raise EtiketHatasi("Karede hiç AprilTag bulunamadı")
    if not kenar_mm or kenar_mm <= 0:
        raise EtiketHatasi(
            "Etiketin kenar ölçüsü girilmemiş. Bastığınız etiketin siyah "
            "karesini kumpasla ölçüp yazın — bu sayı doğrudan ölçeği belirliyor.")
    kenarlar = sorted(e["kenar_px"] for e in bulunanlar if e["kenar_px"] > 0)
    if not kenarlar:
        raise EtiketHatasi("Etiket kenarları ölçülemedi")
    orta = len(kenarlar) // 2
    ortanca = (kenarlar[orta] if len(kenarlar) % 2
               else (kenarlar[orta - 1] + kenarlar[orta]) / 2.0)
    return {
        "mm_px": kenar_mm / ortanca,
        "etiket_sayisi": len(bulunanlar),
        "kenar_px_ortanca": ortanca,
        "kimlikler": [e["kimlik"] for e in bulunanlar],
        # Etiketler arası ölçek dağılımı: büyükse kamera dik bakmıyor ya da
        # etiketler farklı yükseklikte duruyor.
        "olcek_yayilimi_yuzde": (
            (kenarlar[-1] - kenarlar[0]) / ortanca * 100.0 if ortanca else 0.0),
    }


def coz_yerlesim(bulunanlar: list[dict[str, Any]], konumlar: dict[str, Any],
                 genislik_px: int, yukseklik_px: int) -> dict[str, Any]:
    """Ölçek + dönme + karenin merkezinin makine koordinatı.

    Model: makine = ölçek · döndür(açı) · (piksel − kare_merkezi) + ofset

    Bu bir BENZERLİK dönüşümü (ölçek, dönme, öteleme) ve iki noktayla tam
    belirleniyor. Yansıma ayrı bir bilinmeyen: görüntünün v ekseni aşağı,
    makinenin Y'si genellikle yukarı bakıyor. İki olasılığı da çözüp artığı
    küçük olanı seçiyoruz — tahmin etmektense ölçmek.
    """
    kayit = konumlar.get("etiketler") or {}
    eslesen = [(e, kayit[str(e["kimlik"])]) for e in bulunanlar
               if str(e["kimlik"]) in kayit]
    if len(eslesen) < 2:
        bilinen = ", ".join(sorted(kayit)) or "hiç yok"
        goruldu = ", ".join(str(e["kimlik"]) for e in bulunanlar) or "hiç yok"
        raise EtiketHatasi(
            "Yerleşim için konumu bilinen en az iki etiket gerekiyor. "
            f"Karede görülenler: {goruldu}. Konumu kayıtlı olanlar: {bilinen}.")

    cu, cv = genislik_px / 2.0, yukseklik_px / 2.0
    p = [(e["merkez"][0] - cu, e["merkez"][1] - cv) for e, _ in eslesen]
    q = [(k["x"], k["y"]) for _, k in eslesen]

    en_iyi: dict[str, Any] | None = None
    for ayna in (False, True):
        pa = [(u, -v if ayna else v) for u, v in p]
        cozum = _benzerlik(pa, q)
        if cozum is None:
            continue
        cozum["ayna_y"] = ayna
        if en_iyi is None or cozum["artik_mm"] < en_iyi["artik_mm"]:
            en_iyi = cozum
    if en_iyi is None:
        raise EtiketHatasi(
            "Etiketler üst üste düşüyor — aralarında ölçülebilir mesafe yok. "
            "Karenin farklı yerlerinde duran etiketler kullanın.")

    # DÖRT ETİKETTEN SONRA PERSPEKTİF DE ÇIKIYOR.
    #
    # Benzerlik (ölçek + dönme + kaydırma) kameranın yatağa DİK baktığını
    # varsayıyor. Bu kurulumda kamera sert bir açıyla bakıyor ve sahada
    # ölçüldü: aynı noktalarda benzerlik 51,8 mm, projektif 9,3 mm
    # yanılıyordu. Dört nokta homografiyi tam belirliyor, fazlası hatayı
    # ölçülebilir yapıyor. İki modelin hatası da dönüyor: aradaki fark,
    # kameranın ne kadar eğik baktığını SÖYLÜYOR — tahmin etmiyoruz.
    harita = None
    harita_artik = None
    if len(eslesen) >= 4:
        import otokalib
        px = [(e["merkez"][0], e["merkez"][1]) for e, _ in eslesen]
        harita = otokalib._projektif(px, q)
        if harita is not None:
            kare = 0.0
            for (u, v), (x, y) in zip(px, q):
                hx, hy = otokalib.uygula(harita, u, v)
                kare += (hx - x) ** 2 + (hy - y) ** 2
            harita_artik = math.sqrt(kare / len(px))

    # DÖRT NOKTADA "SAPMA" ÖLÇÜM DEĞİL.
    #
    # Homografinin sekiz serbestliği var, her nokta iki denklem veriyor:
    # dört nokta sistemi TAM belirliyor ve artık her zaman ~0 çıkıyor.
    # Ekranda "±0,0 mm" görmek, kalibrasyonun kusursuz olduğu anlamına
    # gelmiyor — hiç ölçülmediği anlamına geliyor. Aynı gerekçe iki
    # noktalı benzerlikte de yazılı (aşağıda `artik_notu`).
    harita_artik_notu = ""
    if harita is not None and len(eslesen) < 5:
        harita_artik = None
        harita_artik_notu = (
            "Dört etiket haritayı tam belirliyor, sapması ölçülemez. "
            "Beşinci bir etiket eklerseniz haritanın ne kadar tuttuğunu "
            "sayıyla söyleyebilirim.")

    # HARİTANIN KENDİSİNİ DE ÖLÇÜYORUZ. Artık, yalnız etiketlerin
    # DURDUĞU yerdeki hatayı görüyor; etiketler aynı düzlemde değilse
    # harita aralarında doğru, kenarlarda saçma olabilir. Ufuk çizgisi ve
    # ölçek yayılımı bunu haritanın katsayılarından çıkarıyor.
    harita_saglik = None
    if harita is not None:
        import tespit
        harita_saglik = tespit.harita_saglik(
            {"harita": harita, "genislik_px": genislik_px,
             "yukseklik_px": yukseklik_px})

    aci = math.degrees(en_iyi["aci"])
    return {
        "harita": harita,
        "harita_artik_mm": None if harita_artik is None else round(harita_artik, 2),
        "harita_artik_notu": harita_artik_notu,
        "harita_saglik": harita_saglik,
        "mm_px": en_iyi["olcek"],
        "donme": (aci + 180.0) % 360.0 - 180.0,
        "ofset_x": en_iyi["tx"],
        "ofset_y": en_iyi["ty"],
        "ayna_y": en_iyi["ayna_y"],
        "etiket_sayisi": len(eslesen),
        "kimlikler": [e["kimlik"] for e, _ in eslesen],
        # ARTIK YALNIZ ÜÇ VE ÜSTÜNDE ANLAMLI. İki nokta benzerliği tam
        # belirliyor, artık her zaman sıfır çıkıyor; "0,0 mm" yazıp güven
        # vermek yanlış olurdu.
        "artik_mm": en_iyi["artik_mm"] if len(eslesen) >= 3 else None,
        "artik_notu": ("" if len(eslesen) >= 3 else
                       "İki etiketle sapma ölçülemez — üçüncü bir etiket "
                       "eklerseniz kalibrasyonun ne kadar tuttuğunu söyleyebilirim."),
    }


def _benzerlik(p: list[tuple[float, float]],
               q: list[tuple[float, float]]) -> dict[str, float] | None:
    """En küçük kareler benzerlik uydurması: q ≈ olcek·R(aci)·p + t."""
    n = len(p)
    if n < 2:
        return None
    pmx = sum(a for a, _ in p) / n
    pmy = sum(b for _, b in p) / n
    qmx = sum(a for a, _ in q) / n
    qmy = sum(b for _, b in q) / n
    a = b = payda = 0.0
    for (px, py), (qx, qy) in zip(p, q):
        dx, dy = px - pmx, py - pmy
        ex, ey = qx - qmx, qy - qmy
        a += dx * ex + dy * ey        # nokta çarpım
        b += dx * ey - dy * ex        # çapraz çarpım
        payda += dx * dx + dy * dy
    if payda <= 1e-12:
        return None
    aci = math.atan2(b, a)
    olcek = math.hypot(a, b) / payda
    if olcek <= 1e-9:
        return None
    ca, sa = math.cos(aci), math.sin(aci)
    tx = qmx - olcek * (ca * pmx - sa * pmy)
    ty = qmy - olcek * (sa * pmx + ca * pmy)

    kare_toplam = 0.0
    for (px, py), (qx, qy) in zip(p, q):
        ux = olcek * (ca * px - sa * py) + tx
        uy = olcek * (sa * px + ca * py) + ty
        kare_toplam += (ux - qx) ** 2 + (uy - qy) ** 2
    return {"olcek": olcek, "aci": aci, "tx": tx, "ty": ty,
            "artik_mm": math.sqrt(kare_toplam / n)}


# --------------------------------------------------------------------------- #
# Uç noktalar
#
# AYRI BİR YÖNLENDİRİCİ. Uç noktaları `main.py`e yazmak yerine burada
# toplayıp tek satırla bağlıyoruz: `main.py` başka bir oturumda sürekli
# değişiyor ve oraya blok eklemek her yamada çakışma demek.
# --------------------------------------------------------------------------- #
def yonlendirici_kur(parola_dogrula, canli_kare=None, makine_konum=None,
                     kamera_hareketli=None):
    """Parola denetimi çağıranın; geri kalan her şey burada.

    `canli_kare(kamera) -> bytes` verilirse kare ONDAN alınıyor. İki ayrı
    depo var: `kareler.son` diskteki PERİYODİK kareyi veriyor ve o aralık
    saatlik olabiliyor. Etiket taraması eski bir kareyi okursa "etiket
    yok" der ya da çoktan kaldırılmış bir etiketi bulur.

    `makine_konum() -> (x, y) | (None, None)` ve
    `kamera_hareketli(ad) -> bool` hareketli kamerada sonucu göreceliye
    çevirmek için gerekiyor; verilmezse sonuç MUTLAK yazılıyor (sabit
    kamera davranışı).
    """
    import inspect
    import time

    async def _kare_al(kam: str):
        """Kare sağlayıcı eşzamanlı da olabiliyor, eşzamansız da.

        Sunucu ajandan TAM çözünürlüklü kare isterken bir eşyordam
        veriyor; denemeler düz bir işlev veriyor. İkisini de kabul
        etmek, deneme kurulumunu sunucunun iç işleyişine bağlamamak
        demek.
        """
        if not canli_kare:
            return None
        sonuc = canli_kare(kam)
        if inspect.isawaitable(sonuc):
            sonuc = await sonuc
        return sonuc

    def _makine_konum():
        if not makine_konum:
            return (None, None)
        try:
            x, y = makine_konum()
            return (None if x is None else float(x),
                    None if y is None else float(y))
        except Exception:                                  # noqa: BLE001
            return (None, None)

    def _kamera_hareketli(ad: str) -> bool:
        if not kamera_hareketli:
            return False
        try:
            return bool(kamera_hareketli(ad))
        except Exception:                                  # noqa: BLE001
            return False

    from fastapi import APIRouter, HTTPException, Query

    yon = APIRouter()

    @yon.get("/api/kamera/etiket/konumlar")
    async def _konumlar_oku(jeton: str = Query(default="")):
        parola_dogrula(jeton)
        return {"konumlar": konumlar_oku(), "aile": AILE}

    @yon.post("/api/kamera/etiket/konumlar")
    async def _konumlar_yaz(govde: dict[str, Any], jeton: str = Query(default="")):
        parola_dogrula(jeton)
        try:
            return {"ok": True, "konumlar": konumlar_yaz(govde)}
        except EtiketHatasi as hata:
            raise HTTPException(status_code=400, detail=str(hata))

    @yon.post("/api/kamera/etiket/tara")
    async def _tara(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        """Son kareyi tarar; bulabildiği kadarını hesaplar.

        Gövde: {"kamera": "ust", "kaydet": true}

        BULDUĞU KADARINI VERİYOR. Bir etiket varsa ölçek; konumu bilinen iki
        etiket varsa yerleşim de. Yerleşim çıkmadıysa ölçeği de atmıyoruz —
        yarısı olan bir kalibrasyon, hiç olmamasından iyi ve hangi yarısının
        eksik olduğu yazıyor.
        """
        import asyncio

        import kalibrasyon
        import kareler

        parola_dogrula(jeton)
        govde = govde or {}
        kam = kalibrasyon.ad_temizle(govde.get("kamera"))
        kare = await _kare_al(kam)
        if not kare:
            kare = await asyncio.to_thread(kareler.son, kareler.ad_temizle(kam))
        if not kare:
            raise HTTPException(
                status_code=404,
                detail=f"'{kam}' kamerasından kare yok — kamerayı ve canlı "
                       "akışı açın.")
        try:
            bulunan, g_px, y_px = await asyncio.to_thread(algila_ve_boyut, kare)
        except EtiketHatasi as hata:
            raise HTTPException(status_code=400, detail=str(hata))

        konum = konumlar_oku()
        cikti: dict[str, Any] = {
            "kamera": kam, "genislik_px": g_px, "yukseklik_px": y_px,
            "etiketler": bulunan, "konumlar": konum,
            "olcek": None, "yerlesim": None, "notlar": [],
        }
        if not bulunan:
            cikti["notlar"].append(
                "Karede hiç AprilTag yok. Etiket kadraja giriyor mu, ışık "
                "yansıtıyor mu ve etrafında beyaz kenar var mı bakın.")
            return cikti

        try:
            cikti["olcek"] = coz_olcek(bulunan, konum.get("kenar_mm") or 0.0)
        except EtiketHatasi as hata:
            cikti["notlar"].append(str(hata))
        try:
            cikti["yerlesim"] = coz_yerlesim(bulunan, konum, g_px, y_px)
        except EtiketHatasi as hata:
            cikti["notlar"].append(str(hata))

        if govde.get("kaydet"):
            yer, olc = cikti["yerlesim"], cikti["olcek"]
            if not yer and not olc:
                raise HTTPException(
                    status_code=400,
                    detail="Kaydedilecek bir sonuç çıkmadı: " + " · ".join(cikti["notlar"]))
            yazilacak: dict[str, Any] = {
                "genislik_px": g_px, "yukseklik_px": y_px,
                "yontem": "etiket", "guncelleme": time.time(),
            }
            if yer:
                # HAREKETLİ KAMERADA SONUÇ GÖRECELİ OLMALI.
                #
                # Etiketler yatağa yapıştırılı ve koordinatları MUTLAK; o
                # yüzden çözüm de mutlak çıkıyor: "karenin merkezi yatağın
                # şurası". Sabit kamerada aranan tam bu. Hareketli uç
                # kamerasında ise `ofset_x/y`nin anlamı "kameranın UÇTAN
                # kayması" ve o kayma, mutlak sonuçtan makinenin tarama
                # anındaki konumu çıkarılarak bulunuyor. Karıştırılırsa uç
                # kamerasının kareleri yatağın rastgele bir yerine oturur.
                mx, my = _makine_konum()
                hareketli = bool(_kamera_hareketli(kam))
                if hareketli and (mx is None or my is None):
                    cikti["notlar"].append(
                        "Makinenin konumu okunamadı (PLC kopuk olabilir) — "
                        "hareketli kamerada kayma MUTLAK yazıldı. Konum "
                        "gelince taramayı tekrarlayın.")
                kaydir = hareketli and mx is not None and my is not None
                yazilacak.update(
                    mm_px=yer["mm_px"], donme=yer["donme"],
                    ofset_x=yer["ofset_x"] - (mx if kaydir else 0.0),
                    ofset_y=yer["ofset_y"] - (my if kaydir else 0.0),
                    ayna_y=yer["ayna_y"])
                # HARİTA VARSA O DA YAZILIYOR. Üçlü (ölçek/dönme/ofset)
                # yerinde kalıyor: haritayı okumayan yerler bozulmadan
                # çalışsın diye. Okuyanlar eğik bakışı da düzeltiyor.
                sag = yer.get("harita_saglik") or {}
                if yer.get("harita") and not sag.get("gecerli", True):
                    # UFUK KADRAJA GİRİYORSA HARİTA YAZILMIYOR. Kaydetsek
                    # `tespit` onu zaten reddedecek, ama panel rozeti
                    # "harita" yazmaya devam eder ve kullanıcı kalibre
                    # olduğunu sanır. Üçlü (ölçek/dönme/ofset) yazılıyor,
                    # kamera yine ölçüyor — yalnız perspektif düzeltmesi yok.
                    cikti["notlar"].append(sag.get("sebep") or
                                           "Harita geçersiz, yazılmadı.")
                elif yer.get("harita"):
                    yazilacak["harita"] = yer["harita"]
                    # None DA YAZILIYOR: dört etiketle sapma ölçülemiyor ve
                    # eski taramadan kalan sayının orada durması, ölçülmemiş
                    # bir değeri ölçülmüş gibi göstermek olurdu.
                    yazilacak["harita_sapma_mm"] = yer.get("harita_artik_mm")
                    if yer.get("harita_artik_notu"):
                        cikti["notlar"].append(yer["harita_artik_notu"])
                    import tespit
                    kat = sag.get("olcek_yayilimi_kat")
                    if kat and kat > tespit.OLCEK_YAYILIMI_UYARI:
                        cikti["notlar"].append(
                            f"Haritada mm/piksel karenin bir ucundan öbürüne "
                            f"{kat:.1f} kat değişiyor — etiketler farklı "
                            "yükseklikte duruyor ya da kamera çok eğik "
                            "bakıyor. Ölçüler kadrajın kenarında güvenilmez.")
                    yazilacak["harita_nokta"] = yer.get("etiket_sayisi")
                    # Haritanın ölçüldüğü makine konumu. Sabit kamerada
                    # None: kamera oynamıyor, harita her zaman geçerli.
                    yazilacak["harita_makine_x"] = mx if kaydir else None
                    yazilacak["harita_makine_y"] = my if kaydir else None
            else:
                yazilacak["mm_px"] = olc["mm_px"]
            cikti["kalibrasyon"] = await asyncio.to_thread(
                kalibrasyon.kaydet, yazilacak, kam)
        return cikti

    return yon
