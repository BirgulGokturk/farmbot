/* Bahçe — bahçenin kendisi.
 *
 * NE OLDUĞU. Panelin kullanıcıya bakan yüzü. Yatak ekranın tamamı;
 * bilgi sahnenin ÜSTÜNDE yaşıyor, yanında kutularda değil. Bahçeyle
 * uğraşan biri buraya bakıp "şimdi ne yapmalıyım" sorusunun cevabını
 * görüyor ve o işi bitkinin üstünde başlatıyor.
 *
 * ---------------------------------------------------------------------
 * ÜÇ KURAL — HEPSİ BOZULAMAZ
 * ---------------------------------------------------------------------
 * 1. ÖLÇÜLMEMİŞ ŞEY ÖLÇÜLMÜŞ GİBİ GÖRÜNMEZ. "Nemi bilinmiyor" ile "nemi
 *    yeterli" ayrı çiziliyor: ölçülen nem DOLU bir halka, ölçülmemiş
 *    olan İÇİ BOŞ kesikli bir halka ve ortasında soru işareti. Ölçüme
 *    değil geçen güne dayanan her karar kesikli çerçeveyle "tahmin"
 *    diyor. Bitkinin boyu ölçülen yayılım çapından, olgunluğu ekim
 *    tarihinden geliyor; ikisi de yoksa nötr çiziliyor.
 *
 * 2. SESSİZ BAŞARISIZLIK YOK. Bu dosyanın öncekisi tek bir tanımsız
 *    fonksiyonla (`kalib`) bütün sahneyi düşürdü ve ekranda yalnız
 *    "Bahçe okunamadı" yazdı. Artık çizimin ve olayların her girişi
 *    `guvenli()` içinden geçiyor: bir şey patlarsa sahne durmuyor, hata
 *    ekranın üstünde adıyla ve satırıyla yazıyor.
 *
 * 3. GERİ ALINAMAZ İŞ ONAY İSTER. Ekim ve sulama önce ne olacağını
 *    yazıyor. Makine kopukken iş başlatan hiçbir düğme açık görünmüyor.
 *
 * ---------------------------------------------------------------------
 * ÇİZİM MİMARİSİ — NEDEN BÖYLE
 * ---------------------------------------------------------------------
 * Panel Raspberry Pi 5'te barınıyor ve zayıf cihazlardan açılıyor. Üç
 * karar bunun için:
 *
 *   İKİ TUVAL. Alttaki (`zemin`) çim, yatak duvarları, toprak dokusu ve
 *   dikim alanları — ölçü ya da veri değişmedikçe hiç yeniden
 *   çizilmiyor. Üstteki (`sahne`) bitkiler, makine, yol ve etiketler.
 *
 *   BİTKİLER ÖNBELLEKLİ. Her bitki bir kez küçük bir tuvale çiziliyor
 *   ve sahneye tek `drawImage` ile basılıyor. Anahtar: tür + olgunluk
 *   kademesi + çap + hasat. Yirmi dört bitkilik bir yatakta kare başına
 *   yüzlerce yol işlemi yerine yirmi dört kopyalama kalıyor.
 *
 *   BOŞTA ÇİZİM YOK. `requestAnimationFrame` döngüsü sürekli dönmüyor:
 *   sahne yalnız KİRLİYSE çiziliyor ve döngü yalnız CANLI bir hareket
 *   varken (makine yürüyor, su akıyor, bir geçiş sürüyor) dönüyor.
 *   Hiçbir şey olmuyorsa saniyede sıfır kare. Bu yüzden süs
 *   canlandırması da yok: hareket eden her şey olan biteni anlatıyor.
 *
 * ---------------------------------------------------------------------
 * KOORDİNAT DÜNYALARI
 * ---------------------------------------------------------------------
 *   mm     — yatak milimetresi, makinenin konuştuğu dil
 *   uv     — yatağın birim karesi (0..1); v=0 ARKA kenar
 *   dünya  — izdüşüm sonrası piksel (kamerasız)
 *   ekran  — tuval pikseli (kamera uygulanmış)
 *
 * uv→dünya bir HOMOGRAFİ: yatak ekranda yamuk duruyor (arka kenar dar)
 * ve bu izdüşüm afin değil. Tersi de alınıyor, yani parmağın değdiği
 * piksel tek matris çarpımıyla milimetreye dönüyor.
 */
