"""Ekim dizisi — tohumluk gözünden alıp toprağa bırakma.

Mekanizma
---------
Uç alınır, tohumluk gözüne gidilir, hava pompası (D8) açılır ve tohum
vakumla tutulur, hedef koordinata taşınır, toprağa inilir, pompa
kapatılır, tohum düşer.

Sulama ile aynı kalıp
---------------------
Bu dosya `sulama.py` ile aynı işi yapıyor: SAF bir fonksiyon, mutlak
koordinatlı adım listesi üretiyor. Ajan hiçbir şey türetmiyor, yalnız
gidilecek noktayı görüyor. Sebep de aynı: panelin önizlemede gösterdiği
sayı ile robotun gittiği sayı aynı olsun.

Ne BURADA değil
---------------
Yasak bölgeler, yumuşak sınırlar ve Z kilidi AJANDA. Bu dosya onları
kopyalamıyor; sunucu diziyi başlatmadan önce `nokta_denetle` ile ajana
soruyor (sulamadaki `_sulama_on_kontrol` ile aynı yol). Burada yalnız
dikim alanı denetimi var, çünkü o bir veri geçerliliği kararı ve ajan
kopukken de işlemeli.

Üç şey SESSİZCE yapılmıyor
--------------------------
1. **Kırpma yok.** Hedefi dikim alanının ya da gözün dışına düşen bir
   ekim sessizce sınıra çekilmiyor; sebebiyle birlikte REDDEDİLİYOR.
   Yanlış yere düşmüş bir tohum, düşmemiş tohumdan kötü: haftalarca
   orada olduğunu sanıyorsunuz.
2. **Yanlış tohum yok.** Gözde ne olduğu yazılıysa ve seçilen bitkinin
   türüyle uyuşmuyorsa dizi başlamıyor. Toprağa giren tohum geri
   alınamaz ve ne olduğu ancak çimlenince anlaşılır.
3. **Kilitsiz başlama yok.** `lock_reg` 0 iken servo komutu sessiz
   geçiyor (bkz. `uclar._servo`); yani uç takılı SANILIP dizi
   yürüyebilir. Vakum ucunu taşımayan bir kafa, gözün içine iner ve
   tepsiyi kırar.

   TEK İSTİSNASI İNSAN. Onay adımı açıkken kullanıcı makinenin başında
   duruyor ve "uç takılı" diye gözüyle doğruluyor; eksik sensörün yerini
   insan alıyor ve kilit şartı kalkıyor (bkz. `coz(onay=...)`). Onay
   kapatılırsa şart geri geliyor: ya sensör doğrular ya insan, ikisi de
   yoksa ekim başlamaz.

Onay adımları — dizi neden PARÇALARA bölünüyor
----------------------------------------------

Kullanıcı iki yerde gözüyle doğruluyor: gözün üstünde ("uç takılı mı?")
ve tohumla kalkınca ("tohum ucta görünüyor mu?"). İkincisi asıl önemli
olan, çünkü `presence_reg` bağlı değil: vakumun tohumu gerçekten
tuttuğunu makine BİLEMİYOR. Taşırken düşerse yazılım fark etmez, hedefe
varır, pompayı kapatır ve "ekildi" der — geriye boş bir çukur kalır.

Bunu yapmanın yolu diziye yeni bir adım tipi eklemek DEĞİL: `dizi.py`
makinenin çalışan yürütücüsü. Onun yerine aynı 11 adım parçalara
bölünüyor ve her parça MEVCUT yürütücüyle koşuyor; arada sunucu
bekliyor. Yürütücü hiç değişmiyor.

POMPAYI SUNUCU AÇIYOR, DİZİ DEĞİL. Bunu ölçtükten sonra öğrendik:
`dizi._roleleri_kapat` bir dizinin AÇTIĞI röleleri dizi biterken
kapatıyor (yarıda kesilen sulamanın hortumu açık bırakmaması için, ve
orada doğru olan da bu). Ama pompayı açan parça bittiğinde onay
beklerken pompa kapanırdı ve tohum daha ikinci onay sorulmadan düşerdi.
Dizinin DIŞINDAN, `role` komutuyla açılan röle bu listeye girmiyor ve
parçalar arasında açık kalıyor. Kapatma adımı dizinin içinde kalabiliyor:
`role ... durum: false` her hâlükârda Arduino'ya gidiyor.

Bunun bedeli var ve saklamıyoruz: dizinin açtığı röleyi kapatan güvenlik
ağı artık bu pompayı kapsamıyor. Yerini sunucu alıyor — oturum hatayla
biterse ya da iptal edilirse pompayı açıkça kapatıyor (`main.py`,
`_ekim_pompa_kapat`).
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Any

import dikim

# Vakumun tohumu kavraması için gözde beklenen süre. Hava pompasının
# hattı boşaltması anlık değil; komuttan hemen sonra kalkmak tohumu
# gözde bırakır.
VAKUM_SANIYE = 1.0

# Pompa kapandıktan sonra tohumun düşmesi için beklenen süre. Vakum
# kesildiği anda tohum serbest kalıyor ama birkaç milimetre düşüyor;
# kafa hemen kalkarsa tohum uçla birlikte geri gidebiliyor.
DUSME_SANIYE = 0.5

# Bir gözü tohumun düşeceği yerle karıştırmamak için: gözün `z`si gözün
# DİBİ, yani vakum ucunun ineceği yer. Tepsinin üstü değil.

# Tek dizide en fazla bu kadar tohum. `programlar.AZAMI_ADIM` (200) ve
# tohum başına 11 adım, sınırı zaten 18'e çekiyor; buradaki sayı yalnız
# hata mesajını anlaşılır tutmak için var.
ADIM_BASINA_TOHUM = 11


class EkimHatasi(Exception):
    """Ekim dizisi kurulamadı."""


# --------------------------------------------------------------------------- #
# Ekim ayarları — küçük bir JSON dosyası
#
# `kalibrasyon.py` ile aynı kalıp: atomik yazma, bozuk dosyada varsayılana
# dönme. Ayrı bir modül açmadık; bunlar ekimin ayarları ve ekimin yanında
# duruyorlar.
#
# `onay_iste` VARSAYILAN OLARAK AÇIK. Kapalıyken kilit şartı geri geliyor
# ve `lock_reg = 0` olan bir kurulumda ekim hiç başlamıyor — yani kapatmak
# ekimi kolaylaştırmıyor, zorlaştırıyor. Doğru olan da bu: doğrulamayı ya
# sensör yapar ya insan.
# --------------------------------------------------------------------------- #

AYAR_VARSAYILAN: dict[str, Any] = {
    "onay_iste": True,
    "vakum_sn": VAKUM_SANIYE,
    "dusme_sn": DUSME_SANIYE,
}

# Süre sınırları `coz`dakiyle aynı: panelden gelen sayıya körlemesine
# güvenilmiyor. 0.1 sn altı pompanın hattı boşaltmasına yetmiyor, 10 sn
# üstü kullanıcının unuttuğu bir sayı.
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


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        return float(deger)
    except (TypeError, ValueError):
        return varsayilan


def dolu_gozler(gozler: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Koordinatı olan ve içinde tohum kalan gözler, listedeki sırayla."""
    return [g for g in (gozler or [])
            if isinstance(g, dict) and g.get("x") is not None and g.get("dolu")]


