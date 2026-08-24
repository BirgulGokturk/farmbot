/* Makine geometrisi — 3B sahnedeki robotun gövdesi.
 *
 * Yapı, daha önce yazılmış GardenScene.tsx'teki modelin aynısı: TEK KATMAN.
 * Yatak duvarları, yatağın köşelerine basan dört dikme, iki yan ray, ve
 * raylarda yürüyen — kendi ayakları olan — bir köprü. Altında masa, ikinci
 * kat, ayrı taşıyıcı iskelet YOK.
 *
 * Eksen eşlemesi (eski modelle aynı):
 *   makine X → sahne x : köprü raylarda bu yönde yürür
 *   makine Y → sahne z : kızak kirişte bu yönde kayar
 *   makine Z → sahne y : uç yukarı/aşağı
 *
 * Eskisinden farkı, aynı iskeletin daha ayrıntılı çizilmesi: sigma profil
 * kanalı, vidalı Z mili, NEMA motorlar, kızak arabaları, elektronik kutusu.
 *
 * Önizleme: sunucu/static/makine-onizleme.html — paneli açmadan bakılabilir.
 */
(function () {
  "use strict";

  // Renkler eski modelden birebir: sahnenin geri kalanı bunlara göre ayarlı.
  const RENK = {
    cerceve: "#8d9490",     // dikme, yatak duvarı
    ray: "#6e7873",         // ray, kiriş, Z kolonu
    ucKoyu: "#3d4a46",      // kızak gövdesi
    uc: "#0f6e72",          // uç kafası
    motor: "#23272a",       // NEMA gövdesi
    mil: "#c3c9cd",         // vidalı mil
    kutu: "#dfe4e6",        // elektronik kutusu
  };

  function mal(THREE, renk, opt) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: new THREE.Color(renk), roughness: 0.6, metalness: 0.3,
    }, opt || {}));
  }

  /**
   * Sigma profil: gövde + ortasında koyu kanal.
   * eksen: 0 = x, 1 = y, 2 = z boyunca uzanır.
   */
  function profil(THREE, uzunluk, eksen, renk, kalinlik) {
    const g = new THREE.Group();
    const k = kalinlik || 0.045;
    const boy = [k, k, k];
    boy[eksen] = uzunluk;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(boy[0], boy[1], boy[2]),
      mal(THREE, renk, { roughness: 0.55, metalness: 0.35 })));

    // Kanal: profili düz bir kutu olmaktan çıkaran tek detay. Dört yüzde de
    // var ama iki tanesi kameradan hep görünmez, o yüzden ikisini çiziyoruz.
    const kanal = [k * 0.34, k * 0.34, k * 0.34];
    kanal[eksen] = uzunluk * 1.001;
    const koyu = mal(THREE, "#79837f", { roughness: 0.75, metalness: 0.2 });
    [0, 2].forEach((yon) => {
      if (yon === eksen) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(kanal[0], kanal[1], kanal[2]), koyu);
      m.position[yon === 0 ? "x" : "z"] = k * 0.3;
      g.add(m);
    });
    return g;
  }

  /** NEMA step motor. */
  function motor(THREE, s) {
    const g = new THREE.Group();
    const b = s || 0.052;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(b, b * 0.9, b),
      mal(THREE, RENK.motor, { roughness: 0.5, metalness: 0.45 })));
    const mil = new THREE.Mesh(new THREE.CylinderGeometry(b * 0.08, b * 0.08, b * 0.45, 10),
      mal(THREE, RENK.mil, { roughness: 0.25, metalness: 0.85 }));
    mil.position.y = -b * 0.6;
    g.add(mil);
    return g;
  }

  /**
   * @param opt { w, d, rayY } — metre: yatak eni (makine X), boyu (makine Y),
   *            ray yüksekliği
   * @returns { sabit, portal, kizak, sutun, ucKafa }
   */
  function kur(THREE, opt) {
    const w = opt.w, d = opt.d, rayY = opt.rayY;
    const sabit = new THREE.Group();

    /* --- yatak duvarları ------------------------------------------------ */
    const duvarMal = mal(THREE, RENK.cerceve, { roughness: 0.8, metalness: 0.1 });
    const duvar = (gx, gz, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(gx, 0.12, gz), duvarMal);
      m.position.set(x, 0.03, z);
      sabit.add(m);
    };
    duvar(w, 0.03, 0, -d / 2);
    duvar(w, 0.03, 0, d / 2);
    duvar(0.03, d, -w / 2, 0);
    duvar(0.03, d, w / 2, 0);

    /* --- köşe dikmeleri: doğrudan yatağın köşelerine basıyor ------------- */
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([ix, iz]) => {
      const dikme = profil(THREE, rayY, 1, RENK.cerceve, 0.05);
      dikme.position.set((ix * w) / 2, rayY / 2, (iz * d) / 2);
      sabit.add(dikme);
      // köşe kapağı
      const kapak = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.012, 0.056),
        mal(THREE, RENK.cerceve, { roughness: 0.5, metalness: 0.4 }));
      kapak.position.set((ix * w) / 2, rayY + 0.006, (iz * d) / 2);
      sabit.add(kapak);
    });

    /* --- yan raylar: köprü bunların üzerinde X'te yürüyor ---------------- */
    [-1, 1].forEach((iz) => {
      const ray = profil(THREE, w, 0, RENK.ray, 0.045);
      ray.position.set(0, rayY, (iz * d) / 2);
      sabit.add(ray);
    });

    /* --- X motoru: rayın ucunda ------------------------------------------ */
    const xMotor = motor(THREE, 0.05);
    xMotor.position.set(-w / 2 - 0.03, rayY - 0.03, -d / 2);
    sabit.add(xMotor);

    /* --- elektronik kutusu: dikmeye asılı -------------------------------- */
    const kutu = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.16),
      mal(THREE, RENK.kutu, { roughness: 0.5, metalness: 0.05 }));
    kutu.position.set(-w / 2 - 0.04, rayY * 0.5, -d / 4);
    sabit.add(kutu);

    /* --- hareketli köprü (makine X'inde yürür) --------------------------- */
    const portal = new THREE.Group();
    // Köprünün kendi iki ayağı — raylara oturuyor
    [-1, 1].forEach((iz) => {
      const ayak = profil(THREE, rayY, 1, RENK.cerceve, 0.045);
      ayak.position.set(0, rayY / 2, (iz * d) / 2);
      portal.add(ayak);
      // ray arabası
      const araba = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.075),
        mal(THREE, RENK.ucKoyu, { roughness: 0.6, metalness: 0.35 }));
      araba.position.set(0, rayY - 0.03, (iz * d) / 2);
      portal.add(araba);
    });
    // Kiriş: makine Y'sini kaplıyor, kızak bunun üzerinde kayıyor
    const kiris = profil(THREE, d, 2, RENK.ray, 0.04);
    kiris.position.y = rayY;
    portal.add(kiris);

    /* --- kızak: kirişte makine Y'sinde kayar ----------------------------- */
    const kizak = new THREE.Group();
    const govde = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.11),
      mal(THREE, RENK.ucKoyu, { roughness: 0.7, metalness: 0.2 }));
    govde.position.y = rayY;
    kizak.add(govde);

    // Z motoru kızağın tepesinde
    const zMotor = motor(THREE, 0.05);
    zMotor.position.set(0, rayY + 0.075, 0);
    kizak.add(zMotor);

    /* --- Z kolonu: birim yükseklik, tarla.js scale.y ile uzatıyor -------- */
    const sutun = new THREE.Group();
    sutun.add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 1, 0.035),
      mal(THREE, RENK.ray, { roughness: 0.6, metalness: 0.3 })));
    // Vidalı mil — kolonun önünde döner
    sutun.add((function () {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 10),
        mal(THREE, RENK.mil, { roughness: 0.25, metalness: 0.85 }));
      v.position.z = 0.028;
      return v;
    })());
    kizak.add(sutun);

    /* --- uç kafası -------------------------------------------------------- */
    const ucKafa = new THREE.Group();
    ucKafa.add(new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.018, 0.08, 18),
      mal(THREE, RENK.uc, {
        emissive: new THREE.Color(RENK.uc), emissiveIntensity: 0.35, roughness: 0.4,
      })));
    kizak.add(ucKafa);

    portal.add(kizak);
    return { sabit: sabit, portal: portal, kizak: kizak, sutun: sutun, ucKafa: ucKafa };
  }

  window.FarmbotMakine = { kur: kur, RENK: RENK };
})();
