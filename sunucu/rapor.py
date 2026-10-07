"""Sabah raporu — WhatsApp'a gidecek tek parça Türkçe metin.

NEDEN AYRI MODÜL. `main.py` 4000 satır ve aynı depoda birden çok oturum
çalışıyor; yeni bölüm kendi dosyasında, `main.py`'ye tek satır
`include_router` giriyor.

HESAP BURADA YAPILMIYOR, ÇAĞRILIYOR. "Şu bitki susadı" kararı
`bahce.susama_durumu` içinde ve sulama akışının kullandığı kanıtın
aynısına dayanıyor. Burada yeniden hesaplasaydık iki ayrı "susadı"
tanımı olurdu: panelde dört bitki, WhatsApp'ta üç. Bu modül yalnız
`_bahce_veri()`nin hazır çıktısını okuyup cümleye çeviriyor.

ÖLÇÜLMEYEN SAYI YAZILMIYOR. Rapor bir insana gidiyor ve insan okuduğu
sayıya göre tarlaya iniyor. Sensör susmuşsa son değeri yeni gibi
göstermek, toprak nemi kalibre değilken yüzde uydurmak ya da ölçüm
olmadan "susadı" demek — üçü de okuyanı yanlış işe gönderir. Her birinde
sayı yerine SEBEP yazılıyor.

TEK PARÇA DÜZ METİN DÖNÜYOR. Pi'deki bash `curl` ile çekip doğrudan
`mudslide send` komutuna veriyor; araya `jq` sokmamak için varsayılan
biçim düz metin. JSON isteyen `?bicim=json` diyebiliyor.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Callable

logger = logging.getLogger(__name__)

#: Ortam ölçümü bu yaştan eskiyse sayı yazılmıyor, "sensör susmuş" deniyor.
#:
#: Panel 300 sn kullanıyor (`bahce.OLCUM_BAYAT_SN`) çünkü orada kullanıcı
#: ekrana bakıp anlık karar veriyor. Sabah raporu günde bir kez gidiyor ve
#: gecenin bir yarısı alınmış bir okuma hâlâ "bu sabahın havası" sayılır;
#: bir saat o aralığı kapsıyor, uyku modunda geçen kısa boşlukları da
#: gereksiz yere "arıza" diye göstermiyor.
OLCUM_BAYAT_SN = 3600.0

#: Raporda en çok kaç bitki adı sayılacak. Üstü "ve N tane daha".
#: Sebep biçimsel: WhatsApp bildiriminde uzun liste okunmuyor, 25 adın
#: alt alta geldiği bir mesaj okunmadan kapatılıyor.
AZAMI_AD = 6


def _sayi(deger: Any) -> float | None:
    try:
        if deger in (None, ""):
            return None
        return float(deger)
    except (TypeError, ValueError):
        return None


def _liste_yaz(adlar: list[str], azami: int = AZAMI_AD) -> str:
    """['a','b','c'] -> 'a, b ve c'. Uzunsa kuyruğu sayıya düşüyor."""
    if not adlar:
        return ""
    if len(adlar) > azami:
        return ", ".join(adlar[:azami]) + f" ve {len(adlar) - azami} tane daha"
    if len(adlar) == 1:
        return adlar[0]
    return ", ".join(adlar[:-1]) + " ve " + adlar[-1]


def _turlere_gore(bitkiler: list[dict[str, Any]], azami: int = AZAMI_AD) -> str:
    """Bitki listesini TÜRE GÖRE SAYARAK yazar: '4 Roka, 2 Marul ve Havuç'.

    Bitki adı yerine tür adı yazıldığı için aynı türden dört bitki
    "Roka, Roka, Roka ve Roka" diye çıkıyordu — sahada görüldü. Tür adı
    doğru seçim (okuyan "roka-5" değil "Roka" arıyor), o yüzden ad
    değiştirilmedi, SAYILDI. Tek taneli türde sayı yazılmıyor: "1 Havuç"
    değil "Havuç".
    """
    sayac: dict[str, int] = {}
    for b in bitkiler:
        ad = str(b.get("tur_ad") or b.get("tur") or b.get("ad") or "bitki")
        sayac[ad] = sayac.get(ad, 0) + 1
    # Çoktan aza: en kalabalık tür önce okunsun.
    sirali = sorted(sayac.items(), key=lambda p: (-p[1], p[0]))
    return _liste_yaz([(f"{n} {ad}" if n > 1 else ad) for ad, n in sirali], azami)


def _selam(simdi: float) -> str:
    """Haftanın gününe göre değişen açılış — her sabah aynı cümle okunmuyor."""
    gun = time.localtime(simdi).tm_wday
    return [
        "Günaydın! Yeni bir hafta başlıyor",
        "Günaydın! Salı sabahı",
        "Günaydın! Haftanın ortasına geldik",
        "Günaydın! Perşembe oldu bile",
        "Günaydın! Cuma sabahı",
        "Günaydın! Hafta sonunun ilk sabahı",
        "Günaydın! Pazar sabahı",
    ][gun]


def _ortam_satiri(olcum: dict[str, Any] | None, kalib: dict[str, Any] | None,
                  simdi: float) -> list[str]:
    """Hava ve toprak satırları. Ölçüm yoksa ya da bayatsa SEBEP yazılıyor."""
    satir: list[str] = []
    o = olcum or {}
    ts = _sayi(o.get("ts"))
    yas = (simdi - ts) if ts else None

    if not o or yas is None:
        satir.append("🌡️ Sensörlerden bu sabah okuma gelmedi — değer "
                     "uydurmuyorum, kartı bir kontrol etmek gerekebilir.")
        return satir

    if yas > OLCUM_BAYAT_SN:
        saat = yas / 3600.0
        satir.append(f"🌡️ Son ölçüm {saat:.0f} saat önce alınmış, bu sabahın "
                     "havasını bilmiyorum. Sensör susmuş olabilir.")
        return satir

    sicaklik = _sayi(o.get("hava_sicaklik"))
    hava_nem = _sayi(o.get("hava_nem"))
    if sicaklik is not None and hava_nem is not None:
        satir.append(f"🌡️ Hava {sicaklik:.0f} °C, nem %{hava_nem:.0f}.")
    elif sicaklik is not None:
        satir.append(f"🌡️ Hava {sicaklik:.0f} °C. (Nem okunamadı.)")
    elif hava_nem is not None:
        satir.append(f"💧 Nem %{hava_nem:.0f}. (Sıcaklık okunamadı.)")
    else:
        # Servo tutarken DHT bilerek atlanıyor (bkz. firmware); bu bir
        # arıza değil ve öyle yazılmamalı.
        satir.append("🌡️ Hava ölçümü bu turda alınmamış.")

    # TOPRAK NEMİ KALİBRASYONA BAĞLI. Ham sayım 0-1023; kuru/ıslak
    # referansı girilmeden yüzdeye çevirmek uydurma olur.
    ham = _sayi(o.get("toprak_nem"))
    k = kalib or {}
    kuru, islak = _sayi(k.get("kuru")), _sayi(k.get("islak"))
    if ham is None:
        pass                      # prob okumadı; yukarıdaki satırlar yeter
    elif kuru is None or islak is None or kuru == islak:
        satir.append("🪴 Toprak nemi henüz kalibre edilmedi, yüzde "
                     "veremiyorum (ham okuma var).")
    else:
        oran = (kuru - ham) / (kuru - islak)
        satir.append(f"🪴 Toprağın nemi %{max(0.0, min(1.0, oran)) * 100:.0f}.")
    return satir


def metin_uret(bahce: dict[str, Any], durum: dict[str, Any] | None,
               olcum: dict[str, Any] | None, simdi: float | None = None) -> str:
    """Sabah raporunun tam metni."""
    simdi = time.time() if simdi is None else simdi
    d = durum or {}
    bitkiler = [b for b in (bahce.get("bitkiler") or []) if b.get("ad")]

    parca = [f"🌸 {_selam(simdi)}. Ben Pi 🤖, tarladan bildiriyorum."]

    # BOŞ YATAK. Sayı yok, ölçüm yok, yapılacak iş yok — raporun geri
    # kalanını yazmanın anlamı da yok.
    if not bitkiler:
        parca.append("")
        parca.append("🌱 Şu an yatağımız boş, yeni tohumlar bekliyorum. "
                     "Ektiğinizde buradan haber veririm.")
        return "\n".join(parca)

    tur_sayisi = len({str(b.get("tur_ad") or b.get("tur") or "") for b in bitkiler})
    parca.append("")
    parca.append(f"🌿 Yatakta {len(bitkiler)} bitki var"
                 + (f", {tur_sayisi} farklı türden." if tur_sayisi > 1 else "."))

    parca.extend(_ortam_satiri(olcum, d.get("toprak_kalib"), simdi))

    # SUSAYANLAR — KANITIYLA AYRILIYOR. `olculen` gerçekten ölçülmüş bir
    # nem; `gecen_gun` ölçüm yokken geçen süreye bakan bir TAHMİN. İkisini
    # aynı cümlede saymak, tahmini ölçüm gibi göstermek olurdu.
    olculen = [b for b in bitkiler if b.get("susadi") and b.get("su_kanit") == "olculen"]
    tahmini = [b for b in bitkiler if b.get("susadi") and b.get("su_kanit") != "olculen"]

    parca.append("")
    if olculen:
        parca.append(f"🚿 Bugün {len(olculen)} bitki sulanmaya ihtiyaç "
                     f"duyuyor: {_turlere_gore(olculen)}. Toprak nemleri "
                     f"ölçüldü ve eşiğin altında.")
    if tahmini:
        parca.append(f"🤔 {_turlere_gore(tahmini)} için elimde taze bir nem "
                     f"ölçümü yok; geçen süreye bakarsak susamış olabilirler. "
                     f"Emin olmak için nemlerini ölçmemi isteyebilirsiniz.")
    if not olculen and not tahmini:
        # "SUSAYAN YOK" DA KANITINA GÖRE SÖYLENİYOR. Hiçbir bitkinin
        # ölçülmüş nemi yoksa bu cümle bir gözlem değil bir tahmin; onu
        # gözlem gibi yazmak, okuyanı "tarla iyi" diye rahatlatıp
        # gerçekte kurumuş bir yatağa götürebilir.
        olculmus = [b for b in bitkiler if b.get("su_kanit") == "olculen"]
        if olculmus:
            parca.append("✅ Kimsenin suya ihtiyacı yok, herkes keyifli "
                         "görünüyor.")
        else:
            parca.append("🤷 Susayan görünmüyor ama bu ölçüme değil son "
                         "ilgilendiğim zamana dayanıyor; taze nem ölçümüm "
                         "yok.")

    # HASAT — kart zaten hesaplıyor, burada yalnız sayılıyor.
    hasat = [b for b in bitkiler if b.get("hasat")]
    if hasat:
        parca.append(f"🧺 {_turlere_gore(hasat)} hasada hazır görünüyor.")

    # MAKİNE BAĞLI DEĞİLSE İŞ YAPILAMAZ. Raporun sonunda söylemek önemli:
    # "şunu sula" deyip makinenin kapalı olduğunu yazmamak, okuyanı boşuna
    # panele göndermek olurdu.
    if not d.get("bagli"):
        parca.append("")
        parca.append("⚠️ Bu arada makineyle bağlantım yok — verilen işler "
                     "ben bağlanınca çalışır.")

    parca.append("")
    parca.append("İyi günler! 🌻")
    return "\n".join(parca)


def yonlendirici_kur(parola_dogrula, bahce_veri: Callable[[], dict[str, Any]],
                     anlik: Callable[[], tuple[dict[str, Any], dict[str, Any]]]):
    """`main.py` tek satırla bağlıyor.

    `bahce_veri` ve `anlik` dışarıdan geliyor: bu modül `noktalar`,
    `sulama`, `depo` gibi şeyleri kendi çağırsaydı aynı hesabın ikinci bir
    kopyası doğardı.
    """
    from fastapi import APIRouter, HTTPException, Query
    from fastapi.responses import PlainTextResponse

    yon = APIRouter()

    @yon.get("/api/whatsapp-report")
    async def whatsapp_raporu(jeton: str = Query(""), bicim: str = Query("metin")):
        parola_dogrula(jeton)
        try:
            bahce = bahce_veri()
            durum, olcum = anlik()
        except Exception:
            # SESSİZ BAŞARISIZLIK YOK. Boş metin dönmek, WhatsApp'a boş
            # mesaj attırır ve sebebi hiçbir yere yazılmaz.
            logger.exception("Sabah raporu: veri toplanamadı")
            raise HTTPException(500, "Rapor verisi toplanamadı — sunucu günlüğüne bakın")

        metin = metin_uret(bahce, durum, olcum)
        if bicim == "json":
            return {"metin": metin}
        return PlainTextResponse(metin, media_type="text/plain; charset=utf-8")

    return yon
