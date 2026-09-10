#!/usr/bin/env bash
#
# Arduino'ya TEK BIR KOMUT gonderir ve cevabini gosterir.
#
#   cd ~/farmbot && bash seri-komut.sh "TEST 1"
#   cd ~/farmbot && bash seri-komut.sh "ACI 180"
#   cd ~/farmbot && bash seri-komut.sh "UC 0 0 900"
#
# NEDEN AYRI BIR BETIK: `seri-oku.sh` yalniz DINLIYOR. "Kart bu komutu
# aliyor mu" sorusu ancak komutu gonderip cevabina bakarak kapaniyor ve
# bu soru, panelden basilan bir dugme is gormedi diye her seferinde
# soruluyor. Panel -> sunucu -> ajan -> kart zincirinde arizanin hangi
# halkada oldugunu ayiran tek adim bu: kart komuta dogru cevap veriyorsa
# ariza yukarida, vermiyorsa kartta.
#
# Ajan seri portu tutuyor; port ayni anda iki surecte acilamaz. Bu yuzden
# ajan durduruluyor ve ne olursa olsun geri baslatiliyor.

set -euo pipefail
cd "$(dirname "$0")"

KOMUT="${1:-}"
SURE="${2:-8}"
PORT="${3:-}"

if [ -z "$KOMUT" ]; then
    echo "Kullanim: bash seri-komut.sh \"TEST 1\" [saniye] [/dev/ttyUSB0]" >&2
    exit 1
fi

if [ -z "$PORT" ]; then
    mapfile -t bulunan < <(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true)
    if [ "${#bulunan[@]}" -eq 0 ]; then
        echo "Seri port yok. Arduino'nun USB kablosu takili mi?" >&2
        exit 1
    fi
    if [ "${#bulunan[@]}" -gt 1 ]; then
        echo "Birden fazla port var: ${bulunan[*]}" >&2
        echo "Hangisi:  bash seri-komut.sh \"$KOMUT\" $SURE /dev/ttyUSB0" >&2
        exit 1
    fi
    PORT="${bulunan[0]}"
fi

AJAN_DURDU=0
geri_ac() { [ "$AJAN_DURDU" = "1" ] && sudo systemctl start farmbot-ajan || true; }
trap geri_ac EXIT

# "ACTIVE" YETMIYOR, "ACTIVATING" DE SAYILIR. Burada `is-active --quiet`
# vardi ve o, unit daha ayaga kalkarken FALSE donuyor. Sonucu su oldu:
#     bash arduino-yukle.sh && bash seri-komut.sh "TEST 1" 15
# zincirinde yukleyici cikarken ajani baslatiyor, hemen ardindan bu betik
# "ajan calismiyor" deyip onu DURDURMUYOR, ajan portu aciyor ve karttan
# gelen her baytI O yiyor. Ekranda "karttan gelen" bombos ciktI -- yani
# betik, kart susuyor gibi gosterdi. Olcumu betigin kendisi bozmasin.
DURUM="$(systemctl is-active farmbot-ajan 2>/dev/null || true)"
case "$DURUM" in
    active|activating|reloading|deactivating)
        sudo -n systemctl stop farmbot-ajan 2>/dev/null || sudo systemctl stop farmbot-ajan
        AJAN_DURDU=1
        ;;
esac

# PORT GERCEKTEN BOSALDI MI. `systemctl stop` unit'i durdurdugunda surec
# henuz dosya tanimlayicisini birakmamis olabiliyor; sabit bir `sleep 1`
# bunu bazen isKalIyor, bazen isKalamIyor. Bekleyip ONAYLIYORUZ.
port_bos_mu() {
    # fuser her Pi'de kurulu degil; yoksa beklemekten baska yapacak sey yok.
    command -v fuser >/dev/null 2>&1 || return 0
    ! fuser "$PORT" >/dev/null 2>&1
}
for _ in $(seq 20); do
    port_bos_mu && break
    sleep 0.25
done
if ! port_bos_mu; then
    echo "UYARI: $PORT hala baska bir surecte acik. Olcum eksik cikabilir." >&2
    echo "       Kim tuttuguna bakin:  fuser -v $PORT" >&2
fi

# -hupcl: son dosya tanimlayici kapaninca DTR DUSMESIN. Asagida komutu
# yazarken port ikinci kez acilip kapaniyor; DTR duserse Uno SIFIRLANIR ve
# gonderdigimiz komut daha etkisini gostermeden kart bastan baslar. Boyle
# bir sifirlanmayi "servo cekince besleme cokuyor" saniriz -- olcumu
# betigin kendisi bozmasin.
stty -F "$PORT" 9600 raw -echo -hupcl

CIKTI="$(mktemp)"
temizle() { rm -f "$CIKTI"; }
trap 'temizle; geri_ac' EXIT

# Once dinlemeye basliyoruz, sonra gonderiyoruz: ters sirada kartin
# cevabi biz dinlemeye baslamadan gecip gidiyor.
timeout "$SURE" cat < "$PORT" > "$CIKTI" &
DINLEYICI=$!

# PORTU ACMAK UNO'YU SIFIRLIYOR (DTR). Onyukleyici ~2 sn bekliyor;
# o sirada gonderilen komut yutulur. Acilis satirlari da bu sirada geliyor.
echo "== kart aciliyor (3 sn)"
sleep 3

echo "== gonderiliyor: $KOMUT"
printf '%s\r\n' "$KOMUT" > "$PORT"

wait "$DINLEYICI" 2>/dev/null || true

echo
echo "== karttan gelen"
cat "$CIKTI"
echo
echo "== Ne aranmali"
echo "  KOMUT: ...            -> kart komutu ANLADI ve uyguladi"
echo "  HATA: bilinmeyen ...  -> karttaki yazilim bu komutu tanimiyor"
echo "  hic cevap yok         -> baud farkli ya da kart yazilimsiz"
