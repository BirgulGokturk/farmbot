/* Robot — köprü, kızak, Z takımı ve uç kafası; canlı konumda.
 *
 * Geometrinin tamamı `makine.js`teki FarmbotMakine.kur()'dan geliyor.
 * Konum `durum.konum`dan; her durum paketinde YALNIZ konum güncelleniyor,
 * gövde yeniden kurulmuyor — saniyede birkaç kez portal kurmak Pi'nin
 * GPU'sunu boşuna yoruyor.
 *
 * Katman kapatılırsa makine hiç çizilmiyor: yerleştirme yaparken portalın
 * bitkilerin önünü kapatması can sıkıcı.
 */
Tarla.katman({
  kimlik: "robot",
  ad: "Robot",
  varsayilan: true,

  guncelle(o) {
    const M = o.makine, MM = o.MM;
    const w = o.genislikM, d = o.derinlikM, rayY = M.ray_yuksekligi * MM;
    const imza = `${w}|${d}|${rayY}`;

    // Katman kapatılınca çekirdek grubu boşaltıp geometriyi atıyor; grup
    // boşsa imza aynı olsa da yeniden kurmak gerekiyor.
    if (imza !== this._imza || !o.grup.children.length) {
      this._imza = imza;
      o.bosalt(o.grup);
      const makine = window.FarmbotMakine.kur(o.THREE, {
        w: w, d: d, rayY: rayY, parca: "hareketli",
      });
      this._p = makine;
      // Makineye tıklamak bitki seçmek/taşımak değil — ışın testinden çıksın.
      makine.portal.traverse((n) => { n.raycast = () => {}; });
      o.grup.add(makine.portal);
    }

    const p = this._p;
    if (!p) return;
    const k = o.veri.konum || {};
    const x = k.x == null ? o.sinir.x.min : k.x;
    const y = k.y == null ? o.sinir.y.min : k.y;
    const z = k.z == null ? o.sinir.z.max : k.z;

    // Kopru uzun kenar boyunca yuruyor (makine Y), kizak kiriste kisa kenar
    // boyunca kayiyor (makine X). Gercek makinedeki duzen bu.
    p.portal.position.z = o.sz(y);
    p.kizak.position.x = o.sx(x);
    // Makine Z'si büyüdükçe uç YUKARI çıkıyor (kalibrasyonda dir = -1,
    // home = 438). Uç ucunu doğrudan o yüksekliğe koyuyoruz.
    const ucY = o.kis(z, 0, o.sinir.z.max || 550) * MM;
    p.ucKafa.position.set(0, ucY + 0.04, 0);
    // Z kılavuzu birim yükseklikte kuruluyor, stroka göre uzatılıyor.
    const boy = Math.max(0.05, rayY - 0.045 - (ucY + 0.08));
    p.sutun.scale.y = boy;
    p.sutun.position.set(0, ucY + 0.08 + boy / 2, 0);
  },

  ciz2b(o, c) {
    const k = o.veri.konum;
    if (!k) return;
    const s = o.sinir;
    const ust = o.mm2b(k.x, s.y.min), alt = o.mm2b(k.x, s.y.max);
    // Portal: kiriş Y ekseni boyunca uzanıyor, üstten ince bir çizgi.
    c.strokeStyle = o.makine.renk.cerceve;
    c.lineWidth = 3;
    c.globalAlpha = 0.7;
    c.beginPath(); c.moveTo(ust.x, ust.y); c.lineTo(alt.x, alt.y); c.stroke();
    c.globalAlpha = 1;

    const p = o.mm2b(k.x, k.y);
    c.fillStyle = o.makine.renk.uc;
    c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = "#c3c2b7";
    c.font = "10px ui-monospace, Menlo, Consolas, monospace";
    c.fillText(`X${o.say(k.x, 0)} Y${o.say(k.y, 0)} Z${o.say(k.z, 0)}`, p.x + 11, p.y - 6);
  },
});
