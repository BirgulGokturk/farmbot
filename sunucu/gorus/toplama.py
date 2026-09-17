"""Fide kesiti toplama — eğitim verisi, kendi kameranla.

NEDEN ETİKET ÇEKİM ANINDA. Etiketsiz bir yığın biriktirip sonra
etiketlemek ayrı bir arayüz ve ayrı bir seans demek; oysa kapta ne
olduğunu kullanıcı O AN biliyor. Tür çekim anında veriliyor, kesitler
doğrudan `veri/<tur>/` altına düşüyor ve eğitim betiği hiçbir dönüşüm
yapmadan okuyabiliyor (ImageFolder düzeni).

KESİT NEDEN PAYLI. Kutuyu tam sınırdan kesmek modeli yalnız yeşil dokuya
bakmaya zorluyor; yaprağın hemen dışındaki toprak bağlam veriyor. Pay,
kutunun uzun kenarının 0,25 katı.

KARE YAPILIYOR. Model kare girdi bekliyor; dikdörtgen bir kesiti
doğrudan kareye esnetmek en-boy oranını bozar ve aynı fide iki farklı
şekle girer. Uzun kenardan kare alınıyor, kenarlar kareden taşarsa
sınıra kırpılıyor.

DOLUNCA SİLMİYOR, DURUYOR. Üst sınıra gelince yazmayı kesiyor ve
söylüyor. Eski kayıtları silmek geri alınamaz; durmak alınabilir.
"""
from __future__ import annotations

import io
import json
import os
import re
import time
from typing import Any

#: Kesitin kaydedildiği kenar uzunluğu. Eğitim betiği ne isterse ona
#: ölçekler; burada büyük tutmak bilgi saklamak demek, küçültmek geri
#: alınamaz.
KESIT_BOYU = 256
PAY_ORANI = 0.25
#: Toplam disk sınırı (bayt). Pi'nin SD kartı dolmasın.
AZAMI_BAYT = 512 * 1024 * 1024
#: Tür adı: dosya yolu olacağı için dar bir alfabe.
AD_DESENI = re.compile(r"^[a-z0-9çğıöşü_-]{2,40}$")


def _kok() -> str:
    return os.environ.get("GORUS_VERI") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "veri")


def _boyut(kok: str) -> int:
    top = 0
    for dizin, _, adlar in os.walk(kok):
        for ad in adlar:
            try:
                top += os.path.getsize(os.path.join(dizin, ad))
            except OSError:
                pass
    return top


def _kare_kutu(kutu, en: int, boy: int) -> tuple[int, int, int, int]:
    """Lekenin kutusundan paylı bir KARE kesit kutusu."""
    x1, y1, x2, y2 = [float(v) for v in kutu]
    x1, x2 = min(x1, x2), max(x1, x2)
    y1, y2 = min(y1, y2), max(y1, y2)
    uzun = max(x2 - x1, y2 - y1)
    yari = uzun * (1.0 + 2.0 * PAY_ORANI) / 2.0
    mx, my = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    a = int(round(mx - yari)); b = int(round(my - yari))
    c = int(round(mx + yari)); d = int(round(my + yari))
    # Kenardan taşarsa KAYDIRIYORUZ, kırpmıyoruz: kırpmak kareyi
    # dikdörtgen yapar ve oran bozulur.
    if a < 0: c -= a; a = 0
    if b < 0: d -= b; b = 0
    if c > en: a -= (c - en); c = en
    if d > boy: b -= (d - boy); d = boy
    return max(0, a), max(0, b), min(en, c), min(boy, d)


def kaydet(ham: bytes, lekeler: list[dict[str, Any]], tur: str,
           kamera: str = "", ek: dict[str, Any] | None = None) -> dict[str, Any]:
    """Kareden lekelerin kesitlerini `veri/<tur>/` altına yazar."""
    tur = (tur or "").strip().lower()
    if not AD_DESENI.match(tur):
        return {"ok": False, "mesaj": "Tür adı geçersiz — küçük harf, "
                                      "rakam, tire ve alt çizgi, 2-40 karakter."}
    if not lekeler:
        return {"ok": False, "mesaj": "Kaydedilecek leke yok."}
    try:
        from PIL import Image
    except Exception as hata:                           # noqa: BLE001
        return {"ok": False, "mesaj": f"Pillow yok: {hata}"}

    kok = _kok()
    os.makedirs(kok, exist_ok=True)
    if _boyut(kok) >= AZAMI_BAYT:
        return {"ok": False,
                "mesaj": f"Veri klasörü {AZAMI_BAYT // (1024*1024)} MB sınırına "
                         f"ulaştı — yazma durdu. Eski kayıtları elle taşıyın."}

    try:
        im = Image.open(io.BytesIO(ham)).convert("RGB")
    except Exception as hata:                           # noqa: BLE001
        return {"ok": False, "mesaj": f"Kare çözülemedi: {hata}"}

    klasor = os.path.join(kok, tur)
    os.makedirs(klasor, exist_ok=True)
    kunye = os.path.join(kok, "kunye.jsonl")
    damga = time.time()
    yazilan, atlanan = 0, 0
    with open(kunye, "a", encoding="utf-8") as kf:
        for i, l in enumerate(lekeler):
            kutu = l.get("kutu")
            if not (isinstance(kutu, (list, tuple)) and len(kutu) == 4):
                atlanan += 1
                continue
            a, b, c, d = _kare_kutu(kutu, im.width, im.height)
            if c - a < 8 or d - b < 8:
                atlanan += 1
                continue
            ad = f"{kamera or 'kam'}_{damga:.3f}_{i}.jpg"
            kesit = im.crop((a, b, c, d)).resize(
                (KESIT_BOYU, KESIT_BOYU), Image.BILINEAR)
            kesit.save(os.path.join(klasor, ad), "JPEG", quality=92)
            kf.write(json.dumps({
                "dosya": f"{tur}/{ad}", "tur": tur, "kamera": kamera,
                "ts": damga, "kutu": [a, b, c, d], "leke": l.get("no", i),
                "kare_px": [im.width, im.height], **(ek or {}),
            }, ensure_ascii=False) + "\n")
            yazilan += 1
    return {"ok": True, "yazilan": yazilan, "atlanan": atlanan, "tur": tur,
            "klasor": klasor, "toplam_bayt": _boyut(kok)}


def sayim() -> dict[str, Any]:
    """Tür başına kesit sayısı — eğitime hazır mı sorusunun cevabı."""
    kok = _kok()
    if not os.path.isdir(kok):
        return {"kok": kok, "turler": {}, "toplam": 0}
    t: dict[str, int] = {}
    for ad in sorted(os.listdir(kok)):
        d = os.path.join(kok, ad)
        if os.path.isdir(d):
            t[ad] = len([f for f in os.listdir(d) if f.endswith(".jpg")])
    return {"kok": kok, "turler": t, "toplam": sum(t.values()),
            "bayt": _boyut(kok)}
