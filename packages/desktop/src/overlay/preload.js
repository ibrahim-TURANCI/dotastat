/**
 * Overlay penceresinin preload betigi: yalnizca guncelleme dinleyicisi acilir.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  /** @param {(state: Record<string, any>) => void} handler */
  onUpdate(handler) {
    ipcRenderer.on("overlay:update", (_event, state) => handler(state));
  },
});
