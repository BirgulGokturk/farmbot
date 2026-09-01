#!/usr/bin/env bash
#
# USB kamerayı Pi'nin EKRANINDA açar — açıyı ayarlarken bakmak için.
#
# Ajanla ilgisi yok: kameraya doğrudan bağlanıyor, panel çalışmasa da
# çalışır. Amaç kamerayı kalıcı olarak bağlamadan önce "nereyi görüyor,
# açısı iyi mi" sorusuna bakmak.
#
# UZAKTAN ÇALIŞMAZ. ffplay görüntüyü bir PENCEREDE açıyor; SSH ya da
# Raspberry Pi Connect kabuğundan çalıştırırsanız pencere Pi'nin
# ekranında belirir, sizin karşınızda değil. Bu yüzden masaüstü
# kısayolu var.

set -uo pipefail

# CİHAZI KENDİ BULUYOR. `/dev/video0` sanılanın aksine USB kamera değil,
# Pi'nin dahili CSI arayüzü; sabit yazmak yanlış cihaza bakmak demek.
# v4l2-ctl çıktısında "USB Camera" başlığının altındaki ilk düğüm doğru
# olan. Kamera çıkarılıp takıldığında numara da değişebiliyor.
cihaz_bul() {
    local d
    d=$(v4l2-ctl --list-devices 2>/dev/null \
        | awk '/[Cc]amera.*usb|usb.*[Cc]amera/{bulundu=1; next}
               bulundu && /\/dev\/video/{gsub(/[ \t]/,""); print; exit}')
    [ -n "$d" ] && { echo "$d"; return; }
    # v4l2-utils yoksa: USB kameralar genelde yüksek numarada oluyor.
    ls /dev/video* 2>/dev/null | sort -V | tail -1
}

CIHAZ="${1:-$(cihaz_bul)}"
if [ -z "$CIHAZ" ] || [ ! -e "$CIHAZ" ]; then
    echo "Kamera bulunamadi. Takili mi?  lsusb  ile bakin."
    read -rp "Kapatmak icin Enter"; exit 1
fi

echo "Kamera: $CIHAZ"

# MJPEG VARSA ONU KULLAN. Ham YUYV cok bant genisligi yiyor; ucuz USB
# kameralarda "corrupted data" hatasi ve 5 fps tam bundan cikiyor. MJPEG
# ayni kabloda cok daha yuksek cozunurluk ve kare hizi veriyor.
if v4l2-ctl -d "$CIHAZ" --list-formats 2>/dev/null | grep -qi mjpg; then
    BICIM=(-input_format mjpeg)
    echo "Bicim: MJPEG"
else
    BICIM=()
    echo "Bicim: ham (MJPEG desteklenmiyor) — kare hizi dusuk olabilir"
fi

echo "Kapatmak icin pencereye tiklayip q'ya basin."
ffplay -hide_banner -loglevel warning "${BICIM[@]}" -f v4l2 "$CIHAZ" \
    || { echo; echo "Acilamadi. ffmpeg kurulu mu?  sudo apt install -y ffmpeg"
         read -rp "Kapatmak icin Enter"; }
