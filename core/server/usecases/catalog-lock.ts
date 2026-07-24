import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { CatalogLockSnapshot, GlobalCatalogStore } from '../ports.js';

export interface CatalogLockDeps {
  globalCatalog: GlobalCatalogStore;
}

export const catalogLockStatus = async (
  deps: CatalogLockDeps,
): Promise<Result<CatalogLockSnapshot, AppError>> =>
  deps.globalCatalog.lockStatus();

export const acquireCatalogWriteLock = async (
  deps: CatalogLockDeps,
): Promise<Result<CatalogLockSnapshot, AppError>> =>
  deps.globalCatalog.acquireWriteLock();

export const requireCatalogWriteLock = async (
  deps: CatalogLockDeps,
): Promise<Result<void, AppError>> => {
  const locked = await acquireCatalogWriteLock(deps);
  if (!locked.ok) return locked;
  return ok(undefined);
};
