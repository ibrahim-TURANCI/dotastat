/**
 * Istegi yapanin kimligi: site oturumu YA DA masaustu cihaz anahtari.
 *
 * NEDEN CIHAZ ANAHTARI: masaustu uygulamasi kullaniciyi zaten oyundan (GSI)
 * taniyor, ama siteye veri gonderebilmek icin ayrica Steam ile giris
 * gerekiyordu. Steam bu girisi, istegin IP'si ile telefondaki Steam
 * uygulamasinin konumu farkli sehirlerde gorundugunde "kotu niyetli giris"
 * diye ENGELLIYOR (ISP IP'si baska ile cikan kullanicilar hic giremiyordu).
 *
 * Cihaz anahtari: masaustu uygulamasi ilk acilista rastgele bir anahtar
 * uretir ve her istekte SteamID'siyle birlikte gonderir. Sunucu anahtarin
 * OZETINI hesaba ilk kullanimda baglar (trust on first use); sonraki
 * isteklerde ayni anahtar beklenir. Boylece kimse paylasilan bir sir
 * olmadan ve baskasinin hesabina bagli bir cihaz olmadan o hesap adina veri
 * gonderemez.
 *
 * SINIRLAR:
 *   - Yalnizca KADRODAKI hesaplar cihaz baglayabilir (kadro statik bir
 *     listedir; disaridan gelen biri bos bir hesaba cihaz baglayamaz).
 *   - Bir hesaba ilk cihaz serbestce baglanir. Ikinci bir cihaz (ya da
 *     anahtari kaybolmus bir kurulum) ancak site oturumuyla baglanir:
 *     oturum + cihaz basliklari birlikte gelirse cihaz hesaba eklenir.
 *   - Kadrodaki bir hesap henuz hic cihaz baglamadiysa, SteamID'sini bilen
 *     biri ilk baglamayi yapabilir. Bu, giris sartini kaldirmanin bedelidir;
 *     baglanti kayitlarini sifirlamak icin `device:<accountId>` anahtari
 *     silinir.
 */

import crypto from "node:crypto";
import { findRosterPlayer, toAccountId } from "@dotastat/core";
import { readSession } from "./session.mjs";
import { deviceStore } from "./store.mjs";

/** Masaustu istemcisinin gonderdigi basliklar. */
export const DEVICE_KEY_HEADER = "x-dotastat-device";
export const DEVICE_STEAM_HEADER = "x-dotastat-steam";

/** Bir hesaba baglanabilecek en fazla cihaz. */
const MAX_DEVICES = 3;

/**
 * @param {string} key
 * @returns {string}
 */
function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("base64url");
}

/**
 * Istekteki cihaz basliklari (bicimi gecerliyse).
 * @param {Request} request
 * @returns {{ steamId: string, accountId: string, key: string }|null}
 */
function readDeviceHeaders(request) {
  const steamId = String(request.headers.get(DEVICE_STEAM_HEADER) || "").trim();
  const key = String(request.headers.get(DEVICE_KEY_HEADER) || "").trim();
  if (!/^\d{17}$/.test(steamId) || !/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
    return null;
  }
  const accountId = toAccountId(steamId);
  return accountId ? { steamId, accountId, key } : null;
}

/**
 * @param {string} accountId
 * @returns {Promise<string[]>} bagli cihaz anahtarlarinin ozetleri
 */
async function boundHashes(accountId) {
  const row = await deviceStore().get("device:" + accountId);
  return Array.isArray(row?.hashes) ? row.hashes : [];
}

/**
 * @param {string} accountId
 * @param {string[]} hashes
 */
async function saveHashes(accountId, hashes) {
  await deviceStore().set("device:" + accountId, {
    hashes: hashes.slice(-MAX_DEVICES),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * @typedef {Object} Identity
 * @property {string} steamId
 * @property {string} accountId
 * @property {"session"|"device"} via
 */

/**
 * Istegi yapanin dogrulanmis kimligi.
 *
 * Basarisizsa `error` doner: `"kimlik-yok"` hic kimlik gelmedi,
 * `"cihaz-eslesmedi"` hesap baska bir cihaza bagli, `"kadroda-degil"`
 * cihaz baglanamayan bir hesap.
 *
 * @param {Request} request
 * @returns {Promise<{ identity: Identity|null, error: string }>}
 */
export async function readIdentity(request) {
  const session = readSession(request);
  const device = readDeviceHeaders(request);

  if (session) {
    const accountId = String(
      session.accountId || toAccountId(session.steamId) || "",
    );
    // Oturum + cihaz ayni hesaptan geliyorsa cihaz hesaba baglanir: ikinci
    // bilgisayar ya da anahtari sifirlanmis kurulum boyle eklenir.
    if (device && device.accountId === accountId) {
      try {
        const hashes = await boundHashes(accountId);
        const hash = hashKey(device.key);
        if (!hashes.includes(hash)) {
          await saveHashes(accountId, [...hashes, hash]);
        }
      } catch {
        // Baglanamazsa oturum yine gecerli.
      }
    }
    return {
      identity: { steamId: String(session.steamId), accountId, via: "session" },
      error: "",
    };
  }

  if (!device) {
    return { identity: null, error: "kimlik-yok" };
  }
  if (!findRosterPlayer(device.accountId)) {
    return { identity: null, error: "kadroda-degil" };
  }

  const hash = hashKey(device.key);
  const hashes = await boundHashes(device.accountId);
  if (!hashes.length) {
    // Ilk kullanim: cihaz hesaba baglanir.
    await saveHashes(device.accountId, [hash]);
  } else if (!hashes.includes(hash)) {
    return { identity: null, error: "cihaz-eslesmedi" };
  }

  return {
    identity: {
      steamId: device.steamId,
      accountId: device.accountId,
      via: "device",
    },
    error: "",
  };
}

/** Kimlik hatalarinin kullaniciya gosterilecek karsiligi. */
export const IDENTITY_MESSAGES = {
  "kimlik-yok":
    "Masaüstü uygulaması kimliği gönderemedi; Dota'yı bir kez açıp maça girmelisin.",
  "kadroda-degil": "Bu hesap kadroda değil.",
  "cihaz-eslesmedi":
    "Bu hesap başka bir bilgisayara bağlı. Bu bilgisayarı eklemek için uygulamadan bir kez Steam ile giriş yap.",
};
