"""Ekim — tohum haznesinden alıp toprağa bırakma.

Akış
----

Bir bitki için makine şunu yapıyor ve her satır bir "parça", yani ayrı
bir dizi çalıştırması:

    uç tak            tohum alma ucu kafaya takılıyor (bir kez, başta)
  ┌ hazne↑           türüne uyan haznenin ÜSTÜNE gidiyor      → ONAY 1
  │ hazne↓           iniyor, hava pompası açılıyor
  │ taşı             bekliyor, kalkıyor, hedefin ÜSTÜNE       → ONAY 2
  │ ek               iniyor, pompa kapanıyor, tohum düşüyor, kalkıyor
  └ home             makine home'a dönüyor
    uç bırak         bütün bitkiler bitince (isteğe bağlı)

Döngü bitki başına baştan işliyor: al, ek, home. Arada karışmıyor,
çünkü bir sonraki parça ancak öncekinin bittiği ajanın durum paketinde
görülünce gönderiliyor.

Neden iki onay
--------------

İki sensör bağlı değil ve ikisi de SESSİZCE yanıltıyor:

  `lock_reg = 0`     servo komutu sessiz geçiyor, uç takılı SANILIYOR.
  `presence_reg = 0` vakumun tohumu tuttuğunu makine BİLEMİYOR.

Onay 1 birincisinin, onay 2 ikincisinin yerini alıyor. Kullanıcı
makinenin başında duruyor ve gözüyle doğruluyor. Onay açıkken kilit
şartı kalkıyor — sessizce değil, `uyari` listesinde ve olay günlüğünde.
Onay kapatılırsa şart geri geliyor: doğrulamayı ya sensör yapar ya
insan, ikisi de yoksa ekim başlamaz.

HAZNE TÜKENMİYOR
----------------

Bu dosyanın önceki hâli her gözde TEK tohum varmış gibi davranıyordu:
bir bitkiye bir göz atıyor, gözü tüketiyor, alınca "boş" işaretliyordu.
Gerçekte haznede yüzlerce tohum var; bir tane almakla bitmiyor ve
kullanıcı her ekimden sonra gözü elle "dolu" yapmak zorunda kalıyordu.

Artık hazne bir KAYNAK: türe göre bulunuyor, tüketilmiyor, aynı hazne
on bitkiye de hizmet ediyor. `dolu` alanı kalıyor ama yalnız kullanıcı
"bu hazne bitti" dediğinde kapanıyor — otomatik hiçbir şey onu
değiştirmiyor. Bu yüzden `goz` adımı da artık üretilmiyor.

Ne BURADA değil
---------------

Yasak bölgeler, yumuşak sınırlar ve Z kilidi AJANDA. Bu dosya onları
kopyalamıyor; sunucu diziyi başlatmadan önce `nokta_denetle` ile ajana
soruyor. Burada yalnız dikim alanı denetimi ve hazne/tür eşlemesi var —
ikisi de veri geçerliliği kararı ve ajan kopukken de işlemeli.

Sessizce yapılmayanlar
----------------------

1. **Kırpma yok.** Alan ya da sınır dışına düşen bir hedef sessizce
   sınıra çekilmiyor, sebebiyle reddediliyor. Yanlış yere düşmüş bir
   tohum, düşmemiş tohumdan kötü: haftalarca orada sanıyorsunuz.
2. **Tür tahmini yok.** Türü yazılmamış bir nokta için hazne
   seçilmiyor. Toprağa giren tohum geri alınamaz ve ne olduğu ancak
   çimlenince anlaşılır.
3. **Ulaşılamayan koordinat yok.** Makine sınırlarının dışındaki bir
   hazne ekim başlarken değil, koordinat GİRİLİRKEN söyleniyor
   (`hazne_denetle`; panel göz tablosunda kullanıyor).
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

import dikim

# Vakumun tohumu kavraması için haznede beklenen süre. Hava pompasının
# hattı boşaltması anlık değil; komuttan hemen sonra kalkmak tohumu
# haznede bırakır.
VAKUM_SANIYE = 1.0

# Pompa kapandıktan sonra tohumun düşmesi için beklenen süre. Vakum
# kesildiği anda tohum serbest kalıyor ama birkaç milimetre düşüyor;
# kafa hemen kalkarsa tohum uçla birlikte geri gidebiliyor.
DUSME_SANIYE = 0.5

# Tohum alma ucunun VARSAYILAN adı. Sabit değil: `ayar.uc_adi` ile
# değişiyor, çünkü başka bir uca geçince kod değişmemeli.
UC_ADI = "tool3"

# Hazne `z`si haznenin DİBİ, yani vakum ucunun ineceği yer. Tepsinin
# üstü değil. Bu makinede büyük Z yukarısı: Z'si daha büyük olan hazne
# daha SIĞ demek.


class EkimHatasi(Exception):
    """Ekim dizisi kurulamadı."""


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        s = float(deger)
    except (TypeError, ValueError):
        return varsayilan
    return s if s == s and abs(s) != float("inf") else varsayilan


# --------------------------------------------------------------------------- #
# Ekim ayarları — küçük bir JSON dosyası
#
# `kalibrasyon.py` ile aynı kalıp: atomik yazma, bozuk dosyada varsayılana
# dönme. Ayrı bir modül açmadık; bunlar ekimin ayarları ve ekimin yanında
# duruyorlar.
# --------------------------------------------------------------------------- #

AYAR_VARSAYILAN: dict[str, Any] = {
    "onay_iste": True,
    "vakum_sn": VAKUM_SANIYE,
    "dusme_sn": DUSME_SANIYE,
    # Tohum alma ucunun adı. Sabit yazılmıyor: başka bir uca geçilirse
    # kod değil bu satır değişsin.
    "uc_adi": UC_ADI,
    # Bütün bitkiler ekildikten sonra uç yuvasına bırakılsın mı.
    "bitince_birak": True,
}

AYAR_SINIR: dict[str, tuple[float, float]] = {
    "vakum_sn": (0.1, 10.0),
    "dusme_sn": (0.1, 10.0),
}

_AYAR_KILIT = threading.Lock()


def _ayar_yolu() -> str:
    ozel = os.environ.get("EKIM_AYAR_YOLU")
    if ozel:
        return ozel
    veri = os.environ.get("VERI_YOLU")
    if veri:
        return os.path.join(os.path.dirname(veri) or ".", "ekim_ayarlari.json")
    return os.path.join(os.path.dirname(__file__), "ekim_ayarlari.json")


def ayar_oku() -> dict[str, Any]:
    yol = _ayar_yolu()
    with _AYAR_KILIT:
        if not os.path.exists(yol):
            return dict(AYAR_VARSAYILAN)
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except (json.JSONDecodeError, OSError):
            # Bozuk dosya yüzünden ekim çalışmaz olmasın: varsayılana
            # dönüyoruz ve varsayılan zaten GÜVENLİ taraf (onay açık).
            return dict(AYAR_VARSAYILAN)
    if not isinstance(veri, dict):
        return dict(AYAR_VARSAYILAN)
    return ayar_duzelt({**AYAR_VARSAYILAN, **veri})


def ayar_duzelt(veri: dict[str, Any]) -> dict[str, Any]:
    """Değerleri sınırlara çeker. Kırpma SESSİZ değil: `ayar_yaz` kırpılmış
    hâli geri döndürüyor ve panel ekranda o değeri gösteriyor."""
    cikti = dict(AYAR_VARSAYILAN)
    cikti["onay_iste"] = bool(veri.get("onay_iste", True))
    cikti["bitince_birak"] = bool(veri.get("bitince_birak", True))
    uc = str(veri.get("uc_adi") or "").strip()[:40]
    cikti["uc_adi"] = uc or UC_ADI
    for ad, (alt, ust) in AYAR_SINIR.items():
        cikti[ad] = max(alt, min(ust, _sayi(veri.get(ad), AYAR_VARSAYILAN[ad])))
    return cikti


def ayar_yaz(veri: dict[str, Any]) -> dict[str, Any]:
    temiz = ayar_duzelt(veri)
    yol = _ayar_yolu()
    klasor = os.path.dirname(yol) or "."
    os.makedirs(klasor, exist_ok=True)
    with _AYAR_KILIT:
        gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                             prefix=".ekim-", suffix=".tmp",
                                             delete=False)
        try:
            json.dump(temiz, gecici, ensure_ascii=False, indent=1)
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
    return temiz


# --------------------------------------------------------------------------- #
# Hazneler
# --------------------------------------------------------------------------- #

def hazneler(gozler: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Koordinatı olan hazneler — dolu olsun olmasın."""
    return [g for g in (gozler or [])
            if isinstance(g, dict) and g.get("x") is not None]


