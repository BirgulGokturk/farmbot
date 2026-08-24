# Uçtan uca doğrulama raporu

Prompt dizisinin tamamı (0–7) uygulandı ve sahte PLC + sahte Arduino + sahte
kamera ile test edildi. **32/32 uçtan uca kontrol geçti**, buna ek olarak
modül testleri: ifade değerlendirici 40/40, bölge denetimi 9 senaryo, uç
değiştirme 9 senaryo, mevcut hata düzeltmeleri 4/4.

Proje 5.753 satır (Chart.js hariç). Eklenen yeni modüller: `ajan/kosul.py`,
`ajan/bolgeler.py`, `ajan/uclar.py`, `ajan/dizi.py`, `ajan/kamera.py`,
`sunucu/noktalar.py`, `sunucu/programlar.py`, `sunucu/kareler.py`.

---

## 1. Doğrulama sonuçları

| Ne | Sonuç |
|---|---|
| Konum isimle kaydedildi, listeden gidildi, silindi | ✓ |
| Sınır dışı nokta silinmedi, uyarıyla işaretlendi, hareket reddedildi | ✓ |
| Izgara önizlemesi: 12 nokta, 4'ü sınır dışı, üzerine yazılacaklar | ✓ |
| Izgara aynı nokta deposuna yazıldı (ayrı yapı yok) | ✓ |
| Bölge: hedef içerideyken koşul sağlanmadı → RED | ✓ |
| Bölge: koşul sağlanınca aynı hedefe İZİN | ✓ |
| Bölge: bozuk ifade → hareket engellendi (fail-closed) | ✓ |
| Bölge: yol denetimi — uçlar dışarıda, yol içeriden geçiyor → RED | ✓ |
| Jog ileri bakış — eksen bölgeye girmeden durdu | ✓ |
| Uç dizisi 7 adımın hepsi göründü, uç takıldı | ✓ |
| Adım doğrulama — eksen varmazsa dizi durdu, sonraki adıma geçmedi | ✓ |
| Sensör yokken "doğrulanamadı" dedi, "başarılı" demedi | ✓ |
| Yuva esnetmesi dizi bitince kapandı; yuva olmayan bölge dizide de engelledi | ✓ |
| Program: 6 adım hatasız tamamlandı | ✓ |
| Program: çözülemeyen nokta varsa dizi hiç başlamadı | ✓ |
| Acil durdurma diziyi 2. adımda kesti, mandalladı, sürücüleri kesti | ✓ |
| Mandal temizlenmeden dizi yeniden başlamadı | ✓ |
| Kamera: kare geliyor, sayısı 12 ile sınırlı, JPEG dönüyor | ✓ |

---

## 2. Mevcut kodda bulunan ve DÜZELTİLEN hatalar

### H1 — `home()` üç ekseni aynı anda referansa gönderiyordu (ciddi)

Eksenler arasında beklenmiyordu: Z hâlâ hareket hâlindeyken X ve Y referans
aramaya başlıyordu — uç aşağıdayken yatay hareket, tam olarak Z kilidinin
önlemeye çalıştığı şey. Artık sıra Z → X → Y ve her eksene `home_bekleme_sn`
(varsayılan 8 sn) tanınıyor. Bekleme iptal edilebilir: acil durdurma
referans aramayı 0,05 saniyede kesiyor.

**Gerçek makinede `home` denemeden önce bu düzeltme şarttı.**

### H2 — Jog ile süren hareket çakışabiliyordu

`git` arka planda yürürken jog aynı register'lara yazıyordu. Artık süren
hareket varken jog reddediliyor; buna karşılık **bir noktaya giderken başka
bir noktaya tıklamak** artık çalışıyor (yeni hareket öncekini iptal edip
yerine geçiyor) — operatörün kastı "önce durdur" değil, "oraya değil buraya".

### H3 — Hareket sırasında gereksiz Modbus trafiği

Bekleme döngüsü 50 ms'de bir üç eksenin de konumunu okuyordu. Artık yalnız
beklenen eksen okunuyor; durum döngüsü ise üç ekseni **tek** Modbus
işleminde alıyor (1026–1063 aralığı, 38 register).

### H4 — Y ekseni üst sınırı

`gantry_calib.json` 600 diyordu, `gantry_studio.py`nin kod içi yedeği 550.
Talimatınız üzerine **550**'ye çekildi.

### Yeni bulunan: bayat iptal bayrağı (yarış durumu)

Durdurulan bir dizinin temizlik adımı (`plc.dur()`) iptal bayrağını yeniden
kaldırıyor, hemen sonra başlatılan **yeni** dizi ilk adımında "durduruldu"
diye ölüyordu. Bayrağı artık yalnızca onu son kullanan iş parçacığı bırakıyor.
Bu hata testte yakalandı, sahada "bazen dizi başlamıyor" olarak görünürdü.

### Yeni bulunan: sabit 45 saniyelik eksen zaman aşımı

550 mm'lik bir Y yolculuğu 5 mm/s hızda 110 saniye sürer ve hareket
başarılıyken "ulaşamadı" denirdi. Süre artık mesafe ve hıza göre
hesaplanıyor (mesafe/hız × 3 + 10 sn, 20–300 sn arası).

### Yeni bulunan: bölge ihlalinden çıkamama

