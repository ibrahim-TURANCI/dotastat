# DotaStat

Arkadaş grubunun **Dota 2 oyuncu değerlendirmeleri** ve **canlı maç paneli**.
Site Netlify'da yayınlanır, arkadaşlar tarayıcıdan girip birbirlerinin
değerlendirmelerine bakar. Biri oyundayken (GSI kurulu masaüstü uygulamasıyla)
canlı maç ve draft asistanı da aynı sayfada görünür.

> **Önemli:** `performanceRank`, "tahmini seviye" ve performans profili
> değerleri **gerçek MMR değildir**. Oyun verisinden çıkarılan tahminlerdir ve
> arayüzde her yerde bu şekilde etiketlenir.

## Ne yapar

| Ekran | İçerik |
| --- | --- |
| **Oyuncu Değerlendirme** | Kadrodaki her oyuncu için kart: rank madalyası, tahmini seviye, form şeridi, en çok oynanan hero'lar. Karta tıklayınca sekmeli detay (genel, performans, hero havuzu, son maçlar, sinerji). |
| **Canlı Maç** | GSI'dan gelen skor, süre, iki takımın oyuncuları. Kadrodaki oyuncular vurgulanır. |
| **Draft Asistanı** | Canlı maçın altında. Pick başlamadan tanınan oyuncuların havuzuna göre, pick sürerken kendi + rakip seçimlere göre öneri verir. **Pickler bitince tamamen gizlenir.** |
| **Debug Panel** | Sayfanın altında **kapalı akordeon**; tıklanınca açılır ve o anda veri çeker. |

Bu projede **Overwolf, ekran yakalama ve OCR yoktur.** Canlı veri yalnızca
Dota'nın resmî Game State Integration arayüzünden gelir.

## Klasör düzeni

```
dotastat/
├── packages/
│   ├── core/        @dotastat/core — saf iş mantığı (bağımlılıksız ES modülü)
│   │   └── src/
│   │       ├── data/       hero/oyuncu tohum verileri
│   │       ├── heroes/     hero adı normalizasyonu, görsel adresleri
│   │       ├── players/    değerlendirme motorları, roster, veri servisi
│   │       ├── providers/  OpenDota istemcisi
│   │       ├── draft/      draft analizi + asistan
│   │       └── gsi/        GSI normalizasyonu + canlı maç bağlamı
│   ├── web/         React + Vite arayüz (Netlify'da yayınlanır)
│   └── desktop/     Electron uygulaması + yerel sunucu (port 3044)
├── netlify/functions/   Sunucusuz API (Steam girişi, oyuncular, canlı maç…)
└── .github/workflows/   CI + kurulum dosyası yayını
```

`core` paketi `fs`, Express veya Electron kullanmaz. Aynı kod hem tarayıcıda,
hem Netlify Functions'ta, hem Electron'da çalışır. Yan etkili işler (önbellek,
disk, oturum) çağıran katmanın sorumluluğundadır — bu yüzden aynı veri servisi
Netlify'da **Netlify Blobs** ile, masaüstünde **JSON dosyası** ile çalışır.

## Kurulum (geliştirme)

```bash
npm install                # kök: core + web (workspace)
npm run desktop:install    # masaüstü paketi (kendi node_modules'ı)
npm test                   # core testleri
npm run build:web          # arayüzü derle
```

> Masaüstü paketi bilerek **workspace dışındadır**. electron-builder, hoist
> edilmiş bir `node_modules` ağacıyla çalışırken kök ağacı buduyor; ayrı
> kurulum bu sorunu tamamen ortadan kaldırıyor. Yan faydası: Netlify kurulumu
> Electron ikilisini hiç indirmiyor.

### Çalıştırma seçenekleri

