/**
 * GET /api/auth/return
 *
 * Steam'den donen istegi dogrular, oturum cerezi yazar ve ana sayfaya
 * geri gonderir. Profil adi/avatari OpenDota'dan alinir; boylece ayrica
 * Steam Web API anahtarina ihtiyac duyulmaz.
 */

import {
  createOpenDotaClient,
  findRosterPlayer,
  toAccountId,
} from "@dotastat/core";
import { buildSessionCookie } from "./_lib/session.mjs";
import { verifyAssertion } from "./_lib/steam-openid.mjs";
import { redirect, resolveOrigin } from "./_lib/respond.mjs";

export default async (request) => {
  const url = new URL(request.url);
  const origin = resolveOrigin(request);

  const result = await verifyAssertion(url.searchParams);
  if (!result.ok || !result.steamId) {
    return redirect(
      origin + "/?login=hata&reason=" + (result.error || "bilinmiyor"),
    );
  }

  const accountId = toAccountId(result.steamId);
  let name = "";
  let avatar = "";

  // Roster'daki bir arkadassa adi tohum profilden gelir; degilse OpenDota'dan.
  const rosterPlayer = findRosterPlayer(accountId);
  if (rosterPlayer) {
    name = rosterPlayer.name;
    avatar = rosterPlayer.avatar || "";
  }

  if (!name || !avatar) {
    try {
      const profile = await createOpenDotaClient({
        apiKey: process.env.OPENDOTA_API_KEY || "",
      }).getPlayerProfile(accountId);
      name = name || profile?.name || "";
      avatar = avatar || profile?.avatar || "";
    } catch {
      // Profil cekilemezse oturum yine acilir, sadece isim bos kalir.
    }
  }

  const cookie = buildSessionCookie(
    { steamId: result.steamId, accountId, name, avatar },
    { secure: origin.startsWith("https://") },
  );

  return redirect(origin + "/?login=ok", { "set-cookie": cookie });
};
