import { and, eq, isNull } from 'drizzle-orm';
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
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import { z } from 'zod';

import {
  ERROR_CODES,
  FACE_ENGINE_VERSION,
  analysisLanguageResolutionSchema,
  acceptsGpsWrite,
  appError,
  canonicalPath,
  compareUtf8Bytes,
  normalizeTagList,
  ok,
  photoExtensionSchema,
  type AppError,
  type CapturedAtSource,
  type CatalogPlace,
  type GpsSource,
  type PhotoExtension,
  type Result,
  type TimelineIntervalKind,
} from '@core/domain/index.js';
import { JOB_CANCELLED_ERROR_MESSAGE } from '@core/server/index.js';
import type {
  ApplyGeoBackfillResult,
  ApplyPhotoGeoBackfillInput,
  AnalysisLanguageCandidateRule,
  PhotoAnalysisCandidate,
  PhotoAnalysisCandidates,
  PhotoAnalysisError,
  PhotoDetail,
  PhotoFaceIndexCandidate,
  PhotoFolderRecord,
  PhotoFolderTreeEntry,
  PhotoGeoBackfillCandidate,
  PhotoListItem,
  PhotoLocationRow,
  PhotoProxyCandidate,
  PhotoRecord,
  PhotoRootSummary,
  PhotoRunRecord,
  PhotoSearchRow,
  PhotoSightingRecord,
  PhotosCounts,
  PhotosStore,
  PhotoVariantRecord,
  RecordPhotoAnalysisInput,
  RecordPhotoAnalysisFailureInput,
  TagTermExpansion,
} from '@core/server/index.js';

