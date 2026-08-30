/* Tarım Robotu paneli — canlı veri, grafikler ve hareket kontrolü.
 *
 * Tek dosya, derleme adımı yok: Pi'ye ya da buluta kopyalanan HTML doğrudan
 * çalışıyor. Veri iki yoldan geliyor:
 *   - GET /api/gecmis  → grafiğin geçmişi (sayfa açılınca bir kez)
 *   - WS  /ws/panel    → yeni ölçümler ve durum değişiklikleri (anlık)
 * Komutlar POST /api/komut ile gidiyor; orada hata kodunu ve ajanın yanıtını
 * beklemek WebSocket'e göre çok daha kolay.
 */

const S = {
  jeton: localStorage.getItem("farmbot_jeton") || "",
  // Toprak probunun havada/suda okuduğu ham uçlar. Ajan `durum` paketinde
  // bildiriyor; gelene kadar teorik uçlar kullanılıyor.
  toprakKalib: { kuru: 1023, islak: 0 },
  kameraYuzenKapali: false, // sahnedeki yüzen kamera küçültüldü mü
  sonKareAdres: "",         // son kare adresi — yüzen kutu geri açılınca beklemesin
  sonKareCanli: false,
  sonKareTs: 0,
  dakika: 60,
  ws: null,
  jogAktif: null,        // {eksen, yon, dugme} — şu an basılı tutulan jog
  jogSayac: null,        // yenileme zamanlayıcısı
  enable: false,
  grafikler: {},
  roleDurum: { su_pompasi: false, hava_pompasi: false },
  noktalar: [],
  bolgeler: [],
  ucYollar: {},      // uç adı -> {al:[…], birak:[…]} — ajandan geliyor
  sonUcTools: null,  // tablo imzası: değişmedikçe yeniden çizmiyoruz
  sonUcAyar: null,
  dikim: [],        // sunucudaki dikim alanları (sunucu/dikim.py)
  ucListesi: [],
  sonTakiliUc: undefined,
  ucAyarDuzenleniyor: false,
  programlar: [],
  adimlar: [],
  bolgeDuzenleniyor: false,   // kullanıcı yazarken durum akışı üzerine yazmasın
  sinirlar: null,        // ajandan gelen yumuşak sınırlar
  sekme: localStorage.getItem("farmbot_sekme") || "izle",
  kalibImza: "",         // kalibrasyon tablosunu boşuna yeniden çizmemek için
  guvenliZ: null,        // X/Y hareketi için gereken en düşük Z (ajandan)
  taniImzasi: "",        // etkin tanılar — aynıysa DOM'a dokunmuyoruz
  kip: null,             // Arduino'nun kipi: "oto" | "manuel"
  sonKonum: null,
  ajanBagli: false,
  satirlar: [],          // tablo görünümü için son ölçümler
  arduinoCalisma: null, // kartın çalışma süresi (sn); geriye giderse kart yeniden başlamış
  sonZaman: 0,
};

const $ = (secici) => document.querySelector(secici);
const $$ = (secici) => Array.from(document.querySelectorAll(secici));

// Grafik renkleri CSS'ten okunuyor: tema tek yerden değişsin.
const kok = getComputedStyle(document.documentElement);
const RENK = {
  seri1: kok.getPropertyValue("--seri-1").trim(),
  seri2: kok.getPropertyValue("--seri-2").trim(),
  seri3: kok.getPropertyValue("--seri-3").trim(),
  metin3: kok.getPropertyValue("--metin-3").trim(),
  yuzey: kok.getPropertyValue("--yuzey").trim(),
  cizgi: "rgba(255,255,255,.07)",
};

/* ------------------------------------------------------------------ yardımcı */
const sayi = (deger, basamak = 1) =>
  deger === null || deger === undefined || Number.isNaN(deger) ? "—" : Number(deger).toFixed(basamak);

/** Değeri OLDUĞU çözünürlükte yazar: 26 -> "26", 26,3 -> "26,3".
 *
 * Neden sabit basamak değil: DHT11 tam sayı üretiyor. `toFixed(1)` ile
 * yazınca kartta "26,0" görünüyor ve bu, sensörün ondalık ölçtüğü
 * izlenimini veriyor — ölçmüyor. Değer ajanda zaten sensörün
 * çözünürlüğüne yuvarlandığı için (bkz. ajan/arduino.py, Duzeltici)
 * burada yapılacak doğru şey, o çözünürlüğü olduğu gibi göstermek. */
const sayiCoz = (deger, azami = 2) => {
  if (deger === null || deger === undefined || Number.isNaN(deger)) return "—";
  const n = Number(deger);
  for (let b = 0; b < azami; b++) {
    if (Math.abs(n - Number(n.toFixed(b))) < 1e-9) return n.toFixed(b);
  }
  return n.toFixed(azami);
};

/** Toprak probunun ham ADC değerini yüzdeye çevirir.
 *
 *  Ham değer kurudukça YÜKSELİYOR, yani yön ters. Ölçek 0-1023 varsayılamaz:
 *  gerçek prob suda sıfır okumuyor (saf su bile sonsuz iletken değil, üstelik
 *  modülün seri direnci bölücüyü kaydırıyor). Suya sokulunca ham ~590 okuyan
 *  bir prob, 0-1023'e göre "%42" der ve panel hiçbir zaman ıslak göstermez.
 *
 *  Bu yüzden iki uç ölçülüp ajanın ayarına yazılıyor (`toprak-kalibre.py`) ve
 *  buradan okunuyor. Kalibrasyon gelmediyse teorik uçlara düşüyoruz — yanlış
 *  ama en azından eski davranışla aynı. */
const toprakYuzde = (ham) => {
  if (ham === null || ham === undefined) return null;
  const kuru = S.toprakKalib.kuru, islak = S.toprakKalib.islak;
  // Aralık sıfırlanırsa (iki uç eşit girilmişse) bölme patlar; teorik uca dön.
  const aralik = kuru - islak;
  if (!aralik) return Math.max(0, Math.min(100, ((1023 - ham) / 1023) * 100));
  return Math.max(0, Math.min(100, ((kuru - ham) / aralik) * 100));
};

function saatEtiketi(ts, uzunAralikMi) {
  const t = new Date(ts * 1000);
  const iki = (n) => String(n).padStart(2, "0");
  const saat = `${iki(t.getHours())}:${iki(t.getMinutes())}`;
  return uzunAralikMi ? `${iki(t.getDate())}.${iki(t.getMonth() + 1)} ${saat}` : saat;
}

function gunluk(metin, sinif = "") {
  // "ok" sınıfı CSS'te .ok-satir; sınıf adını burada eşliyoruz.
  if (sinif === "ok") sinif = "ok-satir";
  const kutu = $("#gunluk");
  const satir = document.createElement("div");
  if (sinif) satir.className = sinif;
  const zaman = new Date().toLocaleTimeString("tr-TR");
  satir.innerHTML = `<span class="saat">${zaman}</span>${metin}`;
  kutu.prepend(satir);
  while (kutu.children.length > 200) kutu.lastChild.remove();
  // Şerit kapalıyken de son satır başlıkta görünsün: kapatan kullanıcı
  // yine de "az önce ne oldu" sorusunun cevabını görebilmeli.
  const ozet = $("#gunluk-son");
  if (ozet) ozet.textContent = "· " + metin.replace(/<[^>]*>/g, "").slice(0, 70);
}

