/// <reference types="vite/client" />

interface ElectronAPI {
  platform: NodeJS.Platform;
  closeWindow: () => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  getAppVersion: () => Promise<string>;
}

interface Window {
  electronAPI: ElectronAPI;
}
