# -*- coding: utf-8 -*-
"""İş kuyruğu — bahçe modunun "soru sorma, sıraya al" mekanizması.

NEDEN VAR. Makine tek dizi çalıştırabiliyor: ajanda ikinci bir dizi
"Bir dizi zaten çalışıyor" ile reddediliyor, ekim oturumu ikinciyi 409'la
geri çeviriyor. Teknik panelde bu doğru davranış — orada ne yaptığını bilen
biri var. Bahçe modunda değil: bahçeyle uğraşan biri iki bitkiye arka arkaya
dokunduğunda ikincisinin "makine meşgul" diye reddedilmesi, kullanıcıyı
makinenin takvimine uydurmak demek. Burada tersi olmalı — makine kullanıcının
sırasına uyuyor.

KUYRUK GÜVENLİĞİ AŞMIYOR. İşleri çalıştıran kod bu dosyada değil; burası
yalnız sırayı tutuyor. Çalıştıran taraf her iş için mevcut yolları
(`/api/toplu` ile aynı çözümleme, aynı ön kontrol, aynı yasak bölge
sorgusu) kullanıyor. Kuyruk bir kestirme değil, bir bekleme odası.

BELLEKTE DURUYOR, DİSKE YAZILMIYOR. Sunucu yeniden başladığında ajan
bağlantısı da kopuyor ve makine zaten duruyor; yarım kalmış bir kuyruğu
diskten geri yükleyip "kaldığı yerden" devam etmek, kullanıcının artık
istemediği işleri saatler sonra yaptırabilirdi. Kaybolan işi kullanıcı
görüp yeniden isteyebilir; istenmeden yapılan işi geri alamaz.
"""
from __future__ import annotations

import itertools
import time
from typing import Any

BEKLIYOR = "bekliyor"
CALISIYOR = "calisiyor"
BITTI = "bitti"
HATA = "hata"
IPTAL = "iptal"

# Kuyrukta bekleyebilecek en fazla iş. Bahçede 40 bitki varsa hepsine
# dokunmak 40 iş demek; üstü kullanıcının istemeden ürettiği bir yığın
# olur (düğmeye takılan parmak) ve makineyi dakikalarca meşgul eder.
AZAMI_BEKLEYEN = 40

# Biten işlerden kaç tanesi ekranda tutuluyor.
GECMIS_UZUNLUK = 12

_sayac = itertools.count(1)


class Kuyruk:
    def __init__(self) -> None:
        self.isler: list[dict[str, Any]] = []

    # ---------------------------------------------------------------- ekle
    def ekle(self, tip: str, etiket: str, noktalar: list[str] | None = None,
             veri: dict[str, Any] | None = None) -> dict[str, Any]:
        """Sıraya bir iş koyar ve iş kaydını döndürür."""
        if len(self.bekleyenler()) >= AZAMI_BEKLEYEN:
            raise KuyrukDolu(
                f"Kuyrukta {AZAMI_BEKLEYEN} iş bekliyor. "
                "Bir kısmı bitene kadar yeni iş eklenemiyor.")
        kayit = {
            "kimlik": f"is{next(_sayac)}",
            "tip": str(tip),
            "etiket": str(etiket),
            "noktalar": [str(a) for a in (noktalar or [])],
            "veri": dict(veri or {}),
            "durum": BEKLIYOR,
            "mesaj": "",
            "ts": time.time(),
            "basladi_ts": 0.0,
            "bitti_ts": 0.0,
        }
        self.isler.append(kayit)
        self._buda()
        return kayit

    # --------------------------------------------------------------- okuma
    def bekleyenler(self) -> list[dict[str, Any]]:
        return [i for i in self.isler if i["durum"] == BEKLIYOR]

    def calisan(self) -> dict[str, Any] | None:
        return next((i for i in self.isler if i["durum"] == CALISIYOR), None)

    def sonraki(self) -> dict[str, Any] | None:
        """Sıradaki bekleyen iş — bir iş çalışıyorsa None."""
        if self.calisan() is not None:
            return None
        bekleyen = self.bekleyenler()
        return bekleyen[0] if bekleyen else None

    def bul(self, kimlik: str) -> dict[str, Any] | None:
        return next((i for i in self.isler if i["kimlik"] == kimlik), None)

    # ------------------------------------------------------------ durum yaz
    def basladi(self, kimlik: str) -> None:
        i = self.bul(kimlik)
        if i and i["durum"] == BEKLIYOR:
            i["durum"] = CALISIYOR
            i["basladi_ts"] = time.time()

    def bitti(self, kimlik: str, mesaj: str = "") -> None:
        self._kapat(kimlik, BITTI, mesaj)

    def hata(self, kimlik: str, mesaj: str) -> None:
        self._kapat(kimlik, HATA, mesaj)

    def iptal(self, kimlik: str) -> bool:
        """Bekleyen bir işi iptal eder. Çalışan iş iptal EDİLMİYOR.

        Çalışan işi kuyruktan silmek makineyi durdurmuyor — yalnız ekrandan
        siliyor olurdu, ki bu makinenin ne yaptığını bilinmez yapar. Çalışan
        işi durdurmanın yolu teknik paneldeki "Dur".
        """
        i = self.bul(kimlik)
        if not i or i["durum"] != BEKLIYOR:
            return False
        i["durum"] = IPTAL
        i["mesaj"] = "iptal edildi"
        i["bitti_ts"] = time.time()
        return True

    def hepsini_iptal(self) -> int:
        return sum(1 for i in list(self.bekleyenler()) if self.iptal(i["kimlik"]))

    def _kapat(self, kimlik: str, durum: str, mesaj: str) -> None:
        i = self.bul(kimlik)
        if not i:
            return
        i["durum"] = durum
        i["mesaj"] = str(mesaj or "")
        i["bitti_ts"] = time.time()
        self._buda()

    def _buda(self) -> None:
        """Bitmiş işlerin en yenilerini tutup gerisini atar."""
        bitmis = [i for i in self.isler if i["durum"] in (BITTI, HATA, IPTAL)]
        fazla = len(bitmis) - GECMIS_UZUNLUK
        if fazla > 0:
            atilacak = {id(i) for i in bitmis[:fazla]}
            self.isler = [i for i in self.isler if id(i) not in atilacak]

    # -------------------------------------------------------------- görüntü
    def goruntu(self) -> dict[str, Any]:
        calisan = self.calisan()
        return {
            "isler": [self._ozet(i) for i in self.isler],
            "bekleyen": len(self.bekleyenler()),
            "calisan": self._ozet(calisan) if calisan else None,
            "azami": AZAMI_BEKLEYEN,
        }

    @staticmethod
    def _ozet(i: dict[str, Any]) -> dict[str, Any]:
        return {
            "kimlik": i["kimlik"], "tip": i["tip"], "etiket": i["etiket"],
            "durum": i["durum"], "mesaj": i["mesaj"], "ts": i["ts"],
            "adet": len(i["noktalar"]),
            # HANGİ BİTKİLER. Sayı, "makine şu an ne yapıyor" sorusunu
            # yanıtlamıyor: bahçe sahnesi çalışan işin hedefini ekranda
            # işaretliyor ve robota dokununca adını yazıyor. Ad listesi
            # zaten kuyrukta duruyordu, özet onu düşürüyordu.
            "noktalar": list(i["noktalar"]),
            "sure_sn": round((i["bitti_ts"] or time.time()) - i["basladi_ts"], 1)
                       if i["basladi_ts"] else 0.0,
        }


class KuyrukDolu(Exception):
    pass
