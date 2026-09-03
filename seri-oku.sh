#!/usr/bin/env bash
#
# Arduino'nun HAM ciktisini gosterir — tahmin etmeyi bitirir.
#
#   cd ~/farmbot && bash seri-oku.sh
#
# "Panelde sicaklik gorunmuyor" gibi bir durumda iki ihtimal var: kart o
# degeri hic gondermiyor, ya da gonderiyor da yolda eleniyor. Ikisinin
# yapilacagi bambaska. Bu betik karttan CIKAN satiri oldugu gibi
# gosteriyor, yani soruyu tek adimda kapatiyor.
#
# Ajan seri portu tutuyor; port ayni anda iki surecte acilamaz. Bu yuzden
# ajan durduruluyor ve ne olursa olsun geri baslatiliyor.

set -euo pipefail
cd "$(dirname "$0")"

SATIR="${1:-6}"
PORT="${2:-}"

if [ -z "$PORT" ]; then
    mapfile -t bulunan < <(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true)
    if [ "${#bulunan[@]}" -eq 0 ]; then
        echo "Seri port yok. Arduino'nun USB kablosu takili mi?" >&2
        exit 1
    fi
    PORT="${bulunan[0]}"
fi

AJAN_DURDU=0
geri_ac() { [ "$AJAN_DURDU" = "1" ] && sudo systemctl start farmbot-ajan || true; }
trap geri_ac EXIT

if systemctl is-active --quiet farmbot-ajan; then
    sudo -n systemctl stop farmbot-ajan 2>/dev/null || sudo systemctl stop farmbot-ajan
    AJAN_DURDU=1
    sleep 1
fi

echo "== $PORT dinleniyor ($SATIR satir)"
echo "   Kart aciliyor, ilk olcum birkac saniye surebilir."
echo

# stty: baud'u ayarliyor ve DTR'yi birakmiyor. `cat` acildiginda Arduino
# sifirlaniyor, o yuzden acilis satirlarini da goruyoruz — DHT tipi orada
# yaziyor.
stty -F "$PORT" 9600 raw -echo
timeout 25 head -n "$SATIR" < "$PORT" || true

echo
echo "== Ne aranmali"
echo "  BILGI: DHT tipi ...   -> hangi sensor bulundu"
echo "  UYARI: DHT okumuyor   -> D2 kablosu ya da sensor"
echo "  UYARI: BMP180 ...     -> A4/A5 (I2C) baglantisi"
echo "  VERI satirinda null   -> o sensor okuma vermiyor"
echo "  VERI satiri hic yok   -> karta yazilim yuklenmemis ya da baud farkli"
