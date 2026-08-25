"""Makine şu an meşgul mü? — `oto-guncelle.sh` bunu sorar.

Ekrana üç şeyden birini yazar:

  evet        hareket, jog ya da çalışan bir dizi var  → güncelleme ertelenmeli
  hayir       boşta                                    → güncellenebilir
  bilinmiyor  sunucuya ulaşılamadı                     → güncellenebilir

"bilinmiyor" halinde güncellemeyi engellemiyoruz: sunucu zaten kapalıysa
kesilecek bir hareket de yok, ve engellersek çöken bir sunucu yüzünden
sistem sonsuza dek güncellenemez hale gelirdi.
"""

import json
import re
import urllib.parse
import urllib.request


def parola() -> str:
    """Panel parolasını `sunucu/ortam` dosyasından okur.

    Dosya systemd EnvironmentFile biçiminde: değerler çift tırnaklı ve C
    tarzı kaçışlı. json.loads tam olarak o biçimi çözüyor.
    """
    try:
        with open("sunucu/ortam", encoding="utf-8") as f:
            ham = f.read()
    except OSError:
        return ""
    esles = re.search(r"^PANEL_PAROLA=(.*)$", ham, re.M)
    if not esles:
        return ""
    deger = esles.group(1).strip()
    if deger.startswith('"'):
        try:
            return json.loads(deger)
        except ValueError:
            return deger.strip('"')
    return deger


def main() -> None:
    adres = ("http://127.0.0.1:8000/api/durum?jeton="
             + urllib.parse.quote(parola()))
    try:
        with urllib.request.urlopen(adres, timeout=5) as yanit:
            durum = json.load(yanit)["durum"]
    except Exception:
        print("bilinmiyor")
        return

    dizi_calisiyor = bool((durum.get("dizi") or {}).get("calisiyor"))
    mesgul = bool(durum.get("hareket") or durum.get("jog") or dizi_calisiyor)
    print("evet" if mesgul else "hayir")


if __name__ == "__main__":
    main()
