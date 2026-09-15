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
| **Oyuncu Değerlendirme** | Kadrodaki her oyuncu için kart: rank madalyası, dönem puanı, G/M, MMR değişimi, Performance Rank, maç sayısı, form şeridi ve en çok oynanan 8 hero. **Hafta / Ay / Son 60** seçimine göre hesaplanır (hero şeridi dahil), kartlar **puana göre sıralı**. Karta tıklayınca sekmeli detay (genel, performans, hero havuzu, son maçlar, sinerji). |
| **Canlı Maç** | GSI'dan gelen skor, süre, iki takımın oyuncuları. Her oyuncu **tek satır**: kimlik/hero, KDA ve LH/DN, envanter, item tavsiyesi. Kadrodaki oyuncular vurgulanır. Arkadaşlardan birinde Overwolf varsa rakip pickler de gelir. |
| **Takım Analizi** | Canlı maçın üstünde iki panel: altı eksenli **radar** + sekiz satırlık R/D yüzde tablosu, ve her iki taraf için avantaj listesi + Core/Support/Duruma Göre item önerileri. |
| **Tavsiyeleri yönet** | Üst bardaki tek düğme. Hero kataloğunu açar: pozisyona göre gruplanmış hero'lar, arama kutusu, hero'ya tıklayınca açılan düzenleme ekranı. |
| **Draft Asistanı** | Canlı maçın altında. Pick başlamadan tanınan oyuncuların havuzuna göre, pick sürerken kendi + rakip seçimlere göre öneri verir. **Pickler bitince tamamen gizlenir.** |
| **Debug Panel** | Sayfanın altında **kapalı akordeon**; tıklanınca açılır ve o anda veri çeker. |

### Envanter satırı

Envanter oyundaki kutu yerleşimini taklit eder; ekrana bakan kişi aynı anda
oyuna da bakıyor ve iki görüntünün örtüşmesi taramayı hızlandırıyor:

```
[agh]   [ 1 2 3 ]   [neutral]
[shard] [ 4 5 6 ]   [n. etki]
        [ b b b ]   [  tp   ]
```

Aghanim's Scepter ve Shard **solda ayrı** durur: ikisi de envanterde tutulmaz,
alındığında hero'ya işlenir (GSI bunu ayrı bir bayrak olarak veriyor). Bu
yüzden scepter'ini kullanmış bir oyuncuya bir daha scepter önerilmez. Kutular
yokken de çizilir, sadece soluklaşır — yokluğu da bilgidir.

Sağdaki üç yuvarlak kutu neutral item, neutral etkisi ve TP; üçü de ana
envanterden ayrı slotlardır.

### Item tavsiyesi ne kadar konuşur

Tavsiye ve takım analizi **eldeki veriye göre ölçeklenir**; eksik veriyle kesin
konuşmak, hiç konuşmamaktan kötüdür.

| Elde ne var | Ne üretilir |
| --- | --- |
| Yalnızca kendi satırımız (düz GSI) | Hero planından 2 öneri |
| 10 hero biliniyor (Overwolf / izleme) | Rakip hero'lara karşı item'lar açılır, 4 öneri |
| Rakip envanteri de görünüyor | Item-counter kuralları açılır, 6 öneri |

### Öneri hero'nun kendi listesinden çıkar

Bir oyuncu satırındaki öneriler **yalnızca o hero'nun** "Gerekli itemler" ve
"Durumsal itemler" listelerinden gelir. Rakip listeye item **eklemez**,
listedekileri **sıralar**.

Eskiden rakip hero'ların counter listesi de havuza giriyordu ve ekranda
hero'nun planında hiç olmayan item'lar beliriyordu — Dawnbreaker'a Linken's
Sphere, Eul's, Force Staff öneriliyordu çünkü rakip Anti-Mage'in counter
listesinde vardılar. Bu, düzenleme ekranını anlamsız kılıyordu: yazdığın liste
ile gördüğün öneri aynı şey değildi.

Şimdi rakip şöyle etkiliyor: hero'nun listesinde **zaten bulunan** bir item
rakip kompozisyonuna cevap veriyorsa başa geçer ve gerekçesi değişir —
"Hero'nun duruma göre item planında" yerine "Rakip büyü hasarı basıyor: Zeus,
Lina". Listede yoksa hiçbir şey uydurulmaz.

### Rakip kompozisyonundaki tehditler

Takım önerileri rakip kadroda ne olduğundan türer (bkz. `live/threats.js`):

