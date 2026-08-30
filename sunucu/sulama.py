"""Sulama ofseti — suyun bitkinin NERESİNE bırakılacağı.

Neden gerekti
-------------
Sulama şimdiye kadar bitkinin tam üstüne gidip sabit süre akıtıyordu. Bu
her bitki için doğru değil: besleyici kökler kanopinin kenarında, yani
damlama hattında. Fideye 80 mm uzağa su vermek boşa akıtmak; olgun bir
domatese gövdeye akıtmak yaprağı ıslatıp kökü kuru bırakmak.

Model — tek formül, üç davranış
-------------------------------
    ofset = sulama_oran x (bitkinin O ANKİ yarıçapı)

Sorulan üç seçenek bunun içinde birer özel hâl, ayrı bir kip anahtarı yok:

  * `egri_yayilim` bağlıysa yarıçap YAŞA GÖRE değişiyor. 0. günde ~0
    (fidenin gövdesi), olgunlukta damlama hattı. Doğru davranış modelin
    kendisinden çıkıyor, ayrıca kural yazmıyoruz.
  * Eğri yoksa yarıçap türün OLGUN `spread_mm`/2 değeri — yani oran bir
    yüzde gibi çalışıyor. DİKKAT: bu hâlde fideye ilk günden olgun bitki
    mesafesi verilir. Panelde bu not alanın altında yazıyor.
  * Tür düzeyinde ikisi de sabitse sonuç sabit mm.

Ayrı bir `sabit_mm` toplama terimi bilerek YOK: eğrisiz hâl zaten onu
veriyor ve altıncı bir alan panelde karşılığı olmayan karmaşıklık olurdu.

Neden koordinatlar SUNUCUDA donuyor
-----------------------------------
Türetilmiş ofset her gün değişiyor. Robotun gittiği yerin kullanıcının
kafasındaki yerle aynı olması bu projenin ölçütü; onun için ofsetler
BURADA çözülüp diziye MUTLAK koordinat olarak yazılıyor. Ajan hiçbir şey
türetmiyor, yalnız gidilecek noktayı görüyor. Panelin önizlemede
gösterdiği ile dizinin taşıdığı böylece aynı sayı oluyor.

Ne BURADA değil
---------------
Yasak bölgeler, yumuşak sınırlar ve Z kilidi AJANDA kalıyor; bu dosya
onları kopyalamıyor. Burada yalnız dikim alanı denetimi var, çünkü o bir
veri geçerliliği kararı (bkz. dikim.py) ve ajan kopukken de işlemeli.
"""

from __future__ import annotations

import math
from typing import Any

import dikim
import egriler
import turler

# Vana açılıp kapanmasının sabit bir bedeli var (hat basınçlanması,
# damlama). Nokta başına süre bunun altına inerse noktaya giden gerçek
# hacim `V/N` olmuyor. O yüzden süreyi kısaltmak yerine NOKTA SAYISINI
# düşürüyoruz — bkz. `_nokta_sayisi`.
EN_KISA_SANIYE = 1.0

# Ucun toprak yüzeyine en fazla bu kadar yaklaşmasına izin var. Sulama
# ucunun toprağa dalması gerekmiyor; 20 mm, ölçüm hatası ve bitki
# hareketi için makul bir pay.
EN_AZ_ACIKLIK_MM = 20.0


class SulamaHatasi(Exception):
    """Ofset çözülemedi ya da sonuç kabul edilemez."""


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        d = float(deger)
    except (TypeError, ValueError):
        return varsayilan
    return d if math.isfinite(d) else varsayilan


def _egri_deger(ad: str, gun: float, egri_listesi: list[dict[str, Any]] | None):
    """Adı verilen eğrinin `gun` yaşındaki değeri; eğri yoksa None."""
    if not ad:
        return None
    for e in (egri_listesi or []):
        if e.get("ad") == ad:
            return egriler.deger(e, gun)
    return None


def yas_gun(bitki: dict[str, Any], simdi: float) -> float:
    """Bitkinin gün cinsinden yaşı. Ekim tarihi yoksa 0."""
    ekim = bitki.get("ekim")
    if ekim in (None, ""):
        return 0.0
    return max(0.0, (float(simdi) - float(ekim)) / 86400.0)


def _ozel(bitki: dict[str, Any], alan: str):
    ozel = bitki.get("ozel") or {}
    return ozel.get(alan)


def ayar_coz(bitki: dict[str, Any], tur: dict[str, Any] | None) -> dict[str, Any]:
    """Sulama ayarlarını ezme zincirinden çözer.

    Öncelik `spread_mm` ile AYNI: bitkinin `ozel` alanı > tür ezmesi >
    katalog/şema varsayılanı. Yeni bir mekanizma kurmuyoruz; kullanıcı
    zaten bu sırayı biliyor.
    """
    cikti: dict[str, Any] = {}
    for alan, varsayilan in turler.VARSAYILAN.items():
        deger = _ozel(bitki, alan)
        if deger in (None, ""):
            deger = (tur or {}).get(alan)
        if deger in (None, ""):
            deger = varsayilan
        try:
            cikti[alan] = turler.alan_dogrula(alan, deger)
        except turler.TurHatasi:
            # Bozuk bir ezme sulamayı kilitlemesin: varsayılana düşüyoruz.
            # Sessiz değil — çağıran `uyari` listesinde görüyor.
            cikti[alan] = varsayilan
            cikti.setdefault("_uyari", []).append(
                f"{turler.BASLIK[alan]} değeri okunamadı, varsayılan kullanıldı")
    return cikti


