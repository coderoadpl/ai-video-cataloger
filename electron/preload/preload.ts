import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// IPC without exposing the entire electron API
const electronAPI = {
  // Platform information
  platform: process.platform,

  // Window controls
  closeWindow: (): void => {
    ipcRenderer.send('window:close');
  },
  minimizeWindow: (): void => {
    ipcRenderer.send('window:minimize');
  },
  maximizeWindow: (): void => {
    ipcRenderer.send('window:maximize');
  },

  // App info
  getAppVersion: (): Promise<string> => {
    return ipcRenderer.invoke('app:getVersion');
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declarations for the exposed API
export type ElectronAPI = typeof electronAPI;
