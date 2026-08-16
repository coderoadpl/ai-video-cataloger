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
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import { z } from 'zod';

import {
  FACE_ENGINE_VERSION,
  GLOBAL_CATALOG_SCHEMA_VERSION,
  LEGACY_CONFIG_ID,
  analysisLanguageResolutionSchema,
  catalogVariantSchema,
  configId,
  configDescriptorSchema,
  parseDriveRunBatchState,
  appError,
  canonicalPath,
  compareUtf8Bytes,
  normalizeTagList,
  normalizeTagName,
  ok,
  type AppError,
  acceptsGpsWrite,
  type CatalogAnalysis,
  type CatalogFile,
  type CatalogFolder,
  type CatalogPlace,
  type CatalogVariant,
  type FaceObservation,
  type GpsSource,
  type Person,
  type Result,
  type TimelineIntervalKind,
} from '@core/domain/index.js';
import type {
  AnalyzedFileLocation,
  ApplyGeoBackfillInput,
  ApplyGeoBackfillResult,
  CatalogFilePerson,
  CatalogFileRecord,
  FaceIndexCandidate,
  FaceIndexScope,
  FaceStatusCounts,
  GeoBackfillCandidate,
  CatalogLockProcessName,
  CatalogLockSnapshot,
  CatalogLocationRow,
  CatalogLocationsSnapshot,
  CatalogSearchFilters,
  CatalogSearchInput,
  CatalogSearchResults,
  CatalogSearchRow,
  CatalogTagAlias,
  CatalogTagAliasResult,
  CatalogTagSummary,
  DriveRunRecord,
  ForgetEntryResult,
  GlobalCatalogCounts,
  GlobalCatalogStore,
  LibraryFacets,
  ReconcileFolderInput,
  ReconcileFolderResult,
  TagTermExpansion,
} from '@core/server/index.js';

import {
  analyses,
  analysisConfigs,
  createGlobalCatalogSchemaSqlV1,
  driveRuns,
  faceIndexState,
  faceObservations,
  fileTags,
  files,
  folders,
  globalCatalogSchema,
  migrateGlobalCatalogSchemaSqlV2,
  migrateGlobalCatalogSchemaSqlV3,
  migrateGlobalCatalogSchemaSqlV4,
  migrateGlobalCatalogSchemaSqlV5,
  migrateGlobalCatalogSchemaSqlV6,
  migrateGlobalCatalogSchemaSqlV7,
  migrateGlobalCatalogSchemaSqlV8,
  migrateGlobalCatalogSchemaSqlV9,
  migrateGlobalCatalogSchemaSqlV10,
  migrateGlobalCatalogSchemaSqlV11,
  migrateGlobalCatalogSchemaSqlV12,
  migrateGlobalCatalogSchemaSqlV13,
  migrateGlobalCatalogSchemaSqlV14,
  schemaMeta,
  tagAliases,
  tags,
  people,
} from './global-catalog-schema.js';
import { CatalogAppError, HomeLock, type CatalogLockFs } from './home-lock.js';
import { countTerm } from './search-score.js';

const dbDirectoryName = '.ai-video-cataloger';
const dbFileName = 'catalog.db';
const AUTO_FLUSH_MUTATION_COUNT = 25;
const analyzedFileLocationSchema = z.object({
  fingerprint: z.string(),
  folderId: z.string(),
  fileName: z.string(),
  finalName: z.string().nullable(),
  folderPath: z.string().nullable(),
});
const analyzedFileLocationsSchema = z.array(analyzedFileLocationSchema);

export type { CatalogLockFs };

type GlobalSchema = typeof globalCatalogSchema;
type GlobalDrizzle = SQLJsDatabase<GlobalSchema>;

interface FileState {
  mtimeMs: number;
  size: number;
}

export interface GlobalCatalogAdapterOptions {
  homeDirectory?: string | undefined;
  processName?: CatalogLockProcessName | undefined;
  lockMode?: 'none' | 'lazy' | 'eager' | undefined;
  isProcessAlive?: ((pid: number) => boolean) | undefined;
  lockFs?: CatalogLockFs | undefined;
  lock?: HomeLock | undefined;
}

export class SqlJsGlobalCatalogStore implements GlobalCatalogStore {
  private readonly filePath: string;
  private readonly lockMode: 'none' | 'lazy' | 'eager';
  private readonly lock: HomeLock;
  private dirtyCount = 0;
  private state: {
    SQL: SqlJsStatic;
    client: Database;
    db: GlobalDrizzle;
    fileState: FileState;
  } | null = null;

