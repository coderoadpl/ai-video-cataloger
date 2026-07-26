import {
  appError,
  ok,
  type AppError,
  type CredentialDeletion,
  type CredentialsBackendStatus,
  type Result,
} from '@core/domain/index.js';

import type { CredentialsStore } from '../ports.js';

export const setCredential = async (
  deps: { credentials: CredentialsStore },
  input: { providerId: string; credential: string },
): Promise<Result<{ providerId: string; stored: true; backend: CredentialsBackendStatus }, AppError>> => {
  const stored = await deps.credentials.set(input.providerId, input.credential);
  if (!stored.ok) return stored;
  const backend = await deps.credentials.backend?.() ?? { backend: 'file' as const, reason: 'unsupported' as const };
  return ok({ providerId: input.providerId, stored: true, backend });
};

export const deleteCredential = async (
  deps: { credentials: CredentialsStore },
  input: { providerId: string },
): Promise<Result<{ providerId: string } & CredentialDeletion, AppError>> => {
  const remove = deps.credentials.delete;
  if (remove === undefined) {
    return { ok: false, error: appError('internal', 'Credential deletion is not supported by this store') };
  }
  const deleted = await remove.call(deps.credentials, input.providerId);
  if (!deleted.ok) return deleted;
  return ok({ providerId: input.providerId, ...deleted.value });
};
