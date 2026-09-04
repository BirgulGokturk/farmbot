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
  /* SULAMA SURESI GONDERILMIYOR — burada sabit bir 3 saniye vardi.
   *
   * Her bitkinin kendi sulama suresi var (`ozel.sulama_saniye` > tur >
   * katalog varsayilani) ve kullanici onu tur kartindan ya da bitkinin
   * kartindan ayarliyor. Buradan sabit bir sayi gondermek o ayari
   * sessizce eziyordu: fide ile olgun bir marul ayni suyu aliyordu ve
   * ayarin neden islemedigi anlasilmiyordu. Sure verilmeyince sunucu her
   * bitkiyi kendi zincirinden cozuyor; hicbir ayar yapilmamissa sonuc
   * yine 3 saniye, yani kimsenin kurulumu degismiyor.
   * (`tarla.js`teki toplu sulama ayni karari daha once verdi.) */

  const B = {
    acik: false,
    veri: null,
    imza: "",
    egik: true,
    sakin: false,
    yukleniyor: false,
    yukleHatasi: 0,
    sakinElle: false,     // kullanıcı elle seçti mi (sınamanın önünde)
    sinandi: false,
    surukle: null,
    ertelenen: {},        // kart kimliği -> bu oturumda ertelendi
    tersMatris: null,
    olcuTs: 0,
    film: { kimlik: "", kareler: [], sira: 0, oynatici: 0 },
    secimKipi: false,
    secili: {},           // ad -> seçili mi (çoklu seçim)
    menuSecili: "",       // halka menüsü açık olan bitki
    kartAd: "",           // açık bitki kartının bitkisi
    kartTur: "",          // boş yer kartında SEÇİLEN tür (biz seçmiyoruz)
    kartMesgul: false,    // bir kart uçuyor: şeridi yeniden kurma
    kameraSerit: false,
    yakinIs: "",          // "yakından bak" işi çalışıyor mu
    zum: { o: 1, x: 0, y: 0 },
    isaretciler: new Map(),
    tutus: null,
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
    B.ileriMatris = m || null;
    B.tersMatris = m ? matrisTers(m) : null;
    B.olcuTs = simdi;
    return B.tersMatris;
  }

  /** uv -> ekran pikseli. `ekranUV`in tersi; yakınlaştırma çapası ve
   *  seçim kutusu bunu kullanıyor.
   *
   *  NEDEN ÖĞENİN `getBoundingClientRect`i DEĞİL: bitkiler 3B dönüşümlü
   *  bir düzlemin içinde duruyor ve orada bir öğenin "ekran dikdörtgeni"
   *  göründüğü yerle örtüşmüyor. Kutu seçimi bunu kullanınca hiçbir
   *  bitkiyi bulamıyordu. Aynı ÖLÇÜLEN dönüşümü iki yönde de kullanmak,
   *  iki tarafın da aynı gerçeği görmesi demek. */
  function uvEkran(u, v) {
    olcumTazele(false);
    const m = B.ileriMatris;
    if (!m) return null;
    const w = m[6] * u + m[7] * v + m[8];
    if (Math.abs(w) < 1e-9) return null;
    return { x: (m[0] * u + m[1] * v + m[2]) / w,
             y: (m[3] * u + m[4] * v + m[5]) / w };
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
   * Yakınlaştırma ve kaydırma
   *
   * Kalabalık bir yatakta bitkiler üst üste biniyor ve parmakla doğru
   * olana basmak imkânsızlaşıyor. Yakınlaştırma bunun çaresi — ve
   * ekran koordinatı ÖLÇÜLDÜĞÜ için (dört köşe, homografi) bırakma
   * noktası yakınlaştırmadan etkilenmiyor: tarayıcı ne çiziyorsa hesap
   * onu izliyor.
   * ==================================================================== */
  const ZUM_EN_AZ = 1, ZUM_EN_COK = 4;

  function zumUygula() {
    const duzlem = $("#bh-duzlem");
    const kap = $("#bh-zum");
    const tahta = $("#bh-tahta");
    if (!duzlem) return;
    const egim = B.egik ? 26 : 0;
    const z = B.zum;
    // Eğim düzlemde, yakınlaştırma onun DIŞINDAKİ katmanda: önce
    // izdüşüm, sonra ekran düzleminde büyütme. İkisi tek zincirde
    // olsaydı büyütme izdüşümden önce uygulanır ve ekranda birebir
    // karşılık gelmezdi.
    duzlem.style.transform = B.egik ? `rotateX(${egim}deg) scale(.96)` : "none";
    if (kap) {
      kap.style.transform =
        `translate(${z.x.toFixed(1)}px, ${z.y.toFixed(1)}px) scale(${z.o.toFixed(3)})`;
    }
    if (tahta) tahta.classList.toggle("yakinlasmis", z.o > 1.02);
    const rozet = $("#bh-zum-rozet");
    if (rozet) {
      rozet.textContent = z.o > 1.02 ? `${z.o.toFixed(1)}×` : "";
      rozet.hidden = z.o <= 1.02;
    }
    B.tersMatris = null;          // yerleşim değişti, ölçüm bayat
  }

  /** Kaydırmayı sınırla: tahta ekrandan tamamen kaçmasın. */
  function zumSinirla() {
    const t = $("#bh-tahta");
    if (!t) return;
    const pay = 0.5;             // yarısı dışarı çıkabilir, fazlası kaybolmak
    const enCok = { x: t.clientWidth * (B.zum.o - 1) / 2 + t.clientWidth * pay,
                    y: t.clientHeight * (B.zum.o - 1) / 2 + t.clientHeight * pay };
    B.zum.x = Math.max(-enCok.x, Math.min(enCok.x, B.zum.x));
    B.zum.y = Math.max(-enCok.y, Math.min(enCok.y, B.zum.y));
  }

  /* ÇAPA ÖLÇÜLEREK TUTULUYOR.
   *
   * İlk deneme, yakınlaştırmayı "kabın merkezine göre 2B ölçekleme"
   * varsayarak hesaplıyordu. Ama düzlem 3B eğik ve perspektif
   * izdüşümünden geçiyor: dönüşüm zincirindeki ölçekleme izdüşümden
   * ÖNCE uygulanıyor, yani ekranda gördüğün büyüme düz bir ölçekleme
   * değil. Parmağın altındaki nokta 28 mm kayıyordu.
   *
   * Doğrusu: yakınlaştırmadan önce parmağın altındaki uv'yi ÖLÇ, oranı
   * uygula, sonra o uv'nin nereye düştüğünü tekrar ÖLÇ ve aradaki farkı
   * kaydırmaya ekle. Zincir ne olursa olsun çalışıyor. */
  function zumla(oran, ekranX, ekranY) {
    const yeni = Math.max(ZUM_EN_AZ, Math.min(ZUM_EN_COK, oran));
    if (Math.abs(yeni - B.zum.o) < 1e-4) return;
    olcumTazele(true);
    const uv = ekranUV(ekranX, ekranY);
    B.zum.o = yeni;
    if (yeni <= ZUM_EN_AZ + 0.001) { B.zum.x = 0; B.zum.y = 0; }
    zumSinirla();
    zumUygula();
    if (!uv) return;
    olcumTazele(true);
    const yeniYer = uvEkran(uv.u, uv.v);
    if (!yeniYer) return;
    B.zum.x += ekranX - yeniYer.x;
    B.zum.y += ekranY - yeniYer.y;
    zumSinirla();
    zumUygula();
  }

  /* ==================================================================== *
   * Tahta el hareketleri — iki parmak yakınlaştırır, tek parmak seçer
   * ya da kaydırır.
   * ==================================================================== */
  function tahtaBagla() {
    const tahta = $("#bh-tahta");
    if (!tahta) return;
    // BİR KEZ BAĞLANIYOR. Bu işlev çizimden de çağrılıyor; korumasız
    // bırakıldığında her çizimde bir dinleyici daha ekleniyordu. İkinci
    // dinleyici tek dokunuşu çift dokunuş sanıp tahtayı kendiliğinden
    // 2.2× yakınlaştırıyor, seçim kutusu da bayat ölçüyle boşa çıkıyordu.
    if (tahta.dataset.bagli === "1") return;
    tahta.dataset.bagli = "1";

    tahta.addEventListener("pointerdown", (o) => {
      if (!B.acik) return;
      B.isaretciler.set(o.pointerId, { x: o.clientX, y: o.clientY });
      if (B.isaretciler.size === 2) {
        // İki parmak: yakınlaştırma başlıyor, varsa tek parmak işi iptal.
        const [a, b2] = [...B.isaretciler.values()];
        B.tutus = {
          mesafe: Math.hypot(a.x - b2.x, a.y - b2.y) || 1,
          zum: { ...B.zum },
          orta: { x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2 },
        };
        B.secimSurukle = null;
        B.kaydir = null;
        secimKutuGizle();
        return;
      }
      if (B.isaretciler.size !== 1) return;
      if (o.target.closest(".bh-bitki")) return;   // bitkinin kendi işi
      if (B.secimKipi) {
        B.secimSurukle = { x: o.clientX, y: o.clientY };
        try { tahta.setPointerCapture(o.pointerId); } catch { /* boş */ }
      } else if (B.zum.o > 1.02) {
        B.kaydir = { x: o.clientX, y: o.clientY, bx: B.zum.x, by: B.zum.y };
        tahta.classList.add("kaydiriliyor");
        try { tahta.setPointerCapture(o.pointerId); } catch { /* boş */ }
      }
      cifteDokunus(o);
    });

    tahta.addEventListener("pointermove", (o) => {
      if (B.isaretciler.has(o.pointerId)) {
        B.isaretciler.set(o.pointerId, { x: o.clientX, y: o.clientY });
      }
      if (B.tutus && B.isaretciler.size >= 2) {
        const [a, b2] = [...B.isaretciler.values()];
        const mesafe = Math.hypot(a.x - b2.x, a.y - b2.y) || 1;
        const orta = { x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2 };
        const oran = B.tutus.zum.o * (mesafe / B.tutus.mesafe);
        // Önce iki parmağın ortasını sabitleyerek büyüt, sonra ortanın
        // kendi kaymasını ekle: çimdik hem yakınlaştırıyor hem kaydırıyor.
        zumla(oran, B.tutus.orta.x, B.tutus.orta.y);
        B.zum.x += orta.x - B.tutus.orta.x;
        B.zum.y += orta.y - B.tutus.orta.y;
        B.tutus.orta = orta;
        B.tutus.mesafe = mesafe;
        B.tutus.zum = { ...B.zum };
        zumSinirla();
        zumUygula();
        o.preventDefault();
        return;
      }
      if (B.secimSurukle) { secimKutuCiz(o); o.preventDefault(); return; }
      if (B.kaydir) {
        B.zum.x = B.kaydir.bx + (o.clientX - B.kaydir.x);
        B.zum.y = B.kaydir.by + (o.clientY - B.kaydir.y);
        zumSinirla();
        zumUygula();
        o.preventDefault();
      }
    });

    const birak = (o) => {
      B.isaretciler.delete(o.pointerId);
      if (B.isaretciler.size < 2) B.tutus = null;
      if (B.secimSurukle) { secimKutuBitir(); B.secimSurukle = null; }
      if (B.kaydir) { B.kaydir = null; tahta.classList.remove("kaydiriliyor"); }
    };
    tahta.addEventListener("pointerup", birak);
    tahta.addEventListener("pointercancel", birak);

    // Fare tekerleği — masaüstünde yakınlaştırmanın beklenen yolu.
    tahta.addEventListener("wheel", (o) => {
      if (!B.acik) return;
      o.preventDefault();
      // Adım tekerleğin KENDİ miktarına bağlı, sabit değil. Sabit adım
      // iki ucu da bozuyordu: izleme yüzeyi saniyede onlarca ufak olay
      // gönderdiği için ekran fırlıyor, tek çentikli fare ise zar zor
      // kımıldıyordu. Satır/sayfa birimini piksele çeviriyoruz.
      const birim = o.deltaMode === 1 ? 16 : (o.deltaMode === 2 ? 400 : 1);
      const olcek = Math.exp(-(o.deltaY * birim) / 500);
      zumla(B.zum.o * Math.max(1 / 2.2, Math.min(2.2, olcek)),
            o.clientX, o.clientY);
    }, { passive: false });
  }

  /** Çift dokunuş: yakınlaş / geri dön. Dokunmatikte tekerlek yok. */
  function cifteDokunus(o) {
    const simdi = Date.now();
    const son = B.sonDokunus || { t: 0, x: 0, y: 0 };
    if (simdi - son.t < 320 && Math.hypot(o.clientX - son.x, o.clientY - son.y) < 40) {
      zumla(B.zum.o > 1.4 ? 1 : 2.2, o.clientX, o.clientY);
      B.sonDokunus = { t: 0, x: 0, y: 0 };
      return;
    }
    B.sonDokunus = { t: simdi, x: o.clientX, y: o.clientY };
  }

  /* ==================================================================== *
   * Çoklu seçim
   * ==================================================================== */
  function secimKutuCiz(o) {
    const kutu = $("#bh-secim-kutu");
    const duzlem = $("#bh-duzlem");
    if (!kutu || !duzlem || !B.secimSurukle) return;
    const r = duzlem.getBoundingClientRect();
    const x1 = Math.min(B.secimSurukle.x, o.clientX), x2 = Math.max(B.secimSurukle.x, o.clientX);
    const y1 = Math.min(B.secimSurukle.y, o.clientY), y2 = Math.max(B.secimSurukle.y, o.clientY);
    if (x2 - x1 < 6 && y2 - y1 < 6) return;
    kutu.hidden = false;
    // Kutu düzlemin İÇİNDE duruyor ama düzlem eğik; yüzdeyle koymak onu
    // toprağa yatırırdı. Ekran ölçüsünü düzlemin ölçüsüne çeviriyoruz.
    kutu.style.left = `${((x1 - r.left) / r.width * 100).toFixed(2)}%`;
    kutu.style.top = `${((y1 - r.top) / r.height * 100).toFixed(2)}%`;
    kutu.style.width = `${((x2 - x1) / r.width * 100).toFixed(2)}%`;
    kutu.style.height = `${((y2 - y1) / r.height * 100).toFixed(2)}%`;
    B.secimSurukle.son = { x1, x2, y1, y2 };
  }

  function secimKutuGizle() {
    const k = $("#bh-secim-kutu");
    if (k) k.hidden = true;
  }

  function secimKutuBitir() {
    const alan = B.secimSurukle && B.secimSurukle.son;
    secimKutuGizle();
    if (!alan) return;
    // KUTU uv UZAYINA ÇEVRİLİYOR, bitkiler ekrana değil.
    //
    // Bitkiler 3B eğik bir düzlemin içinde; oradaki bir öğenin
    // `getBoundingClientRect`i göründüğü yeri vermiyor ve kutu hiçbir
    // bitkiyi bulamıyordu. Kullanıcının ekranda çizdiği dikdörtgen,
    // toprakta bir DÖRTGEN — dört köşesini ölçülen dönüşümle uv'ye
    // çevirip bitkinin uv'sinin o dörtgenin içinde olup olmadığına
    // bakıyoruz. İki taraf da aynı ölçümden geçiyor.
    olcumTazele(true);
    const kose = [[alan.x1, alan.y1], [alan.x2, alan.y1],
                  [alan.x2, alan.y2], [alan.x1, alan.y2]]
      .map(([x, y]) => ekranUV(x, y));
    if (kose.some((k) => !k)) return;
    ((B.veri && B.veri.bitkiler) || []).forEach((b) => {
      const p = mmUV(b.x, b.y);
      if (dortgenIcinde(p, kose)) B.secili[b.ad] = true;
    });
    secimYaz();
  }

  /** Nokta dörtgenin içinde mi — ışın atma (kenar sayma). */
  function dortgenIcinde(p, kose) {
    let icinde = false;
    for (let i = 0, j = kose.length - 1; i < kose.length; j = i++) {
      const a = kose[i], b2 = kose[j];
      if ((a.v > p.v) !== (b2.v > p.v)
          && p.u < (b2.u - a.u) * (p.v - a.v) / (b2.v - a.v) + a.u) {
        icinde = !icinde;
      }
    }
    return icinde;
  }

  function secimYaz() {
    const adlar = Object.keys(B.secili).filter((a) => B.secili[a]);
    document.querySelectorAll("#bh-bitkiler .bh-bitki").forEach((el) => {
      el.classList.toggle("isaretli", !!B.secili[el.dataset.ad]);
    });
    // DÜĞMENİN ADI NE YAPTIĞINI, BU SATIR NASIL YAPILDIĞINI SÖYLÜYOR.
    // "Seç" tek başına hiçbir şey anlatmıyordu ve dokunmatikte kimse kutu
    // çizmeyi kendiliğinden denemez.
    const ipucu = $("#bh-sec-ipucu");
    if (ipucu) {
      ipucu.classList.toggle("gizli", !B.secimKipi);
      ipucu.textContent = adlar.length
        ? `${adlar.length} bitki seçili — kutuyu büyütebilir ya da tek tek dokunabilirsin.`
        : "Bir kutu çizin, içindeki bitkiler seçilsin — ya da tek tek dokunun.";
    }
    const cubuk = $("#bh-toplu");
    if (cubuk) {
      const gizliydi = cubuk.classList.contains("gizli");
      cubuk.classList.toggle("gizli", !adlar.length);
      // Toplu iş çubuğu kartların üstünde YER KAPLIYOR. Görünürlüğü
      // değiştiği anda tahta boyunu yeniden ölçüyoruz; yoksa tahta bir
      // çizim boyunca rafın üstüne taşıyor ve tohumlar ekrandan düşüyor.
      if (gizliydi === !!adlar.length) tahtaBoyu();
    }
    const sayi = $("#bh-toplu-sayi");
    if (sayi) sayi.textContent = `${adlar.length} bitki seçili`;
    const d = $("#bh-sec");
    if (d) {
      d.setAttribute("aria-pressed", B.secimKipi ? "true" : "false");
      d.textContent = adlar.length ? `${adlar.length} bitki seçili`
        : (B.secimKipi ? "Seçimi bitir" : "Birkaç bitki seç");
    }
    const tahta = $("#bh-tahta");
    if (tahta) tahta.classList.toggle("secim-kipi", B.secimKipi);
  }

  function secimBirak() {
    B.secili = {};
    secimYaz();
  }

  async function topluIs(is) {
    const adlar = Object.keys(B.secili).filter((a) => B.secili[a]);
    if (!adlar.length) return;
    try {
      if (is === "hasat") {
        const y = await gonder("/api/bahce/hasat", { noktalar: adlar });
        gunluk(`🧺 ${adlar.length} bitki hasat edildi`, "ok");
        if (P().geriAlGoster && y.geri_al) P().geriAlGoster(y.geri_al);
        if (P().noktalariYukle) P().noktalariYukle();
      } else {
        await isEkle(is, adlar, null);
        gunluk(`✓ ${adlar.length} bitki sıraya girdi`, "ok");
      }
      secimBirak();
      await yukle();
    } catch (hata) {
      gunluk(`✕ ${hata.message}`, "hata");
      notYaz("islem", hata.message);
    }
  }

  /* ==================================================================== *
   * Veri
   * ==================================================================== */
  /* Yükleme HATASI BİR SON DEĞİL.
   *
   * Sahada görülen şey: panel açıkken sunucu yeniden başlatıldı
   * (`guncelle.sh` → `systemctl restart`), araya düşen tek istek
   * "Failed to fetch" verdi ve ekranda çıkmaz bir uyarı kaldı. Oysa
   * sunucu iki saniye sonra geri gelmişti.
   *
   * Üç şey birden gerekiyordu:
   *   * SEBEBİ AYIRT ET. Ağ hatası (sunucu yeniden başlıyor), 404
   *     (sunucu eski sürümde, panel yeni) ve 401 (parola) bambaşka
   *     şeyler ve kullanıcının yapacağı şey de bambaşka.
   *   * KENDİ KENDİNE DENE. Yeniden başlatma birkaç saniye sürüyor;
   *     kullanıcıya "sen tazele" dedirtmenin sebebi yok.
   *   * ELDEKİNİ SİLME. Önceki iyi görüntü ekranda kalıyor, bahçe
   *     okunmaya devam ediyor; yalnız üstüne "yeniden deniyorum" notu
   *     düşüyor.
   */
  const YENIDEN_DENE_MS = [1200, 2500, 5000, 8000];

  async function yukle(deneme = 0) {
    if (B.yukleniyor) return;
    B.yukleniyor = true;
    try {
      const y = await api("/api/bahce");
      B.veri = y;
      B.yukleHatasi = 0;
      notYaz("yukleme", "");
      ciz();
    } catch (hata) {
      B.yukleHatasi = (B.yukleHatasi || 0) + 1;
      const kod = hata.kod;
      let metin;
      if (kod === 404) {
        metin = "Sunucu bu sürümde bahçeyi tanımıyor — panel güncel ama "
              + "sunucu eski. Pi'de `bash guncelle.sh` çalıştırın.";
      } else if (kod === 401) {
        metin = "Panel parolası kabul edilmedi; sayfayı yenileyip yeniden girin.";
      } else if (kod) {
        metin = `Bahçe bilgisi alınamadı (${kod}): ${hata.message}`;
      } else {
        // Ağ düzeyinde hata: sunucu kapalı ya da yeniden başlıyor.
        metin = "Sunucuya ulaşılamadı — büyük ihtimalle yeniden başlıyor.";
      }
      const tekrar = deneme < YENIDEN_DENE_MS.length && !kod;
      notYaz("yukleme", metin + (tekrar ? " Kendim yeniden deniyorum…"
                                        : B.veri ? " Ekrandaki bilgi son alınan hâli."
                                                 : ""));
      if (B.yukleHatasi === 1) gunluk(`✕ Bahçe yüklenemedi: ${hata.message}`, "hata");
      if (tekrar) {
        setTimeout(() => { B.yukleniyor = false; yukle(deneme + 1); },
                   YENIDEN_DENE_MS[deneme]);
        return;
      }
    } finally {
      if (!B.yukleniyor) return;
      B.yukleniyor = false;
    }
  }

  /** Soket yeniden bağlandı: sunucu geri geldi demek. */
  function baglandi() {
    if (!B.acik) return;
    B.yukleHatasi = 0;
    yukle();
  }

  /* UYARI SATIRI ANAHTARLI.
   *
   * Tek bir metin alanıydı ve iki ayrı kaynak ona yazıyordu: kameranın
   * hâli ve yükleme hatası. Kamera notu HER KAREDE yazılıyor (bahçede
   * saniyede bir), yani yükleme hatası ekrana çıktıktan bir saniye sonra
   * siliniyordu — hata görünmüyordu ama sebebi de anlaşılmıyordu.
   *
   * Artık her kaynağın kendi yeri var ve en acili gösteriliyor. Bir
   * kaynağın susması ötekini susturmuyor. */
  const NOT_SIRASI = ["yukleme", "islem", "zemin"];
  const NOTLAR = { yukleme: "", islem: "", zemin: "" };

  function notYaz(anahtar, metin) {
    // Tek argümanlı eski çağrı biçimi: "işlem" notu sayılıyor.
    if (metin === undefined) { metin = anahtar; anahtar = "islem"; }
    NOTLAR[anahtar] = metin || "";
    const el = $("#bh-not");
    if (!el) return;
    const gosterilecek = NOT_SIRASI.map((a) => NOTLAR[a]).find(Boolean) || "";
    el.textContent = gosterilecek;
    el.classList.toggle("gizli", !gosterilecek);
    // Yükleme hatası uyarı değil ARIZA: rengi de öyle olsun.
    el.classList.toggle("kopuk", !!NOTLAR.yukleme);
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
    secimYaz();
    kameraSeritYaz();
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
    zumUygula();
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
    // PARMAK EKRANDAYKEN TAHTA BOYU DEĞİŞMİYOR. Seçim kutusu ve
    // sürükleme, başladıkları andaki ekran ölçüsüne dayanıyor; tahta
    // ortada büyürse kutu toprakta bambaşka bir yere denk geliyor.
    // Bir çizim gecikmesi, yanlış bitkileri seçmekten iyidir.
    if (B.isaretciler.size || B.surukle || B.bitkiTutus) return;
    const kutu = sar.getBoundingClientRect();
    const ust = kutu.top;
    // ALTTA KALANLARI ÖLÇÜYORUZ, TAHMİN ETMİYORUZ. Sabit bir pay,
    // kamera şeridi açılınca yanlış oluyordu: şerit 230 piksel yer
    // kaplıyor ve tahta ekranın dışına düşüyordu. Ölçüm, ileride
    // eklenecek her şeride de kendiliğinden uyuyor.
    let altPayi = 24;
    ["#bh-kameralar", "#bh-raf", "#bh-kuyruk"].forEach((sec) => {
      const e = $(sec);
      if (e && !e.classList.contains("gizli") && e.offsetParent
          && e.parentElement !== sar) {
        altPayi += e.offsetHeight + 8;
      }
    });
    const kalan = window.innerHeight - ust - altPayi;
    // GENİŞLİK DE SINIRLIYOR. Yalnız yüksekliğe bakmak dar bir telefonda
    // yanlış: tahta oranı gereği genişliğe sığmıyorsa tarayıcı genişliği
    // kısıyor ama yükseklik olduğu gibi kalıyor ve tahta ekrandan taşıyor.
    const oran = sayi(
      getComputedStyle(tahta).getPropertyValue("--bh-oran"), 0.9) || 0.9;
    const enSiniri = Math.max(1, kutu.width) / Math.max(0.05, oran);
    const boy = Math.max(180, Math.min(620, kalan, enSiniri));
    tahta.style.setProperty("--bh-yukseklik", `${Math.round(boy)}px`);
    // Kamera şeridi tahtanın YANINDA duruyor; boyunu ona eşitliyoruz.
    // Kendi oranıyla bıraktığımızda şerit tahtadan uzun kalıyor, sarmalı
    // uzatıyor ve tohum rafını ekranın dışına itiyordu.
    const serit = $("#bh-kameralar");
    if (serit) {
      const yanyana = window.innerWidth > 900;
      serit.style.height = yanyana ? `${Math.round(boy)}px` : "";
    }
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
      notYaz("zemin", "");
      return;
    }
    // --- kamera yok ya da kalibre değil: ÇİZİLMİŞ YATAĞA DÜŞÜYORUZ ---
    im.hidden = true;
    im.removeAttribute("src");
    cizili.hidden = false;
    bos.hidden = true;
    if (!kam.kalibre) {
      notYaz("zemin",
             "Üst kamera henüz ölçeklenmedi, o yüzden zemin çizili yatak. "
             + "Bahçe çalışıyor; gerçek toprağı görmek için Kamera "
             + "sekmesinden üst kameraya ölçek verin.");
    } else if (!son) {
      notYaz("zemin", "Üst kameradan henüz kare gelmedi — zemin çizili yatak.");
    } else {
      notYaz("zemin", "");
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

    // ERİŞİLEMEYEN ŞERİT — O AN HANGİ İŞ YAPILACAKSA ONUN BAŞINA GÖRE.
    //
    // Üç baş da Z ekseninin merkezinde değil ve her birinin kendi kayması
    // var: makine hedefin (dx,dy) kadar ötesine gidiyor, yani hedef
    // sınıra bu kadar yakınsa o BAŞ oraya yetişemiyor. Şerit sabit
    // değil: sulama kabı tutulurken sulama başlığının, tohum
    // sürüklenirken tohum ucunun, nem ölçümü seçiliyken probun şeridi.
    const bas = aktifBas();
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

  /** O an hangi başın şeridi çizilmeli.
   *
   * Sürüklenen şey ne olduğuna bakıyor: sulama kabı → sulama başlığı,
   * tohum → tohum ucu, seçili iş nem ölçümü → prob. Hiçbiri yoksa
   * sulama başlığı, çünkü kenardaki şeridin en sık karşılaşılan hâli o.
   */
  function aktifBas() {
    const hepsi = (B.veri && B.veri.baslar) || {};
    let kimlik = B.aktifBas || "sulama";
    if (B.surukle) kimlik = B.surukle.su ? "sulama" : "tohum";
    return hepsi[kimlik] || {};
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
      + `#${B.egik}#${B.menuSecili}#${Object.keys(B.secili).join(",")}`
      + `#${duzlem ? duzlem.clientWidth : 0}`;
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
        bitkiElBagla(el);
        kap.appendChild(el);
      } else {
        eskiler.delete(b.ad);
      }
      const p = mmUV(b.x, b.y);
      el.style.left = `${(p.u * 100).toFixed(2)}%`;
      el.style.top = `${(p.v * 100).toFixed(2)}%`;
      el.classList.toggle("cakisik", !!b.cakisik);
      el.classList.toggle("secili", B.menuSecili === b.ad);
      el.classList.toggle("isaretli", !!B.secili[b.ad]);
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
  /** Ölçümün yaşını insanın söyleyeceği gibi yazar. */
  function yasKisa(sn) {
    const s = sayi(sn, 0);
    if (s < 90) return "az önce";
    if (s < 3600) return `${Math.round(s / 60)} dk önce`;
    if (s < 86400) return `${Math.round(s / 3600)} saat önce`;
    return `${Math.round(s / 86400)} gün önce`;
  }

  function kartlariYaz() {
    const kap = $("#bh-kartlar");
    const sablon = $("#bh-kart-sablon");
    if (!kap || !sablon) return;
    const kartlar = ((B.veri && B.veri.kartlar) || [])
      .filter((k) => !k.ertelendi && !B.ertelenen[k.kimlik]);
    // KARTLAR DEĞİŞMEDİYSE YENİDEN KURULMUYOR. Çizim saniyede bir
    // çalışıyor; her seferinde `innerHTML` yazmak kullanıcının kart
    // içinde yaptığı seçimi (hangi türü seçtiğini, eşik kutusuna
    // yazdığını) siliyordu. Bir de boşuna DOM işi.
    const imza = JSON.stringify(kartlar) + "|"
      + JSON.stringify((B.veri && B.veri.ertelenmis) || []);
    // Uçmakta olan bir kartın altından şeridi çekmiyoruz: erteleme
    // sunucuya yazılıyor, sunucu "bahçe değişti" diyor, panel yeniden
    // okuyor — ve kullanıcı "yarın 07:00'de soracağım" yazısını
    // okuyamadan kart siliniyordu.
    if (B.kartMesgul) return;
    if (kap.dataset.imza === imza) return;
    kap.dataset.imza = imza;
    kap.innerHTML = "";
    kartlar.forEach((k) => {
      const el = sablon.content.firstElementChild.cloneNode(true);
      const rol = (r) => el.querySelector(`[data-rol="${r}"]`);
      el.dataset.kimlik = k.kimlik;
      rol("simge").textContent = k.simge || "🌱";
      rol("baslik").textContent = k.baslik;
      rol("aciklama").textContent = k.aciklama;
      rol("kanit").textContent = `Ölçüt: ${k.kanit}`;
      // Dar/alçak ekranda açıklama ve ölçüt gizleniyor — kaybolmasınlar
      // diye ikisi de başlıkta duruyor.
      el.title = `${k.aciklama}\nÖlçüt: ${k.kanit}`
        + (k.gerekce && k.gerekce.length ? `\n· ${k.gerekce.join("\n· ")}` : "");
      if (k.kimlik === "sula") sulaKartiYaz(el, rol, k);
      if (k.kimlik === "bos-yer") bosYerKartiYaz(el, rol, k);
      const evet = rol("evet");
      evet.textContent = k.evet;
      evet.onclick = () => kartCevap(el, k, true);
      const sonra = rol("sonra");
      sonra.title = "Bu kartı yarın sabah yeniden sor";
      sonra.onclick = () => kartCevap(el, k, false);
      kap.appendChild(el);
    });
    ertelenmisYaz();
  }

  /* --------------------------------------------------- sulama kartı: kanıt */
  /** SAYIYI GÖSTERİYORUZ, "ölçüt: nem" demekle yetinmiyoruz.
   *
   * Kart eskiden "Ölçüt: ölçülen toprak nemi" yazıp sayıyı saklıyordu.
   * Kullanıcı kaç ölçüldüğünü, eşiğin kaç olduğunu, okumanın bitkiye ne
   * kadar yakın ve ne kadar taze olduğunu göremiyordu — yani gerekçeyi
   * göremiyordu. Ölçüm yoksa da bunu açıkça yazıyoruz: karar tahmine
   * dayanıyorsa kullanıcı bunu bilmeli. */
  function sulaKartiYaz(el, rol, k) {
    const liste = rol("olcum");
    const tumu = (k.olcumler || []);
    // Dört satırdan fazlası kartı bir yazı kulesine çeviriyor ve tahtayı
    // ekrandan itiyordu. Kalanı sayıyla söylüyoruz; hepsi `title`da.
    const satirlar = tumu.slice(0, 4);
    liste.innerHTML = satirlar.map((o) => {
      const olculdu = o.kanit === "olculen";
      const sol = `<b>${kacisli(o.tur_ad || o.ad)}</b>`;
      if (olculdu) {
        return `<li class="olculen" title="${kacisli(o.ad)}: ${kacisli(o.gerekce)}">${sol}
          <span class="bh-olcum-deger">%${Math.round(sayi(o.yuzde))}</span>
          <span class="bh-olcum-karsi">&lt; eşik %${Math.round(sayi(o.esik))}</span>
          <small>${Math.round(sayi(o.uzak_mm))} mm · ${
            kacisli(yasKisa(o.yas_sn))}</small></li>`;
      }
      const olcum = o.bayat
        ? `%${Math.round(sayi(o.yuzde))} sulamadan önce ölçülmüş`
        : (o.var ? `%${Math.round(sayi(o.yuzde))} ölçüldü, eşik kapalı`
          : "ölçüm yok — tahmin");
      return `<li class="tahmini" title="${kacisli(o.ad)}: ${kacisli(o.gerekce)}">${sol}
        <span class="bh-olcum-deger">${o.gecen_gun != null
          ? `${Math.round(sayi(o.gecen_gun))} gün` : "—"}</span>
        <span class="bh-olcum-karsi">geçti</span>
        <small>${kacisli(olcum)}</small></li>`;
    }).join("");
    if (tumu.length > satirlar.length) {
      liste.innerHTML += `<li class="bh-olcum-daha">+${
        tumu.length - satirlar.length} bitki daha</li>`;
    }
    liste.hidden = !satirlar.length;

    const uyari = rol("tahmin");
    if (k.tahmin) {
      uyari.textContent = k.olculen_adet
        ? `${k.tahmin_adet} bitkide ölçüm kullanılamadı — o kadarı tahmin.`
        : "Bu karar ÖLÇÜME değil, son sulamadan geçen güne dayanıyor.";
      uyari.hidden = false;
    } else {
      uyari.hidden = true;
    }

    // Eşik bahçeden değiştirilebiliyor. Aynı yere yazıyoruz: tür ezmesi.
    const kutu = rol("esik-kutu");
    const girdi = rol("esik");
    const not = rol("esik-not");
    kutu.hidden = false;
    girdi.value = k.esik == null ? "" : String(Math.round(k.esik));
    girdi.placeholder = k.esik == null ? "farklı" : "";
    not.textContent = k.esik == null
      ? "Bu karttaki türlerin eşikleri farklı — yazdığın sayı hepsine geçer."
      : (k.esik >= 100
        ? "%100 = kapalı: ölçülen nem kullanılmıyor. Bir sayı yaz, ölçüme geçsin."
        : `${(k.turler || []).length} tür için: ${(k.turler || []).join(", ")}`);
    rol("esik-kaydet").onclick = () => esikKaydet(k, sayi(girdi.value, NaN), not);
  }

  async function esikKaydet(kart, yuzde, not) {
    if (!Number.isFinite(yuzde) || yuzde < 0 || yuzde > 100) {
      not.textContent = "Eşik %0 ile %100 arasında bir sayı olmalı.";
      return;
    }
    try {
      const y = await gonder("/api/bahce/esik",
        { turler: kart.turler || [], yuzde });
      gunluk(`✓ Nem eşiği %${Math.round(y.yuzde)} — ${y.turler.join(", ")}`, "ok");
      // KENDİ EŞİĞİ OLAN BİTKİYİ SAKLAMIYORUZ: tür ezmesi onları yenmiyor
      // ve kullanıcı değişmeyen bir sayıyı değişmiş sanırdı.
      if (y.kendi_esigi_olan && y.kendi_esigi_olan.length) {
        notYaz("islem", `${y.kendi_esigi_olan.join(", ")} kendi eşiğini `
          + "kullanıyor, tür eşiği onları etkilemedi.");
      }
      await yukle();
    } catch (hata) {
      not.textContent = hata.message;
    }
  }

  /* ------------------------------------------------- boş yer kartı: tür seç */
  /** TÜRÜ KULLANICI SEÇİYOR.
   *
   * Kart eskiden "en son ekilen tür"ü kendi seçip "12 tane daha maydanoz
   * sığıyor" diyordu — maydanozu kullanıcı seçmemişti. Şimdi seçenekler
   * ekranda; seçilince sayı o türün KENDİ yayılım çapından yeniden
   * hesaplanıyor (marul 250 mm → 6, roka 150 mm → 12). Seçilmeden Ek
   * çalışmıyor. */
  function bosYerKartiYaz(el, rol, k) {
    const kutu = rol("turler");
    kutu.hidden = false;
    kutu.innerHTML = (k.secenekler || []).map((t) => `
      <button type="button" class="bh-tur-sec${t.hazne ? "" : " hazne-yok"}"
        data-tur="${kacisli(t.slug)}"
        title="${kacisli(t.ad)} · yayılım ${Math.round(t.yayilim_mm)} mm${
          t.hazne ? "" : " · haznede tohumu yok"}">
        <span>${kacisli(t.simge)}</span>${kacisli(t.ad)}</button>`).join("");
    const evet = rol("evet");
    const aciklama = rol("aciklama");
    evet.disabled = true;
    evet.title = "Önce ne ekeceğini seç";

    async function turSec(slug) {
      kutu.querySelectorAll(".bh-tur-sec").forEach(
        (x) => x.classList.toggle("secili", x.dataset.tur === slug));
      aciklama.textContent = "Sayıyor…";
      try {
        const y = await api(`/api/bahce/bos-yer?tur=${encodeURIComponent(slug)}`);
        k.tur = y.tur;
        k.yerler = y.yerler;
        B.kartTur = slug;              // yeniden kurulunca hatırlansın
        rol("baslik").textContent = y.adet
          ? `${y.adet}${y.sinirda ? "+" : ""} ${y.ad} sığıyor`
          : `${y.ad} sığmıyor`;
        aciklama.textContent = y.adet
          ? `Yayılım ${Math.round(y.yayilim_mm)} mm.`
            + (y.hazne ? "" : " Haznede bu tohum yok — ekim reddedilir.")
          : `Yayılım ${Math.round(y.yayilim_mm)} mm — bu kadar yer kalmamış.`;
        evet.disabled = !y.adet || !y.hazne;
        evet.title = !y.adet ? "Bu türe yer yok"
          : (!y.hazne ? "Haznede bu tohum yok" : `${y.adet} tane ek`);
        evet.textContent = y.adet ? `${y.adet} tane ek` : "Ek";
      } catch (hata) {
        aciklama.textContent = hata.message;
        evet.disabled = true;
      }
    }

    kutu.querySelectorAll(".bh-tur-sec").forEach((d) => {
      d.onclick = () => turSec(d.dataset.tur);
    });
    // Kart yeniden kurulduysa (bahçe değişti) seçim KAYBOLMUYOR: sayıyı
    // yeniden soruyoruz, çünkü aradaki değişiklik boş yeri de değiştirmiş
    // olabilir. Eski sayıyı olduğu gibi geri koymak yalan olurdu.
    if (B.kartTur && (k.secenekler || []).some((t) => t.slug === B.kartTur)) {
      turSec(B.kartTur);
    }
  }

  /* ------------------------------------------------------------ erteleme */
  function ertelenmisYaz() {
    const el = $("#bh-ertelenmis");
    if (!el) return;
    const liste = (B.veri && B.veri.ertelenmis) || [];
    el.classList.toggle("gizli", !liste.length);
    if (!liste.length) return;
    const adlar = { sula: "Sulama", hasat: "Hasat", "bos-yer": "Boş yer" };
    el.innerHTML = liste.map((e) => `
      <span class="bh-ert">${kacisli(adlar[e.kimlik] || e.kimlik)} kartı
        <b>${kacisli(e.yazi)}</b> geri gelecek
        <button type="button" class="bh-ikon kucuk"
          data-ert="${kacisli(e.kimlik)}">Şimdi göster</button></span>`).join("");
    el.querySelectorAll("[data-ert]").forEach((d) => {
      d.onclick = async () => {
        try {
          await gonder("/api/bahce/ertele", { kimlik: d.dataset.ert, iptal: true });
          delete B.ertelenen[d.dataset.ert];
          await yukle();
        } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
      };
    });
  }

  async function kartCevap(el, kart, evet) {
    if (!evet) {
      // ERTELEME BİR SÖZ VERİYOR. Eskiden kart yalnız ekrandan siliniyordu
      // ve sayfa yenilenince geri geliyordu; kullanıcı erteledi mi iptal
      // mi etti bilmiyordu. Ne zaman geri geleceğini kartın üstüne yazıp
      // öyle uçuruyoruz.
      B.kartMesgul = true;
      try {
        const y = await gonder("/api/bahce/ertele", { kimlik: kart.kimlik });
        const b = el.querySelector('[data-rol="aciklama"]');
        if (b) b.textContent = `${y.yazi} yeniden soracağım.`;
        gunluk(`${kart.baslik} — ${y.yazi} yeniden sorulacak`);
        // Önce SÖZ okunur, sonra kart uçar. Ters sırada kullanıcı ne
        // dediğimizi görmüyor.
        setTimeout(() => el.classList.add("erteledi"), 700);
        setTimeout(() => {
          B.kartMesgul = false;
          el.remove(); tahtaBoyu(); yukle();
        }, 1200);
      } catch (hata) {
        B.kartMesgul = false;
        gunluk(`✕ ${hata.message}`, "hata");
        notYaz(hata.message);
      }
      return;
    }
    if (kart.tip === "ek" && !kart.tur) {
      notYaz("Önce ne ekeceğini seç.");
      return;
    }
    el.classList.add("ucdu");
    B.ertelenen[kart.kimlik] = true;
    B.kartMesgul = true;
    setTimeout(() => {
      B.kartMesgul = false;
      el.remove(); tahtaBoyu();
    }, 380);
    try {
      if (kart.tip === "sula") {
        await isEkle("sula", kart.noktalar);
      } else if (kart.tip === "hasat") {
        await isEkle("foto", kart.noktalar);
      } else if (kart.tip === "ek") {
        await gonder("/api/bahce/ek", { tur: kart.tur, yerler: kart.yerler });
        gunluk(`✓ ${kart.yerler.length} tohum sıraya girdi`, "ok");
      }
      // Bayrak DURUYOR: iş kuyrukta, bitki hâlâ susuz. Kartı hemen geri
      // getirmek "yaptım" dediğim işi yapılmamış gibi göstermek olurdu.
      // Kuyruk boşalınca `kuyrukDegisti` bayrağı kaldırıyor.
      await yukle();
    } catch (hata) {
      delete B.ertelenen[kart.kimlik];
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
    if (B.menuSecili) { B.menuSecili = ""; B.imza = ""; bitkileriYaz(); }
  }

  function menuAc(bitki, el) {
    const m = $("#bh-menu");
    if (!m) return;
    B.menuSecili = bitki.ad;
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
    // NEM ÖLÇÜMÜ MENÜDE. Nem probu artık makinenin üstünde kalıcı:
    // "bu bitkinin nemini ölç" diyebilmek, kartın dayandığı sayıyı
    // kullanıcının kendisinin tazeleyebilmesi demek.
    const secenekler = [
      ["💧", "Sula", -84, 46 * yukari, "sula"],
      ["🧺", "Hasat", 84, 46 * yukari, "hasat"],
      ["🌡️", "Nem ölç", -84, 106 * yukari, "nem"],
      ["📷", "Fotoğraf", 84, 106 * yukari, "foto"],
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
        await isEkle("sula", [bitki.ad]);
        gunluk(`💧 ${bitki.tur_ad} sıraya girdi`, "ok");
      } else if (is === "hasat") {
        // HASAT KAYITTIR, hareket değil: makine toplayamıyor, toplayan
        // kullanıcı. Yaptığımız şey yeri boşaltmak — 30 saniye geri
        // alınabiliyor, o yüzden soru sormuyoruz.
        const y = await gonder("/api/bahce/hasat", { noktalar: [bitki.ad] });
        gunluk(`🧺 ${bitki.tur_ad} hasat edildi`, "ok");
        if (P().geriAlGoster && y.geri_al) P().geriAlGoster(y.geri_al);
        if (P().noktalariYukle) P().noktalariYukle();
      } else if (is === "nem") {
        // NEM ÖLÇÜMÜ GERÇEK BİR HAREKET: makine bitkinin üstüne gidiyor,
        // probu daldırıyor, okuyor, kaldırıyor. Okunan değer o bitkiye
        // yazılıyor ve kart bir dahaki sefere "kendi üstünden" diyor.
        await isEkle("nem", [bitki.ad]);
        gunluk(`🌡️ ${bitki.tur_ad}: nem ölçümü sıraya girdi`, "ok");
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
   * Bitkinin el hareketleri
   *
   * Bir bitkiye üç şey yapılabiliyor ve üçü de aynı parmakla başlıyor:
   *   DOKUN       -> halka menü ("ne yapayım")
   *   UZUN BAS    -> bitki kartı ("bu bitki nasıl")
   *   SÜRÜKLE     -> bitkiyi taşı (kayıt işlemi, makine kımıldamıyor)
   *
   * Ayırt etme kuralı basit ve dokunmatikte çalışıyor: 6 pikselden fazla
   * kayarsa sürükleme, 480 ms basılı kalırsa uzun basma, ikisi de olmadan
   * kalkarsa dokunma. Ölü bölge şart — parmak hiçbir zaman tam durmuyor
   * ve her titremeyi sürükleme saymak bitkiyi yanlışlıkla taşımak demek.
   * ==================================================================== */
  const UZUN_BASMA_MS = 480;
  const OLU_BOLGE_PX = 6;

  function bitkiElBagla(el) {
    el.addEventListener("pointerdown", (o) => {
      if (!B.acik) return;
      o.stopPropagation();
      const ad = el.dataset.ad;
      if (B.secimKipi) {
        B.secili[ad] = !B.secili[ad];
        secimYaz();
        return;
      }
      o.preventDefault();
      try { el.setPointerCapture(o.pointerId); } catch { /* boş */ }
      const durum = {
        ad, x: o.clientX, y: o.clientY, tasindi: false, uzun: false,
        zaman: setTimeout(() => {
          durum.uzun = true;
          if (P().gunluk) { /* sessiz */ }
          kartAc(bitkiBul(ad));
        }, UZUN_BASMA_MS),
      };
      B.bitkiTutus = durum;
      olcumTazele(true);
    });

    el.addEventListener("pointermove", (o) => {
      const d = B.bitkiTutus;
      if (!d || d.uzun) return;
      if (!d.tasindi &&
          Math.hypot(o.clientX - d.x, o.clientY - d.y) < OLU_BOLGE_PX) return;
      if (!d.tasindi) {
        clearTimeout(d.zaman);
        d.tasindi = true;
        el.classList.add("tasiniyor");
      }
      const yer = birakmaYeri(o, bitkiBul(d.ad));
      if (yer) {
        el.style.left = `${(yer.uv.u * 100).toFixed(2)}%`;
        el.style.top = `${(yer.uv.v * 100).toFixed(2)}%`;
        el.classList.toggle("olmaz", !yer.olur);
        d.yer = yer;
      }
    });

    const birak = async (o) => {
      const d = B.bitkiTutus;
      if (!d) return;
      B.bitkiTutus = null;
      clearTimeout(d.zaman);
      el.classList.remove("tasiniyor", "olmaz");
      try { el.releasePointerCapture(o.pointerId); } catch { /* boş */ }
      if (d.uzun) return;                       // kart açıldı
      if (!d.tasindi) { menuAc(bitkiBul(d.ad), el); return; }
      if (!d.yer || !d.yer.olur) {
        notYaz("islem", "Oraya taşınamıyor — dikim alanının dışında.");
        B.imza = ""; bitkileriYaz();
        return;
      }
      try {
        await gonder("/api/bahce/tasi", {
          ad: d.ad, x: Math.round(d.yer.mm.x * 10) / 10,
          y: Math.round(d.yer.mm.y * 10) / 10 });
        gunluk("✓ Bitki taşındı", "ok");
        notYaz("islem", "");
        if (P().noktalariYukle) P().noktalariYukle();
      } catch (hata) {
        gunluk(`✕ Taşınamadı: ${hata.message}`, "hata");
        notYaz("islem", hata.message);
      }
      B.imza = "";
      await yukle();
    };
    el.addEventListener("pointerup", birak);
    el.addEventListener("pointercancel", birak);
  }

  function bitkiBul(ad) {
    return ((B.veri && B.veri.bitkiler) || []).find((b) => b.ad === ad) || null;
  }

  /* ==================================================================== *
   * Bitki kartı — uzun basınca
   * ==================================================================== */
  function kartRol(rol) {
    const k = $("#bh-kart");
    return k ? k.querySelector(`[data-rol="${rol}"]`) : null;
  }

  function kartKapat() {
    const k = $("#bh-kart");
    if (k) k.hidden = true;
    B.kartAd = "";
  }

  function kartAc(b) {
    const kutu = $("#bh-kart");
    if (!kutu || !b) return;
    menuKapat();
    B.kartAd = b.ad;
    kutu.hidden = false;
    kartRol("simge").textContent = b.simge || "🌱";
    kartRol("tur").textContent = b.tur_ad || b.tur || "Bitki";
    kartRol("alt").textContent = b.ad;

    const gun = sayi(b.yas_gun, 0);
    const olgun = sayi(b.olgun_gun, 0);
    kartRol("yas").textContent = b.ekim ? `${Math.round(gun)} gün` : "—";
    kartRol("hasat").textContent = !olgun ? "—"
      : b.hasat ? "hazır" : `${Math.max(0, Math.round(olgun - gun))} gün`;
    kartRol("su").textContent = b.sulama_ts
      ? sureKisa(Date.now() / 1000 - sayi(b.sulama_ts)) + " önce" : "hiç";
    kartRol("yayilim").textContent = b.yayilim_mm
      ? `${Math.round(b.yayilim_mm)} mm` : "—";

    const cubuk = kartRol("cubuk");
    const oran = olgun ? Math.max(0, Math.min(1, gun / olgun)) : 0;
    cubuk.style.width = `${(oran * 100).toFixed(0)}%`;
    cubuk.classList.toggle("doldu", oran >= 1);

    // GEREKÇE, KARTIN ASIL DEĞERİ. "Susadı" demek kolay; neden susadığını
    // söylemek, kullanıcının bir dahakine kendi karar verebilmesi demek.
    kartRol("gerekce").textContent =
      (b.susadi ? "Susadı: " : "Şu an sulama gerekmiyor: ") + (b.su_gerekce || "");
    const cak = kartRol("cakisma");
    cak.classList.toggle("gizli", !b.cakisik);
    cak.textContent = "Komşusunun yayılım çemberine giriyor — biri ötekini "
                    + "gölgeleyebilir. Sürükleyerek ayırabilirsin.";

    kartSeritYaz(b);
    kartRol("d-sula").onclick = () => { kartKapat(); menuIs(b, "sula"); };
    kartRol("d-hasat").onclick = () => { kartKapat(); menuIs(b, "hasat"); };
    kartRol("d-film").onclick = () => { kartKapat(); filmAc(b, false); };
    kartRol("d-yakin").onclick = () => yakinBak(b);
    kartRol("kapat").onclick = kartKapat;
  }

  function sureKisa(sn) {
    if (sn < 3600) return `${Math.max(1, Math.round(sn / 60))} dk`;
    if (sn < 86400) return `${Math.round(sn / 3600)} sa`;
    return `${Math.round(sn / 86400)} gün`;
  }

  async function kartSeritYaz(b) {
    const serit = kartRol("serit");
    if (!serit) return;
    serit.innerHTML = '<span class="bos">film yükleniyor…</span>';
    let kareler = [];
    try {
      kareler = (await api(`/api/bahce/film?kimlik=${encodeURIComponent(b.film_kimlik)}`)).kareler || [];
    } catch { kareler = []; }
    if (B.kartAd !== b.ad) return;          // kart kapandı ya da değişti
    if (!kareler.length) {
      serit.innerHTML = '<span class="bos">Henüz fotoğraf yok — üst kamera '
                      + 'günde bir kare arşivliyor.</span>';
      return;
    }
    // En yeni ALTI kare: kart bir film değil, filme davet.
    const son = kareler.slice(-6);
    serit.innerHTML = son.map((k) =>
      `<img src="${filmAdres(b.film_kimlik, k.damga)}" loading="lazy"
        alt="${new Date(k.ts * 1000).toLocaleDateString("tr-TR")}"
        title="${new Date(k.ts * 1000).toLocaleDateString("tr-TR")}">`).join("");
    serit.querySelectorAll("img").forEach((im) => {
      im.onclick = () => { kartKapat(); filmAc(b, false); };
    });
  }

  /** "Yakından bak": makineyi bitkinin üstüne gönderir, uç kamerasını açar. */
  async function yakinBak(b) {
    try {
      await gonder("/api/bahce/yakin", { ad: b.ad });
      B.yakinIs = b.ad;
      kameraSerit(true);
      gunluk(`🔍 ${b.tur_ad}: robot oraya gidiyor, uç kamerası açık`, "ok");
      kartKapat();
      await yukle();
    } catch (hata) {
      gunluk(`✕ ${hata.message}`, "hata");
      notYaz("islem", hata.message);
    }
  }

  /* ==================================================================== *
   * Kamera şeridi
   *
   * Üst kamera zaten tahtanın zemini; buradaki pencere onu eğimsiz ve
   * kırpılmamış gösteriyor. Uç kamerası kafada: makine bir işe gidince
   * orada ne gördüğü canlı izleniyor.
   *
   * ŞERİT KAPALIYKEN UÇ KAMERASI HİÇ AKMIYOR. İki akış, bakılmadığı
   * sürece ödenmeyecek bir bedel.
   * ==================================================================== */
  const UC_BOSTA_FPS = 1, UC_ISTE_FPS = 4;

  function kameraSerit(ac) {
    B.kameraSerit = !!ac;
    const s = $("#bh-kameralar");
    if (s) s.classList.toggle("gizli", !B.kameraSerit);
    const d = $("#bh-kamera-ac");
    if (d) d.setAttribute("aria-pressed", B.kameraSerit ? "true" : "false");
    try {
      localStorage.setItem("farmbot_bahce_kamera", B.kameraSerit ? "1" : "0");
    } catch { /* boş */ }
    ucCanliIste();
    if (B.kameraSerit) kameraSeritYaz();
  }

  function ucCanliIste() {
    const kam = ((P().S && P().S.kameralar) || []).find((k) => k.ad === "uc");
    if (!kam || !kam.canli_var) return;
    if (!B.acik || !B.kameraSerit) {
      if (kam.canli) P().komutGonder("kamera", { kamera: "uc", canli: false });
      return;
    }
    // Makine çalışırken daha akıcı: izlemeye değer olan an o.
    const fps = (B.veri && B.veri.mesgul) ? UC_ISTE_FPS : UC_BOSTA_FPS;
    if (!kam.canli || B.ucFps !== fps) {
      B.ucFps = fps;
      P().komutGonder("kamera", { kamera: "uc", canli: true, fps });
    }
  }

  function kameraSeritYaz() {
    if (!B.kameraSerit) return;
    const s = $("#bh-kameralar");
    if (!s) return;
    s.querySelectorAll(".bh-kam").forEach((kutu) => {
      const ad = kutu.dataset.kam;
      const son = (P().S && P().S.sonKare) ? P().S.sonKare[ad] : null;
      const im = kutu.querySelector('[data-rol="kare"]');
      if (im && son && im.src !== son.adres) im.src = son.adres;
      const not = kutu.querySelector('[data-rol="not"]');
      const calisan = !!(B.veri && B.veri.mesgul);
      kutu.classList.toggle("calisiyor", ad === "uc" && calisan);
      if (not) {
        not.textContent = ad === "uc"
          ? (calisan ? "robot çalışıyor" : "kafanın gördüğü")
          : "bahçenin zemini";
      }
    });
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

  function birakmaYeri(o, haric) {
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
    const yeniR = (haric ? sayi(haric.yayilim_mm, 120)
      : B.surukle && B.surukle.tur ? sayi(B.surukle.tur.yayilim_mm, 120) : 120) / 2;
    const sikisik = ((B.veri && B.veri.bitkiler) || []).some((b) =>
      (!haric || b.ad !== haric.ad)
      && Math.hypot(mm.x - sayi(b.x), mm.y - sayi(b.y)) < yeniR + sayi(b.yaricap_mm));
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
      e.classList.toggle("su-hedefi", !!hedef && e.dataset.ad === hedef.ad));
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
    document.querySelectorAll(".bh-bitki.su-hedefi").forEach((e) =>
      e.classList.remove("su-hedefi"));
    if (!s.tasindi) return;                 // dokunup bıraktı, sürüklemedi

    try {
      if (s.su) {
        const hedef = suHedefBul(o);
        if (!hedef) { gunluk("Sulama kabını bir bitkinin üstüne bırakın"); return; }
        await isEkle("sula", [hedef.ad]);
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
      kartKapat();
      secimBirak();
      canliIste(false);
      ucCanliIste();          // şerit açık kalsa da akış duruyor
      return;
    }
    // 3B sahne bu kullanıcının işi değil ve arka planda çizmesinin bir
    // sebebi yok: sekmeden çıkınca çekirdek onu kendisi geri açıyor.
    if (window.Tarla && window.Tarla.gorunurluk) window.Tarla.gorunurluk(false);
    B.imza = "";
    B.ertelenen = {};
    B.sinandi = false;
    canliIste(true);
    ucCanliIste();
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
    if (!B.acik) return;
    if (kam === KAMERA) zeminYaz();
    if (B.kameraSerit) kameraSeritYaz();
  }

  function durumDegisti(d) {
    if (!B.acik || !B.veri) return;
    // Yalnız robotun yeri ve meşguliyet: bütün ekranı yeniden çizmek
    // saniyede iki kez DOM kurmak demekti.
    B.veri.konum = d.konum || {};
    B.veri.bagli = !!d.bagli;
    const mesgul = !!(d.hareket || (d.dizi && d.dizi.calisiyor));
    if (mesgul !== B.veri.mesgul) {
      B.veri.mesgul = mesgul;
      kuyrukYaz();
      // Makine çalışırken uç kamerası hızlanıyor, durunca yavaşlıyor:
      // izlemeye değen an, çalıştığı an.
      ucCanliIste();
      kameraSeritYaz();
      if (!mesgul && B.yakinIs) B.yakinIs = "";
    }
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

  function kuyrukDegisti(k, tazele) {
    if (!B.veri) return;
    B.veri.kuyruk = k;
    kuyrukYaz();
    // İş bitti: bahçenin hâli değişmiş olabilir (sulama damgası, yeni
    // bitki). Tek bir tazeleme, kartları da yeniliyor. `tazele` ise
    // başka bir panel bahçeyi değiştirmiş (erteleme, eşik) — hemen oku.
    if (!k.calisan && !k.bekleyen) B.ertelenen = {};
    if (B.acik && (tazele || (!k.calisan && !k.bekleyen))) yukle();
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
    // --- yeni denetimler ---
    tahtaBagla();
    const secD = $("#bh-sec");
    if (secD) {
      secD.onclick = () => {
        B.secimKipi = !B.secimKipi;
        if (!B.secimKipi) secimBirak(); else secimYaz();
        menuKapat();
      };
    }
    const kamD = $("#bh-kamera-ac");
    if (kamD) {
      try { B.kameraSerit = localStorage.getItem("farmbot_bahce_kamera") === "1"; }
      catch { /* boş */ }
      kamD.onclick = () => kameraSerit(!B.kameraSerit);
    }
    const toplu = $("#bh-toplu");
    if (toplu) {
      toplu.querySelectorAll("[data-toplu]").forEach((d) => {
        d.onclick = () => (d.dataset.toplu === "birak"
          ? secimBirak() : topluIs(d.dataset.toplu));
      });
    }
    const kartOrtu = $("#bh-kart");
    if (kartOrtu) kartOrtu.onclick = (o) => { if (o.target === kartOrtu) kartKapat(); };

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
      if (o.key === "Escape") {
        menuKapat(); filmKapat(); kartKapat();
        if (B.zum.o > 1.02) { B.zum = { o: 1, x: 0, y: 0 }; zumUygula(); }
      }
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
      zum: Math.round(B.zum.o * 100) / 100,
      secimKipi: B.secimKipi,
      secili: Object.keys(B.secili).filter((a) => B.secili[a]),
      kartAd: B.kartAd, kartTur: B.kartTur,
      kameraSerit: B.kameraSerit, ucFps: B.ucFps || 0,
      kart: ((B.veri || {}).kartlar || []).length,
      kuyruk: (B.veri || {}).kuyruk || null,
      sayac: Object.assign({}, B.sayac),
      matris: !!olcumTazele(true),
    };
  }

  return { sekme, kareGeldi, durumDegisti, kuyrukDegisti, ekimDegisti, baglandi,
           yukle, olcum, mmUV, uvMM, ekranUV, filmAc, kartAc, kameraSerit,
           zumla, bitkiBul };
})();
