# gantry_studio özelliklerini Farmbot'a taşıma — fark analizi ve uygulama planı

Bu belge kod içermez. Ne eksik, nereye yazılacak, hangi sırayla ve neden —
bunları netleştirir. Uygulama prompt 1'den itibaren başlar.

Okunanlar: `README.md`, `docs/API.md`, `ajan/plc.py`, `ajan/ajan.py`,
`sunucu/main.py`, `sunucu/static/app.js`, `farmbot-referans/gantry_studio.py`
(2287 satır, tamamı taranıp ilgili bölümler okundu).

---

## 1. Doğrulama — register haritası ve kalibrasyon

İki tarafı programla karşılaştırdım, göz kararı değil. **Fark yok.**

| Eksen | jogf | jogb | go | home | hedef | hız | ivme | yavaşlama | konum |
|---|---|---|---|---|---|---|---|---|---|
| X | 1020 | 1021 | 1022 | 1023 | 1024 | 1006 | 1000 | 1002 | 1026 |
| Y | 1030 | 1031 | 1032 | 1033 | 1034 | 1036 | 1038 | 1040 | 1042 |
| Z | 1050 | 1051 | 1052 | 1053 | 1054 | 1056 | 1058 | 1060 | 1062 |

`enable` = 1010, iki tarafta da aynı.

Prompt'taki "go 1022, konum 1026" ifadesi **yalnızca X ekseni** için doğru;
Y ve Z'nin kendi go/konum register'ları var (yukarıdaki tablo). Kodda üçü de
ayrı ayrı tanımlı, karışıklık yok.

Kalibrasyon — `ajan/gantry_calib.json` ile `plc.py` içindeki yedek değerler
birebir aynı:

| Eksen | cpm | dir | home | sınırlar |
|---|---|---|---|---|
| X | 7.0 | +1 | 0 mm | 0 – 425 mm |
| Y | 2.2746 | +1 | 0 mm | 0 – **600** mm |
| Z | 56.8376 | **−1** | **438 mm** | 0 – 550 mm |

⚠ **Tek tutarsızlık:** `gantry_studio.py` içinde, kalibrasyon dosyası
okunamazsa kullanılan yedek listede **Y max 550** yazıyor; canlı
`gantry_calib.json` ise **600** diyor. Dosya kazanıyor, yani ikisi de 600 ile
çalışıyor — ama hangisinin doğru olduğu ölçülmeli. 50 mm'lik fark, Y ekseninin
sonunda mekanik sınıra dayanmak demek olabilir. **Bu sorulmadan Y'de 550
üstüne komut verilmemeli.**

---

## 2. Özellik karşılaştırması

| | gantry_studio | Farmbot (bugün) |
|---|---|---|
| Eksen hareketi (jog, git, home) | ✔ | ✔ |
| Yumuşak sınırlar | ✔ | ✔ |
| Z güvenlik kilidi | ✔ | ✔ |
| Jog ölü adam sayacı | ✔ | ✔ |
| Acil durdurma mandalı + hedef nötrleme | ✔ | ✔ |
| Sensör okuma / grafik | ✖ (yalnız ham ingest) | ✔ |
| Uzaktan erişim, çok kullanıcılı panel | ✖ (tek sayfa, yerel) | ✔ |
| **Nokta deposu** | ✔ `/api/store` | ✖ |
| **Tohum ızgarası** | ✔ `/api/seeds` | ✖ |
| **Yasak bölgeler (allow_if)** | ✔ `zones` | ✖ |
| **Uç değiştirme dizisi** | ✔ `/api/tools` | ✖ |
| **Program çalıştırma** | ✔ `/api/runprog` | ✖ |
| Kamera | ✔ `/api/ingest/photo` | ✖ |
| Nem ölçümü / sulama register'ları | ✔ | kısmen (Arduino rölesi) |
| CSV veri kaydı | ✔ | ✖ (SQLite geçmişi var) |

Taşınacak dördü kalın. Kamera ayrı (prompt 6). CSV kaydı ve nem register'ları
kapsam dışı — bizde karşılığı zaten başka yoldan var.

---

## 3. Dört özellik — ne yapıyor, bize ne gerekiyor

### 3.1 Nokta deposu (`/api/store`)

**Referansta:** `gantry_store.json` içinde `{"points":[{name,x,y,z}], "programs":[...]}`.
POST gelen listeyi olduğu gibi dosyaya yazıyor — doğrulama yok, sınır kontrolü
yok, aynı isimden iki tane olabiliyor.

