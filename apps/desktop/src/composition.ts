import { homedir } from 'node:os';
import { shell } from 'electron';

import { createApp, type App } from '@server/src/create-app.js';
import { inMemoryDbRequested } from '@server/src/composition.js';

export interface DesktopCompositionOptions {
  version: string;
  isPackaged: boolean;
}

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
  } as const;
  if (options.isPackaged || !inMemoryDbRequested()) return createApp(config);
  const { createInMemoryDeps } = await import('@server/src/test-support/in-memory-deps.js');
  return createApp(config, createInMemoryDeps);
};
