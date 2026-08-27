"""Toprak yüzeyini ölç: ucun BULUNDUĞU Z'yi `toprak_z` olarak kaydeder.

Kullanımı: panelden Z'yi yavaşça indirin, uç toprak yüzeyine hafifçe
değsin, sonra Pi'de

    cd ~/farmbot && python3 toprak-olc.py

Elle sayı yazmaya gerek yok — değeri makinenin kendisinden okuyoruz.
Ajanı yeniden başlatmıyor; değişikliğin geçerli olması için betiğin
sonunda yazan komutu çalıştırın.
"""

import json
import re
import sys
import urllib.parse
import urllib.request

AYAR = "ajan/ayarlar.json"
ORTAM = "sunucu/ortam"


def parola() -> str:
    """Panel parolasını systemd ortam dosyasından okur."""
    try:
        with open(ORTAM, encoding="utf-8") as f:
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


def main() -> int:
    adres = ("http://127.0.0.1:8000/api/durum?jeton="
             + urllib.parse.quote(parola()))
    try:
        with urllib.request.urlopen(adres, timeout=5) as yanit:
            durum = json.load(yanit)["durum"]
    except Exception as hata:
        print(f"Sunucuya ulaşılamadı: {hata}")
        print("Sunucu ve ajan çalışıyor mu?  systemctl is-active farmbot-sunucu farmbot-ajan")
        return 1

    if not durum.get("bagli"):
        print("Ajan bağlı değil — makineden konum okunamıyor.")
        return 1

    z = (durum.get("konum") or {}).get("z")
    if z is None:
        print("Z konumu okunamadı. PLC bağlı mı?")
        return 1

    # Ucun havada olduğu bir anda çalıştırmak, toprağı olduğundan yüksek
    # kaydetmek demek; sonrasında her ekim sığ kalır. Onay isteyerek
    # yanlışlıkla çalıştırmayı zorlaştırıyoruz.
    print(f"Ucun şu anki Z konumu: {z:.1f} mm")
    print("Uç toprak yüzeyine DEĞİYOR mu? Değmiyorsa şimdi durun.")
    try:
        cevap = input("Kaydedeyim mi? (e/h): ").strip().lower()
    except EOFError:
        cevap = ""
    if cevap not in ("e", "evet"):
        print("Vazgeçildi, dosya değişmedi.")
        return 0

    try:
        with open(AYAR, encoding="utf-8") as f:
            ayar = json.load(f)
    except OSError as hata:
        print(f"{AYAR} okunamadı: {hata}")
        return 1

    eski = ayar.get("plc", {}).get("toprak_z", 0.0)
    ayar.setdefault("plc", {})["toprak_z"] = round(float(z), 1)
    with open(AYAR, "w", encoding="utf-8") as f:
        json.dump(ayar, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"toprak_z: {eski} -> {round(float(z), 1)} mm  ({AYAR})")
    print("Geçerli olması için:  sudo systemctl restart farmbot-ajan")
    return 0


if __name__ == "__main__":
    sys.exit(main())
