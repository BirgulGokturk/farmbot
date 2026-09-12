"""
api — sunucu'ya takılan FastAPI yönlendiricisi.

TASARIM KURALI: bu dosya `sunucu` tarafından HİÇBİR ŞEY import etmez.
Gerekli çağrılar dışarıdan enjekte edilir — depodaki `bitki.yonlendirici_kur(...)`
kalıbının aynısı. Sebebi:

  * `sunucu` bir paket değil (`__init__.py` yok, `main.py` düz import kullanıyor:
    `import noktalar`, `import bitki`). `from sunucu.X import Y` çalışmaz.
  * İşlev içine saklanmış import açılışta patlamaz; ilgili uç çağrılana kadar
    sessiz kalır, sonra 500 verir. En kötü hata türü. Burada bağımlılıklar
    yönlendirici KURULURKEN doğrulanır — eksikse süreç açılışta ve net bir
    mesajla durur.

Kurulum (sunucu/main.py):

    import gorus.api as gorus_api                     # gorus/ dizini sunucu/ altında

    app.include_router(gorus_api.yonlendirici_kur(
        komut_gonder=merkez.komut_gonder,             # main.py'deki gerçek köprü
        bitki_kaynagi=bitki.veri,                     # ekim kaydını veren çağrı
    ))

`bitki.veri()`'nin döndürdüğü kayıt biçimi bilinmiyor. `_kayitlara_cevir`
yaygın alan adlarını dener; hiçbiri tutmazsa GÖRDÜĞÜ ANAHTARLARI yazan bir
hata verir — sessizce yanlış koordinat üretmez. Biçiminiz farklıysa kendi
dönüştürücünüzü `kayit_donusturucu=` ile geçin.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import inspect
import json
import os
import sys
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse

from .ayarlar import Ayarlar
from .depo import Depo
from .eslestir import EkimKaydi

# ---------------------------------------------------------------- kayıt biçimi

_X = ("x_mm", "x", "X", "konum_x", "x_konum")
_Y = ("y_mm", "y", "Y", "konum_y", "y_konum")
_ID = ("id", "kimlik", "no", "bitki_id")
_TUR = ("tur", "tür", "cins", "isim", "ad", "bitki")
_TARIH = ("ekim_tarihi", "ekildi", "ekim", "tarih", "olusturma", "eklendi")
_DURUM = ("durum", "hal", "asama")


def _al(k: dict, adaylar, varsayilan=None):
    for a in adaylar:
        if a in k and k[a] is not None:
            return k[a]
    return varsayilan


def _yas_gun(deger) -> float:
    if deger is None:
        return 0.0
    try:
        if isinstance(deger, (int, float)):          # epoch saniye ya da ms
            sn = float(deger) / (1000.0 if deger > 1e11 else 1.0)
            t = dt.datetime.fromtimestamp(sn)
        else:
            t = dt.datetime.fromisoformat(str(deger).replace("Z", "+00:00"))
    except (ValueError, OSError, OverflowError):
        return 0.0
    if t.tzinfo:
        t = t.astimezone().replace(tzinfo=None)
    return max(0.0, (dt.datetime.now() - t).total_seconds() / 86400.0)


def _kayitlara_cevir(ham) -> list[EkimKaydi]:
    """
    Ekim kaydını EkimKaydi listesine çevirir. Koordinat alanı bulunamazsa
    tahmin ETMEZ; gördüğü anahtarları yazıp hata verir.
    """
    if ham is None:
        return []
    if isinstance(ham, dict):                         # {id: kayit} biçimi de olabilir
        ham = [{**v, "id": k} if isinstance(v, dict) else v for k, v in ham.items()]

    kayitlar, gorulen = [], set()
    for i, k in enumerate(ham):
        if not isinstance(k, dict):
            k = getattr(k, "__dict__", None) or {}
        gorulen.update(k.keys())
        x, y = _al(k, _X), _al(k, _Y)
        if x is None or y is None:
            continue
        kayitlar.append(EkimKaydi(
            id=int(_al(k, _ID, i)), x_mm=float(x), y_mm=float(y),
            tur=str(_al(k, _TUR, "") or ""),
            yas_gun=_yas_gun(_al(k, _TARIH)),
            durum=str(_al(k, _DURUM, "ekili") or "ekili"),
        ))

    if ham and not kayitlar:
        raise HTTPException(500, (
            "Ekim kaydında koordinat alanı bulunamadı. Görülen anahtarlar: "
            f"{sorted(gorulen)}. Denenen adlar X için {_X}, Y için {_Y}. "
            "Biçiminiz farklıysa yonlendirici_kur(kayit_donusturucu=...) geçin."))
    return kayitlar


async def _cagir(fn, *args, zaman_asimi=None):
    """Enjekte edilen çağrı eşzamanlı da olabilir, async de. İkisini de karşıla."""
    sonuc = fn(*args)
    if inspect.isawaitable(sonuc):
        if zaman_asimi:
            return await asyncio.wait_for(sonuc, zaman_asimi)
        return await sonuc
    return sonuc


# ---------------------------------------------------------------- yönlendirici

async def _isci_calistir(gorev: dict, zaman_asimi: float) -> dict:
    """
    Taramayı AÇIK BİR ALT SÜREÇTE koşturur: `python -m gorus.isci is.json sonuc.json`

    Neden multiprocessing havuzu değil — ölçüldü:
      * `spawn` ve `forkserver` çocukta ebeveynin `__main__` modülünü yeniden
        çalıştırıyor (`spawn._main -> _fixup_main_from_path`). Sunucu
        `python main.py` ile açılıyorsa her tarama sunucuyu bir kez daha
        başlatmaya kalkar.
      * `fork`, uvicorn'un iş parçacıklarıyla birlikte kilitlenme riski taşır.
    Açık alt süreçte ikisi de yok: ebeveynin durumu çocuğa hiç taşınmıyor,
    OpenCV'de bir çökme sunucuyu değil yalnız o süreci düşürüyor, ve iş
    gerçekten zaman aşımına uğratılabiliyor.
    """
    dizin = Path(tempfile.mkdtemp(prefix="gorus_is_"))
    is_yolu, sonuc_yolu = dizin / "is.json", dizin / "sonuc.json"
    is_yolu.write_text(json.dumps(gorev, ensure_ascii=False, default=str), "utf-8")

    ortam = dict(os.environ)
    # gorus paketinin bulunduğu dizin çocuğun yolunda olsun (sunucu/ düz
    # import kullandığı için paketin kökü sys.path'te olmayabilir).
    kok = str(Path(__file__).resolve().parent.parent)
    ortam["PYTHONPATH"] = kok + (os.pathsep + ortam["PYTHONPATH"]
                                 if ortam.get("PYTHONPATH") else "")
    # OpenCV'nin kendi iş parçacıkları Pi'nin 4 çekirdeğini kapatmasın.
    ortam.setdefault("OPENCV_FOR_THREADS_NUM", "3")

    surec = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "gorus.isci", str(is_yolu), str(sonuc_yolu),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=ortam)
    try:
        _, hata_akisi = await asyncio.wait_for(surec.communicate(), zaman_asimi)
    except asyncio.TimeoutError:
        surec.kill()
        await surec.wait()
        raise HTTPException(504, f"tarama {zaman_asimi:g} sn içinde bitmedi")
    finally:
        pass

    if not sonuc_yolu.exists():
        kuyruk = (hata_akisi or b"").decode("utf-8", "replace").strip().splitlines()
        raise HTTPException(500, "işçi süreç sonuç üretmeden çıktı "
                                 f"(kod {surec.returncode}): "
                                 + (" | ".join(kuyruk[-3:]) or "çıktı yok"))
    cevap = json.loads(sonuc_yolu.read_text("utf-8"))
    for y in (is_yolu, sonuc_yolu):
        y.unlink(missing_ok=True)
    dizin.rmdir()
    if not cevap.get("tamam"):
        raise HTTPException(500, f"tarama başarısız: {cevap.get('hata')}")
    return cevap["sonuc"]


def yonlendirici_kur(*, komut_gonder, bitki_kaynagi,
                     ayarlar: Ayarlar | None = None,
                     ayar_yolu: str | None = None,
                     kayit_donusturucu=None,
                     tarama_zaman_asimi: float = 180.0,
                     on_ek: str = "/gorus") -> APIRouter:
    """
    komut_gonder(ad, arg)  : ajan'a komut yollayan gerçek köprü
                             (main.py'deki merkez.komut_gonder). Eşzamanlı ya
                             da async olabilir; ikisi de desteklenir.
    bitki_kaynagi()        : ekim kaydını döndüren çağrı (bitki.veri gibi).
    kayit_donusturucu(ham) : ham kaydı [EkimKaydi] listesine çeviren isteğe
                             bağlı çağrı. Verilmezse alan adı sezgisi kullanılır.
    tarama_zaman_asimi     : işçi sürecin en fazla koşacağı saniye.
    """
    if not callable(komut_gonder):
        raise TypeError("komut_gonder çağrılabilir olmalı (ör. merkez.komut_gonder)")
    if not callable(bitki_kaynagi):
        raise TypeError("bitki_kaynagi çağrılabilir olmalı (ör. bitki.veri)")

    ayar = ayarlar or Ayarlar.yukle(ayar_yolu)
    depo = Depo(ayar.db_yolu)
    cevir = kayit_donusturucu or _kayitlara_cevir

    kilit = asyncio.Lock()
    router = APIRouter(prefix=on_ek, tags=["gorus"])

    async def _taze_kare(genislik: int) -> str:
        cevap = await _cagir(komut_gonder, "kare_cek",
                             {"genislik": int(genislik), "portal_park": True},
                             zaman_asimi=30.0)
        if isinstance(cevap, str):                    # köprü doğrudan yol döndürüyorsa
            return cevap
        if not isinstance(cevap, dict):
            raise HTTPException(502, f"ajan beklenmeyen cevap verdi: {type(cevap).__name__}")
        if cevap.get("tamam") is False:
            raise HTTPException(503, f"ajan kare veremedi: {cevap.get('hata')}")
        yol = cevap.get("yol") or cevap.get("dosya") or cevap.get("path")
        if not yol:
            raise HTTPException(502, f"ajan cevabında kare yolu yok: {sorted(cevap)}")
        return str(yol)

    # ------------------------------------------------------------ uçlar

    @router.post("/tarama")
    async def tarama_baslat(kare_yolu: str | None = None,
                            genislik: int | None = None):
        """Yeni tarama. kare_yolu verilmezse ajan'dan taze kare istenir."""
        if kilit.locked():
            raise HTTPException(409, "Zaten bir tarama sürüyor.")
        async with kilit:
            yol = kare_yolu or await _taze_kare(
                genislik or ayar.kare.kalibrasyon_genisligi)
            if not Path(yol).exists():
                raise HTTPException(404, f"Kare bulunamadı: {yol}")

            kayitlar = cevir(await _cagir(bitki_kaynagi))
            s = await _isci_calistir({
                "kare_yolu": yol,
                "kayitlar": [k.__dict__ for k in kayitlar],
                "izler": [i.sozluk() for i in depo.izleri_yukle()],
                "ayar_yolu": ayar_yolu,
            }, tarama_zaman_asimi)

            tid = depo.tarama_yaz(s, kare_yolu=yol, gorsel_yolu=s.get("gorsel_yolu"))
            s["tarama_id"] = tid
            s["gorsel_url"] = f"{on_ek}/tarama/{tid}/gorsel.jpg"
            s["ustten_url"] = (f"{on_ek}/tarama/{tid}/ustten.jpg"
                               if s.get("ustten_yolu") else None)
            return JSONResponse(s)

    @router.get("/tarama/son")
    def son():
        s = depo.son_tarama()
        if not s:
            raise HTTPException(404, "Henüz tarama yok.")
        s["tespitler"] = depo.tespitler(s["id"])
        return s

    @router.get("/tarama/{tid}/gorsel.jpg")
    def gorsel(tid: int):
        r = depo.baglanti.execute("SELECT gorsel_yolu FROM tarama WHERE id=?",
                                  (tid,)).fetchone()
        if not r or not r["gorsel_yolu"] or not Path(r["gorsel_yolu"]).exists():
            raise HTTPException(404, "Görsel yok.")
        return FileResponse(r["gorsel_yolu"], media_type="image/jpeg")

    @router.get("/tarama/{tid}/ustten.jpg")
    def ustten(tid: int):
        """Ortorektifiye kuşbakışı görünüm — kalibrasyonun görsel kanıtı."""
        r = depo.baglanti.execute("SELECT kare_yolu FROM tarama WHERE id=?",
                                  (tid,)).fetchone()
        if not r or not r["kare_yolu"]:
            raise HTTPException(404, "Kare yok.")
        y = Path(r["kare_yolu"]).with_suffix(".ustten.jpg")
        if not y.exists():
            raise HTTPException(404, "Üstten görünüm üretilmemiş.")
        return FileResponse(str(y), media_type="image/jpeg")

    @router.get("/tespitler")
    def tespitler(tarama_id: int | None = None,
                  sinif: str | None = Query(None,
                                            pattern="^(filiz|yabani|belirsiz)$")):
        return depo.tespitler(tarama_id, sinif)

    @router.post("/tespit/{tespit_id}/etiket")
    def etiketle(tespit_id: int,
                 etiket: str = Query(..., pattern="^(filiz|yabani|yok)$")):
        """Panelde kullanıcı düzeltmesi. Faz 2 eğitim kümesini besler."""
        depo.insan_etiketle(
            tespit_id, etiket,
            dt.datetime.now().astimezone().isoformat(timespec="seconds"))
        return {"tamam": True}

    @router.get("/kalibrasyon")
    def kalibrasyon():
        from .duzlem import Duzlem
        try:
            d = Duzlem.yukle(ayar.kalibrasyon_yolu)
        except FileNotFoundError:
            raise HTTPException(404, f"Kalibrasyon yok: {ayar.kalibrasyon_yolu}")
        return {"kare_boyu": list(d.kare_boyu), "yatak_mm": list(d.yatak_mm),
                "etiketler": d.etiketler, "oz_denetim": d.oz_denetim(),
                "olcek_mm_px": d.olcek_ozeti(), "nadir_mm": d.nadir_mm,
                "kamera_yuksekligi_mm": d.kamera_yuksekligi_mm}

    @router.get("/saglik")
    async def saglik():
        """Bağımlılıklar bağlı mı, kalibrasyon yerinde mi — tek bakışta."""
        from .duzlem import Duzlem
        kal, kal_hata = None, None
        try:
            d = Duzlem.yukle(ayar.kalibrasyon_yolu)
            kal = {"kare_boyu": list(d.kare_boyu),
                   "artik_rms_mm": d.oz_denetim().get("artik_rms_mm"),
                   "paralaks_duzeltmesi": bool(d.nadir_mm and d.kamera_yuksekligi_mm)}
        except Exception as e:
            kal_hata = f"{type(e).__name__}: {e}"

        try:
            n = len(cevir(await _cagir(bitki_kaynagi)))
            kayit = {"bagli": True, "kayit_sayisi": n}
        except Exception as e:
            kayit = {"bagli": False, "hata": f"{type(e).__name__}: {e}"}

        return {
            "kalibrasyon": kal, "kalibrasyon_hatasi": kal_hata,
            "ekim_kaydi": kayit,
            "kopru": getattr(komut_gonder, "__qualname__", str(komut_gonder)),
            "isci": f"{sys.executable} -m gorus.isci (alt süreç)",
            "son_tarama": (depo.son_tarama() or {}).get("zaman"),
            "tarama_suruyor": kilit.locked(),
            "ayarlar": {"isleme_genisligi": ayar.kare.isleme_genisligi,
                        "max_artik_mm": ayar.max_kalibrasyon_artigi_mm,
                        "db": ayar.db_yolu},
        }

    return router
