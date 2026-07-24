import type { Hono } from 'hono';

import type { JobsPort } from '@core/server/index.js';

import { buildApp } from './app.js';
import { createDeps, type AppConfig } from './composition.js';

export interface App {
  honoApp: Hono;
  jobs: JobsPort;
  dispose: () => Promise<void>;
}

export const createApp = (config: AppConfig = {}): App => {
  const deps = createDeps(config);
  return {
    honoApp: buildApp(deps),
    jobs: deps.jobs,
    dispose: async () => {
      await deps.globalCatalog.dispose();
    },
  };
};