/* -------------------------------------------------------------------- komut */
async function komutGonder(ad, arg = {}) {
  try {
    const yanit = await fetch(`/api/komut?jeton=${encodeURIComponent(S.jeton)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad, arg }),
    });
    const govde = await yanit.json().catch(() => ({}));
    if (!yanit.ok) {
      gunluk(`✕ ${ad}: ${govde.detail || yanit.statusText}`, "hata");
      return null;
    }
    // "sessiz" komutlar (jog yenilemesi, önizleme sorgusu) günlüğe düşmüyor:
    // saniyede birkaç kez tekrarlanan bir sorgu, gerçek olayları kaydırırdı.
    if (!govde.sessiz) {
      gunluk(govde.ok ? `✓ ${govde.mesaj}` : `✕ ${govde.mesaj}`, govde.ok ? "ok" : "hata");
    }
    return govde;
  } catch (hata) {
    gunluk(`✕ ${ad}: sunucuya ulaşılamadı (${hata.message})`, "hata");
    return null;
  }
}

/* ------------------------------------------------------------ noktalar API */
async function apiIste(yol, secenek = {}) {
  const ayirac = yol.includes("?") ? "&" : "?";
  const yanit = await fetch(`${yol}${ayirac}jeton=${encodeURIComponent(S.jeton)}`, {
    headers: { "Content-Type": "application/json" },
    ...secenek,
  });
  const govde = await yanit.json().catch(() => ({}));
  if (!yanit.ok) throw Object.assign(new Error(govde.detail || yanit.statusText), { kod: yanit.status });
  return govde;
}

/** Nokta makinenin yumuşak sınırlarının dışında mı?
 *  Sınırlar ajandan geliyor (durum.sinirlar); panel bunları yalnızca
 *  göstermek için kullanıyor — asıl denetim ajanda. */
function sinirDisi(nokta) {
  const s = S.sinirlar;
  if (!s) return null;
  const disarida = ["x", "y", "z"].filter((eksen) => {
    const sinir = s[eksen];
    if (!sinir || sinir.min == null || sinir.max == null) return false;
    return nokta[eksen] < sinir.min - 0.5 || nokta[eksen] > sinir.max + 0.5;
  });
  return disarida.length ? disarida.map((e) => e.toUpperCase()).join(", ") : null;
}

async function noktalariYukle() {
  try {
    const govde = await apiIste("/api/noktalar");
    S.noktalar = govde.noktalar || [];
    noktalariCiz();
    // Bitkiler de bu depoda duruyor; 3B tarla görünümü aynı listeden besleniyor.
    if (window.Tarla) window.Tarla.noktalarDegisti();
  } catch (hata) {
    gunluk(`✕ Noktalar yüklenemedi: ${hata.message}`, "hata");
  }
}

function noktalariCiz() {
  const kutu = $("#nokta-liste");
  if (!S.noktalar.length) {
    // BOŞ DURUM: boş bir kutu değil, ne yapılacağı.
    kutu.innerHTML = '<p class="bos-durum">Henüz kayıtlı nokta yok.<br>' +
      'Makineyi bir yere götürün, üstteki kutuya bir ad yazıp ' +
      '<b>Konumu kaydet</b> deyin — o konum buraya düşer ve programlarda ' +
      'kullanılabilir.</p>';
    const ozet = $("#nokta-ozet");
    if (ozet) ozet.textContent = "";
    return;
  }
  const ozet = $("#nokta-ozet");
  if (ozet) ozet.textContent = `${S.noktalar.length} nokta`;
  kutu.innerHTML = S.noktalar.map((n, i) => {
    const disi = sinirDisi(n);
    // Satır eylemleri DÜZ düğme: bir listede on iki çerçeveli düğme, hepsi
    // asıl işmiş gibi duruyor ve göz nereye bakacağını bilmiyordu.
    return `<div class="satir${disi ? " sinir-disi" : ""}">
      <span class="ad">${n.tur ? "🌱 " : ""}${kacisli(n.ad)}</span>
      <span class="koordinat">X${sayi(n.x)} Y${sayi(n.y)} Z${sayi(n.z)}</span>
      ${disi ? `<span class="rozet-uyari" title="Bu nokta makinenin yumuşak sınırlarının dışında; hareket ajanda reddedilir. Kayıt silinmedi.">⚠ ${disi} sınır dışı</span>` : ""}
      <button class="ikon-dugme nokta-git" data-i="${i}" title="Bu noktaya git"${disi ? ` disabled data-sinir-disi="1"` : ""}>Git</button>
      <button class="ikon-dugme tehlike nokta-sil" data-i="${i}" title="Sil">
        <svg class="ikon"><use href="#i-kapat"/></svg></button>
    </div>`;
  }).join("");

  $$(".nokta-git").forEach((d) => {
    d.disabled = d.disabled || !S.ajanBagli;
    d.onclick = () => {
      const n = S.noktalar[Number(d.dataset.i)];
      komutGonder("git", { x: n.x, y: n.y, z: n.z });
    };
  });
  $$(".nokta-sil").forEach((d) => {
    d.onclick = async () => {
      const n = S.noktalar[Number(d.dataset.i)];
      try {
        const y = await apiIste(`/api/noktalar?ad=${encodeURIComponent(n.ad)}`, { method: "DELETE" });
        gunluk(`✓ '${n.ad}' silindi`, "ok");
        geriAlGoster(y.geri_al);
        await noktalariYukle();
      } catch (hata) {
        gunluk(`✕ Silinemedi: ${hata.message}`, "hata");
      }
    };
  });
}

/** Kullanıcının yazdığı isim doğrudan HTML'e giriyor; kaçırmadan basmak
 *  panelin kendi kendini bozmasına yol açardı. */
function kacisli(metin) {
  return String(metin).replace(/[&<>"']/g, (k) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[k]));
}

async function noktaKaydet() {
  const ad = $("#nokta-ad").value.trim();
  if (!ad) { gunluk("✕ Önce bir nokta adı yazın", "hata"); return; }
  const k = S.sonKonum;
  if (!k || k.x == null) { gunluk("✕ Konum bilinmiyor — PLC bağlı mı?", "hata"); return; }

  const govde = { ad, x: k.x, y: k.y, z: k.z };
  try {
    await apiIste("/api/noktalar", { method: "POST", body: JSON.stringify(govde) });
  } catch (hata) {
    if (hata.kod === 409) {
      // Üzerine yazmak veri kaybı; sormadan yapmıyoruz.
      if (!confirm(`'${ad}' zaten var. Üzerine yazılsın mı?`)) return;
      try {
        await apiIste("/api/noktalar", {
          method: "POST", body: JSON.stringify({ ...govde, ustune_yaz: true }),
        });
      } catch (ikinci) { gunluk(`✕ ${ikinci.message}`, "hata"); return; }
    } else {
      gunluk(`✕ ${hata.message}`, "hata");
      return;
    }
  }
  gunluk(`✓ '${ad}' kaydedildi: X${sayi(k.x)} Y${sayi(k.y)} Z${sayi(k.z)}`, "ok");
  $("#nokta-ad").value = "";
  await noktalariYukle();
}

/* --------------------------------------------------------- tohum ızgarası */
function izgaraGirdisi() {
  // Z artık formda yok: tarla tasarımcısındaki bitkilerle aynı kural geçerli —
  // nokta güvenli taşıma yüksekliğine yazılıyor ki "git" dendiğinde uç toprağa
  // dalmasın. Ekim derinliği ayrı bir bilgi ve türde duruyor.
  return {
    x0: Number($("#iz-x0").value), y0: Number($("#iz-y0").value),
    z: S.guvenliZ == null ? 340 : S.guvenliZ,
    dx: Number($("#iz-dx").value), dy: Number($("#iz-dy").value),
    satir: Number($("#iz-satir").value), sutun: Number($("#iz-sutun").value),
    onek: $("#iz-onek").value.trim() || "s",
  };
}

async function izgaraOnizle() {
  const kutu = $("#izgara-onizleme");
  try {
    const o = await apiIste("/api/izgara/onizle", {
      method: "POST", body: JSON.stringify(izgaraGirdisi()),
    });
    S.izgaraHazir = true;

    const uyarilar = [];
    if (o.sinir_disi.length) {
      uyarilar.push(`<div class="rozet-uyari" style="display:inline-block;margin-top:8px">
        ⚠ ${o.sinir_disi.length} nokta sınır dışı: ${kacisli(o.sinir_disi.slice(0, 6).map((s) => s.ad).join(", "))}${o.sinir_disi.length > 6 ? "…" : ""}
        — üretilecek ve işaretlenecek, hareket ajanda reddedilir</div>`);
    }
    if (o.ustune_yazilacak.length) {
      uyarilar.push(`<div class="rozet-uyari" style="display:inline-block;margin-top:8px">
        ⚠ ${o.ustune_yazilacak.length} mevcut noktanın ÜZERİNE yazılacak:
        ${kacisli(o.ustune_yazilacak.slice(0, 6).join(", "))}${o.ustune_yazilacak.length > 6 ? "…" : ""}</div>`);
    }
    if (o.sinir_bilinmiyor) {
      uyarilar.push(`<div class="rozet-uyari" style="display:inline-block;margin-top:8px">
        ⚠ Ajan bağlı değil — sınır denetimi yapılamadı</div>`);
    }

    // Örnek nokta listesi bilerek yok: kaç nokta üretileceği ve sorunlu
    // olanların hangileri olduğu karar için yeterli, ilk dört koordinatı
    // okumak değil. Noktaların tamamı zaten Uygula'dan sonra listede.
    const ilk = o.noktalar[0], son = o.noktalar[o.noktalar.length - 1];
    kutu.innerHTML = `<b>${o.toplam}</b> nokta üretilecek` +
      (o.sinir_disi.length ? `, <b>${o.sinir_disi.length}</b> tanesi sınır dışı` : ", hepsi sınırlar içinde") +
      (ilk ? ` — <b>${kacisli(ilk.ad)}</b> (X${sayi(ilk.x)} Y${sayi(ilk.y)}) ile ` +
             `<b>${kacisli(son.ad)}</b> (X${sayi(son.x)} Y${sayi(son.y)}) arası, Z${sayi(ilk.z)}` : "") +
      `.${uyarilar.join("")}`;
    kutu.classList.remove("gizli");
    $("#d-izgara-uygula").classList.remove("gizli");
  } catch (hata) {
    kutu.innerHTML = `<span style="color:#ffb4b4">✕ ${kacisli(hata.message)}</span>`;
    kutu.classList.remove("gizli");
    $("#d-izgara-uygula").classList.add("gizli");
  }
}

async function izgaraUygula() {
  try {
    const o = await apiIste("/api/izgara/uygula", {
      method: "POST", body: JSON.stringify(izgaraGirdisi()),
    });
    gunluk(`✓ Izgara: ${o.eklendi} yeni, ${o.guncellendi} güncellendi (toplam ${o.toplam})`, "ok");
    $("#izgara-onizleme").classList.add("gizli");
    $("#d-izgara-uygula").classList.add("gizli");
    await noktalariYukle();
  } catch (hata) {
    gunluk(`✕ Izgara uygulanamadı: ${hata.message}`, "hata");
  }
}

/* ------------------------------------------------------------ yasak bölgeler */
// Bölgeler ajanda duruyor; panel yalnızca düzenleyici. Kaydetmek bir komut
// (bolge_kaydet) — sunucu kopya tutmuyor, ajan dosyaya yazıyor.
function bolgeleriCiz(bolgeler) {
  const kutu = $("#bolge-liste");
  if (!bolgeler.length) {
    kutu.innerHTML = '<p class="alt-not">Tanımlı bölge yok — hiçbir alan kısıtlı değil.</p>';
    return;
  }
  kutu.innerHTML = bolgeler.map((b, i) => `
    <div class="bolge" data-i="${i}">
      <div class="ust">
        <input class="b-ad" value="${kacisli(b.ad)}" placeholder="Bölge adı" maxlength="40">
        <label class="onay" title="Uç değiştirme dizisi sürerken bu bölge atlanır">
          <input type="checkbox" class="b-yuva"${b.yuva ? " checked" : ""}> yuva
        </label>
        <label class="onay" title="Kapalıyken bu bölge denetlenmez">
          <input type="checkbox" class="b-aktif"${b.aktif !== false ? " checked" : ""}> aktif
        </label>
        <button class="dugme b-sil" title="Bölgeyi sil">✕</button>
      </div>
      <div class="alan-izgara">
        <div class="alan"><label>X1</label><input type="number" class="b-x1" step="1" value="${b.x1}"></div>
        <div class="alan"><label>Y1</label><input type="number" class="b-y1" step="1" value="${b.y1}"></div>
        <div class="alan"><label>X2</label><input type="number" class="b-x2" step="1" value="${b.x2}"></div>
        <div class="alan"><label>Y2</label><input type="number" class="b-y2" step="1" value="${b.y2}"></div>
      </div>
      <div class="alan"><label>İzin koşulu</label>
        <input class="b-kosul" value="${kacisli(b.izin_kosulu || "")}"
               placeholder="boş bırakılırsa geçiş serbest"></div>
      ${b.uyari ? `<div class="rozet-uyari" style="display:block">
        ⚠ Koşul hatalı: ${kacisli(b.uyari)} — bu bölgedeki her hareket ENGELLENİR</div>` : ""}
    </div>`).join("");

  $$(".b-sil").forEach((d) => {
    d.onclick = () => {
      const liste = bolgeleriTopla();
      liste.splice(Number(d.closest(".bolge").dataset.i), 1);
      bolgeleriCiz(liste);
    };
  });
}

function bolgeleriTopla() {
  return $$("#bolge-liste .bolge").map((el) => ({
    ad: el.querySelector(".b-ad").value,
    x1: Number(el.querySelector(".b-x1").value),
    y1: Number(el.querySelector(".b-y1").value),
    x2: Number(el.querySelector(".b-x2").value),
    y2: Number(el.querySelector(".b-y2").value),
    izin_kosulu: el.querySelector(".b-kosul").value,
    yuva: el.querySelector(".b-yuva").checked,
    aktif: el.querySelector(".b-aktif").checked,
  }));
}

async function bolgeleriKaydet() {
  const sonuc = await komutGonder("bolge_kaydet", { bolgeler: bolgeleriTopla() });
  // Ajan doğrulanmış hâli geri gönderiyor: köşeler sıralanmış, koşul uyarısı
  // hesaplanmış. Kullanıcının gördüğü, kaydedilenle birebir aynı olsun.
  if (sonuc && sonuc.ok && sonuc.veri) {
    S.bolgeler = sonuc.veri.bolgeler;
    bolgeleriCiz(S.bolgeler);
  }
}

/* ----------------------------------------------------------- dikim alanları
 *
 * Yatakta toprağın gerçekten bulunduğu dikdörtgenler. Yasak bölgelerden iki
 * yerde ayrılıyor:
 *
 *   - Ajanda değil SUNUCUDA duruyorlar (bkz. sunucu/dikim.py): güvenlik
 *     kararı değil, veri geçerliliği kararı ve ajan kopukken de işlemeli.
 *     Bu yüzden `komutGonder` değil `apiIste` ile kaydediliyorlar.
 *   - Boş liste "kısıtlama yok" demek: alan tanımsızsa yatağın tamamı
 *     ekilebilir sayılıyor.
 */
function dikimCiz(alanlar) {
  const kutu = $("#dikim-liste");
  const ozet = $("#dikim-ozet");
  if (ozet) ozet.textContent = alanlar.length ? `${alanlar.length} alan` : "tanımsız";
  if (!alanlar.length) {
    kutu.innerHTML = '<p class="alt-not">Tanımlı dikim alanı yok — yatağın '
      + 'tamamı toprak sayılıyor ve her nokta kabul ediliyor.</p>';
    return;
  }
  kutu.innerHTML = alanlar.map((a, i) => `
    <div class="bolge" data-i="${i}">
      <div class="ust">
        <input class="da-ad" value="${kacisli(a.ad || "")}" placeholder="Alan adı" maxlength="40">
        <button class="dugme da-sil" title="Alanı sil">✕</button>
      </div>
      <div class="alan-izgara">
        <div class="alan"><label>X1</label><input type="number" class="da-x1" step="1" value="${a.x1}"></div>
        <div class="alan"><label>Y1</label><input type="number" class="da-y1" step="1" value="${a.y1}"></div>
        <div class="alan"><label>X2</label><input type="number" class="da-x2" step="1" value="${a.x2}"></div>
        <div class="alan"><label>Y2</label><input type="number" class="da-y2" step="1" value="${a.y2}"></div>
        <div class="alan" title="Boş bırakılırsa ajanın genel toprak_z değeri geçerli">
          <label>Toprak Z</label>
          <input type="number" class="da-z" step="0.1" placeholder="genel"
                 value="${a.toprak_z != null ? a.toprak_z : ""}"></div>
      </div>
      <div class="alt-not">${Math.abs(a.x2 - a.x1).toFixed(0)} × ${Math.abs(a.y2 - a.y1).toFixed(0)} mm</div>
    </div>`).join("");

  $$(".da-sil").forEach((d) => {
    d.onclick = () => {
      const liste = dikimTopla();
      liste.splice(Number(d.closest(".bolge").dataset.i), 1);
      dikimCiz(liste);
    };
  });
}

function dikimTopla() {
  return $$("#dikim-liste .bolge").map((el) => {
    const z = el.querySelector(".da-z").value;
    const a = {
      ad: el.querySelector(".da-ad").value,
      x1: Number(el.querySelector(".da-x1").value),
      y1: Number(el.querySelector(".da-y1").value),
      x2: Number(el.querySelector(".da-x2").value),
      y2: Number(el.querySelector(".da-y2").value),
    };
    // Boş metin sıfır DEĞİL: sıfır geçerli bir Z, boş "genel değeri kullan".
    if (z !== "") a.toprak_z = Number(z);
    return a;
  });
}

async function dikimYukle() {
  try {
    const y = await apiIste("/api/dikim");
    S.dikim = y.alanlar || [];
    dikimCiz(S.dikim);
    const yz = $("#dikim-yuzey");
    if (yz) {
      yz.textContent = y.toprak_z != null
        ? `Genel toprak yüzeyi: Z${Number(y.toprak_z).toFixed(0)} mm (ajanın plc.toprak_z ayarı)`
        : "Genel toprak yüzeyi ajandan gelmedi — Z0 varsayılıyor";
    }
  } catch (h) { gunluk(`✕ Dikim alanları okunamadı: ${h.message}`, "hata"); }
}

async function dikimKaydet() {
  try {
    const y = await apiIste("/api/dikim", {
      method: "PUT", body: JSON.stringify({ alanlar: dikimTopla() }) });
    // Sunucu doğrulanmış hâli geri veriyor: köşeler sıralanmış, adlar
    // kırpılmış. Kullanıcının gördüğü kaydedilenle birebir aynı olsun.
    S.dikim = y.alanlar || [];
    dikimCiz(S.dikim);
    gunluk(S.dikim.length
      ? `✓ ${S.dikim.length} dikim alanı kaydedildi`
      : "✓ Dikim alanı kalmadı — yatağın tamamı geçerli", "ok");
    if (window.Tarla && Tarla.dikimDegisti) await Tarla.dikimDegisti();
  } catch (h) { gunluk(`✕ Dikim alanı kaydedilemedi: ${h.message}`, "hata"); }
}

/* ------------------------------------------------------------ uç değiştirme */
function ucGuncelle(u) {
  if (!u) return;
  $("#uc-mevcut").textContent = u.uc || "yok";

  // Uç değiştirme alanı açıkken kullanıcı Z kilidinin kapalı olduğunu
  // bilmeli — sessizce açık kalan bir muafiyet, kilidin kendisinden tehlikeli.
  const alanAcik = !!(u.alan && u.alan.on);
  $("#tc-uyari").classList.toggle("gizli", !alanAcik);
  if (alanAcik) {
    $("#tc-nerede").innerHTML = u.alanda
      ? '<b>Makine şu anda alanın İÇİNDE</b> — kilit şu an uygulanmıyor.'
      : "Makine şu anda alanın dışında, kilit uygulanıyor.";
  }

  // Uç yuvası tablosu. Kullanıcı düzenlerken ÜZERİNE YAZMIYORUZ, yoksa
  // yazdığı koordinat bir sonraki durum paketinde siliniyor.
  const tools = u.tools || (u.ayar && u.ayar.tools) || [];
  const imza = JSON.stringify(tools);
  if (!S.ucAyarDuzenleniyor && imza !== S.sonUcTools) {
    S.sonUcTools = imza;
    S.sonUcAyar = { tools };
    ucTablosuCiz(tools, S.ucYollar);
    ucYollariTazele(false);
  } else if (!S.sonUcAyar) {
    S.sonUcAyar = { tools };
  }

  // Ayar alanları: kullanıcı düzenlerken üzerine yazmıyoruz.
  if (u.ayar && !S.ucAyarDuzenleniyor) {
    for (const [ad, deger] of Object.entries(u.ayar)) {
      const el = $("#ua-" + ad);
      if (el && document.activeElement !== el) el.value = deger === null ? "" : deger;
    }
    const zsr = $("#ua-z_safe_reg");
    if (zsr && document.activeElement !== zsr) zsr.value = u.z_safe_reg ?? 0;
    const kutu = $("#ua-alan-acik");
    if (kutu && document.activeElement !== kutu) kutu.checked = alanAcik;
    const pts = (u.alan && u.alan.pts) || [];
    pts.slice(0, 4).forEach((p, i) => {
      const ex = $(`#ua-k${i}x`), ey = $(`#ua-k${i}y`);
      if (ex && document.activeElement !== ex) ex.value = p[0];
      if (ey && document.activeElement !== ey) ey.value = p[1];
    });
    // Tohumluk: tanımsızsa alanlar BOŞ kalıyor, sıfır yazılmıyor —
    // sıfır geçerli bir koordinat ve ikisi karışmamalı.
    const th = u.tohumluk || {};
    ["x", "y", "z"].forEach((eksen) => {
      const el = $("#ua-th-" + eksen);
      if (el && document.activeElement !== el) {
        el.value = th[eksen] == null ? "" : th[eksen];
      }
    });
    const sb = u.sulama_basligi || {};
    [["dx", "dx"], ["dy", "dy"], ["zmin", "z_min"]].forEach(([kimlik, alan]) => {
      const el = $("#ua-sb-" + kimlik);
      if (el && document.activeElement !== el) {
        el.value = sb[alan] == null ? "" : sb[alan];
      }
    });
  }

  // Uç listesi ajandan geliyor; seçim kutusunu yalnız değiştiğinde yeniden
  // kuruyoruz, yoksa kullanıcının seçimi her durum paketinde sıfırlanırdı.
  const uclar = u.uclar || [];
  if (JSON.stringify(uclar) !== JSON.stringify(S.ucListesi)) {
    S.ucListesi = uclar;
    $("#uc-secim").innerHTML = uclar.map((a) => `<option>${kacisli(a)}</option>`).join("");
  }

  // Doğrulama durumu: sensör yoksa "başarılı" demiyoruz.
  const rozet = $("#uc-dogrulama");
  if (!u.sensor_var) {
    rozet.textContent = "⚠ Varlık sensörü bağlı değil — uç takıldı mı doğrulanamıyor";
    rozet.classList.remove("gizli");
  } else if (u.dogrulandi === true) {
    rozet.textContent = "✓ sensörle doğrulandı";
    rozet.classList.add("gizli");
  } else {
    rozet.classList.add("gizli");
  }

  const kutu = $("#uc-ilerleme");
  if (u.calisiyor || u.hata) {
    const oran = u.toplam ? Math.round((u.adim / u.toplam) * 100) : 0;
    kutu.innerHTML =
      (u.calisiyor
        ? `<b>${kacisli(u.dizi)}</b> — adım ${u.adim}/${u.toplam}<br>
           <span class="ornek" style="margin-top:4px;display:block">${kacisli(u.aciklama)}</span>
           <div class="adim-cubuk"><i style="width:${oran}%"></i></div>`
        : "") +
      (u.hata ? `<div class="rozet-uyari" style="display:block;margin-top:8px">
                   ✕ Dizi durdu (adım ${u.adim}/${u.toplam}): ${kacisli(u.hata)}</div>` : "");
    kutu.classList.remove("gizli");
  } else {
    kutu.classList.add("gizli");
  }

  $$("#d-uc-tak, #d-uc-birak, #d-uc-temizle").forEach((b) => {
    b.disabled = !S.ajanBagli || u.calisiyor;
  });
  $("#d-uc-dur").disabled = !u.calisiyor;

  // Takılı uç değişince önizleme de değişmeli (al → bırak).
  if (u.uc !== S.sonTakiliUc) { S.sonTakiliUc = u.uc; onizlemeTazele(); }
}

/* ------------------------------------------------------- uç yuva tablosu
 *
 * Uç yuvalarının koordinatları `ajan/uclar.json`da; buradan düzenleniyor
 * ve `uc_kaydet` ile ajana yazılıyor. Her satırın altında o uca giderken
 * izlenecek YOL var.
 *
 * Yolu AJAN hesaplıyor (`uc_yollari`), panel değil. Panelde ikinci bir
 * hesap kurmak, ekranda okunan yol ile makinenin gittiği yolun sessizce
 * ayrışması demek — uç değiştirme makinenin kendine çarpma riski en
 * yüksek hareketi olduğu için burada özellikle tehlikeli.
 */
function ucYoluYaz(adimlar) {
  if (!adimlar || !adimlar.length) return "";
  return adimlar.map((a) => {
    if (a.servo) {
      return `<b class="uc-servo" title="${kacisli(a.not || "")}">${
        a.servo === "kilitle" ? "🔒 kilitle" : "🔓 bırak"}</b>`;
    }
    const say_ = (v) => (v == null ? "·" : Math.round(v));
    return `<span title="${kacisli(a.not || "")}">${say_(a.x)},${say_(a.y)},${say_(a.z)}</span>`;
  }).join(" → ");
}

function ucTablosuCiz(tools, yollar) {
  const kutu = $("#uc-tablo");
  if (!kutu) return;
  const liste = tools || [];
  if (!liste.length) {
    kutu.innerHTML = '<p class="alt-not">Tanımlı uç yuvası yok.</p>';
    return;
  }
  /* Başlıklar bir kez, en üstte. Satır başına etiket tekrarlamak, 380
   * piksellik yan panelde alanları iki sıraya kırıyor ve tablo okunmaz
   * oluyordu. */
  kutu.innerHTML = `<div class="uc-baslik">
      <span>Uç</span><span>X mm</span><span>Y mm</span><span>Z kavrama</span><span></span>
    </div>` + liste.map((t, i) => {
    const y = (yollar || {})[t.name] || {};
    return `<div class="uc-satir" data-i="${i}">
      <div class="uc-hucreler">
        <input class="ut-ad" value="${kacisli(t.name || "")}" maxlength="40">
        <input type="number" class="ut-x" step="0.1" value="${t.x != null ? t.x : ""}">
        <input type="number" class="ut-y" step="0.1" value="${t.y != null ? t.y : ""}">
        <input type="number" class="ut-z" step="0.1"
               title="Kavrama yüksekliği — baş bu Z'de yandan kayıp kilitliyor"
               value="${t.z != null ? t.z : ""}">
        <button class="ut-sil" title="Bu yuvayı sil">✕</button>
      </div>
      ${(y.al || y.birak) ? `<div class="uc-yol alt-not">
        <div><span class="uc-yol-etiket">al</span>${ucYoluYaz(y.al)}</div>
        <div><span class="uc-yol-etiket">bırak</span>${ucYoluYaz(y.birak)}</div></div>` : ""}
    </div>`;
  }).join("");

  $$(".ut-sil").forEach((d) => {
    d.onclick = () => {
      const l = ucTablosuTopla();
      l.splice(Number(d.closest(".uc-satir").dataset.i), 1);
      ucTablosuCiz(l, S.ucYollar);
      S.ucAyarDuzenleniyor = true;
    };
  });
  kutu.querySelectorAll("input").forEach((g) => {
    g.oninput = () => { S.ucAyarDuzenleniyor = true; };
  });
}

function ucTablosuTopla() {
  return $$("#uc-tablo .uc-satir").map((el) => ({
    name: el.querySelector(".ut-ad").value.trim(),
    x: Number(el.querySelector(".ut-x").value),
    y: Number(el.querySelector(".ut-y").value),
    z: Number(el.querySelector(".ut-z").value),
  })).filter((t) => t.name);
}

async function ucTablosuKaydet() {
  const tools = ucTablosuTopla();
  const sonuc = await komutGonder("uc_kaydet", { ayar: { tools } });
  if (sonuc && sonuc.ok) {
    S.ucAyarDuzenleniyor = false;
    gunluk(`✓ ${tools.length} uç yuvası kaydedildi`, "ok");
    // Yolları yeniden çekiyoruz: koordinat değişti, yol da değişti.
    await ucYollariTazele(true);
  }
}

async function ucYollariTazele(zorla) {
  if (!S.ajanBagli) return;
  const sonuc = await komutGonder("uc_yollari", {});
  const v = sonuc && sonuc.veri;
  if (!v) return;
  S.ucYollar = v.yollar || {};
  if (zorla || !S.ucAyarDuzenleniyor) {
    ucTablosuCiz((S.sonUcAyar && S.sonUcAyar.tools) || [], S.ucYollar);
  }
}

/** Tak/Bırak'a basmadan önce izlenecek yolu koordinat koordinat göster. */
async function onizlemeTazele() {
  const kutu = $("#uc-onizleme");
  if (!S.ajanBagli) { kutu.classList.add("gizli"); return; }
  const takili = S.sonTakiliUc;
  const islem = takili ? "birak" : "al";
  const ad = takili || $("#uc-secim").value;
  if (!ad) { kutu.classList.add("gizli"); return; }

  const sonuc = await komutGonder("uc_onizle", { islem, ad });
  const v = sonuc && sonuc.veri;
  if (!v || !v.ok) { kutu.classList.add("gizli"); return; }

  const uyari = (v.uyari || []).length
    ? `<div class="rozet-uyari" style="display:block;margin-top:8px">⚠ ${
        v.uyari.map(kacisli).join("<br>⚠ ")}</div>`
    : "";
  kutu.innerHTML =
    `<b>${islem === "birak" ? "Bırakma" : "Takma"} yolu — '${kacisli(ad)}'</b>
     <div class="yol">${v.adimlar.map((a, i) => `${i + 1}. ${kacisli(a)}`).join("<br>")}</div>${uyari}`;
  kutu.classList.remove("gizli");
}

