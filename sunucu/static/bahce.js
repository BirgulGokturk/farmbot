/* Bahçe modu — kullanıcı katmanı.
 *
 * NE YAPIYOR. Bahçeyle uğraşan ama robotla uğraşmak istemeyen biri için
 * ayrı bir ekran: koordinat yok, ayar yok, soru yok. Dokunuyor,
 * sürüklüyor, bitkisinin büyüdüğünü görüyor.
 *
 * ---------------------------------------------------------------------
 * DÖRT KARAR VE SEBEPLERİ
 * ---------------------------------------------------------------------
 *
 * 1. ZEMİN ÇİZİM DEĞİL, ÜST KAMERANIN KARESİ. Çizilmiş bir yatak güzel
 *    olabilir ama yalan söyler: kullanıcı ekranda gördüğü şeye bakıp
 *    "toprağım kurumuş" diyemez. Gerçek kare, bu ekranı bir oyun
 *    olmaktan çıkarıp bahçenin kendisi yapıyor. Bırakma noktası kameranın
 *    `mm_px` ölçeğiyle milimetreye çevriliyor.
 *
 *    KALİBRE DEĞİLSE KIRILMIYOR. Ölçek yoksa piksel-milimetre dönüşümü
 *    yapılamaz; ekran çizilmiş yatağa düşüyor, tek satırla sebebini
 *    söylüyor ve çalışmaya devam ediyor. "Kalibre et, sonra gel" demek,
 *    bahçesine bakmak isteyen birini kamera ayarına göndermek olurdu.
 *
 * 2. EKRAN KOORDİNATI ÖLÇÜLÜYOR, HESAPLANMIYOR. Tahta eğik duruyor (CSS
 *    3B dönüşümü). Parmağın değdiği pikselin hangi milimetreye denk
 *    geldiğini dönüşüm matrisini elle çarparak bulmak, CSS'teki her
 *    değişiklikte sessizce kayacak bir hesap demekti. Onun yerine
 *    düzlemin dört köşesine görünmez ölçü noktaları konuyor,
 *    `getBoundingClientRect` ile GERÇEK ekran yerleri okunuyor ve
 *    aradaki izdüşüm (homografi) buradan çıkarılıyor. Tarayıcı ne
 *    çiziyorsa hesap onu izliyor.
 *
 * 3. SORU SORULMUYOR, İŞ SIRAYA GİRİYOR. Kullanıcı iki bitkiye arka
 *    arkaya dokunduğunda ikincisinin "makine meşgul" diye reddedilmesi,
 *    kullanıcıyı makinenin takvimine uydurmak olurdu. İşler kuyruğa
 *    giriyor (`/api/bahce/is`), kullanıcı devam ediyor.
 *
 * 4. HER HAREKET GERÇEK BİR ŞEYE KARŞILIK GELİYOR. Ekrandaki robot
 *    makinenin bildirdiği konumda duruyor; hareket etmiyorsa görünmüyor.
 *    Süslemek için hareket eklenmedi. Sallanma bitkinin kendisi, robotun
 *    zıplaması gerçekten çalışıyor olması demek.
 *
 * BOŞTA ÇİZİM YOK. Bu dosyada `requestAnimationFrame` döngüsü yok: her
 * şey olayla tetikleniyor (durum paketi, kare haberi, dokunma). Süregelen
 * tek hareket CSS canlandırmaları ve onlar da "Sakin mod" ile kapanıyor.
 */
