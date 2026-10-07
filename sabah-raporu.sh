#!/usr/bin/env bash
# Sabah raporu — panelden gercek metni cekip WhatsApp grubuna gonderir.
#
# Cron her sabah 09:00'da calistiriyor:
#   0 9 * * * /home/batupi/farmbot/sabah-raporu.sh >> /home/batupi/farmbot-veri/sabah-raporu.log 2>&1
#
# JETON DEPOYA YAZILMIYOR. Panel parolasi `sunucu/ortam` icinde ve o dosya
# .gitignore'da. Buraya ikinci bir kopya yazmak, parola degisince sessizce
# eskiyen bir surum daha yaratmak olurdu — tek kaynak o dosya.
#
# `set -e` BILEREK YOK: fotograf cekilemezse metin yine gitmeli. Hata
# durumlari tek tek ele aliniyor.
set -uo pipefail

KOK="$(cd "$(dirname "$0")" && pwd)"
ORTAM="$KOK/sunucu/ortam"
SUNUCU="http://127.0.0.1:8000"
GRUP="120363430586787755@g.us"     # mudslide groups ciktisindaki robot grubu
KAMERA="ust"                        # rapora eklenecek kare hangi kameradan
ZAMAN_ASIMI=25                      # sn — sunucu takilirsa cron asili kalmasin

# Cron'un PATH'i dar; npm'in global klasoru genelde icinde olmuyor.
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

yaz() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# --- jeton ----------------------------------------------------------------
if [ ! -r "$ORTAM" ]; then
  yaz "HATA: $ORTAM okunamadi — panel parolasi alinamiyor."
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$ORTAM"; set +a
JETON="${PANEL_PAROLA:-}"
if [ -z "$JETON" ]; then
  yaz "HATA: $ORTAM icinde PANEL_PAROLA yok."
  exit 1
fi

# --- mudslide var mi ------------------------------------------------------
if ! command -v mudslide >/dev/null 2>&1; then
  yaz "HATA: mudslide bulunamadi (PATH: $PATH)."
  exit 1
fi

# --- rapor metni ----------------------------------------------------------
# -f: HTTP hatasinda bos metin yerine basarisizlik dondur. Bu olmazsa
#     sunucu 500 verdiginde WhatsApp'a BOS mesaj gider.
METIN="$(curl -sf --max-time "$ZAMAN_ASIMI" \
  "$SUNUCU/api/whatsapp-report?jeton=$JETON" || true)"

if [ -z "$METIN" ]; then
  # SESSIZ BASARISIZLIK YOK. Hic mesaj atmamak, "bugun neden gelmedi"
  # sorusunun cevabinin hicbir yerde olmamasi demek.
  yaz "UYARI: rapor alinamadi, yerine ariza mesaji gonderiliyor."
  METIN="🤖 Günaydın! Bu sabah tarla raporunu hazırlayamadım — panel sunucusuna ulaşamadım. Pi'de 'journalctl -u farmbot-sunucu -n 50' bakılmalı."
fi

if mudslide send "$GRUP" "$METIN"; then
  yaz "Metin gonderildi (${#METIN} karakter)."
else
  yaz "HATA: metin gonderilemedi."
  exit 1                 # fotograf denemenin anlami yok
fi

# --- tarlanin karesi ------------------------------------------------------
# Kare BONUS: alinamazsa rapor yine gitmis olur, o yuzden burada cikmiyoruz.
# Canli akis kapaliysa uc 404 donuyor; bu bir ariza degil, kameranin kapali
# olmasi.
FOTO="$(mktemp -t tarla-XXXXXX.jpg)"
trap 'rm -f "$FOTO"' EXIT

if curl -sf --max-time "$ZAMAN_ASIMI" -o "$FOTO" \
     "$SUNUCU/api/kare/canli?jeton=$JETON&kamera=$KAMERA" \
   && [ -s "$FOTO" ]; then
  if mudslide send-image --caption "Bu sabahki tarla 🌱" "$GRUP" "$FOTO"; then
    yaz "Kare gonderildi ($(wc -c <"$FOTO") bayt)."
  else
    yaz "UYARI: kare gonderilemedi (metin gitti)."
  fi
else
  yaz "Kare yok — '$KAMERA' kamerasinin canli akisi kapali olabilir."
fi
