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
  // KAMERALAR — birden çok. Aşağıdaki üç sözlük KAMERA ADINA göre
  // anahtarlı: bir kameranın hâli ötekini etkilemesin diye. Tek bir alan
  // paylaşmak, iki kameranın birbirinin karesini/çözümlemesini ezmesi
  // demekti.
  kameralar: [],            // ajandan gelen kamera künyeleri (sıralı)
  kamSecim: "",             // Ayarlar kartının işlediği kamera
  kamKutuKapali: {},        // ad -> sahnedeki yüzen kutu kullanıcı tarafından gizlendi mi
  sonKare: {},              // ad -> {adres, canli, ts}
  kamCozler: {},            // ad -> son çözümleme (yok = kutu boş)
  kamDondu: {},             // ad -> ekran çözümlenen karede donduruldu mu
  kamMaskeler: {},          // ad -> maske katmanı açık mı
  kamFps: {},               // ad -> {damga:[], yazi} — kare/sn sayacı
  kamCanliElle: {},         // ad -> kullanıcı canlıyı elle kapattı mı
  kalibrasyonlar: {},       // ad -> kalibrasyon (yarı altındaki özet için)
  dakika: 60,
  ws: null,
  jogAktif: null,        // {eksen, yon, dugme} — şu an basılı tutulan jog
  jogSayac: null,        // yenileme zamanlayıcısı
  enable: false,
  grafikler: {},
  roleDurum: { su_pompasi: false, hava_pompasi: false },
  kalibElle: {},           // kalibrasyonda elle girilip henüz kaydedilmemiş kutular
  noktalar: [],
  bolgeler: [],
  ucYollar: {},      // uç adı -> {al:[…], birak:[…]} — ajandan geliyor
  sonUcTools: null,  // tablo imzası: değişmedikçe yeniden çizmiyoruz
  sonUcAyar: null,
  dikim: [],        // sunucudaki dikim alanları (sunucu/dikim.py)
  ucListesi: [],
  sonTakiliUc: undefined,
  ucAyarDuzenleniyor: false,
  sonGozler: null,      // tohumluk gözleri imzası
  gozDuzenleniyor: false,
  kamAyarTaslak: null,  // Kameralar bölümünde düzenlenen, henüz kaydedilmemiş tanımlar
  kalibSecim: "",       // kalibrasyon bölümünün işlediği kamera
  tepsiler: [],         // gözlü dikim alanları, gözleriyle
  tepsiSecim: [],       // seçili göz adları
  ucDurum: null,        // ajandan gelen son uç durumu (uc, dogrulanabilir…)
  ucTeyit: null,        // teyit bekleyen uç işlemi {islem, hedef}
  ekimOnay: null,       // onay bekleyen ekim oturumu (sunucudan)
  ekimAyar: {},         // onay anahtarı ve süreler
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

/* ----------------------------------------------------- fidelik tepsisi
 *
 * Gözlü bir dikim alanının gözleri. Koordinatlar BURADA YAZILMIYOR:
 * tepsi bir kez parametrik tanımlanıyor (ilk göz, aralık, satır×sütun)
 * ve `dikim.gozler` hesaplıyor. 32 gözü elle yazmak hem uzun sürer hem
 * yanlış olur.
 *
 * Gözdeki bitki SIRADAN BİR BİTKİ: farkı `tepsi` + `goz` alanlarını
 * taşıması. İkinci bir "göz kaydı" kavramı açmadık — açsaydık ekim,
 * sulama, eğriler ve 3B sahne ikisini birden bilmek zorunda kalırdı.
 *
 * Numaralar GEOMETRİK, yani kalıcı: `p7` "yedinci kayıt" değil, "birinci
 * satır yedinci sütun". Bir gözü boşaltmak ötekileri kaydırmıyor.
 */
const GOZ_RENK = {
  bos: "gz-bos", planlandi: "gz-plan", ekildi: "gz-ekildi", sulandi: "gz-sulandi",
};
const GOZ_ETIKET = {
  bos: "boş", planlandi: "planlandı", ekildi: "ekildi", sulandi: "sulandı",
};

function tepsiSecili() {
  const ad = ($("#tepsi-secim") || {}).value || "";
  return (S.tepsiler || []).find((t) => t.alan === ad) || (S.tepsiler || [])[0] || null;
}

function tepsiCiz() {
  const izgara = $("#tepsi-izgara");
  const yok = $("#tepsi-yok");
  const arac = $("#tepsi-arac");
  const ozet = $("#tepsi-ozet");
  if (!izgara) return;

  const liste = S.tepsiler || [];
  // Tepsi seçim listesi — birden çok gözlü kap olabilir.
  const sec = $("#tepsi-secim");
  const onceki = sec.value;
  sec.innerHTML = liste.map((t) =>
    `<option value="${kacisli(t.alan)}">${kacisli(t.alan)}</option>`).join("");
  if (onceki && liste.some((t) => t.alan === onceki)) sec.value = onceki;

  if (!liste.length) {
    izgara.innerHTML = "";
    arac.classList.add("gizli");
    if (ozet) ozet.textContent = "tanımsız";
    yok.innerHTML = "Gözlü tepsi tanımlı değil.<br>"
      + "Ayarlar → Dikim alanları'ndan bir alanın zeminini "
      + "<b>Gözlü fidelik tepsisi</b> yapın.";
    yok.classList.remove("gizli");
    return;
  }
  yok.classList.add("gizli");
  arac.classList.remove("gizli");

  const t = tepsiSecili();
  if (ozet) ozet.textContent = `${t.dolu}/${t.toplam} göz dolu`;

  /* GÖZLER YUVARLAK DELİK. Tepsinin kendisi öyle görünüyor ve ekrandaki
   * dizilim makinedekiyle AYNI: satırlar Y'de, sütunlar X'te. Boş göz
   * koyu; içinde bitki varsa türün simgesi duruyor, yani göze bakınca
   * ne ekildiği okunuyor. */
  const turler = (window.Tarla && Tarla.turler && Tarla.turler()) || {};
  izgara.style.setProperty("--sutun", t.sutun || 1);
  izgara.innerHTML = (t.gozler || []).map((g) => {
    const tur = turler[g.tur] || null;
    const secili = (S.tepsiSecim || []).includes(g.goz);
    const ic = g.durum === "bos" ? "" : kacisli((tur && tur.icon) || "🌱");
    return `<button type="button" class="gz ${GOZ_RENK[g.durum] || "gz-bos"}${
      secili ? " secili" : ""}" data-goz="${kacisli(g.goz)}"
      title="${kacisli(g.goz)} · ${GOZ_ETIKET[g.durum]} · X${Math.round(g.x)} Y${Math.round(g.y)}">
      <span class="gz-ic">${ic}</span>
      <span class="gz-no">${kacisli(g.goz)}</span>
    </button>`;
  }).join("");

  $$("#tepsi-izgara .gz").forEach((d) => {
    d.onclick = (o) => {
      const goz = d.dataset.goz;
      const c = new Set(S.tepsiSecim || []);
      // Ctrl/Shift olmadan tek seçim: çoklu seçim ısrarla tıklamayı
      // gerektirseydi 32 gözlük bir tepside sabır sınavı olurdu.
      if (o.ctrlKey || o.metaKey || o.shiftKey) {
        if (c.has(goz)) c.delete(goz); else c.add(goz);
      } else if (c.has(goz) && c.size === 1) {
        c.clear();
      } else {
        c.clear(); c.add(goz);
      }
      S.tepsiSecim = [...c];
      tepsiCiz();
      tepsiKartYaz();
    };
  });
  tepsiKartYaz();
  tepsiKaymaYaz();
}

/** Seçili gözün kartı: ne olduğu, koordinatı ve oraya gitme düğmesi. */
function tepsiKartYaz() {
  const kart = $("#tepsi-kart");
  if (!kart) return;
  const t = tepsiSecili();
  const secim = S.tepsiSecim || [];
  if (!t || !secim.length) { kart.classList.add("gizli"); return; }
  if (secim.length > 1) {
    kart.innerHTML = `<b>${secim.length} göz seçili</b>
      <div class="alt-not">${kacisli(secim.slice(0, 12).join(", "))}${
        secim.length > 12 ? "…" : ""}</div>`;
    kart.classList.remove("gizli");
    return;
  }
  const g = (t.gozler || []).find((x) => x.goz === secim[0]);
  if (!g) { kart.classList.add("gizli"); return; }
  const turler = (window.Tarla && Tarla.turler && Tarla.turler()) || {};
  const tur = turler[g.tur];
  const zaman = (ts) => new Date(ts * 1000).toLocaleString("tr-TR");
  kart.innerHTML = `<div class="tepsi-kart-bas">
      <b>${kacisli(g.goz)}</b>
      <span class="gz-rozet ${GOZ_RENK[g.durum]}">${GOZ_ETIKET[g.durum]}</span>
      <span class="esnek"></span>
      <button class="dugme kucuk" id="d-tepsi-git">Git</button>
    </div>
    <div class="alt-not">Satır ${g.satir} · sütun ${g.sutun} ·
      <b>X${g.x.toFixed(1)} Y${g.y.toFixed(1)}</b>${
      t.toprak_z != null ? ` · yüzey Z${Number(t.toprak_z).toFixed(0)}` : ""}</div>`
    + (g.bitki
      ? `<div class="alt-not">${kacisli((tur && tur.icon) || "🌱")}
           <b>${kacisli((tur && tur.name_tr) || g.tur || "tür belirsiz")}</b>
           · kayıt: ${kacisli(g.bitki)}</div>`
        + (g.ekim ? `<div class="alt-not">Ekildi: ${zaman(g.ekim)}</div>`
                  : `<div class="alt-not">Henüz ekilmedi — ekim listesinde.</div>`)
        + (g.sulama_ts
          ? `<div class="alt-not" title="Sulama komutunun gittiği an. Akış sensörü yok; suyun düştüğü ölçülmüyor.">
               Sulama başlatıldı: ${zaman(g.sulama_ts)}</div>` : "")
      : `<div class="alt-not">Göz boş.</div>`);
  kart.classList.remove("gizli");
  const git = $("#d-tepsi-git");
  if (git) git.onclick = () => komutGonder("git", { x: g.x, y: g.y });
}

function tepsiKaymaYaz() {
  const t = tepsiSecili();
  const sec = $("#tk-goz");
  if (!t || !sec) return;
  const onceki = sec.value;
  sec.innerHTML = (t.gozler || []).map((g) =>
    `<option value="${kacisli(g.goz)}">${kacisli(g.goz)}</option>`).join("");
  if (onceki && (t.gozler || []).some((g) => g.goz === onceki)) sec.value = onceki;
  const k = t.tepsi || {};
  const not = $("#tk-mevcut");
  if (not) {
    not.textContent = (k.kayma_x || k.kayma_y)
      ? `Şu anki kayma: X${Number(k.kayma_x || 0).toFixed(1)} `
        + `Y${Number(k.kayma_y || 0).toFixed(1)} mm`
      : "Şu anda kayma uygulanmıyor.";
  }
}

async function tepsiYukle() {
  try {
    const y = await apiIste("/api/tepsi");
    S.tepsiler = y.tepsiler || [];
    // Artık var olmayan gözler seçili kalmasın.
    const t = tepsiSecili();
    const varOlan = new Set((t ? t.gozler : []).map((g) => g.goz));
    S.tepsiSecim = (S.tepsiSecim || []).filter((g) => varOlan.has(g));
    tepsiCiz();
  } catch (h) { /* parola yoksa sorun değil */ }
}

/** Seçili gözlere bitki koyar ya da gözleri boşaltır. */
async function tepsiGozYaz(bosalt) {
  const t = tepsiSecili();
  const secim = S.tepsiSecim || [];
  if (!t) return;
  if (!secim.length) { gunluk("Önce göz seçin", "uyari"); return; }
  const tur = ($("#tepsi-tur") || {}).value || "";
  try {
    const y = await apiIste("/api/tepsi/goz", {
      method: "POST",
      body: JSON.stringify({ alan: t.alan, gozler: secim, tur, bosalt }),
    });
    gunluk(bosalt
      ? `✓ ${y.bosaltilan} göz boşaltıldı`
      : `✓ ${secim.length} göze kondu (${y.eklendi} yeni, ${y.guncellendi} güncellendi)`,
      "ok");
    // Boşaltma bir SİLME: 30 saniyelik geri alma çubuğu burada da
    // çalışsın — yanlış gözü boşaltmak kolay.
    if (bosalt && y.geri_al) geriAlGoster(y.geri_al);
    await tepsiYukle();
    await noktalariYukle();
  } catch (h) {
    gunluk(`✕ ${h.message}`, "hata");
  }
}

/** Seçili gözlerdeki bitkilerle toplu işlem — ekim ya da sulama.
 *  AYNI uç noktayı kullanıyor: gözdeki bitki sıradan bir bitki ve
 *  mevcut akış (uç al, hazne, onaylar, home) aynen işliyor. */
async function tepsiTopluIslem(islem) {
  const t = tepsiSecili();
  const secim = S.tepsiSecim || [];
  if (!t || !secim.length) { gunluk("Önce göz seçin", "uyari"); return; }
  const adlar = (t.gozler || [])
    .filter((g) => secim.includes(g.goz) && g.bitki).map((g) => g.bitki);
  if (!adlar.length) {
    gunluk("Seçili gözlerde bitki yok — önce türü seçip 'gözlere koy' deyin",
           "uyari");
    return;
  }
  const govde = { islem, noktalar: adlar };
  if (islem === "sula") govde.saniye = 3;
  try {
    const y = await apiIste("/api/toplu", {
      method: "POST", body: JSON.stringify(govde),
    });
    gunluk(y.mesaj || `${adlar.length} göz için başlatıldı`, "iyi");
    await tepsiYukle();
  } catch (h) {
    gunluk(`✕ ${h.message}`, "hata");
  }
}

async function tepsiKaymaGonder() {
  const t = tepsiSecili();
  if (!t) return;
  const x = $("#tk-x").value, y = $("#tk-y").value;
  if (x === "" || y === "") {
    gunluk("Ölçülen X ve Y gerekiyor", "uyari");
    return;
  }
  try {
    const s = await apiIste("/api/tepsi/kayma", {
      method: "POST",
      body: JSON.stringify({ alan: t.alan, goz: $("#tk-goz").value,
                             x: Number(x), y: Number(y) }),
    });
    gunluk(`✓ '${t.alan}' hizalandı: X${s.kayma_x.toFixed(1)} `
      + `Y${s.kayma_y.toFixed(1)} mm`
      + (s.tasinan ? ` · ${s.tasinan} bitki taşındı` : ""), "ok");
    S.dikim = s.alanlar || S.dikim;
    dikimCiz(S.dikim);
    await tepsiYukle();
    await noktalariYukle();
  } catch (h) {
    gunluk(`✕ Hizalama: ${h.message}`, "hata");
  }
}

/* ------------------------------------------------------ ekim noktaları
 *
 * İki kip, tek uç nokta. Izgara düzenli dizilim üretiyor; koordinat
 * listesi kullanıcının tek tek yazdığı noktaları. İkincisi çünkü her
 * ekim düzenli bir ızgaraya oturmuyor ve fazla noktaları sonradan
 * silmek, istenen üçünü yazmaktan zor.
 *
 * TÜR BURADA SORULUYOR. Türsüz üretilen noktalar ekimde "türü yazılı
 * değil" diye reddediliyordu; kullanıcı 12 noktayı tek tek düzenlemek
 * zorunda kalıyordu. Üretirken sormak tek bir alan.
 */
function izgaraGirdisi() {
  // Z formda yok: tarla tasarımcısındaki bitkilerle aynı kural geçerli —
  // nokta güvenli taşıma yüksekliğine yazılıyor ki "git" dendiğinde uç
  // toprağa dalmasın. Ekim derinliği ayrı bir bilgi ve türde duruyor.
  //
  // IZGARA KİPİ KALDIRILDI. Düzenli dizilim artık tepsinin işi: ürettiği
  // noktalar kalıcı, numaralı ve tepsiyle birlikte hizalanıyor. Burada
  // yalnız DÜZ TOPRAK için serbest koordinat girme kaldı — ikisi
  // çakışmıyor ve iki paralel mekanizma değil.
  return {
    kip: "liste",
    tur: ($("#iz-tur") || {}).value || "",
    z: S.guvenliZ == null ? 340 : S.guvenliZ,
    onek: $("#iz-onek").value.trim() || "s",
    // Satırları OLDUĞU GİBİ gönderiyoruz; ayrıştırma sunucuda, tek
    // yerde. Panelde ikinci bir ayrıştırıcı olsaydı ikisi ayrışabilirdi.
    noktalar: ($("#iz-liste").value || "")
      .split("\n").map((s2) => s2.trim()).filter(Boolean),
  };
}

/** Tür listesi + "tür seçilmedi" uyarısı. */
function izgaraTurYaz() {
  // Tepsinin tür listesi de aynı katalogdan ve aynı anda doluyor.
  const tsec = $("#tepsi-tur");
  if (tsec) {
    const o = tsec.value;
    tsec.innerHTML = tohumSecenekleri(o);
  }
  const sec = $("#iz-tur");
  if (!sec) return;
  const onceki = sec.value;
  sec.innerHTML = tohumSecenekleri(onceki);
  const uyari = $("#iz-tur-uyari");
  if (uyari) {
    // Sebebi ekimden ÖNCE söylüyoruz: kullanıcı 12 nokta üretip sonra
    // "neden ekilmediler" diye aramasın.
    uyari.textContent = sec.value
      ? "" : "Tür seçilmedi — bu noktalar BİTKİ olmayacak ve ekimde "
             + "atlanacaklar (ekimi durdurmazlar). Türü sonradan da "
             + "verebilirsiniz.";
    uyari.classList.toggle("gizli", !!sec.value);
  }
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
    const tur = ($("#iz-tur") || {}).value || "";
    gunluk(`✓ ${o.eklendi} yeni, ${o.guncellendi} güncellendi (toplam ${o.toplam})`
      + (tur ? ` · tür yazıldı`
             : " · TÜRSÜZ — bunlar bitki değil, ekimde atlanırlar"),
      tur ? "ok" : "uyari");
    $("#izgara-onizleme").classList.add("gizli");
    $("#d-izgara-uygula").classList.add("gizli");
    await noktalariYukle();
  } catch (hata) {
    gunluk(`✕ Izgara uygulanamadı: ${hata.message}`, "hata");
  }
}

/* ------------------------------------------ türsüz nokta temizliği
 *
 * NEDEN VARLAR. Bitkiler ve çıplak noktalar aynı depoda; ayıran tek şey
 * `tur` alanı. Bu üreteç türü ancak sonradan yazmaya başladı — ondan önce
 * üretilmiş ızgaralar türsüz kaldı ve aynı koordinatlara bitki eklenince
 * her bitkinin ALTINDA türsüz bir nokta oluştu. Ekranda bitki onları
 * örtüyor; kutu seçimi ikisini birden alıyor ve "6 bitki seçtim ama 12
 * seçili yazıyor" oradan geliyor.
 *
 * SİLMEK GÜVENLİ AMA KÖR DEĞİL. Yalnız bir bitkinin yarıçapı içinde
 * duranlar siliniyor; tek başına duran nokta bir referans/kalibrasyon
 * noktası olabilir ve ona dokunmuyoruz. Silme `/api/toplu` üzerinden
 * geçiyor, yani 30 saniye geri alınabiliyor.
 */
const TURSUZ = { son: null };

function tursuzYaz(y) {
  TURSUZ.son = y;
  const kutu = $("#tursuz-sonuc");
  const sec = $("#d-tursuz-sec");
  const sil = $("#d-tursuz-sil");
  if (!kutu) return;
  kutu.classList.remove("gizli");
  const ust = (y.ustuste || []).length;
  const yalniz = (y.yalniz || []).length;
  if (!y.toplam) {
    kutu.innerHTML = `<div class="alt-not">Türsüz nokta yok — kayıtlı
      ${y.bitki_sayisi} noktanın hepsinde tür yazılı.</div>`;
    if (sec) sec.classList.add("gizli");
    if (sil) sil.classList.add("gizli");
    return;
  }
  const ornek = (y.noktalar || []).filter((n) => n.bitki).slice(0, 6)
    .map((n) => `${kacisli(n.ad)} → ${kacisli(n.bitki)} (${n.uzaklik_mm} mm)`)
    .join("<br>");
  kutu.innerHTML = `<div class="alt-not">
    <b>${y.toplam}</b> türsüz nokta ·
    <b>${ust}</b> tanesi bir bitkinin altında (${y.yaricap_mm} mm içinde) ·
    <b>${yalniz}</b> tanesi tek başına.
    ${ust ? `<br><br>Bitkinin altında duranlar — silinecek olanlar:<br>${ornek}`
          + (ust > 6 ? `<br>… ve ${ust - 6} tane daha` : "") : ""}
    ${yalniz ? `<br><br>Tek başına duran ${yalniz} noktaya <b>dokunulmuyor</b>:
      referans ya da kalibrasyon noktası olabilirler.` : ""}
    </div>`;
  if (sec) sec.classList.toggle("gizli", !ust);
  if (sil) sil.classList.toggle("gizli", !ust);
}

async function tursuzTara() {
  try {
    tursuzYaz(await apiIste("/api/noktalar/tursuz"));
  } catch (h) {
    gunluk(`✕ Türsüz noktalar taranamadı: ${h.message}`, "hata");
  }
}

/** Bitki altındakileri haritada SEÇER — silmeden önce gözle görmek için. */
function tursuzSec() {
  const y = TURSUZ.son;
  if (!y || !(y.ustuste || []).length) return;
  if (!window.Tarla || !Tarla.secimeYaz) {
    gunluk("Harita hazır değil — Tarla sayfasını bir kez açın", "uyari");
    return;
  }
  // Süzgeç açıkken seçim boş kalırdı: bu noktaların hepsi türsüz.
  if (Tarla.yalnizBitki && Tarla.yalnizBitki()) Tarla.yalnizBitki(false);
  Tarla.secimeYaz(y.ustuste, false);
  gunluk(`${y.ustuste.length} türsüz nokta haritada seçildi — `
         + "Tarla sayfasında görebilir, çubuktan silebilirsiniz", "iyi");
}

