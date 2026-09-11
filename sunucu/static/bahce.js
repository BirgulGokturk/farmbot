/* Bahçe — YATAĞIN KENDİSİ.
 *
 * ---------------------------------------------------------------------
 * ÖRGÜTLEYİCİ FİKİR
 * ---------------------------------------------------------------------
 * Bu ekran bir pano değil, bir YER. Üstten bakılan gerçek bir bahçe
 * yatağı: çim, tahta çerçeve, toprak, iki yanda ray, üstünde uç. Sekme
 * açılınca bahçe sıfırdan kuruluyor — çim çıkıyor, tahtalar oturuyor,
 * toprak dökülüyor, raylar geliyor, tohumlar düşüyor, bitkiler kendi
 * yaşlarına kadar büyüyor.
 *
 * Düzenin tamamı iki karardan çıkıyor:
 *
 *   1. BİLGİ TOPRAĞIN KENDİSİNE YAZILIYOR, kenardaki kutulara değil.
 *      Nemi ölçülen bitkinin altında ıslak bir leke var; ölçülmeyenin
 *      toprağı soğuk bir tülle ve ince taramayla kaplı. Rozet yok, soru
 *      işareti yok — "bilmiyoruz" toprağın görüntüsü.
 *
 *   2. EYLEM YERİN KENDİSİNDEN ÇIKIYOR, menüden değil.
 *      Uca dokun, aletleri ucun çevresinde açılır. Bitkiye dokun,
 *      eylemleri onun çevresinde açılır. Boş toprağa uzun bas, tohum
 *      tepsisi orada açılır. Kirişi sürükle, makinenin hayaleti gider.
 *      Sulamada düğmeyi basılı tut, tuttuğun kadar saniye yazılır.
 *
 * ELENEN ALTERNATİFLER
 *   1. ÖNDEN KESİT (bir önceki sürüm). Nem toprağın derinliğinde
 *      yaşıyordu ve bu doğruydu; ama kesitin dikey ekseni hem büyümeyi
 *      hem nemi taşıyınca hiçbir eksen dürüst bir ölçek olamadı, ve
 *      daha önemlisi kesit İÇİNDE İŞ YAPILAN bir yer değildi: bakılan
 *      bir diyagramdı.
 *   2. DÖRT "BİLME" EKRANI (nöbet duvarı, karar alanı, gün şeridi,
 *      künye tablosu). Dördü de bilgiyi çok iyi örgütlüyordu ve
 *      dördünde de kullanıcının YAPACAĞI bir şey yoktu. Bahçeye bağ
 *      okuyarak değil dokunarak kuruluyor.
 *
 * ---------------------------------------------------------------------
 * BOZULMAYAN KURALLAR
 * ---------------------------------------------------------------------
 * · Ölçülmemiş, ölçülmüş gibi görünmez. Ölçülen nem ıslak leke; ölçüm
 *   yoksa tül + tarama; ödünç okuma ve bayat okuma kendi işaretiyle.
 *   Sulamak ölçümü bayatlatır — leke gider, tarama gelir.
 * · Sessiz başarısızlık yok: her giriş `guvenli()` içinden geçer, hata
 *   ekranın üstünde adıyla yazılır.
 * · Geri alınamaz iş (sulama, ekim) önce ne olacağını yazar, sonra onay
 *   ister. Makine kopukken o eylemler kilitli ve sebebi yazılı.
 * · Uydurma yok: makine ancak gerçekten hareket ederse hareket eder;
 *   sürüklenen şey HAYALET, gerçeği onaydan sonra gider.
 *
 * ---------------------------------------------------------------------
 * ELE ALINAN ŞEYLER — YAN RAYLAR
 * ---------------------------------------------------------------------
 * Solda alet rayı: su, nem probu, kamera, yakın bak. Aleti tutup bitkinin
 * üstüne bırakınca iş kuyruğa giriyor; bırakmak NİYET, onay KARAR.
 * Bunlar makinenin işi olduğu için makine kopukken ray kilitli ve sebebi
 * rayın üstünde yazılı. Çalışan işin aleti ucun üstünde duruyor: ekranda
 * elindeki alet ile makinedeki alet aynı şey.
 * Sağda sepet: bitkiyi sepete bırakmak HASAT (kayıt), yatağın içinde
 * başka bir yere bırakmak TAŞIMA (kayıt). İkisinde de makine kımıldamıyor,
 * bu yüzden kopukken de çalışıyorlar. Sınırı ve dikim alanını sunucu
 * denetliyor; ret gelirse sebebi ekranda.
 *
 * ---------------------------------------------------------------------
 * SUNUCUDA ZATEN VAR OLAN UÇLAR — ekran onları BAĞLIYOR, yenisini
 * istemiyor:
 *   /api/bitki          → nem geçmişi, eğilim, sulama/ölçüm sayaçları.
 *                         Uç `sunucu/bitki.py` içinde; `main.py` onu
 *                         `include_router` ile bağlıyor, o yüzden
 *                         `main.py` içinde aranınca görünmüyor.
 *   /api/bahce/film     → bu ekimin kareleri; `/api/bahce` her bitkiyle
 *                         `film_kimlik` ve `film_kare` veriyor, kareler
 *                         `/api/bahce/film/kare`den geliyor.
 *   /api/bahce/esik     → sulama nem eşiği (TÜR ezmesi). Kadran KALDIRILDI;
 *                         eşiğin kendisi bitki kartında okunuyor,
 *                         değiştirmek teknik panelin tür ezmesinde.
 *   /api/bahce/is/iptal → kuyruktaki işi düşürüyor; çalışan işi sunucu
 *                         409 ile geri çeviriyor, o cevap ekrana olduğu
 *                         gibi yazılıyor.
 *
 * ---------------------------------------------------------------------
 * SU
 * ---------------------------------------------------------------------
 * Damla ve ıslaklık yalnız su gerçekten aktığında çiziliyor: önce röle
 * (`Panel.S.roleDurum.su_pompasi`), o yoksa kuyrukta çalışan sulama işi —
 * ikincisinde ekranda "röle okunmuyor · çalışan işten" yazıyor. Su UCUN
 * BİLDİRİLEN KONUMUNA düşüyor; konum bildirilmemişse hiçbir yere damla
 * çizilmiyor ve sebebi yatağın altında yazıyor. Sahne kuşbakışı olduğu
 * için damlalar aşağı düşmüyor, dışa saçılıyor. Taze sulamanın serin
 * parıltısı var, ölçülmüş nem lekesinin yok: ikisi karışmasın diye.
 *
 * ---------------------------------------------------------------------
 * PERFORMANS (Raspberry Pi 5, 800×480 ve telefon)
 * ---------------------------------------------------------------------
 * Çim, toprak ve NEM KATMANI birer kez ayrı tuvale çiziliyor, sahneye tek
 * drawImage ile basılıyor. Nemin ayrı tuvalde olması şart: tül ölçülen
 * bitkilerin çevresinde `destination-out` ile deliniyor ve bu ana tuvalde
 * yapılınca toprağı da siliyordu — ekranda kocaman siyah bir leke
 * çıkıyordu. Nem katmanı yalnız veri değiştiğinde yeniden çiziliyor. Bitki siluetleri önbellekte; salınım yalnız bir
 * döndürme. Canlandırma 20 kare/sn ile sınırlı, sekme kapalıyken ve
 * sakin modda hiç kare yok.
 */
