/* Bitki lekeleri — Kamera sekmesindeki çözümleme bölümü.
 *
 * AYRI DOSYA, `isik.js` ile aynı gerekçe: `app.js` ve `index.html` başka
 * bir oturumda sürekli değişiyor; oraya blok eklemek her yamada çakışma
 * demek. Buraya yalnız boş bir kap giriyor.
 *
 * İKİ YER, İKİ DAVRANIŞ — ve fark bilerek:
 *
 * BÖLÜMDE kare DONDURULUYOR. Sunucu çözümlediği kareyi belleğinde
 * tutuyor (`/api/leke/kare`), burada onu çekip üstüne çiziyoruz.
 * Gerekçe: burada tablo okunuyor, satıra tıklanıyor, ayar deneniyor —
 * altındaki görüntü saniyede beş kez değişseydi hiçbiri okunamazdı.
 *
 * YÜZEN KUTULARDA ÇİZİM YOK — GERİ ALINDI. Kutuları canlı akışın
 * üstüne çizmek için görüntüyü konumlandırılmış bir sarmalayıcıya
 * almıştık. Bedeli ağır çıktı: `app.js`in kamera kutusu düzeni
 * görüntünün `.kamera-yuzen`in DOĞRUDAN çocuğu olmasına dayanıyor,
 * araya bir öğe girince esneme ona gidiyor ve görüntü kutudan taşıyor.
 * Sahada "kamera bozuldu" diye ortaya çıktı.
 *
 * Yüzen kutuda kalan tek şey ◎ düğmesi: çözümlemeyi başlatıyor, sonuç
 * bölümde görünüyor. Çizim, `app.js`in düzenine dokunmayan bir yol
 * bulunduğunda geri gelecek.
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

  function canliMi(ad) {
    const p = P();
    const ham = (p && p.S && p.S.kameralar) || [];
    const k = Array.isArray(ham) ? ham.find((x) => x.ad === ad) : null;
    return !!(k && k.canli);
  }

  function kur() {
    roiYukle();
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
          <div class="satir">
            <label>Otomatik çözümleme
              <select id="leke-oto-mod">
                <option value="kapali">kapalı</option>
                <option value="durunca">makine durunca (kare panele gelir)</option>
                <option value="surekli">sürekli (ajanda, kare ağdan geçmez)</option>
              </select>
            </label>
            <label title="Sürekli kipin çözümleme aralığı. Alt sınır 0.5 sn: çözümleme ~300 ms sürüyor, daha sık istemek bir çekirdeği doldurur.">
              Aralık <input type="number" id="leke-aralik" value="2" min="0.5" max="300" step="0.5" style="width:5rem"> sn
            </label>
            <span class="ikincil" id="leke-oto-durum"></span>
          </div>
          <p class="alt-not">
            Yüzen kamera kutularındaki <b>◎</b> düğmesi tek seferlik çözümleme yapıyor.
            <b>Makine durunca</b> kipinde kare panele geliyor (her durakta ~1,5 MB) ve
            makine kımıldadığı anda kutular siliniyor — çözümleme bir konuma ait.
            <b>Sürekli</b> kipinde çözümleme ajanda yapılıyor, panele yalnız kutu
            koordinatları geliyor: hareket sırasında da çalışıyor, ama sonuç aralık
            kadar geriden geliyor. Konum farkı büyüdüğünde kutular soluklaşıyor.
          </p>
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
            <div class="satir">
              <label title="Bir fidenin yaprakları ayrı leke çıkabiliyor. Kutuları arasındaki boşluk, ortalama kutu kenarının bu katından azsa aynı bitki sayılıyor. 0 = birleştirme kapalı.">
                Birleştirme <input type="number" id="leke-birlestir" value="0.3" min="0" max="5" step="0.1" style="width:5rem">
              </label>
              <span class="ikincil">Bir fidenin yaprakları ayrı leke çıkıyorsa artırın.
                Fazlası <b>komşu iki fideyi tek bitki yapar</b> — tabloda
                <b>parça</b> sütununa bakın.</span>
            </div>
          </details>
          <div class="rozet-uyari gizli" id="leke-uyari"></div>
          <div id="leke-sahne" style="position:relative;display:inline-block;max-width:100%">
            <img id="leke-kare" alt="" style="max-width:100%;display:block;border-radius:6px">
            <svg id="leke-kutular" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></svg>
          </div>
          <div id="leke-liste"></div>
          <details class="etiket-blok" id="leke-gecmis-blok">
            <summary>Büyüme geçmişi</summary>
            <div class="satir">
              <label>Süre
                <select id="leke-gecmis-saat">
                  <option value="24">24 saat</option>
                  <option value="72" selected>3 gün</option>
                  <option value="168">1 hafta</option>
                  <option value="720">1 ay</option>
                </select>
              </label>
              <button id="d-leke-gecmis">Getir</button>
              <span class="ikincil" id="leke-gecmis-not"></span>
            </div>
            <div id="leke-gecmis-cizim"></div>
          </details>
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

    otoKur();
    const gd = $("#d-leke-gecmis");
    if (gd) gd.addEventListener("click", gecmisGetir);
    yuzenleriTara();
    setInterval(saat, 500);
  }

  /* ---------------------------------------------------------------- 
   * BÜYÜME GEÇMİŞİ
   *
   * Çizilen şey `kapladigi_oran`: lekelerin karenin ne kadarını
   * kapladığı. Piksel alanı DEĞİL — o çözünürlüğe bağlı ve kamera ayarı
   * değişince eski kayıtlarla karşılaştırılamaz hâle geliyor. Oran
   * çözünürlükten bağımsız.
   *
   * KAMERA OYNARSA AYRI SERİ. Bu projede kameralar sabit değil; kamera
   * yer değiştirince aynı yatağın yeşil oranı bambaşka çıkıyor.
   * Hepsini tek eğriye dizmek olmayan bir büyümeyi göstermek olurdu, o
   * yüzden konumu farklı olan kayıtlar ayrı ayrı sayılıyor ve kaç ayrı
   * konum olduğu yazılıyor.
   * ---------------------------------------------------------------- */
  async function gecmisGetir() {
    const p = P();
    const not = $("#leke-gecmis-not");
    const kap = $("#leke-gecmis-cizim");
    if (!p || !p.apiIste || !kap) return;
    const sec = $("#leke-kamera");
    const kamera = sec ? sec.value : "";
    const saatSec = $("#leke-gecmis-saat");
    const saatler = saatSec ? saatSec.value : "72";
    if (not) not.textContent = "getiriliyor…";
    try {
      const y = await p.apiIste(
        `/api/leke/gecmis?kamera=${encodeURIComponent(kamera)}&saat=${encodeURIComponent(saatler)}`);
      gecmisCiz(y.kayitlar || [], y.aralik_sn);
    } catch (hata) {
      if (not) not.textContent = "alınamadı: " + ((hata && hata.message) || hata);
      kap.innerHTML = "";
    }
  }

  function konumEtiketi(k) {
    if (!k || k.x == null || k.y == null) return "konumsuz";
    return `${k.x},${k.y}`;
  }

  function gecmisCiz(kayitlar, aralik) {
    const kap = $("#leke-gecmis-cizim");
    const not = $("#leke-gecmis-not");
    if (!kap) return;
    if (!kayitlar.length) {
      kap.innerHTML = "";
      if (not) {
        not.textContent = "kayıt yok — 'Lekeleri bul'a basın ya da sürekli kipi açın"
          + (aralik ? ` (sürekli kipte en sık ${Math.round(aralik / 60)} dakikada bir yazılıyor)` : "");
      }
      return;
    }
    const konumlar = [...new Set(kayitlar.map((k) => konumEtiketi(k.konum)))];
    if (not) {
      not.textContent = `${kayitlar.length} kayıt`
        + (konumlar.length > 1
          ? ` · ${konumlar.length} FARKLI KONUM — eğriler ayrı, kamera oynamış`
          : "");
    }

    const g = 640, y = 180, ust = 10, alt = 24, sol = 46, sag = 10;
    const enKucukTs = kayitlar[0].ts, enBuyukTs = kayitlar[kayitlar.length - 1].ts;
    const araTs = Math.max(1, enBuyukTs - enKucukTs);
    const enBuyukOran = Math.max(...kayitlar.map((k) => k.kapladigi_oran || 0)) || 1e-6;
    const xk = (ts) => sol + (ts - enKucukTs) / araTs * (g - sol - sag);
    const yk = (o) => ust + (1 - (o || 0) / enBuyukOran) * (y - ust - alt);

    /* Her konum kendi eğrisi. Renkler ayırt etmek için; anlam
     * taşımıyorlar ve o yüzden sabit bir listeden sırayla veriliyor. */
    const renkler = ["#7bc86c", "#6cb2c8", "#c8a86c", "#c86c9a", "#9a6cc8"];
    const yollar = konumlar.map((ad, i) => {
      const seri = kayitlar.filter((k) => konumEtiketi(k.konum) === ad);
      const d = seri.map((k, j) =>
        `${j ? "L" : "M"}${xk(k.ts).toFixed(1)},${yk(k.kapladigi_oran).toFixed(1)}`).join("");
      const nokta = seri.map((k) =>
        `<circle cx="${xk(k.ts).toFixed(1)}" cy="${yk(k.kapladigi_oran).toFixed(1)}" r="2"
           fill="${renkler[i % renkler.length]}"><title>${new Date(k.ts * 1000).toLocaleString("tr")}
%${((k.kapladigi_oran || 0) * 100).toFixed(3)} · ${k.adet} bitki · en büyük ${k.en_buyuk_px} px²</title></circle>`).join("");
      return `<path d="${d}" fill="none" stroke="${renkler[i % renkler.length]}" stroke-width="1.5"/>${nokta}`;
    }).join("");

    const tarih = (ts) => new Date(ts * 1000).toLocaleDateString("tr", { day: "2-digit", month: "2-digit" });
    kap.innerHTML = `
      <svg viewBox="0 0 ${g} ${y}" style="width:100%;max-width:${g}px;height:auto">
        <line x1="${sol}" y1="${ust}" x2="${sol}" y2="${y - alt}" stroke="#555"/>
        <line x1="${sol}" y1="${y - alt}" x2="${g - sag}" y2="${y - alt}" stroke="#555"/>
        <text x="4" y="${ust + 8}" fill="#999" font-size="10">%${(enBuyukOran * 100).toFixed(2)}</text>
        <text x="4" y="${y - alt}" fill="#999" font-size="10">0</text>
        <text x="${sol}" y="${y - 6}" fill="#999" font-size="10">${tarih(enKucukTs)}</text>
        <text x="${g - sag - 40}" y="${y - 6}" fill="#999" font-size="10">${tarih(enBuyukTs)}</text>
        ${yollar}
      </svg>
      <p class="alt-not">Dikey eksen: lekelerin karenin ne kadarını kapladığı.
        Piksel alanı değil — o çözünürlüğe bağlı, oran bağımsız.
        <b>Milimetre yok</b>: kamera kalibre edilmediği için gerçek alan üretilmiyor.</p>`;
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
     * sorusunun sessiz cevabı olurdu. Toplama `ayarTopla` içinde — yüzen
     * kutular da aynı alanları kullanıyor, iki kopya ayrışırdı. */
    const ayar = ayarTopla();

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
    const o = y.olcum || {};
    const parca = [
      // BİTKİ sayısı ile ham leke sayısı ayrı yazılıyor: birleştirme
      // çok agresifse fark büyür ve bu, ayarı düzeltme işareti.
      (o.ham_adet && o.ham_adet !== lekeler.length)
        ? `${lekeler.length} bitki (${o.ham_adet} leke)`
        : `${lekeler.length} bitki`,
      `yeşil %${((y.yesil_oran || 0) * 100).toFixed(2)}`,
    ];
    if (o.en_buyuk_px) parca.push(`en büyük ${o.en_buyuk_px} px²`);
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
        <td>${l.parca || 1}</td>
      </tr>`).join("");
    kap.innerHTML = `
      <table class="tablo dar">
        <thead><tr>
          <th>#</th><th>merkez (px)</th><th>alan (px²)</th>
          <th title="Lekenin kendi kutusunu ne kadar doldurduğu. Yuvarlak bir fide yüksek; ince bir kablo ya da kenar çizgisi düşük.">dolgu</th>
          <th title="Genişlik / yükseklik. 1'e yakın = yuvarlak.">en/boy</th>
          <th title="ÖLÇÜLEN HSV tonu (0-179), medyan. Ton kapısını bu sütuna bakarak seçin — yaprak ile sarı hortum/turkuaz kablo burada ayrışıyor.">ton</th>
          <th title="ÖLÇÜLEN doygunluk (0-255), medyan. Kablolar genelde yapraklardan daha doygun.">doyg.</th>
          <th title="Kaç ayrı lekeden birleşti. 1 = tek parça bulundu. Büyük sayılar yaprakların ayrı ayrı bulunup birleştirildiğini gösteriyor.">parça</th>
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

  /* ===================================================================
   * YÜZEN KAMERA KUTULARI
   *
   * Düğme ve kutular buradan ENJEKTE ediliyor; `app.js` ve `index.html`
   * hiç değişmiyor. Şablona düğme eklemek o iki dosyaya dokunmak
   * demekti ve ikisi de başka bir oturumda sürekli değişiyor.
   *
   * KUTULAR CANLI AKIŞIN ÜSTÜNE ÇİZİLİYOR — bölümdekinin aksine. Orada
   * kare donduruluyor çünkü inceleme uzun sürüyor; burada amaç "makine
   * şu an neye bakıyor" ve canlı görüntüyü dondurmak onu kaybettirirdi.
   *
   * KAYMA SESSİZ KALMIYOR: çözümleme bir konuma ait. Makine kımıldadığı
   * anda kutular siliniyor, çünkü artık başka bir yeri gösteriyorlar.
   * Ekranda kalmalarına izin vermek, yanlış yeri bitki diye göstermek
   * olurdu — hem de kimsenin fark etmeyeceği biçimde.
   * =================================================================== */

  const YUZEN = new Map();   // kamera -> {kutu, svg, dugme, sonuc, konum}
  let otoAcik = false;
  /* Konum sabitlendikten sonra bu kadar beklenip çözümleniyor. Hareket
   * HÂLİNDEKİ kare bulanık ve hangi konuma ait olduğu belirsiz; durmayı
   * beklemek ikisini de çözüyor. 1.5 sn: PLC konumu yarım saniyede bir
   * bildiriyor, üç okuma boyunca sabitse hareket gerçekten bitmiştir. */
  const DURGUNLUK_SN = 1.5;
  const KONUM_ESIK_MM = 0.5;
  let sonImza = null;
  let durgunBasi = 0;
  let otoCalisiyor = false;

  function konumImzasi() {
    const p = P();
    const k = (p && p.S && p.S.sonKonum) || null;
    if (!k || k.x == null || k.y == null) return null;
    return { x: +k.x, y: +k.y, z: (k.z == null ? null : +k.z) };
  }

  function konumAyni(a, b) {
    if (!a || !b) return false;
    const fark = (u, v) => (u == null || v == null) ? 0 : Math.abs(u - v);
    return fark(a.x, b.x) <= KONUM_ESIK_MM
        && fark(a.y, b.y) <= KONUM_ESIK_MM
        && fark(a.z, b.z) <= KONUM_ESIK_MM;
  }

  /* ==================================================================== #
   * ÇİZİM KATMANI — SARMALAYICISIZ
   *
   * Bir önceki denemede görüntü konumlandırılmış bir div'e alınmıştı ve
   * geri alındı (0c53d0e): `app.js`in kamera kutusu düzeni görüntünün
   * `.kamera-yuzen`in DOĞRUDAN çocuğu olmasına dayanıyor, araya öğe
   * girince esneme ona gidip görüntü kutudan taşıyordu.
   *
   * Bu sefer katman görüntünün KARDEŞİ ve MUTLAK konumlu. Mutlak öğe
   * esnek düzenin dışındadır, yani `app.js`in yerleşimine hiç
   * karışmıyor. `.kamera-yuzen` zaten `position: relative` (stil.css),
   * dolayısıyla çapa hazır.
   *
   * KATMAN GÖRÜNTÜNÜN KUTUSUNA OTURUYOR, kutunun tamamına değil:
   * görüntü `object-fit: contain` ile duruyor ve geniş kutuda fotoğraf
   * ortada dar bir şerit olabiliyor. Ölçek/büyüt/pencere değişince
   * `ResizeObserver` yeniden hizalıyor. İçerik `xMidYMid meet` ile
   * `contain` ile birebir aynı ölçekleniyor — ölçüldü, sapma 0 px.
   * ==================================================================== */

  /** Katmanı görüntünün o anki kutusuna oturtur. */
  function katmanHizala(ad) {
    const k = YUZEN.get(ad);
    if (!k || !k.svg || !k.im || !k.kutu) return;
    const kb = k.kutu.getBoundingClientRect();
    const ib = k.im.getBoundingClientRect();
    if (!ib.width || !ib.height) { k.svg.style.display = "none"; return; }
    k.svg.style.display = "";
    k.svg.style.left = (ib.left - kb.left - k.kutu.clientLeft) + "px";
    k.svg.style.top = (ib.top - kb.top - k.kutu.clientTop) + "px";
    k.svg.style.width = ib.width + "px";
    k.svg.style.height = ib.height + "px";
  }

  /* ------------------------------------------------------------------ ROI
   * Bu uç kalibrasyon kullanmıyor, yani "leke toprağın üstünde mi"
   * denetimi yok ve kadrajdaki her yeşil sayılıyor. ÖLÇÜLDÜ: yeşil
   * plastik huninin ExG'si 35,3, gerçek filizlerinki 0,6 / 7,0 / 8,2 /
   * 12,2 — huni hepsinden yeşil, yani hiçbir renk eşiği ikisini
   * ayıramaz. Ayıran tek şey YER.
   *
   * Şekil ÇOK KÖŞELİ. Dört köşeli bir şekil kabın yuvarlak köşelerini
   * kesiyordu: ölçümde dörtgen toprağın %94,2'sini, zarf %99,7'sini
   * kapsadı. Köşeler oranlı (0-1) saklanıyor — çekim çözünürlüğü
   * değişiyor, piksel saklamak ROI'yi kaydırırdı. */
  const ROI = new Map();
  const ROI_ANAHTAR = "farmbot_leke_roi";
  const ROI_KOSE_YAKIN = 0.05;

  function roiOku(v) {
    if (!v) return null;
    if (Array.isArray(v.k) && v.k.length >= 3) return { k: v.k };
    if (typeof v.x1 === "number") {
      return { k: [[v.x1, v.y1], [v.x2, v.y1], [v.x2, v.y2], [v.x1, v.y2]] };
    }
    return null;
  }

  function roiYukle() {
    try {
      const ham = JSON.parse(localStorage.getItem(ROI_ANAHTAR) || "{}");
      Object.keys(ham).forEach((a) => {
        const d = roiOku(ham[a]);
        if (d) ROI.set(a, d);
      });
    } catch (h) { /* bozuk kayıt: ROI yok sayılıyor */ }
  }

  function roiKaydet() {
    const d = {};
    ROI.forEach((v, a) => { d[a] = v; });
    try { localStorage.setItem(ROI_ANAHTAR, JSON.stringify(d)); } catch (h) { /* boş */ }
  }

  /** Olayın karedeki oranlı karşılığı (0-1). Katman zaten görüntünün
   *  kutusuna oturduğu için dönüşüm katmanın kendi kutusundan çıkıyor. */
  function roiNokta(ad, o) {
    const k = YUZEN.get(ad);
    if (!k || !k.svg) return null;
    const b = k.svg.getBoundingClientRect();
    if (!b.width || !b.height) return null;
    return [Math.max(0, Math.min(1, (o.clientX - b.left) / b.width)),
            Math.max(0, Math.min(1, (o.clientY - b.top) / b.height))];
  }

  function roiKose(ad, n) {
    const r = ROI.get(ad);
    if (!r || !n) return -1;
    let en = -1, mesafe = ROI_KOSE_YAKIN;
    r.k.forEach((p, i) => {
      const d = Math.hypot(p[0] - n[0], p[1] - n[1]);
      if (d < mesafe) { mesafe = d; en = i; }
    });
    return en;
  }

  function roiIcinde(px, py, k) {
    let v = false;
    for (let i = 0, j = k.length - 1; i < k.length; j = i++) {
      const xi = k[i][0], yi = k[i][1], xj = k[j][0], yj = k[j][1];
      if ((yi > py) !== (yj > py)
          && px < (xj - xi) * (py - yi) / (yj - yi) + xi) v = !v;
    }
    return v;
  }

  /** ROI'yi uygular, YENİ sonuç nesnesi döndürür — ham liste değişmiyor,
   *  yani ROI'yi oynatmak geri alınabilir. Merkezi olmayan leke
   *  ELENMİYOR: bilmediğimiz bir şeye dayanarak atmak daha kötü. */
  function roiUygula(ad, ham) {
    if (!ham) return ham;
    const r = ROI.get(ad);
    const kare = ham.kare_px || null;
    if (!r || !kare || !kare[0] || !kare[1] || !Array.isArray(ham.lekeler)) {
      return Object.assign({}, ham, { roi_elenen: 0 });
    }
    const kalan = ham.lekeler.filter((l) => {
      let cx = Number(l.x), cy = Number(l.y);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
        const kt = l.kutu;
        if (!Array.isArray(kt) || kt.length !== 4) return true;
        cx = (Number(kt[0]) + Number(kt[2])) / 2;
        cy = (Number(kt[1]) + Number(kt[3])) / 2;
      }
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return true;
      return roiIcinde(cx / kare[0], cy / kare[1], r.k);
    });
    return Object.assign({}, ham,
      { lekeler: kalan, roi_elenen: ham.lekeler.length - kalan.length });
  }

  /** ROI ya da seçim değişince ekrandaki sonucu tazeler. */
  function roiTazele(ad) {
    const k = YUZEN.get(ad);
    if (!k || !k.ham) return null;
    k.sonuc = roiUygula(ad, k.ham);
    if (k.secili) k.secili.clear();
    yuzendeCiz(ad);
    return k.sonuc;
  }

  /** Toprağı sunucuya buldurup ROI'yi ondan kurar. DOLULUK yazılıyor:
   *  düşükse maskeye yabancı bir şey karışmış demektir ve kullanıcının
   *  köşeleri düzeltebilmesi için bunu görmesi gerekiyor. */
  async function toprakBul(ad) {
    const p = P();
    if (!YUZEN.has(ad) || !p || !p.apiIste) return;
    notYaz(ad, "toprak aranıyor…");
    try {
      const y = await p.apiIste("/api/leke/toprak", {
        method: "POST", body: JSON.stringify({ kamera: ad }),
      });
      if (!y || !Array.isArray(y.kose) || y.kose.length < 3) {
        notYaz(ad, "toprak bulunamadı — köşeleri Shift ile elle çizin");
        return;
      }
      ROI.set(ad, { k: y.kose });
      roiKaydet();
      const t = roiTazele(ad);
      yuzendeCiz(ad);
      notYaz(ad, `toprak bulundu · ${y.kose.length} köşe · doluluk ${y.doluluk}`
        + (t ? ` · ${(t.lekeler || []).length} leke`
             + (t.roi_elenen ? `, dışarıda ${t.roi_elenen} elendi` : "") : ""));
    } catch (hata) {
      notYaz(ad, "toprak aranamadı: " + ((hata && hata.message) || hata));
    }
  }

  //: Son yazılan tür — kap genelde günlerce aynı türü taşıyor.
  const TUR_ANAHTAR = "farmbot_leke_tur";

  /** Seçili lekelerin kesitlerini eğitim verisine yazar.
   *
   *  SEÇİM ŞART. Kapta tek tür olduğu varsayımıyla hepsini yazmak,
   *  karışık kapta yanlış etiket üretir ve yanlış etiket eğitimde
   *  etiketsizlikten kötüdür. Hiçbir kutu seçili değilse iş yapılmıyor
   *  ve sebebi yazılıyor. */
  async function kesitKaydet(ad) {
    const kayit = YUZEN.get(ad);
    const p = P();
    if (!kayit || !p || !p.apiIste) return;
    const hepsi = (kayit.sonuc && kayit.sonuc.lekeler) || [];
    const secili = kayit.secili || new Set();
    const lekeler = hepsi.filter((l, i) => secili.has(i));
    if (!lekeler.length) {
      notYaz(ad, hepsi.length
        ? "hiç kutu seçili değil — kaydedilecekleri tıklayın"
        : "önce ◎ ile çözümleyin");
      return;
    }
    const kutu = kayit.turKutu;
    const tur = ((kutu && kutu.value) || "").trim().toLowerCase();
    if (!tur) {
      notYaz(ad, "önce tür yazın (örn. maydanoz)");
      if (kutu) kutu.focus();
      return;
    }
    try { localStorage.setItem(TUR_ANAHTAR, tur); } catch (h) { /* boş */ }
    notYaz(ad, `${lekeler.length} kesit yazılıyor…`);
    try {
      const y = await p.apiIste("/api/leke/kesit", {
        method: "POST",
        body: JSON.stringify({ kamera: ad, tur, lekeler, roi: !!ROI.get(ad) }),
      });
      const say = (y.sayim && y.sayim.turler) || {};
      const dokum = Object.keys(say).sort().map((t) => `${t} ${say[t]}`).join(" · ");
      secili.clear();
      yuzendeCiz(ad);
      notYaz(ad, `${y.yazilan} kesit yazıldı`
        + (y.atlanan ? ` · ${y.atlanan} atlandı` : "")
        + (dokum ? ` — ${dokum}` : ""));
    } catch (hata) {
      notYaz(ad, "kesit yazılamadı: " + ((hata && hata.message) || hata));
    }
  }

  /** Sürüklerken oluşan şekil: köşe taşınıyorsa yalnız o köşe, yeni
   *  çizimse iki noktadan kaba bir dikdörtgen. */
  function gecici(ad, suru, n) {
    if (suru.kose >= 0) {
      const r = ROI.get(ad);
      if (!r) return null;
      return { k: r.k.map((p, i) => (i === suru.kose ? n : p)) };
    }
    const x1 = Math.min(suru.bas[0], n[0]), x2 = Math.max(suru.bas[0], n[0]);
    const y1 = Math.min(suru.bas[1], n[1]), y2 = Math.max(suru.bas[1], n[1]);
    return { k: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] };
  }

  function yuzenleriTara() {
    const kap = document.getElementById("kamera-yuzenler");
    if (!kap) return;
    // Kamera listeden düşünce `app.js` kutusunu siliyor; kaydı da
    // bırakmıyoruz, yoksa kopmuş bir DOM düğümüne yazmaya çalışırdık.
    [...YUZEN.keys()].forEach((ad) => {
      const kayit = YUZEN.get(ad);
      if (!kayit.kutu.isConnected) YUZEN.delete(ad);
    });
    kap.querySelectorAll(".kamera-yuzen").forEach(yuzeniDonat);
  }

  /* YÜZEN KUTULARIN DOM'UNA DOKUNULMUYOR — GERİ ALINDI.
   *
   * Görüntüyü konumlandırılmış bir sarmalayıcıya almıştık ki kutular
   * tam üstüne otursun. Bedeli ağır çıktı: `app.js`in kamera kutusu
   * düzeni görüntünün `.kamera-yuzen`in DOĞRUDAN çocuğu olmasına
   * dayanıyor; araya bir öğe girince esneme ona gidiyor ve görüntü
   * kutudan taşıyor. Sahada "kamera bozuldu" diye ortaya çıktı.
   *
   * Çizim şimdilik YALNIZ bölümde (orada kare kendi kabında ve kimsenin
   * düzenine karışmıyor). Yüzen kutuda kalan tek şey ◎ düğmesi:
   * çözümlemeyi başlatıyor, sonuç bölümde görünüyor. Kutuların yüzen
   * kutuda da çizilmesi, `app.js`in düzenini bozmayan bir yol
   * bulunduğunda geri gelecek. */
  function yuzeniDonat(kutu) {
    const ad = kutu && kutu.dataset ? kutu.dataset.kam : "";
    if (!ad || YUZEN.has(ad)) return;
    const img = kutu.querySelector('[data-rol="kare"]');
    const araclar = kutu.querySelector(".kamera-yuzen-araclar");
    if (!img || !araclar) return;

    /* Katman görüntünün KARDEŞİ, mutlak konumlu — esnek düzenin
     * dışında kaldığı için `app.js`in kutu yerleşimine karışmıyor.
     * `pointer-events: none`: altındaki görüntüyü sürüklemeyi
     * engellemesin; kutular kendi üzerlerinde `all` diyor. */
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.cssText = "position:absolute;pointer-events:none;z-index:1";
    kutu.appendChild(svg);

    const turKutu = document.createElement("input");
    turKutu.type = "text";
    turKutu.placeholder = "tür";
    turKutu.title = "Kesitlerin kaydedileceği tür (örn. maydanoz)";
    turKutu.style.cssText = "width:68px;min-width:0;font:inherit;padding:0 4px;"
      + "background:transparent;color:inherit;border:1px solid currentColor;"
      + "border-radius:4px;opacity:.7";
    try { turKutu.value = localStorage.getItem(TUR_ANAHTAR) || ""; }
    catch (h) { /* boş */ }
    turKutu.addEventListener("pointerdown", (o) => o.stopPropagation());

    const dugmeYap = (im, baslik, islev) => {
      const d = document.createElement("button");
      d.type = "button";
      d.className = "kapat";
      d.textContent = im;
      d.title = baslik;
      d.setAttribute("aria-label", baslik);
      d.addEventListener("click", (o) => { o.stopPropagation(); islev(); });
      return d;
    };
    const kDugme = dugmeYap("⬓", "Seçili kutuların kesitlerini kaydet",
                            () => kesitKaydet(ad));
    const tDugme = dugmeYap("⊡", "Toprağı bul — ilgi alanını topraktan çıkarır",
                            () => toprakBul(ad));

    const dugme = document.createElement("button");
    dugme.type = "button";
    dugme.className = "kapat";
    dugme.textContent = "◎";
    dugme.title = "Lekeleri bul — sonuç görüntünün üstüne çizilir, "
                + "makine kımıldayınca silinir";
    dugme.setAttribute("aria-label", "Lekeleri bul");
    dugme.addEventListener("click", (o) => {
      o.stopPropagation();
      yuzendeCozumle(ad);
    });
    // Ölçek/büyüt/kapat düğmelerinin SOLUNA: onlar kutunun kendi
    // penceresini yönetiyor, bunlar görüntüyle ilgili — gruplar ayrı.
    [dugme, tDugme, kDugme, turKutu].forEach(
      (e2) => araclar.insertBefore(e2, araclar.firstChild));

    YUZEN.set(ad, { kutu, svg, dugme, turKutu, im: img,
                    secili: new Set(), ham: null, sonuc: null, konum: null });

    /* HİZALAMA. Görüntünün kutusu ölçek düğmesi, "ekrana sığdır" ve
     * pencere boyuyla değişiyor; katman her seferinde yeniden oturuyor.
     * `ResizeObserver` üçünü de tek yerden yakalıyor. */
    katmanHizala(ad);
    img.addEventListener("load", () => { katmanHizala(ad); yuzendeCiz(ad); });
    if (window.ResizeObserver) {
      const g = new ResizeObserver(() => katmanHizala(ad));
      g.observe(img);
      g.observe(kutu);
    }

    /* SHIFT + SÜRÜKLE: ilgi alanını elle çiz. Shift şart — sade
     * sürükleme kutuyu taşıyor. Sıfıra yakın dikdörtgen ROI'yi kaldırır.
     * ROI varken bir köşenin yakınında başlarsan O KÖŞE taşınır. */
    let suru = null;
    svg.style.touchAction = "none";
    kutu.addEventListener("pointerdown", (o) => {
      if (!o.shiftKey) return;
      const n = roiNokta(ad, o);
      if (!n) return;
      o.preventDefault(); o.stopPropagation();
      suru = { bas: n, kose: roiKose(ad, n) };
    });
    kutu.addEventListener("pointermove", (o) => {
      if (!suru) return;
      const n = roiNokta(ad, o);
      if (n) yuzendeCiz(ad, gecici(ad, suru, n));
    });
    kutu.addEventListener("pointerup", (o) => {
      if (!suru) return;
      const n = roiNokta(ad, o) || suru.bas;
      const d = gecici(ad, suru, n);
      const kose = suru.kose;
      suru = null;
      if (!d) { yuzendeCiz(ad); return; }
      const xs = d.k.map((p) => p[0]), ys = d.k.map((p) => p[1]);
      const kucuk = (Math.max.apply(null, xs) - Math.min.apply(null, xs)) < 0.02
                 || (Math.max.apply(null, ys) - Math.min.apply(null, ys)) < 0.02;
      if (kose < 0 && kucuk) {
        ROI.delete(ad);
        roiKaydet();
        const t0 = roiTazele(ad);
        yuzendeCiz(ad);
        notYaz(ad, "ilgi alanı kaldırıldı — bütün kare taranıyor"
          + (t0 ? ` · ${(t0.lekeler || []).length} leke` : ""));
        return;
      }
      ROI.set(ad, d);
      roiKaydet();
      const t = roiTazele(ad);
      yuzendeCiz(ad);
      notYaz(ad, (kose >= 0 ? "köşe taşındı" : "ilgi alanı kuruldu")
        + (t ? ` · ${(t.lekeler || []).length} leke`
             + (t.roi_elenen ? `, dışarıda ${t.roi_elenen} elendi` : "") : ""));
    });

    /* KUTU SEÇİMİ. Kesit kaydederken hangi lekenin hangi türe ait
     * olduğunu ancak kullanıcı bilir; tıklanan kutu seçilir. Olay
     * katmana bağlanıyor (delegasyon): çizim her tazelemede baştan
     * yazılıyor, tek tek dinleyici bağlamak sızdırırdı. */
    svg.addEventListener("click", (o) => {
      if (o.shiftKey) return;
      const no = o.target && o.target.getAttribute
        ? o.target.getAttribute("data-no") : null;
      if (no === null) return;
      const k = YUZEN.get(ad);
      if (!k) return;
      const i = Number(no);
      if (k.secili.has(i)) k.secili.delete(i); else k.secili.add(i);
      yuzendeCiz(ad);
      notYaz(ad, `${k.secili.size} kutu seçili`
        + (k.secili.size ? " — tür yazıp ⬓ ile kaydedin" : ""));
    });
  }

  async function yuzendeCozumle(ad) {
    const kayit = YUZEN.get(ad);
    const p = P();
    if (!kayit || !p || !p.apiIste) return;
    if (kayit.dugme.disabled) return;
    kayit.dugme.disabled = true;
    kayit.dugme.textContent = "…";
    // Çözümlemenin ait olduğu konum, İSTEK GÖNDERİLMEDEN ÖNCE alınıyor:
    // sonra almak, gidiş-dönüş sırasında başlayan bir hareketi
    // kaçırmak olurdu.
    const konum = konumImzasi();
    try {
      const y = await p.apiIste("/api/leke/bul", {
        method: "POST",
        body: JSON.stringify({ kamera: ad, ayar: ayarTopla() }),
      });
      kayit.ham = y;
      kayit.sonuc = roiUygula(ad, y);
      kayit.konum = konum;
      kayit.secili.clear();
      yuzendeCiz(ad);
      notYaz(ad, `${(kayit.sonuc.lekeler || []).length} leke`
        + (kayit.sonuc.roi_elenen ? ` · dışarıda ${kayit.sonuc.roi_elenen} elendi` : "")
        + (y.sebep ? ` — ${y.sebep}` : ""));
    } catch (hata) {
      kayit.ham = null;
      kayit.sonuc = null;
      yuzendeCiz(ad);
      notYaz(ad, "çözümleme başarısız: " + ((hata && hata.message) || hata));
    } finally {
      kayit.dugme.disabled = false;
      kayit.dugme.textContent = "◎";
    }
  }

  function notYaz(ad, metin) {
    const kayit = YUZEN.get(ad);
    if (!kayit) return;
    const not = kayit.kutu.querySelector('[data-rol="not"]');
    if (!not) return;
    not.textContent = metin || "";
    not.classList.toggle("gizli", !metin);
  }

  function yuzendeCiz(ad, roiGecici) {
    const kayit = YUZEN.get(ad);
    if (!kayit) return;
    katmanHizala(ad);
    const y = kayit.sonuc;
    const kare = (y && y.kare_px) || kayit.kareOlcu || null;
    const r0 = roiGecici || ROI.get(ad);
    if (!kare || !kare[0] || !kare[1]) { kayit.svg.innerHTML = ""; return; }
    kayit.kareOlcu = kare;
    kayit.svg.setAttribute("viewBox", `0 0 ${kare[0]} ${kare[1]}`);
    const kalinlik = Math.max(2, Math.round(kare[0] / 250));
    const r = Math.max(3, Math.round(kare[0] / 200));
    /* KAYMAYI GİZLEMİYORUZ. Sürekli kipte sonuç aralık kadar geriden
     * geliyor; makine o sırada yol aldıysa kutular canlı görüntüyle
     * hizalı DEĞİL. Soluklaştırmak bunu söylemenin en sessiz ama
     * görünür yolu — kutuların doğru yerde olduğunu sanmak en kötü
     * hata olurdu. */
    const kayma = kaymaMm(kayit.konum);
    kayit.svg.style.opacity = kayma > KAYMA_SINIRI_MM ? "0.35" : "1";

    /* İLGİ ALANI — kesikli, köşelerinde tutamak. Kutuların ALTINDA
     * çiziliyor ki tıklamayı çalmasın. */
    let ic = "";
    if (r0 && Array.isArray(r0.k) && r0.k.length >= 3) {
      const nk = r0.k.map((n) => (n[0] * kare[0]) + "," + (n[1] * kare[1])).join(" ");
      ic += `<polygon points="${nk}" fill="none" stroke="#4da3ff"`
          + ` stroke-width="${kalinlik}"`
          + ` stroke-dasharray="${kalinlik * 3} ${kalinlik * 2}"/>`
          + r0.k.map((n) => `<circle cx="${n[0] * kare[0]}" cy="${n[1] * kare[1]}"`
              + ` r="${kalinlik * 2.5}" fill="#4da3ff" fill-opacity="0.5"/>`).join("");
    }

    /* KUTULAR. `pointer-events="all"` kutunun İÇİNİ de tıklanabilir
     * yapıyor (dolgu olmasa bile) — ölçüldü; katman `pointer-events:
     * none` olduğu hâlde şekil `all` derse olayı alıyor. Seçili kutu
     * sarı ve kalın: renk körlüğünde de kalınlık ayırt ediyor. */
    const secili = kayit.secili || new Set();
    ic += (y && y.lekeler || []).map((l, i) => {
      const [x1, y1, x2, y2] = l.kutu || [0, 0, 0, 0];
      const s2 = secili.has(i);
      const renk = s2 ? "#ffd166" : "#ff4d4d";
      return `<rect data-no="${i}" pointer-events="all" x="${x1}" y="${y1}"
                width="${x2 - x1}" height="${y2 - y1}" fill="none"
                stroke="${renk}" stroke-width="${s2 ? kalinlik * 2 : kalinlik}"/>
              <circle data-no="${i}" pointer-events="all" cx="${l.x}" cy="${l.y}"
                r="${r}" fill="${renk}"/>`;
    }).join("");
    kayit.svg.innerHTML = ic;
  }

  function yuzenleriSil(sebep) {
    YUZEN.forEach((kayit, ad) => {
      if (!kayit.sonuc) return;
      kayit.ham = null;
      kayit.sonuc = null;
      kayit.konum = null;
      if (kayit.secili) kayit.secili.clear();
      yuzendeCiz(ad);
      notYaz(ad, sebep);
    });
  }

  function ayarTopla() {
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
    const birlestir = sayi("#leke-birlestir");
    if (birlestir !== null && birlestir >= 0) ayar.birlestir_orani = birlestir;
    return ayar;
  }

  /* Saat: hem yeni yüzen kutuları donatıyor hem hareketi izliyor.
   * MutationObserver yerine yoklama, çünkü `app.js` kutuları durum
   * paketiyle (saniyede iki kez) yeniden kurabiliyor ve gözlemci o
   * akışta gereksiz yere sık tetikleniyordu. Yarım saniye, hareketi
   * kaçırmayacak kadar sık. */
  function saat() {
    yuzenleriTara();
    wsBagla();
    /* Kamera listesi ajan bağlanınca geliyor ve bölüm ondan önce
     * kurulmuş oluyor: seçicide "(kamera yok)" yazıp öylece kalıyordu.
     * Seçiciye dokunulunca tazelemek yetmedi — kullanıcı önce o yazıyı
     * görüyor ve kameraların gelmediğini sanıyor. */
    if (!$("#leke-kamera") || !$("#leke-kamera").value) kamerayiDoldur();

    const simdi = konumImzasi();
    const oncekiImza = sonImza;
    sonImza = simdi;
    if (!simdi) return;

    if (otoMod === "surekli") {
      // Sürekli kipte sonuç zaten akıyor; silmek yerine kaymayı
      // soluklaştırarak gösteriyoruz.
      YUZEN.forEach((kayit, ad) => { if (kayit.sonuc) yuzendeCiz(ad); });
      return;
    }

    if (oncekiImza && !konumAyni(oncekiImza, simdi)) {
      // HAREKET BAŞLADI. Ekrandaki kutular başka bir konuma ait;
      // durmalarına izin vermek yanlış yeri göstermek olurdu.
      durgunBasi = 0;
      yuzenleriSil("makine kımıldadı — kutular geçersiz");
      return;
    }

    if (!otoAcik || otoCalisiyor) return;
    const t = Date.now() / 1000;
    if (!durgunBasi) { durgunBasi = t; return; }
    if (t - durgunBasi < DURGUNLUK_SN) return;

    // Bu durakta zaten çözümlediysek tekrar etmiyoruz: makine
    // beklerken saniyede bir kare çekmek ağı boşuna yorardı.
    const bekleyen = [...YUZEN.entries()].filter(
      ([, k]) => !k.sonuc && !k.dugme.disabled
                 && !k.kutu.classList.contains("gizli"));
    if (!bekleyen.length) return;
    otoCalisiyor = true;
    Promise.all(bekleyen.map(([ad]) => yuzendeCozumle(ad)))
      .finally(() => { otoCalisiyor = false; });
  }

  /* ---------------------------------------------------------------- 
   * SÜREKLİ KİP — çözümleme ajanda, kare ağdan geçmiyor.
   *
   * "Makine durunca" kipi her durakta 4K kareyi panele getiriyor
   * (~1,5 MB) ve bu makine Tailscale üzerinden izleniyor. Sürekli kipte
   * çözümleme ajanda yapılıyor ve durum paketiyle yalnız kutu
   * koordinatları geliyor — birkaç KB. Kare zaten ajanda: canlı akış
   * açıkken `tam_kare` bellekteki kareyi veriyor.
   *
   * BEDELİ GİZLENMİYOR: sonuç aralık kadar geriden geliyor. Makine
   * hareket ederken kutular geride kalıyor ve bunu soluklaştırarak
   * söylüyoruz — kutuların canlı görüntüyle hizalı olduğunu sanmak, en
   * kötü hata olurdu.
   * ---------------------------------------------------------------- */

  //: Çözümlemenin yapıldığı konum ile şimdiki konum bu kadar ayrışınca
  //: kutular soluklaşıyor. 5 mm: bir filizin yarıçapı kadar — bundan
  //: fazla kayma kutuyu yanlış yaprağa oturtmaya yeter.
  const KAYMA_SINIRI_MM = 5.0;
  let otoMod = "kapali";
  let wsBagli = null;
  let eslestirildi = false;

  function wsBagla() {
    const p = P();
    const ws = p && p.S && p.S.ws;
    if (!ws || ws === wsBagli) return;
    /* `addEventListener` kullanılıyor, `onmessage` DEĞİL: app.js kendi
     * `onmessage`ini kurmuş durumda ve onu ezmek panelin tamamını
     * sağır bırakırdı. İki dinleyici yan yana çalışıyor. */
    wsBagli = ws;
    ws.addEventListener("message", (olay) => {
      let m = null;
      try { m = JSON.parse(olay.data); } catch { return; }
      // Ham durumu saklıyoruz: `app.js` durum paketinin tamamını `S`e
      // yazmıyor ve bu bölümün ihtiyacı olan alanlar orada yok.
      const p3 = P();
      if (m && m.durum && p3 && p3.S) {
        p3.S.sonDurumHam = m.durum;
        ajandanEslestir();
      }
      if (otoMod !== "surekli") return;
      const d = m && (m.durum || null);
      if (!d || !d.lekeler) return;
      surekliGeldi(d.lekeler);
    });
  }

  /** Ajandaki kipi panele yansıtır — panel yenilendiğinde şart.
   *
   * Seçici her yüklemede "kapalı" başlıyor ama ajandaki döngü dönmeye
   * devam ediyor. Panelde kapalı yazarken bir çekirdeğin bir kısmını
   * yiyen bir döngü, fark edilmesi en zor israf türü. */
  function ajandanEslestir() {
    if (eslestirildi) return;
    const p = P();
    const d = (p && p.S && p.S.sonDurumHam) || null;
    const bilgi = d && d.leke_surekli;
    if (!bilgi) return;
    eslestirildi = true;
    if (!bilgi.acik) return;
    const sec = $("#leke-oto-mod");
    if (sec) sec.value = "surekli";
    otoMod = "surekli";
    const ar = $("#leke-aralik");
    if (ar && bilgi.aralik_sn) ar.value = bilgi.aralik_sn;
    const durum = $("#leke-oto-durum");
    if (durum) durum.textContent = "ajanda zaten çalışıyordu";
  }

  function surekliGeldi(lekeler) {
    YUZEN.forEach((kayit, ad) => {
      const y = lekeler[ad];
      if (!y) {
        // Ajan o kamera için sonuç vermiyor (akışı kapalı, kare
        // eskimiş). Eski kutuları bırakmak "şu an böyle görünüyor"
        // demek olurdu.
        if (kayit.sonuc) { kayit.ham = null; kayit.sonuc = null; yuzendeCiz(ad); }
        return;
      }
      kayit.ham = y;
      kayit.sonuc = roiUygula(ad, y);
      kayit.konum = y.konum || null;
      kayit.secili.clear();
      yuzendeCiz(ad);
      const adet = (kayit.sonuc.lekeler || []).length;
      // Sebep tek başına geldiyse (akış kapalı, kare eskimiş) sayı
      // yazmıyoruz: "0 leke" bunu bitki yokluğu gibi gösterirdi.
      notYaz(ad, y.sure_ms == null && y.sebep
        ? y.sebep
        : `${adet} leke · ${y.sure_ms ?? "?"} ms`
          + (y.sebep ? ` — ${y.sebep}` : ""));
    });
  }

  /** Çözümlemenin yapıldığı konum ile şimdiki konum arasındaki mesafe. */
  function kaymaMm(konum) {
    const simdi = konumImzasi();
    if (!konum || !simdi || konum.x == null || konum.y == null) return 0;
    const dx = (+konum.x) - simdi.x;
    const dy = (+konum.y) - simdi.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  async function modUygula(mod) {
    otoMod = mod;
    otoAcik = (mod === "durunca");
    durgunBasi = otoAcik ? (Date.now() / 1000 - DURGUNLUK_SN) : 0;
    const p = P();
    const durum = $("#leke-oto-durum");
    if (mod !== "surekli") {
      yuzenleriSil("");
      if (durum) durum.textContent = "";
    }
    if (!p || !p.apiIste) return;
    // Sürekli kip ajanda çalışıyor; kapanırken de haber vermek şart,
    // yoksa panel kapansa bile döngü dönmeye devam eder.
    const aralik = sayi("#leke-aralik");
    try {
      await p.apiIste("/api/komut", {
        method: "POST",
        body: JSON.stringify({
          ad: "leke_surekli",
          arg: { acik: mod === "surekli",
                 aralik_sn: (aralik && aralik >= 0.5) ? aralik : 2,
                 ayar: ayarTopla() },
        }),
      });
      if (durum && mod === "surekli") {
        /* CANLI AKIŞ ŞART. Sürekli kip akışın karesini kullanıyor;
         * akış kapalıyken ajan kameradan yeni çekim isterdi ve bu
         * periyodik kare döngüsüyle çakışırdı. Kipi açıp hiçbir şey
         * olmamasındansa nedenini burada söylüyoruz. */
        const kapali = kameralar().filter((k) => !canliMi(k.ad)).map((k) => k.etiket);
        durum.textContent = kapali.length
          ? `ajanda açık — ama ${kapali.join(", ")} canlı akışı kapalı, `
            + "kamera kartından açın"
          : "ajanda çalışıyor";
      }
    } catch (hata) {
      if (durum) durum.textContent = "açılamadı: " + ((hata && hata.message) || hata);
      gunluk("Sürekli çözümleme açılamadı: " + ((hata && hata.message) || hata), "hata");
    }
  }

  function otoKur() {
    const sec = $("#leke-oto-mod");
    if (sec) sec.addEventListener("change", () => modUygula(sec.value));
    // Aralık ya da ayar değişirse sürekli kipe yeniden bildiriyoruz:
    // ajandaki değerler panelde yazanla ayrışmasın.
    ["#leke-aralik", "#leke-esik-payi", "#leke-en-kucuk",
     "#leke-islem-px", "#leke-ton-alt", "#leke-ton-ust",
     // Birleştirme bu listeye SONRADAN eklendi ve unutulmuştu: sürekli
     // kipte değeri değiştirmek ajana ulaşmıyor, sonuç değişmiyordu.
     "#leke-birlestir"].forEach((s2) => {
      const el = $(s2);
      if (el) el.addEventListener("change", () => {
        if (otoMod === "surekli") modUygula("surekli");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kur);
  } else {
    kur();
  }
})();
