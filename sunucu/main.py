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

import depo
import dikim
import egriler
import ekim
import geri_al
import kalibrasyon
import kareler
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
    "hiz_eksen",     # {"x":60,"y":null,"z":8} — eksen başına; null = genel hız
    "kalibrasyon_kaydet",  # {"eksenler":[{home,min,max}x3]} — cpm/dir hariç
    "bolge_listele", # {}                            — ajandaki yasak bölgeler
    "bolge_kaydet",  # {"bolgeler":[…]}              — doğrular, dosyaya yazar
    "uc_listele",    # {}                            — uç ayarları ve dizi durumu
    "uc_kaydet",     # {"ayar":{…}}
    "uc_al",         # {"ad":"tool1"}                — yandan yaklaşımlı alma dizisi
    "uc_birak",      # {}
    "uc_degistir",   # {"ad":"tool3"}
    "uc_onizle",     # {"islem":"al"|"birak","ad":"tool1"} — yolu koordinatla göster
    "uc_yollari",    # {}                            — HER ucun al/bırak yolu
    "uc_durum_temizle",  # {}                        — takılı uç kaydını sıfırla
    "goz_isaretle",  # {"ad":"s1","dolu":false,"tohum":"marul"} — tohumluk gözü
    "nokta_denetle", # {"noktalar":[{x,y,z}…]}      — yasak bölge + sınır ÖN kontrolü
    "dizi_baslat",   # {"ad":…,"adimlar":[…],"tekrar":1} — çözülmüş adımlarla
    "dizi_durdur",   # {}
    "kamera",        # {"acik": true|false, "aralik_sn": 3600}
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
        # Canlı akışın son karesi — BELLEKTE, diskte değil. Tek kare tutuluyor:
        # canlı akışın geçmişi yok, "şu an ne görünüyor" sorusunun cevabı var.
        self.canli_kare: bytes = b""
        self.canli_ts: float = 0.0
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

    def canli_kare_yaz(self, b64: str, ts: float) -> None:
        """Canlı kareyi belleğe alır. Bozuk ya da aşırı büyük kare atılıyor:
        `kareler.ekle` diskte aynı korumayı yapıyor, bellekte de gerekiyor."""
        try:
            ham = base64.b64decode(b64 or "", validate=True)
        except Exception:
            return
        if not ham or len(ham) > kareler.AZAMI_BAYT:
            return
        self.canli_kare = ham
        self.canli_ts = ts

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
    gorev = asyncio.create_task(_budama_dongusu())
    logger.info("Sunucu hazır. Panel parolası: %s", "var" if PANEL_PAROLA else "yok (açık)")
    yield
    gorev.cancel()


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
                ts = float(mesaj.get("ts", time.time()))
                await asyncio.to_thread(kareler.ekle, mesaj.get("veri", ""), ts,
                                        mesaj.get("konum"))
                await merkez.yayinla({"tip": "kare", "ts": ts})

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
                merkez.canli_kare_yaz(mesaj.get("veri", ""), ts)
                await merkez.yayinla({"tip": "canli", "ts": ts})

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

        if cozum["onay"]:
            return await _ekim_onayli_baslat(cozum)

        return await merkez.komut_gonder("dizi_baslat", {
            "ad": f"Ekim: {cozum['tohum_sayisi']} tohum",
            "adimlar": cozum["adimlar"], "tekrar": 1, "hiz": govde.get("hiz"),
        })

    if islem not in ("sula", "gez"):
        raise HTTPException(status_code=400, detail=f"Bilinmeyen toplu işlem: {islem!r}")

    # Sulama süresi: makul bir aralıkta tutuluyor, panelden gelen sayıya
    # körlemesine güvenilmiyor.
    saniye = max(1.0, min(60.0, float(govde.get("saniye", 3) or 3)))

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


