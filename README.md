# DotaStat

Arkadaş grubu için Dota 2 oyuncu değerlendirmesi ve canlı maç paneli. Site
tarayıcıdan açılır; oyundaki biri masaüstü uygulamasını çalıştırıyorsa canlı
maç, item tavsiyesi ve draft asistanı da aynı sayfada görünür.

> Performance Rank, "tahmini seviye" ve performans profili **gerçek MMR
> değildir**; maç verisinden çıkarılan tahminlerdir.

## Nasıl kullanılır

1. **Siteye gir.** Oyuncu kartları herkese açıktır. Sağ üstteki
   **Steam ile giriş** ile giriş yaparsan kendi maçlarına pozisyon
   yazabilirsin. Kadrodaysan tavsiye kataloğunu da düzenleyebilirsin.
2. **Oyun sırasında canlı panel için masaüstü uygulamasını kur.** Sitedeki
   **Masaüstü sürümü** butonundan indir, uygulamada **Steam ile giriş** yap
   ve Dota'yı bir kez yeniden başlat. Uygulama tepside çalışır, maçını siteye
   gönderir.
3. **İstersen Overwolf ekle.** Sitedeki **MMR için Overwolf** butonuyla
   kurulur. Rakip pickleri, oyuncu pozisyonlarını ve maç başına gerçek MMR
   değişimini getirir. Kurulu değilse uygulama yine çalışır.

## Özellikler

### Oyuncu Değerlendirme

Kadrodaki her oyuncu için bir kart: rank madalyası, dönem puanı, galibiyet /
mağlubiyet, MMR değişimi, Performance Rank, form şeridi ve en çok oynanan 8
hero. **Hafta / Ay / Son 60** seçimine göre hesaplanır ve puana göre sıralanır.
Kartın çerçeve rengi dönemin nasıl geçtiğini gösterir (yeşil iyi, kırmızı
kötü).

Karta tıklayınca açılan detayda genel bakış, performans, hero havuzu, son
maçlar ve sinerji sekmeleri var. Hero havuzu dört listedir: **imza** (tüm
oyunlarda çok oynanıp kazanılan), **tercih** (son maçlarda sık alınan),
**tavsiye** (tarzına uyan, az oynanmış) ve **zayıf** (oynanıp kazanılamayan).

**Pozisyon beyanı:** OpenDota pos4 ile pos5'i çoğu zaman ayıramaz. Kendi
profilindeki "Son maçlar" sekmesinden her maçın pozisyonunu seçebilirsin; maç
o pozisyonun ölçütleriyle yeniden puanlanır.

### Canlı Maç

Skor, süre ve iki takımın oyuncuları. Her oyuncu tek satırda görünür: hero,
KDA, LH/DN, envanter ve item tavsiyesi. Kadrodaki oyuncular vurgulanır.
Kadrodan birkaç kişi aynı maçtaysa gönderdikleri veri tek panelde birleşir.

**Item tavsiyesi eldeki veriye göre genişler:**

| Elde ne var                               | Ne önerilir                                |
| ----------------------------------------- | ------------------------------------------ |
| Yalnızca kendi satırın                    | Hero planından 2 öneri                     |
| 10 hero biliniyor (Overwolf / maç izleme) | Rakip hero'lara karşı itemler, 5 öneri     |
| Rakip envanteri de görünüyor              | Rakibin itemlerine karşı kurallar, 6 öneri |

Tavsiyede şunlar birlikte değerlendirilir: hero'nun planı, rakibin
özellikleri (görünmezlik, büyü hasarı, kaçış, debuff…), rakip hero'ların
counter itemleri, rakibin eldeki ya da beklenen itemleri, oyuncunun bu maçtaki
pozisyonu ve oyun saati. Erken oyunda önce ara parça önerilir (Manta yerine
Yasha); geç oyunda küçük itemler önerilmez. Takımda tek kişinin alması
gereken itemler (Pipe, Mekansm, Vessel…) rolü uyan oyuncuya verilir; takımda
zaten varsa başkasına önerilmez. Oyundan kaldırılmış itemler hiç önerilmez.

Envanteri görünmeyen oyuncular için oyun saatine göre **tahmini envanter**
gösterilir (soluk kutular).

