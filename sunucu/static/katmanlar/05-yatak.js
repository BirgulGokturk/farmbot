/* Yatak ve çerçeve — tezgâh, toprak kabı, yan raylar.
 *
 * Geometrinin tamamı `makine.js`teki FarmbotMakine.kur()'dan geliyor; burada
 * elle kurulmuş parça ya da yazılmış ölçü yok. Ayrı bir katman çünkü
 * kapatılabilmesi işe yarıyor: kalabalık bir yatakta bitkileri sade bir
 * zeminde görmek isteyen olur.
 *
 * Sabit gövde her durum paketinde yeniden kurulmuyor: yalnız yatak ölçüsü
 * değişince. Pi'nin GPU'sunda saniyede birkaç kez tezgâh kurmak lüks.
 */
Tarla.katman({
  kimlik: "yatak",
  ad: "Yatak ve çerçeve",
  varsayilan: true,

  guncelle(o) {
    const M = o.makine, MM = o.MM;
    const w = o.genislikM, d = o.derinlikM, rayY = M.ray_yuksekligi * MM;
    /* Dikim alanları da imzada: alan eklenip çıkarıldığında kaplar
     * yeniden kurulmalı. Boş dizi "alan tanımsız" demek ve makine.js
     * yatağın tamamını tek kap yapıyor — eski davranış. */
    const alanlar = o.dikimSahne;
    const imza = `${w}|${d}|${rayY}|` + alanlar.map(
      (a) => `${a.ad}:${a.mx.toFixed(4)},${a.mz.toFixed(4)},`
             + `${a.en.toFixed(4)},${a.boy.toFixed(4)},${a.yuzeyY.toFixed(4)}`).join(";");
    // Katman kapatılınca çekirdek grubu boşaltıp geometriyi atıyor; grup
    // boşsa imza aynı olsa da yeniden kurmak gerekiyor.
    if (imza !== this._imza || !o.grup.children.length) {
      this._imza = imza;
      this._nemImza = null;             // yeni geometri, nem yeniden boyanacak
      o.bosalt(o.grup);
      const makine = window.FarmbotMakine.kur(o.THREE, {
        w: w, d: d, rayY: rayY, parca: "sabit", alanlar: alanlar,
      });
      // Tezgâh ışın testine girmesin: yatağa tıklamak bitki yerleştirmek
      // demek, ayak profiline çarpan tıklama noktayı kaçırıyordu.
      makine.sabit.traverse((n) => { n.raycast = () => {}; });
      o.grup.add(makine.sabit);
    }

    /* Toprak nemi. Geometri yeniden kurulmuyor — yalnız köşe renkleri
     * yazılıyor, o da okumalar GERÇEKTEN değiştiyse. Okumalar 20 sn'de
     * bir tazeleniyor; her durum paketinde 3 bin köşe dolaşmak boşuna. */
    const okumalar = o.veri.okumalar || [];
    const nemImza = okumalar.length
      ? okumalar.map((k) => `${k.x},${k.y},${k.toprak_nem}`).join(";")
      : "";
    if (nemImza !== this._nemImza) {
      this._nemImza = nemImza;
      window.FarmbotMakine.nemBoya(o.grup, {
        okumalar: okumalar, sx: o.sx, sz: o.sz,
      });
    }
  },

  ciz2b(o, c) {
    const s = o.sinir;
    /* 2B'de de toprak yalnız dikim alanlarında. Alan tanımsızsa yatağın
     * tamamı — 3B ile aynı kaçış, yoksa iki görünüm birbirini tutmazdı. */
    const kutular = o.dikim.length
      ? o.dikim.map((a) => ({ ad: a.ad, x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 }))
      : [{ ad: "", x1: s.x.min, y1: s.y.min, x2: s.x.max, y2: s.y.max }];
    const n = o.makine.yatak.karik_sayisi;
    kutular.forEach((k) => {
      const a = o.mm2b(k.x1, k.y1), b = o.mm2b(k.x2, k.y2);
      const sol = Math.min(a.x, b.x), ust = Math.min(a.y, b.y);
      const en = Math.abs(b.x - a.x), boy = Math.abs(b.y - a.y);
      c.fillStyle = o.makine.renk.toprak;
      c.fillRect(sol, ust, en, boy);
      c.strokeStyle = o.makine.renk.toprak_koyu;
      c.lineWidth = 2;
      for (let i = 1; i <= n; i++) {
        const y = ust + (boy * i) / (n + 1);
        c.beginPath(); c.moveTo(sol + 4, y); c.lineTo(sol + en - 4, y); c.stroke();
      }
      // Alan adı: iki kap yan yanayken hangisinin hangisi olduğu
      // ancak yazıyla anlaşılıyor.
      if (k.ad && en > 30) {
        c.fillStyle = "#d8d3c4";
        c.font = "10px ui-sans-serif, system-ui";
        c.fillText(k.ad, sol + 5, ust + 13);
      }
    });
  },
});
