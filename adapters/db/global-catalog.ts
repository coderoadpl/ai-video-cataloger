import { eq } from 'drizzle-orm';
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

import {
  GLOBAL_CATALOG_SCHEMA_VERSION,
  appError,
  normalizeTagList,
  normalizeTagName,
  ok,
  type AppError,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type Result,
} from '@core/domain/index.js';
import type {
  CatalogFileRecord,
  CatalogTagAliasResult,
  CatalogTagSummary,
  GlobalCatalogCounts,
  GlobalCatalogStore,
} from '@core/server/index.js';

import {
  analyses,
  createGlobalCatalogSchemaSqlV1,
  fileTags,
  files,
  folders,
  globalCatalogSchema,
  migrateGlobalCatalogSchemaSqlV2,
  schemaMeta,
  tagAliases,
  tags,
} from './global-catalog-schema.js';

const dbDirectoryName = '.ai-video-cataloger';
const dbFileName = 'catalog.db';

type GlobalSchema = typeof globalCatalogSchema;
type GlobalDrizzle = SQLJsDatabase<GlobalSchema>;

interface FileState {
  mtimeMs: number;
  size: number;
}

export interface GlobalCatalogAdapterOptions {
  homeDirectory?: string | undefined;
}

export class SqlJsGlobalCatalogStore implements GlobalCatalogStore {
  private readonly filePath: string;
  private state: {
    SQL: SqlJsStatic;
    client: Database;
    db: GlobalDrizzle;
    fileState: FileState;
  } | null = null;

  constructor(options: GlobalCatalogAdapterOptions = {}) {
    this.filePath = globalCatalogPath(options.homeDirectory ?? homedir());
  }

  databasePath(): string {
    return this.filePath;
  }

  async listFolders(): Promise<Result<CatalogFolder[], AppError>> {
    return this.read((db) => db.select().from(folders).all().map(rowToFolder));
  }

  async getFolder(folderId: string): Promise<Result<CatalogFolder | null, AppError>> {
    return this.read((db) => {
      const row = db.select().from(folders).where(eq(folders.folderId, folderId)).get();
      return row === undefined ? null : rowToFolder(row);
    });
  }

