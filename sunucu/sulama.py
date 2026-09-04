"""Sulama ofseti — suyun bitkinin NERESİNE bırakılacağı.

Neden gerekti
-------------
Sulama şimdiye kadar bitkinin tam üstüne gidip sabit süre akıtıyordu. Bu
her bitki için doğru değil: besleyici kökler kanopinin kenarında, yani
damlama hattında. Fideye 80 mm uzağa su vermek boşa akıtmak; olgun bir
domatese gövdeye akıtmak yaprağı ıslatıp kökü kuru bırakmak.

Model — tek formül, üç davranış
-------------------------------
    ofset = sulama_oran x (bitkinin O ANKİ yarıçapı)

Sorulan üç seçenek bunun içinde birer özel hâl, ayrı bir kip anahtarı yok:

  * `egri_yayilim` bağlıysa yarıçap YAŞA GÖRE değişiyor. 0. günde ~0
    (fidenin gövdesi), olgunlukta damlama hattı. Doğru davranış modelin
    kendisinden çıkıyor, ayrıca kural yazmıyoruz.
  * Eğri yoksa yarıçap türün OLGUN `spread_mm`/2 değeri — yani oran bir
    yüzde gibi çalışıyor. DİKKAT: bu hâlde fideye ilk günden olgun bitki
    mesafesi verilir. Panelde bu not alanın altında yazıyor.
  * Tür düzeyinde ikisi de sabitse sonuç sabit mm.

Ayrı bir `sabit_mm` toplama terimi bilerek YOK: eğrisiz hâl zaten onu
veriyor ve altıncı bir alan panelde karşılığı olmayan karmaşıklık olurdu.

Neden koordinatlar SUNUCUDA donuyor
-----------------------------------
Türetilmiş ofset her gün değişiyor. Robotun gittiği yerin kullanıcının
kafasındaki yerle aynı olması bu projenin ölçütü; onun için ofsetler
BURADA çözülüp diziye MUTLAK koordinat olarak yazılıyor. Ajan hiçbir şey
türetmiyor, yalnız gidilecek noktayı görüyor. Panelin önizlemede
gösterdiği ile dizinin taşıdığı böylece aynı sayı oluyor.

Ne BURADA değil
---------------
Yasak bölgeler, yumuşak sınırlar ve Z kilidi AJANDA kalıyor; bu dosya
onları kopyalamıyor. Burada yalnız dikim alanı denetimi var, çünkü o bir
veri geçerliliği kararı (bkz. dikim.py) ve ajan kopukken de işlemeli.
"""

from __future__ import annotations

import math
from typing import Any

import dikim
import egriler
import turler

# Vana açılıp kapanmasının sabit bir bedeli var (hat basınçlanması,
# damlama). Nokta başına süre bunun altına inerse noktaya giden gerçek
# hacim `V/N` olmuyor. O yüzden süreyi kısaltmak yerine NOKTA SAYISINI
# düşürüyoruz — bkz. `_nokta_sayisi`.
EN_KISA_SANIYE = 1.0

# Ucun toprak yüzeyine en fazla bu kadar yaklaşmasına izin var. Sulama
# ucunun toprağa dalması gerekmiyor; 20 mm, ölçüm hatası ve bitki
# hareketi için makul bir pay. Mutlak Z tabanı ayrıca var
# (`sulama_basligi.z_min`) ve ikisinin büyüğü uygulanıyor.
EN_AZ_ACIKLIK_MM = 20.0

# NEM OKUMASI ne kadar yakın ve ne kadar taze olmalı.
#
# Yarıçap: 100 mm ötedeki bir okuma bu bitkinin kökü hakkında pek bir şey
# söylemiyor — sulanmış komşunun ıslaklığını okuyup bu bitkiyi susuz
# bırakmak, hiç ölçmemekten kötü.
#
# Tazelik: üç gün önceki bir okuma bugünün kararını veremez. 24 saat,
# günlük sulama döngüsüyle aynı mertebe.
NEM_YARICAP_MM = 100.0
NEM_AZAMI_YAS_SN = 24 * 3600.0

# Sulama başlığının varsayılanı — ajan `durum.uc.sulama_basligi`
# göndermezse bu geçerli. Kayma SIFIR: uydurulmuş bir kayma, suyu
# sessizce yanlış yere döker.
VARSAYILAN_BASLIK = {"dx": 0.0, "dy": 0.0, "z_min": 0.0}


class SulamaHatasi(Exception):
    """Ofset çözülemedi ya da sonuç kabul edilemez."""


