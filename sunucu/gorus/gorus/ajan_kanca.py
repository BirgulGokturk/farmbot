"""
ajan_kanca — AJAN tarafına eklenecek parça (kamera sahibi ajan'dır, öyle kalır).

Mevcut yapı: ajan/kamera.py içindeki Kamera sınıfı picamera2 -> rpicam-still ->
sahte kare sırasıyla deniyor ve 640 px'lik JPEG'i WebSocket ile sunucuya
yolluyor. Görüntü işleme için iki eksik var:

  1) 640 px yetmez. Kalibrasyon 3840x2880'de yapıldı; tespit karesi tam ya da
     yarı çözünürlükte olmalı. WebSocket'ten 3-5 MB base64 geçirmek yerine,
     ajan ve sunucu AYNI Pi'de olduğu için kare ORTAK DİZİNE yazılır ve
     sadece yol duyurulur.
  2) Otomatik pozlama/beyaz denge açıkken eşikler kayıyor. Tespit karesi
     kilitli pozlamayla çekilmelidir.

ajan.py'nin komut çözücüsüne tek satır eklenir:
    elif komut == "kare_cek":
        cevap = await kare_cek(kamera, mesaj, portal)
"""

from __future__ import annotations

import asyncio
import datetime as dt
from pathlib import Path

KARE_DIZINI = Path("/home/batupi/farmbot/veri/kareler")


def poz_kilitle(picam2, sure_us=None, kazanc=None, renk_kazanclari=None):
    """
    Tespit karesi için otomatik pozlama/AWB kapatılır. Değerler bir kez
    ölçülür (aşağıdaki `poz_ogren`) ve kalibrasyon dosyasının yanında saklanır.
    """
    ayar = {"AeEnable": False, "AwbEnable": False}
    if sure_us:
        ayar["ExposureTime"] = int(sure_us)
    if kazanc:
        ayar["AnalogueGain"] = float(kazanc)
    if renk_kazanclari:
        ayar["ColourGains"] = tuple(float(x) for x in renk_kazanclari)
    picam2.set_controls(ayar)


def poz_ogren(picam2, bekleme_s=2.0) -> dict:
    """Otomatiği bir kez çalıştırıp yakınsadığı değerleri okur ve kilitler."""
    import time
    picam2.set_controls({"AeEnable": True, "AwbEnable": True})
    time.sleep(bekleme_s)
    m = picam2.capture_metadata()
    d = {"sure_us": int(m.get("ExposureTime", 0)),
         "kazanc": float(m.get("AnalogueGain", 1.0)),
         "renk_kazanclari": list(m.get("ColourGains", (1.0, 1.0)))}
    poz_kilitle(picam2, **d)
    return d


async def kare_cek(kamera, mesaj: dict, portal=None) -> dict:
    """
    Sunucudan gelen {"komut":"kare_cek","genislik":3840,"portal_park":true}
    komutunu karşılar.

    portal_park: Portal yatağın üstündeyse kadrajı kapatır ve gölge düşürür.
    Kare çekmeden önce portal park konumuna sürülür ve DURDUĞU DOĞRULANIR.
    Bu adım atlanırsa tespitlerin yarısı portalın altında kaybolur — sistemin
    "çalışmıyor" görünmesinin sık bir sebebi budur.
    """
    genislik = int(mesaj.get("genislik", 3840))
    etiket = str(mesaj.get("etiket", "tarama"))

    if mesaj.get("portal_park") and portal is not None:
        try:
            await portal.park_et()
            await portal.hareketsiz_bekle(zaman_asimi=20.0)
            await asyncio.sleep(0.7)          # titreşim sönümü
        except Exception as e:
            return {"tamam": False, "hata": f"portal park edilemedi: {e}"}

    KARE_DIZINI.mkdir(parents=True, exist_ok=True)
    ad = f"{etiket}_{dt.datetime.now():%Y%m%d_%H%M%S}_{genislik}.jpg"
    yol = KARE_DIZINI / ad
    try:
        # Kamera.cek(...) mevcut sınıfınızın yöntemi; genişlik ve hedef dosya
        # alacak şekilde genişletilir. Tek kamera sahibi yine ajan'dır.
        bilgi = await asyncio.to_thread(kamera.cek, genislik=genislik,
                                        hedef=str(yol), kalite=92)
    except Exception as e:
        return {"tamam": False, "hata": f"çekim başarısız: {e}"}

    if not yol.exists() or yol.stat().st_size < 10_000:
        return {"tamam": False, "hata": "kare yazılamadı ya da boş"}

    return {"tamam": True, "yol": str(yol), "boyut": yol.stat().st_size,
            "zaman": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "kamera": bilgi if isinstance(bilgi, dict) else None}


def eski_kareleri_temizle(gun: int = 21, en_az_birak: int = 50) -> int:
    """Kare deposu SD kartı doldurmasın. Eğitim verisi olanları elle ayırın."""
    import time
    if not KARE_DIZINI.exists():
        return 0
    kareler = sorted(KARE_DIZINI.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
    sinir = time.time() - gun * 86400
    silinen = 0
    for p in kareler[:-en_az_birak] if len(kareler) > en_az_birak else []:
        if p.stat().st_mtime < sinir:
            p.unlink(); silinen += 1
    return silinen
