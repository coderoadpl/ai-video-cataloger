import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { facesPeople, facesStatus, libraryCollection, type CollectionDeps, type FacesPeopleDeps } from '@core/server/index.js';

import { scaledTimeout } from '../../test/helpers/gate-timeout.js';
import { seedSyntheticFaceCatalog, type SyntheticFaceCatalog, type SyntheticFaceCatalogShape } from '../../test/helpers/synthetic-face-catalog.js';
import { InMemoryConfig, InMemoryMedia, InMemoryDownloads, InMemoryJobs, InMemoryFaceEngine } from '../../test/server/usecases/test-fakes.js';

const BENCH = process.env.AVC_PEOPLE_SCALE_BENCH === '1';

const GATE_SHAPE: SyntheticFaceCatalogShape = {
  people: 5_000,
  videos: 400,
  photos: 1_200,
  videoObservationsPerFile: 1,
  photoObservationsPerFile: 10,
  analysedPhotoEvery: 7,
};

const BENCH_SHAPE: SyntheticFaceCatalogShape = {
  people: 2_200,
  videos: 3_800,
  photos: 36_000,
  videoObservationsPerFile: 1,
  photoObservationsPerFile: 1,
  analysedPhotoEvery: 1,
};

const SHAPE = BENCH ? BENCH_SHAPE : GATE_SHAPE;

const PEOPLE_BUDGET_MS = scaledTimeout(750);
const PERSON_PAGE_BUDGET_MS = scaledTimeout(2_000);

let catalog: SyntheticFaceCatalog;
let home: string;
let facesDeps: FacesPeopleDeps;
let collectionDeps: CollectionDeps;

const report = (label: string, elapsedMs: number): void => {
  if (!BENCH) return;
  console.log(`${label}: ${String(elapsedMs)} ms (${String(SHAPE.people)} people, ${String(catalog.observations)} observations)`);
};

const millisecondsOf = async (operation: () => Promise<void>): Promise<number> => {
  const startedAt = Date.now();
  await operation();
  return Date.now() - startedAt;
};

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'avc-faces-scale-'));
  catalog = await seedSyntheticFaceCatalog(home, SHAPE);
  const config = new InMemoryConfig();
  await config.set({ kind: 'home' }, 'faces_enabled', 'true');
  facesDeps = {
    config,
    fs: catalog.fs,
    globalCatalog: catalog.globalCatalog,
    photos: catalog.photos,
  };
  collectionDeps = {
    globalCatalog: catalog.globalCatalog,
    photos: catalog.photos,
    fs: catalog.fs,
    media: new InMemoryMedia(),
  };
}, scaledTimeout(BENCH ? 900_000 : 240_000));

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('people surfaces at library scale', () => {
  it('lists people without walking every observation once per person', async () => {
    const elapsed = await millisecondsOf(async () => {
      const [listed, status] = await Promise.all([
        facesPeople(facesDeps),
        facesStatus({ ...facesDeps, downloads: new InMemoryDownloads(), jobs: new InMemoryJobs(), faceEngine: new InMemoryFaceEngine(), media: new InMemoryMedia() }),
      ]);
      expect(status.ok).toBe(true);
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.value.people.length).toBe(SHAPE.people);
      const busiest = listed.value.people.find((person) => person.personId === catalog.busiestPersonId);
      expect(busiest?.observationCount).toBeGreaterThan(500);
      expect(busiest?.fileCounts.video).toBe(SHAPE.videos);
    });
    report('facesPeople + facesStatus', elapsed);
    expect(elapsed).toBeLessThan(PEOPLE_BUDGET_MS);
  }, scaledTimeout(60_000));

  it('renders the first page of a person collection without scanning observations per file', async () => {
    const elapsed = await millisecondsOf(async () => {
      const page = await libraryCollection(collectionDeps, {
        query: null,
        filters: {
          tags: [],
          people: [catalog.busiestPersonId],
          place: null,
          from: null,
          to: null,
          hasGps: null,
          folderId: null,
          hideUnavailable: false,
        },
        sort: 'captured_desc',
        media: 'all',
        limit: 200,
        cursor: null,
      });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(page.value.items).toHaveLength(200);
      expect(page.value.videoTotal).toBe(SHAPE.videos);
      expect(page.value.photoTotal).toBeGreaterThan(150);
    });
    report('person collection first page', elapsed);
    expect(elapsed).toBeLessThan(PERSON_PAGE_BUDGET_MS);
  }, scaledTimeout(60_000));
});