### Takım Analizi

Canlı maçın üstünde iki takımın radar grafiği, eksen eksen yüzde tablosu,
avantaj listesi ve takım için Core / Destek / Duruma göre item önerileri.
Öneriler, onu alabilecek hero'larla birlikte gösterilir.

### Draft Asistanı

Pick başlamadan tanınan oyuncuların hero havuzuna göre, pick sürerken iki
takımın seçimlerine göre (counter, combo, rakibin özellikleri, oyuncunun hero
havuzu) her pozisyon için hero önerir. Seçilen bir hero'nun hangi pozisyona
alındığı kesin bilinemediği için **pick bitene kadar beş pozisyonun hepsi
görünür**. Pickler bitince asistan gizlenir.

### Tavsiyeleri yönet

Üst bardaki düğme hero kataloğunu açar. Hero'lar ana özelliğe ya da pozisyona
göre gruplanır. Bir hero'ya tıklayınca şu alanlar düzenlenir:

| Alan                       | Ne işe yarar                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| Pozisyonlar                | Hero'nun oynandığı roller (draft ve canlı tavsiye kullanır)           |
| Özellikler                 | Rakip bu hero'yu görünce ne alsın (görünmez → dust, debuff → dispel…) |
| Roller                     | Sekiz eksen (0-100); takım radarını besler                            |
| Counter hero'lar           | Bu hero'yu zorlayan hero'lar (draft kullanır)                         |
| Counter itemler            | Bu hero'ya karşı alınan itemler (rakip takıma önerilir)               |
| Gerekli / Durumsal itemler | Hero'nun item planı                                                   |
| Hiç önerme                 | Bu hero'da asla önerilmesin                                           |

- **Kim düzenler:** Steam ile giriş yapmış kadro oyuncuları. Katalog ortaktır;
  site ve masaüstü aynı kaydı kullanır.
- **Düzenlenmiş işareti:** Başlıktaki "N hero düzenlenmiş" sayısı ve yeşil
  çerçeve, varsayılandan farklı olan hero'ları gösterir.
- **Kaydet:** Yalnızca katalog yöneticisi (Janissary) görür ve yalnızca
  düzenlenmiş hero varken çıkar. Basınca mevcut düzenlemeler varsayılan olur;
  sayı ve işaretler sıfırlanır. Sonraki düzenlemeler yeniden kaydedilene kadar
  işaretli görünür.
- **Sıfırla:** Hero'yu varsayılan kaydına döndürür.

### Masaüstü uygulaması

- Açılışta doğrudan sistem tepsisine iner; tepsi menüsündeki **Aç** ile
  pencere gelir.