def goz_ata(hedefler: list[dict[str, Any]], gozler: list[dict[str, Any]] | None,
            tur_adlari: dict[str, str] | None = None
            ) -> tuple[list[tuple[dict[str, Any], dict[str, Any]]], list[str], list[str]]:
    """Her hedefe bir göz eşler. -> (eşleşmeler, ret, uyarı)

    Eşleşme SLUG üzerinden yapılıyor (gözdeki `tohum` da, bitkideki `tur`
    de slug). `tur_adlari` yalnız MESAJ metni için: kullanıcı panelde
    "Marul" görüyor, ret sebebinde "marul" okumak kafa karıştırıyor.

    Eşleme sırası:

      1. Gözde YAZAN tohum bitkinin türüyle aynıysa önce o göz.
      2. Gözde ne olduğu yazmıyorsa (boş `tohum` alanı) kullanılır ama
         uyarı verilir — kullanıcı tepsiye ne koyduğunu yazmamış.
      3. Gözde BAŞKA bir tür yazıyorsa o göz KULLANILMAZ. Yeterli göz
         kalmadıysa dizi hiç başlamaz.

    Üçüncü kural bu dosyadaki en önemli karar. Yanlış tohumu toprağa
    gömmek geri alınamaz ve haftalar sonra, yanlış bitki çıkınca
    anlaşılır.
    """
    havuz = dolu_gozler(gozler)
    kullanilan: set[str] = set()
    eslesme: list[tuple[dict[str, Any], dict[str, Any]]] = []
    ret: list[str] = []
    uyari: list[str] = []
    adlar = tur_adlari or {}

    def _ad(slug: str) -> str:
        """Mesajda görünecek tür adı. Katalogda yoksa slug'ın kendisi —
        uydurmuyoruz, kullanıcı elindeki değerin ne olduğunu görsün."""
        s_ = str(slug or "").strip()
        return adlar.get(s_, s_)

    for hedef in hedefler:
        tur = str(hedef.get("tur") or "").strip()
        kalan = [g for g in havuz if g["ad"] not in kullanilan]
        if not kalan:
            ret.append(
                f"{hedef.get('ad')}: dolu tohumluk gözü kalmadı "
                f"({len(havuz)} dolu göz, {len(hedefler)} bitki seçildi). "
                "Tohumluğu doldurup panelden 'dolu' işaretleyin ya da daha "
                "az bitki seçin.")
            continue

        uyan = [g for g in kalan if str(g.get("tohum") or "").strip() == tur and tur]
        bos_etiket = [g for g in kalan if not str(g.get("tohum") or "").strip()]

        if uyan:
            secilen = uyan[0]
        elif bos_etiket:
            secilen = bos_etiket[0]
            uyari.append(
                f"{hedef.get('ad')}: '{secilen['ad']}' gözünde ne olduğu yazılı "
                f"değil, {_ad(tur) or 'tür belirsiz'} olduğu varsayıldı. Göz "
                "tablosundaki 'Tohum' sütununu doldurun.")
        else:
            icerik = ", ".join(
                f"{g['ad']}={_ad(g.get('tohum')) or '?'}" for g in kalan[:4])
            # Sayıyı da yazıyoruz: çoğu zaman asıl sorun "gözde yanlış
            # tohum" değil, "yeterli uygun göz yok". Sebebi sayıyla
            # görmeden kullanıcı göz etiketlerini kurcalamaya başlıyor.
            ret.append(
                f"{hedef.get('ad')}: türü {_ad(tur) or 'belirsiz'} ama kalan "
                f"{len(kalan)} dolu gözde başka tohum var ({icerik}). "
                f"{len(hedefler)} bitki seçildi, {len(eslesme)} tanesine göz "
                "bulundu. Yanlış tohum ekilmesin diye dizi başlatılmadı — göz "
                "tablosundaki 'Tohum' sütununu düzeltin, eşleşen bir gözü "
                "doldurun ya da daha az bitki seçin.")
            continue

        kullanilan.add(secilen["ad"])
        eslesme.append((hedef, secilen))

    return eslesme, ret, uyari