def _sulama_coz(adlar: list[str], saniye: float) -> dict[str, Any]:
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
        c = sulama.noktalar(
            bitki, tur, toplam_saniye=saniye, simdi=simdi, guvenli_z=guvenli_z,
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
    saniye = max(1.0, min(60.0, float(govde.get("saniye", 3) or 3)))
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
        lock_reg=int((uc.get("ayar") or {}).get("lock_reg") or 0),
        uc_takili=uc.get("uc"),
        # Süreler ve onay anahtarı panelden ayarlanıyor; kodda sabit
        # değildi ama kutusu da yoktu.
        vakum_sn=ayar["vakum_sn"], dusme_sn=ayar["dusme_sn"],
        onay=bool(ayar["onay_iste"]),
        # Mesajlarda slug degil TÜRKÇE AD gorunsun: kullanici panelde
        # "Marul" seciyor, ret sebebinde "marul" okumak kafa karistiriyor.
        tur_adlari={t.get("slug"): t.get("name_tr") or t.get("slug")
                    for t in tur_indeks.values() if t.get("slug")})
    if eksik:
        cozum["ret"].insert(0, "Şu noktalar bulunamadı: " + ", ".join(sorted(set(eksik))))
    if len(cozum["adimlar"]) > programlar.AZAMI_ADIM:
        sigar = programlar.AZAMI_ADIM // ekim.ADIM_BASINA_TOHUM
        cozum["ret"].append(
            f"{cozum['tohum_sayisi']} tohum x {ekim.ADIM_BASINA_TOHUM} adım = "
            f"{len(cozum['adimlar'])} adım, sınır {programlar.AZAMI_ADIM}. "
            f"Tek dizide en fazla {sigar} tohum ekilebilir.")
    return cozum


# --------------------------------------------------------------------------- #
# Ekim onay oturumu — insanın gözü, eksik sensörün yerine
#
# İki yerde duruyoruz ve soruyoruz:
#
#   1. Gözün ÜSTÜNDE  — "vakum ucu takılı mı?"   (lock_reg bağlı değil)
#   2. Tohumla KALKINCA — "tohum ucta mı?"        (presence_reg bağlı değil)
#
# İkisi de makinenin BİLEMEDİĞİ bir şeyi soruyor. Özellikle ikincisi:
# vakum tohumu tutamazsa ya da yolda düşürürse yazılım fark etmiyor,
# hedefe varıp pompayı kapatıyor ve "ekildi" diyor.
#
# YÜRÜTÜCÜ DEĞİŞMİYOR. `ajan/dizi.py`ye yeni adım tipi eklemek yerine
# aynı adımlar parçalara bölünüp sırayla `dizi_baslat` ile koşuluyor;
# arada burası bekliyor. Parçaların bittiğini ajanın durum paketinden
# öğreniyoruz (`_ekim_dizi_izle`).
#
# POMPAYI BURASI AÇIYOR. `dizi._roleleri_kapat` bir dizinin açtığı
# röleyi dizi biterken kapatıyor; parça B pompa açık bitseydi onay
# beklerken pompa kapanır ve tohum düşerdi. Dizinin dışından `role`
# komutuyla açılan röle o listeye girmiyor. Bedeli: yürütücünün
# "kesilirse röleyi kapat" ağı bu pompayı kapsamıyor — yerini
# `_ekim_pompa_kapat` alıyor ve oturum ne şekilde biterse bitsin
# çağrılıyor.
# --------------------------------------------------------------------------- #


