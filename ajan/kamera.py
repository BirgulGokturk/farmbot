"""Kamera — Pi'den periyodik kare. Birden çok kamera olabilir.

Makinede iki kamera var ve ikisi AYNI ŞEYİ görmüyor:

  * **uç kamerası** — uç kafasına bağlı, yatağa yakın, MAKİNEYLE BİRLİKTE
    hareket ediyor. Karenin çekildiği X/Y biliniyor, bu yüzden karedeki bir
    leke yatağın bir koordinatına çevrilebiliyor.
  * **üst kamera** — sabit bir direkte, yatağın tamamını uzaktan görüyor.
    HAREKET ETMİYOR; makinenin o anki konumu bu karenin neresini gösterdiği
    hakkında hiçbir şey söylemiyor. Bu yüzden bu kameranın karelerine makine
    konumu YAZILMIYOR (bkz. `hareketli`).

Her kameranın kendi iş parçacığı, kendi hata sayacı ve kendi ayarı var:
biri arızalanınca ötekinin durmaması bunun sonucu, ayrı bir önlem değil.

Kare yakalama şu yollardan denenir, ilk çalışan kullanılır:

  1. **picamera2** — Raspberry Pi kamera modülü (şerit kablo). Bookworm'ün
     önerdiği kütüphane.
  2. **rpicam-still / libcamera-still** — komut satırı araçları. Bookworm'de
     `libcamera-still` yerini `rpicam-still`e bıraktı; ikisi de aranıyor.
     picamera2'nin kurulu olmadığı sistemler için.
  2b. **fswebcam / ffmpeg** — USB webcam yolu. `rpicam-*` şerit kablodaki
     kamerayı sürüyor, USB kamerayı DEĞİL; USB için ayrı yol gerekiyor.

     Not: `pi-kur.sh` sanal ortamı `--system-site-packages` olmadan kurarsa
     apt ile gelen `python3-picamera2` venv'in içinden GÖRÜNMEZ ve 1. yol
     sessizce elenir. Bu yüzden komut satırı yolu bir yedek değil, Pi kamera
     modülünde de fiilen ana yol olabiliyor — ve tek kare için işlem açmak
     30 saniyede bir için tamamen yeterli.
  3. **sahte** — donanım olmadan paneli denemek için üretilen kare.

Neden JPEG ve neden küçük: kare WebSocket üzerinden sunucuya gidiyor ve orada
saklanıyor. 1640x1232 ham bir kare 6 MB; 640 piksel genişliğinde JPEG ~40 KB.
Panelde bitki görmek için bu fazlasıyla yeterli, ağ ve disk ise rahat ediyor.

Kare aralığı varsayılan olarak uzun (bir saat): bu bir güvenlik kamerası
değil, "bitkiler nasıl" sorusunun cevabı. Panelden kısaltılabiliyor; en
kısası 2 saniye. Kısa aralıkta kamera yetişemeyebilir — o durumda döngü
yavaşlamayı sessizce yutmuyor, günlüğe yazıyor.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from typing import Any, Callable

logger = logging.getLogger("ajan.kamera")

#: JPEG kare sınırları. MJPEG akışı arka arkaya eklenmiş JPEG'lerden ibaret;
#: nerede başlayıp bittiğini bu iki işaret söylüyor (SOI ve EOI).
JPEG_BAS = bytes([0xFF, 0xD8])
JPEG_SON = bytes([0xFF, 0xD9])

VARSAYILAN = {
    "ad": "uc",                 # kısa kimlik — kareler ve kalibrasyon buna bağlı
    "etiket": "Uç kamerası",    # panelde görünen ad
    # HAREKET EDİYOR MU. Uç kamerası makineyle gidiyor, karenin çekildiği
    # X/Y anlamlı. Sabit kamera gitmiyor; ona makine konumu yazmak, kareyi
    # yatağın rastgele bir yerine koymak demek — yanlış ve sessiz.
    "hareketli": True,
    "aktif": False,
    "aralik_sn": 3600.0,   # saatte bir kare
    "genislik": 640,
    "kalite": 75,
    "sahte": False,
    # CİHAZ YOLU SABİT YAZILMIYOR. USB kamera bugün /dev/video8'de ama
    # çıkarılıp takılınca numara değişiyor. `cihaz_adi` doluysa her açılışta
    # ADINDAN bulunuyor; `cihaz` yalnızca ad bulunamazsa kullanılan yedek.
    "cihaz": "",
    "cihaz_adi": "",
    # "oto" | "pi" (picamera2/rpicam) | "usb" (fswebcam/ffmpeg) | "sahte"
    "yol": "oto",
}

#: Kamera adında yalnız bunlar: ad hem dosya yolu (kareler/<ad>/) hem de
#: kalibrasyon anahtarı oluyor.
AD_HARFLERI = set("abcdefghijklmnopqrstuvwxyz0123456789_-")

V4L2_KOK = "/sys/class/video4linux"


def ad_temizle(ham: Any, varsayilan: str = "uc") -> str:
    metin = "".join(h for h in str(ham or "").strip().lower() if h in AD_HARFLERI)
    return metin[:24] or varsayilan


def _dosya_oku(yol: str) -> str:
    try:
        with open(yol, encoding="utf-8", errors="replace") as dosya:
            return dosya.read().strip()
    except OSError:
        return ""


def v4l2_cihazlar() -> list[dict[str, Any]]:
    """Sistemdeki video düğümleri — [{"yol","no","ad","index"}].

    `v4l2-ctl` çağırmıyoruz: kurulu olmayabiliyor ve gereken her şey
    sysfs'te zaten yazılı. `index`, aynı kameranın düğümleri arasında
    hangisinin görüntü verdiğini söylüyor (UVC kameralar bir de meta veri
    düğümü açıyor; onun indeksi 0 değil).
    """
    try:
        adlar = os.listdir(V4L2_KOK)
    except OSError:
        return []
    cikti: list[dict[str, Any]] = []
    for dugum in adlar:
        if not dugum.startswith("video"):
            continue
        try:
            no = int(dugum[5:])
        except ValueError:
            continue
        ham_index = _dosya_oku(os.path.join(V4L2_KOK, dugum, "index"))
        cikti.append({
            "yol": f"/dev/{dugum}",
            "no": no,
            "ad": _dosya_oku(os.path.join(V4L2_KOK, dugum, "name")),
            "index": int(ham_index) if ham_index.isdigit() else 0,
        })
    cikti.sort(key=lambda c: c["no"])
    return cikti


def cihaz_bul(cihaz_adi: str, yedek: str = "") -> tuple[str, str]:
    """Kamerayı ADINDAN bulur -> (yol, açıklama).

    Yol bulunamazsa ilk eleman boş ve açıklama NEDEN bulunamadığını
    söylüyor — "kamera hatası" diye içi boş bir mesaj bırakmıyoruz.
    """
    hepsi = v4l2_cihazlar()
    aranan = str(cihaz_adi or "").strip().casefold()
    if aranan:
        eslesen = [c for c in hepsi if aranan in (c["ad"] or "").casefold()]
        if eslesen:
            # Görüntü düğümü önce: index 0 olanlar, sonra numara sırası.
            eslesen.sort(key=lambda c: (c["index"] != 0, c["no"]))
            secili = eslesen[0]
            return secili["yol"], f"'{secili['ad']}' → {secili['yol']}"
        varsa = ", ".join(f"{c['yol']} ({c['ad']})" for c in hepsi) or "hiç yok"
        if yedek and os.path.exists(yedek):
            return yedek, (f"'{cihaz_adi}' adlı kamera bulunamadı, yedek yol "
                           f"{yedek} kullanılıyor. Sistemdekiler: {varsa}")
        return "", (f"'{cihaz_adi}' adlı kamera bulunamadı. Sistemdekiler: {varsa}")
    if yedek:
        if os.path.exists(yedek):
            return yedek, f"{yedek} (elle verilen yol)"
        return "", f"{yedek} yok — kamera çıkarılmış ya da numarası değişmiş olabilir"
    # Ne ad ne yol verilmiş: görüntü düğümlerinin ilkini alıyoruz.
    aday = [c for c in hepsi if c["index"] == 0]
    if aday:
        return aday[0]["yol"], f"{aday[0]['yol']} ({aday[0]['ad']}) — kendiliğinden seçildi"
    return "", "Sistemde hiç video cihazı yok"


class Kamera:
    def __init__(self, ayar: dict[str, Any],
                 gonder: Callable[[str, str, float], None],
                 gunluk_cb: Callable[[str, str], None] | None = None,
                 cikarim: Callable[[bytes, float], Any] | None = None) -> None:
        self.ayar = {**VARSAYILAN, **(ayar or {})}
        self.ayar["ad"] = ad_temizle(self.ayar.get("ad"))
        # `gonder(kamera_adi, b64, ts)` — kareyi hangi kameranın ürettiği
        # kaydın parçası. İki kamera aynı depoya yazıyor; hangisinden
        # geldiğini bilmeden ne kalibrasyon ne de konum doğru seçilebilir.
        self.gonder = gonder
        # ÇIKARIM KANCASI. Kare sunucuya GİTTİKTEN SONRA çağrılıyor ve
        # yalnızca bir kuyruğa bırakıyor — bu döngüde hiçbir şey
        # beklemiyor. Hailo kilitlenirse kamera etkilenmesin diye
        # (bkz. hailo.py); o donanımın kilitlenebildiğini sahada gördük.
        self.cikarim = cikarim
        self.gunluk_cb = gunluk_cb or (lambda m, s="bilgi": None)
        self._calisiyor = False
        # Canlı akış: periyodik kare döngüsünden AYRI bir yol. İkisi aynı
        # cihazı açamadığı için biri çalışırken diğeri duruyor.
        self._canli = False
        self._canli_fps = 5.0
        self._canli_surec = None
        self._canli_ip: threading.Thread | None = None
        self._periyodik_geri = False
        # Bekleme time.sleep degil Event.wait ile: saatlik aralikta "kapat"
        # dendiginde is parcaciginin bir saat beklemesi kabul edilemez.
        self._dur = threading.Event()
        self._yontem: str | None = None
        self._picam = None
        self.son_hata: str | None = None
        # Çözülmüş cihaz yolu ve nasıl çözüldüğü. Panelde görünüyor:
        # "video8'de sanıyordum, video6'ya taşınmış" demeyi mümkün kılıyor.
        self._cihaz: str = ""
        self.cihaz_not: str = ""

    # --- kimlik ---
    @property
    def ad(self) -> str:
        return str(self.ayar.get("ad") or "uc")

    @property
    def etiket(self) -> str:
        return str(self.ayar.get("etiket") or self.ad)

    @property
    def hareketli(self) -> bool:
        return bool(self.ayar.get("hareketli", True))

    def cihaz_coz(self, zorla: bool = False) -> str:
        """USB kamerayı adından bulur; sonucu saklar.

        `zorla` yeniden arattırıyor: kamera çıkarılıp takıldığında numara
        değişiyor ve elimizdeki yol artık başka bir cihazı ya da hiçbir şeyi
        gösteriyor. Kare alınamadığında bu yüzden yeniden çözüyoruz.
        """
        if self._cihaz and not zorla:
            return self._cihaz
        yol, aciklama = cihaz_bul(str(self.ayar.get("cihaz_adi") or ""),
                                  str(self.ayar.get("cihaz") or ""))
        if aciklama != self.cihaz_not:
            self.cihaz_not = aciklama
            self.gunluk_cb(f"[{self.etiket}] {aciklama}",
                           "bilgi" if yol else "uyari")
        self._cihaz = yol
        return yol

    # --- yakalama yolları ---
    def _picamera2_dene(self) -> bool:
        try:
            from picamera2 import Picamera2  # type: ignore
        except ImportError:
            return False
        try:
            self._picam = Picamera2()
            genislik = int(self.ayar["genislik"])
            yapilandirma = self._picam.create_still_configuration(
                main={"size": (genislik, int(genislik * 3 / 4))})
            self._picam.configure(yapilandirma)
            self._picam.start()
            time.sleep(2)   # otomatik pozlama otursun
            return True
        except Exception as hata:
            logger.warning("picamera2 açılamadı: %s", hata)
            # KAPATMADAN birakmak kamerayi kilitli birakiyordu: Picamera2()
            # basarili olup sonraki adim patlayinca nesne cihazi tutmaya devam
            # ediyor, arkasindan rpicam-still "Pipeline handler in use by
            # another process" diyor. Bu yol basarisizsa cihaz serbest kalmali.
            self._picam_kapat()
            return False

    def _picam_kapat(self) -> None:
        """picamera2 nesnesini durdurup kapatir ve birakir."""
        if self._picam is None:
            return
        for adim in ("stop", "close"):
            try:
                getattr(self._picam, adim)()
            except Exception:
                pass
        self._picam = None

    def _picamera2_kare(self) -> bytes:
        tampon = io.BytesIO()
        self._picam.capture_file(tampon, format="jpeg")
        return tampon.getvalue()

    # ------------------------------------------------------------- CANLI AKIŞ
    #
    # "5 saniyede bir kare" ile "canlı" arasındaki fark yalnızca hız değil,
    # YÖNTEM. Tek kare almak için her seferinde işlem açmak (rpicam-still)
    # kare başına 1-2 saniye demek; hızlandırarak canlıya çıkılmıyor.
    # Akış için ayrı bir yol gerekiyor:
    #
    #   picamera2  → kamera açık kalıyor, video yapılandırmasıyla art arda
    #                JPEG alınıyor.
    #   rpicam-vid → tek bir işlem sürekli MJPEG basıyor, stdout'tan
    #                JPEG'lere ayırıyoruz.
    #
    # fswebcam'in akış karşılığı yok; o yolda canlı desteklenmiyor ve bunu
    # sessizce yavaş çalışarak değil, açıkça söyleyerek belirtiyoruz.

    def canli_var_mi(self) -> bool:
        """Akış yapabilecek bir yol var mı?

        CİHAZI AÇMADAN bakıyoruz. `_yontem_sec()` picamera2'yi deneyip
        kamerayı tutuyor; bunu panelin yarım saniyede bir sorduğu `durum()`
        içinden çağırmak cihazı sürekli kilitler. Burada yalnızca aracın
        kurulu olup olmadığına bakmak yeterli.
        """
        if self._yontem in ("picamera2", "rpicam", "libcamera", "ffmpeg"):
            return True
        if self._yontem == "fswebcam":
            # fswebcam'in akış karşılığı yok; ffmpeg varsa USB kamerada
            # akışı O yapıyor.
            return bool(shutil.which("ffmpeg"))
        yol = str(self.ayar.get("yol") or "oto").lower()
        if yol == "usb" or self.ayar.get("cihaz_adi") or self.ayar.get("cihaz"):
            return bool(shutil.which("ffmpeg"))
        if shutil.which("rpicam-vid") or shutil.which("libcamera-vid"):
            return True
        try:
            import picamera2  # type: ignore # noqa: F401
            return True
        except ImportError:
            return False

    def _canli_picamera2(self):
        """picamera2 ile sürekli kare üretir."""
        from picamera2 import Picamera2  # type: ignore
        genislik = int(self.ayar["genislik"])
        # Video yapılandırması still'den belirgin hızlı: still her karede
        # tam çözünürlük hazırlığı yapıyor.
        self._picam_kapat()
        picam = Picamera2()
        picam.configure(picam.create_video_configuration(
            main={"size": (genislik, int(genislik * 3 / 4))}))
        picam.start()
        self._picam = picam
        time.sleep(1)                       # pozlama otursun
        try:
            while self._canli:
                tampon = io.BytesIO()
                picam.capture_file(tampon, format="jpeg")
                yield tampon.getvalue()
        finally:
            # Canlıdan çıkarken cihazı BIRAKIYORUZ. Video yapılandırmasıyla
            # açık kalan kamera, sonraki tek kare isteğinde "Pipeline handler
            # in use" hatasına yol açıyordu.
            self._picam_kapat()

    def _canli_komutu(self) -> list[str]:
        genislik = int(self.ayar["genislik"])
        yukseklik = int(genislik * 3 / 4)
        if self._yontem in ("fswebcam", "ffmpeg"):
            # USB kamera: ffmpeg v4l2'den okuyup stdout'a MJPEG basıyor.
            # `-input_format mjpeg` YAZMIYORUZ: kamera desteklemiyorsa ffmpeg
            # hiç açılmıyor. Ham kareyi ffmpeg'in sıkıştırması bir çekirdeği
            # meşgul ediyor ama çalışmama riskini almıyor.
            cihaz = self.cihaz_coz(zorla=True)
            if not cihaz:
                raise RuntimeError(self.cihaz_not or "USB kamera bulunamadı")
            return ["ffmpeg", "-hide_banner", "-loglevel", "error",
                    "-f", "v4l2", "-video_size", f"{genislik}x{yukseklik}",
                    "-i", cihaz, "-f", "mjpeg", "-q:v", "5", "-"]
        arac = "rpicam-vid" if shutil.which("rpicam-vid") else "libcamera-vid"
        return [arac, "-n", "-t", "0", "--codec", "mjpeg",
                "--width", str(genislik), "--height", str(yukseklik),
                "-q", str(int(self.ayar["kalite"])), "-o", "-"]

    def _canli_rpicam(self):
        """rpicam-vid / libcamera-vid / ffmpeg ile sürekli MJPEG."""
        komut = self._canli_komutu()
        surec = subprocess.Popen(komut, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, bufsize=0)
        self._canli_surec = surec
        tampon = b""
        try:
            while self._canli:
                parca = surec.stdout.read(16384)
                if not parca:
                    break
                tampon += parca
                # MJPEG akışı arka arkaya eklenmiş JPEG'lerden ibaret;
                # sınırları SOI (FFD8) ve EOI (FFD9) işaretleri belirliyor.
                while True:
                    bas = tampon.find(JPEG_BAS)
                    if bas < 0:
                        break
                    son = tampon.find(JPEG_SON, bas + 2)
                    if son < 0:
                        # Kare henüz tamamlanmadı; gerisini bekliyoruz.
                        if bas > 0:
                            tampon = tampon[bas:]
                        break
                    yield tampon[bas:son + 2]
                    tampon = tampon[son + 2:]
        finally:
            for adim in (surec.terminate, surec.kill):
                try:
                    adim()
                    surec.wait(timeout=2)
                    break
                except Exception:
                    continue
            self._canli_surec = None

    def canli_ac(self, fps: float = 5.0) -> tuple[bool, str]:
        if self._canli:
            return True, "Canlı akış zaten açık"
        if not self._yontem:
            self._yontem = self._yontem_sec()
        if not self.canli_var_mi():
            return False, (f"Canlı akış bu yöntemle ({self._yontem or 'yok'}) "
                           "desteklenmiyor; picamera2 ya da rpicam gerekiyor")
        # Periyodik kare döngüsü ile canlı akış AYNI cihazı açamaz. Canlı
        # açılırken periyodik döngü duruyor, kapanınca geri geliyor.
        self._periyodik_geri = self._calisiyor
        if self._calisiyor:
            self.durdur()
        self._canli = True
        self._canli_fps = max(1.0, min(15.0, float(fps)))
        # İş parçacığı SAKLANIYOR: kapatırken bitmesini beklememiz gerekiyor,
        # yoksa "kapatıldı" dediğimiz anda cihaz hâlâ tutuluyor olabiliyor.
        self._canli_ip = threading.Thread(target=self._canli_dongu,
                                          name="kamera-canli", daemon=True)
        self._canli_ip.start()
        return True, f"Canlı akış açıldı ({self._yontem})"

    def canli_kapat(self) -> tuple[bool, str]:
        if not self._canli:
            return True, "Canlı akış zaten kapalı"
        self._canli = False
        # Periyodik kare döngüsü canlıdan önce açıksa geri getiriyoruz:
        # kullanıcı canlıyı kapatınca kamera tamamen susmasın.
        if getattr(self, "_periyodik_geri", False):
            self.ac()
        return True, "Canlı akış kapatıldı"

    def _canli_dongu(self) -> None:
        uretici = (self._canli_picamera2 if self._yontem == "picamera2"
                   else self._canli_rpicam)
        en_az_ara = 1.0 / self._canli_fps
        son = 0.0
        try:
            for kare in uretici():
                if not self._canli:
                    break
                # Kaynak istediğimizden hızlı üretebiliyor; fazlasını
                # göndermek ağı ve paneli boşuna yoruyor.
                simdi = time.monotonic()
                if simdi - son < en_az_ara:
                    continue
                son = simdi
                self.gonder(self.ad, base64.b64encode(kare).decode("ascii"), time.time())
        except Exception as hata:
            self.son_hata = str(hata)
            self.gunluk_cb(f"[{self.etiket}] Canlı akış durdu: {hata}", "hata")
        finally:
            self._canli = False

    def _komut_kare(self) -> bytes:
        """libcamera-still, fswebcam ya da ffmpeg ile tek kare."""
        genislik = int(self.ayar["genislik"])
        yukseklik = int(genislik * 3 / 4)
        gecici = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        gecici.close()
        try:
            if self._yontem in ("rpicam", "libcamera"):
                arac = "rpicam-still" if self._yontem == "rpicam" else "libcamera-still"
                komut = [arac, "-n", "-t", "800", "--width", str(genislik),
                         "--height", str(yukseklik),
                         "-q", str(int(self.ayar["kalite"])), "-o", gecici.name]
            elif self._yontem == "ffmpeg":
                cihaz = self.cihaz_coz()
                if not cihaz:
                    raise RuntimeError(self.cihaz_not or "USB kamera bulunamadı")
                komut = ["ffmpeg", "-hide_banner", "-loglevel", "error",
                         "-f", "v4l2", "-video_size", f"{genislik}x{yukseklik}",
                         "-i", cihaz, "-frames:v", "1", "-q:v", "3",
                         "-y", gecici.name]
            else:
                cihaz = self.cihaz_coz()
                if not cihaz:
                    raise RuntimeError(self.cihaz_not or "USB kamera bulunamadı")
                komut = ["fswebcam", "-d", cihaz, "-r",
                         f"{genislik}x{yukseklik}", "--no-banner",
                         "-q", gecici.name]
            try:
                subprocess.run(komut, check=True, capture_output=True, timeout=20)
            except subprocess.CalledProcessError as hata:
                # Kameranın neden kare vermediği stderr'de yazıyor; onu
                # yutmak "kamera hatası" diye içi boş bir mesaj bırakıyordu.
                ayrinti = (hata.stderr or b"").decode("utf-8", "replace").strip()
                raise RuntimeError(f"{komut[0]} başarısız: {ayrinti[-300:] or hata}") from hata
            with open(gecici.name, "rb") as dosya:
                return dosya.read()
        finally:
            try:
                os.unlink(gecici.name)
            except OSError:
                pass

    def _sahte_kare(self) -> bytes:
        """Donanım olmadan panelin kare akışını denemek için üretilen kare."""
        from PIL import Image, ImageDraw

        genislik = int(self.ayar["genislik"])
        yukseklik = int(genislik * 3 / 4)
        gorsel = Image.new("RGB", (genislik, yukseklik), (26, 40, 26))
        cizim = ImageDraw.Draw(gorsel)
        # Yatak ızgarası + saat: kareyi gerçekten yenilendiğini görebilmek için.
        for x in range(0, genislik, 64):
            cizim.line([(x, 0), (x, yukseklik)], fill=(38, 58, 38))
        for y in range(0, yukseklik, 64):
            cizim.line([(0, y), (genislik, y)], fill=(38, 58, 38))
        for i in range(6):
            cx, cy = 70 + i * 90, yukseklik // 2
            cizim.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=(58, 130, 66))
        cizim.text((12, 10), "SAHTE KAMERA — " + time.strftime("%H:%M:%S"), fill=(220, 230, 220))
        tampon = io.BytesIO()
        gorsel.save(tampon, format="JPEG", quality=int(self.ayar["kalite"]))
        return tampon.getvalue()

    def _usb_yontem(self) -> str:
        """USB kamera yolu — cihazı çözüp aracı seçer."""
        if not self.cihaz_coz(zorla=True):
            return ""
        if shutil.which("fswebcam"):
            return "fswebcam"
        if shutil.which("ffmpeg"):
            return "ffmpeg"
        return ""

    def _yontem_sec(self) -> str:
        """Hangi yolla kare alınacak.

        `yol` ayarı bunu KAMERA BAŞINA belirliyor. Tek kameralıyken "sırayla
        dene" yetiyordu; iki kamerada yetmiyor, çünkü `rpicam-still` şerit
        kablodaki kamerayı sürüyor — USB kamera için çağrıldığında yanlış
        kameranın karesini verir ve bunu hiçbir hata mesajı söylemez.
        """
        yol = str(self.ayar.get("yol") or "oto").lower()
        if self.ayar.get("sahte") or yol == "sahte":
            return "sahte"
        if yol == "usb":
            return self._usb_yontem()
        if yol == "pi":
            if self._picamera2_dene():
                return "picamera2"
            if shutil.which("rpicam-still"):
                return "rpicam"
            if shutil.which("libcamera-still"):
                return "libcamera"
            return ""
        # "oto": cihaz adı ya da yolu verilmişse bu bir USB kamera demektir.
        if self.ayar.get("cihaz_adi") or self.ayar.get("cihaz"):
            usb = self._usb_yontem()
            if usb:
                return usb
        if self._picamera2_dene():
            return "picamera2"
        if shutil.which("rpicam-still"):
            return "rpicam"
        if shutil.which("libcamera-still"):
            return "libcamera"
        if shutil.which("fswebcam"):
            return "fswebcam"
        return ""

    def kare_al(self) -> bytes:
        if self._yontem == "sahte":
            return self._sahte_kare()
        if self._yontem == "picamera2":
            return self._picamera2_kare()
        return self._komut_kare()

    # --- döngü ---
    def baslat(self) -> None:
        """Ajan acilirken cagrilir; ayarda kapaliysa dokunmaz.

        HİÇBİR ŞEY FIRLATMIYOR. İki kamera var ve biri açılırken patlarsa
        öteki de açılamaz olurdu; kamera bir eklenti, ajan onsuz çalışmalı.
        """
        try:
            if not self.ayar.get("aktif"):
                self.gunluk_cb(f"[{self.etiket}] kapalı — panelden açılabilir", "bilgi")
                return
            self.ac()
        except Exception as hata:
            self.son_hata = str(hata)
            self.gunluk_cb(f"[{self.etiket}] açılamadı: {hata} — "
                           "diğer kameralar ve makine etkilenmedi", "hata")

    def durum(self) -> dict[str, Any]:
        """Panelin dugmeyi dogru gostermesi icin."""
        return {
            "ad": self.ad,
            "etiket": self.etiket,
            # Panelin "bu karenin konumu var mı" sorusunu sormasına gerek
            # kalmıyor: kameranın kendisi hareketli mi, o söylüyor.
            "hareketli": self.hareketli,
            "cihaz": self._cihaz,
            "cihaz_adi": str(self.ayar.get("cihaz_adi") or ""),
            "cihaz_not": self.cihaz_not,
            "genislik": int(self.ayar.get("genislik", 640)),
            "yol": str(self.ayar.get("yol") or "oto"),
            "sahte": bool(self.ayar.get("sahte")),
            # "acik" = kamera KARE URETIYOR mu. Canli akis acilirken
            # periyodik dongu duruyor (ikisi ayni cihazi acamaz); yalnizca
            # _calisiyor'a bakmak, canli akarken panele "kapali" dedirtiyordu.
            "acik": self._calisiyor or self._canli,
            "yontem": self._yontem,
            "aralik_sn": float(self.ayar.get("aralik_sn", 3600.0)),
            "hata": self.son_hata,
            "canli": self._canli,
            # Panel "Canlı" düğmesini boşuna göstermesin: fswebcam yolunda
            # akış karşılığı yok.
            "canli_var": self.canli_var_mi(),
            "canli_fps": self._canli_fps,
        }

    def ac(self) -> tuple[bool, str]:
        """Calisma aninda ac. Ayar dosyasi degismez; kalici olsun istenirse
        ayarlar.json'daki "aktif" elle true yapilir."""
        if self._calisiyor:
            return True, "Kamera zaten acik"
        self._yontem = self._yontem_sec()
        if not self._yontem:
            # Kamera yoksa ajan çalışmaya devam etmeli: kamera bir eklenti,
            # makinenin çalışması ona bağlı değil. Diğer kamera da etkilenmez.
            sebep = self.cihaz_not or ("picamera2 / rpicam-still / libcamera-still / "
                                       "fswebcam / ffmpeg yok")
            self.gunluk_cb(
                f"[{self.etiket}] bulunamadı ({sebep}) — bu kamera kapalı, "
                "diğer her şey çalışıyor", "uyari")
            return False, f"{self.etiket} bulunamadı: {sebep}"
        self._calisiyor = True
        self._dur.clear()
        self.gunluk_cb(f"[{self.etiket}] açıldı ({self._yontem}"
                       + (f", {self._cihaz}" if self._cihaz else "") + ")", "bilgi")
        threading.Thread(target=self._dongu, name=f"kamera-{self.ad}",
                         daemon=True).start()
        return True, f"{self.etiket} açıldı ({self._yontem})"

    def kapat(self) -> tuple[bool, str]:
        # Canli akis acikken "kapat" demek onu da kapatmali: kullanici
        # anahtari kapatirken "periyodik dongu" ile "canli akis" ayrimini
        # bilmek zorunda degil, kamerayi kapatmak istiyor.
        if self._canli:
            self._canli = False
            self._periyodik_geri = False     # geri getirilecek bir sey yok
            self._calisiyor = False
            # CIHAZI BIRAKMAYI BEKLIYORUZ. Eskiden burada hemen donuluyordu:
            # panel "kapandi" diyor, akis is parcacigi ise hala capture_file
            # icinde ve kamerayi tutuyordu. Bir sonraki rpicam/picamera2
            # kullanicisi "Pipeline handler in use by another process"
            # aliyordu — kullanicinin gozunde kamera kapaliyken.
            ip = self._canli_ip
            if ip is not None and ip.is_alive():
                ip.join(timeout=5.0)
            # Is parcacigi takildiysa (surec okumada bloke) yine de birak.
            surec = self._canli_surec
            if surec is not None:
                for adim in (surec.terminate, surec.kill):
                    try:
                        adim(); surec.wait(timeout=2); break
                    except Exception:
                        continue
                self._canli_surec = None
            self._picam_kapat()
            self._yontem = None
            self._canli_ip = None
            return True, "Kamera kapatildi (canli akis durduruldu)"
        if not self._calisiyor:
            return True, "Kamera zaten kapali"
        self.durdur()
        self.gunluk_cb(f"[{self.etiket}] kapatıldı", "bilgi")
        return True, "Kamera kapatildi"

    def durdur(self) -> None:
        self._calisiyor = False
        self._dur.set()
        # Yalnizca stop() demek yetmiyordu: nesne cihazi tutmaya devam edip
        # bir sonraki acilisi engelliyordu. Kapatip birakiyoruz.
        self._picam_kapat()
        self._yontem = None
        self.son_hata = None

    def _dongu(self) -> None:
        hata_sayaci = 0
        yavas_sayaci = 0
        while self._calisiyor:
            basladi = time.monotonic()
            try:
                ham = self.kare_al()
                self.gonder(self.ad, base64.b64encode(ham).decode("ascii"), time.time())
                self.son_hata = None
                hata_sayaci = 0
                # SIRA ÖNEMLİ: önce sunucuya, sonra çıkarıma. Panelin
                # kare akışı hiçbir koşulda tespiti beklemiyor.
                if self.cikarim is not None:
                    try:
                        self.cikarim(ham, time.time())
                    except Exception:
                        # Kanca hiçbir koşulda kamera döngüsünü
                        # düşürmemeli; kendi hatasını kendi bildiriyor.
                        pass
            except Exception as hata:
                hata_sayaci += 1
                self.son_hata = str(hata)
                # USB kamera çıkarılıp takıldığında /dev/videoN numarası
                # değişiyor ve elimizdeki yol artık yok. Hata alınca cihazı
                # ADINDAN yeniden arıyoruz: kullanıcının kabloyu takıp
                # paneli yeniden başlatması gerekmiyor.
                if self._yontem in ("fswebcam", "ffmpeg"):
                    self.cihaz_coz(zorla=True)
                # Her turda günlüğe yazmak, kamerası çıkmış bir Pi'de günlüğü
                # doldurur. İlk hatayı ve sonra seyrek olarak bildiriyoruz.
                if hata_sayaci == 1 or hata_sayaci % 20 == 0:
                    self.gunluk_cb(f"[{self.etiket}] kare alınamadı "
                                   f"({hata_sayaci}. kez): {hata}", "hata")
            # Aralik her turda okunuyor: panelden degistirilirse bir sonraki
            # turda gecerli oluyor, yeniden baslatmak gerekmiyor.
            aralik = max(2.0, float(self.ayar.get("aralik_sn", 3600.0)))

            # Kare cekmek de zaman aliyor — komut satiri yolunda islem acmak
            # birkac saniye surebiliyor. Bekleme suresinden bunu dusuyoruz,
            # yoksa "5 saniyede bir" fiilen "5 + cekim suresi" oluyor ve
            # canli akis istendiginde fark buyuk.
            gecen = time.monotonic() - basladi
            kalan = aralik - gecen

            # Cekim istenen araliktan uzun suruyorsa kamera bu hizi
            # tasiyamiyor demek. Sessizce yavas calismak yerine soyluyoruz:
            # kullanici "5 sn sectim ama 9 saniyede bir geliyor" diye
            # aramasin.
            if kalan <= 0:
                yavas_sayaci += 1
                if yavas_sayaci == 1 or yavas_sayaci % 20 == 0:
                    self.gunluk_cb(
                        f"Kare almak {gecen:.1f} sn suruyor, istenen aralik "
                        f"{aralik:.0f} sn — kamera bu hizi tasimiyor, kareler "
                        f"{gecen:.1f} sn'de bir gelecek.", "uyari")
                kalan = 0
            else:
                yavas_sayaci = 0

            # Beklemeyi PARCA PARCA yapiyoruz. Tek bir uzun wait'te, panelden
            # "1 saat"ten "5 saniye"ye gecmek bir sonraki tura kadar hicbir
            # sey yapmiyordu — yani bir saat. Saniyelik dilimlerde beklerken
            # araligi yeniden okuyoruz, degisiklik en gec bir saniyede
            # gecerli oluyor.
            bekleme_basi = time.monotonic()
            while self._calisiyor:
                yeni_aralik = max(2.0, float(self.ayar.get("aralik_sn", 3600.0)))
                if yeni_aralik != aralik:
                    aralik = yeni_aralik
                    kalan = aralik - gecen
                gectiginden = time.monotonic() - bekleme_basi
                if gectiginden >= kalan:
                    break
                if self._dur.wait(min(1.0, kalan - gectiginden)):
                    return


