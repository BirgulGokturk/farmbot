"""Bağlantı arızalarının EYLEME DÖNÜK karşılığı — tek kaynak.

Panel eskiden ham hatayı gösteriyordu:

    PLC ile konuşulamadı (192.168.1.88:502): timed out

Bu cümle neyin koptuğunu söylüyor ama ne yapılacağını söylemiyor. Aynı
arızanın ne anlama geldiği ve nasıl bakılacağı `tanila.py` içinde zaten
yazılıydı — ama orada, komut satırında kalıyordu. Metinler artık burada:
`tanila.py` de bu tablodan okuyor, ajan da. Böylece komut satırında okunan
ipucu ile panelde görünen ipucu hiçbir zaman ayrışmıyor.

Bir tanı üç şeyi söylüyor:

    ne_koptu   — hangi bağlantı, hangi adres/port
    sebepler   — en olasıdan başlayarak
    adimlar    — kopyalanıp çalıştırılabilecek komutlar

Panelin kendi başına bildiği tek arıza "ajan sunucuya bağlanamıyor": ajan
bağlı değilken bu dosyadan bir şey gelemez, o yüzden onun metni panelde
duruyor (bkz. `app.js`, TANI_YEREL).
"""

from __future__ import annotations

from typing import Any

# İpucu metinlerinde geçen sabitler — tek yerde dursun ki adres değişince
# bütün metinler birlikte değişsin.
VARSAYILAN_PLC_IP = "192.168.1.88"


def _tani(kimlik: str, baslik: str, ne_koptu: str,
          sebepler: list[str], adimlar: list[str], ham: str = "") -> dict[str, Any]:
    return {"kimlik": kimlik, "baslik": baslik, "ne_koptu": ne_koptu,
            "sebepler": sebepler, "adimlar": adimlar, "ham": str(ham)[:300]}


def plc_ulasilamiyor(ip: str, port: int, ham: str = "") -> dict[str, Any]:
    """PLC'ye TCP açılamıyor — Modbus'a sıra bile gelmiyor."""
    return _tani(
        "plc_ulasilamiyor",
        "PLC'ye ulaşılamıyor",
        f"Raspberry Pi ile PLC arasındaki TCP bağlantısı kurulamadı: {ip}:{port}",
        [
            "Pi ile PLC aynı ağda değil — en sık sebep bu.",
            f"PLC'nin adresi {ip} değil (ayarlar.json'daki plc.ip yanlış).",
            "PLC kapalı, ethernet kablosu takılı değil ya da anahtar (switch) beslemesiz.",
            "PLC'nin Modbus TCP sunucusu kapalı ya da başka bir portta.",
        ],
        [
            "Pi'nin adreslerine bakın:  ip addr | grep inet",
            f"PLC'ye erişimi deneyin:  ping {ip}",
            "Yönlendirmeyi kontrol edin:  ip route",
            f"Pi'nin adresi 192.168.137.x gibi başka bir ağdaysa, PLC'nin {ip} "
            "ağına AYRI bir arayüzden (eth0) bağlı olması gerekir — Wi-Fi "
            "üzerinden o ağa erişilemez.",
            "Kablo ve besleme sağlamsa PLC'yi yeniden başlatın.",
        ],
        ham)


def plc_modbus(ip: str, port: int, ham: str = "") -> dict[str, Any]:
    """TCP açıldı ama Modbus cevap vermiyor / istisna dönüyor."""
    return _tani(
        "plc_modbus",
        "PLC yanıt veriyor ama Modbus okunamıyor",
        f"{ip}:{port} adresine TCP bağlantısı açıldı, Modbus isteği başarısız oldu",
        [
            "Gantry Studio hâlâ çalışıyor ve Modbus portunu tutuyor olabilir — "
            "aynı anda iki istemci bağlanamıyor.",
            "İstenen register adresi bu PLC'de yok (adres haritası farklı).",
            "Modbus birim (unit) numarası yanlış.",
        ],
        [
            "Gantry Studio'yu kapatın:  systemctl status gantry-studio",
            "Salt okunur teşhisi çalıştırın:  python3 ajan/tanila.py",
            "Register adresleri için ajan/plc.py başındaki tabloyu PLC'nin "
            "kendi adres haritasıyla karşılaştırın.",
        ],
        ham)


def arduino_port_yok(ham: str = "") -> dict[str, Any]:
    return _tani(
        "arduino_port_yok",
        "Arduino seri portu yok",
        "Pi'de hiç USB seri port görünmüyor (/dev/ttyUSB* ve /dev/ttyACM* boş)",
        [
            "Arduino'nun USB kablosu takılı değil ya da kablo yalnızca güç veriyor "
            "(veri hattı olmayan şarj kablosu).",
            "Kart Pi tarafından tanınmadı — sürücü ya da besleme sorunu.",
        ],
        [
            "Kabloyu çıkarıp takın ve şuna bakın:  dmesg | tail",
            "Portları listeleyin:  ls -l /dev/ttyUSB* /dev/ttyACM*",
            "Veri taşıyan bir USB kablosu kullandığınızdan emin olun.",
            "Kart görünmüyorsa başka bir USB portu deneyin.",
        ],
        ham)


