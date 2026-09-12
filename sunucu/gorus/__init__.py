"""
gorus — FarmBot görüntü işleme modülü.

Katmanlar (veri akışı sırasıyla):
    kare      : ajan'dan gelen JPEG karesi (tek kamera sahibi ajan'dır)
    duzlem    : piksel -> yatak (mm) dönüşümü, AprilTag homografisi + paralaks
    isik      : pozlama/beyaz denge normalizasyonu
    bolutle   : bitki örtüsü maskesi (ExG + L*a*b*, Otsu)
    nesne     : maske -> ayrık bitki nesneleri + mm cinsinden öznitelikler
    eslestir  : nesneleri sunucudaki ekim kaydına (X,Y) bağla
    siniflandir: filiz / yabani / belirsiz kararı
    cizim     : tespitleri kare üzerine çizen görsel (daire, etiket, yatak sınırı)
    boru      : tüm zinciri yöneten Tarama akışı
    depo      : SQLite kalıcılık
    api       : FastAPI router (sunucu'ya takılır)

Tasarım kuralları:
  1. Ölçülmemiş hiçbir sayı üretilmez. Hesaplanamayan alan None döner ve
     sebebi `tani` (diagnostics) sözlüğüne yazılır.
  2. Kalibrasyon her taramada yeniden doğrulanır; artık hata eşiği aşarsa
     tarama "güvenilmez" damgasıyla biter, koordinat yayımlanmaz.
  3. Geri alınamaz hiçbir iş bu modülden tetiklenmez; modül yalnız ölçer.
"""

__surum__ = "0.1.0"
