# Farmbot — Windows deneme başlatıcı
#
# Donanım gerekmez: sensör ve PLC sahte, sunucu kendi bilgisayarında çalışır.
# Sanal ortamları kurar, sunucuyu ve ajanı ayrı pencerelerde başlatır,
# tarayıcıyı açar.
#
# Çalıştırma (proje klasöründe, PowerShell):
#   powershell -ExecutionPolicy Bypass -File dene-windows.ps1
#
# Kapatmak için açılan iki pencereyi kapatın.

$ErrorActionPreference = "Stop"
$kok = $PSScriptRoot

# Python var mı? Windows'ta "python" bazen Microsoft Store'u açan bir kısayol
# oluyor; sürüm satırı gelmiyorsa gerçek Python kurulu değil demektir.
try {
    $surum = & python --version 2>&1
    if ($surum -notmatch "Python 3") { throw }
    Write-Host "Python bulundu: $surum" -ForegroundColor Green
} catch {
    Write-Host "Python 3 bulunamadi. https://www.python.org/downloads/ adresinden kurun." -ForegroundColor Red
    Write-Host "Kurulum sirasinda 'Add python.exe to PATH' kutusunu isaretlemeyi unutmayin." -ForegroundColor Yellow
    exit 1
}

function VenvKur($klasor) {
    $venv = Join-Path $klasor ".venv"
    if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
        Write-Host "Sanal ortam kuruluyor: $klasor" -ForegroundColor Cyan
        & python -m venv $venv
    }
    Write-Host "Paketler yukleniyor: $klasor" -ForegroundColor Cyan
    & (Join-Path $venv "Scripts\python.exe") -m pip install --quiet --upgrade pip
    & (Join-Path $venv "Scripts\pip.exe") install --quiet -r (Join-Path $klasor "requirements.txt")
}

$sunucu = Join-Path $kok "sunucu"
$ajan = Join-Path $kok "ajan"
VenvKur $sunucu
VenvKur $ajan

Write-Host "`nSunucu baslatiliyor..." -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$sunucu'; `$env:AJAN_JETONU='test123'; .\.venv\Scripts\uvicorn.exe main:app --port 8000"
)

# Sunucunun soketi acmasini bekle: ajan erken baslarsa bir kez hata yazip
# yeniden dener, gereksiz telas olur.
Start-Sleep -Seconds 6

Write-Host "Ajan baslatiliyor (sahte sensor + sahte PLC)..." -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$ajan'; .\.venv\Scripts\python.exe ajan.py ayarlar.deneme.json"
)

Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:8000"

Write-Host "`nPanel acildi: http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "Durdurmak icin acilan iki pencereyi kapatin." -ForegroundColor Yellow
