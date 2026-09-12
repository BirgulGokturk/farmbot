"""
gorus — ölçüm kamerası ve bitki ölçüm katmanı.

KAPSAM BİLEREK DAR. Kalibrasyon, piksel→mm dönüşümü, AprilTag okuma ve
filiz TESPİTİ sunucuda zaten var (sunucu/etiket.py, kalibrasyon.py,
filiz.py + panelin "AprilTag ile kalibre et" bölümü). Bu paket onları
TEKRAR ETMEZ — tespitleri GİRDİ alır, üstüne ölçüm ve karar koyar.

Kamera katmanı
    usb_kamera     : UVC kontrollerini kilitler, tam çözünürlükte kare çeker
    akis           : panelin ffmpeg akışını tarama süresince duraklatır
    kamera_denetim : odak/pozlama/montaj kararlılık testi (kalibrasyon öncesi)
    etiket_bas     : yazdırılabilir AprilTag 36h11 sayfası üretir
    ajan_kanca     : ajan'a eklenecek "kare_cek" komutu

Ölçüm katmanı  (girdi: filiz.py tespitleri + bitki.veri() ekim kaydı)
    girdi          : filiz.py çıktısını Tespit'e çevirir (alan adı sezgisiyle)
    eslestir       : ekim kaydıyla global atama + çimlenme raporu      [2]
    siniflandir    : filiz / yabani / belirsiz                         [3]
    izle           : taramalar arası takip, mm²/gün büyüme             [4]
    cizim          : daire içine alma + ortorektifiye kuşbakışı        [5]
    depo           : SQLite arşiv, zaman serisi, insan etiketi         [6]
    ortu           : yaprak alanı, yatak kapsama yüzdesi               [7]
    tarama         : hepsini birleştiren tek giriş noktası

Üç değişmez kural:
  1. Ölçülemeyen hiçbir sayı üretilmez. Eksik öznitelik "kullanılamadı"
     olarak raporlanır, nötr sayılır; uydurulmaz.
  2. Geri alınamaz hiçbir iş bu paketten tetiklenmez. Yalnız ölçer.
  3. "belirsiz" sınıfı üzerinde otomatik işlem yapılmaz; kullanıcıya sorulur.
"""

__surum__ = "2.0.0"
