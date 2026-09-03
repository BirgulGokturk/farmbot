#!/usr/bin/env bash
#
# Kamerayi serbest birakip verilen komutu calistirir, sonra ajani geri
# getirir. AI HAT / rpicam denemeleri icin.
#
#   cd ~/farmbot && bash kamera-serbest.sh
#   cd ~/farmbot && bash kamera-serbest.sh "rpicam-still -n -o /tmp/kare.jpg"
#
# Neden gerekli: kamerayi ajan tutuyor ve cihaz ayni anda iki surecte
# acilamiyor. Panelden kapatmak da yetmeyebiliyor (akis is parcaciginin
# birakmasi zaman aliyor). Ajani durdurmak tek kesin yol.
#
# Ajan ne olursa olsun geri baslatiliyor: komut patlasa da, Ctrl-C de
# olsa. Kamerasi calismayan bir sistemle ugrasirken makinenin de
# kontrolsuz kalmasi kabul edilemez.

set -euo pipefail
cd "$(dirname "$0")"

VARSAYILAN="rpicam-hello -n -t 10s --post-process-file /usr/share/rpi-camera-assets/hailo_yolov8_inference.json"
KOMUT="${1:-$VARSAYILAN}"

AJAN_DURDU=0
geri_ac() {
    if [ "$AJAN_DURDU" = "1" ]; then
        echo
        echo "== ajan geri baslatiliyor"
        sudo systemctl start farmbot-ajan || true
    fi
}
trap geri_ac EXIT

if systemctl is-active --quiet farmbot-ajan; then
    echo "== ajan durduruluyor (kamera serbest kalsin)"
    sudo -n systemctl stop farmbot-ajan 2>/dev/null || sudo systemctl stop farmbot-ajan
    AJAN_DURDU=1
    # Cihazin gercekten birakilmasi icin kisa bir pay: picamera2'nin
    # kapanmasi aninda olmuyor.
    sleep 2
fi

echo "== calistiriliyor:"
echo "   $KOMUT"
echo
set +e
bash -c "$KOMUT"
CIKIS=$?
set -e
echo
echo "== komut cikis kodu: $CIKIS"
[ "$CIKIS" -eq 0 ] || echo "   'Pipeline handler in use' hala cikiyorsa: sudo fuser -v /dev/video0"
