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
import base64
import json
import logging
import math
import os
import re
import subprocess
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

import arsiv
import bahce
import baslar
import depo
import etiket
import tahta
import dikim
import egriler
import ekim
import geri_al
import kalibrasyon
import kareler
import kuyruk as kuyruk_modul
import noktalar
import programlar
import sulama
import turler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("tarim")

# Ajanın kendini tanıtırken kullandığı gizli anahtar. Bulutta çalışan bir
# adres herkese açık olduğu için bu zorunlu; boş bırakılırsa sunucu açılmaz.
AJAN_JETONU = os.environ.get("AJAN_JETONU", "")
# Panel parolası isteğe bağlı: boşsa panel herkese açık olur (yerel ağ için
# uygun), doluysa tarayıcı bu değeri sormadan bağlanamaz.
PANEL_PAROLA = os.environ.get("PANEL_PAROLA", "")

# Ajan bir komuta bu süre içinde yanıt vermezse "zaman aşımı" deriz.
KOMUT_ZAMAN_ASIMI = 20.0
# Bu süre boyunca ajandan tek satır gelmezse bağlantıyı ölü sayarız.
AJAN_SESSIZLIK_SINIRI = 30.0

# Statik dosya kökü: /api/katmanlar da bunu kullandığı için uçlardan önce
# tanımlı olmak zorunda.
_STATIK = os.path.join(os.path.dirname(__file__), "static")

