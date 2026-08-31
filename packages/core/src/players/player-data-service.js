/**
 * Oyuncu verisi servisi (OpenDota + degistirilebilir onbellek).
 *
 * Depolama ENJEKTE EDILIR. Ayni servis:
 *   - Netlify Functions'ta Netlify Blobs ile,
 *   - Electron'da disk (JSON dosyasi) ile
 * calisir. Boylece "ne zaman ag istegi yapilir, ne zaman onbellek okunur"
 * karari tek yerde durur.
 *
 * Depolama sozlesmesi:
 *   get(key)                        -> Promise<any|null>   (suresi dolmussa null)
 *   set(key, value, { ttlMs })      -> Promise<void>
 */

import { createOpenDotaClient } from "../providers/opendota.js";
import { createProviderChain } from "../providers/provider-chain.js";
import { createStratzClient } from "../providers/stratz.js";
import { resolveRankTier } from "./player-types.js";
import { listRoster } from "./roster.js";
import { buildPlayerEvaluation, toRosterCard } from "./evaluation.js";

/** Mac gecmisi onbellek suresi. */
export const MATCH_TTL_MS = 6 * 60 * 60 * 1000;
/** Profil + rank madalyasi onbellek suresi. */
export const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Tum zamanlarin hero istatistigi onbellek suresi.
 *
 * Uzun tutulur: bir gunde oynanan 5-10 mac, yuzlerce maclik kariyer
 * ortalamasini kayda deger olcude degistirmez. Bu ayni zamanda gunluk istek
 * butcesini korur.
 */
export const HERO_PERFORMANCE_TTL_MS = 24 * 60 * 60 * 1000;
/** Tek istekte cekilen mac sayisi (hero havuzu istatistigi de bundan turer). */
export const MATCH_FETCH_SIZE = 60;

/**
 * Onbellekteki mac kaydinin sema surumu.
 *
 * 2: ward alanlari eksik veride `null` tasiyor. Surum 1 kayitlarinda ayni
 *    alanlar 0 yaziyordu ve degerlendirme motoru bunu "hic ward dikmemis"
 *    diye okuyup her support macini cezalandiriyordu.
 *
 * Otomatik tazeleme kaldirildigi icin eski kayitlar kendiliginden
 * yenilenmez; bu yuzden okurken duzeltiyoruz (bkz. migrateCachedMatches).
 */
const MATCH_SCHEMA = 2;

/**
 * Sonuc donmeyen (veya hata veren) bir cekme denemesinden sonra ne kadar
 * beklenecegi. Profili gizli ya da hic maci olmayan oyuncular icin gecerli;
 * bu isaret olmadan boyle bir oyuncu her sayfa acilisinda istek harcardi.
 * "Yenile" bu bekleyisi yok sayar.
 */
export const EMPTY_RESULT_RETRY_MS = 6 * 60 * 60 * 1000;

/**
 * Iki ACIK tazeleme arasindaki en kisa sure.
 *
 * Onbellek TUM ziyaretciler arasinda paylasildigi icin tazeleme kisisel degil
 * ORTAK bir eylemdir: biri iki dakika once tazelediyse, ikinci kisinin
 * tazelemesi ayni veriyi bir kez daha cekmekten baska bir sey yapmaz.
 *
 * Bu yuzden sinir kisi basina sayac degil, VERININ YASI uzerinden isler.
 * Ekstra bir depo gerekmez — onbellek zaten ne zaman doldugunu biliyor.
 */
export const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * "Mac gecmisi gizli" isaretinin yeniden sorulma araligi.
 *
 * `fh_unavailable` KALICI BIR OZELLIK DEGILDIR: oyuncu Dota'dan "Maç
 * Verilerini Herkese Açık Yap"i her an acabilir ve bunu ogrenmenin tek yolu
 * profili yeniden sormaktir. Isaret kalici sayildigi surece oyuncu ekranda
 * sonsuza kadar "maç geçmişi gizli" olarak kaliyordu — ayari acmis olsa bile.
 *
 * Bu yuzden isaret ELLE tazelemede yeniden sorulur, ama profil verisi bu
 * sureden eskiyse. Otomatik doldurma kuyruguna girmezler; oradaki amac her
 * sayfa acilisinda kota harcamamak.
 */
