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
"""

from __future__ import annotations

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


def coz(hedefler: list[dict[str, Any]], gozler: list[dict[str, Any]] | None, *,
        guvenli_z: float, genel_toprak_z: float = 0.0,
        dikim_alanlari: list[dict[str, Any]] | None = None,
        lock_reg: int = 0, uc_takili: str | None = None,
        vakum_sn: float = VAKUM_SANIYE, dusme_sn: float = DUSME_SANIYE,
        tur_adlari: dict[str, str] | None = None,
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
    if int(lock_reg or 0) <= 0:
        ret.append(
            "Uç kilit servosu bağlı değil (uclar.json → lock_reg = 0). Kilit "
            "bağlanmadan ekim dizisi başlatılamaz: servo komutu sessiz geçtiği "
            "için uç takılı sanılır ve kafa vakum ucu olmadan gözün içine iner.")

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

        adimlar.extend(_adimlar_bir_tohum(
            hedef, goz, guvenli_z=guvenli_z, ekim_z=ekim_z,
            vakum_sn=vakum_sn, dusme_sn=dusme_sn))
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
        "tohum_sayisi": len(ozet),
        "adim_basina": ADIM_BASINA_TOHUM,
        "bos_kalacak_gozler": [o["goz"] for o in ozet],
        "kalan_dolu_goz": max(0, len(havuz) - len(ozet)),
        "uc": uc_takili or "",
    }