class EkimOturumu:
    """Onaylı ekimin durumu. Aynı anda tek oturum — tek makine var."""

    def __init__(self) -> None:
        self.sifirla()

    def sifirla(self) -> None:
        self.aktif = False
        self.ozet: list[dict[str, Any]] = []
        self.parcalar: list[dict[str, Any]] = []
        self.sira = 0                  # kaçıncı tohum
        self.parca = ""                # "a" | "b1" | "b2" | "c" | "iptal"
        self.durum = "bos"             # bos|calisiyor|onay1|onay2|bitti|iptal|hata
        self.hata = ""
        self.mesaj = ""
        self.pompa_acik = False
        self.guvenli_z = 0.0
        self.dusme_sn = ekim.DUSME_SANIYE
        self.basladi_mi = False        # bu parçanın çalıştığını GÖRDÜK mü
        self.ekilen: list[str] = []

    # --- görünüm ------------------------------------------------------
    def goruntu(self) -> dict[str, Any]:
        o = self.ozet[self.sira] if self.sira < len(self.ozet) else {}
        onay = self.durum in ("onay1", "onay2")
        return {
            "aktif": self.aktif,
            "durum": self.durum,
            "parca": self.parca,
            "sira": self.sira + 1 if self.ozet else 0,
            "toplam": len(self.ozet),
            "tohum": o.get("ad", ""),
            "tur": o.get("tur", ""),
            "goz": o.get("goz", ""),
            # NEREDE DURDUĞU. Kullanıcı makineye bakarak onaylayacak ama
            # hangi gözün başında olduğunu bilmeli — dört göz yan yana.
            "konum": self._konum(),
            "soru": ekim.SORU.get(self.durum, "") if onay else "",
            "gerekce": ekim.GEREKCE.get(self.durum, "") if onay else "",
            "pompa_acik": self.pompa_acik,
            "hata": self.hata,
            "mesaj": self.mesaj,
            "ekilen": list(self.ekilen),
        }

    def _konum(self) -> dict[str, Any]:
        """Bu onay noktasında kafanın DURDUĞU yer — plandan, ölçümden değil.

        Canlı konumu panel zaten gösteriyor. Buradaki sayı "olması
        gereken": ikisi ayrışıyorsa kullanıcının bunu görmesi gerekir.
        """
        if self.sira >= len(self.ozet):
            return {}
        o = self.ozet[self.sira]
        # Her iki onay noktasında da kafa gözün ÜSTÜNDE duruyor:
        # onay 1'de henüz inmedi, onay 2'de tohumla kalktı.
        return {"ad": o.get("goz", ""), "x": o.get("goz_x"),
                "y": o.get("goz_y"), "z": self.guvenli_z}


_ekim = EkimOturumu()


async def _ekim_onayli_baslat(cozum: dict[str, Any]) -> dict[str, Any]:
    """Onaylı ekimi kurar ve ilk parçayı gönderir."""
    if _ekim.aktif:
        raise HTTPException(
            status_code=409,
            detail=f"Onaylı bir ekim zaten sürüyor ({_ekim.sira + 1}/"
                   f"{len(_ekim.ozet)}). Önce onu bitirin ya da iptal edin.")
    _ekim.sifirla()
    _ekim.aktif = True
    _ekim.ozet = cozum["ozet"]
    _ekim.parcalar = cozum["parca"]
    _ekim.guvenli_z = float(cozum.get("guvenli_z") or 0.0)
    _ekim.dusme_sn = float(cozum.get("dusme_sn") or ekim.DUSME_SANIYE)

    if cozum.get("kilit_yok"):
        # GÜVENLİK DENETİMİ İNSAN ONAYIYLA DEĞİŞTİ — günlüğe yazılıyor.
        await _ekim_gunluk(
            "uç kilit servosu bağlı değil (lock_reg = 0); kilit şartı onay "
            "adımıyla değiştirildi. Uç takılı olduğunu kullanıcı "
            "doğrulayacak.", "uyari")
    await _ekim_gunluk(
        f"onaylı ekim başladı — {len(_ekim.ozet)} tohum, tohum başına 2 onay")
    await _ekim_parca_baslat("a")
    return {"ok": True, "mesaj": f"Onaylı ekim başladı — {len(_ekim.ozet)} tohum",
            "ekim": _ekim.goruntu()}


async def _ekim_yayinla() -> None:
    await merkez.yayinla({"tip": "ekim", "ekim": _ekim.goruntu()})


async def _ekim_gunluk(metin: str, seviye: str = "bilgi") -> None:
    """Panelin olay günlüğüne yazar. Ajanın günlüğüyle aynı kanal.

    Onay akışının kararları BURADAN görünür oluyor: kilit şartının insan
    onayıyla kaldırılması, tohumun geri konması, pompanın kapatılması.
    """
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


async def _ekim_parca_baslat(parca: str) -> None:
    """Bir parçayı ajana gönderir. Parça boşsa atlıyoruz."""
    p = _ekim.parcalar[_ekim.sira]
    adimlar = p.get(parca) or []
    _ekim.parca = parca
    _ekim.durum = "calisiyor"
    _ekim.basladi_mi = False
    o = _ekim.ozet[_ekim.sira]
    await merkez.komut_gonder("dizi_baslat", {
        "ad": f"Ekim {_ekim.sira + 1}/{len(_ekim.ozet)} · {o.get('ad')} · {parca}",
        "adimlar": adimlar, "tekrar": 1,
    })
    await _ekim_yayinla()


