#!/usr/bin/env bash
#
# "Kameraya bak" kisayolunu Pi'nin masaustune koyar.
#
#     cd ~/farmbot && bash kamera-kisayol-kur.sh
#
# Neden ayri betik: .desktop dosyasinin ICINDE mutlak yol olmak zorunda
# ve o yol kullanici adina gore degisiyor. Burada calistiran kullanicinin
# gercek yolunu yaziyoruz, depodaki sablonu elle duzenlemek gerekmesin.

set -euo pipefail
cd "$(dirname "$0")"
KOK="$(pwd)"

MASAUSTU="$HOME/Desktop"
[ -d "$MASAUSTU" ] || MASAUSTU="$HOME/Masaüstü"
[ -d "$MASAUSTU" ] || { echo "Masaustu klasoru bulunamadi."; exit 1; }

HEDEF="$MASAUSTU/kamera-bak.desktop"
sed "s|^Exec=.*|Exec=$KOK/kamera-bak.sh|" kamera-bak.desktop > "$HEDEF"
chmod +x "$HEDEF" "$KOK/kamera-bak.sh"

# Wayland/labwc masaustunde .desktop dosyasi "guvenilir" isaretlenmeden
# cift tiklamayla calismiyor; gnome-based masaustlerinde de ayni.
gio set "$HEDEF" metadata::trusted true 2>/dev/null || true

echo "Kisayol kondu: $HEDEF"
echo "Masaustunde 'Kameraya bak' simgesine cift tiklayin."
echo
echo "ffmpeg kurulu degilse:  sudo apt install -y ffmpeg v4l-utils"
