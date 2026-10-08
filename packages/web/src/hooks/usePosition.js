import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

/** Gecerli pozisyon anahtarlari. */
const ROLES = ["pos1", "pos2", "pos3", "pos4", "pos5"];

/** @param {unknown} value */
const validRole = (value) =>
  ROLES.includes(String(value || "")) ? String(value) : "";

/**
 * Kullanicinin sectigi pozisyon ("pos1".."pos5"; bos = secilmedi).
 *
 * NEREDE TUTULUR
 *   - Masaustu: uygulama ayarlarinda (bkz. desktop app.js -> /api/me/position).
 *     Canli mac yayiniyla siteye de gider; arkadaslar bu oyuncunun rolunu
 *     gorur. Oyun ici overlay da ayni ayari okur.
 *   - Site: tarayicida, hesaba ozel anahtarla. Canli mac isteginde `myRole`
 *     olarak gider (bkz. api.live).
 *
 * Ayni pozisyona yeniden basmak secimi kaldirir.
 *
 * @param {{ user: Record<string, any>|null, mode: string }} session
 * @returns {{ value: string, choose: (role: string) => Promise<void>, saving: boolean }}
 */
export function usePosition(session) {
  const steamId = String(session.user?.steamId || "");
  const desktop = session.mode === "desktop";
  const storageKey = steamId ? "dotastat:position:" + steamId : "";
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Baslangic degeri: masaustunde oturum yanitindan, sitede tarayicidan.
  useEffect(() => {
    if (!steamId) {
      setValue("");
      return;
    }
    if (desktop) {
      setValue(validRole(session.user?.position));
      return;
    }
    try {
      setValue(validRole(window.localStorage.getItem(storageKey)));
    } catch {
      setValue("");
    }
  }, [steamId, desktop, storageKey, session.user?.position]);

  const choose = useCallback(
    async (role) => {
      const next = role === value ? "" : validRole(role);
      if (desktop) {
        // Ayar yazildiktan SONRA guncellenir: canli mac istegi yeni degerle
        // tekrarlanacak ve yerel sunucu ayari okuyor.
        setSaving(true);
        try {
          const response = await api.setPosition(next);
          setValue(validRole(response?.position));
        } catch {
          // Yazilamadiysa secim degismez.
        } finally {
          setSaving(false);
        }
        return;
      }
      setValue(next);
      try {
        if (next) {
          window.localStorage.setItem(storageKey, next);
        } else {
          window.localStorage.removeItem(storageKey);
        }
      } catch {
        // Tarayici depolamasi kapaliysa secim bu sekmede gecerli kalir.
      }
    },
    [value, desktop, storageKey],
  );

  return { value, choose, saving };
}
