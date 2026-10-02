import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Tek bir veri kaynagini yukleyen, istege bagli olarak belirli araliklarla
 * tazeleyen hook.
 *
 * Tazeleme sirasinda eski veri ekranda kalir (`loading` yerine `refreshing`
 * true olur); boylece canli panel her dongude bos ekrana dusmez.
 *
 * @template T
 * @param {() => Promise<T>} loader
 * @param {{ intervalMs?: number, enabled?: boolean, deps?: unknown[] }} [options]
 */
export function useAsyncData(loader, options = {}) {
  const { intervalMs = 0, enabled = true } = options;
  const deps = options.deps || [];

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);
  // Son istegin baslama ani ve suren istek var mi: zamanlayici ve sekmeye
  // donus bunlara bakarak gereksiz (ust uste binen / az once atilmis) istegi
  // atlar. Her istek Netlify'da ayri bir fonksiyon cagrisi.
  const lastRunAtRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * @param {Record<string, unknown>} [runOptions] Loader'a aynen gecirilir.
   *   "Yenile" butonu buradan `{ refresh: true }` gonderir; ilk yukleme ve
   *   zamanlayici bos gecer, boylece onbellek kullanilir.
   */
  const run = useCallback(async (runOptions) => {
    lastRunAtRef.current = Date.now();
    inFlightRef.current = true;
    if (hasDataRef.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      // Tiklama olayinin yanlislikla loader'a gitmesini engelle: yalnizca
      // duz nesneler gecirilir.
      const safeOptions =
        runOptions && typeof runOptions === "object" && !runOptions.nativeEvent
          ? runOptions
          : undefined;
      const result = await loaderRef.current(safeOptions);
      if (!mountedRef.current) {
        return { ok: true, data: result, error: null };
      }
      setData(result);
      hasDataRef.current = true;
      setError(null);
      // Sonuc DONDURULUR: cagiran taraf hatayi kendi ele almak isteyebilir
      // (ornek: hiz siniri uyarisini butonun yanina yazmak). Hook yine de
      // `error` durumunu tutar, iki kullanim birbirini engellemez.
      return { ok: true, data: result, error: null };
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught);
      }
      return { ok: false, data: null, error: caught };
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  // Zamanlayici AYRI kurulur: aralik degistiginde (ornek: canli mac basladi,
  // 30 sn -> 5 sn) yalnizca zamanlayici yenilenir. Hemen istek atilmaz, cunku
  // araligi degistiren sey zaten az once gelen yanittir; tekrar istemek ayni
  // cevabi ikinci kez almak olurdu.
  useEffect(() => {
    if (!enabled || !intervalMs) {
      return undefined;
    }

    // Sekme arka plandayken istek atmayiz. Onceki istek hala suruyorsa (yavas
    // ag) ikincisi ust uste binmez; elle tazeleme (`reload`) bundan etkilenmez.
    // Biraz pay birakilir: zamanlayici tam aralikta tetiklendiginde onceki
    // istegin baslangici aralik kadar once olmayabilir.
    const due = (minGapMs) =>
      document.visibilityState === "visible" &&
      !inFlightRef.current &&
      Date.now() - lastRunAtRef.current >= minGapMs;

    const timer = setInterval(() => {
      if (due(intervalMs / 2)) {
        run();
      }
    }, intervalMs);

    // Sekmeye donuldugunde veri yalnizca bir aralik kadar eskidiyse tazelenir;
    // sekmeler arasinda gidip gelmek her seferinde istek uretmesin.
    const onVisible = () => {
      if (due(intervalMs)) {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs, run]);

  return { data, error, loading, refreshing, reload: run };
}