| Rakipte | Önerilen |
| --- | --- |
| **Görünmez** (Riki, Weaver, Mirana, Bounty Hunter…) | Essence Distiller |
| **Can yenileyen** (Necrophos, Alchemist, Huskar, Io…) | Spirit Vessel |
| **Kaçan** (Puck, Storm, Ember, Anti-Mage, Void…) | Orchid / Bloodthorn / Scythe of Vyse |
| **Büyü hasarı** (Zeus, Leshrac, Skywrath, Snapfire, Veno…) | Pipe / BKB / Mekansm / Guardian Greaves |
| **Tek hedefli ulti** (Legion, Pudge, Anti-Mage, Lina, Spirit Breaker…) | Linken's Sphere / Aeon Disk |
| **Pasifi güçlü** (Bristleback, PA, Dragon Knight…) | Silver Edge / Khanda |

**Önerilen item, takımdan birinin planında olmak zorunda.** "Rakipte büyü hasarı
var, Pipe al" demek tek başına bir işe yaramıyor — Pipe'ı kim alacak? Takımda
planında Pipe olan kimse yoksa öneri havada kalır. Bu yüzden her öneri **onu
alabilecek hero'larla birlikte** gösterilir: planında Mekansm olan biri varsa
Mekansm önerilir, Pipe olan varsa Pipe, ikisi de varsa ikisi birden.

Tehdit listeleri **elle tutulur**. Önce Valve'in yetenek verisinden türetmeyi
denedim (`behavior` bitmaskesi, hasar türü, açıklama metni); sonuç
kullanılamazdı — "pasif yeteneği var" 127 hero'nun 119'unu, "hedefli büyüsü
var" 91'ini işaretliyordu. Buradaki soru "teknik olarak pasifi var mı" değil,
"bu hero yüzünden Silver Edge alınır mı"; o yargı veride yok.

Öneriler **kaldırılmış item'ları hiç içermez**. Necronomicon (7.29), Ring of
Aquila, Poor Man's Shield gibi item'lar OpenDota tablosunda ve Valve'in item
listesinde hâlâ duruyor (eski maçlar okunabilsin diye), ama oyunda yoklar;
listede görünmeleri var oldukları anlamına gelmiyor. Bunlardan birini önermek,
kullanıcıyı dükkânda bulamayacağı bir item için altın biriktirmeye iter ve
listenin tamamına olan güveni götürür (bkz. `live/item-keys.js`).

### Tavsiyeleri yönet

Üst barda, "DotaStat" yazısının yanında **tek bir düğme** var. Açılan pencerede
tüm hero'lar pozisyona göre gruplanmış halde durur; arama kutusu listeyi
filtreler, bir hero'ya tıklayınca düzenleme ekranı açılır:

| Alan | Ne işe yarar |
| --- | --- |
| **Pozisyonlar** | Hero'nun listedeki grubu |
| **Roller** | Sekiz eksen (0-100). **Takım radarını besleyen sayılar bunlar.** |
| **Counter hero'lar** | Bu hero'yu zorlayan hero'lar |
| **Counter item'ler** | Bu hero'ya *karşı* alınanlar — rakip takıma önerilir |
| **Gerekli item'ler** | Çekirdek plan; öneri listesinin başında gelir |
| **Durumsal item'ler** | Plan dolmadığında tamamlayanlar |
| **Hiç önerme** | Bu hero'da asla önerilmesin |

Kaydedilen liste tohum verinin **yerine** geçer; "Sıfırla" kaydı siler ve hero
varsayılana döner. Düzenlenen hero listede yeşil çerçeveyle işaretlenir.

**Düğme yalnızca kadrodaki oyunculara görünür.** Katalog arkadaş grubunun ortak
oyun bilgisi — kimin hangi hero'da ne aldığı, neye karşı ne alındığı; gruba ait
olmayan bir ziyaretçinin orada düzenleyeceği bir şey yok. Steam ile giriş
yapılmış olması tek başına yetmez, hesabın `players.seed.js` içindeki kadroda
bulunması gerekir. Sunucu aynı şartı bağımsız olarak uygular (401 oturum yok,
403 kadroda değil): düğmenin gizli olması ucun korunması demek değil.

**Katalog ortaktır: tek bir kayıt, site ve masaüstü için aynı.** "Bu hero'da
bu item alınır" bilgisi kişiye özel değil, grubun ortak bilgisidir; bu yüzden
kadrodaki herkes aynı kaydı okur ve yazar. Masaüstü uygulaması kendi kopyasını
tutmaz, kataloğu siteden okur — böylece oyun sırasında masaüstünde yapılan bir
düzenleme sitede de, herkesin canlı maç tavsiyesinde de görünür. Site
erişilemezse son okunan katalog **yerel aynadan** kullanılır (tavsiye
çevrimdışı da doğru çalışır); o sırada yapılan düzenleme yalnızca o
bilgisayarda kalır ve yanıt bunu `synced: false` ile bildirir.

