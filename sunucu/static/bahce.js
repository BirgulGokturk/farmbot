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
 * PERFORMANS (Raspberry Pi 5, 800×480 ve telefon)
 * ---------------------------------------------------------------------
 * Çim ve toprak birer kez ayrı tuvale çiziliyor, sahneye tek drawImage
 * ile basılıyor. Bitki siluetleri önbellekte; salınım yalnız bir
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
    var c = S.toprakCt, r = uretec(424242), i;
    c.clearRect(0, 0, S.en, S.boy);
    c.save();
    c.beginPath(); c.rect(G.ox, G.oy, G.bw, G.bh); c.clip();
    var g = c.createLinearGradient(G.ox, G.oy, G.ox + G.bw * 0.3, G.oy + G.bh);
    g.addColorStop(0, "#63492f"); g.addColorStop(0.5, "#57402a"); g.addColorStop(1, "#4a3623");
    c.fillStyle = g; c.fillRect(G.ox, G.oy, G.bw, G.bh);
    var siraAdet = Math.max(10, Math.round(G.bh / 14));
    for (i = 0; i < siraAdet; i++) {                       /* tırmık izleri */
      var yy = G.oy + (i + 0.5) * (G.bh / siraAdet);
      c.strokeStyle = i % 2 ? "rgba(255,228,190,.045)" : "rgba(0,0,0,.10)";
      c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(G.ox, yy);
      for (var x = G.ox; x <= G.ox + G.bw; x += 16) c.lineTo(x, yy + Math.sin(x * 0.08 + i) * 1.4);
      c.stroke();
    }
    var kesek = Math.round((G.bw * G.bh) / 260);
    for (i = 0; i < kesek; i++) {
      var cx = G.ox + r() * G.bw, cy = G.oy + r() * G.bh, rr = 1.2 + r() * 3.4;
      c.fillStyle = "rgba(28,18,10," + (0.10 + r() * 0.22).toFixed(3) + ")";
      c.beginPath(); c.ellipse(cx, cy, rr, rr * (0.6 + r() * 0.5), r() * 3, 0, 6.3); c.fill();
      c.fillStyle = "rgba(255,224,180," + (0.05 + r() * 0.1).toFixed(3) + ")";
      c.beginPath();
      c.ellipse(cx - rr * 0.3, cy - rr * 0.35, rr * 0.6, rr * 0.4, r() * 3, 0, 6.3);
      c.fill();
    }
    for (i = 0; i < Math.round(kesek / 9); i++) {          /* çakıl */
      var sx = G.ox + r() * G.bw, sy = G.oy + r() * G.bh, sr = 1 + r() * 2.2;
      c.fillStyle = "rgba(186,178,164," + (0.18 + r() * 0.3).toFixed(3) + ")";
      c.beginPath(); c.ellipse(sx, sy, sr, sr * 0.72, r() * 3, 0, 6.3); c.fill();
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
  function nemKatCiz(c, p) {
    if (p <= 0) return;
    c.save();
    c.globalAlpha = p;
    c.save();
    c.beginPath(); c.rect(G.ox, G.oy, G.bw, G.bh); c.clip();
    S.bitki.forEach(function (b) {
      var n = nemDurum(b);
      if (!n.var) return;
      /* Islak leke: nem yüksekse toprak koyu. Ödünç ve bayat okuma daha
         soluk — kendi taze okuması kadar güvenilir görünmüyorlar. */
      var guc = (n.kendi ? 1 : 0.5) * (n.bayat ? 0.45 : 1);
      var R = rp(NEM_YARICAP_MM * 0.72), gx = px(b.x), gy = py(b.y);
      var g = c.createRadialGradient(gx, gy, R * 0.1, gx, gy, R);
      g.addColorStop(0, "rgba(30,20,11," + (0.05 + 0.19 * (n.yuzde / 100) * guc).toFixed(3) + ")");
      g.addColorStop(1, "rgba(30,20,11,0)");
      c.fillStyle = g;
      c.beginPath(); c.arc(gx, gy, R, 0, 6.3); c.fill();
    });
    c.fillStyle = "rgba(108,136,164,.13)";
    c.fillRect(G.ox, G.oy, G.bw, G.bh);
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
    S.bitki.forEach(function (b) {
      if (nemDurum(b).var) return;
      var sp = spriteAl(b);
      var R = sp.R + 14, gx = px(b.x), gy = py(b.y);
      c.save();
      c.beginPath(); c.arc(gx, gy, R, 0, 6.3); c.clip();
      c.strokeStyle = "rgba(206,222,238,.20)"; c.lineWidth = 0.9;
      for (var i = -R; i < R * 2; i += 9) {
        c.beginPath(); c.moveTo(gx - R + i, gy - R); c.lineTo(gx - R + i + R * 2, gy + R); c.stroke();
      }
      c.restore();
    });
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
      var sal = S.sakin ? 0
        : Math.sin(S.t * 1.1 + b._faz) * 0.022 + Math.sin(S.t * 2.7 + b._faz) * 0.008;
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
        c.font = "9px ui-monospace,monospace";
        c.fillStyle = etkin === a.k ? "#12140f" : "#8d9089";
        c.fillText(altAl(a), hx, hy + 12);
      }
      a._x = hx; a._y = hy; a._r = r;
    });
  }

  /* ------------------------------------------------------- eylem halkası */
  var EYLEM = [
    { k: "sula", ad: "Sula", renk: "#5aa6e8" },
    { k: "nem", ad: "Ölç", renk: "#63c46b" },
    { k: "foto", ad: "Çek", renk: "#c8ccc4" },
    { k: "kapat", ad: "Bırak", renk: "#8d9089" }
  ];
  function eylemCiz(c) {
    if (!S.secili || S.ekimNokta) return;
    var b = S.ix[S.secili];
    if (!b) return;
    var sp = spriteAl(b);
    var R = Math.max(46, sp.R + 32);
    var bagli = !!(S.veri && S.veri.bagli);
    halkaCiz(c, px(b.x), py(b.y), EYLEM, R, S.basiliSula ? "sula" : "", bagli,
      function (e) { return e.ad; },
      function (e) {
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
    eylemCiz(c);
    atmosferCiz(c, dt);
    isikCiz(c);
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
    /* bitki */
    var b = bitkiBul(p);
    if (b) {
      S.secili = b.ad; S.halka = false;
      gecmisAl(b.ad);
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

  var tuvalKaydi = guvenli("gezinme", function (e) {
    if (!bas) return;
    var p = konum(e);
    if (!bas.surukle && Math.hypot(p.x - bas.x, p.y - bas.y) > 6) {
      bas.surukle = true;
      if (uzunSayac) { clearTimeout(uzunSayac); uzunSayac = 0; }
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

  function eylemBasildi(ey, bagli) {
    var b = S.ix[S.secili];
    if (!b) return;
    if (ey.k === "kapat") { S.secili = ""; onayKapat(); altYaz(); isteKare(); return; }
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
        return veriYukle();
      })
      .catch(function (h) {
        notYaz("is", "İş sıraya girmedi: " + ((h && h.message) || h));
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

  /* Seçili bitkinin nem geçmişi — var olan /api/bitki'den. */
  var gecmisAl = guvenli("geçmiş", function (ad) {
    if (!ad) return;
    if (S.gecmisAd === ad && Date.now() - S.gecmisT < 20000) return;
    S.gecmisAd = ad; S.gecmisT = Date.now(); S.gecmis = null;
    api("/api/bitki").then(function (c) {
      if (S.gecmisAd !== ad) return;
      var e = (c.ek || {})[ad];
      S.gecmis = e ? { adet: (e.gecmis || []).length, egilim: e.egilim || null,
                       sula: sayi(e.sula_adet, 0), olcum: sayi(e.nem_adet, 0) }
                   : { adet: 0, egilim: null };
      altYaz();
    }).catch(function () {
      S.gecmis = null;
      notYaz("gecmis", "Nem geçmişi okunamadı.");
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
    ertele.hidden = !!k.ertelendi;
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
    var ipuc = S.mesaj || "Uca dokun (aletler) · bitkiye dokun (eylemler) · "
      + "boş toprağa uzun bas (ekim) · kirişi sürükle (makineyi taşı)";
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
      bas = null; S.basiliSula = false; S.basiliSn = 0; isteKare();
    });
    $("#bh-kok").addEventListener("click", tiklama);
    $("#bh-is-evet").addEventListener("click", kartEvet);
    $("#bh-is-ertele").addEventListener("click", function () {
      var k = suankiKart(); if (k) eylemErtele(k.kimlik, false);
    });
    $("#bh-is-geri").addEventListener("click", function () { S.kartIx--; ustYaz(); });
    $("#bh-is-ileri").addEventListener("click", function () { S.kartIx++; ustYaz(); });
    $("#bh-sakin").addEventListener("click", function () {
      S.sakin = !S.sakin;
      var d = $("#bh-sakin");
      d.setAttribute("aria-pressed", S.sakin ? "true" : "false");
      d.textContent = S.sakin ? "sakin mod açık" : "sakin mod";
      isteKare();
    });
    $("#bh-kur").addEventListener("click", function () { insaBasla(); });
    document.addEventListener("keydown", function (e) {
      if (!S.acik) return;
      if (e.key === "Escape") {
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
      bitkileriHazirla();
      yerlesim();
      topragiCiz();
      notYaz("veri", "");
      katalogAl();
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

  var ilkAcilis = true;
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
      S.veri = S.veri || {};
      if (d.konum) {
        S.veri.konum = d.konum;
        S.makine = { x: sayi(d.konum.x), y: sayi(d.konum.y),
                     z: d.konum.z == null ? null : sayi(d.konum.z) };
      }
      if ("bagli" in d) S.veri.bagli = d.bagli;
      if ("mesgul" in d) S.veri.mesgul = d.mesgul;
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
