"""Farmbot köprü ajanı — Raspberry Pi üzerinde çalışır.

    Arduino ──USB seri──> [ BU PROGRAM ] ──WSS──> bulut sunucusu ──> tarayıcı
                               │
                               └── Modbus TCP ──> PLC (X/Y/Z portal)

Görevleri:
  1. Arduino'dan gelen `VERI:` satırlarını buluta iletmek.
  2. PLC'den eksen konumlarını okuyup durum olarak yayınlamak.
  3. Buluttan gelen komutları PLC'ye / Arduino'ya çevirmek.

ÖNEMLİ — tek yazıcı kuralı
--------------------------
Bu program çalışırken PLC'ye başka hiçbir şey yazmamalı. Gantry Studio
(`gantry_studio.py`) aynı register'lara yazıyor; ikisi birlikte çalışırsa
komutlar çakışır ve makine öngörülemez davranır. Pi'de Gantry Studio servisi
varsa kapatın:  `sudo systemctl disable --now gantry-studio`

Tasarım kuralı: bağlantı koparsa makine güvenli tarafa düşmeli. Bu yüzden
sulama kararı Arduino'da duruyor ve bulut bağlantısı koptuğu anda ajan tüm
jog bitlerini bırakıyor.

Çalıştırma:
    python3 ajan.py ayarlar.json
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
import time
from typing import Any

import arduino as arduino_modulu
import bolgeler as bolge_modulu
import plc as plc_modulu
import dizi as dizi_modulu

#: Karttaki röleler. Tek yerde duruyor ki panel, ajan ve firmware üçü de
#: aynı listeyi konuşsun; kart bunlardan başkasını tanımıyor.
ROLELER = {"su_pompasi": "Su pompası", "hava_pompasi": "Hava pompası"}
import hailo as hailo_modulu
import kamera as kamera_modulu
import uclar as uc_modulu

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ajan")

VARSAYILAN_AYAR = {
    "sunucu": "wss://farmbot-api.onrender.com/ws/ajan",
    "jeton": "DEGISTIRIN",
    # toprak_kuru / toprak_islak: probun havada ve suda okuduğu HAM değerler.
    # Yüzde bunlara göre ölçekleniyor.
    #
    # Varsayılan teorik uçlar. Gerçek prob suda sıfır okumuyor, yani bu ölçek
    # DOĞRU DEĞİL — ama tahmin edilmiş bir sayı yazmaktansa eski, bilinen
    # davranışta kalmak iyi: ölçmeden konan değer sonradan "kalibre edildi"
    # sanılıyor. Ölçmek için:
    #   python3 toprak-kalibre.py kuru   /   python3 toprak-kalibre.py islak
    "arduino": {"port": "/dev/ttyUSB0", "baud": 9600, "sahte": False,
                "toprak_kuru": 1023, "toprak_islak": 0},
    "plc": {
        "sahte": False,
        "ip": "192.168.1.88",
        "port": 502,
        "birim": 1,
        "guvenli_z": 340.0,
        # Toprak YÜZEYİNİN makine Z'si. Sıfır değil: bu kurulumda kapların
        # üstü 170 mm'de. Varsayılanı 0 bırakmak, yüzeyi bilmeyen her yerin
        # (profil görüntüleyici, sulama Z'si, ekim derinliği) makine
        # sıfırını toprak sanması demekti.
        # Ölçmek için: python3 toprak-olc.py
        "toprak_z": 170.0,
        # Toprak yüzeyinin T karşılığı: tohum ucu kendi ekseniyle bu kadar
        # uzayınca yüzeye değiyor. Ekim derinliği bunun üstüne biniyor.
        # Ölçülmeden 0 kalır ve o hâlde ekim ana Z ile sürer.
        "toprak_t": 0.0,
        # Tohum ucu "çekilmiş" sayılmak için hedefe bu kadar mm yaklaşmalı.
        # X/Y hareketi buna bağlı. Kodda 1,5 mm sabitti; servo payı
        # makineden makineye değiştiği için ayara alındı.
        "guvenli_t": 1.5,
        "hiz": 20.0,
        # Eksen başına hız. Sahada seçilen değerler VARSAYILAN oldu:
        # X ve Y 20, Z 10.
        # Kullanıcı her açılışta panelden girmek zorunda kalmasın diye
        # burada duruyorlar; panelden değiştirmek yine mümkün ve o
        # değişiklik o oturum için geçerli.
        #
        # Z'nin yarı hızda olması bilinçli: dikey eksen yük altında ve
        # toprağa iniyor, X/Y ile aynı hızda sürülmesi için sebep yok.
        "hiz_x": 20.0,
        "hiz_y": 20.0,
        "hiz_z": 10.0,
        # T = tohum ucunun kendi dikey ekseni. Toplam stroku 55 mm ve
        # toprağa giriyor; X/Y hızında sürülmesi için sebep yok.
        "hiz_t": 10.0,
        "ivme": 100.0,
        "yavaslama": 100.0,
        "kalibrasyon_dosyasi": "gantry_calib.json",
    },
    # aralik_sn kamera.py'deki varsayilanla AYNI olmali: burasi 30 yazarken
    # oradaki ve belgelerdeki "bir saat" hicbir zaman gecerli olmuyordu.
    # genislik/canli_genislik kamera.py'deki VARSAYILAN ile AYNI olmalı:
    # çekim 1920 (filiz 640'ta birkaç piksel kalıp eleniyordu), ağdan
    # geçen akış 640.
    "kamera": {"aktif": False, "aralik_sn": 3600.0, "genislik": 1920,
               "canli_genislik": 640, "sahte": False},
    # Hailo AI HAT — varsayılan KAPALI, HAT'i olmayan kurulum etkilenmesin.
    "hailo": {"aktif": False, "sahte": False},
    "durum_araligi_sn": 0.5,
}


def ayar_yukle(yol: str) -> dict[str, Any]:
    if not os.path.exists(yol):
        raise SystemExit(
            f"Ayar dosyası bulunamadı: {yol}\n"
            "ayarlar.ornek.json dosyasını kopyalayıp ayarlar.json adıyla düzenleyin."
        )
    with open(yol, encoding="utf-8") as dosya:
        kullanici = json.load(dosya)

    def birlestir(temel: dict, ust: dict) -> dict:
        sonuc = dict(temel)
        for anahtar, deger in ust.items():
            if isinstance(deger, dict) and isinstance(sonuc.get(anahtar), dict):
                sonuc[anahtar] = birlestir(sonuc[anahtar], deger)
            else:
                sonuc[anahtar] = deger
        return sonuc

    ayar = birlestir(VARSAYILAN_AYAR, kullanici)

    # Kalibrasyon Gantry Studio'nun kendi dosya biçiminde: [X, Y, Z] sırayla
    # cpm / dir / home / min / max. Makinede zaten bu dosya var; kopyalayıp
    # yanına koymak, değerleri elle aktarmaktan güvenli.
    kal_yol = ayar["plc"].get("kalibrasyon_dosyasi")
    if kal_yol and not ayar["plc"].get("kalibrasyon"):
        tam = kal_yol if os.path.isabs(kal_yol) else os.path.join(os.path.dirname(yol) or ".", kal_yol)
        if os.path.exists(tam):
            with open(tam, encoding="utf-8") as dosya:
                ayar["plc"]["kalibrasyon"] = json.load(dosya)
            # Panelden kaydedilince aynı dosyaya geri yazılabilsin.
            ayar["plc"]["kalibrasyon_tam_yol"] = tam
            logger.info("Kalibrasyon okundu: %s", tam)
        else:
            # Hangi zarfın geçerli olduğunu SAYIYLA yazıyoruz. "Varsayılanlar
            # kullanılacak" demek yetmiyor: sahadaki koordinatlar reddedilmeye
            # başlarsa sebebin bu satır olduğu ancak sayılar görününce anlaşılıyor.
            zarf = " · ".join(
                f"{ad} 0–{k['max']:.0f} mm"
                for ad, k in zip(("X", "Y", "Z"), plc_modulu.VARSAYILAN_KALIB))
            logger.warning(
                "Kalibrasyon dosyası yok (%s) — koddaki ölçülmüş varsayılanlar "
                "kullanılacak: %s", tam, zarf)
    return ayar


class Ajan:
    def __init__(self, ayar: dict[str, Any], ayar_yolu: str = "") -> None:
        self.ayar = ayar
        # Kamera tanımları ayarlarla AYNI klasörde ayrı bir dosyada
        # (`kameralar.json`); panelden düzenlenebilmesi için gereken tek şey
        # bu yolu bilmek.
        self.ayar_yolu = ayar_yolu or os.path.join(os.path.dirname(__file__),
                                                   "ayarlar.json")
        self.dongu: asyncio.AbstractEventLoop | None = None
        self.kuyruk: asyncio.Queue = asyncio.Queue(maxsize=200)
        self.ws = None

        # Yasak bölgeler ajanda: panel çökse, sunucu düşse, komut başka bir
        # arayüzden gelse de koruma çalışsın.
        self.bolgeler = bolge_modulu.Bolgeler(ayar.get("plc", {}), gunluk_cb=self._gunluk_gonder)
        self.plc = plc_modulu.olustur(
            ayar["plc"], gunluk_cb=self._gunluk_gonder,
            bolgeler=self.bolgeler, baglam_saglayici=self._kosul_baglami)
        # Üç sabit başın kaymaları ve tohumluk gözleri burada.
        self.uclar = uc_modulu.Uclar(ayar.get("plc", {}), self.plc,
                                     gunluk_cb=self._gunluk_gonder)
        # PLC'deki "Z güvenli yükseklikte" biti. Uç değiştirme alanı
        # muafiyeti KALDIRILDI: uç takıp çıkarmak diye bir şey kalmadı,
        # muafiyetin de sebebi kalmadı — Z kilidi artık koşulsuz.
        self.plc.z_guvenli_kaynagi = self.uclar.z_guvenli_reg_oku
        # Tohum ucunun "tam çekilmiş" T değeri ayardan gelebiliyor; boşken
        # kalibrasyonun `home`u geçerli (bkz. `plc.t_yukari_mm`).
        self._t_yukari_uygula()
        self._guvenli_z_ofset_uygula()
        self._guvenli_z_uygula()
        self._guvenli_t_uygula()
        self._hiz_uygula()
        ard = ayar["arduino"]
        # Medyan penceresi: kaç örneğin ortancası gösterilsin. 5 örnek,
        # 2 sn'lik okuma aralığında 10 saniyelik bir pencere demek — tek
        # tük sıçramayı eler, gerçek bir değişimi geciktirmez. Ayarda
        # `medyan_pencere` ile değiştirilebiliyor; 1 = yumuşatma kapalı
        # (yalnız yuvarlama ve saçma okuma ayıklama kalır).
        pencere = int(ard.get("medyan_pencere", 5))
        if ard.get("sahte"):
            self.arduino = arduino_modulu.SahteArduino(
                geri_cagir=self._olcum_geldi, medyan_pencere=pencere)
        else:
            self.arduino = arduino_modulu.Arduino(
                port=ard.get("port", "/dev/ttyUSB0"),
                baud=int(ard.get("baud", 9600)),
                geri_cagir=self._olcum_geldi,
                medyan_pencere=pencere,
            )
        # UÇ SEÇİCİ. Kart hiç veri göndermeden önce de bir cevabımız
        # olmalı ve o cevap "bilinmiyor" — sıfır değil.
        self._uc_secili: Any = None
        self._uc_aci: Any = None
        self._uc_harekette = False

        # Program dizisi ajanda yürüyor: panel kapansa da acil durdurma
        # diziyi kesebilsin diye.
        self.dizi = dizi_modulu.Dizi(self.plc, self.uclar,
                                     lambda k: self.arduino.komut(k),
                                     gunluk_cb=self._gunluk_gonder)
        # ÇIKARIM kameradan ÖNCE kuruluyor: kamera kancayı kurucuda
        # istiyor. Hailo kapalıysa `kare_ver` hemen False dönüyor,
        # kamera hiçbir şey fark etmiyor.
        self.hailo = hailo_modulu.olustur(ayar.get("hailo", {}),
                                          gunluk_cb=self._gunluk_gonder)
        # KAMERALAR — birden çok. Her biri kendi iş parçacığında; biri
        # arızalanınca öteki durmuyor.
        self.kameralar: dict[str, kamera_modulu.Kamera] = {}
        self._kameralari_kur(kamera_modulu.tanimlari_yukle(self.ayar_yolu, ayar))
        self._son_durum: dict[str, Any] = {}

    # --- kameralar -------------------------------------------------------
    def _kameralari_kur(self, tanimlar: list[dict[str, Any]]) -> None:
        """Tanımlardan kamera nesnelerini üretir (sıra korunur).

        ÇIKARIM YALNIZ HAREKETLİ KAMERADA. Hailo tespitini yatağın bir
        koordinatına çevirmenin tek yolu karenin çekildiği X/Y; sabit
        kamerada o yok. Sabit kameranın karesini çıkarıma vermek, sonucu
        koyacak yeri olmayan bir hesap yaptırmak olurdu.
        """
        self.kameralar = {}
        for tanim in tanimlar:
            kam = kamera_modulu.Kamera(
                tanim, self._kare_geldi, gunluk_cb=self._gunluk_gonder,
                cikarim=(self.hailo.kare_ver if tanim.get("hareketli", True) else None))
            self.kameralar[kam.ad] = kam

    @property
    def kamera(self) -> kamera_modulu.Kamera:
        """İlk kamera — tek kameralı çağrı yerleri için."""
        return next(iter(self.kameralar.values()))

    def _kamera_sec(self, ad: Any) -> kamera_modulu.Kamera | None:
        if not ad:
            return self.kamera if self.kameralar else None
        return self.kameralar.get(kamera_modulu.ad_temizle(ad, ""))

    #: Kuru ve ıslak ucun arasında en az bu kadar sayım olmalı.
    #: `toprak-kalibre.py` ile aynı eşik.
    EN_AZ_KALIB_ARALIK = 100

    def _toprak_kalib(self) -> dict[str, float]:
        """Panele gidecek toprak ölçeği — makul değilse varsayılana döner.

        Ayar dosyasında dar aralıklı bir kalibrasyon kalabiliyor (prob
        bağlıyken ölçülmüşse). Onu olduğu gibi kullanmak, gürültüyü %0-100
        arasında zıplayan sahte bir ölçüme çevirir. Betik böyle bir kaydı
        artık reddediyor ama dosyada eskiden kalmış olabilir.
        """
        ard = self.ayar.get("arduino", {})
        kuru = float(ard.get("toprak_kuru", 1023))
        islak = float(ard.get("toprak_islak", 0))
        if abs(kuru - islak) < self.EN_AZ_KALIB_ARALIK:
            if not getattr(self, "_kalib_uyarildi", False):
                self._kalib_uyarildi = True
                logger.warning(
                    "Toprak kalibrasyonu makul değil (kuru %.0f, ıslak %.0f — "
                    "arada yalnızca %.0f sayım). Yok sayılıyor, 0-1023 ölçeği "
                    "kullanılıyor. Prob çalışır hâle gelince "
                    "'python3 toprak-kalibre.py kuru' ve '... islak' ile "
                    "yeniden ölçün.", kuru, islak, abs(kuru - islak))
            return {"kuru": 1023.0, "islak": 0.0}
        return {"kuru": kuru, "islak": islak}

    def _hiz_uygula(self) -> None:
        """Kaydedilmiş hızları PLC sürücüsüne taşır — açılışta.

        HIZLAR ESKİDEN KALICI DEĞİLDİ. `hiz` ve `hiz_eksen` komutları
        yalnız `self.plc` üstünde değişiklik yapıyordu; ajan yeniden
        başlayınca `ayar.json`daki varsayılanlar geri geliyordu. Ajan da
        sık yeniden başlıyor — `arduino-yukle.sh` ve `guncelle.sh`
        servisi durdurup açıyor. Sonuç: kullanıcı Z hızını 10'a çekiyor,
        bir süre sonra makine 20 ile iniyor ve bunu söyleyen hiçbir şey
        yok.

        GİRİLMEMİŞ DEĞER (None) ATLANIYOR — `ayar.json`daki hız geçerli
        kalıyor. Boş bir alanı sıfır sayıp yazmak, o ekseni durdurmak
        olurdu.

        `_guvenli_z_uygula` ile aynı kalıp.
        """
        try:
            genel = self.uclar.hiz()
            if genel is not None:
                self.plc.hiz_ayarla(genel)
            eksen = self.uclar.hiz_eksen()
            if any(h is not None for h in eksen):
                # Kayıtta girilmemiş kalan eksen, sürücünün kendi
                # değerinde bırakılıyor; hepsini birden ezmek, tek bir
                # ekseni kaydeden kullanıcının ötekileri silmesi olurdu.
                simdiki = list(getattr(self.plc, "hiz_eksen", [None] * 4))
                simdiki = (simdiki + [None] * 4)[:4]
                self.plc.hiz_eksen = [
                    yeni if yeni is not None else eski
                    for yeni, eski in zip(eksen, simdiki)]
            logger.info("Hızlar ayardan yüklendi: genel=%s eksen=%s",
                        genel, eksen)
        except Exception:                                    # noqa: BLE001
            pass

    def _guvenli_t_uygula(self) -> None:
        """`guvenli_t` ayarını PLC sürücüsüne taşır.

        Pay koda 1.5 mm gömülüydü ve yalnız `ajan/ayar.json`dan
        değiştirilebiliyordu. Sahada belirtisi şuydu: uç yukarıda olduğu
        hâlde "Tohum ucu aşağıda — önce yukarı çekilmeli" denip dizi
        durdu. Pay eksenin gerçek oturma sapmasından küçükse bu kaçınılmaz
        ve kullanıcının elinde ayar yoktu.

        Girilmemişse dokunulmuyor: `ayar.json`daki değer geçerli kalıyor.
        `_guvenli_z_ofset_uygula` ile aynı kalıp.
        """
        try:
            g = self.uclar.guvenli_t()
            if g is not None:
                self.plc.guvenli_t = g
        except Exception:                                    # noqa: BLE001
            pass

    def _guvenli_z_uygula(self) -> None:
        """`safe_z` ayarını PLC sürücüsünün `guvenli_z`sine taşır.

        BU BAĞ HİÇ KURULMAMIŞTI ve `safe_z` ÖLÜ BİR AYARDI. `uclar.py`de
        tek bir yerde geçiyordu: varsayılan tanımının kendisi. Panelde
        alanı var, ajan onu panele geri bildiriyor, panel kaydediyor —
        kapalı ve hiçbir şeye dokunmayan bir döngü.

        MAKİNEYİ YÖNETEN SAYI BAŞKAYDI: PLC sürücüsündeki `guvenli_z`.
        X/Y hareketinden önce Z'nin kaldırıldığı yükseklik, "Önce Z'yi
        kaldırın" retleri, `z_guvenli` biti ve bölge koşullarındaki
        `safe_z` DEĞİŞKENİ (evet, aynı ad) hep ondan geliyor. O da yalnız
        `ajan/ayar.json` içindeki `plc.guvenli_z`den okunuyordu ve
        panelde hiçbir alanı yoktu.

        Belirtisi: kullanıcı safe_z'yi değiştiriyor, kayıt başarılı
        diyor, hiçbir şey olmuyor — panelin altındaki "Güvenli Z
        yüksekliği" yazısı bile eski sayıda kalıyor, çünkü o yazı
        `guvenli_z`yi gösteriyor. Panelin kendi açıklaması ise safe_z
        için "X/Y hareketinin yapılabildiği en düşük Z" diyor: metin
        doğru davranışı anlatıyordu, kod onu yapmıyordu.

        BOŞ BIRAKILIRSA DOKUNULMUYOR — `ayar.json`daki değer geçerli
        kalıyor. `None`ı sıfır sayıp ezmek, ayarı hiç girmemiş bir
        kurulumda Z kilidini kaldırmak olurdu.

        `_guvenli_z_ofset_uygula` ile aynı kalıp; çağrıldığı yerler de
        aynı (kurulum ve `uc_kaydet`).
        """
        try:
            ham = self.uclar.ayar.get("safe_z")
            if ham is None:
                return
            deger = float(ham)
        except (TypeError, ValueError):
            return
        try:
            eski = float(getattr(self.plc, "guvenli_z", 0.0))
        except (TypeError, ValueError):
            eski = 0.0
        if abs(eski - deger) < 1e-9:
            return
        self.plc.guvenli_z = deger
        # DEĞİŞİKLİK GÜNLÜĞE YAZILIYOR. Güvenli Z bir emniyet sayısı;
        # sessizce değişmesi "makine neden başka türlü davranıyor"
        # sorusunu doğurur. İki kaynak ayrı düşmüşse burada görünür.
        logger.info("Güvenli Z %.1f mm -> %.1f mm (uclar.json safe_z)",
                    eski, deger)

    def _guvenli_z_ofset_uygula(self) -> None:
        """`guvenli_z_ofset` ayarını PLC sürücüsüne taşır.

        Ayar `uclar.json`da (panelden düzenlenen dosya), kural ise PLC
        sürücüsünde. İkisini bağlayan tek yer burası — `_t_yukari_uygula`
        ile aynı kalıp.
        """
        try:
            self.plc.guvenli_z_ofset = self.uclar.guvenli_z_ofset()
        except Exception:                                    # noqa: BLE001
            pass

    def _t_yukari_uygula(self) -> None:
        """`baslar.tohum.t_yukari_mm` ayarını PLC sürücüsüne taşır."""
        try:
            self.plc.t_yukari_ezme = self.uclar.bas("tohum").get("t_yukari_mm")
        except Exception:                                    # noqa: BLE001
            self.plc.t_yukari_ezme = None

    def _kosul_baglami(self) -> dict[str, Any]:
        """Bölge koşullarında kullanılan makine durumu.

        `prox` (varlık sensörü) ve `tool` (takılı uç) uç değiştirme eklenince
        dolacak; şimdilik sabit. Değerlerin buradan geçmesi, koşul yazan
        kişinin bugün de `prox` ve `tool` kullanabilmesi demek — sonuç
        değişmiyor ama ifade geçersiz olmuyor.
        """
        # `prox` ve `tool` uç değiştirmeyle birlikte kalktı. Anahtarlar
        # DURUYOR: kaydedilmiş bir bölge koşulu bunları kullanıyor olabilir
        # ve ifadeyi geçersiz kılmak, bölgeyi sessizce devre dışı bırakmak
        # olurdu. Değerleri artık sabit.
        return {"prox": False, "tool": ""}

    # --- başka iş parçacıklarından gelen olaylar -------------------------
    def _konum_ekle(self, veri: dict[str, Any]) -> dict[str, Any]:
        """Ölçüme/kareye o anki eksen konumunu iliştirir.

        Toprak nemi tek başına bir sayı; "yatağın neresinde ölçüldü" bilgisi
        olmadan haritaya konamaz. Aynısı kamera karesi için de geçerli.
        Konumu ajan ekliyor çünkü tek doğru kaynak burası — sunucu ölçümün
        hangi anda alındığını bilse de makinenin nerede olduğunu bilmiyor.

        PLC kopuksa alanlar boş geçiyor; ölçüm yine kaydediliyor, sadece
        haritada görünmüyor.
        """
        try:
            k = self._son_durum.get("konum") or {}
            if k.get("x") is not None:
                veri = {**veri, "konum_x": k["x"], "konum_y": k["y"], "konum_z": k.get("z")}
        except Exception:
            pass
        return veri

    # ------------------------------------------------------------------ #
    # UÇ SEÇİCİ — kilit ve kapılar
    #
    # Servo Arduino'da, Z ise PLC'de. İkisini birden gören tek yer ajan;
    # kilit bu yüzden burada. `plc.t_yatay_engel` ile aynı aile: engel
    # varsa SEBEBİ metin olarak dönüyor, boş metin "engel yok" demek.
    # ------------------------------------------------------------------ #
    def uc_secim_engel(self) -> str:
        """Başka bir başlığı indirmeyi engelleyen sebep varsa metni, yoksa ''.

        MEKANİZMA: üç başlık tek parçada birleştirilmiş ama DÖNMÜYORLAR;
        her biri kendi sabit yerinde duruyor ve servo yalnız sırası
        geleni AŞAĞI İNDİRİYOR. Dolayısıyla kural "dönerken sürükleme"
        değil: inmiş bir başlık toprağın içindeyken ikinci bir başlığı
        indirmek, onu da toprağa sokar ve inen ilkini çekmeden ikinciyi
        indirmek mekanizmayı zorlar.

        İKİ KURAL, SIRAYLA. Mekanizmanın kendi eşiği
        (`uc_secici.guvenli_z`) girilmişse o geçerli — inen başlığın
        çekilmiş sayılabilmesi için gereken yükseklik, ölçülerek
        giriliyor. Girilmemişse karar genel Z güvenlik kuralına
        (`plc.z_guvenli_mi`) kalıyor. Hangi kuralın uygulandığı metinde
        yazılı; "neden inmiyor" sorusu iki ayrı sayıdan hangisine
        bakılacağını da söylemeli.

        Konum okunamıyorsa engel VAR diyoruz: hata anında serbest
        bırakmak, ikinci bir başlığı toprağa sokmanın en kolay yolu.
        """
        guvenli_z = (self.uclar.uc_secici() or {}).get("guvenli_z")
        if guvenli_z is not None:
            try:
                simdiki = self.plc.konum_mm()[2]
            except Exception:
                return ("Z konumu okunamıyor — başlık indirilmiyor. "
                        "Robot bağlantısını denetleyin.")
            if simdiki >= float(guvenli_z):
                return ""
            return (f"Z {simdiki:.0f} mm — başlık {float(guvenli_z):.0f} mm'nin "
                    f"altında indirilmiyor. İnmiş bir başlık toprağın "
                    f"içindeyken ikincisini indirmek onu da toprağa sokar. "
                    f"Önce Z'yi kaldırın. (Eşik: Ayarlar → Başlar → uç "
                    f"seçici güvenli yüksekliği.)")
        try:
            guvenli = self.plc.z_guvenli_mi()
        except Exception:
            guvenli = False
        if guvenli:
            return ""
        return (f"Z aşağıda — başlık indirilmiyor. İnmiş bir başlık toprağın "
                f"içindeyken ikincisini indirmek onu da toprağa sokar. Önce "
                f"Z'yi güvenli yüksekliğe (≥ {self.plc.guvenli_z:.0f} mm) "
                f"kaldırın. Mekanizmanın kendi eşiği girilmemiş; girilirse "
                f"genel kural yerine o geçerli olur (Ayarlar → Başlar → uç "
                f"seçici güvenli yüksekliği).")

    # KARTIN RAPOR ARASI (saniye). Firmware `OLCUM_ARALIGI_MS = 2000`.
    # Uç yerine oturunca firmware `sonOlcum = 0` yazıp raporu beklemeden
    # gönderiyor, yani onay normalde anında geliyor; bu sayı o rapor
    # kaçarsa bir sonrakini bekleyebilmek için. Firmware'de aralık
    # büyütülürse burası da büyümeli.
    OLCUM_ARALIGI_SN = 2.0
    #: Servo süresine eklenen onay payı — iki rapor fırsatı.
    UC_ONAY_PAYI_SN = 2 * OLCUM_ARALIGI_SN
    # BÜTÜN HAZIRLIĞIN ÜST SINIRI. Sunucu bu komutu `KOMUT_ZAMAN_ASIMI`
    # = 20 sn beklyor (sunucu/main.py); aşarsak panel 504 alıyor ve
    # ajan işi başlatıp başlatmadığını söyleyemiyor — en kötü sonuç bu.
    # `sure_ms` panelden 10 000 ms'ye kadar girilebiliyor ve önce süren
    # bir hareketi, sonra kendi komutumuzu beklersek iki tam süre üst
    # üste biniyor (10+4 + 10+4 = 28 sn). Bütçe o yüzden burada
    # kesiliyor: aşarsa panele ZAMAN AŞIMI değil, sebebi yazılı bir RET
    # gidiyor. Sunucudaki sayı büyürse burası da büyüyebilir.
    UC_HAZIRLIK_BUTCESI_SN = 15.0

    async def _uc_yerine_otursun(self, istenen: int, bitis: float) -> bool:
        """Kart 'istenen uç seçili ve hareket bitti' diyene kadar bekler.

        BEKLEMEK ŞART. Servo 90 dereceyi anında dönmüyor ve kart süre
        dolana kadar `uc_hareket` 1 diyor. Komutu yollayıp hemen işe
        başlamak, başlık daha yoldayken sulamayı açmak olurdu.

        `bitis` `time.monotonic()` ölçeğinde son an — bütçe çağırandan
        geliyor, çünkü ondan önce süren bir hareketi beklemiş olabiliriz.
        """
        while time.monotonic() < bitis:
            if (not self._uc_harekette and self._uc_secili is not None
                    and int(self._uc_secili) == istenen):
                return True
            await asyncio.sleep(0.1)
        return False

    async def _uc_hazirla(self, kimlik: str) -> str:
        """İşin gerektirdiği başlığı indirir; olmuyorsa sebebini döner.

        ESKİDEN REDDEDİYORDU, ARTIK KENDİSİ SEÇİYOR. Uç konumu
        bilinmiyorken (kart açılışta ve her sıfırlanmada unutuyor) iş
        reddediliyor ve kullanıcı Sür sekmesine gönderiliyordu. İşin
        hangi başlığı gerektirdiği zaten adımlardan belli (`_dizi_basi`);
        bilinen bir şeyi kullanıcıya sordurmak yerine servo komutu
        buradan gidiyor.

        KENDİLİĞİNDEN HAREKET EDEN BİR MEKANİZMA — kurallar korunuyor:
          - Z aşağıdayken seçim yapılmıyor (`uc_secim_engel`). İnen
            başlık toprağın içinden sürüklenmesin diye; engel varsa iş
            başlamıyor ve sebebi yazılıyor.
          - Bir başlık hareket hâlindeyken üstüne ikinci komut
            gitmiyor; önce oturması bekleniyor.
          - Komut gittikten sonra KARTIN ONAYI bekleniyor. Servoda geri
            besleme yok, ama kart komut ettiği açıyı ve hareketin bitip
            bitmediğini bildiriyor; iş ancak o onay gelince başlıyor.
            Onay gelmezse iş başlamıyor — komut edileni ölçülmüş gibi
            saymıyoruz.
        """
        kimlik = str(kimlik or "")
        istenen = self.uclar.bas_indeksi(kimlik)
        if istenen < 0:
            return ""                      # iş bir başa bağlı değil
        ad = (uc_modulu.BAS_BILGI.get(kimlik) or {}).get("ad", kimlik)
        sure_sn = self.uclar.servo_sure_ms() / 1000.0
        bekleme_sn = sure_sn + self.UC_ONAY_PAYI_SN
        # Bütçe ÇAĞRININ TAMAMI için; iki bekleme üst üste binerse ikincisi
        # kalanla yetiniyor.
        son_an = time.monotonic() + self.UC_HAZIRLIK_BUTCESI_SN

        # Süren bir hareket varsa bitmesini bekliyoruz; hedef zaten bu
        # başlıksa bekleme bittiğinde iş yapılacak bir şey kalmıyor.
        if self._uc_harekette:
            bitis = min(time.monotonic() + bekleme_sn, son_an)
            while self._uc_harekette and time.monotonic() < bitis:
                await asyncio.sleep(0.1)
            if self._uc_harekette:
                return (f"Uç değişimi {bekleme_sn:.1f} saniyede bitmedi — "
                        f"{ad} yerine oturmadan iş başlamıyor.")

        if self._uc_secili is not None and int(self._uc_secili) == istenen:
            return ""                      # doğru başlık zaten inmiş

        # DEĞİŞTİRMEK GEREKİYOR. Önce Z kilidi: inmiş bir başlık
        # çekilmeden servo dönemez.
        engel = self.uc_secim_engel()
        if engel:
            return engel
        komut, sebep = self.uclar.servo_komutu(kimlik)
        if sebep:
            return sebep

        # NE OLDUĞU GÜNLÜĞE YAZILIYOR. Makine kendiliğinden hareket
        # ediyor; kullanıcı basmadığı bir hareketi günlükte görmeli.
        if self._uc_secili is None:
            self._gunluk_gonder(
                f"Uç konumu bilinmiyordu — bu iş {ad} ile yapılıyor, "
                f"başlık indiriliyor.", "uyari")
        else:
            onceki = uc_modulu.BASLAR[int(self._uc_secili)] \
                if 0 <= int(self._uc_secili) < len(uc_modulu.BASLAR) else "?"
            onceki_ad = (uc_modulu.BAS_BILGI.get(onceki) or {}).get("ad", onceki)
            self._gunluk_gonder(
                f"Seçili uç {onceki_ad}; bu iş {ad} ile yapılıyor, "
                f"başlık değiştiriliyor.", "uyari")

        try:
            await asyncio.to_thread(self.arduino.komut, komut)
        except RuntimeError as hata:
            return f"{ad} indirilemedi: {hata}"

        bitis = min(time.monotonic() + bekleme_sn, son_an)
        if not await self._uc_yerine_otursun(istenen, bitis):
            return (f"{ad} {bekleme_sn:.1f} saniyede yerine oturduğunu "
                    f"bildirmedi — iş başlatılmadı. Kart bağlı mı? "
                    f"Servo hareket süresi Ayarlar → Başlar'da.")
        return ""

    @staticmethod
    def _dizi_basi(adimlar: list[dict[str, Any]]) -> str:
        """Bu dizi hangi başı kullanıyor — ADIMLARDAN, addan değil.

        Dizinin adı kullanıcı metni ve değişebiliyor; adımlar ise işin
        kendisi. Su pompası rölesini açan bir dizi sulama başlığıyla,
        tohum ucunun kendi eksenini süren ya da tohumluk gözü işaretleyen
        bir dizi tohum ucuyla yapılıyor. Hiçbiri yoksa '' dönüyor ve
        kapı hiç kurulmuyor — bilmediğimiz bir iş için uç dayatmak,
        çalışan bir diziyi durdurmak olurdu.
        """
        for adim in adimlar or []:
            tip = str(adim.get("tip", ""))
            if tip == "role" and str(adim.get("ad", "")) == "su_pompasi":
                return "sulama"
            if tip in ("uc_dikey", "goz"):
                return "tohum"
        return ""

    def _olcum_geldi(self, veri: dict[str, Any]) -> None:
        """Seri port iş parçacığından çağrılır — asyncio'ya güvenli aktarım."""
        # SEÇİLİ UÇ KARTTAN GELİYOR, BURADA TAHMİN EDİLMİYOR. `uc_sec`
        # komutu gönderdikten sonra "artık şu uç seçili" diye yazsaydık,
        # kart sıfırlandığında panel hâlâ eski ucu gösterirdi. Kartın
        # bildirdiği değer tek kaynak; kart bilmiyorsa (açılış, sıfırlama)
        # None kalıyor ve iş başlatma kapısı da bunu görüyor.
        self._uc_secili = veri.get("uc_secili")
        self._uc_aci = veri.get("uc_aci")
        self._uc_harekette = bool(veri.get("uc_hareket"))
        self._kuyruga_at({"tip": "olcum", "ts": time.time(), "veri": self._konum_ekle(veri)})

    def _kare_geldi(self, kam_ad: str, b64: str, ts: float) -> None:
        """Kamera iş parçacığından çağrılır.

        KONUM YALNIZ HAREKETLİ KAMERAYA yazılıyor. Sabit kamera makineyle
        gitmiyor; o an makinenin nerede olduğu, o karenin neyi gösterdiği
        hakkında hiçbir şey söylemiyor. Konumu yine de yazmak, kareyi
        haritanın rastgele bir yerine oturtan sessiz bir yalan olurdu —
        eksik bilgi, yanlış bilgiden iyidir.
        """
        kam = self.kameralar.get(kam_ad)
        # Canlı akıştaki kareler DİSKE YAZILMIYOR: saniyede beş kare, SD
        # kartı boşuna yorar ve 12'lik halka bir dakikada dolup anlamını
        # yitirir. Sunucu canlı kareyi yalnızca bellekte tutuyor.
        tip = "canli" if (kam and kam.durum().get("canli")) else "kare"
        paket: dict[str, Any] = {"tip": tip, "ts": ts, "veri": b64, "kamera": kam_ad}
        if kam is None or kam.hareketli:
            k = (self._son_durum.get("konum") or {}) if self._son_durum else {}
            paket["konum"] = {"x": k.get("x"), "y": k.get("y"), "z": k.get("z")}
        self._kuyruga_at(paket)

    def _gunluk_gonder(self, metin: str, seviye: str = "bilgi") -> None:
        """PLC sürücüsünden (bekçi, hareket işçisi) gelen bildirimler."""
        logger.info("[%s] %s", seviye, metin)
        self._kuyruga_at({"tip": "gunluk", "seviye": seviye, "metin": metin})

    def _kuyruga_at(self, paket: dict[str, Any]) -> None:
        if self.dongu is None:
            return
        self.dongu.call_soon_threadsafe(self._kuyruga_koy, paket)

    def _kuyruga_koy(self, paket: dict[str, Any]) -> None:
        try:
            self.kuyruk.put_nowait(paket)
        except asyncio.QueueFull:
            # İnternet yokken kuyruk dolarsa en eskiyi atıp yenisini alıyoruz:
            # grafikte güncel veri, eski veriden değerli.
            try:
                self.kuyruk.get_nowait()
                self.kuyruk.put_nowait(paket)
            except Exception:
                pass

    # --- komut işleme ----------------------------------------------------
    async def komut_isle(self, mesaj: dict[str, Any]) -> dict[str, Any]:
        ad = mesaj.get("ad")
        arg = mesaj.get("arg") or {}
        try:
            # --- hareket ---
            if ad == "jog":
                veri = await asyncio.to_thread(
                    self.plc.jog, str(arg.get("eksen", "")).lower(),
                    int(arg.get("yon", 1)), bool(arg.get("basili")))
                return {"ok": True, "mesaj": "", "veri": veri, "sessiz": True}

            if ad == "jog_dur":
                await asyncio.to_thread(self.plc.jog_hepsini_birak)
                return {"ok": True, "mesaj": "", "sessiz": True}

            if ad == "git":
                mesaj_metni = await asyncio.to_thread(
                    self.plc.git, arg.get("x"), arg.get("y"), arg.get("z"),
                    arg.get("hiz"), arg.get("t"))
                return {"ok": True, "mesaj": mesaj_metni}

            if ad == "home":
                eksen = arg.get("eksen")
                return {"ok": True, "mesaj": await asyncio.to_thread(
                    self.plc.home, str(eksen).lower() if eksen else None)}

            if ad == "dur":
                return {"ok": True, "mesaj": await asyncio.to_thread(self.plc.dur)}

            if ad == "acil":
                mesaj_metni = await asyncio.to_thread(self.plc.acil, str(arg.get("neden", "panel")))
                # Durdurulmuş makinede pompanın açık kalması taşma demek.
                for role in ("su_pompasi", "hava_pompasi"):
                    try:
                        await asyncio.to_thread(self.arduino.komut, f"ROLE {role} 0")
                    except Exception:
                        pass
                return {"ok": True, "mesaj": mesaj_metni}

            if ad == "acil_temizle":
                return {"ok": True, "mesaj": await asyncio.to_thread(self.plc.acil_temizle)}

            if ad == "enable":
                return {"ok": True, "mesaj": await asyncio.to_thread(self.plc.enable, bool(arg.get("deger")))}

            if ad == "bolge_listele":
                return {"ok": True, "mesaj": "", "veri": {"bolgeler": self.bolgeler.liste}, "sessiz": True}

            if ad == "bolge_kaydet":
                gelen = arg.get("bolgeler")
                if not isinstance(gelen, list):
                    return {"ok": False, "mesaj": "bolgeler bir liste olmalı"}
                try:
                    kayitli = await asyncio.to_thread(self.bolgeler.kaydet, gelen)
                except bolge_modulu.BolgeHatasi as hata:
                    return {"ok": False, "mesaj": str(hata)}
                uyarili = [b["ad"] for b in kayitli if b.get("uyari")]
                mesaj = f"{len(kayitli)} bölge kaydedildi"
                if uyarili:
                    mesaj += f" — koşulu hatalı olanlar hareketi ENGELLER: {', '.join(uyarili)}"
                return {"ok": True, "mesaj": mesaj, "veri": {"bolgeler": kayitli}}

            if ad == "uc_listele":
                return {"ok": True, "mesaj": "", "sessiz": True,
                        "veri": {"ayar": self.uclar.ayar,
                                 "baslar": self.uclar.baslar()}}

            if ad == "uc_kaydet":
                gelen = arg.get("ayar")
                if not isinstance(gelen, dict):
                    return {"ok": False, "mesaj": "ayar bir nesne olmalı"}
                yeni = await asyncio.to_thread(self.uclar.kaydet, gelen)
                self._t_yukari_uygula()
                self._guvenli_z_ofset_uygula()
                self._guvenli_z_uygula()
                self._guvenli_t_uygula()
                return {"ok": True, "mesaj": "Kafa ayarları kaydedildi",
                        "veri": {"ayar": yeni,
                                 "baslar": self.uclar.baslar()}}

            if ad == "goz_isaretle":
                # Tohumluğu ELLE doldurup boşaltmanın yolu. Bütün uç
                # ayarını geri yazan `uc_kaydet` yerine tek göze dokunuyor:
                # ekim dizisi süregelirken tabloyu kaydeden bir kullanıcı,
                # dizinin az önce boşalttığı gözü dolu yazmasın.
                hedef = str(arg.get("ad", "") or "")
                sonuc = await asyncio.to_thread(
                    self.uclar.goz_isaretle, hedef, bool(arg.get("dolu")),
                    arg.get("tohum"))
                if sonuc is None:
                    return {"ok": False, "mesaj": f"Tohumluk gözü bulunamadı: '{hedef}'"}
                return {"ok": True,
                        "mesaj": f"'{hedef}' gözü {'dolu' if sonuc['dolu'] else 'boş'} işaretlendi",
                        "veri": {"goz": sonuc,
                                 "gozler": self.uclar.tohumluk_gozleri()}}

            if ad == "nokta_denetle":
                # ÖN KONTROL. Sunucu, bir diziyi başlatmadan önce
                # "bu koordinatlar geçer mi" diye soruyor; asıl karar
                # yine burada, ajanda veriliyor ve kurallar KOPYALANMIYOR
                # — `bolgeler.ihlal` ve `plc.sinir_icinde` zaten hareket
                # anında kullanılan işlevlerin ta kendisi.
                #
                # Neden gerekiyor: ofsetli sulamada 40 bitkilik bir dizi
                # ortasında yasak bölgeye çarpıp durursa makine yarı
                # sulanmış bir yatakta kalıyor. Önce sorup hiç
                # başlatmamak, yarıda durdurmaktan iyi.
                ham = arg.get("noktalar") or []
                if not isinstance(ham, list):
                    return {"ok": False, "mesaj": "noktalar bir liste olmalı"}
                baglam = self.plc.baglam()
                sonuc = []
                for i, nk in enumerate(ham[:400]):
                    try:
                        x = float(nk.get("x")); y = float(nk.get("y")); z = float(nk.get("z"))
                    except (TypeError, ValueError, AttributeError):
                        sonuc.append({"sira": i, "engel": "koordinat sayı olmalı"})
                        continue
                    engel = None
                    for eksen, deger in (("x", x), ("y", y), ("z", z)):
                        j = plc_modulu.EKSEN_INDEKS[eksen]
                        if not self.plc.sinir_icinde(j, deger):
                            kalib = self.plc.kalib[j]
                            engel = (f"{eksen.upper()} yumuşak sınır dışı: {deger:.1f} mm "
                                     f"[{kalib.get('min', 0):.0f}, {kalib.get('max', 0):.0f}]")
                            break
                    if engel is None and self.bolgeler:
                        engel = self.bolgeler.ihlal(x, y, z, baglam)
                    sonuc.append({"sira": i, "engel": engel})
                return {"ok": True, "mesaj": "", "sessiz": True,
                        "veri": {"noktalar": sonuc,
                                 "engelli": sum(1 for s in sonuc if s["engel"])}}

            if ad == "tohum_ucu":
                # TOHUM UCUNUN KENDİ DİKEY EKSENİ (PLC'de j4). Ana Z bütün
                # başları birden indiriyor; bu yalnız tohum ucunu indirip
                # kaldırıyor. Sür ekranındaki elle iniş/kalkış ve ekim
                # akışındaki iki an aynı komuttan geçiyor.
                try:
                    if arg.get("yukari"):
                        mesaj_metni = await asyncio.to_thread(
                            self.plc.t_git, None, None, True)
                    else:
                        mm = arg.get("mm")
                        if mm in (None, ""):
                            return {"ok": False,
                                    "mesaj": "mm ya da yukari:true gerekiyor"}
                        mesaj_metni = await asyncio.to_thread(
                            self.plc.t_git, float(mm))
                except plc_modulu.PLCHatasi as hata:
                    return {"ok": False, "mesaj": str(hata)}
                except (TypeError, ValueError):
                    return {"ok": False, "mesaj": "mm sayı olmalı"}
                return {"ok": True, "mesaj": mesaj_metni}

            if ad == "dizi_baslat":
                # GEREKEN BAŞLIK İNDİRİLİYOR. Sulama sulama başlığıyla,
                # ekim tohum ucuyla yapılıyor; yanlış uçla ya da uç
                # bilinmiyorken başlamak, suyu tohum ucundan akıtmak
                # demek. Hangi başın gerektiği ADIMLARDAN çıkıyor (bkz.
                # `_dizi_basi`); çağıran açıkça `bas` verirse o geçerli.
                #
                # BURASI TEK GEÇİT. Sulama, ekim, kayıtlı program,
                # kuyruk, zamanlanmış görev — hepsi `dizi_baslat`tan
                # geçiyor, dolayısıyla başlık hazırlığı tek yerde.
                gereken = str(arg.get("bas") or "") \
                    or self._dizi_basi(arg.get("adimlar") or [])
                if gereken:
                    engel = await self._uc_hazirla(gereken)
                    if engel:
                        return {"ok": False, "mesaj": engel}
                try:
                    mesaj_metni = self.dizi.baslat(
                        str(arg.get("ad", "dizi")), arg.get("adimlar") or [],
                        int(arg.get("tekrar", 1) or 1), arg.get("hiz"))
                except (dizi_modulu.DiziHatasi, plc_modulu.PLCHatasi) as hata:
                    return {"ok": False, "mesaj": str(hata)}
                return {"ok": True, "mesaj": mesaj_metni}

            if ad == "dizi_durdur":
                return {"ok": True, "mesaj": await asyncio.to_thread(self.dizi.durdur)}

            if ad == "hiz":
                mm_s = float(arg.get("mm_s", 20))
                mesaj = await asyncio.to_thread(self.plc.hiz_ayarla, mm_s)
                # KALICI OLSUN. Eskiden yalnız bellekteydi ve ajan her
                # yeniden başladığında varsayılana dönüyordu.
                await asyncio.to_thread(self.uclar.kaydet, {"hiz": mm_s})
                return {"ok": True, "mesaj": mesaj}

            # --- Arduino tarafı ---
            if ad == "kamera":
                # Calisma aninda ac/kapat. Ayar dosyasina yazmiyoruz: kalici
                # olsun istenirse ayarlar.json'daki "aktif" elle degistirilir.
                # Boylece panelden yapilan gecici bir deneme, yeniden
                # baslatmada beklenmedik bir davranisa donusmuyor.
                # Canlı akış ayrı bir yol: periyodik kare döngüsüyle aynı
                # cihazı açamıyor, o yüzden ayrı komut.
                #
                # HANGİ KAMERA: `arg["kamera"]`. Verilmezse ilki — tek
                # kameralıyken yazılmış çağrılar aynen çalışsın diye.
                kam = self._kamera_sec(arg.get("kamera"))
                if kam is None:
                    return {"ok": False,
                            "mesaj": f"'{arg.get('kamera')}' adlı kamera tanımlı değil. "
                                     f"Tanımlılar: {', '.join(self.kameralar) or 'yok'}"}
                if "canli" in arg:
                    if arg.get("canli"):
                        ok, mesaj = kam.canli_ac(float(arg.get("fps", 5)))
                    else:
                        ok, mesaj = kam.canli_kapat()
                    return {"ok": ok, "mesaj": mesaj}

                acik = bool(arg.get("acik"))
                if "aralik_sn" in arg:
                    kam.ayar["aralik_sn"] = max(2.0, float(arg["aralik_sn"]))
                ok, mesaj = kam.ac() if acik else kam.kapat()
                return {"ok": ok, "mesaj": mesaj}

            if ad == "kamera_kare":
                # TAM ÇÖZÜNÜRLÜKLÜ TEK KARE — çözümleme için.
                #
                # Canlı akış ağı yormasın diye küçültülmüş kare gönderiyor;
                # AprilTag taraması ve filiz bulma ise büyüğünü istiyor.
                # 640'ta yeni çıkmış bir filiz birkaç piksel kalıp eleniyor,
                # etiket de okunamayacak kadar küçük düşüyordu.
                kam = self._kamera_sec(arg.get("kamera"))
                if kam is None:
                    return {"ok": False,
                            "mesaj": f"'{arg.get('kamera')}' adlı kamera tanımlı değil"}
                try:
                    yas = float(arg.get("azami_yas_sn", 5.0))
                except (TypeError, ValueError):
                    yas = 5.0
                # Kare alınamaması OLAĞAN bir hâl (kamera çıkarılmış, akış
                # kapalı, cihaz meşgul); "Beklenmeyen hata" diye
                # gösterilmesi kullanıcıyı yanlış yere baktırıyor.
                try:
                    ham = await asyncio.to_thread(kam.tam_kare, yas)
                except Exception as hata:                  # noqa: BLE001
                    return {"ok": False,
                            "mesaj": f"[{kam.etiket}] kare alınamadı: {hata}"}
                if not ham:
                    return {"ok": False,
                            "mesaj": (f"[{kam.etiket}] taze kare yok. Canlı akış "
                                      "açıksa son kare eskimiş; kapalıysa kamera "
                                      "kare veremedi.")}
                g, y = kam._boyut()
                return {"ok": True, "sessiz": True,
                        "mesaj": f"[{kam.etiket}] {g}x{y} kare",
                        "veri": {"kamera": kam.ad, "genislik": g, "yukseklik": y,
                                 "kare": base64.b64encode(ham).decode("ascii")}}

            if ad == "kamera_kaydet":
                # Kamera TANIMLARI — cihaz adı, çözünürlük, aralık. Geçici
                # aç/kapattan farklı olarak KALICI: `kameralar.json`a yazılıp
                # hemen uygulanıyor. Çalışan kameralar önce kapatılıyor,
                # yoksa eski cihaz açık kalırken yenisi açılamaz.
                try:
                    # Mevcut tanımlar da veriliyor: panelin göndermediği
                    # alanlar (örneğin "açılışta çalışsın") sessizce
                    # sıfırlanmasın.
                    tanimlar = kamera_modulu.tanimlari_dogrula(
                        arg.get("kameralar"),
                        [dict(k.ayar) for k in self.kameralar.values()])
                except kamera_modulu.KameraAyarHatasi as hata:
                    return {"ok": False, "mesaj": str(hata)}
                # Hangileri açıktı: kaydettikten sonra geri açmak için.
                acikti = [a for a, k in self.kameralar.items() if k.durum().get("acik")]
                for kam in self.kameralar.values():
                    try:
                        kam.kapat()
                    except Exception as hata:
                        logger.warning("Kamera kapatılamadı: %s", hata)
                try:
                    yol = await asyncio.to_thread(kamera_modulu.tanimlari_kaydet,
                                                  self.ayar_yolu, tanimlar)
                except OSError as hata:
                    return {"ok": False, "mesaj": f"kameralar.json yazılamadı: {hata}"}
                self._kameralari_kur(tanimlar)
                geri = []
                for kam in self.kameralar.values():
                    if kam.ad in acikti or kam.ayar.get("aktif"):
                        ok, _ = kam.ac()
                        if ok:
                            geri.append(kam.etiket)
                return {"ok": True,
                        "mesaj": f"{len(tanimlar)} kamera kaydedildi ({os.path.basename(yol)})"
                                 + (f"; yeniden açılan: {', '.join(geri)}" if geri else "")}

            if ad == "kamera_cihazlar":
                # Sistemdeki video cihazları — panelde "kameranın adı ne"
                # sorusunun cevabı. Kullanıcının /dev/video* numaralarını
                # ezberlemesini istemiyoruz; listeden adını seçsin.
                return {"ok": True, "mesaj": "cihazlar",
                        "cihazlar": await asyncio.to_thread(kamera_modulu.v4l2_cihazlar)}

            if ad == "kalibrasyon_kaydet":
                # Yalnız home/min/max; cpm ve dir panelden değiştirilemiyor.
                return {"ok": True, "mesaj": await asyncio.to_thread(
                    self.plc.kalibrasyon_kaydet, arg.get("eksenler") or [])}

            if ad == "hiz_eksen":
                # Eksen başına hız. Boş/None gelen eksen genel hıza düşüyor.
                # KALICI: `uclar.json`a yazılıyor ve açılışta geri
                # yükleniyor (`_hiz_uygula`). `ayar.json`a yazılmıyor —
                # orada jeton ve PLC adresi var.
                yeni_hiz = []
                for eksen in ("x", "y", "z", "t"):
                    deger = arg.get(eksen)
                    if deger in (None, ""):
                        yeni_hiz.append(None)
                        continue
                    try:
                        sayi = float(deger)
                    except (TypeError, ValueError):
                        return {"ok": False, "mesaj": f"{eksen.upper()} hızı sayı olmalı"}
                    if not 1.0 <= sayi <= 200.0:
                        return {"ok": False,
                                "mesaj": f"{eksen.upper()} hızı 1-200 mm/s arasında olmalı"}
                    yeni_hiz.append(sayi)
                self.plc.hiz_eksen = yeni_hiz
                # KALICI OLSUN — `uclar.json`a. Buradaki yorum bir süre
                # "kalıcı olması için ayarlar.json düzenlenir" diyordu;
                # o dosyada jeton ve PLC adresi olduğu için ajan onu
                # yazmıyor, ama hızların uçucu kalması için sebep değil:
                # `uclar.json` zaten panelin dosyası ve sır tutmuyor.
                await asyncio.to_thread(self.uclar.kaydet,
                                        {"hiz_eksen": yeni_hiz})
                yazi = " · ".join(
                    f"{ad_}{'genel' if h is None else f'{h:.0f}'}"
                    for ad_, h in zip(("X", "Y", "Z", "T"), yeni_hiz))
                return {"ok": True, "mesaj": f"Eksen hızları: {yazi}"}

            if ad == "role":
                role_adi = str(arg.get("ad", ""))
                if role_adi not in ROLELER:
                    return {"ok": False, "mesaj": f"Bilinmeyen röle: {role_adi}"}
                durum = 1 if arg.get("durum") else 0
                await asyncio.to_thread(self.arduino.komut, f"ROLE {role_adi} {durum}")
                return {"ok": True, "mesaj": f"{ROLELER[role_adi]} {'açık' if durum else 'kapalı'}"}

            if ad == "uc_sec":
                kimlik = str(arg.get("bas", "") or "")
                if self.uclar.bas_indeksi(kimlik) < 0:
                    return {"ok": False, "mesaj": f"Bilinmeyen baş: '{kimlik}'"}
                # BİR BAŞLIK İNERKEN İKİNCİSİ İNMEZ. Tek servo var ve
                # yeni bir açı komutu, inen başlığı çekip ötekini
                # indiriyor; hareket sürerken üstüne ikinci bir komut
                # yollamak, mekanizmayı yarı yoldan geri döndürmek olur.
                # Kart hareketin bittiğini `uc_hareket` ile söylüyor.
                if self._uc_harekette:
                    return {"ok": False,
                            "mesaj": "Önceki başlık hareketi bitmedi — "
                                     "yerine oturmasını bekleyin."}
                # SIRA ÖNEMLİ: sonra Z kilidi. Açı girilmemişse de komut
                # gitmiyor ama kullanıcıya önce asıl engeli söylemek
                # gerekiyor — Z aşağıdayken açı girmek işe yaramaz.
                engel = self.uc_secim_engel()
                if engel:
                    return {"ok": False, "mesaj": engel}
                komut, sebep = self.uclar.servo_komutu(kimlik)
                if sebep:
                    return {"ok": False, "mesaj": sebep}
                await asyncio.to_thread(self.arduino.komut, komut)
                bilgi = uc_modulu.BAS_BILGI.get(kimlik) or {}
                sure = self.uclar.servo_sure_ms()
                # "Seçildi" DEMİYORUZ: kart süre dolana kadar "gidiyor"
                # diyor ve seçili ucu kartın kendisi bildiriyor. Panel
                # onayı komuttan değil durum paketinden alıyor.
                return {"ok": True,
                        "mesaj": f"{bilgi.get('ad', kimlik)} seçiliyor — "
                                 f"servo {sure} ms içinde yerine oturuyor"}

            if ad == "servo_aci_sur":
                # AÇI SAYI OLMAK ZORUNDA. Panelden boş alan gelirse
                # `int(None)` patlar ve kullanıcı "Beklenmeyen hata"
                # görür; sebebi gayet belli ve söylenmeye değer.
                try:
                    derece = int(round(float(arg.get("derece"))))
                except (TypeError, ValueError):
                    return {"ok": False, "mesaj": "Açı sayı olmalı (0-180)."}
                # SINIR BURADA DA DENETLENİYOR. Kart da denetliyor
                # (firmware `ACI`), ama oradan dönen ret seri günlükte
                # kalıyor; panele cevap vermek gerekiyor.
                if not 0 <= derece <= 180:
                    return {"ok": False, "mesaj": "Açı 0-180 arasında olmalı."}
                # Süren bir hareketin üstüne yazmak, mekanizmayı yarı
                # yoldan geri döndürmek olur — `uc_sec` ile aynı kural.
                if self._uc_harekette:
                    return {"ok": False,
                            "mesaj": "Önceki başlık hareketi bitmedi — "
                                     "yerine oturmasını bekleyin."}
                # Z KİLİDİ `uc_sec` İLE AYNI: horn dönerken inmiş bir
                # başlık toprağın içinden sürüklenir. Elle sürmek bunu
                # daha az değil, DAHA çok yapıyor — açı aranırken horn
                # uçlarla eşleşmeyen yerlere gidiyor.
                engel = self.uc_secim_engel()
                if engel:
                    return {"ok": False, "mesaj": engel}
                await asyncio.to_thread(self.arduino.komut, f"ACI {derece}")
                # "SEÇİLİ UÇ" KAYDI GEÇERSİZ OLUYOR ve bunu söylüyoruz:
                # kart `ucSecili`yi -1 yapıyor (elle sürülen açı hiçbir
                # başla eşleşmeyebilir), yani bu komuttan sonra iş
                # başlatmak yeniden uç seçimi istiyor. Sessizce olması,
                # kullanıcının "neden iş başlamıyor" diye aramasıydı.
                return {"ok": True,
                        "mesaj": f"Servo {derece} dereceye sürüldü. Hangi baş "
                                 f"indi? O sayıyı Ayarlar → Başlar bölümündeki "
                                 f"'Servo açısı' alanına yazın. Seçili uç kaydı "
                                 f"artık geçersiz."}

            if ad == "servo_test":
                acik = bool(arg.get("acik"))
                # BAŞLATIRKEN Z KİLİDİ, DURDURURKEN YOK. Deneme horn'u
                # döndürüyor; inmiş bir başlık toprağın içinden
                # sürüklenmesin diye başlatmak `uc_sec` ile aynı engele
                # tabi. Durdurmak her koşulda serbest olmalı: kilit
                # yüzünden duramayan bir "dur" düğmesi, düğme olmaktan
                # çıkar.
                if acik:
                    engel = self.uc_secim_engel()
                    if engel:
                        return {"ok": False, "mesaj": engel}
                await asyncio.to_thread(self.arduino.komut,
                                        f"TEST {1 if acik else 0}")
                return {"ok": True,
                        "mesaj": ("Servo denemesi başlıyor — horn açıları "
                                  "süpürüyor, uç konumu bilinmez oluyor."
                                  if acik else "Servo denemesi durduruldu.")}

            return {"ok": False, "mesaj": f"Bilinmeyen komut: {ad}"}

        except plc_modulu.PLCHatasi as hata:
            logger.warning("PLC komutu reddedildi: %s", hata)
            return {"ok": False, "mesaj": str(hata)}
        except RuntimeError as hata:
            # Arduino tarafının anlaşılır ret sebepleri: "bağlı değil",
            # "o çıkış bağlı değil", "port kapalı". Bunları genel hata
            # dalına düşürmek panelde "Beklenmeyen hata" yazdırıyordu —
            # oysa sebep gayet belli ve kullanıcıya söylenmeye değer.
            logger.info("Arduino komutu reddedildi: %s", hata)
            return {"ok": False, "mesaj": str(hata)}
        except Exception as hata:
            logger.exception("Komut işlenirken hata")
            return {"ok": False, "mesaj": f"Beklenmeyen hata: {hata}"}

    # --- döngüler --------------------------------------------------------
    async def _gonderici(self) -> None:
        while True:
            paket = await self.kuyruk.get()
            if self.ws is None:
                continue
            try:
                await self.ws.send(json.dumps(paket, ensure_ascii=False))
            except Exception:
                return

    async def _durum_dongusu(self) -> None:
        """PLC durumunu düzenli okuyup değiştiyse sunucuya bildirir."""
        aralik = float(self.ayar.get("durum_araligi_sn", 0.5))
        while True:
            durum = await asyncio.to_thread(self.plc.durum)
            durum["arduino"] = self.arduino.bagli

            # ETKİN TANILAR — panel bunları "ne koptu / olası sebep / ne
            # yapmalı" olarak gösteriyor. Metinler `tani.py`de, tek yerde;
            # `tanila.py` de aynı tablodan okuyor.
            tanilar = []
            if durum.get("tani"):
                tanilar.append(durum.pop("tani"))
            if getattr(self.arduino, "tani", None):
                tanilar.append(self.arduino.tani)
            durum["tanilar"] = tanilar
            # Panelin ihtiyacı olan her şey tek pakette: dizi ilerlemesi,
            # takılı uç, uç adları ve sensörün bağlı olup olmadığı.
            # Toprak kalibrasyonu panele gidiyor: ham->yüzde çevirimi orada
            # yapılıyor ve tek yerde kalsın diye sayıları da oradan alması
            # gerekiyor. Ajan ham değeri bozmuyor.
            durum["toprak_kalib"] = self._toprak_kalib()
            # Kamera listesi SIRALI: panel kutuları bu sırayla diziyor.
            durum["kameralar"] = [k.durum() for k in self.kameralar.values()]
            # `kamera` tekili duruyor — ilk kameranın hâli. Tek kameraya
            # göre yazılmış her yer (eski panel dahil) çalışmaya devam etsin.
            durum["kamera"] = durum["kameralar"][0] if durum["kameralar"] else {}
            # `dusen` sayacı normal işleyişte SIFIR kalmalı; sıfırdan
            # büyükse ya cihaz yavaşladı ya kilitlendi.
            durum["hailo"] = self.hailo.durum()
            durum["dizi"] = dict(self.dizi.durum)
            # ÜÇ SABİT BAŞ. "Hangi uç takılı", uç yuvaları, kilit servosu
            # ve varlık sensörü kaldırıldı: hiçbiri sökülmüyor, takılı
            # olmayan bir baş yok. Anahtar adı `uc` kalıyor — bu paketi
            # okuyan onlarca yer var ve hepsini yeniden adlandırmak
            # değişikliğin işine hiçbir şey katmadan riski büyütürdü.
            durum["uc"] = {
                "calisiyor": False,
                # ÜÇ BAŞIN KAYMALARI. Sunucu bir işi hangi başın yapacağını
                # bilip o başın kaymasını uyguluyor; panel de erişilemeyen
                # şeridi başa göre çiziyor.
                "baslar": self.uclar.baslar(),
                "bas_bilgi": uc_modulu.BAS_BILGI,
                # Tohumluk: harita profili bu noktadan türetiyor, adı yetmiyor.
                "tohumluk": self.uclar.tohumluk() or {},
                # Gözlerin tamamı — panel tabloyu ve haritayı buradan
                # kuruyor, ekim dizisi de hangi gözün dolu olduğunu
                # buradan öğreniyor. `tohumluk` yalnız ilk gözün konumu.
                "tohumluk_gozleri": self.uclar.tohumluk_gozleri(),
                # Sulama başlığı kayması — sulama akışı ve panel bu adla
                # okuyor; içerik `baslar.sulama`dan geliyor.
                "sulama_basligi": self.uclar.sulama_basligi(),
                "z_safe_reg": int(self.uclar.ayar.get("z_safe_reg", 0) or 0),
                "ayar": {"safe_z": self.uclar.ayar.get("safe_z"),
                         "guvenli_z_ofset": self.uclar.guvenli_z_ofset(),
                         "guvenli_t": self.uclar.guvenli_t(),
                         "servo_sure_ms": self.uclar.servo_sure_ms()},
                # UÇ SEÇİCİ MEKANİZMASI — başlığa değil mekanizmaya ait
                # ayarlar: hareket süresi ve güvenli yükseklik. Kayma
                # BURADA YOK, baş başına (`baslar`).
                "uc_secici": self.uclar.uc_secici(),
                # Hangi proksimite anahtarı hangi başa bağlı — panel
                # lambaları bununla adlandırıyor.
                "prox_baslar": self.uclar.prox_baslar(),
                # UÇ SEÇİCİ — KOMUT EDİLEN DEĞER, ÖLÇÜM DEĞİL. `secili`
                # None = kart hiç komut almamış ya da sıfırlanmış; panel
                # bunu "bilinmiyor" diye yazıyor, sıfırıncı uç diye değil.
                # `engel` doluysa uç düğmeleri kapalı ve sebebi ekranda.
                "secici": {
                    "secili": self._uc_secili,
                    "secili_bas": (uc_modulu.BASLAR[int(self._uc_secili)]
                                   if self._uc_secili is not None
                                   and 0 <= int(self._uc_secili) < len(uc_modulu.BASLAR)
                                   else None),
                    "aci": self._uc_aci,
                    "hareket": self._uc_harekette,
                    "engel": self.uc_secim_engel(),
                },
            }

            if durum != self._son_durum and self.ws is not None:
                self._son_durum = durum
                try:
                    await self.ws.send(json.dumps({"tip": "durum", "durum": durum}, ensure_ascii=False))
                except Exception:
                    return
            await asyncio.sleep(aralik)

    async def _alici(self) -> None:
        # Sunucu yeniden baslayinca baglanti 1012 ile kapaniyor ve bu gorev
        # ConnectionClosed ile bitiyor. Yakalanmazsa asyncio her seferinde
        # "Task exception was never retrieved" diye tam bir traceback dokuyor;
        # oysa kapanma normal, calis() zaten yeniden baglaniyor. Gunluge
        # bakan biri bunu ariza sanip gercek hatalari kaciriyordu.
        try:
            async for ham in self.ws:
                try:
                    mesaj = json.loads(ham)
                except json.JSONDecodeError:
                    continue
                if mesaj.get("tip") != "komut":
                    continue
                sonuc = await self.komut_isle(mesaj)
                await self.ws.send(json.dumps(
                    {"tip": "sonuc", "id": mesaj.get("id"), **sonuc}, ensure_ascii=False))
        except Exception as hata:
            # Kapanma sessizce gecilir; geri kalan her sey gercek hata,
            # gorunur kalmali.
            if "ConnectionClosed" in type(hata).__name__:
                logger.info("Sunucu bağlantısı kapandı (%s)", hata)
            else:
                logger.exception("Alıcı görevinde beklenmeyen hata")

    async def _jog_birak_sinirli(self, neden: str) -> None:
        """Jog mandallarını bırakır ama PLC yanıt vermezse takılıp kalmaz.

        PLC erişilemezken her Modbus yazması kendi zaman aşımını bekliyor;
        altı yazma toplamda dakikalara çıkabiliyor. Buraya bir üst sınır
        koyuyoruz: bırakma denemesi yapılır, olmazsa geçilir. Güvenlik
        açığı değil — ajandaki jog bekçisi zaten 1,2 saniyede bitleri
        düşürüyor, bu yalnızca erken bir temizlik.
        """
        try:
            await asyncio.wait_for(
                asyncio.to_thread(self.plc.jog_hepsini_birak), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("Jog bırakma (%s) PLC yanıt vermediği için atlandı", neden)
        except Exception as hata:
            logger.warning("Jog bırakma (%s) başarısız: %s", neden, hata)

    async def calis(self) -> None:
        import websockets

        self.dongu = asyncio.get_running_loop()
        self.arduino.baslat()
        for kam in self.kameralar.values():
            kam.baslat()          # kendi hatasını kendi yutuyor
        self.hailo.baslat()
        # Çakılmadan kalan bir jog mandalını miras almayalım. AMA bunu
        # beklemeden: PLC erişilemezken (kablo çıkmış, PLC kapalı) altı Modbus
        # yazması tek tek zaman aşımına düşüyor ve ajan sunucuya bağlanmaya
        # DAKİKALARCA sıra getiremiyordu. Panel de o sırada "Raspberry Pi
        # sunucuya bağlı değil" diyordu — oysa panel, PLC arızasını teşhis
        # edeceğimiz yer; ona muhtaç olmamalı.
        asyncio.create_task(self._jog_birak_sinirli("açılış"))

        adres = f"{self.ayar['sunucu']}?jeton={self.ayar['jeton']}"
        bekleme = 1.0
        while True:
            try:
                logger.info("Sunucuya bağlanılıyor: %s", self.ayar["sunucu"])
                async with websockets.connect(adres, ping_interval=20, ping_timeout=20) as ws:
                    self.ws = ws
                    bekleme = 1.0
                    logger.info("Sunucuya bağlanıldı")
                    self._son_durum = {}
                    gorevler = [
                        asyncio.create_task(self._alici()),
                        asyncio.create_task(self._gonderici()),
                        asyncio.create_task(self._durum_dongusu()),
                    ]
                    _, bekleyen = await asyncio.wait(gorevler, return_when=asyncio.FIRST_COMPLETED)
                    for gorev in bekleyen:
                        gorev.cancel()
            except Exception as hata:
                logger.warning("Bağlantı hatası: %s", hata)
            finally:
                self.ws = None
                # Bağlantı koptu: jog mandalı açık kalmış olabilir ve panelden
                # "bırak" komutu artık gelemez. Bekçi zaten 1.2 sn'de düşürür
                # ama beklemenin anlamı yok — hemen bırakıyoruz.
                await self._jog_birak_sinirli("bağlantı koptu")

            logger.info("%.0f saniye sonra yeniden denenecek", bekleme)
            await asyncio.sleep(bekleme)
            bekleme = min(bekleme * 2, 30.0)


def main() -> None:
    yol = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "ayarlar.json")
    ajan = Ajan(ayar_yukle(yol), ayar_yolu=yol)
    try:
        asyncio.run(ajan.calis())
    except KeyboardInterrupt:
        logger.info("Kapatılıyor")
    finally:
        ajan.arduino.durdur()
        for kam in ajan.kameralar.values():
            try:
                kam.durdur()
            except Exception as hata:
                logger.warning("Kamera durdurulamadı: %s", hata)
        ajan.hailo.durdur()
        ajan.plc.kapat()


if __name__ == "__main__":
    main()
