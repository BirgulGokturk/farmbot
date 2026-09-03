/* Bitki başına toprak nemi — panelde tek bakışta.
 *
 * NEDEN VAR. Nem ölçümü çalışıyordu ama sonucu görülecek bir yer yoktu:
 * sayı yalnız SUSAYAN bitkinin görev kartında görünüyordu. Nemi normal
 * olan bitkiye bakınca kaç olduğu bilinmiyordu ve Tarla ekranında nemle
 * ilgili hiçbir şey yoktu.
 *
 * EN ÖNEMLİSİ BİR AYRIM. "Ölçüldü ve nemi iyi" ile "hiç ölçülmedi" aynı
 * görünüyordu; oysa ilki bilgi, ikincisi bilgi EKSİKLİĞİ. Hangi bitkiyi
 * ölçmesi gerektiğini kullanıcı ancak bunu görerek bilebiliyor. Tabloda
 * ayrı bir durum olarak duruyorlar ve liste önce ölçülmeyenleri
 * gösteriyor.
 *
 * AYRI DOSYA, `etiket.js` ile aynı gerekçe: `app.js`, `bahce.js` ve
 * `index.html` başka bir oturumda sürekli değişiyor. Bu bölüm kendi
 * arayüzünü kendi kuruyor, `index.html`e yalnız boş bir kap giriyor.
 *
 * SUNUCUYA HİÇ DOKUNMUYOR. Bütün veri `/api/bahce`de zaten var: ölçülen
 * yüzde, eşik, ölçümün bitkiye uzaklığı, yaşı ve kararın gerekçesi. İkinci
 * bir hesap kurmak, aynı soruya iki farklı cevap veren iki yer demekti.
 */