def hazne_bul(tur: str, gozler: list[dict[str, Any]] | None
              ) -> tuple[dict[str, Any] | None, str]:
    """Türe uyan ilk DOLU hazne. -> (hazne, gerekçe)

    Hazne TÜKETİLMİYOR: aynı hazne seçimdeki bütün marullara hizmet
    ediyor. Eskiden her bitkiye ayrı bir göz atanıyordu ve gözler
    bitince ekim reddediliyordu — haznede yüzlerce tohum varken.

    Tür yazılmamış hazne KULLANILMIYOR. "Boş etiketi herhalde budur"
    varsayımı, yanlış tohumu toprağa gömmenin en kolay yolu ve yanlış
    olduğu ancak haftalar sonra anlaşılıyor.
    """
    s = str(tur or "").strip()
    if not s:
        return None, "türü yazılı değil"
    havuz = hazneler(gozler)
    if not havuz:
        return None, "tanımlı hazne yok"
    uyan = [g for g in havuz if str(g.get("tohum") or "").strip() == s]
    if not uyan:
        return None, "bu türe ayrılmış hazne yok"
    dolu = [g for g in uyan if g.get("dolu")]
    if not dolu:
        adlar = ", ".join(str(g.get("ad")) for g in uyan)
        return None, f"türün haznesi ({adlar}) boş işaretli"
    return dolu[0], ""


