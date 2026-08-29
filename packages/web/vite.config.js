import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Web arayuzunun Vite yapilandirmasi.
 *
 * - `@dotastat/core` bir workspace paketidir ve derlenmemis ES modulu olarak
 *   gelir; on-bundle disinda tutulur ki kaynak degisince aninda yansisin.
 * - Gelistirmede `/api` istekleri Netlify Functions'a (netlify dev, 8888) ya
 *   da masaustu sunucusuna (3044) yonlendirilir.
 */
export default defineConfig(({ mode }) => {
  const apiTarget =
    process.env.VITE_API_PROXY ||
    (mode === "desktop" ? "http://127.0.0.1:3044" : "http://127.0.0.1:8888");

  return {
    plugins: [react()],
    server: {
      port: 3045,
      strictPort: false,
      // Steam OpenID "localhost" realm'ini reddediyor (Akamai 403), bu yuzden
      // yerelde `lvh.me` (-> 127.0.0.1) uzerinden calisiyoruz. Vite bilinmeyen
      // Host basliklarini blokladigi icin bu adi acikca izin listesine aliyoruz.
      allowedHosts: ["lvh.me", ".lvh.me"],
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
      },
    },
    preview: {
      port: 3045,
    },
    optimizeDeps: {
      exclude: ["@dotastat/core"],
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
