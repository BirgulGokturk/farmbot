/* Robot — köprü, kızak, Z takımı ve uç kafası; canlı konumda.
 *
 * Geometrinin tamamı `makine.js`teki FarmbotMakine.kur()'dan geliyor.
 * Konum `durum.konum`dan; her durum paketinde YALNIZ konum güncelleniyor,
 * gövde yeniden kurulmuyor — saniyede birkaç kez portal kurmak Pi'nin
 * GPU'sunu boşuna yoruyor.
 *
 * Katman kapatılırsa makine hiç çizilmiyor: yerleştirme yaparken portalın
 * bitkilerin önünü kapatması can sıkıcı.
 */
Tarla.katman({
  kimlik: "robot",
  ad: "Robot",
  varsayilan: true,

  guncelle(o) {
    const M = o.makine, MM = o.MM;
    const w = o.genislikM, d = o.derinlikM, rayY = M.ray_yuksekligi * MM;
    // ÜÇ BAŞIN KAYMASI İMZADA. Ayar değişince sahne yeniden kuruluyor:
    // başların yeri artık ayardan geliyor ve eski geometri yanlış yerde
    // kalırdı.
    const bsl = (o.veri.durum.uc && o.veri.durum.uc.baslar) || {};
    /* DİKİM ALANLARI DA İMZADA — ve makineye GEÇİYOR.
     *
     * Uç kümesinin arabanın önüne alınma YÖNÜ, toprağın sahne z'sindeki
     * yerinden çıkıyor (bkz. makine.js → "ÜÇ BAŞ ARABANIN ÖNÜNDE"). Sabit
     * bir işaret yazmak yatak taşınınca yine bozulurdu. Alanlar burada
     * `05-yatak.js` ile AYNI kaynaktan (`o.dikimSahne`) geliyor; iki
     * katman farklı yatak görseydi baş kümesi toprağın olmadığı yana
     * asılırdı. */
    const alanlar = o.dikimSahne || [];
    const imza = `${w}|${d}|${rayY}|` + ["sulama", "nem", "tohum"]
      .map((k) => `${(bsl[k] || {}).dx},${(bsl[k] || {}).dy}`).join("|")
      + "|" + alanlar.map((a) => `${a.mz.toFixed(4)},${a.en.toFixed(4)},`
                                 + `${a.boy.toFixed(4)}`).join(";");

    // Katman kapatılınca çekirdek grubu boşaltıp geometriyi atıyor; grup
    // boşsa imza aynı olsa da yeniden kurmak gerekiyor.
    if (imza !== this._imza || !o.grup.children.length) {
      this._imza = imza;
      o.bosalt(o.grup);
      // Sulama başlığının ofseti uclar.json'dan; sulama hesabıyla AYNI
      // sayı. Ayrı yazsaydık sahnede su bir yere, gerçekte başka yere
      // düşerdi ve hangisinin doğru olduğu anlaşılmazdı.
      const makine = window.FarmbotMakine.kur(o.THREE, {
        w: w, d: d, rayY: rayY, parca: "hareketli",
        // ÜÇ BAŞ GERÇEK KAYMALARIYLA. Sahnedeki aralık makinedeki
        // aralık; ayarı değiştirince sahnede de kayıyorlar.
        baslar: bsl, mmP: MM,
        // Yatağın yeri: baş kümesinin hangi yana asılacağı buradan çıkıyor.
        alanlar: alanlar,
      });
      this._p = makine;
      // Makineye tıklamak bitki seçmek/taşımak değil — ışın testinden çıksın.
      makine.portal.traverse((n) => { n.raycast = () => {}; });
      o.grup.add(makine.portal);
    }

    const p = this._p;
    if (!p) return;
    const k = o.veri.konum || {};
    const x = k.x == null ? o.sinir.x.min : k.x;
    const y = k.y == null ? o.sinir.y.min : k.y;
    const z = k.z == null ? o.sinir.z.max : k.z;

    // Kopru uzun kenar boyunca yuruyor (makine Y), kizak kiriste kisa kenar
    // boyunca kayiyor (makine X). Gercek makinedeki duzen bu.
    p.portal.position.z = o.sz(y);
    p.kizak.position.x = o.sx(x);
    // Makine Z'si büyüdükçe uç YUKARI çıkıyor (kalibrasyonda dir = -1,
    // home = 438). Uç ucunu doğrudan o yüksekliğe koyuyoruz.
    //
    // Toprak yüzeyi makine Z'sinde SIFIR DEĞİL: toprak kabın içinde ve
    // yüzey sıfırdan yukarıda. `toprak_z` çıkarılmazsa uç, sahnede toprağın
    // metrelerce altına iniyormuş gibi görünüyordu. Artık makine Z'si
    // toprak_z'ye eşitken uç tam yüzeye değiyor.
    const toprakZ = Number(o.veri.durum.toprak_z) || 0;
    const ucY = o.kis(z - toprakZ, 0, (o.sinir.z.max || 550) - toprakZ) * MM;
    /* ====================== UÇ KAFASININ YERLEŞİMİ ======================
     * makine.js'teki KOORDİNAT SÖZLEŞMESİNDEN. Buradaki tek iş, kafayı
     * makine Z'sine oturtmak ve iş başındaki başı indirmek; x ve z'ye
     * hiç dokunulmuyor çünkü kafa onları köprüden ve kızaktan miras
     * alıyor (sözleşme 2 ve 5). Kafaya x/z ötelemesi yazmak, ucu makine
     * koordinatının gösterdiği yerden kaydırmak demek olurdu.
     *
     * YÜKSEKLİK. `ucY` yukarıda makine Z'sinden `toprak_z` çıkarılarak
     * bulundu, yani toprak yüzeyi sıfır (sözleşme 1). Kafa kendi EN ALT
     * noktasından oturuyor: `altY` başın ağzının kafa sıfırına göre y'si
     * ve negatif; `ucY - altY` kadar yukarı konunca ağız tam `ucY`ye
     * denk geliyor. Makine Z'si toprak yüzeyindeyken ağız y = 0'da.
     * Sabit bir "şu kadar yukarı" yazılamaz: baş boyu tabla ölçüsünden
     * türüyor ve tabla da kaymalardan. */
    const u = p.ucKafa.userData || {};
    p.ucKafa.position.set(0, ucY - Number(u.altY || 0), 0);

    /* Z kılavuzu birim yükseklikte kuruluyor ve stroka göre uzatılıyor.
     * ALT UCU KAFANIN TEPESİNDEN (`ustY`): sabit bir pay, baş uzayıp kafa
     * yükseldiğinde kılavuzun tablanın içinde başlamasına yol açardı. */
    const kafaUst = p.ucKafa.position.y + Number(u.ustY || 0);
    const boy = Math.max(0.05, rayY - 0.045 - kafaUst);
    p.sutun.scale.y = boy;
    p.sutun.position.set(0, kafaUst + boy / 2, 0);

    /* ÜÇ BAŞLIK ÇİZİLİ, YALNIZ SIRASI GELEN İNİYOR.
     *
     * Üç başlık tek parçada BİRLEŞTİRİLDİ ama DÖNMÜYORLAR: her biri
     * kendi sabit yerinde, yan yana. Servo hiçbir şeyi taşımıyor, yalnız
     * sırası gelen başlığı AŞAĞI İNDİRİYOR (bkz. makine.js "UÇ KAFASI").
     * Üçü de çizili çünkü üçü de orada; iş gören, İNMİŞ olandan belli.
     *
     * SEÇİLİ UÇ BİLİNMİYORSA HİÇBİRİ İNMİYOR. Servoda geri besleme yok
     * ve kart açılışta/sıfırlandıktan sonra ne komut edildiğini
     * bilmiyor; birini indirmek, bilinmeyeni bilinen gibi göstermek
     * olurdu. Üçü de dinlenme yüksekliğinde duruyor.
     *
     * İNİŞ. Üç kaynak, üçü de ayrı:
     *   - tohum ucu: KENDİ EKSENİ (PLC j4) ve ölçülen mm.
     *   - sulama başlığı: pompa rölesi (`r_su_pompasi`). Röle yalnız
     *     "akıyor / akmıyor" diyor; ayrı ekseni yok, düşme miktarı
     *     ölçüm değil gösterim kuralı (makine.js).
     *   - nem probu: SİNYAL YOK. Kendi ekseni yok ve durum paketinde
     *     "prob ölçüyor" bayrağı geçmiyor (ajan/plc.py'de yalnız
     *     X, Y, Z, T var). Uydurma bir durum üretmek yerine sabit
     *     duruyor; `suDurumu().nemSinyali` bunu söylüyor. */
    const secici = ((o.veri.durum.uc || {}).secici) || {};
    const secili = secici.secili_bas || null;
    const dinlenme = Number(u.basY || 0);
    const basGrup = u.basGrup || {};
    let inisMm = 0;
    if (secili === "tohum") {
      const t = o.veri.durum.tohum_ucu || {};
      inisMm = (t.kalibre && Number.isFinite(Number(t.mm)))
        ? Math.abs(Number(t.mm) - Number(t.yukari_mm || 0)) * MM : 0;
    } else if (secili === "sulama") {
      const PN = window.Panel;
      const akiyor = !!(PN && PN.S && PN.S.roleDurum && PN.S.roleDurum.su_pompasi);
      inisMm = akiyor ? Number(u.aktifDusme || 0) : 0;
    }
    /* İnişi YALNIZ seçili başlığa uyguluyoruz. Ötekilerin y'sini de her
     * karede dinlenmeye yazıyoruz: seçim değişince eski başlık kendi
     * başına geri çıkmaz, aşağıda kalırdı ve sahnede iki inmiş başlık
     * görünürdü — ajan bir başlık inmişken ikincisini indirmeye izin
     * vermiyor, model de öyle göstermeyecek. */
    Object.keys(basGrup).forEach((ad) => {
      basGrup[ad].position.y = dinlenme - (ad === secili ? inisMm : 0);
    });

    /* SU HUZMESİ. Kaynak tek: kartın bildirdiği röle durumu (`r_su_pompasi`).
     * Panel kendi tahminini tutmuyor — "sulama komutu gönderdim, demek ki
     * akıyordur" demek, pompa gerçekte çalışmadığında sahnede su gösterirdi
     * ve bu, olmayan bir şeyi olmuş gibi göstermek olurdu.
     *
     * Huzme başlıktan TOPRAĞA kadar uzatılıyor: uç yükseldikçe boy artıyor.
     * Sabit boy, ya toprağın içine girerdi ya havada kalırdı. */
    if (p.su) {
      /* Röle durumu `durum` paketinde DEĞİL, ölçüm paketinde geliyor
       * (`r_su_pompasi`) ve onu app.js `S.roleDurum`da tutuyor. Buradan
       * okumamızın sebebi bu; `window.Panel` zaten tam bu iş için açılmış
       * bir köprü. Panel yoksa (deneme sayfası) su hiç görünmüyor —
       * olmayan bir şeyi varmış gibi göstermektense hiç göstermemek. */
      const P = window.Panel;
      const akiyor = !!(P && P.S && P.S.roleDurum && P.S.roleDurum.su_pompasi);
      p.su.visible = akiyor;
      /* Döngüyü SUYU GİZLEYEN kod kapatıyor.
       *
       * Önce kapanışı döngünün kendisine bırakmıştım ve sekme arka plandayken
       * `requestAnimationFrame` duraklıyor: kare hiç koşmuyor, tutamak null
       * olmuyor. Sonuç sessiz bir hata — su gizleniyor ama tutamak dolu
       * kaldığı için BİR SONRAKİ sulamada `_akisBasla` "zaten çalışıyor"
       * deyip çıkıyor ve su görünüyor ama akmıyordu. */
      if (!akiyor && this._akis) {
        cancelAnimationFrame(this._akis);
        this._akis = null;
      }
      if (akiyor) {
        /* Huzme başlığın UCUNDAN başlıyor. Başlık pompa açıkken indiği
         * için ofset sabit değil: grubun O ANKİ y'si + ucun grup içi
         * ofseti. Sabit yazsaydık su, inmiş başlığın içinden çıkardı. */
        /* Huzme SULAMA başlığının ağzından çıkıyor — hortum o başlığa
         * bağlı. Başlık pompa açıkken indiği için ofset sabit değil:
         * grubun O ANKİ y'si + ağzın grup içi ofseti. Sabit yazsaydık
         * su, inmiş başlığın içinden çıkardı. */
        const sulamaG = (u.basGrup || {}).sulama;
        const agizY = (sulamaG ? sulamaG.position.y : Number(u.basY || 0))
          + Number(u.basUcY || 0);            // kafa yerelinde ağzın y'si
        // Ağzın SAHNEDEKİ yüksekliği; toprak yüzeyi y = 0.
        const yer = Math.max(0.01, p.ucKafa.position.y + agizY);
        p.su.scale.y = yer;
        p.su.position.y = agizY - yer / 2;
        this._akisBasla(o);
      }
    }
  },

  /** Deneme yardımcısı — su huzmesinin o anki hâli.
   *
   * Sahnedeki bir nesnenin gerçekten çizildiğini gözle doğrulamak zor;
   * ekran görüntüsünde ince bir çizgi ile Z kılavuzu ayırt edilemiyor.
   * Katman durumunu sayı olarak soruyoruz. `katmanDurumu` ve
   * `dikimDurumu` de aynı sebeple var.
   */
  suDurumu() {
    const p = this._p;
    if (!p || !p.su) return { kuruldu: false };
    /* UÇ KAFASI TANISI. Üç başlık üç ayrı noktada (dönme yok), üçü de
     * çizili; sorulacak şey "hangisi nerede ve hangisi inmiş". Kaymayı
     * panelden değiştirince buradaki mm'ler onunla değişiyor — sahnedeki
     * yer ile ayardaki sayının tuttuğunu gözle değil sayıyla doğrulamak
     * için. */
    const u = (p.ucKafa && p.ucKafa.userData) || {};
    const yer = u.basYer || {};
    const grup = u.basGrup || {};
    const pl = u.plaka || {};
    const inmisMm = {};
    Object.keys(grup).forEach((ad) => {
      inmisMm[ad] = +(((Number(u.basY) || 0) - grup[ad].position.y) * 1000)
        .toFixed(1);
    });
    return {
      kuruldu: true,
      /* BAŞLARIN YERİ (mm, kızak yerelinde). Kayma sözleşme (4) gereği
       * ters işaretle giriyor: baş, makine noktasının dx/dy kadar
       * TERSİNDE. Panelde 60/-40 girilmişse burada (-60, +40) görünür. */
      basYerMm: Object.keys(yer).reduce((a, ad) => {
        a[ad] = { x: +(yer[ad].x * 1000).toFixed(1),
                  z: +(yer[ad].z * 1000).toFixed(1) };
        return a;
      }, {}),
      // Üçünü birleştiren taşıyıcı plaka (mm) — başlar plakaya sığıyor mu.
      plakaMm: pl.x1 == null ? null
        : { en: +((pl.x2 - pl.x1) * 1000).toFixed(1),
            boy: +((pl.z2 - pl.z1) * 1000).toFixed(1),
            kal: +(pl.kal * 1000).toFixed(1) },
      /* HANGİ BAŞ NE KADAR İNMİŞ (mm). Hepsi 0 ise ya seçili uç
       * bilinmiyor (kart açılışta ya da sıfırlandıktan sonra) ya da iniş
       * sinyali yok. İkisi de doğru davranış; bilinmiyorken indirmemek
       * bilerek, birini indirmek bilinmeyeni bilinen gibi göstermek
       * olurdu. Aynı anda BİRDEN ÇOK sıfırdan büyük değer çıkmamalı. */
      inmisMm: inmisMm,
      aktifDusmeMm: u.aktifDusme == null
        ? null : +(u.aktifDusme * 1000).toFixed(1),
      /* NEM PROBUNUN KENDİ SİNYALİ YOK. Probun ayrı bir ekseni yok ve
       * durum paketinde "prob ölçüyor" diye bir bayrak geçmiyor; ölçüm
       * ana Z ile daldırılarak yapılıyor. Prob bu yüzden sabit duruyor. */
      nemSinyali: "yok — probun kendi ekseni ve durum bayrağı yok",
      /* DÖNME YOK. Servo başlıkları taşımıyor, yalnız sırası geleni
       * indiriyor; üçü de kendi sabit yerinde çizili. */
      donme: "yok — servo yalnız sırası gelen başlığı indiriyor",
      gorunur: p.su.visible,
      boy: +p.su.scale.y.toFixed(4),
      y: +p.su.position.y.toFixed(4),
      saydamlik: +p.su.material.opacity.toFixed(3),
      dongu: !!this._akis,
    };
  },

  /** Huzmeyi akar gösteren döngü.
   *
   * YALNIZ pompa açıkken dönüyor. Sürekli çizim Pi'nin GPU'sunda bedava
   * değil; su akmıyorken sahneyi her karede yeniden çizmenin karşılığı yok.
   * Döngü kendini kapatıyor: röle kapanınca bir sonraki karede duruyor.
   */
  _akisBasla(o) {
    if (this._akis) return;
    const adim = () => {
      const p = this._p;
      if (!p || !p.su) { this._akis = null; return; }
      /* Pompayı BURADA da soruyoruz. `guncelle` yalnız durum paketi
       * geldiğinde koşuyor; huzmeyi ona bırakırsak pompa kapandıktan
       * sonra bir sonraki pakete kadar su akmaya devam eder. Kapanışın
       * gecikmesi, açılışın gecikmesinden daha yanıltıcı. */
      const P = window.Panel;
      const akiyor = !!(P && P.S && P.S.roleDurum && P.S.roleDurum.su_pompasi);
      if (!akiyor) {
        p.su.visible = false;
        if (o.kirlet) o.kirlet("su-akisi-bitti");
        this._akis = null;
        return;
      }
      // Damla izlenimi: çapı ve saydamlığı hafifçe nabız gibi değiştiriyoruz.
      const t = (this._faz = (this._faz || 0) + 0.16);
      p.su.material.opacity = 0.34 + 0.12 * Math.sin(t);
      p.su.scale.x = p.su.scale.z = 1 + 0.08 * Math.sin(t * 1.7);
      o.kirlet && o.kirlet("su-akisi");
      this._akis = requestAnimationFrame(adim);
    };
    this._akis = requestAnimationFrame(adim);
  },

  ciz2b(o, c) {
    const k = o.veri.konum;
    if (!k) return;
    const s = o.sinir;
    const ust = o.mm2b(k.x, s.y.min), alt = o.mm2b(k.x, s.y.max);
    // Portal: kiriş Y ekseni boyunca uzanıyor, üstten ince bir çizgi.
    c.strokeStyle = o.makine.renk.cerceve;
    c.lineWidth = 3;
    c.globalAlpha = 0.7;
    c.beginPath(); c.moveTo(ust.x, ust.y); c.lineTo(alt.x, alt.y); c.stroke();
    c.globalAlpha = 1;

    const p = o.mm2b(k.x, k.y);
    c.fillStyle = o.makine.renk.uc;
    c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = "#c3c2b7";
    c.font = "10px ui-monospace, Menlo, Consolas, monospace";
    c.fillText(`X${o.say(k.x, 0)} Y${o.say(k.y, 0)} Z${o.say(k.z, 0)}`, p.x + 11, p.y - 6);
  },
});
