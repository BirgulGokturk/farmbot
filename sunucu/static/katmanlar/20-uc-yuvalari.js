/* Uç yuvaları, uç profili ve tohumluk gözleri.
 *
 * `durum.uc.tools_konum`, `durum.uc.tohumluk_gozleri` ve `durum.uc.alan`dan
 * besleniyor. Alan AÇIKKEN içeride Z güvenlik kilidi devre dışı; bu yüzden
 * alan açıkken haritada da belirgin çiziliyor — kilit kapalıyken bunu
 * bilmemek tehlikeli.
 *
 * TOHUMLUK TEK NOKTA DEĞİL. Her gözün kendi X/Y/Z'si var ve sahada
 * ölçülen değerlerde derinlikler farklı: `z` gözün DİBİ ve büyük Z
 * yukarısı olduğu için s4 (Z285), dibi Z260 olan diğerlerinden 25 mm
 * SIĞ. Delikler artık düzgün aralıklı bir süs deseni değil, gözlerin GERÇEK
 * koordinatları — haritada bir göze bakıp "makine oraya iner" demek
 * ancak böyle doğru oluyor. Dolu göz tohum rengiyle, boş göz karanlık
 * çiziliyor: ekim dizisi boş gözü atlıyor ve bunun haritada görünmesi
 * gerekiyor.
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
    const gozler = (uc.tohumluk_gozleri || []).filter((g) => g && g.x != null);
    if (!yuvalar.length && !gozler.length) return;

    /* --- profil: kapsayan kutu -----------------------------------------
     *
     * GENİŞLİK yalnız UÇLARDAN geliyor, gözlerden değil. Gözler profilin
     * ucundaki tepsinin içinde ve X'te yayılıyor (60→180); onları
     * kapsayan kutuya katmak profili tepsinin genişliğine şişirip
     * uçların altından kaydırıyordu. Profil uzun ekseninde tepsiye kadar
     * UZUYOR, ama enini uçlar belirliyor.
     */
    const kaynak = yuvalar.length ? yuvalar : gozler;
    const xs = kaynak.map((d) => d.x), ys = kaynak.map((d) => d.y);
    const gx = gozler.map((g) => g.x), gy = gozler.map((g) => g.y);
    const xEn = Math.max(...xs) - Math.min(...xs);
    const yEn = Math.max(...ys) - Math.min(...ys);
    // Uçlar hangi eksen boyunca dizilmişse profil o eksende uzuyor.
    const uzunY = yEn >= xEn;
    // Uçların ucundan taşan pay: profil son yuvada bıçak gibi bitmiyor.
    const PAY = 40;
    // Uzun eksende gözlere kadar uzat; kısa eksende uçların ölçüsü kalsın.
    const uzunMin = uzunY ? Math.min(...ys, ...gy) : Math.min(...xs, ...gx);
    const uzunMax = uzunY ? Math.max(...ys, ...gy) : Math.max(...xs, ...gx);
    const px1 = uzunY ? Math.min(...xs) : uzunMin - PAY;
    const px2 = uzunY ? Math.max(...xs) : uzunMax + PAY;
    const py1 = uzunY ? uzunMin - PAY : Math.min(...ys);
    const py2 = uzunY ? uzunMax + PAY : Math.max(...ys);
    // Genişliği tek bir yuvanın çapından: profil yuvayı taşıyacak kadar
    // geniş, ama yatağa taşacak kadar değil.
    const GENIS = 45;
    const enX = uzunY ? GENIS : (px2 - px1);
    const enY = uzunY ? (py2 - py1) : GENIS;
    const mx = uzunY ? (px1 + px2) / 2 : (px1 + px2) / 2;
    const my = uzunY ? (py1 + py2) / 2 : (py1 + py2) / 2;

    /* Profilin ÜST yüzeyi TOPRAK HİZASINDA.
     *
     * Önce uçların `z` değerinden türetiliyordu (`z - yuva boyu`) ve raf
     * toprağın epey üstünde kalıyordu: sahnede biri toprak biri raf olmak
     * üzere iki katlı bir yapı görünüyordu. Gerçek makinede uç profili
     * yatağın yanında, toprakla AYNI hizada duruyor.
     *
     * `z` değeri artık yalnız robotun gittiği yer için kullanılıyor
     * (uc değiştirme dizisi onu okuyor); çizimdeki yükseklik topraktan
     * geliyor. İkisi ayrı sorulara cevap veriyor: biri "uç nerede
     * kavranıyor", diğeri "raf hangi yükseklikte duruyor".
     */
    /* Raf SİGMANIN ÜSTÜNE oturuyor, toprak hizasına değil.
     *
     * Önce toprak hizasındaydı ve uçlar yatağın yanında havada duruyor
     * gibiydi. Gerçek makinede uçlar doğrudan yan profilin ÜSTÜNDE — bir
     * plakayla profile vidalanmışlar. Yükseklik o yüzden profilden
     * türüyor: yan ray yüksekliği + profilin yarısı = profilin üst yüzü.
     *
     * Sayılar makine.js'ten; burada elle yazılmış ölçü yok. */
    const ustZ = (Number(o.veri.durum.toprak_z) || 0)
      + o.makine.yan_ray + o.makine.profil / 2;
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
    /* DİKME YOK. Raf artık sigmanın üstünde oturduğu için altını kapatacak
     * bir şey gerekmiyor; profil zaten taşıyıcı. Eskiden buradan iki dikme
     * iniyordu ve makinenin yanında kendine ait bir ayak takımı varmış gibi
     * duruyordu — gerçekte öyle bir şey yok, uç plakası doğrudan profile
     * vidalı. */

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

      /* Yuvalar RAFIN ÜSTÜNE oturuyor, kendi `z` değerlerine değil.
       * Uçların z'si birkaç milimetre ayrışıyor; onu çizime yansıtmak
       * yuvaları rafın içine gömüyor ya da havada bırakıyordu. Gerçekte
       * hepsi aynı profilin üstünde duruyor. */
      g.position.set(o.sx(t.x), o.sy(ustZ), o.sz(t.y));
      g.traverse((n) => { n.userData.yuva = t; });
      o.grup.add(g);
    });

    /* --- tohumluk: gözlerin gerçek koordinatlarında delikli tepsi ------ */
    if (gozler.length) {
      const TEPSI_PAY = 22;          // gözlerin dışında kalan kenar payı
      const tx1 = Math.min(...gx) - TEPSI_PAY, tx2 = Math.max(...gx) + TEPSI_PAY;
      const ty1 = Math.min(...gy) - TEPSI_PAY, ty2 = Math.max(...gy) + TEPSI_PAY;
      /* Z YÖNÜ. Bu makinede BÜYÜK Z YUKARISI: güvenli yükseklik 390,
       * toprak 170, uç kavrama 158. `sy(z) = (z - toprakZ) * MM`, yani
       * sahnede de büyük z yukarı. Gözlerin `z`si gözün DİBİ (vakum ucu
       * oraya iniyor), tepsinin yüzeyi değil.
       *
       * Dolayısıyla dibi en YÜKSEKTE olan göz en SIĞ olanı. Sahadaki
       * ölçümde s4'ün dibi Z285, diğerlerininki Z260 — s4 sığ göz.
       */
      const dipEnAlt = Math.min(...gozler.map((g_) => Number(g_.z) || 0));
      const dipEnUst = Math.max(...gozler.map((g_) => Number(g_.z) || 0));
      // Tepsinin üst yüzeyi en sığ gözün dibinden de yukarıda: yoksa o
      // göz kuyu değil tümsek olurdu.
      const AGIZ_MM = 12;
      // Tepsi, en derin gözün dibini de içine alacak kadar kalın.
      const yuk = Math.max(0.02, (dipEnUst + AGIZ_MM - dipEnAlt) * o.MM + 0.006);
      /* TEPSİ SİGMANIN ÜSTÜNE OTURUYOR.
       *
       * Önce üst yüzey doğrudan gözlerin Z'sinden türüyordu
       * (`sy(dipEnUst + AGIZ)`) ve tepsi profilin 80 mm üstünde, havada
       * duruyordu. Gerçek makinede blok uç profilinin ucunda, sigmanın
       * ÜSTÜNE vidalı.
       *
       * Gözlerin `z` değeri robotun İNDİĞİ yeri söylüyor, tepsinin
       * havadaki yüksekliğini değil — uç rafında da aynı ayrımı yaptık.
       * Blok profile oturuyor, gözlerin BİRBİRİNE GÖRE derinlik farkı
       * korunuyor: s4 hâlâ diğerlerinden sığ görünüyor. */
      const tabanY = o.sy((Number(o.veri.durum.toprak_z) || 0)
                          + o.makine.yan_ray + o.makine.profil / 2);
      const ustY = tabanY + yuk;

      const g = new o.THREE.Group();
      const blok = new o.THREE.Mesh(
        new o.THREE.BoxGeometry((tx2 - tx1) * o.MM, yuk, (ty2 - ty1) * o.MM),
        o.malzeme("#1b1d21", { metalness: 0.15, roughness: 0.9 }));
      blok.position.set(o.sx((tx1 + tx2) / 2), ustY - yuk / 2, o.sz((ty1 + ty2) / 2));
      blok.raycast = () => {};
      g.add(blok);

      /* Her göz kendi koordinatında ve kendi derinliğinde. Delikler
       * örneklenmiş tek ağ DEĞİL: dolu ve boş gözler ayrı renkte,
       * derinlikleri farklı ve gözler tek tek seçilebilmeli. Göz sayısı
       * `AZAMI_GOZ` = 48 ile sınırlı, yani en kötü durumda 96 çizim
       * çağrısı — tepsi tek katman ve bu sınırın altında kalıyor. */
      gozler.forEach((goz) => {
        // Derinlik GÖRECELİ: gözün dibi, en sığ gözün ağzından ne kadar
        // aşağıda? Mutlak Z kullansaydık delikler tepsiden kopardı —
        // tepsi artık profile oturuyor, gözlerin mutlak Z'sine değil.
        const derinlik = Math.max(
          0.004, (dipEnUst + AGIZ_MM - (Number(goz.z) || 0)) * o.MM);
        const dipY = ustY - derinlik;
        const delik = new o.THREE.Mesh(
          new o.THREE.CylinderGeometry(0.0092, 0.0092, derinlik, 12),
          o.malzeme("#08090b", { metalness: 0.1, roughness: 1 }));
        delik.position.set(o.sx(goz.x), dipY + derinlik / 2 + 0.0005, o.sz(goz.y));
        delik.userData.goz = goz;
        g.add(delik);
        /* GÖZÜN ÜSTÜNDE TÜR SİMGESİ.
         *
         * Önce yalnız imleci getirince ipucu çıkıyordu, ama dört göz yan
         * yana dururken hangisinde ne olduğunu görmek için tek tek üstlerine
         * gitmek gerekiyordu — hâlbuki asıl istenen bakınca görmek.
         * Simge duruyor artık; ipucu ayrıntı için kalıyor.
         *
         * Bitki katmanındaki simge düzeninin AYNISI kullanılıyor: aynı
         * emoji fontu, aynı arka daire, ekran üstünde sabit boyut. İki yerde
         * iki farklı simge görünümü olsaydı kullanıcı ikisini ayrı şey
         * sanardı. */
        const tur = goz.tohum ? (o.veri.turler || {})[goz.tohum] : null;
        const bitkiKatman = o.katmanTanimi && o.katmanTanimi("bitkiler");
        if (tur && bitkiKatman && bitkiKatman.simgeMal) {
          const s = new o.THREE.Sprite(
            bitkiKatman.simgeMal(o.THREE, tur.icon || "🌱"));
          s.scale.setScalar(0.052);          // bitkininkinden hafif küçük
          s.position.set(o.sx(goz.x), ustY + 0.030, o.sz(goz.y));
          s.raycast = () => {};
          /* GİZLİ BAŞLIYOR, imleç üstüne gelince çıkıyor.
           *
           * Önce hepsi birden duruyordu ve dört emoji yan yana tepsinin
           * üstünü kaplıyordu — tepsi, delikleri ve dolu/boş durumu
           * simgelerin altında kayboluyordu. İstenen, bakınca hepsini
           * görmek değil, hangisine baktığını öğrenmek. */
          s.visible = false;
          s.userData.gozAd = goz.ad;
          this._simgeAgi = this._simgeAgi || {};
          g.add(s);
        }

        // Dolu göz: deliğin DİBİNDE tohum. Boş gözde hiçbir şey yok,
        // yani haritaya bakan kişi hangi gözün tükendiğini görüyor.
        if (goz.dolu) {
          const tohum = new o.THREE.Mesh(
            new o.THREE.SphereGeometry(0.0068, 10, 8),
            o.malzeme("#8d7a4e", { metalness: 0.05, roughness: 0.95 }));
          tohum.position.set(o.sx(goz.x), dipY + 0.007, o.sz(goz.y));
          tohum.userData.goz = goz;
          g.add(tohum);
        }
      });
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
    /* Tohumluk: tepsinin çerçevesi + her göz kendi yerinde. Dolu göz
     * dolu daire, boş göz içi boş — üstten bakınca hangi gözde tohum
     * kaldığı sayılabilsin. */
    const gozler = (uc.tohumluk_gozleri || []).filter((g) => g && g.x != null);
    if (gozler.length) {
      const gx = gozler.map((g) => g.x), gy = gozler.map((g) => g.y);
      const k1 = o.mm2b(Math.min(...gx) - 22, Math.min(...gy) - 22);
      const k2 = o.mm2b(Math.max(...gx) + 22, Math.max(...gy) + 22);
      c.fillStyle = "#1b1d21";
      c.strokeStyle = "#c3c2b7";
      c.lineWidth = 1.5;
      c.beginPath();
      c.rect(Math.min(k1.x, k2.x), Math.min(k1.y, k2.y),
             Math.abs(k2.x - k1.x), Math.abs(k2.y - k1.y));
      c.fill(); c.stroke();
      c.font = "9px ui-sans-serif, system-ui";
      gozler.forEach((g) => {
        const p = o.mm2b(g.x, g.y);
        c.beginPath();
        c.arc(p.x, p.y, 4, 0, Math.PI * 2);
        if (g.dolu) { c.fillStyle = "#8d7a4e"; c.fill(); }
        else { c.strokeStyle = "#6b6a63"; c.lineWidth = 1; c.stroke(); }
        c.fillStyle = "#c3c2b7";
        c.fillText(g.ad || "", p.x + 6, p.y + 3);
      });
    }
  },

  /** İmlecin üstünde durduğu gözün simgesini gösterir, ötekileri gizler.
   *
   * `tarla.js` fare hareketinde çağırıyor. Sahneyi burada yeniden
   * kurmuyoruz: yalnız `visible` değişiyor, yani fare hareketi başına
   * geometri üretilmiyor.
   */
  gozVurgula(o, ad) {
    let degisti = false;
    o.grup.traverse((n) => {
      if (n.type !== "Sprite" || !n.userData.gozAd) return;
      const olmali = n.userData.gozAd === ad;
      if (n.visible !== olmali) { n.visible = olmali; degisti = true; }
    });
    return degisti;
  },

  /** Deneme yardımcısı — tepsinin ve simgelerin o anki hâli.
   *
   * Sahnede küçük ve uzak duran nesnelerin çizilip çizilmediğini ekran
   * görüntüsünden anlamak zor; sayıyla sormak mümkün. `suDurumu` ve
   * `katmanDurumu` da aynı sebeple var.
   */
  tepsiDurumu(o) {
    const g = o.grup.children.find(
      (c) => c.type === "Group" && c.children.some((x) => x.type === "Sprite"));
    if (!g) {
      const her = o.grup.children.filter((c) => c.type === "Group");
      return { tepsiVar: her.length > 0, simge: 0,
               gruplar: her.map((x) => x.children.length) };
    }
    const simgeler = g.children.filter((c) => c.type === "Sprite");
    return {
      tepsiVar: true,
      parca: g.children.length,
      simge: simgeler.length,
      simgeY: simgeler.map((s) => +s.position.y.toFixed(4)),
      blokUstY: +(g.children[0] ? g.children[0].position.y.toFixed(4) : 0),
    };
  },

  /** Kart düğmeleri. Yalnız tohumluk gözünde var; uç yuvasında yok. */
  baglan(o, kok, t) {
    const d = kok.querySelector("#d-goz-git");
    if (!d) return;
    d.onclick = () => {
      /* GÜVENLİ YÜKSEKLİKTE duruyoruz, gözün DİBİNE inmiyoruz.
       *
       * Gözün `z`si vakum ucunun ineceği yer. Oraya doğrudan gitmek, uç
       * takılı değilken kafayı gözün içine sokmak demek — ekim dizisinin
       * onay adımı tam bunu önlemek için var. Bu düğme konumlandırma
       * içindir, tohum alma için değil. */
      const z = Number(o.veri.durum.guvenli_z) || 390;
      o.komut("git", { x: t.x, y: t.y, z });
    };
  },

  vur(o, mm) {
    const uc = o.veri.durum.uc || {};
    const goz = (uc.tohumluk_gozleri || []).find((g) =>
      g && g.x != null && Math.hypot(g.x - mm.x, g.y - mm.y) < 18);
    if (goz) return { goz: true, name: goz.ad, x: goz.x, y: goz.y, z: goz.z,
                      tohum: goz.tohum, dolu: goz.dolu };
    return (uc.tools_konum || []).find((t) =>
      Math.hypot(t.x - mm.x, t.y - mm.y) < 25) || null;
  },

  kart(o, t) {
    const yuzey = o.toprakZ;
    const aciklik = (Number(t.z) || 0) - yuzey;
    // Gözün içindeki tür, emojisiyle. Kart açıldığında da aynı bilgi
    // görünmeli: ipucu geçici, kart kalıcı.
    const tur = (t.goz && t.tohum) ? (o.veri.turler || {})[t.tohum] : null;
    const tohumYazi = t.goz
      ? (tur ? ` · ${tur.icon || "🌱"} ${tur.name_tr || t.tohum}`
             : (t.tohum ? ` · ${t.tohum}` : " · tür seçilmedi"))
      : "";
    const not = `${t.goz ? "tohumluk gözü" : "uç yuvası"}${tohumYazi} · `
      + `X${o.say(t.x, 1)} Y${o.say(t.y, 1)} Z${o.say(t.z, 1)}`;
    return `<div class="tarla-kart-bas"><div><b>${o.kacisli(t.name)}</b>
      <div class="alt-not">${not}</div></div></div>
      <p class="alt-not">Toprak yüzeyinden açıklık <b>${o.say(aciklik, 0)} mm</b>
      (yüzey Z${o.say(yuzey, 0)}).</p>
      ${t.goz ? `<p class="alt-not">${t.dolu
        ? `<b>Dolu</b>${t.tohum ? " — " + o.kacisli(t.tohum) : ""}. Ekim dizisi
           bu gözden tohum alabilir.`
        : "<b>Boş</b> — ekim dizisi bu gözü atlar."}</p>
      <p class="alt-not">Gözün Z'si gözün DİBİ: vakum ucu buraya iner.
      Koordinat ve dolu/boş durumu Ayarlar → Uç değiştirme → Tohumluk
      gözleri bölümünden düzenlenir.</p>
      <div class="satir-8">
        <button class="dugme kucuk" id="d-goz-git">Gözün üstüne git</button>
      </div>
      <p class="alt-not">Bu düğme yalnız KAFAYI götürür, tohum almaz —
      güvenli yükseklikte gözün üstünde durur. Ekim, hedef bitki seçilip
      <b>Ek</b> denerek başlatılıyor; makine o bitkinin türüne uyan dolu
      gözü kendisi buluyor.</p>`
      : `<p class="alt-not">Takmak ve bırakmak Ayarlar sekmesindeki uç değiştirme
      bölümünden yapılır — dizi güvenlik denetimleriyle birlikte orada.</p>`}`;
  },
});
