/* Favori türler — tür açılır listelerinin başına yıldızlananları taşır.
 *
 * NİYE DIŞARIDAN SIRALIYOR. Tür listesi panelde birden çok yerde
 * kuruluyor (`tarla.js` #tur-secim, `bitki.js` #bk-tur, ileride başkaları)
 * ve her biri kendi sıralamasını yapıyor — `tarla.js` örneğin alfabetik
 * sıralıyor. Her birini tek tek değiştirmek, yeni bir tür listesi eklendiği
 * gün sessizce sırasız kalması demekti. Onun yerine bu katman AÇILIR
 * LİSTEYİ TANIYOR: seçeneklerinin değerleri tür anahtarıysa o listeyi
 * yeniden diziyor. Hangi dosyanın kurduğu önemli değil.
 *
 * SUNUCUDA SIRALAMIYORUZ, aynı sebeple: `/api/turler` sırayı verse bile
 * kendi içinde yeniden sıralayan ekranlar onu sessizce bozardı.
 *
 * DEĞERLERE DOKUNULMUYOR. Seçenekler `optgroup` içine TAŞINIYOR, metni
 * ya da `value`si değiştirilmiyor; `select.value` işlem öncesi okunup
 * sonrasında geri yazılıyor. Metne yıldız eklemek daha kolaydı ama
 * seçeneğin metnini okuyan bir kod olsa sessizce bozulurdu.
 */
