import { describe, expect, it } from 'vitest';

import { getStatus } from './status.js';
import { InMemoryCatalogs, InMemoryFileSystem, videoFixture } from '../../../test/server/usecases/test-fakes.js';

describe('getStatus', () => {
  it('lists tracked videos with display labels and summary counts', async () => {
    const deps = {
      catalogs: new InMemoryCatalogs([
        {
          folder: '/work',
          videos: [
            videoFixture({ id: 1, status: 'completed' }),
            videoFixture({ id: 2, originalName: 'next.mp4', originalPath: '/work/next.mp4', status: 'transcribed' }),
          ],
        },
      ]),
      fs: new InMemoryFileSystem('/work'),
    };

    const result = await getStatus(deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        videos: [
          { originalName: 'clip.mp4', statusLabel: 'Completed' },
          { originalName: 'next.mp4', statusLabel: 'In Progress (transcribed)' },
        ],
        summary: { total: 2, completed: 1, inProgress: 1, pending: 0, error: 0 },
      },
    });
  });
});
