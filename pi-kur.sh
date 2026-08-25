#!/usr/bin/env bash
#
# Farmbot — Raspberry Pi kurulumu
#
# Sunucu ve ajan aynı makinede çalışır; bulut sunucusuna gerek yoktur.
# Panel ev ağındaki her cihazdan http://<pi-ip>:8000 adresiyle açılır.
#
# Çalıştırma (depo klasöründe):
#   bash pi-kur.sh
#
# Betik yeniden çalıştırılabilir: var olan ayarları ve jetonu bozmaz.

set -euo pipefail

KOK="$(cd "$(dirname "$0")" && pwd)"
KULLANICI="${SUDO_USER:-$USER}"
EV="$(getent passwd "$KULLANICI" | cut -d: -f6)"
ORTAM="$KOK/sunucu/ortam"
AYAR="$KOK/ajan/ayarlar.json"
VERI="$EV/farmbot-veri/farmbot.db"

echo "Kullanıcı : $KULLANICI"
echo "Klasör    : $KOK"
echo

# --- 1. Sistem paketleri -----------------------------------------------------
echo "[1/6] Sistem paketleri"
sudo apt-get update -qq
sudo apt-get install -y -qq python3-venv python3-pip

# --- 2. Sanal ortamlar -------------------------------------------------------
venv_kur() {
    local klasor="$1"
    # Ikinci parametre istege bagli: sunucu venv'i yalitilmis kaliyor,
    # yalnizca ajan "sistem" diyerek apt paketlerini goruyor. set -u
    # altinda "$2" dogrudan okunursa tek argumanli cagri betigi dusuruyor.
    local sistem="${2:-}"
    if [ ! -x "$klasor/.venv/bin/python" ]; then
        echo "      sanal ortam kuruluyor: $(basename "$klasor")"
        if [ "$sistem" = "sistem" ]; then
            # Ajanın donanım kütüphaneleri (picamera2, lgpio) apt'tan geliyor
            # ve pip ile venv'e kurulmuyor. Yalıtılmış bir venv onları
            # göremediği için kamera sessizce komut satırı yoluna düşüyordu.
            python3 -m venv --system-site-packages "$klasor/.venv"
        else
            python3 -m venv "$klasor/.venv"
        fi
    fi
    "$klasor/.venv/bin/pip" install --quiet --upgrade pip
    "$klasor/.venv/bin/pip" install --quiet -r "$klasor/requirements.txt"
}
echo "[2/6] Python bağımlılıkları"
venv_kur "$KOK/sunucu"
venv_kur "$KOK/ajan" sistem

# --- 3. Jeton ve panel parolası ----------------------------------------------
# Jeton ajanın sunucuya kimliğini kanıtladığı anahtar. Makineden makineye,
# kimsenin ezberlemesi gerekmiyor; rastgele üretip iki tarafa da yazıyoruz.
echo "[3/6] Jeton ve panel parolası"
if [ -f "$ORTAM" ]; then
    echo "      $ORTAM zaten var, jeton korunuyor"
    JETON="$(grep -m1 '^AJAN_JETONU=' "$ORTAM" | cut -d= -f2- | tr -d '"')"
else
    JETON="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
    echo
    echo "      Panel parolası belirleyin. Boş bırakırsanız panel parola sormaz —"
    echo "      yalnızca ev ağınızdan erişilebildiği için bu kabul edilebilir,"
    echo "      ama paneli internete açacaksanız mutlaka doldurun."
    echo "      İpucu: parolada Türkçe harf (ç ğ ı ö ş ü) kullanmayın — bazı"
    echo "      sistemlerde ortam değişkeni kodlaması bunları bozabiliyor."
    read -rsp "      Panel parolası (görünmez): " PAROLA; echo
    read -rsp "      Tekrar: " PAROLA2; echo
    if [ "$PAROLA" != "$PAROLA2" ]; then
        echo "      Parolalar uyuşmadı, kurulum durduruldu." >&2
        exit 1
    fi
    # systemd EnvironmentFile biçimi: değerleri Python ile tırnaklıyoruz ki
    # parolada boşluk veya özel karakter olsa da bozulmasın.
    JETON="$JETON" PAROLA="$PAROLA" VERI="$VERI" python3 - "$ORTAM" <<'PY'
import json, os, sys

# systemd EnvironmentFile, cift tirnakli degerleri C tarzi kacislarla okur ve
# json.dumps tam olarak o bicimi uretir. ensure_ascii=False sart: parolada
# Turkce harf varsa unicode kacisini systemd cozemez.
def tirnakla(d):
    return json.dumps(d, ensure_ascii=False)

with open(sys.argv[1], "w", encoding="utf-8") as f:
    f.write("# Farmbot sunucu ortam degiskenleri - bu dosyayi depoya gondermeyin.\n")
    f.write("AJAN_JETONU=%s\n" % tirnakla(os.environ["JETON"]))
    f.write("PANEL_PAROLA=%s\n" % tirnakla(os.environ["PAROLA"]))
    f.write("VERI_YOLU=%s\n" % tirnakla(os.environ["VERI"]))
