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

  function mal(THREE, tanim) {
    const t = Object.assign({}, tanim);
    t.color = new THREE.Color(t.color);
    return new THREE.MeshStandardMaterial(t);
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
    g.add(new THREE.Mesh(new THREE.BoxGeometry(kanal[0], kanal[1], kanal[2]),
      mal(THREE, { color: "#8f959f", metalness: 0.7, roughness: 0.6 })));

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
    /* --- zemin: makine havada değil, atölye zemininde duruyor ------------ */
    const dosem = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 2.2, d + 2.2),
      mal(THREE, { color: "#3f4650", roughness: 0.95 }));
    dosem.rotation.x = -Math.PI / 2;
    dosem.position.y = zemin;
    sabit.add(dosem);

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

    /* --- toprak: kabın içini dolduran yüzey + karıklar -------------------- */
    // Üst yüzey y = 0: bitkiler, noktalar ve okumalar hep bu düzleme oturuyor.
    const toprak = new THREE.Mesh(
      new THREE.BoxGeometry(w - cidar * 2, -tabla, d - cidar * 2),
      mal(THREE, { color: MAKINE.renk.toprak, roughness: 1, metalness: 0 }));
    toprak.position.y = tabla / 2;
    sabit.add(toprak);

    // Karıklar ince oyuk izi: geniş koyu bant toprağı çizgili muşamba
    // gösteriyordu, ekim sıralarını belli edecek kadarı yetiyor.
    const karikMal = mal(THREE, { color: MAKINE.renk.toprak_koyu, roughness: 1 });
    const karikSayi = MAKINE.yatak.karik_sayisi;
    for (let i = 1; i <= karikSayi; i++) {
      const karik = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.94, 0.003, M(12)), karikMal);
      karik.position.set(0, 0.0016, -d / 2 + (d * i) / (karikSayi + 1));
      sabit.add(karik);
    }

    /* --- yan raylar: köprü bunların üzerinde X'te yürür ------------------ */
    [-1, 1].forEach((iz) => {
      sabit.add(profil(THREE, [w, P, P * 2], [0, rayYuk, (iz * d) / 2]));
    });
    }  /* sabitIster */

    if (!hareketliIster) {
      return { sabit: sabit, portal: null, kizak: null, sutun: null, ucKafa: null };
    }

    /* --- hareketli köprü (makine X'inde yürür) --------------------------- */
    const portal = new THREE.Group();
    const sutunBoy = rayY - rayYuk;
    [-1, 1].forEach((iz) => {
      const z = (iz * d) / 2;
      // dikey sütun
      portal.add(profil(THREE, [P, sutunBoy, P], [0, rayYuk + sutunBoy / 2, z]));
      // sütunu taşıyıcıya bağlayan çapraz destek
      const capraz = kutu(THREE, [P * 3.2, P * 0.4, P * 1.2],
        [P * 1.4, rayYuk + sutunBoy * 0.18, z]);
      capraz.rotation.z = -Math.PI / 4;
      portal.add(capraz);
      // ray üzerindeki taşıyıcı ve tekerlekleri
      portal.add(kutu(THREE, [P * 3.4, P * 1.4, P * 1.6], [0, rayYuk + P * 0.6, z]));
      portal.add(tekerlek(THREE, [-P * 1.1, rayYuk + P * 0.6, z + P * 0.9]));
      portal.add(tekerlek(THREE, [P * 1.1, rayYuk + P * 0.6, z + P * 0.9]));
    });
    // üst çapraz kiriş
    portal.add(profil(THREE, [P, P * 2, d + P * 2], [0, rayY, 0]));
    // kirişin ucundaki Y motoru
    portal.add(motor(THREE, [0, rayY, -d / 2 - P * 2.2]));

    /* --- kızak: kirişte makine Y'sinde kayar ----------------------------- */
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
    return { sabit: sabit, portal: portal, kizak: kizak, sutun: sutun, ucKafa: ucKafa };
  }

  /* Geometri kurucu: makine.js dışındaki hiçbir dosya `new BoxGeometry` ile
   * makine parçası kurmuyor, hepsi buradan geliyor. */
  window.FarmbotMakine = { kur: kur, P: P, AYAK: AYAK, veri: MAKINE };
  /* Ölçü/renk tablosu: katmanlar ve tarla.js `MAKINE.renk.toprak` gibi
   * okuyor. Aynı nesne — iki isim, tek kaynak. */
  window.MAKINE = MAKINE;
})();
