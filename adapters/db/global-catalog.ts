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
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';

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
  type FaceObservation,
  type Person,
  type Result,
} from '@core/domain/index.js';
import type {
  CatalogFileRecord,
  FaceIndexCandidate,
  FaceStatusCounts,
  CatalogSearchInput,
  CatalogSearchRow,
  CatalogTagAliasResult,
  CatalogTagSummary,
  DriveRunRecord,
  GlobalCatalogCounts,
  GlobalCatalogStore,
} from '@core/server/index.js';

import {
  analyses,
  createGlobalCatalogSchemaSqlV1,
  driveRuns,
  faceObservations,
  fileTags,
  files,
  folders,
  globalCatalogSchema,
  migrateGlobalCatalogSchemaSqlV2,
  migrateGlobalCatalogSchemaSqlV3,
  migrateGlobalCatalogSchemaSqlV4,
  migrateGlobalCatalogSchemaSqlV5,
  schemaMeta,
  tagAliases,
  tags,
  people,
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
    return this.write((db, client) => {
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
      syncSearchDocument(db, client, file.fingerprint);
    });
  }

  async getAnalysis(fingerprint: string): Promise<Result<CatalogAnalysis | null, AppError>> {
    return this.read((db) => {
      const row = db.select().from(analyses).where(eq(analyses.fingerprint, fingerprint)).get();
      return row === undefined ? null : rowToAnalysis(row, tagsForFingerprint(db, fingerprint));
    });
  }

  async upsertAnalysis(analysis: CatalogAnalysis): Promise<Result<void, AppError>> {
    return this.write((db, client) => {
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
      syncSearchDocument(db, client, analysis.fingerprint);
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
    return this.write((db, client) => {
      const canonicalTag = ensureTag(db, canonical);
      const aliasTag = db.select().from(tags).where(eq(tags.name, alias)).get();
      let remappedFiles = 0;
      const affected = new Set<string>();
      if (aliasTag !== undefined && aliasTag.tagId !== canonicalTag.tagId) {
        const rows = db.select().from(fileTags).where(eq(fileTags.tagId, aliasTag.tagId)).all();
        remappedFiles = rows.length;
        for (const row of rows) {
          affected.add(row.fingerprint);
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
      for (const fingerprint of affected) syncSearchDocument(db, client, fingerprint);
      return { alias, canonical: canonicalTag.name, remappedFiles };
    });
  }

  async search(input: CatalogSearchInput): Promise<Result<CatalogSearchRow[], AppError>> {
    return this.read((db, client) => {
      const result = client.exec(
        `SELECT
          f.fingerprint,
          f.file_name,
          a.final_name,
          a.description,
          snippet(search_documents_fts, '<mark>', '</mark>', ' ... ', -1, 12),
          f.gps_lat,
          f.gps_lon,
          fo.folder_id,
          fo.current_path,
          fo.display_name,
          fo.first_seen_at,
          fo.last_seen_at,
          sd.tags_text,
          sd.transcript
        FROM search_documents_fts
        JOIN search_documents sd ON sd.docid = search_documents_fts.docid
        JOIN files f ON f.fingerprint = sd.fingerprint
        JOIN folders fo ON fo.folder_id = f.folder_id
        LEFT JOIN analyses a ON a.fingerprint = f.fingerprint
        WHERE search_documents_fts MATCH $match`,
        { $match: input.match },
      );
      const values = result[0]?.values ?? [];
      return values
        .map((row) => searchRowFromValues(row, input.rankingTerms))
        .sort((left, right) => right.score - left.score || left.fileName.localeCompare(right.fileName))
        .slice(input.offset, input.offset + input.limit);
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

  async listFaceIndexCandidates(rootPath: string): Promise<Result<FaceIndexCandidate[], AppError>> {
    return this.read((db) => {
      const candidates: FaceIndexCandidate[] = [];
      const folderRows = db.select().from(folders).all()
        .filter((folder) => folder.currentPath === rootPath || folder.currentPath.startsWith(`${rootPath}${path.sep}`));
      for (const folderRow of folderRows) {
        const fileRows = db.select().from(files).where(eq(files.folderId, folderRow.folderId)).all();
        for (const fileRow of fileRows) {
          const analysisRow = db.select().from(analyses).where(eq(analyses.fingerprint, fileRow.fingerprint)).get();
          if (analysisRow === undefined) continue;
          const existing = db.select().from(faceObservations).where(eq(faceObservations.fingerprint, fileRow.fingerprint)).get();
          if (existing !== undefined) continue;
          candidates.push({
            file: rowToFile(fileRow),
            analysis: rowToAnalysis(analysisRow, tagsForFingerprint(db, fileRow.fingerprint)),
            folder: rowToFolder(folderRow),
          });
        }
      }
      return candidates.sort((left, right) => left.folder.currentPath.localeCompare(right.folder.currentPath)
        || left.file.fileName.localeCompare(right.file.fileName));
    });
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
      return {
        people: db.select().from(people).all().length,
        observations: observationRows.length,
        assignedObservations: observationRows.filter((row) => row.personId !== null).length,
        unassignedObservations: observationRows.filter((row) => row.personId === null).length,
        filesIndexed: new Set(observationRows.map((row) => row.fingerprint)).size,
      };
    });
  }

  private async read<T>(operation: (db: GlobalDrizzle, client: Database) => T): Promise<Result<T, AppError>> {
    try {
      const state = await this.ensureOpen();
      return ok(operation(state.db, state.client));
    } catch (cause) {
      return failure(cause);
    }
  }

  private async write<T>(operation: (db: GlobalDrizzle, client: Database) => T): Promise<Result<T, AppError>> {
    try {
      const state = await this.ensureOpen();
      const value = operation(state.db, state.client);
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
  if (currentVersion < 4) {
    rebuildSearchIndex(drizzle(client, { schema: globalCatalogSchema }), client);
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
});

const faceObservationToRow = (observation: FaceObservation): typeof faceObservations.$inferInsert => ({
  obsId: observation.obsId,
  fingerprint: observation.fingerprint,
  kind: observation.kind,
  frameTsS: observation.frameTsS,
  bboxJson: JSON.stringify(observation.bbox),
  embedding: embeddingToBlob(observation.embedding),
  quality: observation.quality,
  personId: observation.personId,
  cropPath: observation.cropPath,
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
  const analysis = db.select().from(analyses).where(eq(analyses.fingerprint, fingerprint)).get();
  const document = {
    fingerprint,
    fileName: file.fileName,
    finalName: analysis?.finalName ?? '',
    description: analysis?.description ?? '',
    transcript: analysis?.transcript ?? '',
    tagsText: [...tagsForFingerprint(db, fingerprint), ...faceNamesForFingerprint(db, fingerprint)].join('\n'),
  };
  const existingDocid = searchDocumentId(client, fingerprint);
  if (existingDocid !== null) {
    client.run('DELETE FROM search_documents_fts WHERE docid = $docid', { $docid: existingDocid });
  }
  client.run(
    `INSERT INTO search_documents (fingerprint, file_name, final_name, description, transcript, tags_text)
      VALUES ($fingerprint, $fileName, $finalName, $description, $transcript, $tagsText)
      ON CONFLICT(fingerprint) DO UPDATE SET
        file_name = excluded.file_name,
        final_name = excluded.final_name,
        description = excluded.description,
        transcript = excluded.transcript,
        tags_text = excluded.tags_text`,
    {
      $fingerprint: document.fingerprint,
      $fileName: document.fileName,
      $finalName: document.finalName,
      $description: document.description,
      $transcript: document.transcript,
      $tagsText: document.tagsText,
    },
  );
  const docid = searchDocumentId(client, fingerprint);
  if (docid === null) throw new Error(`Could not create search document: ${fingerprint}`);
  client.run(
    `INSERT INTO search_documents_fts (docid, file_name, final_name, description, transcript, tags_text)
      VALUES ($docid, $fileName, $finalName, $description, $transcript, $tagsText)`,
    {
      $docid: docid,
      $fileName: document.fileName,
      $finalName: document.finalName,
      $description: document.description,
      $transcript: document.transcript,
      $tagsText: document.tagsText,
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

const searchDocumentId = (client: Database, fingerprint: string): number | null => {
  const result = client.exec('SELECT docid FROM search_documents WHERE fingerprint = $fingerprint', { $fingerprint: fingerprint });
  const value = result[0]?.values[0]?.[0];
  return typeof value === 'number' ? value : null;
};

const searchRowFromValues = (row: SqlValue[], rankingTerms: readonly string[]): CatalogSearchRow => {
  const fileName = stringValue(row[1]);
  const finalName = nullableStringValue(row[2]);
  const description = nullableStringValue(row[3]);
  const snippet = stringValue(row[4]);
  const gpsLat = nullableNumberValue(row[5]);
  const gpsLon = nullableNumberValue(row[6]);
  const tagsText = stringValue(row[12]);
  const transcript = stringValue(row[13]);
  return {
    fingerprint: stringValue(row[0]),
    fileName,
    finalName,
    description,
    snippet: snippet.length > 0 ? snippet : description ?? fileName,
    tags: tagsText.split('\n').filter((tag) => tag.length > 0),
    folder: {
      folderId: stringValue(row[7]),
      currentPath: stringValue(row[8]),
      displayName: stringValue(row[9]),
      firstSeenAt: stringValue(row[10]),
      lastSeenAt: stringValue(row[11]),
    },
    gps: gpsLat === null || gpsLon === null ? null : { lat: gpsLat, lon: gpsLon },
    score: weightedSearchScore({
      fileName,
      finalName: finalName ?? '',
      description: description ?? '',
      tagsText,
      transcript,
    }, rankingTerms),
  };
};

const weightedSearchScore = (
  columns: { fileName: string; finalName: string; description: string; tagsText: string; transcript: string },
  rankingTerms: readonly string[],
): number => {
  let score = 0;
  for (const term of rankingTerms) {
    score += countTerm(columns.fileName, term) * 80;
    score += countTerm(columns.finalName, term) * 70;
    score += countTerm(columns.tagsText, term) * 45;
    score += countTerm(columns.description, term) * 30;
    score += countTerm(columns.transcript, term) * 5;
  }
  return score;
};

const countTerm = (value: string, term: string): number => {
  const haystack = value.toLocaleLowerCase();
  const needle = term.toLocaleLowerCase();
  if (needle.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (offset < haystack.length) {
    const index = haystack.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
  return count;
};

const stringValue = (value: SqlValue | undefined): string => typeof value === 'string' ? value : '';

const nullableStringValue = (value: SqlValue | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : null;
};

const nullableNumberValue = (value: SqlValue | undefined): number | null => typeof value === 'number' ? value : null;

const uniqueFingerprints = (rows: readonly (typeof faceObservations.$inferSelect)[]): string[] =>
  [...new Set(rows.map((row) => row.fingerprint))].sort((left, right) => left.localeCompare(right));

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

class CatalogAppError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
  }
}

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
  if (cause instanceof CatalogAppError) return { ok: false, error: cause.appError };
  const message = cause instanceof Error ? cause.message : 'Global catalog operation failed';
  return { ok: false, error: appError('internal', message, cause) };
};