Makine bir bölgenin içinde koşulu sağlamadan kalırsa (elektrik kesintisi,
bölge sonradan tanımlandı) her hareket engelleniyordu — çıkış hamlesi dahil.
Artık bu durumda **yalnızca Z'yi yukarı almaya** izin var; açıklığı ancak
artırabilecek tek hareket bu. Yanlamasına sürüklenme engelli kalıyor.

---

## 3. Referansta bulunan, bizde tekrarlanmayan iki sorun

1. **`zone_block` yalnızca son hedefi denetliyor.** Başlangıç ve hedef bölge
   dışında olsa bile yol bölgenin ortasından geçebiliyor. Bizde hareketin
   her parçası örnekleniyor; jog'da ise ileriye bakılıyor.
2. **`tool_pickup` bazı adımların dönüşünü denetlemiyor** (`move_yx`
   çağrıları). Eksen hedefe varmasa da dizi devam ediyor — uç değiştirmede
   bu, kilit açılmadan kalkmaya çalışmak demek. Bizde her adım doğrulanıyor.

Ayrıca referans, dizi boyunca **bütün** bölge denetimlerini kapatıyor
(`_TOOL_MOVE`). Bizde esnetme yalnızca `yuva: true` işaretli bölgeleri
kapsıyor, dizi bitince/hata verince/acil durdurmada anında kapanıyor ve
panelde rozetle görünüyor.

---

## 4. Bulunan ama DÜZELTİLMEYEN sorunlar

Bunlar bilinçli olarak açık bırakıldı; sessizce geçilmedi.

### S1 — Y ekseni üst sınırı hâlâ ölçülmedi (ciddi)
550 değeri sizin bildirdiğiniz değer, ölçülmüş değil. İki kaynak
çelişiyordu. **Y'de 500 üstüne ilk kez çıkarken elinizi acil stopta tutun.**

### S2 — Uç değiştirme doğrulanamıyor (ciddi)
`presence_reg`, `lock_reg`, `grip_reg` hepsi **0** — donanım bağlı değil.
Bu haldeyken servo komutu sessiz bir no-op ve varlık sensörü ucun takıldığını
doğrulayamıyor. Dizi çalışıyor, sonunda "doğrulanamadı" diyor. Yazılımdan
çözülebilecek bir şey değil; register'lar eşlenene kadar **ilk denemede
yuvaya uç koymayın.**

### S3 — Referans arama bir doğrulama değil, süreli bekleme
PLC'de "referans tamam" biti eşlenmemiş. Bir eksen `home_bekleme_sn`den uzun
sürerse sıradaki eksen o hâlâ hareket ederken başlar. Varsayılan cömert
(8 sn) ama gerçek çözüm PLC'de bir "homing done" biti eşlemek.

### S4 — Bölge yolu örnekleniyor, kesin kesişim hesaplanmıyor
Yol her 10 mm'de bir örnekleniyor. Hareket yönünde 10 mm'den ince bir bölge
teorik olarak atlanabilir. Pratikte bölgeler on santimetrelerce; yine de
ince bölge tanımlamayın ya da `ORNEK_ARALIK_MM` değerini düşürün.

### S5 — Dizi ortasında durdurma, ucu yarı kavramış bırakabilir
Uç dizisi servo kilitlendikten sonra durdurulursa uç ne yuvada ne kafada
sayılır. Otomatik kurtarma yok — panelde ne olduğu yazıyor, kararı operatör
veriyor. Otomatik kurtarma denemesi, bilinmeyen bir durumda kör hareket
demek olurdu.

### S6 — İki panel aynı anda düzenlerse son kaydeden kazanır
Bölge ve program düzenlemede çakışma denetimi yok. Tek kullanıcılı bir
kurulumda sorun değil; iki kişi aynı anda düzenlerse biri diğerinin
değişikliğini sessizce eziyor.

### S7 — Kamera geçmişi panelde gezilemiyor
Son 12 kare saklanıyor ve `/api/kare/liste` ile listelenebiliyor ama panelde
yalnızca son kare gösteriliyor. Geriye bakma arayüzü yok.

### S8 — Yetkilendirme tek parola
Panel parolasını bilen herkes makinenin tam kontrolüne sahip. Yerel ağ için
kabul edilebilir; internete açarsanız (Tailscale dışında) yetersiz.

### S9 — Fide durumu ve otomatik sulama taşınmadı
Referanstaki `measure` / `water` / `planted` adımları, crop kütüphanesi ve
nem eşiği mantığı kapsam dışı bırakıldı. Nem ölçüm ucu bağlanınca sıradaki iş.

---

## 5. Gerçek makineye geçerken

1. `gantry_studio.py` **kapalı** olmalı — iki program aynı register'lara yazamaz.
2. Önce `tanila.py`: konum okumaları şeritle ölçtüğünüzle uyuşuyor mu?
3. Acil stop elinizin altında; Z ile başlayın (`dir` −1, ters giderse hemen belli olur).
4. `home` düzeltildi ama yine de ilk denemede her ekseni **tek tek** çalıştırın
   (`home` komutuna `{"eksen":"z"}` verebilirsiniz).
5. Yasak bölgeleri uç yuvalarının etrafına **uç değiştirmeyi denemeden önce**
   tanımlayın; `yuva` kutusunu işaretlemeyi unutmayın.
6. Uç değiştirmeyi en son deneyin ve **ilk denemede yuvaya uç koymayın** —
   dizi boş yuvayla baştan sona geçsin, sonra gerçek uçla.
