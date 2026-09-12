#!/usr/bin/env python3
"""PLC holding registerlarını DOĞRUDAN okur — ajandan bağımsız.

    python3 plc-oku.py            # proksimiteler: D1110, D1111, D1112
    python3 plc-oku.py 1110 3     # istediğin adresten istediğin kadar
    python3 plc-oku.py 1110 3 -i  # izle: yarım saniyede bir, Ctrl-C ile çık
    python3 plc-oku.py -x         # BİT tara: giriş ve bobin bitleri 0..31
    python3 plc-oku.py -x -i      # bit taramasını izle
    python3 plc-oku.py -x 0 16 -i    # X girişleri (X0..X15)
    python3 plc-oku.py -x 200 48 -i  # M bitleri (M200..M247)
    python3 plc-oku.py -d         # DEĞİŞENİ BUL: D1000-D1200'ü izler ve
                                  # yalnız DEĞİŞEN adresleri yazar

BİT TARAMA (-x) NİYE VAR: D registerları, PLC'nin fiziksel girişi oraya
KOPYALAMASINA bağlı. Ladder'da o kopyalama satırı yoksa register sonsuza
kadar 0 kalır ve dışarıdan "sensör ölü" gibi görünür — sahada tam bu
çıktı. Anahtarın kendisi ise bir BİT (X0/X5/X6) ve Modbus bit
fonksiyonlarıyla doğrudan okunabiliyor olabilir. Tarama, bir ucu elle
indirdiğinizde HANGİ BİTİN değiştiğini gösteriyor; bulunursa PLC'de
kopyalama satırı yazmaya hiç gerek kalmıyor.

DEĞİŞEN TARAMASI (-d) NİYE VAR: bir anahtarın hangi D registerına
yansıdığını bilmiyorsanız tek tek denemek yerine hepsini izleyip
değişeni yakalamak gerekiyor. Betik bir taban okuma alıyor, sonra yarım
saniyede bir tekrar okuyup FARK EDEN adresi yazıyor. Anahtara basın;
ekranda çıkan adres aradığınız registerdır.

NEDEN AYRI BİR ARAÇ: "panelde lamba yanmıyor" dendiğinde zincirde dört
halka var — PLC registerı yazıyor mu, Modbus okuması geliyor mu, ajan
pakete koyuyor mu, panel çiziyor mu. Bu betik en alttaki halkayı tek
başına ölçüyor. Değer burada değişiyorsa arıza yukarıda, değişmiyorsa
PLC tarafında.

Ajan çalışırken de çalışır: Modbus TCP birden çok bağlantı kabul ediyor.
"""

import json
import os
import socket
import struct
import sys
import time

KOK = os.path.dirname(os.path.abspath(__file__))
#: Varsayılan okuma — proksimite anahtarlarının yansıdığı registerlar.
#: Ladder'da X0/X5/X6 girişleri pres_1..3'e (D1110..D1112) kopyalanıyor.
VARSAYILAN_BAS, VARSAYILAN_ADET = 1110, 3
ETIKET = {1110: "prox_1 (X0)", 1111: "prox_2 (X5)", 1112: "prox_3 (X6)"}


def ayar_oku() -> dict:
    """PLC adresi ajanın ayar dosyasından — iki yerde iki adres olmasın."""
    for ad in ("ayarlar.json", "ayar.json"):
        yol = os.path.join(KOK, "ajan", ad)
        if os.path.exists(yol):
            with open(yol, encoding="utf-8") as f:
                return (json.load(f) or {}).get("plc") or {}
    return {}


def _istek(ip: str, port: int, birim: int, fonksiyon: int,
           adres: int, adet: int) -> bytes:
    with socket.create_connection((ip, port), timeout=2.0) as s:
        s.settimeout(2.0)
        pdu = struct.pack(">BHH", fonksiyon, adres, adet)
        s.sendall(struct.pack(">HHHB", 1, 0, len(pdu) + 1, birim) + pdu)

        def al(n: int) -> bytes:
            veri = b""
            while len(veri) < n:
                parca = s.recv(n - len(veri))
                if not parca:
                    raise IOError("bağlantı kapandı")
                veri += parca
            return veri

        _, _, uzunluk, _ = struct.unpack(">HHHB", al(7))
        cevap = al(uzunluk - 1)
        if cevap[0] & 0x80:
            raise IOError(f"Modbus istisnası {cevap[1]}")
        return cevap[1:]


