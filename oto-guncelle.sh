#!/usr/bin/env bash
#
# Pi'de zamanlayıcıyla çalışır: GitHub'da yeni commit varsa çeker ve
# servisleri yeniler. Elle güncelleme derdini kaldırır.
#
# KRİTİK KURAL: makine meşgulken güncelleme YAPILMAZ. Ajanı hareketin
# ortasında yeniden başlatmak, PLC'nin hedef register'ı son komutu tutarken
# bağlantıyı koparmak demek; bu, uç değiştirme dizisinin yarısında ya da jog
# sırasında öngörülemez davranış üretir. Meşgulse bu tur atlanır, bir sonraki
# turda tekrar denenir.
#
# Kapatmak için:  sudo systemctl disable --now farmbot-guncelle.timer

set -euo pipefail
cd "$(dirname "$0")"

kayit() { logger -t farmbot-guncelle "$*"; }

git fetch -q origin main || { kayit "fetch başarısız"; exit 0; }

yerel="$(git rev-parse HEAD)"
uzak="$(git rev-parse origin/main)"
[ "$yerel" = "$uzak" ] && exit 0          # yeni bir şey yok

# Pi'de elle yapılmış bir değişiklik varsa dokunmuyoruz: sessizce ezmek,
# kaybı fark edilmeyen bir hataya dönüşür.
if [ -n "$(git status --porcelain)" ]; then
    kayit "Pi'de commit edilmemiş değişiklik var — güncelleme atlandı"
    exit 0
fi

mesgul="$(python3 mesgul-mu.py || echo bilinmiyor)"
if [ "$mesgul" = "evet" ]; then
    kayit "Makine meşgul (hareket/jog/dizi) — güncelleme ertelendi"
    exit 0
fi

git pull -q --ff-only origin main || { kayit "pull başarısız"; exit 0; }
# Sira onemli — bkz. guncelle.sh'daki aciklama.
sudo systemctl restart farmbot-sunucu
for i in $(seq 20); do
    curl -sf -m 1 http://127.0.0.1:8000/saglik >/dev/null 2>&1 && break
    sleep 0.5
done
sudo systemctl restart farmbot-ajan
kayit "Güncellendi: $(git log --oneline -1)"
