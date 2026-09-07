import { eq, sql, type SQL } from 'drizzle-orm';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { z } from 'zod';

import {
  APP_GLOBAL_CONFIG_KEYS,
  CONFIG_KEYS,
  appError,
  ok,
  type AppError,
  type ConfigKey,
  type Result,
  type Video,
} from '@core/domain/index.js';
import type {
  CatalogRepository,
  CatalogRepositoryFactory,
  CatalogResetSingleResult,
  ConfigScope,
  ConfigStore,
} from '@core/server/index.js';
import { JOB_CANCELLED_ERROR_MESSAGE } from '@core/server/index.js';

import { CatalogAppError, type HomeLock } from './home-lock.js';
import { createCatalogSchemaSql, createConfigSchemaSql, schema, videos } from './schema.js';

const dbDirectoryName = '.ai-video-cataloger';
const dbFileName = 'catalog.db';
const configFileName = 'config.json';

const appGlobalConfigKeys = new Set<string>(APP_GLOBAL_CONFIG_KEYS);

const persistedConfigSchema = z.record(z.string(), z.string());
const errnoSchema = z.object({ code: z.string() });
const READ_ONLY_ERRNO_CODES: ReadonlySet<string> = new Set(['EACCES', 'EROFS', 'EPERM']);
const SNAPSHOT_LEASE_RETRY_MS = 10;
export const SNAPSHOT_LEASE_TIMEOUT_MS = 30_000;

type DatabaseSchema = typeof schema;
type SqlJsDrizzle = SQLJsDatabase<DatabaseSchema>;

interface DatabaseFileState {
  mtimeMs: number;
  size: number;
}

export interface SqlJsAdapterOptions {
  homeDirectory?: string | undefined;
}

export const acquireSnapshotLease = async (lock: HomeLock, signal?: AbortSignal | undefined): Promise<void> => {
  const deadline = Date.now() + SNAPSHOT_LEASE_TIMEOUT_MS;
  for (;;) {
    if (signal?.aborted === true) throw cancelledError();
    try {
      lock.acquireLease();
      return;
    } catch (cause) {
      if (!(cause instanceof CatalogAppError) || cause.appError.code !== 'catalog_locked') throw cause;
      if (Date.now() >= deadline) throw cause;
      await sleepUntilRetry(signal);
    }
  }
};

export const verifySnapshotIntegrity = (SQL: SqlJsStatic, targetPath: string, message: string): void => {
  const client = new SQL.Database(readFileSync(targetPath));
  try {
    if (client.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') {
      throw new CatalogAppError(appError('backup_integrity_failed', message));
    }
  } finally {
    client.close();
  }
};

export const removeSnapshotFile = (targetPath: string): void => {
  for (const filePath of [targetPath, `${targetPath}.tmp`]) {
    try {
      unlinkSync(filePath);
    } catch (cause) {
      if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause;
    }
  }
};

const sleepUntilRetry = (signal?: AbortSignal | undefined): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted === true) {
    reject(cancelledError());
    return;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = (): void => {
    if (timer !== null) clearTimeout(timer);
    reject(cancelledError());
  };
  timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, SNAPSHOT_LEASE_RETRY_MS);
  signal?.addEventListener('abort', onAbort, { once: true });
});

const cancelledError = (): CatalogAppError =>
  new CatalogAppError(appError('processing_error', JOB_CANCELLED_ERROR_MESSAGE));

interface CachedCatalog {
  repository: SqlJsCatalogRepository;
  leases: number;
}

type OpenOutcome = { kind: 'opened'; repository: CatalogRepository | null } | { kind: 'all-leased' };

export const CATALOG_LEASE_WAIT_TIMEOUT_MS = 30_000;

