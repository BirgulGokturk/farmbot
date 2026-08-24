/* Makine geometrisi — 3B sahnedeki robotun gövdesi.
 *
 * Ayrı dosyada duruyor ki tasarımcının mantığı (bitki yerleştirme, çakışma,
 * seçim) ile makinenin görünümü birbirine karışmasın: görünümü değiştirmek
 * için burayı, davranışı değiştirmek için tarla.js'i açarsınız.
 *
 * Ölçüler gerçek makineden: yatak 425 x 600 mm, ray yüksekliği 520 mm.
 * Eksen eşlemesi — makine X = sahne x (kızak kirişte kayar),
 * makine Y = sahne z (portal raylarda yürür), makine Z = sahne y (yukarı).
 *
 * Önizleme: sunucu/static/makine-onizleme.html — paneli açmadan bakabilirsiniz.
 */
(function () {
  "use strict";

  const RENK = {
    profil: "#b3bbc0",      // alüminyum sigma profil
    profilKoyu: "#2b2f33",  // siyah eloksal profil ve ayaklar
    motor: "#191c1f",       // NEMA step motor gövdesi
    mil: "#c9ced2",         // vidalı mil / lineer mil
    kap: "#e6eaed",         // beyaz yarı saydam saklama kabı
    kutu: "#eef1f3",        // elektronik kutusu
    uc: "#14343a",
  };

  // Fotoğraftaki kablo demeti: renkli, düzensiz, makinenin görüntüsünün
  // yarısı o. Birkaç tanesini çizmek sahneyi belirgin biçimde tanıdık yapıyor.
  const KABLO_RENK = ["#c0392b", "#2874a6", "#1e8449", "#b7950b", "#7d3c98"];

  function mal(THREE, renk, opt) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: new THREE.Color(renk), roughness: 0.55, metalness: 0.25,
    }, opt || {}));
  }

  /** Sigma profil: gövde + iki ucunda daha açık kapak. */
  function profil(THREE, uzunluk, eksen, renk) {
    const g = new THREE.Group();
    const k = 0.04;                       // 40 x 40 profil
    const boy = [k, k, k];
    boy[eksen] = uzunluk;
    const govde = new THREE.Mesh(
      new THREE.BoxGeometry(boy[0], boy[1], boy[2]),
      mal(THREE, renk || RENK.profil, { roughness: 0.42, metalness: 0.55 }));
    g.add(govde);
    // Profilin ortasındaki kanal: ince koyu bir şerit, düz kutu olmaktan çıkarıyor.
    const kanalBoy = [k * 0.55, k * 0.55, k * 0.55];
    kanalBoy[eksen] = uzunluk * 0.999;
    const kanal = new THREE.Mesh(
      new THREE.BoxGeometry(kanalBoy[0], kanalBoy[1], kanalBoy[2]),
      mal(THREE, "#8b9398", { roughness: 0.7, metalness: 0.3 }));
    g.add(kanal);
    return g;
  }

  /** NEMA step motor: gövde + mil + kablo çıkışı. */
  function motor(THREE, boy) {
    const g = new THREE.Group();
    const s = boy || 0.056;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.85, s),
      mal(THREE, RENK.motor, { roughness: 0.5, metalness: 0.45 })));
    const mil = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.09, s * 0.09, s * 0.5, 12),
      mal(THREE, RENK.mil, { roughness: 0.3, metalness: 0.8 }));
    mil.position.y = -s * 0.6;
    g.add(mil);
    return g;
  }

  /** İki nokta arasında sarkan kablo. */
  function kablo(THREE, a, b, renk, sarkma) {
    const orta = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    orta.y -= sarkma == null ? 0.06 : sarkma;
    const egri = new THREE.CatmullRomCurve3([a, orta, b]);
    return new THREE.Mesh(
      new THREE.TubeGeometry(egri, 16, 0.0022, 6, false),
      mal(THREE, renk, { roughness: 0.8, metalness: 0.05 }));
  }

  /**
   * Sabit gövdeyi ve hareketli portalı kurar.
   *
   * @param THREE three.js modülü
   * @param opt   { w, d, rayY } — metre cinsinden yatak eni, boyu, ray yüksekliği
   * @returns { sabit, portal, kizak, sutun, ucKafa }
   *   sabit  : kap, çerçeve, ayaklar, elektronik kutusu (sahnede durur)
   *   portal : raylarda makine Y'sinde yürüyen köprü
   *   kizak  : kirişte makine X'inde kayan araba
   *   sutun  : Z kolonu — birim yükseklikte, tarla.js scale.y ile uzatıyor
   *   ucKafa : uç bağlantısı
   */
  function kur(THREE, opt) {
    const w = opt.w, d = opt.d, rayY = opt.rayY;
    const sabit = new THREE.Group();

    /* --- yatak kabı: beyaz yarı saydam saklama kutusu ------------------- */
    const kapMal = mal(THREE, RENK.kap, {
      roughness: 0.28, metalness: 0.02, transparent: true, opacity: 0.55,
    });
    const duvarKalin = 0.008, kapDerin = 0.17;
    const duvar = (gx, gz, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(gx, kapDerin, gz), kapMal);
      m.position.set(x, -kapDerin / 2 + 0.035, z);
      sabit.add(m);
    };
    duvar(w + duvarKalin * 2, duvarKalin, 0, -d / 2 - duvarKalin / 2);
    duvar(w + duvarKalin * 2, duvarKalin, 0, d / 2 + duvarKalin / 2);
    duvar(duvarKalin, d, -w / 2 - duvarKalin / 2, 0);
    duvar(duvarKalin, d, w / 2 + duvarKalin / 2, 0);

    // Kabın ağzındaki kalın kenar — plastik kutuları tanıdık yapan detay.
    const kenar = (gx, gz, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(gx, 0.012, gz), kapMal);
      m.position.set(x, 0.037, z);
      sabit.add(m);
    };
    kenar(w + 0.03, 0.015, 0, -d / 2 - 0.008);
    kenar(w + 0.03, 0.015, 0, d / 2 + 0.008);
    kenar(0.015, d + 0.03, -w / 2 - 0.008, 0);
    kenar(0.015, d + 0.03, w / 2 + 0.008, 0);

    /* --- taşıyıcı çerçeve ve ayaklar ------------------------------------ */
    // Kap bir masa yüksekliğindeki siyah profil iskeletin üstünde duruyor.
    const ayakBoy = 0.62, altY = -kapDerin + 0.035;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([ix, iz]) => {
      const a = profil(THREE, ayakBoy, 1, RENK.profilKoyu);
      a.position.set((ix * (w + 0.06)) / 2, altY - ayakBoy / 2, (iz * (d + 0.06)) / 2);
      sabit.add(a);
      // ayak pabucu
      const pabuc = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.014, 12),
        mal(THREE, RENK.profilKoyu, { roughness: 0.8 }));
      pabuc.position.set((ix * (w + 0.06)) / 2, altY - ayakBoy - 0.007, (iz * (d + 0.06)) / 2);
      sabit.add(pabuc);
    });
    // Alt kuşaklar — iskeleti sallanmaz gösteriyor
    [-1, 1].forEach((ix) => {
      const k = profil(THREE, d + 0.06, 2, RENK.profilKoyu);
      k.position.set((ix * (w + 0.06)) / 2, altY - ayakBoy + 0.12, 0);
      sabit.add(k);
    });
    [-1, 1].forEach((iz) => {
      const k = profil(THREE, w + 0.06, 0, RENK.profilKoyu);
      k.position.set(0, altY - ayakBoy + 0.12, (iz * (d + 0.06)) / 2);
      sabit.add(k);
    });
    // Kabın oturduğu üst çerçeve
    [-1, 1].forEach((ix) => {
      const k = profil(THREE, d + 0.06, 2, RENK.profilKoyu);
      k.position.set((ix * (w + 0.06)) / 2, altY - 0.02, 0);
      sabit.add(k);
    });

    /* --- dikmeler ve uzun raylar ---------------------------------------- */
    // Raylar makine Y'si boyunca (uzun kenar) uzanıyor, portal üzerlerinde yürüyor.
    const rayX = (w + 0.12) / 2;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([ix, iz]) => {
      const dikme = profil(THREE, rayY + 0.04, 1, RENK.profilKoyu);
      dikme.position.set(ix * rayX, (rayY + 0.04) / 2 - 0.02, (iz * (d + 0.06)) / 2);
      sabit.add(dikme);
    });
    [-1, 1].forEach((ix) => {
      const ray = profil(THREE, d + 0.14, 2, RENK.profil);
      ray.position.set(ix * rayX, rayY, 0);
      sabit.add(ray);
    });

    /* --- elektronik kutusu ---------------------------------------------- */
    const kutu = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.24, 0.19),
      mal(THREE, RENK.kutu, { roughness: 0.45, metalness: 0.05 }));
    kutu.position.set(-rayX - 0.035, rayY * 0.55, -d * 0.18);
    sabit.add(kutu);
    const kapak = new THREE.Mesh(new THREE.CircleGeometry(0.028, 24),
      mal(THREE, "#d5dade", { roughness: 0.6 }));
    kapak.rotation.y = -Math.PI / 2;
    kapak.position.set(-rayX - 0.064, rayY * 0.55, -d * 0.18);
    sabit.add(kapak);

    /* --- Y ekseni motoru (rayın ucunda) --------------------------------- */
    const yMotor = motor(THREE, 0.052);
    yMotor.position.set(rayX, rayY - 0.045, d / 2 + 0.05);
    yMotor.rotation.x = Math.PI / 2;
    sabit.add(yMotor);

    /* --- hareketli portal ------------------------------------------------ */
    const portal = new THREE.Group();
    // Kiriş makine X'i boyunca (kısa kenar) uzanıyor
    const kiris = profil(THREE, w + 0.16, 0, RENK.profil);
    kiris.position.y = rayY;
    portal.add(kiris);
    // Kirişin iki ucundaki arabalar raya oturuyor
    [-1, 1].forEach((ix) => {
      const araba = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.09),
        mal(THREE, RENK.profilKoyu, { roughness: 0.6, metalness: 0.35 }));
      araba.position.set(ix * rayX, rayY - 0.045, 0);
      portal.add(araba);
    });

    /* --- kızak: kirişte kayan araba + Z kolonu --------------------------- */
    const kizak = new THREE.Group();
    const govde = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.11),
      mal(THREE, RENK.profilKoyu, { roughness: 0.55, metalness: 0.4 }));
    govde.position.y = rayY;
    kizak.add(govde);

    // Z motoru kolonun tepesinde — fotoğrafta en tepede duran siyah kutu
    const zMotor = motor(THREE, 0.056);
    zMotor.position.set(0, rayY + 0.2, 0.02);
    kizak.add(zMotor);

    // Sütun: birim yükseklikte kurulur, tarla.js scale.y ile uzatır.
    // Profil + yanında dönen vidalı mil.
    const sutun = new THREE.Group();
    const kolon = new THREE.Mesh(new THREE.BoxGeometry(0.032, 1, 0.032),
      mal(THREE, RENK.profil, { roughness: 0.42, metalness: 0.55 }));
    sutun.add(kolon);
    const vida = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 1, 10),
      mal(THREE, RENK.mil, { roughness: 0.25, metalness: 0.85 }));
    vida.position.set(0, 0, 0.026);
    sutun.add(vida);
    kizak.add(sutun);

    /* --- uç kafası -------------------------------------------------------- */
    const ucKafa = new THREE.Group();
    const tutucu = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.05),
      mal(THREE, RENK.profilKoyu, { roughness: 0.55, metalness: 0.4 }));
    ucKafa.add(tutucu);
    const uc = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.005, 0.055, 14),
      mal(THREE, RENK.uc, { roughness: 0.4, metalness: 0.3 }));
    uc.position.y = -0.05;
    ucKafa.add(uc);
    kizak.add(ucKafa);

    portal.add(kizak);

    /* --- kablolar --------------------------------------------------------- */
    // Elektronik kutusundan dikmeye ve raya giden demet. Portal hareket
    // ettikçe kabloların yerinde durması sorun değil: sarkan demet sabit
    // uçlardan geçiyor, hareketli kısma bağlı değil.
    const kutuUc = new THREE.Vector3(-rayX - 0.03, rayY * 0.55 + 0.1, -d * 0.18);
    KABLO_RENK.forEach((renk, i) => {
      const hedef = new THREE.Vector3(-rayX, rayY - 0.02, -d / 2 + 0.06 + i * 0.012);
      sabit.add(kablo(THREE, kutuUc.clone().add(new THREE.Vector3(0, i * 0.006, 0)), hedef, renk, 0.05));
    });

    return { sabit, portal, kizak, sutun, ucKafa };
  }

  window.FarmbotMakine = { kur, RENK };
})();
