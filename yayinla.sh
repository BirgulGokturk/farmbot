#!/usr/bin/env bash
#
# Yerelde birikeni GitHub'a gonderir.
#
# Neden gerekli: bazi oturumlar commit'i `git commit-tree` ile atiyor; bu,
# calisma dizinini ve HEAD'i dogru birakiyor ama INDEX'i eski haliyle
# birakiyor. Sonuc olarak `git status` silinmis/degismis gibi gorunen
# dosyalar gosteriyor ve insan "bir sey bozulmus" saniyor. `git reset`
# index'i HEAD'e esitliyor; calisma dizinine DOKUNMUYOR.
#
# Kullanim (Git Bash):  bash yayinla.sh

set -euo pipefail
cd "$(dirname "$0")"

if [ -f .git/index.lock ] && ! pgrep -f "git" >/dev/null 2>&1; then
    echo "Sahipsiz kilit dosyasi siliniyor."
    rm -f .git/index.lock .git/HEAD.lock
fi

git reset -q                      # index'i HEAD'e esitle

kirli="$(git status --porcelain)"
if [ -n "$kirli" ]; then
    echo "Commit EDILMEMIS degisiklikler var — gondermeden once bunlara karar verin:"
    echo "$kirli"
    echo
    echo "Hepsini tek commit'te gondermek icin:"
    echo "  git add -A && git commit -m \"aciklama\" && bash yayinla.sh"
    exit 1
fi

onde="$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)"
if [ "$onde" = "0" ]; then
    echo "Gonderilecek yeni commit yok — her sey GitHub'da."
    exit 0
fi

echo "$onde commit gonderiliyor:"
git log --oneline @{u}..HEAD
git push origin main
echo
echo "Tamam. Pi'de calistirilacak:  bash guncelle.sh"