export class SqlJsCatalogRepositoryFactory implements CatalogRepositoryFactory {
  private readonly opened = new Map<string, CachedCatalog>();
  private readonly maxOpen: number;
  private readonly waitTimeoutMs: number;
  private readonly idleWaiters = new Set<() => void>();
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: { maxOpen?: number; waitTimeoutMs?: number } = {}) {
    this.maxOpen = z.number().int().positive().parse(options.maxOpen ?? 8);
    this.waitTimeoutMs = z.number().int().nonnegative().parse(options.waitTimeoutMs ?? CATALOG_LEASE_WAIT_TIMEOUT_MS);
  }

  async open(folder: string): Promise<Result<CatalogRepository, AppError>> {
    const opened = await this.openWhenLeasable(folder, false);
    if (!opened.ok) return opened;
    if (opened.value === null) return { ok: false, error: appError('internal', 'Catalog was not opened') };
    return ok(opened.value);
  }

  openIfExists(folder: string): Promise<Result<CatalogRepository | null, AppError>> {
    return this.openWhenLeasable(folder, true);
  }

  dispose(): Promise<Result<void, AppError>> {
    return this.serial(async () => {
      this.disposed = true;
      this.wakeIdleWaiters();
      for (const [folder, entry] of this.opened) {
        const closed = await entry.repository.close();
        if (!closed.ok) return closed;
        this.opened.delete(folder);
      }
      return ok(undefined);
    });
  }

  private async openWhenLeasable(
    folder: string,
    existingOnly: boolean,
  ): Promise<Result<CatalogRepository | null, AppError>> {
    const deadline = Date.now() + this.waitTimeoutMs;
    for (;;) {
      const attempt = await this.serial(() => this.openFolder(folder, existingOnly));
      if (!attempt.ok) return attempt;
      if (attempt.value.kind === 'opened') return ok(attempt.value.repository);
      if (!await this.waitForIdleLease(deadline)) {
        return { ok: false, error: appError('conflict', 'All catalog cache entries are leased') };
      }
    }
  }

  private waitForIdleLease(deadline: number): Promise<boolean> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.resolve(false);
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const wake = (): void => {
        if (timer !== null) clearTimeout(timer);
        this.idleWaiters.delete(wake);
        resolve(true);
      };
      timer = setTimeout(() => {
        this.idleWaiters.delete(wake);
        resolve(false);
      }, remaining);
      this.idleWaiters.add(wake);
    });
  }

  private wakeIdleWaiters(): void {
    for (const wake of [...this.idleWaiters]) wake();
  }

  private async openFolder(folder: string, existingOnly: boolean): Promise<Result<OpenOutcome, AppError>> {
    if (this.disposed) return { ok: false, error: appError('conflict', 'Catalog factory is disposed') };
    const normalizedFolder = path.resolve(z.string().parse(folder));
    const canonicalFolder = realpathSync.native(normalizedFolder);
    let entry = this.opened.get(canonicalFolder);
    if (entry === undefined) {
      if (existingOnly && !existsSync(catalogDatabasePath(normalizedFolder))) {
        return ok({ kind: 'opened', repository: null });
      }
      if (this.opened.size >= this.maxOpen) {
        const idle = [...this.opened].find(([, candidate]) => candidate.leases === 0);
        if (idle === undefined) return ok({ kind: 'all-leased' });
        const closed = await idle[1].repository.close();
        if (!closed.ok) return closed;
        this.opened.delete(idle[0]);
      }
      const opened = await openSqlJsDatabase(catalogDatabasePath(normalizedFolder));
      if (!opened.ok) return opened;
      entry = {
        leases: 0,
        repository: new SqlJsCatalogRepository(opened.value.databasePath, opened.value.SQL, opened.value.client, opened.value.db, opened.value.fileState, opened.value.persistent),
      };
    }
    this.opened.delete(canonicalFolder);
    this.opened.set(canonicalFolder, entry);
    entry.leases += 1;
    const leasedEntry = entry;
    return ok({
      kind: 'opened',
      repository: new CatalogLease(entry.repository, () => {
        leasedEntry.leases -= 1;
        this.wakeIdleWaiters();
      }),
    });
  }

  private async serial<T>(operation: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    const previous = this.tail;
    let release = (): void => {};
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } catch (cause) {
      return repositoryFailure(cause);
    } finally {
      release();
    }
  }
}

