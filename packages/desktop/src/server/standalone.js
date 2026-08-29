/**
 * Electron olmadan yalnizca sunucuyu calistirir.
 *
 * Gelistirme sirasinda ise yarar: `npm run serve` ile 3044 portunu ayaga
 * kaldirir, arayuzu ayri bir Vite sunucusundan (3045) acabilirsin.
 *
 *   npm run serve --workspace ... yerine:
 *   npm --prefix packages/desktop run serve
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startServer } = require("./index.js");

const desktopRoot = path.resolve(__dirname, "..", "..");

const userDataDir =
  process.env.DOTASTAT_DATA_DIR || path.join(os.homedir(), ".dotastat");

const packagedWeb = path.join(desktopRoot, "web");
const devWeb = path.resolve(desktopRoot, "..", "web", "dist");
const webDir = fs.existsSync(path.join(packagedWeb, "index.html"))
  ? packagedWeb
  : fs.existsSync(path.join(devWeb, "index.html"))
    ? devWeb
    : "";

startServer({ userDataDir, webDir, version: "dev" })
  .then((server) => {
    console.log("DotaStat sunucusu: " + server.url);
    console.log("GSI ucu           : " + server.url + "/gsi");
    if (!webDir) {
      console.log(
        "Arayuz derlenmemis. `npm run build:web` calistir veya Vite'i ayri ac.",
      );
    }
  })
  .catch((error) => {
    console.error("Sunucu baslatilamadi:", error);
    process.exit(1);
  });
