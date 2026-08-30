#!/usr/bin/env bash
#
# Bozulmus git deposunu onarir.
#
#   cd ~/farmbot && bash git-onar.sh
#
# BELIRTI: `git pull` su hatayi veriyor —
#   error: object file .git/objects/xx/yyyy... is empty
#   fatal: cannot read existing object info ...
#
# SEBEP: git nesne dosyasi 0 bayt kalmis. Bu neredeyse her zaman ANI
# KAPANMA izidir: git dosyayi olusturuyor, icerigi diske yazilmadan guc
# kesiliyor. SD kartlarda sik gorulur. Kodda bir sorun degil.
#
# Bos bir nesne hicbir veri tasimadigi icin SILINEBILIR: git onu uzaktan
# yeniden indirir. Betik once bunu deniyor; yetmezse depoyu yeniden
# klonluyor ve makineye ozel dosyalari tasiyor.
#
# HICBIR ADIMDA veri silinmiyor: eski depo `farmbot-bozuk-<tarih>` olarak
# duruyor, siz silene kadar orada kaliyor.

set -euo pipefail
cd "$(dirname "$0")"
KOK="$(pwd)"

if [ ! -d .git ]; then
    echo "Burasi bir git deposu degil: $KOK" >&2
    exit 1
fi

# Makineye ozel, depoda OLMAYAN dosyalar. Yeniden klonlamada bunlar
# tasinmazsa parola, kalibrasyon ve olcum gecmisi kaybolur.
YEREL=(
    "sunucu/ortam"                 # PANEL_PAROLA ve AJAN_JETONU
    "ajan/ayarlar.json"            # port, IP, toprak kalibrasyonu
    "sunucu/noktalar.json"
    "sunucu/egriler.json"
    "sunucu/programlar.json"
    "sunucu/tur_ezme.json"
    "sunucu/dikim_alanlari.json"
    "sunucu/kamera_kalibrasyon.json"
)

# Dal adi sabit yazilmiyor: depo `main` ya da `master` olabilir ve yanlis
# ad "couldn't find remote ref" diye onarim yokmus gibi gorunuyor.
DAL="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[ -n "$DAL" ] || DAL="$(git config --get init.defaultBranch || true)"
[ -n "$DAL" ] || DAL="main"

echo "== 1/4  Depo taraniyor  (dal: $DAL)"
# fsck cikisi bilgi amacli; hata verse de devam ediyoruz, zaten onarmaya
# geldik.
git fsck --full 2>&1 | head -20 || true

echo
echo "== 2/4  Bos nesne dosyalari araniyor"
mapfile -t BOS < <(find .git/objects -type f -size 0 2>/dev/null || true)
if [ "${#BOS[@]}" -eq 0 ]; then
    echo "   Bos nesne yok."
else
    echo "   ${#BOS[@]} bos nesne bulundu:"
    printf '     %s\n' "${BOS[@]}"
    # Bos dosya = icerigi olmayan nesne. Silmek veri kaybi degil; git
    # bunlari uzaktan yeniden indiriyor.
    rm -f "${BOS[@]}"
    echo "   Silindi — uzaktan yeniden indirilecek."
fi

echo
echo "== 3/4  Uzaktan yeniden cekiliyor"
if git fetch --prune origin "$DAL" 2>&1 && git fsck --connectivity-only 2>/dev/null; then
    echo "   Cekme basarili."
    if git merge --ff-only "origin/$DAL"; then
        echo
        echo "ONARILDI. Simdi normal guncelleme yapabilirsiniz:"
        echo "  bash guncelle.sh"
        exit 0
    fi
    echo "   Ileri sarma yapilamadi (yerel commit ya da degisiklik olabilir)."
    echo "   'git status --short' ile bakip karar verin."
    exit 1
fi

echo
echo "   Hafif onarim yetmedi — depo derinden bozulmus."
echo
echo "== 4/4  Yeniden klonlama"
echo "Eski depo silinmeyecek: farmbot-bozuk-<tarih> olarak duracak."
echo "Makineye ozel dosyalar (parola, ayarlar, olcum gecmisi, kareler)"
echo "yeni depoya kopyalanacak."
echo
read -r -p "Devam edilsin mi? (e/h): " CEVAP
[ "$CEVAP" = "e" ] || { echo "Vazgecildi. Hicbir sey degismedi."; exit 0; }

UZAK="$(git config --get remote.origin.url || true)"
if [ -z "$UZAK" ]; then
    echo "Uzak adres okunamadi. Elle klonlayin." >&2
    exit 1
fi

ESKI="${KOK}-bozuk-$(date +%Y%m%d-%H%M)"
YENI="${KOK}-yeni"
rm -rf "$YENI"

echo "Klonlaniyor: $UZAK"
git clone "$UZAK" "$YENI"

echo "Makineye ozel dosyalar tasiniyor"
for dosya in "${YEREL[@]}"; do
    if [ -f "$KOK/$dosya" ]; then
        mkdir -p "$YENI/$(dirname "$dosya")"
        cp -p "$KOK/$dosya" "$YENI/$dosya"
        echo "   $dosya"
    fi
done
# Veritabani ve kareler ayri: joker ve klasor.
for kalip in "$KOK"/sunucu/farmbot.db*; do
    [ -e "$kalip" ] && cp -p "$kalip" "$YENI/sunucu/" && echo "   $(basename "$kalip")"
done
if [ -d "$KOK/sunucu/kareler" ]; then
    cp -a "$KOK/sunucu/kareler" "$YENI/sunucu/" && echo "   sunucu/kareler/"
fi
# Sanal ortam: yol ayni kalacagi icin oldugu gibi tasinabiliyor. Tasinmazsa
# servisler python bulamiyor ve yeniden kurulum gerekiyor.
if [ -d "$KOK/sunucu/.venv" ]; then
    cp -a "$KOK/sunucu/.venv" "$YENI/sunucu/" && echo "   sunucu/.venv/"
fi
if [ -d "$KOK/ajan/.venv" ]; then
    cp -a "$KOK/ajan/.venv" "$YENI/ajan/" && echo "   ajan/.venv/"
fi

echo "Servisler durduruluyor"
sudo systemctl stop farmbot-ajan farmbot-sunucu || true

mv "$KOK" "$ESKI"
mv "$YENI" "$KOK"

echo "Servisler baslatiliyor"
sudo systemctl start farmbot-sunucu
for i in $(seq 20); do
    curl -sf -m 1 http://127.0.0.1:8000/saglik >/dev/null 2>&1 && break
    sleep 0.5
done
sudo systemctl start farmbot-ajan

echo
echo "TAMAM. Yeni depo: $KOK"
echo "Bozuk olan burada duruyor: $ESKI"
echo "Panel calisiyorsa birkac gun sonra silebilirsiniz:  rm -rf '$ESKI'"
