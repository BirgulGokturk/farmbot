/* Zamanlanmış görevler — "şu işi şu aralıkla yap".
 *
 * NEDEN VAR. Programlar vardı ama hepsi ELLE çalışıyordu. Burada bir
 * aralık ve bir iş seçiliyor, düğmeye basılıyor ve iş kendiliğinden
 * tekrarlanıyor.
 *
 * EKRANDA ÜÇ ŞEY OLMAK ZORUNDA: çalışıyor mu, en son ne zaman çalıştı,
 * bir sonraki ne zaman. Üçü olmadan "kurdum ama çalışıyor mu bilmiyorum"
 * hâli oluyor ve kullanıcı zamanlayıcıya güvenemiyor. Dördüncüsü de
 * burada: ATLANDIYSA NEDEN. Sunucu tiki makine kopukken atlıyor (bkz.
 * `zamanli.py`) ve sebebini yazıyor — "atlandı" tek başına, iş yapmamayı
 * sebebini söylemeden bildirmek olurdu.
 *
 * GERİ SAYIM YEREL SAATLE DEĞİL. Sunucu "kaç saniye kaldı" diyor; tarayıcı
 * onu kendi saatiyle değil, aldığı andan itibaren geçen süreyle azaltıyor.
 * İki saat arasında dakikalar fark olabiliyor ve "3 dakika sonra" yazan
 * bir satırın yanlış olması, hiç yazmamaktan kötü.
 *
 * AYRI DOSYA: `app.js` ve `index.html` başka bir oturumda değişiyor;
 * buraya yalnız boş bir kap giriyor.
 */
