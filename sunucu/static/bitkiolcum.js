/* Bitki ölçümü — panel tarafı (`gorus` ölçüm katmanının yüzü).
 *
 * AYRI DOSYA, `filiz.js` ile aynı gerekçe: `app.js` ve `index.html` başka
 * bir oturumda sürekli değişiyor; oraya blok eklemek her yamada çakışma
 * demek. Buraya yalnız boş bir kap giriyor.
 *
 * FİLİZ BULMADAN FARKI. "Filizlerin konumu" bir karede yeşil nesneleri
 * listeler, hepsi bu. Burası o listeyi EKİM KAYDIYLA karşılaştırır:
 * hangisi ektiğimiz bitki, hangisi yabani, hangi tohum hiç çıkmadı,
 * geçen taramadan bu yana ne kadar büyüdü. Tespit ikisinde de aynı
 * `filiz.py` gövdesinden geliyor — ikinci bir tespit hattı, aynı yatak
 * için birbirini tutmayan iki cevap olurdu.
 *
 * "BELİRSİZ" ÜZERİNDE OTOMATİK İŞ YAPILMIYOR, SORULUYOR. Kararsız kalan
 * tespitin yanındaki iki düğme insanın cevabını arşive yazıyor.
 */
(function () {
  "use strict";

  const KAP = "bitkiolcum-bolum";
  let son = null;

  const $ = (s) => document.querySelector(s);
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));

  function P() { return window.Panel || null; }
  function jeton() { const p = P(); return (p && p.S && p.S.jeton) ? String(p.S.jeton) : ""; }

  function gunluk(metin, seviye) {
    const p = P();
    if (p && p.gunluk) p.gunluk(metin, seviye);
  }

  /** Kamera ve eşik değerleri "Filizlerin konumu" bölümüyle ORTAK: iki
   *  ayrı seçim, bir gün ayrışacak iki ölçüm demekti. */
  function govdeKur() {
    const g = {};
    const sec = $("#etiket-kamera");
    g.kamera = (sec && sec.value) || "ust";
    const say = (id, ad) => {
      const e = $(id);
      if (!e) return;
      const d = Number(e.value);
      if (e.value !== "" && Number.isFinite(d) && d > 0) g[ad] = d;
    };
    say("#filiz-esik", "esik");
    say("#filiz-cap", "en_kucuk_cap_mm");
    say("#filiz-birlestir", "birlestir_mm");
    say("#filiz-azami", "azami_fide_mm");
    const gor = $("#bitkiolcum-gorsel");
    const ars = $("#bitkiolcum-arsiv");
    g.gorsel = !gor || gor.checked;
    g.arsivle = !ars || ars.checked;
    return g;
  }

  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    kap.innerHTML = `
      <details class="etiket-blok">
        <summary>Bitki ölçümü — filiz mi yabani mi, çıktı mı çıkmadı mı</summary>
        <p class="alt-not">
          Aynı kareyi "Filizlerin konumu" ile aynı yerden alır, üstüne
          <b>ekim kaydını</b> koyar: her yeşil nesne hangi bitkiye ait,
          hangisi yabani, hangi tohum hâlâ çıkmadı. Sonuç arşive yazılır;
          ikinci taramadan sonra <b>mm²/gün büyüme</b> de çıkar.
          Makine hareket etmiyor.
        </p>
        <div class="satir">
          <button id="d-bitkiolcum-tara" class="dugme birincil">Ölçümü çalıştır</button>
          <label class="onay"><input type="checkbox" id="bitkiolcum-gorsel" checked> Görsel üret</label>
          <label class="onay"><input type="checkbox" id="bitkiolcum-arsiv" checked> Arşive yaz</label>
        </div>
        <div id="bitkiolcum-hata" class="uyari gizli"></div>
        <div id="bitkiolcum-ozet" class="gizli"></div>
        <div id="bitkiolcum-tablo" class="gizli"></div>
        <div id="bitkiolcum-gorsel-kap" class="gizli"></div>
      </details>`;
    $("#d-bitkiolcum-tara").addEventListener("click", tara);
  }

  function hataYaz(metin) {
    const k = $("#bitkiolcum-hata");
    if (!k) return;
    k.textContent = metin || "";
    k.classList.toggle("gizli", !metin);
  }

  async function tara() {
    const p = P();
    if (!p) return;
    const d = $("#d-bitkiolcum-tara");
    d.disabled = true;
    d.textContent = "Ölçülüyor…";
    hataYaz("");
    try {
      const c = await p.apiIste("/api/bitkiolcum/tara", {
        method: "POST", body: JSON.stringify(govdeKur()),
      });
      son = c.olcum || null;
      yaz(c.filiz || {});
      const s = (son && son.sayim) || {};
      gunluk(`✓ Ölçüm: ${s.filiz || 0} filiz, ${s.yabani || 0} yabani, `
        + `${s.belirsiz || 0} belirsiz`, "ok");
    } catch (h) {
      son = null;
      ["#bitkiolcum-ozet", "#bitkiolcum-tablo", "#bitkiolcum-gorsel-kap"]
        .forEach((i) => { const e = $(i); if (e) e.classList.add("gizli"); });
      hataYaz(h.message || String(h));
    } finally {
      d.disabled = false;
      d.textContent = "Ölçümü çalıştır";
    }
  }

  function satir(ad, deger) {
    return `<div class="etiket-satir"><span>${kacisli(ad)}</span>`
      + `<span>${kacisli(deger)}</span></div>`;
  }

  function yaz(f) {
    if (!son) return;
    const s = son.sayim || {};
    const c = son.cimlenme || {};
    const o = son.ortu || {};
    const t = (son.tani || {}).eslestirme || {};

    let h = satir("Sınıflar",
      `${s.filiz || 0} filiz · ${s.yabani || 0} yabani · ${s.belirsiz || 0} belirsiz`);
    h += satir("Çimlenme",
      `${c.ekilen || 0} ekilen · ${c.cikan || 0} çıkan · ${c.cikmayan || 0} çıkmayan`
      + (c.cikma_orani != null ? ` (%${Math.round(c.cikma_orani * 100)})` : ""));
    h += satir("Örtü", o.kapsama_yuzde != null
      ? `%${o.kapsama_yuzde} — ${o.kapsama_kaynagi || ""} `
        + `(yatak ${(son.yatak_mm || []).join(" × ")} mm)`
      : (o.not || "alan bilgisi gelmedi"));
    h += satir("Eşleştirme", `${t.yontem || "—"} · ${t.eslesen || 0} eşleşti`
      + (t.ortalama_mesafe_mm != null ? ` · ortalama ${t.ortalama_mesafe_mm} mm` : ""));
    if ((son.bos_kayit_adlari || []).length) {
      h += satir("Çıkmayanlar", son.bos_kayit_adlari.join(", "));
    }
    if (f && f.yontem) {
      h += satir("Koordinat modeli", f.yontem
        + (f.genislik_px ? ` · kare ${f.genislik_px}×${f.yukseklik_px}` : ""));
    }
    if (son.gorsel_notu) h += satir("Görsel", son.gorsel_notu);
    if (son.tarama_id != null) h += satir("Arşiv", `tarama #${son.tarama_id}`);

    const k = $("#bitkiolcum-ozet");
    k.innerHTML = h;
    k.classList.remove("gizli");

    tabloYaz();
    gorselYaz();
  }

  function tabloYaz() {
    const k = $("#bitkiolcum-tablo");
    const liste = son.tespitler || [];
    if (!liste.length) {
      k.innerHTML = '<p class="bos-durum">Karede yeşil nesne bulunamadı.</p>';
      k.classList.remove("gizli");
      return;
    }
    const iz = {};
    (son.izler || []).forEach((i) => { iz[i.id] = i; });

    let h = `<table class="veri"><thead><tr>
      <th>#</th><th>Sınıf</th><th>Skor</th><th>Bitki</th><th>Sapma</th>
      <th>X</th><th>Y</th><th>Alan</th><th>Büyüme</th><th></th>
    </tr></thead><tbody>`;
    liste.forEach((d) => {
      const b = iz[d.iz_id] || {};
      const buyume = (b.buyume_mm2_gun != null) ? `${b.buyume_mm2_gun} mm²/gün` : "—";
      const dugme = d.sinif === "belirsiz"
        ? `<button class="kucuk" data-etiket="filiz" data-no="${d.id}">filiz</button>
           <button class="kucuk" data-etiket="yabani" data-no="${d.id}">yabani</button>`
        : "";
      h += `<tr class="bitkiolcum-${kacisli(d.sinif)}">
        <td>${d.id}</td>
        <td>${kacisli(d.sinif)}</td>
        <td>${d.skor == null ? "—" : Number(d.skor).toFixed(2)}</td>
        <td>${kacisli(d.kayit_ad || "—")}</td>
        <td>${d.eslesme_mesafe_mm == null ? "—" : d.eslesme_mesafe_mm + " mm"}</td>
        <td>${d.x_mm}</td><td>${d.y_mm}</td>
        <td>${d.alan_mm2 == null ? "—" : d.alan_mm2 + " mm²"}</td>
        <td>${kacisli(buyume)}</td>
        <td>${dugme}</td></tr>`;
    });
    h += "</tbody></table>";
    k.innerHTML = h;
    k.classList.remove("gizli");
    k.querySelectorAll("button[data-etiket]").forEach((d) => {
      d.addEventListener("click", () => etiketle(Number(d.dataset.no), d.dataset.etiket));
    });
  }

  async function etiketle(no, etiket) {
    const p = P();
    if (!p || son == null || son.tarama_id == null) {
      hataYaz("Arşive yazılmamış bir tarama etiketlenemez (Arşive yaz kapalıydı).");
      return;
    }
    try {
      await p.apiIste("/api/bitkiolcum/etiketle", {
        method: "POST",
        body: JSON.stringify({ tarama_id: son.tarama_id, tespit_no: no, etiket }),
      });
      gunluk(`✓ #${no} → ${etiket} olarak işaretlendi`, "ok");
    } catch (h) {
      hataYaz(h.message || String(h));
    }
  }

  function gorselYaz() {
    const k = $("#bitkiolcum-gorsel-kap");
    if (!son.gorsel_yolu) { k.classList.add("gizli"); k.innerHTML = ""; return; }
    const u = (ad) => `/api/bitkiolcum/gorsel?ad=${encodeURIComponent(ad)}`
      + `&jeton=${encodeURIComponent(jeton())}&t=${Date.now()}`;
    let h = `<img src="${u(son.gorsel_yolu)}" alt="ölçüm görseli" class="bitkiolcum-gorsel">`;
    if (son.ustten_yolu) {
      h += `<img src="${u(son.ustten_yolu)}" alt="üstten görünüm" class="bitkiolcum-gorsel">`;
    }
    k.innerHTML = h;
    k.classList.remove("gizli");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(kur, 0));
  } else {
    setTimeout(kur, 0);
  }
})();
