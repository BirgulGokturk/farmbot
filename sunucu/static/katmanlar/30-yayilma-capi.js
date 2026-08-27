/* Yayılma çapı — her bitkinin altındaki halka ve çakışma denetimi.
 *
 * Bitkiden AYRI bir katman: kalabalık bir yatakta halkalar görüntüyü
 * boğuyor, ama yerleştirme yaparken tam da onlar gerekiyor. İkisini ayrı
 * açıp kapatabilmek, tek bir "bitkiler" katmanından daha kullanışlı.
 *
 * Çakışma hesabı burada duruyor çünkü çakışma yayılım çapının bir
 * özelliği — bitkinin değil.
 */
Tarla.katman({
  kimlik: "yayilim",
  ad: "Yayılma çapı",
  varsayilan: true,

  /** Alanın yüzeyi genel yüzeyden ne kadar yukarıda (sahne metresi).
   *  Kaplar aynı hizada olmayabiliyor; işaretler toprağın altında
   *  kalmasın diye her nokta kendi alanının yüzeyine oturuyor. */
  yuzeyKay(o, mx, my) {
    const a = o.dikimAlani(mx, my);
    return (a && a.toprak_z != null) ? (Number(a.toprak_z) - o.toprakZ) * o.MM : 0;
  },

  /** Bitki listesi + çakışma. Katman kapalıyken hiç hesaplanmıyor. */
  hesapla(o) {
    const bitkiler = o.veri.noktalar.filter((n) => n && n.tur).map((n) => {
      const t = o.veri.turler[n.tur] || { spread_mm: 200, color: "#5f9e46", name_tr: n.tur };
      // Bitkiye bir YAYILIM EĞRİSİ bağlıysa çap türün sabit sayısı değil,
      // bitkinin o günkü yaşındaki değer. Bağlı değilse eski davranış.
      const gun = n.ekim ? (Date.now() / 1000 - Number(n.ekim)) / 86400 : 0;
      const egriCap = n.egri_yayilim ? o.egriDeger(n.egri_yayilim, gun) : null;
      // Eğri yoksa çap üç katmandan çözülüyor: bitkinin kendi ezmesi >
      // türün ezmesi > katalog. Hesabı burada tekrarlamıyoruz.
      const cozum = o.turAlani(n, "spread_mm");
      const cap = egriCap != null ? egriCap : cozum.deger;
      return { nokta: n, tur: t, r: cap / 2, egriden: egriCap != null,
               ozelMi: egriCap == null && cozum.ozelMi,
               cakisma: [], disi: null };
    });
    const s = o.sinir;
    bitkiler.forEach((b) => {
      const d = [];
      if (b.nokta.x < s.x.min - 0.5 || b.nokta.x > s.x.max + 0.5) d.push("X");
      if (b.nokta.y < s.y.min - 0.5 || b.nokta.y > s.y.max + 0.5) d.push("Y");
      b.disi = d.length ? d.join(", ") : null;
    });
    for (let i = 0; i < bitkiler.length; i++) {
      for (let j = i + 1; j < bitkiler.length; j++) {
        const a = bitkiler[i], b = bitkiler[j];
        const ust = a.r + b.r - Math.hypot(a.nokta.x - b.nokta.x, a.nokta.y - b.nokta.y);
        if (ust > 0.5) {
          a.cakisma.push({ ad: b.nokta.ad, mm: ust });
          b.cakisma.push({ ad: a.nokta.ad, mm: ust });
        }
      }
    }
    return bitkiler;
  },

  renk(b) {
    return b.disi ? "#c2503a" : b.cakisma.length ? "#c08b2a" : "#5f9e46";
  },

  guncelle(o) {
    o.bosalt(o.grup);
    const bitkiler = this.hesapla(o);
    bitkiler.forEach((b) => {
      const r = b.r * o.MM;
      const renk = this.renk(b);
      const disk = new o.THREE.Mesh(
        new o.THREE.CircleGeometry(r, 44),
        new o.THREE.MeshBasicMaterial({ color: renk, transparent: true,
          opacity: b.cakisma.length || b.disi ? 0.18 : 0.10, side: o.THREE.DoubleSide,
          depthWrite: false }));
      disk.rotation.x = -Math.PI / 2;
      const dy = this.yuzeyKay(o, b.nokta.x, b.nokta.y);
      disk.position.set(o.sx(b.nokta.x), dy + 0.0015, o.sz(b.nokta.y));
      disk.raycast = () => {};
      o.grup.add(disk);

      const halka = new o.THREE.Mesh(
        new o.THREE.RingGeometry(Math.max(0.002, r - 0.004), r, 52),
        new o.THREE.MeshBasicMaterial({ color: renk, transparent: true, opacity: 0.9,
                                        side: o.THREE.DoubleSide }));
      halka.rotation.x = -Math.PI / 2;
      halka.position.set(o.sx(b.nokta.x), dy + 0.003, o.sz(b.nokta.y));
      halka.raycast = () => {};
      o.grup.add(halka);
    });
    this.uyariYaz(o, bitkiler);
  },

  ciz2b(o, c) {
    this.hesapla(o).forEach((b) => {
      const p = o.mm2b(b.nokta.x, b.nokta.y);
      const r = b.r * o.olcek2b;
      const renk = this.renk(b);
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fillStyle = renk + "22"; c.fill();
      // Kesik çizgi = bu bitkinin çapı türünden farklı. Kartı açmadan da
      // hangi bitkinin elle ayarlandığı haritada görünüyor.
      c.setLineDash(b.ozelMi ? [4, 3] : []);
      c.strokeStyle = renk; c.lineWidth = b.ozelMi ? 1.6 : 1; c.stroke();
      c.setLineDash([]);
    });
  },

  /** Çakışma özeti sahnenin altındaki kutuya yazılıyor. */
  uyariYaz(o, bitkiler) {
    const kutu = document.querySelector("#tarla-cakisma");
    if (!kutu) return;
    const gorulen = new Set(), ciftler = [];
    bitkiler.forEach((b) => b.cakisma.forEach((c) => {
      const anahtar = [b.nokta.ad, c.ad].sort().join(" ");
      if (gorulen.has(anahtar)) return;
      gorulen.add(anahtar);
      ciftler.push({ a: b.nokta.ad, b: c.ad, mm: c.mm });
    }));
    const disi = bitkiler.filter((b) => b.disi);
    if (!ciftler.length && !disi.length) { kutu.classList.add("gizli"); kutu.innerHTML = ""; return; }
    kutu.classList.remove("gizli");
    const AZAMI = 6;
    const sirali = ciftler.sort((u, v) => v.mm - u.mm);
    let html = "";
    if (sirali.length) {
      html += `<b>${sirali.length} çakışma</b>`;
      html += sirali.slice(0, AZAMI).map((c) =>
        `<div class="cakisma-satir">${o.kacisli(c.a)} ↔ ${o.kacisli(c.b)} <b>${o.say(c.mm, 0)} mm</b></div>`).join("");
      if (sirali.length > AZAMI)
        html += `<div class="cakisma-satir alt-not">… ve ${sirali.length - AZAMI} çift daha</div>`;
    }
    if (disi.length) {
      html += `<div class="cakisma-satir"><b>${disi.length} bitki sınır dışında</b>: ` +
        disi.map((b) => o.kacisli(b.nokta.ad)).join(", ") + "</div>";
    }
    kutu.innerHTML = html;
  },
});