Yazma yetkisi her zaman oturumdan doğrulanır; masaüstünde Steam OpenID akışı
yoktur — kimlik ayarlardaki SteamID'dir ve aynı kadro şartına tabidir.
Kişiye özel eski kayıtlar silinmedi: ortak kayıt ilk kez okunduğunda hepsi
birleştirilip ortak kataloğa taşınır.

> Eskiden bu düğme **her canlı maç satırında ayrı ayrı** duruyordu. Düzenleme
> oyuncunun değil hero'nun kaydına yazıldığı için bu yanlış bir şey vaat
> ediyordu; üstelik bir hero'yu düzenlemek için onun o an bir maçta olması
> gerekiyordu. Eski `{ add, remove }` kayıtları kaybolmadı: ortak kataloğa
> taşınıyor.

Bu projede **ekran yakalama ve OCR yoktur**; oyuna, belleğe ya da başka bir
sürece de dokunulmaz. Canlı veri Dota'nın resmî Game State Integration
arayüzünden gelir. Kullanıcının makinesinde Overwolf zaten kuruluysa onun
**düz metin logu okunur** (yalnızca dosya okuması) ve GSI'nın canlı maçta
veremediği iki şey eklenir: rakip pickler ve maç başına MMR değişimi. Overwolf
yoksa bu okuma hiç çalışmaz, uygulamanın geri kalanı etkilenmez.

### Ekran düzeni

Bölümler **katlanabilir**. Sitedeki varsayılan durum:

| Bölüm | Varsayılan |
| --- | --- |
| Oyuncu Değerlendirme | açık |
| Canlı Maç | kapalı |
| Debug Panel | kapalı |

**İçerik kuruluma göre değişir.** Masaüstü uygulaması oyunun yanında, oyun
sırasında açık durur; oraya bakmanın sebebi her zaman o anki maçtır. Bu yüzden
masaüstünde **yalnızca Canlı Maç vardır** — Oyuncu Değerlendirme ekranı orada
hiç kurulmaz. Aynı veri sitede, daha geniş bir ekranda zaten duruyor;
masaüstünün işi maçı göstermek ve GSI verisini siteye göndermek:

```
Masaüstü : Canlı Maç (+ Debug)
Site     : Oyuncu Değerlendirme → Canlı Maç → Debug
```

Site çoğunlukla maç dışında açılıyor (kim nasıl gidiyor diye bakmak için), o
yüzden orada üst sırayı oyuncu kartları alır. Zaten maç başladığında Canlı Maç
kendiliğinden açılıp üstündeki bölüm katlanıyor.

**Canlı maç başladığında düzen kendiliğinden değişir:** Canlı Maç açılır,
diğeri katlanır — maç sürerken ekranda maç olsun diye. Maç bitince eski
düzene dönülür. Aradaki her an istediğin bölümü elle açabilirsin; otomatik
değişiklik yalnızca maç *başlarken* ve *biterken* olur, her yoklamada değil,
yoksa senin açtığın bölüm sürekli kapanırdı.

## Klasör düzeni

```
dotastat/
├── packages/
│   ├── core/        @dotastat/core — saf iş mantığı (bağımlılıksız ES modülü)
│   │   └── src/
│   │       ├── data/       hero/oyuncu tohum verileri (hero-overrides üretilmiş)
│   │       ├── heroes/     hero adı normalizasyonu, görsel adresleri, tavsiye kataloğu
│   │       ├── players/    değerlendirme motorları, roster, veri servisi
│   │       ├── providers/  OpenDota istemcisi
│   │       ├── draft/      draft analizi + asistan
│   │       ├── live/       item tavsiyesi, takım analizi, item anahtarları
│   │       └── gsi/        GSI normalizasyonu + canlı maç bağlamı
│   ├── web/         React + Vite arayüz (Netlify'da yayınlanır)
│   └── desktop/     Electron uygulaması + yerel sunucu (port 3044)
├── netlify/functions/   Sunucusuz API (Steam girişi, oyuncular, canlı maç…)
├── scripts/             Veri üreticileri (hero tavsiye kataloğu)
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

### Canlı maç panelini Dota açmadan denemek

Canlı maç paneli yalnızca GSI verisi geldiğinde dolar. Envanter yerleşimini,
item tavsiyesini ya da takım analizini gözle görmek için normalde oyuna girmek
gerekir. `scripts/fake-live-match.mjs` masaüstü uygulamasının göndereceği
şeklin **aynısını** `/api/live` ucuna yollar; sunucu gerçek bir maçtan ayırt
etmez.

```bash
npm run dev:cloud              # 1. terminal — sunucu 8888'de
npm run dev:fake-match         # 2. terminal — tek maç gönder
npm run dev:fake-match:watch   # ya da: 10 sn'de bir tazele, skor ilerlesin
```

Sonra tarayıcıda **http://lvh.me:8888** — Canlı Maç bölümü kendiliğinden
açılır. Tek seferlik gönderim 3 dakika sonra bayatlar ve panel "canlı maç
yok"a döner; açık kalması için `--watch` kullan.

| Bayrak | Ne gösterir |
| --- | --- |
| *(yok)* | On oyuncu, dolu envanterler, tavsiye seviyesi `full` (6 öneri) |
| `--empty` | Envanterler boş — maç başı görünümü |
| `--enemy-hidden` | Rakip satırlarında envanter alanı **hiç yok** (Overwolf'suz kurulum). Tavsiye seviyesi `heroes`a düşer, 4 öneriye iner ve rakip satırlarında boş kutu yerine "envanter görünmüyor" yazar. |
| `--url <adres>` | Varsayılan `http://localhost:8888` |

