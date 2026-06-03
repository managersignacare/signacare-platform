/**
 * Signacare EMR — Electron Preload Script
 *
 * Exposes safe APIs to the renderer process.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isStandalone: true,
  getVersion: () => ipcRenderer.invoke('get-version'),
})
