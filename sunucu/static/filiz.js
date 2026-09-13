/* Filiz konumları — panel tarafı.
 *
 * AYRI DOSYA, `etiket.js` ile aynı gerekçe: `app.js` ve `index.html`
 * başka bir oturumda sürekli değişiyor, oraya blok eklemek her yamada
 * çakışma demek. Buraya yalnız boş bir kap giriyor.
 *
 * NE YAPIYOR. Üst kameranın taze karesinde yeşili topraktan ayırıyor ve
 * bulduğu her fidenin YATAK KOORDİNATINI yazıyor. Makineyi hareket
 * ettirmiyor: koordinatı okuyup elle üstüne gidip teyit etmek
 * kullanıcının işi. Ölçen ile hareket eden aynı düğme olursa, yanlış
 * bir ölçüm doğrudan yanlış bir harekete dönüşür.
 *
 * HANGİ MODELLE ÇEVRİLDİĞİ YAZIYOR. Perspektifli harita ile ölçek+dönme
 * arasında sahada 40 mm fark ölçüldü; hangi sayıya bakıldığı görünmeli.
 */
(function () {
  "use strict";

  const KAP = "filiz-bolum";
  let son = null;

  const $ = (s) => document.querySelector(s);
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));

  function P() { return window.Panel || null; }

  function gunluk(metin, seviye) {
    const p = P();
    if (p && p.gunluk) p.gunluk(metin, seviye);
  }

  /** Etiket bölümüyle AYNI kamerayı işliyor: ikisi de üst kamerayı
   *  konuşuyor ve iki ayrı seçici, bir gün ayrışacak iki seçim demekti. */
  function seciliKamera() {
    const sec = $("#etiket-kamera");
    return (sec && sec.value) || "ust";
  }

  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    kap.innerHTML = `
      <details class="etiket-blok">
        <summary>Filizlerin konumu</summary>
        <p class="ikincil">
          Taze karede yeşili topraktan ayırıp her fidenin <b>yatak
          koordinatını</b> yazıyor. Makine hareket etmiyor — koordinatı
          okuyup elle üstüne gidin, teyit böyle olur.
          <b>Tür tanımıyoruz</b>: yeşil olan her şey listeye girer.
        </p>

        <div class="satir-8 alt-hizali">
          <button class="dugme birincil" id="d-filiz-bul">Filizleri bul</button>
          <div class="alan">
            <label for="filiz-esik">Yeşil eşiği</label>
            <!-- ÜST SINIR 0.4. Alan 0.9'a kadar izin veriyordu ve sahada
                 0.06 yerine 0.6 yazıldı: eşik o kadar yükselince hiçbir
                 piksel geçmiyor, çalıştırma boşa gidiyor. Kullanılabilir
                 aralık 0.02-0.25 civarı; 0.4 zaten fazlasıyla geniş. -->
            <input type="number" id="filiz-esik" step="0.01" min="0.01" max="0.4"
                   placeholder="0.12">
          </div>
          <div class="alan">
            <label for="filiz-cap">En küçük fide (mm)</label>
            <input type="number" id="filiz-cap" step="1" min="1" max="200"
                   placeholder="8">
          </div>
          <div class="alan">
            <label for="filiz-birlestir">Birleştirme (mm)</label>
            <input type="number" id="filiz-birlestir" step="1" min="0" max="200"
                   placeholder="25">
          </div>
          <div class="alan">
            <label for="filiz-azami">En büyük fide (mm)</label>
            <input type="number" id="filiz-azami" step="5" min="10" max="400"
                   placeholder="60">
          </div>
        </div>
        <p class="alt-not">Filizler bulunamıyorsa <b>en küçük fide</b>yi
          düşürün; yeşil soluksa <b>eşiği de düşürün</b> — eşik yükseldikçe
          daha az piksel yeşil sayılıyor. Boyut <b>milimetre</b>:
          piksel cinsinden yazıldığında çözünürlüğü yükseltmek küçük fideyi
          bulmuyordu — eşiğin fiziksel karşılığı her çözünürlükte aynı
          kalıyordu. Fesleğen kotiledonu 8-10 mm. <b>Birleştirme</b>: bu
          mesafeden yakın lekeler tek fide sayılıyor — bir filizin iki yaprağı
          ayrı lekelenip sayımı ikiye katlamasın diye. <b>En büyük fide</b>:
          birleştirmenin zincirlenmesini durduran sınır. Onsuz A–B yakın,
          B–C yakın diye A ile C çok uzakta olsa bile tek kümeye giriyor ve
          yoğun kırıntıda bütün kare tek "fide" oluyor.</p>

        <div id="filiz-hata" class="uyari-kutu gizli"></div>
        <div id="filiz-sonuc" class="gomulu gizli"></div>
        <div class="etiket-onizleme gizli" id="filiz-onizleme">
          <img id="filiz-kare" alt="Çözümlenen kare">
          <canvas id="filiz-tuval"></canvas>
        </div>
        <div id="filiz-secim" class="gizli">
          <p class="alt-not">
            Önizlemeye tıklayınca o noktanın <b>kare pikseli</b> yazılıyor —
            ızgara kalibrasyonunda köşe köşe girilen sayı bu. Tıklanan
            nokta ölçekli görüntünün değil, çözümlenen TAM çözünürlüklü
            karenin pikseli.
          </p>
          <div class="satir">
            <span class="mono" id="filiz-secim-liste">—</span>
            <button id="d-filiz-secim-kopya">Kopyala</button>
            <button id="d-filiz-secim-temizle">Temizle</button>
            <button id="d-filiz-kare-kaydet">Kareyi Pi'ye kaydet</button>
          </div>
          <p class="alt-not mono" id="filiz-kare-yol"></p>
        </div>
      </details>`;
    $("#d-filiz-bul").onclick = bul;
    $("#filiz-onizleme").addEventListener("click", pikselSec);
    $("#d-filiz-secim-kopya").onclick = () => {
      const m = secimler.map(([u, v]) => `${u},${v}`).join(" ");
      if (!m) return;
      if (navigator.clipboard) navigator.clipboard.writeText(m);
      gunluk(`✓ Köşe pikselleri kopyalandı: ${m}`, "ok");
    };
    $("#d-filiz-secim-temizle").onclick = () => { secimler = []; secimYaz(); };
    /* Izgara aracı bir JPEG dosyası istiyor ve o dosyanın, köşelerini
     * tıkladığınız kareyle AYNI kare olması gerekiyor: başka bir
     * çözünürlük girdiğiniz köşe piksellerini sessizce geçersiz kılar. */
    $("#d-filiz-kare-kaydet").onclick = async () => {
      const p = P();
      if (!p) return;
      const d = $("#d-filiz-kare-kaydet");
      d.disabled = true;
      try {
        const c = await p.apiIste("/api/bitkiolcum/kare_kaydet", {
          method: "POST", body: JSON.stringify({ kamera: seciliKamera() }),
        });
        $("#filiz-kare-yol").textContent = c.yol || "";
        gunluk(`✓ Kare Pi'ye yazıldı: ${c.yol}`, "ok");
      } catch (h) {
        hataYaz(h.message || String(h));
      } finally {
        d.disabled = false;
      }
    };
  }

  /* KÖŞE PİKSELİ OKUMA. `gorus.izgara_arac` dörtgenin dört köşesinin
   * piksel konumunu istiyor ve bu sayıyı bir yerden okumak gerekiyor.
   * Kareyi bilgisayara indirip bir resim programında imleç konumuna
   * bakmak işe yarıyordu ama her denemede scp turu demekti; önizleme
   * zaten burada duruyor.
   *
   * ÖLÇEK DÜZELTMESİ ŞART: img ekrana sığacak kadar küçültülmüş
   * gösteriliyor, aracın istediği sayı ise TAM çözünürlüklü karenin
   * pikseli. Ekran pikselini olduğu gibi vermek, 4K karede dört kat
   * yanlış köşe demek olurdu. */
  let secimler = [];

  function pikselSec(olay) {
    if (!son || !son.genislik_px) return;
    const im = $("#filiz-kare");
    const r = im.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const u = Math.round((olay.clientX - r.left) * (son.genislik_px / r.width));
    const v = Math.round((olay.clientY - r.top) * (son.yukseklik_px / r.height));
    if (u < 0 || v < 0 || u > son.genislik_px || v > son.yukseklik_px) return;
    secimler.push([u, v]);
    if (secimler.length > 4) secimler.shift();   // dörtgen dört köşe
    secimYaz();
  }

  function secimYaz() {
    const k = $("#filiz-secim-liste");
    if (!k) return;
    k.textContent = secimler.length
      ? secimler.map(([u, v]) => `${u},${v}`).join("  ")
      : "—";
    tuvalCiz();
  }

  function hataYaz(metin) {
    const k = $("#filiz-hata");
    if (!k) return;
    k.textContent = metin || "";
    k.classList.toggle("gizli", !metin);
  }

  async function bul() {
    const p = P();
    if (!p) return;
    const d = $("#d-filiz-bul");
    d.disabled = true;
    hataYaz("");
    try {
      const govde = { kamera: seciliKamera() };
      const e = Number($("#filiz-esik").value);
      const a = Number($("#filiz-cap").value);
      const b = $("#filiz-birlestir").value;
      if (Number.isFinite(e) && e > 0) govde.esik = e;
      if (Number.isFinite(a) && a > 0) govde.en_kucuk_cap_mm = a;
      if (b !== "" && Number.isFinite(Number(b))) govde.birlestir_mm = Number(b);
      const z = Number($("#filiz-azami").value);
      if (Number.isFinite(z) && z > 0) govde.azami_fide_mm = z;

      son = await p.apiIste("/api/kamera/filiz/bul", {
        method: "POST", body: JSON.stringify(govde),
      });
      yaz();
      gunluk(`✓ ${(son.fideler || []).length} filiz bulundu`, "ok");
    } catch (h) {
      son = null;
      $("#filiz-sonuc").classList.add("gizli");
      $("#filiz-onizleme").classList.add("gizli");
      // Önizleme gidince köşe seçici de gitmeli: altında kare olmayan
      // bir "tıklayıp piksel okuyun" kutusu, tıklanacak yer arattırıyor.
      $("#filiz-secim").classList.add("gizli");
      hataYaz(h.message || String(h));
    } finally {
      d.disabled = false;
    }
  }

  function yaz() {
    const k = $("#filiz-sonuc");
    if (!k || !son) return;

    // KOORDİNAT YOKSA TABLO DA YOK. Yarısı piksel yarısı milimetre bir
    // liste, okuyanın hangisinin ne olduğunu bilemeyeceği bir listedir.
    if (son.ret) {
      k.innerHTML = `<div class="etiket-satir uyari"><span>Koordinat yok</span>
        <span>${kacisli(son.ret)}</span></div>`;
      k.classList.remove("gizli");
      onizleme();
      return;
    }

    const fideler = son.fideler || [];
    const model = son.yontem === "harita"
      ? `<b>perspektifli harita</b>`
      : `<b>ölçek + dönme</b> <span class="uyari">— kamera eğik bakıyorsa
         bu model sapıyor; dört etiketle kalibre edilirse harita devreye
         girer</span>`;

    let g = `<div class="etiket-satir"><span>Kamera</span>
        <span><b>${kacisli(son.kamera)}</b> · ${son.genislik_px}×${son.yukseklik_px}</span></div>
      <div class="etiket-satir"><span>Çeviri modeli</span><span>${model}</span></div>
      <div class="etiket-satir"><span>Bulunan</span>
        <span><b>${fideler.length}</b> filiz · ${son.leke_sayisi} leke
        (ham ${son.ham_leke}) · yeşil oran ${(son.yesil_oran * 100).toFixed(1)}%</span></div>
      <div class="etiket-satir"><span>Eşikler</span>
        <span>yeşil ${son.esik} · en az <b>${son.en_az_piksel}</b> piksel${
          son.en_az_kendiliginden
            ? ` (≈ ${son.en_kucuk_cap_mm} mm çapında leke)` : ""}</span></div>
      <div class="etiket-satir"><span>Alan dışı</span>
        <span><b>${son.alan_disi || 0}</b> leke dikim alanının dışında
          kaldığı için elendi</span></div>
      ${kadrajSatiri()}
      ${kaliteSatiri()}
      ${kapiSatiri()}`;

    if (!fideler.length) {
      /* SABİT ÖĞÜT YERİNE ÖLÇÜLMÜŞ GEREKÇE. "Eşiği düşürün" her
       * durumda doğru değil: kare aşırı pozlanmışsa yaprak da beyaz
       * çıkıyor ve eşikle oynamak hiçbir işe yaramıyor. Sunucu neyin
       * engellediğini sırayla ölçüyor; varsa onu yazıyoruz. */
      g += `<div class="etiket-satir uyari"><span>—</span>
        <span>${son.tani ? kacisli(son.tani)
          : "Hiç yeşil leke kalmadı. <b>En küçük fide</b>yi düşürün ya da "
            + "<b>eşiği</b> aşağı çekin."}</span></div>`;
    } else {
      g += `<div class="veri-kutu"><table class="veri filiz-tablo">
        <thead><tr><th>#</th><th>X (mm)</th><th>Y (mm)</th><th>Çap (mm)</th>
        <th>Piksel</th><th>Parça</th></tr></thead><tbody>`
        + fideler.map((f) => `<tr>
            <td>${f.no}</td>
            <td class="mono"><b>${f.x}</b></td>
            <td class="mono"><b>${f.y}</b></td>
            <td class="mono">${f.cap_mm}</td>
            <td class="mono">${f.alan_px}</td>
            <td>${f.parca > 1 ? f.parca + " leke" : "—"}</td>
          </tr>`).join("")
        + `</tbody></table></div>
        <p class="alt-not">Teyit için bir satırın X/Y'sini Sür sekmesindeki
          <b>Seçtiğiniz başı bu noktaya götür</b> alanına yazıp
          <b>Nem probu</b>yu gönderin — <b>Konuma git</b> değil, o makineyi
          götürür ve başın kayması hesaba girmez. Sapma kalibrasyonun hatası
          kadar olmalı; daha fazlaysa haber verin.</p>`;
    }
    k.innerHTML = g;
    k.classList.remove("gizli");
    onizleme();
  }

  /** Kadrajın ne kadarı dikim alanına düşüyor — "kamera yatağa mı
   *  bakıyor" sorusunun ölçülebilir hâli.
   *
   * Sıfır çıkması kesin: bu kamera yatağı hiç görmüyor, hangi eşik
   * konursa konsun fide bulunamaz. Yüksek çıkması kameranın doğru
   * baktığını KANITLAMIYOR — kamera fiziksel olarak çevrildiyse
   * kalibrasyon eskimiştir ve eski sayılar kadrajı hâlâ yatağın üstünde
   * gösterir. O yüzden "kalibrasyona göre" diyoruz. */
  function kadrajSatiri() {
    if (!son.kadraj_alan_var || son.kadraj_oran == null) return "";
    const o = Number(son.kadraj_oran) * 100;
    const kotu = o < 5;
    return `<div class="etiket-satir${kotu ? " uyari" : ""}">
      <span>Kadraj</span>
      <span>kalibrasyona göre karenin <b>${o.toFixed(0)}%</b>'i dikim
        alanına düşüyor${kotu
          ? " — kamera yatağa bakmıyor ya da kalibrasyon eskimiş;"
            + " hiçbir eşik bu durumu düzeltmez"
          : ""}</span></div>`;
  }

  /** Karenin ölçülebilir olup olmadığı — parlaklık ve doyma.
   *
   * Eşiklerle oynamadan önce bakılacak yer burası: aşırı pozlanmış bir
   * karede yaprak da beyaz çıkıyor ve hiçbir eşik onu geri getirmiyor. */
  function kaliteSatiri() {
    const k = son.kare_kalite || {};
    if (!Number.isFinite(Number(k.parlaklik))) return "";
    const doymus = Number(k.doymus) || 0;
    return `<div class="etiket-satir"><span>Kare</span>
      <span>parlaklık <b>${Math.round(Number(k.parlaklik))}</b>/255 ·
        doymuş <b>${(doymus * 100).toFixed(1)}%</b></span></div>`;
  }

  /** Renk kapılarının ne kadar elediği — "yeşil bulunamadı"nın sebebi.
   *
   * `elenen` bir sayı değil, kapı başına oran veriyor: güçlü yeşil
   * sayılan piksellerin ne kadarını hangi kapı kesti. En çok kesen kapı
   * hangisiyse sorun oradadır; eşiği körlemesine denemek yerine
   * bakılacak yer burası. */
  function kapiSatiri() {
    const e = son.elenen || {};
    const ad = { mavi: "mavi", kirmizi: "kırmızı", exgr: "yeşil-kırmızı",
                 doygunluk: "doygunluk" };
    const parca = Object.keys(ad)
      .filter((k) => Number(e[k]) > 0)
      .sort((a, b) => Number(e[b]) - Number(e[a]))
      .map((k) => `${ad[k]} <b>${(Number(e[k]) * 100).toFixed(1)}%</b>`);
    if (!parca.length) return "";
    return `<div class="etiket-satir"><span>Renk kapıları</span>
      <span>${parca.join(" · ")}</span></div>`;
  }

  /** Kareyi ve bulunan kutuları üst üste çiziyor.
   *
   * Tuval, karenin KENDİ piksel ölçüsünde: `clientWidth` görünmeyen bir
   * sekmede sıfır dönüyor ve kutular sol üst köşeye yığılıyordu. */
  function onizleme() {
    const o = $("#filiz-onizleme");
    const im = $("#filiz-kare");
    const t = $("#filiz-tuval");
    if (!o || !im || !t || !son || !son.kare) return;
    im.onload = tuvalCiz;
    im.src = son.kare;
    // AYNI src YENIDEN YÜKLENMİYOR. Tıklanan köşeyi çizmek için
    // `onizleme`yi tekrar çağırmak yetmiyordu: tarayıcı değişmeyen bir
    // src'de `load` olayını bir daha vermiyor ve işaret hiç görünmüyordu.
    if (im.complete) tuvalCiz();
    o.classList.remove("gizli");
    $("#filiz-secim").classList.remove("gizli");
  }

  function tuvalCiz() {
    const im = $("#filiz-kare");
    const t = $("#filiz-tuval");
    if (!t || !im || !son) return;
    {
      t.width = son.genislik_px;
      t.height = son.yukseklik_px;
      const c = t.getContext("2d");
      c.clearRect(0, 0, t.width, t.height);
      c.lineWidth = Math.max(2, son.genislik_px / 400);
      c.font = `${Math.max(12, son.genislik_px / 45)}px system-ui, sans-serif`;
      (son.fideler || []).forEach((f) => {
        const [x1, y1, x2, y2] = f.kutu;
        c.strokeStyle = "#4caf50";
        c.strokeRect(x1, y1, x2 - x1, y2 - y1);
        const yazi = `${f.no}: ${f.x}, ${f.y}`;
        c.fillStyle = "rgba(0,0,0,.65)";
        const en = c.measureText(yazi).width + 8;
        c.fillRect(x1, Math.max(0, y1 - 20), en, 18);
        c.fillStyle = "#8ef08e";
        c.fillText(yazi, x1 + 4, Math.max(13, y1 - 6));
      });
      // Tıklanan köşeler: fide kutularından ayrı renk, sırayla numaralı.
      const r = Math.max(6, son.genislik_px / 250);
      secimler.forEach(([u, v], i) => {
        c.strokeStyle = "#ffd166";
        c.beginPath(); c.moveTo(u - r * 2, v); c.lineTo(u + r * 2, v);
        c.moveTo(u, v - r * 2); c.lineTo(u, v + r * 2); c.stroke();
        c.beginPath(); c.arc(u, v, r, 0, Math.PI * 2); c.stroke();
        c.fillStyle = "#ffd166";
        c.fillText(String(i + 1), u + r * 2 + 4, v - 4);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(kur, 0));
  } else {
    setTimeout(kur, 0);
  }
})();