def _sayi(deger: Any, varsayilan: float = 0.0) -> float:
    try:
        d = float(deger)
    except (TypeError, ValueError):
        return varsayilan
    return d if math.isfinite(d) else varsayilan


def _egri_deger(ad: str, gun: float, egri_listesi: list[dict[str, Any]] | None):
    """Adı verilen eğrinin `gun` yaşındaki değeri; eğri yoksa None."""
    if not ad:
        return None
    for e in (egri_listesi or []):
        if e.get("ad") == ad:
            return egriler.deger(e, gun)
    return None


def nem_yuzde(ham: Any, kalib: dict[str, Any] | None) -> float | None:
    """Ham toprak nemi sayımını KALİBRE yüzdeye çevirir.

    Ham 0-1023 üzerinden karşılaştırma yapmak yanlış: probun kuru ve ıslak
    uçları sahada 1023/0 değil (bu makinede ıslak ~593 ölçüldü). Ajan
    `durum.toprak_kalib` ile {kuru, islak} sayımlarını gönderiyor,
    karşılaştırma buradan geçiyor.

    Formül yön bağımsız: ters bağlanmış bir probda `kuru < islak` olur ve
    aynı ifade yine doğru yüzdeyi verir.
    """
    if ham in (None, ""):
        return None
    try:
        h = float(ham)
    except (TypeError, ValueError):
        return None
    k = kalib or {}
    kuru = _sayi(k.get("kuru"), 1023.0)
    islak = _sayi(k.get("islak"), 0.0)
    if kuru == islak:
        return None
    oran = (kuru - h) / (kuru - islak)
    return max(0.0, min(100.0, oran * 100.0))


def en_yakin_nem(x: float, y: float, okumalar, simdi: float,
                 kalib: dict[str, Any] | None):
    """(yüzde, uzaklık_mm, yaş_sn) — yakında taze okuma yoksa (None, …).

    Yalnız TOPRAK nemi (`toprak_nem`). Hava nemi (`hava_nem`, DHT) buraya
    ASLA girmiyor: yağmurlu bir günde hava nemi yüksek olur ve karışırsa
    sulama susuz toprakta atlanır.
    """
    en_iyi = None
    for k in (okumalar or []):
        ham = k.get("toprak_nem")
        if ham in (None, ""):
            continue
        try:
            kx, ky = float(k.get("x")), float(k.get("y"))
        except (TypeError, ValueError):
            continue
        uzak = math.hypot(kx - x, ky - y)
        if uzak > NEM_YARICAP_MM:
            continue
        yas = max(0.0, simdi - _sayi(k.get("ts"), simdi))
        if yas > NEM_AZAMI_YAS_SN:
            continue
        # Aynı yarıçapta birden çok okuma varsa EN TAZE olanı: toprak
        # kuruyor, eski okuma bugünkü hâli anlatmıyor.
        if en_iyi is None or yas < en_iyi[2]:
            yuzde = nem_yuzde(ham, kalib)
            if yuzde is not None:
                en_iyi = (yuzde, uzak, yas)
    return en_iyi if en_iyi else (None, None, None)


def yas_gun(bitki: dict[str, Any], simdi: float) -> float:
    """Bitkinin gün cinsinden yaşı. Ekim tarihi yoksa 0."""
    ekim = bitki.get("ekim")
    if ekim in (None, ""):
        return 0.0
    return max(0.0, (float(simdi) - float(ekim)) / 86400.0)


def _ozel(bitki: dict[str, Any], alan: str):
    ozel = bitki.get("ozel") or {}
    return ozel.get(alan)


def ayar_coz(bitki: dict[str, Any], tur: dict[str, Any] | None) -> dict[str, Any]:
    """Sulama ayarlarını ezme zincirinden çözer.

    Öncelik `spread_mm` ile AYNI: bitkinin `ozel` alanı > tür ezmesi >
    katalog/şema varsayılanı. Yeni bir mekanizma kurmuyoruz; kullanıcı
    zaten bu sırayı biliyor.
    """
    cikti: dict[str, Any] = {}
    for alan, varsayilan in turler.VARSAYILAN.items():
        deger = _ozel(bitki, alan)
        if deger in (None, ""):
            deger = (tur or {}).get(alan)
        if deger in (None, ""):
            deger = varsayilan
        try:
            cikti[alan] = turler.alan_dogrula(alan, deger)
        except turler.TurHatasi:
            # Bozuk bir ezme sulamayı kilitlemesin: varsayılana düşüyoruz.
            # Sessiz değil — çağıran `uyari` listesinde görüyor.
            cikti[alan] = varsayilan
            cikti.setdefault("_uyari", []).append(
                f"{turler.BASLIK[alan]} değeri okunamadı, varsayılan kullanıldı")
    return cikti