export const HISTORY_RECHECK_MS = 30 * 60 * 1000;

/**
 * Kadrodaki EN TAZE verinin zamani.
 *
 * Panelde tek bir "son güncelleme" yazisi gosteriliyor; oyuncular ayri
 * zamanlarda dolduğu icin en yenisi referans alinir.
 *
 * @param {Array<{ fetchedAt?: string }>} cards
 * @returns {string} ISO tarih; hic veri yoksa bos dize
 */
function newestFetchedAt(cards) {
  let newest = 0;
  for (const card of cards) {
    const at = new Date(card?.fetchedAt || 0).getTime();
    if (Number.isFinite(at) && at > newest) {
      newest = at;
    }
  }
  return newest ? new Date(newest).toISOString() : "";
}

/**
 * Panelde yeni tazelemeye ne kadar kaldi.
 *
 * Kadroda tazelenebilecek TEK BIR oyuncu bile varsa bekleme yoktur; hepsi
 * cok taze ise en yeni verinin bekleme suresi doner.
 *
 * @param {Array<{ fetchedAt?: string }>} cards
 * @returns {number} milisaniye
 */
function dashboardRefreshWait(cards) {
  let shortest = Infinity;
  for (const card of cards) {
    const gate = refreshWindow(card?.fetchedAt || "");
    if (gate.allowed) {
      return 0;
    }
    shortest = Math.min(shortest, gate.availableInMs);
  }
  return Number.isFinite(shortest) ? shortest : 0;
}

/**
 * Bu veri simdi tazelenebilir mi?
 *
 * @param {string} fetchedAt ISO tarih; bos ise veri hic cekilmemis demektir
 * @param {number} [minIntervalMs]
 * @returns {{ allowed: boolean, ageMs: number, availableInMs: number }}
 */
export function refreshWindow(
  fetchedAt,
  minIntervalMs = MIN_REFRESH_INTERVAL_MS,
) {
  const at = new Date(fetchedAt || 0).getTime();
  if (!Number.isFinite(at) || at <= 0) {
    // Hic veri yoksa tazelemeyi engellemenin anlami yok.
    return { allowed: true, ageMs: Infinity, availableInMs: 0 };
  }
  const ageMs = Date.now() - at;
  return {
    allowed: ageMs >= minIntervalMs,
    ageMs,
    availableInMs: Math.max(0, minIntervalMs - ageMs),
  };
}

/**
 * Eski sema ile yazilmis mac kayitlarini bugunku sozlesmeye tasir.
 *
 * @param {import("./player-types.js").PlayerMatch[]} matches
 * @param {number} schema Kayitla birlikte saklanan sema surumu (yoksa 1)
 * @returns {import("./player-types.js").PlayerMatch[]}
 */
function migrateCachedMatches(matches, schema) {
  const rows = Array.isArray(matches) ? matches : [];
  if (Number(schema) >= MATCH_SCHEMA) {
    return rows;
  }
  return rows.map((row) => {
    // Yalnizca ward/kamp alanlarina dokunuruz ve yalnizca 0 iken. OpenDota bu
    // alanlari zaten hicbir zaman dondurmedigi icin surum 1'deki 0 degeri
    // "olculmus sifir" degil, "veri yok" demektir.
    if (row?.obsPlaced !== 0 && row?.senPlaced !== 0) {
      return row;
    }
    return {
      ...row,
      obsPlaced: row.obsPlaced === 0 ? null : row.obsPlaced,
      senPlaced: row.senPlaced === 0 ? null : row.senPlaced,
      campsStacked: row.campsStacked === 0 ? null : row.campsStacked,
    };
  });
}
/** Panel isteginde en fazla kac oyuncu icin taze veri cekilir. */
const MAX_REFRESH_PER_REQUEST = 4;

/**
 * @param {Object} options
 * @param {{ get: Function, set: Function }} options.storage
 * @param {string} [options.apiKey] OpenDota API anahtari (opsiyonel)
 * @param {string} [options.stratzApiKey] Stratz anahtari; verilmezse yedek kaynak devre disi
 * @param {number} [options.maxRefreshPerRequest]
 */
