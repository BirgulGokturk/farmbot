/* Kayıtlı noktalar — bitki OLMAYAN noktalar (ızgara, referans, sera girişi…).
 *
 * Bitkilerle aynı depoda duruyorlar; ayıran tek şey `tur` alanının yokluğu.
 * Ayrı katman olmaları işe yarıyor: 60 noktalık bir tohum ızgarası açıkken
 * bitkileri görmek zor, kapatınca yatak temizleniyor.
 */
Tarla.katman({
  kimlik: "noktalar",
  ad: "Kayıtlı noktalar",
  varsayilan: true,

  liste(o) {
    return o.veri.noktalar.filter((n) => n && !n.tur);
  },

  guncelle(o) {
    o.bosalt(o.grup);
    const mal = new o.THREE.MeshBasicMaterial({ color: "#c3c2b7", transparent: true, opacity: 0.85 });
    this.liste(o).forEach((n) => {
      const g = new o.THREE.Group();
      const halka = new o.THREE.Mesh(new o.THREE.RingGeometry(0.006, 0.011, 18), mal);
      halka.rotation.x = -Math.PI / 2;
      halka.position.y = 0.004;
      g.add(halka);
      const cubuk = new o.THREE.Mesh(
        new o.THREE.CylinderGeometry(0.0015, 0.0015, 0.05, 6), mal);
      cubuk.position.y = 0.025;
      g.add(cubuk);
      g.position.set(o.sx(n.x), 0, o.sz(n.y));
      o.grup.add(g);
    });
  },

  ciz2b(o, c) {
    this.liste(o).forEach((n) => {
      const p = o.mm2b(n.x, n.y);
      c.strokeStyle = "#c3c2b7"; c.lineWidth = 1;
      c.beginPath();
      c.moveTo(p.x - 4, p.y); c.lineTo(p.x + 4, p.y);
      c.moveTo(p.x, p.y - 4); c.lineTo(p.x, p.y + 4);
      c.stroke();
      c.fillStyle = "#8a8a80";
      c.font = "9px ui-sans-serif, system-ui";
      c.fillText(n.ad, p.x + 6, p.y - 4);
    });
  },

  vur(o, mm) {
    return this.liste(o).find((n) => Math.hypot(n.x - mm.x, n.y - mm.y) < 18) || null;
  },

  kart(o, n) {
    return `<div class="tarla-kart-bas"><div><b>${o.kacisli(n.ad)}</b>
      <div class="alt-not">nokta · X${o.say(n.x, 1)} Y${o.say(n.y, 1)} Z${o.say(n.z, 1)}
      ${n.etiket ? "· " + o.kacisli(n.etiket) : ""}</div></div></div>
      <div class="tarla-kart-dugme">
        <button class="dugme birincil" id="d-nokta-git">Buraya git</button>
        <button class="dugme tehlike" id="d-nokta-sil">Sil</button>
      </div>`;
  },

  baglan(o, kok, n) {
    kok.querySelector("#d-nokta-git").onclick = () => o.komut("git", { x: n.x, y: n.y, z: n.z });
    kok.querySelector("#d-nokta-sil").onclick = () =>
      o.api(`/api/noktalar?ad=${encodeURIComponent(n.ad)}`, { method: "DELETE" })
        .then(() => { o.gunluk(`✓ '${n.ad}' silindi`, "ok"); return o.noktalariYukle(); })
        .catch((h) => o.gunluk(`✕ Silinemedi: ${h.message}`, "hata"));
  },

  tasi(o, n, mm, bitti) {
    n.x = Math.round(mm.x * 10) / 10;
    n.y = Math.round(mm.y * 10) / 10;
    if (!bitti) { this.guncelle(o); return; }
    o.api("/api/noktalar", { method: "POST", body: JSON.stringify({
      ad: n.ad, x: n.x, y: n.y, z: n.z, etiket: n.etiket || "", ustune_yaz: true }) })
      .catch((h) => o.gunluk(`✕ Taşınamadı: ${h.message}`, "hata"))
      .then(() => o.noktalariYukle());
  },
});
