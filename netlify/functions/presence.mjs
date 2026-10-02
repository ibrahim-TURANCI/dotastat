/**
 * Online listesi.
 *
 *   POST /api/presence — giris yapmis kullanicidan heartbeat. Yalnizca sekme
 *                        ARKA PLANDAYKEN gonderilir; gorunur sekmede
 *                        `/api/live` yoklamasi ayni isi gorur (bkz.
 *                        _lib/presence.mjs). `{ leave: true }` ile kullanici
 *                        listeden aninda cikar (sekme kapandi).
 *   GET  /api/presence — su an sitede/oyunda olan kullanicilar. Site artik
 *                        listeyi `/api/live` yanitindan aliyor; bu uc eski
 *                        istemciler icin duruyor.
 *
 * Kimlik cerezden okunur; govdeye yazilan SteamID'ye guvenilmez.
 */

import { readSession } from "./_lib/session.mjs";
import { fail, json } from "./_lib/respond.mjs";
import { loadRoster } from "./_lib/roster.mjs";
import { readOnline, removePresence, touchPresence } from "./_lib/presence.mjs";

export default async (request) => {
  // Kadro degisiklik katmani (gizlenen / eklenen oyuncular).
  await loadRoster();

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

    if (body.leave) {
      await removePresence(session);
      return json({ ok: true, presence: null });
    }

    const row = await touchPresence(session, { force: true, body });
    return json({ ok: true, presence: row });
  }

  if (request.method !== "GET") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  try {
    const online = await readOnline();
    return json({ ok: true, online, count: online.length });
  } catch (error) {
    return fail("online-listesi-alinamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
