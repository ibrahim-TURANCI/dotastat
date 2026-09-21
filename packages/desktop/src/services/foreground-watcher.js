/**
 * On plandaki pencerenin surec adini izler (yalnizca Windows).
 *
 * NEDEN: Oyun ici overlay her zaman ustte duran bir penceredir. Yalnizca
 * "mac suruyor" diye gosterilseydi kullanici alt-tab yapip tarayiciya
 * gectiginde de ekranin kosesinde kalirdi. Discord'un overlay'i gibi yalnizca
 * oyun on plandayken gorunmesi icin hangi pencerenin odakta oldugunu bilmek
 * gerekiyor.
 *
 * NASIL: Yerel modul (ffi, node-gyp) eklememek icin tek bir uzun omurlu
 * PowerShell sureci acilir; saniyede bir GetForegroundWindow ile odaktaki
 * surecin adini stdout'a yazar. Surec olurse birkac kez yeniden baslatilir,
 * sonra vazgecilir ve `current()` `null` doner: bu "bilinmiyor" demektir ve
 * cagiran taraf overlay'i yine de gosterebilir.
 */

const { spawn } = require("node:child_process");

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DsForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
while ($true) {
  $procId = 0
  [void][DsForeground]::GetWindowThreadProcessId([DsForeground]::GetForegroundWindow(), [ref]$procId)
  $name = ''
  if ($procId -gt 0) { $name = (Get-Process -Id $procId).ProcessName }
  [Console]::Out.WriteLine($name)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 800
}
`;

/** Ust uste bu kadar cokerse izleme birakilir. */
const MAX_RESTARTS = 5;

/**
 * @param {{ logger?: { info: Function, warn: Function } }} [options]
 */
function createForegroundWatcher(options = {}) {
  const logger = options.logger || console;

  /** @type {import("node:child_process").ChildProcess|null} */
  let child = null;
  /** @type {string|null} */
  let current = null;
  let restarts = 0;
  let stopped = true;

  function launch() {
    if (stopped || process.platform !== "win32") {
      return;
    }

    child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        // Base64 UTF-16LE: cok satirli betigi kacislamadan gecirmenin
        // PowerShell'in resmi yolu.
        "-EncodedCommand",
        Buffer.from(SCRIPT, "utf16le").toString("base64"),
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
    );

    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      if (lines.length) {
        current = lines[lines.length - 1].trim();
        restarts = 0;
      }
    });

    child.on("error", (error) => {
      logger.warn?.(
        "On plan izleyicisi baslatilamadi",
        String(error?.message || error),
      );
    });

    child.on("exit", () => {
      child = null;
      current = null;
      if (stopped) {
        return;
      }
      restarts += 1;
      if (restarts > MAX_RESTARTS) {
        logger.warn?.("On plan izleyicisi birakildi (surekli kapaniyor)");
        return;
      }
      setTimeout(launch, 3000 * restarts);
    });
  }

  return {
    start() {
      if (!stopped) {
        return;
      }
      stopped = false;
      restarts = 0;
      launch();
    },

    stop() {
      stopped = true;
      child?.kill();
      child = null;
      current = null;
    },

    /**
     * Odaktaki surecin adi (ornek: "dota2"). Bilinmiyorsa `null`.
     * @returns {string|null}
     */
    current() {
      return current;
    },
  };
}

module.exports = { createForegroundWatcher };
