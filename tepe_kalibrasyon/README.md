# Tepe Kamerası Kalibrasyonu

Sabit bir tepe kamerasının karesindeki bir pikselin toprak yüzeyinde hangi milimetreye
denk geldiğini bulur ve **o dönüşümün ne kadar tuttuğunu dürüstçe ölçer**.

Tek işe bakar, hiçbir mevcut koda bağlanmaz: küçük bir yerel sunucu (Python + OpenCV) +
tek bir HTML sayfası.

---

## Kurulum ve çalıştırma

Linux / macOS / Raspberry Pi:

```
./kur.sh
```

Windows:

```
kur.bat
```

Betik sanal ortam kurar, iki paketi yükler (`numpy`, `opencv-contrib-python`), sunucuyu
başlatır ve tarayıcıyı açar. Bir dahaki sefere de aynı komut yeter; kurulu paketleri
tekrar indirmez.

Elle yapmak isterseniz:

```
pip install numpy opencv-contrib-python
python3 sunucu.py
```

> `opencv-python` **yetmez**; AprilTag sözlüğü yalnızca `opencv-contrib-python` içinde var.
> Sunucu bunu açılışta kontrol edip yanlışsa ne yapılacağını yazar.

Kurulumun doğru olduğunu görmek için (sentetik kare üretir, boru hattını çalıştırır,
sayıları basar — kameraya ihtiyaç yok):

```
python3 test_sentetik.py
```

---

## Kullanım

1. **Kare** — dosya seçin ya da kameranın anlık görüntü adresini yazıp *Çek*'e basın.
   *Etiketleri bul*'a basın. Karede bulunan etiketler yeşil çerçeveyle, kayıplar
   üstteki şeritte kırmızıyla görünür.
2. **Ölçüler** — etiketin **siyah karesinin dış kenarını** kumpasla ölçüp girin
   (beyaz çerçeve hariç). Çalışma alanı ölçüleri sadece ızgara çizimi ve akla yatkınlık
   kontrolü için.
3. **Koordinatlar** — her etiketin merkezini probla ölçüp X/Y mm olarak girin.
4. **Doğrulama noktaları (isteğe bağlı ama önemli)** — yataktan birkaç noktayı probla
   ölçün, *Karede nokta işaretle* deyip o noktayı tıklayın, mm değerini girin.
   Bu noktalar uydurmaya **girmez**; verdikleri sayı gerçek hatadır. Nedeni aşağıda.
5. *Dönüşümü hesapla* → sonuçlar solda, yatak sınırı ve 50 mm ızgara karenin üstünde.
   *JSON olarak indir* her şeyi dışa verir.

Tuval: tekerlek yakınlaştırır, sürükleme kaydırır, çift tıklama kareyi sığdırır.

---

## Ne hesaplanıyor

İki model birden kurulur ve ikisinin de hatası ayrı ayrı yazılır.

**Benzerlik (ölçek + dönme + kaydırma, 4 serbestlik).** Kameranın yatağa dik baktığını
varsayar. Sizin kurulumunuzda bu varsayım tutmuyor; modelin hatası size tam olarak bu
varsayımın bedelini söyler. 4 nokta 8 denklem verir, model 4 serbestlik ister — yani
artık *anlamlıdır*, ayrıca bir-dışarıda-bırakma da hesaplanabilir.

**Homografi (projektif dönüşüm, 8 serbestlik).** Perspektifi çözer. Doğru model bu.

### Hata ölçümündeki tuzak

Homografinin 8 serbestliği var, dört etiket 8 denklem veriyor. Uydurma tam belirtilmiş
olduğu için **iç artık matematiksel olarak sıfır çıkar ve hiçbir şey kanıtlamaz.**
Uygulama bu sayıyı gösterir ama yanına neden anlamsız olduğunu yazar; asla "kusursuz
kalibrasyon" diye sunmaz.

Dürüst sayı için üç yol var, uygulama üçünü de kurar:

**1. Bir-dışarıda-bırakma (leave-one-out).** Dönüşüm N−1 noktayla kurulur, dışarıda
bırakılan noktada sapma ölçülür, sıra sıra tekrarlanır.
Dört etiketle homografi için **hesaplanamaz** — üç noktayla homografi kurulamaz
(6 denklem, 8 bilinmeyen). Uygulama uydurma bir değer üretmez, bunu açıkça yazar ve
ne gerektiğini söyler: 5. bir ölçülmüş nokta. Benzerlik modeli için 4 etiketle
hesaplanabilir ve hesaplanır.

Beş veya daha çok noktada homografi LOO'su açılır, ama iki tuzağı daha var ve ikisi de
ölçülüp raporlanıyor:

* *Koşullanma.* Bir nokta çıkarıldığında kalanlar neredeyse aynı doğru üzerinde
  kalıyorsa o katmanın verdiği büyük sayı kalibrasyon hatası değil, geometrinin
  kararsızlığıdır. Ölçüldü: 5. etiket köşegenin üstüne konduğunda LOO 11.0 mm,
  köşegenden uzağa konduğunda 0.88 mm — kalibrasyon aynı kalibrasyon. Uygulama her
  katmanın koşullanmasını hesaplar, dejenereye yakın katmanları ortalamadan dışlar ve
  nedenini yazar.
* *Dışdeğerbiçim.* Dört köşe etiketiyle, dışarıda bırakılan nokta hep kalanların
  oluşturduğu dörtgenin dışında kalır; bu bir ekstrapolasyon sınavıdır ve yatağın
  **içi** için gerçekte olacak hatadan kötümserdir. Uygulama hangi katmanın iç hangisinin
  dış olduğunu işaretler ve varsa iç noktaların RMS'ini ayrıca verir.

