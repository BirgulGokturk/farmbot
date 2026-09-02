# -*- coding: utf-8 -*-
"""Üç sabit baş — hangi iş hangi başla yapılıyor ve o baş nereye kaymış.

Z ekseninin ucuna üç baş KALICI olarak vidalı ve yan yana duruyorlar:
soldaki sulama başlığı, ortadaki toprak nemi probu, sağdaki tohum alma
ucu. Hiçbiri sökülmüyor, "hangi uç takılı" diye bir soru yok.

BU DOSYANIN VAR OLMA SEBEBİ TEK BİR CÜMLE: üçü aynı anda takılı olduğu
için hiçbiri Z ekseninin tam merkezinde değil. Her başın merkeze göre
kendi X/Y kayması var ve makine bir noktaya giderken HANGİ İŞİ yapacaksa
o başın kaymasını eklemek zorunda. Eklemezse iş ortadaki başla değil
başka bir başla yapılır ve koordinat kayar — sahada tam bu yaşandı:
ekim, tohum ucunun kayması uygulanmadığı için yanlış yere düşüyordu.

Kayma bir tercih değil, geometrinin kendisi. O yüzden burada tek bir
işlev var (`kaydir`) ve sulama, nem ölçümü, ekim üçü de ondan geçiyor;
her akış kendi hesabını yapsaydı üçü birbirinden ayrışırdı.

ULAŞILAMAYAN ŞERİT DE BAŞA GÖRE. Sulama başlığı 60 mm yanda olduğu için
yatağın sağ ve üst kenarında suyun gidemediği bir şerit vardı; her başın
kendi kayması olduğu için her başın kendi şeridi var. Bahçedeki gölge,
o an hangi işin yapılacağına göre çiziliyor.
"""
from __future__ import annotations

import math
from typing import Any

#: Baş kimlikleri — ekranda soldan sağa duruş sırası.
BASLAR = ("sulama", "nem", "tohum")

#: İŞ → BAŞ. Hangi işin hangi başla yapıldığı TEK YERDE yazılı; bahçe,
#: tarla ve ekim akışı buradan soruyor.
IS_BASI = {
    "sula": "sulama",
    "nem": "nem",
    "ek": "tohum",
    # Fotoğraf ve ziyaret bir başa dokunmuyor: makine gidiyor, üst kamera
    # bakıyor. Kayma uygulanmıyor, çünkü uygulanacak bir baş yok.
    "foto": "",
    "gez": "",
}

BAS_ADI = {
    "sulama": "sulama başlığı",
    "nem": "nem probu",
    "tohum": "tohum ucu",
}

VARSAYILAN = {"dx": 0.0, "dy": 0.0, "z_min": 0.0, "derinlik_mm": 0.0}

#: Sayıya çevrilmeyen, "girilmedi"si olan alanlar. `t_asagi_mm` için
#: sıfır geçerli bir T konumu; boşla karıştırmak kurulmamış bir ekseni
#: sıfıra sürmek olurdu.
ISTEGE_BAGLI = ("t_asagi_mm", "t_yukari_mm")


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
        return s if math.isfinite(s) else varsayilan
    except (TypeError, ValueError):
        return varsayilan