window.Bahce = (function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const P = () => window.Panel || {};
  const KAMERA = "ust";

  /* Yamuğun arka kenarı ön kenarın kaçta kaçı; 1.0 kuş bakışı. */
  const ARKA_ORAN = 0.80;
  /* Derinliğin dikeyde kısalması. */
  const DERINLIK = 0.60;
  /* Yatağın kenar duvarının görsel yüksekliği (mm). ÖLÇÜM DEĞİL —
     yatağın gerçek yüksekliği pakette yok; kenar bir sınır işareti. */
  const DUVAR_MM = 95;
  const YUKSEKLIK_ORANI = 0.72;

  const S = {
    acik: false, veri: null, yukleniyor: false, sakin: false,
    zemin: null, zeminCt: null, sahne: null, sahneCt: null,
    en: 0, boy: 0, dpr: 1,
    zeminImza: "",
    kirli: true,                 // sahne yeniden çizilecek mi
    dongu: 0, canli: 0,          // canlı hareket sayacı (0 → döngü durur)
    t0: performance.now(), sonKare: 0,
    bitki: [], bitkiIx: {},      // çizime hazır bitkiler
    sprite: new Map(),           // önbellekli bitki çizimleri
    robot: { hx: 0, hy: 0, hz: null, var: false },
    uzerinde: "", basili: "", secili: "",
    menuAd: "",                  // halka menüsü açık olan bitki
    secilenTur: "", gozler: null, gozT0: 0,
    surukle: null, suruklendi: false, onizleme: null,
    zerre: [],                   // su, toz, kutlama
    notlar: {}, hatalar: [], isVurgu: null, sonIs: null,
    olcum: { kare: 0, sure: 0, enUzun: 0, sayac: 0 },
  };

  /* ==================================================================== *
   * Küçük yardımcılar
   * ==================================================================== */
  const sayi = (d, v = 0) => { const s = Number(d); return Number.isFinite(s) ? s : v; };
  const kis = (d, a, b) => Math.max(a, Math.min(b, d));
  const kacisli = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  function gunluk(metin, sinif) { if (P().gunluk) P().gunluk(metin, sinif || ""); }
  function api(yol, secenek) { return P().apiIste(yol, secenek); }
  function gonder(yol, govde) {
    return api(yol, { method: "POST", body: JSON.stringify(govde) });
  }

  /* SESSİZ BAŞARISIZLIK YOK.
   *
   * Önceki sürüm tanımsız tek bir fonksiyonla bütün sahneyi düşürdü ve
   * ekranda yalnız "Bahçe okunamadı" kaldı. Artık her giriş buradan
   * geçiyor: hata yakalanıyor, sahne çalışmaya devam ediyor ve sebep
   * ekranın üstünde ADIYLA yazıyor. Aynı hata bir kez yazılıyor, yoksa
   * saniyede altmış satır olurdu. */
  function guvenli(ad, islev) {
    return function (...arg) {
      try {
        return islev.apply(null, arg);
      } catch (hata) {
        hataYaz(ad, hata);
        return undefined;
      }
    };
  }

  function hataYaz(ad, hata) {
    const metin = `${ad}: ${(hata && hata.message) || hata}`;
    if (S.hatalar.indexOf(metin) < 0) {
      S.hatalar.push(metin);
      if (S.hatalar.length > 4) S.hatalar.shift();
      try { console.error("[bahçe]", ad, hata); } catch { /* boş */ }
    }
    const el = $("#bh-hata");
    if (el) {
      el.hidden = false;
      el.innerHTML = S.hatalar.map((m) =>
        `<span>${kacisli(m)}</span>`).join("");
    }
  }

  function notYaz(anahtar, metin) {
    if (metin) S.notlar[anahtar] = metin; else delete S.notlar[anahtar];
    const el = $("#bh-not");
    if (!el) return;
    const hepsi = Object.values(S.notlar).filter(Boolean);
    el.hidden = !hepsi.length;
    el.textContent = hepsi.join(" · ");
  }

  function sureKisa(sn) {
    if (sn == null || !Number.isFinite(Number(sn))) return "";
    const s = Math.max(0, Number(sn));
    if (s < 90) return "az önce";
    if (s < 3600) return `${Math.round(s / 60)} dk`;
    if (s < 86400) return `${Math.round(s / 3600)} saat`;
    return `${Math.round(s / 86400)} gün`;
  }

  function tarih(ts) {
    const d = sayi(ts, 0);
    if (!d) return "";
    try {
      return new Date(d * 1000).toLocaleDateString("tr-TR",
        { day: "numeric", month: "long", year: "numeric" });
    } catch { return ""; }
  }

  /** Addan türeyen sabit sayı — süs değişkenliği için. Rastgele olsaydı
   *  aynı bitki her çizimde başka türlü görünürdü. */
  function tohum(ad) {
    let h = 2166136261;
    const s = String(ad || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }
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
    return Number.isFinite(n) ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
                              : { r: 123, g: 191, b: 90 };
  }
  const rgba = (c, a) => `rgba(${c.r},${c.g},${c.b},${a})`;
  function ton(c, o) {
    const f = (k) => Math.round(o >= 0 ? k + (255 - k) * o : k * (1 + o));
    return { r: kis(f(c.r), 0, 255), g: kis(f(c.g), 0, 255), b: kis(f(c.b), 0, 255) };
  }
  function karis(a, b, t) {
    return { r: Math.round(a.r + (b.r - a.r) * t),
             g: Math.round(a.g + (b.g - a.g) * t),
             b: Math.round(a.b + (b.b - a.b) * t) };
  }
  function hslRGB(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255),
             b: Math.round((b + m) * 255) };
  }

  /* Yumuşama eğrileri. Doğrusal geçiş cansız görünüyor. */
  const yumusak = (t) => 1 - Math.pow(1 - kis(t, 0, 1), 3);
  function asma(t) {
    const x = kis(t, 0, 1) - 1;
    return 1 + x * x * (2.70158 * x + 1.70158);
  }

  /* ==================================================================== *
   * Günün ışığı
   *
   * BİLGİ TAŞIYOR: ekranın sabahla geceyi aynı göstermesi, bahçesine
   * bakan birini yanıltır. Kaynağı tarayıcının saati; hiçbir ölçüme
   * karşılık gelmiyor ve hiçbir sayıya dönüşmüyor. Saat başı bir kez
   * hesaplanıyor (zemin imzasında saat var).
   * ==================================================================== */
  function isik() {
    const d = new Date();
    const saat = d.getHours() + d.getMinutes() / 60;
    const yuk = kis(Math.sin(((saat - 6) / 14) * Math.PI), -0.25, 1);
    const gunduz = kis(yuk, 0, 1);
    const aci = ((saat - 6) / 14) * Math.PI;
    return {
      gunduz, saat,
      gx: -Math.cos(aci), boy: 1 + (1 - gunduz) * 1.4,
      sicak: karis({ r: 96, g: 126, b: 190 }, { r: 255, g: 216, b: 152 }, gunduz),
      guc: 0.10 + gunduz * 0.22,
      gece: gunduz < 0.06,
    };
  }

  /* ==================================================================== *
   * Geometri — yatak ekranda nerede
   * ==================================================================== */
  const G = { kose: null, ileri: null, ters: null, enPx: 0, duvarPx: 0,
              mmEn: 1, mmBoy: 1 };

  /** Üst kameranın kalibrasyonu — YOKSA null.
   *
   * Bu fonksiyonun yokluğu bir önceki sürümü düşürdü; adı burada ve
   * çağıran her yer null dönebileceğini biliyor. */
  function kalib() {
    const k = (S.veri && S.veri.kamera) || {};
    return k.kalibre ? (k.kalibrasyon || null) : null;
  }

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

  function homografi(k) {
    const [p0, p1, p2, p3] = k;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const sx = p0.x - p1.x + p2.x - p3.x;
    const sy = p0.y - p1.y + p2.y - p3.y;
    let a, b, c, d, e, f, g, h;
    if (Math.abs(sx) < 1e-6 && Math.abs(sy) < 1e-6) {
      a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
      d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y; g = 0; h = 0;
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
    const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
    return [A / det, (c * h - b * i) / det, (b * f - c * e) / det,
            B / det, (a * i - c * g) / det, (c * d - a * f) / det,
            C / det, (b * g - a * h) / det, (a * e - b * d) / det];
  }

  /** Yatağı tuvale KAHRAMAN olarak yerleştirir: kenarlardan az pay,
   *  ortada kalan her şey yatak. */
  function geometriKur() {
    const s = yatakSinir();
    G.mmEn = Math.max(1, s.x2 - s.x1);
    G.mmBoy = Math.max(1, s.y2 - s.y1);
    const payX = Math.max(10, S.en * 0.03);
    const payY = Math.max(10, S.boy * 0.03);
    const kEn = Math.max(80, S.en - payX * 2);
    const kBoy = Math.max(80, S.boy - payY * 2);
    const oran = (G.mmBoy / G.mmEn) * DERINLIK;
    const duvarOran = (DUVAR_MM / G.mmEn) * YUKSEKLIK_ORANI;
    let enPx = kEn;
    let boyPx = enPx * (oran + duvarOran);
    if (boyPx > kBoy) { enPx = kBoy / (oran + duvarOran); boyPx = kBoy; }
    const derinlik = enPx * oran;
    G.enPx = enPx;
    G.duvarPx = enPx * duvarOran;
    const cx = S.en / 2;
    const ust = (S.boy - (derinlik + G.duvarPx)) / 2;
    const arka = enPx * ARKA_ORAN;
    G.kose = [
      { x: cx - arka / 2, y: ust }, { x: cx + arka / 2, y: ust },
      { x: cx + enPx / 2, y: ust + derinlik }, { x: cx - enPx / 2, y: ust + derinlik },
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
  /** O derinlikte bir milimetre kaç piksel. */
  const mmPx = (v) => (G.enPx * (ARKA_ORAN + (1 - ARKA_ORAN) * kis(v, 0, 1))) / G.mmEn;
  const yukPx = (mm, v) => sayi(mm) * mmPx(v) * YUKSEKLIK_ORANI;

  function yol(ct, p) {
    ct.beginPath();
    p.forEach((q, i) => (i ? ct.lineTo(q.x, q.y) : ct.moveTo(q.x, q.y)));
    ct.closePath();
  }
  function mmDortgen(x1, y1, x2, y2) {
    const a = mmUV(x1, y1), b = mmUV(x2, y1), c = mmUV(x2, y2), d = mmUV(x1, y2);
    return [yansit(a.u, a.v), yansit(b.u, b.v), yansit(c.u, c.v), yansit(d.u, d.v)];
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

  /* ==================================================================== *
   * ZEMİN TUVALİ — çim, yatak, toprak. Ölçü ya da veri değişmedikçe
   * yeniden çizilmiyor.
   * ==================================================================== */
  function zeminImza() {
    const v = S.veri || {};
    const s = yatakSinir();
    return [S.en, S.boy, S.dpr, s.x1, s.x2, s.y1, s.y2,
            (v.alanlar || []).length, JSON.stringify(v.alanlar || []),
            JSON.stringify((v.bolgeler || []).map((b) => [b.x1, b.y1, b.x2, b.y2])),
            new Date().getHours()].join("|");
  }

  function zeminCiz() {
    const imza = zeminImza();
    if (S.zeminImza === imza) return;
    const ct = S.zeminCt;
    if (!ct || !G.ileri) return;
    S.zeminImza = imza;
    const I = isik();
    ct.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ct.clearRect(0, 0, S.en, S.boy);
    cimCiz(ct, I);
    golgeCiz(ct, I);
    duvarCiz(ct, I);
    toprakCiz(ct, I);
    alanCiz(ct);
    yasakCiz(ct);
    cerceveCiz(ct, I);
  }

  function cimCiz(ct, I) {
    const g = ct.createLinearGradient(0, 0, 0, S.boy);
    const ust = karis({ r: 36, g: 50, b: 31 }, I.sicak, I.guc * 0.5);
    const alt = karis({ r: 19, g: 29, b: 17 }, I.sicak, I.guc * 0.25);
    g.addColorStop(0, `rgb(${ust.r},${ust.g},${ust.b})`);
    g.addColorStop(1, `rgb(${alt.r},${alt.g},${alt.b})`);
    ct.fillStyle = g;
    ct.fillRect(0, 0, S.en, S.boy);
    const r = uretec(97);
    ct.lineWidth = 1;
    for (let i = 0; i < 700; i++) {
      const x = r() * S.en, y = r() * S.boy, boy = 3 + r() * 5;
      const a = 0.04 + r() * 0.06;
      ct.strokeStyle = r() > 0.5 ? `rgba(150,200,120,${a})` : `rgba(0,0,0,${a})`;
      ct.beginPath();
      ct.moveTo(x, y);
      ct.lineTo(x + (r() - 0.5) * 3, y - boy);
      ct.stroke();
    }
    const o = ct.createRadialGradient(S.en / 2, S.boy * 0.44, 10,
                                      S.en / 2, S.boy * 0.44, S.en * 0.72);
    o.addColorStop(0, `rgba(255,255,255,${(0.04 + I.gunduz * 0.05).toFixed(3)})`);
    o.addColorStop(1, "rgba(0,0,0,0.38)");
    ct.fillStyle = o;
    ct.fillRect(0, 0, S.en, S.boy);
  }

  /** Çerçevenin dış köşeleri: yatak sınırının 30 mm dışı. Tahta
   *  ekilebilir alanı yemiyor. */
  function cerceveKose() {
    const ex = 30 / G.mmEn, ey = 30 / G.mmBoy;
    return [yansit(-ex, -ey), yansit(1 + ex, -ey),
            yansit(1 + ex, 1 + ey), yansit(-ex, 1 + ey)];
  }

  function golgeCiz(ct, I) {
    const d = cerceveKose();
    const alt = Math.max(d[2].y, d[3].y) + G.duvarPx;
    ct.save();
    ct.filter = "blur(16px)";
    ct.fillStyle = `rgba(0,0,0,${(0.28 + (1 - I.gunduz) * 0.14).toFixed(3)})`;
    ct.beginPath();
    ct.ellipse((d[2].x + d[3].x) / 2 + I.gx * G.enPx * 0.08 * I.boy,
               alt - G.duvarPx * 0.08, (d[2].x - d[3].x) * 0.60,
               G.duvarPx * 0.55, 0, 0, Math.PI * 2);
    ct.fill();
    ct.restore();
  }

  function duvarCiz(ct, I) {
    const d = cerceveKose();
    const h = G.duvarPx;
    const on = karis({ r: 122, g: 84, b: 52 }, I.sicak, I.guc);
    const g = ct.createLinearGradient(0, d[3].y, 0, d[3].y + h);
    const u1 = ton(on, -0.05), u2 = ton(on, -0.45);
    g.addColorStop(0, `rgb(${u1.r},${u1.g},${u1.b})`);
    g.addColorStop(1, `rgb(${u2.r},${u2.g},${u2.b})`);
    ct.fillStyle = g;
    yol(ct, [d[3], d[2], { x: d[2].x, y: d[2].y + h }, { x: d[3].x, y: d[3].y + h }]);
    ct.fill();
    const yan = (a, b, koyu) => {
      const c = ton(on, koyu);
      ct.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      yol(ct, [a, b, { x: b.x, y: b.y + h }, { x: a.x, y: a.y + h }]);
      ct.fill();
    };
    yan(d[0], d[3], I.gx < 0 ? -0.18 : -0.5);
    yan(d[1], d[2], I.gx < 0 ? -0.5 : -0.18);
    const r = uretec(31);
    ct.save();
    yol(ct, [d[3], d[2], { x: d[2].x, y: d[2].y + h }, { x: d[3].x, y: d[3].y + h }]);
    ct.clip();
    for (let i = 0; i < 22; i++) {
      const y = d[3].y + h * r();
      ct.strokeStyle = `rgba(0,0,0,${(0.05 + r() * 0.09).toFixed(3)})`;
      ct.lineWidth = 0.6 + r();
      ct.beginPath();
      ct.moveTo(d[3].x, y);
      ct.lineTo(d[2].x, y + (r() - 0.5) * 4);
      ct.stroke();
    }
    ct.restore();
  }

  function toprakCiz(ct, I) {
    const q = [yansit(0, 0), yansit(1, 0), yansit(1, 1), yansit(0, 1)];
    ct.save();
    yol(ct, q);
    ct.clip();
    const t1 = karis({ r: 98, g: 70, b: 47 }, I.sicak, I.guc * 0.8);
    const t2 = { r: 52, g: 36, b: 24 };
    const g = ct.createLinearGradient(0, q[0].y, 0, q[3].y);
    const a1 = ton(t2, 0.05), a3 = ton(t1, -0.18);
    g.addColorStop(0, `rgb(${a1.r},${a1.g},${a1.b})`);
    g.addColorStop(0.55, `rgb(${t1.r},${t1.g},${t1.b})`);
    g.addColorStop(1, `rgb(${a3.r},${a3.g},${a3.b})`);
    ct.fillStyle = g;
    ct.fill();
    // Kesekler milimetre uzayında dağıtılıp izdüşürülüyor: derinlik
    // toprakta da sürüyor, arkadaki kesek küçük.
    const r = uretec(20260905);
    const s = yatakSinir();
    for (let i = 0; i < 620; i++) {
      const uv = mmUV(s.x1 + r() * G.mmEn, s.y1 + r() * G.mmBoy);
      const p = yansit(uv.u, uv.v);
      const o = mmPx(uv.v);
      const rad = (2.5 + r() * 10) * o;
      ct.fillStyle = r() > 0.45 ? `rgba(0,0,0,${(0.05 + r() * 0.12).toFixed(3)})`
                                : `rgba(255,226,190,${(0.02 + r() * 0.05).toFixed(3)})`;
      ct.beginPath();
      ct.ellipse(p.x, p.y, rad, rad * 0.6, r() * 3, 0, Math.PI * 2);
      ct.fill();
    }
    ct.restore();
  }

  function alanCiz(ct) {
    const alanlar = (S.veri && S.veri.alanlar) || [];
    // Alan tanımlı DEĞİLSE toprağı işlenmiş göstermiyoruz: nerede
    // ekilebileceği bilinmiyor ve ekran bunu uydurmuyor.
    if (!alanlar.length) return;
    const q = [yansit(0, 0), yansit(1, 0), yansit(1, 1), yansit(0, 1)];
    ct.save();
    yol(ct, q);
    ct.clip();
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
      }
      ct.restore();
    });
    ct.restore();
  }

  function yasakCiz(ct) {
    ((S.veri && S.veri.bolgeler) || []).forEach((b) => {
      if (b.allow_if) return;
      const d = mmDortgen(sayi(b.x1 ?? b.x_min), sayi(b.y1 ?? b.y_min),
                          sayi(b.x2 ?? b.x_max), sayi(b.y2 ?? b.y_max));
      ct.save();
      yol(ct, d);
      ct.clip();
      ct.fillStyle = "rgba(224,82,82,0.10)";
      ct.fill();
      ct.strokeStyle = "rgba(224,82,82,0.26)";
      ct.lineWidth = 2;
      const k = d.reduce((a, p) => ({ x1: Math.min(a.x1, p.x), y1: Math.min(a.y1, p.y),
                                      x2: Math.max(a.x2, p.x), y2: Math.max(a.y2, p.y) }),
                         { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 });
      for (let x = k.x1 - (k.y2 - k.y1); x < k.x2; x += 12) {
        ct.beginPath(); ct.moveTo(x, k.y1); ct.lineTo(x + (k.y2 - k.y1), k.y2); ct.stroke();
      }
      ct.restore();
    });
  }

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
    const k1 = ton(tahta, -0.22);
    g.addColorStop(0, `rgb(${k1.r},${k1.g},${k1.b})`);
    g.addColorStop(1, `rgb(${tahta.r},${tahta.g},${tahta.b})`);
    ct.fillStyle = g;
    ct.fill("evenodd");
    ct.restore();
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
   * Bitki çizimleri — ÖNBELLEKLİ
   *
   * Her bitki bir kez küçük bir tuvale çiziliyor, sahneye tek
   * `drawImage` ile basılıyor. Anahtar: tür + arketip + olgunluk
   * kademesi + çap + hasat. Yirmi dört bitkilik yatakta kare başına
   * yüzlerce yol işlemi yerine yirmi dört kopyalama kalıyor.
   *
   * ÖLÇÜLEN NE, SÜS NE:
   *   · çap        → `yaricap_mm` (sunucunun çözdüğü o anki yarıçap)
   *   · kademe     → `olgunluk` (yaş / olgunluk süresi). Yoksa kademe
   *                  YOK: bitki nötr çiziliyor ve halkası "yaşı
   *                  bilinmiyor" diyor. Fide ile hasada hazır aynı
   *                  görünmüyor, çünkü ikisi de ölçülü.
   *   · meyve      → `hasat` (gerçekten olgunluk süresini doldurdu mu)
   *   · siluet     → türün adı; hangi bitkiye baktığını söylüyor
   *   · damar, ton, yaprak sapması → SÜS, hiçbir sayıya dönüşmüyor
   * ==================================================================== */
  const ARKETIP = {
    gulce: ["marul", "lettuce", "kivircik", "kıvırcık", "gobek", "göbek", "roka",
            "arugula", "ispanak", "spinach", "pazi", "pazı", "lahana", "cabbage",
            "brokoli", "broccoli", "karnabahar", "semizotu", "salata"],
    tuy: ["havuc", "havuç", "carrot", "dereotu", "dill", "rezene", "fennel",
          "maydanoz", "parsley", "kereviz", "turp", "radish", "pancar", "beet"],
    yuvarlak: ["fesleğen", "feslegen", "basil", "nane", "mint", "kekik", "thyme",
               "biberiye", "rosemary", "adaçayı", "adacayi", "reyhan"],
    cali: ["domates", "tomato", "biber", "pepper", "patlican", "patlıcan",
           "salatalik", "salatalık", "cucumber", "kabak", "bamya", "nohut", "patates"],
    serit: ["sogan", "soğan", "onion", "pirasa", "pırasa", "leek", "sarimsak",
            "sarımsak", "garlic", "misir", "mısır", "arpa", "bugday", "buğday"],
    uclu: ["cilek", "çilek", "strawberry", "fasulye", "bean", "bezelye", "pea",
           "yonca", "uzum", "üzüm"],
  };
  /* `dik` siluetin ne kadar yukarı gittiği, `boy` yüksekliğin yarıçapa
     oranı, `kok` toprak hizasında kök omzu. Üçü de SÜS: katalogda bitki
     yüksekliği yok, hiçbiri sayıya dönüşmüyor. */
  const SILUET = {
    gulce: { boy: 0.45, kok: false }, tuy: { boy: 1.70, kok: true },
    yuvarlak: { boy: 1.00, kok: false }, cali: { boy: 1.35, kok: false },
    serit: { boy: 1.85, kok: true }, uclu: { boy: 0.70, kok: false },
  };

  function arketip(b) {
    const ad = `${b.tur || ""} ${b.tur_ad || ""}`.toLowerCase();
    for (const [k, sozler] of Object.entries(ARKETIP)) {
      if (sozler.some((s) => ad.includes(s))) return k;
    }
    return "gulce";
  }

  /** Türün yaprak rengi. Kataloğun `color` alanı yaprak rengi DEĞİL —
   *  listede türü ayırt etmek için seçilmiş bir işaret rengi (çilek
   *  kırmızı). Yaprak yeşil kalıyor; ayrım tondan ve siluetten. */
  function yesil(tur) {
    const h = tohum(`${tur}-yaprak`);
    return hslRGB(84 + h * 56, 0.34 + tohum(`${tur}-d`) * 0.22, 0.34);
  }

  function yaprak(ct, uzun, genis, dip, uc, dalga, kayma) {
    const N = 12;
    const w = (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.58)), 0.72) * genis
      * (1 + (dalga ? 0.22 * Math.sin(t * Math.PI * 6 + kayma) : 0));
    ct.beginPath();
    ct.moveTo(0, 0);
    for (let i = 1; i <= N; i++) ct.lineTo(-w(i / N), -uzun * (i / N));
    for (let i = N; i >= 1; i--) ct.lineTo(w(i / N), -uzun * (i / N));
    ct.closePath();
    const g = ct.createLinearGradient(0, 0, 0, -uzun);
    g.addColorStop(0, rgba(dip, 0.97));
    g.addColorStop(1, rgba(uc, 0.97));
    ct.fillStyle = g;
    ct.fill();
    ct.strokeStyle = rgba(ton(dip, -0.45), 0.5);
    ct.lineWidth = Math.max(0.5, uzun * 0.018);
    ct.stroke();
  }

  function cizGulce(ct, R, c, k, faz) {
    const katlar = [
      { n: 8 + k * 2, u: R, t: -0.34, e: 0 },
      { n: 6 + k, u: R * 0.72, t: -0.04, e: 0.41 },
      { n: 4 + k, u: R * 0.45, t: 0.20, e: 1.07 },
    ];
    katlar.forEach((kat, ki) => {
      for (let i = 0; i < kat.n; i++) {
        const sapma = (tohum(`${ki}:${i}:${faz}`) - 0.5) * 0.4;
        ct.save();
        ct.rotate((Math.PI * 2 / kat.n) * i + faz * 6 + kat.e + sapma);
        ct.scale(1, 0.7);
        const u = kat.u * (0.82 + tohum(`u${ki}${i}${faz}`) * 0.28);
        yaprak(ct, u, u * 0.24, ton(c, kat.t - 0.16), ton(c, kat.t + 0.16), true, i);
        ct.restore();
      }
    });
    const g = ct.createRadialGradient(0, 0, R * 0.02, 0, 0, R * 0.5);
    g.addColorStop(0, "rgba(0,0,0,0.32)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ct.fillStyle = g;
    ct.beginPath();
    ct.ellipse(0, 0, R * 0.5, R * 0.36, 0, 0, Math.PI * 2);
    ct.fill();
  }

  function cizTuy(ct, R, c, k, faz, boy) {
    const n = 5 + k * 2;
    for (let i = 0; i < n; i++) {
      const y = (i / Math.max(1, n - 1) - 0.5) * 2;
      const a = y * 0.6 + (tohum(`t${i}${faz}`) - 0.5) * 0.2;
      const u = boy * (0.66 + tohum(`b${i}${faz}`) * 0.4);
      const renk = ton(c, -0.18 + (i % 3) * 0.14);
      const ux = Math.sin(a) * u * 0.42, uy = -Math.cos(a) * u;
      ct.strokeStyle = rgba(renk, 0.95);
      ct.lineWidth = Math.max(0.8, R * 0.055);
      ct.lineCap = "round";
      ct.beginPath();
      ct.moveTo(0, 0);
      ct.quadraticCurveTo(ux * 0.25, uy * 0.55, ux, uy);
      ct.stroke();
      ct.lineWidth = Math.max(0.5, R * 0.022);
      for (let j = 3; j <= 8; j++) {
        const o = j / 9;
        const bx = ux * o * (1.4 - o * 0.4), by = uy * o, tl = u * 0.16 * (1 - o * 0.55);
        ct.beginPath();
        ct.moveTo(bx, by); ct.lineTo(bx - tl, by - tl * 0.85);
        ct.moveTo(bx, by); ct.lineTo(bx + tl, by - tl * 0.85);
        ct.stroke();
      }
    }
  }

  function yuvarlakYaprak(ct, u, dip, uc) {
    const g = ct.createLinearGradient(0, 0, 0, -u);
    g.addColorStop(0, rgba(dip, 0.97));
    g.addColorStop(1, rgba(uc, 0.97));
    ct.fillStyle = g;
    ct.beginPath();
    ct.moveTo(0, 0);
    ct.bezierCurveTo(-u * 0.62, -u * 0.22, -u * 0.52, -u * 0.92, 0, -u);
    ct.bezierCurveTo(u * 0.52, -u * 0.92, u * 0.62, -u * 0.22, 0, 0);
    ct.fill();
    ct.strokeStyle = rgba(ton(dip, -0.45), 0.5);
    ct.lineWidth = Math.max(0.5, u * 0.03);
    ct.stroke();
  }

  function cizYuvarlak(ct, R, c, k, faz, boy) {
    const kol = 3 + k;
    for (let i = 0; i < kol; i++) {
      const u = boy * (0.66 + tohum(`y${i}${faz}`) * 0.36);
      ct.save();
      ct.rotate((i - kol / 2) * 0.36 + faz);
      ct.strokeStyle = rgba(ton(c, -0.45), 0.95);
      ct.lineWidth = Math.max(0.8, R * 0.06);
      ct.beginPath();
      ct.moveTo(0, 0);
      ct.lineTo(0, -u);
      ct.stroke();
      [[-1, 0.5], [1, 0.5], [-1, 0.85], [1, 0.85]].forEach((p, j) => {
        ct.save();
        ct.translate(0, -u * p[1]);
        ct.rotate(p[0] * 1.2);
        yuvarlakYaprak(ct, u * 0.34, ton(c, -0.24 + (j % 2) * 0.18), ton(c, 0.16));
        ct.restore();
      });
      ct.save();
      ct.translate(0, -u);
      yuvarlakYaprak(ct, u * 0.3, ton(c, -0.16), ton(c, 0.22));
      ct.restore();
      ct.restore();
    }
  }

  function cizCali(ct, R, c, k, faz, boy, hasat, aksan) {
    const kat = 3 + k;
    const govde = boy * 0.78;
    ct.strokeStyle = rgba(ton(c, -0.55), 0.95);
    ct.lineWidth = Math.max(1.2, R * 0.07);
    ct.lineCap = "round";
    ct.beginPath();
    ct.moveTo(0, 0);
    ct.quadraticCurveTo(R * 0.06, -govde * 0.5, 0, -govde);
    ct.stroke();
    for (let i = 0; i < kat; i++) {
      const h = govde * (0.28 + (i / kat) * 0.68);
      [-1, 1].forEach((yon, j) => {
        const u = boy * (0.32 + tohum(`c${i}${j}${faz}`) * 0.2);
        ct.save();
        ct.translate(0, -h);
        ct.rotate(yon * (0.75 + tohum(`r${i}${j}`) * 0.35) - yon * 0.35);
        ct.scale(1, 0.82);
        [-0.6, 0, 0.6].forEach((kk, m) => {
          ct.save();
          ct.rotate(kk);
          yaprak(ct, u * (m === 1 ? 1 : 0.74), u * 0.3,
                 ton(c, -0.3), ton(c, 0.1), false, m);
          ct.restore();
        });
        ct.restore();
      });
    }
    if (hasat) {
      for (let i = 0; i < 3; i++) {
        const h = govde * (0.42 + i * 0.2), yan = (i % 2 ? 1 : -1) * R * 0.3;
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

  function cizSerit(ct, R, c, k, faz, boy) {
    const n = 4 + k;
    for (let i = 0; i < n; i++) {
      const y = (i / Math.max(1, n - 1) - 0.5) * 2;
      const a = y * 0.46 + (tohum(`s${i}${faz}`) - 0.5) * 0.16;
      const u = boy * (0.72 + tohum(`sb${i}${faz}`) * 0.4);
      const renk = ton(c, i % 2 ? -0.26 : 0.04);
      const ux = Math.sin(a) * u * 0.4, uy = -Math.cos(a) * u, gen = R * 0.13;
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

  function cizUclu(ct, R, c, k, faz, hasat, aksan) {
    const kume = 3 + k;
    const ucluCiz = (u) => {
      [-0.78, 0, 0.78].forEach((kk, j) => {
        ct.save();
        ct.rotate(kk);
        yaprak(ct, u * (j === 1 ? 1 : 0.82), u * 0.44,
               ton(c, -0.28), ton(c, 0.14), true, j);
        ct.restore();
      });
    };
    ct.save(); ct.scale(1, 0.7); ct.rotate(faz * 6); ucluCiz(R * 0.42); ct.restore();
    for (let i = 0; i < kume; i++) {
      ct.save();
      ct.rotate((Math.PI * 2 / kume) * i + faz * 6);
      ct.scale(1, 0.7);
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
        ct.ellipse(mx, my, R * 0.13, R * 0.15, 0, 0, Math.PI * 2);
        ct.fill();
      }
    }
  }

  function kokCiz(ct, R, aksan) {
    const g = ct.createLinearGradient(0, -R * 0.14, 0, R * 0.1);
    g.addColorStop(0, rgba(ton(aksan, 0.2), 0.95));
    g.addColorStop(1, rgba(ton(aksan, -0.35), 0.95));
    ct.fillStyle = g;
    ct.beginPath();
    ct.ellipse(0, 0, R * 0.26, R * 0.13, 0, 0, Math.PI * 2);
    ct.fill();
  }

  /** Bitkinin önbellekli çizimi. */
  function spriteAl(b) {
    const anahtar = `${b.tur}|${b.tip}|${b.kademe}|${b.capQ}|${b.hasat ? 1 : 0}`;
    const hazir = S.sprite.get(anahtar);
    if (hazir) return hazir;
    const R = b.capQ / 2;
    const s = SILUET[b.tip] || SILUET.gulce;
    const boy = R * s.boy * YUKSEKLIK_ORANI * 1.5;
    // Tuval yaprakların taşmasına yer bırakıyor; çapa göre değil, gerçek
    // silüet yüksekliğine göre.
    const en = Math.ceil(R * 2.4);
    const yuk = Math.ceil(R * 1.3 + boy * 1.15);
    const t = document.createElement("canvas");
    t.width = Math.max(4, Math.ceil(en * S.dpr));
    t.height = Math.max(4, Math.ceil(yuk * S.dpr));
    const ct = t.getContext("2d");
    ct.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    // Çapa (0,0) bitkinin toprağa değdiği nokta olacak şekilde.
    const ax = en / 2, ay = yuk - R * 0.6;
    ct.translate(ax, ay);
    const c = yesil(b.tur);
    const aksan = b.aksan;
    // Kademe: olgunluk bilinmiyorsa 2 (orta) ama bitki bunu ayrıca
    // söylüyor — halkası "yaşı bilinmiyor" diyor.
    const k = b.kademe === null ? 2 : b.kademe;
    if (s.kok) kokCiz(ct, R, aksan);
    if (b.tip === "tuy") cizTuy(ct, R, c, k, b.faz, boy);
    else if (b.tip === "yuvarlak") cizYuvarlak(ct, R, c, k, b.faz, boy);
    else if (b.tip === "cali") cizCali(ct, R, c, k, b.faz, boy, b.hasat, aksan);
    else if (b.tip === "serit") cizSerit(ct, R, c, k, b.faz, boy);
    else if (b.tip === "uclu") cizUclu(ct, R, c, k, b.faz, b.hasat, aksan);
    else cizGulce(ct, R, c, k, b.faz);
    const kayit = { tuval: t, en, boy: yuk, ax, ay };
    // Önbellek sınırsız büyümesin: tür × kademe × çap sayısı sınırlı ama
    // pencere sürekli değişirse çap kademesi de değişiyor.
    if (S.sprite.size > 160) S.sprite.clear();
    S.sprite.set(anahtar, kayit);
    return kayit;
  }

  /* ==================================================================== *
   * Veriden çizime
   * ==================================================================== */
  const KADEME = 5;                    // olgunluk kaç kademeye bölünüyor

  function bitkileriHazirla() {
    const liste = (S.veri && S.veri.bitkiler) || [];
    const eski = S.bitkiIx || {};
    const simdi = (performance.now() - S.t0) / 1000;
    S.bitki = liste.map((b) => {
      const uv = mmUV(b.x, b.y);
      const p = yansit(uv.u, uv.v);
      const o = mmPx(uv.v);
      const capPx = sayi(b.yaricap_mm) * 2 * o;
      // Çap dört piksellik kademelere yuvarlanıyor: önbellek anahtarı
      // her pencere kıpırdadığında değişmesin.
      const capQ = Math.max(26, Math.round(kis(capPx, 26, G.enPx * 0.5) / 4) * 4);
      const olg = (b.olgunluk == null || b.yas_gun == null) ? null
        : kis(sayi(b.olgunluk), 0, 1);
      const onceki = eski[b.ad];
      return {
        ad: b.ad, tur: b.tur, tur_ad: b.tur_ad || b.tur, renk: b.renk,
        x: p.x, y: p.y, u: uv.u, v: uv.v, capPx, capQ,
        olgunluk: olg,
        kademe: olg === null ? null : Math.min(KADEME - 1, Math.floor(olg * KADEME)),
        yas_gun: b.yas_gun, olgun_gun: b.olgun_gun,
        hasat: !!b.hasat, susadi: !!b.susadi, tahmin: !!b.su_tahmin,
        cakisik: !!b.cakisik, olcum: b.su_olcum || {},
        gerekce: b.su_gerekce || "", sulama_ts: b.sulama_ts, ekim: b.ekim,
        sulama_saniye: sayi(b.sulama_saniye, 3),
        tip: arketip(b), faz: tohum(b.ad), aksan: hexRGB(b.renk || "#7bbf5a"),
        vurgu: onceki ? onceki.vurgu : 0,
        bas: onceki ? onceki.bas : 0,
        // Yeni gelen bitki beliriyor: ekimden sonra birdenbire var
        // olması "oldu mu olmadı mı" sorusunu bırakıyordu.
        dogus: onceki ? onceki.dogus : simdi,
      };
    }).sort((a, b) => a.v - b.v);          // ressam: arkadakiler önce
    S.bitkiIx = {};
    S.bitki.forEach((b) => { S.bitkiIx[b.ad] = b; });
    kirlet();
  }

  function kirlet() { S.kirli = true; uyandir(); }

  /* ------------------------------------------------------------ rozet
   * Bitkinin durumu — HER ZAMAN görünür, çünkü ekranın işi bunu
   * söylemek. Ölçülen nem DOLU bir yay; ölçülmemiş olan içi boş kesikli
   * bir halka ve ortasında soru işareti. İkisi karışmasın diye biçim
   * farklı, yalnız renk değil. */
  function rozetCiz(ct, b) {
    const o = b.olcum || {};
    const r = 11;
    const x = b.x + b.capQ * 0.34 + 6;
    const y = b.y - yukPx(16, b.v) - b.capQ * 0.30 - 6;
    const kendi = !!(o.var && o.kendi);
    ct.save();
    ct.translate(x, y);
    ct.fillStyle = "rgba(16,18,15,0.82)";
    ct.beginPath();
    ct.arc(0, 0, r + 2.5, 0, Math.PI * 2);
    ct.fill();
    if (kendi) {
      const yuzde = kis(sayi(o.yuzde, 0), 0, 100);
      const esik = o.esik_acik ? kis(sayi(o.esik, 0), 0, 100) : null;
      const az = esik != null && yuzde < esik;
      // Solukluk ÖLÇÜMÜN YAŞI: dünkü okuma bugünkü kadar güvenilir
      // değil ve ekranda da öyle görünmemeli.
      const yas = kis(sayi(o.yas_sn, 0) / (sayi(o.azami_yas_sn, 86400) || 86400), 0, 1);
      ct.globalAlpha = o.bayat ? 0.4 : 1 - 0.6 * yas;
      ct.strokeStyle = "rgba(255,255,255,0.14)";
      ct.lineWidth = 3;
      ct.beginPath(); ct.arc(0, 0, r - 2, 0, Math.PI * 2); ct.stroke();
      ct.strokeStyle = az ? "#e8a33c" : "#4caf50";
      ct.lineWidth = 3;
      ct.beginPath();
      ct.arc(0, 0, r - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (yuzde / 100));
      ct.stroke();
      if (esik != null) {
        const a = (esik / 100) * Math.PI * 2 - Math.PI / 2;
        ct.strokeStyle = "#f2f2ee";
        ct.lineWidth = 1.6;
        ct.beginPath();
        ct.moveTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5));
        ct.lineTo(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1));
        ct.stroke();
      }
      ct.globalAlpha = 1;
      ct.fillStyle = "#f2f2ee";
      ct.font = "600 9px system-ui, sans-serif";
      ct.textAlign = "center";
      ct.textBaseline = "middle";
      ct.fillText(String(Math.round(yuzde)), 0, 0.5);
    } else {
      // KENDİ ÖLÇÜMÜ YOK: halka doldurulmuyor. Sunucu komşudan bir
      // okuma ödünç verebiliyor ama onu dolu halka yapmak, ölçmediğimiz
      // bir şeyi ölçmüş gibi sunmak olurdu.
      ct.setLineDash([3, 3]);
      ct.strokeStyle = "#82847a";
      ct.lineWidth = 2;
      ct.beginPath(); ct.arc(0, 0, r - 2, 0, Math.PI * 2); ct.stroke();
      ct.setLineDash([]);
      ct.fillStyle = "#a8aa9e";
      ct.font = "600 11px system-ui, sans-serif";
      ct.textAlign = "center";
      ct.textBaseline = "middle";
      ct.fillText("?", 0, 0.5);
    }
    ct.restore();

    // Susama ve hasat: rozetin yanında küçük işaretler.
    let ix = x + r + 9;
    if (b.susadi) {
      ct.save();
      ct.translate(ix, y);
      ct.beginPath();
      ct.moveTo(0, -6); ct.quadraticCurveTo(4.5, 0.5, 0, 5);
      ct.quadraticCurveTo(-4.5, 0.5, 0, -6);
      // TAHMİN içi boş: ölçülmüş bir kararla aynı görünmesin.
      if (b.tahmin) {
        ct.setLineDash([2, 2]); ct.strokeStyle = "#4fb8e8"; ct.lineWidth = 1.2;
        ct.stroke(); ct.setLineDash([]);
      } else { ct.fillStyle = "#4fb8e8"; ct.fill(); }
      ct.restore();
      ix += 12;
    }
    if (b.hasat) {
      ct.save();
      ct.translate(ix, y);
      ct.strokeStyle = "#8fd27a";
      ct.lineWidth = 1.6;
      ct.beginPath();
      ct.moveTo(-5, -2); ct.lineTo(5, -2); ct.lineTo(3.5, 5); ct.lineTo(-3.5, 5);
      ct.closePath();
      ct.stroke();
      ct.restore();
    }
  }

  /* ------------------------------------------------------------ bitki */
  function bitkiCiz(ct, b, t, I) {
    const R = b.capQ / 2;
    // Gölge — yön güneşten, boy güneşin yüksekliğinden.
    ct.save();
    ct.globalAlpha = 0.18 + I.gunduz * 0.16;
    ct.fillStyle = "#000";
    ct.beginPath();
    ct.ellipse(b.x + I.gx * R * 0.4 * I.boy, b.y + R * 0.12,
               R * 0.8 * I.boy, R * 0.3, 0, 0, Math.PI * 2);
    ct.fill();
    ct.restore();

    // YAYILIM HALKASI — ölçülen çap. Komşusuyla çakışıyorsa sarı.
    if (b.capPx > 26) {
      ct.save();
      ct.setLineDash([5, 7]);
      ct.strokeStyle = b.cakisik ? "rgba(217,165,32,0.45)" : "rgba(255,255,255,0.10)";
      ct.lineWidth = 1;
      ct.beginPath();
      ct.ellipse(b.x, b.y, b.capPx / 2, b.capPx / 2 * 0.66, 0, 0, Math.PI * 2);
      ct.stroke();
      ct.restore();
    }
    // Görev kartına gelince o kartın bitkileri işaretleniyor: "hangileri"
    // sorusunun cevabı yazıyla değil, yatakta.
    if (S.isVurgu && S.isVurgu.has(b.ad)) {
      ct.save();
      ct.strokeStyle = "rgba(120,200,255,0.85)";
      ct.lineWidth = 2.2;
      ct.setLineDash([8, 7]);
      ct.beginPath();
      ct.ellipse(b.x, b.y, R * 1.28, R * 0.85, 0, 0, Math.PI * 2);
      ct.stroke();
      ct.restore();
    }
    if (b.vurgu > 0.01) {
      const g = ct.createRadialGradient(b.x, b.y, R * 0.1, b.x, b.y, R * 1.3);
      g.addColorStop(0, `rgba(255,246,214,${(0.24 * b.vurgu).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,246,214,0)");
      ct.fillStyle = g;
      ct.beginPath();
      ct.ellipse(b.x, b.y, R * 1.3, R * 0.9, 0, 0, Math.PI * 2);
      ct.fill();
    }

    const sp = spriteAl(b);
    // Beliriş, kalkma ve ezilme tek bir ölçekte toplanıyor: üç ayrı
    // dönüşüm zinciri kurmak kare başına üç `save/restore` demekti.
    const yas = t - b.dogus;
    const dog = yas < 0.55 ? 0.25 + 0.75 * asma(yas / 0.55) : 1;
    const olcek = dog * (1 + b.vurgu * 0.05 + b.bas * 0.06);
    const olcekY = dog * (1 + b.vurgu * 0.05 - b.bas * 0.12);
    const kalk = b.vurgu * R * 0.16;
    ct.save();
    ct.translate(b.x, b.y - yukPx(16, b.v) - kalk);
    if (olcek !== 1 || olcekY !== 1) ct.scale(olcek, olcekY);
    ct.drawImage(sp.tuval, -sp.ax, -sp.ay, sp.en, sp.boy);
    ct.restore();
  }

  /* ------------------------------------------------------------ makine */
  const KOPRU_MM = 330;
  function robotHedef() {
    const k = (S.veri && S.veri.konum) || {};
    if (!(S.veri || {}).bagli || k.x == null || k.y == null) return null;
    return { x: sayi(k.x), y: sayi(k.y), z: k.z == null ? null : sayi(k.z) };
  }
  function robotYurut(dt) {
    const h = robotHedef();
    const R = S.robot;
    if (!h) { R.var = false; return; }
    if (!R.var) { R.hx = h.x; R.hy = h.y; R.hz = h.z; R.var = true; kirlet(); return; }
    const k = 1 - Math.exp(-dt / 0.09);
    const dx = h.x - R.hx, dy = h.y - R.hy;
    if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) kirlet();
    R.hx += dx * k; R.hy += dy * k;
    if (h.z != null) R.hz = R.hz == null ? h.z : R.hz + (h.z - R.hz) * k;
  }
  function aktifBasKimlik() {
    const v = S.veri || {};
    const c = (v.kuyruk || {}).calisan;
    return c ? String((v.is_basi || {})[c.tip] || "") : "";
  }
  function aktifBas() {
    const k = aktifBasKimlik();
    if (!k) return null;
    const b = ((S.veri || {}).baslar || {})[k];
    return b ? Object.assign({ kimlik: k }, b) : null;
  }
  /** Ucun toprağın üstündeki yüksekliği — ÖLÇÜLEN z'den. Yoksa null ve
   *  iniş çizilmiyor; canlandırmak olmayan bir ölçümü çizmek olurdu. */
  function ucYuk() {
    const v = S.veri || {};
    if (S.robot.hz == null || v.toprak_z == null) return null;
    return Math.max(0, sayi(S.robot.hz) - sayi(v.toprak_z));
  }

  function makineCiz(ct, t, I) {
    const R = S.robot;
    if (!R.var || !G.ileri) return;
    const uv = mmUV(R.hx, R.hy);
    if (uv.v < -0.5 || uv.v > 1.5) return;
    const o = mmPx(kis(uv.v, 0, 1));
    const kopruY = yukPx(KOPRU_MM, uv.v);
    const solA = yansit(-0.06, uv.v), sagA = yansit(1.06, uv.v);
    const kizakA = yansit(kis(uv.u, -0.06, 1.06), uv.v);
    ct.save();
    ct.globalAlpha = 0.18 + I.gunduz * 0.16;
    ct.strokeStyle = "#000";
    ct.lineWidth = Math.max(4, 26 * o);
    ct.beginPath();
    ct.moveTo(solA.x + I.gx * kopruY * 0.3, solA.y + 6 * o);
    ct.lineTo(sagA.x + I.gx * kopruY * 0.3, sagA.y + 6 * o);
    ct.stroke();
    ct.restore();

    const sol = { x: solA.x, y: solA.y - kopruY };
    const sag = { x: sagA.x, y: sagA.y - kopruY };
    const kizak = { x: kizakA.x, y: kizakA.y - kopruY };
    ct.strokeStyle = "#5b6169";
    ct.lineWidth = Math.max(3, 22 * o);
    [[sol, solA], [sag, sagA]].forEach(([a, b]) => {
      ct.beginPath(); ct.moveTo(a.x, a.y); ct.lineTo(b.x, b.y); ct.stroke();
    });
    const kalin = Math.max(5, 32 * o);
    const g = ct.createLinearGradient(0, sol.y - kalin / 2, 0, sol.y + kalin / 2);
    g.addColorStop(0, "#c3cad2"); g.addColorStop(0.45, "#8b939c"); g.addColorStop(1, "#4d545b");
    ct.strokeStyle = g;
    ct.lineWidth = kalin;
    ct.lineCap = "round";
    ct.beginPath(); ct.moveTo(sol.x, sol.y); ct.lineTo(sag.x, sag.y); ct.stroke();

    const kw = Math.max(14, 74 * o), kh = Math.max(11, 56 * o);
    ct.fillStyle = "#2f353b";
    yuvarlakKutu(ct, kizak.x - kw / 2, kizak.y - kh / 2, kw, kh, Math.max(2, 6 * o));
    ct.fill();

    const bas = aktifBas();
    const tip = ((S.veri.kuyruk || {}).calisan || {}).tip || "";
    if (!bas) return;
    const np = { x: R.hx - sayi(bas.dx), y: R.hy - sayi(bas.dy) };
    const nuv = mmUV(np.x, np.y);
    const yer = yansit(nuv.u, nuv.v);
    const yuk = ucYuk();
    const ucY = yuk == null ? yer.y - kopruY : yer.y - yukPx(yuk, nuv.v);
    ct.strokeStyle = "#9aa2aa";
    ct.lineWidth = Math.max(2, 11 * o);
    ct.beginPath(); ct.moveTo(kizak.x, kizak.y); ct.lineTo(yer.x, ucY); ct.stroke();
    if (tip === "sula") suCiz(ct, yer, ucY, o, t);
    else if (tip === "nem") probCiz(ct, yer, ucY, o);
    else if (tip === "ek") tohumDusCiz(ct, yer, ucY, o, t);
    ct.fillStyle = tip === "sula" ? "#4fb8e8" : tip === "nem" ? "#d9a520"
                 : tip === "ek" ? "#8fd27a" : "#cfd6dd";
    ct.beginPath();
    ct.arc(yer.x, ucY, Math.max(3, 10 * o), 0, Math.PI * 2);
    ct.fill();
  }

  /* Su, prob ve tohum: "işi çalışıyor" ölçütüyle çiziliyor. Röle durumu
     `olcum` paketinde ve beş saniyede bir geliyor; üç saniyelik bir
     sulamayı tamamen kaçırırdı. */
  function suCiz(ct, yer, ucY, o, t) {
    const boy = yer.y - ucY;
    if (boy <= 2) return;
    for (let i = 0; i < 5; i++) {
      const f = (t * 1.5 + i * 0.2) % 1;
      ct.globalAlpha = 1 - f * 0.7;
      ct.fillStyle = "#4fb8e8";
      ct.beginPath();
      ct.ellipse(yer.x + (i - 2) * 1.6 * o, ucY + boy * f,
                 Math.max(1.2, 4 * o), Math.max(2, 8 * o), 0, 0, Math.PI * 2);
      ct.fill();
    }
    ct.globalAlpha = 1;
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
    ct.lineTo(yer.x, yer.y + Math.max(2, 10 * o));
    ct.stroke();
  }
  function tohumDusCiz(ct, yer, ucY, o, t) {
    const boy = yer.y - ucY, f = (t * 0.9) % 1;
    ct.fillStyle = "#d9c08a";
    ct.beginPath();
    ct.ellipse(yer.x, ucY + boy * f, Math.max(1.5, 5 * o), Math.max(2, 6 * o),
               0, 0, Math.PI * 2);
    ct.fill();
  }

  /* -------------------------------------------------------------- yol */
  function yolDuraklar() {
    const k = (S.veri || {}).kuyruk || {};
    const cikti = [];
    ((k.isler) || []).forEach((i) => {
      if (i.durum !== "calisiyor" && i.durum !== "bekliyor") return;
      (i.noktalar || []).forEach((ad) => {
        const b = S.bitkiIx[ad];
        if (b) cikti.push({ x: b.x, y: b.y, tip: i.tip, calisan: i.durum === "calisiyor" });
      });
    });
    return cikti;
  }
  function yolCiz(ct, t) {
    if (!(S.veri || {}).bagli) return;
    const d = yolDuraklar();
    if (!d.length) return;
    const n = [];
    if (S.robot.var) {
      const uv = mmUV(S.robot.hx, S.robot.hy);
      n.push(yansit(kis(uv.u, -0.1, 1.1), kis(uv.v, -0.1, 1.1)));
    }
    d.forEach((p) => n.push(p));
    if (n.length < 2) return;
    ct.save();
    ct.lineCap = "round"; ct.lineJoin = "round";
    ct.strokeStyle = "rgba(0,0,0,0.35)";
    ct.lineWidth = 5;
    ct.beginPath();
    n.forEach((p, i) => (i ? ct.lineTo(p.x, p.y) : ct.moveTo(p.x, p.y)));
    ct.stroke();
    ct.strokeStyle = "rgba(160,215,255,0.85)";
    ct.lineWidth = 2.2;
    ct.setLineDash([10, 9]);
    ct.lineDashOffset = -t * 34;
    ct.beginPath();
    n.forEach((p, i) => (i ? ct.lineTo(p.x, p.y) : ct.moveTo(p.x, p.y)));
    ct.stroke();
    ct.setLineDash([]);
    d.forEach((p, i) => {
      ct.fillStyle = "rgba(16,18,15,0.88)";
      ct.beginPath();
      ct.arc(p.x, p.y, p.calisan ? 11 : 9, 0, Math.PI * 2);
      ct.fill();
      ct.strokeStyle = { sula: "#4fb8e8", nem: "#d9a520", ek: "#8fd27a" }[p.tip] || "#9aa2aa";
      ct.lineWidth = p.calisan ? 2.6 : 1.8;
      ct.stroke();
      ct.fillStyle = "#f2f2ee";
      ct.font = "600 10px system-ui, sans-serif";
      ct.textAlign = "center"; ct.textBaseline = "middle";
      ct.fillText(String(i + 1), p.x, p.y + 0.5);
    });
    ct.textAlign = "start"; ct.textBaseline = "alphabetic";
    ct.restore();
  }

  /* ------------------------------------------------------------ zerre */
  function zerreAt(tip, x, y, adet, renk, olcek) {
    if (S.sakin) return;
    const t = (performance.now() - S.t0) / 1000;
    for (let i = 0; i < adet; i++) {
      const a = Math.random() * Math.PI * 2, h = 0.4 + Math.random() * 0.9;
      S.zerre.push({
        tip, x, y, renk,
        vx: Math.cos(a) * (tip === "toz" ? 26 : 14) * h * olcek,
        vy: tip === "toz" ? Math.sin(a) * 11 * h * olcek - 6 * olcek
                          : -(34 + Math.random() * 42),
        t0: t, sure: (tip === "toz" ? 0.55 : 0.9) + Math.random() * 0.45,
        r: (tip === "toz" ? 2.5 + Math.random() * 4 : 1.6 + Math.random() * 2.2) * olcek,
      });
    }
    uyandir();
  }
  function zerreCiz(ct, t) {
    if (!S.zerre.length) return;
    S.zerre = S.zerre.filter((p) => t - p.t0 < p.sure);
    S.zerre.forEach((p) => {
      const g = t - p.t0, o = g / p.sure, sol = 1 - yumusak(o);
      ct.globalAlpha = sol * (p.tip === "toz" ? 0.55 : 0.9);
      ct.fillStyle = p.renk;
      if (p.tip === "toz") {
        ct.beginPath();
        ct.ellipse(p.x + p.vx * yumusak(o), p.y + p.vy * yumusak(o),
                   p.r * (1 + o * 1.5), p.r * (1 + o * 1.2) * 0.6, 0, 0, Math.PI * 2);
        ct.fill();
      } else {
        ct.beginPath();
        ct.arc(p.x + p.vx * g, p.y + p.vy * g + 26 * g * g, p.r * (1 - o * 0.4),
               0, Math.PI * 2);
        ct.fill();
      }
    });
    ct.globalAlpha = 1;
  }

  /* ------------------------------------------------------------ gözler */
  function gozleriCiz(ct, t) {
    const g = S.gozler;
    if (!g || !g.yerler || !g.yerler.length) return;
    const q = [yansit(0, 0), yansit(1, 0), yansit(1, 1), yansit(0, 1)];
    const cap = Math.max(16, sayi(g.yayilim_mm));
    const yas = t - S.gozT0;
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
    const secili = S.onizleme && S.onizleme.goz ? S.onizleme : null;
    g.yerler.forEach((yer, i) => {
      const gel = yas < i * 0.02 ? 0 : asma(kis((yas - i * 0.02) / 0.34, 0, 1));
      if (gel <= 0) return;
      const uv = mmUV(yer.x, yer.y);
      const p = yansit(uv.u, uv.v);
      const yakin = secili && Math.abs(secili.x - yer.x) < 0.5
                    && Math.abs(secili.y - yer.y) < 0.5;
      const r = (cap / 2) * mmPx(uv.v) * gel * (yakin ? 1.06 : 1);
      const ic = ct.createRadialGradient(p.x, p.y - r * 0.1, r * 0.05, p.x, p.y, r);
      ic.addColorStop(0, `rgba(0,0,0,${yakin ? 0.16 : 0.28})`);
      ic.addColorStop(1, `rgba(255,240,200,${yakin ? 0.26 : 0.10})`);
      ct.fillStyle = ic;
      ct.beginPath();
      ct.ellipse(p.x, p.y, r, r * 0.66, 0, 0, Math.PI * 2);
      ct.fill();
      ct.strokeStyle = `rgba(150,220,130,${yakin ? 0.9 : 0.4})`;
      ct.lineWidth = yakin ? 2.4 : 1.5;
      ct.setLineDash([6, 6]);
      ct.beginPath();
      ct.ellipse(p.x, p.y, r, r * 0.66, 0, 0, Math.PI * 2);
      ct.stroke();
      ct.setLineDash([]);
    });
  }

  function onizlemeCiz(ct) {
    const o = S.onizleme;
    const tur = turBul(S.secilenTur);
    if (!o || !tur) return;
    const uv = mmUV(o.x, o.y);
    const p = yansit(uv.u, uv.v);
    const r = Math.max(14, (sayi(tur.yayilim_mm) / 2) * mmPx(uv.v));
    if (o.cakisan) {
      const cuv = mmUV(o.cakisan.x, o.cakisan.y);
      const cp = yansit(cuv.u, cuv.v);
      const cr = sayi(o.cakisan.yaricap_mm) * mmPx(cuv.v);
      ct.strokeStyle = "rgba(224,82,82,0.75)";
      ct.lineWidth = 2;
      ct.beginPath();
      ct.ellipse(cp.x, cp.y, cr, cr * 0.66, 0, 0, Math.PI * 2);
      ct.stroke();
    }
    ct.save();
    ct.strokeStyle = o.ok ? "rgba(150,220,130,0.95)" : "rgba(224,82,82,0.95)";
    ct.fillStyle = o.ok ? "rgba(150,220,130,0.14)" : "rgba(224,82,82,0.14)";
    ct.lineWidth = 2;
    ct.beginPath();
    ct.ellipse(p.x, p.y, r, r * 0.66, 0, 0, Math.PI * 2);
    ct.fill();
    ct.stroke();
    ct.restore();
  }

  /* ------------------------------------------------------------ etiket
   * Yalnız ÜZERİNE GELİNEN bitkinin künyesi. Hepsini birden yazmak
   * yatağı kutu tarlasına çeviriyordu; durum zaten rozette. */
  function etiketCiz(ct) {
    const b = S.bitkiIx[S.uzerinde] || S.bitkiIx[S.menuAd];
    if (!b) return;
    const o = b.olcum || {};
    const ust = b.tur_ad;
    const alt = o.var && o.kendi
      ? `nem %${Math.round(sayi(o.yuzde))} · ${sureKisa(o.yas_sn)} önce`
      : (o.var ? `%${Math.round(sayi(o.yuzde))} ödünç okuma · kendi ölçümü yok`
               : "nemi ölçülmedi");
    const yas = b.yas_gun == null ? "yaşı bilinmiyor"
      : `${Math.round(sayi(b.yas_gun))} günlük`;
    ct.font = "600 12px system-ui, sans-serif";
    const w1 = ct.measureText(ust).width;
    ct.font = "11px system-ui, sans-serif";
    const w2 = Math.max(ct.measureText(alt).width, ct.measureText(yas).width);
    const en = Math.round(Math.max(w1, w2) + 22), boy = 46;
    let x = Math.round(b.x - en / 2);
    let y = Math.round(b.y - yukPx(16, b.v) - b.capQ * 0.55 - boy - 14);
    x = kis(x, 6, Math.max(6, S.en - en - 6));
    if (y < 6) y = 6;
    ct.save();
    ct.shadowColor = "rgba(0,0,0,0.45)";
    ct.shadowBlur = 12;
    ct.shadowOffsetY = 3;
    ct.fillStyle = "rgba(22,24,20,0.86)";
    yuvarlakKutu(ct, x, y, en, boy, 10);
    ct.fill();
    ct.restore();
    ct.fillStyle = rgba(b.aksan, 0.95);
    ct.beginPath();
    ct.arc(x + 11, y + 15, 3.2, 0, Math.PI * 2);
    ct.fill();
    ct.textBaseline = "top";
    ct.fillStyle = "#f4f2ea";
    ct.font = "600 12px system-ui, sans-serif";
    ct.fillText(ust, x + 20, y + 8);
    ct.font = "11px system-ui, sans-serif";
    ct.fillStyle = o.var && o.kendi ? "#c8c9bf" : "#8f9188";
    ct.fillText(alt, x + 11, y + 24);
    ct.fillStyle = "#82847a";
    ct.fillText(yas, x + 11, y + 37);
  }

  /* ==================================================================== *
   * Çizim döngüsü
   *
   * Sahne yalnız KİRLİYSE çiziliyor; döngü yalnız CANLI bir hareket
   * varken dönüyor. Hiçbir şey olmuyorsa saniyede sıfır kare.
   * ==================================================================== */
  function canliMi() {
    if (S.zerre.length) return true;
    if (S.gozler && S.gozler.yerler && S.gozler.yerler.length) {
      if ((performance.now() - S.t0) / 1000 - S.gozT0 < 1.2) return true;
    }
    const h = robotHedef();
    if (h && S.robot.var
        && (Math.abs(h.x - S.robot.hx) > 0.2 || Math.abs(h.y - S.robot.hy) > 0.2)) return true;
    if ((S.veri || {}).kuyruk && (S.veri.kuyruk.calisan)) return true;   // su/prob akıyor
    if (yolDuraklar().length) return true;                              // yol akıyor
    for (const b of S.bitki) {
      const hv = b.ad === S.uzerinde || b.ad === S.menuAd ? 1 : 0;
      const hb = b.ad === S.basili ? 1 : 0;
      if (Math.abs(b.vurgu - hv) > 0.004 || Math.abs(b.bas - hb) > 0.004) return true;
      if ((performance.now() - S.t0) / 1000 - b.dogus < 0.6) return true;
    }
    return false;
  }

  const ciz = guvenli("çizim", function () {
    const ct = S.sahneCt;
    if (!ct || !S.en || !S.boy || !G.ileri) return;
    const bas = performance.now();
    const t = (bas - S.t0) / 1000;
    const dt = kis((bas - (S.sonKare || bas)) / 1000, 0, 0.25);
    S.sonKare = bas;
    const I = isik();

    robotYurut(dt);
    // Vurgu ve basma yumuşatması — geri bildirim 100 ms'den önce
    // görünmeli, o yüzden basma 40 ms'de iniyor.
    S.bitki.forEach((b) => {
      const hv = b.ad === S.uzerinde || b.ad === S.menuAd ? 1 : 0;
      const hb = b.ad === S.basili ? 1 : 0;
      b.vurgu += (hv - b.vurgu) * (1 - Math.exp(-dt / 0.09));
      b.bas += (hb - b.bas) * (1 - Math.exp(-dt / (hb ? 0.04 : 0.11)));
      if (Math.abs(b.vurgu - hv) < 0.004) b.vurgu = hv;
      if (Math.abs(b.bas - hb) < 0.004) b.bas = hb;
    });

    ct.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ct.clearRect(0, 0, S.en, S.boy);
    gozleriCiz(ct, S.sakin ? 0 : t);
    S.bitki.forEach((b) => bitkiCiz(ct, b, S.sakin ? 1e9 : t, I));
    S.bitki.forEach((b) => rozetCiz(ct, b));
    onizlemeCiz(ct);
    yolCiz(ct, S.sakin ? 0 : t);
    makineCiz(ct, S.sakin ? 0 : t, I);
    zerreCiz(ct, t);
    etiketCiz(ct);

    const sure = performance.now() - bas;
    S.olcum.kare += 1;
    S.olcum.sure += sure;
    S.olcum.sayac += 1;
    if (sure > S.olcum.enUzun) S.olcum.enUzun = sure;
    S.kirli = false;
  });

  function dongu() {
    S.dongu = 0;
    if (!S.acik || document.hidden) return;
    olcuTazele();
    zeminCiz();
    if (S.kirli) ciz();
    if (!S.sakin && canliMi()) { S.kirli = true; S.dongu = requestAnimationFrame(dongu); }
  }
  function uyandir() { if (!S.dongu && S.acik) S.dongu = requestAnimationFrame(dongu); }

  function olcuTazele() {
    const kap = $("#bh-sahne-kap");
    if (!kap || !S.zemin) return false;
    const r = kap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const en = Math.max(1, Math.round(r.width)), boy = Math.max(1, Math.round(r.height));
    if (en === S.en && boy === S.boy && dpr === S.dpr) return false;
    S.en = en; S.boy = boy; S.dpr = dpr;
    [S.zemin, S.sahne].forEach((c) => {
      c.width = Math.round(en * dpr); c.height = Math.round(boy * dpr);
      c.style.width = `${en}px`; c.style.height = `${boy}px`;
    });
    geometriKur();
    bitkileriHazirla();
    S.zeminImza = "";
    S.sprite.clear();
    kirlet();
    return true;
  }

  /* ==================================================================== *
   * Etkileşim — iş bitkinin ÜSTÜNDE başlıyor
   * ==================================================================== */
  function turBul(slug) {
    return ((S.veri || {}).turler || []).find((t) => t.slug === slug) || null;
  }
  function bitkiBul(ex, ey) {
    for (let i = S.bitki.length - 1; i >= 0; i--) {
      const b = S.bitki[i];
      const rx = Math.max(20, b.capQ / 2), ry = rx * 0.72;
      const dx = (ex - b.x) / rx, dy = (ey - (b.y - yukPx(16, b.v))) / ry;
      if (dx * dx + dy * dy <= 1) return b;
    }
    return null;
  }

  /** Bitkiye dokununca ONUN ÜSTÜNDE açılan halka menü: sulama, ölçüm ve
   *  ayrıntı. İş uzaktaki bir düğmede değil, bitkinin kendisinde
   *  başlıyor. */
  const menuAc = guvenli("menü", function (b) {
    const el = $("#bh-menu");
    if (!el) return;
    S.menuAd = b.ad;
    const bagli = !!(S.veri || {}).bagli;
    const kilit = bagli ? "" : " disabled";
    const sebep = bagli ? "" : ' title="Makine kopuk — ajan bağlanınca açılır."';
    el.innerHTML = `
      <button class="bh-halka-d su" data-rol="sula"${kilit}${sebep}>💧</button>
      <button class="bh-halka-d nem" data-rol="nem"${kilit}${sebep}>🌡️</button>
      <button class="bh-halka-d" data-rol="detay">ⓘ</button>
      <span class="bh-halka-ad">${kacisli(b.tur_ad)}</span>`;
    el.hidden = false;
    const kap = $("#bh-sahne-kap").getBoundingClientRect();
    const y = b.y - yukPx(16, b.v) - b.capQ * 0.35;
    el.style.left = `${kis(b.x, 60, kap.width - 60)}px`;
    el.style.top = `${kis(y, 50, kap.height - 60)}px`;
    el.querySelector('[data-rol="detay"]').onclick = () => { menuKapat(); kartAc(b.ad); };
    const s = el.querySelector('[data-rol="sula"]');
    const n = el.querySelector('[data-rol="nem"]');
    if (s && !s.disabled) s.onclick = () => { menuKapat(); sulaOnayi(b); };
    if (n && !n.disabled) n.onclick = () => { menuKapat(); isGonder("nem", [b.ad]); };
    kirlet();
  });

  function menuKapat() {
    const el = $("#bh-menu");
    if (el) el.hidden = true;
    if (S.menuAd) { S.menuAd = ""; kirlet(); }
  }

  /* ------------------------------------------------------ iş gönderme */
  const isGonder = guvenli("iş", async function (tip, adlar, ek) {
    try {
      const y = await gonder("/api/bahce/is",
                             Object.assign({ tip, noktalar: adlar }, ek || {}));
      kuyrukDegisti(y.kuyruk);
      gunluk(`✓ ${({ sula: "Sulama", nem: "Nem ölçümü", foto: "Fotoğraf" })[tip]
                  || tip} sıraya girdi`, "ok");
    } catch (hata) {
      gunluk(`✕ ${hata.message}`, "hata");
      notYaz("is", `İş sıraya konamadı: ${hata.message}`);
      setTimeout(() => notYaz("is", ""), 8000);
    }
  });

  /** Geri alınamaz iş ONAY İSTER ve ne olacağını önce yazar. */
  function onayIste(secenek) {
    const ortu = $("#bh-onay");
    if (!ortu) return;
    ortu.hidden = false;
    ortu.innerHTML = `
      <section class="bh-onay-kutu" role="dialog" aria-modal="true">
        <b>${kacisli(secenek.baslik)}</b>
        <p>${kacisli(secenek.ne)}</p>
        <div class="bh-dugmeler">
          <button class="bh-dugme birincil" data-rol="tamam">${kacisli(secenek.tamam)}</button>
          <button class="bh-dugme" data-rol="vazgec">Vazgeç</button>
        </div>
      </section>`;
    requestAnimationFrame(() => ortu.classList.add("acik"));
    const kapat = () => { ortu.classList.remove("acik");
                          setTimeout(() => { ortu.hidden = true; }, 180); };
    ortu.onclick = (o) => { if (o.target === ortu) kapat(); };
    ortu.querySelector('[data-rol="vazgec"]').onclick = kapat;
    ortu.querySelector('[data-rol="tamam"]').onclick = async () => {
      kapat();
      await secenek.tikla();
    };
  }

  function sulaOnayi(b) {
    const bas = ((S.veri || {}).baslar || {}).sulama || {};
    const o = b.olcum || {};
    onayIste({
      baslik: `${b.tur_ad} sulanacak`,
      ne: "Makine sulama başlığıyla "
        + `${Math.round(sayi(veriBitki(b.ad).x) + sayi(bas.dx))} / `
        + `${Math.round(sayi(veriBitki(b.ad).y) + sayi(bas.dy))} mm noktasına gidecek `
        + `ve pompayı ${b.sulama_saniye.toFixed(1)} saniye açacak. `
        + (o.var && o.kendi ? "" : "Bu bitkinin kendi nemi ölçülmedi, yani ne kadar "
                                   + "gerektiği bilinmiyor. ")
        + "Dökülen su geri alınamaz.",
      tamam: "Onaylıyorum, sula",
      tikla: () => isGonder("sula", [b.ad], { saniye: b.sulama_saniye }),
    });
  }
  function veriBitki(ad) {
    return ((S.veri || {}).bitkiler || []).find((x) => x.ad === ad) || {};
  }

  /* ==================================================================== *
   * Bitki kartı — sahnenin üstünde yüzen panel
   * ==================================================================== */
  const kartAc = guvenli("kart", function (ad) {
    const b = veriBitki(ad);
    const el = $("#bh-kart");
    if (!b.ad || !el) return;
    S.secili = ad;
    const o = b.su_olcum || {};
    const simdi = Date.now() / 1000;
    const alan = (baslik, deger, alt, bos) =>
      `<div class="bh-alan${bos ? " bos" : ""}"><i>${kacisli(baslik)}</i>`
      + `<b>${kacisli(deger)}</b>${alt ? `<em>${kacisli(alt)}</em>` : ""}</div>`;
    const alanlar = [
      alan("Yeri", `X ${Math.round(sayi(b.x))} · Y ${Math.round(sayi(b.y))} mm`),
      b.ekim ? alan("Ekildi", `${Math.round(sayi(b.yas_gun, 0))} günlük`, tarih(b.ekim))
             : alan("Ekildi", "tarih yok", "yaşı bilinmiyor", true),
      sayi(b.olgun_gun) ? alan("Hasat", b.hasat ? "hazır"
              : `${Math.max(0, Math.round(sayi(b.olgun_gun) - sayi(b.yas_gun)))} gün kaldı`,
              `türün olgunluğu ${Math.round(sayi(b.olgun_gun))} gün`)
            : alan("Hasat", "—", "türde olgunluk süresi yok", true),
      alan("Yayılma çapı", sayi(b.yaricap_mm) ? `${Math.round(sayi(b.yaricap_mm) * 2)} mm` : "—",
           b.cakisik ? "komşusuyla çakışıyor" : "", !sayi(b.yaricap_mm)),
      o.var ? alan("Toprak nemi", o.kendi ? `%${Math.round(sayi(o.yuzde))}`
                                          : `(%${Math.round(sayi(o.yuzde))})`,
              (o.kendi ? "kendi üstünden" : `${Math.round(sayi(o.uzak_mm))} mm ötede`)
              + ` · ${sureKisa(o.yas_sn)} önce` + (o.bayat ? " · sulamadan ÖNCE" : ""))
            : alan("Toprak nemi", "ölçülmedi",
              `son ${Math.round(sayi(o.azami_yas_sn, 86400) / 3600)} saatte yakınında `
              + "okuma yok", true),
      o.esik_acik ? alan("Sulama eşiği", `%${Math.round(sayi(o.esik))}`,
                         "nem bunun altına düşünce sulanmalı")
                  : alan("Sulama eşiği", "kapalı", "eşik %100 — nem kararı yok", true),
      alan("Sulama süresi", `${sayi(b.sulama_saniye, 3).toFixed(1)} sn`),
      b.sulama_ts ? alan("Son sulama", `${sureKisa(simdi - sayi(b.sulama_ts))} önce`,
                         `${tarih(b.sulama_ts)} · komut damgası, akış sensörü yok`)
                  : alan("Son sulama", "hiç", "ekildiğinden beri sulanmamış", true),
    ];
    el.innerHTML = `
      <header>
        <b>${kacisli(b.tur_ad || b.tur)}</b>
        <span class="esnek"></span>
        <button class="bh-ikon" data-rol="kapat">Kapat</button>
      </header>
      <p class="bh-gerekce">${kacisli(b.su_gerekce || "")}</p>
      <div class="bh-alanlar">${alanlar.join("")}</div>
      <div class="bh-dugmeler">
        <button class="bh-dugme birincil" data-makine="1" data-rol="sula">💧 Sula</button>
        <button class="bh-dugme" data-makine="1" data-rol="nem">🌡️ Nemini ölç</button>
        <button class="bh-dugme" data-makine="1" data-rol="foto">📷 Fotoğrafla</button>
      </div>`;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("acik"));
    el.querySelector('[data-rol="kapat"]').onclick = kartKapat;
    el.querySelector('[data-rol="nem"]').onclick = () => isGonder("nem", [ad]);
    el.querySelector('[data-rol="foto"]').onclick = () => isGonder("foto", [ad]);
    el.querySelector('[data-rol="sula"]').onclick = () => {
      const bb = S.bitkiIx[ad];
      if (bb) sulaOnayi(bb);
    };
    durumYaz();
  });

  function kartKapat() {
    const el = $("#bh-kart");
    if (el) { el.classList.remove("acik"); setTimeout(() => { el.hidden = true; }, 180); }
    if (S.secili) { S.secili = ""; kirlet(); }
  }

  /* ==================================================================== *
   * Görev kartları — sahnenin üstünde yüzen sütun
   *
   * Kartları SUNUCU üretiyor (`bahce.kartlar`): ölçüt yoksa kart yok,
   * kart varsa gerekçesi de var. Şerit listelemiyor, işe çeviriyor.
   * ==================================================================== */
  const islerYaz = guvenli("görevler", function () {
    const kap = $("#bh-isler");
    if (!kap) return;
    const v = S.veri || {};
    const kartlar = v.kartlar || [];
    if (!kartlar.length) {
      kap.innerHTML = '<p class="bh-is-bos">Şu an gereken bir iş yok.</p>';
      return;
    }
    kap.innerHTML = kartlar.map((k) => {
      const turler = k.secenekler
        ? `<div class="bh-turler">${k.secenekler.slice(0, 8).map((t) => `
            <button class="bh-cip" data-tur="${kacisli(t.slug)}"
                    aria-pressed="${t.slug === S.secilenTur ? "true" : "false"}">
              ${kacisli(t.simge || "🌱")} ${kacisli(t.ad)}${
                t.hazne ? "" : ' <span class="yok">(hazne boş)</span>'}
            </button>`).join("")}</div>`
        : "";
      return `<article class="bh-is${k.ertelendi ? " ertelendi" : ""}"
                       data-kimlik="${kacisli(k.kimlik)}" tabindex="0">
        <span class="bh-is-simge">${kacisli(k.simge || "•")}</span>
        <div>
          <b>${kacisli(k.baslik)}</b>
          <small>${kacisli(k.aciklama || "")}</small>
          <span class="bh-kanit">${k.tahmin ? '<i class="bh-tahmin">tahmin</i>' : ""}${
            kacisli(k.kanit ? `Ölçüt: ${k.kanit}` : "")}</span>
          ${turler}
          <div class="bh-dugmeler">
            ${k.ertelendi
              ? '<button class="bh-dugme" data-rol="geri">Ertelemeyi geri al</button>'
              : `${k.evet && !k.secenekler
                  ? `<button class="bh-dugme birincil" data-makine="1"
                             data-rol="yap">${kacisli(k.evet)}</button>` : ""}
                 <button class="bh-dugme" data-rol="ertele">Yarın sor</button>`}
          </div>
        </div>
      </article>`;
    }).join("");

    kap.querySelectorAll(".bh-is").forEach((el) => {
      const k = kartlar.find((x) => x.kimlik === el.dataset.kimlik);
      if (!k) return;
      const isaret = (a) => { S.isVurgu = a ? new Set(k.noktalar || []) : null; kirlet(); };
      el.addEventListener("pointerenter", () => isaret(true));
      el.addEventListener("pointerleave", () => isaret(false));
      const d = (r) => el.querySelector(`[data-rol="${r}"]`);
      if (d("yap")) d("yap").onclick = () => kartIsi(k);
      if (d("ertele")) d("ertele").onclick = () => ertele(k.kimlik, false);
      if (d("geri")) d("geri").onclick = () => ertele(k.kimlik, true);
      el.querySelectorAll("[data-tur]").forEach((c) => {
        c.onclick = () => tohumSec(c.dataset.tur === S.secilenTur ? "" : c.dataset.tur);
      });
    });
    durumYaz();
  });

  const ertele = guvenli("ertele", async function (kimlik, iptal) {
    try { await gonder("/api/bahce/ertele", { kimlik, iptal: !!iptal }); await yukle(); }
    catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
  });

  function kartIsi(k) {
    const adlar = k.noktalar || [];
    if (!adlar.length) return;
    if (k.tip === "nem") { isGonder("nem", adlar); return; }
    if (k.tip === "hasat") { isGonder("foto", adlar); return; }
    if (k.tip !== "sula") return;
    const bas = ((S.veri || {}).baslar || {}).sulama || {};
    const sn = adlar.map((a) => sayi(veriBitki(a).sulama_saniye, 3));
    const enAz = Math.min(...sn), enCok = Math.max(...sn);
    onayIste({
      baslik: k.baslik,
      ne: `${adlar.length} bitki sulanacak. Makine her birine sulama başlığıyla `
        + `gidiyor (baş kayması ${sayi(bas.dx).toFixed(0)} / ${sayi(bas.dy).toFixed(0)} mm) `
        + `ve pompayı ${enAz === enCok ? `${enAz.toFixed(1)} saniye`
                                       : `${enAz.toFixed(1)}–${enCok.toFixed(1)} saniye`} `
        + "açıyor — süre her bitkinin kendi ayarından. "
        + (k.tahmin ? "Bu kartın bir kısmı ÖLÇÜME DEĞİL geçen güne dayanıyor. " : "")
        + "Dökülen su geri alınamaz.",
      tamam: `Onaylıyorum, ${adlar.length} bitkiyi sula`,
      tikla: () => isGonder("sula", adlar),
    });
  }

  /* ==================================================================== *
   * Tohum rafı ve ekim
   * ==================================================================== */
  const rafYaz = guvenli("raf", function () {
    const raf = $("#bh-raf");
    if (!raf) return;
    const v = S.veri || {};
    const hazne = new Set(v.hazne_turleri || []);
    const bahcede = new Set((v.bitkiler || []).map((b) => b.tur));
    const sirali = [...(v.turler || [])].sort((a, b) =>
      (bahcede.has(b.slug) ? 1 : 0) - (bahcede.has(a.slug) ? 1 : 0));
    raf.innerHTML = sirali.slice(0, 14).map((t) => {
      const cap = Math.round(sayi(t.yayilim_mm));
      const kat = t.yayilim_katalog == null ? null : Math.round(sayi(t.yayilim_katalog));
      const ezili = !!t.yayilim_ezili && kat != null && kat !== cap;
      return `<button class="bh-tohum" data-tur="${kacisli(t.slug)}" data-makine="1"
                      aria-pressed="${t.slug === S.secilenTur ? "true" : "false"}">
        <span class="im">${kacisli(t.simge || "🌱")}</span>
        <span>${kacisli(t.ad)}<small>${
          hazne.has(t.slug)
            ? (ezili ? `<span class="ezili">çap ${cap} mm — elle konmuş `
                       + `(katalog ${kat})</span>` : `çap ${cap} mm`)
            : '<span class="ezili">haznede tohum yok</span>'}</small></span>
        ${ezili ? `<i class="bh-geri" data-geri="${kacisli(t.slug)}"
                      title="Katalogdaki ${kat} mm değerine döndür">↺</i>` : ""}
      </button>`;
    }).join("");
    raf.querySelectorAll("[data-geri]").forEach((d) => {
      d.addEventListener("pointerdown", (o) => o.stopPropagation());
      d.addEventListener("click", guvenli("çap sıfırla", async (o) => {
        o.preventDefault(); o.stopPropagation();
        await api(`/api/turler?slug=${encodeURIComponent(d.dataset.geri)}&alan=spread_mm`,
                  { method: "DELETE" });
        gunluk("✓ Çap katalog değerine döndü", "ok");
        await yukle();
      }));
    });
    raf.querySelectorAll(".bh-tohum").forEach((d) => {
      d.addEventListener("pointerdown", surukleBasla);
      d.addEventListener("click", (o) => {
        if (o.target.closest("[data-geri]")) return;
        if (S.suruklendi) { S.suruklendi = false; return; }
        o.preventDefault();
        tohumSec(d.dataset.tur === S.secilenTur ? "" : d.dataset.tur);
      });
    });
    durumYaz();
  });

  const tohumSec = guvenli("tohum", async function (slug) {
    S.secilenTur = slug || "";
    S.onizleme = null;
    document.querySelectorAll("[data-tur]").forEach((d) => {
      d.setAttribute("aria-pressed", d.dataset.tur === S.secilenTur ? "true" : "false");
    });
    if (!S.secilenTur) { S.gozler = null; notYaz("goz", ""); kirlet(); return; }
    try {
      const y = await api(`/api/bahce/bos-yer?tur=${encodeURIComponent(slug)}&azami=96`);
      if (S.secilenTur !== slug) return;
      S.gozler = y;
      S.gozT0 = (performance.now() - S.t0) / 1000;
      notYaz("goz", y.adet ? "" : `${y.ad} için boş yer kalmamış — mevcut `
             + "bitkilerin yayılım çemberleri yatağı doldurmuş.");
    } catch (hata) {
      S.gozler = null;
      notYaz("goz", `Ekim gözleri hesaplanamadı: ${hata.message}`);
    }
    kirlet();
  });

  /** Bırakma noktasının geçerliliği — sunucudaki `bos_yerler` ile aynı
   *  üç ölçüt. Karar yine sunucuda veriliyor; buradaki hesap yalnız
   *  ÖNCEDEN göstermek için ve ayrışırsa sunucu reddediyor. */
  function yerGecerli(x, y, yayilim) {
    const v = S.veri || {};
    const r = Math.max(0, sayi(yayilim) / 2);
    const alanlar = v.alanlar || [];
    if (!alanlar.length) return { ok: false, sebep: "Dikim alanı tanımlı değil." };
    const icinde = alanlar.some((a) =>
      x >= Math.min(sayi(a.x1), sayi(a.x2)) && x <= Math.max(sayi(a.x1), sayi(a.x2))
      && y >= Math.min(sayi(a.y1), sayi(a.y2)) && y <= Math.max(sayi(a.y1), sayi(a.y2)));
    if (!icinde) return { ok: false, sebep: "Burada toprak yok — dikim alanının dışı." };
    const s = v.sinirlar || {}, sx = s.x || {}, sy = s.y || {};
    if ((sx.min != null && x < sayi(sx.min)) || (sx.max != null && x > sayi(sx.max))
        || (sy.min != null && y < sayi(sy.min)) || (sy.max != null && y > sayi(sy.max))) {
      return { ok: false, sebep: "Makinenin yumuşak sınırlarının dışı." };
    }
    let en = null, enPay = Infinity;
    (v.bitkiler || []).forEach((b) => {
      const pay = Math.hypot(x - sayi(b.x), y - sayi(b.y))
        - (r + sayi(b.yaricap_mm)) * 0.98;
      if (pay < enPay) { enPay = pay; en = b; }
    });
    if (en && enPay < 0) {
      return { ok: false, cakisan: en,
               sebep: `${en.tur_ad || en.tur} çok yakın — çemberler `
                      + `${Math.round(-enPay)} mm çakışıyor.` };
    }
    return { ok: true, cakisan: null, sebep: "" };
  }

  function birakmaYeri(ex, ey) {
    const uv = ekranUV(ex, ey);
    if (!uv) return null;
    const ham = uvMM(uv.u, uv.v);
    const g = S.gozler;
    if (g && g.yerler) {
      const cek = Math.max(25, sayi(g.yayilim_mm) / 2);
      let en = null, enD = Infinity;
      g.yerler.forEach((y) => {
        const d = Math.hypot(y.x - ham.x, y.y - ham.y);
        if (d < enD) { enD = d; en = y; }
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
    notYaz("birak", d.ok ? "" : `Buraya ekilemez — ${d.sebep}`);
    kirlet();
  }

  function surukleBasla(o) {
    const t = o.target.closest(".bh-tohum");
    if (!t || t.disabled) return;
    const tur = turBul(t.dataset.tur);
    if (!tur) return;
    S.surukle = { tur, el: t, tasindi: false, x: o.clientX, y: o.clientY };
    S.suruklendi = false;
    if (S.secilenTur !== tur.slug) tohumSec(tur.slug);
  }
  const surukleTasi = guvenli("sürükle", function (o) {
    const s = S.surukle;
    if (!s) return;
    if (!s.tasindi && Math.hypot(o.clientX - s.x, o.clientY - s.y) < 6) return;
    if (!s.tasindi) { s.tasindi = true; s.el.classList.add("tutuluyor"); }
    o.preventDefault();
    const r = $("#bh-sahne-kap").getBoundingClientRect();
    const ic = o.clientX >= r.left && o.clientX <= r.right
      && o.clientY >= r.top && o.clientY <= r.bottom;
    if (ic) onizlemeTazele(o.clientX - r.left, o.clientY - r.top);
    else { S.onizleme = null; notYaz("birak", ""); kirlet(); }
  });
  const surukleBirak = guvenli("bırak", function (o) {
    const s = S.surukle;
    if (!s) return;
    S.surukle = null;
    s.el.classList.remove("tutuluyor");
    if (!s.tasindi) return;
    S.suruklendi = true;
    const on = S.onizleme;
    S.onizleme = null;
    notYaz("birak", "");
    kirlet();
    if (on && on.ok) ekOnayi(s.tur, on);
    void o;
  });

  function ekOnayi(tur, yer) {
    const v = S.veri || {};
    const bas = (v.baslar || {}).tohum || {};
    const goz = (v.hazne_gozleri || []).find(
      (g) => g.dolu && String(g.tohum || "") === tur.slug);
    onayIste({
      baslik: `${tur.ad} ekilecek`,
      ne: `Tohum ${Math.round(sayi(yer.x))} / ${Math.round(sayi(yer.y))} mm noktasına `
        + `düşecek; makine tohum ucuyla ${Math.round(sayi(yer.x) + sayi(bas.dx))} / `
        + `${Math.round(sayi(yer.y) + sayi(bas.dy))} mm noktasına gidiyor (baş kayması `
        + "eklenmiş). "
        + (goz ? `Tohum "${goz.ad}" gözünden alınacak. `
               : "Bu türe ayrılmış DOLU bir göz görünmüyor; makine ekimi reddedebilir. ")
        + `Olgun çapı ${Math.round(sayi(tur.yayilim_mm))} mm. Ekim geri alınamaz.`,
      tamam: "Ek",
      tikla: guvenli("ekim", async () => {
        try {
          const y = await gonder("/api/bahce/ek", { tur: tur.slug, x: yer.x, y: yer.y });
          const uv = mmUV(yer.x, yer.y);
          const p = yansit(uv.u, uv.v);
          zerreAt("toz", p.x, p.y, 14, "#8a6a4a", Math.max(0.6, mmPx(uv.v) * 12));
          kuyrukDegisti(y.kuyruk);
          gunluk(`✓ ${tur.ad} sıraya girdi`, "ok");
          tohumSec("");
          await yukle();
        } catch (hata) {
          gunluk(`✕ ${hata.message}`, "hata");
          notYaz("ek", `Ekilemedi: ${hata.message}`);
          setTimeout(() => notYaz("ek", ""), 10000);
        }
      }),
    });
  }

  /* ==================================================================== *
   * Veri ve çekirdekten gelen haberler
   * ==================================================================== */
  function durumYaz() {
    const v = S.veri || {};
    const el = $("#bh-durum");
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
    // Kopukken iş başlatan hiçbir düğme AÇIK GÖRÜNMÜYOR.
    document.querySelectorAll("#sayfa-bahce [data-makine]").forEach((d) => {
      d.disabled = !v.bagli;
      d.title = v.bagli ? "" : "Makine kopuk — ajan bağlanınca açılır.";
    });
    notYaz("bagli", v.bagli ? ""
      : "Makineyle bağlantı yok: bahçe görünüyor ama iş başlatılamıyor.");
  }

  const yukle = guvenli("yükle", async function () {
    if (S.yukleniyor) return;
    S.yukleniyor = true;
    try {
      S.veri = await api("/api/bahce");
      notYaz("yukle", "");
      geometriKur();
      bitkileriHazirla();
      S.zeminImza = "";
      durumYaz();
      islerYaz();
      rafYaz();
      bosYaz();
      kirlet();
    } catch (hata) {
      // Sessiz başarısızlık yok.
      notYaz("yukle", `Bahçe okunamadı: ${hata.message}`);
    } finally {
      S.yukleniyor = false;
    }
  });

  function bosYaz() {
    const el = $("#bh-bos");
    if (!el) return;
    const v = S.veri || {};
    if (!(v.alanlar || []).length) {
      el.hidden = false;
      el.textContent = "Dikim alanı tanımlı değil — toprağın nerede olduğu "
        + "bilinmiyor. Tarla sekmesinden alan ekleyin.";
    } else if (!(v.bitkiler || []).length) {
      el.hidden = false;
      el.textContent = "Yatak boş — aşağıdan bir tohum alın, nereye sığdığını "
        + "toprakta göstereyim.";
    } else { el.hidden = true; }
  }

  function kareGeldi() { /* Kamera katı bu sürümde yok. */ }

  const durumDegisti = guvenli("durum", function (d) {
    if (!S.acik || !S.veri) return;
    S.veri.konum = d.konum || {};
    if (d.toprak_z != null) S.veri.toprak_z = d.toprak_z;
    const bagli = !!d.bagli;
    const mesgul = !!(d.hareket || (d.dizi && d.dizi.calisiyor));
    if (bagli !== S.veri.bagli || mesgul !== S.veri.mesgul) {
      S.veri.bagli = bagli; S.veri.mesgul = mesgul;
      durumYaz();
    }
    uyandir();
  });

  function ekimDegisti() { /* Ekim onayı kuyruk şeridinden yürüyor. */ }

  const kuyrukDegisti = guvenli("kuyruk", function (k, tazele) {
    if (!S.veri) return;
    const onceki = S.sonIs;
    if (onceki) {
      const kayit = ((k && k.isler) || []).find((i) => i.kimlik === onceki.kimlik);
      if (kayit && kayit.durum === "bitti") {
        // Biten işin kutlaması — haber KUYRUKTAN geliyor, tahminden değil.
        const renk = { sula: "#4fb8e8", nem: "#d9a520", ek: "#8fd27a" }[onceki.tip]
          || "#cfd6dd";
        (onceki.noktalar || []).forEach((ad) => {
          const b = S.bitkiIx[ad];
          if (b) zerreAt("kut", b.x, b.y - b.capQ * 0.2, 10, renk, 1);
        });
        S.sonIs = null;
      } else if (kayit && kayit.durum !== "calisiyor") { S.sonIs = null; }
    }
    const c = k && k.calisan;
    if (c) S.sonIs = { kimlik: c.kimlik, tip: c.tip, noktalar: (c.noktalar || []).slice() };
    S.veri.kuyruk = k;
    kirlet();
    if (S.acik && (tazele || (k && !k.calisan && !k.bekleyen))) yukle();
  });

  function baglandi() { if (S.acik) yukle(); }

  /* ==================================================================== *
   * Sekme ve bağlama
   * ==================================================================== */
  const sekme = guvenli("sekme", function (acik) {
    S.acik = !!acik;
    const kok = $("#bh");
    if (kok) kok.hidden = !S.acik;
    document.body.classList.toggle("bahce-acik", S.acik);
    if (!S.acik) {
      if (S.dongu) cancelAnimationFrame(S.dongu);
      S.dongu = 0;
      menuKapat(); kartKapat(); tohumSec("");
      return;
    }
    requestAnimationFrame(() => { olcuTazele(); kirlet(); });
    yukle();
  });

  const bagla = guvenli("bağlama", function () {
    const kok = $("#bh");
    if (!kok) return;
    S.zemin = $("#bh-zemin"); S.sahne = $("#bh-sahne");
    if (!S.zemin || !S.sahne) return;
    S.zeminCt = S.zemin.getContext("2d");
    S.sahneCt = S.sahne.getContext("2d");

    const kap = $("#bh-sahne-kap");
    const yerel = (o) => {
      const r = kap.getBoundingClientRect();
      return { x: o.clientX - r.left, y: o.clientY - r.top };
    };

    S.sahne.addEventListener("pointermove", guvenli("gezinme", (o) => {
      if (S.surukle) return;
      const p = yerel(o);
      if (S.secilenTur && o.pointerType !== "touch") {
        onizlemeTazele(p.x, p.y);
        S.sahne.style.cursor = "copy";
        return;
      }
      if (o.pointerType === "touch") return;
      const b = bitkiBul(p.x, p.y);
      const ad = b ? b.ad : "";
      S.sahne.style.cursor = b ? "pointer" : "default";
      if (ad !== S.uzerinde) { S.uzerinde = ad; kirlet(); }
    }));
    S.sahne.addEventListener("pointerleave", () => {
      if (S.uzerinde) { S.uzerinde = ""; kirlet(); }
    });
    S.sahne.addEventListener("pointerdown", guvenli("basma", (o) => {
      if (S.secilenTur) return;
      const p = yerel(o);
      const b = bitkiBul(p.x, p.y);
      if (b) { S.basili = b.ad; kirlet(); }
    }));
    const birak = () => { if (S.basili) { S.basili = ""; kirlet(); } };
    S.sahne.addEventListener("pointerup", birak);
    S.sahne.addEventListener("pointercancel", birak);
    S.sahne.addEventListener("click", guvenli("tıklama", (o) => {
      if (S.suruklendi) { S.suruklendi = false; return; }
      const p = yerel(o);
      if (S.secilenTur) {
        onizlemeTazele(p.x, p.y);
        const on = S.onizleme, tur = turBul(S.secilenTur);
        if (on && tur && on.ok) ekOnayi(tur, on);
        return;
      }
      const b = bitkiBul(p.x, p.y);
      if (b) menuAc(b); else menuKapat();
    }));

    document.addEventListener("pointermove", surukleTasi, { passive: false });
    document.addEventListener("pointerup", surukleBirak);
    document.addEventListener("pointercancel", surukleBirak);

    const sakinD = $("#bh-sakin");
    if (sakinD) {
      try { S.sakin = localStorage.getItem("farmbot_bh_sakin") === "1"; }
      catch { /* depolama kapalı */ }
      const yaz = () => {
        sakinD.setAttribute("aria-pressed", S.sakin ? "true" : "false");
        kirlet();
      };
      sakinD.onclick = () => {
        S.sakin = !S.sakin;
        try { localStorage.setItem("farmbot_bh_sakin", S.sakin ? "1" : "0"); }
        catch { /* boş */ }
        yaz();
      };
      yaz();
    }

    addEventListener("keydown", (o) => {
      if (o.key !== "Escape") return;
      if (S.menuAd) { menuKapat(); return; }
      if (S.secili) { kartKapat(); return; }
      if (S.secilenTur) tohumSec("");
    });
    if (window.ResizeObserver) {
      new ResizeObserver(() => { olcuTazele(); kirlet(); }).observe(kap);
    } else {
      addEventListener("resize", () => { olcuTazele(); kirlet(); });
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden) uyandir(); });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bagla);
  } else { bagla(); }

  /* Deneme kancası — kare süresi dahil. Tarayıcı konsolundan
     `Bahce.olcum()` çağrılıyor; ölçüm gerçek cihazda alınıyor. */
  function olcum() {
    const o = S.olcum;
    return {
      acik: S.acik, sakin: S.sakin, bitki: S.bitki.length,
      sprite: S.sprite.size, en: S.en, boy: S.boy, dpr: S.dpr,
      kare: o.kare,
      ortalama_ms: o.sayac ? Math.round((o.sure / o.sayac) * 100) / 100 : 0,
      en_uzun_ms: Math.round(o.enUzun * 100) / 100,
      canli: canliMi(), kirli: S.kirli, dongu: !!S.dongu,
      bagli: !!(S.veri || {}).bagli, hatalar: S.hatalar.slice(),
      sifirla: () => { S.olcum = { kare: 0, sure: 0, enUzun: 0, sayac: 0 }; },
    };
  }

  return { sekme, kareGeldi, durumDegisti, kuyrukDegisti, ekimDegisti,
           baglandi, yukle, olcum, mmUV, uvMM, ekranUV, yansit, kartAc };
})();
