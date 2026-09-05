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

  /* ================================================= çözünürlük tablosu
   *
   * Tek yerden. Bir dokuyu büyütmek iki şey demek: ürettiği desen daha
   * ince olabiliyor (gerçekçilik) VE aynı desen ekranda daha az
   * büyütülüyor (keskinlik). İkincisi bu sahnede daha önemli — zemin
   * dokusu 150 kez tekrarlanıyor ve yakın plana geldiğinde her tekrar
   * ekranda yüzlerce piksele yayılıyordu.
   *
   * Üretim maliyeti dört katına çıkıyor ama BİR KEZ, açılışta ödeniyor.
   * Ölçüldü (bkz. commit notu): toplam üretim 0,25 sn -> 0,72 sn.
   * GPU tarafında maliyet doku belleği: 1024² RGBA + mipmap ≈ 5,5 MB,
   * ikisi 11 MB. Pi'nin paylaşımlı belleğinde sorun değil.
   */
  const BOY = {
    toprak: 1024,     // yatağın üstü: kameranın en çok yaklaştığı yüzey
    cim: 1024,        // ekranı kaplıyor, en çok tekrarlanan doku
    gok: 512,         // dikey gradyan, ince desen yok — 512 fazlasıyla yeter
    firca: 512,       // fırça izi ince çizgi, çözünürlükten en çok o kazanıyor
  };

  /* Anizotropik süzme. Zemin düzlemi kameraya göre çok yatık duruyor;
   * o açıda normal mipmap doğru olan mip seviyesini SEÇEMİYOR ve uzak
   * çim ya bulanık ya titrek çıkıyor. Anizotropi tam da bunu düzeltiyor
   * ve bu sahnede çözünürlük artışından daha çok fark ediyor.
   *
   * Değeri çizici veriyor (tarla.js kurarken yazıyor): sabit bir sayı
   * yazmak, desteklemeyen bir GPU'da sessizce kırpılmak ya da
   * destekleyende boşuna düşük kalmak demek. */
  let azamiAnizotropi = 8;

  function dokuYap(THREE, c, tekrar) {
    const d = new THREE.CanvasTexture(c);
    d.wrapS = d.wrapT = THREE.RepeatWrapping;
    if (tekrar) d.repeat.set(tekrar[0], tekrar[1]);
    d.anisotropy = azamiAnizotropi;
    return d;
  }

  const kis = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ====================================================== kesek yığma
   *
   * Toprağın "boyut dağılımı" bir gürültü alanından çıkmıyor. fBm her
   * ölçekte aynı yumuşaklıkta olduğu için yüzey düzgün ve tek tonlu
   * kalıyor — kahverengi mermer gibi. Gerçek toprakta ise ayrık
   * PARÇALAR var: birkaç iri kesek, çok sayıda orta tane, aralarını
   * dolduran ince toz.
   *
   * Burada onun için yığma kullanılıyor: farklı yarıçaplarda kubbeler
   * tohumlu konumlara serpilip yükseklikleri toplanıyor. Kubbeler
   * sarmalanarak konduğu için doku kenarında kesilmiyor.
   */
  function kubbe(h, en, cx, cy, r, genlik) {
    const r2 = r * r;
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
    const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const yy = ((y % en) + en) % en;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        const t = 1 - d2 / r2;
        const xx = ((x % en) + en) % en;
        h[yy * en + xx] += genlik * t * t;
      }
    }
  }

  /** Üç ölçekli kesek alanı, 0..1'e normalleştirilmiş. */
  function kesekAlani(en, tohum) {
    const h = new Float32Array(en * en);
    const rast = uretec(tohum);
    // [adet payı, en küçük yarıçap, en büyük yarıçap, genlik]
    /* Üç ölçek arasında BELİRGİN boşluk var: 4,5-8,5 % / 1,6-3,4 % /
     * 0,5-1,2 %. Aralar dolu olsaydı dağılım sürekli olur ve gözle
     * "iri kesek, orta tane, ince toz" diye ayrılmazdı — yalnız
     * pürüzlü bir yüzey görünürdü. Genlikler de ayrık: iri kesek
     * yüzeyin iskeletini kuruyor, ince toz sadece dokunuyor. */
    const kat = [
      [2200, 0.045, 0.085, 1.00],   // iri kesek: yüzeyin iskeleti
      [320, 0.016, 0.034, 0.48],   // orta tane
      [34, 0.005, 0.012, 0.22],   // ince toz
    ];
    for (const [pay, r0, r1, g] of kat) {
      const adet = Math.max(1, Math.round((en * en) / pay));
      for (let i = 0; i < adet; i++) {
        const r = en * (r0 + rast() * (r1 - r0));
        kubbe(h, en, rast() * en, rast() * en, r, g * (0.6 + rast() * 0.8));
      }
    }
    let enAz = Infinity, enCok = -Infinity;
    for (let i = 0; i < h.length; i++) {
      if (h[i] < enAz) enAz = h[i];
      if (h[i] > enCok) enCok = h[i];
    }
    const olcek = enCok > enAz ? 1 / (enCok - enAz) : 1;
    for (let i = 0; i < h.length; i++) h[i] = (h[i] - enAz) * olcek;
    return h;
  }

  /* ============================================================= toprak
   *
   * Renk tek kahve değil: aynı yatakta yer yer kızılımsı (demir oksit),
   * yer yer griye çalan (kil, kuru kül) lekeler var. İkisi ayrı düşük
   * frekanslı alanlardan geliyor ve birbirinden bağımsız — tek bir
   * gürültüyü hem koyuluk hem renk için kullanmak, koyu yerlerin hep
   * aynı renkte olmasına yol açıyordu.
   *
   * Kesek kenarları: yükseklik alanının EĞİMİNDEN. Işığa bakan yamaç
   * açılıyor, arka yüzü koyuluyor; ayrıca çukurlar kapalı alan olduğu
   * için genel olarak koyu (basit bir örtme payı). Bu ikisi olmadan
   * yüzey doğru renkte ama yassı görünüyor.
   */
  function toprakDoku(THREE, en) {
    en = en || BOY.toprak;
    const kesek = kesekAlani(en, tohumla("toprak-kesek"));
    const toz = alan(en, 3, tohumla("toprak-toz"), 3);     // ince tanecik
    /* Leke alanları YÜKSEK frekanstan başlıyor (`bas = 2`).
     *
     * Önce 0'dan başlıyorlardı: ilk oktav 4×4 ızgara demek, yani leke boyu
     * dokunun dörtte biri. Kabın üstünde bu, avuç içi kadar bulanık kahve
     * bulutları oluşturuyordu ve kesek yapısı onların altında kayboluyordu
     * — ekranda toprak değil, sulu boya lekesi gibi duruyordu. 2'den
     * başlayınca ilk oktav 16×16 ve lekeler tane ölçeğine iniyor. */
    const kizil = alan(en, 3, tohumla("toprak-kizil"), 2);  // kızılımsı lekeler
    const gri = alan(en, 3, tohumla("toprak-gri"), 2);      // griye çalan lekeler
    const cakil = alan(en, 4, tohumla("toprak-cakil"), 2);

    // Işık yönü doku düzleminde. Sahnedeki güneş +x/+z'den geliyor;
    // dokunun u ekseni +x, v ekseni +z olduğu için (0.7, 0.7).
    const Lx = 0.7, Ly = 0.7;

    const c = kanvas(en), g = c.getContext("2d");
    const im = g.createImageData(en, en);
    for (let y = 0; y < en; y++) {
      const yUst = ((y - 1) + en) % en, yAlt = (y + 1) % en;
      for (let x = 0; x < en; x++) {
        const i = y * en + x;
        const xSol = ((x - 1) + en) % en, xSag = (x + 1) % en;
        // Eğim: kesek yüzeyinin bu noktadaki yokuşu
        const gx = kesek[y * en + xSag] - kesek[y * en + xSol];
        const gy = kesek[yAlt * en + x] - kesek[yUst * en + x];
        // Ölçek ve pay bilerek ölçülü: 9.0/0.55 denendi, kesekler ışıklı
        // yüzü bembeyaz çıkan çakıl taşlarına dönüşüyor, toprak değil
        // dere yatağı gibi duruyordu.
        /* Kesek gölgelendirmesi GÜÇLENDİ (5.5 -> 9.0, pay 0.34 -> 0.46).
         *
         * Lekeler küçülünce yüzeyin okunurluğu tamamen keseklerin ışık
         * alan/almayan yüzlerine kaldı; eski değerlerde o fark çok
         * yumuşaktı ve toprak düz görünüyordu. Örtme payı da açıldı
         * (0.70+0.30 -> 0.58+0.42): çukurlar daha koyu, tepeler daha
         * açık, yani tane tane okunuyor. */
        const yamac = -(gx * Lx + gy * Ly) * 9.0;
        const ortme = 0.58 + 0.42 * kesek[i];              // çukur kapalı, tepe açık
        const parlak = kis(ortme * (1 + kis(yamac, -0.85, 0.85) * 0.46), 0.16, 1.55);

        // Ana ton: kesek yüksekliği + ince toz
        // Ton keseğin yüksekliğini AZ izliyor: çok izlerse renk tamamen
        // kabartmanın kopyası oluyor ve toprak tek bir taşın fotoğrafı
        // gibi duruyor. Renk çeşidini asıl aşağıdaki iki leke veriyor.
        //
        // PALET: nemli bahçe toprağı — koyu, kahverengi, kızıla kaçmayan.
        // Önceki aralık (0x21-0x5e / 0x18-0x47 / 0x10-0x2e) kızıl lekeyle
        // birlikte paslı turuncuya kaçıyordu: ekranda toprak değil kiremit
        // tozu gibi duruyordu. Yeni aralık daha koyu başlıyor ve yeşil
        // kanalı kırmızıya yaklaştırıyor — turuncuyu kahveye çeviren fark
        // bu. Mavi de biraz yukarı: tamamen kuru bir kanal, toprağı cansız
        // ve tozlu gösteriyordu.
        // `t`nin yayilimi genisletildi (0.46 -> 0.62): dar aralikta butun
        // yuzey ayni tonda kaliyor ve toprak "cansiz" gorunuyor. Asil
        // canlilik topak tepesi ile arasindaki golge farkindan geliyor.
        const t = kis(0.14 + kesek[i] * 0.62 + (toz[i] - 0.5) * 0.38, 0, 1);
        /* NEMLİ toprak paleti. Bir önceki aralık (üst uç 0x6e) kuru saksı
         * toprağı gibi duruyordu: açık uç fazla parlaktı ve toprak tozlu
         * görünüyordu. Islak toprak KOYULAŞIR — su taneleri kaplayınca
         * yüzey daha az ışık geri veriyor. Üst uç 0x6e -> 0x52, alt uç da
         * biraz indi. Doygunluk korunuyor: koyu ama gri değil, kahve. */
        let r = 0x17 + t * (0x52 - 0x17);
        let ye = 0x10 + t * (0x39 - 0x10);
        let m = 0x0b + t * (0x27 - 0x0b);

        // Kızıl leke: kırmızıyı yukarı, maviyi aşağı
        // Pay 34'ten 14'e indi. 34'te lekeler bütün yüzeye hâkim oluyor ve
        // toprak turuncuya dönüyordu; kızıl bir VURGU olmalı, ana renk değil.
        const k = kis((kizil[i] - 0.46) * 2.6, 0, 1);
        r += 14 * k; ye += 3 * k; m -= 4 * k;
        // Gri leke: kanalları ortalamaya çekiyor, hafif de açıyor
        const gr = kis((gri[i] - 0.52) * 2.9, 0, 1);
        const ort = (r + ye + m) / 3;
        r += (ort - r) * 0.55 * gr; ye += (ort - ye) * 0.55 * gr; m += (ort - m) * 0.55 * gr;
        r += 8 * gr; ye += 9 * gr; m += 12 * gr;

        // Çakıl: keseklerin tepesinde, seyrek açık gri benek
        if (cakil[i] > 0.86 && kesek[i] > 0.60) {
          const q = (cakil[i] - 0.86) / 0.14;
          // 30 çok parlaktı: benekler toprağın üstünde çimento zerresi gibi
          // duruyordu. Gerçek çakıl da toprakla aynı ışığı alıyor.
          r += q * 18; ye += q * 17; m += q * 15;
        }

        /* KONTRAST GERME. Ölçüldü: bu noktada piksellerin standart sapması
         * 6 idi; gerçek toprak fotoğrafında 25-40 arası. Sayı, ekranda
         * "bulanık kahverengi bir yüzey" görülmesinin tam karşılığıydı —
         * bütün pikseller dar bir bantta toplanıyordu.
         *
         * Her kanal sabit bir orta noktadan uzaklaştırılıyor. Orta nokta
         * SABİT (piksel ortalaması değil): değişken bir orta nokta, koyu
         * ve açık bölgeleri birbirine yaklaştırıp etkiyi geri alırdı.
         * Aşağı doğru daha çok geriliyor, çünkü nemli toprakta gölgeler
         * ışıklardan daha derin.
         */
        /* PARLAKLIK gerilir, KANALLAR DEĞİL.
         *
         * İlk denemede her kanal ayrı ayrı aynı orta noktadan gerildi ve
         * renk bozuldu: yeşille mavinin ortalaması kırmızıdan düşük olduğu
         * için o ikisi sıfıra ezildi, toprak turuncuya kaçtı (ölçüldü:
         * R-G farkı 11'den 24'e çıkmıştı).
         *
         * Doğrusu parlaklığı gerip kanalları AYNI oranla ölçeklemek: ton
         * korunur, yalnız açık-koyu farkı açılır. Aşağı doğru biraz daha
         * geriliyor — nemli toprakta gölgeler ışıklardan derindir. */
        const ORTA = 30, GER = 2.0;
        const rr = r * parlak, gg = ye * parlak, bb = m * parlak;
        const l = (rr + gg + bb) / 3;
        const d = l - ORTA;
        const hedef = Math.max(1, ORTA + d * (d < 0 ? GER * 1.12 : GER));
        const k2 = l > 0.5 ? hedef / l : 1;
        const p = i * 4;
        im.data[p] = kis(rr * k2, 0, 255);
        im.data[p + 1] = kis(gg * k2, 0, 255);
        im.data[p + 2] = kis(bb * k2, 0, 255);
        im.data[p + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    return { kanvas: c, kesek, toz, en };
  }

  /** Kabartma (bump) haritası KESEK DAĞILIMINDAN. Eskiden lekeyle aynı
   *  gürültüden türüyordu; leke renk için var, kabartmanın onu izlemesi
   *  için bir sebep yok ve sonuçta yüzey "renkli ama düz" kalıyordu.
   *  Şimdi kabarık olan yerler gerçekten keseklerin durduğu yerler. */
  function toprakKabartma(veri) {
    const en = veri.en;
    const c = kanvas(en), g = c.getContext("2d");
    const im = g.createImageData(en, en);
    for (let i = 0; i < en * en; i++) {
      const h = veri.kesek[i] * 0.86 + veri.toz[i] * 0.14;
      // Kontrast: 0.5 çevresinde gerilerek tepe ile çukur arası açılıyor.
      // Düz haliyle kabartma yumuşak bir dalga gibiydi; istenen ise topak
      // topak, pütürlü bir yüzey.
      const v = kis((0.5 + (h - 0.5) * 1.45) * 255, 0, 255);
      const p = i * 4;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
      im.data[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  /* ================================================================ çim
   *
   * Önceki sürüm gürültüden boyanmış bir yeşil halıydı: doğru renkte ama
   * yönsüz. Gerçek çimin okunmasını sağlayan şey BIÇAK İZLERİ — kısa,
   * yönlü çizgiler. Hepsi aynı yöne olursa tarak izi gibi duruyor, hiç
   * yön olmazsa yosun; bu yüzden baskın bir yön var ve üstüne hem yavaş
   * değişen bir sapma alanı hem de bıçak başına küçük bir sapma biniyor.
   *
   * Her bıçak iki çizgi: tam boy koyu (dip) ve üst yarıda açık (uç).
   * Tek renkli bıçak, çim yüzeyinin en belirgin özelliğini — dibin
   * gölgede, ucun güneşte olmasını — kaybettiriyor.
   *
   * Sarmalama: doku kenarına yakın bıçaklar karşı kenara da çiziliyor,
   * yoksa zeminde her tekrar sınırında kesik bir çizgi ızgarası çıkıyor.
   */
  function cimDoku(THREE, en) {
    en = en || BOY.cim;
    const rast = uretec(tohumla("cim-bicak"));
    // Alanların hepsi YÜKSEK frekanstan başlıyor (bkz. alan/bas): büyük
    // dalga bırakırsak doku 150 kez tekrarlandığında zeminde damalı bir
    // ızgara olarak okunuyor.
    const ciplak = alan(en, 3, tohumla("cim-ciplak"), 3);
    const kuru = alan(en, 3, tohumla("cim-kuru"), 3);
    const yon = alan(en, 2, tohumla("cim-yon"), 1);
    const ton = alan(en, 3, tohumla("cim-ton"), 2);

    const c = kanvas(en), g = c.getContext("2d");
    const im = g.createImageData(en, en);
    for (let i = 0; i < en * en; i++) {
      /* Zemin: bıçakların ARASINDAN görünen dip. Gölgeli ve MAVİYE çalan
       * bir yeşil — gerçek çimde dip, gökyüzünün mavi ışığını alıp
       * güneşi alamadığı için soğuk kalıyor. Önceki sürümde dip de
       * bıçaklar da aynı sıcaklıktaydı, o yüzden yüzey tek katman bir
       * yeşil halı gibi duruyordu. */
      let r = 0x16, ye = 0x27, m = 0x1d;
      const cp = kis((ciplak[i] - 0.60) * 4.0, 0, 1);
      r += (0x4c - r) * cp; ye += (0x39 - ye) * cp; m += (0x24 - m) * cp;
      const tn = (ton[i] - 0.5) * 0.34;
      const p = i * 4;
      im.data[p] = kis(r * (1 + tn), 0, 255);
      im.data[p + 1] = kis(ye * (1 + tn), 0, 255);
      im.data[p + 2] = kis(m * (1 + tn), 0, 255);
      im.data[p + 3] = 255;
    }
    g.putImageData(im, 0, 0);

    g.lineCap = "round";
    const ornek = (a, x, y) => a[(((y | 0) % en) + en) % en * en + ((((x | 0) % en) + en) % en)];
    /** Kenara yakın bıçağı karşı kenara da çiziyor (sarmalama). */
    const cizgi = (x0, y0, x1, y1, renk, kalin) => {
      g.strokeStyle = renk; g.lineWidth = kalin;
      const kay = [[0, 0]];
      const pay = 16 * ol;
      if (x0 < pay || x1 < pay) kay.push([en, 0]);
      if (x0 > en - pay || x1 > en - pay) kay.push([-en, 0]);
      if (y0 < pay || y1 < pay) kay.push([0, en]);
      if (y0 > en - pay || y1 > en - pay) kay.push([0, -en]);
      for (const [dx, dy] of kay) {
        g.beginPath();
        g.moveTo(x0 + dx, y0 + dy);
        g.lineTo(x1 + dx, y1 + dy);
        g.stroke();
      }
    };

    const BASKIN = -1.05;                 // baskın yön (radyan)
    /* Bıçak sayısı ve kalınlığı doku boyuna ORANTILI. Sabit piksel
     * ölçüsü bırakılsaydı 1024'te bıçaklar yarı yarıya incelir, doku
     * daha keskin değil daha TİTREK olurdu: mipmap 1 pikselden ince
     * çizgiyi düzgün ortalayamıyor ve uzakta parazit gibi kaynıyor. */
    const ol = en / 512;
    const adet = Math.round((en * en) / (42 * ol * ol));
    for (let i = 0; i < adet; i++) {
      const x = rast() * en, y = rast() * en;
      // Çıplak lekede bıçak seyrek
      if (ornek(ciplak, x, y) > 0.62 && rast() < 0.85) continue;
      const aci = BASKIN
        + (ornek(yon, x, y) - 0.5) * 1.30      // yavaş değişen sapma
        + (rast() - 0.5) * 0.80;               // bıçağa özel sapma
      const boy = (6 + rast() * 9) * ol;
      const bx = Math.cos(aci) * boy, by = Math.sin(aci) * boy;
      const kuruMu = ornek(kuru, x, y) > 0.60 && rast() < 0.80;
      const s = rast();
      /* GÜNEŞ PAYI. Aynı çimde bir bıçak güneşe bakıyor, komşusu gölgede
       * kalıyor. Güneştekinin ucu SARIYA, gölgedekinin dibi MAVİYE
       * kaçıyor; renk tek bir yeşilin açığı-koyusu değil, iki ayrı yeşil
       * arasında geziniyor. "Ölü renk" hissini bitiren şey bu — doygunluk
       * artışı tek başına yapay çim veriyor. */
      const gunes = rast();
      let dip, uc;
      if (kuruMu) {
        // Kuru tutam: sarıya çalan, ucu daha da açık
        dip = `rgb(${(104 + s * 26) | 0},${(88 + s * 22) | 0},${(40 + s * 16) | 0})`;
        uc = `rgb(${(168 + s * 40) | 0},${(148 + s * 34) | 0},${(74 + s * 22) | 0})`;
      } else {
        // Gölgeli dip: soğuk, maviye çalan koyu yeşil
        const dr = 24 + s * 12 - gunes * 6;
        const dg = 50 + s * 16 + gunes * 10;
        const db = 32 + s * 10 - gunes * 16;
        // Güneşli uç: sıcak, sarımsı açık yeşil
        const ur = 86 + s * 30 + gunes * 62;
        const ug = 128 + s * 34 + gunes * 54;
        const ub = 48 + s * 20 - gunes * 14;
        dip = `rgb(${dr | 0},${dg | 0},${db | 0})`;
        uc = `rgb(${ur | 0},${ug | 0},${ub | 0})`;
      }
      cizgi(x, y, x + bx, y + by, dip, 1.6 * ol);
      cizgi(x + bx * 0.42, y + by * 0.42, x + bx, y + by, uc, 1.1 * ol);
    }
    return { kanvas: c };
  }

  /* ====================================================== fırçalı metal
   *
   * Anodize sigma profil ayna değil: yüzeyi tek yönde fırçalanmış, yani
   * ışığı fırça yönüne göre farklı yansıtıyor. Aynı gri renkte iki
   * parçayı bile ayıran şey çoğu zaman bu.
   *
   * Bu doku RENK haritası değil PÜRÜZLÜLÜK haritası: kanallar sadece
   * "burası ne kadar mat" diyor. Renk haritası olsaydı profiller
   * çizgili boyanmış gibi görünürdü; pürüzlülük olarak verilince
   * çizgiler ancak ışık o yöne düştüğünde beliriyor.
   *
   * Çizgiler U ekseni boyunca. Kutu geometrisinde her yüzün UV'si başka
   * yöne baktığı için fırça izi de yüze göre yön değiştiriyor — gerçek
   * bir profilde de her yüzey ayrı fırçalanmış olur.
   */
  function fircaliDoku(en) {
    en = en || BOY.firca;
    const rast = uretec(tohumla("firca"));
    const c = kanvas(en), g = c.getContext("2d");
    const im = g.createImageData(en, en);
    // Her SATIR kendi parlaklığında: çizgi boyunca sabit, satırdan
    // satıra rastgele. Fırça izinin tanımı bu.
    const satir = new Float32Array(en);
    for (let y = 0; y < en; y++) satir[y] = rast();
    // Komşu satırları biraz karıştır: tek piksellik keskin çizgiler
    // uzaktan titriyor (aliasing), hafif yumuşatınca duruyor.
    const yumusakSatir = new Float32Array(en);
    for (let y = 0; y < en; y++) {
      yumusakSatir[y] = (satir[(y - 1 + en) % en] * 0.25 + satir[y] * 0.5
                         + satir[(y + 1) % en] * 0.25);
    }
    // Çizgi boyunca da çok hafif bir değişim: kusursuz düz çizgi
    // bilgisayar işi gibi duruyor.
    const boyunca = alan(en, 2, tohumla("firca-boy"), 2 + Math.round(Math.log2(en / 256)));
    for (let y = 0; y < en; y++) {
      for (let x = 0; x < en; x++) {
        const i = y * en + x;
        // Pürüzlülük 0.55..1.0 aralığında: 0'a inen bir değer o satırı
        // aynaya çevirip parlama lekesi yapıyor.
        const v = kis((0.62 + yumusakSatir[y] * 0.34
                       + (boyunca[i] - 0.5) * 0.10) * 255, 0, 255);
        const p = i * 4;
        im.data[p] = im.data[p + 1] = im.data[p + 2] = v;
        im.data[p + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  function gokyuzuDoku(en) {
    en = en || BOY.gok;
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

    /** Çizicinin desteklediği azami anizotropiyi bildirir. Dokular
     *  üretilmeden ÖNCE çağrılmalı; sonra çağrılırsa üretilmiş dokular
     *  eski değerde kalır. */
    anizotropi(deger) {
      azamiAnizotropi = Math.max(1, Math.min(16, Math.round(deger) || 1));
      return azamiAnizotropi;
    },

    /** Doku çözünürlük tablosu — ölçüm ve tanı için okunabilir. */
    boylar: BOY,

    /** Toprak: {harita, kabartma}. Yatak ölçüsüne göre tekrar sayısı. */
    toprak(THREE, tekrarX, tekrarY) {
      if (!kutu.toprak) {
        const veri = toprakDoku(THREE, BOY.toprak);
        kutu.toprak = { veri, kabartmaKanvas: toprakKabartma(veri) };
      }
      const harita = dokuYap(THREE, kutu.toprak.veri.kanvas, [tekrarX, tekrarY]);
      const kabartma = dokuYap(THREE, kutu.toprak.kabartmaKanvas, [tekrarX, tekrarY]);
      return { harita, kabartma };
    },

    /** Çim zemin dokusu: {harita}. 512 — bıçak izleri 256'da tanınmıyor,
     *  tek tek pikselden ibaret kalıyorlar. */
    cim(THREE, tekrar) {
      if (!kutu.cim) kutu.cim = cimDoku(THREE, BOY.cim);
      return { harita: dokuYap(THREE, kutu.cim.kanvas, [tekrar, tekrar]) };
    },

    /** Fırçalanmış metal pürüzlülük haritası. Bütün profiller aynı
     *  dokuyu paylaşıyor — tek doku, tek yükleme. */
    fircali(THREE) {
      if (!kutu.firca) {
        kutu.firca = dokuYap(THREE, fircaliDoku(BOY.firca), [3, 3]);
      }
      return kutu.firca;
    },

    /** Gökyüzü gradyanı — kubbe için. */
    gokyuzu(THREE) {
      if (!kutu.gok) kutu.gok = gokyuzuDoku(BOY.gok);
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