async function tursuzSil() {
  const y = TURSUZ.son;
  if (!y || !(y.ustuste || []).length) return;
  try {
    const s = await apiIste("/api/toplu", {
      method: "POST",
      body: JSON.stringify({ islem: "sil", noktalar: y.ustuste }),
    });
    gunluk(`✓ ${(s.silinen || []).length} türsüz nokta silindi — `
           + "30 saniye geri alınabilir", "ok");
    geriAlGoster(s.geri_al);      // silme geri alınabilir olmalı
    await noktalariYukle();
    await tursuzTara();
  } catch (h) {
    gunluk(`✕ Silinemedi: ${h.message}`, "hata");
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
  kutu.innerHTML = alanlar.map((a, i) => {
    const t = a.tepsi || {};
    return `
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

      <!-- ZEMİN TİPİ. Kap 1 düz toprak, Kap 2 gözlü tepsi olabiliyor ve
           bu alanın kendi özelliği: üçüncü bir kap eklenince onun tipi de
           buradan seçiliyor, ayrı bir kavram öğrenmeye gerek yok. -->
      <div class="satir-8 alt-hizali">
        <div class="alan esnek-alan">
          <label>Zemin</label>
          <select class="da-tip">
            <option value="duz"${a.tip === "tepsi" ? "" : " selected"}>Düz toprak</option>
            <option value="tepsi"${a.tip === "tepsi" ? " selected" : ""}>Gözlü fidelik tepsisi</option>
          </select>
        </div>
      </div>
      <div class="da-tepsi ${a.tip === "tepsi" ? "" : "gizli"}">
        <p class="alt-not">Gözler TEK TEK girilmiyor: ilk gözün merkezi,
          gözler arası mesafe ve satır × sütun yeter, kalanı hesaplanır.
          Numaralar geometrik ve <b>kalıcı</b> — bir gözü boşaltmak
          ötekilerin numarasını kaydırmaz.</p>
        <div class="alan-izgara">
          <div class="alan"><label>1. göz X</label><input type="number" class="dt-x0" step="0.1" value="${t.x0 != null ? t.x0 : ""}"></div>
          <div class="alan"><label>1. göz Y</label><input type="number" class="dt-y0" step="0.1" value="${t.y0 != null ? t.y0 : ""}"></div>
          <div class="alan"><label>X aralığı</label><input type="number" class="dt-dx" step="0.1" value="${t.dx != null ? t.dx : ""}"></div>
          <div class="alan"><label>Y aralığı</label><input type="number" class="dt-dy" step="0.1" value="${t.dy != null ? t.dy : ""}"></div>
          <div class="alan"><label>Satır</label><input type="number" class="dt-satir" min="1" value="${t.satir || 4}"></div>
          <div class="alan"><label>Sütun</label><input type="number" class="dt-sutun" min="1" value="${t.sutun || 8}"></div>
          <div class="alan"><label>Önek</label><input type="text" class="dt-onek" maxlength="8" value="${kacisli(t.onek || "p")}"></div>
        </div>
        <div class="alt-not">${(t.satir || 0) * (t.sutun || 0)} göz ·
          ${kacisli(t.onek || "p")}1–${kacisli(t.onek || "p")}${(t.satir || 0) * (t.sutun || 0)}
          ${(t.kayma_x || t.kayma_y)
            ? `· kayma X${(t.kayma_x || 0).toFixed(1)} Y${(t.kayma_y || 0).toFixed(1)} mm`
            : "· kayma yok"}<br>
          <b>Toprak Z</b> burada gözün yüzeyi: ekim derinliği ondan ölçülüyor.</div>
      </div>
    </div>`;
  }).join("");

  // Zemin tipi değişince tepsi alanları görünüp kayboluyor. Yeniden
  // çizmiyoruz: kullanıcının yazdığı ama kaydetmediği sayılar silinirdi.
  $$("#dikim-liste .da-tip").forEach((sec) => {
    sec.onchange = () => {
      const kutu = sec.closest(".bolge").querySelector(".da-tepsi");
      if (kutu) kutu.classList.toggle("gizli", sec.value !== "tepsi");
    };
  });

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
    a.tip = el.querySelector(".da-tip").value;
    if (a.tip === "tepsi") {
      const say = (sinif) => Number(el.querySelector(sinif).value);
      // KAYMA FORMDA YOK ve olmamalı: tek tek yazılan bir kayma, "bir göz
      // ölç, tepsi hizalansın" fikrini bozar. Kaydedilen değeri koruyoruz.
      const eski = (S.dikim || []).find((d) => d.ad === a.ad) || {};
      const ek = eski.tepsi || {};
      a.tepsi = {
        x0: say(".dt-x0"), y0: say(".dt-y0"),
        dx: say(".dt-dx"), dy: say(".dt-dy"),
        satir: say(".dt-satir"), sutun: say(".dt-sutun"),
        onek: el.querySelector(".dt-onek").value.trim() || "p",
        kayma_x: ek.kayma_x || 0, kayma_y: ek.kayma_y || 0,
      };
    }
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
  S.ucDurum = u;

  /* ÖLÇÜM MÜ, İNANÇ MI — bu ayrımı yazmak zorundayız.
   *
   * Kilit servosu (`lock_reg`) ve varlık sensörü (`presence_reg`) bağlı
   * değilken "Takılı uç: tool2" bir ÖLÇÜM DEĞİL; yazılımın kendisine en
   * son söylenen şeyi hatırlaması. Bir kez gerçekle ayrıştığında
   * kendiliğinden düzelmiyor: kullanıcı tool3 istiyor, yazılım "önce
   * tool2'yi bırakayım" diyor ve makine elde olmayan bir ucun yuvasına
   * iniyor. Sahada tam bu yaşandı ve makine bozuk sanıldı. */
  const olcum = $("#uc-olcum-uyari");
  if (olcum) {
    const dogrulanabilir = u.dogrulanabilir !== false;
    olcum.innerHTML = dogrulanabilir ? "" :
      "⚠ Bu bir ölçüm değil, yazılımın <b>hatırladığı</b> şey — kilit "
      + "servosu ve varlık sensörü bağlı değil. Uç takıp bırakırken "
      + "doğruluğunu size soruyoruz; sensörler bağlanana kadar bunu "
      + "doğrulayabilecek tek şey sizin gözünüz.";
    olcum.classList.toggle("gizli", dogrulanabilir);
  }

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

  // Tohumluk gözleri — aynı kural: kullanıcı düzenlerken üzerine yazma.
  // Burada fazladan bir sebep var: ekim dizisi süregelirken gözler
  // ajanda boş işaretleniyor ve tablo yenilenmezse kullanıcı dolu
  // görmeye devam ederdi.
  const gozler = u.tohumluk_gozleri || [];
  // İmzaya TÜR SAYISI da giriyor: türler durum paketlerinden sonra
  // yükleniyor ve yalnız gözlere baksaydık tohum listesi ilk çizimdeki
  // boş hâliyle kalırdı.
  const turAdet = Object.keys(
    (window.Tarla && Tarla.turler && Tarla.turler()) || {}).length;
  const gozImza = JSON.stringify(gozler) + "|" + turAdet;
  if (!S.gozDuzenleniyor && gozImza !== S.sonGozler) {
    S.sonGozler = gozImza;
    gozTablosuCiz(gozler);
    // Ekim noktaları formundaki tür listesi de aynı katalogdan doluyor
    // ve aynı sebeple gecikiyor: türler durum paketlerinden sonra
    // yükleniyor, ilk çizimde liste boş kalırdı.
    izgaraTurYaz();
  }

  // Ayar alanları: kullanıcı düzenlerken üzerine yazmıyoruz.
  if (u.ayar && !S.ucAyarDuzenleniyor) {
    for (const [ad, deger] of Object.entries(u.ayar)) {
      // Nesne değerler (retreat {x,y}, release {dx,dy}) kendi alanlarına
      // aşağıda dağıtılıyor. Genel döngüye bırakılsalardı kutuda
      // "[object Object]" yazardı ve kaydedince ayarı bozardı.
      if (deger !== null && typeof deger === "object") continue;
      const el = $("#ua-" + ad);
      if (el && document.activeElement !== el) el.value = deger === null ? "" : deger;
    }
    /* retreat iki biçimli: sayı = yalnız kayma ekseni, {x,y} = iki eksenli.
     * Panelde iki kutu var — "retreat" kayma ekseni, "çıkış (2. eksen)"
     * diğeri — ve ikisi tek alana geri yazılıyor. */
    const kaymaX = String(u.ayar.slide_axis || "Y").toUpperCase() === "X";
    const geri = u.ayar.retreat;
    let kaymaDeger = "", caprazDeger = "";
    if (geri !== null && typeof geri === "object") {
      kaymaDeger = kaymaX ? geri.x : geri.y;
      caprazDeger = kaymaX ? geri.y : geri.x;
      if (!caprazDeger) caprazDeger = "";
    } else if (geri !== null && geri !== "" && geri !== undefined) {
      kaymaDeger = geri;
    }
    [["#ua-retreat", kaymaDeger], ["#ua-retreat-capraz", caprazDeger]].forEach(([sec, v]) => {
      const el = $(sec);
      if (el && document.activeElement !== el) el.value = v === "" || v == null ? "" : v;
    });
    const rel = u.ayar.release || {};
    [["dx", "#ua-rel-dx"], ["dy", "#ua-rel-dy"]].forEach(([alan, sec]) => {
      const el = $(sec);
      if (el && document.activeElement !== el) el.value = rel[alan] || "";
    });
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
    const sb = u.sulama_basligi || {};
    [["dx", "dx"], ["dy", "dy"], ["zmin", "z_min"]].forEach(([kimlik, alan]) => {
      const el = $("#ua-sb-" + kimlik);
      if (el && document.activeElement !== el) {
        el.value = sb[alan] == null ? "" : sb[alan];
      }
    });
    sulamaOfsetOrnek();
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

/* ------------------------------------------- uç durumu teyidi
 *
 * KÖK SEBEP. `current_tool` bir ölçüm değil, bir inanç: `lock_reg = 0`
 * iken servo komutu sessiz geçiyor, `presence_reg = 0` iken uç orada mı
 * bilinmiyor. Yazılım gerçekten hangi ucun takılı olduğunu HİÇBİR ZAMAN
 * ölçemiyor, yalnız kendisine en son söyleneni hatırlıyor. Bir kez
 * gerçekle ayrıştı mı kendiliğinden düzelmiyor ve "Durumu temizle"ye
 * basılana kadar yanlış davranıyor: tool3 istenirken tool2'nin yuvasına
 * inmek gibi.
 *
 * Yazılım doğrulayamadığını BİLİYOR. O hâlde söylemesi de gerekiyor —
 * hareketten önce sorup cevabı kullanıcıdan alıyoruz. Sensörler
 * bağlanana kadar bu bilgiyi doğrulayabilecek tek kaynak o.
 *
 * Kilit ya da varlık sensörü bağlıysa (`dogrulanabilir`) soru hiç
 * sorulmuyor: ölçebilen bir sisteme "emin misin" diye sormak gereksiz
 * sürtünme.
 */
/* "Uçlar sabit takılı" AÇIKKEN elle tak/bırak — MAKİNE HAREKET ETMEDEN
 * ÖNCE UYARI.
 *
 * Ayar makinede uçların hiç sökülmediğini söylüyor; o hâlde bir uç
 * yuvasına inmek beklenmedik bir harekettir ve yanlışlıkla basılmış
 * olabilir. Engellemiyoruz — kullanıcı gerçekten uç değiştirmek
 * isteyebilir ve bu düğmeler bunun için duruyor — ama sessizce de
 * yapmıyoruz. `confirm` bilerek: bu, geri alınamayan fiziksel bir
 * hareketten önceki son duraktır. */
function ucSabitUyar(islem, hedef) {
  if (!(S.ekimAyar || {}).uclar_sabit) return true;
  const ne = islem === "birak"
    ? "takılı sayılan ucu yuvasına BIRAKMAYA"
    : `'${hedef}' ucunu ALMAYA`;
  const tamam = confirm(
    "\"Uçlar sabit takılı\" ayarı AÇIK.\n\n"
    + `Devam ederseniz makine ${ne} gidecek, yani bir uç yuvasının `
    + "üstüne gidip inecek.\n\n"
    + "Bu makinede uçlar kalıcı takılı olduğu için bu hareket normalde "
    + "hiç yapılmıyor. Gerçekten uç değiştiriyorsanız Ayarlar → Ekim'den "
    + "anahtarı kapatın.\n\nYine de devam edilsin mi?");
  if (!tamam) {
    gunluk("Uç hareketi iptal edildi — 'uçlar sabit takılı' ayarı açık",
           "uyari");
  }
  return tamam;
}

function ucTeyitAc(islem, hedef) {
  const u = S.ucDurum || {};
  if (!ucSabitUyar(islem, hedef)) return;
  // Ölçebiliyorsak sormuyoruz — doğrudan hareket.
  if (u.dogrulanabilir !== false) { ucIslemGonder(islem, hedef); return; }

  S.ucTeyit = { islem, hedef };
  const kutu = $("#uc-teyit");
  const takili = u.uc || "";
  $("#uc-teyit-soru").innerHTML = takili
    ? `Yazılım kafada <b>${kacisli(takili)}</b> olduğunu sanıyor. Doğru mu?`
    : "Yazılım kafanın <b>boş</b> olduğunu sanıyor. Doğru mu?";

  // Düzeltme listesi: bilinen uçlar + "boş".
  const sec = $("#uc-teyit-secim");
  sec.innerHTML = `<option value="">— kafa boş —</option>`
    + (S.ucListesi || []).map((a) =>
        `<option value="${kacisli(a)}"${a === takili ? " selected" : ""}>${kacisli(a)}</option>`).join("");
  sec.value = takili;
  // Liste değişince plan da değişiyor: "kafada tool2 var" ile "kafada
  // tool3 var" farklı hareketler demek ve kullanıcı Onayla'ya basmadan
  // hangisini okuduğunu bilmeli.
  sec.onchange = ucTeyitGerekceYaz;
  ucTeyitGerekceYaz();

  kutu.classList.remove("gizli");
}

/** NE OLACAĞINI ÖNCEDEN SÖYLE — listede SEÇİLİ olana göre.
 *  Kayıtlı inanca göre yazsaydık, kullanıcı listeyi düzelttikten sonra
 *  bile eski (yanlış) planı okurdu. */
function ucTeyitGerekceYaz() {
  const t = S.ucTeyit;
  const kutu = $("#uc-teyit-gerekce");
  if (!t || !kutu) return;
  const secilen = ($("#uc-teyit-secim") || {}).value || "";
  const inanc = (S.ucDurum || {}).uc || "";
  const hedef = t.hedef;
  const kayit = secilen === inanc ? ""
    : `Kayıt <b>${kacisli(inanc || "boş")}</b> → <b>${kacisli(secilen || "boş")}</b>`
      + " olarak düzeltilecek. ";
  let ne;
  if (t.islem === "birak") {
    ne = secilen
      ? `Devam ederseniz makine <b>${kacisli(secilen)}</b> yuvasına gidip ucu bırakacak.`
      : "Kafa boşsa bırakacak bir şey yok; makine hareket etmeyecek.";
  } else if (secilen && secilen !== hedef) {
    ne = `Devam ederseniz makine <b>önce ${kacisli(secilen)} yuvasına gidip onu`
       + ` bırakacak</b>, sonra ${kacisli(hedef)} almaya gidecek.`;
  } else if (secilen === hedef) {
    ne = `${kacisli(hedef)} zaten takılı sayılıyor; makine hareket etmeyecek.`;
  } else {
    ne = `Devam ederseniz makine doğrudan <b>${kacisli(hedef)}</b> almaya gidecek.`;
  }
  kutu.innerHTML = kayit + ne
    + " Kafada gerçekte ne olduğunu yazılım ölçemiyor — kilit servosu ve "
    + "varlık sensörü bağlı değil.";
}

function ucTeyitKapat() {
  S.ucTeyit = null;
  const kutu = $("#uc-teyit");
  if (kutu) kutu.classList.add("gizli");
}

async function ucIslemGonder(islem, hedef) {
  if (islem === "birak") await komutGonder("uc_birak");
  else await komutGonder("uc_degistir", { ad: hedef });
}

/** Onay — LİSTEDE SEÇİLİ olan kayda geçtikten SONRA hareket.
 *
 * Ekim onay kutusundaki hatanın aynısı buradaydı: liste bir düğme, onay
 * başka bir düğmeydi. Kullanıcı listeden doğru ucu seçip "Evet, devam et"e
 * bastığında kayıt değişmiyor, makine eski inançla hareket ediyordu.
 * Şimdi tek iş: seçilen değer önce kayda geçiyor, sonra plan ona göre. */
async function ucTeyitOnayla() {
  const t = S.ucTeyit;
  if (!t) { ucTeyitKapat(); return; }
  const secilen = ($("#uc-teyit-secim") || {}).value || "";
  const inanc = (S.ucDurum || {}).uc || "";
  if (secilen !== inanc) {
    const sonuc = await komutGonder("uc_beyan", { ad: secilen });
    if (!sonuc || !sonuc.ok) {
      // Kayıt düzeltilemediyse HAREKET ETMİYORUZ: yanlış inançla
      // gitmek, bu kutunun engellemek için var olduğu şeyin ta kendisi.
      gunluk("✕ Uç kaydı düzeltilemedi — hareket başlatılmadı", "hata");
      return;
    }
    if (S.ucDurum) S.ucDurum = { ...S.ucDurum, uc: secilen || null };
    gunluk(`Uç kaydı düzeltildi: '${inanc || "boş"}' → '${secilen || "boş"}'`,
           "uyari");
  }
  ucTeyitKapat();
  ucIslemGonder(t.islem, t.hedef);
}

/** Kayıt düzeltme — HAREKET YOK, yalnız yazılımın inancı düzeliyor.
 *  Düzeltmeden sonra soru YENİDEN soruluyor: kullanıcı yeni hâli görüp
 *  onaylasın, "düzelttim" ile "devam et" aynı tuş olmasın. */
async function ucBeyanGonder() {
  const t = S.ucTeyit;
  const ad = ($("#uc-teyit-secim") || {}).value || "";
  const sonuc = await komutGonder("uc_beyan", { ad });
  if (!sonuc || !sonuc.ok) return;
  // Ajanın yeni durumu bir sonraki pakette gelecek; soruyu o gelince
  // yeniden kuruyoruz ki ekranda eski inanç yazılı kalmasın.
  if (S.ucDurum) S.ucDurum = { ...S.ucDurum, uc: ad || null };
  if (t) ucTeyitAc(t.islem, t.hedef);
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

/* ---------------------------------------------------- tohumluk gözleri
 *
 * Gözlerin koordinatı ve dolu/boş durumu `ajan/uclar.json`da. Tablo
 * ikisini de düzenliyor ama İKİ AYRI yoldan yazıyor:
 *
 *   • koordinat/ad/tohum → `uc_kaydet` (toplu, "Gözleri kaydet")
 *   • dolu/boş kutusu    → `goz_isaretle` (tek göz, anında)
 *
 * Ayrım keyfi değil. Ekim dizisi çalışırken gözleri boş işaretliyor;
 * kullanıcı o sırada tabloyu toptan kaydetseydi, ekranındaki eski
 * "dolu" değeri dizinin az önce boşalttığı gözün üstüne yazılırdı.
 * Tek göze dokunan komut bu yarışı ortadan kaldırıyor.
 *
 * TOHUM SÜTUNU AÇILIR LİSTE ve değeri tür SLUG'ı.
 *
 * Serbest metin kutusuydu ve iki şeyi birden bozuyordu. Birincisi yazım
 * hatası: "marul" yerine "marlu" yazan bir gözü hiçbir şey yakalamıyordu.
 * İkincisi ve asıl önemlisi, `ekim.goz_ata` gözdeki tohumu bitkinin tür
 * SLUG'ıyla karşılaştırıyor — kullanıcı ekranda gördüğü Türkçe adı
 * ("Marul") yazdığında eşleşme tutmuyor ve dizi "gözde başka tohum var"
 * diye reddediliyordu. Kullanıcının yazdığı şey doğruyken.
 *
 * Liste tür kataloğundan (`Tarla.turler()`) doluyor: Tarla sayfasında
 * görülen adla burada görülen ad aynı, ve yeni bir tür eklendiğinde bu
 * liste kendiliğinden güncelleniyor. Ekranda `name_tr`, kaydedilen
 * `slug`.
 */

/** Tohum sütununun `<option>` listesi. `secili` bilinmeyen bir değerse
 *  KAYBEDİLMİYOR: ayrıca eklenip işaretleniyor. Eski serbest metinle
 *  yazılmış gözler sessizce boşalmasın — kullanıcı ne yazdığını görüp
 *  düzeltebilsin. */
function tohumSecenekleri(secili) {
  const turler = (window.Tarla && Tarla.turler && Tarla.turler()) || {};
  const liste = Object.values(turler)
    .slice()
    .sort((a, b) => String(a.name_tr).localeCompare(String(b.name_tr), "tr"));
  const s = String(secili || "");
  let cikti = `<option value=""${s ? "" : " selected"}>— belirsiz —</option>`;
  cikti += liste.map((t) =>
    `<option value="${kacisli(t.slug)}"${t.slug === s ? " selected" : ""}>${
      kacisli(t.icon || "🌱")} ${kacisli(t.name_tr)}</option>`).join("");
  if (s && !turler[s]) {
    cikti += `<option value="${kacisli(s)}" selected>⚠ ${kacisli(s)} (bilinmeyen)</option>`;
  }
  return cikti;
}

function gozTablosuCiz(gozler) {
  const kutu = $("#goz-tablo");
  if (!kutu) return;
  const liste = gozler || [];
  if (!liste.length) {
    kutu.innerHTML = '<p class="alt-not">Tanımlı tohum haznesi yok.</p>';
    return;
  }
  /* SATIR BAŞINA İKİ SIRA. Tek sıraya sığdırmayı denedim: yan panel 380
   * piksel ve yedi sütun oraya girmiyor — sayılar "60!" diye kırpılıyor,
   * tür adı ise hiç görünmüyordu (yalnız açılır listenin oku). Kırpılmış
   * bir koordinat, yanlış okunan bir koordinattır.
   *
   * Üstte koordinatlar (başlıkları var), altta tür + dolu + sil. Alt
   * sıranın başlığı yok çünkü kendini anlatıyor: listede türün adı
   * yazılı, kutunun yanında "dolu" etiketi duruyor. */
  kutu.innerHTML = `<div class="goz-baslik">
      <span>Hazne</span><span>X mm</span><span>Y mm</span><span>Z mm</span>
    </div>` + liste.map((g, i) => `
    <div class="goz-satir${g.dolu ? "" : " goz-bos"}" data-i="${i}" data-ad="${kacisli(g.ad || "")}">
      <div class="goz-hucreler">
        <input class="gz-ad" value="${kacisli(g.ad || "")}" maxlength="24">
        <input type="number" class="gz-x" step="0.1" value="${g.x != null ? g.x : ""}">
        <input type="number" class="gz-y" step="0.1" value="${g.y != null ? g.y : ""}">
        <input type="number" class="gz-z" step="0.1"
               title="Gözün dibi — vakum ucu bu Z'ye iniyor"
               value="${g.z != null ? g.z : ""}">
      </div>
      <div class="goz-alt">
        <select class="gz-tohum"
                title="Bu gözde hangi tür var — liste tür kataloğundan geliyor">
          ${tohumSecenekleri(g.tohum)}
        </select>
        <label class="goz-dolu-etiket"
               title="Haznede tohum kaldı mı. Ekim bunu DEĞİŞTİRMİYOR — bir tohum almakla hazne bitmiyor. Yalnız siz 'bitti' dediğinizde kapanıyor.">
          <input type="checkbox" class="gz-dolu" ${g.dolu ? "checked" : ""}> dolu
        </label>
        <button class="ut-sil gz-sil" title="Bu hazneyi sil">✕</button>
      </div>
      <div class="goz-uyari gizli"></div>
    </div>`).join("");

  // ULAŞILABİLİR Mİ — KOORDİNAT GİRİLİRKEN. Bunu ekim başlarken söylemek
  // geç: Y645'e tanımlanmış bir hazne günlerce fark edilmiyor, sonra
  // ekim başlamayınca sebebi aranıyor. Sınırlar ajandan geliyor; ajan
  // yoksa denetim YAPILMIYOR ve bu "sorun yok" demek değil.
  gozSinirDenetle();

  $$("#goz-tablo .gz-sil").forEach((d) => {
    d.onclick = () => {
      const l = gozTablosuTopla();
      l.splice(Number(d.closest(".goz-satir").dataset.i), 1);
      gozTablosuCiz(l);
      S.gozDuzenleniyor = true;
    };
  });
  // Dolu kutusu ANINDA yazıyor: "işaretledim ama kaydetmeyi unuttum"
  // durumunda dizi boş göze inerdi.
  $$("#goz-tablo .gz-dolu").forEach((k) => {
    k.onchange = async () => {
      const satir = k.closest(".goz-satir");
      const ad = satir.dataset.ad;
      const sonuc = await komutGonder("goz_isaretle", { ad, dolu: k.checked });
      if (!sonuc || !sonuc.ok) { k.checked = !k.checked; return; }
      satir.classList.toggle("goz-bos", !k.checked);
      gunluk(`'${ad}' gözü ${k.checked ? "dolu" : "boş"} işaretlendi`, "ok");
    };
  });
  kutu.querySelectorAll("input:not(.gz-dolu), select").forEach((g) => {
    g.oninput = () => { S.gozDuzenleniyor = true; gozSinirDenetle(); };
  });
}

/** Hazne koordinatlarını makine sınırlarına göre denetler — YAZILIRKEN.
 *
 * Aynı denetim sunucuda da var (`ekim.hazne_denetle`) ve ekimi
 * durduruyor. Buradaki kopya onu gereksiz yapmıyor: asıl derdi
 * kullanıcının sınır dışı bir sayıyı yazdığı ANDA görmesi. Kullanıcı
 * bugün Y645'e bir hazne tanımladı ve bunu ancak ekim başlamayınca,
 * günlüğü okuyarak öğrendi.
 *
 * Sınırlar ajandan (`durum.sinirlar`). Ajan yoksa denetim yok ve bunu
 * "sorun yok" diye göstermiyoruz — hiç göstermiyoruz.
 */
function gozSinirDenetle() {
  const sinir = S.sinirlar || {};
  $$("#goz-tablo .goz-satir").forEach((satir) => {
    const kutu = satir.querySelector(".goz-uyari");
    if (!kutu) return;
    const sorun = [];
    [["x", "X"], ["y", "Y"], ["z", "Z"]].forEach(([eksen, ad]) => {
      const girdi = satir.querySelector(".gz-" + eksen);
      const deger = Number(girdi.value);
      const s = sinir[eksen] || {};
      const disarida = girdi.value !== "" && s.min != null && s.max != null
        && (deger < Number(s.min) - 0.5 || deger > Number(s.max) + 0.5);
      girdi.classList.toggle("hatali", !!disarida);
      if (disarida) {
        sorun.push(`${ad}${Math.round(deger)} makine sınırının dışında `
          + `(${Math.round(Number(s.min))}–${Math.round(Number(s.max))})`);
      }
    });
    // Güvenli yükseklik ayrı bir şart: hazneye inebilmek için Z'sinin
    // güvenli Z'nin ALTINDA olması gerekiyor (büyük Z = yukarısı).
    const gz = satir.querySelector(".gz-z");
    if (gz.value !== "" && S.guvenliZ != null && Number(gz.value) >= S.guvenliZ) {
      sorun.push(`Z${Math.round(Number(gz.value))} güvenli yükseklikten `
        + `(${Math.round(S.guvenliZ)}) aşağıda değil — makine hazneye inemez`);
      gz.classList.add("hatali");
    }
    kutu.textContent = sorun.length ? "⚠ " + sorun.join(" · ") : "";
    kutu.classList.toggle("gizli", !sorun.length);
  });
}

function gozTablosuTopla() {
  return $$("#goz-tablo .goz-satir").map((el) => ({
    ad: el.querySelector(".gz-ad").value.trim(),
    x: Number(el.querySelector(".gz-x").value),
    y: Number(el.querySelector(".gz-y").value),
    z: Number(el.querySelector(".gz-z").value),
    tohum: el.querySelector(".gz-tohum").value.trim(),
    dolu: el.querySelector(".gz-dolu").checked,
  })).filter((g) => g.ad);
}

async function gozTablosuKaydet() {
  const gozler = gozTablosuTopla();
  const sonuc = await komutGonder("uc_kaydet", { ayar: { tohumluk: { gozler } } });
  if (sonuc && sonuc.ok) {
    S.gozDuzenleniyor = false;
    S.sonGozler = null;          // bir sonraki durumda ajanın hâli çizilsin
    gunluk(`✓ ${gozler.length} tohum haznesi kaydedildi`, "ok");
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
const KALIB = { kare1: null, kare2: null, bekleyen: 0,
                // Sabit kameranın ölçek yöntemi: aynı karede iki işaret.
                olcek1: null, olcek2: null, olcekBekleyen: 0 };

/* Kalibrasyon bölümünün işlediği kamera — PANELİN SEÇİMİYLE AYNI.
 *
 * Ayrı bir seçim tutmayı denemeye değmez: iki şerit iki farklı kamerayı
 * gösterebilirdi ve kullanıcı, ölçtüğü sayının hangi kameraya yazıldığını
 * ancak dikkatle bakarak anlardı. Yanlış kameraya yazılmış bir mm/px,
 * bulunması en zor hatalardan biri. Tek seçim, tek doğru. */
function kalibSecili() {
  return kamSecili() || "uc";
}

function kalibSekmeleriYaz() {
  const serit = $("#kalib-sekmeler");
  if (!serit) return;
  const hepsi = kamListe();
  serit.classList.toggle("gizli", hepsi.length < 2);
  serit.innerHTML = hepsi.map((k) => `
    <button class="ikon-dugme kam-sekme${k.ad === kalibSecili() ? " secili" : ""}"
      type="button" data-kam="${kacisli(k.ad)}"
      >${kacisli(k.etiket || k.ad)}</button>`).join("");
  serit.querySelectorAll(".kam-sekme").forEach((d) => {
    d.onclick = () => kamSecimDegistir(d.dataset.kam);
  });
  kalibYontemYaz();
}

/** Panelin kamera seçimini değiştirir; kart, kalibrasyon ve görüntü
 *  bölümü hep aynı kameraya bakıyor. */
function kamSecimDegistir(ad) {
  if (!ad || ad === S.kamSecim) return;
  S.kamSecim = ad;
  // Ölçüm yarıda kaldıysa taşımıyoruz: bir kamerada konulmuş işaretler
  // ötekinin karesinde başka bir yeri gösterir.
  kalibSifirla();
  kalibOlcekSifirla();
  kalibSekmeleriYaz();
  kalibrasyonYukle();
  goruntuDurumYukle();
  // Seçilen kameranın son karesi kalibrasyon tuvaline gelsin: bir sonraki
  // kareyi beklemek saatlik aralıkta bir saat demek.
  const son = S.sonKare[ad];
  const im = $("#kalib-kare");
  if (im) {
    if (son) { im.src = son.adres; im.onload = kalibIsaretCiz; }
    else im.removeAttribute("src");
  }
}

/* Hangi kalibrasyon yöntemi görünsün.
 *
 * SABİT KAMERADA İKİ KARE YÖNTEMİ ÇALIŞMAZ: makine oynadığında sabit
 * kameranın gördüğü sahne değişmiyor, iki karedeki piksel farkı sıfır
 * çıkar. Düğmeyi orada bırakmak, basıp anlamsız bir hata almak demek —
 * yöntemi gizleyip yerine çalışanı koyuyoruz. */
function kalibYontemYaz() {
  const ad = kalibSecili();
  const hareketli = kamHareketli(ad);
  const bas = $("#kalib-yontem-bas");
  const ikiKare = $("#kalib-ikikare-araclar");
  const olcek = $("#kalib-olcek-araclar");
  const not = $("#kalib-kamera-not");
  const yonerge = $("#kalib-yonerge");
  if (ikiKare) ikiKare.classList.toggle("gizli", !hareketli);
  if (olcek) olcek.classList.toggle("gizli", hareketli);
  if (bas) bas.textContent = hareketli ? "İki kare ile hesapla" : "Ölçek ile hesapla";
  if (not) {
    not.textContent = hareketli
      ? `${kamEtiket(ad)} uçla birlikte hareket ediyor: kareleri konumlu, `
        + "iki kare yöntemi hem ölçeği hem açıyı veriyor."
      : `${kamEtiket(ad)} sabit: makine oynadığında gördüğü sahne değişmiyor, `
        + "iki kare yöntemi burada hiçbir şey ölçemez. Karede uzunluğu bilinen "
        + "bir şeyin iki ucunu işaretleyip gerçek mesafesini yazın — yalnız "
        + "ölçek çıkar, açı ve konum çıkmaz.";
  }
  if (yonerge && !hareketli) {
    yonerge.textContent = "Karede uzunluğu bildiğiniz bir şeyin (cetvel, "
      + "yatak kenarı, iki tepsi gözü arası) iki ucunu işaretleyin, gerçek "
      + "mesafesini yazın ve Hesapla'ya basın.";
  }
  // Açı ve kayma alanları sabit kamerada anlamsız: o karenin makine
  // koordinatı yok, haritaya oturtulmuyor.
  [["#kalib-donme", hareketli], ["#kalib-ofx", hareketli],
   ["#kalib-ofy", hareketli]].forEach(([sec, acik]) => {
    const el = $(sec);
    if (!el) return;
    el.disabled = !acik;
    el.title = acik ? ""
      : "Sabit kamerada açı ve kayma anlamsız: karenin makine koordinatı yok.";
  });
}

function kalibDurumYaz(k) {
  const rozet = $("#kalib-durum");
  if (!rozet) return;
  const etiket = kamListe().length > 1 ? `${kamEtiket(kalibSecili())}: ` : "";
  rozet.textContent = etiket + (k && Number(k.mm_px) > 0
    ? (kamHareketli(kalibSecili())
      ? `${Number(k.mm_px).toFixed(3)} mm/px · ${Number(k.donme).toFixed(1)}°`
      : `${Number(k.mm_px).toFixed(3)} mm/px`)
    : "kalibre edilmedi");
}

/* ------------------------------------------------ görüntü çözümleme
 *
 * `goruntu.py` (piksel) + `tespit.py` (milimetre) sunucuda çalışıyor;
 * burası yalnız sonucu gösteriyor. Hesabın panelde İKİNCİ bir kopyası
 * YOK — olsaydı ekranda okunan ölçü ile haritaya çizilen ölçü sessizce
 * ayrışabilirdi.
 *
 * Harita katmanı (`katmanlar/65-tespitler.js`) veriyi `Tarla._tespitVeri`
 * üzerinden alıyor. Ortak veri havuzuna koymuyoruz: çözümleme kullanıcı
 * istediğinde çalışan bir işlem, her durum paketinde değil.
 */
function goruntuDurumYaz(d) {
  const not = $("#goruntu-durum");
  const uyari = $("#goruntu-uyari");
  if (!not || !uyari) return;
  S.goruntuDurum = d;

  if (!d.hazir) {
    not.textContent = "kapalı";
    uyari.textContent = d.hata || "Görüntü işleme kullanılamıyor.";
    uyari.classList.remove("gizli");
    return;
  }
  // Etiket ÖNEMLİ: iki kameranın kalibrasyonu ayrı ve "kalibre edilmedi"
  // hangisi için söylendiği yazmazsa yanlış kamerayı ölçmeye götürür.
  const etiket = kamListe().length > 1 ? `${d.kamera_etiket || d.kamera}: ` : "";
  not.textContent = etiket + (d.kalibre
    ? (d.hareketli
      ? `${d.konumlu_kare}/${d.kare_sayisi} konumlu kare · ${Number(d.mm_px).toFixed(3)} mm/px`
      : `${d.kare_sayisi} kare · ${Number(d.mm_px).toFixed(3)} mm/px · sabit`)
    : `${d.kare_sayisi} kare · kalibre edilmedi`);

  if (!d.kalibre) {
    uyari.textContent = `${d.kamera_etiket || d.kamera} kalibre edilmemiş `
      + "(mm_px = 0). Lekeler bulunuyor ama milimetreye çevrilemiyor — "
      + "ölçüler piksel olarak yazılıyor. "
      + (d.hareketli
        ? "Kalibrasyon bölümünden iki kare yöntemiyle ölçün."
        : "Bu kamera sabit; kalibrasyon bölümündeki ölçek yöntemiyle ölçün.");
    uyari.classList.remove("gizli");
  } else if (!d.hareketli) {
    // Bu bir eksiklik değil, kameranın doğası: söyleyip geçiyoruz ki
    // "konumlu kare yok" diye aranmasın.
    uyari.textContent = `${d.kamera_etiket || d.kamera} sabit bir kamera: `
      + "makineyle hareket etmediği için karelerinin makine konumu yok. "
      + "Ölçüler (çap, alan) veriliyor, yatak koordinatı ve kayıtlı "
      + "bitkilerle eşleştirme verilmiyor.";
    uyari.classList.remove("gizli");
  } else if (!d.konumlu_kare) {
    uyari.textContent = "Hiçbir karenin makine konumu yok. Konum kareye "
      + "çekildiği anda ekleniyor; PLC kopukken çekilen kareler haritaya "
      + "konamıyor.";
    uyari.classList.remove("gizli");
  } else {
    uyari.classList.add("gizli");
  }

  // Kare listesi: en yeni başta. Kullanıcı seçimini koruyoruz.
  const sec = $("#gr-kare");
  if (sec) {
    const onceki = sec.value;
    sec.innerHTML = (d.kareler || []).map((k) => {
      const saat = new Date(k.ts * 1000).toLocaleTimeString("tr-TR");
      const yer = k.x == null ? "konumsuz" : `X${Math.round(k.x)} Y${Math.round(k.y)}`;
      return `<option value="${kacisli(k.damga)}">${saat} · ${yer}</option>`;
    }).join("");
    if (onceki && [...sec.options].some((o) => o.value === onceki)) sec.value = onceki;
  }
}

async function goruntuDurumYukle() {
  // Kareler ve kalibrasyon kamera başına: bölüm SEÇİLİ kamerayı gösteriyor
  // (Kamera kartındaki seçim ile aynı). Karışık bir kare listesi, hangi
  // kalibrasyonun geçerli olduğunu belirsiz bırakırdı.
  try {
    goruntuDurumYaz(await apiIste("/api/goruntu/durum?kamera="
                                  + encodeURIComponent(kamSecili())));
  } catch (h) { /* bölüm açılmamışsa sorun değil */ }
}

/** Kareyi ve maskesini üst üste gösterir. */
function goruntuOnizle(damga, esik, kamera) {
  const kutu = $("#gr-onizleme");
  if (!kutu) return;
  const jeton = encodeURIComponent(S.jeton || "");
  const kam = encodeURIComponent(kamera || kamSecili());
  $("#gr-kare-im").src =
    `/api/kare/${encodeURIComponent(damga)}?kamera=${kam}&jeton=${jeton}`;
  const m = $("#gr-maske-im");
  m.src = `/api/goruntu/maske?damga=${encodeURIComponent(damga)}&kamera=${kam}`
    + `&esik=${esik == null ? -9 : esik}&jeton=${jeton}&t=${Date.now()}`;
  m.classList.toggle("gizli", !$("#gr-maske").checked);
  kutu.classList.remove("gizli");
}

function goruntuSonucYaz(y) {
  const ozet = $("#gr-ozet");
  const liste = $("#gr-liste");
  if (!ozet || !liste) return;

  const parca = [
    `eşik ${Number(y.esik).toFixed(2)}`,
    `%${(100 * y.oran).toFixed(1)} yeşil`,
    `${y.ham_leke} ham leke → ${y.lekeler_px.length} kalan`,
  ];
  // Otsu ayrımı: 0.75 altındaysa otomatik eşik bu sahnede güvenilmez.
  if (y.otsu_ayrim != null) {
    parca.push(`ayrım ${y.otsu_ayrim}${y.otsu_ayrim < 0.75 ? " (sabit eşik doğru)" : ""}`);
  }
  ozet.innerHTML = `<div class="alt-not">${parca.join(" · ")}</div>`
    + (y.ret && y.ret.length
      ? `<div class="rozet-uyari" style="display:block;margin-top:6px">${
        y.ret.map(kacisli).join("<br>")}</div>`
      : `<div class="alt-not" style="margin-top:4px">
          <b>${y.eslesen.length}</b> eşleşen ·
          <b>${y.yabani_aday.length}</b> yabani aday ·
          <b>${y.gorunmeyen.length}</b> bulunamayan</div>`);
  ozet.classList.remove("gizli");

  /* İKİ SATIR. Beş sütun 380 piksellik yan panele sığmıyor; ekran
   * görüntüsünde etiketler soldan kırpılıyordu ve kırpılmış bir ölçü
   * yanlış okunan bir ölçüdür. Üstte kim, altta ne kadar. */
  const satir = (etiket, sinif, ad, l) => `
    <div class="gr-satir ${sinif}">
      <div class="gr-bas">
        <span class="gr-etiket">${etiket}</span>
        <span class="gr-ad">${kacisli(ad || "—")}</span>
      </div>
      <div class="gr-alt">
        <span>X${Math.round(l.x)} Y${Math.round(l.y)}</span>
        <span>⌀${Number(l.cap_mm).toFixed(0)} mm</span>
        <span>${Number(l.alan_mm2).toFixed(0)} mm²</span>
      </div>
    </div>`;

  liste.innerHTML =
    y.eslesen.map((e) => satir("eşleşen", "gr-yesil", e.ad, e.leke)).join("")
    + y.yabani_aday.map((b) => satir("yabani aday", "gr-turuncu", "", b)).join("")
    + y.gorunmeyen.map((b) => `
      <div class="gr-satir gr-kirmizi">
        <div class="gr-bas">
          <span class="gr-etiket">bulunamadı</span>
          <span class="gr-ad">${kacisli(b.ad)}</span>
        </div>
        <div class="gr-alt" title="Ölmüş demek değil — çimlenmemiş ya da kare kaçırmış olabilir">
          <span>X${Math.round(b.x)} Y${Math.round(b.y)}</span>
          <span>leke yok</span>
        </div>
      </div>`).join("");

  // Haritaya ver. `noktalarDegisti(true)` katmanları yeniden çizdiriyor.
  if (window.Tarla) {
    Tarla._tespitVeri = y;
    if (Tarla.noktalarDegisti) Tarla.noktalarDegisti(true);
  }
}

async function goruntuCoz() {
  const damga = ($("#gr-kare") || {}).value || "";
  const esik = $("#gr-esik").value === "" ? null : Number($("#gr-esik").value);
  const enAz = $("#gr-enaz").value === "" ? null : Number($("#gr-enaz").value);
  try {
    const y = await apiIste("/api/goruntu/coz", {
      method: "POST",
      body: JSON.stringify({ damga, esik, en_az_piksel: enAz,
                             kamera: kamSecili() }),
    });
    goruntuOnizle(y.damga, esik, y.kamera);
    goruntuSonucYaz(y);
    gunluk(`✓ ${y.damga}: ${y.lekeler_px.length} leke`
      + (y.hareketli ? `, ${(y.eslesen || []).length} eşleşme`
        : " (sabit kamera — yatak koordinatı yok)"), "ok");
  } catch (h) {
    gunluk(`✕ Çözümleme: ${h.message}`, "hata");
  }
}

/** Seçili kare ile ondan bir öncekinin farkı — aynı noktada çekilmişlerse. */
async function goruntuFark() {
  const sec = $("#gr-kare");
  const i = sec.selectedIndex;
  if (i < 0 || i + 1 >= sec.options.length) {
    gunluk("Karşılaştırılacak daha eski bir kare yok", "uyari");
    return;
  }
  try {
    const y = await apiIste("/api/goruntu/fark", {
      method: "POST",
      body: JSON.stringify({ a: sec.options[i + 1].value, b: sec.options[i].value,
                             kamera: kamSecili() }),
    });
    const yon = (ad, etiket) => {
      const k = y[ad];
      if (!k) return `${etiket}: yok`;
      // Sabit kamerada koordinat YOK — ölçü var. Olmayan bir X/Y yazmak
      // yerine yalnızca ölçüyü yazıyoruz.
      const olcu = `${Number(k.en_mm).toFixed(0)}×${Number(k.boy_mm).toFixed(0)} mm`;
      return k.x == null ? `${etiket}: ${olcu} (konum yok)`
        : `${etiket}: X${Math.round(k.x)} Y${Math.round(k.y)}, ${olcu}`;
    };
    $("#gr-ozet").innerHTML = `<div class="alt-not">
      gürültü σ ${y.sigma} → eşik ${y.esik} · ${y.kayma_mm == null
        ? "sabit kamera — konum kayması ölçülmüyor"
        : `konum kayması ${y.kayma_mm} mm`}<br>
      <b>koyulaşan</b> %${(100 * y.koyulasan_oran).toFixed(1)} — ${yon("koyulasan", "yer")}<br>
      <b>açılan</b> %${(100 * y.acilan_oran).toFixed(1)} — ${yon("acilan", "yer")}
      </div>
      <div class="alt-not" style="margin-top:4px">Koyulaşma ıslanma ya da
      yeni gölge; açılma kuruma ya da yeni açık renkli bir nesne.</div>`;
    $("#gr-ozet").classList.remove("gizli");
    gunluk(`✓ Fark: %${(100 * y.koyulasan_oran).toFixed(1)} koyulaşma`, "ok");
  } catch (h) {
    gunluk(`✕ Fark: ${h.message}`, "hata");
  }
}

async function goruntuCimlenme() {
  const secim = (window.Tarla && Tarla.secimDurumu && Tarla.secimDurumu()) || [];
  if (!secim.length) {
    gunluk("Önce Tarla sayfasından nokta seçin", "uyari");
    return;
  }
  const damga = ($("#gr-kare") || {}).value || "";
  const esik = $("#gr-esik").value === "" ? null : Number($("#gr-esik").value);
  try {
    const y = await apiIste("/api/goruntu/cimlenme", {
      method: "POST",
      body: JSON.stringify({ damga, noktalar: secim, esik,
                             kamera: kamSecili() }),
    });
    const kutu = $("#gr-cimlenme");
    kutu.innerHTML = `<div class="alt-not">eşik ${Number(y.esik).toFixed(2)} ·
      pencere yarıçapı ${y.yaricap_mm} mm</div>`
      + y.noktalar.map((n) => {
        if (n.durum !== "ölçüldü") {
          return `<div class="gr-satir">
            <div class="gr-bas"><span class="gr-ad">${kacisli(n.ad)}</span></div>
            <div class="gr-alt"><span>${kacisli(n.durum)}</span></div></div>`;
        }
        const yuzde = 100 * n.yesil_oran;
        // Sınıf değil, SAYI gösteriyoruz: tek ölçüm "çimlendi" demez.
        return `<div class="gr-satir ${yuzde > 2 ? "gr-yesil" : ""}">
          <div class="gr-bas"><span class="gr-ad">${kacisli(n.ad)}</span>
            <span class="gr-etiket">%${yuzde.toFixed(1)} yeşil</span></div>
          <div class="gr-alt"><span>${n.yesil_px}/${n.pencere_px} px</span>
            <span>${n.tam ? "" : "pencere kırpıldı"}</span></div>
        </div>`;
      }).join("");
    kutu.classList.remove("gizli");
  } catch (h) {
    gunluk(`✕ Çimlenme: ${h.message}`, "hata");
  }
}

async function kalibrasyonYukle() {
  try {
    const y = await apiIste("/api/kamera/kalibrasyon?kamera="
                            + encodeURIComponent(kalibSecili()));
    const k = y.kalibrasyon || {};
    S.kalibrasyonlar = y.kalibrasyonlar || {};
    kamKalibOzetYaz();       // her yarının altındaki mm/px özeti
    S.kalibrasyon = k;
    $("#kalib-mmpx").value = k.mm_px ?? 0;
    $("#kalib-donme").value = k.donme ?? 0;
    $("#kalib-ofx").value = k.ofset_x ?? 0;
    $("#kalib-ofy").value = k.ofset_y ?? 0;
    $("#kalib-ayna-x").checked = !!k.ayna_x;
    $("#kalib-ayna-y").checked = !!k.ayna_y;
    kalibDurumYaz(k);
    kalibYontemYaz();
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
  const hareketli = kamHareketli(kalibSecili());
  const isaretler = hareketli
    ? [[KALIB.kare1, "1", "#3987e5"], [KALIB.kare2, "2", "#d95926"]]
    : [[KALIB.olcek1, "1", "#3987e5"], [KALIB.olcek2, "2", "#d95926"]];
  isaretler.forEach(([k, ad, renk]) => {
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
  // Ölçek yönteminde iki işaret arasındaki DOĞRU çiziliyor: ölçülen şeyin
  // ne olduğu gözle görünsün — yanlış iki uç seçmek en olası hata.
  if (!hareketli && KALIB.olcek1 && KALIB.olcek2) {
    c.strokeStyle = "#d0a13a"; c.lineWidth = 2; c.setLineDash([6, 4]);
    c.beginPath();
    c.moveTo(KALIB.olcek1.u * olcek, KALIB.olcek1.v * olcek);
    c.lineTo(KALIB.olcek2.u * olcek, KALIB.olcek2.v * olcek);
    c.stroke();
    c.setLineDash([]);
  }
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

/** Tıklanan yerin GÖRÜNTÜ pikselindeki karşılığı. */
function kalibPiksel(olay, im) {
  const kutu = im.getBoundingClientRect();
  const olcek = (im.naturalWidth || 1) / (kutu.width || 1);
  return { u: (olay.clientX - kutu.left) * olcek,
           v: (olay.clientY - kutu.top) * olcek };
}

async function kalibTiklandi(olay) {
  // Sabit kamerada tuval ölçek yöntemine ait: aynı karede iki uç.
  if (!kamHareketli(kalibSecili())) { kalibOlcekTiklandi(olay); return; }
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
        kamera: kalibSecili(),
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

/* ÖLÇEK YÖNTEMİ — sabit kameranın tek kalibrasyon yolu.
 *
 * Karede uzunluğu BİLİNEN bir şeyin iki ucu işaretleniyor ve gerçek
 * mesafesi yazılıyor. Çıkan tek sayı mm/px. Açı ve konum çıkmıyor,
 * çünkü sabit kameranın karesinin makine koordinatı yok — ve olmayan
 * bir şeyi uydurmuyoruz. */
function kalibOlcekIsaretle(hangi) {
  const im = $("#kalib-kare");
  if (!im || !im.naturalWidth) { gunluk("Önce bir kamera karesi gelmeli", "uyari"); return; }
  KALIB.olcekBekleyen = hangi;
  $("#kalib-yonerge").textContent =
    `${hangi}. ucu görüntüde işaretleyin — uzunluğunu bildiğiniz şeyin ucu.`;
  $("#kalib-tuval").classList.add("bekliyor");
}

function kalibOlcekTiklandi(olay) {
  if (!KALIB.olcekBekleyen) return;
  const im = $("#kalib-kare");
  const kayit = kalibPiksel(olay, im);
  if (KALIB.olcekBekleyen === 1) KALIB.olcek1 = kayit; else KALIB.olcek2 = kayit;
  KALIB.olcekBekleyen = 0;
  $("#kalib-tuval").classList.remove("bekliyor");
  kalibIsaretCiz();
  if (KALIB.olcek1 && KALIB.olcek2) {
    const px = Math.hypot(KALIB.olcek2.u - KALIB.olcek1.u,
                          KALIB.olcek2.v - KALIB.olcek1.v);
    $("#kalib-yonerge").textContent =
      `İki işaret arası ${px.toFixed(0)} piksel. Gerçek mesafeyi mm olarak `
      + "yazıp Hesapla'ya basın.";
  } else {
    $("#kalib-yonerge").textContent = "Şimdi ikinci ucu işaretleyin.";
  }
}

async function kalibOlcekHesapla() {
  const im = $("#kalib-kare");
  if (!KALIB.olcek1 || !KALIB.olcek2) {
    kalibSonucCiz("Önce iki ucu işaretleyin.", false);
    return;
  }
  const mm = Number(($("#kalib-olcek-mm") || {}).value);
  if (!(mm > 0)) {
    kalibSonucCiz("Gerçek mesafeyi milimetre olarak yazın.", false);
    return;
  }
  try {
    const y = await apiIste("/api/kamera/kalibrasyon/olcek", {
      method: "POST",
      body: JSON.stringify({
        u1: KALIB.olcek1.u, v1: KALIB.olcek1.v,
        u2: KALIB.olcek2.u, v2: KALIB.olcek2.v, mm,
        kamera: kalibSecili(), kaydet: true,
        genislik_px: im.naturalWidth, yukseklik_px: im.naturalHeight,
      }),
    });
    const s = y.sonuc;
    kalibSonucCiz(
      `${s.mm_mesafe.toFixed(0)} mm · ${s.px_mesafe.toFixed(1)} px → `
      + `${s.mm_px.toFixed(4)} mm/px · kaydedildi (yalnız ölçek — `
      + "sabit kamerada açı ve konum yok)", true);
    await kalibrasyonYukle();
  } catch (hata) {
    kalibSonucCiz(hata.message, false);
  }
}

function kalibOlcekSifirla() {
  KALIB.olcek1 = KALIB.olcek2 = null;
  KALIB.olcekBekleyen = 0;
  const tuval = $("#kalib-tuval");
  if (tuval) tuval.classList.remove("bekliyor");
  const sonuc = $("#kalib-sonuc");
  if (sonuc) sonuc.classList.add("gizli");
  kalibIsaretCiz();
  kalibYontemYaz();
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
  const o1 = $("#d-kalib-olcek1");
  if (o1) o1.onclick = () => kalibOlcekIsaretle(1);
  const o2 = $("#d-kalib-olcek2");
  if (o2) o2.onclick = () => kalibOlcekIsaretle(2);
  const oh = $("#d-kalib-olcek-hesapla");
  if (oh) oh.onclick = kalibOlcekHesapla;
  const ot = $("#d-kalib-olcek-temizle");
  if (ot) ot.onclick = kalibOlcekSifirla;
  // Kamera tanımları bölümü.
  // Kamera ayarları artık kendi yarılarında bağlanıyor (`kamYariBagla`);
  // burada bağlanacak tek kopya yok.
  // Görüntü çözümleme. Bölüm ilk açıldığında durumu çekiyoruz: kapalıyken
  // istek atmanın anlamı yok, Pi'de numpy yoksa zaten kullanılamıyor.
  const grBolum = $("#bolum-goruntu");
  if (grBolum) {
    const bas = grBolum.querySelector(".bolum-bas");
    if (bas) bas.addEventListener("click", () => {
      if (!grBolum.classList.contains("kapali")) goruntuDurumYukle();
    });
  }
  const grCoz = $("#d-gr-coz");
  if (grCoz) grCoz.onclick = goruntuCoz;
  const grFark = $("#d-gr-fark");
  if (grFark) grFark.onclick = goruntuFark;
  const grCim = $("#d-gr-cimlenme");
  if (grCim) grCim.onclick = goruntuCimlenme;
  const grMaske = $("#gr-maske");
  if (grMaske) grMaske.onchange = () => {
    const m = $("#gr-maske-im");
    if (m) m.classList.toggle("gizli", !grMaske.checked);
  };
  // Kamera kutusundaki tek tuşluk çözümleme — aynı uç noktalar, ayrı sunum.
  kameraCozumBagla();

  // Ekim onayı ve ayarları.
  ekimOnayBagla();
  const ekimKaydet = $("#d-ekim-ayar-kaydet");
  if (ekimKaydet) ekimKaydet.onclick = ekimAyarKaydet;
  /* "Uçlar sabit takılı" anahtarı çevrilince açıklama ve etkisiz kalan
   * kutular HEMEN güncelleniyor — kaydetmeyi beklemeden. Anahtarın ne
   * yaptığını görmeden kaydetmek, sonucu makineden öğrenmek demekti. */
  const ucSabit = $("#a-ekim-uclar-sabit");
  if (ucSabit) {
    ucSabit.addEventListener("change", () => {
      ekimAyarYaz({ ...(S.ekimAyar || {}), uclar_sabit: ucSabit.checked });
    });
  }
  const ekimBolum = $("#bolum-ekim");
  if (ekimBolum) {
    const bas = ekimBolum.querySelector(".bolum-bas");
    if (bas) bas.addEventListener("click", () => {
      if (!ekimBolum.classList.contains("kapali")) ekimAyarYukle();
    });
  }
  // Bölüm kapalıyken de bir kez okuyoruz: başlıktaki "onaylı/onaysız"
  // notu, bölümü hiç açmayan kullanıcının da göreceği tek işaret.
  ekimAyarYukle();

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
          kamera: kalibSecili(),
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
/* Kamera kayıt defteri — panelin "hangi kameralar var" tek kaynağı.
 *
 * Ajan `durum.kameralar` diye SIRALI bir liste veriyor; sahnedeki yüzen
 * kutular ve Ayarlar'daki sekmeler bu listeden üretiliyor. Kamera sayısı
 * ya da adı değişince (panelden kaydedildiğinde) kutular yeniden
 * kuruluyor — HTML'e iki kutu elle yazmıyoruz, yoksa üçüncü kamera
 * eklemek iki dosyada değişiklik olurdu. */
const kamListe = () => S.kameralar || [];
const kamBilgi = (ad) => kamListe().find((k) => k.ad === ad) || null;
const kamEtiket = (ad) => (kamBilgi(ad) || {}).etiket || ad || "Kamera";
/** Kamera hareketli mi — bilinmiyorsa hareketli varsayıyoruz: uç kamerası
 *  ilk kamera ve tek kameralı kurulumun davranışı değişmemeli. */
const kamHareketli = (ad) => {
  const k = kamBilgi(ad);
  return k ? !!k.hareketli : true;
};
/** Ayarlar kartının işlediği kamera. Seçim kaybolduysa (kamera silindi)
 *  ilkine düşüyor — boş bir seçimle karta bakmak hiçbir şey göstermezdi. */
function kamSecili() {
  const hepsi = kamListe();
  if (!hepsi.length) return "";
  if (S.kamSecim && hepsi.some((k) => k.ad === S.kamSecim)) return S.kamSecim;
  S.kamSecim = hepsi[0].ad;
  return S.kamSecim;
}

/* ================================================= KAMERA SEKMESİ — YARILAR
 *
 * Her kamera bir YARI: görüntüsü, denetimleri ve AYARLARI aynı yerde.
 * Yarılar `#kam-yari-sablon` şablonundan üretiliyor, çünkü kamera sayısı
 * ayardan geliyor; HTML'e iki yarı elle yazsaydık üçüncü kamera eklemek
 * iki dosyada değişiklik olurdu ve içerideki id'ler ikiye katlanırdı.
 * Bu yüzden yarının içinde id değil `data-rol` var.
 *
 * SIRA: solda ÜST kamera, sağda UÇ kamerası. Ajanın listesi "uc, ust"
 * sırasında geldiği için sırayı burada kuruyoruz — istenen yerleşim
 * ajanın iç sırasına bağlı olmamalı.
 */
const KAM_YARI = new Map();      // kamera adı -> yarı öğesi
//: Soldan sağa istenen sıra. Listede olmayan ad atlanıyor, listede olup
//: burada olmayan kamera sona ekleniyor — üçüncü bir kamera eklenirse
//: kaybolmasın.
const KAM_SIRA = ["ust", "uc"];

function kamYariSirasi() {
  const adlar = kamListe().map((k) => k.ad);
  const once = KAM_SIRA.filter((a) => adlar.includes(a));
  return once.concat(adlar.filter((a) => !once.includes(a)));
}

/** Bir yarının içindeki öğe. */
function kamRol(ad, rol) {
  const y = KAM_YARI.get(ad);
  return y ? y.querySelector(`[data-rol="${rol}"]`) : null;
}

function kameraGoruntuTemizle(ad) {
  // Kamera kapaninca ekranda eski kare kalmamali: "kapali" yazip yaninda
  // canliymis gibi duran bir goruntu birakmak yanlis bilgi.
  // YALNIZ O KAMERANIN görüntüsü siliniyor: biri kapanırken ötekinin
  // karesi ekranda kalmalı.
  delete S.sonKare[ad];
  delete S.kamFps[ad];
  const img = kamRol(ad, "kare");
  if (img) { img.removeAttribute("src"); img.classList.add("gizli"); }
  const yok = kamRol(ad, "yok");
  if (yok) { yok.textContent = "Kamera kapalı."; yok.classList.remove("gizli"); }
  const zaman = kamRol(ad, "zaman");
  if (zaman) zaman.textContent = "";
  const fps = kamRol(ad, "fps");
  if (fps) fps.textContent = "";
  const kutu = KAM_KUTU.get(ad);
  if (kutu) kutu.classList.add("gizli");
  // Görüntü gitti, tespit kutuları da gitmeli: boş bir kutuda asılı
  // kalan kutular neyin üstünde olduğu bilinmeyen kutulardır.
  kamOrtuTemizle(ad);
}

/** "Sahnede" düğmesinin hâli — yüzen kutu gizli mi değil mi. */
function kamSahnedeYaz(ad) {
  const d = kamRol(ad, "sahnede");
  if (!d) return;
  const acik = !S.kamKutuKapali[ad];
  d.classList.toggle("secili", acik);
  d.setAttribute("aria-pressed", acik ? "true" : "false");
  d.title = acik
    ? "İzle sahnesindeki yüzen kutuyu gizle"
    : "İzle sahnesinde yüzen kutu olarak göster";
}

/** Ajandan gelen kamera listesi — yarıları ve yüzen kutuları tazeler. */
function kameralarYaz(liste) {
  const yeni = Array.isArray(liste) ? liste : [];
  const imza = yeni.map((k) => `${k.ad}:${k.etiket}:${k.hareketli ? 1 : 0}`).join("|");
  if (imza !== S.kamImza) {
    S.kamImza = imza;
    S.kameralar = yeni;
    kamYarilariKur();
    kamKutulariKur();
    kalibSekmeleriYaz();
  } else {
    S.kameralar = yeni;
  }
  // Her yarı KENDİ kamerasının hâlini yazıyor.
  yeni.forEach((k) => {
    kameraDurumYaz(k);
    const kutu = KAM_KUTU.get(k.ad);
    if (kutu) {
      const zaman = kutu.querySelector('[data-rol="zaman"]');
      if (zaman && !S.sonKare[k.ad]) {
        zaman.textContent = k.acik ? "kare bekleniyor" : "kapalı";
      }
    }
    // Kamera kapandıysa görüntüsü de gitmeli: asılı kalan son kare,
    // kapalı bir kamerayı açık gösterir.
    if (!k.acik) kameraGoruntuTemizle(k.ad);
  });
}

/** Yarıları kurar; var olanları KORUYOR.
 *
 * Durum paketi saniyede iki kez geliyor; yarıyı her seferinde yeniden
 * yaratmak açık bırakılan ayar kutusunu kapatır, yazılan değeri siler ve
 * görüntüyü bir an karartırdı. Yalnız listeden düşenler kaldırılıyor,
 * yeniler ekleniyor. */
function kamYarilariKur() {
  const tahta = $("#kam-tahta");
  const sablon = $("#kam-yari-sablon");
  if (!tahta || !sablon) return;
  const adlar = kamYariSirasi();

  [...KAM_YARI.keys()].forEach((ad) => {
    if (adlar.includes(ad)) return;
    const eski = KAM_YARI.get(ad);
    if (eski && eski.parentNode) eski.parentNode.removeChild(eski);
    KAM_YARI.delete(ad);
  });

  adlar.forEach((ad) => {
    let yari = KAM_YARI.get(ad);
    if (!yari) {
      yari = sablon.content.firstElementChild.cloneNode(true);
      yari.dataset.kam = ad;
      KAM_YARI.set(ad, yari);
      kamYariBagla(yari, ad);
    }
    // Sırayı her seferinde uyguluyoruz: kamera adı değişse de solda üst,
    // sağda uç kalsın.
    tahta.appendChild(yari);
    const bas = yari.querySelector('[data-rol="ad"]');
    if (bas) { bas.textContent = kamEtiket(ad); bas.title = kamEtiket(ad); }
  });
  kamAyarKartlariYaz();
  kamGozcuTazele();
}

/** Bir yarının denetimleri. */
function kamYariBagla(yari, ad) {
  const rol = (r) => yari.querySelector(`[data-rol="${r}"]`);

  const acik = rol("acik");
  if (acik) {
    acik.onchange = () => {
      if (!acik.checked) kameraGoruntuTemizle(ad);   // beklemeden kapansın
      komutGonder("kamera", { kamera: ad, acik: acik.checked });
    };
  }
  const canli = rol("canli");
  if (canli) {
    canli.onclick = () => {
      const suan = canli.classList.contains("secili");
      // Elle kapatmak SAYFA AÇIKKEN de geçerli: kendiliğinden açma
      // yalnız sayfaya girerken çalışıyor, kullanıcının kararını
      // ezmiyor (bkz. `kamCanliIste`).
      S.kamCanliElle[ad] = !suan;
      komutGonder("kamera", { kamera: ad, canli: !suan, fps: KAM_FPS });
    };
  }
  // İzle sahnesindeki yüzen kutu. Kutunun kendi × düğmesi onu gizliyor;
  // geri açmanın tek yeri burası. Eskiden İzle'deki kamera bölümündeydi,
  // o bölüm bu sekmeye taşınınca düğme de buraya geldi — ayarın iki
  // yerde durmaması demek, hiçbir yerde durmaması değil.
  const sahnede = rol("sahnede");
  if (sahnede) {
    sahnede.onclick = () => {
      const kapali = !S.kamKutuKapali[ad];
      S.kamKutuKapali[ad] = kapali;
      const kutu = KAM_KUTU.get(ad);
      if (kutu) {
        kutu.classList.toggle("gizli", kapali);
        if (kapali) kutu.classList.remove("buyuk");
      }
      kamSahnedeYaz(ad);
      gunluk(`${kamEtiket(ad)} sahnede ${kapali ? "gizlendi" : "gösteriliyor"}`);
    };
  }

  const cozD = rol("coz");
  if (cozD) cozD.onclick = () => kameraCozumle(ad);
  const cozKapat = rol("coz-kapat");
  if (cozKapat) {
    cozKapat.onclick = () => {
      kamOrtuTemizle(ad);          // dondurmayı da kaldırıyor
      const son = S.sonKare[ad];   // donarken kaçırılan kare varsa ekrana
      if (son) kareyiTazele(son.ts, son.canli, ad);
      gunluk(`${kamEtiket(ad)} akışa döndü`);
    };
  }
  const maskeD = rol("maske");
  if (maskeD) maskeD.onclick = () => kamMaskeAlSat(ad);
  const esik = rol("esik");
  if (esik) {
    esik.onchange = () => { if (S.kamCozler[ad]) kameraCozumle(ad); };
  }
  yari.querySelectorAll(".kam-aralik").forEach((d) => {
    // Aralık komutu kamerayı da açık tutuyor: kapalıyken aralık seçmek
    // "hiçbir şey olmadı" demek olurdu.
    d.onclick = () => komutGonder("kamera",
      { kamera: ad, acik: true, aralik_sn: Number(d.dataset.saniye) });
  });

  // --- o kameranın AYARLARI ---
  const kaydet = rol("kaydet");
  const hata = rol("hata");
  const hataYaz = (metin) => {
    if (!hata) return;
    hata.textContent = metin || "";
    hata.classList.toggle("gizli", !metin);
  };
  if (kaydet) {
    kaydet.onclick = async () => {
      hataYaz("");
      // BÜTÜN kameralar birlikte kaydediliyor: ajan tanımları liste
      // olarak alıyor ve yalnız birini yollamak ötekini silerdi.
      const sonuc = await komutGonder("kamera_kaydet",
                                      { kameralar: kamAyarTaslak() });
      if (sonuc && sonuc.ok === false) {
        hataYaz(sonuc.mesaj || "Kaydedilemedi");
        return;
      }
      S.kamAyarTaslak = null;   // ajandan geri gelsin
      S.kamImza = "";           // yarılar ve kutular yeniden kurulsun
      gunluk("✓ Kamera tanımları kaydedildi", "ok");
    };
  }
  const geri = rol("geri");
  if (geri) {
    geri.onclick = () => {
      S.kamAyarTaslak = null;
      hataYaz("");
      kamAyarKartlariYaz();
      gunluk("Kamera tanımları geri alındı");
    };
  }
  const tara = rol("cihazlar");
  if (tara) tara.onclick = kamCihazTara;
  const kalibD = rol("kalib");
  if (kalibD) kalibD.onclick = () => kalibYariyaTasi(ad);
}

/** Sistemdeki video cihazlarını listeler — cihaz adı kutusuna öneri. */
async function kamCihazTara() {
  const sonuc = await komutGonder("kamera_cihazlar", {});
  const liste = (sonuc && sonuc.cihazlar) || [];
  const dl = $("#kam-cihaz-listesi");
  if (dl) {
    // Görüntü düğümleri (index 0) önce: UVC kameralar bir de meta veri
    // düğümü açıyor ve o kare vermiyor.
    const adlar = [...new Set(liste.filter((c) => c.index === 0)
                                   .map((c) => c.ad).filter(Boolean))];
    dl.innerHTML = adlar.map((a) => `<option value="${kacisli(a)}"></option>`).join("");
  }
  const not = $("#kam-cihaz-not");
  if (not) {
    not.textContent = liste.length
      ? "Bağlı: " + liste.map((c) => `${c.yol} (${c.ad || "adsız"})`).join(", ")
      : "Sistemde video cihazı görünmüyor.";
  }
}

/** Kalibrasyon bölümünü BU kameranın yarısına taşır.
 *
 * Tek kopya, `appendChild` ile yer değiştiriyor: iki kopya açmak
 * `#kalib-mmpx` gibi id'leri ikiye katlar ve hangisinin geçerli olduğunu
 * bilinmez yapardı. Taşınan öğe bütün olay bağlarını koruyor. */
function kalibYariyaTasi(ad) {
  const bolum = $("#bolum-kamera-kalib");
  const hedef = kamRol(ad, "ayar-kutu");
  if (!bolum || !hedef) return;
  hedef.open = true;
  hedef.appendChild(bolum);
  bolum.classList.remove("kapali");
  const bas = bolum.querySelector(".bolum-bas");
  if (bas) bas.setAttribute("aria-expanded", "true");
  // Kalibrasyon SEÇİLİ kameraya işliyor; taşımak seçimi de değiştiriyor,
  // yoksa kutu bir yarının altında durup başka bir kamerayı ölçerdi.
  kamSecimDegistir(ad);
  kalibrasyonYukle();
  bolum.scrollIntoView({ block: "nearest" });
}

/** Kalibrasyon özeti — her yarının kendi mm/px'i kendi altında. */
function kamKalibOzetYaz() {
  const hepsi = S.kalibrasyonlar || {};
  kamListe().forEach((k) => {
    const el = kamRol(k.ad, "kalib-ozet");
    if (!el) return;
    const mm = Number((hepsi[k.ad] || {}).mm_px || 0);
    el.textContent = mm > 0
      ? `${mm.toFixed(3)} mm/piksel`
      : "kalibre edilmedi — ölçüler piksel";
  });
}

function kameraDurumYaz(k) {
  if (!k || !k.ad) return;
  const ad = k.ad;
  const acikKutu = kamRol(ad, "acik");
  const rozet = kamRol(ad, "rozet");
  if (!acikKutu || !rozet) return;
  const acik = !!k.acik;
  // Kullanici anahtari surukluyorken altindan degistirmeyelim.
  if (document.activeElement !== acikKutu) acikKutu.checked = acik;
  acikKutu.disabled = !S.ajanBagli;

  const sn = k.aralik_sn || 3600;
  const aralik = sn >= 3600 ? `${Math.round(sn / 3600)} saatte`
    : sn >= 60 ? `${Math.round(sn / 60)} dakikada`
    : `${Math.round(sn)} saniyede`;
  const canli = !!k.canli;
  // Donmuş ekranı "canlı" diye göstermek yalan olurdu: görüntü ilerlemiyor.
  const dondu = !!S.kamDondu[ad];
  rozet.textContent = !acik ? "kapalı"
    : dondu ? "donduruldu · çözümleme ekranda"
    : canli ? `canlı · ${k.yontem || "?"}`
    : `açık · ${k.yontem || "?"} · ${aralik} bir kare`;
  rozet.className = "kam-rozet "
    + (!acik ? "kapali" : dondu ? "donuk" : canli ? "canli" : "");
  rozet.title = dondu
    ? "Çözümlenen kare ekranda duruyor; akış arkada sürüyor."
    : (k.cihaz || "");

  kamDugmeler(ad, "coz-kapat").forEach((d) => d.classList.toggle("gizli", !dondu));

  const canliD = kamRol(ad, "canli");
  if (canliD) {
    canliD.classList.toggle("secili", canli);
    // Akış yapamayan bir yolda düğmeyi tıklanabilir bırakmak, basıp hata
    // almak demek; sebebini söyleyip kapatmak daha dürüst.
    canliD.disabled = !k.canli_var;
    canliD.title = k.canli_var
      ? "Canlı akış — bu sayfa açıkken kendiliğinden açılıyor"
      : "Bu kamera yönteminde canlı akış yok (picamera2, rpicam ya da "
        + "ffmpeg gerekiyor)";
  }
  // Canlı akışta aralık düğmelerinin anlamı yok: kareler aralıkla değil
  // akıştan geliyor.
  const yari = KAM_YARI.get(ad);
  if (yari) {
    yari.querySelectorAll(".kam-aralik").forEach((d) => {
      d.classList.toggle("secili",
        !canli && Math.round(sn) === Number(d.dataset.saniye));
    });
  }

  kamSahnedeYaz(ad);

  const yok = kamRol(ad, "yok");
  if (!acik) {
    kameraGoruntuTemizle(ad);
  } else if (k.hata) {
    rozet.textContent = "kare alınamıyor";
    rozet.className = "kam-rozet hata";
    if (yok && !S.sonKare[ad]) {
      // Cihaz bulunamadıysa sebebi BU: "kare alınamıyor" tek başına
      // kullanıcıyı kamerayı sökmeye götürüyordu, oysa yalnızca
      // /dev/video numarası değişmiş olabilir.
      yok.textContent = k.cihaz_not && !k.cihaz
        ? `Kare alınamıyor — ${k.cihaz_not}`
        : "Kare alınamıyor — ayrıntı olay günlüğünde.";
      yok.classList.remove("gizli");
    }
  } else if (yok && !S.sonKare[ad]) {
    yok.textContent = "Kare bekleniyor…";
    yok.classList.remove("gizli");
  }
}

/* CANLI AKIŞ — SAYFA AÇIKKEN, İKİSİ BİRDEN.
 *
 * "İkisini de aynı anda net göreyim" isteğinin karşılığı bu: Kamera
 * sekmesine girince her kamera canlıya alınıyor, çıkınca durduruluyor.
 * Sayfadan çıkınca durdurmak şart — canlı akış panelin en pahalı yolu
 * (Pi'de kare başına JPEG) ve kimse bakmıyorken CPU yakmasının sebebi yok.
 *
 * Kullanıcının ELLE kapattığı kamera geri açılmıyor: kendiliğinden açma
 * bir kolaylık, kararı ele geçirmesi değil. */
const KAM_FPS = 5;

function kamCanliIste(ac) {
  kamListe().forEach((k) => {
    if (!k.canli_var) return;                 // akış yapamıyor
    if (ac && S.kamCanliElle[k.ad] === false) return;   // kullanıcı kapattı
    // AÇARKEN HER ZAMAN GÖNDERİYORUZ. "Zaten canlı" diye atlamak, HIZI da
    // atlamak demekti: bahçe ekranı akışı 1 kare/sn ile açıyor ve bu
    // sekmeye geçince akış 1'de takılı kalıyordu. Komut aynı hızdaysa
    // ajanda hiçbir şey değişmiyor — göndermenin bedeli yok.
    if (ac) {
      komutGonder("kamera", { kamera: k.ad, canli: true, fps: KAM_FPS });
      return;
    }
    if (k.canli) komutGonder("kamera", { kamera: k.ad, canli: false });
  });
}

/** Kamera sekmesine girildi / çıkıldı. */
function kamSekmesi(acik) {
  document.body.classList.toggle("kamera-sekmesi", acik);
  if (acik) {
    S.kamCanliElle = {};        // yeni ziyaret, yeni sayfa
    kamAyarKartlariYaz();
    kamKalibOzetYaz();
  } else {
    // Sekmeden çıkarken donmuş ekran bırakmıyoruz: geri gelindiğinde eski
    // bir kareye bakıp canlı sanmak, bu sekmenin en pahalı yanlışı olurdu.
    Object.keys(S.kamDondu).forEach((a) => kamOrtuTemizle(a));
  }
  kamCanliIste(acik);
  // Yerleşim değişti: çözümleme katmanları görüntünün üstüne yeniden
  // otursun.
  setTimeout(kamKatmanHizala, 60);
}

/* KARE/SN SAYACI. Ölçülebilir olması gerekiyordu: "ikisi de canlı aksın"
 * denetlenebilir bir söz ancak sayıyla oluyor. Son iki saniyedeki kare
 * sayısını sayıyoruz — anlık değil, okunabilir. */
function kamFpsSay(ad) {
  const d = (S.kamFps[ad] = S.kamFps[ad] || { damga: [], yazi: 0 });
  const simdi = performance.now();
  d.damga.push(simdi);
  while (d.damga.length && simdi - d.damga[0] > 2000) d.damga.shift();
  if (simdi - d.yazi < 500) return;            // yazıyı saniyede iki kez
  d.yazi = simdi;
  const el = kamRol(ad, "fps");
  if (el) {
    const kare = d.damga.length;
    el.textContent = kare > 1 ? `${(kare / 2).toFixed(1)} kare/sn` : "";
  }
}

/** Denemeler için: o anki kare/sn (son 2 saniye). */
function kamFpsOku() {
  const cikti = {};
  Object.entries(S.kamFps).forEach(([ad, d]) => {
    const simdi = performance.now();
    const taze = (d.damga || []).filter((t) => simdi - t <= 2000);
    cikti[ad] = taze.length / 2;
  });
  return cikti;
}

function hailoDurumYaz(h) {
  // Bölüm Kamera sekmesine taşındı: aynı kareyi tüketiyor, yeri orası.
  const bolum = $("#bolum-hailo");
  const kutu = $("#hailo-kutu");
  const not = $("#hailo-durum");
  const uyari = $("#hailo-uyari");
  if (!kutu || !not || !uyari) return;
  // Hiç yapılandırılmamışsa bölümü hiç göstermiyoruz: AI HAT'i olmayan
  // kurulumda anlamsız bir satır durmasın.
  if (!h || (!h.aktif && !h.kilitli && !h.son_hata)) {
    if (bolum) bolum.classList.add("gizli");
    return;
  }
  if (bolum) bolum.classList.remove("gizli");
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
function kareyiTazele(ts, canli = false, ad = "") {
  // HANGİ KAMERANIN karesi: sunucu haberinde yazıyor. Adsız haber (eski
  // sunucu) ilk kameranın sayılıyor.
  const kam = ad || (kamListe()[0] || {}).ad || "uc";

  // ÇÖZÜMLEME EKRANDAYKEN KARE DONUYOR.
  //
  // Canlı akış saniyede beş kare atıyor; her kare eski tespitleri siliyor
  // (silmeli de: kutular o görüntüye ait değil). İkisi bir arada demek,
  // Çözümle'ye basınca kutuların 200 ms görünüp kaybolması demek — yani
  // görüntü işlemenin çalışacağı sekmede çözümlemenin hiç okunamaması.
  //
  // Çözüm kutuları canlı karenin üstünde tutmak DEĞİL; o yanlış yeri
  // gösterirdi. Çözüm, çözümlenen kareyi ekranda dondurmak: ne görüntü
  // ilerliyor ne kutular kayıyor. Rozet "donduruldu" yazıyor, Çözümle'ye
  // yeniden basmak en yeni kareyi çözümleyip ekranı oraya taşıyor,
  // Maske'yi kapatmak ya da sekmeden çıkmak çözmeyi bitirip akışa dönüyor.
  if (S.kamDondu[kam]) {
    kamFpsSay(kam);   // akış sürüyor, ekran duruyor; sayaç akışı sayıyor
    return;
  }
  // Canlı kare sunucunun BELLEĞİNDEN geliyor, periyodik kare diskten.
  const uc = canli ? "canli" : "son";
  const adres = `/api/kare/${uc}?kamera=${encodeURIComponent(kam)}`
    + `&jeton=${encodeURIComponent(S.jeton)}&t=${ts || Date.now()}`;
  const zaman = ts || Date.now() / 1000;
  // Son kareyi hatırlıyoruz: yüzen kutu geri açıldığında bir sonraki kareyi
  // beklemesin. Saatlik aralıkta o bekleme bir saat sürerdi.
  S.sonKare[kam] = { adres, canli, ts: zaman };

  // KAMERA SEKMESİNDEKİ YARISI — her kamera kendi yarısında.
  const img = kamRol(kam, "kare");
  if (img) {
    img.src = adres;
    img.classList.remove("gizli");
    const yok = kamRol(kam, "yok");
    if (yok) yok.classList.add("gizli");
    const z = kamRol(kam, "zaman");
    if (z) {
      z.textContent = (canli ? "Canlı · " : "Son kare: ")
        + new Date(zaman * 1000).toLocaleTimeString("tr-TR")
        + (kamHareketli(kam) ? "" : " · sabit kamera, konum yok");
    }
    kamFpsSay(kam);
  }

  // Kalibrasyon karesi de aynı görüntüyü kullanıyor: iki kare yöntemi için
  // makine oynadıkça yeni kare gelmesi gerekiyor. Yalnız KALİBRASYON
  // BÖLÜMÜNDE seçili kameranın karesi konuyor: başka bir kameranın
  // karesinde işaret koymak, o ölçümü yanlış kameraya yazardı.
  if (kam === kalibSecili()) {
    const kalibKare = $("#kalib-kare");
    if (kalibKare) { kalibKare.src = adres; kalibKare.onload = kalibIsaretCiz; }
  }

  // Sahnedeki yüzen kutu — kameranın kendi kutusu. Aynı adres, o yüzden
  // tarayıcı iki <img> için tek istek yapıyor.
  const kutu = KAM_KUTU.get(kam);
  if (kutu && !S.kamKutuKapali[kam]) {
    kutu.querySelector('[data-rol="kare"]').src = adres;
    kutu.classList.remove("gizli");
    (KAM_SINIRLA.get(kam) || (() => {}))();
    const z = kutu.querySelector('[data-rol="zaman"]');
    if (z) {
      z.textContent = (canli ? "canlı " : "")
        + new Date(zaman * 1000).toLocaleTimeString("tr-TR");
    }
  }
  // Yeni kare geldi: eski tespitler artık BU görüntüye ait değil.
  // Üstlerinde bırakmak, bakan kişiye yeni karede bulunmuş gibi görünürdü.
  // Yalnız BU kameranın tespitleri siliniyor.
  kamOrtuTemizle(kam);
  // Bahçe zemini de aynı kareyi kullanıyor. Aynı adres, tek istek:
  // tarayıcı iki <img> için ikinci kez indirmiyor.
  if (window.Bahce) window.Bahce.kareGeldi(kam);
}

/* --------------------------------------------------------- ekim onayı
 *
 * Makine ekim dizisinin ortasında DURUYOR ve kullanıcıya soruyor. İki
 * yerde: gözün üstünde ("uç takılı mı?") ve tohumla kalkınca ("tohum
 * ucta mı?"). İkisi de makinenin bilemediği bir şeyi soruyor — kilit
 * servosu ve tohum sensörü bağlı değil.
 *
 * Karar sunucuda, burada değil: bu kutu yalnız soruyu, makinenin nerede
 * durduğunu ve iptalin ne yapacağını gösteriyor. Onay/iptal uca gidiyor
 * ve bir sonraki parçayı sunucu başlatıyor.
 *
 * İPTALİN İKİ ANLAMI. İkinci onayda "iptal" tek bir şey demiyor:
 * tohum ucta görünüyorsa gözüne geri konabilir, görünmüyorsa yapılacak
 * tek şey pompayı kapatmak ve gözü BOŞ bırakmak. İkisi farklı sonuç
 * doğuruyor (göz dolu mu boş mu) ve tek bir "İptal" düğmesi hangisinin
 * olduğunu söylemezdi.
 */
/** Sulama kaymasının ne yaptığını ÖRNEKLE gösterir.
 *
 * Hesap panelde YAPILMIYOR — bu bir örnek cümlesi, sulamanın kendisi
 * `sulama.py`de ve makine oraya gidiyor. Buradaki iki toplama yalnız
 * işaretin yönünü göstermek için: "dx artı mı eksi mi olmalı" sorusunu
 * bir cümle okuyarak değil, sayıyı yazıp sonucu görerek cevaplamak
 * daha hızlı.
 */
function sulamaOfsetOrnek() {
  const kutu = $("#ua-sb-ornek");
  if (!kutu) return;
  const dx = Number(($("#ua-sb-dx") || {}).value || 0);
  const dy = Number(($("#ua-sb-dy") || {}).value || 0);
  if (!dx && !dy) {
    kutu.innerHTML = "<b>Kayma yok:</b> makine bitkinin tam üstüne gidiyor. "
      + "Başlık ucun yanındaysa su bitkinin yanına düşer.";
    return;
  }
  kutu.innerHTML = `Örnek: <b>X300 Y150</b>'deki bir bitki için makine `
    + `<b>X${Math.round(300 + dx)} Y${Math.round(150 + dy)}</b>'ye gidiyor, `
    + "su X300 Y150'ye düşüyor.";
}

/* --------------------------------------- sulama başlığı hizalama
 *
 * Kaymanın işaretini elle vermek kolayca ters gidiyor ve sonucu ancak
 * toprağa bakınca görünüyor — sahada tam bu oldu. Burada tahmin yok:
 * makine bilinen bir noktayı suluyor, kullanıcı ıslak izin hedeften ne
 * kadar saptığını ÖLÇÜYOR, doğru kaymayı sunucu hesaplıyor.
 *
 * Hesap sunucuda ve tek satır: yeni kayma = mevcut kayma − ölçülen
 * sapma. İşaret hatası mümkün değil, çünkü ölçülen şey doğrudan
 * düzeltilecek şey. Panelde ikinci bir hesap YOK.
 */
async function sulamaHizalaDene() {
  const x = $("#sh-x").value, y = $("#sh-y").value;
  if (x === "" || y === "") { gunluk("Hedef X ve Y gerekiyor", "uyari"); return; }
  try {
    const s = await apiIste("/api/sulama/hizala/dene", {
      method: "POST",
      body: JSON.stringify({ x: Number(x), y: Number(y),
                             saniye: Number($("#sh-sn").value || 2) }),
    });
    // NEREYE GİTTİĞİ YAZILIYOR. Asıl soru buydu: makine kaymayı
    // uyguluyor mu, uyguluyorsa hangi yöne.
    $("#sh-nerede").innerHTML =
      `Hedef <b>X${s.hedef.x} Y${s.hedef.y}</b> · kayma `
      + `X${s.baslik.dx >= 0 ? "+" : ""}${s.baslik.dx} `
      + `Y${s.baslik.dy >= 0 ? "+" : ""}${s.baslik.dy} → makine `
      + `<b>X${s.makine.x} Y${s.makine.y} Z${s.makine.z}</b>`;
    gunluk(`Hizalama suyu döküldü — makine X${s.makine.x} Y${s.makine.y}`, "iyi");
  } catch (h) {
    gunluk(`✕ Hizalama: ${h.message}`, "hata");
  }
}

async function sulamaHizalaUygula() {
  const sx = $("#sh-sx").value, sy = $("#sh-sy").value;
  if (sx === "" || sy === "") { gunluk("Sapma X ve Y gerekiyor", "uyari"); return; }
  try {
    const s = await apiIste("/api/sulama/hizala/uygula", {
      method: "POST",
      body: JSON.stringify({ sapma_x: Number(sx), sapma_y: Number(sy) }),
    });
    $("#sh-sonuc").innerHTML =
      `Kayma <b>X${s.eski.dx} Y${s.eski.dy}</b> → `
      + `<b>X${s.yeni.dx} Y${s.yeni.dy}</b> mm olarak kaydedildi. `
      + "Aynı noktayı yeniden sulayıp doğrulayın.";
    gunluk(`✓ Başlık kayması: X${s.yeni.dx} Y${s.yeni.dy} mm`, "ok");
    // Uç ayarları formundaki kutular da yeni değeri göstersin.
    const dx = $("#ua-sb-dx"), dy = $("#ua-sb-dy");
    if (dx) dx.value = s.yeni.dx;
    if (dy) dy.value = s.yeni.dy;
    sulamaOfsetOrnek();
  } catch (h) {
    gunluk(`✕ Hizalama: ${h.message}`, "hata");
  }
}

/** "bitki 2/5 · m2" — hangi bitkide olduğumuz her hâlde görünsün. */
function ekimIlerleme(e) {
  return `bitki ${e.sira}/${e.toplam}` + (e.tohum ? ` · ${e.tohum}` : "");
}

function ekimOnayYaz(e) {
  const kutu = $("#ekim-onay");
  if (!kutu) return;
  S.ekimOnay = e || null;
  const onay = e && (e.durum === "onay_uc" || e.durum === "onay1"
                     || e.durum === "onay2");
  const aktif = !!(e && e.aktif);

  /* EKİM AÇIKKEN KUTU HEP GÖRÜNÜR — yalnız onay anlarında değil.
   *
   * Kutu önce sadece onay1/onay2'de çıkıyordu. Dizi "çalışıyor"da
   * takılırsa (ya da sekme onay anını kaçırdıysa) kutu gizleniyor ve
   * panelde iptal etmenin HİÇBİR yolu kalmıyordu. Kullanıcı yeni bir ekim
   * denediğinde "onaylı bir ekim zaten sürüyor" reddini alıyor ve
   * çıkamıyordu — sahada tam bu yaşandı.
   *
   * Süren bir işlemi arayüzden durduramamak kabul edilemez. Ekim aktifse
   * kutu duruyor; onay beklenmiyorsa yalnız İptal gösteriliyor, çünkü
   * onaylanacak bir soru yok. */
  if (!aktif) {
    kutu.classList.add("gizli");
    $("#ekim-onay-iptal-secim").classList.add("gizli");
    return;
  }

  if (!onay) {
    const d = $("#ekim-uc-duzelt");
    if (d) d.classList.add("gizli");
    $("#ekim-onay-adim").textContent = "ekim sürüyor";
    $("#ekim-onay-ilerleme").textContent = ekimIlerleme(e);
    // NE YAPTIĞINI YAZ. "Makine ilerliyor" hiçbir şey söylemiyordu;
    // kullanıcı ekrana bakıp makinenin hangi adımda olduğunu görebilmeli.
    $("#ekim-onay-soru").textContent = e.asama
      ? e.asama.charAt(0).toLocaleUpperCase("tr") + e.asama.slice(1) + "…"
      : (e.mesaj || "Makine ilerliyor…");
    $("#ekim-onay-gerekce").textContent =
      "Onay beklenmiyor. Durdurmak isterseniz İptal'e basın.";
    $("#ekim-onay-yer").innerHTML =
      e.pompa_acik ? "<b>Vakum pompası AÇIK.</b>" : "";
    // Onaylanacak bir soru yok; yalnız çıkış yolu gösteriliyor.
    $("#d-ekim-onayla").classList.add("gizli");
    $("#ekim-onay-iptal-secim").classList.add("gizli");
    $("#ekim-onay-dugmeler").classList.remove("gizli");
    kutu.classList.remove("gizli");
    return;
  }
  $("#d-ekim-onayla").classList.remove("gizli");

  $("#ekim-onay-adim").textContent =
    e.durum === "onay_uc" ? "uç durumu"
      : e.durum === "onay1" ? "1. onay · uç" : "2. onay · tohum";
  $("#ekim-onay-ilerleme").textContent = ekimIlerleme(e);
  $("#ekim-onay-soru").textContent = e.soru || "";
  $("#ekim-onay-gerekce").textContent = e.gerekce || "";

  /* UÇ TEYİDİ: kayıt yanlışsa burada düzeltiliyor. Uç değiştirme
   * yazılımın inancına bakıp "önce şunu bırakayım" diyor; inanç
   * yanlışsa makine elde olmayan bir ucun yuvasına iniyor. */
  const duzelt = $("#ekim-uc-duzelt");
  if (duzelt) {
    duzelt.classList.toggle("gizli", !e.uc_teyit);
    if (e.uc_teyit) {
      const sec = $("#ekim-uc-secim");
      const inanc = e.uc_inanc || "";
      sec.innerHTML = `<option value="">— kafa boş —</option>`
        + (S.ucListesi || []).map((a) =>
            `<option value="${kacisli(a)}"${a === inanc ? " selected" : ""}>${kacisli(a)}</option>`).join("");
      sec.value = inanc;
      // Liste her değiştiğinde ne olacağı yeniden yazılıyor.
      sec.onchange = ekimUcPlanYaz;
      ekimUcPlanYaz();
    }
  }

  /* ATLANANLAR. Seçimde türsüz nokta varsa ekim artık durmuyor; ama
   * kullanıcı ilk onayı vermeden ÖNCE neyin ekilip neyin atlandığını
   * görmeli, sonradan "6 seçmiştim, 3 ekilmiş" diye aramasın. */
  const atl = $("#ekim-onay-atlanan");
  if (atl) {
    const liste = e.atlanan || [];
    atl.classList.toggle("gizli", !liste.length);
    if (liste.length) {
      const adlar = liste.slice(0, 4).map((a) => a.ad).join(", ");
      atl.innerHTML = `<b>${e.toplam} bitki ekilecek</b> · `
        + `<b>${liste.length} türsüz nokta atlandı</b> (${kacisli(adlar)}`
        + (liste.length > 4 ? ` ve ${liste.length - 4} tane daha` : "")
        + ") — bunlar bitki değil, ızgara/referans noktası.";
    }
  }

  /* NEREDE DURDUĞU. Kullanıcı makineye bakarak onaylayacak ama hangi
   * haznenin ya da hangi bitkinin başında olduğunu bilmeli — hazneler
   * yan yana ve dışarıdan hangisinin s1 olduğu anlaşılmıyor.
   * Birinci onayda kafa HAZNENİN, ikincisinde HEDEFİN üstünde. */
  const k = e.konum || {};
  const say = (d) => (d == null ? "?" : Math.round(Number(d)));
  $("#ekim-onay-yer").innerHTML = k.ad
    ? `Kafa <b>${kacisli(k.ad)}</b> ${k.nerede === "hedef" ? "noktasının" : "haznesinin"}
       üstünde — X${say(k.x)} Y${say(k.y)} Z${say(k.z)}`
      + (e.hazne && e.tohum
        ? `<br>'${kacisli(e.hazne)}' haznesinden <b>${kacisli(e.tohum)}</b>`
          + (e.tur_ad ? ` (${kacisli(e.tur_ad)})` : "") + " noktasına"
        : "")
      + (e.pompa_acik ? "<br><b>Vakum pompası AÇIK.</b>" : "")
    : "";

  $("#ekim-onay-iptal-secim").classList.add("gizli");
  $("#ekim-onay-dugmeler").classList.remove("gizli");
  kutu.classList.remove("gizli");
}

/* NE OLACAĞINI ÖNCEDEN SÖYLE — hem de LİSTEDE SEÇİLİ olana göre.
 *
 * Kullanıcı listeden doğru ucu seçtiğinde makinenin ne yapacağı değişiyor:
 * "kafada tool3 var, ekim tool3 istiyor → hareket yok" ile "kafada tool2
 * var, ekim tool3 istiyor → önce tool2 bırakılacak" arasında büyük fark
 * var. Cümleyi kayıtlı inanca göre yazsaydık, kullanıcı listeyi
 * düzelttikten sonra bile eski (yanlış) planı okurdu. */
function ekimUcPlanYaz() {
  const kutu = $("#ekim-uc-plan");
  const e = S.ekimOnay;
  if (!kutu || !e) return;
  const secilen = (($("#ekim-uc-secim") || {}).value || "");
  const gereken = e.uc_gereken || e.uc_adi || "";
  const inanc = e.uc_inanc || "";
  const kayit = secilen === inanc
    ? ""
    : `Kayıt <b>${kacisli(inanc || "boş")}</b> → <b>${kacisli(secilen || "boş")}</b>`
      + " olarak düzeltilecek. ";
  let ne;
  if (secilen && secilen === gereken) {
    ne = `Kafada <b>${kacisli(secilen)}</b> var, ekim <b>${kacisli(gereken)}</b>`
       + " istiyor — <b>makine uç için hareket etmeyecek</b>.";
  } else if (secilen) {
    ne = `Kafada <b>${kacisli(secilen)}</b> var, ekim <b>${kacisli(gereken)}</b>`
       + ` istiyor — önce <b>${kacisli(secilen)} yuvasına bırakılacak</b>,`
       + ` sonra <b>${kacisli(gereken)}</b> alınacak.`;
  } else {
    ne = `Kafa <b>boş</b>, ekim <b>${kacisli(gereken)}</b> istiyor —`
       + ` makine doğrudan <b>${kacisli(gereken)}</b> almaya gidecek.`;
  }
  kutu.innerHTML = kayit + ne;
}

async function ekimOnayYukle() {
  try { ekimOnayYaz(await apiIste("/api/ekim/onay")); }
  catch (h) { /* parola yoksa ya da uç yoksa sorun değil */ }
}

async function ekimOnayGonder(yol, govde) {
  const dugmeler = $$("#ekim-onay .dugme");
  dugmeler.forEach((d) => { d.disabled = true; });
  try {
    ekimOnayYaz(await apiIste(yol, {
      method: "POST", body: JSON.stringify(govde || {}),
    }));
  } catch (h) {
    gunluk(`✕ Ekim onayı: ${h.message}`, "hata");
    // Uç reddettiyse ekrandaki hâl artık güvenilmez: gerçeği geri okuyoruz.
    ekimOnayYukle();
  } finally {
    dugmeler.forEach((d) => { d.disabled = false; });
  }
}

function ekimOnayBagla() {
  const d = (kimlik, is) => { const e = $(kimlik); if (e) e.onclick = is; };
  /* ONAY, LİSTEDEKİ CEVABI TAŞIYOR.
   *
   * Eskiden liste ile onay düğmesi iki ayrı işti: kullanıcı listeden doğru
   * ucu seçip "Onayla, devam et"e bastığında kayıt değişmiyordu ve makine
   * eski (yanlış) inançla hareket ediyordu — olmayan bir ucun yuvasına
   * iniyordu. Kilit servosu ve varlık sensörü bağlı değilken tek doğrulama
   * kaynağı kullanıcı; verdiği cevabın GERÇEKTEN işlemesi gerekiyor. */
  d("#d-ekim-onayla", () => {
    const e = S.ekimOnay;
    const govde = (e && e.uc_teyit)
      ? { uc: (($("#ekim-uc-secim") || {}).value || "") }
      : {};
    ekimOnayGonder("/api/ekim/onayla", govde);
  });
  /* Onay beklenmiyorken İptal doğrudan yarıda kesiyor: seçenek sormanın
   * anlamı yok, çünkü "tohumu gözüne geri koy" makineyi hareket ettirir
   * ve tıkanmanın sebebi çoğu zaman makinenin zaten cevap vermemesi. */
  d("#d-ekim-iptal", () => {
    const e = S.ekimOnay;
    if (e && e.durum !== "onay1" && e.durum !== "onay2") {
      ekimOnayGonder("/api/ekim/iptal");
      return;
    }
    return ekimIptalSecim();
  });
  const ekimIptalSecim = () => {
    // İlk onayda iptal tek anlamlı: pompa hiç açılmadı, hiçbir şey
    // olmadı. İkincisinde seçim gerekiyor.
    if ((S.ekimOnay || {}).durum === "onay1") {
      ekimOnayGonder("/api/ekim/iptal");
      return;
    }
    $("#ekim-onay-iptal-secim").classList.remove("gizli");
    $("#ekim-onay-dugmeler").classList.add("gizli");
  };
  // Kayıt düzeltme HAREKET DEĞİL: yalnız yazılımın inancı değişiyor.
  // Düzeltmeden sonra soru yeniden çiziliyor ki kullanıcı yeni hâli
  // görüp onaylasın — "düzelttim" ile "devam et" aynı tuş olmasın.
  d("#d-ekim-uc-duzelt", async () => {
    const ad = ($("#ekim-uc-secim") || {}).value || "";
    const sonuc = await komutGonder("uc_beyan", { ad });
    if (sonuc && sonuc.ok) ekimOnayYukle();
  });
  d("#d-ekim-iptal-geri", () => ekimOnayGonder("/api/ekim/iptal", { kip: "geri_koy" }));
  d("#d-ekim-iptal-birak", () => ekimOnayGonder("/api/ekim/iptal", { kip: "birak" }));
  d("#d-ekim-iptal-vazgec", () => {
    $("#ekim-onay-iptal-secim").classList.add("gizli");
    $("#ekim-onay-dugmeler").classList.remove("gizli");
  });
}

/* Ekim ayarları: onay anahtarı ve iki süre. Süreler zaten koddaydı ama
 * kutusu yoktu — sahada vakumun tutmadığı görülünce değiştirilecek ilk
 * şey onlar. */
function ekimAyarYaz(a) {
  S.ekimAyar = a || {};
  const anahtar = $("#a-ekim-onay");
  const not = $("#ekim-ayar-durum");
  const uyari = $("#ekim-onay-uyari");
  if (!anahtar || !not) return;
  if (document.activeElement !== anahtar) anahtar.checked = !!a.onay_iste;
  const birak = $("#a-ekim-birak");
  if (birak && document.activeElement !== birak) birak.checked = !!a.bitince_birak;
  const v = $("#ekim-vakum"), ds = $("#ekim-dusme"), uc = $("#ekim-uc");
  if (v && document.activeElement !== v) v.value = a.vakum_sn;
  if (ds && document.activeElement !== ds) ds.value = a.dusme_sn;
  if (uc && document.activeElement !== uc) uc.value = a.uc_adi || "";

  /* UÇLAR SABİT TAKILI. Açıkken uç takma, uç teyidi, birinci onay ve uç
   * bırakma akıştan tamamen çıkıyor — bu makinede uçlar hiç sökülmüyor.
   * Altındaki iki ayar (uç adı, bitince bırak) o hâlde anlamsız: silmek
   * yerine kapatıp SEBEBİNİ yazıyoruz, yoksa kullanıcı değeri değiştirip
   * neden bir şey olmadığını arardı. */
  const sabit = !!a.uclar_sabit;
  const us = $("#a-ekim-uclar-sabit");
  if (us && document.activeElement !== us) us.checked = sabit;
  const sabitNot = $("#ekim-uclar-sabit-not");
  if (sabitNot) {
    sabitNot.innerHTML = sabit
      ? "Ekim <b>doğrudan hazneye</b> gidiyor: uç takma, \"kafada ne var\" "
        + "teyidi ve \"uç takılı mı\" onayı sorulmuyor, bitince uç yuvasına "
        + "gidilmiyor. <b>\"Tohum ucta mı\" onayı duruyor.</b> "
        + "Uç yuvası koordinatlarına giden hiçbir hareket üretilmiyor."
      : "Eski akış: ekim önce kafada ne olduğunu soruyor, ucu takıyor, her "
        + "haznede \"uç takılı mı\" diye soruyor ve bitince ucu bırakıyor.";
  }
  // Uçlar sabitken bu ikisinin karşılığı yok.
  [["#a-ekim-birak", "Uçlar sabit takılıyken bırakma diye bir iş yok."],
   ["#ekim-uc", "Uçlar sabit takılıyken uç takılmıyor; bu ad kullanılmıyor."],
  ].forEach(([sec, sebep]) => {
    const el = $(sec);
    if (!el) return;
    el.disabled = sabit;
    el.title = sabit ? sebep : "";
    const kap = el.closest(".anahtar, .alan");
    if (kap) kap.classList.toggle("etkisiz", sabit);
  });

  not.textContent = (a.onay_iste ? "onaylı" : "onaysız")
    + (sabit ? " · uçlar sabit" : ` · ${a.uc_adi || "?"}`)
    + ` · vakum ${a.vakum_sn} sn · düşme ${a.dusme_sn} sn`;
  if (uyari) {
    // Kapalıyken ne olacağını AÇIKÇA söylüyoruz: kullanıcı anahtarı
    // "ekim hızlansın" diye kapatıp neden hiç başlamadığını aramasın.
    // Uçlar sabitken kilit şartı zaten geçerli değil — takma yapılmıyor.
    const kilitSarti = !a.onay_iste && !sabit;
    uyari.textContent = kilitSarti
      ? "Onay kapalı: kilit şartı geri geldi. Uç kilit servosu bağlı "
        + "değilse (lock_reg = 0) ekim dizisi hiç başlamayacak."
      : "";
    uyari.classList.toggle("gizli", !kilitSarti);
  }
}

async function ekimAyarYukle() {
  try { ekimAyarYaz(await apiIste("/api/ekim/ayar")); }
  catch (h) { /* bölüm açılmamışsa sorun değil */ }
}

async function ekimAyarKaydet() {
  try {
    ekimAyarYaz(await apiIste("/api/ekim/ayar", {
      method: "POST",
      body: JSON.stringify({
        onay_iste: $("#a-ekim-onay").checked,
        uclar_sabit: $("#a-ekim-uclar-sabit").checked,
        // Kapalı (etkisiz) kutular DEĞERLERİNİ koruyor: uçlar sabitken
        // bunlar kullanılmıyor ama anahtarı kapatınca eski ayarların
        // yerinde durması gerekiyor.
        bitince_birak: $("#a-ekim-birak").checked,
        uc_adi: $("#ekim-uc").value.trim(),
        vakum_sn: Number($("#ekim-vakum").value),
        dusme_sn: Number($("#ekim-dusme").value),
      }),
    }));
    gunluk("✓ Ekim ayarları kaydedildi", "ok");
  } catch (h) {
    gunluk(`✕ Ekim ayarları: ${h.message}`, "hata");
  }
}

/* -------------------------------------- kamera kutusunda tek tuşla çözümleme
 *
 * YENİ BİR HAT YOK. Aynı `/api/goruntu/coz` ve `/api/goruntu/maske`;
 * `goruntu.py` yeşili topraktan ayırıyor, `tespit.py` pikseli milimetreye
 * çevirip kayıtlı bitkilerle eşliyor. Burada değişen tek şey SUNUM:
 * Görüntü bölümündeki satır listesi yerine karenin üstünde kutu.
 *
 * TAHMİN KONUSUNDA DÜRÜSTLÜK, bu bölümün asıl kuralı:
 *
 *   ExG segmentasyonu TÜR TANIMIYOR. Yeşili topraktan ayırıyor, o kadar.
 *   Bir lekeye bakıp "bu marul" diyemeyiz — elimizdeki tek çıkarım,
 *   lekenin konumu kayıtlı bir bitkinin yayılım çemberine düşüyorsa o
 *   bitki olma ihtimalinin yüksek olduğu. Düşmüyorsa BİLİNMİYOR: yabani
 *   ot da olabilir, kaydetmediğimiz bir fide de. Etiketler bunu bu
 *   şekilde söylüyor, uydurma tür adı yazmıyor.
 *
 *   Kalibrasyon yokken (mm_px = 0) MİLİMETRE YAZILMIYOR. Piksel yazıp
 *   uyarı gösteriyoruz. Yanlış milimetre, hiç milimetre olmamasından
 *   kötüdür: yanlış olduğu belli olmayan bir sayıdır.
 */

/* Bir kameranın çözümlemesinin görünebileceği yerler: Ayarlar kartı (yalnız
 * o kamera seçiliyse) ve o kameranın kendi yüzen kutusu. İkisi de AYNI
 * kareyi gösteriyor, o yüzden tek çözümleme ikisini birden boyuyor.
 *
 * ÖTEKİ KAMERANIN KUTUSU BOYANMIYOR. En kritik nokta bu: iki kamera farklı
 * yerlere bakıyor ve farklı ölçekte; bir karenin kutularını ötekinin
 * görüntüsüne çizmek, yanlış yeri işaret eden kutular demek. */
function kamHedefler(ad) {
  const cikti = [];
  const yari = KAM_YARI.get(ad);
  if (yari) {
    cikti.push({
      im: yari.querySelector('[data-rol="kare"]'),
      ortu: yari.querySelector('[data-rol="ortu"]'),
      maske: yari.querySelector('[data-rol="maske-im"]'),
      not: yari.querySelector('[data-rol="not"]'),
    });
  }
  const kutu = KAM_KUTU.get(ad);
  if (kutu) {
    cikti.push({
      im: kutu.querySelector('[data-rol="kare"]'),
      ortu: kutu.querySelector('[data-rol="ortu"]'),
      maske: kutu.querySelector('[data-rol="maske-im"]'),
      not: kutu.querySelector('[data-rol="not"]'),
    });
  }
  return cikti;
}

/** Bütün kameraların hedefleri — hizalama ve toplu temizlik için. */
function kamTumHedefler() {
  const adlar = kamListe().map((k) => k.ad);
  if (!adlar.length) adlar.push(kamSecili() || "uc");
  return adlar.flatMap(kamHedefler);
}

/** Görüntünün GERÇEKTEN çizildiği dikdörtgen, kapsayıcıya göre piksel.
 *
 *  `inset: 0` yetmiyor: yüzen kutu "büyük" hâlde `object-fit: contain`
 *  kullanıyor ve orada görüntü kutunun tamamını değil, oranı korunmuş
 *  bir iç dikdörtgeni kaplıyor. Harfleme payını hesaba katmasaydık
 *  kutular o pay kadar kayardı — ve kayan bir kutu, yanlış yeri işaret
 *  eden bir kutudur. */
function kamCizimAlani(im) {
  const kap = im && im.offsetParent;
  if (!kap) return null;
  const ir = im.getBoundingClientRect();
  const kr = kap.getBoundingClientRect();
  if (!ir.width || !ir.height) return null;
  let en = ir.width, boy = ir.height, sol = 0, ust = 0;
  const dw = im.naturalWidth, dh = im.naturalHeight;
  if (dw > 0 && dh > 0 && getComputedStyle(im).objectFit === "contain") {
    const o = Math.min(en / dw, boy / dh);
    const cw = dw * o, ch = dh * o;
    sol = (en - cw) / 2; ust = (boy - ch) / 2;
    en = cw; boy = ch;
  }
  // Mutlak konumlu çocuk kapsayıcının DOLGU kutusuna göre yerleşiyor;
  // getBoundingClientRect ise kenarlık kutusunu veriyor.
  return {
    sol: ir.left - kr.left - kap.clientLeft + sol,
    ust: ir.top - kr.top - kap.clientTop + ust,
    en, boy,
  };
}

/** Katmanları görüntünün üstüne oturtur. Kutu boyu değiştikçe (ölçek
 *  düğmesi, ekrana sığdır, pencere) yeniden çağrılıyor. */
function kamKatmanHizala() {
  kamTumHedefler().forEach((h) => {
    const alan = kamCizimAlani(h.im);
    [h.ortu, h.maske].forEach((k) => {
      if (!k) return;
      if (!alan) { k.style.width = "0"; k.style.height = "0"; return; }
      k.style.left = `${alan.sol}px`;
      k.style.top = `${alan.ust}px`;
      k.style.width = `${alan.en}px`;
      k.style.height = `${alan.boy}px`;
    });
  });
}

/** Bir kameranın (ad verilmezse hepsinin) çözümleme katmanını boşaltır. */
function kamOrtuTemizle(ad) {
  const adlar = ad ? [ad] : Object.keys(S.kamCozler);
  adlar.forEach((a) => {
    delete S.kamCozler[a];
    // Kutular gitti: dondurma sebebi de gitti, akış ekrana geri dönüyor.
    if (S.kamDondu[a]) { delete S.kamDondu[a]; kameraDurumYaz(kamBilgi(a)); }
    kamHedefler(a).forEach((h) => {
      if (h.ortu) h.ortu.innerHTML = "";
      if (h.maske) { h.maske.classList.add("gizli"); h.maske.removeAttribute("src"); }
      if (h.not) { h.not.classList.add("gizli"); h.not.innerHTML = ""; }
    });
  });
}

/* Ölçülen çapın beklenene oranı hangi aralıkta "aynı" sayılsın.
 *
 * Bu bir ÖLÇÜM DEĞİL, seçim — ve geniş seçildi. Ölçülen çap üstten
 * görünen izdüşüm: yaprak yatık duruyorsa büyük, dik duruyorsa küçük
 * çıkıyor. Beklenen çap da kaba: yayılım eğrisi bağlı değilse
 * katalogdaki olgun değer kullanılıyor (bkz. `sulama.guncel_yaricap_mm`).
 * Dar bir bant, her fideye sırayla "geride" ve "önde" dedirtirdi. */
const KAM_ALT_ORAN = 0.7;
const KAM_UST_ORAN = 1.3;

/** Ölçülen çap ile beklenen çapın kıyası — TEK KELİME.
 *
 * `yasaGore` bayrağı önemli. Bitkiye yayılım eğrisi bağlıysa beklenen
 * çap O YAŞA ait ve "beklenenin altında" gerçekten "geride kalmış"
 * demek. Bağlı değilse beklenen, katalogdaki OLGUN çap: dün ekilmiş bir
 * marul ister istemez altında çıkar ve buna "geride" demek yanlış olur.
 * O yüzden kelime de değişiyor — kıyasın neye göre yapıldığını etiketin
 * kendisi söylüyor. */
function kamKiyas(cap, beklenen, yasaGore) {
  if (!(beklenen > 0) || !(cap > 0)) return "";      // bilmiyorsak susuyoruz
  const o = cap / beklenen;
  if (yasaGore) {
    if (o < KAM_ALT_ORAN) return "beklenenin altında";
    if (o > KAM_UST_ORAN) return "beklenenin üstünde";
    return "beklendik";
  }
  if (o < KAM_ALT_ORAN) return "olgunun altında";
  if (o > KAM_UST_ORAN) return "olgunun üstünde";
  return "olgun ölçüde";
}

/** Tür kataloğundan simge — YALNIZ kayıtlı bitkinin kendi türü için.
 *  Lekeye bakıp tür seçmiyoruz; simge eşleşen KAYITTAN geliyor. */
function kamSimge(slug) {
  const t = ((window.Tarla && Tarla.turler && Tarla.turler()) || {})[slug];
  return (t && t.icon) || "🌱";
}

/** Bir lekenin kutusunu ve etiketini kurar. */
function kamKutuHtml(px, kare, sinif, etiket, baslik) {
  const en = Math.max(1, Number(kare.en_px) || 1);
  const boy = Math.max(1, Number(kare.boy_px) || 1);
  const x = (100 * Number(px.x1)) / en;
  const y = (100 * Number(px.y1)) / boy;
  const yer = `left:${x}%;top:${y}%;`
    + `width:${(100 * (px.x2 - px.x1 + 1)) / en}%;`
    + `height:${(100 * (px.y2 - px.y1 + 1)) / boy}%`;
  // İki taşma da etiketi okunmaz yapıyor, ikisi de kenara yakın lekelerde
  // oluyor: üstte etiket görüntünün dışına çıkıyor, sağda kutunun dışına.
  // Kenara göre yön değiştiriyor — küçültmek yerine, çünkü küçültülmüş
  // bir ölçü yanlış okunan bir ölçüdür.
  const sinif2 = `${sinif}${y < 12 ? " alta" : ""}${x > 45 ? " saga" : ""}`;
  return `<div class="kam-kutu ${sinif2}" style="${yer}"
    title="${kacisli(baslik)}"><span class="kam-etiket">${kacisli(etiket)}</span></div>`;
}

function kamCozumYaz(y) {
  const ad = y.kamera || kamSecili();
  S.kamCozler[ad] = y;
  // Kutular ekranda: bundan sonraki kareler görüntüyü değiştirmesin.
  // Canlı akışta bu olmazsa çözümleme bir sonraki karede siliniyor.
  S.kamDondu[ad] = true;
  kameraDurumYaz(kamBilgi(ad));
  const kare = y.kare || {};
  // SABİT KAMERA: ölçüler var, KOORDİNAT YOK. `kalibre` bayrağı burada
  // "milimetre yazılabilir mi" demek; sabit kamerada `ret` her zaman dolu
  // (konum yok) ama kalibreyse ölçüler yine milimetre. İkisini ayırıyoruz,
  // yoksa kalibre edilmiş sabit kamerada da piksel yazardık.
  if (!kamHareketli(ad)) { kamCozumYazSabit(y, ad); return; }
  const kalibre = !(y.ret && y.ret.length);

  // Leke no -> eşleşme bilgisi. `no` hem piksel hem milimetre lekesinde
  // aynı: kutuyu piksel uzayından, etiketi milimetre uzayından alıyoruz.
  const eslesme = {};
  (y.eslesen || []).forEach((e) => { eslesme[(e.leke || {}).no] = e; });
  const yabani = {};
  (y.yabani_aday || []).forEach((b) => { yabani[b.no] = b; });
  const mm = {};
  (y.lekeler || []).forEach((l) => { mm[l.no] = l; });

  const kutular = (y.lekeler_px || []).map((px) => {
    const enPx = Math.round(px.x2 - px.x1 + 1);
    if (!kalibre) {
      // Kalibrasyon yok: ölçü PİKSEL ve eşleşme HİÇ denenmedi. "eşleşmedi"
      // yazmak yalan olurdu — denenmiş de tutmamış gibi okunur.
      return kamKutuHtml(px, kare, "kam-gri", `${enPx} px`,
        "Kamera kalibre edilmemiş: ölçü piksel, milimetre değil. "
        + "Lekenin makine koordinatı bilinmediği için kayıtlı bitkilerle "
        + "eşleştirme yapılmadı.");
    }
    const e = eslesme[px.no];
    const l = mm[px.no] || {};
    const olcu = `${Math.round(Number(l.en_mm) || 0)} mm`;
    if (e) {
      const yasa = !!e.beklenen_yasa_gore;
      const bek = Number(e.beklenen_cap_mm);
      const kiyas = kamKiyas(Number(l.cap_mm), bek, yasa);
      return kamKutuHtml(px, kare, "kam-yesil",
        `${kamSimge(e.tur)} ${e.ad} · ${olcu}${kiyas ? ` · ${kiyas}` : ""}`,
        `Bu leke "${e.ad}" kaydının yayılım çemberine düşüyor `
        + `(${e.uzaklik_mm} mm uzakta), o yüzden büyük ihtimalle o bitki. `
        + "Görüntü türü TANIMIYOR — yeşili topraktan ayırıyor; ad kayıttan "
        + "geliyor, tahminden değil.\n"
        + `Ölçülen çap ${Number(l.cap_mm).toFixed(0)} mm`
        + (bek > 0
          ? (yasa
            ? `, bu yaşta beklenen ${bek.toFixed(0)} mm — ${kiyas}.`
            : `, katalogdaki OLGUN çap ${bek.toFixed(0)} mm — ${kiyas}.\n`
              + "Bu bitkiye yayılım eğrisi bağlı değil, o yüzden kıyas yaşa "
              + "göre değil olgun ölçüye göre: yeni bir fide doğal olarak "
              + "altında çıkar, geride kaldığı anlamına gelmez. Yaşa göre "
              + "kıyas için bitkiye bir yayılım eğrisi bağlayın.")
          : "; beklenen çap bilinmiyor (tür ya da yayılım kayıtlı değil).")
        + `\nKutu ${Number(l.en_mm).toFixed(0)}×${Number(l.boy_mm).toFixed(0)} mm · `
        + `alan ${Number(l.alan_mm2).toFixed(0)} mm².`);
    }
    return kamKutuHtml(px, kare, "kam-turuncu", `eşleşmedi · ${olcu}`,
      "Yakınında kayıtlı bitki yok, yani bunun NE olduğunu bilmiyoruz: "
      + "yabani ot da olabilir, kaydetmediğiniz bir fide de, yosun ya da "
      + "düşmüş bir yaprak da. Hiçbir işlem yapılmıyor.\n"
      + `Konum X${Math.round(l.x)} Y${Math.round(l.y)} · `
      + `çap ${Number(l.cap_mm).toFixed(0)} mm.`);
  }).join("");

  const say = (y.lekeler_px || []).length;
  const not = kalibre
    ? `<b>${say}</b> leke · <b>${(y.eslesen || []).length}</b> kayıtlı bitkiye
       denk geliyor · <b>${(y.yabani_aday || []).length}</b> bilinmiyor
       ${(y.gorunmeyen || []).length
        ? `· <b>${y.gorunmeyen.length}</b> kayıtlı bitkinin lekesi bulunamadı`
        : ""}
       <br>Yeşili topraktan ayırıyoruz, <b>tür tanımıyoruz</b>. "Denk geliyor"
       demek: leke o bitkinin yayılım çemberine düşüyor.`
    : `<b>${say}</b> leke bulundu.
       <br><span class="uyari">⚠ Kamera kalibre edilmedi (mm_px = 0) —
       ölçüler <b>piksel</b>, milimetre değil.</span>
       Kayıtlı bitkilerle eşleştirme de yapılamadı: lekenin makine
       koordinatı bilinmeden hangi bitkiye ait olduğu söylenemez.
       ${(y.ret || []).slice(1).map(kacisli).join(" ")}`;

  kamHedefler(ad).forEach((h) => {
    if (h.ortu) h.ortu.innerHTML = kutular;
    if (h.not) { h.not.innerHTML = not; h.not.classList.remove("gizli"); }
  });
  kamMaskeUygula(ad);
  kamKatmanHizala();
}

/* SABİT KAMERANIN ÇÖZÜMLEMESİ — ölçü var, koordinat yok.
 *
 * Sabit kamera yatağın neresine baktığını bilmiyor: makine hareket edince
 * onun gördüğü sahne değişmiyor, dolayısıyla karenin bir makine koordinatı
 * yok ve bir lekenin yatak koordinatı da çıkarılamıyor. Bunun sonucu:
 *
 *   - Kayıtlı bitkilerle EŞLEŞTİRME YAPILMIYOR. "Bu marul" diyemeyiz;
 *     "eşleşmedi" de diyemeyiz, çünkü denenmedi.
 *   - Kalibreyse ölçüler MİLİMETRE (çap, alan bir pikselin kaç mm
 *     olduğundan çıkıyor ve o doğru). Kalibre değilse PİKSEL.
 *
 * Yani burada eksik olan tek şey "nerede" — "ne kadar büyük" sorusunun
 * cevabı sağlam. */
function kamCozumYazSabit(y, ad) {
  const kare = y.kare || {};
  const olculu = !!y.yalniz_olcu;      // kalibre → milimetre ölçü var
  const kutular = (y.lekeler_px || []).map((px) => {
    const l = (y.lekeler || []).find((m) => m.no === px.no) || {};
    const enPx = Math.round(px.x2 - px.x1 + 1);
    const olcu = olculu ? `${Math.round(Number(l.en_mm) || 0)} mm` : `${enPx} px`;
    return kamKutuHtml(px, kare, "kam-gri", olcu,
      (olculu
        ? `Ölçü ${Number(l.en_mm).toFixed(0)}×${Number(l.boy_mm).toFixed(0)} mm · `
          + `çap ${Number(l.cap_mm).toFixed(0)} mm · `
          + `alan ${Number(l.alan_mm2).toFixed(0)} mm².\n`
        : "Bu kamera kalibre edilmemiş: ölçü piksel, milimetre değil.\n")
      + "Sabit kamera — bu lekenin yatağın neresinde olduğunu BİLMİYORUZ ve "
      + "kayıtlı bitkilerle eşleştirme yapılmadı. Kamera makineyle hareket "
      + "etmediği için karenin bir makine koordinatı yok.");
  }).join("");

  const say = (y.lekeler_px || []).length;
  const not = `<b>${say}</b> leke bulundu · <b>${kacisli(kamEtiket(ad))}</b> (sabit).
     ${olculu
      ? "Ölçüler <b>milimetre</b> (bu kameranın kendi mm/px'i)."
      : `<span class="uyari">⚠ Bu kamera kalibre edilmedi (mm_px = 0) —
         ölçüler <b>piksel</b>.</span>`}
     <br>Sabit kamera makineyle hareket etmiyor, o yüzden karenin bir makine
     konumu yok: lekelerin <b>yatak koordinatı verilmiyor</b> ve kayıtlı
     bitkilerle eşleştirme <b>yapılmıyor</b>. Yeşili topraktan ayırıyoruz,
     <b>tür tanımıyoruz</b>.`;

  kamHedefler(ad).forEach((h) => {
    if (h.ortu) h.ortu.innerHTML = kutular;
    if (h.not) { h.not.innerHTML = not; h.not.classList.remove("gizli"); }
  });
  kamMaskeUygula(ad);
  kamKatmanHizala();
}

/** Bir kameranın çözümle/maske düğmeleri: karttaki (seçiliyse) ve kutudaki. */
function kamDugmeler(ad, rol) {
  const cikti = [];
  const yari = KAM_YARI.get(ad);
  if (yari) {
    const d = yari.querySelector(`[data-rol="${rol}"]`);
    if (d) cikti.push(d);
  }
  const kutu = KAM_KUTU.get(ad);
  if (kutu) {
    const d = kutu.querySelector(`[data-rol="${rol}"]`);
    if (d) cikti.push(d);
  }
  return cikti;
}

/** Maske katmanı: eşiğin neyi bitki saydığını GÖRMEDEN eşik ayarlanamaz. */
function kamMaskeUygula(ad) {
  const coz = S.kamCozler[ad];
  const istendi = !!S.kamMaskeler[ad];
  const acik = istendi && !!coz;
  kamDugmeler(ad, "maske").forEach((d) => {
    d.setAttribute("aria-pressed", String(istendi));
    d.classList.toggle("secili", istendi);
  });
  kamHedefler(ad).forEach((h) => {
    const m = h.maske;
    if (!m) return;
    if (!acik) { m.classList.add("gizli"); return; }
    const jeton = encodeURIComponent(S.jeton || "");
    const e = coz.esik;
    // Maske de KAMERAYA bağlı: damga iki kamerada aynı saniyeye denk
    // gelebiliyor ve kamera yazılmazsa yanlış karenin maskesi gelirdi.
    m.src = `/api/goruntu/maske?damga=${encodeURIComponent(coz.damga)}`
      + `&kamera=${encodeURIComponent(ad)}&esik=${e == null ? -9 : e}&jeton=${jeton}`;
    m.classList.remove("gizli");
  });
}

async function kameraCozumle(ad) {
  const kam = ad || kamSecili();
  if (!kam) { gunluk("Tanımlı kamera yok", "uyari"); return; }
  const alan = kamRol(kam, "esik");
  const esik = !alan || alan.value === "" ? null : Number(alan.value);
  const dugmeler = kamDugmeler(kam, "coz");
  dugmeler.forEach((d) => { d.disabled = true; });
  // Yeniden çözümlemek dondurmayı bozuyor: istenen EN YENİ kare, ekranda
  // asılı duran eski kare değil. Sunucu "damga: boş" ile en yenisini alıyor.
  delete S.kamDondu[kam];
  try {
    // Damga BOŞ: sunucu O KAMERANIN en yeni kayıtlı karesini seçiyor.
    // Sonra görüntüleri o kareye sabitliyoruz — canlı akışta ekrandaki
    // kare çözümlenenden yeni olabilirdi ve kutular yanlış yeri gösterirdi.
    const y = await apiIste("/api/goruntu/coz", {
      method: "POST",
      body: JSON.stringify({ damga: "", esik, kamera: kam }),
    });
    const adres = `/api/kare/${encodeURIComponent(y.damga)}`
      + `?kamera=${encodeURIComponent(kam)}`
      + `&jeton=${encodeURIComponent(S.jeton || "")}`;
    // Görüntüyü ÇÖZÜMLENEN kareye sabitliyoruz: canlı akışta ekrandaki
    // kare çözümlenenden yeni olabilir ve kutular yanlış yeri gösterirdi.
    const panel = kamRol(kam, "kare");
    if (panel) {
      panel.src = adres;
      panel.classList.remove("gizli");
      const yok = kamRol(kam, "yok");
      if (yok) yok.classList.add("gizli");
    }
    // Yüzen kutu kullanıcı küçülttüyse kapalı kalıyor: çözümleme onu
    // geri açacak bir sebep değil.
    const kutu = KAM_KUTU.get(kam);
    if (kutu && !S.kamKutuKapali[kam]) {
      kutu.querySelector('[data-rol="kare"]').src = adres;
      kutu.classList.remove("gizli");
      (KAM_SINIRLA.get(kam) || (() => {}))();
    }
    kamCozumYaz(y);
    const kalibsiz = (y.ret || []).some((r) => /kalibre edilmemiş/i.test(r));
    gunluk(`✓ ${kamEtiket(kam)}: karede ${y.lekeler_px.length} leke`
      + (kalibsiz ? " (kalibre değil — ölçüler piksel)"
        : !y.hareketli ? " (sabit kamera — yatak koordinatı yok)"
        : `, ${(y.eslesen || []).length} kayıtlı bitkiye denk geliyor`), "ok");
  } catch (h) {
    gunluk(`✕ ${kamEtiket(kam)} çözümleme: ${h.message}`, "hata");
  } finally {
    dugmeler.forEach((d) => { d.disabled = false; });
  }
}

function kameraCozumBagla() {
  // Çözümle/Maske düğmeleri artık her kameranın KENDİ yarısında ve orada
  // bağlanıyor (bkz. `kamYariBagla`); burada bağlanacak tek kopya yok.
  // Eşik değişti: eski kutular eski eşiğe ait, ekranda bırakmak yanlış
  // olurdu. Zaten bir sonuç varsa kendiliğinden yenileniyor — eşik
  // ayarlamak "değiştir, bak, değiştir" döngüsü.

  // Kutu boyu değişince katman kaymasın: ölçek düğmesi, ekrana sığdır,
  // sürükleme ve pencere yeniden boyutlama hepsi buradan geçiyor.
  // Gözcü SAKLANIYOR: kutular kamera listesi değişince yeniden
  // kuruluyor ve yeni görüntüler de izlenmeli.
  if (window.ResizeObserver && !KAM_GOZCU.gozcu) {
    KAM_GOZCU.gozcu = new ResizeObserver(kamKatmanHizala);
  }
  kamGozcuTazele();
  window.addEventListener("resize", kamKatmanHizala);
}

/** Çözümleme katmanının hizasını bozan her görüntüyü izlemeye alır. */
const KAM_GOZCU = { gozcu: null, izlenen: new WeakSet() };
function kamGozcuTazele() {
  kamTumHedefler().forEach((h) => {
    const im = h.im;
    if (!im || KAM_GOZCU.izlenen.has(im)) return;
    KAM_GOZCU.izlenen.add(im);
    if (KAM_GOZCU.gozcu) KAM_GOZCU.gozcu.observe(im);
    im.addEventListener("load", kamKatmanHizala);
  });
}

/** Maske düğmesi — kamera başına. */
function kamMaskeAlSat(ad) {
  if (!ad) return;
  S.kamMaskeler[ad] = !S.kamMaskeler[ad];
  // Maskeyi görmek için çözümleme şart (maske uç noktası damga istiyor).
  // Kullanıcıyı "önce şuna bas" diye geri göndermiyoruz.
  if (S.kamMaskeler[ad] && !S.kamCozler[ad]) { kameraCozumle(ad); return; }
  kamMaskeUygula(ad);
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

/* ======================================================== kamera tanımları
 *
 * Her kamera AYRI tanımlanıyor: kendi cihazı, kendi çözünürlüğü, kendi kare
 * aralığı. Tanımlar ajanda `kameralar.json` dosyasında duruyor (ayarlar.json
 * değil — panelden yapılan geçici aç/kapat oraya yazılmıyor, ama donanım
 * tarifi kalıcı olmalı).
 *
 * CİHAZ ADI vs CİHAZ YOLU: USB kameranın /dev/videoN numarası, kamera
 * çıkarılıp takılınca değişiyor. Adı değişmiyor. O yüzden asıl alan
 * `cihaz_adi` ve yol yalnızca yedek. Kullanıcının numarayı ezberlemesi
 * gerekmesin diye "Bağlı cihazları tara" listeyi getiriyor.
 */
const KAM_YOLLAR = [
  ["oto", "oto — sırayla dene"],
  ["pi", "pi — kamera modülü (picamera2 / rpicam)"],
  ["usb", "usb — USB webcam (fswebcam / ffmpeg)"],
  ["sahte", "sahte — donanımsız deneme karesi"],
];

/** Düzenlenen tanımlar; yoksa ajanın bildirdiğinden üretiliyor. */
function kamAyarTaslak() {
  if (S.kamAyarTaslak) return S.kamAyarTaslak;
  S.kamAyarTaslak = kamListe().map((k) => ({
    ad: k.ad, etiket: k.etiket || k.ad, hareketli: !!k.hareketli,
    yol: k.yol || "oto", cihaz_adi: k.cihaz_adi || "", cihaz: k.cihaz || "",
    genislik: Number(k.genislik) || 640,
    aralik_sn: Number(k.aralik_sn) || 3600,
    sahte: !!k.sahte,
    // AÇILIŞTA çalışsın mı. Taslakta DURMASI şart: alan gönderilmezse
    // ajan varsayılana (kapalı) düşüp ayarı sessizce kapatıyordu ve
    // sorun ancak bir sonraki yeniden başlatmada görünüyordu.
    aktif: !!k.aktif,
  }));
  return S.kamAyarTaslak;
}

/** Her kameranın tanım kartını KENDİ yarısının altına çiziyor.
 *
 * Eskiden hepsi tek listede yan yanaydı ve hangi kartın hangi kameraya
 * ait olduğu ancak başlığından anlaşılıyordu. Artık kart, görüntüsünün
 * hemen altında: "her kameranın kendi ayarı kendi yarısının altında". */
function kamAyarKartlariYaz() {
  const taslak = kamAyarTaslak();
  taslak.forEach((k, i) => kamAyarKartiCiz(k, i));
  kamKalibOzetYaz();
}

function kamAyarKartiCiz(k, i) {
  const kap = kamRol(k.ad, "ayar");
  if (!kap) return;
  // Kullanıcı yazarken altından tazelemiyoruz: her durum paketinde kutuları
  // yeniden çizmek, yazılan yarım değeri siler.
  if (kap.contains(document.activeElement)) return;
  kap.innerHTML = [k].map((k, _i) => `
    <div class="gomulu kam-ayar" data-sira="${i}">
      <div class="satir-8 alt-hizali">
        <div class="alan"><label>Ad (kalıcı kimlik)</label>
          <input type="text" value="${kacisli(k.ad)}" disabled
                 title="Kare klasörü ve kalibrasyon anahtarı — değiştirilemez"></div>
        <div class="alan"><label>Panelde görünen ad</label>
          <input type="text" data-alan="etiket" value="${kacisli(k.etiket)}"
                 maxlength="40"></div>
      </div>
      <div class="satir-8 alt-hizali">
        <div class="alan"><label>Yol</label>
          <select data-alan="yol">${KAM_YOLLAR.map(([d, e]) =>
            `<option value="${d}"${d === k.yol ? " selected" : ""}>${kacisli(e)}</option>`
          ).join("")}</select></div>
        <div class="alan"><label>Cihaz adı (parça yeter)</label>
          <input type="text" data-alan="cihaz_adi" list="kam-cihaz-listesi"
                 value="${kacisli(k.cihaz_adi)}" placeholder="örn. USB Camera"
                 title="Kamera adından bulunuyor: /dev/video numarası değişse de çalışır"></div>
        <div class="alan"><label>Cihaz yolu (yedek)</label>
          <input type="text" data-alan="cihaz" value="${kacisli(k.cihaz)}"
                 placeholder="/dev/video8"
                 title="Yalnızca ad bulunamazsa kullanılıyor"></div>
      </div>
      <div class="satir-8 alt-hizali">
        <div class="alan"><label>Genişlik (px)</label>
          <input type="number" data-alan="genislik" min="160" max="1920" step="16"
                 value="${Number(k.genislik)}"></div>
        <div class="alan"><label>Kare aralığı (sn)</label>
          <input type="number" data-alan="aralik_sn" min="2" max="86400" step="1"
                 value="${Number(k.aralik_sn)}"></div>
        <label class="onay" title="Uç kafasıyla birlikte hareket ediyor mu?">
          <input type="checkbox" data-alan="hareketli"${k.hareketli ? " checked" : ""}>
          Hareketli (uçta)</label>
        <label class="onay" title="Donanım olmadan paneli denemek için üretilen kare">
          <input type="checkbox" data-alan="sahte"${k.sahte ? " checked" : ""}>
          Sahte kare</label>
        <label class="onay" title="Ajan her açıldığında bu kamera kendiliğinden çalışsın mı? Şu anki açık/kapalı hâlden ayrı bir ayar.">
          <input type="checkbox" data-alan="aktif"${k.aktif ? " checked" : ""}>
          Açılışta çalışsın</label>
      </div>
      <p class="ikincil">${k.hareketli
        ? "Kareleri konumlu: karedeki leke yatak koordinatına çevrilebiliyor."
        : "Kareleri KONUMSUZ: sabit kamera makineyle gitmediği için karelerine "
          + "makine konumu yazılmıyor, yatak koordinatı çıkarılmıyor. Ölçüler "
          + "(çap, alan) kendi mm/px'inden çıkıyor."}</p>
    </div>`).join("");

  kap.querySelectorAll(".kam-ayar").forEach((kart) => {
    const sira = Number(kart.dataset.sira);
    kart.querySelectorAll("[data-alan]").forEach((el) => {
      el.addEventListener("input", () => {
        const t = kamAyarTaslak()[sira];
        if (!t) return;
        const alan = el.dataset.alan;
        t[alan] = el.type === "checkbox" ? el.checked
          : (alan === "genislik" || alan === "aralik_sn") ? Number(el.value)
          : el.value;
        // "Hareketli" işareti kartın altındaki açıklamayı değiştiriyor ama
        // odak kutudayken kartı yeniden çizmiyoruz (yazılan silinirdi);
        // kaydedince yerine oturuyor.
      });
    });
  });
}

/* ==================================================== yüzen kamera kutuları
 *
 * Kamera başına BİR kutu ve kutular birbirinden tamamen bağımsız: her biri
 * kendi başına sürükleniyor, kendi boyut kademesini hatırlıyor, ayrı ayrı
 * kapatılıp açılıyor. Bu bağımsızlık iki kameranın aynı anda izlenebilmesi
 * demek — biri gizliyken öteki görünmeye devam ediyor.
 *
 * Kutular HTML'e elle yazılmıyor, `#kamera-yuzen-sablon` şablonundan
 * üretiliyor. Sebebi: kamera sayısı ayardan geliyor, sabit değil. İki kutu
 * elle yazsaydık üçüncü kamerayı eklemek HTML değişikliği gerektirirdi ve
 * kutunun içindeki id'ler tekrarlanırdı — bu yüzden içeride id yerine
 * `data-rol` var.
 *
 * Konum ve boyut tarayıcıda saklanıyor, ANAHTAR KAMERA ADIYLA: iki kutu tek
 * anahtarı paylaşsaydı biri ötekinin yerini ezerdi.
 */
const KAM_KUTU = new Map();      // kamera adı -> kutu öğesi
const KAM_SINIRLA = new Map();   // kamera adı -> konumu ekran içine çeken işlev

/* Kutu boyu kademeleri. Tam ekrandan AYRI bir denetim: tam ekran sahneyi
 * tamamen kapatıyor, burada istenen ise sahneyi görmeye devam ederken
 * görüntüyü okunur kılmak (Raspberry'nin ekranında 260 px küçük kalıyor). */
const KAM_OLCEKLER = [
  { sinif: "", etiket: "%100" },
  { sinif: "olcek-150", etiket: "%150" },
  { sinif: "olcek-160", etiket: "%160" },
];

/** Kamera listesine göre kutuları kurar; var olanları koruyor.
 *
 * KORUMAK ÖNEMLİ: durum paketi saniyede iki kez geliyor ve kutuyu her
 * seferinde yeniden yaratmak, kullanıcının sürüklediği yeri ve açık/kapalı
 * durumunu her yarım saniyede sıfırlardı. Yalnızca listeden DÜŞEN kutular
 * kaldırılıyor, YENİ olanlar ekleniyor. */
function kamKutulariKur() {
  const kap = $("#kamera-yuzenler");
  const sablon = $("#kamera-yuzen-sablon");
  if (!kap || !sablon) return;
  const adlar = kamListe().map((k) => k.ad);

  // Artık olmayan kameraların kutuları gitsin.
  [...KAM_KUTU.keys()].forEach((ad) => {
    if (adlar.includes(ad)) return;
    const eski = KAM_KUTU.get(ad);
    if (eski && eski.parentNode) eski.parentNode.removeChild(eski);
    KAM_KUTU.delete(ad);
    KAM_SINIRLA.delete(ad);
  });

  adlar.forEach((ad, sira) => {
    const mevcut = KAM_KUTU.get(ad);
    if (mevcut) {
      const baslik = mevcut.querySelector('[data-rol="ad"]');
      if (baslik) { baslik.textContent = kamEtiket(ad); baslik.title = kamEtiket(ad); }
      return;
    }
    const kutu = sablon.content.firstElementChild.cloneNode(true);
    kutu.dataset.kam = ad;
    kap.appendChild(kutu);
    KAM_KUTU.set(ad, kutu);
    kamKutuBagla(kutu, ad, sira);
    // Kutu, kamera listesi geldiğinde kuruluyor; o ana kadar gelmiş bir
    // kare varsa hemen gösteriyoruz. Beklemek, saatlik aralıkta bir saat
    // boş kutu demekti.
    const son = S.sonKare[ad];
    if (son && !S.kamKutuKapali[ad]) {
      kutu.querySelector('[data-rol="kare"]').src = son.adres;
      const z = kutu.querySelector('[data-rol="zaman"]');
      if (z) {
        z.textContent = (son.canli ? "canlı " : "")
          + new Date(son.ts * 1000).toLocaleTimeString("tr-TR");
      }
      kutu.classList.remove("gizli");
      (KAM_SINIRLA.get(ad) || (() => {}))();
    }
  });
  kamGozcuTazele();
}

/** Bir kutunun sürükleme, boyut, büyütme ve kapatma davranışı.
 *  `sira` yalnız ilk açılışta kullanılıyor: bütün kutular aynı ızgara
 *  gözünde (sağ alt) doğuyor, üst üste binmesinler diye ilki yerinde
 *  kalıyor, sonrakiler bir kutu boyu yukarıdan başlıyor. Kullanıcı bir kez
 *  sürükledikten sonra bu sayı bir daha kullanılmıyor. */
function kamKutuBagla(kutu, ad, sira = 0) {
  const rol = (r) => kutu.querySelector(`[data-rol="${r}"]`);
  const baslik = rol("ad");
  if (baslik) {
    baslik.textContent = kamEtiket(ad);
    // Başlık dar; uzun ad üç noktayla kesiliyor, tamamı burada duruyor.
    baslik.title = kamEtiket(ad);
  }

  /* --- sürükleme ---
   * Kutu ızgarayla yerleştirilmiş (sağ alt). Sürüklerken ızgarayı bırakıp
   * mutlak konuma geçmek yerine `transform` ile KAYDIRIYORUZ: ızgara
   * yerleşimi başlangıç noktası olarak kalıyor, pencere yeniden
   * boyutlandığında kutu yine sağ alta göre oturuyor. */
  const bas = kutu.querySelector(".kamera-yuzen-bas");
  const anahtarKayma = `farmbot_kamera_kayma_${ad}`;
  // Bir kutu boyu kadar yukarı: kaydedilmiş bir konum yoksa kutular
  // birbirinin üstünü kapatmasın. Sayı bir TAHMİN (başlık + 4:3 görüntü);
  // kutu görünür olup gerçek boyu ölçülebildiğinde aşağıda düzeltiliyor —
  // yoksa başlık satırı bir piksel uzadığında kutular yeniden çakışırdı.
  let kendi = true;              // konum hâlâ varsayılan mı (sürüklenmedi mi)
  let kayma = { x: 0, y: -sira * 230 };
  try {
    const kayit = JSON.parse(localStorage.getItem(anahtarKayma) || "null");
    if (kayit && Number.isFinite(kayit.x) && Number.isFinite(kayit.y)) {
      kayma = kayit;
      kendi = false;
    }
  } catch { /* bozuk kayıt — varsayılan konumda kal */ }

  const uygula = () => {
    kutu.style.transform = `translate(${kayma.x}px, ${kayma.y}px)`;
  };
  /* Ekran dışına kaçmasın: kutunun ızgaradaki yerini transform'suz ölçüp
   * kaymayı o ölçüye göre sınırlıyoruz. Aksi hâlde kutu bir kez dışarı
   * sürüklenince geri getirilemiyor. */
  const sinirla = () => {
    const onceki = kutu.style.transform;
    kutu.style.transform = "";
    const y = kutu.getBoundingClientRect();
    kutu.style.transform = onceki;
    /* Kutu GİZLİYKEN ölçüm sıfır dönüyor ve sınırlama kaydedilmiş konumu
     * eziyordu: açılışta kutu gizli olduğu için kayıt her seferinde
     * kayboluyor, kamera hep köşeye dönüyordu. Ölçülemiyorsa dokunmuyoruz;
     * kutu görünür olunca yeniden sınırlanıyor. */
    if (!y.width || !y.height) return;
    if (kutu.classList.contains("buyuk")) return;
    const pay = 24;                    // kutunun bu kadarı hep görünsün
    kayma.x = Math.max(-(y.left + y.width - pay),
                       Math.min(innerWidth - y.left - pay, kayma.x));
    kayma.y = Math.max(-(y.top + y.height - pay),
                       Math.min(innerHeight - y.top - pay, kayma.y));
  };
  uygula();
  /* Kutu görünür olunca GERÇEK boyuna göre yeniden diziyoruz. Tahmini
   * sayı tutmadığında kutular birbirinin başlığını örtüyordu ve alttaki
   * kutunun hangi kamera olduğu görünmüyordu — kutuların tek ayırt edici
   * işareti o başlık. Sürüklenmiş bir kutuya DOKUNULMUYOR. */
  const yenidenDiz = () => {
    if (!kendi || !sira) return;
    const boy = kutu.offsetHeight;
    if (!boy) return;                       // gizliyken ölçülemiyor
    kayma.y = -sira * (boy + 8);
  };
  KAM_SINIRLA.set(ad, () => { yenidenDiz(); sinirla(); uygula(); });
  sinirla(); uygula();

  let surukle = null;
  bas.addEventListener("pointerdown", (e) => {
    // Kapatma/büyütme düğmesine basarken sürükleme başlamasın.
    if (e.target.closest("button")) return;
    // Ekranı kaplarken sürüklemenin anlamı yok; üstelik satır içi
    // transform yazmak küçülünce kutuyu yanlış yere koyardı.
    if (kutu.classList.contains("buyuk")) return;
    surukle = { x: e.clientX, y: e.clientY, bx: kayma.x, by: kayma.y };
    bas.setPointerCapture(e.pointerId);
    kutu.classList.add("surukleniyor");
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
    kendi = false;            // artık kullanıcının konumu; kendiliğinden dizme
    kutu.classList.remove("surukleniyor");
    try {
      localStorage.setItem(anahtarKayma, JSON.stringify(kayma));
    } catch { /* depolama kapalı olabilir — konum bu oturumda kalır */ }
  };
  bas.addEventListener("pointerup", birak);
  bas.addEventListener("pointercancel", birak);
  // Pencere küçülünce kutu dışarıda kalabilir.
  addEventListener("resize", () => { sinirla(); uygula(); });

  /* --- boyut kademesi --- (seçim tarayıcıda, kamera başına) */
  const olcekDugme = rol("olcek");
  const anahtarOlcek = `farmbot_kamera_olcek_${ad}`;
  let kademe = 0;
  try {
    const kayit = Number(localStorage.getItem(anahtarOlcek));
    if (Number.isInteger(kayit) && kayit >= 0 && kayit < KAM_OLCEKLER.length) kademe = kayit;
  } catch { /* bozuk kayıt — %100'de kal */ }
  const olcekUygula = () => {
    KAM_OLCEKLER.forEach((o) => { if (o.sinif) kutu.classList.remove(o.sinif); });
    const secili = KAM_OLCEKLER[kademe];
    if (secili.sinif) kutu.classList.add(secili.sinif);
    if (olcekDugme) olcekDugme.textContent = secili.etiket;
    // Büyüyen kutu ekranın dışına taşabilir; sınırlama yeniden koşsun.
    sinirla(); uygula();
    kamKatmanHizala();
  };
  olcekUygula();
  if (olcekDugme) {
    olcekDugme.onclick = () => {
      kademe = (kademe + 1) % KAM_OLCEKLER.length;
      try { localStorage.setItem(anahtarOlcek, String(kademe)); } catch { /* boş */ }
      olcekUygula();
    };
  }

  /* --- ekrana sığdır --- */
  const buyutDugme = rol("buyut");
  const buyutYaz = (buyuk) => {
    kutu.classList.toggle("buyuk", buyuk);
    if (buyutDugme) {
      buyutDugme.textContent = buyuk ? "⤡" : "⤢";
      buyutDugme.title = buyuk ? "Küçült" : "Ekrana sığdır";
      buyutDugme.setAttribute("aria-label", buyutDugme.title);
      buyutDugme.setAttribute("aria-pressed", buyuk ? "true" : "false");
    }
    // Küçülürken sürüklenmiş konum yeniden sınırlanmalı: pencere
    // büyükken değişmiş olabilir.
    if (!buyuk) { sinirla(); uygula(); }
    kamKatmanHizala();
  };
  if (buyutDugme) buyutDugme.onclick = () => buyutYaz(!kutu.classList.contains("buyuk"));
  // Esc ile çıkış: ekranı kaplayan bir şeyden çıkışın beklenen yolu.
  // Diğer Esc davranışlarının önüne geçmesin diye yalnızca büyükken
  // yakalıyoruz ve olayı durduruyoruz.
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && kutu.classList.contains("buyuk")) {
      e.stopPropagation();
      buyutYaz(false);
    }
  }, true);

  /* --- gizle --- KAMERAYI KAPATMIYOR, yalnız kutuyu gizliyor. */
  const kapatDugme = rol("kapat");
  if (kapatDugme) {
    kapatDugme.onclick = () => {
      S.kamKutuKapali[ad] = true;
      // Büyük hâlde gizlemek, geri açınca ekranı kaplayan bir kutuyla
      // karşılaşmak demek olurdu.
      buyutYaz(false);
      kutu.classList.add("gizli");
      kamSahnedeYaz(ad);
      gunluk(`${kamEtiket(ad)} sahneden gizlendi — `
             + `Kamera sekmesindeki "Sahnede" düğmesiyle geri açılır`);
    };
  }

  /* --- çözümle / maske --- kutunun kendi kamerasına işliyor. */
  const cozDugme = rol("coz");
  if (cozDugme) cozDugme.onclick = () => kameraCozumle(ad);
  const cozKapatDugme = rol("coz-kapat");
  if (cozKapatDugme) {
    cozKapatDugme.onclick = () => {
      kamOrtuTemizle(ad);
      const son = S.sonKare[ad];
      if (son) kareyiTazele(son.ts, son.canli, ad);
    };
  }
  const maskeDugme = rol("maske");
  if (maskeDugme) maskeDugme.onclick = () => kamMaskeAlSat(ad);
}

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

  // Kamera listesi (`durum.kameralar`) tek kaynak; `d.kamera` tekili eski
  // ajanlar için duruyor ve ilk kameranın hâli.
  kameralarYaz(d.kameralar || (d.kamera && d.kamera.ad ? [d.kamera] : []));
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
    // Hazne tablosundaki "ulaşılamaz" uyarıları da sınırlara bağlı:
    // ajan yeni bağlandıysa denetim ancak şimdi yapılabiliyor.
    gozSinirDenetle();
  }

  const k = d.konum || {};
  // Birim ayrı bir eleman: satır içi stil yerine sınıf kullanıyoruz ki dar
  // ekranda ölçüsünü CSS ayarlayabilsin.
  const birimli = (deger) =>
    deger == null ? "—" : `${sayi(deger, 2)}<span class="birim"> mm</span>`;
  /* Ondalık varsa GÖSTERİLİYOR, yoksa gösterilmiyor.
   *
   * Sınırlar 0 basamağa, konum 1 basamağa yuvarlanıyordu. Z'nin referansı
   * 414.23 ve ekranda "414" ile "414.2" görünüyordu: kullanıcı kalibrasyona
   * 414,23 yazıyor, kaydediliyor, ama panel hiçbir zaman o sayıyı
   * göstermiyor — "yazdım ama düzelmedi" tam olarak bu.
   *
   * Tam sayılara gereksiz ".00" eklemiyoruz: X'in sınırı "0 – 535 mm"
   * olarak kalıyor, yalnız ondalıklı olan açılıyor. */
  const kisaSayi = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return Number.isInteger(n) ? sayi(n, 0) : sayi(n, 2);
  };
  ["x", "y", "z"].forEach((eksen) => {
    $(`#k-${eksen}`).innerHTML = birimli(k[eksen]);
    const sinir = (d.sinirlar || {})[eksen];
    $(`#s-${eksen}`).textContent = sinir
      ? `${kisaSayi(sinir.min)} – ${kisaSayi(sinir.max)} mm` : "";
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
  // Bahçedeki robot da: ekranda yürüyorsa makine gerçekten hareket
  // ediyor demek. Bahçe kapalıyken bu çağrı hemen dönüyor.
  if (window.Bahce) window.Bahce.durumDegisti(d);

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

  ws.onopen = () => {
    rozetYaz("#rozet-sunucu", "canli", "Sunucu bağlı");
    gunluk("Sunucuya bağlanıldı");
    // Onay bekleyen bir ekim varken panel yenilenmiş ya da kopmuş
    // olabilir. Soket paketleri yalnız DEĞİŞİMİ taşıyor; o anki hâli
    // uçtan okuyoruz, yoksa makine sizi beklerken ekran boş kalırdı.
    ekimOnayYukle();
    tepsiYukle();
  };

  ws.onmessage = (olay) => {
    const m = JSON.parse(olay.data);
    if (m.tip === "anlik") { durumGuncelle(m.durum); kartlariGuncelle(m.olcum); }
    else if (m.tip === "olcum") { kartlariGuncelle(m.veri); noktaEkle(m.veri); }
    else if (m.tip === "durum") durumGuncelle(m.durum);
    else if (m.tip === "kare") kareyiTazele(m.ts, false, m.kamera);
    else if (m.tip === "canli") kareyiTazele(m.ts, true, m.kamera);
    else if (m.tip === "ekim") {
      ekimOnayYaz(m.ekim);
      if (window.Bahce) window.Bahce.ekimDegisti(m.ekim);
    }
    else if (m.tip === "bahce") {
      if (window.Bahce) window.Bahce.kuyrukDegisti(m.kuyruk, m.tazele);
    }
    // Göz durumu değişti (ekildi, sulandı, tepsi kaydı). Panel kendi
    // isteğiyle çekiyor: paket yalnız "değişti" haberi taşıyor.
    else if (m.tip === "tepsi") tepsiYukle();
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
      const oncekiSekme = S.sekme;
      S.sekme = dugme.dataset.sayfa;
      localStorage.setItem("farmbot_sekme", S.sekme);
      // KAMERA ve BAHÇE sekmeleri canlı akışı açıp kapatıyor (biri 5,
      // öteki 1 kare/sn). Canlı akış panelin en pahalı yolu; kimse
      // bakmıyorken Pi'yi meşgul etmesinin sebebi yok.
      //
      // ÖNCE ÇIKIŞ, SONRA GİRİŞ. Ters sıra sessiz bir hataydı: bahçeden
      // kameraya geçerken önce kamera akışı 5'e çıkıyor, hemen ardından
      // bahçenin çıkış işlemi aynı kamerayı KAPATIYORDU. Sonuç, üst
      // kameranın kendi sekmesinde hiç akmaması.
      if (oncekiSekme === "kamera" && S.sekme !== "kamera") kamSekmesi(false);
      if (window.Bahce && oncekiSekme === "bahce" && S.sekme !== "bahce") {
        window.Bahce.sekme(false);
      }
      if (S.sekme === "kamera") kamSekmesi(true);
      if (window.Bahce && S.sekme === "bahce") window.Bahce.sekme(true);
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
      // Bahçe sekmesi ayrık: orada sahne ekranda hiç değil ve arka planda
      // çizmesinin sebebi yok — küçük bir bilgisayarda o boş çizim ısı.
      if (window.Tarla) window.Tarla.gorunurluk(S.sekme !== "bahce");
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
  // Kameranın aç/kapa anahtarı artık her kameranın kendi yarısında
  // (Kamera sekmesi) ve orada bağlanıyor — bkz. `kamYariBagla`.
  /* Yüzen kamera kutuları — kamera başına bir tane, hepsi bağımsız.
   * Kurulum `kamKutulariKur()` içinde; kamera listesi değiştikçe yeniden
   * çalışıyor. Burada yalnız ilk kurulumu tetikliyoruz. */
  kamKutulariKur();

  const kalibKaydet = $("#d-eksen-kalib-kaydet");
  if (kalibKaydet) kalibKaydet.onclick = () => eksenKalibGonder();
  const kalibGeri = $("#d-kalib-geri");
  if (kalibGeri) {
    // Kutulara yazılmış ama kaydedilmemiş değerleri atar: ajandan gelen
    // hâle döner.
    kalibGeri.onclick = () => {
      S.kalibElle = {}; S.kalibImza = "";
      gunluk("Kalibrasyon kutuları geri alındı");
    };
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


  // Kameranın aç/kapa, canlı ve aralık denetimleri artık her kameranın
  // KENDİ yarısında (Kamera sekmesi) ve orada bağlanıyor — bkz.
  // `kamYariBagla`. Burada bağlanacak tek kopya kalmadı.
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

  // TEYİT ÖNCE, HAREKET SONRA. Doğrudan komut göndermiyoruz: yazılımın
  // takılı uç kaydı bir ölçüm değilse önce onu teyit ettiriyoruz.
  $("#d-uc-tak").onclick = () => ucTeyitAc("tak", $("#uc-secim").value);
  $("#d-uc-birak").onclick = () => ucTeyitAc("birak", "");
  $("#d-uc-teyit-evet").onclick = ucTeyitOnayla;
  $("#d-uc-teyit-vazgec").onclick = () => ucTeyitKapat();
  $("#d-uc-teyit-duzelt").onclick = ucBeyanGonder;
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

  const gozEkle = $("#d-goz-satir-ekle");
  if (gozEkle) {
    gozEkle.onclick = () => {
      const l = gozTablosuTopla();
      // Yeni göz, son gözün 40 mm yanına: tohumluk gözleri sırada ve
      // aynı Y'de duruyor, sıfırdan koordinat yazdırmak gereksiz.
      const son = l[l.length - 1];
      l.push({ ad: `s${l.length + 1}`,
               x: son ? Number(son.x) + 40 : 0,
               y: son ? son.y : 0, z: son ? son.z : 0,
               tohum: "", dolu: true });
      gozTablosuCiz(l);
      S.gozDuzenleniyor = true;
    };
  }
  const gozKaydet = $("#d-goz-tablo-kaydet");
  if (gozKaydet) gozKaydet.onclick = gozTablosuKaydet;

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
      // retreat: iki kutudan tek alana. Çapraz eksen boşsa SAYI (tek
      // eksenli çıkış, Gantry Studio davranışı); doluysa {x, y} sözlüğü.
      retreat: (() => {
        const kayma = sayi_("retreat");             // boş = approach kullan
        const capraz = sayi_("retreat-capraz");
        if (capraz === null) return kayma;
        const kaymaX = $("#ua-slide_axis").value.toUpperCase() === "X";
        // Kayma ekseni bileşeni boşsa approach'a düşmüyoruz: sözlük
        // biçiminde iki eksen de açıkça yazılı olmalı, yoksa "yarısı
        // approach'tan yarısı buradan" gibi okunması zor bir karışım olur.
        const k = kayma === null ? Number($("#ua-approach").value || 0) : kayma;
        return kaymaX ? { x: k, y: capraz } : { x: capraz, y: k };
      })(),
      release: { dx: Number($("#ua-rel-dx").value || 0),
                 dy: Number($("#ua-rel-dy").value || 0) },
      speed: sayi_("speed", 20), slide_axis: $("#ua-slide_axis").value,
      lock_dwell: sayi_("lock_dwell", 1500),
      lock_reg: sayi_("lock_reg", 0), grip_reg: sayi_("grip_reg", 0),
      presence_reg: sayi_("presence_reg", 0), z_safe_reg: sayi_("z_safe_reg", 0),
      tc_area: {
        on: $("#ua-alan-acik").checked,
        pts: [0, 1, 2, 3].map((i) => [Number($(`#ua-k${i}x`).value), Number($(`#ua-k${i}y`).value)]),
      },
      // Tohumluk gözleri BİLEREK burada yok: kendi tablosundan
      // kaydediliyor. Buraya konsaydı "Ayarları kaydet"e basmak, ekim
      // dizisinin az önce boşalttığı gözleri ekrandaki eski hâlleriyle
      // geri yazardı.
      //
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
  const tt = $("#d-tursuz-tara");
  if (tt) tt.onclick = tursuzTara;
  const ts = $("#d-tursuz-sec");
  if (ts) ts.onclick = tursuzSec;
  const tsil = $("#d-tursuz-sil");
  if (tsil) tsil.onclick = tursuzSil;
  const tSec = $("#tepsi-secim");
  if (tSec) tSec.onchange = () => { S.tepsiSecim = []; tepsiCiz(); };
  const bagla = (kimlik, is) => { const e = $(kimlik); if (e) e.onclick = is; };
  bagla("#d-tepsi-tazele", tepsiYukle);
  bagla("#d-tepsi-ek", () => tepsiGozYaz(false));
  bagla("#d-tepsi-bosalt", () => tepsiGozYaz(true));
  bagla("#d-tepsi-ekim", () => tepsiTopluIslem("ek"));
  bagla("#d-tepsi-sula", () => tepsiTopluIslem("sula"));
  bagla("#d-tepsi-secim-temizle", () => { S.tepsiSecim = []; tepsiCiz(); });
  bagla("#d-tepsi-kayma", tepsiKaymaGonder);
  bagla("#d-sh-dene", sulamaHizalaDene);
  bagla("#d-sh-uygula", sulamaHizalaUygula);
  // `addEventListener`, `oninput =` DEĞİL. Bu iki kutuya aşağıda
  // (`details.uc-ayar input`) zaten bir işleyici bağlanıyor ve o işleyici
  // "kullanıcı düzenliyor" bayrağını kaldırıyor — atama yapsaydık onu
  // ezerdik ve kutuya yazılan sayı, sonraki durum paketinde ajanın eski
  // değeriyle geri silinirdi. (Ölçüldü: dx'e 50 yazıp dy'ye geçince dx
  // sıfıra dönüyordu.)
  $$("#ua-sb-dx, #ua-sb-dy").forEach((g) => {
    g.addEventListener("input", sulamaOfsetOrnek);
  });
  const izTur = $("#iz-tur");
  if (izTur) izTur.onchange = izgaraTurYaz;
  const izListe = $("#iz-liste");
  if (izListe) izListe.oninput = () => {
    // Liste değişti: eski önizleme başka bir şeyi anlatıyor.
    $("#izgara-onizleme").classList.add("gizli");
    $("#d-izgara-uygula").classList.add("gizli");
  };
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
  /* MEDYA TUŞLARI. Raspberry'ye bağlı küçük klavyede PageUp/PageDown yok
   * ama ses ve parça tuşları var; Z ile pompaları oradan sürüyoruz.
   *
   * UYARI: bu tuşlar tarayıcıya ULAŞMAYABİLİR. Masaüstü ortamı çoğu
   * sistemde onları kendi yakalıyor ve sayfaya hiç geçmiyor. O yüzden
   * eski bağlamalar (PageUp/PageDown) DURUYOR — medya tuşu geçmezse
   * makine yine sürülebilsin. Hangisinin çalıştığı denenerek görülür. */
  /* TUŞ SEÇİMİ, sahadaki klavyeye göre.
   *
   * Makinede Rii tipi kablosuz mini klavye var: sağda ok takımı, solda
   * medya tuşları. Medya tuşları DENENDİ VE ULAŞMADI — o tuşlar HID
   * "consumer control" kodu gönderiyor ve masaüstü ortamı onları kendi
   * yakalayıp tarayıcıya hiç vermiyor. Bağlamaları duruyor ama onlara
   * güvenmiyoruz.
   *
   * Z için `+` ve `-` seçildi: klavyenin sol alt köşesinde, sağ başparmak
   * ok takımındayken sol başparmakla basılıyor. Bunlar sıradan tuşlar,
   * her sistemde sayfaya ulaşıyor.
   *
   * Aynı tuşun iki yazılışı da bağlı: `=` ve `+` fiziksel olarak aynı tuş
   * (Shift'li/Shift'siz), kullanıcı hangisine basarsa bassın çalışsın. */
  /* FİZİKSEL TUŞA bağlıyoruz (`event.code`), ürettiği harfe değil.
   *
   * İlk sürüm `key` ile bağlanmıştı ve sahada çalışmadı: klavyenin
   * üstünde `-` ve `=+` yazıyor ama Türkçe Q düzeninde o tuşlar `*` ve
   * `-` üretiyor. `key` düzenle birlikte değişiyor, `code` değişmiyor —
   * `Minus` her düzende aynı fiziksel tuş.
   *
   * Ok tuşlarında ikisi de aynı olduğu için orada fark yoktu; sorun
   * yalnız harf/işaret tuşlarında çıkıyor. */
  const KOD_TUS = {
    ArrowRight: ["x", 1], ArrowLeft: ["x", -1],
    ArrowUp: ["y", 1], ArrowDown: ["y", -1],
    // Klavyede `-` ve `=+` yazan tuşlar. Etiketiyle uyumlu: eksi aşağı.
    Equal: ["z", 1], Minus: ["z", -1],
    NumpadAdd: ["z", 1], NumpadSubtract: ["z", -1],
    PageUp: ["z", 1], PageDown: ["z", -1],
  };
  /* Harfe göre yedek: bazı tarayıcılar/uzaktan masaüstü katmanları `code`
   * doldurmuyor. İkisi birden bakılıyor, hangisi tutarsa. */
  const TUS = {
    "+": ["z", 1], "=": ["z", 1], "*": ["z", 1],
    "-": ["z", -1], _: ["z", -1],
    AudioVolumeUp: ["z", 1], AudioVolumeDown: ["z", -1],
  };
  /* TUŞ SINAYICI. Hangi tuşun tarayıcıya ULAŞTIĞI cihazdan cihaza
   * değişiyor: medya tuşları sahadaki klavyede hiç gelmedi. Tahmin
   * etmek yerine ölçmek için, kutuya odaklanıp bir tuşa basınca o tuşun
   * tarayıcıdaki ADI yazılıyor. Bize o adı söyleyen kullanıcı, istediği
   * tuşu bağlatabiliyor. */
  const sinaKutu = $("#tus-sinama");
  if (sinaKutu) {
    sinaKutu.addEventListener("keydown", (o) => {
      o.preventDefault();
      sinaKutu.value = `${o.key}   (code: ${o.code})`;
    });
  }

  const jogDugmesi = (eksen, yon) =>
    document.querySelector(`.jog[data-eksen="${eksen}"][data-yon="${yon}"]`);

  /** KLAVYE ADIMLI SÜRÜYOR, düğmeler eskisi gibi sürekli.
   *
   * Ok tuşu `jogAcKapa` çağırıyordu: bir basış hareketi BAŞLATIYOR, ikinci
   * basış durduruyordu. Fare ile bu iyi çalışıyor — düğme basılı görünüyor
   * ve durdurmak için aynı yere basılıyor. Klavyede ise geri bildirim yok:
   * kullanıcı bir kez basıyor ve makine sınıra kadar gidiyor.
   *
   * Artık her basış SABİT BİR ADIM: konum + yön × adım. Hedef yumuşak
   * sınırın dışına düşerse sınıra kırpılıyor, yani son adım kısalıyor ama
   * komut reddedilmiyor.
   *
   * Adım yalnız KLAVYE için; ekrandaki jog düğmeleri sürekli hareket
   * davranışını koruyor. İkisi farklı işler: düğme "gözümle takip ederek
   * götür", tuş "ölçülü bir miktar ilerlet".
   */
  const adimAt = (eksen, yon) => {
    // Konumun tutulduğu yer `S.sonKonum` — durum paketinden yazılıyor.
    const k = S.sonKonum || {};
    const simdi = Number(k[eksen]);
    if (!Number.isFinite(simdi)) {
      gunluk("Konum bilinmiyor — makine bağlı mı?", "uyari");
      return;
    }
    const adim = tusAdimi();
    const s = (S.sinirlar && S.sinirlar[eksen]) || {};
    let hedef = simdi + yon * adim;
    if (s.min != null) hedef = Math.max(Number(s.min), hedef);
    if (s.max != null) hedef = Math.min(Number(s.max), hedef);
    if (Math.abs(hedef - simdi) < 0.05) {
      gunluk(`${eksen.toUpperCase()} zaten sınırda`, "uyari");
      return;
    }
    komutGonder("git", { [eksen]: Number(hedef.toFixed(2)) });
  };

  /** Tuş adımı (mm) — kutudan, tarayıcıda saklanıyor. */
  const tusAdimi = () => {
    const el = $("#tus-adimi");
    const v = el ? Number(String(el.value).replace(",", ".")) : NaN;
    return Number.isFinite(v) && v > 0 ? Math.min(200, v) : 10;
  };
  const adimKutu = $("#tus-adimi");
  if (adimKutu) {
    try {
      const kayit = localStorage.getItem("farmbot_tus_adimi");
      if (kayit) adimKutu.value = kayit;
    } catch { /* boş */ }
    adimKutu.addEventListener("change", () => {
      try { localStorage.setItem("farmbot_tus_adimi", adimKutu.value); } catch { /* boş */ }
    });
  }

  document.addEventListener("keydown", (olay) => {
    // Kısayollar yalnızca Sür sekmesinde: başka sekmede yazı yazarken ok
    // tuşunun makineyi hareket ettirmesi kabul edilemez.
    // Yazı yazarken hiçbir kısayol çalışmıyor — bu her şeyden önce gelir.
    if (olay.target.tagName === "INPUT" || olay.target.tagName === "SELECT"
        || olay.target.isContentEditable) return;

    /* ACİL DURDURMA HER SAYFADA. Önce sayfa denetiminin ARDINDA duruyordu,
     * yani Tarla ya da Ayarlar'dayken boşluk hiçbir şey yapmıyordu. Acil
     * durdurmanın "yanlış sekmedesiniz" diye çalışmaması kabul edilemez;
     * makine sürerken kullanıcının hangi sekmede olduğu tesadüf. */
    if (olay.code === "Space") { olay.preventDefault(); $("#d-acil").click(); return; }

    // Kalan kısayollar yalnız Sür sekmesinde: başka sekmede ok tuşu
    // sayfayı kaydırmak için kullanılıyor olabilir.
    if (!$("#sayfa-sur").classList.contains("etkin")) return;
    if (olay.key === "Escape") { olay.preventDefault(); jogDurdur(); return; }
    /* Pompalar ve panel kısayolları.
     *
     * Pompa AÇIP KAPATIYOR, yani tek tuşla su akıtabiliyor. Bilerek
     * böyle: kullanıcı makinenin başında ve elini klavyeden kaldırmadan
     * pompayı kesebilmek istiyor. Ne olduğu günlüğe yazılıyor — sessizce
     * açılan bir pompa fark edilmezse taşma demek. */
    // Harf tuşları da FİZİKSEL koddan: `KeyS` her düzende aynı tuş.
    // Türkçe Q'da S ve H yerinde duruyor ama kural aynı kalsın.
    const ROLE_KOD = { KeyS: "su_pompasi", KeyH: "hava_pompasi" };
    const ROLE_TUS = {
      s: "su_pompasi", S: "su_pompasi",
      h: "hava_pompasi", H: "hava_pompasi",
      MediaTrackNext: "su_pompasi",
      MediaTrackPrevious: "hava_pompasi",
    };
    const role = ROLE_KOD[olay.code] || ROLE_TUS[olay.key];
    if (role) {
      olay.preventDefault();
      if (olay.repeat) return;
      const d = $(`.dugme.role[data-role="${role}"]`);
      if (d) { d.click(); gunluk(`⌨ ${role} tuşla değiştirildi`, "bilgi"); }
      return;
    }

    /* İşlev tuşları — makineyi HAREKET ETTİRMEYEN işler.
     *
     * F1, F5, F11 ve F12 tarayıcının kendi işleri (yardım, yenile, tam
     * ekran, geliştirici araçları) ve engellenmeleri güvenilir değil;
     * onlara dokunmuyoruz. Kalanlar boş.
     *
     * Hiçbiri makineyi sürmüyor: tek tuşla ekseni yürütmek ok tuşlarında
     * bilinçli bir tercih ama işlev tuşlarında kaza olur. */
    const ISLEV = {
      // F2/F3 kamera sekmesine ve ORADAKİ ilk kameranın çözümle
      // düğmesine gidiyor; kamera denetimleri artık orada.
      F2: ['nav.sekmeler button[data-sayfa="kamera"]', "Kamera sekmesi"],
      F3: ['#kam-tahta .kam-yari [data-rol="coz"]', "Kare çözümleme"],
      F4: ["#d-gorunum-2b", "2B görünüm"],
      F6: ["#d-gorunum-3b", "3B görünüm"],
    };
    const islev = ISLEV[olay.key];
    if (islev) {
      olay.preventDefault();
      if (olay.repeat) return;
      const e = $(islev[0]);
      if (e) { e.click(); gunluk(`⌨ ${islev[1]}`, "bilgi"); }
      else gunluk(`⌨ ${islev[1]} bu sayfada yok`, "uyari");
      return;
    }

    const eslesme = KOD_TUS[olay.code] || TUS[olay.key];
    if (!eslesme) return;
    olay.preventDefault();
    if (olay.repeat) return;
    adimAt(eslesme[0], eslesme[1]);
  });
}

/* --------------------------------------------------- kalibrasyon tablosu
 * Salt okunur. Amaç "panelde şu yazıyor ama makine başka gidiyor"
 * tartışmasını bitirmek: ajanın o an hangi katsayılarla çalıştığı görünsün.
 */
function kalibrasyonCiz(d) {
  const govde = $("#kalib-govde");
  if (!govde) return;
  /* TABLO CANLI KALIR, YAZILAN KORUNUR.
   *
   * Sorun şuydu: kullanıcı kutuya yazıp başka bir yere tıklayınca odak
   * gidiyor, ilk durum paketinde tablo yeniden kuruluyor ve yazdığı değer
   * siliniyordu. Ekranda hiçbir hata çıkmıyor, sayı kayboluyordu —
   * "değer yazamıyorum" bunun gibi görünür.
   *
   * İlk çözüm bir "kirli" bayrağıydı: bir kutuya dokunulduğu anda tablo
   * donduruluyordu. Ama kayıt başarısız olursa ya da bayrak bir yerde
   * temizlenmeden kalırsa tablo SONSUZA KADAR donuyor — sessiz ve daha
   * kötü bir hata. Denemede tam bu görüldü.
   *
   * Doğrusu: tablo her zaman tazelenir, kullanıcının ELLE GİRDİĞİ kutular
   * yeniden yazıldıktan sonra geri konur. Böylece ne donma olur ne kayıp;
   * ajandan gelen yeni değerler de görünmeye devam eder. */
  if (document.activeElement && document.activeElement.classList
      && document.activeElement.classList.contains("kalib-girdi")) return;
  const imza = JSON.stringify([d.kalibrasyon || null, d.sinirlar || null, d.guvenli_z]);
  if (imza === S.kalibImza) return;
  S.kalibImza = imza;

  const k = d.kalibrasyon, sn = d.sinirlar;
  if (!k || !sn) {
    govde.innerHTML = '<tr><td colspan="6" class="alt-not">Ajan bağlanınca dolacak.</td></tr>';
    return;
  }
  // cpm ve dir metin, home/min/max girdi. Ayrım bilinçli: yanlış cpm
  // yanlış MESAFE gitmek demek ve panelden yanlışlıkla değiştirilmemeli.
  govde.innerHTML = ["x", "y", "z"].map((e) => {
    const c = k[e] || {}, s = sn[e] || {};
    /* METİN girdi, `number` DEĞİL.
     *
     * `type="number"` Türkçe klavyede virgülü reddediyor: "414,23" yazan
     * kullanıcının alanı boş kalıyor, hiçbir hata da görünmüyor — "değer
     * yazamıyorum" şikâyetinin en olası sebebi bu. Ayrıca tarayıcı
     * `step` ile uyuşmayan ara değerleri de sessizce geçersiz sayıyor ve
     * odaklı bir sayı alanının üstünde tekerlek çevirmek değeri
     * değiştiriyor.
     *
     * Metin alanında böyle bir sürpriz yok; virgülü noktaya kaydederken
     * çeviriyoruz. `inputmode="decimal"` dokunmatikte sayı klavyesi
     * açıyor — Pi'nin ekranında bu fark ediyor. */
    const kutu = (alan, deger) =>
      `<td><input type="text" inputmode="decimal" class="kalib-girdi" `
      + `data-eksen="${e}" data-alan="${alan}" `
      + `value="${deger == null ? "" : deger}"></td>`;
    return `<tr><td><b>${e.toUpperCase()}</b></td>
      <td>${sayi(c.cpm, 4)}</td><td>${c.dir > 0 ? "+1" : "−1"}</td>
      ${kutu("home", c.home)}${kutu("min", s.min)}${kutu("max", s.max)}</tr>`;
  }).join("");
  // Elle girilmiş kutuları geri koy ve yenilerini izlemeye al.
  $$("#kalib-govde .kalib-girdi").forEach((el) => {
    const anahtar = `${el.dataset.eksen}.${el.dataset.alan}`;
    if (S.kalibElle[anahtar] !== undefined) el.value = S.kalibElle[anahtar];
    el.addEventListener("input", () => { S.kalibElle[anahtar] = el.value; });
    /* KUTUDAN ÇIKINCA KENDİLİĞİNDEN KAYDET.
     *
     * Değeri yazıp Kaydet'e basmayı hatırlamak zorunda kalmak panelin
     * işi değil; hatırlamayınca da hiçbir şey söylemiyordu — kullanıcı
     * sınırı değiştirdiğini sanarken eski sınır yürürlükte kalıyordu.
     * `change` yalnız değer GERÇEKTEN değiştiyse ve odak kutudan
     * çıkınca (ya da Enter'a basılınca) tetikleniyor, yani her tuş
     * vuruşunda ajana komut gitmiyor. */
    el.addEventListener("change", () => eksenKalibGonder());
  });
  $("#kalib-ek").innerHTML =
    `Güvenli Z yüksekliği: <b>${sayi(d.guvenli_z, 0)} mm</b> — X/Y hareketi için ` +
    `Z'nin bulunması gereken en düşük yükseklik. Hız: <b>${sayi(d.hiz, 0)} mm/s</b>.`;
}

/* -------------------------------------------------- eksen kalibrasyonu
 *
 * İKİ DÜĞME AYNI KİMLİĞİ TAŞIYORDU. Kamera kalibrasyonunun Kaydet'i de
 * `d-kalib-kaydet` idi ve `querySelector` ilkini döndürüyor: eksen
 * tablosunun düğmesine hiçbir işleyici bağlanmıyordu. Kullanıcı sınırı
 * yazıp Kaydet'e basıyor, hiçbir şey olmuyor, hata da görünmüyordu.
 * Kimlikler ayrıldı; ayrıca kutudan çıkmak artık tek başına yetiyor.
 */
let _kalibGonderiliyor = false;

async function eksenKalibGonder() {
  // Kutudan kutuya geçerken üst üste binmesin: `change` ile düğme aynı
  // anda tetiklenebiliyor ve ikinci istek birincinin yazdığını okumuyor.
  if (_kalibGonderiliyor) return;
  _kalibGonderiliyor = true;
  try {
    const eksenler = ["x", "y", "z"].map((e) => {
      const al = (alan) => {
        const el = document.querySelector(
          `.kalib-girdi[data-eksen="${e}"][data-alan="${alan}"]`);
        // Virgül -> nokta: Türkçe klavyede ondalık ayırıcı virgül ve
        // kullanıcının "414,23" yazması en doğal hâli.
        const v = el ? el.value.trim().replace(",", ".") : "";
        if (v === "") return null;
        const s = Number(v);
        return Number.isFinite(s) ? s : null;
      };
      return { home: al("home"), min: al("min"), max: al("max") };
    });
    const uyariKutu = $("#kalib-hata");
    if (uyariKutu) { uyariKutu.textContent = ""; uyariKutu.classList.add("gizli"); }
    const sonuc = await komutGonder("kalibrasyon_kaydet", { eksenler });
    /* RET SEBEBİ TABLONUN YANINDA. Ajan geçersiz bir değeri reddedince
     * mesaj yalnızca alttaki KAPALI olay günlüğüne düşüyordu; kullanıcı
     * hiçbir şey görmüyor, yazdığı değerin "silindiğini" sanıyordu. */
    if (sonuc && sonuc.ok === false && uyariKutu) {
      uyariKutu.textContent = sonuc.mesaj || "Kaydedilemedi";
      uyariKutu.classList.remove("gizli");
    }
    // Kayıt başarılıysa elle girilenler artık ajanın değeri; tabloyu
    // ondan tazelesin diye izi siliyoruz. İmza da sıfırlanmalı, yoksa
    // tablo eski imzayla aynı kalıp tazelenmiyor.
    if (sonuc && sonuc.ok) {
      S.kalibElle = {}; S.kalibImza = "";
      kalibKaydedildiIsareti();
    }
  } finally {
    _kalibGonderiliyor = false;
  }
}

/** Kısa ömürlü "Kaydedildi" — tablonun yanında.
 *
 * Olay günlüğü kapalıyken kaydın işlediğini gösteren HİÇBİR ŞEY yoktu:
 * başarı da başarısızlık da aynı görünüyordu. */
function kalibKaydedildiIsareti() {
  const el = $("#kalib-kaydedildi");
  if (!el) return;
  el.textContent = "Kaydedildi";
  el.classList.remove("gizli");
  clearTimeout(kalibKaydedildiIsareti._zaman);
  kalibKaydedildiIsareti._zaman = setTimeout(
    () => el.classList.add("gizli"), 2500);
}

/* --------------------------------------------------------------- köprü
 * `tarla.js` ayrı bir dosya ve buranın iç değişkenlerine dokunmuyor; ihtiyacı
 * olan birkaç şey burada açıkça dışarı veriliyor. Böylece iki dosya arasındaki
 * bağ tek satırda görülebiliyor.
 */
window.Panel = { S, komutGonder, apiIste, gunluk, noktalariYukle, egrileriYukle,
                 geriAlGoster, tanilariCiz,
                 /* Deneme yardımcısı — kalibrasyon gönderimini tarayıcı
                  * konsolundan tetiklemek için. `tarla.js`teki
                  * `secimDurumu()` ile aynı gerekçe. */
                 eksenKalibGonder };

/** Çalışan sürümü şeride yazar.
 *
 * Sunucudan geliyor, HTML'e gömülü değil: gömülü olsaydı tarayıcı eski
 * index.html'i önbellekten verdiğinde damga da eskisini gösterir ve tam
 * olarak çözmesi gereken soruyu yanıltırdı. */
async function surumYaz() {
  const el = $("#surum-damga");
  if (!el) return;
  try {
    const y = await apiIste("/api/surum");
    el.textContent = y.surum || "";
  } catch { el.textContent = ""; }
}

/* -------------------------------------------------------------------- açılış */
async function basla() {
  $("#uygulama").classList.remove("gizli");
  surumYaz();
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
  // Sayfa açılırken zaten kare varsa hemen göster — HER KAMERA İÇİN
  // ayrı ayrı, yoksa yalnızca son kare gelen kameranın kutusu açılırdı.
  try {
    const k = await apiIste("/api/kare/liste");
    const sonlar = {};
    (k.kareler || []).forEach((kare) => {
      const ad = kare.kamera || "uc";
      if (!sonlar[ad] || kare.ts > sonlar[ad]) sonlar[ad] = kare.ts;
    });
    Object.entries(sonlar).forEach(([ad, ts]) => kareyiTazele(ts, false, ad));
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