  constructor(options: GlobalCatalogAdapterOptions = {}) {
    const homeDirectory = options.homeDirectory ?? homedir();
    this.filePath = globalCatalogPath(homeDirectory);
    this.lockMode = options.lockMode ?? (options.processName === undefined ? 'none' : 'lazy');
    this.lock = options.lock ?? new HomeLock({
      homeDirectory,
      processName: options.processName ?? 'cli',
      lockMode: this.lockMode,
      isProcessAlive: options.isProcessAlive,
      lockFs: options.lockFs,
    });
    if (this.lockMode === 'eager') {
      try {
        this.lock.takeWriteLock();
      } catch (cause) {
        if (!(cause instanceof CatalogAppError) || cause.appError.code !== 'catalog_locked') throw cause;
      }
    }
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

  async acquireLease(): Promise<Result<void, AppError>> {
    try {
      this.lock.acquireLease();
      return ok(undefined);
    } catch (cause) {
      return failure(cause);
    }
  }

  async releaseLease(): Promise<Result<void, AppError>> {
    this.lock.releaseLease();
    return this.flush();
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

  async lockStatus(): Promise<Result<CatalogLockSnapshot, AppError>> {
    try {
      return ok(this.lock.snapshot([]));
    } catch (cause) {
      return failure(cause);
    }
  }

  async acquireWriteLock(): Promise<Result<CatalogLockSnapshot, AppError>> {
    try {
      const warnings = this.lock.takeWriteLock();
      return ok(this.lock.snapshot(warnings));
    } catch (cause) {
      return failure(cause);
    }
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
            currentPath: canonicalPath(folder.currentPath),
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
    return this.write((db, client) => {
      const existingRow = db.select().from(files).where(eq(files.fingerprint, file.fingerprint)).get();
      const existing = existingRow === undefined ? null : rowToFile(existingRow);
      const incomingSource: GpsSource = file.gpsSource ?? 'camera';
      const accepted = acceptsGpsWrite(
        { lat: existing?.gpsLat ?? null, lon: existing?.gpsLon ?? null, source: existing?.gpsSource ?? null },
        { lat: file.gpsLat, lon: file.gpsLon, source: incomingSource },
      );
      const merged: CatalogFile = accepted
        ? { ...file, gpsSource: file.gpsLat === null || file.gpsLon === null ? null : incomingSource }
        : {
          ...file,
          gpsLat: existing?.gpsLat ?? null,
          gpsLon: existing?.gpsLon ?? null,
          gpsSource: existing?.gpsSource ?? null,
          gpsAccuracyM: existing?.gpsAccuracyM ?? null,
          gpsIntervalKind: existing?.gpsIntervalKind ?? null,
          gpsResolvedAt: existing?.gpsResolvedAt ?? null,
        };
      db.insert(files)
        .values(fileToRow(merged))
        .onConflictDoUpdate({
          target: files.fingerprint,
          set: {
            folderId: merged.folderId,
            fileName: canonicalPath(merged.fileName),
            size: merged.size,
            durationS: merged.durationS,
            gpsLat: merged.gpsLat,
            gpsLon: merged.gpsLon,
            gpsSource: merged.gpsSource,
            gpsAccuracyM: merged.gpsAccuracyM,
            gpsIntervalKind: merged.gpsIntervalKind,
            gpsResolvedAt: merged.gpsResolvedAt,
            processedAt: merged.processedAt,
            analyzer: merged.analyzer,
            model: merged.model,
            missingAt: merged.missingAt,
            capturedAt: merged.capturedAt ?? existing?.capturedAt ?? null,
            capturedAtSource: merged.capturedAt === null ? existing?.capturedAtSource ?? null : merged.capturedAtSource,
          },
        })
        .run();
      syncSearchDocument(db, client, file.fingerprint);
    });
  }

  async getAnalysis(fingerprint: string): Promise<Result<CatalogAnalysis | null, AppError>> {
    return this.read((db) => {
      const row = selectedAnalysisRow(db, fingerprint);
      return row === undefined ? null : rowToAnalysis(row, tagsForVariant(db, fingerprint, row.configId));
    });
  }

  async upsertAnalysis(analysis: CatalogAnalysis): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      const file = db.select().from(files).where(eq(files.fingerprint, analysis.fingerprint)).get();
      const createdAt = file?.processedAt ?? new Date().toISOString();
      const finalName = analysis.finalName === null ? null : canonicalPath(analysis.finalName);
      db.insert(analyses)
        .values({
          fingerprint: analysis.fingerprint,
          configId: LEGACY_CONFIG_ID,
          finalName,
          description: analysis.description,
          transcript: analysis.transcript,
          language: analysis.language,
          configJson: null,
          analyzer: file?.analyzer ?? null,
          model: file?.model ?? null,
          createdAt,
          usageJson: null,
        })
        .onConflictDoUpdate({
          target: [analyses.fingerprint, analyses.configId],
          set: {
            finalName,
            description: analysis.description,
            transcript: analysis.transcript,
            language: analysis.language,
            analyzer: file?.analyzer ?? null,
            model: file?.model ?? null,
            createdAt,
          },
        })
        .run();
      db.update(files)
        .set({ selectedConfigId: LEGACY_CONFIG_ID })
        .where(and(eq(files.fingerprint, analysis.fingerprint), isNull(files.selectedConfigId)))
        .run();
      setVariantTags(db, analysis.fingerprint, LEGACY_CONFIG_ID, analysis.tags);
      syncSearchDocument(db, client, analysis.fingerprint);
    });
  }

  async listVariants(fingerprint: string): Promise<Result<CatalogVariant[], AppError>> {
    return this.read((db) => db.select().from(analyses)
      .where(eq(analyses.fingerprint, fingerprint))
      .all()
      .map((row) => rowToVariant(row, tagsForVariant(db, fingerprint, row.configId)))
      .sort(compareVariants));
  }

  async getVariant(fingerprint: string, configIdValue: string): Promise<Result<CatalogVariant | null, AppError>> {
    return this.read((db) => {
      const row = db.select().from(analyses)
        .where(and(eq(analyses.fingerprint, fingerprint), eq(analyses.configId, configIdValue)))
        .get();
      return row === undefined ? null : rowToVariant(row, tagsForVariant(db, fingerprint, configIdValue));
    });
  }

  async upsertVariant(input: CatalogVariant, languageResolution?: z.input<typeof analysisLanguageResolutionSchema>): Promise<Result<void, AppError>> {
    const parsed = catalogVariantSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: appError('validation', parsed.error.message) };
    const parsedResolution = languageResolution === undefined
      ? null
      : analysisLanguageResolutionSchema.safeParse(languageResolution);
    if (parsedResolution !== null && !parsedResolution.success) {
      return { ok: false, error: appError('validation', parsedResolution.error.message) };
    }
    const variant = parsed.data;
    if (variant.configId === LEGACY_CONFIG_ID ? variant.descriptor !== null : variant.descriptor === null) {
      return { ok: false, error: appError('validation', 'Only the legacy variant may omit its config descriptor') };
    }
    if (variant.descriptor !== null && configId(variant.descriptor) !== variant.configId) {
      return { ok: false, error: appError('validation', 'Variant configId does not match its descriptor') };
    }
    return this.write((db, client) => {
      upsertAnalysisConfig(db, variant);
      const resolutionFields = parsedResolution === null ? {} : {
        resolvedOutputLanguage: parsedResolution.data.outputLanguage,
        resolvedTagLanguage: parsedResolution.data.tagLanguage,
      };
      db.insert(analyses)
        .values({
          ...variantToRow(variant),
          ...resolutionFields,
        })
        .onConflictDoUpdate({
          target: [analyses.fingerprint, analyses.configId],
          set: {
            finalName: variant.finalName === null ? null : canonicalPath(variant.finalName),
            description: variant.description,
            transcript: variant.transcript,
            language: variant.language,
            configJson: variant.descriptor === null ? null : JSON.stringify(variant.descriptor),
            analyzer: variant.analyzer,
            model: variant.model,
            createdAt: variant.createdAt,
            usageJson: variant.usage === null ? null : JSON.stringify(variant.usage),
            ...resolutionFields,
          },
        })
        .run();
      setVariantTags(db, variant.fingerprint, variant.configId, variant.tags);
      syncSearchDocument(db, client, variant.fingerprint);
    });
  }

  async getVariantLanguageResolution(fingerprint: string, configIdValue: string) {
    return this.read((db) => {
      const row = db.select({
        outputLanguage: analyses.resolvedOutputLanguage,
        tagLanguage: analyses.resolvedTagLanguage,
      }).from(analyses)
        .where(and(eq(analyses.fingerprint, fingerprint), eq(analyses.configId, configIdValue)))
        .get();
      if (row === undefined || row.outputLanguage === null || row.tagLanguage === null) return null;
      return analysisLanguageResolutionSchema.parse(row);
    });
  }

  async deleteVariant(fingerprint: string, configIdValue: string): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      const rows = db.select().from(analyses).where(eq(analyses.fingerprint, fingerprint)).all();
      const deleted = rows.find((row) => row.configId === configIdValue);
      if (deleted === undefined) return;
      if (rows.length === 1) {
        throw new CatalogAppError(appError('conflict', 'Cannot delete the last analysis variant'));
      }
      const selected = selectedAnalysisRow(db, fingerprint);
      const survivor = rows.filter((row) => row.configId !== configIdValue).sort(compareVariantIdentity)[0];
      runCatalogTransaction(client, () => {
        db.delete(fileTags)
          .where(and(eq(fileTags.fingerprint, fingerprint), eq(fileTags.configId, configIdValue)))
          .run();
        db.delete(analyses)
          .where(and(eq(analyses.fingerprint, fingerprint), eq(analyses.configId, configIdValue)))
          .run();
        if (selected?.configId === configIdValue && survivor !== undefined) {
          db.update(files).set({ selectedConfigId: survivor.configId }).where(eq(files.fingerprint, fingerprint)).run();
        }
        syncSearchDocument(db, client, fingerprint);
      });
    });
  }

  async clearAnalysisVariants(fingerprint: string): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      runCatalogTransaction(client, () => {
        db.delete(fileTags).where(eq(fileTags.fingerprint, fingerprint)).run();
        db.delete(analyses).where(eq(analyses.fingerprint, fingerprint)).run();
        db.update(files).set({ selectedConfigId: null }).where(eq(files.fingerprint, fingerprint)).run();
        syncSearchDocument(db, client, fingerprint);
      });
    });
  }

  async setSelectedVariant(fingerprint: string, configIdValue: string | null): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      runCatalogTransaction(client, () => {
        db.update(files).set({ selectedConfigId: configIdValue }).where(eq(files.fingerprint, fingerprint)).run();
        syncSearchDocument(db, client, fingerprint);
      });
    });
  }

  async getSelectedConfigId(fingerprint: string): Promise<Result<string | null, AppError>> {
    return this.read((db) => selectedAnalysisRow(db, fingerprint)?.configId ?? null);
  }

  async getExplicitSelectedConfigId(fingerprint: string): Promise<Result<string | null, AppError>> {
    return this.read((db) => db.select().from(files).where(eq(files.fingerprint, fingerprint)).get()?.selectedConfigId ?? null);
  }

  async getFolderDefaultConfigId(folderId: string): Promise<Result<string | null, AppError>> {
    return this.read((db) => db.select().from(folders).where(eq(folders.folderId, folderId)).get()?.defaultConfigId ?? null);
  }

  async setFolderDefaultVariant(folderId: string, configIdValue: string | null): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      runCatalogTransaction(client, () => {
        db.update(folders).set({ defaultConfigId: configIdValue }).where(eq(folders.folderId, folderId)).run();
        const fileRows = db.select().from(files).where(eq(files.folderId, folderId)).all();
        for (const fileRow of fileRows) syncSearchDocument(db, client, fileRow.fingerprint);
      });
    });
  }

  async listAnalyzedFileLocations(fingerprints: readonly string[]): Promise<Result<AnalyzedFileLocation[], AppError>> {
    if (fingerprints.length === 0) return ok([]);
    return this.read((_db, client) => {
      const unique = [...new Set(fingerprints)];
      const parameters: Record<string, SqlValue> = {};
      const placeholders = unique.map((fingerprint, index) => {
        const name = `$fingerprint${String(index)}`;
        parameters[name] = fingerprint;
        return name;
      });
      const result = client.exec(
        `SELECT f.fingerprint, f.folder_id, f.file_name, a.final_name, fo.current_path
          FROM files f
          LEFT JOIN folders fo ON fo.folder_id = f.folder_id
          JOIN analyses a ON a.fingerprint = f.fingerprint
            AND a.config_id = COALESCE(
              (SELECT config_id FROM analyses
                WHERE fingerprint = f.fingerprint AND config_id = f.selected_config_id),
              (SELECT config_id FROM analyses
                WHERE fingerprint = f.fingerprint AND config_id = fo.default_config_id),
              (SELECT config_id FROM analyses
                WHERE fingerprint = f.fingerprint
                ORDER BY created_at DESC, config_id ASC LIMIT 1)
            )
          WHERE f.fingerprint IN (${placeholders.join(', ')})`,
        parameters,
      );
      const rows = (result[0]?.values ?? []).map((row) => ({
        fingerprint: stringValue(row[0]),
        folderId: stringValue(row[1]),
        fileName: stringValue(row[2]),
        finalName: nullableStringValue(row[3]),
        folderPath: nullableStringValue(row[4]),
      }));
      return analyzedFileLocationsSchema.parse(rows)
        .sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
    });
  }

  async listFolderRecords(folderId: string): Promise<Result<CatalogFileRecord[], AppError>> {
    return this.read((db) => {
      const fileRows = db.select().from(files).where(eq(files.folderId, folderId)).all();
      const analysisRows = db
        .select({ analysis: analyses })
        .from(analyses)
        .innerJoin(files, eq(files.fingerprint, analyses.fingerprint))
        .where(eq(files.folderId, folderId))
        .all();
      const tagRows = db
        .select({ fingerprint: fileTags.fingerprint, configId: fileTags.configId, name: tags.name })
        .from(fileTags)
        .innerJoin(tags, eq(tags.tagId, fileTags.tagId))
        .innerJoin(files, eq(files.fingerprint, fileTags.fingerprint))
        .where(eq(files.folderId, folderId))
        .all();
      const folderRow = db.select().from(folders).where(eq(folders.folderId, folderId)).get();
      const analysesByFingerprint = groupAnalysisRows(analysisRows.map((row) => row.analysis));
      const tagsByVariant = groupVariantTagNames(tagRows);
      return fileRows.map((fileRow) => {
        const analysisRow = resolveSelectedAnalysis(
          analysesByFingerprint.get(fileRow.fingerprint) ?? [],
          fileRow.selectedConfigId,
          folderRow?.defaultConfigId ?? null,
        );
        return {
          file: rowToFile(fileRow),
          analysis: analysisRow === undefined
            ? null
            : rowToAnalysis(analysisRow, tagsByVariant.get(variantKey(fileRow.fingerprint, analysisRow.configId)) ?? []),
        };
      });
    });
  }

  async listTags(): Promise<Result<CatalogTagSummary[], AppError>> {
    return this.read((db) => {
      const tagRows = db.select().from(tags).all();
      const fileTagRows = db.select().from(fileTags).all();
      const selectedKeys = new Set(db.select().from(files).all().flatMap((fileRow) => {
        const selected = selectedAnalysisRow(db, fileRow.fingerprint);
        return selected === undefined ? [] : [variantKey(fileRow.fingerprint, selected.configId)];
      }));
      return tagRows
        .map((tag) => ({
          name: tag.name,
          count: fileTagRows.filter((fileTag) => (
            fileTag.tagId === tag.tagId
            && selectedKeys.has(variantKey(fileTag.fingerprint, fileTag.configId))
          )).length,
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
    return this.write((db, client) => {
      const canonicalTag = ensureTag(db, canonical);
      const aliasTag = db.select().from(tags).where(eq(tags.name, alias)).get();
      let remappedFiles = 0;
      const affected = new Set<string>();
      if (aliasTag !== undefined && aliasTag.tagId !== canonicalTag.tagId) {
        const rows = db.select().from(fileTags).where(eq(fileTags.tagId, aliasTag.tagId)).all();
        for (const row of rows) {
          affected.add(row.fingerprint);
          db.insert(fileTags)
            .values({ fingerprint: row.fingerprint, configId: row.configId, tagId: canonicalTag.tagId })
            .onConflictDoNothing()
            .run();
        }
        remappedFiles = affected.size;
        db.delete(fileTags).where(eq(fileTags.tagId, aliasTag.tagId)).run();
        db.update(tagAliases)
          .set({ tagId: canonicalTag.tagId })
          .where(eq(tagAliases.tagId, aliasTag.tagId))
          .run();
        db.delete(tags).where(eq(tags.tagId, aliasTag.tagId)).run();
      }
      db.insert(tagAliases)
        .values({ alias, tagId: canonicalTag.tagId })
        .onConflictDoUpdate({
          target: tagAliases.alias,
        set: { tagId: canonicalTag.tagId },
      })
      .run();
      for (const fingerprint of affected) syncSearchDocument(db, client, fingerprint);
      return { alias, canonical: canonicalTag.name, remappedFiles };
    });
  }

  async listTagAliases(): Promise<Result<CatalogTagAlias[], AppError>> {
    return this.read((db) => {
      const names = new Map(db.select().from(tags).all().map((tag) => [tag.tagId, tag.name]));
      return db.select().from(tagAliases).all()
        .flatMap((row) => {
          const canonical = names.get(row.tagId);
          return canonical === undefined ? [] : [{ alias: row.alias, canonical }];
        })
        .sort((left, right) => left.alias.localeCompare(right.alias));
    });
  }

  async expandTagTerms(terms: readonly string[]): Promise<Result<TagTermExpansion[], AppError>> {
    const unique = [...new Set(terms)].filter((term) => term.length > 0);
    if (unique.length === 0) return { ok: true, value: [] };
    return this.read((db, client) => {
      const placeholders = unique.map((_, index) => `$t${String(index)}`);
      const params = Object.fromEntries(unique.map((term, index) => [`$t${String(index)}`, term]));
      const list = placeholders.join(', ');
      const result = client.exec(
        `SELECT t.name AS canonical, a.alias AS alias
          FROM tags t
          LEFT JOIN tag_aliases a ON a.tag_id = t.tag_id
          WHERE t.tag_id IN (
            SELECT tag_id FROM tags WHERE name IN (${list})
            UNION
            SELECT tag_id FROM tag_aliases WHERE alias IN (${list})
          )`,
        params,
      );
      const rows = result[0]?.values ?? [];
      const groups = new Map<string, Set<string>>();
      for (const row of rows) {
        const canonical = String(row[0]);
        const alias = row[1] === null ? null : String(row[1]);
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

  async search(input: CatalogSearchInput): Promise<Result<CatalogSearchResults, AppError>> {
    return this.read((db, client) => {
      const clauses = buildSearchFilterClauses(input.filters);

      if (input.match !== null) {
        const where = combineSearchWhere('search_documents_fts MATCH $match', clauses);
        const result = client.exec(
          `SELECT ${SEARCH_COLUMNS_MATCHED}
            FROM search_documents_fts
            JOIN search_documents sd ON sd.docid = search_documents_fts.docid
            JOIN files f ON f.fingerprint = sd.fingerprint
            JOIN folders fo ON fo.folder_id = f.folder_id
            WHERE ${where.sql}`,
          { $match: input.match, ...where.params },
        );
        const values = result[0]?.values ?? [];
        const rows = values.map((row) => searchRowFromValues(row, input.rankingTerms));
        const sorted = input.sort === 'relevance'
          ? rows.sort((left, right) => right.score - left.score || left.fileName.localeCompare(right.fileName))
          : sortSearchRows(rows, input.sort);
        return { total: sorted.length, rows: sorted.slice(input.offset, input.offset + input.limit) };
      }

      const where = combineSearchWhere(null, clauses);
      const baseFrom = `FROM files f
          JOIN folders fo ON fo.folder_id = f.folder_id
          LEFT JOIN search_documents sd ON sd.fingerprint = f.fingerprint`;
      const countResult = client.exec(`SELECT COUNT(*) ${baseFrom} WHERE ${where.sql}`, where.params);
      const total = numberValue(countResult[0]?.values[0]?.[0]);
      const sort = input.sort === 'relevance' ? 'captured_desc' : input.sort;
      const result = client.exec(
        `SELECT ${SEARCH_COLUMNS_UNMATCHED}
          ${baseFrom}
          WHERE ${where.sql}
          ORDER BY ${searchOrderBySql(sort)}
          LIMIT $limit OFFSET $offset`,
        { ...where.params, $limit: input.limit, $offset: input.offset },
      );
      const values = result[0]?.values ?? [];
      const rows = values.map((row) => searchRowFromValues(row, input.rankingTerms));
      return { total, rows };
    });
  }

  async listLocations(): Promise<Result<CatalogLocationsSnapshot, AppError>> {
    return this.read((db, client) => {
      const totalFiles = db.select().from(files).all().length;
      const result = client.exec(
        `SELECT
          f.fingerprint,
          f.file_name,
          NULLIF(a.final_name, ''),
          f.gps_lat,
          f.gps_lon,
          f.missing_at,
          fo.folder_id,
          fo.current_path,
          fo.display_name,
          fo.first_seen_at,
          fo.last_seen_at,
          f.gps_source,
          f.gps_accuracy_m,
          f.gps_interval_kind,
          f.place_name,
          f.place_region,
          f.place_country,
          f.place_country_code,
          f.place_distance_m,
          f.place_dataset
        FROM files f
        JOIN folders fo ON fo.folder_id = f.folder_id
        LEFT JOIN analyses a ON a.fingerprint = f.fingerprint
          AND a.config_id = ${SELECTED_ANALYSIS_CONFIG_ID_SQL}
        WHERE f.gps_lat IS NOT NULL AND f.gps_lon IS NOT NULL
        ORDER BY f.file_name`,
      );
      const values = result[0]?.values ?? [];
      const rows = values
        .map(locationRowFromValues)
        .filter((row): row is CatalogLocationRow => row !== null);
      return { totalFiles, rows };
    });
  }

  async listLibraryFacets(): Promise<Result<LibraryFacets, AppError>> {
    return this.read((_db, client) => {
      const tagRows = client.exec(
        `SELECT t.name, COUNT(DISTINCT f.fingerprint)
          FROM tags t
          JOIN file_tags ft ON ft.tag_id = t.tag_id
          JOIN files f ON f.fingerprint = ft.fingerprint
          JOIN folders fo ON fo.folder_id = f.folder_id
          WHERE ft.config_id = ${SELECTED_ANALYSIS_CONFIG_ID_SQL}
          GROUP BY t.name
          ORDER BY COUNT(DISTINCT f.fingerprint) DESC, t.name`,
      )[0]?.values ?? [];
      const facetTags: LibraryFacets['tags'] = tagRows.map((row) => ({ name: stringValue(row[0]), count: numberValue(row[1]) }));

      const peopleRows = client.exec(
        `SELECT p.person_id, p.display_name, COUNT(DISTINCT o.fingerprint)
          FROM face_observations o
          JOIN people p ON p.person_id = o.person_id
          WHERE o.person_id IS NOT NULL
          GROUP BY p.person_id, p.display_name
          ORDER BY p.display_name IS NULL, p.display_name, p.person_id`,
      )[0]?.values ?? [];
      const facetPeople: LibraryFacets['people'] = peopleRows.map((row) => ({
        personId: stringValue(row[0]),
        displayName: nullableStringValue(row[1]),
        count: numberValue(row[2]),
      }));

      const placeRows = client.exec(
        `SELECT f.place_name, f.place_country, f.place_country_code, COUNT(*)
          FROM files f
          WHERE f.place_name IS NOT NULL
          GROUP BY f.place_name, f.place_country, f.place_country_code
          ORDER BY f.place_name`,
      )[0]?.values ?? [];
      const places: LibraryFacets['places'] = placeRows.map((row) => ({
        name: stringValue(row[0]),
        country: nullableStringValue(row[1]),
        countryCode: nullableStringValue(row[2]),
        count: numberValue(row[3]),
      }));

      const yearRows = client.exec(
        `SELECT strftime('%Y', f.captured_at) AS year, COUNT(*)
          FROM files f
          WHERE f.captured_at IS NOT NULL
          GROUP BY year
          ORDER BY year DESC`,
      )[0]?.values ?? [];
      const years: LibraryFacets['years'] = yearRows.map((row) => ({ year: stringValue(row[0]), count: numberValue(row[1]) }));

      const folderRows = client.exec(
        `SELECT fo.folder_id, fo.display_name, fo.current_path, COUNT(f.fingerprint)
          FROM folders fo
          LEFT JOIN files f ON f.folder_id = fo.folder_id
          GROUP BY fo.folder_id, fo.display_name, fo.current_path
          ORDER BY fo.display_name`,
      )[0]?.values ?? [];
      const facetFolders: LibraryFacets['folders'] = folderRows.map((row) => ({
        folderId: stringValue(row[0]),
        displayName: stringValue(row[1]),
        currentPath: stringValue(row[2]),
        count: numberValue(row[3]),
      }));

      const countsRow = client.exec(
        `SELECT
          COUNT(*),
          SUM(CASE WHEN f.gps_lat IS NOT NULL AND f.gps_lon IS NOT NULL THEN 1 ELSE 0 END),
          SUM(CASE WHEN f.captured_at IS NULL THEN 1 ELSE 0 END),
          SUM(CASE WHEN f.missing_at IS NOT NULL THEN 1 ELSE 0 END)
        FROM files f`,
      )[0]?.values[0] ?? [0, 0, 0, 0];
      const counts: LibraryFacets['counts'] = {
        total: numberValue(countsRow[0]),
        withGps: numberValue(countsRow[1] ?? 0),
        withoutCaptureDate: numberValue(countsRow[2] ?? 0),
        missing: numberValue(countsRow[3] ?? 0),
      };

      return { tags: facetTags, people: facetPeople, places, years, folders: facetFolders, counts };
    });
  }

  async listPeopleForFile(fingerprint: string): Promise<Result<CatalogFilePerson[], AppError>> {
    return this.read((_db, client) => {
      const rows = client.exec(
        `SELECT DISTINCT p.person_id, p.display_name
          FROM face_observations o
          JOIN people p ON p.person_id = o.person_id
          WHERE o.fingerprint = $fingerprint AND o.person_id IS NOT NULL
          ORDER BY p.display_name IS NULL, p.display_name, p.person_id`,
        { $fingerprint: fingerprint },
      )[0]?.values ?? [];
      return rows.map((row) => ({ personId: stringValue(row[0]), displayName: nullableStringValue(row[1]) }));
    });
  }

  async listGeoBackfillCandidates(input: { root: string | null }): Promise<Result<GeoBackfillCandidate[], AppError>> {
    return this.read((db, client) => {
      const root = input.root === null ? null : canonicalPath(input.root);
      const result = client.exec(
        `SELECT
          f.fingerprint,
          f.folder_id,
          fo.current_path,
          f.file_name,
          f.captured_at,
          f.gps_lat,
          f.gps_lon,
          f.gps_source,
          f.place_name
        FROM files f
        JOIN folders fo ON fo.folder_id = f.folder_id
        WHERE f.missing_at IS NULL
          AND ($root IS NULL OR fo.current_path = $root OR fo.current_path LIKE $rootPrefix)
        ORDER BY fo.current_path, f.file_name`,
        { $root: root, $rootPrefix: root === null ? null : `${root}/%` },
      );
      const values = result[0]?.values ?? [];
      return values.map(geoBackfillCandidateFromValues);
    });
  }

  async applyGeoBackfill(input: ApplyGeoBackfillInput): Promise<Result<ApplyGeoBackfillResult, AppError>> {
    return this.write((db, client) => {
      const existingRow = db.select().from(files).where(eq(files.fingerprint, input.fingerprint)).get();
      if (existingRow === undefined) return 'skipped_precedence';
      const existing = rowToFile(existingRow);

      let outcome: ApplyGeoBackfillResult = 'unchanged';
      const nextCapturedAt = input.capturedAt === undefined ? existing.capturedAt : input.capturedAt.at;
      const nextCapturedAtSource = input.capturedAt === undefined ? existing.capturedAtSource : input.capturedAt.source;
      if (input.capturedAt !== undefined && existing.capturedAt !== input.capturedAt.at) outcome = 'written';

      let nextGpsLat = existing.gpsLat;
      let nextGpsLon = existing.gpsLon;
      let nextGpsSource = existing.gpsSource;
      let nextAccuracyM = existing.gpsAccuracyM;
      let nextIntervalKind = existing.gpsIntervalKind;
      let nextResolvedAt = existing.gpsResolvedAt;
      if (input.location !== undefined) {
        const accepted = acceptsGpsWrite(
          { lat: existing.gpsLat, lon: existing.gpsLon, source: existing.gpsSource },
          { lat: input.location.lat, lon: input.location.lon, source: input.location.source },
        );
        if (!accepted) {
          if (outcome !== 'written') outcome = 'skipped_precedence';
        } else {
          const unchangedCoordinates = existing.gpsLat !== null && existing.gpsLon !== null
            && roundTo6(existing.gpsLat) === roundTo6(input.location.lat)
            && roundTo6(existing.gpsLon) === roundTo6(input.location.lon)
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

      let nextPlace = existing.place;
      if (input.place !== undefined && !placesEqual(existing.place, input.place)) {
        nextPlace = input.place;
        if (outcome !== 'skipped_precedence' || input.location === undefined) outcome = 'written';
      }

      const merged: CatalogFile = {
        ...existing,
        capturedAt: nextCapturedAt,
        capturedAtSource: nextCapturedAtSource,
        gpsLat: nextGpsLat,
        gpsLon: nextGpsLon,
        gpsSource: nextGpsSource,
        gpsAccuracyM: nextAccuracyM,
        gpsIntervalKind: nextIntervalKind,
        gpsResolvedAt: nextResolvedAt,
        place: nextPlace,
      };
      if (outcome === 'written') {
        db.update(files).set(fileToRow(merged)).where(eq(files.fingerprint, input.fingerprint)).run();
        syncSearchDocument(db, client, input.fingerprint);
      }
      return outcome;
    });
  }

  async rebuildSearchIndex(): Promise<Result<{ indexed: number }, AppError>> {
    return this.write((db, client) => rebuildSearchIndex(db, client));
  }

  async counts(): Promise<Result<GlobalCatalogCounts, AppError>> {
    return this.read((db) => ({
      folders: db.select().from(folders).all().length,
      files: db.select().from(files).all().length,
      analyses: db.select().from(analyses).all().length,
    }));
  }

  async reconcileFolder(input: ReconcileFolderInput): Promise<Result<ReconcileFolderResult, AppError>> {
    return this.write((db) => {
      const present = new Set(input.presentFingerprints);
      const elsewhere = new Set(input.fingerprintsPresentElsewhere ?? []);
      const markMissing = input.markMissing ?? true;
      const rows = db.select().from(files).where(eq(files.folderId, input.folderId)).all();
      let marked = 0;
      let cleared = 0;
      for (const row of rows) {
        const onDisk = present.has(row.fingerprint) || elsewhere.has(row.fingerprint);
        if (onDisk) {
          if (row.missingAt !== null) {
            db.update(files).set({ missingAt: null }).where(eq(files.fingerprint, row.fingerprint)).run();
            cleared += 1;
          }
        } else if (markMissing && row.missingAt === null) {
          db.update(files).set({ missingAt: input.now }).where(eq(files.fingerprint, row.fingerprint)).run();
          marked += 1;
        }
      }
      return { marked, cleared };
    });
  }

  async relocateFile(fingerprint: string, folderId: string, fileName: string): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      const row = db.select().from(files).where(eq(files.fingerprint, fingerprint)).get();
      if (row === undefined) return;
      db.update(files).set({ folderId, fileName }).where(eq(files.fingerprint, fingerprint)).run();
      syncSearchDocument(db, client, fingerprint);
    });
  }

  async forgetEntry(fingerprint: string): Promise<Result<ForgetEntryResult, AppError>> {
    return this.write((db, client) => {
      const fileRow = db.select().from(files).where(eq(files.fingerprint, fingerprint)).get();
      if (fileRow === undefined) return { fingerprint, deleted: false, folderId: null, cropPaths: [] };
      const observationRows = db.select().from(faceObservations).where(eq(faceObservations.fingerprint, fingerprint)).all();
      const cropPaths = observationRows.map((row) => row.cropPath).filter((value): value is string => typeof value === 'string' && value.length > 0);
      const affectedPersonIds = affectedPersonIdsOf(observationRows);
      deleteSearchDocument(client, fingerprint);
      db.delete(faceObservations).where(eq(faceObservations.fingerprint, fingerprint)).run();
      db.delete(faceIndexState).where(eq(faceIndexState.fingerprint, fingerprint)).run();
      db.delete(fileTags).where(eq(fileTags.fingerprint, fingerprint)).run();
      db.delete(analyses).where(eq(analyses.fingerprint, fingerprint)).run();
      db.delete(files).where(eq(files.fingerprint, fingerprint)).run();
      recomputeAffectedPersons(db, affectedPersonIds);
      return { fingerprint, deleted: true, folderId: fileRow.folderId, cropPaths };
    });
  }

  async startDriveRun(run: DriveRunRecord): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(driveRuns).values(driveRunToRow(run)).run();
    });
  }

  async updateDriveRun(run: DriveRunRecord): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(driveRuns)
        .values(driveRunToRow(run))
        .onConflictDoUpdate({
          target: driveRuns.runId,
          set: {
            root: run.root,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            foldersTotal: run.foldersTotal,
            foldersDone: run.foldersDone,
            filesDone: run.filesDone,
            filesSkipped: run.filesSkipped,
            filesFailed: run.filesFailed,
            lastActivityAt: run.lastActivityAt,
            batchJson: run.batch === null ? null : JSON.stringify(run.batch),
          },
        })
        .run();
    });
  }

  async latestDriveRun(): Promise<Result<DriveRunRecord | null, AppError>> {
    return this.read((db) => {
      const rows = db.select().from(driveRuns).all();
      const latest = rows.sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
      return latest === undefined ? null : rowToDriveRun(latest);
    });
  }

  async unfinishedDriveRuns(root: string): Promise<Result<DriveRunRecord[], AppError>> {
    return this.read((db) => db.select().from(driveRuns).all()
      .filter((row) => row.root === root && row.finishedAt === null)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map(rowToDriveRun));
  }

  async listFaceIndexCandidates(rootPath: string): Promise<Result<FaceIndexScope, AppError>> {
    return this.read((db) => {
      const canonicalRoot = canonicalPath(rootPath);
      const candidates: FaceIndexCandidate[] = [];
      const folderRows = db.select().from(folders).all()
        .filter((folder) => folder.currentPath === canonicalRoot
          || folder.currentPath.startsWith(`${canonicalRoot}${path.sep}`));
      let filesInScope = 0;
      for (const folderRow of folderRows) {
        const fileRows = db.select().from(files).where(eq(files.folderId, folderRow.folderId)).all();
        for (const fileRow of fileRows) {
          const analysisRow = selectedAnalysisRow(db, fileRow.fingerprint);
          if (analysisRow === undefined) continue;
          filesInScope += 1;
          const stateRow = db.select().from(faceIndexState).where(eq(faceIndexState.fingerprint, fileRow.fingerprint)).get();
          if (stateRow !== undefined && stateRow.engineVersion >= FACE_ENGINE_VERSION) continue;
          candidates.push({
            file: rowToFile(fileRow),
            analysis: rowToAnalysis(analysisRow, tagsForVariant(db, fileRow.fingerprint, analysisRow.configId)),
            folder: rowToFolder(folderRow),
            previousEngineVersion: stateRow?.engineVersion ?? null,
          });
        }
      }
      return {
        foldersMatched: folderRows.length,
        filesInScope,
        candidates: candidates.sort((left, right) => left.folder.currentPath.localeCompare(right.folder.currentPath)
          || left.file.fileName.localeCompare(right.file.fileName)),
      };
    });
  }

  async completeFaceIndex(fingerprint: string, engineVersion: number): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(faceIndexState)
        .values({ fingerprint, completedAt: new Date().toISOString(), engineVersion })
        .onConflictDoUpdate({
          target: faceIndexState.fingerprint,
          set: { completedAt: new Date().toISOString(), engineVersion },
        })
        .run();
    });
  }

  async deleteFaceObservationsForFile(fingerprint: string): Promise<Result<{ cropPaths: string[] }, AppError>> {
    return this.write((db, client) => {
      const observationRows = db.select().from(faceObservations).where(eq(faceObservations.fingerprint, fingerprint)).all();
      const cropPaths = observationRows.map((row) => row.cropPath).filter((value): value is string => typeof value === 'string' && value.length > 0);
      const affectedPersonIds = affectedPersonIdsOf(observationRows);
      db.delete(faceObservations).where(eq(faceObservations.fingerprint, fingerprint)).run();
      recomputeAffectedPersons(db, affectedPersonIds);
      syncSearchDocument(db, client, fingerprint);
      return { cropPaths };
    });
  }

  async listUnassignedFaceObservations(): Promise<Result<FaceObservation[], AppError>> {
    return this.read((db) =>
      db.select().from(faceObservations).all()
        .map(rowToFaceObservation)
        .filter((observation) => observation.personId === null));
  }

  async listPeople(): Promise<Result<Person[], AppError>> {
    return this.read((db) => db.select().from(people).all().map(rowToPerson));
  }

  async getPerson(personId: string): Promise<Result<Person | null, AppError>> {
    return this.read((db) => {
      const row = db.select().from(people).where(eq(people.personId, personId)).get();
      return row === undefined ? null : rowToPerson(row);
    });
  }

  async upsertPerson(person: Person): Promise<Result<void, AppError>> {
    return this.write((db) => {
      db.insert(people)
        .values(personToRow(person))
        .onConflictDoUpdate({
          target: people.personId,
          set: {
            displayName: person.displayName,
            kind: person.kind,
            centroid: embeddingToBlob(person.centroid),
            exemplarCount: person.exemplarCount,
          },
        })
        .run();
    });
  }

  async setPersonName(personId: string, displayName: string): Promise<Result<{ personId: string; displayName: string; affectedFingerprints: string[] }, AppError>> {
    return this.write((db, client) => {
      const existing = db.select().from(people).where(eq(people.personId, personId)).get();
      if (existing === undefined) throw new CatalogAppError(appError('not_found', `Person not found: ${personId}`));
      db.update(people).set({ displayName }).where(eq(people.personId, personId)).run();
      const affectedFingerprints = uniqueFingerprints(db.select().from(faceObservations).where(eq(faceObservations.personId, personId)).all());
      for (const fingerprint of affectedFingerprints) syncSearchDocument(db, client, fingerprint);
      return { personId, displayName, affectedFingerprints };
    });
  }

  async listFaceObservations(input: { fingerprint?: string | undefined; personId?: string | undefined } = {}): Promise<Result<FaceObservation[], AppError>> {
    return this.read((db) => {
      if (input.fingerprint !== undefined) {
        return db.select().from(faceObservations).where(eq(faceObservations.fingerprint, input.fingerprint)).all().map(rowToFaceObservation);
      }
      if (input.personId !== undefined) {
        return db.select().from(faceObservations).where(eq(faceObservations.personId, input.personId)).all().map(rowToFaceObservation);
      }
      return db.select().from(faceObservations).all().map(rowToFaceObservation);
    });
  }

  async upsertFaceObservation(observation: FaceObservation): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      db.insert(faceObservations)
        .values(faceObservationToRow(observation))
        .onConflictDoUpdate({
          target: faceObservations.obsId,
          set: {
            fingerprint: observation.fingerprint,
            kind: observation.kind,
            frameTsS: observation.frameTsS,
            bboxJson: JSON.stringify(observation.bbox),
            embedding: embeddingToBlob(observation.embedding),
            quality: observation.quality,
            personId: observation.personId,
            cropPath: observation.cropPath,
          },
        })
        .run();
      syncSearchDocument(db, client, observation.fingerprint);
    });
  }

  async assignFaceObservation(obsId: string, personId: string | null): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
      const observation = db.select().from(faceObservations).where(eq(faceObservations.obsId, obsId)).get();
      if (observation === undefined) throw new CatalogAppError(appError('not_found', `Face observation not found: ${obsId}`));
      db.update(faceObservations).set({ personId }).where(eq(faceObservations.obsId, obsId)).run();
      syncSearchDocument(db, client, observation.fingerprint);
    });
  }

  async mergePeople(input: { fromPersonId: string; toPersonId: string }): Promise<Result<{ fromPersonId: string; toPersonId: string; movedObservations: number; affectedFingerprints: string[] }, AppError>> {
    return this.write((db, client) => {
      const from = db.select().from(people).where(eq(people.personId, input.fromPersonId)).get();
      const to = db.select().from(people).where(eq(people.personId, input.toPersonId)).get();
      if (from === undefined || to === undefined) throw new CatalogAppError(appError('not_found', 'Person not found'));
      const rows = db.select().from(faceObservations).where(eq(faceObservations.personId, input.fromPersonId)).all();
      const affectedFingerprints = uniqueFingerprints(rows);
      db.update(faceObservations).set({ personId: input.toPersonId }).where(eq(faceObservations.personId, input.fromPersonId)).run();
      const embeddings = db.select().from(faceObservations).where(eq(faceObservations.personId, input.toPersonId)).all()
        .map((row) => rowToFaceObservation(row).embedding);
      const centroid = centroidFor(embeddings);
      db.update(people).set({
        centroid: embeddingToBlob(centroid),
        exemplarCount: embeddings.length,
      }).where(eq(people.personId, input.toPersonId)).run();
      db.delete(people).where(eq(people.personId, input.fromPersonId)).run();
      for (const fingerprint of affectedFingerprints) syncSearchDocument(db, client, fingerprint);
      return {
        fromPersonId: input.fromPersonId,
        toPersonId: input.toPersonId,
        movedObservations: rows.length,
        affectedFingerprints,
      };
    });
  }

  async forgetPerson(personId: string): Promise<Result<{ personId: string; deleted: boolean; cropPaths: string[]; affectedFingerprints: string[] }, AppError>> {
    return this.write((db, client) => {
      const existing = db.select().from(people).where(eq(people.personId, personId)).get();
      if (existing === undefined) return { personId, deleted: false, cropPaths: [], affectedFingerprints: [] };
      const rows = db.select().from(faceObservations).where(eq(faceObservations.personId, personId)).all();
      const cropPaths = rows.map((row) => row.cropPath).filter((value): value is string => typeof value === 'string' && value.length > 0);
      const affectedFingerprints = uniqueFingerprints(rows);
      db.delete(faceObservations).where(eq(faceObservations.personId, personId)).run();
      db.delete(people).where(eq(people.personId, personId)).run();
      for (const fingerprint of affectedFingerprints) syncSearchDocument(db, client, fingerprint);
      return { personId, deleted: true, cropPaths, affectedFingerprints };
    });
  }

  async purgeFaces(): Promise<Result<{ peopleDeleted: number; observationsDeleted: number; cropPaths: string[] }, AppError>> {
    return this.write((db, client) => {
      const observationRows = db.select().from(faceObservations).all();
      const peopleRows = db.select().from(people).all();
      const cropPaths = observationRows.map((row) => row.cropPath).filter((value): value is string => typeof value === 'string' && value.length > 0);
      const affectedFingerprints = uniqueFingerprints(observationRows);
      db.delete(faceObservations).run();
      db.delete(people).run();
      for (const fingerprint of affectedFingerprints) syncSearchDocument(db, client, fingerprint);
      return { peopleDeleted: peopleRows.length, observationsDeleted: observationRows.length, cropPaths };
    });
  }

  async faceStatus(): Promise<Result<FaceStatusCounts, AppError>> {
    return this.read((db) => {
      const observationRows = db.select().from(faceObservations).all();
      const stateRows = db.select().from(faceIndexState).all();
      return {
        people: db.select().from(people).all().length,
        observations: observationRows.length,
        assignedObservations: observationRows.filter((row) => row.personId !== null).length,
        unassignedObservations: observationRows.filter((row) => row.personId === null).length,
        filesIndexed: new Set(observationRows.map((row) => row.fingerprint)).size,
        staleVersionFiles: stateRows.filter((row) => row.engineVersion < FACE_ENGINE_VERSION).length,
      };
    });
  }

  async replaceFaceClustering(input: {
    people: readonly Person[];
    assignments: readonly { obsId: string; personId: string | null }[];
  }): Promise<Result<{
    personsDeleted: number;
    personsCreated: number;
    observationsReassigned: number;
    affectedFingerprints: string[];
  }, AppError>> {
    return this.write((db, client) => {
      const beforeObservations = new Map(
        db.select().from(faceObservations).all().map((row) => [row.obsId, row.personId]),
      );
      const personsDeleted = db.select().from(people).all().length;
      db.delete(people).run();
      for (const person of input.people) db.insert(people).values(personToRow(person)).run();

      let observationsReassigned = 0;
      const affected = new Set<string>();
      for (const assignment of input.assignments) {
        const row = db.select().from(faceObservations).where(eq(faceObservations.obsId, assignment.obsId)).get();
        if (row === undefined) continue;
        if (beforeObservations.get(assignment.obsId) !== assignment.personId) {
          observationsReassigned += 1;
          affected.add(row.fingerprint);
        }
        db.update(faceObservations).set({ personId: assignment.personId }).where(eq(faceObservations.obsId, assignment.obsId)).run();
      }
      for (const fingerprint of affected) syncSearchDocument(db, client, fingerprint);
      return {
        personsDeleted,
        personsCreated: input.people.length,
        observationsReassigned,
        affectedFingerprints: [...affected],
      };
    });
  }

  private async read<T>(operation: (db: GlobalDrizzle, client: Database) => T): Promise<Result<T, AppError>> {
    try {
      const state = await this.ensureOpen(this.lockMode === 'none');
      return ok(operation(state.db, state.client));
    } catch (cause) {
      return failure(cause);
    }
  }

  private async write<T>(operation: (db: GlobalDrizzle, client: Database) => T): Promise<Result<T, AppError>> {
    try {
      this.lock.takeWriteLock();
      const state = await this.ensureOpen(true);
      const value = operation(state.db, state.client);
      this.dirtyCount += 1;
      if (this.dirtyCount >= AUTO_FLUSH_MUTATION_COUNT) this.persist(state);
      return ok(value);
    } catch (cause) {
      if (!(cause instanceof CatalogAppError)) {
        this.state = null;
        this.dirtyCount = 0;
      }
      return failure(cause);
    }
  }

  private persist(state: NonNullable<SqlJsGlobalCatalogStore['state']>): void {
    persistDatabase(this.filePath, state.client);
    state.fileState = fileStateOf(this.filePath);
    this.dirtyCount = 0;
  }

  private async ensureOpen(canPersist: boolean): Promise<NonNullable<SqlJsGlobalCatalogStore['state']>> {
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
      db: drizzle(client, { schema: globalCatalogSchema }),
      fileState: fileStateOf(this.filePath),
    };
    return this.state;
  }
}

