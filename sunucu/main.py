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
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

import depo
import dikim
import egriler
import geri_al
import kalibrasyon
import kareler
import noktalar
import programlar
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
    "home",          # {"eksen":"z"} ya da {}        — referans arama
    "dur",           # {}                            — hareketi durdur
    "acil",          # {}                            — ACİL DURDURMA (mandallı)
    "acil_temizle",  # {}                            — mandalı temizle
    "enable",        # {"deger": true|false}         — sürücü torku
    "hiz",           # {"mm_s": 20}
    "bolge_listele", # {}                            — ajandaki yasak bölgeler
    "bolge_kaydet",  # {"bolgeler":[…]}              — doğrular, dosyaya yazar
    "uc_listele",    # {}                            — uç ayarları ve dizi durumu
    "uc_kaydet",     # {"ayar":{…}}
    "uc_al",         # {"ad":"tool1"}                — yandan yaklaşımlı alma dizisi
    "uc_birak",      # {}
    "uc_degistir",   # {"ad":"tool3"}
    "uc_onizle",     # {"islem":"al"|"birak","ad":"tool1"} — yolu koordinatla göster
    "uc_durum_temizle",  # {}                        — takılı uç kaydını sıfırla
    "dizi_baslat",   # {"ad":…,"adimlar":[…],"tekrar":1} — çözülmüş adımlarla
    "dizi_durdur",   # {}
    "servo",         # {"aci": 90}
    "kip",           # {"deger": "oto" | "manuel"}
    "kamera",        # {"acik": true|false, "aralik_sn": 3600}
    "oto_esik",      # {"ham": 600}                  — otomatik sulama eşiği (ADC)
    "oto_cikis",     # {"ad": "yok"|"servo"|"su_vanasi"|"su_pompasi"}
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
        if str(govde.get("etiket", "")) == "bitki":
            kabul, gerekce, _ = await asyncio.to_thread(
                dikim.nokta_kabul, float(govde["x"]), float(govde["y"]))
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
# Seçim en fazla 40 nokta: yatağımız 425 x 600 mm, sığan fide sayısı bu
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

    if islem not in ("sula", "gez"):
        raise HTTPException(status_code=400, detail=f"Bilinmeyen toplu işlem: {islem!r}")

    # Sulama süresi: makul bir aralıkta tutuluyor, panelden gelen sayıya
    # körlemesine güvenilmiyor.
    saniye = max(1.0, min(60.0, float(govde.get("saniye", 3) or 3)))

    # TOPLU SULAMA yalnız dikim alanlarının içinde. Su, toprağın olmadığı
    # yere dökülürse tezgâhın ve elektroniğin üstüne gidiyor; bu yüzden
    # eksik nokta gibi bu da diziyi HİÇ başlatmıyor, kısmen değil.
    # `gez` dokunulmadan geçiyor: gezinti noktası toprağın dışında olabilir.
    if islem == "sula":
        alanlar = await asyncio.to_thread(dikim.listele)
        if alanlar:
            kayitli = await asyncio.to_thread(noktalar.oku)
            indeks = {n.get("ad"): n for n in kayitli["noktalar"]}
            disarida = []
            for ad in adlar:
                nk = indeks.get(ad)
                if nk is None:
                    continue          # eksik nokta hatasını `programlar.coz` veriyor
                kabul, _, _ = dikim.nokta_kabul(
                    float(nk.get("x", 0)), float(nk.get("y", 0)), alanlar)
                if not kabul:
                    disarida.append(f"{ad} (X{nk.get('x')} Y{nk.get('y')})")
            if disarida:
                raise HTTPException(
                    status_code=422,
                    detail="Şu noktalar dikim alanı dışında, sulama başlatılmadı: "
                           + ", ".join(sorted(disarida)))

    adimlar: list[dict[str, Any]] = []
    for ad in adlar:
        adimlar.append({"tip": "nokta", "ad": ad})
        if islem == "sula":
            adimlar.append({"tip": "role", "ad": "su_vanasi", "durum": True})
            adimlar.append({"tip": "bekle", "saniye": saniye})
            adimlar.append({"tip": "role", "ad": "su_vanasi", "durum": False})

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


app.mount("/statik", TazeStatik(directory=_STATIK), name="statik")


@app.get("/")
async def anasayfa():
    yanit = FileResponse(os.path.join(_STATIK, "index.html"))
    yanit.headers["Cache-Control"] = "no-store, must-revalidate"
    return yanit
