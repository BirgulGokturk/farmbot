/* Tarla tasarımcısı — 3B yatak görünümü.
 *
 * Neden ayrı dosya, neden düz JavaScript
 * --------------------------------------
 * Panelin geri kalanı gibi derleme adımı yok: `three.min.js` tıpkı
 * `chart.umd.js` gibi yerel bir dosya ve global `THREE` bırakıyor. Pi
 * internetsiz çalışacağı için CDN, ES modülü ya da import haritası yok.
 * React / R3F de yok — sahne elle kuruluyor, OrbitControls yerine ~70
 * satırlık kendi yörünge denetimimiz var (o modül bu sürümde yalnızca ESM
 * olarak geliyor).
 *
 * Veri nereden geliyor
 * --------------------
 *   - Tür kataloğu : GET /api/turler       (docs/bitki_turleri.json)
 *   - Bitkiler     : mevcut NOKTA DEPOSU   (/api/noktalar)
 *   - Yatak ölçüsü : durum.sinirlar        (ajandan; sabit yazılmıyor)
 *   - Robot konumu : durum.konum           (canlı)
 *
 * Bitki için paralel bir depo kurulmadı: bitki, `tur` ve `ekim` alanları
 * taşıyan sıradan bir nokta. Böylece "buraya git" mevcut git komutu, sınır
 * denetimi mevcut denetim, yedekleme mevcut yedekleme oluyor.
 *
 * Panelle bağ: app.js `window.Panel` altında komutGonder/apiIste/gunluk/S
 * veriyor; buradan dışarıya `window.Tarla` çıkıyor. İki dosya birbirinin iç
 * değişkenine dokunmuyor.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------ sabitler */
  const MM = 0.001;              // 1 mm = 0.001 sahne birimi (metre)
  const RAY_MM = 520;            // ray yüksekliği — eski sahnedeki değer
  const KENAR_MM = 150;          // yatak dışına tıklanabilen pay

  const RENK = {
    toprak: "#4a3b2c", toprakKoyu: "#3a2e22",
    cerceve: "#8d9490", ray: "#6e7873",
    uc: "#0f6e72", ucKoyu: "#3d4a46",
    ok: "#5f9e46", uyari: "#c08b2a", kritik: "#c2503a", hedef: "#2a78d6",
    arka: "#0e1210", govde: "#4a7c35",
  };

  /* Fotoğraf dokusu eklemek için ayrılmış alan.
   *
   * Buraya dosya ADI yazılır (örn. toprak: "toprak.jpg"), dosyalar
   * `sunucu/static/doku/` altına konur. Depoda hiç doku dosyası YOK ve
   * indirilmedi: telifsiz olduğundan emin olmadığımız görseli koymuyoruz.
   * Kendi çektiğiniz ya da lisansını doğruladığınız görselleri ekleyip
   * aşağıdaki satırları doldurmanız yeterli — kod tarafında başka
   * değişiklik gerekmiyor.
   */
  const DOKU = {
    toprak: null,          // yatak yüzeyi
    cerceve: null,         // profil / ray
    bitki: {},             // { "domates": "domates.png", ... } — yaprak dokusu
  };

  const VARSAYILAN_SINIR = { x: { min: 0, max: 425 }, y: { min: 0, max: 600 }, z: { min: 0, max: 550 } };

  /* --------------------------------------------------------------- durum */
  const T = {
    hazir: false,
    gorunur: false,
    turler: [],
    turHarita: {},
    bitkiler: [],          // {nokta, tur, grup, halka, disk, r_mm, disi, cakisma[]}
    secili: null,          // seçili bitki kaydı
    ekleme: false,
    simgeler: true,
    sinir: VARSAYILAN_SINIR,
    guvenliZ: 280,
    konum: null,
    surukleme: null,
    sonNoktaImzasi: "",
  };

  const P = () => window.Panel || {};
  const gunluk = (m, s) => (P().gunluk ? P().gunluk(m, s) : console.log(m));
  const $ = (s) => document.querySelector(s);

  /* three.js nesneleri */
  let sahne, kamera, kameraUst, ciz, tuval, isikYon;
  let yatakGrup, portal, kizak, sutun, ucKafa, secimHalkasi, hedefHalka;
  let secmeDuzlem, bitkiKok;
  let genislikM = 0.425, derinlikM = 0.6;

  const kam = { theta: Math.PI * 0.22, phi: Math.PI * 0.30, r: 1.6, hedef: null, ust: false, yakinlik: 1 };

  /** O an çizen kamera — üstten görünümde ortografik olan. */
  const etkinKamera = () => (kam.ust ? kameraUst : kamera);

  /* ----------------------------------------------------------- yardımcı */
  const kis = (d, a, b) => Math.max(a, Math.min(b, d));
  const say = (d, b = 0) => (d == null || Number.isNaN(d) ? "—" : Number(d).toFixed(b));

  function kacisli(metin) {
    return String(metin).replace(/[&<>"']/g, (k) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[k]));
  }

  /** Makine mm → sahne koordinatı. X→x, Y→z; yatak merkezi orijinde. */
  const sx = (mx) => (mx - T.sinir.x.min) * MM - genislikM / 2;
  const sz = (my) => (my - T.sinir.y.min) * MM - derinlikM / 2;
  /** Sahne → makine mm (tersi). */
  const mx = (x) => (x + genislikM / 2) / MM + T.sinir.x.min;
  const my = (z) => (z + derinlikM / 2) / MM + T.sinir.y.min;

  function dokuYukle(malzeme, ad) {
    const dosya = ad && DOKU[ad];
    if (!dosya) return;                       // alan boş — düz renk kalıyor
    const doku = new THREE.TextureLoader().load(`/statik/doku/${dosya}`);
    doku.wrapS = doku.wrapT = THREE.RepeatWrapping;
    doku.repeat.set(4, 4);
    malzeme.map = doku;
    malzeme.needsUpdate = true;
  }

  function malzeme(renk, opt = {}) {
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(renk), roughness: 0.9, metalness: 0.05, ...opt });
  }

  /* --------------------------------------------------------- sahne kurma */
  function sahneyiKur() {
    tuval = $("#tarla-tuval");
    sahne = new THREE.Scene();
    sahne.background = new THREE.Color(RENK.arka);

    kamera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
    // Üstten görünüm ortografik: perspektifte 520 mm'lik direkler yatağın
    // üstüne devriliyor, "kuş bakışı" plan olmaktan çıkıyordu. Ortografikte
    // ekrandaki mesafe ile gerçek mm doğru orantılı — ölçü almak da kolay.
    kameraUst = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
    kam.hedef = new THREE.Vector3(0, 0.15, 0);

    ciz = new THREE.WebGLRenderer({ canvas: tuval, antialias: true });
    // Pi'nin GPU'su mütevazı: piksel oranını 2 ile sınırlıyoruz, gölge yok.
    ciz.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    sahne.add(new THREE.HemisphereLight(0xdfe9e2, 0x2a2f28, 1.15));
    isikYon = new THREE.DirectionalLight(0xffffff, 1.5);
    isikYon.position.set(2.4, 3.2, 1.8);
    sahne.add(isikYon);

    yatakGrup = new THREE.Group();
    sahne.add(yatakGrup);
    bitkiKok = new THREE.Group();
    sahne.add(bitkiKok);

    hedefHalka = new THREE.Mesh(
      new THREE.RingGeometry(0.045, 0.062, 40),
      new THREE.MeshBasicMaterial({ color: RENK.hedef, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    hedefHalka.rotation.x = -Math.PI / 2;
    hedefHalka.position.y = 0.004;
    hedefHalka.visible = false;
    sahne.add(hedefHalka);

    secimHalkasi = new THREE.Mesh(
      new THREE.RingGeometry(0.028, 0.036, 32),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    secimHalkasi.rotation.x = -Math.PI / 2;
    secimHalkasi.position.y = 0.006;
    secimHalkasi.visible = false;
    sahne.add(secimHalkasi);

    yatagiYap();
    olaylariBagla();
    boyutla();          // en-boy oranı belli olsun ki kadraj doğru hesaplansın
    kamerayiSigdir();
    dongu();
  }

  /** Yatak, çerçeve, raylar ve portal — ölçüler `durum.sinirlar`dan. */
  function yatagiYap() {
    while (yatakGrup.children.length) {
      const c = yatakGrup.children.pop();
      c.traverse((n) => { if (n.geometry) n.geometry.dispose(); });
    }
    const w = genislikM, d = derinlikM, rayY = RAY_MM * MM;

    const toprakMal = malzeme(RENK.toprak);
    dokuYukle(toprakMal, "toprak");
    const yatak = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), toprakMal);
    yatak.position.y = -0.06;
    yatakGrup.add(yatak);

    // Karıklar: yüzeyi düz bir kahverengi levha olmaktan çıkarıyor.
    const karikMal = new THREE.MeshStandardMaterial({ color: RENK.toprakKoyu, roughness: 1 });
    for (let i = 0; i < 7; i++) {
      const karik = new THREE.Mesh(new THREE.BoxGeometry(w * 0.97, 0.004, d / 26), karikMal);
      karik.position.set(0, 0.002, -d / 2 + (d * (i + 1)) / 8);
      yatakGrup.add(karik);
    }

    // Makine gövdesi (kap, çerçeve, ayaklar, raylar, portal) makine.js'te.
    // Ayrı dosyada duruyor ki görünümü değiştirmek için tasarımcının
    // mantığına dokunmak gerekmesin.
    const makine = window.FarmbotMakine.kur(THREE, { w: w, d: d, rayY: rayY });
    yatakGrup.add(makine.sabit);

    if (portal) sahne.remove(portal);
    portal = makine.portal;
    kizak = makine.kizak;
    sutun = makine.sutun;
    ucKafa = makine.ucKafa;
    sahne.add(portal);
    robotuYerlestir();

    // Görünmez seçme düzlemi: yatağın biraz dışına da tıklanabiliyor ki
    // sınır dışı bir bitki fark edilip içeri sürüklenebilsin.
    if (secmeDuzlem) sahne.remove(secmeDuzlem);
    secmeDuzlem = new THREE.Mesh(
      new THREE.PlaneGeometry(w + KENAR_MM * MM * 2, d + KENAR_MM * MM * 2),
      new THREE.MeshBasicMaterial({ visible: false }));
    secmeDuzlem.rotation.x = -Math.PI / 2;
    sahne.add(secmeDuzlem);
  }

  function robotuYerlestir() {
    if (!portal) return;
    const k = T.konum || {};
    const rayY = RAY_MM * MM;
    const x = k.x == null ? T.sinir.x.min : k.x;
    const y = k.y == null ? T.sinir.y.min : k.y;
    const z = k.z == null ? T.sinir.z.max : k.z;
    portal.position.x = sx(x);
    kizak.position.z = sz(y);
    // Makine Z'si büyüdükçe uç YUKARI çıkıyor (kalibrasyonda dir = -1,
    // home = 438). Uç ucunu doğrudan o yüksekliğe koyuyoruz.
    const ucY = kis(z, 0, T.sinir.z.max || 550) * MM;
    ucKafa.position.set(0, ucY + 0.04, 0);
    const boy = Math.max(0.05, rayY - 0.045 - (ucY + 0.08));
    sutun.scale.y = boy;
    sutun.position.set(0, ucY + 0.08 + boy / 2, 0);
  }

  /* ---------------------------------------------------------- bitkiler */
  /** Yaşa göre olgunluk 0..1 — hasat gününe yaklaştıkça bitki büyüyor. */
  function olgunluk(nokta, tur) {
    const gun = Number(tur && tur.days_to_harvest) || 60;
    if (!nokta.ekim) return 1;
    const yas = (Date.now() / 1000 - Number(nokta.ekim)) / 86400;
    return kis(yas / gun, 0.06, 1);
  }

  function simgeSprite(metin) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.font = "48px system-ui, 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(metin || "🌱", 32, 36);
    const doku = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: doku, transparent: true, depthTest: false }));
    s.scale.set(0.075, 0.075, 1);
    return s;
  }

  /** Prosedürel bitki: gövde + yapraklar. Tür rengi ve yayılımıyla ölçekli.
   *
   *  Ölçek yayılım ÇAPININ yarısına bağlı: olgun bitkinin tacı, altındaki
   *  yayılım halkasını yaklaşık dolduruyor. Böylece "bu bitki bu yatağa
   *  sığmıyor" görüntüden anlaşılıyor — 900 mm'lik bir kabak 425 mm'lik
   *  yatakta gerçekten taşıyor. Taç basık bir kubbe ve hafif saydam;
   *  yoksa üstten bakışta toprağı ve komşu halkaları kapatıyordu.
   */
  function bitkiGorseli(tur, ol) {
    const grup = new THREE.Group();
    const yayilim = Number(tur && tur.spread_mm) || 200;
    const rM = Math.max(0.02, (yayilim / 2) * MM);          // halkayla aynı yarıçap
    // Yeni ekilmiş bitki fide kadar: taç yayılımın onda biriyle başlıyor,
    // hasat gününe yaklaştıkça halkayı dolduruyor.
    const tacR = rM * (0.10 + 0.85 * ol);
    const boy = Math.max(0.015, rM * (0.12 + 0.70 * ol));
    const renk = new THREE.Color((tur && tur.color) || "#5f9e46");

    const govde = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005 * (0.6 + ol), 0.008 * (0.6 + ol), boy, 8),
      malzeme(RENK.govde, { roughness: 0.95 }));
    govde.position.y = boy / 2;
    grup.add(govde);

    // Yapraklar yeşil, ortadaki taç tür rengi: her şeyi tür rengiyle boyamak
    // domatesi kıpkırmızı bir yıldıza çeviriyordu. Tür rengi yeşile doğru
    // karıştırılıyor ki türler yine ayırt edilsin.
    // Kırmızıyı yeşile doğru karıştırmak kahverengi veriyordu; onun yerine
    // yaprak tonu yeşilden başlıyor ve türün tonundan yalnızca biraz
    // etkileniyor (ton %15, doygunluk ve açıklık türden).
    const hsl = { h: 0.25, s: 0.4, l: 0.35 };
    renk.getHSL(hsl);
    const yaprakRenk = new THREE.Color().setHSL(
      0.25 + (hsl.h - 0.25) * 0.15,
      kis(0.30 + hsl.s * 0.20, 0.22, 0.60),
      kis(0.26 + hsl.l * 0.16, 0.20, 0.46));
    const yaprakMal = malzeme(yaprakRenk, { roughness: 0.8, transparent: true, opacity: 0.88 });
    dokuYukle(yaprakMal, null);                     // tür dokusu için ayrılan yer
    const tacMal = malzeme(renk, { roughness: 0.6, transparent: true, opacity: 0.95 });

    // Taç: ortada basık bir kubbe, çevresinde yaprak dilimleri.
    const tac = new THREE.Mesh(new THREE.SphereGeometry(tacR * 0.38, 14, 10), tacMal);
    tac.position.y = boy;
    tac.scale.y = 0.6;
    grup.add(tac);

    const adet = ol < 0.25 ? 3 : ol < 0.6 ? 5 : 7;
    for (let i = 0; i < adet; i++) {
      const aci = (i / adet) * Math.PI * 2 + i * 0.35;
      const yaprak = new THREE.Mesh(new THREE.SphereGeometry(tacR * 0.34, 10, 8), yaprakMal);
      yaprak.scale.set(1.3, 0.22, 0.9);
      const uzak = tacR * 0.62;
      yaprak.position.set(Math.cos(aci) * uzak, boy * (0.75 + 0.25 * (i % 2)), Math.sin(aci) * uzak);
      yaprak.rotation.y = -aci;
      yaprak.rotation.z = -0.18 - 0.12 * (i % 2);
      grup.add(yaprak);
    }

    if (T.simgeler) {
      const s = simgeSprite(tur && tur.icon);
      s.scale.setScalar(kis(rM * 0.45, 0.03, 0.075));
      s.position.y = boy + tacR * 0.45 + 0.025;
      s.userData.simge = true;
      grup.add(s);
    }
    // Görünmez tutamak. Işın testinde yalnızca bu ve bitkinin gövdesi
    // sayılıyor: yayılım dairesi seçilebilir olsaydı 900 mm'lik bir kabak
    // yatağın yarısını kaplar, kamerayı döndürmek için boş yer kalmazdı.
    // Yarıçap bitkinin gövdesi kadar, yayılımı kadar değil: 22–55 mm arası.
    const tut_r = kis(rM * 0.35, 0.022, 0.055);
    const tutamak = new THREE.Mesh(
      new THREE.CylinderGeometry(tut_r, tut_r, boy * 1.25, 10),
      new THREE.MeshBasicMaterial({ visible: false }));
    tutamak.position.y = (boy * 1.25) / 2;
    grup.add(tutamak);

    grup.userData.boy = boy;
    return grup;
  }

  /** Nokta deposundaki bitkileri (tur alanı olan noktaları) sahneye kurar. */
  function bitkileriKur(noktalar) {
    while (bitkiKok.children.length) {
      const c = bitkiKok.children.pop();
      c.traverse((n) => { if (n.geometry) n.geometry.dispose(); });
    }
    T.bitkiler = [];
    (noktalar || []).filter((n) => n && n.tur).forEach((nokta) => {
      const tur = T.turHarita[nokta.tur] || { name_tr: nokta.tur, spread_mm: 200, color: "#5f9e46", icon: "🌱" };
      const r_mm = (Number(tur.spread_mm) || 200) / 2;
      const grup = new THREE.Group();

      const disk = new THREE.Mesh(
        new THREE.CircleGeometry(r_mm * MM, 48),
        new THREE.MeshBasicMaterial({ color: RENK.ok, transparent: true, opacity: 0.10, side: THREE.DoubleSide }));
      disk.rotation.x = -Math.PI / 2;
      disk.position.y = 0.0015;
      grup.add(disk);

      const halka = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(0.002, r_mm * MM - 0.004), r_mm * MM, 56),
        new THREE.MeshBasicMaterial({ color: RENK.ok, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      halka.rotation.x = -Math.PI / 2;
      halka.position.y = 0.003;
      grup.add(halka);

      // Daire ve halka ışın testinin dışında: onlar bilgi, tutamak değil.
      disk.raycast = () => {};
      halka.raycast = () => {};

      const gorsel = bitkiGorseli(tur, olgunluk(nokta, tur));
      grup.add(gorsel);

      const kayit = { nokta, tur, grup, halka, disk, r_mm, disi: null, cakisma: [] };
      // Tıklama testinde hangi bitkiye ait olduğunu bulabilmek için işaret.
      grup.traverse((n) => { n.userData.bitki = kayit; });
      grup.position.set(sx(nokta.x), 0, sz(nokta.y));
      bitkiKok.add(grup);
      T.bitkiler.push(kayit);
    });
    cakismalariHesapla();
    secimiTazele();
    sayaciYaz();
  }

  function sinirDisiMi(nokta) {
    const s = T.sinir;
    const disi = [];
    if (nokta.x < s.x.min - 0.5 || nokta.x > s.x.max + 0.5) disi.push("X");
    if (nokta.y < s.y.min - 0.5 || nokta.y > s.y.max + 0.5) disi.push("Y");
    return disi.length ? disi.join(", ") : null;
  }

  /** Yayılım daireleri kesişiyor mu — kesişim mm cinsinden raporlanıyor. */
  function cakismalariHesapla() {
    T.bitkiler.forEach((b) => { b.cakisma = []; b.disi = sinirDisiMi(b.nokta); });
    for (let i = 0; i < T.bitkiler.length; i++) {
      for (let j = i + 1; j < T.bitkiler.length; j++) {
        const a = T.bitkiler[i], b = T.bitkiler[j];
        const uzak = Math.hypot(a.nokta.x - b.nokta.x, a.nokta.y - b.nokta.y);
        const ust = a.r_mm + b.r_mm - uzak;
        if (ust > 0.5) {
          a.cakisma.push({ ad: b.nokta.ad, mm: ust });
          b.cakisma.push({ ad: a.nokta.ad, mm: ust });
        }
      }
    }
    T.bitkiler.forEach((b) => {
      const renk = b.disi ? RENK.kritik : b.cakisma.length ? RENK.uyari : RENK.ok;
      b.halka.material.color.set(renk);
      b.disk.material.color.set(renk);
      b.disk.material.opacity = b.cakisma.length || b.disi ? 0.18 : 0.10;
    });
    uyarilariYaz();
  }

  function uyarilariYaz() {
    const kutu = $("#tarla-cakisma");
    const ciftler = [];
    const gorulen = new Set();
    T.bitkiler.forEach((b) => b.cakisma.forEach((c) => {
      const anahtar = [b.nokta.ad, c.ad].sort().join(" ");
      if (gorulen.has(anahtar)) return;
      gorulen.add(anahtar);
      ciftler.push({ a: b.nokta.ad, b: c.ad, mm: c.mm });
    }));
    const disi = T.bitkiler.filter((b) => b.disi);

    if (!ciftler.length && !disi.length) { kutu.classList.add("gizli"); kutu.innerHTML = ""; return; }
    kutu.classList.remove("gizli");
    let html = "";
    if (ciftler.length) {
      html += `<b>${ciftler.length} çakışma</b> — yayılım daireleri kesişen bitkiler:`;
      html += ciftler.sort((u, v) => v.mm - u.mm).map((c) =>
        `<div class="cakisma-satir">⚠ ${kacisli(c.a)} ↔ ${kacisli(c.b)} <b>${say(c.mm, 0)} mm</b> iç içe</div>`).join("");
    }
    if (disi.length) {
      html += `<div class="cakisma-satir" style="margin-top:8px">⛔ <b>${disi.length} bitki sınır dışında</b>: ` +
        disi.map((b) => `${kacisli(b.nokta.ad)} (${b.disi})`).join(", ") +
        ` — kayıt duruyor ama hareket ajanda reddedilir.</div>`;
    }
    kutu.innerHTML = html;
  }

  function sayaciYaz() {
    const n = T.bitkiler.length;
    const su = T.bitkiler.reduce((t, b) => t + (Number(b.tur.water_ml_per_day) || 0), 0);
    $("#tarla-sayi").textContent = n
      ? `${n} bitki · günlük ${say(su / 1000, 1)} L su`
      : "Henüz bitki yok";
  }

  /* ------------------------------------------------------------- seçim */
  function sec(kayit) {
    T.secili = kayit;
    secimiTazele();
    karti(kayit);
  }

  function secimiTazele() {
    if (T.secili && !T.bitkiler.includes(T.secili)) {
      // Liste yenilendi: aynı adı taşıyan yeni kaydı bul.
      const ad = T.secili.nokta.ad;
      T.secili = T.bitkiler.find((b) => b.nokta.ad === ad) || null;
      if (T.secili) karti(T.secili); else karti(null);
    }
    secimHalkasi.visible = !!T.secili;
    if (T.secili) {
      // Seçim halkası bitkinin yayılımıyla büyümüyor: 25–55 mm arası kalıyor,
      // yoksa 900 mm'lik bir bitkide beyaz halka yatağı kaplıyordu.
      const r = kis(T.secili.r_mm * MM * 0.35, 0.025, 0.055);
      secimHalkasi.scale.set(r / 0.032, r / 0.032, 1);
      secimHalkasi.position.set(T.secili.grup.position.x, 0.006, T.secili.grup.position.z);
    }
  }

  function karti(kayit) {
    const kutu = $("#tarla-kart");
    if (!kayit) { kutu.classList.add("gizli"); kutu.innerHTML = ""; return; }
    const t = kayit.tur, n = kayit.nokta;
    const ol = olgunluk(n, t);
    const gun = n.ekim ? Math.floor((Date.now() / 1000 - Number(n.ekim)) / 86400) : null;
    const hasat = Number(t.days_to_harvest) || null;
    const kalan = gun != null && hasat ? Math.max(0, hasat - gun) : null;

    kutu.classList.remove("gizli");
    kutu.innerHTML = `
      <div class="tarla-kart-bas">
        <span class="simge">${kacisli(t.icon || "🌱")}</span>
        <div>
          <b>${kacisli(t.name_tr || n.tur)}</b>
          <div class="alt-not">${kacisli(n.ad)} · X${say(n.x, 1)} Y${say(n.y, 1)} Z${say(n.z, 1)}</div>
        </div>
        <button class="kapat" id="d-tarla-kapat" title="Kapat">✕</button>
      </div>
      ${kayit.disi ? `<div class="rozet-uyari">⛔ ${kayit.disi} sınır dışı</div>` : ""}
      ${kayit.cakisma.length ? `<div class="rozet-uyari">⚠ ${kayit.cakisma.map((c) =>
        `${kacisli(c.ad)} ile ${say(c.mm, 0)} mm`).join(", ")} çakışıyor</div>` : ""}
      <table class="tarla-ozellik">
        <tr><td>Ekim derinliği</td><td><b>${say(t.sow_depth_mm, 0)} mm</b></td></tr>
        <tr><td>Hasat süresi</td><td><b>${say(t.days_to_harvest, 0)} gün</b>${kalan != null ? ` <span class="alt-not">(${kalan} gün kaldı)</span>` : ""}</td></tr>
        <tr><td>Günlük su</td><td><b>${say(t.water_ml_per_day, 0)} ml</b></td></tr>
        <tr><td>Yayılım</td><td><b>${say(t.spread_mm, 0)} mm</b></td></tr>
        <tr><td>Işık</td><td><b>${t.sun_requirement === "FULL" ? "Tam güneş" : t.sun_requirement === "PARTIAL" ? "Yarı gölge" : "—"}</b></td></tr>
        <tr><td>Büyüme</td><td><b>%${say(ol * 100, 0)}</b>${gun != null ? ` <span class="alt-not">(${gun}. gün)</span>` : ""}</td></tr>
      </table>
      <div class="tarla-kart-dugme">
        <button class="dugme secili" id="d-tarla-git">Buraya git</button>
        <button class="dugme" id="d-tarla-sil">Sil</button>
      </div>`;

    $("#d-tarla-kapat").onclick = () => { T.secili = null; secimHalkasi.visible = false; karti(null); };
    $("#d-tarla-git").onclick = () => {
      // Mevcut git komutu — nokta listesindeki "Git" ile birebir aynı yol.
      P().komutGonder("git", { x: n.x, y: n.y, z: n.z });
      hedefHalka.position.set(sx(n.x), 0.004, sz(n.y));
      hedefHalka.visible = true;
    };
    $("#d-tarla-sil").onclick = () => bitkiSil(n.ad);
  }

  /* --------------------------------------------------------- veri işleri */
  function bosAd(slug) {
    const kullanilan = new Set((P().S ? P().S.noktalar : []).map((n) => n.ad));
    for (let i = 1; i < 9999; i++) {
      const ad = `${slug}-${i}`;
      if (!kullanilan.has(ad)) return ad;
    }
    return `${slug}-${Date.now()}`;
  }

  async function bitkiEkle(slug, x, y) {
    const tur = T.turHarita[slug];
    if (!tur) { gunluk("✕ Önce bir tür seçin", "hata"); return; }
    const govde = {
      ad: bosAd(slug),
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      // Z olarak güvenli geçiş yüksekliği yazılıyor: "buraya git" dendiğinde
      // uç toprağa dalmasın. Ekim derinliği ayrı bir bilgi, türde duruyor.
      z: T.guvenliZ,
      etiket: "bitki",
      tur: slug,
      ekim: Math.floor(Date.now() / 1000),
    };
    try {
      await P().apiIste("/api/noktalar", { method: "POST", body: JSON.stringify(govde) });
      gunluk(`✓ ${tur.name_tr} eklendi (${govde.ad}) X${say(govde.x, 1)} Y${say(govde.y, 1)}`, "ok");
      await P().noktalariYukle();
    } catch (hata) {
      gunluk(`✕ Bitki eklenemedi: ${hata.message}`, "hata");
    }
  }

  async function bitkiTasi(kayit, x, y) {
    const n = kayit.nokta;
    const govde = {
      ad: n.ad, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, z: n.z,
      etiket: n.etiket || "bitki", tur: n.tur, ekim: n.ekim, ustune_yaz: true,
    };
    try {
      await P().apiIste("/api/noktalar", { method: "POST", body: JSON.stringify(govde) });
      await P().noktalariYukle();
    } catch (hata) {
      gunluk(`✕ Taşınamadı: ${hata.message}`, "hata");
      await P().noktalariYukle();       // sahneyi sunucudaki gerçekle eşitle
    }
  }

  async function bitkiSil(ad) {
    try {
      await P().apiIste(`/api/noktalar?ad=${encodeURIComponent(ad)}`, { method: "DELETE" });
      gunluk(`✓ '${ad}' silindi`, "ok");
      T.secili = null;
      karti(null);
      await P().noktalariYukle();
    } catch (hata) {
      gunluk(`✕ Silinemedi: ${hata.message}`, "hata");
    }
  }

  /* --------------------------------------------------------- etkileşim */
  function isinlar(olay) {
    const kutu = tuval.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((olay.clientX - kutu.left) / kutu.width) * 2 - 1,
      -((olay.clientY - kutu.top) / kutu.height) * 2 + 1);
    const isin = new THREE.Raycaster();
    isin.setFromCamera(p, etkinKamera());
    return isin;
  }

  function zemindeNokta(olay) {
    const kesim = isinlar(olay).intersectObject(secmeDuzlem);
    if (!kesim.length) return null;
    const p = kesim[0].point;
    return { x: mx(p.x), y: my(p.z) };
  }

  function bitkiVur(olay) {
    const kesim = isinlar(olay).intersectObjects(bitkiKok.children, true);
    return kesim.length ? kesim[0].object.userData.bitki || null : null;
  }

  function olaylariBagla() {
    let bas = null;         // {x, y, kayit, dondur, kaydir}

    tuval.addEventListener("pointerdown", (o) => {
      tuval.setPointerCapture(o.pointerId);
      const kayit = o.button === 0 && !T.ekleme ? bitkiVur(o) : null;
      bas = {
        x: o.clientX, y: o.clientY, kayit, tasindi: false,
        kaydir: o.button === 1 || o.shiftKey,
        theta: kam.theta, phi: kam.phi, hedef: kam.hedef.clone(),
      };
      if (kayit) { sec(kayit); T.surukleme = kayit; }
    });

    tuval.addEventListener("pointermove", (o) => {
      if (!bas) {
        tuval.style.cursor = T.ekleme ? "crosshair" : bitkiVur(o) ? "grab" : "default";
        return;
      }
      const dx = o.clientX - bas.x, dy = o.clientY - bas.y;
      if (!bas.tasindi && Math.hypot(dx, dy) < 4) return;
      bas.tasindi = true;

      if (bas.kayit) {                       // bitkiyi sürükle
        const p = zemindeNokta(o);
        if (p) {
          bas.kayit.nokta.x = p.x;
          bas.kayit.nokta.y = p.y;
          bas.kayit.grup.position.set(sx(p.x), 0, sz(p.y));
          cakismalariHesapla();
          secimiTazele();
          ipucu(`X ${say(p.x, 1)} · Y ${say(p.y, 1)} mm`);
        }
      } else if (bas.kaydir) {               // kaydır
        const olcek = kam.r * 0.0016;
        const sag = new THREE.Vector3(Math.cos(kam.theta), 0, -Math.sin(kam.theta));
        const ileri = new THREE.Vector3(Math.sin(kam.theta), 0, Math.cos(kam.theta));
        kam.hedef.copy(bas.hedef)
          .addScaledVector(sag, -dx * olcek)
          .addScaledVector(ileri, -dy * olcek);
      } else if (!kam.ust) {                 // yörünge
        kam.theta = bas.theta - dx * 0.006;
        kam.phi = kis(bas.phi - dy * 0.006, 0.08, Math.PI / 2.15);
      }
    });

    const bitir = async (o) => {
      if (!bas) return;
      const eski = bas;
      bas = null;
      tuval.releasePointerCapture && tuval.releasePointerCapture(o.pointerId);
      ipucu("");
      if (eski.kayit && eski.tasindi) {
        T.surukleme = null;
        await bitkiTasi(eski.kayit, eski.kayit.nokta.x, eski.kayit.nokta.y);
        return;
      }
      T.surukleme = null;
      if (eski.tasindi) return;
      if (eski.kayit) return;                // tıklama = seçim (pointerdown'da yapıldı)
      if (T.ekleme && o.button === 0) {
        const p = zemindeNokta(o);
        // Sessizce hiçbir şey yapmamak "tıkladım ama olmadı" hissi veriyor;
        // ışın yatağı ıskaladıysa bunu söylüyoruz.
        if (p) await bitkiEkle($("#tur-secim").value, p.x, p.y);
        else gunluk("✕ Yatağın dışına tıklandı — bitki eklenmedi", "hata");
      } else if (o.button === 0) {
        T.secili = null; secimHalkasi.visible = false; karti(null);
      }
    };
    tuval.addEventListener("pointerup", bitir);
    tuval.addEventListener("pointercancel", bitir);

    tuval.addEventListener("wheel", (o) => {
      o.preventDefault();
      if (kam.ust) { kam.yakinlik = kis(kam.yakinlik * (o.deltaY > 0 ? 0.9 : 1.1), 0.4, 6); boyutla(); }
      else kam.r = kis(kam.r * (o.deltaY > 0 ? 1.1 : 0.9), 0.35, 12);
    }, { passive: false });

    tuval.addEventListener("contextmenu", (o) => o.preventDefault());

    window.addEventListener("keydown", (o) => {
      if (!T.gorunur || !T.secili) return;
      const yaziyor = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
      if (yaziyor) return;
      if (o.key === "Delete") bitkiSil(T.secili.nokta.ad);
      if (o.key === "Escape") { T.secili = null; secimHalkasi.visible = false; karti(null); }
    });

    window.addEventListener("resize", boyutla);
  }

  function ipucu(metin) {
    const k = $("#tarla-ipucu");
    k.textContent = metin;
    k.classList.toggle("gorunur", !!metin);
  }

  /* ------------------------------------------------------------ çizim */
  /** Yatağı kadraja oturtan uzaklık.
   *
   *  Sabit bir uzaklık yazmak yatak ölçüsü değişince ya da pencere darken
   *  ya çok uzaktan ya da kırpılmış bir görüntü veriyordu. Perspektif
   *  kamerada dikey açı doğrudan fov, yatay açı ise fov × en-boy oranı; iki
   *  gereksinimin büyüğünü alıyoruz ve %15 pay bırakıyoruz.
   */
  function kamerayiSigdir() {
    kam.hedef.set(0, 0.12, 0);
    const yariFov = (kamera.fov * Math.PI) / 360;
    const en = kamera.aspect || 1.6;
    const dikey = (derinlikM / 2) / Math.tan(yariFov);
    const yatay = (genislikM / 2) / (Math.tan(yariFov) * en);
    kam.r = kis(Math.max(dikey, yatay) * 1.15 + 0.15, 0.35, 12);
  }

  function boyutla() {
    if (!ciz || !tuval) return;
    const g = tuval.clientWidth || 800, y = tuval.clientHeight || 460;
    ciz.setSize(g, y, false);
    const en = g / Math.max(1, y);
    kamera.aspect = en;
    kamera.updateProjectionMatrix();

    // Ortografik çerçeve: yatak %32 payla sığsın — sınırın hemen dışı da
    // görünsün ki oraya düşmüş bir bitki fark edilip içeri sürüklenebilsin.
    const yariY = Math.max((derinlikM / 2) * 1.32, (genislikM / 2) * 1.32 / en) / kam.yakinlik;
    const yariX = yariY * en;
    kameraUst.left = -yariX; kameraUst.right = yariX;
    kameraUst.top = yariY; kameraUst.bottom = -yariY;
    kameraUst.updateProjectionMatrix();
  }

  function dongu() {
    requestAnimationFrame(dongu);
    if (!T.gorunur) return;                  // gizli sekmede GPU yakmıyoruz

    const k = etkinKamera();
    if (kam.ust) {
      k.up.set(0, 0, -1);
      k.position.set(kam.hedef.x, 4, kam.hedef.z);
      k.lookAt(kam.hedef.x, 0, kam.hedef.z);
    } else {
      k.up.set(0, 1, 0);
      k.position.set(
        kam.hedef.x + kam.r * Math.sin(kam.phi) * Math.sin(kam.theta),
        kam.hedef.y + kam.r * Math.cos(kam.phi),
        kam.hedef.z + kam.r * Math.sin(kam.phi) * Math.cos(kam.theta));
      k.lookAt(kam.hedef);
    }

    if (hedefHalka.visible) {
      const n = (Date.now() % 1400) / 1400;
      hedefHalka.scale.setScalar(1 + n * 0.5);
      hedefHalka.material.opacity = 0.9 * (1 - n);
    }
    ciz.render(sahne, etkinKamera());
  }

  /* --------------------------------------------------------- dış arayüz */
  const Tarla = {
    async kur() {
      if (T.hazir) return;
      if (typeof THREE === "undefined") {
        $("#tarla-uyari").classList.remove("gizli");
        $("#tarla-uyari").textContent = "3B kütüphanesi (three.min.js) yüklenemedi — tarla görünümü kapalı.";
        return;
      }
      T.hazir = true;
      sahneyiKur();
      await Tarla.turleriYukle();
      araclariBagla();
      Tarla.noktalarDegisti();
    },

    async turleriYukle() {
      try {
        const govde = await P().apiIste("/api/turler");
        T.turler = govde.turler || [];
      } catch (hata) {
        T.turler = [];
        gunluk(`✕ Bitki türleri okunamadı: ${hata.message}`, "hata");
      }
      T.turHarita = {};
      T.turler.forEach((t) => { T.turHarita[t.slug] = t; });
      const sec = $("#tur-secim");
      sec.innerHTML = T.turler
        .slice()
        .sort((a, b) => String(a.name_tr).localeCompare(String(b.name_tr), "tr"))
        .map((t) => `<option value="${kacisli(t.slug)}">${kacisli(t.icon || "🌱")} ${kacisli(t.name_tr)} · ${say(t.spread_mm, 0)} mm</option>`)
        .join("");
    },

    /** app.js nokta listesini tazeleyince çağırıyor. */
    noktalarDegisti() {
      if (!T.hazir) return;
      const noktalar = (P().S && P().S.noktalar) || [];
      const imza = JSON.stringify(noktalar.filter((n) => n.tur).map((n) => [n.ad, n.x, n.y, n.z, n.tur, n.ekim]));
      if (imza === T.sonNoktaImzasi && T.bitkiler.length) return;
      T.sonNoktaImzasi = imza;
      bitkileriKur(noktalar);
    },

    /** durumGuncelle'den: yatak ölçüsü, güvenli Z ve canlı robot konumu. */
    durumDegisti(d) {
      if (!T.hazir || !d) return;
      if (d.guvenli_z != null) T.guvenliZ = Number(d.guvenli_z);
      const s = d.sinirlar;
      if (s && s.x && s.y && s.x.max != null && s.y.max != null) {
        const yeni = JSON.stringify(s);
        if (yeni !== JSON.stringify(T.sinir)) {
          T.sinir = { x: s.x, y: s.y, z: s.z || VARSAYILAN_SINIR.z };
          genislikM = (T.sinir.x.max - T.sinir.x.min) * MM;
          derinlikM = (T.sinir.y.max - T.sinir.y.min) * MM;
          $("#tarla-olcu").textContent =
            `Yatak ${say(T.sinir.x.max - T.sinir.x.min, 0)} × ${say(T.sinir.y.max - T.sinir.y.min, 0)} mm`;
          yatagiYap();
          boyutla();          // ortografik çerçeve yeni ölçüye göre kurulsun
          kamerayiSigdir();
          T.sonNoktaImzasi = "";
          Tarla.noktalarDegisti();
        }
      }
      T.konum = d.konum || null;
      robotuYerlestir();
    },

    /** Deneme yardımcısı: makine mm'sinin ekrandaki karşılığı.
     *  Panel bunu kullanmıyor; tarayıcı testi tıklayacağı yeri piksel
     *  tahmin ederek değil bu iz düşümle buluyor. */
    ekranNoktasi(mmx, mmy) {
      const v = new THREE.Vector3(sx(mmx), 0, sz(mmy)).project(etkinKamera());
      const k = tuval.getBoundingClientRect();
      return { x: k.left + ((v.x + 1) / 2) * k.width, y: k.top + ((1 - v.y) / 2) * k.height };
    },

    gorunurluk(acik) {
      T.gorunur = !!acik;
      if (acik) { boyutla(); Tarla.noktalarDegisti(); }
    },
  };

  function araclariBagla() {
    const ekleDugme = $("#d-ekleme-kipi");
    ekleDugme.onclick = () => {
      T.ekleme = !T.ekleme;
      ekleDugme.classList.toggle("secili", T.ekleme);
      ekleDugme.textContent = T.ekleme ? "✓ Ekleme kipi açık — yatağa tıklayın" : "+ Bitki ekle";
      tuval.style.cursor = T.ekleme ? "crosshair" : "default";
    };
    $("#d-gorus-ust").onclick = () => {
      kam.ust = true;
      boyutla();
      $("#d-gorus-ust").classList.add("secili");
      $("#d-gorus-serbest").classList.remove("secili");
    };
    $("#d-gorus-serbest").onclick = () => {
      kam.ust = false;
      $("#d-gorus-serbest").classList.add("secili");
      $("#d-gorus-ust").classList.remove("secili");
    };
    $("#tarla-simge").onchange = (o) => {
      T.simgeler = o.target.checked;
      T.sonNoktaImzasi = "";
      Tarla.noktalarDegisti();
    };
  }

  window.Tarla = Tarla;
})();
