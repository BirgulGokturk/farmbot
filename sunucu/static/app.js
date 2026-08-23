/* Farmbot paneli — canlı veri, grafikler ve hareket kontrolü.
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
  const kutu = $("#gunluk");
  const satir = document.createElement("div");
  if (sinif) satir.className = sinif;
  const zaman = new Date().toLocaleTimeString("tr-TR");
  satir.innerHTML = `<time>${zaman}</time>${metin}`;
  kutu.prepend(satir);
  while (kutu.children.length > 200) kutu.lastChild.remove();
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
    gunluk(govde.ok ? `✓ ${govde.mesaj}` : `✕ ${govde.mesaj}`, govde.ok ? "ok" : "hata");
    return govde;
  } catch (hata) {
    gunluk(`✕ ${ad}: sunucuya ulaşılamadı (${hata.message})`, "hata");
    return null;
  }
}

/* ---------------------------------------------------------- basılı tut jog */
// PLC'nin jog bitleri MANDAL: 1 yazılınca eksen durmaz. Ajan bunu "kira"ya
// çevirdi — panel basılı tuttuğu sürece yeniliyor, yenileme kesilince ajanın
// bekçisi 1,2 saniyede biti düşürüyor. Bu yüzden yenilemeler WebSocket'ten
// gidiyor: her yenileme için HTTP isteği hem yavaş hem gereksiz.
const JOG_YENILEME_MS = 300;

function jogYolla(eksen, yon, basili) {
  if (!S.ws || S.ws.readyState !== WebSocket.OPEN) return;
  S.ws.send(JSON.stringify({ tip: "jog", eksen, yon, basili }));
}

function jogBasla(eksen, yon, dugme) {
  if (S.jogAktif) return;                       // aynı anda tek eksen
  if (dugme && dugme.disabled) return;
  S.jogAktif = { eksen, yon, dugme };
  if (dugme) dugme.classList.add("basili");
  jogYolla(eksen, yon, true);
  S.jogSayac = setInterval(() => jogYolla(eksen, yon, true), JOG_YENILEME_MS);
}

function jogBirak() {
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

/* ------------------------------------------------------------------ grafikler */
function grafikYap(kimlik, seriler, birim, basamak = 1) {
  const ctx = document.getElementById(kimlik);
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
          ticks: { color: RENK.metin3, font: { size: 11 }, callback: (v) => sayi(v, basamak) },
        },
      },
    },
  });
}

function grafikleriKur() {
  S.grafikler.sicaklik = grafikYap("g-sicaklik", [{ ad: "DHT11" }, { ad: "BMP180" }], "°C", 1);
  S.grafikler.nem = grafikYap("g-nem", [{ ad: "Hava nemi" }, { ad: "Toprak nemi" }], "%", 0);
  S.grafikler.basinc = grafikYap("g-basinc", [{ ad: "Basınç" }], "hPa", 1);
  S.grafikler.servo = grafikYap("g-servo", [{ ad: "Vana açısı" }], "°", 0);
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
  $("#d-sicaklik").innerHTML = `${sayi(o.hava_sicaklik)}<span class="birim">°C</span>`;
  $("#d-nem").innerHTML = `${sayi(o.hava_nem)}<span class="birim">%</span>`;
  $("#d-toprak").innerHTML = `${sayi(toprakYuzde(o.toprak_nem), 0)}<span class="birim">%</span>`;
  $("#d-basinc").innerHTML = `${sayi(o.basinc)}<span class="birim">hPa</span>`;
  $("#d-servo").innerHTML = `${sayi(o.servo_aci, 0)}<span class="birim">°</span>`;

  $("#a-toprak").textContent = o.toprak_nem == null ? "HW-103" : `HW-103 · ham ${Math.round(o.toprak_nem)}`;
  $("#a-rakim").textContent = o.rakim == null ? "BMP180" : `BMP180 · rakım ${sayi(o.rakim, 0)} m`;
  $("#a-sicaklik").textContent = o.bmp_sicaklik == null ? "DHT11" : `DHT11 · BMP ${sayi(o.bmp_sicaklik)} °C`;
  $("#a-servo").textContent = Number(o.servo_aci) > 5 ? "SG-5010 · AÇIK" : "SG-5010 · kapalı";
  if (o.ts) $("#a-servo").title = new Date(o.ts * 1000).toLocaleString("tr-TR");
}

