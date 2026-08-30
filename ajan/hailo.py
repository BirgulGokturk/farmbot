"""Hailo hızlandırıcı — kamera karelerinde nesne tespiti.

NEDEN AYRI İŞ PARÇACIĞI
-----------------------
Çıkarım kamera döngüsünün İÇİNDE çalışmıyor. Gerekçe gecikme değil —
çıkarımın kendisi ~7 ms, kamera aralığı ise saniyeler; hız hiçbir yerde
sorun olmazdı. Gerekçe ARIZA YALITIMI:

Bu donanımın kilitlenebildiğini sahada gördük. `/dev/hailo0` bir kez
"error 5" (EIO) ile açılamaz oldu, sonra sürücü yüklü olduğu hâlde cihaz
düğümü hiç oluşmadı (`HAILO_OUT_OF_PHYSICAL_DEVICES`). Çıkarım kamera
döngüsünde olsaydı, kilitlenen Hailo kamerayı da durdururdu — yani panelin
canlı görüntüsü ve periyodik kareleri de. Kamera bu projede tespitten çok
daha önemli; tespit kaybolabilir, kamera kaybolamaz.

KUYRUK NEDEN TEK ELEMANLI
-------------------------
`maxsize=1`. Normal işleyişte kuyruk zaten hiç dolmuyor (saniyeler arayla
gelen kare, 7 ms'lik iş). Kuyruğun tek işi arıza anında tampon olmak ve o
anda ESKİ KARE DEĞERSİZ: bir dakika önceki yatağın görüntüsünü işlemek
kimseye bir şey söylemiyor. Kuyruk doluysa yeni kare düşüyor, sayaç
artıyor. En yeni kare kazanıyor.

İŞ PARÇACIĞI YETMİYOR: ÖLÜ ADAM ANAHTARI
----------------------------------------
HailoRT çağrıları C seviyesinde bloke; Python'dan kesilemiyorlar. Çağrı
hiç dönmezse işçi kalıcı olarak orada kalıyor. Kamera etkilenmiyor (asıl
istenen bu) ama kuyruk doluyor ve her kare SESSİZCE düşmeye başlıyor.
Sessiz olmasın diye: uçuşta olan bir kare `kilit_sn`yi geçerse Hailo
`kilitli` işaretleniyor, besleme duruyor ve durum panele çıkıyor.

KENDİ KENDİNE KURTARMA YOK
--------------------------
`modprobe -r hailo_pci` denemesi işi KÖTÜLEŞTİRDİ: cihaz düğümü kayboldu
ve geri gelmesi için güç çevrimi gerekti. Bu modül sürücüye asla
dokunmuyor. Kilitlenince tek söylediği şey "Pi'nin yeniden başlatılması
gerekiyor".
"""

from __future__ import annotations

import queue
import threading
import time
from typing import Any, Callable

VARSAYILAN = {
    # Varsayılan KAPALI: AI HAT takılı olmayan kurulumlarda ajan hiçbir
    # şey denemesin, günlüğe hata yazmasın.
    "aktif": False,
    "sahte": False,
    "model": "/usr/share/hailo-models/yolov8s_h8.hef",
    # Bunun altındaki tespitler atılıyor.
    "esik": 0.4,
    # Uçuştaki kare bu kadar saniyede dönmezse cihaz kilitli sayılıyor.
    # 30 sn: en yavaş model bile bunun çok altında; bu süreyi geçen bir
    # çağrı dönmeyecek demektir.
    "kilit_sn": 30.0,
    # Bu kadar ARDIŞIK hatadan sonra kendini kapatıyor. Sıcak döngüde
    # hata tekrarlamak günlüğü doldurmaktan başka işe yaramıyor.
    "azami_hata": 5,
    # Modelin beklediği giriş boyu. HEF'ten de okunabiliyor ama sahte
    # sürücünün de bilmesi gerekiyor.
    "giris": 640,
}