def _adimlar_bir_tohum(hedef: dict[str, Any], goz: dict[str, Any], *,
                       guvenli_z: float, ekim_z: float,
                       vakum_sn: float, dusme_sn: float) -> list[dict[str, Any]]:
    """Tek tohumun 11 adımı. Her adım MUTLAK koordinat taşıyor.

    İki nokta arasında HER ZAMAN güvenli Z'de gidiliyor; yalnız hedefte
    iniliyor. Ajanın hareket planı zaten Z'yi kaldırıp indiriyor ama
    adımı açıkça yazmak önizlemeyi dürüst yapıyor: ekranda okunan yol,
    makinenin gittiği yol.
    """
    gx, gy, gz = float(goz["x"]), float(goz["y"]), float(goz["z"])
    hx, hy = float(hedef["x"]), float(hedef["y"])
    ad = str(hedef.get("ad") or "hedef")
    return [
        {"tip": "nokta", "ad": f"{goz['ad']}↑", "x": gx, "y": gy, "z": guvenli_z},
        {"tip": "nokta", "ad": f"{goz['ad']}", "x": gx, "y": gy, "z": gz},
        {"tip": "role", "ad": "hava_pompasi", "durum": True},
        {"tip": "bekle", "saniye": vakum_sn},
        # Göz İŞTE BURADA boşalıyor. Dizinin sonunda değil: burada
        # kesilirse tohum zaten gözden çıkmış olur ve gözü dolu bırakmak
        # bir sonraki ekimi boş göze indirirdi.
        {"tip": "goz", "ad": goz["ad"], "dolu": False},
        {"tip": "nokta", "ad": f"{goz['ad']}↑", "x": gx, "y": gy, "z": guvenli_z},
        {"tip": "nokta", "ad": f"{ad}↑", "x": hx, "y": hy, "z": guvenli_z},
        {"tip": "nokta", "ad": ad, "x": hx, "y": hy, "z": ekim_z},
        {"tip": "role", "ad": "hava_pompasi", "durum": False},
        {"tip": "bekle", "saniye": dusme_sn},
        {"tip": "nokta", "ad": f"{ad}↑", "x": hx, "y": hy, "z": guvenli_z},
    ]


