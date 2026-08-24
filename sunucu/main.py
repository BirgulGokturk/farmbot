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
from fastapi.staticfiles import StaticFiles

import depo
import kareler
import noktalar
import programlar

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("farmbot")

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
    if not await asyncio.to_thread(noktalar.sil, ad):
        raise HTTPException(status_code=404, detail=f"'{ad}' adında nokta yok")
    return {"ok": True}


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
    return {
        "toplam": len(uretilen),
        "sinir_disi": sinir_disi,
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
            int(govde.get("tekrar", 1)))
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
        adimlar = await asyncio.to_thread(programlar.coz, program)
    except programlar.ProgramHatasi as hata:
        raise HTTPException(status_code=400, detail=str(hata))
    return await merkez.komut_gonder("dizi_baslat", {
        "ad": program["ad"], "adimlar": adimlar,
        "tekrar": program.get("tekrar", 1), "hiz": govde.get("hiz"),
    })


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


# --------------------------------------------------------------------------- #
# Bitki türleri
#
# Veri `docs/bitki_turleri.json` içinde ve elle bakımı yapılıyor; sunucu
# yalnızca okuyup panele veriyor. Türleri koda gömmek, yeni bir tür eklemek
# için sürüm çıkmak demek olurdu.
# --------------------------------------------------------------------------- #
_TUR_ONBELLEK: dict[str, Any] = {"ts": 0.0, "veri": []}


def _turleri_oku() -> list[dict[str, Any]]:
    yol = os.environ.get("TUR_YOLU") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "bitki_turleri.json")
    try:
        damga = os.path.getmtime(yol)
    except OSError:
        return []
    # Dosya değişmediyse yeniden okumuyoruz; her panel açılışında 10 KB JSON
    # ayrıştırmanın anlamı yok.
    if damga == _TUR_ONBELLEK["ts"] and _TUR_ONBELLEK["veri"]:
        return _TUR_ONBELLEK["veri"]
    try:
        with open(yol, encoding="utf-8") as dosya:
            veri = json.load(dosya)
    except (json.JSONDecodeError, OSError) as hata:
        logger.warning("Bitki türleri okunamadı (%s): %s", yol, hata)
        return []
    if not isinstance(veri, list):
        return []
    _TUR_ONBELLEK.update(ts=damga, veri=veri)
    return veri


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


@app.get("/api/turler")
async def api_turler(jeton: str = Query(default="")):
    _parola_dogrula(jeton)
    return {"turler": await asyncio.to_thread(_turleri_oku)}


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
