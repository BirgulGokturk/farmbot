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
#
# MAKİNE DOSYALARI BU DENETİMİN DIŞINDA — ve bu, betiğin hiç çalışmamasına
# yol açan hatanın düzeltmesi. `uclar.json` ile `gantry_calib.json` Pi'de
# ÖLÇÜLMÜŞ değerleri tutuyor, yani depodakinden HER ZAMAN farklılar.
# `git status --porcelain` onları da sayınca çıktı hiçbir zaman boş
# olmuyordu; betik her turda "elle değişiklik var" deyip atlıyordu. Koruma,
# korumak için konduğu şeyi engelliyordu.
#
# Ezme riski yok: aşağıda çağrılan `guncelle.sh` bu iki dosyayı kenara alıp
# pull'dan sonra geri koyuyor.
# TAKİPSİZ DOSYALAR DA SAYILMIYOR (`-uno`). `git pull --ff-only` ile
# çakışabilecek tek şey DEĞİŞTİRİLMİŞ TAKİPLİ dosya; Pi'de biriken bir
# günlük, bir yedek ya da bir deneme çıktısı pull'u hiç engellemiyor ama
# eski denetimde güncellemeyi kalıcı olarak durduruyordu.
KIRLI="$(git status --porcelain -uno -- . \
    ':(exclude)ajan/uclar.json' ':(exclude)ajan/gantry_calib.json')"
if [ -n "$KIRLI" ]; then
    # HANGİ dosya olduğu da yazılıyor: "değişiklik var" deyip hangisi
    # olduğunu söylememek, sebebi aranmayan bir atlama demek. Tırnaksız
    # genişletme satır sonlarını boşluğa çeviriyor, tek satırlık kayıt çıkıyor.
    kayit "Pi'de commit edilmemiş değişiklik var — atlandı: $(echo $KIRLI)"
    exit 0
fi

mesgul="$(python3 mesgul-mu.py || echo bilinmiyor)"
if [ "$mesgul" = "evet" ]; then
    kayit "Makine meşgul (hareket/jog/dizi) — güncelleme ertelendi"
    exit 0
fi

# GÜNCELLEMEYİ `guncelle.sh` YAPIYOR, BURASI DEĞİL.
#
# Pull ve yeniden başlatma eskiden burada kopyalanmıştı; makine
# dosyalarının korunması ise yalnız `guncelle.sh`'daydı. İki ayrı uygulama
# demek, birinde düzeltilen şeyin ötekinde eski kalması demek — nitekim
# öyle oldu. Hassas kısım tek yerde duruyor.
if ./guncelle.sh >/dev/null 2>&1; then
    kayit "Güncellendi: $(git log --oneline -1)"
else
    kayit "guncelle.sh başarısız — elle bakılmalı (cd ~/farmbot && ./guncelle.sh)"
    exit 0
fi