# --------------------------------------------------------------------------- #
# Onay noktalarına göre parçalama
#
# 11 adım DEĞİŞMİYOR; olduğu gibi bölünüyor. Kesme yerleri:
#
#   0        göz↑            parça A   → [ONAY 1: uç takılı mı?]
#   1        göz (in)        parça B1
#   2        pompa AÇ        ── diziden çıkarılıyor, sunucu gönderiyor ──
#   3,4,5    bekle/göz/kalk  parça B2  → [ONAY 2: tohum ucta mı?]
#   6..10    taşı/in/kapat   parça C
#
# B1 ile B2'nin arasında kullanıcı YOK: sunucu pompayı açıp hemen devam
# ediyor. Bölünmesinin tek sebebi pompanın diziden değil sunucudan
# açılması gerekmesi (bkz. modül başlığı). Adımların SIRASI korunuyor:
# önce iniliyor, sonra pompa açılıyor — özgün dizideki gibi.
# --------------------------------------------------------------------------- #

#: `_adimlar_bir_tohum` çıktısındaki pompa-aç adımının indeksi.
POMPA_AC_INDEKS = 2

#: Parça adı -> (başlangıç, bitiş) dilimi. Bitiş dışlamalı.
PARCA_DILIM: dict[str, tuple[int, int]] = {
    "a": (0, 1),
    "b1": (1, 2),
    "b2": (3, 6),
    "c": (6, ADIM_BASINA_TOHUM),
}

#: Onay beklenen parçalar: parça bitince kullanıcıya sorulacak.
PARCA_SIRASI = ("a", "b1", "b2", "c")
ONAY_SONRASI = {"a": "onay1", "b2": "onay2"}

SORU = {
    "onay1": "Vakum ucu takılı mı? Tohum alınsın mı?",
    "onay2": "Tohum ucun ucunda görünüyor mu? Hedefe taşınıp ekilsin mi?",
}