**Bizde gerekenler:** isimle kaydet / listele / sil / git. "Git" mevcut `git`
komutunu çağıracak, ikinci bir hareket yolu açılmayacak. Sınır dışı nokta
silinmeyecek, uyarıyla gösterilecek (makine sınırları sonradan daralabilir;
kaydı silmek kullanıcının emeğini çöpe atar).

**Referanstan iyileştirme:** isim tekilliği, boş isim reddi, kaydederken
sınır kontrolü (uyarı olarak, engel değil).

### 3.2 Tohum ızgarası (`/api/seeds` → `gen_seed_grid`)

**Referansta:** `x0,y0,z + dx,dy + rows,cols + prefix` → satır-öncelikli
`s1..sN` isimli noktalar. Aynı isim korunursa `state`/`note`/`crop` alanları
saklanıyor. Ayrıca `gen_bed_fit` (dikdörtgen alana sığdırma) ve crop kütüphanesi
var — bunlar kapsam dışı, sonra gelebilir.

**Bizde gerekenler:** aynı ızgara mantığı, ama üretilen noktalar **nokta
deposuna** yazılacak, ayrı bir yapı kurulmayacak. Üretmeden önce önizleme:
kaç nokta, kaçı sınır dışı. Sınır dışı olanlar üretilecek ama işaretlenecek.

**Dikkat:** ızgara aynı önekle tekrar üretilirse mevcut noktaların üzerine
yazılır. Önizlemede "N nokta üzerine yazılacak" bilgisi de gösterilmeli.

### 3.3 Yasak bölgeler (`zones` + `allow_if`)

**Referansta:** `gantry_tools.json` içinde `zones:[{name,x1,y1,x2,y2,allow_if}]`.
`zone_block(x,y,z)` hedefi dikdörtgenin içinde mi diye bakıyor, içindeyse
`allow_if` koşulunu değerlendiriyor; koşul yanlışsa hareket reddediliyor.
Koşul `eval()` ile çalıştırılıyor — `{"__builtins__":{}}` ile sınırlanmış ama
yine de `eval`. Hata olursa `False` dönüyor (engelle) — bu kısım doğru.

**Bizde gerekenler:**

* Denetim **ajanda**, `plc.py` içinde, mevcut sınır ve Z kilidi denetimlerinin
  yanında. Panel çökse, sunucu düşse, komut başka bir arayüzden gelse de
  koruma çalışır.
* `eval()` yok. Küçük bir değerlendirici: sayı, metin sabiti, değişken,
  `== != < <= > >=`, `and or not`, parantez. Başka hiçbir şey.
* Değişkenler: `z, x, y, prox, tool, safe_z, zmax`.
* **Bilinmeyen isim, bozuk ifade, tip uyuşmazlığı → koşul FALSE → hareket
  engellenir.** Güvenlikte hata izin verme yönünde olmaz.
* Bölgeler panelden düzenlenir, dosyada saklanır.
* Reddedilen hareket hangi bölge ve hangi koşul yüzünden reddedildiğini yazar.

**Referanstan iyileştirme (önemli):** `zone_block` yalnızca **son hedefi**
denetliyor. Bizim hareketimiz Z→Y→X sırasıyla ara duraklardan geçiyor; başlangıç
ve hedef bölge dışında olsa bile **ara nokta bölgenin içinden geçebilir**.
Planda her ara durak ayrı ayrı denetlenecek.

Jog için: her yenilemede mevcut konum + hız × 0,4 sn ileri bakılacak, yani
eksen bölgeye girmeden durdurulacak. Sadece mevcut konuma bakmak, bölgeye
girdikten sonra durmak demek olurdu.

### 3.4 Uç değiştirme (`tool_pickup` / `tool_dropoff` / `tool_change`)

**Referansta** yandan yaklaşımlı kilit dizisi:

```
AL:    Z→travel_z → (Y sonra X) yaklaşma noktasına, yukarıda → Z→engage_z
       → slide_axis boyunca uca kay → servo KİLİTLE → Z→engage_z+lift
BIRAK: Z→travel_z (ucu yukarıda taşı) → yuvanın üstüne → Z→engage_z
       → servo BIRAK → slide_axis boyunca kayarak çık → Z→travel_z
```

Komisyonlanmış değerler: `safe_z`/`travel_z` 340, `approach` −50, `lift` 90,
uçlar Z 182'de, `slide_axis` Y. Uç tepesi 272 mm, travel_z 340 → 68 mm boşluk.

