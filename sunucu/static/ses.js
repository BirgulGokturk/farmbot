/* ======================================================================
 * PANEL SESLERİ — işe yönelik geri bildirim.
 *
 * SES BİR BİLDİRİM DEĞİL, BİR GERİ BİLDİRİM. Yalnız makinede GERÇEKTEN
 * olan bir şeyin karşılığında çalıyor ve kaynağı kartın bildirdiği
 * durum — panelin tahmini değil. Su sesi, pompa rölesi açıkken akıyor
 * (`r_su_pompasi`); komut gönderildiği anda değil. Komuta ses vermek,
 * pompa çalışmadığında da su sesi duyurmak olurdu ve o, 3B sahnedeki
 * huzmenin düştüğü hatanın aynısı.
 *
 * NEDEN AYRI DOSYA: `bahce.js` kendi ses motorunu taşıyor ama o Bahçe
 * sekmesinin dosyası ve ayrı geliştiriliyor. İki dosyanın aynı anda
 * ses çalması da istenmiyor — bu modül yalnız Bahçe sekmesi KAPALIYKEN
 * çalıyor (`Ses.sekme`).
 *
 * Tarayıcı ilk kullanıcı dokunuşuna kadar ses çaldırmıyor; bağlam
 * ilk tıklamada kuruluyor (`uyandir`).
 * ==================================================================== */
window.Ses = (function () {
  "use strict";

  var ctx = null;
  var acik = true;
  var sekmeBahce = false;
  try { acik = localStorage.getItem("panel-ses") !== "0"; } catch (h) {}

  //: Sürekli sesler (su, hava) — kaynak ve kazanç düğümleri burada.
  var akis = {};

  function kur() {
    if (!acik) return null;
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { ctx = new C(); } catch (h) { return null; }
    }
    if (ctx.state === "suspended" && ctx.resume) {
      try { ctx.resume(); } catch (h) {}
    }
    return ctx;
  }

  function calabilir() { return acik && !sekmeBahce; }

  /** Kısa ton — zarfı üstel, çünkü doğrusal sönüm "tık" bırakıyor. */
  function ton(f0, f1, sure, tip, tepe, gecikme) {
    var c = calabilir() ? kur() : null;
    if (!c) return;
    var t0 = c.currentTime + (gecikme || 0);
    var o = c.createOscillator(), k = c.createGain();
    o.type = tip || "sine";
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + sure);
    k.gain.setValueAtTime(0.0001, t0);
    k.gain.exponentialRampToValueAtTime(tepe || 0.10, t0 + 0.012);
    k.gain.exponentialRampToValueAtTime(0.0001, t0 + sure);
    o.connect(k); k.connect(c.destination);
    o.start(t0); o.stop(t0 + sure + 0.02);
  }

  /** Döngüsel gürültü kaynağı — su ve hava akışının gövdesi.
   *
   *  İKİ SANİYELİK TAMPON, DÖNGÜLÜ: sulama saniyelerce sürüyor ve her
   *  kare için yeni tampon üretmek hem CPU yakar hem de eklerde tıkırtı
   *  bırakır. Tampon bir kez üretilip `loop` ile sürüyor. */
  function akisBasla(ad, f0, f1, q, tepe) {
    var c = calabilir() ? kur() : null;
    if (!c || akis[ad]) return;
    var n = Math.floor(c.sampleRate * 2);
    var tampon = c.createBuffer(1, n, c.sampleRate);
    var d = tampon.getChannelData(0), i;
    for (i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    var kay = c.createBufferSource();
    kay.buffer = tampon; kay.loop = true;
    var sz = c.createBiquadFilter();
    sz.type = "bandpass"; sz.Q.value = q; sz.frequency.value = f0;
    var k = c.createGain();
    k.gain.setValueAtTime(0.0001, c.currentTime);
    k.gain.exponentialRampToValueAtTime(tepe, c.currentTime + 0.25);

    /* Süzgeç frekansı yavaşça gidip geliyor: sabit bantlı gürültü
     * "hışırtı" gibi duyuluyor, su ise sürekli renk değiştiriyor. */
    var lfo = c.createOscillator(), lfoK = c.createGain();
    lfo.type = "sine"; lfo.frequency.value = 0.35;
    lfoK.gain.value = (f1 - f0) / 2;
    lfo.connect(lfoK); lfoK.connect(sz.frequency);
    sz.frequency.value = (f0 + f1) / 2;

    kay.connect(sz); sz.connect(k); k.connect(c.destination);
    kay.start(); lfo.start();
    akis[ad] = { kay: kay, k: k, lfo: lfo };
  }

  function akisDur(ad) {
    var a = akis[ad];
    if (!a) return;
    akis[ad] = null;
    delete akis[ad];
    try {
      var t = ctx.currentTime;
      a.k.gain.cancelScheduledValues(t);
      a.k.gain.setValueAtTime(Math.max(0.0001, a.k.gain.value), t);
      a.k.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      a.kay.stop(t + 0.22);
      a.lfo.stop(t + 0.22);
    } catch (h) {
      try { a.kay.stop(); a.lfo.stop(); } catch (h2) {}
    }
  }

  return {
    acikMi: function () { return acik; },
    /** Bahçe sekmesi kendi seslerini çalıyor; ikisi üst üste binmesin. */
    sekme: function (ad) {
      sekmeBahce = (ad === "bahce");
      if (sekmeBahce) { akisDur("su"); akisDur("hava"); }
    },
    uyandir: function () { kur(); },
    degistir: function () {
      acik = !acik;
      try { localStorage.setItem("panel-ses", acik ? "1" : "0"); } catch (h) {}
      if (!acik) { akisDur("su"); akisDur("hava"); } else { this.tik(); }
      return acik;
    },

    // ---- sürekli: kartın bildirdiği röle durumundan sürülüyor --------
    /** Su pompası açık mı. Sulamanın sesi bu — komutun değil. */
    su: function (calisiyor) {
      if (calisiyor) akisBasla("su", 700, 2400, 1.1, 0.085);
      else akisDur("su");
    },
    /** Hava pompası — daha alçak ve dar bant, sudan ayırt edilsin diye. */
    hava: function (calisiyor) {
      if (calisiyor) akisBasla("hava", 260, 620, 2.4, 0.05);
      else akisDur("hava");
    },

    // ---- kısa işaretler ---------------------------------------------
    tik: function () { ton(660, 520, 0.05, "triangle", 0.05); },
    /** İş sıraya girdi / dizi başladı — yükselen iki nota. */
    basladi: function () {
      ton(520, 660, 0.10, "sine", 0.07);
      ton(780, 880, 0.12, "sine", 0.06, 0.09);
    },
    /** Dizi bitti — alçalan, kapanış hissi. */
    bitti: function () {
      ton(880, 660, 0.12, "sine", 0.07);
      ton(560, 420, 0.20, "sine", 0.06, 0.10);
    },
    /** Hata / ret — alçak ve kısa, ürkütmeden dikkat çeksin. */
    hata: function () { ton(240, 160, 0.22, "square", 0.05); },
    /** Ekim: toprağa bırakma — kısa, boğuk bir "tok". */
    ekim: function () { ton(180, 110, 0.13, "triangle", 0.09); },
    /** Nem ölçümü — tek, ince bir okuma sesi. */
    olcum: function () { ton(1180, 1180, 0.06, "sine", 0.04); },
  };
})();
