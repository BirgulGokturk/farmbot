/* Makine geometrisi — 3B sahnedeki robotun gövdesi.
 *
 * Yapı, farmbot-web deposundaki Viewer3D.tsx modelinden alındı. Oradaki
 * düzenin özeti:
 *
 *   - Dört ayaklı bir TEZGÂH (aşağı inen tek dikey takım)
 *   - Tezgâhın içine oturan yarı saydam TOPRAK KABI
 *   - Tezgâhın üst çerçevesine yatan iki YAN RAY
 *   - Raylarda X'te yürüyen, kendi iki sütunu olan KÖPRÜ (yukarı çıkan tek
 *     dikey takım)
 *
 * Yatağın köşelerinde ayrıca direk YOK: dikey parçalar yalnız masa ayakları
 * ve köprü sütunları. Profil kalınlığı 20 mm — kalın profil makineyi kafes
 * gibi gösteriyor.
 *
 * Eksen eşlemesi (Viewer3D ile aynı):
 *   makine X → sahne x : köprü raylarda bu yönde yürür
 *   makine Y → sahne z : kızak kirişte bu yönde kayar
 *   makine Z → sahne y : uç yukarı/aşağı
 *
 * Sahne merkezi yatağın ortası, toprak yüzeyi y = 0.
 *
 * Önizleme: sunucu/static/makine-onizleme.html — paneli açmadan bakılabilir.
 */