class SahteCikarim:
    """Donanımsız çıkarım — HAT olmayan kurulum ve testler için.

    Test kancaları (`gecikme_sn`, `hata_ver`, `asili_kal`) bilerek burada:
    kuyruk, düşme ve ölü adam anahtarı mantığının donanım olmadan
    sınanabilmesi, bu modülün en çok değer verdiğim yanı.
    """

    def __init__(self, ayar: dict[str, Any]) -> None:
        self.ayar = ayar
        self.gecikme_sn = float(ayar.get("sahte_gecikme_sn", 0.0))
        self.hata_ver = bool(ayar.get("sahte_hata", False))
        self.asili_kal = bool(ayar.get("sahte_asili", False))
        self._dur = threading.Event()

    def ac(self) -> str:
        return "sahte"

    def kapat(self) -> None:
        self._dur.set()

    def calistir(self, ham: bytes) -> list[dict[str, Any]]:
        if self.asili_kal:
            # Gerçek kilitlenmenin taklidi: dönmüyor. `Event.wait` ile,
            # böylece test sonunda süreç takılı kalmıyor.
            self._dur.wait()
            return []
        if self.gecikme_sn:
            time.sleep(self.gecikme_sn)
        if self.hata_ver:
            raise RuntimeError("sahte çıkarım hatası")
        # Karenin uzunluğundan türeyen belirlenimci tek tespit: testler
        # rastgele bir sayıya bakmasın.
        n = len(ham) % 100
        return [{"sinif": "bitki", "guven": round(0.5 + n / 200.0, 3),
                 "x1": 0.1, "y1": 0.1, "x2": 0.4, "y2": 0.4}]


class HailoCikarim:
    """Gerçek hızlandırıcı. Kütüphaneler TEMBEL yükleniyor.

    `import hailo_platform` modül seviyesinde olsaydı, HAT'i olmayan her
    kurulumda ajan açılışta patlardı. Burada yalnız `ac()` çağrıldığında
    aranıyor ve bulunamazsa Hailo kapanıyor, ajan çalışmaya devam ediyor.

    DİKKAT: bu yolun kendisi konteynerde sınanamıyor (Hailo yok). Kuyruk,
    düşme ve kilit mantığı `SahteCikarim` ile tam sınanıyor; buradaki
    tensör çözümlemesinin Pi'de bir kez doğrulanması gerekiyor.
    """

    def __init__(self, ayar: dict[str, Any]) -> None:
        self.ayar = ayar
        self._vdevice = None
        self._model = None
        self._giris = int(ayar.get("giris", 640))

    def ac(self) -> str:
        from hailo_platform import VDevice, HEF, ConfigureParams, HailoStreamInterface

        yol = str(self.ayar.get("model") or "")
        # vdevice AÇIK TUTULUYOR. Her karede açıp kapatmak, ölçtüğümüz
        # 204 ms'lik firmware yükünü her kareye bindirirdi.
        self._vdevice = VDevice()
        hef = HEF(yol)
        ayarlar = ConfigureParams.create_from_hef(
            hef, interface=HailoStreamInterface.PCIe)
        self._model = self._vdevice.configure(hef, ayarlar)[0]
        bilgi = hef.get_input_vstream_infos()[0]
        try:
            self._giris = int(bilgi.shape[0])
        except Exception:
            pass
        return yol

    def kapat(self) -> None:
        for nesne in (self._model, self._vdevice):
            try:
                if nesne is not None and hasattr(nesne, "release"):
                    nesne.release()
            except Exception:
                pass
        self._model = None
        self._vdevice = None

    def _hazirla(self, ham: bytes):
        """JPEG baytlarını modelin beklediği diziye çevirir.

        JPEG çözmek çıkarımın kendisinden pahalı (Pi 5'te onlarca ms'ye
        karşı 7 ms). Kare aralığı saniyeler olduğu için sorun değil, ama
        sayının nerede harcandığını bilmek gerekiyor.
        """
        import io
        import numpy as np
        from PIL import Image

        gorsel = Image.open(io.BytesIO(ham)).convert("RGB")
        gorsel = gorsel.resize((self._giris, self._giris))
        return np.expand_dims(np.asarray(gorsel, dtype=np.uint8), axis=0)

    def calistir(self, ham: bytes) -> list[dict[str, Any]]:
        from hailo_platform import (InferVStreams, InputVStreamParams,
                                    OutputVStreamParams)

        dizi = self._hazirla(ham)
        giris = InputVStreamParams.make(self._model)
        cikis = OutputVStreamParams.make(self._model)
        with InferVStreams(self._model, giris, cikis) as boru:
            ad = list(giris.keys())[0]
            sonuc = boru.infer({ad: dizi})
        return self._coz(sonuc)

    def _coz(self, sonuc: dict[str, Any]) -> list[dict[str, Any]]:
        """NMS'i çipte yapılmış YOLO çıktısını kutulara çevirir.

        Pi ile gelen HEF'ler NMS'i çipte yapıyor ve sınıf başına bir liste
        döndürüyor: her satır [y1, x1, y2, x2, guven], 0-1 aralığında.
        Biçim beklenenden farklı çıkarsa boş liste dönüyoruz — tespit
        kaybetmek, çöp kutu üretmekten iyi.
        """
        esik = float(self.ayar.get("esik", 0.4))
        cikti: list[dict[str, Any]] = []
        try:
            for _, deger in (sonuc or {}).items():
                gruplar = deger[0] if isinstance(deger, list) else deger
                for sinif_no, satirlar in enumerate(gruplar):
                    for satir in (satirlar if satirlar is not None else []):
                        if len(satir) < 5:
                            continue
                        guven = float(satir[4])
                        if guven < esik:
                            continue
                        cikti.append({
                            "sinif": str(sinif_no),
                            "guven": round(guven, 3),
                            "x1": round(float(satir[1]), 4),
                            "y1": round(float(satir[0]), 4),
                            "x2": round(float(satir[3]), 4),
                            "y2": round(float(satir[2]), 4),
                        })
        except (TypeError, ValueError, IndexError):
            return []
        return cikti


