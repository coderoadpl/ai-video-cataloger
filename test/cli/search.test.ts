import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';

describe('search command filters', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('rejects a request with neither a query nor a filter', async () => {
    const result = await runCli(['search', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(2);
    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');
    expect(errorEvent?.code).toBe('VALIDATION');
  });

  it('accepts a bare filter search with no query text and pins the NDJSON envelope', async () => {
    const result = await runCli(['search', '--tag', 'beach', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(0);
    const events = parseJsonEvents(result.stdout);
    expect(events.map((event) => event.type)).toEqual(['started', undefined, 'completed']);
    expect(events[1]).toMatchObject({ query: null, results: [], count: 0, total: 0 });
    expect(findEvent(events, 'completed')?.data).toMatchObject({ query: null, results: [], count: 0, total: 0 });
  });

  it('reports a validation error for an unknown --folder', async () => {
    const result = await runCli(['search', '--tag', 'beach', '--folder', '/definitely/not/a/catalog/folder', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(2);
    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');
    expect(errorEvent?.code).toBe('VALIDATION');
  });

  it('reports a validation error for an unresolvable --person', async () => {
    const result = await runCli(['search', '--tag', 'beach', '--person', 'nobody-with-this-name', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(2);
    const events = parseJsonEvents(result.stdout);
    const errorEvent = findEvent(events, 'error');
    expect(errorEvent?.code).toBe('VALIDATION');
  });

  it('prints an empty-result human line for a filter-only search with no catalog', async () => {
    const result = await runCli(['search', '--tag', 'beach'], { cwd: testDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('No results found');
  });
});
