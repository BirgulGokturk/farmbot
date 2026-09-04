/* Kamera kareleri — fotoğraf, çekildiği yerde ve GERÇEK ölçeğinde.
 *
 * İki tür kare var ve ikisi de haritaya oturuyor:
 *
 *   UÇ KAMERASI (hareketli). Ajan her kareye o anki eksen konumunu
 *   iliştiriyor; sunucu konumu dosya adında saklıyor. Konumsuz eski
 *   kareler haritada görünmüyor (yerleri bilinmiyor), İzle sekmesindeki
 *   kamera kartında görünmeye devam ediyorlar.
 *
 *   ÜST KAMERA (sabit). Karesinin makine konumu YOK ve olmayacak da —
 *   kamera makineyle gitmiyor. Eskiden bu yüzden haritada hiç
 *   görünmüyordu. AprilTag kalibrasyonu yatağa yapıştırılmış etiketlerin
 *   MAKİNE koordinatlarından bir harita çıkarıyor; o harita doğrudan
 *   "bu piksel yatağın şurası" diyor ve karenin bir konumu olmasına
 *   gerek kalmıyor.
 *
 * İKİ MODEL
 * ---------
 *   harita (3x3 homografi)  — varsa bu. Perspektifi de taşıyor: kamera
 *     yatağa eğik bakıyor ve sahada ölçüldü, ölçek+dönme modeli 52 mm,
 *     harita 9 mm yanılıyordu. Kare haritada DİKDÖRTGEN DEĞİL, yamuk.
 *   mm_px + donme + ofset   — harita yoksa eski davranış, aynen.
 *
 * Hesabın sunucudaki eşi `tespit.py` içinde ve İKİSİ AYNI OLMALI: panelde
 * çizilen kare ile sunucunun "bu leke şurada" dediği yer ayrışırsa,
 * hangisinin doğru olduğunu anlamanın yolu yok.
 *
 * KALİBRASYON KARENİN KENDİ KAMERASINDAN. Uç kamerasının mm/px'ini üst
 * kameranın karesine uygulamak ölçüyü kat kat yanlış yapar ve yanlış
 * olduğu belli olmaz — sonuç yine "milimetre" diye görünür.
 *
 * Görüntüler `Image` olarak bir kez yükleniyor ve saklanıyor; her karede
 * yeniden indirmek Pi'nin ağını da tarayıcıyı da boşuna yoruyor.
 */
