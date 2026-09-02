import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { EXIT_CODE_BY_ERROR_CODE } from '../../core/contract/http-status.js';
import { findEvent, parseJsonEvents, runCli } from '../helpers/cli-runner.js';

const remote = {
  remoteId: 'memory-backup-cli',
  name: 'memory-backup-cli.avcbak',
  tier: 'critical',
  createdAt: '2026-09-02T12:00:00.000Z',
  sizeBytes: 12345,
  appVersion: '1.0.0',
  schemaVersions: { globalCatalog: 16, photos: 6 },
};

describe('backup CLI', () => {
  it('lists remote backups as NDJSON', async () => {
    const result = await runCli(['backup', 'list', '--json'], { env: memoryBackupEnv() });

    expect(result.exitCode).toBe(0);
    const completed = findEvent(parseJsonEvents(result.stdout), 'completed');
    expect(completed).toMatchObject({ data: [remote] });
  });

  it('requires --yes before restore and prints overwritten backup details', async () => {
    const result = await runCli(['backup', 'restore', remote.remoteId], { env: memoryBackupEnv() });

    expect(result.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.confirmation_required);
    expect(result.stdout).toBe(`tier: critical\ndate: ${remote.createdAt}\nsize: ${String(remote.sizeBytes)}\n`);
    expect(result.stderr).toContain('CONFIRMATION_REQUIRED');
  });
});

const memoryBackupEnv = (): Record<string, string> => ({
  DB_DRIVER: 'memory',
  AVC_TEST_MEMORY_BACKUPS: Buffer.from(JSON.stringify([{ metadata: remote, base64: '' }])).toString('base64url'),
});
