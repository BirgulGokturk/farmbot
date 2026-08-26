/* Prosedürel dokular — kanvasta üretiliyor, dosya indirilmiyor.
 *
 * Neden dosya değil: panel internetsiz bir yerel ağda da açılmak zorunda ve
 * Pi'ye kopyalanan her ikili dosya bir bakım yükü. Kanvasta üretilen doku
 * hem depoda yer kaplamıyor hem de yatağın ölçüsüne göre kendini
 * ayarlayabiliyor.
 *
 * Hepsi BİR KEZ, sahne kurulurken üretiliyor ve önbellekte tutuluyor:
 * 512×512 dört oktavlı gürültü Pi'de ~30 ms, her çizimde tekrarlamak
 * saçmalık olurdu. Üretilen her doku `THREE.CanvasTexture`.
 *
 * Rastgelelik TOHUMLU: aynı ad her zaman aynı deseni veriyor. Panel
 * yenilendiğinde toprak deseni ve bitkilerin duruşu değişmiyor — değişseydi
 * "az önce böyle değildi" hissi veren, güvenilmez bir sahne olurdu.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------- tohum */
  /** Metinden 32 bitlik tohum (FNV-1a). */
  function tohumla(metin) {
    let h = 0x811c9dc5;
    const s = String(metin == null ? "" : metin);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Tohumlu rastgele üreteç (mulberry32). Math.random YOK: aynı ad aynı
   *  sonucu versin diye her şey buradan çıkıyor. */
  function uretec(tohum) {
    let a = tohum >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ----------------------------------------------------------- gürültü */
  /** Sarmalanabilir değer gürültüsü ızgarası. */
  function izgara(boyut, rast) {
    const g = new Float32Array(boyut * boyut);
    for (let i = 0; i < g.length; i++) g[i] = rast();
    return g;
  }

  const yumusat = (t) => t * t * (3 - 2 * t);

  /** Izgaradan çift doğrusal örnekleme — kenarlarda sarmalıyor (tileable). */
  function ornekle(g, boyut, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = yumusat(x - x0), fy = yumusat(y - y0);
    const i0 = ((x0 % boyut) + boyut) % boyut, j0 = ((y0 % boyut) + boyut) % boyut;
    const i1 = (i0 + 1) % boyut, j1 = (j0 + 1) % boyut;
    const a = g[j0 * boyut + i0], b = g[j0 * boyut + i1];
    const c = g[j1 * boyut + i0], d = g[j1 * boyut + i1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  /** Çok oktavlı gürültü alanı (fBm). Dönen dizi 0..1.
   *
   * `bas` en büyük dalgayı atlıyor: 0'da ilk ızgara 4×4, yani dokunun
   * dörtte biri kadar bir leke. Doku onlarca kez tekrarlanan bir zeminde
   * (çim) o leke gözle görülür bir ızgara oluşturuyor. bas=2 ile ilk
   * ızgara 16×16 — tekrar artık okunmuyor. */
  function alan(en, oktav, tohum, bas) {
    const cikti = new Float32Array(en * en);
    let genlik = 1, toplam = 0;
    for (let o = (bas || 0); o < (bas || 0) + oktav; o++) {
      const boyut = Math.max(2, 4 << o);          // 4, 8, 16, 32…
      const g = izgara(boyut, uretec(tohum + o * 7919));
      const olcek = boyut / en;
      for (let y = 0; y < en; y++) {
        for (let x = 0; x < en; x++) {
          cikti[y * en + x] += genlik * ornekle(g, boyut, x * olcek, y * olcek);
        }
      }
      toplam += genlik;
      genlik *= 0.5;
    }
    for (let i = 0; i < cikti.length; i++) cikti[i] /= toplam;
    return cikti;
  }

  /* ------------------------------------------------------------ yardım */
  function kanvas(en) {
    const c = document.createElement("canvas");
    c.width = c.height = en;
    return c;
  }

  function dokuYap(THREE, c, tekrar) {
    const d = new THREE.CanvasTexture(c);
    d.wrapS = d.wrapT = THREE.RepeatWrapping;
    if (tekrar) d.repeat.set(tekrar[0], tekrar[1]);
    d.anisotropy = 8;
    return d;
  }

  const kis = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ============================================================= toprak
   *
   * Üç katman: koyu-açık kahve lekeleri (düşük frekans), tanecik gürültüsü
   * (yüksek frekans) ve arada birkaç küçük çakıl. Düz kahverengi levha
   * görüntüsünü bitiren şey lekelerin BÜYÜK olması — yüksek frekanslı
   * gürültü tek başına gri kum efekti veriyor.
   */
  function toprakDoku(THREE, en) {
    en = en || 512;
    const leke = alan(en, 4, tohumla("toprak-leke"));
    const tane = alan(en, 2, tohumla("toprak-tane"));
    const cakil = alan(en, 5, tohumla("toprak-cakil"));

    const c = kanvas(en), g = c.getContext("2d");
    const im = g.createImageData(en, en);
    for (let i = 0; i < en * en; i++) {
      // Ana ton: 0.0 en koyu (#241b12) → 1.0 en açık (#63492f).
      // Açık uç önce #7a6045'ti: ton eşlemeden sonra toprak kum
      // rengine kaçıyor, ıslak-kuru farkı okunmuyordu.
      const t = kis(leke[i] * 1.25 - 0.12, 0, 1);
      let r = 0x24 + t * (0x63 - 0x24);
      let y = 0x1b + t * (0x49 - 0x1b);
      let m = 0x12 + t * (0x2f - 0x12);
      // Tanecik: ±%9, renk kanallarına eşit binerse gri değil parlaklık
      const tn = (tane[i] - 0.5) * 0.18;
      r *= 1 + tn; y *= 1 + tn; m *= 1 + tn;
      // Çakıl: seyrek, açık gri benekler
      if (cakil[i] > 0.86) {
        const k = (cakil[i] - 0.86) / 0.14;
        r += k * 38; y += k * 36; m += k * 33;
      }
      const p = i * 4;
      im.data[p] = kis(r, 0, 255);
      im.data[p + 1] = kis(y, 0, 255);
      im.data[p + 2] = kis(m, 0, 255);
      im.data[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return { kanvas: c, leke, tane, cakil, en };
  }

  /** Aynı gürültüden kabartma (bump) haritası: ışık gelince yüzey pürüzlü
   *  görünüyor. Normal haritası yerine bump — tek kanal, yarı yarıya
   *  bellek ve Pi'de gözle görülür fark yok. */
  function toprakKabartma(veri) {
    const en = veri.en;
    const c = kanvas(en), g = c.getContext("2d");
    const im = g.createImageData(en, en);
    for (let i = 0; i < en * en; i++) {
      let h = veri.leke[i] * 0.55 + veri.tane[i] * 0.45;
      if (veri.cakil[i] > 0.86) h += (veri.cakil[i] - 0.86) * 2.2;   // çakıl kabarık
      const v = kis(h * 255, 0, 255);
      const p = i * 4;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      im.data[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  /* ================================================================ çim
   *
   * Makinenin durduğu zemin. Uzaktan bakılan bir yüzey olduğu için tek tek
   * çim yaprağı değil, ton farkı ve seyrek açık/koyu tutamlar yetiyor.
   */
  function cimDoku(THREE, en) {
    en = en || 256;
    // Oktav sayısı yüksek: az oktavda gürültünün en büyük dalgası doku
    // boyunca birkaç kez geçiyor ve zeminde metrelerce süren açık-koyu
    // yamalar oluşuyordu — çim değil, boyanmış bir bez gibi.
    const buyuk = alan(en, 4, tohumla("cim-buyuk"), 2);
    const tutam = alan(en, 4, tohumla("cim-tutam"), 3);
    const c = kanvas(en), g = c.getContext("2d");
    const im = g.createImageData(en, en);
    for (let i = 0; i < en * en; i++) {
      // Aralık bilerek dar (0,25-0,75): geniş tutunca dokunun en büyük
      // dalgası açık-koyu bir yama oluyor ve doku 260 kez tekrarlandığı
      // için zeminde damalı bir ızgara olarak okunuyordu. Dar aralıkta
      // tekrar görünmüyor, ton farkını ince tutamlar veriyor.
      const t = kis(0.25 + buyuk[i] * 0.5, 0, 1);
      // Yeşilin iki ucu: #24361d (gölgeli çim) → #46632f (güneşli çim)
      let r = 0x24 + t * (0x46 - 0x24);
      let y = 0x36 + t * (0x63 - 0x36);
      let m = 0x1d + t * (0x2f - 0x1d);
      const tn = (tutam[i] - 0.5) * 0.55;
      r *= 1 + tn * 0.6; y *= 1 + tn; m *= 1 + tn * 0.5;
      const p = i * 4;
      im.data[p] = kis(r, 0, 255);
      im.data[p + 1] = kis(y, 0, 255);
      im.data[p + 2] = kis(m, 0, 255);
      im.data[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    // Kabartma: aynı tutam gürültüsü. Çim düz bir yeşil düzlem olarak
    // kaldığında zemin "boyanmış zemin" gibi duruyor; kabartma ışığı
    // kırınca yüzeyin bir dokusu olduğu okunuyor.
    const kc = kanvas(en), kg = kc.getContext("2d");
    const kim = kg.createImageData(en, en);
    for (let i = 0; i < en * en; i++) {
      const v = kis((tutam[i] * 0.75 + buyuk[i] * 0.25) * 255, 0, 255);
      const p = i * 4;
      kim.data[p] = kim.data[p + 1] = kim.data[p + 2] = v;
      kim.data[p + 3] = 255;
    }
    kg.putImageData(kim, 0, 0);
    return { kanvas: c, kabartma: kc };
  }

  /* ============================================================ gökyüzü
   *
   * Dikey gradyan: tepede koyu mavi-gri, ufka doğru açılıp sıcak bir tona
   * dönüyor. Düz siyah arka plan sahneyi kesip atıyordu; ufuk çizgisi
   * makinenin bir yerde DURDUĞU hissini veren şey.
   */
  function gokyuzuDoku(en) {
    en = en || 256;
    const c = kanvas(en), g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 0, en);
    gr.addColorStop(0.00, "#1d2b3a");   // zenit
    gr.addColorStop(0.42, "#3b5468");
    gr.addColorStop(0.52, "#6d7f80");   // ufuk pusu
    gr.addColorStop(0.60, "#4d5347");   // ufkun altı: uzak arazi
    gr.addColorStop(1.00, "#2a2f26");
    g.fillStyle = gr;
    g.fillRect(0, 0, en, en);
    return c;
  }

  /* --------------------------------------------------------- önbellek */
  const kutu = {};

  window.FarmbotDoku = {
    tohumla, uretec, alan,

    /** Toprak: {harita, kabartma}. Yatak ölçüsüne göre tekrar sayısı. */
    toprak(THREE, tekrarX, tekrarY) {
      if (!kutu.toprak) {
        const veri = toprakDoku(THREE, 512);
        kutu.toprak = { veri, kabartmaKanvas: toprakKabartma(veri) };
      }
      const harita = dokuYap(THREE, kutu.toprak.veri.kanvas, [tekrarX, tekrarY]);
      const kabartma = dokuYap(THREE, kutu.toprak.kabartmaKanvas, [tekrarX, tekrarY]);
      return { harita, kabartma };
    },

    /** Çim zemin dokusu: {harita, kabartma}. */
    cim(THREE, tekrar) {
      if (!kutu.cim) kutu.cim = cimDoku(THREE, 256);
      return {
        harita: dokuYap(THREE, kutu.cim.kanvas, [tekrar, tekrar]),
        kabartma: dokuYap(THREE, kutu.cim.kabartma, [tekrar, tekrar]),
      };
    },

    /** Gökyüzü gradyanı — kubbe için. */
    gokyuzu(THREE) {
      if (!kutu.gok) kutu.gok = gokyuzuDoku(256);
      const d = new THREE.CanvasTexture(kutu.gok);
      d.mapping = THREE.EquirectangularReflectionMapping;
      return d;
    },

    /* ========================================================== ortam
     *
     * Gökyüzünden süzülmüş yansıma haritası (PMREM). BİR KEZ üretiliyor.
     *
     * Bu haritayı sahne.environment olarak vermek denendi ve YANLIŞTI:
     * o zaman her MeshStandardMaterial ortam ışığını da buradan alıyor,
     * gökyüzünün alt yarısındaki yeşil-kahve "uzak arazi" tonu toprağa,
     * bitkiye, her şeye biniyor ve sahne solmuş görünüyordu. Doğrusu:
     * haritayı yalnız metal parçalara envMap olarak vermek (bkz.
     * makine.js/mal). Ortam ışığı işini yarımküre ışığı görüyor.
     */
    ortam(THREE, ciz) {
      if (kutu.ortam === undefined) {
        kutu.ortam = null;
        try {
          const gok = this.gokyuzu(THREE);
          const p = new THREE.PMREMGenerator(ciz);
          p.compileEquirectangularShader();
          kutu.ortam = p.fromEquirectangular(gok).texture;
          p.dispose();
          gok.dispose();
        } catch (h) {
          console.warn("ortam haritası kurulamadı, yansıma olmadan devam:", h);
        }
      }
      return kutu.ortam;
    },

    /** Üretilmişse ortam haritası, yoksa null. Malzeme kurarken çağrılıyor:
     *  üretmeye kalkmıyor, çünkü çizici burada elde değil. */
    hazirOrtam() {
      return kutu.ortam || null;
    },
  };
})();
