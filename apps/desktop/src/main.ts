import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow } from 'electron';

import type { App } from '@server/src/create-app.js';

import { resolveDesktopAppVersion } from './app-version.js';
import { createDesktopApp } from './composition.js';
import { folderStorePath, FolderStore } from './folder-store.js';
import { buildDesktopPath, userDataDirectoryOverride } from './environment.js';
import { cleanupIpcHandlers, registerIpcHandlers } from './ipc.js';
import { createApplicationMenu } from './menu.js';
import { registerMediaProtocolHandler, registerMediaScheme } from './media-protocol.js';
import { attachWindowStateHandlers, loadWindowState, windowStatePath } from './window-state.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);

if (process.platform === 'win32') app.setAppUserModelId(app.getName());

const userDataDirectory = userDataDirectoryOverride(process.argv, app.isPackaged);
if (userDataDirectory !== null) {
  app.setPath('userData', userDataDirectory);
}

process.env.PATH = buildDesktopPath(process.env.PATH);

registerMediaScheme();

let mainWindow: BrowserWindow | null = null;
let desktopApp: App | null = null;
let folderStore: FolderStore | null = null;

const isDevelopment = (): boolean =>
  process.env.NODE_ENV !== 'production' && (process.env.NODE_ENV === 'development' || !app.isPackaged);

const createWindow = async (): Promise<void> => {
  if (folderStore === null) throw new Error('Folder store has not been initialized');
  const statePath = windowStatePath(app.getPath('userData'));
  const windowState = await loadWindowState(statePath);

  mainWindow = new BrowserWindow({
    ...(windowState.x === undefined ? {} : { x: windowState.x }),
    ...(windowState.y === undefined ? {} : { y: windowState.y }),
    width: windowState.width,
    height: windowState.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  attachWindowStateHandlers(statePath, mainWindow);
  if (windowState.isMaximized === true) {
    mainWindow.once('ready-to-show', () => mainWindow?.maximize());
  }
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createApplicationMenu(mainWindow, await folderStore.getRecent());
  await loadRenderer(mainWindow);
};

const loadRenderer = async (window: BrowserWindow): Promise<void> => {
  if (isDevelopment()) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:9473');
    window.webContents.openDevTools();
    return;
  }
  if (process.env.AVC_RENDERER_HTML !== undefined) {
    await window.loadFile(process.env.AVC_RENDERER_HTML);
    return;
  }
  await window.loadFile(path.join(currentDirectory, '..', 'dist', 'web', 'index.html'));
};

const bootstrap = async (): Promise<void> => {
  const appVersion = resolveDesktopAppVersion({
    isPackaged: app.isPackaged,
    packagedVersion: app.getVersion(),
  });
  desktopApp = createDesktopApp({ version: appVersion });
  folderStore = new FolderStore(folderStorePath(app.getPath('userData')));
  registerIpcHandlers({
    desktopApp,
    appVersion,
    folderStore,
    getMainWindow: () => mainWindow,
  });
  registerMediaProtocolHandler({
    getCurrentFolder: () => {
      if (folderStore === null) return Promise.resolve(null);
      return folderStore.getCurrent();
    },
    getFacesRoot: () => Promise.resolve(path.join(homedir(), '.ai-video-cataloger', 'faces')),
  });
  await createWindow();
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('before-quit', () => {
  cleanupIpcHandlers();
  if (desktopApp !== null) void desktopApp.dispose();
});

void app.whenReady().then(bootstrap);
