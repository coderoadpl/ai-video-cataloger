import { homedir } from 'node:os';

import { createApp, type App } from '@server/src/create-app.js';
import { inMemoryDbRequested } from '@server/src/composition.js';

export interface DesktopCompositionOptions {
  version: string;
  isPackaged: boolean;
}

export const createDesktopApp = async (options: DesktopCompositionOptions): Promise<App> => {
  const homeDirectory = homedir();
  const config = {
    version: options.version,
    workingDirectory: homeDirectory,
    homeDirectory,
    isPackaged: options.isPackaged,
    processName: 'gui',
    catalogLockMode: 'lazy',
  } as const;
  if (options.isPackaged || !inMemoryDbRequested()) return createApp(config);
  const { createInMemoryDeps } = await import('@server/src/test-support/in-memory-deps.js');
  return createApp(config, createInMemoryDeps);
};