GEREKCE = {
    "onay1": ("Kafa gözün üstünde duruyor, henüz inmedi. Uç kilit servosu "
              "bağlı olmadığı için yazılım ucun takılı olduğunu "
              "doğrulayamıyor — bunu siz doğruluyorsunuz. Uç yoksa kafa "
              "gözün içine iner ve tepsiyi kırar."),
    "onay2": ("Vakum açık ve tohum ucta olmalı. Tohum sensörü (presence_reg) "
              "bağlı değil: vakumun tohumu gerçekten tuttuğunu makine "
              "BİLEMİYOR. Tohum yoksa makine yine de hedefe gider, pompayı "
              "kapatır ve 'ekildi' der — geriye boş bir çukur kalır."),
}


def parcala(adimlar: list[dict[str, Any]]) -> dict[str, Any]:
    """Tek tohumun 11 adımını onay noktalarından böler.

    -> {"a": [...], "b1": [...], "b2": [...], "c": [...], "pompa_ac": {...}}

    ŞEKLİ DOĞRULUYOR, varsaymıyor. Bir gün `_adimlar_bir_tohum` değişirse
    bu fonksiyon sessizce yanlış yerden bölüp pompayı yanlış anda açardı;
    o hata makinede tohum düşerek görünürdü, burada `EkimHatasi` olarak
    görünüyor.
    """
    if len(adimlar) != ADIM_BASINA_TOHUM:
        raise EkimHatasi(
            f"Ekim adımları {len(adimlar)} tane, beklenen {ADIM_BASINA_TOHUM}. "
            "Adım listesi değişmiş; onay parçalaması güncellenmeli "
            "(ekim.parcala).")
    pompa = adimlar[POMPA_AC_INDEKS]
    if not (pompa.get("tip") == "role" and pompa.get("ad") == "hava_pompasi"
            and pompa.get("durum") is True):
        raise EkimHatasi(
            f"{POMPA_AC_INDEKS}. adımda 'hava_pompasi aç' bekleniyordu, "
            f"{pompa!r} bulundu. Adım sırası değişmiş; onay parçalaması "
            "güncellenmeli (ekim.parcala).")
    cikti: dict[str, Any] = {"pompa_ac": pompa}
    for ad, (bas, son) in PARCA_DILIM.items():
        cikti[ad] = [dict(a) for a in adimlar[bas:son]]
    return cikti


def iptal_parcasi(goz: dict[str, Any], *, guvenli_z: float,
                  dusme_sn: float = DUSME_SANIYE) -> list[dict[str, Any]]:
    """İkinci onayda "tohumu gözüne geri koy" denirse çalışacak adımlar.

    Kafa ikinci onayda gözün ÜSTÜNDE ve pompa açık duruyor. Geri koymak
    inip pompayı kapatmak demek: tohum kendi gözüne düşüyor ve göz
    yeniden DOLU işaretleniyor.

    `role ... durum: false` dizinin içinde kalabiliyor — kapatma her
    hâlükârda Arduino'ya gidiyor; diziden çıkarılması gereken yalnız
    AÇMA adımıydı.
    """
    gx, gy, gz = _sayi(goz.get("x")), _sayi(goz.get("y")), _sayi(goz.get("z"))
    ad = str(goz.get("ad") or "göz")
    return [
        {"tip": "nokta", "ad": f"{ad}↑", "x": gx, "y": gy, "z": float(guvenli_z)},
        {"tip": "nokta", "ad": ad, "x": gx, "y": gy, "z": gz},
        {"tip": "role", "ad": "hava_pompasi", "durum": False},
        {"tip": "bekle", "saniye": float(dusme_sn)},
        # Göz yeniden DOLU: tohum içine geri düştü. B2'de boş
        # işaretlenmişti; öyle bırakmak tepsiyi olduğundan boş gösterirdi.
        {"tip": "goz", "ad": ad, "dolu": True, "tohum": goz.get("tohum")},
        {"tip": "nokta", "ad": f"{ad}↑", "x": gx, "y": gy, "z": float(guvenli_z)},
    ]


