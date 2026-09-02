import { describe, expect, it } from 'vitest';

import { InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';
import { collectBackupScope } from './backup-scope.js';

describe('backup scope', () => {
  it('collects only the critical allow-list and excludes secrets, locks, and temp files', async () => {
    const fs = fixtureFileSystem();
    const result = await collectBackupScope(fs, {
      tier: 'critical',
      homeDirectory: '/workspace',
      globalCatalogSnapshot: '/workspace/.ai-video-cataloger/backup-staging/job/catalog.db',
      photosSnapshot: '/workspace/.ai-video-cataloger/backup-staging/job/photos.db',
      folders: [{ folderId: 'folder-1', path: '/media/library' }],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.entries.map((entry) => entry.archivePath)).toEqual([
      'catalog.db',
      'config.json',
      'faces/obs/person/crop.jpg',
      'folders/folder-1/config.json',
      'photos.db',
    ]);
    expect(result.value.entries.some((entry) => /credentials|catalog\.lock|\.tmp$/.test(entry.archivePath))).toBe(false);
  });

  it('collects optional artifacts as an independent allow-list', async () => {
    const fs = fixtureFileSystem();
    const result = await collectBackupScope(fs, {
      tier: 'optional',
      homeDirectory: '/workspace',
      globalCatalogSnapshot: '/unused/catalog.db',
      photosSnapshot: null,
      folders: [],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.entries.map((entry) => entry.archivePath)).toEqual([
      'photo-artifacts/proxies/photo.jpg',
      'photo-artifacts/thumbs/photo.grid.jpg',
      'read-only-folders/folder-1/frames/frame.jpg',
    ]);
    expect(result.value.entries.some((entry) => entry.archivePath.endsWith('.tmp'))).toBe(false);
  });
});

const fixtureFileSystem = (): InMemoryFileSystem => {
  const fs = new InMemoryFileSystem('/workspace');
  fs.addFile('/workspace/.ai-video-cataloger/backup-staging/job/catalog.db', { content: 'catalog' });
  fs.addFile('/workspace/.ai-video-cataloger/backup-staging/job/photos.db', { content: 'photos' });
  fs.addFile('/workspace/.ai-video-cataloger/config.json', { content: '{}' });
  fs.addFile('/workspace/.ai-video-cataloger/credentials.json', { content: '{}' });
  fs.addFile('/workspace/.ai-video-cataloger/catalog.lock', { content: '{}' });
  fs.addFile('/workspace/.ai-video-cataloger/faces/obs/person/crop.jpg', { content: 'crop' });
  fs.addFile('/workspace/.ai-video-cataloger/faces/obs/person/write.tmp', { content: 'temp' });
  fs.addFile('/media/library/.ai-video-cataloger/config.json', { content: '{}' });
  fs.addFile('/media/library/.ai-video-cataloger/credentials.json', { content: '{}' });
  fs.addFile('/workspace/.ai-video-cataloger/photo-artifacts/proxies/photo.jpg', { content: 'proxy' });
  fs.addFile('/workspace/.ai-video-cataloger/photo-artifacts/thumbs/photo.grid.jpg', { content: 'thumb' });
  fs.addFile('/workspace/.ai-video-cataloger/photo-artifacts/thumbs/write.tmp', { content: 'temp' });
  fs.addFile('/workspace/.ai-video-cataloger/read-only-folders/folder-1/frames/frame.jpg', { content: 'frame' });
  fs.addFile('/workspace/.ai-video-cataloger/spend-ledger.ndjson', { content: 'spend' });
  return fs;
};
