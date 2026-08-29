/**
 * Steam OpenID 2.0 ile giris.
 *
 * "Sign in through Steam" akisi API anahtari GEREKTIRMEZ:
 *   1. Kullanici Steam'in login sayfasina yonlendirilir.
 *   2. Steam, return_to adresine `openid.*` parametreleriyle geri doner.
 *   3. Gelen parametreler Steam'e geri POST edilerek dogrulanir
 *      (`openid.mode=check_authentication` -> `is_valid:true`).
 *   4. `openid.claimed_id` icinden SteamID64 cikarilir.
 *
 * 3. adim ATLANAMAZ; aksi halde herkes uydurdugu bir claimed_id ile
 * baskasinin kimligiyle giris yapabilirdi.
 */

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const OPENID_IDENTIFIER_SELECT =
  "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID_PATTERN =
  /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const VERIFY_TIMEOUT_MS = 10000;

/**
 * Steam'e yonlendirilecek login URL'ini uretir.
 * @param {{ returnTo: string, realm: string }} options
 * @returns {string}
 */
export function buildLoginUrl(options) {
  const returnTo = String(options?.returnTo || "").trim();
  const realm = String(options?.realm || "").trim();
  if (!returnTo || !realm) {
    throw new Error("return-to-ve-realm-zorunlu");
  }

  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": OPENID_IDENTIFIER_SELECT,
    "openid.claimed_id": OPENID_IDENTIFIER_SELECT,
  });

  return STEAM_OPENID_ENDPOINT + "?" + params.toString();
}

/**
 * Steam'den donen sorgu parametrelerini dogrular.
 * @param {URLSearchParams} query
 * @returns {Promise<{ ok: boolean, steamId?: string, error?: string }>}
 */
export async function verifyAssertion(query) {
  if (String(query.get("openid.mode") || "") !== "id_res") {
    return { ok: false, error: "gecersiz-openid-mode" };
  }

  const claimedId = String(query.get("openid.claimed_id") || "");
  const match = CLAIMED_ID_PATTERN.exec(claimedId);
  if (!match) {
    return { ok: false, error: "gecersiz-claimed-id" };
  }

  // Gelen tum openid.* alanlari aynen geri gonderilir; sadece mode degisir.
  const params = new URLSearchParams();
  for (const [key, value] of query.entries()) {
    if (key.startsWith("openid.")) {
      params.append(key, value);
    }
  }
  params.set("openid.mode", "check_authentication");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  let text = "";
  try {
    const response = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: "steam-" + response.status };
    }
    text = await response.text();
  } catch (error) {
    return { ok: false, error: "steam-dogrulama-hatasi" };
  } finally {
    clearTimeout(timer);
  }

  if (!/is_valid\s*:\s*true/i.test(text)) {
    return { ok: false, error: "dogrulama-basarisiz" };
  }

  return { ok: true, steamId: match[1] };
}

export { STEAM_OPENID_ENDPOINT };