window.Bahce = (function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var P = function () { return window.Panel || {}; };

  /* Mantıksal tuval — panelin kendi ölçüsü değil, ÇİZİM uzayı. Gerçek
     piksel sayısı ölçekle çarpılıyor; oranlar her ekranda aynı. */
  var UST = 0, ALT = 0;                 /* şeritler DOM'da, tuval tam alan */
  var CIM_YOGUNLUK = 95;                /* bir çim yaprağı düşen piksel alanı */
  var NEM_YARICAP_MM = 150;             /* okumanın etki alanı (sulama.py ile aynı fikir) */
  var UZUN_BAS_MS = 420;
  var CANLI_FPS = 20;

  var S = {
    acik: false, veri: null, yukleniyor: false, sakin: false,
    tuval: null, ct: null, en: 0, boy: 0, olcek: 1,
    cim: null, cimCt: null, cimYaprak: [], cimIx: 0,
    toprak: null, toprakCt: null, sprite: {},
    bitki: [], ix: {},
    makine: { x: 0, y: 0, z: null }, robot: null, hayalet: null,
    halka: false, alet: "", secili: "", eylemIx: -1,
    basiliSula: false, basiliSn: 0, basiliT0: 0,
    ekimNokta: null, ekimTur: "", katalog: null, katalogT: 0,
    gecmis: null, gecmisAd: "", gecmisT: 0,
    onay: null, kartIx: 0, isKip: "kart",
    insaT: 0, insaBitti: true, insaVar: false,
    t: 0, sonT: 0, dongu: 0, sonCizim: 0,
    nemKat: null, nemKatCt: null, nemDamga: "",
    islak: [], damla: [], suAkiyor: false, suKanit: "yok",
    ray: [], sepet: null, tasima: null, tasimaHedef: null, durDugme: null, suSesT: 0,
    sesDugme: null, konumVar: false, hareketSes: false, enable: false, acil: false, hareket: false,
    jog: null, jogBasili: null, jogSayac: null, olcumVeri: null, olcumT: 0,
    olcumHata: "", sensorKutu: null,
    film: null, gorevKutu: null, kartKutu: null,
    gorevTuval: null, gorevCt: null, gorevDamga: "",
    balonlar: [], parcalar: [], bulutlar: null,
    toz: [], ari: null, mesaj: "", mesajT: 0,
    notlar: {}, hatalar: [],
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
  function kyGeri(t) { var x = kis(t, 0, 1) - 1; return 1 + x * x * (2.2 * x + 1.2); }
  function gunluk(m, s) { if (P().gunluk) P().gunluk(m, s || ""); }
  function api(yol, sec) { return P().apiIste(yol, sec); }
  function gonder(yol, govde) {
    return api(yol, { method: "POST", body: JSON.stringify(govde) });
  }
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
  function tarih(ts) {
    var d = sayi(ts, 0);
    if (!d) return "";
    try {
      return new Date(d * 1000).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
    } catch (h) { return ""; }
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
  function mesajYaz(m) { S.mesaj = m || ""; S.mesajT = S.t; altYaz(); }

  /* ==================================================================== *
   * GEOMETRİ — yatağın milimetresi ile tuvalin pikseli arasında TEK ölçek.
   * Bir eksen ötekinden farklı ezilmiyor; bahçe gerçek oranında duruyor.
   * ==================================================================== */
  var G = { k: 1, ox: 0, oy: 0, bw: 0, bh: 0, kal: 10, ray: 10 };

  function yatakSinir() {
    var s = (S.veri && S.veri.sinirlar) || {};
    var x = s.x || {}, y = s.y || {};
    var x1 = sayi(x.min, 0), x2 = sayi(x.max, 580);
    var y1 = sayi(y.min, 0), y2 = sayi(y.max, 640);
    if (x2 - x1 < 10) { x1 = 0; x2 = 580; }
    if (y2 - y1 < 10) { y1 = 0; y2 = 640; }
    return { x1: x1, x2: x2, y1: y1, y2: y2 };
  }
  function yerlesim() {
    var s = yatakSinir();
    var mmEn = s.x2 - s.x1, mmBoy = s.y2 - s.y1;
    /* Kenar payı: çerçeve tahtası + ray + biraz çim. */
    var pay = Math.max(40, Math.min(S.en, S.boy) * 0.11);
    var ic = { x: pay, y: 10, w: S.en - pay * 2, h: S.boy - 20 };
    var k = Math.min(ic.w / mmEn, ic.h / mmBoy);
    G.k = k;
    G.bw = mmEn * k; G.bh = mmBoy * k;
    G.ox = ic.x + (ic.w - G.bw) / 2;
    G.oy = ic.y + (ic.h - G.bh) / 2;
    G.kal = Math.max(8, Math.min(26, k * 26));      /* tahta kalınlığı */
    G.ray = Math.max(7, Math.min(16, k * 16));      /* ray genişliği */
    G.s = s;
    rayKur();
    gorevKur();
    sensorKur();
    jogKur();
  }
  function px(mx) { return G.ox + (sayi(mx) - G.s.x1) * G.k; }
  function py(my) { return G.oy + (sayi(my) - G.s.y1) * G.k; }
  function mmx(sx) { return G.s.x1 + (sx - G.ox) / G.k; }
  function mmy(sy) { return G.s.y1 + (sy - G.oy) / G.k; }
  function rp(mm) { return sayi(mm) * G.k; }
  function yataktaMi(sx, sy) {
    return sx > G.ox && sx < G.ox + G.bw && sy > G.oy && sy < G.oy + G.bh;
  }

  /* ==================================================================== *
   * TÜR BİÇİMLERİ — üstten.
   *
   * Bakan kişi hangi türe baktığını okumadan anlamalı: marul rozet açar,
   * havuç tüy salar, soğan bıçak gibi yapraklar verir, fesleğen karşılıklı
   * yuvarlak yapraklar, kabakgiller geniş loblu yapraklar, ayçiçeği tabak.
   *
   * BİÇİM BİR ÖLÇÜ DEĞİL. Katalog türün BİÇİMİNİ biliyor, boyutu ise
   * gerçek veriden geliyor (`yaricap_mm`). Tür tanınmıyorsa uydurma bir
   * bitki çizilmiyor: kesik çizgili jenerik öbek ve "tür tanınmadı".
   * ==================================================================== */
  var TUR_BICIM = {
    marul: "rozet", lahana: "rozet", ispanak: "rozet", pazi: "rozet", roka: "rozet",
    kereviz: "rozet", karnabahar: "rozet", brokoli: "rozet", semizotu: "rozet",
    havuc: "tuy", dereotu: "tuy", maydanoz: "tuy",
    sogan: "bicak", sarimsak: "bicak", pirasa: "bicak", misir: "bicak",
    feslegen: "cift", "fesleğen": "cift", nane: "cift", kekik: "cift", biberiye: "cift",
    domates: "genis", biber: "genis", patlican: "genis", bamya: "genis",
    kabak: "genis", karpuz: "genis", kavun: "genis", salatalik: "genis",
    fasulye: "genis", bezelye: "genis", nohut: "genis", uzum: "genis",
    cilek: "genis", "tatli-patates": "genis", patates: "genis",
    aycicegi: "bas", turp: "turp"
  };
  function bicimSec(b) {
    var slug = String((b && b.tur) || "").toLowerCase();
    var bic = TUR_BICIM[slug];
    if (bic) return { bicim: bic, bilinen: true, slug: slug };
    return { bicim: "bilinmiyor", bilinen: false, slug: slug };
  }
  var YAPRAK = { r: 111, g: 174, b: 85 };
  function yaprakRengi(renk) { return karis(renk, YAPRAK, 0.74); }

  function yaprak(x, uz, en, ic, dis) {
    var g = x.createLinearGradient(0, -en, uz, en);
    g.addColorStop(0, ic); g.addColorStop(1, dis);
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(uz * 0.3, -en, uz * 0.78, -en * 0.82, uz, 0);
    x.bezierCurveTo(uz * 0.78, en * 0.82, uz * 0.3, en, 0, 0);
    x.fill();
    x.strokeStyle = "rgba(255,255,255,.16)";
    x.lineWidth = Math.max(0.5, en * 0.1);
    x.beginPath(); x.moveTo(uz * 0.06, 0); x.lineTo(uz * 0.9, 0); x.stroke();
  }

  function spriteCiz(x, bicim, R, yes, tur, r) {
    var i, n, a, kat, adet;
    var koyu = ton(yes, -0.28), acik = ton(yes, 0.22);
    if (bicim === "rozet") {
      for (n = 3; n >= 1; n--) {
        kat = n / 3; adet = 5 + n * 3;
        for (i = 0; i < adet; i++) {
          a = (i / adet) * Math.PI * 2 + n * 0.55 + r() * 0.18;
          x.save(); x.rotate(a);
          yaprak(x, R * kat * (0.85 + r() * 0.28), R * kat * 0.52,
            rgba(n === 1 ? acik : yes, 1), rgba(n === 3 ? koyu : yes, 1));
          x.restore();
        }
      }
      x.fillStyle = rgba(acik, 0.95);
      x.beginPath(); x.arc(0, 0, R * 0.13, 0, 6.3); x.fill();
    } else if (bicim === "tuy") {
      for (i = 0; i < 24; i++) {
        a = r() * Math.PI * 2;
        var uz = R * (0.45 + r() * 0.55);
        x.strokeStyle = rgba(i % 3 ? yes : acik, 0.95);
        x.lineWidth = Math.max(0.8, R * 0.035); x.lineCap = "round";
        x.beginPath(); x.moveTo(0, 0);
        x.quadraticCurveTo(Math.cos(a) * uz * 0.5 + (r() - 0.5) * R * 0.2,
          Math.sin(a) * uz * 0.5, Math.cos(a) * uz, Math.sin(a) * uz);
        x.stroke();
        x.lineWidth = Math.max(0.5, R * 0.02);
        for (var k = 1; k <= 3; k++) {
          var p = 0.35 + k * 0.2, hx = Math.cos(a) * uz * p, hy = Math.sin(a) * uz * p;
          var l = R * 0.09;
          x.beginPath(); x.moveTo(hx - l, hy - l * 0.65); x.lineTo(hx + l, hy + l * 0.65); x.stroke();
        }
      }
    } else if (bicim === "bicak") {
      for (i = 0; i < 7; i++) {
        a = (i / 7) * Math.PI * 2 + 0.4 + r() * 0.2;
        x.save(); x.rotate(a);
        yaprak(x, R * (0.9 + r() * 0.22), R * 0.13, rgba(acik, 1), rgba(yes, 1));
        x.restore();
      }
      x.fillStyle = rgba(ton(yes, 0.35), 0.9);
      x.beginPath(); x.arc(0, 0, R * 0.2, 0, 6.3); x.fill();
    } else if (bicim === "cift") {
      for (n = 2; n >= 1; n--) {
        for (i = 0; i < 4; i++) {
          a = (i / 4) * Math.PI * 2 + n * 0.78;
          x.save(); x.rotate(a); x.translate(R * 0.16 * n, 0);
          var g2 = x.createRadialGradient(R * 0.3, -R * 0.05, 1, R * 0.3, 0, R * 0.45);
          g2.addColorStop(0, rgba(acik, 1)); g2.addColorStop(1, rgba(yes, 1));
          x.fillStyle = g2;
          x.beginPath();
          x.ellipse(R * 0.32 * n, 0, R * 0.34 * n, R * 0.25 * n, 0, 0, 6.3);
          x.fill();
          x.strokeStyle = "rgba(255,255,255,.14)"; x.lineWidth = Math.max(0.5, R * 0.02);
          x.beginPath(); x.moveTo(0, 0); x.lineTo(R * 0.58 * n, 0); x.stroke();
          x.restore();
        }
      }
    } else if (bicim === "genis") {
      for (i = 0; i < 6; i++) {
        a = (i / 6) * Math.PI * 2 + r() * 0.3;
        var uzk = R * (0.5 + r() * 0.28);
        x.save();
        x.translate(Math.cos(a) * uzk * 0.62, Math.sin(a) * uzk * 0.62);
        x.rotate(a + (r() - 0.5) * 0.5);
        x.beginPath();
        for (var q = 0; q <= 20; q++) {
          var tq = (q / 20) * Math.PI * 2;
          var kq = R * 0.42 * (0.78 + 0.22 * Math.cos(tq * 5));
          var pxq = Math.cos(tq) * kq, pyq = Math.sin(tq) * kq * 0.62;
          if (q === 0) x.moveTo(pxq, pyq); else x.lineTo(pxq, pyq);
        }
        x.closePath();
        x.fillStyle = rgba(i % 2 ? yes : ton(yes, 0.12), 0.95);
        x.fill();
        x.strokeStyle = rgba(koyu, 0.5); x.lineWidth = Math.max(0.5, R * 0.018); x.stroke();
        x.restore();
      }
    } else if (bicim === "bas") {
      for (i = 0; i < 5; i++) {
        a = (i / 5) * Math.PI * 2;
        x.save(); x.rotate(a);
        yaprak(x, R * 0.92, R * 0.34, rgba(yes, 1), rgba(koyu, 1));
        x.restore();
      }
      var tr = hexRGB((tur && tur.renk) || "#facc15");
      for (i = 0; i < 14; i++) {
        a = (i / 14) * Math.PI * 2;
        x.fillStyle = rgba(ton(tr, 0.1), 0.95);
        x.beginPath();
        x.ellipse(Math.cos(a) * R * 0.34, Math.sin(a) * R * 0.34, R * 0.2, R * 0.1, a, 0, 6.3);
        x.fill();
      }
      x.fillStyle = "rgba(74,52,30,.95)";
      x.beginPath(); x.arc(0, 0, R * 0.24, 0, 6.3); x.fill();
    } else if (bicim === "turp") {
      for (i = 0; i < 9; i++) {
        a = (i / 9) * Math.PI * 2 + r() * 0.3;
        x.save(); x.rotate(a);
        yaprak(x, R * (0.78 + r() * 0.26), R * 0.44, rgba(acik, 1), rgba(yes, 1));
        x.restore();
      }
      var tk = hexRGB((tur && tur.renk) || "#fda4af");
      x.strokeStyle = rgba(tk, 0.9); x.lineWidth = Math.max(1, R * 0.06);
      for (i = 0; i < 5; i++) {
        a = (i / 5) * Math.PI * 2;
        x.beginPath(); x.moveTo(0, 0);
        x.lineTo(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3); x.stroke();
      }
    } else {
      /* TÜR TANINMADI — uydurma bir bitki değil, kesik çizgili öbek. */
      x.setLineDash([Math.max(3, R * 0.14), Math.max(3, R * 0.11)]);
      x.strokeStyle = "rgba(226,222,208,.8)";
      x.lineWidth = Math.max(1.2, R * 0.06);
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
    var R = Math.max(7, rp(sayi(b.yaricap_mm, 0) * 2 || sayi(b.yayilim_mm, 60)) / 2);
    var bic = bicimSec(b);
    var anahtar = bic.bicim + "|" + (b.tur || "?") + "|" + Math.round(R) + "|" + Math.round(S.olcek * 10);
    var s = S.sprite[anahtar];
    if (s) return s;
    var boy = Math.ceil(R * 2 + 6);
    var c = document.createElement("canvas");
    c.width = Math.max(2, Math.ceil(boy * S.olcek));
    c.height = c.width;
    var x = c.getContext("2d");
    x.setTransform(S.olcek, 0, 0, S.olcek, 0, 0);
    x.translate(boy / 2, boy / 2);
    var turRenk = hexRGB(b.renk || "#7bbf5a");
    spriteCiz(x, bic.bicim, R, yaprakRengi(turRenk), { renk: b.renk },
      uretec(Math.floor(tohum(b.tur || b.ad) * 4294967295)));
    s = { tuval: c, boy: boy, R: R, bicim: bic };
    /* Önbellek 24 bitkilik bir bahçe için fazlasıyla yeter. */
    var say = 0; for (var kk in S.sprite) say++;
    if (say > 80) S.sprite = {};
    S.sprite[anahtar] = s;
    return s;
  }

  /* ==================================================================== *
   * KATMANLAR — çim ve toprak birer KEZ çiziliyor.
   *
   * Pi'de kare başına iş buradan düşüyor: sahne her karede iki drawImage
   * ile başlıyor, binlerce çim yaprağı yeniden çizilmiyor.
   * ==================================================================== */
  function katmanKur() {
    var w = S.tuval.width, h = S.tuval.height;
    S.cim = document.createElement("canvas"); S.cim.width = w; S.cim.height = h;
    S.cimCt = S.cim.getContext("2d");
    S.cimCt.setTransform(S.olcek, 0, 0, S.olcek, 0, 0);
    S.toprak = document.createElement("canvas"); S.toprak.width = w; S.toprak.height = h;
    S.toprakCt = S.toprak.getContext("2d");
    S.toprakCt.setTransform(S.olcek, 0, 0, S.olcek, 0, 0);
    /* NEM KENDİ KATMANINDA. Tül, ölçülen bitkilerin çevresinde
       `destination-out` ile deliniyor; bu ana tuvalde yapılınca çimi,
       tahtayı ve TOPRAĞI da siliyordu — ekranda bitki kümesinin üstünde
       kocaman siyah bir leke çıkıyordu (ölçüldü: 1240x504 tuvalde
       139.730 piksel saydamlaşmıştı). Delik artık yalnız tülü deliyor. */
    S.nemKat = document.createElement("canvas"); S.nemKat.width = w; S.nemKat.height = h;
    S.nemKatCt = S.nemKat.getContext("2d");
    S.nemKatCt.setTransform(S.olcek, 0, 0, S.olcek, 0, 0);
    S.nemDamga = "";
    S.cimIx = 0;
    cimHazirla();
    topragiCiz();
    S.sprite = {};
  }

  function cimHazirla() {
    var r = uretec(20260907), i;
    /* Yaprak sayısı alandan geliyor; sabit sayı geniş ekranda çayırı
       seyreltiyordu. Yatağın altına düşenler eleniyor, o yüzden bolca
       deneniyor. */
    var adet = kis(Math.round((S.en * S.boy) / CIM_YOGUNLUK), 900, 11000);
    S.cimYaprak = [];
    for (i = 0; i < adet; i++) {
      var x = r() * S.en, y = r() * S.boy;
      var yatakta = x > G.ox - G.kal - G.ray - 8 && x < G.ox + G.bw + G.kal + G.ray + 8 &&
                    y > G.oy - G.kal - 8 && y < G.oy + G.bh + G.kal + 8;
      if (yatakta) continue;
      var koyu = r();
      S.cimYaprak.push({
        x: x, y: y, boy: 4 + r() * 7, aci: -Math.PI / 2 + (r() - 0.5) * 0.9,
        renk: "hsl(" + (88 + r() * 30) + "," + (30 + koyu * 24) + "%," + (21 + koyu * 20) + "%)",
        kalin: 0.7 + r() * 0.8,
        cicek: r() < 0.012 ? (r() < 0.5 ? "#e8e2c8" : "#e6c85a") : null
      });
    }
    var c = S.cimCt, r2 = uretec(7), j;
    var g = c.createLinearGradient(0, 0, 0, S.boy);
    g.addColorStop(0, "#2a3a1e"); g.addColorStop(0.55, "#314420"); g.addColorStop(1, "#26331a");
    c.fillStyle = g; c.fillRect(0, 0, S.en, S.boy);
    for (j = 0; j < 80; j++) {
      c.fillStyle = "rgba(74,90,50," + (0.05 + r2() * 0.13).toFixed(3) + ")";
      c.beginPath();
      c.ellipse(r2() * S.en, r2() * S.boy, 20 + r2() * 90, 12 + r2() * 40, r2() * 3, 0, 6.3);
      c.fill();
    }
    /* Basamak taşları — bahçenin gerçekten bir YER olduğunu söyleyen ölçek. */
    var tas = [[G.ox * 0.42, S.boy * 0.72], [G.ox * 0.6, S.boy * 0.55],
               [G.ox * 0.38, S.boy * 0.38],
               [S.en - G.ox * 0.44, S.boy * 0.3], [S.en - G.ox * 0.62, S.boy * 0.48]];
    tas.forEach(function (t, i2) {
      if (t[0] < 24 || t[0] > S.en - 24) return;
      var rr = uretec(300 + i2), q;
      c.fillStyle = "rgba(0,0,0,.3)";
      c.beginPath(); c.ellipse(t[0] + 2, t[1] + 3, 20, 13, 0.3, 0, 6.3); c.fill();
      var tg = c.createLinearGradient(t[0] - 20, t[1] - 12, t[0] + 20, t[1] + 12);
      tg.addColorStop(0, "#9a9c94"); tg.addColorStop(0.6, "#7d8079"); tg.addColorStop(1, "#63665f");
      c.fillStyle = tg;
      c.beginPath(); c.ellipse(t[0], t[1], 19, 12, 0.3, 0, 6.3); c.fill();
      for (q = 0; q < 10; q++) {
        c.fillStyle = "rgba(255,255,255," + (0.03 + rr() * 0.07).toFixed(3) + ")";
        c.beginPath();
        c.ellipse(t[0] + (rr() - 0.5) * 26, t[1] + (rr() - 0.5) * 16,
          1 + rr() * 2.2, 1 + rr() * 1.5, rr() * 3, 0, 6.3);
        c.fill();
      }
    });
  }
  function cimCiz(adet) {
    var c = S.cimCt;
    var son = Math.min(S.cimYaprak.length, S.cimIx + adet);
    for (; S.cimIx < son; S.cimIx++) {
      var b = S.cimYaprak[S.cimIx];
      c.strokeStyle = b.renk; c.lineWidth = b.kalin; c.lineCap = "round";
      c.beginPath();
      c.moveTo(b.x, b.y);
      c.quadraticCurveTo(b.x + Math.cos(b.aci) * b.boy * 0.5, b.y + Math.sin(b.aci) * b.boy * 0.6,
        b.x + Math.cos(b.aci) * b.boy, b.y + Math.sin(b.aci) * b.boy);
      c.stroke();
      if (b.cicek) {
        c.fillStyle = b.cicek;
        c.beginPath();
        c.arc(b.x + Math.cos(b.aci) * b.boy, b.y + Math.sin(b.aci) * b.boy, 1.1, 0, 6.3);
        c.fill();
      }
    }
  }

  function topragiCiz() {
    /* TOPRAK CANLI OLMALI ama YALAN SÖYLEMEMELİ: dokudaki bütün değişim
       RENK TONUNDA, parlaklıkta değil. Parlaklık nemin dili (ıslak leke
       koyu, ölçülmeyen tül solgun); doku da koyu-açık oynasaydı bakan
       kişi kuru toprakla ölçülmüş nemli toprağı ayırt edemezdi. */
    var c = S.toprakCt, r = uretec(424242), i;
    c.clearRect(0, 0, S.en, S.boy);
    c.save();
    c.beginPath(); c.rect(G.ox, G.oy, G.bw, G.bh); c.clip();
    var g = c.createLinearGradient(G.ox, G.oy, G.ox + G.bw * 0.35, G.oy + G.bh);
    g.addColorStop(0, "#7a5734"); g.addColorStop(0.42, "#6b4c2d");
    g.addColorStop(0.78, "#5e4227"); g.addColorStop(1, "#553b23");
    c.fillStyle = g; c.fillRect(G.ox, G.oy, G.bw, G.bh);

    /* Toprağın kendi alacası: geniş, yumuşak ve AYNI parlaklıkta sıcak /
       serin kahve lekeleri. Uzaktan "işlenmiş toprak", yakından leke. */
    var alaca = Math.max(14, Math.round((G.bw * G.bh) / 5200));
    for (i = 0; i < alaca; i++) {
      var ax = G.ox + r() * G.bw, ay = G.oy + r() * G.bh;
      var ar = 16 + r() * Math.max(26, G.bw * 0.09);
      var sicak = r() > 0.5;
      var ag = c.createRadialGradient(ax, ay, 0, ax, ay, ar);
      ag.addColorStop(0, sicak ? "rgba(139,96,52,.20)" : "rgba(96,79,58,.18)");
      ag.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = ag;
      c.beginPath(); c.ellipse(ax, ay, ar, ar * (0.6 + r() * 0.5), r() * 3, 0, 6.3); c.fill();
    }

    /* Tırmık sırtları: her sıra ince bir gölge + üstünde ince bir aydınlık
       çizgi. İkisi birlikte kabartma etkisi veriyor; tek çizgi düz kalıyordu. */
    var siraAdet = Math.max(10, Math.round(G.bh / 13));
    for (i = 0; i < siraAdet; i++) {
      var yy = G.oy + (i + 0.5) * (G.bh / siraAdet);
      var dalga = 1.1 + (i % 3) * 0.5;
      c.lineWidth = 1.5;
      c.strokeStyle = "rgba(38,24,12,.13)";
      c.beginPath(); c.moveTo(G.ox, yy);
      for (var x = G.ox; x <= G.ox + G.bw; x += 14) c.lineTo(x, yy + Math.sin(x * 0.075 + i) * dalga);
      c.stroke();
      c.lineWidth = 1;
      c.strokeStyle = "rgba(255,226,178,.10)";
      c.beginPath(); c.moveTo(G.ox, yy - 2);
      for (var x2 = G.ox; x2 <= G.ox + G.bw; x2 += 14) c.lineTo(x2, yy - 2 + Math.sin(x2 * 0.075 + i) * dalga);
      c.stroke();
    }

    /* Kesekler: her birinin gölgesi ve aydınlık yüzü var — toprak taneli
       görünüyor, düz bir zemin değil. */
    var kesek = Math.round((G.bw * G.bh) / 210);
    for (i = 0; i < kesek; i++) {
      var cx = G.ox + r() * G.bw, cy = G.oy + r() * G.bh, rr = 1.3 + r() * 3.6;
      var aci = r() * 3;
      c.fillStyle = "rgba(34,21,10," + (0.10 + r() * 0.20).toFixed(3) + ")";
      c.beginPath(); c.ellipse(cx + rr * 0.22, cy + rr * 0.28, rr, rr * (0.6 + r() * 0.5), aci, 0, 6.3); c.fill();
      c.fillStyle = "rgba(196,146,92," + (0.14 + r() * 0.18).toFixed(3) + ")";
      c.beginPath(); c.ellipse(cx, cy, rr * 0.9, rr * (0.5 + r() * 0.4), aci, 0, 6.3); c.fill();
      c.fillStyle = "rgba(255,232,190," + (0.07 + r() * 0.11).toFixed(3) + ")";
      c.beginPath();
      c.ellipse(cx - rr * 0.32, cy - rr * 0.36, rr * 0.5, rr * 0.32, aci, 0, 6.3); c.fill();
    }
    /* Çakıl ve saman kırıntısı: ölçekten anlaşılan ayrıntı. */
    for (i = 0; i < Math.round(kesek / 9); i++) {
      var sx = G.ox + r() * G.bw, sy = G.oy + r() * G.bh, sr = 1 + r() * 2.2;
      c.fillStyle = "rgba(196,190,176," + (0.20 + r() * 0.3).toFixed(3) + ")";
      c.beginPath(); c.ellipse(sx, sy, sr, sr * 0.72, r() * 3, 0, 6.3); c.fill();
    }
    for (i = 0; i < Math.round(kesek / 14); i++) {
      var tx = G.ox + r() * G.bw, ty = G.oy + r() * G.bh, tl = 3 + r() * 7, ta = r() * 3.1;
      c.strokeStyle = "rgba(212,180,116," + (0.16 + r() * 0.22).toFixed(3) + ")";
      c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(tx, ty);
      c.lineTo(tx + Math.cos(ta) * tl, ty + Math.sin(ta) * tl * 0.5); c.stroke();
    }
    c.restore();
  }

  /* ==================================================================== *
   * NEM — ÖLÇÜLEN toprakta leke, ÖLÇÜLMEYEN toprakta tül ve tarama.
   * ==================================================================== */
  function nemDurum(b) {
    var o = b.su_olcum || {};
    var varMi = !!o.var;
    return {
      var: varMi, kendi: !!o.kendi, bayat: !!o.bayat,
      yuzde: varMi ? kis(sayi(o.yuzde, sayi(b.nem_yuzde, 0)), 0, 100) : null,
      uzak: sayi(o.uzak_mm, 0), yas: sayi(o.yas_sn, 0),
      esik: sayi(o.esik, 0), esikAcik: !!o.esik_acik
    };
  }
  /** Tülün ve lekelerin durum damgası: veri değişmediyse katman yeniden
   *  çizilmiyor (yeniden çizim 24 bitkide ~1.6 ms). */
  function nemDamgaAl() {
    var d = Math.round(G.ox) + "x" + Math.round(G.oy) + "x" + Math.round(G.bw) + "x"
      + Math.round(G.bh) + "|";
    S.bitki.forEach(function (b) {
      var n = nemDurum(b);
      d += b.ad + (n.var ? ":" + Math.round(n.yuzde) + (n.kendi ? "k" : "o") + (n.bayat ? "b" : "") : ":-") + ";";
    });
    return d;
  }
  function nemKatKur() {
    var c = S.nemKatCt;
    if (!c) return;
    c.setTransform(S.olcek, 0, 0, S.olcek, 0, 0);
    c.clearRect(0, 0, S.en, S.boy);
    c.save();
    c.beginPath(); c.rect(G.ox, G.oy, G.bw, G.bh); c.clip();
    /* Islak leke: nem yüksekse toprak koyu ve hafif serin. Ödünç ve bayat
       okuma daha soluk — kendi taze okuması kadar güvenilir görünmüyorlar. */
    S.bitki.forEach(function (b) {
      var n = nemDurum(b);
      if (!n.var) return;
      var guc = (n.kendi ? 1 : 0.5) * (n.bayat ? 0.45 : 1);
      var R = rp(NEM_YARICAP_MM * 0.72), gx = px(b.x), gy = py(b.y);
      var g = c.createRadialGradient(gx, gy, R * 0.1, gx, gy, R);
      g.addColorStop(0, "rgba(46,32,18," + (0.05 + 0.20 * (n.yuzde / 100) * guc).toFixed(3) + ")");
      g.addColorStop(1, "rgba(46,32,18,0)");
      c.fillStyle = g;
      c.beginPath(); c.arc(gx, gy, R, 0, 6.3); c.fill();
    });
    /* ÖLÇÜLMEYEN TOPRAK: ince, soğuk bir tül. Kararmıyor — bilmemek
       karanlık değil, SOLGUNLUK. */
    c.fillStyle = "rgba(150,168,186,.15)";
    c.fillRect(G.ox, G.oy, G.bw, G.bh);
    /* Ölçülenin çevresinde tül açılıyor. Bu silme yalnız BU katmanda. */
    c.globalCompositeOperation = "destination-out";
    S.bitki.forEach(function (b) {
      var n = nemDurum(b);
      if (!n.var) return;
      var R = rp(NEM_YARICAP_MM), gx = px(b.x), gy = py(b.y);
      var g = c.createRadialGradient(gx, gy, R * 0.15, gx, gy, R);
      var kuv = n.bayat ? 0.55 : (n.kendi ? 1 : 0.75);
      g.addColorStop(0, "rgba(0,0,0," + kuv + ")");
      g.addColorStop(0.65, "rgba(0,0,0," + (kuv * 0.8) + ")");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.beginPath(); c.arc(gx, gy, R, 0, 6.3); c.fill();
    });
    c.globalCompositeOperation = "source-over";
    c.restore();
    /* Tarama yalnız ölçümü OLMAYAN bitkinin toprağında — yokluğun kendisi. */
    c.save();
    c.beginPath(); c.rect(G.ox, G.oy, G.bw, G.bh); c.clip();
    S.bitki.forEach(function (b) {
      if (nemDurum(b).var) return;
      var sp = spriteAl(b);
      var R = sp.R + 14, gx = px(b.x), gy = py(b.y);
      c.save();
      c.beginPath(); c.arc(gx, gy, R, 0, 6.3); c.clip();
      c.strokeStyle = "rgba(214,228,242,.22)"; c.lineWidth = 0.9;
      for (var i = -R; i < R * 2; i += 9) {
        c.beginPath(); c.moveTo(gx - R + i, gy - R); c.lineTo(gx - R + i + R * 2, gy + R); c.stroke();
      }
      c.restore();
    });
    c.restore();
  }
  function nemKatCiz(c, p) {
    if (p <= 0 || !S.nemKat) return;
    var d = nemDamgaAl();
    if (d !== S.nemDamga) { nemKatKur(); S.nemDamga = d; }
    c.save();
    c.globalAlpha = p;
    c.drawImage(S.nemKat, 0, 0, S.nemKat.width, S.nemKat.height, 0, 0, S.en, S.boy);
    c.restore();
  }

  /* ---------------------------------------------------------- çerçeve/ray */
  function tahtaCiz(c, p) {
    if (p <= 0) return;
    var kal = G.kal;
    var kenar = [
      { x: G.ox - kal, y: G.oy - kal, w: G.bw + kal * 2, h: kal },
      { x: G.ox - kal, y: G.oy + G.bh, w: G.bw + kal * 2, h: kal },
      { x: G.ox - kal, y: G.oy, w: kal, h: G.bh },
      { x: G.ox + G.bw, y: G.oy, w: kal, h: G.bh }
    ];
    for (var i = 0; i < 4; i++) {
      var pi = kis((p - i * 0.12) / 0.5, 0, 1);
      if (pi <= 0) continue;
      var e = kyGeri(pi), k = kenar[i];
      c.save();
      c.globalAlpha = kis(pi * 2, 0, 1);
      c.translate(0, (1 - e) * -34);
      var g = c.createLinearGradient(k.x, k.y, k.x, k.y + k.h);
      g.addColorStop(0, "#8a6641"); g.addColorStop(0.5, "#74522f"); g.addColorStop(1, "#5c3f24");
      c.fillStyle = g; c.fillRect(k.x, k.y, k.w, k.h);
      c.strokeStyle = "rgba(40,26,14,.55)"; c.lineWidth = 1;
      c.strokeRect(k.x, k.y, k.w, k.h);
      var r = uretec(i * 31 + 5), j;
      for (j = 0; j < 10; j++) {
        c.strokeStyle = "rgba(48,32,18," + (0.1 + r() * 0.18).toFixed(2) + ")";
        c.lineWidth = 0.8;
        c.beginPath();
        if (k.w > k.h) {
          var yy = k.y + r() * k.h;
          c.moveTo(k.x, yy);
          for (var xx = k.x; xx < k.x + k.w; xx += 20) c.lineTo(xx, yy + Math.sin(xx * 0.06 + j) * 1.2);
        } else {
          var xv = k.x + r() * k.w;
          c.moveTo(xv, k.y);
          for (var yv = k.y; yv < k.y + k.h; yv += 20) c.lineTo(xv + Math.sin(yv * 0.06 + j) * 1.2, yv);
        }
        c.stroke();
      }
      c.restore();
    }
  }

  /** Dikim alanları — sunucunun verdiği gerçek dikdörtgenler. */
  function alanCiz(c) {
    var a = (S.veri && S.veri.alanlar) || [];
    if (!a.length || !S.ekimNokta) return;
    c.save();
    c.strokeStyle = "rgba(140,200,130,.55)"; c.lineWidth = 1;
    c.setLineDash([5, 4]);
    a.forEach(function (al) {
      var x1 = px(Math.min(sayi(al.x1), sayi(al.x2))), x2 = px(Math.max(sayi(al.x1), sayi(al.x2)));
      var y1 = py(Math.min(sayi(al.y1), sayi(al.y2))), y2 = py(Math.max(sayi(al.y1), sayi(al.y2)));
      c.strokeRect(x1, y1, x2 - x1, y2 - y1);
    });
    c.setLineDash([]);
    c.restore();
  }

  /* ==================================================================== *
   * BİTKİLER
   * ==================================================================== */
  function bitkiCizHepsi(c) {
    var sirali = S.bitki.slice().sort(function (a, b) { return sayi(a.y) - sayi(b.y); });
    sirali.forEach(function (b) {
      var p = kis(sayi(b._gorunum, 1), 0, 1);
      if (p <= 0) {
        if (sayi(b._tohum, 0) > 0) {                   /* tohum düşerken */
          var ty = py(b.y) - (1 - b._tohum) * 70;
          c.fillStyle = "#e8d8a8";
          c.beginPath(); c.ellipse(px(b.x), ty, 2.6, 3.4, 0, 0, 6.3); c.fill();
        }
        return;
      }
      var sp = spriteAl(b);
      var gx = px(b.x), gy = py(b.y);
      var R = sp.R * p;
      /* Salınım + esinti dalgası: rüzgâr tarlayı soldan sağa geçiyor,
         bitkiler sırayla eğiliyor. Ölçülen bir rüzgâr değil (sensör yok),
         yalnız sahnenin havası. */
      var es = esinti(gx);
      var sal = S.sakin ? 0
        : (Math.sin(S.t * 1.1 + b._faz) * 0.022 + Math.sin(S.t * 2.7 + b._faz) * 0.008) * es;
      c.save();
      c.globalAlpha = 0.26;
      c.fillStyle = "#120c06";
      c.beginPath();
      c.ellipse(gx + R * 0.16, gy + R * 0.2, R * 0.95, R * 0.72, 0, 0, 6.3);
      c.fill();
      c.restore();
      c.save();
      c.translate(gx, gy);
      c.rotate(b._aci + sal);
      c.scale(p, p);
      c.drawImage(sp.tuval, -sp.boy / 2, -sp.boy / 2, sp.boy, sp.boy);
      c.restore();

      /* SUSAMA: yaprağa değil TOPRAĞA yazılıyor — kuru halka. Ölçüme
         dayanan susama tam, geçen güne dayanan tahmin kesik. */
      if (b.susadi && p > 0.85) {
        var tah = b.su_kanit !== "olculen";
        c.strokeStyle = "rgba(226,150,80," +
          (0.5 + (S.sakin ? 0 : Math.sin(S.t * 2 + b._faz) * 0.18)).toFixed(2) + ")";
        c.lineWidth = tah ? 1.1 : 1.7;
        c.setLineDash(tah ? [3, 5] : [6, 5]);
        c.beginPath(); c.arc(gx, gy, R + 7, 0, 6.3); c.stroke();
        c.setLineDash([]);
      }
      if (b.hasat && p > 0.85) {
        c.fillStyle = "rgba(246,196,86,.95)";
        c.beginPath();
        c.moveTo(gx, gy - R - 14); c.lineTo(gx - 5, gy - R - 5); c.lineTo(gx + 5, gy - R - 5);
        c.closePath(); c.fill();
      }
      if (S.secili === b.ad) {
        c.strokeStyle = "rgba(246,246,240,.92)"; c.lineWidth = 1.6;
        c.beginPath(); c.arc(gx, gy, R + 4, 0, 6.3); c.stroke();
      }
      if (!sp.bicim.bilinen && p > 0.85) {
        c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
        c.fillStyle = "rgba(240,186,110,.95)";
        c.fillText("tür tanınmadı", gx, gy + R + 14);
      }
    });
  }

  /* ==================================================================== *
   * MAKİNE — raylar, kumanda kutusu, kiriş, araba, hayalet, alet halkası
   * ==================================================================== */
  var ALET = [
    { k: "sula", ad: "Su", renk: "#5aa6e8" },
    { k: "nem", ad: "Prob", renk: "#63c46b" },
    { k: "ek", ad: "Tohum", renk: "#e6d49c" },
    { k: "foto", ad: "Kamera", renk: "#c8ccc4" }
  ];
  function aletBul(k) {
    for (var i = 0; i < ALET.length; i++) if (ALET[i].k === k) return ALET[i];
    return null;
  }
  function makineCiz(c, p) {
    if (p <= 0) return;
    var kal = G.kal, rayW = G.ray;
    var kay = (1 - ky(p)) * 120;
    var bagli = !!(S.veri && S.veri.bagli);
    [G.ox - kal - rayW - 2, G.ox + G.bw + kal + 2].forEach(function (rx, i) {
      var dx = i === 0 ? -kay : kay;
      var g = c.createLinearGradient(rx + dx, 0, rx + dx + rayW, 0);
      g.addColorStop(0, "#6f757a"); g.addColorStop(0.35, "#c3c9cd");
      g.addColorStop(0.6, "#8f969b"); g.addColorStop(1, "#5d6367");
      c.fillStyle = g;
      c.fillRect(rx + dx, G.oy - kal - 6, rayW, G.bh + kal * 2 + 12);
      c.strokeStyle = "rgba(20,24,26,.5)"; c.lineWidth = 1;
      c.strokeRect(rx + dx, G.oy - kal - 6, rayW, G.bh + kal * 2 + 12);
    });
    /* Kumanda kutusu: bağlıysa yeşil, kopuksa kırmızı. Makinenin durumu
       kenardaki bir kutuda değil, makinenin ÜSTÜNDE. */
    var kkx = G.ox - kal - rayW - 7 - kay, kky = G.oy - kal - 6;
    c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(kkx + 1, kky + 3, 24, 32);
    var kg = c.createLinearGradient(kkx, kky, kkx + 24, kky + 32);
    kg.addColorStop(0, "#5c6560"); kg.addColorStop(1, "#3a413d");
    c.fillStyle = kg; c.fillRect(kkx, kky, 24, 32);
    c.strokeStyle = "rgba(18,22,20,.6)"; c.lineWidth = 1; c.strokeRect(kkx, kky, 24, 32);
    c.fillStyle = !bagli ? "#e05252" : (S.veri && S.veri.mesgul ? "#5aa6e8" : "#63c46b");
    c.beginPath(); c.arc(kkx + 12, kky + 8, 2.6, 0, 6.3); c.fill();
    c.fillStyle = "rgba(180,190,184,.45)";
    c.fillRect(kkx + 4, kky + 15, 16, 2); c.fillRect(kkx + 4, kky + 20, 16, 2);

    var pK = kis((p - 0.45) / 0.55, 0, 1);
    if (pK <= 0) return;
    var kx1 = G.ox - kal - rayW - 2, kx2 = G.ox + G.bw + kal + rayW + 2;
    var m = S.robot || S.makine;
    var ky2 = py(m.y) - (1 - ky(pK)) * 70;

    if (S.hayalet) {
      c.save();
      c.globalAlpha = 0.55;
      c.strokeStyle = "#8fd0ff"; c.lineWidth = 1.4; c.setLineDash([6, 5]);
      c.beginPath(); c.moveTo(kx1, py(S.hayalet.y)); c.lineTo(kx2, py(S.hayalet.y)); c.stroke();
      c.setLineDash([]);
      c.fillStyle = "rgba(143,208,255,.32)";
      c.fillRect(px(S.hayalet.x) - 15, py(S.hayalet.y) - 13, 30, 26);
      if (S.hayalet.ad) {
        c.globalAlpha = 1;
        c.font = "600 11px system-ui,sans-serif"; c.textAlign = "center";
        c.fillStyle = "#bfe2ff";
        c.fillText(S.hayalet.ad, px(S.hayalet.x), py(S.hayalet.y) - 20);
      }
      c.restore();
    }
    var g2 = c.createLinearGradient(0, ky2 - 5, 0, ky2 + 5);
    g2.addColorStop(0, "#cfd5d8"); g2.addColorStop(0.5, "#9aa1a5"); g2.addColorStop(1, "#6e7478");
    c.save();
    c.globalAlpha = bagli ? 1 : 0.45;
    c.fillStyle = g2; c.fillRect(kx1, ky2 - 5, kx2 - kx1, 10);
    c.strokeStyle = "rgba(20,24,26,.45)"; c.lineWidth = 1;
    c.strokeRect(kx1, ky2 - 5, kx2 - kx1, 10);
    c.strokeStyle = "rgba(40,44,46,.7)"; c.lineWidth = 3;
    c.beginPath(); c.moveTo(kx1 + rayW / 2, G.oy - kal - 4); c.lineTo(kx1 + rayW / 2, ky2); c.stroke();

    var ax = px(m.x);
    c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 8; c.shadowOffsetY = 3;
    var g3 = c.createLinearGradient(ax - 17, ky2 - 14, ax + 17, ky2 + 14);
    g3.addColorStop(0, "#eef1ee"); g3.addColorStop(1, "#b4bab4");
    c.fillStyle = g3;
    c.beginPath();
    if (c.roundRect) c.roundRect(ax - 17, ky2 - 14, 34, 28, 5);
    else c.rect(ax - 17, ky2 - 14, 34, 28);
    c.fill();
    c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0;
    c.strokeStyle = "#7c837c"; c.lineWidth = 1; c.stroke();
    var al = aletBul(S.alet);
    c.fillStyle = al ? al.renk : "#4a4f4a";
    c.beginPath(); c.arc(ax, ky2, 5.5, 0, 6.3); c.fill();
    c.restore();

    /* Z ÖLÇÜLÜ İSE inişi çiziyoruz; değilse çizmiyoruz ve sebebini yazıyoruz. */
    var tz = S.veri && S.veri.toprak_z, mz = m.z;
    if (mz != null && tz != null) {
      var gz = sayi(S.veri.guvenli_z, sayi(tz, 0) + 340);
      var ara = Math.abs(gz - sayi(tz, 0)) > 1 ? Math.abs(gz - sayi(tz, 0)) : 340;
      var yuk = kis(Math.abs(sayi(mz) - sayi(tz)) / ara, 0, 1);
      c.strokeStyle = "rgba(230,236,242,.5)"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(ax, ky2 + 14); c.lineTo(ax, ky2 + 14 + (1 - yuk) * 16); c.stroke();
    }
    if (S.basiliSula || (S.veri && S.veri.mesgul && S.alet === "sula")) {
      c.strokeStyle = "rgba(140,200,240,.85)"; c.lineWidth = 2;
      for (var i2 = 0; i2 < 6; i2++) {
        var a2 = S.t * 6 + i2;
        c.beginPath();
        c.moveTo(ax + Math.sin(a2) * 3, ky2 + 8);
        c.lineTo(ax + Math.sin(a2) * 7, ky2 + 14 + (i2 % 3) * 4);
        c.stroke();
      }
    }
    if (S.halka) halkaCiz(c, ax, ky2, ALET, 54, S.alet, bagli, function (a) { return a.ad; });
    if (S.halka && !bagli) {
      c.font = "600 11px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = "#e05252";
      c.fillText("makine bağlı değil — aletler kilitli", ax, ky2 - 80);
    }
  }

  /** Ortak halka çizimi: uçta aletler, bitkide eylemler, toprakta gözler. */
  function halkaCiz(c, cx, cy, liste, yaricap, etkin, acik, adAl, altAl) {
    liste.forEach(function (a, i) {
      var ang = -Math.PI / 2 + (i / liste.length) * Math.PI * 2;
      var hx = cx + Math.cos(ang) * yaricap, hy = cy + Math.sin(ang) * yaricap;
      var r = 20;
      c.save();
      c.shadowColor = "rgba(0,0,0,.5)"; c.shadowBlur = 8;
      c.fillStyle = etkin === a.k ? a.renk : "rgba(24,26,23,.93)";
      c.beginPath(); c.arc(hx, hy, r, 0, 6.3); c.fill();
      c.restore();
      c.strokeStyle = acik === false ? "#3f423c" : a.renk;
      c.lineWidth = etkin === a.k ? 2.2 : 1.5;
      if (a.kesik) c.setLineDash([4, 4]);
      c.beginPath(); c.arc(hx, hy, r, 0, 6.3); c.stroke();
      c.setLineDash([]);
      c.font = "600 11px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = etkin === a.k ? "#12140f" : (acik === false ? "#82847a" : a.renk);
      c.fillText(adAl(a), hx, hy + (altAl ? 0 : 4));
      if (altAl) {
        var alt = altAl(a);
        if (alt) {
          /* Alt yazı dairenin DIŞINA taşıyor: altına koyu bir yastık
             konmazsa komşu düğmenin üstüne binip ikisi de okunmuyor. */
          c.font = "9px ui-monospace,monospace";
          var gen = c.measureText(alt).width + 8;
          c.fillStyle = "rgba(12,14,10,.82)";
          c.beginPath();
          if (c.roundRect) c.roundRect(hx - gen / 2, hy + 5, gen, 13, 6);
          else c.rect(hx - gen / 2, hy + 5, gen, 13);
          c.fill();
          c.fillStyle = etkin === a.k ? "#e8ece2" : "#9da196";
          c.fillText(alt, hx, hy + 15);
        }
      }
      a._x = hx; a._y = hy; a._r = r;
    });
  }

  /* ------------------------------------------------------- eylem halkası */
  var EYLEM = [
    { k: "sula", ad: "Sula", renk: "#5aa6e8" },
    { k: "nem", ad: "Ölç", renk: "#63c46b" },
    { k: "foto", ad: "Çek", renk: "#c8ccc4" },
    /* Film ve eşik MAKİNE İŞİ DEĞİL: biri arşivi okuyor, öteki ayar
       yazıyor. Makine kopukken de çalışıyorlar. */
    { k: "film", ad: "Film", renk: "#d9b26a" },
    { k: "kapat", ad: "Bırak", renk: "#8d9089" }
  ];
  function eylemCiz(c) {
    /* Kadran açıkken eylem halkası çizilmiyor: ikisi aynı yarıçapta üst
       üste biniyor ve hangi daireye dokunduğun belirsizleşiyordu. */
    if (!S.secili || S.ekimNokta) return;
    var b = S.ix[S.secili];
    if (!b) return;
    var sp = spriteAl(b);
    /* Yarıçap DÜĞME SAYISINA göre: altı düğme 46 pikselde birbirinin
       üstüne biniyordu. Kiriş kuralı — komşu iki merkez arası en az
       52 piksel olacak. */
    var enAz = 52 / (2 * Math.sin(Math.PI / EYLEM.length));
    var R = Math.max(enAz, sp.R + 34);
    var bagli = !!(S.veri && S.veri.bagli);
    halkaCiz(c, px(b.x), py(b.y), EYLEM, R, S.basiliSula ? "sula" : "", bagli,
      function (e) { return e.ad; },
      function (e) {
        if (e.k === "film") {
          var n = sayi(b.film_kare, 0);
          return n ? n + " kare" : "kare yok";
        }
        if (e.k !== "sula") return "";
        if (S.basiliSula) return S.basiliSn.toFixed(1) + " sn";
        return bagli ? "basılı tut" : "kilitli";
      });
  }

  /* --------------------------------------------------------- tohum tepsisi */
  function gozListesi() {
    var g = (S.veri && S.veri.hazne_gozleri) || [];
    return g.map(function (x) {
      return { k: String(x.ad || ""), ad: x.dolu ? turAdi(x.tohum) : "boş",
               tohum: String(x.tohum || ""), dolu: !!x.dolu,
               renk: x.dolu ? "#c9b878" : "#4a4d48", kesik: !x.dolu };
    });
  }
  function turAdi(slug) {
    var t = ((S.veri && S.veri.turler) || []).filter(function (x) { return x.slug === slug; })[0];
    return (t && t.ad) || slug || "?";
  }
  function turYayilim(slug) {
    var t = ((S.veri && S.veri.turler) || []).filter(function (x) { return x.slug === slug; })[0];
    return t ? sayi(t.yayilim_mm, 0) : 0;
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
    var s = yatakSinir();
    if (mx - r < s.x1 || mx + r > s.x2 || my - r < s.y1 || my + r > s.y2) {
      return { ok: false, sebep: "yatağın sınırları dışında" };
    }
    for (i = 0; i < S.bitki.length; i++) {
      var b = S.bitki[i];
      var br = sayi(b.yayilim_mm, sayi(b.yaricap_mm, 30) * 2) / 2;
      if (Math.hypot(sayi(b.x) - mx, sayi(b.y) - my) < r + br) {
        return { ok: false, sebep: b.ad + " ile çakışıyor", carpan: b.ad };
      }
    }
    return { ok: true, sebep: "" };
  }
  var S_GOZ = [];
  function ekimCiz(c) {
    if (!S.ekimNokta) return;
    var n = S.ekimNokta, cx = px(n.x), cy = py(n.y);
    if (S.ekimTur) {
      var d = ekimUygun(S.ekimTur, n.x, n.y);
      var R = rp(turYayilim(S.ekimTur)) / 2;
      c.strokeStyle = d.ok ? "#63c46b" : "#e07a5f"; c.lineWidth = 2;
      c.fillStyle = d.ok ? "rgba(99,196,107,.14)" : "rgba(224,122,95,.14)";
      c.beginPath(); c.arc(cx, cy, R, 0, 6.3); c.fill(); c.stroke();
      if (d.carpan && S.ix[d.carpan]) {
        var k = S.ix[d.carpan];
        c.strokeStyle = "#e07a5f"; c.setLineDash([4, 4]);
        c.beginPath();
        c.arc(px(k.x), py(k.y), rp(sayi(k.yayilim_mm, 60)) / 2, 0, 6.3);
        c.stroke(); c.setLineDash([]);
      }
    } else {
      c.strokeStyle = "rgba(255,255,255,.55)"; c.lineWidth = 1; c.setLineDash([3, 3]);
      c.beginPath(); c.arc(cx, cy, 10, 0, 6.3); c.stroke(); c.setLineDash([]);
    }
    S_GOZ = gozListesi();
    if (!S_GOZ.length) {
      c.font = "600 11px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = "#d9a520";
      c.fillText("hazne gözü okunamıyor — makine tohumu nereden alacağını bilmiyor", cx, cy - 40);
      return;
    }
    halkaCiz(c, cx, cy, S_GOZ, 64, S.ekimTur ? gozAnahtar(S.ekimTur) : "", true,
      function (g) { return g.ad; },
      function (g) { return g.dolu ? Math.round(turYayilim(g.tohum)) + " mm" : g.k; });
  }
  function gozAnahtar(slug) {
    var g = S_GOZ.filter(function (x) { return x.tohum === slug; })[0];
    return g ? g.k : "";
  }

  /* ==================================================================== *
   * ATMOSFER — bahçe boşta da yaşıyor. Sakin modda hepsi duruyor.
   * ==================================================================== */
  function atmosferKur() {
    var r = uretec(99), i;
    S.toz = [];
    for (i = 0; i < 20; i++) {
      S.toz.push({ x: r() * S.en, y: r() * S.boy, vx: 0.1 + r() * 0.35,
                   vy: (r() - 0.5) * 0.12, r: 0.6 + r() * 1.3, a: 0.1 + r() * 0.22 });
    }
    S.ari = { t: -4 - r() * 8, sure: 7 };
  }
  function atmosferCiz(c, dt) {
    if (S.sakin) return;
    var i;
    for (i = 0; i < S.toz.length; i++) {
      var t = S.toz[i];
      t.x += t.vx * dt * 26; t.y += t.vy * dt * 26;
      if (t.x > S.en + 4) { t.x = -4; t.y = Math.random() * S.boy; }
      c.fillStyle = "rgba(255,244,214," + t.a.toFixed(2) + ")";
      c.beginPath(); c.arc(t.x, t.y, t.r, 0, 6.3); c.fill();
    }
    S.ari.t += dt;
    if (S.ari.t > 0 && S.ari.t < S.ari.sure) {
      var p = S.ari.t / S.ari.sure;
      var bx = -20 + p * (S.en + 40);
      var by = S.boy * 0.2 + Math.sin(p * 9) * S.boy * 0.16 + Math.sin(p * 23) * 9;
      c.fillStyle = "rgba(255,255,255,.5)";
      c.beginPath(); c.ellipse(bx - 2, by - 3, 4, 2, -0.5, 0, 6.3); c.fill();
      c.fillStyle = "#e8c24a";
      c.beginPath(); c.ellipse(bx, by, 3.4, 2.4, 0, 0, 6.3); c.fill();
      c.fillStyle = "#2a2418";
      c.beginPath(); c.ellipse(bx + 1.4, by, 1.4, 2.2, 0, 0, 6.3); c.fill();
    } else if (S.ari.t > S.ari.sure + 8) { S.ari.t = -3 - Math.random() * 9; }
  }
  /** Günün saati: tarayıcının saati. Hiçbir ölçüme karşılık gelmiyor,
   *  hiçbir sayıya dönüşmüyor — yalnız ışığın rengi. */
  function isikCiz(c) {
    var d = new Date();
    var saat = d.getHours() + d.getMinutes() / 60;
    var gun = kis(Math.sin(((saat - 6) / 14) * Math.PI), 0, 1);
    var gx = S.en * (0.12 + (saat - 6) / 14 * 0.76);
    var kay = S.sakin ? 0 : Math.sin(S.t * 0.08) * 30;
    var g = c.createRadialGradient(gx + kay, S.boy * 0.1, 40, gx + kay, S.boy * 0.3, S.en * 0.8);
    g.addColorStop(0, "rgba(255,220,150," + (0.05 + gun * 0.13).toFixed(3) + ")");
    g.addColorStop(0.45, "rgba(255,206,130," + (0.02 + gun * 0.05).toFixed(3) + ")");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, S.en, S.boy);
    if (gun < 0.3) {                              /* akşam / gece serinliği */
      c.fillStyle = "rgba(24,34,58," + ((0.3 - gun) * 0.5).toFixed(3) + ")";
      c.fillRect(0, 0, S.en, S.boy);
    }
    var v = c.createRadialGradient(S.en / 2, S.boy / 2, Math.min(S.en, S.boy) * 0.42,
      S.en / 2, S.boy / 2, Math.max(S.en, S.boy) * 0.78);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.18)");
    c.fillStyle = v; c.fillRect(0, 0, S.en, S.boy);
  }

  /* ==================================================================== *
   * İNŞA — sekme ilk açıldığında bahçe sıfırdan kuruluyor.
   * Sonraki açılışlarda tekrar oynamıyor; "⟳" düğmesi yeniden kuruyor.
   * ==================================================================== */
  var EVRE = { cim: [0, 1.15], tahta: [0.85, 1.55], toprak: [1.35, 2.25],
               ray: [2.15, 3.0], tohum: [2.9, 3.5], buyume: [3.3, 5.2],
               nem: [5.0, 5.6] };
  function evre(ad) {
    if (S.insaBitti) return 1;
    var e = EVRE[ad];
    return kis((S.insaT - e[0]) / (e[1] - e[0]), 0, 1);
  }
  function insaAtla() {
    S.insaT = 6; S.insaBitti = true;
    cimCiz(S.cimYaprak.length);
    S.bitki.forEach(function (b) { b._gorunum = 1; b._tohum = 1; });
    isteKare();
  }
  function insaBasla() {
    if (azHareket()) { insaAtla(); return; }
    S.insaT = 0; S.insaBitti = false; S.insaVar = true; S.cimIx = 0;
    S.cimCt.clearRect(0, 0, S.en, S.boy);
    cimHazirla();
    S.bitki.forEach(function (b) { b._gorunum = 0; b._tohum = 0; });
    isteKare();
  }
  /** "Hareketi azalt" açıksa sakin mod kendiliğinden açık başlıyor —
   *  düğme kaldırıldığı için tek açma yolu bu. */
  function sakinKur() { if (azHareket()) S.sakin = true; }
  function azHareket() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (h) { return false; }
  }

  /* ==================================================================== *
   * KARE DÖNGÜSÜ — canlandırma 20 kare/sn, sakin modda ve kapalı sekmede
   * hiç kare yok.
   * ==================================================================== */
  function canliMi() {
    if (!S.acik) return false;
    if (!S.insaBitti) return true;
    if (S.basiliSula) return true;
    if (S.tasima) return true;                  /* elde bir şey taşınıyor */
    if (S.suAkiyor || (S.damla && S.damla.length)) return true;
    if (S.islak.length) return true;            /* ıslaklık soluyor */
    if (S.parcalar.length || S.balonlar.length) return true;
    if (S.veri && S.veri.mesgul) return true;   /* makine çalışırken izliyoruz */
    if (S.sakin) return false;
    if (document.hidden) return false;
    return true;                                  /* salınım, toz, ışık */
  }
  function isteKare() {
    if (!S.dongu && S.acik) S.dongu = requestAnimationFrame(kare);
  }
  function kare(t) {
    S.dongu = 0;
    var sn = t / 1000;
    var dt = kis(sn - (S.sonT || sn), 0, 0.06);
    S.sonT = sn; S.t = sn;
    if (!S.insaBitti) {
      S.insaT += dt;
      if (S.insaT > 5.8) { S.insaBitti = true; S.insaVar = false; }
    }
    if (S.basiliSula) {
      S.basiliSn = (Date.now() - S.basiliT0) / 1000;
      if (S.basiliSn > 60) S.basiliSn = 60;
      var sne = $("#bh-sn");
      if (sne) sne.textContent = S.basiliSn.toFixed(1) + " sn";
    }
    /* Konum yumuşatma: gelen paket HEDEF, ekran ona doğru gidiyor;
       asla ölçülen konumun ilerisine geçmiyor. */
    if (S.makine.x != null) {
      if (!S.robot) S.robot = { x: S.makine.x, y: S.makine.y, z: S.makine.z };
      var kk = kis(dt * 7, 0, 1);
      S.robot.x += (S.makine.x - S.robot.x) * kk;
      S.robot.y += (S.makine.y - S.robot.y) * kk;
      S.robot.z = S.makine.z;
    }
    var gecti = sn - S.sonCizim;
    if (S.insaBitti && gecti < 1 / CANLI_FPS) {
      if (canliMi()) S.dongu = requestAnimationFrame(kare);
      return;
    }
    S.sonCizim = sn;
    suGuncelle(dt);
    parcaGuncelle(dt);
    var b0 = performance.now();
    sahneCiz(dt);
    var ms = performance.now() - b0;
    S.olcum.kare++; S.olcum.sure += ms;
    if (ms > S.olcum.enUzun) S.olcum.enUzun = ms;
    if (canliMi()) S.dongu = requestAnimationFrame(kare);
  }

  var sahneCiz = guvenli("sahne", function (dt) {
    var c = S.ct;
    if (!c || !S.en || !S.boy) return;
    c.setTransform(S.olcek, 0, 0, S.olcek, 0, 0);
    c.clearRect(0, 0, S.en, S.boy);
    c.fillStyle = "#0b0d0a"; c.fillRect(0, 0, S.en, S.boy);

    var pc = evre("cim");
    if (!S.insaBitti) cimCiz(Math.ceil(S.cimYaprak.length * pc) - S.cimIx);
    c.drawImage(S.cim, 0, 0, S.cim.width, S.cim.height, 0, 0, S.en, S.boy);

    tahtaCiz(c, evre("tahta"));

    var pt = evre("toprak");
    if (pt > 0) {
      c.save();
      c.beginPath(); c.rect(G.ox, G.oy, G.bw, G.bh * ky(pt)); c.clip();
      c.drawImage(S.toprak, 0, 0, S.toprak.width, S.toprak.height, 0, 0, S.en, S.boy);
      c.restore();
      if (pt < 1) {
        c.strokeStyle = "rgba(255,226,180,.35)"; c.lineWidth = 2;
        c.beginPath();
        var yy = G.oy + G.bh * ky(pt);
        c.moveTo(G.ox, yy);
        for (var x = G.ox; x <= G.ox + G.bw; x += 12) {
          c.lineTo(x, yy + Math.sin(x * 0.12 + S.t * 8) * 2);
        }
        c.stroke();
      }
    }
    nemKatCiz(c, evre("nem"));
    islakCiz(c);
    alanCiz(c);

    var ptoh = evre("tohum"), pb = evre("buyume");
    if (!S.insaBitti) {
      S.bitki.forEach(function (b, i) {
        var gec = S.bitki.length > 1 ? i / S.bitki.length : 0;
        b._tohum = kis((ptoh - gec * 0.55) / 0.45, 0, 1);
        b._gorunum = kis((pb - gec * 0.5) / 0.5, 0, 1);
      });
    }
    bitkiCizHepsi(c);
    ekimCiz(c);
    makineCiz(c, evre("ray"));
    suCiz(c);
    suNedenYok(c);
    calisanAletCiz(c);
    eylemCiz(c);
    kartCiz(c);
    if (S.insaBitti) { rayCiz(c); gorevCiz(c); sensorCiz(c); jogCiz(c); }
    balonCiz(c);
    atmosferCiz(c, dt);
    bulutCiz(c, dt);
    isikCiz(c);
    parcaCiz(c);
    tasimaCiz(c);
    filmCiz(c);
    if (!S.insaBitti) {
      c.fillStyle = "rgba(255,255,255,.5)";
      c.font = "12px ui-monospace,monospace"; c.textAlign = "center";
      c.fillText("bahçe kuruluyor… (dokun, atla)", S.en / 2, S.boy - 10);
    }
  });

  /* ==================================================================== *
   * TUVAL ÖLÇÜSÜ
   * ==================================================================== */
  var olcuKur = guvenli("ölçü", function () {
    var kok = $("#bh-tuval");
    if (!kok || !S.tuval) return;
    var r = kok.getBoundingClientRect();
    var en = Math.max(240, Math.round(r.width));
    var boy = Math.max(200, Math.round(r.height));
    var dpr = kis(window.devicePixelRatio || 1, 1, 2);
    if (en === S.en && boy === S.boy && dpr === S.olcek) return;
    S.en = en; S.boy = boy; S.olcek = dpr;
    S.tuval.width = Math.round(en * dpr);
    S.tuval.height = Math.round(boy * dpr);
    S.tuval.style.width = en + "px";
    S.tuval.style.height = boy + "px";
    S.ct.setTransform(dpr, 0, 0, dpr, 0, 0);
    yerlesim();
    katmanKur();
    atmosferKur();
    if (S.insaBitti) cimCiz(S.cimYaprak.length);
    isteKare();
  });

  /* ==================================================================== *
   * SES — kısa, sentezlenmiş, dosyasız.
   *
   * Ses dosyası indirmiyoruz: Pi'nin SD kartına megabaytlarca örnek
   * koymak ve her açılışta indirmek, tek bir "şırıltı" için ağır. Bütün
   * sesler Web Audio ile burada üretiliyor.
   *
   * SES BİR BİLDİRİM DEĞİL, BİR GERİ BİLDİRİM: yalnız KULLANICININ
   * yaptığı bir şeyin karşılığında çalıyor (alet aldın, iş sıraya girdi,
   * su gerçekten aktı, hasat kaydedildi). Arka planda kendiliğinden ses
   * çıkmıyor. Tarayıcı ilk dokunuşa kadar sesi açtırmıyor; bu yüzden
   * bağlam ilk dokunuşta kuruluyor.
   * ==================================================================== */
  var Ses = (function () {
    var ctx = null, acik = true, ana = null;
    var akis = null, motor = null;
    try { acik = localStorage.getItem("bh-ses") !== "0"; } catch (h) { acik = true; }
    function kur() {
      if (!acik) return null;
      if (!ctx) {
        var C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        try { ctx = new C(); } catch (h) { return null; }
        /* YUMUŞAK ZİNCİR: her ses önce tiz kesen bir süzgeçten, sonra
           düşük bir ana kazançtan geçiyor. Sesler "bildirim" gibi değil,
           uzaktan duyulan bir bahçe gibi dursun diye. */
        var suz = ctx.createBiquadFilter();
        suz.type = "lowpass"; suz.frequency.value = 2600; suz.Q.value = 0.6;
        var raf = ctx.createBiquadFilter();
        raf.type = "peaking"; raf.frequency.value = 3000; raf.gain.value = -6; raf.Q.value = 1;
        ana = ctx.createGain(); ana.gain.value = 0.42;
        ana.connect(suz); suz.connect(raf); raf.connect(ctx.destination);
      }
      if (ctx.state === "suspended" && ctx.resume) { try { ctx.resume(); } catch (h) {} }
      return ctx;
    }
    function gurultuTampon(c, sn) {
      var n = Math.max(1, Math.floor(c.sampleRate * sn));
      var t = c.createBuffer(1, n, c.sampleRate), d = t.getChannelData(0), i;
      for (i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return t;
    }
    /* Yumuşak zarf: 8 ms'lik dik atak "tık" diye çarpıyordu; atak
       sürenin beşte biri kadar (en az 25 ms) ve sönüm daha uzun. */
    function zarf(k, t0, sure, tepe) {
      var atak = Math.max(0.025, sure * 0.2);
      k.gain.setValueAtTime(0.0001, t0);
      k.gain.exponentialRampToValueAtTime(tepe, t0 + atak);
      k.gain.exponentialRampToValueAtTime(0.0001, t0 + sure + atak);
    }
    function ton(f0, f1, sure, tip, tepe, gecikme) {
      var c = kur();
      if (!c) return;
      var t0 = c.currentTime + (gecikme || 0);
      var o = c.createOscillator(), k = c.createGain();
      o.type = tip || "sine";
      o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + sure);
      zarf(k, t0, sure, tepe || 0.12);
      o.connect(k); k.connect(ana);
      o.start(t0); o.stop(t0 + sure + 0.02);
    }
    function patlama(sure, f0, f1, tepe, q, gecikme) {
      var c = kur();
      if (!c) return;
      var t0 = c.currentTime + (gecikme || 0);
      var kay = c.createBufferSource(); kay.buffer = gurultuTampon(c, sure);
      var sz = c.createBiquadFilter();
      sz.type = "bandpass"; sz.Q.value = q || 1.2;
      sz.frequency.setValueAtTime(f0, t0);
      sz.frequency.exponentialRampToValueAtTime(Math.max(20, f1 || f0), t0 + sure);
      var k = c.createGain();
      zarf(k, t0, sure, tepe || 0.09);
      kay.connect(sz); sz.connect(k); k.connect(ana);
      kay.start(t0); kay.stop(t0 + sure);
    }
    /** RÖLE TIKI — gerçek makinenin sesi bu: kuru, kısa, metalik. */
    function role(tepe) {
      /* Sert metal tık yerine yumuşak tahta tıkırtısı: alçak bantta
         kısa bir gürültü + yuvarlak bir üçgen ton. */
      patlama(0.05, 900, 380, (tepe || 0.08) * 0.7, 2.2);
      ton(520, 300, 0.07, "triangle", (tepe || 0.08) * 0.5);
    }
    return {
      acikMi: function () { return acik; },
      degistir: function () {
        acik = !acik;
        try { localStorage.setItem("bh-ses", acik ? "1" : "0"); } catch (h) {}
        if (!acik) { this.akisDur(); this.motorDur(); }
        else role(0.055);
        return acik;
      },
      uyandir: function () { kur(); },

      /* ---- SÜREKLİ SESLER: gerçek bir durum sürdüğü sürece çalıyorlar,
         durum bitince susuyorlar. Tekrar tekrar patlatılan kısa örnekler
         "su akıyor" değil "biri bardağı deviriyor" gibi duyuluyordu. ---- */
      /** Su akışı: boru şırıltısı. İki bantlı gürültü + yavaş kabarcık
       *  dalgalanması. Röle açık olduğu SÜRECE çalıyor. */
      akisBasla: function () {
        var c = kur();
        if (!c || akis) return;
        var kay = c.createBufferSource();
        kay.buffer = gurultuTampon(c, 2); kay.loop = true;
        var alt = c.createBiquadFilter();
        alt.type = "lowpass"; alt.frequency.value = 1500;
        var bant = c.createBiquadFilter();
        bant.type = "bandpass"; bant.frequency.value = 1100; bant.Q.value = 0.7;
        var k = c.createGain();
        k.gain.setValueAtTime(0.0001, c.currentTime);
        k.gain.exponentialRampToValueAtTime(0.032, c.currentTime + 0.45);
        /* Kabarcık: bant frekansını yavaşça gezdiren düşük frekanslı
           salınım. Düz gürültü "hışırtı", gezinen gürültü "su". */
        var lfo = c.createOscillator(), lk = c.createGain();
        lfo.type = "sine"; lfo.frequency.value = 1.6; lk.gain.value = 260;
        lfo.connect(lk); lk.connect(bant.frequency);
        kay.connect(alt); alt.connect(bant); bant.connect(k); k.connect(ana);
        kay.start(); lfo.start();
        akis = { kay: kay, k: k, lfo: lfo };
      },
      akisDur: function () {
        if (!akis || !ctx) { akis = null; return; }
        var t = ctx.currentTime;
        try {
          akis.k.gain.cancelScheduledValues(t);
          akis.k.gain.setValueAtTime(akis.k.gain.value, t);
          akis.k.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
          akis.kay.stop(t + 0.55); akis.lfo.stop(t + 0.55);
        } catch (h) {}
        akis = null;
      },
      /** Step motor uğultusu: makine GERÇEKTEN hareket ederken
       *  (`durum.hareket`). Testere dişi + alçak geçiren = sürücü sesi. */
      motorBasla: function () {
        var c = kur();
        if (!c || motor) return;
        var o = c.createOscillator(), o2 = c.createOscillator();
        var f = c.createBiquadFilter(), k = c.createGain();
        o.type = "triangle"; o.frequency.value = 76;
        o2.type = "sine"; o2.frequency.value = 152;
        f.type = "lowpass"; f.frequency.value = 340; f.Q.value = 1.2;
        k.gain.setValueAtTime(0.0001, c.currentTime);
        k.gain.exponentialRampToValueAtTime(0.018, c.currentTime + 0.35);
        var tit = c.createOscillator(), tk = c.createGain();
        tit.type = "sine"; tit.frequency.value = 4.5; tk.gain.value = 2.5;
        tit.connect(tk); tk.connect(o.frequency);
        o.connect(f); o2.connect(f); f.connect(k); k.connect(ana);
        o.start(); o2.start(); tit.start();
        motor = { o: o, o2: o2, tit: tit, k: k };
      },
      motorDur: function () {
        if (!motor || !ctx) { motor = null; return; }
        var t = ctx.currentTime;
        try {
          motor.k.gain.cancelScheduledValues(t);
          motor.k.gain.setValueAtTime(motor.k.gain.value, t);
          motor.k.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
          motor.o.stop(t + 0.45); motor.o2.stop(t + 0.45); motor.tit.stop(t + 0.45);
        } catch (h) {}
        motor = null;
      },

      /* ---- ANLIK SESLER: hepsi bir MAKİNE PARÇASININ sesi ---- */
      role: role,                                   /* vana / röle tıkı */
      tik: function () { role(0.05); },             /* alet alındı */
      damla: function () {                          /* iş kuyruğa girdi */
        ton(660, 500, 0.16, "sine", 0.035);
        ton(990, 760, 0.12, "sine", 0.018, 0.06);
      },
      prob: function () {                           /* prob toprağa iniyor */
        patlama(0.22, 520, 180, 0.05, 1.1);
        ton(170, 110, 0.2, "sine", 0.035, 0.03);
      },
      deklansor: function () {                      /* kamera */
        role(0.055);
        patlama(0.06, 1600, 700, 0.035, 2.5, 0.07);
      },
      pop: function () {                            /* hasat — sap kopuyor */
        patlama(0.06, 1200, 480, 0.045, 2.4);
        ton(380, 140, 0.2, "sine", 0.06, 0.02);
        patlama(0.26, 240, 100, 0.035, 0.7, 0.05);
      },
      toprak: function () { patlama(0.3, 260, 95, 0.045, 0.6); },   /* toprağa konuldu */
      home: function () {                           /* home: iki eksen ucu */
        role(0.05);
        ton(140, 85, 0.3, "sine", 0.04, 0.05);
      },
      basari: function () {                         /* iş bitti */
        ton(523, 523, 0.22, "sine", 0.03, 0);
        ton(784, 784, 0.3, "sine", 0.028, 0.14);
      },
      hata: function () {
        ton(220, 150, 0.3, "sine", 0.04);
        ton(165, 130, 0.32, "sine", 0.028, 0.05);
      }
    };
  }());

  /* ==================================================================== *
   * BALON YAZILAR VE PARÇACIKLAR — mikro geri bildirim.
   *
   * Balonun metni NE OLDUĞUNU söylüyor, ne olmasını istediğimizi değil:
   * alet bırakıldığında "sulama sıraya girdi", su RÖLESİ açıldığında
   * "+su veriliyor", hasat KAYDEDİLDİĞİNDE "hasat edildi". Sıraya giren
   * işe "+su eklendi" demek, olmamış bir şeyi olmuş göstermek olurdu.
   * ==================================================================== */
  function balon(mx, my, metin, renk) {
    S.balonlar.push({ x: sayi(mx), y: sayi(my), metin: String(metin),
                      renk: renk || "#bfe2ff", t0: S.t });
    if (S.balonlar.length > 8) S.balonlar.shift();
    isteKare();
  }
  function balonCiz(c) {
    if (!S.balonlar.length) return;
    c.save();
    c.textAlign = "center";
    for (var i = S.balonlar.length - 1; i >= 0; i--) {
      var o = S.balonlar[i];
      var p = (S.t - o.t0) / 1.8;
      if (p >= 1) { S.balonlar.splice(i, 1); continue; }
      var x = px(o.x), y = py(o.y) - 18 - ky(p) * 34;
      c.globalAlpha = p < 0.12 ? p / 0.12 : kis((1 - p) / 0.45, 0, 1);
      c.font = "700 12px system-ui,sans-serif";
      var gen = c.measureText(o.metin).width + 16;
      c.fillStyle = "rgba(12,16,10,.82)";
      c.beginPath();
      if (c.roundRect) c.roundRect(x - gen / 2, y - 13, gen, 20, 10);
      else c.rect(x - gen / 2, y - 13, gen, 20);
      c.fill();
      c.fillStyle = o.renk;
      c.fillText(o.metin, x, y + 2);
    }
    c.restore();
  }
  /** Konfeti: yalnız GERÇEKTEN olmuş bir iş için patlıyor. */
  function parcaPatlat(sx, sy, renkler, adet) {
    var i, r = renkler || ["#f6c456", "#7bbf5a", "#8fd0ff", "#e8ece2"];
    for (i = 0; i < (adet || 26); i++) {
      var a = Math.random() * 6.283, h = 70 + Math.random() * 190;
      S.parcalar.push({ x: sx, y: sy, vx: Math.cos(a) * h, vy: Math.sin(a) * h - 60,
                        d: Math.random() * 6.3, dv: (Math.random() - 0.5) * 12,
                        renk: r[i % r.length], t: 0,
                        sure: 0.7 + Math.random() * 0.6,
                        en: 3 + Math.random() * 3 });
    }
    isteKare();
  }
  function parcaGuncelle(dt) {
    for (var i = S.parcalar.length - 1; i >= 0; i--) {
      var o = S.parcalar[i];
      o.t += dt; o.x += o.vx * dt; o.y += o.vy * dt;
      o.vy += 300 * dt; o.vx *= (1 - kis(dt * 1.2, 0, 1)); o.d += o.dv * dt;
      if (o.t > o.sure) S.parcalar.splice(i, 1);
    }
  }
  function parcaCiz(c) {
    if (!S.parcalar.length) return;
    c.save();
    S.parcalar.forEach(function (o) {
      c.globalAlpha = kis(1 - o.t / o.sure, 0, 1);
      c.fillStyle = o.renk;
      c.save();
      c.translate(o.x, o.y); c.rotate(o.d);
      c.fillRect(-o.en / 2, -o.en / 4, o.en, o.en * 0.55);
      c.restore();
    });
    c.restore();
  }

  /* ==================================================================== *
   * BULUT GÖLGELERİ VE RÜZGÂR
   *
   * HİÇBİR ÖLÇÜME KARŞILIK GELMİYOR. Bu makinede ışık, rüzgâr ve bulut
   * sensörü yok; bunlar sahnenin havası, veri değil — tıpkı günün saatine
   * göre değişen ışık gibi. Hiçbir sayıya dönüşmüyorlar, hiçbir kararı
   * etkilemiyorlar. Sakin modda ikisi de duruyor.
   * ==================================================================== */
  function bulutKur() {
    var r = uretec(7714), i;
    S.bulutlar = [];
    for (i = 0; i < 3; i++) {
      S.bulutlar.push({ x: r() * 1.6 - 0.3, y: 0.1 + r() * 0.8,
                        en: 0.35 + r() * 0.5, hiz: 0.012 + r() * 0.016,
                        koyu: 0.10 + r() * 0.08 });
    }
  }
  function bulutCiz(c, dt) {
    if (S.sakin || !S.bulutlar) return;
    c.save();
    S.bulutlar.forEach(function (o) {
      o.x += o.hiz * dt;
      if (o.x > 1.5) { o.x = -0.5; o.y = 0.1 + Math.random() * 0.8; }
      var cx = o.x * S.en, cy = o.y * S.boy;
      var rx = o.en * S.en * 0.5, ry = rx * 0.42;
      var g = c.createRadialGradient(cx, cy, 0, cx, cy, rx);
      g.addColorStop(0, "rgba(6,10,16," + o.koyu.toFixed(3) + ")");
      g.addColorStop(0.65, "rgba(6,10,16," + (o.koyu * 0.55).toFixed(3) + ")");
      g.addColorStop(1, "rgba(6,10,16,0)");
      c.fillStyle = g;
      c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, 6.3); c.fill();
    });
    c.restore();
  }
  /** Rüzgâr: tarlayı soldan sağa geçen esinti dalgası. Yaprakların
   *  salınımını yerine göre güçlendiriyor — hepsi aynı anda değil. */
  function esinti(sx) {
    if (S.sakin) return 1;
    var faz = S.t * 0.55 - (sx / Math.max(1, S.en)) * 1.8;
    return 1 + Math.max(0, Math.sin(faz)) * Math.max(0, Math.sin(S.t * 0.21)) * 2.2;
  }

  /* ==================================================================== *
   * GÖREV TABELASI VE ÇİFTÇİ PUANI
   *
   * GÖREVLER UYDURULMUYOR. "Bugün 5 bitki sula" gibi bir hedefi ekran
   * kendi kafasından koysaydı, kullanıcıyı makinenin gerçekten gerek
   * duymadığı bir işe yönlendirirdi. Tabeladaki satırlar sunucunun
   * `/api/bahce` içinde verdiği KARTLARIN ta kendisi: susama kararı da,
   * kaç bitki olduğu da orada hesaplanıyor. Kart listeden düşünce görev
   * bitmiş sayılıyor.
   *
   * ÇİFTÇİ PUANI SUNUCU VERİSİ DEĞİL: bu tarayıcıda tutulan bir sayaç
   * (localStorage). Tabelanın altında bunu yazıyor. Makineyle, hasat
   * kaydıyla ya da herhangi bir ölçümle karıştırılmasın diye hiçbir
   * karara girmiyor; yalnız yaptığın işleri sayıyor.
   * ==================================================================== */
  var XP = { puan: 0, tarih: "", gunluk: 0 };
  function xpOku() {
    try {
      var ham = JSON.parse(localStorage.getItem("bh-xp") || "{}");
      XP.puan = sayi(ham.puan, 0);
      XP.tarih = String(ham.tarih || "");
      XP.gunluk = sayi(ham.gunluk, 0);
    } catch (h) { XP.puan = 0; }
    var b = new Date().toDateString();
    if (XP.tarih !== b) { XP.tarih = b; XP.gunluk = 0; }
  }
  function xpYaz() {
    try {
      localStorage.setItem("bh-xp", JSON.stringify(
        { puan: XP.puan, tarih: XP.tarih, gunluk: XP.gunluk }));
    } catch (h) {}
  }
  function seviye() { return Math.floor(XP.puan / 120) + 1; }
  function xpEkle(n, sebep) {
    var onceki = seviye();
    XP.puan += n; XP.gunluk += n;
    xpYaz();
    gunluk("bahçe: +" + n + " çiftçi puanı · " + (sebep || ""));
    if (seviye() > onceki) {
      Ses.basari();
      parcaPatlat(S.en / 2, S.boy * 0.35, ["#f6c456", "#8fd0ff", "#7bbf5a"], 40);
      mesajYaz("Çiftçi seviyesi " + seviye() + " oldu — puan bu tarayıcıda tutuluyor.");
    }
    isteKare();
  }
  /** Kuyruk değişimini izleyip BİTEN işleri buluyor: bir iş kimliği
   *  listeden düşmüşse ve onu biz iptal etmediysek, makine onu yapmış
   *  demektir. */
  var kuyrukGorulen = {}, iptalEdilen = {};
  /** İŞ BAŞLADIĞINDA O İŞİN SESİ: prob toprağa iniyor, deklanşör,
   *  vana. Kuyruktaki "çalışan" iş değişince bir kez çalıyor. */
  var calisanSonKimlik = "";
  function calisanSes() {
    var ca = ((S.veri && S.veri.kuyruk) || {}).calisan;
    var kimlik = ca ? String(ca.kimlik) : "";
    if (kimlik === calisanSonKimlik) return;
    calisanSonKimlik = kimlik;
    if (!ca) return;
    if (ca.tip === "nem") Ses.prob();
    else if (ca.tip === "foto") Ses.deklansor();
    else if (ca.tip === "sula") Ses.role(0.06);   /* vana açılıyor */
    else if (ca.tip === "gez") Ses.role(0.04);
  }
  function kuyrukIzle() {
    calisanSes();
    var k = (S.veri && S.veri.kuyruk) || {};
    var simdi = {}, bitti = 0;
    (k.isler || []).forEach(function (i) { simdi[String(i.kimlik)] = i.tip || ""; });
    if (k.calisan) simdi[String(k.calisan.kimlik)] = k.calisan.tip || "";
    Object.keys(kuyrukGorulen).forEach(function (kimlik) {
      if (simdi[kimlik]) return;
      if (iptalEdilen[kimlik]) { delete iptalEdilen[kimlik]; return; }
      bitti++;
    });
    if (bitti > 0) { xpEkle(4 * bitti, bitti + " iş bitti"); Ses.basari(); }
    kuyrukGorulen = simdi;
  }
  /** Tabelanın satırları: sunucunun kartları. */
  function gorevListesi() {
    return acikKartlar().slice(0, 3).map(function (k) {
      return { kimlik: String(k.kimlik), metin: String(k.metin || k.baslik || k.tip || "iş"),
               ertelendi: !!k.ertelendi,
               adet: ((k.noktalar || []).length) || 0 };
    });
  }
  function gorevKur() {
    /* Tabela sol çimde, alet askısının üstünde. Yer dar ise çizilmiyor:
       üst şerit zaten aynı kartları yazıyor, iki kez söylemenin anlamı
       yok ve dar ekranda tabela sahneyi yiyor. */
    var solBos = G.ox - G.kal - G.ray - 12;
    if (solBos < 172 || S.boy < 320) { S.gorevKutu = null; return; }
    var w = Math.min(236, solBos - 16);
    S.gorevKutu = { x: Math.max(10, (solBos - w) / 2), y: 14, w: w, h: 132 };
  }
  /** Tabela KARE BAŞINA DEĞİL, içeriği değişince çiziliyor: ahşap
   *  dokusu, gölgesi ve yazıları her karede yeniden üretmek 24 bitkilik
   *  sahnede ölçülen kare süresini boş yere yükseltiyordu. */
  function gorevDamga() {
    var kt = S.gorevKutu;
    if (!kt) return "";
    return kt.x + "x" + kt.y + "x" + kt.w + "|" + XP.puan + "|"
      + gorevListesi().map(function (g) {
          return g.kimlik + (g.ertelendi ? "e" : "") + g.metin;
        }).join(";");
  }
  function gorevCiz(c) {
    var kt = S.gorevKutu;
    if (!kt) return;
    var d = gorevDamga();
    if (S.gorevTuval && d === S.gorevDamga) {
      c.drawImage(S.gorevTuval, 0, 0, S.gorevTuval.width, S.gorevTuval.height,
        0, 0, S.en, S.boy);
      return;
    }
    if (!S.gorevTuval || S.gorevTuval.width !== S.tuval.width
      || S.gorevTuval.height !== S.tuval.height) {
      S.gorevTuval = document.createElement("canvas");
      S.gorevTuval.width = S.tuval.width; S.gorevTuval.height = S.tuval.height;
      S.gorevCt = S.gorevTuval.getContext("2d");
    }
    S.gorevCt.setTransform(S.olcek, 0, 0, S.olcek, 0, 0);
    S.gorevCt.clearRect(0, 0, S.en, S.boy);
    gorevBoya(S.gorevCt, kt, gorevListesi());
    S.gorevDamga = d;
    c.drawImage(S.gorevTuval, 0, 0, S.gorevTuval.width, S.gorevTuval.height,
      0, 0, S.en, S.boy);
  }
  function gorevBoya(c, kt, liste) {
    c.save();
    /* İki direk + tahta tabela. */
    c.fillStyle = "#6b4a2c";
    c.fillRect(kt.x + 14, kt.y + kt.h - 6, 7, 16);
    c.fillRect(kt.x + kt.w - 21, kt.y + kt.h - 6, 7, 16);
    c.fillStyle = "rgba(0,0,0,.32)";
    c.beginPath();
    if (c.roundRect) c.roundRect(kt.x + 3, kt.y + 5, kt.w, kt.h, 8);
    else c.rect(kt.x + 3, kt.y + 5, kt.w, kt.h);
    c.fill();
    var g = c.createLinearGradient(kt.x, kt.y, kt.x, kt.y + kt.h);
    g.addColorStop(0, "#9a6f42"); g.addColorStop(0.5, "#835b33"); g.addColorStop(1, "#6d4a29");
    c.fillStyle = g;
    c.beginPath();
    if (c.roundRect) c.roundRect(kt.x, kt.y, kt.w, kt.h, 8); else c.rect(kt.x, kt.y, kt.w, kt.h);
    c.fill();
    c.strokeStyle = "rgba(38,24,10,.55)"; c.lineWidth = 1.4; c.stroke();
    c.strokeStyle = "rgba(255,226,178,.14)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(kt.x + 6, kt.y + kt.h * 0.42);
    c.lineTo(kt.x + kt.w - 6, kt.y + kt.h * 0.42); c.stroke();

    c.textAlign = "left";
    c.font = "700 12px system-ui,sans-serif";
    c.fillStyle = "#f3e3c6";
    c.fillText("Bugünün işleri", kt.x + 12, kt.y + 20);
    c.font = "10px system-ui,sans-serif";
    c.fillStyle = "rgba(243,227,198,.65)";
    c.fillText("sunucunun kararı", kt.x + 12, kt.y + 33);

    var yy = kt.y + 52;
    if (!liste.length) {
      c.font = "italic 11px system-ui,sans-serif";
      c.fillStyle = "rgba(243,227,198,.8)";
      c.fillText("bugün bekleyen iş yok", kt.x + 12, yy);
    }
    liste.forEach(function (gv) {
      /* Kutu: ertelenmiş iş çizili değil, SOLGUN — yapılmadı, bekliyor. */
      c.strokeStyle = "rgba(243,227,198,.75)"; c.lineWidth = 1.4;
      c.beginPath();
      if (c.roundRect) c.roundRect(kt.x + 12, yy - 9, 11, 11, 3);
      else c.rect(kt.x + 12, yy - 9, 11, 11);
      c.stroke();
      c.font = "11px system-ui,sans-serif";
      c.fillStyle = gv.ertelendi ? "rgba(243,227,198,.45)" : "#f3e3c6";
      var metin = gv.metin.length > 26 ? gv.metin.slice(0, 25) + "…" : gv.metin;
      c.fillText(metin, kt.x + 30, yy);
      if (gv.ertelendi) {
        c.strokeStyle = "rgba(243,227,198,.45)"; c.lineWidth = 1;
        var gen = c.measureText(metin).width;
        c.beginPath(); c.moveTo(kt.x + 30, yy - 4);
        c.lineTo(kt.x + 30 + gen, yy - 4); c.stroke();
      }
      yy += 20;
    });

    /* Puan çubuğu — SUNUCU DEĞİL, bu tarayıcı. */
    var cy = kt.y + kt.h - 26, cw = kt.w - 24;
    var oran = (XP.puan % 120) / 120;
    c.fillStyle = "rgba(30,20,10,.5)";
    c.beginPath();
    if (c.roundRect) c.roundRect(kt.x + 12, cy, cw, 7, 4); else c.rect(kt.x + 12, cy, cw, 7);
    c.fill();
    c.fillStyle = "#7bbf5a";
    c.beginPath();
    if (c.roundRect) c.roundRect(kt.x + 12, cy, Math.max(3, cw * oran), 7, 4);
    else c.rect(kt.x + 12, cy, Math.max(3, cw * oran), 7);
    c.fill();
    c.font = "10px system-ui,sans-serif";
    c.fillStyle = "rgba(243,227,198,.85)";
    c.fillText("Çiftçi " + seviye() + " · " + XP.puan + " puan (bu tarayıcıda)",
      kt.x + 12, cy + 20);
    c.restore();
  }

  /* ==================================================================== *
   * SENSÖR TAHTASI — GERÇEK ÖLÇÜMLER, BAHÇENİN İÇİNDE
   *
   * Değerler `/api/durum` ucunun `olcum` bölümünden: hava sıcaklığı, hava
   * nemi, basınç, toprak nemi, BMP sıcaklığı. UYDURMA YOK: yalnız gelen
   * kanallar yazılıyor, gelmeyen kanal için satır açılmıyor. Her satırın
   * yanında okumanın YAŞI var — 40 saniye önceki bir sayı ile şimdiki
   * sayı aynı görünmemeli. Paket hiç gelmediyse tahtada sebebi yazıyor.
   *
   * Yağmur, ışık ve rüzgâr sensörü bu makinede YOK; tahtada da yok.
   * ==================================================================== */
  var OLCUM_SATIR = [
    /* "Hava" tek başına neyin havası olduğunu söylemiyordu; yanında
       "Hava nemi" durunca ikisi aynı şeyin iki hâli gibi okunuyor. */
    { k: "hava_sicaklik", ad: "Hava sıcaklığı", birim: "°C", ondalik: 1 },
    { k: "hava_nem", ad: "Hava nemi", birim: "%", ondalik: 0 },
    /* TOPRAK NEMİ AYRI ELE ALINIYOR (bkz. `olcumSatirlari`): ham sayı
       yüzde değil ve "%" etiketiyle göstermek yanlıştı. */
    { k: "basinc", ad: "Basınç", birim: "hPa", ondalik: 0 },
    { k: "bmp_sicaklik", ad: "Kart", birim: "°C", ondalik: 1 }
  ];
  var olcumAl = guvenli("ölçüm", function () {
    return api("/api/durum").then(function (c) {
      S.olcumVeri = (c && c.olcum) || null;
      S.olcumT = Date.now();
      S.olcumHata = "";
      isteKare();
    }).catch(function (h) {
      S.olcumVeri = null;
      S.olcumHata = "okunamadı — " + ((h && h.kod ? h.kod + ": " : "")
        + ((h && h.message) || "sebep bilinmiyor"));
      isteKare();
    });
  });
  function olcumSatirlari() {
    var o = S.olcumVeri || {}, cikti = [];
    OLCUM_SATIR.forEach(function (t) {
      var d = o[t.k];
      if (d === null || d === undefined || !isFinite(Number(d))) return;
      cikti.push({ ad: t.ad, deger: Number(d).toFixed(t.ondalik) + " " + t.birim });
    });

    /* TOPRAK NEMİ — "%" DEĞİL, KALİBRE EDİLMEMİŞSE HAM SAYI.
     *
     * Burada `toprak_nem` doğrudan "%" ile yazılıyordu ve ekranda
     * "Toprak nemi 1022 %" görünüyordu. 1022 bir yüzde değil, 0-1023
     * arası ADC sayımı — üstelik büyük sayı KURU demek, yani gösterilen
     * şey anlamın tersiydi.
     *
     * Ajan artık `toprak_nem_yuzde` (kalibre yüzde) ve `toprak_kalibre`
     * (kalibrasyon makul mü) gönderiyor. Yüzde varsa o yazılıyor; yoksa
     * ham sayı "ham" etiketiyle duruyor ve yanında ne yapılacağı yazılı.
     * Uydurma bir yüzde göstermek, ham sayıyı "%" demekle aynı yalan. */
    var ham = o.toprak_nem;
    var yuzde = o.toprak_nem_yuzde;
    if (yuzde !== null && yuzde !== undefined && isFinite(Number(yuzde))) {
      cikti.splice(2, 0, { ad: "Toprak nemi",
                           deger: Number(yuzde).toFixed(0) + " %" });
    } else if (ham !== null && ham !== undefined && isFinite(Number(ham))) {
      cikti.splice(2, 0, { ad: "Toprak nemi",
                           deger: Number(ham).toFixed(0) + " ham" });
    }
    return cikti;
  }
  function sensorKur() {
    var sagBos = S.en - (G.ox + G.bw + G.kal + G.ray + 12);
    if (sagBos < 150 || S.boy < 300) { S.sensorKutu = null; return; }
    var w = Math.min(200, sagBos - 14);
    S.sensorKutu = { x: S.en - sagBos / 2 - w / 2, y: 14, w: w, h: 128 };
  }
  function sensorCiz(c) {
    var kt = S.sensorKutu;
    if (!kt) return;
    var satir = olcumSatirlari();
    c.save();
    /* Direk + tahta: görev tabelasının kardeşi, sağ çimde. */
    c.fillStyle = "#6b4a2c";
    c.fillRect(kt.x + kt.w / 2 - 4, kt.y + kt.h - 4, 8, 18);
    c.fillStyle = "rgba(0,0,0,.3)";
    c.beginPath();
    if (c.roundRect) c.roundRect(kt.x + 3, kt.y + 5, kt.w, kt.h, 8);
    else c.rect(kt.x + 3, kt.y + 5, kt.w, kt.h);
    c.fill();
    var g = c.createLinearGradient(kt.x, kt.y, kt.x, kt.y + kt.h);
    g.addColorStop(0, "#8d6b46"); g.addColorStop(0.5, "#79583a"); g.addColorStop(1, "#63472d");
    c.fillStyle = g;
    c.beginPath();
    if (c.roundRect) c.roundRect(kt.x, kt.y, kt.w, kt.h, 8); else c.rect(kt.x, kt.y, kt.w, kt.h);
    c.fill();
    c.strokeStyle = "rgba(38,24,10,.55)"; c.lineWidth = 1.4; c.stroke();

    c.textAlign = "left";
    c.font = "700 12px system-ui,sans-serif"; c.fillStyle = "#f3e3c6";
    c.fillText("Ölçümler", kt.x + 12, kt.y + 20);

    var yas = S.olcumT ? Math.round((Date.now() - S.olcumT) / 1000) : -1;
    c.font = "10px system-ui,sans-serif";
    c.fillStyle = "rgba(243,227,198,.6)";
    c.fillText(yas < 0 ? "henüz okunmadı" : (yas < 90 ? yas + " sn önce"
      : Math.round(yas / 60) + " dk önce"), kt.x + 12, kt.y + 33);

    var yy = kt.y + 54;
    if (!satir.length) {
      c.font = "italic 11px system-ui,sans-serif";
      c.fillStyle = S.olcumHata ? "#ffb9a6" : "rgba(243,227,198,.8)";
      var m = S.olcumHata || "ölçüm paketi gelmedi";
      c.fillText(m.length > 30 ? m.slice(0, 29) + "…" : m, kt.x + 12, yy);
    }
    satir.slice(0, 4).forEach(function (r) {
      c.font = "11px system-ui,sans-serif";
      c.fillStyle = "rgba(243,227,198,.85)";
      c.fillText(r.ad, kt.x + 12, yy);
      c.font = "600 12px ui-monospace,monospace";
      c.fillStyle = "#f3e3c6";
      c.textAlign = "right";
      c.fillText(r.deger, kt.x + kt.w - 12, yy);
      c.textAlign = "left";
      yy += 19;
    });
    c.restore();
  }

  /* ==================================================================== *
   * YÖN TUŞLARI — MAKİNEYİ ELLE SÜRMEK
   *
   * Dört ok X ve Y'yi, iki küçük tuş Z'yi sürüyor; ortadaki tuş BÜTÜN
   * EKSENLERİ home'a gönderiyor. Hepsi var olan `/api/komut` ucunu
   * kullanıyor: basılı tutarken `jog {eksen,yon,basili:true}`, bırakınca
   * `jog_dur`. Yeni bir hareket yolu açılmıyor — sınır ve Z denetimleri
   * ajanda, tek yerde kalsın.
   *
   * KİLİT ŞARTLARI ekranda yazılı: makine kopuksa, sürücü torku kapalıysa
   * ya da acil mandalı düştüyse tuşlar sönük ve sebebi altında. Çalışmayan
   * bir düğmeyi çalışıyor gibi göstermek, kullanıcıyı makinenin bozuk
   * olduğuna inandırır.
   * ==================================================================== */
  function jogKur() {
    var gen = 132;
    var sagBos = S.en - (G.ox + G.bw + G.kal + G.ray + 12);
    var x, y;
    if (sagBos >= gen + 16) {
      x = S.en - sagBos / 2 - gen / 2;
      y = S.boy - gen - 26;
    } else {
      x = S.en - gen - 10;                       /* dar ekran: sağ alt köşe */
      y = S.boy - gen - 14;
    }
    if (S.boy < 260) { S.jog = null; return; }
    var t = 40, orta = gen / 2;
    S.jog = {
      x: x, y: y, w: gen, h: gen,
      tuslar: [
        { k: "y-", ad: "▲", cx: x + orta, cy: y + 22, r: 19, eksen: "y", yon: -1 },
        { k: "y+", ad: "▼", cx: x + orta, cy: y + gen - 22, r: 19, eksen: "y", yon: 1 },
        { k: "x-", ad: "◀", cx: x + 22, cy: y + orta, r: 19, eksen: "x", yon: -1 },
        { k: "x+", ad: "▶", cx: x + gen - 22, cy: y + orta, r: 19, eksen: "x", yon: 1 },
        { k: "home", ad: "⌂", cx: x + orta, cy: y + orta, r: 21, eksen: "", yon: 0 },
        /* Z YÖNÜ ANA PANELLE AYNI OLMAK ZORUNDA. Burada Z▲ eksiye,
         * Z▼ artıya bağlıydı — yani düğmeler makineyi ters yöne
         * götürüyordu. Sür sekmesindeki Z▲ artı, Z▼ eksi (index.html);
         * iki panelde iki yön, kullanıcıyı ekrana göre değil kas
         * hafızasına göre yanıltıyor ve Z'de o, ucu toprağa sürmek
         * demek. Yalnız yön değişti, tuşların yeri ve adı aynı. */
        { k: "z+", ad: "Z▲", cx: x + 24, cy: y - 22, r: 16, eksen: "z", yon: 1 },
        { k: "z-", ad: "Z▼", cx: x + gen - 24, cy: y - 22, r: 16, eksen: "z", yon: -1 }
      ]
    };
    return t;
  }
  /** Tuşlar neden kilitli? Tek cümlede sebep — ya da boş. */
  function jogKilit() {
    if (!(S.veri && S.veri.bagli)) return "makine bağlı değil";
    if (S.acil) return "acil durdurma mandalı düştü";
    if (!S.enable) return "sürücü torku kapalı (Ayarlar > Enable)";
    return "";
  }
  function jogCiz(c) {
    var j = S.jog;
    if (!j) return;
    var kilit = jogKilit();
    c.save();
    /* Kumanda kutusu: koyu, hafif kabartmalı bir pano. */
    c.fillStyle = "rgba(0,0,0,.34)";
    c.beginPath();
    if (c.roundRect) c.roundRect(j.x + 3, j.y + 5, j.w, j.h, 16);
    else c.rect(j.x + 3, j.y + 5, j.w, j.h);
    c.fill();
    var g = c.createLinearGradient(j.x, j.y, j.x, j.y + j.h);
    g.addColorStop(0, "rgba(46,52,46,.96)"); g.addColorStop(1, "rgba(26,30,26,.96)");
    c.fillStyle = g;
    c.beginPath();
    if (c.roundRect) c.roundRect(j.x, j.y, j.w, j.h, 16); else c.rect(j.x, j.y, j.w, j.h);
    c.fill();
    c.strokeStyle = kilit ? "#4a4d47" : "#7c847a"; c.lineWidth = 1.2; c.stroke();

    j.tuslar.forEach(function (t) {
      var basili = S.jogBasili === t.k;
      var evi = t.k === "home";
      c.save();
      c.fillStyle = basili ? (evi ? "#c98a3a" : "#4f6f8a") : "rgba(18,22,18,.92)";
      c.beginPath(); c.arc(t.cx, t.cy, t.r, 0, 6.3); c.fill();
      c.strokeStyle = kilit ? "#4a4d47" : (evi ? "#e0a955" : "#9fb3c4");
      c.lineWidth = basili ? 2.2 : 1.4;
      c.beginPath(); c.arc(t.cx, t.cy, t.r, 0, 6.3); c.stroke();
      c.font = (evi ? "700 17px" : "600 13px") + " system-ui,sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = kilit ? "#6b6f68" : (evi ? "#f0cd8a" : "#d6e2ec");
      c.fillText(t.ad, t.cx, t.cy + 1);
      c.restore();
    });
    c.textBaseline = "alphabetic";
    c.font = "9px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = kilit ? "#e07f6a" : "rgba(214,226,236,.75)";
    c.fillText(kilit || "basılı tut · ⌂ hepsini home'a gönderir",
      j.x + j.w / 2, j.y + j.h + 14);
    /* Konum: tuşların hemen üstünde, makinenin BİLDİRDİĞİ sayı. */
    c.font = "10px ui-monospace,monospace";
    c.fillStyle = "rgba(214,226,236,.7)";
    var m = S.makine;
    c.fillText(m && m.x != null && S.konumVar
      ? ("X " + Math.round(m.x) + "  Y " + Math.round(m.y)
         + (m.z == null ? "" : "  Z " + Math.round(m.z)))
      : "konum bildirilmedi", j.x + j.w / 2, j.y - 44);
    c.restore();
  }
  function jogTusBul(p) {
    var j = S.jog;
    if (!j) return null;
    for (var i = 0; i < j.tuslar.length; i++) {
      var t = j.tuslar[i];
      if (Math.hypot(t.cx - p.x, t.cy - p.y) < t.r + 4) return t;
    }
    return null;
  }
  var komut = guvenli("komut", function (ad, arg) {
    return gonder("/api/komut", { ad: ad, arg: arg || {} })
      .then(function (c) { return c; })
      .catch(function (h) {
        notYaz("komut", ad + " gitmedi — " + ((h && h.message) || h));
        Ses.hata(); isteKare();
        return null;
      });
  });
  function jogBasla(t) {
    var kilit = jogKilit();
    if (kilit) { mesajYaz("Yön tuşları kilitli — " + kilit + "."); Ses.hata(); altYaz(); return; }
    if (t.k === "home") {
      /* HOME BÜTÜN EKSENLERİ HAREKET ETTİRİR: önce ne olacağını yazıyor. */
      onayAc("Bütün eksenler home koordinatına gidecek.",
        "Z önce yukarı çıkıyor, sonra Y ve X. Yolda bir şey varsa çarpar — "
        + "yatağın üstünü kontrol et.", "Home'a git",
        function () {
          Ses.home();
          komut("home", {}).then(function (c) {
            if (c) { mesajYaz("Home komutu gönderildi."); balon(
              sayi(S.makine.x, 0), sayi(S.makine.y, 0), "home", "#f0cd8a"); }
          });
        });
      isteKare(); return;
    }
    S.jogBasili = t.k;
    Ses.uyandir(); Ses.role(0.045);
    komut("jog", { eksen: t.eksen, yon: t.yon, basili: true });
    /* Ajan basılı tutmayı tazeleme ister: 250 ms'de bir aynı bit. */
    if (S.jogSayac) clearInterval(S.jogSayac);
    S.jogSayac = setInterval(function () {
      if (S.jogBasili !== t.k) return;
      komut("jog", { eksen: t.eksen, yon: t.yon, basili: true });
    }, 250);
    isteKare();
  }
  function jogBitir() {
    if (!S.jogBasili) return;
    S.jogBasili = null;
    if (S.jogSayac) { clearInterval(S.jogSayac); S.jogSayac = null; }
    komut("jog_dur", {});
    isteKare();
  }

  /* ==================================================================== *
   * SU — GERÇEK SUYUN GÖRÜNTÜSÜ
   *
   * Damla, ıslaklık ve parıltı YALNIZ su gerçekten aktığında çiziliyor.
   * Kaynak sırasıyla: (1) röle durumu — panelde `Panel.S.roleDurum
   * .su_pompasi` varsa suyun aktığını söyleyen tek gerçek sinyal odur;
   * (2) röle bilinmiyorsa kuyrukta ÇALIŞAN bir sulama işi. İkincisinde
   * ekranda "röle okunmuyor · çalışan işten" yazıyor, çünkü o bir çıkarım.
   *
   * Su nereye düşüyor? UCUN BİLDİRİLEN KONUMUNA. Konum bildirilmiyorsa
   * hiçbir yere damla çizilmiyor — makinenin nerede olduğunu bilmiyoruz.
   * Islaklık hafızası da aynı yerden: gerçekten su verilen noktada kalıyor
   * ve ISLAK_SN içinde soluyor.
   * ==================================================================== */
  var ISLAK_SN = 150;
  function suKaynak() {
    var p = P();
    var rl = p && p.S && p.S.roleDurum;
    if (rl && ("su_pompasi" in rl)) return { akiyor: !!rl.su_pompasi, kanit: "röle" };
    var k = (S.veri && S.veri.kuyruk) || {};
    var ca = k.calisan;
    if (ca && ca.tip === "sula") return { akiyor: true, kanit: "iş" };
    return { akiyor: false, kanit: rl ? "röle" : "yok" };
  }
  function suGuncelle(dt) {
    var kay = suKaynak();
    var m = S.robot || S.makine;
    var yer = (m && m.x != null && S.konumVar) ? { x: sayi(m.x), y: sayi(m.y) } : null;
    var oncekiAkis = S.suAkiyor;
    S.suAkiyor = kay.akiyor && !!yer;
    S.suKanit = kay.kanit;
    /* SES VE BALON, SU GERÇEKTEN AKINCA: röle açıldı (ya da röle
       okunmuyorsa çalışan sulama işi başladı). Sıraya girmek yetmiyor. */
    if (S.suAkiyor && !oncekiAkis) {
      /* Akış sesi başlıyor ve SU AKTIĞI SÜRECE sürüyor; kapanınca
         susuyor. Kısa örnekleri arka arkaya patlatmak su gibi değil,
         tekrarlayan bir hışırtı gibi duyuluyordu. */
      Ses.akisBasla();
      balon(yer.x, yer.y, kay.kanit === "röle" ? "+ su veriliyor"
        : "+ su veriliyor (işten)", "#9ed6fa");
    } else if (!S.suAkiyor && oncekiAkis) {
      Ses.akisDur();
    }
    if (!S.damla) S.damla = [];
    if (S.suAkiyor) {
      /* Islaklık hafızası: aynı yere üst üste damla yağıyor, tek leke
         büyüyor. Yeni yere geçince yeni leke açılıyor. */
      var son = S.islak.length ? S.islak[S.islak.length - 1] : null;
      if (son && Math.hypot(son.x - yer.x, son.y - yer.y) < 45) {
        son.t = S.t; son.guc = kis(son.guc + dt * 0.55, 0, 1);
        son.r = Math.min(son.r + dt * 13, NEM_YARICAP_MM * 0.7);
      } else {
        S.islak.push({ x: yer.x, y: yer.y, t0: S.t, t: S.t, r: 34, guc: 0.3 });
        if (S.islak.length > 24) S.islak.shift();
      }
      /* Sakin modda damla yok: ıslaklık kalıyor, kıpırtı gidiyor. */
      var adetSakin = S.sakin ? 0 : 1;
      /* Damlalar ÜSTTEN görünüyor: uçtan dışa doğru saçılıyorlar, aşağı
         düşmüyorlar. Bu sahne kuşbakışı; yana düşen damla yalan olurdu. */
      var adet = adetSakin * Math.min(7, Math.round(dt * 34) + (Math.random() < 0.5 ? 1 : 0));
      for (var i = 0; i < adet; i++) {
        var aci = Math.random() * 6.283, hiz = 52 + Math.random() * 90;
        /* Damlalar arabanın gövdesinin DIŞINDA başlıyor: kutunun altında
           doğan damla görünmüyor, su akmıyor sanılıyordu. */
        var r0 = 15 + Math.random() * 12;
        S.damla.push({ x: px(yer.x) + Math.cos(aci) * r0,
                       y: py(yer.y) + Math.sin(aci) * r0 * 0.6,
                       vx: Math.cos(aci) * hiz, vy: Math.sin(aci) * hiz * 0.6,
                       t: 0, sure: 0.3 + Math.random() * 0.25 });
      }
    }
    for (var j = S.damla.length - 1; j >= 0; j--) {
      var d = S.damla[j];
      d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt;
      d.vx *= (1 - kis(dt * 3.4, 0, 1)); d.vy *= (1 - kis(dt * 3.4, 0, 1));
      if (d.t > d.sure) S.damla.splice(j, 1);
    }
    for (var k2 = S.islak.length - 1; k2 >= 0; k2--) {
      if (S.t - S.islak[k2].t > ISLAK_SN) S.islak.splice(k2, 1);
    }
  }
  function islakCiz(c) {
    if (!S.islak.length) return;
    c.save();
    c.beginPath(); c.rect(G.ox, G.oy, G.bw, G.bh); c.clip();
    S.islak.forEach(function (o) {
      var yas = kis(1 - (S.t - o.t) / ISLAK_SN, 0, 1);
      var a = 0.55 * o.guc * yas;
      if (a <= 0.004) return;
      var gx = px(o.x), gy = py(o.y), R = rp(o.r);
      var g = c.createRadialGradient(gx, gy, R * 0.15, gx, gy, R);
      g.addColorStop(0, "rgba(40,28,15," + a.toFixed(3) + ")");
      g.addColorStop(0.7, "rgba(44,32,18," + (a * 0.55).toFixed(3) + ")");
      g.addColorStop(1, "rgba(44,32,18,0)");
      c.fillStyle = g;
      c.beginPath(); c.arc(gx, gy, R, 0, 6.3); c.fill();
      /* TAZE su ile ÖLÇÜLEN nem birbirine karışmasın: yeni sulanan yerin
         kenarında serin bir parıltı var, ölçüm lekesinde yok. Parıltı ilk
         yarım dakikada sönüyor, ıslaklık kalıyor. */
      var taze = kis(1 - (S.t - o.t0) / 30, 0, 1);
      if (taze > 0.02 && !S.sakin) {
        c.strokeStyle = "rgba(196,226,246," + (0.3 * taze * o.guc).toFixed(3) + ")";
        c.lineWidth = 1.6;
        c.beginPath(); c.ellipse(gx, gy, R * 0.66, R * 0.66 * 0.62, 0, 0, 6.3); c.stroke();
        c.fillStyle = "rgba(206,234,250," + (0.10 * taze * o.guc).toFixed(3) + ")";
        c.beginPath(); c.ellipse(gx, gy, R * 0.55, R * 0.55 * 0.62, 0, 0, 6.3); c.fill();
      }
    });
    c.restore();
  }
  function suCiz(c) {
    if (!S.damla || !S.damla.length) return;
    c.save();
    S.damla.forEach(function (d) {
      var p = d.t / d.sure;
      c.globalAlpha = kis(1 - p, 0, 1);
      c.fillStyle = "rgba(186,228,250,.95)";
      c.beginPath(); c.ellipse(d.x, d.y, 1.9, 1.4, 0, 0, 6.3); c.fill();
      c.globalAlpha = kis(0.5 - p * 0.5, 0, 1);
      c.strokeStyle = "rgba(210,240,255,.8)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(d.x, d.y);
      c.lineTo(d.x - d.vx * 0.02, d.y - d.vy * 0.02); c.stroke();
    });
    /* Sıçrama: damlanın düştüğü yerde küçük halka. */
    c.globalAlpha = 1;
    var m = S.robot || S.makine;
    if (S.suAkiyor) {
      var sx = px(m.x), sy = py(m.y);
      /* Ucun altında sürekli beslenen ıslak göbek: üstten bakınca suyun
         kendisi bu, huzme değil. */
      var gg = c.createRadialGradient(sx, sy, 12, sx, sy, 46);
      gg.addColorStop(0, "rgba(196,232,252,.34)");
      gg.addColorStop(0.55, "rgba(160,212,242,.16)");
      gg.addColorStop(1, "rgba(160,212,242,0)");
      c.fillStyle = gg;
      c.beginPath(); c.ellipse(sx, sy, 46, 46 * 0.62, 0, 0, 6.3); c.fill();
      /* Yayılan iki halka: suyun toprağa vurup dışa gitmesi. Arabanın
         gövdesinden geniş başlıyorlar, yoksa kutunun altında kalıyorlar. */
      [0, 0.5].forEach(function (kay2, i3) {
        var f = (S.t * 1.5 + kay2) % 1;
        var R2 = 16 + f * 54;
        c.strokeStyle = "rgba(180,224,250," + ((i3 ? 0.34 : 0.5) * (1 - f)).toFixed(3) + ")";
        c.lineWidth = 1.8;
        c.beginPath(); c.ellipse(sx, sy, R2, R2 * 0.5, 0, 0, 6.3); c.stroke();
      });
      if (S.suKanit === "iş") {
        c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
        c.fillStyle = "rgba(176,220,248,.9)";
        c.fillText("röle okunmuyor · çalışan işten", sx, sy + 34);
      }
    }
    c.restore();
  }
  /** Su akıyor ama ucun konumu bildirilmiyorsa hiçbir yere damla
   *  çizmiyoruz — ve bunu SÖYLÜYORUZ. Sessizce kuru bir bahçe göstermek
   *  yalan olurdu. */
  function suNedenYok(c) {
    var kay = suKaynak();
    if (!kay.akiyor || S.suAkiyor) return;
    c.save();
    c.font = "600 11px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = "#8fd0ff";
    c.fillText("su akıyor — ucun konumu bildirilmedi, nereye döküldüğü çizilemiyor",
      G.ox + G.bw / 2, G.oy + G.bh + 18);
    c.restore();
  }

  /* ==================================================================== *
   * YAN RAYLAR — SOLDA ALETLER, SAĞDA SEPET
   *
   * Sol ray MAKİNENİN yapacağı işler: aleti tut, bitkinin üstüne bırak,
   * iş kuyruğa girsin. Makine kopukken kilitli ve sebebi yazıyor — çünkü
   * o işleri yapan makine.
   * Sağdaki sepet KAYIT işi: hasat makinenin işi değil, toplayan insan;
   * bitkiyi sepete bırakmak yataktan düşürüyor. Bitkiyi yatağın içinde
   * başka bir yere bırakmak da kayıt: `/api/bahce/tasi`.
   * ==================================================================== */
  var RAY_ALET = [
    { k: "sula", ad: "Su", renk: "#5aa6e8", ipucu: "bitkiye bırak · sula" },
    { k: "nem", ad: "Nem", renk: "#63c46b", ipucu: "bitkiye bırak · nem ölç" },
    { k: "foto", ad: "Kamera", renk: "#c8ccc4", ipucu: "bitkiye bırak · fotoğraf" },
    { k: "yakin", ad: "Yakın", renk: "#d9b26a", ipucu: "bitkiye bırak · uç kamerası" }
  ];
  function rayKur() {
    var gen = 50, ara = 16;
    var top = RAY_ALET.length * gen + (RAY_ALET.length - 1) * ara;
    var y0 = Math.max(12, (S.boy - top) / 2);
    var solBos = G.ox - G.kal - G.ray - 12;
    var x = solBos > gen + 16 ? (solBos - gen) / 2 : 8;
    S.ray = RAY_ALET.map(function (a, i) {
      return { k: a.k, ad: a.ad, renk: a.renk, ipucu: a.ipucu,
               x: x, y: y0 + i * (gen + ara), w: gen, h: gen };
    });
    var son2 = S.ray[S.ray.length - 1];
    S.sesDugme = { x: x + gen / 2 - 15, y: son2.y + son2.h + 30, r: 15 };
    var sagBos = S.en - (G.ox + G.bw + G.kal + G.ray + 12);
    var sgen = 58;
    var sx = sagBos > sgen + 16 ? S.en - sagBos / 2 - sgen / 2 : S.en - sgen - 10;
    S.sepet = { x: sx, y: Math.max(16, S.boy / 2 - 32), w: sgen, h: 64 };
  }
  function aletSimge(c, k, cx, cy, renk, sol) {
    c.save();
    c.strokeStyle = renk; c.fillStyle = renk;
    c.lineWidth = 2; c.lineCap = "round"; c.lineJoin = "round";
    if (k === "sula") {                       /* musluk */
      c.beginPath(); c.moveTo(cx - 9, cy - 8); c.lineTo(cx - 2, cy - 8);
      c.lineTo(cx - 2, cy + 1); c.lineTo(cx + 6, cy + 1); c.stroke();
      c.beginPath(); c.arc(cx - 5, cy - 12, 3.4, 0, 6.3); c.stroke();
      c.beginPath(); c.moveTo(cx + 6, cy + 1); c.lineTo(cx + 6, cy + 4); c.stroke();
      c.beginPath(); c.moveTo(cx + 6, cy + 7); c.lineTo(cx + 6, cy + 11); c.stroke();
      c.beginPath(); c.arc(cx + 6, cy + 14, 1.6, 0, 6.3); c.fill();
    } else if (k === "nem") {                 /* prob — iki çatal uç */
      c.beginPath(); c.moveTo(cx - 5, cy - 11); c.lineTo(cx - 5, cy + 8); c.stroke();
      c.beginPath(); c.moveTo(cx + 5, cy - 11); c.lineTo(cx + 5, cy + 8); c.stroke();
      c.beginPath(); c.moveTo(cx - 9, cy - 11); c.lineTo(cx + 9, cy - 11); c.stroke();
      c.beginPath(); c.moveTo(cx - 5, cy + 8); c.lineTo(cx - 5, cy + 13);
      c.moveTo(cx + 5, cy + 8); c.lineTo(cx + 5, cy + 13); c.stroke();
    } else if (k === "foto") {                /* kamera */
      c.beginPath();
      if (c.roundRect) c.roundRect(cx - 11, cy - 7, 22, 16, 3); else c.rect(cx - 11, cy - 7, 22, 16);
      c.stroke();
      c.beginPath(); c.arc(cx, cy + 1, 4.6, 0, 6.3); c.stroke();
      c.beginPath(); c.moveTo(cx - 4, cy - 7); c.lineTo(cx - 2, cy - 11);
      c.lineTo(cx + 2, cy - 11); c.lineTo(cx + 4, cy - 7); c.stroke();
    } else if (k === "yakin") {               /* büyüteç */
      c.beginPath(); c.arc(cx - 2, cy - 2, 7.5, 0, 6.3); c.stroke();
      c.beginPath(); c.moveTo(cx + 4, cy + 4); c.lineTo(cx + 10, cy + 10); c.stroke();
    } else if (k === "sepet") {               /* sepet */
      c.beginPath(); c.moveTo(cx - 11, cy - 4); c.lineTo(cx + 11, cy - 4);
      c.lineTo(cx + 7, cy + 10); c.lineTo(cx - 7, cy + 10); c.closePath(); c.stroke();
      c.beginPath(); c.moveTo(cx - 7, cy - 4); c.lineTo(cx - 4, cy + 10);
      c.moveTo(cx + 7, cy - 4); c.lineTo(cx + 4, cy + 10);
      c.moveTo(cx, cy - 4); c.lineTo(cx, cy + 10); c.stroke();
      c.beginPath(); c.arc(cx, cy - 4, 8, Math.PI, 0); c.stroke();
    }
    c.restore();
    if (sol === false) return;
  }
  /** Altıgen etiketin yolu — düğmeler yuvarlak kutu değil, çivili askıya
   *  asılmış ALET ETİKETLERİ. Yuvarlak köşeli kutu her arayüzde var;
   *  bahçe aletinin yerinde durmuyordu. */
  function etiketYol(c, x, y, w, h) {
    var k = Math.min(w, h) * 0.26;
    c.beginPath();
    c.moveTo(x + k, y);
    c.lineTo(x + w - k, y);
    c.lineTo(x + w, y + h / 2);
    c.lineTo(x + w - k, y + h);
    c.lineTo(x + k, y + h);
    c.lineTo(x, y + h / 2);
    c.closePath();
  }
  /** Askı tahtası: aletlerin arkasında duran, çimin üstüne çakılmış
   *  tahta. Aletler ondan sarkıyor; boş kanca elinde alet olduğunu
   *  gösteriyor. */
  function askiCiz(c) {
    if (!S.ray.length) return;
    var ilk = S.ray[0], son = S.ray[S.ray.length - 1];
    var x = ilk.x - 9, y = ilk.y - 26, w = ilk.w + 18;
    var h = (son.y + son.h) - ilk.y + 40;
    c.save();
    c.fillStyle = "rgba(0,0,0,.3)";
    c.beginPath();
    if (c.roundRect) c.roundRect(x + 3, y + 5, w, h, 6); else c.rect(x + 3, y + 5, w, h);
    c.fill();
    var g = c.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, "#6b4a2c"); g.addColorStop(0.35, "#8a6238");
    g.addColorStop(0.75, "#754f2d"); g.addColorStop(1, "#5c3f25");
    c.fillStyle = g;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, 6); else c.rect(x, y, w, h);
    c.fill();
    /* Tahta damarı: iki ince çizgi, ötesi gürültü. */
    c.strokeStyle = "rgba(48,30,14,.28)"; c.lineWidth = 1;
    var i;
    for (i = 1; i < 4; i++) {
      var lx = x + (w / 4) * i;
      c.beginPath(); c.moveTo(lx, y + 6); c.lineTo(lx, y + h - 6); c.stroke();
    }
    c.strokeStyle = "rgba(30,18,8,.5)"; c.lineWidth = 1.2;
    c.beginPath();
    if (c.roundRect) c.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 6);
    else c.rect(x + 0.5, y + 0.5, w - 1, h - 1);
    c.stroke();
    /* Dört vida */
    [[x + 8, y + 8], [x + w - 8, y + 8], [x + 8, y + h - 8], [x + w - 8, y + h - 8]]
      .forEach(function (v) {
        c.fillStyle = "rgba(214,208,192,.8)";
        c.beginPath(); c.arc(v[0], v[1], 2.6, 0, 6.3); c.fill();
        c.strokeStyle = "rgba(40,30,16,.7)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(v[0] - 1.8, v[1]); c.lineTo(v[0] + 1.8, v[1]); c.stroke();
      });
    c.restore();
  }
  function rayCiz(c) {
    var bagli = !!(S.veri && S.veri.bagli);
    var tut = S.tasima && S.tasima.tip === "alet" ? S.tasima.k : "";
    askiCiz(c);
    S.ray.forEach(function (a) {
      var acik = bagli;
      var elde = tut === a.k;
      /* Kanca: etiketin üstünde küçük bir çengel. Alet elindeyken kanca
         boş kalıyor — nerede olduğunu ekran söylüyor. */
      var kx = a.x + a.w / 2, ky = a.y - 9;
      c.save();
      c.strokeStyle = "#cfd5d8"; c.lineWidth = 2; c.lineCap = "round";
      c.beginPath(); c.arc(kx, ky, 4.2, Math.PI * 0.15, Math.PI * 0.95, true); c.stroke();
      c.restore();
      if (elde) return;                       /* etiket elde: kanca boş */
      c.save();
      c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 6; c.shadowOffsetY = 3;
      var yg = c.createLinearGradient(a.x, a.y, a.x, a.y + a.h);
      yg.addColorStop(0, acik ? "rgba(38,44,36,.97)" : "rgba(30,32,29,.9)");
      yg.addColorStop(1, acik ? "rgba(22,27,21,.97)" : "rgba(20,22,20,.9)");
      c.fillStyle = yg;
      etiketYol(c, a.x, a.y, a.w, a.h);
      c.fill();
      c.restore();
      /* İp: kancadan etikete. */
      c.strokeStyle = "rgba(226,214,180,.75)"; c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(kx - 3, ky + 2); c.lineTo(a.x + a.w / 2, a.y + 2);
      c.moveTo(kx + 3, ky + 2); c.lineTo(a.x + a.w / 2, a.y + 2); c.stroke();
      c.strokeStyle = acik ? a.renk : "#4a4d47";
      c.lineWidth = 1.4;
      etiketYol(c, a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);
      c.stroke();
      aletSimge(c, a.k, a.x + a.w / 2, a.y + a.h / 2 - 4, acik ? a.renk : "#5c605a");
      c.font = "600 9px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = acik ? "rgba(230,236,226,.9)" : "#6b6f68";
      c.fillText(a.ad, a.x + a.w / 2, a.y + a.h - 7);
    });
    if (!bagli && S.ray.length) {
      var s0 = S.ray[0];
      c.save();
      c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = "#e07f6a";
      c.fillText("aletler kilitli", s0.x + s0.w / 2, s0.y - 32);
      c.fillText("makine bağlı değil", s0.x + s0.w / 2, s0.y - 44);
      c.restore();
    }
    sepetCiz(c);
    sesCiz(c);
  }
  /** Ses açma/kapama — tarayıcı ilk dokunuşa kadar ses çaldırmıyor,
   *  bu düğme hem izni açıyor hem tercihi (localStorage) tutuyor. */
  function sesCiz(c) {
    var d = S.sesDugme;
    if (!d) return;
    var acik = Ses.acikMi();
    c.save();
    c.fillStyle = "rgba(20,24,19,.8)";
    c.beginPath(); c.arc(d.x + 15, d.y + 15, d.r, 0, 6.3); c.fill();
    c.strokeStyle = acik ? "#7bbf5a" : "#6b6f68"; c.lineWidth = 1.3;
    c.beginPath(); c.arc(d.x + 15, d.y + 15, d.r, 0, 6.3); c.stroke();
    var cx = d.x + 12, cy = d.y + 15;
    c.fillStyle = acik ? "#cfe8c2" : "#6b6f68";
    c.beginPath();
    c.moveTo(cx - 5, cy - 3); c.lineTo(cx - 1, cy - 3); c.lineTo(cx + 3, cy - 7);
    c.lineTo(cx + 3, cy + 7); c.lineTo(cx - 1, cy + 3); c.lineTo(cx - 5, cy + 3);
    c.closePath(); c.fill();
    c.strokeStyle = acik ? "#cfe8c2" : "#6b6f68"; c.lineWidth = 1.4;
    if (acik) {
      c.beginPath(); c.arc(cx + 4, cy, 5, -0.9, 0.9); c.stroke();
      c.beginPath(); c.arc(cx + 4, cy, 8, -0.8, 0.8); c.stroke();
    } else {
      c.beginPath(); c.moveTo(cx + 6, cy - 4); c.lineTo(cx + 12, cy + 4);
      c.moveTo(cx + 12, cy - 4); c.lineTo(cx + 6, cy + 4); c.stroke();
    }
    c.restore();
  }
  /** SEPET — çimin üstünde duran hasır sepet. Kutu değil: bitkiyi içine
   *  bırakıyorsun. */
  function sepetCiz(c) {
    var sp = S.sepet;
    if (!sp) return;
    var uzeri = S.tasima && S.tasima.tip === "bitki" && S.tasimaHedef === "sepet";
    var cx = sp.x + sp.w / 2, ust = sp.y + 10, alt = sp.y + sp.h - 8;
    var ru = sp.w * 0.54, ra = sp.w * 0.38;
    c.save();
    /* Çime düşen gölge */
    c.fillStyle = "rgba(0,0,0,.34)";
    c.beginPath(); c.ellipse(cx + 3, alt + 3, ru * 0.96, ru * 0.3, 0, 0, 6.3); c.fill();
    /* Gövde */
    var g = c.createLinearGradient(cx - ru, 0, cx + ru, 0);
    g.addColorStop(0, uzeri ? "#c79a4e" : "#9c7a41");
    g.addColorStop(0.45, uzeri ? "#e6bd6d" : "#b08c4c");
    g.addColorStop(1, uzeri ? "#a8803f" : "#836636");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(cx - ru, ust);
    c.lineTo(cx + ru, ust);
    c.lineTo(cx + ra, alt);
    c.quadraticCurveTo(cx, alt + ra * 0.42, cx - ra, alt);
    c.closePath(); c.fill();
    /* Hasır örgü: dikey çubuklar + iki yatay bant */
    c.strokeStyle = "rgba(60,40,16,.45)"; c.lineWidth = 1;
    var i;
    for (i = 1; i < 6; i++) {
      var t = i / 6;
      c.beginPath();
      c.moveTo(cx - ru + 2 * ru * t, ust + 2);
      c.lineTo(cx - ra + 2 * ra * t, alt - 1);
      c.stroke();
    }
    [0.34, 0.68].forEach(function (t2) {
      var yy = ust + (alt - ust) * t2, rr = ru + (ra - ru) * t2;
      c.beginPath(); c.moveTo(cx - rr, yy); c.lineTo(cx + rr, yy); c.stroke();
    });
    /* Ağız halkası */
    c.strokeStyle = uzeri ? "#f6c456" : "#c9a45c"; c.lineWidth = 2.4;
    c.beginPath(); c.ellipse(cx, ust, ru, ru * 0.3, 0, 0, 6.3); c.stroke();
    c.fillStyle = "rgba(18,14,8,.55)";
    c.beginPath(); c.ellipse(cx, ust, ru - 2, ru * 0.3 - 1.4, 0, 0, 6.3); c.fill();
    /* Kulp */
    c.strokeStyle = uzeri ? "#f6c456" : "#c9a45c"; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, ust, ru * 0.72, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    c.font = "600 9px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = uzeri ? "#f6c456" : "rgba(230,236,226,.8)";
    c.fillText("Hasat", cx, sp.y + sp.h + 12);
    c.restore();
  }

  /** Elde taşınan şey: alet ya da bitki. Parmağın altında duruyor. */
  function tasimaCiz(c) {
    var t = S.tasima;
    if (!t) return;
    c.save();
    if (t.tip === "alet") {
      var al = null;
      S.ray.forEach(function (a) { if (a.k === t.k) al = a; });
      var hedefB = S.tasimaHedef && S.tasimaHedef !== "sepet" ? S.ix[S.tasimaHedef] : null;
      if (hedefB) {
        var sp = spriteAl(hedefB);
        c.strokeStyle = al ? al.renk : "#8fd0ff"; c.lineWidth = 2.4;
        c.setLineDash([7, 5]);
        c.beginPath(); c.arc(px(hedefB.x), py(hedefB.y), sp.R + 12, 0, 6.3); c.stroke();
        c.setLineDash([]);
        /* Makine oraya gidecek: hayaleti şimdiden göster. */
        c.globalAlpha = 0.5;
        c.fillStyle = "rgba(143,208,255,.35)";
        c.fillRect(px(hedefB.x) - 15, py(hedefB.y) - 13, 30, 26);
        c.globalAlpha = 1;
      }
      c.shadowColor = "rgba(0,0,0,.5)"; c.shadowBlur = 9;
      c.fillStyle = "rgba(20,24,19,.92)";
      c.beginPath(); c.arc(t.x, t.y, 21, 0, 6.3); c.fill();
      c.shadowColor = "transparent"; c.shadowBlur = 0;
      c.strokeStyle = al ? al.renk : "#8fd0ff"; c.lineWidth = 1.8;
      c.beginPath(); c.arc(t.x, t.y, 21, 0, 6.3); c.stroke();
      aletSimge(c, t.k, t.x, t.y, al ? al.renk : "#8fd0ff");
    } else if (t.tip === "bitki") {
      var b = S.ix[t.ad];
      if (b) {
        var sp2 = spriteAl(b);
        c.globalAlpha = 0.85;
        c.drawImage(sp2.tuval, t.x - sp2.boy / 2, t.y - sp2.boy / 2, sp2.boy, sp2.boy);
        c.globalAlpha = 1;
        /* Bırakılacak yer: yatağın içindeyse hedef halkası, dışındaysa
           neden olmadığı. */
        if (S.tasimaHedef === "sepet") {
          c.font = "600 11px system-ui,sans-serif"; c.textAlign = "center";
          c.fillStyle = "#f6c456";
          c.fillText("sepete bırak · hasat", t.x, t.y - 26);
        } else if (yataktaMi(t.x, t.y)) {
          c.strokeStyle = "rgba(246,246,240,.8)"; c.lineWidth = 1.4;
          c.setLineDash([5, 4]);
          c.beginPath(); c.arc(t.x, t.y, sp2.R + 8, 0, 6.3); c.stroke();
          c.setLineDash([]);
          c.font = "600 10px ui-monospace,monospace"; c.textAlign = "center";
          c.fillStyle = "rgba(236,240,232,.9)";
          c.fillText("X " + Math.round(mmx(t.x)) + " · Y " + Math.round(mmy(t.y)),
            t.x, t.y + sp2.R + 20);
        } else {
          c.font = "600 10px system-ui,sans-serif"; c.textAlign = "center";
          c.fillStyle = "#e07f6a";
          c.fillText("yatağın dışı — taşınamaz", t.x, t.y - 26);
        }
      }
    }
    c.restore();
  }
  /** Çalışan iş ucun üstünde görünüyor: alet makineyle SENKRON. */
  function calisanAletCiz(c) {
    S.durDugme = null;
    var k = (S.veri && S.veri.kuyruk) || {};
    var ca = k.calisan;
    if (!ca) return;
    var eslek = { sula: "sula", nem: "nem", foto: "foto", gez: "yakin", ek: null }[ca.tip];
    if (!eslek) return;
    var m = S.robot || S.makine;
    if (m.x == null || !S.konumVar) return;
    var al = null;
    RAY_ALET.forEach(function (a) { if (a.k === eslek) al = a; });
    var cx = px(m.x), cy = arabaY() - 30;
    c.save();
    c.fillStyle = "rgba(20,24,19,.86)";
    c.beginPath(); c.arc(cx, cy, 15, 0, 6.3); c.fill();
    c.strokeStyle = al ? al.renk : "#8fd0ff"; c.lineWidth = 1.6;
    c.beginPath(); c.arc(cx, cy, 15, 0, 6.3); c.stroke();
    c.save(); c.translate(cx, cy); c.scale(0.72, 0.72); c.translate(-cx, -cy);
    aletSimge(c, eslek, cx, cy, al ? al.renk : "#8fd0ff");
    c.restore();
    /* DUR: çalışan/bekleyen işi iptal (`/api/bahce/is/iptal`). Kuyruktaki
       iş gerçekten iptal oluyor; ÇALIŞAN işi sunucu 409 ile geri
       çeviriyor ve o cevabı olduğu gibi yazıyoruz — makineyi durdurmak
       teknik panelin işi, burada durdurmuş gibi yapmıyoruz. */
    var dx = cx + 26, dy = cy - 2;
    c.fillStyle = "rgba(28,20,18,.9)";
    c.beginPath(); c.arc(dx, dy, 12, 0, 6.3); c.fill();
    c.strokeStyle = "#e07f6a"; c.lineWidth = 1.4;
    c.beginPath(); c.arc(dx, dy, 12, 0, 6.3); c.stroke();
    c.fillStyle = "#e07f6a";
    c.fillRect(dx - 4, dy - 4, 8, 8);
    S.durDugme = { x: dx, y: dy, r: 14, kimlik: ca.kimlik, tip: ca.tip,
                   etiket: ca.etiket || ca.tip };
    c.restore();
  }
  /** Kuyruktaki işi iptal et. */
  var isIptal = guvenli("iptal", function (kimlik, etiket) {
    onayAc((etiket || "İş") + " iptal edilecek.",
      "Kuyruktan düşer. Makine o işi çalıştırmaya başladıysa sunucu iptali "
      + "kabul etmez ve sebebini yazar.", "İptal et",
      function () {
        iptalEdilen[String(kimlik)] = true;
        gonder("/api/bahce/is/iptal", { kimlik: String(kimlik) })
          .then(function () {
            gunluk("bahçe: iş iptal · " + kimlik);
            mesajYaz("İş kuyruktan düştü.");
            notYaz("iptal", "");
            return veriYukle();
          })
          .catch(function (h) {
            notYaz("iptal", "İptal olmadı — " + ((h && h.message) || h));
            isteKare();
          });
      });
  });

  /* ==================================================================== *
   * BİTKİ KARTI — DOKUNUNCA AÇILAN KÜNYE
   *
   * Bitkiye dokunmak eylem halkasını açıyor; halkanın yanında bu kart
   * duruyor. İçindeki her satır GERÇEK BİR ALANDAN geliyor:
   *   nem            → `su_olcum` (ölçüm varsa yüzde + yaşı + kanıtı;
   *                    yoksa "ölçülmedi", tahmin edilmiş sayı yazılmıyor)
   *   son sulama     → `sulama_ts` (yoksa "kayıt yok")
   *   dikim          → `ekim` + `yas_gun` / `olgun_gun`
   *   susama         → `susadi` + `su_gerekce` + `su_kanit`
   *   hasat          → `hasat` + `hasat_gerekce`
   *   boy            → `yaricap_mm`, `yayilim_mm`, `cakisik`
   *   sayaçlar       → `/api/bitki` (`sula_adet`, `nem_adet`, eğilim)
   *   eşik           → `su_olcum.esik` (tür ayarı; buradan DEĞİŞTİRİLMİYOR)
   * Gelmeyen alan için satır açılmıyor; "—" ile boş satır göstermek,
   * bilinmeyeni bilinmiş gibi hizalamak olurdu.
   * ==================================================================== */
  function kartSatirlari(b) {
    var r = [], n = nemDurum(b), simdi = Date.now() / 1000;
    /* NEM — kartın en üst satırı, çünkü bahçenin asıl sorusu bu. */
    if (n.var && n.yuzde != null) {
      var kanit = n.kendi ? "kendi ölçümü" : "komşu ölçümü (" + Math.round(n.uzak) + " mm)";
      r.push({ ad: "Toprak nemi", deger: "%" + Math.round(n.yuzde),
               alt: kanit + " · " + sureKisa(n.yas) + " önce" + (n.bayat ? " · bayat" : ""),
               renk: n.bayat ? "#e8c07a" : (n.kendi ? "#9fe08a" : "#e8c07a") });
    } else {
      r.push({ ad: "Toprak nemi", deger: "ölçülmedi",
               alt: "prob bu bitkinin toprağına hiç batmadı", renk: "#a9ada4" });
    }
    if (n.esik > 0) {
      r.push({ ad: "Sulama eşiği", deger: "%" + Math.round(n.esik),
               alt: n.esikAcik ? "türün ayarı · bu yüzdenin altı susamış sayılıyor"
                               : "kapalı", renk: "#c9cec4" });
    }
    /* SON SULAMA */
    var st = sayi(b.sulama_ts, 0);
    r.push({ ad: "Son sulama",
             deger: st ? sureKisa(simdi - st) + " önce" : "kayıt yok",
             alt: st ? tarih(st) + " · " + sayi(b.sulama_saniye, 0).toFixed(1)
                       + " sn ayarlı (" + (b.sulama_deseni || "üst") + ")"
                     : "bu bitki bu panelden hiç sulanmadı",
             renk: st ? "#9ed6fa" : "#a9ada4" });
    /* DİKİM VE YAŞ */
    var ek = sayi(b.ekim, 0), yas = sayi(b.yas_gun, 0), olgun = sayi(b.olgun_gun, 0);
    if (ek || yas) {
      r.push({ ad: "Dikim", deger: ek ? tarih(ek) : (yas + " gün önce"),
               alt: yas + " günlük" + (olgun ? " · olgunluk " + olgun + " gün" : "")
                 + (olgun ? " · %" + Math.round(kis(yas / olgun, 0, 1) * 100) : ""),
               renk: "#e8ece2" });
    }
    /* SUSAMA KARARI — sunucunun kararı ve GEREKÇESİ */
    if (b.susadi) {
      r.push({ ad: "Susadı", deger: b.su_kanit === "olculen" ? "ölçüme göre" : "tahmine göre",
               alt: String(b.su_gerekce || ""), renk: "#e8a86a" });
    }
    if (b.hasat) {
      r.push({ ad: "Hasat", deger: "hazır", alt: String(b.hasat_gerekce || ""),
               renk: "#f6c456" });
    }
    /* BOY */
    var yc = sayi(b.yaricap_mm, 0), yy = sayi(b.yayilim_mm, 0);
    if (yc || yy) {
      r.push({ ad: "Boy", deger: yc ? Math.round(yc * 2) + " mm çap" : "ölçülmedi",
               alt: (yy ? "türün yayılımı " + Math.round(yy) + " mm" : "")
                 + (b.cakisik ? " · komşuyla çakışıyor" : ""),
               renk: b.cakisik ? "#e8a86a" : "#c9cec4" });
    }
    /* SAYAÇLAR — /api/bitki */
    if (S.gecmis && S.gecmisAd === b.ad
      && (sayi(S.gecmis.sula, 0) || sayi(S.gecmis.olcum, 0) || sayi(S.gecmis.adet, 0))) {
      var g = S.gecmis;
      var egilim = g.egilim
        ? ("nem %" + Math.round(g.egilim.ilk) + " → %" + Math.round(g.egilim.son))
        : (g.adet ? g.adet + " okuma" : "yakında okuma yok");
      r.push({ ad: "Geçmiş",
               deger: sayi(g.sula, 0) + " sulama · " + sayi(g.olcum, 0) + " ölçüm",
               alt: egilim + (g.sulaToplam ? " · toplam " + Math.round(g.sulaToplam) + " sn su" : ""),
               renk: "#c9cec4" });
    }
    if (sayi(b.film_kare, 0)) {
      r.push({ ad: "Film", deger: sayi(b.film_kare, 0) + " kare",
               alt: "halkadaki Film düğmesi açıyor", renk: "#d9b26a" });
    }
    return r;
  }
  function kartCiz(c) {
    if (!S.secili || S.ekimNokta || S.film) return;
    var b = S.ix[S.secili];
    if (!b) return;
    var satir = kartSatirlari(b);
    var w = 246, ust = 46, satirY = 34;
    var h = ust + satir.length * satirY + 12;
    /* Kart bitkinin YANINDA duruyor, üstünde değil: eylem halkası orada.
       Hangi yanda yer varsa o yana açılıyor, ekrandan taşmıyor. */
    var sp = spriteAl(b), gx = px(b.x), gy = py(b.y);
    var R = Math.max(66, sp.R + 40);
    var x = gx + R + 16;
    if (x + w > S.en - 8) x = gx - R - 16 - w;
    x = kis(x, 8, Math.max(8, S.en - w - 8));
    var y = kis(gy - h / 2, 8, Math.max(8, S.boy - h - 8));
    S.kartKutu = { x: x, y: y, w: w, h: h };
    c.save();
    c.fillStyle = "rgba(0,0,0,.4)";
    c.beginPath();
    if (c.roundRect) c.roundRect(x + 3, y + 5, w, h, 14); else c.rect(x + 3, y + 5, w, h);
    c.fill();
    var g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "rgba(31,36,30,.97)"); g.addColorStop(1, "rgba(22,26,21,.97)");
    c.fillStyle = g;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, 14); else c.rect(x, y, w, h);
    c.fill();
    c.strokeStyle = "rgba(140,152,134,.5)"; c.lineWidth = 1.2; c.stroke();
    /* Bitkiye bağlayan ince çizgi: kartın kime ait olduğu belli olsun. */
    c.strokeStyle = "rgba(140,152,134,.45)"; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x < gx ? x + w : x, y + h / 2);
    c.lineTo(gx + (x < gx ? -1 : 1) * (R + 2), gy);
    c.stroke();

    c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.font = "700 14px system-ui,sans-serif";
    c.fillStyle = "#eef2e8";
    var ad = String(b.tur_ad || b.ad);
    c.fillText(ad.length > 22 ? ad.slice(0, 21) + "…" : ad, x + 14, y + 24);
    c.font = "10px ui-monospace,monospace";
    c.fillStyle = "rgba(201,206,196,.65)";
    c.fillText(b.ad + "  ·  X " + Math.round(sayi(b.x)) + "  Y " + Math.round(sayi(b.y)),
      x + 14, y + 38);

    var yy2 = y + ust + 12;
    satir.forEach(function (r, i) {
      if (i) {
        c.strokeStyle = "rgba(255,255,255,.06)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x + 12, yy2 - 22); c.lineTo(x + w - 12, yy2 - 22); c.stroke();
      }
      c.font = "10px system-ui,sans-serif";
      c.fillStyle = "rgba(201,206,196,.7)";
      c.fillText(r.ad, x + 14, yy2 - 8);
      c.font = "600 12px system-ui,sans-serif";
      c.fillStyle = r.renk || "#e8ece2";
      c.textAlign = "right";
      c.fillText(r.deger, x + w - 14, yy2 - 8);
      c.textAlign = "left";
      if (r.alt) {
        c.font = "10px system-ui,sans-serif";
        c.fillStyle = "rgba(180,186,176,.8)";
        var alt = r.alt.length > 42 ? r.alt.slice(0, 41) + "…" : r.alt;
        c.fillText(alt, x + 14, yy2 + 6);
      }
      yy2 += satirY;
    });
    c.restore();
  }

  /* ==================================================================== *
   * FİLM — BÜYÜME ARŞİVİ (`/api/bahce/film`)
   *
   * Kareler sunucuda zaten var: `/api/bahce` her bitkiyle birlikte
   * `film_kimlik` ve `film_kare` veriyor, kareler `/api/bahce/film`den,
   * görüntüler `/api/bahce/film/kare`den geliyor. Ekran yalnız gösteriyor;
   * yeni kare çekmek "Çek" işi, o ayrı.
   * ==================================================================== */
  function jeton() {
    var p = P();
    return (p && p.S && p.S.jeton) ? String(p.S.jeton) : "";
  }
  var filmAc = guvenli("film", function (b) {
    var kimlik = String(b.film_kimlik || "");
    if (!kimlik || !sayi(b.film_kare, 0)) {
      mesajYaz("Bu ekimin arşivinde kare yok — ilk kareyi 'Çek' ile alabilirsin.");
      altYaz(); return;
    }
    S.film = { ad: b.ad, tur: b.tur_ad || b.ad, kimlik: kimlik, kareler: [],
               ix: 0, img: null, hata: "", yukleniyor: true };
    isteKare();
    api("/api/bahce/film?kimlik=" + encodeURIComponent(kimlik))
      .then(function (c) {
        if (!S.film || S.film.kimlik !== kimlik) return;
        S.film.kareler = (c && c.kareler) || [];
        S.film.yukleniyor = false;
        S.film.ix = Math.max(0, S.film.kareler.length - 1);
        if (!S.film.kareler.length) S.film.hata = "Arşivde kare yok.";
        filmKareYukle();
      })
      .catch(function (h) {
        if (!S.film) return;
        S.film.yukleniyor = false;
        S.film.hata = "Film okunamadı — " + ((h && h.kod ? h.kod + ": " : "")
          + ((h && h.message) || "sebep bilinmiyor"));
        isteKare();
      });
  });
  function filmKareYukle() {
    var f = S.film;
    if (!f || !f.kareler.length) { isteKare(); return; }
    var k = f.kareler[kis(f.ix, 0, f.kareler.length - 1)];
    if (!k) return;
    var jt = jeton();
    if (!jt) { f.hata = "Jeton yok — kare istenemiyor."; isteKare(); return; }
    var im = new Image();
    im.onload = function () { if (S.film === f) { f.img = im; f.hata = ""; isteKare(); } };
    im.onerror = function () { if (S.film === f) { f.img = null; f.hata = "Kare okunamadı."; isteKare(); } };
    im.src = "/api/bahce/film/kare?kimlik=" + encodeURIComponent(f.kimlik)
      + "&damga=" + encodeURIComponent(k.damga) + "&jeton=" + encodeURIComponent(jt);
    f.bekleyen = k.damga;
  }
  function filmKapat() { S.film = null; altYaz(); isteKare(); }
  function filmCiz(c) {
    var f = S.film;
    if (!f) return;
    var w = Math.min(S.en - 40, 520), h = Math.min(S.boy - 40, 420);
    var x = (S.en - w) / 2, y = (S.boy - h) / 2;
    f.kutu = { x: x, y: y, w: w, h: h };
    c.save();
    c.fillStyle = "rgba(8,10,7,.72)";
    c.fillRect(0, 0, S.en, S.boy);
    c.fillStyle = "rgba(18,21,16,.98)";
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, 14); else c.rect(x, y, w, h);
    c.fill();
    c.strokeStyle = "#5f6a58"; c.lineWidth = 1.2; c.stroke();
    c.font = "600 13px system-ui,sans-serif"; c.textAlign = "left";
    c.fillStyle = "#e6ebe0";
    c.fillText(f.tur + " · büyüme filmi", x + 16, y + 24);
    /* Kapat */
    f.kapat = { x: x + w - 22, y: y + 18, r: 15 };
    c.strokeStyle = "#c9cec4"; c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(f.kapat.x - 6, f.kapat.y - 6); c.lineTo(f.kapat.x + 6, f.kapat.y + 6);
    c.moveTo(f.kapat.x + 6, f.kapat.y - 6); c.lineTo(f.kapat.x - 6, f.kapat.y + 6);
    c.stroke();
    var ix = y + 38, iy = h - 92;
    if (f.img) {
      var o = Math.min((w - 32) / f.img.width, iy / f.img.height);
      var iw = f.img.width * o, ih = f.img.height * o;
      c.drawImage(f.img, x + (w - iw) / 2, ix + (iy - ih) / 2, iw, ih);
    } else {
      c.font = "12px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = f.hata ? "#e07f6a" : "#9aa094";
      c.fillText(f.hata || (f.yukleniyor ? "film okunuyor…" : "kare bekleniyor…"),
        x + w / 2, ix + iy / 2);
    }
    /* Şerit: her kare bir çentik, seçili olan dolu. */
    var sy = y + h - 44, sx1 = x + 20, sx2 = x + w - 20;
    f.serit = { x1: sx1, x2: sx2, y: sy, adet: f.kareler.length };
    c.strokeStyle = "rgba(200,206,196,.35)"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(sx1, sy); c.lineTo(sx2, sy); c.stroke();
    if (f.kareler.length) {
      var i, n = f.kareler.length;
      for (i = 0; i < n; i++) {
        var kx = n === 1 ? sx1 : sx1 + (i / (n - 1)) * (sx2 - sx1);
        c.fillStyle = i === f.ix ? "#d9b26a" : "rgba(200,206,196,.5)";
        c.beginPath(); c.arc(kx, sy, i === f.ix ? 5 : 2.4, 0, 6.3); c.fill();
      }
      var kk = f.kareler[kis(f.ix, 0, n - 1)];
      c.font = "11px ui-monospace,monospace"; c.textAlign = "center";
      c.fillStyle = "#c9cec4";
      c.fillText((f.ix + 1) + " / " + n + "  ·  " + tarih(kk.ts), x + w / 2, y + h - 18);
    }
    c.restore();
  }
  function filmDokun(p) {
    var f = S.film;
    if (!f || !f.kutu) return false;
    if (f.kapat && Math.hypot(f.kapat.x - p.x, f.kapat.y - p.y) < f.kapat.r) {
      filmKapat(); return true;
    }
    if (p.x < f.kutu.x || p.x > f.kutu.x + f.kutu.w
      || p.y < f.kutu.y || p.y > f.kutu.y + f.kutu.h) { filmKapat(); return true; }
    if (f.serit && f.kareler.length && Math.abs(p.y - f.serit.y) < 26) {
      filmSec(p.x); bas = { tip: "film", x: p.x, y: p.y, surukle: true };
      return true;
    }
    return true;                                  /* kutunun içi — geçirmiyoruz */
  }
  function filmSec(sx) {
    var f = S.film;
    if (!f || !f.kareler.length) return;
    var t = kis((sx - f.serit.x1) / Math.max(1, f.serit.x2 - f.serit.x1), 0, 1);
    var yeni = Math.round(t * (f.kareler.length - 1));
    if (yeni !== f.ix) { f.ix = yeni; filmKareYukle(); }
    isteKare();
  }

  /* ==================================================================== *
   * ETKİLEŞİM — altı ayrı hareket, hepsi yerin kendisinde.
   *   dokun (uç)      → alet halkası
   *   dokun (bitki)   → eylem halkası
   *   sürükle (kiriş) → makinenin hayaleti; gerçeği onaydan sonra gider
   *   basılı tut      → sulama süresini sen belirliyorsun
   *   uzun bas        → o noktada tohum tepsisi
   *   bekle           → bahçe yaşıyor
   * ==================================================================== */
  function konum(e) {
    var r = S.tuval.getBoundingClientRect();
    return { x: (e.clientX - r.left) * S.en / r.width,
             y: (e.clientY - r.top) * S.boy / r.height };
  }
  function halkadaMi(liste, p) {
    for (var i = 0; i < liste.length; i++) {
      var a = liste[i];
      if (a._x != null && Math.hypot(a._x - p.x, a._y - p.y) < (a._r || 20) + 3) return a;
    }
    return null;
  }
  function bitkiBul(p) {
    var en = null, ed = 1e9;
    S.bitki.forEach(function (b) {
      var sp = spriteAl(b);
      var d = Math.hypot(px(b.x) - p.x, py(b.y) - p.y);
      var r = Math.max(18, sp.R);
      if (d < r && d < ed) { ed = d; en = b; }
    });
    return en;
  }
  function arabaY() {
    var m = S.robot || S.makine;
    return py(m.y);
  }

  var bas = null, uzunSayac = 0;
  var tuvalBasti = guvenli("dokunma", function (e) {
    e.preventDefault();
    if (S.tuval.setPointerCapture) { try { S.tuval.setPointerCapture(e.pointerId); } catch (h) {} }
    var p = konum(e);
    if (!S.insaBitti) { insaAtla(); return; }
    var bagli = !!(S.veri && S.veri.bagli);

    /* Film penceresi açıkken bütün dokunuşlar onun: arkadaki sahneye
       kazayla iş yaptırmak istemiyoruz. */
    if (S.film && filmDokun(p)) return;

    /* Yön tuşları */
    var jt = jogTusBul(p);
    if (jt) { jogBasla(jt); return; }
    /* Ses düğmesi */
    if (S.sesDugme && Math.hypot(S.sesDugme.x + 15 - p.x, S.sesDugme.y + 15 - p.y) < S.sesDugme.r + 4) {
      var sa = Ses.degistir();
      mesajYaz(sa ? "Ses açık." : "Ses kapalı.");
      altYaz(); isteKare(); return;
    }
    /* SOL RAY — aleti eline al. Makine kopukken alınmıyor ve sebebi
       söyleniyor: o işi yapan makine. */
    var ray = rayVur(p);
    if (ray) {
      if (!bagli) {
        mesajYaz("Makine bağlı değil — " + ray.ad.toLowerCase()
          + " aleti alınamaz. Hasat ve taşıma çalışıyor, onlar kayıt işi.");
        isteKare(); return;
      }
      S.tasima = { tip: "alet", k: ray.k, x: p.x, y: p.y };
      S.tasimaHedef = null; S.halka = false; S.secili = "";
      Ses.uyandir(); Ses.tik();
      mesajYaz(ray.ad + " elinde — bir bitkinin üstüne bırak.");
      altYaz(); isteKare(); return;
    }

    /* eylem halkası */
    if (S.secili && !S.ekimNokta) {
      var ey = halkadaMi(EYLEM, p);
      if (ey) { eylemBasildi(ey, bagli); return; }
    }
    /* alet halkası */
    if (S.halka) {
      var al = halkadaMi(ALET, p);
      if (al) {
        if (!bagli) { mesajYaz("Makine bağlı değil — alet seçilemez."); return; }
        S.alet = al.k; S.halka = false;
        mesajYaz(al.ad + " elinde. Bir bitkiye dokun.");
        isteKare(); return;
      }
    }
    /* tohum tepsisi */
    if (S.ekimNokta) {
      var gz = halkadaMi(S_GOZ, p);
      if (gz) {
        if (!gz.dolu) { mesajYaz(gz.k + " gözünde tohum yok — makine bunu ekemez."); return; }
        S.ekimTur = gz.tohum;
        ekimOnayHazirla();
        isteKare(); return;
      }
      S.ekimNokta = null; S.ekimTur = null; onayKapat(); altYaz(); isteKare(); return;
    }
    /* dur düğmesi — çalışan işin rozetinin yanında */
    if (S.durDugme && Math.hypot(S.durDugme.x - p.x, S.durDugme.y - p.y) < S.durDugme.r) {
      isIptal(S.durDugme.kimlik, S.durDugme.etiket);
      return;
    }
    /* uç */
    var m = S.robot || S.makine;
    if (Math.hypot(px(m.x) - p.x, arabaY() - p.y) < 26) {
      S.halka = !S.halka; S.secili = ""; altYaz(); isteKare(); return;
    }
    /* kiriş — sürüklemeye başla */
    if (Math.abs(p.y - arabaY()) < 13) {
      bas = { tip: "kiris", x: p.x, y: p.y, surukle: false };
      return;
    }
    /* bitki — dokunmak seçiyor, SÜRÜKLEMEK taşıyor. */
    var b = bitkiBul(p);
    if (b) {
      S.secili = b.ad; S.halka = false;
      gecmisAl(b.ad);
      bas = { tip: "bitki", ad: b.ad, x: p.x, y: p.y, surukle: false };
      altYaz(); isteKare(); return;
    }
    /* boş toprak → uzun bas ekim */
    if (yataktaMi(p.x, p.y)) {
      bas = { tip: "toprak", x: p.x, y: p.y, surukle: false };
      uzunSayac = setTimeout(function () {
        if (!bas) return;
        S.ekimNokta = { x: mmx(bas.x), y: mmy(bas.y) };
        S.ekimTur = ""; S.secili = ""; S.halka = false;
        mesajYaz("Tohum tepsisi açıldı — bir göz seç.");
        bas = null; altYaz(); isteKare();
      }, UZUN_BAS_MS);
      return;
    }
    S.secili = ""; S.halka = false; altYaz(); isteKare();
  });

  function rayVur(p) {
    for (var i = 0; i < S.ray.length; i++) {
      var a = S.ray[i];
      if (p.x >= a.x - 4 && p.x <= a.x + a.w + 4 && p.y >= a.y - 4 && p.y <= a.y + a.h + 4) return a;
    }
    return null;
  }
  function sepetteMi(p) {
    var sp = S.sepet;
    return !!sp && p.x >= sp.x - 10 && p.x <= sp.x + sp.w + 10
      && p.y >= sp.y - 10 && p.y <= sp.y + sp.h + 10;
  }
  var tuvalKaydi = guvenli("gezinme", function (e) {
    if (bas && bas.tip === "film") { filmSec(konum(e).x); return; }
    if (S.tasima) {
      var pt = konum(e);
      S.tasima.x = pt.x; S.tasima.y = pt.y;
      if (S.tasima.tip === "alet") {
        var hb = bitkiBul(pt);
        S.tasimaHedef = hb ? hb.ad : null;
      } else {
        S.tasimaHedef = sepetteMi(pt) ? "sepet" : null;
      }
      isteKare(); return;
    }
    if (!bas) return;
    var p = konum(e);
    if (!bas.surukle && Math.hypot(p.x - bas.x, p.y - bas.y) > 6) {
      bas.surukle = true;
      if (uzunSayac) { clearTimeout(uzunSayac); uzunSayac = 0; }
    }
    if (bas.surukle && bas.tip === "bitki") {
      S.tasima = { tip: "bitki", ad: bas.ad, x: p.x, y: p.y };
      S.tasimaHedef = null;
      bas = null;
      isteKare(); return;
    }
    if (bas.surukle) {
      /* Uç yalnız KAYITLI NOKTALARA gidebiliyor (`/api/bahce/is` nokta
         istiyor). Hayalet serbest gezinmiyor, en yakın bitkiye oturuyor —
         gideceği yer neresiyse orayı gösteriyor. */
      var mx = mmx(p.x), my = mmy(p.y), en = null, ed = 1e9;
      S.bitki.forEach(function (b) {
        var d = Math.hypot(sayi(b.x) - mx, sayi(b.y) - my);
        if (d < ed) { ed = d; en = b; }
      });
      S.hayalet = en ? { x: sayi(en.x), y: sayi(en.y), ad: en.ad } : null;
      isteKare();
    }
  });

  var tuvalBirakti = guvenli("bırakma", function () {
    if (uzunSayac) { clearTimeout(uzunSayac); uzunSayac = 0; }
    if (S.jogBasili) { jogBitir(); bas = null; return; }
    if (bas && bas.tip === "film") { bas = null; return; }
    if (S.tasima) {
      var t = S.tasima, hedef = S.tasimaHedef;
      S.tasima = null; S.tasimaHedef = null;
      if (t.tip === "alet") aletBirak(t.k, hedef ? S.ix[hedef] : null);
      else bitkiBirak(t, hedef);
      bas = null; isteKare(); return;
    }
    if (S.basiliSula) {
      var sn = S.basiliSn;
      S.basiliSula = false; S.basiliSn = 0;
      sulaOnayAc(sn);
      bas = null; isteKare(); return;
    }
    if (bas && bas.surukle && S.hayalet && S.hayalet.ad) {
      var h = S.hayalet;
      var yol = Math.round(Math.hypot(h.x - S.makine.x, h.y - S.makine.y));
      onayAc("Makine " + h.ad + " üstüne gidecek. Hiçbir şey ekilmez, sulanmaz.",
        "X " + Math.round(h.x) + " mm · Y " + Math.round(h.y) + " mm · " + yol + " mm yol",
        "Git",
        function () { S.hayalet = null; isGonder("gez", [h.ad]); },
        function () { S.hayalet = null; isteKare(); });
    } else if (bas && bas.surukle) {
      S.hayalet = null;
      mesajYaz("Yatakta kayıtlı bitki yok — uç gönderilecek bir nokta bulunamadı.");
      isteKare();
    }
    bas = null;
  });

  /** Alet bir bitkinin üstüne bırakıldı: iş kuyruğa giriyor. Hiçbir iş
   *  onaysız gitmiyor — bırakmak niyet, onay karar. */
  function aletBirak(k, b) {
    if (!b) {
      mesajYaz("Alet bir bitkinin üstüne bırakılmalı — boş toprağa iş verilemiyor.");
      altYaz(); return;
    }
    var ad = b.tur_ad || b.ad;
    var yol = S.makine && S.makine.x != null
      ? Math.round(Math.hypot(sayi(b.x) - sayi(S.makine.x), sayi(b.y) - sayi(S.makine.y))) : null;
    var altSatir = "X " + Math.round(sayi(b.x)) + " mm · Y " + Math.round(sayi(b.y)) + " mm"
      + (yol != null ? " · " + yol + " mm yol" : " · makinenin konumu bildirilmedi");
    if (k === "sula") {
      var sn = sayi(b.sulama_saniye, 0);
      if (sn <= 0) {
        mesajYaz("Bu bitki için sulama süresi yazılı değil — süreyi sen ver: "
          + "bitkiye dokun, Sula düğmesini basılı tut.");
        altYaz(); return;
      }
      onayAc(ad + " sulanacak: " + sn.toFixed(1) + " sn.",
        altSatir + " · süreyi değiştirmek için Sula'yı basılı tut", "Sula",
        function () { isGonder("sula", [b.ad], { saniye: sn }); });
    } else if (k === "nem") {
      onayAc(ad + " kökünde nem ölçülecek.",
        altSatir + " · prob toprağa iniyor, ölçüm bitince yazılıyor", "Ölç",
        function () { isGonder("nem", [b.ad]); });
    } else if (k === "foto") {
      onayAc(ad + " fotoğraflanacak.", altSatir + " · kare büyüme filmine giriyor", "Çek",
        function () { isGonder("foto", [b.ad]); });
    } else if (k === "yakin") {
      onayAc("Uç " + ad + " üstüne gidecek, uç kamerası yakından bakacak.",
        altSatir + " · bu kare büyüme filmine GİRMİYOR", "Git",
        function () {
          gonder("/api/bahce/yakin", { ad: b.ad })
            .then(function () { gunluk("bahçe: yakından bak · " + b.ad); return veriYukle(); })
            .catch(function (h) { notYaz("yakin", "Olmadı: " + ((h && h.message) || h)); });
        });
    }
    isteKare();
  }

  /** Bitki bırakıldı: sepete ise HASAT, yatağın içine ise TAŞIMA.
   *  İkisi de KAYIT işi — makine kımıldamıyor, bu yüzden kopukken de
   *  çalışıyorlar. */
  function bitkiBirak(t, hedef) {
    var b = S.ix[t.ad];
    if (!b) return;
    var ad = b.tur_ad || b.ad;
    if (hedef === "sepet") {
      onayAc(ad + " hasat edilecek — yataktan düşecek.",
        "Makine hareket etmiyor: toplayan sensin. Fotoğraf filmi siliniyor değil.",
        "Hasat",
        function () {
          gonder("/api/bahce/hasat", { noktalar: [b.ad] })
            .then(function (c) {
              gunluk("bahçe: hasat · " + b.ad);
              mesajYaz((c && c.mesaj) || "Hasat edildi.");
              /* Konfeti GERÇEKTEN olmuş bir iş için: sunucu kaydı sildi. */
              Ses.pop();
              parcaPatlat(px(b.x), py(b.y), ["#f6c456", "#7bbf5a", "#e8ece2"], 30);
              balon(b.x, b.y, "hasat edildi", "#f6c456");
              xpEkle(6, "hasat");
              S.secili = ""; return veriYukle();
            })
            .catch(function (h) { notYaz("hasat", "Hasat kaydedilmedi: " + ((h && h.message) || h)); });
        });
      isteKare(); return;
    }
    if (!yataktaMi(t.x, t.y)) {
      mesajYaz("Orası yatağın dışı — bitki oraya taşınamaz.");
      altYaz(); isteKare(); return;
    }
    var nx = Math.round(mmx(t.x)), ny = Math.round(mmy(t.y));
    var kac = Math.round(Math.hypot(nx - sayi(b.x), ny - sayi(b.y)));
    if (kac < 8) { altYaz(); isteKare(); return; }   /* yerinde bırakıldı */
    onayAc(ad + " " + kac + " mm taşınacak — kayıt değişiyor, makine gitmiyor.",
      "Yeni yer: X " + nx + " mm · Y " + ny + " mm. Sunucu yatak sınırlarını ve "
      + "dikim alanlarını denetliyor; kabul etmezse sebebini yazar.",
      "Taşı",
      function () {
        gonder("/api/bahce/tasi", { ad: b.ad, x: nx, y: ny })
          .then(function () {
            gunluk("bahçe: taşındı · " + b.ad + " → " + nx + "," + ny);
            mesajYaz(ad + " taşındı.");
            Ses.toprak();
            balon(nx, ny, "taşındı", "#e8ece2");
            xpEkle(2, "tasi");
            return veriYukle();
          })
          .catch(function (h) { notYaz("tasi", "Taşınmadı: " + ((h && h.message) || h)); });
      });
    isteKare();
  }

  function eylemBasildi(ey, bagli) {
    var b = S.ix[S.secili];
    if (!b) return;
    if (ey.k === "kapat") { S.secili = ""; onayKapat(); altYaz(); isteKare(); return; }
    if (ey.k === "film") { filmAc(b); return; }
    if (!bagli) { mesajYaz("Makine bağlı değil — bu iş başlatılamaz."); return; }
    if (ey.k === "sula") {
      /* BASILI TUT: tuttuğun süre sulama süresi oluyor. Bırakınca ne
         kadar su verileceği yazılıyor ve onay isteniyor — vana hâlâ
         onaydan sonra açılıyor, çünkü işi makine kuyruktan yürütüyor. */
      S.basiliSula = true; S.basiliT0 = Date.now(); S.basiliSn = 0;
      altYaz(); isteKare(); return;
    }
    if (ey.k === "nem") {
      onayAc("Prob " + b.ad + " toprağına batıp nemi ölçecek.",
        "ölçümden sonra ekran tahmin etmeyi bırakır",
        "Ölç", function () { isGonder("nem", [b.ad]); });
      return;
    }
    if (ey.k === "foto") {
      onayAc("Uç " + b.ad + " üstüne gidip fotoğraf çekecek.", "geri alınabilir",
        "Çek", function () { isGonder("foto", [b.ad]); });
    }
  }
  function sulaOnayAc(sn) {
    var b = S.ix[S.secili];
    if (!b) return;
    var kendi = sayi(b.sulama_saniye, 3);
    var sure = sn < 0.3 ? kendi : Math.round(kis(sn, 0.5, 60) * 10) / 10;
    onayAc(b.ad + " " + sure.toFixed(1) + " saniye sulanacak.",
      (sn < 0.3 ? "bitkinin kendi ayarı" : "basılı tuttuğun süre")
        + " · geri alınamaz · sulamadan sonra nem ölçümü BAYATLAR",
      "Sula", function () { isGonder("sula", [b.ad], { saniye: sure }); });
  }
  function ekimOnayHazirla() {
    var n = S.ekimNokta, slug = S.ekimTur;
    if (!n || !slug) return;
    var d = ekimUygun(slug, n.x, n.y);
    if (!d.ok) { mesajYaz("Buraya ekilemez — " + d.sebep); onayKapat(); return; }
    var der = ekimDerinligi(slug);
    onayAc(turAdi(slug) + " buraya ekilecek.",
      "X " + Math.round(n.x) + " mm · Y " + Math.round(n.y) + " mm · yayılım "
        + Math.round(turYayilim(slug)) + " mm · "
        + (der == null ? "ekim derinliği bilinmiyor" : Math.round(der) + " mm derine")
        + " · geri alınamaz",
      "Ek", function () {
        gonder("/api/bahce/ek", { tur: slug, yerler: [{ x: n.x, y: n.y }] })
          .then(function (c) {
            S.ekimNokta = null; S.ekimTur = "";
            var yeni = (c && c.noktalar || [])[0];
            mesajYaz("Nokta yaratıldı, ekim kuyruğa girdi.");
            return veriYukle().then(function () {
              if (yeni && yeni.ad) { S.secili = String(yeni.ad); altYaz(); isteKare(); }
            });
          })
          .catch(function (h) { mesajYaz("Ekilemedi: " + ((h && h.message) || h)); });
      });
  }

  /* ==================================================================== *
   * İŞLER — hepsi var olan uçlardan; yeni uç yok.
   * ==================================================================== */
  function isGonder(tip, adlar, ek) {
    if (!(S.veri && S.veri.bagli)) {
      mesajYaz("Makine bağlı değil — iş sıraya girmedi.");
      return Promise.resolve(null);
    }
    var govde = { tip: tip, noktalar: adlar || [] };
    if (ek) for (var k in ek) govde[k] = ek[k];
    if (!govde.noktalar.length) {
      mesajYaz("Hedef nokta yok — makineye iş verilemedi.");
      return Promise.resolve(null);
    }
    return gonder("/api/bahce/is", govde)
      .then(function (c) {
        gunluk("bahçe: " + tip + " · " + govde.noktalar.length + " bitki");
        notYaz("is", "");
        Ses.damla();
        /* Balon SIRAYA GİRDİ diyor, "yapıldı" demiyor: makine işi kuyruktan
           yürütüyor ve henüz başlamadı. */
        var ad0 = govde.noktalar[0], b0 = S.ix[ad0];
        var sozluk = { sula: "sulama sıraya girdi", nem: "ölçüm sıraya girdi",
                       foto: "fotoğraf sıraya girdi", gez: "ziyaret sıraya girdi",
                       ek: "ekim sıraya girdi" };
        if (b0) balon(b0.x, b0.y, sozluk[tip] || "iş sıraya girdi", "#bfe2ff");
        return veriYukle();
      })
      .catch(function (h) {
        notYaz("is", "İş sıraya girmedi: " + ((h && h.message) || h));
        Ses.hata();
        isteKare();
        return null;
      });
  }
  var eylemErtele = guvenli("ertele", function (kimlik, iptal) {
    gonder("/api/bahce/ertele", { kimlik: kimlik, iptal: !!iptal })
      .then(function () { return veriYukle(); })
      .catch(function (h) { notYaz("ertele", "Erteleme olmadı: " + ((h && h.message) || h)); });
  });
  var ekimOnayGec = guvenli("ekim onayı", function () {
    gonder("/api/bahce/onay", {})
      .then(function () { return veriYukle(); })
      .catch(function (h) { notYaz("onay", "Onay geçmedi: " + ((h && h.message) || h)); });
  });

  /* ---------------------------------------------------------------- onay */
  function onayAc(metin, alt, evet, fn, iptalFn) {
    S.onay = { metin: metin, alt: alt, evet: evet, fn: fn, iptal: iptalFn };
    altYaz(); isteKare();
  }
  function onayKapat() { S.onay = null; altYaz(); }

  /* ==================================================================== *
   * TÜR KATALOĞU — ekim derinliği var olan /api/turler'den.
   * Yazılı değilse UYDURULMUYOR, "bilinmiyor" yazılıyor.
   * ==================================================================== */
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
  function ekimDerinligi(slug) {
    var k = S.katalog || {};
    return Object.prototype.hasOwnProperty.call(k, slug) ? k[slug] : null;
  }

  /* Seçili bitkinin nem geçmişi — var olan `/api/bitki` ucundan.
     UCUN YERİ: `sunucu/bitki.py` (`@yon.get("/api/bitki")`), `main.py`
     onu `app.include_router(bitki.yonlendirici_kur(...))` ile bağlıyor.
     `ek[<bitki adı>]` içinde `gecmis`, `egilim`, `sula_adet`, `nem_adet`
     alanları oradan geliyor; `main.py` içinde aranınca bulunamamasının
     sebebi yönlendiricinin ayrı dosyada olması. */
  var gecmisAl = guvenli("geçmiş", function (ad) {
    if (!ad) return;
    if (S.gecmisAd === ad && Date.now() - S.gecmisT < 20000) return;
    S.gecmisAd = ad; S.gecmisT = Date.now(); S.gecmis = null;
    api("/api/bitki").then(function (c) {
      if (S.gecmisAd !== ad) return;
      var e = (c.ek || {})[ad];
      S.gecmis = e ? { adet: (e.gecmis || []).length, egilim: e.egilim || null,
                       sula: sayi(e.sula_adet, 0), olcum: sayi(e.nem_adet, 0),
                       sulaToplam: sayi(e.sula_toplam_sn, 0),
                       son: (e.gecmis && e.gecmis.length)
                         ? e.gecmis[e.gecmis.length - 1] : null }
                   : { adet: 0, egilim: null, sula: 0, olcum: 0, sulaToplam: 0, son: null };
      altYaz();
    }).catch(function (h) {
      /* NEDEN okunamadığını yazıyoruz. "Okunamadı" tek başına hiçbir şey
         öğretmiyordu: uç sunucuda yok mu (404), jeton mu düştü (401),
         sunucu mu patladı (500)? `apiIste` hatanın üstüne durum kodunu
         `kod` olarak koyuyor, detay da mesajda. Uç `sunucu/bitki.py`
         içinde tanımlı ve `main.py` onu `include_router` ile bağlıyor;
         404 görülürse orada bir kopukluk var demektir. */
      S.gecmis = null;
      var kod = h && h.kod ? h.kod : 0;
      var ek = kod === 404
        ? "sunucuda /api/bitki yok (sunucu/bitki.py bağlı değil)"
        : ((h && h.message) || "sebep bilinmiyor");
      notYaz("gecmis", "Nem geçmişi okunamadı — " + (kod ? kod + ": " : "") + ek);
      isteKare();
    });
  });

  /* ==================================================================== *
   * ÜST ŞERİT — makine durumu ve GÜNÜN TEK İŞ CÜMLESİ.
   * Sunucu kart listesi döndürüyor; ekran tek cümle gösteriyor, ötekiler
   * sayıyla ve iki okla geçiliyor. Liste veri; cümle arayüz.
   * ==================================================================== */
  function acikKartlar() {
    var k = ((S.veri && S.veri.kartlar) || []).slice();
    k.sort(function (a, b) { return (a.ertelendi ? 1 : 0) - (b.ertelendi ? 1 : 0); });
    return k;
  }
  function suankiKart() {
    var k = acikKartlar();
    if (!k.length) return null;
    if (S.kartIx >= k.length) S.kartIx = 0;
    if (S.kartIx < 0) S.kartIx = k.length - 1;
    return k[S.kartIx];
  }
  var ustYaz = guvenli("üst şerit", function () {
    var v = S.veri || {}, bagli = !!v.bagli;
    var kuyruk = v.kuyruk || {};
    var el = $("#bh-makine");
    if (el) {
      var calisan = (kuyruk.isler || []).filter(function (i) {
        return i && i.durum === "calisiyor"; })[0];
      var sinif = "yok", yazi = "makine bağlı değil";
      if (bagli && (v.mesgul || calisan)) {
        sinif = "mesgul";
        yazi = calisan && calisan.etiket ? "çalışıyor · " + calisan.etiket : "çalışıyor";
      } else if (bagli) {
        sinif = "hazir";
        yazi = sayi(kuyruk.bekleyen, 0) ? "hazır · " + kuyruk.bekleyen + " iş sırada" : "hazır";
      }
      el.className = "bh-makine " + sinif;
      el.textContent = yazi;
    }
    var metin = $("#bh-is-metin"), neden = $("#bh-is-neden"), evet = $("#bh-is-evet");
    var ertele = $("#bh-is-ertele"), sayac = $("#bh-is-sayac");
    if (!metin) return;

    var eo = v.ekim || {};
    if (eo.aktif) {
      S.isKip = "ekim";
      metin.textContent = "🌱 Ekim sürüyor"
        + (sayi(eo.toplam, 0) ? " · " + sayi(eo.sira, 0) + "/" + sayi(eo.toplam, 0) : "")
        + (eo.tur_ad ? " · " + eo.tur_ad : "");
      neden.innerHTML = eo.soru
        ? '<span class="bh-ac">' + kacisli(eo.soru) + "</span>"
        : '<span class="bh-kanit">makine kuyruktaki ekim işini yürütüyor</span>';
      evet.hidden = !eo.soru; evet.disabled = !bagli; evet.textContent = "Devam et";
      ertele.hidden = true; sayac.hidden = true;
      $("#bh-is-geri").hidden = true; $("#bh-is-ileri").hidden = true;
      return;
    }
    S.isKip = "kart";
    var k = suankiKart(), hepsi = acikKartlar();
    if (!k) {
      metin.textContent = S.veri ? "Bugün bekleyen iş yok." : "Bahçe okunuyor…";
      neden.innerHTML = "";
      evet.hidden = true; ertele.hidden = true; sayac.hidden = true;
      $("#bh-is-geri").hidden = true; $("#bh-is-ileri").hidden = true;
      return;
    }
    metin.textContent = ((k.simge || "") + " " + (k.baslik || "")).trim();
    var parca = [];
    if (k.aciklama) parca.push('<span class="bh-ac">' + kacisli(k.aciklama) + "</span>");
    if (k.kanit) {
      parca.push('<span class="bh-kanit' + (k.tahmin ? " tahmin" : "") + '">'
        + (k.tahmin ? "tahmin · " : "ölçüm · ") + kacisli(k.kanit) + "</span>");
    }
    if (k.ertelendi) {
      parca.push('<span class="bh-ert">' + kacisli(k.ertelendi_yazi || "ertelendi")
        + ' · <button type="button" data-bh="ertele-iptal">geri al</button></span>');
    }
    neden.innerHTML = parca.join("");
    evet.hidden = false;
    evet.textContent = k.evet || "Yap";
    evet.disabled = k.tip !== "ek" && !bagli;
    evet.title = evet.disabled ? "Makine bağlı değil" : "";
    /* Düğme kaldırıldı: her hâlde gizli. Kartın kendi "ertelendi · geri
       al" satırı duruyor, erteleme yeteneği oradan görünüyor. */
    ertele.hidden = true;
    var cok = hepsi.length > 1;
    sayac.hidden = !cok;
    sayac.textContent = cok ? (S.kartIx + 1) + "/" + hepsi.length : "";
    $("#bh-is-geri").hidden = !cok;
    $("#bh-is-ileri").hidden = !cok;
  });

  /* ==================================================================== *
   * ALT ŞERİT — bağlam: onay, seçili bitki ya da ipucu.
   * Sahnedeki halkalar hızlı yol; buradaki düğmeler erişilebilir yol.
   * ==================================================================== */
  function nemYazi(b) {
    var n = nemDurum(b);
    if (!n.var) return { yazi: "nem ölçülmedi", sinif: "yok" };
    var y = "%" + Math.round(n.yuzde);
    if (n.bayat) return { yazi: y + " · sulamadan önceki okuma", sinif: "bayat" };
    if (!n.kendi) return { yazi: y + " · " + Math.round(n.uzak) + " mm öteden ödünç", sinif: "odunc" };
    return { yazi: y + " · " + sureKisa(n.yas) + " önce ölçüldü", sinif: "olculdu" };
  }
  var altYaz = guvenli("alt şerit", function () {
    var kok = $("#bh-alt");
    if (!kok) return;
    var bagli = !!(S.veri && S.veri.bagli);
    if (S.basiliSula) {
      kok.dataset.kip = "basili";
      kok.innerHTML = '<div class="bh-a-metin"><b>Basılı tut — vana bu kadar açık kalacak'
        + '</b><span class="bh-a-alt vurgu" id="bh-sn">0.0 sn</span></div>';
      return;
    }
    if (S.onay) {
      kok.dataset.kip = "onay";
      kok.innerHTML =
        '<div class="bh-a-metin"><b>' + kacisli(S.onay.metin) + "</b>"
        + '<span class="bh-a-alt">' + kacisli(S.onay.alt || "") + "</span></div>"
        + '<div class="bh-a-dugme"><button type="button" data-bh="onay-hayir">Vazgeç</button>'
        + '<button type="button" class="asil" data-bh="onay-evet">'
        + kacisli(S.onay.evet || "Onayla") + "</button></div>";
      return;
    }
    if (S.ekimNokta) {
      kok.dataset.kip = "ekim";
      var s = S.ekimTur ? ekimUygun(S.ekimTur, S.ekimNokta.x, S.ekimNokta.y) : null;
      kok.innerHTML = '<div class="bh-a-metin"><b>'
        + (S.ekimTur ? kacisli(turAdi(S.ekimTur)) + (s && s.ok ? " sığıyor" : " sığmıyor")
                     : "Tohum tepsisi açık")
        + "</b><span class=\"bh-a-alt\">"
        + kacisli(s && !s.ok ? s.sebep : "Bir göz seç; çember yeşilse yer uygun.")
        + "</span></div>"
        + '<div class="bh-a-dugme"><button type="button" data-bh="ekim-birak">Vazgeç</button></div>';
      return;
    }
    var b = S.ix[S.secili];
    if (b) {
      kok.dataset.kip = "bitki";
      var n = nemYazi(b);
      var bic = bicimSec(b);
      var olcu = [
        '<span class="bh-ol nem ' + n.sinif + '">' + kacisli(n.yazi) + "</span>",
        '<span class="bh-ol"><b>' + Math.round(sayi(b.yas_gun, 0)) + "</b> günlük"
          + (sayi(b.olgun_gun, 0) ? " · olgunluk " + Math.round(sayi(b.olgun_gun)) + " gün" : "")
          + "</span>"
      ];
      if (b.susadi) {
        olcu.unshift('<span class="bh-ol susadi">susadı · '
          + (b.su_kanit === "olculen" ? "ölçüme göre" : "geçen güne göre (tahmin)") + "</span>");
      }
      if (b.hasat) olcu.push('<span class="bh-ol hasat">hasada hazır</span>');
      if (!bic.bilinen) olcu.push('<span class="bh-ol susadi">tür tanınmadı</span>');
      if (S.gecmis && S.gecmis.egilim) {
        var d = sayi(S.gecmis.egilim.degisim, 0);
        olcu.push('<span class="bh-ol">' + S.gecmis.egilim.adet + " ölçüm · "
          + (d > 0 ? "+" : "") + d.toFixed(1) + " puan</span>");
      } else if (S.gecmis && S.gecmis.adet === 1) {
        olcu.push('<span class="bh-ol yok">tek ölçüm — eğilim yok</span>');
      }
      kok.innerHTML =
        '<div class="bh-a-bas"><span class="bh-a-simge">' + kacisli(b.simge || "🌱") + "</span>"
        + '<span class="bh-a-ad">' + kacisli(b.ad) + "</span>"
        + '<span class="bh-a-tur">' + kacisli(b.tur_ad || b.tur || "") + "</span></div>"
        + '<div class="bh-a-olcu">' + olcu.join("") + "</div>"
        + '<div class="bh-a-dugme">'
        + '<button type="button" data-bh="sula"' + (bagli ? "" : " disabled") + ">Sula</button>"
        + '<button type="button" data-bh="olc"' + (bagli ? "" : " disabled") + ">Nemini ölç</button>"
        + '<button type="button" data-bh="foto"' + (bagli ? "" : " disabled") + ">Fotoğrafla</button>"
        + '<button type="button" data-bh="kapat" class="sade">Bırak</button></div>';
      return;
    }
    kok.dataset.kip = "bos";
    var ipuc = S.mesaj || "Soldaki aleti bitkinin üstüne sürükle (sula · nem · "
      + "kamera · yakın bak) · bitkiyi sürükle (taşı) ya da sepete bırak (hasat) · "
      + "bitkiye dokun (eylemler) · boş toprağa uzun bas (ekim) · kirişi sürükle "
      + "(makineyi taşı)";
    kok.innerHTML = '<div class="bh-a-metin"><span class="bh-a-alt'
      + (S.mesaj ? " vurgu" : "") + '">' + kacisli(ipuc) + "</span></div>";
  });

  /* ==================================================================== *
   * BAĞLAMA
   * ==================================================================== */
  var tiklama = guvenli("düğme", function (e) {
    var d = e.target.closest("[data-bh]");
    if (!d) return;
    var ad = d.dataset.bh, b = S.ix[S.secili];
    if (ad === "onay-evet") {
      var fn = S.onay && S.onay.fn; onayKapat(); if (fn) fn();
    } else if (ad === "onay-hayir") {
      var ip = S.onay && S.onay.iptal; onayKapat(); if (ip) ip();
    } else if (ad === "ekim-birak") {
      S.ekimNokta = null; S.ekimTur = ""; altYaz(); isteKare();
    } else if (ad === "sula" && b) { sulaOnayAc(0); }
    else if (ad === "olc" && b) {
      onayAc("Prob " + b.ad + " toprağına batıp nemi ölçecek.",
        "ölçümden sonra ekran tahmin etmeyi bırakır", "Ölç",
        function () { isGonder("nem", [b.ad]); });
    } else if (ad === "foto" && b) {
      onayAc("Uç " + b.ad + " üstüne gidip fotoğraf çekecek.", "geri alınabilir", "Çek",
        function () { isGonder("foto", [b.ad]); });
    } else if (ad === "kapat") { S.secili = ""; altYaz(); isteKare(); }
    else if (ad === "ertele-iptal") {
      var k = suankiKart(); if (k) eylemErtele(k.kimlik, true);
    }
  });
  var kartEvet = guvenli("kart eylemi", function () {
    if (S.isKip === "ekim") { ekimOnayGec(); return; }
    var k = suankiKart();
    if (!k) return;
    var adlar = (k.noktalar || []).map(String);
    if (k.tip === "sula") {
      onayAc(adlar.length + " bitki sulanacak.",
        "süre her bitkinin kendi ayarından · geri alınamaz · ölçümler bayatlar",
        "Sula", function () { isGonder("sula", adlar); });
    } else if (k.tip === "nem") {
      onayAc(adlar.length + " bitkinin toprağına prob batırılacak.",
        "ölçümden sonra ekran tahmin etmeyi bırakır", "Ölç",
        function () { isGonder("nem", adlar); });
    } else if (k.tip === "hasat") {
      onayAc(adlar.length + " bitkinin üstüne gidilip fotoğraf çekilecek.", "geri alınabilir",
        "Çek", function () { isGonder("foto", adlar); });
    } else if (k.tip === "ek") {
      mesajYaz("Ekmek için yatakta boş bir toprağa UZUN BAS — tohum tepsisi orada açılır.");
    }
  });

  var olaylariBagla = guvenli("bağlama", function () {
    S.tuval.addEventListener("pointerdown", tuvalBasti);
    S.tuval.addEventListener("pointermove", tuvalKaydi);
    S.tuval.addEventListener("pointerup", tuvalBirakti);
    S.tuval.addEventListener("pointercancel", function () {
      if (uzunSayac) { clearTimeout(uzunSayac); uzunSayac = 0; }
      jogBitir();
      bas = null; S.basiliSula = false; S.basiliSn = 0; isteKare();
    });
    $("#bh-kok").addEventListener("click", tiklama);
    $("#bh-is-evet").addEventListener("click", kartEvet);
    /* "yarın sor" ve "sakin mod" DÜĞMELERİ KALDIRILDI (kullanıcı istedi).
       Düğmeler `index.html`de duruyor ama gizli ve artık bağlanmıyorlar;
       o iki satırı ortak dosyadan silmek ayrı bir iş, haber vererek
       yapılacak. Yetenekler duruyor: ertelenmiş kart hâlâ "ertelendi ·
       geri al" diyor, sakin mod işletim sisteminin "hareketi azalt"
       ayarından kendiliğinden açılıyor. */
    $("#bh-is-geri").addEventListener("click", function () { S.kartIx--; ustYaz(); });
    $("#bh-is-ileri").addEventListener("click", function () { S.kartIx++; ustYaz(); });
    $("#bh-kur").addEventListener("click", function () { insaBasla(); });
    document.addEventListener("keydown", function (e) {
      if (!S.acik) return;
      if (e.key === "Escape") {
        if (document.body.classList.contains("bh-menu")) {
          carkKapat();
          var ck = $("#bh-cark"); if (ck) ck.setAttribute("aria-expanded", "false");
          isteKare(); return;
        }
        if (S.film) { filmKapat(); return; }
        if (S.tasima) { S.tasima = null; S.tasimaHedef = null; altYaz(); isteKare(); return; }
        if (S.onay) { var ip = S.onay.iptal; onayKapat(); if (ip) ip(); return; }
        if (S.ekimNokta) { S.ekimNokta = null; S.ekimTur = ""; altYaz(); isteKare(); return; }
        if (S.halka) { S.halka = false; isteKare(); return; }
        if (S.secili) { S.secili = ""; altYaz(); isteKare(); }
      } else if (e.key === "ArrowRight") { S.kartIx++; ustYaz(); }
      else if (e.key === "ArrowLeft") { S.kartIx--; ustYaz(); }
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && S.acik) isteKare();
    });
    window.addEventListener("resize", olcuKur);
  });

  /* ==================================================================== *
   * VERİ
   * ==================================================================== */
  function bitkileriHazirla() {
    var v = S.veri || {};
    var eski = S.ix;
    S.bitki = (v.bitkiler || []).filter(function (b) { return b && b.ad != null; });
    S.ix = {};
    S.bitki.forEach(function (b) {
      var e = eski[String(b.ad)];
      b._aci = e ? e._aci : (tohum(b.ad) - 0.5) * 1.2;
      b._faz = e ? e._faz : tohum(b.ad + "f") * 6.3;
      b._gorunum = S.insaBitti ? 1 : (e ? e._gorunum : 0);
      b._tohum = S.insaBitti ? 1 : (e ? e._tohum : 0);
      S.ix[String(b.ad)] = b;
    });
    if (S.secili && !S.ix[S.secili]) S.secili = "";
    var k = v.konum || {};
    if (k.x != null) S.makine = { x: sayi(k.x), y: sayi(k.y), z: k.z == null ? null : sayi(k.z) };
  }

  var veriYukle = guvenli("veri", function () {
    if (S.yukleniyor) return Promise.resolve();
    S.yukleniyor = true;
    return api("/api/bahce").then(function (c) {
      S.veri = c || {};
      kuyrukIzle();
      bitkileriHazirla();
      yerlesim();
      topragiCiz();
      notYaz("veri", "");
      katalogAl();
      olcumAl();
      ustYaz(); altYaz(); isteKare();
    }).catch(function (h) {
      /* SESSİZ BAŞARISIZLIK YOK: sahne boş kalırsa sebebi ekranda. */
      hataYaz("veri", h);
      notYaz("veri", "Bahçe okunamadı — makine ya da sunucu yanıt vermedi.");
    }).then(function () { S.yukleniyor = false; });
  });

  /* ==================================================================== *
   * KURULUM VE DIŞ ARAYÜZ
   * ==================================================================== */
  /* ==================================================================== *
   * ⚙ — TEKNİK ARAYÜZ BAHÇENİN ÜSTÜNDEN ÇEKİLİYOR
   *
   * Bahçe açıkken üst bardaki sekme şeridi, marka ve ışıklar gizleniyor;
   * ekranın tamamı tarla oluyor. ⚙ düğmesi onları geri getiriyor (CSS
   * `body.bh-menu`). Düğme burada YARATILIYOR — `index.html` ortak dosya
   * ve üç oturum aynı ağaçta; oraya bir satır eklemek yerine kendi
   * dosyamda yaratıp başlığın sağ ucuna takıyorum.
   *
   * ACİL DURDURMA DÜĞMESİ GİZLENMİYOR: güvenlik denetimi menünün arkasına
   * konmaz. ⚙ onun soluna giriyor.
   * ==================================================================== */
  function carkKur() {
    if ($(".bh-cark")) return;
    var sag = document.querySelector("header .ust-sag");
    if (!sag) return;
    var d = document.createElement("button");
    d.type = "button";
    d.className = "bh-cark";
    d.id = "bh-cark";
    d.title = "Teknik sekmeler ve ayarlar";
    d.setAttribute("aria-label", "Teknik sekmeler ve ayarlar");
    d.setAttribute("aria-expanded", "false");
    d.textContent = "⚙";
    d.addEventListener("click", function () {
      var acik = document.body.classList.toggle("bh-menu");
      d.setAttribute("aria-expanded", acik ? "true" : "false");
      Ses.uyandir(); Ses.tik();
      /* Üst bar açılıp kapanınca tuvalin boyu değişmiyor (başlık sayfa
         akışının dışında) ama ölçüyü yine de tazeliyoruz: kullanıcı
         pencereyi bu sırada değiştirmiş olabilir. */
      olcuKur(); isteKare();
    });
    var acil = sag.querySelector("#d-acil");
    if (acil) sag.insertBefore(d, acil); else sag.appendChild(d);
  }
  function carkKapat() { document.body.classList.remove("bh-menu"); }

  var kuruldu = false;
  var kur = guvenli("kurulum", function () {
    if (kuruldu) return true;
    S.tuval = $("#bh-sahne");
    if (!S.tuval || !S.tuval.getContext) {
      hataYaz("kurulum", new Error("tuval bulunamadı"));
      return false;
    }
    S.ct = S.tuval.getContext("2d");
    carkKur();
    sakinKur();
    bulutKur();
    xpOku();
    olaylariBagla();
    kuruldu = true;
    return true;
  });

  var sayacId = 0;
  function sayacKur(acik) {
    if (sayacId) { clearInterval(sayacId); sayacId = 0; }
    if (acik) sayacId = setInterval(function () { if (S.acik) veriYukle(); }, 30000);
  }

  var ilkAcilis = true;
  var dis = {
    sekme: function (acik) {
      S.acik = !!acik;
      document.body.classList.toggle("bahce-acik", S.acik);
      if (!S.acik) {
        carkKapat(); jogBitir();
        Ses.akisDur(); Ses.motorDur(); S.hareketSes = false;
      }
      sayacKur(S.acik);
      if (!S.acik) {
        if (S.dongu) { cancelAnimationFrame(S.dongu); S.dongu = 0; }
        return;
      }
      if (!kur()) return;
      requestAnimationFrame(function () {
        olcuKur();
        veriYukle().then(function () {
          if (ilkAcilis) { ilkAcilis = false; insaBasla(); }
          else isteKare();
        });
      });
    },
    /* Kamera karesi bu sekmede yok: sahnenin köşesinde yüzen kutu
       istemiyoruz, kare Kamera sekmesinde duruyor. */
    kareGeldi: function () { /* boş — bilerek */ },
    durumDegisti: function (d) {
      if (!S.acik || !d) return;
      /* MOTOR SESİ GERÇEK SİNYALE BAĞLI: `durum.hareket` bayrağı. Makine
         durduğu anda ses de duruyor; "hareket ediyormuş gibi" ses yok. */
      var hrk = !!d.hareket;
      if (hrk && !S.hareketSes) { Ses.motorBasla(); S.hareketSes = true; }
      else if (!hrk && S.hareketSes) { Ses.motorDur(); S.hareketSes = false; }
      S.veri = S.veri || {};
      /* KONUM BAYRAĞI AYRI TUTULUYOR: `S.veri` her tazelemede
         `/api/bahce` cevabıyla baştan yazılıyor ve içine koyduğumuz
         `konum` siliniyordu; konuma bakan her yer (su efekti, alet
         rozeti, yön tuşları) tazelemeden sonra "konum bildirilmedi"
         sanıyordu. */
      S.konumVar = !!d.konum;
      if (d.konum) {
        S.veri.konum = d.konum;
        S.makine = { x: sayi(d.konum.x), y: sayi(d.konum.y),
                     z: d.konum.z == null ? null : sayi(d.konum.z) };
      }
      if ("bagli" in d) S.veri.bagli = d.bagli;
      if ("mesgul" in d) S.veri.mesgul = d.mesgul;
      /* Yön tuşları bu üç alana bakıyor: tork kapalıysa ya da acil mandalı
         düştüyse jog hiçbir şey yapmaz; düğmeyi çalışır göstermek yalan. */
      S.enable = !!d.enable;
      S.acil = !!(d.acil && d.acil.acik);
      S.hareket = !!d.hareket;
      S.sinirlar = d.sinirlar || S.sinirlar;
      if ("toprak_z" in d) S.veri.toprak_z = d.toprak_z;
      if ("guvenli_z" in d) S.veri.guvenli_z = d.guvenli_z;
      ustYaz(); altYaz(); isteKare();
    },
    kuyrukDegisti: function (k) {
      if (!S.acik) return;
      S.veri = S.veri || {};
      if (k) S.veri.kuyruk = k;
      ustYaz();
      veriYukle();
    },
    ekimDegisti: function () { if (S.acik) veriYukle(); },
    baglandi: function () { if (S.acik) veriYukle(); },
    yenile: function () { return veriYukle(); },
    /** Ekrandaki alanların yerleri — ölçüm ve doğrulama için. Hiçbir şeyi
     *  değiştirmiyor, yalnız nerede ne olduğunu söylüyor. */
    alanlar: function () {
      return {
        ray: S.ray.map(function (a) {
          return { k: a.k, ad: a.ad, x: a.x, y: a.y, w: a.w, h: a.h };
        }),
        sepet: S.sepet ? { x: S.sepet.x, y: S.sepet.y, w: S.sepet.w, h: S.sepet.h } : null,
        yatak: { x: G.ox, y: G.oy, w: G.bw, h: G.bh },
        bitki: S.bitki.map(function (b) {
          return { ad: b.ad, px: px(b.x), py: py(b.y), r: spriteAl(b).R,
                   x: sayi(b.x), y: sayi(b.y) };
        }),
        tasima: S.tasima ? { tip: S.tasima.tip, k: S.tasima.k || S.tasima.ad } : null,
        su: { akiyor: !!S.suAkiyor, kanit: S.suKanit, damla: (S.damla || []).length,
              islak: S.islak.length },
        film: S.film ? { ad: S.film.ad, kare: S.film.kareler.length, ix: S.film.ix,
                         hata: S.film.hata, resim: !!S.film.img,
                         serit: S.film.serit || null, kutu: S.film.kutu || null } : null,
        jog: S.jog ? { x: S.jog.x, y: S.jog.y, w: S.jog.w, h: S.jog.h,
                       kilit: jogKilit(),
                       tuslar: S.jog.tuslar.map(function (t) {
                         return { k: t.k, cx: t.cx, cy: t.cy, r: t.r };
                       }) } : null,
        olcum: { satir: olcumSatirlari(), hata: S.olcumHata,
                 kutu: S.sensorKutu ? true : false },
        dur: S.durDugme ? { x: S.durDugme.x, y: S.durDugme.y, kimlik: S.durDugme.kimlik } : null,
        eylem: EYLEM.map(function (x) {
          return { k: x.k, x: x._x, y: x._y, r: x._r };
        })
      };
    },
    /** Kare süresi ölçümü — 24 bitkilik sahnede kaç ms sürdüğünü söyler. */
    olcum: function (sifirla) {
      var o = S.olcum;
      var c = { kare: o.kare, ortalama: o.kare ? +(o.sure / o.kare).toFixed(2) : 0,
                enUzun: +o.enUzun.toFixed(2), bitki: S.bitki.length,
                en: S.en, boy: S.boy, dpr: S.olcek, sakin: S.sakin, insa: !S.insaBitti };
      if (sifirla) { o.kare = 0; o.sure = 0; o.enUzun = 0; }
      return c;
    }
  };
  return dis;
}());
