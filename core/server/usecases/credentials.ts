import { ok, type AppError, type Result } from '@core/domain/index.js';

import type { CredentialsStore } from '../ports.js';

export const setCredential = async (
  deps: { credentials: CredentialsStore },
  input: { providerId: string; credential: string },
): Promise<Result<{ providerId: string; stored: true }, AppError>> => {
  const stored = await deps.credentials.set(input.providerId, input.credential);
  if (!stored.ok) return stored;
  return ok({ providerId: input.providerId, stored: true });
};