**Referansta gördüğüm iki sorun — bizde tekrarlanmayacak:**

1. `tool_pickup` içinde 1. ve 3. adımlar (`move_yx`) **dönüş değeri
   denetlenmiyor**. Eksen hedefe varmasa da dizi devam ediyor. Bizde her adım
   öncesi ve sonrası konum doğrulanacak, varılmadıysa dizi duracak.
2. `_TOOL_MOVE[0] = True` dizinin tamamında **bütün bölge denetimlerini**
   kapatıyor. Dock'lar bölgelerin içinde olduğu için bir esnetme gerekli, ama
   bu kadar geniş olması gereksiz.

**Bizdeki esnetme — açıkça:** `dock: true` işaretli bölgeler, yalnızca uç
değiştirme dizisi sürerken, yalnızca o dizinin adımları için atlanır. Diğer
bölgeler dizinin ortasında da geçerliliğini korur. Esnetmenin zaman aşımı olur
(dizi süresi + pay), dizi biterse/hata verirse/acil durdurma gelirse anında
kapanır ve panelde "bölge esnetmesi açık" göstergesi görünür.

`lock_reg`, `grip_reg`, `presence_reg` şu anda **0** — yani donanım bağlı değil.
Bu haldeyken servo komutu sessiz bir no-op ve **varlık sensörü uç alındığını
doğrulayamaz**. Planda: register 0 ise dizi çalışır ama sonunda "doğrulanamadı"
uyarısı verir ve panel bunu açıkça yazar; sessizce "başarılı" demez.

### 3.5 Program çalıştırma (`/api/runprog`)

**Referansta:** adım listesi (`move`, `pick`, `change`, `drop`, `grip`,
`release`, `home`, `planted`, `measure`, `water`), tekrar sayısı, hız.
Ayrı bir iş parçacığında yürüyor; `PROG` sözlüğü adım/durum tutuyor. Bir adım
hata verirse duruyor. `prog_stop` sert duruş yapıyor: go/home bitleri sıfır,
jog bırak, hedefleri eşitle.

**Bizde gerekenler (prompt 5 kapsamı):** `noktaya git`, `bekle`,
`röle aç/kapa`, `servo`, `uç değiştir`. Hepsi mevcut komutları çağıracak.
Hangi adımda olunduğu panelde görünecek, "Durdur" ortada çalışacak, hata
sessizce yutulmayacak, acil durdurma diziyi kesecek ve mandal temizlenmeden
yeniden başlamayacak.

---

## 4. Mimari kararlar

### K1 — Veri nerede saklanacak: JSON dosyaları, SQLite değil

**Karar:** noktalar ve programlar **sunucuda JSON**; bölgeler ve uç ayarları
**ajanda JSON**. Telemetri SQLite'ta kalır.

**Gerekçe:**

* Bu veriler yapılandırma niteliğinde: küçük (yüzlerce satır), bütün olarak
  okunuyor, bütün olarak yazılıyor. SQLite'ın kazandırdığı şey — aralık
  sorgusu, seyreltme, eşzamanlı yazma — burada kullanılmıyor.
* `gantry_store.json` ve `gantry_tools.json` zaten bu biçimde. Makinedeki
  mevcut dosyalar doğrudan kopyalanabilir, elle dönüştürme gerekmez.
* Bir şey ters giderse düzeltmek metin düzenlemek kadar kolay; SQL istemcisi
  gerekmiyor. Sahada, telefondan SSH ile bakarken bu fark ediyor.
* Telemetri farklı bir iş: sürekli ekleme, zaman aralığı sorgusu, seyreltme.
  Orada SQLite doğru araç ve yerinde kalıyor.

**Riski ve önlemi:** eşzamanlı yazmada dosya bozulması. Yazma **atomik**
olacak: geçici dosyaya yaz → `os.replace`. Süreç içi kilit ile serileştirilecek.
Yedek: yazmadan önce `.yedek` kopyası.

**Ne zaman değişir:** nokta sayısı on binleri bulursa (ızgara üstüne ızgara)
SQLite'a taşınır. 2000 noktalık bir dosya ~200 KB, o sınıra yakın bile değiliz.

### K2 — Bölgeler ve uç ayarları ajanda durur, panel uzaktan düzenler

Güvenlik kararı ajanda kalacaksa, kararın **verisi** de ajanda olmalı. Sunucuda
tutulup ajana gönderilseydi, sunucu erişilemezken ajan hangi bölgelerin geçerli
olduğunu bilemezdi.