def guncel_yaricap_mm(bitki: dict[str, Any], tur: dict[str, Any] | None,
                      gun: float, egri_listesi=None) -> tuple[float, bool]:
    """(yarıçap_mm, eğriden_mi).

    Sıra: bitkinin `ozel.spread_mm`i > yayılım eğrisi > türün spread_mm'i.
    `ozel` en üstte, çünkü kullanıcı o bitki için açıkça bir çap yazmışsa
    eğri onu ezmemeli — `turAlani`'ndaki sıralamanın aynısı.
    """
    ozel_cap = _ozel(bitki, "spread_mm")
    if ozel_cap not in (None, ""):
        return max(0.0, _sayi(ozel_cap) / 2.0), False
    egri_cap = _egri_deger(str(bitki.get("egri_yayilim") or ""), gun, egri_listesi)
    if egri_cap is not None:
        return max(0.0, _sayi(egri_cap) / 2.0), True
    return max(0.0, _sayi((tur or {}).get("spread_mm"), 0.0) / 2.0), False


def guncel_yukseklik_mm(bitki: dict[str, Any], gun: float, egri_listesi=None) -> float:
    """Bitkinin o anki boyu; yükseklik eğrisi yoksa 0 (yüzey hizası)."""
    deger = _egri_deger(str(bitki.get("egri_yukseklik") or ""), gun, egri_listesi)
    return max(0.0, _sayi(deger, 0.0))


def _yonler(desen: str, aci_derece: float, adet: int) -> list[float]:
    """Desenin ürettiği açılar (radyan). `ust` için boş liste."""
    taban = math.radians(aci_derece % 360.0)
    if desen == "ust":
        return []
    if desen == "yan":
        return [taban]
    if desen == "iki":
        return [taban, taban + math.pi]
    if desen == "cember":
        return [taban + (2.0 * math.pi * i) / adet for i in range(adet)]
    raise SulamaHatasi(f"Bilinmeyen sulama deseni: {desen!r}")


