import { and, eq } from 'drizzle-orm';
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
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';

import {
  appError,
  canonicalPath,
  normalizeTagList,
  ok,
  photoExtensionSchema,
  type AppError,
  type CapturedAtSource,
  type PhotoExtension,
  type Result,
} from '@core/domain/index.js';
import type {
  PhotoAnalysisCandidate,
  PhotoAnalysisCandidates,
  PhotoDetail,
  PhotoFolderRecord,
  PhotoListItem,
  PhotoProxyCandidate,
  PhotoRecord,
  PhotoRootSummary,
  PhotoRunRecord,
  PhotoSightingRecord,
  PhotosCounts,
  PhotosStore,
  RecordPhotoAnalysisInput,
} from '@core/server/index.js';

import {
  createPhotosSchemaSqlV1,
  photoAnalyses,
  photoAnalysisConfigs,
  photoFileTags,
  photoFolders,
  photoPaths,
  photoRuns,
  photoTagAliases,
  photoTags,
  photos,
  photosSchema,
  photosSchemaMeta,
  PHOTOS_SCHEMA_VERSION,
} from './photos-schema.js';
import { CatalogAppError, HomeLock, type CatalogLockFs } from './home-lock.js';

const dbDirectoryName = '.ai-video-cataloger';
const dbFileName = 'photos.db';
const AUTO_FLUSH_MUTATION_COUNT = 25;

export const photosDbPath = (home: string): string => path.join(home, dbDirectoryName, dbFileName);

type PhotosSchema = typeof photosSchema;
type PhotosDrizzle = SQLJsDatabase<PhotosSchema>;

interface FileState {
  mtimeMs: number;
  size: number;
}

export interface PhotosAdapterOptions {
  homeDirectory?: string | undefined;
  processName?: 'gui' | 'cli' | undefined;
  lockMode?: 'none' | 'lazy' | 'eager' | undefined;
  isProcessAlive?: ((pid: number) => boolean) | undefined;
  lockFs?: CatalogLockFs | undefined;
  lock?: HomeLock | undefined;
}

export class SqlJsPhotosStore implements PhotosStore {
  private readonly filePath: string;
  private readonly lock: HomeLock;
  private dirtyCount = 0;
  private batchDepth = 0;
  private state: {
    SQL: SqlJsStatic;
    client: Database;
    db: PhotosDrizzle;
    fileState: FileState;
  } | null = null;

  constructor(options: PhotosAdapterOptions = {}) {
    const homeDirectory = options.homeDirectory ?? homedir();
    this.filePath = photosDbPath(homeDirectory);
    const lockMode = options.lockMode ?? (options.processName === undefined ? 'none' : 'lazy');
    this.lock = options.lock ?? new HomeLock({
      homeDirectory,
      processName: options.processName ?? 'cli',
      lockMode,
      isProcessAlive: options.isProcessAlive,
      lockFs: options.lockFs,
    });
  }

  databasePath(): string {
    return this.filePath;
  }

  async flush(): Promise<Result<void, AppError>> {
    if (this.state === null || this.dirtyCount === 0) {
      this.lock.releaseIfIdle();
      return ok(undefined);
    }
    try {
      this.lock.takeWriteLock();
      this.persist(this.state);
      this.lock.releaseIfIdle();
      return ok(undefined);
    } catch (cause) {
      this.state = null;
      this.dirtyCount = 0;
      return failure(cause);
    }
  }

  async dispose(): Promise<Result<void, AppError>> {
    const flushed = await this.flush();
    try {
      if (this.state !== null) this.state.client.close();
      this.state = null;
      this.dirtyCount = 0;
      this.lock.releaseIfIdle();
      return flushed;
    } catch (cause) {
      if (!flushed.ok) return flushed;
      return failure(cause);
    }
  }

