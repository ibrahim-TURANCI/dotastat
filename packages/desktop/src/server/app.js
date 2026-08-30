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
const { hasCloudSession } = require("../services/cloud-session.js");

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
  const { core, settings, storage, relay, webDir, mmr } = options;
  const logger = options.logger || console;

  const playerData = core.createPlayerDataService({
    storage,
    apiKey: settings.get().openDotaApiKey,
    stratzApiKey: settings.get().stratzApiKey,
  });

  /** Bellekte tutulan son canli mac durumu. */
  let liveState = null;
  let lastRawAt = "";

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

      relay.push(liveState);
    } catch (error) {
      logger.error?.("GSI verisi islenemedi", String(error?.message || error));
    }
    response.status(200).send("ok");
  }

  app.post("/gsi", handleGsi);
  app.post("/", handleGsi);

  // --- Oyuncu degerlendirme ---------------------------------------------------

  app.get("/api/players", async (request, response) => {
    try {
      const dashboard = await playerData.getRosterDashboard({
        refresh: request.query.refresh === "1",
      });
      response.json({
        ok: true,
        ...dashboard,
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

  app.get("/api/players/:playerKey", async (request, response) => {
    const player = core.findRosterPlayer(request.params.playerKey);
    if (!player) {
      response.status(404).json({ ok: false, error: "oyuncu-bulunamadi" });
      return;
    }

    const accountId = ownAccountId();
    const isOwnProfile =
      Boolean(accountId) && accountId === String(player.player_id);
    const forcedRoles = isOwnProfile ? await readMatchRoles(accountId) : {};

    try {
      const bundle = await playerData.getPlayerBundle(player, {
        refresh: request.query.refresh === "1",
        forcedRoles,
      });

      // MMR yalnizca KENDI profilinde gosterilir: okunan deger bu bilgisayarda
      // oturum acan oyuncuya aittir, baskasinin maclarina yazilamaz.
      const samples = isOwnProfile ? await mmr.history() : [];
      const mmrByMatch = core.attributeMmrToMatches({
        matches: bundle.matches,
        samples,
      });
      // Madalyanin yanindaki "kalan rank" bilgisi bundan hesaplanir.
      const mmrProgress = core.rankProgress(core.latestMmr(samples));
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

  app.get("/api/live", async (request, response) => {
    if (!liveState || !core.isLiveMatchFresh(liveState)) {
      response.json({ ok: true, active: false, reason: "canli-mac-yok" });
      return;
    }

    try {
      const statsByPlayerId = await playerData.getCachedStatsByPlayerId();
      const context = core.buildLiveMatchContext({
        liveState,
        statsByPlayerId,
        viewerSteamId: settings.resolveSteamId(),
      });
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
    const cloudSignedIn = await hasCloudSession(settings.get().cloudUrl || "");
    response.locals.cloudSignedIn = cloudSignedIn;

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
      "startMinimized",
      "autoInstallGsi",
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
    playerData,
  };
}

module.exports = {
  createServerApp,
};