class CatalogLease implements CatalogRepository {
  private closed = false;
  constructor(private readonly repository: CatalogRepository, private readonly release: () => void) {}

  databasePath(): string | null { return this.repository.databasePath(); }
  writable(): boolean { return this.repository.writable(); }
  close(): Promise<Result<void, AppError>> {
    if (!this.closed) {
      this.closed = true;
      this.release();
    }
    return Promise.resolve(ok(undefined));
  }

  private run<T>(operation: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    if (this.closed) return Promise.resolve({ ok: false, error: appError('conflict', 'Catalog lease is closed') });
    return operation();
  }

  listVideos: CatalogRepository['listVideos'] = (...args) => this.run(() => this.repository.listVideos(...args));

  findVideoByPath: CatalogRepository['findVideoByPath'] = (...args) => this.run(() => this.repository.findVideoByPath(...args));

  findVideoByHash: CatalogRepository['findVideoByHash'] = (...args) => this.run(() => this.repository.findVideoByHash(...args));

  createVideo: CatalogRepository['createVideo'] = (...args) => this.run(() => this.repository.createVideo(...args));

  updateVideoStatus: CatalogRepository['updateVideoStatus'] = (...args) => this.run(() => this.repository.updateVideoStatus(...args));

  updateVideoPath: CatalogRepository['updateVideoPath'] = (...args) => this.run(() => this.repository.updateVideoPath(...args));

  updateVideoNewName: CatalogRepository['updateVideoNewName'] = (...args) => this.run(() => this.repository.updateVideoNewName(...args));

  clearVideos: CatalogRepository['clearVideos'] = (...args) => this.run(() => this.repository.clearVideos(...args));

  resetVideoByOriginalName: CatalogRepository['resetVideoByOriginalName'] = (...args) => this.run(() => this.repository.resetVideoByOriginalName(...args));
}

export class JsonConfigStore implements ConfigStore {
  constructor(private readonly options: SqlJsAdapterOptions = {}) {}

  async get(scope: ConfigScope, key: ConfigKey): Promise<Result<string | null, AppError>> {
    const values = await this.read(scope);
    if (!values.ok) return values;
    return ok(values.value[key] ?? null);
  }

  async getAll(scope: ConfigScope): Promise<Result<Partial<Record<ConfigKey, string>>, AppError>> {
    const values = await this.read(scope);
    if (!values.ok) return values;
    const knownValues: Partial<Record<ConfigKey, string>> = {};
    for (const key of CONFIG_KEYS) {
      const value = values.value[key];
      if (value !== undefined) knownValues[key] = value;
    }
    return ok(knownValues);
  }

  async set(scope: ConfigScope, key: ConfigKey, value: string): Promise<Result<{ previousValue: string | null }, AppError>> {
    const values = await this.read(scope);
    if (!values.ok) return values;
    const previousValue = values.value[key] ?? null;
    const merged: Record<string, string> = { ...values.value, [key]: value };
    const next = scope.kind === 'folder'
      ? Object.fromEntries(
          Object.entries(merged).filter(([entryKey]) => entryKey === key || !appGlobalConfigKeys.has(entryKey)),
        )
      : merged;
    const written = writeConfig(configPath(scopeRoot(scope, this.options)), next);
    if (!written.ok) return written;
    return ok({ previousValue });
  }

  async delete(scope: ConfigScope, key: ConfigKey): Promise<Result<{ previousValue: string | null }, AppError>> {
    const values = await this.read(scope);
    if (!values.ok) return values;
    const previousValue = values.value[key] ?? null;
    if (previousValue === null) return ok({ previousValue });
    const next = Object.fromEntries(Object.entries(values.value).filter(([entryKey]) => entryKey !== key));
    const written = writeConfig(configPath(scopeRoot(scope, this.options)), next);
    if (!written.ok) return written;
    return ok({ previousValue });
  }

  private read(scope: ConfigScope): Promise<Result<Record<string, string>, AppError>> {
    return Promise.resolve(readConfig(configPath(scopeRoot(scope, this.options))));
  }
}

class SqlJsCatalogRepository implements CatalogRepository {
  private closed = false;
  private dirty = false;

