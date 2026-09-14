# -*- coding: utf-8 -*-
"""izgara_uc — `izgara` paketinin panel ucu: makinenin kendi turuyla kalibrasyon.

FARKI NE. Yataktaki dört AprilTag ile kurulan harita, etiketlerin kendi
üstünde 0,00 mm sapma gösteriyor ve bu bir doğruluk değil, matematiksel
zorunluluk: homografinin 8 serbestliği var, dört nokta 8 kısıt verir,
artık zorunlu olarak sıfırdır. Lens distorsiyonu o sıfırın içine emilir
ve GÖRÜNMEZ. Paketin benzetimi ölçtü: aynı kalibrasyon bağımsız
noktalarda 6,16 mm yanılıyor.

Burada işaret KAFADA duruyor ve makine onu bilinen noktalara götürüyor.
Enkoder zaten gerçek değeri veriyor, zaten istenen eksende. Prob ile
etiket merkezi ölçmek yok.

İKİ YÜKSEKLİK ŞART. Tek yükseklikte toplanan noktalar yalnız o düzlem
için geçerli bir model kurar ve topraktan yüksekteki yaprak BOYU KADAR
kayar (benzetimde 30 mm yaprak 29,75 mm yanlış yerde). İki yükseklikte
toplanınca paketin 'uzay' modeli kuruluyor ve paralaks çözülüyor.

TUR PANELDEN, NOKTA NOKTA SÜRÜLÜYOR. Bütün turu tek bir HTTP isteğine
koymak, 48 durak boyunca cevapsız kalan bir bağlantı ve ilerlemesi
görünmeyen bir makine demekti. Her durak kendi isteği: panel sırayı
biliyor, kullanıcı nerede olduğunu görüyor, bir durak kaçarsa tur devam
ediyor.

MAKİNE HAREKET EDİYOR. Paketin kendisi `onay=True` olmadan tek adım
atmıyor; buradaki uç da her durakta `onay` bekliyor.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from typing import Any

import kalibrasyon

#: Harekete bu kadar süre veriliyor; sonrası "ulaşamadı".
GIT_ZAMAN_ASIMI_SN = 60.0

#: Hareket bitince titreşim sönene kadar. Bulanık kare işaretin merkezini
#: kaydırıyor ve o kayma doğrudan kalibrasyon hatası oluyor.
VARSAYILAN_BEKLEME_SN = 1.2

#: İşaretin varsayılan kimliği. Yataktaki kalibrasyon etiketleri (0, 1, 8,
#: 9) ile ÇAKIŞMAMALI: aynı kimlik iki yerde görünürse hangisinin kafada
#: olduğu bilinemez.
VARSAYILAN_KIMLIK = 23

_KILIT = threading.RLock()
_oturum: dict[str, Any] = {"noktalar": [], "kacirilan": [], "kare_boyu": None,
                           "ayar": {}, "baslangic": None}


def _veri_dizin() -> str:
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.dirname(veri) or "."
    return os.path.dirname(os.path.abspath(__file__))


def _model_yolu(kamera: str) -> str:
    return os.path.join(_veri_dizin(), f"izgara_model_{kamera}.json")


def _nokta_yolu(kamera: str) -> str:
    return os.path.join(_veri_dizin(), f"izgara_noktalar_{kamera}.json")


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        return float(deger)
    except (TypeError, ValueError):
        return varsayilan


def yukseklik(z_makine: float, z_toprak_mm: float, isaret_ofset_mm: float,
              t_makine: float | None = None, t_toprak_mm: float | None = None,
              t_yon: float = 1.0, isaret_yeri: str = "kafa") -> float:
    """İşaretin toprak YÜZEYİNDEN yüksekliği.

    Paketin `Tur.yukseklik`i ile aynı temel: `(Z − Z_toprak) + ofset`.
    Tur burada nokta nokta sürüldüğü için ayrı yazıldı.

    T NEREDE FARK EDİYOR — ve nerede etmiyor.

    Toprağa T ile ulaşmak ölçümü kolaylaştırıyor: prob kendi ekseniyle
    iniyor, kafayı toprağa yaklaştırmak gerekmiyor. Ama işaret KAFADA
    duruyorsa T'nin konumu işareti oynatmıyor — işaretin yüksekliği
    yalnız kafanın Z'sine bağlı. `isaret_ofset_mm` zaten "prob toprağa
    DEĞERKEN işaretin toprak yüzeyinden yüksekliği" diye ölçülüyor, yani
    o andaki T uzamasını içinde taşıyor. Bu durumda T'yi formüle ikinci
    kez sokmak, aynı mesafeyi iki kez saymak olurdu.

    İşaret T ARABASINA (ucun kendisine) yapıştırılmışsa durum tersine
    dönüyor: T indikçe işaret de iniyor ve T, Z'den daha ince bir
    yükseklik ekseni oluyor. O zaman katkı gerçek.

    `t_yon`: T sayısı BÜYÜRKEN uç aşağı iniyorsa +1, yukarı çıkıyorsa −1.
    Bu eksenin yönü kalibrasyondan geliyor ve makineye göre değişiyor;
    varsayıp yanlış işaretle kurmaktansa soruyoruz.
    """
    h = (float(z_makine) - float(z_toprak_mm)) + float(isaret_ofset_mm)
    if isaret_yeri == "t_ucu" and t_makine is not None and t_toprak_mm is not None:
        h += float(t_yon) * (float(t_toprak_mm) - float(t_makine))
    return h


def _bgr_coz(jpeg: bytes):
    import cv2
    import numpy as np
    return cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)


def _durum() -> dict[str, Any]:
    with _KILIT:
        n = list(_oturum["noktalar"])
        yuk: dict[str, int] = {}
        for p in n:
            a = f"{p.h_mm:.1f}"
            yuk[a] = yuk.get(a, 0) + 1
        return {
            "nokta": len(n),
            "kacirilan": len(_oturum["kacirilan"]),
            "yukseklikler": yuk,
            "kare_boyu": _oturum["kare_boyu"],
            "ayar": dict(_oturum["ayar"]),
            # İKİ YÜKSEKLİK YOKSA 'uzay' KURULAMAZ: panel bunu turun
            # ortasında söylemeli, sonunda değil.
            "uzay_olabilir": len(yuk) >= 2,
            "yeter_mi": len(n) >= 6,
        }


def temizle() -> dict[str, Any]:
    with _KILIT:
        _oturum["noktalar"] = []
        _oturum["kacirilan"] = []
        _oturum["kare_boyu"] = None
        _oturum["baslangic"] = None
    return _durum()


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def yonlendirici_kur(parola_dogrula, canli_kare, git_ve_bekle,
                     komut_gonder=None):
    """`git_ve_bekle(x, y, z)` hareketi yapıp BİTMESİNİ bekliyor, sorunu döner.

    `otokalib` ile aynı iki bağımlılık: ikinci bir hareket yolu açmak,
    güvenlik denetimlerinin yalnız birinden geçen bir hareket demekti.
    """
    import inspect

    from fastapi import APIRouter, HTTPException, Query

    yon = APIRouter()

    def _paket():
        try:
            import izgara.model as m
            import izgara.tur as t
            from izgara.isaret import AprilTagBulucu
            return m, t, AprilTagBulucu
        except ImportError as hata:
            raise HTTPException(status_code=503,
                                detail=f"izgara paketi yüklenemedi: {hata}")

    @yon.get("/api/izgara/durum")
    async def _durum_uc(jeton: str = Query(default="")):
        parola_dogrula(jeton)
        d = _durum()
        kam = str((d.get("ayar") or {}).get("kamera") or "")
        d["model_var"] = bool(kam) and os.path.exists(_model_yolu(kam))
        return d

    @yon.post("/api/izgara/plan")
    async def _plan(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        """Durakları üretir. HAREKET YOK — plan görülmeden tur başlamasın."""
        parola_dogrula(jeton)
        _m, t, _b = _paket()
        g = govde or {}
        z = [_sayi(v) for v in (g.get("z") or [])]
        if len(z) < 1:
            raise HTTPException(status_code=422, detail="En az bir Z değeri gerekli")
        ayar = {
            "kamera": kalibrasyon.ad_temizle(g.get("kamera")),
            "kimlik": int(_sayi(g.get("kimlik"), VARSAYILAN_KIMLIK)),
            "z_toprak_mm": _sayi(g.get("z_toprak_mm")),
            "isaret_ofset_mm": _sayi(g.get("isaret_ofset_mm")),
            "bekleme_sn": max(0.0, _sayi(g.get("bekleme_sn"), VARSAYILAN_BEKLEME_SN)),
            "yatak": [_sayi(v) for v in (g.get("yatak") or [495.0, 610.0])],
            "nx": int(_sayi(g.get("nx"), 4)),
            "ny": int(_sayi(g.get("ny"), 6)),
            "pay_mm": _sayi(g.get("pay_mm"), 40.0),
            "z": z,
            # T: turun her durağında bu konum uygulanıyor. Boş bırakılırsa
            # T hiç sürülmüyor ve yukarıda kalıyor.
            "t": [_sayi(v) for v in (g.get("t") or [])],
            "t_toprak_mm": (None if g.get("t_toprak_mm") in (None, "")
                            else _sayi(g.get("t_toprak_mm"))),
            "t_yon": 1.0 if _sayi(g.get("t_yon"), 1.0) >= 0 else -1.0,
            "isaret_yeri": ("t_ucu" if str(g.get("isaret_yeri") or "kafa") == "t_ucu"
                            else "kafa"),
        }
        # DURAKLARA T EKLENİYOR. `tur_planla` üç eksen biliyor; T bu
        # projeye özgü ve yılankavi sırayı bozmadan her durağa
        # kopyalanıyor. İşaret T arabasındaysa yükseklik çeşitliliğini
        # T veriyor, o zaman her T değeri için ayrı bir tur geçiliyor.
        tl = ayar["t"] or [None]
        plan = []
        for tv in tl:
            for x_, y_, z_ in t.tur_planla(yatak_mm=tuple(ayar["yatak"][:2]),
                                           nx=ayar["nx"], ny=ayar["ny"],
                                           pay_mm=ayar["pay_mm"],
                                           z_listesi=tuple(z)):
                plan.append((x_, y_, z_, tv))
        yukler = sorted({round(yukseklik(v, ayar["z_toprak_mm"],
                                         ayar["isaret_ofset_mm"], tv,
                                         ayar["t_toprak_mm"], ayar["t_yon"],
                                         ayar["isaret_yeri"]), 2)
                         for v in z for tv in tl})
        uyarilar = []
        if len(yukler) < 2:
            uyarilar.append(
                "Tek yükseklik: 'uzay' modeli kurulamaz, paralaks çözülmez. "
                "Topraktan yüksekteki yaprak boyu kadar kayar.")
        if any(v < 0 for v in yukler):
            # Z YÖNÜ TERS OLABİLİR. Bu makinede Z yukarı doğru BÜYÜYOR;
            # negatif yükseklik, işaretin toprağın altında olduğunu
            # söyler ve bu fiziksel olarak imkânsız. Sessizce kurup
            # anlamsız bir model üretmektense burada duruyoruz.
            uyarilar.append(
                f"Yükseklik negatif çıktı ({yukler}). Girilen Z değerleri "
                "toprak Z'sinin ALTINDA kalıyor ya da toprak Z'si yanlış.")
        if ayar["isaret_yeri"] == "t_ucu" and (
                not ayar["t"] or ayar["t_toprak_mm"] is None):
            uyarilar.append(
                "İşaret T ucunda seçildi ama T değerleri ya da toprak T'si "
                "girilmedi: T'nin yükseklik katkısı hesaplanamaz.")
        with _KILIT:
            _oturum["ayar"] = ayar
        return {"plan": [[round(x, 2), round(y, 2), round(z_, 2),
                          None if tv is None else round(tv, 2)]
                         for x, y, z_, tv in plan],
                "durak": len(plan), "yukseklikler_mm": yukler,
                "uyarilar": uyarilar, "durum": _durum()}

    @yon.post("/api/izgara/nokta")
    async def _nokta(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        """Makineyi bir durağa götürüp kafadaki işareti ölçüyor.

        MAKİNE HAREKET EDİYOR: `onay` olmadan çalışmıyor.
        """
        parola_dogrula(jeton)
        m, _t, AprilTagBulucu = _paket()
        g = govde or {}
        if not g.get("onay"):
            raise HTTPException(status_code=403,
                                detail="Bu istek makineyi hareket ettirir; onay gerekli.")
        with _KILIT:
            ayar = dict(_oturum["ayar"])
        if not ayar:
            raise HTTPException(status_code=409,
                                detail="Önce planı üretin (ayarlar orada saklanıyor).")
        try:
            x, y, z = (float(g["x"]), float(g["y"]), float(g["z"]))
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=422, detail="x, y, z sayı olmalı")
        t_hedef = None if g.get("t") in (None, "") else _sayi(g.get("t"))

        # SIRA ŞART: T YUKARI -> YATAY HAREKET -> T AŞAĞI.
        #
        # Tohum ucu aşağıdayken X/Y sürmek ucu toprağa sürtmek demek ve
        # ajan bunu zaten reddediyor (`t_yatay_engel`). Reddi hataya
        # çevirip turu düşürmektense doğru sırayı burada kuruyoruz.
        if komut_gonder is not None:
            try:
                await komut_gonder("tohum_ucu", {"yukari": True})
            except Exception as hata:                       # noqa: BLE001
                raise HTTPException(status_code=409,
                                    detail=f"Tohum ucu yukarı çekilemedi: {hata}")

        sorun = await git_ve_bekle(x, y, z, GIT_ZAMAN_ASIMI_SN)
        if sorun:
            raise HTTPException(status_code=409, detail=sorun)

        if t_hedef is not None and komut_gonder is not None:
            # `t_git` ajanda SENKRON: dönünce eksen yerine oturmuş olur,
            # ayrıca bir bekleme yolu kurmaya gerek yok.
            cevap = await komut_gonder("tohum_ucu", {"mm": t_hedef})
            if not (cevap or {}).get("ok", True):
                raise HTTPException(
                    status_code=409,
                    detail=f"Tohum ucu {t_hedef} mm'ye inemedi: "
                           f"{(cevap or {}).get('mesaj') or ''}")
        # Titreşim sönsün: hareket biter bitmez alınan kare bulanık olur
        # ve bulanıklık doğrudan işaret merkezini kaydırır.
        await asyncio.sleep(ayar.get("bekleme_sn", VARSAYILAN_BEKLEME_SN))

        kam = ayar["kamera"]
        try:
            jpeg = canli_kare(kam)
            if inspect.isawaitable(jpeg):
                jpeg = await jpeg
        except Exception as hata:                           # noqa: BLE001
            raise HTTPException(status_code=409, detail=str(hata))
        if not jpeg:
            raise HTTPException(status_code=409, detail=f"[{kam}] taze kare alınamadı.")

        try:
            kare = await asyncio.to_thread(_bgr_coz, jpeg)
        except ImportError as hata:
            raise HTTPException(status_code=503, detail=f"OpenCV yok: {hata}")
        if kare is None:
            raise HTTPException(status_code=422, detail="Kare çözülemedi")

        bulucu = AprilTagBulucu(kimlik=ayar["kimlik"])
        bulgu = await asyncio.to_thread(bulucu.bul, kare)
        h = yukseklik(z, ayar["z_toprak_mm"], ayar["isaret_ofset_mm"],
                      t_hedef, ayar.get("t_toprak_mm"), ayar.get("t_yon", 1.0),
                      ayar.get("isaret_yeri", "kafa"))

        with _KILIT:
            _oturum["kare_boyu"] = [int(kare.shape[1]), int(kare.shape[0])]
            if _oturum["baslangic"] is None:
                _oturum["baslangic"] = time.time()
            if bulgu is None:
                _oturum["kacirilan"].append({"x_mm": x, "y_mm": y,
                                             "z_mm": z, "t_mm": t_hedef})
            else:
                _oturum["noktalar"].append(
                    m.Nokta(u_px=float(bulgu.u_px), v_px=float(bulgu.v_px),
                            x_mm=x, y_mm=y, h_mm=h, etiket=str(bulgu.not_ or "")))

        return {"bulundu": bulgu is not None,
                "u_px": None if bulgu is None else round(float(bulgu.u_px), 2),
                "v_px": None if bulgu is None else round(float(bulgu.v_px), 2),
                "h_mm": round(h, 2), "durum": _durum()}

    @yon.post("/api/izgara/kur")
    async def _kur(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        """Toplanan noktalardan modeli kurar ve ÇAPRAZ DOĞRULAR.

        Rapordaki `kendi_artigi_rms_mm` doğruluk değildir — model o
        noktalara uydurulmuş. Bakılacak sayı `capraz_dogrulama.rms_mm`:
        her nokta bir kez dışarıda bırakılarak ölçülüyor ve ek nokta
        gerektirmiyor.
        """
        parola_dogrula(jeton)
        m, _t, _b = _paket()
        g = govde or {}
        with _KILIT:
            noktalar = list(_oturum["noktalar"])
            boyut = _oturum["kare_boyu"]
            ayar = dict(_oturum["ayar"])
        if len(noktalar) < 6:
            raise HTTPException(
                status_code=422,
                detail=f"En az 6 nokta gerekli, {len(noktalar)} var. "
                       "Dört noktayla distorsiyon ölçülemez ve hatası gizli kalır.")
        if not boyut:
            raise HTTPException(status_code=409, detail="Kare boyutu bilinmiyor")

        def _hesapla():
            model = m.kur(noktalar, tuple(boyut))
            model.rapor["capraz_dogrulama"] = m.capraz_dogrula(noktalar, tuple(boyut))
            return model

        try:
            model = await asyncio.to_thread(_hesapla)
        except Exception as hata:                           # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"{type(hata).__name__}: {hata}")

        kam = ayar.get("kamera") or kalibrasyon.VARSAYILAN_KAMERA
        yazildi = {}
        if g.get("kaydet", True):
            os.makedirs(_veri_dizin(), exist_ok=True)
            model.kaydet(_model_yolu(kam))
            # HAM NOKTALAR DA SAKLANIYOR: modeli yeniden kurmak için
            # turu tekrarlamak gerekmesin.
            from dataclasses import asdict
            with open(_nokta_yolu(kam), "w", encoding="utf-8") as d:
                json.dump([asdict(p) for p in noktalar], d, ensure_ascii=False)
            yazildi = {"model": _model_yolu(kam), "noktalar": _nokta_yolu(kam)}

        kopru = None
        if g.get("kopru"):
            # KÖPRÜ KAYIPSIZ DEĞİL: homografi distorsiyonu temsil edemez.
            # Paketin ölçtüğü kayıp 2,70 mm rms. Yine de şimdiki 4 etiketli
            # haritadan belirgin iyi ve HİÇBİR dosya değişmeden çalışıyor.
            import izgara.baglayici as b
            h_mm = _sayi(g.get("h_mm"), 0.0)
            kopru = await asyncio.to_thread(b.harita_uret, model, h_mm)
            if g.get("kalibrasyona_yaz"):
                eski = kalibrasyon.oku(kam)
                yeni = b.kayda_yaz(dict(eski), model, h_mm)
                kalibrasyon.kaydet(yeni, kam)
                kopru = {**kopru, "kalibrasyona_yazildi": True}

        return {"tur": model.tur, "rapor": model.rapor, "yazildi": yazildi,
                "kopru": kopru, "durum": _durum()}

    @yon.post("/api/izgara/temizle")
    async def _temizle(jeton: str = Query(default="")):
        parola_dogrula(jeton)
        return temizle()

    @yon.post("/api/izgara/sorgu")
    async def _sorgu(govde: dict[str, Any] | None = None, jeton: str = Query(default="")):
        """Tek piksel -> mm. Kalibre edilen bölgenin dışıysa UYARIYOR."""
        parola_dogrula(jeton)
        m, _t, _b = _paket()
        g = govde or {}
        kam = kalibrasyon.ad_temizle(g.get("kamera"))
        yol = _model_yolu(kam)
        if not os.path.exists(yol):
            raise HTTPException(status_code=404,
                                detail=f"[{kam}] için ızgara modeli yok")
        model = await asyncio.to_thread(m.Model.yukle, yol)
        try:
            u, v = float(g["u"]), float(g["v"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=422, detail="u, v sayı olmalı")
        h_mm = None if g.get("h_mm") in (None, "") else _sayi(g.get("h_mm"))
        try:
            xy = model.px2mm([[u, v]], h_mm)[0]
        except Exception as hata:                           # noqa: BLE001
            raise HTTPException(status_code=422, detail=str(hata))
        icinde = bool(model.kalibre_bolgede_mi([[u, v]])[0])
        return {"x_mm": round(float(xy[0]), 2), "y_mm": round(float(xy[1]), 2),
                "bolgede": icinde, "tur": model.tur,
                "uyari": "" if icinde else
                         ("Piksel kalibre edilen bölgenin dışında — burası "
                          "uzatmadır, hatası ölçülmemiştir.")}

    return yon
