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
  dakika: 60,
  ws: null,
  jogAktif: null,        // {eksen, yon, dugme} — şu an basılı tutulan jog
  jogSayac: null,        // yenileme zamanlayıcısı
  enable: false,
  grafikler: {},
  roleDurum: { su_pompasi: false, hava_pompasi: false, su_vanasi: false },
  noktalar: [],
  bolgeler: [],
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
  otoDuzenleniyor: false,   // kullanıcı ayarla oynarken ölçüm üstüne yazmasın
  sonKonum: null,
  ajanBagli: false,
  satirlar: [],          // tablo görünümü için son ölçümler
  sonZaman: 0,
};

const $ = (secici) => document.querySelector(secici);
const $$ = (secici) => Array.from(document.querySelectorAll(secici));

// Grafik renkleri CSS'ten okunuyor: tema tek yerden değişsin.
const kok = getComputedStyle(document.documentElement);
const RENK = {
  seri1: kok.getPropertyValue("--seri-1").trim(),
  seri2: kok.getPropertyValue("--seri-2").trim(),
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

/** HW-103 ham ADC değerini yüzdeye çevirir.
 *  Sensör kuruyken ~1023, suyun içinde ~0 okuyor; yani ham değer arttıkça
 *  nem AZALIYOR. Ham sayıyı panelde göstermek yanıltıcı olurdu. */
const toprakYuzde = (ham) =>
  ham === null || ham === undefined ? null : Math.max(0, Math.min(100, ((1023 - ham) / 1023) * 100));

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
const ADIM_TIPLERI = { nokta: "Noktaya git", bekle: "Bekle", role: "Röle", servo: "Servo", uc: "Uç değiştir" };
const ROLELER = ["su_pompasi", "hava_pompasi", "su_vanasi"];

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
  } else if (adim.tip === "servo") {
    param = `<input type="number" class="param p-aci" min="0" max="180" value="${adim.aci ?? 90}">°`;
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
    if (tip === "servo") adim.aci = Number(el.querySelector(".p-aci").value);
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
}

