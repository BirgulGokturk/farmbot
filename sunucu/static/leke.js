/* Bitki lekeleri — Kamera sekmesindeki çözümleme bölümü.
 *
 * AYRI DOSYA, `isik.js` ile aynı gerekçe: `app.js` ve `index.html` başka
 * bir oturumda sürekli değişiyor; oraya blok eklemek her yamada çakışma
 * demek. Buraya yalnız boş bir kap giriyor.
 *
 * KUTULAR ÇÖZÜMLENEN KARENİN ÜSTÜNE ÇİZİLİYOR, CANLI AKIŞIN DEĞİL.
 * Canlı akış saniyede beş kare atıyor; kutuları onun üstüne koysaydık
 * makine ya da bir yaprak kımıldadığı anda kutular kaymış görünürdü — ve
 * bu kayma sessiz olurdu, kimse fark etmezdi. Sunucu çözümlediği kareyi
 * belleğinde tutuyor (`/api/leke/kare`), burada onu çekip donmuş
 * görüntünün üstüne çiziyoruz.
 *
 * MİLİMETRE YOK. Kamera kalibrasyonu olmadığı için bütün sayılar piksel.
 * Panelde "mm" yazan tek bir yer yok; kalibrasyon geldiğinde eklenecek.
 *
 * TÜR YOK. Bu bölüm "şurada bitki var" diyor, "bu marul" demiyor. Tür
 * ayrımı sonraki katmanın işi ve orada tür listesi veriden geliyor.
 */
