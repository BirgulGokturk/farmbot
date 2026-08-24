/* Kamera kareleri — fotoğrafın ÇEKİLDİĞİ koordinatta küçük işaret.
 *
 * Ajan her kareye o anki eksen konumunu iliştiriyor; sunucu konumu dosya
 * adında saklıyor. Konumsuz eski kareler haritada görünmüyor (yerleri
 * bilinmiyor), ama İzle sekmesindeki kamera kartında görünmeye devam
 * ediyorlar.
 *
 * İşarete tıklayınca kare kartın içinde açılıyor: küçük resmi haritanın
 * üstüne dağıtmak yerine tek yerde, istendiğinde.
 */
Tarla.katman({
  kimlik: "kareler",
  ad: "Kamera kareleri",
  varsayilan: false,

  konumlu(o) {
    return (o.veri.kareler || []).filter((k) => k.x != null && k.y != null);
  },

  guncelle(o) {
    o.bosalt(o.grup);
    const mal = new o.THREE.MeshBasicMaterial({ color: "#3987e5", side: o.THREE.DoubleSide });
    this.konumlu(o).forEach((k) => {
      const g = new o.THREE.Group();
      // Küçük bir "objektif": halka + ortada nokta
      const halka = new o.THREE.Mesh(new o.THREE.RingGeometry(0.009, 0.013, 16), mal);
      halka.rotation.x = -Math.PI / 2;
      g.add(halka);
      const nokta = new o.THREE.Mesh(new o.THREE.CircleGeometry(0.004, 12), mal);
      nokta.rotation.x = -Math.PI / 2;
      g.add(nokta);
      g.position.set(o.sx(k.x), 0.006, o.sz(k.y));
      o.grup.add(g);
    });
  },

  ciz2b(o, c) {
    this.konumlu(o).forEach((k) => {
      const p = o.mm2b(k.x, k.y);
      c.strokeStyle = "#3987e5"; c.lineWidth = 1.5;
      c.beginPath(); c.arc(p.x, p.y, 6, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#3987e5";
      c.beginPath(); c.arc(p.x, p.y, 2, 0, Math.PI * 2); c.fill();
    });
  },

  vur(o, mm) {
    return this.konumlu(o).find((k) => Math.hypot(k.x - mm.x, k.y - mm.y) < 15) || null;
  },

  kart(o, k) {
    return `<div class="tarla-kart-bas"><div><b>Kamera karesi</b>
      <div class="alt-not">X${o.say(k.x, 0)} Y${o.say(k.y, 0)} ·
      ${new Date(k.ts * 1000).toLocaleString("tr-TR")}</div></div></div>
      <img class="kare-onizleme" alt="Kamera karesi"
           src="/api/kare/${encodeURIComponent(k.damga)}?jeton=${encodeURIComponent((window.Panel && Panel.S.jeton) || "")}">`;
  },
});
