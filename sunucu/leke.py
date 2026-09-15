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

        return {"ok": True, "kamera": kam, "damga": damga,
                "kare_hatasi": kare_hatasi, **sonuc}

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

    return yonlendirici


def _coz(b64: str) -> bytes | None:
    try:
        return base64.b64decode(b64, validate=True)
    except Exception:                                       # noqa: BLE001
        return None
