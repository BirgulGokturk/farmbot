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
            <input type="number" id="filiz-esik" step="0.01" min="0.01" max="0.9"
                   placeholder="0.12">
          </div>
          <div class="alan">
            <label for="filiz-enaz">En az piksel</label>
            <input type="number" id="filiz-enaz" step="10" min="10" max="2000000"
                   placeholder="kare ölçüsüne göre">
          </div>
          <div class="alan">
            <label for="filiz-birlestir">Birleştirme (mm)</label>
            <input type="number" id="filiz-birlestir" step="1" min="0" max="200"
                   placeholder="25">
          </div>
        </div>
        <p class="alt-not">Filizler küçükse <b>en az piksel</b>i düşürün, yeşil
          soluksa <b>eşiği</b>. Boş bırakırsanız eşik <b>kare ölçüsüne göre</b>
          hesaplanıyor — mutlak bir sayı, 640 pikselde ve 1920 pikselde
          bambaşka şeyler demek olurdu. <b>Birleştirme</b>: bu mesafeden yakın
          lekeler tek fide sayılıyor — bir filizin iki yaprağı ayrı lekelenip
          sayımı ikiye katlamasın diye.</p>

        <div id="filiz-hata" class="uyari-kutu gizli"></div>
        <div id="filiz-sonuc" class="gomulu gizli"></div>
        <div class="etiket-onizleme gizli" id="filiz-onizleme">
          <img id="filiz-kare" alt="Çözümlenen kare">
          <canvas id="filiz-tuval"></canvas>
        </div>
      </details>`;
    $("#d-filiz-bul").onclick = bul;
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
      const a = Number($("#filiz-enaz").value);
      const b = $("#filiz-birlestir").value;
      if (Number.isFinite(e) && e > 0) govde.esik = e;
      if (Number.isFinite(a) && a > 0) govde.en_az_piksel = a;
      if (b !== "" && Number.isFinite(Number(b))) govde.birlestir_mm = Number(b);

      son = await p.apiIste("/api/kamera/filiz/bul", {
        method: "POST", body: JSON.stringify(govde),
      });
      yaz();
      gunluk(`✓ ${(son.fideler || []).length} filiz bulundu`, "ok");
    } catch (h) {
      son = null;
      $("#filiz-sonuc").classList.add("gizli");
      $("#filiz-onizleme").classList.add("gizli");
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
          son.en_az_kendiliginden ? " (kare ölçüsünden)" : ""}</span></div>`;

    if (!fideler.length) {
      g += `<div class="etiket-satir uyari"><span>—</span>
        <span>Hiç yeşil leke kalmadı. <b>En az piksel</b>i düşürün ya da
        <b>eşiği</b> aşağı çekin.</span></div>`;
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

  /** Kareyi ve bulunan kutuları üst üste çiziyor.
   *
   * Tuval, karenin KENDİ piksel ölçüsünde: `clientWidth` görünmeyen bir
   * sekmede sıfır dönüyor ve kutular sol üst köşeye yığılıyordu. */
  function onizleme() {
    const o = $("#filiz-onizleme");
    const im = $("#filiz-kare");
    const t = $("#filiz-tuval");
    if (!o || !im || !t || !son || !son.kare) return;
    im.onload = () => {
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
    };
    im.src = son.kare;
    o.classList.remove("gizli");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(kur, 0));
  } else {
    setTimeout(kur, 0);
  }
})();
