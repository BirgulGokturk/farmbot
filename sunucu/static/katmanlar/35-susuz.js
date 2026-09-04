/* Susayan bitkilerin üstünde su damlası — tıklanınca sulama.
 *
 * NEDEN AYRI KATMAN. Nem bilgisi 3B görünümde hiç yoktu: susadığını
 * ancak Tarla sekmesindeki tabloyu açıp okuyarak öğrenebiliyordunuz.
 * Oysa bakılan yer burası; uyarı da burada olmalı.
 *
 * DAMLA BİTKİNİN ÜSTÜNDE DEĞİL, YANINDA. Tam üstüne konsaydı bitkiye
 * tıklamak ile damlaya tıklamak aynı şey olurdu ve hangisinin
 * çalıştığı tesadüfe kalırdı. Damla 30 mm ileride duruyor: bitkiye
 * tıklayınca her zamanki bitki kartı, damlaya tıklayınca sulama kartı
 * açılıyor. İkisi karışmıyor.
 *
 * KENDİ ÖLÇÜMÜ OLMAYAN BİTKİYE DAMLA KOYMUYORUZ. Sunucu, ölçümü
 * olmayan bitkiye 100 mm içindeki bir komşunun okumasını veriyor. O
 * sayı bilgi ama BU bitkinin bilgisi değil; ona bakıp "susadı" deyip
 * su dökmek, ölçmeden sulamak olurdu. Onlar sarı soru işaretiyle
 * gösteriliyor — "önce ölç" demek için.
 *
 * SULAMA GERİ ALINAMIYOR. Kart tek tıkla su dökmüyor: düğmeye basınca
 * ne kadar su verileceğini yazıyor ve ikinci bir onay istiyor.
 */
