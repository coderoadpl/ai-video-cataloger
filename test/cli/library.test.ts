import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';
import { cleanupTestDir, createTestDir } from '../setup.js';

describe('library commands', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('rejects hide without exactly one selection scope', async () => {
    const result = await runCli(['library', 'hide', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(2);
    expect(findEvent(parseJsonEvents(result.stdout), 'error')?.code).toBe('VALIDATION');
  });

  it('reports validation when a dry-run trash filter resolves no files', async () => {
    const result = await runCli(['library', 'trash', '--hidden', 'only', '--dry-run', '--json'], { cwd: testDir });

    expect(result.exitCode).toBe(2);
    expect(findEvent(parseJsonEvents(result.stdout), 'error')).toMatchObject({ code: 'VALIDATION' });
  });

  it('keeps library selection filter flags aligned with search help', async () => {
    const search = await runCli(['search', '--help'], { cwd: testDir });
    const hide = await runCli(['library', 'hide', '--help'], { cwd: testDir });
    const trash = await runCli(['library', 'trash', '--help'], { cwd: testDir });
    const shared = ['--tag', '--person', '--place', '--from', '--to', '--has-gps', '--no-has-gps', '--folder', '--hidden', '--json'];
    const libraryOnly = ['--media', '--fingerprint', '--of-person', '--skip-shared'];

    expect(search.stdout).toContain('[query]');
    for (const flag of shared) {
      expect(search.stdout).toContain(flag);
      expect(hide.stdout).toContain(flag);
      expect(trash.stdout).toContain(flag);
    }
    for (const flag of libraryOnly) expect(hide.stdout).toContain(flag);
    expect(trash.stdout).toContain('--dry-run');
    expect(trash.stdout).toContain('--yes');
    expect(hide.stdout).not.toContain('--sort');
    expect(hide.stdout).not.toContain('--limit');
    expect(hide.stdout).not.toContain('--offset');
  });
});