async def _ekim_ilerlet() -> None:
    """Çalışan parça bitti; sıradaki adımı at.

    Sıra: a → [ONAY 1] → b1 → (pompa aç) → b2 → [ONAY 2] → c → sonraki tohum

    AJANIN OKUMA DÖNGÜSÜNDE ÇAĞRILMIYOR — bkz. `_ekim_dizi_izle`.
    """
    parca = _ekim.parca
    try:
        await _ekim_ilerlet_ic(parca)
    except HTTPException as hata:
        # Ajan komutu reddetti ya da koptu. Sessizce "ilerliyor"da
        # bırakmıyoruz: kullanıcı ekranda dönen bir şey görüp beklerdi.
        await _ekim_hatayla_bitir(str(hata.detail))


async def _ekim_ilerlet_ic(parca: str) -> None:

    if parca == "a":
        _ekim.durum = "onay1"
        await _ekim_yayinla()
        return

    if parca == "b1":
        # POMPA BURADA AÇILIYOR — dizinin içinde değil. Kafa gözün
        # dibinde duruyor; özgün dizideki sıra korunuyor (önce in, sonra
        # pompa), tek fark komutun nereden geldiği.
        await merkez.komut_gonder("role", {"ad": "hava_pompasi", "durum": True})
        _ekim.pompa_acik = True
        await _ekim_parca_baslat("b2")
        return

    if parca == "b2":
        _ekim.durum = "onay2"
        await _ekim_yayinla()
        return

    if parca == "iptal":
        # "Tohumu gözüne geri koy" bitti. Pompa dizinin içinde kapandı.
        _ekim.pompa_acik = False
        _ekim.durum = "iptal"
        _ekim.aktif = False
        await _ekim_yayinla()
        return

    # parca == "c": tohum ekildi.
    _ekim.pompa_acik = False        # kapatma adımı dizinin içindeydi
    o = _ekim.ozet[_ekim.sira]
    _ekim.ekilen.append(str(o.get("ad") or ""))
    await _ekim_gunluk(
        f"{o.get('ad')} ekildi ({_ekim.sira + 1}/{len(_ekim.ozet)}), "
        f"'{o.get('goz')}' gözü boşaldı")
    _ekim.sira += 1
    if _ekim.sira >= len(_ekim.ozet):
        _ekim.durum = "bitti"
        _ekim.aktif = False
        _ekim.mesaj = f"{len(_ekim.ekilen)} tohum ekildi."
        await _ekim_gunluk(_ekim.mesaj)
        await _ekim_yayinla()
        return
    await _ekim_parca_baslat("a")


async def _ekim_dizi_izle() -> None:
    """Ajanın durum paketi geldi — çalışan parça bitti mi?

    "Çalışıyor" bayrağının önce TRUE olduğunu görmeyi bekliyoruz.
    Beklemeseydik `dizi_baslat` yanıtı ile ajanın ilk durum paketi
    arasındaki boşlukta parçayı bitmiş sayardık ve sıradaki parçayı
    makine hâlâ hareket hâlindeyken gönderirdik.
    """
    if not _ekim.aktif or _ekim.durum != "calisiyor":
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
    # gelmiyor, zaman aşımına kadar makine öylece duruyor. (Ölçüldü: ilk
    # denemede ekim tam burada asılı kaldı.)
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
        f"{_ekim.parca} parçası durdu: {hata}. Onaylı ekim iptal edildi.",
        "hata")
    await _ekim_yayinla()


@app.get("/api/ekim/onay")
async def api_ekim_onay_durum(jeton: str = Query(default="")):
    """Onay oturumunun o anki hâli. Panel açılışta ve yeniden bağlanınca
    buradan okuyor; canlı güncelleme WebSocket'teki `ekim` paketinden."""
    _parola_dogrula(jeton)
    return _ekim.goruntu()


