# gantry_studio özelliklerini Farmbot'a taşıma — prompt dizisi

Her kutuyu sırayla yeni sohbete yapıştırın. **Bir seferde bir tane**, öncekinin
çalıştığını gördükten sonra sıradakine geçin.

**Nerede:** `C:\Users\Birgül\Desktop\farmbot` klasöründe, bir Code oturumunda.
`farmbot-web` ayrı proje, oraya karıştırmayın.

**Sıra neden böyle:** Risksizden riskliye. Yasak bölgeler uç değiştirmeden önce,
çünkü dock'lar o bölgelerin içinde yaşıyor.

---

## 0 — Plan (kod yazılmayacak)

```
Depo: Desktop\farmbot — akıllı tarım robotu. sunucu/ FastAPI panel,
ajan/ Pi'de Modbus TCP ile PLC'ye yazar, firmware/ Arduino sensörleri.
Referans: Desktop\farmbot-referans\gantry_studio.py — aynı makineyi süren
eski tek dosyalık program.

- Oku: README.md, docs/API.md, ajan/plc.py, sunucu/main.py
- gantry_studio.py'yi oku, bizde olmayan 4 özelliği çıkar: /api/store (nokta
  deposu), /api/seeds (tohum ızgarası), /api/tools (uç değiştirme +
  zones[].allow_if yasak bölgeler), /api/runprog (dizi çalıştırma)
- Register haritası ve kalibrasyon ikisinde aynı, doğrula: hedef 1024/1034/1054,
  go 1022, enable 1010, konum 1026; X 7 cpm, Y 2.2746, Z 56.8376 dir -1 home 438
- KOD YAZMA. Fark analizi + uygulama planı yaz: hangi dosyalar, hangi yeni
  komutlar, hangi sıra
- Kurallar: arayüz Türkçe kod İngilizce · güvenlik kararları ajanda kalır ·
  sahte PLC ile test edilmeden gerçek makinede denenmez
```

---

## 1 — Nokta deposu

```
Nokta deposu ekle.

- Konumu isimle kaydet, listeden seçip git, sil
- Veri sunucuda saklansın (SQLite tablo ya da JSON — seç, gerekçesini yaz)
- Panel: Kontrol sekmesinde "Kayıtlı noktalar" — liste + "Bulunduğu konumu
  kaydet" + her satırda Git / Sil
- "Git" mevcut git komutunu kullansın, yeni hareket yolu açma
- Sınır dışı kalan nokta uyarıyla gösterilsin ama silinmesin
- Sahte PLC ile test et, ekran görüntüsüyle göster
```

---

## 2 — Tohum ızgarası

```
Tohum ızgarası ekle (gantry_studio'daki gen_seed_grid mantığı).

- Girdi: başlangıç x0,y0,z + aralık dx,dy + satır/sütun sayısı + önek
- Üretilen noktalar Prompt 1'deki depoya yazılsın, ayrı yapı kurma
- Üretmeden önce kaç nokta çıkacağını ve kaçının sınır dışı kalacağını göster
- Sınır dışı noktalar üretilsin ama işaretlensin
- Sahte PLC ile test et
```

---

## 3 — Yasak bölgeler (güvenlik)

```
Yasak bölge korumasını ekle (gantry_studio'daki zones).

- Dikdörtgen alan (x1,y1,x2,y2) + allow_if koşulu. Hedefi alanın içine düşen
  hareket, koşul doğru değilse REDDEDİLİR
- Denetim AJANDA olacak, panelde değil — mevcut yumuşak sınır ve Z kilidi
  denetimlerinin yanına. Panel çökse de koruma çalışmalı
- Değişkenler: z, x, y, prox, tool, safe_z, zmax
  Örnekler: "z>=safe_z" · "prox" · "tool!='laser'" · "z>=safe_z or prox"
- eval() KULLANMA. Karşılaştırma, and/or/not, değişken, sayı ve metin sabiti
  destekleyen küçük bir değerlendirici yaz
- Bilinmeyen isim ya da bozuk ifade → koşul FALSE, yani hareket engellenir.
  Güvenlikte hata izin vermek yönünde olmamalı
- Bölgeler panelden düzenlensin, dosyada saklansın
- Reddedilen hareket nedenini yazsın: hangi bölge, hangi koşul
- Test: engellenen durum + izin verilen durum + bozuk ifade. Sonuçları göster
```

---

## 4 — Uç değiştirme (en riskli)

```
Uç değiştirme dizisini ekle. Referans yapı gantry_tools.json: safe_z,
slide_axis, approach, travel_z, lift, home_z, lock_reg, lock_dwell, grip_reg,
grip_dwell, presence_reg, tools[].

- Yandan yaklaşım: önce güvenli yükseklikte yuvanın yanına git, sonra
  slide_axis boyunca approach kadar kayarak gir. Çıkarken tersi
- Prompt 3'teki bölge denetimi burada da geçerli. Dizi için geçici esnetme
  yaparsan AÇIKÇA yaz; yalnızca dizinin adımlarını kapsasın, bitince kapansın
- Her adım öncesi ve sonrası konum doğrula. Beklenen konuma varılmadıysa dizi
  DURSUN, sonraki adıma geçmesin
- Panelde dizi adım adım görünsün, acil durdurma ortada da çalışsın
- Makinenin kendine çarpma riski en yüksek parçası. Tüm dizi sahte PLC'de
  baştan sona geçmeden gerçek makinede denenmeyecek. Test çıktısını göster
```

---

## 5 — Kayıtlı dizi çalıştırma

```
Kayıtlı program (dizi) çalıştırma ekle.

- Adım tipleri: noktaya git, bekle, röle aç/kapa, servo, uç değiştir
- Mevcut komutları kullansın, yeni hareket yolu açma
- Çalışırken hangi adımda olunduğu görünsün, "Durdur" ortada da çalışsın
- Bir adım hata verirse dizi dursun ve nedenini yazsın, sessizce devam etmesin
- Acil durdurma diziyi kessin; mandal temizlenmeden yeniden başlamasın
- Sahte PLC ile uçtan uca test et
```

---

## 6 — Kamera (isteğe bağlı)

```
Kamera görüntüsü ekle (gantry_studio'daki /api/ingest/photo karşılığı).

- Pi'deki kameradan periyodik fotoğraf, ajandan sunucuya gitsin
- Sunucu son kareyi saklasın, panelde Kontrol sekmesinde önizleme
- Yalnız son N kare saklansın, disk dolmasın
```

---

## 7 — Kapanış testi

```
Uçtan uca doğrulama yap ve raporla.

- Sahte PLC + sahte Arduino ile sunucuyu ve ajanı başlat
- Test et: nokta kaydet/git/sil · tohum ızgarası · yasak bölge engelliyor mu ·
  uç değiştirme dizisi · kayıtlı dizi · acil durdurma dizinin ortasında
- Her birini panelden ekran görüntüsüyle göster
- README.md'yi güncelle, "Sırada ne var" listesinden tamamlananları işaretle
- Bulduğun ama düzeltmediğin sorunları listele, sessizce geçme
```

---

## Gerçek makineye geçerken

- `gantry_studio.py` kapalı olmalı — iki program aynı register'lara yazamaz
- Acil stop elinizin altında olsun
- Z ekseniyle başlayın (dir −1, ters giderse hemen anlarsınız)
- Uç değiştirmeyi en son deneyin, ilk denemede yuvaya uç koymayın
