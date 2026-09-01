/**
 * Giris yapmis kullanicinin hero basina item tavsiyesi duzenlemesi.
 *
 *   GET  /api/me/item-plans  -> { plans: { invoker: { add: [], remove: [] } } }
 *   POST /api/me/item-plans  -> { hero, add: [], remove: [] }
 *                               (iki liste de bos ise kayit SILINIR)
 *
 * Yalnizca kendi kaydina eriselebilir: anahtar oturum cerezinden alinir.
 * Bu, mac pozisyonu ucuyla ayni sozlesmedir (bkz. match-roles.mjs).
 */

import {
  readItemPlans,
  sessionAccountId,
  writeItemPlan,
} from "./_lib/item-plans.mjs";
import { readSession } from "./_lib/session.mjs";
import { fail, json } from "./_lib/respond.mjs";

export default async (request) => {
  const session = readSession(request);
  if (!session) {
    return fail("oturum-yok", {
      status: 401,
      message: "Tavsiyeleri düzenlemek için Steam ile giriş yapmalısın.",
    });
  }

  const accountId = sessionAccountId(session);
  if (!accountId) {
    return fail("hesap-cozulemedi", { status: 400 });
  }

  if (request.method === "GET") {
    return json({ ok: true, accountId, plans: await readItemPlans(accountId) });
  }

  if (request.method !== "POST") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  const result = await writeItemPlan(accountId, body.hero, {
    add: body.add,
    remove: body.remove,
  });

  if (!result.ok) {
    return fail(result.error || "kaydedilemedi", { status: 400 });
  }

  return json({ ok: true, accountId, plans: result.plans });
};
