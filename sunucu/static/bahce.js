/* Bahçe — OYUN ALANI. Çiftçi, eksenlerin sahnedeki karşılığı.
 *
 * ---------------------------------------------------------------------
 * ÇEKİRDEK FİKİR
 * ---------------------------------------------------------------------
 * Ekranda yürüyen adam bir aktör değil, MAKİNENİN AVATARI. Konumu durum
 * paketinin `konum`undan geliyor — 3B sahnedeki robotun okuduğu kaynağın
 * aynısı, aynı mm→sahne çevrimiyle (`tarla.js` sx/sz: mm eksi yumuşak
 * sınırın alt ucu). Oyun tarafında bağımsız yürüme animasyonu YOK:
 * çiftçi, iki durum paketi arasında yumuşatılır ama BİLDİRİLEN KONUMUN
 * ÖNÜNE GEÇMEZ. Eksen dururken çiftçi durur; PLC kopuksa kımıldamaz.
 *
 * ---------------------------------------------------------------------
 * MAKİNE GEOMETRİSİ — SEÇİM: (a) PORTAL SAHNEDE KALIYOR
 * ---------------------------------------------------------------------
 * Köprü ve kızak izometrik sahnede çiziliyor, çiftçi kızağın üstünde
 * duruyor — yanında değil, ONUNLA. Seçimin sebebi: bu ekranın iddiası
 * "gördüğün şey makinenin kendisi". Portalı silersek o iddianın kanıtı
 * kalmıyor; çiftçi serbest gezen bir karakter gibi okunuyor ve
 * "yürünebilir alan = yumuşak eksen sınırı" kuralının görünür bir sebebi
 * olmuyor. PLC kopukken de ekranda duran şey bir adam değil, DURMUŞ BİR
 * MAKİNE oluyor.
 *   ELENEN (b): yalnız çiftçi, sınırı yatak çerçevesi verir. Daha temiz
 *   ve iki temsil üst üste binmiyor; ama makinenin duruşu (köprü nerede,
 *   kızak nerede) kayboluyor ve kopukluk hâlinde ekran "adam durmuş"
 *   diyor, "eksen durmuş" demiyor. Bu ekranın bütün değeri ikincisinde.
 *
 * ---------------------------------------------------------------------
 * IZGARA ÖLÇÜ TAŞIYOR
 * ---------------------------------------------------------------------
 * Karolar uydurma değil: yatağın gerçek koordinat uzayı, yumuşak eksen
 * sınırlarından (`durum.sinirlar`) geliyor ve bir karo KARO_MM kadar.
 * Karoya tıklamak o karonun merkez koordinatına gerçek `git` komutu
 * göndermek demek. Komut reddedilirse çiftçi hiç adım atmamış olur ve
 * sebep alt şeritte yazar.
 *
 * ---------------------------------------------------------------------
 * ÖLÇÜLMEMİŞ, ÖLÇÜLMÜŞ GİBİ GÖRÜNMEZ
 * ---------------------------------------------------------------------
 * Yatağın ön duvarı kesit: köklerin ve nem sütunlarının yeri. Ölçülen nem
 * dolgu sütun (%100 yüzeyde, %0 dipte); ölçülmemiş nem TARALI OYUK —
 * simge değil, yokluğun kendisi. Sulama bir oyuğu DOLDURMUYOR: su
 * verildi, nem ölçülmedi. Bayat okuma soluk ve üstü kesikli.
 *
 * ---------------------------------------------------------------------
 * DURUŞ HANGİ SİNYALDEN
 * ---------------------------------------------------------------------
 * · eğilme     → ölçülen Z (`konum.z`, `toprak_z`, `guvenli_z`).
 * · sulama     → POMPA RÖLESİ (`Panel.S.roleDurum.su_pompasi`). Röle
 *                durum paketinde değil ÖLÇÜM paketinde geliyor; 3B sahne
 *                de tam buradan okuyor (90-robot.js). "Sulama komutu
 *                gönderdim, demek ki akıyordur" demek, pompa çalışmazken
 *                ekranda su göstermek olurdu.
 * · ekim       → tohum ucunun KENDİ EKSENİ (`tohum_ucu.mm` / `yukari_mm`).
 * · nem ölçümü → SİNYAL YOK. `ajan/plc.py`de yalnız X/Y/Z/T var, prob'un
 *                kendi ekseni ve "ölçüyor" bayrağı yok; ölçüm ana Z ile
 *                daldırılarak yapılıyor. Bu yüzden ölçüm duruşu uydurma
 *                bir bayraktan değil, BAŞLATILAN İŞTEN türetiliyor:
 *                kuyrukta `nem` işi çalışıyor + uç o bitkinin üstünde +
 *                Z toprağa inmiş. Ekranda da "prob duruşu · işten
 *                türetildi" diye yazıyor, ölçülmüş gibi durmuyor.
 *
 * ---------------------------------------------------------------------
 * PERFORMANS
 * ---------------------------------------------------------------------
 * Toprak zemini, karo ızgarası ve ön duvar dokusu birer KEZ ayrı tuvale
 * çiziliyor. Boşta kare yok: hiçbir şey değişmiyorsa döngü dönmüyor.
 */
