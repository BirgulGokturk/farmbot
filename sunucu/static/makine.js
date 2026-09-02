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
    /** Zemin, toprak yüzeyinin bu kadar altında (negatif). Ayak boyu
     *  bununla çerçeve yüksekliğinin farkı. */
    zemin: -210,
    /** Kabın TABANI toprak yüzeyinin bu kadar altında (negatif).
     *
     * Önce -50 idi ve kaplar sığ birer tepsi gibi duruyordu: altlarından
     * çim görünüyor, toprak da 5 cm'lik ince bir katman gibi okunuyordu.
     * Gerçekte bunlar derin plastik saklama kutuları ve içleri toprak
     * dolu. -170'te kap tabanı zeminin 4 cm üstünde kalıyor — kutu asılı
     * duruyor ama yere değmiyor, fotoğraftaki gibi. */
    /* -170 denendi ve kutular havada asili kaldi: zeminle aralarinda 4 cm
     * bosluk vardi, makine "kutulari sarkan bir masa" gibi duruyordu.
     * Taban artik ZEMINLE AYNI hizada — kutular yere basiyor. */
    tabla: -210,
    /** Toprak kabı. */
    /* Kap yüksekliği 90 mm'ydi ve tabla −50'de olduğu için kabın ağzı
     * toprak yüzeyinin 40 mm ÜSTÜNE çıkıyordu: sahnede kap komple yukarıda
     * duran bir kutu gibi görünüyordu. Gerçekte kap aşağıda ve ağzı sigmayı
     * çok az geçiyor. 62 mm'de ağız yüzeyin 12 mm üstünde kalıyor — kenar
     * hâlâ görünüyor ama kutu öne çıkmıyor. */
    /* Duvar TABANDAN ağza: 210 mm derinlik + ağız yüzeyin 12 mm üstünde.
     * Duvar yüksekliği kabın derinliğiyle birlikte büyümeli; sabit
     * kalsaydı duvarlar tabandan başlayıp toprak yüzeyine varamadan
     * biterdi. */
    kap: { yukseklik: 222, cidar: 6 },
    /** 2B haritada çizilen karık sayısı. */
    /* karik_sayisi: toprakta acilmis oluk sayisi.
     *
     * 0 = DUZ TOPRAK, varsayilan. Once 4 idi ve kaplarda tahta lata gibi
     * duzenli koyu bantlar olusturuyordu — sahnedeki en yapay duran sey
     * oydu. Gercek kaplarda karik yok, toprak duz ve topakli.
     *
     * Ayar olarak duruyor: karik acan bir kurulumda 3-4 yapmak yeterli. */
    yatak: { karik_sayisi: 0 },
    renk: {
      arka: "#0e1210",
      toprak: "#4a3b2c", toprak_koyu: "#3a2e22",
      cerceve: "#8d9490", ray: "#6e7873",
      uc: "#0f6e72", uc_koyu: "#3d4a46",
      govde: "#4a7c35",
      /* METAL PALETİ — dört kademe, bilerek AYRIK.
       *
       * Önceki sürümde her metal parça aynı grinin tonuydu (#c9ced6 ile
       * #2a2f38 arası) ve makine tek bir kütle gibi okunuyordu. Gözün
       * parçaları ayırabilmesi için tonlar arasında görünür bir sıçrama
       * gerekiyor:
       *
       *   aluminyum   taşıyıcı sigma profiller — AÇIK ve hafif SICAK.
       *               Gerçek anodize alüminyum soğuk gri değil; bir
       *               parça sarıya çalıyor ve fırçalanmış yüzeyi ışığı
       *               yöne göre farklı yansıtıyor (bkz. dokular.js/fircali).
       *   metal_koyu  hareketli araba, braket, taşıyıcı — belirgin KOYU.
       *               Hareket eden parçanın sabit çerçeveden ayrılması
       *               makinenin nasıl çalıştığını da anlatıyor.
       *   motor       gövdeler — MAT SİYAH, neredeyse yansımasız.
       *   celik       vidalı mil, teker mili — PARLAK çelik, en yüksek
       *               yansıma. Sahnede iki üç yerde parlayan bir şey
       *               olması gerekiyor, yoksa her yüzey aynı matlıkta.
       */
      aluminyum: "#b4b0a6", metal_koyu: "#33373c",
      motor: "#17181b", celik: "#e2e6ea",
    },
  };

  /** mm → metre. */
  const M = (mm) => mm / 1000;

  /** Sigma profil kenarı (m). Viewer3D'deki PROFILE ile aynı. */
  const P = M(MAKINE.profil);
  /** Tezgâh ayak yüksekliği (m). */
  const AYAK = M(MAKINE.ayak);

  /* Malzeme tanımları. Pürüzlülük farkı renk farkı kadar önemli: aynı
   * renkte ama farklı pürüzlülükteki iki yüzey bile ayrışıyor. */
  const ALUMINYUM = { color: MAKINE.renk.aluminyum, metalness: 0.84, roughness: 0.34,
                      fircali: true };
  const KOYU = { color: MAKINE.renk.metal_koyu, metalness: 0.55, roughness: 0.62 };
  const MOTOR = { color: MAKINE.renk.motor, metalness: 0.18, roughness: 0.92 };
  const CELIK = { color: MAKINE.renk.celik, metalness: 0.95, roughness: 0.14 };

  /** Yansımanın metalde başladığı sınır. Altındakiler (toprak, gövde,
   *  bitki) ortam haritası ALMIYOR — bkz. dokular.js/ortam. */
  const METAL_ESIK = 0.5;

  function mal(THREE, tanim) {
    const t = Object.assign({}, tanim);
    t.color = new THREE.Color(t.color);
    // `fircali` bir malzeme özelliği değil, bizim bayrağımız: fırçalama
    // izini PÜRÜZLÜLÜK haritası olarak veriyoruz. Renk haritası
    // olsaydı profil çizgili boyanmış gibi görünürdü; pürüzlülük
    // olunca çizgiler ancak ışık o yöne geldiğinde parlıyor — gerçek
    // fırçalanmış metalin yaptığı da bu.
    const fircali = t.fircali;
    delete t.fircali;
    const m = new THREE.MeshStandardMaterial(t);
    if (fircali && window.FarmbotDoku && window.FarmbotDoku.fircali) {
      m.roughnessMap = window.FarmbotDoku.fircali(THREE);
    }
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
      mal(THREE, { color: "#8f8b80", metalness: 0.7, roughness: 0.66 }));
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
    g.add(kutu(THREE, [P * 2.1, P * 2.1, P * 2.4], null, MOTOR));
    const mil = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.15, P * 0.15, P * 0.7, 12),
      mal(THREE, CELIK));
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
      mal(THREE, { color: "#0f1114", metalness: 0.15, roughness: 0.85 }));
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
    const rayYuk = M(MAKINE.yan_ray);   // rayların toprak yüzeyinden yüksekliği
    /* TEK KAT PROFİL. Eskiden iki ayrı sıra vardı: `tabla` seviyesinde bir
     * çevre çerçevesi ve 85 mm üstünde, `rayYuk`ta köprünün yürüdüğü yan
     * raylar. Gerçek makinede öyle değil — tek sıra sigma var ve köprü tam
     * onun üstünde yürüyor. İki sıra, makineyi olduğundan kalın ve kafes
     * gibi gösteriyordu.
     *
     * Çerçeve artık ray seviyesinde; ayaklar oraya kadar çıkıyor. Kaplar
     * eskisi gibi `tabla`dan asılı, yani çerçevenin ALTINDA kalıyorlar —
     * fotoğraftaki gibi. */
    const cerceveY = rayYuk;
    /* ZEMİN SABİT. Çerçeveyi yukarı taşırken ayak boyunu sabit bırakmıştım
     * ve makine 85 mm havada kaldı — ayaklar çime değmiyordu. Zemin
     * yüksekliği artık çerçeveden bağımsız: eskiden neredeyse orada.
     * Ayak boyu ikisinin farkı, yani çerçeve nereye giderse gitsin ayak
     * yere kadar uzuyor. */
    /* Zemin yüksekliği KAPTAN BAĞIMSIZ. Önce `tabla - AYAK` ile
     * türetiliyordu; kap derinleştirilince ayaklar da onunla birlikte
     * uzuyor ve makine yere gömülüyordu. İkisi ayrı sorular: biri
     * "makine hangi yükseklikte duruyor", öteki "kap ne kadar derin". */
    const zemin = M(MAKINE.zemin);
    const ayakBoy = cerceveY - zemin;

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
      sabit.add(profil(THREE, [P, ayakBoy, P], [x, zemin + ayakBoy / 2, z]));
      // ayarlanabilir ayak pabucu
      const pabuc = new THREE.Mesh(
        new THREE.CylinderGeometry(P * 0.7, P * 0.7, 0.012, 12), mal(THREE, KOYU));
      pabuc.position.set(x, zemin + 0.006, z);
      sabit.add(pabuc);
      // köşe braketi
      sabit.add(kutu(THREE, [P * 3, P * 0.5, P * 3], [x, cerceveY - P * 0.75, z]));
    });
    // Kısa kenarlar (uçtaki bağlantı profilleri)
    sabit.add(profil(THREE, [w, P, P], [0, cerceveY, -d / 2]));
    sabit.add(profil(THREE, [w, P, P], [0, cerceveY, d / 2]));
    /* Uzun kenarlar KÖPRÜNÜN RAYI. Ayrı bir ray sırası yok: bu profiller
     * hem çerçeveyi kapatıyor hem köprüyü taşıyor. Genişlikleri P*2 —
     * köprü tekerleğinin oturduğu yüzey tek profilden geniş. */
    sabit.add(profil(THREE, [P * 2, P, d], [-w / 2, cerceveY, 0]));
    sabit.add(profil(THREE, [P * 2, P, d], [w / 2, cerceveY, 0]));

    /* --- toprak kabı: çerçevenin içine oturan yarı saydam plastik -------- */
    // Yan duvarın yarı saydam olması toprağın yandan görünmesini sağlıyor,
    // derinlik hissi oradan geliyor.
    const kapMal = mal(THREE, {
      color: "#9aa3ad", roughness: 0.35, metalness: 0.05,
      transparent: true, opacity: 0.45,
    });
    const kapYuk = M(MAKINE.kap.yukseklik), cidar = M(MAKINE.kap.cidar);

    /* --- DİKİM ALANLARI ---------------------------------------------------
     * Yatak baştan sona tek bir toprak alanı DEĞİL: gerçek makinede iki
     * ayrı kap var ve aralarında boşluk bulunuyor. Her alan kendi kabını,
     * kendi toprağını ve kendi yüzey yüksekliğini taşıyor.
     *
     * `opt.alanlar` verilmemişse eski davranış aynen sürüyor: yatağın
     * tamamı tek bir alan. Mevcut kurulumlar bozulmasın diye bu kaçış
     * bilerek duruyor — alan tanımlamamış bir kullanıcı güncelleme
     * sonrasında sahnesini boş bulmuyor.
     *
     * Ölçüler burada METRE ve sahne merkezine göre; makine milimetresinden
     * çeviriyi çağıran yapıyor (tarla.js'in sx/sz'si), çünkü dönüşüm yatak
     * sınırlarına bağlı ve makine.js sınırları bilmiyor. */
    const alanlar = (opt.alanlar && opt.alanlar.length) ? opt.alanlar : [
      { ad: "", mx: 0, mz: 0, en: w, boy: d, yuzeyY: 0 },
    ];

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
     *
     * ALANIN kendi `yuzeyY` değeri varsa yüzey oradan başlıyor: kaplar
     * aynı hizada olmayabiliyor. Değer sahne metresi cinsinden ve genel
     * toprak yüzeyine GÖRE (0 = genel yüzey).
     */
    const doku = window.FarmbotDoku;
    /* Doku ve malzeme BİR KEZ üretiliyor, bütün alanlar paylaşıyor. Alan
     * başına ayrı doku üretmek iki kaba çıkarken 13 dokuyu 15'e, dört kaba
     * çıkarken 19'a taşırdı; oysa toprak her kapta aynı toprak. */
    /* Metre başına doku tekrarı. 6.0 iken aynı kesek deseni kabın içinde
     * dört beş kez göze çarpacak kadar sık tekrarlıyordu — göz düzeni bir
     * kez yakalayınca yüzey "desen kaplı" görünüyor, toprak değil. 3.6'da
     * tane biraz büyüyor ama tekrar aralığı kabın boyuna yaklaşıyor ve
     * ızgara etkisi kayboluyor. */
    const dokuOlcek = 3.6;
    /* roughness 1.0 TAM MAT demek ve tam mat toprak KURU toprak: hiç ışık
     * yansıtmıyor, tozlu duruyor. Saksı toprağı hiçbir zaman o kadar kuru
     * değil — tanelerin arasında her zaman biraz nem var ve yüzey gökyüzünden
     * az da olsa bir parıltı alıyor. 0.86 o taban nemi; sulama okuması
     * geldiğinde aşağıdaki shader bunu daha da düşürüyor. */
    const yuzeyMal = mal(THREE, {
      color: MAKINE.renk.toprak, roughness: 0.86, metalness: 0,
      vertexColors: true,      // nem koyulaştırması buradan geliyor
    });
    /* ISLAK TOPRAK PARLAR. Kuru toprak tamamen mat; ıslanınca tanelerin
     * arasını su dolduruyor, yüzey düzleşiyor ve gökyüzünü yansıtmaya
     * başlıyor. Yalnız koyulaştırmak yetmiyor — koyu ama mat bir yüzey
     * "gölgede kalmış kuru toprak" gibi okunuyor.
     *
     * Pürüzlülük malzemede TEK bir sayı, oysa nem noktasal: yatağın bir
     * ucu sulanmış, öteki ucu kuru olabiliyor. Onun için köşe başına bir
     * `islak` niteliği taşıyoruz ve gölgelendiriciye tek satır
     * ekliyoruz. Alternatifi bütün malzemeyi elle yazmaktı; bu yama
     * three.js'in kendi ışık hesabına dokunmuyor. */
    yuzeyMal.onBeforeCompile = (gl) => {
      gl.vertexShader = gl.vertexShader
        .replace("#include <common>",
                 "#include <common>\nattribute float islak;\nvarying float vIslak;")
        .replace("#include <begin_vertex>",
                 "#include <begin_vertex>\nvIslak = islak;");
      gl.fragmentShader = gl.fragmentShader
        .replace("#include <common>",
                 "#include <common>\nvarying float vIslak;")
        .replace("#include <roughnessmap_fragment>",
                 "#include <roughnessmap_fragment>\n"
                 + "roughnessFactor *= 1.0 - 0.62 * vIslak;");
    };
    if (doku) {
      // Tekrar sayısı yatağın METRE ölçüsünden: ölçek her kapta aynı, yani
      // küçük kapta doku küçülmüyor — iki kap yan yana dururken tane boyu
      // farkı hemen göze çarpardı.
      const { harita, kabartma } = doku.toprak(THREE, w * dokuOlcek, d * dokuOlcek);
      yuzeyMal.map = harita;
      yuzeyMal.bumpMap = kabartma;
      // Gölge kalktığı için yüzeyin BÜTÜN derinliği artık buradan geliyor;
      // 0.22 gölgeyle birlikte yeterliydi, tek başına yassı kalıyor.
      yuzeyMal.bumpScale = 0.42;
      yuzeyMal.color.set("#ffffff");   // ton dokudan geliyor
    }
    const govdeMal = mal(THREE, {
      color: MAKINE.renk.toprak_koyu, roughness: 1, metalness: 0 });

    alanlar.forEach((alan, sira) => {
      const kapEn = alan.en, kapBoy = alan.boy;
      const yY = alan.yuzeyY || 0;      // bu kabın yüzeyi genel yüzeye göre

      /* Kap duvarları: alanın kendi çevresinde. Duvar DIŞARI taşıyor —
       * `en/boy` ekilebilir iç ölçü, çünkü kullanıcı ayarlara toprağın
       * bulunduğu aralığı giriyor, plastiğin dış ölçüsünü değil. */
      const kapDuvar = (gx, gz, x, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(gx, kapYuk, gz), kapMal);
        m.position.set(alan.mx + x, tabla + yY + kapYuk / 2, alan.mz + z);
        sabit.add(m);
      };
      const dEn = kapEn + cidar * 2, dBoy = kapBoy + cidar * 2;
      kapDuvar(dEn, cidar, 0, -dBoy / 2 + cidar / 2);
      kapDuvar(dEn, cidar, 0, dBoy / 2 - cidar / 2);
      kapDuvar(cidar, dBoy, -dEn / 2 + cidar / 2, 0);
      kapDuvar(cidar, dBoy, dEn / 2 - cidar / 2, 0);

      /* Yandan görünen toprak gövdesi: ALTI tezgâh tablasında, ÜSTÜ bu
       * kabın kendi yüzeyinin 4 mm altında (yüzey ağı onun üstüne
       * oturuyor). Yüksekliği ikisinin farkı.
       *
       * Önce yüksekliği `-tabla + yY`, merkezi de `yY/2` kaydırılarak
       * hesaplanıyordu; iki kaydırma üst üste binince yükseltilmiş kabın
       * KOYU gövdesi kendi toprak yüzeyinin 2 mm ÜSTÜNE çıkıyor ve
       * yüzeyi tamamen örtüyordu. Üstten bakınca o kap simsiyah
       * görünüyordu — toprak orada değil sanılıyordu. */
      const govdeUst = yY - 0.004;
      const govde = new THREE.Mesh(
        new THREE.BoxGeometry(kapEn, govdeUst - tabla, kapBoy), govdeMal);
      govde.position.set(alan.mx, (tabla + govdeUst) / 2, alan.mz);
      govde.userData.golgeAtma = true;
      sabit.add(govde);

      /* Bölüntü sayısı Pi düşünülerek seçildi: 425×550 mm'lik tek kapta
       * 48×64 ≈ 6 bin üçgen. Alan küçüldükçe bölüntü de küçülüyor, yoksa
       * iki kap dört kap olunca üçgen sayısı ikiye katlanırdı. Alt sınır
       * 8: daha azı karığı köşeli gösteriyor. */
      const bolX = Math.max(8, Math.round(48 * (kapEn / 0.425)));
      const bolZ = Math.max(8, Math.round(64 * (kapBoy / 0.55)));
      const geo = new THREE.PlaneGeometry(kapEn, kapBoy, bolX, bolZ);
      geo.rotateX(-Math.PI / 2);
      const konum = geo.attributes.position;
      const karikSayi = MAKINE.yatak.karik_sayisi;
      // 9 mm derin + 26 mm yarı genişlikte oyuk denendi: duvarı o kadar
      // dik oluyor ki ışığı hiç almıyor ve karık, toprakta açılmış
      // simsiyah bir yarık gibi duruyordu. 5/34 gerçek bir karığın
      // eğimi — dibi gölgede ama okunuyor.
      const karikDerin = M(5);
      const karikGenis = M(34);             // oyuğun yarı genişliği
      // Tohum alan adından: iki kap aynı gürültüyü taşımasın, kopyalanmış
      // gibi durmasınlar.
      // 24'te kabin icinde sayili tumsek olusuyor ve goz onlari tek tek
      // sayabiliyor — dogal degil. 40'ta topak boyu gercege yaklasiyor.
      const N = 40;
      const puruz = doku ? doku.alan(N, 3, doku.tohumla("toprak-puruz-" + (alan.ad || sira)))
                         : new Float32Array(N * N).fill(0.5);
      for (let i = 0; i < konum.count; i++) {
        const x = konum.getX(i), z = konum.getZ(i);
        // Karık: kabın uzun kenarı boyunca sıralar
        let y = 0;
        for (let k = 1; k <= karikSayi; k++) {
          const merkez = -kapBoy / 2 + (kapBoy * k) / (karikSayi + 1);
          const u = Math.abs(z - merkez) / karikGenis;
          if (u < 1) y -= karikDerin * (0.5 + 0.5 * Math.cos(u * Math.PI));
        }
        // Kenarda toprak biraz yükselir (kabın duvarına yaslanmış toprak)
        const kx = Math.abs(x) / (kapEn / 2), kz = Math.abs(z) / (kapBoy / 2);
        y -= M(2.5) * (1 - Math.max(kx, kz));
        // Pürüz
        const ix = Math.min(N - 1, Math.max(0, Math.floor((x / kapEn + 0.5) * N)));
        const iz = Math.min(N - 1, Math.max(0, Math.floor((z / kapBoy + 0.5) * N)));
        // Karik kalkinca yuzeyin BUTUN kabartmasi buradan geliyor; 3.5 mm
        // duz bir levha gibi kaliyordu. 9 mm gercek bir yatakta elle
        // duzeltilmis topragin topak farki.
        y += (puruz[iz * N + ix] - 0.5) * M(9.0);
        konum.setY(i, Math.min(0, y));
      }
      geo.computeVertexNormals();
      // Nem renkleri için köşe rengi alanı — başlangıçta hepsi beyaz (çarpan 1).
      geo.setAttribute("color",
        new THREE.BufferAttribute(new Float32Array(konum.count * 3).fill(1), 3));
      // Islaklık 0..1 — hem koyuluğu hem parlaklığı süren tek değer.
      geo.setAttribute("islak",
        new THREE.BufferAttribute(new Float32Array(konum.count), 1));

      const toprak = new THREE.Mesh(geo, yuzeyMal);
      toprak.position.set(alan.mx, yY, alan.mz);
      /* TOPRAK GÖLGE ALMIYOR. Portalın gölgesi toprağın üstüne keskin,
       * düz kenarlı bir bant olarak düşüyordu: gölge haritası bu ölçekte
       * kaba ve toprağın kendi kabartması yanında yapay duruyor — asıl
       * derinliği zaten dokunun eğim gölgelendirmesi veriyor.
       *
       * Kapların duvarları ve tezgâh gölge almaya devam ediyor; sahnenin
       * oturmuşluğu oradan geliyor, düz toprak yüzeyinden değil. */
      // Bayrak ŞART: aşağıdaki `golgeVer` bütün ağları gezip receiveShadow
      // yazıyor ve buradaki doğrudan atamayı ezerdi.
      toprak.userData.golgeAlmaz = true;
      toprak.receiveShadow = false;
      // Gölge ALIYOR ama ATMIYOR: 6 bin üçgenlik yüzeyi gölge geçişinde bir
      // daha çizmenin gözle görülür karşılığı yok.
      toprak.userData.golgeAtma = true;
      // İsim aynı kalıyor: `nemBoya` bütün yüzeyleri bu adla topluyor.
      toprak.name = "toprak-yuzey";
      toprak.userData.alanAdi = alan.ad || "";
      sabit.add(toprak);
    });

    /* --- yan raylar ARTIK AYRI ÇİZİLMİYOR ---------------------------------
     * Yukarıdaki çevre çerçevesinin uzun kenarları zaten köprünün rayı.
     * Eskiden burada ikinci bir sıra profil vardı ve makinede iki kat
     * sigma görünüyordu; gerçekte tek sıra var. */

    /* --- tohumluk BURADA ÇİZİLMİYOR ---------------------------------------
     * Eskiden burada yaklasik konumlu, 3x4 duzgun delikli bir sus tepsisi
     * vardi ve yorumunda "gercek koordinat verilirse buraya baglanir"
     * yaziyordu. Koordinatlar geldi: gozler artik `uclar.json`da, her
     * birinin kendi X/Y/Z'siyle.
     *
     * Cizim `katmanlar/20-uc-yuvalari.js`e tasindi, cunku tepsi ORADA
     * gercek koordinatlardan turuyor ve gozun dolu/bos durumunu da
     * gosteriyor. Ikisini birden cizmek, sahnede biri dogru biri yanlis
     * yerde iki tohumluk demekti — bu projede en pahali hata sinifi,
     * "sahnede gordugum yer makinenin gittigi yer" varsayimini bozan sey.
     */
    }  /* sabitIster */

    /* GÖLGE. Bir ağ gölge haritasına ancak castShadow ile giriyor; bayrak
     * hiç konmadığı için ışık vardı ama gölge yoktu ve her şey aynı
     * düzlemde duruyordu.
     *
     * İki ayrı bayrak var ve ikisi de gerekiyor:
     *   golgeAtma  — gölge haritasına girmesin (çizim maliyeti)
     *   golgeAlmaz — üstüne gölge düşmesin (görünüm)
     *
     * Toprak ikisini de taşıyor. Gölge ALMAMASININ sebebi görünüm:
     * portalın gölgesi toprağın üstüne keskin, düz kenarlı bir bant
     * olarak düşüyordu — gölge haritası bu ölçekte kaba ve toprağın
     * kendi kabartması yanında yapay duruyordu. */
    const golgeVer = (kok) => kok && kok.traverse((n) => {
      if (!n.isMesh) return;
      n.castShadow = !n.userData.golgeAtma;
      n.receiveShadow = !n.userData.golgeAlmaz;
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
      mal(THREE, CELIK));
    vida.position.x = P * 0.5;
    sutun.add(vida);
    kizak.add(sutun);

    /* --- uç kafası: alet taşıyıcı + uç ----------------------------------- */
    /* --- UÇ KAFASI ---------------------------------------------------------
     * Fotoğraftaki parça: 3B baskı SİYAH bir gövde, altında vidalı bir
     * bağlantı plakası, plakadan aşağı inen ince uç. Metal değil plastik —
     * mat, koyu, keskin köşeli.
     *
     * Eski hâli bir kutu + turkuaz koniydi. Turkuaz sahnedeki tek doygun
     * renkti ve gözü kendine çekiyordu; makinede öyle bir renk yok.
     * Aynısını modellemiyoruz ama siluet andırsın diye üç parçaya
     * bölündü: üst blok, alt bağlantı plakası, uç.
     */
    const ucKafa = new THREE.Group();
    // Baskı plastiği: mat siyah, hafif gri. Metal DEĞİL — metalness 0.
    const baski = { color: "#1e2124", metalness: 0.04, roughness: 0.72 };

    // Üst blok — kızağa bakan gövde. Fotoğrafta üstünde iki kanal var.
    ucKafa.add(kutu(THREE, [P * 2.2, P * 2.4, P * 1.9], [P * 1.1, P * 1.5, 0], baski));
    [-0.45, 0.45].forEach((k) => {
      ucKafa.add(kutu(THREE, [P * 0.5, P * 0.32, P * 1.5],
                      [P * 1.1 + P * 0.55 * k, P * 2.66, 0],
                      { color: "#15181a", metalness: 0.04, roughness: 0.8 }));
    });
    // Alt bağlantı plakası — fotoğrafta gövdeden öne taşıyor ve vidalı.
    /* Alt plaka İKİ UCU birden taşıyor: sağda vakum/ekim ucu, solda
     * sulama başlığı. Plaka o yüzden geniş. */
    /* Plaka İKİ UCU birden taşıyor ve KAFANIN ALTINDA duruyor. Önce
     * merkezi kafadan kaymıştı ve plaka sağa doğru sarkıyordu; iki uç da
     * plakanın bir ucuna toplanmıştı. Merkez artık kafanın merkeziyle
     * aynı, iki uç merkeze göre simetrik. */
    ucKafa.add(kutu(THREE, [P * 3.4, P * 0.34, P * 2.4], [P * 1.5, P * 0.12, 0], baski));
    // Plakadaki vida başları: dört köşe, küçük ve parlak.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([ix, iz]) => {
      const v = new THREE.Mesh(
        new THREE.CylinderGeometry(P * 0.12, P * 0.12, P * 0.1, 8),
        mal(THREE, { color: "#9aa1a8", metalness: 0.85, roughness: 0.3 }));
      v.position.set(P * 1.5 + ix * P * 1.4, P * 0.3, iz * P * 0.85);
      ucKafa.add(v);
    });
    /* --- ÜÇ BAŞ YAN YANA ---------------------------------------------------
     * Makinede Z ekseninin ucunda üç baş KALICI olarak vidalı: soldaki
     * sulama başlığı, ortadaki toprak nemi probu, sağdaki tohum alma ucu.
     * Eskiden burada tek bir koni vardı ve "takılı uç" onu temsil
     * ediyordu; artık üçü birden çiziliyor.
     *
     * YERLERİ GERÇEK KAYMADAN GELİYOR. `opt.baslar` durum paketindeki
     * `dx/dy`yi taşıyor ve baş o kadar KAYMIŞ çiziliyor — ekranda
     * gördüğünüz aralık makinedeki aralık. Kayma yoksa varsayılan bir
     * dizilim kullanılıyor (üçü birbirine değmesin diye), ama o zaman da
     * ayarların girilmediği belli oluyor.
     */
    const nemProbu = new THREE.Group();
    // Prob gövdesi: kısa siyah blok, altında ince paslanmaz çubuk.
    nemProbu.add(kutu(THREE, [P * 0.5, P * 0.7, P * 0.5], [0, -P * 0.25, 0],
                      { color: "#1a1d20", metalness: 0.1, roughness: 0.7 }));
    const cubuk = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.05, P * 0.04, P * 1.4, 8),
      mal(THREE, { color: "#c9ced3", metalness: 0.9, roughness: 0.25 }));
    cubuk.position.set(0, -P * 1.3, 0);
    nemProbu.add(cubuk);
    ucKafa.add(nemProbu);

    /* TOHUM UCU KENDİ GRUBUNDA: kendi dikey ekseni var (PLC'de j4) ve
     * indiğinde SAHNEDE de iniyor. Grubu ayrı olmasaydı ana Z ile
     * birlikte hareket eder, kendi hareketi görünmezdi. */
    const tohumUcu = new THREE.Group();
    // Kırmızı taşıyıcı ve üstündeki motor — fotoğraftaki gibi.
    tohumUcu.add(kutu(THREE, [P * 0.55, P * 1.5, P * 0.6], [0, P * 0.5, 0],
                      { color: "#b6382c", metalness: 0.05, roughness: 0.75 }));
    tohumUcu.add(kutu(THREE, [P * 0.7, P * 0.7, P * 0.7], [0, P * 1.6, 0],
                      { color: "#2b2f33", metalness: 0.5, roughness: 0.4 }));
    const uc = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.12, P * 0.06, P * 1.6, 12),
      mal(THREE, { color: "#2a2e31", metalness: 0.35, roughness: 0.5 }));
    uc.position.set(0, -P * 0.9, 0);
    tohumUcu.add(uc);
    ucKafa.add(tohumUcu);

    // Kaymaları uygula. `mmP` bir milimetrenin sahnedeki karşılığı.
    const bslr = opt.baslar || {};
    const mmP = opt.mmP || 1;
    const yerlestir = (grup, kimlik, yedekX) => {
      const b = bslr[kimlik];
      const varMi = b && (Number(b.dx) || Number(b.dy));
      grup.position.x = varMi ? -Number(b.dx || 0) * mmP : yedekX;
      grup.position.z = varMi ? -Number(b.dy || 0) * mmP : 0;
    };
    // İŞARET TERS: `dx` "makine bu kadar kayarak gider" demek, yani baş
    // merkezin TERS yönünde duruyor. Sahnede kaymayı olduğu gibi
    // uygulasaydık başlar gerçekte oldukları yerin aynasında görünürdü.
    yerlestir(nemProbu, "nem", 0);
    yerlestir(tohumUcu, "tohum", P * 2.4);
    // Merkez işareti: Z ekseninin gerçek merkezi. Üç baş da bunun
    // etrafında duruyor ve hiçbiri tam ortada değil — bunu göstermek
    // kaymaların neden var olduğunu anlatan tek şey.
    const merkezIsaret = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.03, P * 0.03, P * 0.5, 6),
      mal(THREE, { color: "#6f7a80", metalness: 0.3, roughness: 0.6 }));
    merkezIsaret.position.set(0, -P * 0.2, 0);
    ucKafa.add(merkezIsaret);
    ucKafa.userData.nemProbu = nemProbu;
    ucKafa.userData.tohumUcu = tohumUcu;
    ucKafa.userData.tohumUcuY = tohumUcu.position.y;

    /* --- SULAMA BAŞLIĞI ----------------------------------------------------
     * Z eksenine KALICI olarak bağlı: uç değişse de o duruyor. Fotoğrafta
     * ucun solunda, siyah silindirik bir başlık ve ona yukarıdan gelen ince
     * bir hortum var.
     *
     * Konumu `uclar.json`daki `sulama_basligi.dx/dy` ofsetinden geliyor —
     * sulama hesabının kullandığı SAYININ AYNISI. Ayrı yazsaydık ikisi
     * ayrışır ve sahnede su bir yere, gerçekte başka yere düşerdi.
     */
    /* Başlık ALT PLAKANIN ALTINDA, vakum ucunun solunda.
     *
     * İki kez yanlış yere kondu. Önce `sulama_basligi.dx/dy` ayarından
     * türetiliyordu ve ayar +50/+50 olduğu için sağa düşüyordu. Sonra
     * sabit olarak -P*1.5'e alındı; orası Z sütununun dibi, yani başlık
     * OYNAYAN kafaya değil İSKELETE takılmış gibi duruyordu.
     *
     * Doğru yer burası: kafanın alt plakasından aşağı sarkıyor, tıpkı
     * vakum ucu gibi. İkisi yan yana, ikisi de aşağı bakıyor, ikisi de
     * Z ile birlikte iniyor.
     *
     * ARTIK YERİ AYARDAN GELİYOR. Önce sabit bir noktadaydı ve "başlık
     * 60 mm solda" ayarı ekranda görünmüyordu; üç baş birden çizilirken
     * bu tutarsızlık göze batar hâle geldi. Kayma girilmemişse eski
     * sabit yer kullanılıyor. */
    const basY = -P * 0.62;
    const baslik = new THREE.Group();
    const sb = (opt.baslar || {}).sulama;
    const sbVar = sb && (Number(sb.dx) || Number(sb.dy));
    baslik.position.set(
      sbVar ? -Number(sb.dx || 0) * (opt.mmP || 1) : P * 0.6,
      basY,
      sbVar ? -Number(sb.dy || 0) * (opt.mmP || 1) : 0);
    /* Başlık gövdesi — KISA ve GENİŞ silindir, altı delikli.
     *
     * Önce ince bir silindirdi ve sahnede uç kafasının gölgesinde
     * kayboluyordu; kullanıcı "başlık yok" dedi, haklıydı. Duş başlığı
     * gibi okunması için çapı büyütüldü ve alt yüzüne delikler açıldı —
     * ayırt edici olan biçim değil, o delikler.
     */
    const bg = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.66, P * 0.78, P * 0.66, 18),
      mal(THREE, { color: "#17191b", metalness: 0.1, roughness: 0.62 }));
    baslik.add(bg);
    // Alt yüzeydeki delik deseni: ortada bir, çevresinde altı.
    const delikMal2 = mal(THREE, { color: "#050607", metalness: 0.05, roughness: 1 });
    const delikYer = [[0, 0]];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      delikYer.push([Math.cos(a) * P * 0.42, Math.sin(a) * P * 0.42]);
    }
    delikYer.forEach(([dx2, dz2]) => {
      const dl = new THREE.Mesh(
        new THREE.CylinderGeometry(P * 0.09, P * 0.09, P * 0.14, 8), delikMal2);
      dl.position.set(dx2, -P * 0.26, dz2);
      baslik.add(dl);
    });
    // Deliklerin oturduğu tabla — gövdeden biraz taşan ince disk.
    const tabla2 = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.76, P * 0.76, P * 0.08, 18),
      mal(THREE, { color: "#101214", metalness: 0.12, roughness: 0.6 }));
    tabla2.position.y = -P * 0.3;
    baslik.add(tabla2);
    // Üstteki rakor
    const rakor = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.17, P * 0.17, P * 0.4, 10),
      mal(THREE, { color: "#8f969d", metalness: 0.8, roughness: 0.32 }));
    rakor.position.y = P * 0.5;
    baslik.add(rakor);
    // Hortum: yukarı giden ince beyaz boru.
    const hortum = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.09, P * 0.09, P * 3.4, 8),
      mal(THREE, { color: "#d9dde0", metalness: 0.05, roughness: 0.55 }));
    hortum.position.y = P * 2.4;
    baslik.add(hortum);
    /* KOL YOK. Başlığı Z sütununa uzatan bir kol vardı; başlık iskelete
     * takılı görünmesinin sebebi oydu. Başlık artık kafanın kendi
     * plakasına asılı, ayrı bir bağlantı parçası gerekmiyor. */
    ucKafa.add(baslik);

    /* SU HUZMESİ. Pompa açıkken görünüyor, kapalıyken değil — 90-robot.js
     * röle durumundan sürüyor. Konisi aşağı doğru hafif açılıyor: gerçek
     * bir başlıktan çıkan su da dağılıyor.
     *
     * Boyu 1 birim kuruluyor ve her karede toprağa kadar UZATILIYOR:
     * yükseklik uçla birlikte değişiyor, sabit bir boy ya toprağın içine
     * girer ya havada kalırdı. */
    const suMal = new THREE.MeshStandardMaterial({
      color: "#8fd4ee", transparent: true, opacity: 0.42,
      roughness: 0.12, metalness: 0.0, depthWrite: false,
      emissive: new THREE.Color("#4aa8d8"), emissiveIntensity: 0.25,
    });
    const su = new THREE.Mesh(
      new THREE.CylinderGeometry(P * 0.1, P * 0.3, 1, 12, 1, true), suMal);
    // Huzme deliklerin ALTINDAN başlıyor, gövdenin ortasından değil.
    su.position.copy(baslik.position);
    su.position.y -= P * 0.30;
    su.visible = false;
    su.raycast = () => {};
    su.userData.golgeAtma = true;
    su.userData.golgeAlmaz = true;
    ucKafa.add(su);
    ucKafa.userData.su = su;
    ucKafa.userData.baslikY = basY;
    kizak.add(ucKafa);

    portal.add(kizak);
    golgeVer(portal);
    return { sabit: sabit, portal: portal, kizak: kizak, sutun: sutun,
             ucKafa: ucKafa, su: ucKafa.userData.su };
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
    // Dikim alanı başına bir yüzey var; hepsi aynı adı taşıyor. Eskiden
    // traverse son bulduğunu tutuyordu — iki kapta yalnız ikincisi
    // boyanırdı, birincisi hep kuru görünürdü.
    const yuzeyler = [];
    kok.traverse((n) => { if (n.name === "toprak-yuzey") yuzeyler.push(n); });
    if (!yuzeyler.length) return false;

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
    let boyandi = false;
    yuzeyler.forEach((toprak) => {
      const renk = toprak.geometry.getAttribute("color");
      const konum = toprak.geometry.getAttribute("position");
      const islakNit = toprak.geometry.getAttribute("islak");
      if (!renk) return;
      boyandi = true;
      // Köşe konumları AĞIN KENDİ uzayında; okumalar sahne uzayında.
      // Alanın kendi kaydırması olduğu için ikisi artık aynı değil.
      const ox = toprak.position.x, oz = toprak.position.z;
      for (let i = 0; i < renk.count; i++) {
        const x = konum.getX(i) + ox, y = konum.getY(i), z = konum.getZ(i) + oz;
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
        // Karık dibi de biraz nemli sayılıyor: su orada duruyor.
        if (islakNit) islakNit.setX(i, Math.min(1, islak + cukur * 0.25));
      }
      renk.needsUpdate = true;
      if (islakNit) islakNit.needsUpdate = true;
    });
    return boyandi;
  }

  /* Geometri kurucu: makine.js dışındaki hiçbir dosya `new BoxGeometry` ile
   * makine parçası kurmuyor, hepsi buradan geliyor. */
  window.FarmbotMakine = { kur: kur, nemBoya: nemBoya, P: P, AYAK: AYAK, veri: MAKINE };
  /* Ölçü/renk tablosu: katmanlar ve tarla.js `MAKINE.renk.toprak` gibi
   * okuyor. Aynı nesne — iki isim, tek kaynak. */
  window.MAKINE = MAKINE;
})();
