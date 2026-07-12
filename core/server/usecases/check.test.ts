import { describe, expect, it } from 'vitest';

import { checkNestedDatabases } from './check.js';
import { InMemoryFileSystem } from '../../../test/server/usecases/test-fakes.js';

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
        basePath: '/videos',
        scannedDirectories: 1,
      },
    });
  });

  it('rejects missing folders', async () => {
    const fs = new InMemoryFileSystem('/work');

    const result = await checkNestedDatabases({ fs }, { folder: '/missing' });

    expect(result).toMatchObject({ ok: false, error: { code: 'folder_not_found' } });
  });
});