Panelden düzenleme şöyle çalışır: panel → sunucu → `bolge_kaydet` komutu →
ajan dosyaya yazar, belleğe alır, yeni hâli durum akışıyla panele döner.
Sunucu yalnızca aracı; kopya tutmaz.

### K3 — Program koşucusu ajanda, adımlar çözülmüş koordinatlarla gider

Dizi ajanda yürür (referanstaki gibi), çünkü internet/panel koparsa da güvenli
davranmalı ve acil durdurma diziyi anında kesmeli.

Ama nokta **isimleri** sunucuda. Çözüm: panel diziyi başlatırken sunucu isimleri
koordinatlara çevirir ve ajana **çözülmüş** adım listesi gönderir. Ajan nokta
deposunu hiç bilmez. Böylece ajanın durumu küçük kalır ve isim değişikliği
süren bir diziyi bozmaz.

### K4 — Bölge denetimi ara duraklarda da yapılır

`git` komutu Z→Y→X sırasıyla en fazla dört durağa uğruyor. Her durak ayrı
denetlenecek. Referans yalnızca son hedefi denetliyor; bu gerçek bir açık.

### K5 — İfade değerlendirici: küçük, tam ve fail-closed

`eval` yok. Özyinelemeli inişli küçük bir ayrıştırıcı:

```
ifade   := veya
veya    := ve ( "or" ve )*
ve      := degil ( "and" degil )*
degil   := "not" degil | karsilastirma
karsilastirma := atom ( ("=="|"!="|"<"|"<="|">"|">=") atom )?
atom    := sayı | 'metin' | isim | "(" ifade ")"
```

Bilinmeyen isim, eksik parantez, tanınmayan simge → istisna → **koşul FALSE →
hareket engellenir.** İfade kaydedilirken de ayrıştırılır; hatalıysa panel
uyarır ama kayıt yine de engelleyici tarafta kalır.

---

## 5. Dosya bazlı değişiklik listesi

### Prompt 1 — Nokta deposu

| Dosya | Değişiklik |
|---|---|
| `sunucu/noktalar.py` | **yeni** — JSON deposu: oku/yaz/ekle/sil, atomik yazma, isim tekilliği |
| `sunucu/main.py` | `GET/POST/DELETE /api/noktalar`; durum yanıtına sınır bilgisi zaten var |
| `sunucu/static/index.html` | Kontrol sekmesine "Kayıtlı noktalar" kartı |
| `sunucu/static/app.js` | Liste çizimi, "Bulunduğu konumu kaydet", satır başına Git / Sil, sınır dışı rozeti |
| `sunucu/static/stil.css` | Liste ve rozet biçimleri |
| `docs/API.md` | Yeni uçlar |

Ajan tarafında değişiklik **yok** — "Git" mevcut `git` komutunu kullanıyor.

### Prompt 2 — Tohum ızgarası

| Dosya | Değişiklik |
|---|---|
| `sunucu/noktalar.py` | `izgara_uret()` — satır-öncelikli üretim, mevcut alanları koruma |
| `sunucu/main.py` | `POST /api/izgara/onizle` (sayım + sınır dışı sayısı + üzerine yazılacaklar), `POST /api/izgara/uygula` |
| `sunucu/static/*` | Izgara formu, önizleme kutusu |

### Prompt 3 — Yasak bölgeler

| Dosya | Değişiklik |
|---|---|
| `ajan/kosul.py` | **yeni** — mini ifade değerlendirici + ayrıştırıcı testleri |
| `ajan/bolgeler.py` | **yeni** — bölge dosyası oku/yaz, `bolge_engeli(x,y,z,baglam)` |
| `ajan/plc.py` | `git`, `_git_isci` ve `jog` içine bölge denetimi; ara durak denetimi; `dock` esnetmesi kancası |
| `ajan/ajan.py` | `bolge_listele` / `bolge_kaydet` komutları; durum akışına bölgeler |
| `sunucu/main.py` | İki komutu izinli listeye ekle |
| `sunucu/static/*` | Bölge düzenleyici (tablo + koşul alanı + doğrulama uyarısı) |
| `ajan/bolgeler.json` | **yeni** — varsayılan boş liste |

### Prompt 4 — Uç değiştirme

