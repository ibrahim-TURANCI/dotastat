/**
 * Giris yapmis kullanicinin hero basina tavsiye duzenlemesi.
 *
 *   GET  /api/me/hero-plans  -> { heroes: { invoker: { requiredItems: [...] } } }
 *   POST /api/me/hero-plans  -> { hero, roleValues?, laneRoles?, counterHeroes?,
 *                                 counterItems?, requiredItems?,
 *                                 situationalItems?, removedItems? }
 *                               (hicbir alan yollanmazsa kayit SILINIR)
 *
 * KAYIT ORTAKTIR: katalog tek bir yerde tutulur ve kadrodaki herkes ayni
 * kaydi okuyup yazar; masaustu uygulamasi da bu ucu kullanir (bkz.
 * desktop/src/server/app.js). Boylece site ve masaustu tek bir katalog
 * paylasir.
 *
 * ERISIM: yalnizca KADRODAKI oyuncular. Katalog arkadas grubunun ortak oyun
 * bilgisini tasiyor; gruba ait olmayan bir ziyaretcinin duzenleyecegi bir sey
 * yok ve arayuz de dugmeyi hic gostermiyor. Sunucu ayni sarti bagimsiz olarak
 * uygular: dugmenin gizli olmasi ucun korunmasi demek degil.
 *
 * Kimlik HER ZAMAN oturum cerezinden alinir; istek govdesinden gelen bir
 * kimlige guvenilmez. Bu, mac pozisyonu ucuyla ayni sozlesmedir (bkz.
 * match-roles.mjs) — tek fark, kaydin kisiye degil gruba ait olmasi.
 *
 * Katalogun KENDISI (tum hero'lar, tohum degerler) burada donmez: o veri
 * statiktir ve arayuz paketinde `@dotastat/core` ile zaten geliyor. Her dialog
 * acilisinda 127 hero'luk bir tabloyu ag uzerinden tasimanin anlami yok.
 */

import { findRosterPlayer } from "@dotastat/core";
import {
  readHeroPlans,
  sessionAccountId,
  writeHeroPlan,
} from "./_lib/hero-plans.mjs";
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

  if (!findRosterPlayer(accountId)) {
    return fail("kadroda-degil", {
      status: 403,
      message:
        "Tavsiye kataloğunu yalnızca kadrodaki oyuncular düzenleyebilir.",
    });
  }

  if (request.method === "GET") {
    return json({
      ok: true,
      accountId,
      heroes: await readHeroPlans(),
    });
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

  const { hero, ...patch } = body;
  const result = await writeHeroPlan(accountId, hero, patch);

  if (!result.ok) {
    return fail(result.error || "kaydedilemedi", { status: 400 });
  }

  return json({ ok: true, accountId, heroes: result.heroes });
};
