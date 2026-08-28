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
    # islak 593 BU MAKİNEDE ÖLÇÜLDÜ: prob su dolu bardakta iken panel eski
    # 0-1023 ölçeğinde %42 gösteriyordu, yani ham 1023-0.42*1023 = 593.
    # Teorik 0 yanlıştı — dirençli prob suda sıfır okumuyor, saf su bile
    # sonsuz iletken değil ve modülün seri direnci bölücüyü kaydırıyor.
    #
    # kuru 1023 varsayım: havada ~%0 göründüğü için. Prob ya da modül
    # değişirse ikisini de yeniden ölçün:
    #   python3 toprak-kalibre.py kuru   /   python3 toprak-kalibre.py islak
    "arduino": {"port": "/dev/ttyUSB0", "baud": 9600, "sahte": False,
                "toprak_kuru": 1023, "toprak_islak": 593},
    "plc": {
        "sahte": False,
        "ip": "192.168.1.88",
        "port": 502,
        "birim": 1,
        "guvenli_z": 340.0,
        "hiz": 20.0,
        "ivme": 100.0,
        "yavaslama": 100.0,
        "kalibrasyon_dosyasi": "gantry_calib.json",
    },
    "kamera": {"aktif": False, "aralik_sn": 30.0, "genislik": 640, "sahte": False},
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
            logger.info("Kalibrasyon okundu: %s", tam)
        else:
            logger.warning("Kalibrasyon dosyası yok (%s) — koddaki ölçülmüş varsayılanlar kullanılacak", tam)
    return ayar