def _nokta_sayisi(desen: str, istenen: int, toplam_saniye: float) -> tuple[int, str]:
    """(kullanılacak nokta sayısı, uyarı).

    Süre nokta başına EN_KISA_SANIYE'nin altına düşerse SÜREYİ değil
    NOKTA SAYISINI kısıyoruz: kısa bir vana darbesinin büyük kısmı
    geçici rejim olur ve noktaya giden gerçek hacim hesaplanandan sapar.
    """
    if desen == "ust":
        return 1, ""
    if desen == "yan":
        return 1, ""
    if desen == "iki":
        n = 2
    else:
        n = max(2, min(8, int(istenen)))
    sigan = int(toplam_saniye // EN_KISA_SANIYE)
    if sigan < 1:
        sigan = 1
    if sigan < n:
        return sigan, (f"{n} noktalık desen {sigan} noktaya indirildi: "
                       f"{toplam_saniye:g} sn bu kadar noktaya bölününce "
                       f"nokta başına {EN_KISA_SANIYE:g} sn'nin altına düşüyordu")
    return n, ""


def noktalar(bitki: dict[str, Any], tur: dict[str, Any] | None, *,
             toplam_saniye: float, simdi: float, guvenli_z: float,
             genel_toprak_z: float = 0.0,
             egri_listesi: list[dict[str, Any]] | None = None,
             dikim_alanlari: list[dict[str, Any]] | None = None,
             ) -> dict[str, Any]:
    """Bir bitki için sulama noktalarını çözer.

    Dönen:
      {"noktalar": [{"x","y","z","saniye","aci"}...],
       "desen": str, "ofset_mm": float, "yuzey_z": float,
       "egriden": bool, "uyari": [str...], "ret": [str...]}

    `ret` doluysa bu bitki sulanamaz; çağıran diziyi HİÇ başlatmamalı.
    """
    ayar = ayar_coz(bitki, tur)
    uyari: list[str] = list(ayar.pop("_uyari", []))
    ret: list[str] = []

    gun = yas_gun(bitki, simdi)
    bx, by = _sayi(bitki.get("x")), _sayi(bitki.get("y"))
    desen = str(ayar["sulama_deseni"])

    toplam_saniye = max(EN_KISA_SANIYE, _sayi(toplam_saniye, 3.0))
    adet, n_uyari = _nokta_sayisi(desen, int(_sayi(ayar["sulama_nokta"], 4.0)), toplam_saniye)
    if n_uyari:
        uyari.append(n_uyari)

    yaricap, egriden = guncel_yaricap_mm(bitki, tur, gun, egri_listesi)
    ofset = max(0.0, _sayi(ayar["sulama_oran"]) * yaricap)
    if desen != "ust" and not egriden:
        uyari.append(
            f"Yayılım eğrisi bağlı değil: ofset OLGUN çaptan hesaplandı "
            f"({yaricap * 2:.0f} mm), bitkinin bugünkü boyundan değil")

    # --- Z: yüzey + o anki boy + açıklık -----------------------------------
    # Toprak yüzeyi noktadan noktaya değişebiliyor (kaplar aynı hizada
    # olmayabilir), o yüzden alanından soruluyor.
    yuzey_z = dikim.toprak_yuzeyi(bx, by, genel_toprak_z, dikim_alanlari)
    boy = guncel_yukseklik_mm(bitki, gun, egri_listesi)
    aciklik = max(EN_AZ_ACIKLIK_MM, _sayi(ayar["sulama_aciklik_mm"], 50.0))
    sulama_z = yuzey_z + boy + aciklik
    # Güvenli Z tavan: ucun daha yükseğe çıkmasına gerek yok ve güvenli
    # Z'nin ÜSTÜ zaten serbest gezinme yüksekliği.
    if sulama_z > guvenli_z:
        # Kırpma SESSİZ olmuyor. Boyu güvenli Z'yi aşan bir bitkide uç
        # istenenden yükseklerde kalıyor; su daha geniş bir alana
        # dağılıyor ve nokta hedefi bulanıklaşıyor. Reddetmiyoruz —
        # yukarıdan sulamak çalışıyor — ama kullanıcı bunu bilmeli.
        uyari.append(
            f"Uç istenen yükseklikte duramadı: yüzey {yuzey_z:.0f} + boy "
            f"{boy:.0f} + açıklık {aciklik:.0f} = Z{sulama_z:.0f}, güvenli Z "
            f"{guvenli_z:.0f} mm ile sınırlandı. Su kanopinin "
            f"{guvenli_z - yuzey_z - boy:.0f} mm üstünden düşecek.")
        sulama_z = guvenli_z
    if sulama_z < yuzey_z + EN_AZ_ACIKLIK_MM:
        # Yüzey güvenli Z'den yüksekse ayar tutarsız demektir; sessizce
        # toprağa inmektense reddediyoruz.
        ret.append(
            f"Sulama yüksekliği hesaplanamadı: yüzey Z{yuzey_z:.0f} + boy "
            f"{boy:.0f} + açıklık {aciklik:.0f} mm, güvenli Z {guvenli_z:.0f} mm'nin "
            f"üstüne çıkıyor. Güvenli Z'yi yükseltin ya da uç açıklığını düşürün.")
        return {"noktalar": [], "desen": desen, "ofset_mm": ofset,
                "yuzey_z": yuzey_z, "egriden": egriden, "uyari": uyari, "ret": ret}

    # --- noktalar -----------------------------------------------------------
    yonler = _yonler(desen, _sayi(ayar["sulama_aci"]), adet)
    pay = round(toplam_saniye / max(1, len(yonler) or 1), 2)
    cikti: list[dict[str, Any]] = []
    if not yonler:
        cikti.append({"x": round(bx, 2), "y": round(by, 2), "z": round(sulama_z, 2),
                      "saniye": round(toplam_saniye, 2), "aci": None})
    else:
        for a in yonler:
            cikti.append({
                "x": round(bx + ofset * math.cos(a), 2),
                "y": round(by + ofset * math.sin(a), 2),
                "z": round(sulama_z, 2),
                "saniye": pay,
                "aci": round(math.degrees(a) % 360.0, 1),
            })

    # --- dikim alanı denetimi: OFSETLİ konuma göre --------------------------
    # Bitkinin kendi konumu alanın içinde olsa bile ofsetli nokta dışına
    # düşebiliyor; denetlenen artık su GERÇEKTEN nereye gidiyorsa orası.
    if dikim_alanlari:
        for nk in cikti:
            kabul, _, _ = dikim.nokta_kabul(nk["x"], nk["y"], dikim_alanlari)
            if kabul:
                continue
            if desen == "ust":
                ret.append(
                    f"X{nk['x']:.1f} Y{nk['y']:.1f} dikim alanı dışında — "
                    f"bitkiyi alanın içine taşıyın")
            else:
                # SEBEP + ÇÖZÜM. Sabit açı, kenardaki bitkide suyu duvara
                # nişanlayabiliyor; kullanıcıya ne yapacağını söylemek
                # "reddedildi" demekten çok daha işe yarıyor.
                ret.append(
                    f"X{nk['x']:.1f} Y{nk['y']:.1f} dikim alanı dışında "
                    f"({nk['aci']:.0f}° yönünde {ofset:.0f} mm ofset) — "
                    f"ofset yönünü (sulama_aci) çevirin, ofseti "
                    f"(sulama_oran) küçültün ya da bu bitkide deseni "
                    f"'tam üst' yapın")

    return {"noktalar": cikti, "desen": desen, "ofset_mm": round(ofset, 1),
            "yuzey_z": round(yuzey_z, 1), "boy_mm": round(boy, 1),
            "egriden": egriden, "uyari": uyari, "ret": ret}
