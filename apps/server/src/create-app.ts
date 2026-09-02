import type { Hono } from 'hono';

import type { AppError, Result } from '@core/domain/index.js';
import { startBackupSchedule, watchCatalogFolder, type FolderWatchSession, type JobsPort } from '@core/server/index.js';

import { buildApp } from './app.js';
import { createDeps, type AppConfig, type InMemoryDepsFactory } from './composition.js';

export interface App {
  honoApp: Hono;
  jobs: JobsPort;
  catalogFolderPaths: () => Promise<string[]>;
  photoRootPaths: () => Promise<string[]>;
  watchFolder: (
    root: string,
    onChange: () => void,
    onStopped?: (error: AppError) => void,
  ) => Promise<Result<FolderWatchSession, AppError>>;
  dispose: () => Promise<void>;
}

export const createApp = (config: AppConfig = {}, inMemoryDepsFactory?: InMemoryDepsFactory): App => {
  const deps = createDeps(config, inMemoryDepsFactory);
  const backupSchedule = config.processName === 'gui'
    ? (() => {
      const cleanup = deps.cleanupBackupStaging();
      return startBackupSchedule(async () => {
        await cleanup;
        await deps.evaluateScheduledBackup();
      });
    })()
    : null;
  return {
    honoApp: buildApp(deps),
    jobs: deps.jobs,
    watchFolder: (root, onChange, onStopped) =>
      watchCatalogFolder({ watcher: deps.folderWatcher, jobs: deps.jobs }, root, onChange, { onStopped }),
    catalogFolderPaths: async () => {
      const folders = await deps.globalCatalog.listFolders();
      return folders.ok ? folders.value.map((folder) => folder.currentPath) : [];
    },
    photoRootPaths: async () => {
      const roots = await deps.photos.listRoots();
      return roots.ok ? roots.value.map((root) => root.root) : [];
    },
    dispose: async () => {
      backupSchedule?.stop();
      await deps.photos.dispose();
      await deps.globalCatalog.dispose();
    },
  };
};