(function () {
  "use strict";

  /* ==================================================================== veri
   *
   * Makinenin BÜTÜN ölçüleri ve renkleri burada, milimetre cinsinden.
   * Katman dosyaları ve tarla.js buradan okur; hiçbir katmanda elle
   * yazılmış ölçü yok. (farmbot-web'de aynı işi bot_versions.ts görüyor.)
   *
   * Bir ölçü değişecekse tek yer burası.
   */
  const MAKINE = {
    /** Kirişin toprak yüzeyinden yüksekliği. */
    ray_yuksekligi: 520,
    /** Sigma profil kenarı. */
    profil: 20,
    /** Tezgâh ayak yüksekliği. Viewer3D 620 kullanıyordu; 425x600 mm
     *  yatakta o kadar uzun ayak makineyi sehpa gibi gösteriyordu. */
    ayak: 160,
    /** Yan rayların toprak yüzeyinden yüksekliği. */
    yan_ray: 35,
    /** Tezgâh tablası toprak yüzeyinin bu kadar altında (negatif). */
    tabla: -50,
    /** Toprak kabı. */
    kap: { yukseklik: 90, cidar: 6 },
    /** 2B haritada çizilen karık sayısı. */
    yatak: { karik_sayisi: 4 },
    renk: {
      arka: "#0e1210",
      toprak: "#4a3b2c", toprak_koyu: "#3a2e22",
      cerceve: "#8d9490", ray: "#6e7873",
      uc: "#0f6e72", uc_koyu: "#3d4a46",
      govde: "#4a7c35",
      aluminyum: "#c9ced6", metal_koyu: "#2a2f38",
    },
  };

  /** mm → metre. */
  const M = (mm) => mm / 1000;

  /** Sigma profil kenarı (m). Viewer3D'deki PROFILE ile aynı. */
  const P = M(MAKINE.profil);
  /** Tezgâh ayak yüksekliği (m). */
  const AYAK = M(MAKINE.ayak);

  const ALUMINYUM = { color: MAKINE.renk.aluminyum, metalness: 0.85, roughness: 0.32 };
  const KOYU = { color: MAKINE.renk.metal_koyu, metalness: 0.5, roughness: 0.55 };

  /** Yansımanın metalde başladığı sınır. Altındakiler (toprak, gövde,
   *  bitki) ortam haritası ALMIYOR — bkz. dokular.js/ortam. */
  const METAL_ESIK = 0.5;

  function mal(THREE, tanim) {
    const t = Object.assign({}, tanim);
    t.color = new THREE.Color(t.color);
    const m = new THREE.MeshStandardMaterial(t);
    // "Metal parçalarda hafif yansıma": gökyüzü haritası yalnız buraya
    // giriyor. Şiddet 0.45 — 1.0'da profiller aynaya dönüp makinenin
    // kendi rengi kayboluyor.
    if ((t.metalness || 0) >= METAL_ESIK && window.FarmbotDoku) {
      const ortam = window.FarmbotDoku.hazirOrtam();
      if (ortam) { m.envMap = ortam; m.envMapIntensity = 0.45; }
    }
    return m;
  }

  /**
   * Alüminyum sigma profil.
   *
   * T-kanalı için doku kullanmıyoruz: doku dosyası indirmek gerekir, panel ise
   * internetsiz yerel ağda da açılmalı. Onun yerine en uzun eksen boyunca ince
   * koyu bir şerit — normal bakış mesafesinde kanal izlenimi veriyor.
   */
  function profil(THREE, boy, konum) {
    const g = new THREE.Group();
    const w = boy[0], h = boy[1], d = boy[2];
    g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mal(THREE, ALUMINYUM)));

    const enUzun = Math.max(w, h, d);
    const kanal = enUzun === w ? [w * 0.98, h * 0.22, d * 1.01]
      : enUzun === h ? [w * 1.01, h * 0.98, d * 0.22]
        : [w * 0.22, h * 1.01, d * 0.98];
    const serit = new THREE.Mesh(new THREE.BoxGeometry(kanal[0], kanal[1], kanal[2]),
      mal(THREE, { color: "#8f959f", metalness: 0.7, roughness: 0.6 }));
    // Profille çakışık duruyor: gölgesi profilinkinden ayırt edilemez,
    // ama gölge geçişinde bir çizim çağrısı daha demek.
    serit.userData.golgeAtma = true;
    g.add(serit);

    if (konum) g.position.set(konum[0], konum[1], konum[2]);
    return g;
  }

  function kutu(THREE, boy, konum, tanim) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(boy[0], boy[1], boy[2]),
      mal(THREE, tanim || KOYU));
    if (konum) m.position.set(konum[0], konum[1], konum[2]);
    return m;
  }

  /** Step motor gövdesi ve mili. */
  function motor(THREE, konum, donus) {
    const g = new THREE.Group();
    g.add(kutu(THREE, [P * 2.1, P * 2.1, P * 2.4], null,
      { color: "#1c2027", metalness: 0.45, roughness: 0.6 }));
    const mil = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.15, P * 0.15, P * 0.7, 12),
      mal(THREE, { color: "#9aa1ab", metalness: 0.9, roughness: 0.25 }));
    mil.rotation.x = Math.PI / 2;
    mil.position.z = P * 1.5;
    mil.userData.golgeAtma = true;
    g.add(mil);
    if (konum) g.position.set(konum[0], konum[1], konum[2]);
    if (donus) g.rotation.set(donus[0], donus[1], donus[2]);
    return g;
  }

  /** V-tekerlek — arabaların profil üzerinde yürüdüğü siyah makara. */
  function tekerlek(THREE, konum) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.6, P * 0.6, P * 0.5, 16),
      mal(THREE, { color: "#15181d", metalness: 0.3, roughness: 0.7 }));
    m.rotation.z = Math.PI / 2;
    m.position.set(konum[0], konum[1], konum[2]);
    return m;
  }

  /**
   * @param opt { w, d, rayY, parca } — metre: yatak eni (makine X), boyu
   *            (makine Y), kirişin toprak yüzeyinden yüksekliği.
   *            `parca` verilirse yalnız o bölüm kurulur: "sabit" (tezgâh,
   *            kap, raylar) ya da "hareketli" (köprü, kızak, Z, uç). Ayrı
   *            katmanlar ayrı bölümleri istiyor; ikisini birden kurup birini
   *            atmak Pi'de boşuna geometri demek.
   * @returns { sabit, portal, kizak, sutun, ucKafa } — istenmeyen bölüm null
   */
  function kur(THREE, opt) {
    const w = opt.w, d = opt.d, rayY = opt.rayY;
    const parca = opt.parca || "hepsi";
    const sabitIster = parca === "hepsi" || parca === "sabit";
    const hareketliIster = parca === "hepsi" || parca === "hareketli";
    const sabit = new THREE.Group();

    // Toprak yüzeyi y = 0. Tezgâh tablası biraz altında, kap onun içinde.
    const tabla = M(MAKINE.tabla);
    const zemin = tabla - AYAK;
    const rayYuk = M(MAKINE.yan_ray);   // rayların toprak yüzeyinden yüksekliği

    if (sabitIster) {
    /* Zemin ARTIK BURADA DEĞİL. Eskiden makinenin altına 2,6 m'lik düz
     * gri bir levha konuyordu; sahnenin "bir levhanın üstünde duruyor"
     * görüntüsünün yarısı oydu. Zemini sahne kuruyor (tarla.js): çim
     * dokulu, ufka kadar giden bir düzlem. Makine önizlemesi kendi
     * zeminini kendi koyuyor.
     */

    /* --- tezgâh: dört ayak, pabuçlar, üst çerçeve ------------------------ */
    const koseler = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    koseler.forEach(([ix, iz]) => {
      const x = (ix * w) / 2, z = (iz * d) / 2;
      sabit.add(profil(THREE, [P, AYAK, P], [x, zemin + AYAK / 2, z]));
      // ayarlanabilir ayak pabucu
      const pabuc = new THREE.Mesh(
        new THREE.CylinderGeometry(P * 0.7, P * 0.7, 0.012, 12), mal(THREE, KOYU));
      pabuc.position.set(x, zemin + 0.006, z);
      sabit.add(pabuc);
      // köşe braketi
      sabit.add(kutu(THREE, [P * 3, P * 0.5, P * 3], [x, tabla - P * 0.75, z]));
    });
    sabit.add(profil(THREE, [w, P, P], [0, tabla, -d / 2]));
    sabit.add(profil(THREE, [w, P, P], [0, tabla, d / 2]));
    sabit.add(profil(THREE, [P, P, d], [-w / 2, tabla, 0]));
    sabit.add(profil(THREE, [P, P, d], [w / 2, tabla, 0]));

    /* --- toprak kabı: çerçevenin içine oturan yarı saydam plastik -------- */
    // Yan duvarın yarı saydam olması toprağın yandan görünmesini sağlıyor,
    // derinlik hissi oradan geliyor.
    const kapMal = mal(THREE, {
      color: "#9aa3ad", roughness: 0.35, metalness: 0.05,
      transparent: true, opacity: 0.45,
    });
    const kapYuk = M(MAKINE.kap.yukseklik), cidar = M(MAKINE.kap.cidar);
    const kapDuvar = (gx, gz, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(gx, kapYuk, gz), kapMal);
      m.position.set(x, tabla + kapYuk / 2, z);
      sabit.add(m);
    };
    kapDuvar(w, cidar, 0, -d / 2 + cidar / 2);
    kapDuvar(w, cidar, 0, d / 2 - cidar / 2);
    kapDuvar(cidar, d, -w / 2 + cidar / 2, 0);
    kapDuvar(cidar, d, w / 2 - cidar / 2, 0);

    /* --- toprak ------------------------------------------------------------
     * İki parça: yandan görünen gövde (kutu) ve ÜST YÜZEY (kabartmalı ağ).
     *
     * Üst yüzey neden ayrı bir ağ: karıklar artık yüzeye çizilmiş koyu bant
     * değil, GERÇEK OYUK. Kutunun üstüne ince koyu kutular koymak, ışık
     * hangi açıdan gelirse gelsin düz bir muşamba gibi duruyordu; girinti
     * kendi gölgesini yapmadıkça oyuk görünmüyor.
     *
     * Yüzey y = 0: bitkiler, noktalar ve okumalar hep bu düzleme oturuyor.
     * Oyuklar AŞAĞI iniyor, hiçbir tepe 0'ın üstüne çıkmıyor — yoksa
     * bitkiler toprağın içine gömülmüş görünürdü.
     */
    const topEn = w - cidar * 2, topBoy = d - cidar * 2;
    const gövde = new THREE.Mesh(
      new THREE.BoxGeometry(topEn, -tabla, topBoy),
      mal(THREE, { color: MAKINE.renk.toprak_koyu, roughness: 1, metalness: 0 }));
    gövde.position.y = tabla / 2 - 0.004;   // üst yüzey ağı onun üstüne oturuyor
    gövde.userData.golgeAtma = true;
    sabit.add(gövde);

    const doku = window.FarmbotDoku;
    // Tekrar sayısı yatağın METRE ölçüsünden: 425 mm'lik yatakta doku bir
    // buçuk kez tekrarlıyor, 3 m'lik yatakta on kez. Ölçek her yatakta aynı.
    const dokuOlcek = 6.0;
    const yuzeyMal = mal(THREE, {
      color: MAKINE.renk.toprak, roughness: 1, metalness: 0,
      vertexColors: true,      // nem koyulaştırması buradan geliyor
    });
    if (doku) {
      const { harita, kabartma } = doku.toprak(THREE, topEn * dokuOlcek, topBoy * dokuOlcek);
      yuzeyMal.map = harita;
      yuzeyMal.bumpMap = kabartma;
      yuzeyMal.bumpScale = 0.22;
      yuzeyMal.color.set("#ffffff");   // ton dokudan geliyor
    }

    // Bölüntü sayısı Pi düşünülerek seçildi: 48×64 ≈ 6 bin üçgen. Daha azı
    // karığın kenarını köşeli gösteriyor, daha çoğu göze bir şey katmıyor.
    const geo = new THREE.PlaneGeometry(topEn, topBoy, 48, 64);
    geo.rotateX(-Math.PI / 2);
    const konum = geo.attributes.position;
    const karikSayi = MAKINE.yatak.karik_sayisi;
    // 9 mm derin + 26 mm yarı genişlikte oyuk denendi: duvarı o kadar
    // dik oluyor ki ışığı hiç almıyor ve karık, toprakta açılmış
    // simsiyah bir yarık gibi duruyordu. 5/34 gerçek bir karığın
    // eğimi — dibi gölgede ama okunuyor.
    const karikDerin = M(5);
    const karikGenis = M(34);             // oyuğun yarı genişliği
    const rast = doku ? doku.uretec(doku.tohumla("toprak-yuzey")) : Math.random;
    // Yüzey pürüzü için küçük bir gürültü alanı — kabartma haritası ışığı
    // kırıyor, bu da siluetin düz bir masa gibi durmasını engelliyor.
    const N = 24;
    const puruz = doku ? doku.alan(N, 3, doku.tohumla("toprak-puruz"))
                       : new Float32Array(N * N).fill(0.5);
    for (let i = 0; i < konum.count; i++) {
      const x = konum.getX(i), z = konum.getZ(i);
      // Karık: yatağın uzun kenarı boyunca sıralar
      let y = 0;
      for (let k = 1; k <= karikSayi; k++) {
        const merkez = -topBoy / 2 + (topBoy * k) / (karikSayi + 1);
        const u = Math.abs(z - merkez) / karikGenis;
        if (u < 1) y -= karikDerin * (0.5 + 0.5 * Math.cos(u * Math.PI));
      }
      // Kenarda toprak biraz yükselir (kabın duvarına yaslanmış toprak)
      const kx = Math.abs(x) / (topEn / 2), kz = Math.abs(z) / (topBoy / 2);
      y -= M(2.5) * (1 - Math.max(kx, kz));
      // Pürüz
      const ix = Math.min(N - 1, Math.max(0, Math.floor((x / topEn + 0.5) * N)));
      const iz = Math.min(N - 1, Math.max(0, Math.floor((z / topBoy + 0.5) * N)));
      y += (puruz[iz * N + ix] - 0.5) * M(3.5);
      konum.setY(i, Math.min(0, y));
    }
    geo.computeVertexNormals();
    // Nem renkleri için köşe rengi alanı — başlangıçta hepsi beyaz (çarpan 1).
    const renkler = new Float32Array(konum.count * 3).fill(1);
    geo.setAttribute("color", new THREE.BufferAttribute(renkler, 3));

    const toprak = new THREE.Mesh(geo, yuzeyMal);
    toprak.receiveShadow = true;
    // Gölge ALIYOR ama ATMIYOR: 6 bin üçgenlik yüzeyi gölge geçişinde bir
    // daha çizmenin gözle görülür karşılığı yok.
    toprak.userData.golgeAtma = true;
    toprak.name = "toprak-yuzey";
    sabit.add(toprak);

    /* --- yan raylar: uzun kenar boyunca -----------------------------------
     * Gercek makinede raylar yatagin UZUN kenarinda; kopru kisa kenari
     * kapliyor ve uzun kenar boyunca yuruyor. Onceki surumde tersiydi.
     */
    [-1, 1].forEach((ix) => {
      sabit.add(profil(THREE, [P * 2, P, d], [(ix * w) / 2, rayYuk, 0]));
    });

    /* --- tohumluk: uclarin ilerisinde, kose disinda ------------------------
     * Fotograftaki delikli fide tepsisi. Konumu yaklasik; gercek koordinat
     * verilirse buraya baglanir.
     */
    const tepsi = new THREE.Group();
    tepsi.add(kutu(THREE, [0.11, 0.03, 0.16], [0, 0, 0],
      { color: "#26292e", roughness: 0.85, metalness: 0.1 }));
    const delikMal = mal(THREE, { color: "#15181b", roughness: 0.95 });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) {
        const delik = new THREE.Mesh(
          new THREE.CylinderGeometry(0.013, 0.011, 0.026, 10), delikMal);
        delik.position.set(-0.033 + i * 0.033, 0.006, -0.055 + j * 0.037);
        delik.userData.golgeAtma = true;   // 12 delik, 12 çizim çağrısı
        tepsi.add(delik);
      }
    }
    tepsi.position.set(-w / 2 - 0.085, tabla + 0.015, d / 2 - 0.1);
    sabit.add(tepsi);
    }  /* sabitIster */

    /* GÖLGE. Bir ağ gölge haritasına ancak castShadow ile giriyor; bayrak
     * hiç konmadığı için ışık vardı ama gölge yoktu ve her şey aynı
     * düzlemde duruyordu. Toprak İSTİSNA: yalnız gölge ALIYOR. Kendi
     * gölgesini de atsaydı gölge haritasının yarısını 6 bin üçgenlik
     * yüzey yiyecek, karşılığında hiçbir şey görünmeyecekti. */
    const golgeVer = (kok) => kok && kok.traverse((n) => {
      if (!n.isMesh) return;
      n.castShadow = !n.userData.golgeAtma;
      n.receiveShadow = true;
    });
    golgeVer(sabit);

    if (!hareketliIster) {
      return { sabit: sabit, portal: null, kizak: null, sutun: null, ucKafa: null };
    }

    /* --- hareketli köprü (uzun kenar boyunca, makine Y'sinde yürür) ------ */
    const portal = new THREE.Group();
    const sutunBoy = rayY - rayYuk;
    [-1, 1].forEach((ix) => {
      const x = (ix * w) / 2;
      // dikey sütun
      portal.add(profil(THREE, [P, sutunBoy, P], [x, rayYuk + sutunBoy / 2, 0]));
      // sütunu taşıyıcıya bağlayan çapraz destek
      const capraz = kutu(THREE, [P * 1.2, P * 0.4, P * 3.2],
        [x, rayYuk + sutunBoy * 0.18, P * 1.4]);
      capraz.rotation.x = Math.PI / 4;
      portal.add(capraz);
      // ray üzerindeki taşıyıcı ve tekerlekleri
      portal.add(kutu(THREE, [P * 1.6, P * 1.4, P * 3.4], [x, rayYuk + P * 0.6, 0]));
      portal.add(tekerlek(THREE, [x + P * 0.9, rayYuk + P * 0.6, -P * 1.1]));
      portal.add(tekerlek(THREE, [x + P * 0.9, rayYuk + P * 0.6, P * 1.1]));
    });
    // üst kiriş: kısa kenarı kaplıyor
    portal.add(profil(THREE, [w + P * 2, P * 2, P], [0, rayY, 0]));
    // kirişin ucundaki X motoru
    portal.add(motor(THREE, [-w / 2 - P * 2.2, rayY, 0]));

    /* --- kızak: kirişte makine X'inde kayar ----------------------------- */
    const kizak = new THREE.Group();
    kizak.add(kutu(THREE, [P * 2.2, P * 3, P * 2.6], [0, rayY, 0]));
    kizak.add(tekerlek(THREE, [P * 1.3, rayY + P * 0.9, 0]));
    kizak.add(tekerlek(THREE, [P * 1.3, rayY - P * 0.9, 0]));
    // Z motor bloğu arabaya sabit — Z inip çıkarken yerinde kalır
    kizak.add(kutu(THREE, [P * 2.6, P * 3.4, P * 2.4], [P * 1.7, rayY - P * 0.6, 0]));
    kizak.add(motor(THREE, [P * 1.7, rayY + P * 1.9, 0], [Math.PI / 2, 0, 0]));

    /* --- Z takımı: kılavuz profil + vidalı mil --------------------------- */
    // Birim yükseklikte kuruluyor; tarla.js scale.y ile Z stroğuna uzatıyor.
    const sutun = new THREE.Group();
    sutun.add(profil(THREE, [P, 1, P], [P * 1.7, 0, 0]));
    const vida = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.16, P * 0.16, 1, 10),
      mal(THREE, { color: "#aab1ba", metalness: 0.9, roughness: 0.28 }));
    vida.position.x = P * 0.5;
    sutun.add(vida);
    kizak.add(sutun);

    /* --- uç kafası: alet taşıyıcı + uç ----------------------------------- */
    const ucKafa = new THREE.Group();
    ucKafa.add(kutu(THREE, [P * 2.4, P * 2, P * 1.8], [P * 1.1, P * 1.4, 0]));
    const govde = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.85, P * 0.85, P * 0.5, 16),
      mal(THREE, { color: "#6b7280", metalness: 0.75, roughness: 0.3 }));
    govde.position.set(P * 1.1, 0, 0);
    ucKafa.add(govde);
    const uc = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.5, P * 0.28, P * 2.2, 16),
      mal(THREE, {
        color: "#0f6e72", metalness: 0.5, roughness: 0.4,
        emissive: new THREE.Color("#0f6e72"), emissiveIntensity: 0.35,
      }));
    uc.position.set(P * 1.1, -P * 1.3, 0);
    ucKafa.add(uc);
    kizak.add(ucKafa);

    portal.add(kizak);
    golgeVer(portal);
    return { sabit: sabit, portal: portal, kizak: kizak, sutun: sutun, ucKafa: ucKafa };
  }

  /* ==================================================== toprak nemi
   *
   * Sensör okumaları toprağın KÖŞE RENGİNE yazılıyor: ıslak yer koyu,
   * kuru yer açık. Doku değişmiyor, yalnız çarpan — yani nem her
   * geldiğinde 512×512 doku yeniden üretilmiyor, bir Float32Array
   * yeniden yazılıyor.
   *
   * Neden köşe rengi: nem NOKTASAL bir okuma, yüzeye yayılması gerekiyor.
   * Her okuma kendi çevresinde yumuşak bir leke bırakıyor; lekeler
   * üst üste bindiğinde sulanan şerit kendiliğinden çıkıyor.
   *
   * Ayrıca karık dibi biraz daha koyu: su orada duruyor. Bu okumadan
   * değil geometriden geliyor, hep var.
   */
  function nemBoya(kok, secenek) {
    let toprak = null;
    kok.traverse((n) => { if (n.name === "toprak-yuzey") toprak = n; });
    if (!toprak) return false;
    const renk = toprak.geometry.getAttribute("color");
    const konum = toprak.geometry.getAttribute("position");
    if (!renk) return false;

    const okumalar = (secenek.okumalar || []).map((k) => ({
      x: secenek.sx(k.x), z: secenek.sz(k.y),
      // HW-103: 1023 kuru, 0 ıslak.
      islak: Math.max(0, Math.min(1, (1023 - Number(k.toprak_nem)) / 1023)),
    })).filter((k) => isFinite(k.x) && isFinite(k.z) && isFinite(k.islak));

    // Leke yarıçapı: 6 cm. Ölçüm ızgarası 10 mm, yani komşu okumalar
    // birbirine karışıyor ve tek tek benek değil ıslak bir alan görünüyor.
    const R = 0.06, R2 = R * R;
    // En derin karık ~9 mm; en koyu dip için ölçek.
    const DERIN = 0.012;
    for (let i = 0; i < renk.count; i++) {
      const x = konum.getX(i), y = konum.getY(i), z = konum.getZ(i);
      let islak = 0;
      for (let k = 0; k < okumalar.length; k++) {
        const o = okumalar[k];
        const d2 = (x - o.x) * (x - o.x) + (z - o.z) * (z - o.z);
        if (d2 >= R2) continue;
        const w = 1 - d2 / R2;                 // yumuşak düşüş
        const v = o.islak * w * w;
        if (v > islak) islak = v;              // en ıslak okuma kazanıyor
      }
      // Karık dibi payı
      const cukur = Math.min(1, Math.max(0, -y / DERIN));
      // 1.0 = dokunun kendi tonu. En ıslak yerde %42 koyulaşma; daha
      // fazlası toprağı siyah bir lekeye çeviriyor.
      const f = 1 - 0.42 * islak - 0.07 * cukur;
      renk.setXYZ(i, f, f * 0.99, f * 1.03);   // ıslak toprak biraz soğuk
    }
    renk.needsUpdate = true;
    return true;
  }

  /* Geometri kurucu: makine.js dışındaki hiçbir dosya `new BoxGeometry` ile
   * makine parçası kurmuyor, hepsi buradan geliyor. */
  window.FarmbotMakine = { kur: kur, nemBoya: nemBoya, P: P, AYAK: AYAK, veri: MAKINE };
  /* Ölçü/renk tablosu: katmanlar ve tarla.js `MAKINE.renk.toprak` gibi
   * okuyor. Aynı nesne — iki isim, tek kaynak. */
  window.MAKINE = MAKINE;
})();
