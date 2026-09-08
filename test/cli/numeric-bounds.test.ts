import { describe, expect, it } from 'vitest';

import { createTestDir, cleanupTestDir } from '../setup.js';
import { createFakeVideoFile } from '../helpers/fixtures.js';

import { runCli, parseJsonEvents, findEvent } from '../helpers/cli-runner.js';

describe('numeric option usage errors', () => {
  it.each(['process', 'process-drive'])('%s rejects an out-of-range timeout before dispatch', async (command) => {
    const result = await runCli([command, '/missing', '--timeout', '900', '--help']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/30.*600/);
  });

  it.each(['process', 'process-drive'])('%s accepts the timeout upper boundary', async (command) => {
    const result = await runCli([command, '/missing', '--timeout', '600', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it.each([
    ['--tolerance-minutes', '241', '0', '240'],
    ['--tolerance-minutes', '-1', '0', '240'],
    ['--max-visit-hours', '721', '1', '720'],
    ['--max-visit-hours', '0', '1', '720'],
    ['--max-visit-hours', '12hours', '1', '720'],
  ])('rejects %s %s during option parsing', async (option, value, min, max) => {
    const result = await runCli(['gps', 'backfill', '/missing.json', option, value, '--help']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${min}..${max}`);
  });
});


it('dispatches a drive run with timeout 600', async () => {
  const directory = createTestDir();
  try {
    createFakeVideoFile(directory, 'clip.mp4');
    const result = await runCli(['process-drive', directory, '--timeout', '600', '--whisper', 'skip', '--skip-rename', '--json'], {
      cwd: directory, env: { PATH: '/nonexistent' },
    });
    expect(result.exitCode).toBe(0);
    expect(findEvent(parseJsonEvents(result.stdout), 'started')).toMatchObject({ data: { options: { timeout: 600 } } });
    expect(findEvent(parseJsonEvents(result.stdout), 'completed')).toBeDefined();
  } finally {
    cleanupTestDir(directory);
  }
});

it.each(['0', '240'])('accepts the tolerance boundary %s for both media types', async (value) => {
  for (const command of [['gps', 'backfill'], ['photos', 'gps', 'backfill']]) {
    const result = await runCli([...command, '/missing.json', '--tolerance-minutes', value, '--max-visit-hours', '720', '--help']);
    expect(result.exitCode).toBe(0);
  }
});

it('rejects invalid photo GPS options before dispatch', async () => {
  const result = await runCli(['photos', 'gps', 'backfill', '/missing.json', '--max-visit-hours', '721', '--help']);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('1..720');
});
