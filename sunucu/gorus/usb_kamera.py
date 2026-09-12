"""
usb_kamera — UVC (USB) kamera sürücüsü. Logitech MX Brio için yazıldı,
her UVC kamerada çalışır.

CSI kameradan farkları ve tuzakları:

  * İLK KARELER ÇÖPTÜR. Kamera açıldıktan sonra otomatik pozlama/odak birkaç
    kare boyunca oturur. Isınma kareleri atılmazsa kalibrasyon karesi
    yanlış pozlamayla çekilir. `isinma_kare` bunu yapar.
  * İSTEDİĞİNİZ ÇÖZÜNÜRLÜĞÜ ALDIĞINIZI VARSAYMAYIN. OpenCV, desteklenmeyen
    bir boyut istendiğinde sessizce en yakınına düşer. Her açılışta gerçekte
    ne geldiği ÖLÇÜLÜR ve uyuşmazsa hata verilir — 4K sandığınız kare
    1080p ise homografi iki kat yanlış olur.
  * FOURCC, çözünürlükten ÖNCE ayarlanmalı. MJPG olmadan 4K@30 USB
    bant genişliğine sığmaz; YUYV'de kamera 5 fps'e düşer ya da hiç açılmaz.
  * CİHAZ ADI KAYAR. /dev/video0 yeniden takılınca video2 olabilir.
    Her zaman /dev/v4l/by-id/... yolunu kullanın (`listele()` yazdırır).
  * OTOMATİK ODAK KALİBRASYONU BOZAR. Odak değişince görüş açısı da değişir.
    `kilitle()` kapatmayı dener ve NE OLDUĞUNU geri okuyup raporlar —
    "kapattım" demez, kapandı mı ölçer.

MX Brio'ya özel not: görüş açısı anahtarı (65/78/90°) Linux'ta v4l2'den
ayarlanamıyor, yalnız Windows/Mac'teki Logi Options+'tan. Bu yüzden montaj
yüksekliğini kâğıt üstünde hesaplamayın; kamerayı asın, kare çekin, yatak
kadraja sığıyor mu bakın. Gerçek ölçeği zaten kalibrasyon ölçüyor.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from pathlib import Path

import cv2

# Ölçüm için kilitlenecek kontroller. Kamera desteklemiyorsa atlanır ve
# raporda "tamam: False" olarak görünür — sessizce geçilmez.
#
# MX Brio'da ölçülen durum (v4l2-ctl --list-ctrls):
#   * focus_automatic_continuous YOK. Otomatik odak anahtarı açılmıyor;
#     focus_absolute'a değer yazmak çoğu Logitech'te otomatiği kapatır.
#     Gerçekten kapandığını `gorus.kamera_denetim` ölçer.
#   * zoom_absolute YOK — görüş açısı (65/78/90°) Linux'tan değiştirilemiyor.
#   * pan_absolute / tilt_absolute VAR. Bunlar sensör içinde dijital kaydırma
#     yapar; sıfırdan farklıysa kadraj kayar ve KALİBRASYON BOZULUR.
#     Bu yüzden açıkça 0'a sabitleniyorlar.
#   * power_line_frequency varsayılanı 2 (60 Hz). Türkiye 50 Hz — yanlış
#     değer LED/floresan altında bant (flicker) üretir ve yeşil eşiğini
#     kare kare oynatır. 1'e çekiliyor.
#   * backlight_compensation varsayılanı 1 (açık). Kamera arka plandaki
#     parlaklığa göre pozlamayı oynatır; kapatılıyor.
#   * contrast/saturation/sharpness fabrika değerleri "yüz güzel görünsün"
#     diye yükseltilmiş (150/132/145). Ölçümde doğrusal olmayan bu
#     müdahaleler istenmez; nötr 128'e çekiliyorlar.
VARSAYILAN_KONTROLLER = {
    "auto_exposure": 1,                    # 1 = manuel, 3 = otomatik (Aperture Priority)
    "white_balance_automatic": 0,
    "backlight_compensation": 0,
    "exposure_dynamic_framerate": 0,       # kare hızı pozlamaya göre düşmesin
    "power_line_frequency": 1,             # 1 = 50 Hz (Türkiye), 2 = 60 Hz
    "pan_absolute": 0,                     # dijital kaydırma kapalı kalmalı
    "tilt_absolute": 0,
    "contrast": 128,
    "saturation": 128,
    "sharpness": 128,
    "brightness": 128,
}

# Bu kameralarda otomatik odak anahtarı yok; odak doğrudan yazılır.
ODAK_KONTROLU = "focus_absolute"


def _v4l2(*args) -> tuple[int, str]:
    if not shutil.which("v4l2-ctl"):
        return 127, "v4l2-ctl kurulu değil (sudo apt install v4l-utils)"
    p = subprocess.run(["v4l2-ctl", *args], capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()


def listele() -> dict:
    """Takılı UVC kameralar, kararlı yolları, biçimleri ve kontrolleri."""
    out = {"cihazlar": [], "by_id": []}
    d = Path("/dev/v4l/by-id")
    if d.exists():
        out["by_id"] = sorted(str(p) for p in d.iterdir())
    kod, metin = _v4l2("--list-devices")
    out["list_devices"] = metin
    for yol in out["by_id"]:
        bilgi = {"yol": yol}
        _, bilgi["bicimler"] = _v4l2("-d", yol, "--list-formats-ext")
        _, bilgi["kontroller"] = _v4l2("-d", yol, "--list-ctrls")
        out["cihazlar"].append(bilgi)
    return out


def _kontrol_oku(yol, ad):
    kod, metin = _v4l2("-d", yol, "-C", ad)
    if kod != 0 or ":" not in metin:
        return None
    try:
        return int(metin.split(":")[-1].strip())
    except ValueError:
        return None


def kilitle(yol, kontroller: dict | None = None) -> dict:
    """
    Otomatik pozlama / beyaz denge / odağı kapatmayı dener ve SONUCU ÖLÇER.
    Döner: {ad: {"istenen":.., "gercek":.., "tamam": bool, "sebep": ..}}
    """
    kontroller = {**VARSAYILAN_KONTROLLER, **(kontroller or {})}
    rapor = {}
    for ad, deger in kontroller.items():
        if deger is None:
            continue
        kod, metin = _v4l2("-d", yol, "-c", f"{ad}={deger}")
        gercek = _kontrol_oku(yol, ad)
        rapor[ad] = {
            "istenen": deger, "gercek": gercek,
            "tamam": gercek == deger,
            "sebep": None if kod == 0 else metin.splitlines()[0][:90],
        }
    return rapor


def poz_ogren(yol, bekleme_s: float = 4.0) -> dict:
    """
    Pozlama ve beyaz dengeyi bir kez OTOMATİĞE bırakıp, kameranın yakınsadığı
    değerleri okuyup kilitler. Doğru sıra budur: elle bir sayı uydurmak yerine
    kameranın sahnede bulduğu değeri sabitliyoruz.

    v4l2'de auto açıkken `exposure_time_absolute` ve
    `white_balance_temperature` "inactive" görünür ama OKUNABİLİR — otomatiğin
    seçtiği değer odur.

    Kamerayı yatağa bakar durumda, normal ışığında çalıştırın.
    """
    _v4l2("-d", yol, "-c", "auto_exposure=3")
    _v4l2("-d", yol, "-c", "white_balance_automatic=1")
    # Kameranın kendi kendine oturması için akış açık olmalı.
    cap = cv2.VideoCapture(str(yol), cv2.CAP_V4L2)
    try:
        if not cap.isOpened():
            raise RuntimeError(f"Kamera açılamadı: {yol}")
        t0 = time.time()
        while time.time() - t0 < bekleme_s:
            cap.grab()
            time.sleep(0.05)
        poz = _kontrol_oku(yol, "exposure_time_absolute")
        wb = _kontrol_oku(yol, "white_balance_temperature")
        kazanc = _kontrol_oku(yol, "gain")
    finally:
        cap.release()

    if poz is None:
        raise RuntimeError("exposure_time_absolute okunamadı; bu kamerada "
                           "pozlama kilitlenemiyor olabilir.")

    ogrenilen = {"exposure_time_absolute": poz}
    if wb is not None:
        ogrenilen["white_balance_temperature"] = wb
    if kazanc is not None:
        ogrenilen["gain"] = kazanc

    # Önce otomatikleri kapat, sonra öğrenilen değerleri yaz (sıra önemli:
    # auto açıkken absolute kontroller inactive olduğu için yazılmaz).
    rapor = kilitle(yol)
    rapor.update(kilitle(yol, ogrenilen))
    return {"ogrenilen": ogrenilen, "kilit": rapor,
            "kilitlenemeyen": [a for a, r in rapor.items() if not r["tamam"]]}


def odak_kilitle(yol, deger: int | None = None) -> dict:
    """
    MX Brio'da `focus_automatic_continuous` yok; odak `focus_absolute`'a
    yazılarak sabitlenir. Değer verilmezse kameranın o anki odağı okunup
    aynısı geri yazılır — sahnede zaten odaklanmış haldeyse doğru olan budur.
    """
    mevcut = _kontrol_oku(yol, ODAK_KONTROLU)
    if deger is None:
        deger = mevcut
    if deger is None:
        return {"tamam": False, "sebep": f"{ODAK_KONTROLU} okunamıyor — "
                                         "bu kamerada odak kilitlenemiyor",
                "mevcut": None, "istenen": None, "gercek": None}
    kod, metin = _v4l2("-d", yol, "-c", f"{ODAK_KONTROLU}={int(deger)}")
    gercek = _kontrol_oku(yol, ODAK_KONTROLU)
    return {"tamam": gercek == int(deger), "mevcut": mevcut,
            "istenen": int(deger), "gercek": gercek,
            "sebep": None if kod == 0 else metin.splitlines()[0][:90],
            "not": "Otomatik odağın gerçekten durduğunu yalnız "
                   "gorus.kamera_denetim ölçebilir."}


class UsbKamera:
    """
    Kullanım:
        k = UsbKamera("/dev/v4l/by-id/usb-046d_MX_Brio-video-index0",
                      genislik=3840, yukseklik=2160)
        bilgi = k.hazirla()          # açar, kilitler, ne aldığını ölçer
        k.cek("/veri/kareler/tarama.jpg")
        k.kapat()

    7/24 için: her çekimde aç-kapa yapın (`tek_seferlik=True`). Kamerayı
    saatlerce açık tutmak USB kopmalarında sürücüyü kilitli bırakabiliyor;
    açılış bedeli ~1 sn, tarama başına bir kez ödenir.
    """

    def __init__(self, yol, genislik=3840, yukseklik=2160, fourcc="MJPG",
                 isinma_kare=8, kontroller=None, tek_seferlik=True):
        self.yol = str(yol)
        self.istenen = (int(genislik), int(yukseklik))
        self.fourcc = fourcc
        self.isinma_kare = int(isinma_kare)
        self.kontroller = kontroller
        self.tek_seferlik = tek_seferlik
        self.cap = None
        self.gercek = None

    def hazirla(self) -> dict:
        if not Path(self.yol).exists():
            raise RuntimeError(
                f"Kamera yok: {self.yol}\n"
                "Kararlı yolu `python -m gorus.usb_kamera --listele` ile bulun.")

        kilit = kilitle(self.yol, self.kontroller)

        cap = cv2.VideoCapture(self.yol, cv2.CAP_V4L2)
        if not cap.isOpened():
            raise RuntimeError(f"Kamera açılamadı: {self.yol}")
        # SIRA ÖNEMLİ: önce sıkıştırma, sonra çözünürlük.
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*self.fourcc))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.istenen[0])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.istenen[1])
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)     # bayat kare gelmesin

        for _ in range(max(self.isinma_kare, 1)):
            cap.grab()
            time.sleep(0.05)
        ok, kare = cap.read()
        if not ok or kare is None:
            cap.release()
            raise RuntimeError("Kamera açıldı ama kare vermedi "
                               "(bant genişliği ya da biçim uyuşmazlığı olabilir)")

        self.cap = cap
        self.gercek = (kare.shape[1], kare.shape[0])
        bilgi = {
            "yol": self.yol,
            "istenen_cozunurluk": list(self.istenen),
            "gercek_cozunurluk": list(self.gercek),
            "cozunurluk_tamam": self.gercek == self.istenen,
            "fourcc": self.fourcc,
            "kilit": kilit,
            "kilitlenemeyen": [a for a, r in kilit.items() if not r["tamam"]],
        }
        if not bilgi["cozunurluk_tamam"]:
            self.kapat()
            raise RuntimeError(
                f"İstenen {self.istenen[0]}x{self.istenen[1]}, gelen "
                f"{self.gercek[0]}x{self.gercek[1]}. Kalibrasyon bu farkı "
                "sessizce yutmaz — `--listele` ile desteklenen boyutlara bakın "
                "(MJPG satırları).")
        return bilgi

    def kare_al(self):
        if self.cap is None:
            self.hazirla()
        for _ in range(2):                 # kuyruktakini at, tazesini al
            self.cap.grab()
        ok, kare = self.cap.read()
        if not ok or kare is None:
            raise RuntimeError("Kare alınamadı (kamera koptu?)")
        return kare

    def cek(self, hedef, kalite=92) -> dict:
        kare = self.kare_al()
        hedef = Path(hedef)
        hedef.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(hedef), kare, [cv2.IMWRITE_JPEG_QUALITY, int(kalite)])
        if self.tek_seferlik:
            self.kapat()
        return {"yol": str(hedef), "boyut": hedef.stat().st_size,
                "cozunurluk": [kare.shape[1], kare.shape[0]]}

    def kapat(self):
        if self.cap is not None:
            self.cap.release()
            self.cap = None

    def __enter__(self):
        self.hazirla(); return self

    def __exit__(self, *a):
        self.kapat()


# ------------------------------------------------------------------ CLI

def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m gorus.usb_kamera")
    p.add_argument("--listele", action="store_true",
                   help="takılı kameralar, kararlı yollar, biçimler, kontroller")
    p.add_argument("--cihaz", default=None, help="/dev/v4l/by-id/... yolu")
    p.add_argument("--cek", default=None, metavar="HEDEF.jpg")
    p.add_argument("--seri", type=int, default=0, metavar="N",
                   help="kabul testi için N kare, --aralik saniye arayla")
    p.add_argument("--aralik", type=float, default=300.0, metavar="SN")
    p.add_argument("--genislik", type=int, default=3840)
    p.add_argument("--yukseklik", type=int, default=2160)
    p.add_argument("--isinma", type=int, default=8)
    p.add_argument("--ogren", action="store_true",
                   help="pozlama/beyaz dengeyi otomatiğe bırakıp öğren ve kilitle")
    p.add_argument("--odak", type=int, default=None, metavar="DEGER",
                   help="focus_absolute değeri; verilmezse mevcut odak sabitlenir")
    a = p.parse_args(argv)

    if a.listele or not a.cihaz:
        bilgi = listele()
        print("KARARLI CİHAZ YOLLARI (bunu kullanın, /dev/video0'ı değil):")
        for y in bilgi["by_id"] or ["  (yok — kamera takılı mı?)"]:
            print(f"  {y}")
        print("\n--list-devices:\n" + (bilgi["list_devices"] or "(boş)"))
        for c in bilgi["cihazlar"]:
            print(f"\n=== {c['yol']} ===")
            mjpg = [s for s in c["bicimler"].splitlines()
                    if "MJPG" in s or "Size:" in s or "Interval" in s]
            print("BİÇİMLER (MJPG satırlarına bakın):")
            print("\n".join(mjpg[:40]) or c["bicimler"][:800])
            print("\nKONTROLLER:")
            print(c["kontroller"][:1600])
            print("\n→ Şunları arayın: auto_exposure, white_balance_automatic,")
            print("  focus_automatic_continuous, focus_absolute.")
            print("  focus_* yoksa odak kilitlenemiyor demektir; bunu bilerek")
            print("  ilerleyin, kalibrasyon her taramada yeniden doğrulanıyor.")
        if not a.cihaz:
            return 0

    if a.ogren:
        print("Pozlama öğreniliyor (kamera yatağa baksın, normal ışıkta)...")
        r = poz_ogren(a.cihaz)
        print(json.dumps(r["ogrenilen"], indent=2))
        if r["kilitlenemeyen"]:
            print(f"kilitlenemeyen: {r['kilitlenemeyen']}")
        o = odak_kilitle(a.cihaz, a.odak)
        print("odak:", json.dumps(o, indent=2, ensure_ascii=False))
        print("\nBu değerler kamerada kalır; her açılışta kilitle() yine uygular.")

    kam = UsbKamera(a.cihaz, a.genislik, a.yukseklik, isinma_kare=a.isinma,
                    tek_seferlik=False)
    bilgi = kam.hazirla()
    print(json.dumps(bilgi, indent=2, ensure_ascii=False))
    if bilgi["kilitlenemeyen"]:
        print(f"\nUYARI: kilitlenemeyen kontroller: {bilgi['kilitlenemeyen']}")
        print("Bunlar otomatik kalırsa eşikler ve odak kayar; "
              "python -m gorus.kamera_denetim ile ne kadar kaydığını ölçün.")

    if a.seri > 0:
        hedef_diz = Path(a.cek or "denetim/kare.jpg").parent
        print(f"\n{a.seri} kare, {a.aralik:g} sn arayla -> {hedef_diz}")
        for i in range(a.seri):
            r = kam.cek(hedef_diz / f"{i:03d}.jpg")
            print(f"  {i+1}/{a.seri}  {r['yol']}  {r['boyut']//1024} KB")
            if i < a.seri - 1:
                time.sleep(a.aralik)
        print("\nŞimdi: python -m gorus.kamera_denetim "
              f"{hedef_diz}/*.jpg")
    elif a.cek:
        print(json.dumps(kam.cek(a.cek), indent=2, ensure_ascii=False))
    kam.kapat()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
