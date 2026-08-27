/* Profil görüntüleyici — Z eksenini üstten görünümde anlamanın yolu.
 *
 * Harita kuş bakışı: X ve Y'yi gösteriyor ama Z'yi göstermiyor. Bir bitkinin
 * ne kadar derinde ekildiği, ucun güvenli yüksekliğin altına inip inmediği,
 * yakındaki bir noktanın kaç mm aşağıda olduğu üstten bakınca görünmüyor.
 * Bu dosya haritada tıklanan koordinattan geçen DÜŞEY KESİTİ çiziyor.
 *
 * Yatay eksen seçilen kesit ekseni (X ya da Y), düşey eksen makine Z'si.
 * Kesite "bant" kadar yakın olan noktalar dahil ediliyor: tam üstünde bir
 * şey olması nadir, 60 mm'lik bir şerit sahada işe yarayan aralık.
 *
 * Ayrı dosya çünkü sahneye hiçbir şey çizmiyor — bir katman değil, aynı
 * verinin ikinci bir görünümü. Çekirdekten yalnız `Tarla.profilVeri()` ile
 * besleniyor; makinenin durumunu ya da nokta deposunu kendisi okumuyor.
 */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const kis = (d, a, b) => Math.max(a, Math.min(b, d));
  const say = (d, b = 0) => (d == null || Number.isNaN(d) ? "—" : Number(d).toFixed(b));

  const KENAR = { sol: 46, sag: 12, ust: 14, alt: 26 };

  const D = { eksen: "x", mm: null, bant: 60, acik: false };

  let tuval, c;

  /* ------------------------------------------------------------ ölçekler */
  /** Kesit ekseninin mm aralığı — X kesitinde makine X'i tarıyoruz. */
  function eksenAralik(v) {
    // "X kesiti" = X boyunca ilerleyen kesit, yani sabit Y.
    const s = D.eksen === "x" ? v.sinir.x : v.sinir.y;
    return { min: s.min, max: s.max };
  }

  function zAralik(v) {
    const ust = Math.max(v.sinir.z.max || 550, v.guvenliZ + 40);
    return { min: 0, max: ust };
  }

  function ciz() {
    if (!tuval || !c || D.acik === false) return;
    const v = window.Tarla && window.Tarla.profilVeri ? window.Tarla.profilVeri() : null;
    const bos = $("#profil-bos");
    if (!v || D.mm == null) {
      if (bos) bos.classList.remove("gizli");
      tuval.classList.add("gizli");
      return;
    }
    if (bos) bos.classList.add("gizli");
    tuval.classList.remove("gizli");

    const g = tuval.clientWidth || 600, y = tuval.clientHeight || 160;
    const oran = Math.min(window.devicePixelRatio || 1, 2);
    tuval.width = g * oran;
    tuval.height = y * oran;
    c.setTransform(oran, 0, 0, oran, 0, 0);
    c.clearRect(0, 0, g, y);

    const ea = eksenAralik(v), za = zAralik(v);
    const genis = g - KENAR.sol - KENAR.sag;
    const yuksek = y - KENAR.ust - KENAR.alt;
    // Makine Z'si büyüdükçe uç YUKARI çıkıyor (kalibrasyonda dir = -1), o
    // yüzden büyük Z ekranda yukarıda.
    const px = (mm) => KENAR.sol + ((mm - ea.min) / (ea.max - ea.min)) * genis;
    const pz = (z) => KENAR.ust + (1 - (z - za.min) / (za.max - za.min)) * yuksek;

    c.font = "10px ui-monospace, Menlo, Consolas, monospace";

    /* --- ızgara ve eksen yazıları --------------------------------------- */
    c.strokeStyle = "#242422";
    c.lineWidth = 1;
    for (let mm = Math.ceil(ea.min / 100) * 100; mm <= ea.max; mm += 100) {
      c.beginPath(); c.moveTo(px(mm), KENAR.ust); c.lineTo(px(mm), y - KENAR.alt); c.stroke();
      c.fillStyle = "#8a8a80";
      c.textAlign = "center";
      c.fillText(String(mm), px(mm), y - KENAR.alt + 13);
    }
    for (let z = 0; z <= za.max; z += 100) {
      c.beginPath(); c.moveTo(KENAR.sol, pz(z)); c.lineTo(g - KENAR.sag, pz(z)); c.stroke();
      c.fillStyle = "#8a8a80";
      c.textAlign = "right";
      c.fillText(String(z), KENAR.sol - 6, pz(z) + 3);
    }
    c.fillStyle = "#8a8a80";
    c.textAlign = "left";
    c.fillText(D.eksen === "x" ? "X (mm)" : "Y (mm)", KENAR.sol, 10);
    c.fillText("Z", 6, 10);

    /* --- kesişen yasak bölgeler ----------------------------------------- */
    // Bölge kutusu kesit çizgisini kesiyorsa, kapsadığı aralık taranıyor.
    (v.bolgeler || []).forEach((b) => {
      if (b.aktif === false) return;
      const x1 = Math.min(b.x1, b.x2), x2 = Math.max(b.x1, b.x2);
      const y1 = Math.min(b.y1, b.y2), y2 = Math.max(b.y1, b.y2);
      const kesitte = D.eksen === "x" ? (D.mm >= y1 && D.mm <= y2) : (D.mm >= x1 && D.mm <= x2);
      if (!kesitte) return;
      const a = D.eksen === "x" ? x1 : y1, bb = D.eksen === "x" ? x2 : y2;
      c.fillStyle = b.uyari ? "rgba(208,59,59,.16)" : "rgba(217,165,32,.14)";
      c.fillRect(px(a), KENAR.ust, px(bb) - px(a), yuksek);
      c.strokeStyle = b.uyari ? "#d03b3b" : "#d9a520";
      c.setLineDash([4, 3]);
      c.strokeRect(px(a), KENAR.ust, px(bb) - px(a), yuksek);
      c.setLineDash([]);
      c.fillStyle = b.uyari ? "#d03b3b" : "#d9a520";
      c.textAlign = "left";
      c.fillText(String(b.ad || "bölge"), px(a) + 4, KENAR.ust + 11);
    });

    /* --- toprak yüzeyi --------------------------------------------------
     * Sıfır DEĞİL: toprak kabın içinde, yüzey makine Z'sinde yukarıda bir
     * yerde. Sıfıra çizerken kesit "uç toprağın metrelerce üstünde" gibi
     * okunuyordu — oysa asıl merak edilen ucun yüzeye ne kadar yaklaştığı.
     */
    const toprakZ = Number(v.toprakZ) || 0;
    c.strokeStyle = "#7a5f38";
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(KENAR.sol, pz(toprakZ)); c.lineTo(g - KENAR.sag, pz(toprakZ)); c.stroke();
    c.fillStyle = "rgba(122,95,56,.18)";
    c.fillRect(KENAR.sol, pz(toprakZ), genis, y - KENAR.alt - pz(toprakZ));
    c.fillStyle = "#7a5f38";
    c.textAlign = "right";
    c.fillText(`toprak ${Math.round(toprakZ)}`, g - KENAR.sag - 4, pz(toprakZ) - 5);

    /* --- güvenli yükseklik ---------------------------------------------- */
    if (v.guvenliZ != null) {
      c.strokeStyle = "#3fa63f";
      c.lineWidth = 1.5;
      c.setLineDash([6, 4]);
      c.beginPath(); c.moveTo(KENAR.sol, pz(v.guvenliZ)); c.lineTo(g - KENAR.sag, pz(v.guvenliZ)); c.stroke();
      c.setLineDash([]);
      c.fillStyle = "#3fa63f";
      c.textAlign = "right";
      c.fillText(`güvenli Z ${say(v.guvenliZ, 0)}`, g - KENAR.sag - 4, pz(v.guvenliZ) - 5);
    }

    /* --- banttaki noktalar ---------------------------------------------- */
    const yakin = (v.noktalar || []).filter((n) => {
      const uzak = Math.abs((D.eksen === "x" ? n.y : n.x) - D.mm);
      return uzak <= D.bant;
    });
    yakin.forEach((n) => {
      const kx = px(D.eksen === "x" ? n.x : n.y);
      const kz = pz(kis(n.z ?? 0, za.min, za.max));
      const uzak = Math.abs((D.eksen === "x" ? n.y : n.x) - D.mm);
      // Kesitten uzaklaştıkça soluyor: hangisi tam üstünde, hangisi yanda.
      c.globalAlpha = 1 - 0.6 * (uzak / Math.max(1, D.bant));
      const renk = n.tur ? ((v.turler[n.tur] || {}).color || "#5f9e46") : "#c3c2b7";
      // Gövde çizgisi: toprak yüzeyinden noktanın Z'sine
      c.strokeStyle = renk;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(kx, pz(0)); c.lineTo(kx, kz); c.stroke();
      c.fillStyle = renk;
      c.beginPath(); c.arc(kx, kz, 4, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
      c.fillStyle = "#8a8a80";
      c.textAlign = "center";
      c.fillText(String(n.ad), kx, kz - 8);
    });

    /* --- ucun şu anki yeri ---------------------------------------------- */
    const k = v.konum;
    if (k && k.x != null) {
      const kx = px(D.eksen === "x" ? k.x : k.y);
      const kz = pz(kis(k.z ?? 0, za.min, za.max));
      c.strokeStyle = "#0f6e72";
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(kx, KENAR.ust); c.lineTo(kx, kz); c.stroke();
      c.fillStyle = "#0f6e72";
      c.beginPath(); c.arc(kx, kz, 5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = "#c3c2b7";
      c.textAlign = "left";
      c.fillText(`uç Z${say(k.z, 0)}`, kx + 9, kz - 8);
    }

    /* --- kesit çizgisi başlığı ------------------------------------------ */
    const bilgi = $("#profil-konum");
    if (bilgi) {
      bilgi.textContent =
        `${D.eksen === "x" ? "Y" : "X"} = ${say(D.mm, 1)} mm · ±${D.bant} mm bant · ${yakin.length} nokta`;
    }
  }

  /* ------------------------------------------------------------ arayüz */
  function ackapa(acik) {
    D.acik = acik;
    const kutu = $("#profil");
    kutu.classList.toggle("kapali", !acik);
    $("#d-profil-ac").setAttribute("aria-expanded", String(acik));
    localStorage.setItem("farmbot_profil", acik ? "acik" : "kapali");
    if (acik) ciz();
  }

  function eksenSec(e) {
    D.eksen = e;
    $("#d-profil-x").classList.toggle("secili", e === "x");
    $("#d-profil-y").classList.toggle("secili", e === "y");
    localStorage.setItem("farmbot_profil_eksen", e);
    ciz();
  }

  function kur() {
    tuval = $("#profil-tuval");
    if (!tuval) return;
    c = tuval.getContext("2d");

    ackapa(localStorage.getItem("farmbot_profil") === "acik");
    eksenSec(localStorage.getItem("farmbot_profil_eksen") === "y" ? "y" : "x");
    D.bant = Number(localStorage.getItem("farmbot_profil_bant")) || 60;
    $("#profil-bant").value = D.bant;

    $("#d-profil-ac").onclick = () => ackapa($("#profil").classList.contains("kapali"));
    $("#d-profil-x").onclick = () => eksenSec("x");
    $("#d-profil-y").onclick = () => eksenSec("y");
    $("#profil-bant").onchange = () => {
      D.bant = kis(Number($("#profil-bant").value) || 60, 5, 300);
      $("#profil-bant").value = D.bant;
      localStorage.setItem("farmbot_profil_bant", D.bant);
      ciz();
    };
    window.addEventListener("resize", ciz);
  }

  window.Profil = {
    kur,
    /** Çekirdek haritada bir yere tıklanınca çağırıyor. */
    konumSec(mm) {
      // X kesiti sabit Y'de ilerliyor: tıklanan Y kesiti belirliyor.
      D.mm = D.eksen === "x" ? mm.y : mm.x;
      if (!D.acik) ackapa(true);
      ciz();
    },
    /** Durum ya da nokta değişince çekirdek çağırıyor. */
    tazele: ciz,
    /** Deneme yardımcısı. */
    durum() { return { ...D }; },
  };
})();
