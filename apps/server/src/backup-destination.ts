import { GoogleOAuthBackupDestination } from '@adapters/backup/google-oauth-destination.js';
import { GoogleServiceAccountBackupDestination } from '@adapters/backup/google-service-account-destination.js';
import {
  appError,
  configValueSchema,
  ok,
  type AppError,
  type Result,
} from '@core/domain/index.js';
import type { BackupDestinationPort, ConfigStore, SecretsStore } from '@core/server/index.js';

export interface GoogleBackupDestinationOptions {
  config: ConfigStore;
  secrets: SecretsStore;
  oauthClientId: string;
  oauthClientSecret: string;
  openExternal(url: string): Promise<void>;
  fetchImpl?: typeof fetch | undefined;
  driveBaseUrl?: string | undefined;
  uploadBaseUrl?: string | undefined;
}

export const createGoogleBackupDestination = async (
  options: GoogleBackupDestinationOptions,
): Promise<Result<BackupDestinationPort, AppError>> => {
  const configured = await options.config.get({ kind: 'home' }, 'backup_provider');
  if (!configured.ok) return configured;
  const provider = configValueSchema.shape.backup_provider.safeParse(configured.value ?? undefined);
  if (!provider.success) return { ok: false, error: appError('invalid_config_value', 'Invalid backup provider') };
  if (provider.data === 'service_account') {
    return ok(new GoogleServiceAccountBackupDestination({
      config: options.config,
      secrets: options.secrets,
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...endpointOverrides(options),
    }));
  }
  return ok(new GoogleOAuthBackupDestination({
    config: options.config,
    secrets: options.secrets,
    clientId: options.oauthClientId,
    clientSecret: options.oauthClientSecret,
    openExternal: options.openExternal,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...endpointOverrides(options),
  }));
};

const endpointOverrides = (
  options: GoogleBackupDestinationOptions,
): { driveBaseUrl?: string; uploadBaseUrl?: string } => ({
  ...(options.driveBaseUrl === undefined ? {} : { driveBaseUrl: options.driveBaseUrl }),
  ...(options.uploadBaseUrl === undefined ? {} : { uploadBaseUrl: options.uploadBaseUrl }),
});
