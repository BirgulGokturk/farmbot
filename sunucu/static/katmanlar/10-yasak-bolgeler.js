/* Yasak bölgeler — ajandaki bölge tanımlarının haritadaki karşılığı.
 *
 * Veri `durum.bolgeler`den geliyor; panel bir kopya tutmuyor. Bölgeyi
 * buradan düzenlemek yok: bölge güvenlik kuralı ve tek düzenleme yeri
 * Ayarlar sekmesi. Harita yalnızca "nerede" sorusunu cevaplıyor.
 */
Tarla.katman({
  kimlik: "bolgeler",
  ad: "Yasak bölgeler",
  varsayilan: true,

  guncelle(o) {
    o.bosalt(o.grup);
    (o.veri.durum.bolgeler || []).forEach((b) => {
      if (b.aktif === false) return;
      const x1 = Math.min(b.x1, b.x2), x2 = Math.max(b.x1, b.x2);
      const y1 = Math.min(b.y1, b.y2), y2 = Math.max(b.y1, b.y2);
      const en = (x2 - x1) * o.MM, boy = (y2 - y1) * o.MM;
      if (en <= 0 || boy <= 0) return;

      const renk = b.uyari ? "#d03b3b" : "#d9a520";
      const zemin = new o.THREE.Mesh(
        new o.THREE.PlaneGeometry(en, boy),
        new o.THREE.MeshBasicMaterial({ color: renk, transparent: true, opacity: 0.12,
                                        side: o.THREE.DoubleSide, depthWrite: false }));
      zemin.rotation.x = -Math.PI / 2;
      zemin.position.set(o.sx((x1 + x2) / 2), 0.0008, o.sz((y1 + y2) / 2));
      zemin.raycast = () => {};
      o.grup.add(zemin);

      const kose = [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]
        .map(([x, y]) => new o.THREE.Vector3(o.sx(x), 0.0012, o.sz(y)));
      const cizgi = new o.THREE.Line(
        new o.THREE.BufferGeometry().setFromPoints(kose),
        new o.THREE.LineBasicMaterial({ color: renk }));
      cizgi.raycast = () => {};
      o.grup.add(cizgi);
    });
  },

  ciz2b(o, c) {
    (o.veri.durum.bolgeler || []).forEach((b) => {
      if (b.aktif === false) return;
      const a = o.mm2b(Math.min(b.x1, b.x2), Math.min(b.y1, b.y2));
      const d = o.mm2b(Math.max(b.x1, b.x2), Math.max(b.y1, b.y2));
      const renk = b.uyari ? "#d03b3b" : "#d9a520";
      c.fillStyle = renk + "22";
      c.fillRect(a.x, a.y, d.x - a.x, d.y - a.y);
      c.strokeStyle = renk;
      c.setLineDash([4, 3]);
      c.lineWidth = 1;
      c.strokeRect(a.x, a.y, d.x - a.x, d.y - a.y);
      c.setLineDash([]);
      c.fillStyle = renk;
      c.font = "10px ui-sans-serif, system-ui";
      c.fillText(b.ad || "bölge", a.x + 4, a.y + 12);
    });
  },
});
