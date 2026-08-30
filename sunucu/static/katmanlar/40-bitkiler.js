/* Bitkiler — prosedürel gövde + yapraklar, türün rengine ve yaşına göre.
 *
 * Bitki, `tur` alanı taşıyan bir NOKTA. Ayrı bir depo yok; bu katman da
 * `veri.noktalar`ı okuyor, 2B harita da. Sürükleyerek taşımak ve silmek
 * burada: taşınan şey bitkinin kendisi, halkası değil.
 *
 * BİÇİM. Eski sürümde her bitki bir küre tacın etrafına dizilmiş 3-7 küre
 * yapraktı: marulla domates ayırt edilmiyordu ve yapraklar birbirinin
 * kopyası olduğu için kalabalık bir yatak plastik görünüyordu. Şimdi altı
 * arketip var (rozet, tüp, dik, çalı, sap, sarılan) ve 37 türün her biri
 * elle bir arketipe bağlı. `spread_mm`e bakıp tahmin etme denemesi
 * lahanayı çalı, dereotunu ağaç yapıyordu — tablo elle yazıldı.
 *
 * RASTGELELİK bitkinin ADINDAN türüyor (FarmbotDoku.tohumla). Böylece
 * "b12" her açılışta aynı duruşta; Math.random olsaydı her tazelemede
 * bütün yatak yeniden diziliyor, "az önce böyle değildi" hissi veriyordu.
 *
 * ÇİZİM ÇAĞRISI. Bütün bitkiler TEK ağda birleştiriliyor: renk köşe
 * niteliğinde taşındığı için hepsi tek malzemeyi paylaşabiliyor. 40
 * bitki = 1 çizim çağrısı. Bitkiler ışın testine girmiyor (tıklama
 * `vur()` ile mm üstünden çözülüyor), o yüzden ayrı nesne olmaları
 * gerekmiyordu.
 */
