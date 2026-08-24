"""Kayıtlı program (dizi) çalıştırıcı.

Dizi **ajanda** yürüyor, panelde değil. Sebebi: panel kapanırsa, tarayıcı
uykuya dalarsa ya da ağ koparsa dizinin ortasında kalmış bir makine kimsenin
denetiminde olmazdı. Ajanda çalışınca acil durdurma da diziyi anında kesiyor.

Adımlar sunucudan **çözülmüş** geliyor: nokta adları koordinata çevrilmiş
hâlde. Ajan nokta deposunu hiç bilmiyor; adı değişen bir nokta süren diziyi
bozmuyor.

Adım tipleri
------------
    {"tip": "nokta",  "ad": "s1", "x":…, "y":…, "z":…}
    {"tip": "bekle",  "saniye": 5}
    {"tip": "role",   "ad": "su_pompasi", "durum": true}
    {"tip": "servo",  "aci": 90}
    {"tip": "uc",     "ad": "tool1"}      # uç değiştir (birak için ad boş)

Hepsi mevcut komutları çağırıyor; yeni bir hareket yolu yok.
"""

from __future__ import annotations

import time
from typing import Any, Callable

AZAMI_BEKLEME = 600.0        # tek adımda en fazla 10 dakika
AZAMI_TEKRAR = 1000          # sonsuz döngü yok; bkz. `tekrar` doğrulaması


class DiziHatasi(Exception):
    """Dizi başlatılamadı ya da bir adım başarısız oldu."""


class Dizi:
    def __init__(self, plc: Any, uclar: Any, arduino_komut: Callable[[str], None],
                 gunluk_cb: Callable[[str, str], None] | None = None) -> None:
        self.plc = plc
        self.uclar = uclar
        self.arduino_komut = arduino_komut
        self.gunluk_cb = gunluk_cb or (lambda m, s="bilgi": None)
        self.durum: dict[str, Any] = {
            "calisiyor": False, "ad": "", "adim": 0, "toplam": 0,
            "aciklama": "", "hata": "", "tekrar": 0, "tur": 0,
        }

    # --- adım yürütücüleri ---
    def _adim_calistir(self, adim: dict[str, Any], hiz: float) -> str:
        tip = str(adim.get("tip", ""))

        if tip == "nokta":
            ad = adim.get("ad") or "nokta"
            self.plc.git_senkron(adim.get("x"), adim.get("y"), adim.get("z"), hiz)
            return f"'{ad}' konumuna gidildi"

        if tip == "bekle":
            saniye = max(0.0, min(AZAMI_BEKLEME, float(adim.get("saniye", 1))))
            # Bölünmüş bekleme: tek bir uzun sleep, "Durdur"a saniyelerce
            # sağır kalırdı.
            bitis = time.time() + saniye
            while time.time() < bitis:
                if self.plc.kesildi_mi():
                    raise DiziHatasi("Dizi durduruldu")
                time.sleep(0.1)
            return f"{saniye:.0f} saniye beklendi"

        if tip == "role":
            role = str(adim.get("ad", ""))
            if role not in ("su_pompasi", "hava_pompasi", "su_vanasi"):
                raise DiziHatasi(f"Bilinmeyen röle: '{role}'")
            durum = 1 if adim.get("durum") else 0
            self.arduino_komut(f"ROLE {role} {durum}")
            return f"{role} {'açıldı' if durum else 'kapandı'}"

        if tip == "servo":
            aci = int(adim.get("aci", 0))
            if not 0 <= aci <= 180:
                raise DiziHatasi("Servo açısı 0-180 arasında olmalı")
            self.arduino_komut(f"SERVO {aci}")
            return f"servo {aci}°"

        if tip == "uc":
            ad = str(adim.get("ad", "") or "")
            if ad:
                self.uclar.degistir(ad)
                return f"'{ad}' takıldı"
            self.uclar.birak()
            return "uç bırakıldı"

        raise DiziHatasi(f"Bilinmeyen adım tipi: '{tip}'")

    # --- koşucu ---
    def _isci(self, ad: str, adimlar: list[dict[str, Any]], tekrar: int, hiz: float) -> None:
        self.durum.update(calisiyor=True, ad=ad, hata="", adim=0,
                          toplam=len(adimlar), tekrar=tekrar, tur=0)
        try:
            for tur in range(tekrar):
                self.durum["tur"] = tur + 1
                for sira, adim in enumerate(adimlar, start=1):
                    if self.plc.kesildi_mi():
                        raise DiziHatasi("Dizi durduruldu")
                    self.durum.update(adim=sira, aciklama=self._ozet(adim))
                    self.gunluk_cb(
                        f"Dizi '{ad}' {sira}/{len(adimlar)}"
                        + (f" (tur {tur + 1}/{tekrar})" if tekrar > 1 else "")
                        + f": {self._ozet(adim)}", "bilgi")
                    sonuc = self._adim_calistir(adim, hiz)
                    self.durum["aciklama"] = sonuc
            self.gunluk_cb(f"Dizi '{ad}' tamamlandı", "bilgi")
            self.durum["aciklama"] = "tamamlandı"
        except Exception as hata:
            # Hata sessizce yutulmuyor: dizi durur, sebep panelde kalır.
            self.durum["hata"] = str(hata)
            self.gunluk_cb(
                f"Dizi '{ad}' {self.durum['adim']}. adımda DURDU: {hata}", "hata")
            try:
                self.plc.dur()
            except Exception:
                pass
        finally:
            self.durum["calisiyor"] = False

    @staticmethod
    def _ozet(adim: dict[str, Any]) -> str:
        tip = adim.get("tip")
        if tip == "nokta":
            return (f"{adim.get('ad', 'nokta')} → X{float(adim.get('x', 0)):.0f} "
                    f"Y{float(adim.get('y', 0)):.0f} Z{float(adim.get('z', 0)):.0f}")
        if tip == "bekle":
            return f"{adim.get('saniye', 0)} sn bekle"
        if tip == "role":
            return f"{adim.get('ad')} {'aç' if adim.get('durum') else 'kapat'}"
        if tip == "servo":
            return f"servo {adim.get('aci')}°"
        if tip == "uc":
            return f"uç: {adim.get('ad') or 'bırak'}"
        return str(tip)

    def baslat(self, ad: str, adimlar: list[dict[str, Any]], tekrar: int = 1,
               hiz: float | None = None) -> str:
        if self.durum["calisiyor"]:
            raise DiziHatasi("Bir dizi zaten çalışıyor")
        if self.plc.acil_mandal["acik"]:
            # Acil durdurma mandalı temizlenmeden yeniden başlatma yok.
            raise DiziHatasi("ACİL DURDURMA mandallı — önce temizleyin")
        if not adimlar:
            raise DiziHatasi("Dizide adım yok")
        # Sonsuz tekrar bilerek yok: uzaktan çalışan, kimsenin başında
        # olmadığı bir makinede "sonsuza kadar" tehlikeli bir varsayılan.
        tekrar = max(1, min(AZAMI_TEKRAR, int(tekrar or 1)))

        self.plc.harici_is_baslat(
            "program dizisi",
            lambda: self._isci(ad, adimlar, tekrar, float(hiz or self.plc.hiz)))
        return f"'{ad}' başlatıldı — {len(adimlar)} adım" + (f", {tekrar} tur" if tekrar > 1 else "")

    def durdur(self) -> str:
        self.durum["hata"] = self.durum["hata"] or "operatör durdurdu"
        return self.plc.dur()
