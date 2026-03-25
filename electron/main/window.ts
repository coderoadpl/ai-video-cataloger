/**
 * Window Management
 */
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

const store = new Store<{ windowState: WindowState }>();

let mainWindow: BrowserWindow | null = null;

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function restoreWindowState(): WindowState {
  const defaultState: WindowState = {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };

  const savedState = store.get('windowState', defaultState);

  // Verify the window is within screen bounds
  const displays = screen.getAllDisplays();
  const isWithinBounds = displays.some((display) => {
    const { x, y, width, height } = display.bounds;
    return (
      savedState.x !== undefined &&
      savedState.y !== undefined &&
      savedState.x >= x &&
      savedState.y >= y &&
      savedState.x + savedState.width <= x + width &&
      savedState.y + savedState.height <= y + height
    );
  });

  if (!isWithinBounds) {
    // Reset position if window is outside screen bounds
    return {
      width: savedState.width,
      height: savedState.height,
    };
  }

  return savedState;
}

export function saveWindowState(win: BrowserWindow): void {
  const bounds = win.getBounds();
  const isMaximized = win.isMaximized();

  store.set('windowState', {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  });
}

export async function createWindow(): Promise<BrowserWindow> {
  const windowState = restoreWindowState();

  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    titleBarStyle: 'default', // Use default macOS title bar with traffic lights
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Needed for some IPC operations
    },
  });

  // Restore maximized state
  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  // Show window when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Save window state on close
  mainWindow.on('close', () => {
    if (mainWindow) {
      saveWindowState(mainWindow);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    // In development, load from Vite dev server
    const port = process.env.VITE_DEV_SERVER_PORT || 5173;
    await mainWindow.loadURL(`http://localhost:${port}`);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built renderer
    await mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  return mainWindow;
}
