/* Sensör okumaları — toprak nemi, ÖLÇÜLDÜĞÜ noktada renk noktası.
 *
 * Veri `/api/olcum/konumlu`dan geliyor: ajan her ölçüme o anki eksen
 * konumunu ekliyor, sunucu 10 mm'lik hücrelerde en yeni okumayı tutuyor.
 * Konumu olmayan ölçümler (PLC kopukken alınanlar) hiç dönmüyor.
 *
 * Renk kuru → ıslak arası: bu bir DURUM göstergesi, dekorasyon değil.
 */
Tarla.katman({
  kimlik: "okumalar",
  ad: "Sensör okumaları",
  varsayilan: false,

  /** HW-103 ham değeri: 1023 kuru, 0 ıslak. Yüzdeye çevirip renklendiriyoruz.
   *
   *  Renk RGB'de değil TON ekseninde geçiş yapıyor: turuncudan maviye düz
   *  RGB karışımı tam ortada çamur grisi veriyor ve en sık görülen değerler
   *  (orta nem) ayırt edilemiyordu. Ton 40° (turuncu) → 210° (mavi) arası
   *  gidince ara değerler sarı-yeşil-camgöbeği olarak okunuyor.
   */
  renk(ham) {
    const yuzde = Math.max(0, Math.min(100, ((1023 - ham) / 1023) * 100));
    const ton = 40 + (210 - 40) * (yuzde / 100);
    return { css: `hsl(${ton.toFixed(0)}, 62%, 52%)`, yuzde };
  },

  guncelle(o) {
    o.bosalt(o.grup);
    (o.veri.okumalar || []).forEach((k) => {
      const { css } = this.renk(k.toprak_nem);
      const disk = new o.THREE.Mesh(
        new o.THREE.CircleGeometry(0.012, 18),
        new o.THREE.MeshBasicMaterial({ color: new o.THREE.Color(css), transparent: true,
                                        opacity: 0.85, side: o.THREE.DoubleSide }));
      disk.rotation.x = -Math.PI / 2;
      disk.position.set(o.sx(k.x), 0.005, o.sz(k.y));
      disk.userData.okuma = k;
      o.grup.add(disk);
    });
  },

  ciz2b(o, c) {
    (o.veri.okumalar || []).forEach((k) => {
      const p = o.mm2b(k.x, k.y);
      const { css } = this.renk(k.toprak_nem);
      c.beginPath(); c.arc(p.x, p.y, 6, 0, Math.PI * 2);
      c.fillStyle = css; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    });
  },

  vur(o, mm) {
    return (o.veri.okumalar || []).find((k) => Math.hypot(k.x - mm.x, k.y - mm.y) < 15) || null;
  },

  kart(o, k) {
    const { yuzde } = this.renk(k.toprak_nem);
    return `<div class="tarla-kart-bas"><div><b>Toprak nemi %${o.say(yuzde, 0)}</b>
      <div class="alt-not">ham ${o.say(k.toprak_nem, 0)} · X${o.say(k.x, 1)} Y${o.say(k.y, 1)}<br>
      ${new Date(k.ts * 1000).toLocaleString("tr-TR")}</div></div></div>`;
  },
});
