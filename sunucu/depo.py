"""Ölçüm geçmişi — tek dosyalık SQLite deposu.

Neden SQLite? Grafik için son birkaç saatin/günün verisi yeter. Ayrı bir
veritabanı sunucusu (Postgres) kurmak bu aşamada gereksiz karmaşıklık.
İleride buluta taşınırken tek yapılacak şey bu dosyadaki üç fonksiyonu
başka bir sürücüye çevirmek.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from typing import Any

# Grafikte gösterdiğimiz kanallar. Yeni sensör eklenince buraya bir satır
# eklemek yeterli: tablo, yazma ve okuma otomatik uyum sağlar.
KANALLAR = [
    "hava_nem",          # DHT11 bağıl nem (%)
    "hava_sicaklik",     # DHT11 sıcaklık (°C)
    "bmp_sicaklik",      # BMP180 sıcaklık (°C)
    "basinc",            # BMP180 basınç (hPa)
    "rakim",             # BMP180 rakım (m)
    "toprak_nem",        # HW-103 ham ADC değeri (0-1023)
    "servo_aci",         # SG-5010 açısı (derece)
    # Ölçümün ALINDIĞI KONUM. Tarla haritasındaki "sensör okumaları" katmanı
    # buna dayanıyor: toprak nemi bir sayı değil, bir YERDEKİ sayı. Ajan her
    # ölçüme o anki eksen konumunu ekliyor; PLC bağlı değilse boş geçiyor.
    "konum_x",           # mm
    "konum_y",           # mm
]

# Kaç gün saklansın? Pi 2 saniyede bir gönderse bile 7 gün ≈ 300k satır;
# SQLite bunu rahat taşır ama sonsuza kadar büyümesin diye budanıyor.
SAKLAMA_GUN = 7

_KILIT = threading.Lock()
_baglanti: sqlite3.Connection | None = None


def _yol() -> str:
    """Veritabanı dosyasının yeri.

    Render'da kalıcı disk `/var/data`ya bağlanır; yerelde çalışırken
    proje klasörüne düşer.
    """
    return os.environ.get("VERI_YOLU", os.path.join(os.path.dirname(__file__), "farmbot.db"))


def baglan() -> sqlite3.Connection:
    global _baglanti
    if _baglanti is not None:
        return _baglanti

    yol = _yol()
    klasor = os.path.dirname(yol)
    if klasor:
        os.makedirs(klasor, exist_ok=True)

    # check_same_thread=False: FastAPI'nin iş parçacığı havuzundan da
    # çağrılabiliyor. Yazmaları _KILIT ile serileştiriyoruz.
    _baglanti = sqlite3.connect(yol, check_same_thread=False)
    _baglanti.row_factory = sqlite3.Row
    # WAL: okuma ve yazma birbirini kilitlemesin. Grafik isteği gelirken
    # ajan veri yazmaya devam edebilsin diye.
    _baglanti.execute("PRAGMA journal_mode=WAL")

    sutunlar = ", ".join(f"{ad} REAL" for ad in KANALLAR)
    _baglanti.execute(
        f"CREATE TABLE IF NOT EXISTS olcum (ts REAL NOT NULL, {sutunlar})"
    )
    _baglanti.execute("CREATE INDEX IF NOT EXISTS olcum_ts ON olcum(ts)")

    # Sürüm geçişi: KANALLAR'a yeni bir alan eklendiğinde var olan tablo
    # otomatik büyümez. Sahadaki Pi'de aylardır veri var; tabloyu silmek
    # geçmişi silmek olurdu. Eksik sütunları tek tek ekliyoruz — SQLite'ta
    # ADD COLUMN ucuz ve mevcut satırlar NULL kalıyor.
    var_olan = {satir["name"] for satir in _baglanti.execute("PRAGMA table_info(olcum)")}
    for ad in KANALLAR:
        if ad not in var_olan:
            _baglanti.execute(f"ALTER TABLE olcum ADD COLUMN {ad} REAL")
    _baglanti.commit()
    return _baglanti


def yaz(veri: dict[str, Any], ts: float | None = None) -> None:
    """Bir ölçüm satırı ekler. Bilinmeyen alanlar sessizce atılır."""
    db = baglan()
    satir = [ts if ts is not None else time.time()]
    for ad in KANALLAR:
        deger = veri.get(ad)
        satir.append(float(deger) if isinstance(deger, (int, float)) else None)

    yer_tutucu = ", ".join("?" * (len(KANALLAR) + 1))
    with _KILIT:
        db.execute(
            f"INSERT INTO olcum (ts, {', '.join(KANALLAR)}) VALUES ({yer_tutucu})",
            satir,
        )
        db.commit()


def konumlu_okumalar(dakika: int = 1440, azami: int = 400) -> list[dict[str, Any]]:
    """Konumu bilinen toprak nemi okumaları — haritadaki sensör katmanı için.

    Aynı noktada dakikalarca beklenirse yüzlerce özdeş okuma birikiyor;
    haritada bunların hepsini çizmenin faydası yok, üst üste tek nokta
    görünüyor. 10 mm'lik hücrelere yuvarlayıp her hücrenin EN YENİ okumasını
    alıyoruz: harita "şu noktada en son ne okundu" sorusunu cevaplıyor.
    """
    db = baglan()
    esik = time.time() - dakika * 60
    with _KILIT:
        satirlar = db.execute(
            "SELECT ts, konum_x, konum_y, toprak_nem FROM olcum "
            "WHERE ts >= ? AND konum_x IS NOT NULL AND toprak_nem IS NOT NULL "
            "ORDER BY ts DESC", (esik,)).fetchall()

    hucre: dict[tuple[int, int], dict[str, Any]] = {}
    for s in satirlar:
        anahtar = (round(s["konum_x"] / 10), round(s["konum_y"] / 10))
        if anahtar in hucre:            # satırlar yeniden eskiye; ilki en yeni
            continue
        hucre[anahtar] = {"ts": s["ts"], "x": s["konum_x"], "y": s["konum_y"],
                          "toprak_nem": s["toprak_nem"]}
        if len(hucre) >= azami:
            break
    return sorted(hucre.values(), key=lambda k: k["ts"])


def gecmis(dakika: int = 60, azami_nokta: int = 600) -> dict[str, list]:
    """Grafik için geçmiş veriyi döndürür.

    `azami_nokta` neden var: 6 saatlik veri 2 saniyelik aralıkla ~10 bin
    satır eder. Tarayıcıya 10 bin nokta göndermek hem ağı hem grafiği
    yorar; SQL tarafında seyreltip gönderiyoruz.
    """
    db = baglan()
    bastan = time.time() - dakika * 60

    with _KILIT:
        adet = db.execute("SELECT COUNT(*) FROM olcum WHERE ts >= ?", (bastan,)).fetchone()[0]
        atlama = max(1, adet // azami_nokta)
        # rowid % atlama: her N satırdan birini al. Ortalama almaktan daha
        # ucuz ve sensör verisi için yeterince temsili.
        satirlar = db.execute(
            f"SELECT ts, {', '.join(KANALLAR)} FROM olcum "
            "WHERE ts >= ? AND rowid % ? = 0 ORDER BY ts",
            (bastan, atlama),
        ).fetchall()

    sonuc: dict[str, list] = {"ts": [s["ts"] for s in satirlar]}
    for ad in KANALLAR:
        sonuc[ad] = [s[ad] for s in satirlar]
    return sonuc


def son_kayit() -> dict[str, Any] | None:
    """En son ölçüm — panel açıldığında kartlar boş kalmasın diye."""
    db = baglan()
    with _KILIT:
        satir = db.execute(
            f"SELECT ts, {', '.join(KANALLAR)} FROM olcum ORDER BY ts DESC LIMIT 1"
        ).fetchone()
    return dict(satir) if satir else None


def buda() -> int:
    """Saklama süresini aşan satırları siler; silinen satır sayısını döndürür."""
    db = baglan()
    sinir = time.time() - SAKLAMA_GUN * 86400
    with _KILIT:
        imlec = db.execute("DELETE FROM olcum WHERE ts < ?", (sinir,))
        db.commit()
    return imlec.rowcount