function rozetYaz(kimlik, sinif, metin) {
  const el = $(kimlik);
  el.className = `rozet ${sinif}`;
  el.querySelector("span").textContent = metin;
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
  rozetYaz("#rozet-kip", d.kip === "manuel" ? "uyari-rengi" : "canli", `Kip: ${d.kip || "—"}`);

  const k = d.konum || {};
  const birimli = (deger) =>
    deger == null ? "—" : `${sayi(deger, 1)}<span style="font-size:13px;color:var(--metin-3)"> mm</span>`;
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

  S.enable = !!d.enable;
  $("#d-enable").textContent = d.enable ? "⚡ Sürücüleri kapat" : "⚡ Sürücüleri aç";
  $("#d-enable").classList.toggle("secili", !!d.enable);

  if (d.hiz && !$("#hiz-kaydirac").matches(":active")) {
    $("#hiz-kaydirac").value = d.hiz;
    $("#hiz-etiket").textContent = `${sayi(d.hiz, 0)} mm/s`;
  }

  // Ajan yokken hareket düğmelerini kapatıyoruz: basılıp hiçbir şey olmaması,
  // "gönderdim sandım" hatasının en sık kaynağı.
  const kilit = !d.bagli || acilAcik;
  $$("#d-git, #d-home, #d-dur, #d-servo-uygula, .role").forEach((b) => { b.disabled = kilit; });
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
    else if (m.tip === "gunluk") gunluk(m.metin, m.seviye === "hata" ? "hata" : "");
  };

  ws.onclose = () => {
    // Soket kapandıysa "bırak" paketi gidemez; düğmeyi görsel olarak da
    // bırakıyoruz. Eksen zaten ajanın kira bekçisiyle 1,2 sn'de duruyor.
    jogBirak();
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
      // Gizliyken çizilen grafik yanlış ölçüde kalıyor; sekmeye dönünce tazele.
      Object.values(S.grafikler).forEach((g) => g.resize());
    };
  });

  $$(".aralik").forEach((dugme) => {
    dugme.onclick = () => {
      $$(".aralik").forEach((b) => b.classList.remove("secili"));
      dugme.classList.add("secili");
      S.dakika = Number(dugme.dataset.dakika);
      gecmisYukle();
    };
  });

  $$(".jog").forEach((dugme) => {
    const eksen = dugme.dataset.eksen;
    const yon = Number(dugme.dataset.yon);
    // pointer olayları: fare, dokunmatik ve kalem tek kod yolundan geçsin.
    dugme.addEventListener("pointerdown", (olay) => {
      olay.preventDefault();
      // Parmak düğmeden kayarsa "pointerup" başka öğeye gider ve bırakma
      // kaybolurdu; yakalama bunu bu düğmeye bağlıyor.
      dugme.setPointerCapture?.(olay.pointerId);
      jogBasla(eksen, yon, dugme);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((tur) =>
      dugme.addEventListener(tur, jogBirak));
    dugme.addEventListener("contextmenu", (o) => o.preventDefault());  // uzun basışta menü çıkmasın
  });

  // Sekme gizlenirse, pencere odağı giderse ya da soket kapanırsa jog biter.
  document.addEventListener("visibilitychange", () => { if (document.hidden) jogBirak(); });
  window.addEventListener("blur", jogBirak);
  window.addEventListener("pagehide", jogBirak);

  $("#d-home").onclick = () => komutGonder("home");
  $("#d-dur").onclick = () => { jogBirak(); komutGonder("dur"); };
  $("#d-enable").onclick = () => komutGonder("enable", { deger: !S.enable });
  $("#d-acil-temizle").onclick = () => komutGonder("acil_temizle");
  $("#d-buraya").onclick = () => {
    ["x", "y", "z"].forEach((eksen) => {
      const metin = $(`#k-${eksen}`).textContent.replace(/[^\d.,-]/g, "").replace(",", ".");
      if (metin) $(`#h-${eksen}`).value = parseFloat(metin);
    });
  };
  $("#d-acil").onclick = () => {
    // confirm() bilerek yok: acil durdurma bir soru sormaz, uygular.
    jogBirak();
    komutGonder("acil");
    S.roleDurum = { su_pompasi: false, hava_pompasi: false, su_vanasi: false };
    $$(".role").forEach((b) => b.classList.remove("secili"));
  };

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

  // Klavye: ok tuşları X/Y, PageUp/Down Z — tuş basılı tutuldukça hareket,
  // bırakınca durur (düğmelerle aynı davranış). Boşluk acil durdurma.
  const TUS = {
    ArrowRight: ["x", 1], ArrowLeft: ["x", -1],
    ArrowUp: ["y", 1], ArrowDown: ["y", -1],
    PageUp: ["z", 1], PageDown: ["z", -1],
  };
  const jogDugmesi = (eksen, yon) =>
    document.querySelector(`.jog[data-eksen="${eksen}"][data-yon="${yon}"]`);

  document.addEventListener("keydown", (olay) => {
    if (olay.target.tagName === "INPUT" || !$("#sayfa-kontrol").classList.contains("etkin")) return;
    if (olay.code === "Space") { olay.preventDefault(); $("#d-acil").click(); return; }
    const eslesme = TUS[olay.key];
    if (!eslesme) return;
    olay.preventDefault();
    if (olay.repeat) return;                 // tuş tekrarı zaten yenilemeyi tetiklemiyor
    jogBasla(eslesme[0], eslesme[1], jogDugmesi(eslesme[0], eslesme[1]));
  });
  document.addEventListener("keyup", (olay) => { if (TUS[olay.key]) jogBirak(); });
}

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
  if (Object.keys(S.grafikler).length) await gecmisYukle();
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
