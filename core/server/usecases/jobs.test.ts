import { describe, expect, it } from 'vitest';

import { enqueueProcess, getJobStatus } from './jobs.js';
import { InMemoryJobs } from '../../../test/server/usecases/test-fakes.js';

describe('job use-cases', () => {
  it('returns an internal error when process dependencies are missing', async () => {
    const deps = { jobs: new InMemoryJobs() };

    const enqueued = await enqueueProcess(deps, {
      videoPath: '/videos/clip.mp4',
      frames: 3,
      skipRename: false,
      verbose: false,
      timeout: 120,
      whisper: 'local',
      whisperModel: 'base',
    });
    expect(enqueued).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('returns not_found for unknown job status', async () => {
    const result = await getJobStatus({ jobs: new InMemoryJobs() }, { jobId: 'missing' });

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
