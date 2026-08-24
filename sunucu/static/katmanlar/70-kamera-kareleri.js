/* Kamera kareleri — fotoğraf, çekildiği koordinatta ve GERÇEK ölçeğinde.
 *
 * Ajan her kareye o anki eksen konumunu iliştiriyor; sunucu konumu dosya
 * adında saklıyor. Konumsuz eski kareler haritada görünmüyor (yerleri
 * bilinmiyor), ama İzle sekmesindeki kamera kartında görünmeye devam
 * ediyorlar.
 *
 * KALİBRASYON
 * -----------
 * `/api/kamera/kalibrasyon` dört sayı veriyor: bir piksel kaç mm, kameranın
 * makine eksenine göre açısı ve kamera merkezinin uç ucundan kayması. Bunlar
 * varsa kare haritaya ölçeklenip döndürülerek oturuyor. Yoksa (mm_px = 0)
 * eski davranış: yalnızca küçük bir objektif işareti — yanlış ölçekli bir
 * fotoğrafı doğruymuş gibi göstermektense hiç göstermemek daha dürüst.
 *
 * Görüntüler `Image` olarak bir kez yükleniyor ve saklanıyor; her karede
 * yeniden indirmek Pi'nin ağını da tarayıcıyı da boşuna yoruyor.
 */
