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
    vurguAn: {},           // ad -> 0..1 yumuşatılmış vurgu
    kartAd: "",
    ek: null,              // /api/bitki — kuruma geçmişi, sulama süresi
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
            "turp", "radish", "pancar", "beet", "salata"],
    tuy: ["havuc", "havuç", "carrot", "dereotu", "dere otu", "dill",
          "rezene", "fennel", "kimyon", "maydanoz", "parsley", "kereviz"],
    cali: ["domates", "tomato", "biber", "pepper", "patlican", "patlıcan",
           "eggplant", "salatalik", "salatalık", "cucumber", "kabak",
           "zucchini", "fesleğen", "feslegen", "basil", "nane", "mint"],
    serit: ["sogan", "soğan", "onion", "pirasa", "pırasa", "leek",
            "sarimsak", "sarımsak", "garlic", "misir", "mısır", "corn",
            "arpa", "bugday", "buğday", "cim", "çim"],
    uclu: ["cilek", "çilek", "strawberry", "fasulye", "bean", "bezelye",
           "pea", "yonca", "clover"],
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
   * kalıyor; tür ayrımı yeşilin tonundan geliyor (addan türetiliyor,
   * yani aynı tür her zaman aynı ton) ve katalog rengi yalnız MEYVEDE
   * ve etikette aksan olarak kullanılıyor. */
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

  function cizGulce(ct, R, c, olgun, t, faz, ozel) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.08, 1);
    const dis = Math.max(10, Math.round(9 + oran * 9));
    const katlar = [
      { n: dis, uzun: R, ton: -0.30, egim: 0.0 },
      { n: Math.max(7, Math.round(dis * 0.72)), uzun: R * 0.72, ton: 0.03, egim: 0.41 },
      { n: Math.max(5, Math.round(dis * 0.45)), uzun: R * 0.44, ton: 0.26, egim: 1.07 },
    ];
    katlar.forEach((k, ki) => {
      for (let i = 0; i < k.n; i++) {
        // Açı düzgün dağılıma DAYANMIYOR: eşit aralık gülçeyi bir kar
        // tanesi yapıyordu. Her yaprak addan türeyen küçük bir sapma
        // alıyor — süs, ölçüm değil.
        const sapma = (tohum(`${ki}:${i}:${faz}`) - 0.5) * 0.42;
        const a = (Math.PI * 2 / k.n) * i + faz * 6 + k.egim + sapma;
        const sal = Math.sin(t * 0.85 + faz * 5 + i + ki) * 0.04;
        const uzunluk = k.uzun * (0.80 + tohum(`u${ki}:${i}:${faz}`) * 0.30);
        ct.save();
        ct.rotate(a + sal);
        ct.scale(1, 0.70);          // yayılım halkasıyla aynı basıklık
        const kayma = tohum(`r${ki}:${i}`) * 0.2;
        yaprakCiz(ct, uzunluk, uzunluk * (ozel.genislik || 0.26),
                  ton(c, k.ton - 0.16 + kayma), ton(c, k.ton + 0.16 + kayma),
                  ozel.dalga, i * 0.6);
        ct.restore();
      }
    });
    // Merkez gölgesi: gülçenin ortası çukur, bu onu düz bir yıldız
    // olmaktan çıkarıyor.
    const g = ct.createRadialGradient(0, 0, R * 0.02, 0, 0, R * 0.5);
    g.addColorStop(0, "rgba(0,0,0,0.34)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ct.fillStyle = g;
    ct.beginPath();
    ct.ellipse(0, 0, R * 0.5, R * 0.42, 0, 0, Math.PI * 2);
    ct.fill();
    ct.fillStyle = rgba(ton(c, 0.38), 0.85);
    ct.beginPath();
    ct.ellipse(0, 0, R * 0.09, R * 0.08, 0, 0, Math.PI * 2);
    ct.fill();
  }

  function cizTuy(ct, R, c, olgun, t, faz) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.08, 1);
    const sap = Math.max(5, Math.round(5 + oran * 7));
    for (let i = 0; i < sap; i++) {
      const a = (Math.PI * 2 / sap) * i + faz * 6;
      const sal = Math.sin(t * 1.3 + i + faz * 6) * 0.07;
      const uzun = R * (0.70 + ((i * 37) % 11) / 34);
      const renk = ton(c, -0.16 + ((i % 3) * 0.16));
      ct.save();
      ct.rotate(a + sal);
      ct.scale(1, 0.70);
      ct.strokeStyle = rgba(renk, 0.95);
      ct.lineWidth = Math.max(0.9, R * 0.028);
      ct.lineCap = "round";
      ct.beginPath();
      ct.moveTo(0, 0);
      ct.quadraticCurveTo(uzun * 0.16, -uzun * 0.62, uzun * 0.07, -uzun);
      ct.stroke();
      ct.lineWidth = Math.max(0.6, R * 0.016);
      for (let j = 2; j <= 7; j++) {
        const o = j / 8;
        const bx = uzun * 0.16 * o * (2 - o), by = -uzun * o;
        const tl = uzun * 0.24 * (1 - o * 0.7);
        ct.beginPath();
        ct.moveTo(bx, by);
        ct.quadraticCurveTo(bx - tl * 0.6, by - tl * 0.3, bx - tl, by - tl * 0.9);
        ct.moveTo(bx, by);
        ct.quadraticCurveTo(bx + tl * 0.6, by - tl * 0.3, bx + tl, by - tl * 0.9);
        ct.stroke();
      }
      ct.restore();
    }
  }

  function cizCali(ct, R, c, olgun, t, faz, hasat, aksan) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.1, 1);
    const dal = Math.max(5, Math.round(5 + oran * 4));
    ct.strokeStyle = rgba(ton(c, -0.52), 0.95);
    ct.lineCap = "round";
    for (let i = 0; i < dal; i++) {
      const a = (Math.PI * 2 / dal) * i + faz * 6 + Math.sin(t * 0.7 + i) * 0.04;
      // Dallar farklı boyda: eşit uzunlukta dallar çalıyı gülçeye
      // benzetiyordu.
      const uzun = R * (0.62 + tohum(`d${i}:${faz}`) * 0.38);
      ct.lineWidth = Math.max(1.4, R * 0.05);
      ct.save();
      ct.rotate(a);
      ct.scale(1, 0.70);
      // Uzun, hafif kavisli bir dal: ucunda üçlü bileşik yaprak.
      ct.beginPath();
      ct.moveTo(0, 0);
      ct.quadraticCurveTo(uzun * 0.10, -uzun * 0.38, uzun * 0.04, -uzun * 0.66);
      ct.stroke();
      // Dal boyunca ara yaprakçıklar
      [0.34, 0.52].forEach((o, oi) => {
        ct.save();
        ct.translate(uzun * 0.08 * o, -uzun * o);
        ct.rotate(oi ? 0.9 : -0.9);
        yaprakCiz(ct, uzun * 0.30, uzun * 0.13,
                  ton(c, -0.34), ton(c, -0.02), false, oi);
        ct.restore();
      });
      ct.translate(uzun * 0.04, -uzun * 0.66);
      [-0.72, 0, 0.72].forEach((k, j) => {
        ct.save();
        ct.rotate(k);
        yaprakCiz(ct, uzun * (j === 1 ? 0.42 : 0.33), uzun * 0.15,
                  ton(c, -0.28), ton(c, 0.12), false, j);
        ct.restore();
      });
      ct.restore();
    }
    // MEYVE YALNIZ GERÇEKTEN HASADA HAZIRSA. Olgunluk oranına bakıp
    // "herhâlde meyve vermiştir" demek, ekranın uydurması olurdu.
    // Rengi kataloğun tür rengi — meyvenin rengi orada yazıyor.
    if (hasat) {
      for (let i = 0; i < 3; i++) {
        const a = faz * 9 + i * 2.1;
        const rr = R * 0.40;
        const mx = Math.cos(a) * rr, my = Math.sin(a) * rr * 0.82;
        const g = ct.createRadialGradient(mx - R * 0.05, my - R * 0.05, R * 0.02,
                                          mx, my, R * 0.17);
        g.addColorStop(0, rgba(ton(aksan, 0.35), 1));
        g.addColorStop(1, rgba(ton(aksan, -0.18), 1));
        ct.fillStyle = g;
        ct.beginPath();
        ct.ellipse(mx, my, R * 0.155, R * 0.145, 0, 0, Math.PI * 2);
        ct.fill();
      }
    }
  }

  function cizSerit(ct, R, c, olgun, t, faz) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.1, 1);
    const adet = Math.max(5, Math.round(5 + oran * 6));
    for (let i = 0; i < adet; i++) {
      // Soğan/pırasa yaprakları bir kümeden çıkıp dağılıyor; tek yöne
      // bakan bir yelpaze palmiyeye benziyordu.
      const a = (Math.PI * 2 / adet) * i + faz * 6
        + (tohum(`s${i}:${faz}`) - 0.5) * 0.5;
      const sal = Math.sin(t * 1.15 + i * 0.8 + faz * 4) * 0.08;
      const uzun = R * (0.9 + ((i * 53) % 7) / 22);
      const renk = ton(c, i % 2 ? -0.22 : 0.06);
      ct.save();
      ct.rotate(a + sal);
      ct.scale(1, 0.70);
      ct.beginPath();
      ct.moveTo(-R * 0.05, 0);
      ct.quadraticCurveTo(-R * 0.14, -uzun * 0.55, R * 0.015, -uzun);
      ct.quadraticCurveTo(R * 0.11, -uzun * 0.55, R * 0.05, 0);
      ct.fillStyle = rgba(renk, 0.95);
      ct.fill();
      ct.strokeStyle = rgba(ton(renk, -0.4), 0.5);
      ct.lineWidth = Math.max(0.5, R * 0.015);
      ct.stroke();
      ct.restore();
    }
  }

  function cizUclu(ct, R, c, olgun, t, faz, hasat, aksan) {
    const oran = olgun == null ? 0.5 : kis(olgun, 0.1, 1);
    const kume = Math.max(3, Math.round(3 + oran * 4));
    // Ortada da bir küme: dışarı kaymış kümeler bitkiyi ortası delik
    // bir çelenge çeviriyordu.
    ct.save();
    ct.scale(1, 0.70);
    [-0.8, 0, 0.8].forEach((k, j) => {
      ct.save();
      ct.rotate(k + faz * 6);
      yaprakCiz(ct, R * (j === 1 ? 0.40 : 0.33), R * 0.20,
                ton(c, -0.34), ton(c, 0.04), true, j);
      ct.restore();
    });
    ct.restore();
    for (let i = 0; i < kume; i++) {
      const a = (Math.PI * 2 / kume) * i + faz * 6;
      const sal = Math.sin(t * 0.9 + i + faz * 3) * 0.045;
      ct.save();
      ct.rotate(a + sal);
      ct.scale(1, 0.70);
      ct.translate(0, -R * 0.36);
      [-0.78, 0, 0.78].forEach((k, j) => {
        ct.save();
        ct.rotate(k);
        yaprakCiz(ct, R * (j === 1 ? 0.58 : 0.48), R * 0.26,
                  ton(c, -0.26), ton(c, 0.14), true, j * 1.3);
        ct.restore();
      });
      ct.restore();
    }
    if (hasat) {
      for (let i = 0; i < 2; i++) {
        const a = faz * 7 + i * 2.6;
        const mx = Math.cos(a) * R * 0.34, my = Math.sin(a) * R * 0.28;
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

  /** Bir bitkinin bütün çizimi: gölge, yayılım halkası, gövde. */
  function bitkiCiz(ct, b, t, I) {
    const R = b.cizimPx / 2;
    // Yere düşen gölge — güneşin yönünde, alçak güneşte uzun.
    ct.save();
    ct.globalAlpha = 0.20 + I.gunduz * 0.16;
    ct.fillStyle = "#000";
    ct.beginPath();
    ct.ellipse(b.x + I.gx * R * 0.30 * I.boy, b.y + R * 0.14,
               R * 0.74 * I.boy, R * 0.30, 0, 0, Math.PI * 2);
    ct.fill();
    ct.restore();

    // YAYILIM HALKASI — ÖLÇÜLEN çap. Çizilen bitki en az 26 piksel
    // oluyor ki fide görünsün; halka gerçeği söylüyor, yani küçük bir
    // fide büyük görünmüyor, yalnız görünüyor.
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
    // beliriyor. İkisi de SÜS — hangi bitkiye dokunduğunu göstermek
    // dışında bir anlam taşımıyor.
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
    const c = b.yaprak;
    const aksan = b.aksan;
    const ozel = { genislik: 0.22 + b.faz * 0.12, dalga: b.tip === "gulce" };
    if (b.tip === "tuy") cizTuy(ct, R, c, b.olgunluk, t, b.faz);
    else if (b.tip === "cali") cizCali(ct, R, c, b.olgunluk, t, b.faz, b.hasat, aksan);
    else if (b.tip === "serit") cizSerit(ct, R, c, b.olgunluk, t, b.faz);
    else if (b.tip === "uclu") cizUclu(ct, R, c, b.olgunluk, t, b.faz, b.hasat, aksan);
    else cizGulce(ct, R, c, b.olgunluk, t, b.faz, ozel);
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
  function etiketCiz(ct, b, kutular, I) {
    const o = b.olcum || {};
    const ad = String(b.tur_ad || b.tur || "bitki");
    const nem = o.var ? `%${sayi(o.yuzde).toFixed(0)}` : "nem ölçülmedi";
    ct.font = yazTipi(11, true);
    const enAd = ct.measureText(ad).width;
    ct.font = yazTipi(10, false);
    const enNem = ct.measureText(nem).width;
    const en = Math.round(Math.max(enAd, enNem) + 16 + (b.susadi ? 13 : 0));
    const boy = 28;

    const R = b.cizimPx / 2;
    const yuk = yukseklikPx(16, b.v);
    // Tepe noktası: kutunun tutunduğu yer.
    const tx = b.x + R * 0.62;
    const ty = b.y - yuk - R * 0.52;
    let x = Math.round(tx + 10);
    let yy = Math.round(ty - boy - 6);
    // Tuvalin dışına taşmasın.
    if (x + en > S.en - 6) x = Math.round(tx - 10 - en);
    if (yy < 4) yy = 4;

    const kutu = { x1: x, y1: yy, x2: x + en, y2: yy + boy };
    if (kutular.some((k) => !(kutu.x2 < k.x1 - 4 || kutu.x1 > k.x2 + 4
                              || kutu.y2 < k.y1 - 4 || kutu.y1 > k.y2 + 4))) return;
    kutular.push(kutu);

    ct.strokeStyle = "rgba(255,255,255,0.28)";
    ct.lineWidth = 1;
    ct.beginPath();
    ct.moveTo(tx, ty);
    ct.lineTo(x < tx ? x + en : x, yy + boy - 4);
    ct.stroke();
    ct.fillStyle = "rgba(255,255,255,0.28)";
    ct.beginPath();
    ct.arc(tx, ty, 2, 0, Math.PI * 2);
    ct.fill();

    ct.fillStyle = "rgba(16,18,15,0.88)";
    yuvarlakKutu(ct, x, yy, en, boy, 8);
    ct.fill();
    // Sol kenarda türün katalog rengi: aynı türün bitkileri bir bakışta
    // eşleşsin. Renk TEK BAŞINA bilgi taşımıyor, ad zaten yazılı.
    ct.save();
    yuvarlakKutu(ct, x, yy, en, boy, 8);
    ct.clip();
    ct.fillStyle = rgba(b.aksan, 0.95);
    ct.fillRect(x, yy, 3, boy);
    ct.restore();

    ct.textBaseline = "top";
    ct.fillStyle = "#f2f2ee";
    ct.font = yazTipi(11, true);
    ct.fillText(ad, x + 9, yy + 4);
    ct.font = yazTipi(10, false);
    ct.fillStyle = o.var ? "#c8c9bf" : "#82847a";
    ct.fillText(nem, x + 9, yy + 16);

    if (b.susadi) {
      const dx = x + en - 9, dy = yy + 15;
      ct.beginPath();
      ct.moveTo(dx, dy - 6);
      ct.quadraticCurveTo(dx + 4.5, dy + 0.5, dx, dy + 5);
      ct.quadraticCurveTo(dx - 4.5, dy + 0.5, dx, dy - 6);
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
    }
    void I;
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
    const yer = yansit(kis(uv.u, 0, 1), kis(uv.v, 0, 1));
    const kopruY = yukseklikPx(KOPRU_MM, uv.v);

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

    ct.strokeStyle = "rgba(255,255,255,0.30)";
    ct.lineWidth = 1;
    ct.beginPath();
    ct.moveTo(yer.x, yer.y - kopruY);
    ct.lineTo(x < yer.x ? x + en : x, yy + boy - 4);
    ct.stroke();

    ct.fillStyle = "rgba(16,18,15,0.90)";
    yuvarlakKutu(ct, x, yy, en, boy, 8);
    ct.fill();
    ct.save();
    yuvarlakKutu(ct, x, yy, en, boy, 8);
    ct.clip();
    ct.fillStyle = v.mesgul ? "#4a90e2" : "#7c8089";
    ct.fillRect(x, yy, 3, boy);
    ct.restore();

    ct.textBaseline = "top";
    ct.fillStyle = "#f2f2ee";
    ct.font = yazTipi(11, true);
    ct.fillText(bas1, x + 9, yy + 4);
    ct.font = yazTipi(10, false);
    ct.fillStyle = "#b9bab0";
    ct.fillText(alt, x + 9, yy + 17);
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
   * Veriden çizime
   * ==================================================================== */
  function bitkileriHazirla() {
    const liste = (S.veri && S.veri.bitkiler) || [];
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

    statikCiz();
    ct.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ct.clearRect(0, 0, S.en, S.boy);
    if (S.statik) ct.drawImage(S.statik, 0, 0, S.en, S.boy);

    if (!G.ileri) return;
    // Vurgu yumuşatılıyor: parmak bitkiye değince zıplamasın, kalksın.
    S.bitki.forEach((b) => {
      const hedef = b.ad === S.uzerinde || b.ad === S.kartAd ? 1 : 0;
      const k = 1 - Math.exp(-dt / 0.08);
      b.vurgu += (hedef - b.vurgu) * k;
      if (Math.abs(b.vurgu - hedef) < 0.005) b.vurgu = hedef;
      S.vurguAn[b.ad] = b.vurgu;
    });
    S.bitki.forEach((b) => bitkiCiz(ct, b, S.sakin ? 0 : t, I));
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
    const kutular = [];
    makineEtiketi(ct);
    secilen.forEach((b) => etiketCiz(ct, b, kutular, I));

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
      el.textContent = "Yatak boş.";
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
    tv.addEventListener("pointermove", (o) => {
      if (o.pointerType === "touch") return;
      const p = yerel(o);
      const b = bitkiBul(p.x, p.y);
      const ad = b ? b.ad : "";
      tv.style.cursor = b ? "pointer" : "default";
      if (ad !== S.uzerinde) { S.uzerinde = ad; surdur(); }
    });
    tv.addEventListener("pointerleave", () => {
      if (S.uzerinde) { S.uzerinde = ""; surdur(); }
    });
    tv.addEventListener("click", (o) => {
      const p = yerel(o);
      const b = bitkiBul(p.x, p.y);
      if (b) kartAc(b.ad);
    });

    const ortu = $("#bt-ortu");
    if (ortu) {
      // Kartın DIŞINA dokunmak kapatıyor, içine dokunmak değil.
      ortu.onclick = (o) => { if (o.target === ortu) kartKapat(); };
    }
    addEventListener("keydown", (o) => {
      if (o.key === "Escape" && S.kartAd) kartKapat();
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
      dolgu: S.en ? Math.round(G.enPx / S.en * 100) : 0,   // yatak ekranın yüzde kaçı
      bagli: !!(S.veri || {}).bagli, hata: S.hata,
      robot: S.robot.gecerli
        ? [Math.round(S.robot.hx), Math.round(S.robot.hy)] : null,
      bas: aktifBasKimlik(), ucYuksekligi: ucYuksekligi(),
      uzerinde: S.uzerinde, kart: S.kartAd,
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