PY
    chmod 600 "$ORTAM"
    echo "      $ORTAM yazıldı (yalnız sahibi okuyabilir)"
fi

# --- 4. Ajan ayarları --------------------------------------------------------
# Var olan ayarlar.json'daki donanım alanlarına dokunmuyoruz; yalnızca
# sunucu adresini ve jetonu güncelliyoruz.
echo "[4/6] Ajan ayarları"
JETON="$JETON" python3 - "$KOK/ajan/ayarlar.ornek.json" "$AYAR" <<'PY'
import json, os, sys

ornek, hedef = sys.argv[1], sys.argv[2]
if os.path.exists(hedef):
    with open(hedef, encoding="utf-8") as f:
        ayar = json.load(f)
    print("      var olan ayarlar.json korunuyor, adres ve jeton güncelleniyor")
else:
    with open(ornek, encoding="utf-8") as f:
        ayar = json.load(f)
    print("      ayarlar.json oluşturuldu (donanım alanlarını gözden geçirin)")

ayar["sunucu"] = "ws://127.0.0.1:8000/ws/ajan"
ayar["jeton"] = os.environ["JETON"]

with open(hedef, "w", encoding="utf-8") as f:
    json.dump(ayar, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
chmod 600 "$AYAR"

# --- 5. systemd servisleri ---------------------------------------------------
# Servis dosyalarını burada üretiyoruz: kullanıcı adı ve klasör yolu
# makineden makineye değişiyor, sabit yazılmış bir dosya çoğu Pi'de tutmuyor.
echo "[5/6] systemd servisleri"

sudo tee /etc/systemd/system/farmbot-sunucu.service >/dev/null <<BIRIM
[Unit]
Description=Farmbot paneli ve olcum deposu
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$KULLANICI
WorkingDirectory=$KOK/sunucu
EnvironmentFile=$ORTAM
ExecStart=$KOK/sunucu/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
BIRIM

sudo tee /etc/systemd/system/farmbot-ajan.service >/dev/null <<BIRIM
[Unit]
Description=Farmbot koprü ajani
After=farmbot-sunucu.service
Wants=farmbot-sunucu.service

[Service]
Type=simple
User=$KULLANICI
WorkingDirectory=$KOK/ajan
ExecStart=$KOK/ajan/.venv/bin/python $KOK/ajan/ajan.py $AYAR
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
BIRIM

# Otomatik guncelleme: zamanlayici 5 dakikada bir GitHub'a bakar. Makine
# mesgulken (hareket/jog/dizi) atlar, bir sonraki turda tekrar dener.
# Istenmiyorsa:  sudo systemctl disable --now farmbot-guncelle.timer
sudo tee /etc/systemd/system/farmbot-guncelle.service >/dev/null <<BIRIM
[Unit]
Description=Farmbot otomatik guncelleme
After=network-online.target

[Service]
Type=oneshot
User=$KULLANICI
WorkingDirectory=$KOK
ExecStart=/usr/bin/env bash $KOK/oto-guncelle.sh
BIRIM

sudo tee /etc/systemd/system/farmbot-guncelle.timer >/dev/null <<BIRIM
[Unit]
Description=Farmbot guncellemesini duzenli kontrol et

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
Unit=farmbot-guncelle.service

[Install]
WantedBy=timers.target
BIRIM

# Betik servisleri yeniden baslatiyor; parolasiz sudo yalnizca bu iki komut
# icin veriliyor, genel sudo yetkisi acilmiyor.
sudo tee /etc/sudoers.d/farmbot-guncelle >/dev/null <<KURAL
$KULLANICI ALL=(root) NOPASSWD: /usr/bin/systemctl restart farmbot-sunucu farmbot-ajan
KURAL
sudo chmod 440 /etc/sudoers.d/farmbot-guncelle

sudo systemctl daemon-reload

# --- 6. Seri port izni -------------------------------------------------------
echo "[6/6] Seri port izni"
if id -nG "$KULLANICI" | tr ' ' '\n' | grep -qx dialout; then
    echo "      $KULLANICI zaten dialout grubunda"
else
    sudo usermod -aG dialout "$KULLANICI"
    echo "      $KULLANICI dialout grubuna eklendi — DEĞİŞİKLİK İÇİN YENİDEN BAŞLATIN"
fi

IP="$(hostname -I | awk '{print $1}')"
cat <<SON

Kurulum bitti.

  Sunucuyu başlat : sudo systemctl enable --now farmbot-sunucu
  Panel           : http://$IP:8000
  Kayıtlar        : journalctl -u farmbot-sunucu -f

Otomatik guncelleme (istege bagli — GitHub'daki her yeniligi kendi ceker):

  sudo systemctl enable --now farmbot-guncelle.timer
  journalctl -t farmbot-guncelle -f

Panel açıldıktan sonra ajanı başlatın:

  sudo systemctl enable --now farmbot-ajan
  journalctl -u farmbot-ajan -f

UYARI: Ajanı başlatmadan önce Gantry Studio'yu kapatın, iki program
aynı PLC register'larına yazamaz:

  sudo systemctl disable --now gantry-studio

SON
