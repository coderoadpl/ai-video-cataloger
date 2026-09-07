import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';
import { SqlJsGlobalCatalogStore } from '@adapters/db/global-catalog.js';
import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

describe('W99 A7 faces pairs CLI', () => {
  let root: string;
  beforeEach(async () => {
    root = createTestDir();
    await mkdir(join(root, '.ai-video-cataloger'), { recursive: true });
    await writeFile(join(root, '.ai-video-cataloger', 'config.json'), JSON.stringify({ faces_enabled: 'true' }));
  });
  afterEach(() => cleanupTestDir(root));
  const run = (args: string[]) => runCli(args, { cwd: root, env: { HOME: root } });
  const seed = async () => {
    const store = new SqlJsGlobalCatalogStore({ homeDirectory: root });
    const embedding = Array.from({ length: 128 }, (_, i) => i === 0 ? 1 : 0);
    for (const personId of ['a', 'b']) {
      await store.upsertPerson({ personId, displayName: null, kind: 'face', createdAt: '2026-01-01T00:00:00.000Z', centroid: embedding, exemplarCount: 1 });
      await store.upsertFaceObservation({ obsId: personId, fingerprint: personId, personId, kind: 'face', media: 'video', frameTsS: 0, bbox: { x: 0, y: 0, width: 100, height: 100 }, embedding, quality: 0.9, cropPath: null });
    }
    await store.dispose();
  };
  it('prints exactly started/completed for an empty queue and exits zero', async () => {
    const result = await run(['faces', 'pairs', 'list', '--json']);
    expect(result.exitCode).toBe(0);
    const events = parseJsonEvents(result.stdout);
    expect(events.map((e) => e.type)).toEqual(['started', 'completed']);
    expect(events[0]).toMatchObject({ command: 'faces_pairs_list' });
    expect(events[1]).toMatchObject({ data: { pending: 0, candidates: [] } });
  });
  it('labels people with the grid index plus one and persists decisions between processes', async () => {
    await seed();
    const grid = await run(['faces', 'people', '--json']);
    const data = z.object({ people: z.array(z.object({ fallbackIndex: z.number() })) }).parse(findEvent(parseJsonEvents(grid.stdout), 'completed')?.data);
    const human = await run(['faces', 'pairs', 'list']);
    expect(human.exitCode).toBe(0);
    for (const person of data.people) expect(human.stdout).toContain(`Person ${person.fallbackIndex + 1}`);
    const decided = await run(['faces', 'pairs', 'decide', 'a', 'b', 'different', '--json']);
    expect(decided.exitCode).toBe(0);
    expect(parseJsonEvents(decided.stdout).map((e) => e.type)).toEqual(['started', 'completed']);
    expect(findEvent(parseJsonEvents(decided.stdout), 'started')).toMatchObject({ command: 'faces_pairs_decide' });
    const next = await run(['faces', 'pairs', 'list', '--json']);
    expect(findEvent(parseJsonEvents(next.stdout), 'completed')).toMatchObject({ data: { pending: 0 } });
    const missing = await run(['faces', 'pairs', 'decide', 'a', 'missing', 'same', '--json']);
    expect(missing.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.not_found);
    expect(findEvent(parseJsonEvents(missing.stdout), 'error')).toMatchObject({ code: 'NOT_FOUND' });
  });
  it('uses existing validation and faces-disabled exit codes', async () => {
    await seed();
    for (const args of [['list', '--limit', '1001'], ['decide', 'a', 'a', 'same'], ['decide', 'a', 'b', 'invalid']]) {
      const result = await run(['faces', 'pairs', ...args, '--json']);
      expect(result.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
      expect(findEvent(parseJsonEvents(result.stdout), 'error')).toMatchObject({ code: 'VALIDATION' });
    }
    await writeFile(join(root, '.ai-video-cataloger', 'config.json'), JSON.stringify({ faces_enabled: 'false' }));
    const result = await run(['faces', 'pairs', 'list', '--json']);
    expect(result.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.faces_disabled);
    expect(findEvent(parseJsonEvents(result.stdout), 'error')).toMatchObject({ code: 'FACES_DISABLED' });
  });
  it('imports JSON and CSV, keeps dry runs read-only and rejects malformed files', async () => {
    await seed();
    const corpus = join(root, 'pairs.json');
    await writeFile(corpus, JSON.stringify([{ left: 'a', right: 'b', verdict: 'same' }, { left: 'missing', right: 'b', verdict: 'different' }, { left: 'a', right: 'b', verdict: 'unsure' }]));
    const preview = await run(['faces', 'pairs', 'import', corpus, '--dry-run', '--json']);
    expect(preview.exitCode).toBe(0);
    expect(findEvent(parseJsonEvents(preview.stdout), 'completed')).toMatchObject({ data: { imported: 1, skipped: 1, unresolved: 1, merges: 0 } });
    const csv = join(root, 'pairs.csv');
    await writeFile(csv, 'a,b,same\n');
    const imported = await run(['faces', 'pairs', 'import', csv, '--apply-merges', '--json']);
    expect(imported.exitCode).toBe(0);
    expect(parseJsonEvents(imported.stdout).map((e) => e.type)).toEqual(['started', 'completed']);
    expect(findEvent(parseJsonEvents(imported.stdout), 'completed')).toMatchObject({ data: { imported: 1, merges: 1 } });
    await writeFile(corpus, '[malformed');
    const bad = await run(['faces', 'pairs', 'import', corpus, '--json']);
    expect(bad.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
    expect(findEvent(parseJsonEvents(bad.stdout), 'error')).toMatchObject({ code: 'VALIDATION' });
  });
});
