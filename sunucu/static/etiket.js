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
          <thead><tr><th>Kimlik</th><th>X (mm)</th><th>Y (mm)</th>
            <th title="Etiketin yatak düzleminden yüksekliği. Boş = ölçülmedi.">Z (mm)</th>
            <th title="Tohum ucu ekseninin o andaki değeri. Boş = ilgisiz.">T (mm)</th>
            <th></th></tr></thead>
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
        <h4 class="alt-baslik">Makineyle otomatik kalibrasyon</h4>
        <p class="ikincil">Yere etiket yapıştırmaya gerek yok ve <b>toprağın
          düz olması gerekmiyor</b>. Bir AprilTag'i <b>uç kafasına</b>
          yapıştırın; makine aşağıdaki ızgaranın her noktasına gidip kare
          alsın. Makinenin nereye gittiği milimetresi milimetresine belli,
          işaretin karede nereye düştüğü ölçülüyor — ölçek, montaj açısı ve
          perspektif bu ikisinden çıkıyor.</p>
        <p class="alt-not">Kalibrasyon <b>işaretin bulunduğu yükseklikte</b>
          geçerli. Ölçümü toprak yüzeyine yakın bir Z'de yapın: ekim, sulama
          ve nem ölçümü o düzlemde oluyor.</p>
        <div class="satir-8 alt-hizali">
          <div class="alan"><label for="ok-x1">X başlangıç</label>
            <input type="number" id="ok-x1" step="1" value="100"></div>
          <div class="alan"><label for="ok-x2">X bitiş</label>
            <input type="number" id="ok-x2" step="1" value="400"></div>
          <div class="alan"><label for="ok-y1">Y başlangıç</label>
            <input type="number" id="ok-y1" step="1" value="100"></div>
          <div class="alan"><label for="ok-y2">Y bitiş</label>
            <input type="number" id="ok-y2" step="1" value="400"></div>
          <div class="alan"><label for="ok-adet">Izgara</label>
            <select id="ok-adet">
              <option value="2">2 × 2 (4 nokta)</option>
              <option value="3" selected>3 × 3 (9 nokta)</option>
              <option value="4">4 × 4 (16 nokta)</option>
            </select></div>
          <div class="alan"><label for="ok-z">Z (boş = değiştirme)</label>
            <input type="number" id="ok-z" step="1" placeholder="mevcut Z"></div>
        </div>
        <div class="satir-8 alt-hizali">
          <button class="dugme birincil" id="d-ok-basla">Ölçümü başlat</button>
          <button class="dugme" id="d-ok-hesapla">Hesapla ve kaydet</button>
          <button class="dugme" id="d-ok-temizle">Toplananı sil</button>
          <span class="alt-not" id="ok-durum"></span>
        </div>
        <div id="ok-hata" class="uyari-kutu gizli"></div>

        <div class="etiket-onizleme gizli" id="etiket-onizleme">
          <img id="etiket-kare" alt="Taranan kare">
          <canvas id="etiket-tuval"></canvas>
          <p class="alt-not gizli" id="etiket-onizleme-not"></p>
        </div>
      </details>`;

    otokalibBagla();
    $("#d-etiket-satir").onclick = () => { satirEkle("", "", "", "", ""); };
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
      satirEkle(ad, e.x, e.y, e.z, e.t);
    }
  }

  /* Z VE T İSTEĞE BAĞLI, X/Y ZORUNLU.
   *
   * Yerleşim hesabı (homografi) yatak DÜZLEMİNDE çalışıyor ve yalnız X/Y
   * istiyor. Z, etiketin o düzlemden ne kadar yukarıda olduğunu söylüyor;
   * paralaks düzeltmesi onsuz yapılamıyor — kamera nadirden uzaktaki bir
   * cismi yana kaydırıyor ve yükseklik bilinmeden bu kayma çözülmüyor.
   *
   * BOŞ BIRAKILAN ALAN SIFIR DEĞİL. Sıfır "yatak yüzeyinde" demek ve
   * ölçülmemiş bir etiketi yüzeyde saymak, düzeltmeyi yanlış yöne
   * uygulamak olurdu. Sunucu da boşu `null` saklıyor. */
  function satirEkle(kimlik, x, y, z, t) {
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
      <td><input type="number" class="etiket-z" step="0.1" placeholder="ölçülmedi"
                 value="${z === null || z === undefined ? "" : kacisli(z)}"></td>
      <td><input type="number" class="etiket-t" step="0.1" placeholder="—"
                 value="${t === null || t === undefined ? "" : kacisli(t)}"></td>
      <td class="satir-8">
        <button class="dugme" type="button" data-is="konum"
                title="Makinenin şu anki X/Y/Z/T'sini bu satıra yaz">Şu anki konum</button>
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
      /* Z ve T de yazılıyor — ama YALNIZ makine bildiriyorsa. Bilinmeyen
       * bir ekseni sıfırla doldurmak, ölçülmemiş bir sayıyı ölçülmüş gibi
       * göstermek olurdu. */
      if (Number.isFinite(Number(k.z))) {
        tr.querySelector(".etiket-z").value = Number(k.z).toFixed(1);
      }
      if (Number.isFinite(Number(k.t))) {
        tr.querySelector(".etiket-t").value = Number(k.t).toFixed(1);
      }
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
      const z = tr.querySelector(".etiket-z").value;
      const t = tr.querySelector(".etiket-t").value;
      // Boş alan GÖNDERİLMİYOR; sunucu onu `null` saklıyor. Sıfır
      // göndermek "yatak yüzeyinde" demek olurdu.
      const kayit = { x: Number(x), y: Number(y) };
      if (z !== "") kayit.z = Number(z);
      if (t !== "") kayit.t = Number(t);
      etiketler[String(parseInt(kim.value, 10))] = kayit;
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

  /* ------------------------------------------------- otomatik kalibrasyon
   *
   * Sunucu tarafı (`otokalib.py`) baştan beri vardı ve uçları bağlıydı ama
   * PANELDE HİÇBİR DÜĞMESİ YOKTU — yazılmış ama ulaşılamayan bir özellik.
   *
   * NEDEN ETİKET YAPIŞTIRMAKTAN İYİ: yere yapıştırılan etiketler ancak
   * hepsi AYNI DÜZLEMDE olursa harita veriyor. Bu kurulumda toprak düz
   * değil ve etiketler kabın eğimli duvarına yapıştığı için harita
   * bozuldu ("ufuk çizgisi kadraja giriyor"). Burada düzlemi MAKİNE
   * tanımlıyor: işaret hep aynı Z'de geziyor, yani dört nokta tanım
   * gereği eş düzlemli.
   *
   * NOKTALAR SIRAYLA ve BİRER BİRER isteniyor: her nokta makineyi
   * hareket ettiriyor ve sunucu hareketin bitmesini bekliyor. Hepsini
   * paralel yollamak, makineye aynı anda dört hedef vermek olurdu. */
  function otokalibBagla() {
    const dur = (m) => { const e = $("#ok-durum"); if (e) e.textContent = m; };
    const hataYaz2 = (m) => {
      const e = $("#ok-hata");
      if (!e) return;
      e.textContent = m || "";
      e.classList.toggle("gizli", !m);
    };

    $("#d-ok-basla").onclick = async () => {
      const p = P();
      if (!p) return;
      const kam = $("#etiket-kamera").value;
      const sayi = (id) => Number($(id).value);
      const n = Number($("#ok-adet").value);
      const [x1, x2, y1, y2] = [sayi("#ok-x1"), sayi("#ok-x2"),
                               sayi("#ok-y1"), sayi("#ok-y2")];
      if (![x1, x2, y1, y2].every(Number.isFinite)) {
        hataYaz2("Izgara sınırları sayı olmalı."); return;
      }
      const zHam = $("#ok-z").value;
      const z = zHam === "" ? null : Number(zHam);
      const noktalar = [];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          // YILANKAVİ: satır sonunda en yakın uçtan devam, boşuna yol yok.
          const jj = i % 2 ? n - 1 - j : j;
          noktalar.push({
            x: x1 + (x2 - x1) * (n === 1 ? 0 : i / (n - 1)),
            y: y1 + (y2 - y1) * (n === 1 ? 0 : jj / (n - 1)),
          });
        }
      }
      hataYaz2("");
      $("#d-ok-basla").disabled = true;
      let olculen = 0;
      try {
        for (const [i, nk] of noktalar.entries()) {
          dur(`${i + 1}/${noktalar.length} — X${nk.x.toFixed(0)} Y${nk.y.toFixed(0)}`);
          const govde = { kamera: kam, x: nk.x, y: nk.y };
          if (z !== null) govde.z = z;
          try {
            await p.apiIste("/api/kamera/otokalib/nokta", {
              method: "POST", body: JSON.stringify(govde),
            });
            olculen++;
          } catch (h) {
            /* TEK NOKTA DÜŞERSE TUR DEVAM EDİYOR. İşaret bir durakta
             * görünmeyebilir (gölge, kadraj dışı); o yüzden bütün turu
             * atmak, on beş iyi ölçümü bir kötüsü için çöpe atmak olurdu.
             * Kaçı tutmadığı sonunda yazılıyor. */
            gunluk(`↷ X${nk.x.toFixed(0)} Y${nk.y.toFixed(0)}: ${h.message || h}`,
                   "uyari");
          }
        }
        dur(`${olculen}/${noktalar.length} nokta ölçüldü`);
        if (olculen < 4) {
          hataYaz2(`Yalnız ${olculen} nokta ölçülebildi. Harita için en az `
                 + "dört nokta gerekiyor — işaret her durakta karede "
                 + "görünmeli. Izgarayı daraltın ya da kamerayı ayarlayın.");
        }
      } finally {
        $("#d-ok-basla").disabled = false;
      }
    };

    $("#d-ok-hesapla").onclick = async () => {
      const p = P();
      if (!p) return;
      hataYaz2("");
      try {
        const y = await p.apiIste("/api/kamera/otokalib/hesapla", {
          method: "POST",
          body: JSON.stringify({ kamera: $("#etiket-kamera").value, kaydet: true }),
        });
        const s2 = (y && y.sonuc) || {};
        dur(`kaydedildi · ${Number(s2.mm_px).toFixed(4)} mm/px · `
          + `dönme ${Number(s2.donme).toFixed(2)}°`
          + (s2.artik_mm != null ? ` · sapma ${Number(s2.artik_mm).toFixed(2)} mm` : ""));
        gunluk("✓ Otomatik kalibrasyon kaydedildi", "ok");
      } catch (h) {
        hataYaz2(h.message || String(h));
      }
    };

    $("#d-ok-temizle").onclick = async () => {
      const p = P();
      if (!p) return;
      if (!confirm("Toplanan ölçüm noktaları silinecek. Onaylıyor musunuz?")) return;
      try {
        await p.apiIste("/api/kamera/otokalib/temizle", {
          method: "POST",
          body: JSON.stringify({ kamera: $("#etiket-kamera").value }),
        });
        dur("toplanan silindi");
      } catch (h) { hataYaz2(h.message || String(h)); }
    };
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

      /* HARİTA AYRI BİR SATIR. Yukarıdaki sapma BENZERLİK modelinin;
       * harita ondan bağımsız ve kendi ölçüsü var. Dörtte sapma
       * ölçülemiyor — "±0,0 mm" yazmaktansa neden ölçülemediğini
       * yazıyoruz. Ölçek yayılımı haritanın katsayılarından çıkıyor:
       * kadrajın bir ucundan öbürüne mm/piksel kaç kat oynuyor. */
      if (y.harita) {
        const s = y.harita_saglik || {};
        if (s.ufuk_karede) {
          g += `<div class="etiket-satir uyari"><span>Harita</span>
            <span>${kacisli(s.sebep || "geçersiz")}</span></div>`;
        } else {
          g += y.harita_artik_mm == null
            ? `<div class="etiket-satir"><span>Harita sapması</span>
                 <span class="alt-not">${kacisli(y.harita_artik_notu)}</span></div>`
            : `<div class="etiket-satir${y.harita_artik_mm > 3 ? " uyari" : ""}">
                 <span>Harita sapması</span>
                 <span class="mono">${sayi(y.harita_artik_mm, 2)} mm</span></div>`;
          const kat = Number(s.olcek_yayilimi_kat);
          if (Number.isFinite(kat)) {
            g += `<div class="etiket-satir${kat > 3 ? " uyari" : ""}">
              <span>Harita ölçek yayılımı</span>
              <span class="mono">${sayi(kat, 1)} kat</span></div>`;
          }
        }
      }
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
      /* TUVAL TARAMANIN GÖRDÜĞÜ KARENİN PİKSELİNDE; köşeler de o
       * koordinatta geliyor, ölçek çarpanı gerekmiyor. Tuvali kutuya
       * sığdırmak CSS'in işi (`.etiket-onizleme canvas { width:100% }`)
       * ve o kural bir süre eksikti: tuval kendi bitmap ölçüsünde
       * duruyor, kap kırpıyor ve kutular görünmez oluyordu. */
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
    /* KARE GELMEZSE SEBEBİ YAZILSIN. `/api/kare/son` kayıtlı kare yoksa
     * 404 veriyor; `onload` hiç tetiklenmiyor ve önizleme sessizce boş
     * kalıyordu — tarama başarılı olduğu hâlde hiçbir şey görünmüyor. */
    im.onerror = () => {
      const not = $("#etiket-onizleme-not");
      if (not) {
        not.textContent = "Önizleme karesi alınamadı — bu kameradan henüz "
          + "kayıtlı kare yok. Kamera sekmesinde bir kare çekip tekrar tarayın.";
        not.classList.remove("gizli");
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