function kameraDurumYaz(k) {
  const anahtar = $("#a-kamera");
  const not = $("#kamera-durum");
  if (!anahtar || !not) return;
  const acik = !!(k && k.acik);
  // Kullanici anahtari surukluyorken altindan degistirmeyelim.
  if (document.activeElement !== anahtar) anahtar.checked = acik;
  anahtar.disabled = !k;
  if (!k) { not.textContent = "—"; return; }
  const sn = k.aralik_sn || 3600;
  const aralik = sn >= 3600 ? `${Math.round(sn / 3600)} saatte`
    : sn >= 60 ? `${Math.round(sn / 60)} dakikada`
    : `${Math.round(sn)} saniyede`;
  not.textContent = acik ? `açık · ${k.yontem || "?"} · ${aralik} bir kare` : "kapalı";

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

// Kare WebSocket'ten gelmiyor; sunucu haber veriyor, tarayıcı <img> ile
// çekiyor. Böylece büyük base64 dizeleri panel soketini tıkamıyor.
function kareyiTazele(ts) {
  const adres = `/api/kare/son?jeton=${encodeURIComponent(S.jeton)}&t=${ts || Date.now()}`;
  const img = $("#kamera-kare");
  img.src = adres;
  img.classList.remove("gizli");
  $("#kamera-yok").classList.add("gizli");
  $("#kamera-zaman").textContent = "Son kare: " + new Date((ts || Date.now() / 1000) * 1000).toLocaleTimeString("tr-TR");
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
        borderColor: sira === 0 ? RENK.seri1 : RENK.seri2,
        backgroundColor: "transparent",
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,          // 8 px çap — dokunmatikte de tutulabilir
        pointHoverBorderWidth: 2,
        pointHoverBorderColor: RENK.yuzey,   // üst üste binen noktalar ayrışsın
        pointHoverBackgroundColor: sira === 0 ? RENK.seri1 : RENK.seri2,
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
  S.grafikler.servo = grafikYap("g-servo", [{ ad: "Vana açısı" }], "°", 0,
                                { enAz: 90, sinir: [0, 180] });
  // Vana açısı 0/90 arasında zıplayan bir kontrol sinyali; yumuşatma yanlış
  // olur, adım basamağı gerçeğe daha yakın.
  S.grafikler.servo.data.datasets[0].stepped = true;
  S.grafikler.servo.data.datasets[0].tension = 0;
}

async function gecmisYukle() {
  const yanit = await fetch(`/api/gecmis?dakika=${S.dakika}&jeton=${encodeURIComponent(S.jeton)}`);
  if (!yanit.ok) { gunluk("✕ Geçmiş verisi alınamadı", "hata"); return; }
  const v = await yanit.json();
  const uzun = S.dakika > 720;
  const etiketler = v.ts.map((ts) => saatEtiketi(ts, uzun));

  const ata = (grafik, diziler) => {
    grafik.data.labels = etiketler;
    diziler.forEach((dizi, sira) => { grafik.data.datasets[sira].data = dizi; });
    grafik.update("none");
  };

  // Geçmişte bir kez bile değer görülen kanal "var" sayılıyor.
  for (const [ad, dizi] of Object.entries(v)) {
    if (ad !== "ts" && Array.isArray(dizi) && dizi.some((x) => x !== null && x !== undefined)) {
      KANAL_VAR[ad] = true;
    }
  }

  ata(S.grafikler.sicaklik, [v.hava_sicaklik, v.bmp_sicaklik]);
  ata(S.grafikler.nem, [v.hava_nem, v.toprak_nem.map(toprakYuzde)]);
  ata(S.grafikler.basinc, [v.basinc]);
  ata(S.grafikler.servo, [v.servo_aci]);

  // Tablo görünümü aynı veriden besleniyor (en yeni üstte).
  S.satirlar = v.ts.map((ts, i) => ({
    ts,
    hava_sicaklik: v.hava_sicaklik[i], bmp_sicaklik: v.bmp_sicaklik[i],
    hava_nem: v.hava_nem[i], toprak_nem: v.toprak_nem[i],
    basinc: v.basinc[i], servo_aci: v.servo_aci[i],
  })).slice(-300);
  tabloCiz();
  S.sonZaman = v.ts.length ? v.ts[v.ts.length - 1] : 0;
  gorunurlukGuncelle();
}

function noktaEkle(olcum) {
  S.satirlar.push(olcum);
  if (S.satirlar.length > 300) S.satirlar.shift();
  tabloCiz();
  if (!S.grafikler.sicaklik) return;

  const uzun = S.dakika > 720;
  const etiket = saatEtiketi(olcum.ts, uzun);
  // Ekrandaki nokta sayısını sınırlıyoruz: sekme saatlerce açık kalırsa
  // dizi büyümeye devam eder ve grafik yavaşlar.
  const sinir = 900;

  const it = (grafik, degerler) => {
    grafik.data.labels.push(etiket);
    degerler.forEach((deger, sira) => grafik.data.datasets[sira].data.push(deger ?? null));
    if (grafik.data.labels.length > sinir) {
      grafik.data.labels.shift();
      grafik.data.datasets.forEach((ds) => ds.data.shift());
    }
    grafik.update("none");
  };

  it(S.grafikler.sicaklik, [olcum.hava_sicaklik, olcum.bmp_sicaklik]);
  it(S.grafikler.nem, [olcum.hava_nem, toprakYuzde(olcum.toprak_nem)]);
  it(S.grafikler.basinc, [olcum.basinc]);
  it(S.grafikler.servo, [olcum.servo_aci]);
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
      `<td>${sayi(s.basinc)}</td><td>${sayi(s.servo_aci, 0)}</td></tr>`
    );
  }
  govde.innerHTML = parcalar.join("");
}

/* ----------------------------------------------------------------- kartlar */
function kartlariGuncelle(o) {
  if (!o) return;
  if (kanallariTara(o)) gorunurlukGuncelle();
  $("#d-sicaklik").innerHTML = `${sayiCoz(o.hava_sicaklik)}<span class="birim">°C</span>`;
  $("#d-nem").innerHTML = `${sayiCoz(o.hava_nem)}<span class="birim">%</span>`;
  $("#d-toprak").innerHTML = `${sayi(toprakYuzde(o.toprak_nem), 0)}<span class="birim">%</span>`;
  $("#d-basinc").innerHTML = `${sayi(o.basinc)}<span class="birim">hPa</span>`;
  $("#d-servo").innerHTML = `${sayi(o.servo_aci, 0)}<span class="birim">°</span>`;

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
  $("#a-toprak").textContent = o.toprak_nem == null ? "HW-103"
    : `HW-103${hamEk("toprak_nem")}`;
  // "BMP180" yerine "BMP": sıcaklık kartında da öyle kısaltılıyor ve
  // satır tek satırda kalıyor.
  $("#a-rakim").textContent = o.rakim == null ? "BMP180"
    : `BMP${hamEk("basinc", 2)} · ${sayi(o.rakim, 0)} m`;
  $("#a-sicaklik").textContent = o.bmp_sicaklik == null ? dhtAd + hamEk("hava_sicaklik")
    : `${dhtAd}${hamEk("hava_sicaklik")} · BMP ${sayi(o.bmp_sicaklik)}`;
  $("#a-servo").textContent = Number(o.servo_aci) > 5 ? "SG-5010 · AÇIK" : "SG-5010 · kapalı";
  if (o.ts) $("#a-servo").title = new Date(o.ts * 1000).toLocaleString("tr-TR");
  donanimGuncelle(o);
  otoAyarGuncelle(o);
  if (o.kip) kipGuncelle(o.kip);
}