class Hailo:
    """Kuyruk + işçi + ölü adam anahtarı. Sürücüyü dışarıdan alıyor."""

    def __init__(self, ayar: dict[str, Any],
                 gunluk_cb: Callable[[str, str], None] | None = None,
                 surucu: Any = None) -> None:
        self.ayar = {**VARSAYILAN, **(ayar or {})}
        self.gunluk_cb = gunluk_cb or (lambda m, s="bilgi": None)
        # TEK elemanlı kuyruk — dosya başındaki gerekçe.
        self._kuyruk: queue.Queue = queue.Queue(maxsize=1)
        self._ip: threading.Thread | None = None
        self._dur = threading.Event()
        self._kilit = threading.Lock()
        self._surucu = surucu
        self._acik = False

        self.kilitli = False
        self.son_hata: str | None = None
        self.islenen = 0
        self.dusen = 0
        self.hatali = 0
        self._ardisik_hata = 0
        self.son_sure_ms: float | None = None
        self.son_tespit: list[dict[str, Any]] = []
        self.son_tespit_ts: float | None = None
        # Uçuştaki karenin başlangıcı (monotonic). None = boşta.
        self._ucus_basi: float | None = None

    # ------------------------------------------------------------ yaşam
    def baslat(self) -> None:
        if not self.ayar.get("aktif"):
            return
        if self._ip and self._ip.is_alive():
            return
        if self._surucu is None:
            self._surucu = (SahteCikarim(self.ayar) if self.ayar.get("sahte")
                            else HailoCikarim(self.ayar))
        try:
            ad = self._surucu.ac()
            self._acik = True
            self.son_hata = None
            self.gunluk_cb(f"Hailo hazır ({ad})", "bilgi")
        except Exception as hata:
            # Kütüphane yok, HEF yok, cihaz yok — hepsi buraya düşüyor.
            # Ajan çalışmaya devam ediyor, yalnız tespit yok.
            self._acik = False
            self.ayar["aktif"] = False
            self.son_hata = str(hata)
            self.gunluk_cb(f"Hailo açılamadı, tespit kapalı: {hata}", "uyari")
            return
        self._dur.clear()
        # daemon: takılı bir işçi ajanın kapanmasını engellemesin.
        self._ip = threading.Thread(target=self._dongu, name="hailo",
                                    daemon=True)
        self._ip.start()

    def durdur(self) -> None:
        self._dur.set()
        # Kuyruğa zehir koyuyoruz: işçi `get`te bekliyorsa hemen uyansın.
        try:
            self._kuyruk.put_nowait(None)
        except queue.Full:
            pass
        if self._surucu is not None:
            try:
                self._surucu.kapat()
            except Exception:
                pass
        self._acik = False

    # ------------------------------------------------------- besleme
    def kare_ver(self, ham: bytes, ts: float | None = None) -> bool:
        """Kareyi kuyruğa bırakır. Dolu ya da kilitliyse DÜŞÜRÜR.

        Hiçbir koşulda bloke etmiyor ve hiçbir koşulda istisna atmıyor:
        çağıran kamera döngüsü ve orada atılan bir istisna kareyi
        kaybettirirdi.
        """
        if not self._acik or self._dur.is_set():
            return False
        self._saglik_bak()
        if self.kilitli:
            with self._kilit:
                self.dusen += 1
            return False
        try:
            # Kopya ŞART: kamera tamponunu yeniden kullanıyorsa, referans
            # bırakmak işçinin üstüne yazılan bir kareyi okuması demek.
            self._kuyruk.put_nowait((bytes(ham), ts or time.time()))
            return True
        except queue.Full:
            with self._kilit:
                self.dusen += 1
            return False

    # -------------------------------------------------------- işçi
    def _dongu(self) -> None:
        while not self._dur.is_set():
            try:
                is_ = self._kuyruk.get(timeout=0.5)
            except queue.Empty:
                continue
            if is_ is None:              # zehir
                break
            ham, ts = is_
            basladi = time.monotonic()
            with self._kilit:
                self._ucus_basi = basladi
            try:
                tespitler = self._surucu.calistir(ham)
                sure = (time.monotonic() - basladi) * 1000.0
                with self._kilit:
                    self.islenen += 1
                    self.son_sure_ms = round(sure, 1)
                    self.son_tespit = tespitler
                    self.son_tespit_ts = ts
                    self.son_hata = None
                    self._ardisik_hata = 0
            except Exception as hata:
                with self._kilit:
                    self.hatali += 1
                    self._ardisik_hata += 1
                    self.son_hata = str(hata)
                    sayi = self._ardisik_hata
                if sayi == 1 or sayi % 10 == 0:
                    self.gunluk_cb(f"Hailo çıkarımı başarısız ({sayi}. kez): {hata}",
                                   "hata")
                if sayi >= int(self.ayar.get("azami_hata", 5)):
                    # Sıcak döngüde tekrar denemek günlüğü doldurmaktan
                    # başka işe yaramıyor. Sürücüye DOKUNMUYORUZ.
                    self._acik = False
                    self.gunluk_cb(
                        f"Hailo {sayi} kez üst üste başarısız oldu — tespit "
                        f"kapatıldı. Cihaz yanıt vermiyorsa Pi'nin yeniden "
                        f"başlatılması gerekiyor (sürücüyü yeniden yüklemeyin, "
                        f"cihaz düğümü kayboluyor).", "hata")
                    break
            finally:
                with self._kilit:
                    self._ucus_basi = None

    # ----------------------------------------------------- ölü adam
    def _saglik_bak(self) -> None:
        """Uçuştaki kare çok uzun sürdüyse cihazı kilitli işaretler.

        HailoRT çağrısı C seviyesinde bloke; kesemiyoruz. Yapabildiğimiz
        tek şey beslemeyi kesip durumu söylemek — takılı işçi orada kalıyor,
        ajanın gerisi çalışmaya devam ediyor.
        """
        if self.kilitli:
            return
        with self._kilit:
            basi = self._ucus_basi
        if basi is None:
            return
        gecen = time.monotonic() - basi
        if gecen < float(self.ayar.get("kilit_sn", 30.0)):
            return
        self.kilitli = True
        self.son_hata = f"cihaz {gecen:.0f} sn'dir yanıt vermiyor"
        self.gunluk_cb(
            f"Hailo {gecen:.0f} saniyedir yanıt vermiyor — tespit durduruldu. "
            f"Kamera ve robot etkilenmedi. Cihazı geri getirmek için Pi'yi "
            f"yeniden başlatın; sürücüyü elle yeniden yüklemek cihaz düğümünü "
            f"kaybettiriyor.", "hata")

    # -------------------------------------------------------- durum
    def durum(self) -> dict[str, Any]:
        self._saglik_bak()
        with self._kilit:
            return {
                "aktif": bool(self._acik),
                "kilitli": self.kilitli,
                "sahte": bool(self.ayar.get("sahte")),
                "model": str(self.ayar.get("model") or ""),
                "islenen": self.islenen,
                # `dusen` sayacı sorunu fark etmenin en hızlı yolu:
                # normal işleyişte SIFIR kalmalı.
                "dusen": self.dusen,
                "hatali": self.hatali,
                "son_sure_ms": self.son_sure_ms,
                "son_hata": self.son_hata,
                "tespit": len(self.son_tespit),
                "tespitler": self.son_tespit[:20],
                "tespit_ts": self.son_tespit_ts,
            }


def olustur(ayar: dict[str, Any], gunluk_cb=None, surucu=None) -> Hailo:
    return Hailo(ayar, gunluk_cb, surucu)
