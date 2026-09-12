"""
akis — canlı akışı (ffmpeg) tarama süresince duraklatan yönetici.

Sorun: UVC kamera tekil erişimlidir. Ajan panel için 640x480 bir ffmpeg akışı
tutuyorsa, aynı kameradan 3840x2160 ölçüm karesi çekilemez — ikinci açan
`VIDIOC_REQBUFS returned -1 (Device or resource busy)` alır.

Çözüm: akışı duraklat → 4K kare çek → akışı geri başlat. Panel bir saniye
donar, ölçüm karesi tam çözünürlükte gelir. Kamera kontrolleri (pozlama,
odak, beyaz denge) kamerada saklandığı için duraklatmadan etkilenmez.

İKİ KULLANIM BİÇİMİ:

  1) TERCİH EDİLEN — kendi başlat/durdur çağrılarınızı verin. Ajan zaten
     ffmpeg'in stdout'unu WebSocket'e bağlıyorsa, süreci dışarıdan öldürüp
     yeniden başlatmak o boruyu koparır; akışı yöneten kendi kodunuz
     yeniden bağlamayı bilir.

        akis = CanliAkis(CIHAZ, durdur=ajan.akisi_durdur,
                                baslat=ajan.akisi_baslat)

  2) YEDEK — çağrı verilmezse modül cihazı tutan ffmpeg süreçlerini bulur,
     komut satırlarını KAYDEDER, sonlandırır, sonra geri başlatır. Kendi
     kodunuz süreci zaten yeniden doğuruyorsa onu bekler, iki kopya
     açmaz. Bu yolda panel akışı yeniden bağlanmayabilir.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import signal
import time
from pathlib import Path


def _gercek_cihaz(yol) -> str:
    """by-id sembolik bağını gerçek /dev/videoN yoluna çözer."""
    try:
        return str(Path(yol).resolve())
    except OSError:
        return str(yol)


def cihazi_tutanlar(cihaz) -> list[dict]:
    """
    Verilen video cihazını açık tutan süreçler. `fuser` gibi çalışır ama
    dış komut gerektirmez: /proc/*/fd bağlarına bakar.
    Döner: [{"pid":.., "cmdline":[..], "ffmpeg": bool}]
    """
    hedefler = {_gercek_cihaz(cihaz), str(cihaz)}
    bulunan = []
    for p in Path("/proc").iterdir():
        if not p.name.isdigit():
            continue
        fd = p / "fd"
        try:
            bagli = any(str(f.resolve()) in hedefler for f in fd.iterdir())
        except (PermissionError, OSError):
            continue
        if not bagli:
            continue
        try:
            cmd = (p / "cmdline").read_bytes().decode("utf-8", "replace")
        except OSError:
            cmd = ""
        argv = [a for a in cmd.split("\0") if a]
        bulunan.append({"pid": int(p.name), "cmdline": argv,
                        "ffmpeg": bool(argv) and "ffmpeg" in argv[0]})
    return bulunan


async def _cagir(fn, *a):
    if fn is None:
        return None
    r = fn(*a)
    return await r if inspect.isawaitable(r) else r


class CanliAkis:
    def __init__(self, cihaz, durdur=None, baslat=None,
                 kapanma_s: float = 3.0, dogma_s: float = 4.0):
        self.cihaz = str(cihaz)
        self.durdur = durdur
        self.baslat = baslat
        self.kapanma_s = kapanma_s
        self.dogma_s = dogma_s
        self._kayitli_argv: list[list[str]] = []
        self._kendi_baslattiklarimiz: list = []

    # ---------- duraklat ----------

    async def duraklat(self) -> dict:
        if self.durdur is not None:
            await _cagir(self.durdur)
            serbest = await self._serbest_bekle(self.kapanma_s)
            return {"yontem": "cagri", "serbest": serbest, "sonlandirilan": []}

        tutanlar = [t for t in cihazi_tutanlar(self.cihaz) if t["ffmpeg"]]
        self._kayitli_argv = [t["cmdline"] for t in tutanlar if t["cmdline"]]
        for t in tutanlar:
            try:
                os.kill(t["pid"], signal.SIGTERM)
            except ProcessLookupError:
                pass
        serbest = await self._serbest_bekle(self.kapanma_s)
        if not serbest:                      # nazik olmadıysa sert ol
            for t in tutanlar:
                try:
                    os.kill(t["pid"], signal.SIGKILL)
                except ProcessLookupError:
                    pass
            serbest = await self._serbest_bekle(1.5)
        return {"yontem": "sonlandir", "serbest": serbest,
                "sonlandirilan": [t["pid"] for t in tutanlar]}

    async def _serbest_bekle(self, sure_s) -> bool:
        son = time.monotonic() + sure_s
        while time.monotonic() < son:
            if not cihazi_tutanlar(self.cihaz):
                return True
            await asyncio.sleep(0.15)
        return not cihazi_tutanlar(self.cihaz)

    # ---------- devam ----------

    async def devam(self) -> dict:
        if self.baslat is not None:
            await _cagir(self.baslat)
            return {"yontem": "cagri"}

        # Ajan kendi akışını zaten geri doğurduysa ikinci kopya açma.
        son = time.monotonic() + self.dogma_s
        while time.monotonic() < son:
            if any(t["ffmpeg"] for t in cihazi_tutanlar(self.cihaz)):
                return {"yontem": "ajan_kendi_dogurdu"}
            await asyncio.sleep(0.2)

        baslatilan = []
        for argv in self._kayitli_argv:
            try:
                s = await asyncio.create_subprocess_exec(
                    *argv, stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL)
                self._kendi_baslattiklarimiz.append(s)
                baslatilan.append(s.pid)
            except Exception:
                pass
        return {"yontem": "kayitli_argv", "baslatilan": baslatilan,
                "uyari": ("Akış yeniden başlatıldı ama çıktısı /dev/null'a "
                          "gidiyor — panel görüntüsü dönmeyebilir. Kalıcı "
                          "çözüm: durdur=/baslat= çağrılarınızı verin.")
                         if baslatilan else None}

    # ---------- bağlam yöneticisi ----------

    async def __aenter__(self):
        self.rapor_duraklat = await self.duraklat()
        if not self.rapor_duraklat["serbest"]:
            kalanlar = cihazi_tutanlar(self.cihaz)
            await self.devam()
            raise RuntimeError(
                f"Kamera serbest bırakılamadı: {self.cihaz}. "
                f"Hâlâ tutan: {[(t['pid'], t['cmdline'][:1]) for t in kalanlar]}")
        return self

    async def __aexit__(self, *a):
        self.rapor_devam = await self.devam()
        return False
