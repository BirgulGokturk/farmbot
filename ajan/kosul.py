"""Yasak bölge koşulları için küçük ifade değerlendiricisi.

Neden `eval()` yok
------------------
Referans program koşulları `eval(expr, {"__builtins__":{}}, ns)` ile
çalıştırıyor. Bu, bir bölge tanımını **kod çalıştırma yetkisi** hâline
getiriyor: panele erişebilen biri `allow_if` alanına yazdığı şeyle ajanın
içinde istediğini yapabilir. `__builtins__` boşaltmak da yeterli bir kalkan
değildir — nesne öznitelikleri üzerinden dolaşmanın bilinen yolları var.
Burada ihtiyacımız olan şey bir dil değil, birkaç karşılaştırma; o kadarını
yazmak yüz satır tutuyor ve saldırı yüzeyi sıfır.

Dilbilgisi
----------
    ifade   := veya
    veya    := ve ( "or" ve )*
    ve      := degil ( "and" degil )*
    degil   := "not" degil | karsilastirma
    karsilastirma := atom ( ("=="|"!="|"<"|"<="|">"|">=") atom )?
    atom    := sayı | 'metin' | isim | "(" ifade ")"

Desteklenen değişkenler çağıran tarafından veriliyor (x, y, z, prox, tool,
safe_z, zmax). Başka isim yok, fonksiyon yok, öznitelik yok, indeksleme yok.

Hata felsefesi: **fail-closed.** Bilinmeyen isim, bozuk sözdizimi, tip
uyuşmazlığı — hepsi istisna fırlatır ve çağıran taraf bunu "koşul sağlanmadı"
olarak yorumlar, yani hareket engellenir. Güvenlikte şüphe, izin verme yönünde
çözülmez.
"""

from __future__ import annotations

import re
from typing import Any

__all__ = ["KosulHatasi", "degerlendir", "dogrula"]


class KosulHatasi(Exception):
    """Bozuk ifade ya da bilinmeyen isim. Çağıran taraf bunu 'engelle' sayar."""


# Uzun ifadeler ne bir ihtiyaç ne de okunabilir; sınır aynı zamanda kötü niyetli
# girdiye karşı ucuz bir korumadır.
AZAMI_UZUNLUK = 200

_SIMGE = re.compile(r"""
    \s*(?:
      (?P<sayi>\d+\.\d+|\.\d+|\d+)
    | (?P<metin>'[^']*'|"[^"]*")
    | (?P<isim>[A-Za-z_][A-Za-z_0-9]*)
    | (?P<karsilastirma><=|>=|==|!=|<|>)
    | (?P<parantez>[()])
    )
""", re.X)


def _parcala(ifade: str) -> list[tuple[str, Any]]:
    simgeler: list[tuple[str, Any]] = []
    konum = 0
    while konum < len(ifade):
        if ifade[konum].isspace():
            konum += 1
            continue
        eslesme = _SIMGE.match(ifade, konum)
        if not eslesme or eslesme.end() == konum:
            raise KosulHatasi(f"Anlaşılmayan karakter: {ifade[konum]!r} ({konum}. konumda)")
        konum = eslesme.end()
        tur = eslesme.lastgroup
        deger = eslesme.group(tur)
        if tur == "sayi":
            simgeler.append(("sabit", float(deger)))
        elif tur == "metin":
            simgeler.append(("sabit", deger[1:-1]))
        elif tur == "isim":
            kucuk = deger.lower()
            if kucuk in ("and", "or", "not"):
                simgeler.append((kucuk, kucuk))
            elif kucuk in ("true", "false"):
                simgeler.append(("sabit", kucuk == "true"))
            else:
                simgeler.append(("isim", deger))
        elif tur == "karsilastirma":
            simgeler.append(("karsilastirma", deger))
        else:
            simgeler.append((deger, deger))
    return simgeler


