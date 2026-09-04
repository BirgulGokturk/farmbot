/* Sabit üst kameranın görüntüsü, yatağın üstüne serilmiş.
 *
 * NEDEN AYRI KATMAN. `70-kamera-kareleri.js` yalnız MAKİNE KONUMU OLAN
 * kareleri çiziyor — kare nereye gidildiğinde çekildiyse oraya. Sabit
 * kameranın böyle bir konumu yok (makineyle gitmiyor), o yüzden o
 * katmanın süzgecinden hiç geçemiyordu ve İzle sekmesinde üst kamera
 * hiçbir zaman görünmüyordu. Katmanı açmak da işe yaramıyordu, çünkü
 * eksik olan katman değil verinin kendisiydi.
 *
 * Sabit kameranın yatağın neresine baktığını AprilTag kalibrasyonu
 * söylüyor. Yani konum yok değil — başka yerde: karede değil,
 * kalibrasyonda.
 *
 * İKİ MODEL. Kalibrasyonda `harita` (perspektifli homografi) varsa
 * karenin dört köşesi tek tek milimetreye çevriliyor ve görüntü o
 * dörtgene seriliyor; kamera yatağa eğik baktığı için doğrusu bu.
 * Harita yoksa ölçek + dönme ile dikdörtgen olarak seriliyor.
 * Kalibrasyon hiç yoksa HİÇBİR ŞEY çizilmiyor: yanlış ölçekli bir
 * fotoğrafı doğruymuş gibi yatağa sermek, gözle yapılan her ölçümü
 * sessizce bozardı.
 */
