"""Makinenin kendi hassasiyetiyle kamera kalibrasyonu.

FİKİR. Lensin ne yaptığını çözmeye çalışmak yerine "bu piksel şu
milimetre" ilişkisini DOĞRUDAN ölçüyoruz. Kafanın üstüne bir AprilTag
yapıştırılıyor; makine yatağın farklı noktalarına gidiyor ve her durakta
bir kare alınıyor. Makinenin nereye gittiği milimetresi milimetresine
biliniyor, işaretin görüntüde nereye düştüğü de ölçülüyor.

NEDEN SATRANÇ TAHTASINDAN İYİ. Tahta, lensi genel olarak tanımaya
çalışıyor: her mesafede geçerli olsun diye tahtayı kadranın köşelerine,
yakına uzağa, eğik düz götürmek gerekiyor. Sabit ve yüksek monte edilmiş
bir kamerada bunu elle yapmak neredeyse imkânsız — sahada da öyle oldu.
Burada hareketi MAKİNE yapıyor, köşelere o gidiyor ve koordinatı zaten
biliyor. İnsan sadece başlat diyor.

NE ÇÖZÜYOR. Ölçek, kameranın montaj açısı, yansıma ve — dört noktadan
sonra — kameranın yatağa dik bakmamasından doğan perspektif. Lensin hafif
bükmesi de haritanın içine giriyor, çünkü harita gerçek noktalardan
uyduruluyor.

TEK DÜZLEMDE GEÇERLİ. Harita, işaretin bulunduğu YÜKSEKLİKTE doğru.
Kalibrasyon toprak yüzeyine yakın bir Z'de yapılırsa ekim, sulama ve nem
ölçümünün olduğu düzlemde doğru olur; boyu uzamış bir bitkinin tepesi
kameraya daha yakın olduğu için biraz kayar. Bu, yöntemin kusuru değil
tek kameranın sınırı.

ÖLÇÜM İKİ MODELE BİRDEN UYDURULUYOR ve ikisinin hatası da yazılıyor:
benzerlik (ölçek + dönme + kaydırma) ve projektif (üstüne perspektif).
Aradaki fark, kameranın ne kadar eğik baktığını söylüyor — tahmin
etmiyoruz, ölçüyoruz.
"""

from __future__ import annotations

import math
import threading
from typing import Any

_KILIT = threading.RLock()

#: Benzerlik için iki, perspektif için dört nokta yetiyor; ama hata ancak
#: bilinmeyen sayısından FAZLA nokta olunca anlam kazanıyor. Altı nokta
#: hem perspektifi çözüyor hem "ne kadar tutuyor" sorusunu cevaplıyor.
EN_AZ_NOKTA = 4
ONERILEN_NOKTA = 9

#: İki nokta birbirine bu kadar yakınsa ikincisi yeni bilgi taşımıyor.
EN_AZ_ARALIK_MM = 30.0


class OtoKalibHatasi(Exception):
    """Nokta ölçülemedi ya da harita çıkarılamadı."""


# kamera -> {"boyut": (g, y), "noktalar": [{"mm": (x, y), "px": (u, v)}], "etiket": int}
_TOPLANAN: dict[str, dict[str, Any]] = {}


