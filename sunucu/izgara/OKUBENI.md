# izgara — makinenin kendi hareketiyle piksel↔mm kalibrasyonu

Makine bilinen noktalara gider, her durakta kare alınır, kafadaki işaret
bulunur. Ortaya (piksel, mm) çiftleri çıkar ve model bunlardan kurulur.
Prob ile etiket merkezi ölçmek yok: **makinenin enkoderi zaten gerçek
değerdir ve zaten istediğiniz eksendedir.**

Hiçbir mevcut dosyayı değiştirmez. `goruntu.py`, `filiz.py`, `tespit.py`,
`kalibrasyon.py`, `gorus/` — hiçbirine dokunulmadı; bu ayrı bir paket.

## Neden ızgara

Benzetimde ölçüldü (`python3 -m izgara.cli test`, donanım gerekmez):

| kalibrasyon | bağımsız noktalarda hata |
|---|---|
| 4 etiket + yalın homografi | **6.16 mm** ort / 10.59 mm maks |
| 6 nokta + distorsiyon | 0.194 mm |
| 12 nokta + distorsiyon | **0.055 mm** |
| 24 nokta | 0.050 mm |
| 48 nokta | 0.044 mm |

Dört etiketin kendi üstündeki artık **0.0000 mm** çıkıyor. Bu doğruluk
değil, matematiksel zorunluluk: homografi 8 serbestlik, radyal
distorsiyon 2 daha; 4 nokta 8 kısıt verir ve 10 bilinmeyeni çözemez.
Distorsiyon hatası homografinin içine emilir ve **görünmez**. Beşinci
noktadan sonra görünür.

12 noktadan sonrası konum doğruluğuna az katıyor; fazlası gürültüye
karşı pay bırakıyor. **4×6 = 24 makul.**

## İki model

**`duzlem`** — tek yükseklikte nokta toplandıysa. Homografi + distorsiyon.
Yalnız o yükseklik için geçerli.

**`uzay`** — en az iki yükseklikte toplandıysa. Tam kamera modeli.
Her yükseklik için ayrı geçerli, **paralaks çözülür**:

| yaprak yüksekliği | `duzlem` | `uzay` |
|---|---|---|
| 0 mm | 0.05 mm | 0.002 mm |
| 10 mm | 9.46 mm | 0.002 mm |
| 20 mm | 19.37 mm | 0.002 mm |
| 30 mm | 29.75 mm | 0.002 mm |
| 50 mm | 52.06 mm | 0.002 mm |

Yani topraktan yüksekteki yaprak, düzlem modelinde **boyu kadar** yanlış
yerde görünüyor. Panelinizin şu anki ortalama sapması 19.57 mm — bu
tablodaki 20 mm satırına çok yakın.

Model tek yükseklikte kurulduysa `px2mm(..., h_mm=20)` çağrısı **hata
verir**, sessizce sıfır saymaz.

## Donanım hazırlığı

**İşaret.** Makine kafasına, yukarı bakacak şekilde bir AprilTag 36h11.
Yataktaki kalibrasyon etiketleriyle (0, 1, 8, 9) **çakışmayan** bir
kimlik seçin — varsayılan 23. Kenar 30–40 mm yeterli (0.27 mm/px'te
~130 piksel). Daire de olur (`DaireBulucu`) ama benzer koyu lekelerle
karışabilir; AprilTag kimliğini doğrular.

**İki sayıyı ölçün.** Kalibrasyonun tamamı bunlara dayanıyor:

- `z_toprak_mm` — probun toprağa **değdiği** makine Z'si
- `isaret_ofset_mm` — prob toprağa değerken işaretin toprak yüzeyinden
  yüksekliği (kumpasla)

Yükseklik yanlış girilirse:

| h hatası | sonuç |
|---|---|
| 1 mm | 0.40 mm |
| 2 mm | 0.80 mm |
| 5 mm | 1.99 mm |
| 10 mm | 3.79 mm |

**Bekleme.** Hareketten sonra titreşim sönmeden kare almayın; bulanık
kare işaretin merkezini kaydırır. `bekleme_s=1.2` başlangıç değeri.

## Ulaşabileceğiniz doğruluk

Kalibrasyon makinenin kendi tekrarlanabilirliğini geçemez:

| işaret bulma | makine | sonuç |
|---|---|---|
| 0.3 px | 0 | 0.050 mm |
| 1.0 px | 0 | 0.166 mm |
| 0 | 0.25 mm | 0.132 mm |
| 0 | 1.0 mm | 0.529 mm |
| 1.0 px | 0.5 mm | 0.325 mm |
| 2.0 px | 1.0 mm | 0.648 mm |

Uçtan uca denemede (gerçekten çizilen kare, gerçekten aranan etiket,
0.3 mm makine gürültüsü): **0.635 mm**, her yükseklikte aynı.

## Kullanım

### 1. Planı üret

```bash
python3 -m izgara.cli plan --yatak 495 610 --nx 4 --ny 6 \
        --z -202 -172 -o plan.json
```

