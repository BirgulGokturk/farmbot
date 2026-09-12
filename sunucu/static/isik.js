/* Bitki ışığı (D11) — gece besleme takvimi, panel tarafı.
 *
 * AYRI DOSYA, `filiz.js` ile aynı gerekçe: `app.js` ve `index.html` başka
 * bir oturumda sürekli değişiyor; oraya blok eklemek her yamada çakışma
 * demek. Buraya yalnız boş bir kap giriyor.
 *
 * NEDEN RÖLE DÜĞMESİ DEĞİL. Pompalar doğrudan karta yazılıyor; ışığın
 * bir de takvimi var ve düz bir röle düğmesi, otuz saniye sonra takvimin
 * geri aldığı bir düğme olurdu. Elle verilen karar sunucudan geçiyor ve
 * orada "bir sonraki takvim değişimine kadar" olarak tutuluyor.
 *
 * LAMBA KARTIN BİLDİRDİĞİ DURUM. Komuta bakmıyoruz: gönderilmiş ama
 * düşmüş bir komut, panelde yanan bir ışık ve karanlık bir sera demekti.
 */
(function () {
  "use strict";

  const KAP = "isik-bolum";
  let durum = null;
  let sayac = null;

  const $ = (s) => document.querySelector(s);
  const kacisli = (m) => String(m == null ? "" : m).replace(/[&<>"']/g,
    (h) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[h]));

  function P() { return window.Panel || null; }

  function gunluk(metin, seviye) {
    const p = P();
    if (p && p.gunluk) p.gunluk(metin, seviye);
  }

  function kur() {
    const kap = document.getElementById(KAP);
    if (!kap) return;
    kap.innerHTML = `
      <details class="etiket-blok" id="isik-blok">
        <summary>Bitki ışığı — gece beslemesi (D11)</summary>
        <p class="alt-not">
          Kartta saat yok; takvimi sunucu tutuyor ve karta yalnız aç/kapat
          gidiyor. Kart sıfırlanırsa (pompa çekişinde oluyor) ışık söner,
          sunucu <b>en geç 30 saniyede</b> geri yakar.
        </p>
        <div class="satir isik-satir">
          <span id="isik-lamba" style="width:.75rem;height:.75rem;border-radius:50%;display:inline-block;background:#3a4a3c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.15)"></span>
          <span id="isik-yazi">…</span>
        </div>
        <div class="satir">
          <label>Başlangıç <input type="time" id="isik-bas" step="60"></label>
          <label>Bitiş <input type="time" id="isik-bit" step="60"></label>
          <label class="onay"><input type="checkbox" id="isik-acik"> Takvim etkin</label>
          <button id="d-isik-kaydet">Kaydet</button>
        </div>
        <p class="alt-not">
          Gece yarısını aşan aralık (örn. 22:00–06:00) da yazılabilir.
          Takvim kapalıyken ışık yalnız elle yanar.
        </p>
        <div class="satir">
          <button id="d-isik-ac">Şimdi yak</button>
          <button id="d-isik-kapat">Şimdi söndür</button>
          <button id="d-isik-oto">Takvime dön</button>
        </div>
        <p class="alt-not">
          Elle verilen karar <b>bir sonraki takvim değişimine kadar</b>
          geçerli; o an gelince takvim kendiliğinden devralır. Takvimi
          büsbütün kapatmak, ertesi gün ışığın hiç yanmaması demek olurdu.
        </p>
        <div id="isik-hata" class="uyari gizli"></div>
      </details>`;
    $("#d-isik-kaydet").addEventListener("click", kaydet);
    $("#d-isik-ac").addEventListener("click", () => elle({ durum: true }));
    $("#d-isik-kapat").addEventListener("click", () => elle({ durum: false }));
    $("#d-isik-oto").addEventListener("click", () => elle({ otomatik: true }));
    yukle();
    // Lamba ölçüm paketinden besleniyor; kart durumu iki saniyede bir
    // tazeleniyor. Takvim özeti daha seyrek gerekiyor (aşağıda).
    if (sayac) clearInterval(sayac);
    sayac = setInterval(lambaYaz, 2000);
    setInterval(yukle, 60000);
  }

  function hataYaz(metin) {
    const k = $("#isik-hata");
    if (!k) return;
    k.textContent = metin || "";
    k.classList.toggle("gizli", !metin);
  }

  async function yukle() {
    const p = P();
    if (!p) return;
    try {
      durum = await p.apiIste("/api/isik");
      const a = durum.ayar || {};
      const bas = $("#isik-bas");
      const bit = $("#isik-bit");
      const ac = $("#isik-acik");
      // Kullanıcı kutuya yazarken üstüne yazmıyoruz: yarım kalan bir
      // saat, dakikada bir silinirse doldurulamaz hâle gelir.
      if (bas && document.activeElement !== bas) bas.value = a.bas || "00:00";
      if (bit && document.activeElement !== bit) bit.value = a.bit || "06:00";
      if (ac && document.activeElement !== ac) ac.checked = !!a.acik;
      lambaYaz();
    } catch (h) {
      hataYaz(h.message || String(h));
    }
  }

  /** Kartın bildirdiği gerçek durum + sunucunun gerekçesi. */
  function lambaYaz() {
    const l = $("#isik-lamba");
    const y = $("#isik-yazi");
    if (!l || !y) return;
    const p = P();
    const kart = !!(p && p.S && p.S.roleDurum && p.S.roleDurum.isik);
    l.style.background = kart ? "#ffd166" : "#3a4a3c";
    l.style.boxShadow = kart ? "0 0 8px 2px rgba(255,209,102,.55)"
      : "inset 0 0 0 1px rgba(255,255,255,.15)";
    const g = durum ? durum.gerekce : "";
    const el = durum && durum.elle !== null && durum.elle !== undefined;
    y.innerHTML = `<b>${kart ? "YANIYOR" : "sönük"}</b>`
      + (g ? ` — ${kacisli(g)}` : "")
      + (el ? ' <span class="ikincil">(el kipi — sonraki takvim değişiminde düşer)</span>' : "");
  }

  async function kaydet() {
    const p = P();
    if (!p) return;
    hataYaz("");
    const d = $("#d-isik-kaydet");
    d.disabled = true;
    try {
      durum = await p.apiIste("/api/isik", {
        method: "POST",
        body: JSON.stringify({
          acik: $("#isik-acik").checked,
          bas: $("#isik-bas").value,
          bit: $("#isik-bit").value,
        }),
      });
      lambaYaz();
      const a = durum.ayar || {};
      gunluk(`✓ Bitki ışığı ${a.acik ? `${a.bas}–${a.bit}` : "takvimi kapalı"}`, "ok");
    } catch (h) {
      hataYaz(h.message || String(h));
    } finally {
      d.disabled = false;
    }
  }

  async function elle(govde) {
    const p = P();
    if (!p) return;
    hataYaz("");
    try {
      durum = await p.apiIste("/api/isik/elle", {
        method: "POST", body: JSON.stringify(govde),
      });
      lambaYaz();
      gunluk(govde.otomatik ? "✓ Bitki ışığı takvime döndü"
        : `✓ Bitki ışığı elle ${govde.durum ? "açıldı" : "kapatıldı"}`, "ok");
    } catch (h) {
      hataYaz(h.message || String(h));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(kur, 0));
  } else {
    setTimeout(kur, 0);
  }
})();
