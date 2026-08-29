/**
 * Oyuncunun kendi maclarinda oynadigi pozisyonu beyan etmesi.
 *
 * NEDEN GEREKLI: OpenDota pozisyonu `lane_role` + `is_roaming` uzerinden
 * TAHMIN eder ve pos4/pos5 ayrimini cogu zaman yapamaz. Degerlendirme motoru
 * ise pos4 ile pos5'i farkli olcutlerle puanlar. Oyuncunun kendi beyani bu
 * tahminin onune gecer (bkz. resolveEvaluationRole -> source: "manual").
 *
 * GUVENLIK: Kayit anahtari HER ZAMAN oturum cerezindeki account id'dir.
 * Istek govdesinden gelen bir kimlige guvenilmez; boylece kimse baskasinin
 * maclarina rol yazamaz.
 */

import { normalizeRoleKey, toAccountId } from "@dotastat/core";
import { matchRoleStore } from "./store.mjs";

/** Bir oyuncu icin saklanacak en fazla kayit (kotuye kullanimi sinirlar). */
const MAX_ENTRIES_PER_PLAYER = 500;

/**
 * @param {import("@dotastat/core").Player|{ steamId: string, accountId?: string }} session
 * @returns {string}
 */
export function sessionAccountId(session) {
  return String(session?.accountId || toAccountId(session?.steamId) || "");
}

/**
 * @param {string} accountId
 * @returns {Promise<Record<string, string>>}
 */
export async function readMatchRoles(accountId) {
  const key = String(accountId || "");
  if (!key) {
    return {};
  }
  const row = await matchRoleStore().get("roles:" + key);
  const roles = row && typeof row === "object" ? row.roles : null;
  return roles && typeof roles === "object" ? roles : {};
}

/**
 * Tek bir macin rolunu yazar veya siler.
 *
 * @param {string} accountId
 * @param {string} matchId
 * @param {string} role Bos dize verilirse kayit SILINIR (tahmine geri doner)
 * @returns {Promise<{ ok: boolean, error?: string, roles: Record<string, string> }>}
 */
export async function writeMatchRole(accountId, matchId, role) {
  const key = String(accountId || "");
  const match = String(matchId || "").trim();
  if (!key) {
    return { ok: false, error: "oturum-yok", roles: {} };
  }
  if (!/^\d+$/.test(match)) {
    return { ok: false, error: "gecersiz-mac-id", roles: {} };
  }

  const normalized = normalizeRoleKey(role);
  if (role && !normalized) {
    return { ok: false, error: "gecersiz-pozisyon", roles: {} };
  }

  const current = await readMatchRoles(key);
  const next = { ...current };

  if (normalized) {
    next[match] = normalized;
  } else {
    delete next[match];
  }

  const entries = Object.entries(next);
  if (entries.length > MAX_ENTRIES_PER_PLAYER) {
    return { ok: false, error: "cok-fazla-kayit", roles: current };
  }

  await matchRoleStore().set("roles:" + key, {
    roles: next,
    updatedAt: new Date().toISOString(),
  });

  return { ok: true, roles: next };
}
