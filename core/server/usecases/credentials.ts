import { ok, type AppError, type CredentialsBackendStatus, type Result } from '@core/domain/index.js';

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
