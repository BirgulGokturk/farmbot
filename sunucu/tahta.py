"""Satranç tahtasıyla lens kalibrasyonu — kenarların yalanını düzeltiyor.

NEDEN VAR. Ucuz kameralar görüntüyü kenarlara doğru şişiriyor ya da
büzüyor. Yatağın ortasındaki bir bitki doğru ölçülürken kenardaki
milimetrelerce kayıyor ve bu kayma, ölçek ne kadar doğru olursa olsun
düzelmiyor: `mm_px` bütün kareye TEK bir sayı uyguluyor, oysa bozulma
yere göre değişiyor.

Satranç tahtası bunu çözüyor. Tahtanın iç köşeleri gerçekte kusursuz bir
ızgara; görüntüde ne kadar eğrildiklerine bakarak lensin ne yaptığı
çıkarılıyor. Sonrasında her kare düzeltilerek işleniyor.

NE VERMİYOR: DERİNLİK. Tek kamera ve düz bir tahtayla derinlik haritası
çıkmıyor. Çıkan şey lensin kendisi (iç parametreler) ve — istenirse —
kameranın o düzleme olan uzaklığı. Bitki boyu düzeltmesi için gereken
ikincisi; "her pikselin derinliği" değil.

KARELER OTURUMLA BİRLİKTE UÇUYOR. Toplanan köşeler bellekte duruyor,
diskte değil: kalibrasyon bir seferlik bir iş ve yarım kalmış bir
toplamayı günler sonra sürdürmek, arada kameranın çözünürlüğü
değişmişse sessizce yanlış sonuç demek. SONUÇ ise diske yazılıyor.

ÇÖZÜNÜRLÜK BAĞLAYICI. Kalibrasyon hangi kare ölçüsüyle yapıldıysa
yalnız onda geçerli; 640'ta kalibre edip 1280'de kullanmak, düzeltmeyi
iki katı yanlış uygulamak demek. Toplanan kareler arasında ölçü
değişirse hata veriyoruz.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

_KILIT = threading.RLock()

#: Kare kabul edilmeden önce geçmesi gereken en düşük netlik. Laplace
#: varyansı: bulanık karede kenar kalmadığı için düşük çıkıyor. Değer
#: deneyle seçildi; altında kalan kareler köşeleri yanlış yere oturtuyor.
EN_AZ_NETLIK = 45.0

#: Tahtanın kareyi kapladığı en küçük oran. Çok uzaktan çekilen tahtada
#: köşeler birkaç piksele sıkışıyor ve alt piksel iyileştirmesi anlamını
#: yitiriyor.
EN_AZ_ALAN_ORAN = 0.03

#: Kalibrasyon için gereken en az kare. Sekizin altında çözüm var ama
#: kararsız: bir sonraki karede katsayılar belirgin değişiyor.
EN_AZ_KARE = 8

#: Duruşların yeterince farklı olduğunu söyleyen en küçük yayılım. Kameraya
#: uzaklık bu kadar bile değişmediyse bütün kareler pratikte aynı görüntü
#: demek ve çözüm ölçüme değil tek bir kareye oturuyor.
EN_AZ_UZAKLIK_YAYILIM_MM = 20.0


class TahtaHatasi(Exception):
    """Kare reddedildi ya da kalibrasyon hesaplanamadı."""


# Kamera adı -> {"boyut": (g, y), "kareler": [...], "ic_kose": (n, m), "kare_mm": f}
_TOPLANAN: dict[str, dict[str, Any]] = {}


def _cv2():
    try:
        import cv2  # type: ignore
    except ImportError as hata:
        raise TahtaHatasi(
            "OpenCV kurulu değil — satranç tahtası okunamıyor. Pi'de: "
            "sudo apt install -y python3-opencv") from hata
    return cv2


def _gri(jpeg: bytes):
    import numpy as np
    cv2 = _cv2()
    gri = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if gri is None:
        raise TahtaHatasi("Kare çözülemedi — JPEG bozuk olabilir")
    return gri


def koseleri_bul(gri, ic_kose: tuple[int, int]):
    """Tahtanın iç köşeleri. Bulunamazsa None.

    Önce `findChessboardCornersSB` deneniyor: yeni ve belirgin şekilde
    dayanıklı, eğik duran ve gölgeli tahtalarda eskisinin bulamadığını
    buluyor. Yoksa klasik yola düşülüyor ve orada alt piksel iyileştirmesi
    ELLE yapılıyor — SB bunu kendi içinde zaten yapıyor.
    """
    cv2 = _cv2()
    if hasattr(cv2, "findChessboardCornersSB"):
        tamam, koseler = cv2.findChessboardCornersSB(
            gri, ic_kose, flags=cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY)
        if tamam:
            return koseler
    bayrak = (cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE
              | cv2.CALIB_CB_FAST_CHECK)
    tamam, koseler = cv2.findChessboardCorners(gri, ic_kose, flags=bayrak)
    if not tamam:
        return None
    olcut = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)
    return cv2.cornerSubPix(gri, koseler, (11, 11), (-1, -1), olcut)


def _netlik(gri) -> float:
    """Laplace varyansı — bulanık karede düşük."""
    cv2 = _cv2()
    return float(cv2.Laplacian(gri, cv2.CV_64F).var())


def _kapsama_hucresi(koseler, boyut: tuple[int, int]) -> int:
    """Tahtanın merkezi karenin 3x3 ızgarasında hangi hücreye düşüyor.

    KAPSAMA ÖNEMLİ: bütün kareleri ortada çeken kullanıcı, kenarlardaki
    bozulmayı hiç ölçmemiş oluyor ve düzeltme tam da en çok gereken yerde
    uydurma kalıyor. Panel bu sayede "sol üst köşe boş" diyebiliyor.
    """
    g, y = boyut
    merkez = koseler.reshape(-1, 2).mean(axis=0)
    sutun = min(2, max(0, int(merkez[0] / (g / 3.0))))
    satir = min(2, max(0, int(merkez[1] / (y / 3.0))))
    return satir * 3 + sutun


def _alan_orani(koseler, boyut: tuple[int, int]) -> float:
    import numpy as np
    k = koseler.reshape(-1, 2)
    en = float(np.ptp(k[:, 0])) * float(np.ptp(k[:, 1]))
    return en / float(boyut[0] * boyut[1])


def kare_ekle(kamera: str, jpeg: bytes, ic_kose: tuple[int, int],
              kare_mm: float) -> dict[str, Any]:
    """Bir kareyi toplamaya ekler. Reddederse SEBEBİNİ söyler.

    Kare burada elenmezse 20 kare çekip sonunda "olmadı" denirdi; hangi
    karenin kötü olduğu da anlaşılmazdı.
    """
    gri = _gri(jpeg)
    y_px, g_px = gri.shape[:2]
    boyut = (int(g_px), int(y_px))

    with _KILIT:
        durum = _TOPLANAN.get(kamera)
        if durum and durum["boyut"] != boyut:
            raise TahtaHatasi(
                f"Kare ölçüsü değişti: önceki {durum['boyut'][0]}x{durum['boyut'][1]}, "
                f"bu {boyut[0]}x{boyut[1]}. Kalibrasyon tek çözünürlükte geçerli — "
                "çözünürlüğü sabitleyip baştan toplayın.")
        if durum and durum["ic_kose"] != ic_kose:
            raise TahtaHatasi(
                f"İç köşe sayısı değişti: önceki {durum['ic_kose']}, bu {ic_kose}. "
                "Aynı tahtayla devam edin ya da baştan başlayın.")

    netlik = _netlik(gri)
    if netlik < EN_AZ_NETLIK:
        raise TahtaHatasi(
            f"Kare bulanık (netlik {netlik:.0f}, en az {EN_AZ_NETLIK:.0f}). "
            "Elinizi sabitleyin ya da ışığı artırın.")

    koseler = koseleri_bul(gri, ic_kose)
    if koseler is None:
        raise TahtaHatasi(
            f"Tahta bulunamadı. İç köşe sayısı {ic_kose[0]}x{ic_kose[1]} doğru mu, "
            "tahtanın tamamı kadraja giriyor mu ve beyaz kenarı görünüyor mu bakın. "
            "Parlama varsa açıyı değiştirin.")

    oran = _alan_orani(koseler, boyut)
    if oran < EN_AZ_ALAN_ORAN:
        raise TahtaHatasi(
            f"Tahta çok küçük görünüyor (karenin %{oran * 100:.1f}'i). "
            "Yaklaştırın — köşeler birkaç piksele sıkışınca ölçüm anlamını yitiriyor.")

    hucre = _kapsama_hucresi(koseler, boyut)
    # AYNI KARE İKİ KEZ EKLENMESİN.
    #
    # Sahada tam bu oldu: kare eski bir depodan geliyordu, kullanıcı tahtayı
    # oynattığı hâlde 25 kez AYNI görüntü eklendi ve sonuç — düşük ölçüm
    # hatasına rağmen — çöp çıktı. Aynı ölçümü tekrarlamak kalibrasyona
    # hiçbir şey katmıyor; sessizce kabul etmek, saatler sonra anlaşılan
    # bir yanlışa dönüşüyor.
    import hashlib
    imza = hashlib.sha1(jpeg).hexdigest()
    with _KILIT:
        onceki = _TOPLANAN.get(kamera)
        if onceki and imza in onceki.get("imzalar", set()):
            raise TahtaHatasi(
                "Bu kare zaten eklendi — görüntü hiç değişmemiş. Kamera yeni "
                "kare üretiyor mu bakın; canlı akış kapalıysa depodaki eski "
                "kare geliyor olabilir.")
    with _KILIT:
        durum = _TOPLANAN.setdefault(kamera, {
            "boyut": boyut, "ic_kose": ic_kose, "kare_mm": float(kare_mm),
            "kareler": [], "imzalar": set(),
        })
        durum["kare_mm"] = float(kare_mm)
        durum.setdefault("imzalar", set()).add(imza)
        durum["kareler"].append({"koseler": koseler, "hucre": hucre,
                                 "netlik": netlik, "oran": oran})
        sayi = len(durum["kareler"])
        kapsama = sorted({k["hucre"] for k in durum["kareler"]})
    return {"kabul": True, "kare_sayisi": sayi, "hucre": hucre,
            "netlik": round(netlik, 1), "alan_yuzde": round(oran * 100, 1),
            "kapsanan": kapsama, "boyut": boyut}


def durum(kamera: str) -> dict[str, Any]:
    with _KILIT:
        d = _TOPLANAN.get(kamera)
        if not d:
            return {"kare_sayisi": 0, "kapsanan": [], "boyut": None,
                    "en_az": EN_AZ_KARE}
        return {
            "kare_sayisi": len(d["kareler"]),
            "kapsanan": sorted({k["hucre"] for k in d["kareler"]}),
            "boyut": d["boyut"], "ic_kose": list(d["ic_kose"]),
            "kare_mm": d["kare_mm"], "en_az": EN_AZ_KARE,
        }


def temizle(kamera: str) -> None:
    with _KILIT:
        _TOPLANAN.pop(kamera, None)


def hesapla(kamera: str) -> dict[str, Any]:
    """Toplanan karelerden lens parametreleri.

    `rms` yeniden izdüşüm hatası: köşeleri bulunan yerden hesaplanan yere
    kaç piksel uzağa düşüyor. 0,5'in altı iyi, 1'in üstü bir yerde sorun
    var demek — genellikle bulanık kare ya da yanlış iç köşe sayısı.
    """
    import numpy as np
    cv2 = _cv2()
    with _KILIT:
        d = _TOPLANAN.get(kamera)
        if not d or len(d["kareler"]) < EN_AZ_KARE:
            var = 0 if not d else len(d["kareler"])
            raise TahtaHatasi(
                f"Yeterli kare yok: {var}/{EN_AZ_KARE}. Tahtayı farklı açı ve "
                "köşelerde gösterip kare eklemeye devam edin.")
        ic = d["ic_kose"]
        kare_mm = float(d["kare_mm"])
        boyut = d["boyut"]
        goruntu = [k["koseler"] for k in d["kareler"]]
        kapsama = sorted({k["hucre"] for k in d["kareler"]})

    # Tahtanın kendi koordinatları: z = 0 düzleminde kusursuz ızgara.
    nesne = np.zeros((ic[0] * ic[1], 3), np.float32)
    nesne[:, :2] = np.mgrid[0:ic[0], 0:ic[1]].T.reshape(-1, 2) * kare_mm
    nesneler = [nesne for _ in goruntu]

    rms, kamera_mat, bozulma, rvecs, tvecs = cv2.calibrateCamera(
        nesneler, goruntu, boyut, None, None)

    # Her karede tahtanın kameraya uzaklığı — tahta toprağa yatık
    # çekildiyse bu, kameranın yataktan yüksekliği demek. "Derinlik"
    # ihtiyacının pratik karşılığı bu sayı.
    uzakliklar = sorted(float(np.linalg.norm(t)) for t in tvecs)
    orta = uzakliklar[len(uzakliklar) // 2]
    yayilim = uzakliklar[-1] - uzakliklar[0]

    # DÜŞÜK ÖLÇÜM HATASI TEK BAŞINA YETMİYOR.
    #
    # Bütün kareler aynı duruştaysa çözüm o tek duruşu kusursuz eşliyor:
    # hata küçücük çıkıyor ama katsayılar gerçeği değil o kareyi anlatıyor
    # (sahada k2 = 19,9 gördük — gerçek bir lenste 1'in altında olur).
    # Bu yüzden güvenilirliği duruş ÇEŞİTLİLİĞİNDEN de soruyoruz.
    uyari = ""
    if yayilim < EN_AZ_UZAKLIK_YAYILIM_MM:
        uyari = (f"Kareler birbirinin aynı: kameraya uzaklık yalnız "
                 f"{yayilim:.1f} mm değişmiş. Sonuç bu hâliyle GÜVENİLMEZ — "
                 "tahtayı yaklaştırıp uzaklaştırarak ve eğerek toplayın.")
    elif len(kapsama) < 3:
        uyari = (f"Kareler karenin yalnız {len(kapsama)} bölgesinden alınmış. "
                 "Lens bozulması en çok kenarlarda; oraları göstermezseniz "
                 "düzeltme kenarlarda uydurma kalıyor.")

    sonuc = {
        "rms": round(float(rms), 3),
        "kamera_matrisi": [[round(float(x), 3) for x in satir] for satir in kamera_mat],
        "bozulma": [round(float(x), 6) for x in np.asarray(bozulma).ravel()],
        "boyut": list(boyut),
        "ic_kose": list(ic),
        "kare_mm": kare_mm,
        "kare_sayisi": len(goruntu),
        "kapsanan": kapsama,
        "uzaklik_ortanca_mm": round(orta, 1),
        "uzaklik_en_az_mm": round(uzakliklar[0], 1),
        "uzaklik_en_cok_mm": round(uzakliklar[-1], 1),
        "uzaklik_yayilim_mm": round(yayilim, 1),
        "guvenilir": not uyari,
        "uyari": uyari,
    }
    return sonuc


# --------------------------------------------------------------------------- #
# Kayıt
# --------------------------------------------------------------------------- #
def _yol() -> str:
    ozel = os.environ.get("LENS_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "lens_kalibrasyon.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "lens_kalibrasyon.json")


def hepsi() -> dict[str, Any]:
    with _KILIT:
        try:
            with open(_yol(), encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (OSError, json.JSONDecodeError):
            return {}
    return veri if isinstance(veri, dict) else {}


def oku(kamera: str) -> dict[str, Any] | None:
    return hepsi().get(str(kamera)) or None


def kaydet(kamera: str, sonuc: dict[str, Any]) -> dict[str, Any]:
    veri = hepsi()
    veri[str(kamera)] = sonuc
    with _KILIT:
        yol = _yol()
        klasor = os.path.dirname(os.path.abspath(yol)) or "."
        os.makedirs(klasor, exist_ok=True)
        tut = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                          delete=False, suffix=".tmp")
        try:
            json.dump(veri, tut, ensure_ascii=False, indent=1)
            tut.flush()
            os.fsync(tut.fileno())
        finally:
            tut.close()
        os.replace(tut.name, yol)
    return sonuc


# --------------------------------------------------------------------------- #
# Uç noktalar — ayrı yönlendirici (bkz. etiket.py'deki aynı gerekçe)
# --------------------------------------------------------------------------- #
def yonlendirici_kur(parola_dogrula, canli_kare=None):
    """`canli_kare(kamera) -> bytes` verilirse kare ONDAN alınıyor.

    İKİ AYRI DEPO VAR ve yanlışını okumak sahada yandı: `kareler.son`
    DİSKTEKİ periyodik kareyi veriyor ve o aralık saatlik olabiliyor.
    Kullanıcı tahtayı oynattığı hâlde her seferinde aynı eski kare
    ekleniyordu. Canlı akış bellekte ayrı duruyor; varsa o kullanılmalı.
    """
    import asyncio

    from fastapi import APIRouter, HTTPException, Query

    yon = APIRouter()

    def _kam(govde: dict[str, Any]) -> str:
        import kalibrasyon
        return kalibrasyon.ad_temizle((govde or {}).get("kamera"))

    def _ic_kose(govde: dict[str, Any]) -> tuple[int, int]:
        try:
            n = int(govde.get("ic_kose_x"))
            m = int(govde.get("ic_kose_y"))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="İç köşe sayısı girilmedi. Kare değil, karelerin KESİŞTİĞİ "
                       "nokta sayısı: 10x7 karelik tahtada 9x6.")
        if not (3 <= n <= 30 and 3 <= m <= 30):
            raise HTTPException(status_code=400,
                                detail="İç köşe sayısı 3 ile 30 arasında olmalı.")
        if n == m:
            raise HTTPException(
                status_code=400,
                detail="İç köşe sayısı kare olmamalı (örn. 9x9). Simetrik tahtada "
                       "yön belirsiz kalıyor ve köşeler kareden kareye "
                       "döndürülmüş çıkabiliyor.")
        return (n, m)

    @yon.get("/api/kamera/tahta/durum")
    async def _durum(kamera: str = Query(default="ust"), jeton: str = Query(default="")):
        parola_dogrula(jeton)
        import kalibrasyon
        kam = kalibrasyon.ad_temizle(kamera)
        return {"kamera": kam, "toplama": durum(kam), "kayitli": oku(kam)}

    @yon.post("/api/kamera/tahta/kare")
    async def _kare(govde: dict[str, Any], jeton: str = Query(default="")):
        """Son kareyi toplamaya ekler."""
        import kareler

        parola_dogrula(jeton)
        kam = _kam(govde)
        ic = _ic_kose(govde)
        try:
            kare_mm = float(govde.get("kare_mm") or 0.0)
        except (TypeError, ValueError):
            kare_mm = 0.0
        if kare_mm <= 0:
            raise HTTPException(status_code=400,
                                detail="Kare ölçüsü (mm) girilmedi.")
        # DİSKTEKİ KAREYE DÜŞMÜYORUZ. Kalibrasyon her basışta YENİ bir
        # görüntü istiyor; periyodik kare saatlik olabiliyor ve aynı kareyi
        # tekrar tekrar ölçmek çöp sonuç demek. Taze canlı kare yoksa
        # sebebini söyleyip duruyoruz.
        ham = canli_kare(kam) if canli_kare else None
        if not ham:
            raise HTTPException(
                status_code=409,
                detail=f"'{kam}' kamerasından taze kare gelmiyor — canlı akış "
                       "durmuş görünüyor. Panelde Kamera sekmesini açık ve "
                       "görünür tutun; sekmeden çıkınca akış duruyor ve "
                       "bellekteki son kare donuyor.")
        try:
            return await asyncio.to_thread(kare_ekle, kam, ham, ic, kare_mm)
        except TahtaHatasi as hata:
            raise HTTPException(status_code=400, detail=str(hata))

    @yon.post("/api/kamera/tahta/hesapla")
    async def _hesapla(govde: dict[str, Any] | None = None,
                       jeton: str = Query(default="")):
        parola_dogrula(jeton)
        govde = govde or {}
        kam = _kam(govde)
        try:
            sonuc = await asyncio.to_thread(hesapla, kam)
        except TahtaHatasi as hata:
            raise HTTPException(status_code=400, detail=str(hata))
        if govde.get("kaydet"):
            sonuc = await asyncio.to_thread(kaydet, kam, sonuc)
            sonuc = dict(sonuc, kaydedildi=True)
        return {"kamera": kam, "sonuc": sonuc}

    @yon.post("/api/kamera/tahta/temizle")
    async def _temizle(govde: dict[str, Any] | None = None,
                       jeton: str = Query(default="")):
        parola_dogrula(jeton)
        kam = _kam(govde or {})
        temizle(kam)
        return {"ok": True, "kamera": kam, "toplama": durum(kam)}

    return yon
