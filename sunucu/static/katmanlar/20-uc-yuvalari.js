/* Uç yuvaları, uç profili ve tohumluk.
 *
 * `durum.uc.tools_konum`, `durum.uc.tohumluk` ve `durum.uc.alan`dan
 * besleniyor. Alan AÇIKKEN içeride Z güvenlik kilidi devre dışı; bu yüzden
 * alan açıkken haritada da belirgin çiziliyor — kilit kapalıyken bunu
 * bilmemek tehlikeli.
 *
 * UÇLAR TOPRAĞIN ÜSTÜNDE DURMUYOR. Gerçek makinede yatağın yanında, ayrı
 * bir sigma profil var; uçlar onun üzerinde dizili ve tohumluk profilin en
 * ucunda. Eskiden yuvalar sahnede y = 0'a, yani toprak yüzeyine
 * oturuyordu: sahneye bakıp "uç şuraya gider" dediğimiz yer makinenin
 * gittiği yer değildi ve hata ayıklarken en çok yanıltan şey buydu.
 *
 * PROFİLİN KONUMU ELLE YAZILMIYOR. Uç koordinatları zaten `uclar.json`da,
 * tohumluk da ayarda; profil bu noktaların KAPSAYAN KUTUSUNDAN türüyor.
 * Böylece kullanıcı uçların yerini değiştirdiğinde profil kendiliğinden
 * onunla geliyor, ikinci bir yerde ölçü güncellemek gerekmiyor.
 */
