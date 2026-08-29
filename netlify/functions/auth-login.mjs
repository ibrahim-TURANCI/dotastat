/**
 * GET /api/auth/login
 *
 * Kullaniciyi Steam'in "Sign in through Steam" sayfasina yonlendirir.
 * API anahtari gerekmez.
 */

import { buildLoginUrl } from "./_lib/steam-openid.mjs";
import { fail, redirect, resolveOrigin } from "./_lib/respond.mjs";

export default async (request) => {
  try {
    const origin = resolveOrigin(request);
    const url = buildLoginUrl({
      realm: origin,
      returnTo: origin + "/api/auth/return",
    });
    return redirect(url);
  } catch (error) {
    return fail("giris-baslatilamadi", {
      status: 500,
      message: String(error?.message || error),
    });
  }
};
