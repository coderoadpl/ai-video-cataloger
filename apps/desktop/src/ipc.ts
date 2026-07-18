import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { z } from 'zod';

import {
  desktopFetchRequestSchema,
  desktopFetchResponseSchema,
  type DesktopFetchResponse,
} from '@core/contract/index.js';
import type { App } from '@server/src/create-app.js';

import { CHANNELS } from './channels.js';
import type { FolderStore } from './folder-store.js';
import { resolveScopedPath } from './media-scope.js';
import { updateRecentFoldersMenu } from './menu.js';

export interface IpcDeps {
  desktopApp: App;
  appVersion: string;
  folderStore: FolderStore;
  getMainWindow(): BrowserWindow | null;
}

const stringSchema = z.string();
const stringArraySchema = z.array(z.string());

export const registerIpcHandlers = (deps: IpcDeps): void => {
  const isTrustedSender = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const mainWindow = deps.getMainWindow();
    return mainWindow !== null && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
  };

  ipcMain.handle(CHANNELS.appGetVersion, (event): string => {
    if (!isTrustedSender(event)) throw new Error('Unauthorized IPC sender');
    return deps.appVersion;
  });

  ipcMain.handle(CHANNELS.apiRequest, async (event, input: unknown): Promise<DesktopFetchResponse> => {
    if (!isTrustedSender(event)) throw new Error('Unauthorized IPC sender');
    const request = desktopFetchRequestSchema.parse(input);
    const init: RequestInit = {
      ...(request.method === undefined ? {} : { method: request.method }),
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(request.body === undefined || request.body === null ? {} : { body: request.body }),
    };
    const response = await deps.desktopApp.honoApp.request(request.url, init);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return desktopFetchResponseSchema.parse({
      status: response.status,
      statusText: response.statusText,
      headers,
      body: await response.text(),
    });
  });

  ipcMain.on(CHANNELS.windowClose, (event) => {
    if (!isTrustedSender(event)) return;
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on(CHANNELS.windowMinimize, (event) => {
    if (!isTrustedSender(event)) return;
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(CHANNELS.windowMaximize, (event) => {
    if (!isTrustedSender(event)) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isMaximized() === true) {
      window.unmaximize();
      return;
    }
    window?.maximize();
  });

  ipcMain.handle(CHANNELS.folderShowPicker, async (event): Promise<string | null> => {
    if (!isTrustedSender(event)) return null;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) return null;
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Video Folder',
      buttonLabel: 'Select Folder',
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(CHANNELS.folderGetCurrent, async (event): Promise<string | null> => {
    if (!isTrustedSender(event)) return null;
    return deps.folderStore.getCurrent();
  });

  ipcMain.handle(CHANNELS.folderSetCurrent, async (event, folderPathInput: unknown): Promise<void> => {
    if (!isTrustedSender(event)) return;
    const folderPath = stringSchema.safeParse(folderPathInput);
    if (!folderPath.success) return;
    if (!(await isAbsoluteDirectory(folderPath.data))) return;
    await deps.folderStore.setCurrent(folderPath.data);
    await updateMenu(deps);
  });

  ipcMain.handle(CHANNELS.folderGetRecent, async (event): Promise<string[]> => {
    if (!isTrustedSender(event)) return [];
    return stringArraySchema.parse(await deps.folderStore.getRecent());
  });

  ipcMain.handle(CHANNELS.folderRemoveRecent, async (event, folderPathInput: unknown): Promise<void> => {
    if (!isTrustedSender(event)) return;
    const folderPath = stringSchema.safeParse(folderPathInput);
    if (!folderPath.success || !path.isAbsolute(folderPath.data)) return;
    await deps.folderStore.removeRecent(folderPath.data);
    await updateMenu(deps);
  });

  ipcMain.handle(CHANNELS.folderClearRecent, async (event): Promise<void> => {
    if (!isTrustedSender(event)) return;
    await deps.folderStore.clearRecent();
    await updateMenu(deps);
  });

  ipcMain.handle(CHANNELS.revealInFinder, async (event, pathInput: unknown): Promise<void> => {
    if (!isTrustedSender(event)) return;
    const targetPath = stringSchema.safeParse(pathInput);
    if (!targetPath.success || !path.isAbsolute(targetPath.data)) return;
    const scopedPath = await resolveScopedPath(targetPath.data, await deps.folderStore.getCurrent());
    if (scopedPath === null) return;
    shell.showItemInFolder(scopedPath);
  });

  ipcMain.handle(CHANNELS.onboardingGetCompleted, async (event): Promise<boolean> => {
    if (!isTrustedSender(event)) return true;
    return readOnboardingCompleted();
  });

  ipcMain.handle(CHANNELS.onboardingSetCompleted, async (event): Promise<void> => {
    if (!isTrustedSender(event)) return;
    await writeOnboardingCompleted();
  });
};

const onboardingFlagPath = (): string =>
  path.join(homedir(), '.ai-video-cataloger', 'onboarding.json');

const onboardingFlagSchema = z.object({ completed: z.boolean() });

const readOnboardingCompleted = async (): Promise<boolean> => {
  try {
    const parsed = onboardingFlagSchema.safeParse(JSON.parse(await readFile(onboardingFlagPath(), 'utf8')));
    return parsed.success && parsed.data.completed;
  } catch {
    return false;
  }
};

const writeOnboardingCompleted = async (): Promise<void> => {
  const flagPath = onboardingFlagPath();
  await mkdir(path.dirname(flagPath), { recursive: true });
  await writeFile(flagPath, JSON.stringify({ completed: true }), 'utf8');
};

export const cleanupIpcHandlers = (): void => {
  for (const channel of Object.values(CHANNELS)) ipcMain.removeAllListeners(channel);
  ipcMain.removeHandler(CHANNELS.appGetVersion);
  ipcMain.removeHandler(CHANNELS.apiRequest);
  ipcMain.removeHandler(CHANNELS.folderShowPicker);
  ipcMain.removeHandler(CHANNELS.folderGetCurrent);
  ipcMain.removeHandler(CHANNELS.folderSetCurrent);
  ipcMain.removeHandler(CHANNELS.folderGetRecent);
  ipcMain.removeHandler(CHANNELS.folderRemoveRecent);
  ipcMain.removeHandler(CHANNELS.folderClearRecent);
  ipcMain.removeHandler(CHANNELS.revealInFinder);
  ipcMain.removeHandler(CHANNELS.onboardingGetCompleted);
  ipcMain.removeHandler(CHANNELS.onboardingSetCompleted);
};

const updateMenu = async (deps: IpcDeps): Promise<void> => {
  updateRecentFoldersMenu(deps.getMainWindow(), await deps.folderStore.getRecent());
};

const isAbsoluteDirectory = async (folderPath: string): Promise<boolean> => {
  if (!path.isAbsolute(folderPath)) return false;
  try {
    return (await stat(folderPath)).isDirectory();
  } catch {
    return false;
  }
};
