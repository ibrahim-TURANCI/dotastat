/**
 * GET /api/auth/session
 *
 * Aktif oturumu dondurur. Oturum yoksa `signedIn: false` doner (hata degil).
 */

import { findRosterPlayer, toAccountId } from "@dotastat/core";
import { readSession } from "./_lib/session.mjs";
import { json } from "./_lib/respond.mjs";
import { loadRoster } from "./_lib/roster.mjs";

export default async (request) => {
  // Kadro degisiklik katmani (gizlenen / eklenen oyuncular).
  await loadRoster();
  const session = readSession(request);
  if (!session) {
    return json({ ok: true, mode: "cloud", signedIn: false, user: null });
  }

  const accountId = session.accountId || toAccountId(session.steamId);
  const rosterPlayer = findRosterPlayer(accountId);

  return json({
    ok: true,
    mode: "cloud",
    signedIn: true,
    user: {
      steamId: session.steamId,
      accountId,
      name: rosterPlayer?.name || session.name || "Oyuncu",
      avatar: session.avatar || rosterPlayer?.avatar || "",
      rosterId: rosterPlayer?.id || "",
      inRoster: Boolean(rosterPlayer),
    },
  });
};
