import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  CredentialValueConflict,
  SecretsStore,
} from '@core/server/index.js';

const markedEntrySchema = z.object({ value: z.string().min(1), state: z.enum(['pending', 'stale']) });
const storedEntrySchema = z.union([z.string().min(1), markedEntrySchema]);
const credentialsSchema = z.record(z.string().min(1), storedEntrySchema);

type StoredEntry = z.output<typeof storedEntrySchema>;

export type CredentialEntryState = 'unmarked' | 'pending' | 'stale';

export interface CredentialEntry {
  value: string;
  state: CredentialEntryState;
}

const CONFLICT_ARCHIVE_PREFIX = 'credentials.json.conflict-';

const readEntry = (stored: StoredEntry): CredentialEntry =>
  typeof stored === 'string' ? { value: stored, state: 'unmarked' } : stored;

const writeEntry = (entry: CredentialEntry): StoredEntry =>
  entry.state === 'unmarked' ? entry.value : { value: entry.value, state: entry.state };

export interface JsonCredentialsStoreOptions {
  homeDirectory?: string | undefined;
}

export class JsonCredentialsStore implements CredentialsStore {
  private readonly filePath: string;

  constructor(options: JsonCredentialsStoreOptions = {}) {
    this.filePath = path.join(options.homeDirectory ?? homedir(), '.ai-video-cataloger', 'credentials.json');
  }

  async get(providerId: string): Promise<Result<string | null, AppError>> {
    const entry = await this.entry(providerId);
    if (!entry.ok) return entry;
    return ok(entry.value?.value ?? null);
  }

  async entry(providerId: string): Promise<Result<CredentialEntry | null, AppError>> {
    const values = await this.read();
    if (!values.ok) return values;
    const stored = values.value[providerId];
    return ok(stored === undefined ? null : readEntry(stored));
  }

  set(providerId: string, credential: string): Promise<Result<void, AppError>> {
    return this.store(providerId, { value: credential, state: 'unmarked' });
  }

  setPending(providerId: string, credential: string): Promise<Result<void, AppError>> {
    return this.store(providerId, { value: credential, state: 'pending' });
  }

  async markStale(providerId: string): Promise<Result<void, AppError>> {
    const entry = await this.entry(providerId);
    if (!entry.ok) return entry;
    if (entry.value === null) return ok(undefined);
    return this.store(providerId, { value: entry.value.value, state: 'stale' });
  }