#: `ayar_kaynagi`nın döndürdüğü kaynakların okunur adı.
KAYNAK_ADI = {
    "bitki": "bitkinin kendi ayarı",
    "tur_ezme": "tür ezmesi",
    "varsayilan": "varsayılan",
}


def ayar_kaynagi(bitki: dict[str, Any], tur: dict[str, Any] | None,
                 alan: str = "sulama_nem_esigi") -> tuple[Any, str]:
    """(değer, kaynak) — `ayar_coz` ile AYNI zincir, ama kazananı söylüyor.

    NEDEN VAR. `ayar_coz` üç kademeyi (bitkinin `ozel` alanı > tür ezmesi >
    varsayılan) sessizce çözüyor ve geriye yalnız bir sayı kalıyor. Sahada
    tam bu yüzden zaman kaybedildi: panelde tür eşiği %50 yazıyordu, bitki
    kendi `ozel` alanında %100 taşıyordu ve %57 ölçülen bitki sulandı.
    Karar doğruydu, kaynağı görünmüyordu.

    "Tür ezmesi" ile "varsayılan" ayrımı `turler.hepsi()`nin `ezili`
    alanından geliyor: kullanıcı o alanı yazdıysa orada listeleniyor,
    yazmadıysa değeri `varsayilanlari_uygula` doldurmuş demektir. Katalog
    sulama alanlarını hiç taşımıyor, o yüzden başka bir ayrım yok.

    `ayar_coz` ile aynı sonucu vermek ZORUNDA; ayrışırsa günlük yalan
    söyler. Bozuk bir değerde ikisi de varsayılana düşüyor.
    """
    varsayilan = turler.VARSAYILAN.get(alan)
    ozel = _ozel(bitki, alan)
    if ozel not in (None, ""):
        try:
            return turler.alan_dogrula(alan, ozel), "bitki"
        except turler.TurHatasi:
            return varsayilan, "varsayilan"
    deger = (tur or {}).get(alan)
    if deger not in (None, ""):
        try:
            temiz = turler.alan_dogrula(alan, deger)
        except turler.TurHatasi:
            return varsayilan, "varsayilan"
        if alan in ((tur or {}).get("ezili") or {}):
            return temiz, "tur_ezme"
        return temiz, "varsayilan"
    return varsayilan, "varsayilan"


def guncel_yaricap_mm(bitki: dict[str, Any], tur: dict[str, Any] | None,
                      gun: float, egri_listesi=None) -> tuple[float, bool]:
    """(yarıçap_mm, eğriden_mi).

    Sıra: bitkinin `ozel.spread_mm`i > yayılım eğrisi > türün spread_mm'i.
    `ozel` en üstte, çünkü kullanıcı o bitki için açıkça bir çap yazmışsa
    eğri onu ezmemeli — `turAlani`'ndaki sıralamanın aynısı.
    """
    ozel_cap = _ozel(bitki, "spread_mm")
    if ozel_cap not in (None, ""):
        return max(0.0, _sayi(ozel_cap) / 2.0), False
    egri_cap = _egri_deger(str(bitki.get("egri_yayilim") or ""), gun, egri_listesi)
    if egri_cap is not None:
        return max(0.0, _sayi(egri_cap) / 2.0), True
    return max(0.0, _sayi((tur or {}).get("spread_mm"), 0.0) / 2.0), False


def guncel_yukseklik_mm(bitki: dict[str, Any], gun: float, egri_listesi=None) -> float:
    """Bitkinin o anki boyu; yükseklik eğrisi yoksa 0 (yüzey hizası)."""
    deger = _egri_deger(str(bitki.get("egri_yukseklik") or ""), gun, egri_listesi)
    return max(0.0, _sayi(deger, 0.0))


def _nokta(su_x: float, su_y: float, z: float, saniye: float,
           aci: float | None, bas: dict[str, Any]) -> dict[str, Any]:
    """Suyun düştüğü noktadan makinenin gideceği noktayı üretir."""
    return {
        "x": round(su_x + _sayi(bas.get("dx"), 0.0), 2),
        "y": round(su_y + _sayi(bas.get("dy"), 0.0), 2),
        "z": round(z, 2),
        "su_x": round(su_x, 2),
        "su_y": round(su_y, 2),
        "saniye": saniye,
        "aci": aci,
    }


