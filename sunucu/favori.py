"""Favori türler — panelde tür listelerinin başına çıkacak olanlar.

NİYE AYRI DOSYA. Katalog (`docs/bitki_turleri.json`) kurtarılmış kaynak,
salt okunur; `tur_ezme.json` ise türün ÖLÇÜLERİNİ eziyor (yayılım, sulama
süresi). Favorilik bir ölçü değil, kullanıcının çalışma düzeni: aynı
dosyaya karıştırmak, "bu türün spread_mm'i elle mi girilmiş" sorusunun
cevabını bulandırırdı. Ayrı dosya, ayrı sürüm, ayrı yedeklenir.

SUNUCUDA, TARAYICIDA DEĞİL. localStorage'a yazmak daha kolaydı ama
kullanıcı paneli telefondan açtığında favorileri kaybolurdu ve bunu
kimse fark etmezdi.

SIRALAMAYI BU MODÜL YAPMIYOR. Yalnız listeyi tutuyor; hangi açılır
listenin nasıl sıralanacağı panelin işi (`static/favori.js`). Sunucuda
sıralasaydık, tür listesini kendi içinde yeniden sıralayan her ekran
(örneğin `tarla.js` alfabetik sıralıyor) sonucu sessizce bozardı.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from typing import Any

from fastapi import APIRouter, HTTPException, Query

_KILIT = threading.RLock()

#: Slug biçimi — katalogdaki türlerin anahtarı. Serbest metin kabul etmek,
#: dosyayı panelden gelen her şeyin çöplüğüne çevirirdi.
SLUG_DESENI = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

#: Üst sınır. Favori listesi uzadıkça "favori" anlamını yitiriyor; ayrıca
#: sınırsız liste dosyayı panelden şişirilebilir hâle getirirdi.
AZAMI = 64


def _yol() -> str:
    ozel = os.environ.get("FAVORI_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "tur_favori.json")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "tur_favori.json")


def oku() -> list[str]:
    """Favori slug'ları, kullanıcının verdiği SIRAYLA.

    Sıra korunuyor çünkü favorilerin kendi içindeki düzeni de kullanıcının
    kararı; alfabetik sıralasaydık en çok kullanılanı üste alma imkânı
    kalmazdı.
    """
    yol = _yol()
    with _KILIT:
        if not os.path.exists(yol):
            return []
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            # Bozuk dosya sessizce yutulmuyor: yanına taşınıyor ki ne
            # olduğu sonradan bakılabilsin.
            try:
                os.replace(yol, yol + ".bozuk")
            except OSError:
                pass
            return []
    if not isinstance(veri, dict):
        return []
    liste = veri.get("favoriler")
    if not isinstance(liste, list):
        return []
    temiz: list[str] = []
    for ham in liste:
        s = str(ham or "").strip()
        if SLUG_DESENI.match(s) and s not in temiz:
            temiz.append(s)
    return temiz[:AZAMI]


def _yaz(favoriler: list[str]) -> None:
    yol = _yol()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _KILIT:
        gecici = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=klasor, prefix=".favori-",
            suffix=".tmp", delete=False)
        try:
            json.dump({"surum": 1, "favoriler": favoriler}, gecici,
                      ensure_ascii=False, indent=1)
            gecici.flush()
            os.fsync(gecici.fileno())
            gecici.close()
            os.replace(gecici.name, yol)
        except Exception:
            try:
                os.unlink(gecici.name)
            except OSError:
                pass
            raise


def degistir(slug: str, favori: bool) -> list[str]:
    """Bir türü favorilere ekler ya da çıkarır; yeni listeyi döner.

    YENİ FAVORİ BAŞA GİRİYOR, sona değil: bir türü yeni yıldızlamak
    çoğunlukla "şimdi bununla çalışıyorum" demek.
    """
    s = str(slug or "").strip()
    if not SLUG_DESENI.match(s):
        raise HTTPException(status_code=400,
                            detail=f"geçersiz tür anahtarı: {slug!r}")
    liste = [x for x in oku() if x != s]
    if favori:
        liste.insert(0, s)
        if len(liste) > AZAMI:
            raise HTTPException(
                status_code=409,
                detail=f"favori sınırı {AZAMI}; önce birini çıkarın")
    _yaz(liste)
    return liste


def sirala(slug_listesi: list[str]) -> list[str]:
    """Favorilerin kendi içindeki sırayı değiştirir.

    Yalnız hâlihazırda favori olanlar dikkate alınıyor: bu uç sıralama
    için, listeye eleman sokmak için değil.
    """
    var = set(oku())
    yeni: list[str] = []
    for ham in slug_listesi or []:
        s = str(ham or "").strip()
        if s in var and s not in yeni:
            yeni.append(s)
    # Gönderilmeyen favoriler kaybolmuyor; sona ekleniyor. Panel eksik bir
    # liste gönderdiğinde favori silmek, kullanıcının istemediği bir yan
    # etki olurdu.
    for s in oku():
        if s not in yeni:
            yeni.append(s)
    _yaz(yeni)
    return yeni


def yonlendirici_kur(parola_dogrula) -> APIRouter:
    """Uçları kurar. `main` içe aktarılmıyor — bağımlılık dışarıdan."""
    yonlendirici = APIRouter(prefix="/api/favori", tags=["favori"])

    @yonlendirici.get("")
    async def favori_listesi(jeton: str = Query(default="")):
        parola_dogrula(jeton)
        return {"favoriler": oku()}

    @yonlendirici.post("")
    async def favori_degistir(govde: dict[str, Any] | None = None,
                              jeton: str = Query(default="")):
        """{"slug": "marul", "favori": true} — ekler ya da çıkarır.

        {"sira": ["marul", "domates"]} gelirse yalnız sıra değişiyor.
        """
        parola_dogrula(jeton)
        istek = govde or {}
        if isinstance(istek.get("sira"), list):
            return {"favoriler": sirala(istek["sira"])}
        return {"favoriler": degistir(istek.get("slug") or "",
                                      bool(istek.get("favori")))}

    return yonlendirici
