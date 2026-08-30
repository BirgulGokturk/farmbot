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
  renk(o, ham) {
    /* KALİBRE yüzde. Eskiden 0-1023 varsayılıyordu; probun kuru ve ıslak
     * uçları sahada o değerler değil (bu makinede ıslak 593 ölçüldü) ve
     * ham ölçekle hesaplanan yüzde gerçeğin epey altında çıkıyordu.
     * Ajan `durum.toprak_kalib` ile {kuru, islak} gönderiyor; sunucudaki
     * `sulama.nem_yuzde` ile AYNI formül.
     *
     * `o` bilerek PARAMETRE: kalibrasyon durum paketinden geliyor ve bu
     * yöntem katman bağlamını kapsamdan göremiyor. Eskiden görebildiği
     * varsayılmıştı; katman açılır açılmaz `o is not defined` ile
     * patlıyordu ve katman varsayılan olarak KAPALI olduğu için hata
     * ancak kullanıcı onu açınca ortaya çıkıyordu. */
    const kalib = (o.veri.durum && o.veri.durum.toprak_kalib) || {};
    const kuru = Number(kalib.kuru != null ? kalib.kuru : 1023);
    const islak = Number(kalib.islak != null ? kalib.islak : 0);
    const yuzde = kuru === islak ? 0
      : Math.max(0, Math.min(100, ((kuru - ham) / (kuru - islak)) * 100));
    const ton = 40 + (210 - 40) * (yuzde / 100);
    return { css: `hsl(${ton.toFixed(0)}, 62%, 52%)`, yuzde };
  },

  guncelle(o) {
    o.bosalt(o.grup);
    (o.veri.okumalar || []).forEach((k) => {
      const { css } = this.renk(o, k.toprak_nem);
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
      const { css } = this.renk(o, k.toprak_nem);
      c.beginPath(); c.arc(p.x, p.y, 6, 0, Math.PI * 2);
      c.fillStyle = css; c.globalAlpha = 0.85; c.fill(); c.globalAlpha = 1;
    });
  },

  vur(o, mm) {
    return (o.veri.okumalar || []).find((k) => Math.hypot(k.x - mm.x, k.y - mm.y) < 15) || null;
  },

  kart(o, k) {
    const { yuzde } = this.renk(o, k.toprak_nem);
    return `<div class="tarla-kart-bas"><div><b>Toprak nemi %${o.say(yuzde, 0)}</b>
      <div class="alt-not">ham ${o.say(k.toprak_nem, 0)} · X${o.say(k.x, 1)} Y${o.say(k.y, 1)}<br>
      ${new Date(k.ts * 1000).toLocaleString("tr-TR")}</div></div></div>`;
  },
});
