/* Bahçe oyunu — KENDİ SAYFASI, panelin sekmesi değil.
 * =====================================================================
 *
 * NEDEN AYRI SAYFA
 * ---------------------------------------------------------------------
 * Bahçe panelin bir sekmesi olduğu sürece her sürüm aynı kalıba giriyordu:
 * bölüm başlığı, yan panel, alt şerit, sekme çubuğu. Bu sayfa o kalıbı hiç
 * yüklemiyor — `stil.css` bile yok. `window.Panel` de yok; oyun kendi
 * küçük API yardımcısını kullanıyor.
 *
 * ÖRGÜTLEYİCİ FİKİR — "BİLGİ NESNENİN ÜSTÜNDE DURUR"
 * ---------------------------------------------------------------------
 * Panelde bilgi kenarda bir sütunda dururdu. Burada durmuyor: her şey ait
 * olduğu şeyin üstünde. Bitkinin nemi bitkinin dibindeki halkada, işi
 * bitkinin üstündeki düğmelerde, makinenin hâli çiftçinin üstünde.
 * Ekranın kenarında yalnız İKİ MADALYON var (makine, bugün) ve ikisi de
 * kapalı duruyor; dokununca altına küçük bir kart açılıyor. Üçüncü şey
 * alt ortadaki tohum eli — o da kapalı.
 *
 * GÜNIŞIĞI
 * ---------------------------------------------------------------------
 * Sekmedeki sahne gece paletindeydi (koyu mor çevre, terracotta toprak).
 * Bu sayfa gündüz: açık gri-mavi çevre, güneş almış sıcak toprak, sağ alta
 * düşen uzun yumuşak gölgeler. İlk bakışta başka bir şey olduğu belli.
 *
 * DEĞİŞMEYEN KURALLAR
 * ---------------------------------------------------------------------
 * · ÇİFTÇİ = EKSEN. Konum durum paketinin `konum`undan geliyor. Çiftçi iki
 *   paket arasında yumuşatılıyor ama BİLDİRİLEN KONUMUN ÖNÜNE GEÇMİYOR.
 *   Makine kopuksa kımıldamıyor; hiç konum gelmediyse çizilmiyor ve bunu
 *   ekranda yazıyor.
 * · ÖLÇÜLMEMİŞ NEM ÖLÇÜLMÜŞ GİBİ GÖRÜNMÜYOR. Ölçüm varsa bitkinin
 *   dibindeki halka ölçülen ORANDA doluyor; yoksa halka TARALI ve boş.
 *   Sulama halkayı doldurmuyor: su verildi, nem ölçülmedi.
 * · UYDURMA SAYI VE UYDURMA SİNYAL YOK. Yağmur, ışık ve rüzgâr sensörü
 *   yok; oyun bunları üretmiyor ve eksik olduğunu kartta yazıyor.
 *   Nem ölçümü için ayrı bir sinyal de yok (`ajan/plc.py`de yalnız X/Y/Z/T
 *   var): ölçüm duruşu BAŞLATILAN İŞTEN türetiliyor ve ekranda
 *   "işten türetildi" yazıyor.
 * · SESSİZ BAŞARISIZLIK YOK. Jeton yok, sunucu yok, ölçüm okunamadı — her
 *   biri ekranda sebebiyle duruyor.
 *
 * SİNYAL KAYNAKLARI
 * ---------------------------------------------------------------------
 * · konum, sınırlar, kalibrasyon, tohum_ucu, toprak_z, guvenli_z, acil
 *      → durum paketi (`/ws/panel` üzerinden "anlik" ve "durum")
 * · su akıyor mu → ÖLÇÜM paketindeki pompa rölesi (`r_su_pompasi`);
 *      röle durum paketinde değil ölçüm paketinde geliyor
 * · bitkiler, kartlar, kuyruk, tepsi → `/api/bahce`
 * · hava → ölçüm paketi (hava_sicaklik, hava_nem, basinc, toprak_nem)
 *
 * PERFORMANS
 * ---------------------------------------------------------------------
 * Canvas 2D. Zemin ayrı tuvale bir kez çiziliyor ve kadraj kıpırdamadıkça
 * blit ediliyor. Üç hâl: DURGUN (hiç kare yok), BOŞTA (13 kare/sn) ve İŞ
 * (tam hız). Sekme görünmüyorsa çizim tamamen duruyor.
 * `window.Oyun.olcum()` kare süresini veriyor.
 */
