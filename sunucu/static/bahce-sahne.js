/* Bahçe sahnesi — kullanıcının göreceği tek yüz.
 *
 * NE YAPIYOR. Yatağı yukarıdan çizilmiş bir bahçe olarak gösteriyor:
 * toprak, dikim alanları, ekim gözleri, bitkiler ve makinenin kendisi.
 * Teknik sekmeler (İzle/Sür/Tarla/Kamera) olduğu gibi duruyor; burası
 * onların yerine değil, bahçeyle uğraşan biri için.
 *
 * ---------------------------------------------------------------------
 * DEĞİŞMEYEN İKİ KURAL
 * ---------------------------------------------------------------------
 *
 * 1. UYDURMA YOK. Ekranda görünen her sayı ölçülmüş bir sayı. Nem
 *    ölçülmediyse yüzde yazılmıyor, "ölçülmedi" yazılıyor. Ölçüme değil
 *    geçen güne dayanan bir karar TAHMİN diye işaretleniyor ve kesikli
 *    çerçeveyle çiziliyor. Bitkinin boyu `yaricap_mm`den, yaşı `ekim`
 *    damgasından geliyor; ikisi de yoksa bitki nötr çiziliyor.
 *
 * 2. MAKİNE KENDİLİĞİNDEN HAREKET ETMEZ. Sürükle-bırak hoş bir hareket
 *    ama arkasında 24 V'luk bir portal var. Ekim ve sulama gibi geri
 *    alınamaz işler önce ne olacağını yazıyor, sonra onay istiyor.
 *    Makine kopukken düğmeler kilitli ve sebebi yazılı.
 *
 * ---------------------------------------------------------------------
 * NEDEN ESKİ `bahce.js`İN İÇİNE YAZILMADI
 * ---------------------------------------------------------------------
 * Eski bahçe ekranı zemini ÜST KAMERANIN KARESİ yapan bilinçli bir
 * karara dayanıyordu ("çizilmiş yatak yalan söyler"). Yeni sahne bunun
 * tersini istiyor: zemin çizim, kamera isteğe bağlı bir kat. İki karar
 * aynı dosyada yan yana duramaz. Tesisat (parola/jeton, WebSocket
 * kancaları, kuyruk uçları ve düzlemin ÖLÇÜLEN homografisi) buraya
 * olduğu gibi taşındı — çalışan bir şeyi yeniden icat etmenin görsel
 * sonuca katkısı yok.
 *
 * Eski ekran "Klasik görünüm" düğmesiyle duruyor: yeni sahne bir şeyi
 * kaçırıyorsa geri dönülecek bir yer olsun.
 *
 * BOŞTA ÇİZİM YOK. `requestAnimationFrame` döngüsü yok; her şey olayla
 * tetikleniyor (durum paketi, kare haberi, dokunma). Süregelen tek
 * hareket CSS canlandırması, o da "Sakin mod" ile kapanıyor.
 */
