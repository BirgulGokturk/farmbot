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
    # AYRILMA KAYMASI — servo bıraktıktan sonraki birkaç milimetrelik ilk
    # hareket, kafa ucun kilidinden kurtulsun diye. Makinedeki
    # `gantry_tools.json`da {dx:0, dy:8} yazıyor ama referans program onu
    # hiç okumuyor. Varsayılan SIFIR: uydurulmuş bir kayma ucu yuvadan
    # iterek devirebilir. Sıfırken adım hiç üretilmiyor.
    "release": {"dx": 0.0, "dy": 0.0},
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
    # konum yok.
    #
    # Tek koordinat DEĞİL, göz listesi: her gözün kendi X/Y/Z'si var ve
    # sahada ölçülen değerler tek bir "tohumluk konumu"na sığmıyordu —
    # gözün `z`si gözün DİBİ (vakum ucu oraya iniyor) ve bu makinede
    # büyük Z yukarısı olduğu için s4'ün dibi (Z285) diğerlerinkinden
    # (Z260) 25 mm yukarıda, yani s4 sığ göz. `tohum` gözde hangi türün
    # durduğunu, `dolu` içinde tohum kalıp kalmadığını söylüyor; ikisi de
    # dosyada KALICI, çünkü makine kapanıp açılınca hangi gözün boşaldığı
    # unutulursa ekim dizisi boş göze iner ve boşa iner.
    # Liste boşken tohumluk tanımsız sayılıyor ve çizilmiyor.
    "tohumluk": {"gozler": []},
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


# Tohumlukta bir seferde en fazla bu kadar göz tanımlanabilir. Sınır
# keyfî değil: gözler panelde tabloya, sahnede ayrı nesneye dönüşüyor ve
# ekim dizisinin adım sınırı (AZAMI_ADIM) zaten çok daha önce doluyor.
AZAMI_GOZ = 48


def _goz_dogrula(ham: Any, sira: int, kullanilan: set[str]) -> dict[str, Any] | None:
    """Tek bir tohumluk gözünü normalleştirir; kurulamazsa None.

    Panelden boş alan gelebiliyor ve boş metin sıfır DEĞİL: sıfır geçerli
    bir makine koordinatı, boş ise "göz tanımsız". İkisini karıştırmak
    gözü sahnenin köşesine, X0 Y0'a çizerdi.
    """
    if not isinstance(ham, dict):
        return None
    konum: dict[str, Any] = {}
    for eksen in ("x", "y", "z"):
        deger = ham.get(eksen)
        if deger in (None, ""):
            konum[eksen] = None
            continue
        try:
            konum[eksen] = round(float(deger), 1)
        except (TypeError, ValueError):
            konum[eksen] = None
    # X yoksa tanım yok sayılıyor; tek eksenle bir konum kurulamaz.
    if konum["x"] is None:
        return None
    if konum["y"] is None:
        konum["y"] = 0.0
    if konum["z"] is None:
        konum["z"] = 0.0

    ad = str(ham.get("ad") or "").strip()[:24] or f"s{sira}"
    # Ad ÇAKIŞMASI sessiz geçilmiyor: ekim dizisi gözü adıyla buluyor,
    # iki "s1" olsaydı hangi gözün boşaldığı belirsiz kalırdı.
    if ad in kullanilan:
        kok, n = ad, 2
        while f"{kok}-{n}" in kullanilan:
            n += 1
        ad = f"{kok}-{n}"
    kullanilan.add(ad)

    return {
        "ad": ad,
        "x": konum["x"], "y": konum["y"], "z": konum["z"],
        "tohum": str(ham.get("tohum") or "").strip()[:40],
        # Belirtilmemişse DOLU sayılıyor: yeni tanımlanan bir göze
        # kullanıcı tohum koyuyor demektir, boş varsaymak ekim dizisini
        # sebepsiz reddettirirdi.
        "dolu": bool(ham.get("dolu", True)),
    }