- Dota'nın GSI dosyasını kendisi kurar. Dota bulunamazsa tepsi menüsündeki
  **GSI dosyasını kur** ile tekrar denenir ya da dosya elle şuraya konur:
  `...\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\`
- Masaüstünde yalnızca Canlı Maç ekranı vardır; oyuncu kartları sitededir.
- Ekran yakalama, OCR ya da bellek okuma **yoktur**. Veri Dota'nın resmî GSI
  çıkışından ve (kuruluysa) Overwolf'un düz metin logundan gelir.

### Sık sorulanlar

**Maç verilerim gelmiyor.** Dota 2 → Ayarlar → Seçenekler → Gelişmiş
Seçenekler → **Maç Verilerini Herkese Açık Yap** açık olmalı. Kapalıyken rank
görünür ama maç listesi hiçbir kaynaktan gelmez.

**Yenile butonu kapalı.** Veri ortaktır. Son 5 dakika içinde biri
yenilediyse tekrar çekilmez; buton kalan süreyi gösterir.

**Son maçım listede yok.** OpenDota maçları kendi programına göre indeksler,
bazen saatler sürer. MMR değeri Overwolf'tan geldiği için maçtan önce
görünebilir.

**MMR yanında `~` var.** Overwolf kurulu olmayan oyuncuda MMR, rank
madalyasından yaklaşık hesaplanır. Ölçülen değer her zaman tahminin önüne
geçer.

---

## Teknik

### Klasör düzeni

```
dotastat/
├── packages/
│   ├── core/      @dotastat/core — saf iş mantığı (tarayıcı, Netlify, Electron)
│   │   └── src/
│   │       ├── data/       hero ve oyuncu verileri
│   │       ├── heroes/     hero adları, tavsiye kataloğu
│   │       ├── players/    değerlendirme motorları, kadro, veri servisi
│   │       ├── providers/  OpenDota / Stratz istemcileri
│   │       ├── draft/      draft asistanı
│   │       ├── live/       item tavsiyesi, tehditler, takım analizi
│   │       ├── gsi/        GSI normalizasyonu, canlı maç bağlamı
│   │       └── overwolf/   Overwolf log ayrıştırma
│   ├── web/       React + Vite arayüz
│   └── desktop/   Electron uygulaması + yerel sunucu (port 3044)
├── netlify/functions/   API (Steam girişi, oyuncular, canlı maç, katalog…)
├── scripts/             veri üreticileri, sahte canlı maç
└── .github/workflows/   CI ve kurulum dosyası yayını
```

`core` dosya sistemi, Express ya da Electron kullanmaz. Önbellek ve disk
işleri çağıran katmandadır: Netlify'da Netlify Blobs, masaüstünde JSON
dosyası.

### Geliştirme

```bash
npm install                # core + web
npm run desktop:install    # masaüstü paketi (workspace dışında, ayrı kurulur)
npm test                   # core testleri
npm run dev:cloud          # site + API: http://localhost:8888
npm run dev:desktop        # Electron (önce: npm run build:web)
npm run desktop:serve      # masaüstü sunucusu, Electron olmadan
```

- Steam girişini yerelde denemek için **http://lvh.me:8888** kullan; Steam
  `localhost` adresini reddeder.
- Yerelde Blobs verisi `%TEMP%\dotastat-dev-store` altına da yazılır; dev
  sunucusu yeniden başlayınca önbellek kaybolmaz.

**Dota açmadan canlı maç:**

```bash
npm run dev:fake-match           # tek maç gönderir (3 dk sonra bayatlar)
npm run dev:fake-match:watch     # 10 sn'de bir tazeler
```

| Bayrak           | Etkisi                                     |
| ---------------- | ------------------------------------------ |
| `--empty`        | Envanterler boş (maç başı)                 |
| `--enemy-hidden` | Rakip envanteri yok (Overwolf'suz kurulum) |
| `--url <adres>`  | Varsayılan `http://localhost:8888`         |

Yetki `.env` içindeki `LIVE_INGEST_TOKEN` ile alınır.

### Yayına alma

**Netlify:** Repoyu içe aktar; derleme ayarları `netlify.toml`'dan okunur.
`main` dalına her push siteyi yeniden yayınlar. Ortam değişkenleri:

| Değişken            | Zorunlu             | Ne işe yarar                      |
| ------------------- | ------------------- | --------------------------------- |
| `SESSION_SECRET`    | evet                | Steam oturum çerezini imzalar     |
| `OPENDOTA_API_KEY`  | hayır               | OpenDota limitini yükseltir       |
| `STRATZ_API_KEY`    | hayır               | OpenDota limitteyken yedek kaynak |
| `GITHUB_REPO`       | indirme butonu için | `kullanici/dotastat`              |
| `LIVE_INGEST_TOKEN` | hayır               | Eski masaüstü kurulumları için    |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Masaüstü kurulum dosyası:** `v*` etiketi push'lanınca
`.github/workflows/release.yml` Windows kurulumunu derleyip GitHub Release
olarak yayınlar.

```bash
git tag v1.0.0 && git push origin v1.0.0
npm run desktop:dist             # yerelde derleme
```

Yerelde `Cannot create symbolic link` hatası alırsan Windows'ta **Geliştirici
Modu**'nu aç. `latest.yml` üretilemiyorsa `git remote` tanımla; kurulum
dosyası yine üretilmiştir.

### Veri kaynakları ve çekme kuralları

| Kaynak                   | Ne için                                               |
| ------------------------ | ----------------------------------------------------- |
| OpenDota                 | Maç geçmişi, rank, hero istatistiği                   |
| Stratz                   | OpenDota limitteyken yedek (`STRATZ_API_KEY` gerekir) |
| Dota 2 GSI               | Canlı maç ve draft                                    |
| Overwolf / DotaPlus logu | Rakip pickler, pozisyonlar, rank, maç başına MMR      |
| Steam OpenID             | Giriş                                                 |