window.BahceSahne = (function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const P = () => window.Panel || {};

  const KAMERA = "ust";
  /* Bahçe zemini saniyede beş kez değişmiyor: toprak yavaş bir şey.
     Kamera katı açıkken 1 kare/sn isteniyor — Kamera sekmesindeki 5
     kare/sn burada saf işlemci ısısı. */
  const BS_FPS = 1;

  const S = {
    acik: false,
    veri: null,
    imza: "",
    egik: true,
    sakin: false,
    kameraKat: false,
    klasik: false,
    yukleniyor: false,
    hata: "",
    zum: { o: 1, x: 0, y: 0 },
    isaretciler: new Map(),
    tutus: null,
    tersMatris: null,
    ileriMatris: null,
    olcuTs: 0,
    notlar: {},
    kart: null,
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
    S.sayac.istek += 1;
    return P().apiIste(yol, secenek);
  }

  function gonder(yol, govde) {
    return api(yol, { method: "POST", body: JSON.stringify(govde) });
  }

  /** Süreyi insanın söyleyeceği gibi yazar. Ölçü yoksa boş döner —
   *  "0 dk önce" demek, hiç ölçülmemişi az önce ölçülmüş göstermekti. */
  function sureKisa(sn) {
    if (sn == null || !Number.isFinite(Number(sn))) return "";
    const s = Math.max(0, Number(sn));
    if (s < 90) return "az önce";
    if (s < 3600) return `${Math.round(s / 60)} dk önce`;
    if (s < 86400) return `${Math.round(s / 3600)} saat önce`;
    return `${Math.round(s / 86400)} gün önce`;
  }

  /** Uyarı satırı: birden çok sebep olabilir, her biri kendi anahtarıyla
   *  yazılıyor ki biri ötekini silmesin. */
  function notYaz(anahtar, metin) {
    if (metin) S.notlar[anahtar] = metin; else delete S.notlar[anahtar];
    const el = $("#bs-uyari");
    if (!el) return;
    const hepsi = Object.values(S.notlar).filter(Boolean);
    el.hidden = !hepsi.length;
    el.textContent = hepsi.join(" · ");
  }

  /* ==================================================================== *
   * Koordinat dünyaları
   *
   * Üç uzay var ve karıştırılırsa tohum yanlış yere düşer:
   *   mm      — yatak milimetresi, makinenin konuştuğu dil
   *   uv      — düzlemin kendi 0..1 kutusu (CSS yüzdesi)
   *   ekran   — parmağın değdiği piksel
   *
   * uv HER ZAMAN YATAK. Düzlem bahçeyi çerçeveliyor, kamerayı değil:
   * üst kamera yatağın çok ötesini görüyor ve kareyi çerçeve yapmak
   * bahçeyi köşede minicik bırakıyordu.
   * ==================================================================== */
  function kalib() {
    const k = (S.veri && S.veri.kamera) || {};
    return k.kalibre ? (k.kalibrasyon || null) : null;
  }

  function yatakSinir() {
    const s = (S.veri && S.veri.sinirlar) || {};
    const x = s.x || {}, y = s.y || {};
    return {
      x1: sayi(x.min, 0), x2: sayi(x.max, 535),
      y1: sayi(y.min, 0), y2: sayi(y.max, 630),
    };
  }

  function mmUV(x, y) {
    const s = yatakSinir();
    return { u: (sayi(x) - s.x1) / Math.max(1, s.x2 - s.x1),
             v: (sayi(y) - s.y1) / Math.max(1, s.y2 - s.y1) };
  }

  function uvMM(u, v) {
    const s = yatakSinir();
    return { x: s.x1 + u * (s.x2 - s.x1), y: s.y1 + v * (s.y2 - s.y1) };
  }

  function yatakOran() {
    const s = yatakSinir();
    return Math.max(0.2, s.x2 - s.x1) / Math.max(0.2, s.y2 - s.y1);
  }

  /** Bir milimetre kaç EKRAN PİKSELİ — düzlemin ölçülen genişliğinden.
   *  Düzlemin oranı yatağın oranına eşit olduğu için iki eksende aynı
   *  sayı: yayılım halkası gerçekten daire, elips değil. */
  function pikselMM() {
    const d = $("#bs-duzlem");
    const s = yatakSinir();
    if (!d || !d.clientWidth) return 0.6;
    return d.clientWidth / Math.max(1, s.x2 - s.x1);
  }

  /* ------------------------------------------------------ ekran <-> uv */
  /** Dört köşenin ÖLÇÜLEN ekran yerinden birim kare -> ekran izdüşümü.
   *  Perspektif varken dönüşüm afin değil projektif: üç nokta yetmiyor.
   *  Elle matris çarpmak yerine ölçmek, CSS'teki her değişikliğe
   *  kendiliğinden uyuyor demek. */
  function homografi(k) {
    const [p0, p1, p2, p3] = k;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const sx = p0.x - p1.x + p2.x - p3.x;
    const sy = p0.y - p1.y + p2.y - p3.y;
    let a, b, c, d, e, f, g, h;
    if (Math.abs(sx) < 1e-6 && Math.abs(sy) < 1e-6) {
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

  /** Düzlemin köşelerini ÖLÇEREK ekran<->uv dönüşümünü tazeler.
   *  Dört `getBoundingClientRect` ucuz değil: yalnız gerekince. */
  function olcumTazele(zorla) {
    const simdi = Date.now();
    if (!zorla && S.tersMatris && simdi - S.olcuTs < 400) return S.tersMatris;
    const kose = [];
    for (let i = 0; i < 4; i++) {
      const el = document.querySelector(`.bs-olcu[data-kose="${i}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      kose.push({ x: r.left, y: r.top });
    }
    const m = homografi(kose);
    S.ileriMatris = m || null;
    S.tersMatris = m ? matrisTers(m) : null;
    S.olcuTs = simdi;
    return S.tersMatris;
  }

  function uvEkran(u, v) {
    olcumTazele(false);
    const m = S.ileriMatris;
    if (!m) return null;
    const w = m[6] * u + m[7] * v + m[8];
    if (Math.abs(w) < 1e-9) return null;
    return { x: (m[0] * u + m[1] * v + m[2]) / w,
             y: (m[3] * u + m[4] * v + m[5]) / w };
  }

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
   * Kalabalık bir yatakta bitkiler üst üste biniyor; parmakla doğru
   * olana basmak yakınlaştırmadan olmuyor.
   * ==================================================================== */
  const ZUM_EN_AZ = 1, ZUM_EN_COK = 4;

  function zumUygula() {
    const duzlem = $("#bs-duzlem");
    const kap = $("#bs-zum");
    const sahne = $("#bs-sahne");
    if (!duzlem) return;
    const z = S.zum;
    // Eğim düzlemde, yakınlaştırma onun DIŞINDAKİ katmanda: önce
    // izdüşüm, sonra ekran düzleminde büyütme. Tek zincirde olsalardı
    // büyütme izdüşümden önce uygulanır, parmağın altındaki nokta
    // yakınlaştırınca kayardı.
    duzlem.style.transform = S.egik ? "rotateX(26deg) scale(.96)" : "none";
    if (kap) {
      kap.style.transform =
        `translate(${z.x.toFixed(1)}px, ${z.y.toFixed(1)}px) scale(${z.o.toFixed(3)})`;
    }
    if (sahne) sahne.classList.toggle("yakinlasmis", z.o > 1.02);
    const rozet = $("#bs-zum-rozet");
    if (rozet) {
      rozet.textContent = z.o > 1.02 ? `${z.o.toFixed(1)}×` : "";
      rozet.hidden = z.o <= 1.02;
    }
    S.tersMatris = null;          // yerleşim değişti, ölçüm bayat
  }

  function zumSinirla() {
    const t = $("#bs-sahne");
    if (!t) return;
    const pay = 0.5;             // yarısı dışarı çıkabilir, fazlası kaybolmak
    const enCok = { x: t.clientWidth * (S.zum.o - 1) / 2 + t.clientWidth * pay,
                    y: t.clientHeight * (S.zum.o - 1) / 2 + t.clientHeight * pay };
    S.zum.x = Math.max(-enCok.x, Math.min(enCok.x, S.zum.x));
    S.zum.y = Math.max(-enCok.y, Math.min(enCok.y, S.zum.y));
  }

  /* ÇAPA ÖLÇÜLEREK TUTULUYOR. Düzlem 3B eğik ve perspektiften geçiyor;
     "kabın merkezine göre 2B ölçekleme" varsayımı parmağın altındaki
     noktayı kaydırıyordu. Doğrusu: önce uv'yi ölç, oranı uygula, uv'nin
     yeni ekran yerini tekrar ölç, farkı kaydırmaya ekle. */
  function zumla(oran, ekranX, ekranY) {
    const yeni = Math.max(ZUM_EN_AZ, Math.min(ZUM_EN_COK, oran));
    if (Math.abs(yeni - S.zum.o) < 1e-4) return;
    olcumTazele(true);
    const uv = ekranUV(ekranX, ekranY);
    S.zum.o = yeni;
    if (yeni <= ZUM_EN_AZ + 0.001) { S.zum.x = 0; S.zum.y = 0; }
    zumSinirla();
    zumUygula();
    if (!uv) return;
    olcumTazele(true);
    const yeniYer = uvEkran(uv.u, uv.v);
    if (!yeniYer) return;
    S.zum.x += ekranX - yeniYer.x;
    S.zum.y += ekranY - yeniYer.y;
    zumSinirla();
    zumUygula();
  }

  /* ==================================================================== *
   * Yerleşim
   * ==================================================================== */
  function sahneKur() {
    const sahne = $("#bs-sahne");
    const duzlem = $("#bs-duzlem");
    if (!sahne || !duzlem) return;
    sahne.style.setProperty("--bs-oran", String(yatakOran()));
    duzlem.style.setProperty("--bs-oran", String(yatakOran()));
    zumUygula();
    S.tersMatris = null;
  }

  /** Sahnenin yüksekliği = EKRANDA KALAN yer, sabit bir yüzde değil.
   *
   * Altta duran şeritler (tohum rafı, kuyruk) ÖLÇÜLÜYOR, tahmin
   * edilmiyor: sabit bir pay, şerit açılınca yanlış oluyor ve bahçe
   * ekranın dışına düşüyordu.
   *
   * PARMAK EKRANDAYKEN BOY DEĞİŞMİYOR: sürükleme başladığı andaki ekran
   * ölçüsüne dayanıyor, sahne ortada büyürse tohum bambaşka bir
   * milimetreye düşer. */
  function sahneBoyu() {
    const sahne = $("#bs-sahne");
    const sar = document.querySelector(".bs-sahne-sar");
    if (!sahne || !sar) return;
    if (S.isaretciler.size || S.surukle) return;
    const kutu = sar.getBoundingClientRect();
    let altPayi = 24;
    ["#bs-raf", "#bs-serit"].forEach((sec) => {
      const e = $(sec);
      if (e && !e.hidden && e.offsetParent) altPayi += e.offsetHeight + 8;
    });
    const kalan = window.innerHeight - kutu.top - altPayi;
    // GENİŞLİK DE SINIRLIYOR: dar bir telefonda yalnız yüksekliğe
    // bakmak, oranı gereği genişliğe sığmayan bir sahneyi taşırıyor.
    const enSiniri = Math.max(1, kutu.width) / Math.max(0.05, yatakOran());
    const boy = Math.max(200, Math.min(640, kalan, enSiniri));
    sahne.style.setProperty("--bs-yukseklik", `${Math.round(boy)}px`);
  }

  /* ==================================================================== *
   * Zemin: çizili bahçe (asıl) + kamera katı (isteğe bağlı)
   * ==================================================================== */
  function kameraKatYaz() {
    const im = $("#bs-kamera-kat");
    if (!im) return;
    const k = kalib();
    const son = (P().S && P().S.sonKare) ? P().S.sonKare[KAMERA] : null;
    if (!S.kameraKat) {
      im.hidden = true;
      im.removeAttribute("src");
      notYaz("kamera", "");
      return;
    }
    if (!k) {
      im.hidden = true;
      notYaz("kamera", "Üst kamera ölçeklenmediği için kamera katı açılamıyor — "
             + "karenin hangi milimetreye oturacağı bilinmiyor. "
             + "Kamera sekmesinden ölçek verin.");
      return;
    }
    if (!son) {
      im.hidden = true;
      notYaz("kamera", "Üst kameradan henüz kare gelmedi.");
      return;
    }
    notYaz("kamera", "");
    if (im.src !== son.adres) { im.src = son.adres; S.sayac.kare += 1; }
    im.hidden = false;
    kameraKatYerlestir();
  }

  /** Kamera karesini kendi MİLİMETRE YERİNE oturtur.
   *
   * Kare düzlemi doldurmuyor; merkezi `ofset_x/y`, ölçüsü
   * `genislik_px × mm_px`. Böylece fotoğraftaki toprak parçası, o
   * toprağın gerçekten bulunduğu milimetrede görünüyor — bitkinin
   * halkasıyla fotoğraftaki yeşil aynı yere düşüyor. Doldurmak,
   * görüntüyü güzel ama yalan yapardı. */
  function kameraKatYerlestir() {
    const im = $("#bs-kamera-kat");
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

  /* --------------------------------------------------- toprağın şekli */
  /** Dikim alanları, yasak bölgeler — hepsi milimetreden çokgene.
   *
   * Kullanıcı yasağı okuyarak değil GÖREREK öğreniyor: bırakamadığı yer
   * zaten karanlık duruyor, hata kutusu çıkmıyor. */
  function cizimYaz() {
    const svg = $("#bs-cizim");
    if (!svg) return;
    const v = S.veri || {};
    const N = (mmx, mmy) => {
      const p = mmUV(mmx, mmy);
      return `${(p.u * 1000).toFixed(1)},${(p.v * 1000).toFixed(1)}`;
    };
    const dortgen = (x1, y1, x2, y2) =>
      `${N(x1, y1)} ${N(x2, y1)} ${N(x2, y2)} ${N(x1, y2)}`;

    let ic = `<defs>
      <pattern id="bs-tirmik" width="26" height="26" patternUnits="userSpaceOnUse">
        <rect width="26" height="26" fill="rgba(255,236,200,.045)"/>
        <rect y="0" width="26" height="2" fill="rgba(0,0,0,.10)"/>
        <rect y="13" width="26" height="1" fill="rgba(255,255,255,.045)"/>
      </pattern>
      <pattern id="bs-yasak" width="14" height="14" patternUnits="userSpaceOnUse"
               patternTransform="rotate(45)">
        <rect width="14" height="14" fill="rgba(224,82,82,.07)"/>
        <rect width="5" height="14" fill="rgba(224,82,82,.22)"/>
      </pattern>
    </defs>`;

    // Dikim alanı: içi işlenmiş toprak, DIŞI karanlık. Tek "even-odd"
    // yol ile — her alana ayrı gölge kutusu, alanlar bitişikken çizgi
    // çizgi karanlık şeritler bırakıyordu.
    const alanlar = v.alanlar || [];
    if (alanlar.length) {
      const dis = dortgen(-5000, -5000, 5000, 5000);
      const delikler = alanlar.map((a) =>
        dortgen(sayi(a.x1), sayi(a.y1), sayi(a.x2), sayi(a.y2))).join(" Z M ");
      ic += `<path class="disari" fill-rule="evenodd" d="M ${dis} Z M ${delikler} Z"/>`;
      alanlar.forEach((a) => {
        const p = dortgen(sayi(a.x1), sayi(a.y1), sayi(a.x2), sayi(a.y2));
        ic += `<polygon class="tirmik" points="${p}"/>`
            + `<polygon class="alan-cerce" points="${p}"/>`;
      });
    }

    // Yasak bölgeler — ajanın bildirdikleri. Koşullu bölgeler her zaman
    // yasak değil, o yüzden taranmıyor.
    (v.bolgeler || []).forEach((b) => {
      if (b.allow_if) return;
      const p = dortgen(sayi(b.x1 ?? b.x_min), sayi(b.y1 ?? b.y_min),
                        sayi(b.x2 ?? b.x_max), sayi(b.y2 ?? b.y_max));
      ic += `<polygon class="yasak" points="${p}"/>`
          + `<polygon class="yasak-cerce" points="${p}"/>`;
    });
    svg.innerHTML = ic;
  }

  /* ==================================================================== *
   * Bitkiler
   * ==================================================================== */

  /** Bitkinin adından türetilen sabit bir sayı.
   *
   * Yaprakların açıları ve boyları arasındaki küçük fark için. Rastgele
   * olsaydı her çizimde bitki başka türlü görünürdü; addan türetince
   * aynı bitki her zaman aynı duruyor. Bu SÜS, veri değil — hiçbir
   * ölçüme karşılık gelmiyor ve hiçbir sayıya dönüşmüyor. */
  function tohumSayisi(ad) {
    let h = 2166136261;
    const s = String(ad || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  /** Yaprak gülçesi.
   *
   * YAPRAK SAYISI OLGUNLUK ORANINDAN geliyor (`olgunluk` = geçen gün /
   * olgunluk süresi, ikisi de gerçek). Ekim tarihi ya da olgunluk süresi
   * yoksa oran YOK: gülçe nötr çiziliyor (orta kademe) ve bitki
   * "yaşı bilinmiyor" işareti taşıyor. Bilinmeyeni ortalama diye
   * çizmek, bilinmeyeni gizlemek olurdu. */
  function gulce(b) {
    const oran = (b.olgunluk == null || b.yas_gun == null)
      ? null : Math.max(0, Math.min(1, sayi(b.olgunluk)));
    const adet = oran == null ? 5 : Math.round(3 + oran * 6);
    const t = tohumSayisi(b.ad);
    const renk = b.renk || "#7bbf5a";
    let ic = "";
    for (let i = 0; i < adet; i++) {
      const a = (360 / adet) * i + t * 40;
      const boy = 30 + ((i * 37 + t * 100) % 11);       // 30..41
      const koyu = i % 2 === 0 ? 1 : 0.82;              // üst üste binen yaprak
      ic += `<g class="bs-yaprak" style="--a:${a.toFixed(1)}deg;`
          + `animation-delay:${(t * 3 + i * 0.18).toFixed(2)}s"`
          + ` transform="rotate(${a.toFixed(1)} 50 50)">`
          + `<ellipse cx="50" cy="${(50 - boy / 2).toFixed(1)}"`
          + ` rx="${(boy * 0.34).toFixed(1)}" ry="${(boy / 2).toFixed(1)}"`
          + ` fill="${kacisli(renk)}" opacity="${koyu}"/></g>`;
    }
    // Merkez: gövde. Bitkinin kendi rengi koyulaştırılmadan, üstüne
    // hafif bir karanlık konarak — ikinci bir renk tanımı istemiyoruz.
    ic += `<circle cx="50" cy="50" r="9" fill="${kacisli(renk)}"/>`
        + `<circle cx="50" cy="50" r="9" fill="rgba(0,0,0,.28)"/>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">${ic}</svg>`;
  }

  /** Bitkinin ekrandaki hâlini belirleyen her şey — imza değişmezse
   *  DOM'a dokunulmuyor. */
  function bitkiImza(b) {
    return [b.ad, b.x, b.y, b.tur, b.susadi ? 1 : 0, b.su_tahmin ? 1 : 0,
            (b.su_olcum && b.su_olcum.var) ? 1 : 0, b.hasat ? 1 : 0,
            b.cakisik ? 1 : 0, Math.round(sayi(b.yaricap_mm)),
            b.olgunluk == null ? "-" : Math.round(sayi(b.olgunluk) * 20),
    ].join(":");
  }

  /** Bitkinin taşıdığı işaretler.
   *
   * SUSAMIŞ ile ÖLÇÜLMEMİŞ ayrı iki şey ve ikisi de görünüyor:
   *   · ölçüm var, eşiğin altında        → 💧 susadı (kesin)
   *   · ölçüm yok, geçen güne bakıldı    → 💧 susamış olabilir (tahmin)
   *   · hiç ölçüm yok                    → ❓ nemini ölçmedin
   * Üçünü tek damlada toplamak, tahmini ölçüm gibi göstermek olurdu. */
  function rozetler(b) {
    const olcum = b.su_olcum || {};
    const cikti = [];
    if (b.susadi) {
      cikti.push(b.su_tahmin
        ? ["susadi tahmin", "💧", "susamış olabilir — ölçüme değil geçen güne dayanıyor"]
        : ["susadi", "💧", "susadı — ölçülen toprak nemi eşiğin altında"]);
    }
    if (!olcum.var) {
      cikti.push(["olculmedi", "❓", "toprak nemi hiç ölçülmedi"]);
    } else if (olcum.bayat) {
      cikti.push(["olculmedi tahmin", "❓", "son ölçüm sulamadan önce alınmış — güncel değil"]);
    }
    if (b.hasat) cikti.push(["hasat", "🧺", "hasada hazır"]);
    return cikti;
  }

  function bitkileriYaz() {
    const kap = $("#bs-bitkiler");
    if (!kap) return;
    const liste = (S.veri && S.veri.bitkiler) || [];
    const duzlem = $("#bs-duzlem");
    const imza = liste.map(bitkiImza).join("|")
      + `#${S.egik}#${duzlem ? duzlem.clientWidth : 0}`;
    if (imza === S.imza) return;
    S.imza = imza;
    S.sayac.cizim += 1;

    const eskiler = new Map();
    kap.querySelectorAll(".bs-bitki").forEach((e) => eskiler.set(e.dataset.ad, e));
    const pxMM = pikselMM();

    liste.forEach((b) => {
      let el = eskiler.get(b.ad);
      const yeni = !el;
      if (yeni) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "bs-bitki";
        el.dataset.ad = b.ad;
        el.innerHTML = '<span class="bs-halka"></span>'
          + '<span class="bs-govde"></span>'
          + '<span class="bs-simge"></span>'
          + '<span class="bs-rozetler"></span>';
        kap.appendChild(el);
      } else {
        eskiler.delete(b.ad);
      }
      const p = mmUV(b.x, b.y);
      el.style.left = `${(p.u * 100).toFixed(2)}%`;
      el.style.top = `${(p.v * 100).toFixed(2)}%`;
      el.classList.toggle("cakisik", !!b.cakisik);

      // ÇAP PİKSEL CİNSİNDEN veriliyor, yüzde değil: yüzde, 56 pikselik
      // dokunma hedefine göre çözülüyor ve 250 mm yayılımlı bir marulun
      // halkası 158 piksel yerine 26 piksel çiziliyordu.
      const capPx = sayi(b.yaricap_mm) * 2 * pxMM;
      const halka = el.querySelector(".bs-halka");
      halka.style.width = `${capPx.toFixed(1)}px`;
      halka.style.height = `${capPx.toFixed(1)}px`;

      // Gülçe gerçek çapıyla çiziliyor; 20 pikselin altında hiçbir şey
      // görünmediği için orada duruyor. Gerçek çapı halka gösteriyor —
      // yani küçük bir fide büyük görünmüyor, sadece görünüyor.
      const govde = el.querySelector(".bs-govde");
      const cizimPx = Math.max(20, Math.min(capPx, 220));
      govde.style.width = `${cizimPx.toFixed(1)}px`;
      govde.style.height = `${cizimPx.toFixed(1)}px`;
      govde.innerHTML = gulce(b);

      const simge = el.querySelector(".bs-simge");
      simge.textContent = b.simge || "🌱";
      simge.style.fontSize = `${Math.max(11, Math.min(26, cizimPx * 0.34)).toFixed(1)}px`;

      const kutu = el.querySelector(".bs-rozetler");
      const isaretler = rozetler(b);
      kutu.hidden = !isaretler.length;
      kutu.innerHTML = isaretler.map((i) =>
        `<span class="bs-rozet ${i[0]}" title="${kacisli(i[2])}">${i[1]}</span>`).join("");

      el.setAttribute("aria-label", `${b.tur_ad || b.tur}`
        + isaretler.map((i) => `, ${i[2]}`).join(""));

      if (yeni && S.veri.ts && Date.now() / 1000 - sayi(b.ekim) < 20) {
        el.classList.add("yeni");
        setTimeout(() => el.classList.remove("yeni"), 800);
      }
    });
    eskiler.forEach((e) => e.remove());

    const bos = $("#bs-bos");
    if (bos) {
      bos.hidden = liste.length > 0;
      if (!liste.length) {
        bos.textContent = (S.veri && (S.veri.alanlar || []).length)
          ? "Bahçe boş. Aşağıdaki tohum rafından bir tohum alıp toprağa bırakın."
          : "Henüz dikim alanı tanımlı değil — toprağın nerede olduğu bilinmiyor. "
            + "Tarla sekmesinden dikim alanı ekleyin.";
      }
    }
  }


  /* ==================================================================== *
   * Makine
   *
   * Üstten bakışta makine bir nokta değil: köprü makine Y'sinde yürüyor
   * ve X boyunca uzanıyor, kızak köprünün üstünde X'te kayıyor. Ekranda
   * da öyle duruyor.
   *
   * KONUM BİLDİRİLMİYORSA ÇİZİLMİYOR. Robotu "herhâlde şuradadır" diye
   * bir yere koymak, bu ekranın söyleyebileceği en kötü yalan olurdu.
   * ==================================================================== */

  /** Çalışan iş hangi başı kullanıyor? İş yoksa boş — hiçbir baş aktif
   *  değil demek, "herhâlde sulama başlığıdır" demek değil. */
  function aktifBasKimlik() {
    const v = S.veri || {};
    const calisan = (v.kuyruk || {}).calisan;
    if (!calisan) return "";
    return String((v.is_basi || {})[calisan.tip] || "");
  }

  function aktifBas() {
    const kimlik = aktifBasKimlik();
    if (!kimlik) return null;
    const b = ((S.veri || {}).baslar || {})[kimlik];
    return b ? { kimlik, ...b } : null;
  }

  /** Bir başın İŞ NOKTASI: makine hedefe kaymayı EKLEYEREK gidiyor,
   *  yani işin olduğu yer makinenin yeri EKSİ kayma (`baslar.geri_al`).
   *  İkisini aynı yere çizmek, ekimin yanlış yere düştüğü hatayı
   *  ekranda tekrarlamak olurdu. */
  function basNoktasi(konum, bas) {
    return { x: sayi(konum.x) - sayi(bas.dx), y: sayi(konum.y) - sayi(bas.dy) };
  }

  function makineYaz() {
    const kap = $("#bs-makine");
    if (!kap) return;
    const v = S.veri || {};
    const k = v.konum || {};
    if (!v.bagli || k.x == null || k.y == null) { kap.hidden = true; return; }
    const p = mmUV(k.x, k.y);
    if (p.u < -0.35 || p.u > 1.35 || p.v < -0.35 || p.v > 1.35) {
      // Makine yatağın dışında (park, home): çizilmiyor ama sebebi
      // yazılıyor — kaybolmuş gibi durmasın.
      kap.hidden = true;
      notYaz("makine", "Makine şu an yatağın dışında.");
      return;
    }
    notYaz("makine", "");
    kap.hidden = false;
    kap.classList.toggle("calisiyor", !!v.mesgul);

    const portal = $("#bs-portal");
    if (portal) portal.style.top = `${(p.v * 100).toFixed(2)}%`;
    const kizak = $("#bs-kizak");
    if (kizak) {
      kizak.style.left = `${(p.u * 100).toFixed(2)}%`;
      kizak.style.top = `${(p.v * 100).toFixed(2)}%`;
    }

    // Aktif baş ve işin görüntüsü: su, prob, tohum.
    const bas = aktifBas();
    const el = $("#bs-bas");
    if (!el) return;
    if (!bas) { el.hidden = true; el.className = "bs-bas"; return; }
    const nokta = basNoktasi(k, bas);
    const bp = mmUV(nokta.x, nokta.y);
    const tip = (v.kuyruk.calisan || {}).tip;
    el.hidden = false;
    el.className = `bs-bas ${bas.kimlik === "sulama" ? "su"
                          : bas.kimlik === "nem" ? "nem" : "tohum"}`;
    el.style.left = `${(bp.u * 100).toFixed(2)}%`;
    el.style.top = `${(bp.v * 100).toFixed(2)}%`;
    // Su ve prob YALNIZ o iş çalışırken. Röle durumu `olcum` paketinde ve
    // beş saniyede bir geliyor; üç saniyelik bir sulamayı kaçırırdı.
    // "Sulama işi çalışıyor" ölçülen bir gerçek — ekranın dediği de bu.
    const ic = tip === "sula"
      ? '<span class="bs-damla" style="animation-delay:0s"></span>'
        + '<span class="bs-damla" style="animation-delay:.37s"></span>'
        + '<span class="bs-damla" style="animation-delay:.74s"></span>'
      : (tip === "nem" ? '<span class="bs-prob"></span>' : "");
    el.innerHTML = ic + `<span class="bs-bas-ad">${kacisli(bas.ad || bas.kimlik)}</span>`;
  }

  /** Çalışan işin hedefi olan bitkiler işaretleniyor — hangi bitkiyle
   *  uğraşıldığı ekranda görünsün. Sınıf değişimi, yeniden çizim değil. */
  function hedefYaz() {
    const v = S.veri || {};
    const calisan = (v.kuyruk || {}).calisan;
    const hedefler = new Set((calisan && calisan.noktalar) || []);
    document.querySelectorAll("#bs-bitkiler .bs-bitki").forEach((el) => {
      el.classList.toggle("hedef", hedefler.has(el.dataset.ad));
    });
  }

  /* ==================================================================== *
   * Ayrıntı kartı — hem bitki hem makine bunu kullanıyor
   *
   * SATIRIN DEĞERİ YOKSA "bilinmiyor" YAZIYOR. Boş bırakmak ya da sıfır
   * göstermek, ölçülmemiş bir şeyi ölçülmüş gibi göstermenin iki yolu.
   * ==================================================================== */
  function satir(etiket, deger, not) {
    const bos = deger == null || deger === "";
    return `<div class="bs-satir"><dt>${kacisli(etiket)}</dt><dd>`
      + (bos ? '<span class="yok">bilinmiyor</span>' : kacisli(deger))
      + (not ? `<small>${kacisli(not)}</small>` : "")
      + "</dd></div>";
  }

  function kartKapat() {
    const o = $("#bs-ortu");
    if (o) o.hidden = true;
    S.kart = null;
  }

  function kartAc(kart) {
    const o = $("#bs-ortu");
    if (!o) return;
    S.kart = kart;
    o.querySelector('[data-rol="simge"]').textContent = kart.simge || "";
    o.querySelector('[data-rol="baslik"]').textContent = kart.baslik || "";
    o.querySelector('[data-rol="alt"]').textContent = kart.alt || "";
    o.querySelector('[data-rol="satirlar"]').innerHTML = (kart.satirlar || []).join("");
    const dg = o.querySelector('[data-rol="dugmeler"]');
    dg.innerHTML = "";
    (kart.dugmeler || []).forEach((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `bs-dugme ${d.birincil ? "birincil" : ""}`;
      if (d.makine) b.dataset.makine = "1";
      b.textContent = d.yazi;
      b.onclick = d.tikla;
      dg.appendChild(b);
    });
    o.hidden = false;
    baglantiYaz();          // karttaki iş düğmeleri de kopuklukta kilitli
  }

  /** Makineye dokununca: nerede, ne yapıyor, hangi baş, hedefi ne. */
  function makineKarti() {
    const v = S.veri || {};
    const k = v.konum || {};
    const kuy = v.kuyruk || {};
    const calisan = kuy.calisan;
    const bas = aktifBas();
    const mm = (d) => (d == null ? null : `${sayi(d).toFixed(1)} mm`);
    const satirlar = [
      satir("Durum", !v.bagli ? "Kopuk" : (v.mesgul ? "Çalışıyor" : "Bekliyor"),
            v.bagli ? "" : "Ajan bağlı değil — Raspberry Pi çevrimdışı olabilir."),
      satir("Konum X", mm(k.x)),
      satir("Konum Y", mm(k.y)),
      satir("Konum Z", mm(k.z)),
    ];
    if (k.t != null) satirlar.push(satir("Tohum ucu (T)", mm(k.t)));
    satirlar.push(satir("Şu an ne yapıyor",
      calisan ? calisan.etiket : (v.bagli ? "Bir şey yapmıyor" : null)));
    satirlar.push(satir("Aktif baş",
      bas ? (bas.ad || bas.kimlik) : null,
      bas ? `merkeze göre kayma: ${sayi(bas.dx).toFixed(1)} / `
            + `${sayi(bas.dy).toFixed(1)} mm — makine hedefin bu kadar `
            + "ötesine gidiyor ki baş hedefe otursun"
          : "Çalışan iş yok, yani bir başla iş yapılmıyor."));

    const hedefAd = (calisan && calisan.noktalar) || [];
    const bul = (ad) => (v.bitkiler || []).find((b) => b.ad === ad);
    satirlar.push(satir("Hedef",
      hedefAd.length
        ? hedefAd.slice(0, 3).map((a) => {
            const b = bul(a);
            return b ? `${b.tur_ad} (${sayi(b.x).toFixed(0)}, ${sayi(b.y).toFixed(0)})` : a;
          }).join(" · ") + (hedefAd.length > 3 ? ` +${hedefAd.length - 3}` : "")
        : null,
      hedefAd.length ? "" : "Çalışan bir iş olmadığı için hedef yok."));
    satirlar.push(satir("Sırada bekleyen",
      kuy.bekleyen == null ? null : `${kuy.bekleyen} iş`));

    kartAc({
      simge: "🤖", baslik: "Makine",
      alt: v.bagli ? "canlı durum paketinden" : "bağlantı yok",
      satirlar,
      // Kart açıkken konum canlı kalıyor: donmuş bir sayı, duran bir
      // makine sanılır.
      tazele: makineKarti,
    });
  }

  /* ==================================================================== *
   * Çizim ve veri
   * ==================================================================== */
  function ciz() {
    if (!S.veri) return;
    sahneKur();
    sahneBoyu();
    kameraKatYaz();
    cizimYaz();
    bitkileriYaz();
    makineYaz();
    hedefYaz();
    baglantiYaz();
  }

  /** Bağlantı rozeti. Makine kopukken bunu okumadan hiçbir düğmeye
   *  basılmasın diye şeridin BAŞINDA duruyor. */
  function baglantiYaz() {
    const el = $("#bs-bagli");
    if (!el) return;
    const v = S.veri || {};
    const yazi = el.querySelector("b");
    el.classList.toggle("acik", !!v.bagli && !v.mesgul);
    el.classList.toggle("kopuk", !v.bagli);
    el.classList.toggle("calisiyor", !!v.bagli && !!v.mesgul);
    if (yazi) {
      yazi.textContent = !v.bagli ? "Makine kopuk"
        : (v.mesgul ? "Makine çalışıyor" : "Makine hazır");
    }
    // Kopukken iş başlatan her düğme kilitli ve SEBEBİ yazılı. Açık
    // görünen ama işe yaramayan bir düğme, kullanıcıyı makinenin
    // bozulduğunu sanmaya götürüyor.
    document.querySelectorAll("#bs [data-makine]").forEach((d) => {
      d.disabled = !v.bagli;
      d.title = v.bagli ? "" : "Makine kopuk — ajan bağlanınca açılır.";
    });
    notYaz("bagli", v.bagli ? ""
      : "Makineyle bağlantı yok: bahçe görünüyor ama iş başlatılamıyor.");
  }

  async function yukle() {
    if (S.yukleniyor) return;
    S.yukleniyor = true;
    try {
      S.veri = await api("/api/bahce");
      S.hata = "";
      notYaz("yukle", "");
      S.imza = "";
      ciz();
    } catch (hata) {
      S.hata = hata.message || String(hata);
      // SESSİZ BAŞARISIZLIK YOK: ekran boş kalırsa sebebi yazıyor.
      notYaz("yukle", `Bahçe okunamadı: ${S.hata}`);
    } finally {
      S.yukleniyor = false;
    }
  }

  /* ==================================================================== *
   * Çekirdekten gelen haberler
   * ==================================================================== */
  function kareGeldi(kam) {
    if (!S.acik || kam !== KAMERA) return;
    if (S.kameraKat) kameraKatYaz();
  }

  function durumDegisti(d) {
    if (!S.acik || !S.veri) return;
    // Bütün ekranı yeniden çizmek saniyede iki kez DOM kurmak demekti:
    // yalnız konum ve meşguliyet güncelleniyor.
    S.veri.konum = d.konum || {};
    S.veri.bagli = !!d.bagli;
    const mesgul = !!(d.hareket || (d.dizi && d.dizi.calisiyor));
    if (mesgul !== S.veri.mesgul) {
      S.veri.mesgul = mesgul;
      baglantiYaz();
    }
    makineYaz();
    // Kart açıksa yazdığı sayı da canlı: kapalı bir sayfada donmuş bir
    // konum göstermek, makinenin durduğunu sandırır.
    if (S.kart && S.kart.tazele) S.kart.tazele();
  }

  function ekimDegisti() { /* Ekim akışı bir sonraki adımda bağlanıyor. */ }

  function kuyrukDegisti(k, tazele) {
    if (!S.veri) return;
    S.veri.kuyruk = k;
    makineYaz();
    hedefYaz();
    // İş bitti: bahçenin hâli değişmiş olabilir (sulama damgası, yeni
    // bitki). `tazele` ise başka bir panel bahçeyi değiştirmiş.
    if (S.acik && (tazele || (k && !k.calisan && !k.bekleyen))) yukle();
  }

  function baglandi() { if (S.acik) yukle(); }

  /* ==================================================================== *
   * Sekme
   * ==================================================================== */
  function sekme(acik) {
    S.acik = !!acik;
    const kok = $("#bs");
    if (kok) kok.hidden = !S.acik || S.klasik;
    if (!S.acik) {
      canliIste(false);
      return;
    }
    if (S.klasik) return;
    sahneKur();
    sahneBoyu();
    yukle();
    canliIste(S.kameraKat);
  }

  /** Üst kameranın canlı akışı YALNIZ kamera katı açıkken isteniyor.
   *  Bakılmayan bir akış, ödenmemesi gereken bir bedel. */
  function canliIste(ac) {
    const kam = ((P().S && P().S.kameralar) || []).find((k) => k.ad === KAMERA);
    if (!kam || !kam.canli_var) return;
    if (ac) {
      P().komutGonder("kamera", { kamera: KAMERA, canli: true, fps: BS_FPS });
    } else if (kam.canli) {
      P().komutGonder("kamera", { kamera: KAMERA, canli: false });
    }
  }

  /* ==================================================================== *
   * El hareketleri — iki parmak yakınlaştırır, tek parmak kaydırır
   * ==================================================================== */
  function sahneBagla() {
    const sahne = $("#bs-sahne");
    if (!sahne || sahne.dataset.bagli === "1") return;
    sahne.dataset.bagli = "1";

    sahne.addEventListener("pointerdown", (o) => {
      if (o.target.closest(".bs-bitki")) return;   // bitkiye dokunma ayrı iş
      sahne.setPointerCapture(o.pointerId);
      S.isaretciler.set(o.pointerId, { x: o.clientX, y: o.clientY });
      if (S.isaretciler.size === 2) {
        const [a, b] = [...S.isaretciler.values()];
        S.tutus = { uzak: Math.hypot(a.x - b.x, a.y - b.y), oran: S.zum.o };
      } else if (S.isaretciler.size === 1 && S.zum.o > 1.02) {
        S.kaydir = { x: o.clientX, y: o.clientY, zx: S.zum.x, zy: S.zum.y };
      }
    });

    sahne.addEventListener("pointermove", (o) => {
      if (!S.isaretciler.has(o.pointerId)) return;
      S.isaretciler.set(o.pointerId, { x: o.clientX, y: o.clientY });
      if (S.isaretciler.size === 2 && S.tutus) {
        const [a, b] = [...S.isaretciler.values()];
        const uzak = Math.hypot(a.x - b.x, a.y - b.y);
        if (S.tutus.uzak > 4) {
          zumla(S.tutus.oran * (uzak / S.tutus.uzak),
                (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
      } else if (S.isaretciler.size === 1 && S.kaydir) {
        S.zum.x = S.kaydir.zx + (o.clientX - S.kaydir.x);
        S.zum.y = S.kaydir.zy + (o.clientY - S.kaydir.y);
        zumSinirla();
        zumUygula();
      }
    });

    const birak = (o) => {
      S.isaretciler.delete(o.pointerId);
      if (S.isaretciler.size < 2) S.tutus = null;
      if (!S.isaretciler.size) S.kaydir = null;
    };
    sahne.addEventListener("pointerup", birak);
    sahne.addEventListener("pointercancel", birak);

    sahne.addEventListener("wheel", (o) => {
      o.preventDefault();
      zumla(S.zum.o * (o.deltaY < 0 ? 1.15 : 1 / 1.15), o.clientX, o.clientY);
    }, { passive: false });

    // Çift dokunuş: yakınlaştır ya da tamamen geri dön. Dokunmatikte
    // yakınlaştırmanın en bilinen hareketi bu.
    let sonDokunus = 0;
    sahne.addEventListener("pointerup", (o) => {
      const simdi = Date.now();
      if (simdi - sonDokunus < 320) {
        zumla(S.zum.o > 1.5 ? 1 : 2.2, o.clientX, o.clientY);
        sonDokunus = 0;
      } else {
        sonDokunus = simdi;
      }
    });
  }

  /* ==================================================================== *
   * Bağlama
   * ==================================================================== */
  function ikonBagla(sec, anahtar, uygula) {
    const d = $(sec);
    if (!d) return;
    let acik = false;
    try { acik = localStorage.getItem(anahtar) === "1"; }
    catch { /* depolama kapalı — varsayılan kalır */ }
    uygula(acik);
    d.setAttribute("aria-pressed", acik ? "true" : "false");
    d.onclick = () => {
      acik = !acik;
      try { localStorage.setItem(anahtar, acik ? "1" : "0"); }
      catch { /* boş */ }
      d.setAttribute("aria-pressed", acik ? "true" : "false");
      uygula(acik);
    };
  }

  function bagla() {
    const kok = $("#bs");
    if (!kok) return;
    sahneBagla();

    const kizak = $("#bs-kizak");
    if (kizak) kizak.onclick = makineKarti;

    const ortu = $("#bs-ortu");
    if (ortu) {
      // Kartın DIŞINA dokunmak kapatıyor; kartın içine dokunmak değil.
      ortu.onclick = (o) => { if (o.target === ortu) kartKapat(); };
      const kapat = ortu.querySelector('[data-rol="kapat"]');
      if (kapat) kapat.onclick = kartKapat;
    }

    // Eğik bakış VARSAYILAN AÇIK: yatağa yukarıdan hafif eğik bakmak,
    // bitkilerin üst üste binmesini azaltıyor ve bahçeyi bir yer gibi
    // gösteriyor. Tam tepeden bakmak, iki bitkinin hangisinin önde
    // olduğunu ölçmek isteyen için duruyor.
    const egikD = $("#bs-egik");
    if (egikD) {
      try { S.egik = localStorage.getItem("farmbot_bs_egik") !== "0"; }
      catch { /* boş */ }
      const yaz = () => {
        egikD.setAttribute("aria-pressed", S.egik ? "true" : "false");
        egikD.textContent = S.egik ? "Eğik bak" : "Tepeden bak";
        S.imza = "";
        sahneKur();
        bitkileriYaz();
      };
      egikD.onclick = () => {
        S.egik = !S.egik;
        try { localStorage.setItem("farmbot_bs_egik", S.egik ? "1" : "0"); }
        catch { /* boş */ }
        yaz();
      };
      yaz();
    }

    ikonBagla("#bs-sakin", "farmbot_bs_sakin", (a) => {
      S.sakin = a;
      kok.classList.toggle("sakin", a);
    });

    ikonBagla("#bs-kamera", "farmbot_bs_kamera", (a) => {
      S.kameraKat = a;
      if (S.acik) { canliIste(a); kameraKatYaz(); }
    });

    // KLASİK GÖRÜNÜM: yeni sahne bir şeyi kaçırıyorsa geri dönülecek
    // yer. Eski ekran yalnız açıkken çalışıyor — görünmeyen bir ekranı
    // çizmek saf ısı.
    const klasikD = $("#bs-klasik");
    const klasikKap = $("#bh-klasik");
    if (klasikD && klasikKap) {
      klasikD.onclick = () => {
        S.klasik = !S.klasik;
        klasikD.setAttribute("aria-pressed", S.klasik ? "true" : "false");
        klasikD.textContent = S.klasik ? "Yeni bahçe" : "Klasik görünüm";
        kartKapat();
        kok.hidden = S.klasik;
        klasikKap.hidden = !S.klasik;
        if (window.BahceKlasik) window.BahceKlasik.sekme(S.klasik);
        if (!S.klasik) { S.imza = ""; sekme(true); }
      };
    }

    addEventListener("resize", () => {
      S.tersMatris = null;
      if (S.acik && !S.klasik) { S.imza = ""; sahneBoyu(); bitkileriYaz(); }
    });
    addEventListener("keydown", (o) => {
      if (o.key !== "Escape") return;
      if (S.kart) { kartKapat(); return; }
      if (S.zum.o > 1.02) { S.zum = { o: 1, x: 0, y: 0 }; zumUygula(); }
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
      acik: S.acik, klasik: S.klasik, egik: S.egik, sakin: S.sakin,
      kameraKat: S.kameraKat, kalibre: !!kalib(),
      bitki: ((S.veri || {}).bitkiler || []).length,
      zum: Math.round(S.zum.o * 100) / 100,
      bagli: !!(S.veri || {}).bagli, mesgul: !!(S.veri || {}).mesgul,
      hata: S.hata, kart: S.kart ? S.kart.baslik : "",
      bas: aktifBasKimlik(), sayac: Object.assign({}, S.sayac),
      matris: !!olcumTazele(true),
    };
  }

  return { sekme, kareGeldi, durumDegisti, kuyrukDegisti, ekimDegisti,
           baglandi, yukle, olcum, mmUV, uvMM, ekranUV, zumla,
           klasikMi: () => S.klasik };
})();

/* ---------------------------------------------------------------------- *
 * KÖPRÜ.
 *
 * `app.js` bahçeyi `window.Bahce` üzerinden çağırıyor (beş kanca). O
 * dosya paylaşılan bir dosya ve başka oturumlar orada çalışıyor; tek
 * satır bile değiştirmemek için köprü burada duruyor. Eski ekran
 * `window.BahceKlasik` adıyla saklanıyor ve yalnız "Klasik görünüm"
 * açıkken haber alıyor — görünmeyen bir ekranı beslemek boşuna iş.
 * ---------------------------------------------------------------------- */
window.BahceKlasik = window.Bahce || null;
window.Bahce = (function () {
  "use strict";
  const yeni = window.BahceSahne;
  const eski = window.BahceKlasik;
  const klasik = () => !!(eski && yeni.klasikMi());
  return {
    sekme(a) { yeni.sekme(a); if (eski) eski.sekme(a && yeni.klasikMi()); },
    kareGeldi(k) { yeni.kareGeldi(k); if (klasik()) eski.kareGeldi(k); },
    durumDegisti(d) { yeni.durumDegisti(d); if (klasik()) eski.durumDegisti(d); },
    kuyrukDegisti(k, t) { yeni.kuyrukDegisti(k, t); if (klasik()) eski.kuyrukDegisti(k, t); },
    ekimDegisti(e) { yeni.ekimDegisti(e); if (klasik()) eski.ekimDegisti(e); },
    baglandi() { yeni.baglandi(); if (klasik()) eski.baglandi(); },
    yukle() { yeni.yukle(); if (klasik()) eski.yukle(); },
    olcum() { return yeni.olcum(); },
  };
})();
