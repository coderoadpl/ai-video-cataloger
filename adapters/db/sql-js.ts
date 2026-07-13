import { eq, sql, type SQL } from 'drizzle-orm';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { z } from 'zod';

import {
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

import { createCatalogSchemaSql, createConfigSchemaSql, schema, videos } from './schema.js';

const dbDirectoryName = '.ai-video-cataloger';
const dbFileName = 'catalog.db';
const configFileName = 'config.json';

const persistedConfigSchema = z.record(z.string(), z.string());

type DatabaseSchema = typeof schema;
type SqlJsDrizzle = SQLJsDatabase<DatabaseSchema>;

export interface SqlJsAdapterOptions {
  homeDirectory?: string | undefined;
}

export class SqlJsCatalogRepositoryFactory implements CatalogRepositoryFactory {
  private readonly opened = new Map<string, SqlJsCatalogRepository>();

  async open(folder: string): Promise<Result<CatalogRepository, AppError>> {
    const normalizedFolder = path.resolve(folder);
    const existing = this.opened.get(normalizedFolder);
    if (existing !== undefined) return ok(existing);
    const opened = await openSqlJsDatabase(catalogDatabasePath(normalizedFolder));
    if (!opened.ok) return opened;
    const repository = new SqlJsCatalogRepository(opened.value.databasePath, opened.value.client, opened.value.db);
    this.opened.set(normalizedFolder, repository);
    return ok(repository);
  }
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
    values.value[key] = value;
    const written = writeConfig(configPath(scopeRoot(scope, this.options)), values.value);
    if (!written.ok) return written;
    return ok({ previousValue });
  }

  private read(scope: ConfigScope): Promise<Result<Record<string, string>, AppError>> {
    return Promise.resolve(readConfig(configPath(scopeRoot(scope, this.options))));
  }
}

class SqlJsCatalogRepository implements CatalogRepository {
  constructor(
    private readonly filePath: string,
    private readonly client: Database,
    private readonly db: SqlJsDrizzle,
  ) {}

  databasePath(): string | null {
    return this.filePath;
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
      return ok(operation());
    } catch (cause) {
      return repositoryFailure(cause);
    }
  }

  private async write<T>(operation: () => T): Promise<Result<T, AppError>> {
    try {
      const value = operation();
      persistDatabase(this.filePath, this.client);
      return ok(value);
    } catch (cause) {
      return repositoryFailure(cause);
    }
  }
}

class RepositoryError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
  }
}

const openSqlJsDatabase = async (
  databasePath: string,
): Promise<Result<{ databasePath: string; client: Database; db: SqlJsDrizzle }, AppError>> => {
  try {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const SQL = await initSqlJs(sqlJsWasmConfig());
    const client = existsSync(databasePath) ? new SQL.Database(readFileSync(databasePath)) : new SQL.Database();
    client.run(createCatalogSchemaSql);
    client.run(createConfigSchemaSql);
    persistDatabase(databasePath, client);
    return ok({ databasePath, client, db: drizzle(client, { schema }) });
  } catch (cause) {
    return repositoryFailure(cause);
  }
};

const persistDatabase = (databasePath: string, client: Database): void => {
  writeFileSync(databasePath, Buffer.from(client.export()));
};

const sqlJsWasmConfig = (): { locateFile: (file: string) => string } | undefined => {
  const wasmPath = findSqlJsWasmPath();
  return wasmPath === null ? undefined : { locateFile: () => wasmPath };
};

const findSqlJsWasmPath = (): string | null => {
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
    return ok(result.success ? result.data : {});
  } catch {
    return ok({});
  }
};

const writeConfig = (filePath: string, values: Record<string, string>): Result<void, AppError> => {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(values, null, 2), 'utf8');
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
  return z.string().datetime().parse(iso);
};

const repositoryFailure = <T>(cause: unknown): Result<T, AppError> => {
  if (cause instanceof RepositoryError) return { ok: false, error: cause.appError };
  const message = cause instanceof Error ? cause.message : 'Database operation failed';
  return { ok: false, error: appError('internal', message, cause) };
};
