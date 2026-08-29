/**
 * GET /api/debug
 *
 * Debug panelinin veri kaynagi. Sadece calisma durumunu ozetler; gizli
 * deger (API anahtari, oturum jetonu, ingest token) DONDURMEZ — yalnizca
 * "tanimli mi" bilgisi verilir.
 */

import { listRoster } from "@dotastat/core";
import { getPlayerBundle } from "./_lib/player-data.mjs";
import { liveStore, presenceStore } from "./_lib/store.mjs";
import { fail, json } from "./_lib/respond.mjs";

export default async (request) => {
  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  const started = Date.now();

  try {
    const roster = listRoster();
    const cacheRows = await Promise.all(
      roster.map(async (player) => {
        const bundle = await getPlayerBundle(player, { allowFetch: false });
        return {
          id: player.id,
          name: player.name,
          accountId: player.player_id,
          matchCount: bundle.matches.length,
          fetchedAt: bundle.fetchedAt || "",
          evaluationCount: bundle.evaluations.length,
        };
      }),
    );

    const live = liveStore();
    const presence = presenceStore();
    const liveKeys = await live.keys();
    const presenceKeys = await presence.keys();

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      runtime: {
        node: process.version,
        region: process.env.AWS_REGION || "",
        deployId: process.env.DEPLOY_ID || "",
        commit: process.env.COMMIT_REF || "",
        branch: process.env.BRANCH || "",
      },
      config: {
        openDotaKey: Boolean(process.env.OPENDOTA_API_KEY),
        sessionSecret: Boolean(process.env.SESSION_SECRET),
        liveIngestToken: Boolean(process.env.LIVE_INGEST_TOKEN),
        githubRepo: process.env.GITHUB_REPO || "",
        blobsAvailable: live.usingBlobs,
      },
      roster: {
        count: roster.length,
        players: cacheRows,
        emptyCaches: cacheRows.filter((row) => row.matchCount === 0).length,
      },
      live: {
        uploaderCount: liveKeys.filter((key) => key.startsWith("state:"))
          .length,
      },
      presence: {
        userCount: presenceKeys.filter((key) => key.startsWith("user:")).length,
      },
    });
  } catch (error) {
    return fail("debug-verisi-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
