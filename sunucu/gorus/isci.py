"""
isci — tarama işinin ayrı süreçte koşan parçası.

Neden ayrı modül: işçi fonksiyonu `api.py`'de dursaydı, çocuk süreç onu
çözmek için `gorus.api`'yi ve dolayısıyla FastAPI'yi import etmek zorunda
kalırdı. Burada yalnız OpenCV/numpy zinciri var.

Neden `spawn`: uvicorn çok iş parçacıklı bir süreçtir; iş parçacığı varken
`fork` etmek Python 3.12+'da uyarı veriyor ve kilitlenme üretebiliyor.
Havuz `multiprocessing.get_context("spawn")` ile kuruluyor, bu yüzden
argümanlar ve dönüş değeri turşulanabilir (picklable) olmak zorunda —
aşağıdaki imza buna göre sade tutuldu: yollar ve düz sözlükler.
"""

from __future__ import annotations

from pathlib import Path


def tarama_isi(kare_yolu: str, kayit_sozlukleri: list[dict],
               iz_sozlukleri: list[dict], ayar_yolu: str | None = None) -> dict:
    """
    Döner: JSON'a çevrilebilir sonuç sözlüğü + üretilen görsellerin yolları.
    İçeride hata olursa istisna yukarı çıkar; çağıran 500 yerine anlamlı
    mesaj üretebilsin diye burada yutulmaz.
    """
    import cv2

    from .ayarlar import Ayarlar
    from .boru import Tarama
    from .eslestir import EkimKaydi
    from .izle import Iz
    from . import cizim

    ayar = Ayarlar.yukle(ayar_yolu)
    t = Tarama(ayar)
    kayitlar = [EkimKaydi(**k) for k in kayit_sozlukleri]
    izler = [Iz(**i) for i in iz_sozlukleri]

    s = t.calistir(kare_yolu, kayitlar=kayitlar, izler=izler)

    kok = Path(kare_yolu)
    gorsel_yolu = kok.with_suffix(".gorsel.jpg")
    t.gorsel_kaydet(s, gorsel_yolu)

    # Ortorektifiye (üstten) görünüm — Bahçe sekmesinin altlığı ve
    # kalibrasyonun görsel kanıtı.
    ustten_yolu = None
    ham = cv2.imread(str(kare_yolu), cv2.IMREAD_COLOR)
    if ham is not None and s.get("_nesneler") is not None:
        hedef = ayar.kare.isleme_genisligi
        o = hedef / ham.shape[1]
        kucuk = cv2.resize(ham, (hedef, int(round(ham.shape[0] * o))),
                           interpolation=cv2.INTER_AREA)
        D = t._duzlem((kucuk.shape[1], kucuk.shape[0]))
        ortho, mmf = cizim.ustten_gorunum(kucuk, D, px_mm=2.0)
        ortho = cizim.ustten_tespitler(ortho, mmf, s["_nesneler"], s["_kararlar"],
                                       px_mm=2.0, yatak_mm=D.yatak_mm)
        ustten_yolu = kok.with_suffix(".ustten.jpg")
        cv2.imwrite(str(ustten_yolu), ortho, [cv2.IMWRITE_JPEG_QUALITY, 88])

    for k in ("gorsel", "_nesneler", "_kararlar"):
        s.pop(k, None)
    s["gorsel_yolu"] = str(gorsel_yolu)
    s["ustten_yolu"] = str(ustten_yolu) if ustten_yolu else None
    return s


# --------------------------------------------------------------------------
# Komut satırı arayüzü.
#
# Neden multiprocessing havuzu değil de açık alt süreç:
#   ÖLÇÜLDÜ — hem `spawn` hem `forkserver`, çocuk süreçte ebeveynin `__main__`
#   modülünü yeniden çalıştırıyor (`spawn._main -> _fixup_main_from_path`).
#   Sunucu `python main.py` ile açılıyorsa her tarama sunucuyu bir kez daha
#   başlatmaya kalkar. `fork` ise uvicorn'un iş parçacıklarıyla birlikte
#   kilitlenme riski taşıyor.
#   Açık alt süreçte bu tuzakların hiçbiri yok: iş dosyadan okunur, sonuç
#   dosyaya yazılır, ebeveynin ne modülü ne de durumu çocuğa taşınır.
#   Ayrıca OpenCV içinde bir çökme sunucuyu değil yalnız bu süreci düşürür.
#
#   python -m gorus.isci <is.json> <sonuc.json>
#
# is.json: {"kare_yolu":..., "kayitlar":[...], "izler":[...], "ayar_yolu":...}
# --------------------------------------------------------------------------

def _cli(argv=None) -> int:
    import json
    import sys
    import traceback

    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 2:
        print("kullanim: python -m gorus.isci <is.json> <sonuc.json>",
              file=sys.stderr)
        return 2
    is_yolu, sonuc_yolu = argv
    try:
        gorev = json.loads(Path(is_yolu).read_text("utf-8"))
        s = tarama_isi(gorev["kare_yolu"], gorev.get("kayitlar") or [],
                       gorev.get("izler") or [], gorev.get("ayar_yolu"))
        Path(sonuc_yolu).write_text(
            json.dumps({"tamam": True, "sonuc": s}, ensure_ascii=False,
                       default=str), "utf-8")
        return 0
    except Exception as e:
        Path(sonuc_yolu).write_text(json.dumps(
            {"tamam": False, "hata": f"{type(e).__name__}: {e}",
             "iz": traceback.format_exc()}, ensure_ascii=False), "utf-8")
        print(traceback.format_exc(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(_cli())
