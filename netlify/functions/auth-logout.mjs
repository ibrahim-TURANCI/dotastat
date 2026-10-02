/**
 * POST /api/auth/logout
 *
 * Oturum cerezini siler ve kullaniciyi online listesinden cikarir.
 */

import { buildLogoutCookie, readSession } from "./_lib/session.mjs";
import { json, resolveOrigin } from "./_lib/respond.mjs";
import { removePresence } from "./_lib/presence.mjs";

export default async (request) => {
  const secure = resolveOrigin(request).startsWith("https://");
  // Liste yazilamazsa cikis yine yapilir; kayit kendi omrunde duser.
  await removePresence(readSession(request)).catch(() => {});
  return json(
    { ok: true, signedIn: false },
    { headers: { "set-cookie": buildLogoutCookie({ secure }) } },
  );
};