# --------------------------------------------------------------------------- #
# Kamera tanımları — panelden düzenlenebilir, ayrı bir dosyada
# --------------------------------------------------------------------------- #
# Neden `ayarlar.json` DEĞİL: ajanın kuralı "ayar dosyasına yazmıyoruz" —
# panelden yapılan geçici bir deneme yeniden başlatmada sürpriz olmasın diye.
# Ama kamera tanımları (cihaz adı, çözünürlük, aralık) geçici deneme değil,
# kalıcı donanım tarifi; her açılışta yeniden girmek anlamsız. `uclar.json`
# ile aynı çözüm: kendi dosyası.
#
# Sıralama korunuyor: panel kutuları bu sırayla diziliyor.

VARSAYILAN_KAMERALAR: list[dict[str, Any]] = [
    {"ad": "uc", "etiket": "Uç kamerası", "hareketli": True, "yol": "pi",
     "aktif": False, "aralik_sn": 3600.0, "genislik": 640, "kalite": 75},
    {"ad": "ust", "etiket": "Üst kamera", "hareketli": False, "yol": "usb",
     "aktif": False, "aralik_sn": 3600.0, "genislik": 640, "kalite": 75,
     "cihaz_adi": "", "cihaz": ""},
]

#: Panelden gelen tanımda kabul edilen alanlar. Beyaz liste: bilinmeyen bir
#: anahtar sessizce saklanıp sonra "neden çalışmıyor" sorusuna dönüşmesin.
DUZENLENEBILIR = ("etiket", "hareketli", "aralik_sn", "genislik", "kalite",
                  "cihaz", "cihaz_adi", "yol", "sahte", "aktif")