Tarla.katman({
  kimlik: "bitkiler",
  ad: "Bitkiler",
  varsayilan: true,

  /** Simge tuvalinin yazi tipi. "BitkiEmoji" panelle birlikte gelen alt
   *  kume font (bkz. stil.css); digerleri fontu kurulu sistemler icin
   *  yedek. Raspberry Pi OS emoji fontuyla gelmedigi icin liste yalniz
   *  Segoe ve Noto ile bitince Pi'de bos kutu ciziliyordu. */
  SIMGE_FONT:
    "48px 'BitkiEmoji', system-ui, 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif",

  /** Tür → biçim arketipi. Katalogda boy alanı yok; siluet buradan. */
  ARKETIP: {
    marul: "rozet", ispanak: "rozet", lahana: "rozet", pazi: "rozet",
    roka: "rozet", semizotu: "rozet", karnabahar: "rozet", brokoli: "rozet",
    kereviz: "rozet",
    havuc: "tup", sogan: "tup", sarimsak: "tup", pirasa: "tup",
    maydanoz: "tup", dereotu: "tup", turp: "tup",
    domates: "dik", biber: "dik", patlican: "dik", bamya: "dik",
    fasulye: "dik", bezelye: "dik", nohut: "dik", patates: "dik",
    "tatli-patates": "dik",
    biberiye: "cali", "fesleğen": "cali", nane: "cali", kekik: "cali",
    aycicegi: "sap", misir: "sap",
    kabak: "sarilan", karpuz: "sarilan", kavun: "sarilan",
    salatalik: "sarilan", cilek: "sarilan", uzum: "sarilan",
  },

  /** Bitkinin en yükseğe çıkabileceği nokta (m). Ayçiçeği gerçekte
   *  kirişten uzun; panelde makineyi gizlememesi için tavan var. */
  TAVAN: 0.42,

  bitkiler(o) {
    return o.veri.noktalar.filter((n) => n && n.tur).map((n) => ({
      nokta: n,
      tur: o.veri.turler[n.tur] || { name_tr: n.tur, spread_mm: 200, color: "#5f9e46", icon: "🌱" },
      // Çözülmüş değerler: bitkinin ezmesi > türün ezmesi > katalog.
      // Türün ham alanını okuyan hiçbir hesap kalmasın; yoksa kart bir
      // sayı, halka başka bir sayı gösteriyor.
      d: (alan) => o.turAlani(n, alan),
    }));
  },

  /** Yaşa göre olgunluk 0..1 — hasat gününe yaklaştıkça bitki büyüyor. */
  olgunluk(b) {
    const gun = b.d("days_to_harvest").deger || 60;
    if (!b.nokta.ekim) return 1;
    return Math.max(0.06, Math.min(1, (Date.now() / 1000 - Number(b.nokta.ekim)) / 86400 / gun));
  },

  /** Simge dokusu — EMOJİYE GÖRE önbellekte.
   *
   * Eskiden her yeniden çizimde yeni CanvasTexture üretiliyordu: 40
   * bitkiyle sahnede 1700'den fazla doku birikiyordu (sürüklerken her
   * kare bir tur). Aynı emoji aynı dokuyu kullanıyor artık; malzeme de
   * paylaşılıyor, böylece simgeler tek bir GPU dokusuna bakıyor.
   */
  simgeMal(THREE, metin) {
    if (!this._simgeler) this._simgeler = {};
    const anahtar = metin || "🌱";
    if (!this._simgeler[anahtar]) {
      /* Tuval 128: 64'te emoji ekranda büyütülünce bulanıyordu. Simge
       * artık ekran üstünde SABİT boyutta durduğu için yakın plana
       * gelmesi de mümkün, dolayısıyla çözünürlük gerekiyor. */
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const ciz = () => {
        const g = c.getContext("2d");
        g.clearRect(0, 0, 128, 128);
        /* ARKA DAİRE. Emoji açık zeminde (çim, kuru toprak) kayboluyordu:
         * ikonların çoğu açık renkli ve ince konturlu. Arkasına yumuşak
         * kenarlı koyu bir daire koyunca hem açık hem koyu zeminde
         * okunuyor. Daire dokuya çiziliyor — ayrı bir nesne olsaydı
         * bitki başına bir çizim çağrısı daha demekti. */
        const gr = g.createRadialGradient(64, 62, 10, 64, 62, 60);
        gr.addColorStop(0.00, "rgba(12,14,12,0.82)");
        gr.addColorStop(0.62, "rgba(12,14,12,0.72)");
        gr.addColorStop(0.86, "rgba(12,14,12,0.30)");
        gr.addColorStop(1.00, "rgba(12,14,12,0)");
        g.fillStyle = gr;
        g.beginPath(); g.arc(64, 62, 60, 0, Math.PI * 2); g.fill();
        g.font = this.SIMGE_FONT.replace("48px", "72px");
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(anahtar, 64, 68);
      };
      ciz();
      const doku = new THREE.CanvasTexture(c);
      doku.anisotropy = 4;
      this._simgeler[anahtar] = new THREE.SpriteMaterial({
        map: doku, transparent: true, depthTest: false,
        /* EKRAN ÜSTÜNDE SABİT BOYUT. sizeAttenuation kapalıyken three.js
         * ölçeği kameraya olan uzaklıkla çarpıyor, yani perspektifin
         * küçültmesini geri alıyor. Uzaktaki bitkinin simgesi de
         * yakındaki kadar okunaklı kalıyor — simge bir NESNE değil bir
         * ETİKET; haritadaki yer imi gibi davranması doğru. */
        sizeAttenuation: false });

      // ZAMANLAMA. Webfont ilk cizim aninda hazir olmayabilir; dokular
      // onbellege alindigi icin o anda cizilen bos kutu KALICI olur. Font
      // gelince biriken butun simgeleri bir kez daha ciziyoruz. Sahneyi
      // ayrica isaretlemeye gerek yok: durum akisi yarim saniyede bir
      // yeniden cizdiriyor, needsUpdate o turda GPU'ya gidiyor.
      (this._yeniden = this._yeniden || []).push(() => {
        ciz(); doku.needsUpdate = true;
      });
      if (!this._fontBekleniyor && document.fonts && document.fonts.load) {
        this._fontBekleniyor = true;
        document.fonts.load(this.SIMGE_FONT, "🌱")
          .then(() => document.fonts.ready)
          .then(() => (this._yeniden || []).forEach((f) => f()))
          .catch(() => {});
      }
    }
    return this._simgeler[anahtar];
  },

  /* ==================================================== yaprak geometrisi
   *
   * Yaprak ayası: orta damar boyunca iki sıra köşe. Genişlik profili
   * sin(πt)^sivri — `sivri` büyüdükçe yaprak incelip mızrağa dönüyor.
   * `kivrim` ucu aşağı sarkıtıyor: düz duran yaprak kâğıt gibi görünüyor,
   * sarkma yapraklara ağırlık veriyor. `lob` kenarı dalgalandırıyor
   * (kabak, domates).
   *
   * 7 bölüm = 24 köşe, 28 üçgen. Şablon BİR KEZ üretilip önbellekte
   * tutuluyor; her yaprak aynı şablonun başka bir matrisle basılmışı.
   */
  yaprakSablon(THREE, sivri, lob) {
    if (!this._sablon) this._sablon = {};
    const anahtar = `${sivri}|${lob}`;
    if (this._sablon[anahtar]) return this._sablon[anahtar];
    const bolum = 7;
    const poz = [];
    for (let i = 0; i <= bolum; i++) {
      const t = i / bolum;
      const g = Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * t)), sivri)
              * (1 + lob * Math.sin(t * Math.PI * 5));
      const y = -0.42 * t * t;            // sarkma
      // KAYIKLIK. Kenarlar orta damardan biraz yukarıda: yaprak düz bir
      // şerit olmaktan çıkıp oluk gibi kıvrılıyor. Düz şeritte bütün
      // yüzeyin normali aynı olduğu için yaprak mukavva gibi tek renk
      // çıkıyordu; kıvrılınca ışık yaprağın üstünde geziniyor.
      // Kat payı KÜÇÜK olmak zorunda: 0,55 denendi, yaprak katlanmış
      // kâğıt uçak gibi keskin bir V oluyordu.
      const kayik = y + g * g * 0.11;
      poz.push(-g, kayik, t, 0, y, t, g, kayik, t);
    }
    const indis = [];
    for (let i = 0; i < bolum; i++) {
      const a = i * 3;
      indis.push(a, a + 1, a + 3, a + 1, a + 4, a + 3,      // sol yarım
                 a + 1, a + 2, a + 4, a + 2, a + 5, a + 4); // sağ yarım
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(poz, 3));
    g.setIndex(indis);
    g.computeVertexNormals();
    this._sablon[anahtar] = g;
    return g;
  },

  /** Meyve / çiçek tablası — düşük bölüntülü küre, 8×6 = 96 üçgen. */
  kureSablon(THREE) {
    if (!this._kure) this._kure = new THREE.SphereGeometry(1, 8, 6);
    return this._kure;
  },

  /** Gövde — altı kenarlı silindir, birim boy (matris uzatıyor). */
  sapSablon(THREE) {
    if (!this._sap) {
      this._sap = new THREE.CylinderGeometry(0.6, 1, 1, 6, 1, true);
      this._sap.translate(0, 0.5, 0);         // taban y=0
    }
    return this._sap;
  },

  /* ======================================================== arketipler
   *
   * Hepsi aynı sözleşme: parça listesi döndürüyor. Parça =
   * {geo, m4, renk}. Ölçü/döndürme matriste; geometri şablonu ortak.
   */
  parcalar(o, b, ol, rast) {
    const THREE = o.THREE;
    const rM = Math.max(0.02, (b.d("spread_mm").deger / 2) * o.MM);
    const tur = new THREE.Color(b.tur.color || "#5f9e46");
    const biçim = this.ARKETIP[b.nokta.tur] || "dik";

    /* YAPRAK RENGİ — arketip + türün kendi rengi.
     *
     * Önceki sürümde tek bir yeşil vardı ve türün rengi %15 karışıyordu:
     * marulla domates neredeyse aynı yeşildi. Şimdi renk ÖNCE arketipten
     * geliyor — bir marul (rozet) açık sarımsı yeşil, bir domates (dik)
     * koyu mavimsi yeşil, bir havuç (tüp) grimsi yeşil olur — sonra
     * türün katalog rengi üstüne %35 biniyor.
     *
     * Kırmızıyı yeşile karıştırmak hâlâ kahverengi veriyor, o yüzden
     * karışan şey RGB değil TON: domatesin kırmızısı yeşili sıcak
     * tarafa çekiyor, marulun açık yeşili aydınlatıyor. */
    const BICIM_RENK = {
      // [ton, doygunluk, açıklık] — ton 0,25 saf yeşil, altı sarıya,
      // üstü maviye kaçıyor.
      rozet:   [0.230, 0.58, 0.21],   // marul: açık, sarımsı
      tup:     [0.270, 0.40, 0.15],   // havuç sapı: grimsi, soğuk
      dik:     [0.295, 0.56, 0.13],   // domates: koyu, maviye çalan
      cali:    [0.258, 0.44, 0.16],   // fesleğen: mat, tozlu
      sap:     [0.243, 0.60, 0.18],   // ayçiçeği: canlı orta yeşil
      sarilan: [0.252, 0.52, 0.17],   // kabak: orta
    };
    const hsl = { h: 0.25, s: 0.4, l: 0.35 };
    tur.getHSL(hsl);
    const taban = BICIM_RENK[biçim] || BICIM_RENK.dik;
    /* Türün tonu ÇEMBERSEL karıştırılıyor. Doğrudan `(hsl.h - 0.25)`
     * demek bir hataydı: ton bir çember, kırmızı hem 0 hem 1'de duruyor.
     * Domatesin kırmızısı h≈0,97 olduğu için yaprak tonu 0,55'e —
     * camgöbeğine — fırlıyordu; biberin turuncusu h≈0,07 olduğu için
     * 0,23'e, hardal sarısına düşüyordu. Ölçüldü: yaprak pikseli
     * (102, 106, 33), yani kırmızı ile yeşil eşit.
     *
     * Doğrusu türün rengini SICAK/SOĞUK ekseninde okumak: kosinüs
     * çemberde sürekli, kırmızı +1 sıcak, camgöbeği -1 soğuk. Kayma da
     * küçük (±0,022) — tür rengi yaprağı yeşil bandın dışına çıkarmamalı,
     * yalnız içinde biraz itmeli. */
    const sicaklik = Math.cos(hsl.h * Math.PI * 2);
    const yaprakTon = taban[0] - sicaklik * 0.022;
    const yaprakDoy = o.kis(taban[1] + (hsl.s - 0.5) * 0.22, 0.26, 0.72);
    /* Açıklık DÜŞÜK tutuluyor. Güneş 2,15 şiddetinde ve yapraklar geniş
     * düz yüzeyler, yani ışığı neredeyse dik alıyorlar; albedo 0,30'un
     * üstünde olunca hepsi aynı soluk sarı-yeşile doyuyor ve tür farkı
     * kayboluyor. Koyu albedo + güçlü ışık = doygun yeşil. */
    const yaprakIsik = o.kis(taban[2] + (hsl.l - 0.45) * 0.12, 0.09, 0.26);
    // Her yaprak biraz başka: aynı tonun tek düzeliği bitkiyi plastik
    // gösteriyor. Sapma tohumlu, yani hep aynı yaprak hep aynı ton.
    const yaprakRenk = () => new THREE.Color().setHSL(
      yaprakTon + (rast() - 0.5) * 0.02,
      o.kis(yaprakDoy + (rast() - 0.5) * 0.10, 0.18, 0.70),
      o.kis(yaprakIsik * (0.76 + rast() * 0.34), 0.07, 0.30));
    /* Gövde yaprakla aynı yeşil olmamalı: gerçek sapta klorofil daha az,
     * odunlaştıkça kahveye kaçıyor. Aynı renk olunca bitki tek parça bir
     * yeşil kütle gibi okunuyordu. */
    const sapRenk = new THREE.Color().setHSL(
      0.19, 0.42, biçim === "cali" ? 0.16 : 0.13);

    const p = [];
    const M4 = () => new THREE.Matrix4();
    /** Yaprak yerleştir: yön (yatayda açı), eğim (yataydan yukarı), boy, en. */
    const yaprak = (aci, egim, boy, en, taban, sivri, lob, renk) => {
      const m = M4().makeTranslation(0, taban, 0);
      m.multiply(M4().makeRotationY(aci));
      m.multiply(M4().makeRotationX(-egim));
      m.multiply(M4().makeScale(en * boy, boy, boy));
      p.push({ geo: this.yaprakSablon(THREE, sivri, lob), m4: m,
               renk: renk || yaprakRenk() });
    };
    const sap = (boy, kalinlik, renk) => {
      p.push({ geo: this.sapSablon(THREE),
               m4: M4().makeScale(kalinlik, boy, kalinlik), renk: renk || sapRenk });
    };
    const kure = (x, y, z, r, renk) => {
      const m = M4().makeTranslation(x, y, z);
      m.multiply(M4().makeScale(r, r * 0.92, r));
      p.push({ geo: this.kureSablon(THREE), m4: m, renk: renk });
    };
    const ALTIN = 2.399963;   // altın açı: yapraklar üst üste binmiyor

    if (biçim === "rozet") {
      // Dışta yatık, içte dik yapraklar — marul/lahana silueti.
      // Rozet KALABALIK ve YATIK: marulun silueti dıştan içe sıkışan
      // bir yaprak yığını. Az yaprakla yıldız gibi duruyordu.
      const n = 11 + Math.floor(ol * 13);
      for (let i = 0; i < n; i++) {
        const f = i / Math.max(1, n - 1);
        const boy = rM * (0.30 + 0.24 * ol) * (0.72 + 0.56 * rast());
        yaprak(i * ALTIN + rast() * 0.3,
               0.26 + f * 0.85 + (rast() - 0.5) * 0.18,
               boy, 0.66, 0.006 + f * rM * 0.10, 0.80, 0.10);
      }
    } else if (biçim === "tup") {
      // İnce dik yapraklar, kökten çıkıyor — havuç/soğan.
      const n = 5 + Math.floor(ol * 9);
      const boy0 = Math.min(this.TAVAN, rM * (0.8 + 1.3 * ol));
      for (let i = 0; i < n; i++) {
        yaprak(i * ALTIN + rast() * 0.5,
               1.15 + (rast() - 0.5) * 0.55,
               boy0 * (0.65 + 0.60 * rast()), 0.13, 0.004, 1.7, 0);
      }
    } else if (biçim === "dik") {
      // Gövde + gövde boyunca yapraklar, olgunlaşınca meyve.
      const h = Math.min(this.TAVAN, rM * (0.55 + 1.25 * ol));
      sap(h, rM * (0.030 + 0.030 * ol));
      // Dik SEYREK ve YUKARI: domatesin silueti gövdeden ayrılan
      // birkaç dal. Kalabalık olursa çalıya dönüyor.
      const n = 4 + Math.floor(ol * 4);
      for (let i = 0; i < n; i++) {
        const f = 0.22 + 0.75 * (i / Math.max(1, n - 1));
        yaprak(i * ALTIN + rast() * 0.4,
               0.28 + (rast() - 0.5) * 0.5,
               rM * (0.33 + 0.22 * ol) * (0.75 + 0.5 * rast()),
               0.44, h * f, 1.0, 0.22);
      }
      if (ol > 0.55) {
        const adet = 1 + Math.floor(rast() * 3);
        for (let i = 0; i < adet; i++) {
          const a = rast() * Math.PI * 2, u = rM * (0.10 + 0.12 * rast());
          kure(Math.cos(a) * u, h * (0.45 + 0.35 * rast()), Math.sin(a) * u,
               rM * (0.10 + 0.07 * ol), tur);
        }
      }
    } else if (biçim === "cali") {
      // Kısa odunsu gövde, çok sayıda küçük yaprak — fesleğen/kekik.
      const h = rM * (0.35 + 0.55 * ol);
      sap(h, rM * 0.035, new THREE.Color("#6b5a3c"));
      const n = 10 + Math.floor(ol * 10);
      for (let i = 0; i < n; i++) {
        const f = 0.15 + 0.85 * rast();
        yaprak(i * ALTIN + rast() * 0.4,
               0.15 + rast() * 0.8,
               rM * 0.34 * (0.6 + 0.7 * rast()), 0.62, h * f, 0.75, 0);
      }
    } else if (biçim === "sap") {
      // Tek uzun sap + tepede tabla — ayçiçeği/mısır.
      const h = Math.min(this.TAVAN, rM * (1.1 + 1.9 * ol));
      sap(h, rM * (0.035 + 0.030 * ol));
      const n = 4 + Math.floor(ol * 4);
      for (let i = 0; i < n; i++) {
        yaprak(i * ALTIN + rast() * 0.4,
               0.35 + (rast() - 0.5) * 0.4,
               rM * (0.36 + 0.26 * ol) * (0.8 + 0.4 * rast()),
               0.42, h * (0.25 + 0.62 * (i / Math.max(1, n - 1))), 1.0, 0.12);
      }
      if (ol > 0.55) {
        const r = rM * (0.11 + 0.11 * ol);
        kure(0, h, 0, r, tur);
        // Taç yaprakları: tablanın çevresine yatık ince yapraklar
        const y = 10 + Math.floor(rast() * 4);
        for (let i = 0; i < y; i++) {
          yaprak((i / y) * Math.PI * 2 + rast() * 0.1,
                 -0.15 + (rast() - 0.5) * 0.3,
                 r * (1.5 + 0.5 * rast()), 0.34, h, 1.1, 0, tur);
        }
      }
    } else {                                   // sarılan
      // Yerde yayılan iri loblu yapraklar — kabak/karpuz/çilek.
      const n = 4 + Math.floor(ol * 5);
      for (let i = 0; i < n; i++) {
        const a = i * ALTIN + rast() * 0.4;
        const u = rM * (0.25 + 0.60 * rast()) * (0.4 + 0.6 * ol);
        const m = new THREE.Matrix4().makeTranslation(
          Math.cos(a) * u, 0.006 + rM * 0.05, Math.sin(a) * u);
        m.multiply(new THREE.Matrix4().makeRotationY(a + (rast() - 0.5) * 1.2));
        m.multiply(new THREE.Matrix4().makeRotationX(-(0.12 + rast() * 0.35)));
        const boy = rM * (0.40 + 0.25 * ol) * (0.8 + 0.5 * rast());
        m.multiply(new THREE.Matrix4().makeScale(boy * 0.85, boy, boy));
        p.push({ geo: this.yaprakSablon(THREE, 0.55, 0.30), m4: m, renk: yaprakRenk() });
      }
      if (ol > 0.65) {
        const a = rast() * Math.PI * 2, u = rM * 0.35;
        const r = rM * (0.16 + 0.12 * ol);
        kure(Math.cos(a) * u, r * 0.8, Math.sin(a) * u, r, tur);
      }
    }
    return p;
  },

  /* ==================================================== birleştirme
   *
   * three.js'in UMD paketinde BufferGeometryUtils YOK (modül sürümünde
   * var). Birleştirme elde: köşeler matrisle dönüştürülüp tek dizide
   * toplanıyor, renk köşe niteliğine yazılıyor. Böylece bütün parçalar
   * TEK malzemeyi paylaşıyor.
   */
  pisir(THREE, parcalar) {
    let kv = 0, ki = 0;
    parcalar.forEach((p) => {
      kv += p.geo.attributes.position.count;
      ki += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    });
    const poz = new Float32Array(kv * 3), nor = new Float32Array(kv * 3);
    const ren = new Float32Array(kv * 3), ind = new Uint32Array(ki);
    const v = new THREE.Vector3(), n3 = new THREE.Matrix3();
    let vo = 0, io = 0, tepe = 0;
    parcalar.forEach((p) => {
      const P = p.geo.attributes.position, N = p.geo.attributes.normal;
      n3.getNormalMatrix(p.m4);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(p.m4);
        const k = (vo + i) * 3;
        poz[k] = v.x; poz[k + 1] = v.y; poz[k + 2] = v.z;
        if (v.y > tepe) tepe = v.y;
        if (N) {
          v.fromBufferAttribute(N, i).applyMatrix3(n3).normalize();
          nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z;
        }
        ren[k] = p.renk.r; ren[k + 1] = p.renk.g; ren[k + 2] = p.renk.b;
      }
      const I = p.geo.index;
      const say = I ? I.count : P.count;
      for (let i = 0; i < say; i++) ind[io + i] = vo + (I ? I.getX(i) : i);
      io += say; vo += P.count;
    });
    return { poz, nor, ren, ind, tepe };
  },

  /** Bir bitkinin pişmiş geometrisi — bitki adına göre önbellekte.
   *  Sürüklerken her karede yeniden kurmamak için: olgunluk 24 kademeye
   *  yuvarlanıyor, yani gün içinde bir kez değişiyor. */
  bitkiVeri(o, b, ol) {
    if (!this._kutu) this._kutu = new Map();
    const rM = Math.max(0.02, (b.d("spread_mm").deger / 2) * o.MM);
    const anahtar = `${b.nokta.ad}|${b.nokta.tur}|${Math.round(rM * 1000)}`
                  + `|${Math.round(ol * 24)}|${b.tur.color}`;
    let v = this._kutu.get(anahtar);
    if (!v) {
      const D = window.FarmbotDoku;
      const rast = D ? D.uretec(D.tohumla(b.nokta.ad + "|" + b.nokta.tur)) : Math.random;
      v = this.pisir(o.THREE, this.parcalar(o, b, ol, rast));
      // Önbellek sınırlı: silinen bitkiler sonsuza kadar durmasın.
      if (this._kutu.size > 240) this._kutu.delete(this._kutu.keys().next().value);
      this._kutu.set(anahtar, v);
    }
    return v;
  },

  /** Bütün bitkileri tek ağda toplayan malzeme. Yaprak tek yüzlü bir
   *  şerit olduğu için iki yüz de çiziliyor. */
  bitkiMal(THREE) {
    if (!this._mal) {
      /* LAMBERT, Standard değil. Ölçtük: Standard malzemenin dielektrik
       * parlaması (F0 = 0,04) pürüzlülük 0,78'de bile güçlü güneşin
       * altında yaprağa BEYAZ ekliyordu — yaprak pikselinde mavi kanal
       * 51 yerine 76 çıkıyor, yani renk soluyor. Yaprak zaten mat bir
       * yüzey; o beyaz parlamanın karşılığı yok, tek yaptığı yeşili
       * öldürmek. Lambert'te parlama hiç yok, üstelik piksel başına
       * belirgin şekilde ucuz. */
      this._mal = new THREE.MeshLambertMaterial({
        vertexColors: true, side: THREE.DoubleSide });
    }
    return this._mal;
  },

  /** Çoklu seçimdeki bitkinin altına vurgu halkası. */
  secimHalkasi(o, n) {
    const halka = new o.THREE.Mesh(
      new o.THREE.RingGeometry(0.030, 0.040, 30),
      new o.THREE.MeshBasicMaterial({ color: "#3987e5", transparent: true, opacity: 0.9,
                                      side: o.THREE.DoubleSide }));
    halka.rotation.x = -Math.PI / 2;
    const al = o.dikimAlani(n.x, n.y);
    const y = (al && al.toprak_z != null) ? (Number(al.toprak_z) - o.toprakZ) * o.MM : 0;
    halka.position.set(o.sx(n.x), y + 0.005, o.sz(n.y));
    halka.raycast = () => {};
    return halka;
  },

  guncelle(o) {
    o.bosalt(o.grup);
    const THREE = o.THREE;
    const liste = this.bitkiler(o);

    /* Tek ağ: her bitkinin pişmiş dizileri konumuna kaydırılarak
     * kopyalanıyor. 40 bitki için ~40 bin köşe kopyası — sürüklerken bile
     * kare başına bir milisaniyenin altında, buna karşılık 40 yerine 1
     * çizim çağrısı. */
    let kv = 0, ki = 0;
    const veri = liste.map((b) => {
      const v = this.bitkiVeri(o, b, this.olgunluk(b));
      kv += v.poz.length / 3; ki += v.ind.length;
      /* y: bitkinin oturduğu YÜZEY. Sıfır değil — kaplar aynı hizada
       * olmayabiliyor ve alanın kendi toprak_z'si varsa bitki onun
       * üstünde durmalı. Alan yoksa ya da kendi değeri yoksa sıfır,
       * yani genel yüzey: eski davranış. */
      const al = o.dikimAlani(b.nokta.x, b.nokta.y);
      const y = (al && al.toprak_z != null) ? (Number(al.toprak_z) - o.toprakZ) * o.MM : 0;
      return { v, x: o.sx(b.nokta.x), y, z: o.sz(b.nokta.y), b };
    });
    if (kv) {
      const poz = new Float32Array(kv * 3), nor = new Float32Array(kv * 3);
      const ren = new Float32Array(kv * 3), ind = new Uint32Array(ki);
      let vo = 0, io = 0;
      veri.forEach((k) => {
        const v = k.v, n = v.poz.length / 3;
        for (let i = 0; i < n; i++) {
          const a = (vo + i) * 3, c = i * 3;
          poz[a] = v.poz[c] + k.x; poz[a + 1] = v.poz[c + 1] + k.y;
          poz[a + 2] = v.poz[c + 2] + k.z;
          nor[a] = v.nor[c]; nor[a + 1] = v.nor[c + 1]; nor[a + 2] = v.nor[c + 2];
          ren[a] = v.ren[c]; ren[a + 1] = v.ren[c + 1]; ren[a + 2] = v.ren[c + 2];
        }
        for (let i = 0; i < v.ind.length; i++) ind[io + i] = vo + v.ind[i];
        io += v.ind.length; vo += n;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(poz, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(ren, 3));
      geo.setIndex(new THREE.BufferAttribute(ind, 1));
      const ag = new THREE.Mesh(geo, this.bitkiMal(THREE));
      ag.castShadow = true;
      ag.raycast = () => {};        // tıklama vur() ile mm üstünden çözülüyor
      o.grup.add(ag);
    }

    // Simgeler ayrı: sprite birleştirilemiyor. Malzeme emojiye göre
    // paylaşıldığı için doku sayısı bitki sayısıyla artmıyor.
    const simgeAc = document.querySelector("#tarla-simge");
    if (simgeAc && (simgeAc.checked || simgeAc.getAttribute("aria-checked") === "true")) {
      /* Ölçek artık dünya birimi değil: sizeAttenuation kapalı olduğu
       * için sayı doğrudan ekran payı gibi davranıyor. 0,062 ≈ 950 px'lik
       * bir pencerede ~55 px: emoji rahat seçiliyor ama makineyi
       * örtmüyor. Bitkinin çapıyla DEĞİŞMİYOR — küçük bir fide de aynı
       * okunaklılıkta etiketlenmeli. */
      const SIMGE_OLCEK = 0.062;
      veri.forEach((k) => {
        const s = new THREE.Sprite(this.simgeMal(THREE, k.b.tur.icon));
        s.scale.setScalar(SIMGE_OLCEK);
        s.position.set(k.x, k.y + k.v.tepe + 0.035, k.z);
        s.raycast = () => {};
        o.grup.add(s);
      });
    }

    liste.forEach((b) => {
      if (o.secim.has(b.nokta.ad)) o.grup.add(this.secimHalkasi(o, b.nokta));
    });
    // Seçili bitkinin altına beyaz halka
    const s = o.secili;
    if (s && s.katman.tanim.kimlik === "bitkiler") {
      const halka = new o.THREE.Mesh(
        new o.THREE.RingGeometry(0.026, 0.034, 30),
        new o.THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85,
                                        side: o.THREE.DoubleSide }));
      halka.rotation.x = -Math.PI / 2;
      halka.position.set(o.sx(s.kayit.nokta.x), 0.006, o.sz(s.kayit.nokta.y));
      halka.raycast = () => {};
      o.grup.add(halka);
    }
    const su = liste.reduce((t, x) => t + (x.d("water_ml_per_day").deger || 0), 0);
    document.querySelector("#tarla-sayi").textContent =
      liste.length ? `${liste.length} bitki · günlük ${o.say(su / 1000, 1)} L su`
                   : "Henüz bitki yok";
    // Panel bölümünün başlığındaki özet: bölüm katlıyken de kaç bitki
    // olduğu görünsün.
    const ozet = document.querySelector("#bitki-ozet");
    if (ozet) ozet.textContent = liste.length ? `${liste.length} bitki` : "";
  },

  ciz2b(o, c) {
    const s = o.secili;
    this.bitkiler(o).forEach((b) => {
      const p = o.mm2b(b.nokta.x, b.nokta.y);
      const secili = s && s.katman.tanim.kimlik === "bitkiler" && s.kayit.nokta.ad === b.nokta.ad;
      const toplu = o.secim.has(b.nokta.ad);
      if (toplu) {
        c.beginPath(); c.arc(p.x, p.y, 10, 0, Math.PI * 2);
        c.strokeStyle = "#3987e5"; c.lineWidth = 2.5; c.stroke();
      }
      c.beginPath(); c.arc(p.x, p.y, secili ? 7 : 5, 0, Math.PI * 2);
      c.fillStyle = b.tur.color || "#5f9e46"; c.fill();
      if (secili) { c.strokeStyle = "#fff"; c.lineWidth = 2; c.stroke(); }
      c.fillStyle = "#c3c2b7";
      c.font = "10px ui-sans-serif, system-ui";
      c.fillText(b.nokta.ad, p.x + 9, p.y + 3);
    });
  },

  /** Kutu seçimine hangi öğelerin gireceği. Çekirdek yalnız {ad, x, y}
   *  istiyor; katman kapalıysa hiç sorulmuyor. */
  secilebilir(o) {
    return this.bitkiler(o).map((b) => ({ ad: b.nokta.ad, x: b.nokta.x, y: b.nokta.y }));
  },

  /** Tıklama yarıçapı bitkinin gövdesi kadar — yayılım dairesi kadar değil. */
  vur(o, mm) {
    let en = null, mesafe = 1e9;
    this.bitkiler(o).forEach((b) => {
      const d = Math.hypot(b.nokta.x - mm.x, b.nokta.y - mm.y);
      const esik = o.kis((b.d("spread_mm").deger / 2) * 0.35, 22, 55);
      if (d < esik && d < mesafe) { mesafe = d; en = b; }
    });
    return en;
  },

  tasi(o, b, mm, bitti) {
    b.nokta.x = Math.round(mm.x * 10) / 10;
    b.nokta.y = Math.round(mm.y * 10) / 10;
    if (!bitti) { this.guncelle(o); return; }
    const n = b.nokta;
    // Eğri alanları da gönderiliyor: "üstüne yaz" bütün kaydı değiştiriyor,
    // göndermezsek bitkiyi sürüklemek bağlı eğrileri siler.
    o.bitkiYaz(n)
      .catch((h) => o.gunluk(`✕ Taşınamadı: ${h.message}`, "hata"))
      .then(() => o.noktalariYukle());
  },

  sil(o, b) {
    o.api(`/api/noktalar?ad=${encodeURIComponent(b.nokta.ad)}`, { method: "DELETE" })
      .then((y) => {
        o.gunluk(`✓ '${b.nokta.ad}' silindi`, "ok");
        o.geriAlGoster(y && y.geri_al);      // 30 sn geri alınabilir
        return o.noktalariYukle();
      })
      .catch((h) => o.gunluk(`✕ Silinemedi: ${h.message}`, "hata"));
  },

  kart(o, b) {
    const t = b.tur, n = b.nokta;
    const ol = this.olgunluk(b);
    const gun = n.ekim ? Math.floor((Date.now() / 1000 - Number(n.ekim)) / 86400) : null;
    const hasat = b.d("days_to_harvest").deger || null;
    const kalan = gun != null && hasat ? Math.max(0, hasat - gun) : null;
    const ekstra = { days_to_harvest: kalan != null ? `(${kalan} kaldı)` : "" };
    return `<div class="tarla-kart-bas">
        <span class="simge">${o.kacisli(t.icon || "🌱")}</span>
        <div><b>${o.kacisli(t.name_tr || n.tur)}</b>
          <div class="alt-not">${o.kacisli(n.ad)} · X${o.say(n.x, 1)} Y${o.say(n.y, 1)} Z${o.say(n.z, 1)}</div>
        </div></div>
      <table class="tarla-ozellik">
        ${this.ozellikSatirlari(o, b, ekstra)}
        <tr><td>Büyüme</td><td><b>%${o.say(ol * 100, 0)}</b>${gun != null ? ` <span class="alt-not">(${gun}. gün)</span>` : ""}</td></tr>
      </table>
      <div class="alt-not">Buradaki değerler YALNIZ bu bitkiye işler. Türün
        tamamını değiştirmek için Tarla sekmesindeki “Tür özellikleri”.</div>
      ${this.egriBolumu(o, n, gun)}
      <div class="tarla-kart-dugme">
        <button class="dugme birincil" id="d-tarla-git">Buraya git</button>
        <button class="dugme tehlike" id="d-tarla-sil">Sil</button>
      </div>`;
  },

  /** Düzenlenebilir özellik satırları — tek bitki düzeyi.
   *
   * Türden farklı olan alan işaretli geliyor ve yanındaki ↺ türe döndürüyor;
   * "bu sayıyı ben mi koydum, katalogdan mı geldi" sorusu kartta cevaplı. */
  ozellikSatirlari(o, b, ekstra) {
    const alanlar = o.turAlanlari || {};
    // Girdiyi çekirdek çiziyor (`o.alanGirdisi`): sayı kutusu mu açılır
    // liste mi olacağına tek yer karar versin. `o.alanGorunur` da o anki
    // desende anlamsız alanları gizliyor.
    return Object.entries(alanlar)
      .filter(([, bilgi]) => o.alanGorunur(bilgi, (alan) => b.d(alan).deger))
      .map(([a, bilgi]) => {
        const c = b.d(a);
        return `<tr><td>${o.kacisli(bilgi.baslik)}</td><td>
        ${o.alanGirdisi(a, bilgi, c.deger, "bitki-alan")}
        <span class="alt-not">${o.kacisli(bilgi.birim)}</span>
        ${(ekstra && ekstra[a]) ? `<span class="alt-not">${o.kacisli(ekstra[a])}</span>` : ""}
        ${c.ozelMi ? `<button class="rozet-fark rozet-dugme bitki-alan-sifirla" data-alan="${a}"
            title="Türün değerine dön: ${o.kacisli(String(c.tur))} ${o.kacisli(bilgi.birim)}"
            >türden farklı ↺</button>` : ""}
        ${bilgi.not ? `<div class="alt-not">${o.kacisli(bilgi.not)}</div>` : ""}
      </td></tr>`;
      }).join("");
  },

  /** Bitkiye bağlanabilen eğriler ve bugünkü değerleri.
   *  Eğri yoksa bölüm hiç görünmüyor — boş bir açılır liste işe yaramıyor. */
  egriBolumu(o, n, gun) {
    const hepsi = o.egriler || [];
    if (!hepsi.length) return "";
    const yas = gun == null ? 0 : gun;
    const satir = (alan, tip, baslik) => {
      const uygun = hepsi.filter((e) => e.tip === tip);
      if (!uygun.length) return "";
      const secili = n[alan] || "";
      const d = secili ? o.egriDeger(secili, yas) : null;
      return `<tr><td>${o.kacisli(baslik)}</td><td>
        <select class="egri-sec" data-alan="${alan}">
          <option value="">(eğri yok)</option>
          ${uygun.map((e) => `<option${e.ad === secili ? " selected" : ""}>${o.kacisli(e.ad)}</option>`).join("")}
        </select>
        ${d != null ? `<b>${o.say(d, 0)}</b> <span class="alt-not">${o.kacisli(uygun[0].birim)}</span>` : ""}
      </td></tr>`;
    };
    const govde = satir("egri_su", "su", "Su eğrisi")
                + satir("egri_yayilim", "yayilim", "Yayılım eğrisi")
                + satir("egri_yukseklik", "yukseklik", "Yükseklik eğrisi");
    if (!govde) return "";
    return `<table class="tarla-ozellik egri-tablo">${govde}</table>`;
  },

  baglan(o, kok, b) {
    kok.querySelector("#d-tarla-git").onclick = () =>
      o.komut("git", { x: b.nokta.x, y: b.nokta.y, z: b.nokta.z });
    kok.querySelector("#d-tarla-sil").onclick = () => this.sil(o, b);
    kok.querySelectorAll(".egri-sec").forEach((sec) => {
      sec.onchange = () => {
        const n = b.nokta;
        n[sec.dataset.alan] = sec.value;
        o.bitkiYaz(n)
          .then(() => { o.gunluk(`✓ '${n.ad}' eğrisi güncellendi`, "ok"); return o.noktalariYukle(); })
          .catch((h) => o.gunluk(`✕ Eğri bağlanamadı: ${h.message}`, "hata"));
      };
    });

    // Tek bitki düzeyinde ezme. Türün geri kalanı etkilenmiyor.
    kok.querySelectorAll(".bitki-alan").forEach((g) => {
      g.onchange = () => {
        const alan = g.dataset.alan;
        // Odağı bırakıyoruz: kart tazelenirken yazılan alana dokunulmuyor,
        // Enter'a basıldığında odak alanda kalırsa işaret hiç görünmezdi.
        g.blur();
        o.bitkiEzme(b.nokta, alan, g.value)
          .then(() => o.gunluk(`✓ '${b.nokta.ad}' özelliği güncellendi`, "ok"))
          .catch((h) => o.gunluk(`✕ Kaydedilemedi: ${h.message}`, "hata"));
      };
    });
    kok.querySelectorAll(".bitki-alan-sifirla").forEach((d) => {
      d.onclick = () => (d.blur(), o.bitkiEzme(b.nokta, d.dataset.alan, null))
        .then(() => o.gunluk(`✓ '${b.nokta.ad}' türün değerine döndü`, "ok"))
        .catch((h) => o.gunluk(`✕ Sıfırlanamadı: ${h.message}`, "hata"));
    });
  },
});
