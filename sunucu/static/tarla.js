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
    sonDurumImzasi: "",
    ekleme: false,

    // İKİ KİP (FarmBot'un move/select ayrımı).
    //   "tasi" — sürükle döndürür, öğe sürüklenir, tek tıkla kart açılır
    //   "sec"  — sürükleme kutu seçimi çizer, Shift ile tek tek eklenir
    kip: "tasi",
    secim: new Set(),            // seçili nokta ADLARI
    harita: Object.assign({}, HARITA_VARSAYILAN),

    // Çizim döngüsü yalnız bu işaretliyken çiziyor (bkz. kirlet).
    kirli: true,
    cizilenKare: 0,              // ölçüm için — kaç kare gerçekten çizildi
    kirletKaynak: {},            // ölçüm için — hangi olay kaç kez işaretledi
  };

  /** Tek seferde işlenebilecek nokta sayısı — sunucudaki sınırla aynı.
   *  Yatağımız 425 x 600 mm; sığan fide sayısı bu mertebede. */
  const AZAMI_SECIM = 40;

  /* Bütün katmanların ortak veri havuzu. Tek kaynak: ayrı bir depo yok,
     2B ve 3B aynı nesneleri okuyor. */
  const VERI = {
    noktalar: [],     // nokta deposu (bitkiler de burada, `tur` alanıyla)
    turler: {},       // slug -> tür kaydı (katalog + tür ezmesi birleşmiş)
    turAlanlari: {},  // düzenlenebilir alanların başlık/birim/sınır tanımı
    durum: {},        // ajandan gelen son durum
    konum: null,      // {x,y,z}
    iz: [],           // [{x,y,ts}] — robotun geçtiği yerler
    kareler: [],      // [{damga,ts,x,y}]
    okumalar: [],     // [{ts,x,y,toprak_nem}]
    kalibrasyon: null, // kamera kalibrasyonu — {mm_px, donme, ofset_x, ofset_y, …}
    egriler: [],      // [{ad,tip,birim,noktalar}] — yaşa göre değer
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

  /* ============================================ tür / bitki özellikleri
   *
   * Bir bitkinin çapı üç yerden gelebiliyor ve sıra şu:
   *
   *   bitkinin `ozel` alanı  >  türün ezmesi  >  kurtarılmış katalog
   *
   * Bu sıralamayı tek bir yerde çözüyoruz. Katmanlar `Number(t.spread_mm)`
   * diye kendi hesabını yaparsa üç katmandan biri gözden kaçıyor ve halka
   * ile kart farklı sayı gösteriyor.
   */
  const TUR_TABAN = { spread_mm: 200, sow_depth_mm: 10, days_to_harvest: 60,
                      water_ml_per_day: 100 };

  /** Bir alanın çözülmüş değeri + nereden geldiği.
   *  `ozelMi`: bitki türünden farklı. `turEzik`: tür katalogdan farklı. */
  function turAlani(nokta, alan) {
    const tur = (nokta && nokta.tur && VERI.turler[nokta.tur]) || null;
    const sayi = (v) => (v == null || v === "" ? null : Number(v));
    const turDeger = tur ? sayi(tur[alan]) : null;
    const katalog = tur && tur.ezili && tur.ezili[alan] != null
      ? sayi(tur.ezili[alan]) : turDeger;
    const ozel = nokta && nokta.ozel ? sayi(nokta.ozel[alan]) : null;
    const taban = turDeger != null ? turDeger : TUR_TABAN[alan];
    return {
      deger: ozel != null ? ozel : taban,
      tur: taban, katalog, ozel,
      ozelMi: ozel != null,
      turEzik: !!(tur && tur.ezili && tur.ezili[alan] != null),
    };
  }

  /** Bitkinin TAM kaydını yazar. "Üstüne yaz" bütün kaydı değiştirdiği
   *  için eksik gönderilen her alan siliniyor; tek yerden göndermek bu
   *  sınıftaki hataları bitiriyor. */
  function bitkiYaz(n, degisim) {
    const govde = {
      ad: n.ad, x: n.x, y: n.y, z: n.z, etiket: n.etiket || "bitki",
      tur: n.tur, ekim: n.ekim, ustune_yaz: true,
      egri_su: n.egri_su || "", egri_yayilim: n.egri_yayilim || "",
      egri_yukseklik: n.egri_yukseklik || "",
      ozel: n.ozel || {},
      ...(degisim || {}),
    };
    return P().apiIste("/api/noktalar", { method: "POST", body: JSON.stringify(govde) });
  }

  /** Tek bitkiyi ez ya da (deger null ise) türe döndür. */
  async function bitkiEzme(n, alan, deger) {
    // Depodaki TAZE kaydı okuyoruz: karttaki kayıt nesnesi eskimiş
    // olabiliyor ve eski `ozel` ile yazmak, az önce sıfırlanmış bir
    // değeri geri diriltirdi.
    const taze = VERI.noktalar.find((x) => x.ad === n.ad) || n;
    const ozel = { ...(taze.ozel || {}) };
    if (deger == null) delete ozel[alan];
    else ozel[alan] = Number(deger);
    await bitkiYaz(taze, { ozel });
    await P().noktalariYukle();
  }

  async function turKaydet(slug, alanlar) {
    await P().apiIste("/api/turler", { method: "POST",
      body: JSON.stringify({ slug, alanlar }) });
    await turleriYukle();
    katmanlariGuncelle();
  }

  async function turSifirla(slug, alan) {
    const q = alan ? `&alan=${encodeURIComponent(alan)}` : "";
    await P().apiIste(`/api/turler?slug=${encodeURIComponent(slug)}${q}`, { method: "DELETE" });
    await turleriYukle();
    katmanlariGuncelle();
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
    /** Bir eğrinin `gun` yaşındaki değeri — `egriler.py`deki `deger()` ile
     *  aynı kural: aradaki günler doğrusal, uçlarda düz devam. Sunucuya
     *  gitmeden çizebilmek için burada da var; tek gerçek kaynak sunucu. */
    egriDeger(ad, gun) {
      const e = (VERI.egriler || []).find((x) => x.ad === ad);
      if (!e || !e.noktalar || !e.noktalar.length) return null;
      const n = e.noktalar;
      if (gun <= n[0][0]) return n[0][1];
      if (gun >= n[n.length - 1][0]) return n[n.length - 1][1];
      for (let i = 1; i < n.length; i++) {
        const [g0, d0] = n[i - 1], [g1, d1] = n[i];
        if (gun <= g1) return g1 === g0 ? d1 : d0 + (d1 - d0) * ((gun - g0) / (g1 - g0));
      }
      return n[n.length - 1][1];
    },
    get egriler() { return VERI.egriler; },
    get turAlanlari() { return VERI.turAlanlari; },
    turAlani, bitkiYaz, turKaydet, turSifirla, bitkiEzme,
    /** 2B: mm -> tuval pikseli */
    mm2b(x, y) {
      const t = haritaDonusum(x, y);
      return { x: t.u * olcek2b + kaydir2b.x, y: t.v * olcek2b + kaydir2b.y };
    },
    get olcek2b() { return olcek2b; },
    /** 2B dönüşümün doğrusal kısmı (mm -> piksel). Döndürme, sıfır köşesi ve
     *  ölçek hepsi burada. Bir katman kendi çizimini mm biriminde yapmak
     *  isterse `c.transform(a,b,c,d,0,0)` diyerek mm uzayına geçebiliyor —
     *  harita ayarlarını bilmesi gerekmiyor. */
    haritaMatris() {
      const s0 = BAGLAM.mm2b(0, 0), sx1 = BAGLAM.mm2b(1, 0), sy1 = BAGLAM.mm2b(0, 1);
      return { a: sx1.x - s0.x, b: sx1.y - s0.y, c: sy1.x - s0.x, d: sy1.y - s0.y };
    },
    komut: (ad, arg) => P().komutGonder && P().komutGonder(ad, arg),
    api: (yol, sec) => P().apiIste(yol, sec),
    noktalariYukle: () => P().noktalariYukle && P().noktalariYukle(),
    /** Silme yanıtındaki geri alma özetini şeride veriyor — 30 sn pencere. */
    geriAlGoster: (parti) => P().geriAlGoster && P().geriAlGoster(parti),
    tazele: () => { kirlet("tazele"); ciz2bTumu(); },
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
    kirlet("katman-guncelle");    // sahnedeki nesneler değişti
    kartTazele();
    ciz2bTumu();
    if (window.Profil) window.Profil.tazele();
  }

  /** Açık kartı yeni veriyle yeniden çizer.
   *
   * Katman kayıtları her güncellemede sıfırdan kuruluyor, elimizdeki kayıt
   * eskimiş oluyor. Kartın içinden bir değer değiştirildiğinde ("türden
   * farklı" işareti, ↺ düğmesi) kart kapanıp açılmadan tazelenmezse
   * kullanıcı değişikliğin işlediğini göremiyor. Aynı noktayı katmandan
   * yeniden soruyoruz; kimlik doğrulaması ada bakarak. */
  function kartTazele() {
    const s = T.secili;
    if (!s || !s.katman.acik || !s.kayit || !s.kayit.nokta || !s.katman.tanim.vur) return;
    const kutu0 = $("#tarla-kart");
    if (!kutu0) return;
    // Kullanıcı kartın içindeki bir ALANA yazıyorsa dokunmuyoruz: arka
    // planda dönen tazeleme yazılan sayıyı silmesin. Düğme odaktaysa
    // tazeliyoruz — ↺'ye basınca odak düğmede kalıyor ve kart eski
    // değerle donuyordu; donmuş kart bir sonraki düzenlemede silinmiş
    // ezmeyi geri diriltiyordu.
    const odak = document.activeElement;
    if (odak && kutu0.contains(odak) && /^(INPUT|SELECT|TEXTAREA)$/.test(odak.tagName)) return;
    const ad = s.kayit.nokta.ad;
    const o = katmanBaglami(s.katman);
    let taze = null;
    try { taze = s.katman.tanim.vur(o, { x: s.kayit.nokta.x, y: s.kayit.nokta.y }); }
    catch (h) { return; }
    if (!taze || !taze.nokta || taze.nokta.ad !== ad) return;   // silinmiş ya da başkası
    s.kayit = taze;
    const kutu = $("#tarla-kart");
    kutu.innerHTML = s.katman.tanim.kart(o, taze) +
      '<button class="kapat" id="d-tarla-kapat" title="Kapat">✕</button>';
    $("#d-tarla-kapat").onclick = secimiKapat;
    if (s.katman.tanim.baglan) {
      try { s.katman.tanim.baglan(o, kutu, taze); } catch (h) { console.error(h); }
    }
  }

  function katmanAcKapa(kayit, acik) {
    kayit.acik = acik;
    katmanSayaciYaz();
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
    kirlet("katman-ackapa");
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
    katmanSayaciYaz();
  }

  /** Çubuktaki "Katmanlar" düğmesinin yanındaki sayaç.
   *  Raf artık açılır panel; kaç katmanın açık olduğu paneli açmadan da
   *  görünsün diye sayı düğmenin üstünde duruyor. */
  function katmanSayaciYaz() {
    const s = $("#katman-sayac");
    if (!s) return;
    const acik = T.katmanlar.filter((k) => k.acik).length;
    s.textContent = `${acik}/${T.katmanlar.length}`;
  }

  /* ======================================================== sahne kurma */
  function sahneyiKur() {
    tuval = $("#tarla-tuval");
    tuval2b = $("#tarla-tuval2b");
    c2b = tuval2b.getContext("2d");

    sahne = new THREE.Scene();
    sahne.background = new THREE.Color(BAGLAM.makine.renk.arka);
    // Uzak nesneler pusa karışıyor: ufuk çizgisi keskin bir kesik yerine
    // yumuşak bir geçiş oluyor ve zemin sonsuza kadar net gitmiyor.
    // 9-26 m denendi: kameranın gördüğü en uzak zemin ~8 m, yani pus hiç
    // devreye girmiyor ve çim karenin tepesine kadar net gidiyordu —
    // "uzak" diye bir yer yok, sahne bir çim halının üstünde duruyor gibi.
    // 2,5-10 m'de karenin üst bandı ufuk pusuna karışıyor; makine (kameraya
    // ~1,5 m) hâlâ tamamen net.
    sahne.fog = new THREE.Fog(0x6d7f80, 2.5, 10);

    kamera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
    // Üstten görünüm ortografik: perspektifte direkler yatağın üstüne
    // devriliyor, plan olmaktan çıkıyordu.
    kameraUst = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
    kam.hedef = new THREE.Vector3(0, 0.15, 0);

    ciz = new THREE.WebGLRenderer({ canvas: tuval, antialias: true });
    ciz.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // TON EŞLEME. Tek yönlü ışığı gölge çıkacak kadar kuvvetli tutmak
    // gerekiyor, ama doğrudan kırpınca çim de alüminyum da bembeyaz bir
    // leke oluyordu. ACES yüksek değerleri sıkıştırıyor: parlak yerler
    // beyaza yapışmıyor, gölgeler kapanmıyor. Maliyeti bir parça
    // gölgelendirici matematiği, doku ya da çizim çağrısı değil.
    ciz.toneMapping = THREE.ACESFilmicToneMapping;
    ciz.toneMappingExposure = 0.95;
    // GÖLGE — tek yönlü ışıktan yumuşak gölge.
    // Harita 1024: Pi'nin GPU'sunda gölge haritası her karede yeniden
    // çiziliyor, 2048 dört kat piksel demek. 1024 bu yatak ölçüsünde
    // kirişin gölgesini keskin gösterecek kadar yeterli.
    ciz.shadowMap.enabled = true;
    ciz.shadowMap.type = THREE.PCFShadowMap;
    // Sahne otomatik güncelleme KAPALI: kirli bayrağı yokken gölge haritası
    // her karede yeniden çiziliyordu. Yalnız gerçekten çizdiğimiz karede
    // güncelleniyor (bkz. dongu).
    ciz.shadowMap.autoUpdate = false;

    /* IŞIK — ortam ışığı kısık, tek yönlü ışık baskın.
     * Eskiden yarımküre ışığı 1.15'ti: her yüzey her yönden aynı ışığı
     * alıyor, hacim hissi kalmıyordu. Kısınca yüzeylerin kendi eğrisi
     * görünüyor ve gölgeler bir yere oturuyor. */
    // Yerden gelen renk 0x3a3a2c'ydi: neredeyse siyah, karık dibi gibi
    // ışığı doğrudan görmeyen her yer kapkara çıkıyordu. Çimden
    // sekmiş ışık gerçekte de bu kadar koyu değil.
    sahne.add(new THREE.HemisphereLight(0xcfe0e8, 0x5c5a48, 0.55));
    const isik = new THREE.DirectionalLight(0xfff3e0, 2.15);
    isik.position.set(2.6, 3.4, 1.6);
    isik.castShadow = true;
    isik.shadow.mapSize.set(1024, 1024);
    // Gölge kamerası yalnız MAKİNEYİ kapsıyor. Önce ±1.6 m'ydi: 3,2 m'lik
    // alana yayılan 1024 piksel, yarım metrelik bir makinenin gölgesini
    // bulanık bir leke yapıyordu. ±0.75 m'de bir piksel ≈ 1,5 mm, kirişin
    // gölgesi kenarı belli çıkıyor. Çim gölge almıyor — zaten makinenin
    // gölgesi toprağa ve tezgâha düşüyor.
    const gk = isik.shadow.camera;
    gk.left = -0.75; gk.right = 0.75; gk.top = 0.75; gk.bottom = -0.75;
    gk.near = 0.5; gk.far = 9;
    // Akne (yüzeyin kendi gölgesini benekli göstermesi) için pay.
    isik.shadow.bias = -0.0012;
    isik.shadow.normalBias = 0.012;
    sahne.add(isik);
    sahne.add(isik.target);

    /* ÇEVRE — makine boşlukta durmuyor.
     *
     * Zemin 60 m: pusun bittiği yerden (26 m) uzun, yani zeminin kenarı
     * hiç görünmüyor, puslu bir UFUK ÇİZGİSİNE dönüşüyor. 16 m'de kenar
     * görünür bir kesikti ve sahne yine bir levhanın üstünde duruyordu.
     *
     * Doku tekrarı 150: bir karo ≈ 0,40 m, yani 512 pikselde ~10 pikselik
     * bir çim bıçağı ≈ 8 mm. Az tekrarda bıçaklar kürek gibi büyüyor,
     * çok tekrarda uzaktan gri bir bulamaca dönüşüyor. */
    const doku = window.FarmbotDoku;
    if (doku) {
      /* Zemin malzemesi BİLEREK sade: Lambert, kabartma YOK.
       * Ölçüm: bu düzlem ekranın tamamını kaplıyor, yani sahnenin en
       * pahalı yüzeyi o. Kabartma haritası açıkken (yazılım çizici,
       * boş yatak, döndürürken) 1,95 kare/sn, kapalıyken 2,36 —
       * yalnız zemin için %20. Uzaktan bakılan bir çim yüzeyinde
       * kabartmanın gözle görülür karşılığı yok; toprakta VAR, orada
       * duruyor. */
      const cim = doku.cim(THREE, 150);
      const zemin = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.MeshLambertMaterial({ map: cim.harita }));
      zemin.rotation.x = -Math.PI / 2;
      // Ayak pabuçlarının tam altı: tabla toprak yüzeyinin 50 mm altında,
      // ayak ondan 160 mm daha aşağıda. Yalnız `ayak` kadar inersek zemin
      // ayakları 50 mm kesiyor ve makine çime gömülmüş görünüyor.
      zemin.position.y = (BAGLAM.makine.tabla - BAGLAM.makine.ayak) * MM - 0.002;
      zemin.receiveShadow = true;
      zemin.name = "cim-zemin";
      sahne.add(zemin);

      const gokDoku = doku.gokyuzu(THREE);
      // Kubbe zeminin köşesinden (≈42 m) uzak olmalı, yoksa zemin kubbeyi
      // deliyor. 26 m'den ötesi zaten tamamen pus, ama delik görünmesin.
      const kubbe = new THREE.Mesh(
        new THREE.SphereGeometry(60, 24, 16),
        new THREE.MeshBasicMaterial({ map: gokDoku, side: THREE.BackSide, fog: false }));
      sahne.add(kubbe);
      sahne.background = null;   // arka planı kubbe veriyor

      // Metal parçalarda yansıma. Harita burada bir kez üretiliyor;
      // sahne.environment olarak VERİLMİYOR — küresel verilince gökyüzünün
      // alt yarısındaki yeşil toprağa ve bitkiye de biniyor, sahne
      // soluyordu. Malzemeler tek tek alıyor (makine.js/mal).
      doku.ortam(THREE, ciz);
    }

    kokGrup = new THREE.Group();
    sahne.add(kokGrup);

    // Görünmez seçme düzlemi — ışın testleri buna çarpıyor.
    secmeDuzlem = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
                                 new THREE.MeshBasicMaterial({ visible: false }));
    secmeDuzlem.rotation.x = -Math.PI / 2;
    sahne.add(secmeDuzlem);

    olcuGuncelle();
    if (window.Profil) window.Profil.kur();
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
  /* PANEL PAYI — sahne arka plan olduğundan tuval bütün kabuğu kaplıyor, ama
   * gerçekte görülen şerit panellerin ARASINDA kalan kısım. Makineyi tuvalin
   * ortasına koymak onu sol panelin altına itmek demek olurdu.
   *
   * Tuvali daraltmıyoruz (paneller sahneyi küçültmeyecek): kameranın
   * penceresini kaydırıyoruz. Panel katlanınca pay kendiliğinden sıfırlanıyor
   * ve makine boşalan yeri kullanıyor. */
  function panelPayi() {
    const bos = { sol: 0, sag: 0, ust: 0, alt: 0 };
    // Ölçü SAHNE KUTUSUNDAN alınıyor, tuvalden değil: 2B'ye geçince 3B tuvali
    // display:none oluyor ve ölçüsü sıfırlanıyor — pay da sıfır çıkıyordu,
    // harita panelin altına kayıyordu.
    const kutu = $("#harita") || tuval;
    if (!kutu) return bos;
    const t = kutu.getBoundingClientRect();
    if (!t.width || !t.height) return bos;
    /** Bir yüzen kutunun sahneden yediği pay. Kesişmiyorsa sıfır — telefonda
     *  paneller sahnenin ALTINDA duruyor ve pay istemiyorlar. */
    const olc = (sec, taraf) => {
      const e = $(sec);
      if (!e) return 0;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return 0;
      if (r.top >= t.bottom - 1 || r.bottom <= t.top + 1) return 0;
      if (r.left >= t.right - 1 || r.right <= t.left + 1) return 0;
      if (taraf === "sol") return kis(r.right - t.left, 0, t.width);
      if (taraf === "sag") return kis(t.right - r.left, 0, t.width);
      if (taraf === "ust") return kis(r.bottom - t.top, 0, t.height);
      return kis(t.bottom - r.top, 0, t.height);
    };
    bos.sol = olc("#sol-panel", "sol");
    // Sağda kalıcı duran tek kutu seçili öğenin kartı; katman rafı ve
    // harita ayarı açılır panel oldu, açıkken onlar da pay istiyor.
    bos.sag = Math.max(olc("#tarla-kart", "sag"), olc("#katman-kutu", "sag"),
                       olc("#harita-ayar", "sag"));
    // Dikey pay da şart: araç çubuğu üstte, toplu işlem ve profil altta
    // duruyor. Yalnız yatay payı hesaplarken haritanın alt ucu profilin
    // altında kalıyor ve oradaki bitkiye tıklanamıyordu.
    bos.ust = olc("#sahne-cubuk", "ust");
    bos.alt = Math.max(olc("#toplu-cubuk", "alt"), olc("#profil", "alt"));
    // Paylar sahneyi yerse ortada bir şey kalmıyor; geri çekiyoruz.
    if (bos.sol + bos.sag > t.width * 0.8) { bos.sol = 0; bos.sag = 0; }
    if (bos.ust + bos.alt > t.height * 0.8) { bos.ust = 0; bos.alt = 0; }
    return bos;
  }

  function kamerayiSigdir(enSerbest, olcek) {
    kirlet("kamera-sigdir");
    const yukseklikM = BAGLAM.makine.ray_yuksekligi * MM;
    // Bakılan nokta yatağa yakın: asıl konu bahçe, portal değil.
    const hedefY = yukseklikM * 0.30;
    // Kuşatan küre HEDEFİN etrafında ölçülüyor. Eskiden yarıçap orijinden
    // hesaplanıyor ama kamera hedefe bakıyordu; aradaki fark kadar üst
    // kırpılıyordu — portalın tepesi ekranın dışında kalıyordu.
    // Üstte pay var: Z kızağı ve uç kafası rayın ÜSTÜNE çıkıyor, kuşatan
    // kutuyu ray yüksekliğiyle sınırlamak portalın tepesini kırpıyordu.
    const tepeM = yukseklikM * 1.22;
    const R = Math.hypot(genislikM / 2, derinlikM / 2,
                         Math.max(hedefY, tepeM - hedefY));
    const yariFov = (kamera.fov * Math.PI) / 360;
    // Sığdırma panellerin ARASINDAKİ şeride göre: tuvalin tamamına
    // sığdırmak, makinenin yarısını panelin altında bırakıyordu.
    const en = enSerbest || kamera.aspect || 1.6;
    const yariYatay = Math.atan(Math.tan(yariFov) * en);
    kam.r = kis(Math.max(R / Math.sin(yariFov), R / Math.sin(yariYatay))
                * 1.02 * (olcek || 1), 0.5, 12);
    kam.hedef.set(0, hedefY, 0);
  }

  function boyutla() {
    if (!ciz || !tuval) return;
    kirlet("boyutla");
    const g = tuval.clientWidth || 800, y = tuval.clientHeight || 460;
    ciz.setSize(g, y, false);
    const en = g / Math.max(1, y);

    const pay = panelPayi();
    const serbestEn = Math.max(160, g - pay.sol - pay.sag);
    const serbestBoy = Math.max(160, y - pay.ust - pay.alt);
    const enSerbest = serbestEn / Math.max(1, serbestBoy);
    // Görüntüyü panellerin ARASINA ortalıyoruz. setViewOffset tuvalin
    // tamamını çizmeye devam ediyor, yalnız hangi pencereyi çizdiğini
    // kaydırıyor — sahne arka planda kesintisiz kalıyor.
    const kaydirX = (pay.sol - pay.sag) / 2;
    const kaydirY = (pay.ust - pay.alt) / 2;
    const kaydirVar = kaydirX || kaydirY;
    // Küçülen serbest alana sığdırmak için görüntüyü de o oranda geriye
    // çekiyoruz: pencereyi kaydırmak tek başına yetmiyor, yoksa makine
    // panellerin altına taşıyor.
    const olcek = Math.max(g / serbestEn, y / serbestBoy);

    kamera.aspect = en;
    if (kaydirVar) kamera.setViewOffset(g, y, -kaydirX, -kaydirY, g, y);
    else kamera.clearViewOffset();
    kamera.updateProjectionMatrix();

    const yariY = Math.max((derinlikM / 2) * 1.32 * olcek,
                           (genislikM / 2) * 1.32 * olcek / en) / kam.yakinlik;
    const yariX = yariY * en;
    kameraUst.left = -yariX; kameraUst.right = yariX;
    kameraUst.top = yariY; kameraUst.bottom = -yariY;
    if (kaydirVar) kameraUst.setViewOffset(g, y, -kaydirX, -kaydirY, g, y);
    else kameraUst.clearViewOffset();
    kameraUst.updateProjectionMatrix();

    if (!kam.elleZoom) kamerayiSigdir(enSerbest, olcek);
    boyutla2b();
  }

  /* ==================================================== kirli bayrağı
   *
   * Döngü eskiden hiçbir şey değişmese de saniyede 60 kare çiziyordu. Pi
   * aynı anda Modbus yokluyor, seri port okuyor ve kamera karesi alıyor;
   * boşa dönen render bunlarla yarışıyor. Artık yalnız İŞARETLİYKEN
   * çiziliyor. (farmbot-web'de Viewer3D.tsx aynı işi invalidate() ile
   * yapıyor.)
   *
   * İşaretleyenler: kamera oynaması, veri gelmesi, robotun kımıldaması,
   * katman açılıp kapanması, seçim ve ölçü değişikliği.
   *
   * ROBOT HAREKET HALİNDEYKEN sürekli işaretli kalıyor: durum paketleri
   * arasında konum ara değerlenmese de, hareket biterken gelen son paketi
   * kaçırmamak ve akıcılığı bozmamak için hareket bitene kadar çiziyoruz. */
  function kirlet(kaynak) {
    T.kirli = true;
    // Hangi olayın çizdirdiğini sayıyoruz: boşa dönen bir kaynak çıkarsa
    // ölçümle bulunabilsin (bkz. Tarla.cizimDurumu).
    const k = kaynak || "?";
    T.kirletKaynak[k] = (T.kirletKaynak[k] || 0) + 1;
  }

  /** Robot hareket ediyor mu — durum paketinden. */
  function hareketVar() {
    const d = VERI.durum || {};
    return !!(d.hareket || (d.jog && d.jog.length) ||
              (d.dizi && d.dizi.calisiyor) || (d.uc && d.uc.calisiyor));
  }

  function dongu() {
    requestAnimationFrame(dongu);
    if (!T.gorunur || T.gorunum !== "3b") return;   // gizliyken GPU yakma

    // Hareket sürerken her kare çiziliyor; durunca ilk temiz karede bırakıyoruz.
    if (hareketVar()) T.kirli = true;
    if (!T.kirli) return;                          // değişen bir şey yok
    T.kirli = false;
    T.cizilenKare++;
    // Gölge haritası yalnız GERÇEKTEN çizdiğimiz karede yenileniyor.
    // autoUpdate açık olsaydı boşta duran sahnede bile her karede yeniden
    // çizilirdi — kirli bayrağının bütün kazancını yerdi.
    ciz.shadowMap.needsUpdate = true;

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
    // 3B'deki panel payının 2B karşılığı: haritayı tuvalin değil, panellerin
    // ARASINDAKİ şeridin ortasına oturtuyoruz. İç boşluk kapsayıcıya
    // veriliyor, ortalamayı yine CSS (place-items: center) yapıyor.
    const pay = panelPayi();
    kapsayici.style.paddingLeft = pay.sol + "px";
    kapsayici.style.paddingRight = pay.sag + "px";
    kapsayici.style.paddingTop = pay.ust + "px";
    kapsayici.style.paddingBottom = pay.alt + "px";
    // Kutu ölçüsünü SAHNEDEN alıyoruz. clientWidth iç boşluğu da içeriyor,
    // yani payı kendisi düşmüyor; ayrıca tuvale "height: 100%" demek
    // ızgarada döngüye giriyordu (satır tuvale, tuval satıra bakıyor).
    const sahne = $("#harita");
    const kutuEn = Math.max(160, (sahne ? sahne.clientWidth : kapsayici.clientWidth)
                                 - pay.sol - pay.sag);
    const kutuBoy = Math.max(160, (sahne ? sahne.clientHeight : (tuval2b.clientHeight || 460))
                                  - pay.ust - pay.alt);
    tuval2b.style.height = kutuBoy + "px";

    const o0 = haritaOlcu();
    const enMM0 = o0.U, boyMM0 = o0.V;
    const istenen = (kutuBoy - KENAR2B.ust - KENAR2B.alt) * (enMM0 / boyMM0)
                    + KENAR2B.sol + KENAR2B.sag;
    tuval2b.style.width = Math.min(istenen, kutuEn) + "px";

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
    kirlet("secim");
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
    // Onay penceresi yok: "12 nokta silinecek, emin misiniz?" sorusu hangi 12
    // olduğunu göstermiyor. Silme uygulanıyor, 30 saniye geri alınabiliyor.
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
        BAGLAM.geriAlGoster(y.geri_al);
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
    kirlet("surukle");            // öğe yer değiştirdi — sahne yeniden çizilmeli
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
          kirlet("kaydir");
        } else if (ucBoyutlu && !kam.ust) {
          kam.theta = bas.theta - dx * 0.006;
          kam.phi = kis(bas.phi - dy * 0.006, 0.08, Math.PI / 2.15);
          kirlet("dondur");
        }
      });

      const bitir = async (o) => {
        if (!bas) return;
        const eski = bas; bas = null;
        try { hedef.releasePointerCapture(o.pointerId); } catch (h) { /* yoksay */ }
        ipucu("");
        const mm = ucBoyutlu ? zemindeMM(o) : olay2bMM(o);

        // Sol tuşla yapılan HER tıklama profil kesitini oraya taşıyor —
        // bir bitkiye tıklandığında da, çünkü kesite asıl o zaman bakılıyor.
        if (o.button === 0 && !eski.tasindi && mm && window.Profil) {
          window.Profil.konumSec(mm);
        }

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
      kirlet("zoom");
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
    try {
      const y = await P().apiIste("/api/turler");
      liste = y.turler || [];
      VERI.turAlanlari = y.alanlar || {};
    } catch (h) { gunluk(`✕ Bitki türleri okunamadı: ${h.message}`, "hata"); }
    VERI.turler = {};
    liste.forEach((t) => { VERI.turler[t.slug] = t; });
    const sec = $("#tur-secim");
    const onceki = sec.value;
    sec.innerHTML = liste.slice().sort((a, b) => String(a.name_tr).localeCompare(String(b.name_tr), "tr"))
      .map((t) => `<option value="${kacisli(t.slug)}">${kacisli(t.icon || "🌱")} ${kacisli(t.name_tr)} · ${say(t.spread_mm, 0)} mm${t.ezili && Object.keys(t.ezili).length ? " ✎" : ""}</option>`)
      .join("");
    if (onceki && VERI.turler[onceki]) sec.value = onceki;
    turFormuCiz();
  }

  /* ------------------------------------------------- tür düzenleme formu
   *
   * Seçili TÜRÜN varsayılanlarını değiştiriyor: bundan sonra eklenen
   * bitkiler bunu kullanıyor, mevcut bitkiler de (kendi ezmesi yoksa)
   * anında yeni değere geçiyor. Katalog dosyasına yazılmıyor; sunucu ayrı
   * bir dosyada tutuyor ve buradaki ✎ işareti "katalogdan farklı" demek.
   */
  function turFormuCiz() {
    const kutu = $("#tur-duzen");
    if (!kutu) return;
    const slug = $("#tur-secim").value;
    const t = VERI.turler[slug];
    const alanlar = VERI.turAlanlari || {};
    if (!t || !Object.keys(alanlar).length) { kutu.innerHTML = ""; return; }
    const ezik = Object.keys(t.ezili || {}).length;
    kutu.innerHTML = `<div class="tur-duzen-bas">
        <b>${kacisli(t.icon || "🌱")} ${kacisli(t.name_tr)}</b> varsayılanları
        ${ezik ? `<span class="rozet-fark">katalogdan farklı</span>
          <button class="dugme kucuk" id="d-tur-sifirla">↺ Türü sıfırla</button>` : ""}
      </div>
      <table class="tarla-ozellik">${Object.entries(alanlar).map(([a, b]) => {
        const farkli = t.ezili && t.ezili[a] != null;
        return `<tr><td>${kacisli(b.baslik)}</td><td>
          <input type="number" class="tur-alan" data-alan="${a}" value="${say(t[a], 2)}"
                 min="${b.alt}" max="${b.ust}" step="any">
          <span class="alt-not">${kacisli(b.birim)}</span>
          ${farkli ? `<button class="rozet-fark rozet-dugme tur-alan-sifirla" data-alan="${a}"
              title="Katalog değerine dön: ${say(t.ezili[a], 0)} ${kacisli(b.birim)}"
              >katalogdan farklı ↺</button>` : ""}
        </td></tr>`;
      }).join("")}</table>
      <div class="alt-not">Katalog dosyası değişmiyor; bu değerler ayrı tutuluyor.</div>`;

    kutu.querySelectorAll(".tur-alan").forEach((g) => {
      g.onchange = async () => {
        g.blur();
        try { await turKaydet(slug, { [g.dataset.alan]: g.value }); gunluk(`✓ ${t.name_tr} güncellendi`, "ok"); }
        catch (h) { gunluk(`✕ Tür kaydedilemedi: ${h.message}`, "hata"); turFormuCiz(); }
      };
    });
    kutu.querySelectorAll(".tur-alan-sifirla").forEach((d) => {
      d.onclick = () => turSifirla(slug, d.dataset.alan)
        .catch((h) => gunluk(`✕ Sıfırlanamadı: ${h.message}`, "hata"));
    });
    const hepsiSif = kutu.querySelector("#d-tur-sifirla");
    if (hepsiSif) hepsiSif.onclick = () => turSifirla(slug, "")
      .catch((h) => gunluk(`✕ Sıfırlanamadı: ${h.message}`, "hata"));
  }

  /** Kamera kareleri ve sensör okumaları — yalnızca ilgili katman AÇIKSA. */
  async function yanVeriTazele() {
    const acikMi = (kimlik) => T.katmanlar.some((k) => k.tanim.kimlik === kimlik && k.acik);
    if (acikMi("kareler")) {
      try { VERI.kareler = (await P().apiIste("/api/kare/liste")).kareler || []; }
      catch (h) { VERI.kareler = []; }
      // Kalibrasyon olmadan kare haritaya oturmuyor; katman açıkken tazeliyoruz.
      try { VERI.kalibrasyon = (await P().apiIste("/api/kamera/kalibrasyon")).kalibrasyon; }
      catch (h) { VERI.kalibrasyon = null; }
    }
    // Okumalar katman kapalıyken de çekiliyor: toprak yüzeyinin koyuluğu
    // artık nem okumasından geliyor (bkz. makine.js/nemBoya). Sensör
    // katmanı kapalı olsa bile sulanan yerin koyu görünmesi gerekiyor.
    try { VERI.okumalar = (await P().apiIste("/api/olcum/konumlu?dakika=1440")).okumalar || []; }
    catch (h) { VERI.okumalar = []; }
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

    noktalarDegisti(zorla) {
      if (!T.hazir) return;
      VERI.noktalar = (P().S && P().S.noktalar) || [];
      // `ozel` imzada: tek bitkinin çapı değiştiğinde halkanın ve çakışma
      // uyarısının anında güncellenmesi buna bağlı.
      const imza = JSON.stringify(VERI.noktalar.map(
        (n) => [n.ad, n.x, n.y, n.z, n.tur, n.ekim, n.ozel || null,
                n.egri_su, n.egri_yayilim, n.egri_yukseklik]));
      // `zorla`: veri aynı ama ÇİZİM kuralı değişti (simge anahtarı gibi).
      if (imza === T.sonNoktaImzasi && !zorla) return;
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

      // Durum paketi saniyede birkaç kez geliyor; çoğunda ÇİZİLEN hiçbir şey
      // değişmiyor. Katmanları her pakette yeniden kurmak Pi'de boşuna iş —
      // noktalarda olduğu gibi burada da imza karşılaştırıyoruz.
      const imza = JSON.stringify([
        VERI.konum && [Math.round(VERI.konum.x * 10), Math.round(VERI.konum.y * 10),
                       Math.round(VERI.konum.z * 10)],
        VERI.iz.length,
        d.bolgeler, (d.uc || {}).uc, (d.uc || {}).tools_konum, (d.uc || {}).calisiyor,
        d.acil && d.acil.acik, d.esnetme_acik,
      ]);
      if (imza === T.sonDurumImzasi) return;
      T.sonDurumImzasi = imza;
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

    /** Kalibrasyon değişince (Ayarlar sekmesi) haritayı tazeliyoruz. */
    async kalibrasyonDegisti() {
      try { VERI.kalibrasyon = (await P().apiIste("/api/kamera/kalibrasyon")).kalibrasyon; }
      catch (h) { VERI.kalibrasyon = null; }
      katmanlariGuncelle();
    },

    /** app.js eğrileri yükledikçe çağırıyor — bitki kartındaki seçenekler. */
    egrilerDegisti(liste) {
      VERI.egriler = liste || [];
      if (T.hazir) katmanlariGuncelle();
    },

    /** app.js dizileri yükledikçe çağırıyor — "Dizi uygula" listesi. */
    dizilerDegisti(programlar) { dizileriTazele(programlar); },

    /** Deneme yardımcısı — kaç kare GERÇEKTEN çizildi, şu an kirli mi. */
    cizimDurumu() {
      const d = VERI.durum || {};
      return { kare: T.cizilenKare, kirli: T.kirli, gorunum: T.gorunum,
               gorunur: T.gorunur, hareket: hareketVar(),
               ham: { hareket: !!d.hareket, jog: (d.jog || []).length,
                      dizi: !!(d.dizi && d.dizi.calisiyor),
                      uc: !!(d.uc && d.uc.calisiyor) },
               kaynak: { ...T.kirletKaynak },
               // Pi'nin GPU'sunu tahmin eden asıl sayılar: üçgen ve çizim
               // çağrısı. Buradaki yazılım çizicinin kare hızı Pi'yi temsil
               // etmiyor, bu ikisi ediyor.
               yuk: ciz ? { ucgen: ciz.info.render.triangles,
                            cagri: ciz.info.render.calls,
                            doku: ciz.info.memory.textures,
                            geometri: ciz.info.memory.geometries } : null,
               imza: T.sonDurumImzasi.slice(0, 60) };
    },

    /** Deneme yardımcısı — çoklu seçimdeki nokta adları. */
    secimDurumu() { return [...T.secim]; },

    /** PROFİL GÖRÜNTÜLEYİCİ'nin beslendiği tek yer.
     *
     * `profil.js` sahneye hiçbir şey çizmiyor — aynı verinin ikinci bir
     * görünümü. Nokta deposunu ya da makine durumunu kendisi okumuyor,
     * yalnız bunu çağırıyor. */
    profilVeri() {
      return {
        sinir: T.sinir,
        guvenliZ: T.guvenliZ,
        noktalar: VERI.noktalar,
        turler: VERI.turler,
        konum: VERI.konum,
        bolgeler: (VERI.durum && VERI.durum.bolgeler) || [],
      };
    },

    /** Deneme yardımcısı — katmanların ortak veri havuzu. */
    veriDurumu() {
      return { nokta: VERI.noktalar.length, kare: VERI.kareler.length,
               okuma: VERI.okumalar.length, iz: VERI.iz.length,
               kalibrasyon: VERI.kalibrasyon };
    },

    /** Deneme yardımcısı — 2B haritanın ölçeği ve kapsadığı alan. */
    olcekDurumu() {
      const a = haritaAlani();
      return { en: a.en, boy: a.boy, x0: a.x0, y0: a.y0,
               olcek: olcek2b, ayar: Object.assign({}, T.harita), sinir: T.sinir };
    },

    /** Bir alanın çözülmüş değeri — bitki > tür > katalog.
     *  Panelin dışından da (deneme, konsol) sorulabilsin diye açık. */
    turDegeri(nokta, alan) { return turAlani(nokta, alan); },

    /** Deneme yardımcısı — yayılım katmanının hesabı. */
    yayilimDurumu() {
      const k = T.katmanlar.find((x) => x.tanim.kimlik === "yayilim");
      if (!k || !k.tanim.hesapla) return [];
      return k.tanim.hesapla(katmanBaglami(k)).map((b) => ({
        ad: b.nokta.ad, r: b.r, ozelMi: !!b.ozelMi, egriden: !!b.egriden,
        cakisma: b.cakisma.map((c) => c.ad), disi: b.disi }));
    },

    /** Deneme yardımcısı — adı verilen öğenin kartını açar. */
    secKart(ad) {
      const n = VERI.noktalar.find((x) => x.ad === ad);
      if (!n) return false;
      const v = vurTara({ x: n.x, y: n.y });
      if (!v) return false;
      sec(v);
      return true;
    },

    /** Deneme yardımcısı — bitkiyi sürükleyip bırakmış gibi taşır. */
    bitkiTasiDeneme(ad, x, y) {
      const k = T.katmanlar.find((z) => z.tanim.kimlik === "bitkiler");
      const n = VERI.noktalar.find((z) => z.ad === ad);
      if (!k || !n) return false;
      const o = katmanBaglami(k);
      const kayit = k.tanim.vur(o, { x: n.x, y: n.y });
      if (!kayit) return false;
      k.tanim.tasi(o, kayit, { x, y }, true);
      return true;
    },

    /** Deneme yardımcısı — kamera açısı ve panel payı.
     *  Kabuk düzeni değişiminde "kamera açısı korundu mu" bununla ölçülüyor. */
    kameraDurumu() {
      const pay = panelPayi();
      const t = tuval ? tuval.getBoundingClientRect() : { width: 0, height: 0 };
      return { theta: kam.theta, phi: kam.phi, r: kam.r, ust: kam.ust,
               yakinlik: kam.yakinlik, elleZoom: kam.elleZoom,
               pay, tuval: { en: Math.round(t.width), boy: Math.round(t.height) } };
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
      if (acik) { kirlet("gorunurluk"); boyutla(); Tarla.noktalarDegisti(); yanVeriTazele(); }
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
    else { boyutla(); kirlet("gorunum"); }
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

    // Açma/kapama app.js'teki ortak "açılır panel" düzeneğinde: aynı anda
    // yalnız bir panel açık kalsın diye tek elden yönetiliyor.

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

    const turSec = $("#tur-secim");
    if (turSec) turSec.onchange = () => turFormuCiz();
    const turAc = $("#d-tur-duzen");
    if (turAc) turAc.onclick = () => {
      const k = $("#tur-duzen");
      const acik = k.classList.toggle("gizli");
      turAc.classList.toggle("secili", !acik);
      turAc.setAttribute("aria-expanded", String(!acik));
      if (!acik) turFormuCiz();
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
      kam.ust = true; boyutla(); kirlet("gorus");
      $("#d-gorus-ust").classList.add("secili");
      $("#d-gorus-serbest").classList.remove("secili");
    };
    $("#d-gorus-serbest").onclick = () => {
      kam.ust = false; kirlet("gorus");
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
