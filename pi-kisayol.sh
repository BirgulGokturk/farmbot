#!/usr/bin/env bash
#
# Pi'nin masaüstüne ve uygulama menüsüne panel kısayolu koyar.
#
#   cd ~/farmbot && bash pi-kisayol.sh
#
# Adres olarak localhost kullanılıyor: Pi kendi sunucusuna bakıyor, yani
# ağ değişse, Wi-Fi düşse, Tailscale kapansa bile kısayol çalışmaya devam
# ediyor. Dışarıdan bakarken Tailscale adresi gerekiyor ama bu kısayol
# Pi'nin kendi ekranı için.

set -euo pipefail

ADRES="http://localhost:8000"
AD="Tarım Robotu"

# Tarayıcı adı sürümden sürüme değişiyor: Bookworm'de `chromium`,
# öncesinde `chromium-browser`. Bulamazsak varsayılan tarayıcıya düşüyoruz.
if command -v chromium >/dev/null 2>&1; then
    KOMUT="chromium --app=$ADRES"
elif command -v chromium-browser >/dev/null 2>&1; then
    KOMUT="chromium-browser --app=$ADRES"
elif command -v firefox >/dev/null 2>&1; then
    KOMUT="firefox $ADRES"
else
    KOMUT="xdg-open $ADRES"
fi

# `--app=` penceresi adres çubuğu ve sekme olmadan açılıyor: panel bir web
# sayfasından çok bir uygulama gibi duruyor ve yanlışlıkla başka bir yere
# gidilmiyor.

MASA="$HOME/Desktop"
[ -d "$MASA" ] || MASA="$HOME/Masaüstü"
[ -d "$MASA" ] || MASA="$HOME"

icerik="[Desktop Entry]
Type=Application
Version=1.0
Name=$AD
Comment=Kontrol paneli
Exec=$KOMUT
Icon=applications-internet
Terminal=false
Categories=Utility;Science;
StartupNotify=true"

yaz() {
    local hedef="$1"
    printf '%s\n' "$icerik" > "$hedef"
    chmod +x "$hedef"
    # Bookworm'de masaüstündeki .desktop dosyası "güvenilir" işaretlenmeden
    # çift tıklamayla açılmıyor, uyarı çıkarıyor. Desteklemeyen sürümlerde
    # bu komut sessizce başarısız oluyor, sorun değil.
    gio set "$hedef" metadata::trusted true 2>/dev/null || true
    echo "  $hedef"
}

echo "Kısayol oluşturuluyor — komut: $KOMUT"
yaz "$MASA/tarim-robotu.desktop"

mkdir -p "$HOME/.local/share/applications"
yaz "$HOME/.local/share/applications/tarim-robotu.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo
echo "Masaüstünde '$AD' simgesi çıkacak. Görünmezse masaüstüne sağ tıklayıp"
echo "yenileyin ya da bir kez oturumu kapatıp açın."
