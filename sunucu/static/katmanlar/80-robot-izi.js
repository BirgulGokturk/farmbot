/* Robot izi — son N konumun soluklaşan çizgisi.
 *
 * Veri sunucudan gelmiyor; çekirdek durum akışını dinlerken biriktiriyor
 * (`veri.iz`). Kalıcı değil, panel yenilenince sıfırlanıyor — amacı "az önce
 * nereden geçti" sorusunu cevaplamak, geçmiş tutmak değil.
 *
 * Soluklaşma iki uçlu: en eski nokta neredeyse görünmez, en yeni tam parlak.
 * three.js'in çizgi malzemesi köşe başına saydamlık desteklemediği için iz,
 * her biri kendi saydamlığı olan kısa parçalardan kuruluyor.
 */
Tarla.katman({
  kimlik: "iz",
  ad: "Robot izi",
  varsayilan: false,

  guncelle(o) {
    o.bosalt(o.grup);
    const iz = o.veri.iz || [];
    if (iz.length < 2) return;
    for (let i = 1; i < iz.length; i++) {
      const oran = i / (iz.length - 1);          // 0 = en eski, 1 = en yeni
      const g = new o.THREE.BufferGeometry().setFromPoints([
        new o.THREE.Vector3(o.sx(iz[i - 1].x), 0.007, o.sz(iz[i - 1].y)),
        new o.THREE.Vector3(o.sx(iz[i].x), 0.007, o.sz(iz[i].y)),
      ]);
      const parca = new o.THREE.Line(g, new o.THREE.LineBasicMaterial({
        color: "#3987e5", transparent: true, opacity: 0.08 + 0.72 * oran }));
      parca.raycast = () => {};
      o.grup.add(parca);
    }
  },

  ciz2b(o, c) {
    const iz = o.veri.iz || [];
    if (iz.length < 2) return;
    c.lineWidth = 2;
    for (let i = 1; i < iz.length; i++) {
      const oran = i / (iz.length - 1);
      const a = o.mm2b(iz[i - 1].x, iz[i - 1].y), b = o.mm2b(iz[i].x, iz[i].y);
      c.globalAlpha = 0.08 + 0.72 * oran;
      c.strokeStyle = "#3987e5";
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    c.globalAlpha = 1;
  },
});
