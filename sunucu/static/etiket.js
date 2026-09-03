/* AprilTag kalibrasyonu — panel tarafı.
 *
 * AYRI DOSYA, BİLİNÇLİ. `app.js` ve `index.html` başka bir oturumda sürekli
 * değişiyor; oraya blok eklemek her yamada çakışma demek. Bu dosya kendi
 * arayüzünü kendi kuruyor ve `index.html`e yalnız boş bir kap giriyor.
 * Sunucu tarafında `etiket.py`nin ayrı yönlendirici kurmasıyla aynı gerekçe.
 *
 * NE YAPIYOR. Kalibrasyonu tıklamadan çıkarıyor: karedeki AprilTag'lerin
 * köşeleri alt piksel hassasiyetiyle bulunuyor. Bir etiket ölçek veriyor;
 * koordinatı bilinen iki etiket ölçek + dönme + konum veriyor — sabit üst
 * kameranın karesini yatağın DOĞRU yerine koymanın tek yolu bu.
 *
 * TARAMA HİÇBİR ŞEYİ DEĞİŞTİRMİYOR. Önce bakıyorsunuz, beğenirseniz
 * kaydediyorsunuz. Kalibrasyon sessizce değişirse ölçüler sessizce kayar.
 */
(function () {
  "use strict";

  const KAP = "etiket-bolum";
  let son = null;              // son tarama sonucu
  let konumlar = { kenar_mm: 0, etiketler: {} };

  const $ = (s) => document.querySelector(s);
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));
  const sayi = (d, b = 2) => (Number.isFinite(Number(d)) ? Number(d).toFixed(b) : "—");

  function P() { return window.Panel || null; }

  /** Bu bölümün işlediği kamera — KENDİ seçicisinden.
   *
   * Önce kalibrasyon sekmelerindeki seçime bakıyordu ve sekme
   * bulunamayınca sessizce "uc"a düşüyordu: kullanıcı üst kamerayı
   * kalibre ettiğini sanırken uç kamerası taranıyor, sonuç da "karede
   * hiç etiket yok" oluyordu. Hangi kameranın tarandığı görünmediği
   * için sebebi de anlaşılmıyordu.
   *
   * Artık seçim burada, gözle görünüyor ve varsayılan da kör değil.
   */
  function seciliKamera() {
    const sec = $("#etiket-kamera");
    if (sec && sec.value) return sec.value;
    const d = document.querySelector("#kalib-sekmeler .kam-sekme.secili");
    return (d && d.dataset.kam) || "ust";
  }

  /** Seçiciyi paneldeki kamera listesinden dolduruyor. */
  async function kameralariYukle() {
    const sec = $("#etiket-kamera");
    if (!sec) return;
    let liste = Array.from(document.querySelectorAll("#kalib-sekmeler .kam-sekme"))
      .map((d) => ({ ad: d.dataset.kam, etiket: d.textContent.trim() }))
      .filter((k) => k.ad);
    if (!liste.length) {
      const p = P();
      try {
        const y = await p.apiIste("/api/durum");
        liste = ((y.durum || {}).kameralar || [])
          .map((k) => ({ ad: k.ad, etiket: k.etiket || k.ad }));
      } catch (h) { /* liste yoksa aşağıdaki yedek devreye giriyor */ }
    }
    if (!liste.length) liste = [{ ad: "ust", etiket: "Üst kamera" },
                                { ad: "uc", etiket: "Uç kamerası" }];
    const onceki = sec.value;
    sec.innerHTML = liste.map((k) =>
      `<option value="${kacisli(k.ad)}">${kacisli(k.etiket)}</option>`).join("");
    // SABİT KAMERA VARSAYILAN. Etiketler yatağa yapıştırılıyor ve onları
    // gören sabit kamera; hareketli uç kamerası kadraja ancak üstünden
    // geçerken alıyor.
    const sekme = document.querySelector("#kalib-sekmeler .kam-sekme.secili");
    sec.value = (liste.some((k) => k.ad === onceki) && onceki)
      || (sekme && sekme.dataset.kam)
      || (liste.find((k) => k.ad === "ust") || liste[0]).ad;
  }

  function gunluk(metin, seviye) {
    const p = P();
    if (p && p.gunluk) p.gunluk(metin, seviye);
  }

  /* ------------------------------------------------------------- arayüz */
  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    kap.innerHTML = `
      <details class="etiket-blok">
        <summary>AprilTag ile kalibre et</summary>
        <p class="ikincil">
          Etiketin dört köşesi matematiksel olarak tanımlı; yazılım onları
          alt piksel hassasiyetiyle buluyor, siz hiçbir yere tıklamıyorsunuz.
          <b>Bir etiket</b> ölçek veriyor. Koordinatı bilinen <b>iki etiket</b>
          ölçeğin yanında dönmeyi ve karenin yatağın neresine denk geldiğini
          de veriyor — sabit üst kamera için asıl gereken bu.
        </p>

        <div class="satir-8 alt-hizali">
          <div class="alan">
            <label for="etiket-kamera">Kamera</label>
            <select id="etiket-kamera"></select>
          </div>
          <div class="alan">
            <label for="etiket-kenar">Etiket kenarı (mm)</label>
            <input type="number" id="etiket-kenar" step="0.1" min="5" max="1000"
                   placeholder="örn. 60">
          </div>
          <button class="dugme" id="d-etiket-kenar-kaydet">Kenarı kaydet</button>
          <span class="alt-not">Bastığınız etiketin siyah karesini
            <b>kumpasla ölçün</b>, tasarım ölçüsünü değil — yazıcılar büzüşür
            ve bu sayı doğrudan ölçeği belirliyor.</span>
        </div>

        <h4 class="alt-baslik">Etiket konumları</h4>
        <p class="ikincil">Her etiketin merkezinin makine koordinatı. En kolay
          yol: probu etiketin ortasına götürüp <b>Şu anki konum</b>a basmak.</p>
        <div class="veri-kutu"><table class="veri">
          <thead><tr><th>Kimlik</th><th>X (mm)</th><th>Y (mm)</th><th></th></tr></thead>
          <tbody id="etiket-govde"></tbody>
        </table></div>
        <div class="satir-8">
          <button class="dugme" id="d-etiket-satir">Etiket ekle</button>
          <button class="dugme birincil" id="d-etiket-konum-kaydet">Konumları kaydet</button>
          <span class="etiket-iz gizli" id="etiket-kaydedildi"></span>
        </div>

        <h4 class="alt-baslik">Tara</h4>
        <div class="satir-8 alt-hizali">
          <button class="dugme birincil" id="d-etiket-tara">Etiketleri tara</button>
          <button class="dugme" id="d-etiket-uygula" disabled>Kalibrasyonu kaydet</button>
          <span class="alt-not">Tarama hiçbir şeyi değiştirmiyor; önce
            sonuca bakın.</span>
        </div>
        <div id="etiket-hata" class="uyari-kutu gizli"></div>
        <div id="etiket-sonuc" class="gomulu gizli"></div>
        <div class="etiket-onizleme gizli" id="etiket-onizleme">
          <img id="etiket-kare" alt="Taranan kare">
          <canvas id="etiket-tuval"></canvas>
        </div>
      </details>`;

    $("#d-etiket-satir").onclick = () => { satirEkle("", "", ""); };
    $("#d-etiket-konum-kaydet").onclick = konumlariKaydet;
    $("#d-etiket-kenar-kaydet").onclick = konumlariKaydet;
    $("#d-etiket-tara").onclick = tara;
    $("#d-etiket-uygula").onclick = uygula;
    kameralariYukle().then(konumlariYukle);
    const kam = $("#etiket-kamera");
    if (kam) kam.onchange = () => { son = null; sonucTemizle(); };
  }

  /* --------------------------------------------------------- konumlar */
  async function konumlariYukle() {
    const p = P();
    if (!p) return;
    try {
      const y = await p.apiIste("/api/kamera/etiket/konumlar");
      konumlar = y.konumlar || { kenar_mm: 0, etiketler: {} };
    } catch (h) {
      // Uç nokta yoksa (eski sunucu) bölüm sessizce boş kalsın; elle
      // kalibrasyon çalışmaya devam ediyor.
      return;
    }
    const k = $("#etiket-kenar");
    if (k) k.value = konumlar.kenar_mm || "";
    tabloYaz();
  }

  function tabloYaz() {
    const govde = $("#etiket-govde");
    if (!govde) return;
    govde.innerHTML = "";
    const adlar = Object.keys(konumlar.etiketler || {})
      .sort((a, b) => Number(a) - Number(b));
    if (!adlar.length) {
      govde.innerHTML = `<tr><td colspan="4" class="alt-not">Henüz etiket
        tanımlanmadı — "Etiket ekle" ile başlayın.</td></tr>`;
      return;
    }
    for (const ad of adlar) {
      const e = konumlar.etiketler[ad];
      satirEkle(ad, e.x, e.y);
    }
  }

  function satirEkle(kimlik, x, y) {
    const govde = $("#etiket-govde");
    if (!govde) return;
    const bos = govde.querySelector(".alt-not");
    if (bos) govde.innerHTML = "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="number" class="etiket-kimlik" min="0" max="586" step="1"
                 value="${kacisli(kimlik)}" placeholder="0"></td>
      <td><input type="number" class="etiket-x" step="0.1" value="${kacisli(x)}"></td>
      <td><input type="number" class="etiket-y" step="0.1" value="${kacisli(y)}"></td>
      <td class="satir-8">
        <button class="dugme" type="button" data-is="konum"
                title="Makinenin şu anki X/Y'sini bu satıra yaz">Şu anki konum</button>
        <button class="dugme" type="button" data-is="sil">Sil</button>
      </td>`;
    tr.querySelector('[data-is="sil"]').onclick = () => {
      tr.remove();
      if (!govde.children.length) tabloYaz();
    };
    tr.querySelector('[data-is="konum"]').onclick = () => {
      const p = P();
      const k = p && p.S && p.S.sonKonum;
      if (!k) { gunluk("✕ Makine konumu bilinmiyor — ajan bağlı mı?", "hata"); return; }
      tr.querySelector(".etiket-x").value = Number(k.x).toFixed(1);
      tr.querySelector(".etiket-y").value = Number(k.y).toFixed(1);
    };
    govde.appendChild(tr);
  }

  async function konumlariKaydet() {
    const p = P();
    if (!p) return;
    const etiketler = {};
    let hatali = "";
    document.querySelectorAll("#etiket-govde tr").forEach((tr) => {
      const kim = tr.querySelector(".etiket-kimlik");
      if (!kim || kim.value === "") return;
      const x = tr.querySelector(".etiket-x").value;
      const y = tr.querySelector(".etiket-y").value;
      if (x === "" || y === "") { hatali = kim.value; return; }
      etiketler[String(parseInt(kim.value, 10))] = { x: Number(x), y: Number(y) };
    });
    if (hatali) {
      hataYaz(`${hatali} numaralı etiketin X ya da Y'si boş. Konumu bilinmeyen `
            + "bir etiket yerleşim hesabına giremez; ya doldurun ya satırı silin.");
      return;
    }
    const kenar = $("#etiket-kenar").value;
    try {
      const y = await p.apiIste("/api/kamera/etiket/konumlar", {
        method: "POST",
        body: JSON.stringify({ kenar_mm: kenar === "" ? 0 : Number(kenar), etiketler }),
      });
      konumlar = y.konumlar;
      hataYaz("");
      izYaz("Kaydedildi");
      gunluk(`✓ Etiket kaydı güncellendi — ${Object.keys(etiketler).length} etiket`, "ok");
    } catch (h) {
      hataYaz(h.message || "Kaydedilemedi");
    }
  }

  /* -------------------------------------------------------------- tara */
  async function tara() {
    const p = P();
    if (!p) return;
    const kam = seciliKamera();
    hataYaz("");
    $("#d-etiket-tara").disabled = true;
    try {
      son = await p.apiIste("/api/kamera/etiket/tara", {
        method: "POST", body: JSON.stringify({ kamera: kam }),
      });
      sonucYaz();
      onizlemeCiz(kam);
    } catch (h) {
      son = null;
      $("#d-etiket-uygula").disabled = true;
      hataYaz(h.message || "Tarama başarısız");
    } finally {
      $("#d-etiket-tara").disabled = false;
    }
  }

  function sonucTemizle() {
    const k = $("#etiket-sonuc");
    if (k) k.classList.add("gizli");
    const o = $("#etiket-onizleme");
    if (o) o.classList.add("gizli");
    const u = $("#d-etiket-uygula");
    if (u) u.disabled = true;
    hataYaz("");
  }

  function sonucYaz() {
    const kutu = $("#etiket-sonuc");
    if (!kutu || !son) return;
    const bulunan = son.etiketler || [];
    const kayitli = new Set(Object.keys((son.konumlar || {}).etiketler || {}));
    const rozet = (e) => kayitli.has(String(e.kimlik))
      ? `<b class="etiket-var">${e.kimlik}</b>`
      : `<b class="etiket-yok" title="Konumu kayıtlı değil — yerleşime giremez">${e.kimlik}</b>`;

    let g = `<div class="etiket-satir"><span>Taranan kamera</span>
      <span><b>${kacisli(son.kamera || "?")}</b></span></div>
      <div class="etiket-satir"><span>Bulunan etiket</span>
      <span>${bulunan.length ? bulunan.map(rozet).join(", ") : "yok"}</span></div>`;

    // EĞİKLİK UYARISI. Kenarlar birbirinden ayrılıyorsa etiket eğik duruyor
    // ya da kamera dik bakmıyor; ölçek o kadar güvenilir değil.
    const egik = bulunan.filter((e) => e.kenar_sapma_yuzde > 6);
    if (egik.length) {
      g += `<div class="etiket-satir uyari"><span>Eğik duran</span><span>${
        egik.map((e) => `${e.kimlik} (%${sayi(e.kenar_sapma_yuzde, 1)})`).join(", ")
      } — düz yatırın ya da kameranın açısına bakın</span></div>`;
    }

    if (son.olcek) {
      g += `<div class="etiket-satir"><span>Ölçek</span>
        <span class="mono">${sayi(son.olcek.mm_px, 4)} mm/piksel</span></div>`;
      if (son.olcek.olcek_yayilimi_yuzde > 5) {
        g += `<div class="etiket-satir uyari"><span>Ölçek yayılımı</span>
          <span>%${sayi(son.olcek.olcek_yayilimi_yuzde, 1)} — etiketler farklı
          uzaklıkta ya da kamera dik bakmıyor</span></div>`;
      }
    }
    if (son.yerlesim) {
      const y = son.yerlesim;
      g += `<div class="etiket-satir"><span>Dönme</span>
              <span class="mono">${sayi(y.donme, 2)}°</span></div>
            <div class="etiket-satir"><span>Karenin merkezi</span>
              <span class="mono">X${sayi(y.ofset_x, 1)} Y${sayi(y.ofset_y, 1)} mm</span></div>`;
      g += y.artik_mm == null
        ? `<div class="etiket-satir"><span>Sapma</span>
             <span class="alt-not">${kacisli(y.artik_notu)}</span></div>`
        : `<div class="etiket-satir${y.artik_mm > 3 ? " uyari" : ""}"><span>Sapma</span>
             <span class="mono">${sayi(y.artik_mm, 2)} mm</span></div>`;
    }
    for (const n of son.notlar || []) {
      g += `<div class="etiket-satir uyari"><span>—</span><span>${kacisli(n)}</span></div>`;
    }
    kutu.innerHTML = g;
    kutu.classList.remove("gizli");
    $("#d-etiket-uygula").disabled = !(son.olcek || son.yerlesim);
  }

  /** Bulunan etiketleri karenin üstüne çiziyor.
   *
   *  GÖZLE DOĞRULAMA ŞART: yazılımın hangi etiketi gördüğünü göstermezsek,
   *  yanlış etiketi görmesi sessiz bir hata olur ve bütün ölçüler kayar. */
  function onizlemeCiz(kam) {
    const kutu = $("#etiket-onizleme");
    const im = $("#etiket-kare");
    const tuval = $("#etiket-tuval");
    if (!kutu || !im || !tuval || !son) return;
    kutu.classList.remove("gizli");
    im.onload = () => {
      /* TUVAL KARENİN KENDİ PİKSELİNDE. Önce `clientWidth` kullanıyordu ve
       * bölüm o an görünür değilse (kapalı `details`, başka sekme) sıfır
       * geliyordu: tuval sıfır boyutlu kalıp çizim hiç görünmüyordu.
       * Bitmap kareyle aynı ölçüde, CSS onu kutuya sığdırıyor; ölçek
       * çarpanı da gerekmiyor, köşeler geldiği koordinatta çiziliyor. */
      tuval.width = son.genislik_px || im.naturalWidth || 1;
      tuval.height = son.yukseklik_px || im.naturalHeight || 1;
      const g = tuval.getContext("2d");
      g.clearRect(0, 0, tuval.width, tuval.height);
      const kalem = Math.max(2, Math.round(tuval.width / 320));
      for (const e of son.etiketler || []) {
        const kayitli = Object.prototype.hasOwnProperty.call(
          (son.konumlar || {}).etiketler || {}, String(e.kimlik));
        g.strokeStyle = kayitli ? "#4caf50" : "#e8a33c";
        g.lineWidth = kalem;
        g.beginPath();
        e.kose.forEach((k, i) => {
          if (i === 0) g.moveTo(k[0], k[1]); else g.lineTo(k[0], k[1]);
        });
        g.closePath();
        g.stroke();
        g.fillStyle = g.strokeStyle;
        g.font = `bold ${kalem * 9}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(e.kimlik), e.merkez[0], e.merkez[1]);
      }
    };
    im.src = `/api/kare/son?kamera=${encodeURIComponent(kam)}`
           + `&jeton=${encodeURIComponent((P().S || {}).jeton || "")}&t=${Date.now()}`;
  }

  async function uygula() {
    const p = P();
    if (!p || !son) return;
    try {
      const y = await p.apiIste("/api/kamera/etiket/tara", {
        method: "POST",
        body: JSON.stringify({ kamera: son.kamera, kaydet: true }),
      });
      son = y;
      sonucYaz();
      izYaz("Kalibrasyon kaydedildi");
      gunluk(`✓ ${son.kamera} kamerası AprilTag ile kalibre edildi`, "ok");
    } catch (h) {
      hataYaz(h.message || "Kaydedilemedi");
    }
  }

  /* ---------------------------------------------------------- yardımcı */
  function hataYaz(metin) {
    const k = $("#etiket-hata");
    if (!k) return;
    k.textContent = metin || "";
    k.classList.toggle("gizli", !metin);
  }

  function izYaz(metin) {
    const k = $("#etiket-kaydedildi");
    if (!k) return;
    k.textContent = metin;
    k.classList.remove("gizli");
    clearTimeout(izYaz._zaman);
    izYaz._zaman = setTimeout(() => k.classList.add("gizli"), 2500);
  }

  // app.js açılışı bitirdikten sonra kuruluyor: `window.Panel` hazır olmalı.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(kur, 0));
  } else {
    setTimeout(kur, 0);
  }
})();