  async withBatch<T>(operation: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    try {
      this.lock.takeWriteLock();
    } catch (cause) {
      return failure(cause);
    }
    this.batchDepth += 1;
    try {
      const result = await operation();
      return result;
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0 && this.state !== null && this.dirtyCount > 0) {
        try {
          this.persist(this.state);
        } catch {
          this.state = null;
          this.dirtyCount = 0;
        }
      }
    }
  }

  async upsertFolder(folder: PhotoFolderRecord): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(photoFolders)
        .values(folderToRow(folder))
        .onConflictDoUpdate({
          target: photoFolders.folderId,
          set: {
            currentPath: canonicalPath(folder.currentPath),
            displayName: folder.displayName,
            lastSeenAt: folder.lastSeenAt,
            defaultConfigId: folder.defaultConfigId,
          },
        })
        .run();
    });
  }

  async getFolder(folderId: string): Promise<Result<PhotoFolderRecord | null, AppError>> {
    return this.read((db) => {
      const row = db.select().from(photoFolders).where(eq(photoFolders.folderId, folderId)).get();
      return row === undefined ? null : rowToFolder(row);
    });
  }

  async getPhoto(fingerprint: string): Promise<Result<PhotoRecord | null, AppError>> {
    return this.read((db) => {
      const row = db.select().from(photos).where(eq(photos.fingerprint, fingerprint)).get();
      return row === undefined ? null : rowToPhoto(row);
    });
  }

  async upsertPhoto(photo: PhotoRecord): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      const row = photoToRow(photo);
      db.insert(photos)
        .values(row)
        .onConflictDoUpdate({
          target: photos.fingerprint,
          set: row,
        })
        .run();
      if (photoSearchDocumentId(client, photo.fingerprint) !== null) {
        syncPhotoSearchDocument(db, client, photo.fingerprint);
      }
    });
  }

  async getSightingByPath(pathValue: string): Promise<Result<PhotoSightingRecord | null, AppError>> {
    return this.read((db) => {
      const canonical = canonicalPath(pathValue);
      const row = db.select().from(photoPaths).where(eq(photoPaths.currentPath, canonical)).get();
      return row === undefined ? null : rowToSighting(row);
    });
  }

  async upsertSighting(sighting: PhotoSightingRecord): Promise<Result<void, AppError>> {
    return this.write((db) => {
      const row = sightingToRow(sighting);
      db.insert(photoPaths)
        .values(row)
        .onConflictDoUpdate({
          target: [photoPaths.fingerprint, photoPaths.currentPath],
          set: row,
        })
        .run();
    });
  }

  async listSightings(fingerprint: string): Promise<Result<PhotoSightingRecord[], AppError>> {
    return this.read((db) => db.select().from(photoPaths)
      .where(eq(photoPaths.fingerprint, fingerprint))
      .all()
      .map(rowToSighting));
  }

  async listSightingsUnderRoot(root: string): Promise<Result<PhotoSightingRecord[], AppError>> {
    return this.read((db) => {
      const canonicalRoot = canonicalPath(root);
      return db.select().from(photoPaths).all()
        .filter((row) => isUnderRoot(row.currentPath, canonicalRoot))
        .map(rowToSighting);
    });
  }

  async deleteSighting(fingerprint: string, pathValue: string): Promise<Result<void, AppError>> {
    return this.write((db) => {
      const canonical = canonicalPath(pathValue);
      db.delete(photoPaths)
        .where(and(eq(photoPaths.fingerprint, fingerprint), eq(photoPaths.currentPath, canonical)))
        .run();
    });
  }

  async deletePhoto(fingerprint: string): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      runPhotosTransaction(client, () => {
        client.run('DELETE FROM photo_face_index_state WHERE fingerprint = ?', [fingerprint]);
        client.run('DELETE FROM photo_file_tags WHERE fingerprint = ?', [fingerprint]);
        client.run('DELETE FROM photo_analyses WHERE fingerprint = ?', [fingerprint]);
        const searchRow = client.exec('SELECT docid FROM photo_search_documents WHERE fingerprint = ?', [fingerprint]);
        const docid = searchRow[0]?.values[0]?.[0];
        if (typeof docid === 'number') {
          client.run('DELETE FROM photo_search_documents_fts WHERE docid = ?', [docid]);
        }
        client.run('DELETE FROM photo_search_documents WHERE fingerprint = ?', [fingerprint]);
        db.delete(photoPaths).where(eq(photoPaths.fingerprint, fingerprint)).run();
        db.delete(photos).where(eq(photos.fingerprint, fingerprint)).run();
      });
    });
  }

  async counts(root: string | null): Promise<Result<PhotosCounts, AppError>> {
    return this.read((_db, client) => {
      const scope = scopeForRoot(root);
      const result = client.exec(
        `SELECT
            COUNT(*) AS photos,
            SUM(CASE WHEN exif_read_at IS NOT NULL THEN 1 ELSE 0 END) AS exif_read,
            SUM(CASE WHEN exif_read_at IS NULL THEN 1 ELSE 0 END) AS exif_failed,
            SUM(CASE WHEN missing_at IS NOT NULL THEN 1 ELSE 0 END) AS missing,
            SUM(CASE WHEN proxy_state = 'done' THEN 1 ELSE 0 END) AS proxied,
            SUM(CASE WHEN proxy_state = 'failed' THEN 1 ELSE 0 END) AS proxy_failed,
            (SELECT COUNT(*) FROM photo_paths WHERE fingerprint IN (SELECT fingerprint FROM photos WHERE ${scope.where})) AS paths,
            (SELECT COUNT(*) FROM (
              SELECT fingerprint FROM photo_paths
              WHERE fingerprint IN (SELECT fingerprint FROM photos WHERE ${scope.where})
              GROUP BY fingerprint HAVING COUNT(*) > 1
            )) AS duplicates,
            (SELECT COUNT(*) FROM photos WHERE (${scope.where}) AND EXISTS (
              SELECT 1 FROM photo_analyses WHERE photo_analyses.fingerprint = photos.fingerprint
            )) AS analysed
          FROM photos WHERE ${scope.where}`,
        scope.params,
      );
      const row = result[0]?.values[0] ?? [];
      return {
        photos: numberValue(row[0]),
        paths: numberValue(row[6]),
        exifRead: numberValue(row[1]),
        exifFailed: numberValue(row[2]),
        missing: numberValue(row[3]),
        duplicates: numberValue(row[7]),
        proxied: numberValue(row[4]),
        proxyFailed: numberValue(row[5]),
        analysed: numberValue(row[8]),
      };
    });
  }

  async startPhotoRun(run: PhotoRunRecord): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(photoRuns).values(runToRow(run)).run();
    });
  }

  async updatePhotoRun(run: PhotoRunRecord): Promise<Result<void, AppError>> {
    return this.write((db) => {
      const row = runToRow(run);
      db.insert(photoRuns)
        .values(row)
        .onConflictDoUpdate({ target: photoRuns.runId, set: row })
        .run();
    });
  }

  async listProxyCandidates(root: string): Promise<Result<PhotoProxyCandidate[], AppError>> {
    return this.read((_db, client) => {
      const canonicalRoot = canonicalPath(root);
      const scope = scopeForRoot(canonicalRoot);
      const photoRows = client.exec(
        `SELECT fingerprint, current_path, ext, proxy_state, thumb_state FROM photos
         WHERE missing_at IS NULL AND (${scope.where})
         ORDER BY current_path ASC`,
        scope.params,
      );
      const sightingRows = client.exec(
        `SELECT fingerprint, current_path FROM photo_paths
         WHERE current_path >= $scopeLower AND current_path < $scopeUpper
         ORDER BY last_seen_at DESC, current_path ASC`,
        { $scopeLower: `${canonicalRoot}/`, $scopeUpper: `${canonicalRoot}0` },
      );
      const newestUnderRoot = new Map<string, string>();
      for (const row of sightingRows[0]?.values ?? []) {
        const fingerprint = stringValue(row[0]);
        if (!newestUnderRoot.has(fingerprint)) newestUnderRoot.set(fingerprint, canonicalPath(stringValue(row[1])));
      }
      return (photoRows[0]?.values ?? []).map((row): PhotoProxyCandidate => {
        const fingerprint = stringValue(row[0]);
        const ownerPath = canonicalPath(stringValue(row[1]));
        const sourcePath = isUnderRoot(ownerPath, canonicalRoot) ? ownerPath : (newestUnderRoot.get(fingerprint) ?? ownerPath);
        return {
          fingerprint,
          sourcePath,
          ext: parseExtension(stringValue(row[2])),
          proxyState: parseProxyState(stringValue(row[3])),
          thumbState: parseThumbState(stringValue(row[4])),
        };
      });
    });
  }

  async setProxyOutcome(input: {
    fingerprint: string;
    proxyState: 'done' | 'failed';
    proxyWidth: number | null;
    proxyHeight: number | null;
    thumbState: 'done' | 'failed';
  }): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.update(photos)
        .set({
          proxyState: input.proxyState,
          proxyWidth: input.proxyWidth,
          proxyHeight: input.proxyHeight,
          thumbState: input.thumbState,
        })
        .where(eq(photos.fingerprint, input.fingerprint))
        .run();
    });
  }

  async listRoots(): Promise<Result<PhotoRootSummary[], AppError>> {
    return this.read((_db, client) => {
      const runsResult = client.exec(
        'SELECT root, MAX(started_at) AS last_scan_at FROM photo_runs GROUP BY root ORDER BY root ASC',
      );
      return (runsResult[0]?.values ?? []).map((runRow): PhotoRootSummary => {
        const root = stringValue(runRow[0]);
        const scope = scopeForRoot(root);
        const countResult = client.exec(
          `SELECT COUNT(*) AS photos, SUM(CASE WHEN missing_at IS NOT NULL THEN 1 ELSE 0 END) AS missing
           FROM photos WHERE ${scope.where}`,
          scope.params,
        );
        const countRow = countResult[0]?.values[0] ?? [];
        return {
          root,
          photos: numberValue(countRow[0]),
          missing: numberValue(countRow[1]),
          lastScanAt: stringValue(runRow[1]),
        };
      });
    });
  }

  async listPhotosPage(input: { root: string | null; offset: number; limit: number }):
  Promise<Result<{ total: number; items: PhotoListItem[] }, AppError>> {
    return this.read((_db, client) => {
      const scope = scopeForRoot(input.root);
      const totalResult = client.exec(`SELECT COUNT(*) FROM photos WHERE ${scope.where}`, scope.params);
      const total = numberValue(totalResult[0]?.values[0]?.[0]);
      const rowsResult = client.exec(
        `SELECT fingerprint, file_name, current_path, ext, captured_at, captured_at_source, width, height,
                proxy_state, thumb_state, missing_at,
                (SELECT COUNT(*) FROM photo_paths WHERE fingerprint = photos.fingerprint) AS sightings
         FROM photos WHERE ${scope.where}
         ORDER BY captured_at DESC, fingerprint ASC
         LIMIT $scopeLimit OFFSET $scopeOffset`,
        { ...scope.params, $scopeLimit: input.limit, $scopeOffset: input.offset },
      );
      const items = (rowsResult[0]?.values ?? []).map((row): PhotoListItem => ({
        fingerprint: stringValue(row[0]),
        fileName: stringValue(row[1]),
        currentPath: canonicalPath(stringValue(row[2])),
        ext: parseExtension(stringValue(row[3])),
        capturedAt: nullableStringValue(row[4]),
        capturedAtSource: parseCapturedAtSource(nullableStringValue(row[5])),
        width: nullableNumberValue(row[6]),
        height: nullableNumberValue(row[7]),
        proxyState: parseProxyState(stringValue(row[8])),
        thumbState: parseThumbState(stringValue(row[9])),
        missingAt: nullableNumberValue(row[10]),
        sightings: numberValue(row[11]),
      }));
      return { total, items };
    });
  }

  async getPhotoDetail(fingerprint: string): Promise<Result<PhotoDetail | null, AppError>> {
    return this.read((db): PhotoDetail | null => {
      const row = db.select().from(photos).where(eq(photos.fingerprint, fingerprint)).get();
      if (row === undefined) return null;
      const sightingRows = db.select().from(photoPaths).where(eq(photoPaths.fingerprint, fingerprint)).all();
      const sightings = sightingRows.map(rowToSighting).sort((left, right) =>
        right.lastSeenAt.localeCompare(left.lastSeenAt) || left.currentPath.localeCompare(right.currentPath));
      return { photo: rowToPhoto(row), sightings };
    });
  }

  async listAnalysisCandidates(root: string, configId: string, force: boolean): Promise<Result<PhotoAnalysisCandidates, AppError>> {
    return this.read((_db, client) => {
      const canonicalRoot = canonicalPath(root);
      const scope = scopeForRoot(canonicalRoot);
      const rows = client.exec(
        `SELECT fingerprint, file_name, current_path,
                EXISTS (SELECT 1 FROM photo_analyses WHERE photo_analyses.fingerprint = photos.fingerprint AND photo_analyses.config_id = $configId) AS analysed
         FROM photos
         WHERE missing_at IS NULL AND proxy_state = 'done' AND (${scope.where})
         ORDER BY current_path ASC`,
        { ...scope.params, $configId: configId },
      );
      const candidates: PhotoAnalysisCandidate[] = [];
      let alreadyAnalysed = 0;
      for (const row of rows[0]?.values ?? []) {
        const analysed = numberValue(row[3]) === 1;
        if (analysed && !force) {
          alreadyAnalysed += 1;
          continue;
        }
        candidates.push({
          fingerprint: stringValue(row[0]),
          fileName: stringValue(row[1]),
          currentPath: canonicalPath(stringValue(row[2])),
        });
      }
      return { candidates, alreadyAnalysed };
    });
  }

  async upsertAnalysisConfig(input: { configId: string; descriptorJson: string; label: string; now: string }): Promise<Result<void, AppError>> {
    return this.write((db) => {
      const existing = db.select().from(photoAnalysisConfigs).where(eq(photoAnalysisConfigs.configId, input.configId)).get();
      db.insert(photoAnalysisConfigs)
        .values({
          configId: input.configId,
          descriptorJson: input.descriptorJson,
          label: input.label,
          firstSeenAt: existing?.firstSeenAt ?? input.now,
          lastUsedAt: input.now,
        })
        .onConflictDoUpdate({
          target: photoAnalysisConfigs.configId,
          set: { descriptorJson: input.descriptorJson, label: input.label, lastUsedAt: input.now },
        })
        .run();
    });
  }

  async recordPhotoAnalysis(input: RecordPhotoAnalysisInput): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      runPhotosTransaction(client, () => {
        db.insert(photoAnalyses)
          .values({
            fingerprint: input.fingerprint,
            configId: input.configId,
            description: input.description,
            scene: input.scene,
            quality: input.quality,
            language: input.language,
            analyzer: input.analyzer,
            model: input.model,
            batchSize: input.batchSize,
            createdAt: input.createdAt,
            usageJson: input.usageJson,
          })
          .onConflictDoUpdate({
            target: [photoAnalyses.fingerprint, photoAnalyses.configId],
            set: {
              description: input.description,
              scene: input.scene,
              quality: input.quality,
              language: input.language,
              analyzer: input.analyzer,
              model: input.model,
              batchSize: input.batchSize,
              createdAt: input.createdAt,
              usageJson: input.usageJson,
            },
          })
          .run();
        setPhotoVariantTags(db, input.fingerprint, input.configId, input.tags);
        syncPhotoSearchDocument(db, client, input.fingerprint);
      });
    });
  }

  private async read<T>(operation: (db: PhotosDrizzle, client: Database) => T): Promise<Result<T, AppError>> {
    try {
      const state = await this.ensureOpen(false);
      return ok(operation(state.db, state.client));
    } catch (cause) {
      return failure(cause);
    }
  }

  private async write<T>(operation: (db: PhotosDrizzle, client: Database) => T): Promise<Result<T, AppError>> {
    try {
      this.lock.takeWriteLock();
      const state = await this.ensureOpen(true);
      const value = operation(state.db, state.client);
      this.dirtyCount += 1;
      if (this.batchDepth === 0 && this.dirtyCount >= AUTO_FLUSH_MUTATION_COUNT) this.persist(state);
      return ok(value);
    } catch (cause) {
      if (!(cause instanceof CatalogAppError)) {
        this.state = null;
        this.dirtyCount = 0;
      }
      return failure(cause);
    }
  }

  private persist(state: NonNullable<SqlJsPhotosStore['state']>): void {
    persistDatabase(this.filePath, state.client);
    state.fileState = fileStateOf(this.filePath);
    this.dirtyCount = 0;
  }

  private async ensureOpen(canPersist: boolean): Promise<NonNullable<SqlJsPhotosStore['state']>> {
    if (this.state !== null && (this.dirtyCount > 0 || sameFileState(this.state.fileState, fileStateOf(this.filePath)))) {
      return this.state;
    }
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const SQL = this.state?.SQL ?? await initSqlJs(sqlJsWasmConfig());
    const client = existsSync(this.filePath) ? new SQL.Database(readFileSync(this.filePath)) : new SQL.Database();
    const created = !existsSync(this.filePath);
    const migrated = migrate(client);
    if (canPersist && (created || migrated)) {
      persistDatabase(this.filePath, client);
    }
    this.state?.client.close();
    this.state = {
      SQL,
      client,
      db: drizzle(client, { schema: photosSchema }),
      fileState: fileStateOf(this.filePath),
    };
    return this.state;
  }
}

