# gantry_studio özelliklerini Farmbot'a taşıma — adım adım promptlar

Bu belge, `gantry_studio.py`'de olup bizim sistemde olmayan özellikleri sırayla
eklemek için hazırlanmış prompt dizisidir. Her başlığın altındaki kutuyu olduğu
gibi kopyalayıp yeni sohbete yapıştırın; **bir seferde bir tane**, öncekinin işi
bitip çalıştığını gördükten sonra sıradakine geçin.

## Nerede çalıştırılmalı

Bu iş `C:\Users\Birgül\Desktop\farmbot` klasöründe yapılacak — yani bir **Code**
oturumunda, bu klasör açıkken. `farmbot-web` ayrı bir proje; oraya karıştırmayın.

## Sıralama neden böyle

Kolaydan zora değil, **risksizden riskliye** dizildi. Nokta deposu yanlış
çalışırsa bir liste bozulur; uç değiştirme yanlış çalışırsa makine kendine
çarpar. Yasak bölgeler uç değiştirmeden önce geliyor, çünkü dock'lar o
bölgelerin içinde yaşıyor — koruma olmadan dock dizisi yazmak sırasız olur.

## Her prompta geçerli kurallar

Aşağıdaki promptların hepsi bu kısıtları varsayıyor, tekrar yazmanıza gerek yok
(prompt metinlerinin içine zaten kondu):

* Arayüz dili Türkçe, kod ve commit mesajları İngilizce.
* Güvenlik kararları **ajanda** kalır, panelde değil. Panel sadece gösterir.
* Sahte PLC ile test edilmeden gerçek makinede denenmez.
* Ajan çalışırken PLC'ye başka program yazamaz (`gantry_studio.py` kapalı olmalı).

---

## Prompt 0 — Keşif ve plan (kod yazılmayacak)

```
Bu depo (Desktop\farmbot) bir akıllı tarım robotunun kontrol sistemi: sunucu/
FastAPI paneli, ajan/ Raspberry Pi'de çalışıp Modbus TCP ile PLC'ye yazıyor,
firmware/ Arduino sensörleri.

Referans olarak sevgilimin yazdığı gantry_studio.py var — aynı makineyi süren,
tek dosyalık eski bir program. Bizim ajan/plc.py onun register haritasını zaten
birebir taşıyor (X hedef 1024, Y 1034, Z 1054, go 1022, enable 1010, konum 1026;
float çifti, düşük kelime önce). Kalibrasyon da aynı: X 7 cpm, Y 2.2746,
Z 56.8376 dir -1 home 438, sınırlar 425/600/550.

Ama gantry_studio'da bizde olmayan özellikler var:
- /api/store  — kaydedilmiş nokta deposu (gantry_store.json)
- /api/seeds  — tohum/fide ızgarası üretimi (gen_seed_grid fonksiyonu)
- /api/tools  — uç değiştirme dizisi ve YASAK BÖLGELER (gantry_tools.json:
  safe_z, slide_axis, approach, lift, lock_reg, grip_dwell, zones[].allow_if)
- /api/runprog — kayıtlı dizi çalıştırma

ŞİMDİ KOD YAZMA. Şunları yap:
1. Bu depodaki README.md, docs/API.md, ajan/plc.py ve sunucu/main.py dosyalarını
   oku; mevcut komut protokolünü ve güvenlik kurallarını çıkar.
2. gantry_studio.py'yi oku (yolunu ben vereceğim) ve yukarıdaki dört özelliğin
   nasıl çalıştığını anla — özellikle zones[].allow_if ifadelerinin nasıl
   değerlendirildiğini.
3. Bana bir fark analizi ve uygulama planı yaz: her özellik için hangi dosyalara
   dokunulacak, hangi yeni komutlar gerekecek, hangi sırayla yapılmalı.

Kısıtlar: arayüz Türkçe, kod İngilizce. Güvenlik kararları ajanda kalacak,
panelde değil. Hiçbir şey sahte PLC ile test edilmeden gerçek makinede
denenmeyecek.
```