/* -------------------------------------------------------------- programlar */
const ADIM_TIPLERI = { nokta: "Noktaya git", bekle: "Bekle", role: "Röle", uc: "Uç değiştir" };
const ROLELER = ["su_pompasi", "hava_pompasi"];

function adimSatiri(adim, sira) {
  const secenek = (liste, secili) => liste
    .map((d) => `<option value="${kacisli(d)}"${d === secili ? " selected" : ""}>${kacisli(d || "(bırak)")}</option>`).join("");

  // Tanımlı değişkenler adım alanlarında "$ad" olarak seçilebiliyor: dizi
  // çağrılırken değeri veriliyor. "Şu noktayı sula" yerine "verilen noktayı sula".
  const degiskenler = (S.degiskenler || []);
  const degiskenAdlari = (tip) => degiskenler.filter((d) => d.tip === tip).map((d) => "$" + d.ad);

  let param = "";
  if (adim.tip === "nokta") {
    param = `<select class="param p-ad">${secenek(
      [...degiskenAdlari("nokta"), ...S.noktalar.map((n) => n.ad)], adim.ad)}</select>`;
  } else if (adim.tip === "bekle") {
    const sayiDegisken = degiskenAdlari("sayi");
    param = sayiDegisken.length
      ? `<select class="param p-saniye-sec">${secenek(
          ["(sayı gir)", ...sayiDegisken], String(adim.saniye).startsWith("$") ? adim.saniye : "(sayı gir)")}</select>
         <input type="number" class="param p-saniye${String(adim.saniye).startsWith("$") ? " gizli" : ""}"
                min="0" max="600" step="1" value="${String(adim.saniye).startsWith("$") ? 5 : (adim.saniye ?? 5)}"> sn`
      : `<input type="number" class="param p-saniye" min="0" max="600" step="1" value="${adim.saniye ?? 5}"> sn`;
  } else if (adim.tip === "role") {
    param = `<select class="param p-ad">${secenek(ROLELER, adim.ad)}</select>
             <label style="font-size:12px;color:var(--metin-3)">
               <input type="checkbox" class="p-durum"${adim.durum ? " checked" : ""}> aç</label>`;
  } else if (adim.tip === "uc") {
    param = `<select class="param p-ad">${secenek(["", ...S.ucListesi], adim.ad || "")}</select>`;
  }

  return `<div class="adim-satir" data-i="${sira}">
    <span class="sira">${sira + 1}</span>
    <select class="tip">${Object.entries(ADIM_TIPLERI)
      .map(([k, v]) => `<option value="${k}"${k === adim.tip ? " selected" : ""}>${v}</option>`).join("")}</select>
    ${param}
    <button class="dugme adim-sil">✕</button>
  </div>`;
}

function adimlariCiz(adimlar) {
  S.adimlar = adimlar;
  const kutu = $("#prog-adimlar");
  kutu.innerHTML = adimlar.length
    ? adimlar.map(adimSatiri).join("")
    : '<p class="alt-not">Adım yok — "+ Adım ekle" ile başlayın.</p>';

  $$("#prog-adimlar .tip").forEach((sec) => {
    // Tip değişince parametre alanı da değişmeli; satırı yeniden çiziyoruz.
    sec.onchange = () => {
      const liste = adimlariTopla();
      liste[Number(sec.closest(".adim-satir").dataset.i)] = { tip: sec.value };
      adimlariCiz(liste);
    };
  });
  $$("#prog-adimlar .adim-sil").forEach((d) => {
    d.onclick = () => {
      const liste = adimlariTopla();
      liste.splice(Number(d.closest(".adim-satir").dataset.i), 1);
      adimlariCiz(liste);
    };
  });
}

/* ------------------------------------------------------ dizi değişkenleri
 *
 * Bir dizi "verilen noktayı sula" diyebilsin diye. Değişken tanımı dizinin
 * yanında duruyor; adımlarda "$ad" yazılan yere değeri dizi ÇALIŞTIRILIRKEN
 * konuyor. Yerleştirme ve eksik değer denetimi sunucuda (programlar.py),
 * panelde değil.
 */
const DEGISKEN_TIPLERI = { nokta: "Nokta", sayi: "Sayı", metin: "Metin" };

function degiskenSatiri(d, sira) {
  return `<div class="degisken-satir" data-i="${sira}">
    <span class="degisken-isaret">$</span>
    <input type="text" class="dv-ad" maxlength="24" placeholder="hedef" value="${kacisli(d.ad || "")}">
    <select class="dv-tip">${Object.entries(DEGISKEN_TIPLERI)
      .map(([k, v]) => `<option value="${k}"${k === d.tip ? " selected" : ""}>${v}</option>`).join("")}</select>
    <input type="text" class="dv-aciklama" maxlength="80" placeholder="açıklama (isteğe bağlı)"
           value="${kacisli(d.aciklama || "")}">
    <button class="dugme degisken-sil">✕</button>
  </div>`;
}

function degiskenleriCiz(liste) {
  S.degiskenler = liste;
  const kutu = $("#prog-degiskenler");
  kutu.innerHTML = liste.length
    ? liste.map(degiskenSatiri).join("")
    : '<p class="alt-not">Değişken yok — dizi hep aynı noktalara gider.</p>';
  $$("#prog-degiskenler .degisken-sil").forEach((d) => {
    d.onclick = () => {
      const l = degiskenleriTopla();
      l.splice(Number(d.closest(".degisken-satir").dataset.i), 1);
      degiskenleriCiz(l);
      adimlariCiz(adimlariTopla());     // adım açılır listeleri değişti
    };
  });
  // Ad ya da tip değişince adım listelerindeki seçenekler de değişmeli.
  $$("#prog-degiskenler .dv-ad, #prog-degiskenler .dv-tip").forEach((g) => {
    g.onchange = () => { degiskenleriCiz(degiskenleriTopla()); adimlariCiz(adimlariTopla()); };
  });
}

function degiskenleriTopla() {
  return $$("#prog-degiskenler .degisken-satir").map((el) => ({
    ad: el.querySelector(".dv-ad").value.trim(),
    tip: el.querySelector(".dv-tip").value,
    aciklama: el.querySelector(".dv-aciklama").value.trim(),
  })).filter((d) => d.ad);
}

/** Seçili dizi değişken istiyorsa değer formunu çizer, istemiyorsa gizler. */
function degerFormuCiz() {
  const kutu = $("#prog-degerler");
  const p = S.programlar.find((x) => x.ad === $("#prog-secim").value);
  const liste = (p && p.degiskenler) || [];
  if (!liste.length) { kutu.classList.add("gizli"); kutu.innerHTML = ""; return; }
  kutu.classList.remove("gizli");
  kutu.innerHTML = `<div class="alt-not">Bu dizi çalıştırılırken değer istiyor:</div>` +
    liste.map((d) => {
      const alan = d.tip === "nokta"
        ? `<select class="dg-deger" data-ad="${kacisli(d.ad)}">${
            S.noktalar.map((n) => `<option>${kacisli(n.ad)}</option>`).join("")}</select>`
        : `<input type="${d.tip === "sayi" ? "number" : "text"}" class="dg-deger"
                  data-ad="${kacisli(d.ad)}" placeholder="${kacisli(d.aciklama || d.tip)}">`;
      return `<div class="deger-satir">
        <label>$${kacisli(d.ad)}</label>${alan}
        ${d.aciklama ? `<span class="alt-not">${kacisli(d.aciklama)}</span>` : ""}
      </div>`;
    }).join("");
}

function degerleriTopla() {
  const d = {};
  $$("#prog-degerler .dg-deger").forEach((g) => { d[g.dataset.ad] = g.value; });
  return d;
}

function adimlariTopla() {
  return $$("#prog-adimlar .adim-satir").map((el) => {
    const tip = el.querySelector(".tip").value;
    const adim = { tip };
    if (tip === "nokta" || tip === "uc") adim.ad = el.querySelector(".p-ad")?.value || "";
    if (tip === "bekle") {
      const sec = el.querySelector(".p-saniye-sec");
      adim.saniye = sec && sec.value.startsWith("$")
        ? sec.value
        : Number(el.querySelector(".p-saniye").value);
    }
    if (tip === "role") {
      adim.ad = el.querySelector(".p-ad").value;
      adim.durum = el.querySelector(".p-durum").checked;
    }
    return adim;
  });
}


/* ================================================== kamera kalibrasyonu
 *
 * Fotoğrafı haritaya oturtan sayılar. Hesap sunucuda (kalibrasyon.py);
 * panelin işi tıklanan pikselleri ve o anki eksen konumunu toplamak.
 *
 * İki kare yöntemi: makine bilinen bir mesafe oynuyor, aynı toprak parçası
 * iki karede işaretleniyor. Piksel farkı ile mm farkı hem ölçeği hem açıyı
 * veriyor.
 */
const KALIB = { kare1: null, kare2: null, bekleyen: 0 };

function kalibDurumYaz(k) {
  const rozet = $("#kalib-durum");
  if (!rozet) return;
  rozet.textContent = k && Number(k.mm_px) > 0
    ? `${Number(k.mm_px).toFixed(3)} mm/px · ${Number(k.donme).toFixed(1)}°`
    : "kalibre edilmedi";
}

async function kalibrasyonYukle() {
  try {
    const y = await apiIste("/api/kamera/kalibrasyon");
    const k = y.kalibrasyon || {};
    S.kalibrasyon = k;
    $("#kalib-mmpx").value = k.mm_px ?? 0;
    $("#kalib-donme").value = k.donme ?? 0;
    $("#kalib-ofx").value = k.ofset_x ?? 0;
    $("#kalib-ofy").value = k.ofset_y ?? 0;
    $("#kalib-ayna-x").checked = !!k.ayna_x;
    $("#kalib-ayna-y").checked = !!k.ayna_y;
    kalibDurumYaz(k);
  } catch (hata) { /* kalibrasyon yoksa sorun değil */ }
}

/** İşaretleri kare görüntüsünün üstüne çiziyor. */
function kalibIsaretCiz() {
  const im = $("#kalib-kare"), tuval = $("#kalib-tuval");
  if (!im || !tuval || !im.clientWidth) return;
  tuval.width = im.clientWidth;
  tuval.height = im.clientHeight;
  const c = tuval.getContext("2d");
  c.clearRect(0, 0, tuval.width, tuval.height);
  const olcek = im.clientWidth / (im.naturalWidth || 1);
  [[KALIB.kare1, "1", "#3987e5"], [KALIB.kare2, "2", "#d95926"]].forEach(([k, ad, renk]) => {
    if (!k) return;
    const x = k.u * olcek, y = k.v * olcek;
    c.strokeStyle = renk; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.stroke();
    c.beginPath();
    c.moveTo(x - 14, y); c.lineTo(x + 14, y);
    c.moveTo(x, y - 14); c.lineTo(x, y + 14);
    c.stroke();
    c.fillStyle = renk;
    c.font = "bold 12px ui-sans-serif, system-ui";
    c.fillText(ad, x + 12, y - 12);
  });
}

function kalibSonucCiz(metin, iyi) {
  const kutu = $("#kalib-sonuc");
  kutu.classList.remove("gizli");
  kutu.innerHTML = `<div class="${iyi ? "" : "hata-yazi"}">${kacisli(metin)}</div>`;
}

async function kalibIsaretle(hangi) {
  const im = $("#kalib-kare");
  if (!im || !im.naturalWidth) { gunluk("Önce bir kamera karesi gelmeli", "uyari"); return; }
  const k = S.konum || {};
  if (k.x == null || k.y == null) { gunluk("Eksen konumu bilinmiyor", "uyari"); return; }
  KALIB.bekleyen = hangi;
  $("#kalib-yonerge").textContent =
    `${hangi}. kare için görüntüde toprak parçasına tıklayın — konum X${k.x.toFixed(1)} Y${k.y.toFixed(1)}`;
  $("#kalib-tuval").classList.add("bekliyor");
}

async function kalibTiklandi(olay) {
  if (!KALIB.bekleyen) return;
  const im = $("#kalib-kare");
  const kutu = im.getBoundingClientRect();
  const olcek = (im.naturalWidth || 1) / (kutu.width || 1);
  const kayit = {
    x: S.konum.x, y: S.konum.y,
    u: (olay.clientX - kutu.left) * olcek,
    v: (olay.clientY - kutu.top) * olcek,
  };
  if (KALIB.bekleyen === 1) KALIB.kare1 = kayit; else KALIB.kare2 = kayit;
  KALIB.bekleyen = 0;
  $("#kalib-tuval").classList.remove("bekliyor");
  kalibIsaretCiz();

  if (!KALIB.kare1 || !KALIB.kare2) {
    $("#kalib-yonerge").textContent =
      "İkinci kare için makineyi en az 20 mm oynatın, yeni kare gelince aynı yere tıklayın.";
    return;
  }
  try {
    const y = await apiIste("/api/kamera/kalibrasyon/coz", {
      method: "POST",
      body: JSON.stringify({
        kare1: KALIB.kare1, kare2: KALIB.kare2, kaydet: true,
        genislik_px: im.naturalWidth, yukseklik_px: im.naturalHeight,
      }),
    });
    const s = y.sonuc;
    kalibSonucCiz(
      `${s.mm_mesafe.toFixed(1)} mm hareket · ${s.px_mesafe.toFixed(1)} px kayma → ` +
      `${s.mm_px.toFixed(4)} mm/px · ${s.donme.toFixed(1)}° · kaydedildi`, true);
    await kalibrasyonYukle();
    if (window.Tarla && window.Tarla.kalibrasyonDegisti) window.Tarla.kalibrasyonDegisti();
  } catch (hata) {
    kalibSonucCiz(hata.message, false);
  }
}

function kalibSifirla() {
  KALIB.kare1 = KALIB.kare2 = null;
  KALIB.bekleyen = 0;
  $("#kalib-tuval").classList.remove("bekliyor");
  $("#kalib-sonuc").classList.add("gizli");
  $("#kalib-yonerge").textContent =
    "1. Makineyi bir yere götürün, kare gelsin, aşağıda bir toprak parçasına tıklayın. " +
    "2. Makineyi en az 20 mm oynatın, yeni kare gelsin, aynı yere tıklayın.";
  kalibIsaretCiz();
}

function kalibBagla() {
  const tuval = $("#kalib-tuval");
  if (!tuval) return;
  tuval.onclick = kalibTiklandi;
  $("#d-kalib-kare1").onclick = () => kalibIsaretle(1);
  $("#d-kalib-kare2").onclick = () => kalibIsaretle(2);
  $("#d-kalib-temizle").onclick = kalibSifirla;
  $("#d-kalib-kaydet").onclick = async () => {
    try {
      const y = await apiIste("/api/kamera/kalibrasyon", {
        method: "POST",
        body: JSON.stringify({
          mm_px: Number($("#kalib-mmpx").value),
          donme: Number($("#kalib-donme").value),
          ofset_x: Number($("#kalib-ofx").value),
          ofset_y: Number($("#kalib-ofy").value),
          ayna_x: $("#kalib-ayna-x").checked,
          ayna_y: $("#kalib-ayna-y").checked,
          yontem: "elle", guncelleme: Date.now() / 1000,
        }),
      });
      S.kalibrasyon = y.kalibrasyon;
      kalibDurumYaz(y.kalibrasyon);
      gunluk("✓ Kamera kalibrasyonu kaydedildi", "ok");
      if (window.Tarla && window.Tarla.kalibrasyonDegisti) window.Tarla.kalibrasyonDegisti();
    } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
  };
  window.addEventListener("resize", kalibIsaretCiz);
}


/* ============================================================== eğriler
 *
 * Sabit "günde X ml" yerine bitkinin YAŞINA göre değer. Değerlendirme
 * sunucuda (egriler.py); panelin işi eğriyi düzenlemek ve çizmek.
 */
const EGRI_BIRIM = { su: "ml/gün", yayilim: "mm", yukseklik: "mm" };

function egriNoktaSatiri(n, sira) {
  return `<div class="egri-satir" data-i="${sira}">
    <span class="alt-not">gün</span>
    <input type="number" class="en-gun" min="0" max="400" step="1" value="${n[0]}">
    <span class="alt-not en-birim">değer</span>
    <input type="number" class="en-deger" min="0" step="1" value="${n[1]}">
    <button class="dugme egri-nokta-sil">✕</button>
  </div>`;
}

function egriNoktalariCiz(noktalar) {
  S.egriNoktalari = noktalar;
  const kutu = $("#egri-noktalar");
  kutu.innerHTML = noktalar.length
    ? noktalar.map(egriNoktaSatiri).join("")
    : '<p class="alt-not">Nokta yok — en az iki nokta gerekiyor.</p>';
  const birim = EGRI_BIRIM[$("#egri-tip").value] || "";
  $$("#egri-noktalar .en-birim").forEach((e) => { e.textContent = birim; });
  $$("#egri-noktalar .egri-nokta-sil").forEach((d) => {
    d.onclick = () => {
      const l = egriNoktalariTopla();
      l.splice(Number(d.closest(".egri-satir").dataset.i), 1);
      egriNoktalariCiz(l);
      egriCiz();
    };
  });
  $$("#egri-noktalar input").forEach((g) => { g.onchange = egriCiz; });
  egriCiz();
}

function egriNoktalariTopla() {
  return $$("#egri-noktalar .egri-satir").map((el) => [
    Number(el.querySelector(".en-gun").value),
    Number(el.querySelector(".en-deger").value),
  ]);
}