(function () {
  "use strict";

  const KAP = "nem-bolum";
  let veri = null;
  let zamanlayici = null;

  const $ = (s) => document.querySelector(s);
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));
  const P = () => window.Panel || null;

  /** "17 dk", "3 sa", "2 gün" — saniyeyi okunur yapıyor. */
  function yasMetni(sn) {
    if (sn == null) return "—";
    const d = Number(sn);
    if (d < 90) return `${Math.round(d)} sn`;
    if (d < 5400) return `${Math.round(d / 60)} dk`;
    if (d < 172800) return `${Math.round(d / 3600)} sa`;
    return `${Math.round(d / 86400)} gün`;
  }

  /* Bir bitkinin nem durumu — dört hâlden biri.
   *
   * "yok" ile "iyi"yi ayırmak bu bölümün varlık sebebi: ölçülmemiş bir
   * bitkiyi "sorunsuz" saymak, bilmediğini bilmemek demek. */
  function hal(b) {
    const o = b.su_olcum || {};
    if (!o.var) return { ad: "yok", etiket: "ölçülmedi", sinif: "nem-yok" };
    if (o.bayat) return { ad: "bayat", etiket: "eski ölçüm", sinif: "nem-bayat" };
    /* ÖDÜNÇ OKUMA AYRI BİR HÂL.
     *
     * Sunucu, bitkinin kendi ölçümü yoksa 100 mm içindeki bir komşu
     * okumayı kullanıyor. Prob kafada olduğu için makine bir yerde
     * dururken oraya okuma birikiyor ve yakınındaki bitkiler o sayıyı
     * miras alıyor. Sayıyı nem sütununda göstermek, hiç ölçülmemiş bir
     * bitkiyi ölçülmüş gibi sunuyordu.
     *
     * Sayıyı saklamıyoruz — bilgi bilgidir — ama ONA GÖRE KARAR
     * VERMİYORUZ: bu bitkiler iyi ya da susadı sayılmıyor. */
    if (!o.kendi) return { ad: "odunc", etiket: "komşudan", sinif: "nem-odunc" };
    if (b.susadi) return { ad: "susadi", etiket: "susadı", sinif: "nem-susadi" };
    return { ad: "iyi", etiket: "iyi", sinif: "nem-iyi" };
  }

  const SIRA = { yok: 0, odunc: 1, susadi: 2, bayat: 3, iyi: 4 };

  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    kap.innerHTML = `
      <details class="etiket-blok" id="nem-detay">
        <summary>Bitkilerin toprak nemi <span id="nem-ozet" class="nem-ozet"></span></summary>
        <p class="ikincil">
          Nem ölçümü bitkinin üstüne gidip probu toprağa daldırıyor.
          <b>“Ölçülmedi” ile “iyi” ayrı şeyler:</b> ilki bilgi eksikliği,
          ikincisi bilgi. Liste önce ölçülmeyenleri gösteriyor.
        </p>
        <div class="satir-8 alt-hizali">
          <button class="dugme" id="d-nem-tazele">Yenile</button>
          <button class="dugme birincil" id="d-nem-olc">Ölçülmeyenleri ölç</button>
          <span class="alt-not" id="nem-not"></span>
        </div>
        <div id="nem-hata" class="uyari-kutu gizli"></div>
        <div class="veri-kutu"><table class="veri nem-tablo">
          <thead><tr>
            <th>Bitki</th><th>Durum</th><th>Nem</th><th>Eşik</th>
            <th>Ölçüm</th><th></th>
          </tr></thead>
          <tbody id="nem-govde"></tbody>
        </table></div>
      </details>`;
    $("#d-nem-tazele").onclick = () => yukle(true);
    cubugaEkle();
    $("#d-nem-olc").onclick = olculmeyenleriOlc;
    // Bölüm AÇILDIĞINDA tazeleniyor: kapalı bir tabloyu saniyede bir
    // yenilemek boşuna istek demek.
    $("#nem-detay").addEventListener("toggle", () => {
      if ($("#nem-detay").open) { yukle(); baslat(); } else durdur();
    });
    yukle();
  }

  /** Tarla'nin secim cubuguna "Nem olc" dugmesi ekliyor.
   *
   *  Cubuk index.html'de, isleyicileri tarla.js'te — ikisi de baska bir
   *  oturumun dosyasi. Dugmeyi CALISMA ANINDA ekliyoruz: secimi
   *  `Tarla.secimDurumu()` veriyor (zaten disa acik), is de bahcenin
   *  kendi kuyrugundan geciyor. Boylece Sula ve Ek ile ayni yerde
   *  duruyor ama kimsenin dosyasina girmiyoruz.
   */
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
      if (!adlar.length) {
        const p = P();
        if (p && p.gunluk) p.gunluk("✕ Önce bitki seçin", "hata");
        return;
      }
      olc(adlar);
    };
    const ek = document.getElementById("d-toplu-ek");
    if (ek && ek.parentElement === cubuk) ek.insertAdjacentElement("afterend", d);
    else cubuk.appendChild(d);
  }

  function baslat() {
    durdur();
    zamanlayici = setInterval(() => { if ($("#nem-detay").open) yukle(); }, 15000);
  }
  function durdur() {
    if (zamanlayici) clearInterval(zamanlayici);
    zamanlayici = null;
  }

  async function yukle(elle) {
    const p = P();
    if (!p) return;
    try {
      veri = await p.apiIste("/api/bahce");
      hataYaz("");
      ciz();
    } catch (h) {
      // Uç nokta yoksa (eski sunucu) bölüm sessizce boş kalıyor; elle
      // yenilendiyse sebebi yazıyoruz.
      if (elle) hataYaz(h.message || "Bahçe verisi alınamadı");
    }
  }

  function ciz() {
    const govde = $("#nem-govde");
    if (!govde || !veri) return;
    const bitkiler = (veri.bitkiler || []).slice()
      .sort((a, b) => SIRA[hal(a).ad] - SIRA[hal(b).ad]
                   || String(a.ad).localeCompare(String(b.ad), "tr"));

    const sayim = { yok: 0, odunc: 0, susadi: 0, bayat: 0, iyi: 0 };
    for (const b of bitkiler) sayim[hal(b).ad] += 1;

    const ozet = $("#nem-ozet");
    if (ozet) {
      const parca = [];
      if (sayim.susadi) parca.push(`<b class="nem-susadi">${sayim.susadi} susadı</b>`);
      if (sayim.yok) parca.push(`<b class="nem-yok">${sayim.yok} ölçülmedi</b>`);
      if (sayim.odunc) parca.push(`<b class="nem-odunc">${sayim.odunc} komşudan</b>`);
      if (sayim.bayat) parca.push(`<b class="nem-bayat">${sayim.bayat} eski</b>`);
      if (sayim.iyi) parca.push(`<b class="nem-iyi">${sayim.iyi} iyi</b>`);
      ozet.innerHTML = parca.join(" · ") || "bitki yok";
    }

    if (!bitkiler.length) {
      govde.innerHTML = '<tr><td colspan="6" class="alt-not">Kayıtlı bitki yok.</td></tr>';
      return;
    }

    govde.innerHTML = bitkiler.map((b) => {
      const h = hal(b), o = b.su_olcum || {};
      // NEREDEN ÖLÇÜLDÜĞÜ GÜVENİLİRLİĞİ DEĞİŞTİRİYOR: bitkinin kendi
      // üstünden alınan okuma ile 90 mm ötedeki aynı şey değil.
      const nereden = !o.var ? "—"
        : o.kendi ? "kendi üstünden"
        : `${Math.round(o.uzak_mm || 0)} mm ötede`;
      // Ödünç okuma PARANTEZ içinde: sayı görünüyor ama bu bitkinin
      // ölçülmüş nemi gibi durmuyor.
      const nem = !o.var ? "—"
        : o.kendi ? `%${Number(o.yuzde).toFixed(0)}`
        : `(%${Number(o.yuzde).toFixed(0)})`;
      const esik = o.esik_acik ? `%${Number(o.esik).toFixed(0)}` : "kapalı";
      return `<tr class="${h.sinif}">
        <td><b>${kacisli(b.tur_ad || b.tur || b.ad)}</b>
            <span class="alt-not">${kacisli(b.ad)}</span></td>
        <td><span class="nem-rozet ${h.sinif}">${h.etiket}</span></td>
        <td class="mono">${nem}</td>
        <td class="mono">${esik}</td>
        <td class="alt-not">${o.var ? `${nereden} · ${yasMetni(o.yas_sn)} önce` : "—"}</td>
        <td><button class="dugme nem-olc-tek" data-ad="${kacisli(b.ad)}"
                    title="Yalnız bu bitkinin nemini ölç">Ölç</button></td>
      </tr>
      <tr class="nem-gerekce ${h.sinif}"><td colspan="6" class="alt-not">
        ${kacisli(b.su_gerekce || "")}${b.su_tahmin
          ? ' <b class="nem-yok">— bu karar ÖLÇÜME değil, geçen güne dayanıyor</b>' : ""}
      </td></tr>`;
    }).join("");

    govde.querySelectorAll(".nem-olc-tek").forEach((d) => {
      d.onclick = () => olc([d.dataset.ad]);
    });
  }

  function olculmeyenleriOlc() {
    if (!veri) return;
    // Kendi ölçümü olmayan HER ŞEY: hiç ölçülmemiş, eskimiş ve komşudan
    // ödünç alan. Üçü de "bu bitkinin taze ölçümü yok" demek.
    const adlar = (veri.bitkiler || [])
      .filter((b) => ["yok", "bayat", "odunc"].includes(hal(b).ad))
      .map((b) => b.ad);
    if (!adlar.length) {
      notYaz("Bütün bitkilerin kendi taze ölçümü var.");
      return;
    }
    olc(adlar);
  }

  /** Ölçümü KUYRUĞA koyuyor — bahçenin kendi iş yolundan.
   *  İkinci bir hareket yolu açmak, güvenlik denetimlerinin yalnız
   *  birinden geçen bir hareket demekti. */
  async function olc(adlar) {
    const p = P();
    if (!p || !adlar.length) return;
    hataYaz("");
    try {
      await p.apiIste("/api/bahce/is", {
        method: "POST",
        body: JSON.stringify({ tip: "nem", noktalar: adlar }),
      });
      notYaz(`${adlar.length} bitki kuyruğa alındı — makine sırayla ölçecek.`);
      if (p.gunluk) p.gunluk(`✓ Nem ölçümü kuyrukta: ${adlar.length} bitki`, "ok");
      setTimeout(() => yukle(), 3000);
    } catch (h) {
      hataYaz(h.message || "Ölçüm başlatılamadı");
    }
  }

  function notYaz(metin) {
    const n = $("#nem-not");
    if (!n) return;
    n.textContent = metin || "";
    clearTimeout(notYaz._z);
    notYaz._z = setTimeout(() => { n.textContent = ""; }, 6000);
  }

  function hataYaz(metin) {
    const k = $("#nem-hata");
    if (!k) return;
    k.textContent = metin || "";
    k.classList.toggle("gizli", !metin);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(kur, 0));
  } else {
    setTimeout(kur, 0);
  }
})();
