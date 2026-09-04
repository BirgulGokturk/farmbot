/* Bahçe — tuval sahnesi.
 *
 * NE OLDUĞU. Bahçeyle uğraşan biri için tek ekran: yükseltilmiş bir
 * yatak, üstünde gerçek koordinatlarında duran bitkiler ve gerçek
 * konumunda gezen makine. Teknik sekmeler (İzle/Sür/Tarla/Kamera)
 * olduğu gibi duruyor; burası onların yerine değil.
 *
 * ---------------------------------------------------------------------
 * NEDEN TUVAL, NEDEN DOM DEĞİL
 * ---------------------------------------------------------------------
 * Önceki deneme her bitkiyi bir DOM düğümü yapıyordu. Düz bir üstten
 * görünüm için yeterliydi ama istenen şey bu değil: derinlik, sürekli
 * salınım, gölge, ışık ve aynı anda onlarca öğenin akıcı hareketi.
 * Bunların hepsi DOM'da düzen (layout) tetikliyor ve tablette kare
 * düşürüyor. Tuvalde tek bir çizim yüzeyi var, kare başına maliyet
 * öngörülebilir ve derinlik sıralaması (ressam algoritması) bedava.
 *
 * ---------------------------------------------------------------------
 * İKİ KURAL — TASARIM BUNLARIN ÜSTÜNE KURULUYOR
 * ---------------------------------------------------------------------
 * 1. UYDURMA YOK. Ekrandaki her sayı ölçülmüş bir sayı. Nem
 *    ölçülmediyse yüzde yazılmıyor, "ölçülmedi" yazılıyor. Ölçüme değil
 *    geçen güne dayanan bir karar TAHMİN diye işaretleniyor. Bitkinin
 *    boyu ölçülen yayılım çapından, olgunluğu ekim tarihinden geliyor;
 *    yoksa bitki nötr çiziliyor ve etiketi "bilinmiyor" diyor.
 *
 *    SÜS İLE VERİ AYRI. Toprağın lekeleri, yaprakların salınımı, günün
 *    saatine göre ışık — bunlar süs ve hiçbiri bir ölçümü temsil
 *    etmiyor. Bir şeyin veri olduğu yerde (boy, olgunluk, nem, konum)
 *    kaynağı bu dosyada yorumla yazılı.
 *
 * 2. MAKİNE KENDİLİĞİNDEN HAREKET ETMEZ. Ekim ve sulama gibi geri
 *    alınamaz işler önce ne olacağını yazıyor, sonra onay istiyor.
 *    Makine kopukken iş başlatan düğmeler kilitli ve sebebi yazılı.
 *
 * ---------------------------------------------------------------------
 * KOORDİNAT DÜNYALARI
 * ---------------------------------------------------------------------
 *   mm     — yatak milimetresi, makinenin konuştuğu dil
 *   uv     — yatağın kendi birim karesi (0..1), v=0 ARKA kenar
 *   ekran  — tuval pikseli
 *
 * uv→ekran dönüşümü bir HOMOGRAFİ: yatak ekranda yamuk (arka kenar dar,
 * ön kenar geniş) duruyor ve bu izdüşüm afin değil. Tersi de alınıyor,
 * yani parmağın değdiği piksel tek bir matris çarpımıyla milimetreye
 * dönüyor — eğim ya da yakınlaştırma değişince hesap kendiliğinden
 * uyuyor.
 */