def oku(ip: str, port: int, birim: int, adres: int, adet: int) -> list[int]:
    """Holding register (fonksiyon 3)."""
    govde = _istek(ip, port, birim, 3, adres, adet)
    bayt = govde[0]
    return list(struct.unpack(">" + "H" * (bayt // 2), govde[1:1 + bayt]))


def bit_oku(ip: str, port: int, birim: int, fonksiyon: int,
            adres: int, adet: int) -> list[int]:
    """Bobin (1) ya da giriş biti (2). Bitler DÜŞÜKTEN yükseğe paketli."""
    govde = _istek(ip, port, birim, fonksiyon, adres, adet)
    ham = govde[1:1 + govde[0]]
    return [(ham[n // 8] >> (n % 8)) & 1 for n in range(adet)]


def bit_satiri(ip: str, port: int, birim: int, adet: int = 32,
               bas: int = 0) -> str:
    """Giriş bitleri ve bobinler tek satırda.

    Okunamayan fonksiyon atlanıyor: her PLC ikisini de desteklemiyor ve
    biri düşünce ötekinin sonucu kaybolmasın.
    """
    parca = []
    for fonksiyon, ad in ((2, "giris"), (1, "bobin")):
        try:
            b = bit_oku(ip, port, birim, fonksiyon, bas, adet)
            parca.append(ad + f"[{bas}] " + "".join(
                str(v) + ("|" if (n + 1) % 8 == 0 and n + 1 < adet else "")
                for n, v in enumerate(b)))
        except Exception as hata:
            parca.append(ad + " okunamadi (" + str(hata) + ")")
    return "   ".join(parca)


def main() -> int:
    arg = [a for a in sys.argv[1:] if not a.startswith("-")]
    izle = any(a in ("-i", "--izle") for a in sys.argv[1:])
    bit_tara = any(a in ("-x", "--bit") for a in sys.argv[1:])
    degisen = any(a in ("-d", "--degisen") for a in sys.argv[1:])
    bas = int(arg[0]) if arg else VARSAYILAN_BAS
    adet = int(arg[1]) if len(arg) > 1 else VARSAYILAN_ADET

    p = ayar_oku()
    ip = p.get("ip", "192.168.1.88")
    port = int(p.get("port", 502))
    birim = int(p.get("birim", 1))
    if p.get("sahte"):
        print("UYARI: ayarda plc.sahte = true — gerçek PLC'ye bakmıyorsunuz.",
              file=sys.stderr)
    if degisen:
        # ARALIK: makinenin kullandigi butun D bolgesi. Tek istekte 125
        # register okunabiliyor (Modbus siniri), o yuzden bloklara
        # bolunuyor. Okunamayan blok atlaniyor — bir blok patlayinca
        # otekiler kaybolmasin.
        bas_d, son_d = 1000, 1200
        print(f"== {ip}:{port} birim {birim} · D{bas_d}-D{son_d} degisen taramasi")
        print("   Anahtara basin / ekseni home'a surun. Degisen adres asagida.")
        taban = {}
        while True:
            simdi = {}
            a = bas_d
            while a <= son_d:
                n = min(100, son_d - a + 1)
                try:
                    for k, v in enumerate(oku(ip, port, birim, a, n)):
                        simdi[a + k] = v
                except Exception:
                    pass
                a += n
            if not taban:
                taban = dict(simdi)
                print(f"   taban alindi ({len(taban)} register)")
            else:
                for adres in sorted(simdi):
                    if adres in taban and simdi[adres] != taban[adres]:
                        print(f"   D{adres}: {taban[adres]} -> {simdi[adres]}")
                        taban[adres] = simdi[adres]
            time.sleep(0.5)

    if bit_tara:
        # Baslangic ve adet konumsal argumanlardan: `-x 200 48` M200'den
        # 48 bit okur. Varsayilan 0..31 — X girisleri icin.
        bit_bas = int(arg[0]) if arg else 0
        bit_adet = int(arg[1]) if len(arg) > 1 else 32
        print(f"== {ip}:{port} birim {birim} · bit taramasi "
              f"{bit_bas}..{bit_bas + bit_adet - 1}")
        print("   Anahtara basip birakin; degisen biti arayin. "
              f"Soldaki ilk bit {bit_bas}.")
    else:
        print(f"== {ip}:{port} birim {birim} · D{bas}..D{bas + adet - 1}")

    while True:
        try:
            if bit_tara:
                satir = bit_satiri(ip, port, birim, bit_adet, bit_bas)
                print(("\r" if izle else "") + satir,
                      end="" if izle else "\n", flush=True)
                if not izle:
                    return 0
                time.sleep(0.5)
                continue
            d = oku(ip, port, birim, bas, adet)
            satir = " · ".join(
                f"D{bas + n}={v}"
                + (f" [{ETIKET[bas + n]}]" if bas + n in ETIKET else "")
                for n, v in enumerate(d))
            print(("\r" if izle else "") + satir, end="" if izle else "\n",
                  flush=True)
        except Exception as hata:
            print(f"HATA: {hata}", file=sys.stderr)
            if not izle:
                return 1
        if not izle:
            return 0
        time.sleep(0.5)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print()
