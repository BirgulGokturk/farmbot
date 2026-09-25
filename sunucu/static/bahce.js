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
    sesDugme: null, altDugme: [], konumVar: false, hareketSes: false, enable: false, acil: false, hareket: false,
    jog: null, jogBasili: null, jogSayac: null, olcumVeri: null, olcumT: 0,
    olcumHata: "", sensorKutu: null, sagSutun: null, durumKutu: null,
    film: null, gorevKutu: null, kartKutu: null, kartYildiz: null, kartFilm: null,
    halkaMerkez: null,
    gorevSatir: [], gorevSatirAdet: 3, gorevKalan: 0, vurgu: null,
    zilAcik: false, zilSatir: [], zilKutu: null,
    raf: [], rafKutu: null, rafAcik: false, ekimGoz: "", bosYer: null, bosYerHata: "",
    sonIs: null, sonHasat: null, sonAlt: "",
    ekimSunucudan: false, ekimOturum: null, ekimSayac: null,
    ekimOnayKutu: null, ekimIptalKutu: null,
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
    gorevKur();
    rafKur();
    sagSutunKur();          /* ölçümler + sepet + durum + yön tuşları: aynı kolon */
    rayKur();               /* askı: tabela yerleştikten sonra */
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
      d += b.ad + (n.var ? ":" + Math.round(n.yuzde) + (n.kendi ? "k" : "o") + (n.bayat ? "b" : "") : ":-")
        + "/" + Math.round(sayi(b.sulama_ts, 0) / 600) + ";";
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
    /* SULANAN TOPRAK KURU TOPRAKTAN RENKLE AYRILIYOR.
     *
     * Bu bir ÖLÇÜM DEĞİL, bir KAYIT: sunucu o bitkiye en son ne zaman su
     * verildiğini yazıyor (`sulama_ts`). Leke "toprak şu an şu kadar
     * ıslak" demiyor, "buraya yakın zamanda su verildi" diyor ve 24
     * saatte soluyor — kuruma hızını bilmiyoruz, o yüzden solma bir
     * ölçüye değil ZAMANA bağlı ve kartta saatiyle yazılı.
     *
     * Rengi ölçülen nem lekesinden AYRI: ölçüm sıcak kahve bir koyuluk,
     * sulama serin mavimsi bir ıslaklık. İkisi aynı renk olsaydı "ölçtük"
     * ile "su verdik" ekranda aynı şeye benzerdi. */
    var simdiSn = Date.now() / 1000;
    S.bitki.forEach(function (b) {
      var st = sayi(b.sulama_ts, 0);
      if (!st) return;
      var yas = (simdiSn - st) / 86400;                  /* gün */
      if (yas < 0 || yas > 1) return;
      var guc = 1 - yas;
      var R2 = rp(NEM_YARICAP_MM * 0.55), gx2 = px(b.x), gy2 = py(b.y);
      var g2 = c.createRadialGradient(gx2, gy2, R2 * 0.12, gx2, gy2, R2);
      g2.addColorStop(0, "rgba(42,46,44," + (0.34 * guc).toFixed(3) + ")");
      g2.addColorStop(0.55, "rgba(48,54,52," + (0.2 * guc).toFixed(3) + ")");
      g2.addColorStop(1, "rgba(48,54,52,0)");
      c.fillStyle = g2;
      c.beginPath(); c.arc(gx2, gy2, R2, 0, 6.3); c.fill();
      /* Serin kenar: ıslak toprağın koyu halkası. */
      c.strokeStyle = "rgba(150,190,205," + (0.22 * guc).toFixed(3) + ")";
      c.lineWidth = 1.6;
      c.beginPath(); c.arc(gx2, gy2, R2 * 0.72, 0, 6.3); c.stroke();
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
      /* SULANDI ROZETİ: son 12 saat içinde su verilmiş bitkinin üstünde
         damla. Sayı kartta; buradaki işaret yalnız "yakın zamanda
         sulandı" diyor. */
      var sts = sayi(b.sulama_ts, 0);
      if (sts && p > 0.7) {
        var syas = (Date.now() / 1000 - sts) / 43200;
        if (syas >= 0 && syas < 1) {
          var sa = kis(1 - syas, 0.25, 1);
          c.save();
          c.globalAlpha = sa;
          c.fillStyle = "#9ed6fa";
          c.beginPath();
          c.moveTo(gx - R * 0.75, gy - R - 9);
          c.bezierCurveTo(gx - R * 0.75 + 5, gy - R - 3, gx - R * 0.75 + 4, gy - R + 2,
            gx - R * 0.75, gy - R + 2);
          c.bezierCurveTo(gx - R * 0.75 - 4, gy - R + 2, gx - R * 0.75 - 5, gy - R - 3,
            gx - R * 0.75, gy - R - 9);
          c.closePath(); c.fill();
          c.strokeStyle = "rgba(20,40,55,.5)"; c.lineWidth = 0.9; c.stroke();
          c.restore();
        }
      }
      if (Favori.var(b.ad) && p > 0.7) {
        yildizCiz(c, gx + R * 0.75, gy - R - 8, 6.5, true);
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
  /** Halkanın çizileceği merkez: bitkinin üstünde ama EKRANIN İÇİNDE.
   *  Yatağın üst kenarındaki bitkide halkanın yarısı tuvalin dışında
   *  kalıyordu — düğmelerin yarısı görünmüyor, dokunulamıyordu. Merkez
   *  gerektiğinde içe kaydırılıyor ve bitkiye ince bir çizgiyle
   *  bağlanıyor; üstte 58 piksel pay var, çünkü orada şeffaf üst bar
   *  (⚙ ve acil durdurma) duruyor. */
  function halkaMerkez(gx, gy, R) {
    var payUst = 58, pay = 10;
    return { x: kis(gx, R + pay, Math.max(R + pay, S.en - R - pay)),
             y: kis(gy, R + payUst, Math.max(R + payUst, S.boy - R - pay)) };
  }
  function eylemCiz(c) {
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
    var gx0 = px(b.x), gy0 = py(b.y);
    var m = halkaMerkez(gx0, gy0, R);
    S.halkaMerkez = m;
    if (Math.hypot(m.x - gx0, m.y - gy0) > 2) {
      /* Halka kaydıysa kime ait olduğu belli olsun. */
      c.save();
      c.strokeStyle = "rgba(226,232,222,.45)"; c.lineWidth = 1.2;
      c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(gx0, gy0); c.lineTo(m.x, m.y); c.stroke();
      c.setLineDash([]);
      c.strokeStyle = "rgba(246,246,240,.7)"; c.lineWidth = 1.6;
      c.beginPath(); c.arc(gx0, gy0, sp.R + 6, 0, 6.3); c.stroke();
      c.restore();
    }
    halkaCiz(c, m.x, m.y, EYLEM, R, S.basiliSula ? "sula" : "", bagli,
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
    if (S.parcalar.length || S.balonlar.length || S.vurgu) return true;
    if (S.veri && S.veri.mesgul) return true;   /* makine çalışırken izliyoruz */
    if (S.film && S.film.oynuyor) return true;  /* zaman çubuğu oynuyor */
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
    filmAdim();
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
    bosYerCiz(c);
    ekimCiz(c);
    makineCiz(c, evre("ray"));
    suCiz(c);
    suNedenYok(c);
    calisanAletCiz(c);
    vurguCiz(c);
    eylemCiz(c);
    if (S.insaBitti) { rayCiz(c); rafCiz(c); gorevCiz(c); sagSutunCiz(c); }
    /* KÜNYE EN ÜSTTE ÇİZİLİYOR — tabelalardan SONRA.
       Önce tabelalardan önce çiziliyordu ve Ölçümler tabelası kartın
       üstüne biniyordu: satırlar yarım kalıyor, kartın ne yazdığı
       okunmuyordu. Kart kullanıcının O AN dokunduğu şey; ambiyans
       tabelası onun üstüne çıkmamalı. */
    kartCiz(c);
    balonCiz(c);
    atmosferCiz(c, dt);
    bulutCiz(c, dt);
    isikCiz(c);
    parcaCiz(c);
    tasimaCiz(c);
    ekimOturumCiz(c);
    zilCiz(c);
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
  /* ==================================================================== *
   * SAHNEDEKİ KAMERA KUTULARI
   *
   * Yüzen kamera kutuları `app.js`in; bahçe onları yalnız AÇIP
   * KAPATIYOR, kendi kopyasını yapmıyor. Bahçeye bakarken kutular
   * yatağın bir köşesini örtüyordu, o yüzden bahçe açılırken
   * kapanıyorlar — ama kullanıcının kendi ayarı unutulmuyor: sekmeden
   * çıkınca ne bıraktıysa o geri geliyor.
   * ==================================================================== */
  //: Bahçeye girmeden önceki görünürlük: {ad: gizliMiydi}
  var kamOnceki = null;

  function kamAdlari() {
    var p = P();
    return ((p.kamListe && p.kamListe()) || []).map(function (k) { return k.ad; });
  }
  function kamGizli(ad) {
    /* Öznitelik `data-kam` (bkz. app.js, `kutu.dataset.kam = ad`). */
    var kutu = document.querySelector('.kamera-yuzen[data-kam="' + ad + '"]');
    if (kutu) return kutu.classList.contains("gizli");
    var p = P();
    return !!(p.S && p.S.kamKutuKapali && p.S.kamKutuKapali[ad]);
  }
  function kamAcikMi() {
    return kamAdlari().some(function (ad) { return !kamGizli(ad); });
  }
  function kamDugmeYaz() {
    var d = $("#bh-kam");
    if (!d) return;
    var acik = kamAcikMi();
    d.setAttribute("aria-pressed", acik ? "true" : "false");
    d.classList.toggle("etkin", acik);
  }
  /** Hepsini aç ya da kapat. `sessiz` bahçeye girerken günlüğü susturuyor. */
  function kamHepsi(goster, sessiz) {
    var p = P();
    /* Panelde kutu anahtarı yoksa sessizce "kapalı" demek yanlış olur:
       yapılmadığını söyleyebilmek için false dönüyor. */
    if (!p.kamKutusuAcKapa) return false;
    kamAdlari().forEach(function (ad) { p.kamKutusuAcKapa(ad, goster, sessiz); });
    kamDugmeYaz();
    return true;
  }
  /** Bahçe açılırken: hâli sakla, kutuları kapat. */
  function kamBahceyeGir() {
    var p = P();
    if (!p.kamKutusuAcKapa) return;
    if (kamOnceki === null) {
      kamOnceki = {};
      kamAdlari().forEach(function (ad) { kamOnceki[ad] = kamGizli(ad); });
    }
    kamHepsi(false, true);
  }
  /** Bahçeden çıkarken: kullanıcının kendi ayarı geri. */
  function kamBahcedenCik() {
    var p = P();
    if (!p.kamKutusuAcKapa || !kamOnceki) return;
    Object.keys(kamOnceki).forEach(function (ad) {
      p.kamKutusuAcKapa(ad, !kamOnceki[ad], true);
    });
    kamOnceki = null;
  }

  /** Başlığın sağ grubunun GERÇEKTEN kapladığı yer — üst şeride pay.
   *
   *  Sabit bir sayı iki kere yanlış oluyordu: grubun genişliği "⏻ Aç"
   *  ile "⏻ Kapat" arasında değişiyor, ve şeride bir düğme eklendiğinde
   *  eski pay sessizce yetmez oluyor (koordinat düğmesi eklenince ⟳
   *  düğmesi "⏻ Kapat"ın altında kaldı). Ölçmek ikisini de çözüyor.
   */
  function sagPayOlc() {
    if (!S.acik) return;
    var sag = document.querySelector(".ust-sag");
    if (!sag) return;
    var r = sag.getBoundingClientRect();
    if (!r.width) return;
    /* Sol kenarından ölçülüyor, genişliğinden değil: grup sağa yaslı ve
       aradaki boşluk da payın parçası. +16 şeritle grup arasındaki
       görünür aralık. */
    var pay = Math.ceil(window.innerWidth - r.left) + 16;
    /* TAVAN YOK — DENENDİ VE GERİ ALINDI. Payı şeridin %45'iyle
       sınırlamak telefonda mantıklı görünüyordu (430 px'de grup 303 px
       istiyor), ama ölçüldü: tavan konunca "⏻ Kapat" koordinat
       düğmesinin üstüne bindi (83x26 px) — yani tam da bu ölçümün
       önlemeye çalıştığı şey geri geldi. Payı kısmak yerine şeridin
       sarmasına bırakıyoruz: sarınca şerit uzuyor, ama hiçbir düğme
       ötekinin altında kalmıyor. Üst üste binmiş iki düğme, bir satır
       daha uzamış bir şeritten kötü. */
    document.documentElement.style.setProperty("--bh-sag-pay", pay + "px");
  }

  var olcuKur = guvenli("ölçü", function () {
    sagPayOlc();
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
   * ZİL — ÜST ŞERİDİN TEK BİLDİRİMİ
   *
   * Şeritteki uzun cümle kalktı; yerine rozetli bir zil var. Rozetteki
   * sayı UYDURMA DEĞİL: sunucunun açık kartları (ertelenmişler hariç).
   * Zile dokununca hepsi tek listede açılıyor — tabelada üç satır
   * gösteriliyor, burada hepsi, gerekçesiyle ve kendi düğmesiyle.
   * ==================================================================== */
  function zilSayi() {
    return acikKartlar().filter(function (k) { return !k.ertelendi; }).length;
  }
  function zilKur() {
    if ($("#bh-zil")) return;
    var ust = document.querySelector("#bh-kok .bh-ust");
    if (!ust) return;
    var d = document.createElement("button");
    d.type = "button"; d.id = "bh-zil"; d.className = "bh-zil";
    d.title = "Bugünün işleri";
    d.setAttribute("aria-label", "Bugünün işleri");
    d.setAttribute("aria-expanded", "false");
    d.innerHTML = '<span aria-hidden="true">🔔</span>'
      + '<span class="bh-rozet" id="bh-rozet" hidden>0</span>';
    d.addEventListener("click", function () {
      S.zilAcik = !S.zilAcik;
      d.setAttribute("aria-expanded", S.zilAcik ? "true" : "false");
      Ses.uyandir(); Ses.tik();
      isteKare();
    });
    /* ZİL DURUM YAZISININ YANINDA. Şeridin sağ ucuna konunca (ölçüldü:
       x=1216) yüzen başlık kümesinin altında kalıyor ve gerçek fare
       tıklaması `#d-enable`e gidiyordu; ayrıca "Hazır"dan kopuk
       duruyordu. `#bh-makine`nin hemen ardına giriyor. */
    var mak = $("#bh-makine");
    if (mak && mak.parentNode) mak.parentNode.insertBefore(d, mak.nextSibling);
    else ust.appendChild(d);
  }
  function zilYaz() {
    var r = $("#bh-rozet");
    if (!r) return;
    var n = zilSayi();
    r.textContent = n > 99 ? "99+" : String(n);
    r.hidden = n === 0;
  }
  /** Zilin listesi: bütün açık kartlar, gerekçesiyle ve düğmesiyle. */
  function zilCiz(c) {
    if (!S.zilAcik) { S.zilSatir = []; return; }
    var liste = acikKartlar().map(function (k) {
      return gorevSatirYap(k);
    });
    /* Zil listesi de sol oluğa sığıyor: 380 px genişken yatağın sol
       kenarını örtüyordu (ölçüldü: 1500 px'de 15 px taşma). */
    var ol = solOluk(200, 360);
    var w = Math.min(360, Math.max(200, ol.sag - 8)), sh = 52;
    var h = 46 + Math.max(1, liste.length) * sh + 10;
    if (h > S.boy - 24) h = S.boy - 24;
    /* ZİLİN ALTINDAN AÇILIYOR. Panel sağ uçta duruyordu; zil durum
       yazısının yanına taşınınca açılan liste bambaşka bir köşede
       çıkıyordu. Zilin DOM kutusunu tuvale göre okuyup oradan
       hizalıyoruz; zil yoksa eski sağ uç. */
    var enSag = Math.max(8, ol.sag - w);
    var x = kis(8, 8, enSag), y = 10;
    var zd = $("#bh-zil"), tv = S.tuval;
    if (zd && tv) {
      var zr = zd.getBoundingClientRect(), tr = tv.getBoundingClientRect();
      x = kis(zr.left - tr.left - 6, 8, enSag);
    }
    S.zilKutu = { x: x, y: y, w: w, h: h };
    c.save();
    c.fillStyle = "rgba(0,0,0,.45)";
    c.beginPath();
    if (c.roundRect) c.roundRect(x + 3, y + 5, w, h, 14); else c.rect(x + 3, y + 5, w, h);
    c.fill();
    var g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "rgba(33,38,31,.98)"); g.addColorStop(1, "rgba(23,27,21,.98)");
    c.fillStyle = g;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, 14); else c.rect(x, y, w, h);
    c.fill();
    c.strokeStyle = "rgba(150,170,140,.5)"; c.lineWidth = 1.2; c.stroke();
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.font = "700 13px system-ui,sans-serif"; c.fillStyle = "#eef2e8";
    c.fillText("Bugünün işleri", x + 14, y + 24);
    c.font = "10px system-ui,sans-serif"; c.fillStyle = "rgba(201,206,196,.65)";
    c.fillText("sunucunun kararı · satıra dokun, yapılsın", x + 14, y + 38);
    var yy = y + 46, i;
    S.zilSatir = [];
    if (!liste.length) {
      c.font = "italic 12px system-ui,sans-serif";
      c.fillStyle = "rgba(201,206,196,.8)";
      c.fillText("bugün bekleyen iş yok", x + 14, yy + 22);
    }
    for (i = 0; i < liste.length && yy + sh <= y + h; i++) {
      var gv = liste[i];
      var sol = x + 10, gen = w - 20;
      c.fillStyle = "rgba(255,255,255,.05)";
      c.beginPath();
      if (c.roundRect) c.roundRect(sol, yy, gen, sh - 8, 8); else c.rect(sol, yy, gen, sh - 8);
      c.fill();
      /* Düğme sağda: kartın kendi "evet" yazısı. */
      c.font = "600 11px system-ui,sans-serif";
      var dg = gv.evet, dgen = c.measureText(dg).width + 18;
      var dx = sol + gen - dgen - 8, dy = yy + (sh - 8) / 2 - 11;
      c.fillStyle = gv.ertelendi ? "rgba(40,44,38,.8)" : "rgba(52,86,52,.9)";
      c.beginPath();
      if (c.roundRect) c.roundRect(dx, dy, dgen, 22, 11); else c.rect(dx, dy, dgen, 22);
      c.fill();
      c.strokeStyle = gv.ertelendi ? "rgba(226,232,222,.3)" : "rgba(160,214,150,.85)";
      c.lineWidth = 1;
      c.beginPath();
      if (c.roundRect) c.roundRect(dx, dy, dgen, 22, 11); else c.rect(dx, dy, dgen, 22);
      c.stroke();
      c.fillStyle = gv.ertelendi ? "rgba(226,232,222,.55)" : "#d8f0cf";
      c.textAlign = "center"; c.fillText(dg, dx + dgen / 2, dy + 15);
      c.textAlign = "left";
      /* Başlık + gerekçe */
      c.font = "600 12px system-ui,sans-serif";
      c.fillStyle = gv.ertelendi ? "rgba(238,242,232,.5)" : "#eef2e8";
      var enCok = dx - sol - 24;
      var metin = gv.metin;
      while (metin.length > 4 && c.measureText(metin).width > enCok) {
        metin = metin.slice(0, metin.length - 2);
      }
      if (metin !== gv.metin) metin += "…";
      c.fillText(metin, sol + 12, yy + 18);
      if (gv.favori) yildizCiz(c, sol + 16 + c.measureText(metin).width + 8, yy + 14, 6, true);
      if (gv.alt) {
        c.font = "10px system-ui,sans-serif";
        c.fillStyle = "rgba(190,196,186,.8)";
        var alt = gv.alt;
        while (alt.length > 4 && c.measureText(alt).width > enCok) {
          alt = alt.slice(0, alt.length - 2);
        }
        if (alt !== gv.alt) alt += "…";
        c.fillText(alt, sol + 12, yy + 33);
      }
      S.zilSatir.push({ x: sol, y: yy, w: gen, h: sh - 8, gorev: gv });
      yy += sh;
    }
    if (i < liste.length) {
      c.font = "10px system-ui,sans-serif";
      c.fillStyle = "rgba(201,206,196,.7)";
      c.fillText("+" + (liste.length - i) + " iş daha sığmadı", x + 14, y + h - 10);
    }
    c.restore();
  }
  function zilDokun(p) {
    if (!S.zilAcik) return false;
    var i;
    for (i = 0; i < S.zilSatir.length; i++) {
      var k = S.zilSatir[i];
      if (p.x >= k.x && p.x <= k.x + k.w && p.y >= k.y && p.y <= k.y + k.h) {
        S.zilAcik = false;
        var z = $("#bh-zil");
        if (z) z.setAttribute("aria-expanded", "false");
        gorevBasildi(k.gorev, i);
        return true;
      }
    }
    var kt = S.zilKutu;
    if (kt && p.x >= kt.x && p.x <= kt.x + kt.w && p.y >= kt.y && p.y <= kt.y + kt.h) {
      return true;                                /* listenin içi */
    }
    /* Dışarı dokunmak kapatıyor. */
    S.zilAcik = false;
    var z2 = $("#bh-zil");
    if (z2) z2.setAttribute("aria-expanded", "false");
    isteKare();
    return true;
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
  /** Tabelanın satırları: sunucunun kartları, ekrana göre yazılmış.
   *  ÜST SATIR kartın kendi başlığı; ALT SATIR o işi yapmadan önce
   *  bilinmesi gereken şey — hepsi kartın gerçek alanlarından:
   *    sula   → kanıt (ölçülen nem mi, geçen gün mü) + toplam su süresi
   *    nem    → kaç bitkinin HİÇ ölçümü yok
   *    hasat  → hasadı makinenin yapmadığı
   *    ek     → hangi türe göre hesaplandığı
   *  Sayı uydurulmuyor: süre her bitkinin kendi `sulama_saniye` ayarından
   *  toplanıyor, bir tanesi bile eksikse "≈" konmuyor, satır susuyor. */
  /** Bir kartın ekran satırı. Tabela da zil listesi de bunu kullanıyor;
   *  ikisi ayrı yazılsaydı aynı iş iki yerde farklı anlatılırdı. */
  function gorevSatirYap(k) {
    return (function (k) {
      var adlar = (k.noktalar || []).map(String);
      var alt = "";
      if (k.tip === "sula") {
        var sn = 0, bilinen = 0;
        adlar.forEach(function (a) {
          var b = S.ix[a];
          if (b && sayi(b.sulama_saniye, 0) > 0) { sn += sayi(b.sulama_saniye, 0); bilinen++; }
        });
        alt = String(k.kanit || "");
        if (bilinen && bilinen === adlar.length) alt += " · toplam " + sn.toFixed(0) + " sn su";
      } else if (k.tip === "nem") {
        var hic = sayi(k.hic_olcum_adet, 0);
        alt = hic ? hic + " bitkinin hiç ölçümü yok" : "okumalar bayat ya da ödünç";
      } else if (k.tip === "hasat") {
        alt = "toplayan sensin · bu iş kare çeker";
      } else if (k.tip === "ek") {
        alt = k.taban_ad ? ("taban tür: " + k.taban_ad) : "tür seçilmedi";
      }
      if (k.ertelendi) alt = "yarına ertelendi" + (k.ertelendi_yazi ? " · " + k.ertelendi_yazi : "");
      /* Kartın içinde favori bitki varsa satırda yıldız: "favoriler
         üstte" kuralının bahçedeki karşılığı — hangi işin senin
         işaretlediğin bitkilere dokunduğunu gösteriyor. */
      var favAdet = 0;
      adlar.forEach(function (a) { if (Favori.var(a)) favAdet++; });
      return { kimlik: String(k.kimlik), tip: String(k.tip || ""), favori: favAdet,
               metin: String(k.baslik || k.metin || k.tip || "iş"),
               alt: alt, evet: String(k.evet || "Yap"),
               ertelendi: !!k.ertelendi, adet: adlar.length, kart: k };
    }(k));
  }
  function gorevListesi() {
    var n = S.gorevSatirAdet == null ? 3 : S.gorevSatirAdet;
    return acikKartlar().slice(0, n).map(gorevSatirYap);
  }
  function gorevKur() {
    /* Tabela sol çimde, alet askısının üstünde. Yer dar ise çizilmiyor:
       üst şerit zaten aynı kartları yazıyor, iki kez söylemenin anlamı
       yok ve dar ekranda tabela sahneyi yiyor. */
    var ol = solOluk(172, 250);
    if (ol.sag - ol.bas < 172 || S.boy < 320) {
      S.gorevKutu = null; S.gorevSatirAdet = 0;
      S.gorevKalan = acikKartlar().length; S.gorevSatir = [];
      return;
    }
    var w = ol.w;
    var toplam = acikKartlar().length;
    /* TABELA ASKIYA YER BIRAKIYOR — sayı tahmin değil, askının kendi
       ölçüsünden çıkıyor. Eski sabit (`S.boy - 200`) askının gerçek
       boyunu (5 alet = 314 px) bilmiyordu ve tabela onu örtecek kadar
       uzayabiliyordu.
       YÜKSEKLİK KIRPILMIYOR, SATIR SAYISI KISILIYOR. Kutunun boyunu
       kırpmak satırları durdurmuyordu: üç satır çizilmeye devam ediyor,
       sonuncusu puan çubuğunun ve "+N iş" yazısının üstüne biniyordu
       (ekran görüntüsünde "12+ boş yer var" ile "Çiftçi 12 · 8 puan" iç
       içeydi). Artık önce KAÇ SATIR sığdığı bulunuyor, kutu ondan
       türetiliyor; sığmayanlar "+N iş daha" diye yazılıyor. */
    /* ASKIYA YER AYIRMIYOR ARTIK: askı sol kenarda, tabela onun
       sağındaki sütunda — yan yanalar. Tabelanın bütçesi kendi
       sütununun boyu; kartla paylaşıyor (kart altına giriyor). */
    var enCok = S.boy - 28 - (KART_ENAZ + 10);
    var satir = Math.min(3, toplam);
    while (satir > 1 && gorevOlcu(satir) > enCok) satir--;
    if (gorevOlcu(satir) > enCok) satir = gorevOlcu(1) <= S.boy - 28 ? 1 : 0;
    if (satir <= 0) { S.gorevKutu = null; S.gorevSatirAdet = 0;
                      S.gorevKalan = toplam; S.gorevSatir = []; return; }
    S.gorevSatirAdet = satir;
    S.gorevKalan = Math.max(0, toplam - satir);
    S.gorevKutu = { x: ol.x, y: 14, w: w, h: gorevOlcu(satir) };
    /* Dokunma kutuları ÇİZİMDEN BAĞIMSIZ: kare atlandığında da satıra
       dokunuş nereye geldiğini bilsin. */
    S.gorevSatir = gorevSatirKutular(S.gorevKutu, gorevListesi());
  }
  /** Tabela KARE BAŞINA DEĞİL, içeriği değişince çiziliyor: ahşap
   *  dokusu, gölgesi ve yazıları her karede yeniden üretmek 24 bitkilik
   *  sahnede ölçülen kare süresini boş yere yükseltiyordu. */
  function gorevDamga() {
    var kt = S.gorevKutu;
    if (!kt) return "";
    return kt.x + "x" + kt.y + "x" + kt.w + "x" + kt.h + "|" + XP.puan + "|"
      + S.gorevKalan + "|"
      + gorevListesi().map(function (g) {
          return g.kimlik + (g.ertelendi ? "e" : "") + g.metin + "|" + g.alt + "|"
            + g.evet + "|" + g.favori;
        }).join(";");
  }
  /** Dokunma kutuları: tabela önbellekten basılsa bile satırların yeri
   *  her karede biliniyor, yoksa dokunuş nereye geldiğini bilemezdi. */
  function gorevSatirKutular(kt, liste) {
    var kutular = [], yy = kt.y + 58;
    liste.forEach(function (gv) {
      kutular.push({ x: kt.x + 10, y: yy, w: kt.w - 20, h: GOREV_SATIR - 8, gorev: gv });
      yy += GOREV_SATIR;
    });
    return kutular;
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
  /** Satır yüksekliği iki satır yazı + dokunma payı. Tabelanın boyu
   *  satır sayısına göre; sabit 132 pikselde üç iş sığmıyordu ve yazılar
   *  "19 bitkinin nemi bilinmiy…" diye kesiliyordu. */
  var GOREV_SATIR = 46;
  function gorevOlcu(adet) { return 58 + Math.max(1, adet) * GOREV_SATIR + 34; }
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

    c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.font = "700 12px system-ui,sans-serif";
    c.fillStyle = "#f3e3c6";
    c.fillText("Bugünün işleri", kt.x + 12, kt.y + 20);
    c.font = "10px system-ui,sans-serif";
    c.fillStyle = "rgba(243,227,198,.65)";
    c.fillText("sunucunun kararı · dokun, yap", kt.x + 12, kt.y + 33);
    c.strokeStyle = "rgba(255,226,178,.16)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(kt.x + 8, kt.y + 42);
    c.lineTo(kt.x + kt.w - 8, kt.y + 42); c.stroke();

    var yy = kt.y + 58;
    if (!liste.length) {
      c.font = "italic 11px system-ui,sans-serif";
      c.fillStyle = "rgba(243,227,198,.8)";
      c.fillText("bugün bekleyen iş yok", kt.x + 12, yy + 16);
    }
    liste.forEach(function (gv) {
      var sol = kt.x + 10, gen = kt.w - 20;
      /* Dokunulabilir satır: hafif bir zemin + sağda işin düğmesi. */
      c.fillStyle = "rgba(255,235,200,.06)";
      c.beginPath();
      if (c.roundRect) c.roundRect(sol, yy, gen, GOREV_SATIR - 8, 8);
      else c.rect(sol, yy, gen, GOREV_SATIR - 8);
      c.fill();
      /* Kutu: ertelenmiş iş çizili ve solgun — yapılmadı, bekliyor. */
      c.strokeStyle = gv.ertelendi ? "rgba(243,227,198,.4)" : "rgba(243,227,198,.8)";
      c.lineWidth = 1.4;
      c.beginPath();
      if (c.roundRect) c.roundRect(sol + 8, yy + 8, 11, 11, 3);
      else c.rect(sol + 8, yy + 8, 11, 11);
      c.stroke();

      /* Düğme İKİNCİ SATIRDA, sağda: birinci satırda dururken başlığa
         yalnız 97 piksel kalıyordu ve "19 bitkinin nemi bilinmiy…" diye
         kesiliyordu. Alt satır kısa, başlık uzun — yer oraya yakışıyor. */
      c.font = "600 10px system-ui,sans-serif";
      var dg = gv.evet, dgen = c.measureText(dg).width + 14;
      var dx = sol + gen - dgen - 6, dy = yy + GOREV_SATIR - 27;
      c.fillStyle = gv.ertelendi ? "rgba(40,30,16,.5)" : "rgba(52,86,52,.85)";
      c.beginPath();
      if (c.roundRect) c.roundRect(dx, dy, dgen, 18, 9); else c.rect(dx, dy, dgen, 18);
      c.fill();
      c.strokeStyle = gv.ertelendi ? "rgba(243,227,198,.3)" : "rgba(160,214,150,.8)";
      c.lineWidth = 1;
      c.beginPath();
      if (c.roundRect) c.roundRect(dx, dy, dgen, 18, 9); else c.rect(dx, dy, dgen, 18);
      c.stroke();
      c.fillStyle = gv.ertelendi ? "rgba(243,227,198,.5)" : "#d8f0cf";
      c.textAlign = "center";
      c.fillText(dg, dx + dgen / 2, dy + 12.5);
      c.textAlign = "left";

      /* Başlık — düğmeye kadar olan yere sığdırılıyor, kesiliyorsa
         sonunda üç nokta var ama yer önce SONUNA KADAR kullanılıyor. */
      var enCok = gen - 34;
      c.font = "600 11.5px system-ui,sans-serif";
      c.fillStyle = gv.ertelendi ? "rgba(243,227,198,.45)" : "#f6e8cf";
      var metin = gv.metin;
      while (metin.length > 4 && c.measureText(metin).width > enCok) {
        metin = metin.slice(0, metin.length - 2);
      }
      if (metin !== gv.metin) metin += "…";
      c.fillText(metin, sol + 26, yy + 14);
      if (gv.favori) {
        var mgen = c.measureText(metin).width;
        yildizCiz(c, sol + 26 + mgen + 10, yy + 10, 6, true);
        if (gv.favori > 1) {
          c.font = "9px ui-monospace,monospace";
          c.fillStyle = "rgba(246,196,86,.85)";
          c.fillText("×" + gv.favori, sol + 26 + mgen + 18, yy + 14);
        }
      }
      if (gv.ertelendi) {
        c.strokeStyle = "rgba(243,227,198,.45)"; c.lineWidth = 1;
        var mg = c.measureText(metin).width;
        c.beginPath(); c.moveTo(sol + 26, yy + 10);
        c.lineTo(sol + 26 + mg, yy + 10); c.stroke();
      }
      /* Alt satır: işi yapmadan önce bilinmesi gereken. */
      if (gv.alt) {
        c.font = "10px system-ui,sans-serif";
        c.fillStyle = "rgba(243,227,198,.62)";
        var alt = gv.alt;
        var altEnCok = dx - (sol + 26) - 8;
        while (alt.length > 4 && c.measureText(alt).width > altEnCok) {
          alt = alt.slice(0, alt.length - 2);
        }
        if (alt !== gv.alt) alt += "…";
        c.fillText(alt, sol + 26, yy + 27);
      }
      yy += GOREV_SATIR;
    });

    /* SIĞMAYAN İŞ SESSİZCE KAYBOLMUYOR: kaç tane gösterilemediği yazılı;
       hepsine üst şeritteki oklardan ulaşılıyor. */
    if (S.gorevKalan > 0) {
      c.font = "10px system-ui,sans-serif";
      c.fillStyle = "rgba(243,227,198,.7)";
      c.fillText("+" + S.gorevKalan + " iş daha · üst şeritteki oklarla",
        kt.x + 12, kt.y + kt.h - 34);
    }
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
  /* Ölçüm bu süreden eskiyse bağlantı kopmuş sayılıyor. Ölçüm normalde
     saniyeler aralıkla geliyor; beş dakika sessizlik kaza değil. */
  var OLCUM_BAYAT_SN = 300;
  /** Yaşı okunur yazıya çevirir — saat ve gün de yazıyor.
   *  Önce yalnız "sn" ve "dk" vardı; 38 saatlik bir okuma "2280 dk önce"
   *  diye çıkıyordu ve kimse o sayıyı gün olarak okumuyordu. */
  function yasYazi(sn) {
    if (sn < 90) return sn + " sn önce";
    if (sn < 5400) return Math.round(sn / 60) + " dk önce";
    if (sn < 172800) return Math.round(sn / 3600) + " saat önce";
    return Math.round(sn / 86400) + " gün önce";
  }
  var olcumAl = guvenli("ölçüm", function () {
    return api("/api/durum").then(function (c) {
      S.olcumVeri = (c && c.olcum) || null;
      /* YAŞ ÖLÇÜMÜN KENDİ ZAMANINDAN, İSTEĞİN ZAMANINDAN DEĞİL.
         Burada `Date.now()` yazıyordu: panel ne zaman sorduysa o
         yazılıyor ve okuma kaç saatlik olursa olsun "8 sn önce" diye
         görünüyordu. Sahada bunun bedeli ödendi — Arduino 38 saat
         boyunca susmuş, panel taze değer gösterdiği için kimse fark
         etmemişti. Ölçüm paketi kendi `ts`sini taşıyor; sunucu açılışta
         veritabanındaki son kaydı da `ts`siyle birlikte koyuyor. */
      var ts = Number(S.olcumVeri && S.olcumVeri.ts);
      S.olcumT = (isFinite(ts) && ts > 0) ? ts * 1000 : 0;
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
    /* SON SULAMA BURADA, alt şeritte değil: bir ölçüm ve yeri
       ölçümlerin yanı. Altta sabit bir satır olarak duruyordu ve
       ekranın altından yer yiyordu. Kayıt yoksa satır da yok —
       "bilinmiyor" yazmak boş yere bir satır açmak olurdu. */
    var ss = sonSulama();
    if (ss) cikti.push({ ad: "Son sulama", deger: sureKisa(ss.yas) + " önce" });
    return cikti;
  }
  /* ==================================================================== *
   * SAĞ KONTROL PANELİ — ÜÇ PARÇA TEK SÜTUNDA
   *
   * Ölçüm tahtası sağ üstte, sepet ortada çimde, yön tuşları sağ altta
   * ayrı ayrı duruyordu: üçü de "sağ tarafta bir şeyler" gibi
   * okunuyordu, hizaları tutmuyordu ve aralarındaki boşluk ekran boyuna
   * göre değişiyordu. Artık hepsi SAĞ KENARA YAPIŞIK tek bir dikey
   * panelin bölümleri: aynı genişlik, aynı sol kenar, aralarında aynı
   * çizgi.
   *
   * SIRA, ÜSTTEN ALTA: ölçümler (bilgi) · hasat sepeti (hedef) ·
   * durum çubuğu (makine ne diyor) · yön tuşları (elle sürme).
   * Yön tuşları panelin ALTINA sabit: parmağın en rahat vardığı yer ve
   * ekran kısaldıkça yukarıdaki bilgi bölümleri düşüyor, tuşlar değil.
   *
   * SIĞMAZSA NE DÜŞER: yer önce SEPETE veriliyor (bırakma hedefi;
   * ölçümlerin aynısı İzle sekmesinde de var). Sepet sığmıyorsa artan
   * yer ölçümlere gidiyor — ölçüm bölümü daha kısa (en az 74 px), yani
   * sepetin sığmadığı boşlukta o hâlâ sığabiliyor; boş bırakmaktansa
   * dolsun. Durum çubuğu ile tuşlar hiç düşmüyor: tuşların yerine
   * koyacak bir şey yok ve kilitli bir tuşun sebebi yazmıyorsa makine
   * bozuk sanılıyor. Ölçülen sınırlar (24 bitki, kap içi):
   *   820x470 → tuşlar+durum+ölçüm · 900x520 → tuşlar+durum+sepet
   *   1100x620 ve üstü → dördü birden.
   * ==================================================================== */
  var SP_PAY = 10;          /* panelin ekran kenarına payı */
  var SP_IC = 12;           /* panel içi kenar payı */
  var SP_ARA = 10;          /* bölümler arası */
  var SP_JOG = 132;         /* yön tuşu panosu (kare) */
  var SP_ZUST = 40;         /* Z tuşları panonun üstünde: yer payı */
  var SP_SEPET = 94;        /* sepet + "Hasat" etiketi */
  var SP_DURUM = 46;        /* durum çubuğu */
  var SP_OLCUM_ENAZ = 74;   /* başlık + tazelik + bir satır */
  var SP_OLCUM_ENCOK = 132;
  var SP_ALT_YAZI = 18;     /* "basılı tut" satırı için alt pay */
  /* ==================================================================== *
   * SOL OLUK — KENARA YAPIŞAN KARTLARIN YERİ
   *
   * Yatak (vizör) tuvalin ortasında ve iki yanında çim kalıyor. Sağ
   * oluk kontrol panelinin; kartlar (bitki künyesi, ekim oturumu, zil
   * listesi) SOL oluğa yapışıyor. Hiçbiri yatağın üstüne düşmüyor:
   * ölçüm betiği (`vizor.js`) her kartın dikdörtgenini yatağınkiyle
   * kesiştiriyor ve kesişme sıfır olmak zorunda.
   *
   * OLUK İKİ SÜTUN: en solda askı (sol kenara yapışık, 50 px), onun
   * sağında kart sütunu. Böylece kart açıkken askı ve görev tabelası
   * örtülmüyor — eskiden kart ikisinin de üstüne biniyordu. Askı ile
   * tabela artık dikey yer için yarışmıyor (yan yanalar), o yüzden
   * tabela üç satırını daha sık koruyor.
   * ==================================================================== */
  /* 12 px: askı tahtası aletin 9 px solundan başlıyor, 8'de tahtanın
     kenarı tuvalin dışında kalıyordu (ölçüldü: -1 px). */
  var ASKI_X = 12;
  /* Kart sütunda tabelanın ALTINA giriyor: tabela kendi boyunu keserken
     karta bu kadar yer bırakıyor (başlık + iki satır). */
  var KART_ENAZ = 120;
  function solOluk(enAz, enCok) {
    /* Askının EN GENİŞ hâli (RAY_GEN) ile hesaplanıyor, o anki hâliyle
       değil: `gorevKur` askıdan ÖNCE çalışıyor ve bir önceki karenin
       genişliğini okumak, pencere boyutu değişirken bir kare boyunca
       yanlış sütun demekti. Askı daralırsa sütun yalnız biraz geç
       başlar; hiçbir zaman askının üstüne binmez. */
    var bas = ASKI_X + RAY_GEN + 10;
    var sag = Math.max(bas + 120, G.ox - 10);
    var w = kis(sag - bas, enAz || 150, enCok || 260);
    /* KART ŞERİDİN ORTASINDA. Sola dayalıyken askının hemen dibinde
       duruyor, sağında da yatağa kadar boş çim kalıyordu — kutu
       şeridin içinde kaymış görünüyordu. Artan yer iki yana eşit
       bölünüyor; kutu şeridi dolduruyorsa hiçbir şey değişmiyor. */
    var x = bas + Math.max(0, (sag - bas - w) / 2);
    return { x: x, w: w, bas: bas, sag: sag, askiSag: ASKI_X + RAY_GEN };
  }
  function sagSutunKur() {
    S.sensorKutu = null; S.sepet = null; S.durumKutu = null;
    S.jog = null; S.sagSutun = null;
    if (S.boy < 260) return;
    var sagBos = S.en - (G.ox + G.bw + G.kal + G.ray + 12);
    var w = kis(Math.min(200, sagBos - 16), SP_JOG + 12, 200);
    var x = S.en - SP_PAY - w;
    var ust = SP_PAY, alt = S.boy - SP_PAY;
    var icBoy = alt - ust;
    var jogBlok = SP_ZUST + SP_JOG + SP_ALT_YAZI;
    if (icBoy < jogBlok + SP_DURUM + SP_ARA) return;   /* tuşlar bile sığmıyor */
    S.sagSutun = { x: x, y: ust, w: w, h: icBoy };

    /* ALTTAN YUKARI: yön tuşları en altta (parmağın vardığı yer),
       üstünde durum tahtası. */
    var jy = alt - SP_ALT_YAZI - SP_JOG;
    var dy = jy - SP_ZUST - SP_DURUM - 6;
    S.durumKutu = { x: x, y: dy, w: w, h: SP_DURUM };

    var kalan = dy - SP_ARA - ust;
    var sepetVar = kalan >= SP_SEPET + SP_ARA;
    if (sepetVar) kalan -= SP_SEPET + SP_ARA;
    var olcumBoy = kalan >= SP_OLCUM_ENAZ
      ? Math.min(SP_OLCUM_ENCOK, kalan) : 0;

    var yy = ust;
    if (olcumBoy > 0) { S.sensorKutu = { x: x, y: yy, w: w, h: olcumBoy };
                        yy += olcumBoy + SP_ARA; }
    if (sepetVar) {
      /* Sepet çimin üstünde, sütunun ortasına hizalı: kendi gölgesi ve
         etiketi var, bir kutunun içinde değil. */
      var bos = dy - SP_ARA - yy;
      S.sepet = { x: x + w / 2 - 36, y: yy + Math.max(0, (bos - SP_SEPET) / 2),
                  w: 72, h: 80 };
    }
    jogYerlestir(x + w / 2 - SP_JOG / 2, jy);
  }
  /** Tuş yerleri — panelin verdiği köşeden. */
  function jogYerlestir(x, y) {
    var gen = SP_JOG, orta = gen / 2;
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
  }
  /** Sağ sütun: üç ayrı parça, TEK KOLONA HİZALI.
   *  Tek büyük koyu panel denendi ve bahçeden kopuk duruyordu; bahçenin
   *  kendi dili ahşap tabela. Parçalar yine ayrı ayrı çiziliyor ama
   *  aynı x'te, aynı genişlikte ve aynı aralıkla — dağınıklık
   *  hizasızlıktandı, kutu eksikliğinden değil. */
  function sagSutunCiz(c) {
    if (!S.sagSutun) return;
    sensorCiz(c);
    sepetCiz(c);
    durumCiz(c);
    jogCiz(c);
  }
  /** Ahşap tahta gövdesi — görev tabelasıyla aynı malzeme. */
  function tahtaKutu(c, kt, direk) {
    c.fillStyle = "#6b4a2c";
    if (direk) c.fillRect(kt.x + kt.w / 2 - 4, kt.y + kt.h - 4, 8, 16);
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
  }
  function sensorCiz(c) {
    var kt = S.sensorKutu;
    if (!kt) return;
    var satir = olcumSatirlari();
    c.save();
    /* AHŞAP TABELA GERİ GELDİ: görev tabelasının kardeşi. Koyu düz bir
       bölüm olarak çizilince bahçenin malzemesinden kopuyordu. */
    tahtaKutu(c, kt, true);
    c.textAlign = "left";
    c.font = "700 12px system-ui,sans-serif"; c.fillStyle = "#f3e3c6";
    c.fillText("Ölçümler", kt.x + 12, kt.y + 20);

    var yas = S.olcumT ? Math.round((Date.now() - S.olcumT) / 1000) : -1;
    /* BAYAT OKUMA GÖRÜNÜR OLUYOR. Sensör susunca ekranda son değer
       kalıyor ve taze değerden ayırt edilemiyorsa yanlış karar
       verdiriyor. Sınır 300 sn: ölçüm normalde saniyeler aralıkla
       geliyor, beş dakika sessizlik bağlantının koptuğu anlamına
       geliyor. */
    var bayat = yas > OLCUM_BAYAT_SN;
    c.font = (bayat ? "700 10px " : "10px ") + "system-ui,sans-serif";
    c.fillStyle = bayat ? "#ffb9a6" : "rgba(243,227,198,.6)";
    c.fillText(yas < 0 ? "ölçüm zamanı bilinmiyor"
      : (yasYazi(yas) + (bayat ? " · SENSÖR SUSMUŞ" : "")),
      kt.x + 12, kt.y + 33);

    var yy = kt.y + 54;
    if (!satir.length) {
      c.font = "italic 11px system-ui,sans-serif";
      c.fillStyle = S.olcumHata ? "#ffb9a6" : "rgba(243,227,198,.8)";
      var m = S.olcumHata || "ölçüm paketi gelmedi";
      c.fillText(m.length > 30 ? m.slice(0, 29) + "…" : m, kt.x + 12, yy);
    }
    /* SATIR SAYISI KUTUNUN BOYUNDAN ÇIKIYOR: panel kısaldığında dört
       satır çizilip alttaki bölümün üstüne binmesin. */
    var sigan = Math.max(0, Math.floor((kt.y + kt.h - 10 - yy + 6) / 19));
    satir.slice(0, sigan).forEach(function (r) {
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
    if (satir.length > sigan) {
      c.font = "10px system-ui,sans-serif";
      c.fillStyle = "rgba(243,227,198,.55)";
      c.fillText("+" + (satir.length - sigan) + " ölçüm · İzle sekmesinde",
        kt.x + 12, kt.y + kt.h - 8);
    }
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
  /** Tuşlar neden kilitli? Tek cümlede sebep — ya da boş. */
  function jogKilit() {
    if (!(S.veri && S.veri.bagli)) return "makine bağlı değil";
    if (S.acil) return "acil durdurma mandalı düştü";
    if (!S.enable) return "sürücü torku kapalı (Ayarlar > Enable)";
    return "";
  }
  /* ==================================================================== *
   * DURUM ÇUBUĞU — MAKİNE NE DİYOR
   *
   * Konum satırı ve kilit sebebi tuşların çevresine serpilmişti: konum
   * üstte küçük gri bir satır, sebep altta dokuz punto. İkisi de bu
   * ekranın en çok okunan bilgisi ve ikisi de tuşların "etrafında"
   * duruyordu. Artık tuşların ÜSTÜNDE, kendi zemini olan bir çubukta;
   * tuş alanında yalnız tuşlar var.
   *
   * IŞIK UYDURULMUYOR: yeşil = bağlı, tork açık, acil mandalı yukarıda
   * (yani tuşlar gerçekten çalışır); kırmızı = kilidin sebebi yanında
   * yazılı. Konum, makinenin BİLDİRDİĞİ sayı; bildirmemişse yerine
   * tahmin konmuyor, "konum bildirilmedi" yazıyor.
   * ==================================================================== */
  function durumCiz(c) {
    var kt = S.durumKutu;
    if (!kt) return;
    var kilit = jogKilit();
    c.save();
    /* Durum da ahşap tabelada: ölçüm tahtasıyla aynı malzeme, aynı
       genişlik, aynı kolon. */
    tahtaKutu(c, kt, false);
    c.fillStyle = kilit ? "#e07f6a" : "#7bbf5a";
    c.beginPath(); c.arc(kt.x + 15, kt.y + 16, 4.2, 0, 6.3); c.fill();

    var m = S.makine, konumVar = !!(m && m.x != null && S.konumVar);
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.font = konumVar ? "600 13px ui-monospace,monospace" : "italic 12px system-ui,sans-serif";
    c.fillStyle = konumVar ? "#f3e3c6" : "rgba(243,227,198,.72)";
    c.fillText(konumVar
      ? ("X " + Math.round(m.x) + "  Y " + Math.round(m.y)
         + (m.z == null ? "" : "  Z " + Math.round(m.z)))
      : "konum bildirilmedi", kt.x + 26, kt.y + 20);
    c.font = "10px system-ui,sans-serif";
    c.fillStyle = kilit ? "#ffb9a6" : "rgba(243,227,198,.7)";
    /* Kısa cümle: tabela ~190 px ve 10 punto ile ~34 karakter alıyor.
       Uzun hâli ("hepsini home'a gönderir") kesiliyordu. */
    var alt = kilit || "basılı tut · ⌂ = hepsi home'a";
    if (alt.length > 34) alt = alt.slice(0, 33) + "…";
    c.fillText(alt, kt.x + 12, kt.y + 37);
    c.restore();
  }
  /** Yön tuşları — YALNIZ TUŞLAR. Konum ve kilit sebebi durum
   *  tahtasında; burada kumandanın kendisi var. */
  function jogCiz(c) {
    var j = S.jog;
    if (!j) return;
    var kilit = jogKilit();
    c.save();
    /* Kumanda panosu: bahçenin ahşabı değil, MAKİNENİN kutusu — ayrı
       malzeme olması kasıtlı, bu bölüm bahçeye değil makineye
       dokunuyor. Sütunun genişliğinde, ötekilerle aynı x'te. */
    var pw = S.sagSutun ? S.sagSutun.w : j.w;
    var px0 = S.sagSutun ? S.sagSutun.x : j.x;
    var py0 = j.y - SP_ZUST, ph = SP_ZUST + j.h + 8;
    c.fillStyle = "rgba(0,0,0,.34)";
    c.beginPath();
    if (c.roundRect) c.roundRect(px0 + 3, py0 + 5, pw, ph, 14);
    else c.rect(px0 + 3, py0 + 5, pw, ph);
    c.fill();
    var pg = c.createLinearGradient(px0, py0, px0, py0 + ph);
    pg.addColorStop(0, "rgba(46,52,46,.96)"); pg.addColorStop(1, "rgba(26,30,26,.96)");
    c.fillStyle = pg;
    c.beginPath();
    if (c.roundRect) c.roundRect(px0, py0, pw, ph, 14); else c.rect(px0, py0, pw, ph);
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
      onayAc("Bütün eksenler home'a gidiyor.",
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
  /* ASKI ÖLÇÜLERİ TEK YERDE. Hem askıyı kuran `rayKur` hem de ona yer
     bırakması gereken görev tabelası bunları okuyor; iki yerde iki sayı
     tutmak, alet sayısı değiştiğinde birinin sessizce yanılması demekti. */
  var RAY_GEN = 50, RAY_ARA = 16;
  var RAY_TABELA_ARA = 34;   /* tabelanın altı ile ilk alet arası */
  /* ASKININ ALTINDAKİ YUVARLAK SIRA: askıdan 16 px aşağıda, çapı 30;
     artı 8 px kenar payı = 64. Tek düğme (ses) varken 57 idi; sıra dört
     düğmeye çıkınca bu sayı büyüdü — tabela da aynı sabiti okuduğu için
     yer ayırması kendiliğinden düzeliyor. */
  /* İKİ SIRA, İKİ SÜTUN. Dört düğme tek sırada 144 px yer kaplıyordu;
     askı sol kenara yapışınca bu sıra yanındaki kart sütununa
     giriyordu. 2x2 ızgara askının genişliğine (50 px) yakın duruyor. */
  var ALT_DUGME_ARA = 16, ALT_DUGME_R = 13, ALT_DUGME_BOS = 6;
  var RAY_ALT_PAY = ALT_DUGME_ARA + ALT_DUGME_R * 4 + ALT_DUGME_BOS + 8;
  function rayYuksekligi() {
    return RAY_ALET.length * RAY_GEN + (RAY_ALET.length - 1) * RAY_ARA;
  }
  /** Askının SIKIŞMIŞ boyu: `rayKur` yer yetmeyince önce aralığı, sonra
   *  yuvayı 36 pikselin altına inmeden kısıyor. Tabela "hiç sığmıyorum"
   *  demeden önce bu payı da denemeli — yoksa askı küçülerek yer
   *  açabilecekken tabela boş yere düşüyordu (485 px tuvalde oldu). */
  function rayEnAzYukseklik() {
    return RAY_ALET.length * 36 + (RAY_ALET.length - 1) * 4;
  }
  var RAY_ALET = [
    { k: "sula", ad: "Su", renk: "#5aa6e8", ipucu: "bitkiye bırak · sula" },
    { k: "nem", ad: "Nem", renk: "#63c46b", ipucu: "bitkiye bırak · nem ölç" },
    { k: "foto", ad: "Kamera", renk: "#c8ccc4", ipucu: "bitkiye bırak · fotoğraf" },
    { k: "yakin", ad: "Yakın", renk: "#d9b26a", ipucu: "bitkiye bırak · uç kamerası" },
    /* TOHUM: ötekilerden farklı — bitkiye değil BOŞ YERE bırakılıyor.
       Dokununca tohum rafı açılıyor, tür seçilince sunucunun verdiği boş
       yerler toprakta yanıyor. */
    { k: "ek", ad: "Tohum", renk: "#e6d49c", ipucu: "tohum seç · boş yere ek" }
  ];
  function rayKur() {
    var gen = RAY_GEN, ara = RAY_ARA;
    var n = RAY_ALET.length;
    /* SIĞMIYORSA ASKI DARALIYOR, TAŞMIYOR.
       Eski kod sığmayınca askıyı yukarı çekiyordu ve tabelanın üstüne
       biniyordu; tabela ona yer bırakır hâle gelince bu sefer alttan
       taşmaya başladı (ölçüldü: 496 px tuvalde 21 px, 424 px'de 93 px —
       ses düğmesi ekranın dışında kalıyordu).
       Önce ARALIK daralıyor, sonra alet küçülüyor: dokunma hedefi
       aletin kendisi, aradaki boşluk değil. Alt sınır 36 px — altına
       inmek parmakla vurulamayan bir düğme demek. */
    /* ARTIK TABELA İLE YAN YANA: askı sol kenarda, tabela onun sağındaki
       sütunda. Dikey yer için yarışmıyorlar, o yüzden askının bütçesi
       tuvalin tamamı. (Eskiden tabelanın altından başlıyordu.) */
    var yer = S.boy - 12 - RAY_ALT_PAY;
    if (n > 1 && n * gen + (n - 1) * ara > yer) {
      ara = Math.max(4, Math.floor((yer - n * gen) / (n - 1)));
      if (n * gen + (n - 1) * ara > yer) {
        gen = Math.max(36, Math.floor((yer - (n - 1) * ara) / n));
      }
    }
    var top = n * gen + (n - 1) * ara;
    var y0 = Math.max(12, (S.boy - top) / 2);
    var tavan = 12;
    if (y0 < tavan) y0 = tavan;
    /* ALTTAN TAŞMA: ortalanan askı, altındaki yuvarlak sırayı ekranın
       dışına itebiliyordu (ölçüldü: 385 px tuvalde 20 px). Aşağı
       kaydırmak yerine YUKARI çekiyoruz, ama tabelanın altından
       yukarısına asla geçmeden — eski kırpma tam da bu yüzden askıyı
       tabelanın üstüne bindiriyordu. */
    var enAlt = S.boy - RAY_ALT_PAY - top;
    if (y0 > enAlt) y0 = Math.max(tavan, enAlt);
    /* ASKI SOL KENARA YAPIŞIK. Oluğun ortasında duruyordu: sağında
       kalan boşluk hiçbir işe yaramıyordu, kart da oraya sığmıyordu.
       Kenara alınınca yanında tabela ve kart için gerçek bir sütun
       açılıyor. */
    var x = ASKI_X;
    S.ray = RAY_ALET.map(function (a, i) {
      return { k: a.k, ad: a.ad, renk: a.renk, ipucu: a.ipucu,
               x: x, y: y0 + i * (gen + ara), w: gen, h: gen };
    });
    var son2 = S.ray[S.ray.length - 1];
    /* ASKININ ALTINDAKİ YUVARLAKLAR: ses, bahçeyi yeniden kur,
       koordinatla ek, kamera kutuları. Son ikisi üst şeritten indi;
       düğmelerin kendisi `index.html`de duruyor ve burada yalnız
       `click`leri çağrılıyor — davranış tek yerde, ortak dosya
       değişmiyor. */
    var dugmeler = [{ k: "ses" }, { k: "kur" }, { k: "koor" }, { k: "kam" }];
    var rr = ALT_DUGME_R, bosluk = ALT_DUGME_ARA;
    /* Askı tavana dayandıysa (tabela yüzünden aşağı kalmışsa) sıra yine
       de ekranda kalsın: önce araya, sonra yarıçapa dokunuyoruz. 11 px
       altı parmakla vurulamıyor, orada duruyoruz ve taşmayı
       gizlemiyoruz — düğmeler çizilmiyor, sebebi alt şeritte yazıyor. */
    var kalanAlt = S.boy - (son2.y + son2.h) - 6;
    var gerek = bosluk + rr * 4 + ALT_DUGME_BOS;
    if (gerek > kalanAlt) bosluk = Math.max(8, kalanAlt - rr * 4 - ALT_DUGME_BOS);
    if (bosluk + rr * 4 + ALT_DUGME_BOS > kalanAlt) {
      rr = Math.floor((kalanAlt - bosluk - ALT_DUGME_BOS) / 4);
    }
    if (rr < 11) { S.altDugme = []; S.sesDugme = null; S.altDugmeDar = true; }
    else {
      S.altDugmeDar = false;
      var ry = son2.y + son2.h + bosluk;
      var izgaraEn = rr * 4 + ALT_DUGME_BOS;
      var bx = Math.max(4, x + gen / 2 - izgaraEn / 2);
      S.altDugme = dugmeler.map(function (d, i) {
        return { k: d.k,
                 x: bx + (i % 2) * (rr * 2 + ALT_DUGME_BOS),
                 y: ry + Math.floor(i / 2) * (rr * 2 + ALT_DUGME_BOS), r: rr };
      });
    }
    S.sesDugme = S.altDugme.length
      ? { x: S.altDugme[0].x, y: S.altDugme[0].y, r: S.altDugme[0].r } : null;
    /* SEPET ARTIK BURADA DEĞİL: sağ kontrol panelinin bir bölümü
       (`sagSutunKur`). Askı sol sütunu kuruyor, sağ sütuna karışmıyor. */
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
    } else if (k === "ek") {                  /* tohum paketi */
      c.beginPath();
      c.moveTo(cx - 8, cy - 9); c.lineTo(cx + 8, cy - 9);
      c.lineTo(cx + 6, cy + 10); c.lineTo(cx - 6, cy + 10);
      c.closePath(); c.stroke();
      c.beginPath(); c.moveTo(cx - 8, cy - 9); c.lineTo(cx + 8, cy - 9); c.stroke();
      c.beginPath(); c.ellipse(cx - 2, cy + 1, 2.2, 3, 0.5, 0, 6.3); c.fill();
      c.beginPath(); c.ellipse(cx + 3, cy + 5, 2, 2.6, -0.4, 0, 6.3); c.fill();
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
  /* ==================================================================== *
   * EKİM OTURUMU — MAKİNENİN GERÇEKTEN YAPTIĞI SIRA
   *
   * Ekim ekranda "kayıt" değil: `/api/bahce/ek` noktayı yaratıp işi
   * kuyruğa koyuyor, kuyruk `islem:"ek"` ile ekim oturumunu başlatıyor ve
   * makine şu sırayı yürüyor (sunucu: `PARCA_SIRASI`, ajan: `dizi.py`):
   *
   *   hazne → haznenin üstüne gidiyor (güvenli Z'de)
   *   al    → iniyor, TOHUM UCU KENDİ DİKEY EKSENİYLE de iniyor
   *           (`uc_dikey`, `t_asagi_mm`, toprak_t), VAKUM POMPASI AÇILIYOR
   *   taşı  → uç çekiliyor, kalkıyor, hedefe gidiyor
   *           → BURADA DURUYOR VE SORUYOR: "tohum ucta mı?"
   *   ek    → iniyor, tohum ucu iniyor, POMPA KAPANIYOR, çekiyor, kalkıyor
   *   home  → hepsi bitince bir kez
   *
   * Uç seçici servo açısı, tohum ucunun kayması, Z güvenliği ve hazne
   * koordinatlarının sınır denetimi `_ekim_coz` içinde çözülüyor; ekran
   * onların hiçbirini yeniden hesaplamıyor.
   *
   * BU PANELİN İŞİ: oturumu GÖSTERMEK ve makinenin beklediği onayı
   * sormak. Tohum sensörü yok — vakum tohumu tutamazsa yazılım fark
   * etmiyor; "tohum ucta mı" sorusu bu yüzden duruyor ve gizlenmiyor.
   * ==================================================================== */
  var EKIM_ASAMA = [
    { k: "hazne", ad: "hazneye git" },
    { k: "al", ad: "tohumu al" },
    { k: "tasi", ad: "hedefe taşı" },
    { k: "ek", ad: "ek" }
  ];
  var ekimDurumAl = guvenli("ekim durumu", function () {
    return api("/api/ekim/onay").then(function (c) {
      S.ekimOturum = c && c.aktif ? c : null;
      isteKare();
    }).catch(function (h) {
      S.ekimOturum = null;
      notYaz("ekim", "Ekim durumu okunamadı — " + ((h && h.message) || h));
      isteKare();
    });
  });
  function ekimSayacKur() {
    var aktif = !!(S.ekimOturum || ((S.veri && S.veri.ekim) || {}).aktif);
    if (aktif && !S.ekimSayac) {
      /* Yalnız oturum SÜRERKEN yoklama: boştayken istek yok. */
      S.ekimSayac = setInterval(function () {
        if (!S.acik) return;
        ekimDurumAl();
      }, 1500);
    } else if (!aktif && S.ekimSayac) {
      clearInterval(S.ekimSayac); S.ekimSayac = null;
    }
  }
  function ekimOturumCiz(c) {
    var e = S.ekimOturum;
    if (!e || !e.aktif) { S.ekimOnayKutu = null; S.ekimIptalKutu = null; return; }
    /* EKİM PANELİ DE SOL OLUKTA. Ortada, alt şeridin üstünde duruyordu:
       420 px genişliğiyle yatağın tam ortasına oturuyor ve ekimin
       yapıldığı yeri — yani bakılması gereken şeyi — örtüyordu. */
    var ol = solOluk(210, 320);
    var w = ol.w, h = 118;
    var x = ol.x, y = Math.max(14, S.boy - h - 14);
    c.save();
    c.fillStyle = "rgba(0,0,0,.42)";
    c.beginPath();
    if (c.roundRect) c.roundRect(x + 3, y + 5, w, h, 14); else c.rect(x + 3, y + 5, w, h);
    c.fill();
    var g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "rgba(34,40,32,.97)"); g.addColorStop(1, "rgba(24,28,22,.97)");
    c.fillStyle = g;
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, 14); else c.rect(x, y, w, h);
    c.fill();
    c.strokeStyle = e.soru ? "#e0a955" : "rgba(150,180,140,.55)";
    c.lineWidth = e.soru ? 2 : 1.2; c.stroke();

    c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.font = "700 12.5px system-ui,sans-serif"; c.fillStyle = "#eef2e8";
    var bas = "Ekim" + (e.toplam ? " · " + e.sira + "/" + e.toplam : "")
      + (e.tur_ad ? " · " + e.tur_ad : "")
      + (e.hazne ? " · " + e.hazne + " haznesi" : "");
    c.fillText(bas, x + 14, y + 22);
    /* Aşama şeridi: hangi adımda olduğu. */
    var sw = (w - 28) / EKIM_ASAMA.length, i;
    for (i = 0; i < EKIM_ASAMA.length; i++) {
      var a = EKIM_ASAMA[i];
      var simdi = e.parca === a.k;
      var gecti = EKIM_ASAMA.findIndex(function (z) { return z.k === e.parca; }) > i;
      var bx = x + 14 + i * sw;
      c.fillStyle = simdi ? "#7bbf5a" : (gecti ? "rgba(123,191,90,.45)" : "rgba(255,255,255,.12)");
      c.beginPath();
      if (c.roundRect) c.roundRect(bx, y + 32, sw - 6, 6, 3); else c.rect(bx, y + 32, sw - 6, 6);
      c.fill();
      c.font = (simdi ? "600 10px" : "10px") + " system-ui,sans-serif";
      c.fillStyle = simdi ? "#d8f0cf" : "rgba(201,206,196,.6)";
      c.fillText(a.ad, bx, y + 52);
    }
    /* Ne yaptığı — sunucunun kendi cümlesi. */
    c.font = "11px system-ui,sans-serif";
    c.fillStyle = e.soru ? "#f0cd8a" : "rgba(214,226,208,.85)";
    var alt = e.soru || e.asama || e.mesaj || "";
    if (e.pompa_acik && !e.soru) alt += (alt ? " · " : "") + "vakum açık";
    c.fillText(alt.length > 56 ? alt.slice(0, 55) + "…" : alt, x + 14, y + 72);
    if (e.hata) {
      c.fillStyle = "#ffb9a6";
      c.fillText(String(e.hata).slice(0, 56), x + 14, y + 88);
    }
    /* Onay ve iptal düğmeleri — makine bekliyorsa onay vurgulu. */
    var dy = y + h - 30;
    if (e.soru) {
      c.font = "600 11px system-ui,sans-serif";
      var t1 = "Tohum ucta · devam", g1 = c.measureText(t1).width + 22;
      var x1 = x + w - g1 - 14;
      S.ekimOnayKutu = { x: x1, y: dy, w: g1, h: 24 };
      c.fillStyle = "#4f7f3f";
      c.beginPath();
      if (c.roundRect) c.roundRect(x1, dy, g1, 24, 12); else c.rect(x1, dy, g1, 24);
      c.fill();
      c.strokeStyle = "#a8d68f"; c.lineWidth = 1.2; c.stroke();
      c.fillStyle = "#eaf7e4"; c.textAlign = "center";
      c.fillText(t1, x1 + g1 / 2, dy + 16);
      c.textAlign = "left";
      var t2 = "İptal", g2 = c.measureText(t2).width + 18;
      var x2 = x1 - g2 - 8;
      S.ekimIptalKutu = { x: x2, y: dy, w: g2, h: 24 };
      c.strokeStyle = "rgba(226,140,120,.8)"; c.lineWidth = 1;
      c.beginPath();
      if (c.roundRect) c.roundRect(x2, dy, g2, 24, 12); else c.rect(x2, dy, g2, 24);
      c.stroke();
      c.fillStyle = "#e8a79a"; c.textAlign = "center";
      c.fillText(t2, x2 + g2 / 2, dy + 16);
      c.textAlign = "left";
    } else {
      S.ekimOnayKutu = null;
      c.font = "600 11px system-ui,sans-serif";
      var t3 = "İptal", g3 = c.measureText(t3).width + 18;
      var x3 = x + w - g3 - 14;
      S.ekimIptalKutu = { x: x3, y: dy, w: g3, h: 24 };
      c.strokeStyle = "rgba(226,140,120,.7)"; c.lineWidth = 1;
      c.beginPath();
      if (c.roundRect) c.roundRect(x3, dy, g3, 24, 12); else c.rect(x3, dy, g3, 24);
      c.stroke();
      c.fillStyle = "rgba(232,167,154,.9)"; c.textAlign = "center";
      c.fillText(t3, x3 + g3 / 2, dy + 16);
      c.textAlign = "left";
    }
    c.restore();
  }
  function ekimOturumDokun(p) {
    var kutu = function (k) {
      return k && p.x >= k.x && p.x <= k.x + k.w && p.y >= k.y && p.y <= k.y + k.h;
    };
    if (kutu(S.ekimOnayKutu)) {
      Ses.tik();
      gonder("/api/bahce/onay", {})
        .then(function () { mesajYaz("Onay geçti — makine ekmeye devam ediyor."); return ekimDurumAl(); })
        .catch(function (h) {
          notYaz("ekim", "Onay geçmedi — " + ((h && h.message) || h));
          Ses.hata(); isteKare();
        });
      return true;
    }
    if (kutu(S.ekimIptalKutu)) {
      /* İPTALİN İKİ ANLAMI VAR ve sunucu ikisini ayırıyor: tohum ucta
         görünüyorsa hazneye geri konuyor, görünmüyorsa olduğu yerde
         bırakılıyor. Burada "geri_koy" gönderiyoruz — pompa açıkken
         tohumu rastgele bir yere düşürmek yerine geldiği göze dönmesi
         daha güvenli. */
      Ses.tik();
      gonder("/api/ekim/iptal", { ne: "geri_koy" })
        .then(function () { mesajYaz("Ekim iptal edildi — tohum hazneye geri konuyor."); return ekimDurumAl(); })
        .catch(function (h) {
          notYaz("ekim", "İptal olmadı — " + ((h && h.message) || h));
          Ses.hata(); isteKare();
        });
      return true;
    }
    return false;
  }

  /* ==================================================================== *
   * TOHUM RAFI VE EKİM
   *
   * Akış, makinenin gerçekten yaptığı iş neyse o: TOHUMU SEÇ → BOŞ YERİ
   * SEÇ → makine gözden tohumu alıp oraya eker.
   *   1. Raf, `/api/bahce`nin verdiği HAZNE GÖZLERİNİ gösteriyor: hangi
   *      gözde hangi tohum var, hangisi boş. Boş göz seçilemiyor —
   *      makinenin reddedeceği bir işe göndermek olurdu.
   *   2. Tür seçilince boş yerler SUNUCUDAN isteniyor
   *      (`/api/bahce/bos-yer?tur=`): dikim alanı, yatak sınırı ve komşu
   *      bitkilerin yayılımı orada hesaplanıyor. Ekran kendi kafasından
   *      yer önermiyor.
   *   3. Yere dokununca onay: hangi tür, hangi göz, hangi koordinat, kaç
   *      mm derine. Onaydan sonra `/api/bahce/ek` — nokta yaratılıyor ve
   *      ekim kuyruğa giriyor; ekimi makine yapıyor.
   * ==================================================================== */
  function rafKur() {
    if (!S.rafAcik) { S.raf = []; return; }
    var gozler = gozListesi();
    var ilk = S.ray.length ? S.ray[0] : { x: 12, y: 60, w: 50 };
    /* Tohum rafı da kart sütununda: askının sağında, yatağa taşmadan. */
    var ol = solOluk(140, 190);
    var w = Math.min(190, ol.w), x = ol.x;
    var y = Math.max(10, ilk.y - 10);
    S.raf = gozler.map(function (g, i) {
      return { k: g.k, ad: g.ad, tohum: g.tohum, dolu: g.dolu,
               x: x, y: y + i * 38, w: w, h: 32 };
    });
    S.rafKutu = { x: x - 8, y: y - 34, w: w + 16,
                  h: Math.max(1, gozler.length) * 38 + 46 };
  }
  function rafCiz(c) {
    if (!S.rafAcik) return;
    var kt = S.rafKutu;
    if (!kt) return;
    c.save();
    c.fillStyle = "rgba(0,0,0,.4)";
    c.beginPath();
    if (c.roundRect) c.roundRect(kt.x + 3, kt.y + 5, kt.w, kt.h, 10);
    else c.rect(kt.x + 3, kt.y + 5, kt.w, kt.h);
    c.fill();
    var g = c.createLinearGradient(kt.x, kt.y, kt.x, kt.y + kt.h);
    g.addColorStop(0, "#8d6b46"); g.addColorStop(1, "#63472d");
    c.fillStyle = g;
    c.beginPath();
    if (c.roundRect) c.roundRect(kt.x, kt.y, kt.w, kt.h, 10); else c.rect(kt.x, kt.y, kt.w, kt.h);
    c.fill();
    c.strokeStyle = "rgba(38,24,10,.6)"; c.lineWidth = 1.3; c.stroke();
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.font = "700 12px system-ui,sans-serif"; c.fillStyle = "#f3e3c6";
    c.fillText("Tohum rafı", kt.x + 12, kt.y + 20);
    if (!S.raf.length) {
      c.font = "10px system-ui,sans-serif"; c.fillStyle = "#ffc9a6";
      c.fillText("hazne gözleri bildirilmedi", kt.x + 12, kt.y + 40);
      c.fillText("makine tohumu nereden alacağını", kt.x + 12, kt.y + 54);
      c.fillText("bilmiyor", kt.x + 12, kt.y + 68);
      c.restore(); return;
    }
    S.raf.forEach(function (r) {
      var secili = S.ekimTur && r.tohum === S.ekimTur;
      c.fillStyle = secili ? "rgba(120,158,96,.5)" : "rgba(26,22,14,.55)";
      c.beginPath();
      if (c.roundRect) c.roundRect(r.x, r.y, r.w, r.h, 7); else c.rect(r.x, r.y, r.w, r.h);
      c.fill();
      c.strokeStyle = r.dolu ? (secili ? "#a8d68f" : "rgba(243,227,198,.55)")
                             : "rgba(243,227,198,.25)";
      c.lineWidth = secili ? 1.8 : 1;
      if (!r.dolu) c.setLineDash([4, 3]);
      c.beginPath();
      if (c.roundRect) c.roundRect(r.x, r.y, r.w, r.h, 7); else c.rect(r.x, r.y, r.w, r.h);
      c.stroke(); c.setLineDash([]);
      /* Göz adı solda küçük, tohumun adı büyük. */
      c.font = "9px ui-monospace,monospace";
      c.fillStyle = "rgba(243,227,198,.6)";
      c.fillText(r.k, r.x + 9, r.y + 13);
      c.font = "600 11.5px system-ui,sans-serif";
      c.fillStyle = r.dolu ? "#f6e8cf" : "rgba(243,227,198,.45)";
      c.fillText(r.dolu ? r.ad : "boş", r.x + 9, r.y + 26);
      if (r.dolu) {
        var yay = turYayilim(r.tohum);
        if (yay) {
          c.font = "9px ui-monospace,monospace";
          c.fillStyle = "rgba(243,227,198,.55)";
          c.textAlign = "right";
          c.fillText(Math.round(yay) + " mm", r.x + r.w - 9, r.y + 26);
          c.textAlign = "left";
        }
      }
    });
    c.restore();
  }
  function rafDokun(p) {
    if (!S.rafAcik) return false;
    for (var i = 0; i < S.raf.length; i++) {
      var r = S.raf[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        if (!r.dolu) {
          mesajYaz(r.k + " gözü boş — makine oradan tohum alamaz.");
          Ses.hata(); altYaz(); return true;
        }
        tohumSec(r);
        return true;
      }
    }
    var kt = S.rafKutu;
    if (kt && p.x >= kt.x && p.x <= kt.x + kt.w && p.y >= kt.y && p.y <= kt.y + kt.h) {
      return true;                                  /* rafın içi — geçirme */
    }
    return false;
  }
  /** Tohum elde: boş yerleri SUNUCUDAN iste ve toprakta göster. */
  var tohumSec = guvenli("tohum", function (r) {
    S.ekimTur = r.tohum; S.ekimGoz = r.k;
    S.bosYer = null; S.bosYerHata = "";
    /* Raf kapanıyor: tohum seçildikten sonra bakılacak yer YATAK, rafın
       açık kalması yanan boş yerlerin bir kısmını örtüyordu. Tohumu
       değiştirmek için alete yeniden dokunmak yetiyor. */
    S.rafAcik = false; S.raf = []; S.rafKutu = null;
    Ses.tik();
    mesajYaz(turAdi(r.tohum) + " elinde — yanan yerlerden birine dokun. Makine "
      + r.k + " haznesine gidip vakumla tohumu alacak, buraya getirip ekecek.");
    altYaz(); isteKare();
    api("/api/bahce/bos-yer?tur=" + encodeURIComponent(r.tohum) + "&azami=60")
      .then(function (c) {
        if (S.ekimTur !== r.tohum) return;
        S.bosYer = { tur: r.tohum, yerler: (c && c.yerler) || [],
                     sinirda: !!(c && c.sinirda), hazne: !!(c && c.hazne) };
        if (!S.bosYer.yerler.length) {
          S.bosYerHata = "Bu tür için boş yer yok — mevcut bitkilerin yayılımı "
            + "yatağı doldurmuş.";
        }
        isteKare();
      })
      .catch(function (h) {
        S.bosYerHata = "Boş yerler hesaplanamadı — " + ((h && h.message) || h);
        isteKare();
      });
  });
  /** Sunucunun verdiği boş yerler: toprakta yanan halkalar. */
  function bosYerCiz(c) {
    if (!S.ekimTur || !S.bosYer || S.bosYer.tur !== S.ekimTur) return;
    var R = rp(turYayilim(S.ekimTur)) / 2;
    var nb = (Math.sin(S.t * 2.6) + 1) / 2;
    c.save();
    c.beginPath(); c.rect(G.ox, G.oy, G.bw, G.bh); c.clip();
    S.bosYer.yerler.forEach(function (y) {
      var gx = px(y.x), gy = py(y.y);
      c.fillStyle = "rgba(124,198,110," + (0.10 + nb * 0.06).toFixed(3) + ")";
      c.beginPath(); c.arc(gx, gy, Math.max(8, R), 0, 6.3); c.fill();
      c.strokeStyle = "rgba(150,220,130," + (0.5 + nb * 0.3).toFixed(2) + ")";
      c.lineWidth = 1.4;
      c.beginPath(); c.arc(gx, gy, Math.max(8, R), 0, 6.3); c.stroke();
      c.fillStyle = "rgba(214,240,200,.9)";
      c.beginPath(); c.arc(gx, gy, 2.6, 0, 6.3); c.fill();
    });
    c.restore();
    c.save();
    c.font = "600 11px system-ui,sans-serif"; c.textAlign = "center";
    c.fillStyle = S.bosYerHata ? "#ffb9a6" : "rgba(214,240,200,.95)";
    var m = S.bosYerHata
      || (turAdi(S.ekimTur) + " · " + S.bosYer.yerler.length
          + (S.bosYer.sinirda ? "+" : "") + " boş yer · "
          + S.ekimGoz + " gözünden alınacak");
    c.fillText(m, G.ox + G.bw / 2, G.oy - 10);
    c.restore();
  }
  /** Boş yere dokunuldu mu? (yanan halkanın içi) */
  function bosYerBul(p) {
    if (!S.ekimTur || !S.bosYer || S.bosYer.tur !== S.ekimTur) return null;
    var R = Math.max(10, rp(turYayilim(S.ekimTur)) / 2), en = null, ed = 1e9;
    S.bosYer.yerler.forEach(function (y) {
      var d = Math.hypot(px(y.x) - p.x, py(y.y) - p.y);
      if (d < R && d < ed) { ed = d; en = y; }
    });
    return en;
  }
  function ekimBirak() {
    S.ekimTur = ""; S.ekimGoz = ""; S.bosYer = null; S.bosYerHata = "";
    S.rafAcik = false; S.raf = []; S.rafKutu = null;
    altYaz(); isteKare();
  }

  /* ==================================================================== *
   * KOORDİNATLA EKİM NOKTASI
   *
   * Toprağa uzun basmak da nokta koyuyor ama parmağın hassasiyeti
   * pikselle sınırlı: 540 mm'lik yatak 700 px'e sığdığında bir piksel
   * 0,8 mm ve parmağın dokunma alanı onlarca piksel. Ölçerek bulunan
   * bir yere ekmek isteyen için sayı gerekiyor.
   *
   * İKİNCİ BİR EKİM YOLU DEĞİL. Nokta konduktan sonrası uzun basışın
   * aynısı: çevresinde hazne gözleri halka olarak çiziliyor, göz
   * seçilince uygunluk çemberi yanıyor, onay kutusu çıkıyor ve ekimi
   * `/api/bahce/ek` yapıyor. Burada yalnız noktanın NEREYE konduğu
   * başka türlü söyleniyor.
   * ==================================================================== */
  function koorNot(metin, hata) {
    var el = $("#bh-koor-not");
    if (!el) return;
    el.textContent = metin || "";
    if (hata) el.classList.add("hata"); else el.classList.remove("hata");
  }
  function koorAc(acik) {
    var kutu = $("#bh-koor"), dug = $("#bh-koor-ac");
    if (!kutu) return;
    kutu.hidden = !acik;
    if (dug) dug.setAttribute("aria-expanded", acik ? "true" : "false");
    if (!acik) { koorNot(""); return; }
    var s = yatakSinir();
    koorNot("yatak X " + Math.round(s.x1) + "–" + Math.round(s.x2)
      + " · Y " + Math.round(s.y1) + "–" + Math.round(s.y2) + " mm");
    /* Boş kutu yatağın ORTASIYLA başlıyor, sıfırla değil: sıfır yatağın
       köşesi ve oraya kimse ekmiyor — düzeltmek yazmaktan hızlı. */
    var gx = $("#bh-koor-x"), gy = $("#bh-koor-y");
    if (gx && gx.value === "") gx.value = Math.round((s.x1 + s.x2) / 2);
    if (gy && gy.value === "") gy.value = Math.round((s.y1 + s.y2) / 2);
    if (gx) { gx.focus(); gx.select(); }
  }
  var koorKoy = guvenli("koordinat", function () {
    var gx = $("#bh-koor-x"), gy = $("#bh-koor-y");
    var hx = gx ? String(gx.value).trim() : "";
    var hy = gy ? String(gy.value).trim() : "";
    if (hx === "" || hy === "") { koorNot("X ve Y gerekiyor.", true); return; }
    var x = Number(hx), y = Number(hy);
    if (!isFinite(x) || !isFinite(y)) { koorNot("Sayı değil.", true); return; }
    /* SINIR DENETİMİ BURADA, çünkü yatağın dışına konan nokta sahnenin
       dışına çizilir ve kullanıcı hiçbir şey görmez. Sunucu da ekim
       anında denetliyor; bu onun yerine geçmiyor, sebebi ERKEN söylüyor. */
    var s = yatakSinir();
    if (x < s.x1 || x > s.x2 || y < s.y1 || y > s.y2) {
      koorNot("Yatağın dışı — X " + Math.round(s.x1) + "–" + Math.round(s.x2)
        + " · Y " + Math.round(s.y1) + "–" + Math.round(s.y2) + " mm.", true);
      Ses.hata();
      return;
    }
    /* `ekimSunucudan = false`: nokta kullanıcının, sunucunun önerdiği boş
       yerlerden biri değil. Ekranın kendi uygunluk denetimi bu yüzden
       açık kalıyor ve tür seçilince çember yeşil/kırmızı yanıyor. */
    S.ekimNokta = { x: x, y: y };
    S.ekimSunucudan = false;
    S.ekimTur = ""; S.ekimGoz = ""; S.secili = ""; S.halka = false;
    S.bosYer = null; S.bosYerHata = "";
    koorAc(false);
    Ses.tik();
    mesajYaz("Nokta kondu: X " + Math.round(x) + " · Y " + Math.round(y)
      + " mm — çevresindeki gözlerden tohum seç.");
    altYaz(); isteKare();
  });

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
    /* Sepet sağ panelde çiziliyor; askı yalnız sol sütunu çiziyor. */
    altDugmeCiz(c);
  }
  function altDugmeBul(p) {
    var liste = S.altDugme || [], i;
    for (i = 0; i < liste.length; i++) {
      var d = liste[i];
      if (Math.hypot(d.x + d.r - p.x, d.y + d.r - p.y) < d.r + 5) return d;
    }
    return null;
  }
  /** Üst şeritten inen düğmeler kendi `click`lerini çağırıyor: iş tek
   *  yerde kalsın, ortak dosyadaki davranış kopyalanmasın. */
  function domTikla(sec, yok) {
    var el = $(sec);
    if (!el) { mesajYaz(yok || "Bu düğme bu panelde yok."); altYaz(); return false; }
    el.click();
    return true;
  }
  var altDugmeBasildi = guvenli("alt düğme", function (d) {
    Ses.uyandir();
    if (d.k === "ses") {
      var sa = Ses.degistir();
      mesajYaz(sa ? "Ses açık." : "Ses kapalı.");
      altYaz(); isteKare(); return;
    }
    Ses.tik();
    if (d.k === "kur") { insaBasla(); mesajYaz("Bahçe yeniden kuruluyor."); }
    else if (d.k === "koor") {
      if (domTikla("#bh-koor-ac", "Koordinat kutusu bu sürümde yok.")) {
        mesajYaz("X/Y yaz, noktayı koy.");
      }
    } else if (d.k === "kam") {
      if (domTikla("#bh-kam", "Kamera kutuları bu sürümde yok.")) {
        if (!P().kamKutusuAcKapa) mesajYaz("Kamera kutuları bu panelde açılmıyor.");
        else mesajYaz(kamAcikMi() ? "Kamera kutuları açık." : "Kamera kutuları kapalı.");
      }
    }
    altYaz(); isteKare();
  });
  /** Askının altındaki yuvarlak düğmeler. */
  function altDugmeCiz(c) {
    if (S.altDugmeDar) {
      /* Sığmadığını yazmadan gizlemek, düğmeler hiç yokmuş gibi
         görünmesine yol açıyordu. */
      var son = S.ray[S.ray.length - 1];
      if (son) {
        c.save();
        c.fillStyle = "rgba(190,196,186,.75)";
        c.font = "11px system-ui, sans-serif"; c.textAlign = "center";
        c.fillText("düğmeler sığmadı", son.x + son.w / 2,
                   Math.min(S.boy - 4, son.y + son.h + 14));
        c.restore();
      }
      return;
    }
    var sira = S.altDugme || [];
    if (sira.length) {
      /* KÜÇÜK RAF: yuvarlaklar askının altında havada duruyordu, ayrı
         bir şeymiş gibi görünüyordu. Aynı tahtanın devamı olarak
         çizilince sol menünün parçası oluyor. Askı tahtası dar (bir
         alet genişliği), sıra ondan geniş — o yüzden ayrı bir raf. */
      var s0 = sira[0], sn = sira[sira.length - 1];
      var rx = s0.x - 7, rw = (sn.x + sn.r * 2) - s0.x + 14;
      var ryy = s0.y - 7, rh = s0.r * 2 + 14;
      c.save();
      c.fillStyle = "rgba(0,0,0,.3)";
      c.beginPath();
      if (c.roundRect) c.roundRect(rx + 2, ryy + 4, rw, rh, 7);
      else c.rect(rx + 2, ryy + 4, rw, rh);
      c.fill();
      var rg = c.createLinearGradient(rx, ryy, rx + rw, ryy);
      rg.addColorStop(0, "#6b4a2c"); rg.addColorStop(0.35, "#8a6238");
      rg.addColorStop(0.75, "#754f2d"); rg.addColorStop(1, "#5c3f25");
      c.fillStyle = rg;
      c.beginPath();
      if (c.roundRect) c.roundRect(rx, ryy, rw, rh, 7); else c.rect(rx, ryy, rw, rh);
      c.fill();
      c.strokeStyle = "rgba(30,18,8,.5)"; c.lineWidth = 1.2;
      c.beginPath();
      if (c.roundRect) c.roundRect(rx + 0.5, ryy + 0.5, rw - 1, rh - 1, 7);
      else c.rect(rx + 0.5, ryy + 0.5, rw - 1, rh - 1);
      c.stroke();
      c.restore();
    }
    sira.forEach(function (d) {
      if (d.k === "ses") { sesCiz(c); return; }
      var cx = d.x + d.r, cy = d.y + d.r;
      var acik = d.k === "kam" ? kamAcikMi() : false;
      c.save();
      c.fillStyle = "rgba(20,24,19,.8)";
      c.beginPath(); c.arc(cx, cy, d.r, 0, 6.3); c.fill();
      c.strokeStyle = acik ? "#7bbf5a" : "rgba(201,206,196,.55)";
      c.lineWidth = 1.3;
      c.beginPath(); c.arc(cx, cy, d.r, 0, 6.3); c.stroke();
      c.strokeStyle = acik ? "#cfe8c2" : "rgba(214,220,210,.9)";
      c.fillStyle = c.strokeStyle;
      c.lineWidth = 1.6; c.lineCap = "round";
      if (d.k === "kur") {                       /* yeniden kur: dönen ok */
        c.beginPath(); c.arc(cx, cy, 6.5, 0.6, 5.4); c.stroke();
        c.beginPath();
        c.moveTo(cx + 5.4, cy - 5.4); c.lineTo(cx + 7.4, cy - 1.6);
        c.lineTo(cx + 3.2, cy - 2.4); c.closePath(); c.fill();
      } else if (d.k === "koor") {               /* koordinat: artı + halka */
        c.beginPath(); c.arc(cx, cy, 5.6, 0, 6.3); c.stroke();
        c.beginPath();
        c.moveTo(cx - 9, cy); c.lineTo(cx - 2.5, cy);
        c.moveTo(cx + 2.5, cy); c.lineTo(cx + 9, cy);
        c.moveTo(cx, cy - 9); c.lineTo(cx, cy - 2.5);
        c.moveTo(cx, cy + 2.5); c.lineTo(cx, cy + 9);
        c.stroke();
      } else if (d.k === "kam") {                /* kamera kutuları */
        c.beginPath();
        if (c.roundRect) c.roundRect(cx - 8, cy - 6, 16, 12, 2);
        else c.rect(cx - 8, cy - 6, 16, 12);
        c.stroke();
        c.beginPath(); c.arc(cx, cy, 3, 0, 6.3); c.stroke();
        if (!acik) {                             /* kapalıysa üstü çizili */
          c.beginPath(); c.moveTo(cx - 9, cy + 7); c.lineTo(cx + 9, cy - 7); c.stroke();
        }
      }
      c.restore();
    });
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
    /* Panel zeminine düşen gölge (eskiden çime düşüyordu). */
    c.fillStyle = "rgba(0,0,0,.32)";
    c.beginPath(); c.ellipse(cx + 2, alt + 3, ru * 0.9, ru * 0.26, 0, 0, 6.3); c.fill();
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
   * FAVORİLER — YILDIZ
   *
   * Favori bir KULLANICI TERCİHİ, ölçüm değil: sunucuda yeri yok ve
   * makinenin kararına girmiyor. Bu tarayıcıda `localStorage` içinde
   * duruyor (`farmbot_favori`), yani aynı tarayıcının bütün panellerinde
   * ve sekmelerinde aynı liste görünüyor; başka bir bilgisayarda ya da
   * telefonda görünmez — bunu ekranda da söylüyoruz.
   *
   * `window.Favori` dışarı açık: tarla, bitkiler ve ayar ekranları da
   * aynı listeyi okuyup "favoriler üstte" sıralaması yapabilsin diye tek
   * kaynak burada. İkinci bir liste tutmak, iki ekranın farklı favori
   * göstermesi demekti.
   * ==================================================================== */
  var Favori = (function () {
    var anahtar = "farmbot_favori";
    var kume = {};
    var dinleyiciler = [];
    function oku() {
      try {
        var ham = JSON.parse(localStorage.getItem(anahtar) || "[]");
        kume = {};
        if (ham && ham.length) ham.forEach(function (a) { kume[String(a)] = true; });
      } catch (h) { kume = {}; }
      return kume;
    }
    function yaz() {
      try { localStorage.setItem(anahtar, JSON.stringify(Object.keys(kume))); }
      catch (h) {}
      dinleyiciler.forEach(function (f) { try { f(); } catch (h) {} });
    }
    oku();
    /* Başka sekmede değişirse burada da değişsin. */
    try {
      window.addEventListener("storage", function (e) {
        if (e && e.key === anahtar) { oku(); dinleyiciler.forEach(function (f) { f(); }); }
      });
    } catch (h) {}
    return {
      liste: function () { return Object.keys(kume); },
      var: function (ad) { return !!kume[String(ad)]; },
      degistir: function (ad) {
        ad = String(ad);
        if (kume[ad]) delete kume[ad]; else kume[ad] = true;
        yaz();
        return !!kume[ad];
      },
      /** Favoriler üste — sıra bozulmadan. Her panel bunu çağırabilir. */
      sirala: function (dizi, adAl) {
        adAl = adAl || function (x) { return x && (x.ad || x.isim || x); };
        return (dizi || []).slice().sort(function (a, b) {
          var fa = kume[String(adAl(a))] ? 0 : 1, fb = kume[String(adAl(b))] ? 0 : 1;
          return fa - fb;
        });
      },
      dinle: function (f) { if (typeof f === "function") dinleyiciler.push(f); }
    };
  }());
  try { window.Favori = Favori; } catch (h) {}

  /** Yıldız çizimi — dolu favori, boş değil. */
  function yildizCiz(c, cx, cy, r, dolu, renk) {
    var i, a, x, y;
    c.beginPath();
    for (i = 0; i < 10; i++) {
      a = -Math.PI / 2 + i * Math.PI / 5;
      var rr = i % 2 ? r * 0.46 : r;
      x = cx + Math.cos(a) * rr; y = cy + Math.sin(a) * rr;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
    if (dolu) { c.fillStyle = renk || "#f6c456"; c.fill(); }
    c.strokeStyle = dolu ? "rgba(40,30,10,.5)" : (renk || "rgba(226,232,222,.7)");
    c.lineWidth = 1.2; c.stroke();
  }

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
      /* YAŞ YUVARLANIYOR. Sunucu kesirli gün veriyor ve kart onu olduğu
         gibi basıyordu: "10.297452518432229 günlük". Saat mertebesindeki
         kesir kimsenin işine yaramıyor, satırı da taşırıyordu. */
      var yasY = Math.round(yas);
      r.push({ ad: "Dikim", deger: ek ? tarih(ek) : (yasY + " gün önce"),
               alt: yasY + " günlük" + (olgun ? " · olgunluk " + Math.round(olgun) + " gün" : "")
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
      r.push({ k: "film", ad: "Film", deger: sayi(b.film_kare, 0) + " kare",
               alt: "dokun · tohumdan bugüne izle", renk: "#d9b26a" });
    }
    return r;
  }
  function kartCiz(c) {
    if (!S.secili || S.ekimNokta || S.film) return;
    var b = S.ix[S.secili];
    if (!b) return;
    var satir = kartSatirlari(b);
    var ust = 46, satirY = 34;
    var h = ust + satir.length * satirY + 12;
    var sp = spriteAl(b);
    var R = Math.max(66, sp.R + 40);
    var mk = S.halkaMerkez || halkaMerkez(px(b.x), py(b.y), R);
    var gx = mk.x, gy = mk.y;
    /* KART BİTKİNİN YANINDA. Kenara sabitlemek denendi ve bağı
       koptu: kartın hangi bitkiye ait olduğu ancak ince bir çizgiyle
       anlatılabiliyordu ve o çizgi bütün yatağı kesiyordu. Kart eylem
       halkasının yanında açılıyor, hangi yanda yer varsa o yana.
       Sağ sütundan kaçıyor: kart üstte çizildiği için okunur, ama
       ölçüm tahtasını boş yere örtmesi de istenmez. */
    var w = 246;
    var y = kis(gy - h / 2, 14, Math.max(14, S.boy - h - 8));
    var x = gx + R + 16;
    if (x + w > S.en - 8) x = gx - R - 16 - w;
    var st = S.sagSutun;
    if (st && x < st.x + st.w && x + w > st.x
        && y < st.y + st.h && y + h > st.y) {
      var sol = gx - R - 16 - w;
      if (sol >= 8 && sol + w <= st.x) x = sol;
      else if (st.x - w - 8 >= 8) x = st.x - w - 8;
    }
    x = kis(x, 8, Math.max(8, S.en - w - 8));
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
    /* Kart hangi bitkinin: bitkinin çevresinde ince halka. */
    c.strokeStyle = "rgba(140,152,134,.55)"; c.lineWidth = 1.4;
    c.beginPath(); c.arc(px(b.x), py(b.y), sp.R + 5, 0, 6.3); c.stroke();

    c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.font = "700 14px system-ui,sans-serif";
    c.fillStyle = "#eef2e8";
    var ad = String(b.tur_ad || b.ad);
    c.fillText(ad.length > 18 ? ad.slice(0, 17) + "…" : ad, x + 14, y + 24);
    /* YILDIZ: favori. Tercih bu tarayıcıda tutuluyor, makineye gitmiyor. */
    S.kartYildiz = { x: x + w - 32, y: y + 12, w: 24, h: 24 };
    yildizCiz(c, x + w - 20, y + 24, 9, Favori.var(b.ad));
    c.font = "10px ui-monospace,monospace";
    c.fillStyle = "rgba(201,206,196,.65)";
    c.fillText(b.ad + "  ·  X " + Math.round(sayi(b.x)) + "  Y " + Math.round(sayi(b.y)),
      x + 14, y + 38);

    var yy2 = y + ust + 12;
    S.kartFilm = null;
    satir.forEach(function (r, i) {
      if (i) {
        c.strokeStyle = "rgba(255,255,255,.06)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x + 12, yy2 - 22); c.lineTo(x + w - 12, yy2 - 22); c.stroke();
      }
      /* FİLM SATIRI DÜĞME: zaman çubuğuna girmenin ikinci yolu. Satır
         "halkadaki Film düğmesi açıyor" diye tarif ediyordu; tarif
         etmek yerine kendisi açıyor. */
      if (r.k === "film") {
        S.kartFilm = { x: x + 8, y: yy2 - 24, w: w - 16, h: satirY - 2 };
        c.fillStyle = "rgba(217,178,106,.10)";
        c.beginPath();
        if (c.roundRect) c.roundRect(S.kartFilm.x, S.kartFilm.y, S.kartFilm.w, S.kartFilm.h, 7);
        else c.rect(S.kartFilm.x, S.kartFilm.y, S.kartFilm.w, S.kartFilm.h);
        c.fill();
        c.strokeStyle = "rgba(217,178,106,.35)"; c.lineWidth = 1; c.stroke();
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
  /* ==================================================================== *
   * ZAMAN ÇUBUĞU — TOHUMDAN BUGÜNE
   *
   * Arşiv zaten vardı ve kareler tek tek geziliyordu; eksik olan
   * ZAMANIN KENDİSİYDİ. Çubuğu sürükleyince bitkinin ilk karesinden
   * bugüne kadarki bütün kareler sırayla geçiyor, ▶ ile kendi kendine
   * oynuyor: aynı yerden çekilmiş kareler arka arkaya konunca büyüme
   * görünür hâle geliyor.
   *
   * UYDURMA ARA KARE YOK. İki kare arasında geçiş/çapraz geçiş
   * üretilmiyor; ekranda yalnız MAKİNENİN ÇEKTİĞİ kareler var. Çubuk
   * karelerin SIRASINA göre değil ZAMANINA göre bölünüyor: iki kare
   * arasında on gün varsa çubukta da o kadar yer kaplıyor, yoksa
   * seyrek çekilmiş bir dönem sık çekilmiş gibi görünürdü.
   * Kare damgası olmayan arşivde çubuk sıraya düşüyor ve bunu yazıyor.
   *
   * KARE ÖNBELLEĞİ: her kare bir HTTP isteği. Sürüklerken her adımda
   * yeniden istemek hem ağı hem gözü yoruyordu; yüklenen kare
   * `onbellek`te kalıyor ve komşu kareler önden çekiliyor.
   * ==================================================================== */
  var FILM_FPS = 6;                  /* oynatma hızı — kare/saniye */
  var FILM_ONDEN = 3;                /* kaç komşu kare önden çekilsin */
  var filmAc = guvenli("film", function (b) {
    var kimlik = String(b.film_kimlik || "");
    if (!kimlik || !sayi(b.film_kare, 0)) {
      mesajYaz("Bu ekimin arşivinde kare yok — ilk kareyi 'Çek' ile alabilirsin.");
      altYaz(); return;
    }
    S.film = { ad: b.ad, tur: b.tur_ad || b.ad, kimlik: kimlik, kareler: [],
               ix: 0, img: null, hata: "", yukleniyor: true,
               ekim: sayi(b.ekim, 0), onbellek: {}, oynuyor: false,
               sonAdim: 0, zamanli: false };
    isteKare();
    api("/api/bahce/film?kimlik=" + encodeURIComponent(kimlik))
      .then(function (c) {
        if (!S.film || S.film.kimlik !== kimlik) return;
        S.film.kareler = (c && c.kareler) || [];
        S.film.yukleniyor = false;
        S.film.ix = Math.max(0, S.film.kareler.length - 1);
        if (!S.film.kareler.length) S.film.hata = "Arşivde kare yok.";
        filmZamanHesap();
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
  /** Karelerin çubuktaki yeri: zaman damgası varsa ZAMANA göre, yoksa
   *  sıraya göre. `zamanli` ekranda yazıyor — çubuk hangi ölçekte
   *  bölünmüş, kullanıcı bilmeden bakmasın. */
  function filmZamanHesap() {
    var f = S.film;
    if (!f) return;
    var n = f.kareler.length;
    f.oran = [];
    if (!n) { f.zamanli = false; return; }
    var ilk = sayi(f.kareler[0].ts, 0), son = sayi(f.kareler[n - 1].ts, 0);
    var aralik = son - ilk;
    f.zamanli = !!(ilk && son && aralik > 0);
    var i;
    for (i = 0; i < n; i++) {
      f.oran.push(f.zamanli
        ? kis((sayi(f.kareler[i].ts, 0) - ilk) / aralik, 0, 1)
        : (n === 1 ? 0 : i / (n - 1)));
    }
  }
  /** Kare adresi — önbellek anahtarı da bu. */
  function filmKareAdres(f, k) {
    var jt = jeton();
    if (!jt) return "";
    return "/api/bahce/film/kare?kimlik=" + encodeURIComponent(f.kimlik)
      + "&damga=" + encodeURIComponent(k.damga) + "&jeton=" + encodeURIComponent(jt);
  }
  /** Bir kareyi getir; önbellekte varsa oradan. `sessiz` önden çekim. */
  function filmKareIste(f, i, sessiz) {
    var k = f.kareler[i];
    if (!k) return null;
    var onc = f.onbellek[k.damga];
    if (onc) return onc.tam ? onc.img : null;
    var adres = filmKareAdres(f, k);
    if (!adres) { if (!sessiz) { f.hata = "Jeton yok — kare istenemiyor."; isteKare(); } return null; }
    var im = new Image();
    var kayit = { img: im, tam: false };
    f.onbellek[k.damga] = kayit;
    im.onload = function () {
      kayit.tam = true;
      if (S.film === f && f.kareler[f.ix] === k) { f.img = im; f.hata = ""; }
      isteKare();
    };
    im.onerror = function () {
      delete f.onbellek[k.damga];
      if (S.film === f && f.kareler[f.ix] === k && !sessiz) {
        f.img = null; f.hata = "Kare okunamadı.";
      }
      isteKare();
    };
    im.src = adres;
    return null;
  }
  function filmKareYukle() {
    var f = S.film;
    if (!f || !f.kareler.length) { isteKare(); return; }
    f.ix = kis(f.ix, 0, f.kareler.length - 1);
    var hazir = filmKareIste(f, f.ix, false);
    /* ESKİ KARE EKRANDA KALIYOR: yeni kare gelene kadar boş ekran
       göstermek, sürüklerken filmi kırpık yapıyordu. */
    if (hazir) { f.img = hazir; f.hata = ""; }
    var i;
    for (i = 1; i <= FILM_ONDEN; i++) {
      filmKareIste(f, f.ix + i, true);
      filmKareIste(f, f.ix - i, true);
    }
    isteKare();
  }
  /** Oynatma adımı — `kare()` her karede çağırıyor. */
  function filmAdim() {
    var f = S.film;
    if (!f || !f.oynuyor || f.kareler.length < 2) return;
    var simdi = Date.now();
    if (simdi - f.sonAdim < 1000 / FILM_FPS) return;
    f.sonAdim = simdi;
    f.ix = f.ix + 1;
    if (f.ix >= f.kareler.length) f.ix = 0;      /* başa sarıyor */
    filmKareYukle();
  }
  function filmOynat(ac) {
    var f = S.film;
    if (!f || f.kareler.length < 2) return;
    f.oynuyor = ac === undefined ? !f.oynuyor : !!ac;
    if (f.oynuyor) {
      /* Sondaysak baştan: "oynat"a basınca hiçbir şey olmaması
         kullanıcıya bozuk gibi görünüyordu. */
      if (f.ix >= f.kareler.length - 1) { f.ix = 0; filmKareYukle(); }
      f.sonAdim = Date.now();
    }
    Ses.tik();
    isteKare();
  }
  function filmKapat() { S.film = null; altYaz(); isteKare(); }
  function filmCiz(c) {
    var f = S.film;
    if (!f) return;
    var w = Math.min(S.en - 40, 560), h = Math.min(S.boy - 40, 460);
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
    c.textBaseline = "alphabetic";
    c.font = "600 13px system-ui,sans-serif"; c.textAlign = "left";
    c.fillStyle = "#e6ebe0";
    c.fillText(f.tur + " · tohumdan bugüne", x + 16, y + 24);
    /* Kapat */
    f.kapat = { x: x + w - 22, y: y + 18, r: 15 };
    c.strokeStyle = "#c9cec4"; c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(f.kapat.x - 6, f.kapat.y - 6); c.lineTo(f.kapat.x + 6, f.kapat.y + 6);
    c.moveTo(f.kapat.x + 6, f.kapat.y - 6); c.lineTo(f.kapat.x - 6, f.kapat.y + 6);
    c.stroke();

    var ix0 = y + 38, iy = h - 118;
    if (f.img) {
      var o = Math.min((w - 32) / f.img.width, iy / f.img.height);
      var iw = f.img.width * o, ih = f.img.height * o;
      c.drawImage(f.img, x + (w - iw) / 2, ix0 + (iy - ih) / 2, iw, ih);
    } else {
      c.font = "12px system-ui,sans-serif"; c.textAlign = "center";
      c.fillStyle = f.hata ? "#e07f6a" : "#9aa094";
      c.fillText(f.hata || (f.yukleniyor ? "film okunuyor…" : "kare bekleniyor…"),
        x + w / 2, ix0 + iy / 2);
    }

    var n = f.kareler.length;
    /* ---------------------------------------------------- ZAMAN ÇUBUĞU */
    var oy = y + h - 58;                       /* oynat düğmesinin ekseni */
    f.oynatDugme = { x: x + 32, y: oy, r: 15 };
    var oynanir = n > 1;
    c.save();
    c.fillStyle = "rgba(255,255,255,.06)";
    c.beginPath(); c.arc(f.oynatDugme.x, f.oynatDugme.y, 15, 0, 6.3); c.fill();
    c.strokeStyle = oynanir ? "#d9b26a" : "#4a4d47"; c.lineWidth = 1.4;
    c.beginPath(); c.arc(f.oynatDugme.x, f.oynatDugme.y, 15, 0, 6.3); c.stroke();
    c.fillStyle = oynanir ? "#f0cd8a" : "#5c605a";
    if (f.oynuyor) {
      c.fillRect(f.oynatDugme.x - 5, oy - 6, 3.5, 12);
      c.fillRect(f.oynatDugme.x + 1.5, oy - 6, 3.5, 12);
    } else {
      c.beginPath();
      c.moveTo(f.oynatDugme.x - 4, oy - 6.5);
      c.lineTo(f.oynatDugme.x + 7, oy);
      c.lineTo(f.oynatDugme.x - 4, oy + 6.5);
      c.closePath(); c.fill();
    }
    c.restore();

    var sx1 = x + 60, sx2 = x + w - 20, sy = oy;
    f.serit = { x1: sx1, x2: sx2, y: sy, adet: n };
    /* Ray */
    c.strokeStyle = "rgba(200,206,196,.22)"; c.lineWidth = 4; c.lineCap = "round";
    c.beginPath(); c.moveTo(sx1, sy); c.lineTo(sx2, sy); c.stroke();
    if (n) {
      var t = f.oran && f.oran.length === n ? f.oran[kis(f.ix, 0, n - 1)] : 0;
      var hx = sx1 + t * (sx2 - sx1);
      /* Geçilen yol */
      c.strokeStyle = "#d9b26a"; c.lineWidth = 4;
      c.beginPath(); c.moveTo(sx1, sy); c.lineTo(hx, sy); c.stroke();
      /* Kare çentikleri: her biri gerçekten çekilmiş bir kare. */
      var i;
      for (i = 0; i < n; i++) {
        var kx = sx1 + (f.oran ? f.oran[i] : (n === 1 ? 0 : i / (n - 1))) * (sx2 - sx1);
        c.fillStyle = i <= f.ix ? "rgba(240,205,138,.75)" : "rgba(200,206,196,.4)";
        c.beginPath(); c.arc(kx, sy, 2, 0, 6.3); c.fill();
      }
      /* Tutamak */
      c.fillStyle = "#f0cd8a";
      c.beginPath(); c.arc(hx, sy, 7, 0, 6.3); c.fill();
      c.strokeStyle = "rgba(20,24,18,.8)"; c.lineWidth = 1.4;
      c.beginPath(); c.arc(hx, sy, 7, 0, 6.3); c.stroke();

      /* Etiket: kaçıncı kare, tarihi ve O GÜN bitkinin kaç günlük
         olduğu. Yaş yalnız dikim damgası varsa yazılıyor —
         bilinmiyorsa uydurulmuyor. */
      var kk = f.kareler[kis(f.ix, 0, n - 1)];
      var yas = "";
      if (f.ekim && sayi(kk.ts, 0)) {
        var g = Math.floor((sayi(kk.ts, 0) - f.ekim) / 86400);
        if (g >= 0) yas = "  ·  " + g + ". gün";
      }
      c.font = "11px ui-monospace,monospace"; c.textAlign = "left";
      c.fillStyle = "#c9cec4";
      c.fillText((f.ix + 1) + " / " + n + "  ·  " + (tarih(kk.ts) || "tarihsiz") + yas,
        sx1, y + h - 30);
      /* Çubuk hangi ölçekte? Zaman damgası yoksa sıraya düşüyor ve
         bunu söylüyor — eşit aralıklı çentikler "eşit zaman" diye
         okunurdu. */
      c.font = "10px system-ui,sans-serif"; c.textAlign = "right";
      c.fillStyle = "rgba(160,168,156,.8)";
      c.fillText(f.zamanli ? "çubuk gerçek zamana göre · sürükle"
                           : "kare damgası yok · çubuk sıraya göre",
        sx2, y + h - 30);
      c.font = "10px system-ui,sans-serif"; c.textAlign = "left";
      c.fillStyle = "rgba(160,168,156,.75)";
      c.fillText("ok tuşları kare kare · boşluk oynat/durdur", sx1, y + h - 14);
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
    if (f.oynatDugme
        && Math.hypot(f.oynatDugme.x - p.x, f.oynatDugme.y - p.y) < f.oynatDugme.r + 4) {
      filmOynat(); return true;
    }
    if (f.serit && f.kareler.length && Math.abs(p.y - f.serit.y) < 26) {
      /* Sürüklerken oynatma duruyor: iki şey aynı anda ix'i
         değiştirirse çubuk parmağın altından kaçıyor. */
      f.oynuyor = false;
      filmSec(p.x); bas = { tip: "film", x: p.x, y: p.y, surukle: true };
      return true;
    }
    return true;                                  /* kutunun içi — geçirmiyoruz */
  }
  /** Çubuktaki x'i kareye çeviriyor — çentikler ZAMANA göre dağıldığı
   *  için en yakın çentik aranıyor, oran doğrudan çarpılmıyor. */
  function filmSec(sx) {
    var f = S.film;
    if (!f || !f.kareler.length) return;
    var t = kis((sx - f.serit.x1) / Math.max(1, f.serit.x2 - f.serit.x1), 0, 1);
    var n = f.kareler.length, yeni = 0, enIyi = 2, i;
    for (i = 0; i < n; i++) {
      var o = f.oran ? f.oran[i] : (n === 1 ? 0 : i / (n - 1));
      var d = Math.abs(o - t);
      if (d < enIyi) { enIyi = d; yeni = i; }
    }
    if (yeni !== f.ix) { f.ix = yeni; filmKareYukle(); }
    isteKare();
  }
  /** Kare kare: ok tuşları ve "önceki/sonraki". */
  function filmKaydir(yon) {
    var f = S.film;
    if (!f || !f.kareler.length) return;
    f.oynuyor = false;
    var yeni = kis(f.ix + yon, 0, f.kareler.length - 1);
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
    /* Üst üste binen bitkilerde FAVORİ olan kazanıyor: işaretlediğin
       bitkiye dokunmak, komşusunu seçmekten daha olası olsun. Favori
       yoksa kural eskisi gibi: merkeze en yakın olan. */
    var en = null, ed = 1e9, enF = false;
    S.bitki.forEach(function (b) {
      var sp = spriteAl(b);
      var d = Math.hypot(px(b.x) - p.x, py(b.y) - p.y);
      var r = Math.max(18, sp.R);
      if (d >= r) return;
      var f = Favori.var(b.ad);
      if (en && enF && !f) return;              /* favori olanı bozma */
      if (!en || (f && !enF) || d < ed) { ed = d; en = b; enF = f; }
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

    /* Zil listesi açıksa bütün dokunuşlar onun. */
    if (S.zilAcik && zilDokun(p)) return;
    /* Ekim oturumu paneli en üstte: makine beklerken onay düğmesinin
       önüne başka hiçbir şey geçmiyor. */
    if (S.ekimOturum && ekimOturumDokun(p)) return;
    /* TOHUM RAFI açıkken önce o. */
    if (S.rafAcik && rafDokun(p)) return;
    /* Elde tohum varsa: yanan boş yerlerden birine dokunmak ekiyor. */
    if (S.ekimTur && !S.rafAcik) {
      var by = bosYerBul(p);
      if (by) {
        S.ekimNokta = { x: sayi(by.x), y: sayi(by.y) };
        S.ekimSunucudan = true;
        ekimOnayHazirla();
        isteKare(); return;
      }
      if (yataktaMi(p.x, p.y)) {
        mesajYaz("Orası boş yer değil — yanan halkalardan birine dokun.");
        Ses.hata(); altYaz(); isteKare(); return;
      }
    }
    /* GÖREV TABELASI — satıra dokunmak o işi başlatıyor. */
    for (var gi = 0; gi < S.gorevSatir.length; gi++) {
      var gk = S.gorevSatir[gi];
      if (p.x >= gk.x && p.x <= gk.x + gk.w && p.y >= gk.y && p.y <= gk.y + gk.h) {
        gorevBasildi(gk.gorev, gi);
        return;
      }
    }
    /* Yön tuşları */
    var jt = jogTusBul(p);
    if (jt) { jogBasla(jt); return; }
    /* Askının altındaki yuvarlak düğmeler */
    var ad0 = altDugmeBul(p);
    if (ad0) { altDugmeBasildi(ad0); return; }
    /* SOL RAY — aleti eline al. Makine kopukken alınmıyor ve sebebi
       söyleniyor: o işi yapan makine. */
    var ray = rayVur(p);
    if (ray && ray.k === "ek") {
      /* Tohum aleti sürüklenmiyor: önce hangi tohum olduğunu seçmek
         gerekiyor, o yüzden dokunuşta raf açılıyor. */
      if (!bagli) {
        mesajYaz("Makine bağlı değil — ekimi makine yapıyor, tohum alınamaz.");
        Ses.hata(); altYaz(); isteKare(); return;
      }
      if (S.rafAcik) { ekimBirak(); return; }
      S.rafAcik = true; S.secili = ""; S.halka = false;
      rafKur();
      Ses.uyandir(); Ses.tik();
      mesajYaz("Tohum rafı açık — bir göz seç.");
      altYaz(); isteKare(); return;
    }
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

    /* Kartın film satırı — zaman çubuğunu açıyor. */
    if (S.secili && S.kartFilm) {
      var kf = S.kartFilm;
      if (p.x >= kf.x && p.x <= kf.x + kf.w && p.y >= kf.y && p.y <= kf.y + kf.h) {
        var bf = S.ix[S.secili];
        if (bf) { Ses.tik(); filmAc(bf); }
        return;
      }
    }
    /* Kartın yıldızı — favori aç/kapa. */
    if (S.secili && S.kartYildiz) {
      var ky = S.kartYildiz;
      if (p.x >= ky.x - 6 && p.x <= ky.x + ky.w + 6
        && p.y >= ky.y - 6 && p.y <= ky.y + ky.h + 6) {
        var fv = Favori.degistir(S.secili);
        Ses.tik();
        mesajYaz(fv ? "Favorilere eklendi — listelerde üste çıkar (bu tarayıcıda)."
                    : "Favorilerden çıkarıldı.");
        altYaz(); isteKare(); return;
      }
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
        S.ekimSunucudan = false;
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
      onayAc(ad + " sulanıyor: " + sn.toFixed(1) + " sn — iş kuyruğa girdi.",
        altSatir + " · süreyi değiştirmek için Sula'yı basılı tut", "Sula",
        function () { isGonder("sula", [b.ad], { saniye: sn }); });
    } else if (k === "nem") {
      onayAc(ad + " kökünde nem ölçülüyor — iş kuyruğa girdi.",
        altSatir + " · prob toprağa iniyor, ölçüm bitince yazılıyor", "Ölç",
        function () { isGonder("nem", [b.ad]); });
    } else if (k === "foto") {
      onayAc(ad + " fotoğraflanıyor — iş kuyruğa girdi.", altSatir + " · kare büyüme filmine giriyor", "Çek",
        function () { isGonder("foto", [b.ad]); });
    } else if (k === "yakin") {
      onayAc("Uç " + ad + " üstüne gidiyor — uç kamerası yakından bakacak.",
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
      onayAc(ad + " hasat edildi — yataktan düştü.",
        "Makine hareket etmedi: toplayan sensin. Fotoğraf filmi silinmedi — 25 saniye geri alınabilir.",
        "Hasat",
        function () {
          gonder("/api/bahce/hasat", { noktalar: [b.ad] })
            .then(function (c) {
              gunluk("bahçe: hasat · " + b.ad);
              mesajYaz((c && c.mesaj) || "Hasat edildi.");
              /* Konfeti GERÇEKTEN olmuş bir iş için: sunucu kaydı sildi. */
              Ses.pop();
              if (c && c.geri_al) S.sonHasat = { kimlik: String(c.geri_al), t: Date.now() };
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
    onayAc(ad + " " + kac + " mm taşındı — kayıt değişti, makine gitmedi.",
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
      onayAc("Prob " + b.ad + " toprağına batıyor — iş kuyruğa girdi.",
        "ölçümden sonra ekran tahmin etmeyi bırakır",
        "Ölç", function () { isGonder("nem", [b.ad]); });
      return;
    }
    if (ey.k === "foto") {
      onayAc("Uç " + b.ad + " üstüne gidip fotoğraf çekiyor.", "geri alınabilir",
        "Çek", function () { isGonder("foto", [b.ad]); });
    }
  }
  function sulaOnayAc(sn) {
    var b = S.ix[S.secili];
    if (!b) return;
    var kendi = sayi(b.sulama_saniye, 3);
    var sure = sn < 0.3 ? kendi : Math.round(kis(sn, 0.5, 60) * 10) / 10;
    onayAc(b.ad + " " + sure.toFixed(1) + " saniye sulanıyor — iş kuyruğa girdi.",
      (sn < 0.3 ? "bitkinin kendi ayarı" : "basılı tuttuğun süre")
        + " · makine başlamadıysa 25 saniye iptal edilebilir · sulamadan "
        + "sonra nem ölçümü BAYATLAR",
      "Sula", function () { isGonder("sula", [b.ad], { saniye: sure }); });
  }
  function ekimOnayHazirla() {
    var n = S.ekimNokta, slug = S.ekimTur;
    if (!n || !slug) return;
    /* YER SUNUCUDAN GELDİYSE YEREL VETO YOK. Boş yerleri hesaplayan
       sunucu; ekranın kendi geometri denetimi ikinci bir doğruluk kaynağı
       olurdu ve ikisi ayrıştığında kullanıcı sunucunun "olur" dediği yere
       ekemezdi. Elle seçilen noktada (boş toprağa uzun bas) denetim
       duruyor — orada öneri yok, kullanıcı serbest. */
    if (!S.ekimSunucudan) {
      var d = ekimUygun(slug, n.x, n.y);
      if (!d.ok) { mesajYaz("Buraya ekilemez — " + d.sebep); onayKapat(); return; }
    }
    var der = ekimDerinligi(slug);
    onayAc(turAdi(slug) + " ekiliyor"
      + (S.ekimGoz ? " · tohum " + S.ekimGoz + " gözünden" : "") + ".",
      "X " + Math.round(n.x) + " mm · Y " + Math.round(n.y) + " mm · yayılım "
        + Math.round(turYayilim(slug)) + " mm · "
        + (der == null ? "ekim derinliği bilinmiyor" : Math.round(der) + " mm derine")
        + " · nokta yaratıldı, ekimi makine yapacak",
      "Ek", function () {
        gonder("/api/bahce/ek", { tur: slug, yerler: [{ x: n.x, y: n.y }] })
          .then(function (c) {
            S.ekimNokta = null;
            var yeni = (c && c.noktalar || [])[0];
            Ses.toprak();
            if (yeni) balon(sayi(yeni.x, n.x), sayi(yeni.y, n.y), "tohum ekildi", "#e6d49c");
            xpEkle(5, "ekim");
            /* Tohum elde KALIYOR: arka arkaya ekim yapmak için rafı
               yeniden açmak gerekmesin. Boş yerler tazeleniyor. */
            if (S.ekimTur) {
              var gsl = S.ekimTur;
              api("/api/bahce/bos-yer?tur=" + encodeURIComponent(gsl) + "&azami=60")
                .then(function (c2) {
                  if (S.ekimTur !== gsl) return;
                  S.bosYer = { tur: gsl, yerler: (c2 && c2.yerler) || [],
                               sinirda: !!(c2 && c2.sinirda) };
                  isteKare();
                }).catch(function () {});
            }
            mesajYaz("Nokta yaratıldı, ekim kuyruğa girdi — makine hazneye gidip "
              + "tohumu alacak, sonra buraya ekecek.");
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
        /* İşin kimliği: alt şeritteki "geri al" bunu iptal ediyor. */
        var isk = c && c.is && c.is.kimlik;
        if (isk != null) S.sonIs = { kimlik: String(isk), tip: tip, t: Date.now() };
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
  /* ONAY ADIMI KALDIRILDI (kullanıcı istedi): düğmeye basınca iş HEMEN
   * yapılıyor, "emin misin" sorulmuyor. İki şey yerinde duruyor:
   *   1. NE YAPILDIĞI yazılıyor — onay metninin kendisi alt şeride
   *      düşüyor. Ne olduğunu söylemeden iş yapmak, onay sormamaktan
   *      farklı bir şey: biri hızı artırır, öteki kullanıcıyı kör bırakır.
   *   2. GERİ ALINABİLENDE GERİ AL: kuyruğa giren iş 25 saniye boyunca
   *      alt şeritteki bağdan iptal edilebiliyor (`/api/bahce/is/iptal`),
   *      hasat da aynı süre içinde `/api/geri-al` ile geri konuyor.
   * `iptalFn` artık çağrılmıyor; eskiden "Vazgeç"e basınca çalışıyordu. */
  function onayAc(metin, alt, evet, fn, iptalFn) {
    S.onay = null;
    mesajYaz(String(metin || ""));
    S.sonAlt = String(alt || "");
    if (fn) fn();
    altYaz(); isteKare();
  }
  function onayKapat() { S.onay = null; altYaz(); }

  /** GERİ AL — onay kalktığı için tek çıkış yolu bu. Yalnız gerçekten
   *  geri alınabilen iki şey için ve yalnız süresi dolmadan görünüyor:
   *  kuyruktaki iş (makine başlamadıysa sunucu iptal ediyor) ve hasat
   *  kaydı (sunucunun 30 saniyelik geri alma penceresi). */
  var GERI_SN = 25;
  function geriAlDugmesi() {
    var h = S.sonHasat && (Date.now() - S.sonHasat.t) < GERI_SN * 1000 ? S.sonHasat : null;
    var i = S.sonIs && (Date.now() - S.sonIs.t) < GERI_SN * 1000 ? S.sonIs : null;
    if (h) return '<div class="bh-a-dugme"><button type="button" data-bh="geri-hasat">Hasatı geri al</button></div>';
    if (i) return '<div class="bh-a-dugme"><button type="button" data-bh="geri-is">İşi iptal et</button></div>';
    return "";
  }
  var geriHasat = guvenli("geri al", function () {
    var h = S.sonHasat;
    if (!h) return;
    gonder("/api/geri-al", { kimlik: h.kimlik })
      .then(function (c) {
        S.sonHasat = null;
        mesajYaz((c && c.mesaj) || "Geri kondu.");
        Ses.basari();
        return veriYukle();
      })
      .catch(function (hh) {
        S.sonHasat = null;
        notYaz("geri", "Geri alınamadı — " + ((hh && hh.message) || hh));
        Ses.hata(); altYaz(); isteKare();
      });
  });
  var geriIs = guvenli("iş iptal", function () {
    var i = S.sonIs;
    if (!i) return;
    iptalEdilen[i.kimlik] = true;
    gonder("/api/bahce/is/iptal", { kimlik: i.kimlik })
      .then(function () {
        S.sonIs = null;
        mesajYaz("İş kuyruktan düştü.");
        return veriYukle();
      })
      .catch(function (hh) {
        S.sonIs = null;
        notYaz("geri", "İptal olmadı — " + ((hh && hh.message) || hh)
          + " (makine başladıysa durdurmak teknik panelde)");
        Ses.hata(); altYaz(); isteKare();
      });
  });

  /** EN SON SULANAN BİTKİ — `sulama_ts` kayıtlarının en yenisi. */
  function sonSulama() {
    var en = null, simdi = Date.now() / 1000;
    S.bitki.forEach(function (b) {
      var t = sayi(b.sulama_ts, 0);
      if (t > 0 && (!en || t > en.ts)) en = { ad: b.ad, tur: b.tur_ad || b.ad, ts: t };
    });
    if (!en) return null;
    en.yas = simdi - en.ts;
    en.yazi = "son sulama: " + en.tur + " · " + sureKisa(en.yas) + " önce";
    return en;
  }

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
    zilYaz();
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
    /* Pay burada da tazeleniyor: başlıktaki "⏻ Aç" düğmesi tork
       açılınca "⏻ Kapat" oluyor ve grup genişliyor. */
    sagPayOlc();
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
  /** Şeridi yazdıktan SONRA akışı dibe indiriyor: şeridin boyu
   *  değişince akışın görünen yüksekliği de değişiyor ve `gunlukBoya`
   *  içinde yapılan kaydırma yukarıda kalıyordu (ölçüldü: 246 px
   *  akışta scrollTop 0). Sıra burada garanti. */
  function altYaz() { altSeritYaz(); gunlukDibeIn(); }
  function gunlukDibeIn() {
    if (S.gunlukTut) return;
    var ak = $("#bh-g-akis");
    if (ak) ak.scrollTop = ak.scrollHeight;
  }
  var altSeritYaz = guvenli("alt şerit", function () {
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
    /* BOŞTAYKEN ŞERİT KAPANIYOR.
     *
     * Burada sabit bir ipucu satırı ve "son sulama" duruyordu: ikisi
     * birlikte ekranın altından 56 px yiyordu ve ikisi de her an
     * gerekli değil. İpucu aletleri tarif ediyordu, oysa hepsi askıdaki
     * etiketlerde yazılı; "son sulama" ise bir ÖLÇÜM ve yeri ölçümlerin
     * yanı — sağdaki Ölçümler tabelasına taşındı.
     *
     * Şerit yok olmuyor: seçim, onay ve mesaj hâlâ buraya çıkıyor.
     * Yalnız söyleyecek bir şeyi olmadığında yer kaplamıyor.
     *
     * İPUCU İLK KEZ AÇANA BİR KEZ gösteriliyor. Öğrendikten sonra her
     * açılışta tekrar etmesi, ekranı kendi kendini tekrarlayan bir
     * satırla doldurmaktı. */
    kok.dataset.kip = "bos";
    var ipuc = S.mesaj || (ipucuGorulduMu() ? "" : IPUCU);
    if (!ipuc) {
      kok.innerHTML = "";
      var gd = geriAlDugmesi();
      if (gd) kok.innerHTML = gd;
      kok.classList.toggle("bos-gizli", !gd);
      return;
    }
    kok.classList.remove("bos-gizli");
    var altYazi = S.mesaj ? (S.sonAlt || "") : "";
    kok.innerHTML = '<div class="bh-a-metin"><span class="bh-a-alt'
      + (S.mesaj ? " vurgu" : "") + '">' + kacisli(ipuc) + "</span>"
      + (altYazi ? '<span class="bh-a-alt">' + kacisli(altYazi) + "</span>" : "")
      + "</div>" + geriAlDugmesi();
  });

  //: Simgeden anlaşılmayan iki hareket. Aletlerin adı askıda yazılı.
  var IPUCU = "Aleti bitkiye sürükle · bitkiye dokun: künye · "
    + "toprağa uzun bas: ek";
  var IPUCU_ANAHTAR = "bh-ipucu-gorundu";
  function ipucuGorulduMu() {
    try {
      if (localStorage.getItem(IPUCU_ANAHTAR)) return true;
      /* İlk gösterimde işaretleniyor: bir sonraki açılışta çıkmıyor.
         Kaybolmasını istemeyen için `bh-ipucu-gorundu` anahtarını
         silmek yetiyor. */
      localStorage.setItem(IPUCU_ANAHTAR, "1");
    } catch (h) { return false; }   /* depolama yoksa ipucu hep görünsün */
    return false;
  }

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
    } else if (ad === "geri-hasat") { geriHasat();
    } else if (ad === "geri-is") { geriIs();
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
  /** Bir kartın işini başlat. Üst şeritteki "Yap" da, tabeladaki satıra
   *  dokunmak da buraya geliyor — iki yol aynı işi yapsın diye tek yer.
   *  Onay metni KAÇ BİTKİ ve NE KADAR SU olduğunu söylüyor: sayılar
   *  bitkilerin kendi ayarlarından toplanıyor, uydurulmuyor. */
  function kartUygula(k) {
    if (!k) return;
    /* Favoriler önce: iş aynı iş, ama makine sıraya girdiği yerden
       başlıyor ve önce senin işaretlediğin bitkilere gidiyor. */
    var adlar = Favori.sirala((k.noktalar || []).map(String), function (a) { return a; });
    if (k.tip === "sula") {
      var sn = 0, bilinen = 0;
      adlar.forEach(function (a) {
        var b = S.ix[a];
        if (b && sayi(b.sulama_saniye, 0) > 0) { sn += sayi(b.sulama_saniye, 0); bilinen++; }
      });
      onayAc(adlar.length + " bitki sulanıyor"
        + (bilinen === adlar.length && sn ? " · toplam " + sn.toFixed(0) + " sn su" : "")
        + " — iş kuyruğa girdi.",
        (bilinen < adlar.length ? "bazı bitkilerin süresi yazılı değil · " : "")
          + "süre her bitkinin kendi ayarından · ölçümler bayatlar · "
          + "makine başlamadıysa 25 saniye iptal edilebilir",
        "Sula", function () { isGonder("sula", adlar); });
    } else if (k.tip === "nem") {
      onayAc(adlar.length + " bitkinin nemi ölçülüyor — iş kuyruğa girdi.",
        "ölçümden sonra ekran o bitkiler için tahmin etmeyi bırakır", "Ölç",
        function () { isGonder("nem", adlar); });
    } else if (k.tip === "hasat") {
      onayAc(adlar.length + " bitkinin fotoğrafı çekiliyor — iş kuyruğa girdi.",
        "hasadı MAKİNE yapmıyor: toplayan sensin. Bu iş yalnız kare çekiyor — "
        + "topladığını kaydetmek için bitkiyi sepete sürükle.",
        "Çek", function () { isGonder("foto", adlar); });
    } else if (k.tip === "ek") {
      mesajYaz("Boş yerleri ekmek için yatakta boş bir toprağa UZUN BAS — "
        + "tohum tepsisi orada açılır.");
      altYaz();
    }
  }
  /** Tabeladaki satıra dokunuldu: o kart üst şeritte de seçiliyor,
   *  kartın bitkileri sahnede birkaç saniye vurgulanıyor ve işin onayı
   *  açılıyor. Vurgu hangi bitkilerden söz edildiğini gösteriyor —
   *  "8 bitki susadı" yazısının hangileri olduğunu görmeden onaylamak,
   *  görmeden iş yaptırmaktı. */
  var gorevBasildi = guvenli("görev", function (gv, ix) {
    if (!gv) return;
    S.kartIx = ix;
    S.vurgu = { adlar: (gv.kart.noktalar || []).map(String), t0: S.t };
    Ses.uyandir(); Ses.tik();
    ustYaz();
    kartUygula(gv.kart);
    isteKare();
  });
  function vurguCiz(c) {
    var v = S.vurgu;
    if (!v) return;
    var p = (S.t - v.t0) / 6;
    if (p >= 1) { S.vurgu = null; return; }
    c.save();
    v.adlar.forEach(function (ad) {
      var b = S.ix[ad];
      if (!b) return;
      var sp = spriteAl(b), gx = px(b.x), gy = py(b.y);
      var nb = (Math.sin(S.t * 3.4) + 1) / 2;
      c.strokeStyle = "rgba(246,196,86," + (0.85 * (1 - p)).toFixed(3) + ")";
      c.lineWidth = 2;
      c.beginPath(); c.arc(gx, gy, sp.R + 10 + nb * 5, 0, 6.3); c.stroke();
    });
    c.restore();
  }

  var kartEvet = guvenli("kart eylemi", function () {
    if (S.isKip === "ekim") { ekimOnayGec(); return; }
    kartUygula(suankiKart());
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
    $("#bh-koor-ac").addEventListener("click", function () {
      var k = $("#bh-koor");
      koorAc(!!(k && k.hidden));
    });
    $("#bh-koor-koy").addEventListener("click", function () { koorKoy(); });
    $("#bh-kam").addEventListener("click", function () {
      kamHepsi(!kamAcikMi());
    });
    /* Enter da koyuyor: iki sayı yazıp fareye uzanmak gereksiz. */
    ["#bh-koor-x", "#bh-koor-y"].forEach(function (sec) {
      var el = $(sec);
      if (!el) return;
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); koorKoy(); }
      });
    });
    document.addEventListener("keydown", function (e) {
      if (!S.acik) return;
      /* FİLM AÇIKKEN KLAVYE ONUN: ok tuşları kare kare, boşluk
         oynat/durdur. Yazı kutusundayken karışmasın diye önce odak
         denetimi var. */
      if (S.film && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) {
        if (e.key === "ArrowRight") { e.preventDefault(); filmKaydir(1); return; }
        if (e.key === "ArrowLeft") { e.preventDefault(); filmKaydir(-1); return; }
        if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); filmOynat(); return; }
      }
      if (e.key === "Escape") {
        if (document.body.classList.contains("bh-menu")) {
          carkKapat();
          var ck = $("#bh-cark"); if (ck) ck.setAttribute("aria-expanded", "false");
          isteKare(); return;
        }
        var kk = $("#bh-koor");
        if (kk && !kk.hidden) { koorAc(false); return; }
        if (S.zilAcik) {
          S.zilAcik = false;
          var zz = $("#bh-zil"); if (zz) zz.setAttribute("aria-expanded", "false");
          isteKare(); return;
        }
        if (S.film) { filmKapat(); return; }
        if (S.rafAcik || S.ekimTur) { ekimBirak(); return; }
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
      /* BAĞLANTI ROZETİ ÖNCE YAZILIYOR, ÇİZİMDEN SONRA DEĞİL.
         Eskiden `ustYaz` bu bloğun sonundaydı: aradaki adımlardan biri
         (yerleşim, toprak dokusu, katalog) hata verdiğinde hiç
         çalışmıyor ve rozet "makine bağlı değil"de DONUYORDU — oysa
         veri gelmiş ve `bagli` true. Üstelik not da "Bahçe okunamadı —
         makine ya da sunucu yanıt vermedi" diyordu, yani bir çizim
         hatası bağlantı hatası gibi görünüyordu. Veri geldiyse
         bağlantı durumu doğrudur; çizim ondan ayrı bir iş. */
      kuyrukIzle();
      ustYaz();
      notYaz("veri", "");
      /* ÇİZİM AYRI YAKALANIYOR: burada patlayan bir şey sahneyi boş
         bırakabilir ama "sunucu yanıt vermedi" DEĞİLDİR ve öyle
         yazmak, arızayı yanlış yerde aratır. */
      try {
        bitkileriHazirla();
        yerlesim();
        topragiCiz();
      } catch (h) {
        hataYaz("sahne", h);
        notYaz("sahne", "Sahne çizilemedi — veri geldi, çizim hata verdi.");
      }
      katalogAl();
      olcumAl();
      ekimSayacKur();
      if (((S.veri && S.veri.ekim) || {}).aktif && !S.ekimOturum) ekimDurumAl();
      ustYaz(); altYaz(); isteKare();
    }).catch(function (h) {
      /* SESSİZ BAŞARISIZLIK YOK: sahne boş kalırsa sebebi ekranda.
         Buraya artık YALNIZ isteğin kendisi başarısız olunca düşülüyor. */
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
    /* Favori başka bir panelde (tarla, bitkiler) değiştiğinde bahçe de
       tazelensin: yıldız ve sıralama üç ekranda aynı anda değişiyor.
       `Favori` hem aynı sayfadaki dinleyicileri hem başka sekmenin
       `storage` olayını iletiyor. */
    Favori.dinle(function () { S.nemDamga = ""; isteKare(); });
    /* SAĞ PAYI KENDİ KENDİNE TAZELİYOR. `resize` yetmiyor: grup
       pencere boyu değişmeden de genişliyor ("⏻ Aç" → "⏻ Kapat") ve o
       anda pay eski kalıyor. Gözlemci grubun KENDİSİNE bakıyor. */
    try {
      var sagK = document.querySelector(".ust-sag");
      if (sagK && window.ResizeObserver) {
        new ResizeObserver(function () { sagPayOlc(); }).observe(sagK);
      }
    } catch (h) { /* gözlemci yoksa `resize` ve `ustYaz` yolu duruyor */ }
    carkKur();
    zilKur();
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
      /* Kamera kutuları bahçede kapalı: sahnenin üstünde durup yatağın
         bir köşesini örtüyorlardı. Sekmeden çıkınca kullanıcının kendi
         ayarı geri geliyor. */
      if (S.acik) kamBahceyeGir(); else kamBahcedenCik();
      /* Sağ payı HEMEN ölçüyoruz. `olcuKur` bunu zaten yapıyor ama o
         `requestAnimationFrame` içinde; sekme açılırken ilk çizim
         rAF'tan önce olduğu için pay bir kare boyunca yedek değerde
         kalıyordu. */
      if (S.acik) sagPayOlc();
      if (!S.acik) {
        carkKapat(); jogBitir(); S.zilAcik = false;
        if (S.ekimSayac) { clearInterval(S.ekimSayac); S.ekimSayac = null; }
        Ses.akisDur(); Ses.motorDur(); S.hareketSes = false;
      }
      sayacKur(S.acik);
      if (!S.acik) {
        if (S.dongu) { cancelAnimationFrame(S.dongu); S.dongu = 0; }
        return;
      }
      if (!kur()) return;
      /* Terminal her girişte yeniden kuruluyor: çıkarken `gunlukSok`
         onu kaldırıp şeridi yerine koyuyor, bir daha kurulmazsa şerit
         ekranın altında kalıyordu (ölçüldü: ikinci girişte terminal
         yoktu). Çağrı tekrarlanabilir — varsa hiçbir şey yapmıyor. */
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
    ekimDegisti: function () {
      if (!S.acik) return;
      ekimDurumAl(); ekimSayacKur();
      return veriYukle();
    },
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
                         oynuyor: !!S.film.oynuyor, zamanli: !!S.film.zamanli,
                         oran: S.film.oran || null,
                         onbellek: Object.keys(S.film.onbellek || {}).length,
                         oynat: S.film.oynatDugme || null,
                         serit: S.film.serit || null, kutu: S.film.kutu || null } : null,
        kart: S.kartKutu ? { x: Math.round(S.kartKutu.x), y: Math.round(S.kartKutu.y),
                             w: Math.round(S.kartKutu.w), h: Math.round(S.kartKutu.h) } : null,
        kartFilm: S.kartFilm ? { x: Math.round(S.kartFilm.x), y: Math.round(S.kartFilm.y),
                                 w: Math.round(S.kartFilm.w), h: Math.round(S.kartFilm.h) } : null,
        yildiz: S.kartYildiz ? { x: S.kartYildiz.x, y: S.kartYildiz.y,
                                 w: S.kartYildiz.w, h: S.kartYildiz.h,
                                 favori: S.secili ? Favori.var(S.secili) : false } : null,
        ekim: S.ekimOturum ? { parca: S.ekimOturum.parca, sira: S.ekimOturum.sira,
                               toplam: S.ekimOturum.toplam, soru: S.ekimOturum.soru,
                               onay: !!S.ekimOnayKutu, iptal: !!S.ekimIptalKutu,
                               kutuOnay: S.ekimOnayKutu, kutuIptal: S.ekimIptalKutu } : null,
        raf: { acik: !!S.rafAcik, gozler: S.raf.map(function (r) {
                 return { k: r.k, ad: r.ad, dolu: r.dolu, x: r.x, y: r.y, w: r.w, h: r.h }; }),
               tur: S.ekimTur, goz: S.ekimGoz,
               bosYer: S.bosYer ? S.bosYer.yerler.length : -1, hata: S.bosYerHata },
        altDugme: (S.altDugme || []).map(function (d) {
          return { k: d.k, x: d.x, y: d.y, r: d.r };
        }),
        zilKutu: S.zilKutu ? { x: Math.round(S.zilKutu.x), y: Math.round(S.zilKutu.y),
                               w: Math.round(S.zilKutu.w), h: Math.round(S.zilKutu.h) } : null,
        zil: { acik: !!S.zilAcik, sayi: zilSayi(),
               satir: S.zilSatir.map(function (z) {
                 return { kimlik: z.gorev.kimlik, x: z.x, y: z.y, w: z.w, h: z.h };
               }) },
        gorevKutu: S.gorevKutu ? { x: Math.round(S.gorevKutu.x), y: Math.round(S.gorevKutu.y),
                                   w: Math.round(S.gorevKutu.w),
                                   h: Math.round(S.gorevKutu.h) } : null,
        gorev: S.gorevSatir.map(function (g) {
          return { kimlik: g.gorev.kimlik, tip: g.gorev.tip, metin: g.gorev.metin,
                   alt: g.gorev.alt, evet: g.gorev.evet, favori: g.gorev.favori,
                   x: g.x, y: g.y, w: g.w, h: g.h };
        }),
        jog: S.jog ? { x: S.jog.x, y: S.jog.y, w: S.jog.w, h: S.jog.h,
                       kilit: jogKilit(), basili: S.jogBasili || "",
                       tuslar: S.jog.tuslar.map(function (t) {
                         return { k: t.k, cx: t.cx, cy: t.cy, r: t.r };
                       }) } : null,
        olcum: { satir: olcumSatirlari(), hata: S.olcumHata,
                 /* Kutunun KENDİSİ de veriliyor: künye kartıyla
                    çakışıp çakışmadığı ancak iki dikdörtgen elde olunca
                    ölçülebiliyor. */
                 kutu: S.sensorKutu ? true : false,
                 sutun: S.sagSutun ? { x: Math.round(S.sagSutun.x),
                                       y: Math.round(S.sagSutun.y),
                                       w: Math.round(S.sagSutun.w),
                                       h: Math.round(S.sagSutun.h) } : null,
                 durum: S.durumKutu ? { x: Math.round(S.durumKutu.x),
                                        y: Math.round(S.durumKutu.y),
                                        w: Math.round(S.durumKutu.w),
                                        h: S.durumKutu.h } : null,
                 kutuYeri: S.sensorKutu ? { x: Math.round(S.sensorKutu.x),
                                            y: Math.round(S.sensorKutu.y),
                                            w: S.sensorKutu.w, h: S.sensorKutu.h } : null },
        kunye: S.kartKutu ? { x: Math.round(S.kartKutu.x),
                              y: Math.round(S.kartKutu.y),
                              w: S.kartKutu.w, h: S.kartKutu.h } : null,
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
