#!/usr/bin/env python3
"""Karttaki sketch'i GERİ OKUR — boş mu, bizim firmware mı?

NİYE BU YOL. "Kart hiç konuşmuyor" ile "sketch silinmiş" dışarıdan aynı
görünüyor: ikisinde de tek bayt gelmiyor. Seri hattı dinleyerek ayırmak
imkânsız, çünkü ölçülen şey zaten kartın konuşmaması. Ayıran tek kanıt
FLASH'IN KENDİSİ:

    * Silinmiş bir AVR flash'ı baştan sona 0xFF.
    * Bizim sketch yüklüyse flash'ın içinde "VERI:{" metni DURUYOR.
      Sketch onu `Serial.print(F("VERI:{\\"hava_sicaklik\\":"))` diye
      yazıyor ve F() makrosu dizgiyi PROGMEM'de, yani FLASH'ta tutuyor —
      SRAM'e kopyalanmadığı için geri okunan dökümde birebir duruyor.

Yani "sketch var mı" sorusu, "flash'ta bu dizgi var mı" sorusuna iniyor ve
o ölçülebilir bir şey.

SALT OKUNUR. avrdude yalnız `flash:r:` ile çağrılıyor — okuma. Silme ya da
yazma komutu bu dosyada hiç geçmiyor. Okuma için önyükleyici kartı
sıfırlıyor; çalışan sketch varsa baştan başlıyor, içeriği değişmiyor.

ÖNYÜKLEYİCİ DE SINANIYOR. Hiçbir kart/hız bileşimiyle imza okunamazsa
sorun sketch'ten önce: önyükleyici yok ya da USB-seri hattı çalışmıyor.
O durumda sketch yüklemek de zaten mümkün olmaz ve bunu bilmek gerekiyor.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

#: Denenecek (programlayıcı, yonga, hız) üçlüleri. Bu makinede kart
#: /dev/ttyUSB olarak çıkıyor, yani USB-seri çevirici ayrı bir yonga
#: (CH340/FTDI) — Uno/Nano klonlarının deseni, o yüzden m328p başta.
#: Nano'nun eski önyükleyicisi 57600 kullanıyor; yenisi 115200.
BILESIMLER = [
    ("arduino", "m328p", 115200),      # Uno, yeni Nano
    ("arduino", "m328p", 57600),       # eski Nano önyükleyicisi
    ("arduino", "m328p", 19200),
    ("wiring",  "m2560", 115200),      # Mega 2560
    ("arduino", "m168",  19200),       # eski Nano/Duemilanove
    ("arduino", "m32u4", 57600),       # Leonardo/Micro (nadir, ttyACM olur)
]

#: Flash'ta aranan imzalar. Uydurulmadı: `firmware/farmbot_sensors/
#: farmbot_sensors.ino` içindeki F() makrosuyla sarılmış dizgilerden
#: alındı — F() dizgiyi PROGMEM'de, yani FLASH'ta tutuyor, o yüzden geri
#: okunan dökümde birebir bulunuyorlar.
#: `VERI:{` köprünün beklediği önek; ötekiler komut çözümleyicisinden.
IMZALAR = [b"VERI:{", b"HATA: ROLE", b"HATA: UC indeksi", b"KOMUT: uc ",
           b"HATA: bilinmeyen komut"]


def renk(metin: str, kod: str) -> str:
    return metin if not sys.stdout.isatty() else f"\033[{kod}m{metin}\033[0m"


def basik(metin: str) -> None:
    print("\n" + metin)
    print("─" * len(metin))


def tutan_surecler(port: str) -> list[tuple[int, str]]:
    """Portu açık tutan süreçler — /proc üstünden, ek paket istemeden."""
    bulunan: list[tuple[int, str]] = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        fd_dizin = f"/proc/{pid}/fd"
        try:
            for fd in os.listdir(fd_dizin):
                try:
                    if os.readlink(os.path.join(fd_dizin, fd)) == port:
                        try:
                            with open(f"/proc/{pid}/cmdline", "rb") as d:
                                ad = d.read().replace(b"\0", b" ").decode(
                                    "utf-8", "replace").strip()
                        except OSError:
                            ad = "?"
                        bulunan.append((int(pid), ad))
                        break
                except OSError:
                    continue
        except OSError:
            continue
    return bulunan


def oku_dene(avrdude: str, port: str, prog: str, yonga: str, hiz: int,
             hedef: str) -> tuple[bool, str]:
    """Tek bileşimle flash okuma denemesi. (başarılı_mı, avrdude_çıktısı)"""
    komut = [avrdude, "-c", prog, "-p", yonga, "-P", port, "-b", str(hiz),
             "-U", f"flash:r:{hedef}:r"]
    try:
        p = subprocess.run(komut, capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return False, "zaman aşımı"
    except OSError as hata:
        return False, str(hata)
    ok = p.returncode == 0 and os.path.exists(hedef) and os.path.getsize(hedef) > 0
    return ok, (p.stderr or p.stdout)


def imza_satiri(cikti: str) -> str:
    for satir in cikti.splitlines():
        if "signature" in satir.lower() or "Device signature" in satir:
            return satir.strip()
    return ""


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Karttaki sketch'i geri okur (SALT OKUNUR)")
    ap.add_argument("--port", default="/dev/ttyUSB0")
    ap.add_argument("--kaydet", default="",
                    help="flash dökümünü bu dosyaya da bırak")
    arg = ap.parse_args()

    basik("1. ÖN KOŞULLAR")
    avrdude = shutil.which("avrdude")
    if not avrdude:
        print(renk("   avrdude kurulu değil.", "31"))
        print(renk("   sudo apt install -y avrdude", "33"))
        return 2
    print(f"   avrdude      : {avrdude}")

    if not os.path.exists(arg.port):
        print(renk(f"   {arg.port} yok.", "31"))
        return 1
    erisim = os.access(arg.port, os.R_OK | os.W_OK)
    print(f"   {arg.port}  ({'erişim var' if erisim else 'ERİŞİM YOK'})")
    tutanlar = tutan_surecler(arg.port)
    if tutanlar:
        print(renk("   PORT BAŞKA BİR SÜREÇTE AÇIK — avrdude karta "
                   "ulaşamaz:", "31"))
        for pid, ad in tutanlar:
            print(renk(f"      pid {pid}  {ad[:80]}", "33"))
        print(renk("   Önce durdurun:  sudo systemctl stop farmbot-ajan", "33"))
        return 1

    basik("2. ÖNYÜKLEYİCİ VE FLASH OKUMA")
    gecici = tempfile.mkdtemp(prefix="flash-")
    hedef = os.path.join(gecici, "flash.bin")
    kazanan = None
    son_cikti = ""
    for prog, yonga, hiz in BILESIMLER:
        print(f"   deneniyor: -c {prog} -p {yonga} -b {hiz} ... ", end="",
              flush=True)
        ok, cikti = oku_dene(avrdude, arg.port, prog, yonga, hiz, hedef)
        son_cikti = cikti
        if ok:
            print(renk("OKUNDU", "32"))
            kazanan = (prog, yonga, hiz)
            break
        print("olmadı")

    if not kazanan:
        print(renk("\n   Hiçbir bileşimle karta ulaşılamadı.", "31"))
        print("   Bu, sketch'ten ÖNCEKİ bir sorun: önyükleyici cevap "
              "vermiyor.")
        print("   Sırasıyla bakın:")
        print("     1. USB kablosu veri taşıyor mu — yalnız güç veren "
              "kablolar var. (Port göründüğüne göre taşıyor gibi ama "
              "TX/RX hattı kopuk olabilir.)")
        print("     2. Kartın pin 0/1'ine bir şey bağlı mı — bağlıysa "
              "çıkarıp tekrar deneyin; USB seri o pinleri paylaşıyor.")
        print("     3. Servo/röle beslemesi Arduino'nun 5V'undan mı "
              "çekiliyor — akım çökerse kart sürekli sıfırlanır ve "
              "önyükleyici de cevap veremez. Ayrı besleme, GND ortak.")
        print("     4. Kart gerçekten AVR mi (ESP/STM32 ise avrdude "
              "çalışmaz).")
        print(renk("\n   avrdude'un son sözü:", "90"))
        for satir in son_cikti.splitlines()[-8:]:
            print("     " + satir.strip()[:110])
        return 1

    prog, yonga, hiz = kazanan
    imza = imza_satiri(son_cikti)
    if imza:
        print(f"   {imza[:110]}")

    with open(hedef, "rb") as d:
        ham = d.read()

    basik("3. FLASH BOŞ MU")
    toplam = len(ham)
    dolu = sum(1 for b in ham if b != 0xFF)
    # Silinmiş AVR flash'ı baştan sona 0xFF; tek bir dolu bayt bile
    # "boş değil" demek. Oran yine de yazılıyor, çünkü "boş sayılır" ile
    # "içi dolu" arasındaki fark gözle görülsün.
    print(f"   yonga        : {yonga}  ({prog}, {hiz} baud)")
    print(f"   flash        : {toplam} bayt")
    print(f"   0xFF olmayan : {dolu} bayt  (%{dolu / max(toplam, 1) * 100:.2f})")
    if dolu == 0:
        print(renk("   FLASH TAMAMEN BOŞ — karta hiç sketch yüklü değil.", "31"))
        print(renk("   Arduino IDE ile firmware/farmbot_sensors/"
                   "farmbot_sensors.ino dosyasını yükleyin.", "33"))
        return 1

    basik("4. YÜKLÜ OLAN BİZİM SKETCH Mİ")
    bulunan = [i for i in IMZALAR if i in ham]
    for i in IMZALAR:
        isaret = renk("VAR", "32") if i in ham else renk("yok", "31")
        print(f"   {i.decode():<12} {isaret}")
    if b"VERI:{" in ham:
        print(renk("\n   Sketch yüklü ve 'VERI:' dizgisi flash'ta — doğru "
                   "firmware.", "32"))
        print("   Sorun sketch'te değil: kart çalışmıyor ya da başka hızda "
              "konuşuyor olabilir.")
        print("   Sırada:  ./ajan/.venv/bin/python ajan/seri_tara.py")
        sonuc = 0
    elif bulunan:
        print(renk("\n   Flash dolu ve tanıdık parçalar var ama 'VERI:' YOK "
                   "— ESKİ bir sürüm yüklü.", "31"))
        print(renk("   firmware/farmbot_sensors/farmbot_sensors.ino "
                   "dosyasını yükleyin.", "33"))
        sonuc = 1
    else:
        print(renk("\n   Flash dolu ama bu depodan çıkan hiçbir dizgi yok — "
                   "kartta BAŞKA bir program var.", "31"))
        print(renk("   firmware/farmbot_sensors/farmbot_sensors.ino "
                   "dosyasını yükleyin.", "33"))
        sonuc = 1

    if arg.kaydet:
        with open(arg.kaydet, "wb") as d:
            d.write(ham)
        print(f"\n   döküm kaydedildi: {arg.kaydet}")
    else:
        print(f"\n   döküm: {hedef}")
    return sonuc


if __name__ == "__main__":
    sys.exit(main())
