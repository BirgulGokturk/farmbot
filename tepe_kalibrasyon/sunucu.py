#!/usr/bin/env python3
"""
Tepe kamerasi kalibrasyon arayuzu — kucuk yerel sunucu.

Calistirma:  python3 sunucu.py           (varsayilan http://127.0.0.1:8765)
             python3 sunucu.py --port 9000 --host 0.0.0.0

Bagimliliklar: numpy, opencv-contrib-python  (baska hicbir sey yok; sunucu stdlib)
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import threading
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen, Request

try:
    import numpy as np
    import cv2
except ImportError:
    sys.stderr.write(
        "\nEksik bagimlilik. Sunu calistirin:\n"
        "    pip install numpy opencv-contrib-python\n\n"
        "(Sunucusuz/basliksiz makinede: pip install numpy opencv-contrib-python-headless)\n"
    )
    raise SystemExit(1)

if not hasattr(cv2, "aruco") or not hasattr(cv2.aruco, "DICT_APRILTAG_36h11"):
    sys.stderr.write(
        "\nBu OpenCV kurulumunda aruco/AprilTag sozlugu yok. 'opencv-python' yerine\n"
        "'opencv-contrib-python' gerekiyor:\n"
        "    pip uninstall -y opencv-python\n"
        "    pip install opencv-contrib-python\n"
    )
    raise SystemExit(1)

import kalibrasyon as kal

KOK = os.path.dirname(os.path.abspath(__file__))
ONIZLEME_MAKS = 1600  # arayuze gonderilen onizlemenin en buyuk kenari (px)


def _kareyi_coz(govde: dict) -> tuple["np.ndarray", str]:
    """Istekten kareyi cikarir. Ya base64 dosya ya da HTTP adresi."""
    if govde.get("veri_b64"):
        ham = base64.b64decode(govde["veri_b64"].split(",")[-1])
        kaynak = govde.get("dosya_adi", "yuklenen dosya")
    elif govde.get("url"):
        url = govde["url"].strip()
        if not url.lower().startswith(("http://", "https://")):
            raise ValueError("Adres http:// veya https:// ile baslamali.")
        istek = Request(url, headers={"User-Agent": "tepe-kalibrasyon/1.0"})
        with urlopen(istek, timeout=20) as y:
            ham = y.read()
        kaynak = url
    else:
        raise ValueError("Ne dosya ne adres verildi.")
    dizi = np.frombuffer(ham, dtype=np.uint8)
    kare = cv2.imdecode(dizi, cv2.IMREAD_COLOR)
    if kare is None:
        raise ValueError("Kare cozulemedi — dosya bir goruntu degil ya da bozuk.")
    return kare, kaynak


def _onizleme(kare: "np.ndarray") -> tuple[str, float]:
    h, w = kare.shape[:2]
    o = min(1.0, ONIZLEME_MAKS / max(w, h))
    k = cv2.resize(kare, (int(w * o), int(h * o)), interpolation=cv2.INTER_AREA) if o < 1.0 else kare
    ok, buf = cv2.imencode(".jpg", k, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
    if not ok:
        raise ValueError("Onizleme kodlanamadi.")
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii"), o


class Islem(BaseHTTPRequestHandler):
    server_version = "TepeKalibrasyon/1.0"

    def log_message(self, bicim, *args):
        sys.stderr.write("  %s\n" % (bicim % args))

    # ---------------- yardimcilar ----------------
    def _gonder(self, kod: int, govde: bytes, tur: str):
        self.send_response(kod)
        self.send_header("Content-Type", tur)
        self.send_header("Content-Length", str(len(govde)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(govde)

    def _json(self, kod: int, nesne: dict):
        self._gonder(kod, json.dumps(nesne, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _govde(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    # ---------------- GET ----------------
    def do_GET(self):
        yol = self.path.split("?")[0]
        if yol in ("/", "/index.html"):
            with open(os.path.join(KOK, "index.html"), "rb") as f:
                self._gonder(200, f.read(), "text/html; charset=utf-8")
        elif yol == "/api/durum":
            self._json(200, {
                "tamam": True,
                "opencv": cv2.__version__,
                "numpy": np.__version__,
                "surum": kal.SURUM,
                "parametreler": kal.parametre_ozeti(),
            })
        else:
            self._json(404, {"hata": "yok"})

    # ---------------- POST ----------------
    def do_POST(self):
        yol = self.path.split("?")[0]
        try:
            if yol == "/api/tespit":
                self._tespit()
            elif yol == "/api/hesapla":
                self._hesapla()
            else:
                self._json(404, {"hata": "yok"})
        except Exception as e:
            traceback.print_exc()
            self._json(400, {"hata": str(e)})

    def _tespit(self):
        g = self._govde()
        kare, kaynak = _kareyi_coz(g)
        beklenen = [int(x) for x in (g.get("beklenen") or [])]
        tespitler, rapor = kal.etiketleri_bul(kare, beklenen)
        onizleme, oran = _onizleme(kare)
        self._json(200, {
            "tamam": True,
            "kaynak": kaynak,
            "onizleme": onizleme,
            "onizleme_orani": oran,
            "tespitler": [t.__dict__ for t in tespitler],
            "rapor": rapor,
        })

    def _hesapla(self):
        g = self._govde()
        tespitler = [kal.Tespit(**t) for t in g["tespitler"]]
        koord = {int(k): (float(v[0]), float(v[1])) for k, v in g["koordinatlar"].items()}
        kenar = g.get("kenar_mm")
        kenar = float(kenar) if kenar not in (None, "", 0) else None
        yatak = tuple(float(x) for x in (g.get("yatak_mm") or [540.0, 645.0]))
        dog = g.get("dogrulama_noktalari") or None
        sonuc = kal.kalibre_et(tespitler, koord, kenar, yatak, dog)
        sonuc["kaynak"] = g.get("kaynak")
        sonuc["tespit_raporu"] = g.get("rapor")
        self._json(200, {"tamam": True, "sonuc": sonuc})


def main():
    a = argparse.ArgumentParser(description="Tepe kamerasi kalibrasyon arayuzu")
    a.add_argument("--host", default="127.0.0.1")
    a.add_argument("--port", type=int, default=8765)
    a.add_argument("--tarayici-acma", action="store_true", help="tarayiciyi otomatik acma")
    n = a.parse_args()

    try:
        sunucu = ThreadingHTTPServer((n.host, n.port), Islem)
    except OSError as e:
        sys.stderr.write(
            f"\n  {n.port} portu kullanimda ({e}).\n"
            f"  Ya onceki sunucuyu kapatin ya da baska bir port secin:\n"
            f"      python3 sunucu.py --port {n.port + 1}\n\n"
        )
        raise SystemExit(1)
    adres = f"http://{'127.0.0.1' if n.host == '0.0.0.0' else n.host}:{n.port}/"
    print(f"\n  Tepe kamerasi kalibrasyonu  (OpenCV {cv2.__version__})")
    print(f"  Arayuz: {adres}")
    print("  Durdurmak icin Ctrl+C\n")
    if not n.tarayici_acma:
        threading.Timer(0.8, lambda: webbrowser.open(adres)).start()
    try:
        sunucu.serve_forever()
    except KeyboardInterrupt:
        print("\n  Kapatiliyor.")


if __name__ == "__main__":
    main()
