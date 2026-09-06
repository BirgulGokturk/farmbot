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
    ekimTur: null, bosYer: [], isKip: "kart",
    katalog: null, katalogT: 0,       // /api/turler — ekim derinliği
    gecmis: null, gecmisAd: "", gecmisT: 0,   // seçili bitkinin nem geçmişi
    islanma: {}, ekim: {},            // canlı olayların bitki başına durumu
    rob: null, suIs: null, ekIs: null, olayAd: "",
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
   * BİTKİ SİLUETİ — yandan, TÜRE GÖRE.
   *
   * Planda bitki bir daireydi ve hepsi birbirinin aynıydı. Kesitte bitki
   * bir siluet: türü BİÇİMİNDEN okunuyor. Marul rozet açıyor, havuç tüy
   * salıyor, soğan boru gibi dikiliyor, domates dallanıyor, kabak yere
   * yayılıyor, mısır tek sap uzatıyor. Yaş ve olgunluk boyu ve yaprak
   * sayısını sürüyor; tür biçimi onun YERİNE değil, ONUNLA çalışıyor.
   *
   * Toprak çizgisinin ALTI da türe göre: havucun kazık kökü aşağı iner,
   * marulun saçak kökü yüzeyde yayılır, soğanın yumrusu hemen altta
   * durur. Kesitin en güçlü tarafı bu ve boş duruyordu.
   *
   * BİÇİM BİR ÖLÇÜ DEĞİL. Kök derinliği hiçbir yerde ÖLÇÜLMÜYOR; katalog
   * yalnız türün kök TİPİNİ biliyor. Bu yüzden köke milimetre yazmıyoruz
   * ve kimlik şeridinde "tür biçimi, ölçülmedi" diye duruyor. Tür
   * tanınmıyorsa uydurma bir havuç çizilmiyor: jenerik biçim kesik
   * çizgiyle çiziliyor ve tanınmadığı yazıyor.
   *
   * Siluet önbelleğe bir kez çiziliyor; sahneye tek drawImage.
   * ==================================================================== */
  const SPRITE_EN = 128; // önbellek tuvalinin genişliği (px)
  const RAY_BOSLUK = 34; // makine rayının altında boş kalan şerit (px)

  /* Üst biçimler ve her birinin boy/en oranı. */
  const UST_ORAN = {
    rozet: 0.62, tuy: 1.10, boru: 1.35, cali: 1.30, sarilan: 1.55,
    yayilan: 0.48, sap: 1.75, bas: 1.90, yumruust: 0.75, bilinmiyor: 0.90,
  };
  /* Kök tipleri ve insan diliyle karşılığı — kimlik şeridi bunu yazıyor. */
  const KOK_ADI = {
    kazik: "kazık kök", "kazik-etli": "etli kazık kök", sacak: "saçak kök",
    sogan: "soğan (yumru) kök", yumru: "yumru kök", derin: "derin dallı kök",
    bilinmiyor: "kök tipi bilinmiyor",
  };

  /* TÜR BİÇİM KATALOĞU — `docs/bitki_turleri.json` içindeki 37 türün
     tamamı. Buradaki şey ÖLÇÜ değil BİÇİM: hangi siluetle çizileceği.
     Listede olmayan bir slug jenerik biçme düşüyor ve bunu saklamıyor. */
  const TUR_BICIM = {
    aycicegi: ["bas", "kazik"], bamya: ["cali", "kazik"],
    bezelye: ["sarilan", "sacak"], biber: ["cali", "sacak"],
    biberiye: ["cali", "derin"], brokoli: ["rozet", "sacak"],
    dereotu: ["tuy", "kazik"], domates: ["cali", "derin"],
    fasulye: ["sarilan", "sacak"], "fesleğen": ["cali", "sacak"],
    feslegen: ["cali", "sacak"], havuc: ["tuy", "kazik-etli"],
    ispanak: ["rozet", "sacak"], kabak: ["yayilan", "derin"],
    karnabahar: ["rozet", "sacak"], karpuz: ["yayilan", "derin"],
    kavun: ["yayilan", "derin"], kekik: ["cali", "sacak"],
    kereviz: ["rozet", "sacak"], lahana: ["rozet", "sacak"],
    marul: ["rozet", "sacak"], maydanoz: ["tuy", "kazik"],
    misir: ["sap", "derin"], nane: ["cali", "sacak"],
    nohut: ["cali", "kazik"], patates: ["yumruust", "yumru"],
    patlican: ["cali", "derin"], pazi: ["rozet", "kazik"],
    pirasa: ["boru", "sacak"], roka: ["rozet", "sacak"],
    salatalik: ["yayilan", "sacak"], sarimsak: ["boru", "sogan"],
    semizotu: ["yayilan", "sacak"], sogan: ["boru", "sogan"],
    "tatli-patates": ["yayilan", "yumru"], turp: ["rozet", "kazik-etli"],
    cilek: ["yayilan", "sacak"], uzum: ["sarilan", "derin"],
  };

  /** Türün biçimi — bulunamazsa bunu SAKLAMIYOR, bilinmiyor diyor. */
  function turBicim(b) {
    const slug = String((b && b.tur) || "").toLowerCase();
    const t = TUR_BICIM[slug];
    if (t) return { ust: t[0], kok: t[1], bilinen: true, slug };
    return { ust: "bilinmiyor", kok: "bilinmiyor", bilinen: false, slug };
  }

  /* -------------------------------------------------------- çizim taşları */
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
  /** Dilimli geniş yaprak (kabakgiller): kenarı loblu, damarı belli. */
  function loblcuYaprak(ct, x, y, r, aci, renk) {
    ct.save();
    ct.translate(x, y);
    ct.rotate(aci);
    ct.beginPath();
    for (let i = 0; i <= 22; i++) {
      const t = (i / 22) * Math.PI * 2;
      const k = r * (0.78 + 0.22 * Math.cos(t * 5));
      const px = Math.cos(t) * k, py = Math.sin(t) * k * 0.52;
      if (i === 0) ct.moveTo(px, py); else ct.lineTo(px, py);
    }
    ct.closePath();
    ct.fillStyle = rgba(renk, 0.95);
    ct.fill();
    ct.strokeStyle = rgba(ton(renk, -0.35), 0.5);
    ct.lineWidth = 0.8;
    ct.stroke();
    ct.restore();
  }
  function meyveCiz(ct, x, y, c, renk) {
    ct.fillStyle = rgba(renk, 0.95);
    ct.beginPath(); ct.arc(x, y, c, 0, 6.3); ct.fill();
    ct.fillStyle = "rgba(255,255,255,0.30)";
    ct.beginPath(); ct.arc(x - c * 0.3, y - c * 0.35, c * 0.28, 0, 6.3); ct.fill();
  }

  /* ------------------------------------------------------------- biçimler */
  function cizRozet(ct, r, renk, turRenk, olgun, dus, en, boy) {
    const kx = en / 2, ky = boy - 2;
    const adet = Math.round(5 + olgun * 9);
    for (let i = 0; i < adet; i++) {
      const t = adet === 1 ? 0.5 : i / (adet - 1);
      const yan = t < 0.5 ? -1 : 1;
      const aci = -Math.PI / 2 + (t - 0.5) * 2.45 + (r() - 0.5) * 0.18;
      const uz = boy * (0.52 + 0.46 * (1 - Math.abs(t - 0.5) * 1.4)) * (0.82 + r() * 0.3);
      ct.fillStyle = rgba(ton(renk, -0.32 + (0.5 - Math.abs(t - 0.5)) * 0.62), 0.97);
      yaprakCiz(ct, kx + yan * 2, ky, uz, aci, uz * 0.30, dus * (0.35 + t * 0.2));
    }
    ct.fillStyle = rgba(ton(turRenk, 0.20), 0.85);
    ct.beginPath(); ct.ellipse(kx, ky - boy * 0.10, en * 0.055, boy * 0.07, 0, 0, 6.3);
    ct.fill();
  }

  function cizTuy(ct, r, renk, turRenk, olgun, dus, en, boy) {
    const kx = en / 2, ky = boy - 2;
    const adet = Math.round(4 + olgun * 7);
    ct.lineCap = "round";
    for (let i = 0; i < adet; i++) {
      const t = adet === 1 ? 0.5 : i / (adet - 1);
      const yon = (t - 0.5) * 2;
      const uz = boy * (0.60 + 0.40 * (1 - Math.abs(yon))) * (0.8 + r() * 0.35);
      const ucX = kx + yon * en * 0.30 * (0.7 + r() * 0.6);
      const ucY = ky - uz + dus * uz * 0.55;
      ct.strokeStyle = rgba(ton(renk, -0.18 + r() * 0.35), 0.95);
      ct.lineWidth = 1.6;
      ct.beginPath();
      ct.moveTo(kx, ky);
      ct.quadraticCurveTo(kx + yon * en * 0.10, ky - uz * 0.62, ucX, ucY);
      ct.stroke();
      ct.lineWidth = 1;
      for (let k = 1; k <= 5; k++) {
        const p = 0.42 + k * 0.11;
        const sx = kx + (ucX - kx) * p, sy = ky + (ucY - ky) * p;
        const l = en * 0.055 * (1 - p) * 3;
        ct.beginPath();
        ct.moveTo(sx - l, sy - l * 0.5); ct.lineTo(sx + l, sy + l * 0.5);
        ct.stroke();
      }
    }
  }

  /** Boru: soğan, sarımsak, pırasa — dik, silindirik, uçları sivri. */
  function cizBoru(ct, r, renk, turRenk, olgun, dus, en, boy) {
    const kx = en / 2, ky = boy - 2;
    const adet = Math.round(3 + olgun * 4);
    for (let i = 0; i < adet; i++) {
      const yon = (i % 2 ? 1 : -1) * (0.4 + (i / adet) * 0.9);
      const uz = boy * (0.72 + r() * 0.26);
      const ucX = kx + yon * en * 0.16;
      const ucY = ky - uz + dus * uz * 0.42;
      const gen = en * 0.055 * (1 - i / (adet + 2));
      ct.beginPath();
      ct.moveTo(kx - gen, ky);
      ct.quadraticCurveTo(kx + yon * en * 0.04, ky - uz * 0.6, ucX, ucY);
      ct.quadraticCurveTo(kx + yon * en * 0.04 + gen * 1.4, ky - uz * 0.6, kx + gen, ky);
      ct.closePath();
      ct.fillStyle = rgba(ton(renk, -0.25 + r() * 0.4), 0.95);
      ct.fill();
    }
    // Toprak üstündeki boyun: gövde yüzeyde şişkin başlıyor.
    ct.fillStyle = rgba(ton(turRenk, -0.05), 0.9);
    ct.beginPath();
    ct.ellipse(kx, ky - boy * 0.02, en * 0.09, boy * 0.045, 0, 0, 6.3);
    ct.fill();
  }

  function cizCali(ct, r, renk, turRenk, olgun, dus, en, boy, meyve) {
    const kx = en / 2, ky = boy - 2;
    const govde = boy * (0.55 + olgun * 0.35);
    ct.strokeStyle = rgba(ton(renk, -0.45), 1);
    ct.lineWidth = Math.max(1.5, en * 0.022);
    ct.lineCap = "round";
    ct.beginPath();
    ct.moveTo(kx, ky);
    ct.quadraticCurveTo(kx + (r() - 0.5) * en * 0.06, ky - govde * 0.6,
      kx + (r() - 0.5) * en * 0.10, ky - govde);
    ct.stroke();
    const dal = Math.round(3 + olgun * 4);
    for (let i = 0; i < dal; i++) {
      const t = (i + 0.7) / (dal + 0.4);
      const yan = i % 2 ? 1 : -1;
      const bx = kx, by = ky - govde * t;
      const uz = en * (0.20 + 0.26 * (1 - t)) * (0.75 + r() * 0.5);
      const uy = by - uz * 0.4 + dus * uz * 0.7;
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
        meyveCiz(ct, bx + (dx - bx) * 0.72, by + (uy - by) * 0.72 + uz * 0.22,
          en * (0.045 + r() * 0.03), turRenk);
      }
    }
  }

  /** Sarılan: fasulye, bezelye, üzüm — sırık ve ona dolanan sap. */
  function cizSarilan(ct, r, renk, turRenk, olgun, dus, en, boy, meyve) {
    const kx = en / 2, ky = boy - 2;
    const sirik = boy * (0.55 + olgun * 0.43);
    ct.strokeStyle = "rgba(150,124,92,0.8)";
    ct.lineWidth = Math.max(1.4, en * 0.018);
    ct.beginPath(); ct.moveTo(kx, ky); ct.lineTo(kx + en * 0.03, ky - sirik); ct.stroke();
    ct.strokeStyle = rgba(ton(renk, -0.3), 0.95);
    ct.lineWidth = Math.max(1.2, en * 0.014);
    ct.beginPath();
    const sar = Math.round(3 + olgun * 4);
    for (let i = 0; i <= sar * 8; i++) {
      const t = i / (sar * 8);
      const y = ky - sirik * t;
      const x = kx + Math.sin(t * sar * Math.PI * 2) * en * 0.085 + en * 0.03 * t;
      if (i === 0) ct.moveTo(x, y); else ct.lineTo(x, y);
    }
    ct.stroke();
    for (let i = 0; i < sar * 2; i++) {
      const t = (i + 0.5) / (sar * 2);
      const y = ky - sirik * t;
      const x = kx + Math.sin(t * sar * Math.PI * 2) * en * 0.085 + en * 0.03 * t;
      const yan = Math.cos(t * sar * Math.PI * 2) > 0 ? 1 : -1;
      ct.fillStyle = rgba(ton(renk, -0.15 + r() * 0.4), 0.95);
      yaprakCiz(ct, x, y, en * (0.12 + r() * 0.08),
        yan > 0 ? -0.5 : -2.6, en * 0.05, dus * 0.5);
      if (meyve && r() < 0.4) {
        // Baklagil kabuğu: yuvarlak meyve değil, sarkan bir kese.
        ct.save(); ct.translate(x + yan * en * 0.05, y + en * 0.04);
        ct.rotate(yan * 0.5);
        ct.fillStyle = rgba(turRenk, 0.9);
        ct.beginPath(); ct.ellipse(0, 0, en * 0.055, en * 0.018, 0, 0, 6.3); ct.fill();
        ct.restore();
      }
    }
  }

  /** Yayılan: kabak, karpuz, çilek — alçak, geniş, loblu yapraklı. */
  function cizYayilan(ct, r, renk, turRenk, olgun, dus, en, boy, meyve) {
    const kx = en / 2, ky = boy - 2;
    ct.strokeStyle = rgba(ton(renk, -0.4), 0.9);
    ct.lineWidth = Math.max(1.2, en * 0.014);
    const kol = Math.round(2 + olgun * 3);
    for (let i = 0; i < kol; i++) {
      const yan = i % 2 ? 1 : -1;
      const uz = en * (0.24 + 0.20 * (i / kol) + r() * 0.10);
      const ux = kx + yan * uz;
      ct.beginPath();
      ct.moveTo(kx, ky);
      ct.quadraticCurveTo(kx + yan * uz * 0.5, ky - boy * 0.30, ux, ky - boy * 0.10);
      ct.stroke();
      loblcuYaprak(ct, kx + yan * uz * 0.55, ky - boy * (0.30 + r() * 0.25),
        en * (0.13 + r() * 0.06), (r() - 0.5) * 0.5 + dus * 0.4,
        ton(renk, -0.2 + r() * 0.4));
      loblcuYaprak(ct, ux, ky - boy * (0.14 + r() * 0.2),
        en * (0.11 + r() * 0.05), (r() - 0.5) * 0.5 + dus * 0.4,
        ton(renk, -0.3 + r() * 0.4));
      if (meyve && i === 0) {
        meyveCiz(ct, kx + yan * uz * 0.75, ky - boy * 0.06, en * 0.075, turRenk);
      }
    }
  }

  /** Sap: mısır — tek gövde, uzun kavisli yapraklar, olgunsa koçan. */
  function cizSap(ct, r, renk, turRenk, olgun, dus, en, boy, meyve) {
    const kx = en / 2, ky = boy - 2;
    const h = boy * (0.62 + olgun * 0.36);
    ct.strokeStyle = rgba(ton(renk, -0.42), 1);
    ct.lineWidth = Math.max(1.8, en * 0.026);
    ct.beginPath(); ct.moveTo(kx, ky); ct.lineTo(kx, ky - h); ct.stroke();
    const yap = Math.round(3 + olgun * 4);
    for (let i = 0; i < yap; i++) {
      const t = (i + 0.6) / (yap + 0.6);
      const yan = i % 2 ? 1 : -1;
      const by = ky - h * t;
      const uz = en * (0.34 - 0.14 * t) * (0.85 + r() * 0.3);
      ct.beginPath();
      ct.moveTo(kx, by);
      ct.quadraticCurveTo(kx + yan * uz * 0.7, by - uz * 0.35 + dus * uz * 0.5,
        kx + yan * uz, by + uz * (0.18 + dus * 0.5));
      ct.quadraticCurveTo(kx + yan * uz * 0.6, by - uz * 0.12, kx, by + en * 0.012);
      ct.closePath();
      ct.fillStyle = rgba(ton(renk, -0.2 + r() * 0.35), 0.95);
      ct.fill();
    }
    if (meyve) {
      ct.save();
      ct.translate(kx + en * 0.05, ky - h * 0.45);
      ct.rotate(0.35);
      ct.fillStyle = rgba(turRenk, 0.95);
      ct.beginPath(); ct.ellipse(0, 0, en * 0.035, en * 0.10, 0, 0, 6.3); ct.fill();
      ct.restore();
    }
    // Tepe püskülü: mısırın en tanınır tarafı.
    ct.strokeStyle = rgba(ton(turRenk, 0.2), 0.8);
    ct.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ct.beginPath();
      ct.moveTo(kx, ky - h);
      ct.lineTo(kx + (i - 2) * en * 0.02, ky - h - en * (0.05 + r() * 0.04));
      ct.stroke();
    }
  }

  /** Baş: ayçiçeği — uzun sap, iri yapraklar, tepede tabak çiçek. */
  function cizBas(ct, r, renk, turRenk, olgun, dus, en, boy) {
    const kx = en / 2, ky = boy - 2;
    const h = boy * (0.60 + olgun * 0.38);
    ct.strokeStyle = rgba(ton(renk, -0.45), 1);
    ct.lineWidth = Math.max(1.8, en * 0.026);
    ct.beginPath(); ct.moveTo(kx, ky); ct.lineTo(kx, ky - h); ct.stroke();
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 5;
      const yan = i % 2 ? 1 : -1;
      ct.fillStyle = rgba(ton(renk, -0.2 + r() * 0.3), 0.95);
      yaprakCiz(ct, kx, ky - h * t, en * (0.22 - 0.06 * t),
        yan > 0 ? -0.5 : -2.65, en * 0.10, dus * 0.6);
    }
    const cap = en * (0.10 + olgun * 0.09);
    ct.fillStyle = rgba(ton(turRenk, 0.1), 0.95);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ct.beginPath();
      ct.ellipse(kx + Math.cos(a) * cap, ky - h + Math.sin(a) * cap * 0.9,
        cap * 0.45, cap * 0.22, a, 0, 6.3);
      ct.fill();
    }
    ct.fillStyle = "rgba(74,52,30,0.95)";
    ct.beginPath(); ct.arc(kx, ky - h, cap * 0.62, 0, 6.3); ct.fill();
  }

  /** Yumru üstü: patates — alçak, dolgun, çok yapraklı öbek. */
  function cizYumruUst(ct, r, renk, turRenk, olgun, dus, en, boy) {
    const kx = en / 2, ky = boy - 2;
    const dal = Math.round(3 + olgun * 3);
    for (let i = 0; i < dal; i++) {
      const yan = (i / (dal - 1 || 1) - 0.5) * 2;
      const uz = boy * (0.55 + r() * 0.4);
      const ux = kx + yan * en * 0.26, uy = ky - uz + dus * uz * 0.4;
      ct.strokeStyle = rgba(ton(renk, -0.4), 0.95);
      ct.lineWidth = Math.max(1, en * 0.014);
      ct.beginPath();
      ct.moveTo(kx, ky);
      ct.quadraticCurveTo(kx + yan * en * 0.10, ky - uz * 0.6, ux, uy);
      ct.stroke();
      for (let k = 0; k < 3; k++) {
        const p = 0.35 + k * 0.28;
        ct.fillStyle = rgba(ton(renk, -0.25 + r() * 0.45), 0.95);
        yaprakCiz(ct, kx + (ux - kx) * p, ky + (uy - ky) * p,
          en * (0.09 + r() * 0.05), k % 2 ? -0.7 : -2.45, en * 0.045, dus * 0.5);
      }
    }
  }

  /** Bilinmeyen tür: uydurma bir biçim değil, KESİK ÇİZGİLİ jenerik öbek. */
  function cizBilinmiyor(ct, r, renk, turRenk, olgun, dus, en, boy) {
    const kx = en / 2, ky = boy - 2;
    ct.save();
    ct.setLineDash([5, 4]);
    ct.strokeStyle = "rgba(226,222,208,0.75)";
    ct.lineWidth = 1.6;
    ct.beginPath();
    ct.moveTo(kx, ky);
    ct.lineTo(kx, ky - boy * 0.45);
    ct.stroke();
    const adet = Math.round(3 + olgun * 3);
    for (let i = 0; i < adet; i++) {
      const yan = (i / (adet - 1 || 1) - 0.5) * 2;
      ct.beginPath();
      ct.ellipse(kx + yan * en * 0.22, ky - boy * (0.5 + r() * 0.3),
        en * 0.13, boy * 0.12, yan * 0.4, 0, 6.3);
      ct.stroke();
    }
    ct.restore();
  }

  /* --------------------------------------------------------------- kökler */
  /** Kök siluetleri. Hepsi 0..1 aralığında çiziliyor: (0,0) sap dibi,
   *  (0,1) kesit bandının dibi. Ölçek çağıran tarafta. */
  function kokKazik(ct, r, en, boy, etli, renk) {
    const uz = boy * (etli ? 0.62 : 0.80);
    if (etli) {
      // Etli kazık kök ÜRÜNÜN kendisi: havuç, turp. Türün rengi burada.
      ct.beginPath();
      ct.moveTo(-en * 0.16, 0);
      ct.quadraticCurveTo(-en * 0.10, uz * 0.55, 0, uz);
      ct.quadraticCurveTo(en * 0.10, uz * 0.55, en * 0.16, 0);
      ct.closePath();
      ct.fillStyle = rgba(renk, 0.92);
      ct.fill();
      ct.strokeStyle = "rgba(255,255,255,0.16)";
      ct.lineWidth = 0.8;
      for (let i = 1; i <= 4; i++) {
        const t = i / 5;
        ct.beginPath();
        ct.moveTo(-en * 0.16 * (1 - t), uz * t);
        ct.lineTo(en * 0.16 * (1 - t), uz * t);
        ct.stroke();
      }
    } else {
      ct.strokeStyle = "rgba(232,214,182,0.85)";
      ct.lineWidth = Math.max(1, en * 0.035);
      ct.beginPath();
      ct.moveTo(0, 0);
      ct.quadraticCurveTo(en * 0.05, uz * 0.5, (r() - 0.5) * en * 0.14, uz);
      ct.stroke();
    }
    ct.strokeStyle = "rgba(232,214,182,0.7)";
    ct.lineWidth = Math.max(0.6, en * 0.016);
    for (let i = 0; i < 7; i++) {
      const t = 0.12 + (i / 7) * 0.8;
      const yan = i % 2 ? 1 : -1;
      ct.beginPath();
      ct.moveTo(0, uz * t);
      ct.quadraticCurveTo(yan * en * 0.10, uz * (t + 0.05),
        yan * en * (0.14 + r() * 0.10), uz * (t + 0.10));
      ct.stroke();
    }
  }
  function kokSacak(ct, r, en, boy) {
    // Saçak kök SIĞ ve GENİŞ: yüzeye yakın bir yelpaze.
    const uz = boy * 0.34;
    ct.strokeStyle = "rgba(232,214,182,0.78)";
    ct.lineCap = "round";
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const yan = (t - 0.5) * 2;
      ct.lineWidth = Math.max(0.6, en * (0.020 - Math.abs(yan) * 0.008));
      ct.beginPath();
      ct.moveTo(0, 0);
      ct.quadraticCurveTo(yan * en * 0.16, uz * 0.5,
        yan * en * (0.26 + r() * 0.12), uz * (0.7 + r() * 0.5));
      ct.stroke();
    }
  }
  function kokSogan(ct, r, en, boy, renk) {
    const cap = en * 0.19;
    ct.beginPath();
    ct.ellipse(0, cap * 0.75, cap, cap * 0.95, 0, 0, 6.3);
    ct.fillStyle = rgba(renk, 0.9);
    ct.fill();
    ct.strokeStyle = "rgba(0,0,0,0.18)";
    ct.lineWidth = 0.8;
    for (let i = -2; i <= 2; i++) {
      ct.beginPath();
      ct.ellipse(0, cap * 0.75, cap * (0.25 + Math.abs(i) * 0.2), cap * 0.9, 0,
        -Math.PI * 0.1, Math.PI * 1.1);
      ct.stroke();
    }
    ct.strokeStyle = "rgba(232,214,182,0.7)";
    ct.lineWidth = Math.max(0.6, en * 0.014);
    for (let i = 0; i < 8; i++) {
      const yan = (i / 7 - 0.5) * 2;
      ct.beginPath();
      ct.moveTo(yan * cap * 0.5, cap * 1.6);
      ct.lineTo(yan * en * (0.12 + r() * 0.08), cap * 1.6 + boy * (0.16 + r() * 0.14));
      ct.stroke();
    }
  }
  function kokYumru(ct, r, en, boy, renk) {
    const uz = boy * 0.48;
    ct.strokeStyle = "rgba(232,214,182,0.72)";
    ct.lineWidth = Math.max(0.8, en * 0.020);
    for (let i = 0; i < 5; i++) {
      const yan = (i / 4 - 0.5) * 2;
      const ux = yan * en * (0.10 + r() * 0.16), uy = uz * (0.35 + r() * 0.5);
      ct.beginPath();
      ct.moveTo(0, 0);
      ct.quadraticCurveTo(yan * en * 0.10, uy * 0.6, ux, uy);
      ct.stroke();
      // Yumrular sapın ucunda: patatesin kendisi.
      ct.save();
      ct.translate(ux, uy);
      ct.rotate(yan * 0.4);
      ct.fillStyle = rgba(renk, 0.9);
      ct.beginPath();
      ct.ellipse(0, 0, en * (0.055 + r() * 0.03), en * (0.04 + r() * 0.02), 0, 0, 6.3);
      ct.fill();
      ct.restore();
    }
  }
  function kokDerin(ct, r, en, boy) {
    // Derin dallı: birkaç ana kol aşağı iner, her biri ikiye ayrılır.
    const uz = boy * 0.86;
    ct.strokeStyle = "rgba(232,214,182,0.8)";
    ct.lineCap = "round";
    const kol = 3;
    for (let i = 0; i < kol; i++) {
      const yan = (i - 1) * 0.9;
      const ux = yan * en * 0.14;
      ct.lineWidth = Math.max(0.9, en * 0.026);
      ct.beginPath();
      ct.moveTo(0, 0);
      ct.quadraticCurveTo(ux * 0.6, uz * 0.45, ux, uz * (0.72 + r() * 0.25));
      ct.stroke();
      ct.lineWidth = Math.max(0.6, en * 0.013);
      for (let k = 0; k < 4; k++) {
        const t = 0.25 + k * 0.18;
        const y2 = uz * t;
        const s = k % 2 ? 1 : -1;
        ct.beginPath();
        ct.moveTo(ux * t, y2);
        ct.quadraticCurveTo(ux * t + s * en * 0.08, y2 + uz * 0.08,
          ux * t + s * en * (0.13 + r() * 0.09), y2 + uz * (0.12 + r() * 0.08));
        ct.stroke();
      }
    }
  }
  function kokBilinmiyor(ct, r, en, boy) {
    // KÖK TİPİ BİLİNMİYOR. Uydurma bir kök çizmiyoruz: yalnız kesik
    // çizgili kısa bir iz ve bilinmezliğin kendisi.
    ct.save();
    ct.setLineDash([3, 4]);
    ct.strokeStyle = "rgba(226,214,192,0.55)";
    ct.lineWidth = Math.max(0.8, en * 0.020);
    ct.beginPath();
    ct.moveTo(0, 0);
    ct.lineTo(0, boy * 0.22);
    ct.stroke();
    ct.beginPath();
    ct.ellipse(0, boy * 0.34, en * 0.16, boy * 0.12, 0, 0, 6.3);
    ct.stroke();
    ct.restore();
  }

  /** Kökü sahneye çiziyor: (x, tabanY) sap dibi, `boy` kesit derinliği. */
  function kokCiz(ct, b, x, tabanY, gen, d, vurgu) {
    const bic = turBicim(b);
    const olgun = kis(sayi(b.olgunluk), 0.05, 1);
    // Kök YAŞLA büyüyor; tipi türden, boyu olgunluktan.
    const derin = (G.kesitAlt - G.kesitUst) * (0.34 + olgun * 0.52);
    const en = Math.max(14, gen * 2.2);
    const r = uretec(Math.floor(tohum(b.ad + "kok") * 4294967295));
    const turRenk = hexRGB(b.renk || "#7bbf5a");
    ct.save();
    ct.globalAlpha = vurgu ? 0.92 : 0.30 + d * 0.22;
    // Sap dibinden kesitin üstüne inen boyun: gövde ile kök tek parça.
    // Sönük duruyor — yirmi dört bitkide parlak bir çit oluyordu.
    ct.strokeStyle = "rgba(196,176,142,0.42)";
    ct.lineWidth = kis(gen * 0.05, 0.8, 1.6);
    ct.beginPath(); ct.moveTo(x, tabanY); ct.lineTo(x, G.kesitUst); ct.stroke();
    ct.translate(x, G.kesitUst);
    if (bic.kok === "kazik") kokKazik(ct, r, en, derin, false, turRenk);
    else if (bic.kok === "kazik-etli") kokKazik(ct, r, en, derin, true, turRenk);
    else if (bic.kok === "sacak") kokSacak(ct, r, en, derin);
    else if (bic.kok === "sogan") kokSogan(ct, r, en, derin, turRenk);
    else if (bic.kok === "yumru") kokYumru(ct, r, en, derin, turRenk);
    else if (bic.kok === "derin") kokDerin(ct, r, en, derin);
    else kokBilinmiyor(ct, r, en, derin);
    ct.restore();
  }

  /* ------------------------------------------------------------ önbellek */
  function spriteAnahtar(b) {
    const olgunKova = Math.round(kis(sayi(b.olgunluk), 0, 1) * 8);
    return `${b.tur || "?"}|${b.ad}|${olgunKova}|${b.susadi ? 1 : 0}|${b.hasat ? 1 : 0}`;
  }

  /* YAPRAK YEŞİLDİR. Türün rengi katalogdan geliyor ve çoğu zaman ÜRÜNÜN
     rengi: domates kırmızı, havuç turuncu. Onu yaprağa boyayınca sahne
     kırmızı yıldızlarla dolan bir şeye dönüyordu. Yaprak yeşilin türe
     göre kaymış bir tonu; türün kendi rengi meyvede, çiçekte, yumruda. */
  const YAPRAK = { r: 111, g: 174, b: 85 };
  const yaprakRengi = (renk) => karis(renk, YAPRAK, 0.78);

  function spriteYap(b) {
    const bic = turBicim(b);
    const en = SPRITE_EN;
    const oran = UST_ORAN[bic.ust] || 1;
    const boy = Math.round(en * oran);
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
    const meyve = !!b.hasat;
    const a = [ct, r, renk, turRenk, olgun, dus, en, boy];
    if (bic.ust === "rozet") cizRozet.apply(null, a);
    else if (bic.ust === "tuy") cizTuy.apply(null, a);
    else if (bic.ust === "boru") cizBoru.apply(null, a);
    else if (bic.ust === "cali") cizCali.apply(null, a.concat([meyve]));
    else if (bic.ust === "sarilan") cizSarilan.apply(null, a.concat([meyve]));
    else if (bic.ust === "yayilan") cizYayilan.apply(null, a.concat([meyve]));
    else if (bic.ust === "sap") cizSap.apply(null, a.concat([meyve]));
    else if (bic.ust === "bas") cizBas.apply(null, a);
    else if (bic.ust === "yumruust") cizYumruUst.apply(null, a);
    else cizBilinmiyor.apply(null, a);
    return { tuval: c, en, boy, oran, bicim: bic };
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
    kokCiz(ct, b, m.x, m.taban, m.sutun, m.d, secili);
    const n = sutunCiz(ct, b, m.x, m.sutun, m.d, secili);
    // SU VERİLDİ AMA ÖLÇÜLMEDİ: ıslanma cephesi sütunun ÜSTÜNE ayrı bir
    // katman olarak biniyor, sütunu doldurmuyor. Taralı oyuk taralı kalıyor.
    if (S.islanma[b.ad]) islanmaCiz(ct, b, m.x, m.sutun, m.d);
    if (S.ekim[b.ad]) ekimCiz(ct, b, m.x, m.sutun, m.d);

    if (S.islanma[b.ad]) islakLeke(ct, b, m);
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

  /** Hazne gözleri arabanın üstünde: tohum HANGİ GÖZDEN geliyor.
   *  Yalnız ekim sırasında ya da tür seçiliyken çiziliyor. */
  function hazneCiz(ct, x, y, slug) {
    const g = (S.veri && S.veri.hazne_gozleri) || [];
    if (!g.length) return;
    const kutu = 9, ara = 2;
    const en = g.length * (kutu + ara) - ara;
    ct.save();
    ct.translate(x - en / 2, y);
    for (let i = 0; i < g.length; i++) {
      const c = g[i] || {};
      const bu = slug && String(c.tohum || "") === String(slug);
      ct.fillStyle = c.dolu ? (bu ? "rgba(150,214,140,0.95)" : "rgba(196,186,160,0.55)")
                            : "rgba(30,32,34,0.6)";
      ct.fillRect(i * (kutu + ara), 0, kutu, kutu);
      ct.strokeStyle = bu ? "rgba(190,240,180,0.95)" : "rgba(200,206,214,0.35)";
      ct.lineWidth = bu ? 1.4 : 0.8;
      ct.strokeRect(i * (kutu + ara) + 0.5, 0.5, kutu - 1, kutu - 1);
      if (bu) {
        // HANGİ GÖZ. Aynı tür birden çok gözde olabilir, biri boşalmış
        // olabilir; kullanıcıya gereken şey gözün kendisi.
        ct.save();
        ct.font = "700 9px system-ui,sans-serif";
        ct.textAlign = "center";
        ct.shadowColor = "rgba(0,0,0,0.9)";
        ct.shadowBlur = 3;
        ct.fillStyle = c.dolu ? "rgba(190,240,180,1)" : "rgba(240,186,110,1)";
        ct.fillText(`${c.ad || "göz"}${c.dolu ? "" : " · boş"}`,
          i * (kutu + ara) + kutu / 2, kutu + 11);
        ct.restore();
      }
    }
    ct.restore();
  }

  /** Makine: X rayı gökyüzünün tepesinde, araba GERÇEK X'inde, kol
   *  ÖLÇÜLEN z'ye göre iniyor. z ölçülü değilse iniş çizilmiyor ve
   *  sebebi yazıyor — inişi uydurmak, olmayan bir hareketi göstermekti. */
  function robotCiz(ct) {
    const m = makineDurum();
    const rayY = 13;
    ct.save();
    ct.globalAlpha = m.bagli ? 1 : 0.32;
    ct.strokeStyle = "rgba(198,206,216,0.55)";
    ct.lineWidth = 3;
    ct.beginPath(); ct.moveTo(0, rayY); ct.lineTo(S.en, rayY); ct.stroke();
    ct.fillStyle = "rgba(150,158,170,0.5)";
    ct.fillRect(0, rayY - 3, 10, 6);
    ct.fillRect(S.en - 10, rayY - 3, 10, 6);

    if (m.var) {
      const p = S.rob || m;
      const d = derinlik(p.y);
      const x = ekranX(p.x, d);
      const hedefY = toprakY(d);
      const yuk = S.rob ? S.rob.yuk : m.yuk;
      const ucY = m.zVar ? rayY + (hedefY - rayY) * (1 - kis(yuk, 0, 1))
                         : rayY + (hedefY - rayY) * 0.22;
      ct.strokeStyle = "rgba(216,222,232,0.7)";
      ct.lineWidth = 2;
      ct.beginPath(); ct.moveTo(x, rayY); ct.lineTo(x, ucY); ct.stroke();
      ct.fillStyle = m.bagli ? "rgba(226,232,242,0.95)" : "rgba(150,156,166,0.8)";
      ct.fillRect(x - 11, rayY - 7, 22, 14);
      ct.fillStyle = "rgba(60,66,78,0.9)";
      ct.fillRect(x - 4, ucY - 5, 8, 7);
      if (!m.zVar) {
        ct.font = "500 9px system-ui,sans-serif";
        ct.textAlign = "left";
        ct.fillStyle = "rgba(240,196,120,0.9)";
        ct.fillText("z ölçülmüyor", x + 14, rayY + 4);
      } else {
        ct.strokeStyle = "rgba(255,255,255,0.14)";
        ct.setLineDash([2, 5]);
        ct.lineWidth = 1;
        ct.beginPath(); ct.moveTo(x, ucY); ct.lineTo(x, hedefY); ct.stroke();
        ct.setLineDash([]);
      }
      // HAZNE: ekim işi çalışırken ya da tür seçiliyken arabanın üstünde.
      // Hazne arabanın ALTINDA: rayın üstünde çizilince ekranın dışında
      // kalıyordu.
      const ekSlug = S.ekIs ? String((S.ix[S.ekIs.ad] || {}).tur || "")
                            : (S.ekimTur ? S.ekimTur.slug : "");
      if (ekSlug) hazneCiz(ct, x, rayY + 10, ekSlug);
      // Ucun altındaki hedef: makine kime çalışıyor.
      if (S.olayAd && S.ix[S.olayAd] && S.ix[S.olayAd]._m) {
        const t = S.ix[S.olayAd]._m;
        ct.strokeStyle = "rgba(140,196,240,0.6)";
        ct.setLineDash([3, 4]);
        ct.lineWidth = 1;
        ct.beginPath(); ct.arc(t.x, t.taban, Math.max(10, t.en * 0.34), 0, 6.3);
        ct.stroke();
        ct.setLineDash([]);
      }
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
      ct.fillStyle = `rgba(158,214,248,${kis(z.omur * 2, 0, 0.95)})`;
      ct.beginPath();
      ct.ellipse(z.x, z.y, 1.7, 3.0, 0, 0, 6.3);
      ct.fill();
    }
  }
  function zerreEk(x, y, yer) {
    // Uç toprağa inmişse su dökülmüyor, SIÇRIYOR: damlalar yanlara ve
    // yukarı gidiyor. Yüksekten geliyorsa düşüyor.
    const yakin = yer - y < 26;
    for (let i = 0; i < 5; i++) {
      S.zerre.push({
        x: x + (Math.random() - 0.5) * 12, y,
        vx: (Math.random() - 0.5) * (yakin ? 90 : 26),
        vy: yakin ? -(30 + Math.random() * 70) : 20 + Math.random() * 40,
        yer: yer + 2, omur: 0.5 + Math.random() * 0.5,
      });
    }
  }

  /* ==================================================================== *
   * TÜR KATALOĞU — ekim derinliği ve olgunluk süresi.
   *
   * `/api/bahce` türlerin yalnız yayılımını ve olgunluk gününü taşıyor;
   * ekim derinliği (`sow_depth_mm`) katalogda duruyor ve YENİ UÇ AÇMADAN
   * var olan `/api/turler`den okunuyor. Sayı gerçek: ekim canlandırması
   * tohumu bu derinliğe bırakıyor ve rakamı yazıyor. Katalog okunamazsa
   * ya da tür için derinlik yazılı değilse UYDURULMUYOR — tohum yüzeyin
   * hemen altında duruyor ve "ekim derinliği bilinmiyor" yazıyor.
   * ==================================================================== */
  const katalogAl = guvenli("katalog", async function () {
    if (S.katalogT && Date.now() - S.katalogT < 600000) return S.katalog;
    try {
      const c = await api("/api/turler");
      const k = {};
      for (const t of (c.turler || [])) {
        if (!t || !t.slug) continue;
        k[String(t.slug)] = {
          ekim_mm: t.sow_depth_mm == null || t.sow_depth_mm === ""
            ? null : sayi(t.sow_depth_mm, 0),
          su_ml: t.water_ml_per_day == null ? null : sayi(t.water_ml_per_day, 0),
          gunes: String(t.sun_requirement || ""),
        };
      }
      S.katalog = k;
      S.katalogT = Date.now();
      notYaz("katalog", "");
    } catch (h) {
      S.katalog = S.katalog || {};
      notYaz("katalog", "Tür kataloğu okunamadı — ekim derinliği bilinmiyor.");
    }
    return S.katalog;
  });
  const ekimDerinligi = (b) => {
    const k = (S.katalog || {})[String((b && b.tur) || "")];
    return k && k.ekim_mm != null ? k.ekim_mm : null;
  };

  /* ==================================================================== *
   * SEÇİLİ BİTKİNİN NEM GEÇMİŞİ
   *
   * `/api/bitki` bitkinin nem yarıçapına düşen OKUMALARI zaman sırasıyla
   * veriyor. Sütunun içine geçmiş su seviyeleri olarak çiziliyor: eski
   * okumalar soluk çizgiler, yenisi sütunun kendi üstü. Eğri uydurmuyoruz,
   * yalnız ölçülen noktalar var.
   * ==================================================================== */
  const gecmisAl = guvenli("geçmiş", async function (ad) {
    if (!ad) return;
    if (S.gecmisAd === ad && Date.now() - S.gecmisT < 20000) return;
    S.gecmisAd = ad; S.gecmisT = Date.now(); S.gecmis = null;
    try {
      const c = await api("/api/bitki");
      const e = (c.ek || {})[ad] || null;
      if (S.gecmisAd !== ad) return;              // seçim bu arada değişti
      S.gecmis = e ? {
        noktalar: (e.gecmis || []).slice(-24),
        egilim: e.egilim || null,
        sula_adet: sayi(e.sula_adet, 0), nem_adet: sayi(e.nem_adet, 0),
        sula_toplam_sn: sayi(e.sula_toplam_sn, 0),
        ortanca_fark: e.ortanca_fark == null ? null : sayi(e.ortanca_fark, 0),
        ortanca: c.ortanca == null ? null : sayi(c.ortanca, 0),
      } : { noktalar: [], egilim: null, yok: true };
      notYaz("gecmis", "");
    } catch (h) {
      S.gecmis = null;
      notYaz("gecmis", "Nem geçmişi okunamadı — sütunda yalnız son ölçüm var.");
    }
    isteKare();
  });

  /* ==================================================================== *
   * OLAY MOTORU — sulama ve ekim GERÇEKTEN olan şeyler.
   *
   * Hiçbir canlandırma kendi kendine oynamıyor. Üç şart birden:
   *   1. kuyrukta o tipte bir iş ÇALIŞIYOR,
   *   2. makine bağlı ve konumu geliyor,
   *   3. uç o bitkinin üstünde ve toprağa inmiş (z ölçülü).
   * Üçü sağlanmazsa ekranda hareket yok. Konum ara karelerde yumuşatılıyor
   * ama ASLA ölçülen konumun ilerisine geçmiyor: hedef son gelen paket.
   *
   * SU VERİLDİ, NEM ÖLÇÜLMEDİ. Sulama canlandırması nem sütununu
   * DOLDURMUYOR. Suyun toprağa inişi ayrı bir katman: kesik kenarlı,
   * çizgili, üstünde "sulandı · ölçülmedi" yazan bir ıslanma cephesi.
   * Ölçülmemiş bir sütun sulandıktan sonra da taralı oyuk olarak duruyor —
   * su vermek bilmek değil.
   * ==================================================================== */
  const YAKIN_MM = 70;          // uç bu kadar yakınsa "o bitkinin üstünde"
  const ISLANMA_SUR = 6;        // ıslanma cephesinin dolma süresi (sn), üst sınır

  function makineDurum() {
    const v = S.veri || {};
    const k = v.konum || null;
    const bagli = !!v.bagli;
    const toprakZ = sayi(v.toprak_z, 0);
    const guvZ = sayi(v.guvenli_z, toprakZ + 340);
    const z = k ? sayi(k.z, guvZ) : guvZ;
    const arali = Math.abs(guvZ - toprakZ) > 1 ? Math.abs(guvZ - toprakZ) : 340;
    return {
      bagli, var: !!k,
      x: k ? sayi(k.x, 0) : 0, y: k ? sayi(k.y, 0) : 0, z,
      zVar: !!k && k.z != null && v.toprak_z != null,
      // Yerden yükseklik ORANI: 0 = toprakta, 1 = güvenli yükseklikte.
      yuk: kis(Math.abs(z - toprakZ) / arali, 0, 1),
      yerden: z - toprakZ,
    };
  }
  function calisanIs() {
    const k = (S.veri && S.veri.kuyruk) || {};
    const c = k.calisan;
    if (c && c.durum === "calisiyor") return c;
    return (k.isler || []).find((i) => i && i.durum === "calisiyor") || null;
  }
  /** Ucun altındaki bitki — işin hedefleri arasından, en yakını. */
  function ucAltindaki(is) {
    const m = makineDurum();
    if (!m.bagli || !m.var) return null;
    const hedef = new Set((is && is.noktalar) || []);
    let en = null, enD = YAKIN_MM;
    for (const b of S.bitki) {
      if (hedef.size && !hedef.has(String(b.ad))) continue;
      const d = Math.hypot(sayi(b.x) - m.x, sayi(b.y) - m.y);
      if (d < enD) { enD = d; en = b; }
    }
    return en;
  }

  /** Bitkinin yatak Y'si — damla kaynağını hesaplarken kullanılıyor. */
  const p2y = (b) => sayi(b.y, 0);
  /** Ucun ekrandaki Y'si: ölçülen z'den, yoksa kısa sabit kol. */
  function ucEkranY(m, d) {
    const rayY = 13, hedefY = toprakY(d);
    const yuk = S.rob ? S.rob.yuk : m.yuk;
    return m.zVar ? rayY + (hedefY - rayY) * (1 - kis(yuk, 0, 1))
                  : rayY + (hedefY - rayY) * 0.22;
  }

  function olayGuncelle(dt) {
    const m = makineDurum();
    // Konum yumuşatma: gelen paket hedef, ekran ona doğru gidiyor.
    if (m.var) {
      if (!S.rob) S.rob = { x: m.x, y: m.y, yuk: m.yuk };
      const k = kis(dt * 7, 0, 1);
      S.rob.x += (m.x - S.rob.x) * k;
      S.rob.y += (m.y - S.rob.y) * k;
      S.rob.yuk += (m.yuk - S.rob.yuk) * k;
    } else S.rob = null;

    const is = calisanIs();
    S.suIs = null; S.ekIs = null;
    if (!is || !m.bagli) { S.olayAd = ""; return; }
    const b = ucAltindaki(is);
    S.olayAd = b ? String(b.ad) : "";
    if (!b) return;

    // Uç toprağa inmiş mi? Z ölçülü değilse iniş ÇİZİLMİYOR ve olay
    // başlamıyor — inişi uydurmak, olmayan bir şeyi göstermek olurdu.
    const indi = m.zVar && m.yuk < 0.18;

    if (is.tip === "sula") {
      S.suIs = { ad: b.ad, indi, is };
      if (indi) {
        const sure = kis(sayi(b.sulama_saniye, 3), 1, ISLANMA_SUR);
        const o = S.islanma[b.ad] || { t: 0, sn: 0 };
        o.t = kis(o.t + dt / sure, 0, 1);
        o.sn += dt;
        o.ts = Date.now();
        S.islanma[b.ad] = o;
        // Damlalar UCUN olduğu yerden düşüyor ve saniyede ~11 tane: her
        // karede damla üretmek Pi'de yüzlerce nesne demekti.
        if (b._m && o.ts - sayi(o.damlaT, 0) > 70) {
          o.damlaT = o.ts;
          const dd = derinlik(p2y(b));
          zerreEk(ekranX(m.x, dd), ucEkranY(m, dd) + 3, b._m.taban);
        }
      }
    } else if (is.tip === "ek") {
      const der = ekimDerinligi(b);
      const o = S.ekim[b.ad] || { t: 0, derinlik: der };
      o.derinlik = der;
      o.ts = Date.now();
      if (indi) o.t = kis(o.t + dt / 1.6, 0, 1);
      S.ekim[b.ad] = o;
      S.ekIs = { ad: b.ad, indi, is, derinlik: der };
    }
  }

  /** Islanma cephesi: suyun toprağa inişi. ÖLÇÜM DEĞİL, verilen su. */
  /** Biten olayların izleri: sunucu "bayat" dediyse ya da iki dakika
   *  geçtiyse siliniyor. İz sonsuza kadar durursa ekran geçmişi şimdi
   *  gibi gösterir. */
  function olayTemizle() {
    const simdi = Date.now();
    for (const ad of Object.keys(S.islanma)) {
      const b = S.ix[ad];
      const o = S.islanma[ad];
      const eski = simdi - sayi(o.ts, 0) > 120000;
      // Sunucu okumayı "bayat" işaretlediyse sütun zaten sulamayı
      // anlatıyor: iz görevini bitirdi.
      const bayat = b && (b.su_olcum || {}).bayat;
      if (eski || bayat || !b) delete S.islanma[ad];
    }
    for (const ad of Object.keys(S.ekim)) {
      if (!S.ix[ad] || simdi - sayi(S.ekim[ad].ts, 0) > 120000) delete S.ekim[ad];
    }
  }

  function islanmaCiz(ct, b, x, gen, d) {
    const o = S.islanma[b.ad];
    if (!o) return;
    const yariEn = Math.max(9, gen * 0.62);
    const derin = (G.kesitAlt - G.kesitUst) * (0.20 + o.t * 0.55);
    const ust = G.kesitUst;
    ct.save();
    ct.globalAlpha = 0.7 + d * 0.3;
    const g = ct.createLinearGradient(0, ust, 0, ust + derin);
    g.addColorStop(0, "rgba(126,200,244,0.62)");
    g.addColorStop(0.7, "rgba(112,178,226,0.30)");
    g.addColorStop(1, "rgba(126,196,240,0.02)");
    ct.fillStyle = g;
    ct.fillRect(x - yariEn, ust, yariEn * 2, derin);
    // Sızma izleri: aşağı inen ince damar çizgileri.
    ct.strokeStyle = "rgba(176,220,250,0.5)";
    ct.lineWidth = 1;
    const r = uretec(Math.floor(tohum(b.ad + "su") * 4294967295));
    for (let i = 0; i < 5; i++) {
      const sx = x - yariEn + r() * yariEn * 2;
      ct.beginPath();
      ct.moveTo(sx, ust);
      ct.lineTo(sx + (r() - 0.5) * 6, ust + derin * (0.5 + r() * 0.5));
      ct.stroke();
    }
    ct.setLineDash([4, 4]);
    ct.strokeStyle = "rgba(176,220,250,0.75)";
    ct.beginPath();
    ct.moveTo(x - yariEn, ust + derin);
    ct.lineTo(x + yariEn, ust + derin);
    ct.stroke();
    ct.setLineDash([]);
    // TARAMA SUYUN ÜSTÜNE GERİ BİNİYOR. Ölçülmemiş bir sütun sulandıktan
    // sonra da OYUK: suyun rengi bilinmezliği örtmüyor. Bunu yapmazsak
    // dolan cephe "artık biliyoruz" der; oysa bilinen tek şey su verildiği.
    if (!nemDurum(b).var) {
      ct.globalAlpha = 0.85;
      ct.fillStyle = taramaDeseni(ct);
      ct.fillRect(x - yariEn, ust, yariEn * 2, derin);
      ct.globalAlpha = 1;
    }
    ct.font = "700 10px system-ui,sans-serif";
    ct.textAlign = "center";
    ct.shadowColor = "rgba(0,0,0,0.85)";
    ct.shadowBlur = 3;
    ct.fillStyle = "rgba(206,236,255,1)";
    ct.fillText("sulandı · ölçülmedi", x, ust + derin + 12);
    ct.restore();
  }

  /** Yüzeyde ıslak leke — suyun toprağa girdiği nokta. */
  function islakLeke(ct, b, m) {
    const o = S.islanma[b.ad];
    if (!o) return;
    const r = Math.max(8, m.en * 0.30) * (0.5 + o.t * 0.5);
    ct.save();
    ct.globalAlpha = 0.45;
    ct.translate(m.x, m.taban);
    ct.scale(1, 0.32);
    const g = ct.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    g.addColorStop(0, "rgba(46,86,118,0.9)");
    g.addColorStop(1, "rgba(46,86,118,0)");
    ct.fillStyle = g;
    ct.beginPath(); ct.arc(0, 0, r, 0, 6.3); ct.fill();
    ct.restore();
  }

  /** Ekim: tohumun düşüşü, derinliği ve üstünün örtülmesi. */
  function ekimCiz(ct, b, x, gen, d) {
    const o = S.ekim[b.ad];
    if (!o) return;
    const bant = G.kesitAlt - G.kesitUst;
    // DERİNLİK GERÇEK SAYIDAN: katalogdaki mm, kesitin üst çeyreğine
    // oranlanıyor (100 mm = çeyreğin tamamı). Sayı ekranda da yazıyor.
    const oran = o.derinlik == null ? 0.10 : kis(o.derinlik / 100, 0.02, 1);
    const hedef = G.kesitUst + bant * 0.25 * oran;
    const y = G.kesitUst + (hedef - G.kesitUst) * yumusakIn(o.t);
    ct.save();
    ct.globalAlpha = 0.9;
    ct.fillStyle = "#f0e0b0";
    ct.beginPath();
    ct.ellipse(x, y, Math.max(3, gen * 0.16), Math.max(4, gen * 0.20), 0, 0, 6.3);
    ct.fill();
    if (o.t >= 1) {
      // Üstü örtüldü: tohumun üstünde küçük bir toprak höyüğü.
      ct.fillStyle = "rgba(120,88,60,0.9)";
      ct.beginPath();
      ct.ellipse(x, G.kesitUst - 1, gen * 0.5, 3.5, 0, Math.PI, 0);
      ct.fill();
    }
    ct.setLineDash([2, 3]);
    ct.strokeStyle = "rgba(232,216,168,0.6)";
    ct.lineWidth = 1;
    ct.beginPath(); ct.moveTo(x - gen * 0.6, y); ct.lineTo(x + gen * 0.6, y); ct.stroke();
    ct.setLineDash([]);
    ct.font = "700 10px system-ui,sans-serif";
    ct.textAlign = "left";
    ct.shadowColor = "rgba(0,0,0,0.85)";
    ct.shadowBlur = 3;
    ct.fillStyle = o.derinlik == null ? "rgba(240,186,110,1)" : "rgba(244,236,212,1)";
    ct.fillText(o.derinlik == null ? "ekim derinliği bilinmiyor"
                                   : `${Math.round(o.derinlik)} mm derine`,
      x + gen * 0.8, y + 4);
    ct.restore();
  }
  const yumusakIn = (t) => 1 - Math.pow(1 - kis(t, 0, 1), 2);

  /* ==================================================================== *
   * SEÇİLİ BİTKİ — bilgi ayrı bir panele kaçmıyor, KESİTİN İÇİNDE duruyor.
   *
   * Sahne kararıyor, yalnız seçilenin şeridi aydınlık kalıyor; kökü
   * belirginleşiyor, nem sütunu vurgulanıyor, sütunun içine geçmiş
   * ölçümler seviye çizgileri olarak düşüyor. Yayılım çemberi yüzeyde
   * çiziliyor ve çakışan komşular işaretleniyor. Olgun boy hayalet siluet
   * olarak arkada duruyor: bitkinin nereye gideceği görünüyor.
   * ==================================================================== */
  function perdeCiz(ct, m) {
    const yariEn = Math.max(m.sutun * 1.9, m.en * 0.72);
    ct.save();
    ct.beginPath();
    ct.rect(0, 0, S.en, S.boy);
    ct.rect(m.x - yariEn, 0, yariEn * 2, S.boy);
    ct.fillStyle = "rgba(6,8,10,0.42)";
    ct.fill("evenodd");
    ct.restore();
  }

  /** Yayılım çemberi yüzeyde; çakışan komşular turuncu. */
  function yayilimCiz(ct, b, m) {
    const rMM = sayi(b.yayilim_mm, 0) * 0.5;
    if (rMM <= 0) return;
    const rx = rMM * G.pxMM * m.o;
    ct.save();
    ct.translate(m.x, m.taban);
    ct.scale(1, 0.30);
    ct.beginPath(); ct.arc(0, 0, rx, 0, 6.3);
    ct.strokeStyle = b.cakisik ? "rgba(236,150,86,0.8)" : "rgba(196,226,255,0.30)";
    ct.setLineDash([5, 5]);
    ct.lineWidth = 1.2;
    ct.stroke();
    ct.setLineDash([]);
    ct.restore();
    if (!b.cakisik) return;
    // Çakışan komşular: hangileri olduğu görünmeden "çakışık" demek,
    // kullanıcıya bakacak yer vermemek olurdu.
    for (const k of S.bitki) {
      if (k === b || !k._m) continue;
      const kr = sayi(k.yayilim_mm, 0) * 0.5;
      const d = Math.hypot(sayi(k.x) - sayi(b.x), sayi(k.y) - sayi(b.y));
      if (kr <= 0 || d >= rMM + kr) continue;
      ct.save();
      ct.strokeStyle = "rgba(236,150,86,0.6)";
      ct.lineWidth = 1;
      ct.setLineDash([3, 3]);
      ct.beginPath(); ct.moveTo(m.x, m.taban); ct.lineTo(k._m.x, k._m.taban); ct.stroke();
      ct.translate(k._m.x, k._m.taban);
      ct.scale(1, 0.30);
      ct.beginPath(); ct.arc(0, 0, kr * G.pxMM * k._m.o, 0, 6.3); ct.stroke();
      ct.restore();
    }
  }

  /** Olgun boy hayaleti: bugünkü siluetin arkasında, kesik çizgili. */
  function hayaletCiz(ct, b, m) {
    const olgun = kis(sayi(b.olgunluk), 0, 1);
    if (olgun >= 0.98) return;
    const tamMM = Math.max(30, sayi(b.yayilim_mm, 60));
    let en = kis(tamMM * G.pxMM * m.o, 14, S.en * 0.17);
    const tavan = Math.max(20, (m.taban - RAY_BOSLUK) * 0.92);
    if (en * m.sprite.oran > tavan) en = tavan / m.sprite.oran;
    const boy = en * m.sprite.oran;
    ct.save();
    ct.globalAlpha = 0.20;
    ct.drawImage(m.sprite.tuval, m.x - en / 2, m.taban - boy, en, boy);
    ct.restore();
    ct.save();
    ct.setLineDash([4, 5]);
    ct.strokeStyle = "rgba(214,232,206,0.45)";
    ct.lineWidth = 1;
    ct.beginPath();
    ct.moveTo(m.x - en / 2, m.taban - boy);
    ct.lineTo(m.x + en / 2, m.taban - boy);
    ct.stroke();
    ct.restore();
  }

  /** Geçmiş ölçümler: sütunun içinde seviye çizgileri, eskiler soluk. */
  function gecmisCiz(ct, b, m) {
    const g = S.gecmis;
    const yariEn = Math.max(9, m.sutun * 0.5) + 4;
    if (!g) {
      ct.save();
      ct.font = "500 9px system-ui,sans-serif";
      ct.textAlign = "center";
      ct.fillStyle = "rgba(226,214,192,0.6)";
      ct.fillText(S.gecmisAd === b.ad ? "geçmiş okunuyor…" : "geçmiş yok",
        m.x, G.kesitAlt - 4);
      ct.restore();
      return;
    }
    const n = g.noktalar || [];
    ct.save();
    for (let i = 0; i < n.length; i++) {
      const t = n.length === 1 ? 1 : i / (n.length - 1);   // eski 0, yeni 1
      const y = nemY(n[i].yuzde);
      ct.strokeStyle = `rgba(196,226,250,${0.12 + t * 0.5})`;
      ct.lineWidth = i === n.length - 1 ? 1.6 : 1;
      ct.beginPath();
      ct.moveTo(m.x - yariEn, y);
      ct.lineTo(m.x + yariEn, y);
      ct.stroke();
    }
    ct.restore();
    if (!n.length) {
      ct.save();
      ct.font = "500 9px system-ui,sans-serif";
      ct.textAlign = "center";
      ct.fillStyle = "rgba(226,214,192,0.6)";
      ct.fillText("hiç ölçüm yok", m.x, G.kesitAlt - 4);
      ct.restore();
    }
  }

  /** Bu bitkiyi hedefleyen kuyruk işleri. */
  function bitkininIsleri(ad) {
    const k = (S.veri && S.veri.kuyruk) || {};
    return (k.isler || []).filter(
      (i) => i && (i.durum === "bekliyor" || i.durum === "calisiyor")
        && (i.noktalar || []).indexOf(ad) >= 0);
  }

  const ETIKET = { sula: "Sulama", ek: "Ekim", nem: "Nem ölçümü",
                   foto: "Fotoğraf", gez: "Ziyaret" };

  /** Künye satırları — kutuda değil, bitkinin yanında. */
  function kunyeCiz(ct, b, m) {
    const bic = m.sprite.bicim;
    const n = nemDurum(b);
    const satir = [];
    const yas = Math.round(sayi(b.yas_gun, 0)), olgun = Math.round(sayi(b.olgun_gun, 0));
    satir.push([`${yas} günlük`, "nötr"]);
    if (olgun) {
      const kalan = Math.max(0, olgun - yas);
      satir.push([b.hasat ? "hasada hazır" : `hasada ${kalan} gün`,
                  b.hasat ? "iyi" : "nötr"]);
    } else satir.push(["olgunluk süresi bilinmiyor", "sonuk"]);
    // KÖK TİPİ BİR ÖLÇÜ DEĞİL: katalogdaki tür biçimi. Derinliği hiçbir
    // yerde ölçülmüyor ve burada da sayı yazmıyor.
    satir.push([`${KOK_ADI[bic.kok] || KOK_ADI.bilinmiyor}`
      + (bic.bilinen ? " · tür biçimi, ölçülmedi" : ""), "sonuk"]);
    if (!bic.bilinen) satir.push(["tür tanınmadı — jenerik biçim", "uyari"]);
    const der = ekimDerinligi(b);
    satir.push([der == null ? "ekim derinliği bilinmiyor" : `ekim derinliği ${Math.round(der)} mm`,
                der == null ? "sonuk" : "nötr"]);
    if (n.var) {
      satir.push([`nem %${Math.round(n.yuzde)}`
        + (n.bayat ? " · sulamadan önceki okuma"
          : !n.kendi ? ` · ${Math.round(n.uzak)} mm öteden ödünç`
            : ` · ${sureKisa(n.yas)} önce`),
        n.bayat || !n.kendi ? "uyari" : "nötr"]);
    } else satir.push(["nem ölçülmedi", "uyari"]);
    if (n.esikAcik && n.esik > 0) satir.push([`eşik %${Math.round(n.esik)}`, "sonuk"]);
    const g = S.gecmis;
    if (g && g.egilim) {
      const d = sayi(g.egilim.degisim, 0);
      satir.push([`${g.egilim.adet} ölçüm · ${d > 0 ? "+" : ""}${d.toFixed(1)} puan`
        + ` / ${sureKisa(g.egilim.sure_sn)}`, d < 0 ? "uyari" : "nötr"]);
    } else if (g && (g.noktalar || []).length === 1) {
      satir.push(["tek ölçüm — eğilim yok", "sonuk"]);
    }
    if (g && g.ortanca_fark != null) {
      satir.push([`bahçe ortancasına göre ${g.ortanca_fark > 0 ? "+" : ""}`
        + `${g.ortanca_fark.toFixed(1)} puan`, "sonuk"]);
    }
    if (g && (g.sula_adet || g.nem_adet)) {
      satir.push([`${g.sula_adet} sulama · ${g.nem_adet} ölçüm kayıtlı`, "sonuk"]);
    }
    if (b.cakisik) satir.push(["komşusuyla çakışıyor", "uyari"]);
    for (const i of bitkininIsleri(b.ad)) {
      satir.push([`${i.durum === "calisiyor" ? "şu an" : "sırada"}: `
        + (ETIKET[i.tip] || i.tip), i.durum === "calisiyor" ? "vurgu" : "sonuk"]);
    }

    const RENK = { "nötr": "rgba(238,234,224,0.94)", sonuk: "rgba(186,182,170,0.8)",
                   uyari: "rgba(240,186,110,0.95)", iyi: "rgba(140,214,130,0.95)",
                   vurgu: "rgba(140,196,240,0.95)" };
    ct.save();
    ct.font = "500 11px system-ui,sans-serif";
    const en = Math.max.apply(null, satir.map((s) => ct.measureText(s[0]).width)) + 8;
    const sag = m.x + m.sutun * 2.1 + 10;
    const sol = sag + en < S.en - 8;
    const x = sol ? sag : m.x - m.sutun * 2.1 - 10 - en;
    ct.textAlign = "left";
    // Yazı sahnenin İÇİNDE duruyor: kutusu yok, zemini yok. Okunabilirliği
    // perdenin karartması ve harflerin altındaki gölge sağlıyor — sahnenin
    // köşesine bir bilgi kutusu koymamak bu ekranın kuralı.
    let y = kis(G.gokAlt * 0.42, 16, S.boy - satir.length * 15 - 10);
    ct.shadowColor = "rgba(0,0,0,0.9)";
    ct.shadowBlur = 4;
    ct.shadowOffsetY = 1;
    for (const [metin, sinif] of satir) {
      ct.fillStyle = RENK[sinif] || RENK["nötr"];
      ct.fillText(metin, x, y);
      y += 15;
    }
    ct.restore();
  }

  function secimCiz(ct, b) {
    if (!b || !b._m) return;
    const m = b._m;
    perdeCiz(ct, m);
    hayaletCiz(ct, b, m);
    yayilimCiz(ct, b, m);
    gecmisCiz(ct, b, m);
    kunyeCiz(ct, b, m);
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
    if (S.suIs || S.ekIs) return true;
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
    const yalnizNabiz = !S.zerre.length && !S.suIs && !S.ekIs
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

    olayGuncelle(dt);

    ct.clearRect(0, 0, S.en, S.boy);
    if (S.zemin) ct.drawImage(S.zemin, 0, 0, S.en, S.boy);
    yatakUcCiz(ct);

    const liste = S.bitki.slice().sort((a, b) => derinlik(a.y) - derinlik(b.y));
    for (const b of liste) b._m = bitkiOlcu(b);
    bosYerCiz(ct);
    for (const b of liste) bitkiCiz(ct, b, b.ad === S.secili, b.ad === S.uzerinde);
    if (S.secili && S.ix[S.secili]) secimCiz(ct, S.ix[S.secili]);
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

    // EKİM OTURUMU ÖNCELİKLİ. Makine tohumu aldı ve "ucunda duruyorsa
    // devam" diye BEKLİYOR; bunu saklamak, makineyi sessizce durdurmak
    // olurdu. Ekranın ortasında soru kutusu da açmıyoruz — şeritte tek
    // düğme, kullanıcı başka işine devam edebilir.
    const eo = (S.veri && S.veri.ekim) || {};
    if (eo.aktif) {
      S.isKip = "ekim";
      const sira = sayi(eo.sira, 0), toplam = sayi(eo.toplam, 0);
      metin.textContent = `🌱 Ekim sürüyor${toplam ? ` · ${sira}/${toplam}` : ""}`
        + (eo.tur_ad ? ` · ${eo.tur_ad}` : "");
      neden.innerHTML = eo.soru
        ? `<span class="bh-ac">${kacisli(eo.soru)}</span>`
        : '<span class="bh-kanit">makine kuyruktaki ekim işini yürütüyor</span>';
      evet.hidden = !eo.soru;
      evet.disabled = !bagli;
      evet.textContent = "Devam et";
      evet.title = bagli ? "" : "Makine bağlı değil";
      ertele.hidden = true;
      sayac.hidden = true;
      $("#bh-is-geri").hidden = true; $("#bh-is-ileri").hidden = true;
      return;
    }
    S.isKip = "kart";

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
    // SIRA ÖNEMLİ: dar ekranda şerit ilk iki ölçüyü gösterip gerisini
    // kesiyor. Nem en öne geliyor, çünkü bu ekranın konusu o.
    const olculer = [
      `<span class="bh-ol nem ${n.sinif}">${kacisli(n.yazi)}</span>`,
      `<span class="bh-ol"><b>${Math.round(yas)}</b> günlük${olgun
        ? ` · olgunluk ${Math.round(olgun)} gün` : ""}</span>`,
      b.sulama_ts ? `<span class="bh-ol">son sulama ${kacisli(tarih(b.sulama_ts))}</span>`
                  : '<span class="bh-ol yok">hiç sulanmadı</span>',
    ];
    if (b.susadi) {
      olculer.unshift(`<span class="bh-ol susadi">susadı · ${
        kacisli(b.su_kanit === "olculen" ? "ölçüme göre" : "geçen güne göre (tahmin)")
      }</span>`);
    }
    if (b.hasat) olculer.push('<span class="bh-ol hasat">hasada hazır</span>');
    // KÖK TİPİ, EKİM DERİNLİĞİ VE GEÇMİŞ ŞERİTTE DEĞİL SAHNEDE. Şerit
    // 800×480'de üç satıra taşıyor ve kesiti eziyordu; bilgi zaten
    // seçili bitkinin yanında, kesitin içinde yazıyor.
    const bic = turBicim(b);
    if (!bic.bilinen) {
      olculer.push('<span class="bh-ol susadi">tür tanınmadı — jenerik biçim</span>');
    }

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
    if (b) gecmisAl(b.ad); else { S.gecmis = null; S.gecmisAd = ""; }
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
  const ekimOnayGec = guvenli("ekim onayı", async function () {
    try {
      await gonder("/api/bahce/onay", {});
      await veriYukle();
    } catch (h) { notYaz("onay", `Onay geçmedi: ${(h && h.message) || h}`); }
  });

  const kartEvet = guvenli("kart eylemi", function () {
    if (S.isKip === "ekim") { ekimOnayGec(); return; }
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
      katalogAl();
      olayTemizle();
      if (S.secili) gecmisAl(S.secili);
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