`--z` makine Z değerleri; ikisi arasındaki fark ~30 mm olsun. **En az
iki yükseklik verin.**

### 2. Hareket ve kare alma işlevlerini bağlayın

Makinenizi buradan sürmüyorum — sizin hareket API'nizi bilmiyorum ve
tahmin etmek yanlış eksene komut göndermek demek. İki işlev yazın:

```python
from izgara.isaret import AprilTagBulucu
from izgara.tur import Tur, tur_planla, noktalari_yaz

tur = Tur(
    git=lambda x, y, z: makineyi_gonder(x, y, z),   # sizin işleviniz
    kare_al=lambda: taze_kare_bgr(),                # sizin işleviniz
    bulucu=AprilTagBulucu(kimlik=23),
    z_toprak_mm=-140.0,
    isaret_ofset_mm=62.0,
)
plan = tur_planla(yatak_mm=(495, 610), nx=4, ny=6, z_listesi=(-202, -172))
noktalar, rapor = tur.calistir(plan, onay=True)     # onay olmadan hareket yok
noktalari_yaz(noktalar, "noktalar.json")
print(rapor)
```

`onay=True` verilmeden **tek adım atılmaz**. Makine hareket edecek;
yolun boş olduğundan emin olun.

Ham noktalar saklanıyor: modeli yeniden kurmak için turu tekrarlamanız
gerekmez.

### 3. Modeli kurun

```bash
python3 -m izgara.cli kur noktalar.json --kare 2160 3840 -o model.json
```

Rapordaki üç şeye bakın:

- `capraz_dogrulama.rms_mm` — **gerçek doğruluk**. Her nokta bir kez
  dışarıda bırakılarak ölçülür; ek nokta gerektirmez.
- `kendi_artigi_rms_mm` — doğruluk **değil**. Model bu noktalara
  uydurulmuş.
- `olcek_degisimi_yuzde` — kameranın eğikliği. Kalibre edilen bölgede
  ölçülür (kare köşelerinde değil; orası ufka yakındır ve anlamsız
  sayı verir).

### 4. Bağımsız doğrulayın

Turda kullanılmamış 5 noktaya makineyle gidin, karede işareti işaretleyin:

```bash
python3 -m izgara.cli dogrula model.json kontrol.json
```

`sistematik_kayma_mm` alanına bakın: ortalama vektörün boyu toplam
hataya yakınsa kayma **sistematik** (orijin/model), sıfıra yakınsa
gürültü.

### 5. Bağlayın — iki seçenek

**Köprü (hiçbir dosya değişmez).** Mevcut `kalibrasyon.py` kaydına
yazılabilecek `harita`/`mm_px` üretir:

```bash
python3 -m izgara.cli kopru model.json --h 0
```

Köprü kayıpsız değil — homografi distorsiyonu temsil edemez. Ölçülen
kayıp: **2.70 mm rms / 6.39 mm maks**. Paralaks düzeltmesi de köprüden
geçmez.

**Tam model.** `izgara.model.Model.yukle()` + `px2mm(px, h_mm=...)`.

| yol | beklenen hata |
|---|---|
| şimdiki (benzerlik, 4 etiket) | 19.57 mm (panelin ölçtüğü sapma) |
| köprü — dosya değişmeden | ~2.7 mm |
| tam model bağlanırsa | ~0.5 mm |

### Tek nokta sorgulamak

```bash
python3 -m izgara.cli sorgu model.json --px 1040 1810 --h 20
```

Piksel kalibre edilen bölgenin dışındaysa **uyarır**: orası uzatmadır,
hatası ölçülmemiştir. Uçtan uca denemede ızgaranın 40 mm payı dışındaki
noktalarda hata 0.41 mm'den 0.64 mm'ye çıktı — ızgarayı **önemsediğiniz
alanı kapsayacak** kadar geniş tutun.

## Neyi çözmez

- **Kamera oynarsa her şey biter.** Kalibrasyon tarihini panelde gösterin;
  `tespit.kadraj_ortusme()` zaten var.
- **Bitkinin boyunu bilmiyorsanız** `uzay` modeli de tek başına yetmez —
  `h_mm` vermeniz gerekir. Kaba bir tahmin bile düzlem modelinden iyidir:
  h hatası başına ~0.4 mm, h'yi hiç saymamak ise boyu kadar hata.
- Segmentasyon, sınıflandırma, büyüme — hiçbirine karışmaz.

## Sayıların kaynağı

Buradaki tabloların hepsi `izgara/testler/` altındaki benzetimden.
Distorsiyon katsayısını (k1 = −0.28) ben seçtim; sizin lensinizde farklı
çıkar. Değişmeyen şey yapısal olan: **dört noktayla distorsiyon ölçülemez
ve hatası gizli kalır.** Gerçek sayıyı ancak kendi turunuzu atıp
`capraz_dogrula` çalıştırınca öğrenirsiniz.

```bash
python3 -m izgara.cli test     # bütün tabloları yeniden üretir
```
