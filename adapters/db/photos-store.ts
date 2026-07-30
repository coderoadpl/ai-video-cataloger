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
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

import {
  appError,
  canonicalPath,
  ok,
  photoExtensionSchema,
  type AppError,
  type CapturedAtSource,
  type PhotoExtension,
  type Result,
} from '@core/domain/index.js';
import type {
  PhotoFolderRecord,
  PhotoRecord,
  PhotoRunRecord,
  PhotoSightingRecord,
  PhotosCounts,
  PhotosStore,
} from '@core/server/index.js';

import {
  createPhotosSchemaSqlV1,
  photoFolders,
  photoPaths,
  photoRuns,
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
    return this.write((db) => {
      const row = photoToRow(photo);
      db.insert(photos)
        .values(row)
        .onConflictDoUpdate({
          target: photos.fingerprint,
          set: row,
        })
        .run();
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
    return this.read((db) => {
      const canonicalRoot = root === null ? null : canonicalPath(root);
      const allPhotoRows = db.select().from(photos).all();
      const scopedFingerprints = canonicalRoot === null
        ? null
        : new Set([
          ...db.select({ fingerprint: photoPaths.fingerprint, currentPath: photoPaths.currentPath }).from(photoPaths).all()
            .filter((row) => isUnderRoot(row.currentPath, canonicalRoot))
            .map((row) => row.fingerprint),
          ...allPhotoRows
            .filter((row) => isUnderRoot(canonicalPath(row.currentPath), canonicalRoot))
            .map((row) => row.fingerprint),
        ]);
      const photoRows = allPhotoRows
        .filter((row) => scopedFingerprints === null || scopedFingerprints.has(row.fingerprint));
      const pathRows = db.select().from(photoPaths).all()
        .filter((row) => scopedFingerprints === null || scopedFingerprints.has(row.fingerprint));
      const bySightingCount = new Map<string, number>();
      for (const row of pathRows) bySightingCount.set(row.fingerprint, (bySightingCount.get(row.fingerprint) ?? 0) + 1);
      return {
        photos: photoRows.length,
        paths: pathRows.length,
        exifRead: photoRows.filter((row) => row.exifReadAt !== null).length,
        exifFailed: photoRows.filter((row) => row.exifReadAt === null).length,
        missing: photoRows.filter((row) => row.missingAt !== null).length,
        duplicates: [...bySightingCount.values()].filter((count) => count > 1).length,
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