Yetki `.env` içindeki `LIVE_INGEST_TOKEN` ile alınır — tarayıcı oturumu
gerekmez.

> **Tavsiyeleri yönet** penceresi giriş yapmadan da açılır ama **salt okunur**
> kalır; kaydetmeyi denemek için `lvh.me:8888` üzerinden Steam ile giriş yap
> (yukarıdaki nota bak — `localhost` realm'ini Steam reddediyor).

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
- **Açılışta pencere açılmaz, doğrudan tepsiye iner.** Tepsi menüsünden
  **"Aç"** ile getirilir. Ayarlar → Uygulama altından kapatılabilir.

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

Kurulumdan sonra yapılacak **tek şey var**: uygulamanın sağ üstünden
**"Steam ile giriş"**. Site adresi pakete gömülüdür
(`packages/desktop/package.json` → `dotastat.cloudUrl`) ve `shareLive`
varsayılan olarak açıktır.

Giriş neden gerekli: canlı maçı siteye gönderirken kimlik doğrulanmalı. Çerez
30 gün geçerlidir, yani ayda bir giriş yeterli.

**`LIVE_INGEST_TOKEN` istemcide GEREKMEZ.** Sunucu iki yetkilendirmeden
birini kabul eder (`live.mjs`: `if (!session && !tokenOk) return 401`) ve
röle, oturum varsa token'ı hiç göndermez. Token eski yöntemdir; dokuz kişiye
aynı sırrı dağıtmamak için oturumla değiştirildi. Geriye dönük uyum için
duruyor — giriş yapamayan bir kurulum onu kullanabilir.

Ayar önceliği: `DOTASTAT_CLOUD_URL` ortam değişkeni > kullanıcının kendi
ayarı > pakete gömülü adres. Elle girilen değer gömülünün önüne geçer.

#### İki ayrı kimlik var, karıştırılmamalı

| | Nereden gelir | Otomatik mi |
| --- | --- | --- |
| **SteamID** | GSI her maçta `localSteamId` gönderir | **Evet**, oyuna girmek yeterli |
| **Site oturumu** | Sitenin Steam OpenID akışı; çerez Electron oturumunda | **Hayır** |

Site oturumu otomatik **olamaz**: Steam kimliği yalnızca sitenin OpenID
yönlendirmesinden geçerek kanıtlanır. Oyun, sitenin güvenebileceği bir belge
vermez — verseydi herkes istediği SteamID adına veri gönderebilirdi.

Uygulamanın sağ üstü bu iki kimliği ayrı ayrı gösterir: oyundan okunan ad ve
site oturumunun durumu. Site adresi bir şekilde boşsa buton, sebebini ve
"Ayarları aç" bağlantısını yazar (eskiden sessizce hiçbir şey yapmıyordu).

### Canlı draft: Overwolf'lu arkadaş rakip pickleri de getirir

GSI'nin canlı maçta bir sınırı var: **sen oynarken yalnızca senin oyuncu
bloğunu gönderir.** Rakip takımın ne seçtiği orada yoktur. (Maç *izlerken*
tam kadro gelir — panel o yüzden izlemede dolu görünüp canlı maçta boş
kalıyordu.)

Overwolf'un oyun-olay sağlayıcısı bu bilgiyi görüyor ve üstünde çalışan
DotaPlus onu kendi düz metin loguna yazıyor — MMR'ı okuduğumuz logun aynısı.
DotaStat o logdan **10 slotun hero'sunu, rank'ini ve banları** okur.

```
Overwolf → DotaPlus → controller.html.log ─┐
                                           ├─→ DotaStat → /api/live → site
Dota → GSI (yalnızca kendi oyuncun) ───────┘
```

**Overwolf isteğe bağlıdır.** Kurulu değilse klasör bulunamaz, servis
`available: false` der ve hiçbir şey yapmaz; panel GSI'nin verdiği kadarıyla
eskisi gibi çalışır. Kapatmak için: Ayarlar → "Overwolf'tan canlı draft oku".

#### Farklı kurulumlar aynı maçta birleşir

Kadrodan üç kişi aynı maçtaysa ve kurulumları farklıysa, her kaynağın
gördüğü ekrana taşınır:

| Kim | Ne gönderir | Panelde ne görünür |
| --- | --- | --- |
| DotaStat + Overwolf | 10 slotun hero'su + rank + banlar | Rakip takımın tamamı |
| Yalnızca DotaStat | Kendi KDA / net worth / eşyaları | O kişinin satırı dolu |
| Tarayıcıdan bakan | — | İkisinin birleşimi |

Birleştirme **hero anahtarıyla** yapılır: bir maçta aynı hero iki kez
seçilemez, bu yüzden Overwolf'un slot tablosuyla GSI'nin kimlikli satırı
güvenle eşleşir. Overwolf iskeleti kurar, GSI üstüne detayı yazar; çakışmada
GSI kazanır — o, oyunun kendi çıkışıdır. Panel başlığında kaç kaynaktan
beslendiği yazar.

#### Sınırlar

- **Ranked maçta isim ve SteamID gizlidir** (`anonymous=true`). Canlı maçta
  rakiplerin kimliği alınamaz; hero, rank ve rol alınır. Kimlikler maç
  bitince açılır.
- Rank bilgisi controller logunda değil `DotaPlusObject_*.log` içindedir; iki
  log **farklı maçları** anlatıyorsa rank hiç yazılmaz (yanlış maça ait rank
  göstermek, hiç göstermemekten kötüdür).
- `isTraversal: true` satırı "hero'nun üstünde geziniyor" demektir, seçim
  değil. Kilitlenmiş bir seçim sonradan gelen gezinme satırıyla **bozulmaz**.
- **Maç izlerken / koçluk yaparken GSI'ın düz `player` bloğu SENSİN, maçtaki
  biri değil** — `hero` bloğu ise o an izlenen kahramanı gösterir. Ölçüldü
  (maç 8977224253): birleştirme hero anahtarıyla çalıştığı için izleyenin adı
  Anti-Mage oynayan yabancıya yapışmıştı. İki koruma kondu: (1) iki satırın da
  kimliği belliyse ve **farklıysa** eşleşme reddedilir, (2) izleme/koçluk
  modunda tabloyu Overwolf'un roster'ı belirler, eşleşmeyen GSI satırı
  masaya alınmaz. Oynarken bu ayıklama yapılmaz — orada GSI satırı gerçek
  oyuncudur ve tek detay kaynağıdır.
- Kaynak uygulamanın log biçimi değişirse okuma sessizce durur; GSI tarafı
  etkilenmez. Sözleşme
  [overwolf-live.test.js](packages/core/test/overwolf-live.test.js) ile
  sabitlendi — satırlar gerçek loglardan alındı.
- Durum Debug Panel → "Overwolf / DotaPlus" kartında görünür (okunan pick ve
  rank sayısı, son satırın zamanı).

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

Dış kaynağa **yalnızca üç durumda** gidilir:

1. Oyuncunun elde hiç verisi yok (ilk açılış)
2. Kullanıcı **"Yenile"** butonuna bastı
3. **Canlı maç bitti** — yeni maç tam o anda oluşur, değerlendirme ekranı bir
   kez tazeler (5 dakikalık ortak bekleme burada da geçerli, yani aynı anda
   bakan herkes ayrı ayrı istek atmaz)

### Tazeleme veri silemez

Gelen liste, duran listenin **üzerine yazılmaz — birleştirilir** (`matchId`
üzerinden birleşim; aynı maç için yeni satır kazanır, çünkü parse edilmiş maç
daha fazla alan taşır).

Sebebi: hiçbir kaynak "şu ana kadarki bütün maçlar" garantisi vermiyor.
OpenDota maçları kendi programına göre indeksliyor, Stratz'ta da liste anlık
olarak eksik gelebiliyor. Üzerine yazan bir tazeleme, o an cevap veren kaynak
ne verdiyse onu doğru kabul ediyordu; sonuç şuydu: kullanıcı son maçı görmek
için "Yenile"ye basıyor, maç yine gelmiyor **ve üstelik son bir iki günün
maçları ekrandan kayboluyordu**. Maç geçmişi yalnızca büyür — oynanmış bir maç
sonradan yok olmaz — bu yüzden birleşim alınır. En kötü ihtimalle tazeleme yeni
bir şey getirmemiş olur (bkz. `mergeMatchHistory`, `test/stale-preservation.test.js`).

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

Kart listesi de dakikada bir yoklanır ama o istek **`refresh` taşımaz**:
yalnızca paylaşılan önbelleği okur. Sebebi: önbellek ortak olduğu için biri
"Yenile"ye bastığında ya da maç bitince veri güncellenir, ve o yeni halin
diğerlerinin ekranına düşmesi için sayfayı yenilemeleri gerekiyordu. Yoklama
bunu ortadan kaldırır, OpenDota limitinden ise hiçbir şey harcamaz. Aynı
şekilde bir oyuncunun detayında "Yenile"ye basılınca kart listesi de anında
tazelenir — aynı veriyi besleyen iki ekranın farklı şeyler göstermesi
kafa karıştırıyordu.

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

## Dönem puanı (Hafta / Ay / Son 60)

Oyuncu Değerlendirme başlığının yanındaki **Hafta / Ay / Son 60** düğmeleri
kartların neyi anlattığını belirler. Seçilen pencerede her kart şunları
gösterir:

| Alan | Ne |
| --- | --- |
| **Puan** (sağ üst) | Dönem puanı, 50 nötr |
| **G / M** | Galibiyet / mağlubiyet ve yüzdesi |
| **MMR** | Dönemdeki değişim; ölçülemiyorsa `~` ile işaretli |
| **Perf. Rank** | Dönemin ortalaması (gerçek MMR değil) + önceki döneme göre değişim |
| **Maç** | Oynanan maç sayısı |
| **Hero şeridi** | Dönemde en çok oynanan 8 hero (ikonun üzerinde maç, kazanma oranı, KDA) |

**Hero şeridi de dönemden türer.** "Bu hafta ne oynadı" ile "hep ne oynar"
farklı sorular; kartın geri kalanı zaten dönemi anlatırken şerit genel kalsaydı
kart kendi içinde çelişirdi (hafta sekmesinde 2 maç yazarken şerit aylardır
oynanan hero'ları gösteriyordu).

**"Son 60" bir takvim penceresi değildir:** elde ne kadar maç varsa onun
tamamı. Önbellek oyuncu başına son **60 maçı** tuttuğu için pencere pratikte
budur ve etiket bunu açıkça yazar — "Genel" diyordu ama gösterdiği şey
oyuncunun tüm kariyeri değil, elde duran penceredir. Bu yüzden başlıkta "son N
gün" de yazmaz. Etiketteki sayı `MATCH_FETCH_SIZE` ile aynı kalmak zorunda;
bir test ikisini karşılaştırıyor.

**Kartlar puana göre sıralıdır** — "kim iyi gidiyor" sorusu listenin sırasından
okunur. Dönemde hiç maçı olmayan oyuncu sıralamaya girmez, adıyla en sona
alınır; puanı 0 olduğu için sıralansaydı hepsi en dibe yığılır ve "çok kötü
gidiyor" gibi okunurdu, oysa söylediği şey yalnızca "bu dönemde oynamadı".

> Eskiden bu sayılar ayrı bir **"Haftanın Kazananı / Kaybedeni"** bölümündeydi.
> Aynı bilgiyi iki ayrı düzende göstermek yerine kartların kendisi taşıyor; o
> bölüm ve `/api/weekly` ucu kaldırıldı.

### Puan nasıl hesaplanır

Tek bir ölçüte dayanmaz:

| Ölçüt | Ağırlık | Not |
| --- | --- | --- |
| Gerçek MMR değişimi | 34 | Ölçülemeyen maçlar maç başına ±25 sayılır |
| Galibiyet/mağlubiyet dengesi | 26 | Küçük örnekte ortalamaya çekilir (shrinkage) |
| Performance Rank değişimi | 20 | Dönemin ortalaması vs. önceki 3 dönem |
| Oynanan maç sayısı | 12 | Doğrudan bonus/ceza |

**Maç sayısı aynı zamanda çarpandır.** Başarı kısmı `maç / (maç + önsel)` ile
ağırlıklandırılır (haftada önsel 4): 1 maçta 0,20 — 10 maçta 0,71. Bu yüzden
bir maç oynayıp kazanan biri haftanın birincisi olamaz; istenen davranış budur.

**"Son 60"ta ölçek takvimden değil MAÇ SAYISINDAN kurulur.** Sonsuz pencerede
takvim çarpanı kullanılsaydı eşikler de sonsuza giderdi: güven 0'a düşer,
herkes aynı nötr puanı alırdı. Onun yerine bu sekme oranlara bakar — güven doğrudan
maç sayısından gelir, MMR eşiği "maç başına 25" üzerinden kurulur ve **hacim
bonusu yoktur** (tüm zamanlarda çok oynamış olmak bir dönem performansı değil,
kıdemdir). Performance Rank değişimi de hesaplanmaz: pencere zaten elde duran
her şeyi kapsadığı için kıyaslanacak "önceki dönem" yoktur; kart orada değişim
yerine ortalamanın neyin ortalaması olduğunu ("son 60 maç") yazar.

**Eşikler dönemle birlikte büyür.** MMR ölçeği, hacim tavanı ve güven önseli
haftaya göre kalibre edildi; ay sekmesinde 30/7 katına çıkarılır. Yapılmasaydı
tablo anlamsızlaşırdı: 12 maçlık hacim tavanı bir ayda herkesçe aşılır ve tam
ortalama oynayan biri bile "çok oynadı" diye yukarı çıkardı. Performance Rank
ölçeği **ölçeklenmez** — o bir ortalama, toplam değil.

### Çerçeve rengi

Kartın sol şeridi ve çerçevesi dönemin nasıl geçtiğini söyler: yeşil iyi,
kırmızı kötü, renksiz ortalama.

Renk **puana değil, başarı kısmına** bakar — yani G/M dengesi, MMR değişimi ve
Performance Rank değişimine. Oynanan maç sayısı renge karışmaz: bir ayda 30/30
oynayan biri tam olarak ortalamadır, ama hacim bonusu tek başına onu yukarı
taşıyıp kartını yeşil yapıyordu.

Renk tek başına taşıyıcı değildir; aynı bilgi sağ üstteki puan rozetinde
sayıyla da durur.

Hesap `packages/core/src/players/weekly-score.js` içindedir ve saftır (saat
bile dışarıdan gelir), testleri `test/weekly-score.test.js` ve
`test/period-score.test.js`.

Bölüm **hiçbir zaman kendi başına dış kaynağa gitmez**; yalnızca önbellekteki
maç verisini okur. Hafta/Ay arasında gidip gelmek de günlük limitten harcamaz —
aynı önbellek başka bir pencereyle özetlenir.

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

Beyan **okumaya herkese açıktır**: bir oyuncunun sayfasına kim bakarsa baksın
değerlendirme aynı pozisyonlarla hesaplanır. Steam girişi yalnızca *yazma*
yetkisini belirler — açılır seçici sadece kendi profilinde çıkar.

## Hero tavsiye kataloğu (üretilmiş veri)

`packages/core/src/data/hero-overrides.js` her hero için tek bir kayıt tutar:
radar ekseni değerleri, pozisyonlar, counter hero/item listeleri ve
gerekli/durumsal item planı. Hem canlı maç motoru hem "Tavsiyeleri yönet"
ekranı **aynı** kaydı okur — iki taraf ayrı yerden okusaydı ekranda görünen
liste ile motorun kullandığı liste birbirinden kayardı.

Dosya **elle düzenlenmez**, üretilir:

```bash
node scripts/build-hero-overrides.mjs [dotabaff-dizini]
```

Kaynaklar, öncelik sırasıyla:

| # | Kaynak | Ne verir |
| --- | --- | --- |
| 1 | dotabaff `hero-overrides.json` | roleValues, pozisyonlar, counter listeleri |
| 1 | dotabaff `ti2026-pro-items.json` | TI 2026 ana etkinliğinden gerçek item kullanımı |
| 2 | bu depodaki `hero-profiles.js` | mevcut kurgu (tags, counters, coreItems) |
| 3 | OpenDota `heroes.json` rol etiketleri | yalnızca ilk ikisi de susuyorsa |
| 4 | OpenDota `itemPopularity` | item planı zayıf kalan hero'lar için |

**Neden gerekliydi:** `hero-profiles.js` 99 hero taşıyor, oyunda ise 127 var.
Eksik 28 hero (Lina, Pudge, Shadow Fiend, Rubick, Templar Assassin…) canlı
maçta hiç tavsiye almıyor ve takım analizinde **hiç sayılmıyordu** — yani radar
beş kişilik bir takımı üç kişi üzerinden ölçüyordu.

Üretici dışarıdaki bir projeye ve ağa bağlı, ama uygulamanın çalışması bağlı
değil: çıktı dosyası depoya commit'lenir.

> Üreticinin iki küçük ama önemli işi var. dotabaff'ta **hiç düzenlenmemiş** 13
> hero'nun kaydı sabit bir "hepsi düşük" kalıbı taşıyor; bu "zayıf hero" değil
> "veri yok" demek, olduğu gibi alınsaydı o hero'lar radarı aşağı çekerdi.
> İkincisi, OpenDota'nın ham alım sayımı Kaya, Yasha ve Kaya and Sange'yi
> üçünü birden içeriyor; aynı listede üst sürümü bulunan item'lar atılır, yoksa
> altı yuvanın yarısı tek bir item'ın yolunu anlatırdı.

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

### Başarısız tazeleme veriyi SİLMEZ

Kaynak hata verebilir ya da "başarılı" cevap verip **boş liste** dönebilir
(günlük limit, geçici indeksleme sorunu). Bu durumda ekranda duran veri
korunur; tazeleme yalnızca *yeni* veri getirmemiş olur.

Bu bir kez kaybedildi: "Yenile"ye basmak dolu bir paneli **"9 oyuncu verisi
bekleniyor"**a düşürüyordu, çünkü bayat kopya yalnızca tazeleme
*istenmediğinde* okunuyordu. Aynı hata profil ucunda madalyayı da siliyordu —
madalya gidince **yaklaşık MMR** de gidiyordu.

- Maç listesi, madalya ve kariyer hero listesi ayrı ayrı korunur
- Bayat kopyanın `fetchedAt`i korunur; boş sonuç "az önce güncellendi" yazmaz
- Panel başlığında "N oyuncunun verisi tazelenemedi" yazar — bu **"veri yok"
  değildir**, ekrandaki sayılar geçerli, yalnızca eski
- Sözleşme [stale-preservation.test.js](packages/core/test/stale-preservation.test.js)
  ile sabitlendi

### Yerelde önbellek nerede durur

`netlify dev` Blobs'u taklit eden bir sunucu çalıştırır ama o sunucu veriyi
**yalnızca bellekte** tutar (`.netlify/blobs-serve` boş kalır). Dev sunucusu
her yeniden başladığında kadronun tüm önbelleği uçuyordu ve dokuz oyuncu
OpenDota'dan baştan çekiliyordu.

Bu yüzden **yerelde** her yazma `%TEMP%dotastat-dev-store` altına da
aynalanır; Blobs boş dönerse diskteki kopya okunur. Production'da bu kod yolu
hiç çalışmaz (orada Blobs zaten kalıcıdır). Durum `/api/debug` içinde
`mirroringToDisk` alanında görünür.

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
- Kayıt bir kez oluştuktan sonra **herkes görebilir**: değer zaten oyuncunun
  kendi hesabına yazılmıştır (anahtar oturum çerezinden gelir), okumak için
  aynı kişi olmak gerekmez. Kimlik doğrulaması yazma tarafında durur.

### Sınırlar

- Kurulumdan **sonra** oynanan maçlar için birikir; geçmiş maçlarda boş kalır
- Üçlü (Overwolf + MMR uygulaması + DotaStat) maç sırasında açık olmalı
- Eşleştirme zamana bakar: okuma, bitişi EN YAKIN olan maça yazılır. Maç
  bitişi `startedAt + durationSeconds` ile hesaplandığı için gerçek bitişten
  1–3 dakika sonraya düşer; bu yüzden okumanın bitişten biraz önce gelmesine
  izin verilir (15 dk pay). Pay olmadan her değer bir önceki maça kayıyordu
  ve kayıp maçlar pozitif MMR alıyordu.
- 3 saati aşan boşluklarda hangi maça ait olduğu bilinemez, hücre boş kalır.
  **Sütunun kendisi her zaman durur**: kayıt yoksa hücrede "—" yazar. Eskiden
  kayıt olmayınca sütun tamamen gizleniyordu ve tablo oyuncudan oyuncuya sütun
  değiştiriyordu — "MMR nereye gitti" sorusu bundandı
- **Maç bitince liste kendiliğinden tazelenir.** GSI bitişi bildirir, uygulama
  o maç kimliğiyle veri çeker. Kaynak maçı vermiyorsa sonrakine geçilir
  (ölçüldü: Stratz maçı dakikalar içinde verirken OpenDota'da 29 saat sonra
  bile yoktu — üstelik OpenDota limitte de değildi, sadece indekslememişti).
- **Elle yenilemede** yeni biten maç hemen görünmeyebilir; OpenDota maçları kendi programına
  göre alıyor; ölçüldü, bir maç bittikten 29 saat sonra bile listede
  olmayabiliyor. "Yenile" artık OpenDota'ya tarama isteği de gönderiyor ama
  sonuç aynı istekte gelmez — birkaç dakika sonra tekrar yenilemek gerekir.
  MMR değeri bundan bağımsız gelir (kendi kaynağından okunur), bu yüzden
  madalyanın yanı güncellenirken maç listesi bir süre geride kalabilir
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

#### Kurulumu olmayan oyuncular: yaklaşık MMR

Kurulumu yapmamış oyuncuda okunacak bir değer yok; elimizde yalnızca
sağlayıcının verdiği **madalya** var. Bu durumda madalya bandının **ortası**
alınıp yaklaşık bir MMR üretilir ve `~` ile "yaklaşık" etiketiyle gösterilir.

Üretilen değer ölçülen değerle **aynı ölçektedir**: geri çevrildiğinde aynı
madalya ve yıldız çıkar (Legend 4 → ~3619 → Legend 4, kalan 77). Böylece
haftalık tabloda kurulumu olan ve olmayan oyuncular yan yana kıyaslanabilir.
Ölçülen değer her zaman tahminin önüne geçer.