Tarla.katman({
  kimlik: "kareler",
  ad: "Kamera kareleri",
  varsayilan: false,

  /** Karenin kendi kamerasının kalibrasyonu — yoksa null. */
  kalib(o, k) {
    const hepsi = (o.veri.kalibrasyonlar) || {};
    const kk = hepsi[k && k.kamera ? k.kamera : "uc"]
      || (k && (k.kamera || "uc") === "uc" ? o.veri.kalibrasyon : null);
    if (!kk) return null;
    return (kk.harita || Number(kk.mm_px) > 0) ? kk : null;
  },

  /** Harita bu kareye uygulanabiliyor mu — `tespit.haritali_mi` ile aynı kural. */
  haritali(kal, k) {
    if (!kal || !kal.harita) return false;
    const mx = kal.harita_makine_x, my = kal.harita_makine_y;
    if (mx == null || my == null) return true;          // mutlak (sabit kamera)
    return k && k.x != null && k.y != null;             // hareketli: kaydırma gerekli
  },

  /** Haritanın bu kare için kayması (mm). */
  kayma(kal, k) {
    const mx = kal.harita_makine_x, my = kal.harita_makine_y;
    if (mx == null || my == null) return { x: 0, y: 0 };
    return { x: Number(k.x) - Number(mx), y: Number(k.y) - Number(my) };
  },

  /** Bir pikselin makine koordinatı. Harita varsa ondan, yoksa ölçek+dönme. */
  pikselMm(kal, k, u, v) {
    if (this.haritali(kal, k)) {
      const H = kal.harita;
      const p = H[2][0] * u + H[2][1] * v + H[2][2];
      if (Math.abs(p) < 1e-12) return null;
      const d = this.kayma(kal, k);
      return { x: (H[0][0] * u + H[0][1] * v + H[0][2]) / p + d.x,
               y: (H[1][0] * u + H[1][1] * v + H[1][2]) / p + d.y };
    }
    const mm = Number(kal.mm_px) || 0;
    const W = Number(kal.genislik_px) || 640;
    const Y = Number(kal.yukseklik_px) || 480;
    let lx = (u - W / 2) * mm;
    let ly = (v - Y / 2) * mm;
    if (kal.ayna_x) lx = -lx;
    if (kal.ayna_y) ly = -ly;
    const a = (Number(kal.donme) || 0) * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const m = this.merkez(k, kal);
    return { x: m.x + lx * c - ly * s, y: m.y + lx * s + ly * c };
  },

  /** Haritada görünecek kareler.
   *
   * Konumu olan her kare (uç kamerası) ve mutlak haritayla kalibre edilmiş
   * her kare (sabit üst kamera). Kalibrasyonu olmayan kameranın karesi
   * yalnız objektif işaretiyle duruyor — yanlış ölçekli bir fotoğrafı
   * doğruymuş gibi göstermektense hiç göstermemek daha dürüst. */
  konumlu(o) {
    return (o.veri.kareler || []).filter((k) => {
      if (k.x != null && k.y != null) return true;
      return this.haritali(this.kalib(o, k), k);
    });
  },

  kareAdresi(k) {
    const jeton = (window.Panel && Panel.S && Panel.S.jeton) || "";
    // Kamera adı AÇIKÇA yazılıyor: kareler kamera başına ayrı saklanıyor
    // ve iki kamera aynı saniyeye denk gelen damgalar üretebiliyor.
    const kam = encodeURIComponent(k.kamera || "uc");
    return `/api/kare/${encodeURIComponent(k.damga)}`
      + `?kamera=${kam}&jeton=${encodeURIComponent(jeton)}`;
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

  /** Karenin haritadaki merkezi (mm). */
  merkez(k, kal) {
    if (this.haritali(kal, k)) {
      const W = Number(kal.genislik_px) || 640;
      const Y = Number(kal.yukseklik_px) || 480;
      const p = this.pikselMm(kal, k, W / 2, Y / 2);
      if (p) return p;
    }
    return { x: (k.x || 0) + (kal ? Number(kal.ofset_x) || 0 : 0),
             y: (k.y || 0) + (kal ? Number(kal.ofset_y) || 0 : 0) };
  },

  /** Karenin mm cinsinden ölçüsü (ölçek+dönme modeli). */
  olcu(kal) {
    const mm = Number(kal.mm_px);
    return { en: (Number(kal.genislik_px) || 640) * mm,
             boy: (Number(kal.yukseklik_px) || 480) * mm };
  },

  /** Karenin dört köşesi (mm) — sol üstten saat yönünde. */
  koseler(kal, k) {
    const W = Number(kal.genislik_px) || 640;
    const Y = Number(kal.yukseklik_px) || 480;
    return [[0, 0], [W, 0], [W, Y], [0, Y]]
      .map(([u, v]) => this.pikselMm(kal, k, u, v));
  },

  /* ------------------------------------------------------------- 3B */

  /** Haritalı kareyi perspektifle seriyor.
   *
   * Düz bir dikdörtgen döndürmek yetmiyor: homografi kareyi yamuğa
   * çeviriyor ve dört köşe arasındaki değişim doğrusal değil. Bölünmüş
   * bir ızgaranın HER düğümünü haritadan geçiriyoruz; ara noktalar da
   * yerine oturuyor ve dokunun içi kaymıyor.
   *
   * Izgara 12x12: 169 düğüm, göz kararı bir sınır — 4x4'te uzak kenarda
   * kayma görünüyor, 32x32 boşuna köşe.
   */
  haritaliDuzlem(o, k, kal, im) {
    const B = 12;
    const W = Number(kal.genislik_px) || 640;
    const Y = Number(kal.yukseklik_px) || 480;
    const geo = new o.THREE.PlaneGeometry(1, 1, B, B);
    const dizi = geo.attributes.position.array;
    for (let i = 0; i < dizi.length; i += 3) {
      // PlaneGeometry -0.5..0.5 aralığında; piksele açıp haritadan geçiyoruz.
      const u = (dizi[i] + 0.5) * W;
      const v = (0.5 - dizi[i + 1]) * Y;      // düzlemin y'si yukarı, pikselin aşağı
      const p = this.pikselMm(kal, k, u, v);
      if (!p) return null;
      // Düzlem yer düzlemine yatırılacağı için (rotation.x = -90°) sahne
      // x'i makine x'i, düzlemin y'si sahne z'sinin TERSİ oluyor.
      dizi[i] = o.sx(p.x);
      dizi[i + 1] = -o.sz(p.y);
      dizi[i + 2] = 0;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
    const mesh = new o.THREE.Mesh(geo, new o.THREE.MeshBasicMaterial({
      map: new o.THREE.CanvasTexture(im), transparent: true, opacity: 0.9,
      side: o.THREE.DoubleSide, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.003;
    mesh.raycast = () => {};
    return mesh;
  },

  guncelle(o) {
    o.bosalt(o.grup);
    const mal = new o.THREE.MeshBasicMaterial({ color: "#3987e5", side: o.THREE.DoubleSide });

    this.konumlu(o).forEach((k) => {
      const kal = this.kalib(o, k);
      const m = this.merkez(k, kal);
      const g = new o.THREE.Group();

      if (kal) {
        const im = this.gorsel(o, k);
        if (im && this.haritali(kal, k)) {
          // Perspektifli: düzlem KENDİ konumunu taşıyor, grubun içinde
          // değil — köşeleri zaten mutlak makine koordinatında.
          const d = this.haritaliDuzlem(o, k, kal, im);
          if (d) o.grup.add(d);
        } else if (im && Number(kal.mm_px) > 0) {
          // Kalibre: fotoğrafı yer düzlemine doku olarak seriyoruz.
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

  /* ------------------------------------------------------------- 2B */

  /** Haritalı kareyi 2B tuvale seriyor.
   *
   * Canvas 2D perspektif dönüşümü bilmiyor; yalnız afin. Kareyi küçük
   * hücrelere bölüp HER hücreyi kendi afin dönüşümüyle çiziyoruz —
   * hücre küçüldükçe perspektif hatası gözle görülmez oluyor. Hücre
   * kenarlarında saç teli kadar boşluk kalmasın diye her hücre yarım
   * piksel taşırılıyor.
   */
  haritaliCiz2b(o, c, k, kal, im) {
    const B = 10;
    const W = im.naturalWidth, Y = im.naturalHeight;
    const hW = W / B, hY = Y / B;
    for (let i = 0; i < B; i++) {
      for (let j = 0; j < B; j++) {
        const u0 = i * hW, v0 = j * hY;
        // Hücrenin üç köşesi afin dönüşümü tam belirliyor.
        const kW = Number(kal.genislik_px) || W;
        const kY = Number(kal.yukseklik_px) || Y;
        const sx = kW / W, sy = kY / Y;
        const P = (u, v) => {
          const p = this.pikselMm(kal, k, u * sx, v * sy);
          return p ? o.mm2b(p.x, p.y) : null;
        };
        const a = P(u0, v0), b = P(u0 + hW, v0), d = P(u0, v0 + hY);
        if (!a || !b || !d) continue;
        c.save();
        c.beginPath();
        const e = P(u0 + hW, v0 + hY);
        if (!e) { c.restore(); continue; }
        c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(e.x, e.y);
        c.lineTo(d.x, d.y); c.closePath();
        c.clip();
        c.transform((b.x - a.x) / hW, (b.y - a.y) / hW,
                    (d.x - a.x) / hY, (d.y - a.y) / hY, a.x, a.y);
        c.drawImage(im, u0 - 0.5, v0 - 0.5, hW + 1, hY + 1,
                    -0.5, -0.5, hW + 1, hY + 1);
        c.restore();
      }
    }
    // Kenar çizgisi: karenin yatağın neresine düştüğü, fotoğrafın içeriği
    // seçilmese de görünsün.
    const kose = this.koseler(kal, k).map((p) => p && o.mm2b(p.x, p.y));
    if (kose.every(Boolean)) {
      c.strokeStyle = "#3987e5"; c.lineWidth = 1.5;
      c.beginPath();
      kose.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath(); c.stroke();
    }
  },

  ciz2b(o, c) {
    this.konumlu(o).forEach((k) => {
      const kal = this.kalib(o, k);
      const m = this.merkez(k, kal);
      const p = o.mm2b(m.x, m.y);

      if (kal) {
        const im = this.gorsel(o, k);
        if (this.haritali(kal, k)) {
          if (im) {
            c.save();
            c.globalAlpha = 0.85;
            this.haritaliCiz2b(o, c, k, kal, im);
            c.globalAlpha = 1;
            c.restore();
          }
        } else if (Number(kal.mm_px) > 0) {
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
      }

      c.strokeStyle = "#3987e5"; c.lineWidth = 1.5;
      c.beginPath(); c.arc(p.x, p.y, 6, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#3987e5";
      c.beginPath(); c.arc(p.x, p.y, 2, 0, Math.PI * 2); c.fill();
    });
  },

  vur(o, mm) {
    return this.konumlu(o).find((k) => {
      const m = this.merkez(k, this.kalib(o, k));
      return Math.hypot(m.x - mm.x, m.y - mm.y) < 15;
    }) || null;
  },

  kart(o, k) {
    const kal = this.kalib(o, k);
    const haritali = this.haritali(kal, k);
    let olcuYazi = "kalibre edilmedi — yalnız konumu biliniyor";
    if (haritali) {
      const kose = this.koseler(kal, k);
      const xs = kose.map((p) => p.x), ys = kose.map((p) => p.y);
      const sapma = Number(kal.harita_sapma_mm);
      olcuYazi = `harita · ${o.say(Math.max(...xs) - Math.min(...xs), 0)} × `
        + `${o.say(Math.max(...ys) - Math.min(...ys), 0)} mm`
        + (Number.isFinite(sapma) ? ` · ±${sapma.toFixed(1)} mm` : "");
    } else if (kal && Number(kal.mm_px) > 0) {
      const ol = this.olcu(kal);
      olcuYazi = `haritada ${o.say(ol.en, 0)} × ${o.say(ol.boy, 0)} mm · `
        + `${o.say(kal.donme, 1)}°`;
    }
    // KONUM SATIRI DÜRÜST OLMALI. Sabit kameranın karesinin makine konumu
    // yok; "X0 Y0" yazmak, kareyi yatağın köşesinde çekilmiş gibi gösterir.
    const konum = (k.x != null && k.y != null)
      ? `X${o.say(k.x, 0)} Y${o.say(k.y, 0)}`
      : "sabit kamera — konumu haritadan";
    return `<div class="tarla-kart-bas"><div><b>Kamera karesi</b>
      <div class="alt-not">${konum} ·
      ${new Date(k.ts * 1000).toLocaleString("tr-TR")}</div>
      <div class="alt-not">${olcuYazi}</div>
      </div></div>
      <img class="kare-onizleme" alt="Kamera karesi" src="${this.kareAdresi(k)}">`;
  },
});
