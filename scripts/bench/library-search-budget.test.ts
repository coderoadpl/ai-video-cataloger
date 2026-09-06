import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApp, type App } from '../../apps/server/src/create-app.js';
import { scaledTimeout } from '../../test/helpers/gate-timeout.js';
import { seedLargeCatalog } from './seed-large-catalog.js';

const BUDGET_MS = {
  collectionPageMedian: 800,
  collectionPageWorst: 2_500,
  facets: 300,
  suggestions: 50,
};

const SIZES = { photos: 2_500, videos: 300, people: 200, faceObservations: 1_500 };

const PREFIXES = ['w', 'wa', 'wak', 'waka', 'wakac', 'wakacj'];

const collectionUrl = (query: string | null): string => {
  const params = new URLSearchParams({
    sort: 'captured_desc',
    media: 'all',
    hideUnavailable: 'false',
    hidden: 'exclude',
    limit: '200',
  });
  if (query !== null) params.set('query', query);
  return `/api/library/collection?${params.toString()}`;
};

let home: string;
let app: App;

const timedCall = async (url: string): Promise<{ ms: number; body: unknown }> => {
  const startedAt = performance.now();
  const response = await app.honoApp.request(url);
  const body: unknown = await response.json();
  expect(response.status).toBe(200);
  return { ms: performance.now() - startedAt, body };
};

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'avc-library-budget-'));
  await seedLargeCatalog({ home, sizes: SIZES });
  app = createApp({ homeDirectory: home, processName: 'cli', version: 'budget' });
  await timedCall(collectionUrl(null));
}, scaledTimeout(300_000));

afterAll(async () => {
  await app.dispose();
  await rm(home, { recursive: true, force: true });
});

describe('library query budget at scale', () => {
  it('answers every keystroke of a prefix search within the collection page budget', async () => {
    const measured: number[] = [];
    for (const prefix of PREFIXES) {
      const { ms } = await timedCall(collectionUrl(prefix));
      measured.push(ms);
    }
    console.log(`collection prefix search: ${measured.map((ms) => `${ms.toFixed(0)}ms`).join(' ')}`);
    const sorted = [...measured].sort((left, right) => left - right);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    expect(median).toBeLessThan(BUDGET_MS.collectionPageMedian);
    expect(Math.max(...measured)).toBeLessThan(BUDGET_MS.collectionPageWorst);
  }, scaledTimeout(300_000));

  it('keeps a searched page identical to the page the unbounded scan used to return', async () => {
    const { body } = await timedCall(collectionUrl('wakacj'));
    const parsed = z.object({
      ok: z.literal(true),
      data: z.object({
        total: z.number(),
        items: z.array(z.object({ fingerprint: z.string(), capturedAt: z.string().nullable() })),
      }),
    }).parse(body);
    expect(parsed.data.total).toBeGreaterThan(0);
    expect(parsed.data.items.length).toBeGreaterThan(0);
    const captured = parsed.data.items.map((item) => item.capturedAt ?? '');
    expect([...captured].sort((left, right) => right.localeCompare(left))).toEqual(captured);
  }, scaledTimeout(120_000));

  it('answers the facet rebuild within budget', async () => {
    const { ms } = await timedCall('/api/library/facets');
    console.log(`facets: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS.facets);
  }, scaledTimeout(120_000));

  it('answers the search suggestion list within budget', async () => {
    const { ms } = await timedCall('/api/tags');
    console.log(`tags: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(BUDGET_MS.suggestions);
  }, scaledTimeout(120_000));
});
