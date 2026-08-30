"""Kamera — Pi'den periyodik kare.

Kare yakalama üç yoldan denenir, ilk çalışan kullanılır:

  1. **picamera2** — Raspberry Pi kamera modülü (şerit kablo). Bookworm'ün
     önerdiği kütüphane.
  2. **rpicam-still / libcamera-still / fswebcam** — komut satırı araçları.
     Bookworm'de `libcamera-still` yerini `rpicam-still`e bıraktı; ikisi de
     aranıyor. USB webcam ya da picamera2'nin kurulu olmadığı sistemler için.

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
    "aktif": False,
    "aralik_sn": 3600.0,   # saatte bir kare
    "genislik": 640,
    "kalite": 75,
    "sahte": False,
    "cihaz": "/dev/video0",     # fswebcam için
}


class Kamera:
    def __init__(self, ayar: dict[str, Any], gonder: Callable[[str, float], None],
                 gunluk_cb: Callable[[str, str], None] | None = None,
                 cikarim: Callable[[bytes, float], Any] | None = None) -> None:
        self.ayar = {**VARSAYILAN, **(ayar or {})}
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
        if self._yontem in ("picamera2", "rpicam", "libcamera"):
            return True
        if self._yontem == "fswebcam":
            return False          # fswebcam'in akış karşılığı yok
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

    def _canli_rpicam(self):
        """rpicam-vid / libcamera-vid ile sürekli MJPEG."""
        arac = "rpicam-vid" if shutil.which("rpicam-vid") else "libcamera-vid"
        genislik = int(self.ayar["genislik"])
        komut = [arac, "-n", "-t", "0", "--codec", "mjpeg",
                 "--width", str(genislik), "--height", str(int(genislik * 3 / 4)),
                 "-q", str(int(self.ayar["kalite"])), "-o", "-"]
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
                self.gonder(base64.b64encode(kare).decode("ascii"), time.time())
        except Exception as hata:
            self.son_hata = str(hata)
            self.gunluk_cb(f"Canlı akış durdu: {hata}", "hata")
        finally:
            self._canli = False

    def _komut_kare(self) -> bytes:
        """libcamera-still ya da fswebcam ile tek kare."""
        genislik = int(self.ayar["genislik"])
        gecici = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        gecici.close()
        try:
            if self._yontem in ("rpicam", "libcamera"):
                arac = "rpicam-still" if self._yontem == "rpicam" else "libcamera-still"
                komut = [arac, "-n", "-t", "800", "--width", str(genislik),
                         "--height", str(int(genislik * 3 / 4)),
                         "-q", str(int(self.ayar["kalite"])), "-o", gecici.name]
            else:
                komut = ["fswebcam", "-d", str(self.ayar["cihaz"]), "-r",
                         f"{genislik}x{int(genislik * 3 / 4)}", "--no-banner",
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

    def _yontem_sec(self) -> str:
        if self.ayar.get("sahte"):
            return "sahte"
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
        """Ajan acilirken cagrilir; ayarda kapaliysa dokunmaz."""
        if not self.ayar.get("aktif"):
            self.gunluk_cb("Kamera kapali - panelden acilabilir", "bilgi")
            return
        self.ac()

    def durum(self) -> dict[str, Any]:
        """Panelin dugmeyi dogru gostermesi icin."""
        return {
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
            # makinenin çalışması ona bağlı değil.
            self.gunluk_cb(
                "Kamera bulunamadı (picamera2 / rpicam-still / libcamera-still / "
                "fswebcam yok) — kamera kapalı, diğer her şey çalışıyor", "uyari")
            return False, "Kamera bulunamadi (picamera2 / rpicam-still / fswebcam yok)"
        self._calisiyor = True
        self._dur.clear()
        self.gunluk_cb(f"Kamera açıldı ({self._yontem})", "bilgi")
        threading.Thread(target=self._dongu, name="kamera", daemon=True).start()
        return True, f"Kamera acildi ({self._yontem})"

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
        self.gunluk_cb("Kamera kapatildi", "bilgi")
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
                self.gonder(base64.b64encode(ham).decode("ascii"), time.time())
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
                # Her turda günlüğe yazmak, kamerası çıkmış bir Pi'de günlüğü
                # doldurur. İlk hatayı ve sonra seyrek olarak bildiriyoruz.
                if hata_sayaci == 1 or hata_sayaci % 20 == 0:
                    self.gunluk_cb(f"Kare alınamadı ({hata_sayaci}. kez): {hata}", "hata")
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
