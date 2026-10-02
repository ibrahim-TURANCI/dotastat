/**
 * Giris yapmis kullanicinin hero basina tavsiye duzenlemesi.
 *
 *   GET  /api/me/hero-plans  -> { heroes: { invoker: { requiredItems: [...] } } }
 *   POST /api/me/hero-plans  -> { hero, roleValues?, laneRoles?, traits?,
 *                                 counterHeroes?, counterItems?, requiredItems?,
 *                                 situationalItems?, removedItems? }
 *                               (hicbir alan yollanmazsa hero VARSAYILANINA
 *                               doner)
 *   POST /api/me/hero-plans  -> { action: "save-defaults" }
 *                               gecerli duzenlemeleri varsayilan olarak
 *                               kaydeder (yalnizca catalogAdmin)
 *
 * GET yaniti `heroes` (gecerli) ve `defaults` (varsayilan) kumelerini ve
 * kullanicinin varsayilani kaydedip kaydedemeyecegini (`canSaveDefaults`)
 * tasir.
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
 * Kimlik HER ZAMAN oturum cerezinden ya da masaustu cihaz anahtarindan
 * alinir (bkz. _lib/identity.mjs); istek govdesinden gelen bir
 * kimlige guvenilmez. Bu, mac pozisyonu ucuyla ayni sozlesmedir (bkz.
 * match-roles.mjs) — tek fark, kaydin kisiye degil gruba ait olmasi.
 *
 * Katalogun KENDISI (tum hero'lar, tohum degerler) burada donmez: o veri
 * statiktir ve arayuz paketinde `@dotastat/core` ile zaten geliyor. Her dialog
 * acilisinda 127 hero'luk bir tabloyu ag uzerinden tasimanin anlami yok.
 */

import { findRosterPlayer, isCatalogAdmin } from "@dotastat/core";
import {
  readHeroCatalog,
  saveHeroDefaults,
  writeHeroPlan,
} from "./_lib/hero-plans.mjs";
import { IDENTITY_MESSAGES, readIdentity } from "./_lib/identity.mjs";
import { fail, json } from "./_lib/respond.mjs";
import { loadRoster } from "./_lib/roster.mjs";

export default async (request) => {
  // Kadro degisiklik katmani (gizlenen / eklenen oyuncular).
  await loadRoster();
  // Masaustu uygulamasi cihaz anahtariyla gelir; sitede oturum cerezi.
  const { identity, error } = await readIdentity(request);
  if (!identity) {
    return fail(error === "kimlik-yok" ? "oturum-yok" : error, {
      status: 401,
      message:
        error === "kimlik-yok"
          ? "Tavsiyeleri düzenlemek için Steam ile giriş yapmalısın."
          : IDENTITY_MESSAGES[error],
    });
  }

  const accountId = identity.accountId;

  if (!findRosterPlayer(accountId)) {
    return fail("kadroda-degil", {
      status: 403,
      message:
        "Tavsiye kataloğunu yalnızca kadrodaki oyuncular düzenleyebilir.",
    });
  }

  // OKUMA cihaz kimligiyle de olur: masaustu uygulamasi tavsiyeyi bu
  // katalogdan uretiyor ve giris yapilmadan da calismali. DUZENLEME ise
  // yalnizca siteden Steam girisiyle yapilir ("Tavsiyeleri yonet" ekrani).
  const viaSession = identity.via === "session";
  const canSaveDefaults = viaSession && isCatalogAdmin(accountId);

  if (request.method === "GET") {
    const { heroes, defaults } = await readHeroCatalog();
    return json({
      ok: true,
      accountId,
      heroes,
      defaults,
      canSaveDefaults,
      canEdit: viaSession,
    });
  }

  if (request.method !== "POST") {
    return fail("desteklenmeyen-metot", { status: 405 });
  }

  if (!viaSession) {
    return fail("oturum-yok", {
      status: 401,
      message: "Tavsiyeleri düzenlemek için siteden Steam ile giriş yap.",
    });
  }

  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  if (body.action === "save-defaults") {
    if (!canSaveDefaults) {
      return fail("yetki-yok", {
        status: 403,
        message: "Varsayılanı yalnızca katalog yöneticisi kaydedebilir.",
      });
    }
    const saved = await saveHeroDefaults(accountId);
    return json({ ok: true, accountId, canSaveDefaults, ...saved });
  }

  const { hero, ...patch } = body;
  const result = await writeHeroPlan(accountId, hero, patch);

  if (!result.ok) {
    return fail(result.error || "kaydedilemedi", { status: 400 });
  }

  return json({
    ok: true,
    accountId,
    canSaveDefaults,
    heroes: result.heroes,
    defaults: result.defaults,
  });
};
