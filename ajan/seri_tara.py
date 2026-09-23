#!/usr/bin/env python3
"""Seri hattı tarar — Arduino konuşuyor mu, konuşuyorsa hangi hızda.

NİYE AYRI BİR ARAÇ. `tanila.py` ayarlardaki TEK porta ve TEK baud hızına
bakıyor; "port açıldı ama VERI: satırı gelmiyor" dediğinde geriye üç
ihtimal kalıyor ve hangisi olduğu görünmüyor:

    a) kart hiç konuşmuyor          (sketch yüklü değil / çalışmıyor / TX yok)
    b) konuşuyor ama başka hızda    (sketch'teki Serial.begin farklı)
    c) konuşuyor, hız doğru, ama VERI: öneki yok (eski sketch)

Bu üçü GÖZLE ayrılıyor ve ayıran şey ölçülebilir: yanlış baud hızında
gelen baytların çoğu yazdırılamaz oluyor (yüksek bit set), doğru hızda
neredeyse tamamı yazdırılabilir ASCII. O yüzden burada birden çok hız
deneniyor ve her biri için YAZDIRILABİLİR ORAN yazılıyor; kazananı sabit
bir eşik değil, oranların en büyüğü seçiyor.

HİÇBİR ŞEY YAZMIYOR — kartın durumunu değiştirmiyor. Tek istisna `--uc`
verilirse gönderilen tek satırlık uç komutu; o da açıkça istenmeden
gönderilmiyor.

DİKKAT: ajan çalışırken seri portu O tutuyor ve baytları o okuyor. Bu araç
aynı anda çalışırsa ikisi de yarım satır görür. Araç bunu kendi tespit
ediyor ve ne yapılacağını söylüyor.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

# Denenen hızlar: Arduino örneklerinde ve bu depodaki sketch'lerde geçen
# değerler. Sıra hızdan bağımsız; hepsi deneniyor ve karşılaştırılıyor.
HIZLAR = [9600, 19200, 38400, 57600, 74880, 115200]

#: Her hızda ne kadar dinlenecek. Sketch saniyede bir satır basıyorsa
#: 3 saniye en az iki satır demek; altına inince "hiç gelmedi" ile
#: "yavaş geliyor" karışıyor.
DINLEME_SN = 3.0

#: Port açılınca Arduino DTR ile sıfırlanıyor; ilk saniyelerde gelen
#: baytlar önyükleyicinin. `arduino.py` de 2 sn bekliyor.
SIFIRLAMA_SN = 2.0


def renk(metin: str, kod: str) -> str:
    return metin if not sys.stdout.isatty() else f"\033[{kod}m{metin}\033[0m"


def basik(metin: str) -> None:
    print("\n" + metin)
    print("─" * len(metin))


def portlari_bul() -> list[str]:
    return sorted(glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*"))


def tutan_surecler(port: str) -> list[tuple[int, str]]:
    """Portu açık tutan süreçler — /proc üstünden, ek paket istemeden.

    `lsof`/`fuser` her kurulumda yok; /proc her Linux'ta var. Erişilemeyen
    süreçler (başka kullanıcının) sessizce atlanıyor, çünkü root olmadan
    okunamıyorlar ve bu bir arıza değil.
    """
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


def ayar_oku() -> dict:
    kok = os.path.dirname(os.path.abspath(__file__))
    for ad in ("ayarlar.json", "ayarlar.ornek.json"):
        yol = os.path.join(kok, ad)
        if os.path.exists(yol):
            try:
                with open(yol, encoding="utf-8") as d:
                    return {"dosya": ad, **(json.load(d).get("arduino") or {})}
            except (json.JSONDecodeError, OSError) as hata:
                return {"dosya": ad, "hata": str(hata)}
    return {}


def yazdirilabilir_oran(ham: bytes) -> float:
    """Baytların kaçı okunabilir metin. Doğru baud'un imzası bu.

    Sayılanlar: 0x20-0x7E arası basılabilirler + \\r, \\n, \\t. Türkçe
    karakterler UTF-8'de yüksek bitli geliyor ama sketch'in VERI: satırı
    saf ASCII; insan satırlarında geçen birkaç Türkçe harf oranı anlamlı
    ölçüde düşürmüyor.
    """
    if not ham:
        return 0.0
    iyi = sum(1 for b in ham if 32 <= b <= 126 or b in (9, 10, 13))
    return iyi / len(ham)


def hizi_dene(port: str, baud: int, sn: float) -> dict:
    import serial

    sonuc = {"baud": baud, "bayt": 0, "oran": 0.0, "satir": [], "veri": False,
             "hata": ""}
    try:
        seri = serial.Serial(port, baud, timeout=0.5)
    except Exception as hata:                            # noqa: BLE001
        sonuc["hata"] = str(hata)
        return sonuc
    try:
        time.sleep(SIFIRLAMA_SN)
        seri.reset_input_buffer()
        biten = time.time() + sn
        ham = b""
        while time.time() < biten:
            parca = seri.read(256)
            if parca:
                ham += parca
        sonuc["bayt"] = len(ham)
        sonuc["oran"] = yazdirilabilir_oran(ham)
        metin = ham.decode("utf-8", errors="replace")
        sonuc["satir"] = [s.strip() for s in metin.splitlines() if s.strip()][-4:]
        sonuc["veri"] = any(s.startswith("VERI:") for s in sonuc["satir"])
    finally:
        try:
            seri.close()
        except Exception:                                # noqa: BLE001
            pass
    return sonuc


def uc_dene(port: str, baud: int, arg: str, sn: float = 3.0) -> None:
    """Tek satır `UC <indeks> <derece> <sure_ms>` gönderip cevabı yazar.

    Kartın anladığı biçim `arduino.py` içindeki çözümleyiciden geliyor;
    burada tekrar doğrulanmıyor, kart neyi reddederse onu yazıyoruz —
    aracın işi kartın ne dediğini göstermek, onun yerine karar vermek
    değil.
    """
    import serial

    basik(f"4. UÇ SERVOSU — 'UC {arg}' gönderiliyor ({baud} baud)")
    try:
        seri = serial.Serial(port, baud, timeout=0.5)
    except Exception as hata:                            # noqa: BLE001
        print(renk(f"   açılamadı: {hata}", "31"))
        return
    try:
        time.sleep(SIFIRLAMA_SN)
        seri.reset_input_buffer()
        seri.write(("UC " + arg + "\n").encode("ascii", errors="ignore"))
        seri.flush()
        print(f"   gönderildi: UC {arg}")
        biten = time.time() + sn
        ham = b""
        while time.time() < biten:
            parca = seri.read(256)
            if parca:
                ham += parca
        if not ham:
            print(renk("   kart hiç cevap vermedi", "31"))
        else:
            print("   kartın cevabı:")
            for satir in ham.decode("utf-8", "replace").splitlines():
                if satir.strip():
                    print("     " + satir.strip()[:110])
        print(renk("   SERVO GERÇEKTEN DÖNDÜ MÜ? Kart 'tamam' dese de "
                   "servo beslemesi yoksa mil kımıldamaz; gözle bakın.", "33"))
    finally:
        try:
            seri.close()
        except Exception:                                # noqa: BLE001
            pass


def main() -> int:
    ap = argparse.ArgumentParser(description="Seri hattı tarar (salt okunur)")
    ap.add_argument("--port", default="", help="varsayılan: ayarlar.json")
    ap.add_argument("--sure", type=float, default=DINLEME_SN,
                    help=f"her hızda dinleme süresi (varsayılan {DINLEME_SN})")
    ap.add_argument("--uc", default="",
                    help="tarama sonrası uç komutu dene, örn: --uc '0 90 800'")
    arg = ap.parse_args()

    try:
        import serial                                    # noqa: F401
    except ImportError:
        print(renk("pyserial kurulu değil: "
                   "./.venv/bin/pip install pyserial", "31"))
        return 2

    ayar = ayar_oku()
    basik("1. PORTLAR")
    if ayar:
        print(f"   ayar dosyası : {ayar.get('dosya')}")
        print(f"   ayardaki port: {ayar.get('port')}   baud: {ayar.get('baud')}")
        if ayar.get("sahte"):
            print(renk("   DİKKAT: arduino.sahte = true — ajan gerçek kartı "
                       "hiç açmıyor, sahte veri üretiyor.", "33"))
    portlar = portlari_bul()
    # `--port` ELLE VERİLDİYSE tarama listesi boş olsa da sürüyor: sembolik
    # bağ (/dev/serial/by-id/...) ya da alışılmadık bir sürücü adı bu
    # kalıpların dışında kalabiliyor ve araç orada durmamalı.
    if arg.port and os.path.exists(arg.port) and arg.port not in portlar:
        portlar = [arg.port] + portlar
    if not portlar:
        print(renk("   /dev/ttyUSB* ve /dev/ttyACM* yok — kart hiç "
                   "görünmüyor. USB kablosu veri taşımıyor olabilir "
                   "(yalnız güç veren kablolar var) ya da kart USB'den "
                   "beslenip veri hattı kopuk.", "31"))
        return 1
    for p in portlar:
        erisim = "erişim VAR" if os.access(p, os.R_OK | os.W_OK) else "ERİŞİM YOK"
        print(f"   {p}  ({erisim})")
        for pid, ad in tutan_surecler(p):
            print(renk(f"      portu TUTAN süreç: pid {pid}  {ad[:80]}", "33"))

    port = arg.port or str(ayar.get("port") or portlar[0])
    if not os.path.exists(port):
        print(renk(f"\n   AYARDAKİ PORT YOK: {port}", "31"))
        print(renk(f"   Var olan: {', '.join(portlar)}", "33"))
        print(renk("   ayarlar.json > arduino.port bunlardan biri olmalı. "
                   "(Bu dosya makineye ait, depoda değil.)", "33"))
        port = portlar[0]
        print(f"   tarama şu portla sürüyor: {port}")

    tutanlar = tutan_surecler(port)
    if tutanlar:
        print(renk(f"\n   {port} BAŞKA BİR SÜREÇTE AÇIK. İkisi birden "
                   "okursa baytlar bölünür ve bu tarama yanıltır.", "31"))
        print(renk("   Önce durdurun:  sudo systemctl stop farmbot-ajan", "33"))
        print(renk("   Tarama yine de sürüyor, ama sonucu buna göre okuyun.",
                   "33"))

    basik(f"2. HIZ TARAMASI — {port}, her hız {arg.sure:.0f} sn")
    print("   hız      bayt   yazdırılabilir   VERI: satırı")
    sonuclar = []
    for baud in HIZLAR:
        s = hizi_dene(port, baud, arg.sure)
        sonuclar.append(s)
        if s["hata"]:
            print(f"   {baud:<7}  —      —                {s['hata'][:40]}")
            continue
        print(f"   {baud:<7}  {s['bayt']:<6} %{s['oran']*100:5.1f}"
              f"           {'VAR' if s['veri'] else 'yok'}")

    basik("3. SONUÇ")
    gelen = [s for s in sonuclar if s["bayt"] > 0]
    if not gelen:
        print(renk("   Hiçbir hızda TEK BAYT gelmedi.", "31"))
        print("   Bu, hız sorunu DEĞİL: kart konuşmuyor.")
        print("   Sırasıyla bakın:")
        print("     1. Sketch yüklü mü — Arduino IDE ile "
              "firmware/farmbot_sensors/farmbot_sensors.ino yükleyin.")
        print("     2. Sketch'te Serial.begin(...) satırı var mı.")
        print("     3. Kartın TX ucu bir shield/kablo ile meşgul mü "
              "(pin 0/1 kullanılıyorsa USB seri susar).")
        print("     4. Kart sürekli sıfırlanıyor olabilir — servo beslemesi "
              "Arduino'nun 5V'undan çekiliyorsa akım çöküyor ve kart "
              "resetleniyor; servoya AYRI besleme verin, GND'yi ortaklayın.")
        return 1

    # KAZANANI EŞİK DEĞİL, KARŞILAŞTIRMA SEÇİYOR: en yüksek yazdırılabilir
    # oran. Eşit oranlarda daha çok bayt geleni tercih ediyoruz.
    en_iyi = max(gelen, key=lambda s: (round(s["oran"], 2), s["bayt"]))
    print(f"   En okunaklı hız: {renk(str(en_iyi['baud']), '32')} "
          f"(yazdırılabilir %{en_iyi['oran']*100:.1f}, {en_iyi['bayt']} bayt)")
    for satir in en_iyi["satir"]:
        print("     " + satir[:110])

    ayar_baud = int(ayar.get("baud") or 0)
    if en_iyi["oran"] < 0.85:
        print(renk("   Gelen baytların çoğu okunamıyor — denenen hızların "
                   "HİÇBİRİ doğru değil ya da hat gürültülü.", "31"))
        print("   Sketch'teki Serial.begin(...) değerine bakıp --port ile "
              "elle deneyin.")
    elif en_iyi["veri"]:
        if ayar_baud and ayar_baud != en_iyi["baud"]:
            print(renk(f"   BULUNDU: kart {en_iyi['baud']} baud konuşuyor ama "
                       f"ayarlar.json {ayar_baud} diyor.", "31"))
            print(renk(f"   ayarlar.json > arduino.baud = {en_iyi['baud']} "
                       "yapın, sonra: sudo systemctl restart farmbot-ajan",
                       "33"))
        else:
            print(renk("   Kart doğru hızda ve VERI: satırı basıyor. Sorun "
                       "seri hatta değil — ajan portu açamıyor ya da başka "
                       "bir süreç tutuyor olabilir (yukarıdaki listeye "
                       "bakın).", "32"))
    else:
        print(renk("   Kart konuşuyor ve satırlar okunuyor, ama VERI: öneki "
                   "YOK — karttaki sketch eski sürüm.", "31"))
        print(renk("   firmware/farmbot_sensors/farmbot_sensors.ino "
                   "dosyasını yükleyin.", "33"))
        if ayar_baud and ayar_baud != en_iyi["baud"]:
            print(renk(f"   Ayrıca hız da tutmuyor: kart {en_iyi['baud']}, "
                       f"ayar {ayar_baud}.", "33"))

    if arg.uc:
        uc_dene(port, en_iyi["baud"], arg.uc)

    return 0


if __name__ == "__main__":
    sys.exit(main())
