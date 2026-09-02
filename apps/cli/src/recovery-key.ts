import { appError, ok, type AppError, type Result } from '@core/domain/index.js';

export interface RecoveryKeySources {
  requested: boolean;
  env: string | undefined;
  interactive: boolean;
  prompt(): Promise<string>;
}

export const RECOVERY_KEY_ENV = 'AVC_BACKUP_RECOVERY_KEY';

export const resolveRecoveryKey = async (
  sources: RecoveryKeySources,
): Promise<Result<string | undefined, AppError>> => {
  const fromEnvironment = sources.env?.trim() ?? '';
  if (fromEnvironment.length > 0) return ok(fromEnvironment);
  if (!sources.requested) return ok(undefined);
  if (!sources.interactive) {
    return { ok: false, error: appError('recovery_key_required', `Set ${RECOVERY_KEY_ENV} or run this command in a terminal`) };
  }
  const typed = (await sources.prompt()).trim();
  if (typed.length === 0) {
    return { ok: false, error: appError('recovery_key_required', 'No recovery key was entered') };
  }
  return ok(typed);
};
