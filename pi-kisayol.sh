#!/usr/bin/env bash
#
# Pi'nin masaüstüne panel kısayolu koyar.
#
# Kullanım:  bash pi-kisayol.sh

set -euo pipefail

masaustu="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
mkdir -p "$masaustu"
hedef="$masaustu/tarim-robotu.desktop"

cat > "$hedef" <<KISAYOL
[Desktop Entry]
Type=Application
Name=Tarım Robotu
Comment=Panel — sensörler, kontrol ve tarla
Exec=xdg-open http://localhost:8000
Icon=applications-internet
Terminal=false
Categories=Utility;
KISAYOL

chmod +x "$hedef"
# Yeni Pi OS surumlerinde tiklanabilir olmasi icin "guvenilir" isareti gerekiyor.
gio set "$hedef" metadata::trusted true 2>/dev/null || true

echo "Kısayol hazır: $hedef"
echo "Masaüstünde 'Tarım Robotu' simgesi görünecek."