/* ---------------------------------------------------- bağlı olmayan donanım
 * Arduino hangi çıkışların fiilen takılı olduğunu bildiriyor (`servo_var`,
 * `role_var`). Takılı olmayan bir düğmeyi tıklanabilir bırakmak, komutu
 * gönderip hiçbir şey olmadığını görmek demek; sebebini söyleyip kapatmak
 * daha dürüst. Alan hiç gelmiyorsa (eski firmware) hiçbir şeye dokunmuyoruz.
 */
function donanimGuncelle(o) {
  const AC = "Donanım bağlanınca sketch'te ilgili satırı 1 yapın: ";
  if (o.servo_var !== undefined) {
    const var_ = Number(o.servo_var) === 1;
    $("#servo-kaydirac").disabled = !var_;
    $("#d-servo-uygula").disabled = !var_;
    // Kritik uyarı ekranda kalır; "her şey normal" durumunda hiçbir şey
    // yazmıyoruz — açıklama zaten başlığın yanındaki "?" içinde.
    $("#servo-not").innerHTML = var_ ? ""
      : `<b>Vana servosu bağlı değil.</b> ${AC}<code>SERVO_BAGLI 1</code>`;
    $("#servo-not").classList.toggle("gizli", var_);
  }
  if (o.role_var !== undefined) {
    const var_ = Number(o.role_var) === 1;
    $$(".dugme.role").forEach((d) => { d.disabled = !var_; });
    $("#role-not").innerHTML = var_ ? ""
      : `<b>Röleler bağlı değil.</b> ${AC}<code>ROLELER_BAGLI 1</code>`;
    $("#role-not").classList.toggle("gizli", var_);
  }
  // Otomatik sulama çıkış listesi: bağlı olmayanlar seçilemesin.
  const secim = $("#oto-cikis");
  if (!secim || o.servo_var === undefined) return;
  const bagli = { servo: Number(o.servo_var) === 1, su_vanasi: Number(o.role_var) === 1,
                  su_pompasi: Number(o.role_var) === 1, yok: true };
  Array.from(secim.options).forEach((s) => {
    const acik = bagli[s.value];
    s.disabled = !acik;
    const ek = " (bağlı değil)";
    const temiz = s.textContent.replace(ek, "");
    s.textContent = acik ? temiz : temiz + ek;
  });
}

/* ------------------------------------------------- otomatik sulama (Arduino)
 * Ayarların kaynağı Arduino: eşik ve çıkış seçimi orada EEPROM'da duruyor ve
 * her ölçüm satırında geri geliyor. Panel bir kopya tutmuyor — tuttuğu anda
 * "panelde şu yazıyor ama kart başka şey yapıyor" durumu doğardı.
 */
function kipGuncelle(kip) {
  if (!kip) return;
  S.kip = kip;
  const oto = kip === "oto";
  $("#d-kip-oto").classList.toggle("secili", oto);
  $("#d-kip-manuel").classList.toggle("secili", !oto);
  const rozet = $("#kip-rozet");
  if (rozet) {
    // Sürülecek çıkış yokken "AÇIK" demek yanıltıcı: kip açık olabilir ama
    // ortada açılacak bir vana yok.
    const cikisYok = $("#oto-cikis") && $("#oto-cikis").disabled;
    rozet.textContent = cikisYok ? "çıkış yok"
      : oto ? "AÇIK — kararı Arduino veriyor" : "KAPALI — kararı panel veriyor";
    rozet.className = `rozet-kip ${cikisYok ? "kapali" : oto ? "acik" : "kapali"}`;
  }
}