**1. Sadece arayüz** (API'siz — kartlar 500 ile boş gelir):

```bash
npm run dev
```

**2. Site gibi** (Netlify Functions dahil, önerilen):

```bash
npm run dev:cloud          # http://localhost:8888
```

> Vite'i 3045'te açar, Netlify Functions'ı önüne koyar. Arayüzü **8888**'den
> aç — 3045'e gidersen `/api` proxy'si boşa düşer ve "Oyuncu listesi
> alınamadı / istek-basarisiz-500" görürsün.

> **Steam girişini yerelde denemek için `http://lvh.me:8888` adresini kullan.**
> Steam'in OpenID ucu `localhost` / `127.0.0.1` realm'li istekleri Akamai
> katmanında 403 ile reddediyor ("Access Denied ... errors.edgesuite.net").
> `lvh.me` herkese açık DNS'te 127.0.0.1'e çözülür, dolayısıyla aynı yerel
> sunucuya gider ama Steam onu geçerli bir alan adı olarak kabul eder.

**3. Masaüstü gibi** (yerel sunucu + GSI):

```bash
npm run build:web
npm run dev:desktop        # Electron penceresi, sunucu 3044
```

Sunucuyu Electron olmadan da çalıştırabilirsin:

```bash
npm run desktop:serve
```

> Port **3044**'tür (`dotabaff` projesindeki 3000 ile çakışmaz). GSI
> yapılandırması da bu portu kullanır.

## Canlı yayına alma

### 1. GitHub

```bash
git init
git add .
git commit -m "DotaStat"
git branch -M main
git remote add origin https://github.com/KULLANICI/dotastat.git
git push -u origin main
```

### 2. Netlify

1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**
2. GitHub'daki repoyu seç. Ayarlar `netlify.toml`'dan okunur, elle bir şey girmene gerek yok:
   - Build command: `npm run build:web`
   - Publish directory: `packages/web/dist`
   - Functions directory: `netlify/functions`
3. **Site settings → Environment variables** altına şunları ekle:

   | Değişken | Zorunlu | Ne işe yarar |
   | --- | --- | --- |
   | `SESSION_SECRET` | evet | Steam oturum çerezini imzalar |
   | `LIVE_INGEST_TOKEN` | hayır (eski yol) | Masaüstü artık Steam oturumu kullanıyor; bu yalnızca eski kurulumlar için |
   | `OPENDOTA_API_KEY` | hayır | OpenDota limitini yükseltir |
   | `STRATZ_API_KEY` | hayır | OpenDota limite takılınca yedek kaynak |
   | `GITHUB_REPO` | indirme butonu için | `kullanici/dotastat` |

   `SESSION_SECRET` üretmek için:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

4. Deploy bitince adres hazır: `https://SITE-ADI.netlify.app`

**Güncellemeler otomatik yansır:** Netlify repoyu izler, `main` dalına her
push'ta siteyi yeniden derleyip yayınlar. `.github/workflows/ci.yml` de her
push'ta derlemeyi doğrular, böylece bozuk bir sürüm fark edilmeden yayına
gitmez.

### 3. Masaüstü kurulum dosyası

```bash
git tag v1.0.0
git push origin v1.0.0
```

`.github/workflows/release.yml` Windows kurulumunu derler ve GitHub Release
olarak yayınlar. Sitedeki **"Masaüstü sürümü"** butonu `/api/release` ucundan
en son release'i bulup indirme bağlantısını gösterir.

**Disk temizliği iki adımda yapılır:**

- `prebuild` her derlemeden **önce** `packages/desktop/release/` klasörünü
  tamamen siler;
- `postbuild` kurulum dosyası hazır olduktan **sonra** `win-unpacked/` gibi ara
  çıktıları ve varsa eski sürüm kurulumlarını siler (~270 MB).

Sonuçta klasörde yalnızca şunlar kalır:

```
DotaStat-Setup-<sürüm>.exe
DotaStat-Setup-<sürüm>.exe.blockmap   # fark tabanlı güncelleme
latest.yml                            # electron-updater (CI'da üretilir)
```

Yerelde denemek için:

```bash
npm run desktop:dist       # packages/desktop/release/DotaStat-Setup-1.0.0.exe
```

#### Yerel derlemede karşılaşabileceğin iki şey

1. **`Cannot create symbolic link ... libcrypto.dylib`** — electron-builder'ın
   imzalama araç paketini açarken sembolik bağlantı kuramaması. Windows'ta
   Geliştirici Modu kapalıyken olur. Çözüm: Ayarlar → Gizlilik ve güvenlik →
   Geliştiriciler için → **Geliştirici Modu**'nu aç. (GitHub Actions'ta bu sorun
   yaşanmaz.)
2. **`Cannot read properties of null (reading 'channel')`** — `latest.yml`
   üretilirken repo adresi bulunamıyor. Kurulum dosyası yine de üretilmiştir;
   yalnızca otomatik güncelleme dosyası eksiktir. `git remote add origin ...`
   yaptıktan sonra kaybolur. Release iş akışı repo adresini kendisi yazdığı için
   CI'da hiç görülmez.