def hazne_denetle(hazne: dict[str, Any], sinirlar: dict[str, Any] | None,
                  guvenli_z: float | None = None) -> list[str]:
    """Bir hazne koordinatının SORUNLARI — koordinat girilirken.

    Bunu ekim başlarken söylemek geç: kullanıcı Y645'e bir hazne
    tanımlayıp günlerce farkında olmuyor, sonra ekim başlamayınca
    sebebini arıyor. Yatağın Y sınırı 630 ve makine oraya fiziksel
    olarak ulaşamıyor.

    `sinirlar` ajandan geliyor (`durum.sinirlar`). Yoksa boş liste —
    "sorun yok" değil, "bilinmiyor"; panel bunu ayrıca yazıyor.
    """
    sorun: list[str] = []
    s = sinirlar or {}
    for eksen in ("x", "y", "z"):
        deger = hazne.get(eksen)
        if deger is None:
            sorun.append(f"{eksen.upper()} boş")
            continue
        sinir = s.get(eksen) or {}
        alt, ust = sinir.get("min"), sinir.get("max")
        if alt is None or ust is None:
            continue
        d = _sayi(deger)
        if d < float(alt) - 0.5 or d > float(ust) + 0.5:
            sorun.append(
                f"{eksen.upper()}{d:.0f} makine sınırının dışında "
                f"({float(alt):.0f}–{float(ust):.0f}) — makine oraya ulaşamaz")
    if guvenli_z is not None and hazne.get("z") is not None:
        gz = _sayi(hazne.get("z"))
        if gz >= float(guvenli_z):
            sorun.append(
                f"Z{gz:.0f} güvenli yüksekliğin ({float(guvenli_z):.0f}) "
                "altında değil — makine hazneye inemez")
    return sorun


# --------------------------------------------------------------------------- #
# Parçalar
#
# Her parça ayrı bir dizi çalıştırması; arada sunucu bekliyor. Adımlar
# `ajan/dizi.py`nin BİLDİĞİ tiplerden: nokta, bekle, role, uc. Yeni adım
# tipi eklenmedi — yürütücü makinenin çalışan parçası.
#
# POMPAYI AÇAN ADIM YOK. `dizi._roleleri_kapat` bir dizinin AÇTIĞI
# röleyi dizi biterken kapatıyor (yarıda kesilen sulamanın hortumu açık
# bırakmaması için, ve orada doğru olan da bu). Pompa dizinin içinde
# açılsaydı, "al" parçası biter bitmez kapanır ve tohum daha ikinci onay
# sorulmadan düşerdi — ölçüldü. Dizinin DIŞINDAN `role` komutuyla açılan
# röle o listeye girmiyor ve parçalar arasında açık kalıyor. KAPATMA
# adımı dizinin içinde kalabiliyor: `role ... durum: false` her hâlükârda
# Arduino'ya gidiyor.
# --------------------------------------------------------------------------- #

