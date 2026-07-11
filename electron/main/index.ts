import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIPCHandlers, cleanupIPCHandlers } from './ipc-handlers.js';
import { registerMediaScheme, registerMediaProtocolHandler } from './media-protocol.js';
import { loadWindowState, attachWindowStateHandlers } from './window-state.js';
import { createApplicationMenu, updateRecentFoldersMenu } from './menu.js';
import { getRecentFolders } from './folder-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.getName());
}

// Register the media: scheme as privileged (must happen before app.whenReady)
registerMediaScheme();

let mainWindow: BrowserWindow | null = null;

// NODE_ENV=production forces the built-renderer path even when unpackaged
// (used by the Playwright GUI e2e harness and for verifying a local build).
const isDev =
  process.env.NODE_ENV !== 'production' &&
  (process.env.NODE_ENV === 'development' || !app.isPackaged);

function createWindow(): void {
  const preloadPath = isDev
    ? path.join(__dirname, '../preload/preload.js')
    : path.join(__dirname, '../preload/preload.js');

  // Load saved window state
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'default',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for CommonJS preload to work with "type": "module" parent
    },
  });

  // Attach window state handlers for persistence
  attachWindowStateHandlers(mainWindow);

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load the renderer
  if (isDev) {
    // In development, load from Vite dev server
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:9473';
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from the built files. AVC_RENDERER_HTML lets the e2e
    // harness point at the Vite build output without a packaging step.
    const rendererHtml =
      process.env.AVC_RENDERER_HTML ||
      path.join(__dirname, '../renderer/index.html');
    mainWindow.loadFile(rendererHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create the application menu
  createApplicationMenu(mainWindow);

  // Update the recent folders menu with saved folders
  const recentFolders = getRecentFolders();
  if (recentFolders.length > 0) {
    updateRecentFoldersMenu(mainWindow, recentFolders);
  }
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create a window when dock icon clicked and no other windows open
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Register IPC handlers before creating the window
registerIPCHandlers();

app.whenReady().then(() => {
  registerMediaProtocolHandler();
  createWindow();
});

// Cleanup on quit
app.on('before-quit', () => {
  cleanupIPCHandlers();
});