/** Eğriyi çiziyor — kaydetmeden önce ne yaptığını görmek için. */
function egriCiz() {
  const tuval = $("#egri-tuval");
  if (!tuval) return;
  const c = tuval.getContext("2d");
  const g = tuval.clientWidth || 400, y = tuval.clientHeight || 140;
  const oran = Math.min(window.devicePixelRatio || 1, 2);
  tuval.width = g * oran; tuval.height = y * oran;
  c.setTransform(oran, 0, 0, oran, 0, 0);
  c.clearRect(0, 0, g, y);

  const noktalar = egriNoktalariTopla().slice().sort((a, b) => a[0] - b[0]);
  // ust: 22 — birim yazısı en üstteki ızgara etiketiyle çakışmasın.
  const kenar = { sol: 42, sag: 10, ust: 22, alt: 22 };
  const gg = g - kenar.sol - kenar.sag, yy = y - kenar.ust - kenar.alt;
  const enGun = Math.max(1, ...noktalar.map((n) => n[0]));
  const enDeger = Math.max(1, ...noktalar.map((n) => n[1]));
  const px = (gun) => kenar.sol + (gun / enGun) * gg;
  const py = (d) => kenar.ust + (1 - d / enDeger) * yy;

  c.font = "10px ui-monospace, Menlo, Consolas, monospace";
  c.strokeStyle = "#2a2a28"; c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yv = kenar.ust + (yy * i) / 4;
    c.beginPath(); c.moveTo(kenar.sol, yv); c.lineTo(g - kenar.sag, yv); c.stroke();
    c.fillStyle = "#8a8a80"; c.textAlign = "right";
    c.fillText(String(Math.round(enDeger * (1 - i / 4))), kenar.sol - 6, yv + 3);
  }
  c.fillStyle = "#8a8a80"; c.textAlign = "left";
  c.fillText("gün", kenar.sol, y - 6);
  c.textAlign = "right";
  c.fillText(String(Math.round(enGun)), g - kenar.sag, y - 6);
  c.textAlign = "left";
  c.fillText(EGRI_BIRIM[$("#egri-tip").value] || "", 4, 10);

  if (noktalar.length < 2) return;
  c.strokeStyle = "var(--vurgu)";
  c.strokeStyle = "#3987e5";
  c.lineWidth = 2;
  c.beginPath();
  noktalar.forEach((n, i) => (i ? c.lineTo(px(n[0]), py(n[1])) : c.moveTo(px(n[0]), py(n[1]))));
  c.stroke();
  c.fillStyle = "rgba(57,135,229,.12)";
  c.lineTo(px(noktalar[noktalar.length - 1][0]), py(0));
  c.lineTo(px(noktalar[0][0]), py(0));
  c.closePath(); c.fill();
  c.fillStyle = "#3987e5";
  noktalar.forEach((n) => {
    c.beginPath(); c.arc(px(n[0]), py(n[1]), 3.5, 0, Math.PI * 2); c.fill();
  });
}

async function egrileriYukle(secilecek) {
  try {
    const y = await apiIste("/api/egriler");
    S.egriler = y.egriler || [];
    S.egriSablonlari = y.sablonlar || [];
    const secili = secilecek || $("#egri-secim").value;
    $("#egri-secim").innerHTML = S.egriler.length
      ? S.egriler.map((e) => `<option${e.ad === secili ? " selected" : ""}>${kacisli(e.ad)}</option>`).join("")
      : '<option value="">(eğri yok)</option>';
    $("#egri-sablon").innerHTML = S.egriSablonlari
      .map((e, i) => `<option value="${i}">${kacisli(e.ad)}</option>`).join("");
    if (secili && S.egriler.some((e) => e.ad === secili)) egriYukle(secili);
    // Bitki kartındaki eğri seçenekleri de aynı listeden besleniyor.
    if (window.Tarla && window.Tarla.egrilerDegisti) window.Tarla.egrilerDegisti(S.egriler);
  } catch (hata) { /* eğri yoksa sorun değil */ }
}

function egriYukle(ad) {
  const e = S.egriler.find((x) => x.ad === ad);
  if (!e) return;
  $("#egri-ad").value = e.ad;
  $("#egri-tip").value = e.tip;
  egriNoktalariCiz(e.noktalar.map((n) => [...n]));
}

function egriBagla() {
  if (!$("#egri-secim")) return;
  $("#egri-secim").onchange = () => egriYukle($("#egri-secim").value);
  $("#egri-tip").onchange = () => egriNoktalariCiz(egriNoktalariTopla());
  $("#d-egri-yeni").onclick = () => {
    $("#egri-ad").value = "";
    egriNoktalariCiz([[0, 20], [30, 150]]);
  };
  $("#d-egri-nokta-ekle").onclick = () => {
    const l = egriNoktalariTopla();
    const son = l.length ? l[l.length - 1] : [0, 0];
    egriNoktalariCiz([...l, [son[0] + 10, son[1]]]);
  };
  $("#d-egri-sablon").onclick = () => {
    const s = S.egriSablonlari[Number($("#egri-sablon").value)];
    if (!s) return;
    $("#egri-ad").value = s.ad;
    $("#egri-tip").value = s.tip;
    egriNoktalariCiz(s.noktalar.map((n) => [...n]));
  };
  $("#d-egri-kaydet").onclick = async () => {
    try {
      const y = await apiIste("/api/egriler", {
        method: "POST",
        body: JSON.stringify({ ad: $("#egri-ad").value, tip: $("#egri-tip").value,
                               noktalar: egriNoktalariTopla() }),
      });
      gunluk(`✓ '${y.egri.ad}' eğrisi kaydedildi`, "ok");
      await egrileriYukle(y.egri.ad);
    } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
  };
  $("#d-egri-sil").onclick = async () => {
    const ad = $("#egri-secim").value;
    if (!ad || !confirm(`'${ad}' eğrisi silinsin mi?`)) return;
    try {
      await apiIste(`/api/egriler?ad=${encodeURIComponent(ad)}`, { method: "DELETE" });
      gunluk(`✓ '${ad}' silindi`, "ok");
      await egrileriYukle();
    } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
  };
  window.addEventListener("resize", egriCiz);
  egriNoktalariCiz([[0, 20], [30, 150]]);
}


/* ============================================================== geri alma
 *
 * Silme HEMEN uygulanıyor — yarı silinmiş bir nokta diziye, sınır denetimine
 * ve haritaya "var" görünürdü. Kayıtlar sunucuda 30 saniye bekliyor; bu şerit
 * o pencereyi gösteriyor ve geri sayım bitince kendini kapatıyor.
 *
 * Onay penceresinin yerine geçiyor: "12 nokta silinecek, emin misiniz?"
 * sorusu hangi 12 olduğunu göstermiyor, geri alma ise gösteriyor.
 */
const GERI = { kimlik: null, biter: 0, sayac: null };

function geriAlKapat() {
  GERI.kimlik = null;
  if (GERI.sayac) { clearInterval(GERI.sayac); GERI.sayac = null; }
  const serit = $("#geri-al-serit");
  if (serit) serit.classList.add("gizli");
}

/** Sunucudan gelen `geri_al` özetini şeride koyuyor. */
function geriAlGoster(parti) {
  if (!parti || !parti.kimlik) return;
  const serit = $("#geri-al-serit");
  if (!serit) return;
  if (GERI.sayac) clearInterval(GERI.sayac);

  GERI.kimlik = parti.kimlik;
  GERI.biter = Date.now() + (Number(parti.kalan_sn) || 0) * 1000;

  const adlar = (parti.adlar || []).filter(Boolean);
  const kuyruk = parti.adet > adlar.length ? ` … ve ${parti.adet - adlar.length} tane daha` : "";
  $("#geri-al-metin").innerHTML =
    `<b>${kacisli(parti.aciklama)}</b>` +
    (adlar.length ? ` <span class="alt-not">${kacisli(adlar.join(", "))}${kacisli(kuyruk)}</span>` : "");
  serit.classList.remove("gizli");

  const tik = () => {
    const kalan = Math.max(0, Math.ceil((GERI.biter - Date.now()) / 1000));
    $("#geri-al-sayac").textContent = `${kalan} sn`;
    if (kalan <= 0) geriAlKapat();
  };
  tik();
  GERI.sayac = setInterval(tik, 250);
}

async function geriAlUygula() {
  const kimlik = GERI.kimlik;
  if (!kimlik) return;
  geriAlKapat();
  try {
    const y = await apiIste("/api/geri-al", {
      method: "POST", body: JSON.stringify({ kimlik }),
    });
    gunluk(`✓ ${y.mesaj}`, "ok");
    await noktalariYukle();
  } catch (hata) {
    gunluk(`✕ Geri alınamadı: ${hata.message}`, "hata");
  }
}


/* ======================================================= bağlantı tanıları
 *
 * Panel eskiden ham hatayı gösteriyordu:
 *
 *     PLC ile konuşulamadı (192.168.1.88:502): timed out
 *
 * Bu cümle neyin koptuğunu söylüyor ama ne yapılacağını söylemiyor. Metinler
 * artık ajandaki `tani.py` tablosunda; ajan durum paketiyle hazır hâlde
 * gönderiyor, panel yalnız çiziyor. Aynı tablodan `tanila.py` de okuduğu
 * için komut satırındaki ipucu ile buradaki hiçbir zaman ayrışmıyor.
 *
 * TEK istisna aşağıdaki: ajan sunucuya bağlanamadığında ajandan bir şey
 * gelemez, o yüzden bu arızayı panel kendi biliyor.
 */
const TANI_YEREL = {
  ajan_yok: {
    kimlik: "ajan_yok",
    baslik: "Raspberry Pi sunucuya bağlı değil",
    ne_koptu: "Panel sunucusu çalışıyor ama ajandan haber gelmiyor — " +
              "makineye hiçbir komut ulaşmıyor.",
    sebepler: [
      "Pi kapalı, uyanmamış ya da ağdan düşmüş.",
      "Ajan servisi çalışmıyor ya da çökmüş.",
      "Pi'nin internet erişimi yok (bulut sunucusuna ulaşamıyor).",
      "AJAN_JETONU sunucudakiyle aynı değil — bağlantı reddediliyor.",
    ],
    adimlar: [
      // Adresi sabit yazmak yanlis yonlendiriyordu: Pi yeniden kurulunca
      // Tailscale adresi degisti ve tani olu bir adresi onermeye devam etti.
      // Tarayici zaten dogru adresten baglandi; onu soyluyoruz.
      `Pi'ye bağlanın:  ssh batupi@${location.hostname}`,
      "Servisi kontrol edin:  systemctl status farmbot-ajan",
      "Günlüğe bakın:  journalctl -u farmbot-ajan -n 50",
      "Pi'nin internetini deneyin:  ping -c3 1.1.1.1",
      "Jetonu karşılaştırın: ayarlar.json'daki `jeton` ile sunucudaki " +
      "AJAN_JETONU aynı olmalı.",
    ],
  },
};

function taniKarti(t) {
  const liste = (dizi, sinif) => (dizi || []).length
    ? `<ul class="${sinif}">${dizi.map((x) => `<li>${kacisli(x)}</li>`).join("")}</ul>` : "";
  // Katlanabilir: acikken tani ekranin yarisini yiyip sahneyi kose sikistiriyordu.
  // Ozet satiri neyin koptugunu zaten soyluyor; ayrinti isteyen aciyor.
  return `<details class="tani">
    <summary class="tani-bas">⚠ ${kacisli(t.baslik)} <span class="tani-ne">${kacisli(t.ne_koptu)}</span></summary>
    ${t.ham ? `<div class="tani-ham"><code>${kacisli(t.ham)}</code></div>` : ""}
    <div class="tani-govde">
      <div><span class="tani-etiket">Olası sebep</span>${liste(t.sebepler, "tani-sebep")}</div>
      <div><span class="tani-etiket">Ne yapmalı</span>${liste(t.adimlar, "tani-adim")}</div>
    </div>
  </details>`;
}

/** Etkin tanıları çiziyor. Boşsa bant hiç görünmüyor. */
function tanilariCiz(d) {
  const bant = $("#tani-bant");
  if (!bant) return;
  const hepsi = [];
  // Ajan bağlı değilse ajandan tanı gelemez — bunu panel kendi söylüyor.
  if (!d || !d.bagli) hepsi.push(TANI_YEREL.ajan_yok);
  else (d.tanilar || []).forEach((t) => t && t.baslik && hepsi.push(t));

  const imza = hepsi.map((t) => t.kimlik + (t.ham || "")).join("|");
  if (imza === S.taniImzasi) return;      // aynı tanı — DOM'a dokunma
  S.taniImzasi = imza;

  bant.classList.toggle("gizli", !hepsi.length);
  $("#tani-liste").innerHTML = hepsi.map(taniKarti).join("");
}

async function programlariYukle(secilecek) {
  try {
    const govde = await apiIste("/api/programlar");
    S.programlar = govde.programlar || [];
    const secili = secilecek || $("#prog-secim").value;
    $("#prog-secim").innerHTML = S.programlar
      .map((p) => `<option${p.ad === secili ? " selected" : ""}>${kacisli(p.ad)}</option>`).join("");
    if (secili && S.programlar.some((p) => p.ad === secili)) programYukle(secili);
    else degerFormuCiz();
    // Haritadaki "Dizi uygula" listesi de aynı kaynaktan besleniyor.
    if (window.Tarla && window.Tarla.dizilerDegisti) window.Tarla.dizilerDegisti(S.programlar);
  } catch (hata) {
    gunluk(`✕ Programlar yüklenemedi: ${hata.message}`, "hata");
  }
}

function programYukle(ad) {
  const p = S.programlar.find((x) => x.ad === ad);
  if (!p) return;
  $("#prog-ad").value = p.ad;
  $("#prog-tekrar").value = p.tekrar || 1;
  degiskenleriCiz((p.degiskenler || []).map((d) => ({ ...d })));
  adimlariCiz(p.adimlar.map((a) => ({ ...a })));
  degerFormuCiz();
}

function diziGuncelle(d) {
  if (!d) return;
  const kutu = $("#prog-ilerleme");
  if (d.calisiyor || d.hata) {
    const oran = d.toplam ? Math.round((d.adim / d.toplam) * 100) : 0;
    kutu.innerHTML =
      (d.calisiyor
        ? `<b>${kacisli(d.ad)}</b> — adım ${d.adim}/${d.toplam}` +
          (d.tekrar > 1 ? ` · tur ${d.tur}/${d.tekrar}` : "") +
          `<br><span class="ornek" style="margin-top:4px;display:block">${kacisli(d.aciklama || "")}</span>
           <div class="adim-cubuk"><i style="width:${oran}%"></i></div>`
        : "") +
      (d.hata ? `<div class="rozet-uyari" style="display:block;margin-top:8px">
                   ✕ Dizi ${d.adim}. adımda durdu: ${kacisli(d.hata)}</div>` : "");
    kutu.classList.remove("gizli");
  } else {
    kutu.classList.add("gizli");
  }
  $("#d-prog-calistir").disabled = !S.ajanBagli || d.calisiyor;
  $("#d-prog-durdur").disabled = !d.calisiyor;
}

/* ------------------------------------------------------------------ kamera */
// Kamera bir eklenti: kapaliyken makinenin hicbir islevi etkilenmiyor.
// Dugme calisma anini degistiriyor, ayar dosyasina yazmiyor — panelden
// yapilan gecici bir deneme yeniden baslatmada surpriz olmasin.
function kameraGoruntuTemizle() {
  // Kamera kapaninca ekranda eski kare kalmamali: "kapali" yazip yaninda
  // canliymis gibi duran bir goruntu birakmak yanlis bilgi.
  const img = $("#kamera-kare");
  if (img) { img.removeAttribute("src"); img.classList.add("gizli"); }
  const yok = $("#kamera-yok");
  if (yok) { yok.textContent = "Kamera kapalı."; yok.classList.remove("gizli"); }
  const zaman = $("#kamera-zaman");
  if (zaman) zaman.textContent = "";
  // Kamera kapandıysa yüzen kutu da gitmeli: son kare orada asılı kalırsa
  // kapalı bir kamerayı açık sanırsınız.
  const yuzen = $("#kamera-yuzen");
  if (yuzen) yuzen.classList.add("gizli");
}

function kameraDurumYaz(k) {
  const anahtar = $("#a-kamera");
  const not = $("#kamera-durum");
  if (!anahtar || !not) return;
  const acik = !!(k && k.acik);
  // Kullanici anahtari surukluyorken altindan degistirmeyelim.
  if (document.activeElement !== anahtar) anahtar.checked = acik;
  anahtar.disabled = !k;
  $$(".kamera-aralik").forEach((d) => { d.disabled = !k; });
  if (!k) { not.textContent = "—"; return; }
  const sn = k.aralik_sn || 3600;
  const aralik = sn >= 3600 ? `${Math.round(sn / 3600)} saatte`
    : sn >= 60 ? `${Math.round(sn / 60)} dakikada`
    : `${Math.round(sn)} saniyede`;
  // Canlı akışta "30 saniyede bir kare" yazmak yanlış: kareler aralıkla
  // değil akıştan geliyor.
  not.textContent = !acik ? "kapalı"
    : k.canli ? `canlı · ${k.yontem || "?"}`
    : `açık · ${k.yontem || "?"} · ${aralik} bir kare`;

  // Hangi aralığın seçili olduğu düğmelerde görünsün. Kaynak ajanın
  // bildirdiği değer — panel kendi seçimini hatırlamıyor, çünkü aralık
  // başka bir sekmeden ya da ayar dosyasından da değişmiş olabilir.
  const canli = !!k.canli;
  const canliDugme = $("#d-kamera-canli");
  if (canliDugme) {
    canliDugme.classList.toggle("secili", canli);
    // Akış yapamayan bir yolda (fswebcam) düğmeyi tıklanabilir bırakmak,
    // basıp hata almak demek; sebebini söyleyip kapatmak daha dürüst.
    canliDugme.disabled = !k.canli_var;
    canliDugme.title = k.canli_var ? ""
      : "Bu kamera yönteminde canlı akış yok (picamera2 ya da rpicam gerekiyor)";
  }
  // Canlı akış açıkken aralık düğmelerinin anlamı yok: kareler aralıkla
  // değil akıştan geliyor.
  $$(".kamera-aralik").forEach((d) => {
    d.classList.toggle("secili", !canli && Math.round(sn) === Number(d.dataset.saniye));
    // Kamera KAPALIYKEN de tıklanabilir: düğme aralığı seçip kamerayı
    // açıyor. Kapatmak, "5 sn"e basıp hiçbir şey olmamasına yol açardı.
    // Yalnızca ajan yokken kapalı — o zaman komut gidecek yer yok.
  });

  // Ham hata metnini duruma yapistirmiyoruz: libcamera'nin ciktisi satirlarca
  // surer ve karti okunmaz hale getirir. Kisa bir isaret yeter, ayrintisi
  // zaten olay gunlugune dusuyor.
  const kutu = $("#kamera-yok");
  if (!acik) {
    kameraGoruntuTemizle();
  } else if (k.hata) {
    not.textContent += " · kare alınamıyor";
    if (kutu) { kutu.textContent = "Kare alınamıyor — ayrıntı olay günlüğünde."; kutu.classList.remove("gizli"); }
  } else if (kutu && !kutu.classList.contains("gizli")) {
    // Acik ama henuz kare yok: "Kamera kapali" yazip durmasin.
    kutu.textContent = "Henüz kare gelmedi.";
  }
}

/* AI HAT durumu. Kamera ile aynı bölümde ama AYRI okunuyor: çıkarım ayrı
 * bir iş parçacığında ve tek elemanlı bir kuyrukla besleniyor, yani
 * Hailo'nun hâli kameranın hâlini etkilemiyor.
 *
 * `dusen` sayacı burada bilerek görünür: normal işleyişte sıfır kalıyor,
 * sıfırdan büyükse çıkarım kameraya yetişemiyor demek. */