export function createPlayerDataService(options) {
  const storage = options?.storage;
  if (!storage?.get || !storage?.set) {
    throw new Error("player-data-service: storage.get/set zorunlu");
  }

  const timeoutMs = Number(options.timeoutMs) || 8000;

  // OpenDota birincil kaynaktir (anahtarsiz da calisir). Gunluk limite
  // takildiginda ayni sozlesmeyi uygulayan Stratz devreye girer; Stratz
  // anahtari yoksa zincir onu sessizce atlar.
  const client = createProviderChain([
    createOpenDotaClient({ apiKey: options.apiKey || "", timeoutMs }),
    createStratzClient({ apiKey: options.stratzApiKey || "", timeoutMs }),
  ]);

  const maxRefresh =
    Number(options.maxRefreshPerRequest) || MAX_REFRESH_PER_REQUEST;

  /**
   * Onbellekten mac listesi; yoksa/eskimisse OpenDota'dan ceker.
   *
   * Iki kopya tutulur: TTL'li taze kayit ve suresiz "bayat" kopya. Ikincisi
   * OpenDota erisilemedigi anlarda ekranin bos kalmamasini saglar.
   *
   * @param {import("./player-types.js").Player} player
   * @param {{ refresh?: boolean, allowFetch?: boolean }} [matchOptions]
   */
  async function getPlayerMatches(player, matchOptions = {}) {
    const key = "matches:" + player.player_id;
    const staleKey = key + ":stale";

    const cached = matchOptions.refresh ? null : await storage.get(key);
    if (cached?.matches?.length) {
      return {
        matches: migrateCachedMatches(cached.matches, cached.schema),
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        stale: false,
        error: "",
      };
    }

    // TTL dolmus ama elde veri var: OTOMATIK YENILEMIYORUZ.
    //
    // Onceden burada ag istegi atiliyordu; panel her acildiginda (ve 3 dakikada
    // bir otomatik yoklamada) OpenDota'ya gidiliyordu. Artik eski veri oldugu
    // gibi gosterilir, tazeleme kararini kullanici "Yenile" ile verir.
    if (!matchOptions.refresh) {
      const stale = await storage.get(staleKey);
      if (stale?.matches?.length) {
        return {
          matches: migrateCachedMatches(stale.matches, stale.schema),
          fetchedAt: stale.fetchedAt || "",
          fromCache: true,
          stale: true,
          error: "",
        };
      }
    }

    // Verisi HIC olmayan oyuncu icin son deneme yakin zamandaysa tekrar
    // denemeyiz. Aksi halde profili gizli / hic maci olmayan bir oyuncu her
    // sayfa acilisinda bir istek harcar ve gunluk limit bosa gider.
    if (!matchOptions.refresh && (await storage.get(key + ":attempted"))) {
      return {
        matches: [],
        fetchedAt: "",
        fromCache: true,
        stale: false,
        error: "",
      };
    }

    // Buraya yalnizca iki durumda gelinir: elde hic veri yok (ilk acilis) ya
    // da kullanici acikca tazeleme istedi.
    if (matchOptions.allowFetch === false) {
      const stale = await storage.get(staleKey);
      return {
        matches: migrateCachedMatches(stale?.matches || [], stale?.schema),
        fetchedAt: stale?.fetchedAt || "",
        fromCache: true,
        stale: Boolean(stale?.matches?.length),
        error: "",
      };
    }

    // Acik tazelemede once KAYNAGI TETIKLE: OpenDota yeni maclari kendi
    // programina gore aliyor ve bir mac bittikten sonra saatlerce gorunmeyebi-
    // liyor. Bu istek bir tarama isi kuyruga atar. Sonucu beklemeyiz — mac bu
    // cagrida degil, birkac dakika sonrakinde gorunur.
    if (matchOptions.refresh && typeof client.requestRefresh === "function") {
      await client.requestRefresh(player.player_id);
    }

    try {
      // `expectMatchId` verildiginde (canli mac yeni bitti) sonuc dogrulanir:
      // OpenDota o maci henuz almadiysa HATA VERMEDEN eksik doner, bu yuzden
      // zincir Stratz'a gecer. Olculdu: Stratz maci dakikalar icinde
      // gosterirken OpenDota'da 29 saat sonra bile yoktu.
      const wanted = String(matchOptions.expectMatchId || "");
      let matches;

      if (wanted && typeof client.getRecentMatchesExpecting === "function") {
        // Belirli bir mac araniyor (GSI bitis bildirdi).
        matches = await client.getRecentMatchesExpecting(player.player_id, {
          limit: MATCH_FETCH_SIZE,
          expectMatchId: wanted,
        });
      } else if (
        matchOptions.refresh &&
        typeof client.getRecentMatchesFreshest === "function"
      ) {
        // Elle tazeleme: hangi macin aranacagi bilinmiyor, bu yuzden tum
        // kaynaklar sorulup EN TAZE liste alinir. Sira korunsaydi OpenDota
        // "basarili ama eski" cevabiyla yeni maci gizlerdi.
        matches = await client.getRecentMatchesFreshest(player.player_id, {
          limit: MATCH_FETCH_SIZE,
        });
      } else {
        // Normal acilis: tek kaynak yeter, ekstra istek harcanmaz.
        matches = await client.getRecentMatches(player.player_id, {
          limit: MATCH_FETCH_SIZE,
        });
      }
      const fetchedAt = new Date().toISOString();
      if (matches.length) {
        const row = { matches, fetchedAt, schema: MATCH_SCHEMA };
        await Promise.all([
          storage.set(key, row, { ttlMs: MATCH_TTL_MS }),
          storage.set(staleKey, row),
        ]);
        return {
          matches,
          fetchedAt,
          fromCache: false,
          stale: false,
          error: "",
        };
      }

      // BOS SONUC — hata degil ama veri de yok.
      //
      // Kaynak "basarili" cevap verip bos liste dondurebiliyor (gunluk limit,
      // gecici indeksleme sorunu, tarama kuyrugu). Onceden bu bos liste OLDUGU
      // GIBI donuyordu: elle "Yenile"ye basan biri, ekranindaki dolu veriyi
      // silip "veri bekleniyor"a dusuruyordu. Eski kopya duruyor olmasina
      // ragmen okunmuyordu, cunku bayat kopya yalnizca tazeleme ISTENMEDIGINDE
      // ve `catch` icinde okunuyordu.
      //
      // Artik elde ne varsa korunur; tazeleme yalnizca YENI veri getirmemis
      // olur. Bayat kopyanin `fetchedAt`i da korunur — aksi halde arayuz
      // bos veriyi "az once guncellendi" diye gosterip tazelemeyi kilitliyordu.
      await storage.set(
        key + ":attempted",
        { at: fetchedAt },
        { ttlMs: EMPTY_RESULT_RETRY_MS },
      );
      const kept = await storage.get(staleKey);
      if (kept?.matches?.length) {
        return {
          matches: migrateCachedMatches(kept.matches, kept.schema),
          fetchedAt: kept.fetchedAt || "",
          fromCache: true,
          stale: true,
          error: "tazelenemedi-bos-sonuc",
        };
      }
      return { matches, fetchedAt, fromCache: false, stale: false, error: "" };
    } catch (error) {
      // Hata durumunda da isaretlenir; erisilemez bir kaynagi her acilista
      // yeniden zorlamanin faydasi yok.
      await storage.set(
        key + ":attempted",
        { at: new Date().toISOString(), error: String(error?.message || "") },
        { ttlMs: EMPTY_RESULT_RETRY_MS },
      );
      const stale = await storage.get(staleKey);
      return {
        matches: migrateCachedMatches(stale?.matches || [], stale?.schema),
        fetchedAt: stale?.fetchedAt || "",
        fromCache: true,
        stale: Boolean(stale?.matches?.length),
        error: String(error?.message || "opendota-hatasi"),
      };
    }
  }

  /**
   * Profil + rank madalyasi (uzun TTL).
   * @param {import("./player-types.js").Player} player
   * @param {{ refresh?: boolean, allowFetch?: boolean }} [profileOptions]
   */
  async function getPlayerProfile(player, profileOptions = {}) {
    const key = "profile:" + player.player_id;
    const staleKey = key + ":stale";

    const cached = profileOptions.refresh ? null : await storage.get(key);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    // Maclarla ayni politika: TTL dolmus olsa da elde profil varsa ag istegi
    // atilmaz. Avatar ve rank madalyasi kendiliginden yenilenmez.
    if (!profileOptions.refresh) {
      const stale = await storage.get(staleKey);
      if (stale) {
        return { ...stale, fromCache: true, stale: true };
      }
    }

    if (profileOptions.allowFetch === false) {
      const stale = await storage.get(staleKey);
      return stale ? { ...stale, fromCache: true, stale: true } : null;
    }

    try {
      const snapshot = await client.getPlayerProfile(player.player_id);
      if (!snapshot) {
        // Cevap geldi ama profil yok: elde bir kopya varsa ONU koru.
        // Bu deger madalyayi tasiyor; madalya kaybolunca YAKLASIK MMR de
        // kayboluyor (bkz. resolveRankProgress) — yani tek bir basarisiz
        // tazeleme tum kadronun rank gosterimini siliyordu.
        const stale = await storage.get(staleKey);
        return stale ? { ...stale, fromCache: true, stale: true } : null;
      }
      const row = {
        name: snapshot.name,
        avatar: snapshot.avatar,
        steamId: snapshot.steamId,
        rank: resolveRankTier(snapshot.rankTier, {
          leaderboardRank: snapshot.leaderboardRank,
          provider: snapshot.provider,
          fetchedAt: snapshot.fetchedAt,
        }),
        historyUnavailable: Boolean(snapshot.historyUnavailable),
        fetchedAt: snapshot.fetchedAt,
      };
      await Promise.all([
        storage.set(key, row, { ttlMs: PROFILE_TTL_MS }),
        storage.set(staleKey, row),
      ]);
      return { ...row, fromCache: false };
    } catch {
      // Ag hatasi da madalyayi silmemeli.
      const stale = await storage.get(staleKey);
      return stale ? { ...stale, fromCache: true, stale: true } : null;
    }
  }

  /**
   * TUM zamanlarin hero istatistigi (imza kahraman ve zayif hero secimi icin).
   *
   * Maclardan ayri onbelleklenir; TTL cok daha uzundur cunku kariyer
   * ortalamasi gunluk oynanan birkac macla anlamli olcude degismez.
   *
   * @param {import("./player-types.js").Player} player
   * @param {{ refresh?: boolean, allowFetch?: boolean }} [heroOptions]
   */
  async function getHeroPerformance(player, heroOptions = {}) {
    const key = "heroes:" + player.player_id;
    const staleKey = key + ":stale";

    const cached = heroOptions.refresh ? null : await storage.get(key);
    if (cached?.heroes?.length) {
      return { heroes: cached.heroes, fetchedAt: cached.fetchedAt, error: "" };
    }

    // Maclarla ayni politika: eski veri varsa kendiliginden yenilenmez.
    if (!heroOptions.refresh) {
      const stale = await storage.get(staleKey);
      if (stale?.heroes?.length) {
        return {
          heroes: stale.heroes,
          fetchedAt: stale.fetchedAt || "",
          error: "",
        };
      }
    }

    if (heroOptions.allowFetch === false) {
      const stale = await storage.get(staleKey);
      return {
        heroes: stale?.heroes || [],
        fetchedAt: stale?.fetchedAt || "",
        error: "",
      };
    }

    try {
      const heroes = await client.getHeroPerformance(player.player_id);
      const fetchedAt = new Date().toISOString();
      if (heroes.length) {
        await Promise.all([
          storage.set(
            key,
            { heroes, fetchedAt },
            { ttlMs: HERO_PERFORMANCE_TTL_MS },
          ),
          storage.set(staleKey, { heroes, fetchedAt }),
        ]);
        return { heroes, fetchedAt, error: "" };
      }

      // Maclarla ayni kural: bos sonuc, elde duran listeyi silmez.
      const kept = await storage.get(staleKey);
      return {
        heroes: kept?.heroes || [],
        fetchedAt: kept?.fetchedAt || fetchedAt,
        error: kept?.heroes?.length ? "tazelenemedi-bos-sonuc" : "",
      };
    } catch (error) {
      // Bu uc olmadan da ekran calisir: hero havuzu son maclardan turetilir.
      const stale = await storage.get(staleKey);
      return {
        heroes: stale?.heroes || [],
        fetchedAt: stale?.fetchedAt || "",
        error: String(error?.message || "hero-istatistigi-alinamadi"),
      };
    }
  }

  /**
   * Tek oyuncu icin tam degerlendirme paketi.
   * @param {import("./player-types.js").Player} player
   * @param {{ refresh?: boolean, allowFetch?: boolean, forcedRoles?: Record<string, string> }} [bundleOptions]
   */
  async function getPlayerBundle(player, bundleOptions = {}) {
    // ACIK tazeleme istegi geldiyse once verinin yasina bakilir. Onbellek
    // paylasildigi icin cok yeni veriyi yeniden cekmek kimseye bir sey
    // kazandirmaz, yalnizca gunluk kotayi harcar.
    // Bekleme durumu HER ISTEKTE hesaplanir, yalnizca tazeleme istendiginde
    // degil. Aksi halde normal acilista arayuz bekleme suresini bilmiyor,
    // butonu acik gosteriyor ve kullanici basinca istek sessizce atlaniyordu.
    let refreshGate;
    {
      const cached = await storage.get(
        "matches:" + player.player_id + ":stale",
      );
      const wanted = String(bundleOptions.expectMatchId || "");
      const alreadyCached =
        Boolean(wanted) &&
        (cached?.matches || []).some((row) => String(row?.matchId) === wanted);

      // BEKLEME ATLANIR: belirli bir mac araniyorsa ve onbellekte yoksa yeni
      // veri oldugunu KESIN biliyoruz (mac kimligi GSI'dan geldi). Bekleme
      // kurali gereksiz cekimleri onlemek icin var, gerekli olani degil —
      // aksi halde mac bitiminde tetiklenen otomatik tazeleme, az once elle
      // yenilenmis olmasi yuzunden engelleniyordu.
      refreshGate =
        wanted && !alreadyCached
          ? { allowed: true, ageMs: Infinity, availableInMs: 0 }
          : refreshWindow(cached?.fetchedAt || "");
    }

    const effectiveOptions = refreshGate.allowed
      ? bundleOptions
      : { ...bundleOptions, refresh: false };

    // Profil ONCE okunur: "Expose Public Match Data" kapali bir oyuncuda mac
    // ve hero uclarina gitmenin anlami yok, ikisi de her zaman bos doner.
    // Boyle bir oyuncu icin istek harcamiyoruz.
    const profile = await getPlayerProfile(player, effectiveOptions);
    const historyBlocked = Boolean(profile?.historyUnavailable);

    const dataOptions = historyBlocked
      ? { ...effectiveOptions, allowFetch: false }
      : effectiveOptions;

    const [matchResult, heroResult] = await Promise.all([
      getPlayerMatches(player, dataOptions),
      getHeroPerformance(player, dataOptions),
    ]);

    // Canli profil verisi (avatar, rank madalyasi) tohum profilin uzerine yazilir.
    const merged = {
      ...player,
      avatar: profile?.avatar || player.avatar,
      rank: profile?.rank || player.rank,
    };

    return {
      ...buildPlayerEvaluation({
        player: merged,
        matches: matchResult.matches,
        heroPerformance: heroResult.heroes,
        forcedRoles: bundleOptions.forcedRoles || {},
      }),
      fetchedAt: matchResult.fetchedAt,
      fromCache: matchResult.fromCache,
      providerError: matchResult.error,
      heroPerformanceError: heroResult.error,
      /**
       * Gosterilen mac verisi bayat kopyadan geliyor: ya TTL doldu ve
       * kendiliginden yenilenmedi, ya da tazeleme denendi fakat yeni veri
       * getirmedi. Arayuz bunu "veri yok" ile karistirmamali — ekranda
       * duran sayilar gecerli, sadece eski.
       */
      stale: Boolean(matchResult.stale),
      /**
       * Oyuncu Dota'da mac verisini gizlemis. Rank ve profil gorunur ama mac
       * listesi hicbir kaynaktan gelmez; arayuz bunu "veri bekleniyor" yerine
       * acik bir aciklama olarak gostermeli.
       */
      historyUnavailable: historyBlocked,
      /**
       * Profilin (ve dolayisiyla `historyUnavailable` isaretinin) yasi.
       * Panel, gizli gorunen oyuncuyu ne zaman yeniden soracagina buna
       * bakarak karar verir.
       */
      profileFetchedAt: profile?.fetchedAt || "",
      /**
       * Tazeleme istendi ama veri henuz cok taze oldugu icin atlandi mi?
       * Arayuz butonu buna gore kapatip "son guncelleme: 2 dk once" yazar.
       */
      refreshSkipped: Boolean(bundleOptions.refresh) && !refreshGate.allowed,
      /** Yeni tazelemeye ne kadar kaldi (ms). */
      refreshAvailableInMs: refreshGate.availableInMs,
      // Onbellekten servis edildiginde bu istekte hicbir saglayici cagrilmaz,
      // dolayisiyla `lastUsedProvider` bos kalir. O durumda veriyi kimin
      // urettigi mac satirlarinin kendisinde yazar.
      provider:
        client.lastUsedProvider ||
        String(matchResult.matches?.[0]?.provider || ""),
    };
  }

  /**
   * Ana ekrandaki oyuncu kartlari.
   *
   * AG ISTEGI POLITIKASI: yalnizca iki durumda dis kaynaga gidilir.
   *   1. Oyuncunun elde HIC verisi yok (ilk acilis)
   *   2. Kullanici acikca "Yenile" dedi (`refresh: true`)
   *
   * Eskiden TTL'i dolan herkes arka planda tazeleniyordu; panel her
   * acildiginda ve 3 dakikalik otomatik yoklamada OpenDota'ya gidiliyordu.
   * Artik eskimis veri oldugu gibi gosterilir, tazeleme karari kullanicinin.
   *
   * @param {{ refresh?: boolean }} [dashboardOptions]
   */
  async function getRosterDashboard(dashboardOptions = {}) {
    const roster = listRoster();

    const cachedBundles = await Promise.all(
      roster.map(async (player) => ({
        player,
        bundle: await getPlayerBundle(player, { allowFetch: false }),
      })),
    );

    // Yalnizca verisi HIC olmayanlar kuyruga girer. Eskimislik tek basina
    // yeniden cekme sebebi degildir.
    //
    // Kuyruktan DUSENLER:
    //   - mac verisini gizlemis oyuncular (beklemekle gelmeyecek)
    //   - yakin zamanda denenip bos donenler (`:attempted` isareti)
    //
    // Bu eleme olmadan kuyruk hep ayni ilk `maxRefresh` oyuncuda takiliyordu:
    // onlar veri kazanmadigi icin listeden hic cikmiyor, siradaki oyunculara
    // ise hicbir zaman sira gelmiyordu.
    const candidates = await Promise.all(
      cachedBundles.map(async (row) => {
        if (row.bundle.matches.length || row.bundle.historyUnavailable) {
          return null;
        }
        const attempted = await storage.get(
          "matches:" + row.player.player_id + ":attempted",
        );
        return attempted ? null : row;
      }),
    );
    const missing = candidates.filter(Boolean);

    // Acik tazelemede verisi COK TAZE olanlar atlanir. Onbellek paylasildigi
    // icin biri az once tazelediyse ikinci kisinin istegi ayni veriyi bir kez
    // daha cekmekten baska bir sey yapmaz.
    //
    // Mac verisini gizleyen oyuncular bu hesaba KATILMAZ: onlarin `fetchedAt`i
    // hicbir zaman dolmayacagi icin "tazelenebilir" gorunup butonu surekli
    // acik tutuyorlardi.
    const refreshable = cachedBundles.filter(
      (row) => !row.bundle.historyUnavailable,
    );
    const stale = dashboardOptions.refresh
      ? refreshable.filter(
          (row) => refreshWindow(row.bundle.fetchedAt || "").allowed,
        )
      : [];

    // GIZLI GORUNEN OYUNCULAR ELLE TAZELEMEDE YENIDEN SORULUR.
    //
    // Onceden hicbir yoldan sorulmuyorlardi: otomatik kuyruktan da, elle
    // tazelemeden de eleniyorlardi. Sonuc: oyuncu Dota'da "Maç Verilerini
    // Herkese Açık Yap"i actiginda site bunu HIC ogrenemiyor, kart sonsuza
    // kadar "maç geçmişi gizli" kaliyordu (olculdu: OpenDota
    // `fh_unavailable: false` ve 20 mac donerken bizim kart hala gizli
    // diyordu). Tek cikis yolu o oyuncunun detay panelini acip oradan
    // "Yenile" demekti — kimsenin bilemeyecegi bir hareket.
    //
    // Profil yasina gore kisiliyoruz ki arka arkaya tiklamak kota harcamasin.
    const blocked = dashboardOptions.refresh
      ? cachedBundles.filter(
          (row) =>
            row.bundle.historyUnavailable &&
            refreshWindow(row.bundle.profileFetchedAt || "", HISTORY_RECHECK_MS)
              .allowed,
        )
      : [];

    const toRefresh = dashboardOptions.refresh
      ? // Gizli olanlar ONCE: sayilari az ve yalnizca 30 dakikada bir sorulur,
        // yoksa kalabalik kadroda hic siraya giremezlerdi.
        [...blocked, ...stale].slice(0, maxRefresh)
      : missing.slice(0, maxRefresh);

    const refreshed = new Map();
    // Kuyruga girmek ag istegi atildigi anlamina GELMEZ: negatif isaret
    // (`:attempted`) yuzunden istek atlanmis olabilir. Bu yuzden gercekten
    // saglayiciya gidilenleri ayrica sayiyoruz.
    let fetchedCount = 0;
    await Promise.all(
      toRefresh.map(async (row) => {
        const bundle = await getPlayerBundle(row.player, {
          refresh: Boolean(dashboardOptions.refresh),
        });
        if (!bundle.fromCache) {
          fetchedCount += 1;
        }
        refreshed.set(row.player.id, bundle);
      }),
    );

    const cards = cachedBundles.map((row) => {
      const bundle = refreshed.get(row.player.id) || row.bundle;
      return {
        ...toRosterCard(bundle),
        fetchedAt: bundle.fetchedAt,
        hasData: bundle.matches.length > 0,
        historyUnavailable: Boolean(bundle.historyUnavailable),
        stale: Boolean(bundle.stale),
      };
    });

    return {
      cards,
      // "Bekleyen" = verisi henuz gelmemis olanlar. Mac verisini gizleyen
      // oyuncular buraya girmez; onlarinki beklemekle gelmeyecek.
      pendingPlayers: cards
        .filter((row) => !row.hasData && !row.historyUnavailable)
        .map((row) => row.id),
      hiddenPlayers: cards
        .filter((row) => row.historyUnavailable)
        .map((row) => row.id),
      /**
       * Verisi duran ama tazelenemeyen oyuncular. "Bekleyen" DEGILLER —
       * ekranda gecerli (yalnizca eski) veri var. Arayuz ikisini ayri
       * gostermeli, aksi halde dolu bir ekran "veri bekleniyor" gibi okunur.
       */
      stalePlayers: cards
        .filter((row) => row.hasData && row.stale)
        .map((row) => row.id),
      /** Bu istekte GERCEKTEN saglayiciya gidilen oyuncu sayisi. */
      refreshedCount: fetchedCount,
      /**
       * Kadrodaki en taze verinin zamani ve yeni tazelemeye kalan sure.
       * Arayuz "son güncelleme: 2 dk önce" yazip butonu buna gore kapatir.
       */
      lastFetchedAt: newestFetchedAt(cards),
      refreshAvailableInMs: dashboardRefreshWait(
        cards.filter((row) => !row.historyUnavailable),
      ),
      /** Tazeleme istendi ama tum veriler cok taze oldugu icin atlandi mi? */
      refreshSkipped:
        Boolean(dashboardOptions.refresh) &&
        stale.length === 0 &&
        blocked.length === 0,
    };
  }

  /**
   * Draft asistaninin kullanacagi hero havuzu istatistikleri.
   * Ag istegi YAPMAZ; yalnizca onbellekten okur.
   * @returns {Promise<Record<string, Object>>}
   */
  async function getCachedStatsByPlayerId() {
    const entries = await Promise.all(
      listRoster().map(async (player) => {
        try {
          const bundle = await getPlayerBundle(player, { allowFetch: false });
          return [player.id, bundle.stats];
        } catch {
          return [player.id, null];
        }
      }),
    );
    return Object.fromEntries(entries.filter((row) => row[1]));
  }

  return {
    client,
    getPlayerMatches,
    getPlayerProfile,
    getHeroPerformance,
    getPlayerBundle,
    getRosterDashboard,
    getCachedStatsByPlayerId,
    /** Hangi kaynaklar yapilandirilmis, en son hangisi cevap verdi? */
    providerStatus: () => ({
      providers: client.providers,
      lastUsed: client.lastUsedProvider,
      failures: client.failures,
    }),
  };
}
