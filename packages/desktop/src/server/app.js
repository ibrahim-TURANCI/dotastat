/**
 * Yerel HTTP sunucusu (varsayilan port 3044).
 *
 * Iki isi vardir:
 *   1. Dota'nin GSI cikisini karsilamak (`POST /gsi`).
 *   2. Web arayuzune, canli siteyle AYNI `/api/...` sozlesmesini sunmak.
 *
 * Ayni arayuz koduyla calisabilmesi icin yanit zarflari Netlify
 * fonksiyonlariyla birebir aynidir.
 *
 * `core` disaridan gecirilir (bkz. src/core-bridge.js): masaustu paketi CJS,
 * cekirdek ise ES modulu oldugu icin gecis tek noktada yapilir.
 */

const path = require("node:path");
const express = require("express");
const { cloudFetch, hasCloudSession } = require("../services/cloud-session.js");

/**
 * @param {Object} options
 * @param {typeof import("@dotastat/core")} options.core
 * @param {ReturnType<import("./settings.js").createSettingsStore>} options.settings
 * @param {{ get: Function, set: Function }} options.storage
 * @param {ReturnType<import("../services/cloud-relay.js").createCloudRelay>} options.relay
 * @param {string} options.webDir Derlenmis arayuzun klasoru
 * @param {{ info: Function, warn: Function, error: Function }} [options.logger]
 * @param {string} [options.version]
 * @param {number} [options.port]
 */
