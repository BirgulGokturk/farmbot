/* Tarla haritası — ÇEKİRDEK.
 *
 * Bu dosya hiçbir şey ÇİZMEZ. Sahneyi kurar, iki görünümü (3B ve 2B) yönetir,
 * veriyi toplar ve katmanlara dağıtır. Ne çizileceğine katmanlar karar verir;
 * her biri `statik/katmanlar/` altında tek bir dosya.
 *
 * Neden katman mimarisi
 * ---------------------
 * Önceki hâlde bitki, halka, robot ve yatak aynı fonksiyonun içinde
 * çiziliyordu. Bir şeyi kapatmak isteyince `if` eklemek, yenisini eklemek
 * için o fonksiyonu büyütmek gerekiyordu. FarmBot'un
 * `farm_designer/map/layers/` düzeni gibi: her katman kendi dosyasında,
 * birbirini tanımıyor, tek tek açılıp kapanabiliyor.
 *
 * KATMAN SÖZLEŞMESİ — bir dosya şunu çağırır:
 *
 *   Tarla.katman({
 *     kimlik: "bitkiler",        // localStorage anahtarı, benzersiz
 *     ad: "Bitkiler",            // listede görünen ad
 *     varsayilan: true,          // ilk açılışta açık mı
 *     kur(o)      {},            // bir kez, sahne hazır olunca (isteğe bağlı)
 *     guncelle(o) {},            // veri ya da ölçü değişince — 3B nesneleri
 *     ciz2b(o, c) {},            // 2B harita için (isteğe bağlı)
 *     vur(o, mm)  {},            // tıklanan mm'de öğe var mı (isteğe bağlı)
 *     kart(o, k)  {},            // seçilen öğenin kartı, HTML (isteğe bağlı)
 *     baglan(o, kok, k) {},      // kart basıldıktan sonra düğme bağlama
 *   })
 *
 * `o` bağlamı: o.grup (THREE.Group), o.veri, o.makine, o.sinir, dönüşümler
 * ve yardımcılar. Katmanlar birbirinin değişkenine erişmiyor.
 *
 * KAPALI KATMAN HİÇ ÇİZİLMEZ: grubu sahneden çıkarılır, `guncelle` ve
 * `ciz2b` çağrılmaz. Pi'nin GPU'su için önemli — görünmeyen 300 bitkiyi her
 * karede dönüştürmenin bedeli var.
 */