Tarla.katman({
  kimlik: "ust-kamera",
  ad: "Üst kamera görüntüsü",
  /* AÇIK GELİYOR. Kapalı geliyordu ve kullanıcı bunu bulamadı: kamera
   * kutusunun "sahnede göster" düğmesine bastı, o düğme köşedeki yüzen
   * kutuyu açıyor, sahnedeki görüntüyü değil. İki ayrı denetim aynı işi
   * yapıyor sanıldı. Katman açık gelirse kalibrasyon biter bitmez
   * görüntü kendiliğinden yerine oturuyor. */
  varsayilan: true,

  /* --------------------------------------------------------- veri */

  /** Kalibrasyon ve kare, katman AÇIKKEN ve seyrek tazeleniyor.
   *
   * Katman kapalıyken hiç istek atmıyoruz: sabit kamera saatte bir kare
   * üretiyor olabilir ve kapalı bir katman için Pi'nin ağını meşgul
   * etmenin karşılığı yok. */
  veriAl(o) {
    const P = window.Panel;
    if (!P || !P.apiIste) return;
    const simdi = Date.now();
    if (this._istek || simdi - (this._sonIstek || 0) < 4000) return;
    this._istek = true;
    this._sonIstek = simdi;
    P.apiIste("/api/kamera/kalibrasyon?kamera=ust")
      .then((y) => {
        const k = y && y.kalibrasyon;
        const imza = k ? JSON.stringify([k.mm_px, k.donme, k.ofset_x, k.ofset_y,
                                         k.harita, k.guncelleme]) : "";
        if (imza !== this._kalibImza) {
          this._kalibImza = imza;
          this._kalib = k || null;
          o.tazele();
        }
      })
      .catch(() => { this._kalib = null; })
      .finally(() => { this._istek = false; });
  },

  /** Taze kare — adres damgayla değişiyor ki tarayıcı önbelleğe takılmasın. */
  gorsel(o) {
    const jeton = (window.Panel && Panel.S && Panel.S.jeton) || "";
    const simdi = Date.now();
    // 10 sn'de bir yeni kare: sabit kameranın sahnesi hızlı değişmiyor,
    // her çizimde yeniden indirmek boşuna.
    const kova = Math.floor(simdi / 10000);
    if (this._kova !== kova || !this._im) {
      this._kova = kova;
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => { this._im = im; o.tazele(); };
      im.onerror = () => { this._im = null; };
      im.src = `/api/kare/son?kamera=ust&t=${kova}`
        + `&jeton=${encodeURIComponent(jeton)}`;
    }
    return this._im && this._im.naturalWidth ? this._im : null;
  },

  /* ------------------------------------------------------ geometri */

  /** Karenin dört köşesinin makine koordinatı (mm) — yoksa null.
   *
   * Sıra: sol üst, sağ üst, sağ alt, sol alt (görüntü piksel uzayında). */
  koseler() {
    const k = this._kalib;
    if (!k) return null;
    const W = Number(k.genislik_px) || 640;
    const H = Number(k.yukseklik_px) || 480;

    const h = k.harita;
    if (h && h.length === 3) {
      const uygula = (u, v) => {
        const p = h[2][0] * u + h[2][1] * v + h[2][2];
        if (!p || !Number.isFinite(p)) return null;
        return { x: (h[0][0] * u + h[0][1] * v + h[0][2]) / p,
                 y: (h[1][0] * u + h[1][1] * v + h[1][2]) / p };
      };
      const c = [uygula(0, 0), uygula(W, 0), uygula(W, H), uygula(0, H)];
      return c.every(Boolean) ? c : null;
    }

    const mm = Number(k.mm_px);
    if (!(mm > 0)) return null;
    // Ölçek + dönme: kare, ofsetin etrafında dönmüş bir dikdörtgen.
    const ex = W * mm / 2, ey = H * mm / 2;
    const a = (Number(k.donme) || 0) * Math.PI / 180;
    const cs = Math.cos(a), sn = Math.sin(a);
    const ax = k.ayna_x ? -1 : 1, ay = k.ayna_y ? -1 : 1;
    const cx = Number(k.ofset_x) || 0, cy = Number(k.ofset_y) || 0;
    return [[-ex, -ey], [ex, -ey], [ex, ey], [-ex, ey]].map(([u, v]) => {
      const su = u * ax, sv = v * ay;
      return { x: cx + su * cs - sv * sn, y: cy + su * sn + sv * cs };
    });
  },

  /* --------------------------------------------------------- 3B */

  /** Neden çizilemediğini BİR KEZ söylüyor.
   *
   * Katman açıkken hiçbir şey çıkmıyorsa kullanıcının elinde tek bir
   * bilgi kalmıyordu: katmanı açtı, ekran değişmedi, sebep yok. Sessiz
   * başarısızlık, en pahalı hata türü — burada da öyle oldu.
   *
   * Bir kez, çünkü sahne saniyede birçok kez çiziliyor ve aynı satırı
   * günlüğe yığmak sebebi bulmayı daha da zorlaştırırdı. */
  sebepYaz(o, metin) {
    if (this._sebep === metin) return;
    this._sebep = metin;
    if (metin) o.gunluk(`Üst kamera görüntüsü çizilemiyor — ${metin}`, "uyari");
  },

  guncelle(o) {
    o.bosalt(o.grup);
    this.veriAl(o);
    if (!this._kalib) {
      this.sebepYaz(o, "kalibrasyon okunamadı (üst kamera tanımlı mı?)");
      return;
    }
    const k4 = this.koseler();
    if (!k4) {
      this.sebepYaz(o, "üst kamera kalibre edilmemiş. Kamera sekmesi → "
        + "'AprilTag ile kalibre et' ile en az iki etiketten kalibrasyon "
        + "kaydedin; kameranın yatağın neresine baktığı ancak ondan sonra "
        + "biliniyor.");
      return;
    }
    const im = this.gorsel(o);
    if (!im) {
      this.sebepYaz(o, "üst kameradan kare alınamadı (kamera açık mı?)");
      return;
    }
    this.sebepYaz(o, "");

    // DÖRT KÖŞEDEN İKİ ÜÇGEN. Homografi tam olarak bir dörtgen dönüşümü;
    // üçgen başına doğrusal enterpolasyon onu birebir vermiyor ama
    // aradaki fark, kalibrasyonun kendi hatasının çok altında kalıyor.
    // Buradaki iş görüntüyü DOĞRU YERE oturtmak; ölçüm zaten haritadan
    // geçen sayılarla yapılıyor.
    const p = k4.map((c) => [o.sx(c.x), 0.004, o.sz(c.y)]);
    const konum = new Float32Array([
      ...p[0], ...p[3], ...p[1],
      ...p[1], ...p[3], ...p[2],
    ]);
    const uv = new Float32Array([
      0, 1, 0, 0, 1, 1,
      1, 1, 0, 0, 1, 0,
    ]);
    const geo = new o.THREE.BufferGeometry();
    geo.setAttribute("position", new o.THREE.BufferAttribute(konum, 3));
    geo.setAttribute("uv", new o.THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();

    const doku = new o.THREE.CanvasTexture(im);
    const ag = new o.THREE.Mesh(geo, new o.THREE.MeshBasicMaterial({
      map: doku, transparent: true, opacity: 0.92,
      side: o.THREE.DoubleSide, depthWrite: false,
    }));
    ag.raycast = () => {};
    o.grup.add(ag);

    // Çerçeve: görüntünün nerede bitip yatağın nerede başladığı belli
    // olsun. Kalibrasyon kaymışsa ilk fark edilecek şey bu çizgi olur.
    const nokta = [...k4, k4[0]].map((c) =>
      new o.THREE.Vector3(o.sx(c.x), 0.005, o.sz(c.y)));
    o.grup.add(new o.THREE.Line(
      new o.THREE.BufferGeometry().setFromPoints(nokta),
      new o.THREE.LineBasicMaterial({ color: "#3987e5" })));
  },

  /* --------------------------------------------------------- 2B */

  ciz2b(o, c) {
    this.veriAl(o);
    const k4 = this.koseler();
    if (!k4) return;
    const im = this.gorsel(o);
    const n = k4.map((p) => o.mm2b(p.x, p.y));

    if (im) {
      // 2B'de üç köşeden çıkan AFFİN yaklaşım kullanılıyor: canvas'ın
      // `transform`u perspektif taşımıyor. Dördüncü köşede birkaç piksel
      // sapıyor; 2B görünüm zaten yerleşim içindir, ölçüm 3B'de ve
      // sayılarda yapılıyor.
      const W = im.naturalWidth || 1, H = im.naturalHeight || 1;
      const a = (n[1].x - n[0].x) / W, b = (n[1].y - n[0].y) / W;
      const cc = (n[3].x - n[0].x) / H, d = (n[3].y - n[0].y) / H;
      c.save();
      c.globalAlpha = 0.85;
      c.setTransform(a, b, cc, d, n[0].x, n[0].y);
      c.drawImage(im, 0, 0, W, H);
      c.restore();
    }

    c.save();
    c.strokeStyle = "#3987e5";
    c.lineWidth = 1;
    c.beginPath();
    n.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
    c.closePath();
    c.stroke();
    c.restore();
  },
});