const migrate = (client: Database): boolean => {
  client.run('CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER PRIMARY KEY)');
  const currentVersion = readSchemaVersion(client);
  if (currentVersion > PHOTOS_SCHEMA_VERSION) {
    throw new CatalogAppError(appError(
      'snapshot_incompatible',
      `Photos schema version ${String(currentVersion)} is newer than the supported version ${String(PHOTOS_SCHEMA_VERSION)}`,
    ));
  }
  let migrated = false;
  if (currentVersion < 1) {
    for (const statement of createPhotosSchemaSqlV1) {
      if (statement.startsWith('CREATE TABLE schema_meta')) continue;
      client.run(statement);
    }
    migrated = true;
  }
  if (currentVersion < PHOTOS_SCHEMA_VERSION) {
    client.run('DELETE FROM schema_meta');
    const db = drizzle(client, { schema: photosSchema });
    db.insert(photosSchemaMeta).values({ version: PHOTOS_SCHEMA_VERSION }).run();
    migrated = true;
  }
  return migrated;
};

const readSchemaVersion = (client: Database): number => {
  const result = client.exec('SELECT version FROM schema_meta ORDER BY version DESC LIMIT 1');
  const value = result[0]?.values[0]?.[0];
  return typeof value === 'number' ? value : 0;
};