**2. Köşe tutarlılığı — dört etiketle bile anlamlı artık.** Homografi yalnızca etiket
*merkezleriyle* uyduruluyor; etiketlerin *köşeleri* uydurmaya girmiyor. O hâlde şu model
kurulabilir: bilinmeyenler = homografi (8) + her etiketin yatak üzerindeki dönme açısı (N)
+ ortak kenar uzunluğu (1); veri = her etiketin 4 köşesi + merkezi = 10N denklem.
Dört etiket için **40 denklem / 13 bilinmeyen** — fazla belirtilmiş, artık anlamlı.
Kenar uzunluğunun serbest bırakılması bilerek: köşe bulmanın sistematik iç sapmasını ve
baskı ölçeği hatasını soğuruyor, geriye kalan artık gerçekten düzlemsellikle ilgili oluyor.

**3. Doğrulama noktaları.** Probla ölçtüğünüz, uydurmaya girmeyen noktalar. En temiz
sayı budur ve yatağın içini ölçtüğü için pratikte en anlamlısıdır.

---

## Etiketler düzlemde mi?

Havada duran bir etiket, eğik kamerada haritayı toprağı değil o hayali yüzeyi öğrenmeye
iter. Uygulama iki bağımsız sinyal verir:

* *Köşe tutarlılığı artığı* (yukarıdaki 2. yol). Ölçüldü: dördü de toprakta iken
  **0.22 mm ≈ 0.31 px**; bir etiket 25 mm yükseltildiğinde **0.61 mm ≈ 0.87 px**.
  Eşik 0.7 px'te uyarı verir.
* *Etiketler arası ölçek yayılımı.* Köşeler mm'ye taşınıp ölçülen kenarla karşılaştırılır.
  Ölçüldü: düzlemde %0.43; bir etiket 25 mm havada %5.37; 50 mm havada %8.76.
  Eşik %2.

**Hangi etiketin suçlu olduğunu söylemez, çünkü söyleyemez.** Homografi dört merkeze
birden uydurulduğu için havadaki etiketin hatası bütün etiketlere dağılıyor; ölçtük,
suçluyu adlandıran her kural yanlış etiketi gösteriyordu. Uygulama "düzlemsellik bozuk"
der ve etiketleri gözle kontrol etmenizi ister.

**Göremediği durum:** dört etiketin hepsi aynı yükseklikte ortak bir tablanın üzerindeyse
kontrol hiçbir şey bulamaz — o da bir düzlemdir, köşeler mükemmel uyar. Harita o zaman
tablanın yüzeyini öğrenir ve görüntüde bunu ele verecek hiçbir iz kalmaz. Ölçüldü:
dördü birden 30 mm yükseltildiğinde artık 0.22 mm, yani düzlemdekiyle aynı.
Bu yalnızca fiziksel olarak doğrulanabilir.

---

## Küçük ve eğik etiketler

Varsayılan OpenCV parametreleri bu etiketleri kaçırıyor. Ayarlananlar ve nedenleri
`kalibrasyon.py` içindeki `_parametreler()` fonksiyonunda tek tek yazılı. Ayrıca ilk geçiş
etiketi bulamazsa kare 2×, hâlâ eksikse 4× büyütülüp yeniden aranır; köşeler her zaman
orijinal çözünürlüğe geri taşınıp orada alt piksel iyileştirilir.

3840×2880 sentetik kareyle ölçülen sonuç (etiket kenarı piksel cinsinden):

| etiket kenarı | varsayılan parametreler | bu uygulama |
|---|---|---|
| 42.8 px | 4/4 | 4/4 |
| 28.8 px | 2/4 | 4/4 |
| 21.1 px | 0/4 | 4/4 |
| 17.2 px | 0/4 | 4/4 (biri 2× geçişinde) |
| 15.9 px | 0/4 | 2/4 |
| 13 px  | 0/4 | 0/4 |

Yani pratik sınır ~17 px etiket kenarı; varsayılanlar ~30 px'in altında pes ediyor.

Alt piksel iyileştirmesi de ölçüldü (40 örnek, bilinen doğru merkeze göre):
açıkken 0.333 px RMS, kapalıyken 0.423 px. Açık kalıyor.

Süre: etiketler ilk geçişte bulunursa ~0.2 s; büyütme geçişlerine düşerse ~5 s.

---

## Dosyalar

| dosya | ne yapar |
|---|---|
| `kalibrasyon.py` | çekirdek: tespit, iki model, hata ölçüleri, düzlemsellik. Arayüzden bağımsız, tek başına içe aktarılabilir. |
| `sunucu.py` | küçük HTTP sunucusu (yalnızca standart kütüphane) |
| `index.html` | arayüz, tek dosya, dış bağımlılık yok |
| `test_sentetik.py` | sentetik kare üretip boru hattını doğrular |
| `ornek_kare.jpg` | testin ürettiği örnek kare |

## JSON çıktısı

`matris_px_to_mm` (3×3) piksel → makine mm; `matris_mm_to_px` tersi. Homojen koordinat:

```
[X*w, Y*w, w] = M · [u, v, 1]      X = X*w / w ,  Y = Y*w / w
```

Yanında iki modelin bütün hata sayıları, katman katman LOO, köşe tutarlılığı, düzlemsellik
kontrolü, kullanılan tespit parametreleri ve ham alt piksel köşeler yer alır.

## Bir şey hesaplanamazsa

Uydurma değer üretilmez. Sebebi yazılır: kaç nokta gerektiği, geometrinin neden dejenere
olduğu, hangi girdinin eksik olduğu. Sıfır artık hiçbir yerde doğruluk diye sunulmaz.