## Masaüstü uygulaması

### Ne yapar

- 3044 portunda yerel sunucu açar ve arayüzü orada servis eder.
- Dota'nın GSI çıkışını `POST /gsi` ucunda karşılar.
- Maç durumunu siteye iletir; böylece arkadaşlar canlı maçı görebilir.
- Sistem tepsisinde kalır, pencere kapansa da çalışmaya devam eder.

### GSI kurulumu

Uygulama ilk açılışta Dota'nın cfg klasörünü bulup
`gamestate_integration_dotastat.cfg` dosyasını kendisi yazar. Tepsi menüsünden
**"GSI dosyasını kur"** ile tekrar tetiklenebilir.

**Dosya yazıldıktan sonra Dota'yı yeniden başlatman gerekir.**

Dota bulunamazsa dosyayı elle şuraya koy:

```
...\Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\
```

### Canlı maçı siteyle paylaşma

Uygulama ayarlarına (`%APPDATA%\DotaStat\settings.json`) şunları gir:

```json
{
  "cloudUrl": "https://SITE-ADI.netlify.app",
  "ingestToken": "Netlify'daki LIVE_INGEST_TOKEN ile aynı değer",
  "shareLive": true
}
```

Aynı değerler `DOTASTAT_CLOUD_URL` ve `DOTASTAT_INGEST_TOKEN` ortam
değişkenleriyle de verilebilir.

### Tepsi ikonu

Simge, kurulumdan sonra "gizli simgeler" panelinde **boş görünmemesi** için:

- `.ico` çok katmanlıdır (16/20/24/32/40/48) — Windows ölçekli ekranlarda
  (%125/%150/%200) doğru katmanı seçebilsin diye. Tek katmanlı bir PNG'yi 16
  piksele zorlamak, boş kare çizilmesinin en yaygın sebebi;
- ikon `extraResources` ile asar arşivinin **dışına** kopyalanır, çünkü
  `nativeImage.createFromPath` asar içindeki dosyalarda boş görsel dönebiliyor;
