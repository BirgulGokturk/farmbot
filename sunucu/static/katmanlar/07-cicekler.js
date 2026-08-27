/* Çiçekler — çimin üstünde, yatağın çevresinde.
 *
 * İşe yaramaz mı? Sahnenin okunmasına yarıyor: tek renk yeşil bir düzlem
 * ölçek vermiyor, aralara serpilmiş küçük renkli noktalar veriyor. Yine de
 * VARSAYILAN KAPALI — panelin asıl işi makineyi göstermek, süs isteyen
 * açıyor.
 *
 * NEDEN AYRI GEOMETRİ, DOKUYA ÇİZİLMİŞ DEĞİL. Zemin dokusu 150 kez
 * tekrarlanıyor; çiçek dokuya çizilseydi her karoda AYNI çiçekler aynı
 * yerde tekrarlanır, üstelik "yatağın dibinde seyrek, uzakta sık" olması
 * imkânsız olurdu — tekrarlanan bir karo mesafeyi bilmiyor. Maliyeti de
 * korkulan yerde değil: bütün çiçekler tek ağda birleşiyor (1 çizim
 * çağrısı, ~10 bin üçgen) ve ekranda kapladıkları piksel alanı çok
 * küçük. Ölçüm: açıkken/kapalıyken kare hızı aynı (bkz. commit notu).
 *
 * Kapatınca hepsi gidiyor: çekirdek grubu boşaltıp geometriyi atıyor.
 * Doku (tek çiçek başı, 64×64) önbellekte kalıyor — o zaten tek ve
 * yeniden üretmenin bir karşılığı yok.
 */