@app.post("/api/ekim/onayla")
async def api_ekim_onayla(govde: dict[str, Any] | None = None,
                          jeton: str = Query(default="")):
    """Kullanıcı "gördüm, devam" dedi. Gövde ARANMIYOR: onayın
    söyleyecek başka bir şeyi yok ve boş gövdeye 422 vermek, makine
    beklerken basılan düğmenin çalışmaması demek olurdu."""
    _parola_dogrula(jeton)
    if not _ekim.aktif:
        raise HTTPException(status_code=409, detail="Süren bir ekim yok.")

# ONAY BEKLENMEYEN DURUMDA DA IPTAL EDILEBILIR.
    #
    # Önce yalnız `onay1`/`onay2` kabul ediliyordu ve dizi "calisiyor"da
    # takıldığında iptal 409 dönüyordu: kullanıcı kutuyu görüyor, İptal'e
    # basıyor, hiçbir şey olmuyor ve panelden çıkış kalmıyordu. Sahada tam
    # bu yaşandı.
    #
    # Bu dal MAKİNEYİ HAREKET ETTİRMİYOR. Takılmanın sebebi çoğu zaman
    # makinenin zaten cevap vermemesi; kurtarmayı yeni bir harekete
    # bağlamak, aynı duvara ikinci kez toslamak olurdu. Sürmekte olan iş
    # kesiliyor, pompa kapatılıyor, durum temizleniyor.
    if _ekim.durum not in ("onay1", "onay2"):
        try:
            await merkez.komut_gonder("dur", {})
        except Exception:
            pass                       # makine cevap vermiyorsa da devam
        await _ekim_pompa_kapat("iptal — işlem yarıda kesildi")
        eski_durum = _ekim.durum
        _ekim.durum = "iptal"
        _ekim.aktif = False
        _ekim.mesaj = (
            f"Ekim yarıda kesildi (durum: {eski_durum}). Hareket durduruldu "
            f"ve pompa kapatıldı. {len(_ekim.ekilen)} tohum ekilmişti. "
            "Makinenin nerede kaldığını ve tohumun ucta olup olmadığını "
            "gözle kontrol edin; göz durumları değiştirilmedi.")
        await _ekim_gunluk(_ekim.mesaj, "uyari")
        await _ekim_yayinla()
        return _ekim.goruntu()

    o = _ekim.ozet[_ekim.sira]
    if _ekim.durum == "onay1":
        await _ekim_gunluk(
            f"'{o.get('goz')}' gözünün üstünde uç takılı onaylandı — iniliyor")
        await _ekim_parca_baslat("b1")
    else:
        await _ekim_gunluk(
            f"tohum ucta onaylandı — {o.get('ad')} hedefine taşınıyor")
        await _ekim_parca_baslat("c")
    return _ekim.goruntu()


