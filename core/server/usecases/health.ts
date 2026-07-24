import {
  configSchema,
  err,
  ok,
  unavailable,
  type AppError,
  type Result,
} from '@core/domain/index.js';

import type { CatalogLockSnapshot, ConfigStore, GlobalCatalogStore } from '../ports.js';
import { resolveConfigValues } from './config-resolution.js';

export interface HealthStatus {
  status: 'ok';
  version: string;
}

export interface HealthDeps {
  version: string;
}

export const checkHealth = (deps: HealthDeps): Result<HealthStatus, AppError> =>
  ok({ status: 'ok', version: deps.version });

export type ReadyCheckName = 'catalog' | 'lock' | 'provider_config';

export interface ReadyCheck {
  name: ReadyCheckName;
  ok: boolean;
  detail: string;
}

export interface ReadyStatus {
  status: 'ok';
  version: string;
  checks: ReadyCheck[];
}

export interface ReadyDeps {
  version: string;
  globalCatalog: Pick<GlobalCatalogStore, 'counts' | 'lockStatus'>;
  config: ConfigStore;
}

export const checkReady = async (deps: ReadyDeps): Promise<Result<ReadyStatus, AppError>> => {
  const catalog = await deps.globalCatalog.counts();
  const lock = catalog.ok ? await deps.globalCatalog.lockStatus() : null;
  const checks: ReadyCheck[] = [
    catalog.ok
      ? { name: 'catalog', ok: true, detail: 'Catalog database and sql.js runtime opened' }
      : { name: 'catalog', ok: false, detail: `Catalog database did not open: ${catalog.error.message}` },
    lockCheck(lock),
    await providerConfigCheck(deps.config),
  ];
  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    return err(unavailable(`Not ready: ${failed.map((check) => check.name).join(', ')}`, checks));
  }
  return ok({ status: 'ok', version: deps.version, checks });
};

const lockCheck = (lock: Result<CatalogLockSnapshot, AppError> | null): ReadyCheck => {
  if (lock === null) return { name: 'lock', ok: false, detail: 'Lock state unavailable while the catalog is closed' };
  if (!lock.ok) return { name: 'lock', ok: false, detail: `Lock state unreadable: ${lock.error.message}` };
  const snapshot = lock.value;
  if (snapshot.owner !== null) {
    return { name: 'lock', ok: true, detail: `Write lock owned by this process (PID ${String(snapshot.owner.pid)})` };
  }
  if (snapshot.writable) return { name: 'lock', ok: true, detail: 'Write lock is acquirable' };
  if (snapshot.blockedBy !== null) {
    return {
      name: 'lock',
      ok: false,
      detail: `Write lock held by ${snapshot.blockedBy.processName} PID ${String(snapshot.blockedBy.pid)}`,
    };
  }
  return { name: 'lock', ok: false, detail: 'Write lock is not acquirable' };
};

const providerConfigCheck = async (config: ConfigStore): Promise<ReadyCheck> => {
  const resolved = await resolveConfigValues(config);
  if (!resolved.ok) {
    return { name: 'provider_config', ok: false, detail: `Configuration could not be read: ${resolved.error.message}` };
  }
  const parsed = configSchema.safeParse(resolved.value.effective);
  if (!parsed.success) {
    return { name: 'provider_config', ok: false, detail: 'Configured analyzer or transcriber is invalid' };
  }
  return { name: 'provider_config', ok: true, detail: 'Provider configuration is valid' };
};
