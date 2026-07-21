import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { appError, ok, type AppError, type Result } from '@core/domain/index.js';
import type { CredentialsStore, SecretsStore } from '@core/server/index.js';

const credentialsSchema = z.record(z.string().min(1), z.string().min(1));

export interface JsonCredentialsStoreOptions {
  homeDirectory?: string | undefined;
}

export class JsonCredentialsStore implements CredentialsStore {
  private readonly filePath: string;

  constructor(options: JsonCredentialsStoreOptions = {}) {
    this.filePath = path.join(options.homeDirectory ?? homedir(), '.ai-video-cataloger', 'credentials.json');
  }

  async get(providerId: string): Promise<Result<string | null, AppError>> {
    const values = await this.read();
    if (!values.ok) return values;
    return ok(values.value[providerId] ?? null);
  }

  async set(providerId: string, credential: string): Promise<Result<void, AppError>> {
    if (providerId.trim().length === 0 || credential.length === 0) {
      return { ok: false, error: appError('invalid_config_value', 'Provider ID and credential must not be empty') };
    }
    const values = await this.read();
    if (!values.ok) return values;
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify({ ...values.value, [providerId]: credential }, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
      return ok(undefined);
    } catch {
      return { ok: false, error: appError('internal', 'Could not store provider credential') };
    }
  }

  async delete(providerId: string): Promise<Result<void, AppError>> {
    const values = await this.read();
    if (!values.ok) return values;
    if (!(providerId in values.value)) return ok(undefined);
    const remaining = Object.fromEntries(Object.entries(values.value).filter(([key]) => key !== providerId));
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(remaining, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
      return ok(undefined);
    } catch {
      return { ok: false, error: appError('internal', 'Could not remove provider credential') };
    }
  }

  async list(): Promise<Result<string[], AppError>> {
    const values = await this.read();
    if (!values.ok) return values;
    return ok(Object.keys(values.value));
  }

  private async read(): Promise<Result<Record<string, string>, AppError>> {
    if (!existsSync(this.filePath)) return ok({});
    try {
      const parsed = credentialsSchema.safeParse(JSON.parse(await readFile(this.filePath, 'utf8')));
      if (!parsed.success) {
        return { ok: false, error: appError('invalid_config_value', 'Credentials file has an invalid format') };
      }
      await chmod(this.filePath, 0o600);
      return ok(parsed.data);
    } catch {
      return { ok: false, error: appError('internal', 'Could not read provider credentials') };
    }
  }
}

export class KeychainCredentialsStore implements CredentialsStore {
  constructor(
    private readonly secrets: SecretsStore,
    private readonly legacy: JsonCredentialsStore,
  ) {}

  async get(providerId: string): Promise<Result<string | null, AppError>> {
    if (await this.secrets.isAvailable()) {
      const fromKeychain = await this.secrets.get(providerId);
      if (!fromKeychain.ok) return fromKeychain;
      if (fromKeychain.value !== null) return ok(fromKeychain.value);
    }
    return this.legacy.get(providerId);
  }

  async set(providerId: string, credential: string): Promise<Result<void, AppError>> {
    if (!(await this.secrets.isAvailable())) return this.legacy.set(providerId, credential);
    const stored = await this.secrets.set(providerId, credential);
    if (!stored.ok) return stored;
    await this.legacy.delete(providerId);
    return ok(undefined);
  }

  async delete(providerId: string): Promise<Result<void, AppError>> {
    if (await this.secrets.isAvailable()) {
      const removed = await this.secrets.delete(providerId);
      if (!removed.ok) return removed;
    }
    return this.legacy.delete(providerId);
  }

  async legacyPlaintextProviders(): Promise<Result<string[], AppError>> {
    if (!(await this.secrets.isAvailable())) return ok([]);
    return this.legacy.list();
  }
}