def nokta_ekle(kamera: str, mm_xy: tuple[float, float], jpeg: bytes,
               etiket_kimlik: int | None = None) -> dict[str, Any]:
    """Bir durakta ölçüm: makine nerede, işaret görüntüde nerede.

    İşareti `etiket.py` buluyor — aynı algılayıcı, aynı alt piksel
    hassasiyeti. Kimlik verilmişse yalnız o etiket kabul ediliyor:
    kadrada başka bir etiket varsa (yatağa yapıştırılmış olanlar gibi)
    yanlışını ölçmek sessiz bir hata olurdu.
    """
    import etiket

    bulunan, g_px, y_px = etiket.algila_ve_boyut(jpeg)
    if not bulunan:
        raise OtoKalibHatasi(
            "Kafadaki işaret görünmüyor. AprilTag kafanın üstünde düz duruyor "
            "mu, kameranın kadrajına giriyor mu ve üstüne gölge düşüyor mu bakın.")
    if etiket_kimlik is not None:
        eslesen = [e for e in bulunan if e["kimlik"] == int(etiket_kimlik)]
        if not eslesen:
            goruldu = ", ".join(str(e["kimlik"]) for e in bulunan)
            raise OtoKalibHatasi(
                f"{etiket_kimlik} numaralı işaret bulunamadı. Karede görülenler: "
                f"{goruldu}. Kafadaki etiketin kimliğini yazın.")
        secili = eslesen[0]
    elif len(bulunan) > 1:
        kimlikler = ", ".join(str(e["kimlik"]) for e in bulunan)
        raise OtoKalibHatasi(
            f"Karede birden çok etiket var ({kimlikler}). Hangisinin kafada "
            "olduğunu söyleyin — yanlışını ölçmek sessiz bir hata olurdu.")
    else:
        secili = bulunan[0]

    boyut = (int(g_px), int(y_px))
    with _KILIT:
        d = _TOPLANAN.get(kamera)
        if d and d["boyut"] != boyut:
            raise OtoKalibHatasi(
                f"Kare ölçüsü değişti: önceki {d['boyut'][0]}x{d['boyut'][1]}, "
                f"bu {boyut[0]}x{boyut[1]}. Harita tek çözünürlükte geçerli.")
        d = _TOPLANAN.setdefault(kamera, {
            "boyut": boyut, "noktalar": [], "etiket": secili["kimlik"]})
        # AYNI YERİ İKİ KEZ ÖLÇMEK yeni bilgi taşımıyor ve hatayı
        # olduğundan iyi gösteriyor: aynı nokta iki kez sayılıyor.
        for n in d["noktalar"]:
            if math.dist(n["mm"], mm_xy) < EN_AZ_ARALIK_MM:
                raise OtoKalibHatasi(
                    f"Bu noktaya çok yakın bir ölçüm zaten var "
                    f"(X{n['mm'][0]:.0f} Y{n['mm'][1]:.0f}). En az "
                    f"{EN_AZ_ARALIK_MM:.0f} mm uzakta bir nokta seçin.")
        d["noktalar"].append({"mm": (float(mm_xy[0]), float(mm_xy[1])),
                              "px": (float(secili["merkez"][0]),
                                     float(secili["merkez"][1])),
                              "kimlik": secili["kimlik"]})
        sayi = len(d["noktalar"])
    return {"kabul": True, "nokta_sayisi": sayi, "kimlik": secili["kimlik"],
            "px": [round(secili["merkez"][0], 1), round(secili["merkez"][1], 1)],
            "mm": [round(mm_xy[0], 1), round(mm_xy[1], 1)], "boyut": list(boyut)}


def durum(kamera: str) -> dict[str, Any]:
    with _KILIT:
        d = _TOPLANAN.get(kamera)
        if not d:
            return {"nokta_sayisi": 0, "en_az": EN_AZ_NOKTA,
                    "onerilen": ONERILEN_NOKTA, "noktalar": []}
        return {"nokta_sayisi": len(d["noktalar"]), "en_az": EN_AZ_NOKTA,
                "onerilen": ONERILEN_NOKTA, "boyut": d["boyut"],
                "etiket": d.get("etiket"),
                "noktalar": [{"mm": list(n["mm"]), "px": [round(v, 1) for v in n["px"]]}
                             for n in d["noktalar"]]}


def temizle(kamera: str) -> None:
    with _KILIT:
        _TOPLANAN.pop(kamera, None)


def _projektif(px: list[tuple[float, float]],
               mm: list[tuple[float, float]]) -> list[list[float]] | None:
    """Piksel → milimetre projektif dönüşümü (homografi), en küçük kareler.

    Dört nokta tam belirliyor; fazlası hatayı ölçülebilir yapıyor. numpy
    dışında bir bağımlılık yok — `cv2.findHomography` da işi görürdü ama
    OpenCV'yi bu yol için zorunlu kılmamak, kurulu olmayan bir sistemde
    haritanın da kapanması demekti.
    """
    import numpy as np

    if len(px) < 4:
        return None
    A = []
    for (u, v), (x, y) in zip(px, mm):
        A.append([u, v, 1, 0, 0, 0, -u * x, -v * x, -x])
        A.append([0, 0, 0, u, v, 1, -u * y, -v * y, -y])
    _, _, vt = np.linalg.svd(np.asarray(A, dtype=float))
    h = vt[-1]
    if abs(h[8]) < 1e-12:
        return None
    h = h / h[8]
    return [[float(h[0]), float(h[1]), float(h[2])],
            [float(h[3]), float(h[4]), float(h[5])],
            [float(h[6]), float(h[7]), 1.0]]