  async archive(providerId: string): Promise<Result<string | null, AppError>> {
    const values = await this.read();
    if (!values.ok) return values;
    const stored = values.value[providerId];
    if (stored === undefined) return ok(null);
    const archivePath = `${this.filePath}.conflict-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const archived = await this.readFileEntries(archivePath);
    if (!archived.ok) return archived;
    if (!(await this.writeFileEntries(archivePath, { ...archived.value, [providerId]: stored }))) {
      return { ok: false, error: appError('internal', 'Could not set aside the conflicting provider credential') };
    }
    const removed = await this.delete(providerId);
    if (!removed.ok) return removed;
    return ok(archivePath);
  }

  async purgeArchived(providerId: string): Promise<Result<boolean, AppError>> {
    const archives = await this.conflictArchives();
    if (!archives.ok) return archives;
    let cleared = false;
    for (const { archivePath } of archives.value.filter((conflict) => conflict.providerId === providerId)) {
      const entries = await this.readFileEntries(archivePath);
      if (!entries.ok) return entries;
      const remaining = Object.fromEntries(Object.entries(entries.value).filter(([key]) => key !== providerId));
      if (!(await this.replaceArchive(archivePath, remaining))) {
        return { ok: false, error: appError('internal', 'Could not remove provider credential') };
      }
      cleared = true;
    }
    return ok(cleared);
  }

  private async replaceArchive(archivePath: string, remaining: Record<string, StoredEntry>): Promise<boolean> {
    if (Object.keys(remaining).length > 0) return this.writeFileEntries(archivePath, remaining);
    try {
      await rm(archivePath, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  async conflictArchives(): Promise<Result<CredentialValueConflict[], AppError>> {
    const directory = path.dirname(this.filePath);
    if (!existsSync(directory)) return ok([]);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return { ok: false, error: appError('read_error', 'Could not read provider credentials') };
    }
    const conflicts: CredentialValueConflict[] = [];
    for (const name of names.filter((entry) => entry.startsWith(CONFLICT_ARCHIVE_PREFIX)).sort()) {
      const archivePath = path.join(directory, name);
      const archived = await this.readFileEntries(archivePath);
      if (!archived.ok) return archived;
      for (const providerId of Object.keys(archived.value)) conflicts.push({ providerId, archivePath });
    }
    return ok(conflicts);
  }

  private async store(providerId: string, entry: CredentialEntry): Promise<Result<void, AppError>> {
    if (providerId.trim().length === 0 || entry.value.length === 0) {
      return { ok: false, error: appError('invalid_config_value', 'Provider ID and credential must not be empty') };
    }
    const values = await this.read();
    if (!values.ok) return values;
    const written = await this.writeAll({ ...values.value, [providerId]: writeEntry(entry) });
    if (!written) return { ok: false, error: appError('internal', 'Could not store provider credential') };
    return ok(undefined);
  }

  async delete(providerId: string): Promise<Result<CredentialDeletion, AppError>> {
    const values = await this.read();
    if (!values.ok) return values;
    if (!(providerId in values.value)) return ok({ cleared: [], retained: [] });
    const remaining = Object.fromEntries(Object.entries(values.value).filter(([key]) => key !== providerId));
    if (Object.keys(remaining).length === 0) {
      try {
        await rm(this.filePath, { force: true });
        return ok({ cleared: ['file'], retained: [] });
      } catch {
        return { ok: false, error: appError('internal', 'Could not remove provider credential') };
      }
    }
    const written = await this.writeAll(remaining);
    if (!written) return { ok: false, error: appError('internal', 'Could not remove provider credential') };
    return ok({ cleared: ['file'], retained: [] });
  }

  async list(): Promise<Result<string[], AppError>> {
    const values = await this.read();
    if (!values.ok) return values;
    return ok(Object.keys(values.value));
  }

  private writeAll(values: Record<string, StoredEntry>): Promise<boolean> {
    return this.writeFileEntries(this.filePath, values);
  }

  private async writeFileEntries(filePath: string, values: Record<string, StoredEntry>): Promise<boolean> {
    const temporaryPath = `${filePath}.${process.pid.toString(36)}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(values, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600);
      return true;
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      return false;
    }
  }

  private read(): Promise<Result<Record<string, StoredEntry>, AppError>> {
    return this.readFileEntries(this.filePath);
  }

  private async readFileEntries(filePath: string): Promise<Result<Record<string, StoredEntry>, AppError>> {
    if (!existsSync(filePath)) return ok({});
    try {
      const parsed = credentialsSchema.safeParse(JSON.parse(await readFile(filePath, 'utf8')));
      if (!parsed.success) {
        return { ok: false, error: appError('invalid_config_value', 'Credentials file has an invalid format') };
      }
      await chmod(filePath, 0o600);
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
    const pending = this.plaintextPending ? await this.legacy.entry(providerId) : ok(null);
    if (!pending.ok) return pending;
    if (pending.value?.state === 'pending') return ok(pending.value.value);
    if (ready) {
      const fromKeychain = await this.secrets.get(providerId);
      if (!fromKeychain.ok) {
        this.keychainFailed = true;
        if (pending.value !== null) return ok(pending.value.value);
        const fallback = await this.legacy.get(providerId);
        if (!fallback.ok || fallback.value !== null) return fallback;
        return { ok: false, error: appError('keychain_unavailable', KEYCHAIN_UNREACHABLE_MESSAGE) };
      }
      this.keychainFailed = false;
      if (fromKeychain.value !== null) return ok(fromKeychain.value);
    }
    if (pending.value !== null) return ok(pending.value.value);
    return this.legacy.get(providerId);
  }

  async set(providerId: string, credential: string): Promise<Result<void, AppError>> {
    const availability = await this.secrets.availability();
    if (availability === 'available') {
      await this.ensureMigrated();
      if (await this.storeVerified(providerId, credential)) {
        this.keychainFailed = false;
        return this.dropSupersededPlaintext(providerId);
      }
      this.keychainFailed = true;
    }
    // Where no keychain exists at all the file is the primary store, not a fallback, so its
    // entries carry no provenance marker and no migration is ever owed.
    if (availability === 'unsupported' || availability === 'disabled') {
      return this.legacy.set(providerId, credential);
    }
    const stored = await this.legacy.setPending(providerId, credential);
    if (!stored.ok) return stored;
    this.plaintextPending = true;
    this.migration = null;
    return stored;
  }

  async delete(providerId: string): Promise<Result<CredentialDeletion, AppError>> {
    const availability = await this.secrets.availability();
    if (availability === 'available') await this.ensureMigrated();
    const keychain: CredentialDeletion = { cleared: [], retained: [] };
    // A delete against an unreachable keychain fails harmlessly, and skipping it would
    // report a key as gone while the keychain still holds it.
    if (availability === 'available' || availability === 'unavailable') {
      const removed = await this.secrets.delete(providerId);
      this.keychainFailed = !removed.ok;
      if (!removed.ok) keychain.retained.push('keychain');
      else if (removed.value.existed) keychain.cleared.push('keychain');
    }
    const file = await this.legacy.delete(providerId);
    if (!file.ok) return fileLegFailure(keychain, file);
    // A conflict archive is a plaintext copy of exactly the key the user asked to forget.
    const archived = await this.legacy.purgeArchived(providerId);
    if (!archived.ok) return fileLegFailure(keychain, archived);
    const clearedFile = file.value.cleared.length > 0 || archived.value;
    return ok({
      cleared: [...keychain.cleared, ...(clearedFile ? ['file' as const] : [])],
      retained: [...keychain.retained, ...file.value.retained],
    });
  }

  async legacyPlaintextProviders(): Promise<Result<string[], AppError>> {
    if (!(await this.keychainReady())) return ok([]);
    return this.legacy.list();
  }

  credentialValueConflicts(): Promise<Result<CredentialValueConflict[], AppError>> {
    return this.legacy.conflictArchives();
  }

  private async dropSupersededPlaintext(providerId: string): Promise<Result<void, AppError>> {
    const removed = await this.legacy.delete(providerId);
    if (removed.ok) return ok(undefined);
    const retried = await this.legacy.delete(providerId);
    if (retried.ok) return ok(undefined);
    // The keychain now holds a write-verified newer value, so this leftover copy must never
    // be promoted over it by a later migration.
    await this.legacy.markStale(providerId);
    this.plaintextPending = true;
    this.migration = null;
    return retried;
  }

  async backend(): Promise<CredentialsBackendStatus> {
    const availability = await this.secrets.availability();
    if (availability !== 'available') return { backend: 'file', reason: availability };
    await this.ensureMigrated();
    if (this.keychainFailed || this.plaintextPending) return { backend: 'file', reason: 'degraded' };
    return { backend: 'keychain', reason: 'ok' };
  }

  private async keychainReady(): Promise<boolean> {
    if ((await this.secrets.availability()) !== 'available') return false;
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
    const entry = await this.legacy.entry(providerId);
    if (!entry.ok) return false;
    if (entry.value === null) return true;
    const existing = await this.secrets.get(providerId);
    if (!existing.ok) {
      this.keychainFailed = true;
      return false;
    }
    this.keychainFailed = false;
    if (existing.value === entry.value.value) return this.dropMigrated(providerId, 'migrated');
    if (existing.value === null) return this.promote(providerId, entry.value.value, 'migrated');
    if (entry.value.state === 'pending') return this.promote(providerId, entry.value.value, 'value_conflict');
    if (entry.value.state === 'stale') return this.dropMigrated(providerId, 'superseded');
    return this.setAside(providerId);
  }

  private async promote(providerId: string, credential: string, outcome: CredentialMigrationOutcome): Promise<boolean> {
    if (!(await this.storeVerified(providerId, credential))) {
      this.keychainFailed = true;
      return false;
    }
    return this.dropMigrated(providerId, outcome);
  }

  private async dropMigrated(providerId: string, outcome: CredentialMigrationOutcome): Promise<boolean> {
    const removed = await this.legacy.delete(providerId);
    if (!removed.ok) return false;
    await this.options.migrationLog?.record(providerId, outcome);
    return true;
  }

  private async setAside(providerId: string): Promise<boolean> {
    const archived = await this.legacy.archive(providerId);
    if (!archived.ok) return false;
    await this.options.migrationLog?.record(providerId, 'value_conflict');
    return true;
  }

  private async storeVerified(providerId: string, credential: string): Promise<boolean> {
    const stored = await this.secrets.set(providerId, credential);
    if (!stored.ok) return false;
    const readback = await this.secrets.get(providerId);
    return readback.ok && readback.value === credential;
  }
}

const fileLegFailure = (
  keychain: CredentialDeletion,
  failure: Result<never, AppError>,
): Result<CredentialDeletion, AppError> => {
  if (keychain.cleared.length === 0 && keychain.retained.length === 0) return failure;
  return ok({ cleared: keychain.cleared, retained: [...keychain.retained, 'file'] });
};

const KEYCHAIN_UNREACHABLE_MESSAGE =
  'The macOS Keychain could not be read, so a stored API key cannot be resolved. '
  + 'Unlock the login keychain and try again.';

const MIGRATION_EVENT_BY_OUTCOME: Record<CredentialMigrationOutcome, string> = {
  migrated: 'credential_migrated',
  value_conflict: 'credential_value_conflict',
  superseded: 'credential_superseded',
};

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
      event: MIGRATION_EVENT_BY_OUTCOME[outcome],
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