Tarla.katman({
  kimlik: "kareler",
  ad: "Kamera kareleri",
  varsayilan: false,

  konumlu(o) {
    return (o.veri.kareler || []).filter((k) => k.x != null && k.y != null);
  },

  /** Kalibrasyon değerleri — yoksa null. */
  kalib(o) {
    const k = o.veri.kalibrasyon;
    return k && Number(k.mm_px) > 0 ? k : null;
  },

  kareAdresi(k) {
    const jeton = (window.Panel && Panel.S && Panel.S.jeton) || "";
    return `/api/kare/${encodeURIComponent(k.damga)}?jeton=${encodeURIComponent(jeton)}`;
  },

  /** Görüntüyü bir kez yükleyip saklıyor; yüklenince haritayı tazeliyor. */
  gorsel(o, k) {
    this._resim = this._resim || {};
    let im = this._resim[k.damga];
    if (!im) {
      im = new Image();
      im.onload = () => o.tazele();
      im.src = this.kareAdresi(k);
      this._resim[k.damga] = im;
    }
    return im.complete && im.naturalWidth ? im : null;
  },

  /** Karenin haritadaki merkezi (mm) — kamera uç ucundan kaymış olabilir. */
  merkez(k, kal) {
    return { x: k.x + (kal ? Number(kal.ofset_x) || 0 : 0),
             y: k.y + (kal ? Number(kal.ofset_y) || 0 : 0) };
  },

  /** Karenin mm cinsinden ölçüsü. */
  olcu(kal) {
    const mm = Number(kal.mm_px);
    return { en: (Number(kal.genislik_px) || 640) * mm,
             boy: (Number(kal.yukseklik_px) || 480) * mm };
  },

  guncelle(o) {
    o.bosalt(o.grup);
    const kal = this.kalib(o);
    const mal = new o.THREE.MeshBasicMaterial({ color: "#3987e5", side: o.THREE.DoubleSide });

    this.konumlu(o).forEach((k) => {
      const m = this.merkez(k, kal);
      const g = new o.THREE.Group();

      if (kal) {
        // Kalibre: fotoğrafı yer düzlemine doku olarak seriyoruz.
        const im = this.gorsel(o, k);
        if (im) {
          const ol = this.olcu(kal);
          const doku = new o.THREE.CanvasTexture(im);
          const duzlem = new o.THREE.Mesh(
            new o.THREE.PlaneGeometry(ol.en * o.MM, ol.boy * o.MM),
            new o.THREE.MeshBasicMaterial({ map: doku, transparent: true, opacity: 0.9,
                                            side: o.THREE.DoubleSide, depthWrite: false }));
          duzlem.rotation.x = -Math.PI / 2;
          // Makine Y'si sahne z'si; görüntü döndürme sahne y ekseni etrafında.
          duzlem.rotation.z = (Number(kal.donme) || 0) * Math.PI / 180;
          duzlem.scale.set(kal.ayna_x ? -1 : 1, kal.ayna_y ? -1 : 1, 1);
          duzlem.position.y = 0.003;
          duzlem.raycast = () => {};
          g.add(duzlem);
        }
      }

      // Objektif işareti her hâlükârda: kareye tıklamanın hedefi bu.
      const halka = new o.THREE.Mesh(new o.THREE.RingGeometry(0.009, 0.013, 16), mal);
      halka.rotation.x = -Math.PI / 2;
      halka.position.y = 0.007;
      g.add(halka);
      const nokta = new o.THREE.Mesh(new o.THREE.CircleGeometry(0.004, 12), mal);
      nokta.rotation.x = -Math.PI / 2;
      nokta.position.y = 0.007;
      g.add(nokta);

      g.position.set(o.sx(m.x), 0, o.sz(m.y));
      o.grup.add(g);
    });
  },

  ciz2b(o, c) {
    const kal = this.kalib(o);
    this.konumlu(o).forEach((k) => {
      const m = this.merkez(k, kal);
      const p = o.mm2b(m.x, m.y);

      if (kal) {
        const im = this.gorsel(o, k);
        const ol = this.olcu(kal);
        const M = o.haritaMatris();
        c.save();
        c.translate(p.x, p.y);
        // mm uzayına geçiyoruz: haritanın döndürmesi, sıfır köşesi ve ölçeği
        // bu matriste. Kutunun içinde artık milimetre ile çiziyoruz, harita
        // ayarlarını bilmemize gerek yok.
        c.transform(M.a, M.b, M.c, M.d, 0, 0);
        c.rotate((Number(kal.donme) || 0) * Math.PI / 180);
        c.scale(kal.ayna_x ? -1 : 1, kal.ayna_y ? -1 : 1);
        if (im) {
          c.globalAlpha = 0.85;
          c.drawImage(im, -ol.en / 2, -ol.boy / 2, ol.en, ol.boy);
          c.globalAlpha = 1;
        }
        c.strokeStyle = "#3987e5";
        c.lineWidth = 1 / o.olcek2b;      // çizgi kalınlığı mm uzayında ölçekleniyor
        c.strokeRect(-ol.en / 2, -ol.boy / 2, ol.en, ol.boy);
        c.restore();
      }

      c.strokeStyle = "#3987e5"; c.lineWidth = 1.5;
      c.beginPath(); c.arc(p.x, p.y, 6, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#3987e5";
      c.beginPath(); c.arc(p.x, p.y, 2, 0, Math.PI * 2); c.fill();
    });
  },

  vur(o, mm) {
    const kal = this.kalib(o);
    return this.konumlu(o).find((k) => {
      const m = this.merkez(k, kal);
      return Math.hypot(m.x - mm.x, m.y - mm.y) < 15;
    }) || null;
  },

  kart(o, k) {
    const kal = this.kalib(o);
    const ol = kal ? this.olcu(kal) : null;
    return `<div class="tarla-kart-bas"><div><b>Kamera karesi</b>
      <div class="alt-not">X${o.say(k.x, 0)} Y${o.say(k.y, 0)} ·
      ${new Date(k.ts * 1000).toLocaleString("tr-TR")}</div>
      <div class="alt-not">${ol
        ? `haritada ${o.say(ol.en, 0)} × ${o.say(ol.boy, 0)} mm · ${o.say(kal.donme, 1)}°`
        : "kalibre edilmedi — yalnız konumu biliniyor"}</div>
      </div></div>
      <img class="kare-onizleme" alt="Kamera karesi" src="${this.kareAdresi(k)}">`;
  },
});