- Önbellek tüm ziyaretçiler arasında ortaktır. Dış kaynağa yalnızca şu
  durumlarda gidilir: veri hiç yoksa, **Yenile**'ye basılınca (5 dk ortak
  bekleme) ve canlı maç bitince.
- Tazeleme veriyi silmez. Gelen maç listesi eldekiyle birleştirilir;
  başarısız ya da boş yanıt ekrandaki veriyi korur.
- Ward verisi çoğu maçta yoktur. Bu durumda `null` tutulur ve vision
  ölçütü puandan çıkarılır; 0 sayılmaz.
- Maç verisi gizli oyuncular tanınır, onlar için istek atılmaz.

### Canlı maç ve kimlik

- Masaüstü, canlı maçı siteye **Steam oturum çereziyle** gönderir (30 gün
  geçerli). Yükleyicinin kimliği istek gövdesinden değil çerezden okunur.
- GSI oynarken yalnızca kendi oyuncunu verir. Overwolf logundan 10 slotun
  hero'su, pozisyonu, rank'i ve banlar okunur. Kaynaklar hero anahtarıyla
  birleştirilir; çakışmada GSI kazanır.
- Ranked maçta rakiplerin adı ve SteamID'si gizlidir; hero, rank ve pozisyon
  gelir.
- MMR hiçbir genel API'de yok. Overwolf üzerinde çalışan uygulamanın logundan
  okunur ve zamana göre en yakın biten maça bağlanır.

### Dönem puanı

| Ölçüt                                                     | Ağırlık |
| --------------------------------------------------------- | ------- |
| Gerçek MMR değişimi (ölçülemeyen maç ±25)                 | 34      |
| Galibiyet / mağlubiyet (küçük örnekte ortalamaya çekilir) | 26      |
| Performance Rank değişimi                                 | 20      |
| Oynanan maç sayısı                                        | 12      |

Başarı kısmı maç sayısıyla ağırlıklanır; tek maç oynayıp kazanan biri
birinci olamaz. "Son 60" bir takvim penceresi değil, önbellekteki son 60
maçtır. Hesap `players/weekly-score.js` dosyasında.

### Tavsiye kataloğu

Bir hero'nun kaydı üç katmandan oluşur; her katman bir öncekinin üzerine
biner:

| Katman                  | Nerede                                 | Kim değiştirir                     |
| ----------------------- | -------------------------------------- | ---------------------------------- |
| Üretilmiş veri          | `core/src/data/hero-overrides.js`      | `scripts/build-hero-overrides.mjs` |
| Elle tutulan varsayılan | `core/src/data/hero-seed-overrides.js` | Geliştirici                        |
| Ortak düzenleme         | Netlify Blobs `heroes:shared`          | Kadro, "Tavsiyeleri yönet"         |

`heroes:shared` iki küme tutar: `heroes` (geçerli düzenlemeler; tavsiye
bunu kullanır) ve `defaults` (**Kaydet** anındaki kopya).
Ekrandaki "düzenlenmiş" işareti ikisinin farkıdır. Varsayılanı kaydetme
yetkisi `players.seed.js` içindeki `catalogAdmin: true` alanından gelir;
sunucu bunu oturumdan doğrular.

Üretilmiş veriyi yenilemek için:

```bash
node scripts/build-hero-overrides.mjs && npm run format
```

Üretici mevcut dosyayı temel alır ve eksikleri sırasıyla `hero-profiles.js`,
`hero-roles.js` ve OpenDota'dan tamamlar; eldeki veri kaybolmaz. Hero adları
(`hero-localized.js`) ve ana özellikler (`hero-attributes.js`) de aynı
komutla üretilir.

Rakip özellikleri (görünmez, büyü hasarı, debuff…) ve cevap itemleri
`core/src/data/hero-traits.js` dosyasındadır.

### Kadroyu düzenleme

Oyuncular `core/src/data/players.seed.js`, oyuncu çifti sinerjileri
`synergies.seed.js` dosyasındadır. Düzenleyip push'lamak yeterli.