class _Ayristirici:
    def __init__(self, simgeler: list[tuple[str, Any]], degiskenler: dict[str, Any]) -> None:
        self.s = simgeler
        self.i = 0
        self.d = degiskenler

    def _bak(self) -> tuple[str, Any] | None:
        return self.s[self.i] if self.i < len(self.s) else None

    def _al(self) -> tuple[str, Any]:
        if self.i >= len(self.s):
            raise KosulHatasi("İfade beklenenden erken bitti")
        self.i += 1
        return self.s[self.i - 1]

    # --- dilbilgisi ---
    def veya(self) -> Any:
        sonuc = self.ve()
        while (b := self._bak()) and b[0] == "or":
            self._al()
            sag = self.ve()
            sonuc = bool(sonuc) or bool(sag)
        return sonuc

    def ve(self) -> Any:
        sonuc = self.degil()
        while (b := self._bak()) and b[0] == "and":
            self._al()
            sag = self.degil()
            sonuc = bool(sonuc) and bool(sag)
        return sonuc

    def degil(self) -> Any:
        if (b := self._bak()) and b[0] == "not":
            self._al()
            return not bool(self.degil())
        return self.karsilastirma()

    def karsilastirma(self) -> Any:
        sol = self.atom()
        if (b := self._bak()) and b[0] == "karsilastirma":
            islec = self._al()[1]
            sag = self.atom()
            return self._karsilastir(sol, islec, sag)
        return sol

    @staticmethod
    def _karsilastir(sol: Any, islec: str, sag: Any) -> bool:
        if islec == "==":
            return sol == sag
        if islec == "!=":
            return sol != sag
        # Sıralama karşılaştırmaları yalnızca sayılarda anlamlı. Python'da
        # "abc" < "b" çalışır ama bir bölge koşulunda bunu isteyen kimse yok;
        # sessizce bir anlam uydurmaktansa hata verip engellemek doğru.
        if isinstance(sol, bool) or isinstance(sag, bool) \
                or not isinstance(sol, (int, float)) or not isinstance(sag, (int, float)):
            raise KosulHatasi(f"'{islec}' yalnızca sayılarla kullanılabilir ({sol!r}, {sag!r})")
        if islec == "<":
            return sol < sag
        if islec == "<=":
            return sol <= sag
        if islec == ">":
            return sol > sag
        return sol >= sag

    def atom(self) -> Any:
        tur, deger = self._al()
        if tur == "sabit":
            return deger
        if tur == "isim":
            if deger not in self.d:
                # Yazım hatası da olabilir, kötü niyet de. İkisinde de sonuç
                # aynı: koşul sağlanmadı sayılır, hareket engellenir.
                raise KosulHatasi(
                    f"Bilinmeyen değişken: '{deger}'. Kullanılabilir: "
                    + ", ".join(sorted(self.d)))
            return self.d[deger]
        if tur == "(":
            ic = self.veya()
            kapanis = self._al()
            if kapanis[0] != ")":
                raise KosulHatasi("Kapanış parantezi eksik")
            return ic
        raise KosulHatasi(f"Beklenmeyen simge: {deger!r}")


def degerlendir(ifade: str, degiskenler: dict[str, Any]) -> bool:
    """İfadeyi değerlendirir. Boş ifade = koşulsuz izin (True).

    Boş `allow_if` neden True: bölge tanımlarken koşul alanını boş bırakmak
    "burada özel bir kural yok" demek. Bölgenin kendisi zaten sınır değil;
    koşul, bölgenin ne zaman geçilebileceğini söylüyor.
    """
    if ifade is None:
        return True
    ifade = str(ifade).strip()
    if not ifade:
        return True
    if len(ifade) > AZAMI_UZUNLUK:
        raise KosulHatasi(f"İfade çok uzun (en fazla {AZAMI_UZUNLUK} karakter)")

    ayristirici = _Ayristirici(_parcala(ifade), degiskenler)
    sonuc = ayristirici.veya()
    if ayristirici.i != len(ayristirici.s):
        artan = ayristirici.s[ayristirici.i][1]
        raise KosulHatasi(f"İfadenin sonunda çözülemeyen kısım var: {artan!r}")
    return bool(sonuc)


# Doğrulamada kullanılan örnek değerler. Amaç sonucu öğrenmek değil, ifadenin
# ayrıştırılabildiğini ve tanınmayan isim içermediğini kaydederken görmek.
ORNEK_DEGISKENLER = {
    "x": 0.0, "y": 0.0, "z": 0.0,
    "prox": False, "tool": "",
    "safe_z": 340.0, "zmax": 550.0,
}


def dogrula(ifade: str) -> str | None:
    """İfade kaydedilmeden önce denenir. Sorun varsa açıklamayı döndürür.

    Bu bir kalkan değil, kullanıcıya kolaylık: hatalı ifade yine kaydedilebilir
    ve çalışma anında hareketi **engeller**. Amaç, kullanıcının hatayı
    makineyi durdurunca değil yazarken görmesi.
    """
    try:
        degerlendir(ifade, ORNEK_DEGISKENLER)
        return None
    except KosulHatasi as hata:
        return str(hata)
