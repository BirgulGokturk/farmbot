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
import plc as plc_modulu

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ajan")

VARSAYILAN_AYAR = {
    "sunucu": "wss://farmbot-api.onrender.com/ws/ajan",
    "jeton": "DEGISTIRIN",
    "arduino": {"port": "/dev/ttyUSB0", "baud": 9600, "sahte": False},
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
        self.kip = "oto"

        self.plc = plc_modulu.olustur(ayar["plc"], gunluk_cb=self._gunluk_gonder)
        ard = ayar["arduino"]
        if ard.get("sahte"):
            self.arduino = arduino_modulu.SahteArduino(geri_cagir=self._olcum_geldi)
        else:
            self.arduino = arduino_modulu.Arduino(
                port=ard.get("port", "/dev/ttyUSB0"),
                baud=int(ard.get("baud", 9600)),
                geri_cagir=self._olcum_geldi,
            )
        self._son_durum: dict[str, Any] = {}

    # --- başka iş parçacıklarından gelen olaylar -------------------------
    def _olcum_geldi(self, veri: dict[str, Any]) -> None:
        """Seri port iş parçacığından çağrılır — asyncio'ya güvenli aktarım."""
        self._kuyruga_at({"tip": "olcum", "ts": time.time(), "veri": veri})

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
                for role in ("su_pompasi", "hava_pompasi", "su_vanasi"):
                    try:
                        await asyncio.to_thread(self.arduino.komut, f"ROLE {role} 0")
                    except Exception:
                        pass
                return {"ok": True, "mesaj": mesaj_metni}

            if ad == "acil_temizle":
                return {"ok": True, "mesaj": await asyncio.to_thread(self.plc.acil_temizle)}

            if ad == "enable":
                return {"ok": True, "mesaj": await asyncio.to_thread(self.plc.enable, bool(arg.get("deger")))}

            if ad == "hiz":
                return {"ok": True, "mesaj": await asyncio.to_thread(self.plc.hiz_ayarla, float(arg.get("mm_s", 20)))}

            # --- Arduino tarafı ---
            if ad == "servo":
                aci = int(arg.get("aci", 0))
                if not 0 <= aci <= 180:
                    return {"ok": False, "mesaj": "Servo açısı 0-180 arasında olmalı"}
                await asyncio.to_thread(self.arduino.komut, f"SERVO {aci}")
                return {"ok": True, "mesaj": f"Servo {aci}°"}

            if ad == "kip":
                deger = str(arg.get("deger", "oto")).lower()
                if deger not in ("oto", "manuel"):
                    return {"ok": False, "mesaj": "Kip 'oto' ya da 'manuel' olmalı"}
                await asyncio.to_thread(self.arduino.komut, "AUTO" if deger == "oto" else "MANUEL")
                self.kip = deger
                return {"ok": True, "mesaj": f"Kip: {deger}"}

            if ad == "role":
                role_adi = str(arg.get("ad", ""))
                if role_adi not in ("su_pompasi", "hava_pompasi", "su_vanasi"):
                    return {"ok": False, "mesaj": f"Bilinmeyen röle: {role_adi}"}
                durum = 1 if arg.get("durum") else 0
                await asyncio.to_thread(self.arduino.komut, f"ROLE {role_adi} {durum}")
                return {"ok": True, "mesaj": f"{role_adi} {'açık' if durum else 'kapalı'}"}

            return {"ok": False, "mesaj": f"Bilinmeyen komut: {ad}"}

        except plc_modulu.PLCHatasi as hata:
            logger.warning("PLC komutu reddedildi: %s", hata)
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
            durum["kip"] = self.kip
            durum["arduino"] = self.arduino.bagli

            if durum != self._son_durum and self.ws is not None:
                self._son_durum = durum
                try:
                    await self.ws.send(json.dumps({"tip": "durum", "durum": durum}, ensure_ascii=False))
                except Exception:
                    return
            await asyncio.sleep(aralik)

    async def _alici(self) -> None:
        async for ham in self.ws:
            try:
                mesaj = json.loads(ham)
            except json.JSONDecodeError:
                continue
            if mesaj.get("tip") != "komut":
                continue
            sonuc = await self.komut_isle(mesaj)
            await self.ws.send(json.dumps({"tip": "sonuc", "id": mesaj.get("id"), **sonuc}, ensure_ascii=False))

    async def calis(self) -> None:
        import websockets

        self.dongu = asyncio.get_running_loop()
        self.arduino.baslat()
        # Çakılmadan kalan bir jog mandalını miras almayalım.
        await asyncio.to_thread(self.plc.jog_hepsini_birak)

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
                try:
                    await asyncio.to_thread(self.plc.jog_hepsini_birak)
                except Exception:
                    pass

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
        ajan.plc.kapat()


if __name__ == "__main__":
    main()