@app.post("/api/ekim/iptal")
async def api_ekim_iptal(govde: dict[str, Any] | None = None,
                         jeton: str = Query(default="")):
    """Kullanıcı onaylamadı. NE OLDUĞU AÇIK OLSUN — sessizce bırakma yok.

    * Onay 1'de iptal: hiçbir şey olmadı. Kafa gözün üstünde, pompa hiç
      açılmadı, göz dolu. Oturum biter.
    * Onay 2'de iptal: pompa AÇIK ve tohum (belki) ucta. İki seçenek var
      ve ikisi FARKLI şeyler:
        - `geri_koy`: kafa gözüne iner, pompa kapanır, tohum kendi gözüne
          düşer, göz yeniden DOLU işaretlenir. Tohum ucta GÖRÜNÜYORSA bu.
        - `birak`:    pompa olduğu yerde kapanır. Göz BOŞ kalır — çünkü
          tohum ya yolda düştü ya tepsinin üstüne düşecek. Tohum ucta
          görünmüyorsa bu; "gözü dolu" yazmak yalan olurdu.
    """
    _parola_dogrula(jeton)
    if not _ekim.aktif or _ekim.durum not in ("onay1", "onay2"):
        raise HTTPException(
            status_code=409,
            detail=f"Onay beklenmiyor (durum: {_ekim.durum}).")
    o = _ekim.ozet[_ekim.sira]

    if _ekim.durum == "onay1":
        _ekim.durum = "iptal"
        _ekim.aktif = False
        _ekim.mesaj = (
            f"İptal edildi — hiçbir şey yapılmadı. Kafa '{o.get('goz')}' "
            f"gözünün üstünde duruyor, pompa hiç açılmadı, göz dolu. "
            f"{len(_ekim.ekilen)} tohum ekilmişti.")
        await _ekim_gunluk(_ekim.mesaj)
        await _ekim_yayinla()
        return _ekim.goruntu()

    kip = str((govde or {}).get("kip") or "").strip()
    if kip not in ("geri_koy", "birak"):
        raise HTTPException(
            status_code=400,
            detail="İptal biçimi belirtilmeli: 'geri_koy' (tohum ucta "
                   "görünüyor, gözüne geri konsun) ya da 'birak' (pompa "
                   "kapatılsın, tohum düşecek).")

    if kip == "birak":
        # Pompa olduğu yerde kapanıyor. Gözü DOLU işaretlemiyoruz: tohum
        # ya yolda düştü ya tepsinin üstüne düşüyor; ikisinde de o gözde
        # tohum yok.
        await _ekim_pompa_kapat("iptal — tohum bırakıldı")
        _ekim.durum = "iptal"
        _ekim.aktif = False
        _ekim.mesaj = (
            f"Pompa kapatıldı, tohum düştü. '{o.get('goz')}' gözü BOŞ kaldı — "
            "tohum ya yolda düşmüştü ya şimdi tepsinin üstüne düştü. Gözü "
            "yeniden doldurup 'dolu' işaretleyin. "
            f"{len(_ekim.ekilen)} tohum ekilmişti.")
        await _ekim_gunluk(_ekim.mesaj, "uyari")
        await _ekim_yayinla()
        return _ekim.goruntu()

    # geri_koy: kısa bir dizi — in, pompayı kapat, bekle, gözü DOLU yaz, kalk.
    goz = {"ad": o.get("goz"), "x": o.get("goz_x"), "y": o.get("goz_y"),
           "z": o.get("goz_z"), "tohum": o.get("goz_tohum")}
    _ekim.parcalar[_ekim.sira]["iptal"] = ekim.iptal_parcasi(
        goz, guvenli_z=_ekim.guvenli_z, dusme_sn=_ekim.dusme_sn)
    _ekim.mesaj = (
        f"Tohum '{o.get('goz')}' gözüne geri konuyor; göz yeniden DOLU "
        f"işaretlenecek. {len(_ekim.ekilen)} tohum ekilmişti.")
    await _ekim_gunluk(_ekim.mesaj)
    await _ekim_parca_baslat("iptal")
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
            "bos_kalacak_gozler": cozum["bos_kalacak_gozler"],
            "kalan_dolu_goz": cozum["kalan_dolu_goz"],
            "azami_adim": programlar.AZAMI_ADIM}