(function () {
  "use strict";

  const SURUM = 1;
  const BASLIK_FAVORI = "★ Favoriler";
  const BASLIK_KALAN = "Tümü";
  /* Bir açılır listeyi "tür listesi" saymak için gereken en az eşleşme.
   * 1 olsaydı, değeri rastgele bir tür anahtarıyla çakışan herhangi bir
   * liste de yeniden dizilirdi. */
  const EN_AZ_ESLESME = 2;
  /* Sıra karşılaştırmasında kullanılan ayraç. Tür anahtarları
   * `^[a-z0-9][a-z0-9_-]*$` biçiminde, yani bu karakter içlerinde
   * geçemiyor; boru işareti seçilseydi ileride geçebilirdi. */
  const AYRAC = "␟";

  const D = {
    slug: new Set(),        // katalogdaki tür anahtarları
    tur: [],                // [{slug, ad, ikon}] — çoklu seçim listesi için
    favori: [],             // kullanıcının sırasıyla
    gozcu: null,
    hazir: false,
  };

  function P() { return window.Panel || null; }

  /* ----------------------------------------------------------- sunucu */
  async function favorileriYukle() {
    const p = P();
    if (!p || !p.apiIste) return;
    try {
      const y = await p.apiIste("/api/favori");
      D.favori = Array.isArray(y.favoriler) ? y.favoriler : [];
    } catch (h) {
      /* Sessiz kalmıyoruz: favori okunamazsa sıralama olduğu gibi kalıyor
       * ve kullanıcı bunun arıza mı düzen mi olduğunu bilmeli. */
      if (p.gunluk) p.gunluk("✕ Favori türler okunamadı: " + h.message, "hata");
      D.favori = [];
    }
  }

  async function turleriYukle() {
    const p = P();
    if (!p || !p.apiIste) return;
    try {
      const y = await p.apiIste("/api/turler");
      /* Ad ve simge de saklanıyor: çoklu seçim listesinde tür anahtarı
       * ("aycicegi") değil kullanıcının gördüğü ad yazmalı. */
      D.tur = (y.turler || [])
        .map((t) => ({ slug: String(t.slug || ""),
                       ad: String(t.name_tr || t.slug || ""),
                       ikon: String(t.icon || "🌱") }))
        .filter((t) => t.slug)
        .sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
      D.slug = new Set(D.tur.map((t) => t.slug));
    } catch (h) {
      if (p.gunluk) p.gunluk("✕ Tür listesi okunamadı: " + h.message, "hata");
      D.tur = [];
      D.slug = new Set();
    }
  }

  async function degistir(slug, favori) {
    const p = P();
    if (!p || !p.apiIste || !slug) return;
    try {
      const y = await p.apiIste("/api/favori", {
        method: "POST", body: JSON.stringify({ slug: slug, favori: !!favori }),
      });
      D.favori = Array.isArray(y.favoriler) ? y.favoriler : D.favori;
      if (p.gunluk) {
        p.gunluk((favori ? "★ " : "☆ ") + slug + " "
          + (favori ? "favorilere eklendi" : "favorilerden çıkarıldı"), "ok");
      }
    } catch (h) {
      if (p.gunluk) p.gunluk("✕ Favori değiştirilemedi: " + h.message, "hata");
      return;
    }
    hepsiniDiz();
    kutulariTazele();
  }

  /* --------------------------------------------------------- tanıma */
  /** Bu açılır liste bir TÜR listesi mi? Değerlerine bakıyoruz. */
  function turListesiMi(sec) {
    if (!D.slug.size) return false;
    let eslesen = 0;
    const secenekler = sec.querySelectorAll("option");
    for (let i = 0; i < secenekler.length; i++) {
      const v = secenekler[i].value;
      if (v && D.slug.has(v)) eslesen++;
      if (eslesen >= EN_AZ_ESLESME) return true;
    }
    return false;
  }

  /* -------------------------------------------------------- dizilim */
  /** İstenen sıra: boş değerliler (örn. "hepsi") başta, sonra favoriler,
   *  sonra kalanlar — kalanlar KENDİ İÇİNDEKİ sırayı koruyarak. */
  function istenenSira(secenekler) {
    const bos = [], fav = [], kalan = [];
    const yer = new Map();
    D.favori.forEach((s, i) => yer.set(s, i));
    secenekler.forEach((o) => {
      if (!o.value) bos.push(o);
      else if (yer.has(o.value)) fav.push(o);
      else kalan.push(o);
    });
    /* Favoriler KULLANICININ sırasıyla; alfabetik sıralasaydık "en çok
     * kullandığımı en üste al" imkânı kalmazdı. */
    fav.sort((a, b) => yer.get(a.value) - yer.get(b.value));
    return { bos: bos, fav: fav, kalan: kalan };
  }

  function diz(sec) {
    const secenekler = Array.prototype.slice.call(sec.querySelectorAll("option"));
    if (!secenekler.length) return;
    const bolum = istenenSira(secenekler);
    const bos = bolum.bos, fav = bolum.fav, kalan = bolum.kalan;

    /* Zaten doğru diziliyse DOKUNMUYORUZ. Gözlemci kendi değişikliğimizi
     * yeniden tetikleyip sonsuz döngü kurmasın diye şart. */
    const simdiki = secenekler.map((o) => o.value).join(AYRAC);
    const hedef = bos.concat(fav, kalan).map((o) => o.value).join(AYRAC);
    const gruplu = !!sec.querySelector("optgroup");
    if (simdiki === hedef && (fav.length > 0) === gruplu) return;

    const secili = sec.value;
    try {
      const parca = document.createDocumentFragment();
      bos.forEach((o) => parca.appendChild(o));
      if (fav.length) {
        const g1 = document.createElement("optgroup");
        g1.label = BASLIK_FAVORI;
        fav.forEach((o) => g1.appendChild(o));
        parca.appendChild(g1);
        if (kalan.length) {
          const g2 = document.createElement("optgroup");
          g2.label = BASLIK_KALAN;
          kalan.forEach((o) => g2.appendChild(o));
          parca.appendChild(g2);
        }
      } else {
        kalan.forEach((o) => parca.appendChild(o));
      }
      sec.textContent = "";
      sec.appendChild(parca);
      /* Seçim korunuyor: yeniden dizmek kullanıcının seçtiği türü
       * değiştirmemeli. */
      if (secili !== sec.value) sec.value = secili;
    } finally {
      /* bir şey patlarsa liste yarım kalmasın diye gövde try içinde */
      void 0;
    }
  }

  /* ------------------------------------------------------ yıldız düğmesi */
  function dugmeTazele(dugme, sec) {
    const slug = sec.value;
    const acik = !!slug && D.favori.indexOf(slug) >= 0;
    /* YALNIZ DEĞİŞİNCE yazıyoruz. `textContent` ataması değer aynı olsa
     * bile bir DOM değişikliği sayılıyor; gözlemci onu görüp yeniden
     * dizmeye kalkıyordu. Ölçümde bu, listeyi hiç durulmaz hâle getirdi
     * (Playwright "element unstable" deyip seçenek seçemedi). */
    const simge = acik ? "★" : "☆";
    if (dugme.textContent !== simge) dugme.textContent = simge;
    dugme.disabled = !slug;
    dugme.title = !slug
      ? "Önce bir tür seçin"
      : (acik ? slug + " favorilerden çıkar" : slug + " favorilere ekle");
    dugme.setAttribute("aria-pressed", acik ? "true" : "false");
  }

  function dugmeKur(sec) {
    if (sec.dataset.favoriDugme === "1") return null;
    sec.dataset.favoriDugme = "1";
    const dugme = document.createElement("button");
    dugme.type = "button";
    dugme.className = "favori-yildiz";
    dugme.addEventListener("click", () => {
      const slug = sec.value;
      if (!slug) return;
      degistir(slug, D.favori.indexOf(slug) < 0);
    });
    sec.addEventListener("change", () => dugmeTazele(dugme, sec));
    /* İKİNCİ DÜĞME — ÇOKLU SEÇİM. Yıldız yalnız SEÇİLİ türü değiştiriyor;
     * on türü favorilemek için on kez tür seçip on kez yıldıza basmak
     * gerekirdi. Bu düğme bütün türleri onay kutusuyla açıyor, istediğin
     * kadarını aynı anda işaretliyorsun. İkisi de duruyor çünkü tek tür
     * için açılır liste kurmak da gereksiz yavaş olurdu. */
    const liste = document.createElement("button");
    liste.type = "button";
    liste.className = "favori-liste-ac";
    liste.textContent = "▾";
    liste.title = "Favori türleri seç (çoklu)";
    liste.setAttribute("aria-haspopup", "true");
    liste.setAttribute("aria-expanded", "false");
    liste.addEventListener("click", (o) => {
      o.preventDefault();
      o.stopPropagation();
      listeAcKapa(liste);
    });
    /* Açılır listenin hemen yanına, kendi kabının içine — ayrı bir sarmalayıcı
     * KURULMUYOR: panelin kendi düzeni bozulmasın. */
    if (sec.parentNode) {
      sec.parentNode.insertBefore(dugme, sec.nextSibling);
      sec.parentNode.insertBefore(liste, dugme.nextSibling);
    }
    dugmeTazele(dugme, sec);
    return dugme;
  }

  /* --------------------------------------------------- çoklu seçim listesi */
  function listeKapat() {
    const eski = document.getElementById("favori-liste");
    if (eski) eski.remove();
    document.querySelectorAll(".favori-liste-ac[aria-expanded='true']")
      .forEach((d) => d.setAttribute("aria-expanded", "false"));
    document.removeEventListener("click", disariTiklama, true);
    document.removeEventListener("keydown", tusBasildi, true);
  }

  function disariTiklama(o) {
    const kap = document.getElementById("favori-liste");
    if (kap && !kap.contains(o.target)
        && !(o.target.classList && o.target.classList.contains("favori-liste-ac"))) {
      listeKapat();
    }
  }

  function tusBasildi(o) {
    if (o.key === "Escape") { o.stopPropagation(); listeKapat(); }
  }

  function kutulariTazele() {
    const kap = document.getElementById("favori-liste");
    if (!kap) return;
    kap.querySelectorAll("input[type=checkbox]").forEach((k) => {
      const isaretli = D.favori.indexOf(k.value) >= 0;
      if (k.checked !== isaretli) k.checked = isaretli;
    });
    const sayi = kap.querySelector(".favori-liste-sayi");
    if (sayi) sayi.textContent = D.favori.length + " favori";
  }

  function listeAcKapa(acanDugme) {
    if (document.getElementById("favori-liste")) { listeKapat(); return; }
    if (!D.tur.length) return;

    const kap = document.createElement("div");
    kap.id = "favori-liste";
    kap.className = "favori-liste";
    kap.setAttribute("role", "group");
    kap.setAttribute("aria-label", "Favori türler");

    const bas = document.createElement("div");
    bas.className = "favori-liste-bas";
    bas.innerHTML = "<b>Favori türler</b>";
    const sayi = document.createElement("span");
    sayi.className = "favori-liste-sayi";
    bas.appendChild(sayi);
    kap.appendChild(bas);

    const govde = document.createElement("div");
    govde.className = "favori-liste-govde";
    /* SIRA AÇILIRKEN DONDURULUYOR: her tıklamada favoriler başa zıplasaydı
     * ikinci kutuyu işaretlemek için fareyi yeniden aramak gerekirdi. */
    const yer = new Map();
    D.favori.forEach((s2, i) => yer.set(s2, i));
    const sirali = D.tur.slice().sort((a, b) => {
      const fa = yer.has(a.slug) ? yer.get(a.slug) : Infinity;
      const fb = yer.has(b.slug) ? yer.get(b.slug) : Infinity;
      if (fa !== fb) return fa - fb;
      return a.ad.localeCompare(b.ad, "tr");
    });
    sirali.forEach((t) => {
      const satir = document.createElement("label");
      satir.className = "favori-liste-satir";
      const kutu = document.createElement("input");
      kutu.type = "checkbox";
      kutu.value = t.slug;
      kutu.checked = D.favori.indexOf(t.slug) >= 0;
      kutu.addEventListener("change", () => {
        /* Her kutu kendi isteğini yolluyor. Toplu "kaydet" düğmesi
         * KOYMUYORUZ: kullanıcı kapatıp gittiğinde kaydedilmemiş işaret
         * kalması, sessizce kaybolan bir değişiklik olurdu. */
        degistir(t.slug, kutu.checked);
      });
      satir.appendChild(kutu);
      const ad = document.createElement("span");
      ad.textContent = t.ikon + " " + t.ad;
      satir.appendChild(ad);
      govde.appendChild(satir);
    });
    kap.appendChild(govde);
    document.body.appendChild(kap);

    /* Konum: düğmenin altına, ekranın dışına taşmayacak şekilde. Sayfa
     * kaydırmasıyla birlikte gitsin diye belge koordinatı kullanılıyor. */
    const k = acanDugme.getBoundingClientRect();
    const genislik = kap.offsetWidth || 240;
    let sol = k.left + window.scrollX;
    sol = Math.max(8, Math.min(sol, window.innerWidth + window.scrollX - genislik - 8));
    kap.style.left = sol + "px";
    kap.style.top = (k.bottom + window.scrollY + 4) + "px";

    acanDugme.setAttribute("aria-expanded", "true");
    kutulariTazele();
    document.addEventListener("click", disariTiklama, true);
    document.addEventListener("keydown", tusBasildi, true);
  }

  function dugmeleriTazele() {
    document.querySelectorAll("select[data-favori-dugme='1']").forEach((sec) => {
      const dugme = sec.nextElementSibling;
      if (dugme && dugme.classList.contains("favori-yildiz")) {
        dugmeTazele(dugme, sec);
      }
    });
  }

  /* --------------------------------------------------------------- akış */
  function hepsiniDiz() {
    if (!D.hazir) return;
    /* GÖZLEMCİ AYRILIYOR. Bayrakla korumak yetmedi: gözlemci geri çağrısı
     * bir mikro görev sonra çalışıyor ve o sırada bayrak çoktan inmiş
     * oluyordu. `disconnect()` bekleyen kayıtları da atıyor, yani kendi
     * değişikliğimiz geri dönmüyor. */
    const vardi = !!D.gozcu;
    if (vardi) D.gozcu.disconnect();
    try {
      document.querySelectorAll("select").forEach((sec) => {
        if (!turListesiMi(sec)) return;
        diz(sec);
        dugmeKur(sec);
      });
      dugmeleriTazele();
    } finally {
      if (vardi) D.gozcu.observe(document.body, { childList: true, subtree: true });
    }
  }

  function bicemKur() {
    if (document.getElementById("favori-bicem")) return;
    const s = document.createElement("style");
    s.id = "favori-bicem";
    /* Biçem buraya gömülü: `stil.css` iki oturum tarafından da
     * düzenleniyor, tek düğme için oraya girmek çakışma riski. */
    s.textContent = ".favori-yildiz{background:none;border:0;cursor:pointer;"
      + "font-size:1.05rem;line-height:1;padding:.2rem .3rem;color:#ffd166;"
      + "align-self:center}"
      + ".favori-yildiz[disabled]{opacity:.35;cursor:default}"
      + ".favori-yildiz:focus-visible,.favori-liste-ac:focus-visible{"
      + "outline:2px solid currentColor;outline-offset:2px;border-radius:.2rem}"
      + ".favori-liste-ac{background:none;border:0;cursor:pointer;"
      + "font-size:.9rem;line-height:1;padding:.2rem .25rem;opacity:.75;"
      + "align-self:center}"
      + ".favori-liste-ac:hover{opacity:1}"
      + ".favori-liste{position:absolute;z-index:9999;min-width:220px;"
      + "max-height:60vh;overflow:auto;background:#1b1e22;color:#e8e8e8;"
      + "border:1px solid #3a3f45;border-radius:.4rem;padding:.4rem;"
      + "box-shadow:0 8px 24px rgba(0,0,0,.45);font-size:.9rem}"
      + ".favori-liste-bas{display:flex;justify-content:space-between;"
      + "align-items:baseline;gap:.5rem;padding:.15rem .3rem .35rem}"
      + ".favori-liste-sayi{opacity:.6;font-size:.8rem}"
      + ".favori-liste-satir{display:flex;align-items:center;gap:.45rem;"
      + "padding:.25rem .3rem;border-radius:.25rem;cursor:pointer}"
      + ".favori-liste-satir:hover{background:rgba(255,255,255,.07)}";
    document.head.appendChild(s);
  }

  function gozcuKur() {
    if (D.gozcu) return;
    D.gozcu = new MutationObserver(() => { hepsiniDiz(); });
    D.gozcu.observe(document.body, { childList: true, subtree: true });
  }

  async function kur() {
    bicemKur();
    await turleriYukle();
    await favorileriYukle();
    D.hazir = true;
    hepsiniDiz();
    gozcuKur();
  }

  function bekle() {
    if (P() && P().apiIste) { kur(); return; }
    setTimeout(bekle, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bekle);
  } else {
    bekle();
  }

  window.FarmbotFavori = {
    surum: SURUM,
    liste: function () { return D.favori.slice(); },
    diz: hepsiniDiz,
    tazele: async function () { await favorileriYukle(); hepsiniDiz(); },
    /* Ölçüm ve deneme için: tarayıcı konsolundan doğrudan çağrılabiliyor. */
    _durum: function () { return { slug: D.slug.size, favori: D.favori.slice() }; },
  };
})();
