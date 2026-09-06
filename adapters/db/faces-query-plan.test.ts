import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type initSqlJs from 'sql.js';
import type { SqlValue } from 'sql.js';

import type { CatalogFile, CatalogFolder, FaceObservation, Person } from '@core/domain/index.js';
import type { CatalogSearchFilters } from '@core/server/ports.js';

interface CapturedStatement {
  sql: string;
  params: Record<string, SqlValue> | undefined;
}

const captured = vi.hoisted((): { statements: CapturedStatement[] } => ({ statements: [] }));

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<{ default: typeof initSqlJs }>('sql.js');
  return {
    default: async (config: Parameters<typeof actual.default>[0]) => {
      const SQL = await actual.default(config);
      const exec = SQL.Database.prototype.exec;
      SQL.Database.prototype.exec = function patched(
        this: InstanceType<typeof SQL.Database>,
        ...args: [string, Record<string, SqlValue> | undefined]
      ) {
        captured.statements.push({ sql: args[0], params: args[1] });
        return exec.apply(this, args);
      };
      return SQL;
    },
  };
});

const { SqlJsGlobalCatalogStore } = await import('./global-catalog.js');
const { SqlJsPhotosStore } = await import('./photos-store.js');

const tempRoots: string[] = [];

const tempHome = async (): Promise<string> => {
  const home = await mkdtemp(path.join(tmpdir(), 'avc-faces-plan-'));
  tempRoots.push(home);
  return home;
};

afterEach(async () => {
  captured.statements.length = 0;
  while (tempRoots.length > 0) {
    const home = tempRoots.pop();
    if (home !== undefined) await rm(home, { recursive: true, force: true });
  }
});

const folder: CatalogFolder = {
  folderId: '44444444-4444-4444-8444-444444444444',
  currentPath: '/media/plan',
  displayName: 'plan',
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

const fileOf = (index: number): CatalogFile => ({
  fingerprint: `fp-${String(index)}`,
  folderId: folder.folderId,
  fileName: `clip-${String(index)}.mp4`,
  size: 1024,
  durationS: 10,
  width: null,
  height: null,
  gpsLat: null,
  gpsLon: null,
  processedAt: '2026-01-02T00:00:00.000Z',
  analyzer: 'openai',
  model: 'gpt-4.1-mini',
  missingAt: null,
  capturedAt: '2026-01-02T00:00:00.000Z',
  capturedAtSource: null,
  gpsSource: null,
  gpsAccuracyM: null,
  gpsIntervalKind: null,
  gpsResolvedAt: null,
  place: null,
});

const person: Person = {
  personId: 'person-1',
  displayName: 'Person 1',
  kind: 'face',
  createdAt: '2026-01-01T00:00:00.000Z',
  centroid: Array.from({ length: 128 }, () => 0.2),
  exemplarCount: 1,
};

const observationOf = (index: number): FaceObservation => ({
  obsId: `fp-${String(index)}:face:1:1`,
  fingerprint: `fp-${String(index)}`,
  kind: 'face',
  frameTsS: 1,
  bbox: { x: 0, y: 0, width: 100, height: 100 },
  embedding: Array.from({ length: 128 }, () => 0.2),
  quality: 0.9,
  personId: person.personId,
  cropPath: null,
  media: 'video',
});

const PERSON_FILTERS: CatalogSearchFilters = {
  tagTermSets: [],
  personIds: [person.personId],
  place: null,
  capturedFrom: null,
  capturedTo: null,
  hasGps: null,
  folderId: null,
  excludeFolderIds: [],
  excludeMissing: false,
};

const lastSelect = (needle: string): CapturedStatement => {
  const match = [...captured.statements].reverse().find((statement) =>
    statement.sql.includes(needle) && statement.sql.trimStart().toUpperCase().startsWith('SELECT'));
  if (match === undefined) throw new Error(`no captured SELECT containing ${needle}`);
  return match;
};

const planLines = async (databasePath: string, statement: CapturedStatement): Promise<string[]> => {
  const SQL = await vi.importActual<{ default: typeof initSqlJs }>('sql.js').then((actual) => actual.default());
  const client = new SQL.Database(readFileSync(databasePath));
  try {
    const result = client.exec(`EXPLAIN QUERY PLAN ${statement.sql}`, statement.params);
    return (result[0]?.values ?? []).map((row) => String(row[3]));
  } finally {
    client.close();
  }
};

describe('face-filtered read paths', () => {
  it('answers a person-filtered catalog search through the observation fingerprint index', async () => {
    const home = await tempHome();
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: home });
    await store.upsertFolder(folder);
    await store.upsertPerson(person);
    await store.withBatch(async () => {
      for (let index = 0; index < 30; index += 1) {
        const file = await store.upsertFile(fileOf(index));
        if (!file.ok) return file;
        const observation = await store.upsertFaceObservation(observationOf(index));
        if (!observation.ok) return observation;
      }
      return { ok: true as const, value: undefined };
    });
    expect((await store.flush()).ok).toBe(true);

    captured.statements.length = 0;
    const searched = await store.search({
      match: null,
      rankingTerms: [],
      filters: PERSON_FILTERS,
      sort: 'captured_desc',
      limit: 10,
      offset: 0,
      after: null,
    });
    expect(searched.ok && searched.value.total).toBe(30);

    const plan = await planLines(store.databasePath(), lastSelect('face_observations'));
    expect(plan.some((line) => line.startsWith('SCAN face_observations'))).toBe(false);
    expect(plan.some((line) => line.includes('idx_face_observations_fingerprint'))).toBe(true);
  });

  it('binds a person fingerprint allow list as one parameter instead of one per file', async () => {
    const home = await tempHome();
    const photos = new SqlJsPhotosStore({ homeDirectory: home });
    expect((await photos.upsertFolder({
      folderId: 'path-plan',
      currentPath: '/media/plan',
      displayName: 'plan',
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      defaultConfigId: null,
    })).ok).toBe(true);

    captured.statements.length = 0;
    const fingerprints = Array.from({ length: 300 }, (_unused, index) => `ph_${String(index).padStart(14, '0')}`);
    const page = await photos.collectionPage({
      match: null,
      rankingTerms: [],
      from: null,
      to: null,
      folderId: null,
      fingerprints,
      tagTermSets: [],
      excludeMissing: false,
      hidden: 'exclude',
      sort: 'captured_desc',
      limit: 200,
      offset: 0,
      after: null,
    });
    expect(page.ok).toBe(true);

    const boundParameters = captured.statements.map((statement) => Object.keys(statement.params ?? {}).length);
    expect(Math.max(...boundParameters)).toBeLessThan(8);
  });
});
