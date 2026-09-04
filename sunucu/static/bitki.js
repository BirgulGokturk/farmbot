/* Bitki kartları — bir bitkiye dair NE VARSA tek kartta.
 *
 * NEDEN VAR. Bitkinin kendisi (tür, yaş, yayılım, son sulama) bir ekranda,
 * toprak nemi başka bir ekranda duruyordu. İkisini yan yana görmenin yolu
 * yoktu: "bu bitki neden susadı" sorusu iki sekme arasında gidip gelmeden
 * cevaplanamıyordu. Burada her bitki TEK bir kart ve o kartın üstünde o
 * bitkiye doğrudan uygulanan işlemler var.
 *
 * SIRALAMA BİR KARAR, SÜS DEĞİL. Liste varsayılan olarak DİKKAT İSTEYENLERİ
 * öne alıyor ve kartın sol şeridi bunun görünen hâli. Alfabetik bir liste,
 * 40 bitkilik bir bahçede susayanı bulmak için 40 kartı okumak demekti.
 *
 * AYRI DOSYA, `nem.js` ve `etiket.js` ile aynı gerekçe: `app.js`, `bahce.js`
 * ve `index.html` başka bir oturumda sürekli değişiyor. Bu sekme kendi
 * arayüzünü kendi kuruyor; `index.html`e yalnız bir düğme ve boş bir bölüm
 * giriyor.
 *
 * VERİ İKİ UÇTAN, İKİSİ DE HESAPLAMIYOR:
 *   `/api/bahce` — bitkinin kendisi, susama kararı, ölçümün künyesi ve
 *     gerekçesi. Nem tablosunun (`nem.js`) baktığı uçla AYNI uç; tabloyu
 *     kopyalamıyoruz, aynı kaynaktan kendi görünümümüzü kuruyoruz.
 *   `/api/bitki` — orada OLMAYANLAR: çözülmüş sulama süresi, nem eğilimi,
 *     olay sayaçları, bahçe ortancasına göre fark.
 * İkinci bir hesap kurmak, aynı soruya iki farklı cevap veren iki yer
 * demekti.
 *
 * EĞİLİM NEDEN ÇİZGİ DEĞİL. Okumalar düzenli aralıklı değil: prob ancak
 * makine o bitkinin üstüne gittiğinde okuyor, aradaki boşluk bir günü
 * bulabiliyor. İki okumayı çizgiyle birleştirmek, ölçülmemiş bir günü
 * ölçülmüş gibi göstermek olurdu. Onun yerine ölçülen iki uç sayı ve
 * aradaki süre yazılıyor.
 */
