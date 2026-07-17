import { homedir } from 'node:os';

import { createApp, type App } from '@server/src/create-app.js';

export interface DesktopCompositionOptions {
  version: string;
}

export const createDesktopApp = (options: DesktopCompositionOptions): App => {
  const homeDirectory = homedir();
  return createApp({
    version: options.version,
    workingDirectory: homeDirectory,
    homeDirectory,
  });
};
