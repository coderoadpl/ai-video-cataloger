import { describe, expect, it } from 'vitest';

import { GLOBAL_CATALOG_SCHEMA_VERSION } from '@core/domain/index.js';

import { checkNestedDatabases } from './check.js';
import { InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';

const marker = (folderId: string): string =>
  JSON.stringify({ folderId, schemaVersion: GLOBAL_CATALOG_SCHEMA_VERSION, createdAt: '2026-07-28T10:00:00.000Z' });

describe('checkNestedDatabases', () => {
  it('reports nested catalog directories below the selected folder', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addDirectory('/videos/project');
    fs.addDirectory('/videos/project/.ai-video-cataloger');
    fs.addDirectory('/videos/.hidden');
    fs.addDirectory('/videos/.hidden/.ai-video-cataloger');

    const result = await checkNestedDatabases({ fs }, { folder: '/videos' });

    expect(result).toEqual({
      ok: true,
      value: {
        hasNestedDatabases: true,
        nestedPaths: ['/videos/project/.ai-video-cataloger'],
        ownNestedPaths: [],
        basePath: '/videos',
        scannedDirectories: 1,
      },
    });
  });

  it('does not report the app\'s own nested catalogs after a whole-tree run', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/.ai-video-cataloger/folder-id', { content: marker('11111111-1111-4111-8111-111111111111') });
    fs.addFile('/videos/project/.ai-video-cataloger/folder-id', { content: marker('22222222-2222-4222-8222-222222222222') });

    const result = await checkNestedDatabases({ fs }, { folder: '/videos' });

    expect(result).toEqual({
      ok: true,
      value: {
        hasNestedDatabases: false,
        nestedPaths: [],
        ownNestedPaths: ['/videos/project/.ai-video-cataloger'],
        basePath: '/videos',
        scannedDirectories: 1,
      },
    });
  });

  it('still reports a nested catalog directory without our folder-id marker', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addDirectory('/videos/foreign/.ai-video-cataloger');

    const result = await checkNestedDatabases({ fs }, { folder: '/videos' });

    expect(result).toMatchObject({
      ok: true,
      value: { hasNestedDatabases: true, nestedPaths: ['/videos/foreign/.ai-video-cataloger'], ownNestedPaths: [] },
    });
  });

  it('recognizes a nested catalog directory holding only catalog.db as our own', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/project/.ai-video-cataloger/catalog.db', { content: 'sqlite' });

    const result = await checkNestedDatabases({ fs }, { folder: '/videos' });

    expect(result).toEqual({
      ok: true,
      value: {
        hasNestedDatabases: false,
        nestedPaths: [],
        ownNestedPaths: ['/videos/project/.ai-video-cataloger'],
        basePath: '/videos',
        scannedDirectories: 1,
      },
    });
  });

  it('recognizes a nested catalog directory holding only catalog.ndjson as our own', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/project/.ai-video-cataloger/catalog.ndjson', { content: '{}' });

    const result = await checkNestedDatabases({ fs }, { folder: '/videos' });

    expect(result).toEqual({
      ok: true,
      value: {
        hasNestedDatabases: false,
        nestedPaths: [],
        ownNestedPaths: ['/videos/project/.ai-video-cataloger'],
        basePath: '/videos',
        scannedDirectories: 1,
      },
    });
  });

  it('still reports a nested catalog directory holding an unrelated file as foreign', async () => {
    const fs = new InMemoryFileSystem('/videos');
    fs.addFile('/videos/foreign/.ai-video-cataloger/notes.txt', { content: 'hello' });

    const result = await checkNestedDatabases({ fs }, { folder: '/videos' });

    expect(result).toMatchObject({
      ok: true,
      value: { hasNestedDatabases: true, nestedPaths: ['/videos/foreign/.ai-video-cataloger'], ownNestedPaths: [] },
    });
  });

  it('rejects missing folders', async () => {
    const fs = new InMemoryFileSystem('/work');

    const result = await checkNestedDatabases({ fs }, { folder: '/missing' });

    expect(result).toMatchObject({ ok: false, error: { code: 'folder_not_found' } });
  });
});
