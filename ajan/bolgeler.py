"""Yasak bölgeler — dikdörtgen alanlar + geçiş koşulu.

Bir bölge, X/Y düzleminde bir dikdörtgen ve bir `izin_kosulu`dur. Hedefi ya da
**yolu** bu dikdörtgenin içine düşen bir hareket, koşul doğru değilse
reddedilir.

Denetim neden ajanda
--------------------
Panel çökse, sunucu düşse, komut başka bir arayüzden gelse de koruma
çalışmalı. Panelde yapılan denetim bir kolaylıktır, kalkan değildir.

Referanstan iki fark
--------------------
1. **Yol denetimi.** `gantry_studio.zone_block` yalnızca son hedefi denetliyor.
   Başlangıç ve hedef bölge dışında olsa bile aradaki yol bölgenin içinden
   geçebilir — Y ekseninde 0'dan 500'e giderken 200-300 arasındaki bölgenin
   tam ortasından geçmek gibi. Burada her hareket parçası örnekleniyor.
2. **Dar kapsamlı esnetme.** Referans, uç değiştirme dizisi boyunca bütün
   bölge denetimlerini kapatıyor. Burada yalnızca `yuva: true` işaretli
   bölgeler ve yalnızca dizinin adımları için atlanıyor; diğer bölgeler dizi
   sürerken de geçerli.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any, Callable

import kosul

# Bir hareket parçası kaç noktada örneklenecek? Uç noktalara bakmak yetmiyor
# (bkz. yukarıdaki 1. fark); her 10 mm'de bir örnek, 550 mm'lik en uzun eksende
# 56 örnek demek. Değerlendirme saf Python aritmetiği, maliyeti ihmal edilebilir.
ORNEK_ARALIK_MM = 10.0
AZAMI_ORNEK = 80


class BolgeHatasi(Exception):
    """Geçersiz bölge tanımı."""


class Engel(Exception):
    """Hareket bir bölge tarafından reddedildi.

    Mesajı kullanıcıya doğrudan gösteriliyor: hangi bölge, hangi koşul, hangi
    noktada. "Hareket engellendi" demek, operatörü karanlıkta bırakmak olurdu.
    """


def _yol(ayar: dict[str, Any]) -> str:
    ozel = ayar.get("bolge_dosyasi")
    if ozel and os.path.isabs(ozel):
        return ozel
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), ozel or "bolgeler.json")


def _atomik_yaz(yol: str, veri: Any) -> None:
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                         prefix=".bolge-", suffix=".tmp", delete=False)
    try:
        json.dump(veri, gecici, ensure_ascii=False, indent=1)
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


def bolge_dogrula(ham: dict[str, Any]) -> dict[str, Any]:
    ad = str(ham.get("ad", "")).strip() or "bölge"
    try:
        x1, y1 = float(ham["x1"]), float(ham["y1"])
        x2, y2 = float(ham["x2"]), float(ham["y2"])
    except (KeyError, TypeError, ValueError):
        raise BolgeHatasi(f"'{ad}': x1, y1, x2, y2 sayı olmalı")
    ifade = str(ham.get("izin_kosulu", "") or "")
    return {
        "ad": ad[:40],
        # Köşeleri sıralıyoruz: kullanıcı ters girse de dikdörtgen aynı.
        "x1": min(x1, x2), "x2": max(x1, x2),
        "y1": min(y1, y2), "y2": max(y1, y2),
        "izin_kosulu": ifade[:kosul.AZAMI_UZUNLUK],
        "yuva": bool(ham.get("yuva")),
        "aktif": bool(ham.get("aktif", True)),
        # Kaydederken doğrulanıyor ama hatalı ifade YİNE de kaydediliyor:
        # çalışma anında engelleyeceği için güvenli taraf. Uyarı panelde.
        "uyari": kosul.dogrula(ifade),
    }


class Bolgeler:
    """Bölge listesini tutar, dosyaya yazar ve hareketleri denetler."""

    def __init__(self, ayar: dict[str, Any], gunluk_cb: Callable[[str, str], None] | None = None) -> None:
        self.yol = _yol(ayar)
        self.gunluk_cb = gunluk_cb or (lambda m, s="bilgi": None)
        self._kilit = threading.RLock()
        self.liste: list[dict[str, Any]] = []
        self.yukle()

    # --- dosya ---
    def yukle(self) -> None:
        with self._kilit:
            if not os.path.exists(self.yol):
                self.liste = []
                return
            try:
                with open(self.yol, encoding="utf-8") as dosya:
                    ham = json.load(dosya)
            except (json.JSONDecodeError, OSError) as hata:
                # Okunamayan bölge dosyası "bölge yok" demek DEĞİL. Boş listeye
                # düşmek bütün korumayı sessizce kapatırdı; onun yerine gürültü
                # çıkarıp elimizdeki listeyi koruyoruz.
                self.gunluk_cb(f"Bölge dosyası okunamadı ({hata}) — önceki liste korunuyor", "hata")
                return
            kayitlar = ham.get("bolgeler", ham) if isinstance(ham, dict) else ham
            self.liste = [bolge_dogrula(b) for b in kayitlar if isinstance(b, dict)]

    def kaydet(self, yeni: list[dict[str, Any]]) -> list[dict[str, Any]]:
        dogrulanmis = [bolge_dogrula(b) for b in yeni]
        with self._kilit:
            _atomik_yaz(self.yol, {"surum": 1, "bolgeler": dogrulanmis})
            self.liste = dogrulanmis
        return dogrulanmis

    # ESNETME KALDIRILDI. Uç değiştirme dizisi sürerken `yuva: true`
    # işaretli bölgeler atlanıyordu; uç takıp çıkarmak diye bir şey
    # kalmadığı için atlanacak bir şey de kalmadı. Bölge denetimi artık
    # koşulsuz — hiçbir dizi onu gevşetemiyor.
    esnetme_acik = False

    # --- denetim ---
    def _icinde(self, bolge: dict[str, Any], x: float, y: float) -> bool:
        return bolge["x1"] <= x <= bolge["x2"] and bolge["y1"] <= y <= bolge["y2"]

    def _nokta_engeli(self, x: float, y: float, z: float, baglam: dict[str, Any]) -> str | None:
        for bolge in self.liste:
            if not bolge.get("aktif", True):
                continue
            if not self._icinde(bolge, x, y):
                continue
            degiskenler = {
                "x": float(x), "y": float(y), "z": float(z),
                "prox": bool(baglam.get("prox", False)),
                "tool": str(baglam.get("tool", "") or ""),
                "safe_z": float(baglam.get("safe_z", 340.0)),
                "zmax": float(baglam.get("zmax", 550.0)),
            }
            try:
                izin = kosul.degerlendir(bolge["izin_kosulu"], degiskenler)
                sebep = f"koşul sağlanmadı: {bolge['izin_kosulu'] or '(boş)'}"
            except kosul.KosulHatasi as hata:
                # Fail-closed: bozuk ifade ya da bilinmeyen isim = izin yok.
                izin = False
                sebep = f"koşul değerlendirilemedi ({hata})"
            if not izin:
                return (f"'{bolge['ad']}' bölgesi engelledi — {sebep} "
                        f"[X{x:.1f} Y{y:.1f} Z{z:.1f}]")
        return None

    def ihlal(self, x: float, y: float, z: float, baglam: dict[str, Any]) -> str | None:
        """Bu nokta şu anda bir bölge koşulunu ihlal ediyor mu?

        Hareketi engellemek için değil, makinenin **bulunduğu** yerin durumunu
        anlamak için: ihlal hâlindeyse yalnızca kaçış hamlesine izin verilecek.
        """
        return self._nokta_engeli(x, y, z, baglam)

    def nokta_kontrol(self, x: float, y: float, z: float, baglam: dict[str, Any]) -> None:
        engel = self._nokta_engeli(x, y, z, baglam)
        if engel:
            raise Engel(engel)

    def yol_kontrol(self, bas: tuple[float, float, float], son: tuple[float, float, float],
                    baglam: dict[str, Any]) -> None:
        """Bir hareket parçasının TAMAMINI denetler.

        Uç noktalara bakmak yetmiyor: her iki uç bölge dışında olsa da yol
        bölgenin ortasından geçebilir. Parçayı örnekliyoruz — hareketlerimiz
        tek eksenli olduğu için bu, doğru parçasını taramak demek.
        """
        mesafe = max(abs(son[i] - bas[i]) for i in range(3))
        adet = min(AZAMI_ORNEK, max(2, int(mesafe / ORNEK_ARALIK_MM) + 2))
        # k=0 atlanıyor: makine zaten orada. Başlangıç noktasını denetleyip
        # hareketi engellemek, ihlal hâlindeki bir makineyi hareketsiz
        # bırakırdı — çıkış hamlesi de dahil (bkz. kacis_gerekli).
        for k in range(1, adet):
            oran = k / (adet - 1)
            nokta = tuple(bas[i] + (son[i] - bas[i]) * oran for i in range(3))
            engel = self._nokta_engeli(nokta[0], nokta[1], nokta[2], baglam)
            if engel:
                # Nerede takıldığını söylemek önemli: "hedef yasak" ile
                # "yol yasaktan geçiyor" operatör için çok farklı iki durum.
                nerede = "hedef" if k == adet - 1 else f"yol üzerinde (%{oran * 100:.0f})"
                raise Engel(f"{engel} — {nerede}")