function hailoDurumYaz(h) {
  const kutu = $("#hailo-kutu");
  const not = $("#hailo-durum");
  const uyari = $("#hailo-uyari");
  if (!kutu || !not || !uyari) return;
  // Hiç yapılandırılmamışsa bölümü hiç göstermiyoruz: AI HAT'i olmayan
  // kurulumda anlamsız bir satır durmasın.
  if (!h || (!h.aktif && !h.kilitli && !h.son_hata)) {
    kutu.classList.add("gizli");
    return;
  }
  kutu.classList.remove("gizli");
  const model = String(h.model || "").split("/").pop();
  const parca = [
    h.kilitli ? "KİLİTLİ" : (h.aktif ? "açık" : "kapalı"),
    h.sahte ? "sahte" : model,
    `${h.islenen || 0} kare`,
    `${h.dusen || 0} düşen`,
  ];
  if (h.son_sure_ms != null) parca.push(`${h.son_sure_ms} ms`);
  if (h.tespit != null) parca.push(`${h.tespit} tespit`);
  not.textContent = "AI HAT · " + parca.join(" · ");

  if (h.kilitli) {
    uyari.textContent = "AI HAT yanıt vermiyor — tespit durduruldu. Kamera ve "
      + "robot etkilenmedi. Cihazı geri getirmek için Pi'yi yeniden başlatın; "
      + "sürücüyü elle yeniden yüklemek cihaz düğümünü kaybettiriyor.";
    uyari.classList.remove("gizli");
  } else if (!h.aktif && h.son_hata) {
    uyari.textContent = `AI HAT kapalı: ${h.son_hata}`;
    uyari.classList.remove("gizli");
  } else {
    uyari.classList.add("gizli");
  }
}

// Kare WebSocket'ten gelmiyor; sunucu haber veriyor, tarayıcı <img> ile
// çekiyor. Böylece büyük base64 dizeleri panel soketini tıkamıyor.
function kareyiTazele(ts, canli = false) {
  // Canlı kare sunucunun BELLEĞİNDEN geliyor, periyodik kare diskten.
  const uc = canli ? "canli" : "son";
  const adres = `/api/kare/${uc}?jeton=${encodeURIComponent(S.jeton)}&t=${ts || Date.now()}`;
  const img = $("#kamera-kare");
  img.src = adres;
  img.classList.remove("gizli");

  // Sahnedeki yüzen kopya. Aynı adresi kullanıyor: tarayıcı iki <img> için
  // tek istek yapıyor, yani ikinci kopya ağa yük bindirmiyor.
  // Son kareyi hatırlıyoruz: yüzen kutu geri açıldığında bir sonraki kareyi
  // beklemesin. Saatlik aralıkta o bekleme bir saat sürerdi.
  S.sonKareAdres = adres;
  S.sonKareCanli = canli;
  S.sonKareTs = ts || Date.now() / 1000;
  const yuzen = $("#kamera-yuzen");
  if (yuzen && !S.kameraYuzenKapali) {
    $("#kamera-yuzen-kare").src = adres;
    yuzen.classList.remove("gizli");
    kameraYuzenSinirla();
    $("#kamera-yuzen-zaman").textContent =
      (canli ? "canlı " : "") + new Date((ts || Date.now() / 1000) * 1000).toLocaleTimeString("tr-TR");
  }
  $("#kamera-yok").classList.add("gizli");
  $("#kamera-zaman").textContent = (canli ? "Canlı · " : "Son kare: ")
    + new Date((ts || Date.now() / 1000) * 1000).toLocaleTimeString("tr-TR");
  // Kalibrasyon karesi de aynı görüntüyü kullanıyor: iki kare yöntemi için
  // makine oynadıkça yeni kare gelmesi gerekiyor.
  const kalibKare = $("#kalib-kare");
  if (kalibKare) {
    kalibKare.src = adres;
    kalibKare.onload = kalibIsaretCiz;
  }
}

/* ------------------------------------------- yalnızca var olan sensörler */
// Panelde her zaman dört grafik ve beş kart göstermek, bağlı olmayan bir
// sensör için boş bir eksen çizmek demekti — "sensör bozuk mu, veri mi
// gelmiyor" sorusunu doğuran türden bir boşluk. Artık bir kanal ancak
// gerçekten değer ürettiğinde görünüyor.
//
// İşaret YAPIŞKAN: bir kez veri gelen kanal, sonraki okumada null dönse de
// gizlenmiyor. Aksi hâlde DHT'nin ara sıra atladığı bir okuma yüzünden kart
// gözden kaybolup geri gelir, panel titrer.
const KANAL_VAR = {};

function kanallariTara(kaynak) {
  let yeni = false;
  for (const [ad, deger] of Object.entries(kaynak || {})) {
    if (deger !== null && deger !== undefined && !KANAL_VAR[ad] && ad !== "ts" && ad !== "kip") {
      KANAL_VAR[ad] = true;
      yeni = true;
    }
  }
  return yeni;
}

function gorunurlukGuncelle() {
  $$("[data-kanallar]").forEach((el) => {
    const varMi = el.dataset.kanallar.split(",").some((k) => KANAL_VAR[k.trim()]);
    el.classList.toggle("gizli", !varMi);
  });
  // Grafik açıklamasında olmayan seriyi de göstermeyelim.
  $$("[data-kanal]").forEach((el) => el.classList.toggle("gizli", !KANAL_VAR[el.dataset.kanal]));

  const hicbiri = !$$("[data-kanallar]:not(.gizli)").length;
  $("#veri-yok").classList.toggle("gizli", !hicbiri);
  // Gizliyken yeniden boyutlanan grafik yanlış ölçüde kalıyor.
  Object.values(S.grafikler).forEach((g) => g.resize());
}

/* ------------------------------------------------------- tıkla-çalış jog */
// PLC'nin jog bitleri MANDAL: 1 yazılınca eksen durmaz. Düğmeyi basılı tutmak
// yerine tıklayıp bırakmak, "parmağını çekince durur" güvencesini ortadan
// kaldırıyor — o yüzden koruma tamamen ajana bindi:
//   · panel açık kaldığı sürece yenileme gider; sekme gizlenir, pencere odağı
//     giderse ya da soket koparsa yenileme durur ve eksen 1,2 sn'de durur
//   · yumuşak sınıra yaklaşan ekseni ajanın bekçisi kendiliğinden durdurur
//   · her yenilemede yasak bölge ileri-bakışı tekrarlanır
const JOG_YENILEME_MS = 300;

function jogYolla(eksen, yon, basili) {
  if (!S.ws || S.ws.readyState !== WebSocket.OPEN) return;
  S.ws.send(JSON.stringify({ tip: "jog", eksen, yon, basili }));
}

function jogAcKapa(eksen, yon, dugme) {
  const a = S.jogAktif;
  if (a && a.eksen === eksen && a.yon === yon) { jogDurdur(); return; }
  // Aynı anda tek eksen: başka bir yöne geçmeden önce mevcut jog kapanır.
  if (a) jogDurdur();
  if (dugme && dugme.disabled) return;

  S.jogAktif = { eksen, yon, dugme };
  if (dugme) dugme.classList.add("basili");
  jogYolla(eksen, yon, true);
  S.jogSayac = setInterval(() => jogYolla(eksen, yon, true), JOG_YENILEME_MS);
}

function jogDurdur() {
  if (!S.jogAktif) return;
  const { eksen, yon, dugme } = S.jogAktif;
  clearInterval(S.jogSayac);
  S.jogSayac = null;
  S.jogAktif = null;
  if (dugme) dugme.classList.remove("basili");
  // İki kez: tek "bırak" paketi düşerse eksen kiranın dolmasını bekler.
  jogYolla(eksen, yon, false);
  setTimeout(() => jogYolla(eksen, yon, false), 60);
}

/* -------------------------------------------------------------- eksen penceresi
 *
 * SORUN: Chart.js y eksenini varsayılan olarak VERİYE göre sıkıştırıyor.
 * Ortam sabitken basınç 906,5 ile 907,1 arasında geziniyor; eksen o 0,6
 * hPa'ya yakınlaşınca sensör gürültüsü ekranı baştan başa kaplayan bir dağ
 * silsilesi gibi görünüyor. Grafik teknik olarak doğru, söylediği şey
 * yanlış: "basınç çok oynuyor" diyor, oysa basınç neredeyse sabit.
 *
 * ÇÖZÜM: her kanalın ANLAMLI bir en küçük penceresi var. Veri o pencerenin
 * içinde kalıyorsa eksen küçülmüyor; dışına çıkarsa pencere büyüyor ama
 * asla en küçüğün altına inmiyor. Yani grafiğin dikey ölçeği "bu kanalda
 * kaç birimlik değişim önemlidir" sorusunun cevabı oluyor.
 */

/** 1-2-5 merdiveninden yuvarlak adım. 0,37 -> 0,5; 23 -> 20; 1400 -> 1000. */
function guzelAdim(kaba) {
  if (!(kaba > 0)) return 1;
  const us = Math.pow(10, Math.floor(Math.log10(kaba)));
  const n = kaba / us;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * us;
}

/** Adıma göre kaç ondalık gösterilsin. 5 -> 0, 0,5 -> 1, 0,05 -> 2. */
const adimBasamak = (adim) => (adim >= 1 ? 0 : adim >= 0.1 ? 1 : 2);

/**
 * @param veriAlt/veriUst  verinin gerçek en küçük/en büyük değeri
 * @param enAz             bu kanalın göreceği EN KÜÇÜK pencere
 * @param sinir            [alt, üst] fiziksel sınır ya da null
 *                         (nem %0-100'ün, açı 0-180'in dışına çıkamaz)
 * @returns {alt, ust, adim} — hepsi `adim`ın tam katı
 */
function eksenPenceresi(veriAlt, veriUst, enAz, sinir) {
  if (!isFinite(veriAlt) || !isFinite(veriUst)) return null;
  // Veri kenara yapışmasın diye %20 pay; ama en küçük pencere yine kural.
  const aralik = Math.max((veriUst - veriAlt) * 1.2, enAz);
  const orta = (veriAlt + veriUst) / 2;
  // Hedef 4-6 aralık: daha azında eksen okunmuyor, daha çoğunda etiketler
  // birbirine giriyor.
  const adim = guzelAdim(aralik / 5);
  let alt = Math.floor((orta - aralik / 2) / adim) * adim;
  let ust = Math.ceil((orta + aralik / 2) / adim) * adim;
  if (sinir) {
    const [sAlt, sUst] = sinir;
    // Sınırın dışına taşan payı öbür tarafa aktarıyoruz: pencere daralmıyor,
    // yalnız kayıyor. Daraltsaydık "en az şu kadar görünsün" kuralı bozulurdu.
    if (sAlt != null && alt < sAlt) { ust += sAlt - alt; alt = sAlt; }
    if (sUst != null && ust > sUst) {
      const kayma = ust - sUst;
      ust = sUst;
      alt = sAlt == null ? alt - kayma : Math.max(sAlt, alt - kayma);
    }
    alt = Math.floor(alt / adim) * adim;
    ust = Math.ceil(ust / adim) * adim;
    if (sAlt != null) alt = Math.max(alt, sAlt);
    if (sUst != null) ust = Math.min(ust, sUst);
  }
  // Yuvarlama her ikisini de aynı değere getirdiyse (tek noktalı veri)
  // en az bir adım aç.
  if (ust <= alt) ust = alt + adim;
  return { alt, ust, adim };
}

/* Yüzen kamera konumunu sınırlar. Kutu görünür olduğunda çağrılıyor:
 * gizliyken ölçülemediği için sınırlama o anda yapılamıyor. */
let kameraYuzenSinirla = () => {};

/* --------------------------------------------------- grafik düzleştirmesi
 * Grafikler ham seriyi değil, düzleştirilmiş seriyi çiziyor: önce aykırı
 * değerler ayıklanıyor, sonra 10'luk hareketli ortalama alınıyor. Sensör
 * gürültüsü grafikte gerçek bir olay gibi görünüyordu.
 *
 * YALNIZ GRAFİKTE. Kartlardaki anlık değer ve tablo ham kalıyor, veritabanına
 * da ham giriyor. Düzleştirme bir görüntüleme kararı; veriyi değiştirirse
 * "sensör ne dedi" sorusunun cevabı kaybolur.
 *
 * Aykırı ölçütü: noktanın KENDİSİ HARİÇ önceki pencerenin ortalamasından
 * 2 standart sapmadan fazla sapması. Normal dağılımda ±2σ ≈ %95,4 — sizin
 * dediğiniz %96'nın karşılığı bu. (±3σ %99,7'dir; "altı sigma" adı ±6σ'dan
 * gelir ve pratikte hiçbir şeyi elemez.) Kendisini hesaba katmamak önemli:
 * aykırı değer kendi eşiğini şişirirdi.
 */
const DUZ_PENCERE = 10;      // kaç ölçümün ortalaması
const DUZ_SIGMA   = 2;       // ±2σ ≈ %95,4
const DUZ_ARDISIK = 3;       // bu kadar üst üste elenen nokta artık gürültü değil

function duzlestir(dizi, taban) {
  const gecerli = (x) => x !== null && x !== undefined && !Number.isNaN(x);
  const temiz = [];
  let ardisikElenen = 0;

  for (let i = 0; i < dizi.length; i++) {
    const x = Number(dizi[i]);
    if (!gecerli(dizi[i])) { temiz.push(null); continue; }

    // Kendisi hariç, en yakın geçerli DUZ_PENCERE değer.
    const onceki = [];
    for (let j = i - 1; j >= 0 && onceki.length < DUZ_PENCERE; j--) {
      if (temiz[j] !== null) onceki.push(temiz[j]);
    }

    // Dört noktanın altında standart sapma anlamlı değil; eleme yapmıyoruz.
    if (onceki.length >= 4) {
      const ort = onceki.reduce((a, b) => a + b, 0) / onceki.length;
      const sapma = Math.sqrt(
        onceki.reduce((a, b) => a + (b - ort) * (b - ort), 0) / onceki.length);
      /* TABAN ŞART. DHT11 tam sayı basıyor; sensör bir süre aynı değeri
       * verirse sapma tam olarak 0 oluyor ve o andan sonra HER nokta
       * "aykırı" sayılıp grafik donuyordu. Taban, kanalın çözünürlüğü
       * kadar bir sapmayı her zaman normal kabul ediyor. */
      const esik = Math.max(DUZ_SIGMA * sapma, taban);

      /* Ve kademe değişimi elenmemeli. Sulama sonrası nem gerçekten
       * sıçrıyor; bunu aykırı sayıp atarsak pencere eski değerlerde
       * takılı kalıyor ve serinin GERİ KALANI tamamen eleniyor —
       * grafik o noktadan sonra ölüyor. Üst üste birkaç nokta aynı
       * yöne kaçtıysa bu gürültü değil, yeni gerçek. */
      if (Math.abs(x - ort) > esik && ardisikElenen < DUZ_ARDISIK) {
        ardisikElenen++;
        temiz.push(null);
        continue;
      }
    }
    ardisikElenen = 0;
    temiz.push(x);
  }

  // 10'luk hareketli ortalama — nokta kendisi dahil, geriye doğru.
  return temiz.map((_, i) => {
    const p = [];
    for (let j = i; j >= 0 && p.length < DUZ_PENCERE; j--) {
      if (temiz[j] !== null) p.push(temiz[j]);
    }
    return p.length ? p.reduce((a, b) => a + b, 0) / p.length : null;
  });
}

/* Kanalın çözünürlüğü — düzleştirmenin eleme tabanı. Bu kadarlık bir
 * sapma sensörün kendi adım büyüklüğü, gürültü değil. */
const DUZ_TABAN = { sicaklik: 1.0, nem: 1.0, basinc: 0.3 };

