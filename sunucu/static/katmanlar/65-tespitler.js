/* Görüntü tespitleri — bulunan bitki lekeleri, GERÇEK koordinatlarında.
 *
 * Veri `/api/goruntu/coz`dan geliyor ve bu katman onu KENDİSİ çekiyor.
 * Ortak veri havuzuna (tarla.js) girmiyor bilerek: çözümleme kullanıcı
 * istediğinde çalışan bir işlem, her durum paketinde değil. Kamera
 * kareleri katmanı da görüntülerini böyle kendi alıyor.
 *
 * ÜÇ AYRI ŞEY, ÜÇ AYRI RENK:
 *
 *   yeşil   eşleşen    — yanında kayıtlı bitki var, o bitki yaşıyor
 *   turuncu yabani aday— hiçbir kayıtlı bitkiye yakın değil
 *   kırmızı görünmeyen — karenin içinde olması gereken ama bulunamayan
 *                        kayıtlı bitki
 *
 * "Yabani ot" DEĞİL, "yabani ot ADAYI". Yosun, düşmüş yaprak, gölge ya
 * da kaydedilmemiş bir bitki de olabilir; bu katman hiçbir şeyi
 * otomatik silmiyor ve hiçbir şeye ilaç atmıyor. Gördüğünü söylüyor.
 *
 * "Görünmeyen" de "öldü" demiyor: henüz çimlenmemiş olabilir, kare onu
 * kaçırmış olabilir, yaprak toprağa yatmış olabilir.
 */
