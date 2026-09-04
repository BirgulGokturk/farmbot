#!/usr/bin/env python3
"""Fide sınıflandırıcısı eğitir — Plant Seedlings veri setiyle.

NE EĞİTİYOR VE NE EĞİTMİYOR
---------------------------
Bu bir SINIFLANDIRICI, nesne bulucu değil. Veri setindeki her görüntüde
tek bir fide var, kırpılmış hâlde. Bizim hattımıza da tam bu oturuyor:
`goruntu.py` yeşil lekeyi zaten buluyor ve kutusunu veriyor; eksik olan
"bu kırpıntı ne" sorusu. Nesne bulucu eğitmeye gerek yok.

Veri setinde FESLEĞEN YOK. On iki türün dokuzu yabani ot, üçü ekin
(mısır, buğday, şeker pancarı). Yani model "fesleğen" diyemez. İki işe
yarıyor: ekin/ot ayrımı, ve kendi türlerimize ince ayar için hazır bir
omurga. İnce ayar `--surdur` ile aynı betikten yapılıyor.

VERİ NEREDEN
------------
Kaggle: "Plant Seedlings Classification" (Aarhus Üniversitesi). İndirip
açtığınızda tür başına bir klasör çıkıyor; `--veri` o klasörü gösterecek.

    fide-egit.py --veri ~/veri/plant-seedlings/train

Kendi karelerinizle ince ayar için de aynı düzen: tür başına bir klasör.

NEDEN HER TURDA KONTROL NOKTASI
-------------------------------
Eğitim saatler sürüyor. Colab oturumu zaman aşımına uğrayabiliyor,
ayarı değiştirip yeniden denemek isteyebiliyorsunuz, ya da başarı bir
yerden sonra düşmeye başlıyor ve o turdan geri dönmek gerekiyor.
`--surdur` en son kaydedilen turdan devam ediyor. Ayrıca en iyi
doğrulamayı veren tur `en-iyi.pt`de ayrı duruyor: son tur her zaman en
iyi tur değil, aşırı öğrenme geç turlarda başlıyor.

DOĞRULAMA AYNI TÜRDEN KAÇMALI
-----------------------------
Veri seti aynı tepsiden günlerce çekilmiş kareler içeriyor; rastgele
bölünce aynı bitkinin iki karesi hem eğitime hem doğrulamaya düşüyor ve
başarı olduğundan yüksek çıkıyor. Bölme tür içinde SIRALI yapılıyor;
kusursuz değil ama rastgele bölmenin yalanından iyi.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

#: Veri setindeki on iki tür → ekin mi ot mu. Ekin/ot ayrımı bizim asıl
#: kullanacağımız sinyal: tür bilmek şart değil, "burada olmaması gereken
#: bir şey var" demek yetiyor.
EKIN = {"Maize", "Common wheat", "Sugar beet"}


def veri_yukle(kok: str, olcu: int, yigin: int, isci: int):
    """Klasör yapısından eğitim/doğrulama kümesi. -> (egitim, dogrulama, siniflar)"""
    import torch
    from torch.utils.data import DataLoader, Subset
    from torchvision import datasets, transforms

    # ARTIRMA SADECE EĞİTİMDE. Doğrulamada artırma yapmak, ölçtüğünüz
    # şeyin ne olduğunu bulanıklaştırır.
    egitim_don = transforms.Compose([
        transforms.Resize((olcu, olcu)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomVerticalFlip(),
        # ÜSTTEN BAKAN KAMERADA DÖNME SERBEST: fide her yöne bakabilir,
        # sahnenin "üstü" diye bir şey yok. Yandan çekimde bu artırma
        # yanlış olurdu.
        transforms.RandomRotation(180),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    dogru_don = transforms.Compose([
        transforms.Resize((olcu, olcu)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    tam = datasets.ImageFolder(kok)
    siniflar = tam.classes
    # Tür içinde sıralı bölme — bkz. dosya başı.
    sirali: dict[int, list[int]] = {}
    for i, (_, etiket) in enumerate(tam.samples):
        sirali.setdefault(etiket, []).append(i)
    egitim_ix, dogru_ix = [], []
    for etiket, ixler in sirali.items():
        kesme = int(len(ixler) * 0.8)
        egitim_ix += ixler[:kesme]
        dogru_ix += ixler[kesme:]

    e_set = datasets.ImageFolder(kok, transform=egitim_don)
    d_set = datasets.ImageFolder(kok, transform=dogru_don)
    egitim = DataLoader(Subset(e_set, egitim_ix), batch_size=yigin,
                        shuffle=True, num_workers=isci, pin_memory=True)
    dogrulama = DataLoader(Subset(d_set, dogru_ix), batch_size=yigin,
                           shuffle=False, num_workers=isci, pin_memory=True)
    return egitim, dogrulama, siniflar


def model_kur(sinif_sayisi: int, agirlik: str | None):
    """MobileNetV3-Small — Pi'de CPU'da bile hızlı, aktarımlı öğrenmeye uygun."""
    import torch
    from torchvision import models

    # ÖNCEDEN EĞİTİLMİŞ OMURGA. Sıfırdan eğitmek 5.500 görüntüyle
    # yetersiz kalıyor; ImageNet omurgası yaprak kenarı, doku ve renk
    # gibi alt seviye özellikleri zaten biliyor.
    m = models.mobilenet_v3_small(weights="IMAGENET1K_V1" if not agirlik else None)
    girdi = m.classifier[-1].in_features
    m.classifier[-1] = torch.nn.Linear(girdi, sinif_sayisi)
    if agirlik:
        m.load_state_dict(torch.load(agirlik, map_location="cpu")["model"])
    return m


def tur_calistir(model, yukleyici, kayip_f, iyilestirici, cihaz, egitim: bool):
    import torch

    model.train() if egitim else model.eval()
    toplam = dogru = 0
    kayip_top = 0.0
    with torch.set_grad_enabled(egitim):
        for x, y in yukleyici:
            x, y = x.to(cihaz, non_blocking=True), y.to(cihaz, non_blocking=True)
            cikti = model(x)
            kayip = kayip_f(cikti, y)
            if egitim:
                iyilestirici.zero_grad(set_to_none=True)
                kayip.backward()
                iyilestirici.step()
            kayip_top += float(kayip) * y.size(0)
            dogru += int((cikti.argmax(1) == y).sum())
            toplam += y.size(0)
    return kayip_top / max(1, toplam), dogru / max(1, toplam)


def main() -> int:
    a = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--veri", required=True, help="tur basina bir klasor iceren kok")
    a.add_argument("--cikti", default="fide-model", help="kontrol noktasi klasoru")
    a.add_argument("--tur", type=int, default=15, help="kac tur (epoch)")
    a.add_argument("--olcu", type=int, default=224)
    a.add_argument("--yigin", type=int, default=32)
    a.add_argument("--isci", type=int, default=2)
    a.add_argument("--hiz", type=float, default=3e-4)
    a.add_argument("--surdur", action="store_true",
                   help="son kontrol noktasindan devam et")
    a.add_argument("--ince-ayar", default="",
                   help="baslangic agirligi (kendi turlerinize gecis icin)")
    p = a.parse_args()

    try:
        import torch
    except ImportError:
        print("HATA: PyTorch kurulu degil.\n"
              "  pip install torch torchvision --index-url "
              "https://download.pytorch.org/whl/cu121")
        return 2

    if not os.path.isdir(p.veri):
        print(f"HATA: veri klasoru yok: {p.veri}")
        return 2
    os.makedirs(p.cikti, exist_ok=True)

    cihaz = "cuda" if torch.cuda.is_available() else "cpu"
    if cihaz == "cpu":
        # SESSİZCE CPU'YA DÜŞMÜYORUZ. Aynı iş GPU'da 20 dakika, CPU'da
        # bir gece sürüyor; kullanıcı hangisinde olduğunu bilmeli.
        print("! GPU bulunamadi, CPU ile egitilecek — cok yavas olacak.\n"
              "  Colab kullanmayi dusunun (Runtime > Change runtime type > GPU).")

    egitim, dogrulama, siniflar = veri_yukle(p.veri, p.olcu, p.yigin, p.isci)
    print(f"\n{len(siniflar)} sinif: {', '.join(siniflar)}")
    ekin = [s for s in siniflar if s in EKIN]
    print(f"Ekin sayilan: {', '.join(ekin) if ekin else 'yok'} · "
          f"gerisi yabani ot\n")

    model = model_kur(len(siniflar), p.ince_ayar or None).to(cihaz)
    kayip_f = torch.nn.CrossEntropyLoss()
    iyilestirici = torch.optim.AdamW(model.parameters(), lr=p.hiz,
                                     weight_decay=1e-4)

    yol = os.path.join(p.cikti, "son.pt")
    bas_tur, en_iyi = 0, 0.0
    if p.surdur and os.path.exists(yol):
        kn = torch.load(yol, map_location=cihaz)
        model.load_state_dict(kn["model"])
        iyilestirici.load_state_dict(kn["iyilestirici"])
        bas_tur, en_iyi = kn["tur"], kn.get("en_iyi", 0.0)
        print(f"Kaldigi yerden: tur {bas_tur}, en iyi dogruluk {en_iyi:.3f}\n")

    for tur in range(bas_tur, p.tur):
        t0 = time.time()
        e_kayip, e_dogru = tur_calistir(model, egitim, kayip_f, iyilestirici,
                                        cihaz, True)
        d_kayip, d_dogru = tur_calistir(model, dogrulama, kayip_f, None,
                                        cihaz, False)
        print(f"tur {tur + 1}/{p.tur} · egitim {e_dogru:.3f} · "
              f"dogrulama {d_dogru:.3f} · kayip {d_kayip:.3f} · "
              f"{time.time() - t0:.0f} sn")

        # HER TURDA YAZILIYOR — bkz. dosya basi.
        torch.save({"model": model.state_dict(),
                    "iyilestirici": iyilestirici.state_dict(),
                    "tur": tur + 1, "en_iyi": max(en_iyi, d_dogru),
                    "siniflar": siniflar}, yol)
        if d_dogru > en_iyi:
            en_iyi = d_dogru
            torch.save({"model": model.state_dict(), "siniflar": siniflar},
                       os.path.join(p.cikti, "en-iyi.pt"))

    # ONNX: Pi'de PyTorch kurmadan çalıştırmanın yolu. Hailo'ya derlemek
    # de buradan başlıyor.
    model.eval()
    ornek = torch.randn(1, 3, p.olcu, p.olcu, device=cihaz)
    onnx_yol = os.path.join(p.cikti, "fide.onnx")
    torch.onnx.export(model, ornek, onnx_yol, input_names=["girdi"],
                      output_names=["cikti"], opset_version=13,
                      dynamic_axes={"girdi": {0: "yigin"}, "cikti": {0: "yigin"}})
    with open(os.path.join(p.cikti, "siniflar.json"), "w", encoding="utf-8") as d:
        json.dump({"siniflar": siniflar, "ekin": sorted(EKIN & set(siniflar)),
                   "olcu": p.olcu}, d, ensure_ascii=False, indent=1)

    print(f"\nEn iyi dogrulama: {en_iyi:.3f}")
    print(f"ONNX: {onnx_yol}")
    print("Pi'de calistirmak icin: pip install onnxruntime")
    return 0


if __name__ == "__main__":
    sys.exit(main())