window.BahceTuval = (function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const P = () => window.Panel || {};

  /* Yamuğun arka kenarı ön kenarın kaçta kaçı. 1.0 düz üstten bakış
     demek; 0.62 yatağı bir kutu gibi gösteriyor ama arka sıradaki
     bitkileri tanınmayacak kadar küçültüyor. 0.78 ikisinin arası. */
  const ARKA_ORAN = 0.78;
  /* Derinliğin dikeyde ne kadar kısaldığı. 1.0 kuş bakışı (derinlik
     yok), 0.5 çok yatık. 0.66 eğik bir bakış. */
  const DERINLIK_KISALMA = 0.58;
  /* Yatağın kenar duvarı — görsel yükseklik, milimetre. Gerçek yatak
     yüksekliği ölçülü bir değer değil; kenarın KALINLIĞI burada bir
     sınır işareti, bir ölçüm değil. */
  const DUVAR_MM = 95;
  /* Milimetre yüksekliğin dikey ekran karşılığındaki oranı. */
  const YUKSEKLIK_ORANI = 0.72;

  const S = {
    acik: false,
    veri: null,
    hata: "",
    yukleniyor: false,
    sakin: false,
    notlar: {},
    tuval: null,
    ct: null,
    en: 0, boy: 0, dpr: 1,
    statik: null,          // arka planın önbelleklenmiş tuvali
    statikImza: "",
    kare: 0,
    dongu: 0,
    bitki: [],             // çizime hazır bitkiler (derinliğe göre sıralı)
    robot: { hx: 0, hy: 0, hz: null, gecerli: false },
    sonKare: 0,
    uzerinde: "",          // parmağın/farenin altındaki bitki
    basili: "",            // parmağın BASTIĞI bitki
    vurguAn: {},           // ad -> 0..1 yumuşatılmış vurgu
    basAn: {},             // ad -> 0..1 yumuşatılmış basma
    dogus: {},             // ad -> yeni gelen bitkinin beliriş anı
    canlanma: {},          // ad -> sulandıktan sonraki canlanma anı
    etiketAn: {},          // ad -> 0..1 baloncuk görünürlüğü
    kartAd: "",
    ek: null,              // /api/bitki — kuruma geçmişi, sulama süresi
    secilenTur: "",        // eline aldığı tohum
    gozler: null,          // o türün GERÇEK boş yerleri (/api/bahce/bos-yer)
    surukle: null,
    suruklendi: false,
    onizleme: null,        // bırakılırsa ne olacağı
    // KAMERA. İzdüşüm (homografi) sabit kalıyor, kamera onun ÜSTÜNE
    // bir ölçek/kaydırma olarak biniyor: yakınlaşınca arka plan yeniden
    // çizilmiyor, önbellekli tuval olduğu gibi büyüyor.
    kam: { o: 1.25, x: 0, y: 0, ho: 1.25, hx: 0, hy: 0 },
    kamElle: false,        // kullanıcı kamerayı elle oynattı mı
    gezinme: null,
    kutlama: [],           // biten işin küçük kutlaması
    sonIs: null,           // en son çalışan iş — bitişini yakalamak için
    t0: performance.now(),
  };

  /* ==================================================================== *
   * Küçük yardımcılar
   * ==================================================================== */
  const sayi = (d, v = 0) => {
    const s = Number(d);
    return Number.isFinite(s) ? s : v;
  };
  const kis = (d, a, b) => Math.max(a, Math.min(b, d));

  function gunluk(metin, sinif) {
    if (P().gunluk) P().gunluk(metin, sinif || "");
  }

  async function api(yol, secenek) {
    return P().apiIste(yol, secenek);
  }

  /** Uyarı satırı: birden çok sebep olabilir, her biri kendi
   *  anahtarıyla yazılıyor ki biri ötekini silmesin. */
  function notYaz(anahtar, metin) {
    if (metin) S.notlar[anahtar] = metin; else delete S.notlar[anahtar];
    const el = $("#bt-uyari");
    if (!el) return;
    const hepsi = Object.values(S.notlar).filter(Boolean);
    el.hidden = !hepsi.length;
    el.textContent = hepsi.join(" · ");
  }

  /** Adından türeyen sabit sayı — süs için.
   *
   * Rastgele olsaydı her karede bitki başka türlü görünürdü; addan
   * türetince aynı bitki her zaman aynı duruyor. Hiçbir ölçüme karşılık
   * gelmiyor ve hiçbir sayıya dönüşmüyor. */
  function tohum(ad) {
    let h = 2166136261;
    const s = String(ad || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  /** Tekrarlanabilir sayı üreteci — toprağın lekeleri her çizimde aynı
   *  yerde olsun diye (mulberry32). */
  function uretec(cekirdek) {
    let a = cekirdek >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------- renk */
  function hexRGB(h) {
    const s = String(h || "").replace("#", "");
    const t = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
    const n = parseInt(t.slice(0, 6), 16);
    return Number.isFinite(n)
      ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
      : { r: 123, g: 191, b: 90 };
  }
  function rgba(c, a) { return `rgba(${c.r},${c.g},${c.b},${a})`; }
  /** Rengi açar (o>0) ya da koyultur (o<0). */
  function ton(c, o) {
    const f = (k) => Math.round(o >= 0 ? k + (255 - k) * o : k * (1 + o));
    return { r: kis(f(c.r), 0, 255), g: kis(f(c.g), 0, 255), b: kis(f(c.b), 0, 255) };
  }
  function karis(a, b, t) {
    return { r: Math.round(a.r + (b.r - a.r) * t),
             g: Math.round(a.g + (b.g - a.g) * t),
             b: Math.round(a.b + (b.b - a.b) * t) };
  }

  /* ==================================================================== *
   * Günün ışığı
   *
   * SÜS, VERİ DEĞİL. Kaynağı tarayıcının saati; hiçbir ölçüme karşılık
   * gelmiyor ve hiçbir sayıya dönüşmüyor. Amacı, ekranın sabah ile gece
   * arasında aynı görünmemesi — bahçeye bakan biri günün hangi
   * saatinde olduğunu bilir ve ekranın onu yalanlaması yersiz durur.
   * ==================================================================== */
  function isik() {
    const d = new Date();
    const saat = d.getHours() + d.getMinutes() / 60;
    // Basit bir gün eğrisi: 6'da doğuyor, 13'te tepede, 20'de batıyor.
    const yukseklik = kis(Math.sin(((saat - 6) / 14) * Math.PI), -0.25, 1);
    const gunduz = kis(yukseklik, 0, 1);
    const aci = ((saat - 6) / 14) * Math.PI;         // doğu → batı
    return {
      gunduz,
      // Gölge yönü: sabah sağa, akşam sola uzuyor.
      gx: -Math.cos(aci),
      gy: 0.55,
      // Gölge boyu: güneş alçakken uzun.
      boy: 1.0 + (1 - gunduz) * 1.6,
      // Sıcaklık: şafak ve gün batımı sıcak, öğle nötr, gece serin.
      sicak: karis({ r: 90, g: 120, b: 190 },
                   { r: 255, g: 214, b: 150 }, gunduz),
      guc: 0.10 + gunduz * 0.22,
    };
  }

  /* ==================================================================== *
   * Geometri — yatak ekranda nerede duruyor
   * ==================================================================== */
  const G = {
    kose: null,      // [arka-sol, arka-sağ, ön-sağ, ön-sol] ekran noktaları
    ileri: null,
    ters: null,
    enPx: 0,         // ön kenarın ekran genişliği
    mmEnI: 1, mmBoyI: 1,
    duvarPx: 0,
  };

  function yatakSinir() {
    const s = (S.veri && S.veri.sinirlar) || {};
    const x = s.x || {}, y = s.y || {};
    return { x1: sayi(x.min, 0), x2: sayi(x.max, 535),
             y1: sayi(y.min, 0), y2: sayi(y.max, 630) };
  }

  function mmUV(x, y) {
    const s = yatakSinir();
    return { u: (sayi(x) - s.x1) / Math.max(1, s.x2 - s.x1),
             v: (sayi(y) - s.y1) / Math.max(1, s.y2 - s.y1) };
  }
  function uvMM(u, v) {
    const s = yatakSinir();
    return { x: s.x1 + u * (s.x2 - s.x1), y: s.y1 + v * (s.y2 - s.y1) };
  }

  /** Birim kareden yamuğa homografi. Köşe sırası (0,0) (1,0) (1,1) (0,1). */
  function homografi(k) {
    const [p0, p1, p2, p3] = k;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const sx = p0.x - p1.x + p2.x - p3.x;
    const sy = p0.y - p1.y + p2.y - p3.y;
    let a, b, c, d, e, f, g, h;
    if (Math.abs(sx) < 1e-6 && Math.abs(sy) < 1e-6) {
      a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
      d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
      g = 0; h = 0;
    } else {
      const payda = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(payda) < 1e-9) return null;
      g = (sx * dy2 - dx2 * sy) / payda;
      h = (dx1 * sy - sx * dy1) / payda;
      a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x;
      d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
    }
    return [a, b, c, d, e, f, g, h, 1];
  }

  function matrisTers(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, Bv = f * g - d * i, C = d * h - e * g;
    const det = a * A + b * Bv + c * C;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
    return [A / det, (c * h - b * i) / det, (b * f - c * e) / det,
            Bv / det, (a * i - c * g) / det, (c * d - a * f) / det,
            C / det, (b * g - a * h) / det, (a * e - b * d) / det];
  }

  /** Yatağı tuvalin ORTASINA, KENARLARDAN PAY BIRAKARAK yerleştirir.
   *
   * Yatak ekranın kahramanı: kalan yeri değil, ekranı alıyor. Pay
   * yüzdeyle veriliyor ki telefonda da tablette de aynı görünsün. */
  function geometriKur() {
    const s = yatakSinir();
    const mmEn = Math.max(1, s.x2 - s.x1);
    const mmBoy = Math.max(1, s.y2 - s.y1);
    G.mmEnI = mmEn; G.mmBoyI = mmBoy;

    const payX = Math.max(14, S.en * 0.035);
    const payY = Math.max(12, S.boy * 0.035);
    const kullanEn = Math.max(80, S.en - payX * 2);
    const kullanBoy = Math.max(80, S.boy - payY * 2);

    // Yamuğun ekran ölçüleri: ön kenar `enPx`, dikey uzanım `boyPx`.
    // Duvar da dikeyde yer kaplıyor, yükseklik hesabına giriyor.
    const oran = (mmBoy / mmEn) * DERINLIK_KISALMA;
    const duvarOraniPx = (DUVAR_MM / mmEn) * YUKSEKLIK_ORANI;
    let enPx = kullanEn;
    let boyPx = enPx * oran + enPx * duvarOraniPx;
    if (boyPx > kullanBoy) {
      enPx = kullanBoy / (oran + duvarOraniPx);
      boyPx = kullanBoy;
    }
    const derinlikPx = enPx * oran;
    G.enPx = enPx;
    G.duvarPx = enPx * duvarOraniPx;

    const cx = S.en / 2;
    // Duvar aşağı doğru çiziliyor: yamuğu o kadar yukarı alıyoruz ki
    // yatak + duvar birlikte ortalansın.
    const ust = (S.boy - (derinlikPx + G.duvarPx)) / 2;
    const arkaEn = enPx * ARKA_ORAN;
    G.kose = [
      { x: cx - arkaEn / 2, y: ust },                      // (0,0) arka-sol
      { x: cx + arkaEn / 2, y: ust },                      // (1,0) arka-sağ
      { x: cx + enPx / 2, y: ust + derinlikPx },           // (1,1) ön-sağ
      { x: cx - enPx / 2, y: ust + derinlikPx },           // (0,1) ön-sol
    ];
    G.ileri = homografi(G.kose);
    G.ters = G.ileri ? matrisTers(G.ileri) : null;
  }

  function yansit(u, v) {
    const m = G.ileri;
    if (!m) return { x: 0, y: 0 };
    const w = m[6] * u + m[7] * v + m[8];
    if (Math.abs(w) < 1e-9) return { x: 0, y: 0 };
    return { x: (m[0] * u + m[1] * v + m[2]) / w,
             y: (m[3] * u + m[4] * v + m[5]) / w };
  }

  function ekranUV(x, y) {
    const t = G.ters;
    if (!t) return null;
    const w = t[6] * x + t[7] * y + t[8];
    if (Math.abs(w) < 1e-9) return null;
    return { u: (t[0] * x + t[1] * y + t[2]) / w,
             v: (t[3] * x + t[4] * y + t[5]) / w };
  }

  /** O derinlikte bir milimetre kaç ekran pikseli.
   *  Yamuk daraldığı için arka sıra öndekinden küçük çiziliyor. */
  function mmPx(v) {
    return (G.enPx * (ARKA_ORAN + (1 - ARKA_ORAN) * kis(v, 0, 1))) / G.mmEnI;
  }

  /** Yerden `mm` yükseklikteki bir noktanın ekranda ne kadar yukarı
   *  kaydığı. Dikey kısalma yüzünden 1 mm yükseklik 1 mm derinlikten
   *  daha az yer kaplıyor. */
  function yukseklikPx(mm, v) {
    return sayi(mm) * mmPx(v) * YUKSEKLIK_ORANI;
  }

  /* ==================================================================== *
   * Arka plan — ÖNBELLEKLİ
   *
   * Çim, yatağın duvarları, toprak dokusu ve dikim alanları her karede
   * yeniden çizilmiyor: bunlar ancak ölçü ya da veri değişince
   * değişiyor. Bir kez ayrı bir tuvale çiziliyor, her kare tek
   * `drawImage` ile geliyor. Tablette kare süresini üçte birine
   * indiren şey bu.
   * ==================================================================== */
  function statikImza() {
    const v = S.veri || {};
    const s = yatakSinir();
    return [S.en, S.boy, S.dpr, s.x1, s.x2, s.y1, s.y2,
            JSON.stringify(v.alanlar || []),
            JSON.stringify((v.bolgeler || []).map((b) => [b.x1, b.y1, b.x2, b.y2])),
            new Date().getHours()].join("|");
  }

  function yol(ct, noktalar) {
    ct.beginPath();
    noktalar.forEach((p, i) => (i ? ct.lineTo(p.x, p.y) : ct.moveTo(p.x, p.y)));
    ct.closePath();
  }

  /** Yatağın milimetre dikdörtgeninden ekran çokgeni. Kenarlar yamuk
   *  olduğu için köşeleri bağlamak yetiyor. */
  function mmDortgen(x1, y1, x2, y2) {
    const a = mmUV(x1, y1), b = mmUV(x2, y1), c = mmUV(x2, y2), d = mmUV(x1, y2);
    return [yansit(a.u, a.v), yansit(b.u, b.v), yansit(c.u, c.v), yansit(d.u, d.v)];
  }

  function statikCiz() {
    const imza = statikImza();
    if (S.statik && S.statikImza === imza) return;
    S.statikImza = imza;

    const t = S.statik || document.createElement("canvas");
    t.width = Math.max(1, Math.round(S.en * S.dpr));
    t.height = Math.max(1, Math.round(S.boy * S.dpr));
    S.statik = t;
    const ct = t.getContext("2d");
    ct.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ct.clearRect(0, 0, S.en, S.boy);

    const I = isik();
    cimCiz(ct, I);
    if (!G.ileri) return;
    yatakGolgesi(ct, I);
    duvarCiz(ct, I);
    toprakCiz(ct, I);
    alanCiz(ct);
    yasakCiz(ct);
    cerceveCiz(ct, I);
  }

  /* ---------------------------------------------------------------- çim */
  function cimCiz(ct, I) {
    const g = ct.createLinearGradient(0, 0, 0, S.boy);
    const ust = karis({ r: 34, g: 48, b: 30 }, I.sicak, I.guc * 0.5);
    const alt = karis({ r: 20, g: 30, b: 18 }, I.sicak, I.guc * 0.25);
    g.addColorStop(0, `rgb(${ust.r},${ust.g},${ust.b})`);
    g.addColorStop(1, `rgb(${alt.r},${alt.g},${alt.b})`);
    ct.fillStyle = g;
    ct.fillRect(0, 0, S.en, S.boy);

    // Çim SÜS: yatağın bir yerde durduğunu anlatıyor, bilgi taşımıyor.
    const r = uretec(97);
    ct.lineWidth = 1;
    for (let i = 0; i < 900; i++) {
      const x = r() * S.en, y = r() * S.boy;
      const boy = 3 + r() * 5;
      const a = 0.05 + r() * 0.07;
      ct.strokeStyle = r() > 0.5 ? `rgba(150,200,120,${a})` : `rgba(0,0,0,${a})`;
      ct.beginPath();
      ct.moveTo(x, y);
      ct.lineTo(x + (r() - 0.5) * 3, y - boy);
      ct.stroke();
    }
    // Yumuşak bir aydınlık: bakışı yatağa çekiyor.
    const o = ct.createRadialGradient(S.en / 2, S.boy * 0.42, 10,
                                      S.en / 2, S.boy * 0.42, S.en * 0.7);
    o.addColorStop(0, `rgba(255,255,255,${0.05 + I.gunduz * 0.05})`);
    o.addColorStop(1, "rgba(0,0,0,0.35)");
    ct.fillStyle = o;
    ct.fillRect(0, 0, S.en, S.boy);
  }

  /* ------------------------------------------------------------- gölge */
  function yatakGolgesi(ct, I) {
    const d = cerceveKose();
    const alt = Math.max(d[2].y, d[3].y) + G.duvarPx;
    const merkezX = (d[2].x + d[3].x) / 2 + I.gx * G.enPx * 0.10 * I.boy;
    const genis = (d[2].x - d[3].x) * 0.62;
    ct.save();
    ct.filter = "blur(18px)";
    ct.fillStyle = `rgba(0,0,0,${0.30 + (1 - I.gunduz) * 0.12})`;
    ct.beginPath();
    ct.ellipse(merkezX, alt - G.duvarPx * 0.10, genis, G.duvarPx * 0.55, 0, 0, Math.PI * 2);
    ct.fill();
    ct.restore();
  }

  /** Çerçevenin DIŞ köşeleri — yatak sınırının 30 mm dışı.
   *  Yatak sınırı (0..1) toprağın kendisi; tahta onun dışında duruyor,
   *  yani ekilebilir alanı yemiyor. */
  function cerceveKose() {
    const ex = 30 / G.mmEnI, ey = 30 / G.mmBoyI;
    return [yansit(-ex, -ey), yansit(1 + ex, -ey),
            yansit(1 + ex, 1 + ey), yansit(-ex, 1 + ey)];
  }

  /* ------------------------------------------------------- kenar duvarı */
  function duvarCiz(ct, I) {
    const d = cerceveKose();
    const h = G.duvarPx;
    const tahta = { r: 122, g: 84, b: 52 };
    const on = karis(tahta, I.sicak, I.guc);

    // Ön duvar
    const g = ct.createLinearGradient(0, d[3].y, 0, d[3].y + h);
    const u1 = ton(on, -0.05), u2 = ton(on, -0.45);
    g.addColorStop(0, `rgb(${u1.r},${u1.g},${u1.b})`);
    g.addColorStop(1, `rgb(${u2.r},${u2.g},${u2.b})`);
    ct.fillStyle = g;
    yol(ct, [d[3], d[2], { x: d[2].x, y: d[2].y + h }, { x: d[3].x, y: d[3].y + h }]);
    ct.fill();

    // Yan duvarlar — ışığın geldiği taraf açık, öteki koyu.
    const yan = (a, b, koyu) => {
      const c = ton(on, koyu);
      ct.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      yol(ct, [a, b, { x: b.x, y: b.y + h }, { x: a.x, y: a.y + h }]);
      ct.fill();
    };
    yan(d[0], d[3], I.gx < 0 ? -0.18 : -0.5);   // sol
    yan(d[1], d[2], I.gx < 0 ? -0.5 : -0.18);   // sağ

    // Tahta damarı: SÜS. Birkaç ince çizgi, kalas hissi için.
    const r = uretec(31);
    ct.save();
    yol(ct, [d[3], d[2], { x: d[2].x, y: d[2].y + h }, { x: d[3].x, y: d[3].y + h }]);
    ct.clip();
    for (let i = 0; i < 26; i++) {
      const y = d[3].y + h * r();
      ct.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.10})`;
      ct.lineWidth = 0.6 + r();
      ct.beginPath();
      ct.moveTo(d[3].x, y);
      ct.bezierCurveTo(d[3].x + (d[2].x - d[3].x) * 0.35, y + (r() - 0.5) * 5,
                       d[3].x + (d[2].x - d[3].x) * 0.7, y + (r() - 0.5) * 5,
                       d[2].x, y + (r() - 0.5) * 3);
      ct.stroke();
    }
    ct.restore();
  }

  /* ------------------------------------------------------------ toprak */
  function toprakCiz(ct, I) {
    const q = [yansit(0, 0), yansit(1, 0), yansit(1, 1), yansit(0, 1)];
    ct.save();
    yol(ct, q);
    ct.clip();

    const t1 = karis({ r: 96, g: 68, b: 46 }, I.sicak, I.guc * 0.8);
    const t2 = { r: 52, g: 36, b: 24 };
    const g = ct.createLinearGradient(0, q[0].y, 0, q[3].y);
    g.addColorStop(0, `rgb(${ton(t2, 0.05).r},${ton(t2, 0.05).g},${ton(t2, 0.05).b})`);
    g.addColorStop(0.55, `rgb(${t1.r},${t1.g},${t1.b})`);
    g.addColorStop(1, `rgb(${ton(t1, -0.18).r},${ton(t1, -0.18).g},${ton(t1, -0.18).b})`);
    ct.fillStyle = g;
    ct.fill();

    // TOPRAK DOKUSU — SÜS. Kesekler milimetre uzayında dağıtılıp
    // izdüşürülüyor: arka sıradaki keseğin küçük görünmesi, derinliğin
    // toprakta da sürmesi demek.
    const r = uretec(20260904);
    const s = yatakSinir();
    for (let i = 0; i < 820; i++) {
      const mx = s.x1 + r() * G.mmEnI;
      const my = s.y1 + r() * G.mmBoyI;
      const uv = mmUV(mx, my);
      const p = yansit(uv.u, uv.v);
      const o = mmPx(uv.v);
      const rad = (2.5 + r() * 11) * o;
      const koyu = r() > 0.45;
      ct.fillStyle = koyu ? `rgba(0,0,0,${0.05 + r() * 0.13})`
                          : `rgba(255,226,190,${0.02 + r() * 0.05})`;
      ct.beginPath();
      ct.ellipse(p.x, p.y, rad, rad * 0.62, r() * 3, 0, Math.PI * 2);
      ct.fill();
    }
    // Birkaç çakıl — ışığı yakalayan noktalar.
    for (let i = 0; i < 46; i++) {
      const uv = { u: r(), v: r() };
      const p = yansit(uv.u, uv.v);
      const o = mmPx(uv.v);
      ct.fillStyle = `rgba(214,204,188,${0.10 + r() * 0.16})`;
      ct.beginPath();
      ct.ellipse(p.x, p.y, 2.6 * o * 2, 1.7 * o * 2, 0, 0, Math.PI * 2);
      ct.fill();
    }
    ct.restore();
  }

  /* ------------------------------------------------- dikim alanları */
  function alanCiz(ct) {
    const alanlar = (S.veri && S.veri.alanlar) || [];
    const q = [yansit(0, 0), yansit(1, 0), yansit(1, 1), yansit(0, 1)];
    if (!alanlar.length) {
      // Alan tanımlı DEĞİLSE toprağı işlenmiş gibi göstermiyoruz:
      // toprağın nerede olduğu bilinmiyor ve ekran bunu uydurmuyor.
      return;
    }
    ct.save();
    yol(ct, q);
    ct.clip();

    // Alanların DIŞI karanlık: ekilemeyen yer görünüyor, yazılmıyor.
    ct.save();
    ct.beginPath();
    q.forEach((p, i) => (i ? ct.lineTo(p.x, p.y) : ct.moveTo(p.x, p.y)));
    ct.closePath();
    alanlar.forEach((a) => {
      const d = mmDortgen(sayi(a.x1), sayi(a.y1), sayi(a.x2), sayi(a.y2));
      ct.moveTo(d[0].x, d[0].y);
      for (let i = 3; i >= 1; i--) ct.lineTo(d[i].x, d[i].y);
      ct.closePath();
    });
    ct.fillStyle = "rgba(10,8,6,0.34)";
    ct.fill("evenodd");
    ct.restore();

    // İşlenmiş toprak: tırmık izleri X boyunca, 55 mm arayla.
    const s = yatakSinir();
    alanlar.forEach((a) => {
      const d = mmDortgen(sayi(a.x1), sayi(a.y1), sayi(a.x2), sayi(a.y2));
      ct.save();
      yol(ct, d);
      ct.clip();
      ct.fillStyle = "rgba(255,232,196,0.045)";
      ct.fill();
      const y1 = Math.min(sayi(a.y1), sayi(a.y2)), y2 = Math.max(sayi(a.y1), sayi(a.y2));
      for (let my = y1 + 20; my < y2; my += 55) {
        const u1 = mmUV(sayi(a.x1), my), u2 = mmUV(sayi(a.x2), my);
        const p1 = yansit(u1.u, u1.v), p2 = yansit(u2.u, u2.v);
        ct.strokeStyle = "rgba(0,0,0,0.13)";
        ct.lineWidth = Math.max(1, 5 * mmPx(u1.v));
        ct.beginPath(); ct.moveTo(p1.x, p1.y); ct.lineTo(p2.x, p2.y); ct.stroke();
        ct.strokeStyle = "rgba(255,236,208,0.07)";
        ct.lineWidth = Math.max(1, 3 * mmPx(u1.v));
        ct.beginPath();
        ct.moveTo(p1.x, p1.y - 2); ct.lineTo(p2.x, p2.y - 2);
        ct.stroke();
      }
      ct.restore();
      void s;
    });
    ct.restore();
  }

  /* ---------------------------------------------------- yasak bölgeler */
  function yasakCiz(ct) {
    const bolgeler = (S.veri && S.veri.bolgeler) || [];
    bolgeler.forEach((b) => {
      if (b.allow_if) return;          // koşullu bölge her zaman yasak değil
      const d = mmDortgen(sayi(b.x1 ?? b.x_min), sayi(b.y1 ?? b.y_min),
                          sayi(b.x2 ?? b.x_max), sayi(b.y2 ?? b.y_max));
      ct.save();
      yol(ct, d);
      ct.clip();
      ct.fillStyle = "rgba(224,82,82,0.10)";
      ct.fill();
      ct.strokeStyle = "rgba(224,82,82,0.28)";
      ct.lineWidth = 2;
      const kutu = d.reduce((a, p) => ({
        x1: Math.min(a.x1, p.x), y1: Math.min(a.y1, p.y),
        x2: Math.max(a.x2, p.x), y2: Math.max(a.y2, p.y),
      }), { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 });
      for (let x = kutu.x1 - (kutu.y2 - kutu.y1); x < kutu.x2; x += 12) {
        ct.beginPath();
        ct.moveTo(x, kutu.y1);
        ct.lineTo(x + (kutu.y2 - kutu.y1), kutu.y2);
        ct.stroke();
      }
      ct.restore();
      ct.strokeStyle = "rgba(224,82,82,0.45)";
      ct.lineWidth = 1.5;
      yol(ct, d);
      ct.stroke();
    });
  }

  /* ------------------------------------------------- çerçevenin üst yüzü */
  function cerceveCiz(ct, I) {
    const d = cerceveKose();
    const q = [yansit(0, 0), yansit(1, 0), yansit(1, 1), yansit(0, 1)];
    const tahta = karis({ r: 146, g: 102, b: 62 }, I.sicak, I.guc);
    ct.save();
    ct.beginPath();
    d.forEach((p, i) => (i ? ct.lineTo(p.x, p.y) : ct.moveTo(p.x, p.y)));
    ct.closePath();
    ct.moveTo(q[0].x, q[0].y);
    for (let i = 3; i >= 1; i--) ct.lineTo(q[i].x, q[i].y);
    ct.closePath();
    const g = ct.createLinearGradient(0, d[0].y, 0, d[3].y);
    g.addColorStop(0, `rgb(${ton(tahta, -0.22).r},${ton(tahta, -0.22).g},${ton(tahta, -0.22).b})`);
    g.addColorStop(1, `rgb(${tahta.r},${tahta.g},${tahta.b})`);
    ct.fillStyle = g;
    ct.fill("evenodd");
    ct.restore();

    // İç kenarda ince bir gölge: toprağın çerçeveden AŞAĞIDA olduğu
    // hissi buradan geliyor.
    ct.save();
    yol(ct, q);
    ct.clip();
    ct.strokeStyle = "rgba(0,0,0,0.45)";
    ct.lineWidth = Math.max(3, G.duvarPx * 0.16);
    yol(ct, q);
    ct.stroke();
    ct.restore();
  }

  /* ==================================================================== *
   * Bitkiler
   *
   * HER TÜR KENDİ ÇİZİMİ. Hepsini aynı yaprak yığını yapmak, bahçeye
   * bakan birinin marulla havucu ayırt edememesi demekti. Türün adından
   * bir "arketip" seçiliyor (gülçe, tüy, çalı, şerit, üçlü); tanınmayan
   * bir tür için arketip yine gülçe ama yaprak sayısı, genişliği ve ucu
   * ADDAN türetiliyor, yani iki bilinmeyen tür birbirine benzemiyor.
   *
   * ÖLÇÜLEN NE, SÜS NE:
   *   · genel boy      → `yaricap_mm` (ölçülen yayılım yarıçapı)
   *   · yaprak sayısı  → `olgunluk` (geçen gün / olgunluk süresi)
   *   · meyve          → `hasat` (gerçekten hasada hazır mı)
   *   · salınım, damar, gölge yönü → SÜS, hiçbir ölçüme karşılık gelmiyor
   * Olgunluk bilinmiyorsa (ekim tarihi yok) yaprak sayısı orta kademede
   * sabitleniyor ve etiket "yaş bilinmiyor" diyor — bilinmeyeni
   * ortalama diye çizmek, bilinmeyeni gizlemek olurdu.
   * ==================================================================== */
  const ARKETIPLER = {
    gulce: ["marul", "lettuce", "kivircik", "kıvırcık", "gobek", "göbek",
            "roka", "arugula", "ispanak", "spinach", "pazi", "pazı", "chard",
            "lahana", "cabbage", "brokoli", "broccoli", "karnabahar",
            "semizotu", "salata"],
    tuy: ["havuc", "havuç", "carrot", "dereotu", "dere otu", "dill",
          "rezene", "fennel", "kimyon", "maydanoz", "parsley", "kereviz",
          "turp", "radish", "pancar", "beet"],
    yuvarlak: ["fesleğen", "feslegen", "basil", "nane", "mint", "kekik",
               "thyme", "biberiye", "rosemary", "adaçayı", "adacayi", "sage",
               "reyhan"],
    cali: ["domates", "tomato", "biber", "pepper", "patlican", "patlıcan",
           "eggplant", "salatalik", "salatalık", "cucumber", "kabak",
           "zucchini", "bamya", "nohut", "patates"],
    serit: ["sogan", "soğan", "onion", "pirasa", "pırasa", "leek",
            "sarimsak", "sarımsak", "garlic", "misir", "mısır", "corn",
            "arpa", "bugday", "buğday", "cim", "çim"],
    uclu: ["cilek", "çilek", "strawberry", "fasulye", "bean", "bezelye",
           "pea", "yonca", "clover", "uzum", "üzüm"],
  };

  /* HER ARKETİPİN KENDİ SİLUETİ.
   *
   * Hepsini yerde yayılan bir gülçe gibi çizmek, yataktaki her bitkiyi
   * birbirinin aynısı yapıyordu: havucun tepesi İNCE ve DİK, marul
   * YAYVAN ve katmanlı, fesleğen YUVARLAK yapraklı. Ayrımı yapan şey
   * renk değil biçim — üstten bakışta bile.
   *
   * `dik` = siluetin ne kadar yukarı gittiği (0 tamamen yerde yayılan,
   * 1 dimdik). `boyOran` = yüksekliğin yayılım yarıçapına oranı.
   * İKİSİ DE SÜS: katalogda bitki yüksekliği yok, o yüzden hiçbir sayıya
   * dönüşmüyor ve hiçbir yerde yazılmıyor. Ölçülen tek boyut yayılım
   * çapı ve o, yerdeki halkanın çapı olarak duruyor.
   *
   * `kok` = toprak hizasında görünen kök omzu (havuç, turp, soğan).
   * Rengi kataloğun tür rengi — havucun turuncusu orada yazıyor.
   */
  const SILUET = {
    gulce:    { dik: 0.10, boyOran: 0.45, kok: false },
    tuy:      { dik: 0.92, boyOran: 1.75, kok: true },
    yuvarlak: { dik: 0.55, boyOran: 1.00, kok: false },
    cali:     { dik: 0.70, boyOran: 1.35, kok: false },
    serit:    { dik: 0.88, boyOran: 1.90, kok: true },
    uclu:     { dik: 0.30, boyOran: 0.70, kok: false },
  };

  function arketip(b) {
    const ad = `${b.tur || ""} ${b.tur_ad || ""}`.toLowerCase();
    for (const [k, sozler] of Object.entries(ARKETIPLER)) {
      if (sozler.some((s) => ad.includes(s))) return k;
    }
    return "gulce";
  }

  /** Türün YAPRAK RENGİ.
   *
   * Kataloğun `color` alanı yaprak rengi DEĞİL: türü listede ayırt etmek
   * için seçilmiş bir işaret rengi (çilek kırmızı, biber turuncu). Onu
   * yaprağa boyamak çileği kırmızı bir gülçe yapıyordu. Yaprak yeşil
   * kalıyor; tür ayrımı yeşilin tonundan ve SİLUETTEN geliyor. Katalog
   * rengi yalnız meyvede, kök omzunda ve etikette aksan.
   */
  function yesil(b) {
    const h = tohum(`${b.tur}-yaprak`);
    // 82°..142° arası: sarımsı yeşilden mavimsi yeşile.
    const aci = 82 + h * 60;
    const doy = 0.34 + tohum(`${b.tur}-doy`) * 0.24;
    return hslRGB(aci, doy, 0.34);
  }

  function hslRGB(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255),
             b: Math.round((b + m) * 255) };
  }

  /** Yaprak dış hattı. `dalga` kenarı kıvırcık yapıyor (marul, lahana);
   *  düz kenar (fasulye, çilek) için kapalı. Uç sivri: genişlik profili
   *  uçta sıfıra iniyor. */
  function yaprakYol(ct, uzun, genis, dalga, kayma) {
    const N = 13;
    // Genişlik profili: dipte dar, ortada geniş, uçta KÜT.
    // Sivri uç bütün gülçeyi bir kar tanesine çeviriyordu.
    const w = (t, y) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.58)), 0.72) * genis
      * (1 + (dalga ? 0.22 * Math.sin(t * Math.PI * 6 + y) : 0));
    ct.beginPath();
    ct.moveTo(0, 0);
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      ct.lineTo(-w(t, kayma), -uzun * t);
    }
    for (let i = N; i >= 1; i--) {
      const t = i / N;
      ct.lineTo(w(t, kayma + 0.9), -uzun * t);
    }
    ct.closePath();
  }

  /** Tek yaprak: dipten uca açılan bir renk geçişi + orta damar.
   *  Düz dolgu, üstten bakışta bütün yaprakları tek bir yıldıza
   *  dönüştürüyordu; geçiş her yaprağın kendi hacmini veriyor. */
  function yaprakCiz(ct, uzun, genis, dip, uc, dalga, kayma) {
    yaprakYol(ct, uzun, genis, dalga, kayma);
    const g = ct.createLinearGradient(0, 0, 0, -uzun);
    g.addColorStop(0, rgba(dip, 0.97));
    g.addColorStop(1, rgba(uc, 0.97));
    ct.fillStyle = g;
    ct.fill();
    // İnce koyu kenar: üst üste binen iki bitki birbirinden ayrılsın.
    ct.strokeStyle = rgba(ton(dip, -0.45), 0.55);
    ct.lineWidth = Math.max(0.5, uzun * 0.018);
    ct.stroke();
    ct.strokeStyle = rgba(ton(uc, 0.28), 0.45);
    ct.lineWidth = Math.max(0.5, uzun * 0.028);
    ct.beginPath();
    ct.moveTo(0, -uzun * 0.05);
    ct.lineTo(0, -uzun * 0.86);
    ct.stroke();
  }

  /** Dik siluetlerin ortak iskeleti: dipten çıkan, hafif kavisli bir sap.
   *  Dönen değer sapın UCU — yaprak oraya konuyor. */
  function sapCiz(ct, aci, boy, kalin, renk, egim) {
    const ux = Math.sin(aci) * boy * (0.35 + egim * 0.5);
    const uy = -Math.cos(aci) * boy;
    ct.strokeStyle = rgba(renk, 0.95);
    ct.lineWidth = Math.max(0.8, kalin);
    ct.lineCap = "round";
    ct.beginPath();
    ct.moveTo(0, 0);
    ct.quadraticCurveTo(ux * 0.25, uy * 0.55, ux, uy);
    ct.stroke();
    return { x: ux, y: uy };
  }

  /* ------------------------------------------------------------- gülçe
   * Marul, lahana, roka: YERDE YAYILAN ve katmanlı. Dışta uzun ve koyu,
   * içte kısa ve açık; ortada sıkışmış bir göbek. */
  function cizGulce(ct, R, c, olgun, t, faz, ozel) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.08, 1);
    const dis = Math.max(11, Math.round(10 + oran * 10));
    const katlar = [
      { n: dis, uzun: R, ton: -0.34, egim: 0.0 },
      { n: Math.max(8, Math.round(dis * 0.74)), uzun: R * 0.74, ton: -0.06, egim: 0.41 },
      { n: Math.max(6, Math.round(dis * 0.5)), uzun: R * 0.48, ton: 0.18, egim: 1.07 },
      { n: Math.max(4, Math.round(dis * 0.3)), uzun: R * 0.26, ton: 0.36, egim: 1.9 },
    ];
    katlar.forEach((k, ki) => {
      for (let i = 0; i < k.n; i++) {
        // Eşit aralık gülçeyi bir kar tanesine çeviriyordu: her yaprak
        // addan türeyen küçük bir sapma alıyor.
        const sapma = (tohum(`${ki}:${i}:${faz}`) - 0.5) * 0.42;
        const a = (Math.PI * 2 / k.n) * i + faz * 6 + k.egim + sapma;
        const sal = Math.sin(t * 0.85 + faz * 5 + i + ki) * 0.035;
        const uzunluk = k.uzun * (0.82 + tohum(`u${ki}:${i}:${faz}`) * 0.28);
        ct.save();
        ct.rotate(a + sal);
        ct.scale(1, 0.70);
        const kayma = tohum(`r${ki}:${i}`) * 0.16;
        yaprakCiz(ct, uzunluk, uzunluk * (ozel.genislik || 0.26),
                  ton(c, k.ton - 0.16 + kayma), ton(c, k.ton + 0.16 + kayma),
                  ozel.dalga, i * 0.6);
        ct.restore();
      }
    });
    const g = ct.createRadialGradient(0, 0, R * 0.02, 0, 0, R * 0.5);
    g.addColorStop(0, "rgba(0,0,0,0.34)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ct.fillStyle = g;
    ct.beginPath();
    ct.ellipse(0, 0, R * 0.5, R * 0.36, 0, 0, Math.PI * 2);
    ct.fill();
  }

  /* --------------------------------------------------------------- tüy
   * Havuç, dereotu, maydanoz: İNCE ve DİK bir tepe. Yerde yayılan bir
   * gülçe olarak çizildiğinde havuçla marul ayırt edilemiyordu. */
  function cizTuy(ct, R, c, olgun, t, faz, boy) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.08, 1);
    const sap = Math.max(6, Math.round(6 + oran * 8));
    for (let i = 0; i < sap; i++) {
      const y = (i / Math.max(1, sap - 1) - 0.5) * 2;      // -1..1
      const a = y * 0.62 + (tohum(`t${i}:${faz}`) - 0.5) * 0.22;
      const sal = Math.sin(t * 1.35 + i + faz * 6) * 0.05;
      const u = boy * (0.66 + tohum(`b${i}:${faz}`) * 0.42);
      const renk = ton(c, -0.18 + ((i % 3) * 0.14));
      ct.save();
      const uc = sapCiz(ct, a + sal, u, R * 0.055, renk, 0.25);
      // Tüycükler sapın üst yarısında, sapı izleyerek.
      ct.strokeStyle = rgba(renk, 0.9);
      ct.lineWidth = Math.max(0.5, R * 0.022);
      for (let j = 3; j <= 8; j++) {
        const o = j / 9;
        const bx = uc.x * o * (1.4 - o * 0.4), by = uc.y * o;
        const tl = u * 0.17 * (1 - o * 0.55);
        ct.beginPath();
        ct.moveTo(bx, by);
        ct.quadraticCurveTo(bx - tl * 0.7, by - tl * 0.35, bx - tl, by - tl * 0.85);
        ct.moveTo(bx, by);
        ct.quadraticCurveTo(bx + tl * 0.7, by - tl * 0.35, bx + tl, by - tl * 0.85);
        ct.stroke();
      }
      ct.restore();
    }
  }

  /* ----------------------------------------------------------- yuvarlak
   * Fesleğen, nane, kekik: kısa bir sapta KARŞILIKLI ÇİFTLER hâlinde
   * yuvarlak yapraklar. Sivri uçlu bir gülçeyle karıştırılmasın diye
   * yaprak profili küt ve geniş. */
  function cizYuvarlak(ct, R, c, olgun, t, faz, boy) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.1, 1);
    const kol = Math.max(3, Math.round(3 + oran * 3));
    for (let i = 0; i < kol; i++) {
      const a = (Math.PI * 2 / kol) * i + faz * 6;
      const sal = Math.sin(t * 0.75 + i + faz * 4) * 0.04;
      const u = boy * (0.7 + tohum(`y${i}:${faz}`) * 0.4);
      ct.save();
      ct.rotate(a * 0.22 + sal);
      const uc = sapCiz(ct, (a % (Math.PI * 2)) * 0.12 + (i - kol / 2) * 0.34,
                        u, R * 0.06, ton(c, -0.45), 0.3);
      ct.translate(uc.x, uc.y);
      // İki karşılıklı çift + tepe yaprağı.
      [[-1, 0.42], [1, 0.42], [-1, 0.78], [1, 0.78]].forEach((p, j) => {
        ct.save();
        ct.translate(-uc.x * (1 - p[1]) * 0.0, uc.y * (1 - p[1]) * 0.0);
        ct.rotate(p[0] * 1.25);
        yuvarlakYaprak(ct, u * 0.32 * p[1] * 1.4, ton(c, -0.24 + (j % 2) * 0.2),
                       ton(c, 0.16));
        ct.restore();
      });
      ct.save();
      ct.rotate(0.05);
      yuvarlakYaprak(ct, u * 0.34, ton(c, -0.16), ton(c, 0.22));
      ct.restore();
      ct.restore();
    }
  }

  /** Küt uçlu, neredeyse yuvarlak yaprak. */
  function yuvarlakYaprak(ct, uzun, dip, uc) {
    const g = ct.createLinearGradient(0, 0, 0, -uzun);
    g.addColorStop(0, rgba(dip, 0.97));
    g.addColorStop(1, rgba(uc, 0.97));
    ct.fillStyle = g;
    ct.beginPath();
    ct.moveTo(0, 0);
    ct.bezierCurveTo(-uzun * 0.62, -uzun * 0.22, -uzun * 0.52, -uzun * 0.92,
                     0, -uzun);
    ct.bezierCurveTo(uzun * 0.52, -uzun * 0.92, uzun * 0.62, -uzun * 0.22,
                     0, 0);
    ct.fill();
    ct.strokeStyle = rgba(ton(dip, -0.45), 0.5);
    ct.lineWidth = Math.max(0.5, uzun * 0.03);
    ct.stroke();
    ct.strokeStyle = rgba(ton(uc, 0.3), 0.45);
    ct.beginPath();
    ct.moveTo(0, -uzun * 0.06);
    ct.lineTo(0, -uzun * 0.88);
    ct.stroke();
  }

  /* --------------------------------------------------------------- çalı
   * Domates, biber, kabak: görünür bir GÖVDE ve ondan çıkan dallar.
   * Meyve YALNIZ gerçekten hasada hazırsa — olgunluk oranına bakıp
   * "herhâlde meyve vermiştir" demek ekranın uydurması olurdu. */
  function cizCali(ct, R, c, olgun, t, faz, hasat, aksan, boy) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.1, 1);
    const kat = Math.max(3, Math.round(3 + oran * 3));
    const govde = boy * 0.78;
    ct.strokeStyle = rgba(ton(c, -0.55), 0.95);
    ct.lineWidth = Math.max(1.4, R * 0.075);
    ct.lineCap = "round";
    ct.beginPath();
    ct.moveTo(0, 0);
    ct.quadraticCurveTo(R * 0.06, -govde * 0.5, 0, -govde);
    ct.stroke();
    for (let i = 0; i < kat; i++) {
      const h = govde * (0.28 + (i / kat) * 0.68);
      [-1, 1].forEach((yon, j) => {
        const a = yon * (0.75 + tohum(`c${i}${j}:${faz}`) * 0.4);
        const sal = Math.sin(t * 0.7 + i + j) * 0.05;
        const u = boy * (0.34 + tohum(`cu${i}${j}:${faz}`) * 0.22);
        ct.save();
        ct.translate(0, -h);
        ct.rotate(a + sal - yon * 0.35);
        ct.scale(1, 0.82);
        [-0.6, 0, 0.6].forEach((k, m) => {
          ct.save();
          ct.rotate(k);
          yaprakCiz(ct, u * (m === 1 ? 1 : 0.74), u * 0.30,
                    ton(c, -0.30), ton(c, 0.10), false, m);
          ct.restore();
        });
        ct.restore();
      });
    }
    if (hasat) {
      for (let i = 0; i < 3; i++) {
        const h = govde * (0.42 + i * 0.2);
        const yan = (i % 2 ? 1 : -1) * R * 0.3;
        const g = ct.createRadialGradient(yan - R * 0.05, -h - R * 0.05, R * 0.02,
                                          yan, -h, R * 0.19);
        g.addColorStop(0, rgba(ton(aksan, 0.35), 1));
        g.addColorStop(1, rgba(ton(aksan, -0.18), 1));
        ct.fillStyle = g;
        ct.beginPath();
        ct.ellipse(yan, -h, R * 0.17, R * 0.16, 0, 0, Math.PI * 2);
        ct.fill();
      }
    }
  }

  /* -------------------------------------------------------------- şerit
   * Soğan, pırasa, mısır: dipten çıkan DİK, kalınca bıçak yapraklar. */
  function cizSerit(ct, R, c, olgun, t, faz, boy) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.1, 1);
    const adet = Math.max(5, Math.round(5 + oran * 5));
    for (let i = 0; i < adet; i++) {
      const y = (i / Math.max(1, adet - 1) - 0.5) * 2;
      const a = y * 0.48 + (tohum(`s${i}:${faz}`) - 0.5) * 0.16;
      const sal = Math.sin(t * 1.05 + i * 0.8 + faz * 4) * 0.055;
      const u = boy * (0.72 + tohum(`sb${i}:${faz}`) * 0.42);
      const renk = ton(c, i % 2 ? -0.26 : 0.04);
      const ux = Math.sin(a + sal) * u * 0.42;
      const uy = -Math.cos(a + sal) * u;
      const gen = R * 0.13;
      ct.fillStyle = rgba(renk, 0.95);
      ct.beginPath();
      ct.moveTo(-gen, 0);
      ct.quadraticCurveTo(ux * 0.3 - gen * 0.7, uy * 0.55, ux, uy);
      ct.quadraticCurveTo(ux * 0.3 + gen * 0.7, uy * 0.55, gen, 0);
      ct.closePath();
      ct.fill();
      ct.strokeStyle = rgba(ton(renk, -0.4), 0.45);
      ct.lineWidth = Math.max(0.5, R * 0.018);
      ct.stroke();
    }
  }

  /* --------------------------------------------------------------- üçlü
   * Çilek, fasulye: üçer yapraklı kümeler; ortada da bir küme var,
   * yoksa bitki ortası delik bir çelenge dönüyordu. */
  function cizUclu(ct, R, c, olgun, t, faz, hasat, aksan) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.1, 1);
    const kume = Math.max(3, Math.round(3 + oran * 4));
    const ucluCiz = (uzun) => {
      [-0.78, 0, 0.78].forEach((k, j) => {
        ct.save();
        ct.rotate(k);
        yaprakCiz(ct, uzun * (j === 1 ? 1 : 0.82), uzun * 0.46,
                  ton(c, -0.28), ton(c, 0.14), true, j * 1.3);
        ct.restore();
      });
    };
    ct.save();
    ct.scale(1, 0.70);
    ct.rotate(faz * 6);
    ucluCiz(R * 0.42);
    ct.restore();
    for (let i = 0; i < kume; i++) {
      const a = (Math.PI * 2 / kume) * i + faz * 6;
      const sal = Math.sin(t * 0.9 + i + faz * 3) * 0.045;
      ct.save();
      ct.rotate(a + sal);
      ct.scale(1, 0.70);
      ct.translate(0, -R * 0.42);
      ucluCiz(R * 0.46);
      ct.restore();
    }
    if (hasat) {
      for (let i = 0; i < 2; i++) {
        const a = faz * 7 + i * 2.6;
        const mx = Math.cos(a) * R * 0.34, my = Math.sin(a) * R * 0.24;
        ct.fillStyle = rgba(aksan, 1);
        ct.beginPath();
        ct.moveTo(mx, my - R * 0.11);
        ct.bezierCurveTo(mx + R * 0.12, my - R * 0.09, mx + R * 0.08, my + R * 0.11,
                         mx, my + R * 0.12);
        ct.bezierCurveTo(mx - R * 0.08, my + R * 0.11, mx - R * 0.12, my - R * 0.09,
                         mx, my - R * 0.11);
        ct.fill();
      }
    }
  }

  /** Kök omzu — havuç, turp, soğan gibi kökü toprağın hizasında
   *  görünenler için. Rengi kataloğun tür rengi: havucun turuncusu
   *  orada yazıyor. Boyu bir ÖLÇÜM DEĞİL, süs. */
  function kokCiz(ct, R, aksan) {
    const g = ct.createLinearGradient(0, -R * 0.14, 0, R * 0.1);
    g.addColorStop(0, rgba(ton(aksan, 0.2), 0.95));
    g.addColorStop(1, rgba(ton(aksan, -0.35), 0.95));
    ct.fillStyle = g;
    ct.beginPath();
    ct.ellipse(0, 0, R * 0.26, R * 0.13, 0, 0, Math.PI * 2);
    ct.fill();
    ct.strokeStyle = "rgba(0,0,0,0.28)";
    ct.lineWidth = Math.max(0.5, R * 0.02);
    ct.stroke();
  }

  /** Bir bitkinin bütün çizimi: gölge, yayılım halkası, gövde. */
  function bitkiCiz(ct, b, t, I) {
    const R = b.cizimPx / 2;
    const s = SILUET[b.tip] || SILUET.gulce;
    // Gölge dik siluetlerde daha uzun: yukarı giden bir bitki yere daha
    // uzun bir gölge düşürüyor. Yönü güneşten, boyu güneşin
    // yüksekliğinden — ikisi de saatten, yani süs.
    ct.save();
    ct.globalAlpha = 0.20 + I.gunduz * 0.16;
    ct.fillStyle = "#000";
    ct.beginPath();
    ct.ellipse(b.x + I.gx * R * (0.30 + s.dik * 0.5) * I.boy, b.y + R * 0.14,
               R * (0.74 + s.dik * 0.2) * I.boy, R * 0.30, 0, 0, Math.PI * 2);
    ct.fill();
    ct.restore();

    // YAYILIM HALKASI — ÖLÇÜLEN çap. Çizilen bitki en az 26 piksel
    // oluyor ki fide görünsün; halka gerçeği söylüyor.
    if (b.capPx > 26) {
      ct.save();
      ct.setLineDash([5, 7]);
      ct.strokeStyle = b.cakisik ? "rgba(217,165,32,0.42)" : "rgba(255,255,255,0.10)";
      ct.lineWidth = 1;
      ct.beginPath();
      ct.ellipse(b.x, b.y, b.capPx / 2, b.capPx / 2 * 0.66, 0, 0, Math.PI * 2);
      ct.stroke();
      ct.restore();
    }

    // ÜZERİNE GELİNCE: hafifçe kalkıyor, altında yumuşak bir ışık
    // beliriyor. İkisi de SÜS.
    if (b.vurgu > 0.01) {
      const g = ct.createRadialGradient(b.x, b.y, R * 0.1, b.x, b.y, R * 1.25);
      g.addColorStop(0, `rgba(255,246,214,${(0.26 * b.vurgu).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,246,214,0)");
      ct.fillStyle = g;
      ct.beginPath();
      ct.ellipse(b.x, b.y, R * 1.25, R * 0.85, 0, 0, Math.PI * 2);
      ct.fill();
    }

    ct.save();
    ct.translate(b.x, b.y - yukseklikPx(16, b.v) - b.vurgu * R * 0.16);
    if (b.vurgu > 0.01) ct.scale(1 + b.vurgu * 0.05, 1 + b.vurgu * 0.05);
    // BASINCA EZİLME: genişler, alçalır. Bir düğmenin altına inmesi
    // gibi — dokunulan şeyin karşılık verdiği buradan anlaşılıyor.
    if (b.bas > 0.01) ct.scale(1 + b.bas * 0.07, 1 - b.bas * 0.11);
    // BELİRİŞ: yeni ekilen bitki hedefi bir parça aşıp yerine oturuyor.
    const dogus = S.dogus[b.ad];
    if (dogus != null) {
      const o2 = (t - dogus) / 0.55;
      if (o2 >= 1) delete S.dogus[b.ad];
      else { const s2 = 0.25 + 0.75 * asma(o2); ct.scale(s2, s2); }
    }
    // SULAMA BİTİNCE BİR KEZ CANLANMA: yapraklar hafifçe kabarıp
    // yerine oturuyor. Söylediği tek şey "bu bitki sulandı".
    const can = S.canlanma[b.ad];
    if (can != null) {
      const o3 = (t - can) / 1.4;
      if (o3 >= 1) delete S.canlanma[b.ad];
      else {
        const s3 = 1 + 0.10 * Math.sin(o3 * Math.PI * 3) * (1 - o3);
        ct.scale(s3, s3);
      }
    }
    const c = b.yaprak;
    const aksan = b.aksan;
    // Dik siluetin ekrandaki boyu: yayılım yarıçapının katı. Perspektif
    // kısalması yükseklikle aynı orandan geçiyor ki arka sıradaki bitki
    // öndekinden kısa görünsün.
    const boy = R * s.boyOran * YUKSEKLIK_ORANI * 1.4;
    if (s.kok) kokCiz(ct, R, aksan);
    if (b.tip === "tuy") cizTuy(ct, R, c, b.olgunluk, t, b.faz, boy);
    else if (b.tip === "yuvarlak") cizYuvarlak(ct, R, c, b.olgunluk, t, b.faz, boy);
    else if (b.tip === "cali") cizCali(ct, R, c, b.olgunluk, t, b.faz, b.hasat, aksan, boy);
    else if (b.tip === "serit") cizSerit(ct, R, c, b.olgunluk, t, b.faz, boy);
    else if (b.tip === "uclu") cizUclu(ct, R, c, b.olgunluk, t, b.faz, b.hasat, aksan);
    else cizGulce(ct, R, c, b.olgunluk, t, b.faz,
                  { genislik: 0.22 + b.faz * 0.12, dalga: true });
    ct.restore();
  }

  /* ==================================================================== *
   * Uçuşan etiketler
   *
   * Bahçeye bakan biri "bu ne, nemi kaç" sorusunu bitkinin üstünde
   * okuyabilmeli. Etiket ÖLÇÜLENİ yazıyor: nem ölçülmüşse yüzdesini,
   * ölçülmemişse "nem ölçülmedi". Tahmine dayanan susama işareti
   * kesikli çerçeveli — ölçülmüş bir kararla karıştırılmasın.
   *
   * Hepsini birden yazmak gürültü olurdu: kalabalık bir yatakta yalnız
   * İLGİ İSTEYENLER (susamış ya da hiç ölçülmemiş) etiketleniyor,
   * seyrek bir yatakta hepsi. Çakışan etiket çizilmiyor.
   * ==================================================================== */
  function yazTipi(px, kalin) {
    return `${kalin ? "600 " : ""}${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  }

  function yuvarlakKutu(ct, x, y, en, boy, r) {
    ct.beginPath();
    ct.moveTo(x + r, y);
    ct.arcTo(x + en, y, x + en, y + boy, r);
    ct.arcTo(x + en, y + boy, x, y + boy, r);
    ct.arcTo(x, y + boy, x, y, r);
    ct.arcTo(x, y, x + en, y, r);
    ct.closePath();
  }

  /** Küçük bir künye: türün adı ve ÖLÇÜLEN nemi.
   *
   * Bitkinin üstüne değil, tepesinin sağ üstüne konuyor ve ince bir
   * çizgiyle bağlanıyor — kutu bitkiyi örterse bitkiye bakılmıyor
   * demektir. Sol kenardaki renk şeridi türün katalog rengi.
   */
  /* BALONCUK — sahnenin parçası, arayüz kutusu değil.
   *
   * Siyah bir dikdörtgen sahnenin diliyle uyuşmuyordu. Şimdi yumuşak
   * bir kapsül: altında dağılan bir gölge, üstünde ince bir ışık, ve
   * bağlandığı şeye doğru küçük bir kuyruk. Yazı gölgeli, çünkü
   * baloncuk yarı saydam ve altından toprak da yaprak da geçebiliyor.
   *
   * GİRİP ÇIKIŞ YUMUŞAK: `alfa` 0'dan 1'e giderken baloncuk hem
   * beliriyor hem birkaç piksel yükseliyor. Anında görünüp kaybolan bir
   * kutu, ekranın kendi kendine sıçraması gibi duruyordu.
   */
  function baloncuk(ct, x, y, en, boy, renk, alfa, kuyruk) {
    const r = boy / 2;
    ct.save();
    ct.globalAlpha = kis(alfa, 0, 1);
    ct.translate(0, (1 - kis(alfa, 0, 1)) * 6);

    if (kuyruk) {
      ct.fillStyle = "rgba(22,24,20,0.80)";
      ct.beginPath();
      ct.moveTo(kuyruk.x, kuyruk.y);
      ct.lineTo(x + en * 0.30, y + boy - 2);
      ct.lineTo(x + en * 0.52, y + boy - 2);
      ct.closePath();
      ct.fill();
    }

    ct.shadowColor = "rgba(0,0,0,0.45)";
    ct.shadowBlur = 12;
    ct.shadowOffsetY = 3;
    ct.fillStyle = "rgba(22,24,20,0.80)";
    yuvarlakKutu(ct, x, y, en, boy, r);
    ct.fill();
    ct.shadowColor = "transparent";
    ct.shadowBlur = 0;
    ct.shadowOffsetY = 0;

    // Üstte ince bir ışık: kapsül düz bir leke değil, bir yüzey.
    const g = ct.createLinearGradient(0, y, 0, y + boy);
    g.addColorStop(0, "rgba(255,255,255,0.10)");
    g.addColorStop(0.5, "rgba(255,255,255,0.02)");
    g.addColorStop(1, "rgba(0,0,0,0.06)");
    ct.fillStyle = g;
    yuvarlakKutu(ct, x, y, en, boy, r);
    ct.fill();

    if (renk) {
      ct.fillStyle = rgba(renk, 0.95);
      ct.beginPath();
      ct.arc(x + r * 0.86, y + boy / 2, 3.2, 0, Math.PI * 2);
      ct.fill();
    }
    ct.restore();
  }

  /** Baloncuğun içine iki satır yazı — gölgeli, yarı saydam zeminde
   *  okunsun diye. */
  function baloncukYazi(ct, x, y, boy, ust, alt, altRenk, alfa) {
    ct.save();
    ct.globalAlpha = kis(alfa, 0, 1);
    ct.translate(0, (1 - kis(alfa, 0, 1)) * 6);
    ct.textBaseline = "top";
    ct.shadowColor = "rgba(0,0,0,0.55)";
    ct.shadowBlur = 3;
    ct.fillStyle = "#f4f2ea";
    ct.font = yazTipi(11, true);
    ct.fillText(ust, x, y + boy / 2 - 12);
    ct.font = yazTipi(10, false);
    ct.fillStyle = altRenk;
    ct.fillText(alt, x, y + boy / 2 + 1);
    ct.restore();
  }

  function etiketCiz(ct, b, kutular, alfa) {
    const o = b.olcum || {};
    const ad = String(b.tur_ad || b.tur || "bitki");
    const nem = o.var ? `%${sayi(o.yuzde).toFixed(0)}` : "nem ölçülmedi";
    ct.font = yazTipi(11, true);
    const enAd = ct.measureText(ad).width;
    ct.font = yazTipi(10, false);
    const enNem = ct.measureText(nem).width;
    const boy = 30;
    const solPay = boy / 2 * 0.86 + 9;                 // renk noktası + boşluk
    const en = Math.round(Math.max(enAd, enNem) + solPay + 12 + (b.susadi ? 14 : 0));

    // Kutu KAMERASIZ uzayda: bitkinin dünya noktası ekrana çevriliyor,
    // yarıçap da kamera ölçeğiyle çarpılıyor.
    const R = (b.cizimPx / 2) * S.kam.o;
    const tepe = ekranNok(b.x, b.y - yukseklikPx(16, b.v));
    const tx = tepe.x;
    const ty = tepe.y - R * 0.72;
    let x = Math.round(tx - en / 2);
    let yy = Math.round(ty - boy - 10);
    x = kis(x, 6, Math.max(6, S.en - en - 6));
    if (yy < 4) yy = 4;

    const kutu = { x1: x, y1: yy, x2: x + en, y2: yy + boy };
    if (kutular.some((k) => !(kutu.x2 < k.x1 - 4 || kutu.x1 > k.x2 + 4
                              || kutu.y2 < k.y1 - 4 || kutu.y1 > k.y2 + 4))) return;
    kutular.push(kutu);

    baloncuk(ct, x, yy, en, boy, b.aksan, alfa, { x: tx, y: ty });
    baloncukYazi(ct, x + solPay, yy, boy, ad, nem,
                 o.var ? "#c8c9bf" : "#8f9188", alfa);

    if (b.susadi) {
      ct.save();
      ct.globalAlpha = kis(alfa, 0, 1);
      ct.translate(0, (1 - kis(alfa, 0, 1)) * 6);
      const dx = x + en - 11, dy = yy + boy / 2;
      ct.beginPath();
      ct.moveTo(dx, dy - 7);
      ct.quadraticCurveTo(dx + 5, dy + 0.5, dx, dy + 5.5);
      ct.quadraticCurveTo(dx - 5, dy + 0.5, dx, dy - 7);
      // TAHMİN içi boş ve kesikli: ölçülmüş bir kararla aynı görünmesin.
      if (b.tahmin) {
        ct.setLineDash([2, 2]);
        ct.strokeStyle = "#4fb8e8";
        ct.lineWidth = 1;
        ct.stroke();
        ct.setLineDash([]);
      } else {
        ct.fillStyle = "#4fb8e8";
        ct.fill();
      }
      ct.restore();
    }
  }

  /* ==================================================================== *
   * Makine
   *
   * Üstten bakışta makine bir nokta değil: köprü uzun kenar boyunca
   * (makine Y'sinde) yürüyor ve X boyunca uzanıyor, kızak köprünün
   * üstünde X'te kayıyor. `makine.js` içindeki 3B sahne de böyle
   * kuruyor; iki ekranın aynı makineyi anlatması gerekiyor.
   *
   * KONUM BİLDİRİLMİYORSA ÇİZİLMİYOR. Robotu "herhâlde şuradadır" diye
   * bir yere koymak, bu ekranın söyleyebileceği en kötü yalan olurdu.
   *
   * HAREKET YUMUŞATILIYOR, UYDURULMUYOR. Durum paketi yarım saniyede bir
   * geliyor; çizim onu doğrudan izlerse makine kare kare zıplıyor.
   * Çizilen nokta bildirilen noktaya üstel olarak yaklaşıyor — yani her
   * zaman ölçülen konuma DOĞRU gidiyor, onu geçmiyor ve varmadığı bir
   * yere gitmiyor. Gecikme sabiti 90 ms; paketler arasında akıcı, paket
   * gelince bir kare içinde yakalıyor.
   * ==================================================================== */

  /* Köprünün toprağın üstündeki görsel yüksekliği (mm). Ölçülen bir
     değer DEĞİL — z ekseninin toplam boyu paketten gelmiyor. Sayı
     yazmıyoruz, yalnız köprüyü toprağın üstünde bir yere koyuyoruz. */
  const KOPRU_MM = 330;

  function robotHedef() {
    const k = (S.veri && S.veri.konum) || {};
    if (k.x == null || k.y == null || !(S.veri || {}).bagli) return null;
    return { x: sayi(k.x), y: sayi(k.y), z: k.z == null ? null : sayi(k.z) };
  }

  /** Çizilen konumu ölçülen konuma yaklaştırır. */
  function robotYurut(dt) {
    const h = robotHedef();
    const R = S.robot;
    if (!h) { R.gecerli = false; return; }
    if (!R.gecerli) {
      R.hx = h.x; R.hy = h.y; R.hz = h.z;
      R.gecerli = true;
      return;
    }
    const k = 1 - Math.exp(-dt / 0.09);
    R.hx += (h.x - R.hx) * k;
    R.hy += (h.y - R.hy) * k;
    if (h.z != null) R.hz = R.hz == null ? h.z : R.hz + (h.z - R.hz) * k;
  }

  /** Çalışan iş hangi başı kullanıyor? İş yoksa boş — hiçbir baş aktif
   *  değil demek, "herhâlde sulama başlığıdır" demek değil. */
  function aktifBasKimlik() {
    const v = S.veri || {};
    const calisan = (v.kuyruk || {}).calisan;
    if (!calisan) return "";
    return String((v.is_basi || {})[calisan.tip] || "");
  }

  function aktifBas() {
    const kimlik = aktifBasKimlik();
    if (!kimlik) return null;
    const b = ((S.veri || {}).baslar || {})[kimlik];
    return b ? Object.assign({ kimlik }, b) : null;
  }

  /** Bir başın İŞ NOKTASI: makine hedefe kaymayı EKLEYEREK gidiyor,
   *  yani işin olduğu yer makinenin yeri EKSİ kayma (`baslar.geri_al`).
   *  İkisini aynı yere çizmek, ekimin yanlış yere düştüğü hatayı
   *  ekranda tekrarlamak olurdu. */
  function basNoktasi(x, y, bas) {
    return { x: sayi(x) - sayi(bas.dx), y: sayi(y) - sayi(bas.dy) };
  }

  /** Ucun toprağın ÜSTÜNDEKİ yüksekliği (mm) — ÖLÇÜLEN z'den.
   *  z ya da toprak_z yoksa null: iniş çizilmiyor, uç köprüde duruyor. */
  function ucYuksekligi() {
    const v = S.veri || {};
    const z = S.robot.hz;
    const toprak = v.toprak_z;
    if (z == null || toprak == null) return null;
    return Math.max(0, sayi(z) - sayi(toprak));
  }

  function makineCiz(ct, t, I) {
    const R = S.robot;
    if (!R.gecerli || !G.ileri) return;
    const uv = mmUV(R.hx, R.hy);
    if (uv.v < -0.5 || uv.v > 1.5) return;      // yatağın çok dışında

    const o = mmPx(kis(uv.v, 0, 1));
    const kopruY = yukseklikPx(KOPRU_MM, uv.v);
    const solA = yansit(-0.06, uv.v);
    const sagA = yansit(1.06, uv.v);
    const kizakA = yansit(kis(uv.u, -0.06, 1.06), uv.v);

    // Köprünün toprağa düşen gölgesi — makinenin bahçenin ÜSTÜNDEN
    // geçtiği buradan anlaşılıyor.
    ct.save();
    ct.globalAlpha = 0.20 + I.gunduz * 0.18;
    ct.strokeStyle = "#000";
    ct.lineWidth = Math.max(4, 26 * o);
    ct.beginPath();
    ct.moveTo(solA.x + I.gx * kopruY * 0.35, solA.y + 6 * o);
    ct.lineTo(sagA.x + I.gx * kopruY * 0.35, sagA.y + 6 * o);
    ct.stroke();
    ct.restore();

    const sol = { x: solA.x, y: solA.y - kopruY };
    const sag = { x: sagA.x, y: sagA.y - kopruY };
    const kizak = { x: kizakA.x, y: kizakA.y - kopruY };

    // Ayaklar: köprünün iki ucundan raya iniyor.
    ct.strokeStyle = "#5b6169";
    ct.lineWidth = Math.max(3, 22 * o);
    ct.lineCap = "butt";
    [[sol, solA], [sag, sagA]].forEach(([a, b]) => {
      ct.beginPath(); ct.moveTo(a.x, a.y); ct.lineTo(b.x, b.y); ct.stroke();
    });

    // Kiriş
    const kalin = Math.max(5, 34 * o);
    const g = ct.createLinearGradient(0, sol.y - kalin / 2, 0, sol.y + kalin / 2);
    g.addColorStop(0, "#c3cad2");
    g.addColorStop(0.45, "#8b939c");
    g.addColorStop(1, "#4d545b");
    ct.strokeStyle = g;
    ct.lineWidth = kalin;
    ct.lineCap = "round";
    ct.beginPath(); ct.moveTo(sol.x, sol.y); ct.lineTo(sag.x, sag.y); ct.stroke();

    // Kızak
    const kw = Math.max(14, 78 * o), kh = Math.max(11, 60 * o);
    ct.fillStyle = "#2f353b";
    yuvarlakKutu(ct, kizak.x - kw / 2, kizak.y - kh / 2, kw, kh, Math.max(2, 6 * o));
    ct.fill();
    const g2 = ct.createLinearGradient(0, kizak.y - kh / 2, 0, kizak.y + kh / 2);
    g2.addColorStop(0, "#dfe5ea");
    g2.addColorStop(1, "#79818a");
    ct.fillStyle = g2;
    yuvarlakKutu(ct, kizak.x - kw / 2 + 2, kizak.y - kh / 2 + 2, kw - 4, kh * 0.55,
                 Math.max(2, 4 * o));
    ct.fill();

    // Aktif baş ve o an yapılan iş.
    const bas = aktifBas();
    const tip = ((S.veri.kuyruk || {}).calisan || {}).tip || "";
    if (bas) {
      const np = basNoktasi(R.hx, R.hy, bas);
      const nuv = mmUV(np.x, np.y);
      const yer = yansit(nuv.u, nuv.v);
      // İnİŞ ÖLÇÜLEN z'DEN. z yoksa uç köprüde duruyor ve inmiyor —
      // inişi canlandırmak, olmayan bir ölçümü çizmek olurdu.
      const yuk = ucYuksekligi();
      const ucY = yuk == null ? yer.y - kopruY
                              : yer.y - yukseklikPx(yuk, nuv.v);
      // Kolon: kızaktan uca.
      ct.strokeStyle = "#9aa2aa";
      ct.lineWidth = Math.max(2, 12 * o);
      ct.beginPath();
      ct.moveTo(kizak.x, kizak.y);
      ct.lineTo(yer.x, ucY);
      ct.stroke();

      if (tip === "sula") suCiz(ct, yer, ucY, o, t);
      else if (tip === "nem") probCiz(ct, yer, ucY, o);
      else if (tip === "ek") tohumCiz(ct, yer, ucY, o, t);

      // Uç işareti
      ct.fillStyle = tip === "sula" ? "#4fb8e8"
                   : tip === "nem" ? "#d9a520"
                   : tip === "ek" ? "#8fd27a" : "#cfd6dd";
      ct.beginPath();
      ct.arc(yer.x, ucY, Math.max(3, 11 * o), 0, Math.PI * 2);
      ct.fill();
    }
  }

  /** SU — sulama İŞİ çalışırken. Röle durumu `olcum` paketinde ve beş
   *  saniyede bir geliyor; üç saniyelik bir sulamayı kaçırırdı.
   *  "Sulama işi çalışıyor" ölçülen bir gerçek ve ekranın dediği bu. */
  function suCiz(ct, yer, ucY, o, t) {
    const boy = yer.y - ucY;
    if (boy <= 2) return;
    for (let i = 0; i < 5; i++) {
      const f = ((t * 1.5 + i * 0.2) % 1);
      const y = ucY + boy * f;
      ct.globalAlpha = 1 - f * 0.7;
      ct.fillStyle = "#4fb8e8";
      ct.beginPath();
      ct.ellipse(yer.x + (i - 2) * 1.6 * o, y, Math.max(1.2, 4 * o),
                 Math.max(2, 8 * o), 0, 0, Math.PI * 2);
      ct.fill();
    }
    ct.globalAlpha = 1;
    // Islanan toprak: sulama sürdükçe büyüyen koyu leke.
    const r = Math.max(6, (26 + Math.sin(t * 3) * 3) * o * 2);
    const g = ct.createRadialGradient(yer.x, yer.y, 1, yer.x, yer.y, r);
    g.addColorStop(0, "rgba(20,40,60,0.55)");
    g.addColorStop(1, "rgba(20,40,60,0)");
    ct.fillStyle = g;
    ct.beginPath();
    ct.ellipse(yer.x, yer.y, r, r * 0.62, 0, 0, Math.PI * 2);
    ct.fill();
  }

  function probCiz(ct, yer, ucY, o) {
    ct.strokeStyle = "#e2e8ee";
    ct.lineWidth = Math.max(1.5, 7 * o);
    ct.lineCap = "round";
    ct.beginPath();
    ct.moveTo(yer.x, ucY);
    ct.lineTo(yer.x, yer.y + Math.max(2, 10 * o));   // toprağın içine
    ct.stroke();
    ct.fillStyle = "rgba(217,165,32,0.30)";
    ct.beginPath();
    ct.ellipse(yer.x, yer.y, Math.max(4, 16 * o), Math.max(2, 9 * o), 0, 0, Math.PI * 2);
    ct.fill();
  }

  function tohumCiz(ct, yer, ucY, o, t) {
    const boy = yer.y - ucY;
    const f = (t * 0.9) % 1;
    ct.fillStyle = "#d9c08a";
    ct.beginPath();
    ct.ellipse(yer.x, ucY + boy * f, Math.max(1.5, 5 * o), Math.max(2, 6 * o),
               0, 0, Math.PI * 2);
    ct.fill();
    // Açılan çukur
    ct.fillStyle = "rgba(0,0,0,0.35)";
    ct.beginPath();
    ct.ellipse(yer.x, yer.y, Math.max(4, 14 * o), Math.max(2, 8 * o), 0, 0, Math.PI * 2);
    ct.fill();
  }

  /** Makinenin künyesi: ne yaptığı, nereye gittiği, hangi başın çalıştığı
   *  ve ölçülen konumu. Kopukken hiç çizilmiyor — kopuk bir makinenin
   *  "ne yaptığı" yok. */
  function makineEtiketi(ct) {
    const R = S.robot;
    if (!R.gecerli) return;
    const v = S.veri || {};
    const kuy = v.kuyruk || {};
    const calisan = kuy.calisan;
    const bas = aktifBas();
    const uv = mmUV(R.hx, R.hy);
    const d = yansit(kis(uv.u, 0, 1), kis(uv.v, 0, 1));
    const yer = ekranNok(d.x, d.y);
    const kopruY = yukseklikPx(KOPRU_MM, uv.v) * S.kam.o;

    const bas1 = calisan ? calisan.etiket : (v.mesgul ? "Hareket ediyor" : "Bekliyor");
    // Hedef nokta ADI değil, TÜRÜ yazılıyor: "marul-3" kullanıcının
    // koyduğu bir ad değil, sunucunun ürettiği bir anahtar.
    const adlar = (calisan && calisan.noktalar) || [];
    const turAd = (ad) => {
      const b = (v.bitkiler || []).find((x) => x.ad === ad);
      return b ? (b.tur_ad || b.tur) : ad;
    };
    const hedef = adlar.length
      ? adlar.slice(0, 2).map(turAd).join(", ")
        + (adlar.length > 2 ? ` +${adlar.length - 2}` : "")
      : "";
    const alt = [
      `X ${R.hx.toFixed(0)} · Y ${R.hy.toFixed(0)} mm`,
      bas ? (bas.ad || bas.kimlik) : "",
      hedef ? `→ ${hedef}` : "",
    ].filter(Boolean).join("  ·  ");

    ct.font = yazTipi(11, true);
    const en = Math.round(Math.max(ct.measureText(bas1).width,
                                   (ct.font = yazTipi(10, false),
                                    ct.measureText(alt).width)) + 18);
    const boy = 30;
    let x = Math.round(yer.x + 16);
    const yy = Math.round(yer.y - kopruY - boy - 14);
    if (x + en > S.en - 6) x = Math.round(yer.x - 16 - en);

    const solPay = boy / 2 * 0.86 + 9;
    baloncuk(ct, x, yy, en + solPay, boy,
             v.mesgul ? { r: 74, g: 144, b: 226 } : { r: 124, g: 128, b: 137 },
             1, { x: yer.x, y: yer.y - kopruY });
    baloncukYazi(ct, x + solPay, yy, boy, bas1, alt, "#b9bab0", 1);
  }

  /* ==================================================================== *
   * Dokunma ve bitki kartı
   *
   * Kartın görsel dili Bitkiler sekmesindeki kartla AYNI: nem halkası
   * (dolgu nem, çentik eşik, solukluk ölçümün yaşı) ve kuruma eğrisi.
   * Aynı ölçüm iki ekranda aynı biçimde okunsun. `bitki.js` bir
   * modül dışa vermiyor ve başka bir oturumun dosyası; oradan kod
   * çağırmak yerine aynı biçim burada yeniden kuruldu, kaynağı bu
   * yorumda yazılı.
   * ==================================================================== */
  const HALKA = { boy: 76, r: 30, kalin: 6 };
  const EGRI = { en: 480, boy: 110, ust: 10, alt: 18, sol: 6, sag: 6 };
  const EGRI_EN_AZ_NOKTA = 3;
  const EGRI_EN_AZ_SURE_SN = 2 * 3600;

  function kacisli(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sureKisa(sn) {
    if (sn == null || !Number.isFinite(Number(sn))) return "";
    const s = Math.max(0, Number(sn));
    if (s < 90) return "az önce";
    if (s < 3600) return `${Math.round(s / 60)} dk önce`;
    if (s < 86400) return `${Math.round(s / 3600)} saat önce`;
    return `${Math.round(s / 86400)} gün önce`;
  }

  function tarihMetni(ts) {
    const d = sayi(ts, 0);
    if (!d) return "";
    try {
      return new Date(d * 1000).toLocaleDateString("tr-TR",
        { day: "numeric", month: "long", year: "numeric" });
    } catch { return ""; }
  }

  /* ------------------------------------------------------- vuruş denemesi */
  /** Ekran pikselinin altındaki bitki. Öndekiler önce sınanıyor:
   *  üst üste binen iki bitkide parmağın seçtiği, gördüğü olmalı. */
  function bitkiBul(ex, ey) {
    for (let i = S.bitki.length - 1; i >= 0; i--) {
      const b = S.bitki[i];
      const rx = Math.max(18, b.cizimPx / 2);
      const ry = rx * 0.72;
      const dx = (ex - b.x) / rx;
      const dy = (ey - (b.y - yukseklikPx(16, b.v))) / ry;
      if (dx * dx + dy * dy <= 1) return b;
    }
    return null;
  }

  /* ----------------------------------------------------------- nem halkası
   *
   * DOLGU nem, ÇENTİK eşik: dolgu çentiğin gerisindeyse bitki susamış
   * demektir ve bu iki sayıyı karşılaştırmadan görünüyor.
   *
   * SOLUKLUK BİR ÖLÇÜT, SÜS DEĞİL: dünkü okuma bugünkü kadar güvenilir
   * değil, halka ölçümün yaşıyla soluyor. Sulamadan ÖNCE alınmış bayat
   * okuma yaşı küçük olsa bile en solukta.
   *
   * KENDİ ÖLÇÜMÜ YOKSA HALKA DOLDURULMUYOR: sunucu komşudan bir okuma
   * ödünç veriyor, onu dolu halka olarak göstermek ölçmediğimiz bir şeyi
   * ölçmüş gibi sunmak olurdu. Kesikli boş iz ve ortada "?" var; ödünç
   * sayı alanlarda parantez içinde duruyor. */
  function solukluk(o) {
    const azami = sayi(o.azami_yas_sn, 86400) || 86400;
    const t = kis(sayi(o.yas_sn, 0) / azami, 0, 1);
    const d = 1 - 0.65 * t;
    return o.bayat ? Math.min(d, 0.4) : d;
  }

  function halkaYaz(b) {
    const o = b.su_olcum || {};
    const { boy, r, kalin } = HALKA;
    const c = boy / 2;
    const cevre = 2 * Math.PI * r;
    const kendiVar = !!(o.var && o.kendi);
    const yuzde = o.var ? kis(sayi(o.yuzde, 0), 0, 100) : null;
    const esik = o.esik_acik ? kis(sayi(o.esik, 0), 0, 100) : null;

    let centik = "";
    if (esik != null) {
      const a = (esik / 100) * 2 * Math.PI - Math.PI / 2;
      const ic = r - kalin / 2 - 2.5, dis = r + kalin / 2 + 2.5;
      centik = `<line x1="${(c + ic * Math.cos(a)).toFixed(2)}"
        y1="${(c + ic * Math.sin(a)).toFixed(2)}"
        x2="${(c + dis * Math.cos(a)).toFixed(2)}"
        y2="${(c + dis * Math.sin(a)).toFixed(2)}" class="bt-centik"/>`;
    }
    const az = esik != null && yuzde != null && yuzde < esik;
    const dolgu = (kendiVar && yuzde != null)
      ? `<circle cx="${c}" cy="${c}" r="${r}" class="bt-yay${az ? " az" : ""}"
           stroke-dasharray="${(cevre * yuzde / 100).toFixed(2)} ${(cevre + 1).toFixed(2)}"
           transform="rotate(-90 ${c} ${c})"
           style="opacity:${solukluk(o).toFixed(2)}"/>`
      : "";
    const ic = kendiVar ? `<b>%${Math.round(yuzde)}</b>`
                        : '<b class="bt-soru">?</b>';
    const baslik = kendiVar
      ? `Toprak nemi %${Math.round(yuzde)}`
        + (esik != null ? `, eşik %${Math.round(esik)}` : ", eşik kapalı")
        + `, ${sureKisa(o.yas_sn)} kendi üstünden ölçüldü`
      : (o.var ? `Kendi ölçümü yok — halka boş. Yandaki bir noktada `
                 + `%${Math.round(sayi(o.yuzde, 0))} okundu.`
               : "Kendi ölçümü yok — halka boş.");

    return `<div class="bt-halka" role="img" aria-label="${kacisli(baslik)}"
                 title="${kacisli(baslik)}">
      <svg viewBox="0 0 ${boy} ${boy}" width="${boy}" height="${boy}" aria-hidden="true">
        <circle cx="${c}" cy="${c}" r="${r}"
                class="bt-iz${kendiVar ? "" : " bt-iz-bos"}"/>
        ${dolgu}${centik}
      </svg>
      <span class="bt-halka-ic">${ic}</span>
    </div>`;
  }

  /* --------------------------------------------------------- kuruma eğrisi
   * Amaç sayı okutmak değil EĞİMİ göstermek: dik iniyorsa toprak hızlı
   * kuruyor. Eşik yatay bir çizgi. Yeterli ölçüm yoksa eğri çizilmiyor
   * ve KAÇ ÖLÇÜM olduğu yazılıyor — boş bir kutu göstermek, sebebi
   * söylememek olurdu. */
  function egriYaz(b, e) {
    const g = ((e && e.gecmis) || []).filter(
      (p) => Number.isFinite(Number(p && p.yuzde)) && Number.isFinite(Number(p && p.ts)));
    const o = b.su_olcum || {};
    const esik = o.esik_acik ? kis(sayi(o.esik, 0), 0, 100) : null;
    if (g.length < EGRI_EN_AZ_NOKTA) {
      return `<p class="bt-egri-yok">Eğilim için yeterli ölçüm yok —
        ${g.length} ölçüm var, en az ${EGRI_EN_AZ_NOKTA} gerekiyor.</p>`;
    }
    const sure = sayi(g[g.length - 1].ts) - sayi(g[0].ts);
    if (sure < EGRI_EN_AZ_SURE_SN) {
      return `<p class="bt-egri-yok">Eğilim için yeterli ölçüm yok —
        ölçümlerin hepsi ${sureKisa(sure).replace(" önce", "")} içinde alınmış.</p>`;
    }
    const { en, boy, ust, alt, sol, sag } = EGRI;
    let dip = Math.min(...g.map((p) => sayi(p.yuzde)));
    let tep = Math.max(...g.map((p) => sayi(p.yuzde)));
    if (esik != null) { dip = Math.min(dip, esik); tep = Math.max(tep, esik); }
    const pay = Math.max(2.5, (tep - dip) * 0.15);
    dip -= pay; tep += pay;
    if (tep - dip < 8) { const m = (dip + tep) / 2; dip = m - 4; tep = m + 4; }
    const t0 = sayi(g[0].ts), t1 = sayi(g[g.length - 1].ts);
    const px = (p) => sol + ((sayi(p.ts) - t0) / Math.max(1, t1 - t0)) * (en - sol - sag);
    const py = (v) => ust + (1 - (sayi(v) - dip) / Math.max(1, tep - dip)) * (boy - ust - alt);
    const yol = g.map((p, i) => `${i ? "L" : "M"}${px(p).toFixed(1)},${py(p.yuzde).toFixed(1)}`).join("");
    const alanYol = `${yol}L${px(g[g.length - 1]).toFixed(1)},${(boy - alt).toFixed(1)}`
      + `L${px(g[0]).toFixed(1)},${(boy - alt).toFixed(1)}Z`;
    const esikYol = esik == null ? ""
      : `<line x1="${sol}" y1="${py(esik).toFixed(1)}" x2="${en - sag}"
               y2="${py(esik).toFixed(1)}" class="bt-egri-esik"/>`;
    const eg = (e && e.egilim) || null;
    const ozet = eg
      ? `%${Math.round(sayi(eg.ilk))} → %${Math.round(sayi(eg.son))}`
      : `${g.length} ölçüm`;
    return `<div class="bt-egri">
      <svg viewBox="0 0 ${en} ${boy}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${alanYol}" class="bt-egri-alan"/>
        <path d="${yol}" class="bt-egri-yol"/>
        ${esikYol}
        <circle cx="${px(g[g.length - 1]).toFixed(1)}"
                cy="${py(g[g.length - 1].yuzde).toFixed(1)}" r="3" class="bt-egri-nokta"/>
      </svg>
      <p class="bt-egri-not">Kuruma eğilimi · ${kacisli(ozet)} · ${g.length} ölçüm</p>
    </div>`;
  }

  function alanYaz(baslik, deger, altYazi, bos) {
    return `<div class="bt-alan${bos ? " bos" : ""}"><i>${kacisli(baslik)}</i>`
      + `<b>${kacisli(deger)}</b>${altYazi ? `<em>${kacisli(altYazi)}</em>` : ""}</div>`;
  }

  /* ------------------------------------------------------------ kart akışı */
  async function ekYukle() {
    // Kartın ek verisi (kuruma geçmişi, çözülmüş sulama süresi) ayrı bir
    // uçtan geliyor; başarısız olursa kart yine açılıyor, yalnız eğri
    // yerine sebebi yazıyor.
    try { S.ek = await api("/api/bitki"); }
    catch { S.ek = null; }
  }

  function kartKapat() {
    const o = $("#bt-ortu");
    S.kartAd = "";
    if (!o) return;
    o.classList.remove("acik");
    setTimeout(() => { if (!S.kartAd) o.hidden = true; }, 200);
  }

  function kartAc(ad) {
    S.kartAd = ad;
    const o = $("#bt-ortu");
    if (!o) return;
    o.hidden = false;
    kartYaz();
    // Bir kare sonra sınıf: geçiş çalışsın diye.
    requestAnimationFrame(() => o.classList.add("acik"));
    if (!S.ek) ekYukle().then(() => { if (S.kartAd === ad) kartYaz(); });
  }

  function kartVeri(ad) {
    return ((S.veri || {}).bitkiler || []).find((x) => x.ad === ad) || null;
  }

  function kartYaz() {
    const kart = $("#bt-kart");
    const b = kartVeri(S.kartAd);
    if (!kart || !b) return;
    const o = b.su_olcum || {};
    const e = ((S.ek && S.ek.ek) || {})[b.ad] || {};
    const simdi = Date.now() / 1000;
    const v = S.veri || {};

    const alanlar = [];
    alanlar.push(alanYaz("Yatak koordinatı",
      `X ${Math.round(sayi(b.x))} · Y ${Math.round(sayi(b.y))} mm`,
      sayi(b.z) ? `Z ${Math.round(sayi(b.z))} mm` : ""));
    if (b.ekim) {
      alanlar.push(alanYaz("Ekildi",
        `${Math.round(sayi(b.yas_gun, (simdi - sayi(b.ekim)) / 86400))} günlük`,
        tarihMetni(b.ekim)));
    } else {
      alanlar.push(alanYaz("Ekildi", "tarih yok", "yaşı bilinmiyor", true));
    }
    const olgun = sayi(b.olgun_gun, 0);
    alanlar.push(olgun
      ? alanYaz("Hasat", b.hasat ? "hazır"
          : `${Math.max(0, Math.round(olgun - sayi(b.yas_gun, 0)))} gün kaldı`,
          `türün olgunluğu ${Math.round(olgun)} gün`)
      : alanYaz("Hasat", "—", "türde olgunluk süresi yazılı değil", true));

    const cap = Math.round(sayi(b.yaricap_mm) * 2);
    alanlar.push(alanYaz("Yayılma çapı", cap ? `${cap} mm` : "—",
      b.cakisik ? "komşusuyla çakışıyor" : "", !cap));

    // ÖDÜNÇ OKUMA PARANTEZ İÇİNDE: sayı görünüyor ama bu bitkinin
    // ölçülmüş nemi gibi durmuyor. Halka onu zaten doldurmuyor.
    if (o.var) {
      const yuzde = `%${Math.round(sayi(o.yuzde))}`;
      alanlar.push(alanYaz("Toprak nemi", o.kendi ? yuzde : `(${yuzde})`,
        (o.kendi ? "kendi üstünden" : `${Math.round(sayi(o.uzak_mm))} mm ötede`)
        + ` · ${sureKisa(o.yas_sn)}`
        + (o.bayat ? " · sulamadan ÖNCE alınmış" : "")));
    } else {
      alanlar.push(alanYaz("Toprak nemi", "ölçülmedi",
        `son ${Math.round(sayi(o.azami_yas_sn, 86400) / 3600)} saatte `
        + `${Math.round(sayi(o.yaricap_mm, 100))} mm yakınında okuma yok`, true));
    }
    alanlar.push(o.esik_acik
      ? alanYaz("Sulama eşiği", `%${Math.round(sayi(o.esik))}`,
                "nem bunun altına düşünce sulanmalı")
      : alanYaz("Sulama eşiği", "kapalı", "eşik %100 — nem kararı verilmiyor", true));

    const sn = e.sulama_saniye != null ? sayi(e.sulama_saniye)
                                       : sayi(b.sulama_saniye, 3);
    alanlar.push(alanYaz("Sulama süresi", `${sn.toFixed(1)} sn`,
      (e.sulama_deseni || b.sulama_deseni || "ust") !== "ust"
        ? `desen: ${e.sulama_deseni || b.sulama_deseni}` : ""));
    alanlar.push(b.sulama_ts
      ? alanYaz("Son sulama", sureKisa(simdi - sayi(b.sulama_ts)),
                `${tarihMetni(b.sulama_ts)} · komut damgası, akış sensörü yok`)
      : alanYaz("Son sulama", "hiç", "ekildiğinden beri sulanmamış", true));
    if (e.sula_adet != null) {
      alanlar.push(alanYaz("Uygulanan işlem",
        `${e.sula_adet} sulama · ${e.nem_adet || 0} ölçüm`,
        e.sula_toplam_sn ? `toplam ${sayi(e.sula_toplam_sn).toFixed(0)} sn su` : ""));
    }

    const bas = (v.baslar || {}).sulama || {};
    kart.innerHTML = `
      <div class="bt-kart-ust">
        ${halkaYaz(b)}
        <div>
          <b>${kacisli(b.tur_ad || b.tur)}</b>
          <small>${kacisli(b.su_gerekce || "")}</small>
        </div>
        <span class="esnek"></span>
        <button class="bt-ikon" data-rol="kapat" type="button">Kapat</button>
      </div>
      <div class="bt-alanlar">${alanlar.join("")}</div>
      ${egriYaz(b, e)}
      <div class="bt-dugmeler">
        <button class="bt-dugme birincil" data-makine="1" data-rol="sula">💧 Sula</button>
        <button class="bt-dugme" data-makine="1" data-rol="nem">🌡️ Nemini ölç</button>
        <button class="bt-dugme" data-makine="1" data-rol="foto">📷 Fotoğrafla</button>
      </div>`;

    kart.querySelector('[data-rol="kapat"]').onclick = kartKapat;
    kart.querySelector('[data-rol="nem"]').onclick = () => isGonder("nem", [b.ad]);
    kart.querySelector('[data-rol="foto"]').onclick = () => isGonder("foto", [b.ad]);
    // SULAMA GERİ ALINAMAZ: önce ne olacağı yazılıyor, sonra soruluyor.
    kart.querySelector('[data-rol="sula"]').onclick = () => onayIste({
      baslik: `${b.tur_ad || b.tur} sulanacak`,
      ne: `Makine sulama başlığıyla `
        + `${(sayi(b.x) + sayi(bas.dx)).toFixed(0)} / `
        + `${(sayi(b.y) + sayi(bas.dy)).toFixed(0)} mm noktasına gidecek ve `
        + `pompayı ${sn.toFixed(1)} saniye açacak. Dökülen su geri alınamaz.`
        + (o.var ? "" : " Bu bitkinin nemi ölçülmedi, yani ne kadar "
                        + "gerektiği bilinmiyor."),
      tamam: "Onaylıyorum, sula",
      tikla: () => isGonder("sula", [b.ad], { saniye: sn }),
    });
    durumYaz();          // kopukken düğmeler kilitli kalsın
  }

  /** Onay adımı kartın İÇİNDE açılıyor: kullanıcı neyin üstünde
   *  olduğunu görmeden onaylamasın. */
  function onayIste(secenek) {
    const kart = $("#bt-kart");
    if (!kart) return;
    const geriAd = S.kartAd;
    kart.innerHTML = `
      <div class="bt-kart-ust">
        <div><b>${kacisli(secenek.baslik)}</b><small>onay gerekiyor</small></div>
      </div>
      <div class="bt-onay"><b>Ne olacak</b><p>${kacisli(secenek.ne)}</p></div>
      <div class="bt-dugmeler">
        <button class="bt-dugme birincil" data-makine="1" data-rol="tamam">
          ${kacisli(secenek.tamam)}</button>
        <button class="bt-dugme" data-rol="vazgec">Vazgeç</button>
      </div>`;
    kart.querySelector('[data-rol="vazgec"]').onclick = () => {
      if (geriAd) { S.kartAd = geriAd; kartYaz(); } else kartKapat();
    };
    kart.querySelector('[data-rol="tamam"]').onclick = async () => {
      kartKapat();
      await secenek.tikla();
    };
    durumYaz();
  }

  /* İŞLER KUYRUĞA GİRİYOR, SORU SORULMUYOR. Makine tek dizi
     çalıştırabiliyor; iki bitkiye arka arkaya dokunan birine "makine
     meşgul" demek, kullanıcıyı makinenin takvimine uydurmak olurdu. */
  async function isGonder(tip, adlar, ek) {
    kartKapat();
    try {
      const y = await gonder("/api/bahce/is",
                             Object.assign({ tip, noktalar: adlar }, ek || {}));
      kuyrukDegisti(y.kuyruk);
      gunluk(`✓ ${({ sula: "Sulama", nem: "Nem ölçümü", foto: "Fotoğraf",
                     ek: "Ekim" })[tip] || tip} sıraya girdi`, "ok");
      return true;
    } catch (hata) {
      gunluk(`✕ ${hata.message}`, "hata");
      notYaz("is", `İş sıraya konamadı: ${hata.message}`);
      setTimeout(() => notYaz("is", ""), 8000);
      return false;
    }
  }

  function gonder(yol, govde) {
    return api(yol, { method: "POST", body: JSON.stringify(govde) });
  }

  /* ==================================================================== *
   * Tohum rafı, ekim gözleri ve sürükle-bırak
   *
   * GÖZ UYDURULMUYOR. `/api/bahce/bos-yer` seçilen TÜRÜN yayılım çapına
   * göre gerçekten ekilebilir noktaları veriyor: dikim alanının içinde,
   * yumuşak sınırların içinde ve hiçbir bitkinin yayılım çemberine
   * girmeyen. Marulun gözü rokanınkinden az, çünkü marul geniş.
   *
   * BIRAKMADAN ÖNCE CEVAP. Parmak toprakta gezerken geçerlilik ANINDA
   * hesaplanıyor — sunucudaki `bos_yerler` ile aynı üç ölçüt, aynı
   * yerde. Sunucuya sormak her hareket için bir istek demekti ve cevap
   * geldiğinde parmak çoktan başka yerdeydi. Karar yine sunucuda
   * veriliyor (`/api/bahce/ek` → `dikim.nokta_kabul`); buradaki hesap
   * yalnız ÖNCEDEN göstermek için, ve iki taraf ayrışırsa sunucu
   * reddediyor — yani yanılma yönü güvenli.
   * ==================================================================== */

  function rafYaz() {
    const raf = $("#bt-raf");
    if (!raf) return;
    const v = S.veri || {};
    const turler = v.turler || [];
    const hazne = new Set(v.hazne_turleri || []);
    const imza = turler.map((t) => t.slug).join(",") + "|" + [...hazne].join(",");
    if (raf.dataset.imza === imza) return;
    raf.dataset.imza = imza;
    // Bahçede zaten olan türler önde: en çok kullanılan tohum en yakında.
    const bahcede = new Set((v.bitkiler || []).map((b) => b.tur));
    const sirali = [...turler].sort((a, b) =>
      (bahcede.has(b.slug) ? 1 : 0) - (bahcede.has(a.slug) ? 1 : 0));
    raf.innerHTML = sirali.map((t) => {
      // ÇAPIN KAYNAĞI YAZIYOR. Katalogda marul 250 mm; makinede bütün
      // türler aynı küçük çapla görünüyorsa sebep bir tür EZMESİ ve
      // kullanıcı bunu ancak yazarsak görebilir. Ezme varsa katalog
      // değeri de yazıyor ve yanında geri alma düğmesi duruyor.
      const cap = Math.round(sayi(t.yayilim_mm));
      const kat = t.yayilim_katalog == null ? null : Math.round(sayi(t.yayilim_katalog));
      const ezili = !!t.yayilim_ezili && kat != null && kat !== cap;
      const alt = !hazne.has(t.slug)
        ? '<span class="haznesiz">haznede tohumu yok</span>'
        : (ezili
            ? `<span class="ezili">olgun çapı ${cap} mm — elle konmuş`
              + ` (katalog ${kat} mm)</span>`
            : `olgun çapı ${cap} mm`);
      return `
      <button class="bt-tohum" type="button" data-tur="${kacisli(t.slug)}"
              data-makine="1" aria-pressed="false"
              aria-label="${kacisli(t.ad)} — toprağa sürükleyin ya da dokunup bir göz seçin">
        <span class="im">${kacisli(t.simge || "🌱")}</span>
        <span>${kacisli(t.ad)}<small>${alt}</small></span>
        ${ezili ? `<i class="bt-geri" role="button" tabindex="0"
             data-geri="${kacisli(t.slug)}"
             title="Çapı katalogdaki ${kat} mm değerine döndür">↺</i>` : ""}
      </button>`;
    }).join("");
    raf.querySelectorAll("[data-geri]").forEach((d) => {
      d.addEventListener("pointerdown", (o) => o.stopPropagation());
      d.addEventListener("click", async (o) => {
        o.preventDefault();
        o.stopPropagation();
        try {
          await api(`/api/turler?slug=${encodeURIComponent(d.dataset.geri)}`
                    + "&alan=spread_mm", { method: "DELETE" });
          gunluk("✓ Çap katalog değerine döndü", "ok");
          raf.dataset.imza = "";
          await yukle();
          if (S.secilenTur) tohumSec(S.secilenTur);
        } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
      });
    });
    raf.querySelectorAll(".bt-tohum").forEach((d) => {
      d.addEventListener("pointerdown", surukleBasla);
      d.addEventListener("click", (o) => {
        if (o.target.closest("[data-geri]")) return;
        // Sürükleme olduysa tıklamayı yutuyoruz: parmağını kaldırınca
        // tohum hem bırakılıp hem seçilmiş olmasın.
        if (S.suruklendi) { S.suruklendi = false; return; }
        o.preventDefault();
        tohumSec(d.dataset.tur === S.secilenTur ? "" : d.dataset.tur);
      });
    });
    durumYaz();
  }

  function turBul(slug) {
    return ((S.veri || {}).turler || []).find((t) => t.slug === slug) || null;
  }

  /** Bir türü "eline almak": o türün ekim gözleri yatakta yanıyor. */
  async function tohumSec(slug) {
    S.secilenTur = slug || "";
    S.onizleme = null;
    document.querySelectorAll("#bt-raf .bt-tohum").forEach((d) => {
      d.setAttribute("aria-pressed", d.dataset.tur === S.secilenTur ? "true" : "false");
    });
    if (!S.secilenTur) { S.gozler = null; notYaz("goz", ""); surdur(); return; }
    try {
      const y = await api(`/api/bahce/bos-yer?tur=${encodeURIComponent(slug)}&azami=96`);
      if (S.secilenTur !== slug) return;      // kullanıcı arada fikir değiştirdi
      S.gozler = y;
      S.gozT0 = (performance.now() - S.t0) / 1000;
      notYaz("goz", y.adet ? "" :
        `${y.ad} için boş yer kalmamış — mevcut bitkilerin yayılım `
        + "çemberleri yatağı doldurmuş.");
    } catch (hata) {
      S.gozler = null;
      // Sessiz başarısızlık yok: göz çizilmiyorsa sebebi yazıyor.
      notYaz("goz", `Ekim gözleri hesaplanamadı: ${hata.message}`);
    }
    surdur();
  }

  /* ------------------------------------------------------- geçerlilik */
  /** Bu noktaya bu yayılımdaki bir bitki sığar mı?
   *  Ölçütler `bahce.bos_yerler` ile aynı ve aynı sırada. */
  function yerGecerli(x, y, yayilim) {
    const v = S.veri || {};
    const r = Math.max(0, sayi(yayilim) / 2);
    const alanlar = v.alanlar || [];
    if (!alanlar.length) {
      return { ok: false, sebep: "Dikim alanı tanımlı değil — toprağın nerede "
                                + "olduğu bilinmiyor." };
    }
    const icinde = alanlar.some((a) =>
      x >= Math.min(sayi(a.x1), sayi(a.x2)) && x <= Math.max(sayi(a.x1), sayi(a.x2))
      && y >= Math.min(sayi(a.y1), sayi(a.y2)) && y <= Math.max(sayi(a.y1), sayi(a.y2)));
    if (!icinde) return { ok: false, sebep: "Burada toprak yok — dikim alanının dışı." };

    const s = (v.sinirlar || {});
    const sx = s.x || {}, sy = s.y || {};
    if ((sx.min != null && x < sayi(sx.min)) || (sx.max != null && x > sayi(sx.max))
        || (sy.min != null && y < sayi(sy.min)) || (sy.max != null && y > sayi(sy.max))) {
      return { ok: false, sebep: "Makinenin yumuşak sınırlarının dışı." };
    }
    let en = null, enPay = Infinity;
    (v.bitkiler || []).forEach((b) => {
      const d = Math.hypot(x - sayi(b.x), y - sayi(b.y));
      const gerek = (r + sayi(b.yaricap_mm)) * 0.98;
      const pay = d - gerek;
      if (pay < enPay) { enPay = pay; en = b; }
    });
    if (en && enPay < 0) {
      return { ok: false, cakisan: en,
               sebep: `${en.tur_ad || en.tur} çok yakın — çemberleri `
                      + `${Math.round(-enPay)} mm çakışıyor.` };
    }
    return { ok: true, cakisan: null, sebep: "" };
  }

  /* --------------------------------------------------------- çizim */
  /** Ekim gözleri. Elde tohum varken yatağın GERİ KALANI karartılıyor:
   *  sığmayan yer sönük kalsın, sığan yer kendiliğinden öne çıksın. */
  /** Yumuşama eğrileri.
   *
   * Doğrusal geçiş cansız görünüyor: bir şey ne hızlanıyor ne de
   * yavaşlıyor, sabit hızla kayıyor. `yumusak` çıkışta yavaşlıyor;
   * `asma` sonunda hedefi bir parça geçip geri oturuyor — bırakılan bir
   * şeyin yerine oturma hissi buradan geliyor. */
  function yumusak(t) { return 1 - Math.pow(1 - kis(t, 0, 1), 3); }
  function asma(t) {
    const x = kis(t, 0, 1) - 1;
    return 1 + x * x * (2.70158 * x + 1.70158);
  }

  function gozleriCiz(ct, t) {
    const g = S.gozler;
    if (!g || !g.yerler || !g.yerler.length) return;
    const q = [yansit(0, 0), yansit(1, 0), yansit(1, 1), yansit(0, 1)];
    const cap = Math.max(16, sayi(g.yayilim_mm));
    const nabiz = 0.5 + 0.5 * Math.sin(t * 2.2);
    // Beliriş: gözler sırayla, hedefi bir parça aşıp yerine oturarak
    // geliyor. Hepsinin aynı anda belirmesi bir liste gibi duruyordu.
    const yas = t - (S.gozT0 || t);

    // Karartma: yatak eksi gözler (even-odd).
    ct.save();
    ct.beginPath();
    q.forEach((p, i) => (i ? ct.lineTo(p.x, p.y) : ct.moveTo(p.x, p.y)));
    ct.closePath();
    g.yerler.forEach((yer) => {
      const uv = mmUV(yer.x, yer.y);
      const p = yansit(uv.u, uv.v);
      const r = (cap / 2) * mmPx(uv.v);
      ct.moveTo(p.x + r, p.y);
      ct.ellipse(p.x, p.y, r, r * 0.66, 0, 0, Math.PI * 2, true);
    });
    ct.fillStyle = "rgba(6,8,5,0.45)";
    ct.fill("evenodd");
    ct.restore();

    // Gözün kendisi: toprakta hafif bir çukur, nefes alan bir halka ve
    // parmağın altındakinde belirginleşen bir ışık.
    const secili = S.onizleme && S.onizleme.goz ? S.onizleme : null;
    g.yerler.forEach((yer, i) => {
      const uv = mmUV(yer.x, yer.y);
      const p = yansit(uv.u, uv.v);
      const gel = yumusakGel(yas, i);
      if (gel <= 0) return;
      // NEFES: her göz kendi fazında, çok hafif. Hepsi aynı anda
      // büyüyüp küçülseydi yatak yanıp sönerdi.
      const nefes = 1 + 0.035 * Math.sin(t * 1.5 + i * 0.7);
      const yakin = secili && Math.abs(secili.x - yer.x) < 0.5
                    && Math.abs(secili.y - yer.y) < 0.5;
      const r = (cap / 2) * mmPx(uv.v) * gel * nefes * (yakin ? 1.06 : 1);
      const ic = ct.createRadialGradient(p.x, p.y - r * 0.1, r * 0.05, p.x, p.y, r);
      ic.addColorStop(0, `rgba(0,0,0,${yakin ? 0.16 : 0.30})`);
      ic.addColorStop(0.75, "rgba(0,0,0,0.05)");
      ic.addColorStop(1, `rgba(255,240,200,${yakin ? 0.26 : 0.10})`);
      ct.fillStyle = ic;
      ct.beginPath();
      ct.ellipse(p.x, p.y, r, r * 0.66, 0, 0, Math.PI * 2);
      ct.fill();
      if (yakin) {
        const h = ct.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r * 1.5);
        h.addColorStop(0, "rgba(170,240,150,0.22)");
        h.addColorStop(1, "rgba(170,240,150,0)");
        ct.fillStyle = h;
        ct.beginPath();
        ct.ellipse(p.x, p.y, r * 1.5, r * 1.0, 0, 0, Math.PI * 2);
        ct.fill();
      }
      const parlak = (yakin ? 0.70 : 0.24) + nabiz * (yakin ? 0.25 : 0.26);
      ct.strokeStyle = `rgba(150,220,130,${parlak.toFixed(3)})`;
      ct.lineWidth = yakin ? 2.4 : 1.6;
      ct.setLineDash([6, 6]);
      ct.lineDashOffset = -t * 14 + i;
      ct.beginPath();
      ct.ellipse(p.x, p.y, r, r * 0.66, 0, 0, Math.PI * 2);
      ct.stroke();
      ct.setLineDash([]);
    });
  }

  /** Sıralı beliriş: her göz kendi sırasında, aşıp oturarak. */
  function yumusakGel(yas, i) {
    const gecikme = i * 0.022;
    const sure = 0.34;
    if (yas < gecikme) return 0;
    return asma(kis((yas - gecikme) / sure, 0, 1));
  }

  /** Hayalet önizleme: bırakılırsa ne olacağı.
   *  Bitki yarı saydam ve OLGUN çapında; çember o türün yayılımı. */
  function onizlemeCiz(ct, t) {
    const o = S.onizleme;
    if (!o) return;
    const tur = turBul(S.secilenTur);
    if (!tur) return;
    const uv = mmUV(o.x, o.y);
    const p = yansit(uv.u, uv.v);
    const olcek = mmPx(uv.v);
    const r = Math.max(14, (sayi(tur.yayilim_mm) / 2) * olcek);

    // Çakışan komşu varsa ONUN çemberi de yanıyor: neyin engellediği
    // yazıyla değil, görünerek anlaşılsın.
    if (o.cakisan) {
      const cuv = mmUV(o.cakisan.x, o.cakisan.y);
      const cp = yansit(cuv.u, cuv.v);
      const cr = sayi(o.cakisan.yaricap_mm) * mmPx(cuv.v);
      ct.strokeStyle = "rgba(224,82,82,0.75)";
      ct.lineWidth = 2;
      ct.beginPath();
      ct.ellipse(cp.x, cp.y, cr, cr * 0.66, 0, 0, Math.PI * 2);
      ct.stroke();
      ct.setLineDash([4, 4]);
      ct.beginPath();
      ct.moveTo(cp.x, cp.y);
      ct.lineTo(p.x, p.y);
      ct.stroke();
      ct.setLineDash([]);
    }

    ct.save();
    ct.globalAlpha = 0.85;
    ct.strokeStyle = o.ok ? "rgba(150,220,130,0.95)" : "rgba(224,82,82,0.95)";
    ct.fillStyle = o.ok ? "rgba(150,220,130,0.12)" : "rgba(224,82,82,0.12)";
    ct.lineWidth = 2;
    ct.beginPath();
    ct.ellipse(p.x, p.y, r, r * 0.66, 0, 0, Math.PI * 2);
    ct.fill();
    ct.stroke();

    ct.globalAlpha = o.ok ? 0.62 : 0.35;
    ct.translate(p.x, p.y - yukseklikPx(16, uv.v));
    // Hayalet de TÜRÜN KENDİ SİLUETİ: bırakılacak şeyin ne olduğu
    // önizlemede de görünsün, hepsi gülçe olmasın.
    const sahte = { tur: tur.slug, tur_ad: tur.ad };
    const tip = arketip(sahte);
    const s = SILUET[tip] || SILUET.gulce;
    const boy = r * 0.92 * s.boyOran * YUKSEKLIK_ORANI * 1.4;
    const c = yesil(sahte);
    const faz = tohum(tur.slug);
    const ak = hexRGB(tur.renk || "#7bbf5a");
    if (s.kok) kokCiz(ct, r * 0.92, ak);
    if (tip === "tuy") cizTuy(ct, r * 0.92, c, null, t, faz, boy);
    else if (tip === "yuvarlak") cizYuvarlak(ct, r * 0.92, c, null, t, faz, boy);
    else if (tip === "cali") cizCali(ct, r * 0.92, c, null, t, faz, false, ak, boy);
    else if (tip === "serit") cizSerit(ct, r * 0.92, c, null, t, faz, boy);
    else if (tip === "uclu") cizUclu(ct, r * 0.92, c, null, t, faz, false, ak);
    else cizGulce(ct, r * 0.92, c, null, t, faz, { genislik: 0.24, dalga: true });
    ct.restore();

  }

  /** Önizlemenin künyesi — KAMERASIZ uzayda, sahnenin ölçeğinden
   *  bağımsız okunsun diye. */
  function onizlemeEtiketi(ct) {
    const o = S.onizleme;
    if (!o) return;
    const tur = turBul(S.secilenTur);
    if (!tur) return;
    const uv = mmUV(o.x, o.y);
    const d = yansit(uv.u, uv.v);
    const p = ekranNok(d.x, d.y);
    const r = Math.max(14, (sayi(tur.yayilim_mm) / 2) * mmPx(uv.v)) * S.kam.o;
    const bas1 = `${tur.ad} · ${Math.round(o.x)} / ${Math.round(o.y)} mm`;
    const alt = o.ok ? `olgun çapı ${Math.round(sayi(tur.yayilim_mm))} mm · bırakınca sorulacak`
                     : o.sebep;
    ct.font = yazTipi(11, true);
    const en1 = ct.measureText(bas1).width;
    ct.font = yazTipi(10, false);
    const en = Math.round(Math.max(en1, ct.measureText(alt).width) + 18);
    let x = Math.round(p.x + r * 0.7 + 10);
    const yy = Math.round(p.y - r * 0.66 - 46);
    if (x + en > S.en - 6) x = Math.round(p.x - r * 0.7 - 10 - en);
    const solPay = 30 / 2 * 0.86 + 9;
    baloncuk(ct, x, yy, en + solPay, 30,
             o.ok ? { r: 123, g: 191, b: 90 } : { r: 224, g: 82, b: 82 },
             1, { x: p.x, y: p.y - 6 });
    baloncukYazi(ct, x + solPay, yy, 30, bas1, alt,
                 o.ok ? "#b9bab0" : "#e8a0a0", 1);
  }

  /* ------------------------------------------------------- sürükleme */
  /** Ekrandaki noktadan yatak milimetresine; gözlere yakınsa GÖZE
   *  oturuyor — parmak birkaç milimetre şaşabilir, göz şaşmaz. */
  function birakmaYeri(ex, ey) {
    const w = dunya(ex, ey);
    const uv = ekranUV(w.x, w.y);
    if (!uv) return null;
    const ham = uvMM(uv.u, uv.v);
    const g = S.gozler;
    if (g && g.yerler) {
      const cek = Math.max(25, sayi(g.yayilim_mm) / 2);
      let en = null, enD = Infinity;
      g.yerler.forEach((yer) => {
        const d = Math.hypot(yer.x - ham.x, yer.y - ham.y);
        if (d < enD) { enD = d; en = yer; }
      });
      if (en && enD <= cek) return { x: en.x, y: en.y, goz: true };
    }
    return { x: Math.round(ham.x * 10) / 10, y: Math.round(ham.y * 10) / 10, goz: false };
  }

  function onizlemeTazele(ex, ey) {
    const tur = turBul(S.secilenTur);
    if (!tur) { S.onizleme = null; return; }
    const yer = birakmaYeri(ex, ey);
    if (!yer) { S.onizleme = null; return; }
    const d = yerGecerli(yer.x, yer.y, sayi(tur.yayilim_mm));
    S.onizleme = { x: yer.x, y: yer.y, goz: yer.goz, ok: d.ok,
                   sebep: d.sebep, cakisan: d.cakisan };
    surdur();
  }

  function surukleBasla(o) {
    const t = o.target.closest(".bt-tohum");
    if (!t || t.disabled) return;
    const tur = turBul(t.dataset.tur);
    if (!tur) return;
    S.surukle = { tur, el: t, tasindi: false, x: o.clientX, y: o.clientY };
    S.suruklendi = false;
    if (S.secilenTur !== tur.slug) tohumSec(tur.slug);
  }

  function surukleTasi(o) {
    const s = S.surukle;
    if (!s) return;
    if (!s.tasindi && Math.hypot(o.clientX - s.x, o.clientY - s.y) < 6) return;
    if (!s.tasindi) { s.tasindi = true; s.el.classList.add("tutuluyor"); }
    o.preventDefault();
    const tv = S.tuval;
    const r = tv.getBoundingClientRect();
    const ic = o.clientX >= r.left && o.clientX <= r.right
      && o.clientY >= r.top && o.clientY <= r.bottom;
    const h = $("#bt-hayalet");
    if (h) {
      // Parmak tuvalin dışındayken hayalet parmağın altında; içine
      // girince sahnedeki önizleme devralıyor.
      h.hidden = ic;
      h.textContent = s.tur.simge || "🌱";
      h.style.left = `${o.clientX}px`;
      h.style.top = `${o.clientY}px`;
    }
    if (ic) onizlemeTazele(o.clientX - r.left, o.clientY - r.top);
    else { S.onizleme = null; surdur(); }
  }

  function surukleBirak(o) {
    const s = S.surukle;
    if (!s) return;
    S.surukle = null;
    const h = $("#bt-hayalet");
    if (h) h.hidden = true;
    s.el.classList.remove("tutuluyor");
    if (!s.tasindi) return;            // dokunuş sayılır, sürükleme değil
    S.suruklendi = true;
    const tv = S.tuval;
    const r = tv.getBoundingClientRect();
    const ic = o.clientX >= r.left && o.clientX <= r.right
      && o.clientY >= r.top && o.clientY <= r.bottom;
    const on = S.onizleme;
    S.onizleme = null;
    surdur();
    if (!ic || !on) return;
    if (!on.ok) {
      notYaz("birak", `Buraya ekilemez — ${on.sebep}`);
      setTimeout(() => notYaz("birak", ""), 6000);
      return;
    }
    ekOnayi(s.tur, on);
  }

  /** EKİM ONAYI. Ne olacağı önce yazılıyor, sonra soruluyor: hangi tür,
   *  hangi koordinat, hangi göz, makine nereye gidecek. */
  function ekOnayi(tur, yer) {
    const v = S.veri || {};
    const bas = (v.baslar || {}).tohum || {};
    const mx = sayi(yer.x) + sayi(bas.dx), my = sayi(yer.y) + sayi(bas.dy);
    const goz = (v.hazne_gozleri || []).find(
      (g) => g.dolu && String(g.tohum || "") === tur.slug);
    const ortu = $("#bt-ortu");
    if (ortu) ortu.hidden = false;
    S.kartAd = "";
    requestAnimationFrame(() => ortu && ortu.classList.add("acik"));
    onayIste({
      baslik: `${tur.ad} ekilecek`,
      ne: `Tohum ${Math.round(sayi(yer.x))} / ${Math.round(sayi(yer.y))} mm `
        + `noktasına düşecek; makine tohum ucuyla ${mx.toFixed(0)} / `
        + `${my.toFixed(0)} mm noktasına gidiyor (başın kayması eklenmiş). `
        + (goz ? `Tohum "${goz.ad}" gözünden alınacak. `
               : "Bu türe ayrılmış DOLU bir göz görünmüyor; makine ekimi "
                 + "reddedebilir. ")
        + `Olgun çapı ${Math.round(sayi(tur.yayilim_mm))} mm. `
        + "Nokta hemen yaratılıyor, ekim sıraya giriyor. Ekim geri alınamaz.",
      tamam: "Ek",
      tikla: async () => {
        try {
          const y = await gonder("/api/bahce/ek",
                                 { tur: tur.slug, x: yer.x, y: yer.y });
          // Toprakta kısa bir toz bulutu: onayın karşılığı hemen
          // görünüyor, makinenin oraya varmasını beklemeden.
          const puv = mmUV(yer.x, yer.y);
          const pp = yansit(puv.u, puv.v);
          tozAt(pp.x, pp.y, Math.max(0.6, mmPx(puv.v) * 12));
          kuyrukDegisti(y.kuyruk);
          gunluk(`✓ ${tur.ad} sıraya girdi`, "ok");
          tohumSec("");
          await yukle();
        } catch (hata) {
          gunluk(`✕ ${hata.message}`, "hata");
          notYaz("ek", `Ekilemedi: ${hata.message}`);
          setTimeout(() => notYaz("ek", ""), 10000);
        }
      },
    });
  }

  /* GEÇEN BULUT — arada geçen küçük bir detay.
   *
   * Yatağın üstünden çok yavaş, çok soluk bir gölge geçiyor. Amaç
   * dikkat çekmek değil, ekranın nefes alması: sabit bir resme
   * bakıldığında göz birkaç saniyede sahneyi ölü sayıyor. Hiçbir
   * ölçüme karşılık gelmiyor ve gündüzden başka bir şeye bağlı değil —
   * gece görünmüyor, çünkü gece bulut gölgesi olmaz.
   */
  function bulutCiz(ct, t) {
    const I = isik();
    if (I.gunduz < 0.15) return;
    const donem = 44;                       // saniye
    const f = ((t % donem) / donem);
    const x = -S.en * 0.5 + f * S.en * 2;
    const g = ct.createRadialGradient(x, S.boy * 0.35, 10,
                                      x, S.boy * 0.35, S.en * 0.42);
    const a2 = 0.055 * I.gunduz;
    g.addColorStop(0, `rgba(0,0,0,${a2.toFixed(3)})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ct.fillStyle = g;
    ct.fillRect(0, 0, S.en, S.boy);
  }

  /* ==================================================================== *
   * Kamera
   *
   * Yatak ekranın kahramanı ama uzaktan bakınca bitkiler nokta kalıyor.
   * Varsayılan biraz yakın; tekerlek parmağın altındaki noktayı sabit
   * tutarak yakınlaştırıyor, boş toprağı sürüklemek geziniyor, bir
   * bitkiye çift dokunmak ona yumuşak bir geçişle yaklaşıyor.
   *
   * HEDEF VE ŞİMDİ AYRI. Kamera hedefe üstel yaklaşıyor (140 ms) —
   * doğrusal geçiş cansız görünüyor, ani geçiş yerini kaybettiriyor.
   * ==================================================================== */
  const KAM_EN_AZ = 0.8, KAM_EN_COK = 4;

  function kamYurut(dt) {
    const k = S.kam;
    const c = 1 - Math.exp(-dt / 0.14);
    k.o += (k.ho - k.o) * c;
    k.x += (k.hx - k.x) * c;
    k.y += (k.hy - k.y) * c;
    if (Math.abs(k.o - k.ho) < 0.0005) k.o = k.ho;
    if (Math.abs(k.x - k.hx) < 0.2) k.x = k.hx;
    if (Math.abs(k.y - k.hy) < 0.2) k.y = k.hy;
  }

  /** Kameranın durduğu yer sınırlanıyor: yatak ekrandan tamamen
   *  kaçamasın. Yarısı dışarı çıkabilir, fazlası kaybolmak demek. */
  function kamSinirla() {
    const k = S.kam;
    const pay = 0.5;
    const enCok = { x: S.en * (k.ho - 1) / 2 + S.en * pay,
                    y: S.boy * (k.ho - 1) / 2 + S.boy * pay };
    k.hx = kis(k.hx, -enCok.x, enCok.x);
    k.hy = kis(k.hy, -enCok.y, enCok.y);
  }

  /** Ekran pikselinden DÜNYA (izdüşüm) pikseline. */
  function dunya(ex, ey) {
    const k = S.kam;
    return { x: (ex - k.x) / k.o, y: (ey - k.y) / k.o };
  }

  /** Dünya pikselinden ekran pikseline — etiketler bu uzayda çiziliyor
   *  ki yakınlaşınca yazı da büyümesin. */
  function ekranNok(wx, wy) {
    const k = S.kam;
    return { x: wx * k.o + k.x, y: wy * k.o + k.y };
  }

  /** Bir dünya noktasını ekranın istenen yerine getirir. */
  function kamOdak(wx, wy, oran, ekranX, ekranY) {
    const k = S.kam;
    k.ho = kis(oran, KAM_EN_AZ, KAM_EN_COK);
    k.hx = (ekranX == null ? S.en / 2 : ekranX) - wx * k.ho;
    k.hy = (ekranY == null ? S.boy / 2 : ekranY) - wy * k.ho;
    kamSinirla();
    surdur();
  }

  /** Parmağın altındaki noktayı sabit tutarak yakınlaştırır. */
  function kamZum(oran, ekranX, ekranY) {
    const w = dunya(ekranX, ekranY);
    kamOdak(w.x, w.y, oran, ekranX, ekranY);
  }

  /* ==================================================================== *
   * Kutlama
   *
   * İŞİN BİTTİĞİ HABERİ KUYRUKTAN GELİYOR, tahminden değil: sunucu işi
   * "bitti" diye kapattığında o işin noktalarında birkaç zerre
   * yükseliyor. Renk işin tipinden — su mavi, ölçüm sarı, ekim yeşil.
   *
   * Ne kadar sürdüğü ya da ne kadar su gittiği burada YAZMIYOR; bunlar
   * kartın işi. Kutlama bir bilgi taşımıyor, "oldu" diyor.
   * ==================================================================== */
  const KUTLAMA_RENK = { sula: "#4fb8e8", nem: "#d9a520", ek: "#8fd27a",
                         foto: "#cfd6dd", gez: "#cfd6dd" };

  function kutlamaAt(tip, adlar) {
    if (S.sakin) return;                 // sakin mod: hiç hareket yok
    const renk = KUTLAMA_RENK[tip] || "#cfd6dd";
    const t = (performance.now() - S.t0) / 1000;
    (adlar || []).forEach((ad) => {
      const b = S.bitki.find((x) => x.ad === ad);
      if (!b) return;
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const h = 0.4 + Math.random() * 0.9;
        S.kutlama.push({
          x: b.x + Math.cos(a) * b.cizimPx * 0.25,
          y: b.y - Math.random() * b.cizimPx * 0.2,
          vx: Math.cos(a) * 14 * h,
          vy: -(34 + Math.random() * 42),
          t0: t, sure: 0.9 + Math.random() * 0.5, renk,
          r: 1.6 + Math.random() * 2.2,
        });
      }
    });
    surdur();
  }

  /** TOZ BULUTU — ekim onaylandığında, tohumun düşeceği noktada.
   *  Yerden yana yayılıp sönüyor; yukarı çıkan zerrelerden farklı bir
   *  hareket, çünkü anlattığı şey farklı: bu "toprak kazıldı". */
  function tozAt(x, y, olcek) {
    if (S.sakin) return;
    const t = (performance.now() - S.t0) / 1000;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = 0.4 + Math.random() * 0.8;
      S.kutlama.push({
        tip: "toz", x, y,
        vx: Math.cos(a) * 26 * h * olcek,
        vy: Math.sin(a) * 11 * h * olcek - 6 * olcek,
        t0: t, sure: 0.55 + Math.random() * 0.4,
        renk: "#8a6a4a", r: (2.5 + Math.random() * 4) * olcek,
      });
    }
    surdur();
  }

  function kutlamaCiz(ct, t) {
    if (!S.kutlama.length) return;
    S.kutlama = S.kutlama.filter((p) => t - p.t0 < p.sure);
    S.kutlama.forEach((p) => {
      const g = t - p.t0;
      const o = g / p.sure;                      // 0..1
      // Sönüş çıkışta yavaşlıyor: zerre birden kaybolmuyor.
      const sol = 1 - yumusak(o);
      if (p.tip === "toz") {
        const x = p.x + p.vx * yumusak(o) ;
        const y = p.y + p.vy * yumusak(o);
        ct.globalAlpha = sol * 0.55;
        ct.fillStyle = p.renk;
        ct.beginPath();
        ct.ellipse(x, y, p.r * (1 + o * 1.5), p.r * (1 + o * 1.2) * 0.6,
                   0, 0, Math.PI * 2);
        ct.fill();
        return;
      }
      const x = p.x + p.vx * g;
      const y = p.y + p.vy * g + 26 * g * g;
      ct.globalAlpha = sol * 0.9;
      ct.fillStyle = p.renk;
      ct.beginPath();
      ct.arc(x, y, p.r * (1 - o * 0.4), 0, Math.PI * 2);
      ct.fill();
    });
    ct.globalAlpha = 1;
  }

  /* ==================================================================== *
   * Veriden çizime
   * ==================================================================== */
  function bitkileriHazirla() {
    const liste = (S.veri && S.veri.bitkiler) || [];
    // YENİ GELEN BİTKİ BELİRİYOR. Ekim onaylandıktan sonra nokta hemen
    // yaratılıyor; ekranda birdenbire var olması "oldu mu olmadı mı"
    // sorusunu bırakıyordu. Beliriş aşıp oturan bir eğriyle.
    const simdi = (performance.now() - S.t0) / 1000;
    const eski = S.gorulen || null;
    const yeni = new Set(liste.map((b) => b.ad));
    if (eski) liste.forEach((b) => { if (!eski.has(b.ad)) S.dogus[b.ad] = simdi; });
    S.gorulen = yeni;
    S.bitki = liste.map((b) => {
      const uv = mmUV(b.x, b.y);
      const p = yansit(uv.u, uv.v);
      const o = mmPx(uv.v);
      const capPx = sayi(b.yaricap_mm) * 2 * o;
      return {
        ad: b.ad, tur: b.tur, tur_ad: b.tur_ad, renk: b.renk || "#7bbf5a",
        x: p.x, y: p.y, u: uv.u, v: uv.v,
        capPx,
        // En az 26 piksel: daha küçüğü ekranda hiç görünmüyor. Gerçek
        // çapı yayılım halkası gösteriyor.
        cizimPx: kis(Math.max(26, capPx), 26, Math.max(26, G.enPx * 0.42)),
        olgunluk: b.olgunluk == null || b.yas_gun == null ? null : sayi(b.olgunluk),
        hasat: !!b.hasat,
        susadi: !!b.susadi,
        tahmin: !!b.su_tahmin,
        cakisik: !!b.cakisik,
        olcum: b.su_olcum || {},
        tip: arketip(b),
        faz: tohum(b.ad),
        vurgu: sayi(S.vurguAn[b.ad], 0),
        bas: sayi(S.basAn[b.ad], 0),
        yaprak: yesil(b),
        aksan: hexRGB(b.renk || "#7bbf5a"),
      };
      // Ressam algoritması: arkadakiler önce çiziliyor.
    }).sort((a, b2) => a.v - b2.v);
  }

  function ciz() {
    const ct = S.ct;
    if (!ct || !S.en || !S.boy) return;
    const simdi = performance.now();
    const t = (simdi - S.t0) / 1000;
    // Kareler arası gerçek süre: hareketin yumuşatması kare hızına
    // değil ZAMANA bağlı olsun, yavaş bir cihazda da aynı hızda vardır.
    const dt = kis((simdi - (S.sonKare || simdi)) / 1000, 0, 0.25);
    S.sonKare = simdi;
    robotYurut(dt);
    const I = isik();

    kamYurut(dt);
    statikCiz();
    ct.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ct.clearRect(0, 0, S.en, S.boy);
    if (!G.ileri) return;

    // Sahne kameranın altında çiziliyor; etiketler sonra, kamerasız.
    const k = S.kam;
    ct.setTransform(S.dpr * k.o, 0, 0, S.dpr * k.o, S.dpr * k.x, S.dpr * k.y);
    if (S.statik) ct.drawImage(S.statik, 0, 0, S.en, S.boy);
    // Gözler zeminin ÜSTÜNDE, bitkilerin ALTINDA: göz bir toprak
    // işareti, bitki onun üstünde duruyor.
    gozleriCiz(ct, S.sakin ? 0 : t);
    // Vurgu yumuşatılıyor: parmak bitkiye değince zıplamasın, kalksın.
    S.bitki.forEach((b) => {
      const hedef = b.ad === S.uzerinde || b.ad === S.kartAd ? 1 : 0;
      const k = 1 - Math.exp(-dt / 0.08);
      b.vurgu += (hedef - b.vurgu) * k;
      if (Math.abs(b.vurgu - hedef) < 0.005) b.vurgu = hedef;
      S.vurguAn[b.ad] = b.vurgu;
      // BASMA: parmak değdiği an ezilme başlıyor (40 ms), kalkınca
      // geri açılıyor. Geri bildirim 100 ms'den önce görünmeli.
      const bh = b.ad === S.basili ? 1 : 0;
      const bk = 1 - Math.exp(-dt / (bh ? 0.04 : 0.11));
      b.bas += (bh - b.bas) * bk;
      if (Math.abs(b.bas - bh) < 0.005) b.bas = bh;
      S.basAn[b.ad] = b.bas;
    });
    S.bitki.forEach((b) => bitkiCiz(ct, b, S.sakin ? 0 : t, I));
    onizlemeCiz(ct, S.sakin ? 0 : t);
    makineCiz(ct, S.sakin ? 0 : t, I);

    // Etiketler en üstte: bitkiler birbirinin üstüne binse de yazı
    // okunur kalıyor.
    // KAÇ ETİKET. Hepsini yazmak yatağı kutu tarlasına çeviriyordu.
    // Önce ölçülüp susadığı GÖRÜLENLER, sonra tahminen susamışlar,
    // sonra hiç ölçülmemişler; en fazla beş tane. Gerisi bitkiye
    // dokununca açılıyor.
    const oncelik = (b) => (b.susadi && !b.tahmin ? 0 : b.susadi ? 1
                            : !b.olcum.var ? 2 : 3);
    const secilen = [...S.bitki].sort((a2, b2) =>
      oncelik(a2) - oncelik(b2) || b2.v - a2.v).slice(0, 5);
    // Üzerine gelinen bitkinin etiketi HER ZAMAN ve İLK yazılıyor:
    // dokunulan şeyin adı, önceliği ne olursa olsun görünmeli.
    const vurgulu = S.bitki.find((b) => b.ad === S.uzerinde);
    if (vurgulu) {
      const i = secilen.indexOf(vurgulu);
      if (i >= 0) secilen.splice(i, 1);
      secilen.unshift(vurgulu);
    }
    bulutCiz(ct, t);
    kutlamaCiz(ct, t);

    // ETİKETLER KAMERASIZ: yakınlaştırınca yazı büyümesin, baloncuk
    // sahnenin ölçeğinden bağımsız okunur kalsın.
    ct.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    // BALONCUKLAR YUMUŞAK GİRİP ÇIKIYOR. Seçim her karede yeniden
    // yapılıyor; anında görünüp kaybolan bir kutu ekranın kendi kendine
    // sıçraması gibi duruyordu.
    const secilenAd = new Set(secilen.map((b) => b.ad));
    const ke = 1 - Math.exp(-dt / 0.16);
    S.bitki.forEach((b) => {
      const h = secilenAd.has(b.ad) ? 1 : 0;
      const a2 = sayi(S.etiketAn[b.ad], 0);
      const yeni2 = a2 + (h - a2) * ke;
      S.etiketAn[b.ad] = Math.abs(yeni2 - h) < 0.005 ? h : yeni2;
    });
    const kutular = [];
    onizlemeEtiketi(ct);
    makineEtiketi(ct);
    [...S.bitki]
      .filter((b) => sayi(S.etiketAn[b.ad], 0) > 0.01)
      .sort((a2, b2) => sayi(S.etiketAn[b2.ad], 0) - sayi(S.etiketAn[a2.ad], 0))
      .forEach((b) => etiketCiz(ct, b, kutular, sayi(S.etiketAn[b.ad], 0)));

    S.kare += 1;
  }

  /* ==================================================================== *
   * Tuval, ölçü ve döngü
   * ==================================================================== */
  function olcuTazele() {
    const kap = $("#bt-sahne");
    const tv = S.tuval;
    if (!kap || !tv) return false;
    const r = kap.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const en = Math.max(1, Math.round(r.width));
    const boy = Math.max(1, Math.round(r.height));
    if (en === S.en && boy === S.boy && dpr === S.dpr) return false;
    S.en = en; S.boy = boy; S.dpr = dpr;
    tv.width = Math.round(en * dpr);
    tv.height = Math.round(boy * dpr);
    tv.style.width = `${en}px`;
    tv.style.height = `${boy}px`;
    geometriKur();
    bitkileriHazirla();
    S.statikImza = "";
    if (!S.kamElle) {
      // Varsayılan biraz yakın ve yatağa ortalı: uzaktan bakınca
      // bitkiler nokta kalıyordu.
      S.kam.ho = 1.25;
      kamOdak(S.en / 2, S.boy / 2, 1.25);
      S.kam.o = S.kam.ho; S.kam.x = S.kam.hx; S.kam.y = S.kam.hy;
    } else {
      kamSinirla();
    }
    return true;
  }

  function dongu() {
    S.dongu = 0;
    if (!S.acik || document.hidden) return;
    olcuTazele();
    ciz();
    // SAKİN MOD: tek kare çizilip duruluyor. Hareket bazı insanlar için
    // rahatsız edici ve küçük bir cihazda boşta çizim saf ısı.
    if (S.sakin) return;
    S.dongu = requestAnimationFrame(dongu);
  }

  function surdur() {
    if (!S.dongu) S.dongu = requestAnimationFrame(dongu);
  }

  /* ==================================================================== *
   * Veri
   * ==================================================================== */
  async function yukle() {
    if (S.yukleniyor) return;
    S.yukleniyor = true;
    try {
      S.veri = await api("/api/bahce");
      S.hata = "";
      notYaz("yukle", "");
      geometriKur();
      bitkileriHazirla();
      S.statikImza = "";
      durumYaz();
      rafYaz();
      bosYaz();
      surdur();
      // Kart açıksa sayıları da tazele: bayat bir nem göstermek, ölçüm
      // yapılmış gibi göstermenin en sinsi hâli.
      if (S.kartAd) await ekYukle().then(kartYaz);
    } catch (hata) {
      S.hata = hata.message || String(hata);
      // Sessiz başarısızlık yok: ekran boş kalırsa sebebi yazıyor.
      notYaz("yukle", `Bahçe okunamadı: ${S.hata}`);
    } finally {
      S.yukleniyor = false;
    }
  }

  function durumYaz() {
    const el = $("#bt-bagli");
    const v = S.veri || {};
    if (el) {
      const yazi = el.querySelector("b");
      el.classList.toggle("acik", !!v.bagli && !v.mesgul);
      el.classList.toggle("kopuk", !v.bagli);
      el.classList.toggle("calisiyor", !!v.bagli && !!v.mesgul);
      if (yazi) {
        yazi.textContent = !v.bagli ? "Makine kopuk"
          : (v.mesgul ? "Makine çalışıyor" : "Makine hazır");
      }
    }
    // Kopukken iş başlatan her düğme kilitli ve SEBEBİ yazılı.
    document.querySelectorAll("#bt [data-makine]").forEach((d) => {
      d.disabled = !v.bagli;
      d.title = v.bagli ? "" : "Makine kopuk — ajan bağlanınca açılır.";
    });
    notYaz("bagli", v.bagli ? ""
      : "Makineyle bağlantı yok: bahçe görünüyor ama iş başlatılamıyor.");
  }

  function bosYaz() {
    const el = $("#bt-bos");
    if (!el) return;
    const v = S.veri || {};
    const bitki = (v.bitkiler || []).length;
    if (!(v.alanlar || []).length) {
      el.hidden = false;
      el.textContent = "Henüz dikim alanı tanımlı değil — toprağın nerede "
        + "olduğu bilinmiyor. Tarla sekmesinden dikim alanı ekleyin.";
    } else if (!bitki) {
      el.hidden = false;
      // "Burada bir şey yok" değil, "buraya bir şey ek".
      el.textContent = "Yatak boş — aşağıdan bir tohum alın, "
        + "nereye sığdığını toprakta göstereyim.";
    } else {
      el.hidden = true;
    }
  }

  /* ==================================================================== *
   * Çekirdekten gelen haberler
   * ==================================================================== */
  function kareGeldi() { /* Kamera katı bu sahnede yok. */ }

  function durumDegisti(d) {
    if (!S.acik || !S.veri) return;
    S.veri.konum = d.konum || {};
    // Z referansları: ucun toprağa inişi ÖLÇÜLEN z ile çiziliyor.
    if (d.toprak_z != null) S.veri.toprak_z = d.toprak_z;
    if (d.guvenli_z != null) S.veri.guvenli_z = d.guvenli_z;
    const bagli = !!d.bagli;
    const mesgul = !!(d.hareket || (d.dizi && d.dizi.calisiyor));
    if (bagli !== S.veri.bagli || mesgul !== S.veri.mesgul) {
      S.veri.bagli = bagli;
      S.veri.mesgul = mesgul;
      durumYaz();
    }
    // Sakin modda döngü durmuş olabilir: konum değiştiyse tek kare çiz.
    if (S.sakin) surdur();
  }

  function ekimDegisti() { /* Ekim akışı bir sonraki adımda bağlanıyor. */ }

  function kuyrukDegisti(k, tazele) {
    if (!S.veri) return;
    // BİTİŞİ YAKALA. Kuyruk özeti her işin durumunu veriyor; en son
    // çalışan iş "bitti" diye kapandıysa o işin noktalarında kutlama
    // var. "Çalışan yok, demek ki bitti" demek yanlış olurdu: iş iptal
    // de edilmiş, hata da vermiş olabilir.
    const onceki = S.sonIs;
    if (onceki) {
      const kayit = ((k && k.isler) || []).find((i) => i.kimlik === onceki.kimlik);
      if (kayit && kayit.durum === "bitti") {
        kutlamaAt(onceki.tip, onceki.noktalar);
        // Sulama bittiyse o bitkiler bir kez canlanıyor.
        if (onceki.tip === "sula") {
          const simdi = (performance.now() - S.t0) / 1000;
          (onceki.noktalar || []).forEach((ad) => { S.canlanma[ad] = simdi; });
        }
        S.sonIs = null;
      } else if (kayit && kayit.durum !== "calisiyor") {
        S.sonIs = null;                 // iptal ya da hata: kutlama yok
      }
    }
    const calisan = k && k.calisan;
    if (calisan) {
      S.sonIs = { kimlik: calisan.kimlik, tip: calisan.tip,
                  noktalar: (calisan.noktalar || []).slice() };
    }
    S.veri.kuyruk = k;
    if (S.acik && (tazele || (k && !k.calisan && !k.bekleyen))) yukle();
  }

  function baglandi() { if (S.acik) yukle(); }

  /* ==================================================================== *
   * Sekme ve bağlama
   * ==================================================================== */
  function sekme(acik) {
    S.acik = !!acik;
    const kok = $("#bt");
    if (kok) kok.hidden = !S.acik;
    document.body.classList.toggle("bahce-tuval", S.acik);
    if (!S.acik) {
      if (S.dongu) cancelAnimationFrame(S.dongu);
      S.dongu = 0;
      kartKapat();
      tohumSec("");
      return;
    }
    // Yerleşim yeni değişti: ölçüyü bir sonraki karede alıyoruz.
    requestAnimationFrame(() => { olcuTazele(); surdur(); });
    yukle();
  }

  function ikonBagla(sec, anahtar, uygula) {
    const d = $(sec);
    if (!d) return;
    let acik = false;
    try { acik = localStorage.getItem(anahtar) === "1"; }
    catch { /* depolama kapalı — varsayılan kalır */ }
    uygula(acik);
    d.setAttribute("aria-pressed", acik ? "true" : "false");
    d.onclick = () => {
      acik = !acik;
      try { localStorage.setItem(anahtar, acik ? "1" : "0"); } catch { /* boş */ }
      d.setAttribute("aria-pressed", acik ? "true" : "false");
      uygula(acik);
    };
  }

  function bagla() {
    const kok = $("#bt");
    if (!kok) return;
    S.tuval = $("#bt-tuval");
    if (!S.tuval) return;
    S.ct = S.tuval.getContext("2d");

    const tv = S.tuval;
    const yerel = (o) => {
      const r = tv.getBoundingClientRect();
      return { x: o.clientX - r.left, y: o.clientY - r.top };
    };
    // Fare: üzerine gelme. Dokunmatikte "üzerine gelme" diye bir şey
    // yok — orada dokunuş doğrudan kartı açıyor.
    // TEKERLEK: parmağın altındaki nokta sabit kalıyor.
    tv.addEventListener("wheel", (o) => {
      o.preventDefault();
      const p = yerel(o);
      S.kamElle = true;
      kamZum(S.kam.ho * (o.deltaY < 0 ? 1.16 : 1 / 1.16), p.x, p.y);
    }, { passive: false });

    // BOŞ TOPRAĞI SÜRÜKLEMEK GEZİNİYOR. Bitkinin üstünden başlayan
    // sürükleme gezinme sayılmıyor: orası dokunma hedefi.
    tv.addEventListener("pointerdown", (o) => {
      if (S.secilenTur) return;
      const p = yerel(o);
      const w = dunya(p.x, p.y);
      const bas = bitkiBul(w.x, w.y);
      if (bas) { S.basili = bas.ad; surdur(); return; }
      tv.setPointerCapture(o.pointerId);
      S.gezinme = { id: o.pointerId, x: o.clientX, y: o.clientY,
                    kx: S.kam.hx, ky: S.kam.hy, tasindi: false };
    });

    tv.addEventListener("pointermove", (o) => {
      if (S.surukle) return;               // tohum sürükleme belge düzeyinde
      // Gezinme birebir: kamera hedefi de o anki değeri de aynı anda
      // gidiyor, yoksa parmağın altındaki toprak geriden geliyor.
      if (S.gezinme && S.gezinme.id === o.pointerId) {
        const dx = o.clientX - S.gezinme.x, dy = o.clientY - S.gezinme.y;
        if (!S.gezinme.tasindi && Math.hypot(dx, dy) > 5) {
          S.gezinme.tasindi = true;
          S.kamElle = true;
          tv.style.cursor = "grabbing";
        }
        if (S.gezinme.tasindi) {
          S.kam.hx = S.gezinme.kx + dx;
          S.kam.hy = S.gezinme.ky + dy;
          kamSinirla();
          S.kam.x = S.kam.hx; S.kam.y = S.kam.hy;
          surdur();
        }
        return;
      }
      const p = yerel(o);
      const w = dunya(p.x, p.y);
      // Elde tohum varsa toprak bir bırakma yeri: önizleme onu izliyor.
      if (S.secilenTur && o.pointerType !== "touch") {
        onizlemeTazele(p.x, p.y);
        tv.style.cursor = "copy";
        return;
      }
      if (o.pointerType === "touch") return;
      const b = bitkiBul(w.x, w.y);
      const ad = b ? b.ad : "";
      tv.style.cursor = b ? "pointer" : "default";
      if (ad !== S.uzerinde) { S.uzerinde = ad; surdur(); }
    });

    const basBirak = () => { if (S.basili) { S.basili = ""; surdur(); } };
    tv.addEventListener("pointerup", basBirak);
    tv.addEventListener("pointercancel", basBirak);
    tv.addEventListener("pointerleave", basBirak);

    const gezinmeBitir = (o) => {
      if (!S.gezinme || S.gezinme.id !== o.pointerId) return;
      const tasindi = S.gezinme.tasindi;
      S.gezinme = null;
      tv.style.cursor = "default";
      if (tasindi) S.suruklendi = true;     // bunu tıklama sayma
    };
    tv.addEventListener("pointerup", gezinmeBitir);
    tv.addEventListener("pointercancel", gezinmeBitir);

    // ÇİFT DOKUNUŞ: bitkiye yumuşak geçişle yaklaş, boşluğa basınca
    // varsayılan uzaklığa dön.
    tv.addEventListener("dblclick", (o) => {
      const p = yerel(o);
      const w = dunya(p.x, p.y);
      const b = bitkiBul(w.x, w.y);
      S.kamElle = true;
      if (b) kamOdak(b.x, b.y - yukseklikPx(16, b.v), 2.4);
      else if (S.kam.ho > 1.4) kamOdak(S.en / 2, S.boy / 2, 1.25);
      else kamZum(2.2, p.x, p.y);
    });
    tv.addEventListener("pointerleave", () => {
      if (S.uzerinde) { S.uzerinde = ""; surdur(); }
      if (S.onizleme && !S.surukle) { S.onizleme = null; surdur(); }
    });
    tv.addEventListener("click", (o) => {
      if (S.suruklendi) { S.suruklendi = false; return; }
      const p = yerel(o);
      const w = dunya(p.x, p.y);
      // TOHUM ELDEYKEN TOPRAĞA DOKUNMAK DA EKİYOR: dokunmatikte
      // sürüklemeyi kendiliğinden bulamayan biri gözde kalmasın.
      if (S.secilenTur) {
        onizlemeTazele(p.x, p.y);
        const on = S.onizleme;
        const tur = turBul(S.secilenTur);
        if (on && tur) {
          if (on.ok) { ekOnayi(tur, on); }
          else {
            notYaz("birak", `Buraya ekilemez — ${on.sebep}`);
            setTimeout(() => notYaz("birak", ""), 6000);
          }
        }
        return;
      }
      const b = bitkiBul(w.x, w.y);
      if (b) kartAc(b.ad);
    });

    // Sürükleme BELGE DÜZEYİNDE izleniyor: parmak rafın dışına çıkınca
    // olay akışı kesilmesin.
    document.addEventListener("pointermove", surukleTasi, { passive: false });
    document.addEventListener("pointerup", surukleBirak);
    document.addEventListener("pointercancel", surukleBirak);

    const ortu = $("#bt-ortu");
    if (ortu) {
      // Kartın DIŞINA dokunmak kapatıyor, içine dokunmak değil.
      ortu.onclick = (o) => { if (o.target === ortu) kartKapat(); };
    }
    addEventListener("keydown", (o) => {
      if (o.key !== "Escape") return;
      if (S.kartAd) { kartKapat(); return; }
      if (S.secilenTur) { tohumSec(""); return; }
      // Elde bir şey yoksa Escape kamerayı varsayılana döndürüyor.
      S.kamElle = false;
      kamOdak(S.en / 2, S.boy / 2, 1.25);
    });

    ikonBagla("#bt-sakin", "farmbot_bt_sakin", (a) => {
      S.sakin = a;
      if (S.acik) surdur();
    });

    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (S.acik) { olcuTazele(); surdur(); }
      }).observe($("#bt-sahne"));
    } else {
      addEventListener("resize", () => { olcuTazele(); surdur(); });
    }
    // Sekme arkaya alınınca çizim duruyor; öne gelince kaldığı yerden.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) surdur();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bagla);
  } else {
    bagla();
  }

  /* Deneme kancası: ekranın kendi ölçtükleri. */
  function olcum() {
    return {
      acik: S.acik, sakin: S.sakin,
      en: S.en, boy: S.boy, dpr: S.dpr,
      bitki: S.bitki.length, kare: S.kare,
      yatakPx: Math.round(G.enPx), duvarPx: Math.round(G.duvarPx),
      kam: [Math.round(S.kam.o * 100) / 100, Math.round(S.kam.x),
            Math.round(S.kam.y)],
      dolgu: S.en ? Math.round(G.enPx / S.en * 100) : 0,   // yatak ekranın yüzde kaçı
      bagli: !!(S.veri || {}).bagli, hata: S.hata,
      robot: S.robot.gecerli
        ? [Math.round(S.robot.hx), Math.round(S.robot.hy)] : null,
      bas: aktifBasKimlik(), ucYuksekligi: ucYuksekligi(),
      uzerinde: S.uzerinde, kart: S.kartAd,
      tohum: S.secilenTur, goz: S.gozler ? S.gozler.adet : 0,
      kutlama: S.kutlama.length,
      onizleme: S.onizleme ? [S.onizleme.x, S.onizleme.y, S.onizleme.ok] : null,
      tipler: S.bitki.map((b) => `${b.tur}:${b.tip}`),
      ters: !!G.ters,
    };
  }

  return { sekme, kareGeldi, durumDegisti, kuyrukDegisti, ekimDegisti,
           baglandi, yukle, olcum, mmUV, uvMM, ekranUV, yansit };
})();

/* ---------------------------------------------------------------------- *
 * KÖPRÜ.
 *
 * `app.js` bahçeyi `window.Bahce` üzerinden çağırıyor (beş kanca). O
 * dosya paylaşılan bir dosya ve başka oturumlar orada çalışıyor; tek
 * satır bile değiştirmemek için ad burada bağlanıyor.
 *
 * ESKİ BAHÇE EKRANI SİLİNDİ. İki ekranı birden tutmak iki ayrı doğruluk
 * kaynağı demekti: bir gün ayrışırlar ve hangisinin doğru olduğu
 * bilinmez. Tek ekran var, o da bu.
 * ---------------------------------------------------------------------- */
window.Bahce = window.BahceTuval;