/* ------------------------------------------------------------------ grafikler */
function grafikYap(kimlik, seriler, birim, basamak = 1, eksen = {}) {
  const ctx = document.getElementById(kimlik);
  // Bu kanalın en küçük penceresi ve varsa fiziksel sınırları.
  const enAz = eksen.enAz || 1;
  const sinir = eksen.sinir || null;
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: seriler.map((seri, sira) => ({
        label: seri.ad,
        data: [],
        borderColor: [RENK.seri1, RENK.seri2, RENK.seri3][sira] || RENK.seri2,
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,          // 8 px çap — dokunmatikte de tutulabilir
        pointHoverBorderWidth: 2,
        pointHoverBorderColor: RENK.yuzey,   // üst üste binen noktalar ayrışsın
        pointHoverBackgroundColor: [RENK.seri1, RENK.seri2, RENK.seri3][sira] || RENK.seri2,
        tension: 0.25,
        spanGaps: true,               // sensör bir tur okunamazsa çizgi kopmasın
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,               // canlı veride animasyon titreme yapıyor
      // index + intersect:false = imleç nereye gelirse gelsin o dikeydeki
      // tüm serilerin değeri görünür. Nokta üstüne gelmeyi beklemek,
      // seyrek noktalı bir grafikte ipucunu neredeyse kullanılmaz kılıyor.
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },   // açıklama HTML tarafında, başlığın altında
        tooltip: {
          backgroundColor: "#26262499",
          borderColor: "#44443f",
          borderWidth: 1,
          padding: 10,
          titleColor: "#fff",
          bodyColor: "#e6e5dc",
          callbacks: {
            label: (bag) => ` ${bag.dataset.label}: ${sayi(bag.parsed.y, basamak)} ${birim}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: RENK.cizgi },
          ticks: { color: RENK.metin3, maxTicksLimit: 7, maxRotation: 0, font: { size: 11 } },
        },
        y: {
          grid: { color: RENK.cizgi },
          border: { display: false },
          /* Eksen sınırını Chart.js'in veriye göre hesapladığı değerden
           * DEVRALIYORUZ. `min`/`max` seçenek olarak sabitlenseydi eksen
           * hiç büyümezdi; burada büyüyebiliyor ama en küçüğün altına
           * inemiyor. */
          afterDataLimits(olcek) {
            const p = eksenPenceresi(olcek.min, olcek.max, enAz, sinir);
            if (!p) return;
            olcek.min = p.alt;
            olcek.max = p.ust;
            // Etiketler adımın tam katlarında: 25, 30, 35 — 26,37 değil.
            olcek.options.ticks.stepSize = p.adim;
            olcek._basamak = adimBasamak(p.adim);
          },
          ticks: {
            color: RENK.metin3,
            font: { size: 11 },
            // Birim BURADA YAZMIYOR: başlıkta bir kez yazıyor (bkz.
            // index.html "Sıcaklık °C"). Her etikete iliştirmek ekseni
            // gereksiz yere kalabalıklaştırıyor.
            callback(v) { return sayi(v, this._basamak != null ? this._basamak : basamak); },
          },
        },
      },
    },
  });
}

function grafikleriKur() {
  /* EN KÜÇÜK PENCERE — her kanal için "kaç birimlik değişim önemlidir".
   *
   *   sıcaklık  10 °C : seranın gün içinde gerçekten gezindiği aralık.
   *                     ±2 °C'lik DHT11 gürültüsü bunun içinde düz kalıyor.
   *   nem       %20   : DHT11'in doğruluğu zaten ±%5; %20'nin altındaki bir
   *                     pencere sensörün ayırt edemediği farkı büyütür.
   *   basınç    10 hPa: hava olaylarının ölçeği. Sabit ortamda gördüğümüz
   *                     0,5 hPa'lık gezinme bu pencerede düz bir çizgi.
   *   vana      90°   : kapalı ile açık arası. Tek bir konumda takılı kalsa
   *                     bile eksen "0 ile 90 arası bir şey" diyor.
   *
   * SINIR: nem yüzde, açı derece — fiziksel olarak dışına çıkamayacakları
   * bir aralık var; pencere büyürken oraya taşmasın. */
  S.grafikler.sicaklik = grafikYap("g-sicaklik", [{ ad: "DHT11" }, { ad: "BMP180" }], "°C", 1,
                                   { enAz: 10 });
  S.grafikler.nem = grafikYap("g-nem", [{ ad: "Hava nemi" }, { ad: "Toprak nemi" }], "%", 0,
                              { enAz: 20, sinir: [0, 100] });
  S.grafikler.basinc = grafikYap("g-basinc", [{ ad: "Basınç" }], "hPa", 1,
                                 { enAz: 10 });
}

async function gecmisYukle() {
  const yanit = await fetch(`/api/gecmis?dakika=${S.dakika}&jeton=${encodeURIComponent(S.jeton)}`);
  if (!yanit.ok) { gunluk("✕ Geçmiş verisi alınamadı", "hata"); return; }
  const v = await yanit.json();
  // Geçmişte bir kez bile değer görülen kanal "var" sayılıyor.
  for (const [ad, dizi] of Object.entries(v)) {
    if (ad !== "ts" && Array.isArray(dizi) && dizi.some((x) => x !== null && x !== undefined)) {
      KANAL_VAR[ad] = true;
    }
  }

  // Grafik ve tablo TEK kaynaktan besleniyor. Ayrı beslendiklerinde ikisi
  // farklı uzunlukta pencere tutuyordu ve düzleştirme yalnız birine
  // uygulanabiliyordu.
  S.satirlar = v.ts.map((ts, i) => ({
    ts,
    hava_sicaklik: v.hava_sicaklik[i], bmp_sicaklik: v.bmp_sicaklik[i],
    hava_nem: v.hava_nem[i], toprak_nem: v.toprak_nem[i],
    basinc: v.basinc[i],
  })).slice(-SATIR_SINIRI);
  tabloCiz();
  grafikleriYaz();
  S.sonZaman = v.ts.length ? v.ts[v.ts.length - 1] : 0;
  gorunurlukGuncelle();
}

/* Ekrandaki nokta sayısı: sekme saatlerce açık kalırsa dizi büyümeye devam
 * eder ve hem grafik hem düzleştirme yavaşlar. Tablo zaten son 100'ü
 * gösteriyor, grafik bu pencerenin tamamını. */
const SATIR_SINIRI = 900;

function noktaEkle(olcum) {
  S.satirlar.push(olcum);
  if (S.satirlar.length > SATIR_SINIRI) S.satirlar.shift();
  tabloCiz();
  grafikleriYaz();
}

/* Grafikleri S.satirlar'dan baştan yazıyor.
 *
 * Her yeni noktada seriyi baştan hesaplamak israf gibi duruyor ama değil:
 * hareketli ortalama ve aykırı elemesi son noktayı ÖNCEKİLERE bakarak
 * belirliyor, yani sona tek değer eklemek yetmiyor — eleme kararı sonraki
 * noktalarla değişebiliyor. 900 nokta × 5 seri iki saniyede bir, tarayıcı
 * için önemsiz bir iş. */
function grafikleriYaz() {
  if (!S.grafikler.sicaklik) return;
  const uzun = S.dakika > 720;
  const etiketler = S.satirlar.map((s) => saatEtiketi(s.ts, uzun));
  const al = (ad) => S.satirlar.map((s) => (s[ad] === undefined ? null : s[ad]));

  const yaz = (grafik, diziler, taban) => {
    grafik.data.labels = etiketler;
    diziler.forEach((dizi, sira) => {
      grafik.data.datasets[sira].data = duzlestir(dizi, taban);
    });
    grafik.update("none");
  };

  yaz(S.grafikler.sicaklik, [al("hava_sicaklik"), al("bmp_sicaklik")], DUZ_TABAN.sicaklik);
  yaz(S.grafikler.nem,
      [al("hava_nem"), al("toprak_nem").map(toprakYuzde)], DUZ_TABAN.nem);
  yaz(S.grafikler.basinc, [al("basinc")], DUZ_TABAN.basinc);
}

function tabloCiz() {
  const govde = $("#tablo-govde");
  const parcalar = [];
  for (let i = S.satirlar.length - 1; i >= Math.max(0, S.satirlar.length - 100); i--) {
    const s = S.satirlar[i];
    parcalar.push(
      `<tr><td>${new Date(s.ts * 1000).toLocaleString("tr-TR")}</td>` +
      `<td>${sayi(s.hava_sicaklik)}</td><td>${sayi(s.bmp_sicaklik)}</td>` +
      `<td>${sayi(s.hava_nem)}</td><td>${sayi(toprakYuzde(s.toprak_nem), 0)}</td>` +
      `<td>${sayi(s.basinc)}</td></tr>`
    );
  }
  govde.innerHTML = parcalar.join("");
}

/* ----------------------------------------------------------------- kartlar */
function kartlariGuncelle(o) {
  if (!o) return;
  roleDurumSenkron(o);
  if (kanallariTara(o)) gorunurlukGuncelle();
  $("#d-sicaklik").innerHTML = `${sayiCoz(o.hava_sicaklik)}<span class="birim">°C</span>`;
  $("#d-nem").innerHTML = `${sayiCoz(o.hava_nem)}<span class="birim">%</span>`;
  $("#d-toprak").innerHTML = `${sayi(toprakYuzde(o.toprak_nem), 0)}<span class="birim">%</span>`;
  $("#d-basinc").innerHTML = `${sayi(o.basinc)}<span class="birim">hPa</span>`;

  // Sensör adı sabit yazılmıyor: Arduino hangi DHT'yi bulduysa onu bildiriyor.
  // "DHT11" yazan bir kartın altında DHT22 durması, ölçüm tutmadığında yanlış
  // yerde hata aramaya yol açıyordu.
  const dhtAd = o.dht && o.dht !== "yok" ? o.dht : "DHT";
  /* HAM DEĞER. Kartta gösterilen sayı düzeltilmiş: sensörün çözünürlüğüne
   * yuvarlanmış ve son birkaç örneğin medyanı alınmış (ajan/arduino.py,
   * Duzeltici). Sensörün o an ne dediği kaybolmasın diye ham okuma alttaki
   * küçük yazıda duruyor — düzeltilmiş değerle ham arasında sürekli fark
   * varsa sensörde bir sorun var demektir, bunu görebilmek gerekiyor. */
  const ham = o.ham || {};
  // Birim tekrar edilmiyor: kartın büyük sayısında zaten yazıyor. Küçük
  // yazı tek satıra sığmalı — iki satıra taşan bir kart, ızgaradaki bütün
  // satırı uzatıp kartları eşitsiz gösteriyor.
  const hamEk = (ad, basamak = 0) =>
    ham[ad] == null ? "" : ` ham ${sayi(ham[ad], basamak)}`;
  $("#a-nem").textContent = dhtAd + hamEk("hava_nem");
  // Ham değer BURADA görünmeli: kalibrasyon ham ölçekte tanımlı ve
  // "yüzde saçma" derken bakılacak ilk sayı bu.
  $("#a-toprak").textContent = o.toprak_nem == null ? "Uca takılı prob"
    : `Prob${hamEk("toprak_nem")}`;
  // "BMP180" yerine "BMP": sıcaklık kartında da öyle kısaltılıyor ve
  // satır tek satırda kalıyor.
  $("#a-rakim").textContent = o.rakim == null ? "BMP180"
    : `BMP${hamEk("basinc", 2)} · ${sayi(o.rakim, 0)} m`;
  $("#a-sicaklik").textContent = o.bmp_sicaklik == null ? dhtAd + hamEk("hava_sicaklik")
    : `${dhtAd}${hamEk("hava_sicaklik")} · BMP ${sayi(o.bmp_sicaklik)}`;
}

/* ------------------------------------------------- rölelerin gerçek durumu
 * Düğmeler eskiden panelin kendi tahminini gösteriyordu. Tahmin bir kez
 * yanlışa düşünce düzelmiyordu: kart yeniden başlayınca bütün röleler
 * kapanıyor, panel hâlâ "açık" sanıyor, sonraki tıklama "kapat" gönderiyor
 * ve hiçbir şey olmuyor — düğme bozuk sanılıyordu. Artık doğruyu kart
 * söylüyor, panel yalnızca ona uyuyor.
 */
function roleDurumSenkron(o) {
  // Kart yeniden başladıysa çalışma süresi geriye gider. Sessizce
  // düzeltmek yetmez: röleler kendiliğinden kapandı, sebebini söylemek
  // gerekiyor — pompa çekişinde besleme çökerse tam bu görülüyor.
  if (o.calisma_sn !== undefined) {
    const sn = Number(o.calisma_sn);
    if (S.arduinoCalisma !== null && sn < S.arduinoCalisma) {
      gunluk("<b>Arduino yeniden başladı</b> — röleler kapandı. "
             + "Pompa çekerken besleme çöküyor olabilir.", "uyari");
    }
    S.arduinoCalisma = sn;
  }

  // Düğmenin gösterdiği şey kartın bildirdiği GERÇEK durum. Panel kendi
  // tahminini tutmuyor: tahmin bir kez şaşınca düzelmiyordu.
  for (const ad of ROLELER) {
    const deger = o["r_" + ad];
    if (deger === undefined) continue;
    const acik = Number(deger) === 1;
    S.roleDurum[ad] = acik;
    const dugme = $(`.dugme.role[data-role="${ad}"]`);
    if (!dugme) continue;
    dugme.classList.toggle("acik", acik);
    dugme.setAttribute("aria-pressed", acik ? "true" : "false");
    const etiket = dugme.querySelector(".role-durum");
    if (etiket) etiket.textContent = acik ? "AÇIK" : "kapalı";
  }
}

/** Eksen hızı kutuları — kaynak ajan, panel kendi kopyasını tutmuyor.
 *
 * Kullanıcı bir kutuya yazarken üstüne yazmıyoruz; yarım kalan bir sayı
 * yarım saniyede bir silinirse alan doldurulamaz hâle geliyor. */
function eksenHizYaz(d) {
  const ozet = $("#eksen-hiz-ozet");
  const genel = d.hiz != null ? Math.round(Number(d.hiz)) : null;
  ["x", "y", "z"].forEach((e) => {
    const el = $("#hiz-" + e);
    if (!el || document.activeElement === el) return;
    const v = d["hiz_" + e];
    el.value = v == null ? "" : Math.round(Number(v));
  });
  if (ozet) {
    const yaz = (e) => (d["hiz_" + e] == null ? "genel" : Math.round(Number(d["hiz_" + e])));
    ozet.textContent = d.hiz == null ? "—"
      : `X ${yaz("x")} · Y ${yaz("y")} · Z ${yaz("z")}  (genel ${genel})`;
  }
}

/** Bir durum ışığı — renk ve (üstüne gelince çıkan) ad.
 *
 * Metin artık çubukta durmuyor: dört rozet dört kelimeyle üst çubuğun
 * yarısını yiyordu ve dördü de aynı görsel ağırlıktaydı. Işık ancak
 * bozulduğunda dikkat çekmeli; adı merak eden üstüne geliyor. Ad `title`
 * olarak da yazılıyor ki dokunmatikte ve ekran okuyucuda kaybolmasın. */
function rozetYaz(kimlik, sinif, metin) {
  const el = $(kimlik);
  if (!el) return;
  el.className = `isik ${sinif}`;
  el.title = metin;
  const ad = el.querySelector(".ad");
  if (ad) ad.textContent = metin;
}

let _sonHata = "";

function durumGuncelle(d) {
  if (!d) return;
  if (d.toprak_kalib) S.toprakKalib = d.toprak_kalib;
  eksenHizYaz(d);
  rozetYaz("#rozet-ajan", d.bagli ? "canli" : "kopuk", d.bagli ? "Raspberry Pi bağlı" : "Raspberry Pi çevrimdışı");

  const acilAcik = d.acil && d.acil.acik;
  const plcSinif = d.plc === "bagli" ? (acilAcik ? "kopuk" : "canli") : d.plc === "kopuk" ? "kopuk" : "";
  const plcMetin = d.plc !== "bagli" ? `PLC: ${d.plc}`
    : acilAcik ? "PLC: ACİL DURDURMA"
    : d.hareket ? "PLC: hareket ediyor"
    : d.enable ? "PLC: hazır" : "PLC: sürücüler kapalı";
  rozetYaz("#rozet-plc", plcSinif, plcMetin);

  kameraDurumYaz(d.kamera);
  hailoDurumYaz(d.hailo);

  S.ajanBagli = !!d.bagli;
  S.sonKonum = d.konum || null;
  if (d.guvenli_z != null) S.guvenliZ = Number(d.guvenli_z);
  // Sınırlar değişirse (kalibrasyon güncellendi, ajan yeniden bağlandı)
  // nokta listesindeki "sınır dışı" işaretleri de tazelenmeli.
  const yeniSinir = JSON.stringify(d.sinirlar || null);
  if (yeniSinir !== JSON.stringify(S.sinirlar || null)) {
    S.sinirlar = d.sinirlar || null;
    if (S.noktalar.length) noktalariCiz();
  }

  const k = d.konum || {};
  // Birim ayrı bir eleman: satır içi stil yerine sınıf kullanıyoruz ki dar
  // ekranda ölçüsünü CSS ayarlayabilsin.
  const birimli = (deger) =>
    deger == null ? "—" : `${sayi(deger, 1)}<span class="birim"> mm</span>`;
  ["x", "y", "z"].forEach((eksen) => {
    $(`#k-${eksen}`).innerHTML = birimli(k[eksen]);
    const sinir = (d.sinirlar || {})[eksen];
    $(`#s-${eksen}`).textContent = sinir ? `${sayi(sinir.min, 0)} – ${sayi(sinir.max, 0)} mm` : "";
    const kutu = $(`#k-${eksen}`).parentElement;
    kutu.classList.toggle("jogluyor", (d.jog || []).some((j) => j[0].toLowerCase() === eksen));
  });

  // Acil durdurma mandalı
  $("#acil-bant").classList.toggle("gizli", !acilAcik);
  if (acilAcik) $("#acil-detay").textContent = `${d.acil.saat} · ${d.acil.neden}`;

  // Z güvenlik kilidi: X/Y jog düğmelerini de kapatıyoruz ki basıp
  // "neden hareket etmiyor" diye düşünülmesin — sebebi kutuda yazıyor.
  const zSorunlu = d.plc === "bagli" && d.z_guvenli === false;
  $("#z-uyari").classList.toggle("gizli", !zSorunlu);

  // Bölgeler ajandan geliyor. Kullanıcı düzenlerken listeyi yeniden çizmek
  // yazdığını silerdi; o yüzden yalnız düzenleme yokken tazeleniyor.
  if (Array.isArray(d.bolgeler) && !S.bolgeDuzenleniyor
      && JSON.stringify(d.bolgeler) !== JSON.stringify(S.bolgeler)) {
    S.bolgeler = d.bolgeler;
    bolgeleriCiz(S.bolgeler);
  }
  $("#bolge-esnetme").classList.toggle("gizli", !d.esnetme_acik);

  ucGuncelle(d.uc);
  diziGuncelle(d.dizi);
  kalibrasyonCiz(d);
  tanilariCiz(d);
  // Tarla sahnesi yatak ölçüsünü ve robot konumunu buradan alıyor.
  if (window.Tarla) window.Tarla.durumDegisti(d);

  S.enable = !!d.enable;
  $("#d-enable").textContent = d.enable ? "Sürücüleri kapat" : "Sürücüleri aç";
  $("#d-enable").classList.toggle("secili", !!d.enable);

  if (d.hiz && !$("#hiz-kaydirac").matches(":active")) {
    $("#hiz-kaydirac").value = d.hiz;
    $("#hiz-etiket").textContent = `${sayi(d.hiz, 0)} mm/s`;
  }

  // Ajan yokken hareket düğmelerini kapatıyoruz: basılıp hiçbir şey olmaması,
  // "gönderdim sandım" hatasının en sık kaynağı.
  const kilit = !d.bagli || acilAcik;
  $$("#d-git, #d-home, [data-home], #d-dur, .role").forEach((b) => { b.disabled = kilit; });
  $$(".nokta-git").forEach((b) => {
    // Sınır dışı olduğu için kapatılmış düğmeyi geri açmıyoruz.
    if (!b.dataset.sinirDisi) b.disabled = kilit;
  });
  $$(".jog").forEach((b) => {
    const xy = b.dataset.eksen !== "z";
    b.disabled = kilit || (xy && zSorunlu);
  });
  $("#d-enable").disabled = !d.bagli || (acilAcik && !d.enable);
  $("#d-acil").disabled = !d.bagli;
  $("#d-acil-temizle").disabled = !d.bagli;

  // Aynı hata her durum paketinde tekrarlanıyor; günlüğü doldurmasın.
  if (d.hata && d.hata !== _sonHata) gunluk(`⚠ ${d.hata}`, "hata");
  _sonHata = d.hata || "";
}

/* --------------------------------------------------------------- websocket */
function wsBagla() {
  const protokol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protokol}://${location.host}/ws/panel?jeton=${encodeURIComponent(S.jeton)}`);
  S.ws = ws;

  ws.onopen = () => { rozetYaz("#rozet-sunucu", "canli", "Sunucu bağlı"); gunluk("Sunucuya bağlanıldı"); };

  ws.onmessage = (olay) => {
    const m = JSON.parse(olay.data);
    if (m.tip === "anlik") { durumGuncelle(m.durum); kartlariGuncelle(m.olcum); }
    else if (m.tip === "olcum") { kartlariGuncelle(m.veri); noktaEkle(m.veri); }
    else if (m.tip === "durum") durumGuncelle(m.durum);
    else if (m.tip === "kare") kareyiTazele(m.ts);
    else if (m.tip === "canli") kareyiTazele(m.ts, true);
    else if (m.tip === "gunluk") gunluk(m.metin, m.seviye === "hata" ? "hata" : "");
  };

  ws.onclose = () => {
    // Soket kapandıysa "bırak" paketi gidemez; düğmeyi görsel olarak da
    // bırakıyoruz. Eksen zaten ajanın kira bekçisiyle 1,2 sn'de duruyor.
    jogDurdur();
    rozetYaz("#rozet-sunucu", "kopuk", "Sunucu bağlantısı yok");
    // Sabit 3 saniye yeterli: sunucu Render'da uyandırılıyorsa birkaç deneme
    // sürebilir ama kullanıcı sayfayı yenilemek zorunda kalmaz.
    setTimeout(wsBagla, 3000);
  };
  ws.onerror = () => ws.close();
}

/* ------------------------------------------------------------------ olaylar */
function olaylariBagla() {
  $$("nav.sekmeler button").forEach((dugme) => {
    dugme.onclick = () => {
      $$("nav.sekmeler button").forEach((b) => b.classList.remove("etkin"));
      $$(".sayfa").forEach((s) => s.classList.remove("etkin"));
      dugme.classList.add("etkin");
      $(`#sayfa-${dugme.dataset.sayfa}`).classList.add("etkin");
      S.sekme = dugme.dataset.sayfa;
      localStorage.setItem("farmbot_sekme", S.sekme);
      // Sekme adı panelin başlığına yazılıyor: sekme çubuğu artık üstte,
      // panelin kendisi hangi sayfada olduğunu söylemeli.
      const ad = $("#sol-panel-ad");
      if (ad) ad.textContent = (dugme.textContent || "").trim() || dugme.dataset.sayfa;
      // Katlı panelde sekmeye basmak "aç" demek; yoksa tıklama sessiz kalırdı.
      solPanelKatla(false);
      // Gizliyken çizilen grafik yanlış ölçüde kalıyor; sekmeye dönünce tazele.
      Object.values(S.grafikler).forEach((g) => g.resize());
      // SAHNE KAYBOLMUYOR: arka planda duruyor, sekmeden bağımsız. Yalnız
      // yeniden ölçülmesini istiyoruz (telefonda sahne şeridi kayabiliyor).
      if (window.Tarla) window.Tarla.gorunurluk(true);
      // Panel kendi içinde kaydırılıyor; sayfa değil.
      const govde = $("#sol-panel-govde");
      if (govde) govde.scrollTop = 0;
      window.scrollTo({ top: 0 });
    };
  });

  /* SOL PANEL — katlanabilir ve genişletilebilir.
   *
   * Katlamak sahneyi BÜYÜTMÜYOR: sahne zaten bütün kabuğu kaplıyor, panel
   * yalnız üstünden çekiliyor. Bu yüzden katlarken tuvale dokunmaya da
   * gerek yok — WebGL bağlamı ve kamera açısı olduğu gibi kalıyor. */
  const solPanel = $("#sol-panel");
  function solPanelKatla(katli) {
    if (!solPanel) return;
    solPanel.classList.toggle("katli", katli);
    localStorage.setItem("farmbot_sol_panel", katli ? "katli" : "acik");
    const d = $("#d-sol-katla");
    if (d) d.setAttribute("aria-expanded", String(!katli));
    // Telefonda panel akışın içinde: katlanınca sahne şeridi yer değiştiriyor.
    if (window.Tarla) window.Tarla.gorunurluk(true);
  }
  if (solPanel) {
    $("#d-sol-katla").onclick = () => solPanelKatla(true);
    $("#d-sol-ac").onclick = () => solPanelKatla(false);
    if (localStorage.getItem("farmbot_sol_panel") === "katli") solPanelKatla(true);
  }

  // "?" açıklama düğmeleri — her biri kendinden sonraki .yardim-metin'i açar.
  // Tek tek bağlamak yerine tek kural: yeni bir bölüm eklendiğinde JS'e
  // dokunmak gerekmesin.
  $$(".yardim").forEach((d) => {
    d.onclick = (o) => {
      o.stopPropagation();
      // Metni bulmanın iki yolu: açıkça aria-controls verilmişse o, yoksa
      // başlığın hemen ardındaki paragraf. Bölüm başlıkları artık bir
      // düğme olduğu için "?" onların DIŞINDA duruyor ve eski kural
      // (h3'ün kardeşi) tek başına yetmiyor.
      const hedef = d.getAttribute("aria-controls");
      const metin = hedef ? document.getElementById(hedef)
                          : (d.closest("h3, h4, .bolum-ust") || {}).nextElementSibling;
      if (!metin || !metin.classList.contains("yardim-metin")) return;
      const acik = metin.classList.toggle("gizli");
      d.setAttribute("aria-expanded", String(!acik));
    };
  });

  // Olay günlüğü şeridi — açık/kapalı tercihi hatırlanıyor.
  const serit = $("#gunluk-serit");
  // Varsayılan KAPALI. Şerit yapışkan olduğu için açıkken sayfanın alt ~140
  // pikselini örtüyor; testte bir tıklamayı yutması bunu gösterdi. Kapalıyken
  // tek satırlık özet son olayı yine gösteriyor, açmak kullanıcının kararı.
  if (localStorage.getItem("farmbot_gunluk") !== "acik") serit.classList.add("kapali");
  $("#d-gunluk-ac").setAttribute("aria-expanded", String(!serit.classList.contains("kapali")));
  $("#d-gunluk-ac").onclick = () => {
    serit.classList.toggle("kapali");
    const kapali = serit.classList.contains("kapali");
    localStorage.setItem("farmbot_gunluk", kapali ? "kapali" : "acik");
    $("#d-gunluk-ac").setAttribute("aria-expanded", String(!kapali));
  };

  /* AÇILIR PANELLER — katman rafı ve harita ayarı sahnenin üstünde sürekli
   * durmuyor, çubuktaki düğmeden açılıyor. Sürekli açık bir liste, bakılan
   * şeyin bir kısmını kapatıyor; asıl iş sahnede.
   *
   * Aynı anda tek panel: ikisi birden açıkken üst üste biniyorlardı. */
  function acilirKapat(hepsi) {
    (hepsi || ["#katman-kutu", "#harita-ayar"]).forEach((sec) => {
      const k = $(sec);
      if (!k) return;
      k.hidden = true;
      k.classList.add("gizli");
      const d = $(`[aria-controls="${sec.slice(1)}"]`);
      if (d) { d.setAttribute("aria-expanded", "false"); d.classList.remove("secili"); }
    });
  }

  function acilirBagla(secici, dugmeSecici) {
    const kutu = $(secici), dugme = $(dugmeSecici);
    if (!kutu || !dugme) return;
    acilirKapat([secici]);
    dugme.onclick = () => {
      const acikti = !kutu.hidden && !kutu.classList.contains("gizli");
      acilirKapat();
      if (acikti) return;
      kutu.hidden = false;
      kutu.classList.remove("gizli");
      dugme.setAttribute("aria-expanded", "true");
      dugme.classList.add("secili");
    };
  }
  acilirBagla("#katman-kutu", "#d-katman-ac");
  acilirBagla("#harita-ayar", "#d-harita-ayar");

  /* Bitki simgeleri — eskiden bir onay kutusuydu; sahne çubuğunda etiketli
   * bir kutu, ikonlu düğmelerin arasında yamalı duruyordu. Rol yine
   * onay kutusu (ekran okuyucu için aria-checked), görünüşü düğme. */
  const simgeDugme = $("#tarla-simge");
  if (simgeDugme) {
    simgeDugme.onclick = () => {
      const acik = simgeDugme.getAttribute("aria-checked") !== "true";
      simgeDugme.setAttribute("aria-checked", String(acik));
      simgeDugme.classList.toggle("secili", acik);
      if (window.Tarla) window.Tarla.noktalarDegisti(true);
    };
  }
  $$(".acilir-kapat").forEach((d) => {
    const hedef = d.getAttribute("data-hedef");
    d.onclick = () => acilirKapat([hedef]);
  });
  /* Boşluğa tıklayınca KAPANMIYOR — bilerek. Bu paneller sahneye BAKARKEN
   * kullanılıyor: bir katmanı kapat, sahneye bak, bir tane daha kapat.
   * Her sahne tıklamasında kapanan bir panel, her seferinde yeniden
   * açılmayı gerektiriyordu. Kapatmak için: aynı düğme, ✕ ya da Esc. */
  document.addEventListener("keydown", (o) => { if (o.key === "Escape") acilirKapat(); });

  /* KATLANABİLİR BÖLÜMLER — panel bir form yığını değil, bölüm listesi.
   * Aynı anda en fazla üç blok görünsün diye "Gelişmiş" katlı başlıyor;
   * kullanıcının açtığı/kapattığı her bölüm hatırlanıyor. */
  $$(".bolum").forEach((bolum) => {
    const basDugme = bolum.querySelector(".bolum-bas");
    if (!basDugme) return;
    const anahtar = "farmbot_bolum_" + bolum.id;
    const kayitli = localStorage.getItem(anahtar);
    if (kayitli === "kapali") bolum.classList.add("kapali");
    if (kayitli === "acik") bolum.classList.remove("kapali");
    const yaz = () => basDugme.setAttribute(
      "aria-expanded", String(!bolum.classList.contains("kapali")));
    yaz();
    basDugme.onclick = () => {
      bolum.classList.toggle("kapali");
      localStorage.setItem(anahtar, bolum.classList.contains("kapali") ? "kapali" : "acik");
      yaz();
      Object.values(S.grafikler).forEach((g) => g.resize());
    };
  });

  // Geniş ekranda sahne zaten tam boy; telefonda şerit hâlinde ve "Büyüt"
  // onu tam boya çıkarıyor. Düğme yalnız dar ekranda görünüyor.
  const haritaKutu = $("#harita");
  const buyutDugme = $("#d-harita-buyut");
  if (haritaKutu && buyutDugme) {
    buyutDugme.onclick = () => {
      const buyuk = haritaKutu.classList.toggle("buyuk");
      buyutDugme.textContent = buyuk ? "Küçült" : "Büyüt";
      buyutDugme.setAttribute("aria-expanded", String(buyuk));
      // Tuval yüksekliği CSS'ten değişti; çizici yeni ölçüyü öğrenmeli.
      if (window.Tarla) window.Tarla.gorunurluk(true);
    };
  }

  // Son kalınan sekmeye dön: sayfa yenilendiğinde İzle'ye düşmek, uzun bir
  // işin ortasında can sıkıcı.
  const kayitli = $(`nav.sekmeler button[data-sayfa="${S.sekme}"]`);
  if (kayitli && S.sekme !== "izle") kayitli.click();
  else {
    // İzle'deysek yukarıdaki tıklama hiç olmuyor; başlığı yine de yaz.
    const ad = $("#sol-panel-ad"), ilk = $('nav.sekmeler button.etkin');
    if (ad && ilk) ad.textContent = (ilk.textContent || "").trim();
  }

  $$(".aralik").forEach((dugme) => {
    dugme.onclick = () => {
      $$(".aralik").forEach((b) => b.classList.remove("secili"));
      dugme.classList.add("secili");
      S.dakika = Number(dugme.dataset.dakika);
      gecmisYukle();
    };
  });

  $$(".jog").forEach((dugme) => {
    dugme.onclick = () => jogAcKapa(dugme.dataset.eksen, Number(dugme.dataset.yon), dugme);
  });

  // Sekme gizlenirse, pencere odağı giderse ya da sayfa kapanırsa jog biter.
  // Tıkla-çalış kipinde bu daha da önemli: ekrana bakan kimse kalmadığında
  // eksenin kendi başına gitmeye devam etmesini istemiyoruz.
  document.addEventListener("visibilitychange", () => { if (document.hidden) jogDurdur(); });
  window.addEventListener("blur", jogDurdur);
  window.addEventListener("pagehide", jogDurdur);

  $("#d-home").onclick = () => komutGonder("home");
  // Eksen bazli referans: ajan zaten {"eksen":"x"} kabul ediyordu,
  // eksik olan yalnizca dugmelerdi. Z korumasi ajanda.
  $$("[data-home]").forEach((b) => {
    b.onclick = () => komutGonder("home", { eksen: b.dataset.home });
  });
  $("#d-dur").onclick = () => { jogDurdur(); komutGonder("dur"); };
  $("#d-enable").onclick = () => komutGonder("enable", { deger: !S.enable });
  $("#d-acil-temizle").onclick = () => komutGonder("acil_temizle");
  $("#a-kamera").onchange = (e) => {
    const acik = e.target.checked;
    if (!acik) kameraGoruntuTemizle();   // beklemeden kapansin
    komutGonder("kamera", { acik });
  };
  /* Yüzen kamerayı sürükleme.
   *
   * Kutu ızgarayla yerleştirilmiş (sağ alt). Sürüklerken ızgarayı bırakıp
   * mutlak konuma geçmek yerine `transform` ile KAYDIRIYORUZ: ızgara
   * yerleşimi başlangıç noktası olarak kalıyor, pencere yeniden
   * boyutlandığında kutu yine sağ alta göre oturuyor.
   *
   * Konum localStorage'da: her açılışta kutuyu yeniden taşımak istemezsiniz.
   */
  const yuzenKutu = $("#kamera-yuzen");
  if (yuzenKutu) {
    const bas = yuzenKutu.querySelector(".kamera-yuzen-bas");
    let kayma = { x: 0, y: 0 };
    try {
      const kayit = JSON.parse(localStorage.getItem("farmbot_kamera_kayma") || "null");
      if (kayit && Number.isFinite(kayit.x) && Number.isFinite(kayit.y)) kayma = kayit;
    } catch { /* bozuk kayıt — varsayılan konumda kal */ }

    const uygula = () => {
      yuzenKutu.style.transform = `translate(${kayma.x}px, ${kayma.y}px)`;
    };
    /* Ekran dışına kaçmasın: kutunun ızgaradaki yerini transform'suz ölçüp
     * kaymayı o ölçüye göre sınırlıyoruz. Aksi hâlde kutu bir kez dışarı
     * sürüklenince geri getirilemiyor. */
    const sinirla = () => {
      const onceki = yuzenKutu.style.transform;
      yuzenKutu.style.transform = "";
      const y = yuzenKutu.getBoundingClientRect();
      yuzenKutu.style.transform = onceki;
      /* Kutu GİZLİYKEN ölçüm sıfır dönüyor ve sınırlama kaydedilmiş konumu
       * eziyordu: açılışta kutu gizli olduğu için kayıt her seferinde
       * kayboluyor, kamera hep köşeye dönüyordu. Ölçülemiyorsa dokunmuyoruz;
       * kutu görünür olunca yeniden sınırlanıyor. */
      if (!y.width || !y.height) return;
      if (yuzenKutu.classList.contains("buyuk")) return;
      const pay = 24;                    // kutunun bu kadarı hep görünsün
      kayma.x = Math.max(-(y.left + y.width - pay),
                         Math.min(innerWidth - y.left - pay, kayma.x));
      kayma.y = Math.max(-(y.top + y.height - pay),
                         Math.min(innerHeight - y.top - pay, kayma.y));
    };
    uygula();
    kameraYuzenSinirla = () => { sinirla(); uygula(); };
    kameraYuzenSinirla();

    let surukle = null;
    bas.addEventListener("pointerdown", (e) => {
      // Kapatma/büyütme düğmesine basarken sürükleme başlamasın.
      if (e.target.closest("button")) return;
      // Ekranı kaplarken sürüklemenin anlamı yok; üstelik satır içi
      // transform yazmak küçülünce kutuyu yanlış yere koyardı.
      if (yuzenKutu.classList.contains("buyuk")) return;
      surukle = { x: e.clientX, y: e.clientY, bx: kayma.x, by: kayma.y };
      bas.setPointerCapture(e.pointerId);
      yuzenKutu.classList.add("surukleniyor");
      e.preventDefault();
    });
    bas.addEventListener("pointermove", (e) => {
      if (!surukle) return;
      kayma.x = surukle.bx + (e.clientX - surukle.x);
      kayma.y = surukle.by + (e.clientY - surukle.y);
      sinirla();
      uygula();
    });
    const birak = () => {
      if (!surukle) return;
      surukle = null;
      yuzenKutu.classList.remove("surukleniyor");
      try {
        localStorage.setItem("farmbot_kamera_kayma", JSON.stringify(kayma));
      } catch { /* depolama kapalı olabilir — konum bu oturumda kalır */ }
    };
    bas.addEventListener("pointerup", birak);
    bas.addEventListener("pointercancel", birak);
    // Pencere küçülünce kutu dışarıda kalabilir.
    addEventListener("resize", () => { sinirla(); uygula(); });
  }

  const hizKaydet = $("#d-eksen-hiz-kaydet");
  if (hizKaydet) {
    hizKaydet.onclick = () => {
      // Boş alan "bu eksende genel hız geçerli" demek — sıfır değil null.
      const oku = (e) => {
        const v = $("#hiz-" + e).value.trim();
        return v === "" ? null : Number(v);
      };
      komutGonder("hiz_eksen", { x: oku("x"), y: oku("y"), z: oku("z") });
    };
  }

  const yuzenBuyut = $("#d-kamera-yuzen-buyut");
  if (yuzenBuyut && yuzenKutu) {
    const buyutYaz = (buyuk) => {
      yuzenKutu.classList.toggle("buyuk", buyuk);
      yuzenBuyut.textContent = buyuk ? "⤡" : "⤢";
      yuzenBuyut.title = buyuk ? "Küçült" : "Ekrana sığdır";
      yuzenBuyut.setAttribute("aria-label", yuzenBuyut.title);
      yuzenBuyut.setAttribute("aria-pressed", buyuk ? "true" : "false");
      // Küçülürken sürüklenmiş konum yeniden sınırlanmalı: pencere
      // büyükken değişmiş olabilir.
      if (!buyuk) kameraYuzenSinirla();
    };
    yuzenBuyut.onclick = () => buyutYaz(!yuzenKutu.classList.contains("buyuk"));
    // Esc ile çıkış: ekranı kaplayan bir şeyden çıkışın beklenen yolu.
    // Diğer Esc davranışlarının önüne geçmesin diye yalnızca büyükken
    // yakalıyoruz ve olayı durduruyoruz.
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && yuzenKutu.classList.contains("buyuk")) {
        e.stopPropagation();
        buyutYaz(false);
      }
    }, true);
  }

  const yuzenKapat = $("#d-kamera-yuzen-kapat");
  if (yuzenKapat) {
    yuzenKapat.onclick = () => {
      // Küçültmek kamerayı KAPATMIYOR — yalnızca sahnedeki kopyayı gizliyor.
      // Panel bölümündeki görüntü akmaya devam ediyor.
      S.kameraYuzenKapali = true;
      // Büyük hâlde gizlemek, geri açınca ekranı kaplayan bir kutuyla
      // karşılaşmak demek olurdu.
      $("#kamera-yuzen").classList.remove("buyuk");
      if (yuzenBuyut) {
        yuzenBuyut.textContent = "⤢";
        yuzenBuyut.title = "Ekrana sığdır";
        yuzenBuyut.setAttribute("aria-pressed", "false");
      }
      $("#kamera-yuzen").classList.add("gizli");
      gunluk("Sahnedeki kamera küçültüldü — Kamera bölümünden geri açılır");
    };
  }
  const yuzenAc = $("#d-kamera-yuzen-ac");
  if (yuzenAc) {
    yuzenAc.onclick = () => {
      S.kameraYuzenKapali = false;
      // Bayrağı temizleyip bir sonraki kareyi beklemek yetmiyordu: kamera
      // kapalıysa ya da aralık uzunsa düğme hiçbir şey yapmamış gibi
      // görünüyordu. Elimizde kare varsa hemen gösteriyoruz.
      if (S.sonKareAdres) {
        $("#kamera-yuzen-kare").src = S.sonKareAdres;
        $("#kamera-yuzen-zaman").textContent =
          (S.sonKareCanli ? "canlı " : "")
          + new Date(S.sonKareTs * 1000).toLocaleTimeString("tr-TR");
        $("#kamera-yuzen").classList.remove("gizli");
        kameraYuzenSinirla();
        gunluk("Sahnedeki kamera geri açıldı");
      } else {
        gunluk("Sahnedeki kamera açılacak — henüz kare yok, kamerayı açın");
      }
    };
  }

  const canliDugmesi = $("#d-kamera-canli");
  if (canliDugmesi) {
    canliDugmesi.onclick = () => komutGonder("kamera",
      { canli: !canliDugmesi.classList.contains("secili"), fps: 5 });
  }
  $$(".kamera-aralik").forEach((dugme) => {
    // Aralık komutu kamerayı da açık tutuyor: kapalıyken aralık seçmek
    // "hiçbir şey olmadı" demek olurdu.
    dugme.onclick = () => komutGonder("kamera",
      { acik: true, aralik_sn: Number(dugme.dataset.saniye) });
  });
  $("#d-buraya").onclick = () => {
    ["x", "y", "z"].forEach((eksen) => {
      const metin = $(`#k-${eksen}`).textContent.replace(/[^\d.,-]/g, "").replace(",", ".");
      if (metin) $(`#h-${eksen}`).value = parseFloat(metin);
    });
  };
  $("#d-acil").onclick = () => {
    // confirm() bilerek yok: acil durdurma bir soru sormaz, uygular.
    jogDurdur();
    komutGonder("acil");
    S.roleDurum = { su_pompasi: false, hava_pompasi: false };
    $$(".role").forEach((b) => {
      b.classList.remove("acik");
      const e = b.querySelector(".role-durum");
      if (e) e.textContent = "kapalı";
    });
  };

  $("#d-nokta-kaydet").onclick = noktaKaydet;
  $("#prog-secim").onchange = () => programYukle($("#prog-secim").value);
  $("#d-prog-yeni").onclick = () => {
    $("#prog-ad").value = ""; $("#prog-tekrar").value = 1;
    degiskenleriCiz([]); adimlariCiz([]); degerFormuCiz();
  };
  $("#d-adim-ekle").onclick = () => adimlariCiz([...adimlariTopla(), { tip: "nokta", ad: S.noktalar[0]?.ad || "" }]);
  $("#d-degisken-ekle").onclick = () => {
    degiskenleriCiz([...degiskenleriTopla(), { ad: "hedef", tip: "nokta", aciklama: "" }]);
    adimlariCiz(adimlariTopla());
  };
  $("#d-prog-kaydet").onclick = async () => {
    try {
      const p = await apiIste("/api/programlar", {
        method: "POST",
        body: JSON.stringify({ ad: $("#prog-ad").value, tekrar: Number($("#prog-tekrar").value),
                               degiskenler: degiskenleriTopla(),
                               adimlar: adimlariTopla() }),
      });
      gunluk(`✓ '${p.program.ad}' kaydedildi (${p.program.adimlar.length} adım)`, "ok");
      await programlariYukle(p.program.ad);
    } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
  };
  $("#d-prog-calistir").onclick = async () => {
    try {
      const s = await apiIste("/api/programlar/calistir", {
        method: "POST",
        body: JSON.stringify({ ad: $("#prog-secim").value, degerler: degerleriTopla() }),
      });
      gunluk(s.ok ? `✓ ${s.mesaj}` : `✕ ${s.mesaj}`, s.ok ? "ok" : "hata");
    } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
  };
  $("#d-prog-durdur").onclick = () => komutGonder("dizi_durdur");
  $("#d-prog-sil").onclick = async () => {
    const ad = $("#prog-secim").value;
    if (!ad || !confirm(`'${ad}' silinsin mi?`)) return;
    try {
      await apiIste(`/api/programlar?ad=${encodeURIComponent(ad)}`, { method: "DELETE" });
      gunluk(`✓ '${ad}' silindi`, "ok");
      await programlariYukle();
    } catch (hata) { gunluk(`✕ ${hata.message}`, "hata"); }
  };

  $("#d-uc-tak").onclick = () => komutGonder("uc_degistir", { ad: $("#uc-secim").value });
  $("#d-uc-birak").onclick = () => komutGonder("uc_birak");
  $("#d-uc-dur").onclick = () => komutGonder("dur");
  $("#uc-secim").onchange = onizlemeTazele;

  const satirEkle = $("#d-uc-satir-ekle");
  if (satirEkle) {
    satirEkle.onclick = () => {
      const l = ucTablosuTopla();
      l.push({ name: `tool${l.length + 1}`, x: 0, y: 0, z: 0 });
      ucTablosuCiz(l, S.ucYollar);
      S.ucAyarDuzenleniyor = true;
    };
  }
  const tabloKaydet = $("#d-uc-tablo-kaydet");
  if (tabloKaydet) tabloKaydet.onclick = ucTablosuKaydet;
  $("#d-uc-temizle").onclick = async () => {
    if (!confirm("Takılı uç kaydı sıfırlanacak. Hiçbir eksen hareket etmez — "
                 + "makinede uç olup olmadığını gözle doğrulayın. Devam?")) return;
    await komutGonder("uc_durum_temizle");
  };

  $$("details.uc-ayar input, details.uc-ayar select").forEach((el) => {
    el.oninput = () => { S.ucAyarDuzenleniyor = true; };
  });
  $("#d-uc-ayar-kaydet").onclick = async () => {
    const sayi_ = (id, bosDegeri = null) => {
      const v = $("#ua-" + id).value;
      return v === "" ? bosDegeri : Number(v);
    };
    const ayar = {
      safe_z: sayi_("safe_z", 280), travel_z: sayi_("travel_z", 280),
      lift: sayi_("lift", 80), approach: sayi_("approach", -55),
      retreat: sayi_("retreat"),          // boş = approach kullan
      speed: sayi_("speed", 20), slide_axis: $("#ua-slide_axis").value,
      lock_dwell: sayi_("lock_dwell", 1500),
      lock_reg: sayi_("lock_reg", 0), grip_reg: sayi_("grip_reg", 0),
      presence_reg: sayi_("presence_reg", 0), z_safe_reg: sayi_("z_safe_reg", 0),
      tc_area: {
        on: $("#ua-alan-acik").checked,
        pts: [0, 1, 2, 3].map((i) => [Number($(`#ua-k${i}x`).value), Number($(`#ua-k${i}y`).value)]),
      },
      // Boş X = tohumluk tanımsız. Sayıya çevirmiyoruz: "" -> 0 olur ve
      // tohumluk sahnenin X0 köşesine çizilirdi.
      tohumluk: { x: $("#ua-th-x").value === "" ? null : Number($("#ua-th-x").value),
                  y: $("#ua-th-y").value === "" ? null : Number($("#ua-th-y").value),
                  z: $("#ua-th-z").value === "" ? null : Number($("#ua-th-z").value) },
      // Boş = 0: kayma yoksa sıfır, "tanımsız" diye bir hâli yok.
      sulama_basligi: { dx: Number($("#ua-sb-dx").value || 0),
                        dy: Number($("#ua-sb-dy").value || 0),
                        z_min: Number($("#ua-sb-zmin").value || 0) },
    };
    const sonuc = await komutGonder("uc_kaydet", { ayar });
    if (sonuc && sonuc.ok) {
      S.ucAyarDuzenleniyor = false;
      if (ayar.tc_area.on) {
        gunluk("⚠ Uç değiştirme alanı AÇILDI — alan içinde Z kilidi devre dışı", "hata");
      }
      onizlemeTazele();
    }
  };

  $("#d-bolge-ekle").onclick = () => {
    const liste = bolgeleriTopla();
    liste.push({ ad: `bölge ${liste.length + 1}`, x1: 0, y1: 0, x2: 100, y2: 100,
                 izin_kosulu: "z>=safe_z", yuva: false, aktif: true });
    bolgeleriCiz(liste);
    S.bolgeDuzenleniyor = true;
  };
  $("#d-bolge-kaydet").onclick = async () => {
    await bolgeleriKaydet();
    S.bolgeDuzenleniyor = false;
  };
  $("#bolge-liste").addEventListener("input", () => { S.bolgeDuzenleniyor = true; });

  $("#d-dikim-ekle").onclick = () => {
    const liste = dikimTopla();
    /* Varsayılan: yatağın orta yarısı. Sıfırdan başlayan bir dikdörtgen
     * çoğu kurulumda kabın dışına düşüyor ve kullanıcı dört sayıyı birden
     * değiştirmek zorunda kalıyordu. */
    const sx = (S.sinirlar && S.sinirlar.x) || { min: 0, max: 425 };
    const sy = (S.sinirlar && S.sinirlar.y) || { min: 0, max: 550 };
    const enX = sx.max - sx.min, enY = sy.max - sy.min;
    liste.push({
      ad: `alan ${liste.length + 1}`,
      x1: Math.round(sx.min + enX * 0.15), y1: Math.round(sy.min + enY * 0.15),
      x2: Math.round(sx.max - enX * 0.15), y2: Math.round(sy.min + enY * 0.45),
    });
    dikimCiz(liste);
  };
  $("#d-dikim-kaydet").onclick = dikimKaydet;

  $("#d-izgara-onizle").onclick = izgaraOnizle;
  $("#d-izgara-uygula").onclick = izgaraUygula;
  // Form değişince eski önizleme yanıltıcı olur; "Uygula" o değerlerle
  // çalışmıyor artık.
  $$(".izgara-form input").forEach((g) => {
    g.oninput = () => {
      $("#izgara-onizleme").classList.add("gizli");
      $("#d-izgara-uygula").classList.add("gizli");
    };
  });
  $("#nokta-ad").onkeydown = (o) => { if (o.key === "Enter") noktaKaydet(); };

  const hizKaydirac = $("#hiz-kaydirac");
  hizKaydirac.oninput = () => { $("#hiz-etiket").textContent = `${hizKaydirac.value} mm/s`; };
  hizKaydirac.onchange = () => komutGonder("hiz", { mm_s: Number(hizKaydirac.value) });

  $("#d-git").onclick = () => {
    const arg = {};
    ["x", "y", "z"].forEach((eksen) => {
      const deger = $(`#h-${eksen}`).value;
      if (deger !== "") arg[eksen] = Number(deger);
    });
    if (!Object.keys(arg).length) { gunluk("✕ En az bir eksen değeri girin", "hata"); return; }
    komutGonder("git", arg);
  };

  $$(".role").forEach((dugme) => {
    dugme.onclick = async () => {
      const ad = dugme.dataset.role;
      const yeni = !S.roleDurum[ad];
      const etiket = dugme.querySelector(".role-durum");
      // Tıklayınca hemen değişsin: kart durumu 2 saniyede bir bildiriyor ve
      // o iki saniye boyunca "bastım mı, basmadım mı" hissi veriyordu.
      // Kart yanıt verince roleDurumSenkron zaten doğrusunu yazıyor —
      // yani bu geçici gösterim yanlışsa kendiliğinden düzeliyor.
      if (etiket) etiket.textContent = yeni ? "AÇIK" : "kapalı";
      dugme.classList.toggle("acik", yeni);
      const sonuc = await komutGonder("role", { ad, durum: yeni });
      if (sonuc && sonuc.ok) {
        S.roleDurum[ad] = yeni;
      } else {
        // Komut gitmediyse eski görünüme dön.
        if (etiket) etiket.textContent = S.roleDurum[ad] ? "AÇIK" : "kapalı";
        dugme.classList.toggle("acik", !!S.roleDurum[ad]);
      }
    };
  });

  // Klavye: ok tuşları X/Y, PageUp/Down Z — düğmelerle aynı, tıkla-çalış.
  // Aynı tuşa tekrar basmak durdurur; Esc her hâlükârda durdurur.
  // Boşluk acil durdurma.
  const TUS = {
    ArrowRight: ["x", 1], ArrowLeft: ["x", -1],
    ArrowUp: ["y", 1], ArrowDown: ["y", -1],
    PageUp: ["z", 1], PageDown: ["z", -1],
  };
  const jogDugmesi = (eksen, yon) =>
    document.querySelector(`.jog[data-eksen="${eksen}"][data-yon="${yon}"]`);

  document.addEventListener("keydown", (olay) => {
    // Kısayollar yalnızca Sür sekmesinde: başka sekmede yazı yazarken ok
    // tuşunun makineyi hareket ettirmesi kabul edilemez.
    if (olay.target.tagName === "INPUT" || olay.target.tagName === "SELECT"
        || !$("#sayfa-sur").classList.contains("etkin")) return;
    if (olay.code === "Space") { olay.preventDefault(); $("#d-acil").click(); return; }
    if (olay.key === "Escape") { olay.preventDefault(); jogDurdur(); return; }
    const eslesme = TUS[olay.key];
    if (!eslesme) return;
    olay.preventDefault();
    if (olay.repeat) return;
    jogAcKapa(eslesme[0], eslesme[1], jogDugmesi(eslesme[0], eslesme[1]));
  });
}

