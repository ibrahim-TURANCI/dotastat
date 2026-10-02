/**
 * Online listesi (presence) — ortak mantik.
 *
 * Ayri bir heartbeat / liste yoklamasi YOKTUR: sitede acik her sekme zaten
 * `/api/live`'i yokluyor. Giris yapmis kullanicinin o istegi "buradayim"
 * sayilir ve yanit online listesini de tasir (bkz. live.mjs). Boylece online
 * listesi icin fazladan tek bir istek atilmaz.
 *
 *   - Sekme kapanirken tarayici tek bir "ayrildim" istegi gonderir; kullanici
 *     listeden ANINDA duser (bkz. presence.mjs, useSession).
 *   - Tarayici coker ya da bilgisayar uyursa o istek gitmez; kayit
 *     PRESENCE_TTL_MS sonunda kendiliginden duser.
 *   - Arka plandaki sekme yoklama yapmaz; o durumda useSession seyrek bir
 *     heartbeat gonderir (bkz. HIDDEN_BEAT_MS).
 */

import { findRosterPlayer, toAccountId } from "@dotastat/core";
import { presenceStore } from "./store.mjs";

/** Haber gelmezse kullanici bu sure sonunda listeden duser. */
export const PRESENCE_TTL_MS = 3 * 60 * 1000;

/**
 * Ayni kullanicinin kaydi bu sureden sik yazilmaz. Yoklama mac varken 5 sn'de
 * bir geliyor; her seferinde depoya yazmak gereksiz.
 */
const TOUCH_EVERY_MS = 60 * 1000;

/** Online listesi bu sure hafizadan verilir (her yoklamada depo okunmasin). */
const LIST_MEMO_MS = 15 * 1000;

/** steamId -> bu kapta son yazma ani */
const touchedAt = new Map();

/** @type {{ at: number, online: Array<Record<string, any>> }|null} */
let listMemo = null;

/**
 * @param {{ steamId: string, accountId?: string, name?: string, avatar?: string }} session
 * @param {{ inGame?: boolean, hero?: string }} [body]
 */
function presenceRow(session, body = {}) {
  const accountId = session.accountId || toAccountId(session.steamId);
  const rosterPlayer = findRosterPlayer(accountId);
  return {
    steamId: session.steamId,
    accountId,
    name: rosterPlayer?.name || session.name || "Oyuncu",
    avatar: session.avatar || "",
    rosterId: rosterPlayer?.id || "",
    inGame: Boolean(body.inGame),
    hero: String(body.hero || ""),
    seenAt: new Date().toISOString(),
  };
}

/**
 * Kullaniciyi online isaretler.
 *
 * @param {Record<string, any>} session
 * @param {{ force?: boolean, body?: Record<string, any> }} [options]
 *   `force`: kisitlamayi atla (acik heartbeat istegi)
 * @returns {Promise<Record<string, any>|null>} yazilan kayit (yazilmadiysa null)
 */
export async function touchPresence(session, options = {}) {
  if (!session?.steamId) {
    return null;
  }
  const last = touchedAt.get(session.steamId) || 0;
  const isNew = !last;
  if (!options.force && Date.now() - last < TOUCH_EVERY_MS) {
    return null;
  }
  const row = presenceRow(session, options.body);
  await presenceStore().set("user:" + session.steamId, row, {
    ttlMs: PRESENCE_TTL_MS,
  });
  touchedAt.set(session.steamId, Date.now());
  // Yeni gelen kullanici listede hemen gorunsun.
  if (isNew) {
    listMemo = null;
  }
  return row;
}

/**
 * Kullaniciyi listeden cikarir (sekme kapandi / cikis yapildi).
 * @param {Record<string, any>} session
 */
export async function removePresence(session) {
  if (!session?.steamId) {
    return;
  }
  await presenceStore().remove("user:" + session.steamId);
  touchedAt.delete(session.steamId);
  listMemo = null;
}

/**
 * Su an online olanlar, ada gore sirali.
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function readOnline(options = {}) {
  if (!options.fresh && listMemo && Date.now() - listMemo.at < LIST_MEMO_MS) {
    return listMemo.online;
  }
  const store = presenceStore();
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
  listMemo = { at: Date.now(), online };
  return online;
}