  async close(): Promise<Result<void, AppError>> {
    if (this.closed) return ok(undefined);
    try {
      if (this.dirty && this.persistent) persistDatabase(this.filePath, this.client);
      this.client.close();
      this.closed = true;
      this.dirty = false;
      return ok(undefined);
    } catch (cause) {
      return repositoryFailure(cause);
    }
  }

  constructor(
    private readonly filePath: string,
    private readonly SQL: SqlJsStatic,
    private client: Database,
    private db: SqlJsDrizzle,
    private fileState: DatabaseFileState | null,
    private readonly persistent: boolean,
  ) {}

  databasePath(): string | null {
    return this.filePath;
  }

  writable(): boolean {
    return this.persistent;
  }

  async listVideos(): Promise<Result<Video[], AppError>> {
    return this.read(() => this.db.select().from(videos).all().map(rowToVideo));
  }

  async findVideoByPath(originalPath: string): Promise<Result<Video | null, AppError>> {
    return this.findBy(eq(videos.originalPath, originalPath));
  }

  async findVideoByHash(fileHash: string): Promise<Result<Video | null, AppError>> {
    return this.findBy(eq(videos.fileHash, fileHash));
  }

  async createVideo(input: Omit<Video, 'id'>): Promise<Result<Video, AppError>> {
    return this.write(() => {
      this.db.insert(videos).values({
        originalPath: input.originalPath,
        originalName: input.originalName,
        newName: input.newName,
        fileHash: input.fileHash,
        status: input.status,
        errorMessage: input.errorMessage,
      }).run();
      return this.findByPathOrThrow(input.originalPath);
    });
  }

  async updateVideoStatus(
    id: number,
    status: Video['status'],
    errorMessage: string | null,
  ): Promise<Result<Video, AppError>> {
    return this.updateExisting(id, () => {
      this.db.update(videos)
        .set({ status, errorMessage, updatedAt: sql`datetime('now')` })
        .where(eq(videos.id, id))
        .run();
    });
  }

  async updateVideoPath(id: number, originalPath: string): Promise<Result<Video, AppError>> {
    return this.updateExisting(id, () => {
      this.db.update(videos)
        .set({ originalPath, updatedAt: sql`datetime('now')` })
        .where(eq(videos.id, id))
        .run();
    });
  }

  async updateVideoNewName(id: number, newName: string): Promise<Result<Video, AppError>> {
    return this.updateExisting(id, () => {
      this.db.update(videos)
        .set({ newName, updatedAt: sql`datetime('now')` })
        .where(eq(videos.id, id))
        .run();
    });
  }

  async clearVideos(): Promise<Result<{ cleared: number }, AppError>> {
    return this.write(() => {
      const rows = this.db.select({ id: videos.id }).from(videos).all();
      this.db.delete(videos).run();
      return { cleared: rows.length };
    });
  }

  async resetVideoByOriginalName(filename: string): Promise<Result<CatalogResetSingleResult | null, AppError>> {
    return this.write(() => {
      const beforeRow = this.db.select().from(videos).where(eq(videos.originalName, filename)).get();
      if (beforeRow === undefined) return null;
      const before = rowToVideo(beforeRow);
      this.db.update(videos)
        .set({ status: 'pending', errorMessage: null, newName: null, updatedAt: sql`datetime('now')` })
        .where(eq(videos.id, before.id))
        .run();
      const after = this.findByIdOrThrow(before.id);
      return { before, after };
    });
  }

  private async findBy(whereClause: SQL<unknown>): Promise<Result<Video | null, AppError>> {
    return this.read(() => {
      const row = this.db.select().from(videos).where(whereClause).get();
      return row === undefined ? null : rowToVideo(row);
    });
  }

  private async updateExisting(id: number, update: () => void): Promise<Result<Video, AppError>> {
    return this.write(() => {
      const before = this.db.select({ id: videos.id }).from(videos).where(eq(videos.id, id)).get();
      if (before === undefined) throw new RepositoryError(appError('video_not_found', `Video not found: ${id}`));
      update();
      return this.findByIdOrThrow(id);
    });
  }

