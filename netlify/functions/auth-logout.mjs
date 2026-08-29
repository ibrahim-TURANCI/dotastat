/**
 * POST /api/auth/logout
 *
 * Oturum cerezini siler.
 */

import { buildLogoutCookie } from "./_lib/session.mjs";
import { json, resolveOrigin } from "./_lib/respond.mjs";

export default async (request) => {
  const secure = resolveOrigin(request).startsWith("https://");
  return json(
    { ok: true, signedIn: false },
    { headers: { "set-cookie": buildLogoutCookie({ secure }) } },
  );
};