> Bu prompttan sonra size `gantry_studio.py`'nin yolunu soracak. Şunu verin:
> `C:\Users\Birgül\Downloads\gantry_two.zip` içinde — açıp okuyabilir.

---

## Prompt 1 — Nokta deposu

```
Nokta deposunu ekle: kullanıcı makinenin bulunduğu konumu bir isimle kaydedebilsin,
listeden seçip o noktaya gidebilsin, silebilsin.

- Veri sunucuda saklansın (SQLite'a yeni bir tablo ya da JSON dosyası — hangisinin
  daha basit olduğuna sen karar ver ve gerekçesini yaz).
- Sunucuda uçlar: noktaları listele, ekle, sil.
- Panelde Kontrol sekmesinin altına "Kayıtlı noktalar" bölümü: liste, "Bulunduğu
  konumu kaydet" düğmesi, her satırda "Git" ve "Sil".
- "Git" mevcut git komutunu kullansın, yeni bir hareket yolu açma.
- Sınır dışı kalmış bir nokta listede uyarıyla gösterilsin ama silinmesin —
  kalibrasyon değişince eski noktalar sınır dışı kalabiliyor.

Bittiğinde sahte PLC ile test et ve bana panelden ekran görüntüsüyle göster.
```

---

## Prompt 2 — Tohum ızgarası

```
Tohum ızgarası üretimini ekle. gantry_studio.py'deki gen_seed_grid mantığının
aynısı: başlangıç noktası (x0, y0, z), satır/sütun aralığı (dx, dy), satır ve
sütun sayısı verilince isimlendirilmiş nokta listesi üretir.

- Üretilen noktalar Prompt 1'deki nokta deposuna yazılsın, ayrı bir yapı kurma.
- Panelde bir form: başlangıç, aralık, satır/sütun sayısı, önek. Üretmeden önce
  kaç nokta çıkacağını ve kaçının sınır dışı kalacağını göster.
- Sınır dışı noktalar üretilsin ama işaretlensin (gantry_studio'da Y max 550'den
  600'e çıkarılınca ikinci sıra tohumlar limit içine girmişti — bu bilgi kaybolmasın).

Sahte PLC ile test et.
```

---

## Prompt 3 — Yasak bölgeler (güvenlik, uç değiştirmeden ÖNCE)

```
Yasak bölge korumasını ekle. gantry_studio.py'deki zones mantığı: dikdörtgen bir
alan (x1,y1,x2,y2) tanımlanır ve hedefi o alanın içine düşen her hareket, bölgenin
allow_if koşulu doğru değilse REDDEDİLİR.

Kritik: bu denetim AJANDA olacak, panelde değil. Panel çökse, biri API'yi doğrudan
çağırsa bile koruma çalışmalı — mevcut yumuşak sınır ve Z kilidi denetimlerinin
yanına, aynı yere.

- allow_if basit bir ifade: gantry_studio'da kullanılan değişkenler z, x, y, prox
  (varlık sensörü), tool, safe_z, zmax. Örnekler: "z>=safe_z", "prox",
  "tool!='laser'", "z>=safe_z or prox".
- İfadeyi Python eval() ile çalıştırma. Sadece ihtiyacın olan operatörleri
  destekleyen küçük ve güvenli bir değerlendirici yaz (karşılaştırma, and/or/not,
  değişken, sayı, metin sabiti). Bilinmeyen bir isim ya da bozuk ifade gelirse
  koşul FALSE sayılsın — yani hareket engellensin. Güvenlik tarafında hata,
  izin vermek değil engellemek yönünde olmalı.
- Bölgeler panelden düzenlenebilsin ve dosyada saklansın.
- Reddedilen hareket panelde neden reddedildiğini yazsın: hangi bölge, hangi koşul.

Testler şart: sahte PLC ile hem engellenen hem izin verilen durumları test et,
bozuk bir ifadenin hareketi engellediğini de test et. Sonuçları bana göster.
```

---

## Prompt 4 — Uç değiştirme (en riskli, en son)

