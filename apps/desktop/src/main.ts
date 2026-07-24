import path from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog, nativeTheme } from 'electron';

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

if (process.platform === 'darwin' && !app.isPackaged) {
  app.dock?.setIcon(path.join(currentDirectory, '..', 'build', 'icon.png'));
}

registerMediaScheme();

let mainWindow: BrowserWindow | null = null;
let desktopApp: App | null = null;
let folderStore: FolderStore | null = null;
let quitting = false;

let resolveFirstWindowShown!: () => void;
const firstWindowShown = new Promise<void>((resolve) => {
  resolveFirstWindowShown = resolve;
});

const WINDOW_SHOWN_FALLBACK_MS = 3000;

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
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
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    logWindowShown();
    resolveFirstWindowShown();
  });
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

const logWindowShown = (): void => {
  if (process.env.AVC_DEBUG_STARTUP !== '1') return;
  console.log(`[startup] window shown ${Math.round(process.uptime() * 1000)}ms after process start`);
};

const surfaceCompositionFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox('AI Video Cataloger failed to start', `The catalog could not be initialized.\n\n${message}`);
};

const bootstrap = async (): Promise<void> => {
  const appVersion = resolveDesktopAppVersion({
    isPackaged: app.isPackaged,
    packagedVersion: app.getVersion(),
  });
  folderStore = new FolderStore(folderStorePath(app.getPath('userData')));
  registerMediaProtocolHandler({
    getCurrentFolder: () => {
      if (folderStore === null) return Promise.resolve(null);
      return folderStore.getCurrent();
    },
    getFacesRoot: () => Promise.resolve(path.join(homedir(), '.ai-video-cataloger', 'faces')),
  });

  let resolveDesktopApp!: (value: App) => void;
  let rejectDesktopApp!: (reason: unknown) => void;
  const desktopAppReady = new Promise<App>((resolve, reject) => {
    resolveDesktopApp = resolve;
    rejectDesktopApp = reject;
  });
  void desktopAppReady.catch(surfaceCompositionFailure);

  registerIpcHandlers({
    desktopApp: desktopAppReady,
    appVersion,
    folderStore,
    getMainWindow: () => mainWindow,
  });

  await createWindow();
  await Promise.race([firstWindowShown, sleep(WINDOW_SHOWN_FALLBACK_MS)]);

  setImmediate(() => {
    if (quitting) return;
    try {
      desktopApp = createDesktopApp({ version: appVersion });
      resolveDesktopApp(desktopApp);
    } catch (error) {
      rejectDesktopApp(error);
    }
  });
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('before-quit', () => {
  quitting = true;
  cleanupIpcHandlers();
  if (desktopApp !== null) void desktopApp.dispose();
});

void app.whenReady().then(bootstrap);