const runPhotosTransaction = (client: Database, operation: () => void): void => {
  client.run('BEGIN IMMEDIATE TRANSACTION');
  try {
    operation();
    client.run('COMMIT');
  } catch (cause) {
    client.run('ROLLBACK');
    throw cause;
  }
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

const sqlJsWasmConfig = (): { locateFile: (file: string) => string } | undefined => {
  const wasmPath = findSqlJsWasmPath();
  return wasmPath === null ? undefined : { locateFile: () => wasmPath };
};

const findSqlJsWasmPath = (): string | null => {
  const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql-wasm.wasm');
  if (existsSync(bundled)) return bundled;
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
  if (cause instanceof CatalogAppError) return { ok: false, error: cause.appError };
  const message = cause instanceof Error ? cause.message : 'Photos store operation failed';
  return { ok: false, error: appError('internal', message, cause) };
};

const isUnderRoot = (candidate: string, root: string): boolean =>
  candidate === root || candidate.startsWith(`${root}/`);

interface RootScope {
  where: string;
  params: Record<string, SqlValue>;
}

const scopeForRoot = (root: string | null): RootScope => {
  if (root === null) return { where: '1=1', params: {} };
  const canonicalRoot = canonicalPath(root);
  return {
    where: `(photos.current_path >= $scopeLower AND photos.current_path < $scopeUpper)
      OR EXISTS (SELECT 1 FROM photo_paths sp WHERE sp.fingerprint = photos.fingerprint
        AND sp.current_path >= $scopeLower AND sp.current_path < $scopeUpper)`,
    params: { $scopeLower: `${canonicalRoot}/`, $scopeUpper: `${canonicalRoot}0` },
  };
};

const stringValue = (value: SqlValue | undefined): string => (typeof value === 'string' ? value : '');

const nullableStringValue = (value: SqlValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

const nullableNumberValue = (value: SqlValue | undefined): number | null =>
  typeof value === 'number' ? value : null;

const numberValue = (value: SqlValue | undefined): number => (typeof value === 'number' ? value : 0);

const rowToFolder = (row: typeof photoFolders.$inferSelect): PhotoFolderRecord => ({
  folderId: row.folderId,
  currentPath: canonicalPath(row.currentPath),
  displayName: row.displayName,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
  defaultConfigId: row.defaultConfigId,
});

const folderToRow = (folder: PhotoFolderRecord): typeof photoFolders.$inferInsert => ({
  folderId: folder.folderId,
  currentPath: canonicalPath(folder.currentPath),
  displayName: folder.displayName,
  firstSeenAt: folder.firstSeenAt,
  lastSeenAt: folder.lastSeenAt,
  defaultConfigId: folder.defaultConfigId,
});

const parseExtension = (value: string): PhotoExtension => photoExtensionSchema.parse(value);

const parseCapturedAtSource = (value: string | null): CapturedAtSource | null => {
  if (value === 'exif_offset' || value === 'exif_gps_time' || value === 'exif_local_assumed' || value === 'file_mtime') return value;
  return null;
};

const parseProxyState = (value: string): PhotoRecord['proxyState'] => {
  if (value === 'pending' || value === 'done' || value === 'failed' || value === 'not_needed') return value;
  return 'pending';
};

const parseThumbState = (value: string): PhotoRecord['thumbState'] => (value === 'done' || value === 'failed' ? value : 'pending');

const rowToPhoto = (row: typeof photos.$inferSelect): PhotoRecord => ({
  fingerprint: row.fingerprint,
  folderId: row.folderId,
  fileName: row.fileName,
  currentPath: canonicalPath(row.currentPath),
  ext: parseExtension(row.ext),
  size: row.size,
  width: row.width,
  height: row.height,
  orientation: row.orientation,
  cameraMake: row.cameraMake,
  cameraModel: row.cameraModel,
  lens: row.lens,
  iso: row.iso,
  fNumber: row.fNumber,
  exposureTime: row.exposureTime,
  exifRating: row.exifRating,
  capturedAt: row.capturedAt,
  capturedAtSource: parseCapturedAtSource(row.capturedAtSource),
  gpsLat: row.gpsLat,
  gpsLon: row.gpsLon,
  gpsSource: row.gpsSource,
  gpsAccuracyM: row.gpsAccuracyM,
  gpsIntervalKind: row.gpsIntervalKind,
  gpsResolvedAt: row.gpsResolvedAt,
  placeName: row.placeName,
  placeRegion: row.placeRegion,
  placeCountry: row.placeCountry,
  placeCountryCode: row.placeCountryCode,
  placeDistanceM: row.placeDistanceM,
  placeDataset: row.placeDataset,
  discoveredAt: row.discoveredAt,
  exifReadAt: row.exifReadAt,
  proxyState: parseProxyState(row.proxyState),
  proxyWidth: row.proxyWidth,
  proxyHeight: row.proxyHeight,
  thumbState: parseThumbState(row.thumbState),
  missingAt: row.missingAt,
  selectedConfigId: row.selectedConfigId,
});

const photoToRow = (photo: PhotoRecord): typeof photos.$inferInsert => ({
  fingerprint: photo.fingerprint,
  folderId: photo.folderId,
  fileName: photo.fileName,
  currentPath: canonicalPath(photo.currentPath),
  ext: photo.ext,
  size: photo.size,
  width: photo.width,
  height: photo.height,
  orientation: photo.orientation,
  cameraMake: photo.cameraMake,
  cameraModel: photo.cameraModel,
  lens: photo.lens,
  iso: photo.iso,
  fNumber: photo.fNumber,
  exposureTime: photo.exposureTime,
  exifRating: photo.exifRating,
  capturedAt: photo.capturedAt,
  capturedAtSource: photo.capturedAtSource,
  gpsLat: photo.gpsLat,
  gpsLon: photo.gpsLon,
  gpsSource: photo.gpsSource,
  gpsAccuracyM: photo.gpsAccuracyM,
  gpsIntervalKind: photo.gpsIntervalKind,
  gpsResolvedAt: photo.gpsResolvedAt,
  placeName: photo.placeName,
  placeRegion: photo.placeRegion,
  placeCountry: photo.placeCountry,
  placeCountryCode: photo.placeCountryCode,
  placeDistanceM: photo.placeDistanceM,
  placeDataset: photo.placeDataset,
  discoveredAt: photo.discoveredAt,
  exifReadAt: photo.exifReadAt,
  proxyState: photo.proxyState,
  proxyWidth: photo.proxyWidth,
  proxyHeight: photo.proxyHeight,
  thumbState: photo.thumbState,
  missingAt: photo.missingAt,
  selectedConfigId: photo.selectedConfigId,
});

const rowToSighting = (row: typeof photoPaths.$inferSelect): PhotoSightingRecord => ({
  fingerprint: row.fingerprint,
  currentPath: canonicalPath(row.currentPath),
  folderId: row.folderId,
  size: row.size,
  mtimeMs: row.mtimeMs,
  lastSeenAt: row.lastSeenAt,
});

const sightingToRow = (sighting: PhotoSightingRecord): typeof photoPaths.$inferInsert => ({
  fingerprint: sighting.fingerprint,
  currentPath: canonicalPath(sighting.currentPath),
  folderId: sighting.folderId,
  size: sighting.size,
  mtimeMs: sighting.mtimeMs,
  lastSeenAt: sighting.lastSeenAt,
});

const resolveSelectedPhotoAnalysis = (
  db: PhotosDrizzle,
  fingerprint: string,
): (typeof photoAnalyses.$inferSelect) | undefined => {
  const photoRow = db.select().from(photos).where(eq(photos.fingerprint, fingerprint)).get();
  if (photoRow === undefined) return undefined;
  const folderRow = db.select().from(photoFolders).where(eq(photoFolders.folderId, photoRow.folderId)).get();
  const rows = db.select().from(photoAnalyses).where(eq(photoAnalyses.fingerprint, fingerprint)).all();
  const explicit = rows.find((row) => row.configId === photoRow.selectedConfigId);
  if (explicit !== undefined) return explicit;
  const folderDefault = rows.find((row) => row.configId === folderRow?.defaultConfigId);
  if (folderDefault !== undefined) return folderDefault;
  return [...rows].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || left.configId.localeCompare(right.configId))[0];
};

const tagsForPhotoVariant = (db: PhotosDrizzle, fingerprint: string, configIdValue: string): string[] => {
  const rows = db.select().from(photoFileTags)
    .where(and(eq(photoFileTags.fingerprint, fingerprint), eq(photoFileTags.configId, configIdValue)))
    .all();
  const names: string[] = [];
  for (const row of rows) {
    const tag = db.select().from(photoTags).where(eq(photoTags.tagId, row.tagId)).get();
    if (tag !== undefined) names.push(tag.name);
  }
  return names.sort((left, right) => left.localeCompare(right));
};

const resolveCanonicalPhotoTag = (db: PhotosDrizzle, name: string): typeof photoTags.$inferSelect => {
  const alias = db.select().from(photoTagAliases).where(eq(photoTagAliases.alias, name)).get();
  if (alias !== undefined) {
    const canonical = db.select().from(photoTags).where(eq(photoTags.tagId, alias.tagId)).get();
    if (canonical !== undefined) return canonical;
  }
  db.insert(photoTags).values({ name }).onConflictDoNothing().run();
  const row = db.select().from(photoTags).where(eq(photoTags.name, name)).get();
  if (row === undefined) throw new Error(`Could not create photo tag: ${name}`);
  return row;
};

const setPhotoVariantTags = (
  db: PhotosDrizzle,
  fingerprint: string,
  configIdValue: string,
  values: readonly string[],
): void => {
  db.delete(photoFileTags)
    .where(and(eq(photoFileTags.fingerprint, fingerprint), eq(photoFileTags.configId, configIdValue)))
    .run();
  for (const name of normalizeTagList(values)) {
    const tag = resolveCanonicalPhotoTag(db, name);
    db.insert(photoFileTags)
      .values({ fingerprint, configId: configIdValue, tagId: tag.tagId })
      .onConflictDoNothing()
      .run();
  }
};

const photoSearchDocumentId = (client: Database, fingerprint: string): number | null => {
  const result = client.exec('SELECT docid FROM photo_search_documents WHERE fingerprint = ?', [fingerprint]);
  const value = result[0]?.values[0]?.[0];
  return typeof value === 'number' ? value : null;
};

const deletePhotoSearchDocument = (client: Database, fingerprint: string): void => {
  const docid = photoSearchDocumentId(client, fingerprint);
  if (docid === null) return;
  client.run('DELETE FROM photo_search_documents_fts WHERE docid = $docid', { $docid: docid });
  client.run('DELETE FROM photo_search_documents WHERE docid = $docid', { $docid: docid });
};

const syncPhotoSearchDocument = (db: PhotosDrizzle, client: Database, fingerprint: string): void => {
  const photoRow = db.select().from(photos).where(eq(photos.fingerprint, fingerprint)).get();
  if (photoRow === undefined) {
    deletePhotoSearchDocument(client, fingerprint);
    return;
  }
  const selected = resolveSelectedPhotoAnalysis(db, fingerprint);
  const document = {
    fingerprint,
    fileName: photoRow.fileName,
    description: selected?.description ?? '',
    tagsText: selected === undefined ? '' : tagsForPhotoVariant(db, fingerprint, selected.configId).join('\n'),
    place: [photoRow.placeName, photoRow.placeRegion, photoRow.placeCountry]
      .filter((value): value is string => value !== null)
      .join('\n'),
  };
  const existingDocid = photoSearchDocumentId(client, fingerprint);
  if (existingDocid !== null) {
    client.run('DELETE FROM photo_search_documents_fts WHERE docid = $docid', { $docid: existingDocid });
  }
  client.run(
    `INSERT INTO photo_search_documents (fingerprint, file_name, description, tags_text, place)
      VALUES ($fingerprint, $fileName, $description, $tagsText, $place)
      ON CONFLICT(fingerprint) DO UPDATE SET
        file_name = excluded.file_name,
        description = excluded.description,
        tags_text = excluded.tags_text,
        place = excluded.place`,
    {
      $fingerprint: document.fingerprint,
      $fileName: document.fileName,
      $description: document.description,
      $tagsText: document.tagsText,
      $place: document.place,
    },
  );
  const docid = photoSearchDocumentId(client, fingerprint);
  if (docid === null) throw new Error(`Could not create photo search document: ${fingerprint}`);
  client.run(
    `INSERT INTO photo_search_documents_fts (docid, file_name, description, tags_text, place)
      VALUES ($docid, $fileName, $description, $tagsText, $place)`,
    {
      $docid: docid,
      $fileName: document.fileName,
      $description: document.description,
      $tagsText: document.tagsText,
      $place: document.place,
    },
  );
};

const runToRow = (run: PhotoRunRecord): typeof photoRuns.$inferInsert => ({
  runId: run.runId,
  root: run.root,
  stage: run.stage,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  filesTotal: run.filesTotal,
  filesDone: run.filesDone,
  filesSkipped: run.filesSkipped,
  filesFailed: run.filesFailed,
  lastActivityAt: run.lastActivityAt,
  batchJson: run.batchJson,
});
