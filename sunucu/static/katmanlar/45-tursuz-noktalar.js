/* Türsüz noktalar — bitkinin ALTINDA duran çıplak kayıtları görünür kılıyor.
 *
 * SORUN. Bitkiler ve çıplak noktalar aynı depoda duruyor; ayıran tek şey
 * `tur` alanının yazılı olması. Izgara üreteci türü ancak sonradan yazmaya
 * başladı, ondan önce üretilmiş ızgaralar türsüz kaldı. Aynı koordinatlara
 * bitki eklenince her bitkinin ALTINDA türsüz bir nokta oluştu: ekranda
 * bitki onu örtüyor, kutu seçimi ikisini birden alıyor ve kullanıcı altı
 * bitki seçtiğini sanırken panel "12 seçili" diyor.
 *
 * BU KATMAN ONLARI SÖYLÜYOR. Türsüz her noktanın çevresine menekşe bir
 * halka çiziyor; bitkinin gövdesi halkayı örtmesin diye halka yerde ve
 * bitkinin yayılım çemberinden geniş değil, ama bitkinin ALTINDAN çıkacak
 * kadar dışarıda. Bir bitkinin üstünde duran nokta AYRICA işaretleniyor
 * (kesikli değil dolu halka): "tek başına duran referans noktası" ile
 * "bitkinin altında unutulmuş ızgara noktası" aynı şey değil ve
 * temizlenecek olan ikincisi.
 *
 * NEDEN AYRI KATMAN. `50-noktalar.js` bütün çıplak noktaları çiziyor ve
 * onu değiştirmek başka bir oturumun dosyasına dokunmak olurdu. Katman
 * mimarisinin sözü de bu: yeni bir görünüm = yeni bir dosya. Kapatılabilir
 * olması ayrıca işe yarıyor — temizlik bitince bu katmanın söyleyeceği bir
 * şey kalmıyor.
 *
 * Kutu seçimine GİRMİYOR (`secilebilir` yok): aynı noktalar zaten
 * `50-noktalar.js` üzerinden seçilebiliyor, ikinci kez eklemek onları
 * listede çift gösterirdi.
 */
Tarla.katman({
  kimlik: "tursuz",
  ad: "Türsüz noktalar",
  varsayilan: true,

  /* RENK. Menekşe, paletteki hiçbir şeyle karışmadığı için seçildi: yeşil
   bitki, mavi seçim, gri çıplak nokta, kehribar yayılım çemberi ve sulama,
   kırmızı tehlike. Bu halkalar bunların hiçbiri değil — "buna bakman
   gerekiyor" diyen ayrı bir işaret. */

  /** Bir noktanın "bitkinin altında" sayılması için en çok bu kadar uzak
   *  olması gerekiyor (mm). Sunucudaki `TURSUZ_YARICAP_MM` ile AYNI sayı:
   *  ekranda işaretlenenle temizlikte silinecek olan ayrışmasın. */
  YARICAP_MM: 25,

  liste(o) {
    return o.veri.noktalar.filter((n) => n && !n.tur);
  },

  /** Bu türsüz noktanın altında durduğu bitki — yoksa null. */
  altindaki(o, n) {
    const r = this.YARICAP_MM;
    return o.veri.noktalar.find(
      (b) => b && b.tur && Math.hypot(b.x - n.x, b.y - n.y) <= r) || null;
  },

  guncelle(o) {
    o.bosalt(o.grup);
    const liste = this.liste(o);
    if (!liste.length) return;
    // İki malzeme: yalnız duran nokta soluk, bitkinin altındaki belirgin.
    // Ayrım işe yarıyor çünkü temizlenecek olan ikincisi.
    const solukMal = new o.THREE.MeshBasicMaterial({
      color: "#8f6fc0", transparent: true, opacity: 0.6,
      side: o.THREE.DoubleSide, depthWrite: false });
    const uyariMal = new o.THREE.MeshBasicMaterial({
      color: "#a06cd5", transparent: true, opacity: 0.95,
      side: o.THREE.DoubleSide, depthWrite: false });

    liste.forEach((n) => {
      const ustte = !!this.altindaki(o, n);
      const halka = new o.THREE.Mesh(
        new o.THREE.RingGeometry(0.020, ustte ? 0.028 : 0.024, 28),
        ustte ? uyariMal : solukMal);
      halka.rotation.x = -Math.PI / 2;
      // Bitkinin gövdesi bunu örtmesin diye toprağın hemen üstünde ama
      // nokta katmanının halkasından yukarıda duruyor.
      halka.position.y = 0.006;
      halka.raycast = () => {};      // tıklama 50-noktalar.js'te çözülüyor
      const al = o.dikimAlani(n.x, n.y);
      const dy = (al && al.toprak_z != null) ? (Number(al.toprak_z) - o.toprakZ) * o.MM : 0;
      halka.position.y += dy;
      halka.position.x = o.sx(n.x);
      halka.position.z = o.sz(n.y);
      o.grup.add(halka);
    });
  },

  ciz2b(o, c) {
    this.liste(o).forEach((n) => {
      const p = o.mm2b(n.x, n.y);
      const ustte = !!this.altindaki(o, n);
      c.beginPath();
      c.arc(p.x, p.y, ustte ? 11 : 9, 0, Math.PI * 2);
      c.strokeStyle = ustte ? "#a06cd5" : "#8f6fc0";
      c.lineWidth = ustte ? 2 : 1.25;
      // Yalnız duran nokta KESİKLİ: "bu normal, referans noktası olabilir".
      // Bitkinin altındaki DÜZ: "buna bakman gerekiyor".
      c.setLineDash(ustte ? [] : [3, 3]);
      c.stroke();
      c.setLineDash([]);
    });
  },
});
