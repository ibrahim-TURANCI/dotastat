/**
 * Masaustu uygulamasini kullanan oyuncunun MMR okumalari.
 *
 *   POST /api/me/mmr  -> { samples: [{ at, mmr }] }
 *
 * Deger masaustu uygulamasindan gelir (bkz. desktop/services/mmr-watcher.js).
 * Kimlik cihaz anahtarindan ya da oturum cerezinden alinir (bkz.
 * _lib/identity.mjs): kimse baskasinin hesabina MMR yazamaz.
 */

import { mergeMmrSamples } from "@dotastat/core";
import { IDENTITY_MESSAGES, readIdentity } from "./_lib/identity.mjs";
import { mmrStore } from "./_lib/store.mjs";
import { fail, json } from "./_lib/respond.mjs";

/** Bir hesap icin saklanacak en fazla okuma. */
const MAX_SAMPLES = 2000;

export default async (request) => {
  const { identity, error } = await readIdentity(request);
  if (!identity) {
    return fail(error === "kimlik-yok" ? "oturum-yok" : error, {
      status: 401,
      message: IDENTITY_MESSAGES[error] || IDENTITY_MESSAGES["kimlik-yok"],
    });
  }

  const accountId = identity.accountId;

  if (request.method !== "POST") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    return fail("gecersiz-govde", { status: 400 });
  }

  const incoming = Array.isArray(body.samples) ? body.samples : [];
  if (!incoming.length) {
    return fail("okuma-yok", { status: 400 });
  }

  const store = mmrStore();
  const existing = (await store.get("mmr:" + accountId))?.samples || [];
  const merged = mergeMmrSamples(existing, incoming, { limit: MAX_SAMPLES });

  await store.set("mmr:" + accountId, {
    samples: merged,
    updatedAt: new Date().toISOString(),
  });

  return json({ ok: true, accountId, samples: merged.length });
};