window.Bahce = (function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const P = () => window.Panel || {};

  /* Bahçe zemini saniyede beş kez değişmiyor: toprak yavaş bir şey.
     Kamera sekmesi 5 kare/sn istiyor çünkü orada görüntüyü inceliyorsun;
     burada zemin bir arka plan. 1 kare/sn, canlı akışın işlemci yükünü
     beşte birine indiriyor ve gözle fark edilmiyor. */
  const BH_FPS = 1;
  const KAMERA = "ust";
  /* Sulama süresi: teknik paneldeki toplu sulamanın varsayılanıyla aynı. */
  const SULAMA_SN = 3;

  const B = {
    acik: false,
    veri: null,
    imza: "",
    egik: true,
    sakin: false,
    sakinElle: false,     // kullanıcı elle seçti mi (sınamanın önünde)
    sinandi: false,
    secili: "",
    surukle: null,
    ertelenen: {},        // kart kimliği -> bu oturumda ertelendi
    tersMatris: null,
    olcuTs: 0,
    film: { kimlik: "", kareler: [], sira: 0, oynatici: 0 },
    sayac: { cizim: 0, kare: 0, istek: 0 },
  };

  /* ==================================================================== *
   * Küçük yardımcılar
   * ==================================================================== */
  const sayi = (d, v = 0) => {
    const s = Number(d);
    return Number.isFinite(s) ? s : v;
  };
  const kacisli = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  function gunluk(metin, sinif) {
    if (P().gunluk) P().gunluk(metin, sinif || "");
  }

  async function api(yol, secenek) {
    B.sayac.istek += 1;
    return P().apiIste(yol, secenek);
  }

  function gonder(yol, govde) {
    return api(yol, { method: "POST", body: JSON.stringify(govde) });
  }

  /* ==================================================================== *
   * Koordinat dünyaları
   *
   * Üç uzay var ve karıştırılırsa tohum yanlış yere düşer:
   *   mm      — yatak milimetresi, makinenin konuştuğu dil
   *   uv      — tahtanın kendi 0..1 kutusu (CSS yüzdesi)
   *   ekran   — parmağın değdiği piksel
   *
   * uv HER ZAMAN YATAK. Tahta bahçeyi çerçeveliyor, kamerayı değil.
   * Kamera karesi tahtanın altına, kendi milimetre yerine oturtuluyor
   * (`zeminYerlestir`) — böylece kare yatağın çok ötesini görüyor olsa
   * bile ekranda bahçe var, karenin kenarları kırpılıyor.
   *
   * Kalibre değilken kare hiç gösterilmiyor: ölçeksiz bir kareyi zemin
   * yapmak, üstüne konan her bitkiyi yanlış yere koymak demekti.
   * ==================================================================== */
  function kalib() {
    const k = (B.veri && B.veri.kamera) || {};
    return k.kalibre ? (k.kalibrasyon || null) : null;
  }

  function yatakSinir() {
    const s = (B.veri && B.veri.sinirlar) || {};
    const x = s.x || {}, y = s.y || {};
    return {
      x1: sayi(x.min, 0), x2: sayi(x.max, 535),
      y1: sayi(y.min, 0), y2: sayi(y.max, 630),
    };
  }

  /** Tahtanın gösterdiği milimetre dikdörtgeni = YATAK, kamera karesi değil.
   *
   * İlk deneme uv'yi kameranın piksel uzayına oturtmuştu ve yanlıştı:
   * üst kamera yatağın çok ötesini görüyor (bu kurulumda 1440 × 1080 mm),
   * yani ekranın dörtte üçü bahçenin dışı oluyor ve bahçe köşede minicik
   * kalıyordu. Şimdi tahta yatağı çerçeveliyor; kameranın karesi tahtanın
   * ALTINA, kendi milimetre yerine oturtuluyor (bkz. `zeminYaz`). */
  function mmUV(x, y) {
    const s = yatakSinir();
    return { u: (sayi(x) - s.x1) / Math.max(1, s.x2 - s.x1),
             v: (sayi(y) - s.y1) / Math.max(1, s.y2 - s.y1) };
  }

  function uvMM(u, v) {
    const s = yatakSinir();
    return { x: s.x1 + u * (s.x2 - s.x1), y: s.y1 + v * (s.y2 - s.y1) };
  }

  /** Yatağın en/boy oranı — tahtanın oranı bu. */
  function yatakOran() {
    const s = yatakSinir();
    return Math.max(0.2, (s.x2 - s.x1)) / Math.max(0.2, (s.y2 - s.y1));
  }

  /** Bir milimetre kaç EKRAN PİKSELİ — tahtanın ölçülen genişliğinden.
   *
   * Tahtanın en/boy oranı yatağın oranına eşitlendiği için iki eksende
   * aynı sayı: halka gerçekten daire, elips değil. */
  function pikselMM() {
    const d = $("#bh-duzlem");
    const s = yatakSinir();
    if (!d || !d.clientWidth) return 0.6;
    return d.clientWidth / Math.max(1, s.x2 - s.x1);
  }

  /* ------------------------------------------------------ ekran <-> uv */
  /** Dört köşenin ÖLÇÜLEN ekran yerinden birim kare -> ekran izdüşümü.
   *
   * Kaynak köşeler (0,0) (1,0) (1,1) (0,1) sırasında. Perspektif varken
   * dönüşüm afin değil projektif: üç nokta yetmiyor, dördü gerekiyor. */
  function homografi(k) {
    const [p0, p1, p2, p3] = k;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const sx = p0.x - p1.x + p2.x - p3.x;
    const sy = p0.y - p1.y + p2.y - p3.y;
    let a, b, c, d, e, f, g, h;
    if (Math.abs(sx) < 1e-6 && Math.abs(sy) < 1e-6) {
      // Eğim kapalı: dönüşüm afin, payda sabit 1.
      a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
      d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
      g = 0; h = 0;
    } else {
      const payda = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(payda) < 1e-9) return null;
      g = (sx * dy2 - dx2 * sy) / payda;
      h = (dx1 * sy - sx * dy1) / payda;
      a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x;
      d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
    }
    return [a, b, c, d, e, f, g, h, 1];
  }

  function matrisTers(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, Bv = f * g - d * i, C = d * h - e * g;
    const det = a * A + b * Bv + c * C;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
    return [
      A / det, (c * h - b * i) / det, (b * f - c * e) / det,
      Bv / det, (a * i - c * g) / det, (c * d - a * f) / det,
      C / det, (b * g - a * h) / det, (a * e - b * d) / det,
    ];
  }

  /** Düzlemin köşelerini ÖLÇEREK ekran->uv dönüşümünü tazeler.
   *
   * Ölçüm ucuz değil (dört `getBoundingClientRect`), o yüzden yalnız
   * gerekince: sürükleme başlarken, dokunulunca, ölçü değişince. Her
   * kare ölçmek boşta çizim yapmak demek olurdu. */
  function olcumTazele(zorla) {
    const simdi = Date.now();
    if (!zorla && B.tersMatris && simdi - B.olcuTs < 400) return B.tersMatris;
    const noktalar = [];
    for (let i = 0; i < 4; i++) {
      const el = document.querySelector(`.bh-olcu[data-kose="${i}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      noktalar.push({ x: r.left, y: r.top });
    }
    const m = homografi(noktalar);
    B.tersMatris = m ? matrisTers(m) : null;
    B.olcuTs = simdi;
    return B.tersMatris;
  }

  /** Ekran pikseli -> uv. Ölçüm alınamadıysa null. */
  function ekranUV(ekranX, ekranY) {
    const t = olcumTazele(false);
    if (!t) return null;
    const w = t[6] * ekranX + t[7] * ekranY + t[8];
    if (Math.abs(w) < 1e-9) return null;
    return { u: (t[0] * ekranX + t[1] * ekranY + t[2]) / w,
             v: (t[3] * ekranX + t[4] * ekranY + t[5]) / w };
  }

  /* ==================================================================== *
   * Veri
   * ==================================================================== */
  async function yukle() {
    try {
      const y = await api("/api/bahce");
      B.veri = y;
      ciz();
    } catch (hata) {
      gunluk(`✕ Bahçe yüklenemedi: ${hata.message}`, "hata");
      notYaz("Bahçe bilgisi alınamadı. Sunucuya ulaşılamıyor olabilir.");
    }
  }

  function notYaz(metin) {
    const el = $("#bh-not");
    if (!el) return;
    el.textContent = metin || "";
    el.classList.toggle("gizli", !metin);
  }

  /* ==================================================================== *
   * Çizim
   * ==================================================================== */
  function ciz() {
    if (!B.acik || !B.veri) return;
    B.sayac.cizim += 1;
    // SIRA ÖNEMLİ. Önce kartlar (tahtaya kalan yeri onlar belirliyor),
    // sonra tahtanın boyu, EN SON tahtanın üstündekiler. Ters sırada
    // halkalar tahtanın ESKİ ölçüsüyle çiziliyor ve pencere değişince
    // yatağın dışına taşıyorlardı.
    tahtaKur();
    kartlariYaz();
    tahtaBoyu();
    zeminYaz();
    cizimYaz();
    bitkileriYaz();
    kuyrukYaz();
    rafYaz();
    seriYaz();
    robotYaz();
  }

  function tahtaKur() {
    const tahta = $("#bh-tahta");
    const duzlem = $("#bh-duzlem");
    if (!tahta || !duzlem) return;
    const oran = yatakOran();
    const egim = B.egik ? 26 : 0;
    tahta.classList.toggle("egik", B.egik);
    // Eğik bakışta düzlem dikeyde kısalıyor; kabın oranını da kısaltıyoruz
    // ki tahta kutunun içinde ortalanmış küçük bir şerit gibi durmasın.
    const kabOran = oran / (B.egik ? Math.cos(egim * Math.PI / 180) : 1);
    tahta.style.setProperty("--bh-oran", String(kabOran));
    duzlem.style.aspectRatio = `${oran}`;
    duzlem.style.setProperty("--bh-govde-egim", `${egim}deg`);
    duzlem.style.transform = B.egik
      ? `rotateX(${egim}deg) scale(.96)` : "none";
    B.tersMatris = null;                 // yerleşim değişti, ölçüm bayat
  }

  /** Tahtanın yüksekliği = kartların altında EKRANDA KALAN yer.
   *
   * Sabit bir yüzde (58vh) kart sayısına göre değişmiyor: üç kart varken
   * tahta ekranın altına düşüyor ve kullanıcı bahçesini görmek için
   * kaydırmak zorunda kalıyordu. Bir ölçüm, çizim başına bir kez —
   * her karede değil. */
  function tahtaBoyu() {
    const tahta = $("#bh-tahta");
    const sar = document.querySelector(".bh-tahta-sar");
    if (!tahta || !sar) return;
    const kutu = sar.getBoundingClientRect();
    const ust = kutu.top;
    // Altta kalanlar: tohum rafı + kuyruk şeridi + boşluklar. Alçak
    // ekranda ikisi de kısalıyor (bkz. bahce.css @media).
    const altPayi = window.innerHeight < 620 ? 118 : 150;
    const kalan = window.innerHeight - ust - altPayi;
    // GENİŞLİK DE SINIRLIYOR. Yalnız yüksekliğe bakmak dar bir telefonda
    // yanlış: tahta oranı gereği genişliğe sığmıyorsa tarayıcı genişliği
    // kısıyor ama yükseklik olduğu gibi kalıyor ve tahta ekrandan taşıyor.
    const oran = sayi(
      getComputedStyle(tahta).getPropertyValue("--bh-oran"), 0.9) || 0.9;
    const enSiniri = Math.max(1, kutu.width) / Math.max(0.05, oran);
    const boy = Math.max(180, Math.min(620, kalan, enSiniri));
    tahta.style.setProperty("--bh-yukseklik", `${Math.round(boy)}px`);
  }

  function zeminYaz() {
    const im = $("#bh-zemin");
    const cizili = $("#bh-cizili");
    const bos = $("#bh-bos");
    if (!im) return;
    const kam = (B.veri && B.veri.kamera) || {};
    const son = (P().S && P().S.sonKare) ? P().S.sonKare[KAMERA] : null;

    if (kam.kalibre && son) {
      if (im.src !== son.adres) { im.src = son.adres; B.sayac.kare += 1; }
      im.hidden = false;
      zeminYerlestir();
      cizili.hidden = true;
      bos.hidden = true;
      notYaz("");
      return;
    }
    // --- kamera yok ya da kalibre değil: ÇİZİLMİŞ YATAĞA DÜŞÜYORUZ ---
    im.hidden = true;
    im.removeAttribute("src");
    cizili.hidden = false;
    bos.hidden = true;
    if (!kam.kalibre) {
      notYaz("Üst kamera henüz ölçeklenmedi, o yüzden zemin çizili yatak. "
             + "Bahçe çalışıyor; gerçek toprağı görmek için Kamera "
             + "sekmesinden üst kameraya ölçek verin.");
    } else if (!son) {
      notYaz("Üst kameradan henüz kare gelmedi — zemin çizili yatak.");
    }
  }

  /** Kamera karesini kendi MİLİMETRE YERİNE oturtur.
   *
   * Kare tahtayı doldurmuyor, tahtanın altında gerçekte durduğu yerde
   * duruyor: merkezi `ofset_x/y`, ölçüsü `genislik_px × mm_px`. Dönme ve
   * ayna da kalibrasyondan geliyor. Böylece fotoğraftaki bir toprak
   * parçası, o toprağın gerçekten bulunduğu milimetrede görünüyor —
   * bitkinin halkasıyla fotoğraftaki yeşil aynı yere düşüyor.
   */
  function zeminYerlestir() {
    const im = $("#bh-zemin");
    const k = kalib();
    if (!im || !k) return;
    const s = yatakSinir();
    const yatakEn = Math.max(1, s.x2 - s.x1), yatakBoy = Math.max(1, s.y2 - s.y1);
    const olcek = sayi(k.mm_px);
    const enMM = sayi(k.genislik_px, 640) * olcek;
    const boyMM = sayi(k.yukseklik_px, 480) * olcek;
    const merkez = mmUV(sayi(k.ofset_x), sayi(k.ofset_y));
    im.style.left = `${(merkez.u * 100).toFixed(3)}%`;
    im.style.top = `${(merkez.v * 100).toFixed(3)}%`;
    im.style.width = `${(enMM / yatakEn * 100).toFixed(3)}%`;
    im.style.height = `${(boyMM / yatakBoy * 100).toFixed(3)}%`;
    // Ayna ÖNCE, dönme SONRA — `tespit.piksel_mm` de bu sırayla yapıyor.
    // CSS sağdan sola uyguladığı için yazım sırası ters.
    im.style.transform = `translate(-50%, -50%) rotate(${sayi(k.donme)}deg) `
      + `scale(${k.ayna_x ? -1 : 1}, ${k.ayna_y ? -1 : 1})`;
  }

  /* --------------------------------------------------------- toprağın şekli */
  function cizimYaz() {
    const svg = $("#bh-cizim");
    if (!svg) return;
    const v = B.veri;
    const P1000 = (mmx, mmy) => {
      const p = mmUV(mmx, mmy);
      return `${(p.u * 1000).toFixed(1)},${(p.v * 1000).toFixed(1)}`;
    };
    const dikdortgen = (x1, y1, x2, y2) =>
      `${P1000(x1, y1)} ${P1000(x2, y1)} ${P1000(x2, y2)} ${P1000(x1, y2)}`;

    let ic = `<defs><pattern id="bh-tarama" width="14" height="14"
        patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="14" height="14" fill="rgba(79,184,232,.06)"/>
        <rect width="6" height="14" fill="rgba(79,184,232,.30)"/>
      </pattern></defs>`;

    // Dikim alanı: içi açık, DIŞI karanlık. Tek bir "even-odd" yol ile —
    // her alan için ayrı gölge kutusu, alanlar bitişikken çizgi çizgi
    // karanlık şeritler bırakıyordu.
    const alanlar = (v.alanlar || []);
    if (alanlar.length) {
      const dis = dikdortgen(-5000, -5000, 5000, 5000);
      const delikler = alanlar.map((a) =>
        dikdortgen(sayi(a.x1), sayi(a.y1), sayi(a.x2), sayi(a.y2))).join(" Z M ");
      ic += `<path class="disari" fill-rule="evenodd"
        d="M ${dis} Z M ${delikler} Z"/>`;
      alanlar.forEach((a) => {
        ic += `<polygon class="alan-cerceve" points="${
          dikdortgen(sayi(a.x1), sayi(a.y1), sayi(a.x2), sayi(a.y2))}"/>`;
      });
    }

    // Yasak bölgeler — ajanın bildirdikleri.
    (v.bolgeler || []).forEach((b) => {
      if (b.allow_if) return;      // koşullu bölge her zaman yasak değil
      ic += `<polygon class="yasak" points="${
        dikdortgen(sayi(b.x1 ?? b.x_min), sayi(b.y1 ?? b.y_min),
                   sayi(b.x2 ?? b.x_max), sayi(b.y2 ?? b.y_max))}"/>`;
    });

    // SUYUN GİDEMEDİĞİ ŞERİT. Sulama başlığı Z ekseninin yanında; makine
    // hedefin (dx,dy) kadar ötesine gidiyor. Yani hedef sınıra bu kadar
    // yakınsa makine oraya gidemez ve su o şeride düşemez.
    const bas = v.sulama_basligi || {};
    const s = yatakSinir();
    const dx = sayi(bas.dx), dy = sayi(bas.dy);
    const seritler = [];
    if (dx > 0) seritler.push([s.x2 - dx, s.y1, s.x2, s.y2]);
    if (dx < 0) seritler.push([s.x1, s.y1, s.x1 - dx, s.y2]);
    if (dy > 0) seritler.push([s.x1, s.y2 - dy, s.x2, s.y2]);
    if (dy < 0) seritler.push([s.x1, s.y1, s.x2, s.y1 - dy]);
    seritler.forEach((r) => {
      const p = dikdortgen(r[0], r[1], r[2], r[3]);
      ic += `<polygon class="susuz" points="${p}"/>`
          + `<polygon class="susuz-cerceve" points="${p}"/>`;
    });
    svg.innerHTML = ic;
  }

  /* ------------------------------------------------------------ bitkiler */
  function bitkiImza(b) {
    return [b.ad, b.x, b.y, b.tur, b.susadi ? 1 : 0, b.hasat ? 1 : 0,
            b.cakisik ? 1 : 0, Math.round(b.yaricap_mm)].join(":");
  }

  function bitkileriYaz() {
    const kap = $("#bh-bitkiler");
    if (!kap) return;
    const liste = (B.veri && B.veri.bitkiler) || [];
    // Tahtanın ölçüsü de imzada: halkalar piksel cinsinden çizildiği için
    // pencere değişince yeniden hesaplanmaları gerekiyor.
    const duzlem = $("#bh-duzlem");
    const imza = liste.map(bitkiImza).join("|")
      + `#${B.egik}#${B.secili}#${duzlem ? duzlem.clientWidth : 0}`;
    if (imza === B.imza) return;      // değişen bir şey yok — DOM'a dokunma
    B.imza = imza;

    const sablon = $("#bh-bitki-sablon");
    const eskiler = new Map();
    kap.querySelectorAll(".bh-bitki").forEach((e) => eskiler.set(e.dataset.ad, e));
    const pxMM = pikselMM();

    liste.forEach((b) => {
      let el = eskiler.get(b.ad);
      const yeni = !el;
      if (yeni) {
        el = sablon.content.firstElementChild.cloneNode(true);
        el.dataset.ad = b.ad;
        el.addEventListener("click", (o) => { o.stopPropagation(); menuAc(b, el); });
        kap.appendChild(el);
      } else {
        eskiler.delete(b.ad);
      }
      const p = mmUV(b.x, b.y);
      el.style.left = `${(p.u * 100).toFixed(2)}%`;
      el.style.top = `${(p.v * 100).toFixed(2)}%`;
      el.classList.toggle("cakisik", !!b.cakisik);
      el.classList.toggle("secili", B.secili === b.ad);
      el.setAttribute("aria-label",
        `${b.tur_ad}${b.susadi ? ", susadı" : ""}${b.hasat ? ", hasada hazır" : ""}`);

      const halka = el.querySelector('[data-rol="halka"]');
      // Halkanın çapı PİKSEL cinsinden veriliyor, yüzde değil.
      //
      // Yüzde denendi ve sessizce yanlıştı: yüzde, halkanın kapsayıcısına
      // (56 pikselik dokunma hedefi) göre çözülüyor, tahtaya göre değil.
      // 250 mm yayılımlı bir marulun halkası 158 piksel olması gerekirken
      // 26 piksel çiziliyordu — yani "yayılma çapı" diye gösterilen şey
      // yayılma çapı değildi ve çakışma uyarısı gözle doğrulanamıyordu.
      halka.style.width = `${(b.yaricap_mm * 2 * pxMM).toFixed(1)}px`;
      halka.style.height = `${(b.yaricap_mm * 2 * pxMM).toFixed(1)}px`;

      const simge = el.querySelector('[data-rol="simge"]');
      simge.textContent = b.simge || "🌱";
      // İKİSİ BİRDEN olabiliyor: susamış bir bitkinin hasadı da gelmiş
      // olabilir. Birini seçip ötekini gizlemek, bahçeye bakınca ne
      // gerektiğini yanlış göstermek olurdu.
      const balonlar = el.querySelector('[data-rol="balonlar"]');
      const isaretler = [];
      if (b.susadi) isaretler.push(["susadi", "💧", "susadı"]);
      if (b.hasat) isaretler.push(["hasat", "🧺", "hasada hazır"]);
      balonlar.hidden = !isaretler.length;
      balonlar.innerHTML = isaretler.map((i) =>
        `<span class="bh-balon ${i[0]}" title="${i[2]}">${i[1]}</span>`).join("");
      if (yeni && B.veri.ts && Date.now() / 1000 - sayi(b.ekim) < 20) {
        el.classList.add("yeni");
        setTimeout(() => el.classList.remove("yeni"), 800);
      }
    });
    eskiler.forEach((e) => e.remove());
  }

  function robotYaz() {
    const el = $("#bh-robot");
    if (!el) return;
    const v = B.veri || {};
    const k = v.konum || {};
    if (k.x == null || k.y == null) { el.hidden = true; return; }
    const p = mmUV(k.x, k.y);
    if (p.u < -0.2 || p.u > 1.2 || p.v < -0.2 || p.v > 1.2) { el.hidden = true; return; }
    el.hidden = false;
    el.style.left = `${(p.u * 100).toFixed(2)}%`;
    el.style.top = `${(p.v * 100).toFixed(2)}%`;
    el.classList.toggle("calisiyor", !!v.mesgul);
  }

  /* ------------------------------------------------------------- kartlar */
  function kartlariYaz() {
    const kap = $("#bh-kartlar");
    const sablon = $("#bh-kart-sablon");
    if (!kap || !sablon) return;
    const kartlar = ((B.veri && B.veri.kartlar) || [])
      .filter((k) => !B.ertelenen[k.kimlik]);
    kap.innerHTML = "";
    kartlar.forEach((k) => {
      const el = sablon.content.firstElementChild.cloneNode(true);
      el.dataset.kimlik = k.kimlik;
      el.querySelector('[data-rol="simge"]').textContent = k.simge || "🌱";
      el.querySelector('[data-rol="baslik"]').textContent = k.baslik;
      el.querySelector('[data-rol="aciklama"]').textContent = k.aciklama;
      el.querySelector('[data-rol="kanit"]').textContent = `Ölçüt: ${k.kanit}`;
      // Dar/alçak ekranda açıklama ve ölçüt gizleniyor — kaybolmasınlar
      // diye ikisi de başlıkta duruyor.
      el.title = `${k.aciklama}\nÖlçüt: ${k.kanit}`
        + (k.gerekce && k.gerekce.length ? `\n· ${k.gerekce.join("\n· ")}` : "");
      const evet = el.querySelector('[data-rol="evet"]');
      evet.textContent = k.evet;
      evet.onclick = () => kartCevap(el, k, true);
      el.querySelector('[data-rol="sonra"]').onclick = () => kartCevap(el, k, false);
      kap.appendChild(el);
    });
  }

  async function kartCevap(el, kart, evet) {
    el.classList.add(evet ? "ucdu" : "erteledi");
    B.ertelenen[kart.kimlik] = true;
    setTimeout(() => { el.remove(); tahtaBoyu(); }, 380);
    if (!evet) {
      gunluk(`${kart.baslik} — sonraya bırakıldı`);
      return;
    }
    try {
      if (kart.tip === "sula") {
        await isEkle("sula", kart.noktalar, { saniye: SULAMA_SN });
      } else if (kart.tip === "hasat") {
        await isEkle("foto", kart.noktalar);
      } else if (kart.tip === "ek") {
        await gonder("/api/bahce/ek", { tur: kart.tur, yerler: kart.yerler });
        gunluk(`✓ ${kart.yerler.length} tohum sıraya girdi`, "ok");
      }
      await yukle();
    } catch (hata) {
      gunluk(`✕ ${hata.message}`, "hata");
      notYaz(hata.message);
    }
  }

  /* -------------------------------------------------------------- kuyruk */
  function kuyrukYaz() {
    const yazi = $("#bh-kuyruk-yazi");
    const serit = $("#bh-kuyruk");
    const iptal = $("#bh-kuyruk-iptal");
    const onayD = $("#bh-onay");
    if (!yazi || !serit) return;
    const k = (B.veri && B.veri.kuyruk) || { isler: [], bekleyen: 0 };
    const calisan = k.calisan;
    const son = [...(k.isler || [])].reverse()
      .find((i) => i.durum === "bitti" || i.durum === "hata");
    serit.classList.toggle("aktif", !!calisan);

    // ONAY BEKLEYEN EKİM. Soru kutusu açmıyoruz: kullanıcı bu sırada
    // başka bir bitkiye dokunabilir, tohum sürükleyebilir. Makine
    // bekliyor, kullanıcı beklemiyor.
    const ekim = (B.veri && B.veri.ekim) || {};
    if (onayD) onayD.classList.toggle("gizli", !ekim.soru);
    if (ekim.soru) {
      yazi.textContent = ekim.soru
        + (ekim.toplam ? ` (${ekim.sira}/${ekim.toplam})` : "");
      serit.classList.add("aktif");
      if (iptal) iptal.classList.add("gizli");
      return;
    }

    if (calisan) {
      yazi.textContent = `${calisan.etiket} — robot çalışıyor`
        + (k.bekleyen ? ` · ${k.bekleyen} iş sırada` : "");
    } else if (k.bekleyen) {
      yazi.textContent = `${k.bekleyen} iş sırada — makine boşalınca başlıyor`;
    } else if (son && son.durum === "hata") {
      yazi.textContent = `${son.etiket} yapılamadı: ${son.mesaj}`;
    } else if (son) {
      yazi.textContent = `✓ ${son.etiket} — ${son.mesaj || "bitti"}`;
    } else if (B.veri && !B.veri.bagli) {
      yazi.textContent = "Robot bağlı değil — işler bağlanınca yapılacak.";
    } else {
      yazi.textContent = "Robot bekliyor.";
    }
    iptal.classList.toggle("gizli", !k.bekleyen);
  }

  async function isEkle(tip, noktalar, ek) {
    const y = await gonder("/api/bahce/is",
      Object.assign({ tip, noktalar }, ek || {}));
    if (B.veri) B.veri.kuyruk = y.kuyruk;
    kuyrukYaz();
    return y;
  }

  /* -------------------------------------------------------------- seri */
  function seriYaz() {
    const kutu = $("#bh-seri");
    const gun = $("#bh-seri-gun");
    if (!kutu || !gun) return;
    const s = (B.veri && B.veri.seri) || { gun: 0 };
    kutu.hidden = !s.gun;
    gun.textContent = s.gun;
    kutu.title = s.bugun_var
      ? "Bugün bahçeyle ilgilendin."
      : "Bugün henüz bir şey yapılmadı — gün bitmeden seri bozulmuyor.";
  }

  /* ==================================================================== *
   * Halka menü — bitkiye dokununca
   * ==================================================================== */
  function menuKapat() {
    const m = $("#bh-menu");
    if (!m) return;
    m.classList.remove("acik");
    m.hidden = true;
    m.innerHTML = "";
    if (B.secili) { B.secili = ""; B.imza = ""; bitkileriYaz(); }
  }

  function menuAc(bitki, el) {
    const m = $("#bh-menu");
    if (!m) return;
    B.secili = bitki.ad;
    B.imza = "";
    bitkileriYaz();
    const r = el.getBoundingClientRect();
    const mx = r.left + r.width / 2, my = r.top + r.height / 2;
    m.hidden = false;
    m.style.left = `${mx}px`;
    m.style.top = `${my}px`;

    // Menü ekranın dışına taşmasın: yer darsa halka yukarı yerine aşağı
    // açılıyor. Ekran dışında kalan bir düğmeye basılamaz.
    const yukari = my > 190 ? -1 : 1;
    const secenekler = [
      ["💧", "Sula", -84, 46 * yukari, "sula"],
      ["🧺", "Hasat", 84, 46 * yukari, "hasat"],
      ["📷", "Fotoğraf", 0, 96 * yukari, "foto"],
    ];
    const ad = document.createElement("span");
    ad.className = "ad";
    ad.style.left = "0px";
    ad.style.top = `${-96 * yukari}px`;
    ad.textContent = bitki.tur_ad + (bitki.susadi ? " · susadı" : "")
      + (bitki.hasat ? " · hasada hazır" : "");
    m.appendChild(ad);

    secenekler.forEach((s, i) => {
      const d = document.createElement("button");
      d.type = "button";
      d.style.left = `${s[2]}px`;
      d.style.top = `${s[3]}px`;
      d.style.transitionDelay = `${i * 40}ms`;
      // Emoji her ekranda çizilmiyor; adı da yazıyoruz.
      d.innerHTML = `<span class="im">${s[0]}</span><span class="yz">${s[1]}</span>`;
      d.setAttribute("aria-label", s[1]);
      d.onclick = (o) => { o.stopPropagation(); menuKapat(); menuIs(bitki, s[4]); };
      m.appendChild(d);
    });
    requestAnimationFrame(() => m.classList.add("acik"));
  }

  async function menuIs(bitki, is) {
    try {
      if (is === "sula") {
        await isEkle("sula", [bitki.ad], { saniye: SULAMA_SN });
        gunluk(`💧 ${bitki.tur_ad} sıraya girdi`, "ok");
      } else if (is === "hasat") {
        // HASAT KAYITTIR, hareket değil: makine toplayamıyor, toplayan
        // kullanıcı. Yaptığımız şey yeri boşaltmak — 30 saniye geri
        // alınabiliyor, o yüzden soru sormuyoruz.
        const y = await gonder("/api/bahce/hasat", { noktalar: [bitki.ad] });
        gunluk(`🧺 ${bitki.tur_ad} hasat edildi`, "ok");
        if (P().geriAlGoster && y.geri_al) P().geriAlGoster(y.geri_al);
        if (P().noktalariYukle) P().noktalariYukle();
      } else if (is === "foto") {
        // Fotoğraf İKİ İŞ YAPIYOR: şimdi bir kare arşivliyor ve filmi
        // açıyor. Ayrı iki düğme olsaydı kullanıcı "fotoğraf çektim,
        // nerede?" diye arardı. Makine hareket etmiyor — üst kamera
        // yatağın tamamını zaten görüyor.
        filmAc(bitki, true);
        return;
      }
      await yukle();
    } catch (hata) {
      gunluk(`✕ ${hata.message}`, "hata");
      notYaz(hata.message);
    }
  }

  /* ==================================================================== *
   * Sürükleme — tohum ve sulama kabı
   * ==================================================================== */
  function rafYaz() {
    const raf = $("#bh-raf");
    if (!raf) return;
    const turler = (B.veri && B.veri.turler) || [];
    if (raf.dataset.imza === String(turler.length)) return;
    raf.dataset.imza = String(turler.length);
    // Bahçede zaten olan türler önde: en çok kullanılan tohum en yakında.
    const bahcede = new Set(((B.veri && B.veri.bitkiler) || []).map((b) => b.tur));
    const sirali = [...turler].sort((a, b) =>
      (bahcede.has(b.slug) ? 1 : 0) - (bahcede.has(a.slug) ? 1 : 0));
    raf.innerHTML =
      `<button class="bh-tohum su" type="button" data-su="1"
        aria-label="Sulama kabı — bir bitkinin üstüne bırakın">
        <span class="im">💧</span><span>Sulama kabı</span></button>`
      + sirali.map((t) => `
        <button class="bh-tohum" type="button" data-tur="${kacisli(t.slug)}"
          aria-label="${kacisli(t.ad)} ek — toprağa sürükleyin">
          <span class="im">${kacisli(t.simge || "🌱")}</span>
          <span>${kacisli(t.ad)}</span></button>`).join("");
  }

  function surukleBasla(o) {
    const t = o.target.closest(".bh-tohum");
    if (!t || !B.acik) return;
    o.preventDefault();
    const su = t.dataset.su === "1";
    const tur = su ? null
      : ((B.veri.turler || []).find((x) => x.slug === t.dataset.tur) || null);
    if (!su && !tur) return;
    B.surukle = { su, tur, el: t, tasindi: false, x: o.clientX, y: o.clientY };
    t.classList.add("tutuluyor");
    try { t.setPointerCapture(o.pointerId); } catch { /* yakalanamadı */ }
    const tasiyici = document.createElement("div");
    tasiyici.className = "bh-tasiyici";
    tasiyici.textContent = su ? "💧" : (tur.simge || "🌱");
    document.body.appendChild(tasiyici);
    B.surukle.tasiyici = tasiyici;
    tasiyiciTasi(o);
    $("#bh-tahta").classList.toggle("su-tutuluyor", su);
    olcumTazele(true);
  }

  function tasiyiciTasi(o) {
    if (!B.surukle || !B.surukle.tasiyici) return;
    B.surukle.tasiyici.style.left = `${o.clientX}px`;
    B.surukle.tasiyici.style.top = `${o.clientY}px`;
  }

  function surukleTasi(o) {
    if (!B.surukle) return;
    // 4 piksel ölü bölge: dokunmatikte parmak hep biraz kayıyor ve her
    // dokunuş sürükleme sayılırsa tohuma basmak imkânsız oluyor.
    if (!B.surukle.tasindi &&
        Math.hypot(o.clientX - B.surukle.x, o.clientY - B.surukle.y) < 4) return;
    B.surukle.tasindi = true;
    tasiyiciTasi(o);
    if (B.surukle.su) { suHedefIsaretle(o); return; }
    const yer = birakmaYeri(o);
    hayaletYaz(yer);
  }

  function birakmaYeri(o) {
    const uv = ekranUV(o.clientX, o.clientY);
    if (!uv) return null;
    const mm = uvMM(uv.u, uv.v);
    const alanlar = (B.veri && B.veri.alanlar) || [];
    const icinde = alanlar.some((a) =>
      mm.x >= Math.min(a.x1, a.x2) && mm.x <= Math.max(a.x1, a.x2) &&
      mm.y >= Math.min(a.y1, a.y2) && mm.y <= Math.max(a.y1, a.y2));
    const s = yatakSinir();
    const sinirIci = mm.x >= s.x1 && mm.x <= s.x2 && mm.y >= s.y1 && mm.y <= s.y2;
    // Mevcut bir bitkinin yayılım çemberine giriyor mu — YASAK DEĞİL ama
    // görünür. Kullanıcı isterse sıkıştırabilir; bilmeden sıkıştırmasın.
    const yeniR = (B.surukle && B.surukle.tur
      ? sayi(B.surukle.tur.yayilim_mm, 120) : 120) / 2;
    const sikisik = ((B.veri && B.veri.bitkiler) || []).some((b) =>
      Math.hypot(mm.x - sayi(b.x), mm.y - sayi(b.y)) < yeniR + sayi(b.yaricap_mm));
    return { uv, mm, sikisik,
             olur: (alanlar.length ? icinde : sinirIci) && sinirIci };
  }

  function hayaletYaz(yer) {
    const h = $("#bh-hayalet");
    const duzlem = $("#bh-duzlem");
    if (!h || !duzlem) return;
    if (!yer) { h.hidden = true; return; }
    h.hidden = false;
    h.classList.toggle("olmaz", !yer.olur);
    h.classList.toggle("sikisik", !!yer.sikisik && yer.olur);
    // Hayaletin çapı da türün gerçek yayılımı: bırakmadan önce komşusuna
    // değip değmeyeceği görülsün.
    const cap = (B.surukle && B.surukle.tur
      ? sayi(B.surukle.tur.yayilim_mm, 120) : 120) * pikselMM();
    h.style.left = `${(yer.uv.u * 100).toFixed(2)}%`;
    h.style.top = `${(yer.uv.v * 100).toFixed(2)}%`;
    h.style.width = `${cap.toFixed(1)}px`;
    h.style.height = `${cap.toFixed(1)}px`;
  }

  function suHedefIsaretle(o) {
    const hedef = suHedefBul(o);
    document.querySelectorAll(".bh-bitki").forEach((e) =>
      e.classList.toggle("secili", !!hedef && e.dataset.ad === hedef.ad));
  }

  function suHedefBul(o) {
    let en = null, enUzak = 60;
    document.querySelectorAll(".bh-bitki").forEach((e) => {
      const r = e.getBoundingClientRect();
      const d = Math.hypot(o.clientX - (r.left + r.width / 2),
                           o.clientY - (r.top + r.height / 2));
      if (d < enUzak) { enUzak = d; en = e; }
    });
    if (!en) return null;
    return ((B.veri && B.veri.bitkiler) || []).find((b) => b.ad === en.dataset.ad) || null;
  }

  async function surukleBirak(o) {
    const s = B.surukle;
    if (!s) return;
    B.surukle = null;
    if (s.tasiyici) s.tasiyici.remove();
    s.el.classList.remove("tutuluyor");
    $("#bh-tahta").classList.remove("su-tutuluyor");
    $("#bh-hayalet").hidden = true;
    document.querySelectorAll(".bh-bitki.secili").forEach((e) =>
      e.classList.remove("secili"));
    if (!s.tasindi) return;                 // dokunup bıraktı, sürüklemedi

    try {
      if (s.su) {
        const hedef = suHedefBul(o);
        if (!hedef) { gunluk("Sulama kabını bir bitkinin üstüne bırakın"); return; }
        await isEkle("sula", [hedef.ad], { saniye: SULAMA_SN });
        gunluk(`💧 ${hedef.tur_ad} sıraya girdi`, "ok");
        kuyrukYaz();
        return;
      }
      const yer = birakmaYeri(o);
      if (!yer) return;
      if (!yer.olur) {
        notYaz("Oraya ekilemiyor: dikim alanının dışında. Toprağın olduğu "
               + "yer ekranda aydınlık duruyor.");
        return;
      }
      const y = await gonder("/api/bahce/ek",
        { tur: s.tur.slug, x: Math.round(yer.mm.x * 10) / 10,
          y: Math.round(yer.mm.y * 10) / 10 });
      gunluk(`🌱 ${s.tur.ad} sıraya girdi — robot oraya gidip ekecek`
             + (yer.sikisik ? " (komşusuna değiyor)" : ""), "ok");
      notYaz("");
      if (P().noktalariYukle) P().noktalariYukle();
      await yukle();
      if (y.noktalar && y.noktalar[0]) {
        const el = document.querySelector(
          `.bh-bitki[data-ad="${CSS.escape(y.noktalar[0].ad)}"]`);
        if (el) { el.classList.add("yeni"); setTimeout(() =>
          el.classList.remove("yeni"), 800); }
      }
    } catch (hata) {
      gunluk(`✕ ${hata.message}`, "hata");
      notYaz(hata.message);
    }
  }

  /* ==================================================================== *
   * Büyüme filmi
   *
   * Projenin en güzel yeri burası: bitkinin kendi fotoğraflarından
   * yapılmış, tohumdan bugüne bir film. Kareler üst kameradan günde bir
   * kırpılıyor (sunucu tarafı `arsiv.py`) ve pencere TÜRÜN OLGUN
   * yayılımına göre sabit — bitki karede gerçekten büyüyor.
   * ==================================================================== */
  function filmAdres(kimlik, damga) {
    const jeton = (P().S && P().S.jeton) || "";
    return `/api/bahce/film/kare?kimlik=${encodeURIComponent(kimlik)}`
      + `&damga=${encodeURIComponent(damga)}&jeton=${encodeURIComponent(jeton)}`;
  }

  async function filmAc(bitki, cek) {
    const ortu = $("#bh-film");
    if (!ortu) return;
    ortu.hidden = false;
    B.filmBitki = bitki;
    if (cek) {
      try {
        const y = await gonder("/api/bahce/foto", { noktalar: [bitki.ad] });
        if (y.cekilen && y.cekilen.length) gunluk("📷 Fotoğraf arşive eklendi", "ok");
        else if (y.atlanan && y.atlanan.length) gunluk(`⚠ ${y.atlanan[0].sebep}`, "uyari");
      } catch (hata) {
        gunluk(`✕ ${hata.message}`, "hata");
      }
    }
    $("#bh-film-ad").textContent = `${bitki.simge} ${bitki.tur_ad} — büyüme filmi`;
    $("#bh-film-bos").hidden = true;
    B.film = { kimlik: bitki.film_kimlik, kareler: [], sira: 0, oynatici: 0,
               ekim: sayi(bitki.ekim) };
    try {
      const y = await api(`/api/bahce/film?kimlik=${encodeURIComponent(bitki.film_kimlik)}`);
      B.film.kareler = y.kareler || [];
    } catch (hata) {
      B.film.kareler = [];
    }
    const serit = $("#bh-film-serit");
    serit.max = Math.max(0, B.film.kareler.length - 1);
    serit.value = Math.max(0, B.film.kareler.length - 1);
    B.film.sira = Number(serit.value);

    if (!B.film.kareler.length) {
      $("#bh-film-kare").removeAttribute("src");
      $("#bh-film-bos").hidden = false;
      const kam = (B.veri && B.veri.kamera) || {};
      $("#bh-film-bos").textContent = kam.kalibre
        ? "Bu bitkinin henüz fotoğrafı yok. Üst kamera günde bir kare "
          + "arşivliyor; ilk kare geldiğinde film burada başlayacak."
        : "Film için üst kameranın ölçeklenmesi gerekiyor — karenin hangi "
          + "milimetreye denk geldiği bilinmeden bitki kırpılamıyor.";
      $("#bh-film-oynat").disabled = true;
      $("#bh-film-sayi").textContent = "";
      $("#bh-film-gun").textContent = "";
      $("#bh-film-tarih").textContent = "";
      return;
    }
    $("#bh-film-oynat").disabled = B.film.kareler.length < 2;
    // Kareleri önden yükletiyoruz: oynatırken her karede ağ beklemek
    // filmi filme benzemekten çıkarıyor.
    B.film.kareler.forEach((k) => { new Image().src = filmAdres(B.film.kimlik, k.damga); });
    filmKareYaz();
  }

  function filmKareYaz() {
    const k = B.film.kareler[B.film.sira];
    if (!k) return;
    $("#bh-film-kare").src = filmAdres(B.film.kimlik, k.damga);
    const gun = B.film.ekim ? Math.max(0, Math.round((k.ts - B.film.ekim) / 86400)) : null;
    $("#bh-film-gun").textContent = gun == null ? "" : `${gun}. gün`;
    $("#bh-film-tarih").textContent =
      new Date(k.ts * 1000).toLocaleDateString("tr-TR");
    $("#bh-film-sayi").textContent = `${B.film.sira + 1}/${B.film.kareler.length}`;
    $("#bh-film-serit").value = String(B.film.sira);
  }

  function filmOynat() {
    if (B.film.oynatici) { filmDur(); return; }
    if (B.film.kareler.length < 2) return;
    if (B.film.sira >= B.film.kareler.length - 1) B.film.sira = 0;
    $("#bh-film-oynat").textContent = "⏸ Duraklat";
    B.film.oynatici = setInterval(() => {
      B.film.sira += 1;
      if (B.film.sira >= B.film.kareler.length) {
        B.film.sira = B.film.kareler.length - 1;
        filmDur();
      }
      filmKareYaz();
    }, 380);
  }

  function filmDur() {
    if (B.film.oynatici) clearInterval(B.film.oynatici);
    B.film.oynatici = 0;
    const d = $("#bh-film-oynat");
    if (d) d.textContent = "▶ Oynat";
  }

  function filmKapat() {
    filmDur();
    const o = $("#bh-film");
    if (o) o.hidden = true;
  }

  /* ==================================================================== *
   * Sekmeye giriş / çıkış
   * ==================================================================== */
  function hareketYaz() {
    document.body.classList.toggle("bh-hareketli",
      B.acik && !B.sakin && !document.hidden);
    const d = $("#bh-sakin");
    if (d) d.setAttribute("aria-pressed", B.sakin ? "true" : "false");
  }

  /* --------------------------------------------------- güç sınaması
   * BİR SANİYE ÖLÇÜP KARAR VERİYOR — sonra bırakıyor.
   *
   * Sallanma güzel ama bedava değil: GPU'suz bir tarayıcıda sürekli
   * canlandırma her karede yeniden çizim demek ve küçük bir bilgisayarda
   * bu ısı demek. Ölçtüğümüz şey tam olarak bu: sekmeye girerken bir
   * saniyelik kare süresi örneği alınıyor. Tarayıcı yetişemiyorsa sakin
   * moda geçiliyor ve SEBEBİ yazılıyor.
   *
   * Cihazı çekirdek sayısından tahmin etmedik: aynı Pi'de tarayıcı
   * hızlandırma açıkken de kapalıyken de çalışıyor ve ikisi arasındaki
   * fark on kat. Tahmin yerine ölçüm.
   *
   * Kullanıcının kendi seçimi HER ZAMAN kazanıyor: elle açıp kapattıysa
   * sınama karışmıyor. */
  const YAVAS_KARE_MS = 28;      // ~35 kare/sn altı "yetişemiyor" sayılıyor

  function gucSina() {
    if (B.sakinElle || B.sinandi || B.sakin) return;
    B.sinandi = true;
    const sureler = [];
    let onceki = performance.now();
    const bas = onceki;
    const adim = (t) => {
      sureler.push(t - onceki);
      onceki = t;
      if (t - bas < 1000 && B.acik) { requestAnimationFrame(adim); return; }
      if (!B.acik || sureler.length < 8) return;
      const sirali = sureler.slice(2).sort((a, b) => a - b);
      const orta = sirali[Math.floor(sirali.length / 2)];
      if (orta > YAVAS_KARE_MS) {
        B.sakin = true;
        hareketYaz();
        notYaz(`Bu ekranda hareket ağır kalıyor (kare ${orta.toFixed(0)} ms), `
               + "sakin moda geçtim — bahçe aynı, yalnız sallanma yok. "
               + "İstersen üstteki düğmeden geri açabilirsin.");
      }
    };
    requestAnimationFrame(adim);
  }

  function sekme(acik) {
    B.acik = !!acik;
    document.body.classList.toggle("bahce-sekmesi", B.acik);
    hareketYaz();
    menuKapat();
    if (!B.acik) {
      filmKapat();
      canliIste(false);
      return;
    }
    // 3B sahne bu kullanıcının işi değil ve arka planda çizmesinin bir
    // sebebi yok: sekmeden çıkınca çekirdek onu kendisi geri açıyor.
    if (window.Tarla && window.Tarla.gorunurluk) window.Tarla.gorunurluk(false);
    B.imza = "";
    B.ertelenen = {};
    B.sinandi = false;
    canliIste(true);
    yukle();
    setTimeout(gucSina, 900);   // sayfa otursun, sonra ölç
  }

  function canliIste(ac) {
    const kam = ((P().S && P().S.kameralar) || []).find((k) => k.ad === KAMERA);
    if (!kam || !kam.canli_var) return;
    // Açarken hız da gönderiliyor (Kamera sekmesi 5, bahçe 1): "zaten
    // canlı" diye atlamak hızı da atlamak olurdu ve bahçe, kameradan
    // devraldığı 5 kare/sn ile gereksiz yere işlemci yakardı.
    if (ac) {
      P().komutGonder("kamera", { kamera: KAMERA, canli: true, fps: BH_FPS });
      return;
    }
    if (kam.canli) P().komutGonder("kamera", { kamera: KAMERA, canli: false });
  }

  /* ==================================================================== *
   * Çekirdekten gelen haberler
   * ==================================================================== */
  function kareGeldi(kam) {
    if (!B.acik || kam !== KAMERA) return;
    zeminYaz();
  }

  function durumDegisti(d) {
    if (!B.acik || !B.veri) return;
    // Yalnız robotun yeri ve meşguliyet: bütün ekranı yeniden çizmek
    // saniyede iki kez DOM kurmak demekti.
    B.veri.konum = d.konum || {};
    B.veri.bagli = !!d.bagli;
    const mesgul = !!(d.hareket || (d.dizi && d.dizi.calisiyor));
    if (mesgul !== B.veri.mesgul) { B.veri.mesgul = mesgul; kuyrukYaz(); }
    robotYaz();
  }

  /** Ekim oturumu ilerledi — kuyruk şeridi onun da hâlini yazıyor. */
  function ekimDegisti(e) {
    if (!B.acik || !B.veri) return;
    const soru = {
      onay2: "Robot tohumu aldı. Ucunda duruyorsa devam ettirin.",
      onay1: "Uç takılı mı?",
      onay_uc: "Kafada hangi uç var?",
    }[String(e && e.durum)] || "";
    B.veri.ekim = {
      aktif: !!(e && e.aktif), onay: soru ? e.durum : "", soru,
      sira: (e && e.sira) || 0, toplam: (e && e.toplam) || 0,
    };
    kuyrukYaz();
  }

  function kuyrukDegisti(k) {
    if (!B.veri) return;
    B.veri.kuyruk = k;
    kuyrukYaz();
    // İş bitti: bahçenin hâli değişmiş olabilir (sulama damgası, yeni
    // bitki). Tek bir tazeleme, kartları da yeniliyor.
    if (B.acik && !k.calisan && !k.bekleyen) yukle();
  }

  /* ==================================================================== *
   * Bağlama
   * ==================================================================== */
  function bagla() {
    const egik = $("#bh-egik");
    if (egik) {
      try {
        B.egik = localStorage.getItem("farmbot_bahce_egik") !== "0";
      } catch { /* depolama kapalı — eğik kalır */ }
      egik.setAttribute("aria-pressed", B.egik ? "true" : "false");
      egik.textContent = B.egik ? "Eğik bak" : "Tepeden bak";
      egik.onclick = () => {
        B.egik = !B.egik;
        try { localStorage.setItem("farmbot_bahce_egik", B.egik ? "1" : "0"); }
        catch { /* boş */ }
        egik.setAttribute("aria-pressed", B.egik ? "true" : "false");
        egik.textContent = B.egik ? "Eğik bak" : "Tepeden bak";
        B.imza = "";
        ciz();
      };
    }
    const sakin = $("#bh-sakin");
    if (sakin) {
      try { B.sakin = localStorage.getItem("farmbot_bahce_sakin") === "1"; }
      catch { /* boş */ }
      sakin.onclick = () => {
        B.sakin = !B.sakin;
        B.sakinElle = true;      // elle seçim, sınamanın önünde
        if (!B.sakin) notYaz("");
        try { localStorage.setItem("farmbot_bahce_sakin", B.sakin ? "1" : "0"); }
        catch { /* boş */ }
        hareketYaz();
      };
    }
    const iptal = $("#bh-kuyruk-iptal");
    if (iptal) {
      iptal.onclick = async () => {
        try {
          const y = await gonder("/api/bahce/is/iptal", { kimlik: "hepsi" });
          kuyrukDegisti(y.kuyruk);
          gunluk(`${y.iptal} iş sıradan çıkarıldı`);
        } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
      };
    }
    const onayD = $("#bh-onay");
    if (onayD) {
      onayD.onclick = async () => {
        try {
          await gonder("/api/bahce/onay", {});
          gunluk("✓ Ekim devam ediyor", "ok");
        } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
      };
    }
    const kapat = $("#bh-film-kapat");
    if (kapat) kapat.onclick = filmKapat;
    const cekD = $("#bh-film-cek");
    if (cekD) {
      cekD.onclick = () => { if (B.filmBitki) filmAc(B.filmBitki, true); };
    }
    const oynat = $("#bh-film-oynat");
    if (oynat) oynat.onclick = filmOynat;
    const serit = $("#bh-film-serit");
    if (serit) {
      serit.oninput = () => { filmDur(); B.film.sira = Number(serit.value); filmKareYaz(); };
    }
    const ortu = $("#bh-film");
    if (ortu) ortu.onclick = (o) => { if (o.target === ortu) filmKapat(); };

    document.addEventListener("pointerdown", (o) => {
      if (o.target.closest(".bh-tohum")) { surukleBasla(o); return; }
      if (B.acik && !o.target.closest(".bh-menu")) menuKapat();
    });
    document.addEventListener("pointermove", surukleTasi);
    document.addEventListener("pointerup", surukleBirak);
    document.addEventListener("pointercancel", surukleBirak);
    addEventListener("resize", () => {
      B.tersMatris = null;
      if (B.acik) { B.imza = ""; tahtaBoyu(); bitkileriYaz(); }
    });
    // Sekme arkaya alınınca canlandırma dursun: görünmeyen bir ekranın
    // canlandırması saf ısı.
    document.addEventListener("visibilitychange", hareketYaz);
    addEventListener("keydown", (o) => {
      if (o.key === "Escape") { menuKapat(); filmKapat(); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bagla);
  } else {
    bagla();
  }

  /* Deneme kancası: ekranın kendi ölçtükleri. */
  function olcum() {
    return {
      acik: B.acik, egik: B.egik, sakin: B.sakin, sinandi: B.sinandi,
      kalibre: !!kalib(), bitki: ((B.veri || {}).bitkiler || []).length,
      kart: ((B.veri || {}).kartlar || []).length,
      kuyruk: (B.veri || {}).kuyruk || null,
      sayac: Object.assign({}, B.sayac),
      matris: !!olcumTazele(true),
    };
  }

  return { sekme, kareGeldi, durumDegisti, kuyrukDegisti, ekimDegisti, yukle, olcum,
           mmUV, uvMM, ekranUV, filmAc };
})();
