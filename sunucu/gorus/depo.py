"""depo — taramaların, tespitlerin ve izlerin SQLite arşivi.  [madde 6]"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS tarama (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zaman TEXT NOT NULL,
  kare_yolu TEXT, gorsel_yolu TEXT, ustten_yolu TEXT,
  filiz INTEGER, yabani INTEGER, belirsiz INTEGER,
  ekilen INTEGER, cikan INTEGER, cikmayan INTEGER,
  kapsama_yuzde REAL,
  ortu TEXT, tani TEXT
);

CREATE TABLE IF NOT EXISTS tespit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarama_id INTEGER NOT NULL REFERENCES tarama(id) ON DELETE CASCADE,
  -- tespit_no: taramanın KENDİ içindeki sıra numarası; görselde "#3" diye
  -- yazan budur. tespit.id veritabanı kimliğidir ve başka bir sayıdır.
  tespit_no INTEGER, iz_id INTEGER, kayit_id INTEGER,
  sinif TEXT, skor REAL, onayli INTEGER,
  x_mm REAL, y_mm REAL, alan_mm2 REAL, cap_mm REAL,
  bilesenler TEXT, ek TEXT,
  insan_etiketi TEXT, insan_zamani TEXT
);
CREATE INDEX IF NOT EXISTS ix_tespit_tarama ON tespit(tarama_id);
CREATE INDEX IF NOT EXISTS ix_tespit_no ON tespit(tarama_id, tespit_no);
CREATE INDEX IF NOT EXISTS ix_tespit_iz ON tespit(iz_id);

CREATE TABLE IF NOT EXISTS iz (
  id INTEGER PRIMARY KEY,
  x_mm REAL, y_mm REAL, alan_mm2 REAL,
  ilk_gorulme TEXT, son_gorulme TEXT,
  gorulme_sayisi INTEGER, kayip_sayisi INTEGER,
  kayit_id INTEGER, sinif TEXT, buyume_mm2_gun REAL, gecmis TEXT
);
"""


class Depo:
    def __init__(self, yol):
        Path(yol).parent.mkdir(parents=True, exist_ok=True)
        self.baglanti = sqlite3.connect(yol, check_same_thread=False)
        self.baglanti.row_factory = sqlite3.Row
        self.baglanti.executescript(SEMA)

    def tarama_yaz(self, sonuc: dict) -> int:
        c = self.baglanti
        o = sonuc.get("ortu") or {}
        cim = sonuc.get("cimlenme") or {}
        cur = c.execute(
            "INSERT INTO tarama(zaman,kare_yolu,gorsel_yolu,ustten_yolu,"
            "filiz,yabani,belirsiz,ekilen,cikan,cikmayan,kapsama_yuzde,ortu,tani)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sonuc["zaman"], sonuc.get("kare_yolu"), sonuc.get("gorsel_yolu"),
             sonuc.get("ustten_yolu"),
             sonuc["sayim"]["filiz"], sonuc["sayim"]["yabani"],
             sonuc["sayim"]["belirsiz"], cim.get("ekilen"), cim.get("cikan"),
             cim.get("cikmayan"), o.get("kapsama_yuzde"),
             json.dumps(o, ensure_ascii=False),
             json.dumps(sonuc.get("tani", {}), ensure_ascii=False, default=str)))
        tid = cur.lastrowid
        for t in sonuc["tespitler"]:
            c.execute(
                "INSERT INTO tespit(tarama_id,tespit_no,iz_id,kayit_id,sinif,skor,"
                "onayli,x_mm,y_mm,alan_mm2,cap_mm,bilesenler,ek)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (tid, t.get("id"), t.get("iz_id"), t.get("kayit_id"), t["sinif"],
                 t["skor"], int(t.get("onayli", False)), t.get("x_mm"),
                 t.get("y_mm"), t.get("alan_mm2"), t.get("cap_mm"),
                 json.dumps(t.get("bilesenler"), ensure_ascii=False),
                 json.dumps(t.get("ek"), ensure_ascii=False, default=str)))
        for i in sonuc.get("izler", []):
            c.execute(
                "INSERT INTO iz(id,x_mm,y_mm,alan_mm2,ilk_gorulme,son_gorulme,"
                "gorulme_sayisi,kayip_sayisi,kayit_id,sinif,buyume_mm2_gun,gecmis)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET"
                " x_mm=excluded.x_mm,y_mm=excluded.y_mm,alan_mm2=excluded.alan_mm2,"
                " son_gorulme=excluded.son_gorulme,"
                " gorulme_sayisi=excluded.gorulme_sayisi,"
                " kayip_sayisi=excluded.kayip_sayisi,kayit_id=excluded.kayit_id,"
                " sinif=excluded.sinif,buyume_mm2_gun=excluded.buyume_mm2_gun,"
                " gecmis=excluded.gecmis",
                (i["id"], i["x_mm"], i["y_mm"], i.get("alan_mm2"), i["ilk_gorulme"],
                 i["son_gorulme"], i["gorulme_sayisi"], i["kayip_sayisi"],
                 i.get("kayit_id"), i.get("sinif"), i.get("buyume_mm2_gun"),
                 json.dumps(i.get("gecmis", []))))
        c.commit()
        return tid

    def izleri_yukle(self):
        from .izle import izlerden_yukle
        return izlerden_yukle(self.baglanti.execute("SELECT * FROM iz"))

    def son_tarama(self):
        r = self.baglanti.execute(
            "SELECT * FROM tarama ORDER BY id DESC LIMIT 1").fetchone()
        return dict(r) if r else None

    def tespitler(self, tarama_id=None, sinif=None):
        q, p = "SELECT * FROM tespit WHERE 1=1", []
        if tarama_id is not None:
            q += " AND tarama_id=?"; p.append(tarama_id)
        if sinif:
            q += " AND sinif=?"; p.append(sinif)
        return [dict(r) for r in self.baglanti.execute(q + " ORDER BY id", p)]

    def insan_etiketle(self, tespit_id, etiket, zaman):
        """Panelde 'bu yabani değil' düzeltmesi -> ileride eğitim verisi."""
        self.baglanti.execute(
            "UPDATE tespit SET insan_etiketi=?, insan_zamani=? WHERE id=?",
            (etiket, zaman, tespit_id))
        self.baglanti.commit()

    def gorselden_etiketle(self, tarama_id, tespit_no, etiket, zaman):
        r = self.baglanti.execute(
            "SELECT id FROM tespit WHERE tarama_id=? AND tespit_no=?",
            (tarama_id, tespit_no)).fetchone()
        if not r:
            return None
        self.insan_etiketle(r["id"], etiket, zaman)
        return r["id"]

    def zaman_serisi(self, gun=30):
        """[madde 6] Zaman içinde değişim — panelde grafik için."""
        return [dict(r) for r in self.baglanti.execute(
            "SELECT zaman,filiz,yabani,belirsiz,cikan,cikmayan,kapsama_yuzde "
            "FROM tarama ORDER BY id DESC LIMIT ?", (int(gun * 24),))][::-1]

    def iz_gecmisi(self, iz_id):
        r = self.baglanti.execute("SELECT gecmis,buyume_mm2_gun FROM iz WHERE id=?",
                                  (iz_id,)).fetchone()
        if not r:
            return None
        return {"gecmis": json.loads(r["gecmis"] or "[]"),
                "buyume_mm2_gun": r["buyume_mm2_gun"]}
