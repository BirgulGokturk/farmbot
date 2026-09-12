"""depo — taramaların, tespitlerin ve izlerin SQLite'ta saklanması."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS tarama (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zaman TEXT NOT NULL,
  kare_yolu TEXT,
  gorsel_yolu TEXT,
  gecerli INTEGER NOT NULL,
  gecersizlik_sebebi TEXT,
  kalibrasyon_artigi_mm REAL,
  filiz INTEGER, yabani INTEGER, belirsiz INTEGER,
  sureler_ms TEXT, tani TEXT
);

CREATE TABLE IF NOT EXISTS tespit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarama_id INTEGER NOT NULL REFERENCES tarama(id) ON DELETE CASCADE,
  iz_id INTEGER, kayit_id INTEGER,
  sinif TEXT, skor REAL, onayli INTEGER,
  x_mm REAL, y_mm REAL, alan_mm2 REAL, cap_mm REAL,
  piksel_kutu TEXT, oznitelik TEXT,
  insan_etiketi TEXT,            -- panelde kullanıcı düzeltirse: eğitim verisi
  insan_zamani TEXT
);
CREATE INDEX IF NOT EXISTS ix_tespit_tarama ON tespit(tarama_id);
CREATE INDEX IF NOT EXISTS ix_tespit_iz ON tespit(iz_id);
CREATE INDEX IF NOT EXISTS ix_tespit_etiket ON tespit(insan_etiketi);

CREATE TABLE IF NOT EXISTS iz (
  id INTEGER PRIMARY KEY,
  x_mm REAL, y_mm REAL, alan_mm2 REAL,
  ilk_gorulme TEXT, son_gorulme TEXT,
  gorulme_sayisi INTEGER, kayip_sayisi INTEGER,
  kayit_id INTEGER, sinif TEXT,
  buyume_mm2_gun REAL, gecmis TEXT
);
"""


class Depo:
    def __init__(self, yol):
        Path(yol).parent.mkdir(parents=True, exist_ok=True)
        self.baglanti = sqlite3.connect(yol, check_same_thread=False)
        self.baglanti.row_factory = sqlite3.Row
        self.baglanti.executescript(SEMA)

    # ---- yazma ----
    def tarama_yaz(self, sonuc, kare_yolu=None, gorsel_yolu=None) -> int:
        sonuc = {k: v for k, v in sonuc.items()
                 if not k.startswith("_") and k != "gorsel"}
        s, c = sonuc, self.baglanti
        kal = (s["tani"].get("kalibrasyon") or {}).get("artik_rms_mm")
        cur = c.execute(
            "INSERT INTO tarama(zaman,kare_yolu,gorsel_yolu,gecerli,"
            "gecersizlik_sebebi,kalibrasyon_artigi_mm,filiz,yabani,belirsiz,"
            "sureler_ms,tani) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (s["zaman"], str(kare_yolu or ""), str(gorsel_yolu or ""),
             int(s["gecerli"]), s.get("gecersizlik_sebebi"), kal,
             s["sayim"]["filiz"], s["sayim"]["yabani"], s["sayim"]["belirsiz"],
             json.dumps(s["sureler_ms"]), json.dumps(s["tani"], ensure_ascii=False,
                                                     default=str)))
        tid = cur.lastrowid
        for t in s["tespitler"]:
            tb = t.get("taban_mm") or (None, None)
            c.execute(
                "INSERT INTO tespit(tarama_id,iz_id,kayit_id,sinif,skor,onayli,"
                "x_mm,y_mm,alan_mm2,cap_mm,piksel_kutu,oznitelik) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (tid, t.get("iz_id"), t.get("kayit_id"), t["sinif"], t["skor"],
                 int(t.get("onayli", False)), tb[0], tb[1], t.get("alan_mm2"),
                 t.get("cap_mm"), json.dumps(t.get("piksel_kutu")),
                 json.dumps({k: t.get(k) for k in
                             ("doluluk", "uzanim", "kompaktlik", "yesillik_a",
                              "cevre_mm", "bilesenler", "bayraklar", "paralaks")},
                            ensure_ascii=False)))
        for i in s.get("izler", []):
            c.execute(
                "INSERT INTO iz(id,x_mm,y_mm,alan_mm2,ilk_gorulme,son_gorulme,"
                "gorulme_sayisi,kayip_sayisi,kayit_id,sinif,buyume_mm2_gun,gecmis) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "x_mm=excluded.x_mm,y_mm=excluded.y_mm,alan_mm2=excluded.alan_mm2,"
                "son_gorulme=excluded.son_gorulme,"
                "gorulme_sayisi=excluded.gorulme_sayisi,"
                "kayip_sayisi=excluded.kayip_sayisi,kayit_id=excluded.kayit_id,"
                "sinif=excluded.sinif,buyume_mm2_gun=excluded.buyume_mm2_gun,"
                "gecmis=excluded.gecmis",
                (i["id"], i["x_mm"], i["y_mm"], i["alan_mm2"], i["ilk_gorulme"],
                 i["son_gorulme"], i["gorulme_sayisi"], i["kayip_sayisi"],
                 i.get("kayit_id"), i.get("sinif"), i.get("buyume_mm2_gun"),
                 json.dumps(i.get("gecmis", []))))
        c.commit()
        return tid

    def insan_etiketle(self, tespit_id: int, etiket: str, zaman: str) -> None:
        """Panelde 'bu yabani değil' düzeltmesi -> Faz 2 eğitim verisi."""
        self.baglanti.execute(
            "UPDATE tespit SET insan_etiketi=?, insan_zamani=? WHERE id=?",
            (etiket, zaman, tespit_id))
        self.baglanti.commit()

    # ---- okuma ----
    def izleri_yukle(self) -> list:
        from .izle import Iz
        out = []
        for r in self.baglanti.execute("SELECT * FROM iz"):
            out.append(Iz(id=r["id"], x_mm=r["x_mm"], y_mm=r["y_mm"],
                          alan_mm2=r["alan_mm2"], ilk_gorulme=r["ilk_gorulme"],
                          son_gorulme=r["son_gorulme"],
                          gorulme_sayisi=r["gorulme_sayisi"],
                          kayip_sayisi=r["kayip_sayisi"], kayit_id=r["kayit_id"],
                          sinif=r["sinif"] or "belirsiz",
                          gecmis=[tuple(g) for g in json.loads(r["gecmis"] or "[]")],
                          buyume_mm2_gun=r["buyume_mm2_gun"]))
        return out

    def son_tarama(self):
        r = self.baglanti.execute(
            "SELECT * FROM tarama ORDER BY id DESC LIMIT 1").fetchone()
        return dict(r) if r else None

    def tespitler(self, tarama_id=None, sinif=None) -> list[dict]:
        q, p = "SELECT * FROM tespit WHERE 1=1", []
        if tarama_id is not None:
            q += " AND tarama_id=?"; p.append(tarama_id)
        if sinif:
            q += " AND sinif=?"; p.append(sinif)
        return [dict(r) for r in self.baglanti.execute(q + " ORDER BY id", p)]

    def egitim_kumesi(self) -> list[dict]:
        """İnsan onayı görmüş tespitler — Faz 2'nin etiketli verisi."""
        return [dict(r) for r in self.baglanti.execute(
            "SELECT t.*, s.kare_yolu FROM tespit t JOIN tarama s ON s.id=t.tarama_id "
            "WHERE t.insan_etiketi IS NOT NULL")]
