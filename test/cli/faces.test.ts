import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXIT_CODE_BY_ERROR_CODE } from '@core/contract/index.js';

import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

describe('faces command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('keeps the photo-root index command in the NDJSON envelope and exit-code taxonomy', async () => {
    const photoRoot = join(testDir, 'photos');
    const result = await runCli(['faces', 'index', photoRoot, '--json'], {
      cwd: testDir,
      env: { DB_DRIVER: 'memory' },
    });
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.faces_disabled);
    expect(findEvent(events, 'started')).toMatchObject({ command: 'faces_index', data: { root: photoRoot } });
    expect(findEvent(events, 'error')).toMatchObject({ code: 'FACES_DISABLED' });
  });
});
