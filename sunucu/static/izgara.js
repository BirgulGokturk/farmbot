/* Izgara kalibrasyonu — makinenin kendi turuyla piksel↔mm, panel tarafı.
 *
 * AYRI DOSYA, `filiz.js` ile aynı gerekçe: `app.js` ve `index.html` başka
 * bir oturumda sürekli değişiyor.
 *
 * NEDEN AYRI BİR BÖLÜM. Yataktaki dört AprilTag'le kurulan harita
 * etiketlerin üstünde 0,00 mm sapma gösteriyor; bu doğruluk değil,
 * matematiksel zorunluluk — dört nokta homografinin sekiz serbestliğini
 * tam belirliyor, lens distorsiyonu o sıfırın içine emiliyor ve
 * görünmüyor. Burada işaret KAFADA; makine onu bilinen noktalara
 * götürüyor ve enkoder zaten gerçek değeri veriyor.
 *
 * TUR NOKTA NOKTA SÜRÜLÜYOR. Bütün turu tek isteğe koymak, 48 durak
 * boyunca cevapsız bir bağlantı ve ilerlemesi görünmeyen bir makine
 * demekti. Bir durak kaçarsa tur duruyor değil, devam ediyor.
 *
 * MAKİNE HAREKET EDİYOR. Her durak `onay` ile gidiyor ve tur
 * başlamadan önce kullanıcıya plan gösteriliyor.
 */
