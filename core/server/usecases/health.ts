import { ok, type AppError, type Result } from '@core/domain/index.js';

export interface HealthStatus {
  status: 'ok';
  version: string;
}

export interface HealthDeps {
  version: string;
}

export const checkHealth = (deps: HealthDeps): Result<HealthStatus, AppError> =>
  ok({ status: 'ok', version: deps.version });
