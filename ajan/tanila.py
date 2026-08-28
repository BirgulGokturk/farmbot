"""Devreye alma teşhisi — HİÇBİR ŞEYE YAZMAZ, sadece okur.

Gerçek donanıma geçmeden önce "neyi görüyoruz, neyi göremiyoruz" sorusunu
cevaplar: seri portlar, Arduino'nun VERI satırı, PLC'ye erişim, eksen
konumları ve kalibrasyonun tuttuğu.

Neden ayrı bir araç: ajanı doğrudan gerçek donanımla başlatmak, ilk hatayı
"neden hareket etmiyor" olarak yaşatıyor. Burada her adım tek tek doğrulanıyor
ve hiçbir register'a yazılmadığı için makine kımıldamıyor.

Çalıştırma:
    python3 tanila.py                 # ayarlar.json'u kullanır
    python3 tanila.py ayarlar.json
"""

from __future__ import annotations

import glob
import json
import os
import socket
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plc as plc_modulu  # noqa: E402
import tani  # noqa: E402

YESIL, KIRMIZI, SARI, GRI, BITIS = "\033[92m", "\033[91m", "\033[93m", "\033[90m", "\033[0m"
TAMAM, HATA, UYARI = f"{YESIL}✓{BITIS}", f"{KIRMIZI}✗{BITIS}", f"{SARI}⚠{BITIS}"


def baslik(metin: str) -> None:
    print(f"\n{metin}\n" + "─" * len(metin))


def tani_yaz(t: dict) -> None:
    """Eyleme dönük tanıyı basar. Metinler `tani.py`de — panel de aynı
    tablodan besleniyor, ipuçları iki yerde ayrışmasın diye."""
    print(f"{HATA} {t['baslik']}")
    print(f"{GRI}   {t['ne_koptu']}{BITIS}")
    if t.get("ham"):
        print(f"{GRI}   Ham hata: {t['ham']}{BITIS}")
    if t.get("sebepler"):
        print(f"{GRI}   Olası sebep:{BITIS}")
        for sebep in t["sebepler"]:
            print(f"{GRI}     - {sebep}{BITIS}")
    if t.get("adimlar"):
        print(f"{SARI}   Ne yapmalı:{BITIS}")
        for i, adim in enumerate(t["adimlar"], 1):
            print(f"{SARI}     {i}. {adim}{BITIS}")


def ayar_oku(yol: str) -> dict:
    with open(yol, encoding="utf-8") as dosya:
        ayar = json.load(dosya)
    kal = ayar.get("plc", {}).get("kalibrasyon_dosyasi", "gantry_calib.json")
    tam = kal if os.path.isabs(kal) else os.path.join(os.path.dirname(os.path.abspath(yol)), kal)
    if os.path.exists(tam):
        with open(tam, encoding="utf-8") as dosya:
            ayar.setdefault("plc", {})["kalibrasyon"] = json.load(dosya)
        print(f"{TAMAM} Kalibrasyon okundu: {tam}")
    else:
        print(f"{UYARI} Kalibrasyon dosyası yok ({tam}) — koddaki varsayılanlar kullanılacak")
    return ayar


# --------------------------------------------------------------------------- #
def seri_portlari_bul() -> list[str]:
    baslik("1. SERİ PORTLAR")
    adaylar = sorted(glob.glob("/dev/ttyUSB*") + glob.glob("/dev/ttyACM*"))
    if not adaylar:
        tani_yaz(tani.arduino_port_yok())
        return []
    for port in adaylar:
        try:
            okunur = os.access(port, os.R_OK | os.W_OK)
        except Exception:
            okunur = False
        if okunur:
            print(f"{TAMAM} {port} (erişim var)")
        else:
            tani_yaz(tani.arduino_izin_yok(port))
    return adaylar


def arduino_dinle(port: str, baud: int, saniye: float = 12.0) -> dict | None:
    baslik(f"2. ARDUINO ({port} @ {baud})")
    try:
        import serial
    except ImportError:
        print(f"{HATA} pyserial kurulu değil: .venv/bin/pip install pyserial")
        return None

    try:
        seri = serial.Serial(port, baud, timeout=2)
    except Exception as hata:
        if "ermission" in str(hata):
            tani_yaz(tani.arduino_izin_yok(port, str(hata)))
        else:
            tani_yaz(tani.arduino_port_yok(str(hata)))
        return None

    # Seri port açılınca Arduino kendini sıfırlar; ilk saniyedeki yarım
    # satırları atlıyoruz.
    time.sleep(2.0)
    seri.reset_input_buffer()
    print(f"{GRI}   {saniye:.0f} saniye dinleniyor...{BITIS}")

    veri = None
    ham_satirlar = []
    t0 = time.time()
    while time.time() - t0 < saniye:
        try:
            satir = seri.readline().decode("utf-8", errors="replace").strip()
        except Exception as hata:
            print(f"{HATA} Okuma hatası: {hata}")
            break
        if not satir:
            continue
        ham_satirlar.append(satir)
        if satir.startswith("VERI:"):
            try:
                veri = json.loads(satir[5:])
            except json.JSONDecodeError:
                print(f"{HATA} VERI satırı bozuk: {satir[:100]}")
    seri.close()

    if not ham_satirlar:
        tani_yaz(tani.arduino_veri_yok(port, baud, "hiç satır gelmedi"))
        return None

    print(f"{GRI}   Son satırlar:{BITIS}")
    for satir in ham_satirlar[-4:]:
        print(f"{GRI}     {satir[:110]}{BITIS}")

    if veri is None:
        tani_yaz(tani.arduino_veri_yok(port, baud, "VERI: satırı yok"))
        return None

    print(f"{TAMAM} VERI satırı okundu.")
    beklenen = ["hava_nem", "hava_sicaklik", "bmp_sicaklik", "basinc", "rakim",
                "toprak_nem"]
    for ad in beklenen:
        deger = veri.get(ad)
        if deger is None:
            print(f"  {UYARI} {ad:<15} null — sensör bağlı değil ya da okunamıyor")
        else:
            print(f"  {TAMAM} {ad:<15} {deger}")
    return veri


