#!/usr/bin/env bash
#
# Pi'de: GitHub'daki son hali al ve servisleri yenile.
# Kullanim:  cd ~/farmbot && bash guncelle.sh

set -euo pipefail
cd "$(dirname "$0")"

# MAKINE VERISI depodaki kopyayi EZER. Bu dosyalari panel yaziyor: uc
# koordinatlari, olculen kalibrasyon. Pi'deki degerler sahadan olculmus,
# depodaki kopya baskasinin makinesinden kalma bir baslangic degeri — yani
# catisma halinde dogru olan her zaman Pi'dekidir.
#
# Once kenara aliyoruz, pull'dan sonra geri koyuyoruz. Boylece pull hic
# reddedilmiyor ve kullanici "silmeli miyim" diye karar vermek zorunda
# kalmiyor. Yedekler .yedek-guncelle uzantisiyla duruyor.
MAKINE_DOSYALARI="ajan/uclar.json ajan/gantry_calib.json"

for d in $MAKINE_DOSYALARI; do
    if [ -f "$d" ] && ! git diff --quiet -- "$d" 2>/dev/null; then
        cp -p "$d" "$d.yedek-guncelle"
        git checkout -- "$d"
        echo "  $d kenara alindi (yedek: $d.yedek-guncelle)"
    fi
done

geri_koy() {
    for d in $MAKINE_DOSYALARI; do
        if [ -f "$d.yedek-guncelle" ]; then
            cp -p "$d.yedek-guncelle" "$d"
            echo "  $d geri konuldu (Pi'deki olculmus degerler korundu)"
        fi
    done
}

echo "[1/3] Kod cekiliyor"
if ! git pull --ff-only; then
    geri_koy
    echo
    # Pull iki AYRI sebeple basarisiz olabiliyor ve ikisinin yapilacagi
    # bambaska. Eskiden hepsine "yerel degisiklik var" deniyordu; depo
    # bozuldugunda kullanici olmayan bir degisikligi ariyordu.
    if find .git/objects -type f -size 0 2>/dev/null | grep -q .; then
        echo "DEPO BOZULMUS — bos git nesnesi var."
        echo "Bu bir kod sorunu degil, ani kapanma izi (SD kartlarda sik)."
        echo "Onarmak icin:  bash git-onar.sh"
        exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
        echo "Pull reddedildi — Pi'de yerel degisiklik var."
        echo "SILMEYIN. Once neyin degistigine bakin:"
        echo "  git status --short"
        echo "Gerekiyorsa kenara alin:  git stash push -m 'pi-yerel'"
        exit 1
    fi
    echo "Pull basarisiz ama calisma agaci temiz ve nesneler saglam."
    echo "Genellikle ag ya da uzak depo sorunudur. Yukaridaki git ciktisina"
    echo "bakin; depo bozuklugundan supheleniyorsaniz:  bash git-onar.sh"
    exit 1
fi

geri_koy

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
