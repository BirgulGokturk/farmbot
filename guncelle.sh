#!/usr/bin/env bash
#
# Pi'de: GitHub'daki son hali al ve servisleri yenile.
# Kullanim:  cd ~/farmbot && bash guncelle.sh

set -euo pipefail
cd "$(dirname "$0")"

echo "[1/3] Kod cekiliyor"
if ! git pull --ff-only; then
    echo
    echo "Pull reddedildi — Pi'de yerel degisiklik var demektir."
    echo "SILMEYIN. Once neyin degistigine bakin:"
    echo "  git status --short"
    echo "Gerekiyorsa kenara alin:  git stash push -m 'pi-yerel'"
    exit 1
fi

echo "[2/3] Servisler yenileniyor"
# SIRA ONEMLI: ikisini ayni anda yeniden baslatmak, ajanin kapanmakta olan
# eski sunucu surecine baglanip orada takili kalmasina yol aciyor — ajan
# "bagliyim" derken yeni sunucu onu hic gormuyor. Once sunucu ayaga kalksin,
# sonra ajan baglansin.
sudo systemctl restart farmbot-sunucu
for i in $(seq 20); do
    curl -sf -m 1 http://127.0.0.1:8000/saglik >/dev/null 2>&1 && break
    sleep 0.5
done
sudo systemctl restart farmbot-ajan
sleep 4

echo "[3/3] Durum"
systemctl is-active farmbot-sunucu farmbot-ajan
echo "Surum: $(git log --oneline -1)"
echo
echo "Tarayicida Ctrl+F5 yapin — JS ve CSS onbellekte kalabilir."