(function () {
  "use strict";

  const SEKME = "bitkiler";
  const KAP = "sayfa-bitkiler";
  // Kuyruktaki bir iş bitince kart tazelensin diye kısa; sekme kapalıyken
  // hiç istek gitmiyor.
  const TAZELE_MS = 20000;
  // Sunucunun tek iste aldigi en fazla nokta (`main.AZAMI_SECIM`). Toplu
  // olcum bundan uzunsa PARCALARA bolunuyor: 41 bitkilik bir bahcede
  // "40'ini olctum, birini unuttum" en kotu sonuc olurdu.
  const AZAMI_SECIM = 40;

  let bahce = null;              // /api/bahce
  let ek = null;                 // /api/bitki
  let zamanlayici = null;
  let sira = "dikkat";
  const suzgec = { arama: "", tur: "", bayrak: new Set() };
  // AÇIK DETAYLAR HATIRLANIYOR. Liste 20 saniyede bir yeniden çiziliyor;
  // hatırlanmasaydı kullanıcının açtığı detay her tazelemede kapanırdı ve
  // okurken kartın altından kayardı.
  const acikDetay = new Set();

  const $ = (s) => document.querySelector(s);
  const P = () => window.Panel || null;
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));
  const sayi = (d, v = 0) => (Number.isFinite(Number(d)) ? Number(d) : v);

  /* ------------------------------------------------------------- biçimleme */
  function sureMetni(sn) {
    if (sn == null || !Number.isFinite(Number(sn))) return "—";
    const d = Math.max(0, Number(sn));
    if (d < 90) return `${Math.round(d)} sn`;
    if (d < 5400) return `${Math.round(d / 60)} dk`;
    if (d < 172800) return `${Math.round(d / 3600)} sa`;
    return `${Math.round(d / 86400)} gün`;
  }

  function tarihMetni(ts) {
    if (!ts) return "—";
    return new Date(Number(ts) * 1000).toLocaleString("tr-TR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  }

  /* Bir bitkinin ölçüm hâli ve DİKKAT SIRASI.
   *
   * "Hiç ölçülmedi" ile "nemi yeterli" ayrı şeyler: ilki bilgi eksikliği,
   * ikincisi bilgi. Sıra sayısı küçüldükçe kart yukarı çıkıyor ve her
   * hâlin bir NEDENİ var — kartta o neden yazıyor. */
  /* DÖRT HÂL, SIRASI `katmanlar/35-susuz.js` İLE AYNI.
   *
   * O katman 3B sahnede aynı kararı veriyor ve sırası şu: kendi ölçümü
   * yoksa "bilmiyoruz", varsa susama bakılıyor. Buradaki sıra ondan
   * farklı olsaydı aynı bitki iki ekranda iki ayrı şey görünürdü ve
   * kullanıcı ikisini ayrı bitki sanardı.
   *
   * KOMŞUDAN ÖDÜNÇ OKUMA "ÖLÇÜLMEDİ" SAYILIYOR — katmandaki kural bu
   * (`else if (!olcum.kendi) hal = "yok"`). Sayı bilgidir ama BU
   * bitkinin bilgisi değil; ona bakıp susadı demek, ölçmeden karar
   * vermek olurdu. Sayının kendisi saklanmıyor, Detay'da duruyor.
   *
   * HASAT BURADA YOK. Kart tek bir durum işareti taşıyor ve o işaret
   * NEM hakkında; olgunluk ayrı bir eksen ve Detay'da yazıyor. İkisini
   * tek rozette toplamak, "hasada hazır" diyen bir kartın susadığını
   * gizlemek olurdu. Sıralama yine hasadı gözetiyor (bkz. `sirala`). */
  function durum(b) {
    const o = b.su_olcum || {};
    const kendiVar = !!(o.var && o.kendi);
    if (!kendiVar) {
      return { ad: "olculmedi", etiket: "ölçülmedi", oncelik: 20,
               neden: o.var ? "gösterilen sayı yandaki bir noktadan geliyor"
                            : "yakınında hiç toprak nemi okuması yok" };
    }
    if (o.bayat) {
      return { ad: "eskimis", etiket: "ölçüm eskimiş", oncelik: 30,
               neden: "son okuma sulamadan ÖNCE alınmış — o noktada yeni ölçüm yok" };
    }
    if (b.susadi) {
      return { ad: "susadi", etiket: "susadı", oncelik: 2,
               neden: "ölçülen toprak nemi eşiğin altında" };
    }
    return { ad: "iyi", etiket: "nemi yeterli", oncelik: 100, neden: "" };
  }

  /* --------------------------------------------------------------- süzgeç */
  const BAYRAKLAR = [
    { anahtar: "susadi", ad: "Susayanlar",
      sec: (b) => !!b.susadi },
    { anahtar: "olcum", ad: "Ölçüm gerekli",
      sec: (b) => ["olculmedi", "eskimis"].includes(durum(b).ad) },
    { anahtar: "hasat", ad: "Hasada hazır",
      sec: (b) => !!b.hasat },
    { anahtar: "cakisik", ad: "Çakışanlar",
      sec: (b) => !!b.cakisik },
  ];

  const SIRALAR = [
    { anahtar: "dikkat", ad: "Önce dikkat isteyenler" },
    { anahtar: "kuru", ad: "En kuru önce" },
    { anahtar: "olcum", ad: "Ölçümü en eski önce" },
    { anahtar: "sulama", ad: "En uzun süredir sulanmayan" },
    { anahtar: "ad", ad: "Ada göre" },
    { anahtar: "tur", ad: "Türe göre" },
  ];

  function nemDegeri(b) {
    const o = b.su_olcum || {};
    return o.var ? sayi(o.yuzde, 999) : 999;      // ölçümü yok = en sona
  }
  function olcumYasi(b) {
    const o = b.su_olcum || {};
    return o.var ? sayi(o.yas_sn, 0) : Number.MAX_SAFE_INTEGER;
  }
  function sulamaGecen(b, simdi) {
    const t = sayi(b.sulama_ts, 0) || sayi(b.ekim, 0);
    return t ? simdi - t : Number.MAX_SAFE_INTEGER;
  }

  function sirala(liste, simdi) {
    const adKarsi = (a, b) => String(a.ad).localeCompare(String(b.ad), "tr");
    const kopya = liste.slice();
    if (sira === "kuru") {
      kopya.sort((a, b) => nemDegeri(a) - nemDegeri(b) || adKarsi(a, b));
    } else if (sira === "olcum") {
      kopya.sort((a, b) => olcumYasi(b) - olcumYasi(a) || adKarsi(a, b));
    } else if (sira === "sulama") {
      kopya.sort((a, b) => sulamaGecen(b, simdi) - sulamaGecen(a, simdi) || adKarsi(a, b));
    } else if (sira === "ad") {
      kopya.sort(adKarsi);
    } else if (sira === "tur") {
      kopya.sort((a, b) => String(a.tur_ad || a.tur).localeCompare(
        String(b.tur_ad || b.tur), "tr") || adKarsi(a, b));
    } else {
      // Dikkat: önce hâl, eşitse en kuru, o da eşitse ölçümü en eski.
      // HASAT ROZETTEN ÇIKTI AMA SIRADAN ÇIKMADI: olgunluğu gelmiş bir
      // bitki, nemi yeterli olanların önünde durmalı — yoksa 40 kartlık
      // bir listede en sona düşer ve kimse görmez.
      const p = (x) => durum(x).oncelik - (x.hasat && durum(x).ad === "iyi" ? 50 : 0);
      kopya.sort((a, b) => p(a) - p(b)
        || nemDegeri(a) - nemDegeri(b)
        || olcumYasi(b) - olcumYasi(a) || adKarsi(a, b));
    }
    return kopya;
  }

  function suzulmus() {
    const hepsi = (bahce && bahce.bitkiler) || [];
    const ara = suzgec.arama.trim().toLocaleLowerCase("tr");
    return hepsi.filter((b) => {
      if (suzgec.tur && String(b.tur || "") !== suzgec.tur) return false;
      if (ara) {
        const metin = `${b.ad || ""} ${b.tur_ad || ""} ${b.tur || ""}`
          .toLocaleLowerCase("tr");
        if (!metin.includes(ara)) return false;
      }
      for (const bay of BAYRAKLAR) {
        if (suzgec.bayrak.has(bay.anahtar) && !bay.sec(b)) return false;
      }
      return true;
    });
  }

  /* ---------------------------------------------------------------- kabuk */
  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    kap.innerHTML = `
      <section class="bolum">
        <div class="bolum-ust">
          <button class="bolum-bas" aria-expanded="true" type="button">
            <svg class="ikon ok"><use href="#i-ok"/></svg>
            <span class="bolum-ad">Bitki kartları</span>
            <span class="bolum-not" id="bk-sayi"></span>
          </button>
        </div>
        <div class="bolum-govde">
          <p class="ikincil">
            Her bitki için tek kart: bitkinin kendisi ve toprak nemi yan yana.
            Liste varsayılan olarak <b>dikkat isteyenleri</b> öne alıyor.
            Kartın altındaki üç işlem doğrudan o bitkiye uygulanıyor ve
            bahçenin kendi iş kuyruğundan geçiyor — makine meşgulse sıraya
            giriyor.
          </p>
          <div class="bk-ust">
            <div class="alan bk-ara">
              <label for="bk-arama">Ara (ad ya da tür)</label>
              <input type="search" id="bk-arama" placeholder="marul, m3…">
            </div>
            <div class="alan">
              <label for="bk-tur">Tür</label>
              <select id="bk-tur"><option value="">hepsi</option></select>
            </div>
            <div class="alan">
              <label for="bk-sira">Sıralama</label>
              <select id="bk-sira"></select>
            </div>
            <button class="dugme" id="d-bk-tazele" type="button">Yenile</button>
          </div>
          <div class="satir-8 alt-hizali">
            <button class="dugme" id="d-bk-olc" type="button"
                    title="Kendi taze ölçümü olmayan bütün bitkileri sıraya alır"
              >Ölçülmeyenleri ölç</button>
            <div class="alan">
              <label for="bk-bekleme">Probun toprakta bekleme süresi (sn)</label>
              <input type="number" id="bk-bekleme" step="0.5" min="0.5" max="60">
            </div>
            <button class="dugme" id="d-bk-bekleme" type="button">Kaydet</button>
          </div>
          <p class="alt-not">Okumanın oturması toprağın cinsine göre değişiyor:
            killi ve sıkışık toprakta uzun, gevşek harçta kısa. Erken okumak
            yanlış nem, yanlış nem de yanlış sulama kararı demek.</p>
          <div class="bk-suz" id="bk-suz"></div>
          <p class="bk-ozet" id="bk-ozet"></p>
          <div id="bk-hata" class="uyari-kutu gizli"></div>
          <p class="bk-not" id="bk-not"></p>
          <div class="bk-izgara" id="bk-izgara"></div>
        </div>
      </section>`;

    const seciSira = $("#bk-sira");
    seciSira.innerHTML = SIRALAR.map(
      (s) => `<option value="${s.anahtar}">${kacisli(s.ad)}</option>`).join("");
    seciSira.value = sira;
    seciSira.onchange = () => { sira = seciSira.value; ciz(); };

    $("#bk-suz").innerHTML = BAYRAKLAR.map((b) =>
      `<button type="button" data-bayrak="${b.anahtar}" aria-pressed="false"
        >${kacisli(b.ad)}<span class="sayi" data-sayi="${b.anahtar}"></span></button>`
    ).join("");
    $("#bk-suz").querySelectorAll("button").forEach((d) => {
      d.onclick = () => {
        const a = d.dataset.bayrak;
        if (suzgec.bayrak.has(a)) suzgec.bayrak.delete(a);
        else suzgec.bayrak.add(a);
        d.setAttribute("aria-pressed", String(suzgec.bayrak.has(a)));
        ciz();
      };
    });

    const arama = $("#bk-arama");
    arama.oninput = () => { suzgec.arama = arama.value; ciz(); };
    const tur = $("#bk-tur");
    tur.onchange = () => { suzgec.tur = tur.value; ciz(); };
    $("#d-bk-tazele").onclick = () => yukle(true);
    $("#d-bk-olc").onclick = olculmeyenleriOlc;
    $("#d-bk-bekleme").onclick = beklemeKaydet;
    ayarYukle();
    cubugaEkle();
  }

  /* ------------------------------------------------- taze olcumu olmayanlar
   * "Hic olculmedi", "olcum eskimis" ve "komsudan odunc" — ucu de aynı seyi
   * soyluyor: BU BITKININ taze, kendi olcumu yok. Toplu olcum de, Tarla'daki
   * dugme de bu kumeyi kullaniyor. */
  function tazesizler() {
    return ((bahce && bahce.bitkiler) || [])
      .filter((b) => ["olculmedi", "eskimis"].includes(durum(b).ad))
      .map((b) => b.ad);
  }

  async function olculmeyenleriOlc() {
    const adlar = tazesizler();
    if (!adlar.length) {
      notYaz("Bütün bitkilerin kendi taze ölçümü var.");
      return;
    }
    // PARCALARA BOLUYORUZ: sunucu tek iste en fazla AZAMI_SECIM nokta
    // aliyor ve fazlasini topluca reddediyor. Her parca ayri bir kuyruk
    // isi; makine sirayla hepsini dolasiyor.
    const parcalar = [];
    for (let i = 0; i < adlar.length; i += AZAMI_SECIM) {
      parcalar.push(adlar.slice(i, i + AZAMI_SECIM));
    }
    const p = P();
    if (!p) return;
    hataYaz("");
    try {
      for (const parca of parcalar) {
        await p.apiIste("/api/bahce/is", {
          method: "POST", body: JSON.stringify({ tip: "nem", noktalar: parca }),
        });
      }
      notYaz(`${adlar.length} bitki kuyruğa alındı`
        + (parcalar.length > 1 ? ` (${parcalar.length} iş hâlinde)` : "")
        + " — makine sırayla ölçecek.");
      if (p.gunluk) p.gunluk(`✓ Nem ölçümü kuyrukta: ${adlar.length} bitki`, "ok");
      setTimeout(() => yukle(), 2000);
    } catch (h) {
      hataYaz(h.message || "Ölçüm başlatılamadı");
    }
  }

  /* Probun toprakta bekleme suresi.
   *
   * Ekimin sureleriyle AYNI dosyada duruyor (`vakum_sn`, `dusme_sn` ile
   * birlikte): ucu de "islem sirasinda ne kadar bekle" sorusunun cevabi ve
   * ayni soruyu iki ayri yerde aramak istemiyoruz. */
  async function ayarYukle() {
    const p = P();
    if (!p) return;
    try {
      const a = await p.apiIste("/api/ekim/ayar");
      const el = $("#bk-bekleme");
      if (el && document.activeElement !== el) el.value = a.nem_bekleme_sn ?? 4;
    } catch (h) { /* eski sunucuda alan yok — boş kalsın */ }
  }

  async function beklemeKaydet() {
    const p = P();
    if (!p) return;
    const v = Number($("#bk-bekleme").value);
    if (!Number.isFinite(v) || v < 0.5 || v > 60) {
      hataYaz("Bekleme süresi 0,5 ile 60 saniye arasında olmalı.");
      return;
    }
    try {
      // ONCE OKU, SONRA YAZ. Uc nokta eksik alanlari VARSAYILANA cekiyor;
      // yalniz bu alani gondermek, vakum ve dusme surelerini sessizce
      // sifirlamak demekti.
      const mevcut = await p.apiIste("/api/ekim/ayar");
      const y = await p.apiIste("/api/ekim/ayar", {
        method: "POST",
        body: JSON.stringify({ ...mevcut, nem_bekleme_sn: v }),
      });
      hataYaz("");
      const yeni = (y && (y.ayar || y).nem_bekleme_sn) ?? v;
      $("#bk-bekleme").value = yeni;
      notYaz(`Bekleme süresi ${yeni} saniye olarak kaydedildi.`);
      if (p.gunluk) p.gunluk(`✓ Nem ölçüm beklemesi ${yeni} sn`, "ok");
    } catch (h) {
      hataYaz(h.message || "Kaydedilemedi");
    }
  }

  /* Tarla'nin toplu secim cubuguna "Nem olc" dugmesi ekliyor.
   *
   * Cubuk `index.html`de, isleyicileri `tarla.js`te — ikisi de baska bir
   * oturumun dosyasi. Dugmeyi CALISMA ANINDA ekliyoruz: secimi
   * `Tarla.secimDurumu()` veriyor (zaten disa acik), is de bahcenin kendi
   * kuyrugundan geciyor. Boylece Sula ve Ek ile ayni yerde duruyor ama
   * kimsenin dosyasina girmiyoruz.
   *
   * KIMLIK BILEREK ESKISIYLE AYNI (`d-toplu-nem`): bu dugmeyi once `nem.js`
   * ekliyordu ve o modul geri gelirse iki dugme degil, tek dugme olsun. */
  function cubugaEkle() {
    const cubuk = document.getElementById("toplu-cubuk");
    if (!cubuk || document.getElementById("d-toplu-nem")) return;
    const d = document.createElement("button");
    d.className = "dugme";
    d.id = "d-toplu-nem";
    d.type = "button";
    d.title = "Seçili bitkilerin üstüne gidip toprak nemini ölçer";
    d.textContent = "🌡️ Nem ölç";
    d.onclick = () => {
      const t = window.Tarla;
      const adlar = (t && t.secimDurumu) ? t.secimDurumu() : [];
      const p = P();
      if (!adlar.length) {
        if (p && p.gunluk) p.gunluk("✕ Önce bitki seçin", "hata");
        return;
      }
      if (!p) return;
      p.apiIste("/api/bahce/is", {
        method: "POST",
        body: JSON.stringify({ tip: "nem", noktalar: adlar.slice(0, AZAMI_SECIM) }),
      }).then(() => {
        if (p.gunluk) p.gunluk(`✓ Nem ölçümü kuyrukta: ${adlar.length} bitki`, "ok");
      }).catch((h) => {
        if (p.gunluk) p.gunluk(`✕ ${h.message || "Ölçüm başlatılamadı"}`, "hata");
      });
    };
    const ek = document.getElementById("d-toplu-ek");
    if (ek && ek.parentElement === cubuk) ek.insertAdjacentElement("afterend", d);
    else cubuk.appendChild(d);
  }

  /* ----------------------------------------------------------------- veri */
  async function yukle(elle) {
    const p = P();
    if (!p) return;
    try {
      // İKİSİ BİRLİKTE: kartın yarısı yeni yarısı eski veriden yazılırsa
      // "susadı" derken eski bir yüzdeyi gösterebilirdi.
      const [a, b] = await Promise.all([
        p.apiIste("/api/bahce"),
        // Ek uç yoksa (eski sunucu) kart yine çalışsın: eğilim ve sayaçlar
        // boş kalır, geri kalan her şey durur.
        p.apiIste("/api/bitki").catch(() => null),
      ]);
      bahce = a;
      ek = b;
      hataYaz("");
      ciz();
    } catch (h) {
      if (elle) hataYaz(h.message || "Bahçe verisi alınamadı");
    }
  }

  function baslat() {
    durdur();
    zamanlayici = setInterval(() => { if (acikMi()) yukle(); }, TAZELE_MS);
  }
  function durdur() {
    if (zamanlayici) clearInterval(zamanlayici);
    zamanlayici = null;
  }
  function acikMi() {
    const k = document.getElementById(KAP);
    return !!(k && k.classList.contains("etkin"));
  }

  /* ----------------------------------------------------------------- çizim */
  function ciz() {
    const izgara = $("#bk-izgara");
    if (!izgara || !bahce) return;
    const simdi = sayi(bahce.ts, Date.now() / 1000);
    const hepsi = bahce.bitkiler || [];

    // Tür listesi VERİDEN geliyor: katalogdaki her türü değil, bahçede
    // gerçekten olan türleri süzebilmek istiyoruz.
    const turSeci = $("#bk-tur");
    const turler = [];
    for (const b of hepsi) {
      const s = String(b.tur || "");
      if (s && !turler.some((t) => t.slug === s)) {
        turler.push({ slug: s, ad: b.tur_ad || s });
      }
    }
    turler.sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
    const imza = turler.map((t) => t.slug).join("|");
    if (turSeci && turSeci.dataset.imza !== imza) {
      turSeci.dataset.imza = imza;
      turSeci.innerHTML = '<option value="">hepsi</option>' + turler.map(
        (t) => `<option value="${kacisli(t.slug)}">${kacisli(t.ad)}</option>`).join("");
      turSeci.value = suzgec.tur;
      if (turSeci.value !== suzgec.tur) { suzgec.tur = ""; turSeci.value = ""; }
    }

    for (const bay of BAYRAKLAR) {
      const el = $(`[data-sayi="${bay.anahtar}"]`);
      if (el) {
        const n = hepsi.filter(bay.sec).length;
        el.textContent = n ? ` ${n}` : "";
      }
    }

    const liste = sirala(suzulmus(), simdi);
    const sayac = $("#bk-sayi");
    if (sayac) {
      sayac.textContent = liste.length === hepsi.length
        ? `${hepsi.length} bitki`
        : `${liste.length} / ${hepsi.length} bitki`;
    }
    ozetYaz(hepsi, simdi);

    // Dugme KAC BITKIYI olcecegini yaziyor: "Olculmeyenleri olc" tek basina,
    // basmadan once kac is uretecegini bilmemek demekti.
    const olcD = $("#d-bk-olc");
    if (olcD) {
      const n = tazesizler().length;
      olcD.textContent = n ? `Ölçülmeyenleri ölç (${n})` : "Ölçülmeyen bitki yok";
      olcD.disabled = !n;
    }

    if (!hepsi.length) {
      izgara.innerHTML = '<p class="bk-bos-liste">Kayıtlı bitki yok — '
        + 'Tarla sekmesinden bitki ekleyebilirsiniz.</p>';
      return;
    }
    if (!liste.length) {
      izgara.innerHTML = '<p class="bk-bos-liste">Süzgece uyan bitki yok.</p>';
      return;
    }
    izgara.innerHTML = liste.map((b) => kart(b, simdi)).join("");
    izgara.querySelectorAll("[data-is]").forEach((d) => {
      d.onclick = () => isGonder(d.dataset.is, d.dataset.ad, d.dataset.saniye);
    });
    izgara.querySelectorAll("details[data-detay]").forEach((el) => {
      el.addEventListener("toggle", () => {
        if (el.open) acikDetay.add(el.dataset.detay);
        else acikDetay.delete(el.dataset.detay);
      });
    });
  }

  function ozetYaz(hepsi, simdi) {
    const el = $("#bk-ozet");
    if (!el) return;
    const parca = [];
    const say = (f) => hepsi.filter(f).length;
    const ekle = (n, ad) => { if (n) parca.push(`<b>${n}</b> ${ad}`); };
    // ÖZET KARTIN DİLİYLE SAYIYOR. Sunucunun "susadı" bayrağıyla saymak,
    // rozette "ölçülmedi" yazan bir bitkiyi özette susamış göstermek
    // olurdu — ölçümü olmayan bitkiye susadı demiyoruz (bkz. `durum`).
    ekle(say((b) => durum(b).ad === "susadi"), "susadı");
    ekle(say((b) => durum(b).ad === "olculmedi"), "ölçülmedi");
    ekle(say((b) => durum(b).ad === "eskimis"), "ölçümü eskimiş");
    ekle(say((b) => b.hasat), "hasada hazır");
    const o = ek && ek.ortanca != null
      ? ` · bahçe ortancası <b>%${Math.round(ek.ortanca)}</b> (${ek.ortanca_adet} ölçüm)`
      : "";
    el.innerHTML = (parca.join(" · ") || "dikkat isteyen bitki yok") + o;

    // MAKİNENİN HÂLİ KARTIN ÜSTÜNDE: işlem düğmeleri makine kopukken de
    // basılabiliyor (iş kuyruğa giriyor) ama ne olacağını söylemek gerek.
    const not = $("#bk-not");
    if (!not) return;
    const kuyruk = (bahce && bahce.kuyruk) || {};
    const parcalar = [];
    if (bahce && bahce.bagli === false) {
      parcalar.push("Makine bağlı değil — verilen işler bağlanınca çalışır.");
    } else if (bahce && bahce.mesgul) {
      parcalar.push("Makine şu an meşgul — yeni işler sıraya giriyor.");
    }
    if (kuyruk.bekleyen) parcalar.push(`Kuyrukta ${kuyruk.bekleyen} iş bekliyor.`);
    if (kuyruk.calisan) parcalar.push(`Çalışan iş: ${kuyruk.calisan.etiket}.`);
    not.textContent = parcalar.join(" ");
  }

  /* --------------------------------------------------------------- bir kart */
  function alan(baslik, deger, alt, bos) {
    return `<div class="bk-alan${bos ? " bk-bos" : ""}">
      <i>${kacisli(baslik)}</i><b>${deger}</b>${alt ? `<em>${alt}</em>` : ""}</div>`;
  }

  /* --------------------------------------------------------- nem halkası
   *
   * NEDEN HALKA. Kartta "%26 · eşik %30" yazıyordu: iki sayıyı okuyup
   * karşılaştırmayı gerektiriyordu ve 25 kartlık bir listede kimse bunu
   * yapmıyor. Halkanın DOLGUSU nem, üstündeki ÇENTİK eşik; dolgu
   * çentiğin gerisinde kalıyorsa bitki susamış demektir ve bu, tek bir
   * sayı okumadan görünüyor. Sayı halkanın ortasında küçük duruyor.
   *
   * SOLUKLUK BİR ÖLÇÜT, SÜS DEĞİL. Dünkü bir okuma bugünkü kadar
   * güvenilir değil ve ekranda da öyle görünmemeli: halka ölçümün
   * yaşıyla soluyor. Bayat okuma (sulamadan ÖNCE alınmış) yaşı küçük
   * olsa bile en solukta duruyor — o sayı bugünkü toprağı anlatmıyor.
   *
   * KENDİ ÖLÇÜMÜ YOKSA HALKA DOLDURULMUYOR. Sunucu komşudan bir okuma
   * ödünç veriyor; onu dolu bir halka olarak göstermek, ölçmediğimiz bir
   * şeyi ölçmüş gibi sunmak olurdu. Orada kesikli boş bir iz ve ortada
   * "?" var. Ödünç sayı yok olmuyor, Detay'da parantez içinde duruyor.
   *
   * RENK KÖRLÜĞÜ NOTU. Yeşil (#4caf50) ile turuncu (#e8a33c) protanopi
   * altında ΔE 3,2 (OKLab ×100) — yani ayırt edilemiyor. Renkler
   * `35-susuz.js` ile aynı olmak ZORUNDA (aynı durum iki ekranda aynı
   * renk), o yüzden ayrımı renge bırakmıyoruz: rozette durumun adı
   * yazıyor ve halkanın BİÇİMİ farklı — ölçülmemiş halka hiç dolmuyor,
   * kesikli ve ortasında "?" var. Renk üçüncü kanal, tek kanal değil. */
  const HALKA = { boy: 76, r: 30, kalin: 6 };

  function solukluk(o) {
    const azami = sayi(o.azami_yas_sn, 86400) || 86400;
    const t = Math.min(1, Math.max(0, sayi(o.yas_sn, 0)) / azami);
    const d = 1 - 0.65 * t;                 // taze 1,00 → 24 saatlik 0,35
    return o.bayat ? Math.min(d, 0.4) : d;
  }

  function halka(b) {
    const o = b.su_olcum || {};
    const { boy, r, kalin } = HALKA;
    const c = boy / 2;
    const cevre = 2 * Math.PI * r;
    const kendiVar = !!(o.var && o.kendi);
    const yuzde = o.var ? Math.max(0, Math.min(100, sayi(o.yuzde, 0))) : null;
    const esik = o.esik_acik ? Math.max(0, Math.min(100, sayi(o.esik, 0))) : null;

    let centik = "";
    if (esik != null) {
      // Açı tepeden başlıyor ve saat yönünde ilerliyor — dolgu da öyle.
      const a = (esik / 100) * 2 * Math.PI - Math.PI / 2;
      const ic = r - kalin / 2 - 2.5, dis = r + kalin / 2 + 2.5;
      centik = `<line x1="${(c + ic * Math.cos(a)).toFixed(2)}"
        y1="${(c + ic * Math.sin(a)).toFixed(2)}"
        x2="${(c + dis * Math.cos(a)).toFixed(2)}"
        y2="${(c + dis * Math.sin(a)).toFixed(2)}" class="bk-centik"/>`;
    }

    const dolgu = (kendiVar && yuzde != null)
      ? `<circle cx="${c}" cy="${c}" r="${r}" class="bk-yay"
           stroke-dasharray="${(cevre * yuzde / 100).toFixed(2)} ${(cevre + 1).toFixed(2)}"
           transform="rotate(-90 ${c} ${c})"
           style="opacity:${solukluk(o).toFixed(2)}"/>`
      : "";

    const ic = kendiVar
      ? `<b>%${Math.round(yuzde)}</b>`
      : '<b class="bk-soru" aria-hidden="true">?</b>';

    const baslik = kendiVar
      ? `Toprak nemi %${Math.round(yuzde)}`
        + (esik != null ? `, eşik %${Math.round(esik)}` : ", eşik kapalı")
        + `, ${sureMetni(o.yas_sn)} önce kendi üstünden ölçüldü`
      : (o.var
         ? `Kendi ölçümü yok — halka boş. Yandaki bir noktada `
           + `%${Math.round(sayi(o.yuzde, 0))} okundu.`
         : "Kendi ölçümü yok — halka boş.");

    return `<div class="bk-halka" role="img" aria-label="${kacisli(baslik)}"
                 title="${kacisli(baslik)}">
      <svg viewBox="0 0 ${boy} ${boy}" width="${boy}" height="${boy}" aria-hidden="true">
        <circle cx="${c}" cy="${c}" r="${r}"
                class="bk-iz${kendiVar ? "" : " bk-iz-bos"}"/>
        ${dolgu}${centik}
      </svg>
      <span class="bk-halka-ic">
        <i class="bk-simge">${kacisli(b.simge || "🌱")}</i>${ic}
      </span>
    </div>`;
  }

  /* -------------------------------------------------------- kuruma eğrisi
   *
   * AMAÇ SAYI OKUTMAK DEĞİL, EĞİMİ GÖSTERMEK: dik iniyorsa toprak hızlı
   * kuruyor, düzse durum iyi. Eşik yatay bir çizgi olarak duruyor, eğrinin
   * ona ne kadar yaklaştığı görünsün diye. Nokta başına sayı yazmıyoruz —
   * her noktaya değer koymak grafiği okunmaz yapıyor; sayılar Detay'da.
   *
   * YETMİYORSA HİÇ ÇİZMİYORUZ. İki noktadan çizilen şey eğilim değil,
   * çizgidir ve ona bakıp karar vermek yanıltır. En az dört nokta
   * istiyoruz (saatlik kovada bir bükülmenin görünebileceği en küçük
   * sayı) ve en az iki saatlik bir açıklık (daha kısasında eğimi
   * ölçümün kendi gürültüsü belirliyor). Bu iki sayı ÖLÇÜLMÜŞ değil,
   * seçilmiş bir sınır — kaç ölçümden çizildiği notta yazıyor ki okuyan
   * kendi kararını verebilsin.
   *
   * KOPUK YERDE ÇİZGİ YOK. Prob ancak makine o bitkiye gittiğinde
   * okuyor; iki okuma arasında bir gün olabiliyor. Aradan çizgi geçirmek
   * ölçülmemiş bir günü ölçülmüş gibi göstermek olurdu, o yüzden üç
   * saatten uzun boşlukta çizgi kesiliyor. Gerçek okumalar küçük
   * noktalarla duruyor: eğrinin nereden geçtiği değil, nereden ÖLÇÜLDÜĞÜ.
   *
   * Y EKSENİ EN AZ 15 PUAN. Dar pencerede %1'lik bir dalgalanma dik bir
   * iniş gibi görünür; düz olanı düz göstermek bu grafiğin bütün işi. */
  const EGRI = { en: 240, boy: 54, ust: 7, alt: 9, sol: 2, sag: 40 };
  const EGRI_EN_AZ_NOKTA = 4;
  const EGRI_EN_AZ_SURE_SN = 2 * 3600;
  const EGRI_KOPUK_SN = 3 * 3600;
  const EGRI_EN_DAR = 15;

  function egri(b, e) {
    const g = ((e && e.gecmis) || []).filter(
      (p) => Number.isFinite(Number(p && p.yuzde)) && Number.isFinite(Number(p && p.ts)));
    const o = b.su_olcum || {};
    const esik = o.esik_acik ? Math.max(0, Math.min(100, sayi(o.esik, 0))) : null;

    if (g.length < EGRI_EN_AZ_NOKTA) {
      return `<p class="bk-egri-yok">Eğilim için yeterli ölçüm yok —
        ${g.length} ölçüm var, en az ${EGRI_EN_AZ_NOKTA} gerekiyor.</p>`;
    }
    const sure = sayi(g[g.length - 1].ts) - sayi(g[0].ts);
    if (sure < EGRI_EN_AZ_SURE_SN) {
      return `<p class="bk-egri-yok">Eğilim için yeterli ölçüm yok —
        ${g.length} ölçümün hepsi ${sureMetni(sure)} içinde alınmış,
        eğim için en az ${sureMetni(EGRI_EN_AZ_SURE_SN)} gerekiyor.</p>`;
    }

    const { en, boy, ust, alt, sol, sag } = EGRI;
    let dip = Math.min(...g.map((p) => p.yuzde));
    let tep = Math.max(...g.map((p) => p.yuzde));
    if (esik != null) { dip = Math.min(dip, esik); tep = Math.max(tep, esik); }
    const pay = Math.max(2.5, (tep - dip) * 0.15);
    dip -= pay; tep += pay;
    if (tep - dip < EGRI_EN_DAR) {
      const orta = (dip + tep) / 2;
      dip = orta - EGRI_EN_DAR / 2; tep = orta + EGRI_EN_DAR / 2;
    }
    dip = Math.max(0, dip); tep = Math.min(100, tep);
    if (tep - dip < EGRI_EN_DAR) {                 // 0 ya da 100'e dayandıysa
      if (dip <= 0) tep = EGRI_EN_DAR; else dip = tep - EGRI_EN_DAR;
    }

    const t0 = sayi(g[0].ts), t1 = sayi(g[g.length - 1].ts);
    const X = (ts) => sol + (en - sol - sag) * (t1 > t0 ? (sayi(ts) - t0) / (t1 - t0) : 1);
    const Y = (v) => ust + (boy - ust - alt) * (1 - (sayi(v) - dip) / (tep - dip));

    // Kopuk yerde çizgiyi kesiyoruz: parçalar ayrı polyline.
    const parcalar = [];
    let simdiki = [g[0]];
    for (let i = 1; i < g.length; i += 1) {
      if (sayi(g[i].ts) - sayi(g[i - 1].ts) > EGRI_KOPUK_SN) {
        parcalar.push(simdiki); simdiki = [];
      }
      simdiki.push(g[i]);
    }
    parcalar.push(simdiki);

    const cizgiler = parcalar.filter((p) => p.length > 1).map((p) =>
      `<polyline class="bk-cizgi" points="${p.map(
        (q) => `${X(q.ts).toFixed(1)},${Y(q.yuzde).toFixed(1)}`).join(" ")}"/>`).join("");
    const noktalar = g.map((p) =>
      `<circle class="bk-nokta" cx="${X(p.ts).toFixed(1)}"
               cy="${Y(p.yuzde).toFixed(1)}" r="1.4"/>`).join("");
    const son = g[g.length - 1];
    const uc = `<circle class="bk-uc" cx="${X(son.ts).toFixed(1)}"
                        cy="${Y(son.yuzde).toFixed(1)}" r="3"/>`;

    let esikCizgi = "";
    if (esik != null) {
      const y = Y(esik).toFixed(1);
      esikCizgi = `<line class="bk-esik-cizgi" x1="${sol}" y1="${y}"
                         x2="${(en - sag + 4).toFixed(1)}" y2="${y}"/>
        <text class="bk-esik-yazi" x="${(en - sag + 8).toFixed(1)}" y="${y}"
              dominant-baseline="middle">eşik %${Math.round(esik)}</text>`;
    }

    const deg = sayi(son.yuzde) - sayi(g[0].yuzde);
    const yon = deg > 0.5 ? "yükseldi" : deg < -0.5 ? "düştü" : "değişmedi";
    const ozet = `${sureMetni(sure)} içinde ${Math.abs(deg).toFixed(1)} puan ${yon}`;

    return `<div class="bk-egri">
      <svg viewBox="0 0 ${en} ${boy}" preserveAspectRatio="xMidYMid meet"
           role="img" aria-label="Toprak nemi eğrisi: ${kacisli(ozet)}, ${g.length} ölçüm">
        <title>${kacisli(ozet)} · ${g.length} ölçüm</title>
        ${esikCizgi}${cizgiler}${noktalar}${uc}
      </svg>
      <p class="bk-egri-not">${kacisli(ozet)} · ${g.length} ölçüm</p>
    </div>`;
  }

  /* --------------------------------------------------------------- bir kart
   *
   * AÇIK HÂLDE YALNIZ KARAR VERDİREN ŞEYLER: ad, tek bir durum işareti,
   * nem halkası, kuruma eğrisi ve o bitkiye uygulanan işlemler. Geri
   * kalan her şey Detay'ın arkasında — hiçbiri silinmedi, yalnız yer
   * değiştirdi. Eskiden kart on iki alanlık bir yığındı ve "bu bitki bir
   * şey istiyor mu" sorusu paragraf okumadan cevaplanamıyordu. */
  function kart(b, simdi) {
    const d = durum(b);
    const o = b.su_olcum || {};
    const e = (ek && ek.ek && ek.ek[b.ad]) || {};
    const alanlar = [];

    alanlar.push(alan("Yatak koordinatı",
      `X ${Math.round(sayi(b.x))} · Y ${Math.round(sayi(b.y))} mm`,
      sayi(b.z) ? `Z ${Math.round(sayi(b.z))} mm` : ""));

    if (b.ekim) {
      const gun = sayi(b.yas_gun, (simdi - sayi(b.ekim)) / 86400);
      alanlar.push(alan("Ekildi", `${Math.round(gun)} günlük`, tarihMetni(b.ekim)));
    } else {
      alanlar.push(alan("Ekildi", "tarih yok", "yaşı bilinmiyor", true));
    }

    const olgun = sayi(b.olgun_gun, 0);
    if (olgun) {
      const gun = sayi(b.yas_gun, 0);
      alanlar.push(alan("Hasat",
        b.hasat ? "hazır" : `${Math.max(0, Math.round(olgun - gun))} gün kaldı`,
        `türün olgunluğu ${Math.round(olgun)} gün`));
    } else {
      alanlar.push(alan("Hasat", "—", "türde olgunluk süresi yazılı değil", true));
    }

    const cap = Math.round(sayi(b.yaricap_mm) * 2);
    alanlar.push(alan("Yayılma çapı", cap ? `${cap} mm` : "—",
      sayi(b.yayilim_mm) ? `türün olgun çapı ${Math.round(sayi(b.yayilim_mm))} mm` : "",
      !cap));

    // Ödünç okuma PARANTEZ içinde: sayı görünüyor ama bu bitkinin
    // ölçülmüş nemi gibi durmuyor. Halka onu zaten doldurmuyor.
    if (o.var) {
      const yuzde = `%${Math.round(sayi(o.yuzde))}`;
      alanlar.push(alan("Toprak nemi", o.kendi ? yuzde : `(${yuzde})`,
        o.kendi ? "kendi üstünden ölçüldü"
                : `${Math.round(sayi(o.uzak_mm))} mm ötede okundu`));
      alanlar.push(alan("Ölçüm zamanı", `${sureMetni(o.yas_sn)} önce`,
        tarihMetni(simdi - sayi(o.yas_sn))));
    } else {
      alanlar.push(alan("Toprak nemi", "hiç ölçülmedi",
        `${Math.round(sayi(o.yaricap_mm, 100))} mm yakınında okuma yok`, true));
      alanlar.push(alan("Ölçüm zamanı", "—", "", true));
    }

    alanlar.push(o.esik_acik
      ? alan("Sulama eşiği", `%${Math.round(sayi(o.esik))} altında`,
             "halkadaki çentik bu değeri gösteriyor")
      : alan("Sulama eşiği", "kapalı",
             "eşik %100 — nem bakılmadan sulanıyor", true));

    alanlar.push(e.sulama_saniye != null
      ? alan("Sulama süresi", `${e.sulama_saniye} sn`,
             e.sulama_deseni && e.sulama_deseni !== "ust"
               ? `desen: ${kacisli(e.sulama_deseni)} — süre noktalara bölünüyor`
               : "pompanın açık kalacağı süre")
      : alan("Sulama süresi", "—", "", true));

    alanlar.push(b.sulama_ts
      ? alan("Son sulama", `${sureMetni(simdi - sayi(b.sulama_ts))} önce`,
             tarihMetni(b.sulama_ts))
      : alan("Son sulama", "hiç sulanmadı",
             b.ekim ? "ekimden beri su gitmedi" : "", true));

    if (ek && ek.defter_bas_ts) {
      alanlar.push(alan("Kaç kez sulandı", `${sayi(e.sula_adet, 0)} kez`,
        `${sayi(e.nem_adet, 0)} kez nem ölçüldü · kayıt `
        + `${tarihMetni(ek.defter_bas_ts)}'ten beri`));
    } else {
      alanlar.push(alan("Kaç kez sulandı", "kayıt yeni",
        "sayaç ilk sulamadan sonra dolmaya başlar", true));
    }

    if (e.egilim) {
      const g = e.egilim;
      const y = g.degisim > 0.5 ? "yükseldi" : g.degisim < -0.5 ? "düştü" : "değişmedi";
      alanlar.push(alan("Nem eğilimi",
        `%${Math.round(g.ilk)} → %${Math.round(g.son)}`,
        `${sureMetni(g.sure_sn)} içinde ${Math.abs(g.degisim).toFixed(1)} puan `
        + `${y} · ${g.adet} okuma`));
    } else {
      alanlar.push(alan("Nem eğilimi", "yeterli okuma yok",
        "eğilim için yakınında en az iki okuma gerekiyor", true));
    }

    if (e.ortanca_fark != null && ek && ek.ortanca != null) {
      const f = e.ortanca_fark;
      const yazi = Math.abs(f) < 1 ? "bahçe ortancasında"
        : `ortancanın ${Math.abs(f).toFixed(1)} puan ${f < 0 ? "altında" : "üstünde"}`;
      alanlar.push(alan("Komşularına göre", yazi,
        `bahçe ortancası %${Math.round(ek.ortanca)} · ${ek.ortanca_adet} taze ölçüm`));
    } else {
      alanlar.push(alan("Komşularına göre", "karşılaştırılamıyor",
        "kendi taze ölçümü olmayan bitki ortancaya katılmıyor", true));
    }

    const uyarilar = [];
    if (b.cakisik) {
      uyarilar.push("Komşusunun yayılım çemberine giriyor — biri ötekini "
        + "gölgeleyebilir.");
    }
    const sn = e.sulama_saniye != null ? ` data-saniye="${e.sulama_saniye}"` : "";
    const ad = kacisli(b.ad);

    return `<article class="bk-kart bk-d-${d.ad}">
      <div class="bk-bas">
        ${halka(b)}
        <div class="bk-kimlik">
          <b>${kacisli(b.tur_ad || b.tur || "Bitki")}</b>
          <span>${ad}</span>
          <span class="bk-durum"><i></i>${kacisli(d.etiket)}</span>
        </div>
      </div>
      ${egri(b, e)}
      <div class="bk-islem">
        <button class="dugme" type="button" data-is="nem" data-ad="${ad}"
                title="Makine bu bitkinin üstüne gidip probu toprağa daldırır"
          >🌡️ Nem ölç</button>
        <button class="dugme birincil" type="button" data-is="sula" data-ad="${ad}"${sn}
                title="Bu bitkiyi kendi sulama süresiyle sular"
          >💧 Sula</button>
        <button class="dugme" type="button" data-is="gez" data-ad="${ad}"
                title="Makineyi bu bitkinin üstüne gönderir"
          >📍 Konumuna git</button>
      </div>
      <details class="bk-detay" data-detay="${ad}"${acikDetay.has(b.ad) ? " open" : ""}>
        <summary>Detay</summary>
        <div class="bk-alanlar">${alanlar.join("")}</div>
        <p class="bk-gerekce">${kacisli(b.su_gerekce || d.neden || "")}${
          b.su_tahmin
            ? ' <span class="bk-tahmin">— bu karar ÖLÇÜME değil, geçen güne dayanıyor</span>'
            : ""}</p>
        ${uyarilar.map((u) => `<p class="bk-uyari">${kacisli(u)}</p>`).join("")}
      </details>
    </article>`;
  }

  /* ---------------------------------------------------------------- işlem */
  /* İş KUYRUĞA giriyor — bahçenin kendi yolundan. İkinci bir hareket yolu
   * açmak, yasak bölge ve sınır denetimlerinin yalnız birinden geçen bir
   * hareket demekti. */
  async function isGonder(tip, ad, saniye) {
    const p = P();
    if (!p || !ad) return;
    const govde = { tip, noktalar: [ad] };
    // SÜREYİ AÇIKÇA GÖNDERİYORUZ. Kuyruk yolu süre verilmediğinde 3 saniyeye
    // düşüyor; kartta "4 sn" yazarken 3 saniye sulamak, kartı yalancı yapardı.
    if (tip === "sula" && saniye != null && saniye !== "") {
      govde.saniye = Number(saniye);
    }
    const etiket = { nem: "Nem ölçümü", sula: "Sulama", gez: "Ziyaret" }[tip] || tip;
    try {
      await p.apiIste("/api/bahce/is", {
        method: "POST", body: JSON.stringify(govde),
      });
      notYaz(`${etiket} kuyruğa alındı: ${ad}`);
      if (p.gunluk) p.gunluk(`✓ ${etiket} kuyrukta: ${ad}`, "ok");
      setTimeout(() => yukle(), 2000);
    } catch (h) {
      hataYaz(h.message || `${etiket} başlatılamadı`);
    }
  }

  function notYaz(metin) {
    const n = $("#bk-not");
    if (!n) return;
    n.textContent = metin || "";
    clearTimeout(notYaz._z);
    notYaz._z = setTimeout(() => { if (bahce) ozetYaz(bahce.bitkiler || [], sayi(bahce.ts)); }, 6000);
  }

  function hataYaz(metin) {
    const k = $("#bk-hata");
    if (!k) return;
    k.textContent = metin || "";
    k.classList.toggle("gizli", !metin);
  }

  /* ----------------------------------------------------------------- sekme
   * Sekme değişimini `app.js` yönetiyor ve oraya dokunmuyoruz: gezinti
   * çubuğunu dinliyoruz. Programlı `.click()` de (app.js kayıtlı sekmeyi
   * böyle geri yüklüyor) bu dinleyiciyi tetikliyor. */
  function sekmeBak() {
    if (acikMi()) { yukle(); baslat(); } else durdur();
  }

  function kurVeBagla() {
    kur();
    const nav = document.querySelector("nav.sekmeler");
    if (nav) nav.addEventListener("click", () => setTimeout(sekmeBak, 0));
    sekmeBak();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(kurVeBagla, 0));
  } else {
    setTimeout(kurVeBagla, 0);
  }
})();
