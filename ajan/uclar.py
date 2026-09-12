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

#: Hızların geçerli aralığı — panel, ajan ve PLC sürücüsü aynı sınırı
#: kullanıyor. Üç yerde üç sınır olsaydı biri gevşek kalırdı.
HIZ_ALT, HIZ_UST = 1.0, 200.0


def _hiz_dogrula(deger: Any) -> float | None:
    """Tek bir hız değeri — geçersizse None ("bu eksende genel hız").

    None SIFIR DEĞİL: boş bırakılan eksen genel hıza düşüyor, durmuyor.
    """
    if deger in (None, ""):
        return None
    try:
        sayi = float(deger)
    except (TypeError, ValueError):
        return None
    if not HIZ_ALT <= sayi <= HIZ_UST:
        return None
    return sayi


VARSAYILAN = {
    # X/Y hareketinin yapılabildiği en düşük Z. Üç baş da bu yükseklikte
    # yatağın üstünden geçiyor.
    "safe_z": 390.0,
    # HIZLAR BURADA, `ajan/ayar.json`da DEĞİL.
    #
    # Eskiden panelden verilen hız yalnız ÇALIŞMA ANINDA geçerliydi ve
    # ajan her yeniden başladığında varsayılana dönüyordu — ajan ise sık
    # yeniden başlıyor (`arduino-yukle.sh`, `guncelle.sh`, servis
    # yenileme). Kullanıcı Z'yi 10'a çekiyor, bir süre sonra makine 20
    # ile iniyordu ve bunu haber veren hiçbir şey yoktu.
    #
    # NEDEN `ayar.json` DEĞİL: o dosyada panel jetonu ve PLC adresi var,
    # ajanın onu kendi yeniden yazması istenmiyor. `uclar.json` zaten
    # panelin düzenlediği dosya, içinde sır yok ve `guncelle.sh` onu
    # Pi'de koruyor — hızların yeri burası.
    #
    # None = "girilmemiş", sıfır değil: o eksende `ayar.json`daki değer
    # (ya da genel hız) geçerli kalıyor.
    # PROKSİMİTE ANAHTARI -> HANGİ BAŞ.
    #
    # Anahtar kapalıyken o baş yukarıda; baş inince bağlantı kesiliyor ve
    # lambası sönüyor. Hangi anahtarın hangi başa gittiği KABLOLAMA
    # gerçeği, kod varsayımı değil — bir süre `PROX_BAS_SIRASI` diye
    # panelde sabit duruyordu ve ters bağlanmış bir makinede yanlış başı
    # gösterirdi. Ayara alındı.
    #
    # Sıra PLC giriş sırası: [X0, X5, X6] -> [D1110, D1111, D1112].
    # Boş dize ("") "bu anahtar bir başa bağlı değil" demek.
    # TOHUM UCU "YUKARIDA" SAYILMA PAYI (mm).
    #
    # X/Y hareketi tohum ucunun çekilmiş olmasına bağlı ve "çekilmiş" bir
    # NOKTA değil bir PAY: eksen hedefe tam oturmuyor, birkaç sayım
    # şaşıyor. Pay küçükse uç yukarıdayken bile hareket reddediliyor
    # ("Tohum ucu aşağıda" hatası), büyükse gerçekten inmiş bir uçla
    # yatay hareket serbest kalıyor.
    #
    # `guvenli_z_ofset` ile aynı mantık, T karşılığı. Koda 1.5 mm gömülü
    # ve yalnız `ajan/ayar.json`da düzenlenebilirdi; panelde yoktu.
    # None = girilmemiş, `ayar.json`daki değer geçerli.
    "guvenli_t": None,
    # HOME ANAHTARLARINA GÜVENİLSİN Mİ (D1120-D1123).
    #
    # Kapalıyken anahtarlar yalnız PANELDE görünüyor, hiçbir karara
    # girmiyor. PLC'de X1/X2/X3/X4 girişlerini o registerlara kopyalayan
    # ladder satırları yazıldıktan ve `plc-oku.py 1120 4` ile değiştiği
    # görüldükten SONRA açılmalı: açıkken home, anahtar basılmadıysa
    # "varmadı" diyor ve ladder yokken bütün registerlar 0 okuduğu için
    # her home başarısız sayılırdı.
    #: Boş liste = hiçbirine güvenilmiyor. Ladder kopyalaması yazılıp
    #: `plc-oku.py 1120 4 -i` ile değiştiği GÖRÜLDÜKTEN sonra eksen
    #: adları yazılıyor: ["x", "y", "z"].
    #:
    #: EKSEN EKSEN, tek anahtarla değil: bu makinede T'de home anahtarı
    #: yok ve tek anahtarla açılsaydı T'nin registerı hep 0 okur, her T
    #: home'u "anahtara basmadı" diye reddedilirdi.
    "home_anahtari": [],
    "prox_baslar": ["sulama", "nem", "tohum"],
    "hiz": None,
    "hiz_eksen": [None, None, None, None],   # [X, Y, Z, T]
    # PLC'nin "Z güvenli yükseklikte" biti. 0 = bağlı değil, karar
    # milimetre karşılaştırmasına kalıyor.
    "z_safe_reg": 0,
    # ================================================================
    # UÇ SEÇİCİ — SERVO BAŞLIK TAŞIMIYOR, SIRASI GELENİ İNDİRİYOR
    #
    # Üç başlık tek bir parçada BİRLEŞTİRİLDİ ama DÖNMÜYORLAR: her
    # başlık kendi sabit yerinde, yan yana duruyor. Servo hiçbir şeyi
    # bir yerden başka yere taşımıyor; yalnız sırası gelen başlığı AŞAĞI
    # İNDİRİYOR. Servo açısı = hangi başlığın indirileceği. Z ekseni de
    # eskisi gibi bütün grubu aşağı yukarı taşıyor.
    #
    # BURADA NEDEN KAYMA YOK. Bir süre bu mekanizma TARET sanıldı
    # ("üç başlık dönüp aynı çalışma noktasına geliyor") ve baş başına
    # `dx/dy` kaldırılıp tek bir `taret.dx/dy` konmuştu. Dönme olmadığı
    # için o varsayım geçersiz: üç başlık üç AYRI noktada duruyor ve tek
    # bir kayma ikisini yanlış yere koyar. Sulama başlığında birkaç mm
    # önemsiz, tohum ucunda tohum yanlış deliğe gider. Kaymalar bu
    # yüzden `baslar.<kimlik>.dx/dy`de, burada değil.
    #
    # Burada kalan iki şey de başlığa değil MEKANİZMAYA ait:
    # `sure_ms`  — servo hareketinin süresi: bir başlığı indirmek ya da
    #   kaldırmak ne kadar sürüyor. Kart bu süre dolana kadar "gidiyor"
    #   diyor (bkz. firmware `UC`) ve iş süre dolmadan başlamıyor.
    #   Karta gömülmüyor: servonun hızına ve mekanizmanın yüküne bağlı,
    #   yani bir kurulum özelliği. Buradaki 900 servo doğrulanmadığı için
    #   ÖLÇÜLMÜŞ bir değer DEĞİL; tipik SG90/MG996 hız sayfalarından kaba
    #   bir üst sınır ve doğrulamada ölçülüp güncellenmesi bekleniyor.
    #   Kısa tutmaktansa uzun tutuluyor: erken "vardı" demek, başlık
    #   yoldayken iş başlatmak olurdu.
    # `guvenli_z` — BAŞKA BİR BAŞLIĞI İNDİRMEDEN ÖNCE inen başlığın
    #   çekilmiş olması için gereken yükseklik (mm). Z bunun altındayken
    #   inen başlık toprağın içinde olabiliyor; ikinci bir başlığı
    #   indirmek onu da toprağa sokar. Girilmemişse (None) karar genel
    #   Z güvenlik kuralına (`plc.z_guvenli_mi`) kalıyor — o da bir
    #   kural, ama bu mekanizmanın kendi ölçülmüş sayısı değil.
    # Hangi açının hangi başlığı indirdiği baş başına:
    # `baslar.<kimlik>.servo_aci`.
    "uc_secici": {"guvenli_z": None, "sure_ms": 900},
    # "Z güvenli yükseklikte mi" kıyaslamasının PAYI (mm). Koda gömülü
    # 1,0 mm'ydi; kuruluma göre değişiyor ve panelden giriliyor.
    "guvenli_z_ofset": 1.0,
    # ÜÇ BAŞLIK, ÜÇ AYRI NOKTA. `dx`/`dy` her başlığın makine
    # referansına göre yeri; işaret `sunucu/baslar.py` `kaydir()` ile
    # aynı: makine `hedef + (dx, dy)`ye gidiyor, yani başlık noktanın
    # dx/dy kadar TERSİNDE duruyor. Sulamanın +60/+60 değeri sahada
    # ölçüldü; ötekiler ölçülene kadar sıfır ve sıfır "kayma yok" demek.
    "baslar": {
        "sulama": {"dx": 60.0, "dy": 60.0, "z_min": 230.0, "derinlik_mm": 0.0},
        "nem": {"dx": 0.0, "dy": 0.0, "z_min": 0.0, "derinlik_mm": 20.0},
        "tohum": {"dx": 0.0, "dy": 0.0, "z_min": 0.0, "derinlik_mm": 0.0},
    },
    # Tohumluk gözleri: koordinatı, içindeki tür ve dolu/boş hâli.
    # Liste boşken tohumluk tanımsız sayılıyor ve çizilmiyor.
    "tohumluk": {"gozler": []},
}