# --------------------------------------------------------------------------- #
# Tohum ızgarası
#
# Ayrı bir yapı kurmuyoruz: üretilen noktalar doğrudan nokta deposuna yazılıyor.
# Böylece "Git", "Sil" ve program adımları ızgara noktaları için de aynen
# çalışıyor — ikinci bir nokta kavramı öğrenmek gerekmiyor.
# --------------------------------------------------------------------------- #
def _izgara_coz(govde: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        return noktalar.izgara_uret(
            float(govde.get("x0", 0)), float(govde.get("y0", 0)), float(govde.get("z", 0)),
            float(govde.get("dx", 0)), float(govde.get("dy", 0)),
            int(govde.get("satir", 1)), int(govde.get("sutun", 1)),
            str(govde.get("onek", "s")))
    except noktalar.NoktaHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Izgara değerleri sayı olmalı")


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
    # Kaydedilmiş hâli geri veriyoruz: köşeler sıralanmış, adlar kırpılmış
    # olabiliyor ve panel kendi yazdığına değil, DEPODAKİNE bakmalı.
    return {"ok": True, "alanlar": alanlar}


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


def _kare_bul(damga: str) -> dict[str, Any] | None:
    return next((k for k in kareler.liste() if k["damga"] == damga), None)


def _goruntu_coz(damga: str, esik: float | None, en_az_piksel: int
                 ) -> dict[str, Any]:
    """Bir kareyi çözümler: lekeler + milimetre + kayıtlı bitki eşlemesi."""
    goruntu, tespit, _, _ = _goruntu_yukle()
    kayit = _kare_bul(damga)
    if kayit is None:
        raise HTTPException(status_code=404, detail=f"'{damga}' damgalı kare yok")
    ham = kareler.getir(damga)
    if not ham:
        raise HTTPException(status_code=404, detail="Kare dosyası okunamadı")

    rgb, en, boy = _kare_dizi(ham)
    sonuc = goruntu.bul(rgb, esik=(goruntu.ESIK if esik is None else esik),
                        en_az_piksel=en_az_piksel)
    kalib = kalibrasyon.oku()
    cozum = tespit.cozumle(sonuc["lekeler"], kayit, kalib,
                           genislik_px=en, yukseklik_px=boy)

    # Eşleme yalnız milimetre varken anlamlı.
    eslesme: dict[str, Any] = {"eslesen": [], "yabani_aday": [], "gorunmeyen": []}
    if not cozum["ret"]:
        hepsi = [n for n in noktalar.hepsi() if n.get("tur")]
        icerdeki = tespit.kare_icinde(hepsi, cozum["kare_mm"])
        caplar, yasa = _yaricaplar(icerdeki)
        eslesme = tespit.eslestir(cozum["lekeler"], icerdeki,
                                  yaricap_mm=caplar, yasa_gore=yasa)
    return {
        "damga": damga, "ts": kayit.get("ts"),
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
async def api_goruntu_durum(jeton: str = Query(default="")):
    """Görüntü işleme kullanılabilir mi, kalibrasyon var mı, kaç kare var."""
    _parola_dogrula(jeton)
    hazir = await asyncio.to_thread(_goruntu_yukle)
    kalib = await asyncio.to_thread(kalibrasyon.oku)
    liste = await asyncio.to_thread(kareler.liste)
    return {
        "hazir": bool(hazir),
        "hata": _GORUNTU["hata"],
        "kalibre": float(kalib.get("mm_px") or 0) > 0,
        "mm_px": kalib.get("mm_px"),
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
    damga = str(govde.get("damga") or "").strip()
    if not damga:
        liste = await asyncio.to_thread(kareler.liste)
        if not liste:
            raise HTTPException(status_code=404, detail="Hiç kare yok")
        damga = max(liste, key=lambda k: k["ts"])["damga"]
    esik = govde.get("esik")
    esik = None if esik in (None, "") else float(esik)
    en_az = int(govde.get("en_az_piksel") or 0) or None
    goruntu, _, _, _ = _goruntu_yukle()
    return await asyncio.to_thread(
        _goruntu_coz, damga, esik, en_az or goruntu.EN_AZ_PIKSEL)


def _goruntu_fark(damga_a: str, damga_b: str) -> dict[str, Any]:
    """İki karenin farkı. Kareler AYNI konumda çekilmiş olmalı."""
    goruntu, tespit, _, _ = _goruntu_yukle()
    ka, kb = _kare_bul(damga_a), _kare_bul(damga_b)
    if ka is None or kb is None:
        raise HTTPException(status_code=404, detail="Karelerden biri bulunamadı")
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

    ra, ena, boya = _kare_dizi(kareler.getir(damga_a) or b"")
    rb, enb, boyb = _kare_dizi(kareler.getir(damga_b) or b"")
    if (ena, boya) != (enb, boyb):
        raise HTTPException(status_code=422, detail="Kareler farklı çözünürlükte")

    f = goruntu.fark(ra, rb)
    kalib = kalibrasyon.oku()
    cikti = {
        "a": damga_a, "b": damga_b, "kayma_mm": round(kayma, 2),
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
    return await asyncio.to_thread(_goruntu_fark, a, b)


def _cimlenme(damga: str, adlar: list[str], esik: float | None,
              yaricap: float) -> dict[str, Any]:
    """Ekilen noktaların üstünde bir şey çıkmış mı.

    Bütün yatağa değil, her noktanın çevresindeki KÜÇÜK pencereye
    bakıyoruz. Nerede ekildiğini bildiğimiz için yanlış pozitiflerin
    çoğu daha bakmadan eleniyor — ve fide birkaç milimetre olduğu için
    leke ayırmaya değil, pencerede yeşil ORANINA bakmak yeterli.
    """
    goruntu, tespit, _, _ = _goruntu_yukle()
    kayit = _kare_bul(damga)
    if kayit is None:
        raise HTTPException(status_code=404, detail=f"'{damga}' damgalı kare yok")
    ham = kareler.getir(damga)
    if not ham:
        raise HTTPException(status_code=404, detail="Kare dosyası okunamadı")
    rgb, en, boy = _kare_dizi(ham)
    kalib = kalibrasyon.oku()
    if not tespit.kalibre_mi(kalib):
        raise HTTPException(status_code=422, detail=tespit.YOK_KALIBRASYON)
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
    return {"damga": damga, "esik": e, "yaricap_mm": yaricap, "noktalar": cikti}


@app.post("/api/goruntu/cimlenme")
async def api_goruntu_cimlenme(govde: dict[str, Any], jeton: str = Query(default="")):
    """Ekilen noktaların üstündeki yeşil oranı — çimlenme göstergesi.

    Tek ölçüm "çimlendi" demiyor: oran ZAMANLA yükseliyorsa çimlenme.
    Karar panelde, sayıya bakan kişide.
    """
    _parola_dogrula(jeton)
    if not await asyncio.to_thread(_goruntu_yukle):
        raise HTTPException(status_code=503, detail=_GORUNTU["hata"])
    damga = str(govde.get("damga") or "").strip()
    if not damga:
        liste = await asyncio.to_thread(kareler.liste)
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
    return await asyncio.to_thread(_cimlenme, damga, adlar, esik, yaricap)


@app.get("/api/goruntu/maske")
async def api_goruntu_maske(damga: str = Query(...), esik: float = Query(default=-9.0),
                            jeton: str = Query(default="")):
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
        ham = kareler.getir(damga)
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
async def api_kalibrasyon(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return {"kalibrasyon": await asyncio.to_thread(kalibrasyon.oku)}


@app.post("/api/kamera/kalibrasyon")
async def api_kalibrasyon_kaydet(govde: dict[str, Any], jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    try:
        veri = await asyncio.to_thread(kalibrasyon.kaydet, govde)
    except kalibrasyon.KalibrasyonHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    except (TypeError, ValueError) as hata:
        raise HTTPException(status_code=400, detail=f"Geçersiz kalibrasyon: {hata}")
    return {"ok": True, "kalibrasyon": veri}


@app.post("/api/kamera/kalibrasyon/coz")
async def api_kalibrasyon_coz(govde: dict[str, Any], jeton: str = Query(default="")):
    """İki kareden ölçek ve açıyı hesaplar; istenirse doğrudan kaydeder.

    Gövde: {"kare1": {"x","y","u","v"}, "kare2": {…}, "kaydet": true}
    """
    _parola_dogrula(jeton)
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
        })
    return {"ok": True, "sonuc": sonuc, "kalibrasyon": veri}


# --------------------------------------------------------------------------- #
# Kamera kareleri
# --------------------------------------------------------------------------- #
@app.get("/api/kare/son")
async def api_kare_son(jeton: str = Query(default=""), t: float = Query(default=0)):
    """En son kareyi JPEG olarak döndürür. `t` yalnızca önbellek kırıcı."""
    _parola_dogrula(jeton)
    kare = await asyncio.to_thread(kareler.son)
    if kare is None:
        raise HTTPException(status_code=404, detail="Henüz kare yok")
    return Response(content=kare, media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


@app.get("/api/kare/canli")
async def api_kare_canli(jeton: str = Query(default=""), t: float = Query(default=0)):
    """Canlı akışın SON karesi. `t` yalnızca önbellek kırıcı.

    Diskten değil bellekten okunuyor; canlı kareler saklanmıyor.
    """
    _parola_dogrula(jeton)
    kare = merkez.canli_kare
    if not kare:
        raise HTTPException(status_code=404, detail="Canlı akış kapalı")
    return Response(content=kare, media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


@app.get("/api/kare/liste")
async def api_kare_liste(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return {"kareler": await asyncio.to_thread(kareler.liste)}


@app.get("/api/kare/{damga}")
async def api_kare(damga: str, jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    kare = await asyncio.to_thread(kareler.getir, damga)
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