```
Uç (alet) değiştirme dizisini ekle. gantry_studio.py'deki gantry_tools.json
yapısını referans al: safe_z, slide_axis, approach, travel_z, lift, home_z,
lock_reg, lock_dwell, grip_reg, grip_dwell, presence_reg, tools[] listesi.

Dizi yandan yaklaşmalı: uç yuvasına doğrudan yukarıdan inilmiyor, önce güvenli
yükseklikte yuvanın yanına gidiliyor, sonra slide_axis boyunca approach kadar
kayarak giriliyor. Çıkarken tersi.

Kurallar:
- Prompt 3'teki bölge denetimi bu dizide de geçerli. gantry_studio'da dock'lar
  bölgelerin içinde olduğu için dizi sırasında denetim geçici olarak esnetiliyor
  (_TOOL_MOVE bayrağı). Aynısını yaparsan bunu AÇIKÇA yaz ve yalnızca dizinin
  kendi adımlarını kapsasın, dizi biter bitmez kapansın.
- Her adım öncesi ve sonrası konum doğrulansın; beklenen konuma ulaşılmadıysa
  dizi DURSUN, bir sonraki adıma geçmesin.
- Panelde dizi adım adım gösterilsin, hangi adımda olduğu görünsün.
- Acil durdurma dizinin ortasında da çalışmalı.

Bu özellik makinenin kendine çarpma riski en yüksek olanı. Sahte PLC ile bütün
dizi baştan sona test edilmeden ve her adımın konum doğrulaması görülmeden
gerçek makinede denenmeyecek. Test çıktısını bana göster.
```

---

## Prompt 5 — Kayıtlı dizi çalıştırma

```
Kayıtlı program (dizi) çalıştırmayı ekle: sıralı adımlardan oluşan bir liste
(noktaya git, bekle, röle aç/kapa, servo aç, uç değiştir) kaydedilebilsin ve
tek düğmeyle çalıştırılabilsin.

- Adımlar mevcut komutları kullansın, yeni hareket yolu açma.
- Çalışırken panelde hangi adımda olunduğu görünsün, "Durdur" dizinin ortasında
  da çalışsın.
- Bir adım hata verirse dizi dursun ve nedenini yazsın; sessizce devam etmesin.
- Acil durdurma diziyi anında kessin ve mandal temizlenmeden yeniden başlatılmasın.

Sahte PLC ile uçtan uca test et.
```

---

## Prompt 6 — Kamera (isteğe bağlı)

```
Kamera görüntüsünü ekle: Pi'ye bağlı kameradan periyodik fotoğraf alınıp panelde
gösterilsin. gantry_studio'daki /api/ingest/photo ucunun karşılığı.

- Fotoğraf ajandan sunucuya gitsin, sunucu son kareyi saklasın.
- Panelde Kontrol sekmesinde küçük bir önizleme.
- Disk dolmasın: yalnızca son N kare saklansın.
```

---

## Prompt 7 — Kapanış testi

```
Bütün özellikler eklendi. Şimdi uçtan uca doğrulama yap ve sonucu rapor et:

1. Sahte PLC ve sahte Arduino ile sunucuyu ve ajanı başlat.
2. Sırayla test et: nokta kaydet/git/sil, tohum ızgarası üret, yasak bölge
   engelliyor mu, uç değiştirme dizisi baştan sona, kayıtlı dizi çalıştır,
   acil durdurma dizinin ortasında.
3. Her birinin sonucunu panelden ekran görüntüsüyle göster.
4. README.md'yi güncelle: yeni özellikler ve "Sırada ne var" listesinden
   tamamlananlar.
5. Bulduğun ama düzeltmediğin sorunları ayrıca listele — sessizce geçme.
```

---

## Bittiğinde: gerçek makineye geçiş

Sahte PLC ile hepsi çalıştıktan sonra gerçek makinede denerken:

1. `gantry_studio.py` **kapalı** olmalı — iki program aynı register'lara yazamaz.
2. Acil stop elinizin altında olsun.
3. Z ekseniyle başlayın (dir −1, ters giderse hemen anlarsınız).
4. Uç değiştirmeyi en son deneyin ve ilk denemede yuvaya uç koymayın — dizi boş
   yuvayla doğru hareket ediyor mu, önce onu görün.