#: Onay beklenen parçalar: parça bitince kullanıcıya soruluyor.
ONAY_SONRASI = {"hazne": "onay1", "tasi": "onay2"}

SORU = {
    # Soru metni kafadaki inanca göre değiştiği için sunucuda kuruluyor
    # (bkz. `main.EkimOturumu.goruntu`); burada yalnız yedeği duruyor.
    "onay_uc": "Kafada şu an ne var?",
    "onay1": "Vakum ucu takılı mı? Tohum alınsın mı?",
    "onay2": "Tohum ucun ucunda görünüyor mu? Ekilsin mi?",
}

GEREKCE = {
    "onay_uc": ("Uç değiştirme buradan başlıyor ve yazılım kafada ne "
                "olduğunu ÖLÇEMİYOR — kilit servosu ve varlık sensörü "
                "bağlı değil, yalnız kendisine en son söyleneni "
                "hatırlıyor. Kayıt yanlışsa makine elde olmayan bir ucun "
                "yuvasına iner. Yanlışsa aşağıdan düzeltin; hiçbir eksen "
                "hareket etmez."),
    "onay1": ("Kafa haznenin üstünde duruyor, henüz inmedi. Uç kilit "
              "servosu bağlı olmadığı için yazılım ucun takılı olduğunu "
              "doğrulayamıyor — bunu siz doğruluyorsunuz. Uç yoksa kafa "
              "haznenin içine iner."),
    "onay2": ("Kafa hedefin üstünde, vakum açık ve tohum ucta olmalı. Tohum "
              "sensörü (presence_reg) bağlı değil: vakumun tohumu gerçekten "
              "tuttuğunu makine BİLEMİYOR. Tohum yoksa makine yine de iner, "
              "pompayı kapatır ve 'ekildi' der — geriye boş bir çukur kalır."),
}


def parcalar_bir_tohum(hedef: dict[str, Any], hazne: dict[str, Any], *,
                       guvenli_z: float, ekim_z: float,
                       vakum_sn: float, dusme_sn: float) -> dict[str, Any]:
    """Tek bitkinin parçaları. Her adım MUTLAK koordinat taşıyor.

    İki nokta arasında HER ZAMAN güvenli Z'de gidiliyor; yalnız hazneye
    ve hedefe iniliyor. Ajanın hareket planı zaten Z'yi kaldırıp
    indiriyor ama adımı açıkça yazmak önizlemeyi dürüst yapıyor:
    ekranda okunan yol, makinenin gittiği yol.
    """
    hx, hy, hz = _sayi(hazne["x"]), _sayi(hazne["y"]), _sayi(hazne["z"])
    tx, ty = _sayi(hedef["x"]), _sayi(hedef["y"])
    ha = str(hazne.get("ad") or "hazne")
    ta = str(hedef.get("ad") or "hedef")
    return {
        # Haznenin ÜSTÜ. Burada durup soruyoruz; henüz inmedi.
        "hazne": [
            {"tip": "nokta", "ad": f"{ha}↑", "x": hx, "y": hy, "z": guvenli_z},
        ],
        # İniyor. Pompayı bundan SONRA sunucu açıyor — özgün sıra: önce
        # in, sonra pompa.
        "al": [
            {"tip": "nokta", "ad": ha, "x": hx, "y": hy, "z": hz},
        ],
        # Vakum tutsun diye bekliyor, kalkıyor, hedefin üstüne gidiyor.
        # Burada durup ikinci kez soruyoruz.
        "tasi": [
            {"tip": "bekle", "saniye": vakum_sn},
            {"tip": "nokta", "ad": f"{ha}↑", "x": hx, "y": hy, "z": guvenli_z},
            {"tip": "nokta", "ad": f"{ta}↑", "x": tx, "y": ty, "z": guvenli_z},
        ],
        # İniyor, pompa kapanıyor, tohum düşüyor, kalkıyor.
        "ek": [
            {"tip": "nokta", "ad": ta, "x": tx, "y": ty, "z": ekim_z},
            {"tip": "role", "ad": "hava_pompasi", "durum": False},
            {"tip": "bekle", "saniye": dusme_sn},
            {"tip": "nokta", "ad": f"{ta}↑", "x": tx, "y": ty, "z": guvenli_z},
        ],
    }


