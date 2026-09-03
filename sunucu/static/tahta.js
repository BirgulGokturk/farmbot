/* Satranç tahtasıyla lens kalibrasyonu — panel tarafı.
 *
 * AYRI DOSYA: `etiket.js` ile aynı gerekçe. `app.js` ve `index.html` başka
 * bir oturumda sürekli değişiyor; bu bölüm kendi arayüzünü kendi kuruyor
 * ve `index.html`e yalnız boş bir kap giriyor.
 *
 * NE İŞE YARIYOR. Ucuz lensler görüntüyü kenarlara doğru şişiriyor:
 * yatağın ortasındaki bitki doğru ölçülürken kenardaki kayıyor ve bu
 * kayma `mm_px` ne kadar doğru olursa olsun düzelmiyor — tek bir ölçek
 * bütün kareye uygulanıyor, oysa bozulma yere göre değişiyor.
 *
 * KAPSAMA GÖSTERİLİYOR. Bütün kareleri ortada çeken kullanıcı kenarları
 * hiç ölçmemiş oluyor ve düzeltme tam da en çok gereken yerde uydurma
 * kalıyor. 3x3 ızgara hangi bölgenin boş olduğunu söylüyor.
 */
(function () {
  "use strict";

  const KAP = "tahta-bolum";
  let sonHesap = null;

  const $ = (s) => document.querySelector(s);
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));
  const P = () => window.Panel || null;

  function seciliKamera() {
    const d = document.querySelector("#kalib-sekmeler .kam-sekme.secili");
    return (d && d.dataset.kam) || "uc";
  }

  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    kap.innerHTML = `
      <details class="etiket-blok">
        <summary>Satranç tahtasıyla kalibre et (lens)</summary>
        <p class="ikincil">
          Lens görüntüyü kenarlara doğru büküyor; ortadaki bitki doğru
          ölçülürken kenardaki kayıyor. Tahtanın iç köşeleri gerçekte
          kusursuz bir ızgara olduğu için, görüntüde ne kadar eğrildiklerine
          bakıp lensi çözebiliyoruz. <b>Bu işlem derinlik ölçmüyor</b> —
          lensi düzeltiyor ve kameranın tahtaya uzaklığını söylüyor.
        </p>

        <div class="satir-8 alt-hizali">
          <div class="alan"><label for="tahta-kx">İç köşe (yatay)</label>
            <input type="number" id="tahta-kx" min="3" max="30" step="1" value="9"></div>
          <div class="alan"><label for="tahta-ky">İç köşe (dikey)</label>
            <input type="number" id="tahta-ky" min="3" max="30" step="1" value="6"></div>
          <div class="alan"><label for="tahta-mm">Kare ölçüsü (mm)</label>
            <input type="number" id="tahta-mm" min="1" step="0.1" value="25"></div>
        </div>
        <p class="alt-not">İç köşe = karelerin <b>kesiştiği</b> nokta sayısı,
          kare sayısı değil: 10×7 karelik tahtada 9×6. İki sayı birbirine
          eşit olmamalı, yoksa tahtanın yönü belirsiz kalıyor.</p>

        <div class="tahta-satir">
          <div class="tahta-kapsama" id="tahta-kapsama"></div>
          <div class="tahta-bilgi">
            <div class="tahta-sayac"><span id="tahta-sayi">0</span>
              <span class="alt-not">kare toplandı</span></div>
            <p class="alt-not" id="tahta-oneri">Tahtayı kameraya gösterin ve
              “Kare ekle”ye basın.</p>
          </div>
        </div>

        <div class="satir-8 alt-hizali">
          <button class="dugme birincil" id="d-tahta-kare">Kare ekle</button>
          <button class="dugme" id="d-tahta-hesapla">Hesapla</button>
          <button class="dugme" id="d-tahta-kaydet" disabled>Kaydet</button>
          <button class="dugme" id="d-tahta-temizle">Baştan başla</button>
        </div>
        <div id="tahta-hata" class="uyari-kutu gizli"></div>
        <div id="tahta-sonuc" class="gomulu gizli"></div>
      </details>`;

    $("#d-tahta-kare").onclick = kareEkle;
    $("#d-tahta-hesapla").onclick = () => hesapla(false);
    $("#d-tahta-kaydet").onclick = () => hesapla(true);
    $("#d-tahta-temizle").onclick = temizle;
    kapsamaCiz([]);
    durumYukle();
  }

  function ayarlar() {
    return {
      kamera: seciliKamera(),
      ic_kose_x: Number($("#tahta-kx").value),
      ic_kose_y: Number($("#tahta-ky").value),
      kare_mm: Number($("#tahta-mm").value),
    };
  }

  /* 3x3 ızgara: dolu hücre yeşil, boş hücre soluk. Hangi bölgenin eksik
   * olduğunu söylemek, "20 kare çektim ama düzeltme kenarlarda tutmuyor"
   * sonucunu baştan engelliyor. */
  function kapsamaCiz(kapsanan) {
    const k = $("#tahta-kapsama");
    if (!k) return;
    const dolu = new Set(kapsanan || []);
    const ad = ["sol üst", "üst", "sağ üst", "sol", "orta", "sağ",
                "sol alt", "alt", "sağ alt"];
    k.innerHTML = ad.map((a, i) =>
      `<span class="tahta-hucre${dolu.has(i) ? " dolu" : ""}" title="${a}"></span>`).join("");
  }

  function oneriYaz(d) {
    const o = $("#tahta-oneri");
    if (!o) return;
    const n = d.kare_sayisi || 0;
    const kapsanan = d.kapsanan || [];
    const enAz = d.en_az || 8;
    if (!n) {
      o.textContent = "Tahtayı kameraya gösterin ve “Kare ekle”ye basın.";
      return;
    }
    const bos = [];
    const ad = ["sol üst", "üst orta", "sağ üst", "sol orta", "orta", "sağ orta",
                "sol alt", "alt orta", "sağ alt"];
    for (let i = 0; i < 9; i++) if (!kapsanan.includes(i)) bos.push(ad[i]);
    if (n < enAz) {
      o.textContent = `En az ${enAz} kare gerekiyor. `
        + (bos.length ? `Boş bölgeler: ${bos.slice(0, 4).join(", ")}.` : "");
      return;
    }
    o.textContent = bos.length
      ? `Hesaplayabilirsiniz. Daha iyisi için boş bölgeler: ${bos.slice(0, 4).join(", ")}.`
      : "Bütün bölgeler kapsandı — hesaplayabilirsiniz.";
  }

  async function durumYukle() {
    const p = P();
    if (!p) return;
    try {
      const y = await p.apiIste("/api/kamera/tahta/durum?kamera="
                                + encodeURIComponent(seciliKamera()));
      const d = y.toplama || {};
      $("#tahta-sayi").textContent = d.kare_sayisi || 0;
      kapsamaCiz(d.kapsanan);
      oneriYaz(d);
      if (y.kayitli) kayitliYaz(y.kayitli);
    } catch (h) { /* uç nokta yoksa bölüm sessizce boş kalıyor */ }
  }

  async function kareEkle() {
    const p = P();
    if (!p) return;
    hataYaz("");
    const d = $("#d-tahta-kare");
    d.disabled = true;
    try {
      const y = await p.apiIste("/api/kamera/tahta/kare", {
        method: "POST", body: JSON.stringify(ayarlar()),
      });
      $("#tahta-sayi").textContent = y.kare_sayisi;
      kapsamaCiz(y.kapsanan);
      oneriYaz({ kare_sayisi: y.kare_sayisi, kapsanan: y.kapsanan, en_az: 8 });
      if (p.gunluk) {
        p.gunluk(`✓ Kare eklendi (${y.kare_sayisi}) — netlik ${y.netlik}, `
               + `karenin %${y.alan_yuzde}'i`, "ok");
      }
    } catch (h) {
      // REDDİN SEBEBİ EKRANDA. Sunucu neden reddettiğini yazıyor; onu
      // kendi cümlemizle değiştirmek bilgiyi kaybetmek olurdu.
      hataYaz(h.message || "Kare eklenemedi");
    } finally {
      d.disabled = false;
    }
  }

  async function hesapla(kaydet) {
    const p = P();
    if (!p) return;
    hataYaz("");
    try {
      const y = await p.apiIste("/api/kamera/tahta/hesapla", {
        method: "POST",
        body: JSON.stringify({ ...ayarlar(), kaydet: !!kaydet }),
      });
      sonHesap = y.sonuc;
      sonucYaz(y.sonuc, kaydet);
      $("#d-tahta-kaydet").disabled = false;
      if (kaydet && p.gunluk) {
        p.gunluk(`✓ ${y.kamera} lens kalibrasyonu kaydedildi `
               + `(hata ${y.sonuc.rms} piksel)`, "ok");
      }
    } catch (h) {
      hataYaz(h.message || "Hesaplanamadı");
    }
  }

  async function temizle() {
    const p = P();
    if (!p) return;
    try {
      const y = await p.apiIste("/api/kamera/tahta/temizle", {
        method: "POST", body: JSON.stringify({ kamera: seciliKamera() }),
      });
      const d = y.toplama || {};
      $("#tahta-sayi").textContent = d.kare_sayisi || 0;
      kapsamaCiz(d.kapsanan);
      oneriYaz(d);
      $("#tahta-sonuc").classList.add("gizli");
      $("#d-tahta-kaydet").disabled = true;
      hataYaz("");
    } catch (h) { hataYaz(h.message || "Temizlenemedi"); }
  }

  function sonucYaz(s, kaydedildi) {
    const kutu = $("#tahta-sonuc");
    if (!kutu || !s) return;
    // RMS: köşelerin bulunduğu yer ile hesaplanan yer arasındaki fark.
    // 0,5'in altı iyi; 1'in üstünde bir yerde sorun var (bulanık kare ya
    // da yanlış iç köşe sayısı) ve bunu söylememek yanlış güven verirdi.
    const iyi = s.rms <= 0.5, orta = s.rms <= 1.0;
    const yorum = iyi ? "iyi" : orta ? "kabul edilebilir" : "yüksek — kareleri gözden geçirin";
    kutu.innerHTML = `
      <div class="etiket-satir${iyi ? "" : " uyari"}"><span>Ölçüm hatası</span>
        <span class="mono">${s.rms} piksel · ${yorum}</span></div>
      <div class="etiket-satir"><span>Kullanılan kare</span>
        <span class="mono">${s.kare_sayisi}</span></div>
      <div class="etiket-satir"><span>Çözünürlük</span>
        <span class="mono">${s.boyut[0]}×${s.boyut[1]}</span></div>
      <div class="etiket-satir"><span>Kameranın tahtaya uzaklığı</span>
        <span class="mono">${s.uzaklik_ortanca_mm} mm
          (${s.uzaklik_en_az_mm}–${s.uzaklik_en_cok_mm})</span></div>
      <div class="etiket-satir"><span>Bozulma katsayıları</span>
        <span class="mono">${s.bozulma.slice(0, 3).map((x) => x.toFixed(3)).join(" · ")}</span></div>
      ${kaydedildi ? '<div class="etiket-satir"><span>Durum</span>'
        + '<span class="etiket-var">kaydedildi</span></div>' : ""}
      <p class="alt-not">Bu kalibrasyon yalnız
        <b>${s.boyut[0]}×${s.boyut[1]}</b> çözünürlüğünde geçerli. Kamera
        çözünürlüğünü değiştirirseniz yeniden yapın.</p>`;
    kutu.classList.remove("gizli");
  }

  function kayitliYaz(k) {
    const kutu = $("#tahta-sonuc");
    if (!kutu || !k) return;
    sonucYaz(k, true);
  }

  function hataYaz(metin) {
    const k = $("#tahta-hata");
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
