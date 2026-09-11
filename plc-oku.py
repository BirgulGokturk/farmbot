#!/usr/bin/env python3
"""PLC holding registerlarını DOĞRUDAN okur — ajandan bağımsız.

    python3 plc-oku.py            # proksimiteler: D1110, D1111, D1112
    python3 plc-oku.py 1110 3     # istediğin adresten istediğin kadar
    python3 plc-oku.py 1110 3 -i  # izle: yarım saniyede bir, Ctrl-C ile çık

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


def oku(ip: str, port: int, birim: int, adres: int, adet: int) -> list[int]:
    with socket.create_connection((ip, port), timeout=2.0) as s:
        s.settimeout(2.0)
        pdu = struct.pack(">BHH", 3, adres, adet)
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
        govde = cevap[1:]
        bayt = govde[0]
        return list(struct.unpack(">" + "H" * (bayt // 2), govde[1:1 + bayt]))


def main() -> int:
    arg = [a for a in sys.argv[1:] if not a.startswith("-")]
    izle = any(a in ("-i", "--izle") for a in sys.argv[1:])
    bas = int(arg[0]) if arg else VARSAYILAN_BAS
    adet = int(arg[1]) if len(arg) > 1 else VARSAYILAN_ADET

    p = ayar_oku()
    ip = p.get("ip", "192.168.1.88")
    port = int(p.get("port", 502))
    birim = int(p.get("birim", 1))
    if p.get("sahte"):
        print("UYARI: ayarda plc.sahte = true — gerçek PLC'ye bakmıyorsunuz.",
              file=sys.stderr)
    print(f"== {ip}:{port} birim {birim} · D{bas}..D{bas + adet - 1}")

    while True:
        try:
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