function createServerApp(options) {
  const { core, settings, storage, relay, webDir, mmr, overwolf } = options;
  const logger = options.logger || console;

  const playerData = core.createPlayerDataService({
    storage,
    apiKey: settings.get().openDotaApiKey,
    stratzApiKey: settings.get().stratzApiKey,
  });

  /** Bellekte tutulan son canli mac durumu (yalnizca GSI'dan gelen ham hali). */
  let liveState = null;
  let lastRawAt = "";

  /**
   * GSI durumunu, varsa Overwolf goruntusuyle zenginlestirir.
   *
   * Overwolf kurulu degilse `overwolf` servisi hic verilmemis ya da bos
   * donuyor olur; o zaman durum OLDUGU GIBI kullanilir. Yani bu cagri
   * Overwolf'suz kurulumda hicbir sey degistirmez.
   *
   * @param {Record<string, any>|null} state
   * @returns {Record<string, any>|null}
   */
  function enrich(state) {
    const snapshot = overwolf?.snapshot?.() || null;
    if (!snapshot) {
      return state;
    }
    try {
      return core.applyOverwolfSnapshot(state, snapshot);
    } catch (error) {
      logger.warn?.(
        "Overwolf verisi birlestirilemedi",
        String(error?.message || error),
      );
      return state;
    }
  }

  /**
   * Overwolf goruntusunun "hala canli" sayilacagi sure.
   *
   * Bir mac icinde controller logu yalnizca draft sirasinda hareketlenir;
   * oyun basladiktan sonra dakikalarca sessiz kalabilir. Bu yuzden pencere
   * GSI'nin 3 dakikalik tazelik esiginden genistir. Yine de sinirsiz degil:
   * Dota kapandiginda dunku macin ekranda kalmamasi gerekir.
   */
  const OVERWOLF_LIVE_WINDOW_MS = 10 * 60 * 1000;

  /**
   * GSI hic kurulmamissa canli maci YALNIZCA Overwolf'tan kurar.
   *
   * Bu ikincil yoldur: normalde GSI ana kaynaktir, Overwolf onu zenginlestirir.
   * Burasi "arkadasta GSI yok ama Overwolf var" durumunda draftin yine de
   * gorunmesini saglar.
   *
   * @returns {Record<string, any>|null}
   */
  function liveStateFromOverwolfOnly() {
    const snapshot = overwolf?.snapshot?.() || null;
    if (!snapshot?.matchId || snapshot.ended || !snapshot.activity) {
      return null;
    }
    const at = new Date(snapshot.at || 0).getTime();
    if (!Number.isFinite(at) || Date.now() - at > OVERWOLF_LIVE_WINDOW_MS) {
      return null;
    }

    return enrich({
      matchId: String(snapshot.matchId),
      phase: snapshot.matchState || "",
      gameTime: 0,
      radiantScore: 0,
      direScore: 0,
      daytime: true,
      radiantPlayers: [],
      direPlayers: [],
      draft: { picks: [], bans: [], activeTeam: "" },
      localSteamId: settings.resolveSteamId(),
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Su an gosterilecek canli mac durumu.
   * Once GSI (taze ise), yoksa yalnizca Overwolf.
   * @returns {Record<string, any>|null}
   */
  function currentLiveState() {
    if (liveState && core.isLiveMatchFresh(liveState)) {
      return enrich(liveState);
    }
    return liveStateFromOverwolfOnly();
  }

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // --- Mac bitiminde otomatik tazeleme ----------------------------------------

  /** Ayni mac icin bir kez tazelenir; GSI ayni durumu defalarca gonderir. */
  let refreshedMatchId = "";

  /**
   * Mac bittiyse oyuncunun verisini bir kez tazeler.
   *
   * Kaynak maci hemen indekslemeyebilir, bu yuzden `expectMatchId` gecilir:
   * OpenDota maci vermezse zincir Stratz'a duser (bkz. provider-chain).
   *
   * @param {Record<string, any>|null} before
   * @param {Record<string, any>|null} after
   */
  function maybeRefreshAfterMatch(before, after) {
    const phase = String(after?.phase || "").toUpperCase();
    const wasPlaying = !String(before?.phase || "")
      .toUpperCase()
      .includes("POST_GAME");

    if (!phase.includes("POST_GAME") || !wasPlaying) {
      return;
    }

    const matchId = String(after?.matchId || "");
    if (!matchId || matchId === refreshedMatchId) {
      return;
    }
    refreshedMatchId = matchId;

    const player = core.findRosterPlayer(ownAccountId());
    if (!player) {
      return;
    }

    logger.info?.("Mac bitti, veri tazeleniyor: " + matchId);
    playerData
      .getPlayerBundle(player, { refresh: true, expectMatchId: matchId })
      .catch((error) =>
        logger.warn?.(
          "Mac sonrasi tazeleme basarisiz",
          String(error?.message || error),
        ),
      );
  }

  // --- GSI girisi ------------------------------------------------------------

  /**
   * @param {import("express").Request} request
   * @param {import("express").Response} response
   */
  function handleGsi(request, response) {
    try {
      const previous = liveState;
      liveState = core.normalizeGsiPayload(request.body || {});
      lastRawAt = new Date().toISOString();

      // Mac bitti mi? Bittiyse oyuncunun kendi verisini bir kez tazele ki
      // "Yenile"ye basmadan son mac listeye dussun.
      maybeRefreshAfterMatch(previous, liveState);

      // Kullanici elle SteamID girmediyse oyundan gelen kimlik kullanilir.
      const localSteamId = String(liveState.localSteamId || "").trim();
      if (/^\d{17}$/.test(localSteamId)) {
        if (settings.get().detectedSteamId !== localSteamId) {
          settings.update({ detectedSteamId: localSteamId });
        }
      }

      // Buluta ZENGINLESTIRILMIS durum gider: Overwolf kuruluysa 10 slotun
      // hero'su da yayina dahil olur, degilse GSI'nin verdigi kadari gider.
      relay.push(enrich(liveState));
    } catch (error) {
      logger.error?.("GSI verisi islenemedi", String(error?.message || error));
    }
    response.status(200).send("ok");
  }

  app.post("/gsi", handleGsi);
  app.post("/", handleGsi);

  // --- Oyuncu degerlendirme ---------------------------------------------------

  /**
   * Kadronun secilen donemdeki (Hafta / Ay) siralamasi.
   *
   * AG ISTEGI YAPMAZ: yalnizca onbellekteki mac verisini okur, boylece donem
   * sekmesi arasinda gidip gelmek gunluk limitten harcamaz.
   *
   * @param {string} period
   */
  async function periodScoreboard(period) {
    const own = ownAccountId();
    const samples = own ? await mmr.history() : [];

    const entries = await Promise.all(
      core.listRoster().map(async (player) => {
        const accountId = String(player.player_id);
        const bundle = await playerData.getPlayerBundle(player, {
          allowFetch: false,
          forcedRoles: await readMatchRoles(accountId),
        });
        return {
          player: bundle.player,
          matches: bundle.matches,
          evaluations: bundle.evaluations,
          // Yerelde yalnizca bu bilgisayarin oyuncusunun okumasi var;
          // digerlerinin MMR degisimi mac sonucundan tahmin edilir.
          samples: accountId === own ? samples : [],
        };
      }),
    );

    return core.buildWeeklyScoreboard({ entries, period });
  }

  app.get("/api/players", async (request, response) => {
    try {
      const dashboard = await playerData.getRosterDashboard({
        refresh: request.query.refresh === "1",
      });
      const board = await periodScoreboard(String(request.query.period || ""));
      response.json({
        ok: true,
        ...dashboard,
        cards: core.withPeriodSummary(dashboard.cards, board),
        period: board.period,
        periodLabel: board.periodLabel,
        periodDays: board.windowDays,
        periodSince: board.since,
        disclaimer:
          "performanceRank ve performans profili degerleri gercek MMR degildir, seviye tahminidir.",
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: "oyuncu-listesi-alinamadi",
        message: String(error?.message || error),
      });
    }
  });

  // --- Pozisyon beyani --------------------------------------------------------
  //
  // Masaustunde Steam girisi yoktur; kimlik ayarlardaki (veya GSI'dan tespit
  // edilen) SteamID'dir. Bu yuzden kullanici yalnizca KENDI maclarina rol
  // yazabilir: asagidaki `ownAccountId` disindaki oyuncularda secici kapalidir.

  /** @returns {string} */
  function ownAccountId() {
    const current = settings.get();
    return core.toAccountId(current.steamId || current.detectedSteamId || "");
  }

  /**
   * @param {string} accountId
   * @returns {Promise<Record<string, string>>}
   */
  async function readMatchRoles(accountId) {
    if (!accountId) {
      return {};
    }
    const row = await storage.get("roles:" + accountId);
    return row && typeof row.roles === "object" ? row.roles : {};
  }

  app.get("/api/me/match-roles", async (request, response) => {
    const accountId = ownAccountId();
    response.json({
      ok: true,
      accountId,
      roles: await readMatchRoles(accountId),
    });
  });

  app.post("/api/me/match-roles", async (request, response) => {
    const accountId = ownAccountId();
    if (!accountId) {
      response.status(400).json({
        ok: false,
        error: "steam-id-yok",
        message: "Ayarlarda SteamID tanimli degil.",
      });
      return;
    }

    const matchId = String(request.body?.matchId || "").trim();
    if (!/^\d+$/.test(matchId)) {
      response.status(400).json({ ok: false, error: "gecersiz-mac-id" });
      return;
    }

    const role = core.normalizeRoleKey(request.body?.role);
    if (request.body?.role && !role) {
      response.status(400).json({ ok: false, error: "gecersiz-pozisyon" });
      return;
    }

    const roles = { ...(await readMatchRoles(accountId)) };
    if (role) {
      roles[matchId] = role;
    } else {
      delete roles[matchId];
    }

    await storage.set("roles:" + accountId, {
      roles,
      updatedAt: new Date().toISOString(),
    });
    response.json({ ok: true, accountId, roles });
  });

  // --- Hero tavsiye katalogu ("Tavsiyeleri yonet") ---------------------------
  //
  // KATALOG ORTAKTIR VE SITEDE DURUR. "Bu hero'da bu item alinir" bilgisi
  // kisiye ozel degil; grubun ortak kaydidir. Bu yuzden masaustu kendi kopyasini
  // TUTMAZ, siteye gider (bkz. netlify/functions/_lib/hero-plans.mjs). Aksi
  // halde iki ayri katalog olusuyordu: oyun sirasinda masaustunde yapilan
  // duzenleme sitede hic gorunmuyordu.
  //
  // Site erisilemezse (internet yok, siteye giris yapilmamis) YEREL AYNA
  // kullanilir: son okunan katalog diske yazilir, boylece canli mac tavsiyesi
  // cevrimdisi da dogru calisir. O halde yapilan duzenleme yalnizca yerelde
  // kalir ve yanitta `synced: false` ile bildirilir.

  /** Yerel aynanin anahtari. Site kaydiyla ayni adi tasir. */
  const HERO_PLAN_KEY = "heroes:shared";

  /**
   * Katalogun surec ici hafizasi.
   *
   * Canli mac paneli bu ucu 5 saniyede bir yokluyor; her yoklamada siteye
   * gitmek hem yavas hem gereksiz. Kullanici kaydettiginde hafiza temizlenir,
   * arayuz de bir sonraki yoklamayi "taze" isaretler.
   *
   * @type {{ at: number, plans: Record<string, any> }|null}
   */
  let heroPlanMemo = null;
  const HERO_PLAN_MEMO_MS = 60 * 1000;

  /** @returns {string} Ayarlardaki site adresi (sondaki bolu isaretleri atilir) */
  function cloudBase() {
    return String(settings.get().cloudUrl || "")
      .trim()
      .replace(/[/]+$/, "");
  }

  /**
   * Katalog ucuna siteden istek atar.
   *
   * @param {{ method?: string, body?: Record<string, any> }} [options]
   * @returns {Promise<Record<string, any>|null>} basarisizsa null
   */
  async function cloudHeroPlans(options = {}) {
    const base = cloudBase();
    if (!base || !(await hasCloudSession(base))) {
      return null;
    }
    try {
      const response = await cloudFetch(base + "/api/me/hero-plans", {
        method: options.method || "GET",
        headers: options.body ? { "content-type": "application/json" } : {},
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok === false) {
        logger.warn?.(
          "Tavsiye katalogu siteyle esitlenemedi",
          String(payload?.message || payload?.error || response.status),
        );
        return null;
      }
      return core.normalizeHeroPlans(payload?.heroes || {});
    } catch (error) {
      logger.warn?.(
        "Tavsiye katalogu siteye ulasamadi",
        String(error?.message || error),
      );
      return null;
    }
  }

  /**
   * Yerel ayna. Site hic okunamadiysa ESKI kisisel kayitlara dusulur, boylece
   * ortak kataloga gecmeden once yapilmis duzenlemeler kaybolmaz.
   *
   * @returns {Promise<Record<string, Record<string, any>>>}
   */
  async function localHeroPlans() {
    const row = await storage.get(HERO_PLAN_KEY);
    if (row && typeof row.heroes === "object") {
      return core.normalizeHeroPlans(row.heroes);
    }

    const accountId = ownAccountId();
    if (!accountId) {
      return {};
    }
    const personal = await storage.get("heroes:" + accountId);
    if (personal && typeof personal.heroes === "object") {
      return core.normalizeHeroPlans(personal.heroes);
    }
    // En eski bicim: `{ add, remove }` listeleri.
    const legacy = await storage.get("plans:" + accountId);
    return core.heroPlansFromItemPlans(
      legacy && typeof legacy.plans === "object" ? legacy.plans : {},
    );
  }

  /**
   * @param {Record<string, any>} heroes
   */
  async function mirrorHeroPlans(heroes) {
    heroPlanMemo = { at: Date.now(), plans: heroes };
    await storage.set(HERO_PLAN_KEY, {
      heroes,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Gecerli katalog: once site, olmazsa yerel ayna.
   *
   * @param {{ fresh?: boolean }} [options]
   * @returns {Promise<Record<string, Record<string, any>>>}
   */
  async function readHeroPlans(options = {}) {
    if (
      !options.fresh &&
      heroPlanMemo &&
      Date.now() - heroPlanMemo.at < HERO_PLAN_MEMO_MS
    ) {
      return heroPlanMemo.plans;
    }

    const remote = await cloudHeroPlans();
    if (remote) {
      await mirrorHeroPlans(remote);
      return remote;
    }

    const local = await localHeroPlans();
    heroPlanMemo = { at: Date.now(), plans: local };
    return local;
  }

  /**
   * Katalogu duzenleme yetkisi KADROYA baglidir (sitedeki kuralin aynisi).
   * @returns {boolean}
   */
  function canEditHeroPlans() {
    const accountId = ownAccountId();
    return Boolean(accountId && core.findRosterPlayer(accountId));
  }

  app.get("/api/me/hero-plans", async (request, response) => {
    if (!canEditHeroPlans()) {
      response.status(403).json({
        ok: false,
        error: "kadroda-degil",
        message:
          "Tavsiye katalogunu yalnizca kadrodaki oyuncular duzenleyebilir.",
      });
      return;
    }
    response.json({
      ok: true,
      accountId: ownAccountId(),
      heroes: await readHeroPlans({ fresh: true }),
    });
  });

  app.post("/api/me/hero-plans", async (request, response) => {
    const accountId = ownAccountId();
    if (!accountId) {
      response.status(400).json({
        ok: false,
        error: "steam-id-yok",
        message: "Ayarlarda SteamID tanimli degil.",
      });
      return;
    }
    if (!canEditHeroPlans()) {
      response.status(403).json({
        ok: false,
        error: "kadroda-degil",
        message:
          "Tavsiye katalogunu yalnizca kadrodaki oyuncular duzenleyebilir.",
      });
      return;
    }

    const { hero, ...patch } = request.body || {};
    const heroKey = core.normalizeHeroKey(hero);
    if (!heroKey || !core.isKnownHero(heroKey)) {
      response.status(400).json({ ok: false, error: "gecersiz-hero" });
      return;
    }

    // Once SITEYE yazilir: ortak kaydin sahibi orasi. Site dondurduğu katalogu
    // ayna olarak saklariz, boylece baskasinin duzenlemesi de buraya iner.
    const remote = await cloudHeroPlans({
      method: "POST",
      body: { hero: heroKey, ...patch },
    });
    if (remote) {
      await mirrorHeroPlans(remote);
      response.json({ ok: true, accountId, heroes: remote, synced: true });
      return;
    }

    // Site yok: duzenleme yerel aynada tutulur ve canli mac tavsiyesinde
    // kullanilir, ama gruba GITMEZ. Arayuz bunu `synced: false` ile bilir.
    const clean = core.normalizeHeroOverride(patch);
    const heroes = { ...(await localHeroPlans()) };
    // Hicbir alan yollanmadiysa kayit SILINIR: arayuzdeki "Sifirla" budur ve
    // hero uretilmis tohum veriye geri doner.
    if (Object.keys(clean).length) {
      heroes[heroKey] = clean;
    } else {
      delete heroes[heroKey];
    }
    await mirrorHeroPlans(heroes);
    response.json({
      ok: true,
      accountId,
      heroes,
      synced: false,
      message:
        "Siteye ulasilamadi; duzenleme yalnizca bu bilgisayarda saklandi.",
    });
  });

  app.get("/api/players/:playerKey", async (request, response) => {
    const player = core.findRosterPlayer(request.params.playerKey);
    if (!player) {
      response.status(404).json({ ok: false, error: "oyuncu-bulunamadi" });
      return;
    }

    const accountId = ownAccountId();
    const isOwnProfile =
      Boolean(accountId) && accountId === String(player.player_id);
    // Pozisyon beyani BAKILAN oyuncuya aittir; kim bakiyor diye
    // degerlendirme degismemeli. Kimlik yalnizca YAZMA yetkisini belirler.
    const forcedRoles = await readMatchRoles(String(player.player_id));

    try {
      const bundle = await playerData.getPlayerBundle(player, {
        refresh: request.query.refresh === "1",
        forcedRoles,
      });

      // Masaustunde OLCULEN MMR yalnizca bu bilgisayarda oynayan oyuncu icin
      // vardir; DotaPlus logu baskasinin degerini yazmaz. Diger oyuncularda
      // deger madalyadan TURETILIR (`approximate: true`) — sitede ise ayni
      // uc, herkesin buluta gonderdigi olculen degeri dondurur.
      const samples = isOwnProfile ? await mmr.history() : [];
      const mmrByMatch = core.attributeMmrToMatches({
        matches: bundle.matches,
        samples,
      });
      // Madalyanin yanindaki MMR ve "kalan rank".
      const mmrProgress = core.resolveRankProgress({
        samples,
        rank: bundle.player?.rank || null,
      });
      response.json({
        ok: true,
        player: bundle.player,
        form: bundle.form,
        effectivePotential: bundle.effectivePotential,
        stats: bundle.stats,
        heroPool: bundle.heroPool,
        matches: bundle.matches.slice(0, 25),
        evaluations: bundle.evaluations.slice(0, 25),
        synergies: core.listSynergiesForPlayer(player.id),
        canEditRoles: isOwnProfile,
        matchRoles: forcedRoles,
        historyUnavailable: bundle.historyUnavailable,
        refreshSkipped: bundle.refreshSkipped,
        refreshAvailableInMs: bundle.refreshAvailableInMs,
        mmrByMatch,
        mmrProgress,
        fetchedAt: bundle.fetchedAt,
        fromCache: bundle.fromCache,
        provider: bundle.provider,
        providerError: bundle.providerError,
        heroPerformanceError: bundle.heroPerformanceError,
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: "oyuncu-detayi-alinamadi",
        message: String(error?.message || error),
      });
    }
  });

  // --- Canli mac --------------------------------------------------------------

  /**
   * Canli mac baglami (item tavsiyesi + takim analizi dahil).
   *
   * Hem `/api/live` hem oyun ici overlay bunu kullanir; ikisinin AYNI
   * tavsiyeyi gostermesi gerekir.
   *
   * @param {Record<string, any>} state currentLiveState ciktisi
   * @param {{ freshPlans?: boolean, minAdvice?: number }} [options]
   */
  async function buildContext(state, options = {}) {
    return core.buildLiveMatchContext({
      liveState: state,
      minAdvice: options.minAdvice,
      statsByPlayerId: await playerData.getCachedStatsByPlayerId(),
      viewerSteamId: settings.resolveSteamId(),
      // Katalog siteden gelir ve 60 saniye hafizada tutulur; arayuz bir
      // kayit sonrasi `?plans=fresh` ile hafizayi atlatir.
      heroOverrides: await readHeroPlans({ fresh: options.freshPlans }),
    });
  }

  /** Overlay'in gosterildigi mac evreleri: hero secildikten sonra. */
  const OVERLAY_PHASES = ["PRE_GAME", "GAME_IN_PROGRESS"];
  /** Overlay'de gosterilen tavsiye sayisi. */
  const OVERLAY_SLOTS = 4;

  /**
   * Oyun ici overlay icin KENDI hero'muzun tavsiyesi.
   *
   * Tavsiye listesi hero planiyla basliyor; ilk dort alinirsa rakibe karsi
   * counter onerisi cogu zaman disarida kaliyordu. Overlay'in amaci tam da
   * "sirada ne var + rakibe ne lazim" oldugu icin iki gruba ikiser yer
   * ayrilir, bos kalan yer siradakiyle doldurulur.
   *
   * @returns {Promise<{ active: boolean, reason?: string, hero?: string, items?: Array<Record<string, string>> }>}
   */
  async function overlayState() {
    const state = currentLiveState();
    const phase = String(state?.phase || "").toUpperCase();
    if (!state || !OVERLAY_PHASES.some((name) => phase.includes(name))) {
      return { active: false, reason: "oyunda-degil" };
    }

    const context = await buildContext(state, { minAdvice: OVERLAY_SLOTS });
    const ids = new Set(
      [settings.resolveSteamId(), state.localSteamId]
        .map((value) => String(value || ""))
        .filter(Boolean),
    );
    const me = [
      ...(context.radiantPlayers || []),
      ...(context.direPlayers || []),
    ].find((row) => ids.has(String(row.steamId || "")));
    if (!context.active || !me) {
      return { active: false, reason: "oyuncu-bulunamadi" };
    }

    const advice = Array.isArray(me.itemAdvice) ? me.itemAdvice : [];
    const counters = advice.filter((row) => row.group === "counter");
    const others = advice.filter((row) => row.group !== "counter");
    const picked = new Set([...others.slice(0, 2), ...counters.slice(0, 2)]);
    for (const row of advice) {
      if (picked.size >= OVERLAY_SLOTS) {
        break;
      }
      picked.add(row);
    }

    return {
      active: true,
      hero: me.heroName || "",
      items: advice
        .filter((row) => picked.has(row))
        .map((row) => ({
          key: row.key,
          name: row.name,
          group: row.group,
          groupLabel: row.groupLabel,
          reason: row.reason,
          icon: core.itemIconUrl(row.key),
        })),
    };
  }

  app.get("/api/live", async (request, response) => {
    const state = currentLiveState();
    if (!state) {
      response.json({ ok: true, active: false, reason: "canli-mac-yok" });
      return;
    }

    try {
      const context = await buildContext(state, {
        freshPlans: request.query.plans === "fresh",
      });
      // Duzenleme kadroya bagli; masaustunde kimlik ayarlardaki SteamID.
      context.canEditItemPlans = canEditHeroPlans();
      response.json({ ok: true, ...context });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: "canli-mac-alinamadi",
        message: String(error?.message || error),
      });
    }
  });

  // --- Kimlik -----------------------------------------------------------------

  app.get("/api/auth/session", async (request, response) => {
    // Siteye giris yapilmis mi? Canli mac yayini icin gereken tek sey bu;
    // arayuz butonu buna gore "giris yap" ya da "cikis" gosterir.
    const cloudUrl = String(settings.get().cloudUrl || "").trim();
    const cloudSignedIn = await hasCloudSession(cloudUrl);
    response.locals.cloudSignedIn = cloudSignedIn;
    // Site adresi bos ise Steam girisi ACILAMAZ (bkz. main.js ->
    // "dotastat:cloud-login"). Arayuz bunu tiklamadan once soylesin.
    const cloudConfigured = Boolean(cloudUrl);

    const steamId = settings.resolveSteamId();
    if (!steamId) {
      // `mode` arayuzun hangi ortamda oldugunu bilmesini saglar: masaustunde
      // Steam OpenID akisi YOKTUR (kimlik GSI/ayarlardan gelir), bu yuzden
      // arayuz "Steam ile giris" yerine "Ayarlar" gosterir.
      response.json({
        ok: true,
        mode: "desktop",
        signedIn: false,
        cloudSignedIn,
        cloudConfigured,
        user: null,
      });
      return;
    }

    const accountId = core.toAccountId(steamId);
    const rosterPlayer = core.findRosterPlayer(accountId);
    response.json({
      ok: true,
      mode: "desktop",
      signedIn: true,
      cloudSignedIn,
      cloudConfigured,
      user: {
        steamId,
        accountId,
        name: rosterPlayer?.name || "Bu bilgisayar",
        avatar: rosterPlayer?.avatar || "",
        rosterId: rosterPlayer?.id || "",
        inRoster: Boolean(rosterPlayer),
      },
    });
  });

  // Masaustunde "cikis" kimligi sifirlar; yeniden oyuna girilince tespit edilir.
  app.post("/api/auth/logout", (request, response) => {
    settings.update({ steamId: "", detectedSteamId: "" });
    response.json({ ok: true, signedIn: false });
  });

  // --- Online listesi ---------------------------------------------------------
  // Yerel modda yalnizca bu bilgisayardaki kullanici bilinir. Gercek liste
  // canli sitede tutulur.

  app.get("/api/presence", (request, response) => {
    const steamId = settings.resolveSteamId();
    const rosterPlayer = steamId
      ? core.findRosterPlayer(core.toAccountId(steamId))
      : null;
    const online = steamId
      ? [
          {
            steamId,
            accountId: core.toAccountId(steamId),
            name: rosterPlayer?.name || "Bu bilgisayar",
            avatar: rosterPlayer?.avatar || "",
            rosterId: rosterPlayer?.id || "",
            inGame: Boolean(liveState && core.isLiveMatchFresh(liveState)),
            seenAt: new Date().toISOString(),
          },
        ]
      : [];
    response.json({ ok: true, online, count: online.length });
  });

  app.post("/api/presence", (request, response) => {
    response.json({ ok: true, presence: null, local: true });
  });

  // --- Ayarlar (yalnizca masaustunde) ------------------------------------------

  app.get("/api/settings", (request, response) => {
    const current = settings.get();
    response.json({
      ok: true,
      settings: {
        ...current,
        // Gizli anahtarlar arayuze ham halde gonderilmez; yalnizca "dolu mu"
        // bilgisi gider. Arayuz "***" gonderirse deger degistirilmemis sayilir.
        ingestToken: current.ingestToken ? "***" : "",
        openDotaApiKey: current.openDotaApiKey ? "***" : "",
        stratzApiKey: current.stratzApiKey ? "***" : "",
      },
      // GSI yapilandirmasinin bekledigi port; ayarlar ekraninda gosterilir.
      gsiPort: Number(process.env.PORT) || 3044,
      // MMR okuma ve siteye gonderim durumu; sorun cikarsa burada gorunur.
      mmrStatus: mmr ? mmr.status() : null,
    });
  });

  app.post("/api/settings", (request, response) => {
    const body = request.body || {};
    const patch = {};
    for (const key of [
      "steamId",
      "cloudUrl",
      "ingestToken",
      "openDotaApiKey",
      "stratzApiKey",
      "shareLive",
      "useOverwolf",
      "startMinimized",
      "autoLaunch",
      "autoInstallGsi",
      "showOverlay",
    ]) {
      if (body[key] !== undefined && body[key] !== "***") {
        patch[key] = body[key];
      }
    }
    response.json({ ok: true, settings: settings.update(patch) });
  });

  // --- Surum bilgisi --------------------------------------------------------------

  app.get("/api/release", (request, response) => {
    response.json({
      ok: true,
      available: false,
      reason: "masaustu-surumu-zaten-calisiyor",
      version: options.version || "",
    });
  });

  // --- Debug ------------------------------------------------------------------------

  app.get("/api/debug", async (request, response) => {
    const current = settings.get();
    try {
      const dashboard = await playerData.getRosterDashboard({ refresh: false });
      response.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        durationMs: 0,
        runtime: {
          node: process.version,
          mode: "desktop",
          version: options.version || "",
          port: options.port || 0,
        },
        config: {
          openDotaKey: Boolean(current.openDotaApiKey),
          sessionSecret: true,
          liveIngestToken: Boolean(current.ingestToken),
          githubRepo: "",
          blobsAvailable: false,
          cloudUrl: current.cloudUrl || "",
          shareLive: Boolean(current.shareLive),
        },
        roster: {
          count: dashboard.cards.length,
          players: dashboard.cards.map((row) => ({
            id: row.id,
            name: row.name,
            accountId: row.playerId,
            matchCount: row.form?.matches || 0,
            evaluationCount: row.form?.matches || 0,
            fetchedAt: row.fetchedAt,
          })),
          emptyCaches: dashboard.pendingPlayers.length,
        },
        live: {
          uploaderCount: liveState ? 1 : 0,
          lastPayloadAt: lastRawAt,
          relay: relay.status(),
          // Overwolf kurulu degilse `available:false` doner; bu bir hata
          // degildir, yalnizca ek kaynagin yoklugudur.
          overwolf: overwolf?.status?.() || {
            available: false,
            error: "servis-yok",
          },
        },
        presence: { userCount: settings.resolveSteamId() ? 1 : 0 },
      });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: "debug-verisi-alinamadi",
        message: String(error?.message || error),
      });
    }
  });

  app.get("/health", (request, response) => {
    response.json({
      ok: true,
      live: Boolean(liveState),
      version: options.version || "",
    });
  });

  // --- Arayuz ------------------------------------------------------------------------

  if (webDir) {
    app.use(express.static(webDir));
    // SPA geri dusumu: /api ve /gsi disindaki her sey index.html'e gider.
    app.get(/^\/(?!api\/|gsi|health).*/, (request, response) => {
      response.sendFile(path.join(webDir, "index.html"));
    });
  }

  // Taninmayan /api yollari icin Express'in duz metin "Cannot GET ..." sayfasi
  // doner; koyu temada okunmaz ve ne oldugunu anlatmaz. Sitede olup burada
  // olmayan uclar (ornek: Steam OpenID girisi) icin acik bir yanit veriyoruz.
  app.use("/api", (request, response) => {
    response.status(404).json({
      ok: false,
      error: "uc-bulunamadi",
      message:
        "Bu uc masaustu surumunde yok: " +
        request.method +
        " /api" +
        request.path,
    });
  });

  return {
    app,
    /** Testler ve tepsi menusu icin son durum. */
    getLiveState: () => liveState,
    /** Overwolf ile zenginlestirilmis hali (yoksa GSI'nin aynisi). */
    getEnrichedLiveState: currentLiveState,
    /** Oyun ici overlay'in gosterecegi tavsiyeler (bkz. services/overlay.js). */
    getOverlayState: overlayState,
    /**
     * Overwolf logunda bir sey degistiginde cagrilir: draft ilerlerken GSI
     * sessiz kalsa bile yayin guncellensin.
     */
    onOverwolfChange() {
      const state = currentLiveState();
      if (state) {
        relay.push(state);
      }
    },
    playerData,
  };
}

module.exports = {
  createServerApp,
};