  async upsertFolder(folder: CatalogFolder): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(folders)
        .values(folderToRow(folder))
        .onConflictDoUpdate({
          target: folders.folderId,
          set: {
            currentPath: folder.currentPath,
            displayName: folder.displayName,
            firstSeenAt: folder.firstSeenAt,
            lastSeenAt: folder.lastSeenAt,
          },
        })
        .run();
    });
  }

  async getFile(fingerprint: string): Promise<Result<CatalogFile | null, AppError>> {
    return this.read((db) => {
      const row = db.select().from(files).where(eq(files.fingerprint, fingerprint)).get();
      return row === undefined ? null : rowToFile(row);
    });
  }

  async upsertFile(file: CatalogFile): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(files)
        .values(fileToRow(file))
        .onConflictDoUpdate({
          target: files.fingerprint,
          set: {
            folderId: file.folderId,
            fileName: file.fileName,
            size: file.size,
            durationS: file.durationS,
            gpsLat: file.gpsLat,
            gpsLon: file.gpsLon,
            processedAt: file.processedAt,
            analyzer: file.analyzer,
            model: file.model,
          },
        })
        .run();
    });
  }

  async getAnalysis(fingerprint: string): Promise<Result<CatalogAnalysis | null, AppError>> {
    return this.read((db) => {
      const row = db.select().from(analyses).where(eq(analyses.fingerprint, fingerprint)).get();
      return row === undefined ? null : rowToAnalysis(row, tagsForFingerprint(db, fingerprint));
    });
  }

  async upsertAnalysis(analysis: CatalogAnalysis): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(analyses)
        .values(analysis)
        .onConflictDoUpdate({
          target: analyses.fingerprint,
          set: {
            finalName: analysis.finalName,
            description: analysis.description,
            transcript: analysis.transcript,
            language: analysis.language,
          },
        })
        .run();
      setAnalysisTags(db, analysis.fingerprint, analysis.tags);
    });
  }

  async listFolderRecords(folderId: string): Promise<Result<CatalogFileRecord[], AppError>> {
    return this.read((db) => {
      const fileRows = db.select().from(files).where(eq(files.folderId, folderId)).all();
      return fileRows.map((fileRow) => {
        const analysisRow = db.select().from(analyses).where(eq(analyses.fingerprint, fileRow.fingerprint)).get();
        return {
          file: rowToFile(fileRow),
          analysis: analysisRow === undefined ? null : rowToAnalysis(analysisRow, tagsForFingerprint(db, fileRow.fingerprint)),
        };
      });
    });
  }

  async listTags(): Promise<Result<CatalogTagSummary[], AppError>> {
    return this.read((db) => {
      const tagRows = db.select().from(tags).all();
      const fileTagRows = db.select().from(fileTags).all();
      return tagRows
        .map((tag) => ({
          name: tag.name,
          count: fileTagRows.filter((fileTag) => fileTag.tagId === tag.tagId).length,
        }))
        .filter((tag) => tag.count > 0)
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
    });
  }

  async aliasTag(input: { from: string; to: string }): Promise<Result<CatalogTagAliasResult, AppError>> {
    const alias = normalizeTagName(input.from);
    const canonical = normalizeTagName(input.to);
    if (alias.length === 0 || canonical.length === 0) {
      return { ok: false, error: appError('validation', 'Tag aliases must normalize to non-empty tag names') };
    }
    return this.write((db) => {
      const canonicalTag = ensureTag(db, canonical);
      const aliasTag = db.select().from(tags).where(eq(tags.name, alias)).get();
      let remappedFiles = 0;
      if (aliasTag !== undefined && aliasTag.tagId !== canonicalTag.tagId) {
        const rows = db.select().from(fileTags).where(eq(fileTags.tagId, aliasTag.tagId)).all();
        remappedFiles = rows.length;
        for (const row of rows) {
          db.insert(fileTags)
            .values({ fingerprint: row.fingerprint, tagId: canonicalTag.tagId })
            .onConflictDoNothing()
            .run();
        }
        db.delete(fileTags).where(eq(fileTags.tagId, aliasTag.tagId)).run();
        db.delete(tags).where(eq(tags.tagId, aliasTag.tagId)).run();
      }
      db.insert(tagAliases)
        .values({ alias, tagId: canonicalTag.tagId })
        .onConflictDoUpdate({
          target: tagAliases.alias,
          set: { tagId: canonicalTag.tagId },
        })
        .run();
      return { alias, canonical: canonicalTag.name, remappedFiles };
    });
  }

  async counts(): Promise<Result<GlobalCatalogCounts, AppError>> {
    return this.read((db) => ({
      folders: db.select().from(folders).all().length,
      files: db.select().from(files).all().length,
      analyses: db.select().from(analyses).all().length,
    }));
  }

  private async read<T>(operation: (db: GlobalDrizzle) => T): Promise<Result<T, AppError>> {
    try {
      const state = await this.ensureOpen();
      return ok(operation(state.db));
    } catch (cause) {
      return failure(cause);
    }
  }

  private async write<T>(operation: (db: GlobalDrizzle) => T): Promise<Result<T, AppError>> {
    try {
      const state = await this.ensureOpen();
      const value = operation(state.db);
      persistDatabase(this.filePath, state.client);
      state.fileState = fileStateOf(this.filePath);
      return ok(value);
    } catch (cause) {
      this.state = null;
      return failure(cause);
    }
  }

  private async ensureOpen(): Promise<NonNullable<SqlJsGlobalCatalogStore['state']>> {
    if (this.state !== null && sameFileState(this.state.fileState, fileStateOf(this.filePath))) {
      return this.state;
    }
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const SQL = this.state?.SQL ?? await initSqlJs(sqlJsWasmConfig());
    const client = existsSync(this.filePath) ? new SQL.Database(readFileSync(this.filePath)) : new SQL.Database();
    const created = !existsSync(this.filePath);
    const migrated = migrate(client);
    if (created || migrated) persistDatabase(this.filePath, client);
    this.state?.client.close();
    this.state = {
      SQL,
      client,
      db: drizzle(client, { schema: globalCatalogSchema }),
      fileState: fileStateOf(this.filePath),
    };
    return this.state;
  }
}

const migrate = (client: Database): boolean => {
  client.run('CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER PRIMARY KEY)');
  const currentVersion = readSchemaVersion(client);
  let migrated = false;
  if (currentVersion < 1) {
    for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
    migrated = true;
  }
  if (currentVersion < 2) {
    for (const statement of migrateGlobalCatalogSchemaSqlV2) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < GLOBAL_CATALOG_SCHEMA_VERSION) {
    client.run('DELETE FROM schema_meta');
    const db = drizzle(client, { schema: globalCatalogSchema });
    db.insert(schemaMeta).values({ version: GLOBAL_CATALOG_SCHEMA_VERSION }).run();
    migrated = true;
  }
  return migrated;
};

const runMigrationStatement = (client: Database, statement: string): void => {
  try {
    client.run(statement);
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('duplicate column name')) return;
    throw cause;
  }
};

const readSchemaVersion = (client: Database): number => {
  const result = client.exec('SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1');
  const value = result[0]?.values[0]?.[0];
  return typeof value === 'number' ? value : 0;
};

