import { app, BrowserWindow, Rectangle } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

const DEFAULT_STATE: WindowState = {
  width: 1200,
  height: 800,
};

const CONFIG_FILE = 'window-state.json';

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

export function loadWindowState(): WindowState {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const state = JSON.parse(data) as WindowState;

      // Validate the state has reasonable values
      if (state.width >= 900 && state.height >= 600) {
        return state;
      }
    }
  } catch (error) {
    console.error('Failed to load window state:', error);
  }
  return DEFAULT_STATE;
}

export function saveWindowState(window: BrowserWindow): void {
  try {
    const isMaximized = window.isMaximized();
    let bounds: Rectangle;

    // Get bounds before maximized state (restore position if maximized)
    if (isMaximized) {
      // If maximized, don't save bounds - we'll use the previous non-maximized bounds
      const configPath = getConfigPath();
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf-8');
        const existingState = JSON.parse(data) as WindowState;
        bounds = {
          x: existingState.x ?? 0,
          y: existingState.y ?? 0,
          width: existingState.width,
          height: existingState.height,
        };
      } else {
        bounds = window.getBounds();
      }
    } else {
      bounds = window.getBounds();
    }

    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized,
    };

    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Failed to save window state:', error);
  }
}

export function attachWindowStateHandlers(window: BrowserWindow): void {
  // Save window state on close
  window.on('close', () => {
    saveWindowState(window);
  });

  // Also save on resize/move with debounce
  let saveTimeout: NodeJS.Timeout | null = null;

  const debouncedSave = (): void => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveWindowState(window);
    }, 500);
  };

  window.on('resize', debouncedSave);
  window.on('move', debouncedSave);

  // Restore maximized state after window is ready
  const state = loadWindowState();
  if (state.isMaximized) {
    window.once('ready-to-show', () => {
      window.maximize();
    });
  }
}