window.Bahce = (function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var P = function () { return window.Panel || {}; };

  var KARO_MM = 50;              /* bir karo kaç mm — ızgara ölçü taşıyor */
  var ISO_ORAN = 0.5;            /* izometrik: karo yüksekliği / genişliği */
  var DUVAR_ORAN = 0.30;         /* ön duvar, tahta yüksekliğinin ekran payı */
  var NEM_YARICAP_MM = 150;

  var S = {
    acik: false, veri: null, durum: null, yukleniyor: false, sakin: false,
    tuval: null, ct: null, en: 0, boy: 0, dpr: 1,
    zemin: null, zeminCt: null, sprite: {},
    bitki: [], ix: {},
    /* Makinenin BİLDİRİLEN konumu ve ekrandaki (yumuşatılmış) konumu.
       `ciz` asla `bildirilen`in ilerisine geçmiyor. */
    bildirilen: { x: null, y: null, z: null, t: null },
    ciz: { x: null, y: null, z: null },
    secili: "", uzerinde: null, hedefKaro: null, tepsiTur: "", konumYok: true,
    hava: { sicaklik: null, nem: null, basinc: null, toprak: null, egim: null, ts: 0 },
    havaT: 0, egimT: 0,
    ot: [], toz: [], iz: [], ruzgar: { yon: 0, guc: 0.4, hYon: 0, hGuc: 0.4 },
    zerre: [], sonAdim: null, suSonAd: "", sonCizim: 0,
    gecmis: null, gecmisAd: "", gecmisT: 0,
    onay: null, mesaj: "", mesajT: 0, kartIx: 0, isKip: "kart",
    efekt: [], sonIsler: {}, suBasladi: 0, suSon: 0,
    katalog: null, katalogT: 0,
    notlar: {}, hatalar: [],
    t: 0, sonT: 0, dongu: 0, kirli: true,
    olcum: { kare: 0, sure: 0, enUzun: 0 }
  };

  /* ==================================================================== *
   * Yardımcılar
   * ==================================================================== */
  function sayi(d, v) { var s = Number(d); return isFinite(s) ? s : (v === undefined ? 0 : v); }
  function kis(d, a, b) { return Math.max(a, Math.min(b, d)); }
  function kacisli(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function ky(t) { return 1 - Math.pow(1 - kis(t, 0, 1), 3); }
  function api(yol, sec) { return P().apiIste(yol, sec); }
  function gonder(yol, govde) {
    return api(yol, { method: "POST", body: JSON.stringify(govde) });
  }
  function komut(ad, arg) {
    if (!P().komutGonder) return Promise.resolve(null);
    return P().komutGonder(ad, arg || {});
  }
  function gunluk(m, s) { if (P().gunluk) P().gunluk(m, s || ""); }
  function uretec(c) {
    var a = c >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function tohum(ad) {
    var h = 2166136261, s = String(ad || ""), i;
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  function hexRGB(h) {
    var s = String(h || "").replace("#", "");
    var t = s.length === 3 ? s.split("").map(function (c) { return c + c; }).join("") : s;
    var n = parseInt(t.slice(0, 6), 16);
    return isFinite(n) ? { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
                       : { r: 123, g: 191, b: 90 };
  }
  function rgba(c, a) { return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")"; }
  function karis(a, b, t) {
    return { r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t),
             b: Math.round(a.b + (b.b - a.b) * t) };
  }
  function ton(c, o) {
    function f(k) { return Math.round(o >= 0 ? k + (255 - k) * o : k * (1 + o)); }
    return { r: kis(f(c.r), 0, 255), g: kis(f(c.g), 0, 255), b: kis(f(c.b), 0, 255) };
  }
  function sureKisa(sn) {
    if (sn == null || !isFinite(Number(sn))) return "";
    var s = Math.max(0, Number(sn));
    if (s < 90) return "az önce";
    if (s < 3600) return Math.round(s / 60) + " dk";
    if (s < 86400) return Math.round(s / 3600) + " saat";
    return Math.round(s / 86400) + " gün";
  }

  /* SESSİZ BAŞARISIZLIK YOK. */
  function guvenli(ad, islev) {
    return function () {
      try { return islev.apply(null, arguments); }
      catch (h) { hataYaz(ad, h); return undefined; }
    };
  }
  function hataYaz(ad, hata) {
    var m = ad + ": " + ((hata && hata.message) || hata);
    if (S.hatalar.indexOf(m) < 0) {
      S.hatalar.push(m);
      if (S.hatalar.length > 4) S.hatalar.shift();
      try { console.error("[bahçe]", ad, hata); } catch (e) { /* boş */ }
    }
    var el = $("#bh-hata");
    if (el) {
      el.hidden = false;
      el.innerHTML = S.hatalar.map(function (x) { return "<span>" + kacisli(x) + "</span>"; }).join("");
    }
  }
  function notYaz(anahtar, metin) {
    if (metin) S.notlar[anahtar] = metin; else delete S.notlar[anahtar];
    var el = $("#bh-not");
    if (!el) return;
    var h = [];
    for (var k in S.notlar) if (S.notlar[k]) h.push(S.notlar[k]);
    el.hidden = !h.length;
    el.textContent = h.join(" · ");
  }
  function mesajYaz(m) { S.mesaj = m || ""; S.mesajT = S.t; altYaz(); kirlet(); }
  function kirlet() { S.kirli = true; isteKare(); }

  /* ==================================================================== *
   * EKSEN DURUMU — tek kaynak. Buradan okunmayan hiçbir hareket yok.
   * ==================================================================== */
  function D() { return S.durum || {}; }
  function sinirAl() {
    var s = (D().sinirlar) || (S.veri && S.veri.sinirlar) || {};
    var x = s.x || {}, y = s.y || {};
    var x1 = sayi(x.min, 0), x2 = sayi(x.max, 535);
    var y1 = sayi(y.min, 0), y2 = sayi(y.max, 630);
    if (!(x2 - x1 > 10)) { x1 = 0; x2 = 535; }
    if (!(y2 - y1 > 10)) { y1 = 0; y2 = 630; }
    return { x1: x1, x2: x2, y1: y1, y2: y2, bilinen: !!(s.x && s.y) };
  }
  /** Eksen neden duruyor — kımıldamamanın sebebi hep yazılı. */
  function eksenEngeli() {
    var d = D();
    if (d.acil && d.acil.acik) {
      return { engel: true, sinif: "acil",
               yazi: "acil durdurma mandallı" + (d.acil.neden ? " · " + d.acil.neden : "") };
    }
    if (!S.veri || !S.veri.bagli) return { engel: true, sinif: "yok", yazi: "ajan bağlı değil" };
    if (d.plc && d.plc !== "bagli") {
      return { engel: true, sinif: "yok",
               yazi: "PLC kopuk" + (d.hata ? " · " + String(d.hata).slice(0, 60) : "") };
    }
    if (d.enable === false) return { engel: true, sinif: "kilit", yazi: "sürücüler kapalı" };
    return { engel: false, sinif: "hazir", yazi: d.hareket ? (d.islem || "hareket ediyor") : "hazır" };
  }
  function konumVarMi() {
    var k = D().konum || {};
    return k.x != null && k.y != null;
  }
  /** Home'da mı — kalibrasyondaki home değerine oturmuşsa. */
  function homeDaMi() {
    var d = D(), k = d.konum || {}, kal = d.kalibrasyon || {};
    if (k.x == null || !kal.x) return false;
    return Math.abs(sayi(k.x) - sayi(kal.x.home)) < 1.5
        && Math.abs(sayi(k.y) - sayi((kal.y || {}).home)) < 1.5;
  }

  /* ==================================================================== *
   * İZOMETRİK GEOMETRİ
   *
   * Karo ızgarası yatağın GERÇEK koordinat uzayı: bir karo KARO_MM kadar,
   * sınırlar yumuşak eksen sınırlarından. Aşağıdaki dört dönüşüm dışında
   * hiçbir yerde elle konum hesabı yok.
   * ==================================================================== */
  var G = { tw: 40, th: 20, ox: 0, oy: 0, nx: 11, ny: 13, duvar: 60, s: null };

  function geometriKur() {
    var s = sinirAl();
    G.s = s;
    G.nx = Math.max(1, Math.round((s.x2 - s.x1) / KARO_MM));
    G.ny = Math.max(1, Math.round((s.y2 - s.y1) / KARO_MM));
    /* Elmasın kapladığı yer + ön duvar, tuvale sığacak en büyük karo. */
    var pay = 18;
    var enP = (S.en - pay * 2) / (G.nx + G.ny);
    var boyP = (S.boy - pay * 2) / ((G.nx + G.ny) * ISO_ORAN / 2 + DUVAR_ORAN * (G.nx + G.ny) / 2);
    G.tw = Math.max(14, Math.min(enP * 2, boyP * 2));
    G.th = G.tw * ISO_ORAN;
    G.duvar = Math.max(46, G.th * 3.2);
    var genis = (G.nx + G.ny) * G.tw / 2;
    var yuksek = (G.nx + G.ny) * G.th / 2 + G.duvar;
    G.ox = S.en / 2 + (G.ny - G.nx) * G.tw / 4;
    G.oy = (S.boy - yuksek) / 2;
    G.genis = genis; G.yuksek = yuksek;
  }
  /* Sürekli karo koordinatı (u = makine X yönü, v = makine Y yönü). */
  function uOf(mx) { return (sayi(mx) - G.s.x1) / KARO_MM; }
  function vOf(my) { return (sayi(my) - G.s.y1) / KARO_MM; }
  function ex(u, v) { return G.ox + (u - v) * G.tw / 2; }
  function ey(u, v) { return G.oy + (u + v) * G.th / 2; }
  /** Ekran noktasından makine koordinatına — karoya tıklamanın karşılığı. */
  function ekranMM(sx, sy) {
    var a = (sx - G.ox) / (G.tw / 2), b = (sy - G.oy) / (G.th / 2);
    var u = (a + b) / 2, v = (b - a) / 2;
    return { u: u, v: v, x: G.s.x1 + u * KARO_MM, y: G.s.y1 + v * KARO_MM };
  }
  function icerdeMi(u, v) { return u >= 0 && v >= 0 && u <= G.nx && v <= G.ny; }

  /* ==================================================================== *
   * ZEMİN KATMANI — sürülmüş toprak, yatak gövdesi, karo ızgarası.
   * Bir kez çiziliyor; kare başına tek drawImage.
   * ==================================================================== */
  function zeminKur() {
    S.zemin = document.createElement("canvas");
    S.zemin.width = S.tuval.width; S.zemin.height = S.tuval.height;
    S.zeminCt = S.zemin.getContext("2d");
    S.zeminCt.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    zeminCiz();
  }

  /* --------------------------------------------------------------- ışık
   * Sahnenin ışığı sol üstten geliyor: gölgeler sağ alta düşüyor, kenar
   * ışığı sol üstte. Tek bir yön; her gölge ve her parlama bundan
   * türüyor, tek tek elle konmuyor. */
  var ISIK = { x: -0.62, y: -0.78 };

  /** Yumuşak leke — boyanmış doku duygusu düz dolgudan böyle ayrılıyor. */
  function leke(c, x, y, rx, ry, aci, renk, guc) {
    var g = c.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0, "rgba(" + renk + "," + guc.toFixed(3) + ")");
    g.addColorStop(1, "rgba(" + renk + ",0)");
    c.save();
    c.translate(x, y); c.rotate(aci); c.scale(1, ry / Math.max(0.001, rx));
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, rx, 0, 6.3); c.fill();
    c.restore();
  }

  /** Sürülmüş tarla — çim yok, düz dolgu da yok.
   *
   * Üç katman: geniş renk dalgaları (nemli/kuru yamalar), izometrik yöne
   * paralel karıklar (her birinin üst kenarı ışıklı, alt kenarı gölgeli)
   * ve serpiştirilmiş kesek/taş. Hepsi tohumlu ve tuvalin tamamına
   * yayılıyor; hiçbir yerde tekrar eden bir blok yok. */
  function toprakZemin(c) {
    var r = uretec(90210), i;
    var g = c.createLinearGradient(0, 0, S.en * 0.35, S.boy);
    g.addColorStop(0, "#4c3826"); g.addColorStop(0.4, "#42311f");
    g.addColorStop(0.75, "#39291a"); g.addColorStop(1, "#2d2015");
    c.fillStyle = g; c.fillRect(0, 0, S.en, S.boy);

    /* Boyalı zemin: yüzlerce yumuşak fırça lekesi, ikisi aynı değil. */
    var lekeAdet = Math.round((S.en * S.boy) / 1400);
    for (i = 0; i < lekeAdet; i++) {
      var koyu = r();
      leke(c, r() * S.en, r() * S.boy, 22 + r() * 96, 10 + r() * 40, r() * 3,
        koyu < 0.42 ? "26,18,10" : (koyu < 0.8 ? "122,94,60" : "158,124,78"),
        0.05 + r() * 0.14);
    }
    /* Karıklar: pulluk izleri. Üst kenar ışıklı, alt kenar gölgeli —
       kalınlık duygusu buradan geliyor. */
    var egim = G.tw / (G.th * 2);
    var adim = Math.max(11, G.th * 0.95);
    for (var k = -S.boy * egim - 40; k < S.en + 40; k += adim) {
      var kay = (r() - 0.5) * 7, kuv = 0.6 + r() * 0.4;
      var yol = function (dy) {
        c.beginPath();
        c.moveTo(k + kay, -12 + dy);
        for (var yy = -12; yy < S.boy + 12; yy += 22) {
          c.lineTo(k + kay + yy * egim + Math.sin(yy * 0.045 + k) * 3.2, yy + dy);
        }
        c.stroke();
      };
      c.strokeStyle = "rgba(18,12,6," + (0.30 * kuv).toFixed(3) + ")";
      c.lineWidth = 2.2 + r() * 1.6; yol(0);
      c.strokeStyle = "rgba(176,142,96," + (0.13 * kuv).toFixed(3) + ")";
      c.lineWidth = 1.1; yol(-2.2);
    }
    /* Kesek: her birinin gölgesi ve ışık alan yüzü var. */
    var adet = Math.round((S.en * S.boy) / 780);
    for (i = 0; i < adet; i++) {
      var x = r() * S.en, y = r() * S.boy, cap = 1.2 + r() * 3.6, a = r() * 3;
      c.fillStyle = "rgba(16,10,5,.34)";
      c.beginPath();
      c.ellipse(x - ISIK.x * 1.6, y - ISIK.y * 1.6, cap, cap * 0.62, a, 0, 6.3);
      c.fill();
      c.fillStyle = "rgba(94,71,46,.55)";
      c.beginPath(); c.ellipse(x, y, cap, cap * 0.62, a, 0, 6.3); c.fill();
      c.fillStyle = "rgba(206,174,124,.22)";
      c.beginPath();
      c.ellipse(x + ISIK.x * cap * 0.35, y + ISIK.y * cap * 0.35,
        cap * 0.55, cap * 0.32, a, 0, 6.3);
      c.fill();
    }
    /* Taşlar: gölge + gövde + kenar ışığı. */
    for (i = 0; i < Math.round(adet / 22); i++) {
      var tx = r() * S.en, ty = r() * S.boy, tr = 2.2 + r() * 4.4, ta = r() * 3;
      c.fillStyle = "rgba(10,7,4,.45)";
      c.beginPath();
      c.ellipse(tx - ISIK.x * 2.4, ty - ISIK.y * 2.4, tr * 1.05, tr * 0.7, ta, 0, 6.3);
      c.fill();
      var tg = c.createLinearGradient(tx + ISIK.x * tr, ty + ISIK.y * tr,
        tx - ISIK.x * tr, ty - ISIK.y * tr);
      tg.addColorStop(0, "#b6ada0"); tg.addColorStop(0.55, "#8a8377"); tg.addColorStop(1, "#5f5a52");
      c.fillStyle = tg;
      c.beginPath(); c.ellipse(tx, ty, tr, tr * 0.68, ta, 0, 6.3); c.fill();
      c.strokeStyle = "rgba(24,18,12,.7)"; c.lineWidth = 1;
      c.stroke();
    }
  }

  /** Yatak — düz kutu değil: kalın kontur, kalınlıklı ön duvar, üst
   *  yüzeyde ışık, çevresine düşen gölge. */
  function yatakCiz(c) {
    var A = { x: ex(0, 0), y: ey(0, 0) };
    var B = { x: ex(G.nx, 0), y: ey(G.nx, 0) };
    var Cc = { x: ex(G.nx, G.ny), y: ey(G.nx, G.ny) };
    var Dd = { x: ex(0, G.ny), y: ey(0, G.ny) };
    var h = G.duvar, i;

    /* Yatağın toprağa düşen gölgesi — kutu havada durmuyor. */
    c.save();
    c.globalAlpha = 0.5;
    c.filter = "blur(6px)";
    c.fillStyle = "#0e0904";
    c.beginPath();
    c.moveTo(A.x - ISIK.x * 10, A.y - ISIK.y * 10 + h * 0.2);
    c.lineTo(B.x - ISIK.x * 10, B.y - ISIK.y * 10 + h * 0.2);
    c.lineTo(Cc.x - ISIK.x * 10, Cc.y - ISIK.y * 10 + h);
    c.lineTo(Dd.x - ISIK.x * 10, Dd.y - ISIK.y * 10 + h);
    c.closePath(); c.fill();
    c.filter = "none";
    c.restore();

    /* Yan duvarlar: üstte ince ışıklı pah, altta karanlık taban. */
    function duvar(p1, p2, ust, orta, alt) {
      var g = c.createLinearGradient(0, p1.y, 0, p1.y + h);
      g.addColorStop(0, ust); g.addColorStop(0.22, orta); g.addColorStop(1, alt);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y);
      c.lineTo(p2.x, p2.y + h); c.lineTo(p1.x, p1.y + h);
      c.closePath(); c.fill();
      /* tahta damarları */
      var r2 = uretec(Math.floor(p1.x * 7 + 13));
      c.save(); c.clip();
      for (var j = 0; j < 9; j++) {
        c.strokeStyle = j % 2 ? "rgba(255,224,178,.06)" : "rgba(30,18,8,.24)";
        c.lineWidth = 1 + r2() * 1.6;
        var yy = p1.y + r2() * h;
        c.beginPath();
        c.moveTo(p1.x, yy);
        var adimX = (p2.x - p1.x) / 8, adimY = (p2.y - p1.y) / 8;
        for (var q = 1; q <= 8; q++) {
          c.lineTo(p1.x + adimX * q, yy + adimY * q + Math.sin(q * 1.7 + j) * 1.6);
        }
        c.stroke();
      }
      c.restore();
      /* üst pah: kalınlık */
      c.strokeStyle = "rgba(226,186,132,.5)"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(p1.x, p1.y + 1.5); c.lineTo(p2.x, p2.y + 1.5); c.stroke();
      c.strokeStyle = "rgba(22,13,6,.95)"; c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y);
      c.lineTo(p2.x, p2.y + h); c.lineTo(p1.x, p1.y + h);
      c.closePath(); c.stroke();
    }
    duvar(Cc, B, "#7a5432", "#5d3d24", "#33200f");     /* sağ yüz  */
    duvar(Dd, Cc, "#8f6238", "#6d4826", "#3a2412");    /* ÖN YÜZ = kesit */

    /* Üst yüzey: toprak dokusu + ışık + iç gölge. */
    c.save();
    c.beginPath();
    c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.lineTo(Cc.x, Cc.y); c.lineTo(Dd.x, Dd.y);
    c.closePath();
    c.clip();
    var tg = c.createLinearGradient(A.x, A.y, Cc.x, Cc.y);
    tg.addColorStop(0, "#6a5138"); tg.addColorStop(0.55, "#5a4028"); tg.addColorStop(1, "#46301c");
    c.fillStyle = tg;
    c.fillRect(A.x - G.genis, A.y - 10, G.genis * 2 + 20, G.yuksek + 20);
    var r = uretec(4242);
    var alan = G.genis * (G.yuksek - G.duvar);
    for (i = 0; i < Math.round(alan / 900); i++) {
      var koyu2 = r();
      leke(c, A.x + (r() - 0.5) * G.genis * 1.1, G.oy + r() * (G.yuksek - G.duvar),
        14 + r() * 60, 6 + r() * 24, r() * 3,
        koyu2 < 0.45 ? "32,21,11" : "142,110,70", 0.05 + r() * 0.13);
    }
    for (i = 0; i < Math.round(alan / 260); i++) {
      var cx = A.x + (r() - 0.5) * G.genis * 1.1, cy = G.oy + r() * (G.yuksek - G.duvar);
      var cr = 1 + r() * 2.6;
      c.fillStyle = "rgba(18,11,5,.32)";
      c.beginPath(); c.ellipse(cx + 1, cy + 0.8, cr, cr * 0.6, r() * 3, 0, 6.3); c.fill();
      c.fillStyle = "rgba(178,144,98,.22)";
      c.beginPath(); c.ellipse(cx, cy, cr * 0.8, cr * 0.5, r() * 3, 0, 6.3); c.fill();
    }
    /* Tırmık izleri: yatakta karık yönü ızgarayla aynı. */
    c.strokeStyle = "rgba(20,12,6,.20)"; c.lineWidth = 1.6;
    for (i = 0; i <= G.ny * 2; i++) {
      c.beginPath();
      c.moveTo(ex(0, i / 2), ey(0, i / 2)); c.lineTo(ex(G.nx, i / 2), ey(G.nx, i / 2));
      c.stroke();
    }
    /* İÇ GÖLGE: kutunun kenarları toprağın üstüne gölge düşürüyor. */
    var ig = c.createLinearGradient(A.x, A.y, A.x, A.y + G.th * 4);
    ig.addColorStop(0, "rgba(10,6,2,.55)"); ig.addColorStop(1, "rgba(10,6,2,0)");
    c.fillStyle = ig;
    c.fillRect(A.x - G.genis, A.y - 4, G.genis * 2, G.th * 4);
    c.restore();

    /* Kalın kontur — bu sahnenin çizgi dili. */
    c.strokeStyle = "rgba(22,13,6,.95)"; c.lineWidth = 2.6;
    c.beginPath();
    c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.lineTo(Cc.x, Cc.y); c.lineTo(Dd.x, Dd.y);
    c.closePath(); c.stroke();
    c.strokeStyle = "rgba(240,206,152,.22)"; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(Dd.x, Dd.y); c.lineTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
  }

  var zeminCiz = guvenli("zemin", function () {
    var c = S.zeminCt;
    if (!c) return;
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.clearRect(0, 0, S.en, S.boy);
    toprakZemin(c);
    yatakCiz(c);
  });

  /* ==================================================================== *
   * TÜR BİÇİMLERİ — üstten siluet + kök tipi.
   *
   * Biçim bir ÖLÇÜ değil: katalog türün biçimini biliyor, boyu gerçek
   * veriden (`yaricap_mm`) geliyor. Tür tanınmıyorsa uydurma bir havuç
   * çizilmiyor — kesik çizgili jenerik öbek ve "tür tanınmadı".
   * Kök derinliği hiçbir yerde ölçülmüyor: köke milimetre yazılmıyor.
   * ==================================================================== */
  var TUR_BICIM = {
    marul: ["rozet", "sacak"], lahana: ["rozet", "sacak"], ispanak: ["rozet", "sacak"],
    pazi: ["rozet", "kazik"], roka: ["rozet", "sacak"], kereviz: ["rozet", "sacak"],
    karnabahar: ["rozet", "sacak"], brokoli: ["rozet", "sacak"], semizotu: ["rozet", "sacak"],
    havuc: ["tuy", "kazik-etli"], dereotu: ["tuy", "kazik"], maydanoz: ["tuy", "kazik"],
    sogan: ["bicak", "sogan"], sarimsak: ["bicak", "sogan"], pirasa: ["bicak", "sacak"],
    misir: ["bicak", "derin"],
    feslegen: ["cift", "sacak"], "fesleğen": ["cift", "sacak"], nane: ["cift", "sacak"],
    kekik: ["cift", "sacak"], biberiye: ["cift", "derin"],
    domates: ["genis", "derin"], biber: ["genis", "sacak"], patlican: ["genis", "derin"],
    bamya: ["genis", "kazik"], kabak: ["genis", "derin"], karpuz: ["genis", "derin"],
    kavun: ["genis", "derin"], salatalik: ["genis", "sacak"], fasulye: ["genis", "sacak"],
    bezelye: ["genis", "sacak"], nohut: ["genis", "kazik"], uzum: ["genis", "derin"],
    cilek: ["genis", "sacak"], "tatli-patates": ["genis", "yumru"], patates: ["genis", "yumru"],
    aycicegi: ["bas", "kazik"], turp: ["turp", "kazik-etli"]
  };
  var KOK_ADI = {
    kazik: "kazık kök", "kazik-etli": "etli kazık kök", sacak: "saçak kök",
    sogan: "soğan (yumru) kök", yumru: "yumru kök", derin: "derin dallı kök",
    bilinmiyor: "kök tipi bilinmiyor"
  };
  function bicimSec(b) {
    var slug = String((b && b.tur) || "").toLowerCase();
    var t = TUR_BICIM[slug];
    if (t) return { ust: t[0], kok: t[1], bilinen: true, slug: slug };
    return { ust: "bilinmiyor", kok: "bilinmiyor", bilinen: false, slug: slug };
  }
  var YESIL = { r: 111, g: 174, b: 85 };

  function yaprak(x, uz, en, ic, dis) {
    var g = x.createLinearGradient(0, -en, uz, en);
    g.addColorStop(0, ic); g.addColorStop(1, dis);
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(uz * 0.3, -en, uz * 0.78, -en * 0.82, uz, 0);
    x.bezierCurveTo(uz * 0.78, en * 0.82, uz * 0.3, en, 0, 0);
    x.fill();
    x.strokeStyle = "rgba(24,44,16,.55)"; x.lineWidth = Math.max(1, en * 0.13);
    x.stroke();
  }
  /* İzometrik sahnede bitki üstten ama YASSI görünür: sprite dikeyde
     ISO_ORAN kadar eziliyor ki karonun üstüne otursun. */
  function spriteCiz(x, bic, R, yes, tur, r) {
    var i, n, a, kat, adet;
    var koyu = ton(yes, -0.3), acik = ton(yes, 0.24);
    if (bic === "rozet") {
      for (n = 3; n >= 1; n--) {
        kat = n / 3; adet = 5 + n * 3;
        for (i = 0; i < adet; i++) {
          a = (i / adet) * Math.PI * 2 + n * 0.55 + r() * 0.18;
          x.save(); x.rotate(a);
          yaprak(x, R * kat * (0.85 + r() * 0.26), R * kat * 0.5,
            rgba(n === 1 ? acik : yes, 1), rgba(n === 3 ? koyu : yes, 1));
          x.restore();
        }
      }
      x.fillStyle = rgba(acik, 0.95);
      x.beginPath(); x.arc(0, 0, R * 0.13, 0, 6.3); x.fill();
    } else if (bic === "tuy") {
      for (i = 0; i < 22; i++) {
        a = r() * Math.PI * 2;
        var uz = R * (0.45 + r() * 0.55);
        x.strokeStyle = rgba(i % 3 ? yes : acik, 0.95);
        x.lineWidth = Math.max(1, R * 0.05); x.lineCap = "round";
        x.beginPath(); x.moveTo(0, 0);
        x.quadraticCurveTo(Math.cos(a) * uz * 0.5 + (r() - 0.5) * R * 0.25,
          Math.sin(a) * uz * 0.5, Math.cos(a) * uz, Math.sin(a) * uz);
        x.stroke();
      }
    } else if (bic === "bicak") {
      for (i = 0; i < 7; i++) {
        a = (i / 7) * Math.PI * 2 + 0.4 + r() * 0.2;
        x.save(); x.rotate(a);
        yaprak(x, R * (0.92 + r() * 0.2), R * 0.15, rgba(acik, 1), rgba(yes, 1));
        x.restore();
      }
      x.fillStyle = rgba(ton(yes, 0.4), 0.92);
      x.beginPath(); x.arc(0, 0, R * 0.2, 0, 6.3); x.fill();
    } else if (bic === "cift") {
      for (n = 2; n >= 1; n--) {
        for (i = 0; i < 4; i++) {
          a = (i / 4) * Math.PI * 2 + n * 0.78;
          x.save(); x.rotate(a); x.translate(R * 0.16 * n, 0);
          x.fillStyle = rgba(n === 1 ? yes : koyu, 0.97);
          x.beginPath();
          x.ellipse(R * 0.32 * n, 0, R * 0.34 * n, R * 0.26 * n, 0, 0, 6.3);
          x.fill();
          x.strokeStyle = "rgba(18,34,12,.8)"; x.lineWidth = Math.max(1.2, R * 0.05);
          x.stroke();
          x.strokeStyle = "rgba(190,232,160,.35)"; x.lineWidth = Math.max(0.8, R * 0.022);
          x.beginPath();
          x.moveTo(R * 0.06 * n, 0); x.lineTo(R * 0.6 * n, 0); x.stroke();
          x.restore();
        }
      }
    } else if (bic === "genis") {
      for (i = 0; i < 6; i++) {
        a = (i / 6) * Math.PI * 2 + r() * 0.3;
        var uzk = R * (0.5 + r() * 0.26);
        x.save();
        x.translate(Math.cos(a) * uzk * 0.6, Math.sin(a) * uzk * 0.6);
        x.rotate(a + (r() - 0.5) * 0.5);
        x.beginPath();
        for (var q = 0; q <= 18; q++) {
          var tq = (q / 18) * Math.PI * 2;
          var kq = R * 0.44 * (0.78 + 0.22 * Math.cos(tq * 5));
          var xq = Math.cos(tq) * kq, yq = Math.sin(tq) * kq * 0.66;
          if (q === 0) x.moveTo(xq, yq); else x.lineTo(xq, yq);
        }
        x.closePath();
        x.fillStyle = rgba(i % 2 ? yes : koyu, 0.97);
        x.fill();
        x.strokeStyle = "rgba(18,34,12,.85)"; x.lineWidth = Math.max(1.2, R * 0.045);
        x.stroke();
        x.restore();
      }
    } else if (bic === "bas") {
      for (i = 0; i < 5; i++) {
        a = (i / 5) * Math.PI * 2;
        x.save(); x.rotate(a);
        yaprak(x, R * 0.92, R * 0.36, rgba(yes, 1), rgba(koyu, 1));
        x.restore();
      }
      var tr = hexRGB((tur && tur.renk) || "#facc15");
      for (i = 0; i < 12; i++) {
        a = (i / 12) * Math.PI * 2;
        x.fillStyle = rgba(ton(tr, 0.12), 0.95);
        x.beginPath();
        x.ellipse(Math.cos(a) * R * 0.36, Math.sin(a) * R * 0.36, R * 0.2, R * 0.11, a, 0, 6.3);
        x.fill();
      }
      x.fillStyle = "rgba(74,52,30,.95)";
      x.beginPath(); x.arc(0, 0, R * 0.24, 0, 6.3); x.fill();
    } else if (bic === "turp") {
      for (i = 0; i < 9; i++) {
        a = (i / 9) * Math.PI * 2 + r() * 0.3;
        x.save(); x.rotate(a);
        yaprak(x, R * (0.78 + r() * 0.24), R * 0.44, rgba(acik, 1), rgba(yes, 1));
        x.restore();
      }
      var tk = hexRGB((tur && tur.renk) || "#fda4af");
      x.strokeStyle = rgba(tk, 0.9); x.lineWidth = Math.max(1.4, R * 0.08);
      for (i = 0; i < 5; i++) {
        a = (i / 5) * Math.PI * 2;
        x.beginPath(); x.moveTo(0, 0);
        x.lineTo(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3); x.stroke();
      }
    } else {
      x.setLineDash([Math.max(3, R * 0.16), Math.max(3, R * 0.12)]);
      x.strokeStyle = "rgba(232,226,208,.85)"; x.lineWidth = Math.max(1.4, R * 0.07);
      for (i = 0; i < 5; i++) {
        a = (i / 5) * Math.PI * 2;
        x.beginPath();
        x.ellipse(Math.cos(a) * R * 0.34, Math.sin(a) * R * 0.34, R * 0.44, R * 0.28, a, 0, 6.3);
        x.stroke();
      }
      x.setLineDash([]);
    }
  }
  function spriteAl(b) {
    var cap = sayi(b.yaricap_mm, 0) * 2 || sayi(b.yayilim_mm, 60);
    /* ÇİZİM ÇAPI ÜST SINIRLI. Gerçek yayılım (marul 250 mm) 535 mm'lik
       yatakta beş karo eder ve tahtayı yutar; siluet 1,15 karoda
       duruyor. Gerçek yayılım kaybolmuyor: seçili bitkide çember olarak
       ayrıca çiziliyor ve künyede mm olarak yazıyor. */
    var R = kis((cap / KARO_MM) * G.tw / 2, 8, G.tw * 1.15);
    var bic = bicimSec(b);
    var ah = bic.ust + "|" + (b.tur || "?") + "|" + Math.round(R) + "|" + Math.round(S.dpr * 10);
    if (S.sprite[ah]) return S.sprite[ah];
    var boy = Math.ceil(R * 2 + 8);
    var c = document.createElement("canvas");
    c.width = Math.max(2, Math.ceil(boy * S.dpr));
    c.height = Math.max(2, Math.ceil(boy * ISO_ORAN * S.dpr) + 2);
    var x = c.getContext("2d");
    x.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    x.translate(boy / 2, boy * ISO_ORAN / 2);
    x.scale(1, ISO_ORAN);                   /* üstten bakış izometrik oturuyor */
    spriteCiz(x, bic.ust, R, karis(hexRGB(b.renk || "#7bbf5a"), YESIL, 0.72), { renk: b.renk },
      uretec(Math.floor(tohum(b.tur || b.ad) * 4294967295)));
    var s = { tuval: c, en: boy, boy: boy * ISO_ORAN, R: R, bicim: bic };
    var say = 0; for (var kk in S.sprite) say++;
    if (say > 90) S.sprite = {};
    S.sprite[ah] = s;
    return s;
  }

  /* ==================================================================== *
   * NEM — ÖN DUVAR KESİTİ
   *
   * Duvar makine X'i boyunca uzanıyor; her bitki kendi X'inde bir sütun
   * bırakıyor. Duvara yakın olan (büyük Y) daha opak: önde duran önde
   * görünüyor. Dolgu = ölçülen nem (%100 yüzeyde, %0 dipte).
   * ÖLÇÜM YOKSA SÜTUN DA YOK: taralı bir oyuk var.
   * ==================================================================== */
  function nemDurum(b) {
    var o = b.su_olcum || {};
    var v = !!o.var;
    return { var: v, kendi: !!o.kendi, bayat: !!o.bayat,
             yuzde: v ? kis(sayi(o.yuzde, sayi(b.nem_yuzde, 0)), 0, 100) : null,
             uzak: sayi(o.uzak_mm, 0), yas: sayi(o.yas_sn, 0),
             esik: sayi(o.esik, 0), esikAcik: !!o.esik_acik };
  }
  var _tarama = null;
  function taramaDeseni(c) {
    if (_tarama) return _tarama;
    var t = document.createElement("canvas");
    t.width = 9; t.height = 9;
    var k = t.getContext("2d");
    k.strokeStyle = "rgba(214,198,176,.42)"; k.lineWidth = 1;
    k.beginPath();
    k.moveTo(-2, 11); k.lineTo(11, -2);
    k.moveTo(-2, 2); k.lineTo(2, -2);
    k.moveTo(7, 11); k.lineTo(11, 7);
    k.stroke();
    _tarama = c.createPattern(t, "repeat");
    return _tarama;
  }
  /** Duvarda bir bitkinin sütun merkezi ve derinliği. */
  function duvarYer(b) {
    var u = uOf(b.x);
    return { x: ex(u, G.ny), y: ey(u, G.ny), d: kis(vOf(b.y) / Math.max(1, G.ny), 0, 1) };
  }
  function kokCiz(c, kok, x, y0, gen, h, renk, opak) {
    c.save();
    c.globalAlpha = opak;
    c.translate(x, y0);
    var r = uretec(Math.floor(tohum(kok + x) * 4294967295)), i, t2, yan;
    c.strokeStyle = "rgba(226,208,176,.85)"; c.lineCap = "round";
    if (kok === "kazik-etli") {
      c.beginPath();
      c.moveTo(-gen * 0.34, 0);
      c.quadraticCurveTo(-gen * 0.2, h * 0.5, 0, h * 0.66);
      c.quadraticCurveTo(gen * 0.2, h * 0.5, gen * 0.34, 0);
      c.closePath();
      c.fillStyle = rgba(renk, 0.9); c.fill();
      c.strokeStyle = "rgba(255,255,255,.16)"; c.lineWidth = 0.8;
      for (i = 1; i <= 3; i++) {
        t2 = i / 4;
        c.beginPath();
        c.moveTo(-gen * 0.34 * (1 - t2), h * 0.66 * t2);
        c.lineTo(gen * 0.34 * (1 - t2), h * 0.66 * t2);
        c.stroke();
      }
      c.strokeStyle = "rgba(226,208,176,.7)";
    } else if (kok === "kazik") {
      c.lineWidth = Math.max(1, gen * 0.09);
      c.beginPath(); c.moveTo(0, 0);
      c.quadraticCurveTo(gen * 0.1, h * 0.5, (r() - 0.5) * gen * 0.24, h * 0.82);
      c.stroke();
    } else if (kok === "sacak") {
      for (i = 0; i < 9; i++) {
        yan = (i / 8 - 0.5) * 2;
        c.lineWidth = Math.max(0.7, gen * 0.05);
        c.beginPath(); c.moveTo(0, 0);
        c.quadraticCurveTo(yan * gen * 0.4, h * 0.18,
          yan * gen * (0.6 + r() * 0.3), h * (0.3 + r() * 0.16));
        c.stroke();
      }
    } else if (kok === "sogan") {
      c.fillStyle = rgba(renk, 0.9);
      c.beginPath(); c.ellipse(0, h * 0.14, gen * 0.38, h * 0.16, 0, 0, 6.3); c.fill();
      c.lineWidth = Math.max(0.7, gen * 0.045);
      for (i = 0; i < 7; i++) {
        yan = (i / 6 - 0.5) * 2;
        c.beginPath(); c.moveTo(yan * gen * 0.16, h * 0.3);
        c.lineTo(yan * gen * (0.3 + r() * 0.2), h * (0.42 + r() * 0.2));
        c.stroke();
      }
    } else if (kok === "yumru") {
      c.lineWidth = Math.max(0.8, gen * 0.06);
      for (i = 0; i < 4; i++) {
        yan = (i / 3 - 0.5) * 2;
        var ux = yan * gen * (0.2 + r() * 0.3), uy = h * (0.28 + r() * 0.3);
        c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(ux * 0.5, uy * 0.7, ux, uy); c.stroke();
        c.fillStyle = rgba(renk, 0.9);
        c.beginPath(); c.ellipse(ux, uy, gen * 0.14, gen * 0.1, yan * 0.4, 0, 6.3); c.fill();
      }
    } else if (kok === "derin") {
      for (i = 0; i < 3; i++) {
        yan = (i - 1) * 0.9;
        c.lineWidth = Math.max(0.9, gen * 0.07);
        c.beginPath(); c.moveTo(0, 0);
        c.quadraticCurveTo(yan * gen * 0.2, h * 0.45, yan * gen * 0.3, h * (0.72 + r() * 0.2));
        c.stroke();
      }
    } else {
      /* KÖK TİPİ BİLİNMİYOR — uydurma kök yok, kesik bir iz var. */
      c.setLineDash([3, 4]);
      c.strokeStyle = "rgba(226,214,192,.6)";
      c.lineWidth = Math.max(0.8, gen * 0.06);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, h * 0.24); c.stroke();
      c.beginPath(); c.ellipse(0, h * 0.36, gen * 0.3, h * 0.12, 0, 0, 6.3); c.stroke();
      c.setLineDash([]);
    }
    c.restore();
  }

  function kesitCiz(c) {
    var Dd = { x: ex(0, G.ny), y: ey(0, G.ny) };
    var Cc = { x: ex(G.nx, G.ny), y: ey(G.nx, G.ny) };
    var h = G.duvar;
    c.save();
    /* Kesit yalnız ön duvarın içinde. */
    c.beginPath();
    c.moveTo(Dd.x, Dd.y); c.lineTo(Cc.x, Cc.y);
    c.lineTo(Cc.x, Cc.y + h); c.lineTo(Dd.x, Dd.y + h);
    c.closePath();
    c.clip();

    /* Uzak olan önce: yakınlar üstüne biniyor. */
    var sirali = S.bitki.slice().sort(function (a, b) { return sayi(a.y) - sayi(b.y); });
    var gen = Math.max(9, G.tw * 0.62);
    sirali.forEach(function (b) {
      var p = duvarYer(b), n = nemDurum(b);
      var opak = 0.4 + p.d * 0.6;
      var seciliMi = S.secili === b.ad;
      if (seciliMi) opak = 1;
      var x = p.x, y0 = p.y;
      if (x < Dd.x - gen || x > Cc.x + gen) return;
      if (!n.var) {
        /* TARALI OYUK — bir simge değil, yokluğun kendisi. */
        c.save();
        c.globalAlpha = opak;
        c.beginPath();
        c.moveTo(x - gen / 2, y0); c.lineTo(x + gen / 2, y0);
        c.lineTo(x + gen / 2, y0 + h - 6);
        c.quadraticCurveTo(x, y0 + h, x - gen / 2, y0 + h - 6);
        c.closePath();
        c.fillStyle = "rgba(20,14,9,.55)"; c.fill();
        c.fillStyle = taramaDeseni(c); c.globalAlpha = opak * 0.7; c.fill();
        c.globalAlpha = opak;
        c.setLineDash([4, 4]);
        c.strokeStyle = "rgba(228,212,186,.6)"; c.lineWidth = 1; c.stroke();
        c.setLineDash([]);
        c.restore();
      } else {
        var rev = b._reveal === undefined ? 1 : kis(sayi(b._reveal, 1), 0, 1);
        if (rev < 1) {
          /* DÖNÜŞÜM: eski taralı oyuk soluyor, dolgu aşağıdan yukarı
             yerini alıyor. */
          c.save();
          c.globalAlpha = (1 - rev) * opak;
          c.fillStyle = "rgba(20,14,9,.55)";
          c.fillRect(x - gen / 2, y0, gen, h);
          c.fillStyle = taramaDeseni(c);
          c.fillRect(x - gen / 2, y0, gen, h);
          c.restore();
        }
        var ust = y0 + (1 - n.yuzde / 100) * h;
        var islak = { r: 58, g: 132, b: 186 }, kuru = { r: 146, g: 104, b: 58 };
        var renk = karis(kuru, islak, n.yuzde / 100);
        var kuv = (n.kendi ? 0.95 : 0.5) * (n.bayat ? 0.6 : 1) * opak;
        c.save();
        var g = c.createLinearGradient(0, ust, 0, y0 + h);
        g.addColorStop(0, rgba(ton(renk, 0.2), kuv));
        g.addColorStop(1, rgba(ton(renk, -0.3), kuv * 0.9));
        c.fillStyle = g;
        if (rev < 1) {
          var dip = y0 + h, boy2 = (dip - ust) * rev;
          c.fillRect(x - gen / 2, dip - boy2, gen, boy2);
          c.strokeStyle = "rgba(180,255,190," + (1 - rev).toFixed(2) + ")";
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(x - gen / 2, dip - boy2); c.lineTo(x + gen / 2, dip - boy2);
          c.stroke();
        } else {
          c.fillRect(x - gen / 2, ust, gen, y0 + h - ust);
        }
        c.strokeStyle = rgba(ton(renk, 0.45), kuv);
        c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(x - gen / 2, ust); c.lineTo(x + gen / 2, ust); c.stroke();
        /* Ödünç ya da bayat okuma kendi işaretiyle: kesikli üst çizgi. */
        if (!n.kendi || n.bayat) {
          c.setLineDash(n.bayat ? [5, 4] : [2, 3]);
          c.strokeStyle = "rgba(240,196,120,.9)";
          c.beginPath(); c.moveTo(x - gen / 2, ust); c.lineTo(x + gen / 2, ust); c.stroke();
          c.setLineDash([]);
        }
        if (n.esikAcik && n.esik > 0) {
          var ey2 = y0 + (1 - n.esik / 100) * h;
          c.strokeStyle = b.susadi ? "rgba(236,132,96,.95)" : "rgba(214,222,232,.4)";
          c.lineWidth = b.susadi ? 1.6 : 1;
          c.setLineDash([3, 3]);
          c.beginPath(); c.moveTo(x - gen / 2 - 3, ey2); c.lineTo(x + gen / 2 + 3, ey2); c.stroke();
          c.setLineDash([]);
        }
        c.restore();
      }
      /* SU İNİYOR — ölçüm DEĞİL. Sulama sırasında duvarda aşağı inen
         geçici bir sızma cephesi var; sütunu doldurmuyor, taralı oyuğu
         da doldurmuyor. Su verildi, nem ölçülmedi. */
      var sz = sayi(b._sizma, 0);
      if (sz > 0.02) {
        c.save();
        c.globalAlpha = opak * 0.85;
        var sg = c.createLinearGradient(0, y0, 0, y0 + h * sz);
        sg.addColorStop(0, "rgba(150,210,246,.5)");
        sg.addColorStop(1, "rgba(150,210,246,0)");
        c.fillStyle = sg;
        c.fillRect(x - gen / 2, y0, gen, h * sz);
        c.setLineDash([4, 4]);
        c.strokeStyle = "rgba(196,232,255,.9)"; c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(x - gen / 2, y0 + h * sz); c.lineTo(x + gen / 2, y0 + h * sz);
        c.stroke();
        c.setLineDash([]);
        c.restore();
      }
      /* Kök: tür biçimi, ölçü değil — mm yazılmıyor. */
      kokCiz(c, bicimSec(b).kok, x, y0 + 2, gen, h - 6,
        hexRGB(b.renk || "#c98a4a"), opak * 0.75);
      if (seciliMi) {
        c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 1.4;
        c.strokeRect(x - gen / 2, y0, gen, h);
      }
    });
    c.restore();
  }

  /* ==================================================================== *
   * HAVA — sahnenin havası GERÇEK ÖLÇÜMDEN.
   *
   * Elimizdeki kanallar bunlar, başkası yok: hava_sicaklik, hava_nem,
   * bmp_sicaklik, basinc, toprak_nem. Her tepkinin kaynağı panelde
   * yazılı; "hava neden puslu" sorusunun cevabı "hava nemi %92".
   *
   * YAĞMUR/IŞIK/RÜZGÂR SENSÖRÜ YOK. Yağmur diye bir sinyal üretmiyoruz;
   * yüksek hava nemi PUS olarak görünüyor ve adı da o. Eksiklik panelde
   * yazılı duruyor ki bilinsin.
   * ==================================================================== */
  var HAVA_TAZE_MS = 30000, EGIM_TAZE_MS = 300000;
  function havaAl() {
    if (S.havaT && Date.now() - S.havaT < HAVA_TAZE_MS) return Promise.resolve();
    S.havaT = Date.now();
    return api("/api/durum").then(function (c) {
      var o = (c && c.olcum) || {};
      S.hava = {
        sicaklik: o.hava_sicaklik == null ? (o.bmp_sicaklik == null ? null : sayi(o.bmp_sicaklik))
                                          : sayi(o.hava_sicaklik),
        nem: o.hava_nem == null ? null : sayi(o.hava_nem),
        basinc: o.basinc == null ? null : sayi(o.basinc),
        toprak: o.toprak_nem == null ? null : sayi(o.toprak_nem),
        ts: sayi(o.ts, 0)
      };
      notYaz("hava", "");
      panelYaz(); kirlet();
    }).catch(function () {
      notYaz("hava", "Ölçümler okunamadı — sahnenin havası nötr çiziliyor.");
    });
  }
  /** Basınç EĞİLİMİ ölçümden hesaplanıyor: son üç saatin eğimi (hPa/saat).
   *  Uydurma yok — iki uçtan az veri varsa eğilim YOK. */
  function egimAl() {
    if (S.egimT && Date.now() - S.egimT < EGIM_TAZE_MS) return Promise.resolve();
    S.egimT = Date.now();
    return api("/api/gecmis?dakika=180").then(function (c) {
      var ts = (c && c.ts) || [], bp = (c && c.basinc) || [], i, ilk = -1, son = -1;
      for (i = 0; i < bp.length; i++) {
        if (bp[i] == null) continue;
        if (ilk < 0) ilk = i;
        son = i;
      }
      if (ilk < 0 || son <= ilk) { S.hava.egim = null; return; }
      var sa = (sayi(ts[son]) - sayi(ts[ilk])) / 3600;
      S.hava.egim = sa > 0.25 ? (sayi(bp[son]) - sayi(bp[ilk])) / sa : null;
      panelYaz(); kirlet();
    }).catch(function () { S.hava.egim = null; });
  }
  /** 0..1 pus — yalnız hava neminden. %55 altı berrak, %95 üstü tam pus. */
  function pusGucu() {
    var n = S.hava.nem;
    if (n == null) return 0;
    return kis((n - 55) / 40, 0, 1);
  }
  /** Işık sıcaklığı: soğukta maviye, sıcakta sarıya kayan ton. */
  function isikTonu() {
    var t = S.hava.sicaklik;
    if (t == null) return { r: 255, g: 245, b: 232, guc: 0 };
    var p = kis((t - 8) / 26, 0, 1);
    return { r: Math.round(150 + p * 105), g: Math.round(190 + p * 44),
             b: Math.round(255 - p * 105), guc: 0.06 + Math.abs(p - 0.5) * 0.14 };
  }
  /** Basınç düşüyorsa gök ağırlaşıyor, yükseliyorsa açılıyor. */
  function gokAgirligi() {
    if (S.hava.egim == null) return 0;
    return kis(-S.hava.egim / 2, -1, 1);       /* -1 açık … +1 ağır */
  }
  function havaCiz(c) {
    var pus = pusGucu(), ton = isikTonu(), agir = gokAgirligi();
    if (ton.guc > 0.001) {
      c.save();
      c.globalCompositeOperation = "overlay";
      c.fillStyle = "rgba(" + ton.r + "," + ton.g + "," + ton.b + "," + ton.guc.toFixed(3) + ")";
      c.fillRect(0, 0, S.en, S.boy);
      c.restore();
    }
    if (pus > 0.02) {
      /* PUS: yağmur değil, yüksek hava nemi. Uzak köşeler daha yoğun. */
      var g = c.createLinearGradient(0, 0, 0, S.boy);
      g.addColorStop(0, "rgba(196,206,214," + (pus * 0.30).toFixed(3) + ")");
      g.addColorStop(0.6, "rgba(190,198,206," + (pus * 0.15).toFixed(3) + ")");
      g.addColorStop(1, "rgba(186,194,202," + (pus * 0.06).toFixed(3) + ")");
      c.fillStyle = g; c.fillRect(0, 0, S.en, S.boy);
    }
    var kose = 0.16 + Math.max(0, agir) * 0.22;
    var v = c.createRadialGradient(S.en / 2, S.boy * 0.42, Math.min(S.en, S.boy) * 0.34,
      S.en / 2, S.boy * 0.5, Math.max(S.en, S.boy) * 0.82);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(" + (agir > 0 ? "10,10,14," : "0,0,0,") + kose.toFixed(3) + ")");
    c.fillStyle = v; c.fillRect(0, 0, S.en, S.boy);
  }
  /** Yüzey nemi YALNIZ ÖLÇÜLEN yerde renk sürüyor. Ölçülmemiş toprak
   *  nötr kalıyor — orayı tahminle boyamak taralı oyuk kuralının
   *  ihlali olurdu. */
  function nemYuzeyCiz(c) {
    c.save();
    c.beginPath();
    c.moveTo(ex(0, 0), ey(0, 0)); c.lineTo(ex(G.nx, 0), ey(G.nx, 0));
    c.lineTo(ex(G.nx, G.ny), ey(G.nx, G.ny)); c.lineTo(ex(0, G.ny), ey(0, G.ny));
    c.closePath(); c.clip();
    S.bitki.forEach(function (b) {
      var n = nemDurum(b);
      if (!n.var || !n.kendi) return;              /* ödünç okuma yüzey boyamaz */
      var x = ex(uOf(b.x), vOf(b.y)), y = ey(uOf(b.x), vOf(b.y));
      var R = (NEM_YARICAP_MM / KARO_MM) * G.tw * 0.5;
      var guc = (0.06 + 0.26 * (n.yuzde / 100)) * (n.bayat ? 0.45 : 1);
      var g = c.createRadialGradient(x, y, 1, x, y, R);
      g.addColorStop(0, "rgba(26,17,9," + guc.toFixed(3) + ")");
      g.addColorStop(1, "rgba(26,17,9,0)");
      c.save(); c.translate(x, y); c.scale(1, ISO_ORAN); c.translate(-x, -y);
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, R, 0, 6.3); c.fill();
      c.restore();
    });
    c.restore();
  }

  /* ==================================================================== *
   * HAYAT — sahne boşta da yaşıyor.
   *
   * Buradaki hiçbir şey BİLGİ TAŞIMIYOR ve taşıyormuş gibi de durmuyor:
   * rüzgâr bir ölçüm değil (rüzgâr sensörümüz yok), o yüzden rastgele ve
   * hiçbir yerde adı geçmiyor. Yaprak salınımı, toz, otların sallanması
   * ve seçili bitkinin nefesi yalnız sahneyi canlı tutuyor.
   * Sakin modda hepsi duruyor.
   * ==================================================================== */
  function hayatKur() {
    var r = uretec(5150), i;
    S.ot = [];
    /* Yatağın çevresine, tuvalin kenarlarına yabani ot tutamları. */
    for (i = 0; i < 26; i++) {
      var x = r() * S.en, y = r() * S.boy;
      var yatakta = x > G.ox - G.genis / 2 - 30 && x < G.ox + G.genis / 2 + 30
                 && y > G.oy - 20 && y < G.oy + G.yuksek + 20;
      if (yatakta) { i--; continue; }
      S.ot.push({ x: x, y: y, boy: 7 + r() * 9, faz: r() * 6.3, n: 3 + Math.round(r() * 3),
                  ton: 92 + r() * 24 });
    }
    S.toz = [];
    for (i = 0; i < 16; i++) {
      S.toz.push({ x: r() * S.en, y: r() * S.boy, vx: 0.15 + r() * 0.4,
                   vy: (r() - 0.5) * 0.14, r: 0.6 + r() * 1.5, a: 0.08 + r() * 0.2 });
    }
    S.iz = [];
    S.ruzgar = { yon: r() * 6.3, guc: 0.35 + r() * 0.3, hYon: r() * 6.3, hGuc: 0.5 };
  }
  function hayatGuncelle(dt) {
    if (S.sakin) return;
    var hiz = 1 - pusGucu() * 0.45;              /* nemli hava ağır, hareket yavaş */
    /* Rüzgâr yavaşça sürükleniyor; ölçüm değil, o yüzden adı yok. */
    var w = S.ruzgar;
    if (Math.random() < dt * 0.25) {
      w.hYon = Math.random() * 6.3;
      w.hGuc = 0.2 + Math.random() * 0.8;
    }
    w.yon += (w.hYon - w.yon) * kis(dt * 0.4, 0, 1);
    w.guc += (w.hGuc - w.guc) * kis(dt * 0.5, 0, 1);
    var i;
    for (i = 0; i < S.toz.length; i++) {
      var t = S.toz[i];
      t.x += (t.vx + Math.cos(w.yon) * w.guc * 0.5) * dt * 26 * hiz;
      t.y += (t.vy + Math.sin(w.yon) * w.guc * 0.2) * dt * 26 * hiz;
      if (t.x > S.en + 4) { t.x = -4; t.y = Math.random() * S.boy; }
      if (t.x < -6) t.x = S.en + 4;
      if (t.y > S.boy + 4) t.y = -4;
      if (t.y < -6) t.y = S.boy + 4;
    }
    for (i = S.iz.length - 1; i >= 0; i--) {
      S.iz[i].omur -= dt;
      if (S.iz[i].omur <= 0) S.iz.splice(i, 1);
    }
  }
  function otCiz(c) {
    var w = S.ruzgar, hiz = 1 - pusGucu() * 0.45;
    for (var i = 0; i < S.ot.length; i++) {
      var o = S.ot[i];
      var sal = S.sakin ? 0
        : (Math.sin(S.t * 1.4 * hiz + o.faz) * 0.3 + Math.sin(S.t * 3.1 + o.faz) * 0.09)
          * w.guc * Math.cos(w.yon);
      c.save();
      c.translate(o.x, o.y);
      c.strokeStyle = "hsl(" + o.ton + ",30%,26%)";
      c.lineWidth = 1.3; c.lineCap = "round";
      for (var q = 0; q < o.n; q++) {
        var a = -Math.PI / 2 + (q - (o.n - 1) / 2) * 0.42 + sal;
        c.beginPath();
        c.moveTo(0, 0);
        c.quadraticCurveTo(Math.cos(a) * o.boy * 0.4, Math.sin(a) * o.boy * 0.6,
          Math.cos(a) * o.boy, Math.sin(a) * o.boy);
        c.stroke();
      }
      c.restore();
    }
  }
  function tozCiz(c) {
    for (var i = 0; i < S.toz.length; i++) {
      var t = S.toz[i];
      c.fillStyle = "rgba(238,216,178," + t.a.toFixed(2) + ")";
      c.beginPath(); c.arc(t.x, t.y, t.r, 0, 6.3); c.fill();
    }
  }
  function izCiz(c) {
    for (var i = 0; i < S.iz.length; i++) {
      var z = S.iz[i], a = kis(z.omur / z.tam, 0, 1);
      if (z.tip === "ayak") {
        c.save();
        c.globalAlpha = a * 0.55;
        c.fillStyle = "#1d1408";
        c.beginPath();
        c.ellipse(z.x, z.y, 3.4, 2.1, z.aci, 0, 6.3);
        c.fill();
        c.restore();
      } else {
        c.save();
        c.globalAlpha = a * 0.5;
        c.fillStyle = "rgba(206,178,132,1)";
        var rr = (1 - a) * 12 + 3;
        c.beginPath(); c.ellipse(z.x, z.y, rr, rr * ISO_ORAN, 0, 0, 6.3); c.fill();
        c.restore();
      }
    }
  }
  function izEkle(tip, x, y, aci) {
    S.iz.push({ tip: tip, x: x, y: y, aci: aci || 0, omur: tip === "ayak" ? 4 : 0.9,
                tam: tip === "ayak" ? 4 : 0.9 });
    if (S.iz.length > 40) S.iz.shift();
  }

  /* ==================================================================== *
   * IZGARA — sürekli görünmüyor.
   * Sürekli ızgara sahneyi tabloya çeviriyordu; yalnız imleç yataktayken
   * ya da ekim kipinde beliriyor.
   * ==================================================================== */
  function izgaraCiz(c) {
    var goster = S.tepsiTur ? 1 : (S.uzerinde ? 0.55 : 0);
    if (goster <= 0) return;
    var i;
    c.save();
    c.globalAlpha = goster;
    c.strokeStyle = "rgba(255,240,214,.16)"; c.lineWidth = 1;
    for (i = 0; i <= G.nx; i++) {
      c.beginPath(); c.moveTo(ex(i, 0), ey(i, 0)); c.lineTo(ex(i, G.ny), ey(i, G.ny)); c.stroke();
    }
    for (i = 0; i <= G.ny; i++) {
      c.beginPath(); c.moveTo(ex(0, i), ey(0, i)); c.lineTo(ex(G.nx, i), ey(G.nx, i)); c.stroke();
    }
    c.restore();
  }

  /* ==================================================================== *
   * BİTKİLER — karonun üstünde, gövdeli.
   *
   * Her bitki kendi fazında salınıyor (rüzgâr bir ölçüm değil, o yüzden
   * rastgele ve adı hiçbir yerde geçmiyor), altında yön birliği olan bir
   * gölge var, ışık tarafında ince bir kenar parlaması var. Seçili bitki
   * nefes alıyor.
   * ==================================================================== */
  function bitkiCizHepsi(c) {
    var w = S.ruzgar, hiz = 1 - pusGucu() * 0.45;
    var sirali = S.bitki.slice().sort(function (a, b) {
      return (uOf(a.x) + vOf(a.y)) - (uOf(b.x) + vOf(b.y));
    });
    sirali.forEach(function (b) {
      var u = uOf(b.x), v = vOf(b.y);
      var x = ex(u, v), y = ey(u, v);
      var sp = spriteAl(b);
      var faz = tohum(b.ad) * 6.3;
      var sal = S.sakin ? 0
        : (Math.sin(S.t * 1.15 * hiz + faz) * 0.030 + Math.sin(S.t * 2.6 + faz * 1.7) * 0.011)
          * (0.35 + w.guc * 0.9);
      var secili = S.secili === b.ad;
      /* NEFES: yalnız seçili bitkide, hafif ölçek salınımı. */
      var nefes = (secili && !S.sakin) ? 1 + Math.sin(S.t * 2.1) * 0.03 : 1;

      /* Gölge — ışık yönüne göre, hepsi aynı tarafa. */
      c.save();
      c.globalAlpha = 0.34;
      c.fillStyle = "#150d05";
      c.beginPath();
      c.ellipse(x - ISIK.x * sp.R * 0.34, y - ISIK.y * sp.R * 0.34,
        sp.R * 0.92, sp.R * 0.92 * ISO_ORAN, 0, 0, 6.3);
      c.fill();
      c.restore();

      c.save();
      c.translate(x, y);
      c.rotate(sal);
      c.scale(nefes, nefes);
      c.drawImage(sp.tuval, -sp.en / 2, -sp.boy / 2, sp.en, sp.boy);
      /* KENAR IŞIĞI: aynı siluet, ışık yönünde kaydırılıp toplanıyor. */
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.14 + (secili ? 0.06 : 0);
      c.drawImage(sp.tuval, -sp.en / 2 + ISIK.x * 2.2, -sp.boy / 2 + ISIK.y * 1.4,
        sp.en, sp.boy);
      c.restore();

      /* Sulamadan sonra yaprakta kalan damlalar. */
      var dmr = sayi(b._damlaT, 0);
      if (dmr > 0 && !S.sakin) {
        var dr = uretec(Math.floor(tohum(b.ad + "d") * 4294967295));
        c.save();
        c.globalAlpha = kis(dmr / 6, 0, 1) * 0.85;
        for (var q = 0; q < 5; q++) {
          var da = dr() * 6.3, dd = dr() * sp.R * 0.8;
          c.fillStyle = "rgba(198,232,255,.9)";
          c.beginPath();
          c.arc(x + Math.cos(da) * dd, y + Math.sin(da) * dd * ISO_ORAN, 1.4, 0, 6.3);
          c.fill();
        }
        c.restore();
      }

      /* SUSAMA toprakta halka: ölçüme dayanan tam, tahmin kesik. */
      if (b.susadi) {
        var tah = b.su_kanit !== "olculen";
        c.save();
        c.strokeStyle = "rgba(236,152,74,.92)";
        c.lineWidth = tah ? 1.2 : 2;
        c.setLineDash(tah ? [3, 5] : [7, 5]);
        c.lineDashOffset = S.sakin ? 0 : -S.t * 6;
        c.beginPath();
        c.ellipse(x, y, sp.R + 6, (sp.R + 6) * ISO_ORAN, 0, 0, 6.3);
        c.stroke();
        c.restore();
      }
      /* HASADA HAZIR ROZETİ — geri sayım yok; olgunluk bir ölçüm değil. */
      if (b.hasat) {
        var ry = y - sp.boy / 2 - 13 + (S.sakin ? 0 : Math.sin(S.t * 2 + faz) * 1.6);
        c.save();
        c.fillStyle = "rgba(16,10,4,.5)";
        c.beginPath();
        if (c.roundRect) c.roundRect(x - 11, ry - 7, 22, 17, 6); else c.rect(x - 11, ry - 7, 22, 17);
        c.fill();
        c.fillStyle = "rgba(248,200,88,.98)";
        c.beginPath();
        if (c.roundRect) c.roundRect(x - 11, ry - 9, 22, 17, 6); else c.rect(x - 11, ry - 9, 22, 17);
        c.fill();
        c.strokeStyle = "rgba(66,44,8,.95)"; c.lineWidth = 1.6; c.stroke();
        c.fillStyle = "#3a2708"; c.font = "700 11px system-ui,sans-serif";
        c.textAlign = "center"; c.fillText("✓", x, ry + 4);
        c.restore();
      }
      if (!sp.bicim.bilinen) {
        c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
        c.fillStyle = "rgba(240,186,110,.95)";
        c.fillText("tür tanınmadı", x, y + sp.boy / 2 + 11);
      }
      if (secili) {
        c.save();
        c.strokeStyle = "rgba(255,255,255,.95)"; c.lineWidth = 2;
        c.beginPath();
        c.ellipse(x, y, (sp.R + 3) * nefes, (sp.R + 3) * nefes * ISO_ORAN, 0, 0, 6.3);
        c.stroke();
        /* GERÇEK YAYILIM — siluet üst sınırlı, bu çember ölçünün kendisi. */
        var yay = sayi(b.yayilim_mm, 0);
        if (yay > 0) {
          var yr = (yay / KARO_MM) * G.tw / 2;
          c.setLineDash([5, 5]);
          c.strokeStyle = "rgba(196,226,255,.5)"; c.lineWidth = 1.2;
          c.beginPath(); c.ellipse(x, y, yr, yr * ISO_ORAN, 0, 0, 6.3); c.stroke();
          c.setLineDash([]);
        }
        var pw = duvarYer(b);
        c.setLineDash([3, 4]);
        c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, y); c.lineTo(pw.x, pw.y); c.stroke();
        c.restore();
      }
    });
  }

  /* ==================================================================== *
   * MAKİNE VE ÇİFTÇİ
   *
   * Köprü makine Y'sinde yürüyor (kısa kenarı kaplar), kızak makine
   * X'inde kayıyor — `makine.js` koordinat sözleşmesinin aynısı.
   * Çiftçi kızağın altında, yani tam makine koordinatında duruyor.
   * ==================================================================== */
  function rayYuk() { return Math.max(26, G.th * 3.4); }

  function makineCiz(c) {
    var e = eksenEngeli();
    var varMi = S.ciz.x != null;
    var RY = rayYuk();
    var solU = 0, sagU = G.nx;
    var v = varMi ? kis(vOf(S.ciz.y), 0, G.ny) : G.ny / 2;
    var A = { x: ex(solU, v), y: ey(solU, v) }, B = { x: ex(sagU, v), y: ey(sagU, v) };
    c.save();
    c.globalAlpha = e.engel ? 0.42 : 1;
    /* Köprü sütunları */
    [A, B].forEach(function (p) {
      c.fillStyle = "#8d959b";
      c.fillRect(p.x - 3, p.y - RY, 6, RY);
      c.strokeStyle = "rgba(24,28,30,.8)"; c.lineWidth = 1.4;
      c.strokeRect(p.x - 3, p.y - RY, 6, RY);
    });
    /* Kiriş */
    var g = c.createLinearGradient(0, A.y - RY - 6, 0, A.y - RY + 6);
    g.addColorStop(0, "#d3d9dc"); g.addColorStop(0.5, "#9aa1a5"); g.addColorStop(1, "#6e7478");
    c.strokeStyle = g; c.lineWidth = 7; c.lineCap = "round";
    c.beginPath(); c.moveTo(A.x, A.y - RY); c.lineTo(B.x, B.y - RY); c.stroke();
    c.strokeStyle = "rgba(24,28,30,.65)"; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(A.x, A.y - RY); c.lineTo(B.x, B.y - RY); c.stroke();
    /* Kızak */
    if (varMi) {
      var u = kis(uOf(S.ciz.x), 0, G.nx);
      var kx = ex(u, v), kyy = ey(u, v);
      c.fillStyle = "#e6eae6";
      c.beginPath();
      if (c.roundRect) c.roundRect(kx - 13, kyy - RY - 9, 26, 18, 4);
      else c.rect(kx - 13, kyy - RY - 9, 26, 18);
      c.fill();
      c.strokeStyle = "rgba(24,28,30,.85)"; c.lineWidth = 1.6; c.stroke();
      /* Z takımı: ölçülen z kadar iniyor. */
      var yuk = zYukseklik();
      var inis = (1 - yuk) * RY * 0.72;
      c.strokeStyle = "#b9c0c4"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(kx, kyy - RY + 6); c.lineTo(kx, kyy - RY + 6 + inis); c.stroke();
    }
    c.restore();
  }

  /** Ölçülen Z'nin 0..1 karşılığı: 1 = güvenli yükseklik, 0 = toprak. */
  function zYukseklik() {
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
    var yuk = sayi(t.yukari_mm, 0);
    return kis(Math.abs(sayi(t.mm) - yuk) / 55, 0, 1);
  }
  function suAkiyorMu() {
    var p = P();
    return !!(p && p.S && p.S.roleDurum && p.S.roleDurum.su_pompasi);
  }
  /** Çalışan kuyruk işi — efektlerin ve alet seçiminin kaynağı. */
  function calisanIs() {
    var k = (S.veri && S.veri.kuyruk) || {};
    var c = k.calisan;
    if (c && c.durum === "calisiyor") return c;
    return (k.isler || []).filter(function (i) { return i && i.durum === "calisiyor"; })[0] || null;
  }

  /** Çiftçi — eksenin avatarı. Yürümüyor: bildirilen konuma taşınıyor. */
  function ciftciCiz(c) {
    if (S.ciz.x == null) {
      /* Hiç konum bildirilmedi: uydurma bir yere çiftçi koymuyoruz. */
      c.save();
      c.font = "600 12px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = "rgba(226,110,96,.95)";
      c.fillText("konum bildirilmedi — çiftçi çizilemiyor", S.en / 2, S.boy * 0.5);
      c.restore();
      return;
    }
    var e = eksenEngeli();
    var u = kis(uOf(S.ciz.x), 0, G.nx), v = kis(vOf(S.ciz.y), 0, G.ny);
    var x = ex(u, v), y = ey(u, v);
    /* Konum artık bildirilmiyorsa çiftçi SON YERİNDE ve sönük duruyor. */
    if (S.konumYok) { c.save(); c.globalAlpha = 0.45; }
    var boy = Math.max(22, G.tw * 0.58);
    var yuk = zYukseklik();
    /* DURUŞ Z'DEN: uç indikçe çiftçi eğiliyor. */
    var egik = (1 - yuk);
    var is = calisanIs();
    var su = suAkiyorMu();
    var tohumDus = tUzama();
    c.save();
    c.translate(x, y);
    /* gölge */
    c.globalAlpha = 0.36;
    c.fillStyle = "#140d06";
    c.beginPath(); c.ellipse(0, 0, boy * 0.34, boy * 0.34 * ISO_ORAN, 0, 0, 6.3); c.fill();
    c.globalAlpha = 1;
    c.translate(0, -boy * 0.08);
    c.rotate(egik * 0.22);
    var w = boy * 0.30;
    /* bacaklar */
    c.strokeStyle = "#3b3730"; c.lineWidth = Math.max(2.4, boy * 0.11); c.lineCap = "round";
    c.beginPath(); c.moveTo(-w * 0.35, 0); c.lineTo(-w * 0.4, -boy * 0.34); c.stroke();
    c.beginPath(); c.moveTo(w * 0.35, 0); c.lineTo(w * 0.4, -boy * 0.34); c.stroke();
    /* gövde — makinemizin mavisi */
    c.fillStyle = "#3f78b5";
    c.beginPath();
    if (c.roundRect) c.roundRect(-w / 2, -boy * 0.74, w, boy * 0.42, w * 0.28);
    else c.rect(-w / 2, -boy * 0.74, w, boy * 0.42);
    c.fill();
    c.strokeStyle = "rgba(16,26,38,.9)"; c.lineWidth = Math.max(1.4, boy * 0.05); c.stroke();
    /* kollar: iş varsa öne uzanıyor */
    c.strokeStyle = "#3f78b5"; c.lineWidth = Math.max(2, boy * 0.09);
    var kol = is ? -0.5 : 0.1;
    c.beginPath(); c.moveTo(-w * 0.45, -boy * 0.66);
    c.lineTo(-w * 0.75, -boy * (0.5 + kol * 0.2)); c.stroke();
    c.beginPath(); c.moveTo(w * 0.45, -boy * 0.66);
    c.lineTo(w * 0.75, -boy * (0.5 + kol * 0.2)); c.stroke();
    /* baş + şapka */
    c.fillStyle = "#e8c9a0";
    c.beginPath(); c.arc(0, -boy * 0.84, boy * 0.13, 0, 6.3); c.fill();
    c.strokeStyle = "rgba(60,40,20,.85)"; c.lineWidth = Math.max(1.2, boy * 0.04); c.stroke();
    c.fillStyle = "#c98f45";
    c.beginPath(); c.ellipse(0, -boy * 0.92, boy * 0.26, boy * 0.07, 0, 0, 6.3); c.fill();
    c.beginPath(); c.arc(0, -boy * 0.96, boy * 0.12, Math.PI, 0); c.fill();
    c.strokeStyle = "rgba(70,44,16,.9)"; c.lineWidth = Math.max(1.2, boy * 0.04); c.stroke();

    /* ELDEKİ ALET — çalışan işten. Uydurma yok: iş yoksa alet de yok. */
    if (is && is.tip === "sula") {
      c.fillStyle = "#7fb4dd";
      c.beginPath();
      if (c.roundRect) c.roundRect(w * 0.6, -boy * 0.62, boy * 0.22, boy * 0.18, 3);
      else c.rect(w * 0.6, -boy * 0.62, boy * 0.22, boy * 0.18);
      c.fill();
      c.strokeStyle = "rgba(20,40,60,.85)"; c.lineWidth = 1.2; c.stroke();
    } else if (is && is.tip === "nem") {
      c.strokeStyle = "#63c46b"; c.lineWidth = Math.max(1.8, boy * 0.07);
      c.beginPath();
      c.moveTo(w * 0.72, -boy * 0.66); c.lineTo(w * 0.72, -boy * (0.2 - egik * 0.18));
      c.stroke();
    } else if (is && is.tip === "ek") {
      c.fillStyle = "#e0cf9a";
      c.beginPath(); c.arc(w * 0.75, -boy * 0.55, boy * 0.11, 0, 6.3); c.fill();
      c.strokeStyle = "rgba(70,56,20,.85)"; c.lineWidth = 1.2; c.stroke();
    }
    c.restore();

    /* SU — kaynak POMPA RÖLESİ. Komut değil, rölenin kendisi. */
    if (su) {
      c.save();
      c.strokeStyle = "rgba(150,205,240,.9)"; c.lineWidth = 2; c.lineCap = "round";
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
      c.fillStyle = "#f0e0b0";
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
      c.fillStyle = "rgba(226,110,96,.98)";
      c.fillText(e.yazi, x, y - boy * 1.25);
      c.restore();
    }
  }

  /* ==================================================================== *
   * EFEKTLER — üçü de GERÇEK ilerlemeden sürülüyor ve üçü hiç
   * birbirine benzemiyor. Sabit süreli animasyon yok: her biri kendi
   * sinyalinin açık kaldığı sürece sürüyor, sinyal kapanınca kapanış
   * oynuyor.
   *   sulama → pompa rölesi         (Panel.S.roleDurum.su_pompasi)
   *   ekim   → tohum ucunun ekseni  (durum.tohum_ucu.mm / yukari_mm)
   *   ölçüm  → SİNYAL YOK; başlatılan işten türetiliyor (yorum: plc.py'de
   *            yalnız X/Y/Z/T var, prob'un kendi ekseni ve bayrağı yok)
   * ==================================================================== */
  var NEM_BEKLEME_VARSAYILAN = 10;

  function isHedefi(is) {
    if (!is) return null;
    var adlar = is.noktalar || [];
    if (S.ciz.x == null) return null;
    for (var i = 0; i < adlar.length; i++) {
      var b = S.ix[String(adlar[i])];
      if (b && Math.hypot(sayi(b.x) - S.ciz.x, sayi(b.y) - S.ciz.y) < 70) return b;
    }
    return null;
  }
  function efektEkle(tip, ad, ek) {
    var e = { tip: tip, ad: ad, t0: S.t, t: 0 };
    if (ek) for (var k in ek) e[k] = ek[k];
    S.efekt.push(e);
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

  function efektGuncelle(dt) {
    var is = calisanIs(), kimlik = is ? String(is.kimlik) : "";
    var hedef = isHedefi(is), i;

    /* KAPANIŞ — iş çalışır durumdan çıktıysa sessizce sönmüyor. */
    for (var k in S.sonIsler) {
      if (k !== kimlik) {
        efektEkle("kapanis", S.sonIsler[k].ad || "", { etiket: S.sonIsler[k].etiket || "" });
        mesajYaz((S.sonIsler[k].etiket || "İş") + " bitti.");
        delete S.sonIsler[k];
      }
    }
    if (is) S.sonIsler[kimlik] = { ad: is.tip, etiket: is.etiket || "" };

    /* HAREKET — çiftçi yürürken ayak izi ve toz. Konum bildirilenden
       geliyor; iz de ancak gerçekten yer değiştirince düşüyor. */
    if (S.ciz.x != null) {
      if (S.sonAdim == null) S.sonAdim = { x: S.ciz.x, y: S.ciz.y };
      var d = Math.hypot(S.ciz.x - S.sonAdim.x, S.ciz.y - S.sonAdim.y);
      if (d > 26) {
        var ax = ex(uOf(S.ciz.x), vOf(S.ciz.y)), ay = ey(uOf(S.ciz.x), vOf(S.ciz.y));
        izEkle("ayak", ax + (Math.random() - 0.5) * 6, ay + 2, Math.random() * 3);
        izEkle("toz", ax, ay);
        S.sonAdim = { x: S.ciz.x, y: S.ciz.y };
      }
    }

    /* SULAMA — pompa rölesi açıkken. Nem sütununa DOKUNMUYOR. */
    var su = suAkiyorMu();
    if (is && is.tip === "sula" && su && hedef) {
      hedef._islak = kis(sayi(hedef._islak, 0) + dt / Math.max(1, sayi(hedef.sulama_saniye, 3)), 0, 1);
      hedef._islakTs = Date.now();
      hedef._damlaT = 6;
      hedef._sizma = kis(sayi(hedef._sizma, 0) + dt * 0.5, 0, 1);
      if (!S.sakin) {
        var wx = ex(uOf(hedef.x), vOf(hedef.y)), wy = ey(uOf(hedef.x), vOf(hedef.y));
        if (Math.random() < dt * 26) zerreEk(wx, wy, 1, "170,214,246", 60);
      }
    } else if (S.suSonAd && !su) {
      S.suSonAd = "";
    }
    if (su && hedef) S.suSonAd = hedef.ad;

    /* EKİM — tohum ucunun kendi ekseninden. */
    var tu = tUzama();
    if (is && is.tip === "ek" && hedef) {
      hedef._delik = Math.max(sayi(hedef._delik, 0), tu);
      if (sayi(hedef._tuOnce, 0) > 0.45 && tu < 0.2) {
        /* Uç geri çekildi: tohum bırakıldı, üstü örtülüyor. */
        hedef._hoyuk = 1;
        efektEkle("ekildi", hedef.ad);
        var ex2 = ex(uOf(hedef.x), vOf(hedef.y)), ey2 = ey(uOf(hedef.x), vOf(hedef.y));
        izEkle("toz", ex2, ey2);
      }
      hedef._tuOnce = tu;
    }

    /* NEM ÖLÇÜMÜ — sinyal yok; iş + uç konumu + Z'nin toprakta olması. */
    if (is && is.tip === "nem" && hedef && zYukseklik() < 0.12) {
      if (!hedef._probT) {
        var px2 = ex(uOf(hedef.x), vOf(hedef.y)), py2 = ey(uOf(hedef.x), vOf(hedef.y));
        izEkle("toz", px2, py2);            /* toprağa girerken kalkan toz */
      }
      hedef._probT = sayi(hedef._probT, 0) + dt;
    }

    /* Yaprak damlaları ve ıslaklık izleri sönüyor. */
    S.bitki.forEach(function (b) {
      if (sayi(b._damlaT, 0) > 0) b._damlaT = Math.max(0, b._damlaT - dt);
      if (sayi(b._sizma, 0) > 0 && !(is && is.tip === "sula" && suAkiyorMu())) {
        b._sizma = Math.max(0, b._sizma - dt * 0.35);
      }
      if (sayi(b._reveal, 0) > 0 && b._reveal < 1) b._reveal = kis(b._reveal + dt / 0.85, 0, 1);
    });
    /* Zerreler */
    for (i = S.zerre.length - 1; i >= 0; i--) {
      var z = S.zerre[i];
      z.vy += 210 * dt;
      z.x += z.vx * dt; z.y += z.vy * dt;
      z.omur -= dt;
      if (z.omur <= 0) S.zerre.splice(i, 1);
    }
    for (i = S.efekt.length - 1; i >= 0; i--) {
      S.efekt[i].t = S.t - S.efekt[i].t0;
      if (S.efekt[i].t > 1.8) S.efekt.splice(i, 1);
    }
  }

  /* ---------------------------------------------------- efektlerin çizimi */
  function suEfektiCiz(c, hedef) {
    var x = ex(uOf(hedef.x), vOf(hedef.y)), y = ey(uOf(hedef.x), vOf(hedef.y));
    var m = S.robot || S.ciz;
    var RY = rayYuk();
    var bx = ex(kis(uOf(S.ciz.x), 0, G.nx), kis(vOf(S.ciz.y), 0, G.ny));
    var by = ey(kis(uOf(S.ciz.x), 0, G.nx), kis(vOf(S.ciz.y), 0, G.ny)) - RY * 0.35;
    /* HUZME: başlıktan toprağa, kalın ve akan. */
    c.save();
    var g = c.createLinearGradient(bx, by, x, y);
    g.addColorStop(0, "rgba(186,226,252,.85)");
    g.addColorStop(1, "rgba(126,186,230,.35)");
    c.strokeStyle = g;
    c.lineWidth = 4.5; c.lineCap = "round";
    c.beginPath();
    c.moveTo(bx, by);
    c.quadraticCurveTo((bx + x) / 2 + Math.sin(S.t * 9) * 3, (by + y) / 2, x, y);
    c.stroke();
    c.strokeStyle = "rgba(240,252,255,.55)"; c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(bx, by);
    c.quadraticCurveTo((bx + x) / 2 + Math.sin(S.t * 9 + 1) * 4, (by + y) / 2, x, y);
    c.stroke();
    /* ÇARPMA halkası */
    var hr = (S.t * 2.2 % 1);
    c.strokeStyle = "rgba(198,236,255," + ((1 - hr) * 0.7).toFixed(2) + ")";
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(x, y, 6 + hr * G.tw * 0.5, (6 + hr * G.tw * 0.5) * ISO_ORAN, 0, 0, 6.3);
    c.stroke();
    c.restore();
  }
  function ekimEfektiCiz(c, hedef) {
    var x = ex(uOf(hedef.x), vOf(hedef.y)), y = ey(uOf(hedef.x), vOf(hedef.y));
    var tu = tUzama();
    /* DELİK: uç indikçe açılıyor. */
    var dr = 4 + sayi(hedef._delik, 0) * G.tw * 0.24;
    c.save();
    c.fillStyle = "rgba(16,10,4,.75)";
    c.beginPath(); c.ellipse(x, y, dr, dr * ISO_ORAN, 0, 0, 6.3); c.fill();
    c.strokeStyle = "rgba(210,176,124,.5)"; c.lineWidth = 1.4; c.stroke();
    /* TOHUM: ucun ucunda, T ekseniyle iniyor. */
    if (tu > 0.05) {
      c.fillStyle = "#f2e2b2";
      c.beginPath();
      c.ellipse(x, y - 16 + tu * 16, 2.6, 3.2, 0, 0, 6.3);
      c.fill();
      c.strokeStyle = "rgba(90,70,24,.8)"; c.lineWidth = 1; c.stroke();
    }
    c.restore();
    /* HAZNE KAPAĞI — arabanın üstünde, uç inmeden önce açık. */
    var bx = ex(kis(uOf(S.ciz.x), 0, G.nx), kis(vOf(S.ciz.y), 0, G.ny));
    var by = ey(kis(uOf(S.ciz.x), 0, G.nx), kis(vOf(S.ciz.y), 0, G.ny)) - rayYuk() - 4;
    var acik = kis(1 - tu * 2.2, 0, 1);
    c.save();
    c.fillStyle = "#8a7550";
    c.fillRect(bx - 9, by - 6, 18, 10);
    c.strokeStyle = "rgba(30,22,10,.9)"; c.lineWidth = 1.4;
    c.strokeRect(bx - 9, by - 6, 18, 10);
    c.save();
    c.translate(bx - 9, by - 6);
    c.rotate(-acik * 1.1);
    c.fillStyle = "#b39a68";
    c.fillRect(0, -3, 18, 3.5);
    c.strokeRect(0, -3, 18, 3.5);
    c.restore();
    c.restore();
  }
  function nemEfektiCiz(c, hedef) {
    var x = ex(uOf(hedef.x), vOf(hedef.y)), y = ey(uOf(hedef.x), vOf(hedef.y));
    var bek = sayi((S.veri && S.veri.nem_bekleme_sn), NEM_BEKLEME_VARSAYILAN);
    var p = kis(sayi(hedef._probT, 0) / Math.max(1, bek), 0, 1);
    var nabiz = 0.5 + Math.sin(S.t * 5) * 0.5;
    c.save();
    /* NABIZ GİBİ BEKLEYİŞ */
    c.strokeStyle = "rgba(120,214,132," + (0.25 + nabiz * 0.35).toFixed(2) + ")";
    c.lineWidth = 2;
    var rr = G.tw * (0.34 + nabiz * 0.1);
    c.beginPath(); c.ellipse(x, y, rr, rr * ISO_ORAN, 0, 0, 6.3); c.stroke();
    /* Dolma yayı: beklemenin nerede olduğunu söylüyor. */
    c.strokeStyle = "rgba(99,196,107,.95)"; c.lineWidth = 3.4; c.lineCap = "round";
    c.beginPath();
    c.ellipse(x, y, G.tw * 0.46, G.tw * 0.46 * ISO_ORAN, 0,
      -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    c.stroke();
    c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = "rgba(160,226,166,.95)";
    c.fillText("prob duruşu · işten türetildi", x, y - G.tw * 0.46 * ISO_ORAN - 9);
    c.restore();
  }
  function efektCiz(c) {
    var is = calisanIs(), hedef = isHedefi(is);
    /* Islak toprak lekesi ve ekim höyüğü — kalıcı izler. */
    S.bitki.forEach(function (b) {
      var x = ex(uOf(b.x), vOf(b.y)), y = ey(uOf(b.x), vOf(b.y));
      var w = sayi(b._islak, 0);
      if (w > 0.02) {
        var R = G.tw * (0.3 + w * 0.34);
        c.save();
        c.globalAlpha = 0.55;
        var g = c.createRadialGradient(x, y, 1, x, y, R);
        g.addColorStop(0, "rgba(24,16,8,.9)"); g.addColorStop(1, "rgba(24,16,8,0)");
        c.fillStyle = g;
        c.save(); c.translate(x, y); c.scale(1, ISO_ORAN); c.translate(-x, -y);
        c.beginPath(); c.arc(x, y, R, 0, 6.3); c.fill();
        c.restore();
        c.restore();
        /* SU VERİLDİ, NEM ÖLÇÜLMEDİ. */
        if (w > 0.15 && !nemDurum(b).var) {
          c.save();
          c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
          c.fillStyle = "rgba(202,232,255,.95)";
          c.fillText("sulandı · ölçülmedi", x, y + G.th * 1.5);
          c.restore();
        }
      }
      if (sayi(b._hoyuk, 0) > 0) {
        c.save();
        c.fillStyle = "rgba(122,94,58,.9)";
        c.beginPath(); c.ellipse(x, y, 7, 7 * ISO_ORAN, 0, 0, 6.3); c.fill();
        c.strokeStyle = "rgba(30,20,10,.7)"; c.lineWidth = 1.2; c.stroke();
        c.restore();
      }
    });
    if (hedef && is) {
      if (is.tip === "sula" && suAkiyorMu()) suEfektiCiz(c, hedef);
      else if (is.tip === "ek") ekimEfektiCiz(c, hedef);
      else if (is.tip === "nem" && sayi(hedef._probT, 0) > 0) nemEfektiCiz(c, hedef);
    }
    /* Zerreler: sıçrayan damlalar ve toz. */
    for (var i = 0; i < S.zerre.length; i++) {
      var z = S.zerre[i];
      c.fillStyle = "rgba(" + z.renk + "," + kis(z.omur / z.tam, 0, 1).toFixed(2) + ")";
      c.beginPath(); c.arc(z.x, z.y, z.r, 0, 6.3); c.fill();
    }
    /* Kapanışlar. */
    S.efekt.forEach(function (e) {
      var pr = kis(e.t / 1.4, 0, 1);
      if (e.tip === "kapanis") {
        var cx = S.ciz.x == null ? S.en / 2 : ex(uOf(S.ciz.x), vOf(S.ciz.y));
        var cy = S.ciz.x == null ? S.boy / 2 : ey(uOf(S.ciz.x), vOf(S.ciz.y));
        c.save();
        c.globalAlpha = (1 - pr) * 0.8;
        c.strokeStyle = "rgba(255,236,186,.95)"; c.lineWidth = 2.4;
        var rr = G.tw * (0.3 + pr * 1.3);
        c.beginPath(); c.ellipse(cx, cy, rr, rr * ISO_ORAN, 0, 0, 6.3); c.stroke();
        c.restore();
      } else if (e.tip === "ekildi") {
        var b2 = S.ix[e.ad];
        if (!b2) return;
        var bx2 = ex(uOf(b2.x), vOf(b2.y)), by2 = ey(uOf(b2.x), vOf(b2.y));
        c.save();
        c.globalAlpha = 1 - pr;
        c.fillStyle = "rgba(214,186,132,.9)";
        for (var q = 0; q < 6; q++) {
          var a = (q / 6) * 6.3;
          c.beginPath();
          c.arc(bx2 + Math.cos(a) * pr * 16, by2 + Math.sin(a) * pr * 16 * ISO_ORAN, 1.6, 0, 6.3);
          c.fill();
        }
        c.restore();
      }
    });
  }

  /* ==================================================================== *
   * SAHNE
   * ==================================================================== */
  function hedefKaroCiz(c) {
    if (!S.hedefKaro) return;
    var k = S.hedefKaro;
    c.save();
    c.strokeStyle = "rgba(120,200,255,.95)"; c.lineWidth = 2;
    c.setLineDash([5, 4]);
    c.lineDashOffset = -S.t * 8;
    c.beginPath();
    c.moveTo(ex(k.u, k.v), ey(k.u, k.v));
    c.lineTo(ex(k.u + 1, k.v), ey(k.u + 1, k.v));
    c.lineTo(ex(k.u + 1, k.v + 1), ey(k.u + 1, k.v + 1));
    c.lineTo(ex(k.u, k.v + 1), ey(k.u, k.v + 1));
    c.closePath(); c.stroke();
    c.restore();
  }
  function uzerindeCiz(c) {
    if (!S.uzerinde) return;
    var k = S.uzerinde;
    c.save();
    c.fillStyle = "rgba(255,244,214,.12)";
    c.beginPath();
    c.moveTo(ex(k.u, k.v), ey(k.u, k.v));
    c.lineTo(ex(k.u + 1, k.v), ey(k.u + 1, k.v));
    c.lineTo(ex(k.u + 1, k.v + 1), ey(k.u + 1, k.v + 1));
    c.lineTo(ex(k.u, k.v + 1), ey(k.u, k.v + 1));
    c.closePath(); c.fill();
    c.restore();
  }

  var sahneCiz = guvenli("sahne", function () {
    var c = S.ct;
    if (!c || !S.en || !S.boy) return;
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.clearRect(0, 0, S.en, S.boy);
    /* DEĞİŞMEYEN BÖLGE: toprak zemini, yatak gövdesi ve dokusu bir kez
       çiziliyor, kare başına tek drawImage. */
    c.drawImage(S.zemin, 0, 0, S.zemin.width, S.zemin.height, 0, 0, S.en, S.boy);
    otCiz(c);
    nemYuzeyCiz(c);
    izCiz(c);
    uzerindeCiz(c);
    izgaraCiz(c);
    hedefKaroCiz(c);
    efektCiz(c);
    bitkiCizHepsi(c);
    makineCiz(c);
    ciftciCiz(c);
    kesitCiz(c);
    if (!S.sakin) tozCiz(c);
    havaCiz(c);
  });

  /* ==================================================================== *
   * KARE DÖNGÜSÜ
   *
   * Üç hâl: SAKİN (boştaki hayat kapalı — yalnız gerçek olaylar),
   * BOŞTA HAYAT (düşük kare hızı) ve İŞ (tam hız). Sekme görünmüyorsa
   * çizim tamamen duruyor.
   * ==================================================================== */
  var HIZ_BOSTA = 13;
  function isVarMi() {
    if (S.efekt.length || S.zerre.length) return true;
    if (suAkiyorMu()) return true;
    if (D().hareket) return true;
    if (S.ciz.x != null && S.bildirilen.x != null
        && (Math.abs(S.ciz.x - S.bildirilen.x) > 0.4
            || Math.abs(S.ciz.y - S.bildirilen.y) > 0.4)) return true;
    var is = calisanIs();
    if (is) return true;
    return false;
  }
  /** 0 = dur, 1 = boştaki hayat (düşük hız), 2 = iş (tam hız). */
  function canliMi() {
    if (!S.acik || document.hidden) return 0;
    if (isVarMi()) return 2;
    if (S.sakin) return 0;
    return 1;
  }
  function isteKare() {
    if (!S.dongu && S.acik) S.dongu = requestAnimationFrame(kare);
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
    hayatGuncelle(dt);
    efektGuncelle(dt);

    /* Boştaki hayat DÜŞÜK kare hızında: Pi'de panel açık unutulduğunda
       fark buradan geliyor. */
    if (hal === 1 && sn - S.sonCizim < 1 / HIZ_BOSTA && !S.kirli) {
      S.dongu = requestAnimationFrame(kare);
      return;
    }
    S.sonCizim = sn;
    var b0 = performance.now();
    sahneCiz();
    var ms = performance.now() - b0;
    S.olcum.kare++; S.olcum.sure += ms;
    if (ms > S.olcum.enUzun) S.olcum.enUzun = ms;
    S.kirli = false;
    if (canliMi() > 0) S.dongu = requestAnimationFrame(kare);
  }

    var olcuKur = guvenli("ölçü", function () {
    var kok = $("#bh-tuval");
    if (!kok || !S.tuval) return;
    var r = kok.getBoundingClientRect();
    var en = Math.max(220, Math.round(r.width));
    var boy = Math.max(180, Math.round(r.height));
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

  /* ==================================================================== *
   * ETKİLEŞİM — karoya tıklamak GERÇEK git komutu.
   * ==================================================================== */
  function konum(e) {
    var r = S.tuval.getBoundingClientRect();
    return { x: (e.clientX - r.left) * S.en / r.width,
             y: (e.clientY - r.top) * S.boy / r.height };
  }
  function bitkiBul(p) {
    var en = null, ed = 1e9;
    S.bitki.forEach(function (b) {
      var sp = spriteAl(b);
      var x = ex(uOf(b.x), vOf(b.y)), y = ey(uOf(b.x), vOf(b.y));
      var dx = (p.x - x) / Math.max(10, sp.R), dy = (p.y - y) / Math.max(6, sp.R * ISO_ORAN);
      var d = dx * dx + dy * dy;
      if (d < 1 && d < ed) { ed = d; en = b; }
    });
    return en;
  }
  var tuvalKaydi = guvenli("gezinme", function (e) {
    var p = konum(e), m = ekranMM(p.x, p.y);
    var yeni = icerdeMi(m.u, m.v)
      ? { u: Math.floor(m.u), v: Math.floor(m.v) } : null;
    var d1 = JSON.stringify(yeni), d2 = JSON.stringify(S.uzerinde);
    if (d1 !== d2) { S.uzerinde = yeni; kirlet(); }
  });
  var tuvalCikti = guvenli("çıkış", function () {
    if (S.uzerinde) { S.uzerinde = null; kirlet(); }
  });

  var tuvalBasti = guvenli("dokunma", function (e) {
    e.preventDefault();
    var p = konum(e);
    var b = bitkiBul(p);
    if (b) {
      S.secili = (S.secili === b.ad) ? "" : b.ad;
      if (S.secili) gecmisAl(S.secili);
      panelYaz(); altYaz(); kirlet();
      return;
    }
    var m = ekranMM(p.x, p.y);
    if (!icerdeMi(m.u, m.v)) {
      S.secili = "";
      mesajYaz("Orası yatağın dışı — eksen oraya gidemez, yürünebilir alan "
        + "yumuşak eksen sınırlarıyla aynı.");
      panelYaz(); kirlet(); return;
    }
    var u = Math.floor(m.u), v = Math.floor(m.v);
    var mx = G.s.x1 + (u + 0.5) * KARO_MM, my = G.s.y1 + (v + 0.5) * KARO_MM;
    mx = kis(mx, G.s.x1, G.s.x2); my = kis(my, G.s.y1, G.s.y2);
    S.hedefKaro = { u: u, v: v, x: mx, y: my };
    if (S.tepsiTur) { ekimOnay(mx, my); return; }
    gitOnay(mx, my);
    kirlet();
  });

  function gitOnay(mx, my) {
    var e = eksenEngeli();
    if (e.engel) {
      mesajYaz("Makine hareket edemez: " + e.yazi + ". Komut gönderilmedi.");
      S.hedefKaro = null;
      return;
    }
    var yol = (S.bildirilen.x == null) ? null
      : Math.round(Math.hypot(mx - S.bildirilen.x, my - S.bildirilen.y));
    onayAc("Eksen X " + Math.round(mx) + " mm, Y " + Math.round(my) + " mm noktasına gidecek.",
      "karo " + KARO_MM + " mm · " + (yol == null ? "konum bilinmiyor" : yol + " mm yol")
        + " · çiftçi ancak makine kımıldayınca kımıldar",
      "Git", function () {
        komut("git", { x: mx, y: my }).then(function (c) {
          S.hedefKaro = null;
          if (c && c.ok === false) {
            mesajYaz("Komut reddedildi: " + (c.mesaj || "sebep bildirilmedi"));
          } else if (!c) {
            mesajYaz("Komut gönderilemedi — sunucuya ulaşılamadı.");
          } else {
            mesajYaz("Git komutu gönderildi. Çiftçi eksen kımıldayınca yürüyecek.");
          }
          kirlet();
        });
      }, function () { S.hedefKaro = null; kirlet(); });
  }

  /* ==================================================================== *
   * TOHUM TEPSİSİ — gerçek hazneler, gerçek sayılar.
   * ==================================================================== */
  function turAdi(slug) {
    var t = ((S.veri && S.veri.turler) || []).filter(function (x) { return x.slug === slug; })[0];
    return (t && t.ad) || slug || "?";
  }
  function turYayilim(slug) {
    var t = ((S.veri && S.veri.turler) || []).filter(function (x) { return x.slug === slug; })[0];
    return t ? sayi(t.yayilim_mm, 0) : 0;
  }
  function ekimDerinligi(slug) {
    var k = S.katalog || {};
    return Object.prototype.hasOwnProperty.call(k, slug) ? k[slug] : null;
  }
  function ekimUygun(slug, mx, my) {
    var yay = turYayilim(slug);
    if (yay <= 0) return { ok: false, sebep: turAdi(slug) + " için yayılım çapı yazılı değil" };
    var r = yay / 2, i;
    var alanlar = (S.veri && S.veri.alanlar) || [];
    var icinde = !alanlar.length;
    for (i = 0; i < alanlar.length; i++) {
      var a = alanlar[i];
      var x1 = Math.min(sayi(a.x1), sayi(a.x2)), x2 = Math.max(sayi(a.x1), sayi(a.x2));
      var y1 = Math.min(sayi(a.y1), sayi(a.y2)), y2 = Math.max(sayi(a.y1), sayi(a.y2));
      if (mx - r >= x1 && mx + r <= x2 && my - r >= y1 && my + r <= y2) { icinde = true; break; }
    }
    if (!icinde) return { ok: false, sebep: "dikim alanının dışında" };
    for (i = 0; i < S.bitki.length; i++) {
      var b = S.bitki[i];
      var br = sayi(b.yayilim_mm, sayi(b.yaricap_mm, 30) * 2) / 2;
      if (Math.hypot(sayi(b.x) - mx, sayi(b.y) - my) < r + br) {
        return { ok: false, sebep: b.ad + " ile çakışıyor" };
      }
    }
    return { ok: true, sebep: "" };
  }
  function ekimOnay(mx, my) {
    var slug = S.tepsiTur;
    var d = ekimUygun(slug, mx, my);
    if (!d.ok) { mesajYaz("Buraya ekilemez — " + d.sebep); S.hedefKaro = null; kirlet(); return; }
    var der = ekimDerinligi(slug);
    onayAc(turAdi(slug) + " buraya ekilecek.",
      "X " + Math.round(mx) + " mm · Y " + Math.round(my) + " mm · yayılım "
        + Math.round(turYayilim(slug)) + " mm · "
        + (der == null ? "ekim derinliği bilinmiyor" : Math.round(der) + " mm derine")
        + " · geri alınamaz",
      "Ek", function () {
        gonder("/api/bahce/ek", { tur: slug, yerler: [{ x: mx, y: my }] })
          .then(function () {
            S.tepsiTur = ""; S.hedefKaro = null;
            mesajYaz("Nokta yaratıldı, ekim kuyruğa girdi.");
            tepsiYaz();
            return veriYukle();
          })
          .catch(function (h) {
            S.hedefKaro = null;
            mesajYaz("Ekilemedi: " + ((h && h.message) || h));
          });
      }, function () { S.hedefKaro = null; kirlet(); });
  }
  var tepsiYaz = guvenli("tepsi", function () {
    var kok = $("#bh-tepsi");
    if (!kok) return;
    var gozler = (S.veri && S.veri.hazne_gozleri) || [];
    if (!gozler.length) {
      kok.innerHTML = '<div class="bh-tepsi-bos">Hazne gözleri okunamıyor — '
        + "makine tohumu nereden alacağını bildirmiyor.</div>";
      return;
    }
    kok.innerHTML = '<span class="bh-tepsi-bas">Tohum tepsisi</span>'
      + gozler.map(function (g) {
        var dolu = !!g.dolu, slug = String(g.tohum || "");
        return '<button type="button" class="bh-goz' + (dolu ? "" : " bos")
          + (S.tepsiTur && S.tepsiTur === slug ? " secili" : "") + '"'
          + ' data-bh="goz" data-goz="' + kacisli(String(g.ad || "")) + '"'
          + ' data-tur="' + kacisli(slug) + '"' + (dolu ? "" : " disabled")
          + ' title="' + (dolu ? kacisli(turAdi(slug)) : "bu gözde tohum yok") + '">'
          + '<span class="bh-goz-ad">' + kacisli(dolu ? turAdi(slug) : "boş") + "</span>"
          + '<span class="bh-goz-alt">' + kacisli(String(g.ad || ""))
          + (dolu && turYayilim(slug) ? " · " + Math.round(turYayilim(slug)) + " mm" : "")
          + "</span></button>";
      }).join("")
      + (S.tepsiTur
        ? '<span class="bh-tepsi-not">' + kacisli(turAdi(S.tepsiTur))
          + " seçildi — ekmek için bir karoya dokun.</span>"
        : '<span class="bh-tepsi-not">Bir göz seç, sonra karoya dokun.</span>');
  });

  /* ==================================================================== *
   * GÖREV PANELİ — sunucunun kartları, tek sütun.
   * ==================================================================== */
  function acikKartlar() {
    var k = ((S.veri && S.veri.kartlar) || []).slice();
    k.sort(function (a, b) { return (a.ertelendi ? 1 : 0) - (b.ertelendi ? 1 : 0); });
    return k;
  }
  function nemYazi(b) {
    var n = nemDurum(b);
    if (!n.var) return { yazi: "nem ölçülmedi", sinif: "yok" };
    var y = "%" + Math.round(n.yuzde);
    if (n.bayat) return { yazi: y + " · sulamadan önceki okuma", sinif: "bayat" };
    if (!n.kendi) return { yazi: y + " · " + Math.round(n.uzak) + " mm öteden ödünç", sinif: "odunc" };
    return { yazi: y + " · " + sureKisa(n.yas) + " önce ölçüldü", sinif: "olculdu" };
  }
  var panelYaz = guvenli("panel", function () {
    var kok = $("#bh-panel");
    if (!kok) return;
    var e = eksenEngeli(), bagli = !e.engel;
    var v = S.veri || {}, eo = v.ekim || {};
    var h = [];

    h.push('<div class="bh-p-makine ' + e.sinif + '"><b>' + kacisli(e.yazi) + "</b>"
      + (konumVarMi()
        ? '<span>X ' + Math.round(sayi((D().konum || {}).x)) + " · Y "
          + Math.round(sayi((D().konum || {}).y))
          + (homeDaMi() ? " · home" : "") + "</span>"
        : "<span>konum bildirilmiyor</span>") + "</div>");

    /* HAVANIN KAYNAĞI OKUNABİLİR. "Hava neden puslu" sorusunun cevabı
       burada duruyor; ayrıca OLMAYAN sensörler de yazılı. */
    var pus = pusGucu(), hv = S.hava, olculu = 0;
    S.bitki.forEach(function (bb) {
      var nn = nemDurum(bb);
      if (nn.var && nn.kendi) olculu++;
    });
    h.push('<div class="bh-p-hava"><span class="bas">Sahnenin havası</span><ul>'
      + "<li>" + (hv.nem == null ? '<i class="yok">hava nemi okunmadı</i>'
        : (pus > 0.35 ? "pus" : "berrak") + " · hava nemi %" + Math.round(hv.nem)) + "</li>"
      + "<li>" + (hv.sicaklik == null ? '<i class="yok">sıcaklık okunmadı</i>'
        : "ışık " + (hv.sicaklik >= 24 ? "sıcak" : (hv.sicaklik <= 14 ? "serin" : "ılık"))
          + " · " + hv.sicaklik.toFixed(1) + " °C") + "</li>"
      + "<li>" + (hv.egim == null
        ? '<i class="yok">basınç eğilimi için yeterli ölçüm yok</i>'
        : "gök " + (hv.egim < -0.2 ? "ağır" : (hv.egim > 0.2 ? "açık" : "durgun"))
          + " · basınç " + (hv.egim > 0 ? "+" : "") + hv.egim.toFixed(1) + " hPa/sa") + "</li>"
      + "<li>yüzey nemi <b>" + olculu + "</b> bitkide ölçülü · ölçülmeyen toprak nötr</li>"
      + '<li class="yok">yağmur, ışık ve rüzgâr sensörü yok</li>'
      + "</ul></div>");

    if (eo.aktif) {
      h.push('<div class="bh-p-ekim"><b>🌱 Ekim sürüyor'
        + (sayi(eo.toplam, 0) ? " · " + sayi(eo.sira, 0) + "/" + sayi(eo.toplam, 0) : "")
        + (eo.tur_ad ? " · " + kacisli(eo.tur_ad) : "") + "</b>"
        + (eo.soru ? "<p>" + kacisli(eo.soru) + '</p><button type="button" class="asil"'
          + ' data-bh="ekim-onay"' + (bagli ? "" : " disabled") + ">Devam et</button>" : "")
        + "</div>");
    }

    var b = S.ix[S.secili];
    if (b) {
      var n = nemYazi(b), bic = bicimSec(b);
      var yas = Math.round(sayi(b.yas_gun, 0)), olgun = Math.round(sayi(b.olgun_gun, 0));
      h.push('<div class="bh-p-bitki"><div class="bh-p-bas">'
        + '<span class="bh-p-simge">' + kacisli(b.simge || "🌱") + "</span>"
        + '<span class="bh-p-ad">' + kacisli(b.ad) + "</span>"
        + '<span class="bh-p-tur">' + kacisli(b.tur_ad || b.tur || "") + "</span></div>"
        + '<ul class="bh-p-olcu">'
        + '<li class="' + n.sinif + '">' + kacisli(n.yazi) + "</li>"
        + "<li>" + yas + " günlük"
        /* GERİ SAYIM YOK: olgunluk bir ölçüm değil, türün katalog değeri. */
        + (olgun ? " · hasada yaklaşık " + Math.max(0, olgun - yas) + " gün" : "") + "</li>"
        + (b.susadi ? '<li class="susadi">susadı · '
          + (b.su_kanit === "olculen" ? "ölçüme göre" : "geçen güne göre (tahmin)") + "</li>" : "")
        + (b.hasat ? '<li class="hasat">hasada hazır</li>' : "")
        + '<li class="sonuk">' + kacisli(KOK_ADI[bic.kok] || KOK_ADI.bilinmiyor)
        + (bic.bilinen ? " · tür biçimi, ölçülmedi" : "") + "</li>"
        + (bic.bilinen ? "" : '<li class="susadi">tür tanınmadı — jenerik biçim</li>')
        + (S.gecmis && S.gecmis.egilim
          ? "<li>" + S.gecmis.egilim.adet + " ölçüm · "
            + (sayi(S.gecmis.egilim.degisim) > 0 ? "+" : "")
            + sayi(S.gecmis.egilim.degisim).toFixed(1) + " puan</li>"
          : (S.gecmis && S.gecmis.adet === 1 ? '<li class="sonuk">tek ölçüm — eğilim yok</li>' : ""))
        + "</ul>"
        + '<div class="bh-p-dugme">'
        + '<button type="button" data-bh="sula"' + (bagli ? "" : " disabled") + ">Sula</button>"
        + '<button type="button" data-bh="olc"' + (bagli ? "" : " disabled") + ">Nemini ölç</button>"
        + '<button type="button" data-bh="git"' + (bagli ? "" : " disabled") + ">Üstüne git</button>"
        + '<button type="button" data-bh="birak" class="sade">Bırak</button></div></div>');
    }

    var kartlar = acikKartlar();
    h.push('<div class="bh-p-baslik">Görevler</div>');
    if (!kartlar.length) {
      h.push('<p class="bh-p-bos">' + (S.veri ? "Bugün bekleyen iş yok." : "Bahçe okunuyor…") + "</p>");
    }
    kartlar.forEach(function (k, i) {
      h.push('<div class="bh-kart' + (k.ertelendi ? " ertelendi" : "") + '" data-ix="' + i + '">'
        + '<div class="bh-kart-bas">' + kacisli(k.simge || "") + " "
        + kacisli(k.baslik || "") + "</div>"
        + (k.aciklama ? '<p class="bh-kart-ac">' + kacisli(k.aciklama) + "</p>" : "")
        + (k.kanit ? '<span class="bh-kanit' + (k.tahmin ? " tahmin" : "") + '">'
          + (k.tahmin ? "tahmin · " : "ölçüm · ") + kacisli(k.kanit) + "</span>" : "")
        + (k.ertelendi
          ? '<div class="bh-kart-dip"><span>' + kacisli(k.ertelendi_yazi || "ertelendi")
            + '</span><button type="button" data-bh="ertele-iptal" data-ix="' + i
            + '">geri al</button></div>'
          : '<div class="bh-kart-dip">'
            + '<button type="button" data-bh="ertele" data-ix="' + i + '">yarın sor</button>'
            + '<button type="button" class="asil" data-bh="kart-evet" data-ix="' + i + '"'
            + ((k.tip !== "ek" && !bagli) ? " disabled" : "") + ">"
            + kacisli(k.evet || "Yap") + "</button></div>")
        + "</div>");
    });
    kok.innerHTML = h.join("");
  });

  /* ------------------------------------------------------------- alt şerit */
  var altYaz = guvenli("alt şerit", function () {
    var kok = $("#bh-alt");
    if (!kok) return;
    if (S.onay) {
      kok.dataset.kip = "onay";
      kok.innerHTML = '<div class="bh-a-metin"><b>' + kacisli(S.onay.metin) + "</b>"
        + '<span class="bh-a-alt">' + kacisli(S.onay.alt || "") + "</span></div>"
        + '<div class="bh-a-dugme"><button type="button" data-bh="onay-hayir">Vazgeç</button>'
        + '<button type="button" class="asil" data-bh="onay-evet">'
        + kacisli(S.onay.evet || "Onayla") + "</button></div>";
      return;
    }
    kok.dataset.kip = "bos";
    var e = eksenEngeli();
    kok.innerHTML = '<div class="bh-a-metin"><span class="bh-a-alt'
      + (S.mesaj ? " vurgu" : "") + '">'
      + kacisli(S.mesaj || (e.engel
        ? "Eksen duruyor: " + e.yazi + " — karoya dokunmak komut gönderir, çiftçi ancak makine kımıldarsa yürür."
        : "Bir karoya dokun: eksen oraya gider, çiftçi onunla yürür. Bitkiye dokun: künyesi sağda açılır."))
      + "</span></div>";
  });
  function onayAc(metin, alt, evet, fn, iptal) {
    S.onay = { metin: metin, alt: alt, evet: evet, fn: fn, iptal: iptal };
    altYaz(); kirlet();
  }
  function onayKapat() { S.onay = null; altYaz(); kirlet(); }

  /* ==================================================================== *
   * İŞLER
   * ==================================================================== */
  function isGonder(tip, adlar, ek) {
    var e = eksenEngeli();
    if (e.engel) { mesajYaz("İş başlatılamaz: " + e.yazi); return Promise.resolve(null); }
    var govde = { tip: tip, noktalar: adlar || [] };
    if (ek) for (var k in ek) govde[k] = ek[k];
    if (!govde.noktalar.length) { mesajYaz("Hedef nokta yok — iş gönderilmedi."); return Promise.resolve(null); }
    return gonder("/api/bahce/is", govde)
      .then(function () { gunluk("bahçe: " + tip + " · " + govde.noktalar.length + " bitki"); return veriYukle(); })
      .catch(function (h) { mesajYaz("İş sıraya girmedi: " + ((h && h.message) || h)); return null; });
  }
  var eylemErtele = guvenli("ertele", function (kimlik, iptal) {
    gonder("/api/bahce/ertele", { kimlik: kimlik, iptal: !!iptal })
      .then(function () { return veriYukle(); })
      .catch(function (h) { mesajYaz("Erteleme olmadı: " + ((h && h.message) || h)); });
  });
  var katalogAl = guvenli("katalog", function () {
    if (S.katalogT && Date.now() - S.katalogT < 600000) return Promise.resolve();
    return api("/api/turler").then(function (c) {
      var k = {};
      (c.turler || []).forEach(function (t) {
        if (!t || !t.slug) return;
        k[String(t.slug)] = (t.sow_depth_mm == null || t.sow_depth_mm === "")
          ? null : sayi(t.sow_depth_mm, 0);
      });
      S.katalog = k; S.katalogT = Date.now();
      notYaz("katalog", "");
    }).catch(function () {
      S.katalog = S.katalog || {};
      notYaz("katalog", "Tür kataloğu okunamadı — ekim derinliği bilinmiyor.");
    });
  });
  var gecmisAl = guvenli("geçmiş", function (ad) {
    if (!ad || (S.gecmisAd === ad && Date.now() - S.gecmisT < 20000)) return;
    S.gecmisAd = ad; S.gecmisT = Date.now(); S.gecmis = null;
    api("/api/bitki").then(function (c) {
      if (S.gecmisAd !== ad) return;
      var e = (c.ek || {})[ad];
      S.gecmis = e ? { adet: (e.gecmis || []).length, egilim: e.egilim || null } : { adet: 0, egilim: null };
      panelYaz();
    }).catch(function () { notYaz("gecmis", "Nem geçmişi okunamadı."); });
  });

  /* ==================================================================== *
   * BAĞLAMA
   * ==================================================================== */
  var tiklama = guvenli("düğme", function (e) {
    var d = e.target.closest("[data-bh]");
    if (!d) return;
    var ad = d.dataset.bh, b = S.ix[S.secili];
    var kartlar = acikKartlar(), k = kartlar[sayi(d.dataset.ix, -1)];
    if (ad === "onay-evet") { var fn = S.onay && S.onay.fn; onayKapat(); if (fn) fn(); }
    else if (ad === "onay-hayir") { var ip = S.onay && S.onay.iptal; onayKapat(); if (ip) ip(); }
    else if (ad === "goz") {
      var tur = d.dataset.tur || "";
      S.tepsiTur = (S.tepsiTur === tur) ? "" : tur;
      S.secili = "";
      mesajYaz(S.tepsiTur ? turAdi(S.tepsiTur) + " seçildi — bir karoya dokun." : "");
      tepsiYaz(); panelYaz();
    } else if (ad === "birak") { S.secili = ""; panelYaz(); kirlet(); }
    else if (ad === "sula" && b) {
      onayAc(b.ad + " " + sayi(b.sulama_saniye, 3).toFixed(1) + " saniye sulanacak.",
        "süre bitkinin kendi ayarından · geri alınamaz · sulamadan sonra nem ölçümü BAYATLAR",
        "Sula", function () { isGonder("sula", [b.ad]); });
    } else if (ad === "olc" && b) {
      onayAc("Prob " + b.ad + " toprağına daldırılıp nem ölçülecek.",
        "ölçümden sonra taralı oyuk gerçek dolguya döner", "Ölç",
        function () { isGonder("nem", [b.ad]); });
    } else if (ad === "git" && b) {
      onayAc("Eksen " + b.ad + " üstüne gidecek.",
        "X " + Math.round(sayi(b.x)) + " mm · Y " + Math.round(sayi(b.y)) + " mm",
        "Git", function () { isGonder("gez", [b.ad]); });
    } else if (ad === "ertele" && k) { eylemErtele(k.kimlik, false); }
    else if (ad === "ertele-iptal" && k) { eylemErtele(k.kimlik, true); }
    else if (ad === "ekim-onay") {
      gonder("/api/bahce/onay", {}).then(function () { return veriYukle(); })
        .catch(function (h) { mesajYaz("Onay geçmedi: " + ((h && h.message) || h)); });
    } else if (ad === "kart-evet" && k) {
      var adlar = (k.noktalar || []).map(String);
      if (k.tip === "sula") {
        onayAc(adlar.length + " bitki sulanacak.",
          "süre her bitkinin kendi ayarından · geri alınamaz · ölçümler bayatlar", "Sula",
          function () { isGonder("sula", adlar); });
      } else if (k.tip === "nem") {
        onayAc(adlar.length + " bitkinin toprağına prob daldırılacak.",
          "ölçümden sonra ekran tahmin etmeyi bırakır", "Ölç",
          function () { isGonder("nem", adlar); });
      } else if (k.tip === "hasat") {
        onayAc(adlar.length + " bitkinin üstüne gidilip fotoğraf çekilecek.", "geri alınabilir",
          "Çek", function () { isGonder("foto", adlar); });
      } else if (k.tip === "ek") {
        mesajYaz("Ekmek için alttaki tepsiden bir göz seç, sonra bir karoya dokun.");
      }
    }
  });

  var olaylariBagla = guvenli("bağlama", function () {
    S.tuval.addEventListener("pointerdown", tuvalBasti);
    S.tuval.addEventListener("pointermove", tuvalKaydi);
    S.tuval.addEventListener("pointerleave", tuvalCikti);
    $("#bh-kok").addEventListener("click", tiklama);
    $("#bh-sakin").addEventListener("click", function () {
      S.sakin = !S.sakin;
      var s = $("#bh-sakin");
      s.setAttribute("aria-pressed", S.sakin ? "true" : "false");
      s.textContent = S.sakin ? "sakin mod açık" : "sakin mod";
      /* SAKİN MOD: efektler susuyor, sahne son hâliyle duruyor. Bilgi
         durmuyor — sayılar güncellenmeye devam ediyor. */
      if (S.sakin) S.efekt = [];
      kirlet();
    });
    document.addEventListener("keydown", function (e) {
      if (!S.acik) return;
      if (e.key !== "Escape") return;
      if (S.onay) { var ip = S.onay.iptal; onayKapat(); if (ip) ip(); return; }
      if (S.tepsiTur) { S.tepsiTur = ""; tepsiYaz(); mesajYaz(""); return; }
      if (S.secili) { S.secili = ""; panelYaz(); kirlet(); }
    });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) kirlet(); });
    window.addEventListener("resize", olcuKur);
  });

  /* ==================================================================== *
   * VERİ
   * ==================================================================== */
  function bitkileriHazirla() {
    var v = S.veri || {}, eski = S.ix;
    S.bitki = (v.bitkiler || []).filter(function (b) { return b && b.ad != null; });
    S.ix = {};
    S.bitki.forEach(function (b) {
      var e = eski[String(b.ad)];
      if (e) {
        b._islak = e._islak; b._islakTs = e._islakTs;
        b._probT = e._probT; b._probVar = e._probVar;
        b._hoyuk = e._hoyuk; b._delik = e._delik;
        b._damlaT = e._damlaT; b._sizma = e._sizma; b._reveal = e._reveal;
        /* ÖLÇÜM GELDİ: taralı oyuk gerçek dolguya DÖNÜŞÜYOR. Oyunun en
           tatmin edici anı bu; sessizce yer değiştirmiyor, siliniyor. */
        if (!nemDurum(e).var && nemDurum(b).var) {
          b._reveal = 0.001;
          b._probT = 0;
          efektEkle("olcum", String(b.ad));
          mesajYaz(b.ad + " ölçüldü — taralı oyuk gerçek dolguya döndü.");
        }
        /* Sunucu okumayı bayat işaretlediyse ıslaklık izi görevini bitirdi. */
        if ((b.su_olcum || {}).bayat) b._islak = 0;
      }
      if (sayi(b._islakTs, 0) && Date.now() - b._islakTs > 180000) b._islak = 0;
      S.ix[String(b.ad)] = b;
    });
    if (S.secili && !S.ix[S.secili]) S.secili = "";
  }
  var veriYukle = guvenli("veri", function () {
    if (S.yukleniyor) return Promise.resolve();
    S.yukleniyor = true;
    return api("/api/bahce").then(function (c) {
      S.veri = c || {};
      bitkileriHazirla();
      geometriKur();
      zeminCiz();
      notYaz("veri", "");
      katalogAl();
      havaAl();
      egimAl();
      panelYaz(); tepsiYaz(); altYaz(); kirlet();
    }).catch(function (h) {
      hataYaz("veri", h);
      notYaz("veri", "Bahçe okunamadı — sunucu yanıt vermedi.");
    }).then(function () { S.yukleniyor = false; });
  });

  /* ==================================================================== *
   * KURULUM VE DIŞ ARAYÜZ
   * ==================================================================== */
  var kuruldu = false;
  var kur = guvenli("kurulum", function () {
    if (kuruldu) return true;
    S.tuval = $("#bh-sahne");
    if (!S.tuval || !S.tuval.getContext) {
      hataYaz("kurulum", new Error("tuval bulunamadı"));
      return false;
    }
    S.ct = S.tuval.getContext("2d");
    olaylariBagla();
    kuruldu = true;
    return true;
  });
  var sayacId = 0;
  function sayacKur(acik) {
    if (sayacId) { clearInterval(sayacId); sayacId = 0; }
    if (acik) sayacId = setInterval(function () { if (S.acik) veriYukle(); }, 30000);
  }

  var dis = {
    sekme: function (acik) {
      S.acik = !!acik;
      document.body.classList.toggle("bahce-acik", S.acik);
      sayacKur(S.acik);
      if (!S.acik) {
        if (S.dongu) { cancelAnimationFrame(S.dongu); S.dongu = 0; }
        return;
      }
      if (!kur()) return;
      requestAnimationFrame(function () {
        olcuKur();
        veriYukle();
        /* Panel açılırken elde durum paketi olabilir; hemen bağla. */
        if (P().S && P().S.durum) dis.durumDegisti(P().S.durum);
      });
    },
    /* Kamera karesi bu sekmede yok. */
    kareGeldi: function () { /* boş — bilerek */ },
    /** TEK KONUM KAYNAĞI. 3B sahnenin robotu da bu paketten besleniyor. */
    durumDegisti: function (d) {
      if (!d) return;
      S.durum = d;
      var k = d.konum || {};
      if (k.x != null && k.y != null) {
        S.bildirilen = { x: sayi(k.x), y: sayi(k.y), z: k.z == null ? null : sayi(k.z),
                         t: (d.tohum_ucu || {}).mm };
      } else {
        /* PLC kopuk: yeni konum yok. Çiftçi SON BİLİNEN yerinde DURUYOR —
           silinmiyor, tahminle de ilerlemiyor. Hiç konum gelmediyse
           çizilecek dürüst bir yer yok ve bunu sahnede yazıyoruz. */
        S.bildirilen.z = null; S.bildirilen.t = null;
        S.konumYok = true;
      }
      if (k.x != null) S.konumYok = false;
      if (!S.acik) return;
      if (S.veri) S.veri.bagli = d.bagli !== undefined ? !!d.bagli : S.veri.bagli;
      panelYaz(); altYaz(); kirlet();
    },
    kuyrukDegisti: function (kk) {
      if (!S.acik) return;
      S.veri = S.veri || {};
      if (kk) S.veri.kuyruk = kk;
      panelYaz();
      veriYukle();
    },
    ekimDegisti: function () { if (S.acik) veriYukle(); },
    baglandi: function () { if (S.acik) veriYukle(); },
    yenile: function () { return veriYukle(); },
    /** Kare süresi ölçümü. */
    olcum: function (sifirla) {
      var o = S.olcum;
      var c = { kare: o.kare, ortalama: o.kare ? +(o.sure / o.kare).toFixed(2) : 0,
                enUzun: +o.enUzun.toFixed(2), bitki: S.bitki.length,
                en: S.en, boy: S.boy, dpr: S.dpr, karo: KARO_MM,
                izgara: G.nx + "x" + G.ny, sakin: S.sakin };
      if (sifirla) { o.kare = 0; o.sure = 0; o.enUzun = 0; }
      return c;
    }
  };
  return dis;
}());
