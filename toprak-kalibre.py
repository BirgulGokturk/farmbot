"""Toprak probunu kalibre et: havada ve suda okuduğu HAM değerleri kaydeder.

Neden gerekiyor: dirençli prob suda sıfır okumuyor. Saf su bile sonsuz
iletken değil, üstüne modülün seri direnci bölücüyü kaydırıyor. 0-1023
varsayılırsa suya sokulan prob "%42" der ve panel hiçbir zaman ıslak
göstermez — sulama kararı da o yanlış sayıya dayanır.

Kullanımı (Pi'de):

    cd ~/farmbot && python3 toprak-kalibre.py kuru      # prob HAVADA, kuru
    cd ~/farmbot && python3 toprak-kalibre.py islak     # prob SU dolu bardakta

Elle sayı yazmaya gerek yok, değer karttan okunuyor. İkisini de ölçtükten
sonra betiğin söylediği komutla ajanı yeniden başlatın.
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


def ham_oku() -> float | None:
    """Kartın ŞU ANKİ ham toprak okumasını sunucudan alır."""
    adres = ("http://127.0.0.1:8000/api/durum?jeton="
             + urllib.parse.quote(parola()))
    try:
        with urllib.request.urlopen(adres, timeout=5) as yanit:
            veri = json.load(yanit)
    except Exception as hata:
        print(f"Sunucuya ulaşılamadı: {hata}")
        print("Sunucu ve ajan çalışıyor mu?  systemctl is-active farmbot-sunucu farmbot-ajan")
        return None

    olcum = veri.get("olcum") or {}
    # Düzeltilmiş değil HAM okuma isteniyor: kalibrasyonun kendisi ham
    # ölçekte tanımlı. Ajan ham değeri ayrıca gönderiyor.
    ham = (olcum.get("ham") or {}).get("toprak_nem")
    if ham is None:
        ham = olcum.get("toprak_nem")
    if ham is None:
        print("Toprak okuması gelmiyor. Arduino bağlı mı, prob A1'de mi?")
        return None
    return float(ham)


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in ("kuru", "islak"):
        print(__doc__)
        return 2
    hangi = sys.argv[1]

    deger = ham_oku()
    if deger is None:
        return 1

    nerede = "HAVADA (kuru)" if hangi == "kuru" else "SUYUN İÇİNDE"
    print(f"Ham okuma: {deger:.0f}")
    print(f"Prob şu an {nerede} mı?")
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

    ard = ayar.setdefault("arduino", {})
    anahtar = "toprak_kuru" if hangi == "kuru" else "toprak_islak"
    eski = ard.get(anahtar)
    ard[anahtar] = round(deger)

    kuru = ard.get("toprak_kuru", 1023)
    islak = ard.get("toprak_islak", 0)
    # Kuru okuma ıslaktan BÜYÜK olmalı: ham değer kurudukça yükseliyor.
    # Ters girilirse yüzde ters döner ve kimse fark etmez.
    if kuru <= islak:
        print(f"HATA: kuru ({kuru}) ıslaktan ({islak}) büyük olmalı — "
              "ham değer kurudukça yükseliyor. İkisini de doğru sırayla ölçün.")
        return 1

    with open(AYAR, "w", encoding="utf-8") as f:
        json.dump(ayar, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"{anahtar}: {eski} -> {round(deger)}  ({AYAR})")
    print(f"Şu anki ölçek: kuru {kuru} · ıslak {islak}")
    print("Geçerli olması için:  sudo systemctl restart farmbot-ajan")
    return 0


if __name__ == "__main__":
    sys.exit(main())