import {
  createPhotosSchemaSqlV1,
  createPhotosSchemaSqlV2,
  createPhotosSchemaSqlV3,
  createPhotosSchemaSqlV4,
  photoAnalysisErrors,
  photoAnalyses,
  photoAnalysisConfigs,
  photoFaceIndexState,
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
import { countTerm } from './search-score.js';
import { normalizeStoredTagNames } from './tag-normalization-migration.js';

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

  async snapshotTo(targetPath: string, signal?: AbortSignal | undefined): Promise<Result<{ sizeBytes: number; schemaVersion: number }, AppError>> {
    const wasOpen = this.state !== null;
    let leased = false;
    try {
      await acquireSnapshotLease(this.lock, signal);
      leased = true;
      const flushed = await this.flush();
      if (!flushed.ok) return flushed;
      const state = await this.ensureOpen(false);
      mkdirSync(path.dirname(targetPath), { recursive: true });
      persistDatabase(targetPath, state.client);
      verifySnapshotIntegrity(state.SQL, targetPath);
      const sizeBytes = statSync(targetPath).size;
      if (!wasOpen) {
        state.client.close();
        this.state = null;
      }
      return ok({ sizeBytes, schemaVersion: PHOTOS_SCHEMA_VERSION });
    } catch (cause) {
      removeSnapshotFile(targetPath);
      return failure(cause);
    } finally {
      if (!wasOpen && this.state !== null) {
        this.state.client.close();
        this.state = null;
        this.dirtyCount = 0;
      }
      if (leased) {
        this.lock.releaseLease();
        this.lock.releaseIfIdle();
      }
    }
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

  async checkpoint(): Promise<Result<void, AppError>> {
    if (this.state === null || this.dirtyCount === 0) return ok(undefined);
    try {
      this.lock.takeWriteLock();
      this.persist(this.state);
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
      syncPhotoSearchDocument(db, client, photo.fingerprint);
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
    return this.read((_db, client) => {
      const canonicalRoot = canonicalPath(root);
      const rows = client.exec(
        `SELECT fingerprint, current_path, folder_id, size, mtime_ms, last_seen_at
         FROM photo_paths
         WHERE current_path = $root OR (current_path >= $scopeLower AND current_path < $scopeUpper)`,
        { $root: canonicalRoot, $scopeLower: `${canonicalRoot}/`, $scopeUpper: `${canonicalRoot}0` },
      );
      return (rows[0]?.values ?? []).map((row): PhotoSightingRecord => ({
        fingerprint: stringValue(row[0]),
        currentPath: stringValue(row[1]),
        folderId: stringValue(row[2]),
        size: numberValue(row[3]),
        mtimeMs: numberValue(row[4]),
        lastSeenAt: stringValue(row[5]),
      }));
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
        client.run('DELETE FROM photo_analysis_errors WHERE fingerprint = ?', [fingerprint]);
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
            )) AS analysed,
            (SELECT COUNT(*) FROM photos WHERE (${scope.where}) AND EXISTS (
              SELECT 1 FROM photo_face_index_state s
              WHERE s.fingerprint = photos.fingerprint AND s.engine_version >= ${FACE_ENGINE_VERSION}
            )) AS faces_indexed
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
        facesIndexed: numberValue(row[9]),
      };
    });
  }

  async listPhotoFaceIndexCandidates(root: string):
  Promise<Result<{ inScope: number; candidates: PhotoFaceIndexCandidate[] }, AppError>> {
    return this.read((_db, client) => {
      const canonicalRoot = canonicalPath(root);
      const rows = client.exec(
        `SELECT p.fingerprint AS fingerprint, p.current_path AS current_path,
            (SELECT s.engine_version FROM photo_face_index_state s WHERE s.fingerprint = p.fingerprint) AS engine_version
         FROM photos p
         WHERE p.proxy_state = 'done' AND p.missing_at IS NULL
           AND EXISTS (
             SELECT 1 FROM photo_paths pp WHERE pp.fingerprint = p.fingerprint
               AND pp.current_path >= $scopeLower AND pp.current_path < $scopeUpper
           )
         GROUP BY p.fingerprint
         ORDER BY p.fingerprint ASC`,
        { $scopeLower: `${canonicalRoot}/`, $scopeUpper: `${canonicalRoot}0` },
      );
      const inScope = rows[0]?.values.length ?? 0;
      const candidates: PhotoFaceIndexCandidate[] = [];
      for (const value of rows[0]?.values ?? []) {
        const fingerprint = stringValue(value[0]);
        const currentPath = stringValue(value[1]);
        const previousEngineVersion = nullableNumberValue(value[2]);
        if (previousEngineVersion !== null && previousEngineVersion >= FACE_ENGINE_VERSION) continue;
        candidates.push({ fingerprint, currentPath, previousEngineVersion });
      }
      return { inScope, candidates };
    });
  }

  async completePhotoFaceIndex(fingerprint: string, engineVersion: number): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(photoFaceIndexState)
        .values({ fingerprint, completedAt: new Date().toISOString(), engineVersion })
        .onConflictDoUpdate({
          target: photoFaceIndexState.fingerprint,
          set: { completedAt: new Date().toISOString(), engineVersion },
        })
        .run();
    });
  }

  async countStalePhotoFaceIndexFiles(engineVersion: number): Promise<Result<number, AppError>> {
    return this.read((_db, client) => {
      const result = client.exec(
        'SELECT COUNT(*) FROM photo_face_index_state WHERE engine_version < ?',
        [engineVersion],
      );
      return numberValue(result[0]?.values[0]?.[0]);
    });
  }

  async listPhotoGeoBackfillCandidates(input: { root: string | null }): Promise<Result<PhotoGeoBackfillCandidate[], AppError>> {
    return this.read((_db, client) => {
      const scope = scopeForRoot(input.root);
      const result = client.exec(
        `SELECT
            fingerprint, file_name, current_path, captured_at, captured_at_source,
            gps_lat, gps_lon, gps_source, place_name
          FROM photos
          WHERE ${scope.where}
          ORDER BY current_path, file_name`,
        scope.params,
      );
      return (result[0]?.values ?? []).map(photoGeoBackfillCandidateFromValues);
    });
  }

  async applyPhotoGeoBackfill(input: ApplyPhotoGeoBackfillInput): Promise<Result<ApplyGeoBackfillResult, AppError>> {
    return this.write((db, client) => {
      const existing = db.select().from(photos).where(eq(photos.fingerprint, input.fingerprint)).get();
      if (existing === undefined) return 'skipped_precedence' satisfies ApplyGeoBackfillResult;

      let outcome: ApplyGeoBackfillResult = 'unchanged';

      let nextGpsLat = existing.gpsLat;
      let nextGpsLon = existing.gpsLon;
      let nextGpsSource = existing.gpsSource;
      let nextAccuracyM = existing.gpsAccuracyM;
      let nextIntervalKind = existing.gpsIntervalKind;
      let nextResolvedAt = existing.gpsResolvedAt;
      if (input.location !== undefined) {
        const accepted = acceptsGpsWrite(
          { lat: existing.gpsLat, lon: existing.gpsLon, source: parsePhotoGpsSource(existing.gpsSource) },
          { lat: input.location.lat, lon: input.location.lon, source: input.location.source },
        );
        if (!accepted) {
          outcome = 'skipped_precedence';
        } else {
          const unchangedCoordinates = existing.gpsLat !== null && existing.gpsLon !== null
            && roundTo6Photo(existing.gpsLat) === roundTo6Photo(input.location.lat)
            && roundTo6Photo(existing.gpsLon) === roundTo6Photo(input.location.lon)
            && existing.gpsIntervalKind === input.location.intervalKind;
          nextGpsLat = input.location.lat;
          nextGpsLon = input.location.lon;
          nextGpsSource = input.location.source;
          nextAccuracyM = input.location.accuracyM;
          nextIntervalKind = input.location.intervalKind;
          nextResolvedAt = input.location.resolvedAt;
          if (!unchangedCoordinates) outcome = 'written';
        }
      }

      let nextPlaceName = existing.placeName;
      let nextPlaceRegion = existing.placeRegion;
      let nextPlaceCountry = existing.placeCountry;
      let nextPlaceCountryCode = existing.placeCountryCode;
      let nextPlaceDistanceM = existing.placeDistanceM;
      let nextPlaceDataset = existing.placeDataset;
      if (input.place !== undefined && !photoPlacesEqual(photoRowToPlace(existing), input.place)) {
        nextPlaceName = input.place?.name ?? null;
        nextPlaceRegion = input.place?.region ?? null;
        nextPlaceCountry = input.place?.country ?? null;
        nextPlaceCountryCode = input.place?.countryCode ?? null;
        nextPlaceDistanceM = input.place?.distanceM ?? null;
        nextPlaceDataset = input.place?.dataset ?? null;
        if (outcome !== 'skipped_precedence' || input.location === undefined) outcome = 'written';
      }

      if (outcome === 'written') {
        db.update(photos).set({
          gpsLat: nextGpsLat,
          gpsLon: nextGpsLon,
          gpsSource: nextGpsSource,
          gpsAccuracyM: nextAccuracyM,
          gpsIntervalKind: nextIntervalKind,
          gpsResolvedAt: nextResolvedAt,
          placeName: nextPlaceName,
          placeRegion: nextPlaceRegion,
          placeCountry: nextPlaceCountry,
          placeCountryCode: nextPlaceCountryCode,
          placeDistanceM: nextPlaceDistanceM,
          placeDataset: nextPlaceDataset,
        }).where(eq(photos.fingerprint, input.fingerprint)).run();
        syncPhotoSearchDocument(db, client, input.fingerprint);
      }
      return outcome;
    });
  }

  async listPhotoLocations(): Promise<Result<{ totalPhotos: number; rows: PhotoLocationRow[] }, AppError>> {
    return this.read((db, client) => {
      const totalPhotos = db.select().from(photos).all().length;
      const result = client.exec(
        `SELECT
            p.fingerprint, p.file_name, p.gps_lat, p.gps_lon, p.missing_at, p.captured_at, p.thumb_state,
            f.folder_id, f.current_path, f.display_name,
            p.gps_source, p.gps_accuracy_m, p.gps_interval_kind,
            p.place_name, p.place_region, p.place_country, p.place_country_code, p.place_distance_m, p.place_dataset
          FROM photos p
          JOIN photo_folders f ON f.folder_id = p.folder_id
          WHERE p.gps_lat IS NOT NULL AND p.gps_lon IS NOT NULL
          ORDER BY p.fingerprint`,
      );
      const values = result[0]?.values ?? [];
      const rows = values
        .map(photoLocationRowFromValues)
        .filter((row): row is PhotoLocationRow => row !== null);
      return { totalPhotos, rows };
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

  async deletePhotoRuns(root: string): Promise<Result<void, AppError>> {
    return this.write((_db, client) => {
      const canonicalRoot = canonicalPath(root);
      client.run(
        'DELETE FROM photo_runs WHERE root = $root OR (root >= $scopeLower AND root < $scopeUpper)',
        { $root: canonicalRoot, $scopeLower: `${canonicalRoot}/`, $scopeUpper: `${canonicalRoot}0` },
      );
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

  async listFolderTree(): Promise<Result<PhotoFolderTreeEntry[], AppError>> {
    return this.read((_db, client) => {
      const result = client.exec(
        `WITH folder_photos AS (
           SELECT folder_id, fingerprint FROM photos
           UNION
           SELECT folder_id, fingerprint FROM photo_paths
         )
         SELECT pf.folder_id AS folder_id, pf.current_path AS current_path,
                COUNT(DISTINCT fp.fingerprint) AS photo_count,
                COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM photo_analyses pa WHERE pa.fingerprint = fp.fingerprint) THEN fp.fingerprint END) AS analysed_count
         FROM photo_folders pf
         JOIN folder_photos fp ON fp.folder_id = pf.folder_id
         GROUP BY pf.folder_id
         ORDER BY pf.current_path ASC`,
      );
      return (result[0]?.values ?? []).map((row): PhotoFolderTreeEntry => ({
        folderId: stringValue(row[0]),
        currentPath: canonicalPath(stringValue(row[1])),
        photoCount: numberValue(row[2]),
        analysedCount: numberValue(row[3]),
      }));
    });
  }

  async listPhotosInFolder(folderId: string): Promise<Result<PhotoListItem[], AppError>> {
    return this.read((_db, client) => {
      const rowsResult = client.exec(
        `SELECT ${PHOTO_LIST_ITEM_COLUMNS}
         FROM photos
         WHERE folder_id = $folderId OR EXISTS (
           SELECT 1 FROM photo_paths folder_path
           WHERE folder_path.fingerprint = photos.fingerprint AND folder_path.folder_id = $folderId
         )
         ORDER BY captured_at DESC, fingerprint ASC`,
        { $folderId: folderId },
      );
      return (rowsResult[0]?.values ?? []).map(rowToPhotoListItem);
    });
  }

  async listPhotosPage(input: { root: string | null; offset: number; limit: number }):
  Promise<Result<{ total: number; items: PhotoListItem[] }, AppError>> {
    return this.read((_db, client) => {
      const scope = scopeForRoot(input.root);
      const totalResult = client.exec(`SELECT COUNT(*) FROM photos WHERE ${scope.where}`, scope.params);
      const total = numberValue(totalResult[0]?.values[0]?.[0]);
      const rowsResult = client.exec(
        `SELECT ${PHOTO_LIST_ITEM_COLUMNS}
         FROM photos WHERE ${scope.where}
         ORDER BY captured_at DESC, fingerprint ASC
         LIMIT $scopeLimit OFFSET $scopeOffset`,
        { ...scope.params, $scopeLimit: input.limit, $scopeOffset: input.offset },
      );
      const items = (rowsResult[0]?.values ?? []).map(rowToPhotoListItem);
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
      return { photo: rowToPhoto(row), sightings, analysisError: resolveLatestPhotoAnalysisError(db, fingerprint) };
    });
  }

  async listAnalysisCandidates(
    root: string,
    configId: string,
    force: boolean,
    languageRule?: AnalysisLanguageCandidateRule,
  ): Promise<Result<PhotoAnalysisCandidates, AppError>> {
    const parsedResolution = languageRule === undefined ? null : analysisLanguageResolutionSchema.safeParse({
      outputLanguage: languageRule.outputLanguage,
      tagLanguage: languageRule.tagLanguage,
    });
    if (parsedResolution !== null && !parsedResolution.success) {
      return { ok: false, error: appError('validation', parsedResolution.error.message) };
    }
    return this.read((_db, client) => {
      const canonicalRoot = canonicalPath(root);
      const scope = scopeForRoot(canonicalRoot);
      const rows = client.exec(
        `SELECT fingerprint, file_name, current_path,
                EXISTS (SELECT 1 FROM photo_analyses WHERE photo_analyses.fingerprint = photos.fingerprint AND photo_analyses.config_id = $configId) AS analysed,
                (SELECT resolved_output_language FROM photo_analyses WHERE photo_analyses.fingerprint = photos.fingerprint AND photo_analyses.config_id = $configId),
                (SELECT resolved_tag_language FROM photo_analyses WHERE photo_analyses.fingerprint = photos.fingerprint AND photo_analyses.config_id = $configId),
                EXISTS (SELECT 1 FROM photo_analysis_errors WHERE photo_analysis_errors.fingerprint = photos.fingerprint AND photo_analysis_errors.config_id = $configId) AS failed
         FROM photos
         WHERE missing_at IS NULL AND proxy_state = 'done' AND (${scope.where})
         ORDER BY current_path ASC`,
        { ...scope.params, $configId: configId },
      );
      const candidates: PhotoAnalysisCandidate[] = [];
      let alreadyAnalysed = 0;
      for (const row of rows[0]?.values ?? []) {
        const exists = numberValue(row[3]) === 1;
        const failed = numberValue(row[6]) === 1;
        const storedOutputLanguage = nullableStringValue(row[4]);
        const storedTagLanguage = nullableStringValue(row[5]);
        const resolution = parsedResolution?.data;
        const analysed = exists && !failed && (
          languageRule === undefined
          || resolution === undefined
          || storedOutputLanguage === null
          || storedTagLanguage === null
          || ((!languageRule.outputAuto || storedOutputLanguage === resolution.outputLanguage)
            && (!languageRule.tagAuto || storedTagLanguage === resolution.tagLanguage))
        );
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
    const parsedResolution = input.resolvedOutputLanguage === undefined && input.resolvedTagLanguage === undefined
      ? null
      : analysisLanguageResolutionSchema.safeParse({
          outputLanguage: input.resolvedOutputLanguage,
          tagLanguage: input.resolvedTagLanguage,
        });
    if (parsedResolution !== null && !parsedResolution.success) {
      return { ok: false, error: appError('validation', parsedResolution.error.message) };
    }
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
            resolvedOutputLanguage: parsedResolution?.data.outputLanguage ?? null,
            resolvedTagLanguage: parsedResolution?.data.tagLanguage ?? null,
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
              resolvedOutputLanguage: parsedResolution?.data.outputLanguage ?? null,
              resolvedTagLanguage: parsedResolution?.data.tagLanguage ?? null,
            },
          })
          .run();
        setPhotoVariantTags(db, input.fingerprint, input.configId, input.tags);
        db.delete(photoAnalysisErrors)
          .where(and(eq(photoAnalysisErrors.fingerprint, input.fingerprint), eq(photoAnalysisErrors.configId, input.configId)))
          .run();
        syncPhotoSearchDocument(db, client, input.fingerprint);
      });
    });
  }

  async recordPhotoAnalysisFailure(input: RecordPhotoAnalysisFailureInput): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(photoAnalysisErrors)
        .values({
          fingerprint: input.fingerprint,
          configId: input.configId,
          errorCode: input.code,
          errorMessage: input.message,
          createdAt: input.createdAt,
        })
        .onConflictDoUpdate({
          target: [photoAnalysisErrors.fingerprint, photoAnalysisErrors.configId],
          set: {
            errorCode: input.code,
            errorMessage: input.message,
            createdAt: input.createdAt,
          },
        })
        .run();
    });
  }

  async searchPhotos(input: {
    match: string;
    rankingTerms: readonly string[];
    limit: number;
    offset: number;
  }): Promise<Result<PhotoSearchRow[], AppError>> {
    return this.read((_db, client) => {
      const result = client.exec(
        `SELECT
            p.fingerprint,
            p.file_name,
            p.current_path,
            p.ext,
            p.captured_at,
            NULLIF(sd.description, ''),
            snippet(photo_search_documents_fts, '<mark>', '</mark>', ' ... ', -1, 12),
            sd.tags_text,
            sd.place,
            (SELECT COUNT(*) FROM photo_analyses pa WHERE pa.fingerprint = p.fingerprint) AS variant_count,
            p.thumb_state,
            p.proxy_state,
            p.missing_at
          FROM photo_search_documents_fts
          JOIN photo_search_documents sd ON sd.docid = photo_search_documents_fts.docid
          JOIN photos p ON p.fingerprint = sd.fingerprint
          WHERE photo_search_documents_fts MATCH $match`,
        { $match: input.match },
      );
      return (result[0]?.values ?? [])
        .map((row) => photoSearchRowFromValues(row, input.rankingTerms))
        .sort((left, right) =>
          right.score - left.score
          || compareUtf8Bytes(left.row.fileName, right.row.fileName)
          || compareUtf8Bytes(left.row.fingerprint, right.row.fingerprint))
        .slice(input.offset, input.offset + input.limit)
        .map((scored) => scored.row);
    });
  }

  async collectionPage(input: {
    match: string | null;
    rankingTerms: readonly string[];
    from: string | null;
    to: string | null;
    folderId: string | null;
    fingerprints: readonly string[] | null;
    tagTermSets: readonly (readonly string[])[];
    excludeMissing: boolean;
    sort: 'relevance' | 'captured_desc' | 'captured_asc' | 'name_asc';
    limit: number;
    offset: number;
  }): Promise<Result<{ total: number; rows: PhotoSearchRow[] }, AppError>> {
    return this.read((_db, client) => {
      const tagWhere = photoTagWhereClauses(input.tagTermSets);
      const dateWhere = photoDateWhereClauses(input.from, input.to);
      const folderWhere = photoFolderWhereClause(input.folderId);
      const fingerprintWhere = photoFingerprintWhereClause(input.fingerprints);
      const clauses = [
        ...tagWhere.clauses,
        ...dateWhere.clauses,
        ...folderWhere.clauses,
        ...fingerprintWhere.clauses,
        ...(input.excludeMissing ? ['p.missing_at IS NULL'] : []),
      ];
      const params = { ...tagWhere.params, ...dateWhere.params, ...folderWhere.params, ...fingerprintWhere.params };

      const analysedClause = 'EXISTS (SELECT 1 FROM photo_analyses pa WHERE pa.fingerprint = p.fingerprint)';

      if (input.match !== null) {
        const extraWhere = ` AND ${[analysedClause, ...clauses].join(' AND ')}`;
        const result = client.exec(
          `SELECT
              p.fingerprint, p.file_name, p.current_path, p.ext, p.captured_at,
              NULLIF(sd.description, ''),
              snippet(photo_search_documents_fts, '<mark>', '</mark>', ' ... ', -1, 12),
              sd.tags_text, sd.place,
              (SELECT COUNT(*) FROM photo_analyses pa WHERE pa.fingerprint = p.fingerprint) AS variant_count,
              p.thumb_state, p.proxy_state, p.missing_at
            FROM photo_search_documents_fts
            JOIN photo_search_documents sd ON sd.docid = photo_search_documents_fts.docid
            JOIN photos p ON p.fingerprint = sd.fingerprint
            WHERE photo_search_documents_fts MATCH $match${extraWhere}`,
          { $match: input.match, ...params },
        );
        const scored = (result[0]?.values ?? []).map((row) => photoSearchRowFromValues(row, input.rankingTerms));
        const sorted = input.sort === 'relevance'
          ? scored
            .sort((left, right) =>
              right.score - left.score
              || compareUtf8Bytes(left.row.fileName, right.row.fileName)
              || compareUtf8Bytes(left.row.fingerprint, right.row.fingerprint))
            .map((entry) => entry.row)
          : sortPhotoSearchRows(scored.map((entry) => entry.row), input.sort);
        return {
          total: sorted.length,
          rows: sorted.slice(input.offset, input.offset + input.limit),
        };
      }

      const baseFrom = `FROM photos p
          LEFT JOIN photo_search_documents sd ON sd.fingerprint = p.fingerprint`;
      const where = [analysedClause, ...clauses].join(' AND ');
      const countResult = client.exec(`SELECT COUNT(*) ${baseFrom} WHERE ${where}`, params);
      const total = numberValue(countResult[0]?.values[0]?.[0]);
      const sort = input.sort === 'relevance' ? 'captured_desc' : input.sort;
      const result = client.exec(
        `SELECT
            p.fingerprint, p.file_name, p.current_path, p.ext, p.captured_at,
            NULLIF(sd.description, ''),
            '' AS snippet,
            COALESCE(sd.tags_text, ''), COALESCE(sd.place, ''),
            (SELECT COUNT(*) FROM photo_analyses pa WHERE pa.fingerprint = p.fingerprint) AS variant_count,
            p.thumb_state, p.proxy_state, p.missing_at
          ${baseFrom}
          WHERE ${where}
          ORDER BY ${photoCollectionOrderBySql(sort)}
          LIMIT $limit OFFSET $offset`,
        { ...params, $limit: input.limit, $offset: input.offset },
      );
      const rows = (result[0]?.values ?? []).map((row) => photoSearchRowFromValues(row, input.rankingTerms).row);
      return { total, rows };
    });
  }

  async expandPhotoTagTerms(terms: readonly string[]): Promise<Result<TagTermExpansion[], AppError>> {
    const unique = [...new Set(terms)].filter((term) => term.length > 0);
    if (unique.length === 0) return ok([]);
    return this.read((_db, client) => {
      const placeholders = unique.map((_, index) => `$t${String(index)}`);
      const params = Object.fromEntries(unique.map((term, index) => [`$t${String(index)}`, term]));
      const list = placeholders.join(', ');
      const result = client.exec(
        `SELECT t.name AS canonical, a.alias AS alias
          FROM photo_tags t
          LEFT JOIN photo_tag_aliases a ON a.tag_id = t.tag_id
          WHERE t.tag_id IN (
            SELECT tag_id FROM photo_tags WHERE name IN (${list})
            UNION
            SELECT tag_id FROM photo_tag_aliases WHERE alias IN (${list})
          )`,
        params,
      );
      const rows = result[0]?.values ?? [];
      const groups = new Map<string, Set<string>>();
      for (const row of rows) {
        const canonical = stringValue(row[0]);
        const alias = nullableStringValue(row[1]);
        const group = groups.get(canonical) ?? new Set<string>();
        group.add(canonical);
        if (alias !== null) group.add(alias);
        groups.set(canonical, group);
      }
      const members = new Map<string, Set<string>>();
      for (const group of groups.values()) {
        for (const member of group) members.set(member, group);
      }
      return unique.flatMap((term) => {
        const group = members.get(term);
        if (group === undefined) return [];
        const equivalents = [...group].filter((member) => member !== term).sort((left, right) => left.localeCompare(right));
        return equivalents.length === 0 ? [] : [{ term, equivalents }];
      });
    });
  }

  async listPhotoVariants(fingerprint: string): Promise<Result<PhotoVariantRecord[], AppError>> {
    return this.read((db) => {
      const rows = db.select().from(photoAnalyses).where(eq(photoAnalyses.fingerprint, fingerprint)).all();
      const photoRow = db.select().from(photos).where(eq(photos.fingerprint, fingerprint)).get();
      const selected = resolveSelectedPhotoAnalysis(db, fingerprint);
      return rows
        .map((row): PhotoVariantRecord => ({
          configId: row.configId,
          label: db.select().from(photoAnalysisConfigs).where(eq(photoAnalysisConfigs.configId, row.configId)).get()?.label ?? row.configId,
          description: row.description ?? '',
          scene: row.scene ?? '',
          quality: row.quality ?? '',
          language: row.language,
          analyzer: row.analyzer,
          model: row.model,
          batchSize: row.batchSize,
          createdAt: row.createdAt,
          tags: tagsForPhotoVariant(db, fingerprint, row.configId),
          selected: selected?.configId === row.configId,
          explicit: photoRow?.selectedConfigId === row.configId,
        }))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.configId.localeCompare(right.configId));
    });
  }

  async resolveSelectedConfigId(fingerprint: string): Promise<Result<string | null, AppError>> {
    return this.read((db) => resolveSelectedPhotoAnalysis(db, fingerprint)?.configId ?? null);
  }

  async setSelectedPhotoVariant(fingerprint: string, configId: string | null): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      if (configId !== null) {
        const variant = db.select().from(photoAnalyses)
          .where(and(eq(photoAnalyses.fingerprint, fingerprint), eq(photoAnalyses.configId, configId)))
          .get();
        if (variant === undefined) {
          throw new CatalogAppError(appError('variant_not_found', `Analysis variant not found: ${fingerprint}/${configId}`));
        }
      }
      runPhotosTransaction(client, () => {
        db.update(photos).set({ selectedConfigId: configId }).where(eq(photos.fingerprint, fingerprint)).run();
        syncPhotoSearchDocument(db, client, fingerprint);
      });
    });
  }

  async deletePhotoVariant(fingerprint: string, configId: string): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      runPhotosTransaction(client, () => {
        const photoRow = db.select().from(photos).where(eq(photos.fingerprint, fingerprint)).get();
        db.delete(photoFileTags)
          .where(and(eq(photoFileTags.fingerprint, fingerprint), eq(photoFileTags.configId, configId)))
          .run();
        db.delete(photoAnalyses)
          .where(and(eq(photoAnalyses.fingerprint, fingerprint), eq(photoAnalyses.configId, configId)))
          .run();
        db.delete(photoAnalysisErrors)
          .where(and(eq(photoAnalysisErrors.fingerprint, fingerprint), eq(photoAnalysisErrors.configId, configId)))
          .run();
        if (photoRow?.selectedConfigId === configId) {
          db.update(photos).set({ selectedConfigId: null }).where(eq(photos.fingerprint, fingerprint)).run();
        }
        syncPhotoSearchDocument(db, client, fingerprint);
      });
    });
  }

  async setPhotoFolderDefaultVariant(folderId: string, configId: string | null): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      runPhotosTransaction(client, () => {
        db.update(photoFolders).set({ defaultConfigId: configId }).where(eq(photoFolders.folderId, folderId)).run();
        const ownedNonExplicit = db.select().from(photos)
          .where(and(eq(photos.folderId, folderId), isNull(photos.selectedConfigId)))
          .all();
        for (const row of ownedNonExplicit) syncPhotoSearchDocument(db, client, row.fingerprint);
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
    const db = drizzle(client, { schema: photosSchema });
    const backfilled = ensurePhotoSearchDocuments(db, client);
    if (canPersist && (created || migrated || backfilled)) {
      persistDatabase(this.filePath, client);
    } else if (created || migrated || backfilled) {
      this.dirtyCount = 1;
    }
    this.state?.client.close();
    this.state = {
      SQL,
      client,
      db,
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
  if (currentVersion < 2) {
    for (const statement of createPhotosSchemaSqlV2) client.run(statement);
    migrated = true;
  }
  if (currentVersion < 3) {
    for (const statement of createPhotosSchemaSqlV3) runPhotosMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 4) {
    for (const statement of createPhotosSchemaSqlV4) client.run(statement);
    migrated = true;
  }
  if (currentVersion < 5) {
    runPhotosTransaction(client, () => {
      normalizeStoredTagNames(client, { tags: 'photo_tags', fileTags: 'photo_file_tags', tagAliases: 'photo_tag_aliases' });
      rebuildPhotoSearchIndex(drizzle(client, { schema: photosSchema }), client);
    });
    migrated = true;
  }
  if (currentVersion < 6) {
    client.run('DELETE FROM photo_face_index_state');
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

const runPhotosMigrationStatement = (client: Database, statement: string): void => {
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

const SNAPSHOT_LEASE_RETRY_MS = 10;
const SNAPSHOT_LEASE_TIMEOUT_MS = 30_000;

const acquireSnapshotLease = async (lock: HomeLock, signal?: AbortSignal | undefined): Promise<void> => {
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

const verifySnapshotIntegrity = (SQL: SqlJsStatic, targetPath: string): void => {
  const client = new SQL.Database(readFileSync(targetPath));
  try {
    if (client.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') {
      throw new CatalogAppError(appError('backup_integrity_failed', 'Photos snapshot failed integrity_check'));
    }
  } finally {
    client.close();
  }
};

const removeSnapshotFile = (targetPath: string): void => {
  for (const filePath of [targetPath, `${targetPath}.tmp`]) {
    try {
      unlinkSync(filePath);
    } catch (cause) {
      if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause;
    }
  }
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

const PHOTO_LIST_ITEM_COLUMNS = `fingerprint, file_name, current_path, ext, captured_at, captured_at_source, width, height,
                proxy_state, thumb_state, missing_at, exif_read_at,
                (SELECT COUNT(*) FROM photo_paths WHERE fingerprint = photos.fingerprint) AS sightings,
                EXISTS (SELECT 1 FROM photo_analyses pa WHERE pa.fingerprint = photos.fingerprint) AS analysed,
                (SELECT error_code FROM photo_analysis_errors pae WHERE pae.fingerprint = photos.fingerprint ORDER BY created_at DESC, config_id ASC LIMIT 1),
                (SELECT error_message FROM photo_analysis_errors pae WHERE pae.fingerprint = photos.fingerprint ORDER BY created_at DESC, config_id ASC LIMIT 1),
                (SELECT created_at FROM photo_analysis_errors pae WHERE pae.fingerprint = photos.fingerprint ORDER BY created_at DESC, config_id ASC LIMIT 1)`;

const appErrorCodeSchema = z.enum(ERROR_CODES);

const photoAnalysisErrorFromValues = (
  code: SqlValue | undefined,
  message: SqlValue | undefined,
  createdAt: SqlValue | undefined,
): PhotoAnalysisError | null => {
  if (code === null || code === undefined) return null;
  return {
    code: appErrorCodeSchema.parse(code),
    message: z.string().parse(message),
    createdAt: z.string().parse(createdAt),
  };
};

const rowToPhotoListItem = (row: readonly SqlValue[]): PhotoListItem => ({
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
  exifReadAt: nullableStringValue(row[11]),
  sightings: numberValue(row[12]),
  analysed: numberValue(row[13]) === 1,
  analysisError: photoAnalysisErrorFromValues(row[14], row[15], row[16]),
});

const parsePhotoGpsSource = (value: string | null): GpsSource | null =>
  value === 'camera' || value === 'timeline' || value === 'manual' ? value : null;

const parsePhotoIntervalKind = (value: string | null): TimelineIntervalKind | null =>
  value === 'visit' || value === 'activity' || value === 'path' ? value : null;

const roundTo6Photo = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const photoPlacesEqual = (left: CatalogPlace | null, right: CatalogPlace | null): boolean => {
  if (left === null || right === null) return left === right;
  return left.name === right.name && left.region === right.region && left.country === right.country
    && left.countryCode === right.countryCode && left.dataset === right.dataset
    && Math.abs(left.distanceM - right.distanceM) < 0.5;
};

const photoRowToPlace = (row: {
  placeName: string | null;
  placeRegion: string | null;
  placeCountry: string | null;
  placeCountryCode: string | null;
  placeDistanceM: number | null;
  placeDataset: string | null;
}): CatalogPlace | null => {
  if (row.placeName === null) return null;
  return {
    name: row.placeName,
    region: row.placeRegion,
    country: row.placeCountry,
    countryCode: row.placeCountryCode,
    distanceM: row.placeDistanceM ?? 0,
    dataset: row.placeDataset ?? '',
  };
};

const photoGeoBackfillCandidateFromValues = (row: SqlValue[]): PhotoGeoBackfillCandidate => ({
  fingerprint: stringValue(row[0]),
  fileName: stringValue(row[1]),
  currentPath: canonicalPath(stringValue(row[2])),
  capturedAt: nullableStringValue(row[3]),
  capturedAtSource: parseCapturedAtSource(nullableStringValue(row[4])),
  gpsLat: nullableNumberValue(row[5]),
  gpsLon: nullableNumberValue(row[6]),
  gpsSource: parsePhotoGpsSource(nullableStringValue(row[7])),
  placeName: nullableStringValue(row[8]),
});

const photoLocationRowFromValues = (row: SqlValue[]): PhotoLocationRow | null => {
  const lat = nullableNumberValue(row[2]);
  const lon = nullableNumberValue(row[3]);
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const placeName = nullableStringValue(row[13]);
  return {
    fingerprint: stringValue(row[0]),
    fileName: stringValue(row[1]),
    lat,
    lon,
    missing: nullableNumberValue(row[4]) !== null,
    capturedAt: nullableStringValue(row[5]),
    thumbState: parseThumbState(stringValue(row[6])),
    folder: {
      folderId: stringValue(row[7]),
      currentPath: canonicalPath(stringValue(row[8])),
      displayName: stringValue(row[9]),
    },
    source: parsePhotoGpsSource(nullableStringValue(row[10])),
    accuracyM: nullableNumberValue(row[11]),
    intervalKind: parsePhotoIntervalKind(nullableStringValue(row[12])),
    place: placeName === null ? null : {
      name: placeName,
      region: nullableStringValue(row[14]),
      country: nullableStringValue(row[15]),
      countryCode: nullableStringValue(row[16]),
      distanceM: nullableNumberValue(row[17]) ?? 0,
      dataset: nullableStringValue(row[18]) ?? '',
    },
  };
};

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

const resolveLatestPhotoAnalysisError = (
  db: PhotosDrizzle,
  fingerprint: string,
): PhotoAnalysisError | null => {
  const row = db.select().from(photoAnalysisErrors).where(eq(photoAnalysisErrors.fingerprint, fingerprint)).all()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.configId.localeCompare(right.configId))[0];
  if (row === undefined) return null;
  return {
    code: appErrorCodeSchema.parse(row.errorCode),
    message: row.errorMessage,
    createdAt: row.createdAt,
  };
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

const ensurePhotoSearchDocuments = (db: PhotosDrizzle, client: Database): boolean => {
  const missing = client.exec(
    'SELECT fingerprint FROM photos WHERE fingerprint NOT IN (SELECT fingerprint FROM photo_search_documents)',
  );
  const fingerprints = (missing[0]?.values ?? []).map((row) => stringValue(row[0]));
  for (const fingerprint of fingerprints) syncPhotoSearchDocument(db, client, fingerprint);
  return fingerprints.length > 0;
};

const rebuildPhotoSearchIndex = (db: PhotosDrizzle, client: Database): void => {
  client.run('DELETE FROM photo_search_documents_fts');
  client.run('DELETE FROM photo_search_documents');
  for (const row of db.select({ fingerprint: photos.fingerprint }).from(photos).all()) {
    syncPhotoSearchDocument(db, client, row.fingerprint);
  }
};

const photoSearchRowFromValues = (
  row: SqlValue[],
  rankingTerms: readonly string[],
): { row: PhotoSearchRow; score: number } => {
  const description = nullableStringValue(row[5]);
  const snippet = stringValue(row[6]);
  const tagsText = stringValue(row[7]);
  const place = stringValue(row[8]);
  const fileName = stringValue(row[1]);
  return {
    row: {
      fingerprint: stringValue(row[0]),
      fileName,
      currentPath: canonicalPath(stringValue(row[2])),
      ext: parseExtension(stringValue(row[3])),
      capturedAt: nullableStringValue(row[4]),
      description,
      snippet: snippet.length > 0 ? snippet : description ?? fileName,
      tags: tagsText.split('\n').filter((tag) => tag.length > 0),
      variantCount: numberValue(row[9]),
      thumbState: parseThumbState(stringValue(row[10])),
      proxyState: parseProxyState(stringValue(row[11])),
      missingAt: nullableNumberValue(row[12]),
    },
    score: photoSearchScore({ fileName, place, tagsText, description: description ?? '' }, rankingTerms),
  };
};

const photoTagWhereClauses = (
  tagTermSets: readonly (readonly string[])[],
): { clauses: string[]; params: Record<string, string> } => {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  tagTermSets.forEach((termSet, setIndex) => {
    const alternatives = termSet.map((term, termIndex) => {
      const key = `$tag${String(setIndex)}_${String(termIndex)}`;
      params[key] = `%\n${term}\n%`;
      return `('\n' || COALESCE(sd.tags_text, '') || '\n') LIKE ${key}`;
    });
    if (alternatives.length > 0) clauses.push(`(${alternatives.join(' OR ')})`);
  });
  return { clauses, params };
};

const photoDateWhereClauses = (
  from: string | null,
  to: string | null,
): { clauses: string[]; params: Record<string, string> } => {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (from !== null) {
    clauses.push('p.captured_at >= $capturedFrom');
    params.$capturedFrom = from;
  }
  if (to !== null) {
    clauses.push('p.captured_at <= $capturedTo');
    params.$capturedTo = to;
  }
  return { clauses, params };
};

const photoFolderWhereClause = (
  folderId: string | null,
): { clauses: string[]; params: Record<string, string> } => folderId === null
  ? { clauses: [], params: {} }
  : {
      clauses: [`(p.folder_id = $folderId OR EXISTS (
        SELECT 1 FROM photo_paths pp
        WHERE pp.fingerprint = p.fingerprint AND pp.folder_id = $folderId
      ))`],
      params: { $folderId: folderId },
    };

const photoFingerprintWhereClause = (
  fingerprints: readonly string[] | null,
): { clauses: string[]; params: Record<string, string> } => {
  if (fingerprints === null) return { clauses: [], params: {} };
  const unique = [...new Set(fingerprints)];
  if (unique.length === 0) return { clauses: ['1 = 0'], params: {} };
  const params: Record<string, string> = {};
  const placeholders = unique.map((fingerprint, index) => {
    const name = `$fingerprint${String(index)}`;
    params[name] = fingerprint;
    return name;
  });
  return { clauses: [`p.fingerprint IN (${placeholders.join(', ')})`], params };
};

const photoCollectionOrderBySql = (sort: 'captured_desc' | 'captured_asc' | 'name_asc'): string => {
  switch (sort) {
    case 'captured_desc':
      return 'p.captured_at IS NULL, p.captured_at DESC, p.file_name ASC';
    case 'captured_asc':
      return 'p.captured_at IS NULL, p.captured_at ASC, p.file_name ASC';
    case 'name_asc':
      return 'p.file_name ASC';
  }
};

const photoCapturedAtCompare = (left: PhotoSearchRow, right: PhotoSearchRow, direction: 1 | -1): number => {
  if (left.capturedAt === null && right.capturedAt === null) return compareUtf8Bytes(left.fileName, right.fileName);
  if (left.capturedAt === null) return 1;
  if (right.capturedAt === null) return -1;
  if (left.capturedAt === right.capturedAt) return compareUtf8Bytes(left.fileName, right.fileName);
  return left.capturedAt < right.capturedAt ? -direction : direction;
};

const sortPhotoSearchRows = (
  rows: readonly PhotoSearchRow[],
  sort: 'captured_desc' | 'captured_asc' | 'name_asc',
): PhotoSearchRow[] => {
  const sorted = [...rows];
  switch (sort) {
    case 'captured_desc':
      return sorted.sort((left, right) => photoCapturedAtCompare(left, right, -1));
    case 'captured_asc':
      return sorted.sort((left, right) => photoCapturedAtCompare(left, right, 1));
    case 'name_asc':
      return sorted.sort((left, right) => compareUtf8Bytes(left.fileName, right.fileName));
  }
};

const photoSearchScore = (
  columns: { fileName: string; place: string; tagsText: string; description: string },
  rankingTerms: readonly string[],
): number => {
  let score = 0;
  for (const term of rankingTerms) {
    score += countTerm(columns.fileName, term) * 80;
    score += countTerm(columns.place, term) * 55;
    score += countTerm(columns.tagsText, term) * 45;
    score += countTerm(columns.description, term) * 30;
  }
  return score;
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
