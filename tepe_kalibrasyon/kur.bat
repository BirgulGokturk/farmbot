@echo off
REM Tek komutluk kurulum + calistirma. Ikinci calistirmada paketleri tekrar indirmez.
cd /d "%~dp0"
where python >nul 2>nul || (echo Python bulunamadi. Once Python 3 kurun. & pause & exit /b 1)
if not exist .ortam (
  echo Sanal ortam kuruluyor...
  python -m venv .ortam
)
call .ortam\Scripts\activate.bat
python -c "import cv2, numpy" 2>nul || (
  echo Bagimliliklar yukleniyor ^(numpy, opencv-contrib-python^)...
  python -m pip install --upgrade pip -q
  python -m pip install numpy opencv-contrib-python -q
)
python sunucu.py %*
pause