def uc_parcasi(uc_adi: str) -> list[dict[str, Any]]:
    """Tohum alma ucunu takan tek adım. `dizi.py` `uc` tipini biliyor."""
    return [{"tip": "uc", "ad": str(uc_adi or UC_ADI)}]


def uc_birak_parcasi() -> list[dict[str, Any]]:
    """Ucu yuvasına bırakan tek adım — `uc` adımında ad boş = bırak."""
    return [{"tip": "uc", "ad": ""}]


def iptal_parcasi(hazne: dict[str, Any], *, guvenli_z: float,
                  dusme_sn: float = DUSME_SANIYE) -> list[dict[str, Any]]:
    """İkinci onayda "tohumu hazneye geri koy" denirse çalışacak adımlar.

    Kafa ikinci onayda HEDEFİN üstünde ve pompa açık. Geri koymak
    hazneye dönüp inmek ve pompayı kapatmak demek: tohum geldiği yere
    düşüyor. Hazne zaten dolu sayıldığı için işaretlenecek bir şey yok —
    tükenmeyen bir kaynağa bir tohum geri koymak onu değiştirmiyor.
    """
    hx, hy, hz = _sayi(hazne.get("x")), _sayi(hazne.get("y")), _sayi(hazne.get("z"))
    ad = str(hazne.get("ad") or "hazne")
    return [
        {"tip": "nokta", "ad": f"{ad}↑", "x": hx, "y": hy, "z": float(guvenli_z)},
        {"tip": "nokta", "ad": ad, "x": hx, "y": hy, "z": hz},
        {"tip": "role", "ad": "hava_pompasi", "durum": False},
        {"tip": "bekle", "saniye": float(dusme_sn)},
        {"tip": "nokta", "ad": f"{ad}↑", "x": hx, "y": hy, "z": float(guvenli_z)},
    ]


# --------------------------------------------------------------------------- #
# Çözüm
# --------------------------------------------------------------------------- #