def hepsi(durum: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Durum paketinden üç başı okur; eksik olan kaymasız sayılır.

    Kaymasız varsaymak, kayma UYDURMAKTAN iyi: sıfır kayma "baş merkezde"
    demek ve o, ajan bağlı değilken verebileceğimiz tek dürüst cevap.
    """
    ham = ((durum or {}).get("uc") or {}).get("baslar") or {}
    cikti: dict[str, dict[str, Any]] = {}
    for kimlik in BASLAR:
        b = ham.get(kimlik) if isinstance(ham.get(kimlik), dict) else {}
        cikti[kimlik] = {alan: _sayi(b.get(alan), vars_)
                         for alan, vars_ in VARSAYILAN.items()}
        for alan in ISTEGE_BAGLI:
            deger = b.get(alan)
            cikti[kimlik][alan] = (None if deger in (None, "")
                                   else _sayi(deger, 0.0))
    return cikti


def bas(durum: dict[str, Any] | None, kimlik: str) -> dict[str, Any]:
    """Tek baş. Bilinmeyen kimlik kaymasız dönüyor."""
    return hepsi(durum).get(str(kimlik or ""), dict(VARSAYILAN))


def is_basi(tip: str) -> str:
    """Bu iş hangi başla yapılıyor? Bilinmeyen iş için '' (kayma yok)."""
    return IS_BASI.get(str(tip or ""), "")


def kaydir(x: float, y: float, b: dict[str, float] | None) -> tuple[float, float]:
    """Hedef noktadan MAKİNE noktasına.

    `x, y` işin yapılacağı yer (suyun düşeceği, tohumun gireceği,
    probun dalacağı nokta); dönen çift makinenin gideceği yer. İkisini
    ayrı tutmak şart: yasak bölge ve dikim alanı denetimleri İŞİN yerine,
    yumuşak sınır denetimi MAKİNENİN yerine bakıyor.
    """
    o = b or {}
    return (round(_sayi(x) + _sayi(o.get("dx")), 2),
            round(_sayi(y) + _sayi(o.get("dy")), 2))


def geri_al(mx: float, my: float, b: dict[str, float] | None) -> tuple[float, float]:
    """Makine noktasından iş noktasına — `kaydir`ın tersi."""
    o = b or {}
    return (round(_sayi(mx) - _sayi(o.get("dx")), 2),
            round(_sayi(my) - _sayi(o.get("dy")), 2))


def erisim(b: dict[str, float] | None, sinirlar: dict[str, Any] | None
           ) -> dict[str, float]:
    """Bu başın ERİŞEBİLDİĞİ dikdörtgen — yatak milimetresinde.

    Makine `hedef + kayma`ya gidiyor ve makinenin kendisi yumuşak
    sınırların dışına çıkamıyor. Yani pozitif kaymalı bir baş yatağın
    UZAK kenarına, negatif kaymalı bir baş YAKIN kenarına yetişemiyor.
    Bunu bir hata kutusuyla değil ekranda taralı bir şeritle göstermek
    için buradan çıkan dikdörtgen kullanılıyor: kullanıcı yasağı
    okuyarak değil görerek öğreniyor.
    """
    o = b or {}
    dx, dy = _sayi(o.get("dx")), _sayi(o.get("dy"))
    s = sinirlar or {}
    sx = s.get("x") or {}
    sy = s.get("y") or {}
    return {
        "x1": _sayi(sx.get("min"), 0.0) - dx,
        "x2": _sayi(sx.get("max"), 0.0) - dx,
        "y1": _sayi(sy.get("min"), 0.0) - dy,
        "y2": _sayi(sy.get("max"), 0.0) - dy,
    }


def ulasilir_mi(x: float, y: float, b: dict[str, float] | None,
                sinirlar: dict[str, Any] | None) -> tuple[bool, str]:
    """(ulaşılabilir mi, sebep). Sebep boşsa sorun yok."""
    a = erisim(b, sinirlar)
    mx, my = kaydir(x, y, b)
    if not a["x1"] - 0.01 <= _sayi(x) <= a["x2"] + 0.01:
        return False, (f"X{_sayi(x):.0f} bu başla erişilemiyor — makine "
                       f"X{mx:.0f}'e gitmesi gerekirdi "
                       f"({a['x1']:.0f}–{a['x2']:.0f} arası erişilebilir)")
    if not a["y1"] - 0.01 <= _sayi(y) <= a["y2"] + 0.01:
        return False, (f"Y{_sayi(y):.0f} bu başla erişilemiyor — makine "
                       f"Y{my:.0f}'ye gitmesi gerekirdi "
                       f"({a['y1']:.0f}–{a['y2']:.0f} arası erişilebilir)")
    return True, ""


def inis_z(b: dict[str, float] | None, yuzey_z: float,
           en_az_aciklik: float = 0.0) -> float:
    """Bu başın işini yaparken ineceği mutlak Z.

    `derinlik_mm` yüzeyin ne kadar ALTINA indiğini söylüyor (nem probu
    toprağa dalıyor), `z_min` ise o başın inebileceği en alçak mutlak Z —
    çarpma tabanı. Taban her zaman kazanıyor: derinlik bir istek, z_min
    bir sınır.
    """
    o = b or {}
    z = _sayi(yuzey_z) - _sayi(o.get("derinlik_mm")) + _sayi(en_az_aciklik)
    taban = _sayi(o.get("z_min"))
    return round(max(z, taban), 2)
