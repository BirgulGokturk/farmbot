# FarmBot inceleme — ne yapıyorlar, biz ne alalım

Kaynaklar: `farm.bot/pages/software`, `farm.bot/products/farmbot-genesis-xl-v1-8`,
`software.farm.bot/v15/app/*` ve `github.com/FarmBot/Farmbot-Web-App` kaynak kodu.

Amaç özellik listesi kopyalamak değil; hangi yapısal kararların uygulamayı
"profesyonel" hissettirdiğini çıkarmak.

---

## 1. Uygulamanın iskeleti

Bütün uygulama **tek bir haritanın etrafında** kurulu. Harita hiç kaybolmuyor;
sol taraftaki panel içerik değiştiriyor (bitkiler, gruplar, olaylar, noktalar,
yabani otlar, diziler, ayarlar). Kullanıcı bir bitkiyi düzenlerken de haritayı
görüyor, bir dizi yazarken de.

Bizde her sekme bütün ekranı değiştiriyor: Tarla'ya geçince kontroller,
Sür'e geçince tarla kayboluyor. Aradaki fark bu.

**Panel envanteri** (kaynak koddaki üst seviye klasörler):

```
farm_designer  plants  points  point_groups  weeds  zones  crops  curves
sequences  regimens  farm_events  folders  photos  tools  sensors  controls
logs  messages  settings  saved_gardens  three_d_garden  wizard
command_palette  demo  read_only_mode
```

---

## 2. Farm Designer — asıl öğrenilecek yer

### Harita katmanlardan oluşuyor

`frontend/farm_designer/map/layers/` altında her biri bağımsız, tek tek
açılıp kapanabilen katmanlar:

| Katman | Ne gösteriyor |
|---|---|
| Plants | Bitki ikonları, büyüme gölgesi |
| Spread | Yayılma halkaları — OpenFarm verisi varsa yeşil, yoksa 250 mm beyaz |
| Points | Kullanıcının işaretlediği konumlar |
| Weeds | Yabani ot ikonları, kaldırıldı/kaldırılmadı süzgeci |
| Zones | Konum tabanlı grup filtreleri |
| Tool slots | Uç yuvaları ve takılı uç |
| FarmBot | Portal, UTM, uçlar, çevre birimi durumları, **iz geçmişi**, motor yük uyarısı |
| Photos | Fotoğraflar **çekildikleri koordinatta**, tarih süzgeci, kırpma, görüş alanı |
| Readings | Sensör okumaları ölçüldükleri noktada |
| Moisture | Son okumalardan **ara değerlenmiş** toprak nemi haritası |
| Soil | Yükseklik ölçümlerinden ara değerlenmiş toprak yüzeyi |
| Z | Z ekseni konumu ve bahçe seviyeleri |

Kritik nokta: `spread_overlap_helper.tsx` diye ayrı bir dosya var — çakışma
hesabı katmanın içinde, başka hiçbir yeri ilgilendirmiyor. Yeni katman eklemek
= yeni dosya eklemek. Katmanlar birbirini tanımıyor.

### Harita ayarları

- **Dynamic map size** — eksen uzunluklarına göre kendiliğinden ölçekleniyor
- **Map size** — elle mm cinsinden
- **Rotate map** — X/Y yer değiştiriyor (makinenin yanında nereden baktığınıza göre)
- **Map origin** — sıfır noktasının hangi köşede görüneceği (dört çeyrek)

Bu dördü küçük ayrıntılar ama "bu yazılımı makinenin yanında duran biri
düşünmüş" hissini veren şeyler.

### İki kip

- **Move mode** — haritada bir yere tıkla, artı işareti düşsün; Z, hız ve
  güvenli Z ayarlanıp makine oraya gönderilsin
- **Select mode** — **kutu seçimi** ile çoklu seçim, tek tek ekleme/çıkarma,
  seçime **toplu işlem** uygulama; seçim türü bitki/yabani ot/nokta arasında
  değişiyor

Toplu işlem bizde hiç yok ve en çok eksikliği hissedilecek şey bu: 40 fideye
tek tek tıklamak kimsenin yapacağı iş değil.

### Profil görüntüleyici

Ekranın altında, haritada bir yere tıklayınca **X ya da Y ekseninde kesit**
gösteriyor: güvenli yükseklik, toprak yüksekliği ve yakındaki noktalar,
ayarlanabilir genişlikte. Z ekseninde ne olup bittiğini üstten görünümde
anlamanın tek yolu bu.

---

## 3. Diziler (sequences)

Adımlar kategorilere ayrılmış: **Movements · Peripherals and Sensors ·
Image processing · Logic · Advanced**.

Değişken tipleri: **Location, Number, Text, Peripheral, Sensor, Sequence** —
ayrıca "dışarıdan tanımlanan" değişkenler, yani dizi çağrılırken değeri veriliyor.
Bir "sula" dizisi yazıp onu 40 farklı bitkiye uygulamak bu sayede mümkün.