const migrate = (client: Database): boolean => {
  client.run('CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER PRIMARY KEY)');
  const currentVersion = readSchemaVersion(client);
  if (currentVersion > GLOBAL_CATALOG_SCHEMA_VERSION) {
    throw new CatalogAppError(appError(
      'snapshot_incompatible',
      `Global catalog schema version ${String(currentVersion)} is newer than the supported version ${String(GLOBAL_CATALOG_SCHEMA_VERSION)}`,
    ));
  }
  let migrated = false;
  if (currentVersion < 1) {
    for (const statement of createGlobalCatalogSchemaSqlV1) client.run(statement);
    migrated = true;
  }
  if (currentVersion < 2) {
    for (const statement of migrateGlobalCatalogSchemaSqlV2) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 3) {
    for (const statement of migrateGlobalCatalogSchemaSqlV3) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 4) {
    for (const statement of migrateGlobalCatalogSchemaSqlV4) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 5) {
    for (const statement of migrateGlobalCatalogSchemaSqlV5) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 6) {
    for (const statement of migrateGlobalCatalogSchemaSqlV6) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 7) {
    for (const statement of migrateGlobalCatalogSchemaSqlV7) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 8) {
    for (const statement of migrateGlobalCatalogSchemaSqlV8) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 9) {
    runV9Migration(client);
    migrated = true;
  }
  if (currentVersion < 10) {
    for (const statement of migrateGlobalCatalogSchemaSqlV10) runMigrationStatement(client, statement);
    rebuildSearchIndex(drizzle(client, { schema: globalCatalogSchema }), client);
    migrated = true;
  }
  if (currentVersion < 11) {
    for (const statement of migrateGlobalCatalogSchemaSqlV11) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 12) {
    for (const statement of migrateGlobalCatalogSchemaSqlV12) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 13) {
    for (const statement of migrateGlobalCatalogSchemaSqlV13) runMigrationStatement(client, statement);
    migrated = true;
  }
  if (currentVersion < 14) {
    for (const statement of migrateGlobalCatalogSchemaSqlV14) runMigrationStatement(client, statement);
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

const runV9Migration = (client: Database): void => {
  client.run('BEGIN IMMEDIATE TRANSACTION');
  try {
    client.run('PRAGMA defer_foreign_keys = ON');
    for (const statement of migrateGlobalCatalogSchemaSqlV9) client.run(statement);
    client.run('COMMIT');
  } catch (cause) {
    client.run('ROLLBACK');
    throw cause;
  }
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
  currentPath: canonicalPath(row.currentPath),
  displayName: row.displayName,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
});

const folderToRow = (folder: CatalogFolder): typeof folders.$inferInsert => ({
  folderId: folder.folderId,
  currentPath: canonicalPath(folder.currentPath),
  displayName: folder.displayName,
  firstSeenAt: folder.firstSeenAt,
  lastSeenAt: folder.lastSeenAt,
});

const rowToFile = (row: typeof files.$inferSelect): CatalogFile => ({
  fingerprint: row.fingerprint,
  folderId: row.folderId,
  fileName: canonicalPath(row.fileName),
  size: row.size,
  durationS: row.durationS,
  width: row.width,
  height: row.height,
  gpsLat: row.gpsLat,
  gpsLon: row.gpsLon,
  processedAt: row.processedAt,
  analyzer: row.analyzer,
  model: row.model,
  missingAt: row.missingAt,
  capturedAt: row.capturedAt,
  capturedAtSource: row.capturedAtSource === 'container' || row.capturedAtSource === 'manual' ? row.capturedAtSource : null,
  gpsSource: parseGpsSource(row.gpsSource),
  gpsAccuracyM: row.gpsAccuracyM,
  gpsIntervalKind: parseIntervalKind(row.gpsIntervalKind),
  gpsResolvedAt: row.gpsResolvedAt,
  place: row.placeName === null ? null : {
    name: row.placeName,
    region: row.placeRegion,
    country: row.placeCountry,
    countryCode: row.placeCountryCode,
    distanceM: row.placeDistanceM ?? 0,
    dataset: row.placeDataset ?? '',
  },
});

const parseGpsSource = (value: string | null): GpsSource | null =>
  value === 'camera' || value === 'timeline' || value === 'manual' ? value : null;

const parseIntervalKind = (value: string | null): TimelineIntervalKind | null =>
  value === 'visit' || value === 'activity' || value === 'path' ? value : null;

const fileToRow = (file: CatalogFile): typeof files.$inferInsert => ({
  fingerprint: file.fingerprint,
  folderId: file.folderId,
  fileName: canonicalPath(file.fileName),
  size: file.size,
  durationS: file.durationS,
  width: file.width,
  height: file.height,
  gpsLat: file.gpsLat,
  gpsLon: file.gpsLon,
  processedAt: file.processedAt,
  analyzer: file.analyzer,
  model: file.model,
  missingAt: file.missingAt,
  capturedAt: file.capturedAt,
  capturedAtSource: file.capturedAtSource,
  gpsSource: file.gpsSource,
  gpsAccuracyM: file.gpsAccuracyM,
  gpsIntervalKind: file.gpsIntervalKind,
  gpsResolvedAt: file.gpsResolvedAt,
  placeName: file.place?.name ?? null,
  placeRegion: file.place?.region ?? null,
  placeCountry: file.place?.country ?? null,
  placeCountryCode: file.place?.countryCode ?? null,
  placeDistanceM: file.place?.distanceM ?? null,
  placeDataset: file.place?.dataset ?? null,
});

const rowToAnalysis = (row: typeof analyses.$inferSelect, analysisTags: string[]): CatalogAnalysis => {
  const variant = rowToVariant(row, analysisTags);
  return {
    fingerprint: variant.fingerprint,
    finalName: variant.finalName,
    description: variant.description,
    transcript: variant.transcript,
    language: variant.language,
    tags: variant.tags,
  };
};

const rowToVariant = (row: typeof analyses.$inferSelect, analysisTags: string[]): CatalogVariant =>
  catalogVariantSchema.parse({
    fingerprint: row.fingerprint,
    configId: row.configId,
    finalName: row.finalName === null ? null : canonicalPath(row.finalName),
    description: row.description,
    transcript: row.transcript,
    language: row.language,
    tags: analysisTags,
    descriptor: parseStoredJson(row.configJson, configDescriptorSchema),
    analyzer: row.analyzer,
    model: row.model,
    createdAt: row.createdAt,
    usage: parseStoredJson(row.usageJson, catalogVariantSchema.shape.usage),
    resolvedOutputLanguage: row.resolvedOutputLanguage,
    resolvedTagLanguage: row.resolvedTagLanguage,
  });

const variantToRow = (variant: CatalogVariant): typeof analyses.$inferInsert => ({
  fingerprint: variant.fingerprint,
  configId: variant.configId,
  finalName: variant.finalName === null ? null : canonicalPath(variant.finalName),
  description: variant.description,
  transcript: variant.transcript,
  language: variant.language,
  configJson: variant.descriptor === null ? null : JSON.stringify(variant.descriptor),
  analyzer: variant.analyzer,
  model: variant.model,
  createdAt: variant.createdAt,
  usageJson: variant.usage === null ? null : JSON.stringify(variant.usage),
});

const parseStoredJson = <T>(value: string | null, schema: z.ZodType<T>): T | null => {
  if (value === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch (cause) {
    throw new CatalogAppError(appError('read_error', 'Stored JSON is not valid', cause));
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new CatalogAppError(appError('read_error', 'Stored JSON does not match the expected shape', parsed.error.flatten()));
  }
  return parsed.data;
};

const upsertAnalysisConfig = (db: GlobalDrizzle, variant: CatalogVariant): void => {
  const descriptorJson = variant.descriptor === null ? null : JSON.stringify(variant.descriptor);
  const label = variant.configId === LEGACY_CONFIG_ID
    ? 'settings partly unknown'
    : [variant.analyzer, variant.model].filter((value) => value !== null && value.length > 0).join(' / ') || variant.configId;
  db.insert(analysisConfigs)
    .values({
      configId: variant.configId,
      descriptorJson,
      label,
      firstSeenAt: variant.createdAt,
      lastUsedAt: variant.createdAt,
    })
    .onConflictDoUpdate({
      target: analysisConfigs.configId,
      set: { descriptorJson, label, lastUsedAt: variant.createdAt },
    })
    .run();
};

const rowToPerson = (row: typeof people.$inferSelect): Person => ({
  personId: row.personId,
  displayName: row.displayName,
  kind: 'face',
  createdAt: row.createdAt,
  centroid: blobToEmbedding(row.centroid),
  exemplarCount: row.exemplarCount,
});

const personToRow = (person: Person): typeof people.$inferInsert => ({
  personId: person.personId,
  displayName: person.displayName,
  kind: person.kind,
  createdAt: person.createdAt,
  centroid: embeddingToBlob(person.centroid),
  exemplarCount: person.exemplarCount,
});

const rowToFaceObservation = (row: typeof faceObservations.$inferSelect): FaceObservation => ({
  obsId: row.obsId,
  fingerprint: row.fingerprint,
  kind: 'face',
  frameTsS: row.frameTsS ?? 0,
  bbox: parseBbox(row.bboxJson),
  embedding: blobToEmbedding(row.embedding),
  quality: row.quality ?? 0,
  personId: row.personId,
  cropPath: row.cropPath,
  media: row.media === 'photo' ? 'photo' : 'video',
});

const faceObservationToRow = (observation: FaceObservation): typeof faceObservations.$inferInsert => ({
  obsId: observation.obsId,
  fingerprint: observation.fingerprint,
  kind: observation.kind,
  frameTsS: observation.media === 'photo' ? null : observation.frameTsS,
  bboxJson: JSON.stringify(observation.bbox),
  embedding: embeddingToBlob(observation.embedding),
  quality: observation.quality,
  personId: observation.personId,
  cropPath: observation.cropPath,
  media: observation.media,
});

const parseBbox = (value: string | null): FaceObservation['bbox'] => {
  if (value === null) return { x: 0, y: 0, width: 1, height: 1 };
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'x' in parsed
      && 'y' in parsed
      && 'width' in parsed
      && 'height' in parsed
      && typeof parsed.x === 'number'
      && typeof parsed.y === 'number'
      && typeof parsed.width === 'number'
      && typeof parsed.height === 'number'
    ) {
      return { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height };
    }
  } catch {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  return { x: 0, y: 0, width: 1, height: 1 };
};

const embeddingToBlob = (embedding: readonly number[]): Buffer => {
  const array = new Float32Array(embedding);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
};

const blobToEmbedding = (value: unknown): number[] => {
  if (!(value instanceof Uint8Array)) return Array.from({ length: 128 }, () => 0);
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const floats = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return [...floats];
};

const rowToDriveRun = (row: typeof driveRuns.$inferSelect): DriveRunRecord => ({
  batch: parseDriveRunBatchState(row.batchJson ?? null),
  runId: row.runId,
  root: row.root,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
  foldersTotal: row.foldersTotal,
  foldersDone: row.foldersDone,
  filesDone: row.filesDone,
  filesSkipped: row.filesSkipped,
  filesFailed: row.filesFailed,
  lastActivityAt: row.lastActivityAt,
});

const driveRunToRow = (run: DriveRunRecord): typeof driveRuns.$inferInsert => ({
  batchJson: run.batch === null ? null : JSON.stringify(run.batch),
  runId: run.runId,
  root: run.root,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  foldersTotal: run.foldersTotal,
  foldersDone: run.foldersDone,
  filesDone: run.filesDone,
  filesSkipped: run.filesSkipped,
  filesFailed: run.filesFailed,
  lastActivityAt: run.lastActivityAt,
});

const compareVariantIdentity = (
  left: { createdAt: string; configId: string },
  right: { createdAt: string; configId: string },
): number => right.createdAt.localeCompare(left.createdAt) || left.configId.localeCompare(right.configId);

const compareVariants = (left: CatalogVariant, right: CatalogVariant): number =>
  compareVariantIdentity(left, right);

const resolveSelectedAnalysis = (
  rows: readonly (typeof analyses.$inferSelect)[],
  selectedConfigId: string | null,
  defaultConfigId: string | null,
): (typeof analyses.$inferSelect) | undefined => {
  const explicit = rows.find((row) => row.configId === selectedConfigId);
  if (explicit !== undefined) return explicit;
  const folderDefault = rows.find((row) => row.configId === defaultConfigId);
  if (folderDefault !== undefined) return folderDefault;
  return [...rows].sort(compareVariantIdentity)[0];
};

const selectedAnalysisRow = (
  db: GlobalDrizzle,
  fingerprint: string,
): (typeof analyses.$inferSelect) | undefined => {
  const fileRow = db.select().from(files).where(eq(files.fingerprint, fingerprint)).get();
  if (fileRow === undefined) return undefined;
  const folderRow = db.select().from(folders).where(eq(folders.folderId, fileRow.folderId)).get();
  const rows = db.select().from(analyses).where(eq(analyses.fingerprint, fingerprint)).all();
  return resolveSelectedAnalysis(rows, fileRow.selectedConfigId, folderRow?.defaultConfigId ?? null);
};

const groupAnalysisRows = (
  rows: readonly (typeof analyses.$inferSelect)[],
): Map<string, (typeof analyses.$inferSelect)[]> => {
  const grouped = new Map<string, (typeof analyses.$inferSelect)[]>();
  for (const row of rows) {
    const existing = grouped.get(row.fingerprint);
    if (existing === undefined) grouped.set(row.fingerprint, [row]);
    else existing.push(row);
  }
  return grouped;
};

const variantKey = (fingerprint: string, configIdValue: string): string =>
  `${fingerprint}\u0000${configIdValue}`;

const setVariantTags = (
  db: GlobalDrizzle,
  fingerprint: string,
  configIdValue: string,
  values: readonly string[],
): void => {
  db.delete(fileTags)
    .where(and(eq(fileTags.fingerprint, fingerprint), eq(fileTags.configId, configIdValue)))
    .run();
  for (const name of normalizeTagList(values)) {
    const tag = resolveCanonicalTag(db, name);
    db.insert(fileTags)
      .values({ fingerprint, configId: configIdValue, tagId: tag.tagId })
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

const tagsForVariant = (db: GlobalDrizzle, fingerprint: string, configIdValue: string): string[] => {
  const rows = db.select().from(fileTags)
    .where(and(eq(fileTags.fingerprint, fingerprint), eq(fileTags.configId, configIdValue)))
    .all();
  const names: string[] = [];
  for (const row of rows) {
    const tag = db.select().from(tags).where(eq(tags.tagId, row.tagId)).get();
    if (tag !== undefined) names.push(tag.name);
  }
  return names.sort((left, right) => left.localeCompare(right));
};

const groupVariantTagNames = (
  rows: readonly { fingerprint: string; configId: string; name: string }[],
): Map<string, string[]> => {
  const byVariant = new Map<string, string[]>();
  for (const row of rows) {
    const key = variantKey(row.fingerprint, row.configId);
    const names = byVariant.get(key);
    if (names === undefined) byVariant.set(key, [row.name]);
    else names.push(row.name);
  }
  for (const names of byVariant.values()) names.sort((left, right) => left.localeCompare(right));
  return byVariant;
};

const faceNamesForFingerprint = (db: GlobalDrizzle, fingerprint: string): string[] => {
  const observationRows = db.select().from(faceObservations).where(eq(faceObservations.fingerprint, fingerprint)).all();
  const names = new Set<string>();
  for (const observation of observationRows) {
    if (observation.personId === null) continue;
    const person = db.select().from(people).where(eq(people.personId, observation.personId)).get();
    if (person?.displayName !== null && person?.displayName !== undefined && person.displayName.length > 0) {
      names.add(person.displayName);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
};

const syncSearchDocument = (db: GlobalDrizzle, client: Database, fingerprint: string): void => {
  const file = db.select().from(files).where(eq(files.fingerprint, fingerprint)).get();
  if (file === undefined) {
    deleteSearchDocument(client, fingerprint);
    return;
  }
  const analysis = selectedAnalysisRow(db, fingerprint);
  const document = {
    fingerprint,
    fileName: file.fileName,
    finalName: analysis?.finalName ?? '',
    description: analysis?.description ?? '',
    transcript: analysis?.transcript ?? '',
    tagsText: [
      ...(analysis === undefined ? [] : tagsForVariant(db, fingerprint, analysis.configId)),
      ...faceNamesForFingerprint(db, fingerprint),
    ].join('\n'),
    place: [file.placeName, file.placeRegion, file.placeCountry].filter((value): value is string => value !== null).join('\n'),
  };
  const existingDocid = searchDocumentId(client, fingerprint);
  if (existingDocid !== null) {
    client.run('DELETE FROM search_documents_fts WHERE docid = $docid', { $docid: existingDocid });
  }
  client.run(
    `INSERT INTO search_documents (fingerprint, file_name, final_name, description, transcript, tags_text, place)
      VALUES ($fingerprint, $fileName, $finalName, $description, $transcript, $tagsText, $place)
      ON CONFLICT(fingerprint) DO UPDATE SET
        file_name = excluded.file_name,
        final_name = excluded.final_name,
        description = excluded.description,
        transcript = excluded.transcript,
        tags_text = excluded.tags_text,
        place = excluded.place`,
    {
      $fingerprint: document.fingerprint,
      $fileName: document.fileName,
      $finalName: document.finalName,
      $description: document.description,
      $transcript: document.transcript,
      $tagsText: document.tagsText,
      $place: document.place,
    },
  );
  const docid = searchDocumentId(client, fingerprint);
  if (docid === null) throw new Error(`Could not create search document: ${fingerprint}`);
  client.run(
    `INSERT INTO search_documents_fts (docid, file_name, final_name, description, transcript, tags_text, place)
      VALUES ($docid, $fileName, $finalName, $description, $transcript, $tagsText, $place)`,
    {
      $docid: docid,
      $fileName: document.fileName,
      $finalName: document.finalName,
      $description: document.description,
      $transcript: document.transcript,
      $tagsText: document.tagsText,
      $place: document.place,
    },
  );
};

const deleteSearchDocument = (client: Database, fingerprint: string): void => {
  const docid = searchDocumentId(client, fingerprint);
  if (docid === null) return;
  client.run('DELETE FROM search_documents_fts WHERE docid = $docid', { $docid: docid });
  client.run('DELETE FROM search_documents WHERE docid = $docid', { $docid: docid });
};

const rebuildSearchIndex = (db: GlobalDrizzle, client: Database): { indexed: number } => {
  client.run('DELETE FROM search_documents_fts');
  client.run('DELETE FROM search_documents');
  const fileRows = db.select().from(files).all();
  for (const file of fileRows) syncSearchDocument(db, client, file.fingerprint);
  return { indexed: fileRows.length };
};

const runCatalogTransaction = <T>(client: Database, operation: () => T): T => {
  client.run('BEGIN TRANSACTION');
  try {
    const value = operation();
    client.run('COMMIT');
    return value;
  } catch (cause) {
    client.run('ROLLBACK');
    throw cause;
  }
};

const searchDocumentId = (client: Database, fingerprint: string): number | null => {
  const result = client.exec('SELECT docid FROM search_documents WHERE fingerprint = $fingerprint', { $fingerprint: fingerprint });
  const value = result[0]?.values[0]?.[0];
  return typeof value === 'number' ? value : null;
};

const searchRowFromValues = (row: SqlValue[], rankingTerms: readonly string[]): CatalogSearchRow => {
  const fileName = stringValue(row[2]);
  const finalName = nullableStringValue(row[3]);
  const description = nullableStringValue(row[4]);
  const snippet = stringValue(row[5]);
  const gpsLat = nullableNumberValue(row[6]);
  const gpsLon = nullableNumberValue(row[7]);
  const tagsText = stringValue(row[13]);
  const transcript = stringValue(row[14]);
  const flatPlace = stringValue(row[16]);
  return {
    fingerprint: stringValue(row[0]),
    variantCount: numberValue(row[1]),
    fileName,
    finalName,
    description,
    snippet: snippet.length > 0 ? snippet : description ?? fileName,
    tags: tagsText.split('\n').filter((tag) => tag.length > 0),
    folder: {
      folderId: stringValue(row[8]),
      currentPath: canonicalPath(stringValue(row[9])),
      displayName: stringValue(row[10]),
      firstSeenAt: stringValue(row[11]),
      lastSeenAt: stringValue(row[12]),
    },
    gps: gpsLat === null || gpsLon === null ? null : { lat: gpsLat, lon: gpsLon },
    missing: nullableNumberValue(row[15]) !== null,
    score: weightedSearchScore({
      fileName,
      finalName: finalName ?? '',
      description: description ?? '',
      tagsText,
      transcript,
      place: flatPlace,
    }, rankingTerms),
    capturedAt: nullableStringValue(row[17]),
    place: searchPlaceFromValues(row),
    width: nullableNumberValue(row[24]),
    height: nullableNumberValue(row[25]),
  };
};

const searchPlaceFromValues = (row: SqlValue[]): CatalogPlace | null => {
  const name = nullableStringValue(row[18]);
  if (name === null) return null;
  return {
    name,
    region: nullableStringValue(row[19]),
    country: nullableStringValue(row[20]),
    countryCode: nullableStringValue(row[21]),
    distanceM: nullableNumberValue(row[22]) ?? 0,
    dataset: nullableStringValue(row[23]) ?? '',
  };
};

const SELECTED_ANALYSIS_CONFIG_ID_SQL = `COALESCE(
              (SELECT config_id FROM analyses WHERE fingerprint = f.fingerprint AND config_id = f.selected_config_id),
              (SELECT config_id FROM analyses WHERE fingerprint = f.fingerprint AND config_id = fo.default_config_id),
              (SELECT config_id FROM analyses WHERE fingerprint = f.fingerprint ORDER BY created_at DESC, config_id ASC LIMIT 1))`;

const SEARCH_ROW_COLUMNS = `
  f.fingerprint,
  (SELECT COUNT(*) FROM analyses av WHERE av.fingerprint = f.fingerprint),
  f.file_name,
  NULLIF(sd.final_name, ''),
  NULLIF(sd.description, ''),
  __SNIPPET__,
  f.gps_lat,
  f.gps_lon,
  fo.folder_id,
  fo.current_path,
  fo.display_name,
  fo.first_seen_at,
  fo.last_seen_at,
  sd.tags_text,
  sd.transcript,
  f.missing_at,
  sd.place,
  f.captured_at,
  f.place_name,
  f.place_region,
  f.place_country,
  f.place_country_code,
  f.place_distance_m,
  f.place_dataset,
  f.width,
  f.height
`;

const SEARCH_COLUMNS_MATCHED = SEARCH_ROW_COLUMNS.replace(
  '__SNIPPET__',
  `snippet(search_documents_fts, '<mark>', '</mark>', ' ... ', -1, 12)`,
);

const SEARCH_COLUMNS_UNMATCHED = SEARCH_ROW_COLUMNS.replace('__SNIPPET__', `''`);

interface SearchWhereClause {
  sql: string;
  params: Record<string, SqlValue>;
}

const buildSearchFilterClauses = (filters: CatalogSearchFilters): SearchWhereClause[] => {
  const clauses: SearchWhereClause[] = [];

  filters.tagTermSets.forEach((termSet, setIndex) => {
    if (termSet.length === 0) return;
    const placeholders = termSet.map((_, termIndex) => `$tagSet${String(setIndex)}_${String(termIndex)}`);
    const params: Record<string, SqlValue> = {};
    termSet.forEach((term, termIndex) => {
      params[`$tagSet${String(setIndex)}_${String(termIndex)}`] = term;
    });
    const list = placeholders.join(', ');
    clauses.push({
      sql: `EXISTS (
          SELECT 1 FROM file_tags ft
          WHERE ft.fingerprint = f.fingerprint
            AND ft.config_id = ${SELECTED_ANALYSIS_CONFIG_ID_SQL}
            AND ft.tag_id IN (
              SELECT tag_id FROM tags WHERE name IN (${list})
              UNION SELECT tag_id FROM tag_aliases WHERE alias IN (${list})))`,
      params,
    });
  });

  if (filters.personIds.length > 0) {
    const placeholders = filters.personIds.map((_, index) => `$person${String(index)}`);
    const params: Record<string, SqlValue> = {};
    filters.personIds.forEach((personId, index) => {
      params[`$person${String(index)}`] = personId;
    });
    clauses.push({
      sql: `EXISTS (SELECT 1 FROM face_observations o WHERE o.fingerprint = f.fingerprint AND o.person_id IN (${placeholders.join(', ')}))`,
      params,
    });
  }

  if (filters.place !== null) {
    clauses.push({
      sql: `(f.place_name LIKE $place COLLATE NOCASE OR f.place_region LIKE $place COLLATE NOCASE OR f.place_country LIKE $place COLLATE NOCASE)`,
      params: { $place: `%${filters.place}%` },
    });
  }

  if (filters.capturedFrom !== null) {
    clauses.push({
      sql: `f.captured_at IS NOT NULL AND f.captured_at >= $capturedFrom`,
      params: { $capturedFrom: filters.capturedFrom },
    });
  }

  if (filters.capturedTo !== null) {
    clauses.push({
      sql: `f.captured_at IS NOT NULL AND f.captured_at <= $capturedTo`,
      params: { $capturedTo: filters.capturedTo },
    });
  }

  if (filters.hasGps === true) {
    clauses.push({ sql: `f.gps_lat IS NOT NULL AND f.gps_lon IS NOT NULL`, params: {} });
  } else if (filters.hasGps === false) {
    clauses.push({ sql: `f.gps_lat IS NULL`, params: {} });
  }

  if (filters.folderId !== null) {
    clauses.push({ sql: `fo.folder_id = $folderId`, params: { $folderId: filters.folderId } });
  }

  return clauses;
};

const combineSearchWhere = (base: string | null, clauses: readonly SearchWhereClause[]): SearchWhereClause => {
  const conditions = [...(base === null ? [] : [base]), ...clauses.map((clause) => `(${clause.sql})`)];
  const params = clauses.reduce<Record<string, SqlValue>>((accumulated, clause) => ({ ...accumulated, ...clause.params }), {});
  return { sql: conditions.length === 0 ? '1=1' : conditions.join(' AND '), params };
};

const searchOrderBySql = (sort: Exclude<CatalogSearchInput['sort'], 'relevance'>): string => {
  switch (sort) {
    case 'captured_desc':
      return `f.captured_at IS NULL, f.captured_at DESC, f.file_name ASC`;
    case 'captured_asc':
      return `f.captured_at IS NULL, f.captured_at ASC, f.file_name ASC`;
    case 'name_asc':
      return `COALESCE(NULLIF(sd.final_name, ''), f.file_name) ASC`;
  }
};

const sortSearchRows = (
  rows: readonly CatalogSearchRow[],
  sort: Exclude<CatalogSearchInput['sort'], 'relevance'>,
): CatalogSearchRow[] => {
  const displayName = (row: CatalogSearchRow): string => row.finalName !== null && row.finalName.length > 0 ? row.finalName : row.fileName;
  const sorted = [...rows];
  switch (sort) {
    case 'captured_desc':
      return sorted.sort((left, right) => capturedAtCompare(left, right, -1));
    case 'captured_asc':
      return sorted.sort((left, right) => capturedAtCompare(left, right, 1));
    case 'name_asc':
      return sorted.sort((left, right) => compareUtf8Bytes(displayName(left), displayName(right)));
  }
};

const capturedAtCompare = (left: CatalogSearchRow, right: CatalogSearchRow, direction: 1 | -1): number => {
  if (left.capturedAt === null && right.capturedAt === null) return compareUtf8Bytes(left.fileName, right.fileName);
  if (left.capturedAt === null) return 1;
  if (right.capturedAt === null) return -1;
  if (left.capturedAt === right.capturedAt) return compareUtf8Bytes(left.fileName, right.fileName);
  return left.capturedAt < right.capturedAt ? -direction : direction;
};

const locationRowFromValues = (row: SqlValue[]): CatalogLocationRow | null => {
  const lat = nullableNumberValue(row[3]);
  const lon = nullableNumberValue(row[4]);
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const placeName = nullableStringValue(row[14]);
  return {
    fingerprint: stringValue(row[0]),
    fileName: stringValue(row[1]),
    finalName: nullableStringValue(row[2]),
    lat,
    lon,
    missing: nullableNumberValue(row[5]) !== null,
    folder: {
      folderId: stringValue(row[6]),
      currentPath: stringValue(row[7]),
      displayName: stringValue(row[8]),
      firstSeenAt: stringValue(row[9]),
      lastSeenAt: stringValue(row[10]),
    },
    source: parseGpsSource(nullableStringValue(row[11])),
    accuracyM: nullableNumberValue(row[12]),
    intervalKind: parseIntervalKind(nullableStringValue(row[13])),
    place: placeName === null ? null : {
      name: placeName,
      region: nullableStringValue(row[15]),
      country: nullableStringValue(row[16]),
      countryCode: nullableStringValue(row[17]),
      distanceM: nullableNumberValue(row[18]) ?? 0,
      dataset: nullableStringValue(row[19]) ?? '',
    },
  };
};

const geoBackfillCandidateFromValues = (row: SqlValue[]): GeoBackfillCandidate => ({
  fingerprint: stringValue(row[0]),
  folderId: stringValue(row[1]),
  folderPath: stringValue(row[2]),
  fileName: stringValue(row[3]),
  capturedAt: nullableStringValue(row[4]),
  gpsLat: nullableNumberValue(row[5]),
  gpsLon: nullableNumberValue(row[6]),
  gpsSource: parseGpsSource(nullableStringValue(row[7])),
  placeName: nullableStringValue(row[8]),
});

const roundTo6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const placesEqual = (left: CatalogPlace | null, right: CatalogPlace | null): boolean => {
  if (left === null || right === null) return left === right;
  return left.name === right.name && left.region === right.region && left.country === right.country
    && left.countryCode === right.countryCode && left.dataset === right.dataset
    && Math.abs(left.distanceM - right.distanceM) < 0.5;
};

const weightedSearchScore = (
  columns: {
    fileName: string;
    finalName: string;
    description: string;
    tagsText: string;
    transcript: string;
    place: string;
  },
  rankingTerms: readonly string[],
): number => {
  let score = 0;
  for (const term of rankingTerms) {
    score += countTerm(columns.fileName, term) * 80;
    score += countTerm(columns.finalName, term) * 70;
    score += countTerm(columns.place, term) * 55;
    score += countTerm(columns.tagsText, term) * 45;
    score += countTerm(columns.description, term) * 30;
    score += countTerm(columns.transcript, term) * 5;
  }
  return score;
};

const stringValue = (value: SqlValue | undefined): string => typeof value === 'string' ? value : '';

const nullableStringValue = (value: SqlValue | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : null;
};

const nullableNumberValue = (value: SqlValue | undefined): number | null => typeof value === 'number' ? value : null;

const numberValue = (value: SqlValue | undefined): number => z.number().int().nonnegative().parse(value);

const uniqueFingerprints = (rows: readonly (typeof faceObservations.$inferSelect)[]): string[] =>
  [...new Set(rows.map((row) => row.fingerprint))].sort((left, right) => left.localeCompare(right));

const affectedPersonIdsOf = (rows: readonly (typeof faceObservations.$inferSelect)[]): string[] =>
  [...new Set(rows
    .map((row) => row.personId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0))];

const recomputeAffectedPersons = (db: GlobalDrizzle, personIds: readonly string[]): void => {
  for (const personId of personIds) {
    const remaining = db.select().from(faceObservations).where(eq(faceObservations.personId, personId)).all();
    if (remaining.length === 0) {
      db.delete(people).where(eq(people.personId, personId)).run();
      continue;
    }
    const embeddings = remaining.map((row) => rowToFaceObservation(row).embedding);
    db.update(people)
      .set({ centroid: embeddingToBlob(centroidFor(embeddings)), exemplarCount: embeddings.length })
      .where(eq(people.personId, personId))
      .run();
  }
};

const centroidFor = (embeddings: readonly (readonly number[])[]): number[] => {
  if (embeddings.length === 0) return Array.from({ length: 128 }, () => 0);
  const totals = Array.from({ length: 128 }, () => 0);
  for (const embedding of embeddings) {
    embedding.forEach((value, index) => {
      const current = totals[index];
      if (current !== undefined) totals[index] = current + value;
    });
  }
  const mean = totals.map((value) => value / embeddings.length);
  const magnitude = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return mean;
  return mean.map((value) => value / magnitude);
};

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
  const message = cause instanceof Error ? cause.message : 'Global catalog operation failed';
  return { ok: false, error: appError('internal', message, cause) };
};