def uygula(H: list[list[float]], u: float, v: float) -> tuple[float, float]:
    """Bir pikseli haritadan geçirip milimetreye çeviriyor."""
    payda = H[2][0] * u + H[2][1] * v + H[2][2]
    if abs(payda) < 1e-12:
        raise OtoKalibHatasi("Harita bu piksel için tanımsız")
    return ((H[0][0] * u + H[0][1] * v + H[0][2]) / payda,
            (H[1][0] * u + H[1][1] * v + H[1][2]) / payda)


def hesapla(kamera: str) -> dict[str, Any]:
    """Ölçülen noktalardan haritayı çıkarıyor.

    İKİ MODEL BİRDEN. Benzerlik (ölçek, dönme, kaydırma) panelin ve bahçe
    ekranının bugün kullandığı biçim; projektif olan üstüne perspektifi de
    alıyor. İkisinin hatası da yazılıyor: aradaki fark, kameranın ne kadar
    eğik baktığını söylüyor.
    """
    import etiket

    with _KILIT:
        d = _TOPLANAN.get(kamera)
        if not d or len(d["noktalar"]) < EN_AZ_NOKTA:
            var = 0 if not d else len(d["noktalar"])
            raise OtoKalibHatasi(
                f"Yeterli nokta yok: {var}/{EN_AZ_NOKTA}. Makineyi yatağın "
                "farklı yerlerine götürüp ölçmeye devam edin.")
        noktalar = list(d["noktalar"])
        boyut = d["boyut"]
        kimlik = d.get("etiket")

    px = [n["px"] for n in noktalar]
    mm = [n["mm"] for n in noktalar]
    cu, cv = boyut[0] / 2.0, boyut[1] / 2.0

    # --- benzerlik: mevcut kayıt biçimi (mm_px, dönme, ofset) -------------
    en_iyi = None
    for ayna in (False, True):
        p = [(u - cu, -(v - cv) if ayna else (v - cv)) for u, v in px]
        c = etiket._benzerlik(p, mm)
        if c is None:
            continue
        c["ayna_y"] = ayna
        if en_iyi is None or c["artik_mm"] < en_iyi["artik_mm"]:
            en_iyi = c
    if en_iyi is None:
        raise OtoKalibHatasi(
            "Noktalar üst üste düşüyor — aralarında ölçülebilir mesafe yok.")

    # --- projektif: perspektifi de alan harita ---------------------------
    H = _projektif(px, mm)
    proj_artik = None
    if H is not None:
        kare = 0.0
        for (u, v), (x, y) in zip(px, mm):
            hx, hy = uygula(H, u, v)
            kare += (hx - x) ** 2 + (hy - y) ** 2
        proj_artik = math.sqrt(kare / len(px))

    aci = math.degrees(en_iyi["aci"])
    yayilim_x = max(m[0] for m in mm) - min(m[0] for m in mm)
    yayilim_y = max(m[1] for m in mm) - min(m[1] for m in mm)

    # DAR BİR ALANDAN ÇIKAN HARİTA, o alanın dışında tahmindir. Yatağın
    # ancak bir köşesinde ölçüm yapıldıysa bunu söylemek gerekiyor.
    uyari = ""
    if yayilim_x < 100.0 or yayilim_y < 100.0:
        uyari = (f"Ölçümler dar bir alandan: X'te {yayilim_x:.0f} mm, Y'de "
                 f"{yayilim_y:.0f} mm yayılmış. Harita bu alanın dışında "
                 "tahmine dayanıyor — yatağın dört köşesine de gidin.")
    elif len(noktalar) < ONERILEN_NOKTA:
        uyari = (f"{len(noktalar)} nokta ile çalışıyor; {ONERILEN_NOKTA} nokta "
                 "hem daha doğru olur hem hatayı daha güvenilir ölçer.")

    return {
        "mm_px": en_iyi["olcek"],
        "donme": (aci + 180.0) % 360.0 - 180.0,
        "ofset_x": en_iyi["tx"],
        "ofset_y": en_iyi["ty"],
        "ayna_y": en_iyi["ayna_y"],
        "benzerlik_artik_mm": round(en_iyi["artik_mm"], 2),
        "projektif_artik_mm": None if proj_artik is None else round(proj_artik, 2),
        "harita": H,
        "nokta_sayisi": len(noktalar),
        "etiket": kimlik,
        "boyut": list(boyut),
        "yayilim_mm": [round(yayilim_x, 1), round(yayilim_y, 1)],
        "guvenilir": not uyari,
        "uyari": uyari,
    }


