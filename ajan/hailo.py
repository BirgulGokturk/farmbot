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

KAMERA BAŞINA TEK SLOT
----------------------
Ortak bir kuyruk yok; her kameranın kendi tek kişilik slotu var. Normal
işleyişte hiçbiri dolmuyor (saniyeler arayla gelen kare, ölçülen 4.5 ms'lik
iş). Slotun tek işi arıza anında tampon olmak ve o anda ESKİ KARE DEĞERSİZ:
bir dakika önceki yatağın görüntüsünü işlemek kimseye bir şey söylemiyor.
Slot doluysa yeni kare eskisini eziyor, sayaç artıyor. En yeni kare
kazanıyor.

Neden kamera başına: iki kamera birden besleyebiliyor. Ortak tek slotta
biri ötekinin karesini düşürürdü ve — daha kötüsü — dönen tespitin hangi
kareye ait olduğu kaybolurdu. İki kamera farklı yerlere bakarken adsız bir
tespit kullanılamaz.

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
    # Sınıf adları: dosya yolu ("…/siniflar.json") ya da doğrudan liste.
    # Boşsa kutularda sınıf NUMARASI görünüyor. Koda gömülü liste yok —
    # gerekçesi `_siniflari_yukle` içinde.
    "siniflar": "",
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
        self.siniflar: list[str] = []
        self.siniflar_hatasi: str | None = None

    def ac(self) -> str:
        from hailo_platform import VDevice, HEF, ConfigureParams, HailoStreamInterface

        self._siniflari_yukle()
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

    def _siniflari_yukle(self) -> None:
        """Sınıf adlarını ayardan okur. Bulamazsa NUMARA kalıyor.

        Koda gömülü bir liste YOK ve bilerek: `siniflar` boşken model
        değiştiğinde eski adlar yeni numaraların üstüne binerdi, yani
        "marul" yazan bir kutu aslında başka bir şey olurdu. Adsız kutu
        okunması zor; yanlış adlı kutu yanıltıcı.
        """
        self.siniflar = []
        self.siniflar_hatasi = None
        ham = self.ayar.get("siniflar")
        if isinstance(ham, (list, tuple)):
            self.siniflar = [str(a) for a in ham]
            return
        yol = str(ham or "").strip()
        if not yol:
            return
        try:
            import json
            with open(yol, encoding="utf-8") as dosya:
                veri = json.load(dosya)
        except Exception as hata:
            # Sessiz geçmiyoruz: kullanıcı dosyayı verdiyse adları
            # bekliyordur; numara görüp nedenini aramasın.
            self.siniflar_hatasi = f"sınıf adları okunamadı ({yol}): {hata}"
            return
        if isinstance(veri, dict):
            veri = veri.get("siniflar") or veri.get("classes") or []
        if isinstance(veri, list):
            self.siniflar = [str(a) for a in veri]
        else:
            self.siniflar_hatasi = (
                f"sınıf dosyası bir liste ya da {{\"siniflar\": [...]}} "
                f"olmalı ({yol})")

    def _hazirla(self, ham: bytes):
        """JPEG baytlarını modelin beklediği diziye çevirir — EN-BOY KORUNARAK.

        JPEG çözmek çıkarımın kendisinden pahalı (Pi 5'te onlarca ms'ye
        karşı ölçülen 4.5 ms). Kare aralığı saniyeler olduğu için sorun
        değil, ama sayının nerede harcandığını bilmek gerekiyor.

        EN-BOY: kare eskiden doğrudan `resize((640, 640))` ile
        sıkıştırılıyordu. Bu makinedeki kareler 16:9 (3840x2160), yani
        yatay olarak eziliyorlardı: yuvarlak bir filiz elipse dönüyor ve
        model eğitimde hiç görmediği bir şekle bakıyor. Bedeli iki kere
        ödeniyor — önce tespit kaçıyor, sonra kalan tespitin 0-1
        koordinatı gerçek karede yanlış yere denk geliyor.

        Yerine letterbox: oran korunarak sığdırılıyor, artan yer griyle
        dolduruluyor. Gri 114 rastgele seçilmedi — YOLO ailesi eğitim
        sırasında da bu dolguyu kullanıyor, model onu tanıyor.

        Dönüş `(dizi, kutu)`: `kutu` dolgunun nereye ve ne kadar
        konduğunu söylüyor, `_coz` koordinatı gerçek kareye geri
        çevirirken ona bakıyor.
        """
        import io
        import numpy as np
        from PIL import Image

        gorsel = Image.open(io.BytesIO(ham)).convert("RGB")
        kenar = int(self._giris)
        gen, yuk = gorsel.width, gorsel.height
        oran = min(kenar / gen, kenar / yuk)
        yeni_g, yeni_y = max(1, round(gen * oran)), max(1, round(yuk * oran))
        kucuk = gorsel.resize((yeni_g, yeni_y))
        tuval = Image.new("RGB", (kenar, kenar), (114, 114, 114))
        dolgu_x, dolgu_y = (kenar - yeni_g) // 2, (kenar - yeni_y) // 2
        tuval.paste(kucuk, (dolgu_x, dolgu_y))
        kutu = {"dolgu_x": dolgu_x, "dolgu_y": dolgu_y,
                "gen": yeni_g, "yuk": yeni_y, "kenar": kenar}
        return np.expand_dims(np.asarray(tuval, dtype=np.uint8), axis=0), kutu

    def calistir(self, ham: bytes) -> list[dict[str, Any]]:
        from hailo_platform import (InferVStreams, InputVStreamParams,
                                    OutputVStreamParams)

        dizi, kutu = self._hazirla(ham)
        giris = InputVStreamParams.make(self._model)
        cikis = OutputVStreamParams.make(self._model)
        with InferVStreams(self._model, giris, cikis) as boru:
            ad = list(giris.keys())[0]
            sonuc = boru.infer({ad: dizi})
        return self._coz(sonuc, kutu)

    def _coz(self, sonuc: dict[str, Any],
             kutu: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """NMS'i çipte yapılmış YOLO çıktısını kutulara çevirir.

        Biçim Pi'de doğrulandı (`hailortcli parse-hef`): çıkış
        "HAILO NMS BY CLASS", sınıf başına bir liste ve her satır
        [y1, x1, y2, x2, guven], 0-1 aralığında. Beklenenden farklı
        çıkarsa boş liste dönüyoruz — tespit kaybetmek, çöp kutu
        üretmekten iyi.

        Koordinatlar LETTERBOX TUVALİNE göre geliyor; burada gerçek
        karenin 0-1 uzayına geri çevriliyor. Çevirmezsek dolgu kalınlığı
        kadar kayarlar ve o kayma kalibrasyondan sonra doğrudan
        milimetreye geçer.
        """
        esik = float(self.ayar.get("esik", 0.4))
        k = kutu or {}
        kenar = float(k.get("kenar") or self._giris)
        dolgu_x, dolgu_y = float(k.get("dolgu_x", 0)), float(k.get("dolgu_y", 0))
        gen, yuk = float(k.get("gen") or kenar), float(k.get("yuk") or kenar)

        def _geri(deger: float, dolgu: float, boy: float) -> float:
            return min(1.0, max(0.0, (deger * kenar - dolgu) / max(1.0, boy)))

        adlar = getattr(self, "siniflar", [])
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
                        x1 = _geri(float(satir[1]), dolgu_x, gen)
                        y1 = _geri(float(satir[0]), dolgu_y, yuk)
                        x2 = _geri(float(satir[3]), dolgu_x, gen)
                        y2 = _geri(float(satir[2]), dolgu_y, yuk)
                        # Tamamen dolguya düşen bir kutu geri çevrimden
                        # sonra sıfır alanlı çıkıyor; onu tespit saymak
                        # panelde görünmez bir kutu çizmek olurdu.
                        if x2 - x1 <= 0 or y2 - y1 <= 0:
                            continue
                        ad = (adlar[sinif_no] if 0 <= sinif_no < len(adlar)
                              else str(sinif_no))
                        cikti.append({
                            "sinif": ad,
                            "sinif_no": sinif_no,
                            "guven": round(guven, 3),
                            "x1": round(x1, 4),
                            "y1": round(y1, 4),
                            "x2": round(x2, 4),
                            "y2": round(y2, 4),
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
        # KAMERA BAŞINA TEK SLOT — tek ortak kuyruk değil.
        #
        # Eskiden `queue.Queue(maxsize=1)` vardı. Tek kameralı kurulumda
        # doğruydu; iki kamera birden beslerken iki yerden bozuluyor:
        # (1) biri ötekinin slotunu kapıyor ve öteki kamera sürekli kare
        # düşürüyor, (2) kuyrukta kamera adı taşınmadığı için dönen
        # tespitin hangi kareye ait olduğu kayboluyor — iki kamera farklı
        # yerlere bakarken bu, tespiti kullanılamaz yapıyor.
        #
        # Şimdi her kameranın kendi slotu var ve yalnız KENDİ karesini
        # eziyor. "En yeni kare kazanıyor" kuralı kamera içinde aynen
        # duruyor: bir dakika önceki görüntüyü işlemek hâlâ kimseye bir
        # şey söylemiyor. İşçi slotları sırayla dolaşıyor, böylece sık
        # kare veren bir kamera ötekini aç bırakmıyor.
        self._slot: dict[str, tuple[bytes, float]] = {}
        self._sira: list[str] = []
        self._ip: threading.Thread | None = None
        self._dur = threading.Event()
        self._kilit = threading.Lock()
        # Koşul aynı kilidi kullanıyor: slot, sıra ve sayaçlar tek bir
        # tutarlı bütün. Ayrı kilit, "sayaç arttı ama slot henüz
        # dolmadı" gibi ara durumlar üretirdi.
        self._uyandir = threading.Condition(self._kilit)
        self._surucu = surucu
        self._acik = False

        self.kilitli = False
        self.son_hata: str | None = None
        self.islenen = 0
        self.dusen = 0
        self.hatali = 0
        self._ardisik_hata = 0
        self.son_sure_ms: float | None = None
        # KAMERA BAŞINA son tespit: {kamera: {tespitler, ts, sure_ms}}.
        self.son_tespitler: dict[str, dict[str, Any]] = {}
        self._son_kamera: str = ""
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
            # Sınıf adları açılışı engellemiyor (adsız tespit de değerli)
            # ama sessiz de kalmıyor: kullanıcı dosyayı verdiyse numara
            # değil ad bekliyordur.
            sinif_hata = getattr(self._surucu, "siniflar_hatasi", None)
            if sinif_hata:
                self.gunluk_cb(f"Hailo: {sinif_hata} — kutularda sınıf "
                               f"numarası gösterilecek", "uyari")
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
        # İşçi koşulda bekliyorsa hemen uyansın; `_dur` zaten kurulu
        # olduğu için uyanınca döngüden çıkıyor.
        with self._uyandir:
            self._uyandir.notify_all()
        if self._surucu is not None:
            try:
                self._surucu.kapat()
            except Exception:
                pass
        self._acik = False

    # ------------------------------------------------------- besleme
    def kare_ver(self, ham: bytes, ts: float | None = None,
                 kamera: str = "") -> bool:
        """Kareyi o kameranın slotuna bırakır. Kilitliyse DÜŞÜRÜR.

        Hiçbir koşulda bloke etmiyor ve hiçbir koşulda istisna atmıyor:
        çağıran kamera döngüsü ve orada atılan bir istisna kareyi
        kaybettirirdi.

        `kamera` boş geçilirse "?" yazılıyor — adsız kare kaybolmuyor ama
        hangi kameradan geldiği de uydurulmuyor.
        """
        if not self._acik or self._dur.is_set():
            return False
        self._saglik_bak()
        if self.kilitli:
            with self._kilit:
                self.dusen += 1
            return False
        ad = str(kamera or "").strip() or "?"
        with self._uyandir:
            if ad in self._slot:
                # Önceki kare daha işlenmeden yenisi geldi: eski düşüyor.
                self.dusen += 1
            else:
                self._sira.append(ad)
            # Kopya ŞART: kamera tamponunu yeniden kullanıyorsa, referans
            # bırakmak işçinin üstüne yazılan bir kareyi okuması demek.
            self._slot[ad] = (bytes(ham), ts or time.time())
            self._uyandir.notify()
        return True

    # -------------------------------------------------------- işçi
    def _dongu(self) -> None:
        while not self._dur.is_set():
            with self._uyandir:
                # Sırada kimse yoksa bekliyoruz. Zaman aşımlı bekleme,
                # `durdur` bildirimini kaçırsak bile döngünün yarım
                # saniyede kendine gelmesi için.
                if not self._sira and not self._dur.is_set():
                    self._uyandir.wait(0.5)
                if self._dur.is_set():
                    break
                if not self._sira:
                    continue
                kam = self._sira.pop(0)
                is_ = self._slot.pop(kam, None)
            if is_ is None:
                continue
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
                    self.son_tespitler[kam] = {
                        "tespitler": tespitler,
                        "ts": ts,
                        "sure_ms": round(sure, 1),
                    }
                    self._son_kamera = kam
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
                # Eski alanlar duruyor: en son işlenen karenin tespitleri.
                # Tek kameralı kurulumda anlamları değişmiyor.
                "tespit": len(self.son_tespit),
                "tespitler": self.son_tespit[:20],
                "tespit_ts": self.son_tespit_ts,
                "son_kamera": self._son_kamera,
                # KAMERA BAŞINA: hangi kutunun hangi kareye ait olduğu
                # ancak burada belli oluyor.
                "kameralar": {
                    ad: {"tespit": len(v.get("tespitler") or []),
                         "tespitler": (v.get("tespitler") or [])[:20],
                         "ts": v.get("ts"),
                         "sure_ms": v.get("sure_ms")}
                    for ad, v in self.son_tespitler.items()
                },
            }


def olustur(ayar: dict[str, Any], gunluk_cb=None, surucu=None) -> Hailo:
    return Hailo(ayar, gunluk_cb, surucu)
