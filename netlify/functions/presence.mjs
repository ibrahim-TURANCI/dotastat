/**
 * Online listesi.
 *
 *   POST /api/presence — giris yapmis kullanicidan heartbeat (60 sn'de bir)
 *   GET  /api/presence — su an sitede/oyunda olan kullanicilar
 *
 * Kimlik cerezden okunur; govdeye yazilan SteamID'ye guvenilmez.
 */

import { findRosterPlayer, toAccountId } from "@dotastat/core";
import { presenceStore } from "./_lib/store.mjs";
import { readSession } from "./_lib/session.mjs";
import { fail, json } from "./_lib/respond.mjs";

/** Heartbeat gelmezse kullanici bu sure sonunda listeden dusar. */
const PRESENCE_TTL_MS = 3 * 60 * 1000;

export default async (request) => {
  const store = presenceStore();

  if (request.method === "POST") {
    const session = readSession(request);
    if (!session) {
      return fail("oturum-yok", { status: 401 });
    }

    let body = {};
    try {
      body = (await request.json()) || {};
    } catch {
      body = {};
    }

    const accountId = session.accountId || toAccountId(session.steamId);
    const rosterPlayer = findRosterPlayer(accountId);

    const row = {
      steamId: session.steamId,
      accountId,
      name: rosterPlayer?.name || session.name || "Oyuncu",
      avatar: session.avatar || "",
      rosterId: rosterPlayer?.id || "",
      inGame: Boolean(body.inGame),
      hero: String(body.hero || ""),
      seenAt: new Date().toISOString(),
    };

    await store.set("user:" + session.steamId, row, { ttlMs: PRESENCE_TTL_MS });
    return json({ ok: true, presence: row });
  }

  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  try {
    const keys = (await store.keys()).filter((key) => key.startsWith("user:"));
    const rows = await Promise.all(keys.map((key) => store.get(key)));
    const online = rows
      .filter((row) => {
        if (!row?.seenAt) {
          return false;
        }
        const age = Date.now() - new Date(row.seenAt).getTime();
        return Number.isFinite(age) && age < PRESENCE_TTL_MS;
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"));

    return json({ ok: true, online, count: online.length });
  } catch (error) {
    return fail("online-listesi-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