Düzenleme kolaylıkları: renk kodlu **klasörler**, kontrol paneline
**sabitlenmiş diziler**, arama, ve geliştiriciler için ham **CeleryScript**
görünümü.

Ayrıca dizilerin içine **Lua betiği** gömülebiliyor: HTTP isteği, JSON işleme,
donanım kontrolü. Uç kullanıcıya "koda düşmeden özelleştir" kapısı.

## 4. Olaylar ve rejimenler

- **Olay** = bir diziyi ya da rejimeni zamanlar. "En az 1 dakika sonrası",
  "her N birimde bir tekrarla, şu tarihe kadar".
- **Rejimen** = ekim gününe göre hizalanmış takvim (fidenin 3. günü şunu yap,
  10. günü şunu). Olaydan farkı: takvim mutlak saate değil **bitkinin yaşına**
  bağlı.
- Dizi dışarıdan değişken istiyorsa değer olay oluşturulurken veriliyor.

Küçük ama sahadan gelmiş bir ayrıntı: "02:00–04:00 arasına olay koymayın,
sistem güncellemesi o saatte."

## 5. Fotoğraflar

Karusel, en yeni en üstte. Her karede: haritada göster/gizleme, silme,
indirme, kırpma, tam ekran.

Asıl iş **kamera kalibrasyonunda**: fotoğraf haritaya ölçeklenip döndürülerek
**doğru koordinata** oturtuluyor. Üstüne iki uygulama kuruluyor —
**yabani ot tespiti** ve **toprak yüksekliği ölçümü** (görüntüden yükseklik
çıkarıp toprak yüzeyi haritası kuruyor).

## 6. Eğriler (curves)

Su, yükseklik ve yayılma çapı zamana göre eğri olarak tanımlanıyor; şablonlar
var. Yani "günde 200 ml" sabit değil, bitkinin yaşına göre değişen bir eğri.

---

## 7. Donanım — Genesis XL v1.8

| | |
|---|---|
| Çalışma alanı | 3 m × 6 m, bitki yüksekliği ~0,5 m, yatak yüksekliği 0,75–1,5 m |
| Motorlar | 4 × NEMA 17, **döner enkoderli** |
| Aktarma | GT2 kayış + alüminyum kasnak; Z'de 8 mm paslanmaz vidalı mil |
| Kontrol | Raspberry Pi 4 + **Farmduino** (TMC2130 sürücüler), yük algılama |
| Uçlar | Vakumlu tohum enjeksiyonu (luer lock iğneler), solenoid vanalı sulama, döner çapa, toprak sensörü |
| Kamera | IP67 USB kamera + montaj |
| Güç | IP67 110/220 V |
| Depolama | İki adet 3 yuvalı uç rafı |

Bizim makine 425 × 600 mm — onların 1/70'i alanda. Ölçek farkı önemli: onların
tasarımı "40 bitkilik tarla" varsayıyor, bizimki tek kasa. Toplu işlem ve
gruplama bizde de gerekli ama ölçek daha küçük.

---

## 8. Bizde olup onlarda olmayanlar

Bunlar bizi ayıran taraf, korunmalı:

- **Koşullu yasak bölgeler** — `allow_if` ifadeleriyle ("z>=safe_z", "prox",
  "tool!='laser'"). Onların zones'u sadece grup filtresi; hareket engellemiyor.
- **Doğrudan Modbus/PLC kontrolü** — onlarınki kendi firmware'ine g-code
  benzeri komut yolluyor. Bizimki hazır bir endüstriyel PLC sürüyor.
- **Yandan yaklaşımlı uç değiştirme** — adım adım konum doğrulamalı.
- **Arduino'da otonom karar** — internet ve Pi gitse de vana kararı devam ediyor.
  Onlarda bütün karar bulutta.

---

## 9. "Premium" için sıra

Görsel cila değil, aşağıdakiler premium hissi veriyor:

1. **Harita/sahne hiç kaybolmasın.** Sol panel içerik değiştirsin. Şu anki
   sekme yapısı her geçişte bağlamı sıfırlıyor.
2. **Katmanlı harita + aç/kapa.** "Her şey karmaşık" sorununun doğrudan cevabı.
3. **Seç kipi, kutu seçimi, toplu işlem.** Tek tek tıklamayı bitiren şey.
4. **Harita ayarları** — döndürme, sıfır köşesi, dinamik boyut. Küçük ama
   makinenin yanında duran birinin ihtiyacı.
5. **Dizi değişkenleri.** "Şu noktayı sula" yerine "verilen noktayı sula".
6. **Kamera kalibrasyonu** — fotoğrafı haritaya oturtmak. Kamera zaten çalışıyor,
   şu an sadece kare gösteriyoruz.
7. **Profil görüntüleyici** — Z'yi üstten görünümde anlamanın yolu.
8. **Eğriler** — sabit "günde X ml" yerine yaşa göre.
