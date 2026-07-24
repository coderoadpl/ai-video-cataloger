import type { Hono } from 'hono';

import type { JobsPort } from '@core/server/index.js';

import { buildApp } from './app.js';
import { createDeps, type AppConfig } from './composition.js';

export interface App {
  honoApp: Hono;
  jobs: JobsPort;
  catalogFolderPaths: () => Promise<string[]>;
  dispose: () => Promise<void>;
}

export const createApp = (config: AppConfig = {}): App => {
  const deps = createDeps(config);
  return {
    honoApp: buildApp(deps),
    jobs: deps.jobs,
    catalogFolderPaths: async () => {
      const folders = await deps.globalCatalog.listFolders();
      return folders.ok ? folders.value.map((folder) => folder.currentPath) : [];
    },
    dispose: async () => {
      await deps.globalCatalog.dispose();
    },
  };
};