- yükleme sırası: önce `createFromPath` (Windows'ta `.ico` çözebilen tek yol),
  sonra `createFromBuffer` (asar içi PNG için), en sonda gömülü PNG.

Her adayın sonucu `isEmpty()` ile doğrulanır; boş dönen aday atlanır. Hangi
dosyanın kullanıldığı uygulama günlüğüne yazılır:

```
[info] Tepsi ikonu kaynagi: ...\resources\tray.ico
```

İkonları yeniden üretmek için:

```bash
npm --prefix packages/desktop run icons
```

## Kimlik / Steam girişi

- **Sitede:** sağ üstteki **"Steam ile giriş"** butonu Steam OpenID akışını
  başlatır. API anahtarı gerekmez; dönüş Steam'e geri sorularak doğrulanır,
  sonra imzalı bir çerez yazılır. Giriş yapan kişi online listesinde görünür.
- **Giriş yapılmadıysa:** kadrodaki bir oyuncu oyundayken üst barda o kişinin
  adı "oyundan tespit edildi" notuyla görünür.
- **Masaüstünde:** kimlik GSI'dan gelen SteamID ile belirlenir; istenirse
  ayarlardan elle girilebilir.

## Veri kaynakları

| Kaynak | Ne için | Anahtar gerekir mi |
| --- | --- | --- |
| OpenDota | maç geçmişi, rank madalyası, tüm zamanlar hero istatistiği | hayır (opsiyonel) |
| Stratz | OpenDota limite takılınca aynı verinin yedeği | **evet** (`STRATZ_API_KEY`) |
| Dota 2 GSI | canlı maç, draft | hayır |
| Steam OpenID | giriş | hayır |

Önbellek **tüm ziyaretçiler arasında paylaşılır**: siteye 10 kişi de girse
OpenDota'ya giden istek sayısı değişmez.

### Ne zaman veri çekilir

Dış kaynağa **yalnızca iki durumda** gidilir:

1. Oyuncunun elde hiç verisi yok (ilk açılış)
2. Kullanıcı **"Yenile"** butonuna bastı

Verinin eskimiş olması tek başına yeniden çekme sebebi **değildir** — eski veri
olduğu gibi gösterilir, kartın üzerinde "güncellendi: 2 gün önce" yazar.
Tazeleme kararı kullanıcının.

Önceden üç ayrı tetikleyici vardı ve üçü de limiti boşa harcıyordu: panel 3
dakikada bir kendini yokluyordu, sekmeye her dönüşte yeniden istek atıyordu ve
sunucu TTL'i dolan herkesi arka planda tazeliyordu. Üçü de kaldırıldı.

Ayrıca boş sonuç dönen (profili gizli, hiç maçı olmayan) oyuncu için bir
"denendi" işareti yazılır ve 6 saat boyunca tekrar denenmez; bu işaret olmadan
böyle bir oyuncu her sayfa açılışında bir istek harcıyordu. "Yenile" bu
bekleyişi yok sayar.

Canlı maç paneli (`/api/live`) ve online listesi (`/api/presence`) pollamaya
devam eder — onlar GSI/presence deposundan okur, OpenDota'ya gitmez.

## Ward / vision verisi hakkında

**OpenDota bu veriyi oyuncu maç uçlarından vermiyor.** `/recentMatches`
alanları arasında yok; `/players/{id}/matches` ucunda `project=obs_placed`
istesen de sessizce düşürülüyor. Yalnızca *parse edilmiş* maçların detayında
(`/matches/{id}`) bulunuyor ki o da maç başına bir istek demek — ve maçların
yalnızca küçük bir kısmı parse ediliyor.

Bu yüzden `obsPlaced` / `senPlaced` alanları **0 değil `null`** taşır. Ayrım
önemli: değerlendirme motorunda vision, support ağırlığının **%22'sini**
tutuyor. Eksik veriyi 0 saymak her support maçında "0 obs / 0 sentry" yazıp
mümkün olan en düşük puanı veriyordu — ölçüldü: maç başına ~250 PR kayıp.

Artık ward verisi yoksa vision faktörü değerlendirmeden **tamamen çıkarılır**
ve kalan ölçütlerin ağırlıkları toplamı 1.0 olacak şekilde yeniden normalize
edilir. Eksik veri, kötü performans demek değildir. Maçın güven skoru düşer —
arayüz bunu gösterir.

Gerçekten 0 ward dikilmiş bir maç (örneğin GSI'dan gelen canlı veri) hâlâ
normal şekilde puanlanır.

### Kaynak zinciri

İstekler sırayla denenir: **OpenDota → Stratz**. OpenDota günlük limite
takılırsa (429 veya `{ error: "rate limit exceeded" }`) ya da geçici olarak
erişilemezse aynı istek Stratz'a düşer. "Oyuncu bulunamadı" (404) gibi kalıcı
hatalarda zincir durur — başka kaynak da bulamayacağı için boşuna istek
atılmaz.

`STRATZ_API_KEY` tanımlı değilse Stratz sessizce atlanır ve davranış eskisi
gibi kalır: limitte önbellekteki son veri gösterilir. Ücretsiz anahtar:
[stratz.com/api](https://stratz.com/api).

## Hero havuzu nasıl hesaplanır

Dört liste **farklı veri pencerelerine** bakar; bu ayrım kasıtlıdır:

| Liste | Pencere | Ölçüt |
| --- | --- | --- |
| İmza kahramanlar | tüm oyunlar | çok oynanan **ve** kazanma oranı yüksek |
| Tercih ettikleri | son maçlar | son dönemde sık alınan (yeni maçlar daha ağır) |
| Tavsiye edilenler | oynanmamış / az oynanmış | oyuncu tarzına uyan, az oynanıp çok kazanılan |
| Zayıf olduğu | tüm oyunlar | yeterince oynanmış ama kazanılamayan |

"İmza kahraman" bir kimlik sorusudur, bir aylık formdan etkilenmemelidir;
"tercih ettikleri" ise tam tersine şu anki metayı göstermelidir. İkisini aynı
listeden türetmek her ikisini de bozuyordu.

Ayrıntılar [hero-pool.js](packages/core/src/players/hero-pool.js) içinde:

- Kazanma oranı küçük örneklerde 0.5'e çekilir (2 maçta %100 → ~%58), böylece
  3 maçlık heroler imza listesini ele geçirmez.
- Tavsiyede **pozisyon uyumu çarpandır**, toplanan bir terim değil. Pos 1
  seçen birine offlane kahramanı önerilmez, tarzı ne kadar uysa da.
- Sıralamadaki eşitlikler `draft.comboWithHeroes` verisiyle bozulur: adayın
  oyuncunun kendi havuzuyla combo yapıp yapmadığına bakılır.

## Maç pozisyonu beyanı

OpenDota pozisyonu `lane_role` + `is_roaming` üzerinden **tahmin eder** ve
pos4/pos5 ayrımını çoğu zaman yapamaz. Değerlendirme motoru ise bu ikisini
farklı ölçütlerle puanlar.

Bu yüzden Steam ile giriş yapan kişi **kendi profilinde**, "Son maçlar"
sekmesinden her maç için oynadığı pozisyonu seçebilir. Seçim tahminin önüne
geçer (`roleSource: "manual"`) ve o maç seçilen pozisyonun ölçütleriyle
yeniden puanlanır. Seçim kaldırılırsa otomatik tahmine geri dönülür.

Kayıt anahtarı **her zaman oturum çerezindeki account id**'dir; istek
gövdesinden gelen kimliğe güvenilmez. Kimse başkasının maçlarına rol yazamaz.

## Kadroyu düzenleme

Oyuncular `packages/core/src/data/players.seed.js`, ikili sinerji notları
`synergies.seed.js` içinde. Dosyalar düz JavaScript nesneleridir; düzenleyip
push'lamak yeterli — Netlify siteyi kendisi yeniden yayınlar.

## "Maç verileri gelmiyor" — profil gizli değilse bile

Steam profili herkese açık olsa da Dota'nın kendi ayarı kapalıysa hiçbir
kaynak maç listesi veremez. İki sağlayıcı da bunu ayrı bayraklarla bildirir:

| Kaynak | Bayrak | Anlamı |
| --- | --- | --- |
| OpenDota | `profile.fh_unavailable: true` | maç geçmişi alınamıyor |
| Stratz | `steamAccount.isAnonymous: true` | hesap maçlarda anonim görünüyor |

Böyle bir hesapta **rank ve profil görünür, maç listesi her zaman boştur**.
Toplam maç sayısı bile görünebilir (Stratz 1272 maç raporlayabilir) ama
maçların kendisi gelmez.

Çözüm oyuncunun kendisinde: **Dota 2 → Ayarlar → Seçenekler → Gelişmiş
Seçenekler → "Maç Verilerini Herkese Açık Yap"** açılmalı. Ayar açıldıktan
sonra veriler bir süre içinde sağlayıcılara yansır.

Uygulama bu durumu tanır: kartta "veri bekleniyor" yerine ayarı tarif eden bir
açıklama gösterir, `pendingPlayers` yerine `hiddenPlayers` listesinde raporlar
ve bu oyuncular için maç/hero uçlarına **hiç istek atmaz**.

## Canlı maç yayını nasıl yetkilendirilir

Masaüstü uygulaması maç verisini siteye gönderirken kimliğini **Steam oturum
çereziyle** kanıtlar. Kullanıcı uygulamadaki **"Steam ile giriş"** butonuna
basar, Electron ayrı bir pencerede sitenin OpenID akışını açar, dönüşte çerez
uygulamanın oturumuna yazılır ve röle onu her istekte gönderir.

Çerez ömrü 30 gündür, yani ayda bir kez giriş yapılır.

**Neden böyle:** önceden `LIVE_INGEST_TOKEN` diye paylaşılan tek bir gizli
anahtar vardı ve her arkadaşın onu ayarlara elle yapıştırması gerekiyordu. İki
sorunu vardı:

- Anahtarı bilen herkes **istediği SteamID adına** veri gönderebiliyordu
- Dokuz kişide dolaşan bir sır artık sır değildir; biri sızdırsa iptal etmek
  herkesi etkilerdi

Oturum çereziyle kimlik imzalı gelir; yükleyicinin SteamID'si gövdeden değil
çerezden okunur, dolayısıyla kimse başkası adına yayın yapamaz.

Eski `x-dotastat-token` başlığı hâlâ kabul ediliyor — güncellemeyi geciktiren
kurulumlar kırılmasın diye. Yeni kurulumlarda kullanılmamalı.

## Yenile: 5 dakikalık ortak bekleme

"Yenile" her basıldığında OpenDota'ya **gerçek istek** gider ve önbellek **tüm
ziyaretçiler arasında paylaşılır**. Bu yüzden tazeleme kişisel değil **ortak**
bir eylemdir: biri iki dakika önce tazelediyse, ikinci kişinin tazelemesi aynı
veriyi bir kez daha çekmekten başka bir şey yapmaz — o veriyi zaten görüyor.

Kural: bir oyuncunun verisi **5 dakikadan yeniyse** tazeleme atlanır. Kişi
başına sayaç yoktur; kimlik çözmeye de gerek kalmaz, çünkü önbellek zaten ne
zaman dolduğunu biliyor (`fetchedAt`).

- Buton "son güncelleme: 2 dk önce" yazar ve kalan süre boyunca kapalı durur
- 10 dakika, 2 saat, 1 gün önce güncellenmişse serbesttir
- Atlanan istekte de veri döner; ekran boş kalmaz
- Maç verisini gizleyen oyuncular hesaba katılmaz (`fetchedAt`leri hiç
  dolmadığı için butonu sürekli açık tutuyorlardı)

Panel istek başına en fazla 4 oyuncu tazeler; kadro daha kalabalıksa birkaç
tıkta tamamlanır, sonrasında bekleme devreye girer.

Süre [player-data-service.js](packages/core/src/players/player-data-service.js)
içinde `MIN_REFRESH_INTERVAL_MS`.

## Maç başına MMR değişimi

Maç listesinde `+26` / `-21` sütunu **gerçek MMR farkıdır**, tahmin değildir.
Ama gelmesi için bir koşul var.

### Neden ekstra kurulum gerekiyor

Dota 2 MMR'ı **hiçbir genel API'den vermiyor**. Denenip elenenler:

| Kaynak | Sonuç |
| --- | --- |
| Dota GSI (tüm veri blokları) | rank/MMR alanı yok |
| OpenDota | `computed_mmr` var ama `rank_tier` ile çelişiyor |
| Stratz `MatchPlayerType` | yalnızca `imp` ve `behavior` |
| Dota konsolu (`find mmr`) | sonuç yok |
| Yerel dosyalar (628 dosya tarandı) | MMR diske hiç yazılmıyor |

Değer yalnızca oyun istemcisinin belleğinde. Oraya Overwolf'un oyun içi
sağlayıcısı erişebiliyor; Overwolf üzerinde çalışan uygulama da onu kendi düz
metin loguna yazıyor. DotaStat **o dosyayı okuyor** — Dota'ya, belleğe veya
başka bir sürece dokunmadan. VAC riski yoktur.

### Nasıl çalışır

```
Overwolf → MMR uygulaması → controller.html.log → DotaStat → maç listesi
```

- Okunan değerler **kendi depomuza** yazılır; log dönse de geçmiş kalmaz
- MMR değişimi, kendisinden **önce biten en yakın maça** bağlanır
- Değer siteye de iletilir (Steam oturumuyla), böylece tarayıcıdan da görünür
- MMR yalnızca **kendi profilinde** görünür

### Sınırlar

- Kurulumdan **sonra** oynanan maçlar için birikir; geçmiş maçlarda boş kalır
- Üçlü (Overwolf + MMR uygulaması + DotaStat) maç sırasında açık olmalı
- Okuma maç bitiminden 2–66 dakika sonra geliyor; 3 saati aşan boşluklarda
  hangi maça ait olduğu bilinemez ve hücre boş bırakılır
- Kaynak uygulamanın log biçimi değişirse okuma sessizce durur; uygulamanın
  geri kalanı etkilenmez

Sitedeki **"⬇ MMR için Overwolf"** butonu gerekli kurulumu başlatır.

### Rank ilerlemesi

MMR bilindiğinde madalyanın yanında mevcut değer ve bir sonraki yıldıza kalan
mesafe yazar ("Kalan rank: 76"). Hesap yıldız genişliğinden türer: her yıldız
**154 MMR**, her madalya 5 yıldız.

Değer gerçek veriyle doğrulandı: MMR 3620 → Legend 4 (oyundan gelen
`rank_tier` 54 ile aynı) ve bir sonraki yıldıza 76 MMR — oyun içi
göstergeyle birebir.

Maç listesinde de maç sonrası MMR ve o maçın farkı birlikte görünür:
`3620 (+26)`.
