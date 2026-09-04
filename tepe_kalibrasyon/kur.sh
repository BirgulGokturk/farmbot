#!/usr/bin/env bash
# Tek komutluk kurulum + calistirma. Ikinci calistirmada paketleri tekrar indirmez.
set -e
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then echo "Python bulunamadi. Once Python 3 kurun."; exit 1; fi
if [ ! -d .ortam ]; then
  echo "Sanal ortam kuruluyor..."
  "$PY" -m venv .ortam
fi
. .ortam/bin/activate
python -c "import cv2, numpy" 2>/dev/null || {
  echo "Bagimliliklar yukleniyor (numpy, opencv-contrib-python)..."
  pip install --upgrade pip -q
  pip install numpy opencv-contrib-python -q
}
exec python sunucu.py "$@"