Tarla.katman({
  kimlik: "susuz",
  ad: "Susayan bitkiler",
  varsayilan: true,

  //: Damlanın bitkiden kayması (mm) — makine Y ekseninde ileri.
  KAYMA: 22,
  //: Tıklama yarıçapı (mm). Bitkinin kendi vuruş alanına girmeyecek
  //  kadar küçük, fareyle tutturulabilecek kadar büyük. İşaretin
  //  ÇİZİM boyundan büyük olması sorun değil, hatta gerekli: küçük
  //  bir simgeyi fareyle tam tutturmak zor.
  YARICAP: 14,

  /* --------------------------------------------------------- veri */

  /** Nem verisi — `/api/bahce`den, katman AÇIKKEN ve seyrek.
   *
   * 3B görünümün kendi veri paketinde nem yok; buraya özel çekiliyor.
   * Kapalı katman hiç istek atmıyor. */
  veriAl(o) {
    const P = window.Panel;
    if (!P || !P.apiIste) return;
    const simdi = Date.now();
    if (this._istek || simdi - (this._son || 0) < 8000) return;
    this._istek = true;
    this._son = simdi;
    P.apiIste("/api/bahce")
      .then((y) => {
        const b = (y && y.bitkiler) || [];
        const imza = b.map((p) => `${p.ad}:${(p.su_olcum || {}).nem}:${p.susadi}`).join("|");
        if (imza !== this._imza) { this._imza = imza; this._bitki = b; o.tazele(); }
      })
      .catch(() => {})
      .finally(() => { this._istek = false; });
  },

  /** Damla konacak bitkiler — [{bitki, hal, x, y}] (x/y damlanın yeri). */
  hedefler(o) {
    const liste = [];
    for (const b of (this._bitki || [])) {
      const olcum = b.su_olcum || {};
      let hal = null;
      if (!olcum.var) hal = "yok";
      else if (!olcum.kendi) hal = "yok";     // komşudan gelen okuma sayılmıyor
      else if (b.susadi) hal = "susadi";
      if (!hal) continue;
      const x = Number(b.x), y = Number(b.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      liste.push({ bitki: b, hal, x, y: y + this.KAYMA });
    }
    return liste;
  },

  /* --------------------------------------------------------- 3B */

  guncelle(o) {
    o.bosalt(o.grup);
    this.veriAl(o);
    const T = o.THREE;

    this.hedefler(o).forEach((h) => {
      const susuz = h.hal === "susadi";
      const renk = susuz ? "#4aa8d8" : "#e8a33c";
      /* İKİSİ AYNI AĞIRLIKTA DEĞİL.
       *
       * Susadı = yapılacak iş. Ölçülmedi = eksik bilgi. İlki göze
       * çarpmalı, ikincisi yalnız FARK EDİLMELİ. İlk hâlde ikisi de
       * aynı boyda ve aynı parlaklıktaydı; 25 bitkinin 14'ünde ölçüm
       * olmadığı için sahne halkayla doldu ve asıl uyarı olan damlalar
       * onların arasında kayboldu. Sayıca çok olan, göze az batmalı. */
      const mal = new T.MeshStandardMaterial({
        color: renk, transparent: true, opacity: susuz ? 0.92 : 0.45,
        emissive: new T.Color(renk), emissiveIntensity: susuz ? 0.5 : 0.2,
        roughness: 0.2, metalness: 0.0,
      });

      const g = new T.Group();
      if (susuz) {
        // DAMLA: küre + üstüne koni. Küçük ama biçimi belirgin; sahneyi
        // kaplamadan "su" diye okunuyor.
        const kure = new T.Mesh(new T.SphereGeometry(0.0055, 12, 10), mal);
        kure.position.y = 0.0055;
        g.add(kure);
        const koni = new T.Mesh(new T.ConeGeometry(0.0055, 0.009, 12), mal);
        koni.position.y = 0.0145;
        g.add(koni);
      } else {
        // ÖLÇÜLMEDİ: ince, sönük halka. Damladan farklı bir biçim,
        // çünkü farklı bir şey söylüyor — "su gerek" değil, "bilmiyoruz".
        const halka = new T.Mesh(new T.TorusGeometry(0.006, 0.0013, 6, 16), mal);
        halka.position.y = 0.008;
        halka.rotation.x = Math.PI / 2;
        g.add(halka);
      }

      g.position.set(o.sx(h.x), 0.02, o.sz(h.y));
      g.userData.golgeAtma = true;
      o.grup.add(g);

      // Bitkiye bağlayan ince çizgi: damlanın hangi bitkiye ait olduğu
      // 30 mm ötede belirsiz kalırdı.
      const iz = new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(o.sx(h.bitki.x), 0.004, o.sz(h.bitki.y)),
          new T.Vector3(o.sx(h.x), 0.004, o.sz(h.y))]),
        new T.LineBasicMaterial({ color: renk, transparent: true,
                                  opacity: susuz ? 0.45 : 0.22 }));
      o.grup.add(iz);
    });
  },

  /* --------------------------------------------------------- 2B */

  ciz2b(o, c) {
    this.veriAl(o);
    this.hedefler(o).forEach((h) => {
      const p = o.mm2b(h.x, h.y), b = o.mm2b(h.bitki.x, h.bitki.y);
      const renk = h.hal === "susadi" ? "#4aa8d8" : "#e8a33c";
      c.save();
      c.strokeStyle = renk;
      c.globalAlpha = h.hal === "susadi" ? 0.45 : 0.22;
      c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(p.x, p.y); c.stroke();
      c.globalAlpha = h.hal === "susadi" ? 1 : 0.5;
      c.fillStyle = renk;
      c.font = "11px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(h.hal === "susadi" ? "💧" : "?", p.x, p.y);
      c.restore();
    });
  },

  /* ------------------------------------------------------ tıklama */

  vur(o, mm) {
    let en_yakin = null, en_kisa = this.YARICAP;
    for (const h of this.hedefler(o)) {
      const d = Math.hypot(mm.x - h.x, mm.y - h.y);
      if (d <= en_kisa) { en_kisa = d; en_yakin = h; }
    }
    return en_yakin;
  },

  kart(o, h) {
    const b = h.bitki, ol = b.su_olcum || {};
    const nem = ol.var ? `${Math.round(Number(ol.nem))}%` : "—";
    if (h.hal !== "susadi") {
      return `<h4>${o.kacisli(b.ad)}</h4>
        <p class="alt-not"><b>Bu bitkinin kendi nemi ölçülmedi.</b>
          ${ol.var ? `Gösterilen ${nem} yandaki bir noktadan alınmış okuma,
            bu bitkinin toprağından değil.` : ""}
          Sulamadan önce ölçün: Tarla sekmesinde bitkiyi seçip
          <b>Nem ölç</b> deyin.</p>`;
    }
    const sure = Number(b.sulama_saniye) || null;
    /* MAKİNE KOPUKSA DÜĞMEYİ AÇMIYORUZ.
     *
     * Açık bir düğme "bu iş yapılabilir" diye söz veriyor. Ajan
     * bağlı değilken basılınca hiçbir şey olmuyordu: ilk basış onaya
     * geçiyor, ikincisi sunucudan hata alıyor ve hata yalnız olay
     * günlüğüne düşüyordu — kullanıcı karta bakıyordu, günlüğe değil.
     * "Denedim, sulamıyor" tam olarak bu. */
    const bagli = !!(window.Panel && window.Panel.S
                     && window.Panel.S.ajanBagli);
    return `<h4>${o.kacisli(b.ad)} · susadı</h4>
      <p class="alt-not">Toprak nemi <b>${nem}</b>${
        b.su_gerekce ? ` — ${o.kacisli(b.su_gerekce)}` : ""}.
        ${sure ? `Sulama süresi <b>${sure} sn</b>.` : ""}</p>
      <div class="satir-8">
        <button class="dugme birincil" data-rol="sula"${bagli ? "" : " disabled"}
          >💧 Sula</button>
        <span class="alt-not" data-rol="not">${bagli ? ""
          : "Makine bağlı değil — sulama yapılamaz."}</span>
      </div>`;
  },

  baglan(o, kutu, h) {
    const d = kutu.querySelector('[data-rol="sula"]');
    if (!d) return;
    const not = kutu.querySelector('[data-rol="not"]');
    // İKİ BASAMAK. Sulama geri alınamıyor: su döküldü mü döküldü.
    // İlk basış ne olacağını yazıyor, ikincisi yapıyor.
    let onayli = false;
    d.onclick = async () => {
      if (!onayli) {
        onayli = true;
        d.textContent = "Onayla — su dökülecek";
        if (not) not.textContent = "Geri alınamaz.";
        return;
      }
      d.disabled = true;
      try {
        const y = await window.Panel.apiIste("/api/toplu", {
          method: "POST",
          body: JSON.stringify({ islem: "sula", noktalar: [h.bitki.ad] }),
        });
        o.gunluk(y.mesaj || `💧 ${h.bitki.ad} sulanıyor`, "iyi");
        this._son = 0;            // nem verisi yeniden çekilsin
      } catch (hata) {
        // HATA KARTTA DA YAZIYOR. Yalnız günlüğe yazmak, kullanıcının
        // bakmadığı yere yazmak demekti.
        o.gunluk(`✕ Sulama: ${hata.message}`, "hata");
        if (not) not.textContent = hata.message || "Sulama başlatılamadı";
        d.disabled = false;
        onayli = false;
        d.textContent = "💧 Sula";
      }
    };
  },
});