function otoAyarGuncelle(o) {
  const cikis = $("#oto-cikis"), esik = $("#oto-esik");
  if (!cikis || !esik) return;
  // Alanlar hiç gelmiyorsa iki ayrı sebep olabilir ve ikisi farklı şey
  // söylüyor: kartta sürülecek donanım yoksa bu normaldir, varsa yazılım
  // eskidir. İkisini "yazılım eski" diye tek torbaya koymak, sensör-only
  // kurulumda ortada hata yokken hata var gibi görünmesine yol açıyordu.
  if (o.oto_cikis === undefined && o.esik === undefined) {
    const donanimYok = Number(o.servo_var) === 0 && Number(o.role_var) === 0;
    $("#oto-not").innerHTML = donanimYok
      ? "<b>Sürülecek çıkış yok</b> — vana ve röleler bağlı değil."
      : "<b>Karttaki yazılım eski</b> — <code>farmbot_sensors</code> sketch'ini yükleyin.";
    cikis.disabled = esik.disabled = $("#d-oto-kaydet").disabled = true;
    // Rozet metni "çıkış var mı"ya bağlı; kilit yeni konduğu için tazeliyoruz.
    if (S.kip) kipGuncelle(S.kip);
    return;
  }
  cikis.disabled = esik.disabled = $("#d-oto-kaydet").disabled = false;
  if (S.otoDuzenleniyor) return;         // kullanıcı oynuyorsa üstüne yazma
  if (o.oto_cikis) cikis.value = o.oto_cikis;
  if (o.esik != null) {
    const yuzde = Math.round(toprakYuzde(Number(o.esik)));
    esik.value = yuzde;
    $("#oto-esik-etiket").textContent = `%${yuzde}`;
  }
  const acik = Number(o.oto_acik) === 1;
  $("#oto-not").innerHTML = S.kip === "oto"
    ? (cikis.value === "yok"
       ? "Otomatik kip açık ama çıkış <b>Yok</b> — hiçbir şey sürülmüyor."
       : acik ? `Şu anda <b>sulama açık</b> (${cikis.options[cikis.selectedIndex].text}).`
              : "Toprak yeterince nemli — sulama kapalı.")
    : "Manuel kipte bu ayarlar beklemede.";
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
  rozetYaz("#rozet-ajan", d.bagli ? "canli" : "kopuk", d.bagli ? "Raspberry Pi bağlı" : "Raspberry Pi çevrimdışı");

  const acilAcik = d.acil && d.acil.acik;
  const plcSinif = d.plc === "bagli" ? (acilAcik ? "kopuk" : "canli") : d.plc === "kopuk" ? "kopuk" : "";
  const plcMetin = d.plc !== "bagli" ? `PLC: ${d.plc}`
    : acilAcik ? "PLC: ACİL DURDURMA"
    : d.hareket ? "PLC: hareket ediyor"
    : d.enable ? "PLC: hazır" : "PLC: sürücüler kapalı";
  rozetYaz("#rozet-plc", plcSinif, plcMetin);
  // Kip ışığı: oto = yeşil, manuel = sarı, BİLİNMİYOR = gri.
  // Eskiden "manuel değilse yeşil" deniyordu; ajan çevrimdışıyken kip
  // "bilinmiyor" oluyor ve ışık YEŞİL yanıyordu — makineyle hiç konuşulamazken
  // "her şey yolunda" diyen bir ışık, yanlış bilginin en kötü türü.
  const kipSinif = !d.bagli || !d.kip || d.kip === "bilinmiyor" ? ""
                 : d.kip === "manuel" ? "uyari-rengi" : "canli";
  rozetYaz("#rozet-kip", kipSinif, `Kip: ${d.kip || "—"}`);
  kipGuncelle(d.kip);

  kameraDurumYaz(d.kamera);

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
  $$("#d-git, #d-home, [data-home], #d-dur, #d-servo-uygula, .role").forEach((b) => { b.disabled = kilit; });
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
    S.roleDurum = { su_pompasi: false, hava_pompasi: false, su_vanasi: false };
    $$(".role").forEach((b) => b.classList.remove("secili"));
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

  const kaydirac = $("#servo-kaydirac");
  kaydirac.oninput = () => { $("#servo-etiket").textContent = `${kaydirac.value}°`; };
  $("#d-servo-uygula").onclick = () => komutGonder("servo", { aci: Number(kaydirac.value) });
  $("#d-kip-oto").onclick = () => komutGonder("kip", { deger: "oto" });
  $("#d-kip-manuel").onclick = () => komutGonder("kip", { deger: "manuel" });

  // Otomatik sulama ayarları
  const esikKaydirac = $("#oto-esik");
  esikKaydirac.oninput = () => {
    S.otoDuzenleniyor = true;
    $("#oto-esik-etiket").textContent = `%${esikKaydirac.value}`;
  };
  $("#oto-cikis").onchange = () => { S.otoDuzenleniyor = true; };
  $("#d-oto-kaydet").onclick = async () => {
    const cikis = $("#oto-cikis").value;
    const yuzde = Number(esikKaydirac.value);
    // Panel yüzde gösteriyor, Arduino ham ADC ile karşılaştırıyor: çeviri
    // burada, tek yerde. toprakYuzde'nin tersi.
    const ham = Math.round(1023 - (yuzde / 100) * 1023);
    await komutGonder("oto_cikis", { ad: cikis });
    await komutGonder("oto_esik", { ham });
    S.otoDuzenleniyor = false;
  };

  $$(".role").forEach((dugme) => {
    dugme.onclick = async () => {
      const ad = dugme.dataset.role;
      const yeni = !S.roleDurum[ad];
      const sonuc = await komutGonder("role", { ad, durum: yeni });
      if (sonuc && sonuc.ok) {
        S.roleDurum[ad] = yeni;
        dugme.classList.toggle("secili", yeni);
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