  private findByPathOrThrow(originalPath: string): Video {
    const row = this.db.select().from(videos).where(eq(videos.originalPath, originalPath)).get();
    if (row === undefined) throw new RepositoryError(appError('internal', `Video insert did not return a row: ${originalPath}`));
    return rowToVideo(row);
  }

  private findByIdOrThrow(id: number): Video {
    const row = this.db.select().from(videos).where(eq(videos.id, id)).get();
    if (row === undefined) throw new RepositoryError(appError('video_not_found', `Video not found: ${id}`));
    return rowToVideo(row);
  }

  private async read<T>(operation: () => T): Promise<Result<T, AppError>> {
    try {
      if (this.closed) return { ok: false, error: appError('conflict', 'Catalog is closed') };
      this.reloadIfChanged();
      return ok(operation());
    } catch (cause) {
      return repositoryFailure(cause);
    }
  }

  private async write<T>(operation: () => T): Promise<Result<T, AppError>> {
    try {
      if (this.closed) return { ok: false, error: appError('conflict', 'Catalog is closed') };
      this.reloadIfChanged();
      const value = operation();
      this.dirty = true;
      if (!this.persistent) return ok(value);
      persistDatabase(this.filePath, this.client);
      this.fileState = databaseFileState(this.filePath);
      this.dirty = false;
      return ok(value);
    } catch (cause) {
      this.fileState = null;
      return repositoryFailure(cause);
    }
  }

  private reloadIfChanged(): void {
    if (!this.persistent || this.dirty) return;
    const diskState = databaseFileState(this.filePath);
    if (this.fileState !== null && sameFileState(this.fileState, diskState)) return;
    const client = new this.SQL.Database(readFileSync(this.filePath));
    client.run(createCatalogSchemaSql);
    client.run(createConfigSchemaSql);
    this.client.close();
    this.client = client;
    this.db = drizzle(client, { schema });
    this.fileState = diskState;
  }
}

class RepositoryError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
  }
}

const openSqlJsDatabase = async (
  databasePath: string,
): Promise<Result<{
  databasePath: string;
  SQL: SqlJsStatic;
  client: Database;
  db: SqlJsDrizzle;
  fileState: DatabaseFileState | null;
  persistent: boolean;
}, AppError>> => {
  try {
    const SQL = await initSqlJs(sqlJsWasmConfig());
    const client = existsSync(databasePath) ? new SQL.Database(readFileSync(databasePath)) : new SQL.Database();
    client.run(createCatalogSchemaSql);
    client.run(createConfigSchemaSql);
    const opened = { databasePath, SQL, client, db: drizzle(client, { schema }) };
    if (!persistWhereWritable(databasePath, client)) return ok({ ...opened, fileState: null, persistent: false });
    return ok({ ...opened, fileState: databaseFileState(databasePath), persistent: true });
  } catch (cause) {
    return repositoryFailure(cause);
  }
};

const persistWhereWritable = (databasePath: string, client: Database): boolean => {
  try {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    persistDatabase(databasePath, client);
    return true;
  } catch (cause) {
    if (isReadOnlyErrno(cause, path.dirname(databasePath))) return false;
    throw cause;
  }
};

const nearestExistingAncestor = (target: string): string => {
  let current = target;
  while (!existsSync(current) && current !== path.dirname(current)) current = path.dirname(current);
  return current;
};

const rejectsWrites = (target: string): boolean => {
  try {
    accessSync(nearestExistingAncestor(target), constants.W_OK);
    return false;
  } catch (cause) {
    const parsed = errnoSchema.safeParse(cause);
    return parsed.success && READ_ONLY_ERRNO_CODES.has(parsed.data.code);
  }
};

const isReadOnlyErrno = (cause: unknown, target: string): boolean => {
  const parsed = errnoSchema.safeParse(cause);
  if (!parsed.success) return false;
  if (READ_ONLY_ERRNO_CODES.has(parsed.data.code)) return true;
  // node 22 recursive mkdirSync reports EROFS as ENOENT on read-only exFAT/fskit mounts
  return parsed.data.code === 'ENOENT' && rejectsWrites(target);
};

