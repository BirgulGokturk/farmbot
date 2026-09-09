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
 * IZGARA ÖLÇÜ TAŞIYOR, KADRAJ İÇERİĞE GÖRE
 * ---------------------------------------------------------------------
 * Kadraj dikili bitkilerin EKRANDA kapladığı kutudan türüyor: boş yatak
 * ekranı yemiyor, bitki eklenip silindikçe kadraj yumuşakça uyarlanıyor.
 * Kullanıcı tekerlek/sürükleme/iki parmakla kendi kadrajını kurduysa
 * otomatik kadraj SUSUYOR; çift tıklama onu geri açıyor. Zoom yalnız
 * kamerayı değiştiriyor, sahneyi yeniden kurmuyor — zemin tuvali ölçek
 * fazla sapana kadar blit ediliyor (tarla.js'teki `ustCerceve` dersi).
 * Karolar uydurma değil: yatağın gerçek koordinat uzayı, yumuşak eksen
 * sınırlarından (`durum.sinirlar`) geliyor ve bir karo KARO_MM kadar.
 * Karoya tıklamak o karonun merkez koordinatına gerçek `git` komutu
 * göndermek demek. Komut reddedilirse çiftçi hiç adım atmamış olur ve
 * sebep alt şeritte yazar.
 *
 * ---------------------------------------------------------------------
 * ÖLÇÜLMEMİŞ, ÖLÇÜLMÜŞ GİBİ GÖRÜNMEZ
 * ---------------------------------------------------------------------
 * Nem her bitkinin KENDİ KAROSUNDA, sığ bir oyukta. Ölçüm varsa oyuk
 * ölçülen ORANDA doluyor (alan = oran; hiçbir yere mm yazılmıyor),
 * ölçüm yoksa oyuk TARALI ve boş — simge değil, yokluğun kendisi.
 * Sulama bir oyuğu DOLDURMUYOR: su verildi, nem ölçülmedi. Ödünç ya da
 * bayat okuma soluk ve kesik çemberli.
 *   Ön duvar kesiti KALDIRILDI: yatağın toprak derinliği hiçbir yerde
 *   ölçülmüyor, o duvar ölçülmemiş bir uzunluğu ölçülmüş gibi
 *   gösteriyordu.
 *
 * ---------------------------------------------------------------------
 * SAHNE OYNATILABİLİR
 * ---------------------------------------------------------------------
 * Tekerlek yakınlaştırıyor (imlecin altındaki karo yerinde kalıyor),
 * sürükleme kaydırıyor, telefonda iki parmak yakınlaştırıp kaydırıyor,
 * çift tıklama kadrajı içeriğe geri döndürüyor. Yakınlaştırma sınırlı:
 * en geniş hâl bütün yatak, en dar hâl ekran eninde üç karo.
 *
 * ---------------------------------------------------------------------
 * PANEL BİR KOMUTA PANELİ
 * ---------------------------------------------------------------------
 * Seçili bitkide sula / nemini ölç / üstüne git / yakından bak (makineli
 * işler; makine kopuksa kapalı ve SEBEBİ yazılı) ve hasat / taşı (KAYIT
 * işleri; sunucu tarafında makine kımıldamıyor, o yüzden kopukken de
 * açık). Panel ile sahne birbirini işaret ediyor: panelde imlecin
 * altındaki bitki sahnede parlıyor, sahnedeki bitki panelde.
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
 * Toprak zemini ayrı tuvale bir KEZ çiziliyor; yalnız kadraj kıpırdayınca
 * yenileniyor. Boşta kare yok: hiçbir şey değişmiyorsa döngü dönmüyor.
 */
window.Bahce = (function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var P = function () { return window.Panel || {}; };

  var KARO_MM = 50;              /* bir karo kaç mm — ızgara ölçü taşıyor */
  var ISO_ORAN = 0.5;            /* izometrik: karo yüksekliği / genişliği */

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
    /* vurgu: sahnede imlecin altındaki bitki (panelde parlar).
       vurguListe: panelde imlecin altındaki kartın bitkileri (sahnede parlar).
       tasiKip: taşınmayı bekleyen bitkinin adı. */
    vurgu: "", vurguListe: [], tasiKip: "", halkaAd: "",
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
   * İZOMETRİK GEOMETRİ, KADRAJ VE KAMERA
   *
   * Karo ızgarası yatağın GERÇEK koordinat uzayı: bir karo KARO_MM kadar,
   * sınırlar yumuşak eksen sınırlarından. Kamera bunu bozmuyor: yalnız
   * hangi parçasına, ne büyüklükte baktığımızı değiştiriyor.
   *
   * KAMERA = {cu, cv, tw}. cu/cv tuvalin ortasındaki karo noktası, tw bir
   * karonun piksel eni. Üç dönüşüm (ex, ey, ekranMM) yalnız bunlardan
   * türüyor; başka hiçbir yerde elle konum hesabı yok.
   *
   * KADRAJ İÇERİĞE GÖRE: hedef, dikili bitkilerin EKRANDA kapladığı
   * kutudan hesaplanıyor (karo dikdörtgeninden değil — elmas iz düşümde
   * dikdörtgen kadraj ekranın yarısını boşa harcıyordu). Kullanıcı elle
   * yakınlaştırdıysa otomatik kadraj susuyor; çift tıklama onu geri açar.
   * ==================================================================== */
  var G = { tw: 40, th: 20, ox: 0, oy: 0, nx: 11, ny: 13, s: null,
            kam: null, hedef: null, elle: false, kayiyor: false };
  var PAY_X = 16, PAY_UST = 46, PAY_ALT = 22;

  /* Yatağın kenar kalınlığı: ÖLÇÜ DEĞİL, çizim kuralı. Toprak derinliği
     hiçbir yerde ölçülmüyor — o yüzden burada içi görünen bir kesit
     duvarı yok, yalnız karonun yüksekliğine bağlı ince bir kenar var. */
  function kenarKal() { return Math.max(3, G.th * 0.5); }

  /* Elmas iz düşümün birim eksenleri: ekran x = ox + X*tw,
     ekran y = oy + Y*tw*ISO_ORAN. Kadraj hesabı burada yapılıyor. */
  function Xof(u, v) { return (u - v) / 2; }
  function Yof(u, v) { return (u + v) / 2; }

  function serbestEn() { return Math.max(80, S.en - PAY_X * 2); }
  function serbestBoy() { return Math.max(80, S.boy - PAY_UST - PAY_ALT); }

  /** En geniş hâl: bütün yatak ekrana sığıyor. Yakınlaştırma alt sınırı. */
  function twEnAz() {
    var X1 = Xof(0, G.ny), X2 = Xof(G.nx, 0);
    var Y1 = Yof(0, 0), Y2 = Yof(G.nx, G.ny);
    return Math.min(serbestEn() / Math.max(0.5, X2 - X1),
                    serbestBoy() / Math.max(0.5, (Y2 - Y1) * ISO_ORAN));
  }
  /** En dar hâl: ekran eninde yaklaşık üç karo. */
  function twEnCok() { return Math.max(twEnAz() * 1.2, serbestEn() / 3); }

  /** Dikili bitkilerin EKRANDA kapladığı kutudan kadraj.
   *  Ölçü kaynağı: bitkinin makine koordinatı ve katalogdan yayilim_mm. */
  function kadrajHesap() {
    var X1 = 1e9, Y1 = 1e9, X2 = -1e9, Y2 = -1e9, say = 0;
    S.bitki.forEach(function (b) {
      if (b.x == null || b.y == null) return;
      var u = uOf(b.x), v = vOf(b.y);
      var r = kis(sayi(b.yayilim_mm, 90) / 2 / KARO_MM, 0.45, 2.5);
      var X = Xof(u, v), Y = Yof(u, v);
      if (X - r < X1) X1 = X - r;
      if (X + r > X2) X2 = X + r;
      if (Y - r < Y1) Y1 = Y - r;
      if (Y + r > Y2) Y2 = Y + r;
      say++;
    });
    if (!say) {
      /* Hiç bitki yok: bütün yatak kadraja giriyor. */
      return { cu: G.nx / 2, cv: G.ny / 2, tw: twEnAz() };
    }
    var pay = 0.6;
    X1 -= pay; X2 += pay; Y1 -= pay; Y2 += pay;
    var tw = Math.min(serbestEn() / Math.max(0.5, X2 - X1),
                      serbestBoy() / Math.max(0.5, (Y2 - Y1) * ISO_ORAN));
    var X = (X1 + X2) / 2, Y = (Y1 + Y2) / 2;
    return { cu: X + Y, cv: Y - X, tw: kis(tw, twEnAz(), twEnCok()) };
  }

  /** Kamerayı yataktan kaçmayacak biçimde sınırla. */
  function kameraKirp(k) {
    k.tw = kis(k.tw, twEnAz(), twEnCok());
    /* Merkez yatağın yarım karo dışına kadar gidebiliyor: kullanıcı kenarı
       görebilsin ama tarlayı ekrandan kaçıramasın. */
    k.cu = kis(k.cu, -0.5, G.nx + 0.5);
    k.cv = kis(k.cv, -0.5, G.ny + 0.5);
    return k;
  }

  /** Kameradan çizim değişkenleri. Zoom/kaydırma YALNIZ burayı çağırıyor. */
  function kameraUygula() {
    var k = G.kam;
    G.tw = k.tw; G.th = k.tw * ISO_ORAN;
    G.ox = S.en / 2 - Xof(k.cu, k.cv) * G.tw;
    G.oy = (PAY_UST + S.boy - PAY_ALT) / 2 - Yof(k.cu, k.cv) * G.th;
  }

  function geometriKur() {
    var s = sinirAl();
    G.s = s;
    G.nx = Math.max(1, Math.round((s.x2 - s.x1) / KARO_MM));
    G.ny = Math.max(1, Math.round((s.y2 - s.y1) / KARO_MM));
    G.hedef = kadrajHesap();
    if (!G.kam) G.kam = { cu: G.hedef.cu, cv: G.hedef.cv, tw: G.hedef.tw };
    if (G.elle) kameraKirp(G.kam);       /* tuval boyu değiştiyse sınır da değişti */
    kameraUygula();
  }

  /** Kadraj hedefe yumuşakça kayıyor. Elle yakınlaştırma varsa otomatik
   *  kadraj susuyor. Döndürdüğü değer "kamera kıpırdadı" demek. */
  function kameraGuncelle(dt) {
    if (!G.kam || !G.hedef || G.elle) return false;
    var k = kis(dt * 3.2, 0, 1), oyn = 0, a, n, alan = ["cu", "cv", "tw"];
    for (var i = 0; i < alan.length; i++) {
      n = alan[i];
      a = G.hedef[n] - G.kam[n];
      if (Math.abs(a) > (n === "tw" ? 0.06 : 0.002)) { G.kam[n] += a * k; oyn = 1; }
      else G.kam[n] = G.hedef[n];
    }
    if (oyn) kameraUygula();
    return !!oyn;
  }

  /** Bir EKRAN noktasını sabit tutarak yakınlaştır — imlecin altındaki
   *  karo imlecin altında kalıyor. */
  function yakinlastir(carpan, sx, sy) {
    var once = ekranMM(sx, sy);
    G.elle = true;
    G.kam.tw = kis(G.kam.tw * carpan, twEnAz(), twEnCok());
    kameraUygula();
    var sonra = ekranMM(sx, sy);
    G.kam.cu += once.u - sonra.u;
    G.kam.cv += once.v - sonra.v;
    kameraKirp(G.kam);
    kameraUygula();
  }
  /** Ekranda dx/dy piksel kaydır. */
  function kaydir(dx, dy) {
    G.elle = true;
    /* Ekran kaymasının karo karşılığı: elmas iz düşümün tersi. */
    var a = -dx / (G.tw / 2), b = -dy / (G.th / 2);
    G.kam.cu += (a + b) / 2;
    G.kam.cv += (b - a) / 2;
    kameraKirp(G.kam);
    kameraUygula();
  }
  /** Kadrajı içeriğe geri döndür (çift tıklama / çift dokunma). */
  function kadrajaDon() {
    G.elle = false;
    G.hedef = kadrajHesap();
    /* Çift dokunuşun İLK dokunuşu bir karo onayı açmış olabilir; kullanıcı
       kadrajı sıfırlamak istedi, komut göndermek değil. */
    if (S.onay && S.hedefKaro) { var ip = S.onay.iptal; onayKapat(); if (ip) ip(); }
    mesajYaz("Kadraj bitkilere geri döndü.");
    kirlet();
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
   * ZEMİN KATMANI — karo karo boyanmış tarla.
   *
   * Işık tek yönden: sol üst. Bütün gölgeler sağ alta düşüyor.
   * Bir kez çiziliyor; kadraj kıpırdamadıkça kare başına tek drawImage.
   * ==================================================================== */
  var ISIK = { x: -0.62, y: -0.78 };
  var P_DIS1 = "#241a2c", P_DIS2 = "#120d18";
  var P_TOPRAK = "#c58a50", P_TOPRAK2 = "#a26833", P_KARIK = "#7b4820";
  var P_KENAR = "#93582a", P_KENAR2 = "#4e2c11";
  var P_CIZGI = "#2b1508";

  /* ZEMİN TUVALİ GÖRÜNTÜDEN BÜYÜK ÇİZİLİYOR (ZEMIN_PAY kadar).
     Sebep: yakınlaştırma ve kaydırma sırasında zemini her karede yeniden
     çizmek Pi'de en pahalı iş olurdu. Elmas iz düşüm tw'de doğrusal
     olduğu için zemin, çizildiği andaki geometrinin ölçek + öteleme
     dönüşümüyle blit ediliyor; yeniden çizim ancak görüntü zeminin
     dışına taşınca ya da ölçek fazla sapıp bulanıklaşınca gerekiyor.
     (tarla.js'teki ders: tekerlek olayları tek rAF'ta toplanır ve
     yalnız KAMERA güncellenir, sahne yeniden kurulmaz.) */
  var ZEMIN_PAY = 1.4;
  var Z0 = null;                 /* zeminin çizildiği andaki geometri */

  function zeminKur() {
    S.zemin = document.createElement("canvas");
    S.zemin.width = Math.round(S.en * ZEMIN_PAY * S.dpr);
    S.zemin.height = Math.round(S.boy * ZEMIN_PAY * S.dpr);
    S.zeminCt = S.zemin.getContext("2d");
    Z0 = null;
    zeminCiz();
  }
  /** Zeminin şu anki kameraya göre blit dönüşümü.
   *  `zorla` (hareket sürerken) doğruysa kapsama ve keskinlik denetimi
   *  atlanıyor: hareket bitene kadar zemin YENİDEN ÇİZİLMİYOR, altta düz
   *  renk duruyor. Ölçülen sebep: 24 bitkilik sahnede zemini her zoom
   *  adımında çizmek kareyi 60 ms'ye çıkarıyordu. */
  function zeminDonusum(zorla) {
    if (!Z0) return null;
    var k = G.tw / Z0.tw;
    var e = G.ox - k * Z0.ox - k * Z0.padX;
    var f = G.oy - k * Z0.oy - k * Z0.padY;
    var w = k * S.en * ZEMIN_PAY, h = k * S.boy * ZEMIN_PAY;
    if (zorla) return { k: k, e: e, f: f, w: w, h: h };
    if (k < 0.62 || k > 1.7) return null;              /* fazla saptı: keskinlik gider */
    if (e > 0.5 || f > 0.5 || e + w < S.en - 0.5 || f + h < S.boy - 0.5) return null;
    return { k: k, e: e, f: f, w: w, h: h };
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

  var zeminCiz = guvenli("zemin", function () {
    var c = S.zeminCt;
    if (!c || !G.s) return;
    var padX = S.en * (ZEMIN_PAY - 1) / 2, padY = S.boy * (ZEMIN_PAY - 1) / 2;
    Z0 = { ox: G.ox, oy: G.oy, tw: G.tw, padX: padX, padY: padY };
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.clearRect(0, 0, S.en * ZEMIN_PAY, S.boy * ZEMIN_PAY);
    /* Görüntü, zemin tuvalinin ortasında duruyor. */
    c.translate(padX, padY);

    /* SAHNE DIŞI: koyu, sakin bir zemin. Tarlanın kendisi buradan
       ayrılsın diye — eskiden ekranın tamamı aynı kahverengiydi.
       Payın dışı da boyanıyor: kaydırırken kenarda boşluk kalmasın. */
    var d = c.createRadialGradient(S.en / 2, S.boy * 0.44, Math.min(S.en, S.boy) * 0.2,
      S.en / 2, S.boy * 0.5, Math.max(S.en, S.boy) * 0.8);
    d.addColorStop(0, P_DIS1); d.addColorStop(1, P_DIS2);
    c.fillStyle = d;
    c.fillRect(-padX, -padY, S.en * ZEMIN_PAY, S.boy * ZEMIN_PAY);
    var r = uretec(90210), i;
    for (i = 0; i < 46; i++) {
      var lx = -padX + r() * S.en * ZEMIN_PAY, ly = -padY + r() * S.boy * ZEMIN_PAY,
          lr = 30 + r() * 90;
      var lg = c.createRadialGradient(lx, ly, 0, lx, ly, lr);
      lg.addColorStop(0, "rgba(120,96,140,.055)");
      lg.addColorStop(1, "rgba(120,96,140,0)");
      c.fillStyle = lg;
      c.beginPath(); c.arc(lx, ly, lr, 0, 6.3); c.fill();
    }

    var kal = kenarKal();
    /* Tarlanın düşen gölgesi — kutu havada durmuyor. */
    c.save();
    c.globalAlpha = 0.55; c.fillStyle = "#0a0710";
    tarlaYol(c, kal * 1.7); c.fill();
    c.restore();

    /* KENAR: yalnız öne bakan iki yüz, ince. Kesit değil, kalınlık. */
    function kenar(p1, p2, ust, alt) {
      var g = c.createLinearGradient(0, p1.y, 0, p1.y + kal);
      g.addColorStop(0, ust); g.addColorStop(1, alt);
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y);
      c.lineTo(p2.x, p2.y + kal); c.lineTo(p1.x, p1.y + kal);
      c.closePath(); c.fill();
    }
    var Bp = { x: ex(G.nx, 0), y: ey(G.nx, 0) };
    var Cp = { x: ex(G.nx, G.ny), y: ey(G.nx, G.ny) };
    var Dp = { x: ex(0, G.ny), y: ey(0, G.ny) };
    kenar(Cp, Bp, P_KENAR, P_KENAR2);
    kenar(Dp, Cp, P_KENAR, P_KENAR2);

    /* KARO KARO TOPRAK: her karonun kendi tonu ve kendi karığı var.
       Tek büyük dolgu yerine bu — ızgara görünmese de yüzey okunuyor. */
    var r2 = uretec(4242);
    c.save();
    tarlaYol(c); c.clip();
    for (var v = 0; v < G.ny; v++) {
      for (var u = 0; u < G.nx; u++) {
        var mx = ex(u + 0.5, v + 0.5), my = ey(u + 0.5, v + 0.5);
        /* Görüntünün dışındaki karo çizilmiyor — ama zemin tuvali
           görüntüden ZEMIN_PAY kadar büyük, kırpma da o sınırdan. */
        if (mx < -padX - G.tw || mx > S.en + padX + G.tw
            || my < -padY - G.tw || my > S.boy + padY + G.tw) {
          r2(); r2(); continue;
        }
        var t = r2();
        karoYol(c, u, v);
        /* Ton farkı KÜÇÜK: karolar tahta parkeye benzemesin, tek bir
           sürülmüş yüzeyin içindeki dalgalanma gibi dursun. */
        c.fillStyle = t < 0.4 ? P_TOPRAK2 : P_TOPRAK;
        c.fill();
        /* Karık: yön karodan karoya değişiyor — pulluk düz gitmiyor. */
        var yon = ((u * 7 + v * 13) % 3) === 0;
        c.strokeStyle = "rgba(58,28,8,.22)";
        c.lineWidth = Math.max(1, G.th * 0.08);
        for (var q = 1; q <= 2; q++) {
          var f = q / 3 + (r2() - 0.5) * 0.08;
          c.beginPath();
          if (yon) {
            c.moveTo(ex(u + f, v), ey(u + f, v));
            c.lineTo(ex(u + f, v + 1), ey(u + f, v + 1));
          } else {
            c.moveTo(ex(u, v + f), ey(u, v + f));
            c.lineTo(ex(u + 1, v + f), ey(u + 1, v + f));
          }
          c.stroke();
        }
        /* Kesek: az ve iri, her birinin gölgesi var. */
        if (r2() < 0.3) {
          var kx = ex(u + 0.2 + r2() * 0.6, v + 0.2 + r2() * 0.6);
          var ky = ey(u + 0.2 + r2() * 0.6, v + 0.2 + r2() * 0.6);
          var kr = Math.max(1.4, G.tw * (0.035 + r2() * 0.04));
          c.fillStyle = "rgba(38,18,6,.42)";
          c.beginPath(); c.ellipse(kx + 1.2, ky + 0.9, kr, kr * 0.62, 0, 0, 6.3); c.fill();
          c.fillStyle = "rgba(226,178,124,.5)";
          c.beginPath(); c.ellipse(kx, ky, kr, kr * 0.62, 0, 0, 6.3); c.fill();
        }
      }
    }
    /* Geniş lekeler: karo sınırlarını yumuşatıyor, yüzey tek parça
       sürülmüş toprak gibi okunuyor. */
    var lekeAdet = Math.round(kis((G.nx * G.ny) * 1.4, 40, 180));
    for (var q2 = 0; q2 < lekeAdet; q2++) {
      var pu = r2() * G.nx, pv = r2() * G.ny;
      var px = ex(pu, pv), py = ey(pu, pv);
      var pr = G.tw * (0.5 + r2() * 1.4);
      var koyu = r2() < 0.5;
      var pg = c.createRadialGradient(px, py, 0, px, py, pr);
      pg.addColorStop(0, koyu ? "rgba(76,40,12,.16)" : "rgba(238,196,142,.13)");
      pg.addColorStop(1, "rgba(0,0,0,0)");
      c.save();
      c.translate(px, py); c.scale(1, ISO_ORAN); c.translate(-px, -py);
      c.fillStyle = pg;
      c.beginPath(); c.arc(px, py, pr, 0, 6.3); c.fill();
      c.restore();
    }
    /* Tek yönlü ışık: sol üst aydınlık, sağ alt gölgeli. */
    var ig = c.createLinearGradient(ex(0, 0), ey(0, 0), ex(G.nx, G.ny), ey(G.nx, G.ny));
    ig.addColorStop(0, "rgba(255,232,190,.20)");
    ig.addColorStop(0.5, "rgba(255,232,190,0)");
    ig.addColorStop(1, "rgba(24,10,2,.30)");
    c.fillStyle = ig;
    c.fillRect(-padX, -padY, S.en * ZEMIN_PAY, S.boy * ZEMIN_PAY);
    c.restore();

    /* KALIN KONTUR — sahnenin çizgi dili. */
    c.lineJoin = "round";
    c.strokeStyle = P_CIZGI; c.lineWidth = Math.max(2.4, G.th * 0.16);
    tarlaYol(c); c.stroke();
    c.strokeStyle = "rgba(255,226,178,.30)"; c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(Dp.x, Dp.y); c.lineTo(ex(0, 0), ey(0, 0)); c.lineTo(Bp.x, Bp.y);
    c.stroke();
    c.strokeStyle = P_CIZGI; c.lineWidth = Math.max(1.8, G.th * 0.11);
    c.beginPath();
    c.moveTo(Bp.x, Bp.y + kal); c.lineTo(Cp.x, Cp.y + kal); c.lineTo(Dp.x, Dp.y + kal);
    c.stroke();
  });

  /* ==================================================================== *
   * AİLE TABLOSU — YEDEK YOL, artık birincil değil.
   *
   * Bu tablo 37 türü 5 üst biçime indiriyor; kimlik için tek başına
   * yetmiyordu (marul, roka ve semizotu aynı "rozet"ten geçiyordu).
   * Türün kendi çizicisi varsa `TUR_CIZER` kazanıyor; bu tablo yalnız
   * çizicisi olmayan türler için ve HER TÜRDE kök tipi için okunuyor.
   *
   * Biçim bir ÖLÇÜ değil: katalog türün biçimini biliyor, boyu gerçek
   * veriden (`yaricap_mm`) geliyor. Tür tabloda hiç yoksa uydurma bir
   * havuç çizilmiyor — kesik çizgili jenerik öbek ve "tür tanınmadı".
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
    /* `ozel`: türün KENDİ çizicisi var mı. Aile (t) yedek yol. */
    if (t) return { ust: t[0], kok: t[1], bilinen: true, slug: slug,
                    ozel: !!TUR_CIZER[slug] };
    return { ust: "bilinmiyor", kok: "bilinmiyor", bilinen: false, slug: slug,
             ozel: false };
  }
  var YESIL = { r: 104, g: 168, b: 72 };
  var KONTUR = "rgba(20,42,14,.95)";
  /* Bu yarıçapın altında hiçbir siluet okunmuyor — yaprak sayısı, kenar
     biçimi, hepsi tek bir yeşil lekeye dönüşüyor. Çizim tabanı, ölçü
     iddiası değil. */
  var OKUNUR_TABAN = 13;

  /** Tek yaprak: dolu gövde, KALIN koyu kontur, sol üst ışık dilimi.
   *  Kontur bu sahnenin çizim dili — siluet uzaktan da okunuyor. */
  function yaprak(x, uz, en, ic, dis) {
    var g = x.createLinearGradient(0, -en, uz, en);
    g.addColorStop(0, ic); g.addColorStop(1, dis);
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(uz * 0.3, -en, uz * 0.78, -en * 0.82, uz, 0);
    x.bezierCurveTo(uz * 0.78, en * 0.82, uz * 0.3, en, 0, 0);
    x.fillStyle = g; x.fill();
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.4, en * 0.22);
    x.lineJoin = "round"; x.stroke();
    /* ışık dilimi: yaprağın sol üst yarısı */
    x.save(); x.clip();
    x.fillStyle = "rgba(214,246,168,.26)";
    x.beginPath();
    x.moveTo(0, 0); x.quadraticCurveTo(uz * 0.5, -en * 0.85, uz, 0);
    x.quadraticCurveTo(uz * 0.5, -en * 0.2, 0, 0);
    x.fill();
    x.restore();
    x.strokeStyle = "rgba(24,50,16,.5)"; x.lineWidth = Math.max(0.8, en * 0.09);
    x.beginPath(); x.moveTo(uz * 0.06, 0); x.lineTo(uz * 0.9, 0); x.stroke();
  }
  /** Bir halka yaprak. Yaprağın uzunluk/genişlik oranı ve sayısı biçimi
   *  ayırıyor — aynı halka rozet, bıçak ve turpta çok farklı duruyor. */
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
  /** KÖK OMUZU — havuç, turp, soğan gibi türlerde toprağın üstünde
   *  GERÇEKTEN görünen kısım: kökün tepesi. Yapraktan ayrı çiziliyor ki
   *  havuç havuca, turp turpa benzesin. Bir DERİNLİK iddiası değil:
   *  yalnız omuz, ve hiçbir yere mm yazılmıyor. */
  function omuz(x, R, renk, cap, yarik) {
    var g = x.createRadialGradient(-R * cap * 0.3, -R * cap * 0.3, R * cap * 0.1, 0, 0, R * cap);
    g.addColorStop(0, rgba(ton(renk, 0.35), 1));
    g.addColorStop(1, rgba(ton(renk, -0.2), 1));
    x.beginPath(); x.arc(0, 0, R * cap, 0, 6.3);
    x.fillStyle = g; x.fill();
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.4, R * 0.055); x.stroke();
    if (yarik) {
      x.strokeStyle = "rgba(255,255,255,.3)"; x.lineWidth = Math.max(0.8, R * 0.022);
      for (var i = 0; i < 3; i++) {
        x.beginPath();
        x.arc(0, 0, R * cap * (0.3 + i * 0.24), 0.6, 2.4);
        x.stroke();
      }
    }
  }

  /* ==================================================================== *
   * TÜRE ÖZEL SİLUETLER — BİRİNCİL YOL.
   *
   * `TUR_BICIM` bir AİLE tablosu: 37 tür, 5 üst biçim. Marul, roka ve
   * semizotu aynı "rozet" fonksiyonundan geçiyordu; havuçla maydanoz aynı
   * "tüy"den. Ekranda üç tür tek türe benziyordu.
   *
   * Artık önce `TUR_CIZER`e bakılıyor: türün kendi çizicisi varsa o
   * çiziliyor. Aile YEDEK yol — çizicisi olmayan türler eski biçimlerini
   * kullanmaya devam ediyor, tabloda hiç olmayan tür ise jenerik kesik
   * çizgili öbek + "tür tanınmadı" (uydurma havuç yok).
   *
   * FİDEYKEN DE OKUNSUN: bu bahçedeki bitkiler 7 günlük ve yaricap_mm 15.
   * O yüzden ayırt edici şey yaprak SAYISI, KENAR BİÇİMİ, DURUŞ ve TON —
   * boyut değil. Her çizici az sayıda ve iri parça kullanıyor; kontur
   * kalınlığı yarıçapa göre değil, en az 1,5 piksel.
   * ==================================================================== */

  /** Kıvrımlı (dalgalı) kenarlı yaprak — marulun kenarı bu, rokanın değil. */
  function yaprakDalgali(x, uz, en, ic, dis, dalga) {
    var q, t2, k, xx, yy;
    x.beginPath();
    for (q = 0; q <= 26; q++) {
      t2 = q / 26;
      k = Math.sin(t2 * Math.PI) * en * (1 + Math.sin(t2 * Math.PI * dalga) * 0.22);
      xx = uz * t2; yy = -k;
      if (q === 0) x.moveTo(xx, yy); else x.lineTo(xx, yy);
    }
    for (q = 26; q >= 0; q--) {
      t2 = q / 26;
      k = Math.sin(t2 * Math.PI) * en * (1 + Math.sin(t2 * Math.PI * dalga + 1.7) * 0.22);
      x.lineTo(uz * t2, k);
    }
    x.closePath();
    var g = x.createLinearGradient(0, -en, uz, en);
    g.addColorStop(0, ic); g.addColorStop(1, dis);
    x.fillStyle = g; x.fill();
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.5, en * 0.2);
    x.lineJoin = "round"; x.stroke();
    x.strokeStyle = "rgba(24,50,16,.45)"; x.lineWidth = Math.max(0.8, en * 0.1);
    x.beginPath(); x.moveTo(uz * 0.06, 0); x.lineTo(uz * 0.92, 0); x.stroke();
  }

  /** DERİN LOBLU yaprak — rokanın imzası. Sap uzun, ayanın iki yanında
   *  keskin dilimler, uçta daha büyük bir lob. Marulun yuvarlak kenarının
   *  tam tersi. */
  function yaprakLoblu(x, sap, uz, en, ic, dis) {
    var i, adet = 3, x0 = sap, boyu = uz - sap;
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.5, en * 0.22); x.lineCap = "round";
    x.beginPath(); x.moveTo(0, 0); x.lineTo(sap, 0); x.stroke();
    x.beginPath();
    x.moveTo(x0, 0);
    for (i = 0; i < adet; i++) {
      var t1 = i / adet, t2 = (i + 0.5) / adet;
      x.lineTo(x0 + boyu * t1, -en * (0.5 + t1 * 0.34));
      x.lineTo(x0 + boyu * t2, -en * 0.1);           /* dilim arası: derin oyuk */
    }
    x.lineTo(uz, -en * 0.72);                        /* uç lobu daha büyük */
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
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.5, en * 0.2);
    x.lineJoin = "round"; x.stroke();
    x.strokeStyle = "rgba(24,50,16,.5)"; x.lineWidth = Math.max(0.8, en * 0.1);
    x.beginPath(); x.moveTo(x0, 0); x.lineTo(uz, 0); x.stroke();
  }

  /* --------------------------------------------------------- MARUL
   * Geniş, kıvrımlı kenarlı, SIKI rozet; ortada açık yeşil göbek.
   * Yapraklar birbirine değiyor — aralarında toprak görünmüyor. */
  function cizMarul(x, R, yes, tur, r) {
    var n, i, kat, adet;
    var koyu = ton(yes, -0.3), acik = ton(yes, 0.34);
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
    /* GÖBEK: rozetin ortası açık, sıkı sarılmış. */
    x.beginPath(); x.arc(0, 0, R * 0.2, 0, 6.3);
    x.fillStyle = rgba(ton(acik, 0.28), 1); x.fill();
    x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.4, R * 0.05); x.stroke();
    x.strokeStyle = "rgba(238,252,196,.6)"; x.lineWidth = Math.max(0.9, R * 0.03);
    for (i = 0; i < 3; i++) {
      x.beginPath(); x.arc(0, 0, R * (0.07 + i * 0.05), 0.5 + i, 3.4 + i); x.stroke();
    }
  }

  /* ---------------------------------------------------------- ROKA
   * Uzun saplı, DERİN LOBLU yapraklar; seyrek duruyor, aralarından toprak
   * görünüyor. Marulun tam tersi bir kenar. */
  function cizRoka(x, R, yes, tur, r) {
    var i, adet = 6;
    var koyu = ton(yes, -0.26), acik = ton(yes, 0.18);
    for (i = 0; i < adet; i++) {
      x.save();
      x.rotate((i / adet) * Math.PI * 2 + r() * 0.3);
      yaprakLoblu(x, R * 0.28, R * (0.94 + r() * 0.12), R * 0.46,
        rgba(i % 2 ? acik : yes, 1), rgba(koyu, 1));
      x.restore();
    }
    x.beginPath(); x.arc(0, 0, R * 0.1, 0, 6.3);
    x.fillStyle = rgba(koyu, 1); x.fill();
  }

  /* ------------------------------------------------------ SEMİZOTU
   * Küçük, KALIN, etli, parlak YUVARLAK yapraklar; sürünen duruş —
   * rozetten alçak ve dağınık, ortası boş değil ama merkeze toplanmıyor. */
  function cizSemizotu(x, R, yes, tur, r) {
    var i, q, adet = 5;
    var koyu = ton(yes, -0.22), acik = ton(yes, 0.3);
    var sap = { r: 178, g: 96, b: 74 };            /* semizotunun kırmızımsı sapı */
    for (i = 0; i < adet; i++) {
      var a = (i / adet) * Math.PI * 2 + r() * 0.4;
      var uz = R * (0.5 + r() * 0.3);
      x.save(); x.rotate(a);
      x.strokeStyle = rgba(sap, 1); x.lineWidth = Math.max(1.6, R * 0.09);
      x.lineCap = "round";
      x.beginPath(); x.moveTo(0, 0); x.lineTo(uz, 0); x.stroke();
      /* Sapın ucunda üç etli yaprak — hepsi yuvarlak, hiçbiri sivri. */
      for (q = 0; q < 3; q++) {
        var ay = (q - 1) * 0.75, yr = R * (0.2 + r() * 0.06);
        var yx = uz + Math.cos(ay) * R * 0.14, yy = Math.sin(ay) * R * 0.2;
        x.beginPath(); x.arc(yx, yy, yr, 0, 6.3);
        x.fillStyle = rgba(q === 1 ? yes : koyu, 1); x.fill();
        x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.5, yr * 0.28); x.stroke();
        /* ETLİ VE PARLAK: her yaprağın sol üstünde tek bir parlama. */
        x.beginPath();
        x.arc(yx - yr * 0.3, yy - yr * 0.34, yr * 0.32, 0, 6.3);
        x.fillStyle = rgba(ton(acik, 0.4), 0.75); x.fill();
      }
      x.restore();
    }
  }

  /* ------------------------------------------------------- MAYDANOZ
   * ÜÇE BÖLÜNMÜŞ kıvırcık yaprak, kısa ve sık sap. Havuçtan farkı:
   * havuç iplik gibi ve seyrek, maydanoz dolu ve kıvırcık. */
  function cizMaydanoz(x, R, yes, tur, r) {
    var i, q, adet = 5;
    var koyu = ton(yes, -0.3), acik = ton(yes, 0.18);
    for (i = 0; i < adet; i++) {
      var a = (i / adet) * Math.PI * 2 + r() * 0.24;
      /* SAP UZUN VE GÖRÜNÜR: marulun sıkı rozetiyle karışmasın diye
         ayacıklar merkezden ayrı duruyor, aralarından toprak görünüyor. */
      var sap = R * (0.5 + r() * 0.1);
      x.save(); x.rotate(a);
      x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.8, R * 0.08); x.lineCap = "round";
      x.beginPath(); x.moveTo(0, 0); x.lineTo(sap, 0); x.stroke();
      x.strokeStyle = rgba(acik, 1); x.lineWidth = Math.max(1, R * 0.04);
      x.stroke();
      /* ÜÇE BÖLÜNMÜŞ kıvırcık ayacık: üç ayrı yaprakçık, aralarında boşluk. */
      for (q = -1; q <= 1; q++) {
        x.save();
        x.translate(sap, 0);
        x.rotate(q * 0.82);
        yaprakDalgali(x, R * (0.34 + r() * 0.08), R * 0.15,
          rgba(q === 0 ? acik : yes, 1), rgba(koyu, 1), 6);
        x.restore();
      }
      x.restore();
    }
  }

  /* ---------------------------------------------------------- HAVUÇ
   * ÇOK İNCE, iplik gibi, SEYREK ve yüksek tüy. Dolu yaprak yok; sahne
   * ipliklerin arasından görünüyor. Maydanozla karışmaması bundan. */
  function cizHavuc(x, R, yes, tur, r) {
    var i, q, adet = 5;
    var acik = ton(yes, 0.3);
    for (i = 0; i < adet; i++) {
      var a = (i / adet) * Math.PI * 2 + r() * 0.5;
      var uz = R * (0.9 + r() * 0.22);
      x.save(); x.rotate(a);
      /* Ana sap: koyu kontur + ince açık çizgi. Kalınlık yarıçapla değil,
         okunaklılıkla sınırlı — 15 mm'lik fidede de görünüyor. */
      x.lineCap = "round";
      x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.8, R * 0.055);
      x.beginPath(); x.moveTo(0, 0);
      x.quadraticCurveTo(uz * 0.55, -R * 0.14, uz, -R * 0.06); x.stroke();
      x.strokeStyle = rgba(acik, 1); x.lineWidth = Math.max(0.9, R * 0.026);
      x.stroke();
      /* İplikler: karşılıklı, uca doğru kısalan, çok ince. */
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

  /* ------------------------------------------------------- FESLEĞEN
   * KARŞILIKLI, iri, oval, hafif kabarık yaprak ÇİFTLERİ. Dört yaprak,
   * hepsi büyük — az parça, iri siluet: en küçük boyda bile ayırt edilir. */
  function cizFeslegen(x, R, yes, tur, r) {
    var n, i;
    var koyu = ton(yes, -0.3), acik = ton(yes, 0.16);
    for (n = 2; n >= 1; n--) {
      for (i = 0; i < 2; i++) {
        var a = i * Math.PI + (n === 2 ? 0 : Math.PI / 2);
        var uz = R * (n === 2 ? 0.95 : 0.66);
        var en = R * (n === 2 ? 0.4 : 0.3);
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
        /* KABARIK: orta damar boyunca parlak bir sırt. */
        x.strokeStyle = "rgba(226,252,190,.5)"; x.lineWidth = Math.max(1, en * 0.14);
        x.beginPath(); x.moveTo(R * 0.16, 0); x.lineTo(uz * 0.88, 0); x.stroke();
        x.strokeStyle = "rgba(24,50,16,.4)"; x.lineWidth = Math.max(0.8, en * 0.08);
        for (var q = 1; q <= 3; q++) {
          var t2 = q / 4;
          x.beginPath();
          x.moveTo(uz * t2, 0);
          x.lineTo(uz * (t2 + 0.16), -en * 0.5 * (1 - t2)); x.stroke();
          x.beginPath();
          x.moveTo(uz * t2, 0);
          x.lineTo(uz * (t2 + 0.16), en * 0.5 * (1 - t2)); x.stroke();
        }
        x.restore();
      }
    }
  }

  /* Tür → çizici. Aile tablosu artık YEDEK; birincil yol bu. */
  var TUR_CIZER = {
    marul: cizMarul, roka: cizRoka, semizotu: cizSemizotu,
    maydanoz: cizMaydanoz, havuc: cizHavuc,
    feslegen: cizFeslegen, "fesleğen": cizFeslegen
  };
  /* Türe özel ton kaydırması: yan yana duran iki tür renkte de ayrılsın.
     Renk katalogdan geliyor; bu yalnız okunaklılık için. */
  var TUR_TON = { marul: 0.3, roka: -0.06, semizotu: 0.14,
                  maydanoz: -0.16, havuc: 0.32, feslegen: -0.34, "fesleğen": -0.34 };

  /* ÜST BİÇİMLER — yan yana duran iki tür karıştırılmasın diye her biri
     yaprak SAYISI, DURUŞU, DOKUSU ve TONUYLA ayrılıyor. Renk katalogdan
     geliyor; buradaki kaydırma yalnız biçimin okunması için. */
  var BICIM_TON = { rozet: 0.16, tuy: 0.26, bicak: -0.08, cift: -0.26,
                    genis: -0.16, bas: 0.06, turp: 0.2, bilinmiyor: 0 };

  /** `bic` bir BİÇİM NESNESİ: önce türün kendi çizicisine bakılıyor,
   *  yoksa ailenin üst biçimine düşülüyor. */
  function spriteCiz(x, bic, R, yes, tur, r) {
    var ozel = TUR_CIZER[bic.slug];
    if (ozel) { ozel(x, R, yes, tur, r); return; }
    aileCiz(x, bic.ust, R, yes, tur, r);
  }
  function aileCiz(x, bic, R, yes, tur, r) {
    var i, n, a, q;
    var koyu = ton(yes, -0.34), acik = ton(yes, 0.3);
    var trenk = hexRGB((tur && tur.renk) || "#f4a259");
    if (bic === "rozet") {
      /* MARUL/LAHANA: sık, yuvarlak, kıvrımlı kenar. Üç kat, dıştan içe
         açılan renk; ortası açık sarımsı. */
      for (n = 3; n >= 1; n--) {
        halka(x, r, 5 + n * 3, R * (n / 3), R * (n / 3) * 0.62,
          rgba(n === 1 ? acik : yes, 1), rgba(n === 3 ? koyu : yes, 1), n * 0.55);
      }
      goz(x, R, ton(acik, 0.2), 0.16);
    } else if (bic === "tuy") {
      /* HAVUÇ/DEREOTU/MAYDANOZ: seyrek, ince, tüylü. Yaprak yok — beş sap,
         her sapta karşılıklı küçük parçalar. Uzaktan da "tüy" gibi
         duruyor, marulla karışmıyor. */
      var sap = 5;
      for (i = 0; i < sap; i++) {
        a = (i / sap) * Math.PI * 2 + r() * 0.35;
        var uz = R * (0.72 + r() * 0.3);
        x.save(); x.rotate(a);
        x.strokeStyle = KONTUR; x.lineWidth = Math.max(2, R * 0.075); x.lineCap = "round";
        x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(uz * 0.5, -R * 0.1, uz, 0); x.stroke();
        x.strokeStyle = rgba(yes, 1); x.lineWidth = Math.max(1, R * 0.038);
        x.stroke();
        for (q = 1; q <= 6; q++) {
          var t2 = q / 7, px = uz * t2, boyu = R * 0.2 * (1 - t2 * 0.4);
          x.strokeStyle = rgba(q % 2 ? acik : yes, 1);
          x.lineWidth = Math.max(1, R * 0.032);
          x.beginPath(); x.moveTo(px, 0); x.lineTo(px + boyu * 0.4, -boyu); x.stroke();
          x.beginPath(); x.moveTo(px, 0); x.lineTo(px + boyu * 0.4, boyu); x.stroke();
        }
        x.restore();
      }
      /* Ailede omuz YOK: dereotunun toprak üstünde turuncu bir omzu
         olmaz. Havucun kendi çizicisi var, o da omuz çizmiyor —
         7 günlük fidede görünür bir kök omzu yok. */
    } else if (bic === "bicak") {
      /* SOĞAN/PIRASA/MISIR: uzun, dar, dimdik şeritler. Yalnız yedi tane
         ve hepsi neredeyse aynı boyda — kümelenmiş değil, dizilmiş. */
      halka(x, r, 7, R, R * 0.13, rgba(acik, 1), rgba(yes, 1), 0.4);
      x.strokeStyle = "rgba(24,50,16,.4)"; x.lineWidth = Math.max(0.8, R * 0.025);
      for (i = 0; i < 7; i++) {
        a = (i / 7) * Math.PI * 2 + 0.4;
        x.beginPath(); x.moveTo(0, 0);
        x.lineTo(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85); x.stroke();
      }
      /* Şeritlerin çıktığı boyun: soğanın toprak üstündeki kısmı. */
      omuz(x, R, ton(yes, 0.5), 0.19, false);
    } else if (bic === "cift") {
      /* FESLEĞEN/NANE/KEKİK: KARŞILIKLI çiftler hâlinde küçük, koyu,
         parlak yapraklar. Kat kat, her kat dönük. */
      for (n = 2; n >= 1; n--) {
        for (i = 0; i < 4; i++) {
          a = (i / 4) * Math.PI * 2 + n * 0.78;
          x.save(); x.rotate(a); x.translate(R * 0.16 * n, 0);
          x.beginPath();
          x.ellipse(R * 0.34 * n, 0, R * 0.36 * n, R * 0.27 * n, 0, 0, 6.3);
          x.fillStyle = rgba(n === 1 ? yes : koyu, 1); x.fill();
          x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.6, R * 0.06); x.stroke();
          x.strokeStyle = "rgba(214,248,184,.5)"; x.lineWidth = Math.max(0.9, R * 0.025);
          x.beginPath(); x.moveTo(R * 0.06 * n, 0); x.lineTo(R * 0.62 * n, 0); x.stroke();
          x.restore();
        }
      }
      goz(x, R, koyu, 0.1);
    } else if (bic === "genis") {
      /* DOMATES/KABAK/SALATALIK: az sayıda ama BÜYÜK, dilimli, koyu
         yaprak; her biri kalın bir saptan çıkıyor ve damarları görünüyor. */
      for (i = 0; i < 5; i++) {
        a = (i / 5) * Math.PI * 2 + r() * 0.3;
        var uzk = R * (0.5 + r() * 0.22);
        x.save();
        x.rotate(a);
        x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.8, R * 0.06); x.lineCap = "round";
        x.beginPath(); x.moveTo(0, 0); x.lineTo(uzk * 0.62, 0); x.stroke();
        x.translate(uzk * 0.62, 0);
        x.rotate((r() - 0.5) * 0.5);
        /* BEŞ LOBLU yaprak: kabak/domates yaprağının kendi biçimi.
           Loblar keskin, aralar derin — uzaktan da "dilimli" okunuyor. */
        x.beginPath();
        for (q = 0; q <= 40; q++) {
          var tq = (q / 40) * Math.PI * 2;
          var lob = Math.cos(tq * 2.5);
          var kq = R * 0.56 * (0.52 + 0.48 * Math.pow(Math.abs(lob), 0.7));
          if (q === 0) x.moveTo(Math.cos(tq) * kq, Math.sin(tq) * kq * 0.74);
          else x.lineTo(Math.cos(tq) * kq, Math.sin(tq) * kq * 0.74);
        }
        x.closePath();
        x.fillStyle = rgba(i % 2 ? koyu : ton(yes, -0.12), 1); x.fill();
        x.strokeStyle = KONTUR; x.lineWidth = Math.max(1.9, R * 0.07);
        x.lineJoin = "round"; x.stroke();
        x.strokeStyle = "rgba(206,242,176,.4)"; x.lineWidth = Math.max(0.9, R * 0.026);
        for (q = -1; q <= 1; q++) {
          x.beginPath(); x.moveTo(-R * 0.4, 0);
          x.lineTo(R * 0.34, q * R * 0.24); x.stroke();
        }
        x.restore();
      }
    } else if (bic === "bas") {
      /* AYÇİÇEĞİ: birkaç iri yaprak + ORTADA ÇİÇEK. Tek başına bakınca
         bile hangi tür olduğu belli. */
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
      x.fillStyle = "rgba(30,18,4,.55)";
      for (i = 0; i < 10; i++) {
        a = (i / 10) * Math.PI * 2;
        x.beginPath();
        x.arc(Math.cos(a) * R * 0.15, Math.sin(a) * R * 0.15, R * 0.03, 0, 6.3);
        x.fill();
      }
    } else if (bic === "turp") {
      /* TURP: az sayıda, GENİŞ ve yuvarlak yaprak; ortada kırmızı omuz.
         Havuçtan farkı burada: turpun yaprağı iri, havucunki tüy. */
      halka(x, r, 6, R * 0.82, R * 0.56, rgba(acik, 1), rgba(yes, 1), 0);
      omuz(x, R, trenk, 0.28, false);
      x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = Math.max(0.9, R * 0.03);
      x.beginPath(); x.arc(-R * 0.08, -R * 0.08, R * 0.13, 2.4, 4.8); x.stroke();
    } else {
      /* TÜR TANINMADI — uydurma siluet yok, kesik çizgili öbek. */
      x.setLineDash([Math.max(3, R * 0.18), Math.max(3, R * 0.13)]);
      x.strokeStyle = "rgba(238,232,214,.9)"; x.lineWidth = Math.max(1.8, R * 0.085);
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
    /* ÇİZİM ÇAPI ÜST SINIRLI: gerçek yayılım (marul 250 mm) yatağı yutar.
       Ölçü kaybolmuyor — seçili bitkide gerçek yayılım çember olarak
       ayrıca çiziliyor ve künyede mm yazıyor. */
    /* BOY YALNIZ `yaricap_mm`DEN. Buraya bir de yaş/olgunluk çarpanı
       konmuştu; `yaricap_mm` zaten bitkinin ölçülen yarıçapı, çarpan onu
       ikinci kez küçültüyordu. Sahte fark üretmemek için kalktı.
       OKUNUR_TABAN bir boyut iddiası DEĞİL: bu yarıçapın altında hiçbir
       siluet ayırt edilemiyor, o yüzden çizim tabanı. Gerçek yarıçap
       kaybolmuyor — künyede mm olarak yazıyor. */
    var tam = kis((cap / KARO_MM) * G.tw / 2, OKUNUR_TABAN, G.tw * 0.72);
    var R = tam;
    var bic = bicimSec(b);
    /* SPRITE YARIÇAPI KADEMELİ. Yakınlaştırma G.tw'yi sürekli değiştiriyor;
       her adımda 24 sprite'ı yeniden pişirmek zoom'u kilitliyordu (ölçülen:
       kare 7 ms, en uzun 84 ms). Yarıçap %18'lik kademelere yuvarlanıyor,
       aradaki fark çizerken ölçekleniyor: bir zoom serisinde sprite en çok
       birkaç kez pişiyor. */
    var Rq = Math.max(OKUNUR_TABAN, Math.pow(1.18, Math.round(Math.log(R) / Math.log(1.18))));
    var olcek = R / Rq;
    var ah = (bic.ozel ? bic.slug : bic.ust) + "|" + (b.tur || "?") + "|"
      + Rq.toFixed(1) + "|" + Math.round(S.dpr * 10);
    if (S.sprite[ah]) return sprOlcekle(S.sprite[ah], R, olcek);
    var boy = Math.ceil(Rq * 2 + 10);
    var c = document.createElement("canvas");
    c.width = Math.max(2, Math.ceil(boy * S.dpr));
    c.height = Math.max(2, Math.ceil(boy * ISO_ORAN * S.dpr) + 2);
    var x = c.getContext("2d");
    x.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    x.translate(boy / 2, boy * ISO_ORAN / 2);
    x.scale(1, ISO_ORAN);                   /* üstten bakış izometriğe oturuyor */
    /* Tür rengi katalogdan; biçime göre küçük bir ton kaydırması yan yana
       duran iki türü birbirinden ayırıyor. */
    /* Ton: türün kendi kaydırması varsa o, yoksa ailenin. */
    var kay = TUR_TON[bic.slug];
    if (kay === undefined) kay = BICIM_TON[bic.ust] || 0;
    var yes = ton(karis(hexRGB(b.renk || "#7bbf5a"), YESIL, 0.62), kay);
    spriteCiz(x, bic, Rq, yes, { renk: b.renk },
      uretec(Math.floor(tohum(b.tur || b.ad) * 4294967295)));
    var s = { tuval: c, tamEn: boy, en: boy, boy: boy * ISO_ORAN, R: Rq,
              bicim: bic };
    var say = 0; for (var kk in S.sprite) say++;
    if (say > 120) S.sprite = {};
    S.sprite[ah] = s;
    return sprOlcekle(s, R, olcek);
  }
  /* Kademeli sprite, istenen yarıçapa çizerken ölçekleniyor. Nesne
     paylaşılıyor; her karede yeni nesne yaratmak çöp üretirdi. */
  function sprOlcekle(s, R, olcek) {
    s.en = s.tamEn * olcek;
    s.boy = s.tamEn * ISO_ORAN * olcek;
    s.R = R;
    return s;
  }

  /* ==================================================================== *
   * NEM — BİTKİNİN KENDİ KAROSUNDA, ÖN DUVAR KESİTİ YOK.
   *
   * Ön duvar kesiti KALDIRILDI: yatağın toprak derinliği hiçbir yerde
   * ölçülmüyor, o duvar ölçülmemiş bir uzunluğu ölçülmüş gibi
   * gösteriyordu (ve ekranın üçte birini yiyordu).
   *
   * Ölçülmüş / ölçülmemiş ayrımı KAYBOLMADI, yer değiştirdi: her bitkinin
   * altında sığ bir oyuk var, çapı çizim kuralı (karoya bağlı).
   *   ölçüm YOKSA  → oyuk TARALI ve boş: bilmiyoruz.
   *   ölçüm VARSA  → aynı oyuk ölçülen ORANDA doluyor. Dolu daire yarıçapı
   *                  R*sqrt(%) — yani ALAN oranla değişiyor. Bu bir ORAN
   *                  (%0..%100), uzunluk iddiası yok; hiçbir yere mm
   *                  yazılmıyor.
   *   ödünç/bayat okuma → kehribar kesik çember, dolgu soluk.
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
    t.width = 8; t.height = 8;
    var k = t.getContext("2d");
    k.strokeStyle = "rgba(226,212,190,.55)"; k.lineWidth = 1.1;
    k.beginPath();
    k.moveTo(-2, 10); k.lineTo(10, -2);
    k.moveTo(-2, 2); k.lineTo(2, -2);
    k.moveTo(6, 10); k.lineTo(10, 6);
    k.stroke();
    _tarama = c.createPattern(t, "repeat");
    return _tarama;
  }
  /** Bitkinin gövde yüksekliği: bitki karonun ÜSTÜNDE duruyor, oyuk
   *  altında görünür kalıyor. Çizim kuralı, ölçü değil. */
  function govdeYuk() { return G.th * 0.62; }
  function oyukCap() { return Math.max(7, G.tw * 0.3); }
  /* Oyuk karonun ÖN yarısında duruyor (kendi karosunun içinde), yoksa
     gövde onu örtüyor. Kayma da çizim kuralı, ölçü değil. */
  var OYUK_KAY = 0.3;

  function nemCiz(c) {
    var R = oyukCap(), i;
    c.save();
    tarlaYol(c); c.clip();
    for (i = 0; i < S.bitki.length; i++) {
      var b = S.bitki[i];
      var u = uOf(b.x) + OYUK_KAY, v = vOf(b.y) + OYUK_KAY;
      var x = ex(u, v), y = ey(u, v);
      if (x < -R * 3 || x > S.en + R * 3 || y < -R * 3 || y > S.boy + R * 3) continue;
      var n = nemDurum(b), secili = S.secili === b.ad;
      var rev = b._reveal === undefined ? 1 : kis(sayi(b._reveal, 1), 0, 1);

      /* Oyuğun ağzı: içeri doğru koyulaşan sığ bir çukur. */
      c.save();
      c.translate(x, y); c.scale(1, ISO_ORAN);
      var og = c.createRadialGradient(0, 0, R * 0.15, 0, 0, R);
      og.addColorStop(0, "rgba(14,8,3,.88)"); og.addColorStop(1, "rgba(52,28,10,.72)");
      c.beginPath(); c.arc(0, 0, R, 0, 6.3);
      c.fillStyle = og; c.fill();

      if (!n.var || rev < 1) {
        /* TARALI OYUK — bir simge değil, yokluğun kendisi. */
        c.save();
        c.globalAlpha = n.var ? (1 - rev) : 1;
        c.beginPath(); c.arc(0, 0, R * 0.94, 0, 6.3);
        c.fillStyle = taramaDeseni(c); c.fill();
        c.restore();
      }
      if (n.var) {
        /* DOLGU: yarıçap R*sqrt(oran) — alan oranla değişiyor. */
        var p = n.yuzde / 100;
        var rr = R * 0.94 * Math.sqrt(kis(p, 0, 1)) * rev;
        if (rr > 0.6) {
          var islak = { r: 62, g: 146, b: 198 }, kuru = { r: 168, g: 118, b: 62 };
          var renk = karis(kuru, islak, p);
          var kuv = (n.kendi ? 1 : 0.55) * (n.bayat ? 0.6 : 1);
          var dg = c.createRadialGradient(-rr * 0.3, -rr * 0.3, rr * 0.1, 0, 0, rr);
          dg.addColorStop(0, rgba(ton(renk, 0.32), kuv));
          dg.addColorStop(1, rgba(ton(renk, -0.22), kuv));
          c.beginPath(); c.arc(0, 0, rr, 0, 6.3);
          c.fillStyle = dg; c.fill();
          c.strokeStyle = rgba(ton(renk, 0.5), kuv);
          c.lineWidth = Math.max(1.2, R * 0.09); c.stroke();
        }
        /* EŞİK: susama sınırı ince kesik çember olarak aynı oyukta. */
        if (n.esikAcik && n.esik > 0) {
          var er = R * 0.94 * Math.sqrt(kis(n.esik / 100, 0, 1));
          c.setLineDash([3, 3]);
          c.strokeStyle = b.susadi ? "rgba(240,140,96,.95)" : "rgba(228,236,244,.45)";
          c.lineWidth = b.susadi ? 1.8 : 1.1;
          c.beginPath(); c.arc(0, 0, er, 0, 6.3); c.stroke();
          c.setLineDash([]);
        }
      }
      /* Oyuğun ağzı: ölçülmemiş ya da ödünç/bayat okuma KESİK çember. */
      var kesik = !n.var || !n.kendi || n.bayat;
      if (kesik) c.setLineDash([4, 4]);
      c.strokeStyle = !n.var ? "rgba(232,220,200,.75)"
        : ((!n.kendi || n.bayat) ? "rgba(240,196,120,.95)" : "rgba(20,10,3,.85)");
      c.lineWidth = Math.max(1.4, R * 0.11);
      c.beginPath(); c.arc(0, 0, R, 0, 6.3); c.stroke();
      c.setLineDash([]);
      if (secili) {
        c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 1.6;
        c.beginPath(); c.arc(0, 0, R * 1.24, 0, 6.3); c.stroke();
      }
      /* SU İNİYOR — ölçüm DEĞİL. Sulama sırasında oyuğun üstünde yayılan
         geçici bir sızma halkası var; oyuğu DOLDURMUYOR, taralı oyuğu da
         doldurmuyor. Su verildi, nem ölçülmedi. */
      var sz = sayi(b._sizma, 0);
      if (sz > 0.02) {
        c.strokeStyle = "rgba(168,220,255," + (0.75 * (1 - sz * 0.5)).toFixed(2) + ")";
        c.lineWidth = 2;
        c.setLineDash([4, 5]);
        c.beginPath(); c.arc(0, 0, R * (1 + sz * 0.9), 0, 6.3); c.stroke();
        c.setLineDash([]);
      }
      c.restore();
    }
    c.restore();
  }

  /* ==================================================================== *
   * HAVA — sahnenin havası GERÇEK ÖLÇÜMDEN.
   *
   * Kanallar bunlar, başkası yok: hava_sicaklik, hava_nem, bmp_sicaklik,
   * basinc, toprak_nem. YAĞMUR/IŞIK/RÜZGÂR SENSÖRÜ YOK: yağmur diye bir
   * sinyal üretmiyoruz, yüksek hava nemi PUS olarak görünüyor ve adı da o.
   * Eksiklik panelde yazılı duruyor.
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
  /** Basınç EĞİLİMİ ölçümden: son üç saatin eğimi (hPa/saat). İki uçtan
   *  az veri varsa eğilim YOK — uydurma yok. */
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
  function isikTonu() {
    var t = S.hava.sicaklik;
    if (t == null) return { r: 255, g: 245, b: 232, guc: 0 };
    var p = kis((t - 8) / 26, 0, 1);
    return { r: Math.round(150 + p * 105), g: Math.round(190 + p * 44),
             b: Math.round(255 - p * 105), guc: 0.06 + Math.abs(p - 0.5) * 0.14 };
  }
  function gokAgirligi() {
    if (S.hava.egim == null) return 0;
    return kis(-S.hava.egim / 2, -1, 1);       /* -1 açık … +1 ağır */
  }
  function havaCiz(c) {
    var pus = pusGucu(), tn = isikTonu(), agir = gokAgirligi();
    if (tn.guc > 0.001) {
      c.save();
      c.globalCompositeOperation = "overlay";
      c.fillStyle = "rgba(" + tn.r + "," + tn.g + "," + tn.b + "," + tn.guc.toFixed(3) + ")";
      c.fillRect(0, 0, S.en, S.boy);
      c.restore();
    }
    if (pus > 0.02) {
      var g = c.createLinearGradient(0, 0, 0, S.boy);
      g.addColorStop(0, "rgba(196,206,214," + (pus * 0.30).toFixed(3) + ")");
      g.addColorStop(1, "rgba(186,194,202," + (pus * 0.06).toFixed(3) + ")");
      c.fillStyle = g; c.fillRect(0, 0, S.en, S.boy);
    }
    var kose = 0.18 + Math.max(0, agir) * 0.22;
    var v = c.createRadialGradient(S.en / 2, S.boy * 0.42, Math.min(S.en, S.boy) * 0.34,
      S.en / 2, S.boy * 0.5, Math.max(S.en, S.boy) * 0.82);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(" + (agir > 0 ? "10,10,14," : "0,0,0,") + kose.toFixed(3) + ")");
    c.fillStyle = v; c.fillRect(0, 0, S.en, S.boy);
  }

  /* ==================================================================== *
   * HAYAT — sahne boşta da yaşıyor. Buradaki hiçbir şey BİLGİ TAŞIMIYOR:
   * rüzgâr bir ölçüm değil (sensörü yok), o yüzden rastgele ve adı hiçbir
   * yerde geçmiyor. Sakin modda hepsi duruyor.
   * ==================================================================== */
  function hayatKur() {
    var r = uretec(5150), i;
    S.ot = [];                                  /* çim yok — tarla sürülmüş */
    S.toz = [];
    for (i = 0; i < 14; i++) {
      S.toz.push({ x: r() * S.en, y: r() * S.boy, vx: 0.15 + r() * 0.4,
                   vy: (r() - 0.5) * 0.14, r: 0.6 + r() * 1.6, a: 0.08 + r() * 0.2 });
    }
    S.iz = [];
    S.ruzgar = { yon: r() * 6.3, guc: 0.35 + r() * 0.3, hYon: r() * 6.3, hGuc: 0.5 };
  }
  function hayatGuncelle(dt) {
    if (S.sakin) return;
    var hiz = 1 - pusGucu() * 0.45;              /* nemli hava ağır */
    var w = S.ruzgar, i;
    if (Math.random() < dt * 0.25) {
      w.hYon = Math.random() * 6.3; w.hGuc = 0.2 + Math.random() * 0.8;
    }
    w.yon += (w.hYon - w.yon) * kis(dt * 0.4, 0, 1);
    w.guc += (w.hGuc - w.guc) * kis(dt * 0.5, 0, 1);
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
  function tozCiz(c) {
    for (var i = 0; i < S.toz.length; i++) {
      var t = S.toz[i];
      c.fillStyle = "rgba(244,222,186," + t.a.toFixed(2) + ")";
      c.beginPath(); c.arc(t.x, t.y, t.r, 0, 6.3); c.fill();
    }
  }
  function izCiz(c) {
    for (var i = 0; i < S.iz.length; i++) {
      var z = S.iz[i], a = kis(z.omur / z.tam, 0, 1);
      c.save();
      if (z.tip === "ayak") {
        c.globalAlpha = a * 0.5; c.fillStyle = "#3a2008";
        c.beginPath(); c.ellipse(z.x, z.y, 3.6, 2.2, z.aci, 0, 6.3); c.fill();
      } else {
        c.globalAlpha = a * 0.45; c.fillStyle = "rgba(226,196,148,1)";
        var rr = (1 - a) * 13 + 3;
        c.beginPath(); c.ellipse(z.x, z.y, rr, rr * ISO_ORAN, 0, 0, 6.3); c.fill();
      }
      c.restore();
    }
  }
  function izEkle(tip, x, y, aci) {
    S.iz.push({ tip: tip, x: x, y: y, aci: aci || 0, omur: tip === "ayak" ? 4 : 0.9,
                tam: tip === "ayak" ? 4 : 0.9 });
    if (S.iz.length > 40) S.iz.shift();
  }

  /* IZGARA — sürekli görünmüyor; yalnız imleç yataktayken ya da ekim
     kipinde beliriyor. Sürekli ızgara sahneyi tabloya çeviriyordu. */
  function izgaraCiz(c) {
    var goster = (S.tepsiTur || S.tasiKip) ? 1 : (S.uzerinde ? 0.55 : 0);
    if (goster <= 0) return;
    var i;
    c.save();
    c.globalAlpha = goster;
    c.strokeStyle = "rgba(255,240,214,.18)"; c.lineWidth = 1;
    for (i = 0; i <= G.nx; i++) {
      c.beginPath(); c.moveTo(ex(i, 0), ey(i, 0)); c.lineTo(ex(i, G.ny), ey(i, G.ny)); c.stroke();
    }
    for (i = 0; i <= G.ny; i++) {
      c.beginPath(); c.moveTo(ex(0, i), ey(0, i)); c.lineTo(ex(G.nx, i), ey(G.nx, i)); c.stroke();
    }
    c.restore();
  }

  /* ==================================================================== *
   * BİTKİLER — karonun ÜSTÜNDE duruyorlar.
   *
   * Yeni olan: bitki artık karoya yapıştırılmış bir damga değil. Gölgesi
   * karoda kalıyor, gövdesi gölgenin üstünde duruyor; aradaki boşlukta
   * nem oyuğu görünüyor. Katman sırası: oyuk → gölge → siluet.
   * ==================================================================== */
  /* ==================================================================== *
   * KÖK KATMANI — YALNIZ SEÇİLİ BİTKİDE AÇILIYOR.
   *
   * `TUR_BICIM` tablosunun kök sütunu ön duvar kesiti kalkınca çizimsiz
   * kalmıştı. Sürekli göstermek doğru olmazdı: kök derinliği HİÇBİR
   * YERDE ölçülmüyor, sürekli duran bir kök resmi ölçülmüş bir şey gibi
   * okunurdu. Bu yüzden seçilince açılan bir katman: kartın üstünde
   * "türün biçimi · ölçülmedi" yazıyor, hiçbir yerde mm yok ve derinlik
   * kart yüksekliğine göre, toprağa göre değil.
   * ==================================================================== */
  function kokCiz(c, kok, gen, h, r) {
    var i, yan;
    c.strokeStyle = "rgba(232,216,188,.9)"; c.lineCap = "round";
    if (kok === "kazik-etli") {
      c.beginPath();
      c.moveTo(-gen * 0.3, 0);
      c.quadraticCurveTo(-gen * 0.18, h * 0.55, 0, h * 0.8);
      c.quadraticCurveTo(gen * 0.18, h * 0.55, gen * 0.3, 0);
      c.closePath();
      c.fillStyle = "rgba(226,146,72,.92)"; c.fill();
      c.strokeStyle = "rgba(120,68,24,.9)"; c.lineWidth = 1.4; c.stroke();
      c.strokeStyle = "rgba(255,236,208,.35)"; c.lineWidth = 0.9;
      for (i = 1; i <= 3; i++) {
        var t2 = i / 4;
        c.beginPath();
        c.moveTo(-gen * 0.3 * (1 - t2), h * 0.8 * t2);
        c.lineTo(gen * 0.3 * (1 - t2), h * 0.8 * t2);
        c.stroke();
      }
    } else if (kok === "kazik") {
      c.lineWidth = Math.max(1.4, gen * 0.09);
      c.beginPath(); c.moveTo(0, 0);
      c.quadraticCurveTo(gen * 0.12, h * 0.5, (r() - 0.5) * gen * 0.2, h * 0.86);
      c.stroke();
    } else if (kok === "sacak") {
      c.lineWidth = Math.max(1, gen * 0.05);
      for (i = 0; i < 9; i++) {
        yan = (i / 8 - 0.5) * 2;
        c.beginPath(); c.moveTo(0, 0);
        c.quadraticCurveTo(yan * gen * 0.35, h * 0.2,
          yan * gen * (0.5 + r() * 0.28), h * (0.42 + r() * 0.22));
        c.stroke();
      }
    } else if (kok === "sogan") {
      c.fillStyle = "rgba(240,220,180,.92)";
      c.beginPath(); c.ellipse(0, h * 0.22, gen * 0.32, h * 0.22, 0, 0, 6.3); c.fill();
      c.strokeStyle = "rgba(140,110,60,.9)"; c.lineWidth = 1.2; c.stroke();
      c.strokeStyle = "rgba(232,216,188,.9)"; c.lineWidth = Math.max(0.9, gen * 0.045);
      for (i = 0; i < 6; i++) {
        yan = (i / 5 - 0.5) * 2;
        c.beginPath(); c.moveTo(yan * gen * 0.12, h * 0.44);
        c.lineTo(yan * gen * (0.26 + r() * 0.2), h * (0.62 + r() * 0.2)); c.stroke();
      }
    } else if (kok === "yumru") {
      c.lineWidth = Math.max(1, gen * 0.06);
      for (i = 0; i < 4; i++) {
        yan = (i / 3 - 0.5) * 2;
        var ux = yan * gen * (0.18 + r() * 0.3), uy = h * (0.3 + r() * 0.34);
        c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(ux * 0.5, uy * 0.7, ux, uy); c.stroke();
        c.fillStyle = "rgba(226,196,140,.92)";
        c.beginPath(); c.ellipse(ux, uy, gen * 0.13, gen * 0.1, yan * 0.4, 0, 6.3); c.fill();
      }
    } else if (kok === "derin") {
      c.lineWidth = Math.max(1.2, gen * 0.07);
      for (i = 0; i < 3; i++) {
        yan = (i - 1) * 0.9;
        c.beginPath(); c.moveTo(0, 0);
        c.quadraticCurveTo(yan * gen * 0.18, h * 0.5, yan * gen * 0.28, h * (0.78 + r() * 0.16));
        c.stroke();
      }
    } else {
      /* KÖK TİPİ BİLİNMİYOR — uydurma kök yok, kesik bir iz var. */
      c.setLineDash([3, 4]);
      c.lineWidth = Math.max(1, gen * 0.06);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, h * 0.3); c.stroke();
      c.beginPath(); c.ellipse(0, h * 0.44, gen * 0.28, h * 0.14, 0, 0, 6.3); c.stroke();
      c.setLineDash([]);
    }
  }
  function kokKartiCiz(c, b, x, y) {
    var bic = bicimSec(b);
    var yazi = KOK_ADI[bic.kok] || KOK_ADI.bilinmiyor;
    c.font = "600 9px system-ui,sans-serif";
    /* Kart YAZIYA göre genişliyor: "soğan (yumru) kök" kenardan taşıyordu. */
    var en = Math.max(78, G.tw * 1.4, c.measureText(yazi).width + 16);
    var boy = Math.max(58, en * 0.7);
    var kx = kis(x + G.tw * 0.7, 6, Math.max(6, S.en - en - 6));
    var ky = kis(y + G.th * 0.6, 6, Math.max(6, S.boy - boy - 6));
    c.save();
    c.fillStyle = "rgba(18,12,8,.86)";
    c.beginPath();
    if (c.roundRect) c.roundRect(kx, ky, en, boy, 8); else c.rect(kx, ky, en, boy);
    c.fill();
    c.strokeStyle = "rgba(226,196,150,.5)"; c.lineWidth = 1.4; c.stroke();
    /* Kartın içindeki toprak çizgisi: kökün nereden başladığını söylüyor. */
    var ty = ky + boy * 0.3;
    c.strokeStyle = "rgba(206,150,90,.8)"; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(kx + 6, ty); c.lineTo(kx + en - 6, ty); c.stroke();
    c.save();
    c.translate(kx + en / 2, ty);
    kokCiz(c, bic.kok, en * 0.42, boy * 0.62,
      uretec(Math.floor(tohum(String(b.ad) + "k") * 4294967295)));
    c.restore();
    c.font = "600 9px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = "rgba(238,224,200,.95)";
    c.fillText(yazi, kx + en / 2, ky + 12);
    c.fillStyle = "rgba(206,190,166,.8)";
    c.font = "9px system-ui,sans-serif";
    c.fillText("türün biçimi · ölçülmedi", kx + en / 2, ky + boy - 5);
    c.restore();
  }

  function bitkiCizHepsi(c) {
    var w = S.ruzgar, hiz = 1 - pusGucu() * 0.45;
    var kalk = govdeYuk();
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
        : (Math.sin(S.t * 1.15 * hiz + faz) * 0.034 + Math.sin(S.t * 2.6 + faz * 1.7) * 0.012)
          * (0.35 + w.guc * 0.9);
      var secili = S.secili === b.ad;
      /* PANEL → SAHNE: panelde imlecin altındaki bitki burada parlıyor. */
      var vurgulu = S.vurguListe.indexOf(String(b.ad)) >= 0;
      var nefes = ((secili || vurgulu) && !S.sakin) ? 1 + Math.sin(S.t * 2.1) * 0.03 : 1;
      var gy = y - kalk;                       /* gövdenin oturduğu yükseklik */
      if (vurgulu && !secili) {
        c.save();
        c.strokeStyle = "rgba(255,232,150,.95)"; c.lineWidth = 2.4;
        c.setLineDash([6, 5]);
        c.lineDashOffset = S.sakin ? 0 : -S.t * 10;
        c.beginPath();
        c.ellipse(x, y, sp.R + 5, (sp.R + 5) * ISO_ORAN, 0, 0, 6.3);
        c.stroke();
        c.restore();
      }

      /* Gölge karoda kalıyor — bitki yükseldikçe gölge ondan ayrılıyor. */
      c.save();
      c.globalAlpha = 0.4;
      c.fillStyle = "#1a0d03";
      c.beginPath();
      c.ellipse(x - ISIK.x * kalk * 0.5, y - ISIK.y * kalk * 0.25,
        sp.R * 0.9, sp.R * 0.9 * ISO_ORAN, 0, 0, 6.3);
      c.fill();
      c.restore();
      /* İnce sap: gövdeyi gölgesine bağlıyor. */
      c.save();
      c.strokeStyle = "rgba(46,74,30,.95)";
      c.lineWidth = Math.max(1.6, sp.R * 0.1); c.lineCap = "round";
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, gy + sp.boy * 0.1); c.stroke();
      c.restore();

      c.save();
      c.translate(x, gy);
      c.rotate(sal);
      c.scale(nefes, nefes);
      c.drawImage(sp.tuval, -sp.en / 2, -sp.boy / 2, sp.en, sp.boy);
      /* KENAR IŞIĞI: aynı siluet, ışık yönünde kaydırılıp toplanıyor. */
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.16 + (secili ? 0.07 : 0);
      c.drawImage(sp.tuval, -sp.en / 2 + ISIK.x * 2.4, -sp.boy / 2 + ISIK.y * 1.6,
        sp.en, sp.boy);
      c.restore();

      /* Sulamadan sonra yaprakta kalan damlalar. */
      var dmr = sayi(b._damlaT, 0);
      if (dmr > 0 && !S.sakin) {
        var dr = uretec(Math.floor(tohum(b.ad + "d") * 4294967295));
        c.save();
        c.globalAlpha = kis(dmr / 6, 0, 1) * 0.85;
        c.fillStyle = "rgba(206,238,255,.95)";
        for (var q = 0; q < 5; q++) {
          var da = dr() * 6.3, dd = dr() * sp.R * 0.8;
          c.beginPath();
          c.arc(x + Math.cos(da) * dd, gy + Math.sin(da) * dd * ISO_ORAN, 1.5, 0, 6.3);
          c.fill();
        }
        c.restore();
      }
      /* SUSAMA halkası: ölçüme dayanan tam, tahmin kesik. */
      if (b.susadi) {
        var tah = b.su_kanit !== "olculen";
        c.save();
        c.strokeStyle = "rgba(242,152,68,.95)";
        c.lineWidth = tah ? 1.4 : 2.2;
        c.setLineDash(tah ? [3, 5] : [7, 5]);
        c.lineDashOffset = S.sakin ? 0 : -S.t * 6;
        c.beginPath();
        c.ellipse(x, y, sp.R + 7, (sp.R + 7) * ISO_ORAN, 0, 0, 6.3);
        c.stroke();
        c.restore();
      }
      /* HASADA HAZIR ROZETİ — geri sayım yok; olgunluk bir ölçüm değil. */
      if (b.hasat) {
        var ry = gy - sp.boy / 2 - 13 + (S.sakin ? 0 : Math.sin(S.t * 2 + faz) * 1.6);
        c.save();
        c.fillStyle = "rgba(248,202,88,.98)";
        c.beginPath();
        if (c.roundRect) c.roundRect(x - 11, ry - 9, 22, 17, 6); else c.rect(x - 11, ry - 9, 22, 17);
        c.fill();
        c.strokeStyle = "rgba(58,38,6,.95)"; c.lineWidth = 1.8; c.stroke();
        c.fillStyle = "#3a2708"; c.font = "700 11px system-ui,sans-serif";
        c.textAlign = "center"; c.fillText("✓", x, ry + 4);
        c.restore();
      }
      if (!sp.bicim.bilinen) {
        c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
        c.fillStyle = "rgba(244,190,112,.95)";
        c.fillText("tür tanınmadı", x, y + G.th * 1.4);
      }
      if (secili) {
        c.save();
        c.strokeStyle = "rgba(255,255,255,.95)"; c.lineWidth = 2;
        c.beginPath();
        c.ellipse(x, gy, (sp.R + 3) * nefes, (sp.R + 3) * nefes * ISO_ORAN, 0, 0, 6.3);
        c.stroke();
        /* GERÇEK YAYILIM — siluet üst sınırlı, bu çember ölçünün kendisi. */
        var yay = sayi(b.yayilim_mm, 0);
        if (yay > 0) {
          var yr = (yay / KARO_MM) * G.tw / 2;
          c.setLineDash([5, 5]);
          c.strokeStyle = "rgba(196,226,255,.55)"; c.lineWidth = 1.2;
          c.beginPath(); c.ellipse(x, y, yr, yr * ISO_ORAN, 0, 0, 6.3); c.stroke();
          c.setLineDash([]);
        }
        c.restore();
        kokKartiCiz(c, b, x, y);
      }
    });
  }

  /* ==================================================================== *
   * MAKİNE VE ÇİFTÇİ
   *
   * Köprü makine Y'sinde yürüyor (kısa kenarı kaplar), kızak makine
   * X'inde kayıyor — `makine.js` koordinat sözleşmesinin aynısı. Çiftçi
   * kızağın altında, yani tam makine koordinatında duruyor.
   * ==================================================================== */
  function rayYuk() { return Math.max(24, G.th * 3.2); }

  function makineCiz(c) {
    var e = eksenEngeli();
    var varMi = S.ciz.x != null;
    var RY = rayYuk();
    var v = varMi ? kis(vOf(S.ciz.y), 0, G.ny) : G.ny / 2;
    var A = { x: ex(0, v), y: ey(0, v) }, B = { x: ex(G.nx, v), y: ey(G.nx, v) };
    c.save();
    c.globalAlpha = e.engel ? 0.42 : 1;
    c.lineJoin = "round";
    [A, B].forEach(function (p) {
      c.fillStyle = "#9aa2a8";
      c.fillRect(p.x - 3.5, p.y - RY, 7, RY);
      c.strokeStyle = "rgba(16,20,24,.9)"; c.lineWidth = 1.8;
      c.strokeRect(p.x - 3.5, p.y - RY, 7, RY);
    });
    var g = c.createLinearGradient(0, A.y - RY - 6, 0, A.y - RY + 6);
    g.addColorStop(0, "#e2e8ea"); g.addColorStop(0.5, "#a3aaae"); g.addColorStop(1, "#6a7074");
    c.strokeStyle = g; c.lineWidth = 8; c.lineCap = "round";
    c.beginPath(); c.moveTo(A.x, A.y - RY); c.lineTo(B.x, B.y - RY); c.stroke();
    c.strokeStyle = "rgba(16,20,24,.75)"; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(A.x, A.y - RY); c.lineTo(B.x, B.y - RY); c.stroke();
    if (varMi) {
      var u = kis(uOf(S.ciz.x), 0, G.nx);
      var kx = ex(u, v), kyy = ey(u, v);
      c.fillStyle = "#eef2ee";
      c.beginPath();
      if (c.roundRect) c.roundRect(kx - 14, kyy - RY - 10, 28, 19, 5);
      else c.rect(kx - 14, kyy - RY - 10, 28, 19);
      c.fill();
      c.strokeStyle = "rgba(16,20,24,.9)"; c.lineWidth = 2; c.stroke();
      /* Z takımı: ÖLÇÜLEN z kadar iniyor. */
      var inis = (1 - zYukseklik()) * RY * 0.72;
      c.strokeStyle = "#c2c9cd"; c.lineWidth = 3.4;
      c.beginPath(); c.moveTo(kx, kyy - RY + 6); c.lineTo(kx, kyy - RY + 6 + inis); c.stroke();
      c.strokeStyle = "rgba(16,20,24,.7)"; c.lineWidth = 1;
      c.stroke();
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
  /** Su akıyor mu — kaynak POMPA RÖLESİ, komut değil. */
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
      c.fillStyle = "rgba(232,116,100,.95)";
      c.fillText("konum bildirilmedi — çiftçi çizilemiyor", S.en / 2, S.boy * 0.5);
      c.restore();
      return;
    }
    var e = eksenEngeli();
    var u = kis(uOf(S.ciz.x), 0, G.nx), v = kis(vOf(S.ciz.y), 0, G.ny);
    var x = ex(u, v), y = ey(u, v);
    /* Konum artık bildirilmiyorsa çiftçi SON YERİNDE ve sönük duruyor. */
    if (S.konumYok) { c.save(); c.globalAlpha = 0.45; }
    var boy = Math.max(22, G.tw * 0.55);
    var egik = 1 - zYukseklik();              /* DURUŞ Z'DEN */
    var is = calisanIs(), su = suAkiyorMu(), tohumDus = tUzama();
    c.save();
    c.translate(x, y);
    c.globalAlpha = 0.4; c.fillStyle = "#170d04";
    c.beginPath(); c.ellipse(0, 0, boy * 0.34, boy * 0.34 * ISO_ORAN, 0, 0, 6.3); c.fill();
    c.globalAlpha = 1;
    c.translate(0, -boy * 0.08);
    c.rotate(egik * 0.22);
    var w = boy * 0.30;
    c.lineJoin = "round";
    c.strokeStyle = "#33302a"; c.lineWidth = Math.max(2.6, boy * 0.12); c.lineCap = "round";
    c.beginPath(); c.moveTo(-w * 0.35, 0); c.lineTo(-w * 0.4, -boy * 0.34); c.stroke();
    c.beginPath(); c.moveTo(w * 0.35, 0); c.lineTo(w * 0.4, -boy * 0.34); c.stroke();
    c.fillStyle = "#3f78b5";
    c.beginPath();
    if (c.roundRect) c.roundRect(-w / 2, -boy * 0.74, w, boy * 0.42, w * 0.28);
    else c.rect(-w / 2, -boy * 0.74, w, boy * 0.42);
    c.fill();
    c.strokeStyle = "rgba(10,20,32,.95)"; c.lineWidth = Math.max(1.6, boy * 0.06); c.stroke();
    c.strokeStyle = "#3f78b5"; c.lineWidth = Math.max(2.2, boy * 0.1);
    var kol = is ? -0.5 : 0.1;
    c.beginPath(); c.moveTo(-w * 0.45, -boy * 0.66);
    c.lineTo(-w * 0.75, -boy * (0.5 + kol * 0.2)); c.stroke();
    c.beginPath(); c.moveTo(w * 0.45, -boy * 0.66);
    c.lineTo(w * 0.75, -boy * (0.5 + kol * 0.2)); c.stroke();
    c.fillStyle = "#eccca2";
    c.beginPath(); c.arc(0, -boy * 0.84, boy * 0.13, 0, 6.3); c.fill();
    c.strokeStyle = "rgba(48,30,14,.9)"; c.lineWidth = Math.max(1.4, boy * 0.05); c.stroke();
    c.fillStyle = "#cf9346";
    c.beginPath(); c.ellipse(0, -boy * 0.92, boy * 0.27, boy * 0.075, 0, 0, 6.3); c.fill();
    c.beginPath(); c.arc(0, -boy * 0.96, boy * 0.12, Math.PI, 0); c.fill();
    c.strokeStyle = "rgba(60,36,10,.95)"; c.lineWidth = Math.max(1.4, boy * 0.05); c.stroke();

    /* ELDEKİ ALET — çalışan işten. İş yoksa alet de yok. */
    if (is && is.tip === "sula") {
      c.fillStyle = "#7fb4dd";
      c.beginPath();
      if (c.roundRect) c.roundRect(w * 0.6, -boy * 0.62, boy * 0.22, boy * 0.18, 3);
      else c.rect(w * 0.6, -boy * 0.62, boy * 0.22, boy * 0.18);
      c.fill();
      c.strokeStyle = "rgba(14,32,50,.9)"; c.lineWidth = 1.4; c.stroke();
    } else if (is && is.tip === "nem") {
      c.strokeStyle = "#63c46b"; c.lineWidth = Math.max(2, boy * 0.08);
      c.beginPath();
      c.moveTo(w * 0.72, -boy * 0.66); c.lineTo(w * 0.72, -boy * (0.2 - egik * 0.18));
      c.stroke();
    } else if (is && is.tip === "ek") {
      c.fillStyle = "#e4d3a0";
      c.beginPath(); c.arc(w * 0.75, -boy * 0.55, boy * 0.11, 0, 6.3); c.fill();
      c.strokeStyle = "rgba(60,48,16,.9)"; c.lineWidth = 1.4; c.stroke();
    }
    c.restore();

    /* SU — kaynak POMPA RÖLESİ. Komut değil, rölenin kendisi. */
    if (su) {
      c.save();
      c.strokeStyle = "rgba(160,212,244,.9)"; c.lineWidth = 2.2; c.lineCap = "round";
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
      c.fillStyle = "#f4e4b6";
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
      c.fillStyle = "rgba(232,116,100,.98)";
      c.fillText(e.yazi, x, y - boy * 1.3);
      c.restore();
    }
  }

  /* ==================================================================== *
   * EFEKTLER — üçü de GERÇEK ilerlemeden sürülüyor, üçü birbirine
   * benzemiyor. Sabit süreli animasyon yok: her biri kendi sinyalinin
   * açık kaldığı sürece sürüyor, sinyal kapanınca kapanış oynuyor.
   *   sulama → pompa rölesi         (Panel.S.roleDurum.su_pompasi)
   *   ekim   → tohum ucunun ekseni  (durum.tohum_ucu.mm / yukari_mm)
   *   ölçüm  → SİNYAL YOK; başlatılan işten türetiliyor (plc.py'de yalnız
   *            X/Y/Z/T var; prob'un kendi ekseni ve bayrağı yok)
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

    /* HAREKET — iz ancak gerçekten yer değiştirince düşüyor. */
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

    /* SULAMA — pompa rölesi açıkken. Nem oyuğunu DOLDURMUYOR. */
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
        izEkle("toz", ex(uOf(hedef.x), vOf(hedef.y)), ey(uOf(hedef.x), vOf(hedef.y)));
      }
      hedef._tuOnce = tu;
    }

    /* NEM ÖLÇÜMÜ — sinyal yok; iş + Z'nin toprakta olması. */
    if (is && is.tip === "nem" && hedef && zYukseklik() < 0.12) {
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
  function baslikYeri() {
    var u = kis(uOf(S.ciz.x), 0, G.nx), v = kis(vOf(S.ciz.y), 0, G.ny);
    return { x: ex(u, v), y: ey(u, v) - rayYuk() * 0.35 };
  }
  function suEfektiCiz(c, hedef) {
    var x = ex(uOf(hedef.x), vOf(hedef.y)), y = ey(uOf(hedef.x), vOf(hedef.y));
    var b = baslikYeri();
    c.save();
    var g = c.createLinearGradient(b.x, b.y, x, y);
    g.addColorStop(0, "rgba(196,232,254,.9)");
    g.addColorStop(1, "rgba(126,186,230,.35)");
    c.strokeStyle = g; c.lineWidth = 5; c.lineCap = "round";
    c.beginPath();
    c.moveTo(b.x, b.y);
    c.quadraticCurveTo((b.x + x) / 2 + Math.sin(S.t * 9) * 3, (b.y + y) / 2, x, y);
    c.stroke();
    c.strokeStyle = "rgba(244,254,255,.6)"; c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(b.x, b.y);
    c.quadraticCurveTo((b.x + x) / 2 + Math.sin(S.t * 9 + 1) * 4, (b.y + y) / 2, x, y);
    c.stroke();
    var hr = (S.t * 2.2 % 1);
    c.strokeStyle = "rgba(206,240,255," + ((1 - hr) * 0.75).toFixed(2) + ")";
    c.lineWidth = 2.4;
    c.beginPath();
    c.ellipse(x, y, 6 + hr * G.tw * 0.5, (6 + hr * G.tw * 0.5) * ISO_ORAN, 0, 0, 6.3);
    c.stroke();
    c.restore();
  }
  function ekimEfektiCiz(c, hedef) {
    var x = ex(uOf(hedef.x), vOf(hedef.y)), y = ey(uOf(hedef.x), vOf(hedef.y));
    var tu = tUzama();
    var dr = 4 + sayi(hedef._delik, 0) * G.tw * 0.24;
    c.save();
    c.fillStyle = "rgba(14,8,2,.8)";
    c.beginPath(); c.ellipse(x, y, dr, dr * ISO_ORAN, 0, 0, 6.3); c.fill();
    c.strokeStyle = "rgba(216,182,130,.6)"; c.lineWidth = 1.6; c.stroke();
    if (tu > 0.05) {
      c.fillStyle = "#f4e6ba";
      c.beginPath(); c.ellipse(x, y - 16 + tu * 16, 2.6, 3.2, 0, 0, 6.3); c.fill();
      c.strokeStyle = "rgba(80,62,20,.85)"; c.lineWidth = 1; c.stroke();
    }
    c.restore();
    /* HAZNE KAPAĞI — arabanın üstünde, uç inmeden önce açık. */
    var b = baslikYeri(), by = b.y - rayYuk() * 0.65;
    var acik = kis(1 - tu * 2.2, 0, 1);
    c.save();
    c.fillStyle = "#8a7550";
    c.fillRect(b.x - 9, by - 6, 18, 10);
    c.strokeStyle = "rgba(24,18,8,.95)"; c.lineWidth = 1.6;
    c.strokeRect(b.x - 9, by - 6, 18, 10);
    c.translate(b.x - 9, by - 6);
    c.rotate(-acik * 1.1);
    c.fillStyle = "#b39a68";
    c.fillRect(0, -3, 18, 3.5);
    c.strokeRect(0, -3, 18, 3.5);
    c.restore();
  }
  function nemEfektiCiz(c, hedef) {
    var x = ex(uOf(hedef.x), vOf(hedef.y)), y = ey(uOf(hedef.x), vOf(hedef.y));
    var bek = sayi((S.veri && S.veri.nem_bekleme_sn), NEM_BEKLEME_VARSAYILAN);
    var p = kis(sayi(hedef._probT, 0) / Math.max(1, bek), 0, 1);
    var nabiz = 0.5 + Math.sin(S.t * 5) * 0.5;
    c.save();
    c.strokeStyle = "rgba(120,214,132," + (0.25 + nabiz * 0.35).toFixed(2) + ")";
    c.lineWidth = 2;
    var rr = G.tw * (0.34 + nabiz * 0.1);
    c.beginPath(); c.ellipse(x, y, rr, rr * ISO_ORAN, 0, 0, 6.3); c.stroke();
    c.strokeStyle = "rgba(99,196,107,.95)"; c.lineWidth = 3.6; c.lineCap = "round";
    c.beginPath();
    c.ellipse(x, y, G.tw * 0.5, G.tw * 0.5 * ISO_ORAN, 0,
      -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    c.stroke();
    c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = "rgba(160,226,166,.95)";
    c.fillText("prob duruşu · işten türetildi", x, y - G.tw * 0.5 * ISO_ORAN - 9);
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
        c.translate(x, y); c.scale(1, ISO_ORAN);
        var g = c.createRadialGradient(0, 0, 1, 0, 0, R);
        g.addColorStop(0, "rgba(38,20,6,.9)"); g.addColorStop(1, "rgba(38,20,6,0)");
        c.fillStyle = g;
        c.beginPath(); c.arc(0, 0, R, 0, 6.3); c.fill();
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
        c.fillStyle = "rgba(198,150,92,.95)";
        c.beginPath(); c.ellipse(x, y, 7, 7 * ISO_ORAN, 0, 0, 6.3); c.fill();
        c.strokeStyle = "rgba(40,22,8,.8)"; c.lineWidth = 1.4; c.stroke();
        c.restore();
      }
    });
    if (hedef && is) {
      if (is.tip === "sula" && suAkiyorMu()) suEfektiCiz(c, hedef);
      else if (is.tip === "ek") ekimEfektiCiz(c, hedef);
      else if (is.tip === "nem" && sayi(hedef._probT, 0) > 0) nemEfektiCiz(c, hedef);
    }
    for (var i = 0; i < S.zerre.length; i++) {
      var z = S.zerre[i];
      c.fillStyle = "rgba(" + z.renk + "," + kis(z.omur / z.tam, 0, 1).toFixed(2) + ")";
      c.beginPath(); c.arc(z.x, z.y, z.r, 0, 6.3); c.fill();
    }
    S.efekt.forEach(function (e) {
      var pr = kis(e.t / 1.4, 0, 1);
      if (e.tip === "kapanis") {
        var cx = S.ciz.x == null ? S.en / 2 : ex(uOf(S.ciz.x), vOf(S.ciz.y));
        var cy = S.ciz.x == null ? S.boy / 2 : ey(uOf(S.ciz.x), vOf(S.ciz.y));
        c.save();
        c.globalAlpha = (1 - pr) * 0.8;
        c.strokeStyle = "rgba(255,236,186,.95)"; c.lineWidth = 2.6;
        var rr = G.tw * (0.3 + pr * 1.3);
        c.beginPath(); c.ellipse(cx, cy, rr, rr * ISO_ORAN, 0, 0, 6.3); c.stroke();
        c.restore();
      } else if (e.tip === "ekildi") {
        var b2 = S.ix[e.ad];
        if (!b2) return;
        var bx2 = ex(uOf(b2.x), vOf(b2.y)), by2 = ey(uOf(b2.x), vOf(b2.y));
        c.save();
        c.globalAlpha = 1 - pr;
        c.fillStyle = "rgba(220,192,138,.95)";
        for (var q = 0; q < 6; q++) {
          var a = (q / 6) * 6.3;
          c.beginPath();
          c.arc(bx2 + Math.cos(a) * pr * 16, by2 + Math.sin(a) * pr * 16 * ISO_ORAN, 1.8, 0, 6.3);
          c.fill();
        }
        c.restore();
      }
    });
  }

  /* ==================================================================== *
   * SAHNE
   * ==================================================================== */
  function karoVurgu(c, k, dolgu, cizgi) {
    c.beginPath();
    c.moveTo(ex(k.u, k.v), ey(k.u, k.v));
    c.lineTo(ex(k.u + 1, k.v), ey(k.u + 1, k.v));
    c.lineTo(ex(k.u + 1, k.v + 1), ey(k.u + 1, k.v + 1));
    c.lineTo(ex(k.u, k.v + 1), ey(k.u, k.v + 1));
    c.closePath();
    if (dolgu) { c.fillStyle = dolgu; c.fill(); }
    if (cizgi) { c.strokeStyle = cizgi; c.stroke(); }
  }
  function uzerindeCiz(c) {
    if (!S.uzerinde) return;
    c.save();
    karoVurgu(c, S.uzerinde, "rgba(255,246,220,.16)", null);
    c.restore();
  }
  function hedefKaroCiz(c) {
    if (!S.hedefKaro) return;
    c.save();
    c.lineWidth = 2.2;
    c.setLineDash([5, 4]);
    c.lineDashOffset = -S.t * 8;
    karoVurgu(c, S.hedefKaro, null, "rgba(120,200,255,.95)");
    c.restore();
  }

  var sahneCiz = guvenli("sahne", function () {
    var c = S.ct;
    if (!c || !S.en || !S.boy) return;
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.clearRect(0, 0, S.en, S.boy);
    /* DEĞİŞMEYEN BÖLGE: zemin bir kez çiziliyor, kare başına tek
       drawImage. Yalnız kadraj kıpırdayınca yeniden çiziliyor. */
    var donuk = gest.etkin || G.kayiyor;
    var zd = zeminDonusum(donuk);
    if (!zd) { zeminCiz(); zd = zeminDonusum(false); }
    if (donuk) { c.fillStyle = P_DIS2; c.fillRect(0, 0, S.en, S.boy); }
    if (zd) c.drawImage(S.zemin, 0, 0, S.zemin.width, S.zemin.height, zd.e, zd.f, zd.w, zd.h);
    izCiz(c);
    uzerindeCiz(c);
    izgaraCiz(c);
    hedefKaroCiz(c);
    nemCiz(c);
    efektCiz(c);
    bitkiCizHepsi(c);
    makineCiz(c);
    ciftciCiz(c);
    halkaCiz(c);
    if (!S.sakin) tozCiz(c);
    havaCiz(c);
  });

  /* ==================================================================== *
   * KARE DÖNGÜSÜ
   *
   * Üç hâl: SAKİN (boştaki hayat kapalı — yalnız gerçek olaylar), BOŞTA
   * HAYAT (düşük kare hızı) ve İŞ (tam hız). Sekme görünmüyorsa çizim
   * tamamen duruyor.
   * ==================================================================== */
  var HIZ_BOSTA = 13;
  function isVarMi() {
    if (S.efekt.length || S.zerre.length) return true;
    if (suAkiyorMu()) return true;
    if (D().hareket) return true;
    if (G.kam && G.hedef && !G.elle
        && (Math.abs(G.kam.cu - G.hedef.cu) > 0.002 || Math.abs(G.kam.cv - G.hedef.cv) > 0.002
         || Math.abs(G.kam.tw - G.hedef.tw) > 0.06)) {
      return true;
    }
    if (S.ciz.x != null && S.bildirilen.x != null
        && (Math.abs(S.ciz.x - S.bildirilen.x) > 0.4
            || Math.abs(S.ciz.y - S.bildirilen.y) > 0.4)) return true;
    if (calisanIs()) return true;
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
    /* KADRAJ KAYARKEN ZEMİN DONDURULUYOR. Eskiden her karede yeniden
       çiziliyordu: açılıştaki kadraj animasyonunda kare 37 ms'ye
       çıkıyordu (6 bitkilik sahnede ölçüldü). Artık hareket bitince bir
       kez çiziliyor — tekerlekteki davranışın aynısı. */
    if (kameraGuncelle(dt)) { G.kayiyor = true; S.kirli = true; }
    else if (G.kayiyor) { G.kayiyor = false; zeminCiz(); S.kirli = true; }
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
  /* ==================================================================== *
   * VURUŞ ALANI — ÇİZİLEN SİLUETİN KENDİSİ.
   *
   * Eskiden vuruş elipsi bitkinin TOPRAK ANKRAJINA kuruluyordu ve dikey
   * yarıçapı ISO_ORAN ile yassılıyordu (2·max(6, R/2) piksel). Oysa sprite
   * ankrajın YUKARISINA çiziliyor: gövde kadar yükselmiş, sp.boy kadar
   * yüksek. Kullanıcı gördüğü yaprağa tıklıyor, elips ıskalıyor, tıklama
   * karo dalına düşüyor ve "Eksen X … gidecek" onayı açılıyordu.
   *
   * Kutu artık `spriteAl`in bildiği ölçülerden geliyor — elle yazılmış
   * sayı yok: genişlik sp.en, üst kenar gövde yüksekliği kadar yukarıda,
   * alt kenar ankrajın altındaki gölge elipsinin dibi.
   * ==================================================================== */
  function vurusKutusu(b, pay) {
    var sp = spriteAl(b);
    var u = uOf(b.x), v = vOf(b.y);
    var x = ex(u, v), y = ey(u, v);
    var gy = y - govdeYuk();                 /* siluetin merkezi */
    pay = pay || 0;
    return {
      ad: String(b.ad),
      x1: x - sp.en / 2 - pay, x2: x + sp.en / 2 + pay,
      y1: gy - sp.boy / 2 - pay,             /* yaprakların tepesi */
      y2: y + sp.R * 0.9 * ISO_ORAN + pay,   /* gölge elipsinin dibi */
      derinlik: u + v,                       /* çizim sırası: büyük olan ÖNDE */
      x: x, y: y, gy: gy
    };
  }
  /** Vuruşta EN ÖNDEKİ kazanıyor. Çizim sırası (u+v) artan; en son çizilen
   *  en öndedir, yani arkadaki bitki öndekinin yaprağının arkasından
   *  seçilemiyor. Eşitlikte merkeze yakın olan. */
  function bitkiBul(p, pay) {
    var en = null, enD = -1e9, enU = 1e9;
    for (var i = 0; i < S.bitki.length; i++) {
      var k = vurusKutusu(S.bitki[i], pay);
      if (p.x < k.x1 || p.x > k.x2 || p.y < k.y1 || p.y > k.y2) continue;
      var u = Math.hypot(p.x - k.x, p.y - k.gy);
      if (k.derinlik > enD || (k.derinlik === enD && u < enU)) {
        enD = k.derinlik; enU = u; en = S.bitki[i];
      }
    }
    return en;
  }

  /* ==================================================================== *
   * EYLEM HALKASI — iş, bakılan yerde başlıyor.
   *
   * Bitki seçilince sahnede bitkinin üstünde küçük bir halka açılıyor:
   * sula, nemini ölç, üstüne git ve (hasada hazırsa) hasat. Yan paneldeki
   * künye ve düğmeler DURUYOR — bu onların yerine değil, yanına.
   *
   * Makineli işler makine kopukken kapalı ve sebebi halkanın altında
   * yazılı. Hasat KAYIT işi (makine kımıldamıyor), o yüzden kopukken de
   * açık — paneldeki davranışın aynısı.
   * ==================================================================== */
  function halkaEylemleri(b) {
    var e = eksenEngeli();
    var l = [
      { ad: "sula", etiket: "su", kapali: e.engel },
      { ad: "olc", etiket: "nem", kapali: e.engel },
      { ad: "git", etiket: "git", kapali: e.engel }
    ];
    if (b.hasat) l.push({ ad: "hasat", etiket: "hasat", kapali: false });
    return l;
  }
  /** Halkanın yerleşimi — çizim ve vuruş AYNI hesabı kullanıyor. */
  function halkaYerlesim(b) {
    var sp = spriteAl(b);
    var k = vurusKutusu(b, 0);
    var l = halkaEylemleri(b), n = l.length, i, a;
    var rb = kis(G.tw * 0.22, 13, 18);
    var a0 = -Math.PI * 0.97, a1 = -Math.PI * 0.03;
    /* YARIÇAP DÜĞME SAYISINDAN: komşu iki düğmenin kirişi hem düğme
       çapından hem de altındaki etiketten geniş olmalı — yoksa dört düğme
       üst üste biniyor ve "nem" ile "git" birbirine giriyor. En uzun
       etiket "hasat", 9 piksellik yazıda ~28 piksel. */
    var da = n > 1 ? (a1 - a0) / (n - 1) : Math.PI;
    var enAzKiris = Math.max(rb * 2.5, 28) + 8;
    var rx = Math.max(sp.en * 0.5 + rb + 6, rb * 2.6);
    if (n > 1) rx = Math.max(rx, enAzKiris / (2 * Math.sin(da / 2)));
    var ry = Math.max(sp.boy * 0.5 + rb + 10, rb * 1.9);
    for (i = 0; i < n; i++) {
      a = n === 1 ? -Math.PI / 2 : a0 + da * i;
      l[i].x = k.x + Math.cos(a) * rx;
      l[i].y = k.gy + Math.sin(a) * ry;
      l[i].r = rb;
    }
    return { x: k.x, y: k.gy, alt: k.y2 + 12, dugme: l };
  }
  function halkaVurus(p, pay) {
    var b = S.ix[S.halkaAd];
    if (!b) return null;
    var y = halkaYerlesim(b), i, d;
    for (i = 0; i < y.dugme.length; i++) {
      d = y.dugme[i];
      if (Math.hypot(p.x - d.x, p.y - d.y) <= d.r + (pay || 0)) return d;
    }
    return null;
  }
  /* Simgeler vektör: emoji yazı tipi Pi'de her zaman yok. */
  function simgeCiz(c, ad, x, y, r, renk) {
    c.save();
    c.translate(x, y);
    c.strokeStyle = renk; c.fillStyle = renk;
    c.lineWidth = Math.max(1.6, r * 0.13); c.lineCap = "round"; c.lineJoin = "round";
    if (ad === "sula") {                       /* damla */
      c.beginPath();
      c.moveTo(0, -r * 0.52);
      c.quadraticCurveTo(r * 0.42, 0, 0, r * 0.42);
      c.quadraticCurveTo(-r * 0.42, 0, 0, -r * 0.52);
      c.fill();
    } else if (ad === "olc") {                 /* prob: toprağa inen uç */
      c.beginPath(); c.moveTo(0, -r * 0.5); c.lineTo(0, r * 0.18); c.stroke();
      c.beginPath(); c.moveTo(-r * 0.22, r * 0.02); c.lineTo(0, r * 0.34);
      c.lineTo(r * 0.22, r * 0.02); c.stroke();
      c.beginPath(); c.moveTo(-r * 0.46, r * 0.5); c.lineTo(r * 0.46, r * 0.5); c.stroke();
    } else if (ad === "git") {                 /* nişan */
      c.beginPath(); c.arc(0, 0, r * 0.36, 0, 6.3); c.stroke();
      c.beginPath();
      c.moveTo(-r * 0.56, 0); c.lineTo(-r * 0.2, 0);
      c.moveTo(r * 0.2, 0); c.lineTo(r * 0.56, 0);
      c.moveTo(0, -r * 0.56); c.lineTo(0, -r * 0.2);
      c.moveTo(0, r * 0.2); c.lineTo(0, r * 0.56);
      c.stroke();
    } else {                                   /* sepet */
      c.beginPath(); c.arc(0, r * 0.06, r * 0.38, Math.PI, 0); c.stroke();
      c.beginPath();
      c.moveTo(-r * 0.5, r * 0.06); c.lineTo(-r * 0.34, r * 0.5);
      c.lineTo(r * 0.34, r * 0.5); c.lineTo(r * 0.5, r * 0.06);
      c.closePath(); c.stroke();
    }
    c.restore();
  }
  function halkaCiz(c) {
    var b = S.ix[S.halkaAd];
    if (!b) return;
    var y = halkaYerlesim(b), i, d;
    var e = eksenEngeli();
    c.save();
    for (i = 0; i < y.dugme.length; i++) {
      d = y.dugme[i];
      /* Halkayı bitkiye bağlayan ince çizgi: hangi bitkinin halkası
         olduğu belli olsun. */
      c.strokeStyle = "rgba(255,246,214,.22)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(y.x, y.y); c.lineTo(d.x, d.y); c.stroke();
    }
    for (i = 0; i < y.dugme.length; i++) {
      d = y.dugme[i];
      c.beginPath(); c.arc(d.x, d.y + 1.5, d.r, 0, 6.3);
      c.fillStyle = "rgba(8,5,2,.5)"; c.fill();
      c.beginPath(); c.arc(d.x, d.y, d.r, 0, 6.3);
      c.fillStyle = d.kapali ? "rgba(38,32,26,.92)" : "rgba(28,24,18,.95)";
      c.fill();
      c.strokeStyle = d.kapali ? "rgba(150,140,124,.5)" : "rgba(250,224,160,.9)";
      c.lineWidth = 2; c.stroke();
      simgeCiz(c, d.ad, d.x, d.y - 1, d.r,
        d.kapali ? "rgba(168,158,142,.6)" : "rgba(252,238,204,.98)");
      /* Etiketin altında koyu bir yastık: sahne kalabalık, düz yazı
         yapraklara ve komşu düğmeye karışıyordu. */
      c.font = "600 9px system-ui,sans-serif"; c.textAlign = "center";
      var ew = c.measureText(d.etiket).width, ey2 = d.y + d.r + 11;
      c.fillStyle = "rgba(10,7,3,.72)";
      c.beginPath();
      if (c.roundRect) c.roundRect(d.x - ew / 2 - 3, ey2 - 8, ew + 6, 11, 4);
      else c.rect(d.x - ew / 2 - 3, ey2 - 8, ew + 6, 11);
      c.fill();
      c.fillStyle = d.kapali ? "rgba(178,168,152,.8)" : "rgba(250,236,204,.98)";
      c.fillText(d.etiket, d.x, d.y + d.r + 11);
    }
    /* KAPALIYSA SEBEBİ YAZILI. */
    if (e.engel) {
      c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = "rgba(236,124,108,.98)";
      c.fillText("makineli işler kapalı: " + e.yazi, y.x, y.alt);
      c.fillStyle = "rgba(214,200,178,.85)";
      c.fillText("hasat kayıt işi, açık", y.x, y.alt + 12);
    }
    c.restore();
  }
  /** Halkanın ve panelin ORTAK eylem yolu — iki yerde iki farklı onay
   *  metni olmasın diye tek gövde. */
  function bitkiEylem(ad, b) {
    if (!b) return;
    if (ad === "sula") {
      onayAc(b.ad + " " + sayi(b.sulama_saniye, 3).toFixed(1) + " saniye sulanacak.",
        "süre bitkinin kendi ayarından · geri alınamaz · sulamadan sonra nem ölçümü BAYATLAR",
        "Sula", function () { isGonder("sula", [b.ad]); });
    } else if (ad === "olc") {
      onayAc("Prob " + b.ad + " toprağına daldırılıp nem ölçülecek.",
        "ölçümden sonra taralı oyuk gerçek dolguya döner", "Ölç",
        function () { isGonder("nem", [b.ad]); });
    } else if (ad === "git") {
      onayAc("Eksen " + b.ad + " üstüne gidecek.",
        "X " + Math.round(sayi(b.x)) + " mm · Y " + Math.round(sayi(b.y)) + " mm",
        "Git", function () { isGonder("gez", [b.ad]); });
    } else if (ad === "yakin") {
      onayAc("Eksen " + b.ad + " üstüne gidip uç kamerasıyla yakından bakacak.",
        "çekilen kare büyüme filmine GİRMEZ — film yalnız üst kameradan",
        "Bak", function () {
          gonder("/api/bahce/yakin", { ad: b.ad })
            .then(function () { mesajYaz("Yakından bakma kuyruğa girdi."); return veriYukle(); })
            .catch(function (h2) { mesajYaz("Olmadı: " + ((h2 && h2.message) || h2)); });
        });
    } else if (ad === "hasat") {
      hasatOnay([b.ad]);
    }
  }
  /* ---------------------------------------------------- gezinme ve dokunuş
   *
   * TEKERLEK OLAYLARI TEK BİR requestAnimationFrame'DE TOPLANIYOR ve zoom
   * yalnız KAMERAYI güncelliyor; sahne yeniden kurulmuyor, zemin tuvali
   * yeniden çizilmiyor (ölçek fazla sapana kadar blit ediliyor). Bu ders
   * tarla.js'te `ustCerceve` başlığında yazılı; burada aynısı.
   *
   * Tek parmak/fare sürüklemesi kaydırıyor, iki parmak yakınlaştırıyor,
   * çift tıklama kadrajı içeriğe döndürüyor. Sürükleme olduysa bırakma
   * TIKLAMA SAYILMIYOR — yoksa her kaydırma bir "git" onayı açardı. */
  var gest = {
    isaretci: {}, adet: 0, kaydi: false, bas: null, son: null,
    ikiUzak: 0, ikiTw: 0,
    bekleyen: 0, dx: 0, dy: 0, adim: 0, ax: 0, ay: 0, olcek: 1, kaba: false,
    sonDokunusT: 0, sonDokunusX: 0, sonDokunusY: 0,
    etkin: false, bitir: 0
  };
  var CIFT_MS = 320, SURUKLE_ESIK = 6;
  /* Parmak ucu farenin ucundan geniş: dokunmatikte vuruş kutusu her
     yönde bu kadar büyüyor. Yalnız VURUŞ payı — çizim değişmiyor. */
  var DOKUNMA_PAYI = 12;

  function gestUygula() {
    gest.bekleyen = 0;
    /* ADIMLAR SAYILMIYOR, ÇARPANLAR ÇARPILIYOR: 1,1 ve 1/1,1 tek adım
       sayısına indirilse yakınlaştırma merkezi kayardı. */
    if (gest.adim || gest.olcek !== 1) {
      yakinlastir(Math.pow(1.12, gest.adim) * gest.olcek, gest.ax, gest.ay);
      gest.adim = 0; gest.olcek = 1;
    }
    if (gest.dx || gest.dy) { kaydir(gest.dx, gest.dy); gest.dx = 0; gest.dy = 0; }
    kirlet();
  }
  /** Hareket sürerken zemin dondurulur; 180 ms sessizlikte bir kez
   *  yeniden çizilir. Kullanıcı bunu "bıraktığımda netleşti" diye
   *  görüyor, "her adımda takıldı" diye değil. */
  function gestEtkinTut() {
    gest.etkin = true;
    clearTimeout(gest.bitir);
    gest.bitir = setTimeout(function () {
      gest.etkin = false;
      zeminCiz();
      kirlet();
    }, 180);
  }
  function gestIste() {
    if (!gest.bekleyen) gest.bekleyen = requestAnimationFrame(gestUygula);
  }

  var tuvalTekerlek = guvenli("tekerlek", function (e) {
    e.preventDefault();
    gest.ax = konum(e).x; gest.ay = konum(e).y;
    gest.adim += e.deltaY > 0 ? -1 : 1;
    gestEtkinTut(); gestIste();
  });

  function ikiliOrta() {
    var a = null, b = null, k;
    for (k in gest.isaretci) { if (!a) a = gest.isaretci[k]; else if (!b) b = gest.isaretci[k]; }
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
             uzak: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  var tuvalBasti = guvenli("dokunma", function (e) {
    e.preventDefault();
    var p = konum(e);
    gest.isaretci[e.pointerId] = p;
    /* DOKUNMATİKTE PARMAK PAYI: fare için yeterli alan telefonda dar
       kalıyor. Pay yalnız vuruşta, çizimde değil. */
    gest.kaba = (e.pointerType === "touch" || e.pointerType === "pen");
    gest.adet++;
    if (S.tuval.setPointerCapture) { try { S.tuval.setPointerCapture(e.pointerId); } catch (h) { } }
    if (gest.adet === 1) { gest.bas = p; gest.son = p; gest.kaydi = false; }
    else if (gest.adet === 2) {
      var o = ikiliOrta();
      if (o) { gest.ikiUzak = o.uzak; gest.ikiTw = G.kam.tw; gest.son = o; }
      gest.kaydi = true;                  /* iki parmak: tıklama değil */
    }
  });

  var tuvalKaydi = guvenli("gezinme", function (e) {
    var p = konum(e);
    if (gest.isaretci[e.pointerId]) {
      gest.isaretci[e.pointerId] = p;
      if (gest.adet >= 2) {
        var o = ikiliOrta();
        if (o && gest.ikiUzak > 0) {
          /* İKİ PARMAK: uzaklık oranı yakınlaştırma, orta noktanın
             kayması aynı anda kaydırma. */
          var hedefTw = kis(gest.ikiTw * (o.uzak / gest.ikiUzak), twEnAz(), twEnCok());
          gest.olcek *= hedefTw / G.kam.tw;
          gest.ax = o.x; gest.ay = o.y;
          if (gest.son) { gest.dx += o.x - gest.son.x; gest.dy += o.y - gest.son.y; }
          gest.son = o;
          gestEtkinTut(); gestIste();
        }
        return;
      }
      var d = Math.hypot(p.x - gest.bas.x, p.y - gest.bas.y);
      if (!gest.kaydi && d < SURUKLE_ESIK) return;
      gest.kaydi = true;
      gest.dx += p.x - gest.son.x; gest.dy += p.y - gest.son.y;
      gest.son = p;
      gestEtkinTut(); gestIste();
      return;
    }
    /* Parmak/tuş basılı değil: yalnız imleç altındaki karo. */
    var m = ekranMM(p.x, p.y);
    var yeni = icerdeMi(m.u, m.v)
      ? { u: Math.floor(m.u), v: Math.floor(m.v) } : null;
    var d1 = JSON.stringify(yeni), d2 = JSON.stringify(S.uzerinde);
    if (d1 !== d2) { S.uzerinde = yeni; kirlet(); }
    /* Sahne → panel: imlecin altındaki bitki panelde de parlıyor. */
    var b = bitkiBul(p, 0);
    var ad = b ? b.ad : "";
    if (ad !== S.vurgu) { S.vurgu = ad; panelVurgula(); kirlet(); }
  });
  var tuvalCikti = guvenli("çıkış", function () {
    if (S.uzerinde) { S.uzerinde = null; kirlet(); }
    if (S.vurgu) { S.vurgu = ""; panelVurgula(); kirlet(); }
  });

  var tuvalBirakti = guvenli("bırakma", function (e) {
    if (!gest.isaretci[e.pointerId]) return;
    var p = gest.isaretci[e.pointerId];
    delete gest.isaretci[e.pointerId];
    gest.adet = Math.max(0, gest.adet - 1);
    if (gest.adet === 1) {
      /* İki parmaktan bire düşüldü: kalan parmakla kaydırmaya devam. */
      var kalan = null, k;
      for (k in gest.isaretci) kalan = gest.isaretci[k];
      gest.son = kalan; gest.bas = kalan; gest.kaydi = true;
      gest.ikiUzak = 0;
      return;
    }
    if (gest.adet > 0) return;
    if (gest.kaydi) { gest.kaydi = false; return; }
    /* ÇİFT DOKUNUŞ: kadraj içeriğe döner. */
    var simdi = Date.now();
    if (simdi - gest.sonDokunusT < CIFT_MS
        && Math.hypot(p.x - gest.sonDokunusX, p.y - gest.sonDokunusY) < 20) {
      gest.sonDokunusT = 0;
      kadrajaDon();
      return;
    }
    gest.sonDokunusT = simdi; gest.sonDokunusX = p.x; gest.sonDokunusY = p.y;
    karoyaDokun(p);
  });

  function karoyaDokun(p) {
    var pay = gest.kaba ? DOKUNMA_PAYI : 3;
    /* SIRA: önce açık halkanın düğmeleri, sonra bitki, sonra karo.
       Halka açıkken karo dalı tetiklenmiyor; boşluğa dokunmak halkayı
       kapatıyor ve orada duruyor. */
    if (S.halkaAd) {
      var d = halkaVurus(p, pay);
      if (d) {
        if (d.kapali) { mesajYaz("Bu iş şimdi yapılamaz: " + eksenEngeli().yazi + "."); return; }
        bitkiEylem(d.ad, S.ix[S.halkaAd]);
        return;
      }
    }
    var b = bitkiBul(p, pay);
    if (b) {
      S.secili = (S.secili === b.ad) ? "" : b.ad;
      S.halkaAd = S.secili;
      if (S.secili) gecmisAl(S.secili);
      panelYaz(); altYaz(); kirlet();
      return;
    }
    if (S.halkaAd) {
      S.halkaAd = ""; S.secili = "";
      panelYaz(); kirlet();
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
    if (S.tasiKip) { tasiOnay(mx, my); return; }
    if (S.tepsiTur) { ekimOnay(mx, my); return; }
    gitOnay(mx, my);
    kirlet();
  }

  /** TAŞIMA KAYITTIR: makine kımıldamıyor, bitkinin x/y'si değişiyor.
   *  Sunucu yatak sınırını ve dikim alanını kendi denetliyor; burada
   *  yalnız çakışmayı önden söylüyoruz ki kullanıcı boşa onaylamasın. */
  function tasiOnay(mx, my) {
    var b = S.ix[S.tasiKip];
    if (!b) { S.tasiKip = ""; return; }
    var r = sayi(b.yayilim_mm, sayi(b.yaricap_mm, 30) * 2) / 2;
    for (var i = 0; i < S.bitki.length; i++) {
      var o = S.bitki[i];
      if (String(o.ad) === String(b.ad)) continue;
      var orr = sayi(o.yayilim_mm, sayi(o.yaricap_mm, 30) * 2) / 2;
      if (Math.hypot(sayi(o.x) - mx, sayi(o.y) - my) < r + orr) {
        mesajYaz("Oraya taşınamaz — " + o.ad + " ile çakışıyor.");
        S.hedefKaro = null; kirlet(); return;
      }
    }
    onayAc(b.ad + " X " + Math.round(mx) + " mm, Y " + Math.round(my) + " mm noktasına taşınacak.",
      "kayıt işi — makine kımıldamaz · bitkinin ekim tarihi ve geçmişi korunur",
      "Taşı", function () {
        gonder("/api/bahce/tasi", { ad: b.ad, x: mx, y: my })
          .then(function () {
            S.tasiKip = ""; S.hedefKaro = null;
            mesajYaz(b.ad + " taşındı.");
            return veriYukle();
          })
          .catch(function (h2) {
            S.hedefKaro = null;
            mesajYaz("Taşınamadı: " + ((h2 && h2.message) || h2));
          });
      }, function () { S.hedefKaro = null; kirlet(); });
  }

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

    /* ÖNCE BİLİNEN, SONRA BİLİNMEYEN.
       Eski kutu dört satırın üçünde "yok" diyordu: doğru ama kullanılmaz.
       Artık okunan her ölçüm ne olduğunu ve SAHNEDE neyi değiştirdiğini
       söylüyor; okunamayanlar tek bir sönük dipnotta toplanıyor. */
    var hv = S.hava, olculu = 0, olculmeyen = [];
    S.bitki.forEach(function (bb) {
      var nn = nemDurum(bb);
      if (nn.var && nn.kendi) olculu++; else olculmeyen.push(String(bb.ad));
    });
    var bilinen = [], eksik = [];
    if (hv.nem == null) eksik.push("hava nemi");
    else {
      bilinen.push("Hava nemi <b>%" + Math.round(hv.nem) + "</b> — "
        + (pusGucu() > 0.35 ? "sahne puslu çiziliyor." : "sahne berrak."));
    }
    if (hv.sicaklik == null) eksik.push("hava sıcaklığı");
    else {
      bilinen.push("Hava <b>" + hv.sicaklik.toFixed(1) + " °C</b> — sahnenin ışığı "
        + (hv.sicaklik >= 24 ? "sıcak" : (hv.sicaklik <= 14 ? "soğuk" : "ılık")) + " tonda.");
    }
    if (hv.egim == null) eksik.push("basınç eğilimi (üç saatlik ölçüm yetmedi)");
    else {
      bilinen.push("Basınç saatte <b>" + (hv.egim > 0 ? "+" : "") + hv.egim.toFixed(1)
        + " hPa</b> " + (hv.egim < -0.2 ? "düşüyor — gök ağırlaşıyor."
          : (hv.egim > 0.2 ? "yükseliyor — gök açılıyor." : "sabit — gök durgun.")));
    }
    h.push('<div class="bh-p-hava"><span class="bas">Bugün</span><ul>'
      + (bilinen.length ? bilinen.map(function (t) { return "<li>" + t + "</li>"; }).join("")
                        : '<li class="yok">Henüz okunmuş bir ölçüm yok.</li>'));
    /* NEM BİR İSTATİSTİK DEĞİL, BİR GÖREV: ölçülmeyen varsa yapılacak iş
       düğmesiyle birlikte duruyor. */
    if (!S.bitki.length) {
      h.push('<li class="yok">Yatakta bitki yok.</li>');
    } else if (!olculmeyen.length) {
      h.push('<li class="olculdu">' + S.bitki.length
        + " bitkinin nemi ölçülü — bekleyen ölçüm yok.</li>");
    } else {
      h.push('<li class="gorev">'
        + (olculu ? olculmeyen.length + " bitkinin nemi ölçülmedi ("
                    + olculu + " bitki ölçülü)."
                  : "Hiçbir bitkinin nemi ölçülmedi.")
        + " Sahnede taralı oyuk olarak duruyorlar."
        + '<button type="button" class="asil" data-bh="nem-hepsi"'
        + (bagli ? "" : " disabled")
        + '>' + olculmeyen.length + " bitkinin nemini ölç</button></li>");
    }
    if (eksik.length) {
      h.push('<li class="yok dipnot">Okunamayan: ' + kacisli(eksik.join(", "))
        + ". Yağmur, ışık ve rüzgâr sensörü yok.</li>");
    } else {
      h.push('<li class="yok dipnot">Yağmur, ışık ve rüzgâr sensörü yok.</li>');
    }
    h.push("</ul></div>");

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
      /* DÜĞMELER MAKİNE KOPUKKEN KAPALI VE SEBEBİ YAZILI. Hasat ve taşıma
         KAYIT işi (sunucu tarafında makine hareket etmiyor), o yüzden
         onlar kopukken de açık — kapatmak yapılabilir bir işi yasaklamak
         olurdu. */
      var kapali = bagli ? "" : " disabled";
      h.push('<div class="bh-p-bitki" data-ad="' + kacisli(b.ad) + '">'
        + '<div class="bh-p-bas">'
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
        + (b.hasat ? '<li class="hasat">hasada hazır — toplayınca yataktan düşür</li>' : "")
        + '<li class="sonuk">' + kacisli(KOK_ADI[bic.kok] || KOK_ADI.bilinmiyor)
        + (bic.bilinen ? " · tür biçimi, ölçülmedi" : "") + "</li>"
        /* Siluetin nereden geldiği yazılı: türün kendi çizimi mi, yoksa
           aile biçimi mi. Kullanıcı "bu neden şuna benziyor" diye
           sorduğunda cevabı burada. */
        + (bic.bilinen
          ? '<li class="sonuk">siluet: ' + (bic.ozel ? "türe özel" : "aile biçimi (" + kacisli(bic.ust) + ")") + "</li>"
          : '<li class="susadi">tür tanınmadı — jenerik biçim çiziliyor</li>')
        + (S.gecmis && S.gecmis.egilim
          ? "<li>" + S.gecmis.egilim.adet + " ölçüm · "
            + (sayi(S.gecmis.egilim.degisim) > 0 ? "+" : "")
            + sayi(S.gecmis.egilim.degisim).toFixed(1) + " puan</li>"
          : (S.gecmis && S.gecmis.adet === 1 ? '<li class="sonuk">tek ölçüm — eğilim yok</li>' : ""))
        + "</ul>"
        + '<div class="bh-p-dugme">'
        + (b.hasat
          ? '<button type="button" class="asil" data-bh="hasat">Hasat et</button>'
          : '<button type="button" data-bh="hasat" class="sade">Yine de hasat et</button>')
        + '<button type="button" data-bh="sula"' + kapali + ">Sula</button>"
        + '<button type="button" data-bh="olc"' + kapali + ">Nemini ölç</button>"
        + '<button type="button" data-bh="git"' + kapali + ">Üstüne git</button>"
        + '<button type="button" data-bh="yakin"' + kapali + ">Yakından bak</button>"
        + '<button type="button" data-bh="tasi"'
        + (S.tasiKip ? ' class="asil"' : "") + ">"
        + (S.tasiKip ? "Taşımayı bırak" : "Taşı") + "</button>"
        + '<button type="button" data-bh="birak" class="sade">Seçimi bırak</button></div>'
        + (bagli ? "" : '<p class="bh-p-sebep">Makineli işler kapalı: '
            + kacisli(e.yazi) + ". Hasat ve taşıma kayıt işi, onlar açık.</p>")
        + (S.tasiKip ? '<p class="bh-p-sebep">Taşıma açık — bitkiyi koyacağın karoya '
            + "dokun. Bu bir KAYIT işi, makine kımıldamaz.</p>" : "")
        + "</div>");
    }

    var kartlar = acikKartlar();
    h.push('<div class="bh-p-baslik">Görevler</div>');
    if (!kartlar.length) {
      h.push('<p class="bh-p-bos">' + (S.veri ? "Bugün bekleyen iş yok." : "Bahçe okunuyor…") + "</p>");
    }
    kartlar.forEach(function (k, i) {
      h.push('<div class="bh-kart' + (k.ertelendi ? " ertelendi" : "") + '" data-ix="' + i + '"'
        + ' data-adlar="' + kacisli((k.noktalar || []).join(",")) + '">'
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
            + (k.tip === "hasat"
              ? '<button type="button" data-bh="kart-hasat" data-ix="' + i
                + '">Hasat et</button>' : "")
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
  /** HASAT KAYITTIR, hareket değil: makine toplamıyor, kullanıcı topluyor.
   *  Yaptığımız şey bitkiyi yataktan düşürmek. Sunucuda 30 saniyelik geri
   *  alma penceresi var, o yüzden "geri alınamaz" demiyoruz. */
  function hasatOnay(adlar) {
    if (!adlar || !adlar.length) return;
    onayAc(adlar.length + " bitki hasat edildi olarak işaretlenecek ve yataktan düşecek.",
      "makine kımıldamaz — bunu siz topluyorsunuz · fotoğraf filmi silinmiyor"
        + " · 30 saniye geri alma penceresi var",
      "Hasat et", function () {
        gonder("/api/bahce/hasat", { noktalar: adlar })
          .then(function (c) {
            S.secili = ""; S.tasiKip = "";
            mesajYaz((c && c.mesaj) || adlar.length + " bitki hasat edildi.");
            return veriYukle();
          })
          .catch(function (h2) { mesajYaz("Hasat edilemedi: " + ((h2 && h2.message) || h2)); });
      });
  }
  /** Panel ile sahne birbirini işaret ediyor. Tam panel yeniden yazılmıyor:
   *  yalnız sınıf ekleniyor — imleç gezerken innerHTML kurmak pahalı. */
  var panelVurgula = guvenli("vurgu", function () {
    var kok = $("#bh-panel");
    if (!kok) return;
    var hepsi = kok.querySelectorAll("[data-ad], [data-adlar]"), i, el, adlar;
    for (i = 0; i < hepsi.length; i++) {
      el = hepsi[i];
      adlar = (el.dataset.ad || el.dataset.adlar || "").split(",");
      el.classList.toggle("vurgu", !!S.vurgu && adlar.indexOf(S.vurgu) >= 0);
    }
  });

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
    } else if (ad === "birak") { S.secili = ""; S.halkaAd = ""; panelYaz(); kirlet(); }
    else if ((ad === "sula" || ad === "olc" || ad === "git" || ad === "yakin"
              || ad === "hasat") && b) {
      bitkiEylem(ad, b);
    } else if (ad === "kart-hasat" && k) { hasatOnay((k.noktalar || []).map(String)); }
    else if (ad === "tasi" && b) {
      S.tasiKip = S.tasiKip ? "" : b.ad;
      mesajYaz(S.tasiKip ? b.ad + " taşınacak — yeni yerine dokun." : "Taşıma bırakıldı.");
      panelYaz(); kirlet();
    } else if (ad === "nem-hepsi") {
      var olcusuz = S.bitki.filter(function (bb) {
        var nn = nemDurum(bb); return !(nn.var && nn.kendi);
      }).map(function (bb) { return String(bb.ad); });
      if (!olcusuz.length) { mesajYaz("Ölçülmemiş bitki kalmadı."); return; }
      onayAc(olcusuz.length + " bitkinin toprağına sırayla prob daldırılacak.",
        "her ölçümden sonra o bitkinin taralı oyuğu gerçek dolguya döner",
        "Ölç", function () { isGonder("nem", olcusuz); });
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
    S.tuval.addEventListener("pointerup", tuvalBirakti);
    S.tuval.addEventListener("pointercancel", tuvalBirakti);
    S.tuval.addEventListener("pointerleave", tuvalCikti);
    S.tuval.addEventListener("wheel", tuvalTekerlek, { passive: false });
    /* Çift tıklama ayrı bir dinleyiciyle DEĞİL, pointerup'taki çift dokunuş
       yoluyla yakalanıyor: ikisi birden bağlıysa kadraj iki kez sıfırlanır. */
    $("#bh-kok").addEventListener("click", tiklama);
    /* PANEL → SAHNE: kartın ya da künyenin üstüne gelince o bitkiler
       sahnede parlıyor. Ters yön (sahne → panel) tuvalin gezinmesinde. */
    $("#bh-panel").addEventListener("pointerover", guvenli("panel gezinme", function (e) {
      var el = e.target.closest("[data-ad], [data-adlar]");
      var liste = el ? (el.dataset.ad || el.dataset.adlar || "").split(",").filter(Boolean) : [];
      if (liste.join(",") === S.vurguListe.join(",")) return;
      S.vurguListe = liste; kirlet();
    }));
    $("#bh-panel").addEventListener("pointerleave", guvenli("panel çıkış", function () {
      if (S.vurguListe.length) { S.vurguListe = []; kirlet(); }
    }));
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
      if (S.tasiKip) { S.tasiKip = ""; mesajYaz("Taşıma bırakıldı."); panelYaz(); return; }
      if (S.tepsiTur) { S.tepsiTur = ""; tepsiYaz(); mesajYaz(""); return; }
      if (S.halkaAd) { S.halkaAd = ""; kirlet(); return; }
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
    if (S.halkaAd && !S.ix[S.halkaAd]) S.halkaAd = "";
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
    /** Vuruş kutuları — ekranda gördüğümüzle tıklanan alanın aynı olduğunu
     *  doğrulamanın yolu. Ölçüm okuması, çizimi etkilemiyor. */
    vurusKutulari: function () {
      return S.bitki.map(function (b) {
        var k = vurusKutusu(b, 0), sp = spriteAl(b);
        return { ad: k.ad, x1: +k.x1.toFixed(1), x2: +k.x2.toFixed(1),
                 y1: +k.y1.toFixed(1), y2: +k.y2.toFixed(1),
                 en: +(k.x2 - k.x1).toFixed(1), boy: +(k.y2 - k.y1).toFixed(1),
                 derinlik: +k.derinlik.toFixed(3), R: +sp.R.toFixed(1),
                 eskiBoy: +(2 * Math.max(6, sp.R * ISO_ORAN)).toFixed(1),
                 eskiEn: +(2 * Math.max(10, sp.R)).toFixed(1) };
      });
    },
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
