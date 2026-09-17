/* Tüm bitkileri kapsayan sulama süresi — panel tarafı.
 *
 * AYAR SUNUCUDA, BURASI YALNIZ ANAHTAR. Değer `sunucu/sulama_genel.py`de
 * duruyor; panel kapalıyken çalışan zamanlı görevler ve "ölç, düşükse
 * sula" işi de aynı değeri okuyor. Tarayıcıda tutulsaydı "tüm bitkiler"
 * onları kapsamazdı.
 *
 * NİYE AYRI DOSYA. `app.js` ve `index.html` iki oturum tarafından
 * düzenleniyor; tek bir onay kutusu için o dosyaların içine girmek
 * çakışma riski. Bu katman kendi denetimini VAR OLAN düğmenin yanına
 * kendisi takıyor, `index.html`e tek bir `<script>` satırı yetiyor.
 */
(function () {
  "use strict";

  /* Denetimin takılacağı yerler: sulamayı BAŞLATAN düğmelerin yanı.
   * Ayarlar sekmesine koymak daha "düzenli" olurdu ama sulamaya basarken
   * hangi sürenin geçerli olduğu görünmezdi — asıl soru o an sorulyor. */
  const CAPALAR = ["#d-toplu-sula", "#d-tepsi-sula"];

  const D = { acik: false, saniye: 5, enAz: 0.5, enCok: 60, hazir: false };

  function P() { return window.Panel || null; }

  async function yukle() {
    const p = P();
    if (!p || !p.apiIste) return;
    try {
      const y = await p.apiIste("/api/sulama/genel");
      D.acik = !!y.acik;
      D.saniye = Number(y.saniye) || D.saniye;
      if (y.en_az != null) D.enAz = Number(y.en_az);
      if (y.en_cok != null) D.enCok = Number(y.en_cok);
      D.hazir = true;
    } catch (h) {
      /* Sessiz kalmıyoruz: ayar okunamadıysa denetim hiç takılmıyor ve
       * kullanıcı "kapalı" ile "bilinmiyor"u karıştırmamalı. */
      if (p.gunluk) p.gunluk("✕ Genel sulama süresi okunamadı: " + h.message, "hata");
    }
  }

  async function kaydet(acik, saniye) {
    const p = P();
    if (!p || !p.apiIste) return;
    const govde = {};
    if (acik !== null) govde.acik = acik;
    if (saniye !== null) govde.saniye = saniye;
    try {
      const y = await p.apiIste("/api/sulama/genel", {
        method: "POST", body: JSON.stringify(govde),
      });
      D.acik = !!y.acik;
      D.saniye = Number(y.saniye) || D.saniye;
      if (p.gunluk) {
        p.gunluk(D.acik
          ? "Genel sulama süresi açık: tüm bitkiler " + D.saniye + " sn"
          : "Genel sulama süresi kapalı: her bitki kendi türünün süresiyle",
          "ok");
      }
    } catch (h) {
      if (p.gunluk) p.gunluk("✕ Genel sulama süresi kaydedilemedi: " + h.message,
                             "hata");
    }
    hepsiniTazele();
  }

  /* ------------------------------------------------------------ denetim */
  function denetimKur(capa) {
    const dugme = document.querySelector(capa);
    if (!dugme || !dugme.parentNode) return null;
    if (dugme.previousElementSibling
        && dugme.previousElementSibling.classList
        && dugme.previousElementSibling.classList.contains("gsulama")) {
      return dugme.previousElementSibling;
    }

    const kap = document.createElement("label");
    kap.className = "gsulama";
    kap.title = "Açıkken bütün bitkiler bu süre kadar sulanıyor; "
      + "türe özgü süreler silinmiyor, kapatınca yine geçerli oluyorlar.";

    const kutu = document.createElement("input");
    kutu.type = "checkbox";
    kutu.className = "gsulama-kutu";
    kutu.addEventListener("change", () => kaydet(kutu.checked, null));

    const alan = document.createElement("input");
    alan.type = "number";
    alan.className = "gsulama-sn";
    alan.min = String(D.enAz);
    alan.max = String(D.enCok);
    alan.step = "0.5";
    /* DEĞER "change"de yazılıyor, her tuşta değil: 12 yazarken araya
     * düşen 1 de kaydedilirdi ve kullanıcı kaydırıcıyı bıraktığında
     * bambaşka bir sayı kayıtlı olurdu. */
    alan.addEventListener("change", () => kaydet(null, Number(alan.value)));
    /* Etiketin içindeki alana tıklamak onay kutusunu değiştirmesin. */
    alan.addEventListener("click", (o) => o.stopPropagation());

    const yazi = document.createElement("span");
    yazi.className = "gsulama-yazi";
    yazi.textContent = "sn · hepsi";

    kap.appendChild(kutu);
    kap.appendChild(alan);
    kap.appendChild(yazi);
    dugme.parentNode.insertBefore(kap, dugme);
    return kap;
  }

  function tazele(kap) {
    const kutu = kap.querySelector(".gsulama-kutu");
    const alan = kap.querySelector(".gsulama-sn");
    if (kutu.checked !== D.acik) kutu.checked = D.acik;
    /* Odaktaki alana YAZMIYORUZ: kullanıcı sayıyı düzeltirken imleç
     * başa atlardı. */
    if (document.activeElement !== alan && alan.value !== String(D.saniye)) {
      alan.value = String(D.saniye);
    }
    kap.classList.toggle("acik", D.acik);
  }

  function hepsiniTazele() {
    if (!D.hazir) return;
    CAPALAR.forEach((c) => {
      const kap = denetimKur(c);
      if (kap) tazele(kap);
    });
  }

  function bicemKur() {
    if (document.getElementById("gsulama-bicem")) return;
    const s = document.createElement("style");
    s.id = "gsulama-bicem";
    /* Biçem gömülü: `stil.css` iki oturumun da elinde. */
    s.textContent = ".gsulama{display:inline-flex;align-items:center;gap:.3rem;"
      + "font-size:.85rem;opacity:.7;cursor:pointer;white-space:nowrap;"
      + "padding:.1rem .35rem;border-radius:.3rem}"
      + ".gsulama.acik{opacity:1;background:rgba(255,209,102,.16);"
      + "outline:1px solid rgba(255,209,102,.5)}"
      + ".gsulama-sn{width:3.6rem}"
      + ".gsulama-yazi{opacity:.85}";
    document.head.appendChild(s);
  }

  function gozcuKur() {
    /* Toplu çubuk seçim boşken gizli ve DOM'a sonradan giriyor; düğme
     * geldiğinde denetimi de takmak gerekiyor. */
    const g = new MutationObserver(() => hepsiniTazele());
    g.observe(document.body, { childList: true, subtree: true });
  }

  async function kur() {
    bicemKur();
    await yukle();
    hepsiniTazele();
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

  window.FarmbotGenelSulama = {
    durum: function () { return { acik: D.acik, saniye: D.saniye }; },
    tazele: async function () { await yukle(); hepsiniTazele(); },
  };
})();
