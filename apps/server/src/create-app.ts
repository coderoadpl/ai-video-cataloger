import type { Hono } from 'hono';

import type { AppError, Result } from '@core/domain/index.js';
import { watchCatalogFolder, type FolderWatchSession, type JobsPort } from '@core/server/index.js';

import { buildApp } from './app.js';
import { createDeps, type AppConfig } from './composition.js';

export interface App {
  honoApp: Hono;
  jobs: JobsPort;
  catalogFolderPaths: () => Promise<string[]>;
  watchFolder: (root: string, onChange: () => void) => Promise<Result<FolderWatchSession, AppError>>;
  dispose: () => Promise<void>;
}

export const createApp = (config: AppConfig = {}): App => {
  const deps = createDeps(config);
  return {
    honoApp: buildApp(deps),
    jobs: deps.jobs,
    watchFolder: (root, onChange) =>
      watchCatalogFolder({ watcher: deps.folderWatcher, jobs: deps.jobs }, root, onChange),
    catalogFolderPaths: async () => {
      const folders = await deps.globalCatalog.listFolders();
      return folders.ok ? folders.value.map((folder) => folder.currentPath) : [];
    },
    dispose: async () => {
      await deps.globalCatalog.dispose();
    },
  };
};