const persistDatabase = (databasePath: string, client: Database): void => {
  const tempPath = `${databasePath}.tmp`;
  const descriptor = openSync(tempPath, 'w');
  try {
    writeFileSync(descriptor, Buffer.from(client.export()));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(tempPath, databasePath);
};

const fileStateOf = (databasePath: string): FileState => {
  try {
    const stats = statSync(databasePath);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return { mtimeMs: 0, size: 0 };
  }
};

const sameFileState = (left: FileState, right: FileState): boolean =>
  left.mtimeMs === right.mtimeMs && left.size === right.size;

const globalCatalogPath = (home: string): string => path.join(home, dbDirectoryName, dbFileName);

const rowToFolder = (row: typeof folders.$inferSelect): CatalogFolder => ({
  folderId: row.folderId,
  currentPath: row.currentPath,
  displayName: row.displayName,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
});

const folderToRow = (folder: CatalogFolder): typeof folders.$inferInsert => ({
  folderId: folder.folderId,
  currentPath: folder.currentPath,
  displayName: folder.displayName,
  firstSeenAt: folder.firstSeenAt,
  lastSeenAt: folder.lastSeenAt,
});

const rowToFile = (row: typeof files.$inferSelect): CatalogFile => ({
  fingerprint: row.fingerprint,
  folderId: row.folderId,
  fileName: row.fileName,
  size: row.size,
  durationS: row.durationS,
  gpsLat: row.gpsLat,
  gpsLon: row.gpsLon,
  processedAt: row.processedAt,
  analyzer: row.analyzer,
  model: row.model,
});

const fileToRow = (file: CatalogFile): typeof files.$inferInsert => ({
  fingerprint: file.fingerprint,
  folderId: file.folderId,
  fileName: file.fileName,
  size: file.size,
  durationS: file.durationS,
  gpsLat: file.gpsLat,
  gpsLon: file.gpsLon,
  processedAt: file.processedAt,
  analyzer: file.analyzer,
  model: file.model,
});

const rowToAnalysis = (row: typeof analyses.$inferSelect, analysisTags: string[]): CatalogAnalysis => ({
  fingerprint: row.fingerprint,
  finalName: row.finalName,
  description: row.description,
  transcript: row.transcript,
  language: row.language,
  tags: analysisTags,
});

const setAnalysisTags = (db: GlobalDrizzle, fingerprint: string, values: readonly string[]): void => {
  db.delete(fileTags).where(eq(fileTags.fingerprint, fingerprint)).run();
  for (const name of normalizeTagList(values)) {
    const tag = resolveCanonicalTag(db, name);
    db.insert(fileTags)
      .values({ fingerprint, tagId: tag.tagId })
      .onConflictDoNothing()
      .run();
  }
};

const resolveCanonicalTag = (db: GlobalDrizzle, name: string): typeof tags.$inferSelect => {
  const alias = db.select().from(tagAliases).where(eq(tagAliases.alias, name)).get();
  if (alias !== undefined) {
    const canonical = db.select().from(tags).where(eq(tags.tagId, alias.tagId)).get();
    if (canonical !== undefined) return canonical;
  }
  return ensureTag(db, name);
};

const ensureTag = (db: GlobalDrizzle, name: string): typeof tags.$inferSelect => {
  db.insert(tags).values({ name }).onConflictDoNothing().run();
  const row = db.select().from(tags).where(eq(tags.name, name)).get();
  if (row === undefined) throw new Error(`Could not create tag: ${name}`);
  return row;
};

const tagsForFingerprint = (db: GlobalDrizzle, fingerprint: string): string[] => {
  const rows = db.select().from(fileTags).where(eq(fileTags.fingerprint, fingerprint)).all();
  const names: string[] = [];
  for (const row of rows) {
    const tag = db.select().from(tags).where(eq(tags.tagId, row.tagId)).get();
    if (tag !== undefined) names.push(tag.name);
  }
  return names.sort((left, right) => left.localeCompare(right));
};

const sqlJsWasmConfig = (): { locateFile: (file: string) => string } | undefined => {
  const wasmPath = findSqlJsWasmPath();
  return wasmPath === null ? undefined : { locateFile: () => wasmPath };
};

const findSqlJsWasmPath = (): string | null => {
  const resourcesPath = process.resourcesPath;
  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    const packaged = [
      path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
      path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'sql-wasm.wasm'),
    ].find((candidate) => existsSync(candidate));
    if (packaged !== undefined) return packaged;
  }
  try {
    const require = createRequire(import.meta.url);
    const moduleDirectory = path.dirname(require.resolve('sql.js'));
    const candidates = [
      path.join(moduleDirectory, 'sql-wasm.wasm'),
      path.join(moduleDirectory, 'dist', 'sql-wasm.wasm'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  } catch {
    return null;
  }
};

const failure = <T>(cause: unknown): Result<T, AppError> => {
  const message = cause instanceof Error ? cause.message : 'Global catalog operation failed';
  return { ok: false, error: appError('internal', message, cause) };
};
