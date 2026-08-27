#!/usr/bin/env bash
#
# Arduino'ya firmware yükler — kartı sökmeden, Pi üzerinden.
#
#   cd ~/farmbot && bash arduino-yukle.sh
#
# Başka bir kart/port için:  bash arduino-yukle.sh /dev/ttyACM0 arduino:avr:nano
#
# KRİTİK: ajan seri portu açık tutuyor. Port aynı anda iki süreçte açık
# olamaz; yükleme "port meşgul" diye yarıda kalır ve kartta yarım yazılım
# kalabilir. Bu yüzden ajan önce durduruluyor, sonra ne olursa olsun geri
# başlatılıyor.

set -euo pipefail
cd "$(dirname "$0")"

PORT="${1:-}"
FQBN="${2:-arduino:avr:uno}"
ESKIZ="firmware/farmbot_sensors"

# Port verilmediyse bul. Birden fazla varsa seçim bizim işimiz değil:
# yanlış karta yazmaktansa sormak iyidir.
if [ -z "$PORT" ]; then
    mapfile -t bulunan < <(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true)
    if [ "${#bulunan[@]}" -eq 0 ]; then
        echo "Seri port bulunamadı. Arduino'nun USB kablosu takılı mı?" >&2
        exit 1
    fi
    if [ "${#bulunan[@]}" -gt 1 ]; then
        echo "Birden fazla port var: ${bulunan[*]}" >&2
        echo "Hangisi olduğunu yazın:  bash arduino-yukle.sh /dev/ttyUSB0" >&2
        exit 1
    fi
    PORT="${bulunan[0]}"
fi

# arduino-cli yoksa kur. apt'te yok, resmi kurulum betiği kullanılıyor;
# ~/bin altına iniyor, sisteme dokunmuyor.
if ! command -v arduino-cli >/dev/null 2>&1; then
    export PATH="$HOME/bin:$PATH"
fi
if ! command -v arduino-cli >/dev/null 2>&1; then
    echo "== arduino-cli kuruluyor (bir kereye mahsus)"
    mkdir -p "$HOME/bin"
    curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh \
        | BINDIR="$HOME/bin" sh
    export PATH="$HOME/bin:$PATH"
    # Bir dahaki oturumda elle PATH ayarlamak gerekmesin.
    grep -q 'HOME/bin' "$HOME/.bashrc" 2>/dev/null \
        || echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.bashrc"
fi

echo "== çekirdek ve kütüphaneler"
arduino-cli core update-index
arduino-cli core install arduino:avr
# Sketch'in kullandıkları. Zaten kuruluysa arduino-cli atlıyor.
arduino-cli lib install "DHT sensor library" "Adafruit Unified Sensor" "Adafruit BMP085 Library"

echo "== derleniyor ($FQBN)"
arduino-cli compile --fqbn "$FQBN" "$ESKIZ"

# Ajan durdurulduysa geri başlat — derleme hatası, yükleme hatası, Ctrl-C,
# hepsinde. Aksi hâlde makine sessizce sensörsüz kalır.
AJAN_DURDU=0
geri_ac() {
    [ "$AJAN_DURDU" = "1" ] && sudo systemctl start farmbot-ajan || true
}
trap geri_ac EXIT

if systemctl is-active --quiet farmbot-ajan; then
    # Kurulum betiği bu iki komuta parolasız izin veriyor. Pi daha eski bir
    # sürümle kurulduysa kural yoktur; parola sorulur, betik yine çalışır.
    sudo -n systemctl stop farmbot-ajan 2>/dev/null || {
        echo "   (sudo parolanız sorulabilir — ajanı durdurmak için)"
        sudo systemctl stop farmbot-ajan
    }
    echo "== ajan durduruldu (seri port serbest kaldı)"
    AJAN_DURDU=1
    sleep 1
fi

echo "== yükleniyor -> $PORT"
if ! arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$ESKIZ"; then
    echo
    echo "Yükleme başarısız." >&2
    echo "En sık sebep kart tipinin tutmaması. Elinizdeki Nano ise:" >&2
    echo "  bash arduino-yukle.sh $PORT arduino:avr:nano" >&2
    echo "Eski önyükleyicili Nano klonuysa:" >&2
    echo "  bash arduino-yukle.sh $PORT arduino:avr:nano:cpu=atmega328old" >&2
    exit 1
fi

echo
echo "Yükleme bitti. Ajan geri başlıyor; panelde 'Çıkışlar' bölümündeki"
echo "düğmelerin açılması birkaç saniye sürebilir."
