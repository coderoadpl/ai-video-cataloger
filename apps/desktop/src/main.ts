import path from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog, nativeTheme, session } from 'electron';

import { derivedFolderId } from '@core/domain/index.js';
import type { App } from '@server/src/create-app.js';

import { resolveDesktopAppVersion } from './app-version.js';
import { CHANNELS } from './channels.js';
import { cspHeaders } from './csp.js';
import { createDesktopApp } from './composition.js';
import { folderStorePath, FolderStore } from './folder-store.js';
import { FolderWatchController } from './folder-watch.js';
import { buildDesktopPath, userDataDirectoryOverride } from './environment.js';
import { cleanupIpcHandlers, registerIpcHandlers } from './ipc.js';
import { createApplicationMenu } from './menu.js';
import { registerMediaProtocolHandler, registerMediaScheme } from './media-protocol.js';
import { catalogMediaRoots } from './media-scope.js';
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
let folderWatch: FolderWatchController | null = null;
let quitting = false;

let resolveRendererReady!: () => void;
const rendererReady = new Promise<void>((resolve) => {
  resolveRendererReady = resolve;
});

const COMPOSITION_DEFER_FALLBACK_MS = 3000;

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
    minWidth: 1280,
    minHeight: 600,
    show: true,
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
  if (windowState.isMaximized === true) mainWindow.maximize();
  logWindowVisible();
  mainWindow.once('ready-to-show', logFirstPaint);
  mainWindow.webContents.once('did-finish-load', resolveRendererReady);
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

const startupTimestampMs = (): number => Math.round(process.uptime() * 1000);

const logWindowVisible = (): void => {
  if (process.env.AVC_DEBUG_STARTUP !== '1') return;
  console.log(`[startup] window visible ${startupTimestampMs()}ms after process start`);
};

const logFirstPaint = (): void => {
  if (process.env.AVC_DEBUG_STARTUP !== '1') return;
  console.log(`[startup] first paint ${startupTimestampMs()}ms after process start`);
};

const surfaceCompositionFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox('AI Video Cataloger failed to start', `The catalog could not be initialized.\n\n${message}`);
};

// Search renders mirrored thumbnails of folders that are not the open one, so the mirror ids of
// every catalogued folder stay readable; a folder opened before its first index pass is not in the
// catalog yet and carries its own id.
const mirrorFolderIds = async (
  desktopAppReady: Promise<App>,
  currentFolder: string | null,
): Promise<string[]> => {
  const catalogFolders = await desktopAppReady.then((ready) => ready.catalogFolderPaths()).catch(() => []);
  const folders = currentFolder === null ? catalogFolders : [currentFolder, ...catalogFolders];
  return folders.map((folder) => derivedFolderId(path.resolve(folder)));
};

const bootstrap = async (): Promise<void> => {
  if (!isDevelopment()) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = cspHeaders(details.responseHeaders ?? {});
      const responseHeaders: Record<string, string[]> = {};
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) responseHeaders[name] = value;
      }
      callback({ responseHeaders });
    });
  }

  const appVersion = resolveDesktopAppVersion({
    isPackaged: app.isPackaged,
    packagedVersion: app.getVersion(),
  });
  folderStore = new FolderStore(folderStorePath(app.getPath('userData')));

  let resolveDesktopApp!: (value: App) => void;
  let rejectDesktopApp!: (reason: unknown) => void;
  const desktopAppReady = new Promise<App>((resolve, reject) => {
    resolveDesktopApp = resolve;
    rejectDesktopApp = reject;
  });
  void desktopAppReady.catch(surfaceCompositionFailure);

  const currentFolder = (): Promise<string | null> =>
    folderStore === null ? Promise.resolve(null) : folderStore.getCurrent();

  registerMediaProtocolHandler({
    getCurrentFolder: currentFolder,
    getCatalogMediaRoots: async () =>
      catalogMediaRoots(
        homedir(),
        await mirrorFolderIds(desktopAppReady, await currentFolder()),
        await desktopAppReady.then((ready) => ready.catalogFolderPaths()).catch(() => []),
      ),
  });

  folderWatch = new FolderWatchController({
    desktopApp: desktopAppReady,
    notify: (folderPath) => {
      if (mainWindow === null || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(CHANNELS.folderChanged, folderPath);
    },
  });

  registerIpcHandlers({
    desktopApp: desktopAppReady,
    appVersion,
    folderStore,
    folderWatch,
    getMainWindow: () => mainWindow,
  });

  await createWindow();
  await Promise.race([rendererReady, sleep(COMPOSITION_DEFER_FALLBACK_MS)]);

  const startupFolder = await folderStore.getCurrent();
  if (startupFolder !== null) void folderWatch.watch(startupFolder);

  setImmediate(() => {
    if (quitting) return;
    void createDesktopApp({ version: appVersion, isPackaged: app.isPackaged }).then((created) => {
      desktopApp = created;
      resolveDesktopApp(created);
    }, rejectDesktopApp);
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
  folderWatch?.stop();
  if (desktopApp !== null) void desktopApp.dispose();
});

void app.whenReady().then(bootstrap);
