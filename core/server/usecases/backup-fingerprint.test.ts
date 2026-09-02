import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@core/domain/sha256.js';

import { InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';
import { computeBackupFingerprint } from './backup-fingerprint.js';

describe('backup fingerprint', () => {
  it('hashes full database bytes and metadata for other critical files in sorted path order', async () => {
    const fs = new InMemoryFileSystem('/home');
    fs.addFile('/snap/photos.db', { content: 'photos-bytes' });
    fs.addFile('/snap/catalog.db', { content: 'catalog-bytes' });
    fs.addFile('/home/config.json', { content: '{}', size: 2, mtimeMs: 1234 });
    const result = await computeBackupFingerprint(fs, [
      { sourcePath: '/home/config.json', archivePath: 'config.json', kind: 'file' },
      { sourcePath: '/snap/photos.db', archivePath: 'photos.db', kind: 'file' },
      { sourcePath: '/snap/catalog.db', archivePath: 'catalog.db', kind: 'file' },
    ]);
    const expected = sha256Hex([
      sha256Hex('catalog-bytes'),
      'config.json|2|1234',
      sha256Hex('photos-bytes'),
    ].join('\n'));

    expect(result).toEqual({ ok: true, value: expected });
  });
});