(function () {
  "use strict";

  const KAP = "izgara-bolum";
  let plan = [];
  let durum = null;
  let calisiyor = false;
  let durdurUlsun = false;

  const $ = (s) => document.querySelector(s);
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));
  const sayi = (d, n) => (Number.isFinite(Number(d)) ? Number(d).toFixed(n) : "—");

  function P() { return window.Panel || null; }
  function gunluk(m, s) { const p = P(); if (p && p.gunluk) p.gunluk(m, s); }

  function kamera() {
    const sec = $("#etiket-kamera");
    return (sec && sec.value) || "ust";
  }

  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    kap.innerHTML = `
      <details class="etiket-blok">
        <summary>Izgara kalibrasyonu — makine kendi turunu atar</summary>
        <p class="alt-not">
          Kafaya yukarı bakan bir AprilTag yapıştırın, makine bilinen
          noktalara gitsin. <b>Enkoder zaten gerçek değeri veriyor</b> —
          prob ile etiket merkezi ölçmek yok. Dört etiketli haritanın
          ±0,0 mm'si doğruluk değil, matematiksel zorunluluk: dört nokta
          homografiyi tam belirler, lens distorsiyonu o sıfırın içinde
          gizlenir.
        </p>
        <div class="satir">
          <label>Dikim alanı
            <select id="iz-alan"><option value="">(yatağın tamamı)</option></select>
          </label>
          <span class="alt-not" id="iz-alan-not"></span>
        </div>
        <div class="satir">
          <label>Yatak en (mm) <input type="number" id="iz-en" value="495" step="1"></label>
          <label>Yatak boy (mm) <input type="number" id="iz-boy" value="610" step="1"></label>
          <label>Kenar payı (mm) <input type="number" id="iz-pay" value="40" step="1"></label>
        </div>
        <p class="alt-not">
          <b>Dikim alanı seçilirse</b> ızgara yalnız onun içinde geziyor ve
          yatak kutuları kullanılmıyor. Kalibrasyonu gerçekten
          kullanacağınız bölgeye yoğunlaştırmak doğru olanı: kalibre
          edilen bölgenin dışı uzatmadır, hatası ölçülmemiştir.
          Yatak ölçüsü <b>yukarıdaki</b> iki kutu; aşağıdakiler kaç durak
          olacağı (4 sütun × 6 satır = 24 durak, iki yükseklikte 48).
          Duraklar makineye <b>tek tek soruluyor</b>: yumuşak sınır ya da
          yasak bölge dışında kalanlar plandan çıkarılıyor, böylece tur
          çarpma riski taşımıyor.
        </p>
        <div class="satir">
          <label>Sütun SAYISI <input type="number" id="iz-nx" value="4" min="2" max="12"></label>
          <label>Satır SAYISI <input type="number" id="iz-ny" value="6" min="2" max="12"></label>
          <label>İşaret kimliği <input type="number" id="iz-kimlik" value="23" min="0" max="586"></label>
        </div>
        <div class="satir">
          <label>Z alçak <input type="number" id="iz-z1" step="1"></label>
          <label>Z yüksek <input type="number" id="iz-z2" step="1"></label>
          <label>Bekleme (sn) <input type="number" id="iz-bekleme" value="1.2" step="0.1"></label>
        </div>
        <div class="satir">
          <label>İşaret hangi başlıkta
            <select id="iz-bas">
              <option value="">Seçme (kayma 0 sayılır)</option>
              <option value="sulama">💧 Sulama başlığı</option>
              <option value="nem">🌡️ Nem probu</option>
              <option value="tohum">🌱 Tohum ucu</option>
            </select>
          </label>
          <label>İşaret nerede
            <select id="iz-yer">
              <option value="kafa">Kafada (T oynamıyor)</option>
              <option value="t_ucu">T ucunda (T ile iniyor)</option>
            </select>
          </label>
          <label>T alçak <input type="number" id="iz-t1" step="0.1"></label>
          <label>T yüksek <input type="number" id="iz-t2" step="0.1"></label>
        </div>
        <div class="satir">
          <label>Toprak T'si (mm) <input type="number" id="iz-ttoprak" step="0.1"></label>
          <label>T yönü
            <select id="iz-tyon">
              <option value="1">T büyürken uç iniyor</option>
              <option value="-1">T büyürken uç çıkıyor</option>
            </select>
          </label>
        </div>
        <p class="alt-not">
          <b>Başlık seçimi iki iş yapıyor:</b> turun başında servo o
          başlığa alınıyor, ve o başlığın <b>kayması</b> modele işleniyor.
          Üç başlık aynı X/Y'de durmuyor — makineye X/Y dendiğinde başlık
          kayması kadar ötede oluyor; bu modele girmezse bütün harita o
          kadar ötelenir. Kayma uç ayarlarından okunuyor, elle girilmiyor.
        </p>
        <p class="alt-not">
          <b>Toprağa T ile ulaşmak</b> ölçümü kolaylaştırıyor: prob kendi
          ekseniyle iniyor, kafayı toprağa yaklaştırmak gerekmiyor. Ama
          işaret <b>kafadaysa</b> T'nin konumu işareti oynatmıyor —
          <i>İşaret ofseti</i> zaten prob toprağa değerken ölçüldüğü için
          o uzamayı içinde taşıyor; ikinci kez saymak aynı mesafeyi iki kez
          saymak olurdu. İşaret <b>T ucundaysa</b> katkı gerçek ve T,
          Z'den daha ince bir yükseklik ekseni oluyor.
        </p>
        <p class="alt-not">
          T alanları boş bırakılırsa T hiç sürülmüyor, yukarıda kalıyor.
          Dolu ise her durakta sıra şu: <b>T yukarı → yatay hareket →
          T aşağı</b>. Tohum ucu aşağıdayken X/Y sürmek ucu toprağa
          sürtmek demek ve ajan bunu zaten reddediyor.
        </p>
        <p class="alt-not">
          <b>İki yükseklik şart.</b> Tek yükseklikte model yalnız o düzlem
          için geçerli olur ve topraktan yüksekteki yaprak <b>boyu kadar</b>
          kayar. Aradaki fark ~30 mm olsun.
        </p>
        <div class="satir">
          <label>Toprak Z'si (mm) <input type="number" id="iz-ztoprak" step="0.1"></label>
          <label>İşaret ofseti (mm) <input type="number" id="iz-ofset" step="0.1"></label>
        </div>
        <p class="alt-not">
          <b>Toprak Z'si</b>: probun toprağa DEĞDİĞİ makine Z'si.
          <b>İşaret ofseti</b>: prob toprağa değerken işaretin toprak
          yüzeyinden yüksekliği — kumpasla ölçün. 1 mm hata ≈ 0,4 mm
          konum hatası; 10 mm hata ≈ 3,8 mm.
        </p>
        <div class="satir">
          <button id="d-iz-plan">Planı üret</button>
          <button id="d-iz-basla" class="dugme birincil" disabled>Turu başlat</button>
          <button id="d-iz-dur" disabled>Durdur</button>
          <button id="d-iz-kur" disabled>Modeli kur</button>
          <button id="d-iz-temizle">Noktaları sil</button>
        </div>
        <div id="iz-ilerleme" class="alt-not"></div>
        <div id="iz-hata" class="uyari gizli"></div>
        <div id="iz-sonuc" class="gizli"></div>
      </details>`;
    $("#d-iz-plan").onclick = planUret;
    $("#d-iz-basla").onclick = turBaslat;
    $("#d-iz-dur").onclick = () => { durdurUlsun = true; };
    $("#d-iz-kur").onclick = modelKur;
    $("#d-iz-temizle").onclick = temizle;
    alanlariYukle();
    durumYukle();
  }

  function hataYaz(m) {
    const k = $("#iz-hata");
    if (!k) return;
    k.textContent = m || "";
    k.classList.toggle("gizli", !m);
  }

  function ilerlemeYaz(m) {
    const k = $("#iz-ilerleme");
    if (k) k.innerHTML = m || "";
  }

  function dugmeler() {
    $("#d-iz-plan").disabled = calisiyor;
    $("#d-iz-basla").disabled = calisiyor || !plan.length;
    $("#d-iz-dur").disabled = !calisiyor;
    $("#d-iz-kur").disabled = calisiyor || !(durum && durum.yeter_mi);
    $("#d-iz-temizle").disabled = calisiyor;
  }

  function durumOzet() {
    if (!durum) return "";
    const y = Object.entries(durum.yukseklikler || {})
      .map(([h, n]) => `${h} mm: ${n}`).join(" · ");
    return `Toplanan nokta: <b>${durum.nokta}</b>`
      + (durum.kacirilan ? ` · kaçan ${durum.kacirilan}` : "")
      + (y ? ` · ${y}` : "")
      + (durum.nokta && !durum.uzay_olabilir
        ? ' <span class="uyari">(tek yükseklik — paralaks çözülmez)</span>' : "");
  }

  async function alanlariYukle() {
    const p = P();
    if (!p) return;
    try {
      const c = await p.apiIste("/api/izgara/alanlar");
      const sec = $("#iz-alan");
      (c.alanlar || []).forEach((a) => {
        const o = document.createElement("option");
        o.value = a.ad;
        o.textContent = `${a.ad} (${a.x1}–${a.x2} × ${a.y1}–${a.y2} mm)`;
        sec.appendChild(o);
      });
      sec.onchange = () => {
        const a = (c.alanlar || []).find((v) => v.ad === sec.value);
        $("#iz-alan-not").textContent = a
          ? `${(a.x2 - a.x1).toFixed(0)} × ${(a.y2 - a.y1).toFixed(0)} mm`
          : "";
      };
    } catch (h) { /* alan yoksa yatak kutuları kullanılır */ }
  }

  async function durumYukle() {
    const p = P();
    if (!p) return;
    try {
      durum = await p.apiIste("/api/izgara/durum");
      ilerlemeYaz(durumOzet());
      dugmeler();
    } catch (h) { hataYaz(h.message || String(h)); }
  }

  function govde() {
    const s = (id) => Number($(id).value);
    return {
      kamera: kamera(),
      alan: $("#iz-alan").value,
      yatak: [s("#iz-en"), s("#iz-boy")],
      nx: s("#iz-nx"), ny: s("#iz-ny"), pay_mm: s("#iz-pay"),
      kimlik: s("#iz-kimlik"),
      z: [s("#iz-z1"), s("#iz-z2")].filter((v) => Number.isFinite(v)),
      t: [s("#iz-t1"), s("#iz-t2")].filter((v) => Number.isFinite(v)),
      t_toprak_mm: ($("#iz-ttoprak").value === "" ? null : s("#iz-ttoprak")),
      t_yon: Number($("#iz-tyon").value),
      isaret_yeri: $("#iz-yer").value,
      bas: $("#iz-bas").value,
      z_toprak_mm: s("#iz-ztoprak"),
      isaret_ofset_mm: s("#iz-ofset"),
      bekleme_sn: s("#iz-bekleme"),
    };
  }

  async function planUret() {
    const p = P();
    if (!p) return;
    hataYaz("");
    try {
      const c = await p.apiIste("/api/izgara/plan", {
        method: "POST", body: JSON.stringify(govde()),
      });
      plan = c.plan || [];
      durum = c.durum || durum;
      let h = `<b>${c.durak}</b> durak · yükseklikler ${(c.yukseklikler_mm || []).join(", ")} mm`;
      if (c.engelli) h += ` · <span class="uyari">${c.engelli} durak elendi</span>`;
      if (c.kutu) h += `<br>alan X${c.kutu[0]}–${c.kutu[2]} · Y${c.kutu[1]}–${c.kutu[3]} mm`;
      if (c.bas) {
        h += `<br>başlık <b>${kacisli(c.bas)}</b> · kayma `
          + `${(c.bas_kayma || []).join(" / ")} mm (modele işlendi)`;
      }
      (c.uyarilar || []).forEach((u) => {
        h += `<br><span class="uyari">${kacisli(u)}</span>`;
      });
      h += `<br>${durumOzet()}`;
      ilerlemeYaz(h);
      dugmeler();
    } catch (h) { hataYaz(h.message || String(h)); }
  }

  async function turBaslat() {
    const p = P();
    if (!p || !plan.length) return;
    if (!window.confirm(
      `Makine ${plan.length} durağa gidecek. Yolun boş olduğundan emin misiniz?`)) return;
    calisiyor = true;
    durdurUlsun = false;
    hataYaz("");
    dugmeler();
    let bulunan = 0;
    let kacan = 0;
    try {
      for (let i = 0; i < plan.length; i++) {
        if (durdurUlsun) { gunluk("Izgara turu durduruldu", "uyari"); break; }
        const [x, y, z, tv] = plan[i];
        ilerlemeYaz(`Durak <b>${i + 1}/${plan.length}</b> — X${x} Y${y} Z${z}`
          + (tv == null ? "" : ` T${tv}`)
          + `<br>bulunan ${bulunan} · kaçan ${kacan}`);
        try {
          const c = await p.apiIste("/api/izgara/nokta", {
            method: "POST",
            body: JSON.stringify({ x, y, z, t: tv, onay: true, ilk: i === 0 }),
          });
          durum = c.durum || durum;
          if (c.bulundu) bulunan++; else kacan++;
        } catch (h) {
          // TEK DURAK TURU DÜŞÜRMÜYOR. İşaret bir durakta görünmediyse
          // kalanı toplamak hâlâ değerli; ama hareket hatası başka bir
          // şey, onda duruyoruz.
          kacan++;
          if (String(h.message || "").match(/ulaşamadı|sınır|ACİL|Ajan/i)) {
            hataYaz(h.message || String(h));
            break;
          }
        }
      }
    } finally {
      calisiyor = false;
      await durumYukle();
      gunluk(`✓ Izgara turu bitti: ${bulunan} nokta, ${kacan} kaçan`, "ok");
    }
  }

  async function modelKur() {
    const p = P();
    if (!p) return;
    hataYaz("");
    const d = $("#d-iz-kur");
    d.disabled = true;
    d.textContent = "Kuruluyor…";
    try {
      const c = await p.apiIste("/api/izgara/kur", {
        method: "POST",
        body: JSON.stringify({ kaydet: true, kopru: true, h_mm: 0 }),
      });
      sonucYaz(c);
      gunluk(`✓ Izgara modeli kuruldu (${c.tur})`, "ok");
    } catch (h) {
      hataYaz(h.message || String(h));
    } finally {
      d.disabled = false;
      d.textContent = "Modeli kur";
      dugmeler();
    }
  }

  function satir(ad, deger, uyari) {
    return `<div class="etiket-satir${uyari ? " uyari" : ""}">`
      + `<span>${kacisli(ad)}</span><span class="mono">${kacisli(deger)}</span></div>`;
  }

  function sonucYaz(c) {
    const k = $("#iz-sonuc");
    const r = c.rapor || {};
    const cd = r.capraz_dogrulama || {};
    let h = satir("Model", c.tur === "uzay"
      ? "uzay (paralaks çözülüyor)" : "duzlem (tek yükseklik)",
      c.tur !== "uzay");
    /* BAKILACAK SAYI BU. `kendi_artigi` modelin uydurulduğu noktalarda
     * ölçülüyor ve doğruluk değil; çapraz doğrulama her noktayı bir kez
     * dışarıda bırakıyor ve ek nokta gerektirmiyor. */
    h += satir("Çapraz doğrulama (GERÇEK)", `${sayi(cd.rms_mm, 3)} mm rms`,
      Number(cd.rms_mm) > 1.5);
    h += satir("Kendi artığı (doğruluk DEĞİL)", `${sayi(r.kendi_artigi_rms_mm, 3)} mm`);
    if (r.olcek_degisimi_yuzde != null) {
      h += satir("Ölçek değişimi (kamera eğikliği)",
        `%${sayi(r.olcek_degisimi_yuzde, 1)}`);
    }
    const kk = (c.kopru || {}).kopru_kaybi;
    if (kk) {
      /* KÖPRÜ KAYIPSIZ DEĞİL: homografi distorsiyonu temsil edemez ve
       * paralaks düzeltmesi köprüden geçmez. Kalibrasyona yazmadan önce
       * bu sayıyı görmek gerekiyor. */
      h += satir("Köprü kaybı (mevcut kalibrasyona yazılırsa)",
        `${sayi(kk.rms_mm, 2)} mm rms · maks ${sayi(kk.maks_mm, 2)} mm`);
    }
    (r.uyarilar || []).forEach((u) => {
      h += `<div class="etiket-satir uyari"><span>—</span><span>${kacisli(u)}</span></div>`;
    });
    if (c.yazildi && c.yazildi.model) h += satir("Yazıldı", c.yazildi.model);
    k.innerHTML = h;
    k.classList.remove("gizli");
  }

  async function temizle() {
    const p = P();
    if (!p) return;
    if (!window.confirm("Toplanan bütün noktalar silinsin mi?")) return;
    try {
      durum = await p.apiIste("/api/izgara/temizle", { method: "POST" });
      plan = [];
      ilerlemeYaz(durumOzet());
      $("#iz-sonuc").classList.add("gizli");
      dugmeler();
    } catch (h) { hataYaz(h.message || String(h)); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(kur, 0));
  } else {
    setTimeout(kur, 0);
  }
})();
