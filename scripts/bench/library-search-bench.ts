import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { createApp } from '../../apps/server/src/create-app.js';
import { DEFAULT_SEED_SIZES, seedLargeCatalog, type SeedSizes } from './seed-large-catalog.js';

const scratchRoot = process.env.AVC_SCRATCH_DIR ?? path.join(homedir(), '.ai-video-cataloger-scratch');
const benchHome = path.join(scratchRoot, 'w102-library-bench-home');

const sizes: SeedSizes = DEFAULT_SEED_SIZES;

const ensureSeeded = async (): Promise<void> => {
  if (existsSync(path.join(benchHome, '.ai-video-cataloger', 'catalog.db'))) {
    console.log(`reusing seeded home at ${benchHome}`);
    return;
  }
  mkdirSync(benchHome, { recursive: true });
  console.log(`seeding ${String(sizes.photos)} photos / ${String(sizes.videos)} videos / ${String(sizes.people)} people / ${String(sizes.faceObservations)} face observations`);
  const seeded = await seedLargeCatalog({ home: benchHome, onProgress: (message) => console.log(`  ${message}`) });
  console.log(`seeded in ${String(Math.round(seeded.elapsedMs / 1000))}s`);
};

const percentile = (samples: readonly number[], fraction: number): number => {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
};

const main = async (): Promise<void> => {
  await ensureSeeded();
  const app = createApp({ homeDirectory: benchHome, processName: 'gui', version: 'bench' });

  const call = async (label: string, url: string): Promise<number> => {
    console.log(`> ${label}`);
    const startedAt = performance.now();
    const response = await app.honoApp.request(url);
    const body: unknown = await response.json();
    const elapsed = performance.now() - startedAt;
    if (response.status !== 200) console.log(`  ${label}: HTTP ${String(response.status)} ${JSON.stringify(body).slice(0, 200)}`);
    console.log(`  ${label.padEnd(34)} ${elapsed.toFixed(1)} ms`);
    return elapsed;
  };

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

  const prefixes = ['w', 'wa', 'wak', 'waka', 'wakac', 'wakacj'];
  const rows: { label: string; ms: number }[] = [];

  rows.push({ label: 'collection (no query, first paint)', ms: await call('collection', collectionUrl(null)) });
  rows.push({ label: 'facets', ms: await call('facets', '/api/library/facets') });
  rows.push({ label: 'tags (search suggestions)', ms: await call('tags', '/api/tags') });

  const perKeystroke: number[] = [];
  for (const prefix of prefixes) {
    const ms = await call(`collection "${prefix}"`, collectionUrl(prefix));
    perKeystroke.push(ms);
    rows.push({ label: `collection query "${prefix}"`, ms });
  }

  rows.push({ label: 'search route "wakacj"', ms: await call('search', `/api/search?query=wakacj&limit=50&offset=0&thumbnails=existing&hidden=exclude`) });

  for (const row of rows) console.log(`${row.label.padEnd(38)} ${row.ms.toFixed(1)} ms`);
  console.log(`\nper-keystroke collection: median ${percentile(perKeystroke, 0.5).toFixed(1)} ms, max ${Math.max(...perKeystroke).toFixed(1)} ms`);

  await app.dispose();
};

await main();
