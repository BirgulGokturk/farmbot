"""Bitki lekeleri — panel ile ajan arasındaki köprü.

Burada görüntü İŞLENMİYOR. İş ajanda (`ajan/lekeler.py`): kare orada,
OpenCV orada kurulu ve bu sunucu bulutta da çalışabiliyor — orada
OpenCV'nin bulunacağı garanti değil. Bu modül komutu iletiyor, çözümlenen
kareyi saklıyor ve panelin ikisini birlikte çekebilmesini sağlıyor.

KARE NEDEN SAKLANIYOR
---------------------
Kutular bir kareye ait. Panel kendi canlı akışının üstüne çizseydi,
çözümleme ile çizim arasında geçen sürede makine ya da bir yaprak
kımıldadığında kutular kaymış görünürdü — ve bu kayma sessiz olurdu,
kimse fark etmezdi. Onun yerine çözümlenen karenin kendisi tutuluyor,
panel onu çekip donmuş görüntünün üstüne çiziyor.

BELLEKTE, ARŞİVDE DEĞİL
-----------------------
`kareler` arşivi kamera başına yalnız 12 kare tutuyor (`AZAMI_KARE`) ve
en eskiyi atıyor. Çözümleme karelerini oraya yazmak, birkaç denemede
kullanıcının periyodik karelerinin tamamını itip atmak olurdu — üstelik
sessizce. Çözümleme karesinin geçmişi de gerekmiyor: soru "şu an ne
görünüyor", bir hafta önce ne göründüğü değil. Canlı karede olduğu gibi
kamera başına tek kare, bellekte.

MİLİMETRE YOK
-------------
Çıktının tamamı piksel. Kamera kalibrasyonu yok; koordinat üretmek
uydurma olurdu. Kalibrasyon geldiğinde dönüşüm ayrı bir katmanda
eklenecek, bu modül değişmeyecek.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import threading
import time
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

import kareler
import olcum as olcum_modul

logger = logging.getLogger("tarim.leke")

#: Çözümlenen son kare, KAMERA BAŞINA: {ad: {"veri": bytes, "ts": float}}.
#: Tek alan yetmiyordu — iki kamera arka arkaya çözümlenince biri
#: ötekinin karesini eziyor ve panel yanlış görüntünün üstüne çiziyordu.
_SON_KARE: dict[str, dict[str, Any]] = {}
_KILIT = threading.Lock()

#: Bellekte tutulan karenin üst sınırı. 4K bir JPEG ~1.5 MB; bunun çok
#: üstü bir şey geldiyse kare değil bir arıza vardır ve onu bellekte
#: tutmak sunucuyu düşürebilir.
AZAMI_BAYT = 12 * 1024 * 1024


def yonlendirici_kur(komut_gonder: Callable, parola_dogrula: Callable) -> APIRouter:
    """Uçları kurar. Bağımlılıklar dışarıdan geliyor — `main` içe aktarmıyoruz."""
    yonlendirici = APIRouter(prefix="/api/leke", tags=["leke"])

    @yonlendirici.post("/bul")
    async def leke_bul(govde: dict[str, Any] | None = None,
                       jeton: str = Query(default="")):
        """Seçili kameradan bir kare çekip lekeleri bulur.

        `govde`: {"kamera": "uc", "ayar": {...}}. `ayar` verilirse ajandaki
        varsayılanların üstüne biniyor (eşik payı, en küçük leke, işleme
        genişliği) — panelin deneme yapabilmesi için. KALICI DEĞİL:
        kaydedilmiyor, her çağrıda yeniden veriliyor. Kalıcı olsaydı bir
        denemede girilen değer aylar sonra "neden hiçbir şey bulmuyor"
        sorusunun sessiz cevabı olurdu.
        """
        parola_dogrula(jeton)
        istek = govde or {}
        kamera = kareler.ad_temizle(istek.get("kamera") or "")
        arg: dict[str, Any] = {"kamera": kamera}
        if isinstance(istek.get("ayar"), dict):
            arg["ayar"] = istek["ayar"]

        try:
            cevap = await komut_gonder("leke_bul", arg)
        except Exception as hata:                           # noqa: BLE001
            raise HTTPException(status_code=503,
                                detail=f"Ajana ulaşılamadı: {hata}") from None
        if not (cevap or {}).get("ok"):
            raise HTTPException(
                status_code=409,
                detail=str((cevap or {}).get("mesaj")
                           or "Ajan leke bulamadı (sebep bildirmedi)"))

        veri = (cevap or {}).get("veri") or {}
        sonuc = dict(veri.get("leke") or {})
        kam = kareler.ad_temizle(veri.get("kamera") or kamera)

        # Kareyi saklıyoruz ki panel kutuları DOĞRU karenin üstüne çizsin.
        # Saklanamazsa çözümleme yine dönüyor: sayılar okunur, kutular
        # çizilemez ve sebebi çıktıda yazıyor.
        damga = None
        kare_hatasi = ""
        b64 = veri.get("kare") or ""
        if b64:
            ham = await asyncio.to_thread(_coz, b64)
            if ham is None:
                kare_hatasi = "ajandan gelen kare çözülemedi (bozuk base64)"
            elif len(ham) > AZAMI_BAYT:
                kare_hatasi = (f"kare çok büyük ({len(ham)//1024} KB, sınır "
                               f"{AZAMI_BAYT//1024} KB) — bellekte tutulmuyor")
            else:
                ts = time.time()
                with _KILIT:
                    _SON_KARE[kam] = {"veri": ham, "ts": ts}
                damga = f"{ts:.3f}"
        else:
            kare_hatasi = "ajan kareyi göndermedi"

        # ÖLÇÜMÜ KAYDEDİYORUZ. Elle basılan düğme `zorla` ile geçiyor:
        # aralık beklemek, basılan düğmenin hiçbir şey yapmaması olurdu.
        if sonuc.get("olcum"):
            await asyncio.to_thread(
                olcum_modul.ekle, kam, sonuc["olcum"], sonuc.get("konum"),
                None, True)

        return {"ok": True, "kamera": kam, "damga": damga,
                "kare_hatasi": kare_hatasi, **sonuc}

    @yonlendirici.post("/toprak")
    async def leke_toprak(govde: dict[str, Any] | None = None,
                          jeton: str = Query(default="")):
        """Saklı kareden toprağın çevresini çıkarır — ilgi alanını elle
        çizmek yerine.

        Köşeler ORANLI (0-1) dönüyor; panel bunu doğrudan ilgi alanı
        olarak kullanıyor ve köşeleri Shift ile düzeltebiliyor. KARE
        GEREKİYOR: çözümleme yapılmadan saklı kare olmuyor; uydurma bir
        kareyle çalışmaktansa sebebi söyleyip duruyoruz.
        """
        parola_dogrula(jeton)
        kam = kareler.ad_temizle((govde or {}).get("kamera") or "")
        with _KILIT:
            kayit = _SON_KARE.get(kam)
        if not kayit or not kayit.get("veri"):
            raise HTTPException(status_code=409,
                                detail="Saklı kare yok — önce çözümleyin.")
        try:
            import toprak as toprak_modulu
        except Exception as hata:                       # noqa: BLE001
            raise HTTPException(
                status_code=503,
                detail=f"toprak modülü yüklenemedi: {hata}") from None
        sonuc = await asyncio.to_thread(toprak_modulu.bayttan, kayit["veri"])
        if not sonuc:
            raise HTTPException(
                status_code=409,
                detail="Toprak bulunamadı — kadrajda yeterince büyük bir "
                       "toprak alanı yok ya da renk kapısı tutmadı.")
        return {"ok": True, "kamera": kam, **sonuc}

    @yonlendirici.post("/kesit")
    async def leke_kesit(govde: dict[str, Any] | None = None,
                         jeton: str = Query(default="")):
        """Seçili lekelerin kesitlerini eğitim verisine yazar.

        LEKELER PANELDEN GELİYOR, sunucu yeniden çözümlemiyor: kullanıcı
        ekranda hangi kutuları seçtiyse eğitime giden de o. Sunucu kendi
        listesini üretse, görülen ile kaydedilen ayrışır ve fark sessiz
        kalırdı.
        """
        parola_dogrula(jeton)
        istek = govde or {}
        kam = kareler.ad_temizle(istek.get("kamera") or "")
        with _KILIT:
            kayit = _SON_KARE.get(kam)
        if not kayit or not kayit.get("veri"):
            raise HTTPException(status_code=409,
                                detail="Saklı kare yok — önce çözümleyin.")
        try:
            from gorus import toplama
        except Exception as hata:                       # noqa: BLE001
            raise HTTPException(
                status_code=503,
                detail=f"toplama modülü yüklenemedi: {hata}") from None
        sonuc = await asyncio.to_thread(
            toplama.kaydet, kayit["veri"], istek.get("lekeler") or [],
            str(istek.get("tur") or ""), kam, {"roi": bool(istek.get("roi"))})
        if not sonuc.get("ok"):
            raise HTTPException(status_code=409, detail=str(sonuc.get("mesaj")))
        return {**sonuc, "sayim": await asyncio.to_thread(toplama.sayim)}

    @yonlendirici.get("/kare")
    async def leke_kare(kamera: str = Query(default=""),
                        jeton: str = Query(default=""),
                        damga: str = Query(default="")):
        """Son çözümlenen kare. `damga` yalnız önbelleği kırmak için.

        Panel `<img>` ile çekiyor; başlık gönderemediği için jeton
        sorguda.
        """
        parola_dogrula(jeton)
        kam = kareler.ad_temizle(kamera or "")
        with _KILIT:
            kayit = _SON_KARE.get(kam)
        if not kayit or not kayit.get("veri"):
            raise HTTPException(
                status_code=404,
                detail=f"[{kam}] için çözümlenmiş kare yok — önce 'Lekeleri bul'.")
        return Response(
            content=kayit["veri"], media_type="image/jpeg",
            # Önbelleğe ALINMIYOR: aynı adres her çözümlemede başka bir
            # kare gösteriyor ve tarayıcı eskisini verirse kutular
            # ilgisiz bir görüntünün üstüne düşer.
            headers={"Cache-Control": "no-store"})

    @yonlendirici.get("/gecmis")
    async def leke_gecmis(kamera: str = Query(default=""),
                          saat: float = Query(default=72.0, ge=0.1, le=24 * 365),
                          jeton: str = Query(default="")):
        """Ölçüm geçmişi — büyüme eğrisi için.

        Kamera oynadığında aynı yatağın yeşil oranı bambaşka çıkıyor;
        kayıtların içindeki `konum` bunu ayırt etmek için duruyor ve
        panel farklı konumları ayrı seri sayıyor. Hepsini tek eğriye
        dizmek, olmayan bir büyümeyi göstermek olurdu.
        """
        parola_dogrula(jeton)
        kayitlar = await asyncio.to_thread(
            olcum_modul.gecmis, kareler.ad_temizle(kamera) if kamera else "",
            saat)
        return {"kayitlar": kayitlar, "adet": len(kayitlar),
                "aralik_sn": olcum_modul.ARALIK_SN}

    return yonlendirici


async def olcum_dongusu(durum_al: Callable, aralik_sn: float = 30.0) -> None:
    """Sürekli kipin ürettiği ölçümleri zaman serisine yazar.

    NEDEN AYRI DÖNGÜ: sürekli kipin sonuçları `/api/leke/bul`tan
    geçmiyor, ajanın durum paketiyle geliyor. Kaydı o paketin işlendiği
    yere iliştirmek, ölçüm mantığını sunucunun en kalabalık dosyasına
    dağıtmak olurdu.

    ARALIK BURADA DEĞİL `olcum.ARALIK_SN` içinde: bu döngü sık bakıyor
    (durum paketi tazeliğini kaçırmamak için), ama `olcum.ekle` kendi
    aralığını koruyup fazlasını atıyor. İki yerde iki aralık, biri
    güncellenmeyince sessizce ayrışırdı.
    """
    while True:
        try:
            await asyncio.sleep(max(5.0, float(aralik_sn)))
            durum = durum_al() or {}
            lekeler = durum.get("lekeler") or {}
            if not isinstance(lekeler, dict):
                continue
            for kam, sonuc in lekeler.items():
                if not isinstance(sonuc, dict):
                    continue
                olcum = sonuc.get("olcum")
                # Sebep varsa (akış kapalı, kare eskimiş) ÖLÇÜM YOK ve
                # sıfır yazmıyoruz: "0 bitki" ile "bakamadım" aynı şey
                # değil ve grafikte ikisi aynı görünürdü.
                if not olcum or sonuc.get("sebep"):
                    continue
                await asyncio.to_thread(
                    olcum_modul.ekle, str(kam), olcum, sonuc.get("konum"))
        except asyncio.CancelledError:
            raise
        except Exception:                                   # noqa: BLE001
            logger.exception("Ölçüm döngüsünde beklenmeyen hata")
            await asyncio.sleep(10.0)


def _coz(b64: str) -> bytes | None:
    try:
        return base64.b64decode(b64, validate=True)
    except Exception:                                       # noqa: BLE001
        return None
