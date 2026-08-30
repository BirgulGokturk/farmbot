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
    const sbi = (o.veri.durum.uc && o.veri.durum.uc.sulama_basligi) || {};
    const imza = `${w}|${d}|${rayY}|${sbi.dx}|${sbi.dy}`;

    // Katman kapatılınca çekirdek grubu boşaltıp geometriyi atıyor; grup
    // boşsa imza aynı olsa da yeniden kurmak gerekiyor.
    if (imza !== this._imza || !o.grup.children.length) {
      this._imza = imza;
      o.bosalt(o.grup);
      // Sulama başlığının ofseti uclar.json'dan; sulama hesabıyla AYNI
      // sayı. Ayrı yazsaydık sahnede su bir yere, gerçekte başka yere
      // düşerdi ve hangisinin doğru olduğu anlaşılmazdı.
      const sb = (o.veri.durum.uc && o.veri.durum.uc.sulama_basligi) || {};
      const makine = window.FarmbotMakine.kur(o.THREE, {
        w: w, d: d, rayY: rayY, parca: "hareketli",
        sulamaOfset: { dx: Number(sb.dx) || 0, dy: Number(sb.dy) || 0 },
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
    //
    // Toprak yüzeyi makine Z'sinde SIFIR DEĞİL: toprak kabın içinde ve
    // yüzey sıfırdan yukarıda. `toprak_z` çıkarılmazsa uç, sahnede toprağın
    // metrelerce altına iniyormuş gibi görünüyordu. Artık makine Z'si
    // toprak_z'ye eşitken uç tam yüzeye değiyor.
    const toprakZ = Number(o.veri.durum.toprak_z) || 0;
    const ucY = o.kis(z - toprakZ, 0, (o.sinir.z.max || 550) - toprakZ) * MM;
    p.ucKafa.position.set(0, ucY + 0.04, 0);
    // Z kılavuzu birim yükseklikte kuruluyor, stroka göre uzatılıyor.
    const boy = Math.max(0.05, rayY - 0.045 - (ucY + 0.08));
    p.sutun.scale.y = boy;
    p.sutun.position.set(0, ucY + 0.08 + boy / 2, 0);

    /* SU HUZMESİ. Kaynak tek: kartın bildirdiği röle durumu (`r_su_pompasi`).
     * Panel kendi tahminini tutmuyor — "sulama komutu gönderdim, demek ki
     * akıyordur" demek, pompa gerçekte çalışmadığında sahnede su gösterirdi
     * ve bu, olmayan bir şeyi olmuş gibi göstermek olurdu.
     *
     * Huzme başlıktan TOPRAĞA kadar uzatılıyor: uç yükseldikçe boy artıyor.
     * Sabit boy, ya toprağın içine girerdi ya havada kalırdı. */
    if (p.su) {
      /* Röle durumu `durum` paketinde DEĞİL, ölçüm paketinde geliyor
       * (`r_su_pompasi`) ve onu app.js `S.roleDurum`da tutuyor. Buradan
       * okumamızın sebebi bu; `window.Panel` zaten tam bu iş için açılmış
       * bir köprü. Panel yoksa (deneme sayfası) su hiç görünmüyor —
       * olmayan bir şeyi varmış gibi göstermektense hiç göstermemek. */
      const P = window.Panel;
      const akiyor = !!(P && P.S && P.S.roleDurum && P.S.roleDurum.su_pompasi);
      p.su.visible = akiyor;
      /* Döngüyü SUYU GİZLEYEN kod kapatıyor.
       *
       * Önce kapanışı döngünün kendisine bırakmıştım ve sekme arka plandayken
       * `requestAnimationFrame` duraklıyor: kare hiç koşmuyor, tutamak null
       * olmuyor. Sonuç sessiz bir hata — su gizleniyor ama tutamak dolu
       * kaldığı için BİR SONRAKİ sulamada `_akisBasla` "zaten çalışıyor"
       * deyip çıkıyor ve su görünüyor ama akmıyordu. */
      if (!akiyor && this._akis) {
        cancelAnimationFrame(this._akis);
        this._akis = null;
      }
      if (akiyor) {
        const basY = p.ucKafa.userData.baslikY || 0;
        // Başlığın sahnedeki yüksekliği = uç kafasının yüksekliği + yerel ofset.
        const bas = ucY + 0.04 + basY;
        const yer = Math.max(0.01, bas);      // toprak yüzeyi y = 0
        p.su.scale.y = yer;
        p.su.position.y = basY - yer / 2;
        this._akisBasla(o);
      }
    }
  },

  /** Deneme yardımcısı — su huzmesinin o anki hâli.
   *
   * Sahnedeki bir nesnenin gerçekten çizildiğini gözle doğrulamak zor;
   * ekran görüntüsünde ince bir çizgi ile Z kılavuzu ayırt edilemiyor.
   * Katman durumunu sayı olarak soruyoruz. `katmanDurumu` ve
   * `dikimDurumu` de aynı sebeple var.
   */
  suDurumu() {
    const p = this._p;
    if (!p || !p.su) return { kuruldu: false };
    return {
      kuruldu: true,
      gorunur: p.su.visible,
      boy: +p.su.scale.y.toFixed(4),
      y: +p.su.position.y.toFixed(4),
      saydamlik: +p.su.material.opacity.toFixed(3),
      dongu: !!this._akis,
    };
  },

  /** Huzmeyi akar gösteren döngü.
   *
   * YALNIZ pompa açıkken dönüyor. Sürekli çizim Pi'nin GPU'sunda bedava
   * değil; su akmıyorken sahneyi her karede yeniden çizmenin karşılığı yok.
   * Döngü kendini kapatıyor: röle kapanınca bir sonraki karede duruyor.
   */
  _akisBasla(o) {
    if (this._akis) return;
    const adim = () => {
      const p = this._p;
      if (!p || !p.su) { this._akis = null; return; }
      /* Pompayı BURADA da soruyoruz. `guncelle` yalnız durum paketi
       * geldiğinde koşuyor; huzmeyi ona bırakırsak pompa kapandıktan
       * sonra bir sonraki pakete kadar su akmaya devam eder. Kapanışın
       * gecikmesi, açılışın gecikmesinden daha yanıltıcı. */
      const P = window.Panel;
      const akiyor = !!(P && P.S && P.S.roleDurum && P.S.roleDurum.su_pompasi);
      if (!akiyor) {
        p.su.visible = false;
        if (o.kirlet) o.kirlet("su-akisi-bitti");
        this._akis = null;
        return;
      }
      // Damla izlenimi: çapı ve saydamlığı hafifçe nabız gibi değiştiriyoruz.
      const t = (this._faz = (this._faz || 0) + 0.16);
      p.su.material.opacity = 0.34 + 0.12 * Math.sin(t);
      p.su.scale.x = p.su.scale.z = 1 + 0.08 * Math.sin(t * 1.7);
      o.kirlet && o.kirlet("su-akisi");
      this._akis = requestAnimationFrame(adim);
    };
    this._akis = requestAnimationFrame(adim);
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
