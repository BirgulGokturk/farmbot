"""Kafa geometrisi — üç sabit baş, tohumluk hazneleri, Z güvenlik biti.

UÇ DEĞİŞTİRME DİYE BİR ŞEY YOK. Z ekseninin ucuna üç baş KALICI olarak
vidalı ve yan yana duruyorlar: soldaki sulama başlığı, ortadaki toprak
nemi probu, sağdaki tohum alma ucu. Hiçbiri sökülmüyor, hiçbiri yuvaya
gitmiyor, "hangi uç takılı" diye bir soru yok. Bu dosya eskiden yandan
yaklaşımlı kilit dizisini yürütüyordu; o dizi de, uç yuvaları da, kilit
servosu da, varlık sensörü de kaldırıldı.

BUNUN EN ÖNEMLİ SONUCU: hiçbiri Z ekseninin tam merkezinde değil.

Üçü aynı anda takılı olduğu için her başın merkeze göre kendi X ve Y
kayması var. Makine bir noktaya "sula" derken o noktaya + sulama
başlığının kayması kadar gidiyor, "nem ölç" derken nem probunun kayması
kadar, "ek" derken tohum ucunun kayması kadar. Kayma uygulanmazsa ekim
ortadaki uçla değil sağdakiyle yapılır ve koordinat kayar — sahada tam
bu yaşandı.

Her başın ayrıca kendi `z_min` tabanı (o başın inebileceği en alçak
mutlak Z) ve `derinlik_mm`si (yüzeyin ne kadar altına indiği) var. İkisi
ayrı sorulara cevap veriyor: `z_min` "buradan aşağısı çarpma", `derinlik`
"işini yapmak için ne kadar dalması gerekiyor".

TOHUM UCUNUN KENDİ DİKEY EKSENİ VAR (PLC'de j4 / kodda T ekseni) ve o
`plc.py`de. Ana Z bütün başları birden indirip kaldırıyor; tohum ucu
bunun üstüne bir de kendi başına iniyor. Yalnız tohum alırken ve tohumu
toprağa bırakırken; başka hiçbir zaman aşağıda kalmıyor.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any, Callable

#: Başların kimlikleri — sıra ekranda soldan sağa duruş sırası.
BASLAR = ("sulama", "nem", "tohum")

#: Her başın insan adı ve ne işe yaradığı. Panel ve günlük buradan yazıyor.
BAS_BILGI = {
    "sulama": {"ad": "Sulama başlığı", "simge": "💧",
               "aciklama": "suyu döken baş"},
    "nem": {"ad": "Nem probu", "simge": "🌡️",
            "aciklama": "toprağa dalıp nem okuyan prob"},
    "tohum": {"ad": "Tohum ucu", "simge": "🌱",
              "aciklama": "vakumla tohum alan uç — kendi dikey ekseni var"},
}

#: Bir başın sayısal alanları ve varsayılanları.
BAS_VARSAYILAN = {"dx": 0.0, "dy": 0.0, "z_min": 0.0, "derinlik_mm": 0.0}

#: YALNIZ TOHUM UCUNDA: kendi dikey ekseninin (PLC'de j4) "aşağı" değeri,
#: mutlak T milimetresi. Bir DELTA değil mutlak konum, çünkü T ekseninin
#: yönünü (`dir`) uydurmuyoruz — kullanıcı ucu elle indirip panelde okunan
#: sayıyı yazıyor. Girilmemişse (None) tohum ucu kendi ekseniyle hiç
#: inmiyor ve ekim bugünkü hâliyle, her şeyi ana Z yaparak sürüyor.
#: `t_yukari_mm`: ucun TAM ÇEKİLMİŞ olduğu T değeri. Boşken kalibrasyonun
#: `home`u kullanılıyor (eksen referansa gittiğinde uç yukarıdadır — normal
#: kurulum). Makinede ters bağlıysa buraya öteki uç yazılıyor; yanlış
#: varsayım "uç aşağıdayken X/Y serbest" demek olurdu ve o, ucu toprağa
#: sürtmenin en kolay yolu.
#: `servo_aci`: uç seçici servonun bu başı iş konumuna getirdiği DERECE.
#: İsteğe bağlı ve boş bırakılabilir — boş, "bu baş servoda yok" demek
#: (mekanizmaya henüz bağlanmamış ya da hiç bağlanmayacak), sıfır değil.
#: Sıfır geçerli bir açı ve ikisini karıştırmak, bağlı olmayan bir başı
#: seçmeye çalışmak olurdu.
#:
#: DEĞER ÖLÇÜLEREK GİRİLİYOR, HESAPLANMIYOR. Servo horn'unun dişlisi
#: hiçbir zaman tam 0/90/180'e hizalanmıyor; kullanıcı mekanizmayı elle
#: doğru konuma getirip panelde okunan açıyı yazıyor. Koda 0/90/180
#: gömmek, o üç sayının doğru olduğunu varsaymak olurdu.
BAS_ISTEGE_BAGLI = ("t_asagi_mm", "t_yukari_mm", "servo_aci")

#: Servonun mekanik aralığı. Dışına sürmek dişliyi zorluyor; kart da aynı
#: aralığı denetliyor (firmware `UC` komutu) — iki uçta da denetlemek,
#: seri porta elle yazılan komutu da kapsıyor.
SERVO_ACI_ALT, SERVO_ACI_UST = 0.0, 180.0

VARSAYILAN = {
    # X/Y hareketinin yapılabildiği en düşük Z. Üç baş da bu yükseklikte
    # yatağın üstünden geçiyor.
    "safe_z": 390.0,
    # PLC'nin "Z güvenli yükseklikte" biti. 0 = bağlı değil, karar
    # milimetre karşılaştırmasına kalıyor.
    "z_safe_reg": 0,
    # ================================================================
    # TARET — ÜÇ BAŞLIK TEK PARÇADA, SERVO ONU ÇEVİRİYOR
    #
    # Mekanizma değişti: üç başlık artık üç ayrı yerde DEĞİL. Hepsi tek
    # bir parçada ve o parça Z ekseninin ucunda duruyor; servo hangi
    # açıya dönerse o başlık aşağı bakıyor. Yani başlık seçmek bir yere
    # gitmek değil, bir açıya dönmek.
    #
    # SONUCU: üç başın AYRI dx/dy'si yok. Kayma taretin dönme ekseninin
    # makine referansına göre yeri ve üçü için de AYNI. Baş başına kayma
    # tutmak, aynı fiziksel noktayı üç kez, üç farklı sayıyla yazmak ve
    # birinin ötekilerden ayrışmasına izin vermek olurdu.
    #
    # `dx`/`dy` — dönme ekseninin makine referansına göre kayması (mm).
    #   İşaret `sunucu/baslar.py` `kaydir()` ile aynı: makine
    #   `hedef + (dx, dy)`ye gidiyor, yani taret ekseni noktanın dx/dy
    #   kadar TERSİNDE duruyor.
    # `z_min` — SERVONUN DÖNEBİLMESİ İÇİN gereken en düşük Z (mm).
    #   Z bunun altındayken dönmek, aşağı bakan başlığı toprağın içinden
    #   sürüklemek demek. Girilmemişse (None) karar `plc.z_guvenli_mi`ye
    #   kalıyor — o da bir kural, ama bu mekanizmanın kendi sayısı değil.
    # `sure_ms` — servonun bir açıdan ötekine dönme süresi.
    # Açılar baş başına: `baslar.<kimlik>.servo_aci`.
    "taret": {"dx": 0.0, "dy": 0.0, "z_min": None, "sure_ms": 900},
    # "Z güvenli yükseklikte mi" kıyaslamasının PAYI (mm). Koda gömülü
    # 1,0 mm'ydi; kuruluma göre değişiyor ve panelden giriliyor.
    "guvenli_z_ofset": 1.0,
    # ÜÇ BAŞLIK. Kaymaları artık burada DEĞİL (bkz. `taret`); burada
    # kalan, her başlığın kendi derinliği ve kendi Z tabanı — taret
    # döndüğünde aşağı bakan başlığın boyu ötekilerden farklı olabiliyor.
    "baslar": {
        "sulama": {"dx": 60.0, "dy": 60.0, "z_min": 230.0, "derinlik_mm": 0.0},
        "nem": {"dx": 0.0, "dy": 0.0, "z_min": 0.0, "derinlik_mm": 20.0},
        "tohum": {"dx": 0.0, "dy": 0.0, "z_min": 0.0, "derinlik_mm": 0.0},
    },
    # UÇ SEÇİCİ SERVONUN HAREKET SÜRESİ (ms). Karta gömülmüyor: süre
    # servonun hızına, horn'un yüküne ve iki açı arasındaki mesafeye
    # bağlı, yani bir kurulum özelliği. Kart bu süre dolana kadar
    # "gidiyor" diyor (bkz. firmware `UC`). Buradaki 900, servo
    # doğrulanmadığı için ÖLÇÜLMÜŞ bir değer DEĞİL; en geniş dönüşün
    # tipik SG90/MG996 hız sayfalarına göre kabaca üst sınırı ve
    # doğrulama sırasında ölçülüp güncellenmesi bekleniyor. Kısa
    # tutmaktansa uzun tutuluyor: erken "vardı" demek, horn yoldayken iş
    # başlatmak olurdu.
    # ESKİ ANAHTAR. `taret.sure_ms` geldi; okurken ikisi de kabul
    # ediliyor (bkz. `servo_sure_ms()`), yazarken yalnız `taret` — iki
    # yerde iki farklı süre, hangisinin geçerli olduğunu belirsiz yapar.
    "servo_sure_ms": 900,
    # Tohumluk gözleri: koordinatı, içindeki tür ve dolu/boş hâli.
    # Liste boşken tohumluk tanımsız sayılıyor ve çizilmiyor.
    "tohumluk": {"gozler": []},
}


def _taret_dogrula(ham: Any) -> dict[str, Any]:
    """Taret ayarını sayıya çevirir. `z_min` boş kalabilir, ötekiler kalamaz.

    `z_min` için sıfır GEÇERLİ bir Z ve "girilmedi" ile karıştırmak,
    servoyu her yükseklikte döndürmeye izin vermek olurdu — aşağı bakan
    başlığı toprağın içinden sürüklemenin en kolay yolu.
    """
    h = ham if isinstance(ham, dict) else {}
    v = VARSAYILAN["taret"]
    cikti: dict[str, Any] = {}
    for alan in ("dx", "dy"):
        try:
            cikti[alan] = round(float(h.get(alan, v[alan])), 2)
        except (TypeError, ValueError):
            cikti[alan] = float(v[alan])
    z = h.get("z_min", v["z_min"])
    if z in (None, ""):
        cikti["z_min"] = None
    else:
        try:
            cikti["z_min"] = round(float(z), 2)
        except (TypeError, ValueError):
            cikti["z_min"] = None
    try:
        sure = int(h.get("sure_ms", v["sure_ms"]))
    except (TypeError, ValueError):
        sure = int(v["sure_ms"])
    # Kartın da kabul ettiği aralık (firmware `UC`): dışına çıkan bir
    # süre komutu reddettirir ve uç hiç seçilemez.
    cikti["sure_ms"] = max(1, min(10000, sure))
    return cikti


class UcHatasi(Exception):
    """Kafa ayarlarıyla ilgili hata."""


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
    for eksen in ("x", "y", "z", "t"):
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
    # T BOŞ KALABİLİR ve boş "bu gözde T kullanma" demek — sıfır DEĞİL.
    # Sıfır geçerli bir T değeri (uç tamamen çekilmiş); boşu sıfıra
    # çevirmek, T'si girilmemiş her gözde ucu çekili tutmaya çalışmak
    # olurdu. Haznelerin derinliği aynı olmadığı için T göz başına.

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
        "x": konum["x"], "y": konum["y"], "z": konum["z"], "t": konum["t"],
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
                  "z": ham.get("z"), "t": ham.get("t"),
                  "tohum": "", "dolu": True}]
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

def _bas_dogrula(ham: Any) -> dict[str, Any]:
    """Tek bir başın alanlarını sayıya çevirir; okunamayan varsayılana düşer.

    Sessizce sıfıra düşmüyoruz diye değil — düşüyoruz, ama varsayılan
    sıfır zaten "kayma yok" demek ve bir başın kaymasını bilmemek onu
    merkeze koymaktan başka bir şeye izin vermiyor. Yanlış bir kayma
    uydurmak, tohumu yanlış yere ekmek olurdu.
    """
    h = ham if isinstance(ham, dict) else {}
    cikti: dict[str, Any] = {}
    for alan, vars_ in BAS_VARSAYILAN.items():
        deger = h.get(alan, vars_)
        try:
            cikti[alan] = round(float(deger), 2)
        except (TypeError, ValueError):
            cikti[alan] = float(vars_)
    # İSTEĞE BAĞLI ALANLAR SIFIRA DÜŞMÜYOR. `t_asagi_mm` için sıfır
    # geçerli bir T konumu; "girilmedi" ile "sıfır" ikisi ayrı şey ve
    # karıştırmak, kurulmamış bir ekseni sıfıra sürmek olurdu.
    for alan in BAS_ISTEGE_BAGLI:
        deger = h.get(alan)
        if deger in (None, ""):
            cikti[alan] = None
            continue
        try:
            sayi = round(float(deger), 2)
        except (TypeError, ValueError):
            cikti[alan] = None
            continue
        # ARALIK DIŞI AÇI KAYDEDİLMİYOR. Kırpmak da yok: 200 yazan biri
        # 180'i değil 200'ü kastediyor ve sessizce 180'e çekmek, panelde
        # yazandan başka bir açıya sürmek demek. Boşa düşüyor ve
        # `kaydet` bunu kullanıcıya söylüyor.
        if alan == "servo_aci" and not (SERVO_ACI_ALT <= sayi <= SERVO_ACI_UST):
            cikti[alan] = None
            continue
        cikti[alan] = sayi
    return cikti


def _baslar_dogrula(ham: Any, eski_sulama: Any = None) -> dict[str, dict[str, Any]]:
    """Üç başı normalleştirir — eksik olan varsayılanla doluyor.

    ESKİ AYAR DOSYASI KAYBOLMUYOR: `baslar` bloğu yokken `sulama_basligi`
    varsa sulama başı ondan kuruluyor. Sahadaki makinede +60/+60 ölçülmüş
    ve çalışıyor; sürüm geçişinde onu sıfırlamak, çalışan bir sulamayı
    bozmak olurdu.
    """
    h = ham if isinstance(ham, dict) else {}
    cikti: dict[str, dict[str, Any]] = {}
    for kimlik in BASLAR:
        if kimlik in h:
            cikti[kimlik] = _bas_dogrula(h.get(kimlik))
        elif kimlik == "sulama" and isinstance(eski_sulama, dict):
            cikti[kimlik] = _bas_dogrula(eski_sulama)
        else:
            cikti[kimlik] = _bas_dogrula(
                (VARSAYILAN["baslar"] or {}).get(kimlik))
    return cikti


class Uclar:
    """Kafa ayarlarının ve tohumluğun tek doğru kaynağı.

    Sınıf adı `Uclar` kalıyor: `durum.uc` alanını okuyan onlarca yer var
    (sunucu, panel, 3B sahne) ve hepsini yeniden adlandırmak, bu
    değişikliğin gerçek işine (kaymalar ve tohum ucu ekseni) hiçbir şey
    katmadan riski büyütürdü.
    """

    def __init__(self, ayar: dict[str, Any], plc: Any,
                 gunluk_cb: Callable[[str, str], None] | None = None) -> None:
        self.plc = plc
        self.gunluk_cb = gunluk_cb or (lambda m, s="bilgi": None)
        ozel = ayar.get("uc_dosyasi") or "uclar.json"
        self.yol = ozel if os.path.isabs(ozel) else os.path.join(
            os.path.dirname(os.path.abspath(__file__)), ozel)
        self._kilit = threading.RLock()
        self.ayar: dict[str, Any] = dict(VARSAYILAN)
        self.yukle()

    # --- dosya -----------------------------------------------------------
    def yukle(self) -> None:
        with self._kilit:
            # DOSYADA taret var mıydı — birleştirmeden ÖNCE bakılıyor.
            # `VARSAYILAN`da artık bir taret bloğu var; birleşmiş sözlüğe
            # bakmak "her zaman var" cevabını verir ve eski dosyadan
            # taşıma hiç çalışmazdı.
            dosyada_taret = False
            if os.path.exists(self.yol):
                try:
                    with open(self.yol, encoding="utf-8") as dosya:
                        ham = json.load(dosya)
                    dosyada_taret = isinstance(ham, dict) and "taret" in ham
                    self.ayar = {**VARSAYILAN, **ham}
                except (json.JSONDecodeError, OSError) as hata:
                    self.gunluk_cb(
                        f"Kafa ayarları okunamadı ({hata}) — varsayılanlar "
                        f"kullanılıyor", "hata")
            # Eski biçimli tohumluk (tek koordinat) OKURKEN göz listesine
            # çevriliyor. Yükleme anında yapmasak dosyada eski biçim
            # kalırdı ve bir sonraki `kaydet` onu geri yazardı.
            self.ayar["tohumluk"] = _tohumluk_dogrula(self.ayar.get("tohumluk"))
            self.ayar["baslar"] = _baslar_dogrula(
                self.ayar.get("baslar"), self.ayar.get("sulama_basligi"))
            # TARET KAYMASI ESKİ DOSYADAN GELEBİLİR. Mekanizma değişmeden
            # önce kayma baş başına yazılıyordu ve sahada ölçülmüş tek
            # gerçek değer sulamanınkiydi (+60/+60). Taret girilmemişse
            # onu başlangıç değeri sayıyoruz: kullanıcının ölçtüğü sayıyı
            # sıfırlamak, çalışan bir kurulumu bozmak olurdu. Panelden
            # yeni değer girilince burası bir daha devreye girmiyor.
            if not dosyada_taret:
                eski = (self.ayar.get("baslar") or {}).get("sulama") or {}
                self.ayar["taret"] = {**VARSAYILAN["taret"],
                                      "dx": eski.get("dx", 0.0),
                                      "dy": eski.get("dy", 0.0)}
            self.ayar["taret"] = _taret_dogrula(self.ayar.get("taret"))

    def kaydet(self, yeni: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._kilit:
            if yeni:
                temiz = dict(yeni)
                if "tohumluk" in temiz:
                    temiz["tohumluk"] = _tohumluk_dogrula(temiz["tohumluk"])
                if "taret" in temiz:
                    temiz["taret"] = _taret_dogrula({
                        **(self.ayar.get("taret") or {}),
                        **(temiz["taret"] or {})})
                if "baslar" in temiz:
                    # BAŞ BAŞINA BİRLEŞTİRME. Üst düzey birleştirme, tek bir
                    # başın dx'ini yollayan bir isteğin öteki iki başı
                    # silmesi demekti.
                    birlesik = dict(self.ayar.get("baslar") or {})
                    for kimlik, deger in (temiz["baslar"] or {}).items():
                        if kimlik in BASLAR:
                            birlesik[kimlik] = {
                                **birlesik.get(kimlik, {}),
                                **_bas_dogrula(deger)}
                    temiz["baslar"] = _baslar_dogrula(birlesik)
                # Eski panel `sulama_basligi` gönderiyor olabilir: sulama
                # başına yazıyoruz ki iki yerde iki farklı kayma olmasın.
                if "sulama_basligi" in temiz:
                    birlesik = dict(temiz.get("baslar")
                                    or self.ayar.get("baslar") or {})
                    birlesik["sulama"] = _bas_dogrula({
                        **birlesik.get("sulama", {}),
                        **(temiz.pop("sulama_basligi") or {})})
                    temiz["baslar"] = _baslar_dogrula(birlesik)
                self.ayar = {**self.ayar, **temiz}
            # `sulama_basligi` dosyada TUTULMUYOR: tek doğru kaynak
            # `baslar.sulama`. İkisi birden dursaydı hangisinin geçerli
            # olduğu bir sonraki okumada belirsiz olurdu.
            self.ayar.pop("sulama_basligi", None)
            _atomik_yaz(self.yol, self.ayar)
        return self.ayar

    # --- başlar ----------------------------------------------------------
    def taret(self) -> dict[str, Any]:
        """Taretin kayması, dönme için gereken Z ve dönüş süresi."""
        return _taret_dogrula(self.ayar.get("taret"))

    def baslar(self) -> dict[str, dict[str, Any]]:
        """Üç başlığın ayarları — sunucu ve panel buradan okuyor.

        KAYMA ÜÇÜ İÇİN DE AYNI ve taretten geliyor. Üç başlık tek bir
        parçada; hangisi aşağı bakarsa aynı noktada bakıyor, aralarındaki
        fark yalnız servo açısı. `dx`/`dy` alanları duruyor çünkü
        `sunucu/baslar.py` `kaydir()` ve ekim/sulama akışları bu adla
        okuyor — üçüne de taretin sayısını yazmak, o zinciri hiç
        değiştirmeden tek kaynağa bağlamanın yolu. Baş başına farklı bir
        kayma YAZILAMIYOR: aynı fiziksel noktanın üç kopyası ayrışırdı.
        """
        baslar = _baslar_dogrula(self.ayar.get("baslar"),
                                 self.ayar.get("sulama_basligi"))
        t = self.taret()
        for bas in baslar.values():
            bas["dx"] = t["dx"]
            bas["dy"] = t["dy"]
        return baslar

    def bas(self, kimlik: str) -> dict[str, Any]:
        """Tek bir baş. Bilinmeyen kimlik için kaymasız baş dönüyor.

        Hata atmıyoruz: bilinmeyen bir iş türü için kayma sormak,
        makineyi durdurmayı değil merkeze gitmeyi hak ediyor — ve merkez,
        kaymanın uygulanmadığı eski davranışın ta kendisi.
        """
        return self.baslar().get(str(kimlik), _bas_dogrula(None))

    @staticmethod
    def bas_indeksi(kimlik: str) -> int:
        """Başın servo komutundaki indeksi — `BASLAR` sırası.

        Kart hiçbir adı bilmiyor, yalnız 0-2 arası bir indeks alıyor
        (bkz. firmware `UC`). Sıra tek bir yerde tanımlı olsun diye
        burada; iki yerde iki farklı sıra, yanlış ucu seçmek demekti.
        """
        try:
            return BASLAR.index(str(kimlik))
        except ValueError:
            return -1

    def servo_sure_ms(self) -> int:
        """Servonun dönüş süresi (ms) — ayardan, koda gömülü değil.

        Önce `taret.sure_ms`; eski dosyalarda üst düzey `servo_sure_ms`
        olabiliyor ve okurken o da kabul ediliyor. Yazma yalnız `taret`e
        gidiyor, iki yerde iki farklı süre kalmasın diye.
        """
        ham = (self.ayar.get("taret") or {}).get("sure_ms")
        if ham in (None, ""):
            ham = self.ayar.get("servo_sure_ms")
        try:
            sure = int(ham or VARSAYILAN["taret"]["sure_ms"])
        except (TypeError, ValueError):
            sure = int(VARSAYILAN["taret"]["sure_ms"])
        return max(1, min(10000, sure))

    def guvenli_z_ofset(self) -> float:
        """"Z güvenli mi" kıyaslamasının payı (mm) — ajan PLC'ye taşıyor."""
        try:
            return max(0.0, float(self.ayar.get("guvenli_z_ofset",
                                                VARSAYILAN["guvenli_z_ofset"])))
        except (TypeError, ValueError):
            return float(VARSAYILAN["guvenli_z_ofset"])

    def servo_komutu(self, kimlik: str) -> tuple[str, str]:
        """(komut, engel) — engel boş değilse komut GÖNDERİLMEMELİ.

        Servoya gidecek satırı burada kuruyoruz çünkü açının kaynağı
        ayar dosyası ve indeksin kaynağı `BASLAR`; ikisi de burada.
        Açı girilmemişse komut YOK: o baş mekanizmaya bağlanmamış
        demektir ve uydurma bir açıya sürmek mekanizmayı zorlar.
        """
        kimlik = str(kimlik or "")
        indeks = self.bas_indeksi(kimlik)
        if indeks < 0:
            return "", f"Bilinmeyen baş: '{kimlik}'"
        aci = self.bas(kimlik).get("servo_aci")
        if aci is None:
            ad = (BAS_BILGI.get(kimlik) or {}).get("ad", kimlik)
            return "", (f"{ad} için servo açısı girilmemiş — Ayarlar → "
                        f"Başlar ve tohumluk bölümünde ölçülen açıyı yazın. "
                        f"Açı olmadan uç seçilmiyor; uydurma bir açıya "
                        f"sürmek mekanizmayı zorlar.")
        return f"UC {indeks} {int(round(float(aci)))} {self.servo_sure_ms()}", ""

    def sulama_basligi(self) -> dict[str, float]:
        """Sulama başlığının kayması ve Z tabanı.

        Adı duruyor çünkü sulama akışı (`sunucu/sulama.py`) ve panel bu
        adla okuyor; içerik artık `baslar.sulama`dan geliyor.
        """
        b = self.bas("sulama")
        return {"dx": b["dx"], "dy": b["dy"], "z_min": b["z_min"]}

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
        return {"x": g["x"], "y": g["y"], "z": g["z"], "t": g.get("t")}

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
