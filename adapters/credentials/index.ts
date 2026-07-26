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
const credentialsDocumentSchema = z.record(z.string().min(1), z.unknown());

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

interface FileEntries {
  values: Record<string, StoredEntry>;
  unreadable: Record<string, unknown>;
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
    const entries = await this.read();
    if (!entries.ok) return entries;
    const stored = entries.value.values[providerId];
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
    const entries = await this.read();
    if (!entries.ok) return entries;
    const stored = entries.value.values[providerId];
    if (stored === undefined) return ok(null);
    const archivePath = `${this.filePath}.conflict-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const archived = await this.readFileEntries(archivePath);
    if (!archived.ok) return archived;
    const merged = { ...archived.value, values: { ...archived.value.values, [providerId]: stored } };
    if (!(await this.writeFileEntries(archivePath, merged))) {
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
      const remaining = withoutProvider(entries.value, providerId);
      if (!(await this.replaceArchive(archivePath, remaining))) {
        return { ok: false, error: appError('internal', 'Could not remove provider credential') };
      }
      cleared = true;
    }
    return ok(cleared);
  }

  private async replaceArchive(archivePath: string, remaining: FileEntries): Promise<boolean> {
    if (!isEmpty(remaining)) return this.writeFileEntries(archivePath, remaining);
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
      for (const providerId of Object.keys(archived.value.values)) conflicts.push({ providerId, archivePath });
    }
    return ok(conflicts);
  }

  private async store(providerId: string, entry: CredentialEntry): Promise<Result<void, AppError>> {
    if (providerId.trim().length === 0 || entry.value.length === 0) {
      return { ok: false, error: appError('invalid_config_value', 'Provider ID and credential must not be empty') };
    }
    const entries = await this.read();
    if (!entries.ok) return entries;
    const written = await this.writeAll({
      values: { ...entries.value.values, [providerId]: writeEntry(entry) },
      unreadable: omitKey(entries.value.unreadable, providerId),
    });
    if (!written) return { ok: false, error: appError('internal', 'Could not store provider credential') };
    return ok(undefined);
  }

  async delete(providerId: string): Promise<Result<CredentialDeletion, AppError>> {
    const entries = await this.read();
    if (!entries.ok) return entries;
    // Rewriting an entry the parser could not read would destroy the only copy of a key the
    // user can still rescue by hand, so it is reported instead of removed.
    if (providerId in entries.value.unreadable) {
      return ok({ cleared: [], retained: ['file'], unreadableEntry: this.filePath });
    }
    if (!(providerId in entries.value.values)) return ok({ cleared: [], retained: [] });
    const remaining = withoutProvider(entries.value, providerId);
    if (isEmpty(remaining)) {
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
    const entries = await this.read();
    if (!entries.ok) return entries;
    return ok(Object.keys(entries.value.values));
  }

  private writeAll(entries: FileEntries): Promise<boolean> {
    return this.writeFileEntries(this.filePath, entries);
  }

  private async writeFileEntries(filePath: string, entries: FileEntries): Promise<boolean> {
    const temporaryPath = `${filePath}.${process.pid.toString(36)}.${randomBytes(6).toString('hex')}.tmp`;
    // One key holds one entry, so a provider present on both sides has to be resolved: the parsed
    // value is the one the caller just decided to keep, and letting the unparsed copy land on top
    // of it would write away the value this call exists to preserve.
    const merged = { ...entries.unreadable, ...entries.values };
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600);
      return true;
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      return false;
    }
  }

  async unreadableEntries(): Promise<Result<string[], AppError>> {
    const parsed = await this.read();
    if (!parsed.ok) return parsed;
    return ok(Object.keys(parsed.value.unreadable));
  }

  private read(): Promise<Result<FileEntries, AppError>> {
    return this.readFileEntries(this.filePath);
  }

  // One hand-edited entry must not blind the app to every other key in the file, so each entry
  // is validated on its own and only the file's outer shape can fail the whole read. What did not
  // parse is carried along untouched: every write merges it back, so a salvaged read never
  // becomes the write that destroys the entry the user still has to rescue.
  private async readFileEntries(filePath: string): Promise<Result<FileEntries, AppError>> {
    if (!existsSync(filePath)) return ok({ values: {}, unreadable: {} });
    let decoded: unknown;
    try {
      decoded = JSON.parse(await readFile(filePath, 'utf8'));
      await chmod(filePath, 0o600);
    } catch {
      return { ok: false, error: appError('internal', 'Could not read provider credentials') };
    }
    const document = credentialsDocumentSchema.safeParse(decoded);
    if (!document.success) {
      return { ok: false, error: appError('invalid_config_value', 'Credentials file has an invalid format') };
    }
    const values: Record<string, StoredEntry> = {};
    const unreadable: Record<string, unknown> = {};
    for (const [providerId, stored] of Object.entries(document.data)) {
      const entry = storedEntrySchema.safeParse(stored);
      if (entry.success) values[providerId] = entry.data;
      else unreadable[providerId] = stored;
    }
    return ok({ values, unreadable });
  }
}

const omitKey = <T,>(record: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));

const withoutProvider = (entries: FileEntries, providerId: string): FileEntries => ({
  values: omitKey(entries.values, providerId),
  unreadable: omitKey(entries.unreadable, providerId),
});

const isEmpty = (entries: FileEntries): boolean =>
  Object.keys(entries.values).length === 0 && Object.keys(entries.unreadable).length === 0;

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
    const entry = await this.legacy.entry(providerId);
    if (!entry.ok) return entry;
    // A stale copy was superseded by a verified keychain write, so it is never a live value —
    // not even when the keychain that superseded it has since become unreachable or been reset.
    const usable = entry.value?.state === 'stale' ? null : entry.value;
    if (usable?.state === 'pending') return ok(usable.value);
    if (ready) {
      const fromKeychain = await this.secrets.get(providerId);
      if (!fromKeychain.ok) {
        this.keychainFailed = true;
        if (usable !== null) return ok(usable.value);
        return { ok: false, error: appError('keychain_unavailable', KEYCHAIN_UNREACHABLE_MESSAGE) };
      }
      this.keychainFailed = false;
      if (fromKeychain.value !== null) return ok(fromKeychain.value);
      if (entry.value?.state === 'stale') await this.dropMigrated(providerId, 'superseded');
    }
    return ok(usable?.value ?? null);
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
    const unreadable = file.value.unreadableEntry;
    return ok({
      cleared: [...keychain.cleared, ...(clearedFile ? ['file' as const] : [])],
      retained: [...keychain.retained, ...file.value.retained],
      ...(unreadable === undefined ? {} : { unreadableEntry: unreadable }),
    });
  }

  async legacyPlaintextProviders(): Promise<Result<string[], AppError>> {
    if (!(await this.keychainReady())) return ok([]);
    return this.legacy.list();
  }

  credentialValueConflicts(): Promise<Result<CredentialValueConflict[], AppError>> {
    return this.legacy.conflictArchives();
  }

  unreadableCredentialEntries(): Promise<Result<string[], AppError>> {
    return this.legacy.unreadableEntries();
  }

  private async dropSupersededPlaintext(providerId: string): Promise<Result<void, AppError>> {
    const removed = await this.legacy.delete(providerId);
    if (removed.ok) return ok(undefined);
    const retried = await this.legacy.delete(providerId);
    if (retried.ok) return ok(undefined);
    this.plaintextPending = true;
    this.migration = null;
    // The keychain now holds a write-verified newer value, so this leftover copy must never
    // be promoted over it by a later migration.
    const marked = await this.legacy.markStale(providerId);
    if (marked.ok) return retried;
    return {
      ok: false,
      error: appError(
        'internal',
        `The API key for "${providerId}" is stored in the macOS Keychain, but the superseded copy in `
        + '~/.ai-video-cataloger/credentials.json could neither be removed nor marked superseded. '
        + 'Remove that entry by hand.',
      ),
    };
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
    // A stale copy stays superseded even when the keychain item is gone (a reset login
    // keychain, a manual removal): promoting it would resurrect a key the user replaced.
    if (entry.value.state === 'stale') return this.dropMigrated(providerId, 'superseded');
    if (existing.value === null) return this.promote(providerId, entry.value.value, 'migrated');
    if (entry.value.state === 'pending') return this.promote(providerId, entry.value.value, 'value_conflict');
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