IZINLI_KOMUTLAR = {
    "jog",           # {"eksen":"x","yon":1,"basili":true} — basılı tut hareketi
    "jog_dur",       # {}                            — tüm jog bitlerini bırak
    "git",           # {"x":100,"y":50,"z":400}      — mutlak konuma git (Z→Y→X)
    "home",          # {"eksen":"z"} ya da {}        — home KOORDINATINA git
    "dur",           # {}                            — hareketi durdur
    "acil",          # {}                            — ACİL DURDURMA (mandallı)
    "acil_temizle",  # {}                            — mandalı temizle
    "enable",        # {"deger": true|false}         — sürücü torku
    "hiz",           # {"mm_s": 20}
    "hiz_eksen",     # {"x":60,"y":null,"z":8,"t":10} — eksen başına; null = genel
    "kalibrasyon_kaydet",  # {"eksenler":[{home,min,max}x3]} — cpm/dir hariç
    "bolge_listele", # {}                            — ajandaki yasak bölgeler
    "bolge_kaydet",  # {"bolgeler":[…]}              — doğrular, dosyaya yazar
    "uc_listele",    # {}                            — kafa ayarları
    "uc_kaydet",     # {"ayar":{…}}                  — başlar + tohumluk
    "tohum_ucu",     # {"yukari":true} ya da {"mm":12.5} — tohum ucunun KENDİ
                     #   dikey ekseni (PLC'de j4). Ana Z'den ayrı.
    "goz_isaretle",  # {"ad":"s1","dolu":false,"tohum":"marul"} — tohumluk gözü
    "nokta_denetle", # {"noktalar":[{x,y,z}…]}      — yasak bölge + sınır ÖN kontrolü
    "dizi_baslat",   # {"ad":…,"adimlar":[…],"tekrar":1} — çözülmüş adımlarla
    "dizi_durdur",   # {}
    "kamera",        # {"kamera":"uc","acik": true|false, "aralik_sn": 3600}
    "kamera_kaydet", # {"kameralar":[{ad,etiket,hareketli,cihaz_adi,genislik,…}]}
    "kamera_cihazlar",  # {} — sistemdeki /dev/video* düğümleri ve adları
    "role",          # {"ad": "su_pompasi"|"hava_pompasi", "durum": true}
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
        # Canlı akışın son karesi — BELLEKTE, diskte değil. KAMERA BAŞINA tek
        # kare: canlı akışın geçmişi yok, "şu an ne görünüyor" sorusunun
        # cevabı var. İki kamera aynı anda akabildiği için tek bir alan
        # yetmiyordu; biri ötekinin karesini eziyordu.
        self.canli_kareler: dict[str, dict[str, Any]] = {}
        self.son_durum: dict[str, Any] = {
            "bagli": False,
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
            "bolgeler": [],
            "esnetme_acik": False,
            "uc": {},
            "dizi": {},
            "islem": "",
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

    def canli_kare_yaz(self, b64: str, ts: float,
                       kamera: str = kareler.VARSAYILAN_KAMERA) -> None:
        """Canlı kareyi belleğe alır. Bozuk ya da aşırı büyük kare atılıyor:
        `kareler.ekle` diskte aynı korumayı yapıyor, bellekte de gerekiyor."""
        try:
            ham = base64.b64decode(b64 or "", validate=True)
        except Exception:
            return
        if not ham or len(ham) > kareler.AZAMI_BAYT:
            return
        self.canli_kareler[kareler.ad_temizle(kamera)] = {"kare": ham, "ts": ts}

    def canli_kare_al(self, kamera: str = kareler.VARSAYILAN_KAMERA) -> bytes:
        return (self.canli_kareler.get(kareler.ad_temizle(kamera)) or {}).get("kare", b"")

    def canli_kare_taze(self, kamera: str = kareler.VARSAYILAN_KAMERA,
                        azami_yas: float = 5.0) -> bytes:
        """Canlı kare — ama YALNIZ tazeyse.

        DONMUŞ KARE, OLMAYAN KAREDEN KÖTÜ. Canlı akış durduğunda bellekteki
        son kare orada kalıyor; onu okuyan kalibrasyon "kamera çalışıyor"
        sanıp aynı görüntüyü tekrar tekrar ölçüyor. Sahada tam bu oldu:
        panelin kamera sekmesinden çıkılınca akış durdu, terminal 25 kez
        aynı kareyi aldı ve sonuç — düşük hatasına rağmen — çöp çıktı.
        Eski kareyi boş saymak, çağıranın sebebi söylemesini sağlıyor.
        """
        k = self.canli_kareler.get(kareler.ad_temizle(kamera)) or {}
        if not k.get("kare"):
            return b""
        return k["kare"] if (time.time() - float(k.get("ts") or 0)) <= azami_yas else b""

    def sonuc_isle(self, mesaj: dict[str, Any]) -> None:
        beklenen = self._bekleyen.get(str(mesaj.get("id")))
        if beklenen is not None and not beklenen.done():
            beklenen.set_result({
                "ok": bool(mesaj.get("ok")),
                "mesaj": mesaj.get("mesaj", ""),
                "veri": mesaj.get("veri"),
                # Ajan bazı komutları "sessiz" işaretliyor (jog yenilemesi,
                # önizleme sorgusu). Bayrağı panele geçirmezsek panel her
                # önizleme sorgusunu olay günlüğüne yazar.
                "sessiz": bool(mesaj.get("sessiz")),
            })


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
    gorevler = [asyncio.create_task(_budama_dongusu()),
                asyncio.create_task(_kuyruk_dongusu()),
                asyncio.create_task(_arsiv_dongusu())]
    logger.info("Sunucu hazır. Panel parolası: %s", "var" if PANEL_PAROLA else "yok (açık)")
    yield
    for g in gorevler:
        g.cancel()


app = FastAPI(title="Farmbot", lifespan=yasam)

# Sikistirma. Panel dosyalari bilerek onbellege alinmiyor (bkz.
# TazeStatik), yani her acilista yeniden iniyorlar. Metin dosyalari
# %70 civari sikisiyor: 1,15 MB toplam yuk ~320 KB'a duser. Seviye 6,
# 9 ile neredeyse ayni orani cok daha az islemciyle veriyor — Pi'de
# bu fark onemli.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

# Baska bir arayuzun (ornegin ayri bir gelistirme sunucusunda calisan
# farmbot-web) tarayicidan bu API'yi cagirabilmesi icin kokeni tek tek
# saymak gerekiyor. Bos birakilirsa CORS hic acilmaz: robotu hareket
# ettiren bir API'de varsayilanin "herkese acik" olmasi dogru degil.
# Ornek: IZINLI_KOKENLER="http://localhost:5173"
IZINLI_KOKENLER = [k.strip() for k in os.environ.get("IZINLI_KOKENLER", "").split(",") if k.strip()]
if IZINLI_KOKENLER:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=IZINLI_KOKENLER,
        allow_methods=["GET", "POST", "DELETE"],
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
                # Onaylı ekim parçalarının bittiğini buradan öğreniyoruz:
                # ayrı bir yoklama döngüsü açmıyoruz, ajanın zaten
                # gönderdiği pakete bakıyoruz.
                await _ekim_dizi_izle()

            elif tip == "sonuc":
                merkez.sonuc_isle(mesaj)

            elif tip == "kare":
                # Kareyi WebSocket'ten bütün panellere yollamıyoruz: 40 KB'lık
                # base64 her panele ayrı ayrı gitmek zorunda kalırdı. Sunucu
                # saklıyor, panele yalnızca "yeni kare var" haberi gidiyor ve
                # tarayıcı <img> ile çekiyor.
                #
                # KARE KİMİN: ajan her karede kamera adını yazıyor. Adsız
                # gelen kare (eski ajan) uç kamerasının sayılıyor.
                ts = float(mesaj.get("ts", time.time()))
                kam = kareler.ad_temizle(mesaj.get("kamera"))
                await asyncio.to_thread(kareler.ekle, mesaj.get("veri", ""), ts,
                                        mesaj.get("konum"), kam)
                await merkez.yayinla({"tip": "kare", "ts": ts, "kamera": kam})

            elif tip == "canli":
                # Canlı akış karesi. Diske YAZILMIYOR: saniyede beş kare SD
                # kartı boşuna yorar ve 12'lik halka bir dakikada dolup
                # anlamını yitirir. Bellekte yalnızca EN SON kare duruyor.
                #
                # Panele base64'ü yaymıyoruz — periyodik karede olduğu gibi
                # yalnızca "yeni kare var" haberi gidiyor, tarayıcı <img> ile
                # çekiyor. Beş panel açıksa 40 KB'ı beş kez yollamak yerine
                # her biri kendi isteğini yapıyor.
                ts = float(mesaj.get("ts", time.time()))
                kam = kareler.ad_temizle(mesaj.get("kamera"))
                merkez.canli_kare_yaz(mesaj.get("veri", ""), ts, kam)
                await merkez.yayinla({"tip": "canli", "ts": ts, "kamera": kam})

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
        # AJAN KOPTU, ONAY BEKLEYEN EKİM VARSA ÖLDÜ. Onay kutusunu ekranda
        # bırakmak, basıldığında hiçbir şey olmayan bir düğme bırakmak
        # olurdu. Pompayı kapatmayı deniyoruz ama komut gidecek yer yok:
        # `_ekim_pompa_kapat` bunu söylüyor ve kullanıcıdan elle kapatmasını
        # istiyor — vakum pompası bizden bağımsız açık kalmış olabilir.
        if _ekim.aktif:
            _ekim.durum = "hata"
            _ekim.hata = ("Ajan bağlantısı koptu — onaylı ekim yarıda kaldı.")
            _ekim.aktif = False
            await _ekim_pompa_kapat("ajan koptu")
            await _ekim_gunluk(_ekim.hata, "hata")
            await _ekim_yayinla()
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


# --------------------------------------------------------------------------- #
# Kayıtlı noktalar
#
# Bu uçlar ajana hiç gitmiyor: nokta deposu sunucuda duruyor ve "Git"
# düğmesi mevcut `git` komutunu çağırıyor. Yeni bir hareket yolu açmamak
# bilinçli — güvenlik denetimleri (sınırlar, Z kilidi) tek yerde kalsın.
# --------------------------------------------------------------------------- #
@app.get("/api/noktalar")
async def api_noktalar(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return {"noktalar": await asyncio.to_thread(noktalar.hepsi)}


#: Türsüz noktanın "bir bitkinin altında" sayılması için en çok bu kadar
#: uzakta olması gerekiyor (mm). 25 mm, ekim sırasında oluşan küçük
#: kaymaları kapsayacak kadar geniş, komşu bitkiye atlamayacak kadar dar
#: (en sık ızgara adımı 100 mm'nin çok altı).
TURSUZ_YARICAP_MM = 25.0


@app.get("/api/noktalar/tursuz")
async def api_noktalar_tursuz(jeton: str = Query(default=""),
                              yaricap: float = Query(default=TURSUZ_YARICAP_MM)):
    """Türü yazılı OLMAYAN noktalar — ve kaçı bir bitkinin altında.

    NEDEN VARLAR: bitkiler ve çıplak noktalar aynı depoda duruyor, ayıran
    tek şey `tur` alanı. Izgara üreteci türü ancak sonradan yazmaya başladı;
    ondan önce üretilmiş ızgaralar türsüz kaldı ve sonra aynı koordinatlara
    bitki eklendiğinde, her bitkinin ALTINDA türsüz bir nokta oluştu.
    Ekranda üst üsteler, kutu seçimi ikisini birden alıyor.

    Bu uç NOKTA SİLMİYOR — hangi noktaların böyle olduğunu söylüyor.
    Silme, geri alınabilir olan `/api/toplu` "sil" yolundan geçiyor:
    30 saniye içinde geri alınabilsin.
    """
    _parola_dogrula(jeton)
    hepsi = await asyncio.to_thread(noktalar.hepsi)
    r = max(1.0, min(500.0, float(yaricap or TURSUZ_YARICAP_MM)))
    bitkiler = [n for n in hepsi if n.get("tur")]
    tursuz = [n for n in hepsi if not n.get("tur")]

    cikti = []
    for n in tursuz:
        yakin = None
        en_iyi = r + 1.0
        for b in bitkiler:
            try:
                d = math.hypot(float(n["x"]) - float(b["x"]),
                               float(n["y"]) - float(b["y"]))
            except (TypeError, ValueError):
                continue
            if d < en_iyi:
                en_iyi, yakin = d, b
        cikti.append({
            "ad": n.get("ad"), "x": n.get("x"), "y": n.get("y"),
            "etiket": n.get("etiket") or "",
            # Altında durduğu bitki — varsa. Bu bilgi silmeyi güvenli
            # yapan şey: "bir bitkinin altında duran türsüz nokta" ile
            # "tek başına duran referans noktası" aynı şey değil.
            "bitki": (yakin or {}).get("ad") if yakin else None,
            "uzaklik_mm": round(en_iyi, 1) if yakin else None,
        })
    cikti.sort(key=lambda k: (k["bitki"] is None, str(k["ad"])))
    return {
        "yaricap_mm": r,
        "toplam": len(cikti),
        "ustuste": [k["ad"] for k in cikti if k["bitki"]],
        "yalniz": [k["ad"] for k in cikti if not k["bitki"]],
        "noktalar": cikti[:AZAMI_SECIM],
        "bitki_sayisi": len(bitkiler),
    }


@app.post("/api/noktalar")
async def api_nokta_ekle(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    try:
        for eksen in ("x", "y", "z"):
            if govde.get(eksen) is None:
                raise HTTPException(status_code=400, detail=f"{eksen} değeri eksik")
        # DİKİM ALANI. Yalnız BİTKİ için: uç yuvası, kalibrasyon noktası,
        # gezinti noktası toprağın dışında olabilir ve olmalı da. Alan
        # tanımlı değilse hiçbir şey reddedilmiyor — eski davranış.
        #
        # Denetim KONUMA karar veren yazmalarda: yeni nokta, ya da mevcut
        # bir noktanın taşınması. Konumu değişmeyen bir güncelleme
        # (tür değiştirme, eğri bağlama, bozuk Z'yi düzeltme) geçiyor —
        # yoksa alan tanımlanmadan önce eklenmiş, şimdi alan dışında
        # kalan bir bitki DÜZELTİLEMEZ hâle gelirdi. Kuralın amacı yanlış
        # yere ekmeyi durdurmak, var olan kaydı rehin almak değil.
        if str(govde.get("etiket", "")) == "bitki":
            yeni_x, yeni_y = float(govde["x"]), float(govde["y"])
            eski = await asyncio.to_thread(noktalar.bul, str(govde.get("ad", "")))
            tasindi = (eski is None
                       or abs(float(eski.get("x", 0)) - yeni_x) > 0.05
                       or abs(float(eski.get("y", 0)) - yeni_y) > 0.05)
            if tasindi:
                kabul, gerekce, _ = await asyncio.to_thread(
                    dikim.nokta_kabul, yeni_x, yeni_y)
                if not kabul:
                    raise HTTPException(status_code=422, detail=gerekce)
        nokta = await asyncio.to_thread(
            noktalar.ekle, govde.get("ad", ""),
            float(govde["x"]), float(govde["y"]), float(govde["z"]),
            bool(govde.get("ustune_yaz")), str(govde.get("etiket", "")), govde)
    except noktalar.NoktaHatasi as hata:
        # 409: "isteğin kendisi geçerli ama mevcut durumla çakışıyor" —
        # panel bunu görüp "üzerine yazılsın mı?" diye sorabiliyor.
        kod = 409 if "zaten var" in str(hata) else 400
        raise HTTPException(status_code=kod, detail=str(hata))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="x, y, z sayı olmalı")
    return {"ok": True, "nokta": nokta}


@app.delete("/api/noktalar")
async def api_nokta_sil(ad: str = Query(...), jeton: str = Query(default="")):
    # Adres yolunda değil sorgu parametresinde: nokta adları Türkçe karakter
    # ve boşluk içerebiliyor, yol kodlaması gereksiz bir hata kaynağı.
    _parola_dogrula(jeton)
    silinen = await asyncio.to_thread(noktalar.sil_coklu, [ad])
    if not silinen:
        raise HTTPException(status_code=404, detail=f"'{ad}' adında nokta yok")
    # Tek nokta da geri alınabilir: yanlış bitkiye tıklamak, yanlış kutuyu
    # sürüklemek kadar kolay.
    parti = geri_al.ekle(silinen, f"'{ad}' silindi")
    return {"ok": True, "geri_al": parti}


# --------------------------------------------------------------------------- #
# Geri alma — silinen noktalar 30 saniye geri alınabilir kalıyor
#
# Silme HEMEN uygulanıyor (yarı silinmiş bir nokta diziye ve sınır denetimine
# "var" görünürdü); kayıtlar `geri_al.py` içinde bekliyor.
# --------------------------------------------------------------------------- #
@app.get("/api/geri-al")
async def api_geri_al_liste(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return {"bekleyen": geri_al.bekleyenler(), "pencere": geri_al.PENCERE_SN}


@app.post("/api/geri-al")
async def api_geri_al(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    kayitlar = geri_al.al(str(govde.get("kimlik", "")))
    if kayitlar is None:
        raise HTTPException(
            status_code=410,
            detail=f"Geri alma süresi doldu ({geri_al.PENCERE_SN:.0f} sn) — "
                   "noktalar kalıcı olarak silindi")
    konan = await asyncio.to_thread(noktalar.geri_koy, kayitlar)
    atlanan = len(kayitlar) - len(konan)
    mesaj = f"{len(konan)} nokta geri kondu"
    if atlanan:
        mesaj += f" · {atlanan} tanesi atlandı (aynı adla yeni nokta var)"
    return {"ok": True, "konan": konan, "atlanan": atlanan, "mesaj": mesaj}


# --------------------------------------------------------------------------- #
# Toplu işlem — haritada seçilen noktalara tek seferde
#
# Panel "şu noktalara şunu yap" diyor; adım listesini BURADA kuruyoruz ve
# ajanın olağan dizi yoluna veriyoruz. Panel tek tek hareket komutu
# göndermiyor: sıralama, yasak bölge denetimi, Z kilidi ve acil durdurma
# mandalı ajanın elinde kalıyor.
#
# Seçim en fazla 40 nokta: yatağımız 535 x 630 mm, sığan fide sayısı bu
# mertebede. Üstü hem adım sınırını (200) zorlar hem de yanlışlıkla
# yapılmış bir seçimi tehlikeli hâle getirir.
# --------------------------------------------------------------------------- #
AZAMI_SECIM = 40


@app.post("/api/toplu")
async def api_toplu(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    islem = str(govde.get("islem", ""))
    adlar = [str(a) for a in (govde.get("noktalar") or []) if str(a).strip()]
    if not adlar:
        raise HTTPException(status_code=400, detail="Seçim boş")
    if len(adlar) > AZAMI_SECIM:
        raise HTTPException(
            status_code=400,
            detail=f"Tek seferde en fazla {AZAMI_SECIM} nokta işlenebilir "
                   f"(seçili: {len(adlar)})")

    if islem == "sil":
        silinen = await asyncio.to_thread(noktalar.sil_coklu, adlar)
        if not silinen:
            raise HTTPException(status_code=404, detail="Seçilen noktaların hiçbiri bulunamadı")
        parti = geri_al.ekle(silinen, f"{len(silinen)} nokta silindi")
        return {"ok": True, "silinen": [n.get("ad") for n in silinen],
                "geri_al": parti,
                "mesaj": f"{len(silinen)} nokta silindi"}

    if islem == "dizi":
        # KAYITLI DİZİYİ SEÇİMİN HER NOKTASINA UYGULA.
        #
        # "Şu noktayı sula" yerine "verilen noktayı sula": dizi bir nokta
        # değişkeni tanımlıyor, biz onu seçili her nokta için bir kez
        # dolduruyoruz ve çıkan adımları arka arkaya ekliyoruz. Tek bir
        # "sula" dizisi 40 fideye böyle uygulanıyor.
        prog_ad = str(govde.get("dizi", ""))
        program = await asyncio.to_thread(programlar.bul, prog_ad)
        if program is None:
            raise HTTPException(status_code=404, detail=f"'{prog_ad}' adında dizi yok")

        nokta_degiskenleri = [d for d in program.get("degiskenler", [])
                              if d.get("tip") == "nokta"]
        if len(nokta_degiskenleri) != 1:
            raise HTTPException(
                status_code=400,
                detail=f"'{prog_ad}' dizisinde tam olarak bir nokta değişkeni olmalı "
                       f"(şu an {len(nokta_degiskenleri)}). Diziye "
                       "\"nokta\" tipinde bir değişken ekleyin.")
        hedef = nokta_degiskenleri[0]["ad"]

        # Nokta dışındaki değişkenlerin değeri istekte gelmeli.
        digerleri = {d["ad"]: govde.get("degerler", {}).get(d["ad"])
                     for d in program.get("degiskenler", []) if d["ad"] != hedef}

        adimlar = []
        try:
            for nokta_ad in adlar:
                adimlar.extend(await asyncio.to_thread(
                    programlar.coz, program, {**digerleri, hedef: nokta_ad}))
        except programlar.ProgramHatasi as hata:
            raise HTTPException(status_code=400, detail=str(hata))

        if len(adimlar) > programlar.AZAMI_ADIM:
            raise HTTPException(
                status_code=400,
                detail=f"{len(adlar)} nokta × {len(adimlar) // max(1, len(adlar))} adım = "
                       f"{len(adimlar)} adım, sınır {programlar.AZAMI_ADIM}. "
                       "Daha az nokta seçin ya da diziyi kısaltın.")

        return await merkez.komut_gonder("dizi_baslat", {
            "ad": f"{prog_ad} × {len(adlar)} nokta", "adimlar": adimlar,
            "tekrar": 1, "hiz": govde.get("hiz"),
        })

    if islem == "ek":
        cozum = await asyncio.to_thread(_ekim_coz, adlar)
        if cozum["ret"]:
            # Sulamadaki kararla aynı: bir hedef bile kabul edilmiyorsa
            # dizi HİÇ başlamıyor. Kısmi ekim, hangi gözden hangi tohumun
            # nereye gittiğini bilinmez yapardı ve toprağa giren tohum
            # geri alınamaz.
            raise HTTPException(
                status_code=422,
                detail="Ekim başlatılmadı — " + " · ".join(cozum["ret"]))
        # ÖN KONTROL BÜTÜN PLANA. Parçalara bölünmüş olsa da ajana bütün
        # koordinatları soruyoruz: 7 tohumluk bir ekimin 5.sinde yasak
        # bölgeye çarpıp durması, hiç başlamamasından kötü.
        await _adim_on_kontrol(cozum["adimlar"], "Ekim")
        # TEK YOL. Onay kapalıyken de aynı döngü işliyor, yalnız onay
        # noktalarında durmuyor. İkinci bir "hepsi tek dizide" yolu
        # tutmuyoruz: home komutu ve uç takma zaten diziye sığmıyor ve
        # iki ayrı yol, birinde düzeltilen hatanın diğerinde kalması
        # demek olurdu.
        return await _ekim_baslat(cozum)

    if islem == "nem":
        return await _nem_olc_baslat(adlar)

    if islem not in ("sula", "gez"):
        raise HTTPException(status_code=400, detail=f"Bilinmeyen toplu işlem: {islem!r}")

    # Sulama süresi: makul bir aralıkta tutuluyor, panelden gelen sayıya
    # körlemesine güvenilmiyor.
    saniye = _istek_saniye(govde)

    if islem == "sula":
        cozum = await asyncio.to_thread(_sulama_coz, adlar, saniye)
        if cozum["ret"]:
            # Tek bir nokta bile kabul edilmiyorsa dizi HİÇ başlamıyor.
            # Kısmi sulama, hangi bitkinin sulandığını bilinmez yapardı.
            raise HTTPException(
                status_code=422,
                detail="Sulama başlatılmadı — " + " · ".join(cozum["ret"]))
        # YASAK BÖLGE + YUMUŞAK SINIR ÖN KONTROLÜ. Kararı ajan veriyor;
        # sunucu kuralları kopyalamıyor, yalnız soruyor. Amaç 40 bitkilik
        # bir dizinin ortasında çarpıp durmasını önlemek — yarı sulanmış
        # bir yatak, hiç sulanmamış bir yataktan daha kötü.
        await _sulama_on_kontrol(cozum)
        adimlar = cozum["adimlar"]
        # MAKİNE GERÇEKTE NEREYE GİDİYOR — günlüğe yazılıyor.
        #
        # Sahada su bitkinin yanına düştü ve sebebi tahminle arandı. Oysa
        # bilinmesi gereken tek şey makinenin gittiği koordinattı: hedef
        # neresi, başlık kayması ne, makine nereye gidiyor. Üçü yan yana
        # yazılınca hangi hatanın olduğu bakınca anlaşılıyor.
        await _sulama_gunluk(cozum)
        # SULAMA DAMGASI. Panelde gözün "sulandı" rengi buradan geliyor.
        # DÜRÜST OLMAK GEREKİRSE bu "su düştü" demek değil, "sulama
        # komutu gitti" demek: akış sensörü yok ve dizi ortada kesilirse
        # sonraki bitkiler yine damgalı kalır. Panel bunu bu şekilde
        # yazıyor, "sulandı" kelimesinin altına gerekçesiyle.
        sulanacak = [o["ad"] for o in cozum["ozet"] if o.get("sulanacak", True)]
        if sulanacak:
            simdi = time.time()
            await asyncio.to_thread(
                noktalar.alanlari_yaz,
                {ad: {"sulama_ts": simdi} for ad in sulanacak})
            await merkez.yayinla({"tip": "tepsi"})
    else:
        adimlar = [{"tip": "nokta", "ad": ad} for ad in adlar]

    gecici = {"ad": "Seçim: " + ("sulama" if islem == "sula" else "gezinti"),
              "adimlar": adimlar, "tekrar": 1}
    try:
        # Nokta adları koordinata burada çevriliyor — kayıtlı programlarla
        # aynı yol. Bir nokta bulunamazsa dizi HİÇ başlamıyor.
        cozulmus = await asyncio.to_thread(programlar.coz, gecici)
    except programlar.ProgramHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))

    return await merkez.komut_gonder("dizi_baslat", {
        "ad": gecici["ad"], "adimlar": cozulmus, "tekrar": 1,
        "hiz": govde.get("hiz"),
    })


# --------------------------------------------------------------------------- #
# Nem ölçümü — bitki başına, PROBUN KENDİSİYLE
#
# Şimdiye kadar toprak nemi tek bir yerden okunuyordu: prob makinenin
# gittiği yerde ne görüyorsa o. Bahçe ekranı "4 bitki susadı" derken
# aslında hepsi için AYNI okumaya bakıyordu ve okuma bitkiden 90 mm
# ötede olabiliyordu. Nem probu artık kalıcı olarak makinenin üstünde;
# her bitkinin kendi üstüne gidip ölçebiliyoruz.
#
# ÖLÇÜM BİTKİYE YAZILIYOR. Okunan değer noktanın kaydına düşüyor
# (`nem_yuzde`, `nem_ts`) ve bahçe kartları onu kullanıyor — artık
# "en yakın okuma" değil, O BİTKİNİN ölçümü.
# --------------------------------------------------------------------------- #
async def _nem_olc_baslat(adlar: list[str]) -> dict[str, Any]:
    """Seçili bitkilerin üstüne gidip nem probunu daldırır ve okur."""
    durum = merkez.durum()
    if not durum.get("bagli"):
        raise HTTPException(status_code=409, detail="Robot bağlı değil")
    b = baslar.bas(merkez.son_durum or {}, "nem")
    sinirlar = durum.get("sinirlar") or {}
    alanlar = await asyncio.to_thread(dikim.listele)
    kayitli = {n.get("ad"): n for n in await asyncio.to_thread(noktalar.hepsi)}
    guvenli_z = _sayi_guvenli(durum.get("guvenli_z"), 340.0)

    adimlar: list[dict[str, Any]] = []
    hedefler: list[dict[str, Any]] = []
    ret: list[str] = []
    for ad in adlar:
        n = kayitli.get(ad)
        if n is None:
            ret.append(f"{ad}: nokta bulunamadı")
            continue
        ix, iy = _sayi_guvenli(n.get("x")), _sayi_guvenli(n.get("y"))
        # ULAŞILABİLİR Mİ — probun kaymasıyla birlikte. Yarıda çarpıp
        # durmaktansa hiç başlamamak doğru.
        olur, sebep = baslar.ulasilir_mi(ix, iy, b, sinirlar)
        if not olur:
            ret.append(f"{ad}: {sebep}")
            continue
        mx, my = baslar.kaydir(ix, iy, b)
        yuzey = dikim.toprak_yuzeyi(
            ix, iy, _sayi_guvenli(durum.get("toprak_z")), alanlar)
        olc_z = baslar.inis_z(b, yuzey)
        if olc_z >= guvenli_z:
            ret.append(f"{ad}: ölçüm Z{olc_z:.0f} güvenli Z{guvenli_z:.0f} "
                       f"altında değil — prob toprağa dalmaz")
            continue
        adimlar += [
            {"tip": "nokta", "ad": f"{ad}↑", "x": mx, "y": my, "z": guvenli_z},
            {"tip": "nokta", "ad": ad, "x": mx, "y": my, "z": olc_z},
            # Prob toprakta: okumanın oturması için kısa bir bekleme.
            # Ölçüm anını AJANIN durum paketinden alıyoruz; ayrı bir
            # "oku" adımı yok, çünkü prob sürekli okuyor.
            {"tip": "bekle", "saniye": NEM_BEKLEME_SN},
            {"tip": "nokta", "ad": f"{ad}↑", "x": mx, "y": my, "z": guvenli_z},
        ]
        hedefler.append({"ad": ad, "x": ix, "y": iy, "mx": mx, "my": my,
                         "z": olc_z})
    if ret:
        raise HTTPException(status_code=422,
                            detail="Nem ölçümü başlatılmadı — " + " · ".join(ret))
    if not adimlar:
        raise HTTPException(status_code=400, detail="Ölçülecek bitki yok")

    await _adim_on_kontrol(adimlar, "Nem ölçümü")
    await merkez.yayinla({
        "tip": "gunluk", "seviye": "bilgi",
        "metin": (f"Nem ölçümü: {len(hedefler)} bitki · prob kayması "
                  f"{_sayi_guvenli(b.get('dx')):+.0f}/"
                  f"{_sayi_guvenli(b.get('dy')):+.0f} mm · derinlik "
                  f"{_sayi_guvenli(b.get('derinlik_mm')):.0f} mm")})
    sonuc = await merkez.komut_gonder("dizi_baslat", {
        "ad": f"Nem ölçümü · {len(hedefler)} bitki",
        "adimlar": adimlar, "tekrar": 1})
    # ÖLÇÜMÜ TOPLAYAN GÖREV. Dizi sürerken makine her bitkinin üstünde
    # duruyor; o anlarda probun okuduğunu bitkiye yazıyoruz.
    #
    # GÖREVE GÜÇLÜ REFERANS TUTULUYOR. `asyncio.create_task`in dönüşünü
    # bir yerde tutmazsanız görev çöp toplayıcıya yem oluyor ve İŞİN
    # ORTASINDA sessizce kayboluyor. Tam bu oldu: prob toprağa iniyordu,
    # okuma geliyordu, ama görev inişin ortasında yok olduğu için hiçbir
    # şey kaydedilmiyordu — hata da yoktu, çünkü hata değildi.
    gorev = asyncio.create_task(_nem_topla(hedefler))
    _NEM_GOREVLERI.add(gorev)
    gorev.add_done_callback(_NEM_GOREVLERI.discard)
    return sonuc


#: Süren nem ölçümü görevleri — referans tutulmazsa görev kayboluyor.
_NEM_GOREVLERI: set[Any] = set()

#: Prob toprağa daldıktan sonra beklenen süre.
#:
#: SENSÖRÜN ÖLÇÜM ARALIĞINDAN UZUN OLMAK ZORUNDA. Arduino ölçümü kendi
#: temposuyla gönderiyor (bu kurulumda ~2 sn); prob daha kısa süre
#: toprakta kalırsa aşağıdayken tek bir okuma bile gelmiyor ve kaydedilecek
#: bir sayı olmuyor — ölçüm sessizce boşa gidiyor. Ölçtük: 2 sn ile hiçbir
#: okuma yakalanmadı, 4 sn ile her seferinde yakalandı.
NEM_BEKLEME_SN = 4.0

#: Ölçümün bitkiye ait sayılması için makinenin ona ne kadar yaklaşması
#: gerektiği. Kayma uygulandığı için makine tam üstünde değil, ama
#: prob orada.
NEM_YAKINLIK_MM = 25.0


async def _nem_topla(hedefler: list[dict[str, Any]]) -> None:
    """Dizi sürerken her bitkinin üstündeki okumayı o bitkiye yazar.

    Ayrı bir "oku" adımı yok: prob sürekli okuyor ve ajan her durum
    paketinde konumla birlikte gönderiyor. Bizim işimiz doğru ANI
    yakalamak — makine o bitkinin üstünde ve aşağıda.
    """
    kalan = {h["ad"]: h for h in hedefler}
    bitis = time.time() + 900.0
    yazilan: dict[str, dict[str, Any]] = {}
    try:
        while kalan and time.time() < bitis:
            await asyncio.sleep(0.25)
            d = merkez.son_durum or {}
            # OKUMA `son_olcum`DAN, KONUM O OKUMANIN KENDİSİNDEN. Ajan her
            # ölçüme o anki eksen konumunu ekliyor (`_konum_ekle`); durum
            # paketinin konumunu kullanmak, iki ayrı andan bir çift
            # uydurmak olurdu — makine ölçümden sonra kalkmış olabilir.
            olcum = merkez.son_olcum or {}
            ham = olcum.get("toprak_nem")
            if ham in (None, ""):
                continue
            kx = _sayi_guvenli(olcum.get("konum_x"), 1e9)
            ky = _sayi_guvenli(olcum.get("konum_y"), 1e9)
            kz = _sayi_guvenli(olcum.get("konum_z"),
                               _sayi_guvenli((d.get("konum") or {}).get("z")))
            for ad, h in list(kalan.items()):
                # MAKİNE O BİTKİNİN ÖLÇÜM NOKTASINDA MI. Yakınlık hem
                # X/Y hem Z: prob toprakta değilken alınan okuma havanın
                # okuması olur ve onu bitkiye yazmak yalan söylemektir.
                if (abs(kx - h["mx"]) > NEM_YAKINLIK_MM
                        or abs(ky - h["my"]) > NEM_YAKINLIK_MM
                        # Z TOLERANSI DAR VE DAR KALMALI: prob toprakta
                        # değilken alınan okuma havanın okumasıdır ve onu
                        # bitkiye yazmak yalan söylemektir.
                        or abs(kz - h["z"]) > 6.0):
                    continue
                yuzde = sulama.nem_yuzde(ham, d.get("toprak_kalib") or {})
                if yuzde is None:
                    continue
                yazilan[ad] = {"nem_yuzde": round(float(yuzde), 1),
                               "nem_ham": _sayi_guvenli(ham),
                               "nem_ts": time.time()}
                kalan.pop(ad, None)
            if not (d.get("dizi") or {}).get("calisiyor") and yazilan:
                break
        if yazilan:
            await asyncio.to_thread(noktalar.alanlari_yaz, yazilan)
            await merkez.yayinla({"tip": "tepsi"})
            await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu(),
                                  "tazele": True})
            ozet = " · ".join(f"{a} %{v['nem_yuzde']:.0f}"
                              for a, v in list(yazilan.items())[:6])
            await merkez.yayinla({
                "tip": "gunluk", "seviye": "bilgi",
                "metin": f"Nem ölçüldü ({len(yazilan)}): {ozet}"})
        if kalan:
            await merkez.yayinla({
                "tip": "gunluk", "seviye": "uyari",
                "metin": ("Nem okunamadı: " + ", ".join(sorted(kalan))
                          + " — prob o noktada okuma vermedi.")})
    except Exception:
        logger.exception("Nem ölçümü toplanamadı")


# --------------------------------------------------------------------------- #
# Sulama ofseti
#
# Suyun bitkinin NERESİNE bırakılacağı `sulama.py`de çözülüyor; burada
# yalnız veriyi toplayıp adım listesine çeviriyoruz.
#
# Koordinatlar BURADA donuyor ve diziye mutlak olarak yazılıyor. Ajan
# hiçbir şey türetmiyor: panelin önizlemede gösterdiği nokta ile robotun
# gittiği nokta böylece aynı sayı oluyor. Ofset yaşa göre değiştiği için
# bu şart — ajan kendi hesaplasaydı önizleme ile gerçek ayrışırdı.
# --------------------------------------------------------------------------- #


def _istek_saniye(govde: dict[str, Any] | None) -> float | None:
    """İstekteki sulama süresi; verilmemişse None (tür ayarı geçerli).

    BOŞ İLE SIFIR AYRI. Alan hiç gelmediyse "sen karar ver" demek ve her
    bitki kendi ayarından çözülüyor; bir sayı geldiyse o seferlik hepsini
    eziyor (tek atımlık deneme için).
    """
    ham = (govde or {}).get("saniye")
    if ham in (None, ""):
        return None
    try:
        return max(0.5, min(60.0, float(ham)))
    except (TypeError, ValueError):
        return None


def _sulama_coz(adlar: list[str], saniye: float | None) -> dict[str, Any]:
    """Seçili bitkiler için sulama noktalarını ve adım listesini üretir.

    Eşzamanlı çağrılmıyor; `asyncio.to_thread` ile tek seferde koşuyor,
    çünkü dört ayrı depoyu (nokta, tür, eğri, dikim) okuyor.
    """
    kayitli = {n.get("ad"): n for n in noktalar.hepsi()}
    tur_indeks = {t.get("slug"): t for t in turler.hepsi()}
    egri_listesi = egriler.hepsi()
    alanlar = dikim.listele()
    durum = merkez.son_durum or {}
    # Güvenli Z ve toprak yüzeyi ajandan geliyor. Ajan kopukken ayarların
    # varsayılanına düşüyoruz — sulama zaten ajansız başlamıyor, ama
    # ÖNİZLEME ajan kapalıyken de anlamlı bir sayı göstermeli.
    guvenli_z = float(durum.get("guvenli_z") or 340.0)
    toprak_z = float(durum.get("toprak_z") or 0.0)
    baslik = ((durum.get("uc") or {}).get("sulama_basligi")) or {}
    kalib = durum.get("toprak_kalib") or {}
    # Konumlu TOPRAK nemi okumaları — sulama kararı bunlara bakıyor.
    # Hava nemi (DHT) buraya hiç girmiyor: yağmurlu bir günde hava nemi
    # yüksek olur ve karışırsa susuz toprakta sulama atlanır.
    okumalar = depo.konumlu_okumalar(
        int(sulama.NEM_AZAMI_YAS_SN / 60), 400)
    simdi = time.time()

    adimlar: list[dict[str, Any]] = []
    ozet: list[dict[str, Any]] = []
    ret: list[str] = []
    uyari: list[str] = []
    for ad in adlar:
        bitki = kayitli.get(ad)
        if bitki is None:
            # Eksik nokta hatasını `programlar.coz` tek elden veriyor.
            adimlar.append({"tip": "nokta", "ad": ad})
            continue
        tur = tur_indeks.get(bitki.get("tur"))
        # SÜRE BİTKİ BAŞINA ÇÖZÜLÜYOR. Panel herkese aynı sabit 3 saniyeyi
        # gönderiyordu ve o sayı hiçbir yerden ayarlanamıyordu; oysa fide
        # ile olgun bir marul aynı suyu istemiyor. İstek açık bir süre
        # verdiyse o eziyor, vermediyse tür zinciri geçerli.
        bitki_sn = saniye
        if bitki_sn is None:
            bitki_sn = float(sulama.ayar_coz(bitki, tur).get(
                "sulama_saniye", turler.VARSAYILAN["sulama_saniye"]))
        c = sulama.noktalar(
            bitki, tur, toplam_saniye=bitki_sn, simdi=simdi, guvenli_z=guvenli_z,
            genel_toprak_z=toprak_z, egri_listesi=egri_listesi,
            dikim_alanlari=alanlar, baslik=baslik, okumalar=okumalar,
            toprak_kalib=kalib)
        ret.extend(f"{ad}: {m}" for m in c["ret"])
        uyari.extend(f"{ad}: {m}" for m in c["uyari"])
        ozet.append({"ad": ad, "desen": c["desen"], "ofset_mm": c["ofset_mm"],
                     "yuzey_z": c["yuzey_z"], "boy_mm": c.get("boy_mm"),
                     "egriden": c["egriden"], "noktalar": c["noktalar"],
                     "ret": c["ret"], "uyari": c["uyari"],
                     "sulanacak": c.get("sulanacak", True),
                     "nem_yuzde": c.get("nem_yuzde"),
                     "nem_esigi": c.get("nem_esigi"),
                     "nem_gerekce": c.get("nem_gerekce", ""),
                     "baslik": c.get("baslik")})
        for i, nk in enumerate(c["noktalar"], 1):
            adimlar.append({"tip": "nokta",
                            "ad": ad if len(c["noktalar"]) == 1 else f"{ad}#{i}",
                            "x": nk["x"], "y": nk["y"], "z": nk["z"]})
            adimlar.append({"tip": "role", "ad": "su_pompasi", "durum": True})
            adimlar.append({"tip": "bekle", "saniye": nk["saniye"]})
            adimlar.append({"tip": "role", "ad": "su_pompasi", "durum": False})

    if len(adimlar) > programlar.AZAMI_ADIM:
        ret.append(
            f"{len(adlar)} bitki x desen = {len(adimlar)} adım, sınır "
            f"{programlar.AZAMI_ADIM}. Daha az bitki seçin ya da çember "
            f"nokta sayısını düşürün.")
    return {"adimlar": adimlar, "ozet": ozet, "ret": ret, "uyari": uyari,
            "toplam_nokta": sum(len(o["noktalar"]) for o in ozet),
            "toplam_saniye": round(
                sum(nk["saniye"] for o in ozet for nk in o["noktalar"]), 1)}


async def _sulama_on_kontrol(cozum: dict[str, Any]) -> None:
    """Sulama adımları için ön kontrol — bkz. `_adim_on_kontrol`."""
    await _adim_on_kontrol(cozum["adimlar"], "Sulama")


async def _sulama_gunluk(cozum: dict[str, Any]) -> None:
    """Hedef, kayma ve makinenin GİDECEĞİ koordinat — yan yana.

    Bu satır olmadığı için sahada su bitkinin yanına düştü ve sebep
    tahminle arandı: "ofsetin işareti ters olabilir, +50 yerine -50
    deneyelim". Oysa üç sayı yan yana yazılınca hangi hata olduğu
    bakınca görünüyor — makine hedefe mi gidiyor, kaymayı uyguluyor mu,
    yoksa kaymayı hiç mi uygulamıyor.
    """
    bas = (cozum.get("ozet") or [{}])[0].get("baslik") or {}
    dx, dy = _sayi_ya_da(bas.get("dx")), _sayi_ya_da(bas.get("dy"))
    satir = []
    for o in (cozum.get("ozet") or [])[:4]:
        for nk in (o.get("noktalar") or [])[:1]:
            satir.append(
                f"{o.get('ad')}: hedef X{nk['su_x']:.0f} Y{nk['su_y']:.0f}"
                f" → makine X{nk['x']:.0f} Y{nk['y']:.0f}")
    if not satir:
        return
    kalan = len(cozum.get("ozet") or []) - 4
    await merkez.yayinla({
        "tip": "gunluk", "seviye": "bilgi",
        "metin": f"Sulama · başlık kayması X{dx:+.0f} Y{dy:+.0f} mm · "
                 + " · ".join(satir)
                 + (f" · … {kalan} bitki daha" if kalan > 0 else "")})


def _sayi_ya_da(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        return float(deger)
    except (TypeError, ValueError):
        return varsayilan


# --------------------------------------------------------------------------- #
# Sulama başlığı hizalama — ölçerek, tahminle değil
#
# Başlık ucun merkezinden kaymış ve kaymanın YÖNÜ ile BÜYÜKLÜĞÜ elle
# giriliyor. İşaretini yanlış vermek kolay ve sonucu ancak toprağa bakınca
# görünüyor; sahada tam bu oldu, "+50 yerine -50 deneyelim" noktasına
# gelindi.
#
# Tahmini bitiren şey ölçüm: makine BİLİNEN bir noktayı sulasın, kullanıcı
# suyun düştüğü yerin hedeften ne kadar saptığını ölçsün, doğru kaymayı
# sistem hesaplasın.
#
# Hesap tek satır ve işareti düşünmeyi gerektirmiyor:
#
#     makine  = hedef + kayma
#     su      = makine + başlığın gerçek konumu (h)
#     sapma   = su - hedef = kayma + h
#     istenen = su - hedef = 0  →  yeni kayma = kayma - sapma
#
# Yani kullanıcı "su hedefin 60 mm sağına, 30 mm ilerisine düştü" diyor,
# sistem o kadarını mevcut kaymadan düşüyor. İşaret hatası mümkün değil:
# ölçülen şey doğrudan düzeltilecek şey.
# --------------------------------------------------------------------------- #


def _baslik_oku() -> dict[str, float]:
    b = ((merkez.son_durum or {}).get("uc") or {}).get("sulama_basligi") or {}
    return {"dx": _sayi_ya_da(b.get("dx")), "dy": _sayi_ya_da(b.get("dy")),
            "z_min": _sayi_ya_da(b.get("z_min"))}


@app.post("/api/sulama/hizala/dene")
async def api_sulama_hizala_dene(govde: dict[str, Any],
                                 jeton: str = Query(default="")):
    """Bilinen bir noktayı kısa süre sular — ölçüm için.

    Bitki gerekmiyor: kullanıcı boş bir yer seçip suyun izini görebilsin.
    Nereye gidildiği günlüğe yazılıyor.
    """
    _parola_dogrula(jeton)
    try:
        hx, hy = float(govde.get("x")), float(govde.get("y"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Hedef X ve Y gerekiyor")
    saniye = max(0.5, min(20.0, _sayi_ya_da(govde.get("saniye"), 2.0)))
    bas = _baslik_oku()
    durum = merkez.son_durum or {}
    toprak_z = _sayi_ya_da(durum.get("toprak_z"))
    alanlar = await asyncio.to_thread(dikim.listele)
    yuzey = dikim.toprak_yuzeyi(hx, hy, toprak_z, alanlar)
    # Sulama Z'si normal sulamadaki kuralla aynı: yüzeyin üstünde,
    # başlığın Z tabanından aşağı inmeden.
    # Açıklık normal sulamadakiyle AYNI tabandan: 50 mm hedef, en az 20.
    # Ayrı bir sayı uydursaydık hizalama gerçek sulamadan farklı bir
    # yükseklikten su dökerdi ve ölçülen sapma yanlış olurdu — su
    # yükseklikten düşerken yayılıyor.
    z = max(yuzey + 50.0, bas["z_min"], yuzey + sulama.EN_AZ_ACIKLIK_MM)
    mx, my = round(hx + bas["dx"], 2), round(hy + bas["dy"], 2)

    adimlar = [
        {"tip": "nokta", "ad": "hizalama", "x": mx, "y": my, "z": round(z, 2)},
        {"tip": "role", "ad": "su_pompasi", "durum": True},
        {"tip": "bekle", "saniye": saniye},
        {"tip": "role", "ad": "su_pompasi", "durum": False},
    ]
    await _adim_on_kontrol(adimlar, "Hizalama")
    await merkez.yayinla({
        "tip": "gunluk", "seviye": "bilgi",
        "metin": f"Hizalama · hedef X{hx:.0f} Y{hy:.0f} · başlık kayması "
                 f"X{bas['dx']:+.0f} Y{bas['dy']:+.0f} → makine "
                 f"X{mx:.0f} Y{my:.0f} Z{z:.0f} · {saniye:.0f} sn su"})
    yanit = await merkez.komut_gonder("dizi_baslat", {
        "ad": "Başlık hizalama", "adimlar": adimlar, "tekrar": 1})
    return {"ok": True, "hedef": {"x": hx, "y": hy},
            "makine": {"x": mx, "y": my, "z": round(z, 2)},
            "baslik": bas, "mesaj": (yanit or {}).get("mesaj", "")}


@app.post("/api/sulama/hizala/uygula")
async def api_sulama_hizala_uygula(govde: dict[str, Any],
                                   jeton: str = Query(default="")):
    """Ölçülen sapmadan doğru kaymayı hesaplar ve ajana yazar.

    `sapma_x/sapma_y` = suyun düştüğü yer eksi hedef, makine eksenlerinde.
    Yeni kayma = mevcut kayma - sapma. İşaret hatası mümkün değil: ölçülen
    şey doğrudan düzeltilecek şey.
    """
    _parola_dogrula(jeton)
    try:
        sx, sy = float(govde.get("sapma_x")), float(govde.get("sapma_y"))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Sapma X ve Y gerekiyor (suyun düştüğü yer eksi hedef).")
    if abs(sx) > 500 or abs(sy) > 500:
        raise HTTPException(
            status_code=400,
            detail=f"Sapma çok büyük (X{sx:.0f} Y{sy:.0f} mm). Yatak "
                   "535×645 mm; ölçüyü kontrol edin.")
    eski = _baslik_oku()
    yeni = {"dx": round(eski["dx"] - sx, 1), "dy": round(eski["dy"] - sy, 1),
            "z_min": eski["z_min"]}
    # z_min'i de yolluyoruz: `uclar.kaydet` üst düzeyde birleştiriyor, yani
    # `sulama_basligi` sözlüğünün TAMAMI değişiyor ve eksik gönderilen bir
    # alan sessizce sıfırlanırdı.
    await merkez.komut_gonder("uc_kaydet", {"ayar": {"sulama_basligi": yeni}})
    await merkez.yayinla({
        "tip": "gunluk", "seviye": "bilgi",
        "metin": f"Başlık kayması ölçümle güncellendi: X{eski['dx']:+.0f} "
                 f"Y{eski['dy']:+.0f} → X{yeni['dx']:+.0f} Y{yeni['dy']:+.0f} mm "
                 f"(ölçülen sapma X{sx:+.0f} Y{sy:+.0f})"})
    return {"ok": True, "eski": eski, "yeni": yeni,
            "sapma": {"x": sx, "y": sy}}


async def _adim_on_kontrol(adimlar: list[dict[str, Any]], etiket: str) -> None:
    """Ajana "bu koordinatlar geçer mi" diye sorar; geçmiyorsa 422.

    Ajan bağlı değilse sessizce geçiyoruz: dizi zaten ajansız
    başlamıyor ve `komut_gonder` birazdan kendi hatasını verecek.
    Burada "bilinmiyor"u "engelli" saymak, ajan kopukken önizlemeyi de
    kilitlerdi.
    """
    hedefler = [{"x": a["x"], "y": a["y"], "z": a["z"]}
                for a in adimlar if a.get("tip") == "nokta"
                and a.get("x") is not None]
    if not hedefler:
        return
    try:
        yanit = await merkez.komut_gonder("nokta_denetle", {"noktalar": hedefler})
    except HTTPException:
        return          # ajan yok — asıl hatayı dizi başlatma verecek
    veri = (yanit or {}).get("veri") or {}
    engelli = [s for s in (veri.get("noktalar") or []) if s.get("engel")]
    if not engelli:
        return
    ayrinti = []
    for s in engelli[:6]:
        h = hedefler[s["sira"]] if s["sira"] < len(hedefler) else {}
        ayrinti.append(f"X{h.get('x')} Y{h.get('y')} Z{h.get('z')}: {s['engel']}")
    raise HTTPException(
        status_code=422,
        detail=(f"{etiket} başlatılmadı — {len(engelli)} nokta ajanın "
                f"denetiminden geçmedi: " + " · ".join(ayrinti)
                + ("" if len(engelli) <= 6 else f" · … ve {len(engelli) - 6} tane daha")))


@app.post("/api/sulama/onizle")
async def api_sulama_onizle(govde: dict[str, Any], jeton: str = Query(default="")):
    """Sulamayı BAŞLATMADAN nereye gidileceğini gösterir.

    Geri alınamaz bir işlemi körlemesine yapmak yerine önce sonucu
    göstermek, 40 bitkilik bir seçimde fark ediyor — ızgara önizlemesiyle
    aynı gerekçe. Panel haritada bu noktaları çiziyor.
    """
    _parola_dogrula(jeton)
    adlar = [str(a) for a in (govde.get("noktalar") or []) if str(a).strip()]
    if not adlar:
        raise HTTPException(status_code=400, detail="Seçim boş")
    if len(adlar) > AZAMI_SECIM:
        raise HTTPException(
            status_code=400,
            detail=f"Tek seferde en fazla {AZAMI_SECIM} nokta işlenebilir "
                   f"(seçili: {len(adlar)})")
    saniye = _istek_saniye(govde)
    cozum = await asyncio.to_thread(_sulama_coz, adlar, saniye)
    return {"ozet": cozum["ozet"], "ret": cozum["ret"], "uyari": cozum["uyari"],
            "adim": len(cozum["adimlar"]),
            "toplam_nokta": cozum["toplam_nokta"],
            "toplam_saniye": cozum["toplam_saniye"],
            "azami_adim": programlar.AZAMI_ADIM}


# --------------------------------------------------------------------------- #
# Ekim dizisi
#
# Sulamayla aynı kalıp: koordinatlar BURADA donuyor ve diziye mutlak
# olarak yazılıyor. Gözlerin nerede olduğu ve hangisinde tohum kaldığı
# AJANDA (`uclar.json`), çünkü orası hem kalıcı hem de dizinin gözü
# boşalttığı yer. Sunucu onu durum paketinden okuyor.
# --------------------------------------------------------------------------- #


def _toprak_t(durum: dict[str, Any]) -> float | None:
    """Toprak yüzeyine denk gelen T uzaması. Ayarlanmamışsa None.

    SIFIR "ölçülmedi" demek: uç tamamen çekilmişken toprağa değmesi
    mümkün değil, yani 0 gerçek bir yüzey değeri olamaz. Bu yüzden 0'ı
    "yok" sayıp ekimi eski yoluyla sürdürüyoruz.
    """
    try:
        deger = float(durum.get("toprak_t") or 0.0)
    except (TypeError, ValueError):
        return None
    return deger if deger > 0.0 else None


def _t_asagi_mm(durum: dict[str, Any]) -> float | None:
    """Tohum ucunun KENDİ ekseninde ineceği mutlak T değeri.

    Eksen kalibre değilse None: adımlar hiç yazılmıyor ve akış bugünkü
    hâliyle, her şeyi ana Z yaparak sürüyor. Uydurulmuş bir hedefe
    sürmek "yanlış MESAFE gitmek" demek.
    """
    t = (durum or {}).get("tohum_ucu") or {}
    if not t.get("kalibre"):
        return None
    b = baslar.bas(durum, "tohum")
    asagi = b.get("t_asagi_mm")
    if asagi in (None, ""):
        return None
    try:
        return round(float(asagi), 2)
    except (TypeError, ValueError):
        return None


def _ekim_coz(adlar: list[str]) -> dict[str, Any]:
    """Seçili noktalar için ekim adımlarını üretir."""
    kayitli = {n.get("ad"): n for n in noktalar.hepsi()}
    tur_indeks = {t.get("slug"): t for t in turler.hepsi()}
    alanlar = dikim.listele()
    durum = merkez.son_durum or {}
    uc = durum.get("uc") or {}
    guvenli_z = float(durum.get("guvenli_z") or 340.0)
    toprak_z = float(durum.get("toprak_z") or 0.0)

    hedefler: list[dict[str, Any]] = []
    eksik: list[str] = []
    for ad in adlar:
        bitki = kayitli.get(ad)
        if bitki is None:
            eksik.append(ad)
            continue
        slug = bitki.get("tur")
        tur = tur_indeks.get(slug) or {}
        # Ekim derinliği tür zincirinden: bitkinin `ozel` alanı > tür
        # ezmesi > katalog. Sulamadaki `ayar_coz` ile aynı öncelik.
        derinlik = ((bitki.get("ozel") or {}).get("sow_depth_mm")
                    if (bitki.get("ozel") or {}).get("sow_depth_mm") not in (None, "")
                    else tur.get("sow_depth_mm"))
        if derinlik in (None, ""):
            derinlik = turler.VARSAYILAN.get("sow_depth_mm", 0.0)
        hedefler.append({"ad": ad, "x": bitki.get("x"), "y": bitki.get("y"),
                         "tur": slug or "", "sow_depth_mm": derinlik})

    ayar = ekim.ayar_oku()
    cozum = ekim.coz(
        hedefler, uc.get("tohumluk_gozleri") or [],
        guvenli_z=guvenli_z, genel_toprak_z=toprak_z, dikim_alanlari=alanlar,
        # Süreler ve onay anahtarı panelden ayarlanıyor; kodda sabit
        # değildi ama kutusu da yoktu.
        vakum_sn=ayar["vakum_sn"], dusme_sn=ayar["dusme_sn"],
        onay=bool(ayar["onay_iste"]),
        # TOHUM UCUNUN KAYMASI. Üç baş aynı anda takılı; kayma
        # uygulanmazsa makine merkezi hedefe götürür ve tohum yanlış yere
        # düşer. Kendi dikey ekseninin hedefi de buradan geçiyor.
        bas=baslar.bas(durum, "tohum"),
        t_asagi_mm=_t_asagi_mm(durum),
        # Toprak yüzeyinin T karşılığı ajandan geliyor (plc.toprak_t).
        # Ölçülmemişse None kalıyor ve ekim eski davranışla, ana Z ile
        # sürüyor — yarım bir T ayarıyla toprağa dalmaktansa hiç
        # kullanmamak doğru.
        toprak_t=_toprak_t(durum),
        # Hazne koordinatları makine sınırlarının içinde mi. Bunu ekim
        # başlarken öğrenmek geç ve kullanıcıyı bugün üç kez durdurdu;
        # panel aynı denetimi koordinat girilirken de yapıyor.
        sinirlar=durum.get("sinirlar") or {},
        # Mesajlarda slug degil TÜRKÇE AD gorunsun: kullanici panelde
        # "Marul" seciyor, ret sebebinde "marul" okumak kafa karistiriyor.
        tur_adlari={t.get("slug"): t.get("name_tr") or t.get("slug")
                    for t in tur_indeks.values() if t.get("slug")})
    if eksik:
        cozum["ret"].insert(0, "Bulunamayan nokta: " + ", ".join(sorted(set(eksik))))
    # ADIM SINIRI ARTIK BAĞLAYICI DEĞİL. Her parça ayrı bir dizi ve en
    # uzunu dört adım; `programlar.AZAMI_ADIM` (200) tek bir dizinin
    # sınırıydı. Bitki sayısını `AZAMI_SECIM` zaten sınırlıyor.
    return cozum


# --------------------------------------------------------------------------- #
# Ekim oturumu — bitki başına al / ek / home döngüsü
#
# Akış (her satır ayrı bir dizi çalıştırması, arada burası bekliyor):
#
#   ┌ hazne↑   haznenin üstü         (soru YOK)
#   │ al       iniyor, tohum ucu kendi ekseniyle de iniyor
#   │          → burası pompayı AÇIYOR
#   │ taşı     bekle, tohum ucunu ÇEK, kalk, hedefe → ONAY: "tohum ucta mı?"
#   │ ek       in, tohum ucu in, pompa kapat, uç çek, kalk
#   └ (sıradaki bitkiye doğrudan geçiliyor)
#     home     hepsi bitince, bir kez
#
# UÇ DEĞİŞTİRME YOK. Üç baş (sulama başlığı, nem probu, tohum ucu) Z
# ekseninin ucuna kalıcı olarak vidalı; "uç tak", uç teyidi, birinci onay
# ve "uç bırak" kaldırıldı. Hepsi olmayan bir işi doğruluyordu ve uç
# yuvası koordinatlarına giden tek bir hareket kalmadı.
#
# TOHUM UCUNUN KAYMASI HER ADIMDA. Üçü aynı anda takılı olduğu için
# tohum ucu Z'nin merkezinde değil: makine `hedef + kayma`ya gidiyor.
# Kayma uygulanmazsa tohum ortadaki başın altına düşer.
#
# Döngü bitki başına baştan işliyor ve KARIŞMIYOR: bir sonraki parça
# ancak öncekinin bittiği ajanın durum paketinde görülünce gönderiliyor.
#
# HOME YALNIZ EN SONDA. Önce her bitkiden sonra dönülüyordu; her tohum
# için yatağın bir ucundan öbürüne iki fazladan yolculuk demek ve sahada
# zaman kaybettirdi.
#
# TEK ONAYIN SEBEBİ. Tohum sensörü bağlı değil: vakum tohumu tutamazsa
# ya da yolda düşürürse yazılım fark etmiyor, iniyor, pompayı kapatıyor
# ve "ekildi" diyor — geriye boş bir çukur kalıyor.
#
# YÜRÜTÜCÜYE TEK ADIM TİPİ EKLENDİ: `uc_dikey`, tohum ucunun kendi
# dikey ekseni için. Başka her şey aynı `dizi_baslat` ile koşuyor.
#
# POMPAYI BURASI AÇIYOR. `dizi._roleleri_kapat` bir dizinin açtığı
# röleyi dizi biterken kapatıyor; pompa dizinin içinde açılsaydı "al"
# biter bitmez kapanır ve tohum daha ikinci onay sorulmadan düşerdi
# (ölçüldü). Dizinin dışından `role` komutuyla açılan röle o listeye
# girmiyor. Bedeli: yürütücünün "kesilirse röleyi kapat" ağı bu pompayı
# kapsamıyor — yerini `_ekim_pompa_kapat` alıyor ve oturum ne şekilde
# biterse bitsin çağrılıyor.
# --------------------------------------------------------------------------- #

#: Bir bitkinin parçaları, sırayla. `home` ve pompa komutları arada.
PARCA_SIRASI = ("hazne", "al", "tasi", "ek")


class EkimOturumu:
    """Süren ekimin durumu. Aynı anda tek oturum — tek makine var."""

    def __init__(self) -> None:
        self.sifirla()

    def sifirla(self) -> None:
        self.aktif = False
        self.ozet: list[dict[str, Any]] = []
        self.plan: list[dict[str, Any]] = []
        self.sira = 0                  # kaçıncı bitki
        self.parca = ""                # hazne | al | tasi | ek | iptal
        self.durum = "bos"             # bos|calisiyor|onay2|bitti|iptal|hata
        self.hata = ""
        self.mesaj = ""
        self.pompa_acik = False
        self.guvenli_z = 0.0
        self.dusme_sn = ekim.DUSME_SANIYE
        self.onay_istiyor = True
        self.basladi_mi = False        # bu parçanın çalıştığını GÖRDÜK mü
        self.ekilen: list[str] = []
        # Seçimde olup EKİLMEYECEKLER (türsüz noktalar). Onay kutusunda
        # görünüyor: kullanıcı ilk onayı vermeden önce neyin atlandığını
        # bilsin, sonradan "6 seçmiştim, 3 ekilmiş" diye aramasın.
        self.atlanan: list[dict[str, Any]] = []

    # --- görünüm ------------------------------------------------------
    def goruntu(self) -> dict[str, Any]:
        o = self.ozet[self.sira] if self.sira < len(self.ozet) else {}
        onay = self.durum == "onay2"
        return {
            "aktif": self.aktif,
            "durum": self.durum,
            "parca": self.parca,
            "asama": self.asama(),
            "sira": self.sira + 1 if self.ozet else 0,
            "toplam": len(self.ozet),
            "tohum": o.get("ad", ""),
            "tur": o.get("tur", ""),
            "tur_ad": o.get("tur_ad", ""),
            "hazne": o.get("hazne", ""),
            # NEREDE DURDUĞU. Kullanıcı makineye bakarak onaylayacak ama
            # hangi haznenin ya da hangi bitkinin başında olduğunu bilmeli.
            "konum": self._konum(),
            "soru": self._soru() if onay else "",
            "gerekce": ekim.GEREKCE.get(self.durum, "") if onay else "",
            "atlanan": list(self.atlanan),
            "pompa_acik": self.pompa_acik,
            "hata": self.hata,
            "mesaj": self.mesaj,
            "ekilen": list(self.ekilen),
        }

    def _soru(self) -> str:
        return ekim.SORU.get(self.durum, "")

    def asama(self) -> str:
        """Panelde tek satırda ne yaptığı — çalışırken de görünsün."""
        return {
            "hazne": "haznenin üstüne gidiyor",
            "al": "hazneye iniyor, tohum ucu kendi ekseniyle iniyor",
            "tasi": "tohumu hedefe taşıyor",
            "ek": "tohumu bırakıyor",
            "home": "home'a dönüyor",
            "iptal": "tohum hazneye geri konuyor",
        }.get(self.parca, "")

    def _konum(self) -> dict[str, Any]:
        """Bu onay noktasında kafanın DURDUĞU yer — plandan, ölçümden değil.

        Canlı konumu panel zaten gösteriyor. Buradaki sayı "olması
        gereken": ikisi ayrışıyorsa kullanıcının bunu görmesi gerekir.
        """
        if self.sira >= len(self.ozet):
            return {}
        o = self.ozet[self.sira]
        if self.durum == "onay2" or self.parca in ("tasi", "ek"):
            # İkinci onayda kafa HEDEFİN üstünde — ekilecek yerin.
            return {"ad": o.get("ad", ""), "nerede": "hedef",
                    "x": o.get("x"), "y": o.get("y"), "z": self.guvenli_z}
        return {"ad": o.get("hazne", ""), "nerede": "hazne",
                "x": o.get("hazne_x"), "y": o.get("hazne_y"), "z": self.guvenli_z}


_ekim = EkimOturumu()


async def _ekim_baslat(cozum: dict[str, Any]) -> dict[str, Any]:
    """Ekimi kurar ve ilk parçayı (uç takma) gönderir."""
    if _ekim.aktif:
        raise HTTPException(
            status_code=409,
            detail=f"Ekim zaten sürüyor ({_ekim.sira + 1}/{len(_ekim.ozet)}). "
                   "Önce onu bitirin ya da iptal edin.")
    _ekim.sifirla()
    _ekim.aktif = True
    _ekim.ozet = cozum["ozet"]
    _ekim.plan = cozum["plan"]
    _ekim.guvenli_z = float(cozum.get("guvenli_z") or 0.0)
    _ekim.dusme_sn = float(cozum.get("dusme_sn") or ekim.DUSME_SANIYE)
    _ekim.onay_istiyor = bool(cozum.get("onay"))

    if _ekim.atlanan:
        await _ekim_gunluk(
            f"{len(_ekim.atlanan)} türsüz nokta atlandı "
            f"({', '.join(a['ad'] for a in _ekim.atlanan[:4])}"
            + (f" ve {len(_ekim.atlanan) - 4} tane daha"
               if len(_ekim.atlanan) > 4 else "")
            + ") — bunlar bitki değil, ekilecek bir şey yok.", "uyari")
    await _ekim_gunluk(
        f"ekim başladı — {len(_ekim.ozet)} bitki, hazne: "
        + ", ".join(cozum.get("kullanilan_hazneler") or ["?"]))

    # UÇ İŞİ YOK. Üç baş kalıcı olarak vidalı; takma, teyit ve birinci
    # onay kaldırıldı. Doğrudan ilk bitkinin haznesinin üstüne gidiliyor
    # ve uç yuvası koordinatlarına giden hiçbir hareket üretilmiyor.
    bas_ = cozum.get("bas") or {}
    if bas_.get("dx") or bas_.get("dy"):
        await _ekim_gunluk(
            f"tohum ucu kayması uygulanıyor: {_sayi_guvenli(bas_.get('dx')):+.0f}"
            f"/{_sayi_guvenli(bas_.get('dy')):+.0f} mm")
    if cozum.get("t_asagi_mm") is not None:
        await _ekim_gunluk(
            f"tohum ucu kendi ekseniyle de inecek "
            f"(T {_sayi_guvenli(cozum.get('t_asagi_mm')):.1f} mm)")
    await _ekim_parca_baslat("hazne")
    return {"ok": True,
            "mesaj": f"Ekim başladı — {len(_ekim.ozet)} bitki",
            "ekim": _ekim.goruntu()}


async def _ekim_yayinla() -> None:
    await merkez.yayinla({"tip": "ekim", "ekim": _ekim.goruntu()})


async def _ekim_gunluk(metin: str, seviye: str = "bilgi") -> None:
    """Panelin olay günlüğüne yazar. Ajanın günlüğüyle aynı kanal."""
    logger.info("Ekim: %s", metin)
    await merkez.yayinla({"tip": "gunluk", "seviye": seviye,
                          "metin": f"Ekim: {metin}"})


async def _ekim_pompa_kapat(neden: str) -> None:
    """Oturumun açtığı vakum pompasını kapatır.

    Dizinin dışından açtığımız için yürütücünün güvenlik ağı bunu
    kapsamıyor; kapatmak bizim işimiz ve oturum NASIL biterse bitsin
    (tamamlandı, hata, iptal, ajan koptu) çağrılıyor.
    """
    if not _ekim.pompa_acik:
        return
    _ekim.pompa_acik = False
    try:
        await merkez.komut_gonder("role", {"ad": "hava_pompasi", "durum": False})
        await _ekim_gunluk(f"vakum pompası kapatıldı ({neden})")
    except HTTPException as hata:
        # Ajan kopmuşsa komut gitmiyor. Yutmuyoruz: açık kalmış olabilecek
        # bir pompa görülmesi gereken bir şey.
        await _ekim_gunluk(
            f"UYARI: vakum pompası kapatılamadı ({neden}): {hata.detail}. "
            "Ajan bağlanınca Sür sayfasından elle kapatın.", "hata")


async def _ekim_parca_baslat(parca: str,
                             adimlar: list[dict[str, Any]] | None = None) -> None:
    """Bir parçayı ajana gönderir."""
    if adimlar is None:
        adimlar = _ekim.plan[_ekim.sira].get(parca) or []
    _ekim.parca = parca
    _ekim.durum = "calisiyor"
    _ekim.basladi_mi = False
    o = _ekim.ozet[_ekim.sira] if _ekim.sira < len(_ekim.ozet) else {}
    etiket = (f"Ekim {_ekim.sira + 1}/{len(_ekim.ozet)} · {o.get('ad', '')} · {parca}"
              if o else f"Ekim · {parca}")
    await merkez.komut_gonder("dizi_baslat", {
        "ad": etiket, "adimlar": adimlar, "tekrar": 1,
    })
    await _ekim_yayinla()


async def _ekim_ilerlet() -> None:
    """Çalışan parça bitti; sıradaki adımı at.

    AJANIN OKUMA DÖNGÜSÜNDE ÇAĞRILMIYOR — bkz. `_ekim_dizi_izle`.
    """
    try:
        await _ekim_ilerlet_ic(_ekim.parca)
    except HTTPException as hata:
        # Ajan komutu reddetti ya da koptu. Sessizce "ilerliyor"da
        # bırakmıyoruz: kullanıcı ekranda dönen bir şey görüp beklerdi.
        await _ekim_hatayla_bitir(str(hata.detail))


async def _ekim_ilerlet_ic(parca: str) -> None:
    if parca == "hazne":
        # BİRİNCİ ONAY KALDIRILDI: "uç takılı mı" diye soruyordu ve takma
        # diye bir iş kalmadı. Doğrudan hazneye iniliyor.
        await _ekim_parca_baslat("al")
        return

    if parca == "al":
        # POMPA BURADA AÇILIYOR — dizinin içinde değil. Kafa haznenin
        # dibinde duruyor; sıra korunuyor: önce in, sonra pompa.
        await merkez.komut_gonder("role", {"ad": "hava_pompasi", "durum": True})
        _ekim.pompa_acik = True
        await _ekim_parca_baslat("tasi")
        return

    if parca == "tasi":
        if not _ekim.onay_istiyor:
            await _ekim_parca_baslat("ek")
            return
        _ekim.durum = "onay2"
        await _ekim_yayinla()
        return

    if parca == "iptal":
        # "Tohumu hazneye geri koy" bitti. Pompa dizinin içinde kapandı.
        _ekim.pompa_acik = False
        await _ekim_bitir("iptal")
        return

    if parca == "birak":
        # Uç bırakma bitti; oturum gerçekten kapandı.
        _ekim.durum = "bitti"
        _ekim.aktif = False
        await _ekim_yayinla()
        return

    if parca == "home":
        # Home döndü — bu artık yalnız EN SONDA oluyor, bitişi tetikliyor.
        await _ekim_bitir("bitti")
        return

    # parca == "ek": tohum toprağa bırakıldı.
    _ekim.pompa_acik = False        # kapatma adımı dizinin içindeydi
    o = _ekim.ozet[_ekim.sira]
    _ekim.ekilen.append(str(o.get("ad") or ""))
    # EKİM TARİHİ ŞİMDİ. Bu adım gerçekten çalıştı: kafa indi, pompa
    # kapandı, tohum düştü. Damgayı başlangıçta atsaydık yarıda kesilen
    # bir ekimde ekilmemiş bitkiler "ekildi" görünürdü. Tarih ayrıca
    # bitkinin yaşını veriyor — sulama ve yayılım eğrileri buna bakıyor.
    await asyncio.to_thread(
        noktalar.alanlari_yaz, {str(o.get("ad")): {"ekim": time.time()}})
    await merkez.yayinla({"tip": "tepsi"})
    await _ekim_gunluk(f"{o.get('ad')} ekildi ({_ekim.sira + 1}/{len(_ekim.ozet)})")
    # HER BİTKİDEN SONRA HOME YOK. Önce öyleydi ve her tohum için yatağın
    # bir ucundan öbürüne iki fazladan yolculuk demekti; sahada zaman
    # kaybettirdiği görüldü. Sıradaki bitkinin haznesine doğrudan
    # gidiyoruz, home'a yalnız hepsi bitince dönülüyor.
    _ekim.sira += 1
    if _ekim.sira >= len(_ekim.ozet):
        await _ekim_home()
        return
    await _ekim_parca_baslat("hazne")


async def _ekim_home() -> None:
    """BÜTÜN bitkiler ekildikten sonra makineyi home'a gönderir.

    `home` bir DİZİ değil, ajanın kendi komutu; "çalışıyor" bayrağı
    üzerinden izleyemiyoruz. Komut senkron: ajan yanıt verdiğinde
    hareket bitmiş oluyor, o yüzden dönüşte doğrudan ilerliyoruz.
    """
    _ekim.parca = "home"
    _ekim.durum = "calisiyor"
    await _ekim_yayinla()
    await merkez.komut_gonder("home", {})
    await _ekim_ilerlet_ic("home")


async def _ekim_bitir(durum: str) -> None:
    """Oturumu kapatır; ayar öyle diyorsa ucu bırakır."""
    ekildi = len(_ekim.ekilen)
    if durum == "bitti":
        _ekim.mesaj = f"{ekildi} tohum ekildi."
        await _ekim_gunluk(_ekim.mesaj)
    # UÇ BIRAKMA YOK: uçlar kalıcı olarak vidalı, makine home'da kalıyor.
    _ekim.durum = durum
    _ekim.aktif = False
    await _ekim_yayinla()


async def _ekim_dizi_izle() -> None:
    """Ajanın durum paketi geldi — çalışan parça bitti mi?

    "Çalışıyor" bayrağının önce TRUE olduğunu görmeyi bekliyoruz.
    Beklemeseydik `dizi_baslat` yanıtı ile ajanın ilk durum paketi
    arasındaki boşlukta parçayı bitmiş sayardık ve sıradaki parçayı
    makine hâlâ hareket hâlindeyken gönderirdik.
    """
    if not _ekim.aktif or _ekim.durum != "calisiyor" or _ekim.parca == "home":
        return
    d = (merkez.son_durum or {}).get("dizi") or {}
    calisiyor = bool(d.get("calisiyor"))
    if calisiyor:
        _ekim.basladi_mi = True
        return
    if not _ekim.basladi_mi:
        return                       # henüz başlamadı

    # AYRI GÖREVE ALIYORUZ, burada beklemiyoruz. Buranın çağrıldığı yer
    # ajanın WebSocket okuma döngüsü; sıradaki parçayı göndermek ajanın
    # YANITINI beklemek demek ve o yanıtı okuyacak olan da bu döngü.
    # Aynı döngüde beklersek yanıt hiç okunmuyor: komut gidiyor, cevap
    # gelmiyor, zaman aşımına kadar makine öylece duruyor. (Ölçüldü.)
    #
    # Durumu ÖNCE değiştiriyoruz: bir sonraki durum paketi gelene kadar
    # görev başlamamış olabilir ve "calisiyor" kalsaydı ikinci bir
    # ilerletme görevi daha açılırdı.
    hata = str(d.get("hata") or "")
    _ekim.durum = "ilerliyor"
    if hata:
        asyncio.create_task(_ekim_hatayla_bitir(hata))
    else:
        asyncio.create_task(_ekim_ilerlet())


async def _ekim_hatayla_bitir(hata: str) -> None:
    _ekim.durum = "hata"
    _ekim.hata = hata
    _ekim.aktif = False
    await _ekim_pompa_kapat("dizi hatayla durdu")
    await _ekim_gunluk(
        f"{_ekim.parca} adımı durdu: {hata}. Ekim iptal edildi.", "hata")
    await _ekim_yayinla()


@app.get("/api/ekim/onay")
async def api_ekim_onay_durum(jeton: str = Query(default="")):
    """Oturumun o anki hâli. Panel açılışta ve yeniden bağlanınca buradan
    okuyor; canlı güncelleme WebSocket'teki `ekim` paketinden."""
    _parola_dogrula(jeton)
    return _ekim.goruntu()


@app.post("/api/ekim/onayla")
async def api_ekim_onayla(govde: dict[str, Any] | None = None,
                          jeton: str = Query(default="")):
    """Kullanıcı "gördüm, devam" dedi.

    UÇ TEYİDİNDE GÖVDE ÖNEMLİ: `{"uc": "tool3"}` kullanıcının kafada
    gerçekte ne olduğunu SÖYLEDİĞİ değer. Alan varsa ve yazılımın
    inancından farklıysa önce kayıt düzeltiliyor, sonra hareket
    planlanıyor.

    Neden: listeden doğru ucu seçip "Onayla, devam et"e basmak, kaydı
    değiştirmiyordu — düzeltme ayrı bir düğmedeydi. Kullanıcı doğru cevabı
    verdiğini sanırken makine eski (yanlış) inançla hareket ediyordu ve
    olmayan bir ucun yuvasına iniyordu. Kilit servosu ve varlık sensörü
    bağlı değilken tek doğrulama kaynağı kullanıcı; onun cevabının
    GERÇEKTEN işlemesi gerekiyor.

    Diğer onaylarda gövde aranmıyor: onayın söyleyecek başka bir şeyi yok
    ve boş gövdeye 422 vermek, makine beklerken basılan düğmenin
    çalışmaması demek.
    """
    _parola_dogrula(jeton)
    if not _ekim.aktif or _ekim.durum != "onay2":
        raise HTTPException(
            status_code=409,
            detail=f"Onay beklenmiyor (durum: {_ekim.durum}).")
    o = _ekim.ozet[_ekim.sira]
    await _ekim_gunluk(
        f"tohum ucta onaylandı — {o.get('ad')} noktasına ekiliyor")
    await _ekim_parca_baslat("ek")
    return _ekim.goruntu()


@app.post("/api/ekim/iptal")
async def api_ekim_iptal(govde: dict[str, Any] | None = None,
                         jeton: str = Query(default="")):
    """Kullanıcı onaylamadı ya da işi durdurdu. NE OLDUĞU AÇIK OLSUN.

    * Onay 1'de iptal: hiçbir şey olmadı. Kafa haznenin üstünde, pompa
      hiç açılmadı. Oturum biter.
    * Onay 2'de iptal: pompa AÇIK ve tohum (belki) ucta. İki seçenek var
      ve ikisi FARKLI şeyler:
        - `geri_koy`: kafa hazneye döner, iner, pompa kapanır, tohum
          geldiği yere düşer. Tohum ucta GÖRÜNÜYORSA bu.
        - `birak`:    pompa olduğu yerde kapanır, tohum hedefin üstüne
          düşer. Tohum ucta görünmüyorsa bu.
    * Parça çalışırken iptal: diziyi durduruyoruz ve pompayı kapatıyoruz.
      Panelin kilitlenmemesi için bu yol AÇIK kalmalı.
    """
    _parola_dogrula(jeton)
    if not _ekim.aktif:
        raise HTTPException(status_code=409,
                            detail=f"Süren ekim yok (durum: {_ekim.durum}).")

    ekildi = len(_ekim.ekilen)
    o = _ekim.ozet[_ekim.sira] if _ekim.sira < len(_ekim.ozet) else {}

    if _ekim.durum != "onay2":
        # Hareket sürüyor. Önce durdur, sonra pompayı kapat.
        _ekim.aktif = False
        try:
            await merkez.komut_gonder("dizi_durdur", {})
        except HTTPException:
            pass
        await _ekim_pompa_kapat("ekim durduruldu")
        _ekim.durum = "iptal"
        _ekim.mesaj = (f"Ekim durduruldu ({_ekim.asama() or _ekim.parca}). "
                       f"{ekildi} tohum ekilmişti.")
        await _ekim_gunluk(_ekim.mesaj, "uyari")
        await _ekim_yayinla()
        return _ekim.goruntu()

    kip = str((govde or {}).get("kip") or "").strip()
    if kip not in ("geri_koy", "birak"):
        raise HTTPException(
            status_code=400,
            detail="İptal biçimi gerekiyor: 'geri_koy' (tohum ucta görünüyor) "
                   "ya da 'birak' (pompa kapatılsın, tohum düşsün).")

    if kip == "birak":
        await _ekim_pompa_kapat("iptal — tohum bırakıldı")
        _ekim.aktif = False
        _ekim.durum = "iptal"
        _ekim.mesaj = (
            f"Pompa kapatıldı. Tohum {o.get('ad')} noktasının üstüne düştü — "
            f"toprağa girmedi, yüzeyde. {ekildi} tohum ekilmişti.")
        await _ekim_gunluk(_ekim.mesaj, "uyari")
        await _ekim_yayinla()
        return _ekim.goruntu()

    # geri_koy: hazneye dön, in, pompayı kapat, kalk. Hazne zaten dolu
    # sayılıyor — tükenmeyen bir kaynağa bir tohum geri koymak onu
    # değiştirmiyor, işaretlenecek bir şey yok.
    hazne = {"ad": o.get("hazne"), "x": o.get("hazne_x"),
             "y": o.get("hazne_y"), "z": o.get("hazne_z")}
    _ekim.mesaj = (f"Tohum '{o.get('hazne')}' haznesine geri konuyor. "
                   f"{ekildi} tohum ekilmişti.")
    await _ekim_gunluk(_ekim.mesaj)
    await _ekim_parca_baslat("iptal", ekim.iptal_parcasi(
        hazne, guvenli_z=_ekim.guvenli_z, dusme_sn=_ekim.dusme_sn,
        # Geri koyarken de tohum ucunun kayması geçerli — hazneye giderken
        # hangi kayma kullanıldıysa dönerken de aynısı.
        bas=baslar.bas(merkez.son_durum, "tohum")))
    return _ekim.goruntu()


@app.get("/api/ekim/ayar")
async def api_ekim_ayar_oku(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return await asyncio.to_thread(ekim.ayar_oku)


@app.post("/api/ekim/ayar")
async def api_ekim_ayar_yaz(govde: dict[str, Any], jeton: str = Query(default="")):
    """Onay anahtarı ve süreler.

    Onay KAPATILIRSA kilit şartı geri geliyor (bkz. `ekim.coz`): yani bu
    anahtar ekimi kolaylaştıran değil, doğrulamayı kimin yapacağını
    seçen bir anahtar. Değişiklik günlüğe yazılıyor — bir güvenlik
    denetiminin açılıp kapanması görünür olmalı.
    """
    _parola_dogrula(jeton)
    onceki = await asyncio.to_thread(ekim.ayar_oku)
    yeni = await asyncio.to_thread(ekim.ayar_yaz, {**onceki, **(govde or {})})
    if bool(onceki.get("onay_iste")) != bool(yeni.get("onay_iste")):
        await _ekim_gunluk(
            "onay adımı AÇILDI — kilit servosu bağlı değilse şart insan "
            "onayıyla değişiyor" if yeni["onay_iste"] else
            "onay adımı KAPATILDI — kilit şartı geri geldi; lock_reg = 0 iken "
            "ekim başlamayacak", "uyari")
    return yeni


@app.post("/api/ekim/onizle")
async def api_ekim_onizle(govde: dict[str, Any], jeton: str = Query(default="")):
    """Ekimi BAŞLATMADAN hangi gözden nereye gidileceğini gösterir.

    Toprağa giren tohum geri alınamaz; hangi gözün boşalacağını önceden
    görmek, sulama önizlemesinden daha da gerekli.
    """
    _parola_dogrula(jeton)
    adlar = [str(a) for a in (govde.get("noktalar") or []) if str(a).strip()]
    if not adlar:
        raise HTTPException(status_code=400, detail="Seçim boş")
    if len(adlar) > AZAMI_SECIM:
        raise HTTPException(
            status_code=400,
            detail=f"Tek seferde en fazla {AZAMI_SECIM} nokta işlenebilir "
                   f"(seçili: {len(adlar)})")
    cozum = await asyncio.to_thread(_ekim_coz, adlar)
    return {"ozet": cozum["ozet"], "ret": cozum["ret"], "uyari": cozum["uyari"],
            "adim": len(cozum["adimlar"]),
            "tohum_sayisi": cozum["tohum_sayisi"],
            # Hangi hazneler kullanılacak. "Boşalacak göz" yok artık:
            # hazne tükenmiyor, aynı hazne bütün marullara hizmet ediyor.
            "kullanilan_hazneler": cozum["kullanilan_hazneler"],
            # TOHUM UCUNUN KAYMASI VE KENDİ EKSENİ. Önizlemenin işi
            # makinenin NEREYE gideceğini söylemek; kayma uygulanıyorsa
            # ekranda okunan koordinat da kaymış olmalı.
            "bas": cozum.get("bas") or {},
            "t_asagi_mm": cozum.get("t_asagi_mm"),
            "adimlar": cozum["adimlar"][:80],
            # Seçimde olup ekilmeyecekler. Panel "6 bitki ekilecek,
            # 6 türsüz nokta atlanacak" diyebilsin diye ayrı alan.
            "atlanan": cozum["atlanan"],
            "atlanan_sayisi": cozum["atlanan_sayisi"],
            "onay": cozum["onay"]}


# --------------------------------------------------------------------------- #
# Tohum ızgarası
#
# Ayrı bir yapı kurmuyoruz: üretilen noktalar doğrudan nokta deposuna yazılıyor.
# Böylece "Git", "Sil" ve program adımları ızgara noktaları için de aynen
# çalışıyor — ikinci bir nokta kavramı öğrenmek gerekmiyor.
# --------------------------------------------------------------------------- #
def _izgara_coz(govde: dict[str, Any]) -> list[dict[str, Any]]:
    """Üretilecek noktalar. İki kip var ve ikisi de aynı yerden çıkıyor.

    `kip = "izgara"`  düzenli ızgara (varsayılan)
    `kip = "liste"`   tek tek yazılmış X/Y çiftleri

    LİSTE KİPİ neden var: her ekim düzenli bir ızgaraya oturmuyor.
    Kullanıcı "şuraya ve şuraya" diyebilmeli; ızgarayı zorlayıp sonra
    fazla noktaları silmek zorunda kalmamalı.

    TÜR HER İKİ KİPTE DE YAZILIYOR. Türsüz üretilen noktalar ekimde
    "türü yazılı değil" diye reddediliyordu ve kullanıcı 12 noktayı tek
    tek düzenlemek zorunda kalıyordu — üretirken sormak bir alan.
    """
    tur = str(govde.get("tur") or "").strip()[:40]
    # Tür yazılıysa nokta artık bir BİTKİ; etiketi de onu söylesin.
    ekstra = {"tur": tur} if tur else {}
    etiket = "ekim" if tur else "ızgara"
    try:
        z = float(govde.get("z", 0))
        if str(govde.get("kip") or "izgara") == "liste":
            uretilen = noktalar.nokta_listesi_uret(
                govde.get("noktalar") or [], z, str(govde.get("onek", "s")))
        else:
            uretilen = noktalar.izgara_uret(
                float(govde.get("x0", 0)), float(govde.get("y0", 0)), z,
                float(govde.get("dx", 0)), float(govde.get("dy", 0)),
                int(govde.get("satir", 1)), int(govde.get("sutun", 1)),
                str(govde.get("onek", "s")))
    except noktalar.NoktaHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Izgara değerleri sayı olmalı")
    for n in uretilen:
        n["etiket"] = etiket
        n.update(ekstra)
    return uretilen


def _sinir_disi_mi(nokta: dict[str, Any]) -> list[str]:
    """Noktanın hangi eksenlerde sınır dışı kaldığı.

    Sınırlar ajandan geliyor (`durum.sinirlar`). Ajan bağlı değilse boş liste
    dönüyoruz — "sınır dışı değil" demek değil, "bilinmiyor" demek; panel bunu
    ayrıca yazıyor.
    """
    sinirlar = merkez.son_durum.get("sinirlar") or {}
    disarida = []
    for eksen in ("x", "y", "z"):
        sinir = sinirlar.get(eksen) or {}
        alt, ust = sinir.get("min"), sinir.get("max")
        if alt is None or ust is None:
            continue
        if nokta[eksen] < float(alt) - 0.5 or nokta[eksen] > float(ust) + 0.5:
            disarida.append(eksen.upper())
    return disarida


@app.post("/api/izgara/onizle")
async def api_izgara_onizle(govde: dict[str, Any], jeton: str = Query(default="")):
    """Üretmeden önce ne olacağını gösterir: kaç nokta, kaçı sınır dışı,
    kaçının üzerine yazılacak. Geri alınamaz bir işlemi körlemesine yapmak
    yerine önce sonucu göstermek, 60 noktalık bir ızgarada fark ediyor."""
    _parola_dogrula(jeton)
    uretilen = _izgara_coz(govde)
    mevcut = {n["ad"] for n in await asyncio.to_thread(noktalar.hepsi)}

    sinir_disi = [{"ad": n["ad"], "eksenler": d} for n in uretilen if (d := _sinir_disi_mi(n))]
    # Dikim alanı bilgisi ÖNİZLEMEDE danışma niteliğinde: ızgara noktaları
    # "ızgara" etiketli, yani ille de bitki değil (kalibrasyon ızgarası da
    # buradan üretiliyor). Reddetmek yerine kaçının toprağın dışına
    # düştüğünü gösteriyoruz; karar kullanıcıda.
    alanlar = await asyncio.to_thread(dikim.listele)
    alan_disi = sorted(n["ad"] for n in uretilen
                       if alanlar and not dikim.nokta_kabul(n["x"], n["y"], alanlar)[0])
    return {
        "toplam": len(uretilen),
        "sinir_disi": sinir_disi,
        "alan_disi": alan_disi,
        "ustune_yazilacak": sorted(n["ad"] for n in uretilen if n["ad"] in mevcut),
        "sinir_bilinmiyor": not (merkez.son_durum.get("sinirlar")),
        "noktalar": uretilen,
    }


@app.post("/api/izgara/uygula")
async def api_izgara_uygula(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    uretilen = _izgara_coz(govde)
    try:
        sonuc = await asyncio.to_thread(noktalar.toplu_ekle, uretilen)
    except noktalar.NoktaHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    return {"ok": True, **sonuc, "toplam": len(uretilen)}


# --------------------------------------------------------------------------- #
# Dikim alanları
#
# Yatakta toprağın GERÇEKTEN bulunduğu dikdörtgenler. Neden ajanda değil de
# burada durduğu `dikim.py`nin başında yazıyor: bu bir güvenlik kararı değil,
# veri geçerliliği kararı ve ajan kopukken de işlemesi gerekiyor.
# --------------------------------------------------------------------------- #


@app.get("/api/dikim")
async def api_dikim_listele():
    alanlar = await asyncio.to_thread(dikim.listele)
    return {"alanlar": alanlar,
            "azami": dikim.AZAMI_ALAN,
            "en_kucuk_kenar": dikim.EN_KUCUK_KENAR,
            # Genel toprak yüzeyi ajanın `plc.toprak_z` ayarından geliyor;
            # alanın kendi değeri yoksa bu geçerli. Panel ikisini bir arada
            # gösterebilsin diye burada da veriyoruz.
            "toprak_z": merkez.son_durum.get("toprak_z")}


@app.put("/api/dikim")
async def api_dikim_kaydet(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    try:
        alanlar = await asyncio.to_thread(dikim.kaydet, govde.get("alanlar") or [])
    except dikim.DikimHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    # Tepsi kaydırıldıysa GÖZLERDEKİ BİTKİLER DE KAYAR. Tepsi rijit bir
    # parça: fiziksel olarak kaydıysa içindeki bitkiler de kaydı demek.
    # Yalnız boş gözlerin koordinatını güncelleyip bitkileri yerinde
    # bırakmak, tepsiyle hizasız duran bir bitki listesi bırakırdı.
    tasinan = await asyncio.to_thread(_tepsi_bitkilerini_hizala, alanlar)
    if tasinan:
        await merkez.yayinla({
            "tip": "gunluk", "seviye": "bilgi",
            "metin": f"Tepsi kaydı güncellendi — {tasinan} bitki gözleriyle "
                     "birlikte taşındı"})
    await merkez.yayinla({"tip": "tepsi"})
    # Kaydedilmiş hâli geri veriyoruz: köşeler sıralanmış, adlar kırpılmış
    # olabiliyor ve panel kendi yazdığına değil, DEPODAKİNE bakmalı.
    return {"ok": True, "alanlar": alanlar, "tasinan": tasinan}


# --------------------------------------------------------------------------- #
# Fidelik tepsisi — gözlü alanlar
#
# Bir dikim alanı "tepsi" tipindeyse gözleri PARAMETRİK: koordinatları
# `dikim.gozler` hesaplıyor, elle girilmiyor. Buradaki iş üç şey:
#
#   1. gözlerin DURUMUNU çıkarmak (boş / planlandı / ekildi / sulandı),
#   2. bir göze bitki koymak ve kaldırmak,
#   3. tepsi kayınca gözlerdeki bitkileri birlikte taşımak.
#
# Bitkinin kendisi `noktalar.py`de duruyor, ayrı bir "göz kaydı" YOK.
# İkinci bir bitki kavramı açsaydık ekim, sulama, eğriler ve 3B sahne
# ikisini de bilmek zorunda kalırdı; oysa gözdeki bitki sıradan bir
# bitki, yalnız koordinatını gözden alıyor.
# --------------------------------------------------------------------------- #

#: Göz durumları — panelde renkle görünüyor.
GOZ_DURUM = ("bos", "planlandi", "ekildi", "sulandi")


def _tepsi_alanlari(alanlar: list[dict[str, Any]] | None = None
                    ) -> list[dict[str, Any]]:
    return [a for a in (alanlar if alanlar is not None else dikim.listele())
            if a.get("tip") == "tepsi"]


def _goz_durum(bitki: dict[str, Any] | None) -> str:
    """Gözün durumu — bitkinin kendi damgalarından türüyor.

    Ayrı bir durum alanı TUTMUYORUZ: tutsaydık bitki silindiğinde ya da
    ekim tarihi elle değiştirildiğinde iki kayıt sessizce ayrışırdı.
    """
    if not bitki:
        return "bos"
    if bitki.get("sulama_ts"):
        return "sulandi"
    if bitki.get("ekim"):
        return "ekildi"
    return "planlandi"


def _tepsi_goruntu(alan: dict[str, Any],
                   bitkiler: list[dict[str, Any]]) -> dict[str, Any]:
    """Bir tepsinin gözleri + her gözdeki bitki ve durumu."""
    ad = alan.get("ad")
    yerlesik = {b.get("goz"): b for b in bitkiler
                if b.get("tepsi") == ad and b.get("goz")}
    gozler = []
    for g in dikim.gozler(alan):
        b = yerlesik.get(g["goz"])
        gozler.append({
            **g,
            "durum": _goz_durum(b),
            "bitki": b.get("ad") if b else "",
            "tur": (b or {}).get("tur") or "",
            "ekim": (b or {}).get("ekim"),
            "sulama_ts": (b or {}).get("sulama_ts"),
        })
    t = alan.get("tepsi") or {}
    return {
        "alan": ad, "tepsi": t,
        "satir": t.get("satir"), "sutun": t.get("sutun"),
        "toprak_z": alan.get("toprak_z"),
        "gozler": gozler,
        "dolu": sum(1 for g in gozler if g["durum"] != "bos"),
        "toplam": len(gozler),
    }


def _tepsi_bitkilerini_hizala(alanlar: list[dict[str, Any]]) -> int:
    """Gözlerdeki bitkilerin X/Y'sini gözün GÜNCEL koordinatına çeker."""
    bitkiler = noktalar.hepsi()
    guncelle: dict[str, dict[str, Any]] = {}
    for alan in _tepsi_alanlari(alanlar):
        yer = {g["goz"]: g for g in dikim.gozler(alan)}
        for b in bitkiler:
            if b.get("tepsi") != alan.get("ad"):
                continue
            g = yer.get(b.get("goz"))
            if not g:
                continue
            if abs(float(b.get("x") or 0) - g["x"]) > 0.05 \
                    or abs(float(b.get("y") or 0) - g["y"]) > 0.05:
                guncelle[b["ad"]] = {"x": g["x"], "y": g["y"]}
    return noktalar.alanlari_yaz(guncelle)


@app.get("/api/tepsi")
async def api_tepsi(jeton: str = Query(default="")):
    """Bütün tepsiler, gözleriyle ve göz durumlarıyla.

    3B sahne de buradan okuyabilir: hangi alanın tepsi olduğu, gözlerin
    koordinatı ve hangi gözde ne olduğu burada. Sahneyi çizmek bu
    oturumun işi değil; veriyi açmak öyle.
    """
    _parola_dogrula(jeton)
    alanlar = await asyncio.to_thread(dikim.listele)
    bitkiler = await asyncio.to_thread(noktalar.hepsi)
    return {"tepsiler": [_tepsi_goruntu(a, bitkiler)
                         for a in _tepsi_alanlari(alanlar)],
            "durumlar": list(GOZ_DURUM)}


@app.post("/api/tepsi/kayma")
async def api_tepsi_kayma(govde: dict[str, Any], jeton: str = Query(default="")):
    """"Bu göz aslında şurada" → bütün tepsiyi kaydır.

    Tek ölçümle hizalama: tepsi rijit, gözler arası mesafe değişmiyor,
    yalnız tamamı ötelenmiş. 32 gözü tek tek düzeltmek yerine bir göz
    ölçülüyor.
    """
    _parola_dogrula(jeton)
    ad = str(govde.get("alan") or "").strip()
    goz = str(govde.get("goz") or "").strip()
    alanlar = await asyncio.to_thread(dikim.listele)
    alan = next((a for a in alanlar if a.get("ad") == ad), None)
    if alan is None or alan.get("tip") != "tepsi":
        raise HTTPException(status_code=404, detail=f"'{ad}' adında bir tepsi yok")
    try:
        kx, ky = dikim.kayma_hesapla(
            alan, goz, float(govde.get("x")), float(govde.get("y")))
    except (dikim.DikimHatasi, TypeError, ValueError) as hata:
        raise HTTPException(status_code=400, detail=str(hata))

    yeni = [{**a, "tepsi": {**(a.get("tepsi") or {}), "kayma_x": kx, "kayma_y": ky}}
            if a.get("ad") == ad else a for a in alanlar]
    try:
        kaydedilen = await asyncio.to_thread(dikim.kaydet, yeni)
    except dikim.DikimHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    tasinan = await asyncio.to_thread(_tepsi_bitkilerini_hizala, kaydedilen)
    await merkez.yayinla({
        "tip": "gunluk", "seviye": "bilgi",
        "metin": f"'{ad}' tepsisi kaydırıldı: X{kx:+.1f} Y{ky:+.1f} mm"
                 + (f", {tasinan} bitki birlikte taşındı" if tasinan else "")})
    await merkez.yayinla({"tip": "tepsi"})
    return {"ok": True, "kayma_x": kx, "kayma_y": ky, "tasinan": tasinan,
            "alanlar": kaydedilen}


@app.post("/api/tepsi/goz")
async def api_tepsi_goz(govde: dict[str, Any], jeton: str = Query(default="")):
    """Bir göze bitki koyar ya da gözü boşaltır.

    Bitki sıradan bir nokta; farkı `tepsi` + `goz` alanlarını taşıması ve
    koordinatını gözden alması. Böylece ekim, sulama, eğriler ve harita
    hiçbir şey öğrenmeden çalışmaya devam ediyor.
    """
    _parola_dogrula(jeton)
    ad = str(govde.get("alan") or "").strip()
    istenen = [str(g) for g in (govde.get("gozler") or []) if str(g).strip()]
    if not istenen:
        raise HTTPException(status_code=400, detail="Göz seçilmedi")
    alanlar = await asyncio.to_thread(dikim.listele)
    alan = next((a for a in alanlar if a.get("ad") == ad), None)
    if alan is None or alan.get("tip") != "tepsi":
        raise HTTPException(status_code=404, detail=f"'{ad}' adında bir tepsi yok")

    tur = str(govde.get("tur") or "").strip()
    bosalt = bool(govde.get("bosalt"))
    if not bosalt and not tur:
        raise HTTPException(
            status_code=400,
            detail="Tür seçilmedi. Ekim türü olmayan bir bitkiyi "
                   "reddediyor — hangi hazneden tohum alacağını bilemiyor.")

    yer = {g["goz"]: g for g in dikim.gozler(alan)}
    bilinmeyen = [g for g in istenen if g not in yer]
    if bilinmeyen:
        raise HTTPException(
            status_code=400,
            detail=f"'{ad}' tepsisinde şu gözler yok: {', '.join(bilinmeyen[:6])}")

    mevcut = {b.get("goz"): b for b in await asyncio.to_thread(noktalar.hepsi)
              if b.get("tepsi") == ad and b.get("goz")}
    guvenli_z = float((merkez.son_durum or {}).get("guvenli_z") or 340.0)

    if bosalt:
        silinecek = [mevcut[g]["ad"] for g in istenen if g in mevcut]
        if not silinecek:
            return {"ok": True, "bosaltilan": 0}
        silinen = await asyncio.to_thread(noktalar.sil_coklu, silinecek)
        parti = geri_al.ekle(silinen, f"{len(silinen)} göz boşaltıldı")
        await merkez.yayinla({"tip": "tepsi"})
        return {"ok": True, "bosaltilan": len(silinen), "geri_al": parti}

    yeni = []
    for g in istenen:
        nokta = yer[g]
        # AD GÖZ NUMARASINDAN. Tepsi adını da katıyoruz ki ikinci bir
        # tepside aynı önek kullanılınca adlar çakışmasın.
        bitki_ad = mevcut[g]["ad"] if g in mevcut else f"{ad}/{g}"
        yeni.append({"ad": bitki_ad, "x": nokta["x"], "y": nokta["y"],
                     "z": guvenli_z, "etiket": "ekim",
                     "tur": tur, "tepsi": ad, "goz": g})
    try:
        sonuc = await asyncio.to_thread(noktalar.toplu_ekle, yeni)
    except noktalar.NoktaHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    await merkez.yayinla({"tip": "tepsi"})
    return {"ok": True, **sonuc, "bitkiler": [n["ad"] for n in yeni]}


# --------------------------------------------------------------------------- #
# Kayıtlı programlar
# --------------------------------------------------------------------------- #
@app.get("/api/programlar")
async def api_programlar(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return {"programlar": await asyncio.to_thread(programlar.hepsi)}


@app.post("/api/programlar")
async def api_program_kaydet(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    try:
        program = await asyncio.to_thread(
            programlar.kaydet, govde.get("ad", ""), govde.get("adimlar") or [],
            int(govde.get("tekrar", 1)), govde.get("degiskenler") or [])
    except programlar.ProgramHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    except (TypeError, ValueError) as hata:
        raise HTTPException(status_code=400, detail=f"Geçersiz program: {hata}")
    return {"ok": True, "program": program}


@app.delete("/api/programlar")
async def api_program_sil(ad: str = Query(...), jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    if not await asyncio.to_thread(programlar.sil, ad):
        raise HTTPException(status_code=404, detail=f"'{ad}' adında program yok")
    return {"ok": True}


@app.post("/api/programlar/calistir")
async def api_program_calistir(govde: dict[str, Any], jeton: str = Query(default="")):
    """Programı çözüp ajana gönderir.

    Nokta adları burada koordinata çevriliyor; ajan nokta deposunu bilmiyor.
    Eksik bir nokta varsa dizi HİÇ başlamıyor — yarıda durmasındansa.
    """
    _parola_dogrula(jeton)
    ad = str(govde.get("ad", ""))
    program = await asyncio.to_thread(programlar.bul, ad)
    if program is None:
        raise HTTPException(status_code=404, detail=f"'{ad}' adında program yok")
    try:
        # Değişkenli dizi: değerler istekte geliyor. Biri eksikse dizi HİÇ
        # başlamıyor — yarıda "değer yok" diye durmaktansa.
        adimlar = await asyncio.to_thread(
            programlar.coz, program, govde.get("degerler") or {})
    except programlar.ProgramHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    return await merkez.komut_gonder("dizi_baslat", {
        "ad": program["ad"], "adimlar": adimlar,
        "tekrar": program.get("tekrar", 1), "hiz": govde.get("hiz"),
    })


# --------------------------------------------------------------------------- #
# Eğriler — zamana göre değişen değerler
#
# "Günde 250 ml" sabit bir sayı; oysa fide üç günlükken de hasada bir hafta
# kalmışken de aynı suyu istemiyor. Eğri bitkinin YAŞINA göre değer veriyor.
# Hesap `egriler.py` içinde; panel eğriyi çiziyor, değerlendirmiyor.
# --------------------------------------------------------------------------- #
@app.get("/api/egriler")
async def api_egriler(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return {"egriler": await asyncio.to_thread(egriler.hepsi),
            "sablonlar": egriler.SABLONLAR,
            "tipler": {t: egriler.BIRIM[t] for t in egriler.GECERLI_TIPLER}}


@app.post("/api/egriler")
async def api_egri_kaydet(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    try:
        egri = await asyncio.to_thread(
            egriler.kaydet, govde.get("ad", ""), govde.get("tip", ""),
            govde.get("noktalar") or [])
    except egriler.EgriHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    return {"ok": True, "egri": egri}


@app.delete("/api/egriler")
async def api_egri_sil(ad: str = Query(...), jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    if not await asyncio.to_thread(egriler.sil, ad):
        raise HTTPException(status_code=404, detail=f"'{ad}' adında eğri yok")
    return {"ok": True}


@app.get("/api/egriler/deger")
async def api_egri_deger(ad: str = Query(...), gun: float = Query(default=0),
                         jeton: str = Query(default="")):
    """Bir eğrinin belirli yaştaki değeri — hesabın tek yeri sunucuda."""
    _parola_dogrula(jeton)
    egri = await asyncio.to_thread(egriler.bul, ad)
    if egri is None:
        raise HTTPException(status_code=404, detail=f"'{ad}' adında eğri yok")
    return {"ad": egri["ad"], "tip": egri["tip"], "birim": egri["birim"],
            "gun": gun, "deger": egriler.deger(egri, gun)}


# --------------------------------------------------------------------------- #
# Görüntü çözümleme — karede ne var, yatağın neresinde
#
# `goruntu.py` piksel dünyasında (ExG, eşik, leke), `tespit.py` milimetre
# dünyasında (kalibrasyon + karenin konumu). Burası ikisini birleştirip
# panele veriyor.
#
# NUMPY İSTEĞE BAĞLI. Pi'de `numpy` kurulu olmayabilir ve sunucunun
# YALNIZ bu yüzden açılmaması kabul edilemez: sulama, ekim, hareket
# görüntü işlemeye ihtiyaç duymuyor. İçe aktarma tembel; yoksa uç nokta
# ne yapılması gerektiğini söyleyen bir hata dönüyor, sunucu çalışmaya
# devam ediyor.
# --------------------------------------------------------------------------- #

_GORUNTU: dict[str, Any] = {"hazir": None, "hata": ""}


def _goruntu_yukle():
    """(goruntu, tespit, numpy, Image) ya da None — eksikse sebebi `_GORUNTU`da."""
    if _GORUNTU["hazir"] is not None:
        return _GORUNTU["hazir"] or None
    try:
        import numpy as _np
        from PIL import Image as _Image
        import goruntu as _goruntu
        import tespit as _tespit
        _GORUNTU["hazir"] = (_goruntu, _tespit, _np, _Image)
    except Exception as hata:                       # ImportError ve türevleri
        _GORUNTU["hazir"] = False
        _GORUNTU["hata"] = (
            f"Görüntü işleme için numpy ve Pillow gerekiyor ({hata}). "
            "Pi'de: sunucu/.venv/bin/pip install numpy Pillow")
        logger.warning("Görüntü işleme kapalı: %s", _GORUNTU["hata"])
    return _GORUNTU["hazir"] or None


def _kare_dizi(ham: bytes, azami_en: int = 640):
    """JPEG baytlarını (rgb dizisi, en, boy) yapar.

    Kare `azami_en`den genişse küçültülüyor. Görüş alanı değişmediği
    için `tespit.piksel_mm` küçültülmüş piksel uzayını kabul ediyor —
    ölçeği kendisi düzeltiyor.
    """
    _, _, np, Image = _goruntu_yukle()
    import io as _io
    im = Image.open(_io.BytesIO(ham)).convert("RGB")
    if im.width > azami_en:
        im = im.resize((azami_en, max(1, round(im.height * azami_en / im.width))))
    return np.asarray(im), im.width, im.height


def _yaricaplar(bitkiler: list[dict[str, Any]]
                ) -> tuple[dict[str, float], dict[str, bool]]:
    """(yarıçap, yaşa_göre_mi) — sulamanın kullandığı zincirin AYNISI.

    Kopyalamıyoruz: `sulama.guncel_yaricap_mm` neyse o. İkisi ayrışırsa
    haritada eşleşen bir leke sulamada eşleşmeyebilirdi.

    İkinci sözlük, yarıçabın BİR YAYILIM EĞRİSİNDEN gelip gelmediğini
    söylüyor. Gelmiyorsa değer katalogdaki olgun çap ve "beklenen"
    kelimesi orada yaşa göre bir beklenti anlamına GELMİYOR — panelin
    bunu ayırt etmesi gerekiyor, yoksa her fideye "geride kalmış" der.
    """
    tur_indeks = {t.get("slug"): t for t in turler.hepsi()}
    egri_listesi = egriler.hepsi()
    simdi = time.time()
    cikti: dict[str, float] = {}
    yasa: dict[str, bool] = {}
    for b in bitkiler:
        gun = sulama.yas_gun(b, simdi)
        yaricap, egriden = sulama.guncel_yaricap_mm(
            b, tur_indeks.get(b.get("tur")), gun, egri_listesi)
        cikti[b.get("ad")] = float(yaricap)
        yasa[b.get("ad")] = bool(egriden)
    return cikti, yasa


def _kare_bul(damga: str, kamera: str = kareler.VARSAYILAN_KAMERA
              ) -> dict[str, Any] | None:
    kam = kareler.ad_temizle(kamera)
    return next((k for k in kareler.liste(kam) if k["damga"] == damga), None)


def _kamera_bilgi(ad: str) -> dict[str, Any]:
    """Ajanın bildirdiği kamera künyesi — etiket, hareketli mi.

    Ajan kopukken boş dönüyor; çağıranlar "bilmiyorum"u karenin konumunun
    olup olmamasından ayırt edebilsin diye sözlük boş kalıyor, uydurma bir
    varsayılan konmuyor.
    """
    kam = kareler.ad_temizle(ad)
    for k in (merkez.son_durum.get("kameralar") or []):
        if kareler.ad_temizle(k.get("ad")) == kam:
            return k
    return {}


def _kamera_etiket(ad: str) -> str:
    return str(_kamera_bilgi(ad).get("etiket") or ad)


def _goruntu_coz(damga: str, esik: float | None, en_az_piksel: int,
                 kamera: str = kareler.VARSAYILAN_KAMERA) -> dict[str, Any]:
    """Bir kareyi çözümler: lekeler + milimetre + kayıtlı bitki eşlemesi.

    KALİBRASYON KARENİN KAMERASINDAN geliyor. Uç kamerasının mm/px'ini sabit
    kameranın karesine uygulamak (ya da tersi) ölçüleri kat kat yanlış yapar
    ve yanlışlık görünmez — sonuç yine "milimetre" diye yazılır.

    SABİT KAMERADA KONUM YOK. O kareden çıkan şey ölçüler (çap, alan, en/boy);
    yatak koordinatı ve kayıtlı bitkilerle eşleme çıkmıyor, uydurulmuyor.
    """
    goruntu, tespit, _, _ = _goruntu_yukle()
    kam = kareler.ad_temizle(kamera)
    kayit = _kare_bul(damga, kam)
    if kayit is None:
        raise HTTPException(status_code=404,
                            detail=f"'{kam}' kamerasında '{damga}' damgalı kare yok")
    ham = kareler.getir(damga, kam)
    if not ham:
        raise HTTPException(status_code=404, detail="Kare dosyası okunamadı")

    rgb, en, boy = _kare_dizi(ham)
    sonuc = goruntu.bul(rgb, esik=(goruntu.ESIK if esik is None else esik),
                        en_az_piksel=en_az_piksel)
    kalib = kalibrasyon.oku(kam)
    bilgi = _kamera_bilgi(kam)
    # Hareketli mi: ajan söylüyorsa ondan. Ajan kopuksa karenin konumu olup
    # olmamasına bakıyoruz — sabit kameranın karesinde konum hiç olmuyor.
    hareketli = bool(bilgi.get("hareketli", kayit.get("x") is not None))

    if hareketli:
        cozum = tespit.cozumle(sonuc["lekeler"], kayit, kalib,
                               genislik_px=en, yukseklik_px=boy)
    else:
        boyut = tespit.boyutlar_mm(sonuc["lekeler"], kalib, genislik_px=en)
        cozum = {"lekeler": boyut["lekeler"], "kare_mm": None,
                 "ret": boyut["ret"] + [tespit.SABIT_KAMERA]}

    # Eşleme yalnız milimetre VE konum varken anlamlı.
    eslesme: dict[str, Any] = {"eslesen": [], "yabani_aday": [], "gorunmeyen": []}
    if hareketli and not cozum["ret"]:
        hepsi = [n for n in noktalar.hepsi() if n.get("tur")]
        icerdeki = tespit.kare_icinde(hepsi, cozum["kare_mm"])
        caplar, yasa = _yaricaplar(icerdeki)
        eslesme = tespit.eslestir(cozum["lekeler"], icerdeki,
                                  yaricap_mm=caplar, yasa_gore=yasa)
    return {
        "damga": damga, "ts": kayit.get("ts"),
        "kamera": kam, "kamera_etiket": str(bilgi.get("etiket") or kam),
        "hareketli": hareketli,
        # Ölçüler var ama koordinat yok — panelin ikisini karıştırmaması için
        # ayrı bir bayrak. `ret` doluyken bile `lekeler` dolu olabiliyor.
        "yalniz_olcu": bool(not hareketli and cozum["lekeler"]),
        "kare": {"x": kayit.get("x"), "y": kayit.get("y"),
                 "en_px": en, "boy_px": boy},
        "esik": sonuc["esik"], "oran": round(sonuc["oran"], 4),
        "ham_leke": sonuc["ham_leke"],
        "lekeler_px": sonuc["lekeler"],
        "lekeler": cozum["lekeler"],
        "kare_mm": cozum["kare_mm"],
        "ret": cozum["ret"],
        "eslesen": eslesme["eslesen"],
        "yabani_aday": eslesme["yabani_aday"],
        "gorunmeyen": [{"ad": b.get("ad"), "x": b.get("x"), "y": b.get("y"),
                        "tur": b.get("tur")} for b in eslesme["gorunmeyen"]],
        # Otsu bu sahnede güvenilir mi — panelde not olarak görünüyor.
        "otsu_ayrim": round(goruntu.otsu_ayrim(goruntu.exg(rgb)), 3),
    }


@app.get("/api/goruntu/durum")
async def api_goruntu_durum(jeton: str = Query(default=""),
                            kamera: str = Query(default=kareler.VARSAYILAN_KAMERA)):
    """Görüntü işleme kullanılabilir mi, kalibrasyon var mı, kaç kare var.

    `kalibre` ve `mm_px` SEÇİLİ KAMERANIN sayıları — "kalibre edildi" tek bir
    olgu değil, kamera başına ayrı bir olgu.
    """
    _parola_dogrula(jeton)
    kam = kareler.ad_temizle(kamera)
    hazir = await asyncio.to_thread(_goruntu_yukle)
    kalib = await asyncio.to_thread(kalibrasyon.oku, kam)
    liste = await asyncio.to_thread(kareler.liste, kam)
    bilgi = _kamera_bilgi(kam)
    return {
        "hazir": bool(hazir),
        "hata": _GORUNTU["hata"],
        "kamera": kam,
        "kamera_etiket": str(bilgi.get("etiket") or kam),
        "hareketli": bool(bilgi.get("hareketli", True)),
        "kalibre": float(kalib.get("mm_px") or 0) > 0,
        "mm_px": kalib.get("mm_px"),
        "kalibrasyonlar": await asyncio.to_thread(kalibrasyon.hepsi),
        "kare_sayisi": len(liste),
        "konumlu_kare": sum(1 for k in liste if k.get("x") is not None),
        "kareler": sorted(liste, key=lambda k: -k["ts"])[:12],
    }


@app.post("/api/goruntu/coz")
async def api_goruntu_coz(govde: dict[str, Any], jeton: str = Query(default="")):
    """Bir kareyi çözümle: bitki lekeleri, milimetre ölçüleri, eşleşmeler."""
    _parola_dogrula(jeton)
    if not await asyncio.to_thread(_goruntu_yukle):
        raise HTTPException(status_code=503, detail=_GORUNTU["hata"])
    kam = kareler.ad_temizle(govde.get("kamera"))
    damga = str(govde.get("damga") or "").strip()
    if not damga:
        liste = await asyncio.to_thread(kareler.liste, kam)
        if not liste:
            raise HTTPException(status_code=404,
                                detail=f"'{_kamera_etiket(kam)}' kamerasından hiç kare yok")
        damga = max(liste, key=lambda k: k["ts"])["damga"]
    esik = govde.get("esik")
    esik = None if esik in (None, "") else float(esik)
    en_az = int(govde.get("en_az_piksel") or 0) or None
    goruntu, _, _, _ = _goruntu_yukle()
    return await asyncio.to_thread(
        _goruntu_coz, damga, esik, en_az or goruntu.EN_AZ_PIKSEL, kam)


def _goruntu_fark(damga_a: str, damga_b: str,
                  kamera: str = kareler.VARSAYILAN_KAMERA) -> dict[str, Any]:
    """İki karenin farkı. AYNI kameranın, AYNI konumda çekilmiş kareleri.

    Sabit kamerada "aynı konum" şartı kendiliğinden sağlanıyor (kamera hiç
    oynamıyor) ama konum alanı boş olduğu için kayma ölçülemiyor; orada
    şartı kameranın sabitliği karşılıyor.
    """
    goruntu, tespit, _, _ = _goruntu_yukle()
    kam = kareler.ad_temizle(kamera)
    ka, kb = _kare_bul(damga_a, kam), _kare_bul(damga_b, kam)
    if ka is None or kb is None:
        raise HTTPException(status_code=404, detail="Karelerden biri bulunamadı")
    kalib = kalibrasyon.oku(kam)
    hareketli = bool(_kamera_bilgi(kam).get("hareketli", ka.get("x") is not None))
    if not hareketli:
        return _fark_sabit(damga_a, damga_b, kam, kalib)
    if ka.get("x") is None or kb.get("x") is None:
        raise HTTPException(
            status_code=422,
            detail="Karelerden birinin makine konumu yok — fark alınamaz.")
    # Konum farkı: fark almanın ÖN ŞARTI aynı yerde çekilmiş olmaları.
    # 2 mm eşiği ölçüm gürültüsü payı; ötesi hizasız kare demek ve
    # hizasız iki karenin farkı baştan sona "değişim" gösterir.
    kayma = math.hypot(float(ka["x"]) - float(kb["x"]), float(ka["y"]) - float(kb["y"]))
    if kayma > 2.0:
        raise HTTPException(
            status_code=422,
            detail=(f"Kareler farklı konumda çekilmiş ({kayma:.1f} mm kayma). "
                    "Fark almak için makinenin aynı noktaya dönmesi gerekiyor — "
                    "hizasız iki karenin farkı baştan sona 'değişim' gösterir."))

    ra, ena, boya = _kare_dizi(kareler.getir(damga_a, kam) or b"")
    rb, enb, boyb = _kare_dizi(kareler.getir(damga_b, kam) or b"")
    if (ena, boya) != (enb, boyb):
        raise HTTPException(status_code=422, detail="Kareler farklı çözünürlükte")

    f = goruntu.fark(ra, rb)
    cikti = {
        "a": damga_a, "b": damga_b, "kamera": kam, "kayma_mm": round(kayma, 2),
        "sigma": f["sigma"], "esik": f["esik"],
        "koyulasan_oran": round(f["koyulasan_oran"], 4),
        "acilan_oran": round(f["acilan_oran"], 4),
        "koyulasan": None, "acilan": None,
    }
    for ad in ("koyulasan", "acilan"):
        kutu = goruntu.kutu(f[ad])
        if kutu is None:
            continue
        sahte = {"no": None, "cx": kutu["cx"], "cy": kutu["cy"],
                 "x1": kutu["x1"], "y1": kutu["y1"],
                 "x2": kutu["x2"], "y2": kutu["y2"],
                 "en_px": kutu["x2"] - kutu["x1"] + 1,
                 "boy_px": kutu["y2"] - kutu["y1"] + 1,
                 "alan_px": kutu["alan_px"], "dolgu": 1.0}
        cozum = tespit.cozumle([sahte], kb, kalib, genislik_px=enb, yukseklik_px=boyb)
        cikti[ad] = (cozum["lekeler"][0] if cozum["lekeler"] else None)
        cikti[f"{ad}_px"] = kutu
    return cikti


def _fark_sabit(damga_a: str, damga_b: str, kam: str,
                kalib: dict[str, Any]) -> dict[str, Any]:
    """Sabit kameranın iki karesi arasındaki değişim.

    Konum şartı yok — kamera oynamıyor, iki kare zaten aynı sahneyi
    gösteriyor. Çıkan değişim kutusunun YATAK KOORDİNATI verilmiyor
    (kameranın nereye baktığı bilinmiyor); yalnız piksel kutusu ve
    kalibreyse ölçüsü veriliyor.
    """
    goruntu, tespit, _, _ = _goruntu_yukle()
    ra, ena, boya = _kare_dizi(kareler.getir(damga_a, kam) or b"")
    rb, enb, boyb = _kare_dizi(kareler.getir(damga_b, kam) or b"")
    if (ena, boya) != (enb, boyb):
        raise HTTPException(status_code=422, detail="Kareler farklı çözünürlükte")
    f = goruntu.fark(ra, rb)
    cikti: dict[str, Any] = {
        "a": damga_a, "b": damga_b, "kamera": kam, "kayma_mm": None,
        "hareketli": False, "not": tespit.SABIT_KAMERA,
        "sigma": f["sigma"], "esik": f["esik"],
        "koyulasan_oran": round(f["koyulasan_oran"], 4),
        "acilan_oran": round(f["acilan_oran"], 4),
        "koyulasan": None, "acilan": None,
    }
    for ad in ("koyulasan", "acilan"):
        kutu = goruntu.kutu(f[ad])
        if kutu is None:
            continue
        sahte = {"no": None, "en_px": kutu["x2"] - kutu["x1"] + 1,
                 "boy_px": kutu["y2"] - kutu["y1"] + 1,
                 "alan_px": kutu["alan_px"], "dolgu": 1.0}
        olcu = tespit.boyutlar_mm([sahte], kalib, genislik_px=enb)
        cikti[ad] = (olcu["lekeler"][0] if olcu["lekeler"] else None)
        cikti[f"{ad}_px"] = kutu
    return cikti


@app.post("/api/goruntu/fark")
async def api_goruntu_fark(govde: dict[str, Any], jeton: str = Query(default="")):
    """Aynı noktada çekilmiş iki kare arasındaki değişim.

    Sulamanın gerçekten toprağa düştüğünü, bir şeyin çimlendiğini ya da
    büyüdüğünü GÖREREK doğrulamanın yolu bu. Makine aynı koordinata
    dönebildiği için kareler piksel piksel hizalı; hizalama adımına
    gerek yok.
    """
    _parola_dogrula(jeton)
    if not await asyncio.to_thread(_goruntu_yukle):
        raise HTTPException(status_code=503, detail=_GORUNTU["hata"])
    a = str(govde.get("a") or "").strip()
    b = str(govde.get("b") or "").strip()
    if not a or not b:
        raise HTTPException(status_code=400, detail="İki kare damgası gerekiyor")
    return await asyncio.to_thread(_goruntu_fark, a, b,
                                   kareler.ad_temizle(govde.get("kamera")))


def _cimlenme(damga: str, adlar: list[str], esik: float | None,
              yaricap: float, kamera: str = kareler.VARSAYILAN_KAMERA
              ) -> dict[str, Any]:
    """Ekilen noktaların üstünde bir şey çıkmış mı.

    Bütün yatağa değil, her noktanın çevresindeki KÜÇÜK pencereye
    bakıyoruz. Nerede ekildiğini bildiğimiz için yanlış pozitiflerin
    çoğu daha bakmadan eleniyor — ve fide birkaç milimetre olduğu için
    leke ayırmaya değil, pencerede yeşil ORANINA bakmak yeterli.
    """
    goruntu, tespit, _, _ = _goruntu_yukle()
    kam = kareler.ad_temizle(kamera)
    kayit = _kare_bul(damga, kam)
    if kayit is None:
        raise HTTPException(status_code=404, detail=f"'{damga}' damgalı kare yok")
    ham = kareler.getir(damga, kam)
    if not ham:
        raise HTTPException(status_code=404, detail="Kare dosyası okunamadı")
    rgb, en, boy = _kare_dizi(ham)
    kalib = kalibrasyon.oku(kam)
    if not tespit.kalibre_mi(kalib):
        raise HTTPException(status_code=422, detail=tespit.YOK_KALIBRASYON)
    # Çimlenme, NOKTANIN koordinatından karede bir pencere açmaya dayanıyor;
    # sabit kamerada o dönüşüm yok. Sessizce yanlış bir pencereye bakıp
    # "çimlenmedi" demektense söylüyoruz.
    if not _kamera_bilgi(kam).get("hareketli", kayit.get("x") is not None):
        raise HTTPException(status_code=422, detail=tespit.SABIT_KAMERA)
    if kayit.get("x") is None:
        raise HTTPException(status_code=422, detail=tespit.YOK_KONUM)

    kayitli = {n.get("ad"): n for n in noktalar.hepsi()}
    e = (goruntu.ESIK if esik is None else esik)
    cikti = []
    for ad in adlar:
        n = kayitli.get(ad)
        if n is None:
            cikti.append({"ad": ad, "durum": "nokta yok"})
            continue
        p = tespit.pencere_px(n.get("x"), n.get("y"), kayit, kalib,
                              yaricap_mm=yaricap, genislik_px=en, yukseklik_px=boy)
        if p is None:
            cikti.append({"ad": ad, "durum": "kare bu noktayı görmüyor"})
            continue
        kirp = rgb[p["y1"]:p["y2"], p["x1"]:p["x2"]]
        oran = goruntu.bitki_orani(kirp, e)
        cikti.append({
            "ad": ad, "x": n.get("x"), "y": n.get("y"), "tur": n.get("tur") or "",
            "durum": "ölçüldü", "yesil_oran": round(oran, 4),
            "pencere": p, "tam": p["tam"],
            # Piksel sayısı da lazım: %2 yeşil, 100 piksellik bir
            # pencerede 2 piksel demek ve o gürültü olabilir.
            "pencere_px": int((p["x2"] - p["x1"]) * (p["y2"] - p["y1"])),
            "yesil_px": int(round(oran * (p["x2"] - p["x1"]) * (p["y2"] - p["y1"]))),
        })
    return {"damga": damga, "kamera": kam, "esik": e, "yaricap_mm": yaricap,
            "noktalar": cikti}


@app.post("/api/goruntu/cimlenme")
async def api_goruntu_cimlenme(govde: dict[str, Any], jeton: str = Query(default="")):
    """Ekilen noktaların üstündeki yeşil oranı — çimlenme göstergesi.

    Tek ölçüm "çimlendi" demiyor: oran ZAMANLA yükseliyorsa çimlenme.
    Karar panelde, sayıya bakan kişide.
    """
    _parola_dogrula(jeton)
    if not await asyncio.to_thread(_goruntu_yukle):
        raise HTTPException(status_code=503, detail=_GORUNTU["hata"])
    kam = kareler.ad_temizle(govde.get("kamera"))
    damga = str(govde.get("damga") or "").strip()
    if not damga:
        liste = await asyncio.to_thread(kareler.liste, kam)
        if not liste:
            raise HTTPException(status_code=404, detail="Hiç kare yok")
        damga = max(liste, key=lambda k: k["ts"])["damga"]
    adlar = [str(a) for a in (govde.get("noktalar") or []) if str(a).strip()]
    if not adlar:
        raise HTTPException(status_code=400, detail="Nokta seçilmedi")
    if len(adlar) > AZAMI_SECIM:
        raise HTTPException(status_code=400,
                            detail=f"Tek seferde en fazla {AZAMI_SECIM} nokta")
    esik = govde.get("esik")
    esik = None if esik in (None, "") else float(esik)
    _, tespit, _, _ = _goruntu_yukle()
    yaricap = max(5.0, min(200.0, float(govde.get("yaricap_mm")
                                        or tespit.CIMLENME_PENCERE_MM)))
    return await asyncio.to_thread(_cimlenme, damga, adlar, esik, yaricap, kam)


@app.get("/api/goruntu/maske")
async def api_goruntu_maske(damga: str = Query(...), esik: float = Query(default=-9.0),
                            jeton: str = Query(default=""),
                            kamera: str = Query(default=kareler.VARSAYILAN_KAMERA)):
    """Karenin maskesini PNG olarak döner — panel fotoğrafın üstüne koyuyor.

    Yeşil bulunan yer opak, gerisi saydam. Böylece "makine ne gördü"
    sorusu ekranda gözle karşılaştırılabiliyor; sayılara güvenmeden
    önce bakılacak ilk şey bu.
    """
    _parola_dogrula(jeton)
    if not await asyncio.to_thread(_goruntu_yukle):
        raise HTTPException(status_code=503, detail=_GORUNTU["hata"])
    goruntu, _, np, Image = _goruntu_yukle()

    def uret() -> bytes:
        ham = kareler.getir(damga, kareler.ad_temizle(kamera))
        if not ham:
            raise HTTPException(status_code=404, detail="Kare bulunamadı")
        rgb, _, _ = _kare_dizi(ham)
        e = goruntu.ESIK if esik < -1.0 else esik
        maske = goruntu.ac_kapa(goruntu.exg(rgb) > e)
        h, w = maske.shape
        rgba = np.zeros((h, w, 4), np.uint8)
        rgba[maske] = (90, 255, 130, 150)
        import io as _io
        tampon = _io.BytesIO()
        Image.fromarray(rgba, "RGBA").save(tampon, format="PNG")
        return tampon.getvalue()

    return Response(content=await asyncio.to_thread(uret), media_type="image/png",
                    headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------- #
# Kamera kalibrasyonu — fotoğrafı haritaya oturtan sayılar
#
# Kamera uç kafasında; kare çekildiği eksen konumuyla saklanıyor. Bu dört sayı
# (ölçek, açı, iki eksen kayması) kareyi haritanın doğru yerine koymaya
# yarıyor. Hesap `kalibrasyon.py` içinde; panel yalnızca tıklanan pikselleri
# gönderiyor.
# --------------------------------------------------------------------------- #
@app.get("/api/kamera/kalibrasyon")
async def api_kalibrasyon(jeton: str = Query(default=""),
                          kamera: str = Query(default=kalibrasyon.VARSAYILAN_KAMERA)):
    """Seçili kameranın kalibrasyonu + hepsi.

    `kalibrasyon` tekili duruyor: haritanın kare katmanı ve eski panel
    doğrudan onu okuyor ve o her zaman UÇ kamerasının sayısı olmalı — harita
    yalnızca konumu bilinen kareleri çiziyor, onlar da uç kamerasından.
    """
    _parola_dogrula(jeton)
    kam = kalibrasyon.ad_temizle(kamera)
    return {"kalibrasyon": await asyncio.to_thread(kalibrasyon.oku, kam),
            "kamera": kam,
            "kalibrasyonlar": await asyncio.to_thread(kalibrasyon.hepsi)}


@app.post("/api/kamera/kalibrasyon")
async def api_kalibrasyon_kaydet(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    try:
        veri = await asyncio.to_thread(kalibrasyon.kaydet, govde,
                                       kalibrasyon.ad_temizle(govde.get("kamera")))
    except kalibrasyon.KalibrasyonHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    except (TypeError, ValueError) as hata:
        raise HTTPException(status_code=400, detail=f"Geçersiz kalibrasyon: {hata}")
    return {"ok": True, "kalibrasyon": veri}


@app.post("/api/kamera/kalibrasyon/coz")
async def api_kalibrasyon_coz(govde: dict[str, Any], jeton: str = Query(default="")):
    """İki kareden ölçek ve açıyı hesaplar; istenirse doğrudan kaydeder.

    Gövde: {"kare1": {"x","y","u","v"}, "kare2": {…}, "kamera": "uc",
            "kaydet": true}

    YALNIZ HAREKETLİ KAMERADA. Sabit kamerada makine oynadığında sahne
    değişmiyor; iki kare arasındaki piksel farkı sıfır çıkar ve yöntem
    hiçbir şey ölçmez. Bunu hesaba sokup saçma bir sayı üretmektense
    baştan reddediyoruz — sabit kamera için `/olcek` var.
    """
    _parola_dogrula(jeton)
    kam = kalibrasyon.ad_temizle(govde.get("kamera"))
    bilgi = _kamera_bilgi(kam)
    if bilgi and not bilgi.get("hareketli", True):
        raise HTTPException(
            status_code=422,
            detail=(f"'{bilgi.get('etiket') or kam}' sabit bir kamera; makine "
                    "oynadığında gördüğü sahne değişmiyor, iki kare yöntemi "
                    "orada hiçbir şey ölçemez. Bunun yerine karede uzunluğu "
                    "bilinen bir şeyin iki ucunu işaretleyen ölçek yöntemini "
                    "kullanın."))
    try:
        sonuc = await asyncio.to_thread(
            kalibrasyon.coz, govde.get("kare1") or {}, govde.get("kare2") or {})
    except kalibrasyon.KalibrasyonHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    except (KeyError, TypeError, ValueError) as hata:
        raise HTTPException(status_code=400, detail=f"Eksik ya da geçersiz kare verisi: {hata}")

    veri = None
    if govde.get("kaydet"):
        veri = await asyncio.to_thread(kalibrasyon.kaydet, {
            "mm_px": sonuc["mm_px"], "donme": sonuc["donme"],
            "genislik_px": govde.get("genislik_px"),
            "yukseklik_px": govde.get("yukseklik_px"),
            "yontem": "iki-kare", "guncelleme": time.time(),
        }, kam)
    return {"ok": True, "sonuc": sonuc, "kalibrasyon": veri, "kamera": kam}


@app.post("/api/kamera/kalibrasyon/olcek")
async def api_kalibrasyon_olcek(govde: dict[str, Any], jeton: str = Query(default="")):
    """Tek kareden ölçek — SABİT kameranın kalibrasyon yolu.

    Gövde: {"u1","v1","u2","v2","mm", "kamera": "ust", "kaydet": true}

    Karede uzunluğu bilinen bir şeyin iki ucu işaretleniyor (cetvel, yatak
    kenarı, iki tepsi gözü arası) ve gerçek mesafesi yazılıyor. Yalnız
    `mm_px` çıkıyor: açı ve konum çıkmıyor, çünkü sabit kameranın karesinin
    makine koordinatı yok. Uydurmuyoruz — kalibre edilmemiş kamerada panel
    milimetre değil piksel yazmaya devam ediyor.
    """
    _parola_dogrula(jeton)
    kam = kalibrasyon.ad_temizle(govde.get("kamera"))
    try:
        sonuc = await asyncio.to_thread(
            kalibrasyon.coz_olcek, float(govde.get("u1")), float(govde.get("v1")),
            float(govde.get("u2")), float(govde.get("v2")), float(govde.get("mm")))
    except kalibrasyon.KalibrasyonHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    except (KeyError, TypeError, ValueError) as hata:
        raise HTTPException(status_code=400,
                            detail=f"Eksik ya da geçersiz işaret verisi: {hata}")
    veri = None
    if govde.get("kaydet"):
        veri = await asyncio.to_thread(kalibrasyon.kaydet, {
            "mm_px": sonuc["mm_px"],
            "genislik_px": govde.get("genislik_px"),
            "yukseklik_px": govde.get("yukseklik_px"),
            "yontem": "olcek", "guncelleme": time.time(),
        }, kam)
    return {"ok": True, "sonuc": sonuc, "kalibrasyon": veri, "kamera": kam}


# AprilTag ile kalibrasyon AYRI BİR DOSYADA ve kendi yönlendiricisinde
# (`etiket.py`). Uç noktalarını buraya yazmak, `main.py` sürekli değiştiği
# için her yamada çakışma demekti; tek satırla bağlanıyor.
app.include_router(etiket.yonlendirici_kur(_parola_dogrula, merkez.canli_kare_taze))
# Satranç tahtasıyla lens kalibrasyonu — aynı gerekçe, ayrı dosya.
# Canlı kare geçiriliyor: `kareler.son` DİSKTEKİ periyodik kareyi veriyor
# ve o aralık saatlik olabiliyor — tahtayı oynatan kullanıcı 25 kez aynı
# eski kareyi eklemişti. Canlı akış bellekte ayrı duruyor.
app.include_router(tahta.yonlendirici_kur(_parola_dogrula, merkez.canli_kare_taze))


# --------------------------------------------------------------------------- #
# Kamera kareleri
# --------------------------------------------------------------------------- #
@app.get("/api/kare/son")
async def api_kare_son(jeton: str = Query(default=""), t: float = Query(default=0),
                       kamera: str = Query(default=kareler.VARSAYILAN_KAMERA)):
    """Bir kameranın en son karesi (JPEG). `t` yalnızca önbellek kırıcı."""
    _parola_dogrula(jeton)
    kam = kareler.ad_temizle(kamera)
    kare = await asyncio.to_thread(kareler.son, kam)
    if kare is None:
        raise HTTPException(status_code=404, detail=f"'{kam}' kamerasından henüz kare yok")
    return Response(content=kare, media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


@app.get("/api/kare/canli")
async def api_kare_canli(jeton: str = Query(default=""), t: float = Query(default=0),
                         kamera: str = Query(default=kareler.VARSAYILAN_KAMERA)):
    """Bir kameranın canlı akışındaki SON kare. `t` yalnızca önbellek kırıcı.

    Diskten değil bellekten okunuyor; canlı kareler saklanmıyor.
    """
    _parola_dogrula(jeton)
    kam = kareler.ad_temizle(kamera)
    kare = merkez.canli_kare_al(kam)
    if not kare:
        raise HTTPException(status_code=404, detail=f"'{kam}' kamerasında canlı akış kapalı")
    return Response(content=kare, media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


@app.get("/api/kare/liste")
async def api_kare_liste(jeton: str = Query(default=""),
                         kamera: str = Query(default="")):
    """Kare künyeleri. `kamera` boşsa hepsi — her kaydın içinde adı yazıyor."""
    _parola_dogrula(jeton)
    return {"kareler": await asyncio.to_thread(kareler.liste, kamera or None)}


@app.get("/api/kare/{damga}")
async def api_kare(damga: str, jeton: str = Query(default=""),
                   kamera: str = Query(default=kareler.VARSAYILAN_KAMERA)):
    _parola_dogrula(jeton)
    kare = await asyncio.to_thread(kareler.getir, damga, kareler.ad_temizle(kamera))
    if kare is None:
        raise HTTPException(status_code=404, detail="Kare bulunamadı")
    return Response(content=kare, media_type="image/jpeg")


@app.get("/api/olcum/konumlu")
async def api_olcum_konumlu(dakika: int = Query(default=1440), azami: int = Query(default=400),
                            jeton: str = Query(default="")):
    """Konumu bilinen toprak nemi ölçümleri — tarla haritasının sensör katmanı.

    Grafik ucundan (`/api/gecmis`) ayrı: orada zaman ekseni var, burada
    yalnızca "nerede, ne okundu" var ve konumu olmayan satırlar hiç
    dönmüyor. Aynı noktada biriken yüzlerce okumadan yalnızca en yenisi
    anlamlı olduğu için konuma göre teklileştiriliyor.
    """
    _parola_dogrula(jeton)
    return {"okumalar": await asyncio.to_thread(depo.konumlu_okumalar, dakika, azami)}


@app.get("/api/katmanlar")
async def api_katmanlar(jeton: str = Query(default="")):
    """Tarla haritasının katman dosyalarını listeler.

    Katman mimarisinin sözü şu: yeni bir katman eklemek TEK DOSYA eklemek
    olsun. Dosya adlarını HTML'e ya da bir listeye elle yazsaydık her katman
    iki yerde kayıtlı olurdu ve biri unutulduğunda katman sessizce
    görünmezdi. Sunucu klasörü okuyor, panel dönen listeyi sırayla yüklüyor.

    Sıra dosya adından geliyor (`10-…`, `20-…`): çizim sırası da katmanın
    kendi dosyasında belli oluyor, ayrı bir sıra tablosu gerekmiyor.
    """
    _parola_dogrula(jeton)
    klasor = os.path.join(_STATIK, "katmanlar")
    try:
        adlar = sorted(a for a in os.listdir(klasor) if a.endswith(".js"))
    except OSError:
        adlar = []
    return {"katmanlar": adlar}


# --------------------------------------------------------------------------- #
# Bitki türleri
#
# Kaynak veri `docs/bitki_turleri.json` — kurtarılmış, SALT OKUNUR. Kullanıcı
# bir değeri değiştirdiğinde kaynağın üstüne yazmıyoruz, ayrı bir dosyaya
# (tur_ezme.json) yazıyoruz; böylece hangi değerin elle konduğu ve neye
# dönüleceği her zaman belli. Ayrıntı: turler.py başlığı.
# --------------------------------------------------------------------------- #
@app.get("/api/turler")
async def api_turler(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return {"turler": await asyncio.to_thread(turler.hepsi),
            "alanlar": turler.alan_bilgisi()}


@app.post("/api/turler")
async def api_turler_kaydet(govde: dict[str, Any], jeton: str = Query(default="")):
    """Tür düzeyinde ezme — o türden EKLENECEK bitkiler de bunu kullanır."""
    _parola_dogrula(jeton)
    slug = str(govde.get("slug") or "").strip()
    alanlar = govde.get("alanlar")
    if not isinstance(alanlar, dict):
        raise HTTPException(status_code=400, detail="alanlar bir nesne olmalı")
    try:
        tur = await asyncio.to_thread(turler.kaydet, slug, alanlar)
    except turler.TurHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    return {"tur": tur}


@app.delete("/api/turler")
async def api_turler_sifirla(slug: str = Query(default=""), alan: str = Query(default=""),
                             jeton: str = Query(default="")):
    """Tek alanı ya da (alan boşsa) türün bütün ezmelerini katalog değerine döndürür."""
    _parola_dogrula(jeton)
    try:
        tur = await asyncio.to_thread(turler.sifirla, slug, alan or None)
    except turler.TurHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    return {"tur": tur}


@app.get("/saglik")
async def saglik():
    """Render'ın servisi ayakta tutmak için çağırdığı uç."""
    return {"ok": True, "ajan_bagli": merkez.durum()["bagli"]}


# Arayüz en sonda bağlanıyor: kök yolu ("/") kaplıyor, önce API yolları
# tanımlı olmalı.


class TazeStatik(StaticFiles):
    """Panel dosyalarını tarayıcı önbelleğine bırakmayan statik sunucu.

    Sahada şu yaşandı: Pi güncellendi, `index.html` yenilendi ama tarayıcı
    `app.js`'in eski kopyasını önbellekten servis etmeye devam etti. Sonuç,
    hata vermeyen ama çalışmayan bir panel oldu — yeni sekme HTML'de vardı,
    onu çalıştıracak kod yoktu. Ctrl+F5 her tarayıcıda her alt kaynağı
    tazelemiyor.

    Panel dosyaları toplam ~900 KB ve yerel ağdan geliyor; önbelleğin
    kazandırdığı milisaniyeler, "güncelledim ama değişmedi" hata ayıklamasının
    yanında hiçbir şey. Kütüphaneler (three.js, chart.js) sürüm damgasıyla
    geldiği için onları uzun süre önbellekte tutmak güvenli.
    """

    KUTUPHANE = ("three.min.js", "chart.umd.js")

    def file_response(self, *args, **kwargs):  # type: ignore[override]
        yanit = super().file_response(*args, **kwargs)
        yol = str(getattr(yanit, "path", ""))
        if yol.endswith(self.KUTUPHANE):
            yanit.headers["Cache-Control"] = "public, max-age=604800, immutable"
        else:
            yanit.headers["Cache-Control"] = "no-store, must-revalidate"
        return yanit


# --------------------------------------------------------------------------- #
# BAHÇE MODU
#
# Kullanıcı katmanı. Teknik panel olduğu gibi duruyor; burası bahçeyle
# uğraşan ama robotla uğraşmak istemeyen biri için ayrı bir görünüm.
#
# TEK GERÇEK. Bu uçlar yeni bir depo açmıyor: bitkiler nokta deposundan,
# tür bilgisi katalogdan, nem sensörden, alanlar dikimden geliyor. Yazma da
# aynı yerlere — sulama `/api/toplu` ile, ekim aynı ekim akışıyla. Panelde
# ne yazıyorsa bahçede de o yazıyor, çünkü ikisi aynı satırı okuyor.
#
# SORU SORULMUYOR. Bahçe hiçbir iş için kullanıcıyı bekletmiyor: iş kuyruğa
# giriyor, kullanıcı devam ediyor, makine sırayla yapıyor. Kuyruk güvenliği
# aşmıyor — her iş yine `/api/toplu`dan, yani aynı çözümleme ve aynı yasak
# bölge ön kontrolünden geçiyor.
# --------------------------------------------------------------------------- #
kuyruk = kuyruk_modul.Kuyruk()

# Arşiv tarayıcısı bu sıklıkta bakıyor: "kimin karesi geldi" sorusu ucuz
# (klasör okuma), kırpma pahalı ve zaten bitki başına günde bir oluyor.
ARSIV_BAKMA_SN = 300.0


def _bahce_tur_indeks() -> dict[str, Any]:
    return {t.get("slug"): t for t in turler.hepsi()}


def _bahce_okumalar() -> list[dict[str, Any]]:
    """Konumlu toprak nemi okumaları — sulamanın kullandığı pencere."""
    try:
        return depo.konumlu_okumalar(dakika=int(sulama.NEM_AZAMI_YAS_SN // 60),
                                     azami=400)
    except Exception:
        logger.exception("Bahçe: nem okumaları alınamadı")
        return []


def _bahce_veri() -> dict[str, Any]:
    """Bahçe ekranının bütün anlık görüntüsü — TEK çağrıda.

    Parça parça çekmek, ekranın bir yerinde eski bir sayının durması
    demekti: bitkiler yenilenmiş, kartlar eskiye göre yazılmış. Tek
    görüntü, tek an.
    """
    simdi = time.time()
    hepsi = noktalar.hepsi()
    tur_indeks = _bahce_tur_indeks()
    yaricaplar, _ = _yaricaplar(bahce.bitkiler(hepsi))
    okumalar = _bahce_okumalar()
    durum = merkez.durum()
    toprak_kalib = durum.get("toprak_kalib") or {}
    alanlar = dikim.listele()
    sinirlar = durum.get("sinirlar") or {}
    ertelenmis = bahce.ertelemeler(simdi)

    ars = arsiv.ozet()          # arşiv TEK kez taranıyor (ve önbellekli)
    # SUSAMA VE HASAT BİR KEZ HESAPLANIYOR. Tahtadaki damla ile kartın
    # saydığı bitkiler aynı sözlükten okunuyor; ikisi ayrı hesaplandığında
    # "4 bitki susadı" yazarken tahtada üç damla olması işten bile değil.
    durumlar: dict[str, dict[str, Any]] = {}
    liste = []
    for b in bahce.bitkiler(hepsi):
        tur = tur_indeks.get(str(b.get("tur") or "")) or {}
        su = bahce.susama_durumu(b, tur, okumalar, toprak_kalib, simdi)
        hasat = bahce.hasat_durumu(b, tur, simdi)
        durumlar[str(b.get("ad"))] = {"su": su, "hasat": hasat}
        kimlik = arsiv.film_kimlik(b)
        liste.append({
            "ad": b.get("ad"), "x": b.get("x"), "y": b.get("y"), "z": b.get("z"),
            "tur": b.get("tur"),
            "tur_ad": tur.get("name_tr") or b.get("tur"),
            "simge": tur.get("icon") or "🌱",
            "renk": tur.get("color") or "#7bbf5a",
            "ekim": b.get("ekim"), "sulama_ts": b.get("sulama_ts"),
            "yaricap_mm": yaricaplar.get(b.get("ad"), 0.0),
            "yayilim_mm": _sayi_guvenli(tur.get("spread_mm")),
            "susadi": su["susadi"], "su_gerekce": su["gerekce"],
            "su_kanit": su["kanit"], "nem_yuzde": su.get("nem_yuzde"),
            "su_olcum": su.get("olcum"), "su_tahmin": bool(su.get("tahmin")),
            "hasat": hasat["hazir"], "hasat_gerekce": hasat["gerekce"],
            "yas_gun": hasat.get("gun"), "olgun_gun": hasat.get("olgun"),
            "olgunluk": hasat.get("oran"),
            "film_kimlik": kimlik,
            "film_kare": int((ars["filmler"].get(kimlik) or {}).get("adet") or 0),
        })

    # Çakışma: iki bitkinin yayılım çemberi kesişiyorsa ikisi de işaretli.
    for i, a in enumerate(liste):
        for b2 in liste[i + 1:]:
            d = math.hypot(_sayi_guvenli(a["x"]) - _sayi_guvenli(b2["x"]),
                           _sayi_guvenli(a["y"]) - _sayi_guvenli(b2["y"]))
            if d < (a["yaricap_mm"] + b2["yaricap_mm"]):
                a["cakisik"] = b2["cakisik"] = True
    for b in liste:
        b.setdefault("cakisik", False)

    kalib = kalibrasyon.oku("ust")
    baslik = _baslik_oku()
    gunler = bahce.ilgi_gunleri(hepsi, ars["gunler"])

    return {
        "bitkiler": liste,
        "kartlar": bahce.kartlar(hepsi, tur_indeks, yaricaplar, alanlar,
                                 durumlar, _bahce_hazne_turleri(),
                                 sinirlar, simdi, ertelenmis),
        "ertelenmis": [{"kimlik": k, "kadar": v, "yazi": bahce.saat_yaz(v)}
                       for k, v in sorted(ertelenmis.items(), key=lambda p: p[1])],
        "seri": bahce.seri(gunler, simdi),
        "kuyruk": kuyruk.goruntu(),
        "turler": [{"slug": t.get("slug"), "ad": t.get("name_tr"),
                    "simge": t.get("icon"), "renk": t.get("color"),
                    "yayilim_mm": t.get("spread_mm"),
                    "olgun_gun": t.get("days_to_harvest")}
                   for t in turler.hepsi()],
        "kamera": {
            "ad": "ust",
            "kalibre": float(kalib.get("mm_px") or 0) > 0,
            "kalibrasyon": kalib,
            "etiket": _kamera_etiket("ust"),
            "kare_var": kareler.son_kayit("ust") is not None,
        },
        "alanlar": alanlar,
        "sinirlar": sinirlar,
        "sulama_basligi": baslik,
        # ÜÇ BAŞ VE HER BİRİNİN ERİŞEBİLDİĞİ ALAN. Bahçedeki taralı gölge
        # o an hangi işin yapılacağına göre çiziliyor: sulama başlığı
        # 60 mm yanda olduğu için kenarda suyun gidemediği bir şerit var
        # ve her başın kendi şeridi.
        "baslar": {
            k: {**v,
                "ad": baslar.BAS_ADI.get(k, k),
                "erisim": baslar.erisim(v, sinirlar)}
            for k, v in baslar.hepsi(merkez.son_durum or {}).items()},
        "is_basi": baslar.IS_BASI,
        "tohum_ucu": (merkez.son_durum or {}).get("tohum_ucu") or {},
        "bolgeler": durum.get("bolgeler") or [],
        "konum": durum.get("konum") or {},
        "ekim": _bahce_ekim_ozet(),
        "mesgul": _bahce_mesgul(),
        "bagli": bool(durum.get("bagli")),
        "arsiv_bayt": int(ars["bayt"]),
        "ts": simdi,
    }


def _bahce_hazne_turleri() -> list[str]:
    """Haznede TOHUMU OLAN türler — ekim akışının kendi gözlerinden.

    Ayrı bir liste tutmuyoruz: ekim reddini doğuran veri neyse, kartın
    "bu tür haznede var" demesini sağlayan veri de o. İkisi ayrışsaydı kart
    "ek" der, makine "bu türe ayrılmış hazne yok" derdi.
    """
    gozler = ((merkez.son_durum or {}).get("uc") or {}).get("tohumluk_gozleri") or []
    cikti: list[str] = []
    for g in (gozler or []):
        if not isinstance(g, dict) or not g.get("dolu"):
            continue
        s = str(g.get("tohum") or "").strip()
        if s and s not in cikti:
            cikti.append(s)
    return cikti


def _bahce_ekim_ozet() -> dict[str, Any]:
    """Ekim oturumunun bahçe diliyle özeti.

    EKİM AKIŞINA DOKUNMUYORUZ. "Tohum ucta mı" onayı duruyor ve durmalı:
    makinenin tohumu gerçekten aldığını doğrulayan tek şey o. Bahçe modu
    kullanıcıya soru sormuyor ama makinenin BEKLEDİĞİNİ de gizlemiyor —
    onayı bir soru kutusu olarak değil, kuyruk şeridinde tek bir düğme
    olarak gösteriyor. Kullanıcı basana kadar başka işine devam edebilir;
    kimse ekranın ortasında bir soruyla kilitlenmiyor.
    """
    g = _ekim.goruntu()
    if not g.get("aktif"):
        return {"aktif": False, "onay": "", "soru": "", "sira": 0, "toplam": 0}
    soru = {
        "onay2": "Robot tohumu aldı. Ucunda duruyorsa devam ettirin.",
    }.get(str(g.get("durum") or ""), "")
    return {
        "aktif": True,
        "onay": str(g.get("durum") or "") if soru else "",
        "soru": soru,
        "sira": g.get("sira") or 0,
        "toplam": g.get("toplam") or 0,
        "tur_ad": g.get("tur_ad") or "",
    }


@app.post("/api/bahce/onay")
async def api_bahce_onay(govde: dict[str, Any], jeton: str = Query(default="")):
    """Bekleyen ekim onayını geçer — mevcut onay ucunun aynısına gidiyor."""
    _parola_dogrula(jeton)
    return await api_ekim_onayla(govde or {}, jeton=jeton)


def _sayi_guvenli(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
        return s if math.isfinite(s) else varsayilan
    except (TypeError, ValueError):
        return varsayilan


def _bahce_mesgul() -> bool:
    """Makine şu an bir iş yapıyor mu — kuyruğun beklemesi gereken hâl."""
    d = merkez.durum()
    if not d.get("bagli"):
        return True
    if (d.get("dizi") or {}).get("calisiyor"):
        return True
    if d.get("hareket"):
        return True
    return bool(_ekim.goruntu().get("aktif"))


@app.get("/api/bahce")
async def api_bahce(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return await asyncio.to_thread(_bahce_veri)


@app.post("/api/bahce/is")
async def api_bahce_is(govde: dict[str, Any], jeton: str = Query(default="")):
    """Kuyruğa iş koyar ve HEMEN döner — kullanıcı beklemiyor."""
    _parola_dogrula(jeton)
    tip = str(govde.get("tip") or "")
    adlar = [str(a) for a in (govde.get("noktalar") or []) if str(a).strip()]
    if tip not in ("sula", "ek", "gez", "foto", "nem"):
        raise HTTPException(status_code=400, detail=f"Bilinmeyen iş: {tip!r}")
    if not adlar:
        raise HTTPException(status_code=400, detail="İş için nokta gerekiyor")
    if len(adlar) > AZAMI_SECIM:
        raise HTTPException(status_code=400,
                            detail=f"Tek işte en fazla {AZAMI_SECIM} bitki olabilir")
    etiketler = {"sula": "Sulama", "ek": "Ekim", "gez": "Ziyaret",
                 "foto": "Fotoğraf", "nem": "Nem ölçümü"}
    try:
        kayit = kuyruk.ekle(tip, f"{etiketler[tip]} · {len(adlar)} bitki", adlar,
                            {"saniye": govde.get("saniye")})
    except kuyruk_modul.KuyrukDolu as hata:
        raise HTTPException(status_code=429, detail=str(hata))
    await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
    return {"ok": True, "is": kuyruk.goruntu()["isler"][-1],
            "kuyruk": kuyruk.goruntu()}


@app.post("/api/bahce/is/iptal")
async def api_bahce_is_iptal(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    kimlik = str(govde.get("kimlik") or "")
    if kimlik == "hepsi":
        n = kuyruk.hepsini_iptal()
        await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
        return {"ok": True, "iptal": n, "kuyruk": kuyruk.goruntu()}
    if not kuyruk.iptal(kimlik):
        raise HTTPException(
            status_code=409,
            detail="Bu iş iptal edilemiyor — ya çalışıyor ya da çoktan bitti. "
                   "Çalışan bir işi durdurmak için teknik paneldeki Dur.")
    await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
    return {"ok": True, "kuyruk": kuyruk.goruntu()}


@app.post("/api/bahce/ek")
async def api_bahce_ek(govde: dict[str, Any], jeton: str = Query(default="")):
    """Tohum bırakma: noktayı yaratır, ekimi kuyruğa koyar.

    İki adım tek istekte, çünkü kullanıcı için tek hareket: tohumu toprağa
    bıraktı. Nokta önce yaratılıyor ki ekran hemen filizi gösterebilsin;
    ekim kuyruğa giriyor ve makine sırası gelince gerçekten ekiyor.
    """
    _parola_dogrula(jeton)
    slug = str(govde.get("tur") or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="Tür gerekiyor")
    if not any(t.get("slug") == slug for t in turler.hepsi()):
        raise HTTPException(status_code=404, detail=f"'{slug}' diye bir tür yok")
    yerler = govde.get("yerler")
    if not yerler:
        yerler = [{"x": govde.get("x"), "y": govde.get("y")}]
    if len(yerler) > AZAMI_SECIM:
        raise HTTPException(status_code=400,
                            detail=f"Tek seferde en fazla {AZAMI_SECIM} tohum")

    alanlar = await asyncio.to_thread(dikim.listele)
    guvenli_z = _sayi_guvenli(merkez.durum().get("guvenli_z"), 0.0)
    yeni, ret = [], []
    for yer in yerler:
        x, y = _sayi_guvenli(yer.get("x")), _sayi_guvenli(yer.get("y"))
        kabul, gerekce, _ = dikim.nokta_kabul(x, y, alanlar)
        if not kabul:
            ret.append({"x": x, "y": y, "sebep": gerekce})
            continue
        ad = await asyncio.to_thread(_bahce_ad_uret, slug)
        try:
            kayit = await asyncio.to_thread(
                noktalar.ekle, ad, x, y, guvenli_z, False, "bitki",
                {"tur": slug, "ekim": time.time()})
        except noktalar.NoktaHatasi as hata:
            ret.append({"x": x, "y": y, "sebep": str(hata)})
            continue
        yeni.append(kayit)

    if not yeni:
        raise HTTPException(
            status_code=422,
            detail="Buraya ekilemiyor — " + (ret[0]["sebep"] if ret else "sebep yok"))

    adlar = [str(n.get("ad")) for n in yeni]
    try:
        kuyruk.ekle("ek", f"Ekim · {len(adlar)} tohum", adlar)
    except kuyruk_modul.KuyrukDolu as hata:
        # Nokta yaratıldı ama iş sıraya girmedi: kullanıcıya söylüyoruz,
        # sessizce yutmuyoruz. Nokta duruyor, sonra elle ekilebilir.
        raise HTTPException(status_code=429, detail=str(hata))
    await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
    return {"ok": True, "noktalar": yeni, "ret": ret, "kuyruk": kuyruk.goruntu()}


def _bahce_ad_uret(slug: str) -> str:
    """Çakışmayan bir nokta adı: `marul-3` gibi."""
    var = {str(n.get("ad")) for n in noktalar.hepsi()}
    kok = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")[:24] or "bitki"
    for i in range(1, 9999):
        ad = f"{kok}-{i}"
        if ad not in var:
            return ad
    raise HTTPException(status_code=409, detail="Boş nokta adı bulunamadı")


async def _bahce_yayinla() -> None:
    """Bahçenin değiştiğini bütün panellere duyur.

    Paket "değişti" haberinden ibaret; panel kendi çekiyor. İki tarayıcı
    açıksa birinde ertelenen kart ötekinde de kalkıyor — aynı bahçe.
    """
    await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu(),
                          "tazele": True})


@app.get("/api/bahce/bos-yer")
async def api_bahce_bos_yer(tur: str = Query(default=""), jeton: str = Query(default="")):
    """Seçilen TÜRE göre kaç boş yer var — türü kullanıcı seçiyor.

    Sayı türe göre gerçekten değişiyor: marulun yayılımı 250 mm, rokanınki
    150 mm; aynı yatakta biri altı, öteki on iki tane alıyor. Bu ucu ayrı
    tuttuk ki tür değiştikçe bütün bahçe görüntüsünü yeniden çekmeyelim.
    """
    _parola_dogrula(jeton)
    slug = str(tur or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="Tür gerekiyor")

    def _hesapla() -> dict[str, Any]:
        tur_indeks = _bahce_tur_indeks()
        t = tur_indeks.get(slug)
        if not t:
            raise HTTPException(status_code=404, detail=f"'{slug}' diye bir tür yok")
        yayilim = _sayi_guvenli(t.get("spread_mm"), 0.0)
        if yayilim <= 0:
            raise HTTPException(
                status_code=422,
                detail=f"{t.get('name_tr') or slug} için yayılım çapı yazılı değil — "
                       f"kaç tane sığdığını hesaplayamam")
        hepsi = noktalar.hepsi()
        yaricaplar, _ = _yaricaplar(bahce.bitkiler(hepsi))
        durum = merkez.durum()
        yerler = bahce.bos_yerler(hepsi, yaricaplar, dikim.listele(), yayilim,
                                  durum.get("sinirlar") or {})
        return {
            "tur": slug,
            "ad": t.get("name_tr") or slug,
            "simge": t.get("icon") or "🌱",
            "yayilim_mm": round(yayilim, 1),
            "adet": len(yerler),
            "sinirda": len(yerler) >= bahce.AZAMI_ONERI,
            "hazne": slug in _bahce_hazne_turleri(),
            "yerler": yerler,
        }

    return await asyncio.to_thread(_hesapla)


@app.post("/api/bahce/ertele")
async def api_bahce_ertele(govde: dict[str, Any], jeton: str = Query(default="")):
    """Kartı yarın sabaha ertele ya da ertelemeyi geri al.

    Eski "Sonra" düğmesi kartı yalnız ekrandan siliyordu ve sayfa
    yenilenince geri geliyordu: kullanıcı erteledi mi, iptal mi etti,
    bir daha sorulacak mı bilmiyordu. Şimdi net bir sözü var.
    """
    _parola_dogrula(jeton)
    kimlik = str(govde.get("kimlik") or "").strip()
    if not kimlik:
        raise HTTPException(status_code=400, detail="Kart kimliği gerekiyor")
    if govde.get("iptal"):
        await asyncio.to_thread(bahce.erteleme_kaldir, kimlik)
        await _bahce_yayinla()
        return {"kimlik": kimlik, "ertelendi": None, "yazi": ""}
    kadar = await asyncio.to_thread(bahce.ertele, kimlik, None)
    await _bahce_yayinla()
    return {"kimlik": kimlik, "ertelendi": kadar, "yazi": bahce.saat_yaz(kadar)}


@app.post("/api/bahce/esik")
async def api_bahce_esik(govde: dict[str, Any], jeton: str = Query(default="")):
    """Sulama nem eşiğini bahçeden değiştir — TÜR EZMESİ olarak.

    Yeni bir ayar mekanizması kurmuyoruz: eşik zaten tür ezmelerinde
    (`tur_ezme.json`) duruyor ve teknik panelden de oradan düzenleniyor.
    Bahçe aynı yere yazıyor, yoksa iki yerde iki farklı eşik olurdu.

    Bitkinin KENDİ `ozel.sulama_nem_esigi` değeri tür ezmesini yener; böyle
    bitkiler varsa cevapta adlarıyla dönüyorlar. Sessizce yazıp "oldu"
    demek, kullanıcıya değişmeyen bir sayıyı değişmiş gibi göstermek olurdu.
    """
    _parola_dogrula(jeton)
    yuzde = _sayi_guvenli(govde.get("yuzde"), -1.0)
    if not 0.0 <= yuzde <= 100.0:
        raise HTTPException(status_code=400,
                            detail="Eşik %0 ile %100 arasında olmalı (100 = kapalı)")
    slugler = [str(s).strip() for s in (govde.get("turler") or []) if str(s).strip()]
    if not slugler:
        raise HTTPException(status_code=400, detail="En az bir tür gerekiyor")

    def _yaz() -> dict[str, Any]:
        yazilan, hata = [], []
        for slug in slugler:
            try:
                turler.kaydet(slug, {"sulama_nem_esigi": yuzde})
                yazilan.append(slug)
            except turler.TurHatasi as h:
                hata.append(f"{slug}: {h}")
        # Kendi eşiği olan bitkiler tür ezmesinden etkilenmiyor.
        kendi = [str(n.get("ad")) for n in bahce.bitkiler(noktalar.hepsi())
                 if str(n.get("tur") or "") in slugler
                 and (n.get("ozel") or {}).get("sulama_nem_esigi") not in (None, "")]
        return {"turler": yazilan, "hata": hata, "kendi_esigi_olan": kendi,
                "yuzde": yuzde}

    sonuc = await asyncio.to_thread(_yaz)
    if not sonuc["turler"]:
        raise HTTPException(status_code=422,
                            detail="Eşik yazılamadı — " + "; ".join(sonuc["hata"]))
    await _bahce_yayinla()
    return sonuc


@app.post("/api/bahce/tasi")
async def api_bahce_tasi(govde: dict[str, Any], jeton: str = Query(default="")):
    """Bitkiyi yeni yerine taşır — KAYIT işlemi, makine hareket etmiyor.

    Bitkinin BÜTÜN kaydı okunup geri yazılıyor, yalnız x/y değişiyor.
    Panelden gelen alanlarla yeniden kurmak, gönderilmeyen her alanı
    (ekim tarihi, bağlı eğriler, tür ezmeleri) sessizce silerdi — ve
    silindiği ancak haftalar sonra fark edilirdi.
    """
    _parola_dogrula(jeton)
    ad = str(govde.get("ad") or "").strip()
    x, y = _sayi_guvenli(govde.get("x")), _sayi_guvenli(govde.get("y"))
    mevcut = next((n for n in await asyncio.to_thread(noktalar.hepsi)
                   if str(n.get("ad")) == ad), None)
    if mevcut is None:
        raise HTTPException(status_code=404, detail=f"'{ad}' diye bir bitki yok")

    durum = merkez.durum()
    s = durum.get("sinirlar") or {}
    sx, sy = s.get("x") or {}, s.get("y") or {}
    if not (_sayi_guvenli(sx.get("min"), 0) <= x <= _sayi_guvenli(sx.get("max"), 1e9)
            and _sayi_guvenli(sy.get("min"), 0) <= y <= _sayi_guvenli(sy.get("max"), 1e9)):
        raise HTTPException(status_code=422,
                            detail="Orası yatağın dışında kalıyor.")
    alanlar = await asyncio.to_thread(dikim.listele)
    if alanlar:
        kabul, gerekce, _ = dikim.nokta_kabul(x, y, alanlar)
        if not kabul:
            raise HTTPException(status_code=422, detail=f"Oraya taşınamıyor — {gerekce}")

    yeni = dict(mevcut)
    yeni["x"], yeni["y"] = round(x, 1), round(y, 1)
    ekstra = {k: v for k, v in yeni.items()
              if k not in ("ad", "x", "y", "z", "etiket", "ts")}
    kayit = await asyncio.to_thread(
        noktalar.ekle, ad, yeni["x"], yeni["y"], _sayi_guvenli(yeni.get("z")),
        True, str(yeni.get("etiket") or "bitki"), ekstra)
    await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
    return {"ok": True, "nokta": kayit}


@app.post("/api/bahce/yakin")
async def api_bahce_yakin(govde: dict[str, Any], jeton: str = Query(default="")):
    """"Yakından bak": makineyi bitkinin üstüne götürür.

    Uç kamerası kafada duruyor; makine oraya gidince kamera bitkiyi
    yukarıdan yakın görüyor. Bu bir FOTOĞRAF işi değil — çekilen kare
    büyüme filmine GİRMİYOR. Girseydi filmde iki farklı ölçek karışır ve
    büyüme yerine zıplama görünürdü; film yalnız üst kameradan.
    """
    _parola_dogrula(jeton)
    ad = str(govde.get("ad") or "").strip()
    if not any(str(n.get("ad")) == ad for n in await asyncio.to_thread(noktalar.hepsi)):
        raise HTTPException(status_code=404, detail=f"'{ad}' diye bir bitki yok")
    try:
        kuyruk.ekle("gez", f"Yakından bakma · {ad}", [ad], {"yakin": True})
    except kuyruk_modul.KuyrukDolu as hata:
        raise HTTPException(status_code=429, detail=str(hata))
    await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
    return {"ok": True, "kuyruk": kuyruk.goruntu()}


@app.post("/api/bahce/hasat")
async def api_bahce_hasat(govde: dict[str, Any], jeton: str = Query(default="")):
    """Hasat KAYITTIR, hareket değil.

    Makine hasat edemiyor — toplayan kullanıcı. Yaptığımız şey bitkiyi
    yataktan düşürmek, yani yeri boşaltmak. Fotoğraf filmi silinmiyor:
    bitkinin hikâyesi hasattan sonra da duruyor. 30 saniyelik geri alma
    penceresi mevcut geri alma yolunun aynısı.
    """
    _parola_dogrula(jeton)
    adlar = [str(a) for a in (govde.get("noktalar") or []) if str(a).strip()]
    if not adlar:
        raise HTTPException(status_code=400, detail="Seçim boş")
    silinen = await asyncio.to_thread(noktalar.sil_coklu, adlar)
    if not silinen:
        raise HTTPException(status_code=404, detail="Bitki bulunamadı")
    parti = geri_al.ekle(silinen, f"{len(silinen)} bitki hasat edildi")
    await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
    return {"ok": True, "hasat": [n.get("ad") for n in silinen], "geri_al": parti,
            "mesaj": f"{len(silinen)} bitki hasat edildi"}


# --------------------------------------------------------------------------- #
# Büyüme filmi
# --------------------------------------------------------------------------- #
@app.get("/api/bahce/film")
async def api_bahce_film(kimlik: str = Query(default=""), jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    if not kimlik:
        return {"filmler": await asyncio.to_thread(arsiv.filmler),
                "bayt": await asyncio.to_thread(arsiv.toplam_bayt)}
    liste = await asyncio.to_thread(arsiv.kareler_listesi, kimlik)
    return {"kimlik": kimlik, "kareler": liste, "adet": len(liste),
            "aralik_sn": arsiv.ARALIK_SN}


@app.get("/api/bahce/film/kare")
async def api_bahce_film_kare(kimlik: str = Query(...), damga: str = Query(...),
                              jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    veri = await asyncio.to_thread(arsiv.kare_oku, kimlik, damga)
    if not veri:
        raise HTTPException(status_code=404, detail="Kare yok")
    return Response(content=veri, media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=86400"})


@app.post("/api/bahce/foto")
async def api_bahce_foto(govde: dict[str, Any], jeton: str = Query(default="")):
    """Şimdi kare çek — kullanıcı "Fotoğraf"a bastığında.

    Makine hareket etmiyor: üst kamera zaten yatağın tamamını görüyor ve
    filmin tutarlı olması için bütün kareler AYNI kameradan gelmeli. Uç
    kamerasıyla yakın çekim yapsaydık filmde iki farklı ölçek karışır ve
    büyüme yerine zıplama görünürdü.
    """
    _parola_dogrula(jeton)
    adlar = [str(a) for a in (govde.get("noktalar") or []) if str(a).strip()]
    sonuc = await asyncio.to_thread(_bahce_foto_cek, adlar, True)
    if not sonuc["ok"]:
        raise HTTPException(status_code=409, detail=_ARSIV_SEBEP.get(
            sonuc["sebep"], "Fotoğraf çekilemedi"))
    await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
    return sonuc


_ARSIV_SEBEP = {
    "kalibrasyon-yok": ("Üst kamera kalibre edilmemiş — karenin hangi "
                        "milimetreye denk geldiği bilinmeden kırpılamıyor. "
                        "Kamera sekmesinden ölçek verin."),
    "kare-yok": "Üst kameradan henüz kare gelmedi.",
    "kutuphane-yok": ("Fotoğraf arşivi için numpy ve Pillow gerekiyor. "
                      "Pi'de: sunucu/.venv/bin/pip install numpy Pillow"),
}


def _bahce_foto_cek(adlar: list[str] | None = None, zorla: bool = False) -> dict[str, Any]:
    yuklu = _goruntu_yukle()
    if not yuklu:
        return {"ok": False, "sebep": "kutuphane-yok", "cekilen": [], "atlanan": []}
    _, _, _, Image = yuklu
    hepsi = bahce.bitkiler(noktalar.hepsi())
    if adlar:
        istenen = set(adlar)
        hepsi = [b for b in hepsi if str(b.get("ad")) in istenen]
    if not hepsi:
        return {"ok": True, "sebep": "", "cekilen": [], "atlanan": []}
    return arsiv.cek(hepsi, _bahce_tur_indeks(), kalibrasyon.oku("ust"), Image,
                     kamera="ust", zorla=zorla)


# --------------------------------------------------------------------------- #
# Kuyruk işçisi
# --------------------------------------------------------------------------- #
async def _kuyruk_dongusu() -> None:
    """Makine boşaldıkça sıradaki işi başlatır.

    İşi ÇALIŞTIRAN kod burada değil: her iş mevcut `/api/toplu` yolundan
    geçiyor, yani aynı çözümleme, aynı yasak bölge ön kontrolü, aynı
    sınır denetimi. Kuyruk bir kestirme değil, bir bekleme odası.
    """
    while True:
        try:
            await asyncio.sleep(0.5)
            is_ = kuyruk.sonraki()
            if is_ is None or _bahce_mesgul():
                continue
            kuyruk.basladi(is_["kimlik"])
            await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
            try:
                mesaj = await _kuyruk_calistir(is_)
                kuyruk.bitti(is_["kimlik"], mesaj)
            except HTTPException as hata:
                kuyruk.hata(is_["kimlik"], str(hata.detail))
                await merkez.yayinla({
                    "tip": "gunluk", "seviye": "hata",
                    "metin": f"Bahçe · {is_['etiket']}: {hata.detail}"})
            except Exception as hata:            # beklenmedik — kuyruk durmasın
                logger.exception("Kuyruk işi patladı")
                kuyruk.hata(is_["kimlik"], str(hata))
            await merkez.yayinla({"tip": "bahce", "kuyruk": kuyruk.goruntu()})
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Kuyruk döngüsü")
            await asyncio.sleep(2)


async def _kuyruk_calistir(is_: dict[str, Any]) -> str:
    tip, adlar = is_["tip"], is_["noktalar"]
    if tip == "foto":
        sonuc = await asyncio.to_thread(_bahce_foto_cek, adlar, True)
        if not sonuc["ok"]:
            raise HTTPException(status_code=409,
                                detail=_ARSIV_SEBEP.get(sonuc["sebep"], "çekilemedi"))
        return f"{len(sonuc['cekilen'])} fotoğraf"
    govde: dict[str, Any] = {"islem": tip, "noktalar": adlar}
    if tip == "sula":
        govde["saniye"] = is_["veri"].get("saniye") or 3
    await api_toplu(govde, jeton=PANEL_PAROLA)
    # Dizi başladı; bitmesini bekliyoruz ki sıradaki iş üstüne binmesin.
    await _dizi_bitmesini_bekle()
    return {"sula": "sulandı", "ek": "ekildi", "gez": "gidildi",
            "nem": "nem ölçüldü"}.get(tip, "bitti")


async def _dizi_bitmesini_bekle(azami_sn: float = 900.0) -> None:
    """Çalışan dizi/ekim bitene kadar bekler.

    Önce BAŞLAMASINI bekliyoruz: `dizi_baslat` komutu döndüğünde ajanın
    durum paketi henüz "çalışıyor" demiyor olabilir ve hemen bakarsak
    "bitti" sanıp sıradaki işi üstüne yollarız. Bu yarış sahada bir kez
    yaşandı (bkz. ekim akış testi).
    """
    basla = time.time()
    while time.time() - basla < 5.0:
        if _bahce_mesgul():
            break
        await asyncio.sleep(0.2)
    while time.time() - basla < azami_sn:
        if not _bahce_mesgul():
            return
        await asyncio.sleep(0.4)
    logger.warning("Kuyruk: iş %.0f sn'de bitmedi, sıradakine geçiliyor", azami_sn)


async def _arsiv_dongusu() -> None:
    """Günde bir, her bitkinin fotoğrafını kendiliğinden arşivler.

    Kullanıcı düğmeye basmasa da film birikiyor: büyüme filminin değeri
    tam olarak "hiç uğraşmadan geriye bakabilmek".
    """
    while True:
        try:
            await asyncio.sleep(ARSIV_BAKMA_SN)
            if _bahce_mesgul():
                continue
            sonuc = await asyncio.to_thread(_bahce_foto_cek, None, False)
            if sonuc.get("cekilen"):
                logger.info("Bahçe arşivi: %d kare", len(sonuc["cekilen"]))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Arşiv döngüsü")


def _surum_oku() -> str:
    """Çalışan kodun git commit'i — panelde göstermek için.

    NEDEN VAR: "güncelledim ama değişmedi" üç kez yaşandı ve her seferinde
    kodun mu yoksa tarayıcının mı geride kaldığını tahmin etmek zorunda
    kaldık. Panelde yazan commit, terminaldeki `git log` ile aynıysa
    tarayıcı günceldir — tahmin bitiyor.

    Süreç başlarken bir kez okunuyor: her istekte git çağırmak, saniyede
    birkaç durum isteği alan bir panelde gereksiz yük.
    """
    try:
        depo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cikti = subprocess.run(
            ["git", "-C", depo, "log", "--oneline", "-1"],
            capture_output=True, text=True, timeout=5)
        return (cikti.stdout or "").strip()[:80] or "bilinmiyor"
    except Exception:
        # Git yoksa ya da depo değilse panel yine çalışmalı.
        return "bilinmiyor"


SURUM = _surum_oku()


@app.get("/api/surum")
async def api_surum():
    return {"surum": SURUM}


app.mount("/statik", TazeStatik(directory=_STATIK), name="statik")


@app.get("/")
async def anasayfa():
    yanit = FileResponse(os.path.join(_STATIK, "index.html"))
    yanit.headers["Cache-Control"] = "no-store, must-revalidate"
    return yanit
