import { existsSync } from 'node:fs';
import { appendFile, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

import {
  appError,
  ok,
  type AppError,
  type CredentialDeletion,
  type CredentialsBackendStatus,
  type Result,
} from '@core/domain/index.js';
import type {
  CredentialMigrationLog,
  CredentialMigrationOutcome,
  CredentialsStore,
  SecretsStore,
} from '@core/server/index.js';

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

  async delete(providerId: string): Promise<Result<CredentialDeletion, AppError>> {
    const values = await this.read();
    if (!values.ok) return values;
    if (!(providerId in values.value)) return ok({ cleared: [], retained: [] });
    const remaining = Object.fromEntries(Object.entries(values.value).filter(([key]) => key !== providerId));
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    if (Object.keys(remaining).length === 0) {
      try {
        await rm(this.filePath, { force: true });
        return ok({ cleared: ['file'], retained: [] });
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
      return ok({ cleared: ['file'], retained: [] });
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
  private keychainFailed = false;
  private plaintextPending = false;
  private migration: Promise<boolean> | null = null;

  constructor(
    private readonly secrets: SecretsStore,
    private readonly legacy: JsonCredentialsStore,
    private readonly options: KeychainCredentialsStoreOptions = {},
  ) {}

  async get(providerId: string): Promise<Result<string | null, AppError>> {
    const ready = await this.keychainReady();
    const plaintextIsNewer = this.plaintextPending;
    if (plaintextIsNewer) {
      const fromFile = await this.legacy.get(providerId);
      if (!fromFile.ok || fromFile.value !== null) return fromFile;
    }
    if (ready) {
      const fromKeychain = await this.secrets.get(providerId);
      this.keychainFailed = !fromKeychain.ok;
      if (fromKeychain.ok && fromKeychain.value !== null) return ok(fromKeychain.value);
    }
    return plaintextIsNewer ? ok(null) : this.legacy.get(providerId);
  }

  async set(providerId: string, credential: string): Promise<Result<void, AppError>> {
    if (await this.keychainReady()) {
      if (await this.storeVerified(providerId, credential)) {
        this.keychainFailed = false;
        const removed = await this.legacy.delete(providerId);
        return removed.ok ? ok(undefined) : removed;
      }
      this.keychainFailed = true;
    }
    const stored = await this.legacy.set(providerId, credential);
    if (!stored.ok) return stored;
    this.plaintextPending = true;
    this.migration = null;
    return stored;
  }

  async delete(providerId: string): Promise<Result<CredentialDeletion, AppError>> {
    const keychain: CredentialDeletion = { cleared: [], retained: [] };
    if (await this.keychainReachable()) {
      const removed = await this.secrets.delete(providerId);
      this.keychainFailed = !removed.ok;
      if (!removed.ok) keychain.retained.push('keychain');
      else if (removed.value.existed) keychain.cleared.push('keychain');
    }
    const file = await this.legacy.delete(providerId);
    if (!file.ok) {
      if (keychain.cleared.length === 0 && keychain.retained.length === 0) return file;
      return ok({ cleared: keychain.cleared, retained: [...keychain.retained, 'file'] });
    }
    return ok({
      cleared: [...keychain.cleared, ...file.value.cleared],
      retained: [...keychain.retained, ...file.value.retained],
    });
  }

  async legacyPlaintextProviders(): Promise<Result<string[], AppError>> {
    if (!(await this.keychainReady())) return ok([]);
    return this.legacy.list();
  }

  async backend(): Promise<CredentialsBackendStatus> {
    const availability = await this.secrets.availability();
    if (availability !== 'available') return { backend: 'file', reason: availability };
    await this.ensureMigrated();
    if (this.keychainFailed || this.plaintextPending) return { backend: 'file', reason: 'degraded' };
    return { backend: 'keychain', reason: 'ok' };
  }

  private async keychainReachable(): Promise<boolean> {
    return (await this.secrets.availability()) === 'available';
  }

  private async keychainReady(): Promise<boolean> {
    if (!(await this.keychainReachable())) return false;
    await this.ensureMigrated();
    return true;
  }

  private async ensureMigrated(): Promise<void> {
    const attempt = (this.migration ??= this.migrateLegacyFile());
    const complete = await attempt;
    this.plaintextPending = !complete;
    if (!complete) this.migration = null;
  }

  private async migrateLegacyFile(): Promise<boolean> {
    const providers = await this.legacy.list();
    if (!providers.ok) return false;
    let complete = true;
    for (const providerId of providers.value) complete = (await this.migrateProvider(providerId)) && complete;
    return complete;
  }

  private async migrateProvider(providerId: string): Promise<boolean> {
    const plaintext = await this.legacy.get(providerId);
    if (!plaintext.ok) return false;
    if (plaintext.value === null) return true;
    const existing = await this.secrets.get(providerId);
    if (!existing.ok) {
      this.keychainFailed = true;
      return false;
    }
    const conflicting = existing.value !== null && existing.value !== plaintext.value;
    if (existing.value === null || conflicting) {
      if (!(await this.storeVerified(providerId, plaintext.value))) {
        this.keychainFailed = true;
        return false;
      }
    }
    const removed = await this.legacy.delete(providerId);
    if (!removed.ok) return false;
    await this.options.migrationLog?.record(providerId, conflicting ? 'value_conflict' : 'migrated');
    return true;
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

  async record(providerId: string, outcome: CredentialMigrationOutcome): Promise<void> {
    const entry = {
      at: new Date().toISOString(),
      event: outcome === 'value_conflict' ? 'credential_value_conflict' : 'credential_migrated',
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