def _tohumluk_dogrula(ham: Any) -> dict[str, Any]:
    """Tohumluk göz listesini normalleştirir.

    Eski biçimi (tek `{x, y, z}` koordinat) da kabul ediyor ve tek gözlük
    listeye çeviriyor: sahada çalışan bir `uclar.json` bu sürümle
    güncellendiğinde tohumluğun sessizce kaybolmaması gerekiyor.
    """
    if not isinstance(ham, dict):
        return {"gozler": []}

    liste = ham.get("gozler")
    if liste is None and ("x" in ham or "y" in ham or "z" in ham):
        liste = [{"ad": "s1", "x": ham.get("x"), "y": ham.get("y"),
                  "z": ham.get("z"), "tohum": "", "dolu": True}]
    if not isinstance(liste, list):
        liste = []

    gozler: list[dict[str, Any]] = []
    kullanilan: set[str] = set()
    for g in liste[:AZAMI_GOZ]:
        temiz = _goz_dogrula(g, len(gozler) + 1, kullanilan)
        if temiz is not None:
            gozler.append(temiz)
    return {"gozler": gozler}


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
            # Eski biçimli tohumluk (tek koordinat) OKURKEN göz listesine
            # çevriliyor. Yükleme anında yapmasak dosyada eski biçim
            # kalırdı ve bir sonraki `kaydet` onu geri yazardı.
            self.ayar["tohumluk"] = _tohumluk_dogrula(self.ayar.get("tohumluk"))
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

    def tohumluk_gozleri(self) -> list[dict[str, Any]]:
        """Tohumluk gözleri — tek doğru kaynak."""
        t = _tohumluk_dogrula(self.ayar.get("tohumluk"))
        return [dict(g) for g in t["gozler"]]

    def tohumluk(self) -> dict[str, Any] | None:
        """İlk gözün konumu — tohumluk tanımlı değilse None.

        Yalnız "tohumluk nerede" diye soran eski tüketiciler için duruyor
        (sahnedeki profil kutusu). Göz başına iş yapan her yer
        `tohumluk_gozleri`ni kullanmalı.
        """
        gozler = self.tohumluk_gozleri()
        if not gozler:
            return None
        g = gozler[0]
        return {"x": g["x"], "y": g["y"], "z": g["z"]}

    def goz_bul(self, ad: str) -> dict[str, Any] | None:
        return next((g for g in self.tohumluk_gozleri() if g["ad"] == ad), None)

    def goz_isaretle(self, ad: str, dolu: bool, tohum: str | None = None) -> dict[str, Any] | None:
        """Bir gözün dolu/boş durumunu KALICI olarak yazar.

        Ekim dizisi bir gözden tohum aldığında burayı çağırıyor. Yazma
        atomik ve dosyaya iniyor: makine kapanıp açılınca hangi gözün
        boşaldığı hatırlanmazsa dizi boş göze iner, pompayı çalıştırır ve
        hedefe boş varır — bu sessiz başarısızlık, en pahalısı.
        """
        with self._kilit:
            gozler = self.tohumluk_gozleri()
            hedef = next((g for g in gozler if g["ad"] == ad), None)
            if hedef is None:
                return None
            hedef["dolu"] = bool(dolu)
            if tohum is not None:
                hedef["tohum"] = str(tohum).strip()[:40]
            self.ayar = {**self.ayar, "tohumluk": {"gozler": gozler}}
            _atomik_yaz(self.yol, self.ayar)
        return dict(hedef)

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

    def _kayma_x(self) -> bool:
        """Kayma ekseni X mi? (değilse Y)"""
        return str(self.ayar.get("slide_axis", "Y")).upper() == "X"

    def _cikis_ofsetleri(self) -> tuple[float, float]:
        """Yuvadan çıkarken uygulanan (dx, dy) — MAKİNE eksenlerinde.

        `retreat` üç biçimde gelebiliyor ve üçü de destekleniyor:

          * boş / yok  → `approach` kadar, yalnız kayma ekseninde. Gantry
            Studio ekranındaki davranış bu ve VARSAYILAN bu kalıyor.
          * sayı       → o kadar, yalnız kayma ekseninde.
          * {x, y}     → iki eksenli çıkış; ikisi de uygulanıyor.

        NEDEN iki eksenli biçim var: makinedeki `gantry_tools.json`
        dosyasında `retreat` iki eksenli bir sözlük olarak duruyor
        ({x:40, y:20}). Referans program (`gantry_studio.py`) onu
        "legacy, unused by the new sequence" diye işaretleyip HİÇ
        okumuyor — yani orada yazan sayının bir karşılığı yok. Bizde de
        yoktu: sözlük gelince `float()` patlıyor, sessizce `approach`a
        düşülüyordu. Sessizce yok saymak en kötüsü — kullanıcı ayarı
        girip çalıştığını sanıyor. Artık gerçekten uygulanıyor.
        """
        geri = self.ayar.get("retreat")
        kayma_x = self._kayma_x()

        if isinstance(geri, dict):
            def _b(ad):
                try:
                    return float(geri.get(ad) or 0.0)
                except (TypeError, ValueError):
                    return 0.0
            return _b("x"), _b("y")

        if geri is None or geri == "":
            ofset = float(self.ayar.get("approach", -55.0))
        else:
            try:
                ofset = float(geri)
            except (TypeError, ValueError):
                ofset = float(self.ayar.get("approach", -55.0))
        return (ofset, 0.0) if kayma_x else (0.0, ofset)

    def _cikis_ofseti(self) -> float:
        """Çıkış ofsetinin KAYMA EKSENİ bileşeni.

        `_cikis_ofsetleri` geldikten sonra da duruyor: tek sayı bekleyen
        eski çağıranlar için.
        """
        dx, dy = self._cikis_ofsetleri()
        return dx if self._kayma_x() else dy

    def _birakma_ofseti(self) -> tuple[float, float]:
        """`release` — servo bıraktıktan sonraki KÜÇÜK ayrılma kayması.

        Makinedeki `gantry_tools.json`da `release: {dx:0, dy:8}` var:
        uç serbest kaldıktan sonra kafanın ucun kilidinden kurtulması
        için verilen birkaç milimetrelik ilk hareket. Asıl yandan çıkış
        (`retreat`/`approach`) bunun ardından geliyor.

        Referans program bu alanı da okumuyor. Varsayılan SIFIR: uydurulmuş
        bir kayma, ucu yuvadan iterek devirebilir. Sıfırken adım hiç
        üretilmiyor, yani Gantry Studio ekranındaki yol birebir korunuyor.
        """
        b = self.ayar.get("release")
        if not isinstance(b, dict):
            return 0.0, 0.0
        def _b(ad):
            try:
                return float(b.get(ad) or 0.0)
            except (TypeError, ValueError):
                return 0.0
        return _b("dx"), _b("dy")

    def _cikis_noktasi(self, uc: dict[str, Any]) -> tuple[float, float]:
        tx, ty = float(uc["x"]), float(uc["y"])
        dx, dy = self._cikis_ofsetleri()
        return tx + dx, ty + dy

    def _birakma_noktasi(self, uc: dict[str, Any]) -> tuple[float, float] | None:
        """Ayrılma kayması uygulanmış nokta; kayma sıfırsa None."""
        rdx, rdy = self._birakma_ofseti()
        if abs(rdx) < 1e-9 and abs(rdy) < 1e-9:
            return None
        return float(uc["x"]) + rdx, float(uc["y"]) + rdy

    def dogrulanabilir_mi(self) -> bool:
        """Takılı ucu ÖLÇEBİLİYOR muyuz?

        Hayırsa `current_tool` bir ölçüm değil, bir İNANÇ: yazılımın
        kendisine en son söylenen şeyi hatırlaması. Kilit servosu bağlı
        değilse (`lock_reg = 0`) servo komutu sessiz geçiyor, varlık
        sensörü yoksa (`presence_reg = 0`) uç orada mı bilinmiyor. İkisi
        de yokken inanç gerçekle bir kez ayrıştı mı kendiliğinden
        düzelmiyor — düzeltecek tek şey operatörün gözü.
        """
        return (int(self.ayar.get("lock_reg", 0) or 0) > 0
                or int(self.ayar.get("presence_reg", 0) or 0) > 0)

    def beyan(self, ad: str | None) -> str:
        """Kafada GERÇEKTEN ne olduğunu operatör bildiriyor.

        `durumu_temizle`nin eksik bıraktığı yarı: o yalnız "bilmiyorum"
        diyebiliyordu, bu "elimde tool3 var" diyebiliyor. Sensör yokken
        inancı gerçeğe eşitlemenin tek yolu bu ve yolun kapalı olması,
        kullanıcının yazılımı yanlış inançla çalıştırması demekti —
        tool3 istenirken makinenin tool2'nin yuvasına inmesi gibi.

        HİÇBİR EKSEN HAREKET ETMEZ. Yalnız kayıt değişiyor.
        """
        temiz = str(ad or "").strip()
        if temiz and not self.uc_bul(temiz):
            raise UcHatasi(f"Bilinmeyen uç: '{temiz}'")
        onceki = self.ayar.get("current_tool")
        self.kaydet({"current_tool": temiz or None})
        # Beyan bir ÖLÇÜM DEĞİL: `dogrulandi` sensörün söylediği şeydi ve
        # burada sensör yok. Bilinmiyor olarak bırakıyoruz.
        self.durum.update(hata="", dogrulandi=None, aciklama="", adim=0,
                          toplam=0, dizi="")
        if temiz == (onceki or ""):
            return f"Kayıt zaten '{temiz or 'boş'}' — değişmedi"
        return (f"Takılı uç kaydı '{onceki or 'boş'}' → '{temiz or 'boş'}' "
                "olarak düzeltildi (operatör beyanı, ölçüm değil)")

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
        # Kayma ekseninin DIŞINDAKİ eksen: iki eksenli çıkışta buna da
        # gidiliyor, ama kaymadan SONRA — önce ucun altından kurtul,
        # sonra serbest eksende uzaklaş.
        capraz_ekseni = 1 - kayma_ekseni
        capraz_hedef = cy if kayma_ekseni == 0 else cx
        capraz_var = abs(capraz_hedef - (ty if kayma_ekseni == 0 else tx)) > 0.05
        fazla = max(0.0, float(self.ayar.get("drop_extra_z", 0.0) or 0.0))
        ayrilma = self._birakma_noktasi(uc)
        toplam = 6 + (1 if fazla > 0 else 0) + (1 if ayrilma else 0) + (1 if capraz_var else 0)

        self.durum.update(calisiyor=True, dizi=f"'{ad}' bırakılıyor", hata="", dogrulandi=None)
        if self.bolgeler:
            self.bolgeler.yuva_esnetmesi_ac()
            self.gunluk_cb("Yuva bölgesi esnetmesi AÇILDI (uç dizisi)", "uyari")
        try:
            # `toplam` isteğe bağlı adımlara göre değişiyor (fazladan iniş,
            # ayrılma kayması, iki eksenli çıkış). Sabit sayı yazmak, ilk
            # adımların "1/6" sonrakilerin "5/7" demesine yol açıyordu.
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

            no = 5
            if fazla > 0:
                # Sıra önemli: fazladan iniş servo BIRAKTIKTAN sonra. Uç
                # yuvada duruyor, aşağı inen yalnız kafa; böylece yandan
                # çıkarken ucun kenarına takılmıyor. Servo bırakmadan önce
                # inseydik ucu yuvaya bastırmış olurduk.
                no += 1
                self._adim(no, toplam, f"Z {fazla:.0f} mm daha in — kafa sıyrılarak çıksın")
                self.plc.eksen_git_dogrula(2, ze - fazla, hiz)
                self._kesildi_kontrol()

            if ayrilma:
                # AYRILMA KAYMASI (`release`). Yandan çıkıştan önce gelen
                # birkaç milimetrelik hareket: kafa ucun kilidinden
                # kurtuluyor. Z açıklığından SONRA, çünkü kendisi de
                # yatay bir hareket.
                no += 1
                self._adim(no, toplam,
                           f"Ayrılma kayması → X{ayrilma[0]:.1f} Y{ayrilma[1]:.1f}")
                self.plc.eksen_git_dogrula(0, ayrilma[0], hiz)
                self.plc.eksen_git_dogrula(1, ayrilma[1], hiz)
                self._kesildi_kontrol()

            no += 1
            self._adim(no, toplam, f"{'X' if kayma_ekseni == 0 else 'Y'} ekseninde altından çık")
            self.plc.eksen_git_dogrula(kayma_ekseni, cx if kayma_ekseni == 0 else cy, hiz)
            self._kesildi_kontrol()

            if capraz_var:
                # İKİ EKSENLİ ÇIKIŞ, kaymadan SONRA. Sıra keyfi değil:
                # önce ucun altından kurtulunuyor (kısıtlı hareket),
                # ikinci eksen ancak ondan sonra serbest.
                no += 1
                self._adim(no, toplam,
                           f"{'Y' if kayma_ekseni == 0 else 'X'} ekseninde uzaklaş "
                           f"({capraz_hedef:.1f} mm)")
                self.plc.eksen_git_dogrula(capraz_ekseni, capraz_hedef, hiz)
                self._kesildi_kontrol()

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
            # AYRILMA KAYMASI ve İKİ EKSENLİ ÇIKIŞ önizlemede de görünüyor.
            # Dizi bu adımları atıyorsa ekranda da olmalı: bu projede en
            # çok yanıltan hata sınıfı "okunan yol ile gidilen yol farklı".
            ayrilma = self._birakma_noktasi(uc)
            if ayrilma:
                yol.append({"x": ayrilma[0], "y": ayrilma[1], "z": cikis_z,
                            "not": "ayrılma kayması (release)"})
            # Önce kayma ekseninde çık, sonra —varsa— ikinci eksende uzaklaş.
            if kayma == "X":
                ara_x, ara_y = cx, ty
            else:
                ara_x, ara_y = tx, cy
            yol.append({"x": ara_x, "y": ara_y, "z": cikis_z, "not": "altından çık"})
            if abs(ara_x - cx) > 0.05 or abs(ara_y - cy) > 0.05:
                yol.append({"x": cx, "y": cy, "z": cikis_z,
                            "not": "ikinci eksende uzaklaş (retreat)"})
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
        # İki eksenli çıkış ve ayrılma kayması ALIŞILMIŞIN DIŞINDA. Referans
        # program ikisini de hiç uygulamıyor; birini açan kişi bunu bilerek
        # yapmalı ve önizlemede görmeli.
        dx, dy = self._cikis_ofsetleri()
        capraz = dy if self._kayma_x() else dx
        if abs(capraz) > 0.05:
            uyarilar.append(
                f"çıkış İKİ EKSENLİ (retreat X{dx:.0f} Y{dy:.0f}) — önce kayma "
                f"ekseninde çıkılıyor, sonra {'Y' if self._kayma_x() else 'X'} "
                f"ekseninde {capraz:.0f} mm uzaklaşılıyor")
        rdx, rdy = self._birakma_ofseti()
        if abs(rdx) > 0.05 or abs(rdy) > 0.05:
            uyarilar.append(
                f"ayrılma kayması açık (release dx{rdx:.0f} dy{rdy:.0f}) — servo "
                "bıraktıktan sonra yandan çıkmadan önce uygulanıyor")
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
