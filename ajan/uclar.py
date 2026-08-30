"""Uç değiştirme — yandan yaklaşımlı kilit dizisi.

Makinenin kendine çarpma riski en yüksek parçası burası. Bütün tasarım tek bir
soruya göre yapıldı: **bir şey beklendiği gibi gitmezse ne olur?**

Diziler (`gantry_studio.tool_pickup` / `tool_dropoff` ile aynı geometri)::

    AL:     Z→travel_z  →  Y→yaklaşma  →  X→yaklaşma  →  Z→engage
            →  kayma ekseni boyunca uca gir  →  [servo KİLİTLE]  →  Z→engage+lift

    BIRAK:  Z→travel_z  →  Y→uç  →  X→uç  →  Z→engage
            →  [servo BIRAK]  →  kayma ekseni boyunca çık  →  Z→travel_z

Geometrinin mantığı: uzun X/Y yolculukları **travel_z** yüksekliğinde yapılıyor
(en yüksek ucun tepesinden yukarıda), alçak Z'deki tek yatay hareket ise uca
girip çıkan kısa kayma. Komşu bir uca çarpmanın önü böyle kesiliyor. Bu yüzden
`travel_z` en uzun ucun tepesinden yüksek olmalı — değilse baş, yan geçerken
uçlara sürter.

Referanstan üç fark
-------------------
1. **Her adım doğrulanıyor.** Referansta `move_yx` çağrılarının dönüşü
   denetlenmiyor; eksen hedefe varmasa da dizi devam ediyor. Burada her adım
   `eksen_git_dogrula` ile gidiyor: varılmadıysa dizi durur.
2. **Bölge esnetmesi dar.** Referans dizinin tamamında bütün bölge
   denetimlerini kapatıyor. Burada yalnızca `yuva: true` işaretli bölgeler
   atlanıyor; başka bir bölge dizinin ortasında da hareketi durdurur.
3. **Doğrulanamayan başarı, başarı sayılmıyor.** `presence_reg` 0 ise (sensör
   bağlı değil) dizi "tamamlandı" demiyor, "doğrulanamadı" diyor.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from typing import Any, Callable

VARSAYILAN = {
    # Sahadan gelen gerçek değerler.
    "safe_z": 280.0,
    "travel_z": 280.0,      # bütün X/Y yolculukları bu yükseklikte
    "home_z": 280.0,
    "slide_axis": "Y",      # uca ancak bu eksen boyunca kayarak girilir
    "approach": -55.0,      # kayma ekseninde uca göre GİRİŞ ofseti
    "retreat": None,        # ÇIKIŞ ofseti; boşsa approach kullanılır
    "lift": 80.0,           # kilitledikten sonra ucu yuvadan çekmek için
    "speed": 20.0,
    # Servo bekleme süresi. Sahadan gelen değer 1500 (milisaniye); referans
    # program saniye kullanıyordu (1.5). İkisini de kabul ediyoruz — bkz.
    # `_bekleme_sn`. 1500 saniyelik bir bekleme 25 dakika sürerdi.
    "lock_reg": 0, "lock_dwell": 1500,   # 0 = donanım bağlı değil
    # BIRAKMADA fazladan iniş: servo bıraktıktan sonra kafa bu kadar
    # daha aşağı iniyor, sonra yandan çıkıyor. Amaç kafanın ucun
    # kenarına takılmadan sıyrılması. 0 = kapalı.
    "drop_extra_z": 0.0,
    "grip_reg": 0, "grip_dwell": 1000,
    "presence_reg": 0,
    # PLC'den "Z güvenli yükseklikte" durumunu okuyan register. 0 ise
    # kullanılmaz ve karar milimetre karşılaştırmasıyla verilir.
    "z_safe_reg": 0,
    # Uç değiştirme alanı: 4 köşeli bölge. İçinde X/Y jog için Z güvenlik
    # şartı DEVRE DIŞI (uçları alçak Z'de takıp çıkarabilmek için), dışında
    # aynen geçerli. Kapalıyken hiçbir muafiyet yok.
    "tc_area": {"on": False, "pts": [[0, 0], [80, 0], [80, 300], [0, 300]]},
    # TOHUMLUK — uç profilinin en ucundaki delikli blok. Konumu uçlarla aynı
    # kaynakta duruyor çünkü aynı profilin üstünde: panel uç profilini bu
    # noktaların kapsayan kutusundan türetiyor, hiçbir yerde elle yazılmış
    # konum yok. `x` boş bırakılırsa tohumluk tanımsız sayılıyor ve
    # çizilmiyor — varsayılan da bu, çünkü her kurulumda tohumluk yok.
    "tohumluk": {"x": None, "y": None, "z": None},
    # SULAMA BAŞLIĞI — Z eksenine ayrı takılı ve ucun merkezinden kaymış.
    # Makine `hedef + (dx, dy)`ye gidince su hedefe düşüyor. Türden
    # BAĞIMSIZ: desen ofsetinin üstüne biniyor, her sulamada geçerli.
    # `z_min` mutlak Z tabanı: yüzey + açıklık bunun altında kalırsa
    # başlık bitkiye/kaba sürtüyor.
    "sulama_basligi": {"dx": 0.0, "dy": 0.0, "z_min": 0.0},
    "current_tool": None,
    "tools": [
        {"name": "tool1", "x": 10.0, "y": 70.5, "z": 150.0},
        {"name": "tool2", "x": 5.0, "y": 150.0, "z": 200.0},
        {"name": "tool3", "x": 5.0, "y": 250.0, "z": 250.0},
    ],
}


def _bekleme_sn(deger: Any, varsayilan: float = 1.5) -> float:
    """Bekleme süresini saniyeye çevirir.

    Saha ayarları milisaniye (1500), referans program saniye (1.5) kullanıyor.
    Aynı alanda iki birim dolaşıyor ve karıştırmanın bedeli ağır: 1500'ü
    saniye sanmak, servo komutundan sonra 25 dakika donmak demek. 50'nin
    üstündeki her değeri milisaniye kabul ediyoruz — 50 saniyelik bir kilit
    beklemesi gerçek bir kurulumda yok.
    """
    try:
        sayi = float(deger)
    except (TypeError, ValueError):
        return varsayilan
    if sayi <= 0:
        return 0.0
    return sayi / 1000.0 if sayi >= 50 else sayi


def _nokta_alanda(x: float, y: float, kose: list) -> bool:
    """Işın atma yöntemiyle nokta-poligon testi (referanstaki `_pip`)."""
    try:
        p = [(float(k[0]), float(k[1])) for k in kose if k]
    except (TypeError, ValueError, IndexError):
        return False
    if len(p) < 3:
        return False
    icinde = False
    j = len(p) - 1
    for i in range(len(p)):
        xi, yi = p[i]
        xj, yj = p[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi:
            icinde = not icinde
        j = i
    return icinde


class UcHatasi(Exception):
    """Dizi başlatılamadı ya da ortasında durdu."""


def _tohumluk_dogrula(ham: Any) -> dict[str, Any]:
    """Tohumluk koordinatını normalleştirir.

    Panelden boş alan gelebiliyor ve boş metin sıfır DEĞİL: sıfır geçerli
    bir makine koordinatı, boş ise "tohumluk tanımlı değil". İkisini
    karıştırmak tohumluğu sahnenin köşesine, X0 Y0'a çizerdi.
    """
    if not isinstance(ham, dict):
        return {"x": None, "y": None, "z": None}
    cikti: dict[str, Any] = {}
    for eksen in ("x", "y", "z"):
        deger = ham.get(eksen)
        if deger in (None, ""):
            cikti[eksen] = None
            continue
        try:
            cikti[eksen] = round(float(deger), 1)
        except (TypeError, ValueError):
            cikti[eksen] = None
    # X yoksa tanım yok sayılıyor; tek eksenle bir konum kurulamaz.
    if cikti["x"] is None:
        return {"x": None, "y": None, "z": None}
    if cikti["y"] is None:
        cikti["y"] = 0.0
    if cikti["z"] is None:
        cikti["z"] = 0.0
    return cikti


def _atomik_yaz(yol: str, veri: Any) -> None:
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                         prefix=".uc-", suffix=".tmp", delete=False)
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


class Uclar:
    def __init__(self, ayar: dict[str, Any], plc: Any, bolgeler: Any = None,
                 gunluk_cb: Callable[[str, str], None] | None = None) -> None:
        self.plc = plc
        self.bolgeler = bolgeler
        self.gunluk_cb = gunluk_cb or (lambda m, s="bilgi": None)
        ozel = ayar.get("uc_dosyasi") or "uclar.json"
        self.yol = ozel if os.path.isabs(ozel) else os.path.join(
            os.path.dirname(os.path.abspath(__file__)), ozel)
        self._kilit = threading.RLock()
        self.ayar: dict[str, Any] = dict(VARSAYILAN)
        # Panelde görünen dizi durumu.
        self.durum: dict[str, Any] = {
            "calisiyor": False, "dizi": "", "adim": 0, "toplam": 0,
            "aciklama": "", "hata": "", "uc": None, "dogrulandi": None,
        }
        self.yukle()

    # --- dosya ---
    def yukle(self) -> None:
        with self._kilit:
            if os.path.exists(self.yol):
                try:
                    with open(self.yol, encoding="utf-8") as dosya:
                        self.ayar = {**VARSAYILAN, **json.load(dosya)}
                except (json.JSONDecodeError, OSError) as hata:
                    self.gunluk_cb(f"Uç ayarları okunamadı ({hata}) — varsayılanlar kullanılıyor", "hata")
            self.durum["uc"] = self.ayar.get("current_tool")

    def kaydet(self, yeni: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._kilit:
            if yeni:
                if "tohumluk" in yeni:
                    yeni = {**yeni, "tohumluk": _tohumluk_dogrula(yeni["tohumluk"])}
                self.ayar = {**self.ayar, **yeni}
            _atomik_yaz(self.yol, self.ayar)
            self.durum["uc"] = self.ayar.get("current_tool")
        return self.ayar

    def sulama_basligi(self) -> dict[str, float]:
        """Sulama başlığının kayması ve Z tabanı — sunucu buradan okuyor."""
        b = self.ayar.get("sulama_basligi") or {}
        def _s(ad, vars_=0.0):
            try:
                return float(b.get(ad, vars_))
            except (TypeError, ValueError):
                return vars_
        return {"dx": _s("dx"), "dy": _s("dy"), "z_min": _s("z_min")}

    def tohumluk(self) -> dict[str, Any] | None:
        """Tanımlıysa tohumluk konumu, değilse None."""
        t = self.ayar.get("tohumluk") or {}
        return t if t.get("x") is not None else None

    def uc_bul(self, ad: str) -> dict[str, Any] | None:
        return next((t for t in self.ayar.get("tools", []) if t.get("name") == ad), None)

    # --- donanım yardımcıları ---
    def _servo(self, kilitle: bool) -> None:
        """Kilit servosunu komutlar. Register 0 ise sessiz geçer (donanım yok)."""
        reg = int(self.ayar.get("lock_reg", 0) or 0)
        if reg > 0:
            self.plc.mb.yaz(reg, 1 if kilitle else 0)
        time.sleep(_bekleme_sn(self.ayar.get("lock_dwell"), 1.5))

    def varlik_oku(self) -> bool | None:
        """Uç takılı mı? `None` = sensör bağlı değil, yani DOĞRULANAMADI."""
        reg = int(self.ayar.get("presence_reg", 0) or 0)
        if reg <= 0:
            return None
        try:
            return self.plc.mb.oku(reg, 1)[0] != 0
        except Exception:
            return None

    def z_guvenli_reg_oku(self) -> bool | None:
        """PLC'nin "Z güvenli yükseklikte" bitini okur.

        `z_safe_reg` 0 ise `None` döner ve karar milimetre karşılaştırmasına
        kalır. Okuma hata verirse de `None` DEĞİL `False` dönüyoruz: switch
        okunamıyorken "güvenli" varsaymak, Z aşağıdayken X/Y'yi serbest
        bırakmak demek olurdu.
        """
        reg = int(self.ayar.get("z_safe_reg", 0) or 0)
        if reg <= 0:
            return None
        try:
            return self.plc.mb.oku(reg, 1)[0] != 0
        except Exception:
            return False

    def tc_alani_acik(self) -> bool:
        return bool((self.ayar.get("tc_area") or {}).get("on"))

    def tc_alani_icinde(self, x: float, y: float) -> bool:
        """Bu nokta uç değiştirme alanının içinde mi?

        Alan KAPALIYKEN her zaman False — yani hiçbir muafiyet yok. Muafiyetin
        varsayılan olarak açık olması, Z kilidini sessizce delen bir arka kapı
        olurdu.
        """
        alan = self.ayar.get("tc_area") or {}
        if not alan.get("on"):
            return False
        return _nokta_alanda(float(x), float(y), alan.get("pts") or [])

    def _cikis_yuksekligi(self) -> float:
        """Dizi biterken çıkılacak Z — `travel_z` ile makinenin `guvenli_z`sinin büyüğü.

        Neden büyüğü: yuva bölgesinin izin koşulu genellikle `z>=safe_z` ve
        oradaki `safe_z`, ajanın `guvenli_z` ayarı. Uç dizisi bittiğinde yuva
        esnetmesi kapanıyor; makine hâlâ bölge içinde ve `travel_z`
        `guvenli_z`den alçaksa, bölge o andan itibaren ihlal sayılıyor ve
        makine "yalnızca Z yukarı" kilidine giriyor — bir sonraki program
        hiç başlayamıyor. Gerçek sahada bu ikisi farklı: uclar.json
        travel_z = 280, ajanın guvenli_z'si 340. Yukarı çıkmak her koşulda
        güvenli olduğu için büyüğünü alıyoruz.
        """
        tz = float(self.ayar.get("travel_z", 280.0))
        gz = float(getattr(self.plc, "guvenli_z", tz) or tz)
        return max(tz, gz)

    def _cikis_ofseti(self) -> float:
        """Çıkış ofseti — `retreat` boşsa `approach` kullanılır."""
        geri = self.ayar.get("retreat")
        if geri is None or geri == "":
            return float(self.ayar.get("approach", -55.0))
        try:
            return float(geri)
        except (TypeError, ValueError):
            return float(self.ayar.get("approach", -55.0))

    def _cikis_noktasi(self, uc: dict[str, Any]) -> tuple[float, float]:
        tx, ty = float(uc["x"]), float(uc["y"])
        ofset = self._cikis_ofseti()
        if str(self.ayar.get("slide_axis", "Y")).upper() == "X":
            return tx + ofset, ty
        return tx, ty + ofset

    def durumu_temizle(self) -> str:
        """Takılı uç kaydını elle sıfırlar.

        Dizi ortasında kesilen bir uç değiştirmeden sonra yazılımın kaydı ile
        gerçek durum ayrışabiliyor. Otomatik kurtarma denemek, bilinmeyen bir
        durumda kör hareket demek; kararı operatöre bırakıp yalnızca kaydı
        düzeltiyoruz. HİÇBİR eksen hareket etmez.
        """
        onceki = self.ayar.get("current_tool")
        self.kaydet({"current_tool": None})
        self.durum.update(hata="", dogrulandi=None, aciklama="", adim=0, toplam=0, dizi="")
        return (f"'{onceki}' kaydı temizlendi — makinede uç olup olmadığını gözle doğrulayın"
                if onceki else "Zaten takılı uç kaydı yoktu")

    def _yaklasma_noktasi(self, uc: dict[str, Any]) -> tuple[float, float, float, float]:
        """Yaklaşma noktası, uçtan yalnızca kayma ekseninde ayrılır.

        Böylece uca girmek tek eksende olur — mekanizmanın kendisiyle aynı.
        """
        tx, ty = float(uc["x"]), float(uc["y"])
        ofset = float(self.ayar.get("approach", -50.0))
        if str(self.ayar.get("slide_axis", "Y")).upper() == "X":
            return tx + ofset, ty, tx, ty
        return tx, ty + ofset, tx, ty

    # --- dizi ---
    def _adim(self, no: int, toplam: int, aciklama: str) -> None:
        self.durum.update(adim=no, toplam=toplam, aciklama=aciklama)
        self.gunluk_cb(f"Uç dizisi {no}/{toplam}: {aciklama}", "bilgi")

    def _kesildi_kontrol(self) -> None:
        if self.plc.kesildi_mi():
            raise UcHatasi("Dizi durduruldu (acil durdurma ya da Durdur)")

    def al(self, ad: str) -> None:
        """Yandan yaklaşımlı ALMA dizisi. Hata durumunda istisna atar."""
        if self.ayar.get("current_tool"):
            raise UcHatasi(f"'{self.ayar['current_tool']}' takılı — önce bırakın")
        uc = self.uc_bul(ad)
        if not uc:
            raise UcHatasi(f"Bilinmeyen uç: '{ad}'")

        hiz = float(self.ayar.get("speed", 20.0))
        tz = float(self.ayar.get("travel_z", 280.0))
        lift = float(self.ayar.get("lift", 80.0))
        ze = float(uc["z"])
        ax, ay, tx, ty = self._yaklasma_noktasi(uc)
        kayma_ekseni = 0 if str(self.ayar.get("slide_axis", "Y")).upper() == "X" else 1

        self.durum.update(calisiyor=True, dizi=f"'{ad}' alınıyor", hata="", dogrulandi=None)
        # Yuva bölgeleri dizinin adımları boyunca atlanıyor — AÇIK ESNETME.
        # Kapsamı dar: yalnız 'yuva' işaretli bölgeler, yalnız burada, ve
        # finally ile her koşulda kapanıyor.
        if self.bolgeler:
            self.bolgeler.yuva_esnetmesi_ac()
            self.gunluk_cb("Yuva bölgesi esnetmesi AÇILDI (uç dizisi)", "uyari")
        try:
            self._adim(1, 7, f"Z güvenli taşıma yüksekliğine ({tz:.0f} mm)")
            self.plc.eksen_git_dogrula(2, tz, hiz)
            self._kesildi_kontrol()

            self._adim(2, 7, f"Y yaklaşma noktasına ({ay:.1f} mm)")
            self.plc.eksen_git_dogrula(1, ay, hiz)
            self._kesildi_kontrol()

            self._adim(3, 7, f"X yaklaşma noktasına ({ax:.1f} mm)")
            self.plc.eksen_git_dogrula(0, ax, hiz)
            self._kesildi_kontrol()

            self._adim(4, 7, f"Z kavrama yüksekliğine ({ze:.1f} mm)")
            self.plc.eksen_git_dogrula(2, ze, hiz)
            self._kesildi_kontrol()

            self._adim(5, 7, f"{'X' if kayma_ekseni == 0 else 'Y'} ekseninde uca kay")
            self.plc.eksen_git_dogrula(kayma_ekseni, tx if kayma_ekseni == 0 else ty, hiz)
            self._kesildi_kontrol()

            self._adim(6, 7, "Servo kilitleniyor")
            self._servo(True)
            self._kesildi_kontrol()

            # Kalkış yüksekliği: hem yuvadan kurtulacak kadar hem de yuva
            # bölgesinin izin koşulunu sağlayacak kadar yüksek.
            cikis = max(ze + lift, self._cikis_yuksekligi())
            self._adim(7, 7, f"Z ile ucu yuvadan kaldır ({cikis:.0f} mm)")
            self.plc.eksen_git_dogrula(2, cikis, hiz)

            varlik = self.varlik_oku()
            if varlik is False:
                raise UcHatasi("Alma başarısız — varlık sensörü uç görmüyor")
            self.durum["dogrulandi"] = varlik
            self.kaydet({"current_tool": ad})
            if varlik is None:
                self.gunluk_cb(
                    f"'{ad}' alındı — ancak varlık sensörü bağlı değil (presence_reg=0), "
                    "ucun gerçekten takıldığı DOĞRULANAMADI", "uyari")
            else:
                self.gunluk_cb(f"'{ad}' alındı ve sensörle doğrulandı", "bilgi")
        finally:
            if self.bolgeler:
                self.bolgeler.yuva_esnetmesi_kapat()
                self.gunluk_cb("Yuva bölgesi esnetmesi kapandı", "bilgi")
            self.durum["calisiyor"] = False

    def birak(self) -> None:
        """Yandan yaklaşımlı BIRAKMA dizisi — almanın tersi."""
        ad = self.ayar.get("current_tool")
        if not ad:
            raise UcHatasi("Takılı uç yok")
        uc = self.uc_bul(ad)
        if not uc:
            # Ayar dosyası değişmiş olabilir. Durumu temizliyoruz ki makine
            # "elimde bilinmeyen bir şey var" durumunda kilitli kalmasın.
            self.kaydet({"current_tool": None})
            raise UcHatasi(f"'{ad}' tanımı bulunamadı — takılı uç kaydı temizlendi")

        hiz = float(self.ayar.get("speed", 20.0))
        tz = float(self.ayar.get("travel_z", 280.0))
        ze = float(uc["z"])
        _, _, tx, ty = self._yaklasma_noktasi(uc)
        # Çıkışta `retreat` kullanılıyor: girişte ucun altına kayarken izlenen
        # yol ile çıkarken izlenen yol farklı olabilir (giriş 55 mm geriden,
        # çıkış daha kısa ya da ters yönde). `retreat` boşsa `approach`.
        cx, cy = self._cikis_noktasi(uc)
        kayma_ekseni = 0 if str(self.ayar.get("slide_axis", "Y")).upper() == "X" else 1
        fazla = max(0.0, float(self.ayar.get("drop_extra_z", 0.0) or 0.0))
        toplam = 7 if fazla > 0 else 6

        self.durum.update(calisiyor=True, dizi=f"'{ad}' bırakılıyor", hata="", dogrulandi=None)
        if self.bolgeler:
            self.bolgeler.yuva_esnetmesi_ac()
            self.gunluk_cb("Yuva bölgesi esnetmesi AÇILDI (uç dizisi)", "uyari")
        try:
            # `toplam` fazladan iniş varsa 7, yoksa 6. Sabit 6 yazmak,
            # ilk dört adımın "1/6" sonrakilerin "5/7" demesine yol açıyordu.
            self._adim(1, toplam, f"Z taşıma yüksekliğine ({tz:.0f} mm) — uç yukarıda taşınıyor")
            self.plc.eksen_git_dogrula(2, tz, hiz)
            self._kesildi_kontrol()

            self._adim(2, toplam, f"Y yuvanın üstüne ({ty:.1f} mm)")
            self.plc.eksen_git_dogrula(1, ty, hiz)
            self._kesildi_kontrol()

            self._adim(3, toplam, f"X yuvanın üstüne ({tx:.1f} mm)")
            self.plc.eksen_git_dogrula(0, tx, hiz)
            self._kesildi_kontrol()

            self._adim(4, toplam, f"Z ile ucu yuvaya otur ({ze:.1f} mm)")
            self.plc.eksen_git_dogrula(2, ze, hiz)
            self._kesildi_kontrol()

            self._adim(5, toplam, "Servo bırakılıyor")
            self._servo(False)
            self._kesildi_kontrol()

            if fazla > 0:
                # Sıra önemli: fazladan iniş servo BIRAKTIKTAN sonra. Uç
                # yuvada duruyor, aşağı inen yalnız kafa; böylece yandan
                # çıkarken ucun kenarına takılmıyor. Servo bırakmadan önce
                # inseydik ucu yuvaya bastırmış olurduk.
                self._adim(6, toplam, f"Z {fazla:.0f} mm daha in — kafa sıyrılarak çıksın")
                self.plc.eksen_git_dogrula(2, ze - fazla, hiz)
                self._kesildi_kontrol()

            self._adim(toplam, toplam, f"{'X' if kayma_ekseni == 0 else 'Y'} ekseninde altından çık")
            self.plc.eksen_git_dogrula(kayma_ekseni, cx if kayma_ekseni == 0 else cy, hiz)
            self.plc.eksen_git_dogrula(2, self._cikis_yuksekligi(), hiz)

            varlik = self.varlik_oku()
            if varlik is True:
                raise UcHatasi("Bırakma başarısız — varlık sensörü hâlâ uç görüyor")
            self.durum["dogrulandi"] = (False if varlik is False else None)
            self.kaydet({"current_tool": None})
            if varlik is None:
                self.gunluk_cb(f"'{ad}' bırakıldı — varlık sensörü yok, DOĞRULANAMADI", "uyari")
            else:
                self.gunluk_cb(f"'{ad}' bırakıldı ve sensörle doğrulandı", "bilgi")
        finally:
            if self.bolgeler:
                self.bolgeler.yuva_esnetmesi_kapat()
                self.gunluk_cb("Yuva bölgesi esnetmesi kapandı", "bilgi")
            self.durum["calisiyor"] = False

    def degistir(self, ad: str) -> None:
        if self.ayar.get("current_tool") == ad:
            self.gunluk_cb(f"'{ad}' zaten takılı", "bilgi")
            return
        if self.ayar.get("current_tool"):
            self.birak()
        self.al(ad)

    def yol_onizleme(self, islem: str, ad: str = "") -> dict[str, Any]:
        """Tak/Bırak'a basmadan önce izlenecek yolu koordinat koordinat verir.

        Uç değiştirme, makinenin kendine çarpma riski en yüksek hareketi.
        "Başlat"a basıp ne olacağını izlemek yerine, önce nereden nereye
        gidileceğini okuyabilmek gerekiyor — özellikle `approach`, `lift` ya
        da yuva koordinatı yeni değiştirildiyse.
        """
        ad = ad or (self.ayar.get("current_tool") or "")
        uc = self.uc_bul(ad)
        if not uc:
            return {"ok": False, "mesaj": f"Bilinmeyen uç: '{ad}'", "adimlar": []}

        tz = float(self.ayar.get("travel_z", 280.0))
        lift = float(self.ayar.get("lift", 80.0))
        ze = float(uc["z"])
        ax, ay, tx, ty = self._yaklasma_noktasi(uc)
        cx, cy = self._cikis_noktasi(uc)
        cz = self._cikis_yuksekligi()      # dizi gerçekte buraya çıkıyor
        kayma = "X" if str(self.ayar.get("slide_axis", "Y")).upper() == "X" else "Y"

        # BIRAKMADAKİ fazladan iniş önizlemede de görünmeli. Eskiden
        # yoktu: dizi servo bıraktıktan sonra 4 mm daha iniyordu ama
        # önizleme bunu hiç yazmıyordu, yani ekranda okunan yol makinenin
        # gittiği yol değildi. Bu projede en çok yanıltan hata sınıfı bu.
        fazla = max(0.0, float(self.ayar.get("drop_extra_z", 0.0) or 0.0))

        if islem == "birak":
            yol = [
                {"z": tz, "not": "taşıma yüksekliği, uç yukarıda"},
                {"x": tx, "y": ty, "z": tz, "not": "yuvanın üstüne"},
                {"x": tx, "y": ty, "z": ze, "not": "yuvaya otur"},
                {"servo": "birak", "not": "servo BIRAK"},
            ]
            cikis_z = ze
            if fazla > 0:
                cikis_z = ze - fazla
                yol.append({"x": tx, "y": ty, "z": cikis_z,
                            "not": f"{fazla:.0f} mm daha in — kafa sıyrılarak çıksın"})
            yol.append({"x": cx, "y": cy, "z": cikis_z, "not": "altından çık"})
            yol.append({"x": cx, "y": cy, "z": cz,
                        "not": "güvenli yüksekliğe"
                               + (" (yuva bölgesinin izin koşulu)" if cz > tz else "")})
        else:
            # Kalkış yüksekliği: `ze + lift` yuvadan kurtulmaya yetiyor, ama
            # yuva bölgesinin izin koşulu genellikle `z >= safe_z` ve dizi
            # bitince esnetme kapanıyor. Alçakta bırakmak makineyi anında
            # ihlal durumuna sokuyor — bkz. `_cikis_yuksekligi`.
            kalkis = max(ze + lift, cz)
            yol = [
                {"z": tz, "not": "taşıma yüksekliği"},
                {"x": ax, "y": ay, "z": tz, "not": "yaklaşma noktası"},
                {"x": ax, "y": ay, "z": ze, "not": "kavrama yüksekliğine in"},
                {"x": tx, "y": ty, "z": ze, "not": f"{kayma} ekseninde uca kay"},
                {"servo": "kilitle", "not": "servo KİLİTLE"},
                {"x": tx, "y": ty, "z": kalkis, "not": "yuvadan kaldır"},
            ]

        # Metin biçimi geriye uyum için duruyor; panel `yol`u kullanıyor.
        def _metin(a):
            if a.get("servo"):
                return a["not"]
            parca = ",".join("" if a.get(e) is None else f"{a[e]:.0f}"
                             for e in ("x", "y", "z"))
            return f"{parca} ({a['not']})"

        return {
            "ok": True, "islem": islem, "ad": ad,
            "yol": yol,
            "adimlar": [_metin(a) for a in yol],
            "uyari": self._onizleme_uyarilari(uc, ze, tz),
        }

    def yollar(self) -> dict[str, Any]:
        """HER ucun al/bırak yolu — panelin tablo altına yazdığı satır.

        Tek çağrıda hepsi: panel uç başına ayrı istek atmasın ve —daha
        önemlisi— yolu KENDİ hesaplamasın. Panelde ikinci bir hesap,
        ekranda okunan yol ile makinenin gittiği yolun ayrışması demek.
        """
        cikti = {}
        for t in self.ayar.get("tools", []):
            ad = str(t.get("name") or "")
            if not ad or t.get("x") is None:
                continue
            cikti[ad] = {
                "al": self.yol_onizleme("al", ad).get("yol") or [],
                "birak": self.yol_onizleme("birak", ad).get("yol") or [],
            }
        return cikti

    def _onizleme_uyarilari(self, uc: dict[str, Any], ze: float, tz: float) -> list[str]:
        """Önizlemede göze çarpması gereken tutarsızlıklar."""
        uyarilar = []
        if tz <= ze:
            uyarilar.append(
                f"travel_z ({tz:.0f}) kavrama yüksekliğinden ({ze:.0f}) yüksek değil — "
                "baş yan geçerken uçlara sürter")
        en_yuksek = max((float(t.get("z", 0)) for t in self.ayar.get("tools", [])), default=0.0)
        if tz <= en_yuksek:
            uyarilar.append(
                f"travel_z ({tz:.0f}) en yüksek ucun kavrama yüksekliğinden ({en_yuksek:.0f}) "
                "yüksek değil")
        if int(self.ayar.get("presence_reg", 0) or 0) <= 0:
            uyarilar.append("varlık sensörü bağlı değil — sonuç doğrulanamayacak")
        if int(self.ayar.get("lock_reg", 0) or 0) <= 0:
            uyarilar.append("kilit servosu bağlı değil (lock_reg = 0) — servo adımı sessiz geçecek")
        gz = float(getattr(self.plc, "guvenli_z", tz) or tz)
        if gz > tz:
            uyarilar.append(
                f"travel_z ({tz:.0f}) makinenin güvenli Z yüksekliğinden ({gz:.0f}) alçak — "
                f"dizi sonunda Z {gz:.0f} mm'ye çıkarılıyor ki yuva bölgesi kilidi açık kalsın")
        return uyarilar

    # --- ajan arayüzü ---
    def dizi_baslat(self, islem: str, ad: str = "") -> str:
        """Diziyi arka planda başlatır; panel adım adım izleyebilsin diye."""
        if self.durum["calisiyor"]:
            raise UcHatasi("Bir uç dizisi zaten çalışıyor")

        def isci() -> None:
            try:
                if islem == "al":
                    self.al(ad)
                elif islem == "birak":
                    self.birak()
                else:
                    self.degistir(ad)
                self.durum["hata"] = ""
            except Exception as hata:
                # Hata sessizce yutulmuyor: panelde kalıcı olarak görünüyor.
                self.durum.update(hata=str(hata))
                self.gunluk_cb(f"Uç dizisi DURDU: {hata}", "hata")

        self.plc.harici_is_baslat("uç değiştirme", isci)
        return {"al": f"'{ad}' alınıyor", "birak": "Uç bırakılıyor"}.get(islem, f"'{ad}' takılıyor")
