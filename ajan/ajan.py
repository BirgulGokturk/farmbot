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
        "ivme": 100.0,
        "yavaslama": 100.0,
        "kalibrasyon_dosyasi": "gantry_calib.json",
    },
    # aralik_sn kamera.py'deki varsayilanla AYNI olmali: burasi 30 yazarken
    # oradaki ve belgelerdeki "bir saat" hicbir zaman gecerli olmuyordu.
    "kamera": {"aktif": False, "aralik_sn": 3600.0, "genislik": 640, "sahte": False},
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

    def _olcum_geldi(self, veri: dict[str, Any]) -> None:
        """Seri port iş parçacığından çağrılır — asyncio'ya güvenli aktarım."""
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
                    self.plc.git, arg.get("x"), arg.get("y"), arg.get("z"), arg.get("hiz"))
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
                return {"ok": True, "mesaj": await asyncio.to_thread(self.plc.hiz_ayarla, float(arg.get("mm_s", 20)))}

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
                # Çalışma anında geçerli; kalıcı olması için ayarlar.json
                # düzenlenir — ajanın o dosyayı kendi yeniden yazması, içinde
                # jeton ve PLC adresi de olduğu için istenmiyor.
                yeni_hiz = []
                for eksen in ("x", "y", "z"):
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
                yazi = " · ".join(
                    f"{ad_}{'genel' if h is None else f'{h:.0f}'}"
                    for ad_, h in zip(("X", "Y", "Z"), yeni_hiz))
                return {"ok": True, "mesaj": f"Eksen hızları: {yazi}"}

            if ad == "role":
                role_adi = str(arg.get("ad", ""))
                if role_adi not in ROLELER:
                    return {"ok": False, "mesaj": f"Bilinmeyen röle: {role_adi}"}
                durum = 1 if arg.get("durum") else 0
                await asyncio.to_thread(self.arduino.komut, f"ROLE {role_adi} {durum}")
                return {"ok": True, "mesaj": f"{ROLELER[role_adi]} {'açık' if durum else 'kapalı'}"}

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
                "ayar": {"safe_z": self.uclar.ayar.get("safe_z")},
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
