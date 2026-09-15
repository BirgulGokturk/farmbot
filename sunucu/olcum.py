"""Bitki ölçümlerinin zaman serisi — büyüme takibi.

NE SAKLIYOR
-----------
Kare başına özet: kaç bitki, toplam yeşil alan, en büyüğü, karenin ne
kadarını kapladıkları. Tek tek bitkiler DEĞİL — bir lekeyi kayıtlı bir
bitkiye bağlamak kamera kalibrasyonu istiyor ve o yok. Kalibrasyon
geldiğinde bitki başına kayıt buraya eklenecek; şimdilik soru "bu
yatakta ne kadar yeşillik var ve artıyor mu".

MİLİMETRE YOK, ORAN VAR
-----------------------
`kapladigi_oran` karenin alanına oranlı olduğu için ÇÖZÜNÜRLÜKTEN
bağımsız: kamera ayarı değişse bile eski kayıtlarla karşılaştırılabilir.
`toplam_alan_px` ise çözünürlüğe bağlı ve yalnız aynı ayarla alınmış
kayıtlar arasında anlamlı. İkisi birlikte yazılıyor; hangisinin
karşılaştırılabilir olduğu belli olsun.

KAMERA OYNARSA GEÇMİŞ YANILTIR
------------------------------
Bu projede kameralar sabit değil. Kamera yer değiştirdiğinde aynı yatağın
"yeşil oranı" bambaşka çıkar ve grafik, olmayan bir büyümeyi gösterir.
Bu yüzden her kayda o anki makine KONUMU da yazılıyor ve panel, konumu
farklı olan kayıtları ayrı seriler olarak gösteriyor — birleştirip tek
eğri çizmek uydurma olurdu.

NEDEN JSONL
-----------
Satır başına bir kayıt: yazma ekleme (append), okuma sıralı, bozulan bir
satır yalnız kendini kaybettiriyor. SQLite'a (`depo.py`) koymak da
olurdu ama o tablo ölçüm/sensör verisi için kurulu; farklı bir şeyi aynı
yere sıkıştırmak ikisini de zorlaştırır.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any

logger = logging.getLogger("tarim.olcum")

_KILIT = threading.Lock()

#: Aynı kameradan bu sıklıktan daha sık kayıt yazılmıyor. Sürekli kip
#: saniyede iki kez sonuç üretebiliyor; hepsini yazmak günde yüz binlerce
#: satır demek ve büyüme eğrisi için hiçbiri gerekmiyor. 5 dakika, bir
#: filizin ölçülebilir biçimde değişmesi için gereken sürenin çok altında.
ARALIK_SN = 300.0

#: Dosya bu satır sayısını aşınca en eskiler atılıyor. 20000 satır ≈ iki
#: kamera için ~70 gün (5 dakikada bir). Sınırsız büyüyen bir dosya,
#: SD kartı dolduran sessiz bir sızıntı olurdu.
AZAMI_SATIR = 20000

_son_yazma: dict[str, float] = {}


def _kok() -> str:
    return os.environ.get("VERI_YOLU") or os.path.expanduser("~/farmbot-veri")


def _yol() -> str:
    return os.path.join(_kok(), "bitki_olcum.jsonl")


def ekle(kamera: str, olcum: dict[str, Any], konum: dict[str, Any] | None = None,
         ts: float | None = None, zorla: bool = False) -> bool:
    """Bir ölçümü kaydeder. Çok sık geldiyse ATLAR ve False döner.

    `zorla` yalnız kullanıcının elle "şimdi ölç" dediği yerde kullanılıyor;
    orada aralık beklemek, basılan düğmenin hiçbir şey yapmaması demek.
    """
    if not olcum:
        return False
    simdi = time.time() if ts is None else float(ts)
    kam = str(kamera or "?")
    with _KILIT:
        if not zorla:
            onceki = _son_yazma.get(kam, 0.0)
            if simdi - onceki < ARALIK_SN:
                return False
        _son_yazma[kam] = simdi

    kayit = {
        "ts": round(simdi, 1),
        "kamera": kam,
        "adet": int(olcum.get("adet") or 0),
        "ham_adet": int(olcum.get("ham_adet") or 0),
        "toplam_alan_px": int(olcum.get("toplam_alan_px") or 0),
        "en_buyuk_px": int(olcum.get("en_buyuk_px") or 0),
        "ortanca_px": int(olcum.get("ortanca_px") or 0),
        "kapladigi_oran": float(olcum.get("kapladigi_oran") or 0.0),
    }
    k = konum or {}
    if k.get("x") is not None and k.get("y") is not None:
        # Konum tam sayı mm: ölçümün nerede alındığı için milimetre altı
        # hassasiyetin anlamı yok, ama kameranın oynadığını görmek şart.
        kayit["konum"] = {"x": round(float(k["x"])), "y": round(float(k["y"])),
                          "z": (round(float(k["z"])) if k.get("z") is not None
                                else None)}

    try:
        os.makedirs(_kok(), exist_ok=True)
        with _KILIT:
            with open(_yol(), "a", encoding="utf-8") as dosya:
                dosya.write(json.dumps(kayit, ensure_ascii=False) + "\n")
            _buda()
    except OSError as hata:
        logger.warning("Ölçüm yazılamadı: %s", hata)
        return False
    return True


def _buda() -> None:
    """Dosyayı `AZAMI_SATIR`a indirir. Kilit ÇAĞIRANDA tutuluyor."""
    yol = _yol()
    try:
        if os.path.getsize(yol) < AZAMI_SATIR * 120:   # kaba ön eleme
            return
        with open(yol, encoding="utf-8") as dosya:
            satirlar = dosya.readlines()
        if len(satirlar) <= AZAMI_SATIR:
            return
        gecici = yol + ".tmp"
        with open(gecici, "w", encoding="utf-8") as dosya:
            dosya.writelines(satirlar[-AZAMI_SATIR:])
        os.replace(gecici, yol)
    except OSError:
        pass


def gecmis(kamera: str = "", saat: float = 72.0,
           azami: int = 2000) -> list[dict[str, Any]]:
    """Son `saat` saatteki kayıtlar, eskiden yeniye.

    Bozuk satırlar SESSİZCE atlanıyor ama sayılıyor: dosyanın sonu bir
    güç kesintisinde yarım kalabiliyor ve tek bir kırık satır bütün
    geçmişi kaybettirmemeli.
    """
    yol = _yol()
    if not os.path.exists(yol):
        return []
    sinir = time.time() - max(0.0, float(saat)) * 3600.0
    kam = str(kamera or "")
    cikti: list[dict[str, Any]] = []
    try:
        with _KILIT:
            with open(yol, encoding="utf-8") as dosya:
                for satir in dosya:
                    satir = satir.strip()
                    if not satir:
                        continue
                    try:
                        kayit = json.loads(satir)
                    except ValueError:
                        continue
                    if kam and kayit.get("kamera") != kam:
                        continue
                    if float(kayit.get("ts") or 0) < sinir:
                        continue
                    cikti.append(kayit)
    except OSError as hata:
        logger.warning("Ölçüm geçmişi okunamadı: %s", hata)
        return []
    if len(cikti) > azami:
        # Baştan atmıyoruz, SEYRELTİYORUZ: grafiğin başı da sonu da
        # görünsün. Son kayıt her zaman korunuyor.
        adim = len(cikti) / float(azami)
        secili = [cikti[int(i * adim)] for i in range(azami)]
        if secili[-1] is not cikti[-1]:
            secili[-1] = cikti[-1]
        cikti = secili
    return cikti


def kameralar() -> list[str]:
    """Geçmişte kaydı olan kamera adları."""
    adlar: list[str] = []
    for kayit in gecmis(saat=24 * 365, azami=100000):
        ad = str(kayit.get("kamera") or "")
        if ad and ad not in adlar:
            adlar.append(ad)
    return adlar
