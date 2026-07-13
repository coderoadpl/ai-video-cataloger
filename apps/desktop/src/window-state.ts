import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { BrowserWindow, Rectangle } from 'electron';
import { z } from 'zod';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1200,
  height: 800,
};

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

const persistedWindowStateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  isMaximized: z.boolean().optional(),
});

export const windowStatePath = (userDataPath: string): string => path.join(userDataPath, 'window-state.json');

export const normalizeWindowState = (state: WindowState): WindowState => ({
  ...(state.x === undefined ? {} : { x: state.x }),
  ...(state.y === undefined ? {} : { y: state.y }),
  width: Math.max(MIN_WIDTH, state.width),
  height: Math.max(MIN_HEIGHT, state.height),
  ...(state.isMaximized === undefined ? {} : { isMaximized: state.isMaximized }),
});

export const loadWindowState = async (statePath: string): Promise<WindowState> => {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = persistedWindowStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? normalizeWindowState(toWindowState(parsed.data)) : DEFAULT_WINDOW_STATE;
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
};

export const saveWindowState = async (
  statePath: string,
  state: WindowState,
): Promise<void> => {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(normalizeWindowState(state), null, 2), 'utf8');
};

export const windowStateFromBounds = (bounds: Rectangle, isMaximized: boolean): WindowState => ({
  x: bounds.x,
  y: bounds.y,
  width: bounds.width,
  height: bounds.height,
  isMaximized,
});

export const persistBrowserWindowState = async (
  statePath: string,
  window: BrowserWindow,
): Promise<void> => {
  const isMaximized = window.isMaximized();
  const previousState = isMaximized ? await loadWindowState(statePath) : null;
  const bounds = previousState === null ? window.getBounds() : previousBounds(previousState, window.getBounds());
  await saveWindowState(statePath, windowStateFromBounds(bounds, isMaximized));
};

export const attachWindowStateHandlers = (statePath: string, window: BrowserWindow): void => {
  let saveTimeout: NodeJS.Timeout | null = null;
  const save = (): void => {
    void persistBrowserWindowState(statePath, window);
  };
  const debouncedSave = (): void => {
    if (saveTimeout !== null) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(save, 500);
  };
  window.on('close', save);
  window.on('resize', debouncedSave);
  window.on('move', debouncedSave);
};

const previousBounds = (state: WindowState, fallback: Rectangle): Rectangle => ({
  x: state.x ?? fallback.x,
  y: state.y ?? fallback.y,
  width: state.width,
  height: state.height,
});

const toWindowState = (state: z.output<typeof persistedWindowStateSchema>): WindowState => ({
  ...(state.x === undefined ? {} : { x: state.x }),
  ...(state.y === undefined ? {} : { y: state.y }),
  width: state.width,
  height: state.height,
  ...(state.isMaximized === undefined ? {} : { isMaximized: state.isMaximized }),
});
