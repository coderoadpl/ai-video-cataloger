import { describe, expect, it } from 'vitest';

import { resetAll, resetSingle } from './reset.js';
import { InMemoryCatalogs, InMemoryFileSystem, videoFixture } from '../../../test/server/usecases/test-fakes.js';

describe('reset use-cases', () => {
  it('clears all videos with status counts when forced', async () => {
    const deps = {
      catalogs: new InMemoryCatalogs([
        {
          folder: '/work',
          videos: [
            videoFixture({ id: 1, status: 'completed' }),
            videoFixture({ id: 2, originalName: 'bad.mp4', originalPath: '/work/bad.mp4', status: 'error' }),
          ],
        },
      ]),
      fs: new InMemoryFileSystem('/work'),
    };

    const result = await resetAll(deps, { force: true });

    expect(result).toMatchObject({
      ok: true,
      value: { cleared: 2, byStatus: { completed: 1, error: 1 }, configPreserved: true },
    });
  });

  it('requires force before clearing non-empty catalogs', async () => {
    const deps = {
      catalogs: new InMemoryCatalogs([{ folder: '/work', videos: [videoFixture()] }]),
      fs: new InMemoryFileSystem('/work'),
    };

    const result = await resetAll(deps, { force: false });

    expect(result).toMatchObject({ ok: false, error: { code: 'force_required' } });
  });

  it('resets a single video back to pending', async () => {
    const deps = {
      catalogs: new InMemoryCatalogs([
        { folder: '/work', videos: [videoFixture({ status: 'error', errorMessage: 'failed', newName: 'new.mp4' })] },
      ]),
      fs: new InMemoryFileSystem('/work'),
    };

    const result = await resetSingle(deps, { filename: 'clip.mp4', force: true });

    expect(result).toEqual({
      ok: true,
      value: { filename: 'clip.mp4', previousStatus: 'error', newStatus: 'pending', previousError: 'failed' },
    });
  });

  it('does not require force for an already pending video', async () => {
    const deps = {
      catalogs: new InMemoryCatalogs([{ folder: '/work', videos: [videoFixture({ status: 'pending' })] }]),
      fs: new InMemoryFileSystem('/work'),
    };

    const result = await resetSingle(deps, { filename: 'clip.mp4', force: false });

    expect(result).toMatchObject({
      ok: true,
      value: { filename: 'clip.mp4', previousStatus: 'pending', newStatus: 'pending' },
    });
  });
});
