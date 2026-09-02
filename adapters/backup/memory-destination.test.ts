import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { BackupManifest } from '@core/domain/index.js';

import { MemoryBackupDestination } from './memory-destination.js';

describe('memory backup destination', () => {
  it('implements upload, list, download, and remove', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'avc-memory-backup-'));
    const source = path.join(root, 'source.avcbak');
    const downloaded = path.join(root, 'downloaded.avcbak');
    writeFileSync(source, 'opaque');
    const destination = new MemoryBackupDestination();
    const folder = await destination.ensureFolder(new AbortController().signal);
    expect(folder).toMatchObject({ ok: true, value: { name: 'AI Video Cataloger Backups' } });

    const uploaded = await destination.upload({
      sourcePath: source,
      name: 'avc-critical-20260902T120000Z.avcbak',
      manifest: manifest(),
    }, new AbortController().signal);
    expect(uploaded).toMatchObject({ ok: true, value: { tier: 'critical', sizeBytes: 6 } });
    const listed = await destination.list('critical', new AbortController().signal);
    expect(listed).toMatchObject({ ok: true, value: { backups: [expect.objectContaining({ name: 'avc-critical-20260902T120000Z.avcbak' })] } });
    if (!uploaded.ok) return;
    expect(await destination.download(uploaded.value.remoteId, downloaded, new AbortController().signal)).toMatchObject({ ok: true });
    expect(readFileSync(downloaded, 'utf8')).toBe('opaque');
    expect(await destination.remove(uploaded.value.remoteId, new AbortController().signal)).toEqual({
      ok: true,
      value: { removed: true },
    });
  });
});

const manifest = (): BackupManifest => ({
  formatVersion: 1,
  tier: 'critical',
  createdAt: '2026-09-02T12:00:00.000Z',
  appVersion: '1.0.0',
  schemaVersions: { globalCatalog: 15, photos: 5 },
  contentFingerprint: 'a'.repeat(64),
  totalBytes: 1,
  files: [{ path: 'catalog.db', sizeBytes: 1, sha256: 'b'.repeat(64) }],
  folders: [],
  keyFingerprint: 'sha256:0123456789ab',
});