window.Oyun = (function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

  /* ------------------------------------------------------------ sabitler */
  var KARO_MM = 50;              /* bir karo kaç mm — ızgara ölçü taşıyor */
  var ISO = 0.52;                /* izometrik: karo yüksekliği / genişliği */
  var HIZ_BOSTA = 13;
  var TAZE_MS = 30000;           /* bahçe verisini yenileme aralığı */
  var DOKUNMA_PAYI = 12;         /* parmak ucu payı — yalnız vuruşta */

  /* GÜNIŞIĞI PALETİ. Işık sol üstten; her gölge sağ alta düşüyor. */
  var ISIK = { x: -0.6, y: -0.8 };
  var P_GOK1 = "#eaf0f4", P_GOK2 = "#b9c6d0";
  var P_TOPRAK = "#cf9a5f", P_TOPRAK2 = "#b47e46", P_TOPRAK3 = "#e0aa70";
  var P_KENAR = "#8a5c31", P_KENAR2 = "#4e3016";
  var P_CIZGI = "#4a2c12";
  var YESIL = { r: 92, g: 150, b: 66 };
  var KONTUR = "rgba(24,48,18,.95)";

  var S = {
    /* kurulum */
    jeton: "", tuval: null, ct: null, en: 0, boy: 0, dpr: 1,
    zemin: null, zeminCt: null, sprite: {},
    /* veri */
    veri: null, durum: null, olcum: null, bitki: [], ix: {},
    soket: null, soketAcik: false, yukleniyor: false, veriT: 0, durumT: 0,
    acik: false, sakin: false, katalog: null, katalogT: 0,
    gecmis: null, gecmisAd: "", egim: null, egimT: 0, tasiKip: "",
    /* makine */
    bildirilen: { x: null, y: null, z: null },
    ciz: { x: null, y: null },
    konumYok: true, sonAdim: null,
    /* etkileşim */
    secili: "", halka: "", uzerinde: null, bayrak: null, el: false,
    kartKip: "", ekTur: "",
    /* sahne */
    toz: [], zerre: [], iz: [], efekt: [], sonIsler: {},
    ruzgar: { yon: 0, guc: 0.4, hYon: 0, hGuc: 0.4 },
    mesaj: "", mesajT: 0, hatalar: {},
    /* döngü */
    t: 0, sonT: 0, sonCizim: 0, dongu: 0, kirli: true, hazir: false,
    sonEtkilesim: Date.now(),
    olcumKare: { kare: 0, sure: 0, enUzun: 0 }
  };

  /* ==================================================================== *
   * KÜÇÜK API — `window.Panel` bu sayfada yok.
   *
   * Jeton panelle aynı kökten geldiği için `localStorage`daki
   * `farmbot_jeton` okunabiliyor. Jeton yoksa oyun başlamıyor: kilit
   * ekranı açılıyor ve panele yönlendiriyor.
   * ==================================================================== */
  /* İKİ BAĞLAM, TEK DOSYA.
   *
   * Oyun hem kendi sayfasında (/statik/oyun.html, tam ekran, panelsiz) hem
   * de panelin Bahçe sekmesinde barınıyor. Hangisinde olduğu AYRI BİR
   * BAYRAKTAN değil, `window.Panel`in varlığından anlaşılıyor:
   *   · panelde  → panelin `apiIste`si (jetonu o ekliyor) ve panelin
   *                zaten açık olan WebSocket akışı kullanılıyor. İkinci
   *                bağlantı açılmıyor, jeton ikinci kez ele alınmıyor.
   *   · kendi sayfasında → jeton localStorage'dan, kendi fetch'i ve kendi
   *                soketi.
   * Panelde `window.Bahce` olarak da dışa veriliyor: app.js sekme
   * değişimini, durum paketini ve kuyruk haberlerini o adla çağırıyor. */
  function P() { return window.Panel || null; }
  /* PANELDE GEÇ BELİRLENİYOR: index.html'de oyun.js app.js'ten ÖNCE
     yükleniyor, yani modül gövdesi çalışırken `window.Panel` henüz yok.
     Karar `baslat()` anında (DOMContentLoaded) veriliyor; o ana kadar
     app.js'in gövdesi kesinlikle çalışmış oluyor. Ayrı bir bayrak
     uydurmuyoruz — ölçüt yine `window.Panel`in varlığı. */
  var PANELDE = false;

  function jetonAl() {
    try { return localStorage.getItem("farmbot_jeton") || ""; }
    catch (h) { return ""; }     /* özel pencerede localStorage atıyor */
  }
  function api(yol, sec) {
    if (PANELDE) return P().apiIste(yol, sec);
    var ayirac = yol.indexOf("?") >= 0 ? "&" : "?";
    var istek = { headers: { "Content-Type": "application/json" } };
    if (sec) for (var k in sec) istek[k] = sec[k];
    return fetch(yol + ayirac + "jeton=" + encodeURIComponent(S.jeton), istek)
      .then(function (y) {
        return y.json().catch(function () { return {}; }).then(function (g) {
          if (!y.ok) {
            var h = new Error(g.detail || y.statusText || ("HTTP " + y.status));
            h.kod = y.status;
            throw h;
          }
          return g;
        });
      });
  }
  function gonder(yol, govde) {
    return api(yol, { method: "POST", body: JSON.stringify(govde || {}) });
  }
  function komut(ad, arg) {
    return gonder("/api/komut", { ad: ad, arg: arg || {} });
  }

  /* ------------------------------------------------------------ yardımcı */
  function sayi(d, v) { var s = Number(d); return isFinite(s) ? s : (v === undefined ? 0 : v); }
  function kis(d, a, b) { return Math.max(a, Math.min(b, d)); }
  function kacisli(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function uretec(c) {
    var d = c >>> 0;
    return function () {
      d = (d + 0x6D2B79F5) >>> 0;
      var t = Math.imul(d ^ (d >>> 15), 1 | d);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function tohum(ad) {
    var s = String(ad == null ? "" : ad), h = 2166136261, i;
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 100000) / 100000;
  }
  function hexRGB(h) {
    var s = String(h || "").replace("#", "");
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    var n = parseInt(s, 16);
    if (!isFinite(n)) return { r: 124, g: 190, b: 90 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgba(c, a) { return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")"; }
  function karis(a, b, t) {
    return { r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t),
             b: Math.round(a.b + (b.b - a.b) * t) };
  }
  function ton(c, o) {
    var f = o >= 0 ? function (v) { return Math.round(v + (255 - v) * o); }
                   : function (v) { return Math.round(v * (1 + o)); };
    return { r: kis(f(c.r), 0, 255), g: kis(f(c.g), 0, 255), b: kis(f(c.b), 0, 255) };
  }
  function sureKisa(sn) {
    var s = Math.max(0, Math.round(sayi(sn)));
    if (s < 90) return s + " sn";
    if (s < 5400) return Math.round(s / 60) + " dk";
    if (s < 172800) return Math.round(s / 3600) + " sa";
    return Math.round(s / 86400) + " gün";
  }
  function kirlet() { S.kirli = true; isteKare(); }
  /* Gelen paket, biten iş, açılan kart: hepsi sahneyi uyandırıyor. */
  function canlandir() { S.sonEtkilesim = Date.now(); kirlet(); }
  function mesajYaz(m) { S.mesaj = m || ""; S.mesajT = S.t; canlandir(); }

  /** Hata satırı — SESSİZ BAŞARISIZLIK YOK. Aynı anahtar bir kez yazıyor. */
  function hataYaz(anahtar, metin) {
    if (!metin) delete S.hatalar[anahtar];
    else S.hatalar[anahtar] = metin;
    var kok = $("#oy-hata");
    if (!kok) return;
    var h = [], k;
    for (k in S.hatalar) h.push("<div>" + kacisli(S.hatalar[k]) + "</div>");
    kok.innerHTML = h.join("");
  }
  /** Çizim ve olay girişlerinin hata çiti: bir kare atarsa oyun sessizce
   *  donmuyor, sebebi adıyla ekranda yazıyor. */
  function guvenli(ad, islev) {
    return function () {
      try { return islev.apply(null, arguments); }
      catch (h) {
        hataYaz("kod-" + ad, ad + " çizilemedi: " + ((h && h.message) || h));
        if (window.console) console.error("[oyun] " + ad, h);
      }
    };
  }

  /* ==================================================================== *
   * DURUM OKUMALARI — hepsi gerçek pakete bakıyor.
   * ==================================================================== */
  function D() { return S.durum || {}; }
  function sinirAl() {
    var s = D().sinirlar || {};
    var x = s.x || {}, y = s.y || {};
    var x1 = sayi(x.min, 0), x2 = sayi(x.max, 0), y1 = sayi(y.min, 0), y2 = sayi(y.max, 0);
    /* Sınır gelmediyse UYDURMA YATAK ÇİZMİYORUZ: bir karolu en küçük
       yatak çizilip sebebi yazılıyor. */
    if (!(x2 > x1) || !(y2 > y1)) {
      hataYaz("sinir", "Yumuşak eksen sınırları bildirilmedi — ızgara ölçü "
        + "taşıyamıyor, yatak en küçük hâlde çizildi.");
      return { x1: 0, x2: KARO_MM, y1: 0, y2: KARO_MM, var: false };
    }
    hataYaz("sinir", "");
    return { x1: Math.min(x1, x2), x2: Math.max(x1, x2),
             y1: Math.min(y1, y2), y2: Math.max(y1, y2), var: true };
  }
  /** Eksen neden duruyor — düğmeler bunu okuyup kapanıyor. */
  /** Sunucudan haber geliyor mu.
   *  Kendi sayfasında soketin kendi hâli. Panelde soket panelin: sessizliği
   *  ölçüyoruz — hiç durum paketi gelmediyse ya da 15 saniyedir yeni paket
   *  yoksa bunu söylüyoruz. Sessiz başarısızlık yok. */
  function baglantiVar() {
    if (!PANELDE) return S.soketAcik;
    if (!S.durumT) return false;
    return Date.now() - S.durumT < 15000;
  }
  function engel() {
    var d = D();
    if (!baglantiVar()) return { engel: true, yazi: "sunucudan haber yok", sinif: "yok" };
    if (d.bagli === false || d.plc === undefined) {
      return { engel: true, yazi: "ajan bağlı değil", sinif: "yok" };
    }
    if ((d.acil || {}).acik) {
      return { engel: true, yazi: "acil durdurma açık" + ((d.acil || {}).neden
        ? " — " + d.acil.neden : ""), sinif: "acil" };
    }
    if (d.plc === "kopuk") return { engel: true, yazi: "PLC kopuk", sinif: "yok" };
    if (d.enable === false) return { engel: true, yazi: "eksenler enerjisiz", sinif: "yok" };
    if (d.hareket) return { engel: true, yazi: "makine hareket ediyor", sinif: "mesgul" };
    if (d.islem) return { engel: true, yazi: "makine meşgul: " + d.islem, sinif: "mesgul" };
    return { engel: false, yazi: "hazır", sinif: "hazir" };
  }
  function konumVar() { var k = D().konum || {}; return k.x != null && k.y != null; }
  /** Su akıyor mu — kaynak POMPA RÖLESİ, komut değil.
   *  Röle DURUM paketinde değil ÖLÇÜM paketinde geliyor. Panelde app.js
   *  onu zaten her ölçümde `Panel.S.roleDurum`a yazıyor; kendi sayfasında
   *  ham ölçüm paketinden okunuyor. */
  function suAkiyor() {
    if (PANELDE) {
      var p = P();
      return !!(p && p.S && p.S.roleDurum && p.S.roleDurum.su_pompasi);
    }
    var o = S.olcum || {};
    return !!(o.r_su_pompasi || (o.role || {}).su_pompasi);
  }
  /** Ölçülen Z'nin 0..1 karşılığı: 1 = güvenli yükseklik, 0 = toprak. */
  function zYuksek() {
    var d = D(), k = d.konum || {};
    var tz = sayi(d.toprak_z, sayi(S.veri && S.veri.toprak_z, 0));
    var gz = sayi(d.guvenli_z, sayi(S.veri && S.veri.guvenli_z, tz + 340));
    if (k.z == null) return 1;
    var ara = Math.abs(gz - tz) > 1 ? Math.abs(gz - tz) : 340;
    return kis(Math.abs(sayi(k.z) - tz) / ara, 0, 1);
  }
  /** Tohum ucu kendi ekseninde ne kadar uzamış (0..1). */
  function tUzama() {
    var t = D().tohum_ucu || {};
    if (!t.kalibre || t.mm == null) return 0;
    return kis(Math.abs(sayi(t.mm) - sayi(t.yukari_mm, 0)) / 55, 0, 1);
  }
  /** Çalışan kuyruk işi — efektlerin ve aletin kaynağı. */
  function calisanIs() {
    var k = (S.veri && S.veri.kuyruk) || {};
    if (k.calisan && k.calisan.durum === "calisiyor") return k.calisan;
    return (k.isler || []).filter(function (i) { return i && i.durum === "calisiyor"; })[0] || null;
  }
  function nemDurum(b) {
    var o = b.su_olcum || {};
    var v = !!o.var;
    return { var: v, kendi: !!o.kendi, bayat: !!o.bayat,
             yuzde: v ? kis(sayi(o.yuzde, sayi(b.nem_yuzde, 0)), 0, 100) : null,
             uzak: sayi(o.uzak_mm, 0), yas: sayi(o.yas_sn, 0),
             esik: sayi(o.esik, 0), esikAcik: !!o.esik_acik };
  }

  /* ==================================================================== *
   * GEOMETRİ VE KAMERA
   *
   * Izgara yatağın GERÇEK koordinat uzayı: bir karo KARO_MM, sınırlar
   * `durum.sinirlar`dan. Kamera bunu bozmuyor — yalnız hangi parçasına ne
   * büyüklükte baktığımızı değiştiriyor.
   *
   * Kadraj DİKİLİ BİTKİLERİN ekranda kapladığı kutudan türüyor. Kullanıcı
   * kendi kadrajını kurduysa otomatik kadraj susuyor; çift dokunma geri
   * açıyor.
   * ==================================================================== */
  var G = { tw: 44, th: 23, ox: 0, oy: 0, nx: 1, ny: 1, s: null,
            kam: null, hedef: null, elle: false, kayiyor: false };
  var PAY_X = 24, PAY_UST = 74, PAY_ALT = 74;

  function Xof(u, v) { return (u - v) / 2; }
  function Yof(u, v) { return (u + v) / 2; }
  function serbestEn() { return Math.max(120, S.en - PAY_X * 2); }
  function serbestBoy() { return Math.max(120, S.boy - PAY_UST - PAY_ALT); }

  function twEnAz() {
    var dX = Xof(G.nx, 0) - Xof(0, G.ny), dY = Yof(G.nx, G.ny) - Yof(0, 0);
    return Math.min(serbestEn() / Math.max(0.5, dX),
                    serbestBoy() / Math.max(0.5, dY * ISO));
  }
  function twEnCok() { return Math.max(twEnAz() * 1.2, serbestEn() / 3); }

  function kadrajHesap() {
    var X1 = 1e9, Y1 = 1e9, X2 = -1e9, Y2 = -1e9, say = 0;
    S.bitki.forEach(function (b) {
      if (b.x == null || b.y == null) return;
      var u = uOf(b.x), v = vOf(b.y);
      var r = kis(sayi(b.yayilim_mm, 90) / 2 / KARO_MM, 0.5, 2.5);
      X1 = Math.min(X1, Xof(u, v) - r); X2 = Math.max(X2, Xof(u, v) + r);
      Y1 = Math.min(Y1, Yof(u, v) - r); Y2 = Math.max(Y2, Yof(u, v) + r);
      say++;
    });
    if (!say) return { cu: G.nx / 2, cv: G.ny / 2, tw: twEnAz() };
    var pay = 0.7;
    X1 -= pay; X2 += pay; Y1 -= pay; Y2 += pay;
    var tw = Math.min(serbestEn() / Math.max(0.5, X2 - X1),
                      serbestBoy() / Math.max(0.5, (Y2 - Y1) * ISO));
    var X = (X1 + X2) / 2, Y = (Y1 + Y2) / 2;
    return { cu: X + Y, cv: Y - X, tw: kis(tw, twEnAz(), twEnCok()) };
  }
  function kameraKirp(k) {
    k.tw = kis(k.tw, twEnAz(), twEnCok());
    k.cu = kis(k.cu, -0.6, G.nx + 0.6);
    k.cv = kis(k.cv, -0.6, G.ny + 0.6);
    return k;
  }
  function kameraUygula() {
    var k = G.kam;
    G.tw = k.tw; G.th = k.tw * ISO;
    G.ox = S.en / 2 - Xof(k.cu, k.cv) * G.tw;
    G.oy = (PAY_UST + S.boy - PAY_ALT) / 2 - Yof(k.cu, k.cv) * G.th;
  }
  function geometriKur() {
    var s = sinirAl();
    var eskiN = G.nx + "x" + G.ny;
    G.s = s;
    G.nx = Math.max(1, Math.round((s.x2 - s.x1) / KARO_MM));
    G.ny = Math.max(1, Math.round((s.y2 - s.y1) / KARO_MM));
    G.hedef = kadrajHesap();
    /* IZGARA BOYU DEĞİŞTİYSE KAMERA SIÇRIYOR, kaymıyor. Sınırlar ilk durum
       paketiyle geliyor: o ana kadarki kamera 1×1 karoluk bir yatağa
       kuruluydu ve oradan yumuşak geçiş yapmak ekranı bir saniye boyunca
       bomboş bırakıyordu. Önce anlamlı bir şey yoktu, yumuşatacak bir şey
       de yok. */
    if (!G.kam || eskiN !== G.nx + "x" + G.ny) {
      G.kam = { cu: G.hedef.cu, cv: G.hedef.cv, tw: G.hedef.tw };
      G.kayiyor = false;
    }
    if (G.elle) kameraKirp(G.kam);
    kameraUygula();
  }
  function kameraGuncelle(dt) {
    if (!G.kam || !G.hedef || G.elle) return false;
    var k = kis(dt * 3.4, 0, 1), oyn = 0, a, n, alan = ["cu", "cv", "tw"];
    for (var i = 0; i < alan.length; i++) {
      n = alan[i]; a = G.hedef[n] - G.kam[n];
      if (Math.abs(a) > (n === "tw" ? 0.06 : 0.002)) { G.kam[n] += a * k; oyn = 1; }
      else G.kam[n] = G.hedef[n];
    }
    if (oyn) kameraUygula();
    return !!oyn;
  }
  function uOf(mx) { return (sayi(mx) - G.s.x1) / KARO_MM; }
  function vOf(my) { return (sayi(my) - G.s.y1) / KARO_MM; }
  function ex(u, v) { return G.ox + (u - v) * G.tw / 2; }
  function ey(u, v) { return G.oy + (u + v) * G.th / 2; }
  function ekranMM(sx, sy) {
    var a = (sx - G.ox) / (G.tw / 2), b = (sy - G.oy) / (G.th / 2);
    var u = (a + b) / 2, v = (b - a) / 2;
    return { u: u, v: v, x: G.s.x1 + u * KARO_MM, y: G.s.y1 + v * KARO_MM };
  }
  function icerde(u, v) { return u >= 0 && v >= 0 && u <= G.nx && v <= G.ny; }

  /** Bir EKRAN noktasını sabit tutarak yakınlaştır. */
  function yakinlastir(carpan, sx, sy) {
    var once = ekranMM(sx, sy);
    G.elle = true;
    G.kam.tw = kis(G.kam.tw * carpan, twEnAz(), twEnCok());
    kameraUygula();
    var sonra = ekranMM(sx, sy);
    G.kam.cu += once.u - sonra.u;
    G.kam.cv += once.v - sonra.v;
    kameraKirp(G.kam); kameraUygula();
  }
  function kaydir(dx, dy) {
    G.elle = true;
    var a = -dx / (G.tw / 2), b = -dy / (G.th / 2);
    G.kam.cu += (a + b) / 2;
    G.kam.cv += (b - a) / 2;
    kameraKirp(G.kam); kameraUygula();
  }
  function kadrajaDon() {
    G.elle = false;
    G.hedef = kadrajHesap();
    mesajYaz("Kadraj bitkilere döndü.");
  }
  /** Bir bitkiyi kadraja al — "bugün" kartından bir satıra dokununca. */
  function bitkiyeUc(b) {
    if (!b || b.x == null) return;
    G.elle = true;
    G.kam.cu = uOf(b.x); G.kam.cv = vOf(b.y);
    G.kam.tw = kis(Math.max(G.kam.tw, twEnAz() * 1.9), twEnAz(), twEnCok());
    kameraKirp(G.kam); kameraUygula();
    S.secili = String(b.ad); S.halka = String(b.ad);
    kirlet();
  }

  /* ==================================================================== *
   * ZEMİN — güneş almış sürülmüş toprak, çim yok.
   *
   * Zemin tuvali görüntüden ZEMIN_PAY kadar büyük çiziliyor ve kamera
   * kıpırdadıkça yeniden çizilmiyor: elmas iz düşüm tw'de doğrusal olduğu
   * için ölçek + öteleme dönüşümüyle blit ediliyor. Hareket sürerken
   * dondurulmuş kalıyor, hareket bitince bir kez yenileniyor.
   * ==================================================================== */
  var ZEMIN_PAY = 1.4;
  var Z0 = null;

  function zeminKur() {
    S.zemin = document.createElement("canvas");
    S.zemin.width = Math.round(S.en * ZEMIN_PAY * S.dpr);
    S.zemin.height = Math.round(S.boy * ZEMIN_PAY * S.dpr);
    S.zeminCt = S.zemin.getContext("2d");
    Z0 = null;
    zeminCiz();
  }
  function zeminDonusum(zorla) {
    if (!Z0) return null;
    var k = G.tw / Z0.tw;
    var e = G.ox - k * Z0.ox - k * Z0.padX;
    var f = G.oy - k * Z0.oy - k * Z0.padY;
    var w = k * S.en * ZEMIN_PAY, h = k * S.boy * ZEMIN_PAY;
    if (zorla) return { e: e, f: f, w: w, h: h };
    if (k < 0.62 || k > 1.7) return null;
    if (e > 0.5 || f > 0.5 || e + w < S.en - 0.5 || f + h < S.boy - 0.5) return null;
    return { e: e, f: f, w: w, h: h };
  }
  /** Dondurulmuş zemin görüntüyü kaplıyorsa (keskinlik sapmış olsa da)
   *  blit dönüşümü, kaplamıyorsa null. */
  function zeminKapsiyorMu() {
    if (!Z0) return null;
    var k = G.tw / Z0.tw;
    var e = G.ox - k * Z0.ox - k * Z0.padX;
    var f = G.oy - k * Z0.oy - k * Z0.padY;
    var w = k * S.en * ZEMIN_PAY, h = k * S.boy * ZEMIN_PAY;
    if (e > 0.5 || f > 0.5 || e + w < S.en - 0.5 || f + h < S.boy - 0.5) return null;
    return { e: e, f: f, w: w, h: h };
  }
  function tarlaYol(c, dy) {
    dy = dy || 0;
    c.beginPath();
    c.moveTo(ex(0, 0), ey(0, 0) + dy);
    c.lineTo(ex(G.nx, 0), ey(G.nx, 0) + dy);
    c.lineTo(ex(G.nx, G.ny), ey(G.nx, G.ny) + dy);
    c.lineTo(ex(0, G.ny), ey(0, G.ny) + dy);
    c.closePath();
  }
  function karoYol(c, u, v) {
    c.beginPath();
    c.moveTo(ex(u, v), ey(u, v));
    c.lineTo(ex(u + 1, v), ey(u + 1, v));
    c.lineTo(ex(u + 1, v + 1), ey(u + 1, v + 1));
    c.lineTo(ex(u, v + 1), ey(u, v + 1));
    c.closePath();
  }
  /* Yatağın kenarı: ÖLÇÜ DEĞİL, çizim kuralı. Toprak derinliği hiçbir
     yerde ölçülmüyor — o yüzden içi görünen bir kesit yok, yalnız ince
     bir kalınlık. */
  function kenarKal() { return Math.max(3, G.th * 0.38); }

  var zeminCiz = guvenli("zemin", function () {
    var c = S.zeminCt;
    if (!c || !G.s) return;
    var padX = S.en * (ZEMIN_PAY - 1) / 2, padY = S.boy * (ZEMIN_PAY - 1) / 2;
    Z0 = { ox: G.ox, oy: G.oy, tw: G.tw, padX: padX, padY: padY };
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.clearRect(0, 0, S.en * ZEMIN_PAY, S.boy * ZEMIN_PAY);
    c.translate(padX, padY);

    /* GÜNIŞIĞI ÇEVRESİ: açık, serin bir zemin düzlemi. Tarla ondan
       ayrılsın diye sıcak; ikisi arasındaki fark sahnenin havası. */
    var g = c.createLinearGradient(0, -padY, 0, S.boy + padY);
    g.addColorStop(0, P_GOK1); g.addColorStop(1, P_GOK2);
    c.fillStyle = g;
    c.fillRect(-padX, -padY, S.en * ZEMIN_PAY, S.boy * ZEMIN_PAY);
    var r = uretec(20260909), i;
    for (i = 0; i < 26; i++) {
      var lx = -padX + r() * S.en * ZEMIN_PAY, ly = -padY + r() * S.boy * ZEMIN_PAY;
      var lr = 60 + r() * 160;
      var lg = c.createRadialGradient(lx, ly, 0, lx, ly, lr);
      lg.addColorStop(0, "rgba(255,255,255,.42)");
      lg.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = lg;
      c.beginPath(); c.arc(lx, ly, lr, 0, 6.3); c.fill();
    }

    var kal = kenarKal();
    /* UZUN YUMUŞAK GÖLGE — güneş sol üstte, gölge sağ alta. */
    c.save();
    c.globalAlpha = 0.3; c.fillStyle = "#4a5a68";
    tarlaYol(c, kal * 2.1);
    c.translate(kal * 0.9, 0);
    c.fill();
    c.restore();
    c.save();
    c.globalAlpha = 0.34; c.fillStyle = "#3d4a56";
    tarlaYol(c, kal * 1.25); c.fill();
    c.restore();

    /* Kenar: yalnız öne bakan iki yüz. Kesit değil, kalınlık —
       yatağın toprak derinliği hiçbir yerde ÖLÇÜLMÜYOR. */
    function kenar(p1, p2) {
      var kg = c.createLinearGradient(0, p1.y, 0, p1.y + kal);
      kg.addColorStop(0, P_KENAR); kg.addColorStop(1, P_KENAR2);
      c.fillStyle = kg;
      c.beginPath();
      c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y);
      c.lineTo(p2.x, p2.y + kal); c.lineTo(p1.x, p1.y + kal);
      c.closePath(); c.fill();
    }
    var Bp = { x: ex(G.nx, 0), y: ey(G.nx, 0) };
    var Cp = { x: ex(G.nx, G.ny), y: ey(G.nx, G.ny) };
    var Dp = { x: ex(0, G.ny), y: ey(0, G.ny) };
    kenar(Cp, Bp); kenar(Dp, Cp);

    /* TOPRAK TEK PARÇA BOYANIYOR, karo karo DEĞİL.
       Karo karo dolgu denendi ve olmadı: aynı tonu paylaşan komşu elmaslar
       birleşip düz kenarlı büyük dikdörtgenler oluşturuyor ve yüzey parke
       döşeme gibi okunuyor. Dalgalanma artık ızgaraya hiç bağlı olmayan
       yumuşak lekelerden geliyor; karonun payına yalnız karık ve kesek
       düşüyor. */
    var r2 = uretec(4242), u, v, q, i2;
    c.save();
    tarlaYol(c); c.clip();
    c.fillStyle = P_TOPRAK;
    c.fillRect(-padX, -padY, S.en * ZEMIN_PAY, S.boy * ZEMIN_PAY);
    /* İki geçiş: geniş yumuşak dalgalar, sonra küçük keskin lekeler.
       Tek geçiş yüzeyi düz bir masa gibi bırakıyordu. */
    var lekeAdet = Math.round(kis(G.nx * G.ny * 3.2, 120, 420));
    for (i2 = 0; i2 < lekeAdet; i2++) {
      var buyuk = i2 % 3 !== 0;
      var lu = r2() * G.nx, lv = r2() * G.ny;
      var lx2 = ex(lu, lv), ly2 = ey(lu, lv);
      var lr2 = G.tw * (buyuk ? (0.5 + r2() * 1.4) : (0.12 + r2() * 0.3));
      var kk = r2();
      var lg2 = c.createRadialGradient(lx2, ly2, 0, lx2, ly2, lr2);
      lg2.addColorStop(0, kk < 0.48
        ? "rgba(96,54,18," + (buyuk ? 0.26 : 0.4) + ")"
        : "rgba(240,192,138," + (buyuk ? 0.26 : 0.42) + ")");
      lg2.addColorStop(1, "rgba(0,0,0,0)");
      c.save();
      c.translate(lx2, ly2); c.scale(1, ISO); c.translate(-lx2, -ly2);
      c.fillStyle = lg2;
      c.beginPath(); c.arc(lx2, ly2, lr2, 0, 6.3); c.fill();
      c.restore();
    }
    for (v = 0; v < G.ny; v++) {
      for (u = 0; u < G.nx; u++) {
        var mx = ex(u + 0.5, v + 0.5), my = ey(u + 0.5, v + 0.5);
        if (mx < -padX - G.tw || mx > S.en + padX + G.tw
            || my < -padY - G.tw || my > S.boy + padY + G.tw) { r2(); r2(); continue; }
        r2();
        /* Karık KESİK ve karodan karoya yön değiştiriyor: kesintisiz
           çizgiler yüzeyi döşeme gibi gösteriyordu. Her karığın bir koyu
           oluğu ve hemen yanında ışık alan bir sırtı var — kabartma
           duygusu buradan geliyor. */
        var yon = ((u * 5 + v * 11) % 3) === 0;
        var kw = Math.max(1.2, G.th * 0.1);
        for (q = 1; q <= 3; q++) {
          var f2 = q / 4 + (r2() - 0.5) * 0.07;
          var a1 = 0.04 + r2() * 0.16, a2 = Math.min(0.97, a1 + 0.45 + r2() * 0.45);
          var p1, p2, s1, s2;
          if (yon) {
            p1 = [ex(u + f2, v + a1), ey(u + f2, v + a1)];
            p2 = [ex(u + f2, v + a2), ey(u + f2, v + a2)];
            s1 = [ex(u + f2 - 0.05, v + a1), ey(u + f2 - 0.05, v + a1)];
            s2 = [ex(u + f2 - 0.05, v + a2), ey(u + f2 - 0.05, v + a2)];
          } else {
            p1 = [ex(u + a1, v + f2), ey(u + a1, v + f2)];
            p2 = [ex(u + a2, v + f2), ey(u + a2, v + f2)];
            s1 = [ex(u + a1, v + f2 - 0.05), ey(u + a1, v + f2 - 0.05)];
            s2 = [ex(u + a2, v + f2 - 0.05), ey(u + a2, v + f2 - 0.05)];
          }
          c.strokeStyle = "rgba(255,228,182,.3)"; c.lineWidth = kw * 0.8;
          c.beginPath(); c.moveTo(s1[0], s1[1]); c.lineTo(s2[0], s2[1]); c.stroke();
          c.strokeStyle = "rgba(62,32,10,.32)"; c.lineWidth = kw;
          c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.stroke();
        }
        if (r2() < 0.55) {
          var kx = ex(u + 0.2 + r2() * 0.6, v + 0.2 + r2() * 0.6);
          var ky = ey(u + 0.2 + r2() * 0.6, v + 0.2 + r2() * 0.6);
          var kr = Math.max(1.4, G.tw * (0.03 + r2() * 0.035));
          c.fillStyle = "rgba(60,32,10,.3)";
          c.beginPath(); c.ellipse(kx + 1.4, ky + 1, kr, kr * 0.6, 0, 0, 6.3); c.fill();
          c.fillStyle = "rgba(240,200,150,.55)";
          c.beginPath(); c.ellipse(kx, ky, kr, kr * 0.6, 0, 0, 6.3); c.fill();
        }
      }
    }
    /* Güneş: sol üst aydınlık, sağ alt gölgeli. */
    var ig = c.createLinearGradient(ex(0, 0), ey(0, 0), ex(G.nx, G.ny), ey(G.nx, G.ny));
    ig.addColorStop(0, "rgba(255,244,214,.2)");
    ig.addColorStop(0.55, "rgba(255,244,214,0)");
    ig.addColorStop(1, "rgba(52,28,8,.2)");
    c.fillStyle = ig;
    c.fillRect(-padX, -padY, S.en * ZEMIN_PAY, S.boy * ZEMIN_PAY);
    c.restore();

    c.lineJoin = "round";
    c.strokeStyle = P_CIZGI; c.lineWidth = Math.max(2.2, G.th * 0.13);
    tarlaYol(c); c.stroke();
    c.strokeStyle = "rgba(255,240,206,.5)"; c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(Dp.x, Dp.y); c.lineTo(ex(0, 0), ey(0, 0)); c.lineTo(Bp.x, Bp.y);
    c.stroke();
    c.strokeStyle = P_CIZGI; c.lineWidth = Math.max(1.8, G.th * 0.1);
    c.beginPath();
    c.moveTo(Bp.x, Bp.y + kal); c.lineTo(Cp.x, Cp.y + kal); c.lineTo(Dp.x, Dp.y + kal);
    c.stroke();
    /* Sınır bildirilmediyse yatak UYDURMA: bunu zeminin üstüne yazıyoruz. */
    if (!G.s.var) {
      c.font = "600 12px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = "rgba(150,40,32,.95)";
      c.fillText("sınırlar bildirilmedi", ex(G.nx / 2, G.ny / 2), ey(G.nx / 2, G.ny / 2));
    }
  });

  /* ==================================================================== *
   * BİTKİ SİLUETLERİ — havuçsa havuç, rokaysa roka.
   *
   * Önce TÜRE ÖZEL çizici; yoksa AİLE biçimi; tür tabloda hiç yoksa
   * jenerik kesik çizgili öbek ve "tür tanınmadı" yazısı. Uydurma havuç
   * çizilmiyor.
   *
   * Boy `yaricap_mm`den — bitkinin ölçülen yarıçapı. Fide 15 mm'yken bile
   * tür ayırt edilebilsin diye ayırt edici şey boyut DEĞİL: yaprak sayısı,
   * kenar biçimi, duruş ve ton. OKUNUR_TABAN bunun altında hiçbir siluetin
   * okunmadığı çizim tabanı — ölçü iddiası değil.
   * ==================================================================== */
  var OKUNUR_TABAN = 14;
  var AILE = {
    marul: "rozet", lahana: "rozet", ispanak: "rozet", pazi: "rozet",
    roka: "rozet", kereviz: "rozet", karnabahar: "rozet", brokoli: "rozet",
    semizotu: "rozet",
    havuc: "tuy", dereotu: "tuy", maydanoz: "tuy",
    sogan: "serit", sarimsak: "serit", pirasa: "serit", misir: "serit",
    feslegen: "cift", "fesleğen": "cift", nane: "cift", kekik: "cift",
    biberiye: "cift",
    domates: "loblu", biber: "loblu", patlican: "loblu", bamya: "loblu",
    kabak: "loblu", karpuz: "loblu", kavun: "loblu", salatalik: "loblu",
    fasulye: "loblu", bezelye: "loblu", nohut: "loblu", uzum: "loblu",
    cilek: "loblu", patates: "loblu", "tatli-patates": "loblu",
    aycicegi: "cicek", turp: "turp"
  };
  /* Kök tipi tabloda duruyor ve KÜNYEDE yazıyor. Çizilmiyor: kök
     derinliği hiçbir yerde ölçülmüyor, sürekli duran bir kök resmi
     ölçülmüş bir şey gibi okunurdu. */
  var KOK = {
    marul: "sacak", lahana: "sacak", ispanak: "sacak", pazi: "kazik",
    roka: "sacak", kereviz: "sacak", karnabahar: "sacak", brokoli: "sacak",
    semizotu: "sacak",
    havuc: "kazik-etli", dereotu: "kazik", maydanoz: "kazik",
    sogan: "sogan", sarimsak: "sogan", pirasa: "sacak", misir: "derin",
    feslegen: "sacak", "fesleğen": "sacak", nane: "sacak", kekik: "sacak",
    biberiye: "derin",
    domates: "derin", biber: "sacak", patlican: "derin", bamya: "kazik",
    kabak: "derin", karpuz: "derin", kavun: "derin", salatalik: "sacak",
    fasulye: "sacak", bezelye: "sacak", nohut: "kazik", uzum: "derin",
    cilek: "sacak", patates: "yumru", "tatli-patates": "yumru",
    aycicegi: "kazik", turp: "kazik-etli"
  };
  var KOK_ADI = {
    kazik: "kazık kök", "kazik-etli": "etli kazık kök", sacak: "saçak kök",
    sogan: "soğan (yumru) kök", yumru: "yumru kök", derin: "derin dallı kök",
    bilinmiyor: "kök tipi bilinmiyor"
  };
  var TON = { marul: 0.3, roka: -0.06, semizotu: 0.14, maydanoz: -0.16,
              havuc: 0.32, feslegen: -0.34, "fesleğen": -0.34,
              rozet: 0.16, tuy: 0.26, serit: -0.06, cift: -0.28,
              loblu: -0.16, cicek: 0.06, turp: 0.2, bilinmiyor: 0 };

  function bicimSec(b) {
    var slug = String((b && b.tur) || "").toLowerCase();
    var aile = AILE[slug];
    return { slug: slug, aile: aile || "bilinmiyor", bilinen: !!aile,
             kok: KOK[slug] || "bilinmiyor", ozel: !!CIZER[slug] };
  }

  /* --- yaprak parçaları ------------------------------------------------ */
  function yaprak(x, uz, en, ic, dis) {
    var g = x.createLinearGradient(0, -en, uz, en);
    g.addColorStop(0, ic); g.addColorStop(1, dis);
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(uz * 0.3, -en, uz * 0.78, -en * 0.82, uz, 0);
    x.bezierCurveTo(uz * 0.78, en * 0.82, uz * 0.3, en, 0, 0);
    x.fillStyle = g; x.fill();
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.5, en * 0.22);
    x.lineJoin = "round"; x.stroke();
    x.strokeStyle = "rgba(26,52,16,.45)"; x.lineWidth = Math.max(0.8, en * 0.09);
    x.beginPath(); x.moveTo(uz * 0.06, 0); x.lineTo(uz * 0.9, 0); x.stroke();
  }
  /** Kıvrımlı kenar — marulun kenarı bu. */
  function yaprakDalgali(x, uz, en, ic, dis, dalga) {
    var q, t2, k;
    x.beginPath();
    for (q = 0; q <= 24; q++) {
      t2 = q / 24;
      k = Math.sin(t2 * Math.PI) * en * (1 + Math.sin(t2 * Math.PI * dalga) * 0.24);
      if (q === 0) x.moveTo(uz * t2, -k); else x.lineTo(uz * t2, -k);
    }
    for (q = 24; q >= 0; q--) {
      t2 = q / 24;
      k = Math.sin(t2 * Math.PI) * en * (1 + Math.sin(t2 * Math.PI * dalga + 1.7) * 0.24);
      x.lineTo(uz * t2, k);
    }
    x.closePath();
    var g = x.createLinearGradient(0, -en, uz, en);
    g.addColorStop(0, ic); g.addColorStop(1, dis);
    x.fillStyle = g; x.fill();
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.5, en * 0.2);
    x.lineJoin = "round"; x.stroke();
  }
  /** DERİN LOBLU aya — rokanın imzası, marulun tersi. */
  function yaprakLoblu(x, sap, uz, en, ic, dis) {
    var i, adet = 3, x0 = sap, boyu = uz - sap;
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.5, en * 0.2); x.lineCap = "round";
    x.beginPath(); x.moveTo(0, 0); x.lineTo(sap, 0); x.stroke();
    x.beginPath(); x.moveTo(x0, 0);
    for (i = 0; i < adet; i++) {
      var t1 = i / adet, t2 = (i + 0.5) / adet;
      x.lineTo(x0 + boyu * t1, -en * (0.5 + t1 * 0.34));
      x.lineTo(x0 + boyu * t2, -en * 0.1);
    }
    x.lineTo(uz, -en * 0.72);
    x.lineTo(uz + boyu * 0.16, 0);
    x.lineTo(uz, en * 0.72);
    for (i = adet - 1; i >= 0; i--) {
      var s1 = (i + 0.5) / adet, s2 = i / adet;
      x.lineTo(x0 + boyu * s1, en * 0.1);
      x.lineTo(x0 + boyu * s2, en * (0.5 + s2 * 0.34));
    }
    x.closePath();
    var g = x.createLinearGradient(x0, -en, uz, en);
    g.addColorStop(0, ic); g.addColorStop(1, dis);
    x.fillStyle = g; x.fill();
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.5, en * 0.19);
    x.lineJoin = "round"; x.stroke();
  }
  function halka(x, r, adet, uz, en, ic, dis, faz) {
    for (var i = 0; i < adet; i++) {
      x.save();
      x.rotate((i / adet) * Math.PI * 2 + faz + r() * 0.2);
      yaprak(x, uz * (0.88 + r() * 0.24), en, ic, dis);
      x.restore();
    }
  }
  function goz(x, R, renk, cap) {
    x.beginPath(); x.arc(0, 0, R * cap, 0, 6.3);
    x.fillStyle = rgba(renk, 1); x.fill();
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.3, R * 0.05); x.stroke();
  }
  /** Kökün toprak ÜSTÜNDE görünen omzu. Derinlik iddiası değil. */
  function omuz(x, R, renk, cap) {
    var g = x.createRadialGradient(-R * cap * 0.3, -R * cap * 0.3, R * cap * 0.1, 0, 0, R * cap);
    g.addColorStop(0, rgba(ton(renk, 0.35), 1));
    g.addColorStop(1, rgba(ton(renk, -0.2), 1));
    x.beginPath(); x.arc(0, 0, R * cap, 0, 6.3);
    x.fillStyle = g; x.fill();
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.4, R * 0.055); x.stroke();
  }

  /* --- türe özel çiziciler --------------------------------------------- */
  function cizMarul(x, R, yes, tur, r) {
    var n, i, kat, adet, koyu = ton(yes, -0.3), acik = ton(yes, 0.34);
    for (n = 3; n >= 1; n--) {
      kat = n / 3; adet = n === 3 ? 9 : (n === 2 ? 7 : 5);
      for (i = 0; i < adet; i++) {
        x.save();
        x.rotate((i / adet) * Math.PI * 2 + n * 0.62 + r() * 0.14);
        yaprakDalgali(x, R * kat * (0.94 + r() * 0.12), R * kat * 0.44,
          rgba(n === 1 ? acik : yes, 1), rgba(n === 3 ? koyu : yes, 1), 3);
        x.restore();
      }
    }
    goz(x, R, ton(acik, 0.3), 0.2);
  }
  function cizRoka(x, R, yes, tur, r) {
    var i, koyu = ton(yes, -0.26), acik = ton(yes, 0.18);
    for (i = 0; i < 6; i++) {
      x.save(); x.rotate((i / 6) * Math.PI * 2 + r() * 0.3);
      yaprakLoblu(x, R * 0.28, R * (0.94 + r() * 0.12), R * 0.46,
        rgba(i % 2 ? acik : yes, 1), rgba(koyu, 1));
      x.restore();
    }
    goz(x, R, koyu, 0.1);
  }
  function cizSemizotu(x, R, yes, tur, r) {
    var i, q, koyu = ton(yes, -0.22), acik = ton(yes, 0.3);
    var sap = { r: 178, g: 96, b: 74 };
    for (i = 0; i < 5; i++) {
      var a = (i / 5) * Math.PI * 2 + r() * 0.4, uz = R * (0.5 + r() * 0.3);
      x.save(); x.rotate(a);
      x.strokeStyle = rgba(sap, 1); x.lineWidth = Math.max(1.6, R * 0.09);
      x.lineCap = "round";
      x.beginPath(); x.moveTo(0, 0); x.lineTo(uz, 0); x.stroke();
      for (q = 0; q < 3; q++) {
        var ay = (q - 1) * 0.75, yr = R * (0.2 + r() * 0.06);
        var yx = uz + Math.cos(ay) * R * 0.14, yy = Math.sin(ay) * R * 0.2;
        x.beginPath(); x.arc(yx, yy, yr, 0, 6.3);
        x.fillStyle = rgba(q === 1 ? yes : koyu, 1); x.fill();
        x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.5, yr * 0.28); x.stroke();
        x.beginPath(); x.arc(yx - yr * 0.3, yy - yr * 0.34, yr * 0.32, 0, 6.3);
        x.fillStyle = rgba(ton(acik, 0.4), 0.75); x.fill();
      }
      x.restore();
    }
  }
  function cizMaydanoz(x, R, yes, tur, r) {
    var i, q, koyu = ton(yes, -0.3), acik = ton(yes, 0.18);
    for (i = 0; i < 5; i++) {
      var a = (i / 5) * Math.PI * 2 + r() * 0.24, sap = R * (0.5 + r() * 0.1);
      x.save(); x.rotate(a);
      x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.8, R * 0.08); x.lineCap = "round";
      x.beginPath(); x.moveTo(0, 0); x.lineTo(sap, 0); x.stroke();
      x.strokeStyle = rgba(acik, 1); x.lineWidth = Math.max(1, R * 0.04); x.stroke();
      for (q = -1; q <= 1; q++) {
        x.save(); x.translate(sap, 0); x.rotate(q * 0.82);
        yaprakDalgali(x, R * (0.34 + r() * 0.08), R * 0.15,
          rgba(q === 0 ? acik : yes, 1), rgba(koyu, 1), 6);
        x.restore();
      }
      x.restore();
    }
  }
  function cizHavuc(x, R, yes, tur, r) {
    var i, q, acik = ton(yes, 0.3);
    for (i = 0; i < 5; i++) {
      var a = (i / 5) * Math.PI * 2 + r() * 0.5, uz = R * (0.9 + r() * 0.22);
      x.save(); x.rotate(a);
      x.lineCap = "round";
      x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.8, R * 0.055);
      x.beginPath(); x.moveTo(0, 0);
      x.quadraticCurveTo(uz * 0.55, -R * 0.14, uz, -R * 0.06); x.stroke();
      x.strokeStyle = rgba(acik, 1); x.lineWidth = Math.max(0.9, R * 0.026); x.stroke();
      for (q = 1; q <= 7; q++) {
        var t2 = q / 8, px = uz * t2, py = -R * 0.14 * Math.sin(t2 * 3.1);
        var boyu = R * 0.26 * (1 - t2 * 0.55);
        x.strokeStyle = rgba(q % 2 ? acik : yes, 0.95);
        x.lineWidth = Math.max(0.9, R * 0.022);
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + boyu * 0.35, py - boyu); x.stroke();
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + boyu * 0.35, py + boyu); x.stroke();
      }
      x.restore();
    }
  }
  function cizFeslegen(x, R, yes, tur, r) {
    var n, i, q, koyu = ton(yes, -0.3), acik = ton(yes, 0.16);
    for (n = 2; n >= 1; n--) {
      for (i = 0; i < 2; i++) {
        var a = i * Math.PI + (n === 2 ? 0 : Math.PI / 2);
        var uz = R * (n === 2 ? 0.95 : 0.66), en = R * (n === 2 ? 0.4 : 0.3);
        x.save(); x.rotate(a + (r() - 0.5) * 0.14);
        x.beginPath();
        x.moveTo(R * 0.1, 0);
        x.bezierCurveTo(uz * 0.35, -en, uz * 0.82, -en * 0.72, uz, 0);
        x.bezierCurveTo(uz * 0.82, en * 0.72, uz * 0.35, en, R * 0.1, 0);
        x.closePath();
        var g = x.createLinearGradient(0, -en, uz, en);
        g.addColorStop(0, rgba(n === 2 ? yes : acik, 1));
        g.addColorStop(1, rgba(koyu, 1));
        x.fillStyle = g; x.fill();
        x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.7, en * 0.26);
        x.lineJoin = "round"; x.stroke();
        x.strokeStyle = "rgba(228,252,192,.5)"; x.lineWidth = Math.max(1, en * 0.14);
        x.beginPath(); x.moveTo(R * 0.16, 0); x.lineTo(uz * 0.88, 0); x.stroke();
        x.strokeStyle = "rgba(26,52,16,.4)"; x.lineWidth = Math.max(0.8, en * 0.08);
        for (q = 1; q <= 3; q++) {
          var t2 = q / 4;
          x.beginPath(); x.moveTo(uz * t2, 0);
          x.lineTo(uz * (t2 + 0.16), -en * 0.5 * (1 - t2)); x.stroke();
          x.beginPath(); x.moveTo(uz * t2, 0);
          x.lineTo(uz * (t2 + 0.16), en * 0.5 * (1 - t2)); x.stroke();
        }
        x.restore();
      }
    }
  }
  var CIZER = {
    marul: cizMarul, roka: cizRoka, semizotu: cizSemizotu,
    maydanoz: cizMaydanoz, havuc: cizHavuc,
    feslegen: cizFeslegen, "fesleğen": cizFeslegen
  };

  /* --- aile biçimleri (yedek yol) -------------------------------------- */
  function aileCiz(x, aile, R, yes, tur, r) {
    var i, n, a, q, koyu = ton(yes, -0.34), acik = ton(yes, 0.3);
    var trenk = hexRGB((tur && tur.renk) || "#f4a259");
    if (aile === "rozet") {
      for (n = 3; n >= 1; n--) {
        halka(x, r, 5 + n * 3, R * (n / 3), R * (n / 3) * 0.6,
          rgba(n === 1 ? acik : yes, 1), rgba(n === 3 ? koyu : yes, 1), n * 0.55);
      }
      goz(x, R, ton(acik, 0.2), 0.16);
    } else if (aile === "tuy") {
      for (i = 0; i < 5; i++) {
        a = (i / 5) * Math.PI * 2 + r() * 0.4;
        x.save(); x.rotate(a);
        x.lineCap = "round";
        x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.8, R * 0.06);
        x.beginPath(); x.moveTo(0, 0); x.lineTo(R * 0.95, 0); x.stroke();
        x.strokeStyle = rgba(acik, 1); x.lineWidth = Math.max(1, R * 0.03); x.stroke();
        for (q = 1; q <= 6; q++) {
          var t3 = q / 7, bo = R * 0.22 * (1 - t3 * 0.5);
          x.strokeStyle = rgba(yes, 0.95); x.lineWidth = Math.max(0.9, R * 0.024);
          x.beginPath(); x.moveTo(R * 0.95 * t3, 0);
          x.lineTo(R * 0.95 * t3 + bo * 0.35, -bo); x.stroke();
          x.beginPath(); x.moveTo(R * 0.95 * t3, 0);
          x.lineTo(R * 0.95 * t3 + bo * 0.35, bo); x.stroke();
        }
        x.restore();
      }
    } else if (aile === "serit") {
      halka(x, r, 7, R, R * 0.13, rgba(acik, 1), rgba(yes, 1), 0.4);
      omuz(x, R, ton(yes, 0.5), 0.19);
    } else if (aile === "cift") {
      for (n = 2; n >= 1; n--) {
        for (i = 0; i < 4; i++) {
          a = (i / 4) * Math.PI * 2 + n * 0.78;
          x.save(); x.rotate(a); x.translate(R * 0.16 * n, 0);
          x.beginPath();
          x.ellipse(R * 0.34 * n, 0, R * 0.36 * n, R * 0.27 * n, 0, 0, 6.3);
          x.fillStyle = rgba(n === 1 ? yes : koyu, 1); x.fill();
          x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.6, R * 0.06); x.stroke();
          x.restore();
        }
      }
      goz(x, R, koyu, 0.1);
    } else if (aile === "loblu") {
      for (i = 0; i < 5; i++) {
        a = (i / 5) * Math.PI * 2 + r() * 0.3;
        var uzk = R * (0.5 + r() * 0.22);
        x.save(); x.rotate(a);
        x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.8, R * 0.06); x.lineCap = "round";
        x.beginPath(); x.moveTo(0, 0); x.lineTo(uzk * 0.62, 0); x.stroke();
        x.translate(uzk * 0.62, 0); x.rotate((r() - 0.5) * 0.5);
        x.beginPath();
        for (q = 0; q <= 40; q++) {
          var tq = (q / 40) * Math.PI * 2;
          var kq = R * 0.56 * (0.52 + 0.48 * Math.pow(Math.abs(Math.cos(tq * 2.5)), 0.7));
          if (q === 0) x.moveTo(Math.cos(tq) * kq, Math.sin(tq) * kq * 0.74);
          else x.lineTo(Math.cos(tq) * kq, Math.sin(tq) * kq * 0.74);
        }
        x.closePath();
        x.fillStyle = rgba(i % 2 ? koyu : ton(yes, -0.12), 1); x.fill();
        x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.9, R * 0.07);
        x.lineJoin = "round"; x.stroke();
        x.restore();
      }
    } else if (aile === "cicek") {
      halka(x, r, 5, R * 0.96, R * 0.4, rgba(yes, 1), rgba(koyu, 1), 0);
      var tr = hexRGB((tur && tur.renk) || "#facc15");
      for (i = 0; i < 14; i++) {
        a = (i / 14) * Math.PI * 2;
        x.beginPath();
        x.ellipse(Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4, R * 0.24, R * 0.11, a, 0, 6.3);
        x.fillStyle = rgba(ton(tr, i % 2 ? 0.2 : 0), 1); x.fill();
        x.strokeStyle = "rgba(96,64,10,.85)"; x.lineWidth = Math.max(1, R * 0.03); x.stroke();
      }
      goz(x, R, { r: 74, g: 50, b: 24 }, 0.27);
    } else if (aile === "turp") {
      halka(x, r, 6, R * 0.82, R * 0.56, rgba(acik, 1), rgba(yes, 1), 0);
      omuz(x, R, trenk, 0.28);
    } else {
      /* TÜR TANINMADI — uydurma siluet yok. */
      x.setLineDash([Math.max(3, R * 0.18), Math.max(3, R * 0.13)]);
      x.strokeStyle = "rgba(64,74,64,.9)"; x.lineWidth = Math.max(1.8, R * 0.085);
      for (i = 0; i < 5; i++) {
        a = (i / 5) * Math.PI * 2;
        x.beginPath();
        x.ellipse(Math.cos(a) * R * 0.34, Math.sin(a) * R * 0.34, R * 0.44, R * 0.28, a, 0, 6.3);
        x.stroke();
      }
      x.setLineDash([]);
    }
  }

  /** Sprite — kademeli yarıçapta pişiyor, aradaki fark çizerken
   *  ölçekleniyor: zoom sırasında her adımda yeniden pişmesin. */
  function spriteAl(b) {
    var cap = sayi(b.yaricap_mm, 0) * 2 || sayi(b.yayilim_mm, 60);
    var R = kis((cap / KARO_MM) * G.tw / 2, OKUNUR_TABAN, G.tw * 0.72);
    var bic = bicimSec(b);
    var Rq = Math.max(OKUNUR_TABAN, Math.pow(1.18, Math.round(Math.log(R) / Math.log(1.18))));
    var olcek = R / Rq;
    var ah = (bic.ozel ? bic.slug : bic.aile) + "|" + (b.tur || "?") + "|"
      + Rq.toFixed(1) + "|" + Math.round(S.dpr * 10);
    if (S.sprite[ah]) return sprOlcek(S.sprite[ah], R, olcek);
    var boy = Math.ceil(Rq * 2 + 10);
    var c = document.createElement("canvas");
    c.width = Math.max(2, Math.ceil(boy * S.dpr));
    c.height = Math.max(2, Math.ceil(boy * ISO * S.dpr) + 2);
    var x = c.getContext("2d");
    x.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    x.translate(boy / 2, boy * ISO / 2);
    x.scale(1, ISO);                        /* üstten bakış izometriğe oturuyor */
    var kay = TON[bic.slug];
    if (kay === undefined) kay = TON[bic.aile] || 0;
    var yes = ton(karis(hexRGB(b.renk || "#7bbf5a"), YESIL, 0.6), kay);
    var r = uretec(Math.floor(tohum(b.tur || b.ad) * 4294967295));
    if (CIZER[bic.slug]) CIZER[bic.slug](x, Rq, yes, { renk: b.renk }, r);
    else aileCiz(x, bic.aile, Rq, yes, { renk: b.renk }, r);
    var s = { tuval: c, tamEn: boy, en: boy, boy: boy * ISO, R: Rq, bicim: bic };
    var say = 0; for (var kk in S.sprite) say++;
    if (say > 120) S.sprite = {};
    S.sprite[ah] = s;
    return sprOlcek(s, R, olcek);
  }
  function sprOlcek(s, R, olcek) {
    s.en = s.tamEn * olcek; s.boy = s.tamEn * ISO * olcek; s.R = R;
    return s;
  }
  /** Bitki karonun ÜSTÜNDE duruyor: gölgesi karoda kalıyor, gövdesi
   *  gölgenin üstünde. Aradaki boşlukta nem halkası görünüyor. */
  function govdeYuk() { return G.th * 0.7; }

  /* ==================================================================== *
   * NEM HALKASI — bitkinin dibinde.
   *
   * ÖLÇÜM VARSA halka ölçülen ORANDA doluyor (yay = %0..%100, bir oran;
   * hiçbir yere mm yazılmıyor). ÖLÇÜM YOKSA halka TARALI ve boş: yokluğun
   * kendisi, bir simge değil. Ödünç ya da bayat okuma kehribar ve kesik.
   * Sulama halkayı DOLDURMUYOR — üstünde geçici bir sızma halkası
   * yayılıyor; su verildi, nem ölçülmedi.
   * ==================================================================== */
  var _tarama = null;
  function taramaDeseni(c) {
    if (_tarama) return _tarama;
    var t = document.createElement("canvas");
    t.width = 8; t.height = 8;
    var k = t.getContext("2d");
    k.strokeStyle = "rgba(56,40,24,.55)"; k.lineWidth = 1.2;
    k.beginPath();
    k.moveTo(-2, 10); k.lineTo(10, -2);
    k.moveTo(-2, 2); k.lineTo(2, -2);
    k.moveTo(6, 10); k.lineTo(10, 6);
    k.stroke();
    _tarama = c.createPattern(t, "repeat");
    return _tarama;
  }
  function nemCiz(c) {
    c.save();
    tarlaYol(c); c.clip();
    for (var i = 0; i < S.bitki.length; i++) {
      var b = S.bitki[i];
      var sp = spriteAl(b);
      var u = uOf(b.x), v = vOf(b.y);
      var x = ex(u, v), y = ey(u, v);
      var R = Math.max(9, sp.R * 0.82), kal = Math.max(3.5, R * 0.22);
      if (x < -R * 3 || x > S.en + R * 3 || y < -R * 3 || y > S.boy + R * 3) continue;
      var n = nemDurum(b), rev = b._reveal === undefined ? 1 : kis(sayi(b._reveal, 1), 0, 1);
      c.save();
      c.translate(x, y); c.scale(1, ISO);
      /* Yatak: her zaman duran ince oluk — halkanın nereye oturduğu belli. */
      c.beginPath(); c.arc(0, 0, R, 0, 6.3);
      c.strokeStyle = "rgba(52,30,10,.38)"; c.lineWidth = kal + 2; c.stroke();
      if (!n.var || rev < 1) {
        /* TARALI HALKA — bir simge değil, yokluğun kendisi. */
        c.save();
        c.globalAlpha = n.var ? (1 - rev) : 1;
        c.beginPath(); c.arc(0, 0, R, 0, 6.3);
        c.strokeStyle = taramaDeseni(c); c.lineWidth = kal; c.stroke();
        c.setLineDash([3, 3]);
        c.strokeStyle = "rgba(58,42,26,.85)"; c.lineWidth = 1; c.stroke();
        c.setLineDash([]);
        c.restore();
      }
      if (n.var) {
        /* DOLGU: yay ölçülen ORAN kadar. Bu bir oran (%0..%100),
           uzunluk iddiası yok; hiçbir yere mm yazılmıyor. */
        var p = n.yuzde / 100;
        var islak = { r: 54, g: 132, b: 190 }, kuru = { r: 176, g: 126, b: 70 };
        var renk = karis(kuru, islak, p);
        var kuv = (n.kendi ? 1 : 0.55) * (n.bayat ? 0.6 : 1);
        c.save();
        c.beginPath();
        c.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + kis(p, 0, 1) * rev * Math.PI * 2);
        c.strokeStyle = rgba(renk, kuv); c.lineWidth = kal;
        /* Ödünç ya da bayat okuma KESİK: ölçülmüş gibi durmuyor. */
        if (!n.kendi || n.bayat) c.setLineDash([5, 4]);
        c.stroke();
        c.restore();
        /* EŞİK: susama sınırı halkanın üstünde ince bir çentik. */
        if (n.esikAcik && n.esik > 0) {
          var ea = -Math.PI / 2 + kis(n.esik / 100, 0, 1) * Math.PI * 2;
          c.beginPath();
          c.moveTo(Math.cos(ea) * (R - kal), Math.sin(ea) * (R - kal));
          c.lineTo(Math.cos(ea) * (R + kal), Math.sin(ea) * (R + kal));
          c.strokeStyle = b.susadi ? "rgba(206,88,52,.95)" : "rgba(70,56,40,.6)";
          c.lineWidth = b.susadi ? 2.4 : 1.4;
          c.stroke();
        }
      }
      /* SU İNİYOR — ölçüm DEĞİL. Halkayı doldurmuyor; üstünde geçici bir
         sızma halkası yayılıyor. Su verildi, nem ölçülmedi. */
      var sz = sayi(b._sizma, 0);
      if (sz > 0.02) {
        c.beginPath(); c.arc(0, 0, R * (1 + sz * 0.7), 0, 6.3);
        c.strokeStyle = "rgba(72,148,208," + (0.7 * (1 - sz * 0.55)).toFixed(2) + ")";
        c.lineWidth = 2.4; c.setLineDash([4, 5]); c.stroke();
        c.setLineDash([]);
      }
      c.restore();
    }
    c.restore();
  }

  /* ==================================================================== *
   * BİTKİLER
   * ==================================================================== */
  function bitkiCiz(c) {
    var w = S.ruzgar, kalk = govdeYuk();
    var sirali = S.bitki.slice().sort(function (a, b) {
      return (uOf(a.x) + vOf(a.y)) - (uOf(b.x) + vOf(b.y));
    });
    sirali.forEach(function (b) {
      var u = uOf(b.x), v = vOf(b.y);
      var x = ex(u, v), y = ey(u, v);
      var sp = spriteAl(b);
      if (x < -sp.en || x > S.en + sp.en || y < -sp.en || y > S.boy + sp.en) return;
      var faz = tohum(b.ad) * 6.3;
      var sal = S.sakin ? 0
        : (Math.sin(S.t * 1.2 + faz) * 0.034 + Math.sin(S.t * 2.7 + faz * 1.7) * 0.012)
          * (0.35 + w.guc * 0.9);
      var secili = S.secili === b.ad;
      var nefes = (secili && !S.sakin) ? 1 + Math.sin(S.t * 2.1) * 0.03 : 1;
      var gy = y - kalk;

      /* UZUN GÖLGE — güneş sol üstte. */
      c.save();
      c.globalAlpha = 0.3; c.fillStyle = "#4a3520";
      c.beginPath();
      c.ellipse(x - ISIK.x * kalk * 0.9, y - ISIK.y * kalk * 0.3,
        sp.R * 1.05, sp.R * 0.85 * ISO, 0, 0, 6.3);
      c.fill();
      c.restore();
      /* Sap: gövdeyi gölgesine bağlıyor. */
      c.save();
      c.strokeStyle = "rgba(58,90,38,.95)";
      c.lineWidth = Math.max(1.8, sp.R * 0.1); c.lineCap = "round";
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, gy + sp.boy * 0.1); c.stroke();
      c.restore();

      c.save();
      c.translate(x, gy);
      c.rotate(sal);
      c.scale(nefes, nefes);
      c.drawImage(sp.tuval, -sp.en / 2, -sp.boy / 2, sp.en, sp.boy);
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.14;
      c.drawImage(sp.tuval, -sp.en / 2 + ISIK.x * 2.2, -sp.boy / 2 + ISIK.y * 1.5,
        sp.en, sp.boy);
      c.restore();

      /* Sulamadan sonra yaprakta kalan damlalar. */
      var dm = sayi(b._damlaT, 0);
      if (dm > 0) {
        var dr = uretec(Math.floor(tohum(b.ad + "d") * 4294967295));
        c.save();
        c.globalAlpha = kis(dm / 6, 0, 1) * 0.9;
        c.fillStyle = "rgba(226,244,255,.98)";
        for (var q = 0; q < 5; q++) {
          var da = dr() * 6.3, dd = dr() * sp.R * 0.8;
          c.beginPath();
          c.arc(x + Math.cos(da) * dd, gy + Math.sin(da) * dd * ISO, 1.6, 0, 6.3);
          c.fill();
        }
        c.restore();
      }
      /* SUSADI — ölçüme dayanan tam, tahmin kesik. */
      if (b.susadi) {
        var tah = b.su_kanit !== "olculen";
        c.save();
        c.strokeStyle = "rgba(212,96,46,.95)";
        c.lineWidth = tah ? 1.6 : 2.4;
        c.setLineDash(tah ? [3, 5] : [8, 5]);
        c.lineDashOffset = -S.t * 6;
        c.beginPath();
        c.ellipse(x, y, sp.R * 1.35, sp.R * 1.35 * ISO, 0, 0, 6.3);
        c.stroke();
        c.restore();
      }
      /* HASADA HAZIR — geri sayım yok, olgunluk bir ölçüm değil. */
      if (b.hasat) {
        var hy = gy - sp.boy / 2 - 14 + Math.sin(S.t * 2 + faz) * 1.6;
        c.save();
        c.fillStyle = "rgba(60,132,74,.98)";
        c.beginPath();
        if (c.roundRect) c.roundRect(x - 9, hy - 9, 18, 16, 5); else c.rect(x - 9, hy - 9, 18, 16);
        c.fill();
        c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 1.6; c.stroke();
        c.strokeStyle = "#fff"; c.lineWidth = 2; c.lineCap = "round";
        c.beginPath();
        c.moveTo(x - 4, hy - 1); c.lineTo(x - 1, hy + 2.5); c.lineTo(x + 4.5, hy - 4);
        c.stroke();
        c.restore();
      }
      /* TÜR TANINMADI: uydurma siluet yok ve bunun jenerik olduğu yazıyor.
         Kırmızı değil — bir hata değil, bir bilgi eksiği. */
      if (!sp.bicim.bilinen) {
        etiketCiz(c, "tür tanınmadı", x, y + G.th * 2, "rgba(126,96,42,.9)");
      }
      if (secili) {
        c.save();
        c.strokeStyle = "rgba(255,255,255,.95)"; c.lineWidth = 2.4;
        c.beginPath();
        c.ellipse(x, gy, (sp.R + 4) * nefes, (sp.R + 4) * nefes * ISO, 0, 0, 6.3);
        c.stroke();
        /* GERÇEK YAYILIM — siluet üst sınırlı, bu çember ölçünün kendisi. */
        var yay = sayi(b.yayilim_mm, 0);
        if (yay > 0) {
          var yr = (yay / KARO_MM) * G.tw / 2;
          c.setLineDash([5, 5]);
          c.strokeStyle = "rgba(255,255,255,.55)"; c.lineWidth = 1.2;
          c.beginPath(); c.ellipse(x, y, yr, yr * ISO, 0, 0, 6.3); c.stroke();
          c.setLineDash([]);
        }
        c.restore();
      }
    });
  }

  /* ==================================================================== *
   * VURUŞ — çizilen siluetin kendisi (ankraj değil).
   * ==================================================================== */
  function vurusKutusu(b, pay) {
    var sp = spriteAl(b);
    var u = uOf(b.x), v = vOf(b.y);
    var x = ex(u, v), y = ey(u, v), gy = y - govdeYuk();
    pay = pay || 0;
    return { x1: x - sp.en / 2 - pay, x2: x + sp.en / 2 + pay,
             y1: gy - sp.boy / 2 - pay, y2: y + sp.R * ISO + pay,
             derinlik: u + v, x: x, y: y, gy: gy };
  }
  /** Üst üste binende EN ÖNDEKİ (en son çizilen) kazanıyor. */
  function bitkiBul(p, pay) {
    var en = null, enD = -1e9, enU = 1e9;
    for (var i = 0; i < S.bitki.length; i++) {
      var k = vurusKutusu(S.bitki[i], pay);
      if (p.x < k.x1 || p.x > k.x2 || p.y < k.y1 || p.y > k.y2) continue;
      var d = Math.hypot(p.x - k.x, p.y - k.gy);
      if (k.derinlik > enD || (k.derinlik === enD && d < enU)) {
        enD = k.derinlik; enU = d; en = S.bitki[i];
      }
    }
    return en;
  }

  /* ==================================================================== *
   * MAKİNE VE ÇİFTÇİ — ÇİFTÇİ = EKSEN.
   *
   * Köprü makine Y'sinde yürüyor, kızak makine X'inde kayıyor; çiftçi
   * kızağın altında, yani tam makine koordinatında duruyor. Konum durum
   * paketinden geliyor ve çizilen konum BİLDİRİLENİN ÖNÜNE GEÇMİYOR:
   * eksen dururken çiftçi duruyor, makine kopuksa kımıldamıyor, hiç konum
   * gelmediyse çizilmiyor.
   * ==================================================================== */
  function rayYuk() { return Math.max(26, G.th * 3.2); }

  function makineCiz(c) {
    var e = engel();
    var varMi = S.ciz.x != null;
    var RY = rayYuk();
    var v = varMi ? kis(vOf(S.ciz.y), 0, G.ny) : G.ny / 2;
    var A = { x: ex(0, v), y: ey(0, v) }, B = { x: ex(G.nx, v), y: ey(G.nx, v) };
    c.save();
    c.globalAlpha = e.engel ? 0.45 : 1;
    c.lineJoin = "round";
    /* Köprünün toprağa düşen gölgesi — güneş sol üstte. */
    c.save();
    c.globalAlpha = (e.engel ? 0.45 : 1) * 0.2; c.strokeStyle = "#3d4a56";
    c.lineWidth = 7;
    c.beginPath(); c.moveTo(A.x + RY * 0.5, A.y); c.lineTo(B.x + RY * 0.5, B.y); c.stroke();
    c.restore();
    [A, B].forEach(function (p) {
      c.fillStyle = "#b9c2c8";
      c.fillRect(p.x - 3.5, p.y - RY, 7, RY);
      c.strokeStyle = "rgba(40,50,58,.9)"; c.lineWidth = 1.8;
      c.strokeRect(p.x - 3.5, p.y - RY, 7, RY);
    });
    var g = c.createLinearGradient(0, A.y - RY - 6, 0, A.y - RY + 6);
    g.addColorStop(0, "#f2f6f8"); g.addColorStop(0.5, "#b6bec4"); g.addColorStop(1, "#7c848a");
    c.strokeStyle = g; c.lineWidth = 8; c.lineCap = "round";
    c.beginPath(); c.moveTo(A.x, A.y - RY); c.lineTo(B.x, B.y - RY); c.stroke();
    c.strokeStyle = "rgba(40,50,58,.7)"; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(A.x, A.y - RY); c.lineTo(B.x, B.y - RY); c.stroke();
    if (varMi) {
      var u = kis(uOf(S.ciz.x), 0, G.nx);
      var kx = ex(u, v), ky = ey(u, v);
      c.fillStyle = "#fbfdfb";
      c.beginPath();
      if (c.roundRect) c.roundRect(kx - 14, ky - RY - 10, 28, 19, 5);
      else c.rect(kx - 14, ky - RY - 10, 28, 19);
      c.fill();
      c.strokeStyle = "rgba(40,50,58,.9)"; c.lineWidth = 2; c.stroke();
      /* Z takımı ÖLÇÜLEN z kadar iniyor. */
      var inis = (1 - zYuksek()) * RY * 0.72;
      c.strokeStyle = "#cdd4d9"; c.lineWidth = 3.4;
      c.beginPath(); c.moveTo(kx, ky - RY + 6); c.lineTo(kx, ky - RY + 6 + inis); c.stroke();
      c.strokeStyle = "rgba(40,50,58,.6)"; c.lineWidth = 1; c.stroke();
    }
    c.restore();
  }

  function ciftciCiz(c) {
    if (S.ciz.x == null) {
      /* Hiç konum bildirilmedi: uydurma bir yere çiftçi koymuyoruz. */
      c.save();
      c.font = "600 12px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = "rgba(150,40,32,.95)";
      c.fillText("konum bildirilmedi — çiftçi çizilemiyor", S.en / 2, S.boy * 0.52);
      c.restore();
      return;
    }
    var e = engel();
    var u = kis(uOf(S.ciz.x), 0, G.nx), v = kis(vOf(S.ciz.y), 0, G.ny);
    var x = ex(u, v), y = ey(u, v);
    /* Konum artık bildirilmiyorsa çiftçi SON YERİNDE ve sönük duruyor. */
    if (S.konumYok) { c.save(); c.globalAlpha = 0.45; }
    var boy = Math.max(24, G.tw * 0.56);
    var egik = 1 - zYuksek();                /* DURUŞ Z'DEN */
    var is = calisanIs(), su = suAkiyor(), tohumDus = tUzama();
    /* Yürürken ayak değiştirme — konum GERÇEKTEN değişiyorsa. */
    var yuruyor = S.bildirilen.x != null
      && Math.hypot(S.ciz.x - S.bildirilen.x, S.ciz.y - S.bildirilen.y) > 0.6;
    var adim = yuruyor ? Math.sin(S.t * 9) : 0;
    c.save();
    c.translate(x, y);
    c.globalAlpha = 0.28; c.fillStyle = "#4a3520";
    c.beginPath();
    c.ellipse(-ISIK.x * boy * 0.3, -ISIK.y * boy * 0.1,
      boy * 0.36, boy * 0.36 * ISO, 0, 0, 6.3);
    c.fill();
    c.globalAlpha = 1;
    c.translate(0, -boy * 0.08);
    c.rotate(egik * 0.2);
    var w = boy * 0.3;
    c.lineJoin = "round"; c.lineCap = "round";
    c.strokeStyle = "#3d4a3a"; c.lineWidth = Math.max(2.6, boy * 0.12);
    c.beginPath(); c.moveTo(-w * 0.35 - adim * w * 0.2, 0);
    c.lineTo(-w * 0.4, -boy * 0.34); c.stroke();
    c.beginPath(); c.moveTo(w * 0.35 + adim * w * 0.2, 0);
    c.lineTo(w * 0.4, -boy * 0.34); c.stroke();
    c.fillStyle = "#4f8fd0";
    c.beginPath();
    if (c.roundRect) c.roundRect(-w / 2, -boy * 0.74, w, boy * 0.42, w * 0.28);
    else c.rect(-w / 2, -boy * 0.74, w, boy * 0.42);
    c.fill();
    c.strokeStyle = "rgba(20,40,64,.9)"; c.lineWidth = Math.max(1.6, boy * 0.055);
    c.stroke();
    c.strokeStyle = "#4f8fd0"; c.lineWidth = Math.max(2.2, boy * 0.1);
    var kol = is ? -0.5 : 0.1;
    c.beginPath(); c.moveTo(-w * 0.45, -boy * 0.66);
    c.lineTo(-w * 0.75, -boy * (0.5 + kol * 0.2)); c.stroke();
    c.beginPath(); c.moveTo(w * 0.45, -boy * 0.66);
    c.lineTo(w * 0.75, -boy * (0.5 + kol * 0.2)); c.stroke();
    c.fillStyle = "#f0d3ac";
    c.beginPath(); c.arc(0, -boy * 0.84, boy * 0.13, 0, 6.3); c.fill();
    c.strokeStyle = "rgba(72,48,24,.9)"; c.lineWidth = Math.max(1.4, boy * 0.05); c.stroke();
    c.fillStyle = "#e0b169";
    c.beginPath(); c.ellipse(0, -boy * 0.92, boy * 0.28, boy * 0.075, 0, 0, 6.3); c.fill();
    c.beginPath(); c.arc(0, -boy * 0.96, boy * 0.12, Math.PI, 0); c.fill();
    c.strokeStyle = "rgba(96,62,18,.95)"; c.lineWidth = Math.max(1.4, boy * 0.05); c.stroke();
    /* ELDEKİ ALET — çalışan işten. İş yoksa alet de yok. */
    if (is && is.tip === "sula") {
      c.fillStyle = "#7fb4dd";
      c.beginPath();
      if (c.roundRect) c.roundRect(w * 0.6, -boy * 0.62, boy * 0.22, boy * 0.18, 3);
      else c.rect(w * 0.6, -boy * 0.62, boy * 0.22, boy * 0.18);
      c.fill();
      c.strokeStyle = "rgba(14,40,62,.9)"; c.lineWidth = 1.4; c.stroke();
    } else if (is && is.tip === "nem") {
      c.strokeStyle = "#58b463"; c.lineWidth = Math.max(2, boy * 0.08);
      c.beginPath();
      c.moveTo(w * 0.72, -boy * 0.66); c.lineTo(w * 0.72, -boy * (0.2 - egik * 0.18));
      c.stroke();
    } else if (is && is.tip === "ek") {
      c.fillStyle = "#e6d5a4";
      c.beginPath(); c.arc(w * 0.75, -boy * 0.55, boy * 0.11, 0, 6.3); c.fill();
      c.strokeStyle = "rgba(70,56,20,.9)"; c.lineWidth = 1.4; c.stroke();
    }
    c.restore();
    /* SU — kaynak POMPA RÖLESİ, komut değil. */
    if (su) {
      c.save();
      c.strokeStyle = "rgba(84,164,222,.92)"; c.lineWidth = 2.2; c.lineCap = "round";
      for (var i = 0; i < 5; i++) {
        var a = S.t * 7 + i * 1.3;
        var sx = x + w * 0.7 + Math.sin(a) * 2;
        c.beginPath();
        c.moveTo(sx, y - boy * 0.5);
        c.lineTo(sx + Math.sin(a) * 3, y - boy * 0.06 - (i % 3) * 2);
        c.stroke();
      }
      c.restore();
    }
    /* TOHUM — kaynak tohum ucunun KENDİ EKSENİ. */
    if (tohumDus > 0.08) {
      c.save();
      c.fillStyle = "#f2e0b0";
      c.beginPath();
      c.ellipse(x, y - boy * 0.3 * (1 - tohumDus), 2.6, 3.2, 0, 0, 6.3);
      c.fill();
      c.restore();
    }
    if (S.konumYok) c.restore();
    /* Eksen duruyorsa sebebi çiftçinin başında yazıyor. */
    if (e.engel) {
      c.save();
      c.font = "600 11px system-ui,sans-serif"; c.textAlign = "center";
      var m = e.yazi, w2 = c.measureText(m).width;
      c.fillStyle = "rgba(150,40,32,.92)";
      c.beginPath();
      if (c.roundRect) c.roundRect(x - w2 / 2 - 6, y - boy * 1.5 - 11, w2 + 12, 16, 8);
      else c.rect(x - w2 / 2 - 6, y - boy * 1.5 - 11, w2 + 12, 16);
      c.fill();
      c.fillStyle = "#fff";
      c.fillText(m, x, y - boy * 1.5);
      c.restore();
    }
  }

  /* ==================================================================== *
   * EFEKTLER — üçü de GERÇEK ilerlemeden sürülüyor.
   *   sulama → pompa rölesi (ölçüm paketi)
   *   ekim   → tohum ucunun kendi ekseni
   *   ölçüm  → SİNYAL YOK; başlatılan işten türetiliyor ve öyle yazıyor
   * ==================================================================== */
  function isHedefi(is) {
    if (!is || S.ciz.x == null) return null;
    var adlar = is.noktalar || [];
    for (var i = 0; i < adlar.length; i++) {
      var b = S.ix[String(adlar[i])];
      if (b && Math.hypot(sayi(b.x) - S.ciz.x, sayi(b.y) - S.ciz.y) < 70) return b;
    }
    return null;
  }
  function efektEkle(tip, ad) {
    S.efekt.push({ tip: tip, ad: ad, t0: S.t, t: 0 });
    kirlet();
  }
  function zerreEk(x, y, adet, renk, guc) {
    for (var i = 0; i < adet; i++) {
      S.zerre.push({ x: x, y: y, vx: (Math.random() - 0.5) * guc,
                     vy: -Math.random() * guc * 0.8,
                     omur: 0.35 + Math.random() * 0.45, tam: 0.8, renk: renk,
                     r: 1 + Math.random() * 1.6 });
    }
    if (S.zerre.length > 160) S.zerre.splice(0, S.zerre.length - 160);
  }
  function izEkle(tip, x, y) {
    S.iz.push({ tip: tip, x: x, y: y, omur: tip === "ayak" ? 4 : 0.9,
                tam: tip === "ayak" ? 4 : 0.9 });
    if (S.iz.length > 40) S.iz.shift();
  }

  function efektGuncelle(dt) {
    var is = calisanIs(), kimlik = is ? String(is.kimlik) : "";
    var hedef = isHedefi(is), i, k;
    /* KAPANIŞ — iş çalışır durumdan çıktıysa sessizce sönmüyor. */
    for (k in S.sonIsler) {
      if (k !== kimlik) {
        efektEkle("kapanis", "");
        mesajYaz((S.sonIsler[k] || "İş") + " bitti.");
        delete S.sonIsler[k];
      }
    }
    if (is) S.sonIsler[kimlik] = is.etiket || is.tip;
    /* Ayak izi — konum GERÇEKTEN değişince. */
    if (S.ciz.x != null) {
      if (S.sonAdim == null) S.sonAdim = { x: S.ciz.x, y: S.ciz.y };
      if (Math.hypot(S.ciz.x - S.sonAdim.x, S.ciz.y - S.sonAdim.y) > 26) {
        izEkle("ayak", ex(uOf(S.ciz.x), vOf(S.ciz.y)) + (Math.random() - 0.5) * 6,
          ey(uOf(S.ciz.x), vOf(S.ciz.y)) + 2);
        S.sonAdim = { x: S.ciz.x, y: S.ciz.y };
      }
    }
    var su = suAkiyor();
    if (is && is.tip === "sula" && su && hedef) {
      hedef._islak = kis(sayi(hedef._islak, 0) + dt / Math.max(1, sayi(hedef.sulama_saniye, 3)), 0, 1);
      hedef._damlaT = 6;
      hedef._sizma = kis(sayi(hedef._sizma, 0) + dt * 0.5, 0, 1);
      if (Math.random() < dt * 26) {
        zerreEk(ex(uOf(hedef.x), vOf(hedef.y)), ey(uOf(hedef.x), vOf(hedef.y)),
          1, "132,196,238", 60);
      }
    }
    var tu = tUzama();
    if (is && is.tip === "ek" && hedef) {
      hedef._delik = Math.max(sayi(hedef._delik, 0), tu);
      if (sayi(hedef._tuOnce, 0) > 0.45 && tu < 0.2) {
        hedef._hoyuk = 1;
        efektEkle("ekildi", hedef.ad);
        izEkle("toz", ex(uOf(hedef.x), vOf(hedef.y)), ey(uOf(hedef.x), vOf(hedef.y)));
      }
      hedef._tuOnce = tu;
    }
    /* NEM ÖLÇÜMÜ — sinyal yok: iş + Z'nin toprakta olması. */
    if (is && is.tip === "nem" && hedef && zYuksek() < 0.12) {
      if (!hedef._probT) {
        izEkle("toz", ex(uOf(hedef.x), vOf(hedef.y)), ey(uOf(hedef.x), vOf(hedef.y)));
      }
      hedef._probT = sayi(hedef._probT, 0) + dt;
    }
    S.bitki.forEach(function (b) {
      if (sayi(b._damlaT, 0) > 0) b._damlaT = Math.max(0, b._damlaT - dt);
      if (sayi(b._sizma, 0) > 0 && !(is && is.tip === "sula" && su)) {
        b._sizma = Math.max(0, b._sizma - dt * 0.35);
      }
      if (sayi(b._reveal, 0) > 0 && b._reveal < 1) b._reveal = kis(b._reveal + dt / 0.85, 0, 1);
    });
    for (i = S.zerre.length - 1; i >= 0; i--) {
      var z = S.zerre[i];
      z.vy += 210 * dt; z.x += z.vx * dt; z.y += z.vy * dt; z.omur -= dt;
      if (z.omur <= 0) S.zerre.splice(i, 1);
    }
    for (i = S.iz.length - 1; i >= 0; i--) {
      S.iz[i].omur -= dt;
      if (S.iz[i].omur <= 0) S.iz.splice(i, 1);
    }
    for (i = S.efekt.length - 1; i >= 0; i--) {
      S.efekt[i].t = S.t - S.efekt[i].t0;
      if (S.efekt[i].t > 1.8) S.efekt.splice(i, 1);
    }
  }

  function izCiz(c) {
    for (var i = 0; i < S.iz.length; i++) {
      var z = S.iz[i], a = kis(z.omur / z.tam, 0, 1);
      c.save();
      if (z.tip === "ayak") {
        c.globalAlpha = a * 0.35; c.fillStyle = "#5a3c1c";
        c.beginPath(); c.ellipse(z.x, z.y, 3.6, 2.2, 0, 0, 6.3); c.fill();
      } else {
        c.globalAlpha = a * 0.4; c.fillStyle = "rgba(238,214,178,1)";
        var rr = (1 - a) * 13 + 3;
        c.beginPath(); c.ellipse(z.x, z.y, rr, rr * ISO, 0, 0, 6.3); c.fill();
      }
      c.restore();
    }
  }
  function efektCiz(c) {
    var is = calisanIs(), hedef = isHedefi(is), i;
    S.bitki.forEach(function (b) {
      var x = ex(uOf(b.x), vOf(b.y)), y = ey(uOf(b.x), vOf(b.y));
      var w = sayi(b._islak, 0);
      if (w > 0.02) {
        var R = G.tw * (0.3 + w * 0.34);
        c.save();
        c.globalAlpha = 0.4;
        c.translate(x, y); c.scale(1, ISO);
        var g = c.createRadialGradient(0, 0, 1, 0, 0, R);
        g.addColorStop(0, "rgba(74,42,14,.9)"); g.addColorStop(1, "rgba(74,42,14,0)");
        c.fillStyle = g;
        c.beginPath(); c.arc(0, 0, R, 0, 6.3); c.fill();
        c.restore();
        /* SU VERİLDİ, NEM ÖLÇÜLMEDİ. */
        if (w > 0.15 && !nemDurum(b).var) {
          etiketCiz(c, "sulandı · ölçülmedi", x, y + G.th * 1.7, "rgba(30,72,110,.92)");
        }
      }
      if (sayi(b._hoyuk, 0) > 0) {
        c.save();
        c.fillStyle = "rgba(198,150,92,.95)";
        c.beginPath(); c.ellipse(x, y, 7, 7 * ISO, 0, 0, 6.3); c.fill();
        c.strokeStyle = "rgba(66,38,14,.8)"; c.lineWidth = 1.4; c.stroke();
        c.restore();
      }
    });
    if (hedef && is) {
      var hx = ex(uOf(hedef.x), vOf(hedef.y)), hy = ey(uOf(hedef.x), vOf(hedef.y));
      var bu = kis(uOf(S.ciz.x), 0, G.nx), bv = kis(vOf(S.ciz.y), 0, G.ny);
      var bx = ex(bu, bv), by = ey(bu, bv) - rayYuk() * 0.35;
      if (is.tip === "sula" && suAkiyor()) {
        c.save();
        var sg = c.createLinearGradient(bx, by, hx, hy);
        sg.addColorStop(0, "rgba(150,214,252,.92)");
        sg.addColorStop(1, "rgba(84,164,222,.4)");
        c.strokeStyle = sg; c.lineWidth = 5; c.lineCap = "round";
        c.beginPath(); c.moveTo(bx, by);
        c.quadraticCurveTo((bx + hx) / 2 + Math.sin(S.t * 9) * 3, (by + hy) / 2, hx, hy);
        c.stroke();
        var hr = (S.t * 2.2 % 1);
        c.strokeStyle = "rgba(120,190,236," + ((1 - hr) * 0.8).toFixed(2) + ")";
        c.lineWidth = 2.4;
        c.beginPath();
        c.ellipse(hx, hy, 6 + hr * G.tw * 0.5, (6 + hr * G.tw * 0.5) * ISO, 0, 0, 6.3);
        c.stroke();
        c.restore();
      } else if (is.tip === "ek") {
        var dr = 4 + sayi(hedef._delik, 0) * G.tw * 0.24;
        c.save();
        c.fillStyle = "rgba(50,28,8,.75)";
        c.beginPath(); c.ellipse(hx, hy, dr, dr * ISO, 0, 0, 6.3); c.fill();
        c.strokeStyle = "rgba(226,190,140,.7)"; c.lineWidth = 1.6; c.stroke();
        if (tUzama() > 0.05) {
          c.fillStyle = "#f4e6ba";
          c.beginPath();
          c.ellipse(hx, hy - 16 + tUzama() * 16, 2.6, 3.2, 0, 0, 6.3); c.fill();
        }
        c.restore();
      } else if (is.tip === "nem" && sayi(hedef._probT, 0) > 0) {
        var bek = sayi(S.veri && S.veri.nem_bekleme_sn, 10);
        var p = kis(sayi(hedef._probT, 0) / Math.max(1, bek), 0, 1);
        var nb = 0.5 + Math.sin(S.t * 5) * 0.5;
        c.save();
        c.strokeStyle = "rgba(72,168,90," + (0.3 + nb * 0.4).toFixed(2) + ")";
        c.lineWidth = 2.4;
        var rr2 = G.tw * (0.34 + nb * 0.1);
        c.beginPath(); c.ellipse(hx, hy, rr2, rr2 * ISO, 0, 0, 6.3); c.stroke();
        c.strokeStyle = "rgba(50,148,70,.98)"; c.lineWidth = 3.6; c.lineCap = "round";
        c.beginPath();
        c.ellipse(hx, hy, G.tw * 0.5, G.tw * 0.5 * ISO, 0,
          -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        c.stroke();
        c.restore();
        /* SİNYAL YOK: bunu ekranda yazıyoruz. */
        etiketCiz(c, "prob duruşu · işten türetildi", hx, hy - G.tw * 0.5 * ISO - 12,
          "rgba(28,86,44,.92)");
      }
    }
    for (i = 0; i < S.zerre.length; i++) {
      var zz = S.zerre[i];
      c.fillStyle = "rgba(" + zz.renk + "," + kis(zz.omur / zz.tam, 0, 1).toFixed(2) + ")";
      c.beginPath(); c.arc(zz.x, zz.y, zz.r, 0, 6.3); c.fill();
    }
    S.efekt.forEach(function (e) {
      var pr = kis(e.t / 1.4, 0, 1);
      if (e.tip === "kapanis" && S.ciz.x != null) {
        var cx = ex(uOf(S.ciz.x), vOf(S.ciz.y)), cy = ey(uOf(S.ciz.x), vOf(S.ciz.y));
        c.save();
        c.globalAlpha = (1 - pr) * 0.85;
        c.strokeStyle = "rgba(255,255,255,.95)"; c.lineWidth = 2.6;
        var rr = G.tw * (0.3 + pr * 1.3);
        c.beginPath(); c.ellipse(cx, cy, rr, rr * ISO, 0, 0, 6.3); c.stroke();
        c.restore();
      } else if (e.tip === "ekildi") {
        var b2 = S.ix[e.ad];
        if (!b2) return;
        var bx2 = ex(uOf(b2.x), vOf(b2.y)), by2 = ey(uOf(b2.x), vOf(b2.y));
        c.save();
        c.globalAlpha = 1 - pr;
        c.fillStyle = "rgba(224,196,142,.95)";
        for (var q = 0; q < 6; q++) {
          var a2 = (q / 6) * 6.3;
          c.beginPath();
          c.arc(bx2 + Math.cos(a2) * pr * 16, by2 + Math.sin(a2) * pr * 16 * ISO, 1.8, 0, 6.3);
          c.fill();
        }
        c.restore();
      }
    });
  }

  /* ==================================================================== *
   * BOŞTAKİ HAYAT — hiçbiri BİLGİ TAŞIMIYOR.
   * Rüzgâr bir ölçüm değil (sensörü yok), o yüzden rastgele ve adı hiçbir
   * yerde geçmiyor. Toz zerreleri ve yaprak salınımı yalnız sahneyi canlı
   * tutuyor.
   * ==================================================================== */
  function hayatKur() {
    var r = uretec(5150);
    S.toz = [];
    for (var i = 0; i < 16; i++) {
      S.toz.push({ x: r() * S.en, y: r() * S.boy, vx: 0.15 + r() * 0.4,
                   vy: (r() - 0.5) * 0.14, r: 0.7 + r() * 1.7, a: 0.1 + r() * 0.22 });
    }
    S.ruzgar = { yon: r() * 6.3, guc: 0.35 + r() * 0.3, hYon: r() * 6.3, hGuc: 0.5 };
  }
  function hayatGuncelle(dt) {
    if (S.sakin) return;                    /* sakin mod: boştaki hayat durur */
    var w = S.ruzgar;
    if (Math.random() < dt * 0.25) {
      w.hYon = Math.random() * 6.3; w.hGuc = 0.2 + Math.random() * 0.8;
    }
    w.yon += (w.hYon - w.yon) * kis(dt * 0.4, 0, 1);
    w.guc += (w.hGuc - w.guc) * kis(dt * 0.5, 0, 1);
    for (var i = 0; i < S.toz.length; i++) {
      var t = S.toz[i];
      t.x += (t.vx + Math.cos(w.yon) * w.guc * 0.5) * dt * 26;
      t.y += (t.vy + Math.sin(w.yon) * w.guc * 0.2) * dt * 26;
      if (t.x > S.en + 4) { t.x = -4; t.y = Math.random() * S.boy; }
      if (t.x < -6) t.x = S.en + 4;
      if (t.y > S.boy + 4) t.y = -4;
      if (t.y < -6) t.y = S.boy + 4;
    }
  }
  function tozCiz(c) {
    if (S.sakin) return;
    for (var i = 0; i < S.toz.length; i++) {
      var t = S.toz[i];
      c.fillStyle = "rgba(255,250,232," + t.a.toFixed(2) + ")";
      c.beginPath(); c.arc(t.x, t.y, t.r, 0, 6.3); c.fill();
    }
  }

  /* ==================================================================== *
   * ARAYÜZ — sahnenin İÇİNDE.
   *
   * Yan panel yok, alt şerit yok. Kenarda yalnız iki madalyon (makine,
   * bugün) ve alt ortada tohum eli var; üçü de kapalı duruyor, dokununca
   * açılıyor. Geri kalan her şey ait olduğu nesnenin üstünde.
   *
   * Bütün dokunulabilir alanlar `V` listesine yazılıyor: çizim ve vuruş
   * AYNI hesabı kullanıyor, iki yerde iki farklı koordinat olmuyor.
   * ==================================================================== */
  var V = [];                    /* {ad, x, y, r} ya da {ad, x, y, w, h} */
  function vurusEkle(ad, x, y, w, h, ek) {
    var o = { ad: ad, x: x, y: y, w: w, h: h };
    if (ek) for (var k in ek) o[k] = ek[k];
    V.push(o);
    return o;
  }
  function vurusBul(p, pay) {
    pay = pay || 0;
    for (var i = V.length - 1; i >= 0; i--) {
      var o = V[i];
      if (o.r != null) {
        if (Math.hypot(p.x - o.x, p.y - o.y) <= o.r + pay) return o;
      } else if (p.x >= o.x - pay && p.x <= o.x + o.w + pay
                 && p.y >= o.y - pay && p.y <= o.y + o.h + pay) return o;
    }
    return null;
  }
  function etiketCiz(c, metin, x, y, renk) {
    c.save();
    c.font = "600 10.5px system-ui,sans-serif"; c.textAlign = "center";
    var w = c.measureText(metin).width;
    c.fillStyle = renk || "rgba(30,36,42,.9)";
    c.beginPath();
    if (c.roundRect) c.roundRect(x - w / 2 - 6, y - 10, w + 12, 15, 7);
    else c.rect(x - w / 2 - 6, y - 10, w + 12, 15);
    c.fill();
    c.fillStyle = "#fff";
    c.fillText(metin, x, y + 1);
    c.restore();
  }
  function yuvarlak(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r);
    else c.rect(x, y, w, h);
  }
  /** Cam çip: arayüzün ortak kabı. Panelin kutularına benzemesin diye
   *  açık, yarı saydam ve yuvarlak. */
  function cip(c, x, y, w, h, r, vurgu) {
    c.save();
    c.fillStyle = "rgba(22,32,42,.18)";
    yuvarlak(c, x + 1, y + 2.5, w, h, r); c.fill();
    c.fillStyle = vurgu ? "rgba(255,255,255,.97)" : "rgba(255,255,255,.9)";
    yuvarlak(c, x, y, w, h, r); c.fill();
    c.strokeStyle = vurgu ? "rgba(47,125,79,.9)" : "rgba(255,255,255,.85)";
    c.lineWidth = vurgu ? 2 : 1;
    yuvarlak(c, x, y, w, h, r); c.stroke();
    c.restore();
  }

  /* ------------------------------------------------------- madalyonlar */
  /** GÖREV KARTLARI SUNUCUDAN. Kartları burada yeniden türetmiyoruz:
   *  `sunucu/bahce.py` susama, nem ve hasat kararını gerekçesiyle birlikte
   *  zaten veriyor; ikinci bir hesap iki farklı cevap demek olurdu. */
  function kartlar() {
    var k = ((S.veri && S.veri.kartlar) || []).slice();
    k.sort(function (a, b) { return (a.ertelendi ? 1 : 0) - (b.ertelendi ? 1 : 0); });
    return k;
  }
  function acikKartSayisi() {
    return kartlar().filter(function (k) { return !k.ertelendi; }).length;
  }
  function madalyonCiz(c) {
    var e = engel(), r = 27;
    /* MAKİNE MADALYONU — solda üstte. Halkası eksenin hâli. */
    var mx = 20 + r, my = 20 + r;
    var renk = e.sinif === "hazir" ? "#2f7d4f"
      : (e.sinif === "mesgul" ? "#c07c1e" : "#a8332a");
    c.save();
    c.fillStyle = "rgba(22,32,42,.2)";
    c.beginPath(); c.arc(mx + 1, my + 3, r, 0, 6.3); c.fill();
    c.fillStyle = "rgba(255,255,255,.94)";
    c.beginPath(); c.arc(mx, my, r, 0, 6.3); c.fill();
    c.strokeStyle = renk; c.lineWidth = 3.5;
    c.beginPath(); c.arc(mx, my, r - 2, 0, 6.3); c.stroke();
    if (e.sinif === "mesgul") {                /* meşgulse halka dönüyor */
      c.strokeStyle = "#fff"; c.lineWidth = 3.5;
      c.beginPath(); c.arc(mx, my, r - 2, S.t * 3, S.t * 3 + 1.1); c.stroke();
    }
    c.textAlign = "center";
    if (konumVar()) {
      var k = D().konum || {};
      c.font = "700 11px system-ui,sans-serif"; c.fillStyle = "#21262b";
      c.fillText("X " + Math.round(sayi(k.x)), mx, my - 2);
      c.fillText("Y " + Math.round(sayi(k.y)), mx, my + 10);
    } else {
      c.font = "700 10px system-ui,sans-serif"; c.fillStyle = "#a8332a";
      c.fillText("konum", mx, my - 1);
      c.fillText("yok", mx, my + 10);
    }
    c.restore();
    vurusEkle("madalyon-makine", mx, my, 0, 0, { r: r + 4 });

    /* BUGÜN MADALYONU — sağda üstte. İçinde bekleyen görev sayısı. */
    var l = kartlar().filter(function (kk) { return !kk.ertelendi; });
    var bx = S.en - 20 - r, by = 20 + r;
    c.save();
    c.fillStyle = "rgba(22,32,42,.2)";
    c.beginPath(); c.arc(bx + 1, by + 3, r, 0, 6.3); c.fill();
    c.fillStyle = "rgba(255,255,255,.94)";
    c.beginPath(); c.arc(bx, by, r, 0, 6.3); c.fill();
    c.strokeStyle = l.length ? "#c07c1e" : "#2f7d4f"; c.lineWidth = 3.5;
    c.beginPath(); c.arc(bx, by, r - 2, 0, 6.3); c.stroke();
    c.textAlign = "center";
    c.font = "700 17px system-ui,sans-serif"; c.fillStyle = "#21262b";
    c.fillText(String(l.length), bx, by + 2);
    c.font = "600 8.5px system-ui,sans-serif"; c.fillStyle = "#6a747c";
    c.fillText("BUGÜN", bx, by + 14);
    c.restore();
    vurusEkle("madalyon-bugun", bx, by, 0, 0, { r: r + 4 });

    /* SAKİN MOD — makine madalyonunun altında küçük bir çip.
       Açıkken boştaki hayat (toz, salınım, nefes) duruyor; BİLGİ
       DURMUYOR: paketler gelmeye, sayılar güncellenmeye devam ediyor. */
    var sw = 76, sh = 24, sx2 = 20, sy2 = 20 + r * 2 + 8;
    cip(c, sx2, sy2, sw, sh, 12, S.sakin);
    c.save();
    c.font = "700 11px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = S.sakin ? "#2f7d4f" : "#4d565e";
    c.fillText(S.sakin ? "sakin: açık" : "sakin mod", sx2 + sw / 2, sy2 + 16);
    c.restore();
    vurusEkle("sakin", sx2, sy2, sw, sh);
  }

  /* ------------------------------------------------------- tohum eli */
  function tepsiGozler() { return (S.veri && S.veri.hazne_gozleri) || []; }
  function turAdi(slug) {
    var t = ((S.veri && S.veri.turler) || []).filter(function (x) { return x.slug === slug; })[0];
    return (t && t.ad) || slug || "?";
  }
  function turYayilim(slug) {
    var t = ((S.veri && S.veri.turler) || []).filter(function (x) { return x.slug === slug; })[0];
    return t ? sayi(t.yayilim_mm, 0) : 0;
  }
  function elCiz(c) {
    var cw = 46, ch = 30, ax = S.en / 2, ay = S.boy - 20 - ch / 2;
    var gozler = tepsiGozler();
    /* Kapalı hâl: tek bir küçük çip. */
    if (!S.el) {
      var w = 74, h = 30, x = ax - w / 2, y = S.boy - 20 - h;
      cip(c, x, y, w, h, 15, !!S.ekTur);
      c.save();
      c.font = "700 12.5px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = S.ekTur ? "#2f7d4f" : "#21262b";
      c.fillText(S.ekTur ? turAdi(S.ekTur) : "tohum", ax, y + 19);
      c.restore();
      vurusEkle("el-ac", x, y, w, h);
      return;
    }
    /* Açık hâl: gözler yelpaze gibi yukarı açılıyor. */
    var n = gozler.length;
    if (!n) {
      var w2 = 260, h2 = 34, x2 = ax - w2 / 2, y2 = S.boy - 20 - h2;
      cip(c, x2, y2, w2, h2, 12, false);
      c.save();
      c.font = "600 11.5px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = "#a8332a";
      c.fillText("hazne gözleri okunamıyor", ax, y2 + 21);
      c.restore();
      vurusEkle("el-kapa", x2, y2, w2, h2);
      return;
    }
    var toplam = n * (cw + 6) - 6;
    var x0 = kis(ax - toplam / 2, 8, Math.max(8, S.en - toplam - 8));
    for (var i = 0; i < n; i++) {
      var g = gozler[i], slug = String(g.tohum || ""), dolu = !!g.dolu;
      var kx = x0 + i * (cw + 6), ky = S.boy - 20 - ch - 38;
      var sec = dolu && S.ekTur === slug;
      c.save();
      c.globalAlpha = dolu ? 1 : 0.5;
      cip(c, kx, ky, cw, ch + 22, 10, sec);
      c.font = "700 10px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = dolu ? "#21262b" : "#79838b";
      var ad = dolu ? turAdi(slug) : "boş";
      if (c.measureText(ad).width > cw - 6) ad = ad.slice(0, 6) + "…";
      c.fillText(ad, kx + cw / 2, ky + 15);
      c.font = "600 9px system-ui,sans-serif"; c.fillStyle = "#6a747c";
      c.fillText(String(g.ad || ""), kx + cw / 2, ky + 28);
      if (dolu && turYayilim(slug)) {
        c.fillText(Math.round(turYayilim(slug)) + " mm", kx + cw / 2, ky + 40);
      }
      c.restore();
      if (dolu) vurusEkle("goz", kx, ky, cw, ch + 22, { tur: slug });
    }
    var w3 = 74, h3 = 30, x3 = ax - w3 / 2, y3 = S.boy - 20 - h3;
    cip(c, x3, y3, w3, h3, 15, false);
    c.save();
    c.font = "700 12.5px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = "#21262b";
    c.fillText("kapat", ax, y3 + 19);
    c.restore();
    vurusEkle("el-kapa", x3, y3, w3, h3);
    if (S.ekTur) {
      etiketCiz(c, turAdi(S.ekTur) + " seçildi — bir karoya dokun",
        ax, S.boy - 20 - h3 - 96, "rgba(47,125,79,.94)");
    }
  }

  /* ------------------------------------------------- bitkinin eylemleri */
  function halkaEylemleri(b) {
    var e = engel();
    var l = [
      { ad: "sula", etiket: "su", kapali: e.engel },
      { ad: "olc", etiket: "nem", kapali: e.engel },
      { ad: "git", etiket: "git", kapali: e.engel }
    ];
    if (b.hasat) l.push({ ad: "hasat", etiket: "hasat", kapali: false });
    return l;
  }
  function halkaCiz(c) {
    var b = S.ix[S.halka];
    if (!b) return;
    var sp = spriteAl(b);
    var k = vurusKutusu(b, 0);
    var l = halkaEylemleri(b), n = l.length, i, a;
    var rb = kis(G.tw * 0.24, 15, 20);
    var a0 = -Math.PI * 0.97, a1 = -Math.PI * 0.03;
    var da = n > 1 ? (a1 - a0) / (n - 1) : Math.PI;
    var rx = Math.max(sp.en * 0.5 + rb + 8, rb * 2.6);
    if (n > 1) rx = Math.max(rx, (Math.max(rb * 2.6, 34) + 8) / (2 * Math.sin(da / 2)));
    var ry = Math.max(sp.boy * 0.5 + rb + 12, rb * 2);
    /* Halkayı bitkiye bağlayan ince çizgiler. */
    c.save();
    c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 1.4;
    for (i = 0; i < n; i++) {
      a = n === 1 ? -Math.PI / 2 : a0 + da * i;
      l[i].x = k.x + Math.cos(a) * rx;
      l[i].y = k.gy + Math.sin(a) * ry;
      c.beginPath(); c.moveTo(k.x, k.gy); c.lineTo(l[i].x, l[i].y); c.stroke();
    }
    c.restore();
    for (i = 0; i < n; i++) {
      var d = l[i];
      c.save();
      c.fillStyle = "rgba(22,32,42,.24)";
      c.beginPath(); c.arc(d.x + 1, d.y + 2.5, rb, 0, 6.3); c.fill();
      c.fillStyle = d.kapali ? "rgba(232,235,238,.95)" : "rgba(255,255,255,.98)";
      c.beginPath(); c.arc(d.x, d.y, rb, 0, 6.3); c.fill();
      c.strokeStyle = d.kapali ? "rgba(150,158,164,.8)" : "#2f7d4f";
      c.lineWidth = 2.2; c.stroke();
      simgeCiz(c, d.ad, d.x, d.y, rb, d.kapali ? "rgba(140,150,158,.9)" : "#2f7d4f");
      c.font = "700 9.5px system-ui,sans-serif"; c.textAlign = "center";
      var ew = c.measureText(d.etiket).width, ey2 = d.y + rb + 12;
      c.fillStyle = "rgba(28,36,44,.82)";
      yuvarlak(c, d.x - ew / 2 - 4, ey2 - 9, ew + 8, 12, 5); c.fill();
      c.fillStyle = "#fff";
      c.fillText(d.etiket, d.x, ey2);
      c.restore();
      if (!d.kapali) vurusEkle("eylem", d.x, d.y, 0, 0, { r: rb + 2, eylem: d.ad });
      else vurusEkle("eylem-kapali", d.x, d.y, 0, 0, { r: rb + 2 });
    }
    /* KÜNYE ÇİPİ — halkanın altında. Bitkinin bütün yazılı bilgisi ve
       ikincil işleri (yakından bak, taşı, hasat) orada; halka kalabalık
       olmasın diye ayrı. */
    var kw = 58, kh = 22, kx2 = k.x - kw / 2, ky2 = k.y2 + 6;
    cip(c, kx2, ky2, kw, kh, 11, S.kartKip === "bitki");
    c.save();
    c.font = "700 11px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = "#21262b";
    c.fillText("künye", k.x, ky2 + 15);
    c.restore();
    vurusEkle("kunye", kx2, ky2, kw, kh);
    /* KAPALIYSA SEBEBİ YAZILI. */
    var e = engel();
    if (e.engel) {
      etiketCiz(c, "makineli işler kapalı: " + e.yazi, k.x, ky2 + kh + 16, "rgba(150,40,32,.92)");
      etiketCiz(c, "hasat kayıt işi, açık", k.x, ky2 + kh + 34, "rgba(70,80,88,.9)");
    }
    if (S.tasiKip === String(b.ad)) {
      etiketCiz(c, "taşıma açık — yeni karoya dokun", k.x, ky2 + kh + 52, "rgba(47,125,79,.94)");
    }
  }
  /* Simgeler vektör: emoji yazı tipi Pi'de her zaman yok. */
  function simgeCiz(c, ad, x, y, r, renk) {
    c.save();
    c.translate(x, y);
    c.strokeStyle = renk; c.fillStyle = renk;
    c.lineWidth = Math.max(1.7, r * 0.13); c.lineCap = "round"; c.lineJoin = "round";
    if (ad === "sula") {
      c.beginPath();
      c.moveTo(0, -r * 0.5);
      c.quadraticCurveTo(r * 0.4, 0, 0, r * 0.4);
      c.quadraticCurveTo(-r * 0.4, 0, 0, -r * 0.5);
      c.fill();
    } else if (ad === "olc") {
      c.beginPath(); c.moveTo(0, -r * 0.48); c.lineTo(0, r * 0.16); c.stroke();
      c.beginPath(); c.moveTo(-r * 0.2, r * 0.0); c.lineTo(0, r * 0.32);
      c.lineTo(r * 0.2, r * 0.0); c.stroke();
      c.beginPath(); c.moveTo(-r * 0.44, r * 0.48); c.lineTo(r * 0.44, r * 0.48); c.stroke();
    } else if (ad === "git") {
      c.beginPath(); c.arc(0, 0, r * 0.34, 0, 6.3); c.stroke();
      c.beginPath();
      c.moveTo(-r * 0.54, 0); c.lineTo(-r * 0.18, 0);
      c.moveTo(r * 0.18, 0); c.lineTo(r * 0.54, 0);
      c.moveTo(0, -r * 0.54); c.lineTo(0, -r * 0.18);
      c.moveTo(0, r * 0.18); c.lineTo(0, r * 0.54);
      c.stroke();
    } else {
      c.beginPath(); c.arc(0, r * 0.04, r * 0.36, Math.PI, 0); c.stroke();
      c.beginPath();
      c.moveTo(-r * 0.48, r * 0.04); c.lineTo(-r * 0.32, r * 0.46);
      c.lineTo(r * 0.32, r * 0.46); c.lineTo(r * 0.48, r * 0.04);
      c.closePath(); c.stroke();
    }
    c.restore();
  }

  /* ------------------------------------------------------ bayrak + onay
   * Boş karoya dokunmak bir BAYRAK dikiyor; komut ancak bayrağın yanındaki
   * onaya dokununca gidiyor. Geri alınamaz işler ne olacağını söylüyor. */
  function bayrakCiz(c) {
    if (!S.bayrak) return;
    var k = S.bayrak;
    var x = ex(k.u + 0.5, k.v + 0.5), y = ey(k.u + 0.5, k.v + 0.5);
    c.save();
    c.strokeStyle = "rgba(47,125,79,.95)"; c.lineWidth = 2.4;
    c.setLineDash([5, 4]); c.lineDashOffset = -S.t * 8;
    c.beginPath();
    c.moveTo(ex(k.u, k.v), ey(k.u, k.v));
    c.lineTo(ex(k.u + 1, k.v), ey(k.u + 1, k.v));
    c.lineTo(ex(k.u + 1, k.v + 1), ey(k.u + 1, k.v + 1));
    c.lineTo(ex(k.u, k.v + 1), ey(k.u, k.v + 1));
    c.closePath(); c.stroke();
    c.setLineDash([]);
    var h = Math.max(22, G.th * 1.6);
    c.strokeStyle = "#5b4a34"; c.lineWidth = 2.4; c.lineCap = "round";
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h); c.stroke();
    c.fillStyle = "#2f7d4f";
    c.beginPath();
    c.moveTo(x, y - h); c.lineTo(x + 15, y - h + 5); c.lineTo(x, y - h + 10);
    c.closePath(); c.fill();
    c.restore();
  }
  function satirla(c, metin, en) {
    var kelime = String(metin).split(" "), satir = [], s = "";
    for (var i = 0; i < kelime.length; i++) {
      var d = s ? s + " " + kelime[i] : kelime[i];
      if (c.measureText(d).width > en && s) { satir.push(s); s = kelime[i]; }
      else s = d;
    }
    if (s) satir.push(s);
    return satir;
  }
  function onayAc(metin, alt, evet, fn, ax, ay) {
    S.onay = { metin: metin, alt: alt || "", evet: evet || "Onayla", fn: fn,
               ax: ax, ay: ay };
    kirlet();
  }
  function onayKapat() { S.onay = null; kirlet(); }
  function onayCiz(c) {
    var o = S.onay;
    if (!o) return;
    var w = Math.min(280, S.en - 32);
    c.font = "700 13px system-ui,sans-serif";
    var bas = satirla(c, o.metin, w - 26);
    c.font = "12px system-ui,sans-serif";
    var alt = o.alt ? satirla(c, o.alt, w - 26) : [];
    var h = 14 + bas.length * 17 + (alt.length ? 4 + alt.length * 15 : 0) + 42;
    var x = kis(o.ax - w / 2, 12, Math.max(12, S.en - w - 12));
    var y = kis(o.ay - h - 22, 12, Math.max(12, S.boy - h - 12));
    c.save();
    c.fillStyle = "rgba(22,32,42,.26)";
    yuvarlak(c, x + 2, y + 4, w, h, 14); c.fill();
    c.fillStyle = "rgba(255,255,255,.98)";
    yuvarlak(c, x, y, w, h, 14); c.fill();
    c.strokeStyle = "rgba(47,125,79,.5)"; c.lineWidth = 1.5;
    yuvarlak(c, x, y, w, h, 14); c.stroke();
    /* Bayrağa/bitkiye bakan ok. */
    c.fillStyle = "rgba(255,255,255,.98)";
    c.beginPath();
    var ox = kis(o.ax, x + 18, x + w - 18);
    c.moveTo(ox - 8, y + h); c.lineTo(ox + 8, y + h); c.lineTo(ox, y + h + 10);
    c.closePath(); c.fill();
    c.textAlign = "left"; c.fillStyle = "#21262b";
    c.font = "700 13px system-ui,sans-serif";
    var yy = y + 26;
    bas.forEach(function (s) { c.fillText(s, x + 13, yy); yy += 17; });
    if (alt.length) {
      c.font = "12px system-ui,sans-serif"; c.fillStyle = "#5b656d";
      yy += 3;
      alt.forEach(function (s) { c.fillText(s, x + 13, yy); yy += 15; });
    }
    /* Düğmeler. */
    var bh = 30, by = y + h - bh - 10, bw = (w - 26 - 8) / 2;
    c.fillStyle = "#eef1f4";
    yuvarlak(c, x + 13, by, bw, bh, 9); c.fill();
    c.fillStyle = "#4d565e"; c.textAlign = "center";
    c.font = "600 12.5px system-ui,sans-serif";
    c.fillText("vazgeç", x + 13 + bw / 2, by + 20);
    c.fillStyle = "#2f7d4f";
    yuvarlak(c, x + 21 + bw, by, bw, bh, 9); c.fill();
    c.fillStyle = "#fff"; c.font = "700 12.5px system-ui,sans-serif";
    c.fillText(o.evet, x + 21 + bw + bw / 2, by + 20);
    c.restore();
    /* SIRA ÖNEMLİ: `vurusBul` listeyi SONDAN tarıyor. Kutunun gövdesi
       önce ekleniyor ki düğmeler onun üstünde kalsın; yoksa kutu kendi
       düğmelerini yutuyor. Kutu yine de duruyor: arkasındaki karoya
       komut gitmesin diye. */
    vurusEkle("onay-kutu", x, y, w, h);
    vurusEkle("onay-hayir", x + 13, by, bw, bh);
    vurusEkle("onay-evet", x + 21 + bw, by, bw, bh);
  }
  /** Kısa mesaj — sahnenin altında, kendi kendine sönüyor. */
  function mesajCiz(c) {
    if (!S.mesaj) return;
    var yas = S.t - S.mesajT;
    if (yas > 5.5) { S.mesaj = ""; return; }
    c.save();
    c.globalAlpha = kis((5.5 - yas) / 0.8, 0, 1);
    etiketCiz(c, S.mesaj, S.en / 2, S.boy - 64, "rgba(28,36,44,.9)");
    c.restore();
  }
  function uzerindeCiz(c) {
    if (!S.uzerinde || S.onay) return;
    var k = S.uzerinde;
    c.save();
    c.fillStyle = "rgba(255,255,255,.16)";
    c.beginPath();
    c.moveTo(ex(k.u, k.v), ey(k.u, k.v));
    c.lineTo(ex(k.u + 1, k.v), ey(k.u + 1, k.v));
    c.lineTo(ex(k.u + 1, k.v + 1), ey(k.u + 1, k.v + 1));
    c.lineTo(ex(k.u, k.v + 1), ey(k.u, k.v + 1));
    c.closePath(); c.fill();
    c.restore();
  }
  /** Izgara sürekli görünmüyor: yalnız ekim kipinde ya da imleç yataktayken. */
  function izgaraCiz(c) {
    var goster = (S.ekTur || S.tasiKip) ? 0.5 : (S.uzerinde ? 0.28 : 0);
    if (goster <= 0) return;
    var i;
    c.save();
    c.globalAlpha = goster;
    c.strokeStyle = "rgba(255,248,230,.9)"; c.lineWidth = 1;
    for (i = 0; i <= G.nx; i++) {
      c.beginPath(); c.moveTo(ex(i, 0), ey(i, 0)); c.lineTo(ex(i, G.ny), ey(i, G.ny)); c.stroke();
    }
    for (i = 0; i <= G.ny; i++) {
      c.beginPath(); c.moveTo(ex(0, i), ey(0, i)); c.lineTo(ex(G.nx, i), ey(G.nx, i)); c.stroke();
    }
    c.restore();
  }

  /* ==================================================================== *
   * MADALYON KARTLARI (DOM — yazı burada daha okunur)
   * ==================================================================== */
  function kartKapat() {
    S.kartKip = "";
    var k = $("#oy-kart");
    if (k) { k.hidden = true; k.innerHTML = ""; }
  }
  var kartYaz = guvenli("kart", function (kip) {
    var kok = $("#oy-kart");
    if (!kok) return;
    if (S.kartKip === kip) { kartKapat(); return; }
    S.kartKip = kip;
    var e = engel(), d = D(), h = [];
    h.push('<button class="kapat" data-oy="kart-kapat" title="kapat">×</button>');
    if (kip === "makine") {
      h.push("<h2>Makine</h2><ul>");
      h.push("<li" + (e.engel ? ' class="kritik"' : ' class="iyi"') + ">"
        + kacisli(e.yazi) + "</li>");
      h.push("<li>" + (konumVar()
        ? "konum X " + Math.round(sayi((d.konum || {}).x)) + " · Y "
          + Math.round(sayi((d.konum || {}).y))
          + (d.konum && d.konum.z != null ? " · Z " + Math.round(sayi(d.konum.z)) : "")
        : '<span class="sonuk">konum bildirilmiyor</span>') + "</li>");
      h.push("<li>" + (G.s && G.s.var
        ? "yürünebilir alan " + Math.round(G.s.x2 - G.s.x1) + " × "
          + Math.round(G.s.y2 - G.s.y1) + " mm · " + G.nx + "×" + G.ny + " karo"
        : '<span class="kritik">sınırlar bildirilmedi</span>') + "</li>");
      h.push("<li>" + (baglantiVar() ? '<span class="iyi">sunucudan haber geliyor</span>'
        : '<span class="kritik">sunucudan haber yok</span>') + "</li>");
      var is = calisanIs();
      h.push("<li>" + (is ? "çalışan iş: " + kacisli(is.etiket || is.tip)
        : '<span class="sonuk">çalışan iş yok</span>') + "</li>");
      h.push("</ul>");
      h.push('<div class="dip">Çiftçi eksenin kendisi: bildirilen konumun '
        + "önüne geçmez, makine kopuksa kımıldamaz.</div>");
    } else if (kip === "bitki") {
      /* KÜNYE — seçili bitkinin bütün yazılı bilgisi ve ikincil işleri.
         Halkada dört birincil iş var; buradakiler daha seyrek kullanılan
         ama kaybolmaması gereken işler. */
      var b = S.ix[S.secili];
      if (!b) { kartKapat(); return; }
      var bic = bicimSec(b), n = nemDurum(b);
      var yas = Math.round(sayi(b.yas_gun, 0)), olgun = Math.round(sayi(b.olgun_gun, 0));
      h.push("<h2>" + kacisli(b.ad) + " · " + kacisli(b.tur_ad || b.tur || "?") + "</h2><ul>");
      h.push("<li>" + (n.var
        ? "nem <b>%" + Math.round(n.yuzde) + "</b>"
          + (n.bayat ? " · sulamadan önceki okuma"
            : (!n.kendi ? " · " + Math.round(n.uzak) + " mm öteden ödünç"
              : " · " + sureKisa(n.yas) + " önce ölçüldü"))
        : '<span class="kritik">nem ölçülmedi</span>') + "</li>");
      h.push("<li>" + yas + " günlük"
        /* GERİ SAYIM YOK: olgunluk bir ölçüm değil, türün katalog değeri. */
        + (olgun ? " · hasada yaklaşık " + Math.max(0, olgun - yas) + " gün" : "") + "</li>");
      if (b.susadi) {
        h.push('<li class="kritik">susadı · '
          + (b.su_kanit === "olculen" ? "ölçüme göre" : "geçen güne göre (tahmin)") + "</li>");
      }
      if (b.hasat) h.push('<li class="iyi">hasada hazır — toplayınca yataktan düşer</li>');
      h.push('<li class="sonuk">' + kacisli(KOK_ADI[bic.kok] || KOK_ADI.bilinmiyor)
        + " · türün biçimi, ölçülmedi</li>");
      h.push('<li class="sonuk">siluet: '
        + (bic.bilinen ? (bic.ozel ? "türe özel" : "aile biçimi (" + kacisli(bic.aile) + ")")
                       : "tür tanınmadı — jenerik") + "</li>");
      if (sayi(b.yayilim_mm, 0) > 0) {
        h.push('<li class="sonuk">yayılım ' + Math.round(sayi(b.yayilim_mm)) + " mm (katalog)</li>");
      }
      if (S.gecmisAd === String(b.ad) && S.gecmis) {
        h.push("<li>" + (S.gecmis.egilim
          ? S.gecmis.egilim.adet + " ölçüm · "
            + (sayi(S.gecmis.egilim.degisim) > 0 ? "+" : "")
            + sayi(S.gecmis.egilim.degisim).toFixed(1) + " puan eğilim"
          : '<span class="sonuk">' + (S.gecmis.adet === 1
              ? "tek ölçüm — eğilim yok" : "eğilim için yeterli ölçüm yok") + "</span>") + "</li>");
      }
      h.push("</ul>");
      h.push('<ul><li><button data-oy="yakin">Yakından bak <span>· uç kamerası'
        + "</span></button></li>");
      h.push('<li><button data-oy="tasi"><b>' + (S.tasiKip ? "Taşımayı bırak" : "Taşı")
        + '</b> <span>· kayıt işi, makine kımıldamaz</span></button></li>');
      h.push('<li><button data-oy="hasat"><b>Hasat et</b> <span>· yataktan düşer'
        + "</span></button></li></ul>");
      if (engel().engel) {
        h.push('<div class="dip kritik">Makineli işler kapalı: ' + kacisli(engel().yazi)
          + ". Hasat ve taşıma kayıt işi, onlar açık.</div>");
      }
    } else {
      var kk2 = kartlar(), o = S.olcum || {}, i, eo = (S.veri && S.veri.ekim) || {};
      h.push("<h2>Bugün</h2><ul>");
      /* ÖNCE OKUNAN ÖLÇÜMLER, sonra tek satırda okunamayanlar. */
      var bilinen = [], eksik = [];
      if (o.hava_nem == null) eksik.push("hava nemi");
      else bilinen.push("Hava nemi <b>%" + Math.round(sayi(o.hava_nem)) + "</b>");
      var sic = o.hava_sicaklik == null ? o.bmp_sicaklik : o.hava_sicaklik;
      if (sic == null) eksik.push("hava sıcaklığı");
      else bilinen.push("Hava <b>" + sayi(sic).toFixed(1) + " °C</b>");
      if (o.toprak_nem == null) eksik.push("prob toprak nemi");
      else bilinen.push("Prob <b>%" + Math.round(sayi(o.toprak_nem)) + "</b> okuyor");
      /* BASINÇ EĞİLİMİ ÖLÇÜMDEN: son üç saatin eğimi. İki uçtan az veri
         varsa eğilim YOK — uydurma yok. */
      if (S.egim == null) eksik.push("basınç eğilimi (üç saatlik ölçüm yetmedi)");
      else {
        bilinen.push("Basınç saatte <b>" + (S.egim > 0 ? "+" : "") + S.egim.toFixed(1)
          + " hPa</b> " + (S.egim < -0.2 ? "düşüyor" : (S.egim > 0.2 ? "yükseliyor" : "sabit")));
      }
      if (!bilinen.length) h.push('<li class="sonuk">Henüz okunmuş ölçüm yok.</li>');
      else for (i = 0; i < bilinen.length; i++) h.push("<li>" + bilinen[i] + "</li>");
      h.push("</ul>");
      /* EKİM SÜRÜYOR — sunucunun sorusu ve "devam et" onayı. */
      if (eo.aktif) {
        h.push('<h2>Ekim sürüyor'
          + (sayi(eo.toplam, 0) ? " · " + sayi(eo.sira, 0) + "/" + sayi(eo.toplam, 0) : "")
          + "</h2><ul>");
        if (eo.tur_ad) h.push("<li>" + kacisli(eo.tur_ad) + "</li>");
        if (eo.soru) {
          h.push("<li>" + kacisli(eo.soru)
            + '<button data-oy="ekim-onay"' + (engel().engel ? " disabled" : "")
            + "><b>Devam et</b></button></li>");
        }
        h.push("</ul>");
      }
      h.push("<h2>Görevler</h2><ul>");
      if (!S.veri) h.push('<li class="sonuk">Bahçe okunuyor…</li>');
      else if (!kk2.length) h.push('<li class="iyi">Bugün bekleyen iş yok.</li>');
      for (i = 0; i < kk2.length; i++) {
        var k2 = kk2[i], adlar = (k2.noktalar || []).map(String);
        h.push('<li' + (k2.ertelendi ? ' class="sonuk"' : "") + '>'
          + '<button data-oy="kart-git" data-ix="' + i + '"'
          + ' data-adlar="' + kacisli(adlar.join(",")) + '"><b>'
          + kacisli((k2.simge || "") + " " + (k2.baslik || "")) + "</b>"
          + (k2.aciklama ? " <span>· " + kacisli(k2.aciklama) + "</span>" : "")
          + (k2.kanit ? " <span>· " + (k2.tahmin ? "tahmin: " : "ölçüm: ")
              + kacisli(k2.kanit) + "</span>" : "")
          + "</button>");
        if (k2.ertelendi) {
          h.push('<button data-oy="ertele-iptal" data-ix="' + i + '">'
            + kacisli(k2.ertelendi_yazi || "ertelendi") + " — <b>geri al</b></button>");
        } else {
          h.push('<button data-oy="kart-evet" data-ix="' + i + '"'
            + ((k2.tip !== "ek" && engel().engel) ? " disabled" : "")
            + "><b>" + kacisli(k2.evet || "Yap") + "</b></button>");
          h.push('<button data-oy="ertele" data-ix="' + i + '">yarın sor</button>');
        }
        h.push("</li>");
      }
      h.push("</ul>");
      h.push('<div class="dip">' + (eksik.length ? "Okunamayan: "
        + kacisli(eksik.join(", ")) + ". " : "")
        + "Yağmur, ışık ve rüzgâr sensörü yok — oyun bunları üretmiyor.</div>");
    }
    kok.innerHTML = h.join("");
    kok.hidden = false;
    /* Kart madalyonun altına yapışıyor, sabit bir yan panel değil. */
    if (kip === "makine") { kok.style.left = "16px"; kok.style.right = "auto"; }
    else { kok.style.right = "16px"; kok.style.left = "auto"; }
    kok.style.top = "82px";
  });

  /** Kart düğmeleri — görev kartları, ekim onayı ve künyenin ikincil
   *  işleri. Ekranın ortası neresiyse onay orada açılıyor. */
  function kartTik(e) {
    var d = e.target.closest("[data-oy]");
    if (!d) return;
    var ad = d.dataset.oy;
    var k = kartlar()[sayi(d.dataset.ix, -1)];
    var b = S.ix[S.secili];
    var ox = S.en / 2, oy = S.boy * 0.55;
    if (ad === "kart-kapat") { kartKapat(); return; }
    if (ad === "kart-git") {
      var adlar = (d.dataset.adlar || "").split(",").filter(Boolean);
      if (adlar.length) { kartKapat(); bitkiyeUc(S.ix[adlar[0]]); }
      return;
    }
    if (ad === "ertele" && k) { erteleGonder(k.kimlik, false); return; }
    if (ad === "ertele-iptal" && k) { erteleGonder(k.kimlik, true); return; }
    if (ad === "ekim-onay") {
      /* EKİM ONAYI — sunucunun sorusuna cevap; makine oradan devam ediyor. */
      gonder("/api/bahce/onay", {})
        .then(function () { mesajYaz("Ekim onayı gönderildi."); return veriYukle(); })
        .catch(function (h) { mesajYaz("Onay geçmedi: " + ((h && h.message) || h)); });
      return;
    }
    if (ad === "kart-evet" && k) {
      var liste = (k.noktalar || []).map(String);
      kartKapat();
      if (k.tip === "sula") {
        onayAc(liste.length + " bitki sulanacak.",
          "süre her bitkinin kendi ayarından · geri alınamaz · ölçümler bayatlar",
          "Sula", function () { isGonder("sula", liste); }, ox, oy);
      } else if (k.tip === "nem") {
        onayAc(liste.length + " bitkinin toprağına sırayla prob daldırılacak.",
          "ölçümden sonra o bitkilerin taralı halkası gerçek dolguya döner",
          "Ölç", function () { isGonder("nem", liste); }, ox, oy);
      } else if (k.tip === "hasat") {
        onayAc(liste.length + " bitkinin üstüne gidilip fotoğraf çekilecek.",
          "geri alınabilir · film yalnız üst kameradan",
          "Çek", function () { isGonder("foto", liste); }, ox, oy);
      } else if (k.tip === "ek") {
        S.el = true;
        mesajYaz("Ekmek için alttaki tepsiden bir göz seç, sonra bir karoya dokun.");
      } else if (k.tip === "hazne") {
        mesajYaz(k.aciklama || "Hazne gözleri bildirilmiyor.");
      } else {
        mesajYaz("Bu kart için doğrudan bir iş yok: " + (k.baslik || k.tip));
      }
      return;
    }
    if (!b) return;
    if (ad === "yakin") {
      kartKapat();
      onayAc("Eksen " + b.ad + " üstüne gidip uç kamerasıyla yakından bakacak.",
        "çekilen kare büyüme filmine GİRMEZ — film yalnız üst kameradan",
        "Bak", function () {
          gonder("/api/bahce/yakin", { ad: b.ad })
            .then(function () { mesajYaz("Yakından bakma kuyruğa girdi."); return veriYukle(); })
            .catch(function (h) { mesajYaz("Olmadı: " + ((h && h.message) || h)); });
        }, ox, oy);
      return;
    }
    if (ad === "tasi") {
      S.tasiKip = S.tasiKip ? "" : String(b.ad);
      kartKapat();
      mesajYaz(S.tasiKip ? b.ad + " taşınacak — yeni yerine dokun." : "Taşıma bırakıldı.");
      kirlet();
      return;
    }
    if (ad === "hasat") { kartKapat(); bitkiEylem("hasat", b); }
  }
  /** "Yarın sor" — kartı erteliyor, geri alınabiliyor. */
  function erteleGonder(kimlik, iptal) {
    gonder("/api/bahce/ertele", { kimlik: kimlik, iptal: !!iptal })
      .then(function () {
        mesajYaz(iptal ? "Erteleme geri alındı." : "Yarın yeniden sorulacak.");
        return veriYukle();
      })
      .then(function () { if (S.kartKip === "bugun") { S.kartKip = ""; kartYaz("bugun"); } })
      .catch(function (h) { mesajYaz("Erteleme geçmedi: " + ((h && h.message) || h)); });
  }

  /* ==================================================================== *
   * EYLEMLER — geri alınamaz her iş NE OLACAĞINI söyleyip onay istiyor.
   * ==================================================================== */
  function isGonder(tip, adlar, ek) {
    var g = { tip: tip, noktalar: adlar };
    if (ek) for (var k in ek) g[k] = ek[k];
    return gonder("/api/bahce/is", g)
      .then(function () {
        mesajYaz(adlar.length + " nokta için " + tip + " kuyruğa girdi.");
        return veriYukle();
      })
      .catch(function (h) { mesajYaz("İş gönderilemedi: " + ((h && h.message) || h)); });
  }
  function bitkiEylem(ad, b) {
    if (!b) return;
    var x = ex(uOf(b.x), vOf(b.y)), y = ey(uOf(b.x), vOf(b.y)) - govdeYuk();
    if (ad === "sula") {
      onayAc(b.ad + " " + sayi(b.sulama_saniye, 3).toFixed(1) + " saniye sulanacak.",
        "geri alınamaz · sulamadan sonra o bitkinin nem ölçümü bayatlar",
        "Sula", function () { isGonder("sula", [b.ad]); }, x, y);
    } else if (ad === "olc") {
      onayAc("Prob " + b.ad + " toprağına daldırılıp nem ölçülecek.",
        "ölçümden sonra taralı halka gerçek dolguya döner", "Ölç",
        function () { isGonder("nem", [b.ad]); }, x, y);
    } else if (ad === "git") {
      onayAc("Eksen " + b.ad + " üstüne gidecek.",
        "X " + Math.round(sayi(b.x)) + " mm · Y " + Math.round(sayi(b.y))
          + " mm · çiftçi ancak makine kımıldayınca kımıldar",
        "Git", function () { isGonder("gez", [b.ad]); }, x, y);
    } else if (ad === "hasat") {
      /* HASAT KAYITTIR: makine toplamıyor, kullanıcı topluyor. */
      onayAc(b.ad + " hasat edildi olarak işaretlenip yataktan düşecek.",
        "makine kımıldamaz — bunu siz topluyorsunuz · sunucuda 30 saniye "
          + "geri alma penceresi var",
        "Hasat et", function () {
          gonder("/api/bahce/hasat", { noktalar: [b.ad] })
            .then(function (c) {
              S.secili = ""; S.halka = "";
              mesajYaz((c && c.mesaj) || b.ad + " hasat edildi.");
              return veriYukle();
            })
            .catch(function (h) { mesajYaz("Hasat edilemedi: " + ((h && h.message) || h)); });
        }, x, y);
    }
  }
  function gitOnay(u, v) {
    var mx = kis(G.s.x1 + (u + 0.5) * KARO_MM, G.s.x1, G.s.x2);
    var my = kis(G.s.y1 + (v + 0.5) * KARO_MM, G.s.y1, G.s.y2);
    var e = engel();
    var x = ex(u + 0.5, v + 0.5), y = ey(u + 0.5, v + 0.5) - Math.max(22, G.th * 1.6);
    if (e.engel) {
      onayAc("Makine hareket edemez: " + e.yazi + ".",
        "komut gönderilmedi", "Tamam", function () { S.bayrak = null; }, x, y);
      return;
    }
    var yol = S.bildirilen.x == null ? null
      : Math.round(Math.hypot(mx - S.bildirilen.x, my - S.bildirilen.y));
    onayAc("Eksen X " + Math.round(mx) + " mm, Y " + Math.round(my) + " mm noktasına gidecek.",
      "karo " + KARO_MM + " mm · " + (yol == null ? "konum bilinmiyor" : yol + " mm yol"),
      "Git", function () {
        komut("git", { x: mx, y: my })
          .then(function (c) {
            S.bayrak = null;
            if (c && c.ok === false) mesajYaz("Komut reddedildi: " + (c.mesaj || "sebep bildirilmedi"));
            else mesajYaz("Git komutu gönderildi.");
            kirlet();
          })
          .catch(function (h) {
            S.bayrak = null;
            mesajYaz("Komut gönderilemedi: " + ((h && h.message) || h));
          });
      }, x, y);
  }
  function ekimOnay(u, v) {
    var slug = S.ekTur;
    var mx = kis(G.s.x1 + (u + 0.5) * KARO_MM, G.s.x1, G.s.x2);
    var my = kis(G.s.y1 + (v + 0.5) * KARO_MM, G.s.y1, G.s.y2);
    var x = ex(u + 0.5, v + 0.5), y = ey(u + 0.5, v + 0.5) - Math.max(22, G.th * 1.6);
    var yay = turYayilim(slug);
    if (yay <= 0) {
      mesajYaz(turAdi(slug) + " için yayılım çapı yazılı değil — buraya ekilemez.");
      S.bayrak = null; return;
    }
    var r = yay / 2, i;
    for (i = 0; i < S.bitki.length; i++) {
      var o = S.bitki[i];
      var orr = sayi(o.yayilim_mm, sayi(o.yaricap_mm, 30) * 2) / 2;
      if (Math.hypot(sayi(o.x) - mx, sayi(o.y) - my) < r + orr) {
        mesajYaz("Buraya ekilemez — " + o.ad + " ile çakışıyor.");
        S.bayrak = null; kirlet(); return;
      }
    }
    var der = (S.katalog && Object.prototype.hasOwnProperty.call(S.katalog, slug))
      ? S.katalog[slug] : undefined;
    onayAc(turAdi(slug) + " buraya ekilecek.",
      "X " + Math.round(mx) + " mm · Y " + Math.round(my) + " mm · yayılım "
        + Math.round(yay) + " mm · "
        + (der == null ? "ekim derinliği bilinmiyor" : Math.round(der) + " mm derine")
        + " · geri alınamaz",
      "Ek", function () {
        gonder("/api/bahce/ek", { tur: slug, yerler: [{ x: mx, y: my }] })
          .then(function () {
            S.ekTur = ""; S.bayrak = null; S.el = false;
            mesajYaz("Nokta yaratıldı, ekim kuyruğa girdi.");
            return veriYukle();
          })
          .catch(function (h) {
            S.bayrak = null;
            mesajYaz("Ekilemedi: " + ((h && h.message) || h));
          });
      }, x, y);
  }

  /* ==================================================================== *
   * ETKİLEŞİM
   *
   * Tekerlek olayları TEK bir requestAnimationFrame'de toplanıyor ve
   * yalnız KAMERA güncelleniyor; zemin hareket sürerken yeniden
   * çizilmiyor. Sürükleme eşiğinin altındaki hareket TIKLAMA sayılıyor,
   * üstündeki KAYDIRMA — yoksa her kaydırma bir onay açardı.
   * ==================================================================== */
  var gest = {
    isaretci: {}, adet: 0, kaydi: false, bas: null, son: null, kaba: false,
    ikiUzak: 0, ikiTw: 0, bekleyen: 0, dx: 0, dy: 0, adim: 0, ax: 0, ay: 0,
    olcek: 1, etkin: false, bitir: 0, sonT: 0, sonX: 0, sonY: 0
  };
  var CIFT_MS = 320, SURUKLE_ESIK = 6;

  function konumu(e) {
    var r = S.tuval.getBoundingClientRect();
    return { x: (e.clientX - r.left) * S.en / r.width,
             y: (e.clientY - r.top) * S.boy / r.height };
  }
  function gestUygula() {
    gest.bekleyen = 0;
    if (gest.adim || gest.olcek !== 1) {
      yakinlastir(Math.pow(1.12, gest.adim) * gest.olcek, gest.ax, gest.ay);
      gest.adim = 0; gest.olcek = 1;
    }
    if (gest.dx || gest.dy) { kaydir(gest.dx, gest.dy); gest.dx = 0; gest.dy = 0; }
    kirlet();
  }
  function gestIste() {
    if (!gest.bekleyen) gest.bekleyen = requestAnimationFrame(gestUygula);
  }
  /** Hareket sürerken zemin dondurulur; 180 ms sessizlikte yenilenir. */
  function gestEtkin() {
    gest.etkin = true;
    clearTimeout(gest.bitir);
    gest.bitir = setTimeout(function () {
      gest.etkin = false; zeminCiz(); kirlet();
    }, 180);
  }
  function ikiliOrta() {
    var a = null, b = null, k;
    for (k in gest.isaretci) { if (!a) a = gest.isaretci[k]; else if (!b) b = gest.isaretci[k]; }
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
             uzak: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  var basti = guvenli("dokunma", function (e) {
    e.preventDefault();
    uyandir();
    var p = konumu(e);
    gest.isaretci[e.pointerId] = p;
    gest.kaba = (e.pointerType === "touch" || e.pointerType === "pen");
    gest.adet++;
    if (S.tuval.setPointerCapture) {
      try { S.tuval.setPointerCapture(e.pointerId); } catch (h) { }
    }
    if (gest.adet === 1) { gest.bas = p; gest.son = p; gest.kaydi = false; }
    else if (gest.adet === 2) {
      var o = ikiliOrta();
      if (o) { gest.ikiUzak = o.uzak; gest.ikiTw = G.kam.tw; gest.son = o; }
      gest.kaydi = true;
    }
  });
  var kaydiOlay = guvenli("gezinme", function (e) {
    uyandir();
    var p = konumu(e);
    if (gest.isaretci[e.pointerId]) {
      gest.isaretci[e.pointerId] = p;
      if (gest.adet >= 2) {
        var o = ikiliOrta();
        if (o && gest.ikiUzak > 0) {
          var hedefTw = kis(gest.ikiTw * (o.uzak / gest.ikiUzak), twEnAz(), twEnCok());
          gest.olcek *= hedefTw / G.kam.tw;
          gest.ax = o.x; gest.ay = o.y;
          if (gest.son) { gest.dx += o.x - gest.son.x; gest.dy += o.y - gest.son.y; }
          gest.son = o;
          gestEtkin(); gestIste();
        }
        return;
      }
      if (!gest.kaydi && Math.hypot(p.x - gest.bas.x, p.y - gest.bas.y) < SURUKLE_ESIK) return;
      gest.kaydi = true;
      gest.dx += p.x - gest.son.x; gest.dy += p.y - gest.son.y;
      gest.son = p;
      gestEtkin(); gestIste();
      return;
    }
    var m = ekranMM(p.x, p.y);
    var yeni = icerde(m.u, m.v) ? { u: Math.floor(m.u), v: Math.floor(m.v) } : null;
    var d1 = yeni ? yeni.u + "," + yeni.v : "";
    var d2 = S.uzerinde ? S.uzerinde.u + "," + S.uzerinde.v : "";
    if (d1 !== d2) { S.uzerinde = yeni; kirlet(); }
    /* İmleç dokunulabilir bir şeyin üstündeyse el işareti. */
    S.tuval.style.cursor = (vurusBul(p, 0) || bitkiBul(p, 0)) ? "pointer" : "default";
  });
  var cikti = guvenli("çıkış", function () {
    if (S.uzerinde) { S.uzerinde = null; kirlet(); }
  });
  var tekerlek = guvenli("tekerlek", function (e) {
    e.preventDefault();
    uyandir();
    var p = konumu(e);
    gest.ax = p.x; gest.ay = p.y;
    gest.adim += e.deltaY > 0 ? -1 : 1;
    gestEtkin(); gestIste();
  });
  var birakti = guvenli("bırakma", function (e) {
    if (!gest.isaretci[e.pointerId]) return;
    var p = gest.isaretci[e.pointerId];
    delete gest.isaretci[e.pointerId];
    gest.adet = Math.max(0, gest.adet - 1);
    if (gest.adet === 1) {
      var kalan = null, k;
      for (k in gest.isaretci) kalan = gest.isaretci[k];
      gest.son = kalan; gest.bas = kalan; gest.kaydi = true; gest.ikiUzak = 0;
      return;
    }
    if (gest.adet > 0) return;
    if (gest.kaydi) { gest.kaydi = false; return; }
    var simdi = Date.now();
    if (simdi - gest.sonT < CIFT_MS
        && Math.hypot(p.x - gest.sonX, p.y - gest.sonY) < 20) {
      gest.sonT = 0;
      if (S.onay) onayKapat();
      S.bayrak = null;
      kadrajaDon();
      return;
    }
    gest.sonT = simdi; gest.sonX = p.x; gest.sonY = p.y;
    dokun(p);
  });

  /** SIRA: arayüz alanları → bitki → karo. Bir onay açıkken karo dalı
   *  tetiklenmiyor; boşluğa dokunmak açık olanı kapatıyor. */
  function dokun(p) {
    var pay = gest.kaba ? DOKUNMA_PAYI : 3;
    var v = vurusBul(p, pay);
    if (v) { arayuzDokun(v); return; }
    if (S.onay) { onayKapat(); S.bayrak = null; return; }
    if (S.kartKip) { kartKapat(); return; }
    if (S.el) { S.el = false; kirlet(); return; }
    var b = bitkiBul(p, pay);
    if (b) {
      S.secili = S.secili === b.ad ? "" : b.ad;
      S.halka = S.secili;
      S.bayrak = null;
      if (S.secili) gecmisAl(S.secili);
      else if (S.kartKip === "bitki") kartKapat();
      kirlet();
      return;
    }
    if (S.halka) { S.halka = ""; S.secili = ""; kirlet(); return; }
    var m = ekranMM(p.x, p.y);
    if (!icerde(m.u, m.v)) {
      S.bayrak = null;
      mesajYaz("Orası yatağın dışı — yürünebilir alan yumuşak eksen sınırlarıyla aynı.");
      return;
    }
    var u = Math.floor(m.u), vv = Math.floor(m.v);
    S.bayrak = { u: u, v: vv };
    if (S.tasiKip) tasiOnay(u, vv);
    else if (S.ekTur) ekimOnay(u, vv);
    else gitOnay(u, vv);
    kirlet();
  }

  /** TAŞIMA KAYITTIR: makine kımıldamıyor, bitkinin x/y'si değişiyor.
   *  Sunucu yatak sınırını ve dikim alanını kendi denetliyor; burada
   *  yalnız çakışma önden söyleniyor ki kullanıcı boşa onaylamasın. */
  function tasiOnay(u, v) {
    var b = S.ix[S.tasiKip];
    if (!b) { S.tasiKip = ""; return; }
    var mx = kis(G.s.x1 + (u + 0.5) * KARO_MM, G.s.x1, G.s.x2);
    var my = kis(G.s.y1 + (v + 0.5) * KARO_MM, G.s.y1, G.s.y2);
    var x = ex(u + 0.5, v + 0.5), y = ey(u + 0.5, v + 0.5) - Math.max(22, G.th * 1.6);
    var r = sayi(b.yayilim_mm, sayi(b.yaricap_mm, 30) * 2) / 2, i;
    for (i = 0; i < S.bitki.length; i++) {
      var o = S.bitki[i];
      if (String(o.ad) === String(b.ad)) continue;
      var orr = sayi(o.yayilim_mm, sayi(o.yaricap_mm, 30) * 2) / 2;
      if (Math.hypot(sayi(o.x) - mx, sayi(o.y) - my) < r + orr) {
        mesajYaz("Oraya taşınamaz — " + o.ad + " ile çakışıyor.");
        S.bayrak = null; kirlet(); return;
      }
    }
    onayAc(b.ad + " X " + Math.round(mx) + " mm, Y " + Math.round(my) + " mm noktasına taşınacak.",
      "kayıt işi — makine kımıldamaz · ekim tarihi ve geçmişi korunur",
      "Taşı", function () {
        gonder("/api/bahce/tasi", { ad: b.ad, x: mx, y: my })
          .then(function () {
            S.tasiKip = ""; S.bayrak = null;
            mesajYaz(b.ad + " taşındı.");
            return veriYukle();
          })
          .catch(function (h) {
            S.bayrak = null;
            mesajYaz("Taşınamadı: " + ((h && h.message) || h));
          });
      }, x, y);
  }
  function arayuzDokun(o) {
    if (o.ad === "onay-evet") {
      var fn = S.onay && S.onay.fn;
      onayKapat();
      if (fn) fn();
    } else if (o.ad === "onay-hayir") {
      onayKapat(); S.bayrak = null;
    } else if (o.ad === "onay-kutu") {
      /* Kutunun gövdesi yutuyor: arkasındaki karoya komut gitmesin. */
    } else if (o.ad === "madalyon-makine") {
      kartYaz("makine");
    } else if (o.ad === "madalyon-bugun") {
      kartYaz("bugun");
    } else if (o.ad === "el-ac") {
      S.el = true; kirlet();
    } else if (o.ad === "el-kapa") {
      S.el = false; S.ekTur = ""; kirlet();
    } else if (o.ad === "goz") {
      S.ekTur = S.ekTur === o.tur ? "" : o.tur;
      S.secili = ""; S.halka = "";
      mesajYaz(S.ekTur ? turAdi(S.ekTur) + " seçildi — bir karoya dokun." : "");
      kirlet();
    } else if (o.ad === "eylem") {
      bitkiEylem(o.eylem, S.ix[S.halka]);
    } else if (o.ad === "eylem-kapali") {
      mesajYaz("Bu iş şimdi yapılamaz: " + engel().yazi + ".");
    } else if (o.ad === "sakin") {
      S.sakin = !S.sakin;
      mesajYaz(S.sakin ? "Sakin mod açık — boştaki hayat durdu, bilgi durmadı."
        : "Sakin mod kapandı.");
      kirlet();
    } else if (o.ad === "kunye") {
      if (S.secili) { gecmisAl(S.secili); kartYaz("bitki"); }
    }
  }

  /* ==================================================================== *
   * SAHNE VE KARE DÖNGÜSÜ
   * ==================================================================== */
  var sahneCiz = guvenli("sahne", function () {
    var c = S.ct;
    if (!c || !S.en || !S.boy || !G.s) return;
    V = [];
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.clearRect(0, 0, S.en, S.boy);
    /* Hareket sürerken zemin dondurulup blit ediliyor (yeniden çizmek
       Pi'de karenin en pahalı işi). AMA dondurulmuş zemin görüntüyü
       KAPLAMIYORSA yeniden çiziliyor: boş gökyüzü göstermek, sahneyi bir
       an için yok etmek demek. */
    var donuk = gest.etkin || G.kayiyor;
    var zd = zeminDonusum(false);
    if (!zd && donuk) zd = zeminKapsiyorMu();
    if (!zd) { zeminCiz(); zd = zeminDonusum(false); }
    if (zd) c.drawImage(S.zemin, 0, 0, S.zemin.width, S.zemin.height, zd.e, zd.f, zd.w, zd.h);
    izCiz(c);
    uzerindeCiz(c);
    izgaraCiz(c);
    bayrakCiz(c);
    nemCiz(c);
    efektCiz(c);
    bitkiCiz(c);
    makineCiz(c);
    ciftciCiz(c);
    tozCiz(c);
    halkaCiz(c);
    madalyonCiz(c);
    elCiz(c);
    mesajCiz(c);
    onayCiz(c);
  });

  function isVarMi() {
    if (S.efekt.length || S.zerre.length || S.iz.length) return true;
    if (suAkiyor()) return true;
    if (D().hareket) return true;
    if (G.kam && G.hedef && !G.elle
        && (Math.abs(G.kam.cu - G.hedef.cu) > 0.002 || Math.abs(G.kam.cv - G.hedef.cv) > 0.002
         || Math.abs(G.kam.tw - G.hedef.tw) > 0.06)) return true;
    if (S.ciz.x != null && S.bildirilen.x != null
        && (Math.abs(S.ciz.x - S.bildirilen.x) > 0.4
         || Math.abs(S.ciz.y - S.bildirilen.y) > 0.4)) return true;
    if (calisanIs()) return true;
    return false;
  }
  /** 0 = DURGUN (kare yok), 1 = BOŞTA (düşük hız), 2 = İŞ (tam hız).
   *
   *  Sahne boştayken yaşıyor — ama sonsuza kadar değil. Panel açık
   *  unutulduğunda Pi bir de boşa dönen bir çizim döngüsü taşımasın diye,
   *  DURGUN_SN kadar hiçbir dokunuş ve hiçbir makine işi olmadıysa sahne
   *  son hâlinde donuyor. En küçük dokunuş, gelen her paket ve her iş onu
   *  yeniden uyandırıyor. Sekme görünmüyorsa zaten hiç kare yok. */
  var DURGUN_SN = 90;
  function canliMi() {
    /* SEKME GÖRÜNMÜYORSA HİÇ KARE YOK: panelde 3B sahne de çiziyor,
       ikisi aynı anda dönerse Pi zorlanıyor. `S.acik` sekme değişiminden
       geliyor (app.js `Bahce.sekme(...)` çağırıyor); kendi sayfasında
       hep açık. */
    if (document.hidden || !S.acik || !S.hazir) return 0;
    if (isVarMi()) return 2;
    if (S.sakin) return 0;                  /* sakin mod: boşta çizim yok */
    if (Date.now() - S.sonEtkilesim > DURGUN_SN * 1000) return 0;
    return 1;
  }
  function uyandir() {
    var uyuyordu = Date.now() - S.sonEtkilesim > DURGUN_SN * 1000;
    S.sonEtkilesim = Date.now();
    if (uyuyordu) kirlet();
  }
  function isteKare() {
    if (!S.dongu && S.hazir && S.acik) S.dongu = requestAnimationFrame(kare);
  }
  function kare(t) {
    S.dongu = 0;
    var sn = t / 1000;
    var dt = kis(sn - (S.sonT || sn), 0, 0.12);
    S.sonT = sn; S.t = sn;
    var hal = canliMi();
    /* YUMUŞATMA — ama ASLA bildirilenin ilerisine geçmeden. */
    if (S.bildirilen.x != null) {
      if (S.ciz.x == null) { S.ciz.x = S.bildirilen.x; S.ciz.y = S.bildirilen.y; }
      else {
        var k = kis(dt * 9, 0, 1);
        S.ciz.x += (S.bildirilen.x - S.ciz.x) * k;
        S.ciz.y += (S.bildirilen.y - S.ciz.y) * k;
        if (Math.abs(S.bildirilen.x - S.ciz.x) < 0.4) S.ciz.x = S.bildirilen.x;
        if (Math.abs(S.bildirilen.y - S.ciz.y) < 0.4) S.ciz.y = S.bildirilen.y;
      }
    }
    if (kameraGuncelle(dt)) { G.kayiyor = true; S.kirli = true; }
    else if (G.kayiyor) { G.kayiyor = false; zeminCiz(); S.kirli = true; }
    hayatGuncelle(dt);
    efektGuncelle(dt);
    if (hal === 1 && sn - S.sonCizim < 1 / HIZ_BOSTA && !S.kirli) {
      S.dongu = requestAnimationFrame(kare);
      return;
    }
    S.sonCizim = sn;
    var b0 = performance.now();
    sahneCiz();
    var ms = performance.now() - b0;
    S.olcumKare.kare++; S.olcumKare.sure += ms;
    if (ms > S.olcumKare.enUzun) S.olcumKare.enUzun = ms;
    S.kirli = false;
    if (canliMi() > 0) S.dongu = requestAnimationFrame(kare);
  }

  /* ==================================================================== *
   * VERİ, SOKET, KURULUM
   * ==================================================================== */
  function bitkileriHazirla() {
    var v = S.veri || {}, eski = S.ix;
    S.bitki = (v.bitkiler || []).filter(function (b) { return b && b.ad != null; });
    S.ix = {};
    S.bitki.forEach(function (b) {
      var e = eski[String(b.ad)];
      if (e) {
        b._islak = e._islak; b._probT = e._probT; b._hoyuk = e._hoyuk;
        b._delik = e._delik; b._damlaT = e._damlaT; b._sizma = e._sizma;
        b._reveal = e._reveal;
        /* ÖLÇÜM GELDİ: taralı halka gerçek dolguya dönüyor. */
        if (!nemDurum(e).var && nemDurum(b).var) {
          b._reveal = 0.001; b._probT = 0;
          mesajYaz(b.ad + " ölçüldü — taralı halka doldu.");
        }
        if ((b.su_olcum || {}).bayat) b._islak = 0;
      }
      S.ix[String(b.ad)] = b;
    });
    if (S.secili && !S.ix[S.secili]) S.secili = "";
    if (S.halka && !S.ix[S.halka]) S.halka = "";
  }
  /** Tür kataloğu — ekim derinliği onay metninde yazsın diye.
   *  Yoksa "bilinmiyor" yazıyor, uydurma derinlik yok. */
  var katalogAl = guvenli("katalog", function () {
    if (S.katalogT && Date.now() - S.katalogT < 600000) return Promise.resolve();
    S.katalogT = Date.now();
    return api("/api/turler").then(function (c) {
      var k = {};
      (c.turler || []).forEach(function (t) {
        if (t && t.slug) k[t.slug] = t.sow_depth_mm == null ? null : sayi(t.sow_depth_mm);
      });
      S.katalog = k;
    }).catch(function () { S.katalog = null; });
  });
  /** Basınç EĞİLİMİ ölçümden: son üç saatin eğimi (hPa/saat).
   *  İki uçtan az veri varsa eğilim YOK — uydurma yok. */
  var egimAl = guvenli("eğilim", function () {
    if (S.egimT && Date.now() - S.egimT < 300000) return Promise.resolve();
    S.egimT = Date.now();
    return api("/api/gecmis?dakika=180").then(function (c) {
      var ts = (c && c.ts) || [], bp = (c && c.basinc) || [], i, ilk = -1, son = -1;
      for (i = 0; i < bp.length; i++) {
        if (bp[i] == null) continue;
        if (ilk < 0) ilk = i;
        son = i;
      }
      if (ilk < 0 || son <= ilk) { S.egim = null; return; }
      var sa = (sayi(ts[son]) - sayi(ts[ilk])) / 3600;
      S.egim = sa > 0.25 ? (sayi(bp[son]) - sayi(bp[ilk])) / sa : null;
    }).catch(function () { S.egim = null; });
  });
  /** Seçili bitkinin ölçüm geçmişi ve eğilimi — künyede yazıyor. */
  var gecmisAl = guvenli("geçmiş", function (ad) {
    if (!ad || S.gecmisAd === ad) return;
    S.gecmisAd = ad; S.gecmis = null;
    api("/api/bitki").then(function (c) {
      var b = (c.bitkiler || []).filter(function (x) { return String(x.ad) === ad; })[0];
      if (!b) return;
      S.gecmis = { adet: (b.gecmis || []).length, egilim: b.egilim || null };
      if (S.kartKip === "bitki") { S.kartKip = ""; kartYaz("bitki"); }
    }).catch(function () { /* geçmiş yoksa künye onsuz yazılıyor */ });
  });
  /** Kendi sayfasında ölçüm paketi soketten geliyor; PANELDE app.js onu
   *  bize iletmiyor, o yüzden hava için /api/durum okunuyor. */
  var havaAl = guvenli("hava", function () {
    if (!PANELDE) return Promise.resolve();
    return api("/api/durum").then(function (c) {
      if (c && c.olcum) { S.olcum = c.olcum; kirlet(); }
    }).catch(function () {
      hataYaz("hava", "Ölçümler okunamadı — hava satırları boş kalıyor.");
    });
  });

  var veriYukle = guvenli("veri", function () {
    if (S.yukleniyor) return Promise.resolve();
    S.yukleniyor = true;
    S.veriT = Date.now();
    return api("/api/bahce").then(function (c) {
      S.veri = c || {};
      bitkileriHazirla();
      geometriKur();
      zeminCiz();
      hataYaz("veri", "");
      katalogAl(); egimAl(); havaAl();
      if (S.kartKip) { var kip = S.kartKip; S.kartKip = ""; kartYaz(kip); }
      kirlet();
    }).catch(function (h) {
      hataYaz("veri", "Bahçe okunamadı: " + ((h && h.message) || h)
        + (h && h.kod === 401 ? " — jeton geçersiz, panele girip yenile." : ""));
    }).then(function () { S.yukleniyor = false; });
  });

  var durumGeldi = guvenli("durum", function (d) {
    if (!d) return;
    var oncekiNx = G.nx, oncekiNy = G.ny;
    S.durum = d;
    S.durumT = Date.now();
    var k = d.konum || {};
    if (k.x != null && k.y != null) {
      S.bildirilen = { x: sayi(k.x), y: sayi(k.y), z: k.z == null ? null : sayi(k.z) };
      S.konumYok = false;
    } else {
      /* PLC kopuk: yeni konum yok. Çiftçi SON BİLİNEN yerinde DURUYOR —
         silinmiyor, tahminle de ilerlemiyor. */
      S.bildirilen.z = null;
      S.konumYok = true;
    }
    if (!S.hazir || !S.en) return;          /* ölçü daha alınmadı */
    geometriKur();
    if (G.nx !== oncekiNx || G.ny !== oncekiNy) zeminCiz();
    if (S.kartKip === "makine") { S.kartKip = ""; kartYaz("makine"); }
    canlandir();
  });

  function soketBagla() {
    if (!S.jeton) return;
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var ws;
    try {
      ws = new WebSocket(proto + "//" + location.host
        + "/ws/panel?jeton=" + encodeURIComponent(S.jeton));
    } catch (h) {
      hataYaz("soket", "Sunucu soketi açılamadı: " + ((h && h.message) || h));
      return;
    }
    S.soket = ws;
    ws.onopen = function () {
      S.soketAcik = true;
      hataYaz("soket", "");
      kirlet();
    };
    ws.onmessage = guvenli("paket", function (olay) {
      var m;
      try { m = JSON.parse(olay.data); } catch (h) { return; }
      if (m.tip === "anlik") { durumGeldi(m.durum); if (m.olcum) { S.olcum = m.olcum; canlandir(); } }
      else if (m.tip === "durum") durumGeldi(m.durum);
      else if (m.tip === "olcum") { S.olcum = m.veri; canlandir(); }
      else if (m.tip === "bahce" || m.tip === "ekim" || m.tip === "tepsi") veriYukle();
    });
    ws.onclose = function () {
      S.soketAcik = false;
      hataYaz("soket", "Sunucu bağlantısı yok — konum ve ölçümler durdu, "
        + "3 saniyede bir yeniden denenecek.");
      kirlet();
      setTimeout(soketBagla, 3000);
    };
    ws.onerror = function () { try { ws.close(); } catch (h) { } };
  }

  var olcuKur = guvenli("ölçü", function () {
    /* Ölçü TUVALİN KENDİ KUTUSUNDAN: kendi sayfasında bu bütün ekran,
       panelde Bahçe sekmesine ne kalıyorsa o. İkisi için ayrı hesap yok. */
    var r = S.tuval.getBoundingClientRect();
    var en = Math.max(280, Math.round(r.width || window.innerWidth));
    var boy = Math.max(220, Math.round(r.height || window.innerHeight));
    var dpr = kis(window.devicePixelRatio || 1, 1, 2);
    if (en === S.en && boy === S.boy && dpr === S.dpr) return;
    S.en = en; S.boy = boy; S.dpr = dpr;
    S.tuval.width = Math.round(en * dpr);
    S.tuval.height = Math.round(boy * dpr);
    S.tuval.style.width = en + "px";
    S.tuval.style.height = boy + "px";
    S.ct.setTransform(dpr, 0, 0, dpr, 0, 0);
    S.sprite = {};
    geometriKur();
    zeminKur();
    hayatKur();
    kirlet();
  });

  function olaylariBagla() {
    S.tuval.addEventListener("pointerdown", basti);
    S.tuval.addEventListener("pointermove", kaydiOlay);
    S.tuval.addEventListener("pointerup", birakti);
    S.tuval.addEventListener("pointercancel", birakti);
    S.tuval.addEventListener("pointerleave", cikti);
    S.tuval.addEventListener("wheel", tekerlek, { passive: false });
    S.tuval.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    var kartKok = $("#oy-kart");
    if (kartKok) kartKok.addEventListener("click", guvenli("kart tık", kartTik));
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (S.onay) { onayKapat(); S.bayrak = null; return; }
      if (S.kartKip) { kartKapat(); return; }
      if (S.tasiKip) { S.tasiKip = ""; mesajYaz("Taşıma bırakıldı."); return; }
      if (S.el) { S.el = false; S.ekTur = ""; kirlet(); return; }
      if (S.halka) { S.halka = ""; S.secili = ""; kirlet(); }
    });
    /* SEKME GÖRÜNMÜYORSA ÇİZİM DURUYOR. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (S.dongu) { cancelAnimationFrame(S.dongu); S.dongu = 0; }
      } else kirlet();
    });
    window.addEventListener("resize", olcuKur);
    window.addEventListener("orientationchange", olcuKur);
  }

  function baslat() {
    PANELDE = !!(window.Panel && window.Panel.apiIste);
    S.tuval = $("#oy-tuval");
    if (!S.tuval || !S.tuval.getContext) {
      hataYaz("kurulum", "Tuval bulunamadı — tarayıcı canvas desteklemiyor olabilir.");
      return;
    }
    S.ct = S.tuval.getContext("2d");
    if (!PANELDE) {
      /* KENDİ SAYFASI: jeton localStorage'dan. Yoksa boş sahne çizmiyoruz,
         sebebini söyleyip panele yönlendiriyoruz. */
      S.jeton = jetonAl();
      if (!S.jeton) {
        var kilit = $("#oy-kilit");
        if (kilit) kilit.hidden = false;
        return;
      }
    }
    olaylariBagla();
    S.hazir = true;
    /* PANELDE ölçü ve ilk yükleme SEKME AÇILINCA yapılıyor: bölüm
       `display:none` iken kutusu sıfır. app.js sekmeye geçince
       `Bahce.sekme(true)` çağırıyor. Sekme zaten açıksa (ya da app.js
       bizden önce haber verdiyse) burada kuruluyor. Kendi sayfasında
       sekme diye bir şey yok, hep açık. */
    if (PANELDE) {
      var bolum = document.getElementById("sayfa-bahce");
      if (S.acik || (bolum && bolum.classList.contains("etkin"))) dis.sekme(true);
      return;
    }
    S.acik = true;
    olcuKur();
    veriYukle();
    soketBagla();
    setInterval(function () {
      if (!document.hidden && S.acik && Date.now() - S.veriT > TAZE_MS) veriYukle();
    }, 10000);
  }

  /* ==================================================================== *
   * DIŞ ARAYÜZ
   *
   * Panelde app.js bu nesneyi `window.Bahce` adıyla çağırıyor: sekme
   * değişimi, durum paketi, kuyruk ve ekim haberleri oradan geliyor.
   * Kendi sayfasında bu çağrılar hiç gelmiyor; oyun kendi soketini
   * kullanıyor ve sekmesi hep açık.
   * ==================================================================== */
  var dis = {
    /** Sekme açıldı/kapandı — SEKME KAPALIYKEN HİÇ KARE ÇİZİLMİYOR. */
    sekme: function (acik) {
      S.acik = !!acik;
      /* Kabuk kuralları bu sınıfa bağlı: sol yüzen panel tam genişliğe
         açılıyor, 3B sahne alanı kapanıyor, gövdenin iç boşluğu kalkıyor.
         Oyun sekmede ne kadar alan varsa hepsini kullanıyor. */
      document.body.classList.toggle("bahce-acik", S.acik);
      if (!S.acik) {
        if (S.dongu) { cancelAnimationFrame(S.dongu); S.dongu = 0; }
        kartKapat();
        return;
      }
      if (!S.hazir) return;
      /* Sekme görünür olduktan SONRA ölçülüyor: bölüm `display:none`
         iken kutusu sıfır. */
      requestAnimationFrame(function () {
        olcuKur();
        uyandir();
        veriYukle();
        var p = P();
        if (p && p.S && p.S.durum) durumGeldi(p.S.durum);
        kirlet();
      });
    },
    durumDegisti: function (d) { durumGeldi(d); },
    kuyrukDegisti: function (kk) {
      S.veri = S.veri || {};
      if (kk) S.veri.kuyruk = kk;
      if (S.acik) veriYukle();
    },
    ekimDegisti: function () { if (S.acik) veriYukle(); },
    baglandi: function () { if (S.acik) veriYukle(); },
    /* Kamera karesi bu sahnede kullanılmıyor. */
    kareGeldi: function () { /* boş — bilerek */ },
    yenile: function () { return veriYukle(); },
    kadraj: kadrajaDon,
    /** Kare süresi ölçümü. */
    olcum: function (sifirla) {
      var o = S.olcumKare;
      var c = { kare: o.kare, ortalama: o.kare ? +(o.sure / o.kare).toFixed(2) : 0,
                enUzun: +o.enUzun.toFixed(2), bitki: S.bitki.length,
                en: S.en, boy: S.boy, dpr: S.dpr, karo: KARO_MM,
                izgara: G.nx + "x" + G.ny, hal: canliMi() };
      if (sifirla) { o.kare = 0; o.sure = 0; o.enUzun = 0; }
      return c;
    },
    /** Vuruş kutuları — ekranda görünenle tıklanan alanın aynı olduğunu
     *  doğrulamanın yolu. */
    vurusKutulari: function () {
      return S.bitki.map(function (b) {
        var k = vurusKutusu(b, 0);
        return { ad: String(b.ad), x1: +k.x1.toFixed(1), y1: +k.y1.toFixed(1),
                 x2: +k.x2.toFixed(1), y2: +k.y2.toFixed(1),
                 derinlik: +k.derinlik.toFixed(3) };
      });
    },
    arayuzAlanlari: function () {
      return V.map(function (o) {
        return { ad: o.ad, x: +o.x.toFixed(1), y: +o.y.toFixed(1),
                 r: o.r != null ? +o.r.toFixed(1) : null,
                 w: o.w ? +o.w.toFixed(1) : 0, h: o.h ? +o.h.toFixed(1) : 0,
                 eylem: o.eylem || "", tur: o.tur || "" };
      });
    },
    baglam: function () { return PANELDE ? "panel" : "sayfa"; }
  };
  /* `window.Bahce` ADIYLA DA DURUYOR: app.js sekme değişimini, durum
     paketini ve kuyruk haberlerini o adla çağırıyor — ona dokunmadan
     bağlanıyoruz. Kendi sayfasında bu ad kimseyi rahatsız etmiyor.
     Modül gövdesi app.js'ten önce çalışıyor, o yüzden burada duruyor:
     app.js `basla()` çağırdığında `window.Bahce` hazır olmalı. */
  window.Bahce = dis;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", baslat);
  } else baslat();
  return dis;
}());