def coz(hedefler: list[dict[str, Any]], gozler: list[dict[str, Any]] | None, *,
        guvenli_z: float, genel_toprak_z: float = 0.0,
        dikim_alanlari: list[dict[str, Any]] | None = None,
        lock_reg: int = 0, uc_takili: str | None = None,
        vakum_sn: float = VAKUM_SANIYE, dusme_sn: float = DUSME_SANIYE,
        tur_adlari: dict[str, str] | None = None,
        sinirlar: dict[str, Any] | None = None,
        uc_adi: str = UC_ADI, bitince_birak: bool = True,
        onay: bool = False,
        ) -> dict[str, Any]:
    """Ekimi çözer: bitki başına parçalar + özet + ret sebepleri.

    `hedefler` her biri {"ad", "x", "y", "tur", "sow_depth_mm"} olan
    sözlükler; koordinat ve derinlik ÇAĞIRAN tarafından çözülmüş olarak
    geliyor (sunucu nokta deposunu ve tür zincirini zaten okuyor).

    `ret` boş değilse ekim HİÇ başlamamalı. Kısmi ekim, hangi bitkinin
    ekildiğini bilinmez yapardı ve toprağa giren tohum geri alınamaz.

    TÜRSÜZ NOKTA BUNUN İSTİSNASI — `atlanan`a giriyor, `ret`e değil.
    Sebep: bitkiler ve çıplak noktalar AYNI depoda duruyor, ayıran tek şey
    `tur` alanı. Kutu seçimi ikisini birden alıyor ve kullanıcı ekranda
    bitkiyi seçtiğini sanırken altındaki türsüz ızgara noktası da sessizce
    seçime giriyor. Tek bir türsüz nokta yüzünden altı bitkinin ekilmemesi,
    kullanıcının anlamadığı ve çözemediği bir ret demekti.

    Atlamak burada güvenli: türsüz nokta zaten EKİLECEK bir şey değil,
    ekilecek şeylerin listesinden çıkmasının hiçbir yan etkisi yok.
    Sessizce de olmuyor — kaç tanesinin atlandığı `atlanan`da yazıyor ve
    panel bunu ekim başlamadan söylüyor. Ekilecek hiçbir bitki KALMAZSA
    o zaman ret var: kullanıcı ekmek istemişti ve hiçbir şey ekilmeyecek.

    RET MESAJLARI KISA. Uzun cümleler panelde kesiliyordu ve kullanıcı
    sebebi ancak günlüğü açıp okuyunca görüyordu; sebebin kendisi kısa,
    ne yapılacağı ikinci cümlede.
    """
    guvenli_z = float(guvenli_z or 0.0)
    vakum_sn = max(0.1, min(10.0, _sayi(vakum_sn, VAKUM_SANIYE)))
    dusme_sn = max(0.1, min(10.0, _sayi(dusme_sn, DUSME_SANIYE)))
    adlar = tur_adlari or {}

    def _tur_ad(slug: str) -> str:
        """Mesajda görünecek tür adı. Katalogda yoksa slug'ın kendisi —
        uydurmuyoruz, kullanıcı elindeki değeri görsün."""
        s = str(slug or "").strip()
        return adlar.get(s, s)

    ret: list[str] = []
    uyari: list[str] = []

    # --- ön koşullar ------------------------------------------------------
    kilit_yok = int(lock_reg or 0) <= 0
    if kilit_yok and not onay:
        ret.append("Uç kilit servosu bağlı değil (lock_reg = 0). "
                   "Kilidi bağlayın ya da Ayarlar → Ekim'den onay adımını açın.")
    elif kilit_yok:
        uyari.append("Uç kilidi bağlı değil — takılı olduğunu siz "
                     "onaylayacaksınız.")

    if not hedefler:
        ret.append("Seçim boş — ekilecek nokta yok.")

    havuz = hazneler(gozler)
    if not havuz:
        ret.append("Tanımlı tohum haznesi yok. "
                   "Ayarlar → Uç değiştirme → Tohumluk hazneleri.")

    # Hazne koordinatları ULAŞILABİLİR Mİ. Bunu ekim başlarken bulmak
    # geç; panel koordinat girilirken de aynı denetimi yapıyor
    # (`hazne_denetle`), burası son ağ.
    #
    # KULLANILMAYAN HAZNE EKİMİ DURDURMUYOR. Sınır dışı bir fesleğen
    # haznesi yüzünden marul ekiminin başlamaması, kullanıcının
    # anlamadığı bir ret daha demek olurdu; sorunu söylüyoruz ama yalnız
    # o hazneye GERÇEKTEN gidilecekse duruyoruz.
    hazne_sorunu: dict[str, list[str]] = {}
    for h in havuz:
        sorunlar = hazne_denetle(h, sinirlar, guvenli_z)
        if sorunlar:
            hazne_sorunu[str(h.get("ad"))] = sorunlar
            uyari.append(f"'{h.get('ad')}' haznesi: {'; '.join(sorunlar)}.")

    # --- bitki başına -----------------------------------------------------
    plan: list[dict[str, Any]] = []
    ozet: list[dict[str, Any]] = []
    eksik_tur: list[str] = []
    haznesiz: dict[str, list[str]] = {}

    for hedef in hedefler:
        ad = str(hedef.get("ad") or "hedef")
        tur = str(hedef.get("tur") or "").strip()
        tx, ty = _sayi(hedef.get("x")), _sayi(hedef.get("y"))

        if not tur:
            # TEK SATIRDA TOPLUYORUZ. On noktanın onunda da aynı sebep
            # varsa on ayrı satır yazmak mesajı okunmaz yapıyordu.
            eksik_tur.append(ad)
            continue

        hazne, gerekce = hazne_bul(tur, gozler)
        if hazne is None:
            haznesiz.setdefault(
                f"{_tur_ad(tur)}: {gerekce}. "
                "Hazne tablosunda o türe bir hazne ayırın.", []).append(ad)
            continue
        # Gidilecek hazne ulaşılamıyorsa BU bitki ekilemez ve sebebi
        # haznenin kendisi. Öğüt de ona göre: yeni bir hazne ayırmak
        # değil, o haznenin koordinatını düzeltmek gerekiyor.
        sorun = hazne_sorunu.get(str(hazne.get("ad")))
        if sorun:
            haznesiz.setdefault(
                f"'{hazne.get('ad')}' haznesine ulaşılamıyor — {sorun[0]}. "
                "Hazne koordinatını düzeltin.", []).append(ad)
            continue

        # DİKİM ALANI. Kırpma yok: alan dışına düşen hedef reddediliyor.
        kabul, alan_gerekce, alan = dikim.nokta_kabul(tx, ty, dikim_alanlari)
        if not kabul:
            ret.append(f"{ad}: {alan_gerekce}")
            continue

        derinlik = max(0.0, _sayi(hedef.get("sow_depth_mm"), 0.0))
        yuzey = dikim.toprak_yuzeyi(tx, ty, genel_toprak_z, dikim_alanlari)
        ekim_z = dikim.ekim_z(tx, ty, genel_toprak_z, derinlik, dikim_alanlari)

        # Z TUTARLILIĞI. Tohumun bırakılacağı yer güvenli Z'nin ÜSTÜNDE
        # kalıyorsa bir ayar yanlış. Sessizce kırpmak, tohumu havada
        # bırakıp "ekildi" demek olurdu.
        if ekim_z >= guvenli_z:
            ret.append(f"{ad}: ekim Z{ekim_z:.0f}, güvenli Z{guvenli_z:.0f} "
                       f"altında değil (yüzey Z{yuzey:.0f}, derinlik "
                       f"{derinlik:.0f} mm).")
            continue

        plan.append(parcalar_bir_tohum(
            hedef, hazne, guvenli_z=guvenli_z, ekim_z=ekim_z,
            vakum_sn=vakum_sn, dusme_sn=dusme_sn))
        ozet.append({
            "ad": ad, "x": tx, "y": ty, "z": ekim_z,
            "tur": tur, "tur_ad": _tur_ad(tur),
            "hazne": hazne["ad"], "hazne_x": _sayi(hazne.get("x")),
            "hazne_y": _sayi(hazne.get("y")), "hazne_z": _sayi(hazne.get("z")),
            "yuzey_z": yuzey, "derinlik_mm": derinlik,
            "alan": (alan or {}).get("ad") or "",
        })

    # TÜRSÜZ NOKTALAR ATLANIYOR, ekimi durdurmuyor. Bunlar bitki değil:
    # ızgara/referans noktaları. Ekilecek bir şey olmadıkları için
    # listeden çıkmalarının bir bedeli yok — bedeli olan, tek bir tanesi
    # yüzünden hiçbir şeyin ekilememesiydi.
    if eksik_tur:
        uyari.append(f"{len(eksik_tur)} türsüz nokta atlanacak "
                     f"({_liste(eksik_tur)}) — bunlar bitki değil, "
                     "ızgara/referans noktası.")
    for sebep, kimler in haznesiz.items():
        ret.append(f"{_liste(kimler)}: {sebep}")

    # Ekilecek HİÇBİR bitki kalmadıysa ret: kullanıcı ekmek istemişti.
    if hedefler and not ozet and not ret:
        ret.append(
            f"Seçimde tür yazılı bitki yok — {len(eksik_tur)} noktanın "
            "hiçbirinde tür yazmıyor. Bunlar ızgara/referans noktası; "
            "bitkileri seçin ya da noktalara tür verin.")

    return {
        "plan": plan, "ozet": ozet, "ret": ret, "uyari": uyari,
        # ATLANAN: seçimde olup ekilmeyecekler ve sebebi. Panel "6 bitki
        # ekilecek, 6 türsüz nokta atlanacak" diyebilsin diye ayrı duruyor;
        # uyarı metnine gömülü olsaydı sayıyı ayrıştırmak gerekirdi.
        "atlanan": [{"ad": a, "sebep": "türsüz"} for a in eksik_tur],
        "atlanan_sayisi": len(eksik_tur),
        # Ön kontrol (yasak bölge / yumuşak sınır) için düz adım listesi.
        # Parçalarla AYNI kaynaktan: ikisi ayrışamaz.
        "adimlar": [a for p in plan for k in ("hazne", "al", "tasi", "ek")
                    for a in p[k]],
        "onay": bool(onay),
        "kilit_yok": kilit_yok,
        "tohum_sayisi": len(ozet),
        "kullanilan_hazneler": sorted({o["hazne"] for o in ozet}),
        "uc_adi": str(uc_adi or UC_ADI),
        "uc_takili": uc_takili or "",
        "bitince_birak": bool(bitince_birak),
        "guvenli_z": guvenli_z,
        "vakum_sn": vakum_sn,
        "dusme_sn": dusme_sn,
    }


def _liste(adlar: list[str], azami: int = 4) -> str:
    """'a, b, c ve 3 tane daha' — mesaj uzayıp kesilmesin."""
    if len(adlar) <= azami:
        return ", ".join(adlar)
    return f"{', '.join(adlar[:azami])} ve {len(adlar) - azami} tane daha"