def _uc_secici_dogrula(ham: Any) -> dict[str, Any]:
    """Uç seçici ayarını sayıya çevirir. `guvenli_z` boş kalabilir.

    `guvenli_z` için sıfır GEÇERLİ bir Z ve "girilmedi" ile karıştırmak,
    her yükseklikte ikinci bir başlığı indirmeye izin vermek olurdu —
    inen başlık toprağın içindeyken bir tane daha indirmenin en kolay
    yolu. Kayma alanı YOK: üç başlık üç ayrı noktada ve kayma baş
    başına (`baslar.<kimlik>.dx/dy`).
    """
    h = ham if isinstance(ham, dict) else {}
    v = VARSAYILAN["uc_secici"]
    cikti: dict[str, Any] = {}
    z = h.get("guvenli_z", v["guvenli_z"])
    if z in (None, ""):
        cikti["guvenli_z"] = None
    else:
        try:
            cikti["guvenli_z"] = round(float(z), 2)
        except (TypeError, ValueError):
            cikti["guvenli_z"] = None
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

def _bas_dogrula(ham: Any, kismi: bool = False) -> dict[str, Any]:
    """Tek bir başın alanlarını sayıya çevirir; okunamayan varsayılana düşer.

    Sessizce sıfıra düşmüyoruz diye değil — düşüyoruz, ama varsayılan
    sıfır zaten "kayma yok" demek ve bir başın kaymasını bilmemek onu
    merkeze koymaktan başka bir şeye izin vermiyor. Yanlış bir kayma
    uydurmak, tohumu yanlış yere ekmek olurdu.
    """
    h = ham if isinstance(ham, dict) else {}
    cikti: dict[str, Any] = {}
    for alan, vars_ in BAS_VARSAYILAN.items():
        # ALAN İSTEKTE YOKSA DOKUNULMUYOR — `kismi` iken.
        #
        # Burası her alanı HER SEFERİNDE yazıyordu: istekte olmayan alan
        # varsayılana (0) düşüyor, isteğe bağlı olan `None` oluyordu. Üst
        # taraftaki birleştirme (`{**eski, **_bas_dogrula(...)}`) o yüzden
        # hiçbir şey koruyamıyordu — sözlük zaten bütün anahtarları
        # taşıyordu.
        #
        # Sahada görülen: kullanıcı bir değeri girip kaydediyor, sonra
        # başka bir alanı kaydeden ikinci bir istek gelince ilki
        # sıfırlanıyor. Sayfa yenilenince "girdiğim değerler geri gitti".
        #
        # BOŞ DİZE HÂLÂ TEMİZLİYOR: kullanıcı bir alanı bilerek boşalttıysa
        # o bir istek. "Yok" ile "boş" ayrı şeyler.
        if kismi and alan not in h:
            continue
        deger = h.get(alan, vars_)
        try:
            cikti[alan] = round(float(deger), 2)
        except (TypeError, ValueError):
            cikti[alan] = float(vars_)
    # İSTEĞE BAĞLI ALANLAR SIFIRA DÜŞMÜYOR. `t_asagi_mm` için sıfır
    # geçerli bir T konumu; "girilmedi" ile "sıfır" ikisi ayrı şey ve
    # karıştırmak, kurulmamış bir ekseni sıfıra sürmek olurdu.
    for alan in BAS_ISTEGE_BAGLI:
        if kismi and alan not in h:
            continue
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
            # DOSYADAKİ HÂLİ — birleştirmeden ÖNCE. `VARSAYILAN`da hem
            # `uc_secici` hem baş başına `dx/dy` var; birleşmiş sözlüğe
            # bakmak her soruya "var" cevabını verir ve göç hiç
            # çalışmazdı. Taret göçünde tam bu tuzağa düşülmüştü.
            dosyada_taret = None
            dosyada_baslar = None
            dosyada_secici = None
            if os.path.exists(self.yol):
                try:
                    with open(self.yol, encoding="utf-8") as dosya:
                        ham = json.load(dosya)
                    if isinstance(ham, dict):
                        dosyada_taret = ham.get("taret")
                        dosyada_baslar = ham.get("baslar")
                        dosyada_secici = ham.get("uc_secici")
                    self.ayar = {**VARSAYILAN, **ham}
                    self.ayar.pop("taret", None)      # karşılığı olmayan blok
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
            # ================================================================
            # GÖÇ — TARET KAYMASI ÜÇ BAŞLIĞA DAĞILIYOR
            #
            # Mekanizma bir süre TARET sanıldı ve baş başına `dx/dy`
            # kaldırılıp tek bir `taret.dx/dy` konmuştu. Dönme olmadığı
            # için o blok kalkıyor; ama içindeki sayı KULLANICININ ÖLÇTÜĞÜ
            # sayı ve kaybolmamalı. Üç başlığa da başlangıç değeri olarak
            # yazılıyor; kullanıcı sonra tek tek ölçüp düzeltecek.
            #
            # BİR KEZ ÇALIŞIYOR: koşul dosyada bir `taret` bloğu bulunması
            # ve içinde sıfırdan farklı bir kayma olması. Kaydettikten
            # sonra `taret` dosyadan düşüyor, dolayısıyla koşul bir daha
            # sağlanamıyor.
            #
            # BAŞ BAŞINA ÖLÇÜLMÜŞ BİR SAYI VARSA DOKUNULMUYOR: taret
            # sürümünde panel kayma göndermediği için baş başına değerler
            # sıfıra düşmüştü; sıfır olmayan bir değer varsa o, taretin
            # sayısından daha yenidir ve üstüne yazmak ölçümü silmek olur.
            eski_taret = dosyada_taret if isinstance(dosyada_taret, dict) else {}
            try:
                t_dx = float(eski_taret.get("dx") or 0.0)
                t_dy = float(eski_taret.get("dy") or 0.0)
            except (TypeError, ValueError):
                t_dx = t_dy = 0.0
            if t_dx or t_dy:
                dosya_baslar = dosyada_baslar if isinstance(dosyada_baslar, dict) else {}
                bas_kaymasi_var = False
                for kimlik in BASLAR:
                    b = dosya_baslar.get(kimlik)
                    if not isinstance(b, dict):
                        continue
                    try:
                        if float(b.get("dx") or 0.0) or float(b.get("dy") or 0.0):
                            bas_kaymasi_var = True
                    except (TypeError, ValueError):
                        pass
                if not bas_kaymasi_var:
                    for kimlik in BASLAR:
                        self.ayar["baslar"][kimlik]["dx"] = round(t_dx, 2)
                        self.ayar["baslar"][kimlik]["dy"] = round(t_dy, 2)
                    self.gunluk_cb(
                        f"Uç kaymaları taşındı: taret kayması {t_dx:+.1f}/"
                        f"{t_dy:+.1f} mm üç başlığa da başlangıç değeri olarak "
                        f"yazıldı. Üç başlık ayrı noktalarda duruyor — her "
                        f"birini ölçüp Ayarlar → Başlar bölümünde düzeltin.",
                        "bilgi")
            # SÜRE DE ESKİ ANAHTARLARDAN GELEBİLİR. Sırasıyla:
            # `uc_secici.sure_ms`, `taret.sure_ms` (kalkan blok), üst
            # düzey `servo_sure_ms` (ondan da eski). Dosyada hangisi
            # varsa yeni bloğa taşınıyor; okuma yolunda üç anahtarı
            # birden yoklamak, hangisinin geçerli olduğunu her çağrıda
            # yeniden sormak olurdu.
            # DOSYADAKİ blok — birleşmiş sözlükte `VARSAYILAN`ın süresi
            # duruyor ve ona bakmak "her zaman var" der; göç tuzağının
            # aynısı.
            secici = dict(dosyada_secici) if isinstance(dosyada_secici, dict) else {}
            if secici.get("sure_ms") in (None, ""):
                eski_sure = (eski_taret.get("sure_ms")
                             if isinstance(dosyada_taret, dict) else None)
                if eski_sure in (None, ""):
                    eski_sure = self.ayar.get("servo_sure_ms")
                if eski_sure not in (None, ""):
                    secici["sure_ms"] = eski_sure
            self.ayar["uc_secici"] = _uc_secici_dogrula(secici)

    def kaydet(self, yeni: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._kilit:
            if yeni:
                temiz = dict(yeni)
                if "tohumluk" in temiz:
                    temiz["tohumluk"] = _tohumluk_dogrula(temiz["tohumluk"])
                if "uc_secici" in temiz:
                    temiz["uc_secici"] = _uc_secici_dogrula({
                        **(self.ayar.get("uc_secici") or {}),
                        **(temiz["uc_secici"] or {})})
                # KARŞILIĞI OLMAYAN BLOK YAZILMIYOR. Eski panel `taret`
                # gönderiyor olabilir; dosyada tutmak, kalkmış bir kavramı
                # diri tutmak ve bir sonraki okumada göçü yeniden
                # tetiklemek olurdu.
                temiz.pop("taret", None)
                # HIZLAR SÜZÜLEREK YAZILIYOR. Panelden gelen sayı zaten
                # denetleniyor, ama dosya elle de düzenlenebiliyor; aralık
                # dışı bir Z hızı sessizce yürürlüğe girerse makine
                # beklenenden hızlı iner.
                if "guvenli_t" in temiz:
                    try:
                        g = float(temiz["guvenli_t"])
                        temiz["guvenli_t"] = round(g, 2) if 0.0 <= g <= 50.0 else None
                    except (TypeError, ValueError):
                        temiz["guvenli_t"] = None
                if "prox_baslar" in temiz:
                    # Yalnız tanınan baş kimlikleri ya da boş dize.
                    # Tanınmayan bir ad yazmak, lambayı adsız bırakırdı.
                    ham = temiz["prox_baslar"]
                    ham = list(ham) if isinstance(ham, (list, tuple)) else []
                    temiz["prox_baslar"] = [
                        (str(k) if str(k) in BASLAR else "")
                        for k in (ham + ["", "", ""])[:3]]
                if "hiz" in temiz:
                    temiz["hiz"] = _hiz_dogrula(temiz["hiz"])
                if "hiz_eksen" in temiz:
                    ham = temiz["hiz_eksen"]
                    ham = list(ham) if isinstance(ham, (list, tuple)) else []
                    temiz["hiz_eksen"] = [_hiz_dogrula(h)
                                          for h in (ham + [None] * 4)[:4]]
                if "baslar" in temiz:
                    # BAŞ BAŞINA BİRLEŞTİRME. Üst düzey birleştirme, tek bir
                    # başın dx'ini yollayan bir isteğin öteki iki başı
                    # silmesi demekti.
                    birlesik = dict(self.ayar.get("baslar") or {})
                    for kimlik, deger in (temiz["baslar"] or {}).items():
                        if kimlik in BASLAR:
                            # KISMİ: istekte OLMAYAN alan korunuyor.
                            # Panel bir başın yalnız bir alanını
                            # gönderdiğinde ötekiler silinmesin.
                            birlesik[kimlik] = {
                                **birlesik.get(kimlik, {}),
                                **_bas_dogrula(deger, kismi=True)}
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
    def uc_secici(self) -> dict[str, Any]:
        """Mekanizmanın kendi ayarları: hareket süresi ve güvenli yükseklik.

        Kayma BURADA YOK — üç başlık üç ayrı noktada ve her birinin
        kendi `dx/dy`si var (`baslar()`).
        """
        return _uc_secici_dogrula(self.ayar.get("uc_secici"))

    def baslar(self) -> dict[str, dict[str, Any]]:
        """Üç başlığın ayarları — sunucu ve panel buradan okuyor.

        KAYMA BAŞ BAŞINA. Üç başlık tek parçada birleştirilmiş ama
        dönmüyorlar: her biri kendi sabit yerinde, yan yana duruyor.
        Servo yalnız sırası geleni indiriyor, hiçbir şeyi bir yerden
        başka yere taşımıyor — dolayısıyla üç ayrı nokta ve üç ayrı
        kayma var. Bir ara buraya taretin tek kayması yazılıyordu; o
        ara katman kalktı ve `sunucu/baslar.py` `kaydir()` / `geri_al()`
        / `erisim()` yine doğrudan başın kendi `dx/dy`sini okuyor.
        """
        return _baslar_dogrula(self.ayar.get("baslar"),
                               self.ayar.get("sulama_basligi"))

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

        Tek kaynak `uc_secici.sure_ms`. Eski anahtarlar (`taret.sure_ms`,
        üst düzey `servo_sure_ms`) YÜKLEME sırasında buraya taşınıyor;
        her çağrıda üç anahtarı yoklamak, hangisinin geçerli olduğunu
        her seferinde yeniden sormak olurdu.
        """
        ham = (self.ayar.get("uc_secici") or {}).get("sure_ms")
        try:
            sure = int(ham or VARSAYILAN["uc_secici"]["sure_ms"])
        except (TypeError, ValueError):
            sure = int(VARSAYILAN["uc_secici"]["sure_ms"])
        return max(1, min(10000, sure))

    def home_anahtari(self) -> set[str]:
        """Anahtarına güvenilecek eksenlerin adları — {"x", "y", "z"}.

        Eski biçim (tek `true`/`false`) da okunuyor: `true` girilmişse
        X, Y ve Z sayılıyor, T hariç — bu makinede T'de anahtar yok ve
        onu da kapsamak her T home'unu reddettirirdi.
        """
        ham = self.ayar.get("home_anahtari")
        if ham is True:
            return {"x", "y", "z"}
        if not isinstance(ham, (list, tuple, set)):
            return set()
        return {str(a).strip().lower() for a in ham if str(a).strip()}

    def guvenli_t(self) -> float | None:
        """Tohum ucu "yukarıda" sayılma payı (mm); girilmemişse None."""
        try:
            g = float(self.ayar.get("guvenli_t"))
        except (TypeError, ValueError):
            return None
        return g if 0.0 <= g <= 50.0 else None

    def prox_baslar(self) -> list[str]:
        """[anahtar1, anahtar2, anahtar3] -> baş kimliği (ya da "")."""
        ham = self.ayar.get("prox_baslar")
        ham = list(ham) if isinstance(ham, (list, tuple)) else []
        return [(str(k) if str(k) in BASLAR else "")
                for k in (ham + ["", "", ""])[:3]]

    def hiz(self) -> float | None:
        """Genel hız (mm/s) — girilmemişse None, `ayar.json`daki geçerli."""
        return _hiz_dogrula(self.ayar.get("hiz"))

    def hiz_eksen(self) -> list[float | None]:
        """[X, Y, Z, T] hızları; her biri None olabilir ("genel hız")."""
        ham = self.ayar.get("hiz_eksen")
        ham = list(ham) if isinstance(ham, (list, tuple)) else []
        return [_hiz_dogrula(h) for h in (ham + [None] * 4)[:4]]

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
        # `t_asagi_mm` DE GİDİYOR. Sözlük üç alanla sınırlıydı ve sulama
        # çözümleyicisi başlığı buradan okuduğu için T derinliğini hiç
        # göremiyordu: nem ölçümünde uç iniyor, sulamada inmiyordu.
        # Sebebi "ayar girilmemiş" sanılıyordu, oysa ayar giriliydi —
        # taşıyıcı sözlük onu düşürüyordu.
        return {"dx": b["dx"], "dy": b["dy"], "z_min": b["z_min"],
                "derinlik_mm": b.get("derinlik_mm"),
                "t_asagi_mm": b.get("t_asagi_mm")}

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
