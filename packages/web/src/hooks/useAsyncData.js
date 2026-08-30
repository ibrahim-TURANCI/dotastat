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
    if (!intervalMs) {
      return undefined;
    }

    const timer = setInterval(() => {
      // Sekme arka plandayken istek atmayiz; kullanici donunce hemen tazelenir.
      if (document.visibilityState === "visible") {
        run();
      }
    }, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, run, ...deps]);

  return { data, error, loading, refreshing, reload: run };
}
