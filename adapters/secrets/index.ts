import { execFile } from 'node:child_process';

import { z } from 'zod';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import type { SecretsAvailability, SecretsStore } from '@core/server/index.js';

export const DEFAULT_KEYCHAIN_SERVICE = 'com.ai-video-cataloger.app';
export const SECURITY_COMMAND_PATH = '/usr/bin/security';

const KEYCHAIN_ITEM_NOT_FOUND = 44;
const SECURITY_COMMAND_TIMEOUT_MS = 10_000;

export interface SecretsCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SecretsCommandRunner {
  run(command: string, args: readonly string[]): Promise<SecretsCommandResult>;
}

export interface KeychainSecretsAdapterOptions {
  service?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  disabled?: boolean | undefined;
  keychainPath?: string | undefined;
  securityPath?: string | undefined;
  commandRunner?: SecretsCommandRunner | undefined;
}

export class KeychainSecretsAdapter implements SecretsStore {
  private readonly service: string;
  private readonly platform: NodeJS.Platform;
  private readonly disabled: boolean;
  private readonly keychain: readonly string[];
  private readonly securityPath: string;
  private readonly commandRunner: SecretsCommandRunner;
  private structural: Extract<SecretsAvailability, 'disabled' | 'unsupported'> | null = null;

  constructor(options: KeychainSecretsAdapterOptions = {}) {
    this.service = options.service ?? DEFAULT_KEYCHAIN_SERVICE;
    this.platform = options.platform ?? process.platform;
    this.disabled = options.disabled ?? process.env.AI_VIDEO_CATALOGER_DISABLE_KEYCHAIN === '1';
    const keychainPath = options.keychainPath ?? process.env.AI_VIDEO_CATALOGER_KEYCHAIN;
    this.keychain = keychainPath === undefined || keychainPath.length === 0 ? [] : [keychainPath];
    this.securityPath = options.securityPath ?? SECURITY_COMMAND_PATH;
    this.commandRunner = options.commandRunner ?? securityCommandRunner;
  }

  async availability(): Promise<SecretsAvailability> {
    if (this.structural !== null) return this.structural;
    if (this.platform !== 'darwin') {
      this.structural = 'unsupported';
      return this.structural;
    }
    if (this.disabled) {
      this.structural = 'disabled';
      return this.structural;
    }
    return this.probe();
  }

  async get(account: string): Promise<Result<string | null, AppError>> {
    const result = await this.commandRunner.run(this.securityPath, [
      'find-generic-password', '-s', this.service, '-a', account, '-w', ...this.keychain,
    ]);
    if (result.code === 0) return ok(stripTrailingNewline(result.stdout));
    if (result.code === KEYCHAIN_ITEM_NOT_FOUND) return ok(null);
    return keychainError(`read the Keychain entry for ${account}`, result);
  }

  async set(account: string, secret: string): Promise<Result<void, AppError>> {
    // -w takes the password as an argument, briefly exposing it in this process's argv.
    // Bare -w prompts interactively and would hang headless runs. `security -i` does keep
    // the secret out of argv, but a probe against a throwaway keychain (2026-07-28) showed
    // it exits 0 on a failed add-generic-password that the argv form reports as exit 45,
    // and it blocks forever on a locked keychain - a write that silently does nothing is
    // worse than a millisecond of argv exposure, so argv stays.
    const result = await this.commandRunner.run(this.securityPath, [
      'add-generic-password', '-U', '-s', this.service, '-a', account, '-w', secret, ...this.keychain,
    ]);
    if (result.code === 0) return ok(undefined);
    return keychainError(`store the Keychain entry for ${account}`, result);
  }

  async delete(account: string): Promise<Result<{ existed: boolean }, AppError>> {
    const result = await this.commandRunner.run(this.securityPath, [
      'delete-generic-password', '-s', this.service, '-a', account, ...this.keychain,
    ]);
    if (result.code === 0) return ok({ existed: true });
    if (result.code === KEYCHAIN_ITEM_NOT_FOUND) return ok({ existed: false });
    return keychainError(`remove the Keychain entry for ${account}`, result);
  }

  private async probe(): Promise<SecretsAvailability> {
    try {
      const result = await this.commandRunner.run(this.securityPath, ['list-keychains']);
      return result.code === 0 ? 'available' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
}

const stripTrailingNewline = (value: string): string => value.replace(/\r?\n$/, '');

const keychainError = (action: string, result: SecretsCommandResult): Result<never, AppError> => ({
  ok: false,
  error: appError('internal', `Could not ${action} (security exited ${String(result.code)}): ${result.stderr.trim()}`),
});

const securityCommandRunner: SecretsCommandRunner = {
  run: (command, args) =>
    new Promise((resolve) => {
      execFile(command, [...args], { timeout: SECURITY_COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
        if (error !== null && isTimeout(error)) {
          resolve({ code: 1, stdout: String(stdout), stderr: `security timed out after ${String(SECURITY_COMMAND_TIMEOUT_MS)}ms` });
          return;
        }
        resolve({
          code: error === null ? 0 : exitCode(error),
          stdout: String(stdout),
          stderr: String(stderr),
        });
      });
    }),
};

const timeoutErrorSchema = z.object({ killed: z.boolean(), signal: z.string().nullable() });

const isTimeout = (error: unknown): boolean => {
  const parsed = timeoutErrorSchema.safeParse(error);
  return parsed.success && parsed.data.killed && parsed.data.signal !== null;
};

const execErrorSchema = z.object({ code: z.number() });

const exitCode = (error: unknown): number => {
  const parsed = execErrorSchema.safeParse(error);
  return parsed.success ? parsed.data.code : 1;
};
