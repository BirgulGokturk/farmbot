/* Uç yuvaları — uçların yatak üzerindeki yerleri ve uç değiştirme alanı.
 *
 * `durum.uc.tools` ve `durum.uc.alan`dan besleniyor. Alan AÇIKKEN içeride Z
 * güvenlik kilidi devre dışı; bu yüzden alan açıkken haritada da belirgin
 * çiziliyor — kilit kapalıyken bunu bilmemek tehlikeli.
 */
Tarla.katman({
  kimlik: "uclar",
  ad: "Uç yuvaları",
  varsayilan: true,

  guncelle(o) {
    o.bosalt(o.grup);
    const uc = o.veri.durum.uc || {};
    const alan = uc.alan || {};

    if (alan.on && (alan.pts || []).length >= 3) {
      const nokta = alan.pts.map(([x, y]) => new o.THREE.Vector2(o.sx(x), o.sz(y)));
      const sekil = new o.THREE.Shape(nokta);
      const zemin = new o.THREE.Mesh(
        new o.THREE.ShapeGeometry(sekil),
        new o.THREE.MeshBasicMaterial({ color: "#3987e5", transparent: true, opacity: 0.14,
                                        side: o.THREE.DoubleSide, depthWrite: false }));
      zemin.rotation.x = Math.PI / 2;      // Shape XY düzleminde; yatağa yatırıyoruz
      zemin.position.y = 0.001;
      zemin.raycast = () => {};
      o.grup.add(zemin);
    }

    (uc.tools_konum || []).forEach((t) => {
      const g = new o.THREE.Group();
      const govde = new o.THREE.Mesh(
        new o.THREE.CylinderGeometry(0.022, 0.026, 0.05, 14),
        o.malzeme(o.makine.renk.uc, { metalness: 0.3, roughness: 0.5 }));
      govde.position.y = 0.025;
      g.add(govde);
      const halka = new o.THREE.Mesh(
        new o.THREE.RingGeometry(0.03, 0.036, 24),
        new o.THREE.MeshBasicMaterial({ color: o.makine.renk.uc, side: o.THREE.DoubleSide }));
      halka.rotation.x = -Math.PI / 2;
      halka.position.y = 0.002;
      g.add(halka);
      g.position.set(o.sx(t.x), 0, o.sz(t.y));
      g.traverse((n) => { n.userData.yuva = t; });
      o.grup.add(g);
    });
  },

  ciz2b(o, c) {
    const uc = o.veri.durum.uc || {};
    const alan = uc.alan || {};
    if (alan.on && (alan.pts || []).length >= 3) {
      c.beginPath();
      alan.pts.forEach(([x, y], i) => {
        const p = o.mm2b(x, y);
        if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
      });
      c.closePath();
      c.fillStyle = "#3987e522";
      c.fill();
      c.strokeStyle = "#3987e5";
      c.stroke();
    }
    (uc.tools_konum || []).forEach((t) => {
      const p = o.mm2b(t.x, t.y);
      c.beginPath();
      c.arc(p.x, p.y, 7, 0, Math.PI * 2);
      c.strokeStyle = o.makine.renk.uc;
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = "#c3c2b7";
      c.font = "10px ui-sans-serif, system-ui";
      c.fillText(t.name || "", p.x + 10, p.y + 3);
    });
  },

  vur(o, mm) {
    const uc = o.veri.durum.uc || {};
    return (uc.tools_konum || []).find((t) =>
      Math.hypot(t.x - mm.x, t.y - mm.y) < 25) || null;
  },

  kart(o, t) {
    return `<div class="tarla-kart-bas"><div><b>${o.kacisli(t.name)}</b>
      <div class="alt-not">uç yuvası · X${o.say(t.x, 1)} Y${o.say(t.y, 1)} Z${o.say(t.z, 1)}</div></div></div>
      <p class="alt-not">Takmak ve bırakmak Ayarlar sekmesindeki uç değiştirme
      bölümünden yapılır — dizi güvenlik denetimleriyle birlikte orada.</p>`;
  },
});
