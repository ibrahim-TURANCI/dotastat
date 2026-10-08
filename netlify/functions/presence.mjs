/**
 * Online listesi.
 *
 *   POST /api/presence — heartbeat. Iki kaynaktan gelir:
 *                        - Site: giris yapmis kullanici, yalnizca sekme ARKA
 *                          PLANDAYKEN; gorunur sekmede `/api/live` yoklamasi
 *                          ayni isi gorur (bkz. _lib/presence.mjs).
 *                        - Masaustu uygulamasi: cihaz kimligiyle (bkz.
 *                          _lib/identity.mjs), dakikada bir. Yanit online
 *                          listesini de tasir; uygulama ayrica liste istemez.
 *                        `{ leave: true }` ile kullanici listeden aninda cikar
 *                        (sekme / uygulama kapandi).
 *   GET  /api/presence — su an sitede/oyunda olan kullanicilar. Site artik
 *                        listeyi `/api/live` yanitindan aliyor; bu uc eski
 *                        istemciler icin duruyor.
 *
 * Kimlik cerezden ya da cihaz anahtarindan okunur; govdeye yazilan SteamID'ye
 * guvenilmez.
 */

import { readSession } from "./_lib/session.mjs";
import { readIdentity } from "./_lib/identity.mjs";
import { playerStore } from "./_lib/store.mjs";
import { fail, json } from "./_lib/respond.mjs";
import { loadRoster } from "./_lib/roster.mjs";
import { readOnline, removePresence, touchPresence } from "./_lib/presence.mjs";

/**
 * Masaustu uygulamasindan gelen istegin oturum karsiligi.
 *
 * Cihaz kimliginde Steam profili (ad, avatar) yoktur; avatar oyuncunun
 * onbellekteki profilinden alinir. Ad kadrodan gelir (bkz. presenceRow).
 *
 * @param {Request} request
 * @returns {Promise<Record<string, any>|null>}
 */
async function deviceSession(request) {
  const { identity } = await readIdentity(request);
  if (!identity) {
    return null;
  }
  let avatar = "";
  try {
    const profile = await playerStore().get(
      "profile:" + identity.accountId + ":stale",
    );
    avatar = String(profile?.avatar || "");
  } catch {
    avatar = "";
  }
  return { steamId: identity.steamId, accountId: identity.accountId, avatar };
}

export default async (request) => {
  // Kadro degisiklik katmani (gizlenen / eklenen oyuncular).
  await loadRoster();

  if (request.method === "POST") {
    const session = readSession(request) || (await deviceSession(request));
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
    // Masaustu listeyi bu yanittan alir; sitenin arka plan heartbeat'i
    // listeye ihtiyac duymaz, ona fazladan okuma yaptirilmaz.
    const online =
      body.client === "desktop" ? await readOnline().catch(() => null) : null;
    return json({ ok: true, presence: row, ...(online ? { online } : {}) });
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
