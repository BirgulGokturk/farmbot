/* Sulama noktaları — suyun GERÇEKTEN nereye döküleceği.
 *
 * Bitkinin tam üstüne akıtmak her tür için doğru değil; ofset türden ya da
 * bitkiden geliyor ve yaşa göre değişiyor (bkz. sunucu/sulama.py). Bu
 * katman o çözülmüş noktaları çiziyor.
 *
 * Neden ayrı bir katman ve neden VARSAYILAN KAPALI: noktalar yalnızca bir
 * SEÇİM varken anlamlı ve sürekli açık durursa harita kalabalıklaşıyor.
 * Kapalıyken hiçbir istek atılmıyor.
 *
 * Sayıyı bu katman HESAPLAMIYOR. `/api/sulama/onizle` ne döndürdüyse onu
 * çiziyor — yani ekranda gördüğünüz nokta, dizinin taşıyacağı koordinatın
 * ta kendisi. Panelde ikinci bir hesap olsaydı önizleme ile gerçek
 * ayrışabilirdi ve bu projede en çok yanıltan hata tam olarak o.
 */
Tarla.katman({
  kimlik: "sulama",
  ad: "Sulama noktaları",
  varsayilan: false,

  /** Seçim ya da bitki verisi değiştiğinde sunucudan yeniden istiyoruz.
   *  İmza tutuyorsa istek atmıyoruz: katman açıkken her durum paketinde
   *  sunucuya gitmek boşuna. */
  async tazele(o) {
    const secim = [...o.secim];
    const imza = secim.slice().sort().join(",") + "|" + (o.veri.noktalar || []).length;
    if (imza === this._imza) return;
    this._imza = imza;
    if (!secim.length) { this._ozet = []; this._ret = []; return; }
    try {
      const y = await o.api("/api/sulama/onizle", {
        method: "POST",
        body: JSON.stringify({ noktalar: secim, saniye: o.sulamaSaniye }),
      });
      this._ozet = y.ozet || [];
      this._ret = y.ret || [];
    } catch (h) {
      this._ozet = []; this._ret = [];
    }
    // Yanıt geldi: katmanları yeniden çizdiriyoruz. Sonsuz döngü yok —
    // ikinci geçişte imza tutuyor ve `tazele` hemen çıkıyor.
    o.katmanlariGuncelle();
  },

  guncelle(o) {
    o.bosalt(o.grup);
    this.tazele(o);
    const ozet = this._ozet || [];
    if (!ozet.length) return;

    ozet.forEach((b) => {
      const redli = (b.ret || []).length > 0;
      const renk = redli ? "#e2564a" : "#3f9fd8";
      (b.noktalar || []).forEach((nk) => {
        // İKİ NOKTA: su nereye düşüyor (halka) ve uç nereye gidiyor
        // (dikey çizginin tepesi). Sulama başlığı ucun merkezinden
        // kaymış; ikisini tek nokta çizmek, kaymayı görünmez yapardı.
        const sux = nk.su_x != null ? nk.su_x : nk.x;
        const suy = nk.su_y != null ? nk.su_y : nk.y;
        // Su damlasının düşeceği yer: toprağa yatık bir halka.
        const halka = new o.THREE.Mesh(
          new o.THREE.RingGeometry(0.012, 0.019, 20),
          new o.THREE.MeshBasicMaterial({ color: renk, transparent: true,
                                          opacity: 0.85, side: o.THREE.DoubleSide,
                                          depthWrite: false }));
        halka.rotation.x = -Math.PI / 2;
        const yer = o.dikimAlani(sux, suy);
        const yy = (yer && yer.toprak_z != null)
          ? (Number(yer.toprak_z) - o.toprakZ) * o.MM : 0;
        halka.position.set(o.sx(sux), yy + 0.004, o.sz(suy));
        halka.raycast = () => {};
        o.grup.add(halka);

        /* Ucun DURACAĞI yükseklik ayrıca çiziliyor: sulama Z'si bitkinin
         * kayıtlı z'si değil, yüzey + boy + açıklık. Dikey çizgi, "uç
         * buraya iner" ile "su buraya düşer" arasındaki farkı görünür
         * yapıyor. */
        const ucY = o.sy(nk.z);
        // Çizgi SU noktasından UÇ noktasına eğik gidiyor: başlık kayması
        // böylece gözle görünüyor.
        const cizgi = new o.THREE.Line(
          new o.THREE.BufferGeometry().setFromPoints([
            new o.THREE.Vector3(o.sx(sux), yy + 0.004, o.sz(suy)),
            new o.THREE.Vector3(o.sx(nk.x), ucY, o.sz(nk.y))]),
          new o.THREE.LineBasicMaterial({ color: renk, transparent: true,
                                          opacity: 0.5 }));
        cizgi.raycast = () => {};
        o.grup.add(cizgi);
      });
    });
  },

  ciz2b(o, c) {
    const ozet = this._ozet || [];
    if (!ozet.length) return;
    ozet.forEach((b) => {
      const redli = (b.ret || []).length > 0;
      c.strokeStyle = redli ? "#e2564a" : "#3f9fd8";
      c.fillStyle = redli ? "#e2564a33" : "#3f9fd833";
      c.lineWidth = 2;
      (b.noktalar || []).forEach((nk, i) => {
        const sux = nk.su_x != null ? nk.su_x : nk.x;
        const suy = nk.su_y != null ? nk.su_y : nk.y;
        const p = o.mm2b(sux, suy);
        // Başlık kaymışsa ucun gideceği yeri ince bir çizgiyle bağlıyoruz.
        if (sux !== nk.x || suy !== nk.y) {
          const u = o.mm2b(nk.x, nk.y);
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(u.x, u.y); c.stroke();
          c.beginPath(); c.arc(u.x, u.y, 3, 0, Math.PI * 2); c.stroke();
        }
        c.beginPath(); c.arc(p.x, p.y, 6, 0, Math.PI * 2); c.fill(); c.stroke();
        // Birden çok nokta varsa sıra numarası: robotun gideceği sıra.
        if ((b.noktalar || []).length > 1) {
          c.fillStyle = "#e8e6dc";
          c.font = "9px ui-sans-serif, system-ui";
          c.fillText(String(i + 1), p.x + 8, p.y + 3);
          c.fillStyle = redli ? "#e2564a33" : "#3f9fd833";
        }
      });
    });
  },

  /** Kart: katman rafında ne olduğunu anlatan kısa özet. */
  kart(o) {
    const ozet = this._ozet || [];
    if (!ozet.length) {
      return `<p class="alt-not">Haritadan bir ya da daha çok bitki seçin;
        suyun düşeceği noktalar burada çizilir.</p>`;
    }
    const nokta = ozet.reduce((t, b) => t + (b.noktalar || []).length, 0);
    const redli = ozet.filter((b) => (b.ret || []).length);
    const atlanan = ozet.filter((b) => b.sulanacak === false);
    return `<p class="alt-not">${ozet.length} bitki · ${nokta} sulama noktası
      ${redli.length ? `· <b>${redli.length} bitki reddedilecek</b>` : ""}
      ${atlanan.length ? `· <b>${atlanan.length} bitki nem yeterli, atlanacak</b>` : ""}</p>
      ${atlanan.slice(0, 6).map((b) => `<div class="alt-not">${o.kacisli(b.ad)}:
        ${o.kacisli(b.nem_gerekce || "")}</div>`).join("")}`;
  },
});