Tarla.katman({
  kimlik: "tespitler",
  ad: "Görüntü tespitleri",
  varsayilan: false,

  /** Son çözümleme. Panel `Tarla.tespitYaz(...)` ile buraya veriyor. */
  veri() {
    return (window.Tarla && Tarla._tespitVeri) || null;
  },

  renkler: {
    eslesen: "#5ad07a",
    yabani: "#e8a33d",
    gorunmeyen: "#e2564a",
    kare: "#3987e5",
  },

  /** Çizilecek her şey tek listede — 3B ve 2B aynı kaynaktan okusun. */
  ogeler(o) {
    const v = this.veri();
    if (!v) return [];
    const c = [];
    (v.eslesen || []).forEach((e) => c.push({
      tur: "eslesen", ad: e.ad, ...e.leke, bitki: e,
    }));
    (v.yabani_aday || []).forEach((b) => c.push({
      tur: "yabani", ad: "", ...b,
    }));
    (v.gorunmeyen || []).forEach((b) => c.push({
      tur: "gorunmeyen", ad: b.ad, x: b.x, y: b.y, cap_mm: 0, bitki: b,
    }));
    return c;
  },

  guncelle(o) {
    o.bosalt(o.grup);
    const v = this.veri();
    if (!v) return;

    // Çözümlenen karenin sınırı: tespitlerin nereye bakılarak
    // bulunduğunu göstermeden, bulunmayanın neden bulunmadığı anlaşılmaz.
    if (v.kare_mm) {
      const k = v.kare_mm;
      const cerceve = new o.THREE.LineSegments(
        new o.THREE.EdgesGeometry(
          new o.THREE.PlaneGeometry(k.en * o.MM, k.boy * o.MM)),
        new o.THREE.LineBasicMaterial({ color: this.renkler.kare }));
      cerceve.rotation.x = -Math.PI / 2;
      cerceve.rotation.z = (Number(k.donme) || 0) * Math.PI / 180;
      cerceve.position.set(o.sx(k.x), 0.004, o.sz(k.y));
      cerceve.raycast = () => {};
      o.grup.add(cerceve);
    }

    this.ogeler(o).forEach((t) => {
      const renk = this.renkler[t.tur];
      const g = new o.THREE.Group();

      if (t.tur === "gorunmeyen") {
        // Bulunamayan bitki: içi boş küçük çarpı. Halka çizseydik
        // bulunmuş bir lekeden ayırt edilemezdi.
        const mal = new o.THREE.LineBasicMaterial({ color: renk });
        const r = 0.012;
        [[[-r, 0, -r], [r, 0, r]], [[-r, 0, r], [r, 0, -r]]].forEach((uc) => {
          const geo = new o.THREE.BufferGeometry().setFromPoints(
            uc.map((p) => new o.THREE.Vector3(p[0], 0.006, p[2])));
          g.add(new o.THREE.Line(geo, mal));
        });
      } else {
        // Lekenin GERÇEK ölçüsünde halka: haritaya bakıp "bu bitki ne
        // kadar büyümüş" sorusu gözle cevaplanabilsin.
        const r = Math.max(0.004, (Number(t.cap_mm) || 8) / 2 * o.MM);
        const halka = new o.THREE.Mesh(
          new o.THREE.RingGeometry(r * 0.82, r, 24),
          new o.THREE.MeshBasicMaterial({ color: renk, side: o.THREE.DoubleSide,
                                          transparent: true, opacity: 0.9 }));
        halka.rotation.x = -Math.PI / 2;
        halka.position.y = 0.006;
        g.add(halka);
        const nokta = new o.THREE.Mesh(
          new o.THREE.CircleGeometry(0.0025, 10),
          new o.THREE.MeshBasicMaterial({ color: renk }));
        nokta.rotation.x = -Math.PI / 2;
        nokta.position.y = 0.0065;
        g.add(nokta);
      }

      g.position.set(o.sx(t.x), 0, o.sz(t.y));
      g.traverse((n) => { n.userData.tespit = t; });
      o.grup.add(g);
    });
  },

  ciz2b(o, c) {
    const v = this.veri();
    if (!v) return;

    if (v.kare_mm) {
      const k = v.kare_mm;
      const p = o.mm2b(k.x, k.y);
      const M = o.haritaMatris();
      c.save();
      c.translate(p.x, p.y);
      c.transform(M.a, M.b, M.c, M.d, 0, 0);
      c.rotate((Number(k.donme) || 0) * Math.PI / 180);
      c.strokeStyle = this.renkler.kare;
      c.lineWidth = 1 / o.olcek2b;
      c.strokeRect(-k.en / 2, -k.boy / 2, k.en, k.boy);
      c.restore();
    }

    c.font = "10px ui-sans-serif, system-ui";
    this.ogeler(o).forEach((t) => {
      const p = o.mm2b(t.x, t.y);
      const renk = this.renkler[t.tur];
      c.strokeStyle = renk;
      c.lineWidth = 1.6;
      if (t.tur === "gorunmeyen") {
        c.beginPath();
        c.moveTo(p.x - 5, p.y - 5); c.lineTo(p.x + 5, p.y + 5);
        c.moveTo(p.x - 5, p.y + 5); c.lineTo(p.x + 5, p.y - 5);
        c.stroke();
      } else {
        // Yarıçap mm'den geliyor: 2B haritanın ölçeğiyle büyüyüp küçülüyor.
        const r = Math.max(3, (Number(t.cap_mm) || 8) / 2 * o.olcek2b);
        c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke();
      }
      if (t.ad) {
        c.fillStyle = renk;
        c.fillText(t.ad, p.x + 8, p.y + 3);
      }
    });
  },

  vur(o, mm) {
    let en_iyi = null, en_yakin = 25;
    this.ogeler(o).forEach((t) => {
      const d = Math.hypot(t.x - mm.x, t.y - mm.y);
      if (d < en_yakin) { en_yakin = d; en_iyi = t; }
    });
    return en_iyi;
  },

  kart(o, t) {
    const v = this.veri() || {};
    const say = (d, b = 0) => o.say(d, b);

    if (t.tur === "gorunmeyen") {
      return `<div class="tarla-kart-bas"><div><b>${o.kacisli(t.ad)}</b>
        <div class="alt-not">bulunamadı · X${say(t.x, 1)} Y${say(t.y, 1)}</div></div></div>
        <p class="alt-not">Bu bitki çözümlenen karenin içinde ama ona ait bir
        leke bulunamadı. <b>"Öldü" demek değil:</b> henüz çimlenmemiş olabilir,
        yaprakları toprağa yatmış olabilir, ya da eşik bu ışıkta yüksek
        kalmış olabilir. Eşiği düşürüp yeniden çözümleyin.</p>`;
    }

    const olcu = `<p class="alt-not">Çap <b>${say(t.cap_mm, 1)} mm</b> ·
      kutu ${say(t.en_mm, 1)}×${say(t.boy_mm, 1)} mm ·
      alan ${say(t.alan_mm2, 0)} mm²${
        t.dolgu != null ? ` · dolgu ${say(t.dolgu * 100, 0)}%` : ""}</p>`;

    if (t.tur === "eslesen") {
      const b = t.bitki || {};
      return `<div class="tarla-kart-bas"><div><b>${o.kacisli(t.ad)}</b>
        <div class="alt-not">eşleşen bitki · X${say(t.x, 1)} Y${say(t.y, 1)}</div></div></div>
        ${olcu}
        <p class="alt-not">Kayıtlı konumdan <b>${say(b.uzaklik_mm, 1)} mm</b>
        uzakta (${say(b.kayma_x, 1)}, ${say(b.kayma_y, 1)}). Bu kayma hep aynı
        yöne çıkıyorsa kalibrasyon ofseti şüphelidir.</p>
        <p class="alt-not">Çap ölçüsü alandan türüyor (dairesel eşdeğer);
        tek uzun bir yaprak kutuyu şişirir ama alanı şişirmez.</p>`;
    }

    return `<div class="tarla-kart-bas"><div><b>Yabani ot adayı</b>
      <div class="alt-not">X${say(t.x, 1)} Y${say(t.y, 1)}</div></div></div>
      ${olcu}
      <p class="alt-not">Yakınında kayıtlı bitki yok. <b>Kesin ot değil:</b>
      yosun, düşmüş yaprak, gölge ya da kaydetmediğiniz bir bitki olabilir.
      Dolgu oranı düşükse (dağınık leke) yosun ihtimali yüksek.</p>
      <p class="alt-not">Hiçbir işlem yapılmıyor — bu katman yalnız
      gördüğünü söylüyor.</p>`;
  },
});
