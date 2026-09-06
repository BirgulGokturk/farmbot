/* Bahçe — YATAĞIN ÖNDEN KESİTİ.
 *
 * ---------------------------------------------------------------------
 * ÖRGÜTLEYİCİ FİKİR
 * ---------------------------------------------------------------------
 * Bu ekran bir yatağın DİKEY KESİTİ. Toprak çizgisi ekranı ikiye
 * bölüyor: üstünde bitkiler yandan, gerçek boylarıyla duruyor; altında
 * toprağın kendisi var ve NEM ORADA YAŞIYOR — bitkinin üstüne
 * yapıştırılmış bir rozet olarak değil, o bitkinin altındaki ıslak
 * sütunun derinliği olarak.
 *
 * Düzenin tamamı bu tek fikirden çıkıyor:
 *   · DİKEY EKSEN ÖLÇÜ. Yukarı = büyüme (yaş / olgunluk süresi),
 *     aşağı = nem (%0 en dipte, %100 yüzeyde). İki ölçü, tek eksen,
 *     ortasında toprak çizgisi.
 *   · YATAY EKSEN YATAĞIN X'İ; derinlik (yatağın Y'si) ölçek ve
 *     yükseklikle veriliyor — arka sıra küçük ve yukarıda, ön sıra
 *     büyük ve aşağıda. Yani ekran hâlâ yatağın kendisi, plan değil
 *     cephe.
 *   · ÖLÇÜLMEMİŞ NEM BİR BOŞLUK. Sütun yoksa toprakta taralı bir
 *     oyuk var. "Bilinmiyor" bir simge değil, yokluğun kendisi —
 *     yirmi dört bitkinin üstündeki okunmaz soru işaretleri bu yüzden
 *     gitti.
 *   · EŞİK bir DERİNLİK. Sütun eşik çizgisinin altında kalıyorsa bitki
 *     susamış demektir; iki sayı karşılaştırmadan görünüyor.
 *
 * ELENEN İKİ ALTERNATİF
 *   1. ÜSTTEN PLAN GÖRÜNÜMÜ (mekân merkezli). Üç kez denendi, üç kez
 *      aynı iskelete çıktı. Sebebi biçimsel: planda nemin duracağı bir
 *      yer yok, çünkü toprağın derinliği plana dik. Nem zorunlu olarak
 *      bitkinin üstüne bir rozet oluyor, rozetler okunmaz hâle geliyor
 *      ve geri kalan bilgi kenardaki kartlara taşınıyor. Yasaklanan
 *      dört öğe bu görünümün kaçınılmaz sonucuydu, tercih değil.
 *   2. ZAMAN EKSENİ (Gantt / şerit). Ekim → olgunluk bir zaman aralığı,
 *      sulama ve ölçüm birer olay; hepsi bir zaman şeridine dizilebilir.
 *      Elendi, çünkü makine milimetreyle çalışıyor: zaman ekseni
 *      "nerede" sorusunu tamamen siliyor ve kullanıcı bir bitkiyi
 *      seçtiğinde onu yatakta bulamıyor. Ayrıca olay şeridi, kart
 *      listesinin başka kılıkta geri gelmesi olurdu.
 *
 * ---------------------------------------------------------------------
 * BOZULMAYAN KURALLAR
 * ---------------------------------------------------------------------
 * · Ölçülmemiş, ölçülmüş gibi görünmez. Ölçülen nem DOLU sütun;
 *   ölçülmemiş olan taralı OYUK; ödünç alınmış komşu okuması yarı
 *   saydam ve "ödünç" yazılı; ölçüme değil geçen güne dayanan susama
 *   kararı kesikli.
 * · Sessiz başarısızlık yok: çizimin ve olayların her girişi
 *   `guvenli()` içinden geçiyor, hata ekranın üstünde adıyla yazılıyor.
 * · Geri alınamaz iş (ekim, sulama) önce ne olacağını yazar, sonra
 *   onay ister. Makine kopukken o düğmeler kilitli.
 *
 * ---------------------------------------------------------------------
 * PERFORMANS
 * ---------------------------------------------------------------------
 * 800×480'de ve telefonda açılıyor. İki tuval: `zemin` (gökyüzü,
 * toprak, kesit ızgarası) yalnız ölçü/saat değişince; `sahne` yalnız
 * KİRLİYSE. Bitkiler önbellekli küçük tuvallere bir kez çiziliyor,
 * sahneye tek `drawImage` ile basılıyor. Boşta hiç kare çizilmiyor.
 */