# --------------------------------------------------------------------------- #
# Uç noktalar
# --------------------------------------------------------------------------- #
def yonlendirici_kur(parola_dogrula, canli_kare, git_ve_bekle):
    import inspect

    """`git_ve_bekle(x, y, z)` hareketi yapıp BİTMESİNİ bekliyor.

    Hareketi burada değil çağıranda tutuyoruz: makineyi süren tek yer
    `main.py` ve ikinci bir yol açmak, güvenlik denetimlerinin yalnız
    birinden geçen bir hareket demekti.
    """
    import asyncio

    from fastapi import APIRouter, HTTPException, Query

    yon = APIRouter()

    def _kam(govde: dict[str, Any]) -> str:
        import kalibrasyon
        return kalibrasyon.ad_temizle((govde or {}).get("kamera"))

    @yon.get("/api/kamera/otokalib/durum")
    async def _durum(kamera: str = Query(default="ust"), jeton: str = Query(default="")):
        parola_dogrula(jeton)
        import kalibrasyon
        kam = kalibrasyon.ad_temizle(kamera)
        return {"kamera": kam, "toplama": durum(kam)}

    @yon.post("/api/kamera/otokalib/nokta")
    async def _nokta(govde: dict[str, Any], jeton: str = Query(default="")):
        """Makineyi bir noktaya götürüp işareti ölçüyor.

        Gövde: {"kamera","x","y","z"(istege bagli),"etiket"(istege bagli)}
        """
        parola_dogrula(jeton)
        kam = _kam(govde)
        try:
            x = float(govde["x"])
            y = float(govde["y"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=400, detail="X ve Y sayı olmalı.")
        z = govde.get("z")
        etiket_kimlik = govde.get("etiket")

        hata = await git_ve_bekle(x, y, None if z in (None, "") else float(z))
        if hata:
            raise HTTPException(status_code=409, detail=hata)

        # Titreşim otursun: hareket bittiği anda alınan kare bulanık olabilir
        # ve bulanık kare, köşeleri yanlış yere oturtuyor.
        await asyncio.sleep(0.6)
        kare = canli_kare(kam)
        if inspect.isawaitable(kare):
            kare = await kare
        if not kare:
            raise HTTPException(
                status_code=409,
                detail=f"'{kam}' kamerasından taze kare gelmiyor — canlı akış "
                       "durmuş görünüyor. Kamera sekmesini açık tutun.")
        try:
            return await asyncio.to_thread(
                nokta_ekle, kam, (x, y), kare,
                None if etiket_kimlik in (None, "") else int(etiket_kimlik))
        except OtoKalibHatasi as h:
            raise HTTPException(status_code=400, detail=str(h))
        except Exception as h:      # etiket.EtiketHatasi dahil
            raise HTTPException(status_code=400, detail=str(h))

    @yon.post("/api/kamera/otokalib/hesapla")
    async def _hesapla(govde: dict[str, Any] | None = None,
                       jeton: str = Query(default="")):
        import kalibrasyon

        parola_dogrula(jeton)
        govde = govde or {}
        kam = _kam(govde)
        try:
            sonuc = await asyncio.to_thread(hesapla, kam)
        except OtoKalibHatasi as h:
            raise HTTPException(status_code=400, detail=str(h))
        if govde.get("kaydet"):
            import time
            sonuc["kalibrasyon"] = await asyncio.to_thread(kalibrasyon.kaydet, {
                "mm_px": sonuc["mm_px"], "donme": sonuc["donme"],
                "ofset_x": sonuc["ofset_x"], "ofset_y": sonuc["ofset_y"],
                "ayna_y": sonuc["ayna_y"],
                "genislik_px": sonuc["boyut"][0], "yukseklik_px": sonuc["boyut"][1],
                "yontem": "otokalib", "guncelleme": time.time(),
            }, kam)
        return {"kamera": kam, "sonuc": sonuc}

    @yon.post("/api/kamera/otokalib/temizle")
    async def _temizle(govde: dict[str, Any] | None = None,
                       jeton: str = Query(default="")):
        parola_dogrula(jeton)
        kam = _kam(govde or {})
        temizle(kam)
        return {"ok": True, "kamera": kam, "toplama": durum(kam)}

    return yon