def arduino_izin_yok(port: str, ham: str = "") -> dict[str, Any]:
    return _tani(
        "arduino_izin_yok",
        "Arduino portuna erişim yok",
        f"{port} var ama açılamıyor — kullanıcının seri port izni yok",
        [
            "Ajanı çalıştıran kullanıcı `dialout` grubunda değil.",
            "Portu başka bir program tutuyor (Arduino IDE'nin seri ekranı gibi).",
        ],
        [
            "Kullanıcıyı gruba ekleyin:  sudo usermod -aG dialout $USER",
            "Sonra OTURUMU KAPATIP açın (ya da Pi'yi yeniden başlatın) — "
            "grup değişikliği açık oturuma yansımıyor.",
            "Portu tutan var mı:  sudo lsof " + port,
            "Arduino IDE'nin Seri Ekran penceresi açıksa kapatın.",
        ],
        ham)


def arduino_veri_yok(port: str, baud: int, ham: str = "") -> dict[str, Any]:
    return _tani(
        "arduino_veri_yok",
        "Arduino bağlı ama veri göndermiyor",
        f"{port} açıldı ({baud} baud), beklenen VERI: satırı gelmiyor",
        [
            "Karttaki sketch güncel değil — VERI: satırını yazan sürüm yüklü değil.",
            f"Baud hızı sketch'teki Serial.begin ile aynı değil (sketch: {baud}).",
            "Sketch çalışıyor ama sensör okuma döngüsüne giremiyor.",
        ],
        [
            "firmware/farmbot_sensors/farmbot_sensors.ino dosyasını karta yükleyin.",
            "Arduino IDE'de Seri Ekran'ı açıp satırların geldiğini doğrulayın "
            f"({baud} baud).",
            "Salt okunur teşhis:  python3 ajan/tanila.py",
        ],
        ham)


def sunucu_ulasilamiyor(adres: str, ham: str = "") -> dict[str, Any]:
    """Ajan sunucuya bağlanamıyor — ajanın kendi günlüğünde görünüyor."""
    return _tani(
        "sunucu_ulasilamiyor",
        "Ajan sunucuya bağlanamıyor",
        f"Raspberry Pi, panel sunucusuna erişemiyor: {adres}",
        [
            "Pi'nin internet erişimi yok.",
            "Sunucu adresi yanlış ya da sunucu çalışmıyor.",
            "AJAN_JETONU sunucudaki değerle aynı değil — bağlantı kuruluyor ama "
            "reddediliyor.",
        ],
        [
            "İnternet var mı:  ping -c3 1.1.1.1",
            "DNS çalışıyor mu:  ping -c3 google.com",
            "ayarlar.json içindeki `sunucu` adresini kontrol edin.",
            "Jetonu karşılaştırın: ayarlar.json'daki `jeton` ile sunucudaki "
            "AJAN_JETONU aynı olmalı.",
            "Ajan günlüğü:  journalctl -u farmbot-ajan -n 50",
        ],
        ham)


# --------------------------------------------------------------------------- #
# Ham hatadan tanıya
# --------------------------------------------------------------------------- #
def plc_hatasindan(ip: str, port: int, hata: BaseException | str) -> dict[str, Any]:
    """Modbus katmanından gelen hatayı doğru tanıya bağlar.

    Ayrım önemli: "adrese ulaşamıyorum" ile "ulaştım ama Modbus konuşmuyor"
    tamamen farklı iki iş listesi. İkisini aynı mesajda toplamak, saatlerce
    yanlış yerde aramaya yol açıyor.
    """
    metin = str(hata)
    ag_izleri = ("timed out", "timeout", "refused", "unreachable", "No route",
                 "Name or service", "Connection reset", "bağlantıyı kapattı")
    if any(iz.lower() in metin.lower() for iz in ag_izleri):
        return plc_ulasilamiyor(ip, port, metin)
    return plc_modbus(ip, port, metin)


def metin(t: dict[str, Any]) -> str:
    """Komut satırı için düz metin — `tanila.py` bunu basıyor."""
    satir = [t["baslik"], "  " + t["ne_koptu"]]
    if t.get("sebepler"):
        satir.append("  Olası sebep:")
        satir += [f"    - {s}" for s in t["sebepler"]]
    if t.get("adimlar"):
        satir.append("  Ne yapmalı:")
        satir += [f"    {i}. {a}" for i, a in enumerate(t["adimlar"], 1)]
    return "\n".join(satir)