class KameraAyarHatasi(Exception):
    """Panelden gelen kamera tanımı geçersiz."""


def tanim_dogrula(ham: dict[str, Any], sira: int = 0) -> dict[str, Any]:
    """Panelden gelen tek bir kamera tanımını temizler.

    Hatalar BURADA yakalanıyor, kamera açılırken değil: "genişlik 20000"
    yazan bir tanım kaydedilip sonra sessizce kare vermemeli.
    """
    if not isinstance(ham, dict):
        raise KameraAyarHatasi("Kamera tanımı bir nesne olmalı")
    ad = ad_temizle(ham.get("ad"), f"kam{sira + 1}")
    temiz: dict[str, Any] = {**VARSAYILAN, "ad": ad}
    temiz["etiket"] = str(ham.get("etiket") or ad).strip()[:40] or ad
    temiz["hareketli"] = bool(ham.get("hareketli", True))
    temiz["sahte"] = bool(ham.get("sahte", False))
    temiz["aktif"] = bool(ham.get("aktif", False))

    yol = str(ham.get("yol") or "oto").strip().lower()
    if yol not in ("oto", "pi", "usb", "sahte"):
        raise KameraAyarHatasi(
            f"'{temiz['etiket']}' için yol 'oto', 'pi', 'usb' ya da 'sahte' olmalı "
            f"(verilen: {yol})")
    temiz["yol"] = yol

    try:
        genislik = int(float(ham.get("genislik", 640)))
    except (TypeError, ValueError):
        raise KameraAyarHatasi(f"'{temiz['etiket']}' çözünürlüğü sayı olmalı") from None
    if not 160 <= genislik <= 1920:
        raise KameraAyarHatasi(
            f"'{temiz['etiket']}' genişliği 160 ile 1920 arasında olmalı "
            f"(verilen: {genislik}). Kare WebSocket'ten geçiyor; büyük kare ağı "
            "ve SD kartı yorar.")
    temiz["genislik"] = genislik

    try:
        aralik = float(ham.get("aralik_sn", 3600.0))
    except (TypeError, ValueError):
        raise KameraAyarHatasi(f"'{temiz['etiket']}' kare aralığı sayı olmalı") from None
    if not 2.0 <= aralik <= 86400.0:
        raise KameraAyarHatasi(
            f"'{temiz['etiket']}' kare aralığı 2 saniye ile 1 gün arasında olmalı "
            f"(verilen: {aralik})")
    temiz["aralik_sn"] = aralik

    try:
        kalite = int(float(ham.get("kalite", 75)))
    except (TypeError, ValueError):
        raise KameraAyarHatasi(f"'{temiz['etiket']}' JPEG kalitesi sayı olmalı") from None
    temiz["kalite"] = max(30, min(95, kalite))

    cihaz = str(ham.get("cihaz") or "").strip()
    if cihaz and not cihaz.startswith("/dev/"):
        raise KameraAyarHatasi(
            f"'{temiz['etiket']}' cihaz yolu /dev/ ile başlamalı (verilen: {cihaz})")
    temiz["cihaz"] = cihaz
    temiz["cihaz_adi"] = str(ham.get("cihaz_adi") or "").strip()[:80]
    return temiz