(function () {
  "use strict";

  const KAP = "leke-bolum";
  let sonSonuc = null;
  let sonKamera = "";
  let calisiyor = false;
  /* SEÇİLİ LEKE. Listede bir satıra tıklanınca karede vurgulanıyor —
   * 75 kutu arasında hangisinin hangi satır olduğu başka türlü
   * okunmuyor. */
  let seciliLeke = -1;

  const $ = (s) => document.querySelector(s);
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));

  function P() { return window.Panel || null; }

  function gunluk(metin, seviye) {
    const p = P();
    if (p && p.gunluk) p.gunluk(metin, seviye);
  }

  /* Kamera listesi ajandan geliyor (`S.kameralar`, durum paketiyle
   * tazeleniyor); koda gömülü "uc"/"ust" yok. Kamera ekleyen biri bu
   * bölümü de düzenlemek zorunda kalmasın. */
  function kameralar() {
    const p = P();
    const ham = (p && p.S && p.S.kameralar) || [];
    if (!Array.isArray(ham)) return [];
    return ham.map((k) => ({ ad: k.ad, etiket: k.etiket || k.ad }))
              .filter((k) => k.ad);
  }

  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    /* `<details>` KULLANILIYOR, `.bolum` DEĞİL. app.js açılışta bütün
     * `.bolum` öğelerini tarayıp `onclick` atıyor; bu bölüm dinamik
     * kurulduğu için o taramanın öncesine mi sonrasına mı düştüğü
     * belirsiz — sonrasına düşerse iki dinleyici birden çalışıp
     * açma/kapamayı birbirini götürürdü. `details` tarayıcının kendi
     * mekanizması, hiç JS istemiyor. */
    kap.innerHTML = `
      <details class="etiket-blok" id="bolum-leke">
        <summary>Bitki lekeleri <span class="ikincil" id="leke-ozet"></span></summary>
        <div>
          <p class="alt-not">
            Karedeki yeşillikleri ayırıyor — <b>türü söylemiyor</b>, "şurada
            bitki var" diyor. Bütün ölçüler <b>piksel</b>: kamera kalibre
            edilmediği için milimetre üretilmiyor.
          </p>
          <div class="satir">
            <label>Kamera <select id="leke-kamera"></select></label>
            <button id="d-leke-bul">Lekeleri bul</button>
            <span class="ikincil" id="leke-durum"></span>
          </div>
          <details class="etiket-blok">
            <summary>Ayarlar (bu çağrıya özel, kaydedilmiyor)</summary>
            <div class="satir">
              <label title="Otsu'nun bulduğu eşiğe eklenen pay. Pozitif = daha seçici.">
                Eşik payı <input type="number" id="leke-esik-payi" value="0" step="2" style="width:5rem">
              </label>
              <label title="Karenin alanına oran. Büyütmek küçük kırıntıları eler.">
                En küçük leke 1/<input type="number" id="leke-en-kucuk" value="20000" step="1000" style="width:7rem">
              </label>
              <label title="İşleme genişliği. Düşürmek hızlandırıyor, küçük filizleri kaçırabiliyor.">
                İşleme px <input type="number" id="leke-islem-px" value="1280" step="160" style="width:6rem">
              </label>
            </div>
            <div class="satir">
              <label title="HSV ton alt sınırı (0-179). Sarı hortum ve turkuaz kablo ExG'yi geçiyor; ton kapısı onları eliyor.">
                Ton alt <input type="number" id="leke-ton-alt" value="30" min="0" max="179" style="width:5rem">
              </label>
              <label title="HSV ton üst sınırı (0-179). İkisi de 0 iken kapı KAPALI.">
                Ton üst <input type="number" id="leke-ton-ust" value="75" min="0" max="179" style="width:5rem">
              </label>
              <span class="ikincil">İkisi de 0 = kapalı. Ölçüldü (15.09.2026):
                sarı hortum 24-25, <b>yaprak 33-63</b>, turkuaz kablo 87-98.
                Başka bir aydınlatmada <b>ton</b> sütununa yeniden bakın.</span>
            </div>
          </details>
          <div class="rozet-uyari gizli" id="leke-uyari"></div>
          <div id="leke-sahne" style="position:relative;display:inline-block;max-width:100%">
            <img id="leke-kare" alt="" style="max-width:100%;display:block;border-radius:6px">
            <svg id="leke-kutular" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></svg>
          </div>
          <div id="leke-liste"></div>
        </div>
      </details>`;

    kamerayiDoldur();
    /* Kamera listesi ajan bağlandığında geliyor, bölüm ondan önce
     * kurulmuş olabiliyor. Yoklama yerine kullanıcının seçiciye
     * dokunduğu ana bağlıyoruz: o an liste kesin güncel. */
    const sec = $("#leke-kamera");
    if (sec) {
      sec.addEventListener("mousedown", kamerayiDoldur);
      sec.addEventListener("focus", kamerayiDoldur);
    }
    const dugme = $("#d-leke-bul");
    if (dugme) dugme.addEventListener("click", bul);
    /* Kare yüklendikten sonra kutuları yeniden çiziyoruz: SVG'nin
     * viewBox'ı görüntünün gerçek ölçüsüne göre kuruluyor ve o ölçü
     * ancak yüklenince biliniyor. */
    const img = $("#leke-kare");
    if (img) img.addEventListener("load", kutulariCiz);
  }

  function kamerayiDoldur() {
    const sec = $("#leke-kamera");
    if (!sec) return;
    const liste = kameralar();
    const onceki = sec.value;
    sec.innerHTML = liste.length
      ? liste.map((k) => `<option value="${kacisli(k.ad)}">${kacisli(k.etiket)}</option>`).join("")
      : `<option value="">(kamera yok)</option>`;
    if (onceki && liste.some((k) => k.ad === onceki)) sec.value = onceki;
  }

  async function bul() {
    if (calisiyor) return;
    const p = P();
    if (!p || !p.apiIste) return;
    const sec = $("#leke-kamera");
    const kamera = sec ? sec.value : "";
    if (!kamera) {
      uyari("Kamera seçilmedi — ajandan kamera listesi gelmemiş olabilir.");
      return;
    }

    calisiyor = true;
    durumYaz("çözümleniyor…");
    uyari("");
    const dugme = $("#d-leke-bul");
    if (dugme) dugme.disabled = true;

    /* Ayar alanları boş ya da saçma bırakılmışsa GÖNDERİLMİYOR: sunucuya
     * 0 yollayıp ajandaki varsayılanı ezmek, "neden hiçbir şey bulmuyor"
     * sorusunun sessiz cevabı olurdu. */
    const ayar = {};
    const pay = sayi("#leke-esik-payi");
    if (pay !== null) ayar.esik_payi = pay;
    const enKucuk = sayi("#leke-en-kucuk");
    if (enKucuk !== null && enKucuk > 0) ayar.en_kucuk_oran = 1 / enKucuk;
    const islem = sayi("#leke-islem-px");
    if (islem !== null && islem >= 160) ayar.islem_genislik = islem;
    const tonAlt = sayi("#leke-ton-alt");
    const tonUst = sayi("#leke-ton-ust");
    if (tonAlt !== null) ayar.ton_alt = tonAlt;
    if (tonUst !== null) ayar.ton_ust = tonUst;

    try {
      const y = await p.apiIste("/api/leke/bul", {
        method: "POST",
        body: JSON.stringify({ kamera, ayar }),
      });
      sonSonuc = y;
      sonKamera = y.kamera || kamera;
      seciliLeke = -1;
      yaz(y);
    } catch (hata) {
      durumYaz("");
      uyari(String((hata && hata.message) || hata));
      gunluk("Leke bulma başarısız: " + ((hata && hata.message) || hata), "hata");
    } finally {
      calisiyor = false;
      if (dugme) dugme.disabled = false;
    }
  }

  function sayi(secici) {
    const el = $(secici);
    if (!el) return null;
    const d = parseFloat(el.value);
    return Number.isFinite(d) ? d : null;
  }

  function durumYaz(metin) {
    const el = $("#leke-durum");
    if (el) el.textContent = metin || "";
  }

  function uyari(metin) {
    const el = $("#leke-uyari");
    if (!el) return;
    el.textContent = metin || "";
    el.classList.toggle("gizli", !metin);
  }

  function yaz(y) {
    const lekeler = y.lekeler || [];
    const ozet = $("#leke-ozet");
    const parca = [
      `${lekeler.length} leke`,
      `yeşil %${((y.yesil_oran || 0) * 100).toFixed(2)}`,
    ];
    if (y.esik != null) parca.push(`eşik ${y.esik}`);
    if (y.sure_ms != null) {
      /* Çözme süresi ayrı yazılıyor: toplam yükseldiğinde suçlunun JPEG
       * çözme mi leke bulma mı olduğu tahmin edilmesin. */
      parca.push(y.coz_ms != null
        ? `${y.sure_ms} ms (çözme ${y.coz_ms})`
        : `${y.sure_ms} ms`);
    }
    if (ozet) ozet.textContent = parca.join(" · ");
    durumYaz(parca.join(" · "));

    /* SEBEP SESSİZ KALMIYOR. Boş liste tek başına "bitki yok" demek
     * değil — eşiğin hiçbir şey ayıramaması da, her şeyin elenmesi de
     * boş liste veriyor ve ikisi bambaşka sorunlar. */
    const notlar = [];
    if (y.sebep) notlar.push(y.sebep);
    if (y.kare_hatasi) notlar.push("Kare gösterilemiyor: " + y.kare_hatasi);
    if (y.elenen && (y.elenen.kucuk || y.elenen.buyuk)) {
      notlar.push(`elenen: ${y.elenen.kucuk} küçük, ${y.elenen.buyuk} büyük`);
    }
    if (y.ton_kapisi) {
      notlar.push(`ton kapısı ${y.ton_kapisi[0]}-${y.ton_kapisi[1]}`
        + ((y.elenen && y.elenen.ton_px) ? `, ${y.elenen.ton_px} piksel eledi` : ""));
    }
    uyari(notlar.join(" · "));

    const img = $("#leke-kare");
    if (img) {
      if (y.damga) {
        /* ÇÖZÜMLENEN kare çekiliyor, arşivdeki değil: arşiv kamera
         * başına 12 kare tutuyor ve çözümleme kareleri kullanıcının
         * periyodik karelerini itip atardı.
         *
         * Jeton ŞART: uç panel parolasını soruyor ve <img> isteği başlık
         * gönderemiyor, sorguya yazılıyor. Parola boşken de zararsız. */
        const p2 = P();
        const jeton = (p2 && p2.S && p2.S.jeton) || "";
        img.src = `/api/leke/kare?kamera=${encodeURIComponent(y.kamera || sonKamera)}`
          + `&jeton=${encodeURIComponent(jeton)}&damga=${encodeURIComponent(y.damga)}`;
      } else {
        img.removeAttribute("src");
        kutulariCiz();
      }
    }
    listeyiYaz(lekeler);
  }

  function kutulariCiz() {
    const svg = $("#leke-kutular");
    if (!svg) return;
    const y = sonSonuc;
    const kare = (y && y.kare_px) || null;
    if (!y || !kare || !kare[0] || !kare[1]) { svg.innerHTML = ""; return; }

    /* viewBox GERÇEK karenin piksel ölçüsü: koordinatlar olduğu gibi
     * kullanılıyor, tarayıcı ölçeklemeyi kendi yapıyor. Elle ölçekleme
     * yapsaydık görüntü kutusu her değiştiğinde yeniden hesaplamak
     * gerekirdi. */
    svg.setAttribute("viewBox", `0 0 ${kare[0]} ${kare[1]}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const kalinlik = Math.max(2, Math.round(kare[0] / 400));
    const parcalar = (y.lekeler || []).map((l, i) => {
      const [x1, y1, x2, y2] = l.kutu || [0, 0, 0, 0];
      const secili = i === seciliLeke;
      const renk = secili ? "#ffd166" : "#ff4d4d";
      const r = Math.max(3, Math.round(kare[0] / 300));
      return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}"
                fill="none" stroke="${renk}" stroke-width="${secili ? kalinlik * 2 : kalinlik}"/>
              <circle cx="${l.x}" cy="${l.y}" r="${r}" fill="${renk}"/>`;
    });
    svg.innerHTML = parcalar.join("");
  }

  function listeyiYaz(lekeler) {
    const kap = $("#leke-liste");
    if (!kap) return;
    if (!lekeler.length) { kap.innerHTML = ""; return; }
    const satirlar = lekeler.map((l, i) => `
      <tr data-no="${i}" style="cursor:pointer">
        <td>${i + 1}</td>
        <td>${l.x}, ${l.y}</td>
        <td>${l.alan_px}</td>
        <td>${l.dolgu}</td>
        <td>${l.en_boy}</td>
        <td>${l.ton == null ? "—" : l.ton}</td>
        <td>${l.doygunluk == null ? "—" : l.doygunluk}</td>
      </tr>`).join("");
    kap.innerHTML = `
      <table class="tablo dar">
        <thead><tr>
          <th>#</th><th>merkez (px)</th><th>alan (px²)</th>
          <th title="Lekenin kendi kutusunu ne kadar doldurduğu. Yuvarlak bir fide yüksek; ince bir kablo ya da kenar çizgisi düşük.">dolgu</th>
          <th title="Genişlik / yükseklik. 1'e yakın = yuvarlak.">en/boy</th>
          <th title="ÖLÇÜLEN HSV tonu (0-179), medyan. Ton kapısını bu sütuna bakarak seçin — yaprak ile sarı hortum/turkuaz kablo burada ayrışıyor.">ton</th>
          <th title="ÖLÇÜLEN doygunluk (0-255), medyan. Kablolar genelde yapraklardan daha doygun.">doyg.</th>
        </tr></thead>
        <tbody>${satirlar}</tbody>
      </table>`;
    kap.querySelectorAll("tbody tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        const no = parseInt(tr.getAttribute("data-no"), 10);
        seciliLeke = (seciliLeke === no) ? -1 : no;
        kutulariCiz();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kur);
  } else {
    kur();
  }
})();
