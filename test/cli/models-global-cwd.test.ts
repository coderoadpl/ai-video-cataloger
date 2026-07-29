/**
 * Regression: global model commands (list/use) must NOT create a per-folder
 * database in the working directory. A GUI launched from Finder runs with
 * cwd="/" (read-only); tying these commands to cwd made them crash with
 * ENOENT mkdir '/.ai-video-cataloger'. They now use the home-dir config.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, parseJsonEvents } from '../helpers/cli-runner.js';
import { createTestDir, cleanupTestDir } from '../setup.js';
import { scaledTimeout } from '../helpers/gate-timeout.js';

describe('models list/use are folder-independent', () => {
  let cwd: string;

  beforeEach(() => {
    // A pristine temp dir with NO .ai-video-cataloger - if the command wrongly
    // uses cwd, it would create one here.
    cwd = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(cwd);
  });

  it('models list works from an arbitrary cwd without touching it', async () => {
    const result = await runCli(['models', 'list', '--json'], { cwd });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('ENOENT');
    expect(result.stdout).not.toContain('Fatal error');

    const completed = parseJsonEvents(result.stdout).find((e) => e.type === 'completed');
    const models = (completed?.data?.models as Array<{ name: string }> | undefined) ?? [];
    expect(models.length).toBeGreaterThan(0);

    // The command must not have created a database in the working directory
    expect(existsSync(join(cwd, '.ai-video-cataloger'))).toBe(false);
  }, scaledTimeout(30_000));
});