/* --------------------------------------------------- kalibrasyon tablosu
 * Salt okunur. Amaç "panelde şu yazıyor ama makine başka gidiyor"
 * tartışmasını bitirmek: ajanın o an hangi katsayılarla çalıştığı görünsün.
 */
function kalibrasyonCiz(d) {
  const govde = $("#kalib-govde");
  if (!govde) return;
  const imza = JSON.stringify([d.kalibrasyon || null, d.sinirlar || null, d.guvenli_z]);
  if (imza === S.kalibImza) return;
  S.kalibImza = imza;

  const k = d.kalibrasyon, sn = d.sinirlar;
  if (!k || !sn) {
    govde.innerHTML = '<tr><td colspan="6" class="alt-not">Ajan bağlanınca dolacak.</td></tr>';
    return;
  }
  govde.innerHTML = ["x", "y", "z"].map((e) => {
    const c = k[e] || {}, s = sn[e] || {};
    return `<tr><td><b>${e.toUpperCase()}</b></td>
      <td>${sayi(c.cpm, 4)}</td><td>${c.dir > 0 ? "+1" : "−1"}</td>
      <td>${sayi(c.home, 1)}</td><td>${sayi(s.min, 1)}</td><td>${sayi(s.max, 1)}</td></tr>`;
  }).join("");
  $("#kalib-ek").innerHTML =
    `Güvenli Z yüksekliği: <b>${sayi(d.guvenli_z, 0)} mm</b> — X/Y hareketi için ` +
    `Z'nin bulunması gereken en düşük yükseklik. Hız: <b>${sayi(d.hiz, 0)} mm/s</b>.`;
}

