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

import logging
import socket
import struct
import threading
import time
from typing import Any, Callable

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

VARSAYILAN_KALIB = [
    {"cpm": 7.0, "dir": 1, "home": 0.0, "min": 0.0, "max": 425.0},      # X
    {"cpm": 2.2746, "dir": 1, "home": 0.0, "min": 0.0, "max": 600.0},   # Y
    {"cpm": 56.8376, "dir": -1, "home": 438.0, "min": 0.0, "max": 550.0},  # Z
]


class PLCHatasi(Exception):
    """Bağlantı yok, hedef sınır dışı, Z güvenli değil ya da acil durdurma mandallı."""


# --------------------------------------------------------------------------- #
# Modbus TCP — çıplak soket
# --------------------------------------------------------------------------- #
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
                    return cevap[1:]
                except Exception as hata:
                    son_hata = hata
                    self.kapat()
            raise PLCHatasi(f"PLC ile konuşulamadı ({self.ip}:{self.port}): {son_hata}")

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
    def __init__(self, ayar: dict[str, Any], gunluk_cb: Callable[[str, str], None] | None = None) -> None:
        self.ayar = ayar
        self.kalib = ayar.get("kalibrasyon") or VARSAYILAN_KALIB
        self.guvenli_z = float(ayar.get("guvenli_z", 340.0))
        self.hiz = float(ayar.get("hiz", 20.0))
        self.ivme = float(ayar.get("ivme", 100.0))
        self.yavaslama = float(ayar.get("yavaslama", 100.0))
        self.gunluk_cb = gunluk_cb or (lambda metin, seviye="bilgi": None)

        self.mb: Modbus = (
            SahteModbus(self.kalib) if ayar.get("sahte")
            else Modbus(ayar.get("ip", "192.168.1.88"), ayar.get("port", 502), ayar.get("birim", 1))
        )

        self.acil_mandal: dict[str, Any] = {"acik": False, "saat": "", "neden": ""}
        self._iptal = threading.Event()          # süren hareketi kes
        self._jog: dict[tuple[int, str], float] = {}
        self._jog_kilit = threading.Lock()
        self._hareket_ip: threading.Thread | None = None
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
        return [round(self.ham_dan_mm(i, self.mb.float_oku(EKSENLER[i]["konum"])), 2) for i in range(N)]

    def z_guvenli_mi(self) -> bool:
        """Z yukarıda mı? Okunamıyorsa 'güvenli değil' deriz — hata anında
        hareketi serbest bırakmak, çarpmanın en kolay yolu."""
        try:
            return self.konum_mm()[2] >= self.guvenli_z - 1.0
        except Exception:
            return False

    def durum(self) -> dict[str, Any]:
        try:
            konum = self.konum_mm()
            enable = bool(self.mb.oku(ENABLE_REG, 1)[0])
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
                "acil": dict(self.acil_mandal),
                "sinirlar": {
                    e: {"min": self.kalib[i].get("min"), "max": self.kalib[i].get("max")}
                    for e, i in EKSEN_INDEKS.items()
                },
                "hiz": self.hiz,
                "hata": None,
            }
        except Exception as hata:
            self.son_hata = str(hata)
            return {"plc": "kopuk", "konum": {"x": None, "y": None, "z": None},
                    "acil": dict(self.acil_mandal), "hata": str(hata)}

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

    def _eksen_bekle(self, i: int, hedef_mm: float, tolerans: float = 0.6, zaman_asimi: float = 45.0) -> bool:
        t0 = time.time()
        while time.time() - t0 < zaman_asimi:
            if self._iptal.is_set() or self.acil_mandal["acik"]:
                return False
            try:
                if abs(self.konum_mm()[i] - hedef_mm) <= tolerans:
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
    def _jog_bekcisi(self) -> None:
        """Kirası dolan jog bitini düşürür.

        Panel her ~300 ms'de bir 'hâlâ basılıyım' diyor. Tarayıcı kapanır,
        telefon kilitlenir ya da internet giderse yenileme gelmez ve eksen
        JOG_TTL kadar sonra durur.
        """
        while True:
            time.sleep(JOG_TICK)
            simdi = time.time()
            olenler = []
            with self._jog_kilit:
                for anahtar, bitis in list(self._jog.items()):
                    if simdi > bitis:
                        olenler.append(anahtar)
                        self._jog.pop(anahtar, None)
            for (i, tur) in olenler:
                try:
                    self.mb.yaz(EKSENLER[i][tur], 0)
                    self.gunluk_cb(
                        f"{EKSENLER[i]['ad']} {'+' if tur == 'jogf' else '-'} bekçi tarafından durduruldu "
                        f"({JOG_TTL:.1f} sn yenileme gelmedi)", "uyari")
                except Exception as hata:
                    logger.error("Bekçi %s bitini kapatamadı: %s", EKSENLER[i]["ad"], hata)

    def jog(self, eksen: str, yon: int, basili: bool) -> dict[str, Any]:
        if eksen not in EKSEN_INDEKS:
            raise PLCHatasi(f"Geçersiz eksen: {eksen}")
        i = EKSEN_INDEKS[eksen]
        tur = "jogf" if yon > 0 else "jogb"

        if basili:
            if self.acil_mandal["acik"]:
                raise PLCHatasi("ACİL DURDURMA mandallı — önce temizleyin")
            # Z yukarıda değilken X/Y kilitli. Bu kontrol her yenilemede
            # tekrarlanıyor: jog sırasında Z düşerse hareket kendiliğinden durur.
            if i in (0, 1) and not self.z_guvenli_mi():
                self.jog_hepsini_birak()
                raise PLCHatasi(
                    f"{EKSENLER[i]['ad']} hareket edemez — Z güvenli yükseklikte değil "
                    f"(≥ {self.guvenli_z:.0f} mm gerekiyor). Önce Z'yi kaldırın.")
            self._iptal.clear()
            self._hiz_ivme_yaz(i, self.hiz)
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
        self.mb.yaz(ENABLE_REG, 1 if ac else 0)
        return "Sürücüler açık" if ac else "Sürücüler kapalı"

    def git(self, x: float | None, y: float | None, z: float | None, hiz: float | None = None) -> str:
        """Hedefe git. Sıra Z → Y → X, her eksen bitmeden diğeri başlamaz.

        Hareket arka planda yürüyor: bulut komutu 45 saniye bekletemez, panelin
        durum akışı ilerlemeyi zaten gösteriyor.
        """
        if self.acil_mandal["acik"]:
            raise PLCHatasi("ACİL DURDURMA mandallı — önce temizleyin")
        if self._hareket_ip and self._hareket_ip.is_alive():
            raise PLCHatasi("Zaten süren bir hareket var — önce durdurun")

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
        hiz_mm_s = float(hiz or self.hiz)
        self._iptal.clear()
        self._hareket_ip = threading.Thread(
            target=self._git_isci, args=(hedef, yatay_var, hiz_mm_s), daemon=True)
        self._hareket_ip.start()
        return f"Hedefe gidiliyor: X{hedef[0]:.1f} Y{hedef[1]:.1f} Z{hedef[2]:.1f}"

    def _git_isci(self, hedef: list[float], yatay_var: bool, hiz: float) -> None:
        self.hareket_ediyor = True
        try:
            # Sıra: (gerekirse Z'yi güvenli yüksekliğe kaldır) → Y → X → Z indir.
            adimlar: list[tuple[int, float, str]] = []
            if yatay_var and not self.z_guvenli_mi():
                adimlar.append((2, self.guvenli_z, "Z güvenli yüksekliğe"))
            adimlar += [(1, hedef[1], "Y"), (0, hedef[0], "X"), (2, hedef[2], "Z")]

            for i, deger, etiket in adimlar:
                if self._iptal.is_set() or self.acil_mandal["acik"]:
                    self.gunluk_cb("Hareket iptal edildi", "uyari")
                    return
                if abs(self.konum_mm()[i] - deger) < 0.2:
                    continue
                self.gunluk_cb(f"{etiket} → {deger:.1f} mm", "bilgi")
                self._eksen_git(i, deger, hiz)
                if not self._eksen_bekle(i, deger):
                    neden = "iptal edildi" if (self._iptal.is_set() or self.acil_mandal["acik"]) \
                        else f"{deger:.1f} mm'ye ulaşamadı (zaman aşımı)"
                    self.gunluk_cb(f"{etiket} {neden}", "hata")
                    return
            self.gunluk_cb("Hedefe ulaşıldı", "bilgi")
        except Exception as hata:
            self.gunluk_cb(f"Hareket hatası: {hata}", "hata")
        finally:
            self.hareket_ediyor = False

    def home(self, eksen: str | None = None) -> str:
        """Referans arama. Eksen verilmezse sıra Z → Y → X."""
        if self.acil_mandal["acik"]:
            raise PLCHatasi("ACİL DURDURMA mandallı — önce temizleyin")
        sira = [EKSEN_INDEKS[eksen]] if eksen else [2, 1, 0]
        for i in sira:
            reg = EKSENLER[i].get("home") or EKSENLER[i]["go"]
            self.mb.yaz(reg, 1)
            time.sleep(0.2)
            self.mb.yaz(reg, 0)
        adlar = ", ".join(EKSENLER[i]["ad"] for i in sira)
        return f"Referans arama başlatıldı: {adlar}"

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

    def hiz_ayarla(self, mm_s: float) -> str:
        mm_s = max(1.0, min(200.0, float(mm_s)))
        self.hiz = mm_s
        return f"Hız: {mm_s:.0f} mm/s"

    def kapat(self) -> None:
        try:
            self.jog_hepsini_birak()
        finally:
            self.mb.kapat()


def olustur(ayar: dict[str, Any], gunluk_cb=None) -> Gantry:
    return Gantry(ayar, gunluk_cb)