class Ajan:
    def __init__(self, ayar: dict[str, Any]) -> None:
        self.ayar = ayar
        self.dongu: asyncio.AbstractEventLoop | None = None
        self.kuyruk: asyncio.Queue = asyncio.Queue(maxsize=200)
        self.ws = None

        # Yasak bölgeler ajanda: panel çökse, sunucu düşse, komut başka bir
        # arayüzden gelse de koruma çalışsın.
        self.bolgeler = bolge_modulu.Bolgeler(ayar.get("plc", {}), gunluk_cb=self._gunluk_gonder)
        self.plc = plc_modulu.olustur(
            ayar["plc"], gunluk_cb=self._gunluk_gonder,
            bolgeler=self.bolgeler, baglam_saglayici=self._kosul_baglami)
        # Uç değiştirme: bölge esnetmesini ve konum doğrulamasını yönetiyor.
        self.uclar = uc_modulu.Uclar(ayar.get("plc", {}), self.plc,
                                     bolgeler=self.bolgeler, gunluk_cb=self._gunluk_gonder)
        # Z güvenlik kararının iki kaynağı uç modülünde: PLC'deki Z-güvenli
        # biti ve uç değiştirme alanı. PLC sürücüsü bunları buradan soruyor.
        self.plc.z_guvenli_kaynagi = self.uclar.z_guvenli_reg_oku
        self.plc.tc_alani = self.uclar.tc_alani_icinde
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
        self.kamera = kamera_modulu.Kamera(ayar.get("kamera", {}), self._kare_geldi,
                                           gunluk_cb=self._gunluk_gonder)
        self._son_durum: dict[str, Any] = {}

    def _kosul_baglami(self) -> dict[str, Any]:
        """Bölge koşullarında kullanılan makine durumu.

        `prox` (varlık sensörü) ve `tool` (takılı uç) uç değiştirme eklenince
        dolacak; şimdilik sabit. Değerlerin buradan geçmesi, koşul yazan
        kişinin bugün de `prox` ve `tool` kullanabilmesi demek — sonuç
        değişmiyor ama ifade geçersiz olmuyor.
        """
        uclar = getattr(self, "uclar", None)
        if uclar is None:
            return {"prox": False, "tool": ""}
        varlik = uclar.varlik_oku()
        # Sensör bağlı değilken `prox` False: "uç yok" değil, "doğrulanamıyor".
        # Koşullarda fail-closed tarafta kalmak için doğrusu bu.
        return {"prox": bool(varlik), "tool": uclar.ayar.get("current_tool") or ""}

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

    def _kare_geldi(self, b64: str, ts: float) -> None:
        """Kamera iş parçacığından çağrılır."""
        k = (self._son_durum.get("konum") or {}) if self._son_durum else {}
        self._kuyruga_at({"tip": "kare", "ts": ts, "veri": b64,
                          "konum": {"x": k.get("x"), "y": k.get("y"), "z": k.get("z")}})

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
                        "veri": {"ayar": self.uclar.ayar, "durum": self.uclar.durum}}

            if ad == "uc_kaydet":
                gelen = arg.get("ayar")
                if not isinstance(gelen, dict):
                    return {"ok": False, "mesaj": "ayar bir nesne olmalı"}
                yeni = await asyncio.to_thread(self.uclar.kaydet, gelen)
                return {"ok": True, "mesaj": "Uç ayarları kaydedildi", "veri": {"ayar": yeni}}

            if ad == "uc_onizle":
                return {"ok": True, "mesaj": "", "sessiz": True,
                        "veri": self.uclar.yol_onizleme(str(arg.get("islem", "al")),
                                                        str(arg.get("ad", "")))}

            if ad == "uc_durum_temizle":
                return {"ok": True, "mesaj": await asyncio.to_thread(self.uclar.durumu_temizle)}

            if ad in ("uc_al", "uc_birak", "uc_degistir"):
                islem = {"uc_al": "al", "uc_birak": "birak", "uc_degistir": "degistir"}[ad]
                try:
                    mesaj_metni = self.uclar.dizi_baslat(islem, str(arg.get("ad", "")))
                except uc_modulu.UcHatasi as hata:
                    return {"ok": False, "mesaj": str(hata)}
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
                acik = bool(arg.get("acik"))
                if "aralik_sn" in arg:
                    self.kamera.ayar["aralik_sn"] = max(2.0, float(arg["aralik_sn"]))
                ok, mesaj = self.kamera.ac() if acik else self.kamera.kapat()
                return {"ok": ok, "mesaj": mesaj}

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
            ard = self.ayar.get("arduino", {})
            durum["toprak_kalib"] = {
                "kuru": float(ard.get("toprak_kuru", 1023)),
                "islak": float(ard.get("toprak_islak", 0)),
            }
            durum["kamera"] = self.kamera.durum()
            durum["dizi"] = dict(self.dizi.durum)
            durum["uc"] = {
                **self.uclar.durum,
                "uclar": [t.get("name") for t in self.uclar.ayar.get("tools", [])],
                # Yuvaların koordinatları: tarla haritasının "uç yuvaları"
                # katmanı bunları çiziyor. Ad listesi yeterli değil — harita
                # nerede olduklarını sormak zorunda.
                "tools_konum": [
                    {"name": t.get("name"), "x": t.get("x"), "y": t.get("y"), "z": t.get("z")}
                    for t in self.uclar.ayar.get("tools", [])
                    if t.get("x") is not None
                ],
                "sensor_var": int(self.uclar.ayar.get("presence_reg", 0) or 0) > 0,
                "travel_z": self.uclar.ayar.get("travel_z"),
                "slide_axis": self.uclar.ayar.get("slide_axis"),
                # Tohumluk: harita profili bu noktadan türetiyor, adı yetmiyor.
                "tohumluk": self.uclar.tohumluk() or {},
                "alan": self.uclar.ayar.get("tc_area") or {},
                "alanda": bool(self.uclar.tc_alani_icinde(
                    (durum.get("konum") or {}).get("x") or 0,
                    (durum.get("konum") or {}).get("y") or 0)),
                "z_safe_reg": int(self.uclar.ayar.get("z_safe_reg", 0) or 0),
                "ayar": {k: self.uclar.ayar.get(k) for k in
                         ("safe_z", "travel_z", "lift", "approach", "retreat",
                          "speed", "slide_axis", "lock_dwell", "lock_reg",
                          "grip_reg", "presence_reg")},
                "tools": self.uclar.ayar.get("tools", []),
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
        self.kamera.baslat()
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
    ajan = Ajan(ayar_yukle(yol))
    try:
        asyncio.run(ajan.calis())
    except KeyboardInterrupt:
        logger.info("Kapatılıyor")
    finally:
        ajan.arduino.durdur()
        ajan.kamera.durdur()
        ajan.plc.kapat()


if __name__ == "__main__":
    main()