/* --------------------------------------------------------------- köprü
 * `tarla.js` ayrı bir dosya ve buranın iç değişkenlerine dokunmuyor; ihtiyacı
 * olan birkaç şey burada açıkça dışarı veriliyor. Böylece iki dosya arasındaki
 * bağ tek satırda görülebiliyor.
 */
window.Panel = { S, komutGonder, apiIste, gunluk, noktalariYukle, egrileriYukle,
                 geriAlGoster, tanilariCiz };

/* -------------------------------------------------------------------- açılış */
async function basla() {
  $("#uygulama").classList.remove("gizli");
  // Grafik kurulumu patlarsa (kütüphane yüklenmediyse) kontrol sayfası yine
  // çalışsın: makineyi durdurabilmek, grafik görebilmekten önce gelir.
  try {
    grafikleriKur();
  } catch (hata) {
    console.error("Grafikler kurulamadı", hata);
    $$(".grafik-kutu").forEach((k) => { k.innerHTML = '<p class="alt-not">Grafik kütüphanesi yüklenemedi.</p>'; });
  }
  olaylariBagla();
  $("#d-geri-al").onclick = geriAlUygula;
  $("#d-geri-al-kapat").onclick = geriAlKapat;
  kalibBagla();
  kalibrasyonYukle();
  egriBagla();
  // Tarla sahnesi kendi dosyasında; three.js yüklenmediyse panel yine çalışsın.
  try {
    if (window.Tarla) await window.Tarla.kur();
  } catch (hata) {
    console.error("Tarla sahnesi kurulamadı", hata);
  }
  if (Object.keys(S.grafikler).length) await gecmisYukle();
  await egrileriYukle();
  await noktalariYukle();
  await programlariYukle();
  await dikimYukle();
  // Sayfa açılırken zaten bir kare varsa hemen göster.
  try {
    const k = await apiIste("/api/kare/liste");
    if (k.kareler && k.kareler.length) kareyiTazele(k.kareler[k.kareler.length - 1].ts);
  } catch (hata) { /* kare yoksa sorun değil */ }
  wsBagla();
}

async function girisDene(jeton) {
  const yanit = await fetch(`/api/durum?jeton=${encodeURIComponent(jeton)}`);
  if (yanit.status === 401) return false;
  const govde = await yanit.json();
  S.jeton = jeton;
  localStorage.setItem("farmbot_jeton", jeton);
  await basla();
  durumGuncelle(govde.durum);
  kartlariGuncelle(govde.olcum);
  return true;
}

(async function ilkAcilis() {
  // Parola ayarlı mı? Ayarlı değilse hiç sormuyoruz.
  const yanit = await fetch(`/api/durum?jeton=${encodeURIComponent(S.jeton)}`);
  if (yanit.ok) {
    const govde = await yanit.json();
    await basla();
    durumGuncelle(govde.durum);
    kartlariGuncelle(govde.olcum);
    return;
  }
  $("#giris").classList.add("acik");
  const dene = async () => {
    const ok = await girisDene($("#parola").value);
    if (ok) $("#giris").classList.remove("acik");
    else $("#giris-hata").textContent = "Parola hatalı";
  };
  $("#giris-dugme").onclick = dene;
  $("#parola").onkeydown = (o) => { if (o.key === "Enter") dene(); };
})();
