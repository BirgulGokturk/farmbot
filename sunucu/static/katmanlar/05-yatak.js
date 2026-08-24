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
    const imza = `${w}|${d}|${rayY}`;
    // Katman kapatılınca çekirdek grubu boşaltıp geometriyi atıyor; grup
    // boşsa imza aynı olsa da yeniden kurmak gerekiyor.
    if (imza === this._imza && o.grup.children.length) return;
    this._imza = imza;

    o.bosalt(o.grup);
    const makine = window.FarmbotMakine.kur(o.THREE, {
      w: w, d: d, rayY: rayY, parca: "sabit",
    });
    // Tezgâh ışın testine girmesin: yatağa tıklamak bitki yerleştirmek
    // demek, ayak profiline çarpan tıklama noktayı kaçırıyordu.
    makine.sabit.traverse((n) => { n.raycast = () => {}; });
    o.grup.add(makine.sabit);
  },

  ciz2b(o, c) {
    const s = o.sinir;
    const a = o.mm2b(s.x.min, s.y.min), b = o.mm2b(s.x.max, s.y.max);
    c.fillStyle = o.makine.renk.toprak;
    c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    c.strokeStyle = o.makine.renk.toprak_koyu;
    c.lineWidth = 2;
    const n = o.makine.yatak.karik_sayisi;
    for (let i = 1; i <= n; i++) {
      const y = a.y + ((b.y - a.y) * i) / (n + 1);
      c.beginPath(); c.moveTo(a.x + 4, y); c.lineTo(b.x - 4, y); c.stroke();
    }
  },
});