const persistDatabase = (databasePath: string, client: Database): void => {
  const tempPath = `${databasePath}.tmp`;
  const descriptor = openSync(tempPath, 'w');
  try {
    writeFileSync(descriptor, client.export());
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(tempPath, databasePath);
};

const databaseFileState = (databasePath: string): DatabaseFileState => {
  const stats = statSync(databasePath);
  return { mtimeMs: stats.mtimeMs, size: stats.size };
};

const sameFileState = (left: DatabaseFileState, right: DatabaseFileState): boolean =>
  left.mtimeMs === right.mtimeMs && left.size === right.size;

export const sqlJsWasmConfig = (): { locateFile: (file: string) => string } | undefined => {
  const wasmPath = findSqlJsWasmPath();
  return wasmPath === null ? undefined : { locateFile: () => wasmPath };
};

const findSqlJsWasmPath = (): string | null => {
  const bundledPath = bundledSqlJsWasmPath();
  if (bundledPath !== null) return bundledPath;
  const packagedPath = packagedSqlJsWasmPath();
  if (packagedPath !== null) return packagedPath;
  try {
    const require = createRequire(import.meta.url);
    const modulePath = require.resolve('sql.js');
    const moduleDirectory = path.dirname(modulePath);
    const candidates = [
      path.join(moduleDirectory, 'sql-wasm.wasm'),
      path.join(moduleDirectory, 'dist', 'sql-wasm.wasm'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  } catch {
    return null;
  }
};

const packagedSqlJsWasmPath = (): string | null => {
  const resourcesPath = process.resourcesPath;
  if (typeof resourcesPath !== 'string' || resourcesPath.length === 0) return null;
  const candidates = [
    path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'sql-wasm.wasm'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

const bundledSqlJsWasmPath = (): string | null => {
  const candidate = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql-wasm.wasm');
  return existsSync(candidate) ? candidate : null;
};

const catalogDatabasePath = (folder: string): string =>
  path.join(folder, dbDirectoryName, dbFileName);

const configPath = (root: string): string =>
  path.join(root, dbDirectoryName, configFileName);

const scopeRoot = (scope: ConfigScope, options: SqlJsAdapterOptions): string => {
  if (scope.kind === 'folder') return path.resolve(scope.folder);
  return options.homeDirectory ?? homedir();
};

const readConfig = (filePath: string): Result<Record<string, string>, AppError> => {
  if (!existsSync(filePath)) return ok({});
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    const result = persistedConfigSchema.safeParse(parsed);
    if (result.success) return ok(result.data);
    console.error(`Invalid config file ${filePath}: ${result.error.message}`);
    return ok({});
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`Invalid config file ${filePath}: ${message}`);
    return ok({});
  }
};

const writeConfig = (filePath: string, values: Record<string, string>): Result<void, AppError> => {
  const tempPath = `${filePath}.tmp`;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(tempPath, JSON.stringify(values, null, 2), 'utf8');
    renameSync(tempPath, filePath);
    return ok(undefined);
  } catch (cause) {
    return repositoryFailure(cause);
  }
};

const rowToVideo = (row: typeof videos.$inferSelect): Video => ({
  id: row.id,
  originalPath: row.originalPath,
  originalName: row.originalName,
  newName: row.newName,
  fileHash: row.fileHash,
  status: row.status,
  createdAt: normalizeSqliteDateTime(row.createdAt),
  updatedAt: normalizeSqliteDateTime(row.updatedAt),
  errorMessage: row.errorMessage,
});

const normalizeSqliteDateTime = (value: string): string => {
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(value) ? value : `${value.replace(' ', 'T')}.000Z`;
  return z.iso.datetime().parse(iso);
};

const repositoryFailure = <T>(cause: unknown): Result<T, AppError> => {
  if (cause instanceof RepositoryError) return { ok: false, error: cause.appError };
  const message = cause instanceof Error ? cause.message : 'Database operation failed';
  return { ok: false, error: appError('internal', message, cause) };
};
