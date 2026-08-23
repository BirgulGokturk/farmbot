"""Farmbot bulut sunucusu.

    Arduino ──USB seri──> Raspberry Pi (ajan) ──WSS──> BU SUNUCU <──WSS── Tarayıcı
                              │
                              └── Modbus TCP ──> PLC (eksen hareketi)

Sunucunun tek işi köprülük: ajandan gelen ölçümleri hem veritabanına yazar
hem de açık panellere anında iletir; panelden gelen komutları ajana gönderir.
Karar mekanizması burada değil — makineye yakın olan yerde (ajan/Arduino).
Böylece internet kopsa bile makine kendi başına güvenli davranmaya devam eder.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import depo

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("farmbot")

# Ajanın kendini tanıtırken kullandığı gizli anahtar. Bulutta çalışan bir
# adres herkese açık olduğu için bu zorunlu; boş bırakılırsa sunucu açılmaz.
AJAN_JETONU = os.environ.get("AJAN_JETONU", "")
# Panel parolası isteğe bağlı: boşsa panel herkese açık olur (yerel ağ için
# uygun), doluysa tarayıcı bu değeri sormadan bağlanamaz.
PANEL_PAROLA = os.environ.get("PANEL_PAROLA", "")
# Baska bir arayuzun (ornegin ayri bir gelistirme sunucusunda calisan
# farmbot-web) tarayicidan bu API'yi cagirabilmesi icin kokeni burada
# tek tek saymak gerekiyor. Bos birakilirsa CORS hic acilmaz: robotu
# hareket ettiren bir API'de varsayilanin "herkese acik" olmasi dogru
# degil. Ornek: IZINLI_KOKENLER="http://localhost:5173,http://batupi.local:3000"
IZINLI_KOKENLER = [k.strip() for k in os.environ.get("IZINLI_KOKENLER", "").split(",") if k.strip()]

# Ajan bir komuta bu süre içinde yanıt vermezse "zaman aşımı" deriz.
KOMUT_ZAMAN_ASIMI = 20.0
# Bu süre boyunca ajandan tek satır gelmezse bağlantıyı ölü sayarız.
AJAN_SESSIZLIK_SINIRI = 30.0

IZINLI_KOMUTLAR = {
    "jog",           # {"eksen":"x","yon":1,"basili":true} — basılı tut hareketi
    "jog_dur",       # {}                            — tüm jog bitlerini bırak
    "git",           # {"x":100,"y":50,"z":400}      — mutlak konuma git (Z→Y→X)
    "home",          # {"eksen":"z"} ya da {}        — referans arama
    "dur",           # {}                            — hareketi durdur
    "acil",          # {}                            — ACİL DURDURMA (mandallı)
    "acil_temizle",  # {}                            — mandalı temizle
    "enable",        # {"deger": true|false}         — sürücü torku
    "hiz",           # {"mm_s": 20}
    "servo",         # {"aci": 90}
    "kip",           # {"deger": "oto" | "manuel"}
    "role",          # {"ad": "su_pompasi"|"hava_pompasi"|"su_vanasi", "durum": true}
}

# Basılı tut jog'unda yanıt beklemiyoruz: panel saniyede 3-4 yenileme
# gönderiyor ve her biri için gidiş-dönüş beklemek hem gecikme yaratır hem de
# yavaş bir turda "zaman aşımı" hataları üretir. Güvenlik yanıta değil, ajanın
# kira bekçisine dayanıyor.
HIZLI_KOMUTLAR = {"jog", "jog_dur"}


class Merkez:
    """Ajan ve paneller arasındaki tek buluşma noktası.

    Neden tek ajan? Şu an tek makine var. Birden fazla makine gerekirse
    burada sözlüğe (makine_kimligi -> WebSocket) dönmek yeterli olacak;
    protokolün geri kalanı değişmiyor.
    """

    def __init__(self) -> None:
        self.ajan: WebSocket | None = None
        self.ajan_son_haber: float = 0.0
        self.paneller: set[WebSocket] = set()
        # Ajandan gelen son değerler — panel açıldığında ekran boş kalmasın.
        self.son_olcum: dict[str, Any] = {}
        self.son_durum: dict[str, Any] = {
            "bagli": False,
            "kip": "bilinmiyor",
            "konum": {"x": None, "y": None, "z": None},
            "plc": "bilinmiyor",
            "enable": False,
            "hareket": False,
            "jog": [],
            "z_guvenli": False,
            "guvenli_z": None,
            "acil": {"acik": False, "saat": "", "neden": ""},
            "sinirlar": {},
            "hiz": None,
            "hata": None,
        }
        # Gönderilip yanıtı beklenen komutlar: komut_id -> Future
        self._bekleyen: dict[str, asyncio.Future] = {}

    # --- panel yayını ----------------------------------------------------
    async def yayinla(self, mesaj: dict[str, Any]) -> None:
        if not self.paneller:
            return
        ham = json.dumps(mesaj, ensure_ascii=False)
        kopanlar = []
        for ws in list(self.paneller):
            try:
                await ws.send_text(ham)
            except Exception:
                kopanlar.append(ws)
        for ws in kopanlar:
            self.paneller.discard(ws)

    def anlik_goruntu(self) -> dict[str, Any]:
        """Panel bağlandığında gönderilen ilk paket."""
        return {
            "tip": "anlik",
            "durum": self.durum(),
            "olcum": self.son_olcum,
        }

    def durum(self) -> dict[str, Any]:
        canli = self.ajan is not None and (time.time() - self.ajan_son_haber) < AJAN_SESSIZLIK_SINIRI
        return {**self.son_durum, "bagli": canli, "sunucu_saati": time.time()}

    # --- komut gönderimi -------------------------------------------------
    async def komut_yolla(self, ad: str, arg: dict[str, Any]) -> None:
        """Yanıt beklemeden gönderir (jog yenilemeleri için)."""
        if self.ajan is None:
            raise HTTPException(status_code=503, detail="Ajan bağlı değil (Raspberry Pi çevrimdışı)")
        await self.ajan.send_text(
            json.dumps({"tip": "komut", "id": "-", "ad": ad, "arg": arg}, ensure_ascii=False)
        )

    async def komut_gonder(self, ad: str, arg: dict[str, Any]) -> dict[str, Any]:
        if self.ajan is None:
            raise HTTPException(status_code=503, detail="Ajan bağlı değil (Raspberry Pi çevrimdışı)")

        komut_id = uuid.uuid4().hex[:12]
        beklenen: asyncio.Future = asyncio.get_running_loop().create_future()
        self._bekleyen[komut_id] = beklenen

        try:
            await self.ajan.send_text(
                json.dumps({"tip": "komut", "id": komut_id, "ad": ad, "arg": arg}, ensure_ascii=False)
            )
            # Ajan yanıtı gelene kadar bekliyoruz: panelde "gönderildi" deyip
            # sonucu göstermemek, hareket etmeyen bir makineyi çalışıyor gibi
            # gösterir. Hatanın kullanıcıya ulaşması önemli.
            return await asyncio.wait_for(beklenen, timeout=KOMUT_ZAMAN_ASIMI)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Ajan komuta zamanında yanıt vermedi")
        finally:
            self._bekleyen.pop(komut_id, None)

    def sonuc_isle(self, mesaj: dict[str, Any]) -> None:
        beklenen = self._bekleyen.get(str(mesaj.get("id")))
        if beklenen is not None and not beklenen.done():
            beklenen.set_result(
                {"ok": bool(mesaj.get("ok")), "mesaj": mesaj.get("mesaj", ""), "veri": mesaj.get("veri")}
            )


merkez = Merkez()


async def _budama_dongusu() -> None:
    """Günde bir eski ölçümleri siler."""
    while True:
        try:
            silinen = await asyncio.to_thread(depo.buda)
            if silinen:
                logger.info("Geçmişten %d eski satır silindi", silinen)
        except Exception:
            logger.exception("Budama başarısız")
        await asyncio.sleep(86400)


@asynccontextmanager
async def yasam(app: FastAPI):
    if not AJAN_JETONU:
        raise RuntimeError("AJAN_JETONU ortam değişkeni zorunlu — ajanla aynı değeri kullanın")
    await asyncio.to_thread(depo.baglan)
    merkez.son_olcum = await asyncio.to_thread(depo.son_kayit) or {}
    gorev = asyncio.create_task(_budama_dongusu())
    logger.info("Sunucu hazır. Panel parolası: %s", "var" if PANEL_PAROLA else "yok (açık)")
    yield
    gorev.cancel()


app = FastAPI(title="Farmbot", lifespan=yasam)

if IZINLI_KOKENLER:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=IZINLI_KOKENLER,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    logger.info("CORS acik: %s", ", ".join(IZINLI_KOKENLER))


# --------------------------------------------------------------------------- #
# WebSocket — Raspberry Pi ajanı
# --------------------------------------------------------------------------- #
@app.websocket("/ws/ajan")
async def ws_ajan(ws: WebSocket, jeton: str = Query(default="")):
    if jeton != AJAN_JETONU:
        await ws.close(code=4401, reason="Gecersiz jeton")
        return

    await ws.accept()
    # Aynı anda tek ajan: yeniden bağlanmalarda eskisini düşürüyoruz. Aksi
    # halde kopmuş ama kapanmamış bir soket komutları yutardı.
    if merkez.ajan is not None:
        try:
            await merkez.ajan.close(code=4409, reason="Yeni ajan baglandi")
        except Exception:
            pass
    merkez.ajan = ws
    merkez.ajan_son_haber = time.time()
    logger.info("Ajan bağlandı")
    await merkez.yayinla({"tip": "durum", "durum": merkez.durum()})

    try:
        while True:
            ham = await ws.receive_text()
            merkez.ajan_son_haber = time.time()
            try:
                mesaj = json.loads(ham)
            except json.JSONDecodeError:
                logger.warning("Ajandan bozuk JSON: %.120s", ham)
                continue

            tip = mesaj.get("tip")

            if tip == "olcum":
                veri = mesaj.get("veri") or {}
                merkez.son_olcum = {**veri, "ts": mesaj.get("ts", time.time())}
                # Yazma diski bekletir; olay döngüsünü tıkamasın diye ayrı
                # iş parçacığına atıyoruz.
                await asyncio.to_thread(depo.yaz, veri, merkez.son_olcum["ts"])
                await merkez.yayinla({"tip": "olcum", "veri": merkez.son_olcum})

            elif tip == "durum":
                merkez.son_durum.update(mesaj.get("durum") or {})
                await merkez.yayinla({"tip": "durum", "durum": merkez.durum()})

            elif tip == "sonuc":
                merkez.sonuc_isle(mesaj)

            elif tip == "gunluk":
                await merkez.yayinla(
                    {"tip": "gunluk", "seviye": mesaj.get("seviye", "bilgi"), "metin": mesaj.get("metin", "")}
                )

            elif tip == "ping":
                await ws.send_text(json.dumps({"tip": "pong"}))

    except WebSocketDisconnect:
        logger.info("Ajan bağlantısı koptu")
    except Exception:
        logger.exception("Ajan soketinde hata")
    finally:
        if merkez.ajan is ws:
            merkez.ajan = None
        await merkez.yayinla({"tip": "durum", "durum": merkez.durum()})


# --------------------------------------------------------------------------- #
# WebSocket — tarayıcı paneli
# --------------------------------------------------------------------------- #
@app.websocket("/ws/panel")
async def ws_panel(ws: WebSocket, jeton: str = Query(default="")):
    if PANEL_PAROLA and jeton != PANEL_PAROLA:
        await ws.close(code=4401, reason="Gecersiz parola")
        return

    await ws.accept()
    merkez.paneller.add(ws)
    await ws.send_text(json.dumps(merkez.anlik_goruntu(), ensure_ascii=False))
    try:
        while True:
            # Komutların çoğu REST üzerinden gidiyor (hata kodu ve yanıt
            # beklemek orada kolay). İstisna: basılı tut jog'u. Saniyede
            # birkaç kez tekrarlanan bir yenileme için HTTP isteği hem yavaş
            # hem israf; açık soketten geçmesi çok daha akıcı.
            ham = await ws.receive_text()
            try:
                mesaj = json.loads(ham)
            except json.JSONDecodeError:
                continue
            if mesaj.get("tip") == "jog" and merkez.ajan is not None:
                ad = "jog_dur" if mesaj.get("hepsi_dur") else "jog"
                try:
                    await merkez.komut_yolla(ad, {
                        "eksen": mesaj.get("eksen"),
                        "yon": mesaj.get("yon"),
                        "basili": bool(mesaj.get("basili")),
                    })
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Panel soketinde hata")
    finally:
        merkez.paneller.discard(ws)


# --------------------------------------------------------------------------- #
# REST
# --------------------------------------------------------------------------- #
def _parola_dogrula(jeton: str) -> None:
    if PANEL_PAROLA and jeton != PANEL_PAROLA:
        raise HTTPException(status_code=401, detail="Parola hatalı")


@app.get("/api/durum")
async def api_durum(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return {"durum": merkez.durum(), "olcum": merkez.son_olcum, "panel_kilitli": bool(PANEL_PAROLA)}


@app.get("/api/gecmis")
async def api_gecmis(dakika: int = Query(default=60, ge=1, le=60 * 24 * 7), jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return await asyncio.to_thread(depo.gecmis, dakika)


@app.post("/api/komut")
async def api_komut(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    ad = str(govde.get("ad", ""))
    if ad not in IZINLI_KOMUTLAR:
        raise HTTPException(status_code=400, detail=f"Bilinmeyen komut: {ad}")
    arg = govde.get("arg") or {}
    if not isinstance(arg, dict):
        raise HTTPException(status_code=400, detail="arg bir nesne olmalı")
    if ad in HIZLI_KOMUTLAR:
        await merkez.komut_yolla(ad, arg)
        return {"ok": True, "mesaj": "", "sessiz": True}
    return await merkez.komut_gonder(ad, arg)


@app.get("/saglik")
async def saglik():
    """Render'ın servisi ayakta tutmak için çağırdığı uç."""
    return {"ok": True, "ajan_bagli": merkez.durum()["bagli"]}


# Arayüz en sonda bağlanıyor: kök yolu ("/") kaplıyor, önce API yolları
# tanımlı olmalı.
_STATIK = os.path.join(os.path.dirname(__file__), "static")
app.mount("/statik", StaticFiles(directory=_STATIK), name="statik")


@app.get("/")
async def anasayfa():
    return FileResponse(os.path.join(_STATIK, "index.html"))
