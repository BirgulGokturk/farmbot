/* Bitkiler — prosedürel gövde + yapraklar, türün rengine ve yaşına göre.
 *
 * Bitki, `tur` alanı taşıyan bir NOKTA. Ayrı bir depo yok; bu katman da
 * `veri.noktalar`ı okuyor, 2B harita da. Sürükleyerek taşımak ve silmek
 * burada: taşınan şey bitkinin kendisi, halkası değil.
 */
Tarla.katman({
  kimlik: "bitkiler",
  ad: "Bitkiler",
  varsayilan: true,

  bitkiler(o) {
    return o.veri.noktalar.filter((n) => n && n.tur).map((n) => ({
      nokta: n,
      tur: o.veri.turler[n.tur] || { name_tr: n.tur, spread_mm: 200, color: "#5f9e46", icon: "🌱" },
    }));
  },

  /** Yaşa göre olgunluk 0..1 — hasat gününe yaklaştıkça bitki büyüyor. */
  olgunluk(b) {
    const gun = Number(b.tur.days_to_harvest) || 60;
    if (!b.nokta.ekim) return 1;
    return Math.max(0.06, Math.min(1, (Date.now() / 1000 - Number(b.nokta.ekim)) / 86400 / gun));
  },

  simge(metin) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.font = "48px system-ui, 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(metin || "🌱", 32, 36);
    return new THREE.CanvasTexture(c);
  },

  gorsel(o, b, ol) {
    const grup = new o.THREE.Group();
    const rM = Math.max(0.02, ((Number(b.tur.spread_mm) || 200) / 2) * o.MM);
    const tacR = rM * (0.10 + 0.85 * ol);
    const boy = Math.max(0.015, rM * (0.12 + 0.70 * ol));
    const renk = new o.THREE.Color(b.tur.color || "#5f9e46");

    const govde = new o.THREE.Mesh(
      new o.THREE.CylinderGeometry(0.005 * (0.6 + ol), 0.008 * (0.6 + ol), boy, 8),
      o.malzeme(o.makine.renk.govde, { roughness: 0.95 }));
    govde.position.y = boy / 2;
    grup.add(govde);

    // Yaprak tonu yeşilden başlıyor, türün tonundan yalnızca biraz
    // etkileniyor: kırmızıyı yeşile karıştırmak kahverengi veriyordu.
    const hsl = { h: 0.25, s: 0.4, l: 0.35 };
    renk.getHSL(hsl);
    const yaprakRenk = new o.THREE.Color().setHSL(
      0.25 + (hsl.h - 0.25) * 0.15,
      o.kis(0.30 + hsl.s * 0.20, 0.22, 0.60),
      o.kis(0.26 + hsl.l * 0.16, 0.20, 0.46));
    const yaprakMal = o.malzeme(yaprakRenk, { roughness: 0.8, transparent: true, opacity: 0.88 });
    const tacMal = o.malzeme(renk, { roughness: 0.6, transparent: true, opacity: 0.95 });

    const tac = new o.THREE.Mesh(new o.THREE.SphereGeometry(tacR * 0.38, 14, 10), tacMal);
    tac.position.y = boy; tac.scale.y = 0.6;
    grup.add(tac);

    const adet = ol < 0.25 ? 3 : ol < 0.6 ? 5 : 7;
    for (let i = 0; i < adet; i++) {
      const aci = (i / adet) * Math.PI * 2 + i * 0.35;
      const yaprak = new o.THREE.Mesh(new o.THREE.SphereGeometry(tacR * 0.34, 10, 8), yaprakMal);
      yaprak.scale.set(1.3, 0.22, 0.9);
      const uzak = tacR * 0.62;
      yaprak.position.set(Math.cos(aci) * uzak, boy * (0.75 + 0.25 * (i % 2)), Math.sin(aci) * uzak);
      yaprak.rotation.y = -aci;
      yaprak.rotation.z = -0.18 - 0.12 * (i % 2);
      grup.add(yaprak);
    }

    if (document.querySelector("#tarla-simge") && document.querySelector("#tarla-simge").checked) {
      const s = new o.THREE.Sprite(new o.THREE.SpriteMaterial({
        map: this.simge(b.tur.icon), transparent: true, depthTest: false }));
      s.scale.setScalar(o.kis(rM * 0.45, 0.03, 0.075));
      s.position.y = boy + tacR * 0.45 + 0.025;
      grup.add(s);
    }
    return grup;
  },

  /** Çoklu seçimdeki bitkinin altına vurgu halkası. */
  secimHalkasi(o, n) {
    const halka = new o.THREE.Mesh(
      new o.THREE.RingGeometry(0.030, 0.040, 30),
      new o.THREE.MeshBasicMaterial({ color: "#3987e5", transparent: true, opacity: 0.9,
                                      side: o.THREE.DoubleSide }));
    halka.rotation.x = -Math.PI / 2;
    halka.position.set(o.sx(n.x), 0.005, o.sz(n.y));
    halka.raycast = () => {};
    return halka;
  },

  guncelle(o) {
    o.bosalt(o.grup);
    this.bitkiler(o).forEach((b) => {
      const g = this.gorsel(o, b, this.olgunluk(b));
      g.position.set(o.sx(b.nokta.x), 0, o.sz(b.nokta.y));
      o.grup.add(g);
      if (o.secim.has(b.nokta.ad)) o.grup.add(this.secimHalkasi(o, b.nokta));
    });
    // Seçili bitkinin altına beyaz halka
    const s = o.secili;
    if (s && s.katman.tanim.kimlik === "bitkiler") {
      const halka = new o.THREE.Mesh(
        new o.THREE.RingGeometry(0.026, 0.034, 30),
        new o.THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85,
                                        side: o.THREE.DoubleSide }));
      halka.rotation.x = -Math.PI / 2;
      halka.position.set(o.sx(s.kayit.nokta.x), 0.006, o.sz(s.kayit.nokta.y));
      halka.raycast = () => {};
      o.grup.add(halka);
    }
    document.querySelector("#tarla-sayi").textContent = (() => {
      const b = this.bitkiler(o);
      if (!b.length) return "Henüz bitki yok";
      const su = b.reduce((t, x) => t + (Number(x.tur.water_ml_per_day) || 0), 0);
      return `${b.length} bitki · günlük ${o.say(su / 1000, 1)} L su`;
    })();
  },

  ciz2b(o, c) {
    const s = o.secili;
    this.bitkiler(o).forEach((b) => {
      const p = o.mm2b(b.nokta.x, b.nokta.y);
      const secili = s && s.katman.tanim.kimlik === "bitkiler" && s.kayit.nokta.ad === b.nokta.ad;
      const toplu = o.secim.has(b.nokta.ad);
      if (toplu) {
        c.beginPath(); c.arc(p.x, p.y, 10, 0, Math.PI * 2);
        c.strokeStyle = "#3987e5"; c.lineWidth = 2.5; c.stroke();
      }
      c.beginPath(); c.arc(p.x, p.y, secili ? 7 : 5, 0, Math.PI * 2);
      c.fillStyle = b.tur.color || "#5f9e46"; c.fill();
      if (secili) { c.strokeStyle = "#fff"; c.lineWidth = 2; c.stroke(); }
      c.fillStyle = "#c3c2b7";
      c.font = "10px ui-sans-serif, system-ui";
      c.fillText(b.nokta.ad, p.x + 9, p.y + 3);
    });
  },

  /** Kutu seçimine hangi öğelerin gireceği. Çekirdek yalnız {ad, x, y}
   *  istiyor; katman kapalıysa hiç sorulmuyor. */
  secilebilir(o) {
    return this.bitkiler(o).map((b) => ({ ad: b.nokta.ad, x: b.nokta.x, y: b.nokta.y }));
  },

  /** Tıklama yarıçapı bitkinin gövdesi kadar — yayılım dairesi kadar değil. */
  vur(o, mm) {
    let en = null, mesafe = 1e9;
    this.bitkiler(o).forEach((b) => {
      const d = Math.hypot(b.nokta.x - mm.x, b.nokta.y - mm.y);
      const esik = o.kis(((Number(b.tur.spread_mm) || 200) / 2) * 0.35, 22, 55);
      if (d < esik && d < mesafe) { mesafe = d; en = b; }
    });
    return en;
  },

  tasi(o, b, mm, bitti) {
    b.nokta.x = Math.round(mm.x * 10) / 10;
    b.nokta.y = Math.round(mm.y * 10) / 10;
    if (!bitti) { this.guncelle(o); return; }
    const n = b.nokta;
    // Eğri alanları da gönderiliyor: "üstüne yaz" bütün kaydı değiştiriyor,
    // göndermezsek bitkiyi sürüklemek bağlı eğrileri siler.
    o.api("/api/noktalar", { method: "POST", body: JSON.stringify({
      ad: n.ad, x: n.x, y: n.y, z: n.z, etiket: n.etiket || "bitki",
      tur: n.tur, ekim: n.ekim, ustune_yaz: true,
      egri_su: n.egri_su || "", egri_yayilim: n.egri_yayilim || "",
      egri_yukseklik: n.egri_yukseklik || "" }) })
      .catch((h) => o.gunluk(`✕ Taşınamadı: ${h.message}`, "hata"))
      .then(() => o.noktalariYukle());
  },

  sil(o, b) {
    o.api(`/api/noktalar?ad=${encodeURIComponent(b.nokta.ad)}`, { method: "DELETE" })
      .then((y) => {
        o.gunluk(`✓ '${b.nokta.ad}' silindi`, "ok");
        o.geriAlGoster(y && y.geri_al);      // 30 sn geri alınabilir
        return o.noktalariYukle();
      })
      .catch((h) => o.gunluk(`✕ Silinemedi: ${h.message}`, "hata"));
  },

  kart(o, b) {
    const t = b.tur, n = b.nokta;
    const ol = this.olgunluk(b);
    const gun = n.ekim ? Math.floor((Date.now() / 1000 - Number(n.ekim)) / 86400) : null;
    const hasat = Number(t.days_to_harvest) || null;
    const kalan = gun != null && hasat ? Math.max(0, hasat - gun) : null;
    return `<div class="tarla-kart-bas">
        <span class="simge">${o.kacisli(t.icon || "🌱")}</span>
        <div><b>${o.kacisli(t.name_tr || n.tur)}</b>
          <div class="alt-not">${o.kacisli(n.ad)} · X${o.say(n.x, 1)} Y${o.say(n.y, 1)} Z${o.say(n.z, 1)}</div>
        </div></div>
      <table class="tarla-ozellik">
        <tr><td>Ekim derinliği</td><td><b>${o.say(t.sow_depth_mm, 0)} mm</b></td></tr>
        <tr><td>Hasat süresi</td><td><b>${o.say(t.days_to_harvest, 0)} gün</b>${kalan != null ? ` <span class="alt-not">(${kalan} kaldı)</span>` : ""}</td></tr>
        <tr><td>Günlük su</td><td><b>${o.say(t.water_ml_per_day, 0)} ml</b></td></tr>
        <tr><td>Yayılım</td><td><b>${o.say(t.spread_mm, 0)} mm</b></td></tr>
        <tr><td>Büyüme</td><td><b>%${o.say(ol * 100, 0)}</b>${gun != null ? ` <span class="alt-not">(${gun}. gün)</span>` : ""}</td></tr>
      </table>
      ${this.egriBolumu(o, n, gun)}
      <div class="tarla-kart-dugme">
        <button class="dugme birincil" id="d-tarla-git">Buraya git</button>
        <button class="dugme tehlike" id="d-tarla-sil">Sil</button>
      </div>`;
  },

  /** Bitkiye bağlanabilen eğriler ve bugünkü değerleri.
   *  Eğri yoksa bölüm hiç görünmüyor — boş bir açılır liste işe yaramıyor. */
  egriBolumu(o, n, gun) {
    const hepsi = o.egriler || [];
    if (!hepsi.length) return "";
    const yas = gun == null ? 0 : gun;
    const satir = (alan, tip, baslik) => {
      const uygun = hepsi.filter((e) => e.tip === tip);
      if (!uygun.length) return "";
      const secili = n[alan] || "";
      const d = secili ? o.egriDeger(secili, yas) : null;
      return `<tr><td>${o.kacisli(baslik)}</td><td>
        <select class="egri-sec" data-alan="${alan}">
          <option value="">(eğri yok)</option>
          ${uygun.map((e) => `<option${e.ad === secili ? " selected" : ""}>${o.kacisli(e.ad)}</option>`).join("")}
        </select>
        ${d != null ? `<b>${o.say(d, 0)}</b> <span class="alt-not">${o.kacisli(uygun[0].birim)}</span>` : ""}
      </td></tr>`;
    };
    const govde = satir("egri_su", "su", "Su eğrisi")
                + satir("egri_yayilim", "yayilim", "Yayılım eğrisi")
                + satir("egri_yukseklik", "yukseklik", "Yükseklik eğrisi");
    if (!govde) return "";
    return `<table class="tarla-ozellik egri-tablo">${govde}</table>`;
  },

  baglan(o, kok, b) {
    kok.querySelector("#d-tarla-git").onclick = () =>
      o.komut("git", { x: b.nokta.x, y: b.nokta.y, z: b.nokta.z });
    kok.querySelector("#d-tarla-sil").onclick = () => this.sil(o, b);
    kok.querySelectorAll(".egri-sec").forEach((sec) => {
      sec.onchange = () => {
        const n = b.nokta;
        n[sec.dataset.alan] = sec.value;
        o.api("/api/noktalar", { method: "POST", body: JSON.stringify({
          ad: n.ad, x: n.x, y: n.y, z: n.z, etiket: n.etiket || "bitki",
          tur: n.tur, ekim: n.ekim, ustune_yaz: true,
          egri_su: n.egri_su || "", egri_yayilim: n.egri_yayilim || "",
          egri_yukseklik: n.egri_yukseklik || "" }) })
          .then(() => { o.gunluk(`✓ '${n.ad}' eğrisi güncellendi`, "ok"); return o.noktalariYukle(); })
          .catch((h) => o.gunluk(`✕ Eğri bağlanamadı: ${h.message}`, "hata"));
      };
    });
  },
});