| Dosya | Değişiklik |
|---|---|
| `ajan/uclar.py` | **yeni** — uç ayarları dosyası, `al()`, `birak()`, `degistir()`, adım adım doğrulama |
| `ajan/plc.py` | Tek eksen mutlak hareket + bekleme için içe dönük yardımcı; `dock` esnetme bağlamı (zaman aşımlı) |
| `ajan/ajan.py` | `uc_al` / `uc_birak` / `uc_degistir` / `uc_kaydet` komutları; adım ilerlemesi `gunluk` ve `durum` ile yayınlanır |
| `sunucu/main.py` | Komutları izinli listeye ekle |
| `sunucu/static/*` | Uç kartı: mevcut uç, dizi adımları, ilerleme, esnetme göstergesi |
| `ajan/uclar.json` | **yeni** — `gantry_tools.json` yapısında, komisyonlanmış değerlerle |

### Prompt 5 — Program çalıştırma

| Dosya | Değişiklik |
|---|---|
| `sunucu/programlar.py` | **yeni** — program JSON deposu, isim→koordinat çözümü |
| `sunucu/main.py` | `GET/POST/DELETE /api/programlar`, `POST /api/programlar/calistir` (çözüp ajana yollar) |
| `ajan/dizi.py` | **yeni** — koşucu iş parçacığı, adım tipleri, durdurma, acil durdurma ile kesilme |
| `ajan/ajan.py` | `dizi_baslat` / `dizi_durdur` komutları; durum akışına `dizi` alanı |
| `sunucu/static/*` | Program düzenleyici + çalışma göstergesi |

### Prompt 6 — Kamera

| Dosya | Değişiklik |
|---|---|
| `ajan/kamera.py` | **yeni** — periyodik kare (picamera2 ya da fswebcam), JPEG, yeniden boyutlandırma |
| `ajan/ajan.py` | Kareleri `{"tip":"kare"}` olarak gönder; aralık ayarlanabilir |
| `sunucu/main.py` | Son N kareyi bellekte + diskte tut, `GET /api/kare/son`, `GET /api/kare/{i}` |
| `sunucu/static/*` | Kontrol sekmesinde önizleme |

---

## 6. Yeni komutlar

Ajan komutları (`sunucu/main.py → IZINLI_KOMUTLAR` + `ajan/ajan.py → komut_isle`):

| Komut | arg | Ne yapar |
|---|---|---|
| `bolge_listele` | `{}` | Ajandaki geçerli bölgeleri döndürür |
| `bolge_kaydet` | `{"bolgeler":[…]}` | Doğrular, dosyaya yazar, belleğe alır |
| `uc_kaydet` | `{"ayar":{…}}` | Uç ayarlarını yazar |
| `uc_al` | `{"ad":"tool1"}` | Yandan yaklaşımlı alma dizisi |
| `uc_birak` | `{}` | Bırakma dizisi |
| `uc_degistir` | `{"ad":"tool3"}` | Gerekiyorsa bırak, sonra al |
| `dizi_baslat` | `{"ad":…,"adimlar":[…],"tekrar":1,"hiz":20}` | Çözülmüş adımlarla koşucuyu başlatır |
| `dizi_durdur` | `{}` | Sert duruş: go/home sıfır, jog bırak, hedefleri eşitle |

Sunucu uçları (ajana gitmeyen, panel–sunucu arası):

`GET/POST/DELETE /api/noktalar` · `POST /api/izgara/onizle` ·
`POST /api/izgara/uygula` · `GET/POST/DELETE /api/programlar` ·
`POST /api/programlar/calistir` · `GET /api/kare/son`

Durum akışına eklenecek alanlar: `bolgeler`, `uc` (mevcut uç + dizi adımı),
`dizi` (ad, adım/toplam, durum, hata), `esnetme_acik`.

---

## 7. Sıra ve bağımlılıklar

```
1 Nokta deposu ──► 2 Tohum ızgarası
       │
       └──────────────────────────► 5 Program çalıştırma
                                        ▲
3 Yasak bölgeler ──► 4 Uç değiştirme ───┘

6 Kamera (bağımsız)      7 Uçtan uca doğrulama (hepsinden sonra)
```

Sıra prompt dizisindeki gibi: risksizden riskliye. Yasak bölgeler uç
değiştirmeden **önce**, çünkü dock'lar bölgelerin içinde yaşıyor ve esnetme
mekanizması bölge denetimi var olmadan yazılamaz.

Her adımın sonunda sahte PLC ile test + ekran görüntüsü. Uç değiştirme dizisi
sahte PLC'de baştan sona geçmeden gerçek makinede denenmeyecek.

---

## 8. Mevcut kodda bulduğum hatalar