def plc_kontrol(ayar: dict) -> None:
    baslik("3. PLC (salt okunur)")
    p = ayar.get("plc", {})
    if p.get("sahte"):
        print(f"{UYARI} ayarlar.json'da plc.sahte = true — gerçek PLC denenmiyor.")
        return

    ip, port = p.get("ip", "192.168.1.88"), int(p.get("port", 502))

    # Önce TCP: Modbus hatası mı, yoksa ağ mı sorunlu — ayırt edilmezse
    # saatlerce register adresi aranıyor.
    try:
        with socket.create_connection((ip, port), timeout=3):
            pass
        print(f"{TAMAM} TCP bağlantısı açıldı: {ip}:{port}")
    except Exception as hata:
        tani_yaz(tani.plc_ulasilamiyor(ip, port, str(hata)))
        return

    gantry = plc_modulu.Gantry({**p, "sahte": False})
    try:
        enable = gantry.mb.oku(plc_modulu.ENABLE_REG, 1)[0]
        print(f"{TAMAM} Modbus okuma çalışıyor. Enable (reg {plc_modulu.ENABLE_REG}) = {enable}"
              f" ({'sürücüler AÇIK' if enable else 'sürücüler kapalı'})")
    except Exception as hata:
        tani_yaz(tani.plc_modbus(ip, port, str(hata)))
        return

    print(f"\n{GRI}   Eksen   ham count      mm      sınırlar        cpm / dir / home{BITIS}")
    for i, eksen in enumerate(plc_modulu.EKSENLER):
        k = gantry.kalib[i]
        try:
            ham = gantry.mb.float_oku(eksen["konum"])
            mm = gantry.ham_dan_mm(i, ham)
            icinde = "" if gantry.sinir_icinde(i, mm) else f"  {UYARI} SINIR DIŞI"
            print(f"   {eksen['ad']}    {ham:12.2f}  {mm:8.2f}   "
                  f"{k['min']:.0f} – {k['max']:.0f} mm    "
                  f"{k['cpm']} / {k['dir']:+d} / {k['home']}{icinde}")
        except Exception as hata:
            print(f"   {eksen['ad']}    {HATA} okunamadı: {hata}")

    try:
        z = gantry.konum_mm()[2]
        if z >= gantry.guvenli_z - 1.0:
            print(f"\n{TAMAM} Z güvenli yükseklikte ({z:.1f} ≥ {gantry.guvenli_z:.0f} mm) — X/Y hareketi serbest.")
        else:
            print(f"\n{UYARI} Z güvenli yükseklikte DEĞİL ({z:.1f} < {gantry.guvenli_z:.0f} mm) — "
                  "X/Y hareketi kilitli. Panelden önce Z'yi kaldırın.")
    except Exception:
        pass

    print(f"\n{GRI}   ŞİMDİ ŞUNU DOĞRULAYIN: yukarıdaki mm değerleri makinenin gerçek{BITIS}")
    print(f"{GRI}   konumuyla uyuşuyor mu? Uyuşmuyorsa kalibrasyon (cpm/dir/home) yanlış{BITIS}")
    print(f"{GRI}   demektir ve hareket komutu vermeden önce düzeltilmeli.{BITIS}")
    gantry.kapat()


def main() -> None:
    yol = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "ayarlar.json")
    print(f"{GRI}Farmbot devreye alma teşhisi — hiçbir register'a YAZILMAZ{BITIS}")
    print(f"{GRI}Ayar dosyası: {yol}{BITIS}")
    if not os.path.exists(yol):
        print(f"{HATA} Ayar dosyası yok: {yol}")
        sys.exit(1)
    ayar = ayar_oku(yol)

    portlar = seri_portlari_bul()
    ard = ayar.get("arduino", {})
    if ard.get("sahte"):
        print(f"{UYARI} ayarlar.json'da arduino.sahte = true — gerçek kart denenmiyor.")
    else:
        port = ard.get("port") or (portlar[0] if portlar else None)
        if port:
            arduino_dinle(port, int(ard.get("baud", 9600)))

    plc_kontrol(ayar)
    print()


if __name__ == "__main__":
    main()