def _yonler(desen: str, aci_derece: float, adet: int) -> list[float]:
    """Desenin ürettiği açılar (radyan). `ust` için boş liste."""
    taban = math.radians(aci_derece % 360.0)
    if desen == "ust":
        return []
    if desen == "yan":
        return [taban]
    if desen == "iki":
        return [taban, taban + math.pi]
    if desen == "cember":
        return [taban + (2.0 * math.pi * i) / adet for i in range(adet)]
    raise SulamaHatasi(f"Bilinmeyen sulama deseni: {desen!r}")


def _nokta_sayisi(desen: str, istenen: int, toplam_saniye: float) -> tuple[int, str]:
    """(kullanılacak nokta sayısı, uyarı).

    Süre nokta başına EN_KISA_SANIYE'nin altına düşerse SÜREYİ değil
    NOKTA SAYISINI kısıyoruz: kısa bir vana darbesinin büyük kısmı
    geçici rejim olur ve noktaya giden gerçek hacim hesaplanandan sapar.
    """
    if desen == "ust":
        return 1, ""
    if desen == "yan":
        return 1, ""
    if desen == "iki":
        n = 2
    else:
        n = max(2, min(8, int(istenen)))
    sigan = int(toplam_saniye // EN_KISA_SANIYE)
    if sigan < 1:
        sigan = 1
    if sigan < n:
        return sigan, (f"{n} noktalık desen {sigan} noktaya indirildi: "
                       f"{toplam_saniye:g} sn bu kadar noktaya bölününce "
                       f"nokta başına {EN_KISA_SANIYE:g} sn'nin altına düşüyordu")
    return n, ""


def noktalar(bitki: dict[str, Any], tur: dict[str, Any] | None, *,
             toplam_saniye: float, simdi: float, guvenli_z: float,
             genel_toprak_z: float = 0.0,
             egri_listesi: list[dict[str, Any]] | None = None,
             dikim_alanlari: list[dict[str, Any]] | None = None,
             baslik: dict[str, Any] | None = None,
             okumalar: list[dict[str, Any]] | None = None,
             toprak_kalib: dict[str, Any] | None = None,
             nem_bak: bool = True,
             ) -> dict[str, Any]:
    """Bir bitki için sulama noktalarını çözer.

    Dönen:
      {"noktalar": [{"x","y","z","saniye","aci"}...],
       "desen": str, "ofset_mm": float, "yuzey_z": float,
       "egriden": bool, "uyari": [str...], "ret": [str...]}

    `ret` doluysa bu bitki sulanamaz; çağıran diziyi HİÇ başlatmamalı.
    """
    ayar = ayar_coz(bitki, tur)
    uyari: list[str] = list(ayar.pop("_uyari", []))
    ret: list[str] = []

    gun = yas_gun(bitki, simdi)
    bx, by = _sayi(bitki.get("x")), _sayi(bitki.get("y"))
    desen = str(ayar["sulama_deseni"])
    bas = {**VARSAYILAN_BASLIK, **(baslik or {})}

    # --- SULANACAK MI: karar TOPRAK NEMİNE göre --------------------------
    esik = _sayi(ayar.get("sulama_nem_esigi"), 100.0)
    yuzde, uzak, yas = en_yakin_nem(bx, by, okumalar, simdi, toprak_kalib)
    sulanacak, nem_gerekce = True, ""
    if not nem_bak:
        # KOŞULSUZ SULAMA. Çağıran nem kapısını AÇIKÇA atlamak istedi
        # ("Nem ölç ve sula" görev tipi). Karar yine TEK yerde: ikinci bir
        # eşik hesabı yazmak yerine bu dal atlanıyor — iki ayrı yerde
        # yazılmış bir eşik, ikisinin ayrışması demektir.
        #
        # ÖLÇÜLEN SAYI YİNE GEREKÇEDE. Karar vermiyor ama gizlenmiyor da:
        # "%38 ölçüldü, yine de sulandı" ile "ölçüm yoktu, sulandı" aynı
        # şey değil ve günlüğe bakan kişi ikisini ayırabilmeli.
        nem_gerekce = ("nem bakılmadan sulanıyor — koşulsuz sulama istendi"
                       + (f" (o an ölçülen %{yuzde:.0f})" if yuzde is not None
                          else " (ölçüm yok)"))
    elif esik >= 100.0:
        nem_gerekce = "nem eşiği kapalı (%100) — her zaman sulanıyor"
    elif yuzde is None:
        # Okuma yoksa SULUYORUZ. Bitki kaybetmek, su israfından kötü;
        # ve sessizce atlamak "neden kurudu" sorusunu cevapsız bırakır.
        nem_gerekce = (f"{NEM_YARICAP_MM:.0f} mm içinde son "
                       f"{NEM_AZAMI_YAS_SN / 3600:.0f} saatte toprak nemi "
                       f"okuması yok — sulanıyor")
        uyari.append(nem_gerekce)
    elif yuzde < esik:
        nem_gerekce = (f"toprak nemi %{yuzde:.0f} < eşik %{esik:.0f} "
                       f"({uzak:.0f} mm ötede, {yas / 60:.0f} dk önce) — sulanıyor")
    else:
        sulanacak = False
        nem_gerekce = (f"toprak nemi %{yuzde:.0f} ≥ eşik %{esik:.0f} "
                       f"({uzak:.0f} mm ötede, {yas / 60:.0f} dk önce) — atlandı")

    if not sulanacak:
        return {"noktalar": [], "desen": desen, "ofset_mm": 0.0,
                "yuzey_z": dikim.toprak_yuzeyi(bx, by, genel_toprak_z, dikim_alanlari),
                "egriden": False, "uyari": uyari, "ret": [],
                "sulanacak": False, "nem_yuzde": yuzde, "nem_esigi": esik,
                "nem_gerekce": nem_gerekce}

    toplam_saniye = max(EN_KISA_SANIYE, _sayi(toplam_saniye, 3.0))
    adet, n_uyari = _nokta_sayisi(desen, int(_sayi(ayar["sulama_nokta"], 4.0)), toplam_saniye)
    if n_uyari:
        uyari.append(n_uyari)

    yaricap, egriden = guncel_yaricap_mm(bitki, tur, gun, egri_listesi)
    ofset = max(0.0, _sayi(ayar["sulama_oran"]) * yaricap)
    if desen != "ust" and not egriden:
        uyari.append(
            f"Yayılım eğrisi bağlı değil: ofset OLGUN çaptan hesaplandı "
            f"({yaricap * 2:.0f} mm), bitkinin bugünkü boyundan değil")

    # --- Z: yüzey + o anki boy + açıklık -----------------------------------
    # Toprak yüzeyi noktadan noktaya değişebiliyor (kaplar aynı hizada
    # olmayabilir), o yüzden alanından soruluyor.
    yuzey_z = dikim.toprak_yuzeyi(bx, by, genel_toprak_z, dikim_alanlari)
    boy = guncel_yukseklik_mm(bitki, gun, egri_listesi)
    aciklik = max(EN_AZ_ACIKLIK_MM, _sayi(ayar["sulama_aciklik_mm"], 50.0))
    sulama_z = yuzey_z + boy + aciklik
    # MUTLAK Z TABANI. Yüzey 170 + varsayılan açıklık 50 = 220 çıkıyor ve
    # bu, ölçülen kurulumda istenenin altında; başlık o yükseklikte
    # bitkiye/kaba sürtüyor. `sulama_basligi.z_min` ile taban veriliyor.
    z_min = _sayi(bas.get("z_min"), 0.0)
    if z_min > sulama_z:
        uyari.append(f"Sulama Z'si {sulama_z:.0f} → taban {z_min:.0f} mm'ye çekildi")
        sulama_z = z_min
    # Güvenli Z tavan: ucun daha yükseğe çıkmasına gerek yok ve güvenli
    # Z'nin ÜSTÜ zaten serbest gezinme yüksekliği.
    if sulama_z > guvenli_z:
        # Kırpma SESSİZ olmuyor. Boyu güvenli Z'yi aşan bir bitkide uç
        # istenenden yükseklerde kalıyor; su daha geniş bir alana
        # dağılıyor ve nokta hedefi bulanıklaşıyor. Reddetmiyoruz —
        # yukarıdan sulamak çalışıyor — ama kullanıcı bunu bilmeli.
        uyari.append(
            f"Uç istenen yükseklikte duramadı: yüzey {yuzey_z:.0f} + boy "
            f"{boy:.0f} + açıklık {aciklik:.0f} = Z{sulama_z:.0f}, güvenli Z "
            f"{guvenli_z:.0f} mm ile sınırlandı. Su kanopinin "
            f"{guvenli_z - yuzey_z - boy:.0f} mm üstünden düşecek.")
        sulama_z = guvenli_z
    if sulama_z < yuzey_z + EN_AZ_ACIKLIK_MM:
        # Yüzey güvenli Z'den yüksekse ayar tutarsız demektir; sessizce
        # toprağa inmektense reddediyoruz.
        ret.append(
            f"Sulama yüksekliği hesaplanamadı: yüzey Z{yuzey_z:.0f} + boy "
            f"{boy:.0f} + açıklık {aciklik:.0f} mm, güvenli Z {guvenli_z:.0f} mm'nin "
            f"üstüne çıkıyor. Güvenli Z'yi yükseltin ya da uç açıklığını düşürün.")
        return {"noktalar": [], "desen": desen, "ofset_mm": ofset,
                "yuzey_z": yuzey_z, "egriden": egriden, "uyari": uyari, "ret": ret,
                "sulanacak": True, "nem_yuzde": yuzde, "nem_esigi": esik,
                "nem_gerekce": nem_gerekce}

    # --- noktalar -----------------------------------------------------------
    yonler = _yonler(desen, _sayi(ayar["sulama_aci"]), adet)
    pay = round(toplam_saniye / max(1, len(yonler) or 1), 2)

    # BAŞLIK KAYMASI. Sulama başlığı Z eksenine ayrı takılı ve ucun
    # merkezinden kaymış: makine `hedef + (dx, dy)`ye gidince su hedefe
    # düşüyor. Yani iki ayrı nokta var ve İKİSİ AYRI DENETLENİYOR:
    #
    #   su_x, su_y  → suyun düştüğü yer    → DİKİM ALANI denetimi buna
    #   x, y        → makinenin gittiği yer → yumuşak sınır ve yasak
    #                                          bölge denetimi buna (ajanda)
    #
    # Tek noktaya bakmak ya suyu kabın dışına döktürür ya da geçerli bir
    # sulamayı reddeder.
    cikti: list[dict[str, Any]] = []
    if not yonler:
        cikti.append(_nokta(bx, by, sulama_z, round(toplam_saniye, 2), None, bas))
    else:
        for a in yonler:
            cikti.append(_nokta(bx + ofset * math.cos(a), by + ofset * math.sin(a),
                                sulama_z, pay, round(math.degrees(a) % 360.0, 1), bas))

    # --- dikim alanı denetimi: OFSETLİ konuma göre --------------------------
    # Bitkinin kendi konumu alanın içinde olsa bile ofsetli nokta dışına
    # düşebiliyor; denetlenen artık su GERÇEKTEN nereye gidiyorsa orası.
    if dikim_alanlari:
        for nk in cikti:
            # SU noktası denetleniyor, makinenin gittiği nokta değil:
            # kabın içinde olması gereken şey su.
            kabul, _, _ = dikim.nokta_kabul(nk["su_x"], nk["su_y"], dikim_alanlari)
            if kabul:
                continue
            if desen == "ust":
                ret.append(
                    f"X{nk['su_x']:.1f} Y{nk['su_y']:.1f} dikim alanı dışında — "
                    f"bitkiyi alanın içine taşıyın")
            else:
                # SEBEP + ÇÖZÜM. Sabit açı, kenardaki bitkide suyu duvara
                # nişanlayabiliyor; kullanıcıya ne yapacağını söylemek
                # "reddedildi" demekten çok daha işe yarıyor.
                ret.append(
                    f"X{nk['su_x']:.1f} Y{nk['su_y']:.1f} dikim alanı dışında "
                    f"({nk['aci']:.0f}° yönünde {ofset:.0f} mm ofset) — "
                    f"ofset yönünü (sulama_aci) çevirin, ofseti "
                    f"(sulama_oran) küçültün ya da bu bitkide deseni "
                    f"'tam üst' yapın")

    return {"noktalar": cikti, "desen": desen, "ofset_mm": round(ofset, 1),
            "yuzey_z": round(yuzey_z, 1), "boy_mm": round(boy, 1),
            "egriden": egriden, "uyari": uyari, "ret": ret,
            "sulanacak": True, "nem_yuzde": yuzde, "nem_esigi": esik,
            "nem_gerekce": nem_gerekce,
            "baslik": {"dx": _sayi(bas.get("dx"), 0.0),
                       "dy": _sayi(bas.get("dy"), 0.0),
                       "z_min": _sayi(bas.get("z_min"), 0.0)}}
