import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { BrowserWindow, dialog, shell } from 'electron';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

import { createApp, type App } from '@server/src/create-app.js';
import { inMemoryDbRequested } from '@server/src/composition.js';

export interface DesktopCompositionOptions {
  version: string;
  isPackaged: boolean;
}

const saveThroughNativeDialog = async (
  input: { suggestedName: string; contents: string },
): Promise<Result<{ path: string } | null, AppError>> => {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options = {
    defaultPath: path.join(homedir(), 'Documents', input.suggestedName),
    buttonLabel: 'Save',
  };
  const chosen = window === undefined
    ? await dialog.showSaveDialog(options)
    : await dialog.showSaveDialog(window, options);
  if (chosen.canceled || chosen.filePath === undefined) return ok(null);
  try {
    await writeFile(chosen.filePath, input.contents, { mode: 0o600 });
  } catch {
    return { ok: false, error: appError('internal', 'Could not write the recovery key file') };
  }
  return ok({ path: chosen.filePath });
};

export const createDesktopApp = async (options: DesktopCompositionOptions): Promise<App> => {
  const homeDirectory = process.env.AVC_HOME_DIRECTORY ?? homedir();
  const config = {
    version: options.version,
    workingDirectory: homeDirectory,
    homeDirectory,
    isPackaged: options.isPackaged,
    processName: 'gui',
    catalogLockMode: 'lazy',
    openExternal: (url: string) => shell.openExternal(url),
    saveFile: saveThroughNativeDialog,
  } as const;
  if (options.isPackaged || !inMemoryDbRequested()) return createApp(config);
  const { createInMemoryDeps } = await import('@server/src/test-support/in-memory-deps.js');
  return createApp(config, createInMemoryDeps);
};