Tarla.katman({
  kimlik: "uclar",
  ad: "Uç yuvaları",
  varsayilan: true,

  guncelle(o) {
    o.bosalt(o.grup);
    const uc = o.veri.durum.uc || {};
    const alan = uc.alan || {};
    const R = o.makine.renk;

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

    const yuvalar = uc.tools_konum || [];
    const tohumluk = (uc.tohumluk && uc.tohumluk.x != null) ? uc.tohumluk : null;
    if (!yuvalar.length && !tohumluk) return;

    /* Yuva modelinin yüksekliği: taban plakasının altından tanıtıcı
     * bandın üstüne. Profilin üstü buradan çıkıyor — `uclar.json`daki
     * `z` ucun KAVRAMA yüksekliği, yani modelin tepesine denk geliyor. */
    const YUVA_YUK = 0.056;
    const dayanaklar = yuvalar.map((t) => ({ x: t.x, y: t.y, z: t.z, yuva: t }));
    if (tohumluk) dayanaklar.push({ x: tohumluk.x, y: tohumluk.y, z: tohumluk.z, yuva: null });

    /* --- profil: dayanak noktalarının kapsayan kutusu ------------------- */
    const xs = dayanaklar.map((d) => d.x), ys = dayanaklar.map((d) => d.y);
    const xEn = Math.max(...xs) - Math.min(...xs);
    const yEn = Math.max(...ys) - Math.min(...ys);
    // Uçlar hangi eksen boyunca dizilmişse profil o eksende uzuyor.
    const uzunY = yEn >= xEn;
    // Uçların ucundan taşan pay: profil son yuvada bıçak gibi bitmiyor.
    const PAY = 40;
    const px1 = uzunY ? Math.min(...xs) : Math.min(...xs) - PAY;
    const px2 = uzunY ? Math.max(...xs) : Math.max(...xs) + PAY;
    const py1 = uzunY ? Math.min(...ys) - PAY : Math.min(...ys);
    const py2 = uzunY ? Math.max(...ys) + PAY : Math.max(...ys);
    // Genişliği tek bir yuvanın çapından: profil yuvayı taşıyacak kadar
    // geniş, ama yatağa taşacak kadar değil.
    const GENIS = 45;
    const enX = uzunY ? GENIS : (px2 - px1);
    const enY = uzunY ? (py2 - py1) : GENIS;
    const mx = uzunY ? (px1 + px2) / 2 : (px1 + px2) / 2;
    const my = uzunY ? (py1 + py2) / 2 : (py1 + py2) / 2;

    /* Profilin ÜST yüzeyi: en yüksek yuvanın tabanı. En yükseği (max)
     * alıyoruz ki hiçbir yuva havada asılı kalmasın; birkaç milimetre
     * alçak duran yuva profilin içine gömülüyor, o görünmüyor. */
    const ustZ = Math.max(...dayanaklar.map((d) => (Number(d.z) || 0) - YUVA_YUK * 1000));
    const ustY = o.sy(ustZ);
    // Profil kalınlığı sigma profil kenarından — makine.js'teki tek kaynak.
    const kalinlik = o.makine.profil * o.MM;

    const gövde = new o.THREE.Mesh(
      new o.THREE.BoxGeometry(enX * o.MM, kalinlik, enY * o.MM),
      o.malzeme(R.aluminyum, { metalness: 0.84, roughness: 0.34 }));
    gövde.position.set(o.sx(mx), ustY - kalinlik / 2, o.sz(my));
    gövde.raycast = () => {};
    o.grup.add(gövde);

    /* Profili taşıyan iki dikme.
     *
     * İki şey düzeltildi:
     *
     * 1. Malzeme. Koyu bloktu; makinede taşıyıcı olan HER ŞEY sigma
     *    profil, ayrı bir parça yok. Alüminyum ve fırçalı yüzey, geri
     *    kalan çerçeveyle aynı.
     *
     * 2. Boy. Zemine kadar iniyorlardı ve makinenin altında kendine ait
     *    bir ayak takımı varmış gibi duruyordu — öyle bir şey yok. Uç
     *    profili tezgâhın üst çerçevesine bağlı; dikme yalnız o çerçeve
     *    ile profil arasını kapatıyor.
     */
    const tablaY = o.makine.tabla * o.MM;
    const dikmeBoy = Math.max(0.01, ustY - kalinlik - tablaY);
    [-0.34, 0.34].forEach((k) => {
      const b = new o.THREE.Mesh(
        new o.THREE.BoxGeometry(kalinlik, dikmeBoy, kalinlik),
        o.malzeme(R.aluminyum, { metalness: 0.84, roughness: 0.34 }));
      b.position.set(
        o.sx(mx + (uzunY ? 0 : enX * k)), tablaY + dikmeBoy / 2,
        o.sz(my + (uzunY ? enY * k : 0)));
      b.raycast = () => {};
      o.grup.add(b);
    });

    // Yuva DÖRT parçadan kuruluyor. Tek bir turkuaz koni olarak çizildiğinde
    // sahnede plastik bardak gibi duruyordu: gerçek yuva koyu metal bir
    // tabana oturan bilezik, ucun kendisi de koyu gövdeli. Turkuaz artık
    // gövdenin tamamı değil, yalnızca üstteki tanıtıcı bant — böylece hem
    // metal gibi okunuyor hem uçlar birbirinden ayırt edilebiliyor.
    yuvalar.forEach((t) => {
      const g = new o.THREE.Group();

      /* TABAN PLAKASI YOK. Önce her yuvanın altına koyu bir plaka
       * konuyordu ve yuvalar sahnede kendi ayağı olan ayrı parçalar gibi
       * duruyordu; gerçekte uçlar doğrudan sigma profilin üstünde oturuyor,
       * altlarında hiçbir şey yok. Profil zaten taşıyıcı, ikinci bir
       * taşıyıcı çizmek makineyi olduğundan karmaşık gösteriyordu.
       */

      // ucun içine oturduğu bilezik — torus, çünkü açık silindirde
      // arka yüz sorunu çıkıyor ve kenar burada yuvarlak zaten
      const bilezik = new o.THREE.Mesh(
        new o.THREE.TorusGeometry(0.028, 0.005, 8, 22),
        o.malzeme(R.metal_koyu || "#33373c", { metalness: 0.8, roughness: 0.3 }));
      bilezik.rotation.x = -Math.PI / 2;
      bilezik.position.y = 0.012;
      g.add(bilezik);

      // ucun gövdesi — mat koyu, metal değil (plastik/eloksal gövde)
      const govde = new o.THREE.Mesh(
        new o.THREE.CylinderGeometry(0.021, 0.0235, 0.044, 18),
        o.malzeme(R.motor || "#17181b", { metalness: 0.2, roughness: 0.85 }));
      govde.position.y = 0.034;
      g.add(govde);

      // tanıtıcı bant — hangi uç olduğunu buradan okuyoruz
      const bant = new o.THREE.Mesh(
        new o.THREE.TorusGeometry(0.0215, 0.0035, 8, 20),
        o.malzeme(R.uc, { metalness: 0.35, roughness: 0.4 }));
      bant.rotation.x = -Math.PI / 2;
      bant.position.y = 0.05;
      g.add(bant);

      /* Y ARTIK SIFIR DEĞİL. Her yuva kendi `z`sinden geliyor: uçlar aynı
       * profilde de olsa gerçekte birkaç milimetre ayrışıyorlar ve o fark
       * uç değiştirmeyi ayıklarken önemli. */
      g.position.set(o.sx(t.x), o.sy((Number(t.z) || 0) - YUVA_YUK * 1000), o.sz(t.y));
      g.traverse((n) => { n.userData.yuva = t; });
      o.grup.add(g);
    });

    /* --- tohumluk: profilin ucundaki delikli blok ----------------------- */
    if (tohumluk) {
      // Sütun sayısı 3'ten 2'ye indiği için genişlik de daraldı;
      // yoksa delikler tepsinin ortasında seyrek kalıyordu.
      const TB_EN = 0.055, TB_BOY = 0.13, TB_YUK = 0.035;
      const g = new o.THREE.Group();
      const blok = new o.THREE.Mesh(
        new o.THREE.BoxGeometry(TB_EN, TB_YUK, TB_BOY),
        o.malzeme("#1b1d21", { metalness: 0.15, roughness: 0.9 }));
      blok.position.y = TB_YUK / 2;
      g.add(blok);
      /* Delikler TEK bir örneklenmiş ağ: 12 delik = 12 çizim çağrısı
       * olurdu, InstancedMesh ile bir tane. Pi'de çizim çağrısı sayısı
       * üçgen sayısından daha çok yakıyor. */
      // Gerçek tepside 4 satır × 2 sütun delik var (fotoğraf).
      const sutun = 2, satir = 4, adet = sutun * satir;
      const delik = new o.THREE.InstancedMesh(
        new o.THREE.CylinderGeometry(0.0092, 0.0092, 0.02, 12),
        o.malzeme("#0a0b0d", { metalness: 0.1, roughness: 1 }), adet);
      const gecici = new o.THREE.Object3D();
      let i = 0;
      for (let r = 0; r < satir; r++) {
        for (let c = 0; c < sutun; c++) {
          gecici.position.set(
            (c - (sutun - 1) / 2) * (TB_EN / sutun),
            TB_YUK - 0.009,
            (r - (satir - 1) / 2) * (TB_BOY / satir));
          gecici.updateMatrix();
          delik.setMatrixAt(i++, gecici.matrix);
        }
      }
      delik.instanceMatrix.needsUpdate = true;
      g.add(delik);
      g.position.set(o.sx(tohumluk.x), o.sy(Number(tohumluk.z) || 0), o.sz(tohumluk.y));
      g.traverse((n) => { n.userData.tohumluk = tohumluk; });
      o.grup.add(g);
    }
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
    const th = uc.tohumluk;
    if (th && th.x != null) {
      const p = o.mm2b(th.x, th.y);
      c.fillStyle = "#1b1d21";
      c.strokeStyle = "#c3c2b7";
      c.lineWidth = 1.5;
      c.beginPath(); c.rect(p.x - 9, p.y - 13, 18, 26); c.fill(); c.stroke();
      c.fillStyle = "#c3c2b7";
      c.font = "10px ui-sans-serif, system-ui";
      c.fillText("tohumluk", p.x + 13, p.y + 3);
    }
  },

  vur(o, mm) {
    const uc = o.veri.durum.uc || {};
    const th = uc.tohumluk;
    if (th && th.x != null && Math.hypot(th.x - mm.x, th.y - mm.y) < 35) {
      return { tohumluk: true, name: "Tohumluk", x: th.x, y: th.y, z: th.z };
    }
    return (uc.tools_konum || []).find((t) =>
      Math.hypot(t.x - mm.x, t.y - mm.y) < 25) || null;
  },

  kart(o, t) {
    const yuzey = o.toprakZ;
    const aciklik = (Number(t.z) || 0) - yuzey;
    const not = `${t.tohumluk ? "tohumluk" : "uç yuvası"} · `
      + `X${o.say(t.x, 1)} Y${o.say(t.y, 1)} Z${o.say(t.z, 1)}`;
    return `<div class="tarla-kart-bas"><div><b>${o.kacisli(t.name)}</b>
      <div class="alt-not">${not}</div></div></div>
      <p class="alt-not">Toprak yüzeyinden açıklık <b>${o.say(aciklik, 0)} mm</b>
      (yüzey Z${o.say(yuzey, 0)}).</p>
      ${t.tohumluk ? `<p class="alt-not">Tohumluk konumu Ayarlar sekmesindeki uç
      değiştirme bölümünden girilir.</p>`
      : `<p class="alt-not">Takmak ve bırakmak Ayarlar sekmesindeki uç değiştirme
      bölümünden yapılır — dizi güvenlik denetimleriyle birlikte orada.</p>`}`;
  },
});