def tanimlari_dogrula(ham: Any) -> list[dict[str, Any]]:
    if not isinstance(ham, list) or not ham:
        raise KameraAyarHatasi("En az bir kamera tanımı gerekiyor")
    if len(ham) > 6:
        raise KameraAyarHatasi("En çok 6 kamera tanımlanabilir")
    cikti = [tanim_dogrula(k, i) for i, k in enumerate(ham)]
    adlar = [k["ad"] for k in cikti]
    tekrar = {a for a in adlar if adlar.count(a) > 1}
    if tekrar:
        raise KameraAyarHatasi(
            f"Kamera adları benzersiz olmalı — tekrar eden: {', '.join(sorted(tekrar))}. "
            "Ad hem kare klasörü hem kalibrasyon anahtarı; iki kamera aynı adı "
            "kullanırsa kareleri ve ölçekleri birbirine karışır.")
    return cikti


def tanim_yolu(ayar_yolu: str) -> str:
    return os.path.join(os.path.dirname(os.path.abspath(ayar_yolu)) or ".",
                        "kameralar.json")


def tanimlari_yukle(ayar_yolu: str, ayar: dict[str, Any]) -> list[dict[str, Any]]:
    """Kamera tanımları — dosya varsa oradan, yoksa ayarlardan.

    ESKİ KURULUM BOZULMUYOR: `ayarlar.json` içindeki tek `"kamera": {...}`
    bloğu, "uc" adlı tek bir kameraya çevriliyor. Kullanıcı hiçbir şey
    yapmadan bugünkü davranışı sürdürüyor, ikinci kamerayı panelden ekliyor.
    """
    import json

    yol = tanim_yolu(ayar_yolu)
    if os.path.exists(yol):
        try:
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
            return tanimlari_dogrula(veri.get("kameralar") if isinstance(veri, dict)
                                     else veri)
        except (OSError, ValueError, KameraAyarHatasi) as hata:
            logger.warning("kameralar.json okunamadı (%s) — ayarlardaki tanım "
                           "kullanılıyor", hata)

    if isinstance(ayar.get("kameralar"), list) and ayar["kameralar"]:
        try:
            return tanimlari_dogrula(ayar["kameralar"])
        except KameraAyarHatasi as hata:
            logger.warning("ayarlar.json'daki kamera listesi geçersiz (%s)", hata)

    eski = ayar.get("kamera")
    if isinstance(eski, dict) and eski:
        # Tek kameralı kurulum: eski blok "uc" oluyor, yanına HENÜZ
        # TANIMSIZ bir üst kamera konuyor. Kapalı ve cihazsız duruyor —
        # hiçbir şey açmaya çalışmıyor, yalnızca panelde doldurulacak bir
        # kart olarak görünüyor. Alternatifi, kullanıcının ikinci kamerayı
        # eklemek için elle JSON yazması olurdu.
        return [tanim_dogrula({**eski, "ad": "uc", "etiket": "Uç kamerası",
                               "hareketli": True}),
                tanim_dogrula(VARSAYILAN_KAMERALAR[1])]
    return [tanim_dogrula(k, i) for i, k in enumerate(VARSAYILAN_KAMERALAR)]


def tanimlari_kaydet(ayar_yolu: str, tanimlar: list[dict[str, Any]]) -> str:
    """Doğrulanmış tanımları diske yazar. -> yazılan yol"""
    import json

    yol = tanim_yolu(ayar_yolu)
    klasor = os.path.dirname(yol) or "."
    gecici = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=klasor,
                                         prefix=".kameralar-", suffix=".tmp",
                                         delete=False)
    try:
        json.dump({"kameralar": tanimlar}, gecici, ensure_ascii=False, indent=1)
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
    return yol