def coz(hedefler: list[dict[str, Any]], gozler: list[dict[str, Any]] | None, *,
        guvenli_z: float, genel_toprak_z: float = 0.0,
        dikim_alanlari: list[dict[str, Any]] | None = None,
        lock_reg: int = 0, uc_takili: str | None = None,
        vakum_sn: float = VAKUM_SANIYE, dusme_sn: float = DUSME_SANIYE,
        tur_adlari: dict[str, str] | None = None,
        onay: bool = False,
        ) -> dict[str, Any]:
    """Ekim dizisini çözer: mutlak koordinatlı adımlar + özet + ret sebepleri.

    `hedefler` her biri {"ad", "x", "y", "tur", "sow_depth_mm"} olan
    sözlükler; koordinat ve derinlik ÇAĞIRAN tarafından çözülmüş olarak
    geliyor (sunucu nokta deposunu ve tür zincirini zaten okuyor).

    `ret` boş değilse dizi HİÇ başlatılmamalı. Kısmi ekim, hangi bitkinin
    ekildiğini bilinmez yapardı — sulamadaki kararla aynı.
    """
    guvenli_z = float(guvenli_z or 0.0)
    vakum_sn = max(0.1, min(10.0, float(vakum_sn or VAKUM_SANIYE)))
    dusme_sn = max(0.1, min(10.0, float(dusme_sn or DUSME_SANIYE)))

    ret: list[str] = []
    uyari: list[str] = []

    # --- ön koşullar ------------------------------------------------------
    # KİLİT SERVOSU. `lock_reg` 0 iken servo komutu sessizce geçiyor;
    # kafa ucu gerçekten kilitlemiyor. Vakum ucu takılı sanılıp dizi
    # yürürse kafa gözün içine dalıyor.
    kilit_yok = int(lock_reg or 0) <= 0
    if kilit_yok and not onay:
        ret.append(
            "Uç kilit servosu bağlı değil (uclar.json → lock_reg = 0). Kilit "
            "bağlanmadan ekim dizisi başlatılamaz: servo komutu sessiz geçtiği "
            "için uç takılı sanılır ve kafa vakum ucu olmadan gözün içine iner. "
            "Kilidi bağlayın ya da Ayarlar → Ekim'den 'Onay iste'yi açın; onay "
            "açıkken kafa gözün üstünde durup size soruyor.")
    elif kilit_yok:
        # ŞART KALKTI, SESSİZCE DEĞİL. Bu bir güvenlik denetiminin insan
        # onayıyla değiştirilmesi; uyarı listesinde duruyor ve sunucu
        # ayrıca olay günlüğüne yazıyor.
        uyari.append(
            "Uç kilit servosu bağlı değil (lock_reg = 0) — kilit şartı SİZİN "
            "onayınızla kaldırıldı. Yazılım ucun takılı olduğunu "
            "doğrulayamıyor; kafa gözün üstünde duracak ve size soracak. "
            "Uç takılı değilken onaylarsanız kafa gözün içine iner.")

    havuz = dolu_gozler(gozler)
    if not (gozler or []):
        ret.append("Tanımlı tohumluk gözü yok — Ayarlar → Uç değiştirme → "
                   "Tohumluk gözleri bölümünden gözleri girin.")
    elif not havuz:
        adlar = ", ".join(str(g.get("ad")) for g in (gozler or [])[:8])
        ret.append(f"Bütün tohumluk gözleri boş ({adlar}). Tepsiyi doldurup "
                   "göz tablosunda 'dolu' işaretleyin.")

    if not hedefler:
        ret.append("Seçim boş — ekilecek nokta yok.")

    # --- göz eşlemesi -----------------------------------------------------
    eslesme, esl_ret, esl_uyari = goz_ata(hedefler, gozler, tur_adlari)
    ret.extend(esl_ret)
    uyari.extend(esl_uyari)

    # --- adımlar ----------------------------------------------------------
    adimlar: list[dict[str, Any]] = []
    parca: list[dict[str, Any]] = []
    ozet: list[dict[str, Any]] = []
    for hedef, goz in eslesme:
        hx, hy = _sayi(hedef.get("x")), _sayi(hedef.get("y"))
        ad = str(hedef.get("ad") or "hedef")

        # DİKİM ALANI. Kırpma yok: alan dışına düşen hedef reddediliyor.
        kabul, gerekce, alan = dikim.nokta_kabul(hx, hy, dikim_alanlari)
        if not kabul:
            ret.append(f"{ad}: {gerekce}")
            continue

        derinlik = max(0.0, _sayi(hedef.get("sow_depth_mm"), 0.0))
        yuzey = dikim.toprak_yuzeyi(hx, hy, genel_toprak_z, dikim_alanlari)
        ekim_z = dikim.ekim_z(hx, hy, genel_toprak_z, derinlik, dikim_alanlari)

        # Z TUTARLILIĞI. Tohumun bırakılacağı yer güvenli Z'nin ÜSTÜNDE
        # kalıyorsa bir ayar yanlış (derinlik eksi, yüzey yanlış girilmiş
        # ya da güvenli Z toprağın altında). Sessizce kırpmak, tohumu
        # havada bırakıp "ekildi" demek olurdu.
        if ekim_z >= guvenli_z:
            ret.append(
                f"{ad}: ekim Z'si ({ekim_z:.0f}) güvenli Z'nin ({guvenli_z:.0f}) "
                f"altında değil — yüzey Z{yuzey:.0f}, derinlik {derinlik:.0f} mm. "
                "Toprak yüzeyini (dikim alanı) ya da güvenli Z'yi düzeltin.")
            continue

        gz = _sayi(goz.get("z"))
        if gz >= guvenli_z:
            ret.append(
                f"'{goz['ad']}' gözünün Z'si ({gz:.0f}) güvenli Z'nin "
                f"({guvenli_z:.0f}) altında değil. Göz koordinatını ya da "
                "güvenli Z'yi düzeltin — makine göze inemez.")
            continue

        bir_tohum = _adimlar_bir_tohum(
            hedef, goz, guvenli_z=guvenli_z, ekim_z=ekim_z,
            vakum_sn=vakum_sn, dusme_sn=dusme_sn)
        adimlar.extend(bir_tohum)
        # Parçalar AYNI listeden türüyor: onaylı ve onaysız yol aynı
        # adımları çalıştırıyor, biri diğerinden ayrışamıyor.
        parca.append(parcala(bir_tohum))
        ozet.append({
            "ad": ad, "x": hx, "y": hy, "z": ekim_z,
            "tur": hedef.get("tur") or "",
            "goz": goz["ad"], "goz_x": _sayi(goz.get("x")),
            "goz_y": _sayi(goz.get("y")), "goz_z": gz,
            "goz_tohum": goz.get("tohum") or "",
            "yuzey_z": yuzey, "derinlik_mm": derinlik,
            "alan": (alan or {}).get("ad") or "",
        })

    return {
        "adimlar": adimlar, "ozet": ozet, "ret": ret, "uyari": uyari,
        # Tohum başına parçalar. `adimlar` ile AYNI kaynaktan: onaysız yol
        # `adimlar`ı tek seferde çalıştırıyor, onaylı yol aynı adımları
        # parça parça. Ön kontrol ikisinde de `adimlar` üzerinden.
        "parca": parca,
        "onay": bool(onay),
        "kilit_yok": kilit_yok,
        "tohum_sayisi": len(ozet),
        "adim_basina": ADIM_BASINA_TOHUM,
        "bos_kalacak_gozler": [o["goz"] for o in ozet],
        "kalan_dolu_goz": max(0, len(havuz) - len(ozet)),
        "uc": uc_takili or "",
        "guvenli_z": guvenli_z,
        "dusme_sn": dusme_sn,
    }
