import type { Hono } from 'hono';

import { buildApp } from './app.js';
import { createDeps, type AppConfig } from './composition.js';

export interface App {
  honoApp: Hono;
  dispose: () => Promise<void>;
}

/**
 * The shared in-process app factory. Both composition roots (Electron main and
 * the CLI) call this and inject `honoApp.request` as the client's transport, so
 * the whole typed contract runs with zero network.
 */
export const createApp = (config: AppConfig = {}): App => ({
  honoApp: buildApp(createDeps(config)),
  dispose: () => Promise.resolve(),
});