Tarla.katman({
  kimlik: "cicekler",
  ad: "Çiçekler",
  varsayilan: false,

  /** Palet. Beyaz-sarı-pembe-mor: bir çayırda gerçekten görülen dört
   *  renk. Kırmızı bilerek yok — sahnede kırmızı DURUM rengi (acil
   *  durdurma, hata) ve süs olarak kullanılırsa anlamı sulanıyor. */
  /* Palette İKİ beyaz vardı ve uzaktan bakınca çiçekten çok kâğıt parçası
   * gibi okunuyorlardı. Beyaz tek tona indi, yerine doygun bir sıcak ton
   * geldi; pembe ve mor da bir kademe koyulaştı. Çiçeğin dokusu zaten
   * beyaz, renk buradan geliyor — soluk seçersek doku onu iyice yıkıyor. */
  RENKLER: ["#f0eee6", "#e8c73f", "#f2d968", "#e2734f",
            "#dd7aa6", "#c9639a", "#8c5cc4", "#6f86d6"],

  /** Çiçek alanı: yatağın kenarından bu kadar uzağa kadar. Pus 10 m'de
   *  bittiği için ötesini çizmek boşuna. */
  IC: 0.55,
  DIS: 9.0,
  ADET: 5200,
  /* Öbek sayısı ve yarıçapı (m); SERPME = hiçbir öbeğe girmeyen oran.
   *
   * İlk denemede 46 öbek / 0,75 m yarıçap / %15 serpme vardı ve sonuç
   * öncekinden KÖTÜ oldu: seyrek çimenlikte birbirinden kopuk konfeti
   * yığınları. Öbeklenme fikri doğru ama ölçek yanlıştı — kır çiçeği
   * avuç içi büyüklüğünde küçük topluluklar yapar, metrelik yığınlar
   * değil. Çok sayıda küçük öbek + yüksek serpme oranı, gözün "kümelenme"
   * diye okuduğu ama yığın görmediği dağılımı veriyor. */
  OBEK: 260,
  OBEK_R: 0.28,
  SERPME: 0.45,

  guncelle(o) {
    const THREE = o.THREE;
    const D = window.FarmbotDoku;
    if (!D) return;
    const zeminY = (o.makine.tabla - o.makine.ayak) * o.MM + 0.004;
    // İmza: zemin yüksekliği ve yatak ölçüsü. Nokta eklenip silindikçe
    // katmanlar yeniden güncelleniyor; binlerce çiçeği her seferinde
    // kurmak Pi'de boşuna iş.
    const imza = `${zeminY.toFixed(4)}|${o.genislikM}|${o.derinlikM}`;
    if (imza === this._imza && o.grup.children.length) return;
    this._imza = imza;
    o.bosalt(o.grup);

    const rast = D.uretec(D.tohumla("cicek-tarlasi"));
    const yariEn = o.genislikM / 2, yariBoy = o.derinlikM / 2;

    /* Konumlar. Reddetmeli örnekleme: disk içinde rastgele nokta seç,
     * merkeze yakınsa çoğunlukla ele. Yoğunluk yarıçapla artıyor —
     * "yatağın hemen dibinde seyrek, uzaklaştıkça sık". Yatağın dik
     * dörtgeni ayrıca tamamen dışarıda: makinenin altından çiçek
     * çıkması saçma olurdu. */
    // Tek geçerli nokta üretir; kurallara uymazsa null döner.
    const nokta = () => {
      const a = rast() * Math.PI * 2;
      // sqrt: disk üzerinde eşit alan yoğunluğu
      const r = this.IC + (this.DIS - this.IC) * Math.sqrt(rast());
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < yariEn + 0.12 && Math.abs(z) < yariBoy + 0.12) return null;
      // Yoğunluk payı: yatağın dibinde ~%45, 4 m'den sonra tam.
      // Kare değil doğrusal olsaydı geçiş fark edilmez, kübik olsaydı
      // yatağın çevresinde çiçeksiz bir halka görünürdü.
      const pay = o.kis((r - this.IC) / 3.2, 0, 1);
      if (rast() > 0.45 + 0.55 * pay * pay) return null;
      return [x, z];
    };

    /* ÖBEKLENME. Çiçekler eşit serpilince sahneye konfeti gibi düşüyordu;
     * kır çiçeği öbek öbek büyür. Önce öbek merkezleri seçiliyor, çiçeklerin
     * çoğu bir merkezin çevresine düşüyor, azı serpme kalıyor. Sayı aynı —
     * değişen tek şey dağılım, ama görüntüyü belirleyen de o. */
    const obek = [];
    for (let i = 0; i < this.OBEK * 4 && obek.length < this.OBEK; i++) {
      const p = nokta();
      if (p) obek.push(p);
    }

    const yer = [];
    let deneme = 0;
    while (yer.length < this.ADET && deneme < this.ADET * 60) {
      deneme++;
      let p;
      if (!obek.length || rast() < this.SERPME) {
        p = nokta();
      } else {
        const merkez = obek[(rast() * obek.length) | 0];
        // İki rastgelenin ÇARPIMI: öbek merkezine doğru toplanıyor.
        // Düz rastgele olsaydı öbek de kendi içinde eşit dağılır,
        // yalnızca daha küçük bir konfeti olurdu.
        const a = rast() * Math.PI * 2;
        const r = this.OBEK_R * rast() * rast();
        p = [merkez[0] + Math.cos(a) * r, merkez[1] + Math.sin(a) * r];
        if (Math.abs(p[0]) < yariEn + 0.12 && Math.abs(p[1]) < yariBoy + 0.12) p = null;
      }
      if (p) yer.push(p);
    }

    if (!yer.length) return;
    const n = yer.length;
    const poz = new Float32Array(n * 12);
    const nor = new Float32Array(n * 12);
    const uv = new Float32Array(n * 8);
    const ren = new Float32Array(n * 12);
    const ind = new Uint32Array(n * 6);
    const renk = new THREE.Color();
    // Sahnedeki güneşin yönü (tarla.js/isik.position), birim boy.
    const L = (() => { const v = [2.6, 3.4, 1.6];
      const u = Math.hypot(v[0], v[1], v[2]); return [v[0] / u, v[1] / u, v[2] / u]; })();

    for (let i = 0; i < n; i++) {
      const [x, z] = yer[i];
      /* 2-5 cm gerçek papatya ölçüsü ama ekranda birkaç piksel: çiçek
       * olduğu okunmuyordu. 3,5-7,5 cm de yetmedi — kamera yataktan
       * ~1,5 m uzakta, çiçek alanı 9 m'ye kadar gidiyor, yani çiçeklerin
       * çoğu zaten uzakta. 6-12 cm tek bir çiçek başı için iri ama sahne
       * ölçeğinde bir çiçek TUTAMI kadar; renk lekesi olarak okunması
       * bundan önemli. */
      const boy = 0.060 + rast() * 0.060;
      const sapma = rast() * Math.PI * 2;
      /* Eğim: 0 = çime yapışık, π/2 = dik. 7°-33° arası, yani çoğunlukla
       * YUKARI bakıyorlar. 25°-55° denendi: panelin varsayılan kamerası
       * zaten yukarıdan bakıyor, o kadar dik duran çiçeklerin yarısı
       * yandan görünüp ince bir dilime iniyordu. */
      const egim = 0.12 + rast() * 0.45;
      const cs = Math.cos(egim), sn = Math.sin(egim);
      const d = [Math.sin(sapma), 0, Math.cos(sapma)];        // yatay yön
      const sag = [Math.cos(sapma), 0, -Math.sin(sapma)];
      const ust = [d[0] * cs, sn, d[2] * cs];
      // Normal = ÜST × SAĞ.
      const nx = ust[1] * sag[2] - ust[2] * sag[1];
      const ny = ust[2] * sag[0] - ust[0] * sag[2];
      const nz = ust[0] * sag[1] - ust[1] * sag[0];
      const my = zeminY + boy * 0.5 * sn;

      renk.set(this.RENKLER[(rast() * this.RENKLER.length) | 0]);
      /* Işık KÖŞE RENGİNE pişiriliyor, malzeme ışıksız (bkz. aşağıda).
       * Sebep: iki yüzlü bir malzemede three.js arka yüzün normalini
       * ters çeviriyor; dörtgenin sarımı kameraya ters bakan çiçeklerin
       * normali aşağı dönüp ışığı hiç almıyor ve çimde SİYAH lekeler
       * olarak görünüyorlardı. Çiçeğin hangi yüzünü gördüğümüz bir
       * çiçeğin ne kadar aydınlık olduğunu değiştirmemeli. */
      const isik = 0.52 + 0.48 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      // Aynı paletten çıkan çiçekler birebir aynı olmasın
      const par = (0.86 + rast() * 0.26) * isik;

      const kose = [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0],
                    [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]];
      for (let k = 0; k < 4; k++) {
        const [u, v, tu, tv] = kose[k];
        const j = (i * 4 + k) * 3, jt = (i * 4 + k) * 2;
        poz[j] = x + sag[0] * u * boy + ust[0] * v * boy;
        poz[j + 1] = my + ust[1] * v * boy;
        poz[j + 2] = z + sag[2] * u * boy + ust[2] * v * boy;
        nor[j] = nx; nor[j + 1] = ny; nor[j + 2] = nz;
        ren[j] = renk.r * par; ren[j + 1] = renk.g * par; ren[j + 2] = renk.b * par;
        uv[jt] = tu; uv[jt + 1] = tv;
      }
      const t = i * 4, q = i * 6;
      ind[q] = t; ind[q + 1] = t + 1; ind[q + 2] = t + 2;
      ind[q + 3] = t; ind[q + 4] = t + 2; ind[q + 5] = t + 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(poz, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(ren, 3));
    geo.setIndex(new THREE.BufferAttribute(ind, 1));

    if (!this._mal) {
      /* Işıksız malzeme: aydınlık zaten köşe renginde. Çiçek başı birkaç
       * piksel; gerçek gölgelendirmenin gözle görülür karşılığı yok,
       * karşılığında iki yüzlü normal sorunu da ortadan kalkıyor.
       *
       * alphaTest + transparent:false: saydam sıralaması yapılmıyor —
       * binlerce küçük dörtgeni her karede sıralamak asıl pahalı iş
       * olurdu. Eşik DÜŞÜK: mipmap'te uzaktaki çiçeğin alfası komşu
       * saydam piksellerle ortalanıyor, 0.45'te çiçekler bir iki metre
       * ötede tamamen kayboluyordu. */
      this._mal = new THREE.MeshBasicMaterial({
        map: D.cicek(THREE), alphaTest: 0.22, transparent: false,
        side: THREE.DoubleSide, vertexColors: true,
      });
    }
    const ag = new THREE.Mesh(geo, this._mal);
    ag.castShadow = false;      // çim üstünde 3 cm'lik gölge görünmüyor
    ag.receiveShadow = false;
    ag.raycast = () => {};      // tıklama hedefi değil
    ag.name = "cicekler";
    o.grup.add(ag);
  },
});