Bunlar plan dışı ama uygulamaya başlamadan düzeltilmeli.

### H1 — `home()` üç ekseni aynı anda referansa gönderiyor (ciddi)

`ajan/plc.py` → `home()`, eksen verilmediğinde Z, Y, X sırasıyla home bitine
darbe atıyor ama **aralarında beklemiyor** (0,2 sn darbe + hemen sıradaki).
Yani Z hâlâ hareket hâlindeyken X ve Y referans aramaya başlıyor.

Referans `home_all()` her eksenden sonra `home_wait` (8 sn) bekliyor ve
sırası Z → X → Y. PLC'de "referans tamam" biti eşlenmediği için bu süreli
bekleme, doğrulama değil.

**Düzeltme:** eksenler arası bekleme (ayarlanabilir, varsayılan 8 sn), sıra
Z → X → Y, ve panelde "referans aranıyor" göstergesi. Bekleme sırasında acil
durdurma diziyi kesebilmeli.

### H2 — Jog ile süren `git` hareketi çakışabiliyor (orta)

`git` arka planda bir iş parçacığında yürürken panelden jog gelirse ikisi de
aynı eksenin register'larına yazıyor. Referansta da aynı açık var.

**Düzeltme:** hareket sürerken jog reddedilsin ("önce durdurun"), dizi
sürerken de aynı kural geçerli olsun.

### H3 — Hareket sırasında gereksiz Modbus trafiği (düşük)

`_eksen_bekle` her 50 ms'de `konum_mm()` çağırıyor; bu **üç** ayrı okuma
demek (3 eksen × 2 register). Beklenen tek eksen olduğu hâlde üçü de
okunuyor, üstelik durum döngüsü de paralel okuyor. Modbus kilidi bunları
sıraya sokuyor ve hareket sırasında panel konumu geç güncelleniyor.

**Düzeltme:** beklenen eksenin konumunu tek okumada al; durum döngüsü üç
ekseni tek `read_holding_registers` çağrısıyla (1026–1063 aralığı) çeksin.

### H4 — Y ekseni üst sınırı belirsiz (ciddi, ölçüm gerekiyor)

Bölüm 1'deki 600/550 tutarsızlığı. Ölçülene kadar Y'de 550 üstü hedef
verilmemeli.

---

## 9. Test planı

Her özellik için sahte PLC (register davranışını taklit eden, güvenlik
mantığının aynısını çalıştıran) üzerinde:

| Ne | Nasıl doğrulanır |
|---|---|
| Nokta deposu | Kaydet → listede görün → git → konum eşleşti → sil |
| Sınır dışı nokta | Sınırı daralt, nokta uyarıyla görünsün, silinmesin |
| Izgara | 4×3 önizleme "12 nokta, 3 sınır dışı" desin, uygulama depoya yazsın |
| Bölge engelliyor | Hedefi bölge içine ver, `z<safe_z` iken RED, `z>=safe_z` iken geçsin |
| Bozuk ifade | `"z >= "` → kayıt uyarısı + hareket RED |
| Bilinmeyen değişken | `"sicaklik>20"` → RED |
| Ara durak denetimi | Başlangıç ve hedef bölge dışı, ara nokta içeride → RED |
| Uç değiştirme | Tüm dizi baştan sona, her adımda konum doğrulaması |
| Dizi ortasında acil | Adım 3'te acil durdur → dizi dursun, mandal açık, yeniden başlatma reddedilsin |
| Esnetme kapanıyor mu | Dizi bitince dock bölgesi yeniden engelliyor mu |

---

## 10. Açık sorular

1. **Y ekseni gerçek üst sınırı 550 mi 600 mü?** Ölçmeden Y'de 550 üstü
   denenmemeli.
2. `lock_reg` / `grip_reg` / `presence_reg` ne zaman bağlanacak? Bağlı
   değilken uç değiştirme dizisi doğrulanamıyor — dizi çalışır ama sonucu
   "doğrulanamadı" olur.
3. Uç yuvalarının etrafındaki yasak bölgeler kaç mm pay ile çizilecek?
   `tc_area` referansta kapalı (`on: false`), yani bugün kullanılmıyor.
4. Program tekrar sayısı sonsuz olabilecek mi? Referansta `repeat<=0`
   sonsuz demek; uzaktan çalışan bir makinede bunu istiyor muyuz?
5. Kamera hangi donanım — Pi kamera modülü mü USB webcam mi? Kütüphane seçimi
   buna bağlı.