(function () {
  "use strict";

  const KAP = "zamanli-bolum";
  const SAYFA = "sayfa-otomasyon";
  const TAZELE_MS = 5000;

  let veri = null;
  let alindi = 0;               // veri hangi anda geldi (performance.now)
  let zamanlayici = null;
  let geriSayim = null;
  let duzenlenen = "";          // düzenlenen görevin kimliği ("" = yeni)

  const $ = (s) => document.querySelector(s);
  const P = () => window.Panel || null;
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));
  const sayi = (d, v = 0) => (Number.isFinite(Number(d)) ? Number(d) : v);

  function sureMetni(sn) {
    if (sn == null || !Number.isFinite(Number(sn))) return "—";
    const d = Math.max(0, Number(sn));
    if (d < 90) return `${Math.round(d)} sn`;
    if (d < 5400) return `${Math.round(d / 60)} dk`;
    if (d < 172800) return `${Math.round(d / 3600)} sa`;
    return `${Math.round(d / 86400)} gün`;
  }

  function saatMetni(ts) {
    if (!ts) return "—";
    return new Date(Number(ts) * 1000).toLocaleTimeString("tr-TR",
      { hour: "2-digit", minute: "2-digit" });
  }

  /** Aralığı okunur yaz: 900 -> "15 dakikada bir". */
  function aralikMetni(sn) {
    const d = sayi(sn, 0);
    if (d < 3600) return `${Math.round(d / 60)} dakikada bir`;
    if (d % 3600 === 0) return `${Math.round(d / 3600)} saatte bir`;
    return `${(d / 3600).toFixed(1)} saatte bir`;
  }

  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    kap.innerHTML = `
      <section class="bolum" id="bolum-zamanli">
        <div class="bolum-ust">
          <button class="bolum-bas" aria-expanded="true" type="button">
            <svg class="ikon ok"><use href="#i-ok"/></svg>
            <span class="bolum-ad">Zamanlanmış görevler</span>
            <span class="bolum-not" id="zm-ozet"></span>
          </button>
        </div>
        <div class="bolum-govde">
          <p class="ikincil">
            Bir iş ve bir aralık seçin, <b>Başlat</b>a basın. İş, bahçenin
            kendi kuyruğuna giriyor — makine meşgulse ya da kopuksa
            <b>o tur atlanıyor</b> ve sebebi burada yazıyor. Biriktirilmiyor:
            bir saatlik kopukluktan sonra makinenin dört kez üst üste bahçeyi
            dolaşması, hiç dolaşmamasından kötü.<br>
            Sunucu yeniden başlarsa (güncelleme, elektrik) görevler
            <b>durmuş</b> olarak geliyor — kimse başında değilken makine
            kendiliğinden kalkmasın diye. Yeniden başlatmak gerekiyor.
          </p>

          <div class="satir-8 alt-hizali">
            <div class="alan esnek-alan">
              <label for="zm-ad">Adı (isteğe bağlı)</label>
              <input type="text" id="zm-ad" maxlength="60" placeholder="Nem turu">
            </div>
            <div class="alan">
              <label for="zm-is">İş</label>
              <select id="zm-is"></select>
            </div>
            <div class="alan">
              <label for="zm-kapsam">Hangi bitkiler</label>
              <select id="zm-kapsam"></select>
            </div>
            <div class="alan">
              <label for="zm-aralik">Aralık</label>
              <input type="number" id="zm-aralik" min="1" step="1" value="15">
            </div>
            <div class="alan">
              <label for="zm-birim">Birim</label>
              <select id="zm-birim">
                <option value="60">dakika</option>
                <option value="3600">saat</option>
              </select>
            </div>
          </div>
          <div class="satir-8 alt-hizali" id="zm-secili-satir" hidden>
            <div class="alan esnek-alan">
              <label for="zm-noktalar">Bitkiler (virgülle)</label>
              <input type="text" id="zm-noktalar" placeholder="m1, m2">
            </div>
            <button class="dugme" id="d-zm-secim" type="button"
                    title="Tarla sekmesinde seçili bitkileri buraya yazar">Seçimi al</button>
          </div>
          <div class="satir-8 alt-hizali">
            <button class="dugme birincil" id="d-zm-kaydet" type="button">Kaydet</button>
            <button class="dugme gizli" id="d-zm-vazgec" type="button">Vazgeç</button>
            <span class="alt-not" id="zm-not"></span>
          </div>
          <div id="zm-hata" class="uyari-kutu gizli"></div>
          <div class="zm-liste" id="zm-liste"></div>
        </div>
      </section>`;

    $("#zm-kapsam").onchange = kapsamBak;
    $("#d-zm-kaydet").onclick = kaydet;
    $("#d-zm-vazgec").onclick = () => { formTemizle(); ciz(); };
    $("#d-zm-secim").onclick = () => {
      const t = window.Tarla;
      const adlar = (t && t.secimDurumu) ? t.secimDurumu() : [];
      if (!adlar.length) { hataYaz("Tarla sekmesinde seçili bitki yok."); return; }
      hataYaz("");
      $("#zm-noktalar").value = adlar.join(", ");
    };
  }

  function kapsamBak() {
    const s = $("#zm-secili-satir");
    if (s) s.hidden = $("#zm-kapsam").value !== "secili";
  }

  function formTemizle() {
    duzenlenen = "";
    $("#zm-ad").value = "";
    $("#zm-noktalar").value = "";
    $("#d-zm-kaydet").textContent = "Kaydet";
    $("#d-zm-vazgec").classList.add("gizli");
    kapsamBak();
  }

  function formDoldur(g) {
    duzenlenen = g.kimlik;
    $("#zm-ad").value = g.ad || "";
    $("#zm-is").value = g.is;
    $("#zm-kapsam").value = g.kapsam;
    $("#zm-noktalar").value = (g.noktalar || []).join(", ");
    const sn = sayi(g.aralik_sn, 900);
    if (sn >= 3600 && sn % 3600 === 0) {
      $("#zm-birim").value = "3600"; $("#zm-aralik").value = Math.round(sn / 3600);
    } else {
      $("#zm-birim").value = "60"; $("#zm-aralik").value = Math.round(sn / 60);
    }
    $("#d-zm-kaydet").textContent = "Güncelle";
    $("#d-zm-vazgec").classList.remove("gizli");
    kapsamBak();
    $("#zm-ad").focus();
  }

  /* ----------------------------------------------------------------- veri */
  async function yukle(elle) {
    const p = P();
    if (!p) return;
    try {
      veri = await p.apiIste("/api/zamanli");
      alindi = performance.now();
      hataYaz("");
      secenekleriYaz();
      ciz();
    } catch (h) {
      if (elle) hataYaz(h.message || "Zamanlanmış görevler alınamadı");
    }
  }

  function secenekleriYaz() {
    if (!veri) return;
    const isSeci = $("#zm-is"), kapSeci = $("#zm-kapsam");
    if (isSeci && !isSeci.options.length) {
      isSeci.innerHTML = Object.entries(veri.isler || {}).map(
        ([k, a]) => `<option value="${kacisli(k)}">${kacisli(a)}</option>`).join("");
    }
    if (kapSeci && !kapSeci.options.length) {
      kapSeci.innerHTML = Object.entries(veri.kapsamlar || {}).map(
        ([k, a]) => `<option value="${kacisli(k)}">${kacisli(a)}</option>`).join("");
      kapsamBak();
    }
  }

  async function kaydet() {
    const p = P();
    if (!p) return;
    const aralik = sayi($("#zm-aralik").value, 0) * sayi($("#zm-birim").value, 60);
    const govde = {
      ad: $("#zm-ad").value.trim(),
      is: $("#zm-is").value,
      kapsam: $("#zm-kapsam").value,
      aralik_sn: aralik,
      noktalar: $("#zm-noktalar").value.split(",")
        .map((s) => s.trim()).filter(Boolean),
    };
    if (duzenlenen) govde.kimlik = duzenlenen;
    try {
      await p.apiIste("/api/zamanli", { method: "POST", body: JSON.stringify(govde) });
      notYaz(duzenlenen ? "Görev güncellendi." : "Görev kaydedildi — Başlat'a basın.");
      formTemizle();
      yukle(true);
    } catch (h) {
      hataYaz(h.message || "Kaydedilemedi");
    }
  }

  async function gonder(yol, govde, mesaj) {
    const p = P();
    if (!p) return;
    try {
      await p.apiIste(yol, { method: "POST", body: JSON.stringify(govde) });
      notYaz(mesaj);
      yukle(true);
    } catch (h) {
      hataYaz(h.message || "İşlem başarısız");
    }
  }

  async function silGorev(g) {
    const p = P();
    if (!p) return;
    try {
      await p.apiIste(`/api/zamanli?kimlik=${encodeURIComponent(g.kimlik)}`,
                      { method: "DELETE" });
      notYaz(`"${g.ad}" silindi.`);
      if (duzenlenen === g.kimlik) formTemizle();
      yukle(true);
    } catch (h) {
      hataYaz(h.message || "Silinemedi");
    }
  }

  /* ---------------------------------------------------------------- çizim */
  function ciz() {
    const liste = $("#zm-liste");
    if (!liste || !veri) return;
    const gorevler = veri.gorevler || [];
    const ozet = $("#zm-ozet");
    if (ozet) {
      const c = gorevler.filter((g) => g.calisiyor).length;
      ozet.textContent = gorevler.length
        ? `${gorevler.length} görev · ${c} çalışıyor` : "yok";
    }
    if (!gorevler.length) {
      liste.innerHTML = '<p class="zm-bos">Henüz zamanlanmış görev yok. '
        + 'Yukarıdan bir iş ve aralık seçip kaydedin.</p>';
      return;
    }
    liste.innerHTML = gorevler.map((g) => `
      <div class="zm-gorev ${g.calisiyor ? "zm-calisiyor" : "zm-duruyor"}"
           data-kimlik="${kacisli(g.kimlik)}">
        <div class="zm-bas">
          <b>${kacisli(g.ad)}</b>
          <span class="zm-tanim">${kacisli(g.is_ad)} · ${kacisli(g.kapsam_ad)}
            · ${kacisli(aralikMetni(g.aralik_sn))}</span>
          <span class="zm-esnek"></span>
          <span class="zm-isik">${g.calisiyor ? "çalışıyor" : "duruyor"}</span>
        </div>
        <div class="zm-satirlar">
          <span><i>Sonraki:</i> <b data-kalan="${kacisli(g.kimlik)}">—</b></span>
          <span><i>En son:</i> <b>${g.son_ts
            ? `${saatMetni(g.son_ts)} · ${kacisli(g.son_sonuc || "")}`
            : "bu açılıştan beri hiç"}</b></span>
          <span><i>Sayaç:</i> <b>${sayi(g.calisma_adet, 0)} çalıştı ·
            ${sayi(g.atlama_adet, 0)} atlandı</b></span>
          ${g.kapsam === "secili"
            ? `<span><i>Bitkiler:</i> <b>${kacisli((g.noktalar || []).join(", "))}</b></span>`
            : ""}
        </div>
        ${g.son_atlama ? `<div class="zm-satirlar zm-atlama">
          <span>Son tur atlandı (${saatMetni(g.son_atlama_ts)}):
            ${kacisli(g.son_atlama)}</span></div>` : ""}
        <div class="zm-islem">
          <button class="dugme ${g.calisiyor ? "" : "birincil"}"
                  type="button" data-eylem="durum">${g.calisiyor ? "Durdur" : "Başlat"}</button>
          <button class="dugme" type="button" data-eylem="simdi"
                  title="Aralığı beklemeden bir kez çalıştırır">Şimdi çalıştır</button>
          <button class="dugme" type="button" data-eylem="duzenle">Düzenle</button>
          <button class="dugme" type="button" data-eylem="sil">Sil</button>
        </div>
      </div>`).join("");

    liste.querySelectorAll(".zm-gorev").forEach((el) => {
      const g = gorevler.find((x) => x.kimlik === el.dataset.kimlik);
      if (!g) return;
      el.querySelectorAll("[data-eylem]").forEach((d) => {
        d.onclick = () => {
          if (d.dataset.eylem === "durum") {
            gonder("/api/zamanli/durum", { kimlik: g.kimlik, calisiyor: !g.calisiyor },
                   g.calisiyor ? `"${g.ad}" durduruldu.`
                               : `"${g.ad}" başladı — ilk tur ${aralikMetni(g.aralik_sn)
                                  .replace(" bir", "")} sonra.`);
          } else if (d.dataset.eylem === "simdi") {
            gonder("/api/zamanli/simdi", { kimlik: g.kimlik },
                   `"${g.ad}" bir kez çalıştırılacak.`);
          } else if (d.dataset.eylem === "duzenle") {
            formDoldur(g);
          } else if (d.dataset.eylem === "sil") {
            silGorev(g);
          }
        };
      });
    });
    kalanYaz();
  }

  /** Geri sayım: sunucunun verdiği "kalan"dan, ALINDIĞI andan beri geçen
   *  süre düşülerek. Tarayıcının saati sunucununkinden farklı olabilir. */
  function kalanYaz() {
    if (!veri) return;
    const gecen = (performance.now() - alindi) / 1000;
    for (const g of (veri.gorevler || [])) {
      const el = document.querySelector(`[data-kalan="${CSS.escape(g.kimlik)}"]`);
      if (!el) continue;
      if (!g.calisiyor || g.kalan_sn == null) { el.textContent = "durduruldu"; continue; }
      const kalan = Math.max(0, sayi(g.kalan_sn, 0) - gecen);
      el.textContent = kalan < 1 ? "şimdi" : `${sureMetni(kalan)} sonra`;
    }
  }

  function notYaz(metin) {
    const n = $("#zm-not");
    if (!n) return;
    n.textContent = metin || "";
    clearTimeout(notYaz._z);
    notYaz._z = setTimeout(() => { n.textContent = ""; }, 6000);
  }

  function hataYaz(metin) {
    const k = $("#zm-hata");
    if (!k) return;
    k.textContent = metin || "";
    k.classList.toggle("gizli", !metin);
  }

  function acikMi() {
    const s = document.getElementById(SAYFA);
    return !!(s && s.classList.contains("etkin"));
  }
  function baslat() {
    durdur();
    zamanlayici = setInterval(() => { if (acikMi()) yukle(); }, TAZELE_MS);
    geriSayim = setInterval(kalanYaz, 1000);
  }
  function durdur() {
    if (zamanlayici) clearInterval(zamanlayici);
    if (geriSayim) clearInterval(geriSayim);
    zamanlayici = geriSayim = null;
  }
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
