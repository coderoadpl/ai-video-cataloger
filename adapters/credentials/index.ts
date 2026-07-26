import { existsSync } from 'node:fs';
import { appendFile, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import { appError, ok, type AppError, type CredentialsBackendStatus, type Result } from '@core/domain/index.js';
import type { CredentialMigrationLog, CredentialsStore, SecretsStore } from '@core/server/index.js';

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
    if (Object.keys(remaining).length === 0) {
      try {
        await rm(this.filePath, { force: true });
        return ok(undefined);
      } catch {
        return { ok: false, error: appError('internal', 'Could not remove provider credential') };
      }
    }
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

export interface KeychainCredentialsStoreOptions {
  migrationLog?: CredentialMigrationLog | undefined;
}

export class KeychainCredentialsStore implements CredentialsStore {
  private degraded = false;
  private migration: Promise<void> | null = null;

  constructor(
    private readonly secrets: SecretsStore,
    private readonly legacy: JsonCredentialsStore,
    private readonly options: KeychainCredentialsStoreOptions = {},
  ) {}

  async get(providerId: string): Promise<Result<string | null, AppError>> {
    if (await this.keychainUsable()) {
      const fromKeychain = await this.secrets.get(providerId);
      if (fromKeychain.ok && fromKeychain.value !== null) return ok(fromKeychain.value);
      if (!fromKeychain.ok) this.degraded = true;
    }
    return this.legacy.get(providerId);
  }

  async set(providerId: string, credential: string): Promise<Result<void, AppError>> {
    if (await this.keychainUsable()) {
      if (await this.storeVerified(providerId, credential)) return this.legacy.delete(providerId);
      this.degraded = true;
    }
    return this.legacy.set(providerId, credential);
  }

  async delete(providerId: string): Promise<Result<void, AppError>> {
    if (await this.keychainUsable()) {
      const removed = await this.secrets.delete(providerId);
      if (!removed.ok) this.degraded = true;
    }
    return this.legacy.delete(providerId);
  }

  async legacyPlaintextProviders(): Promise<Result<string[], AppError>> {
    if (!(await this.keychainUsable())) return ok([]);
    return this.legacy.list();
  }

  async backend(): Promise<CredentialsBackendStatus> {
    const availability = await this.secrets.availability();
    if (availability !== 'available') return { backend: 'file', reason: availability };
    if (this.degraded) return { backend: 'file', reason: 'degraded' };
    return { backend: 'keychain', reason: 'ok' };
  }

  private async keychainUsable(): Promise<boolean> {
    if (this.degraded) return false;
    if ((await this.secrets.availability()) !== 'available') return false;
    this.migration ??= this.migrateLegacyFile();
    await this.migration;
    return !this.degraded;
  }

  private async migrateLegacyFile(): Promise<void> {
    const providers = await this.legacy.list();
    if (!providers.ok) return;
    for (const providerId of providers.value) await this.migrateProvider(providerId);
  }

  private async migrateProvider(providerId: string): Promise<void> {
    const plaintext = await this.legacy.get(providerId);
    if (!plaintext.ok || plaintext.value === null) return;
    const existing = await this.secrets.get(providerId);
    if (!existing.ok) {
      this.degraded = true;
      return;
    }
    if (existing.value === null && !(await this.storeVerified(providerId, plaintext.value))) {
      this.degraded = true;
      return;
    }
    const removed = await this.legacy.delete(providerId);
    if (!removed.ok) return;
    await this.options.migrationLog?.record(providerId);
  }

  private async storeVerified(providerId: string, credential: string): Promise<boolean> {
    const stored = await this.secrets.set(providerId, credential);
    if (!stored.ok) return false;
    const readback = await this.secrets.get(providerId);
    return readback.ok && readback.value === credential;
  }
}

export interface NdjsonMigrationLogOptions {
  homeDirectory?: string | undefined;
}

export class NdjsonMigrationLog implements CredentialMigrationLog {
  private readonly filePath: string;

  constructor(options: NdjsonMigrationLogOptions = {}) {
    this.filePath = path.join(options.homeDirectory ?? homedir(), '.ai-video-cataloger', 'credentials-migration.ndjson');
  }

  async record(providerId: string): Promise<void> {
    const entry = {
      at: new Date().toISOString(),
      event: 'credential_migrated',
      providerId,
      from: 'credentials.json',
      to: 'keychain',
    };
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      return;
    }
  }
}
