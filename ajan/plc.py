"""PLC sürücüsü — Modbus TCP, X/Y/Z portal (gantry).

Register haritası, birim dönüşümleri ve güvenlik mantığı `gantry_studio.py`den
alındı; oradaki değerler sahada komisyonlanmış gerçek değerler. Artık **tek
yazıcı biziz**: Gantry Studio kapalıyken bu modül PLC'ye doğrudan yazıyor.

PLC'nin dilini bilmek gereken üç şey
------------------------------------
1. **Sayılar 32 bit IEEE float, iki register'a bölünmüş, DÜŞÜK KELİME ÖNCE.**
   Ölçekli tam sayı değil. `1024`e 125.4 yazmak `1024`+`1025` çiftine yazmak
   demek; sırayı ters yazmak makineyi bambaşka bir yere gönderir.
2. **Birim "count", milimetre değil.** Her eksenin kendi cpm'i (count/mm) var
   ve Z ters yönde çalışıp 438 mm'lik bir home ofseti taşıyor:
   `raw = dir * (mm - home) * cpm`.
3. **Jog bitleri MANDAL.** 1 yazınca eksen hareket etmeye başlar ve biri 0
   yazana kadar durmaz. Tarayıcı kapanır, WiFi düşerse komut hiç gelmez — bu
   yüzden jog bir "kira": panel sürekli yeniliyor, süresi dolan biti bu
   modüldeki bekçi iş parçacığı düşürüyor.

Bu dosyadaki güvenlik kuralları pazarlık konusu değil:
  * Yumuşak sınırlar hedef PLC'ye gitmeden denetlenir (PLC sizi durdurmaz).
  * Z yukarıda değilken X/Y hareketi reddedilir.
  * Hareket asla çapraz değildir: sıra Z → Y → X, her eksen bitmeden diğeri
    başlamaz.
  * ACİL DURDURMA hedefi de nötrler ve mandallanır; temizlenmeden hareket yok.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import struct
import threading
import time
from typing import Any, Callable

import tani

logger = logging.getLogger("ajan.plc")

# --------------------------------------------------------------------------- #
# Register haritası — X=Axis_1, Y=Axis_2, Z=Axis_3 (temizlenmiş ladder ile aynı)
# --------------------------------------------------------------------------- #
EKSENLER = [
    {"ad": "X", "jogf": 1020, "jogb": 1021, "go": 1022, "home": 1023,
     "hedef": 1024, "hiz": 1006, "ivme": 1000, "yavaslama": 1002, "konum": 1026},
    {"ad": "Y", "jogf": 1030, "jogb": 1031, "go": 1032, "home": 1033,
     "hedef": 1034, "hiz": 1036, "ivme": 1038, "yavaslama": 1040, "konum": 1042},
    {"ad": "Z", "jogf": 1050, "jogb": 1051, "go": 1052, "home": 1053,
     "hedef": 1054, "hiz": 1056, "ivme": 1058, "yavaslama": 1060, "konum": 1062},
]
N = 3
ENABLE_REG = 1010
EKSEN_INDEKS = {"x": 0, "y": 1, "z": 2}

# Jog kirası. Gantry Studio 0.7 sn kullanıyor; panel artık buluttan geldiği için
# gidiş-dönüş gecikmesine pay bırakıyoruz. Yine de bir saniyenin biraz üstünde:
# bağlantı koptuğunda eksen 20 mm/s hızda en fazla ~2-3 cm fazladan gider.
JOG_TTL = 1.2
JOG_TICK = 0.1

# `gantry_calib.json` BULUNAMAZSA devreye giren yedek. Sahadaki ölçümle
# AYNI olmak zorunda ve bir dönem değildi: burası X425 / Y550'de kalmışken
# dosya X535 / Y630'a güncellenmişti. Dosya kaybolduğu gün makine, tohumluk
# (Y605), Kap 1'in uzak kenarı (X495) ve Kap 2 (Y610) dahil sahadaki her
# yeni koordinatı "sınır dışı" diye reddederdi — hem de sebebi görünmeden,
# çünkü panel sınırları ajandan okuyor ve ajan da bu listeden.
#
# cpm değerleri de güncellendi: yanlış cpm ile yedek devreye girmek, yanlış
# MESAFE gitmek demek ve o, yanlış sınırdan daha tehlikeli.
VARSAYILAN_KALIB = [
    {"cpm": 17.1782, "dir": 1, "home": 0.0, "min": 0.0, "max": 535.0},    # X
    {"cpm": 4.2686, "dir": 1, "home": 0.0, "min": 0.0, "max": 630.0},     # Y
    {"cpm": 37.074, "dir": -1, "home": 414.23, "min": 120.0, "max": 414.23},  # Z
]


class PLCHatasi(Exception):
    """Bağlantı yok, hedef sınır dışı, Z güvenli değil ya da acil durdurma mandallı."""


# --------------------------------------------------------------------------- #
# Modbus TCP — çıplak soket
# --------------------------------------------------------------------------- #
# PLC erişilemez sayıldıktan sonra bir sonraki gerçek denemeye kadar geçen
# süre. Kısa tutuluyor: kablo takılınca panelin toparlaması bu kadar sürüyor.
SOGUMA_SN = 3.0


class Modbus:
    """Minik Modbus TCP istemcisi: fonksiyon 3 (oku) ve 6 (tek register yaz).

    Neden kütüphane değil: PLC ile bugün konuşan kod tam olarak bu; aynı
    davranışı (2 denemelik yeniden bağlanma, 1.5 sn zaman aşımı) korumak,
    kütüphane sürüm farklarıyla uğraşmaktan güvenli. Ayrıca Pi'de kurulacak
    bağımlılık sayısı azalıyor.
    """

    def __init__(self, ip: str, port: int, birim: int) -> None:
        self.ip, self.port, self.birim = ip, int(port), int(birim)
        self._soket: socket.socket | None = None
        self._tid = 0
        self._kilit = threading.RLock()
        # SOĞUMA — bkz. SOGUMA_SN.
        self._soguma_bitis = 0.0
        self._soguma_hata: Exception | None = None

    def kapat(self) -> None:
        with self._kilit:
            try:
                if self._soket:
                    self._soket.close()
            except Exception:
                pass
            self._soket = None

    def _al(self, adet: int) -> bytes:
        tampon = b""
        while len(tampon) < adet:
            parca = self._soket.recv(adet - len(tampon))
            if not parca:
                raise IOError("PLC bağlantıyı kapattı")
            tampon += parca
        return tampon

    def _islem(self, fonksiyon: int, govde: bytes) -> bytes:
        with self._kilit:
            # SOĞUMA: PLC erişilemez olduğu BİLİNİYORSA sokete hiç dokunmadan,
            # anında son hatayı veriyoruz.
            #
            # Neden: cevap vermeyen bir PLC'de her işlem iki bağlantı denemesi
            # × 1,5 sn = 3 sn bekliyor ve bunu Modbus KİLİDİNİ TUTARAK yapıyor.
            # Durum döngüsü yarım saniyede bir yokluyor, yani kilit sürekli
            # dolu; araya giren bir kullanıcı komutu hem kendi denemelerini
            # hem yoklamaları bekliyor. Ölçüldü: enable(True) tek başına
            # 12 sn (8 bağlantı denemesi) — sunucunun 20 sn'lik komut zaman
            # aşımını aşıyor ve panelde "Ajan komuta zamanında yanıt vermedi"
            # yazıyordu. Oysa gerçek sebep "PLC'ye ulaşılamıyor" ve panel
            # tam da bunu teşhis edeceğimiz yer.
            #
            # Soğuma boyunca TEK bir gerçek deneme bile yapılmıyor; süre
            # dolunca bir deneme yapılıyor. Kablo takılınca en geç SOGUMA_SN
            # içinde kendiliğinden toparlıyor.
            #
            # Güvenlik: erişilemez bir PLC'ye zaten hiçbir yazma ulaşmıyor —
            # değişen tek şey bunu ne kadar çabuk öğrendiğimiz. Hızlı hata,
            # yavaş sessizlikten güvenli: çağıranlar (dizi, uç değiştirme)
            # hatayı iptal sebebi sayıyor.
            if self._soguma_bitis and time.monotonic() < self._soguma_bitis:
                raise self._soguma_hata
            son_hata = None
            # İki deneme: ilk paket kopmuş bir sokete gidiyorsa ikincisi
            # tazelenmiş bağlantıdan geçer. Fazlası hatayı geciktirmekten
            # başka işe yaramıyor.
            for _ in range(2):
                try:
                    if self._soket is None:
                        self._soket = socket.create_connection((self.ip, self.port), timeout=1.5)
                        self._soket.settimeout(1.5)
                    self._tid = (self._tid + 1) & 0xFFFF
                    pdu = struct.pack(">B", fonksiyon) + govde
                    self._soket.sendall(struct.pack(">HHHB", self._tid, 0, len(pdu) + 1, self.birim) + pdu)
                    baslik = self._al(7)
                    _, _, uzunluk, _ = struct.unpack(">HHHB", baslik)
                    cevap = self._al(uzunluk - 1)
                    if cevap[0] & 0x80:
                        raise IOError("Modbus istisnası %d" % cevap[1])
                    self._soguma_bitis = 0.0        # konuşabildik: soğuma bitti
                    self._soguma_hata = None
                    return cevap[1:]
                except Exception as hata:
                    son_hata = hata
                    self.kapat()
            # Ham hatanın yanına EYLEME DÖNÜK tanıyı da iliştiriyoruz: panel
            # "timed out" yerine ne koptu / olası sebep / ne yapmalı gösteriyor.
            # Metinler tek yerde (tani.py), tanila.py da oradan okuyor.
            hata = PLCHatasi(f"PLC ile konuşulamadı ({self.ip}:{self.port}): {son_hata}")
            hata.tani = tani.plc_hatasindan(self.ip, self.port, son_hata)
            # İki deneme de tükendi: PLC'yi erişilemez sayıp soğumaya alıyoruz.
            self._soguma_bitis = time.monotonic() + SOGUMA_SN
            self._soguma_hata = hata
            raise hata

    def oku(self, adres: int, adet: int) -> list[int]:
        veri = self._islem(3, struct.pack(">HH", adres, adet))
        bayt = veri[0]
        return list(struct.unpack(">" + "H" * (bayt // 2), veri[1:1 + bayt]))

    def yaz(self, adres: int, deger: int) -> None:
        self._islem(6, struct.pack(">HH", adres, deger & 0xFFFF))

    # --- 32 bit float çiftleri (düşük kelime önce) ---
    def float_yaz(self, adres: int, deger: float) -> None:
        bitler = struct.unpack(">I", struct.pack(">f", float(deger)))[0]
        self.yaz(adres, bitler & 0xFFFF)
        self.yaz(adres + 1, (bitler >> 16) & 0xFFFF)

    def float_oku(self, adres: int) -> float:
        r = self.oku(adres, 2)
        return struct.unpack(">f", struct.pack(">I", (r[1] << 16) | r[0]))[0]


# --------------------------------------------------------------------------- #
# Sahte PLC — donanım olmadan denemek için
# --------------------------------------------------------------------------- #
class SahteModbus(Modbus):
    """PLC'nin register davranışını taklit eder.

    Neden üst seviyeyi değil de register katmanını taklit ediyoruz: böylece
    sınır denetimi, Z kilidi, jog kirası ve acil durdurma mantığının **aynısı**
    çalışıyor. Üst seviyeyi taklit etseydik simülasyonda çalışan kod sahada
    ilk kez denenmiş olurdu.
    """

    def __init__(self, kalib: list[dict]) -> None:
        super().__init__("sahte", 0, 1)
        self._kalib = kalib
        self._reg: dict[int, int] = {}
        self._konum = [0.0, 0.0, 0.0]   # ham count
        self._hedef = [0.0, 0.0, 0.0]
        self._git_aktif = [False, False, False]
        self._home_aktif = [False, False, False]
        self._son = time.time()
        # Z'yi güvenli yükseklikte başlatıyoruz; aksi halde simülasyonda ilk
        # X/Y denemesi Z kilidine takılıyor ve panel "bozuk" görünüyor.
        self._konum[2] = (340.0 - kalib[2]["home"]) * kalib[2]["dir"] * kalib[2]["cpm"]
        self._hedef[2] = self._konum[2]
        self._reg[ENABLE_REG] = 1
        # Konum register'larını hemen doldur: ilk döngü turuna kadar (50 ms)
        # okuma yapılırsa ham 0 dönüyordu ve Z, home ofseti yüzünden 438 mm
        # görünüyordu — simülasyon daha başlarken yanlış yerde sanılıyordu.
        for i, eksen in enumerate(EKSENLER):
            self._float_yaz_ic(eksen["konum"], self._konum[i])
            self._float_yaz_ic(eksen["hedef"], self._konum[i])
        threading.Thread(target=self._dongu, daemon=True).start()

    def kapat(self) -> None:
        pass

    def _dongu(self) -> None:
        while True:
            time.sleep(0.05)
            simdi = time.time()
            dt = simdi - self._son
            self._son = simdi
            if not self._reg.get(ENABLE_REG):
                continue
            for i, eksen in enumerate(EKSENLER):
                hiz = abs(self._float_al(eksen["hiz"])) or (20.0 * self._kalib[i]["cpm"])
                if self._reg.get(eksen["jogf"]):
                    self._konum[i] += hiz * dt
                elif self._reg.get(eksen["jogb"]):
                    self._konum[i] -= hiz * dt
                elif self._home_aktif[i]:
                    # Referans arama ayrı bir çevrim: hedef register'ına değil,
                    # switch'e (ham 0) gidiyor. Bitince hedefi de oraya
                    # çekiyoruz, yoksa home biter bitmez eski hedefe kaçardı.
                    adim = hiz * dt
                    if abs(self._konum[i]) <= adim:
                        self._konum[i] = 0.0
                        self._home_aktif[i] = False
                        self._float_yaz_ic(eksen["hedef"], 0.0)
                    else:
                        self._konum[i] += adim if self._konum[i] < 0 else -adim
                elif self._git_aktif[i]:
                    # Hedef register'ı her turda yeniden okuyoruz — gerçek
                    # sürücü de öyle yapıyor. "go" anında değeri kopyalasaydık
                    # acil durdurmanın hedefi nötrlemesi simülasyonda hiçbir
                    # işe yaramaz, sahada ise fark ederdik: makine yeniden
                    # enable verilince yarım kalan harekete devam eder.
                    self._hedef[i] = self._float_al(eksen["hedef"])
                    fark = self._hedef[i] - self._konum[i]
                    adim = hiz * dt
                    if abs(fark) <= adim:
                        self._konum[i] = self._hedef[i]
                        self._git_aktif[i] = False
                    else:
                        self._konum[i] += adim if fark > 0 else -adim
                self._float_yaz_ic(eksen["konum"], self._konum[i])

    def _float_al(self, adres: int) -> float:
        r0, r1 = self._reg.get(adres, 0), self._reg.get(adres + 1, 0)
        return struct.unpack(">f", struct.pack(">I", (r1 << 16) | r0))[0]

    def _float_yaz_ic(self, adres: int, deger: float) -> None:
        bitler = struct.unpack(">I", struct.pack(">f", float(deger)))[0]
        self._reg[adres] = bitler & 0xFFFF
        self._reg[adres + 1] = (bitler >> 16) & 0xFFFF

    def oku(self, adres: int, adet: int) -> list[int]:
        return [self._reg.get(adres + k, 0) for k in range(adet)]

    def yaz(self, adres: int, deger: int) -> None:
        self._reg[adres] = deger & 0xFFFF
        for i, eksen in enumerate(EKSENLER):
            if adres == eksen["go"] and deger:
                self._hedef[i] = self._float_al(eksen["hedef"])
                self._git_aktif[i] = True
                self._home_aktif[i] = False
            elif adres == eksen["home"] and deger:
                self._home_aktif[i] = True      # home switch = ham 0
                self._git_aktif[i] = False


# --------------------------------------------------------------------------- #
# Portal denetleyici
# --------------------------------------------------------------------------- #
class Gantry:
    def __init__(self, ayar: dict[str, Any], gunluk_cb: Callable[[str, str], None] | None = None,
                 bolgeler: Any = None, baglam_saglayici: Callable[[], dict[str, Any]] | None = None) -> None:
        self.ayar = ayar
        # Yasak bölgeler ve koşul bağlamı dışarıdan veriliyor: plc.py bölge
        # dosyasını okumayı ya da hangi ucun takılı olduğunu bilmek zorunda
        # kalmasın. Verilmezse denetim yapılmıyor (birim testleri, sahte kurulum).
        self.bolgeler = bolgeler
        self.baglam_saglayici = baglam_saglayici
        # Uç değiştirme modülü bağlanınca doldurulur (bkz. ajan.py):
        #   z_guvenli_kaynagi() -> True/False/None  (None = mm kuralına düş)
        #   tc_alani(x, y)      -> bool             (uç değiştirme alanı içinde mi)
        self.z_guvenli_kaynagi: Callable[[], bool | None] | None = None
        self.tc_alani: Callable[[float, float], bool] | None = None
        self.kalib = ayar.get("kalibrasyon") or VARSAYILAN_KALIB
        # Panelden kaydedince nereye yazılacağı. Ajan dosyayı okurken bu
        # yolu da geçiriyor; yoksa kayıt yalnızca bellekte kalır.
        self.kalib_yolu = ayar.get("kalibrasyon_tam_yol")
        self.guvenli_z = float(ayar.get("guvenli_z", 340.0))
        # Toprak YÜZEYİNİN makine Z'sindeki yeri. Şimdiye kadar her yer
        # yüzeyi 0 kabul ediyordu; gerçek makinede toprak kabın içinde
        # ve yüzey sıfırdan epey yukarıda. Ekim derinliği, uç açıklığı
        # ve 3B sahnedeki toprak düzlemi bu değere göre yerleşiyor.
        self.toprak_z = float(ayar.get("toprak_z", 0.0))
        # PLC'de "referans tamam" biti yok; her eksene bu kadar süre tanınıyor.
        self.home_bekleme = float(ayar.get("home_bekleme_sn", 8.0))
        # Varış doğrulamasının üst sınırı ve toleransı. Azami süre cömert:
        # bu bir bekleme değil, takılmış bir eksende sonsuza kadar
        # beklememek için konmuş emniyet freni.
        self.home_azami = float(ayar.get("home_azami_sn", 90.0))
        self.home_tolerans = float(ayar.get("home_tolerans_mm", 2.0))
        self.hiz = float(ayar.get("hiz", 20.0))
        # EKSEN BAŞINA HIZ. Z dikey ve yük altında; X/Y ile aynı hızda
        # sürülmesi için bir sebep yok. Girilmemiş eksen genel `hiz`e
        # düşüyor, yani ayar dosyasına dokunmayan kurulumda davranış
        # değişmiyor. Sıra [X, Y, Z].
        self.hiz_eksen: list[float | None] = [
            self._hiz_oku(ayar, "hiz_x"),
            self._hiz_oku(ayar, "hiz_y"),
            self._hiz_oku(ayar, "hiz_z"),
        ]
        self.ivme = float(ayar.get("ivme", 100.0))
        self.yavaslama = float(ayar.get("yavaslama", 100.0))
        self.gunluk_cb = gunluk_cb or (lambda metin, seviye="bilgi": None)

        self.mb: Modbus = (
            SahteModbus(self.kalib) if ayar.get("sahte")
            else Modbus(ayar.get("ip", "192.168.1.88"), ayar.get("port", 502), ayar.get("birim", 1))
        )

        self.acil_mandal: dict[str, Any] = {"acik": False, "saat": "", "neden": ""}
        self._iptal = threading.Event()          # süren hareketi kes
        # Sürücülerin son bilinen durumu. Hareket komutu bunu SORMADAN
        # geçiyordu: sürücüler kapalıyken `git` "Hedefe gidiliyor" diye
        # BAŞARI dönüyor ve makine kımıldamıyordu. Sessiz başarısızlığın en
        # kötü türü — kullanıcı sebebi başka yerde arıyor.
        # None = henüz bilinmiyor (ilk durum okumasına kadar engellemiyoruz).
        self._enable_son: bool | None = None
        self._jog: dict[tuple[int, str], float] = {}
        self._jog_kilit = threading.Lock()
        self._hareket_ip: threading.Thread | None = None
        # Süren işin adı: hata mesajları "hareket" ile "referans arama"yı
        # ayırt edebilsin ve hangi işin kesilebileceğine karar verebilelim.
        self._islem_ad: str = ""
        self.son_hata: str | None = None
        self.hareket_ediyor = False

        threading.Thread(target=self._jog_bekcisi, daemon=True).start()

    # --- birim dönüşümü --------------------------------------------------
    def mm_den_ham(self, i: int, mm: float) -> float:
        k = self.kalib[i]
        return k.get("dir", 1) * (mm - k.get("home", 0.0)) * (k.get("cpm", 1) or 1)

    def ham_dan_mm(self, i: int, ham: float) -> float:
        k = self.kalib[i]
        return k.get("dir", 1) * ham / (k.get("cpm", 1) or 1) + k.get("home", 0.0)

    def sinir_icinde(self, i: int, mm: float) -> bool:
        k = self.kalib[i]
        return (k.get("min", -1e9) - 0.5) <= mm <= (k.get("max", 1e9) + 0.5)

    # --- okuma -----------------------------------------------------------
    def konum_mm(self) -> list[float]:
        """Üç eksenin konumu — TEK Modbus işleminde.

        Eksen başına ayrı okuma yapmak üç gidiş-dönüş demekti. Hareket
        sırasında bekleme döngüsü saniyede 20 kez konum sorduğu için bu trafik
        Modbus kilidini doldurup panelin konum göstergesini geciktiriyordu.
        Konum register'ları 1026 ile 1063 arasına dağılmış; aralığın tamamını
        (38 register) tek istekte alıp diliyoruz — Modbus'ın 125 register
        sınırının çok altında.
        """
        bas = EKSENLER[0]["konum"]
        son = EKSENLER[N - 1]["konum"] + 1
        try:
            blok = self.mb.oku(bas, son - bas + 1)
        except PLCHatasi:
            raise
        sonuc = []
        for i in range(N):
            ofset = EKSENLER[i]["konum"] - bas
            dusuk, yuksek = blok[ofset], blok[ofset + 1]
            ham = struct.unpack(">f", struct.pack(">I", (yuksek << 16) | dusuk))[0]
            sonuc.append(round(self.ham_dan_mm(i, ham), 2))
        return sonuc

    def eksen_konum_mm(self, i: int) -> float:
        """Tek eksenin konumu — bekleme döngüsü üçünü birden okumasın diye."""
        return round(self.ham_dan_mm(i, self.mb.float_oku(EKSENLER[i]["konum"])), 2)

    def z_guvenli_mi(self) -> bool:
        """Z yukarıda mı?

        Önce PLC'deki Z-güvenli biti (`z_safe_reg`) soruluyor: gerçek bir
        switch, milimetre hesabından her zaman daha güvenilir. Register
        tanımlı değilse karar milimetre karşılaştırmasına kalıyor.

        Okunamıyorsa "güvenli değil" deriz — hata anında hareketi serbest
        bırakmak, çarpmanın en kolay yolu.
        """
        if self.z_guvenli_kaynagi is not None:
            try:
                bit = self.z_guvenli_kaynagi()
            except Exception:
                return False
            if bit is not None:
                return bool(bit)
        try:
            return self.konum_mm()[2] >= self.guvenli_z - 1.0
        except Exception:
            return False

    def durum(self) -> dict[str, Any]:
        try:
            konum = self.konum_mm()
            enable = bool(self.mb.oku(ENABLE_REG, 1)[0])
            self._enable_son = enable
            with self._jog_kilit:
                jog_acik = sorted({f"{EKSENLER[i]['ad']}{'+' if k == 'jogf' else '-'}" for (i, k) in self._jog})
            self.son_hata = None
            return {
                "plc": "bagli",
                "konum": {"x": konum[0], "y": konum[1], "z": konum[2]},
                "enable": enable,
                "hareket": self.hareket_ediyor or bool(jog_acik),
                "jog": jog_acik,
                "z_guvenli": konum[2] >= self.guvenli_z - 1.0,
                "guvenli_z": self.guvenli_z,
                "toprak_z": self.toprak_z,
                "acil": dict(self.acil_mandal),
                "sinirlar": {
                    e: {"min": self.kalib[i].get("min"), "max": self.kalib[i].get("max")}
                    for e, i in EKSEN_INDEKS.items()
                },
                # Kalibrasyon panelde salt-okunur gösteriliyor. Sahada "panelde
                # şu yazıyor ama makine başka gidiyor" tartışmasını bitiren şey,
                # ajanın hangi katsayılarla çalıştığını görebilmek.
                "kalibrasyon": {
                    e: {
                        "cpm": self.kalib[i].get("cpm"),
                        "dir": self.kalib[i].get("dir"),
                        "home": self.kalib[i].get("home"),
                    }
                    for e, i in EKSEN_INDEKS.items()
                },
                "hiz": self.hiz,
                # Panel eksen kutularini bunlarla dolduruyor; bos olan
                # "genel hiz gecerli" demek.
                "hiz_x": self.hiz_eksen[0],
                "hiz_y": self.hiz_eksen[1],
                "hiz_z": self.hiz_eksen[2],
                "bolgeler": (self.bolgeler.liste if self.bolgeler else []),
                "esnetme_acik": bool(self.bolgeler and self.bolgeler.esnetme_acik),
                "islem": self._islem_ad if self.hareket_ediyor else "",
                "hata": None,
            }
        except Exception as hata:
            self.son_hata = str(hata)
            # Ham metnin yanına ne koptu / olası sebep / ne yapmalı: panel
            # "timed out" yerine bunu gösteriyor.
            t = getattr(hata, "tani", None) or tani.plc_hatasindan(
                self.mb.ip, self.mb.port, hata)
            # `toprak_z` kopukken de gönderiliyor: yüzey yüksekliği ayardan
            # geliyor, PLC'den değil. Yollamazsak panel bağlantı her
            # koptuğunda 3B sahneyi sıfır yüzeyle yeniden kurardı.
            return {"plc": "kopuk", "konum": {"x": None, "y": None, "z": None},
                    "toprak_z": self.toprak_z,
                    "acil": dict(self.acil_mandal), "hata": str(hata), "tani": t}

    # --- düşük seviye hareket -------------------------------------------
    def _hiz_ivme_yaz(self, i: int, hiz_mm_s: float) -> None:
        cpm = self.kalib[i].get("cpm", 1) or 1
        eksen = EKSENLER[i]
        self.mb.float_yaz(eksen["hiz"], abs(float(hiz_mm_s)) * cpm)
        self.mb.float_yaz(eksen["ivme"], self.ivme * cpm)
        self.mb.float_yaz(eksen["yavaslama"], self.yavaslama * cpm)

    def _eksen_git(self, i: int, mm: float, hiz_mm_s: float) -> None:
        eksen = EKSENLER[i]
        self._hiz_ivme_yaz(i, hiz_mm_s)
        self.mb.float_yaz(eksen["hedef"], self.mm_den_ham(i, mm))
        # Önce hedef, sonra tetik. Ters sırada PLC eski hedefe koşar.
        self.mb.yaz(eksen["go"], 1)
        time.sleep(0.12)
        self.mb.yaz(eksen["go"], 0)

    def _bekleme_suresi(self, i: int, hedef_mm: float, hiz: float | None = None) -> float:
        """Bu hareket için ne kadar beklenmeli?

        Sabit 45 saniye yanlış: 550 mm'lik bir Y yolculuğu 5 mm/s hızda 110
        saniye sürer ve zaman aşımına uğrardı — hareket başarılıyken "ulaşamadı"
        denirdi. Mesafe/hız süresinin üç katı + 10 saniye pay; ivmelenme ve
        yavaşlama için fazlasıyla yeterli, takılan bir eksende de sonsuza
        kadar beklenmiyor.
        """
        try:
            mesafe = abs(self.eksen_konum_mm(i) - hedef_mm)
        except Exception:
            mesafe = 550.0
        # Eksenin KENDİ hızı: Z yavaş ayarlanmışsa genel hızla hesaplanan
        # zaman aşımı, hareket bitmeden dolar ve sağlam bir eksene
        # "ulaşamadı" dedirtir.
        hiz = self.eksen_hizi(i, hiz)
        return min(300.0, max(20.0, mesafe / hiz * 3.0 + 10.0))

    def _eksen_bekle(self, i: int, hedef_mm: float, tolerans: float = 0.6,
                     zaman_asimi: float | None = None, hiz: float | None = None) -> bool:
        if zaman_asimi is None:
            zaman_asimi = self._bekleme_suresi(i, hedef_mm, hiz)
        t0 = time.time()
        while time.time() - t0 < zaman_asimi:
            if self._iptal.is_set() or self.acil_mandal["acik"]:
                return False
            try:
                if abs(self.eksen_konum_mm(i) - hedef_mm) <= tolerans:
                    return True
            except Exception:
                pass
            time.sleep(0.05)
        return False

    def hedefleri_esitle(self) -> int:
        """Her eksenin hedefini bulunduğu yere çeker.

        Acil durdurmanın asıl işi bu: enable'ı kesmek torku alır ama PLC'nin
        hedef register'ı son komutu tutmaya devam eder. Yeniden enable
        verildiğinde sürücü yarım kalan hareketi kaldığı yerden sürdürür.
        """
        sayac = 0
        for i in range(N):
            try:
                self.mb.float_yaz(EKSENLER[i]["hedef"], self.mb.float_oku(EKSENLER[i]["konum"]))
                sayac += 1
            except Exception as hata:
                logger.warning("%s hedefi nötrlenemedi: %s", EKSENLER[i]["ad"], hata)
        return sayac

    # --- jog (basılı tut) ------------------------------------------------
    def _jog_mm_yonu(self, i: int, tur: str) -> int:
        """Bu jog biti milimetre ekseninde hangi yöne gidiyor?

        PLC'nin `jogf` biti eksenin kendi ileri yönü; `dir` −1 olan eksende
        (Z) bu, mm cinsinden aşağı demek.
        """
        ileri_pozitif = float(self.kalib[i].get("dir", 1)) >= 0
        return 1 if (tur == "jogf") == ileri_pozitif else -1

    def _jog_bekcisi(self) -> None:
        """Jog bitlerinin bekçisi — iki iş yapıyor.

        1. **Kira denetimi.** Panel her ~300 ms'de bir "hâlâ açık" diyor.
           Tarayıcı kapanır, telefon kilitlenir ya da ağ giderse yenileme
           gelmez ve eksen JOG_TTL kadar sonra durur. Jog artık basılı tutmayla
           değil tıklamayla açılıp kapandığı için bu koruma daha da önemli:
           düğmeyi bırakan bir parmak yok, geriye yalnızca bu bekçi kalıyor.

        2. **Yumuşak sınırda durdurma.** Basılı tut kipinde ekseni izleyen bir
           operatör vardı. Tıkla-çalış kipinde eksen kendi başına gidiyor;
           sınıra dayanmadan durdurmak artık yazılımın işi. Duruş payı hıza
           göre hesaplanıyor: bekçi turu + yavaşlama mesafesi kadar erken
           kesiyoruz.
        """
        while True:
            time.sleep(JOG_TICK)
            simdi = time.time()
            olenler = []
            with self._jog_kilit:
                acik = list(self._jog.items())
                for anahtar, bitis in acik:
                    if simdi > bitis:
                        olenler.append((anahtar, "kira"))
                        self._jog.pop(anahtar, None)

            # Sınır denetimi yalnızca açık jog varken okuma yapar; boştayken
            # Modbus'a gereksiz trafik bindirmiyor.
            kalanlar = [a for a, _ in acik if (a, "kira") not in olenler]
            if kalanlar:
                try:
                    konum = self.konum_mm()
                except Exception:
                    konum = None
                if konum is not None:
                    for (i, tur) in kalanlar:
                        # Pay EKSEN BAŞINA: hızlı bir eksende dar pay, sınıra
                        # varmadan bırakmayı kaçırır. Hesap döngünün içine
                        # alındı ki her eksen kendi hızına göre paylansın.
                        pay = max(2.0, self.eksen_hizi(i) * 0.5)
                        yon = self._jog_mm_yonu(i, tur)
                        alt = self.kalib[i].get("min")
                        ust = self.kalib[i].get("max")
                        vardi = ((ust is not None and yon > 0 and konum[i] >= float(ust) - pay)
                                 or (alt is not None and yon < 0 and konum[i] <= float(alt) + pay))
                        if vardi:
                            with self._jog_kilit:
                                self._jog.pop((i, tur), None)
                            olenler.append(((i, tur), "sinir"))

            for (i, tur), neden in olenler:
                try:
                    self.mb.yaz(EKSENLER[i][tur], 0)
                    isaret = "+" if self._jog_mm_yonu(i, tur) > 0 else "−"
                    if neden == "sinir":
                        self.gunluk_cb(
                            f"{EKSENLER[i]['ad']}{isaret} yumuşak sınırda durduruldu "
                            f"[{self.kalib[i].get('min')}, {self.kalib[i].get('max')}] mm", "uyari")
                    else:
                        self.gunluk_cb(
                            f"{EKSENLER[i]['ad']}{isaret} bekçi tarafından durduruldu "
                            f"({JOG_TTL:.1f} sn yenileme gelmedi)", "uyari")
                except Exception as hata:
                    logger.error("Bekçi %s bitini kapatamadı: %s", EKSENLER[i]["ad"], hata)

    def jog(self, eksen: str, yon: int, basili: bool) -> dict[str, Any]:
        if eksen not in EKSEN_INDEKS:
            raise PLCHatasi(f"Geçersiz eksen: {eksen}")
        i = EKSEN_INDEKS[eksen]
        # Hangi bit "artı yön"? PLC'nin jogf biti eksenin KENDİ ileri yönü;
        # bu, milimetre ekseninin artı yönü olmak zorunda değil. Z'de
        # `dir` = −1, yani PLC'nin ileri yönü mm cinsinden AŞAĞI. Referans
        # program da tam olarak bu dönüşümü yapıyor (`fwd = dir>=0 ? pos : !pos`).
        # Bunu atlamak, panelde Z+ yazan düğmenin ucu aşağı indirmesi demekti.
        ileri = yon > 0 if float(self.kalib[i].get("dir", 1)) >= 0 else yon < 0
        tur = "jogf" if ileri else "jogb"

        if basili:
            if self.acil_mandal["acik"]:
                raise PLCHatasi("ACİL DURDURMA mandallı — önce temizleyin")
            self._surucu_dogrula()
            # Süren bir hareket varken jog, aynı eksenin register'larına iki
            # yazıcı demek: hareket işçisi hedefi tazelerken jog mandalı da
            # açık kalıyor ve eksenin nereye gideceği belirsizleşiyor.
            if self._hareket_ip and self._hareket_ip.is_alive():
                raise PLCHatasi(f"{self._islem_ad or 'Hareket'} sürüyor — jog için önce durdurun")
            # Z yukarıda değilken X/Y kilitli. Bu kontrol her yenilemede
            # tekrarlanıyor: jog sırasında Z düşerse hareket kendiliğinden durur.
            if i in (0, 1) and not self.z_guvenli_mi():
                # Uç değiştirme alanı: yalnızca bu alanın İÇİNDE ve alan
                # AÇIKKEN Z şartı düşüyor. Uçlar alçak Z'de takılıp
                # çıkarılabilsin diye var; alan kapalıyken hiçbir muafiyet yok
                # ve muafiyetin kapsamı alanın dışına taşmıyor.
                alanda = False
                if self.tc_alani is not None:
                    try:
                        simdi = self.konum_mm()
                        alanda = bool(self.tc_alani(simdi[0], simdi[1]))
                    except Exception:
                        alanda = False
                if not alanda:
                    self.jog_hepsini_birak()
                    raise PLCHatasi(
                        f"{EKSENLER[i]['ad']} hareket edemez — Z güvenli yükseklikte değil "
                        f"(≥ {self.guvenli_z:.0f} mm gerekiyor). Önce Z'yi kaldırın.")

            # Bölge denetimi: mevcut konuma değil, İLERİYE bakıyoruz. Sadece
            # bulunduğumuz noktaya baksaydık eksen bölgeye girdikten sonra
            # dururdu — yani bir miktar içeri girmiş olurdu. Bir sonraki
            # yenilemeye kadar (JOG_TTL) katedilecek yolu tarıyoruz.
            if self.bolgeler is not None:
                simdiki = self.konum_mm()
                # İhlal hâlindeyken kaçış: yalnızca Z+ jog serbest.
                bas_ihlal = self.bolgeler.ihlal(simdiki[0], simdiki[1], simdiki[2], self.baglam())
                if bas_ihlal and not (i == 2 and yon > 0):
                    self.jog(eksen, yon, False)
                    raise PLCHatasi(
                        f"Makine bölge ihlali hâlinde ({bas_ihlal}). "
                        "Bu konumdan yalnızca Z+ (yukarı) hareket edebilirsiniz.")
                ileri = list(simdiki)
                ileri[i] += yon * self.eksen_hizi(i) * JOG_TTL
                ileri[i] = max(float(self.kalib[i].get("min", -1e9)),
                               min(float(self.kalib[i].get("max", 1e9)), ileri[i]))
                try:
                    self.bolgeler.yol_kontrol(tuple(simdiki), tuple(ileri), self.baglam())
                except Exception as hata:
                    self.jog(eksen, yon, False)
                    raise PLCHatasi(str(hata))
            self._iptal.clear()
            self._hiz_ivme_yaz(i, self.eksen_hizi(i))
            # Kirayı ÖNCE al: bit açıldıktan sonra alsaydık, arada bekçi turu
            # geçerse açık bir biti hiç görmeyebilirdi.
            with self._jog_kilit:
                self._jog[(i, tur)] = time.time() + JOG_TTL
            self.mb.yaz(EKSENLER[i][tur], 1)
        else:
            with self._jog_kilit:
                self._jog.pop((i, tur), None)
            self.mb.yaz(EKSENLER[i][tur], 0)

        return {"eksen": eksen, "yon": yon, "basili": basili}

    def jog_hepsini_birak(self) -> None:
        with self._jog_kilit:
            self._jog.clear()
        for i in range(N):
            for tur in ("jogf", "jogb"):
                try:
                    self.mb.yaz(EKSENLER[i][tur], 0)
                except Exception:
                    pass

    # --- yüksek seviye komutlar -----------------------------------------
    def enable(self, ac: bool) -> str:
        if ac and self.acil_mandal["acik"]:
            raise PLCHatasi(f"ACİL DURDURMA mandallı ({self.acil_mandal['saat']}) — önce temizleyin")
        if ac:
            # Bayat hedefe enable vermek, yarım kalan hareketi başlatır.
            self.hedefleri_esitle()
            # Sürücüler kenar bekliyor olabilir. Register zaten 1 okuyorsa
            # üstüne 1 yazmak hiçbir şey değiştirmez: bir arıza sonrası
            # düşmüş sürücü öylece kapalı kalır ve komutlar sessizce yutulur.
            # Önce 0 yazıp kısa bir duraklama ile 0 → 1 geçişi üretiyoruz —
            # operatörün fiziksel enable anahtarını çevirmesinin karşılığı.
            self.mb.yaz(ENABLE_REG, 0)
            time.sleep(0.15)
        self.mb.yaz(ENABLE_REG, 1 if ac else 0)
        # Onbellek ANINDA guncelleniyor: durum dongusu yarim saniyede bir
        # okuyor ve o araliga denk gelen ilk jog "surucüler kapali" diye
        # reddedilirdi.
        self._enable_son = bool(ac)
        return "Sürücüler açık" if ac else "Sürücüler kapalı"

    def _surucu_dogrula(self) -> None:
        """Sürücüler kapalıyken hareket komutunu REDDEDER.

        Eskiden komut kabul ediliyor, PLC'ye hedef yazılıyor ve makine
        kımıldamıyordu; panel "Hedefe gidiliyor" yazdığı için sebep
        aranacak son yer sürücüler oluyordu.

        `None` iken (henüz hiç durum okunmamış) engellemiyoruz: bilmediğimiz
        bir şey yüzünden kullanıcıyı durdurmak, yanlış sebeple engellemek
        olur.
        """
        if self._enable_son is False:
            raise PLCHatasi(
                "Sürücüler kapalı — makine komutu alır ama kımıldamaz. "
                "Önce 'Sürücüler' düğmesiyle açın.")

    def _onceki_isi_kes(self, yeni_is: str) -> None:
        """Süren işi, kesilebilir bir şeyse iptal edip bitmesini bekler.

        Operatör bir noktaya giderken listeden başka bir noktaya tıklarsa
        kastı "önce durdur, sonra tıkla" değil, "oraya değil buraya git"tir.
        Bu yüzden basit bir konum hareketi yeni bir hareketle **değiştirilir**.

        Referans arama, uç değiştirme ve program dizisi böyle değil: yarıda
        kesilip yerine tek bir hareket konulması, makineyi dizinin ortasında
        tanımsız bir durumda bırakır. Onlar açıkça durdurulmadan yeni komut
        kabul edilmiyor.
        """
        if not (self._hareket_ip and self._hareket_ip.is_alive()):
            self._islem_ad = ""
            return

        if self._islem_ad not in ("hareket", ""):
            raise PLCHatasi(
                f"{self._islem_ad} sürüyor — {yeni_is} için önce durdurun")

        self._iptal.set()
        self._hareket_ip.join(timeout=3.0)
        if self._hareket_ip.is_alive():
            # İşçi 3 saniyede çıkmadıysa bir yerde takılmış demektir; üstüne
            # yeni hareket başlatmak iki yazıcı yaratır.
            raise PLCHatasi("Önceki hareket sonlanmadı — durdurup tekrar deneyin")
        self._iptal.clear()
        self.gunluk_cb("Önceki hareket iptal edildi", "bilgi")

    def git(self, x: float | None, y: float | None, z: float | None, hiz: float | None = None) -> str:
        """Hedefe git. Sıra Z → Y → X, her eksen bitmeden diğeri başlamaz.

        Hareket arka planda yürüyor: bulut komutu 45 saniye bekletemez, panelin
        durum akışı ilerlemeyi zaten gösteriyor.
        """
        if self.acil_mandal["acik"]:
            raise PLCHatasi("ACİL DURDURMA mandallı — önce temizleyin")
        self._surucu_dogrula()
        self._onceki_isi_kes("hareket")

        simdiki = self.konum_mm()
        hedef = [
            simdiki[0] if x is None else float(x),
            simdiki[1] if y is None else float(y),
            simdiki[2] if z is None else float(z),
        ]
        for i in range(N):
            if not self.sinir_icinde(i, hedef[i]):
                raise PLCHatasi(
                    f"{EKSENLER[i]['ad']} hedefi sınır dışı: {hedef[i]:.1f} mm "
                    f"[{self.kalib[i]['min']:.0f}, {self.kalib[i]['max']:.0f}]")

        # X/Y yer değiştirecekse yol Z güvenli yükseklikten geçmeli.
        yatay_var = abs(hedef[0] - simdiki[0]) > 0.2 or abs(hedef[1] - simdiki[1]) > 0.2
        adimlar = self._adim_plani(simdiki, hedef, yatay_var)

        # Yasak bölge denetimi hareket BAŞLAMADAN, planın tamamı üzerinde
        # yapılıyor. Adım adım denetleseydik makine iki adım gidip üçüncüde
        # dururdu — yarım kalmış bir hareket, hiç başlamamış olandan kötü.
        self._bolge_plani_denetle(simdiki, adimlar)

        # None geçiyor: aşağıdaki `_git_isci` her eksen için `eksen_hizi`
        # çağırıyor ve eksenin kendi ayarı geçerli oluyor. Çağrıda AÇIK bir
        # hız verildiyse o aynen taşınıyor ve eksen ayarını eziyor.
        hiz_mm_s = float(hiz) if hiz else None
        self._iptal.clear()
        self._islem_ad = "hareket"
        self._hareket_ip = threading.Thread(
            target=self._git_isci, args=(adimlar, hiz_mm_s), daemon=True)
        self._hareket_ip.start()
        return f"Hedefe gidiliyor: X{hedef[0]:.1f} Y{hedef[1]:.1f} Z{hedef[2]:.1f}"

    def git_senkron(self, x: float | None, y: float | None, z: float | None,
                    hiz: float | None = None) -> None:
        """`git` ile AYNI yolu izler ama bitene kadar döner değil — dizi
        adımları için.

        Ayrı bir hareket yolu açmıyoruz bilerek: aynı plan, aynı sınır ve
        bölge denetimi, aynı Z→Y→X sırası. İki kod yolu olsaydı biri
        düzeltilip diğeri unutulurdu.
        """
        if self.acil_mandal["acik"]:
            raise PLCHatasi("ACİL DURDURMA mandallı")
        self._surucu_dogrula()
        simdiki = self.konum_mm()
        hedef = [simdiki[0] if x is None else float(x),
                 simdiki[1] if y is None else float(y),
                 simdiki[2] if z is None else float(z)]
        for i in range(N):
            if not self.sinir_icinde(i, hedef[i]):
                raise PLCHatasi(
                    f"{EKSENLER[i]['ad']} hedefi sınır dışı: {hedef[i]:.1f} mm "
                    f"[{self.kalib[i]['min']:.0f}, {self.kalib[i]['max']:.0f}]")
        yatay_var = abs(hedef[0] - simdiki[0]) > 0.2 or abs(hedef[1] - simdiki[1]) > 0.2
        adimlar = self._adim_plani(simdiki, hedef, yatay_var)
        self._bolge_plani_denetle(simdiki, adimlar)
        for i, deger, etiket in adimlar:
            if self.kesildi_mi():
                raise PLCHatasi("Hareket durduruldu")
            if abs(self.eksen_konum_mm(i) - deger) < 0.2:
                continue
            eh = self.eksen_hizi(i, hiz)
            self._eksen_git(i, deger, eh)
            if not self._eksen_bekle(i, deger, hiz=eh):
                if self.kesildi_mi():
                    raise PLCHatasi("Hareket durduruldu")
                raise PLCHatasi(f"{etiket} ekseni {deger:.1f} mm'ye ulaşamadı (zaman aşımı)")

    def _adim_plani(self, simdiki: list[float], hedef: list[float],
                    yatay_var: bool) -> list[tuple[int, float, str]]:
        """Hareketin adım adım planı: (eksen, hedef mm, etiket).

        Sıra: (gerekirse Z'yi güvenli yüksekliğe kaldır) → Y → X → Z indir.
        Plan hem denetim hem yürütme tarafından kullanılıyor; ikisinin aynı
        listeden okuması, "denetlenen yol ile gidilen yol farklı" hatasının
        önünü kesiyor.
        """
        adimlar: list[tuple[int, float, str]] = []
        if yatay_var and simdiki[2] < self.guvenli_z - 1.0:
            adimlar.append((2, self.guvenli_z, "Z güvenli yüksekliğe"))
        adimlar += [(1, hedef[1], "Y"), (0, hedef[0], "X"), (2, hedef[2], "Z")]
        return adimlar

    def _bolge_plani_denetle(self, simdiki: list[float],
                             adimlar: list[tuple[int, float, str]]) -> None:
        """Planın her parçasını yasak bölgelere karşı denetler."""
        if self.bolgeler is None:
            return
        baglam = self.baglam()

        # Makine hâlihazırda ihlal hâlindeyse (bir bölgenin içinde, koşulu
        # sağlamadan duruyorsa) her hareketi engellemek onu kilitler: çıkış
        # hamlesi de engellenmiş olur ve operatörün elinde bölgeleri kapatmak
        # dışında seçenek kalmaz. Bu durumda YALNIZCA Z'yi yukarı almaya izin
        # veriyoruz — açıklığı ancak artırabilecek tek hareket bu. Yanlamasına
        # sürüklenme (asıl tehlikeli olan) engelli kalıyor.
        bas_ihlal = self.bolgeler.ihlal(simdiki[0], simdiki[1], simdiki[2], baglam)
        if bas_ihlal:
            yalniz_z_yukari = all(
                i == 2 and deger > simdiki[2] + 0.2 for i, deger, _ in adimlar
                if abs(deger - simdiki[{0: 0, 1: 1, 2: 2}[i]]) > 0.2)
            if not yalniz_z_yukari:
                raise PLCHatasi(
                    f"Makine şu anda bölge ihlali hâlinde ({bas_ihlal}). "
                    "Bu konumdan yalnızca Z'yi yukarı almaya izin var — "
                    "önce Z'yi güvenli yüksekliğe kaldırın.")
            self.gunluk_cb(f"Bölge ihlalinden çıkış: Z yukarı ({bas_ihlal})", "uyari")
            return

        konum = list(simdiki)
        for i, deger, _ in adimlar:
            yeni = list(konum)
            yeni[i] = deger
            try:
                self.bolgeler.yol_kontrol(tuple(konum), tuple(yeni), baglam)
            except Exception as hata:
                # Engel sınıfını burada isimle yakalamıyoruz ki bolgeler modülü
                # olmadan da plc.py çalışsın (sahte kurulum, birim testleri).
                raise PLCHatasi(str(hata))
            konum = yeni

    def baglam(self) -> dict[str, Any]:
        """Bölge koşullarında kullanılan değişkenler."""
        temel = {"safe_z": self.guvenli_z, "zmax": float(self.kalib[2].get("max", 550.0)),
                 "prox": False, "tool": ""}
        if self.baglam_saglayici:
            try:
                temel.update(self.baglam_saglayici() or {})
            except Exception:
                pass
        return temel

    def _git_isci(self, adimlar: list[tuple[int, float, str]], hiz: float) -> None:
        self.hareket_ediyor = True
        try:
            for i, deger, etiket in adimlar:
                if self._iptal.is_set() or self.acil_mandal["acik"]:
                    self.gunluk_cb("Hareket iptal edildi", "uyari")
                    return
                if abs(self.eksen_konum_mm(i) - deger) < 0.2:
                    continue
                self.gunluk_cb(f"{etiket} → {deger:.1f} mm", "bilgi")
                eh = self.eksen_hizi(i, hiz)
                self._eksen_git(i, deger, eh)
                if not self._eksen_bekle(i, deger, hiz=eh):
                    neden = "iptal edildi" if (self._iptal.is_set() or self.acil_mandal["acik"]) \
                        else f"{deger:.1f} mm'ye ulaşamadı (zaman aşımı)"
                    self.gunluk_cb(f"{etiket} {neden}", "hata")
                    return
            self.gunluk_cb("Hedefe ulaşıldı", "bilgi")
        except Exception as hata:
            self.gunluk_cb(f"Hareket hatası: {hata}", "hata")
        finally:
            self.hareket_ediyor = False
            self._iptal_sahipligi_birak()

    def harici_is_baslat(self, ad: str, isci: Callable[[], None]) -> None:
        """Uç değiştirme / program dizisi gibi dış modüllerin işini başlatır.

        Hareket sahipliği tek yerde kalsın diye: `_islem_ad` ve `_hareket_ip`
        buradan yönetiliyor, böylece `git`, `jog` ve `dur` süren dizinin
        varlığını görüyor ve araya girmiyor.
        """
        self._onceki_isi_kes(ad)
        self._iptal.clear()
        self._islem_ad = ad

        def sarmal() -> None:
            self.hareket_ediyor = True
            try:
                isci()
            except Exception as hata:
                self.gunluk_cb(f"{ad} hatası: {hata}", "hata")
            finally:
                self.hareket_ediyor = False
                self._iptal_sahipligi_birak()

        self._hareket_ip = threading.Thread(target=sarmal, daemon=True)
        self._hareket_ip.start()

    def _iptal_sahipligi_birak(self) -> None:
        """İşi biten iş parçacığı iptal bayrağını bırakır.

        `_iptal` "şu an süren işi kes" demek; iş bittiğinde bayrak bayat
        kalıyor. Bayat bayrak gerçek bir hataya yol açtı: durdurulan bir
        dizinin temizlik adımı (`dur()`) bayrağı yeniden kaldırıyor ve
        hemen sonra başlatılan YENİ dizi ilk adımında "durduruldu" diye
        ölüyordu. Bayrağı yalnızca onu son kullanan iş parçacığı bırakıyor,
        böylece araya giren yeni bir işin bayrağı silinmiyor.
        """
        if threading.current_thread() is self._hareket_ip:
            self._iptal.clear()

    def kesildi_mi(self) -> bool:
        """Dizi adımları arasında çağrılır: durduruldu mu, acil mi?"""
        return self._iptal.is_set() or self.acil_mandal["acik"]

    def eksen_git_dogrula(self, i: int, mm: float, hiz: float | None = None,
                          tolerans: float = 0.6, bolge_denetle: bool = True) -> None:
        """Tek ekseni mutlak konuma götürür ve VARDIĞINI DOĞRULAR.

        Referanstaki uç değiştirme dizisinde bazı adımların dönüş değeri
        denetlenmiyor; eksen hedefe varmasa da dizi devam ediyor. Bir uç
        değiştirme dizisinde bu, kilit açılmadan kalkmaya çalışmak demek.
        Burada her adım doğrulanıyor ve varılmadıysa istisna atılıyor.
        """
        if self.acil_mandal["acik"]:
            raise PLCHatasi("ACİL DURDURMA mandallı")
        self._surucu_dogrula()
        if not self.sinir_icinde(i, mm):
            raise PLCHatasi(
                f"{EKSENLER[i]['ad']} hedefi sınır dışı: {mm:.1f} mm "
                f"[{self.kalib[i]['min']:.0f}, {self.kalib[i]['max']:.0f}]")

        simdiki = self.konum_mm()
        if bolge_denetle:
            # Dizi sürerken de bölge denetimi geçerli. Yalnızca 'yuva'
            # işaretli bölgeler, yalnızca esnetme açıkken atlanıyor.
            self._bolge_plani_denetle(simdiki, [(i, mm, EKSENLER[i]["ad"])])

        if abs(simdiki[i] - mm) < 0.2:
            return
        eh = self.eksen_hizi(i, hiz)
        self._eksen_git(i, mm, eh)
        if not self._eksen_bekle(i, mm, tolerans=tolerans, hiz=eh):
            if self.kesildi_mi():
                raise PLCHatasi("Dizi durduruldu")
            raise PLCHatasi(
                f"{EKSENLER[i]['ad']} ekseni {mm:.1f} mm'ye ulaşamadı "
                f"(şu an {self.eksen_konum_mm(i):.1f} mm) — dizi durduruldu")

    def home(self, eksen: str | None = None) -> str:
        """Referans arama — eksenler SIRAYLA, aralarında bekleyerek.

        Buradaki bekleme neden zorunlu: PLC'de "referans tamam" biti eşlenmiş
        değil, yani eksenin switch'e vardığını okuyamıyoruz. Darbeyi atıp
        hemen sıradaki eksene geçmek, Z hâlâ inip çıkarken X ve Y'yi hareket
        ettirmek demek — uç aşağıdayken yatay hareket, tam olarak Z kilidinin
        önlemeye çalıştığı şey.

        Bu yüzden sıra Z → X → Y ve her eksen için `home_bekleme` saniye
        bekleniyor. Bu bir doğrulama değil, süreli bekleme: değeri en yavaş
        ekseninizin referans süresinden uzun tutun.
        """
        if self.acil_mandal["acik"]:
            raise PLCHatasi("ACİL DURDURMA mandallı — önce temizleyin")
        self._surucu_dogrula()
        self._onceki_isi_kes("referans arama")

        sira = [EKSEN_INDEKS[eksen]] if eksen else [2, 0, 1]   # Z, X, Y

        # Tek eksen istendiginde Z korumasi elle konmali. "Hepsi" sirasi
        # (Z, X, Y) Z'yi once referansladigi icin guvenli; ama panelden
        # yalniz X ya da Y istenirse o koruma devreye girmiyordu ve uc
        # asagidayken yatay hareket olusuyordu — Z kilidinin tam olarak
        # onlemeye calistigi sey.
        if eksen and EKSEN_INDEKS[eksen] in (0, 1) and not self.z_guvenli_mi():
            raise PLCHatasi(
                f"Z güvenli yükseklikte değil "
                f"(≥ {self.guvenli_z:.0f} mm gerekiyor). Önce Z'yi kaldırın "
                f"ya da 'Tümü' ile referans arayın.")
        self._iptal.clear()
        self._islem_ad = "referans arama"
        self._hareket_ip = threading.Thread(target=self._home_isci, args=(sira,), daemon=True)
        self._hareket_ip.start()
        adlar = " → ".join(EKSENLER[i]["ad"] for i in sira)
        return f"Referans arama başlatıldı: {adlar}"

    def _home_isci(self, sira: list[int]) -> None:
        self.hareket_ediyor = True
        try:
            for i in sira:
                if self._iptal.is_set() or self.acil_mandal["acik"]:
                    self.gunluk_cb("Referans arama iptal edildi", "uyari")
                    return
                reg = EKSENLER[i].get("home") or EKSENLER[i]["go"]
                self.gunluk_cb(f"{EKSENLER[i]['ad']} referans aranıyor...", "bilgi")
                self.mb.yaz(reg, 1)
                time.sleep(0.2)
                self.mb.yaz(reg, 0)
                if not self._home_varisi_bekle(i, reg):
                    # SIRAYI KESİYORUZ. Z'nin referansa vardığı
                    # doğrulanamadıysa X ve Y'yi sürmek, uç aşağıdayken
                    # yatay hareket demek — Z kilidinin önlemeye çalıştığı
                    # şeyin ta kendisi. Yarım kalan referans, hiç
                    # başlamamış olandan tehlikeli.
                    self.gunluk_cb(
                        f"{EKSENLER[i]['ad']} referansa varmadı — sıra kesildi",
                        "hata")
                    return
        except Exception as hata:
            self.gunluk_cb(f"Referans arama hatası: {hata}", "hata")
        finally:
            self.hareket_ediyor = False
            self._iptal_sahipligi_birak()

    def _home_varisi_bekle(self, i: int, reg: int) -> bool:
        """Eksenin referans anahtarına VARDIĞINI doğrular.

        Eskiden burada sabit bir süre uyunuyordu (`home_bekleme_sn`, 8 sn).
        Sorun şu: bu bir doğrulama değil tahmindi. Referansı 8 saniyeden
        uzun süren bir eksende sıra, o eksen hâlâ hareket hâlindeyken
        sonrakine geçiyordu — kullanıcı açısından "bir kez bastım, hepsi
        gitmedi" diye görünüyor, tehlike açısından Z inip çıkarken X'in
        sürülmesi demek.

        PLC'de "referans tamam" biti eşlenmiş değil, ama KONUM okunabiliyor:
        eksen anahtara varınca PLC sayacı sıfırlanıyor ve konum tam olarak
        `home` değerine oturuyor. Beklediğimiz işaret bu.

        İki koşul birden aranıyor: konum home'a yeterince yakın VE arka
        arkaya birkaç okumada değişmiyor. Yalnız yakınlık yetmez — eksen
        home'un yanından geçerken de bir an yakın görünür.

        Konum hiç okunamıyorsa eski davranışa dönülüyor (süreli bekleme):
        okuma yoksa doğrulama da yok, ama makineyi büsbütün kullanılamaz
        hâle getirmek doğru olmaz.
        """
        hedef = float(self.kalib[i].get("home", 0.0))
        bitis = time.time() + self.home_azami
        kararli = 0
        onceki = None
        okunamadi = 0
        while time.time() < bitis:
            if self._iptal.is_set() or self.acil_mandal["acik"]:
                self.mb.yaz(reg, 0)
                self.gunluk_cb("Referans arama iptal edildi", "uyari")
                return False
            try:
                simdi = self.eksen_konum_mm(i)
                okunamadi = 0
            except Exception:
                okunamadi += 1
                # Üst üste okunamıyorsa doğrulama yapamıyoruz; eski
                # süreli beklemeye düşüyoruz.
                if okunamadi >= 5:
                    self.gunluk_cb(
                        f"{EKSENLER[i]['ad']} konumu okunamıyor — "
                        f"{self.home_bekleme:.0f} sn süreli beklemeye dönüldü",
                        "uyari")
                    time.sleep(self.home_bekleme)
                    return True
                time.sleep(0.2)
                continue

            yakin = abs(simdi - hedef) <= self.home_tolerans
            durgun = onceki is not None and abs(simdi - onceki) < 0.05
            onceki = simdi
            kararli = kararli + 1 if (yakin and durgun) else 0
            if kararli >= 3:                    # ~0.6 sn boyunca yerinde
                self.gunluk_cb(
                    f"{EKSENLER[i]['ad']} referans tamam ({simdi:.2f} mm)", "bilgi")
                return True
            time.sleep(0.2)

        self.gunluk_cb(
            f"{EKSENLER[i]['ad']} {self.home_azami:.0f} sn içinde referansa "
            f"varmadı (hedef {hedef:.2f} mm)", "hata")
        return False

    def dur(self) -> str:
        """Süren hareketi kes ve jog bitlerini bırak. Mandal bırakmaz."""
        self._iptal.set()
        self.jog_hepsini_birak()
        for i in range(N):
            for anahtar in ("go", "home"):
                try:
                    self.mb.yaz(EKSENLER[i][anahtar], 0)
                except Exception:
                    pass
        self.hedefleri_esitle()
        return "Hareket durduruldu"

    def acil(self, neden: str = "panel") -> str:
        """ACİL DURDURMA — mandallı. Temizlenmeden hiçbir hareket komutu geçmez."""
        self._iptal.set()
        try:
            self.jog_hepsini_birak()
        except Exception:
            pass
        for i in range(N):
            for anahtar in ("go", "home"):
                try:
                    self.mb.yaz(EKSENLER[i][anahtar], 0)
                except Exception:
                    pass
        sayac = self.hedefleri_esitle()
        try:
            self.mb.yaz(ENABLE_REG, 0)
        except Exception:
            pass
        self.acil_mandal = {"acik": True, "saat": time.strftime("%H:%M:%S"), "neden": neden}
        self.gunluk_cb(f"ACİL DURDURMA ({neden}) — {sayac}/{N} hedef nötrlendi", "hata")
        return f"ACİL DURDURMA uygulandı — {sayac}/{N} hedef nötrlendi"

    def acil_temizle(self) -> str:
        # Temizlerken hedefleri yeniden eşitliyoruz: temizlemenin kendisi bayat
        # bir hedefin kaçmasına vesile olmasın.
        self.hedefleri_esitle()
        self.acil_mandal = {"acik": False, "saat": "", "neden": ""}
        self._iptal.clear()
        self.gunluk_cb("ACİL DURDURMA temizlendi", "bilgi")
        return "Acil durdurma temizlendi — sürücüleri açabilirsiniz"

    @staticmethod
    def _hiz_oku(ayar: dict[str, Any], ad: str) -> float | None:
        """Ayardan bir eksen hızı; yoksa None (genel hız geçerli)."""
        deger = ayar.get(ad)
        if deger in (None, ""):
            return None
        try:
            return max(1.0, min(200.0, float(deger)))
        except (TypeError, ValueError):
            return None

    def eksen_hizi(self, i: int, hiz: float | None = None) -> float:
        """Bu eksen hangi hızla sürülecek.

        Öncelik: çağrıda AÇIKÇA verilen hız > eksenin kendi ayarı > genel
        hız. Açık değerin kazanması önemli: uç değiştirme dizisi kendi
        yaklaşma hızını veriyor ve eksen ayarı onu ezmemeli.
        """
        if hiz:
            return max(0.5, float(hiz))
        ozel = self.hiz_eksen[i] if 0 <= i < len(self.hiz_eksen) else None
        return max(0.5, float(ozel if ozel is not None else self.hiz))

    #: Panelden düzenlenebilen kalibrasyon alanları. `cpm` ve `dir`
    #: BİLEREK dışarıda: yanlış cpm "gitmeyi reddediyor" değil YANLIŞ
    #: MESAFE gitmek demek ve panelden yanlışlıkla değiştirilmesi çok
    #: pahalı. Onlar Gantry Studio ölçümünden geliyor ve dosyadan
    #: düzenleniyor.
    DUZENLENEBILIR_KALIB = ("home", "min", "max")

    def kalibrasyon_kaydet(self, yeni: list[dict[str, Any]]) -> str:
        """Panelden gelen home/min/max değerlerini doğrular ve uygular.

        Dosyaya da yazıyor: ayar yalnızca bellekte kalsaydı ajan yeniden
        başlayınca eski değere dönerdi ve kullanıcı sebebini aramazdı.
        """
        if not isinstance(yeni, list) or len(yeni) != N:
            raise PLCHatasi(f"Kalibrasyon {N} eksen içermeli")
        temiz = [dict(k) for k in self.kalib]
        for i, gelen in enumerate(yeni):
            if not isinstance(gelen, dict):
                raise PLCHatasi(f"{EKSENLER[i]['ad']} ekseni bir nesne olmalı")
            for alan in self.DUZENLENEBILIR_KALIB:
                if alan not in gelen or gelen[alan] in (None, ""):
                    continue
                try:
                    deger = float(gelen[alan])
                except (TypeError, ValueError):
                    raise PLCHatasi(f"{EKSENLER[i]['ad']} {alan} sayı olmalı") from None
                if not -10000.0 <= deger <= 10000.0:
                    raise PLCHatasi(f"{EKSENLER[i]['ad']} {alan} makul aralıkta değil")
                temiz[i][alan] = round(deger, 2)
            # Sınırların sırası bozulursa her hedef reddedilir ve sebebi
            # görünmez; burada yakalıyoruz.
            if float(temiz[i]["min"]) >= float(temiz[i]["max"]):
                raise PLCHatasi(
                    f"{EKSENLER[i]['ad']} min ({temiz[i]['min']}) max'tan "
                    f"({temiz[i]['max']}) küçük olmalı")
# ULAŞILAMAZ SINIR. Konum `dir * sayaç / cpm + home` ile hesaplanıyor
            # ve sayaç hiçbir zaman negatif olmuyor. Dolayısıyla dir NEGATİFSE
            # konum home'un ÜSTÜNE çıkamaz, POZİTİFSE altına inemez. Bunun
            # dışında bir sınır yazmak, makinenin hiçbir zaman varamayacağı
            # bir bölgeyi "geçerli" ilan etmek demek: hedef kabul edilir,
            # eksen sürülür, zaman aşımına kadar beklenir ve "ulaşamadı"
            # denir. Sahada tam bu yaşandı — Z'nin max'ı 550 yazıyordu ama
            # home 414.23 olduğu için 135 mm'lik bölge ulaşılamazdı.
            k = self.kalib[i]
            yon = float(k.get("dir", 1))
            ev = float(temiz[i]["home"])
            if yon < 0 and float(temiz[i]["max"]) > ev + 0.01:
                raise PLCHatasi(
                    f"{EKSENLER[i]['ad']} max ({temiz[i]['max']:g}) home'dan "
                    f"({ev:g}) büyük olamaz: bu eksende yön negatif, yani "
                    f"konum home'un üstüne çıkamıyor. Makine oraya hiç "
                    f"varamaz.")
            if yon > 0 and float(temiz[i]["min"]) < ev - 0.01:
                raise PLCHatasi(
                    f"{EKSENLER[i]['ad']} min ({temiz[i]['min']:g}) home'dan "
                    f"({ev:g}) küçük olamaz: bu eksende yön pozitif, yani "
                    f"konum home'un altına inemiyor.")
        self.kalib = temiz
        self._kalib_dosyaya_yaz(temiz)
        return " · ".join(
            f"{EKSENLER[i]['ad']} home {temiz[i]['home']:g} "
            f"({temiz[i]['min']:g}–{temiz[i]['max']:g})" for i in range(N))

    def _kalib_dosyaya_yaz(self, kalib: list[dict[str, Any]]) -> None:
        yol = self.kalib_yolu
        if not yol:
            self.gunluk_cb(
                "Kalibrasyon dosyası tanımlı değil — değişiklik yalnızca "
                "bu oturum için geçerli", "uyari")
            return
        gecici = yol + ".tmp"
        with open(gecici, "w", encoding="utf-8") as dosya:
            json.dump(kalib, dosya, ensure_ascii=False, indent=1)
            dosya.write(chr(10))
        os.replace(gecici, yol)          # yarım dosya bırakmayan değiştirme
        self.gunluk_cb(f"Kalibrasyon yazıldı: {yol}", "bilgi")

    def hiz_ayarla(self, mm_s: float) -> str:
        mm_s = max(1.0, min(200.0, float(mm_s)))
        self.hiz = mm_s
        return f"Hız: {mm_s:.0f} mm/s"

    def kapat(self) -> None:
        try:
            self.jog_hepsini_birak()
        finally:
            self.mb.kapat()


def olustur(ayar: dict[str, Any], gunluk_cb=None, bolgeler: Any = None,
            baglam_saglayici: Callable[[], dict[str, Any]] | None = None) -> Gantry:
    return Gantry(ayar, gunluk_cb, bolgeler=bolgeler, baglam_saglayici=baglam_saglayici)