(function () {
  "use strict";

  const MM = 0.001;              // 1 mm = 0.001 sahne birimi (metre)
  const KENAR_MM = 150;          // yatak dışına tıklanabilen pay
  const IZ_AZAMI = 240;          // robot izinde saklanan konum sayısı

  /* ------------------------------------------------------- harita ayarları
   *
   * Makinenin yanında durup panele bakan biri haritayı kendi baktığı yöne
   * çevirmek istiyor. Bu ayarlar YALNIZCA 2B çizimi etkiliyor: makinenin
   * sınırlarına, kalibrasyonuna ya da gönderilen koordinatlara dokunmuyor.
   * 3B'de zaten sahneyi orbit ile döndürebiliyorsun.
   *
   *   dondur   — X ve Y yer değiştiriyor (makinenin yan tarafında durmak)
   *   koseX/Y  — sıfır noktasının hangi köşede görüneceği (dört çeyrek)
   *   boyutKip — "dinamik": eksen sınırlarına göre; "elle": girilen mm
   */
  const HARITA_VARSAYILAN = {
    dondur: false, koseX: "sol", koseY: "ust",
    boyutKip: "dinamik", elleEn: 425, elleBoy: 600,
  };

  const VARSAYILAN_SINIR = { x: { min: 0, max: 425 }, y: { min: 0, max: 600 }, z: { min: 0, max: 550 } };

  /* --------------------------------------------------------------- durum */
  const T = {
    hazir: false,
    // Harita sekmeden bağımsız, açılışta da görünür. Sekme geçişinde
    // gizlenmiyor; yalnız dar ekranda küçülüyor.
    gorunur: true,
    gorunum: "3b",               // "3b" | "2b"
    katmanlar: [],               // {tanim, acik, grup}
    secili: null,                // {katman, kayit}
    sinir: VARSAYILAN_SINIR,
    guvenliZ: 280,
    sonNoktaImzasi: "",
    ekleme: false,

    // İKİ KİP (FarmBot'un move/select ayrımı).
    //   "tasi" — sürükle döndürür, öğe sürüklenir, tek tıkla kart açılır
    //   "sec"  — sürükleme kutu seçimi çizer, Shift ile tek tek eklenir
    kip: "tasi",
    secim: new Set(),            // seçili nokta ADLARI
    harita: Object.assign({}, HARITA_VARSAYILAN),
  };

  /** Tek seferde işlenebilecek nokta sayısı — sunucudaki sınırla aynı.
   *  Yatağımız 425 x 600 mm; sığan fide sayısı bu mertebede. */
  const AZAMI_SECIM = 40;

  /* Bütün katmanların ortak veri havuzu. Tek kaynak: ayrı bir depo yok,
     2B ve 3B aynı nesneleri okuyor. */
  const VERI = {
    noktalar: [],     // nokta deposu (bitkiler de burada, `tur` alanıyla)
    turler: {},       // slug -> tür kaydı
    durum: {},        // ajandan gelen son durum
    konum: null,      // {x,y,z}
    iz: [],           // [{x,y,ts}] — robotun geçtiği yerler
    kareler: [],      // [{damga,ts,x,y}]
    okumalar: [],     // [{ts,x,y,toprak_nem}]
  };

  const P = () => window.Panel || {};
  const gunluk = (m, s) => (P().gunluk ? P().gunluk(m, s) : console.log(m));
  const $ = (s) => document.querySelector(s);
  const kis = (d, a, b) => Math.max(a, Math.min(b, d));
  const say = (d, b = 0) => (d == null || Number.isNaN(d) ? "—" : Number(d).toFixed(b));
  const kacisli = (m) => String(m).replace(/[&<>"']/g, (k) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[k]));

  /* three.js nesneleri */
  let sahne, kamera, kameraUst, ciz, tuval;
  let secmeDuzlem, kokGrup;
  let genislikM = 0.425, derinlikM = 0.6;

  /* 2B harita */
  let tuval2b, c2b, olcek2b = 1, kaydir2b = { x: 0, y: 0 };

  const kam = { theta: Math.PI * 0.22, phi: Math.PI * 0.30, r: 1.6, hedef: null,
                ust: false, yakinlik: 1, elleZoom: false };

  const etkinKamera = () => (kam.ust ? kameraUst : kamera);

  /* ------------------------------------------------------------ dönüşüm */
  const sx = (mx) => (mx - T.sinir.x.min) * MM - genislikM / 2;
  const sz = (my) => (my - T.sinir.y.min) * MM - derinlikM / 2;
  const mmx = (x) => (x + genislikM / 2) / MM + T.sinir.x.min;
  const mmy = (z) => (z + derinlikM / 2) / MM + T.sinir.y.min;

  function malzeme(renk, opt) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(renk), roughness: 0.9, metalness: 0.05, ...(opt || {}) });
  }

  /* Bağlam — katmanların gördüğü tek arayüz. */
  const BAGLAM = {
    THREE: null, MM, veri: VERI, makine: null,
    get sinir() { return T.sinir; },
    get guvenliZ() { return T.guvenliZ; },
    get genislikM() { return genislikM; },
    get derinlikM() { return derinlikM; },
    get secili() { return T.secili; },
    /** Çoklu seçim — katmanlar `o.secim.has(nokta.ad)` ile vurguluyor.
     *  Salt okunur kullanılıyor; değiştirmek çekirdeğin işi. */
    get secim() { return T.secim; },
    get kip() { return T.kip; },
    sx, sz, mmx, mmy, malzeme, kis, say, kacisli, gunluk,
    /** 2B: mm -> tuval pikseli */
    mm2b(x, y) {
      const t = haritaDonusum(x, y);
      return { x: t.u * olcek2b + kaydir2b.x, y: t.v * olcek2b + kaydir2b.y };
    },
    get olcek2b() { return olcek2b; },
    komut: (ad, arg) => P().komutGonder && P().komutGonder(ad, arg),
    api: (yol, sec) => P().apiIste(yol, sec),
    noktalariYukle: () => P().noktalariYukle && P().noktalariYukle(),
    tazele: () => ciz2bTumu(),
    /** Bir katmanın grubunu temizler — nesneler her güncellemede yeniden kurulur. */
    bosalt(grup) {
      while (grup.children.length) {
        const c = grup.children.pop();
        c.traverse((n) => { if (n.geometry) n.geometry.dispose(); });
      }
    },
  };

  /* ==================================================== katman defteri */
  function katmanKaydet(tanim) {
    if (T.katmanlar.some((k) => k.tanim.kimlik === tanim.kimlik)) return;
    const kayitli = localStorage.getItem("farmbot_katman_" + tanim.kimlik);
    T.katmanlar.push({
      tanim,
      acik: kayitli === null ? tanim.varsayilan !== false : kayitli === "1",
      grup: null,
    });
  }

  function katmanlariKur() {
    T.katmanlar.forEach((k) => {
      k.grup = new THREE.Group();
      k.grup.name = k.tanim.kimlik;
      if (k.tanim.kur) {
        try { k.tanim.kur({ ...BAGLAM, grup: k.grup }); }
        catch (h) { console.error("katman kur:", k.tanim.kimlik, h); }
      }
      if (k.acik) kokGrup.add(k.grup);
    });
    katmanListesiCiz();
  }

  function katmanBaglami(k) {
    return Object.assign(Object.create(BAGLAM), { grup: k.grup });
  }

  function katmanlariGuncelle() {
    if (!T.hazir) return;
    T.katmanlar.forEach((k) => {
      if (!k.acik || !k.tanim.guncelle) return;    // KAPALI KATMAN ÇİZİLMEZ
      try { k.tanim.guncelle(katmanBaglami(k)); }
      catch (h) { console.error("katman guncelle:", k.tanim.kimlik, h); }
    });
    ciz2bTumu();
  }

  function katmanAcKapa(kayit, acik) {
    kayit.acik = acik;
    localStorage.setItem("farmbot_katman_" + kayit.tanim.kimlik, acik ? "1" : "0");
    if (acik) {
      kokGrup.add(kayit.grup);
      if (kayit.tanim.guncelle) {
        try { kayit.tanim.guncelle(katmanBaglami(kayit)); } catch (h) { console.error(h); }
      }
    } else {
      kokGrup.remove(kayit.grup);
      BAGLAM.bosalt(kayit.grup);                   // bellekte de durmasın
      if (T.secili && T.secili.katman === kayit) secimiKapat();
    }
    ciz2bTumu();
  }

  function katmanListesiCiz() {
    const kutu = $("#katman-liste");
    if (!kutu) return;
    kutu.innerHTML = T.katmanlar.map((k, i) => `
      <label class="katman-satir">
        <input type="checkbox" data-i="${i}"${k.acik ? " checked" : ""}>
        <span>${kacisli(k.tanim.ad)}</span>
      </label>`).join("");
    kutu.querySelectorAll("input").forEach((g) => {
      g.onchange = () => katmanAcKapa(T.katmanlar[Number(g.dataset.i)], g.checked);
    });
  }

  /* ======================================================== sahne kurma */
  function sahneyiKur() {
    tuval = $("#tarla-tuval");
    tuval2b = $("#tarla-tuval2b");
    c2b = tuval2b.getContext("2d");

    sahne = new THREE.Scene();
    sahne.background = new THREE.Color(BAGLAM.makine.renk.arka);

    kamera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
    // Üstten görünüm ortografik: perspektifte direkler yatağın üstüne
    // devriliyor, plan olmaktan çıkıyordu.
    kameraUst = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
    kam.hedef = new THREE.Vector3(0, 0.15, 0);

    ciz = new THREE.WebGLRenderer({ canvas: tuval, antialias: true });
    ciz.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    sahne.add(new THREE.HemisphereLight(0xdfe9e2, 0x2a2f28, 1.15));
    const isik = new THREE.DirectionalLight(0xffffff, 1.5);
    isik.position.set(2.4, 3.2, 1.8);
    sahne.add(isik);

    kokGrup = new THREE.Group();
    sahne.add(kokGrup);

    // Görünmez seçme düzlemi — ışın testleri buna çarpıyor.
    secmeDuzlem = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
                                 new THREE.MeshBasicMaterial({ visible: false }));
    secmeDuzlem.rotation.x = -Math.PI / 2;
    sahne.add(secmeDuzlem);

    olcuGuncelle();
    katmanlariKur();
    olaylariBagla();
    boyutla();
    kamerayiSigdir();
    dongu();
  }

  function olcuGuncelle() {
    genislikM = (T.sinir.x.max - T.sinir.x.min) * MM;
    derinlikM = (T.sinir.y.max - T.sinir.y.min) * MM;
    if (secmeDuzlem) {
      secmeDuzlem.geometry.dispose();
      secmeDuzlem.geometry = new THREE.PlaneGeometry(
        genislikM + KENAR_MM * MM * 2, derinlikM + KENAR_MM * MM * 2);
    }
    const o = $("#tarla-olcu");
    if (o) o.textContent = `Yatak ${say(T.sinir.x.max - T.sinir.x.min, 0)} × ` +
                           `${say(T.sinir.y.max - T.sinir.y.min, 0)} mm`;
  }

  /* ============================================================ 3B çizim */
  function kamerayiSigdir() {
    const yukseklikM = BAGLAM.makine.ray_yuksekligi * MM;
    const R = 0.5 * Math.hypot(genislikM, derinlikM, yukseklikM);
    const yariFov = (kamera.fov * Math.PI) / 360;
    const en = kamera.aspect || 1.6;
    const yariYatay = Math.atan(Math.tan(yariFov) * en);
    kam.r = kis(Math.max(R / Math.sin(yariFov), R / Math.sin(yariYatay)) * 1.05, 0.5, 12);
    kam.hedef.set(0, yukseklikM * 0.35, 0);
  }

  function boyutla() {
    if (!ciz || !tuval) return;
    const g = tuval.clientWidth || 800, y = tuval.clientHeight || 460;
    ciz.setSize(g, y, false);
    const en = g / Math.max(1, y);
    kamera.aspect = en;
    kamera.updateProjectionMatrix();

    const yariY = Math.max((derinlikM / 2) * 1.32, (genislikM / 2) * 1.32 / en) / kam.yakinlik;
    const yariX = yariY * en;
    kameraUst.left = -yariX; kameraUst.right = yariX;
    kameraUst.top = yariY; kameraUst.bottom = -yariY;
    kameraUst.updateProjectionMatrix();

    if (!kam.elleZoom) kamerayiSigdir();
    boyutla2b();
  }

  function dongu() {
    requestAnimationFrame(dongu);
    if (!T.gorunur || T.gorunum !== "3b") return;   // gizliyken GPU yakma

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
    ciz.render(sahne, k);
  }

  /* ============================================================ 2B harita
   * Hassas iş burada yapılıyor: 3B'de bir bitkiyi milimetreye oturtmak zor,
   * plan görünümünde kolay. İki görünüm AYNI veriyi okuyor — 2B'de taşınan
   * bitki 3B'ye de geçiyor, çünkü ortada tek bir nokta deposu var.
   */
  const KENAR2B = { sol: 44, ust: 24, sag: 12, alt: 28 };

  /* ------------------------------------------------- harita dönüşümü (2B)
   *
   * Makine mm'si → çizim birimi. Tek yerde: `mm2b` ve `olay2bMM` bunun
   * gidiş ve dönüş yönü. Katmanlar mm2b'yi çağırdığı için hiçbiri harita
   * ayarlarını bilmek zorunda değil. */

  /** Haritanın kapsadığı mm alanı — dinamikse eksen sınırları. */
  function haritaAlani() {
    const h = T.harita;
    if (h.boyutKip === "elle") {
      return { x0: 0, y0: 0,
               en: kis(Number(h.elleEn) || 425, 50, 5000),
               boy: kis(Number(h.elleBoy) || 600, 50, 5000) };
    }
    return { x0: T.sinir.x.min, y0: T.sinir.y.min,
             en: T.sinir.x.max - T.sinir.x.min,
             boy: T.sinir.y.max - T.sinir.y.min };
  }

  /** Çizim alanının mm ölçüleri — döndürülmüşse en ve boy yer değiştiriyor. */
  function haritaOlcu() {
    const a = haritaAlani();
    return T.harita.dondur ? { U: a.boy, V: a.en } : { U: a.en, V: a.boy };
  }

  function haritaDonusum(x, y) {
    const h = T.harita, a = haritaAlani(), o = haritaOlcu();
    let u = x - a.x0, v = y - a.y0;
    if (h.dondur) { const g = u; u = v; v = g; }
    if (h.koseX === "sag") u = o.U - u;
    if (h.koseY === "alt") v = o.V - v;
    return { u, v };
  }

  /** haritaDonusum'un tersi — çizim biriminden makine mm'sine. */
  function haritaTers(u, v) {
    const h = T.harita, a = haritaAlani(), o = haritaOlcu();
    if (h.koseX === "sag") u = o.U - u;
    if (h.koseY === "alt") v = o.V - v;
    if (h.dondur) { const g = u; u = v; v = g; }
    return { x: u + a.x0, y: v + a.y0 };
  }

  function boyutla2b() {
    if (!tuval2b) return;
    // Tuvali yatağın en-boy oranına oturtuyoruz: sabit genişlikte, yatak
    // dar olduğunda ekranın yarısı boş kalıyor ve harita gereksiz küçülüyordu.
    const kapsayici = tuval2b.parentElement;
    const o0 = haritaOlcu();
    const enMM0 = o0.U, boyMM0 = o0.V;
    const yukseklik = tuval2b.clientHeight || 460;
    const istenen = (yukseklik - KENAR2B.ust - KENAR2B.alt) * (enMM0 / boyMM0)
                    + KENAR2B.sol + KENAR2B.sag;
    tuval2b.style.width = Math.min(istenen, kapsayici.clientWidth) + "px";

    const g = tuval2b.clientWidth || 600, y = tuval2b.clientHeight || 400;
    const oran = Math.min(window.devicePixelRatio || 1, 2);
    tuval2b.width = g * oran;
    tuval2b.height = y * oran;
    c2b.setTransform(oran, 0, 0, oran, 0, 0);

    const { U: enMM, V: boyMM } = haritaOlcu();
    olcek2b = Math.min((g - KENAR2B.sol - KENAR2B.sag) / enMM,
                       (y - KENAR2B.ust - KENAR2B.alt) / boyMM);
    kaydir2b.x = KENAR2B.sol + ((g - KENAR2B.sol - KENAR2B.sag) - enMM * olcek2b) / 2;
    kaydir2b.y = KENAR2B.ust + ((y - KENAR2B.ust - KENAR2B.alt) - boyMM * olcek2b) / 2;
    ciz2bTumu();
  }

  /** mm cetveli — 50 mm'de bir çizgi, 100 mm'de bir sayı.
   *
   * Bütün noktalar `mm2b`den geçiyor: harita döndürülmüş ya da sıfır köşesi
   * değiştirilmiş olsa da cetvel kendiliğinden doğru yere düşüyor. Sabit X
   * çizgisi döndürülünce yatay olabiliyor, o yüzden her çizginin İKİ ucu da
   * dönüşümden geçiriliyor; etiket de uca göre yerleşiyor. */
  function cetvelCiz() {
    const a = haritaAlani();
    const x1 = a.x0, x2 = a.x0 + a.en, y1 = a.y0, y2 = a.y0 + a.boy;
    c2b.font = "10px ui-monospace, Menlo, Consolas, monospace";
    c2b.fillStyle = "#8a8a80";
    c2b.lineWidth = 1;

    /** Bir kenardan diğerine giden ızgara çizgisi + ucundaki etiket. */
    const cizgi = (ax, ay, bx, by, etiket, buyuk) => {
      const p = BAGLAM.mm2b(ax, ay), q = BAGLAM.mm2b(bx, by);
      c2b.beginPath();
      c2b.moveTo(p.x, p.y); c2b.lineTo(q.x, q.y);
      c2b.strokeStyle = buyuk ? "#33332f" : "#242422";
      c2b.stroke();
      if (!buyuk) return;
      // Etiket, çizginin dış tarafta kalan ucuna: dikey çizgide üste,
      // yatay çizgide sola.
      const dikey = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
      const u = dikey ? (p.y < q.y ? p : q) : (p.x < q.x ? p : q);
      c2b.textAlign = dikey ? "center" : "right";
      c2b.fillText(etiket, dikey ? u.x : u.x - 8, dikey ? u.y - 8 : u.y + 3);
    };

    for (let x = x1; x <= x2 + 0.1; x += 50) {
      cizgi(x, y1, x, y2, String(Math.round(x)), Math.round(x) % 100 === 0);
    }
    for (let y = y1; y <= y2 + 0.1; y += 50) {
      cizgi(x1, y, x2, y, String(Math.round(y)), Math.round(y) % 100 === 0);
    }

    // Yatağın gerçek sınırı — harita alanı elle büyütülmüşse ikisi ayrışıyor.
    const s = T.sinir;
    const k = [BAGLAM.mm2b(s.x.min, s.y.min), BAGLAM.mm2b(s.x.max, s.y.min),
               BAGLAM.mm2b(s.x.max, s.y.max), BAGLAM.mm2b(s.x.min, s.y.max)];
    c2b.strokeStyle = "#5a5a52";
    c2b.lineWidth = 1.5;
    c2b.beginPath();
    c2b.moveTo(k[0].x, k[0].y);
    for (let i = 1; i < 4; i++) c2b.lineTo(k[i].x, k[i].y);
    c2b.closePath();
    c2b.stroke();

    // Sıfır köşesi ve eksen yönleri — döndürülmüş haritada hangi yön ne,
    // bakınca anlaşılsın.
    const sifir = BAGLAM.mm2b(s.x.min, s.y.min);
    c2b.fillStyle = "#3987e5";
    c2b.beginPath(); c2b.arc(sifir.x, sifir.y, 3.5, 0, Math.PI * 2); c2b.fill();
    const okX = BAGLAM.mm2b(s.x.min + 60, s.y.min);
    const okY = BAGLAM.mm2b(s.x.min, s.y.min + 60);
    c2b.strokeStyle = "#3987e5"; c2b.lineWidth = 1.5;
    [[okX, "X"], [okY, "Y"]].forEach(([u, ad]) => {
      c2b.beginPath(); c2b.moveTo(sifir.x, sifir.y); c2b.lineTo(u.x, u.y); c2b.stroke();
      c2b.fillStyle = "#3987e5";
      c2b.textAlign = "center";
      c2b.fillText(ad, u.x + (u.x - sifir.x) * 0.12, u.y + (u.y - sifir.y) * 0.12 + 3);
    });

    c2b.fillStyle = "#8a8a80";
    c2b.textAlign = "left";
    c2b.fillText("mm", 6, 14);
  }

  function ciz2bTumu() {
    if (!c2b || T.gorunum !== "2b" || !T.gorunur) return;
    const g = tuval2b.clientWidth, y = tuval2b.clientHeight;
    c2b.fillStyle = BAGLAM.makine.renk.arka;
    c2b.fillRect(0, 0, g, y);
    cetvelCiz();
    T.katmanlar.forEach((k) => {
      if (!k.acik || !k.tanim.ciz2b) return;       // KAPALI KATMAN ÇİZİLMEZ
      c2b.save();
      try { k.tanim.ciz2b(katmanBaglami(k), c2b); }
      catch (h) { console.error("katman ciz2b:", k.tanim.kimlik, h); }
      c2b.restore();
    });
  }

  const olay2bMM = (o) => {
    const kutu = tuval2b.getBoundingClientRect();
    return haritaTers((o.clientX - kutu.left - kaydir2b.x) / olcek2b,
                      (o.clientY - kutu.top - kaydir2b.y) / olcek2b);
  };

  /* ========================================================= etkileşim */
  function isin(olay, hedefTuval) {
    const kutu = hedefTuval.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((olay.clientX - kutu.left) / kutu.width) * 2 - 1,
      -((olay.clientY - kutu.top) / kutu.height) * 2 + 1);
    const i = new THREE.Raycaster();
    i.setFromCamera(p, etkinKamera());
    return i;
  }

  function zemindeMM(olay) {
    const k = isin(olay, tuval).intersectObject(secmeDuzlem);
    if (!k.length) return null;
    return { x: mmx(k[0].point.x), y: mmy(k[0].point.z) };
  }

  /** Katmanlara "bu mm'de senin bir öğen var mı" diye sorar; ilk bulan alır. */
  function vurTara(mm) {
    for (const k of T.katmanlar) {
      if (!k.acik || !k.tanim.vur) continue;
      let kayit = null;
      try { kayit = k.tanim.vur(katmanBaglami(k), mm); } catch (h) { console.error(h); }
      if (kayit) return { katman: k, kayit };
    }
    return null;
  }

  function secimiKapat() {
    T.secili = null;
    const kutu = $("#tarla-kart");
    kutu.classList.add("gizli");
    kutu.innerHTML = "";
    ciz2bTumu();
  }

  function sec(vurus) {
    T.secili = vurus;
    const kutu = $("#tarla-kart");
    if (!vurus || !vurus.katman.tanim.kart) { secimiKapat(); return; }
    const o = katmanBaglami(vurus.katman);
    kutu.classList.remove("gizli");
    kutu.innerHTML = vurus.katman.tanim.kart(o, vurus.kayit) +
      '<button class="kapat" id="d-tarla-kapat" title="Kapat">✕</button>';
    $("#d-tarla-kapat").onclick = secimiKapat;
    if (vurus.katman.tanim.baglan) {
      try { vurus.katman.tanim.baglan(o, kutu, vurus.kayit); } catch (h) { console.error(h); }
    }
    ciz2bTumu();
  }

  /* ==================================================== çoklu seçim */
  /* Kutu seçimi ve toplu işlem.
   *
   * Çekirdek hangi katmanın ne tuttuğunu BİLMİYOR: açık katmanlara
   * `secilebilir(o)` diye soruyor, dönen {ad, x, y} listesini kutuyla
   * kesiştiriyor. Yeni bir katman seçilebilir olmak isterse bu kancayı
   * yazıyor, çekirdeğe dokunulmuyor. Kapalı katman seçime de girmiyor. */

  function secilebilirler() {
    const liste = [];
    for (const k of T.katmanlar) {
      if (!k.acik || !k.tanim.secilebilir) continue;
      try {
        const parca = k.tanim.secilebilir(katmanBaglami(k)) || [];
        for (const n of parca) if (n && n.ad) liste.push(n);
      } catch (h) { console.error("katman secilebilir:", k.tanim.kimlik, h); }
    }
    return liste;
  }

  /** Makine mm → etkin tuvalin İÇ pikseli (kutu kesişimi bunun üstünden). */
  function tuvalXY(mmx_, mmy_) {
    if (T.gorunum === "2b") return BAGLAM.mm2b(mmx_, mmy_);
    const kutu = tuval.getBoundingClientRect();
    const v = new THREE.Vector3(sx(mmx_), 0, sz(mmy_)).project(etkinKamera());
    return { x: ((v.x + 1) / 2) * kutu.width, y: ((1 - v.y) / 2) * kutu.height };
  }

  function secimeYaz(adlar, ekle) {
    if (!ekle) T.secim.clear();
    for (const ad of adlar) {
      if (T.secim.has(ad)) T.secim.delete(ad);
      else if (T.secim.size < AZAMI_SECIM) T.secim.add(ad);
    }
    secimiCiz();
  }

  function secimiBirak() {
    if (!T.secim.size) return;
    T.secim.clear();
    secimiCiz();
  }

  function secimiCiz() {
    const cubuk = $("#toplu-cubuk");
    const sayi = $("#toplu-sayi");
    if (cubuk) cubuk.classList.toggle("gizli", T.secim.size === 0);
    if (sayi) sayi.textContent = `${T.secim.size} seçili`;
    katmanlariGuncelle();
  }

  /** Kutu seçimi dikdörtgenini tuvalin üstüne çiziyor. */
  function kutuCiz(bas, o) {
    const k = $("#secim-kutusu");
    if (!k) return;
    // Önce görünür yapılıyor: display:none iken offsetParent null geliyor.
    k.classList.remove("gizli");
    const hedef = T.gorunum === "2b" ? tuval2b : tuval;
    const kutu = hedef.getBoundingClientRect();
    const anne = (k.offsetParent || k.parentElement).getBoundingClientRect();
    const x1 = Math.min(bas.x, o.clientX), x2 = Math.max(bas.x, o.clientX);
    const y1 = Math.min(bas.y, o.clientY), y2 = Math.max(bas.y, o.clientY);
    k.style.left = `${kis(x1, kutu.left, kutu.right) - anne.left}px`;
    k.style.top = `${kis(y1, kutu.top, kutu.bottom) - anne.top}px`;
    k.style.width = `${kis(x2, kutu.left, kutu.right) - kis(x1, kutu.left, kutu.right)}px`;
    k.style.height = `${kis(y2, kutu.top, kutu.bottom) - kis(y1, kutu.top, kutu.bottom)}px`;
  }

  function kutuGizle() {
    const k = $("#secim-kutusu");
    if (k) k.classList.add("gizli");
  }

  /** Kutunun içine düşen her şeyi seçiyor. Shift basılıysa mevcut seçime ekliyor. */
  function kutuylaSec(bas, o, ekle) {
    const hedef = T.gorunum === "2b" ? tuval2b : tuval;
    const kutu = hedef.getBoundingClientRect();
    const x1 = Math.min(bas.x, o.clientX) - kutu.left, x2 = Math.max(bas.x, o.clientX) - kutu.left;
    const y1 = Math.min(bas.y, o.clientY) - kutu.top, y2 = Math.max(bas.y, o.clientY) - kutu.top;
    const icerde = [];
    for (const n of secilebilirler()) {
      const p = tuvalXY(n.x, n.y);
      if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) icerde.push(n.ad);
    }
    if (!ekle) T.secim.clear();
    for (const ad of icerde) {
      if (T.secim.size >= AZAMI_SECIM) break;
      T.secim.add(ad);
    }
    if (icerde.length > AZAMI_SECIM) {
      gunluk(`Seçim ${AZAMI_SECIM} noktada durduruldu — kutuda ${icerde.length} vardı`, "uyari");
    }
    secimiCiz();
  }

  function kipSec(hangi) {
    T.kip = hangi === "sec" ? "sec" : "tasi";
    localStorage.setItem("farmbot_tarla_kip", T.kip);
    $("#d-kip-tasi").classList.toggle("secili", T.kip === "tasi");
    $("#d-kip-sec").classList.toggle("secili", T.kip === "sec");
    if (T.kip === "sec") {
      // Seç kipinde ekleme kipi kapanıyor: ikisi de sol tıkla çalışıyor.
      if (T.ekleme) eklemeKipi(false);
      secimiKapat();
    } else {
      secimiBirak();
    }
    kutuGizle();
  }

  /* -------------------------------------------------------- toplu işlem */

  /** Nokta değişkeni olan diziler — seçime uygulanabilenler. Liste app.js'ten
   *  geliyor; katman ya da çekirdek dizi deposunu ayrıca okumuyor. */
  let uygunDiziler = [];

  function dizileriTazele(programlar) {
    const sec = $("#toplu-dizi");
    if (!sec) return;
    uygunDiziler = (programlar || []).filter(
      (p) => (p.degiskenler || []).filter((d) => d.tip === "nokta").length === 1);
    const onceki = sec.value;
    sec.innerHTML = uygunDiziler.length
      ? uygunDiziler.map((p) => `<option>${kacisli(p.ad)}</option>`).join("")
      : '<option value="">(nokta değişkenli dizi yok)</option>';
    if (uygunDiziler.some((p) => p.ad === onceki)) sec.value = onceki;
    sec.disabled = !uygunDiziler.length;
    const d = $("#d-toplu-dizi");
    if (d) d.disabled = !uygunDiziler.length;
    diziDegerleriCiz();
  }

  /** Seçilen dizinin nokta DIŞINDAKİ değişkenleri için alan açıyor.
   *  Nokta değişkeni seçimin kendisinden geliyor, sorulmuyor. */
  function diziDegerleriCiz() {
    const kutu = $("#toplu-degerler");
    if (!kutu) return;
    const p = uygunDiziler.find((x) => x.ad === ($("#toplu-dizi") || {}).value);
    const digerleri = ((p && p.degiskenler) || []).filter((d) => d.tip !== "nokta");
    kutu.innerHTML = digerleri.map((d) => `
      <label class="toplu-deger" title="${kacisli(d.aciklama || d.ad)}">
        <span>$${kacisli(d.ad)}</span>
        <input type="${d.tip === "sayi" ? "number" : "text"}" data-ad="${kacisli(d.ad)}"
               value="${d.tip === "sayi" ? 3 : ""}">
      </label>`).join("");
  }

  function diziDegerleriTopla() {
    const d = {};
    document.querySelectorAll("#toplu-degerler input").forEach((g) => {
      d[g.dataset.ad] = g.value;
    });
    return d;
  }

  async function topluIslem(islem) {
    const adlar = [...T.secim];
    if (!adlar.length) return;
    if (islem === "sil" && !confirm(`${adlar.length} nokta silinecek. Emin misiniz?`)) return;
    const govde = { islem, noktalar: adlar };
    if (islem === "dizi") {
      govde.dizi = ($("#toplu-dizi") || {}).value || "";
      if (!govde.dizi) { gunluk("Uygulanacak dizi seçilmedi", "uyari"); return; }
      govde.degerler = diziDegerleriTopla();
    }
    try {
      const y = await P().apiIste("/api/toplu", {
        method: "POST", body: JSON.stringify(govde),
      });
      gunluk(y.mesaj || `Toplu işlem başlatıldı — ${adlar.length} nokta`, "iyi");
      if (islem === "sil") {
        T.secim.clear();
        await P().noktalariYukle();
      }
      secimiCiz();
    } catch (h) {
      gunluk(`✕ Toplu işlem: ${h.message || h}`, "hata");
    }
  }

  /** Bir katmanın "taşı" yeteneği varsa sürükleme buradan geçiyor. */
  function surukle(kayit, katman, mm, bitti) {
    if (!katman.tanim.tasi) return;
    try { katman.tanim.tasi(katmanBaglami(katman), kayit, mm, bitti); }
    catch (h) { console.error(h); }
    ciz2bTumu();
  }

  function olaylariBagla() {
    [tuval, tuval2b].forEach((hedef) => {
      let bas = null;
      const ucBoyutlu = hedef === tuval;

      hedef.addEventListener("pointerdown", (o) => {
        hedef.setPointerCapture(o.pointerId);
        const mm = ucBoyutlu ? zemindeMM(o) : olay2bMM(o);

        // SEÇ KİPİ — sol tuş kutu çizer, öğe sürüklenmez, sahne dönmez.
        if (T.kip === "sec" && o.button === 0) {
          bas = { x: o.clientX, y: o.clientY, mm, vurus: null, tasindi: false,
                  kutuSecim: true, ekle: o.shiftKey || o.ctrlKey || o.metaKey };
          return;
        }

        const vurus = (!T.ekleme && mm) ? vurTara(mm) : null;
        bas = { x: o.clientX, y: o.clientY, mm, vurus, tasindi: false,
                kaydir: o.button === 1 || o.shiftKey,
                theta: kam.theta, phi: kam.phi, hedefKopya: kam.hedef.clone() };
        if (vurus) sec(vurus);
      });

      hedef.addEventListener("pointermove", (o) => {
        const mm = ucBoyutlu ? zemindeMM(o) : olay2bMM(o);
        if (!bas) {
          hedef.style.cursor = T.kip === "sec" ? "crosshair"
            : T.ekleme ? "crosshair"
            : (mm && vurTara(mm)) ? "grab" : "default";
          if (mm && !ucBoyutlu) ipucu(`X ${say(mm.x, 1)} · Y ${say(mm.y, 1)} mm`);
          return;
        }
        const dx = o.clientX - bas.x, dy = o.clientY - bas.y;
        if (!bas.tasindi && Math.hypot(dx, dy) < 4) return;
        bas.tasindi = true;

        if (bas.kutuSecim) {
          kutuCiz(bas, o);
        } else if (bas.vurus && mm) {
          surukle(bas.vurus.kayit, bas.vurus.katman, mm, false);
          ipucu(`X ${say(mm.x, 1)} · Y ${say(mm.y, 1)} mm`);
        } else if (ucBoyutlu && bas.kaydir) {
          const olcek = kam.r * 0.0016;
          const sag = new THREE.Vector3(Math.cos(kam.theta), 0, -Math.sin(kam.theta));
          const ileri = new THREE.Vector3(Math.sin(kam.theta), 0, Math.cos(kam.theta));
          kam.hedef.copy(bas.hedefKopya)
            .addScaledVector(sag, -dx * olcek).addScaledVector(ileri, -dy * olcek);
        } else if (ucBoyutlu && !kam.ust) {
          kam.theta = bas.theta - dx * 0.006;
          kam.phi = kis(bas.phi - dy * 0.006, 0.08, Math.PI / 2.15);
        }
      });

      const bitir = async (o) => {
        if (!bas) return;
        const eski = bas; bas = null;
        try { hedef.releasePointerCapture(o.pointerId); } catch (h) { /* yoksay */ }
        ipucu("");
        const mm = ucBoyutlu ? zemindeMM(o) : olay2bMM(o);

        if (eski.kutuSecim) {
          kutuGizle();
          if (eski.tasindi) {
            kutuylaSec(eski, o, eski.ekle);
          } else if (mm) {
            // Sürüklemeden tıklandı: altındaki tek öğeyi ekle/çıkar.
            const tek = secilebilirler()
              .map((n) => ({ n, d: Math.hypot(n.x - mm.x, n.y - mm.y) }))
              .filter((k) => k.d < 25)
              .sort((a, b) => a.d - b.d)[0];
            if (tek) secimeYaz([tek.n.ad], true);
            else if (!eski.ekle) secimiBirak();
          }
          return;
        }

        if (eski.vurus && eski.tasindi) { surukle(eski.vurus.kayit, eski.vurus.katman, mm, true); return; }
        if (eski.tasindi || eski.vurus) return;
        if (T.ekleme && o.button === 0 && mm) { await bitkiEkle(mm); return; }
        if (o.button === 0) {
          if (mm) konumYaz(mm);
          secimiKapat();
        }
      };
      hedef.addEventListener("pointerup", bitir);
      hedef.addEventListener("pointercancel", bitir);
      hedef.addEventListener("contextmenu", (o) => o.preventDefault());
    });

    tuval.addEventListener("wheel", (o) => {
      o.preventDefault();
      kam.elleZoom = true;
      if (kam.ust) { kam.yakinlik = kis(kam.yakinlik * (o.deltaY > 0 ? 0.9 : 1.1), 0.4, 6); boyutla(); }
      else kam.r = kis(kam.r * (o.deltaY > 0 ? 1.1 : 0.9), 0.35, 12);
    }, { passive: false });

    window.addEventListener("keydown", (o) => {
      if (!T.gorunur) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) return;

      // Çoklu seçim varsa klavye önce onu görüyor.
      if (T.secim.size) {
        if (o.key === "Escape") { secimiBirak(); return; }
        if (o.key === "Delete") { topluIslem("sil"); return; }
      }
      if (!T.secili) return;
      if (o.key === "Escape") secimiKapat();
      if (o.key === "Delete" && T.secili.katman.tanim.sil) {
        T.secili.katman.tanim.sil(katmanBaglami(T.secili.katman), T.secili.kayit);
      }
    });

    window.addEventListener("resize", boyutla);
  }

  function ipucu(metin) {
    const k = $("#tarla-ipucu");
    if (!k) return;
    k.textContent = metin;
    k.classList.toggle("gorunur", !!metin);
  }

  /** Boş yere tıklandığında koordinatı yazıyoruz — 2B haritanın işi bu. */
  function konumYaz(mm) {
    const k = $("#tarla-konum");
    if (k) k.textContent = `X ${say(mm.x, 1)} · Y ${say(mm.y, 1)} mm`;
  }

  /* ------------------------------------------------------- bitki ekleme */
  function bosAd(slug) {
    const kullanilan = new Set(VERI.noktalar.map((n) => n.ad));
    for (let i = 1; i < 9999; i++) if (!kullanilan.has(`${slug}-${i}`)) return `${slug}-${i}`;
    return `${slug}-${Date.now()}`;
  }

  async function bitkiEkle(mm) {
    const slug = $("#tur-secim").value;
    const tur = VERI.turler[slug];
    if (!tur) { gunluk("✕ Önce bir tür seçin", "hata"); return; }
    const govde = {
      ad: bosAd(slug), x: Math.round(mm.x * 10) / 10, y: Math.round(mm.y * 10) / 10,
      z: T.guvenliZ, etiket: "bitki", tur: slug, ekim: Math.floor(Date.now() / 1000),
    };
    try {
      await P().apiIste("/api/noktalar", { method: "POST", body: JSON.stringify(govde) });
      gunluk(`✓ ${tur.name_tr} eklendi (${govde.ad}) X${say(govde.x, 1)} Y${say(govde.y, 1)}`, "ok");
      await P().noktalariYukle();
    } catch (h) { gunluk(`✕ Bitki eklenemedi: ${h.message}`, "hata"); }
  }

  /* ------------------------------------------------------- veri toplama */
  async function turleriYukle() {
    let liste = [];
    try { liste = (await P().apiIste("/api/turler")).turler || []; }
    catch (h) { gunluk(`✕ Bitki türleri okunamadı: ${h.message}`, "hata"); }
    VERI.turler = {};
    liste.forEach((t) => { VERI.turler[t.slug] = t; });
    const sec = $("#tur-secim");
    sec.innerHTML = liste.slice().sort((a, b) => String(a.name_tr).localeCompare(String(b.name_tr), "tr"))
      .map((t) => `<option value="${kacisli(t.slug)}">${kacisli(t.icon || "🌱")} ${kacisli(t.name_tr)} · ${say(t.spread_mm, 0)} mm</option>`)
      .join("");
  }

  /** Kamera kareleri ve sensör okumaları — yalnızca ilgili katman AÇIKSA. */
  async function yanVeriTazele() {
    const acikMi = (kimlik) => T.katmanlar.some((k) => k.tanim.kimlik === kimlik && k.acik);
    if (acikMi("kareler")) {
      try { VERI.kareler = (await P().apiIste("/api/kare/liste")).kareler || []; }
      catch (h) { VERI.kareler = []; }
    }
    if (acikMi("okumalar")) {
      try { VERI.okumalar = (await P().apiIste("/api/olcum/konumlu?dakika=1440")).okumalar || []; }
      catch (h) { VERI.okumalar = []; }
    }
    katmanlariGuncelle();
  }

  /* ------------------------------------------------------ katman yükleme */
  async function katmanDosyalariniYukle() {
    let adlar = [];
    try { adlar = (await P().apiIste("/api/katmanlar")).katmanlar || []; }
    catch (h) { gunluk("✕ Katman listesi alınamadı", "hata"); }
    for (const ad of adlar) {
      await new Promise((coz) => {
        const s = document.createElement("script");
        s.src = "/statik/katmanlar/" + ad;
        s.onload = coz;
        s.onerror = () => { console.error("katman yüklenemedi:", ad); coz(); };
        document.head.appendChild(s);
      });
    }
  }

  /* ============================================================= arayüz */
  const Tarla = {
    katman: katmanKaydet,

    async kur() {
      if (T.hazir) return;
      if (typeof THREE === "undefined" || !window.MAKINE) {
        const u = $("#tarla-uyari");
        u.classList.remove("gizli");
        u.textContent = "3B kütüphanesi ya da makine tanımı yüklenemedi — harita kapalı.";
        return;
      }
      BAGLAM.THREE = THREE;
      // Ölçü/renk tablosu — makine.js'teki tek kaynak. Geometriyi katmanlar
      // window.FarmbotMakine.kur() ile kuruyor, çekirdek hiçbir şey çizmiyor.
      BAGLAM.makine = window.MAKINE;
      await turleriYukle();
      await katmanDosyalariniYukle();
      T.hazir = true;
      sahneyiKur();
      araclariBagla();
      Tarla.noktalarDegisti();
      yanVeriTazele();
    },

    noktalarDegisti() {
      if (!T.hazir) return;
      VERI.noktalar = (P().S && P().S.noktalar) || [];
      const imza = JSON.stringify(VERI.noktalar.map((n) => [n.ad, n.x, n.y, n.z, n.tur, n.ekim]));
      if (imza === T.sonNoktaImzasi) return;
      T.sonNoktaImzasi = imza;
      katmanlariGuncelle();
    },

    durumDegisti(d) {
      if (!T.hazir || !d) return;
      VERI.durum = d;
      if (d.guvenli_z != null) T.guvenliZ = Number(d.guvenli_z);

      const s = d.sinirlar;
      if (s && s.x && s.y && s.x.max != null && JSON.stringify(s) !== JSON.stringify(T.sinir)) {
        T.sinir = { x: s.x, y: s.y, z: s.z || VARSAYILAN_SINIR.z };
        olcuGuncelle();
        boyutla();
        kamerayiSigdir();
        T.sonNoktaImzasi = "";
      }

      const k = d.konum || {};
      VERI.konum = k.x == null ? null : { x: k.x, y: k.y, z: k.z };
      if (VERI.konum) {
        const son = VERI.iz[VERI.iz.length - 1];
        // İz yalnızca gerçekten yer değiştirince büyüyor: duran makinenin
        // aynı noktayı yüzlerce kez kaydetmesinin faydası yok.
        if (!son || Math.hypot(son.x - VERI.konum.x, son.y - VERI.konum.y) > 3) {
          VERI.iz.push({ ...VERI.konum, ts: Date.now() / 1000 });
          if (VERI.iz.length > IZ_AZAMI) VERI.iz.shift();
        }
      }
      katmanlariGuncelle();
    },

    /** Deneme yardımcısı — testin tıklayacağı yeri iz düşümle buluyor. */
    ekranNoktasi(mmx_, mmy_) {
      if (T.gorunum === "2b") {
        const kutu = tuval2b.getBoundingClientRect();
        const p = BAGLAM.mm2b(mmx_, mmy_);
        return { x: kutu.left + p.x, y: kutu.top + p.y };
      }
      const v = new THREE.Vector3(sx(mmx_), 0, sz(mmy_)).project(etkinKamera());
      const kutu = tuval.getBoundingClientRect();
      return { x: kutu.left + ((v.x + 1) / 2) * kutu.width,
               y: kutu.top + ((1 - v.y) / 2) * kutu.height };
    },

    /** app.js dizileri yükledikçe çağırıyor — "Dizi uygula" listesi. */
    dizilerDegisti(programlar) { dizileriTazele(programlar); },

    /** Deneme yardımcısı — çoklu seçimdeki nokta adları. */
    secimDurumu() { return [...T.secim]; },

    /** Deneme yardımcısı — 2B haritanın ölçeği ve kapsadığı alan. */
    olcekDurumu() {
      const a = haritaAlani();
      return { en: a.en, boy: a.boy, x0: a.x0, y0: a.y0,
               olcek: olcek2b, ayar: Object.assign({}, T.harita), sinir: T.sinir };
    },

    /** Deneme yardımcısı — katmanların durumu. */
    katmanDurumu() {
      return T.katmanlar.map((k) => ({
        kimlik: k.tanim.kimlik, ad: k.tanim.ad, acik: k.acik,
        nesne: k.grup ? k.grup.children.length : 0,
        sahnede: !!(k.grup && k.grup.parent),
      }));
    },

    gorunurluk(acik) {
      T.gorunur = !!acik;
      if (acik) { boyutla(); Tarla.noktalarDegisti(); yanVeriTazele(); }
    },
  };

  function gorunumSec(hangi) {
    T.gorunum = hangi;
    localStorage.setItem("farmbot_tarla_gorunum", hangi);
    $("#tarla-sahne3b").classList.toggle("gizli", hangi !== "3b");
    $("#tarla-sahne2b").classList.toggle("gizli", hangi !== "2b");
    $("#d-gorunum-3b").classList.toggle("secili", hangi === "3b");
    $("#d-gorunum-2b").classList.toggle("secili", hangi === "2b");
    $("#tarla-3b-arac").classList.toggle("gizli", hangi !== "3b");
    if (hangi === "2b") boyutla2b();
    else boyutla();
  }

  function eklemeKipi(acik) {
    T.ekleme = !!acik;
    const ekle = $("#d-ekleme-kipi");
    if (!ekle) return;
    ekle.classList.toggle("secili", T.ekleme);
    ekle.textContent = T.ekleme ? "Haritaya tıklayın" : "Bitki ekle";
  }

  /* ------------------------------------------------------- harita ayarları */
  function haritaAyarOku() {
    try {
      const ham = JSON.parse(localStorage.getItem("farmbot_harita_ayar") || "{}");
      T.harita = Object.assign({}, HARITA_VARSAYILAN, ham);
    } catch (h) { T.harita = Object.assign({}, HARITA_VARSAYILAN); }
  }

  function haritaAyarYaz() {
    localStorage.setItem("farmbot_harita_ayar", JSON.stringify(T.harita));
    haritaAyarCiz();
    boyutla2b();          // ölçek ve tuval oranı değişmiş olabilir
    ciz2bTumu();
  }

  /** Ayar panelini duruma göre boyar — tek yön: durum → arayüz. */
  function haritaAyarCiz() {
    const h = T.harita;
    const d = $("#ha-dondur");
    if (d) d.checked = !!h.dondur;
    document.querySelectorAll("#harita-ayar [data-kose]").forEach((b) => {
      b.classList.toggle("secili", b.dataset.kose === `${h.koseX}-${h.koseY}`);
    });
    const elle = h.boyutKip === "elle";
    if ($("#ha-dinamik")) $("#ha-dinamik").classList.toggle("secili", !elle);
    if ($("#ha-elle")) $("#ha-elle").classList.toggle("secili", elle);
    if ($("#ha-elle-alan")) $("#ha-elle-alan").classList.toggle("gizli", !elle);
    if ($("#ha-en")) $("#ha-en").value = h.elleEn;
    if ($("#ha-boy")) $("#ha-boy").value = h.elleBoy;
  }

  function haritaAyarBagla() {
    haritaAyarOku();
    const panel = $("#harita-ayar"), dugme = $("#d-harita-ayar");
    if (!panel || !dugme) return;

    dugme.onclick = () => {
      const acik = panel.classList.toggle("gizli");
      dugme.setAttribute("aria-expanded", String(!acik));
      dugme.classList.toggle("secili", !acik);
    };

    $("#ha-dondur").onchange = (o) => { T.harita.dondur = o.target.checked; haritaAyarYaz(); };
    panel.querySelectorAll("[data-kose]").forEach((b) => {
      b.onclick = () => {
        const [kx, ky] = b.dataset.kose.split("-");
        T.harita.koseX = kx; T.harita.koseY = ky;
        haritaAyarYaz();
      };
    });
    $("#ha-dinamik").onclick = () => { T.harita.boyutKip = "dinamik"; haritaAyarYaz(); };
    $("#ha-elle").onclick = () => { T.harita.boyutKip = "elle"; haritaAyarYaz(); };
    const sayiAl = (alan, anahtar) => {
      alan.onchange = () => {
        T.harita[anahtar] = kis(Number(alan.value) || 0, 50, 5000);
        haritaAyarYaz();
      };
    };
    sayiAl($("#ha-en"), "elleEn");
    sayiAl($("#ha-boy"), "elleBoy");
    $("#ha-sifirla").onclick = () => {
      T.harita = Object.assign({}, HARITA_VARSAYILAN);
      haritaAyarYaz();
    };
    haritaAyarCiz();
  }

  function araclariBagla() {
    haritaAyarBagla();
    const ekle = $("#d-ekleme-kipi");
    ekle.onclick = () => {
      eklemeKipi(!T.ekleme);
      // Ekleme ve seçme ikisi de sol tıkla çalışıyor: biri açılınca diğeri kapanıyor.
      if (T.ekleme && T.kip === "sec") kipSec("tasi");
    };

    $("#d-kip-tasi").onclick = () => kipSec("tasi");
    $("#d-kip-sec").onclick = () => kipSec("sec");
    $("#d-toplu-sula").onclick = () => topluIslem("sula");
    $("#d-toplu-gez").onclick = () => topluIslem("gez");
    $("#d-toplu-sil").onclick = () => topluIslem("sil");
    $("#d-toplu-dizi").onclick = () => topluIslem("dizi");
    $("#toplu-dizi").onchange = () => diziDegerleriCiz();
    $("#d-toplu-temizle").onclick = () => secimiBirak();
    kipSec(localStorage.getItem("farmbot_tarla_kip") || "tasi");

    $("#d-gorunum-3b").onclick = () => gorunumSec("3b");
    $("#d-gorunum-2b").onclick = () => gorunumSec("2b");
    $("#d-gorus-ust").onclick = () => {
      kam.ust = true; boyutla();
      $("#d-gorus-ust").classList.add("secili");
      $("#d-gorus-serbest").classList.remove("secili");
    };
    $("#d-gorus-serbest").onclick = () => {
      kam.ust = false;
      $("#d-gorus-serbest").classList.add("secili");
      $("#d-gorus-ust").classList.remove("secili");
    };
    gorunumSec(localStorage.getItem("farmbot_tarla_gorunum") || "3b");

    // Kamera kareleri ve sensör okumaları düzenli tazeleniyor; katman
    // kapalıysa istek bile atılmıyor (yanVeriTazele bakıyor).
    setInterval(() => { if (T.gorunur) yanVeriTazele(); }, 20000);
  }

  window.Tarla = Tarla;
})();