window.Bahce = (function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const P = () => window.Panel || {};

  /* Bant oranları — kesitin bütün düzeni bu dört sayıdan çıkıyor. */
  const GOK_ALT = 0.34;        // gökyüzü burada biter
  const YUZEY_ALT = 0.60;      // toprak yüzeyi bandı burada biter
  const KESIT_ALT = 1.00;      // kesit (toprak altı) tuvalin dibine kadar
  /* Arka sıra ne kadar küçülüyor, yatayda ne kadar daralıyor ve ne kadar
     yana kayıyor. KAYMA olmazsa ızgaraya ekilmiş bir yatakta arka sıra
     ön sıranın tam arkasına düşüp görünmez oluyor; eğik bakış onları
     birbirinin arkasından çıkarıyor. */
  const ARKA_OLCEK = 0.62, ARKA_DARALMA = 0.82, ARKA_KAYMA = 0.17;

  const S = {
    acik: false, veri: null, yukleniyor: false, sakin: false,
    zemin: null, zeminCt: null, sahne: null, sahneCt: null,
    en: 0, boy: 0, dpr: 1, zeminImza: "",
    kirli: true, dongu: 0,
    bitki: [], ix: {}, sprite: new Map(),
    kaydir: 0, kaydirHedef: 0,        // yatay gezinme (piksel)
    secili: "", uzerinde: "", basili: "",
    kartIx: 0,                        // hangi görev cümlesi gösteriliyor
    ekimTur: null, bosYer: [],        // ekim akışı: seçilen tür ve boş yerler
    zerre: [], notlar: {}, hatalar: [], sonIs: null, sonT: 0,
    olcum: { kare: 0, sure: 0, enUzun: 0, sayac: 0 },
  };

  /* ==================================================================== *
   * Yardımcılar
   * ==================================================================== */
  const sayi = (d, v = 0) => { const s = Number(d); return Number.isFinite(s) ? s : v; };
  const kis = (d, a, b) => Math.max(a, Math.min(b, d));
  const kacisli = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  function gunluk(m, s) { if (P().gunluk) P().gunluk(m, s || ""); }
  const api = (yol, sec) => P().apiIste(yol, sec);
  const gonder = (yol, govde) => api(yol, { method: "POST", body: JSON.stringify(govde) });

  /* SESSİZ BAŞARISIZLIK YOK. Her giriş buradan geçiyor: hata yakalanıyor,
     sahne çalışmaya devam ediyor, sebep ekranın üstünde adıyla yazıyor. */
  function guvenli(ad, islev) {
    return function (...arg) {
      try { return islev.apply(null, arg); }
      catch (h) { hataYaz(ad, h); return undefined; }
    };
  }
  function hataYaz(ad, hata) {
    const m = `${ad}: ${(hata && hata.message) || hata}`;
    if (S.hatalar.indexOf(m) < 0) {
      S.hatalar.push(m);
      if (S.hatalar.length > 4) S.hatalar.shift();
      try { console.error("[bahçe]", ad, hata); } catch { /* boş */ }
    }
    const el = $("#bh-hata");
    if (el) {
      el.hidden = false;
      el.innerHTML = S.hatalar.map((x) => `<span>${kacisli(x)}</span>`).join("");
    }
  }
  function notYaz(anahtar, metin) {
    if (metin) S.notlar[anahtar] = metin; else delete S.notlar[anahtar];
    const el = $("#bh-not");
    if (!el) return;
    const h = Object.values(S.notlar).filter(Boolean);
    el.hidden = !h.length;
    el.textContent = h.join(" · ");
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
        { day: "numeric", month: "long" });
    } catch { return ""; }
  }
  function tohum(ad) {
    let h = 2166136261;
    const s = String(ad || "");
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  function uretec(c) {
    let a = c >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
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
    return { r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t),
             b: Math.round(a.b + (b.b - a.b) * t) };
  }

  /** Günün saati — GÖKYÜZÜ bunu taşıyor. Kaynağı tarayıcının saati;
   *  hiçbir ölçüme karşılık gelmiyor, hiçbir sayıya dönüşmüyor. */
  function isik() {
    const d = new Date();
    const saat = d.getHours() + d.getMinutes() / 60;
    const yuk = kis(Math.sin(((saat - 6) / 14) * Math.PI), -0.3, 1);
    const gunduz = kis(yuk, 0, 1);
    return { saat, gunduz, gece: gunduz < 0.05,
             gx: -Math.cos(((saat - 6) / 14) * Math.PI) };
  }

  /* ==================================================================== *
   * Kesit geometrisi
   *
   * Yatak sınırları milimetreden geliyor; ekrandaki her şey bu üç
   * dönüşümden çıkıyor:
   *   ekranX(x, derinlik)  yatayda yatağın X'i, derinlikle daralarak
   *   toprakY(derinlik)    bitkinin bastığı çizgi
   *   nemY(yuzde)          kesit bandında nemin derinliği
   * ==================================================================== */
  const G = { gokAlt: 0, yuzeyUst: 0, yuzeyAlt: 0, kesitUst: 0, kesitAlt: 0,
              genislik: 0, merkez: 0, mmEn: 1, mmBoy: 1, pxMM: 1 };

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

  function geometriKur() {
    const s = yatakSinir();
    G.mmEn = Math.max(1, s.x2 - s.x1);
    G.mmBoy = Math.max(1, s.y2 - s.y1);
    G.gokAlt = S.boy * GOK_ALT;
    G.yuzeyUst = G.gokAlt;
    G.yuzeyAlt = S.boy * YUZEY_ALT;
    G.kesitUst = G.yuzeyAlt;
    G.kesitAlt = S.boy * KESIT_ALT - 6;
    // Yatağın tamamı ekrana sığıyor: gezinme bir zorunluluk değil, bir
    // yakınlaşma. Dar ekranda (800×480, telefon) yatak daralıyor ama
    // hiçbir bitki dışarı taşmıyor.
    G.genislik = Math.max(120, S.en - 96);
    G.merkez = S.en / 2;
    G.pxMM = G.genislik / G.mmEn;
  }

  const derinlik = (y) => kis((sayi(y) - yatakSinir().y1) / G.mmBoy, 0, 1);
  const olcekD = (d) => ARKA_OLCEK + (1 - ARKA_OLCEK) * d;
  function ekranX(x, d) {
    const s = yatakSinir();
    const u = (sayi(x) - s.x1) / G.mmEn;
    return G.merkez + (u - 0.5) * G.genislik * (ARKA_DARALMA + (1 - ARKA_DARALMA) * d)
      + (d - 0.5) * G.genislik * ARKA_KAYMA + S.kaydir;
  }
  const toprakY = (d) => G.yuzeyUst + d * (G.yuzeyAlt - G.yuzeyUst);
  /** Nem yüzdesinin kesit bandındaki Y'si: %100 yüzeyde, %0 dipte. */
  const nemY = (yuzde) => G.kesitUst + (1 - kis(sayi(yuzde), 0, 100) / 100)
    * (G.kesitAlt - G.kesitUst);

  /* ==================================================================== *
   * ZEMİN KATMANI — gökyüzü, toprak yüzeyi, kesit gövdesi.
   *
   * Bunların hiçbiri yatağın X'ine bağlı değil; bu yüzden yatay gezinme
   * zemini kirletmiyor. Zemin yalnız ölçü, saat ya da yatak sınırı
   * değişince yeniden çiziliyor — Pi'de kare başına iş buradan düşüyor.
   * ==================================================================== */
  const GOK_TEPE_GECE = { r: 10, g: 15, b: 34 };
  const GOK_TEPE_GUN = { r: 96, g: 158, b: 212 };
  const UFUK_GECE = { r: 26, g: 34, b: 58 };
  const UFUK_GUN = { r: 202, g: 224, b: 236 };
  const SAFAK = { r: 238, g: 146, b: 92 };
  const TOPRAK_UZAK = { r: 122, g: 92, b: 66 };
  const TOPRAK_YAKIN = { r: 86, g: 62, b: 44 };
  const KESIT_UST_RENK = { r: 92, g: 66, b: 47 };
  const KESIT_DIP_RENK = { r: 40, g: 28, b: 21 };

  function gokCiz(ct, I) {
    const safakGucu = I.gunduz > 0.42 ? 0 : (1 - Math.abs(I.gunduz - 0.16) / 0.3);
    const s = kis(safakGucu, 0, 1);
    const tepe = karis(karis(GOK_TEPE_GECE, GOK_TEPE_GUN, I.gunduz), SAFAK, s * 0.22);
    const ufuk = karis(karis(UFUK_GECE, UFUK_GUN, I.gunduz), SAFAK, s * 0.55);
    const g = ct.createLinearGradient(0, 0, 0, G.gokAlt);
    g.addColorStop(0, rgba(tepe, 1));
    g.addColorStop(1, rgba(ufuk, 1));
    ct.fillStyle = g;
    ct.fillRect(0, 0, S.en, G.gokAlt);

    // Yıldızlar yalnız karanlıkta; konumları tohumlu, her açılışta aynı.
    if (I.gunduz < 0.18) {
      const r = uretec(20240517);
      const gorunur = 1 - I.gunduz / 0.18;
      ct.fillStyle = `rgba(226,236,255,${0.55 * gorunur})`;
      const adet = Math.round(S.en / 14);
      for (let i = 0; i < adet; i++) {
        const x = r() * S.en, y = r() * G.gokAlt * 0.86, b = 0.5 + r() * 1.1;
        ct.globalAlpha = (0.25 + r() * 0.75) * gorunur;
        ct.fillRect(x, y, b, b);
      }
      ct.globalAlpha = 1;
    }

    // Güneş / ay: yalnız günün saatini anlatıyor, hiçbir ölçüyü değil.
    const gx = G.merkez + I.gx * S.en * 0.40;
    const gy = G.gokAlt * (1 - (0.14 + kis(I.gunduz, 0, 1) * 0.66));
    const gunes = I.gunduz > 0.06;
    const cap = gunes ? 16 : 12;
    const golge = ct.createRadialGradient(gx, gy, cap * 0.5, gx, gy, cap * 5);
    golge.addColorStop(0, gunes ? "rgba(255,238,190,0.34)" : "rgba(198,214,255,0.20)");
    golge.addColorStop(1, "rgba(0,0,0,0)");
    ct.fillStyle = golge;
    ct.beginPath(); ct.arc(gx, gy, cap * 5, 0, Math.PI * 2); ct.fill();
    ct.fillStyle = gunes ? "#ffeeb4" : "#dde6f6";
    ct.beginPath(); ct.arc(gx, gy, cap, 0, Math.PI * 2); ct.fill();
    if (!gunes) {                       // ayın gölgeli tarafı
      ct.fillStyle = rgba(karis(GOK_TEPE_GECE, UFUK_GECE, 0.5), 1);
      ct.beginPath(); ct.arc(gx + cap * 0.42, gy - cap * 0.2, cap * 0.92, 0, Math.PI * 2);
      ct.fill();
    }

    // Ufuk pusu: uzak sıranın arkası, kesitin "arkası yok" demesin diye.
    const p = ct.createLinearGradient(0, G.gokAlt - 46, 0, G.gokAlt);
    p.addColorStop(0, "rgba(0,0,0,0)");
    p.addColorStop(1, rgba(karis(ufuk, TOPRAK_UZAK, 0.42), 0.9));
    ct.fillStyle = p;
    ct.fillRect(0, G.gokAlt - 46, S.en, 46);
  }

  function yuzeyCiz(ct, I) {
    const h = G.yuzeyAlt - G.yuzeyUst;
    const uzak = ton(TOPRAK_UZAK, I.gunduz * 0.18 - 0.08);
    const yakin = ton(TOPRAK_YAKIN, I.gunduz * 0.14 - 0.10);
    const g = ct.createLinearGradient(0, G.yuzeyUst, 0, G.yuzeyAlt);
    g.addColorStop(0, rgba(uzak, 1));
    g.addColorStop(1, rgba(yakin, 1));
    ct.fillStyle = g;
    ct.fillRect(0, G.yuzeyUst, S.en, h);

    // Tırmıklanmış toprak dokusu: derinlikle sıklaşan kısa çizgiler.
    const r = uretec(90210);
    ct.lineWidth = 1;
    for (let i = 0; i < Math.round(h * 2.2); i++) {
      const d = Math.pow(r(), 0.7);
      const y = G.yuzeyUst + d * h;
      const x = r() * S.en;
      const en = 6 + r() * 26 * (0.4 + d);
      ct.strokeStyle = r() < 0.5 ? "rgba(255,236,210,0.05)" : "rgba(0,0,0,0.08)";
      ct.beginPath(); ct.moveTo(x, y); ct.lineTo(x + en, y + (r() - 0.5) * 1.5); ct.stroke();
    }
    // Yüzey çizgisi: bitkilerin bastığı ve kesitin başladığı sınır.
    ct.strokeStyle = "rgba(20,12,8,0.55)";
    ct.lineWidth = 1.5;
    ct.beginPath(); ct.moveTo(0, G.yuzeyAlt); ct.lineTo(S.en, G.yuzeyAlt); ct.stroke();
  }

  function kesitCiz(ct) {
    const h = G.kesitAlt - G.kesitUst;
    const g = ct.createLinearGradient(0, G.kesitUst, 0, G.kesitAlt);
    g.addColorStop(0, rgba(KESIT_UST_RENK, 1));
    g.addColorStop(0.55, rgba(karis(KESIT_UST_RENK, KESIT_DIP_RENK, 0.6), 1));
    g.addColorStop(1, rgba(KESIT_DIP_RENK, 1));
    ct.fillStyle = g;
    ct.fillRect(0, G.kesitUst, S.en, S.boy - G.kesitUst);

    // Katmanlar: dalgalı sınırlar, aynı tohumla her açılışta aynı toprak.
    const r = uretec(133742);
    for (let k = 0; k < 3; k++) {
      const taban = G.kesitUst + h * (0.26 + k * 0.25);
      ct.beginPath();
      ct.moveTo(0, taban);
      for (let x = 0; x <= S.en; x += 24) {
        ct.lineTo(x, taban + Math.sin((x / S.en) * (3 + k) * Math.PI + k) * 4
          + (r() - 0.5) * 2);
      }
      ct.strokeStyle = k % 2 ? "rgba(255,224,190,0.05)" : "rgba(0,0,0,0.13)";
      ct.lineWidth = 2;
      ct.stroke();
    }
    // Çakıl ve kök artığı: kesitin toprak olduğunu söyleyen doku.
    const adet = Math.round((S.en * h) / 5200);
    for (let i = 0; i < adet; i++) {
      const x = r() * S.en, y = G.kesitUst + r() * h, c = 0.8 + r() * 2.4;
      ct.fillStyle = r() < 0.45 ? "rgba(255,232,200,0.07)" : "rgba(0,0,0,0.16)";
      ct.beginPath(); ct.ellipse(x, y, c, c * (0.5 + r() * 0.6), r() * 3, 0, Math.PI * 2);
      ct.fill();
    }

    // DERİNLİK EKSENİ. Kesitte aşağı inmek nemin azalması demek; ölçek
    // solda duruyor ki dolu bir sütunun boyu okunabilsin.
    ct.save();
    ct.font = "600 10px system-ui,sans-serif";
    ct.textBaseline = "middle";
    [100, 50, 0].forEach((p) => {
      const y = nemY(p);
      ct.strokeStyle = "rgba(255,255,255,0.10)";
      ct.setLineDash([2, 6]);
      ct.lineWidth = 1;
      ct.beginPath(); ct.moveTo(42, y); ct.lineTo(S.en - 10, y); ct.stroke();
      ct.setLineDash([]);
      ct.fillStyle = "rgba(232,220,204,0.5)";
      ct.textAlign = "right";
      ct.fillText(`%${p}`, 36, kis(y, G.kesitUst + 7, G.kesitAlt - 7));
    });
    ct.restore();
  }

  const zeminImza = () => {
    const s = yatakSinir();
    return [Math.round(S.en), Math.round(S.boy), S.dpr,
            new Date().getHours(), s.x1, s.x2, s.y1, s.y2].join("/");
  };

  const zeminCiz = guvenli("zemin", function () {
    const ct = S.zeminCt;
    if (!ct || !S.en || !S.boy) return;
    const I = isik();
    ct.clearRect(0, 0, S.en, S.boy);
    gokCiz(ct, I);
    yuzeyCiz(ct, I);
    kesitCiz(ct);
    S.zeminImza = zeminImza();
  });

  /* ==================================================================== *
   * BİTKİ SİLUETİ — yandan.
   *
   * Planda bitki bir daireydi ve hepsi birbirinin aynıydı. Kesitte bitki
   * bir siluet: türü biçiminden, yaşı boyundan, susaması duruşundan
   * okunuyor. Siluet önbelleğe bir kez çiziliyor; sahneye tek drawImage.
   * ==================================================================== */
  const BICIM_GUL = 0;   // rozet: marul, lahana, ıspanak
  const BICIM_TUY = 1;   // tüylü: havuç, dereotu, maydanoz
  const BICIM_CALI = 2;  // çalı: domates, biber, fesleğen
  const SPRITE_EN = 128; // önbellek tuvalinin genişliği (px)
  const RAY_BOSLUK = 34; // makine rayının altında boş kalan şerit (px)
  const BOY_ORAN = [0.62, 1.15, 1.30];

  function bicimSec(b) {
    const s = `${b.tur || ""} ${b.tur_ad || ""}`.toLowerCase();
    if (/havu|derey|dereot|maydanoz|soğan|sogan|pırasa|pirasa|rezene|turp/.test(s))
      return BICIM_TUY;
    if (/domat|biber|patlıcan|patlican|fesleğen|feslegen|çilek|cilek|fasulye|salatalık|salatalik|kabak|nane|börülce/.test(s))
      return BICIM_CALI;
    if (/marul|lahana|ıspanak|ispanak|pazı|pazi|roka|kıvırcık|kivircik|semizotu/.test(s))
      return BICIM_GUL;
    return tohum(b.tur || b.ad) < 0.5 ? BICIM_GUL : BICIM_CALI;
  }

  /** Tek yaprak: sapından ucuna iki eğri. Susamışsa uç aşağı düşüyor. */
  function yaprakCiz(ct, x, y, uzunluk, aci, kalinlik, dus) {
    const a = aci + dus;
    const ux = x + Math.cos(a) * uzunluk, uy = y + Math.sin(a) * uzunluk;
    const ox = x + Math.cos(a) * uzunluk * 0.5, oy = y + Math.sin(a) * uzunluk * 0.5;
    const nx = -Math.sin(a) * kalinlik, ny = Math.cos(a) * kalinlik;
    ct.beginPath();
    ct.moveTo(x, y);
    ct.quadraticCurveTo(ox + nx, oy + ny + dus * uzunluk * 0.35, ux, uy);
    ct.quadraticCurveTo(ox - nx, oy - ny + dus * uzunluk * 0.35, x, y);
    ct.fill();
  }

  function gulCiz(ct, r, renk, olgun, dus, en, boy) {
    const kok = { x: en / 2, y: boy - 2 };
    const adet = Math.round(5 + olgun * 9);
    for (let i = 0; i < adet; i++) {
      const t = adet === 1 ? 0.5 : i / (adet - 1);
      const yan = t < 0.5 ? -1 : 1;
      const aci = -Math.PI / 2 + (t - 0.5) * 2.45 + (r() - 0.5) * 0.18;
      const uz = boy * (0.52 + 0.46 * (1 - Math.abs(t - 0.5) * 1.4)) * (0.82 + r() * 0.3);
      const koyu = 0.5 - Math.abs(t - 0.5);
      ct.fillStyle = rgba(ton(renk, -0.32 + koyu * 0.62), 0.97);
      yaprakCiz(ct, kok.x + yan * 2, kok.y, uz, aci, uz * 0.30, dus * (0.35 + t * 0.2));
    }
    ct.fillStyle = rgba(ton(renk, 0.30), 0.85);
    ct.beginPath(); ct.ellipse(kok.x, kok.y - boy * 0.10, en * 0.055, boy * 0.07, 0, 0, 6.3);
    ct.fill();
  }

  function tuyCiz(ct, r, renk, olgun, dus, en, boy) {
    const kokX = en / 2, kokY = boy - 2;
    const adet = Math.round(4 + olgun * 7);
    ct.lineCap = "round";
    for (let i = 0; i < adet; i++) {
      const t = adet === 1 ? 0.5 : i / (adet - 1);
      const yon = (t - 0.5) * 2;
      const uz = boy * (0.60 + 0.40 * (1 - Math.abs(yon))) * (0.8 + r() * 0.35);
      const ucX = kokX + yon * en * 0.30 * (0.7 + r() * 0.6);
      const ucY = kokY - uz + dus * uz * 0.55;
      ct.strokeStyle = rgba(ton(renk, -0.18 + r() * 0.35), 0.95);
      ct.lineWidth = 1.6;
      ct.beginPath();
      ct.moveTo(kokX, kokY);
      ct.quadraticCurveTo(kokX + yon * en * 0.10, kokY - uz * 0.62, ucX, ucY);
      ct.stroke();
      // İnce tüyler: sapın üst yarısında çift yönlü kılcallar.
      ct.lineWidth = 1;
      for (let k = 1; k <= 5; k++) {
        const p = 0.42 + k * 0.11;
        const sx = kokX + (ucX - kokX) * p, sy = kokY + (ucY - kokY) * p;
        const l = en * 0.055 * (1 - p) * 3;
        ct.beginPath();
        ct.moveTo(sx - l, sy - l * 0.5); ct.lineTo(sx + l, sy + l * 0.5);
        ct.stroke();
      }
    }
  }

  function caliCiz(ct, r, renk, turRenk, olgun, dus, en, boy, meyve) {
    const kokX = en / 2, kokY = boy - 2;
    const govdeBoy = boy * (0.55 + olgun * 0.35);
    ct.strokeStyle = rgba(ton(renk, -0.45), 1);
    ct.lineWidth = Math.max(1.5, en * 0.022);
    ct.lineCap = "round";
    ct.beginPath();
    ct.moveTo(kokX, kokY);
    ct.quadraticCurveTo(kokX + (r() - 0.5) * en * 0.06, kokY - govdeBoy * 0.6,
      kokX + (r() - 0.5) * en * 0.10, kokY - govdeBoy);
    ct.stroke();
    const dal = Math.round(3 + olgun * 4);
    for (let i = 0; i < dal; i++) {
      const t = (i + 0.7) / (dal + 0.4);
      const yan = i % 2 ? 1 : -1;
      const bx = kokX, by = kokY - govdeBoy * t;
      const uz = en * (0.20 + 0.26 * (1 - t)) * (0.75 + r() * 0.5);
      const aci = yan * (0.55 + r() * 0.35) - Math.PI / 2 * 0.35;
      const uy = by - Math.abs(Math.sin(aci)) * uz * 0.55 + dus * uz * 0.7;
      const dx = bx + yan * uz;
      ct.strokeStyle = rgba(ton(renk, -0.35), 1);
      ct.lineWidth = Math.max(1, en * 0.012);
      ct.beginPath(); ct.moveTo(bx, by); ct.lineTo(dx, uy); ct.stroke();
      for (let k = 0; k < 3; k++) {
        const p = 0.35 + k * 0.3;
        const lx = bx + (dx - bx) * p, ly = by + (uy - by) * p;
        ct.fillStyle = rgba(ton(renk, -0.22 + r() * 0.5), 0.95);
        yaprakCiz(ct, lx, ly, uz * (0.40 + r() * 0.22),
          (yan > 0 ? -0.55 : -2.6) + (r() - 0.5) * 0.3, uz * 0.20, dus * 0.6);
      }
      if (meyve && t > 0.35 && r() < 0.55) {
        const fx = bx + (dx - bx) * 0.72, fy = by + (uy - by) * 0.72 + uz * 0.22;
        const c = en * (0.045 + r() * 0.03);
        ct.fillStyle = rgba(turRenk, 0.95);
        ct.beginPath(); ct.arc(fx, fy, c, 0, 6.3); ct.fill();
        ct.fillStyle = "rgba(255,255,255,0.32)";
        ct.beginPath(); ct.arc(fx - c * 0.3, fy - c * 0.35, c * 0.28, 0, 6.3); ct.fill();
      }
    }
  }

  /** Önbellek anahtarı: aynı görünen bitkiler aynı tuvali paylaşır. */
  function spriteAnahtar(b) {
    const olgunKova = Math.round(kis(sayi(b.olgunluk), 0, 1) * 8);
    return `${b.tur || "?"}|${b.ad}|${olgunKova}|${b.susadi ? 1 : 0}|${b.hasat ? 1 : 0}`;
  }

  /* YAPRAK YEŞİLDİR. Türün rengi katalogdan geliyor ve çoğu zaman ÜRÜNÜN
     rengi: domates kırmızı, havuç turuncu. Onu yaprağa boyayınca sahne
     kırmızı yıldızlarla dolan bir şeye dönüyordu. Yaprak yeşilin türe
     göre kaymış bir tonu; türün kendi rengi meyvede ve toprak üstü
     ürününde duruyor. */
  const YAPRAK = { r: 111, g: 174, b: 85 };
  const yaprakRengi = (renk) => karis(renk, YAPRAK, 0.78);

  function spriteYap(b) {
    const bicim = bicimSec(b);
    const en = SPRITE_EN;
    const boy = Math.round(en * BOY_ORAN[bicim]);
    const c = document.createElement("canvas");
    c.width = en; c.height = boy;
    const ct = c.getContext("2d");
    const turRenk = hexRGB(b.renk || "#7bbf5a");
    const renk = yaprakRengi(turRenk);
    const olgun = kis(sayi(b.olgunluk), 0, 1);
    // SUSAMA DURUŞU: ölçüme dayanan susama tam düşük, güne dayanan tahmin
    // yarım düşük. Kesin ile tahmin aynı görünmüyor.
    const dus = b.susadi ? (b.su_tahmin ? 0.16 : 0.30) : 0;
    const r = uretec(Math.floor(tohum(b.ad) * 4294967295));
    if (bicim === BICIM_GUL) gulCiz(ct, r, renk, olgun, dus, en, boy);
    else if (bicim === BICIM_TUY) tuyCiz(ct, r, renk, olgun, dus, en, boy);
    else caliCiz(ct, r, renk, turRenk, olgun, dus, en, boy, !!b.hasat);
    return { tuval: c, en, boy, oran: BOY_ORAN[bicim], bicim };
  }

  function spriteAl(b) {
    const a = spriteAnahtar(b);
    let s = S.sprite.get(a);
    if (!s) {
      s = spriteYap(b);
      // Önbellek sınırsız büyümesin: 24 bitkilik sahnede 24 giriş yeter,
      // seçim/susama değişimleri için pay bırakıldı.
      if (S.sprite.size > 96) S.sprite.clear();
      S.sprite.set(a, s);
    }
    return s;
  }

  /* ==================================================================== *
   * NEM SÜTUNU — kesitin asıl anlattığı şey.
   *
   * Ölçülen nem: DOLU sütun, boyu ölçülen yüzde. Ölçülmemiş nem: taralı
   * OYUK — bir simge değil, toprakta bir yokluk. Ödünç okuma yarı saydam
   * ve komşunun uzaklığını yazıyor. Bayat okuma soluk ve üstü kesikli.
   * Eşik bir DERİNLİK çizgisi: sütun onun altında kalıyorsa susamış.
   * ==================================================================== */
  let _tarama = null;
  function taramaDeseni(ct) {
    if (_tarama) return _tarama;
    const c = document.createElement("canvas");
    c.width = 9; c.height = 9;
    const k = c.getContext("2d");
    k.strokeStyle = "rgba(214,198,176,0.30)";
    k.lineWidth = 1;
    k.beginPath();
    k.moveTo(-2, 11); k.lineTo(11, -2);
    k.moveTo(-2, 2); k.lineTo(2, -2);
    k.moveTo(7, 11); k.lineTo(11, 7);
    k.stroke();
    _tarama = ct.createPattern(c, "repeat");
    return _tarama;
  }

  /** Ölçümün ne olduğunu tek yerde çözüyoruz; çizim buna göre ayrışıyor. */
  function nemDurum(b) {
    const o = b.su_olcum || {};
    const varMi = !!o.var;
    return {
      var: varMi,
      kendi: !!o.kendi,
      bayat: !!o.bayat,
      yuzde: varMi ? kis(sayi(o.yuzde, sayi(b.nem_yuzde, 0)), 0, 100) : null,
      uzak: sayi(o.uzak_mm, 0),
      yas: sayi(o.yas_sn, 0),
      esik: sayi(o.esik, 0),
      esikAcik: !!o.esik_acik,
    };
  }

  function sutunCiz(ct, b, x, gen, d, vurgu) {
    const n = nemDurum(b);
    const yariEn = Math.max(7, gen * 0.5);
    const sol = x - yariEn, sag = x + yariEn;
    const dip = G.kesitAlt;
    const arka = 0.45 + d * 0.55;             // arka sıra soluk, ön sıra net

    if (!n.var) {
      // YOKLUK. Oyuk kazıyoruz: toprağın rengi değil, toprağın olmayışı.
      ct.save();
      ct.beginPath();
      ct.moveTo(sol, G.kesitUst);
      ct.lineTo(sag, G.kesitUst);
      ct.lineTo(sag, dip - 10);
      ct.quadraticCurveTo(x, dip, sol, dip - 10);
      ct.closePath();
      ct.fillStyle = `rgba(22,17,13,${0.42 * arka})`;
      ct.fill();
      ct.fillStyle = taramaDeseni(ct);
      ct.globalAlpha = 0.55 * arka;
      ct.fill();
      ct.globalAlpha = 1;
      ct.setLineDash([4, 4]);
      ct.strokeStyle = `rgba(226,208,182,${0.45 * arka})`;
      ct.lineWidth = 1;
      ct.stroke();
      ct.setLineDash([]);
      ct.restore();
      return n;
    }

    const ust = nemY(n.yuzde);
    const islak = { r: 58, g: 132, b: 186 };
    const kuru = { r: 146, g: 104, b: 58 };
    const renk = karis(kuru, islak, kis(n.yuzde / 100, 0, 1));
    const saydam = (n.kendi ? 0.95 : 0.5) * (n.bayat ? 0.62 : 1) * arka;

    ct.save();
    ct.beginPath();
    ct.moveTo(sol, ust);
    // Su yüzeyi düz değil: toprağa sızmış su dalgalı bir sınır bırakıyor.
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      ct.lineTo(sol + (sag - sol) * t,
        ust + Math.sin(t * Math.PI * 2 + tohum(b.ad) * 6.3) * 2.2);
    }
    ct.lineTo(sag, dip);
    ct.lineTo(sol, dip);
    ct.closePath();
    const g = ct.createLinearGradient(0, ust, 0, dip);
    g.addColorStop(0, rgba(ton(renk, 0.22), saydam));
    g.addColorStop(1, rgba(ton(renk, -0.30), saydam * 0.88));
    ct.fillStyle = g;
    ct.fill();
    // Su yüzeyi: kesitte suyun bittiği yer bir çizgiyle okunuyor.
    ct.strokeStyle = rgba(ton(renk, 0.45), saydam);
    ct.lineWidth = 1.4;
    ct.beginPath(); ct.moveTo(sol, ust); ct.lineTo(sag, ust); ct.stroke();
    if (!n.kendi || n.bayat) {
      ct.setLineDash(n.bayat ? [5, 4] : [2, 3]);
      ct.strokeStyle = `rgba(226,236,246,${0.55 * arka})`;
      ct.lineWidth = 1;
      ct.beginPath(); ct.moveTo(sol, ust); ct.lineTo(sag, ust); ct.stroke();
      ct.setLineDash([]);
    }
    ct.restore();

    // EŞİK: sütunun üstü bu çizginin altındaysa bitki susamış.
    if (n.esikAcik && n.esik > 0) {
      const ey = nemY(n.esik);
      ct.save();
      ct.strokeStyle = b.susadi ? "rgba(236,132,96,0.95)" : "rgba(214,222,232,0.42)";
      ct.lineWidth = b.susadi ? 1.6 : 1;
      ct.setLineDash([3, 3]);
      ct.beginPath(); ct.moveTo(sol - 3, ey); ct.lineTo(sag + 3, ey); ct.stroke();
      ct.setLineDash([]);
      ct.restore();
    }
    if (vurgu) {
      ct.strokeStyle = "rgba(255,255,255,0.5)";
      ct.lineWidth = 1;
      ct.strokeRect(sol, G.kesitUst, sag - sol, dip - G.kesitUst);
    }
    return n;
  }

  /** Kök: bitkinin toprağa uzanan payı — yaşla derinleşiyor. */
  function kokCiz(ct, b, x, tabanY, gen, d) {
    const olgun = kis(sayi(b.olgunluk), 0.05, 1);
    const boy = (G.kesitAlt - G.kesitUst) * (0.16 + olgun * 0.30);
    const r = uretec(Math.floor(tohum(b.ad + "kok") * 4294967295));
    ct.save();
    ct.globalAlpha = 0.22 + d * 0.26;
    ct.strokeStyle = "rgba(232,214,182,0.8)";
    ct.lineCap = "round";
    ct.lineWidth = kis(gen * 0.06, 0.9, 2.2);
    ct.beginPath();
    ct.moveTo(x, tabanY);
    ct.quadraticCurveTo(x + (r() - 0.5) * gen * 0.2, G.kesitUst + boy * 0.55,
      x + (r() - 0.5) * gen * 0.3, G.kesitUst + boy);
    ct.stroke();
    ct.lineWidth = kis(gen * 0.035, 0.6, 1.3);
    const yan = 3 + Math.round(olgun * 4);
    for (let i = 0; i < yan; i++) {
      const t = (i + 1) / (yan + 1);
      const sy = G.kesitUst + boy * t;
      const yon = i % 2 ? 1 : -1;
      ct.beginPath();
      ct.moveTo(x, sy);
      ct.quadraticCurveTo(x + yon * gen * 0.22, sy + boy * 0.10,
        x + yon * gen * (0.35 + r() * 0.25), sy + boy * (0.16 + r() * 0.14));
      ct.stroke();
    }
    ct.restore();
  }

  /* ==================================================================== *
   * SAHNE KATMANI
   * ==================================================================== */
  function bitkiOlcu(b) {
    const d = derinlik(b.y);
    const o = olcekD(d);
    const x = ekranX(b.x, d);
    const taban = toprakY(d);
    const capMM = Math.max(30, sayi(b.yaricap_mm, 0) * 2 || sayi(b.yayilim_mm, 60));
    const s = spriteAl(b);
    // GENİŞLİK yatağın milimetresinden geliyor; ama tek bir olgun bitki
    // ekranın tamamını yiyebiliyor (250 mm marul, 580 mm'lik yatak). Üst
    // sınır ekranın altıda biri: oran korunuyor, sahne yenmiyor.
    let en = kis(capMM * G.pxMM * o, 14, S.en * 0.17);
    // BOY bastığı çizgiye bağlı: bir bitki gökyüzünü delip geçemez. Arka
    // sıra alçak, ön sıra yüksek — derinlik burada da kendini söylüyor.
    // Tepede ray için yer bırakılıyor: bitki makinenin rayını delmiyor.
    const tavan = Math.max(20, (taban - RAY_BOSLUK) * 0.92);
    if (en * s.oran > tavan) en = tavan / s.oran;
    return { d, o, x, taban, en, boy: en * s.oran, sprite: s,
             // Nem sütunu bitkinin eni kadar geniş olmuyor: yan yana
             // duran sütunlar birbirine karışırsa hiçbiri okunmuyor.
             sutun: kis(en * 0.55, 12, 44) };
  }

  function bitkiCiz(ct, b, secili, uzerinde) {
    const m = b._m;
    const n = sutunCiz(ct, b, m.x, m.sutun, m.d, secili);
    kokCiz(ct, b, m.x, m.taban, m.sutun, m.d);

    // Toprakta oturduğu yer: siluetin altındaki gölge onu yüzeye bastırıyor.
    ct.save();
    ct.globalAlpha = 0.20 + m.d * 0.16;
    ct.fillStyle = "rgba(18,10,6,1)";
    ct.beginPath();
    ct.ellipse(m.x, m.taban + 1, m.en * 0.30, Math.min(9, m.en * 0.055), 0, 0, 6.3);
    ct.fill();
    ct.restore();

    ct.save();
    if (uzerinde || secili) {
      ct.shadowColor = "rgba(255,246,214,0.9)";
      ct.shadowBlur = secili ? 16 : 9;
    }
    // Arka sıra hava perspektifiyle soluyor; ön sıra tam renkte.
    ct.globalAlpha = 0.74 + m.d * 0.26;
    ct.drawImage(m.sprite.tuval, m.x - m.en / 2, m.taban - m.boy, m.en, m.boy);
    ct.restore();

    if (b.hasat) {
      // Hasat hazır: sap üstünde küçük bir işaret, rozet değil bir imleç.
      ct.fillStyle = "rgba(246,196,86,0.95)";
      ct.beginPath();
      ct.moveTo(m.x, m.taban - m.boy - 10);
      ct.lineTo(m.x - 4, m.taban - m.boy - 3);
      ct.lineTo(m.x + 4, m.taban - m.boy - 3);
      ct.closePath();
      ct.fill();
    }
    if (secili) {
      ct.strokeStyle = "rgba(255,255,255,0.35)";
      ct.setLineDash([2, 4]);
      ct.lineWidth = 1;
      ct.beginPath();
      ct.moveTo(m.x, G.gokAlt * 0.55); ct.lineTo(m.x, m.taban - m.boy - 14);
      ct.stroke();
      ct.setLineDash([]);
      ct.font = "600 11px system-ui,sans-serif";
      ct.textAlign = "center";
      ct.fillStyle = "rgba(246,242,232,0.95)";
      ct.fillText(b.ad, m.x, m.taban - m.boy - 18);
    } else if (uzerinde) {
      ct.font = "500 10px system-ui,sans-serif";
      ct.textAlign = "center";
      ct.fillStyle = "rgba(238,232,220,0.8)";
      ct.fillText(b.tur_ad || b.ad, m.x, m.taban - m.boy - 8);
    }
    return n;
  }

  /** Boş yerler: yüzeyde açılmış küçük çukurlar. Ekim akışı buraya basıyor. */
  function bosYerCiz(ct) {
    const y = S.bosYer || [];
    if (!y.length) return;
    const vur = (performance.now() / 700) % (Math.PI * 2);
    for (const p of y) {
      const d = derinlik(p.y);
      const x = ekranX(p.x, d);
      const o = olcekD(d);
      const r = Math.max(6, sayi(p.r_mm, 60) * 0.5 * G.pxMM * o);
      const ty = toprakY(d);
      ct.save();
      ct.translate(x, ty);
      ct.scale(1, 0.34);
      ct.beginPath(); ct.arc(0, 0, r, 0, 6.3);
      ct.fillStyle = "rgba(12,9,7,0.42)";
      ct.fill();
      ct.strokeStyle = `rgba(150,214,140,${0.35 + 0.25 * Math.sin(vur)})`;
      ct.lineWidth = 1.6;
      ct.stroke();
      ct.restore();
    }
  }

  /** Makine: X rayı gökyüzünde, araba gerçek X'inde, kol derinliğe iniyor. */
  function robotCiz(ct) {
    const k = (S.veri && S.veri.konum) || null;
    const bagli = !!(S.veri && S.veri.bagli);
    const rayY = 13;
    ct.save();
    ct.globalAlpha = bagli ? 1 : 0.32;
    ct.strokeStyle = "rgba(198,206,216,0.55)";
    ct.lineWidth = 3;
    ct.beginPath(); ct.moveTo(0, rayY); ct.lineTo(S.en, rayY); ct.stroke();
    ct.fillStyle = "rgba(150,158,170,0.5)";
    ct.fillRect(0, rayY - 3, 10, 6);
    ct.fillRect(S.en - 10, rayY - 3, 10, 6);

    if (k) {
      const d = derinlik(k.y);
      const x = ekranX(k.x, d);
      const hedefY = toprakY(d);
      const z = sayi(k.z, 0);
      const toprakZ = sayi(S.veri && S.veri.toprak_z, 0);
      // Z ekseni: kol ne kadar indiyse o kadar uzuyor. Toprağa değdiğinde
      // uç tam yüzeyde. Hiçbir şey uydurmuyoruz: z yoksa kol kısa kalıyor.
      const oran = toprakZ ? kis(z / toprakZ, 0, 1) : 0.15;
      const ucY = rayY + (hedefY - rayY) * (0.25 + oran * 0.75);
      ct.strokeStyle = "rgba(216,222,232,0.7)";
      ct.lineWidth = 2;
      ct.beginPath(); ct.moveTo(x, rayY); ct.lineTo(x, ucY); ct.stroke();
      ct.fillStyle = bagli ? "rgba(226,232,242,0.95)" : "rgba(150,156,166,0.8)";
      ct.fillRect(x - 11, rayY - 7, 22, 14);
      ct.fillStyle = "rgba(60,66,78,0.9)";
      ct.fillRect(x - 4, ucY - 5, 8, 7);
      ct.strokeStyle = "rgba(255,255,255,0.14)";
      ct.setLineDash([2, 5]);
      ct.lineWidth = 1;
      ct.beginPath(); ct.moveTo(x, ucY); ct.lineTo(x, hedefY); ct.stroke();
      ct.setLineDash([]);
    }
    ct.restore();
  }

  /** Su zerreleri: yalnız gerçekten sulama işi çalışırken var. */
  function zerreCiz(ct, dt) {
    if (!S.zerre.length) return;
    for (let i = S.zerre.length - 1; i >= 0; i--) {
      const z = S.zerre[i];
      z.vy += 620 * dt;
      z.x += z.vx * dt;
      z.y += z.vy * dt;
      z.omur -= dt;
      if (z.omur <= 0 || z.y > z.yer) { S.zerre.splice(i, 1); continue; }
      ct.fillStyle = `rgba(140,196,236,${kis(z.omur * 2, 0, 0.85)})`;
      ct.beginPath();
      ct.ellipse(z.x, z.y, 1.4, 2.6, 0, 0, 6.3);
      ct.fill();
    }
  }
  function zerreEk(x, y, yer) {
    for (let i = 0; i < 4; i++) {
      S.zerre.push({ x: x + (Math.random() - 0.5) * 10, y,
                     vx: (Math.random() - 0.5) * 26, vy: 20 + Math.random() * 40,
                     yer, omur: 0.8 + Math.random() * 0.5 });
    }
  }

  /* ==================================================================== *
   * KARE DÖNGÜSÜ
   *
   * Boşta kare yok. Döngü yalnız gerçekten kımıldayan bir şey varken
   * dönüyor: su zerresi, yumuşayan gezinme, nabız atan boş yer, çalışan
   * makine. Onun dışında sahne son çizildiği hâlde duruyor.
   * ==================================================================== */
  function canliMi() {
    if (S.sakin) return S.zerre.length > 0;
    if (S.zerre.length) return true;
    if (Math.abs(S.kaydirHedef - S.kaydir) > 0.4) return true;
    if (S.bosYer && S.bosYer.length) return true;
    if (S.veri && S.veri.mesgul) return true;
    return false;
  }
  function isteKare() {
    S.kirli = true;
    if (!S.dongu) S.dongu = requestAnimationFrame(kare);
  }
  function olcumEkle(ms) {
    const o = S.olcum;
    o.kare++;
    o.sure += ms;
    if (ms > o.enUzun) o.enUzun = ms;
  }
  function kare(t) {
    S.dongu = 0;
    // NABIZ 20 KARE/SN. Ekim kipinde tek kımıldayan şey boş yerlerin
    // nabzı; onun için Pi'yi 60 kare/sn döndürmenin anlamı yok.
    const yalnizNabiz = !S.zerre.length
      && Math.abs(S.kaydirHedef - S.kaydir) <= 0.4
      && !(S.veri && S.veri.mesgul);
    if (yalnizNabiz && t - (S.sonT || 0) < 48) {
      S.dongu = requestAnimationFrame(kare);
      return;
    }
    const dt = kis((t - (S.sonT || t)) / 1000, 0, 0.05);
    S.sonT = t;
    const b0 = performance.now();
    sahneCiz(dt);
    olcumEkle(performance.now() - b0);
    if (canliMi()) S.dongu = requestAnimationFrame(kare);
  }

  function yatakUcCiz(ct) {
    // Yatağın iki ucu: sahnenin nerede bittiğini söylüyor, çerçeve değil.
    const s = yatakSinir();
    [s.x1, s.x2].forEach((mx) => {
      ct.beginPath();
      for (let i = 0; i <= 8; i++) {
        const d = i / 8;
        const x = ekranX(mx, d), y = toprakY(d);
        if (i === 0) ct.moveTo(x, y); else ct.lineTo(x, y);
      }
      ct.strokeStyle = "rgba(255,240,214,0.14)";
      ct.lineWidth = 1;
      ct.stroke();
    });
  }

  const sahneCiz = guvenli("sahne", function (dt) {
    const ct = S.sahneCt;
    if (!ct || !S.en || !S.boy) return;
    if (S.zeminImza !== zeminImza()) zeminCiz();
    // Yumuşak gezinme: parmak bırakıldığında sahne yerine oturuyor.
    if (Math.abs(S.kaydirHedef - S.kaydir) > 0.4)
      S.kaydir += (S.kaydirHedef - S.kaydir) * kis(dt * 9, 0, 1);
    else S.kaydir = S.kaydirHedef;

    ct.clearRect(0, 0, S.en, S.boy);
    if (S.zemin) ct.drawImage(S.zemin, 0, 0, S.en, S.boy);
    yatakUcCiz(ct);

    const liste = S.bitki.slice().sort((a, b) => derinlik(a.y) - derinlik(b.y));
    for (const b of liste) b._m = bitkiOlcu(b);
    bosYerCiz(ct);
    for (const b of liste) bitkiCiz(ct, b, b.ad === S.secili, b.ad === S.uzerinde);
    robotCiz(ct);
    zerreCiz(ct, dt);
    S.kirli = false;
  });

  /* ==================================================================== *
   * TUVAL ÖLÇÜSÜ
   * ==================================================================== */
  const olcuKur = guvenli("ölçü", function () {
    const kok = $("#bh-tuval");
    if (!kok || !S.sahne) return;
    const r = kok.getBoundingClientRect();
    const en = Math.max(200, Math.round(r.width));
    const boy = Math.max(180, Math.round(r.height));
    const dpr = kis(window.devicePixelRatio || 1, 1, 2);
    if (en === S.en && boy === S.boy && dpr === S.dpr) return;
    S.en = en; S.boy = boy; S.dpr = dpr;
    [S.zemin, S.sahne].forEach((c) => {
      c.width = Math.round(en * dpr);
      c.height = Math.round(boy * dpr);
      c.style.width = en + "px";
      c.style.height = boy + "px";
      c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    geometriKur();
    zeminCiz();
    isteKare();
  });

  /* ==================================================================== *
   * İŞ ŞERİDİ — gökyüzünün üstündeki tek cümle.
   *
   * Sunucu bir kart LİSTESİ döndürüyor; ekran o listeyi bir sütuna
   * dizmiyor. Aynı anda tek bir iş görünüyor, gerekçesiyle ve kanıtıyla;
   * başka iş varsa sayıyla ve iki okla geçiliyor. Liste veri; cümle
   * arayüz.
   * ==================================================================== */
  function acikKartlar() {
    const k = ((S.veri && S.veri.kartlar) || []).slice();
    // Ertelenenler listenin sonunda: kaybolmuyorlar, öne de geçmiyorlar.
    k.sort((a, b) => (a.ertelendi ? 1 : 0) - (b.ertelendi ? 1 : 0));
    return k;
  }
  function suankiKart() {
    const k = acikKartlar();
    if (!k.length) return null;
    if (S.kartIx >= k.length) S.kartIx = 0;
    if (S.kartIx < 0) S.kartIx = k.length - 1;
    return k[S.kartIx];
  }

  const isYaz = guvenli("iş şeridi", function () {
    const kok = $("#bh-is");
    if (!kok) return;
    const k = suankiKart();
    const hepsi = acikKartlar();
    const bagli = !!(S.veri && S.veri.bagli);

    const metin = $("#bh-is-metin"), neden = $("#bh-is-neden");
    const evet = $("#bh-is-evet"), ertele = $("#bh-is-ertele");
    const sayac = $("#bh-is-sayac");

    if (!k) {
      metin.textContent = S.veri ? "Bugün bekleyen iş yok." : "Bahçe okunuyor…";
      neden.innerHTML = "";
      evet.hidden = true; ertele.hidden = true; sayac.hidden = true;
      $("#bh-is-geri").hidden = true; $("#bh-is-ileri").hidden = true;
      return;
    }

    metin.textContent = `${k.simge || ""} ${k.baslik || ""}`.trim();
    const parca = [];
    if (k.aciklama) parca.push(`<span class="bh-ac">${kacisli(k.aciklama)}</span>`);
    // TAHMİN İŞARETLİ KALIYOR: kanıtın ne olduğu cümlenin yanında yazıyor.
    if (k.kanit) {
      parca.push(`<span class="bh-kanit${k.tahmin ? " tahmin" : ""}">`
        + `${k.tahmin ? "tahmin · " : "ölçüm · "}${kacisli(k.kanit)}</span>`);
    }
    if (k.ertelendi) {
      parca.push(`<span class="bh-ert">${kacisli(k.ertelendi_yazi || "ertelendi")}`
        + ` · <button type="button" data-bh="ertele-iptal">geri al</button></span>`);
    }
    neden.innerHTML = parca.join("");

    evet.hidden = false;
    evet.textContent = k.evet || "Yap";
    // MAKİNE KOPUKSA İŞ BAŞLAMAZ: düğme açık görünmüyor, sebebi yazılı.
    const makineli = k.tip !== "ek";
    evet.disabled = makineli && !bagli;
    evet.title = evet.disabled ? "Makine bağlı değil" : "";
    ertele.hidden = !!k.ertelendi;

    const cok = hepsi.length > 1;
    sayac.hidden = !cok;
    sayac.textContent = cok ? `${S.kartIx + 1}/${hepsi.length}` : "";
    $("#bh-is-geri").hidden = !cok;
    $("#bh-is-ileri").hidden = !cok;
  });

  /* ==================================================================== *
   * MAKİNE DURUMU — kendi kutusu yok; şeridin başındaki nokta ve kolun
   * sönük çizilmesi. Kopukken makineye iş verdiren her düğme kilitli.
   * ==================================================================== */
  const makineYaz = guvenli("makine", function () {
    const el = $("#bh-makine");
    if (!el) return;
    const v = S.veri || {};
    const kuyruk = v.kuyruk || {};
    const bekleyen = sayi(kuyruk.bekleyen, 0), calisan = sayi(kuyruk.calisan, 0);
    let sinif = "yok", yazi = "makine bağlı değil";
    if (v.bagli && (v.mesgul || calisan)) {
      sinif = "mesgul";
      const is = ((kuyruk.isler || []).find((i) => i.durum === "calisiyor") || {});
      yazi = is.etiket ? `çalışıyor · ${is.etiket}` : "çalışıyor";
    } else if (v.bagli) {
      sinif = "hazir";
      yazi = bekleyen ? `hazır · ${bekleyen} iş sırada` : "hazır";
    }
    el.className = "bh-makine " + sinif;
    el.textContent = yazi;
  });

  /* ==================================================================== *
   * KİMLİK ŞERİDİ — seçili bitkinin künyesi ve eylemleri.
   * ==================================================================== */
  function nemYazi(b) {
    const n = nemDurum(b);
    if (!n.var) return { yazi: "nem ölçülmedi", sinif: "yok" };
    const y = `%${Math.round(n.yuzde)}`;
    if (n.bayat) return { yazi: `${y} · sulamadan önceki okuma`, sinif: "bayat" };
    if (!n.kendi) return { yazi: `${y} · ${Math.round(n.uzak)} mm öteden ödünç`,
                           sinif: "odunc" };
    return { yazi: `${y} · ${sureKisa(n.yas)} önce ölçüldü`, sinif: "olculdu" };
  }

  const kimlikYaz = guvenli("kimlik", function () {
    const kok = $("#bh-kimlik");
    if (!kok) return;
    const b = S.ix[S.secili];
    const bagli = !!(S.veri && S.veri.bagli);
    if (!b) {
      kok.dataset.bos = "1";
      kok.innerHTML =
        '<div class="bh-k-bos">Bir bitkiye dokun — künyesi ve işleri burada açılır.'
        + '</div><div class="bh-k-eylem">'
        + '<button type="button" data-bh="ek-ac">Yeni bitki ek</button></div>';
      return;
    }
    kok.dataset.bos = "0";
    const n = nemYazi(b);
    const yas = sayi(b.yas_gun, 0), olgun = sayi(b.olgun_gun, 0);
    const oran = kis(sayi(b.olgunluk), 0, 1);
    const olculer = [
      `<span class="bh-ol"><b>${Math.round(yas)}</b> günlük${olgun
        ? ` · olgunluk ${Math.round(olgun)} gün` : ""}</span>`,
      `<span class="bh-ol nem ${n.sinif}">${kacisli(n.yazi)}</span>`,
      b.sulama_ts ? `<span class="bh-ol">son sulama ${kacisli(tarih(b.sulama_ts))}</span>`
                  : '<span class="bh-ol yok">hiç sulanmadı</span>',
    ];
    if (b.susadi) {
      olculer.unshift(`<span class="bh-ol susadi">susadı · ${
        kacisli(b.su_kanit === "olculen" ? "ölçüme göre" : "geçen güne göre (tahmin)")
      }</span>`);
    }
    if (b.hasat) olculer.push('<span class="bh-ol hasat">hasada hazır</span>');

    kok.innerHTML =
      `<div class="bh-k-bas">
         <span class="bh-k-simge">${kacisli(b.simge || "🌱")}</span>
         <span class="bh-k-ad">${kacisli(b.ad)}</span>
         <span class="bh-k-tur">${kacisli(b.tur_ad || b.tur || "")}</span>
         <span class="bh-k-cubuk"><i style="width:${(oran * 100).toFixed(0)}%"></i></span>
       </div>
       <div class="bh-k-olcu">${olculer.join("")}</div>
       <div class="bh-k-eylem">
         <button type="button" data-bh="sula" ${bagli ? "" : "disabled"}>Sula</button>
         <button type="button" data-bh="olc" ${bagli ? "" : "disabled"}>Nemini ölç</button>
         <button type="button" data-bh="git" ${bagli ? "" : "disabled"}>Üstüne git</button>
         <button type="button" data-bh="ek-ac">Yeni ek</button>
         <button type="button" data-bh="kapat" class="sade">Bırak</button>
       </div>`;
  });

  /* ==================================================================== *
   * ONAY — geri alınamaz iş önce ne olacağını yazar.
   * ==================================================================== */
  let onayCoz = null;
  function onayIste(baslik, satirlar, evetYazi, uyari) {
    const kip = $("#bh-onay");
    if (!kip) return Promise.resolve(false);
    // Üst üste onay: öncekini reddedilmiş sayıyoruz, askıda söz kalmasın.
    if (onayCoz) { const e = onayCoz; onayCoz = null; e(false); }
    $("#bh-onay-bas").textContent = baslik;
    $("#bh-onay-metin").innerHTML = (satirlar || [])
      .map((s) => `<li>${kacisli(s)}</li>`).join("");
    const u = $("#bh-onay-uyari");
    u.hidden = !uyari;
    u.textContent = uyari || "";
    $("#bh-onay-evet").textContent = evetYazi || "Onayla";
    kip.hidden = false;
    return new Promise((coz) => { onayCoz = coz; });
  }
  function onayKapat(sonuc) {
    const kip = $("#bh-onay");
    if (kip) kip.hidden = true;
    const c = onayCoz;
    onayCoz = null;
    if (c) c(!!sonuc);
  }

  /* ==================================================================== *
   * İŞLER
   * ==================================================================== */
  async function isGonder(tip, adlar, ek) {
    if (!(S.veri && S.veri.bagli)) { notYaz("is", "Makine bağlı değil."); return null; }
    try {
      const c = await gonder("/api/bahce/is",
        Object.assign({ tip, noktalar: adlar }, ek || {}));
      notYaz("is", "");
      S.sonIs = (c && c.is) || null;
      if (tip === "sula") sulamaZerresi(adlar);
      gunluk(`bahçe: ${tip} · ${adlar.length} bitki`);
      await veriYukle();
      return c;
    } catch (h) {
      notYaz("is", `İş sıraya girmedi: ${(h && h.message) || h}`);
      isteKare();
      return null;
    }
  }
  function sulamaZerresi(adlar) {
    for (const ad of adlar) {
      const b = S.ix[ad];
      if (!b || !b._m) continue;
      zerreEk(b._m.x, Math.max(10, G.gokAlt - 30), b._m.taban);
    }
    isteKare();
  }

  const eylemSula = guvenli("sula", async function (adlar) {
    if (!adlar.length) return;
    const sn = adlar.length === 1 ? sayi((S.ix[adlar[0]] || {}).sulama_saniye, 0) : 0;
    const ok = await onayIste("Sulama başlasın mı?", [
      `${adlar.length} bitki sulanacak: ${adlar.slice(0, 6).join(", ")}`
        + (adlar.length > 6 ? ` ve ${adlar.length - 6} tane daha` : ""),
      sn ? `Her bitkide su ${Math.round(sn)} saniye açık kalacak.`
         : "Süre her bitkinin kendi ayarından alınacak.",
      "Makine sırayla her bitkinin üstüne gidecek ve vanayı açacak.",
    ], "Sula");
    if (ok) await isGonder("sula", adlar);
  });

  const eylemOlc = guvenli("ölç", async function (adlar) {
    if (!adlar.length) return;
    const ok = await onayIste("Nem ölçülsün mü?", [
      `${adlar.length} bitkinin toprağına prob batırılacak.`,
      "Ölçüm bitince ekran tahmin etmeyi bırakıp ölçüyü gösterir.",
    ], "Ölç");
    if (ok) await isGonder("nem", adlar);
  });

  const eylemFoto = guvenli("fotoğraf", async function (adlar) {
    if (!adlar.length) return;
    const ok = await onayIste("Fotoğraf çekilsin mi?", [
      `${adlar.length} bitkinin üstüne gidilip fotoğraf çekilecek.`,
    ], "Çek");
    if (ok) await isGonder("foto", adlar);
  });

  const eylemGit = guvenli("git", async function (ad) {
    const ok = await onayIste("Makine oraya gitsin mi?", [
      `${ad} bitkisinin üstüne gidilecek. Hiçbir şey ekilmez, sulanmaz.`,
    ], "Git");
    if (ok) await isGonder("gez", [ad]);
  });

  const eylemErtele = guvenli("ertele", async function (kimlik, iptal) {
    try {
      await gonder("/api/bahce/ertele", { kimlik, iptal: !!iptal });
      await veriYukle();
    } catch (h) { notYaz("ertele", `Erteleme olmadı: ${(h && h.message) || h}`); }
  });

  /* ==================================================================== *
   * EKİM — tür seç, boş yere dokun, onayla.
   *
   * Tür şeridi yok: türler bir kip içinde açılıyor, seçilince sahnedeki
   * boş yerler o türün yayılımına göre yeniden hesaplanıyor. Yani tür
   * seçimi bir listeden değil, yatağın kendisinden okunuyor.
   * ==================================================================== */
  function turListesi() {
    const v = S.veri || {};
    const hazne = new Set(v.hazne_turleri || []);
    return (v.turler || []).map((t) => ({
      slug: t.slug, ad: t.ad || t.slug, simge: t.simge || "🌱",
      renk: t.renk, yayilim_mm: sayi(t.yayilim_mm, 0), hazne: hazne.has(t.slug),
    })).filter((t) => t.yayilim_mm > 0)
      .sort((a, b) => (a.hazne === b.hazne ? a.ad.localeCompare(b.ad, "tr")
                                          : (a.hazne ? -1 : 1)));
  }

  const turKipiAc = guvenli("tür kipi", function () {
    const kip = $("#bh-kip");
    if (!kip) return;
    const liste = turListesi();
    const govde = $("#bh-kip-govde");
    if (!liste.length) {
      govde.innerHTML = '<p class="bh-bos">Yayılım çapı yazılı tür yok — '
        + 'Türler sayfasından çap girmeden ekim yapılamaz.</p>';
    } else {
      govde.innerHTML = liste.map((t) => `
        <button type="button" class="bh-tur${t.hazne ? "" : " bos-hazne"}"
                data-bh="tur-sec" data-slug="${kacisli(t.slug)}">
          <span class="bh-tur-simge">${kacisli(t.simge)}</span>
          <span class="bh-tur-ad">${kacisli(t.ad)}</span>
          <span class="bh-tur-cap">${Math.round(t.yayilim_mm)} mm</span>
          ${t.hazne ? '<span class="bh-tur-rozet">haznede</span>'
                    : '<span class="bh-tur-rozet uyari">hazne boş</span>'}
        </button>`).join("");
    }
    kip.hidden = false;
  });

  const turSec = guvenli("tür seç", async function (slug) {
    const t = turListesi().find((x) => x.slug === slug);
    if (!t) return;
    $("#bh-kip").hidden = true;
    S.ekimTur = t;
    S.bosYer = [];
    notYaz("ekim", `${t.simge} ${t.ad} · boş yerler aranıyor…`);
    try {
      const c = await api(`/api/bahce/bos-yer?tur=${encodeURIComponent(slug)}&azami=96`);
      const r = sayi(c.yayilim_mm, t.yayilim_mm);
      S.bosYer = (c.yerler || []).map((y) => ({ x: sayi(y.x), y: sayi(y.y), r_mm: r }));
      if (!S.bosYer.length) {
        notYaz("ekim", `${t.ad} için boş yer yok — yayılımı ${Math.round(r)} mm.`);
      } else {
        notYaz("ekim", `${t.simge} ${t.ad} · ${S.bosYer.length} boş yer`
          + `${c.sinirda ? "+" : ""} — birine dokun. (Esc: vazgeç)`
          + (t.hazne ? "" : " · haznede bu tohum görünmüyor"));
      }
    } catch (h) {
      S.ekimTur = null;
      notYaz("ekim", `Boş yer hesaplanamadı: ${(h && h.message) || h}`);
    }
    isteKare();
  });

  function ekimBirak() {
    S.ekimTur = null;
    S.bosYer = [];
    notYaz("ekim", "");
    isteKare();
  }

  const ekimOnayla = guvenli("ekim", async function (yer) {
    const t = S.ekimTur;
    if (!t || !yer) return;
    const satir = [
      `${t.ad} tohumu X ${Math.round(yer.x)} mm, Y ${Math.round(yer.y)} mm noktasına`
        + " ekilecek.",
      "Nokta hemen yaratılır; ekim işi kuyruğa girer ve makine sırası gelince eker.",
      `Bu tür yatakta ${Math.round(t.yayilim_mm)} mm yer kaplayacak.`,
    ];
    const ok = await onayIste(`${t.simge} ${t.ad} ekilsin mi?`, satir, "Ek",
      t.hazne ? "" : "Haznede bu tohum görünmüyor — makine boşa ekebilir.");
    if (!ok) return;
    try {
      const c = await gonder("/api/bahce/ek", { tur: t.slug, yerler: [{ x: yer.x, y: yer.y }] });
      const yeni = (c.noktalar || [])[0];
      ekimBirak();
      await veriYukle();
      if (yeni && yeni.ad) { S.secili = String(yeni.ad); kimlikYaz(); isteKare(); }
    } catch (h) {
      notYaz("ekim", `Ekilemedi: ${(h && h.message) || h}`);
    }
  });

  /* ==================================================================== *
   * ETKİLEŞİM
   *
   * Tıklama hedefi bitkinin silueti VE altındaki nem sütunu: kesitte ikisi
   * aynı bitki. Önde duran kazanıyor — üst üste binenlerde beklenen bu.
   * ==================================================================== */
  function noktaBitki(px, py) {
    let bul = null;
    for (const b of S.bitki) {
      const m = b._m || (b._m = bitkiOlcu(b));
      const yariEn = Math.max(9, m.en * 0.5);
      const ustte = py >= m.taban - m.boy - 6 && py <= m.taban + 6;
      const kesitte = py > G.kesitUst && py < G.kesitAlt;
      if (Math.abs(px - m.x) <= yariEn && (ustte || kesitte)) {
        if (!bul || m.d > bul._m.d) bul = b;
      }
    }
    return bul;
  }
  function noktaBosYer(px, py) {
    for (const p of (S.bosYer || [])) {
      const d = derinlik(p.y);
      const x = ekranX(p.x, d), y = toprakY(d);
      const r = Math.max(9, sayi(p.r_mm, 60) * 0.5 * G.pxMM * olcekD(d));
      const dx = (px - x) / r, dy = (py - y) / (r * 0.45);
      if (dx * dx + dy * dy <= 1) return p;
    }
    return null;
  }
  function kaydirKis(v) {
    const sinir = S.en * 0.2;
    return kis(v, -sinir, sinir);
  }

  let bas = null;
  const tuvalBasti = guvenli("dokunma", function (e) {
    const r = S.sahne.getBoundingClientRect();
    bas = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top,
            kaydir: S.kaydirHedef, surukle: false };
    S.sahne.setPointerCapture && S.sahne.setPointerCapture(e.pointerId);
  });
  const tuvalKaydi = guvenli("gezinme", function (e) {
    const r = S.sahne.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (bas) {
      const dx = e.clientX - bas.x;
      if (!bas.surukle && Math.abs(dx) > 6) bas.surukle = true;
      if (bas.surukle) {
        S.kaydirHedef = kaydirKis(bas.kaydir + dx);
        isteKare();
        return;
      }
    }
    const b = noktaBitki(px, py);
    const ad = b ? b.ad : "";
    if (ad !== S.uzerinde) {
      S.uzerinde = ad;
      S.sahne.style.cursor = b || noktaBosYer(px, py) ? "pointer" : "default";
      isteKare();
    }
  });
  const tuvalBirakti = guvenli("seçim", function (e) {
    if (!bas) return;
    const surukle = bas.surukle;
    const r = S.sahne.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    bas = null;
    if (surukle) return;
    const yer = S.ekimTur ? noktaBosYer(px, py) : null;
    if (yer) { ekimOnayla(yer); return; }
    const b = noktaBitki(px, py);
    S.secili = b ? b.ad : "";
    kimlikYaz();
    isteKare();
  });

  const tusBasti = guvenli("tuş", function (e) {
    if (!S.acik) return;
    if (e.key === "Escape") {
      if (onayCoz) { onayKapat(false); return; }
      if ($("#bh-kip") && !$("#bh-kip").hidden) { $("#bh-kip").hidden = true; return; }
      if (S.ekimTur) { ekimBirak(); return; }
      if (S.secili) { S.secili = ""; kimlikYaz(); isteKare(); }
      return;
    }
    if (e.key === "ArrowRight") { S.kartIx++; isYaz(); }
    else if (e.key === "ArrowLeft") { S.kartIx--; isYaz(); }
  });

  /** Kartın "evet" düğmesi: kart tipi hangi işe karşılık geliyorsa o. */
  const kartEvet = guvenli("kart eylemi", function () {
    const k = suankiKart();
    if (!k) return;
    const adlar = (k.noktalar || []).map(String);
    if (k.tip === "sula") eylemSula(adlar);
    else if (k.tip === "nem") eylemOlc(adlar);
    else if (k.tip === "hasat") eylemFoto(adlar);
    else if (k.tip === "ek") turKipiAc();
  });

  const tiklamaYonet = guvenli("düğme", function (e) {
    const d = e.target.closest("[data-bh]");
    if (!d) return;
    const ad = d.dataset.bh;
    const b = S.ix[S.secili];
    if (ad === "ek-ac") turKipiAc();
    else if (ad === "tur-sec") turSec(d.dataset.slug);
    else if (ad === "sula" && b) eylemSula([b.ad]);
    else if (ad === "olc" && b) eylemOlc([b.ad]);
    else if (ad === "git" && b) eylemGit(b.ad);
    else if (ad === "kapat") { S.secili = ""; kimlikYaz(); isteKare(); }
    else if (ad === "ertele-iptal") {
      const k = suankiKart();
      if (k) eylemErtele(k.kimlik, true);
    }
  });

  const olaylariBagla = guvenli("bağlama", function () {
    S.sahne.addEventListener("pointerdown", tuvalBasti);
    S.sahne.addEventListener("pointermove", tuvalKaydi);
    S.sahne.addEventListener("pointerup", tuvalBirakti);
    S.sahne.addEventListener("pointercancel", () => { bas = null; });
    S.sahne.addEventListener("pointerleave", () => {
      if (S.uzerinde) { S.uzerinde = ""; isteKare(); }
    });
    $("#bh-kok").addEventListener("click", tiklamaYonet);
    $("#bh-is-evet").addEventListener("click", kartEvet);
    $("#bh-is-ertele").addEventListener("click", () => {
      const k = suankiKart();
      if (k) eylemErtele(k.kimlik, false);
    });
    $("#bh-is-geri").addEventListener("click", () => { S.kartIx--; isYaz(); });
    $("#bh-is-ileri").addEventListener("click", () => { S.kartIx++; isYaz(); });
    $("#bh-sakin").addEventListener("click", () => {
      S.sakin = !S.sakin;
      $("#bh-sakin").setAttribute("aria-pressed", S.sakin ? "true" : "false");
      $("#bh-sakin").textContent = S.sakin ? "sakin mod açık" : "sakin mod";
      // Sakin modda hareket duruyor ama BİLGİ durmuyor: sahne son hâliyle
      // duruyor, sayılar güncellenmeye devam ediyor.
      if (!S.sakin) isteKare();
    });
    $("#bh-kip-kapat").addEventListener("click", () => { $("#bh-kip").hidden = true; });
    $("#bh-onay-evet").addEventListener("click", () => onayKapat(true));
    $("#bh-onay-hayir").addEventListener("click", () => onayKapat(false));
    document.addEventListener("keydown", tusBasti);
    window.addEventListener("resize", olcuKur);
  });

  /* ==================================================================== *
   * VERİ
   *
   * `/api/bahce` bir kart listesi + bir bitki listesi döndürüyor. Ekran o
   * sırayı çizmiyor: bitkiler yatağın X/Y'sine göre yerleşiyor, kartlar
   * tek cümleye iniyor. Veri ne olduğunu söylüyor, düzeni kesit veriyor.
   * ==================================================================== */
  function bitkileriHazirla() {
    const v = S.veri || {};
    S.bitki = (v.bitkiler || []).filter((b) => b && b.ad != null);
    S.ix = {};
    for (const b of S.bitki) { b._m = null; S.ix[String(b.ad)] = b; }
    if (S.secili && !S.ix[S.secili]) S.secili = "";
    if (S.uzerinde && !S.ix[S.uzerinde]) S.uzerinde = "";
  }

  const veriYukle = guvenli("veri", async function () {
    if (S.yukleniyor) return;
    S.yukleniyor = true;
    try {
      const c = await api("/api/bahce");
      S.veri = c || {};
      bitkileriHazirla();
      geometriKur();
      zeminCiz();                     // yatak sınırları değişmiş olabilir
      notYaz("veri", "");
      isYaz(); makineYaz(); kimlikYaz();
      isteKare();
    } catch (h) {
      // SESSİZ BAŞARISIZLIK YOK: sahne boş kalırsa sebebi ekranda yazıyor.
      hataYaz("veri", h);
      notYaz("veri", "Bahçe okunamadı — makine ya da sunucu yanıt vermedi.");
    } finally {
      S.yukleniyor = false;
    }
  });

  /* ==================================================================== *
   * KURULUM
   * ==================================================================== */
  let kuruldu = false;
  const kur = guvenli("kurulum", function () {
    if (kuruldu) return true;
    S.zemin = $("#bh-zemin");
    S.sahne = $("#bh-sahne");
    if (!S.zemin || !S.sahne) { hataYaz("kurulum", new Error("tuval bulunamadı")); return false; }
    S.zeminCt = S.zemin.getContext("2d");
    S.sahneCt = S.sahne.getContext("2d", { alpha: true });
    olaylariBagla();
    kuruldu = true;
    return true;
  });

  let sayacId = 0;
  function sayacKur(acik) {
    if (sayacId) { clearInterval(sayacId); sayacId = 0; }
    // Panel Pi'de duruyor: açık sekme dakikada iki kez soruyor, kapalı
    // sekme hiç sormuyor.
    if (acik) sayacId = setInterval(() => { if (S.acik) veriYukle(); }, 30000);
  }

  /* ==================================================================== *
   * DIŞ ARAYÜZ — app.js buradan çağırıyor.
   * ==================================================================== */
  const dis = {
    sekme(acik) {
      S.acik = !!acik;
      document.body.classList.toggle("bahce-acik", S.acik);
      sayacKur(S.acik);
      if (!S.acik) {
        if (S.dongu) { cancelAnimationFrame(S.dongu); S.dongu = 0; }
        return;
      }
      if (!kur()) return;
      requestAnimationFrame(() => { olcuKur(); veriYukle(); });
    },
    /* Kamera karesi: kesitte kamera görüntüsünün yeri yok — sahnenin
       köşesinde yüzen bir kutu istemiyoruz. Kare Kamera sekmesinde. */
    kareGeldi() { /* boş — bilerek */ },
    durumDegisti(d) {
      if (!S.acik || !d) return;
      S.veri = S.veri || {};
      if (d.konum) S.veri.konum = d.konum;
      if ("bagli" in d) S.veri.bagli = d.bagli;
      if ("mesgul" in d) S.veri.mesgul = d.mesgul;
      if ("toprak_z" in d) S.veri.toprak_z = d.toprak_z;
      makineYaz(); isYaz(); kimlikYaz(); isteKare();
    },
    kuyrukDegisti(k) {
      if (!S.acik) return;
      S.veri = S.veri || {};
      if (k) S.veri.kuyruk = k;
      makineYaz();
      // Bir iş bittiğinde tablo değişmiş olabilir; veriyi tazeliyoruz.
      veriYukle();
    },
    ekimDegisti() { if (S.acik) veriYukle(); },
    baglandi() { if (S.acik) veriYukle(); },
    yenile() { return veriYukle(); },
    /** Kare süresi ölçümü — 24 bitkilik sahnede kaç ms sürdüğünü söyler. */
    olcum(sifirla) {
      const o = S.olcum;
      const c = { kare: o.kare, ortalama: o.kare ? +(o.sure / o.kare).toFixed(2) : 0,
                  enUzun: +o.enUzun.toFixed(2), bitki: S.bitki.length,
                  en: S.en, boy: S.boy, dpr: S.dpr };
      if (sifirla) { o.kare = 0; o.sure = 0; o.enUzun = 0; }
      return c;
    },
  };
  return dis;
}());
